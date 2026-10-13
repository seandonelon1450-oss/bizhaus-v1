# BUILD-REPORT — bizhaus-v1 (Priority 2, MUSE-HANDOFF §9C)

Built 2026-10-10 by the Arbor build worker. The old AI-migration-concierge
concept in this repo was removed (brief supersedes it): deleted consult.html,
partners.html, contact.html, consultants.html, motion.css/js, public/js/,
styles.css, data/opportunities.json, data/consultants.json.

## What changed

- **server.js (rewritten):** Express + static site; `GET /healthz` → `{ok:true}`
  (kept `/api/health`); Twilio voice + SMS webhooks with HMAC-SHA1 signature
  verification (403 on invalid); activation-gated outbound SMS (impossible
  unless `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` all
  set AND `MCR_LIVE=true` — otherwise logs `would send: …` and skips);
  STOP/HELP handling; 1 auto-text per caller per 12h; 10-turn cap per 24h;
  replies answered ONLY from the business config, else owner handoff; owner
  dashboard API (inbox/take-over/resume/calls/bookings/settings/summary,
  token-gated); `dailySummary()` implemented, NOT scheduled
  (call `app.locals.dailySummary()` from a cron); Stripe checkout endpoint
  returns invite-only (no live keys, no charges possible); Stripe webhook
  receiver is inert (501 until activation); data Export/Delete endpoints;
  idempotent webhooks (`webhook_events`); cookieless analytics kept.
- **Storage:** `pg` installed (`npm install pg@8.13.1`). **Postgres when
  `DATABASE_URL` is set** (tables auto-created on boot), else local JSON file
  store (`data/mcr.json`). Render disk is ephemeral — export regularly.
- **Front end (rewritten):** `design.css` (Arbor tokens §10: paper/ink,
  Fraunces + Inter via Google Fonts, type scale, 8pt spacing, radii, shadows,
  motion tokens, dark theme via OS + toggle, reduced-motion fallbacks);
  `brand.js` (brand engine — `?brand=` switches `html[data-trade]`,
  per-trade CSS accent vars, all content rendered from
  `public/trades/*.json`); `index.html` (home, all sections JSON-driven);
  `missed-call-rescue.html` (scrollytelling "how it works", CSS
  scroll-driven animation + reduced-motion list fallback);
  `data.html` (charter word-for-word + working one-tap Export/Delete);
  `dashboard.html` (owner dashboard, token gate).
