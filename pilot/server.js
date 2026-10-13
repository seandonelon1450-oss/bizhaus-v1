'use strict';
/* =====================================================================
 * BIZHAUS PILOT — the first slice of the closed-loop service.
 *
 * The demo-call experience from the playbook ("the demo is the pitch"):
 * a prospect "calls" All American Exteriors (DEMO business), VESTA
 * answers by voice in the browser, runs intake, books the job into the
 * pilot calendar, and KIARA drafts the follow-through (confirmation,
 * reminder, invoice prompt, review request) as FINISHED WORK in the
 * owner's morning summary — each item waits for Approve / Edit / Skip.
 *
 * $0 posture, same safety rules as the Missed-Call Rescue build:
 * NOTHING is sent anywhere from this code. Every customer-facing
 * message is a draft in the owner queue, labeled simulated. Real
 * sending activates only with the telephony seam in PILOT-BUILD.md
 * (Twilio number + credentials + A2P 10DLC + Sean's go-ahead).
 *
 * Run: npm ci && node server.js   (reads PORT, default 3200)
 * =================================================================== */
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '128kb' }));

const PORT = Number(process.env.PORT || 3200);
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'pilot.json');

/* ------------------------------------------------------------------
 * Business config — the pilot client. DEMO details only: owner name,
 * real phone, and exact service list are still [FILL] items in the
 * All American Exteriors launch note; nothing real is invented here.
 * ------------------------------------------------------------------ */
const BUSINESS = {
  businessName: 'All American Exteriors',
  demoLabel: 'DEMO — pilot walkthrough on example details',
  trade: 'gutters & exteriors',
  ownerName: 'the owner',
  area: 'Metairie, Kenner, and the New Orleans metro',
  hours: 'Mon–Fri 8am–6pm, Sat 9am–2pm',
  services: [
    { key: 'installation', label: 'Gutter installation', match: ['install', 'new gutter', 'replace', 'seamless'] },
    { key: 'cleaning', label: 'Gutter cleaning', match: ['clean', 'clog', 'leaves', 'overflow', 'debris'] },
    { key: 'guards', label: 'Gutter guards', match: ['guard', 'cover', 'screen', 'leaf'] },
    { key: 'repair', label: 'Downspout repair', match: ['repair', 'downspout', 'leak', 'fix', 'broken', 'drip'] },
    { key: 'estimate', label: 'Free estimate', match: ['estimate', 'quote', 'price', 'cost', 'look'] }
  ]
};

/* ------------------------------------------------------------------
 * Storage — local JSON file store (same atomic-write pattern as
 * bizhaus-v1's MCR store). Render disk is ephemeral; for the pilot
 * this is a walkthrough store. Postgres seam: see PILOT-BUILD.md.
 * ------------------------------------------------------------------ */
function blankStore() { return { calls: [], bookings: [], actions: [] }; }
function readStore() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { return blankStore(); }
}
function writeStore(d) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
const uid = () => crypto.randomBytes(6).toString('hex');

/* ------------------------------------------------------------------
 * Appointment slots — next three real openings, Central time.
 * ------------------------------------------------------------------ */
function nextSlots() {
  const tz = 'America/Chicago';
  const fmtDay = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
  const now = new Date();
  const mk = (daysAhead, hour, label) => {
    const d = new Date(now.getTime() + daysAhead * 24 * 3600 * 1000);
    return { id: 'slot-' + daysAhead + '-' + hour, when: fmtDay.format(d) + ' at ' + label, hourLabel: label };
  };
  return [mk(1, 9, '9:00 AM'), mk(1, 13, '1:00 PM'), mk(2, 10, '10:00 AM')];
}

/* ------------------------------------------------------------------
 * VESTA — the intake conversation. Deterministic state machine:
 * no external AI key, no cost, fully testable. She answers ONLY from
 * the business config; anything outside intake goes to the owner.
 * Steps: need -> name -> address -> phone -> slot -> confirm -> done
 * ------------------------------------------------------------------ */
