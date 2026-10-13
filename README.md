# BIZHAUS™ v1 — Priority 2 build (MUSE-HANDOFF §9C)

**Never lose a job to a missed call.** One codebase; websites + Missed-Call
Rescue text-back for local service businesses. Trades are re-skinned via the
`?brand=` query param with zero code changes.

## Trades (one codebase, JSON-driven)

`?brand=` selects: `bizhaus` (default) · `gutterhaus` · `airhaus` · `glowhaus`.
Content lives in `/public/trades/*.json`; accents come from CSS variables on
`html[data-trade]`. Switching the param re-skins the same pages — no code changes.

GUTTERHAUS (§9C): hero "Rain goes where it should. Your house stays dry." ·
Free estimate CTA · services · before/after (CSS slices mask, illustrated —
real photos coming soon) · service area · reviews honestly labeled
"No reviews yet — check back soon" · missed-call text-back · powered-by footer.
Name/phone/area are labeled **Example** placeholders — Sean's friend's real
details are pending. Never invent a real business.

## Missed-Call Rescue MVP (wired, NOT activated)

- `POST /webhooks/twilio/voice` — missed-call handler. Verifies
  `X-Twilio-Signature` (403 on invalid); hangs up; auto-texts once per caller
  per 12h with business name, booking link, "Reply STOP to opt out".
- `POST /webhooks/twilio/sms` — inbound. STOP/HELP honored (STOP blocks all
  future texts); 10-turn auto-reply cap per 24h; replies answered ONLY from the
  business config (`config/mcr-business.json` → dashboard Settings), otherwise
  hands off to the owner.
- Owner dashboard `/dashboard.html`: inbox (take-over/resume, reply as owner),
  calls, bookings, settings, 24h summary. Gated by `BIZHAUS_ADMIN_TOKEN`.
- `dailySummary()` runs the 7 AM Central summary — implemented, NOT scheduled.
  Wire a cron to call `app.locals.dailySummary()`. No mailer configured yet.

**Activation safety:** outbound SMS is impossible unless `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` are all set AND `MCR_LIVE=true`.
Otherwise the server logs "would send: …" and skips. A2P 10DLC approval is NOT
done — Sean blocker. No real SMS and no charges may occur from this build.

**Stripe:** `$299 setup + $149/mo`, 14-day trial — code only, no keys. Checkout
UI shows "Request an invite" (`POST /api/invites`) per brief non-negotiable #9.

## Storage

Postgres when `DATABASE_URL` is set (`pg` is installed; tables auto-created on
boot), else a local JSON file store (`data/mcr.json`). Render disk is ephemeral
— export regularly.

## Data charter

§7 word-for-word on every product + `/data.html` with working one-tap Export
(`GET /api/data/export`, owner token) and Delete (`POST /api/data/delete`).

## Pages

`/` (trade home) · `/missed-call-rescue.html` (scrollytelling "how it works") ·
`/data.html` · `/dashboard.html` · `/healthz` · `/api/health`.

## Run

```
npm ci
node server.js            # reads PORT; /healthz → {ok:true}
```

## Deploy

`render.yaml`: Render native Node web service `bizhaus-v1`, `npm ci` →
`node server.js`, autoDeploy, health check `/healthz`. Secrets only in the
Render dashboard — see `.env.example` (placeholders only).
