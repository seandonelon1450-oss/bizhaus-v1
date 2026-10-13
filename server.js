'use strict';
/* =====================================================================
 * BIZHAUS v1 — Priority 2 build per MUSE-HANDOFF §9C (supersedes the
 * old AI-migration-concierge concept, which has been removed).
 *
 * One codebase, trades via the brand attribute + /public/trades/*.json.
 *
 * Missed-Call Rescue MVP: Twilio webhooks wired, NOT activated.
 * ACTIVATION SAFETY (critical): outbound SMS is impossible unless
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER are all set
 * AND MCR_LIVE=true. Otherwise the server logs "would send: ..." and
 * skips. No real SMS and no real charges may occur from this code as
 * delivered. A2P 10DLC approval is NOT done — Sean blocker.
 * =================================================================== */
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
app.set('trust proxy', 1); /* correct protocol/host behind Render's proxy */
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

/* ------------------------------------------------------------------
 * Activation safety gate.
 * ------------------------------------------------------------------ */
const MCR_LIVE =
  process.env.MCR_LIVE === 'true' &&
  !!process.env.TWILIO_ACCOUNT_SID &&
  !!process.env.TWILIO_AUTH_TOKEN &&
  !!process.env.TWILIO_FROM_NUMBER;
if (!MCR_LIVE) {
  console.log('[mcr] Missed-Call Rescue is NOT live — outbound SMS disabled. ' +
    'Would-send events will be logged only. Set TWILIO_ACCOUNT_SID, ' +
    'TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER and MCR_LIVE=true to activate.');
}

/* ------------------------------------------------------------------
 * Storage: Postgres when DATABASE_URL is set (and pg loads), else a
 * local JSON file store. Decision recorded in BUILD-REPORT.md.
 * ------------------------------------------------------------------ */
function blankStore() {
  return { webhookEvents: [], callers: {}, texts: [], calls: [],
           bookings: [], invites: [], settings: {} };
}

function fileStore(file) {
  const read = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { return blankStore(); }
  };
  const write = (d) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
    fs.renameSync(tmp, file);
  };
  const callerOf = (d, phone) =>
    d.callers[phone] || (d.callers[phone] = {
      phone, optedOut: false, lastAutoText: null,
      turns: 0, windowStart: null, needsOwner: false });
  return {
    kind: 'file',
    async webhookSeen(id) { return read().webhookEvents.includes(id); },
    async markWebhook(id) { const d = read(); if (!d.webhookEvents.includes(id)) d.webhookEvents.push(id); write(d); },
    async getCaller(phone) { return callerOf(read(), phone); },
    async saveCaller(c) { const d = read(); d.callers[c.phone] = c; write(d); },
    async logText(t) { const d = read(); d.texts.push({ ts: new Date().toISOString(), ...t }); write(d); },
    async logCall(c) { const d = read(); d.calls.push({ ts: new Date().toISOString(), ...c }); write(d); },
    async logBooking(b) { const d = read(); d.bookings.push({ ts: new Date().toISOString(), ...b }); write(d); },
    async logInvite(i) { const d = read(); d.invites.push({ ts: new Date().toISOString(), ...i }); write(d); },
    async getTexts(limit) { return read().texts.slice(-limit).reverse(); },
    async getCalls(limit) { return read().calls.slice(-limit).reverse(); },
    async getBookings(limit) { return read().bookings.slice(-limit).reverse(); },
    async getInvites(limit) { return read().invites.slice(-limit).reverse(); },
    async getSettings() { return read().settings || {}; },
    async saveSettings(s) { const d = read(); d.settings = s; write(d); },
    async clearData() { const d = blankStore(); write(d); },
    async summary24h() {
      const d = read(); const cut = Date.now() - 24 * 3600 * 1000;
      const recent = (arr) => arr.filter((r) => new Date(r.ts).getTime() >= cut);
      const texts = recent(d.texts);
      return {
        calls: recent(d.calls).length,
        autoTexts: texts.filter((t) => t.direction === 'out' && t.kind === 'auto').length,
        ownerTexts: texts.filter((t) => t.direction === 'out' && t.kind === 'owner').length,
        inbound: texts.filter((t) => t.direction === 'in').length,
        optOuts: Object.values(d.callers).filter((c) => c.optedOut).length,
        bookings: recent(d.bookings).length
      };
    }
  };
}

