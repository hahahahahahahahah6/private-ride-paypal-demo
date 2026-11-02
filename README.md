# private-ride · PayPal Sandbox + Gemini demo

A standalone demo for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).
private-ride is a small private car-service tool I (Hao Li) run for my dad. This repo is a **new, separate demo**. It does not connect to or share code, data, or credentials with the live private-ride service.

## What it does
1. Passenger enters pickup, dropoff, distance and time.
2. **AI fare estimate (Gemini)** shown next to a rule-based baseline fare. The AI price is clamped to 50–200% of the baseline.
3. **PayPal Checkout (Sandbox):** the server creates an Orders v2 order, and the passenger pays with the PayPal JS SDK button and a sandbox buyer account. The server then captures the order and shows the real capture ID.
4. **Webhook:** `POST /api/webhooks/paypal` verifies the signature with PayPal and writes the event to a JSON ledger (deduplicated by event ID).
5. **AI dispatch (Gemini):** picks one of 3 fictional demo drivers and explains why.
6. **Trip complete → driver payout** via PayPal Payouts (Sandbox), showing the real `payout_batch_id` and status.
   - If the sandbox app has no Payouts access, the UI says **"Simulated payout (pending sandbox Payouts access)"** and no money is claimed as sent.
7. **AI trip summary (Gemini)** in English and Simplified Chinese.

## What came from before vs. new for the hackathon
- **From my earlier staging work (Python, never deployed):** the PayPal Orders create/capture, Payouts and webhook-signature-verification logic, plus its 7 mock tests. For this demo it was ported one-to-one to Node (`lib/paypal/checkout.js`, `payouts.js`, `webhooks.js`, `test/staging-paypal.mock.test.js`).
- **New during the hackathon (Oct 2026 onward):** the sandbox-only adapter (`lib/paypal/index.js`), the ledger (the staging code only verified and classified webhook events; it did not record them), payout status polling, duplicate-request protection, all three Gemini features (fare estimate, dispatch, trip summary), the UI and the Render config.
- The live private-ride service existed before the hackathon and is untouched.

## Try the hosted demo
- URL: `<RENDER_URL>` (hosted on Render's free tier; the first request after idle can take ~1 minute to wake up).
- **Sandbox only. No real money moves.** Payments use PayPal's Sandbox environment and test accounts.

## Sandbox test buyer
Use this PayPal **Sandbox** test account at the PayPal button (it is not a real PayPal account and holds only test funds):
- Email: `sb-ig6ar53637015@personal.example.com`
- Password: `<SANDBOX_BUYER_PASSWORD — added before submission>`

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
   - In your app, open **Webhooks → Add Webhook**.
   - Set the URL to `https://<your-host>/api/webhooks/paypal`.
   - Select `PAYMENT.CAPTURE.COMPLETED` and the `PAYMENT.PAYOUTS-ITEM.*` events.
   - Copy the Webhook ID into `PAYPAL_WEBHOOK_ID`.
5. **Gemini key:** create one at [Google AI Studio](https://aistudio.google.com/apikey) and put it in `GEMINI_API_KEY`. `GEMINI_MODEL` defaults to `gemini-3.5-flash`; on 429/500/503 or unparseable output the app retries with backoff, then tries `GEMINI_FALLBACK_MODELS` (default `gemini-3.5-flash,gemini-3.5-flash-lite`). The model that actually answered is returned as `model` and shown in the UI (see the [Gemini models page](https://ai.google.dev/gemini-api/docs/models)).

## Run
```bash
cp .env.example .env      # then fill in values yourself
npm test                  # unit tests (mocked HTTP; no real API calls)
npm start                 # http://localhost:3000
```

## Deploy to Render
`render.yaml` defines a free Node web service (`npm install`, `npm start`; the server listens on `$PORT` at `0.0.0.0`). Set the secret env vars (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `GEMINI_API_KEY`, `DRIVER_SANDBOX_EMAIL`) in the Render dashboard; they are never stored in the repo.

## Tested end-to-end (real Sandbox + Gemini, Nov 1, 2026)
One full run in the browser UI with real PayPal Sandbox and Gemini API calls (screenshots in [`docs/`](docs/)):
1. AI fare (Gemini `gemini-3.5-flash`): **$95.00** vs. rule-based baseline **$86.50** (Glendora, CA → LAX T4, 32 mi, 7:30 AM). [`docs/ui-1-estimate.png`](docs/ui-1-estimate.png)
2. PayPal Checkout (Sandbox buyer): order `2FR60181NK187013C`, capture `8NH41129SB271564W`, status **COMPLETED**, $95.00 USD. [`docs/ui-2-capture.png`](docs/ui-2-capture.png)
3. AI dispatch: Driver A (demo), rated 4.9, 6 min away; Driver C was unavailable. [`docs/ui-3-dispatch.png`](docs/ui-3-dispatch.png)
4. Driver payout (PayPal Payouts, Sandbox): batch `A5E28Q49YYETQ`, **$76.00** (80% of fare), status PENDING → PROCESSING. This is a real sandbox payout, not simulated. [`docs/ui-4-payout-summary.png`](docs/ui-4-payout-summary.png)
5. AI trip summary in English and Simplified Chinese, containing the real capture ID and payout status.

Separately, a $1 sandbox payout test (batch `KZWMQJRFWQJNU`) went PENDING → PROCESSING → **SUCCESS** in about 20 seconds.

Unit tests: `npm test` uses mocked HTTP only (no real API calls).

What failed or is not yet verified:
- **Webhook verification has not been tested live yet**: it needs the deployed public URL and a sandbox webhook ID.
- During testing, `gemini-3.8-flash` repeatedly returned 503 (busy), so the default is `gemini-3.5-flash` with retry and fallback. A first run showed an "unpaid trip" error caused by a duplicated dispatch request; buttons now lock while waiting and duplicate requests cannot trigger a second payout.

## Limitations
- Fares use user-entered miles/minutes (no maps API). Drivers are fictional. Trip state is in memory.
- The ledger is a JSON file under `data/`. On Render's free tier the disk is ephemeral, so the ledger resets on every restart or redeploy. That is fine for a demo but not for production.

## License
MIT. See [LICENSE](LICENSE).