function vestaGreeting() {
  return 'Thanks for calling ' + BUSINESS.businessName + '. This is Vesta — ' +
    'I can book you a free estimate or an appointment right now. What do you need help with today?';
}

function detectService(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  for (const s of BUSINESS.services) {
    if (s.match.some((m) => t.includes(m))) return s;
  }
  return null;
}

function extractName(text) {
  const t = text.trim();
  const m = t.match(/(?:my name is|name's|i am|i'm|im|this is)\s+([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*)?)/i);
  if (m) return titleCase(m[1]);
  const words = t.replace(/[^A-Za-z'\-\s]/g, '').split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 3 && !detectService(t)) return titleCase(words.join(' '));
  return null;
}
function titleCase(s) { return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()); }

function extractPhone(text) {
  const digits = text.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}
function prettyPhone(d) { return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6); }

function pickSlot(text, slots) {
  const t = text.toLowerCase();
  if (/\b(1|one|first)\b/.test(t)) return slots[0];
  if (/\b(2|two|second)\b/.test(t)) return slots[1];
  if (/\b(3|three|third)\b/.test(t)) return slots[2];
  if (/morning/.test(t)) return slots.find((s) => s.hourLabel.includes('AM') && s.hourLabel.startsWith('9')) || slots[0];
  if (/afternoon/.test(t)) return slots.find((s) => s.hourLabel.includes('PM')) || slots[1];
  return null;
}

function wantsHuman(text) { return /\b(human|person|owner|someone real|manager|call me back|callback)\b/i.test(text); }

function startCall() {
  const d = readStore();
  const call = {
    id: uid(), startedAt: new Date().toISOString(), step: 'need',
    fields: {}, slots: nextSlots(), needsOwner: false, bookingId: null,
    transcript: [{ who: 'vesta', text: vestaGreeting() }]
  };
  d.calls.push(call); writeStore(d);
  return call;
}