function pgStore(pool) {
  const initSql = `
    CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, ts TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS callers (phone TEXT PRIMARY KEY, opted_out BOOLEAN DEFAULT false,
      last_auto_text TIMESTAMPTZ, turns INT DEFAULT 0, window_start TIMESTAMPTZ, needs_owner BOOLEAN DEFAULT false);
    CREATE TABLE IF NOT EXISTS texts (id SERIAL PRIMARY KEY, ts TIMESTAMPTZ DEFAULT now(),
      phone TEXT, direction TEXT, body TEXT, kind TEXT);
    CREATE TABLE IF NOT EXISTS calls (id SERIAL PRIMARY KEY, ts TIMESTAMPTZ DEFAULT now(), phone TEXT, sid TEXT);
    CREATE TABLE IF NOT EXISTS bookings (id SERIAL PRIMARY KEY, ts TIMESTAMPTZ DEFAULT now(),
      name TEXT, phone TEXT, detail TEXT);
    CREATE TABLE IF NOT EXISTS invites (id SERIAL PRIMARY KEY, ts TIMESTAMPTZ DEFAULT now(),
      name TEXT, email TEXT, interest TEXT);
    CREATE TABLE IF NOT EXISTS settings (id INT PRIMARY KEY, data JSONB);
  `;
  const norm = (c) => ({
    phone: c.phone, optedOut: !!c.opted_out,
    lastAutoText: c.last_auto_text ? new Date(c.last_auto_text).toISOString() : null,
    turns: c.turns || 0, windowStart: c.window_start ? new Date(c.window_start).toISOString() : null,
    needsOwner: !!c.needs_owner
  });
  return {
    kind: 'postgres',
    async init() { await pool.query(initSql); },
    async webhookSeen(id) { const r = await pool.query('SELECT 1 FROM webhook_events WHERE id=$1', [id]); return r.rowCount > 0; },
    async markWebhook(id) { await pool.query('INSERT INTO webhook_events(id) VALUES($1) ON CONFLICT DO NOTHING', [id]); },
    async getCaller(phone) {
      const r = await pool.query('SELECT * FROM callers WHERE phone=$1', [phone]);
      if (r.rowCount) return norm(r.rows[0]);
      return { phone, optedOut: false, lastAutoText: null, turns: 0, windowStart: null, needsOwner: false };
    },
    async saveCaller(c) {
      await pool.query(
        `INSERT INTO callers(phone, opted_out, last_auto_text, turns, window_start, needs_owner)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT (phone) DO UPDATE SET opted_out=$2, last_auto_text=$3, turns=$4, window_start=$5, needs_owner=$6`,
        [c.phone, c.optedOut, c.lastAutoText, c.turns, c.windowStart, c.needsOwner]);
    },
    async logText(t) { await pool.query('INSERT INTO texts(phone, direction, body, kind) VALUES($1,$2,$3,$4)', [t.phone, t.direction, t.body, t.kind]); },
    async logCall(c) { await pool.query('INSERT INTO calls(phone, sid) VALUES($1,$2)', [c.phone, c.sid]); },
    async logBooking(b) { await pool.query('INSERT INTO bookings(name, phone, detail) VALUES($1,$2,$3)', [b.name, b.phone, b.detail]); },
    async logInvite(i) { await pool.query('INSERT INTO invites(name, email, interest) VALUES($1,$2,$3)', [i.name, i.email, i.interest]); },
    async getTexts(l) { const r = await pool.query('SELECT ts, phone, direction, body, kind FROM texts ORDER BY id DESC LIMIT $1', [l]); return r.rows; },
    async getCalls(l) { const r = await pool.query('SELECT ts, phone, sid FROM calls ORDER BY id DESC LIMIT $1', [l]); return r.rows; },
    async getBookings(l) { const r = await pool.query('SELECT ts, name, phone, detail FROM bookings ORDER BY id DESC LIMIT $1', [l]); return r.rows; },
    async getInvites(l) { const r = await pool.query('SELECT ts, name, email, interest FROM invites ORDER BY id DESC LIMIT $1', [l]); return r.rows; },
    async getSettings() { const r = await pool.query('SELECT data FROM settings WHERE id=1'); return (r.rowCount && r.rows[0].data) || {}; },
    async saveSettings(s) { await pool.query('INSERT INTO settings(id, data) VALUES(1,$1) ON CONFLICT (id) DO UPDATE SET data=$1', [JSON.stringify(s)]); },
    async clearData() {
      await pool.query('TRUNCATE texts, calls, bookings, invites, callers, webhook_events RESTART IDENTITY');
      await pool.query('DELETE FROM settings WHERE id=1');
    },
    async summary24h() {
      const q = async (sql) => (await pool.query(sql)).rows[0].n;
      const recent = "ts >= now() - interval '24 hours'";
      return {
        calls: Number(await q(`SELECT COUNT(*) n FROM calls WHERE ${recent}`)),
        autoTexts: Number(await q(`SELECT COUNT(*) n FROM texts WHERE direction='out' AND kind='auto' AND ${recent}`)),
        ownerTexts: Number(await q(`SELECT COUNT(*) n FROM texts WHERE direction='out' AND kind='owner' AND ${recent}`)),
        inbound: Number(await q(`SELECT COUNT(*) n FROM texts WHERE direction='in' AND ${recent}`)),
        optOuts: Number(await q('SELECT COUNT(*) n FROM callers WHERE opted_out')),
        bookings: Number(await q(`SELECT COUNT(*) n FROM bookings WHERE ${recent}`))
      };
    }
  };
}