- **Trades:** bizhaus (#3A4BA0), gutterhaus + airhaus (#1F6584),
  glowhaus (#A84B2A) — accents per brief, applied via CSS variables.
- **Ops:** `render.yaml` (Node web service `bizhaus-v1`, `npm ci`,
  `node server.js`, autoDeploy, `/healthz`); `.github/workflows/ci.yml`
  (fails on the forbidden hosting string, node syntax check);
  `.gitignore` (node_modules, .env, *.log, data/*.json, hidden/);
  `.env.example` (placeholder keys only, no values).
- Git: initialized, committed locally. **NOT pushed** (GitHub auth paused).

## §9C checklist — status per item

- [x] One codebase; trades via brand attribute + per-trade JSON
      (bizhaus/gutterhaus/airhaus/glowhaus). Verified: `?brand=` changes
      accent + all content with zero code changes (JSON + CSS vars only;
      body markup contains no hardcoded brand strings — only the `<title>`
      fallback, which brand.js overwrites per trade).
- [x] Missed-Call Rescue MVP: Twilio missed call → text with business name,
      booking link, "Reply STOP to opt out"; replies ONLY from business
      config (hours/area/price ranges/faqs), else owner handoff; 1 auto-text
      per caller per 12h; 10-turn cap; owner dashboard (inbox, take-over/
      resume, calls, bookings, settings); 7 AM Central summary implemented,
      not scheduled; Stripe $299 + $149/mo + 14-day trial as code only —
      UI is "Request an invite" everywhere; Postgres on Render when
      DATABASE_URL set.
- [x] A2P 10DLC: recorded as Sean blocker (see below). STOP/HELP honored;
      one auto-text per missed call; no marketing follow-ups in code.
- [x] `/missed-call-rescue` page with scrollytelling "how it works".
- [x] GUTTERHAUS template: hero "Rain goes where it should. Your house
      stays dry." · Free estimate CTA · services · before/after with CSS
      "slices" mask reveal (illustrated panels, labeled as illustrations —
      real photos coming soon) · service area · reviews honestly
      "No reviews yet — check back soon" · missed-call text-back section ·
      powered-by footer. Name/phone/area labeled **Example** placeholders.
- [x] BIZHAUS home: "Never lose a job to a missed call." Never leads with
      AI. No fear words. No avoid-list words (one instance of "seamless"
      found in "Seamless gutters" was reworded to comply).
- [x] Data charter §7 word-for-word on the site + `/data` page with working
      Export and Delete (owner token; nothing faked).
- [x] Footer everywhere: pill badge (arch-mark SVG + "powered by Arbor") +
      "Powered by Arbor · The Arbor Group · She owns her data."
- [x] FAQ "Does Arbor use AI?" answered plainly and honestly.
- [x] No ephemeral-registry references anywhere (grep clean; CI fails on it). No ® anywhere
      (™ only). "The Arbor Group" never presented as a law firm. No
      invented businesses, reviews, stats, or testimonials. No secrets in
      code (`.env.example` placeholders only; no `.env` file exists).

## Verification results

- `node --check server.js` + `brand.js`: PASS
- `node server.js` boots; `GET /healthz` → 200 `{ok:true}`: PASS
- `?brand=gutterhaus` vs `?brand=glowhaus`: different accents
  (#1F6584 vs #A84B2A) and different headlines/content, purely from JSON: PASS
- Twilio webhooks: valid signature → 200 + simulated "would send" (not
  live); duplicate CallSid → idempotent (no second text); bad signature →
  403 (voice and sms): PASS
- STOP → opted out, no further texts; HELP → business info; hours question
  → answered from config; unknown question → owner handoff: PASS
- `POST /api/billing/checkout` → invite-only, no charge path: PASS
- Ephemeral-registry grep (excl. node_modules/.git): nothing: PASS
- grep avoid-list words: nothing: PASS; grep ®: nothing: PASS
- grep secret patterns (`sk_live`, `AC…`, tokens): nothing: PASS
- Live-browser render of the `?brand=` re-skin: NOT verifiable by this
  worker (no live browser); verified at the data layer (JSON content +
  CSS vars + brand.js wiring). Parent can confirm visually.

## Sean-blockers (need Sean, do not guess)

1. **A2P 10DLC approval** — NOT done. No real SMS may be sent until
   approved. Activation additionally needs his explicit go-ahead.
2. **Twilio credentials** — `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   `TWILIO_FROM_NUMBER` (set in Render env, never in code). Until then,
   everything logs "would send" only.
3. **Stripe keys + webhook** — `STRIPE_SECRET_KEY`, price IDs, webhook
   secret; no checkout until webhook + one real test charge + refund pass
   (brief #9). UI stays "Request an invite".
4. **Gutter friend's real business details** — name, phone, service area.
   The template ships with labeled Example placeholders.
5. **Daily-summary scheduling + email delivery** — `dailySummary()` is
   implemented; wire a 7 AM Central cron to call it, and choose/configure
   a mailer (none configured — summary is logged/returned only).
6. **Arbor Technologies site URL** — the powered-by badge links to `#`
   until the URL exists.

## Follow-ups (not blockers)

- Self-host Fraunces + Inter as WOFF2 (Google Fonts link used for now).
- Paid Render instance for the webhook service (brief: paid Starter+ for
  anything with webhooks).
- Phone-number validation/normalization on inbound (E.164) before activation.