function say(call, rawText) {
  const text = String(rawText || '').trim().slice(0, 500);
  const d = readStore();
  const stored = d.calls.find((c) => c.id === call.id);
  const c = stored || call;
  c.transcript.push({ who: 'caller', text });
  let reply;

  if (wantsHuman(text) && c.step !== 'done') {
    c.needsOwner = true;
    reply = 'Of course — I\'ll have ' + BUSINESS.ownerName + ' call you back personally. ' +
      'While I have you, let me finish booking you in so your spot is held. ' +
      stepPrompt(c);
    c.transcript.push({ who: 'vesta', text: reply });
    writeStore(d);
    return { reply, call: c };
  }

  switch (c.step) {
    case 'need': {
      const svc = detectService(text);
      if (!svc) {
        reply = 'Happy to help. We handle gutter installation, gutter cleaning, gutter guards, and downspout repair — or just a free estimate. Which one fits?';
        break;
      }
      c.fields.service = svc.label; c.step = 'name';
      reply = svc.label + ' — we can do that. May I have your name?';
      break;
    }
    case 'name': {
      const name = extractName(text);
      if (!name) { reply = 'Sorry, I didn\'t catch that — what name should I put on the appointment?'; break; }
      c.fields.name = name; c.step = 'address';
      reply = 'Thanks, ' + name.split(' ')[0] + '. What\'s the address for the work? A street address or just the neighborhood is fine.';
      break;
    }
    case 'address': {
      if (text.length < 3) { reply = 'What address or neighborhood should the crew come to?'; break; }
      c.fields.address = text; c.step = 'phone';
      reply = 'Got it. What\'s the best mobile number for your confirmation text?';
      break;
    }
    case 'phone': {
      const digits = extractPhone(text);
      if (!digits) { reply = 'I need a 10-digit mobile number for the confirmation — could you say it once more?'; break; }
      c.fields.phone = prettyPhone(digits); c.step = 'slot';
      reply = 'Perfect. I have three openings: ' +
        c.slots.map((s, i) => '(' + (i + 1) + ') ' + s.when).join(', ') +
        '. Which works for you — one, two, or three?';
      break;
    }
    case 'slot': {
      const slot = pickSlot(text, c.slots);
      if (!slot) {
        reply = 'No problem — the choices are ' + c.slots.map((s, i) => '(' + (i + 1) + ') ' + s.when).join(', ') + '. Just say one, two, or three.';
        break;
      }
      c.fields.slot = slot.when; c.step = 'confirm';
      reply = 'Let me read that back: ' + c.fields.service + ' for ' + c.fields.name + ', at ' + c.fields.address + ', ' +
        slot.when + '. Confirmation goes to ' + c.fields.phone + '. Shall I book it?';
      break;
    }
    case 'confirm': {
      if (/\b(yes|yeah|yep|book|correct|sounds good|do it|ok|okay|sure)\b/i.test(text)) {
        const booking = {
          id: uid(), callId: c.id, createdAt: new Date().toISOString(),
          name: c.fields.name, service: c.fields.service, address: c.fields.address,
          phone: c.fields.phone, slot: c.fields.slot, status: 'booked'
        };
        d.bookings.push(booking);
        c.bookingId = booking.id; c.step = 'done';
        queueAction(d, 'confirmation', booking,
          'Hi ' + booking.name.split(' ')[0] + ', this is ' + BUSINESS.businessName + ' — you\'re booked: ' +
          booking.service + ', ' + booking.slot + '. We\'ll text a reminder the day before. Reply STOP to opt out.');
        queueAction(d, 'reminder', booking,
          'Reminder from ' + BUSINESS.businessName + ': your ' + booking.service + ' appointment is tomorrow, ' +
          booking.slot.split(' at ')[1] + '. The crew will call when they\'re on the way.');
        reply = 'You\'re booked, ' + booking.name.split(' ')[0] + '. Your confirmation text is on its way to ' + booking.phone +
          ', and we\'ll remind you the day before. Anything else I can help with?';
      } else if (/\b(no|wrong|change|not)\b/i.test(text)) {
        c.step = 'slot';
        reply = 'No problem — let\'s fix the time first. The openings are ' +
          c.slots.map((s, i) => '(' + (i + 1) + ') ' + s.when).join(', ') + '. Which suits you better?';
      } else {
        reply = 'Shall I book it — yes, or would you like to change something?';
      }
      break;
    }
    default: { /* done */
      reply = 'You\'re all set. If anything changes, just call back and ask for Vesta.';
    }
  }
  c.transcript.push({ who: 'vesta', text: reply });
  writeStore(d);
  return { reply, call: c };
}

function stepPrompt(c) {
  switch (c.step) {
    case 'need': return 'What do you need help with today?';
    case 'name': return 'May I have your name?';
    case 'address': return 'What\'s the address for the work?';
    case 'phone': return 'What mobile number gets the confirmation text?';
    case 'slot': return 'I have three openings: ' + c.slots.map((s, i) => '(' + (i + 1) + ') ' + s.when).join(', ') + '.';
    case 'confirm': return 'Shall I book it?';
    default: return '';
  }
}

/* ------------------------------------------------------------------
 * KIARA — the follow-through queue. Every customer-facing message is
 * drafted as finished work for the owner: Approve / Edit / Skip.
 * Nothing sends from this prototype (see PILOT-BUILD.md seams).
 * ------------------------------------------------------------------ */
function queueAction(d, kind, booking, text) {
  d.actions.push({
    id: uid(), kind, bookingId: booking.id, text,
    status: 'pending', createdAt: new Date().toISOString(),
    forName: booking.name, forService: booking.service
  });
}

function completeJob(bookingId) {
  const d = readStore();
  const b = d.bookings.find((x) => x.id === bookingId);
  if (!b) return null;
  if (b.status === 'done') return b;
  b.status = 'done'; b.doneAt = new Date().toISOString();
  queueAction(d, 'invoice', b,
    'Hi ' + b.name.split(' ')[0] + ', thanks for choosing ' + BUSINESS.businessName + '. ' +
    'Your invoice for today\'s ' + b.service.toLowerCase() + ' is ready — the office will send the payment link right behind this note.');
  queueAction(d, 'review', b,
    'One favor, ' + b.name.split(' ')[0] + ' — if the crew earned it, a Google review helps a local business more than any ad. ' +
    'We\'ll text you the review link. Thanks again from ' + BUSINESS.businessName + '.');
  writeStore(d);
  return b;
}