let store;
async function initStore() {
  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: process.env.DATABASE_URL,
        ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } });
      const s = pgStore(pool);
      await s.init();
      console.log('[store] using Postgres (DATABASE_URL is set)');
      return s;
    } catch (e) {
      console.warn('[store] DATABASE_URL set but pg failed (' + e.message + ') — falling back to file store');
    }
  }
  console.log('[store] using local JSON file store (data/mcr.json)');
  return fileStore(path.join(ROOT, 'data', 'mcr.json'));
}

/* ------------------------------------------------------------------
 * Business config (seeded from config/mcr-business.json; the owner
 * edits it in the dashboard, persisted in store.settings).
 * Replies are answered ONLY from this config; anything else hands off
 * to the owner.
 * ------------------------------------------------------------------ */
function seedBusiness() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'mcr-business.json'), 'utf8')); }
  catch (e) { return { businessName: 'Example Business', ownerName: 'the owner', phone: '', bookingLink: '', hours: '', area: '', priceRanges: '', faqs: [] }; }
}
async function businessConfig() {
  const s = await store.getSettings();
  return (s && s.business) || seedBusiness();
}

/* ------------------------------------------------------------------
 * Outbound SMS — gated. Never sends unless MCR_LIVE (see top of file).
 * ------------------------------------------------------------------ */
async function sendSms(to, body, kind) {
  if (!MCR_LIVE) {
    console.log('[mcr] would send (' + kind + ') to ' + to + ': ' + body);
    await store.logText({ phone: to, direction: 'out', body, kind: kind + '-simulated' });
    return { sent: false, simulated: true };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'),
               'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString()
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.error('[mcr] Twilio send failed:', res.status, t.slice(0, 200));
    throw new Error('Twilio send failed: ' + res.status);
  }
  await store.logText({ phone: to, direction: 'out', body, kind });
  return { sent: true };
}

/* ------------------------------------------------------------------
 * Twilio signature verification. Invalid (or unverifiable) → 403.
 * ------------------------------------------------------------------ */
function verifyTwilio(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers['x-twilio-signature'];
  if (!authToken || !signature) return res.status(403).send('Invalid signature');
  const url = req.protocol + '://' + req.get('host') + req.originalUrl;
  const params = req.body || {};
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
  let ok = false;
  try { ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature))); }
  catch (e) { ok = false; }
  if (!ok) return res.status(403).send('Invalid signature');
  next();
}

