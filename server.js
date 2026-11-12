'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./lib/config');
cfg.loadDotEnv();
try { cfg.assertSandbox(); } catch (e) { console.error(e.message); process.exit(1); }

const paypal = require('./lib/paypal');
const ai = require('./lib/ai');
const flow = require('./lib/tripflow');
const ledger = require('./lib/ledger');
const drivers = require('./lib/drivers');
const v = require('./lib/validate');

const trips = new Map(); // in-memory demo state

function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function fail(res, e) {
  const map = { NOT_CONFIGURED: 503, RATE_LIMIT: 429, UPSTREAM_ERROR: 502 };
  const code = map[e.code] || 400;
  console.error(`[error] ${e.code || 'BAD_REQUEST'}: ${e.message}`); // messages never contain secrets
  send(res, code, { error: e.message, code: e.code || 'BAD_REQUEST', details: e.details });
}
function body(req, limit = 100_000) {
  return new Promise((resolve, reject) => {
    let s = ''; req.on('data', (c) => { s += c; if (s.length > limit) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => resolve(s)); req.on('error', reject);
  });
}
const json = async (req) => { const s = await body(req); return s ? JSON.parse(s) : {}; };
function getTrip(id) { const t = trips.get(id); if (!t) throw new Error('unknown trip'); return t; }

const routes = {
  'GET /api/status': async () => ({ sandboxOnly: true, apiBase: cfg.PAYPAL_API_BASE, ...cfg.status(), paypalClientId: process.env.PAYPAL_CLIENT_ID || null }),
  'POST /api/intake': async (req) => ai.parseIntake((await json(req)).text), // fills the form only; no price, no money
  'POST /api/estimate': async (req) => {
    const trip = v.trip(await json(req));
    const est = await ai.estimateFare(trip);
    const id = crypto.randomUUID();
    trips.set(id, { id, trip, estimate: est, fareUsd: est.ai.fareUsd, stage: 'estimated' });
    return { tripId: id, ...est };
  },
  'POST /api/orders': async (req) => {
    const t = getTrip((await json(req)).tripId);
    const order = await paypal.createOrder({ amount: t.fareUsd, description: `private-ride: ${t.trip.pickup} -> ${t.trip.dropoff}` });
    t.orderId = order.id; t.stage = 'order_created';
    return { ...order, tripId: t.id };
  },
  'POST /api/capture': async (req) => {
    const { tripId } = await json(req); const t = getTrip(tripId);
    if (!t.orderId) throw new Error('no order for trip');
    if (flow.atLeast(t, 'paid')) return { ...t.capture, tripId: t.id, stage: t.stage, alreadyCaptured: true };
    const cap = await paypal.captureOrder(t.orderId);
    t.capture = cap; t.stage = flow.stageAfterCapture(cap);
    ledger.append({ type: 'capture_api_response', tripId, orderId: cap.orderId, captureId: cap.captureId, amount: cap.amount, status: cap.captureStatus, source: 'capture API (not yet webhook-verified)' });
    return { ...cap, tripId: t.id, stage: t.stage };
  },
  'POST /api/dispatch': async (req) => {
    const t = getTrip((await json(req)).tripId);
    if (t.dispatch && flow.atLeast(t, 'dispatched')) return { ...t.dispatch, stage: t.stage, alreadyDispatched: true }; // idempotent (double-click safe)
    if (t.stage !== 'paid') throw new Error(`trip must be paid before dispatch (current stage: ${t.stage})`);
    if (t.dispatching) throw new Error('dispatch already in progress');
    t.dispatching = true;
    let r;
    try { r = await ai.pickDriver(t.trip, drivers().map(({ payoutEmail, ...d }) => d)); } finally { t.dispatching = false; }
    t.dispatch = r; t.stage = 'dispatched';
    return { ...r, stage: t.stage };
  },
  'POST /api/complete': async (req) => {
    const t = getTrip((await json(req)).tripId);
    if (t.stage === 'completed') throw new Error('trip already completed (payout already sent)');
    if (t.stage !== 'dispatched') throw new Error(`trip must be dispatched first (current stage: ${t.stage})`);
    if (t.completing) throw new Error('completion already in progress');
    t.completing = true;
    try {
    const d = drivers().find((x) => x.id === t.dispatch.driver.id);
    if (!d.payoutEmail) throw Object.assign(new Error('DRIVER_SANDBOX_EMAIL is not configured (sandbox personal account email for the driver payout).'), { code: 'NOT_CONFIGURED' });
    const amount = Math.round(t.fareUsd * 0.8 * 100) / 100; // demo split: 80% to driver
    const payout = await paypal.createPayout({ receiverEmail: d.payoutEmail, amount });
    t.payout = { ...payout, amount }; t.stage = 'completed';
    ledger.append({ type: payout.simulated ? 'payout_simulated' : 'payout_created', tripId: t.id, payoutBatchId: payout.payoutBatchId || null, amount, status: payout.status });
    let summary = null, summaryError = null;
    try {
      summary = await ai.summarizeTrip({ pickup: t.trip.pickup, dropoff: t.trip.dropoff, miles: t.trip.miles, paidUsd: t.fareUsd, captureId: t.capture?.captureId, driver: d.name });
    } catch (e) { summaryError = e.message; }
    return { payout: t.payout, payoutLine: flow.payoutStatusLine(payout.status, payout.simulated), summary, summaryError, stage: t.stage };
    } finally { t.completing = false; }
  },
  'POST /api/webhooks/paypal': async (req) => {
    const raw = await body(req, 1_000_000);
    const result = await paypal.verifyWebhook({ headers: req.headers, rawBody: raw });
    if (!result.verified) return { verified: false };
    const ev = JSON.parse(raw);
    if (!result.action) return { verified: true, ignored: ev.event_type }; // staging rule: only actionable events are recorded
    const r = ledger.append(ledger.webhookEntry(ev, result.action));
    return { verified: true, action: result.action, duplicate: r.duplicate };
  },
  'GET /api/ledger': async () => ledger.read(),
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pp = url.pathname.match(/^\/api\/payouts\/([A-Z0-9]+)$/);
  try {
    if (pp && req.method === 'GET') { const st = await paypal.getPayoutStatus(pp[1]); return send(res, 200, { ...st, payoutLine: flow.payoutStatusLine(st.status, st.simulated) }); }
    const h = routes[`${req.method} ${url.pathname}`];
    if (h) return send(res, 200, await h(req));
    if (req.method === 'GET') {
      const f = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
      if (f.startsWith(path.join(__dirname, 'public')) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
        res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
        return fs.createReadStream(f).pipe(res);
      }
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { fail(res, e); }
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  server.listen(port, "0.0.0.0", () => {
    const s = cfg.status();
    console.log(`private-ride demo (SANDBOX ONLY, ${cfg.PAYPAL_API_BASE}) on http://localhost:${port}`);
    console.log(`configured: paypal=${s.paypal} webhook=${s.webhook} gemini=${s.gemini} model=${s.geminiModel}`);
  });
}
module.exports = { server, trips };
