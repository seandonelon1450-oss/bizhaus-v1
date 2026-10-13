# PILOT-BUILD — BIZHAUS pilot, first slice

**Built:** October 13, 2026 · **Status:** working prototype, verified end-to-end locally. **Spend so far: $0.**

The first slice of the closed-loop service from `SERVICE-FIRST-SETUP.md` §4 —
the demo-call experience the playbook calls "the demo is the pitch"
(`selling-the-loop-playbook.md`). A prospect calls, **VESTA answers by
voice**, the job lands booked, and **KIARA** drafts every follow-through as
finished work in the owner's morning summary: **Approve / Edit / Skip**.

---

## 1. Architecture

```
PROSPECT                                    OWNER
   │                                           │
   │  browser call (voice or typed)            │  morning summary page
   ▼                                           ▼
┌─────────────────────────────────────────────────────────────┐
│ bizhaus-pilot  (pilot/server.js — standalone Express app)   │
│                                                             │
│  VESTA  intake state machine (no external AI, $0)           │
│         need → name → address → phone → slot → confirm      │
│  KIARA  follow-through queue — drafts, never sends:         │
│         booking → confirmation + reminder drafts            │
│         job done → invoice note + review request drafts     │
│  Store  pilot/data/pilot.json (atomic file store, the       │
│         same pattern as bizhaus-v1's MCR store)              │
└─────────────────────────────────────────────────────────────┘
        │ the ONE seam that needs money (see §3)
        ▼
  Real phone number (Twilio) — voice webhook + SMS.
  bizhaus-v1/server.js ALREADY has those webhooks built,
  signature-verified, and activation-gated (MCR_LIVE).
```

**Why a separate small app instead of editing `bizhaus-v1/server.js`:**
the main server is the Missed-Call Rescue build — it *reacts* to a missed
call with a text. The pilot is the full loop (answer → book → close) and had
to be provable end-to-end without touching the gated production code. The
two meet at the telephony seam: when the Twilio number goes live, inbound
voice routes into this same intake conversation (the state machine is
transport-agnostic — it consumes text turns; a Twilio `<Gather speech>`
loop or a streaming voice bridge both feed it), and the MCR webhooks in
`bizhaus-v1` already handle the SMS side with the same draft/owner rules.

**Front end** (`pilot/public/`): Arbor design tokens (paper/ink, Fraunces +
Inter, gutter accent), honest DEMO banners on every page, footer
"Powered by Arbor · The Arbor Group · She owns her data."
- `/` — landing: both doors (be the customer / be the owner).
- `/call.html` — the call. VESTA speaks via browser speech synthesis
  (warm en-US voice preferred); the caller answers by voice
  (`SpeechRecognition`, the pattern from `vike-v1/public/js/app.js`) or by
  typing. Script chips make the walkthrough one-tap friendly. Booking
  produces an on-screen closed-loop receipt.
- `/summary.html` — the owner's morning summary: calls answered, jobs
  booked, jobs done, and every KIARA draft with **Approve / Edit / Skip**
  wired to the API. "Mark job done" on a booking fires the close-out
  drafts (invoice note + review request).

**Safety posture (unchanged from the MCR build):** this code sends
nothing — no SMS, no email, no charges. Every customer-facing message is a
labeled draft in the owner queue. Approving a draft marks it ready to send
the moment texting is activated; it does not send from the prototype.

## 2. What runs today, and where

| Piece | Status | Where |
|---|---|---|
| Intake conversation (VESTA) | ✅ works, tested | `pilot/server.js` |
| Booking into pilot calendar + 3 real next slots (Central) | ✅ works, tested | `pilot/server.js` (`nextSlots`) |
| Confirmation + reminder drafts on booking | ✅ works, tested | owner queue |
| Job-done close-out (invoice note + review request drafts) | ✅ works, tested | owner queue |
| Owner morning summary + Approve/Edit/Skip | ✅ works, tested | `/summary.html` + `/api/owner/*` |
| Human-request handoff flag ("talk to a person") | ✅ works, tested | call flagged `needsOwner` |
| Off-script questions | ✅ safe fallback | VESTA offers the service list; she answers only from config |
| Browser voice in/out | ✅ coded (needs a human ear-check in Chrome) | `/call.html` |
| Local run | ✅ verified Oct 13 | `cd pilot && npm ci && node server.js` → port 3200, `/healthz` → `{ok:true, sendsLive:false}` |