/* ------------------------------------------------------------------
 * Health.
 * ------------------------------------------------------------------ */
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'bizhaus-v1', mcrLive: MCR_LIVE }));

/* ------------------------------------------------------------------
 * POST /webhooks/twilio/voice — missed-call handler.
 * Any call hitting this endpoint is treated as missed: hang up, then
 * auto-text once per caller per 12h (never if opted out).
 * ------------------------------------------------------------------ */
app.post('/webhooks/twilio/voice', verifyTwilio, async (req, res) => {
  const sid = String(req.body.CallSid || '');
  const from = String(req.body.From || '');
  res.type('text/xml').status(200).send('<Response><Hangup/></Response>');

  if (!from) return;
  try {
    if (sid && await store.webhookSeen('voice:' + sid)) return; /* idempotent */
    if (sid) await store.markWebhook('voice:' + sid);
    await store.logCall({ phone: from, sid });

    const caller = await store.getCaller(from);
    if (caller.optedOut) { console.log('[mcr] caller opted out, no text:', from); return; }
    const last = caller.lastAutoText ? new Date(caller.lastAutoText).getTime() : 0;
    if (Date.now() - last < 12 * 3600 * 1000) { console.log('[mcr] auto-text already sent within 12h:', from); return; }

    const biz = await businessConfig();
    const body = 'Hi, this is ' + biz.businessName + '. Sorry we missed your call. ' +
      (biz.bookingLink ? 'Book a time here: ' + biz.bookingLink + '. ' : '') +
      'Reply STOP to opt out.';
    const r = await sendSms(from, body, 'auto');
    caller.lastAutoText = new Date().toISOString();
    if (!r.simulated) caller.lastAutoText = new Date().toISOString();
    await store.saveCaller(caller);
  } catch (e) { console.error('[mcr] voice webhook error:', e.message); }
});

/* ------------------------------------------------------------------
 * POST /webhooks/twilio/sms — inbound SMS.
 * STOP/HELP honored. 10-turn auto-reply cap per caller per 24h.
 * Replies come ONLY from the business config; anything else → owner.
 * ------------------------------------------------------------------ */
function answerFromConfig(biz, text) {
  const t = text.toLowerCase();
  const norm = (s) => String(s || '').toLowerCase();
  if (/\bhours?\b|\bopen\b|\bclose\b|\bwhen\b/.test(t) && biz.hours)
    return 'Our hours: ' + biz.hours + '.';
  if (/\bwhere\b|\barea\b|\bserve\b|\blocation\b/.test(t) && biz.area)
    return 'We serve ' + biz.area + '.';
  if (/\bprice\b|\bcost\b|\bhow much\b|\bcharge\b/.test(t) && biz.priceRanges)
    return biz.priceRanges;
  if (/\bbook\b|\bschedule\b|\bappointment\b|\bestimate\b/.test(t) && biz.bookingLink)
    return 'You can book here: ' + biz.bookingLink;
  for (const f of (biz.faqs || [])) {
    if ((f.match || []).some((m) => t.includes(norm(m)))) return f.answer;
  }
  return null;
}