/* ------------------------------------------------------------------
 * API
 * ------------------------------------------------------------------ */
app.get('/healthz', (req, res) => res.json({ ok: true, app: 'bizhaus-pilot', sendsLive: false }));

app.post('/api/call/start', (req, res) => {
  const call = startCall();
  res.json({ ok: true, callId: call.id, greeting: call.transcript[0].text, business: BUSINESS.businessName, demoLabel: BUSINESS.demoLabel });
});

app.post('/api/call/:id/say', (req, res) => {
  const d = readStore();
  const call = d.calls.find((c) => c.id === req.params.id);
  if (!call) return res.status(404).json({ ok: false, error: 'Call not found.' });
  const out = say(call, (req.body || {}).text || '');
  const booking = out.call.bookingId ? readStore().bookings.find((b) => b.id === out.call.bookingId) : null;
  res.json({ ok: true, reply: out.reply, step: out.call.step, fields: out.call.fields, needsOwner: out.call.needsOwner, booking });
});

app.get('/api/call/:id', (req, res) => {
  const call = readStore().calls.find((c) => c.id === req.params.id);
  if (!call) return res.status(404).json({ ok: false, error: 'Call not found.' });
  res.json({ ok: true, call });
});

app.post('/api/jobs/:id/complete', (req, res) => {
  const b = completeJob(req.params.id);
  if (!b) return res.status(404).json({ ok: false, error: 'Booking not found.' });
  res.json({ ok: true, booking: b });
});

app.get('/api/owner/summary', (req, res) => {
  const d = readStore();
  const pending = d.actions.filter((a) => a.status === 'pending');
  res.json({
    ok: true, business: BUSINESS.businessName,
    counts: {
      calls: d.calls.length,
      bookings: d.bookings.length,
      jobsDone: d.bookings.filter((b) => b.status === 'done').length,
      awaitingApproval: pending.length,
      approved: d.actions.filter((a) => a.status === 'approved' || a.status === 'edited').length,
      skipped: d.actions.filter((a) => a.status === 'skipped').length
    },
    actions: d.actions.slice().reverse(),
    bookings: d.bookings.slice().reverse(),
    note: 'Drafts only — sending turns on with the phone/texting service (see PILOT-BUILD.md). Approving queues the message to send the moment texting is live.'
  });
});

app.post('/api/owner/actions/:id/decide', (req, res) => {
  const { decision, text } = req.body || {};
  if (!['approve', 'edit', 'skip'].includes(decision)) {
    return res.status(400).json({ ok: false, error: 'decision must be approve, edit, or skip' });
  }
  const d = readStore();
  const a = d.actions.find((x) => x.id === req.params.id);
  if (!a) return res.status(404).json({ ok: false, error: 'Action not found.' });
  if (decision === 'approve') a.status = 'approved';
  if (decision === 'skip') a.status = 'skipped';
  if (decision === 'edit') {
    const t = String(text || '').trim().slice(0, 1000);
    if (!t) return res.status(400).json({ ok: false, error: 'edited text required' });
    a.text = t; a.status = 'edited';
  }
  a.decidedAt = new Date().toISOString();
  writeStore(d);
  res.json({ ok: true, action: a });
});

/* Demo reset — walkthrough only, clears the pilot store. */
app.post('/api/demo/reset', (req, res) => { writeStore(blankStore()); res.json({ ok: true }); });

app.use(express.static(path.join(ROOT, 'public'), {
  extensions: ['html'],
  setHeaders(res, filePath) { if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store'); }
}));
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));

app.listen(PORT, () => console.log('[bizhaus-pilot] listening on ' + PORT + ' · sendsLive=false (draft-only prototype)'));
