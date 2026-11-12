# private-ride · PayPal Sandbox + Gemini demo

A standalone demo for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).
private-ride is a small private car-service tool I (Hao Li) run for my dad. This repo is a **new, separate demo**. It does not connect to or share code, data, or credentials with the live private-ride service.

## Judges: start here
Hosted demo (Render free tier, Sandbox only): https://private-ride-paypal-demo.onrender.com — first load after idle may take 30–60 seconds. An empty ledger after a restart is expected.

Video (3 min): https://youtu.be/sh2zH_NRuyg

Sandbox test buyer credentials are provided in the Devpost testing instructions for judges. You can also use your own PayPal Sandbox personal account. Optional buyer email: `sb-ig6ar53637015@personal.example.com` (a Sandbox test account with test funds only, not a real PayPal account).

Run locally: copy `.env.example` to `.env`, fill in Sandbox and Gemini values, then `npm test` (30 mocked tests) and `npm start` (http://localhost:3000). Full setup is below.

Architecture in one line: the operator describes the trip in one sentence (typed or spoken, Chinese or English) and Gemini fills the form, or types it in; Gemini suggests a fare (clamped to a rule baseline); the passenger pays with PayPal Checkout; only after a COMPLETED capture does Gemini suggest a driver; when the trip is marked complete, PayPal Payouts sends the driver 80% and Gemini writes a bilingual summary; verified webhooks are recorded in a ledger.

## What it does
1. The operator (my dad) enters the trip for the passenger: pickup, dropoff, distance and time.
2. **AI fare estimate (Gemini)** shown next to a rule-based baseline fare. The AI price is clamped to 50–200% of the baseline.
3. **PayPal Checkout (Sandbox):** the server creates an Orders v2 order, and the passenger pays the AI fare with the PayPal JS SDK button and a sandbox buyer account. The server then captures the order and shows the real capture ID.
4. **Webhook:** `POST /api/webhooks/paypal` verifies the signature with PayPal. Webhook events are added only if verified; the server also logs the capture response and payout creation (JSON ledger, deduplicated by event ID).
5. **AI dispatch (Gemini):** suggests one of 3 fictional demo drivers and explains why; the app checks the ID against the driver list and assigns that suggestion.
6. **Trip complete → driver payout** via PayPal Sandbox Payouts, showing the real `payout_batch_id` and status.
   - If the sandbox app has no Payouts access, the UI says **"Simulated payout (pending sandbox Payouts access)"** and no money is claimed as sent.
7. **AI trip summary (Gemini)** in English and Simplified Chinese.

**Natural-language intake (added Nov 11, 2026).** At the top of Step 1 the operator can type or speak (browser Web Speech API, 中文 or EN; the mic button is hidden where the browser doesn't support it) one sentence such as `明天早上8点从 Glendora 到 LAX 4号航站，两个人，三件行李`. `POST /api/intake` asks Gemini to extract pickup, dropoff, pickup time (resolved against the current Los Angeles time), passengers, luggage, notes and a rough miles/minutes estimate, and lists anything missing. Guardrails: the sentence is sent as fenced, JSON-encoded data with instructions to ignore any commands inside it; the server keeps only whitelisted fields, caps string lengths, checks ranges (1–7 passengers, time within the next 90 days, 0.1–200 mi, 1–300 min) and drops anything else, including any price. The endpoint only fills the form. The operator checks the highlighted fields (miles/minutes are marked "AI estimate, editable") and still clicks "Get AI fare estimate"; the existing fare clamp and payment flow are unchanged, so the intake AI cannot set a price or move money.

## What came from before vs. new for the hackathon
- **From my staging work earlier in the hackathon (Python, private, developed during the hackathon period and committed to the private staging repo on 2026-11-01, never deployed):** the PayPal Orders create/capture, Payouts and webhook-signature-verification logic, plus its 7 mock tests. Ported one-to-one to Node (`lib/paypal/checkout.js`, `payouts.js`, `webhooks.js`), with the same behavior and the same 7 mock tests. The only deliberate changes: the live PayPal URL was removed (Sandbox lock), the injectable urllib `opener` became an injectable `fetch`, and an optional order description was added. The tests are in `test/staging-paypal.mock.test.js`. The private staging repo can be shared with judges on request.
- **New during the hackathon (this repo's first commit: Nov 1, 2026):** the sandbox-only adapter (`lib/paypal/index.js`), the ledger (the staging code only verified and classified webhook events; it did not record them), payout status polling, duplicate-request protection, all three Gemini features (fare estimate, dispatch, trip summary), the UI and the Render config.
- The live private-ride service existed before the hackathon and is untouched.

## Try the hosted demo
- URL: https://private-ride-paypal-demo.onrender.com (hosted on Render's free tier; after idle, the first request can take ~30-60 seconds while the service cold-starts).
- **Sandbox only. No real money moves.** Payments use PayPal's Sandbox environment and test accounts.
- Demo video (3 min): https://youtu.be/sh2zH_NRuyg

## Sandbox test buyer
Sandbox test buyer credentials are provided in the Devpost testing instructions for judges. You can also use your own PayPal Sandbox personal account. Optional buyer email: `sb-ig6ar53637015@personal.example.com` (a Sandbox test account with test funds only, not a real PayPal account).

## Safety
- **Sandbox only.** The app refuses to start unless `PAYPAL_ENV=sandbox`. The API base is hard-coded to `https://api-m.sandbox.paypal.com`.
- Secrets are read only from environment variables or `.env`, which is git-ignored. They are never logged.
- Missing keys show a clear "not configured" error. The running app never shows mock data.
- Gemini calls are rate-limited (10/min) and capped per server run (`AI_MAX_REQUESTS`, default 200).

## Setup
Requires Node.js 20+. No npm dependencies.

1. **PayPal sandbox app:**
   - Go to [developer.paypal.com](https://developer.paypal.com), log in and switch to **Sandbox**.
   - Open **Apps & Credentials → Create App**, choose type **Merchant**.
   - Copy the Client ID and Secret into `.env`.
2. **Sandbox accounts:** under **Testing Tools → Sandbox Accounts**, use (or create):
   - a *Personal* account as the buyer, to log in at the PayPal button;
   - another *Personal* account as the driver. Put its email in `DRIVER_SANDBOX_EMAIL`.
3. **Payouts:** in the app's settings, make sure the Payouts feature is enabled. If PayPal denies the call, the demo shows a simulated payout.
4. **Webhook:** this needs a public HTTPS URL (a deployed instance or a tunnel).
   - In your app, open **Webhooks → Add Webhook** (the hosted demo's webhook was created the same way via the REST API, `POST /v1/notifications/webhooks`).
   - Set the URL to `https://<your-host>/api/webhooks/paypal`.
   - Subscribe at least `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.PAYOUTSBATCH.SUCCESS`. These are the three types the code records; other verified events are acknowledged but not recorded.
   - Copy the Webhook ID into `PAYPAL_WEBHOOK_ID`.
5. **Gemini key:** create one at [Google AI Studio](https://aistudio.google.com/apikey) and put it in `GEMINI_API_KEY`. `GEMINI_MODEL` defaults to `gemini-3.5-flash`; on 429/500/503 or unparseable output the app retries with backoff, then tries `GEMINI_FALLBACK_MODELS` (default `gemini-3.5-flash,gemini-3.5-flash-lite`). The model that actually answered is returned as `model` and shown in the UI (see the [Gemini models page](https://ai.google.dev/gemini-api/docs/models)).

## Run
```bash
cp .env.example .env      # then fill in values yourself
npm test                  # 30 unit tests (mocked HTTP; no real API calls)
npm start                 # http://localhost:3000
```

## Deploy to Render
`render.yaml` defines a free Node web service (`npm install`, `npm start`; the server listens on `$PORT` at `0.0.0.0`). Set the secret env vars (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `GEMINI_API_KEY`, `DRIVER_SANDBOX_EMAIL`) in the Render dashboard; they are never stored in the repo.

## Tested end-to-end (real Sandbox + Gemini, Nov 1, 2026)
All IDs below are PayPal **Sandbox** IDs. No real money moved.

### Latest hosted run on Render (screen-recorded for the demo video, Nov 1, 2026, ~10:49 PM PST)
1. AI fare (Gemini `gemini-3.5-flash-lite`, the fallback model): **$115.00** vs. rule-based baseline **$86.50** (Glendora, CA → LAX T4, 32 mi, 50 min, 7:30 AM, 2 passengers).
2. PayPal Checkout (Orders v2 + JS SDK, Sandbox buyer): order `48J43089YV5812441`, capture `2MA03628YS0270542`, status **COMPLETED**, 115.00 USD.
3. AI dispatch (`gemini-3.5-flash`): suggested Driver A (demo), assigned by the app.
4. Driver payout (PayPal Payouts, Sandbox): batch `J5W34MGLLBTC2`, **$92.00** (80% of fare), PENDING → **SUCCESS** after "Refresh payout status".
5. AI trip summary (EN + ZH, for the operator) written by `gemini-3.5-flash-lite`.
6. Ledger: 5 entries: the capture, three webhooks (`CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.PAYOUTSBATCH.SUCCESS`), each `verified: true` via PayPal's `verify-webhook-signature`, plus `payout_created`.

### Earlier runs (brief)
- Hosted, ~10:36 PM PST: order `6WJ47381TS0286740` / capture `3UY63940LF868135D` / payout `25VG7TZCV6H8L` SUCCESS ($95 fare, $76 payout); same three webhooks verified.
- Hosted, ~10:05 PM PST: order `33X27905HG703194F` / capture `0CE13430E89718402` / payout `2CGXG5VF5U294` SUCCESS; same three webhooks verified. Screenshots: [`docs/hosted-full-run.png`](docs/hosted-full-run.png) (taken before the live payout-status fix, so its summary text says PENDING), [`docs/hosted-ledger.png`](docs/hosted-ledger.png).
- Local: order `2FR60181NK187013C` / capture `8NH41129SB271564W` / payout `A5E28Q49YYETQ`; a separate $1 payout test `KZWMQJRFWQJNU` reached SUCCESS.

Unit tests: `npm test` runs 30 tests (7 ported from staging + 23 new), all passing as of Nov 11, 2026. Mocked HTTP only (no real API calls).

### What failed along the way / known issues
- `gemini-3.8-flash` repeatedly returned 503 (busy), so the default is `gemini-3.5-flash` with retry and fallback; the UI shows which model answered.
- A duplicated dispatch request once caused an "unpaid trip" error; buttons now lock while waiting and duplicate requests cannot trigger a second payout.
- The AI trip summary used to bake in the payout status at creation time (e.g. PENDING). The payout status is not given to Gemini, and on Nov 11 a live run showed the model could still guess "(PENDING)", so the server now drops any summary sentence about the payout or a status word. The payout status is only shown as a separate live line (English + Chinese) that refreshes automatically and with "Refresh payout status".

## Limitations
- Fares use user-entered miles/minutes (no maps API). The three drivers are fictional stand-ins (the real operator manages a few drivers). Trip state is in memory.
- The ledger is a JSON file under `data/`. On Render's free tier the disk is ephemeral, so the ledger resets on every restart or redeploy. An empty ledger after a restart is expected, not a bug (the UI says this too). That is fine for a demo but not for production.

## License
MIT. See [LICENSE](LICENSE).