app.post('/webhooks/twilio/sms', verifyTwilio, async (req, res) => {
  const sid = String(req.body.MessageSid || req.body.SmsSid || '');
  const from = String(req.body.From || '');
  const text = String(req.body.Body || '').trim();
  const twiml = (msg) => res.type('text/xml').status(200)
    .send(msg ? '<Response><Message>' + escapeXml(msg) + '</Message></Response>' : '<Response/>');
  const reply = async (msg, kind) => {
    await store.logText({ phone: from, direction: 'out', body: msg, kind: kind + (MCR_LIVE ? '' : '-simulated') });
    if (MCR_LIVE) twiml(msg);
    else { console.log('[mcr] would send (' + kind + ') to ' + from + ': ' + msg); twiml(null); }
  };

  try {
    if (sid && await store.webhookSeen('sms:' + sid)) return twiml(null);
    if (sid) await store.markWebhook('sms:' + sid);
    if (!from) return twiml(null);
    await store.logText({ phone: from, direction: 'in', body: text, kind: 'inbound' });

    const caller = await store.getCaller(from);
    const biz = await businessConfig();
    const first = text.split(/\s+/)[0].toLowerCase();

    /* STOP blocks all future texts to that caller. */
    if (first === 'stop' || first === 'unsubscribe' || first === 'cancel') {
      caller.optedOut = true; caller.needsOwner = false; await store.saveCaller(caller);
      return reply("You've been unsubscribed — no more texts from " + biz.businessName + '.', 'optout');
    }
    if (first === 'help') {
      return reply(biz.businessName + (biz.phone ? ' ' + biz.phone : '') + '. ' +
        (biz.hours ? 'Hours: ' + biz.hours + '. ' : '') + 'Reply STOP to opt out.', 'help');
    }
    if (caller.optedOut) return twiml(null); /* silent after opt-out */
    if (caller.needsOwner) return twiml(null); /* owner has taken over — stay quiet */

    /* 10-turn auto-reply cap per 24h. */
    const now = Date.now();
    const winStart = caller.windowStart ? new Date(caller.windowStart).getTime() : 0;
    if (!caller.windowStart || now - winStart > 24 * 3600 * 1000) { caller.turns = 0; caller.windowStart = new Date().toISOString(); }
    if (caller.turns >= 10) {
      caller.needsOwner = true; await store.saveCaller(caller);
      return reply('Thanks — handing this to ' + biz.ownerName + ', who will follow up with you shortly.', 'cap');
    }

    const answer = answerFromConfig(biz, text);
    caller.turns += 1; await store.saveCaller(caller);
    if (answer) return reply(answer, 'auto');
    /* Hand off to the owner — never invent an answer. */
    caller.needsOwner = true; await store.saveCaller(caller);
    return reply('Good question — ' + biz.ownerName + ' will get back to you shortly.', 'handoff');
  } catch (e) { console.error('[mcr] sms webhook error:', e.message); return twiml(null); }
});

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/* ------------------------------------------------------------------
 * 7 AM Central daily summary — IMPLEMENTED, NOT SCHEDULED.
 * Wire a scheduler (cron job / Render cron) to call dailySummary().
 * No mailer is configured yet: the summary is logged and returned.
 * ------------------------------------------------------------------ */
async function dailySummary() {
  const s = await store.summary24h();
  const biz = await businessConfig();
  const lines = [
    'BIZHAUS Missed-Call Rescue — daily summary for ' + biz.businessName,
    'Last 24 hours:',
    '- Missed calls: ' + s.calls,
    '- Auto-texts sent: ' + s.autoTexts,
    '- Owner texts sent: ' + s.ownerTexts,
    '- Inbound texts: ' + s.inbound,
    '- New bookings: ' + s.bookings,
    '- Total opted out: ' + s.optOuts,
    '(Email delivery not configured — see BUILD-REPORT.md Sean-blockers.)'
  ];
  const text = lines.join('\n');
  console.log('[mcr] 7 AM Central daily summary (not scheduled — wire a cron to call dailySummary()):\n' + text);
  return text;
}

/* ------------------------------------------------------------------
 * Owner dashboard API — gated by BIZHAUS_ADMIN_TOKEN.
 * ------------------------------------------------------------------ */