**Verification (Oct 13, scripted curl walk):** full call — greeting →
cleaning → name → address → phone → slot 2 → confirm → booking created;
summary counts correct; confirmation **approved**, reminder **edited**,
job **completed** → invoice + review drafts appeared; off-script and
human-request paths behave. All pages return 200.

**Not yet deployed.** The repo is local and unpushed (same state as
`bizhaus-v1`). Deploy is a runbook step (§4), deliberately not done from
this build: it needs the GitHub push + a Render dashboard action.

## 3. The remaining seams — exact, with cost

Everything above the line runs at $0. Below is everything between this
prototype and a real client answering real calls. Prices are the
providers' published US list prices as of Oct 2026 — re-verify at
signup; none are Arbor quotes.

### Seam 1 — The phone number (the only hard blocker)
- **Provider:** Twilio (the `bizhaus-v1` webhooks already target it).
- **Account:** free to open. **Trial is $0** (~$15 trial credit, includes a
  trial number) — good enough to test plumbing, **not** client-grade:
  trial voice calls play a "trial account" message and trial SMS only
  reaches pre-verified numbers.
- **Production number:** ≈ **$1.15/mo** per US local number.
- **Voice usage:** ≈ **$0.014/min** inbound. A 3-minute intake ≈ 4¢.
- **SMS usage:** ≈ **$0.0079/message** + carrier fees (a booking's
  confirmation + reminder ≈ 2¢).
- **A2P 10DLC (required before real SMS to customers):** brand
  registration ≈ **$4 one-time**; campaign fee ≈ **$1.50–$15/mo**
  depending on volume tier. Approval is a Sean step (business details),
  already recorded as a blocker in `bizhaus-v1/BUILD-REPORT.md`.
- **Pilot run-rate at one shop:** ≈ **$10–20/mo all-in** — covered many
  times over by the $750 setup. Still $0 until Sean says go: **no account
  was created and nothing was purchased for this build.**

### Seam 2 — A voice worth paying $399/mo for (quality, phase 2)
Browser speech synthesis proves the conversation; it is not the product
voice. On the real line, Twilio's built-in `<Say>` voice works on day one
($0 extra). The premium VESTA voice — streaming conversation with a
natural neural voice — is an add-on when the pilot converts, e.g. a
realtime voice API at roughly **$0.06–$0.30/min** of talk time, or a
neural-TTS plan from ≈ **$5/mo**. Decision deferred until a paying pilot
hears both.

### Seam 3 — Always-on hosting
Render's free tier sleeps — fatal for a phone webhook (the first ring
would wait ~50s). The live pilot needs the web service awake:
**Render Starter ≈ $7/mo** per service (the MCR build notes already flag
"paid Starter+ for anything with webhooks"). The walkthrough/demo can
stay on free tier forever.

### Seam 4 — Durable storage
Pilot store is a JSON file (fine for demos; Render's disk is ephemeral,
so a redeploy wipes walkthrough data). `bizhaus-v1` already contains the
Postgres store pattern (`pgStore`) — porting it to the pilot is a
half-day task when the first real client's data must persist. Cost: $0
on an existing database; a small dedicated Postgres ≈ **$6–7/mo**.

### Seam 5 — The summary has to reach the owner
`/summary.html` works today. Delivering it at 7 AM (the MCR build's
`dailySummary()` exists, unscheduled) needs one of: the owner's bookmark
($0), email via the already-connected Gmail on Robbie's side ($0), or a
transactional mail free tier (e.g. Resend free = 100 emails/day, $0).
Scheduling = one cron entry. No purchase in any path.