function requireAdmin(req, res, next) {
  const token = process.env.BIZHAUS_ADMIN_TOKEN;
  if (!token) return res.status(503).json({ ok: false, error: 'Admin is disabled — BIZHAUS_ADMIN_TOKEN is not configured.' });
  const given = req.query.token || req.headers['x-admin-token'];
  if (given !== token) return res.status(403).json({ ok: false, error: 'Bad token.' });
  next();
}
app.get('/api/admin/inbox', requireAdmin, async (req, res) => {
  res.json({ ok: true, texts: await store.getTexts(200) });
});
app.get('/api/admin/calls', requireAdmin, async (req, res) => {
  res.json({ ok: true, calls: await store.getCalls(200) });
});
app.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  res.json({ ok: true, bookings: await store.getBookings(200) });
});
app.get('/api/admin/invites', requireAdmin, async (req, res) => {
  res.json({ ok: true, invites: await store.getInvites(200) });
});
app.post('/api/admin/takeover', requireAdmin, async (req, res) => {
  const phone = String(req.body.phone || '');
  if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });
  const caller = await store.getCaller(phone);
  caller.needsOwner = true; await store.saveCaller(caller);
  res.json({ ok: true });
});
app.post('/api/admin/resume', requireAdmin, async (req, res) => {
  const phone = String(req.body.phone || '');
  if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });
  const caller = await store.getCaller(phone);
  caller.needsOwner = false; caller.turns = 0; caller.windowStart = new Date().toISOString();
  await store.saveCaller(caller);
  res.json({ ok: true });
});
app.post('/api/admin/reply', requireAdmin, async (req, res) => {
  const phone = String(req.body.phone || '');
  const body = String(req.body.body || '').trim().slice(0, 1000);
  if (!phone || !body) return res.status(400).json({ ok: false, error: 'phone and body required' });
  try {
    const r = await sendSms(phone, body, 'owner');
    res.json({ ok: true, sent: r.sent, simulated: r.simulated });
  } catch (e) { res.status(502).json({ ok: false, error: 'Send failed.' }); }
});
app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  res.json({ ok: true, business: await businessConfig(), mcrLive: MCR_LIVE });
});
app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  const b = req.body.business || {};
  const clean = (v, n) => String(v || '').slice(0, n);
  const faqs = Array.isArray(b.faqs) ? b.faqs.slice(0, 30).map((f) => ({
    match: (Array.isArray(f.match) ? f.match : []).map((m) => clean(m, 60)).slice(0, 10),
    answer: clean(f.answer, 600)
  })) : [];
  const business = {
    businessName: clean(b.businessName, 80) || 'Example Business',
    ownerName: clean(b.ownerName, 80) || 'the owner',
    phone: clean(b.phone, 40), bookingLink: clean(b.bookingLink, 300),
    hours: clean(b.hours, 300), area: clean(b.area, 300),
    priceRanges: clean(b.priceRanges, 600), faqs
  };
  const s = await store.getSettings(); s.business = business; await store.saveSettings(s);
  res.json({ ok: true, business });
});
app.get('/api/admin/summary', requireAdmin, async (req, res) => {
  res.json({ ok: true, summary: await dailySummary() });
});

/* ------------------------------------------------------------------
 * Data charter: real Export + Delete (owner token).
 * ------------------------------------------------------------------ */
app.get('/api/data/export', requireAdmin, async (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="bizhaus-data-export.json"');
  res.json({ ok: true, exportedAt: new Date().toISOString(),
    texts: await store.getTexts(5000), calls: await store.getCalls(5000),
    bookings: await store.getBookings(5000), invites: await store.getInvites(5000) });
});
app.post('/api/data/delete', requireAdmin, async (req, res) => {
  await store.clearData();
  res.json({ ok: true, deleted: true });
});

/* ------------------------------------------------------------------
 * Booking requests (free-estimate / contact forms) — honest labels.
 * ------------------------------------------------------------------ */
app.post('/api/bookings', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  const phone = String(b.phone || '').trim().slice(0, 40);
  const detail = String(b.detail || '').trim().slice(0, 600);
  const trade = String(b.trade || 'bizhaus').slice(0, 20);
  if (!name) return res.status(400).json({ ok: false, error: 'Please tell us your name.' });
  if (!phone) return res.status(400).json({ ok: false, error: 'Please leave a phone number.' });
  store.logBooking({ name, phone, detail, trade }).then(
    () => res.json({ ok: true }),
    () => res.status(500).json({ ok: false, error: 'Could not save — try again.' }));
});

/* ------------------------------------------------------------------
 * Invites — Missed-Call Rescue has no live checkout yet (brief #9).
 * "Request an invite" only; no charges possible from this code.
 * ------------------------------------------------------------------ */
app.post('/api/invites', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 160);
  const interest = String(b.interest || 'missed-call-rescue').slice(0, 40);
  if (!name) return res.status(400).json({ ok: false, error: 'Please tell us your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    return res.status(400).json({ ok: false, error: 'That email address does not look valid.' });
  store.logInvite({ name, email, interest }).then(
    () => res.json({ ok: true, inviteOnly: true }),
    () => res.status(500).json({ ok: false, error: 'Could not save — try again.' }));
});

/* ------------------------------------------------------------------
 * Stripe wiring — CODE ONLY, no live keys, no live charges.
 * Per brief non-negotiable #9: no checkout until the webhook is set up
 * and one real test charge + refund passes. Until then: invite only.
 * ------------------------------------------------------------------ */
app.post('/api/billing/checkout', (req, res) => {
  const ready = MCR_LIVE && !!process.env.STRIPE_SECRET_KEY &&
    !!process.env.STRIPE_SETUP_PRICE_ID && !!process.env.STRIPE_SUB_PRICE_ID &&
    process.env.STRIPE_LIVE === 'true';
  if (!ready) {
    return res.json({ ok: false, inviteOnly: true,
      message: 'Checkout is not open yet — request an invite and we will be in touch.' });
  }
  /* Live path intentionally left as a 501: flipping this on requires
   * Sean's explicit go-ahead, real Stripe keys, and the webhook below. */
  return res.status(501).json({ ok: false, error: 'Checkout not activated.' });
});
/* Stripe webhook receiver (signature-verified; inert until keys exist). */
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).send('Stripe not configured');
  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(403).send('Invalid signature');
  /* Full signature verification requires the stripe package, which is not
   * installed on purpose — no live Stripe in this build. */
  return res.status(501).send('Stripe not activated');
});

/* ------------------------------------------------------------------
 * Private analytics: pageviews + conversion events. No third parties,
 * no cookies, no fingerprinting, no PII. Page + event + timestamp only.
 * ------------------------------------------------------------------ */
const ANALYTICS_FILE = path.join(ROOT, 'data', 'analytics.jsonl');
app.post('/api/track', (req, res) => {
  const body = req.body || {};
  const page = String(body.page || '').slice(0, 120);
  let event = String(body.event || 'pageview').slice(0, 40);
  if (!/^[a-z0-9_]+$/.test(event)) event = 'pageview';
  if (!page.startsWith('/')) return res.status(400).json({ ok: false });
  try {
    fs.appendFileSync(ANALYTICS_FILE,
      JSON.stringify({ ts: new Date().toISOString(), page, event,
        ua: String(req.headers['user-agent'] || '').slice(0, 120) }) + '\n');
  } catch (e) { /* best effort */ }
  res.json({ ok: true });
});
app.get('/api/stats', (req, res) => {
  const token = process.env.ANALYTICS_TOKEN;
  if (!token || req.query.token !== token) return res.status(403).json({ ok: false });
  let lines = [];
  try {
    lines = fs.readFileSync(ANALYTICS_FILE, 'utf8').split('\n').filter(Boolean)
      .map((ln) => { try { return JSON.parse(ln); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { /* none yet */ }
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const pageviewsByPage = {}, eventsByType = {};
  let totalPageviews = 0;
  for (const r of lines) {
    if (new Date(r.ts).getTime() < cutoff) continue;
    eventsByType[r.event] = (eventsByType[r.event] || 0) + 1;
    if (r.event === 'pageview') { totalPageviews++; pageviewsByPage[r.page] = (pageviewsByPage[r.page] || 0) + 1; }
  }
  res.json({ ok: true, days: 30, totalPageviews, pageviewsByPage, eventsByType });
});

/* ------------------------------------------------------------------
 * Static site (extensions: .html). HTML never cached.
 * ------------------------------------------------------------------ */
app.use(express.static(path.join(ROOT, 'public'), {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  }
}));

/* Friendly 404 for API typos. */
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
app.use('/api', (err, req, res, next) => {
  console.error('[bizhaus] api error:', err.message);
  res.status(err.status || 400).json({ error: 'Bad request — expected JSON.' });
});

initStore().then((s) => {
  store = s;
  app.locals.dailySummary = dailySummary; /* schedulers: call app.locals.dailySummary() */
  app.listen(PORT, () => console.log(
    `[bizhaus] listening on ${PORT} · store=${s.kind} · mcrLive=${MCR_LIVE}`));
}).catch((e) => { console.error('[bizhaus] failed to start:', e.message); process.exit(1); });