### Seam 6 — Calendar sync (optional)
The pilot books into its own calendar — that IS the calendar of record
for the pilot. Syncing to the shop's Google Calendar is a free API +
the owner's one-time Google sign-in; post-pilot nicety, not a blocker.

### Seam 7 — Getting paid
Unchanged from `bizhaus-v1`: Stripe checkout stays **invite-only** until
the standing rule passes — webhook endpoint live + one real test charge
+ refund. The $39 V.I.K.e payment link is the interim rail for manual
collection; the founder log tracks payers by hand.

### Seam 8 — Pilot business config is a code constant
`BUSINESS` in `pilot/server.js` holds the demo business. Before the real
pilot, either edit that constant (5 minutes) or port the MCR dashboard
Settings pattern (owner-editable config) into the pilot — listed here so
nobody mistakes the demo values for a settings system.

## 4. Runbook — putting All American Exteriors live

**Precondition (Sean, one short list):** the five open items in
`arbor-marketing-co/customers/all-american-exteriors/launch-note.md` —
owner's name, business phone, email, exact services, exact service area.
Nothing below invents them.

1. **Collect the five details** from the owner (Sean's conversation;
   Robbie supplies a one-page ask if wanted).
2. **Put the real business in:** set the pilot `BUSINESS` config (name,
   owner first name, services, area, hours) — 5-minute edit, or port MCR
   Settings first (Seam 8). Keep the DEMO banner until step 7 passes.
3. **Push + deploy:** push `bizhaus-v1` to GitHub (repo exists in Sean's
   account pattern; `gh` auth is live), then in Render: New Web Service →
   same repo → Root Directory `pilot` (`pilot/render.yaml` is ready) →
   plan: **Starter** (Seam 3). Health check `/healthz` must return ok.
4. **Twilio (Sean's account, Sean's card — the first real spend, ≈$10–20
   to start):** create account → buy one local number (Metairie/504) →
   complete **A2P 10DLC** brand + campaign for that number.
5. **Wire the number:** point the number's voice webhook at the pilot
   service; set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
   `TWILIO_FROM_NUMBER` in Render env for `bizhaus-v1` (MCR SMS) and the
   pilot. **Do not** set `MCR_LIVE=true` yet.
6. **End-to-end test on Sean's cell** (the standing test number,
   (225) 266-9889): call the Twilio number → VESTA answers → book a
   cleaning → confirmation **draft** appears in the summary → approve it →
   with `MCR_LIVE` still off, confirm the log shows the would-send. Then
   Sean flips `MCR_LIVE=true` and the same call produces a real text.
7. **Owner walkthrough with All American:** owner places one test call,
   opens the summary, approves one draft. Remove the DEMO banner only
   after this passes.
8. **Go live quietly:** forward the shop's missed/after-hours calls to
   the Twilio number (carrier call-forwarding code from the shop's
   existing provider — owner's phone step, ~2 minutes). Watch the summary
   daily for the first week; every draft the owner edits teaches VESTA's
   script what the shop actually sounds like.
9. **Charge only now:** per the standing rule, the $750 setup is
   collected when the loop demonstrably runs for them — not before.
   Log the payer in the founder log; the setup funds the VESTA Desk
   pilot run (see `SERVICE-FIRST-SETUP.md` §2).

## 5. What this build deliberately did NOT do

- No Twilio (or any) account created; no number bought; **$0 spent.**
- No external sends of any kind — every message is a draft in the owner
  queue, by design and by Sean's approval gates.
- No deploy, no git push — both are visible, one-step runbook actions
  for Sean/the parent agent, not silent side effects of a build task.
- No real business details invented for All American Exteriors — the
  five launch-note items remain open and are step 1 of the runbook.
- No Stripe activation — invite-only rule untouched.
