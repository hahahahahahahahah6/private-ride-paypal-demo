'use strict';
// UNIT TESTS WITH MOCKED HTTP. These do NOT call PayPal or Gemini and prove nothing about real API behavior.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os'); const path = require('path'); const fs = require('fs');
const cfg = require('../lib/config');
const { baselineFare } = require('../lib/fare');
const v = require('../lib/validate');
const paypal = require('../lib/paypal');
const gemini = require('../lib/ai/gemini');
const ai = require('../lib/ai');
const ledger = require('../lib/ledger');

const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
function mockFetch(handlers) { const calls = []; return { calls, f: async (url, opts) => { calls.push({ url, opts }); for (const [re, h] of handlers) if (re.test(url)) return h(url, opts); throw new Error('unmocked ' + url); } }; }
const tok = [/oauth2\/token/, () => res(200, { access_token: 'T', expires_in: 3600 })];

test('[config] refuses non-sandbox env', () => {
  assert.throws(() => cfg.assertSandbox({ PAYPAL_ENV: 'live' }), /sandbox/);
  assert.throws(() => cfg.assertSandbox({}), /sandbox/);
  assert.doesNotThrow(() => cfg.assertSandbox({ PAYPAL_ENV: 'sandbox' }));
  assert.strictEqual(cfg.PAYPAL_API_BASE, 'https://api-m.sandbox.paypal.com');
});

test('[fare] baseline + minimum', () => {
  assert.strictEqual(baselineFare({ miles: 10, minutes: 20 }).amount, 32);
  assert.strictEqual(baselineFare({ miles: 0.5, minutes: 1 }).amount, 10);
});

test('[validate] rejects bad trip input', () => {
  assert.throws(() => v.trip({ dropoff: 'b', miles: 1, minutes: 1 }), /pickup/);
  assert.throws(() => v.trip({ pickup: 'a', dropoff: 'b', miles: 999, minutes: 1 }), /miles/);
});

test('[mock][adapter] missing credentials -> NOT_CONFIGURED, no network', async () => {
  delete process.env.PAYPAL_CLIENT_ID; delete process.env.PAYPAL_CLIENT_SECRET;
  const m = mockFetch([]); paypal._setFetch(m.f);
  await assert.rejects(paypal.createOrder({ amount: 10 }), (e) => e.code === 'NOT_CONFIGURED');
  assert.strictEqual(m.calls.length, 0);
});

test('[mock][adapter] create + capture hit sandbox endpoints', async () => {
  process.env.PAYPAL_CLIENT_ID = 'id'; process.env.PAYPAL_CLIENT_SECRET = 'secret';
  const m = mockFetch([tok,
    [/\/v2\/checkout\/orders$/, (u, o) => { assert.strictEqual(JSON.parse(o.body).purchase_units[0].amount.value, '12.50'); return res(201, { id: 'ORDER123', status: 'CREATED', approveUrl: null }); }],
    [/capture$/, () => res(201, { id: 'ORDER123', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP999', status: 'COMPLETED', amount: { value: '12.50', currency_code: 'USD' } }] } }] })]]);
  paypal._setFetch(m.f);
  assert.deepStrictEqual(await paypal.createOrder({ amount: 12.5 }), { id: 'ORDER123', status: 'CREATED', approveUrl: null });
  const c = await paypal.captureOrder('ORDER123');
  assert.strictEqual(c.captureId, 'CAP999');
  assert.ok(m.calls.every((c) => c.url.startsWith('https://api-m.sandbox.paypal.com/')));
});

test('[mock][adapter] payout 403 -> clearly simulated, never claims sent', async () => {
  const m = mockFetch([tok, [/payouts$/, () => res(403, { name: 'AUTHORIZATION_ERROR' })]]); paypal._setFetch(m.f);
  const p = await paypal.createPayout({ receiverEmail: 'x@example.com', amount: 8 });
  assert.strictEqual(p.simulated, true); assert.strictEqual(p.status, 'SIMULATED'); assert.match(p.reason, /Simulated payout/);
  assert.strictEqual(p.payoutBatchId, undefined);
});

test('[mock][adapter] payout success returns batch id', async () => {
  const m = mockFetch([tok, [/payouts$/, () => res(201, { batch_header: { payout_batch_id: 'BATCH1', batch_status: 'PENDING' } })]]); paypal._setFetch(m.f);
  assert.deepStrictEqual(await paypal.createPayout({ receiverEmail: 'x@example.com', amount: 8 }), { simulated: false, payoutBatchId: 'BATCH1', status: 'PENDING' });
});

test('[mock][adapter] webhook verify', async () => {
  process.env.PAYPAL_WEBHOOK_ID = 'WH1';
  const m = mockFetch([tok, [/verify-webhook-signature/, (u, o) => { assert.strictEqual(JSON.parse(o.body).webhook_id, 'WH1'); return res(200, { verification_status: 'SUCCESS' }); }]]); paypal._setFetch(m.f);
  assert.strictEqual((await paypal.verifyWebhook({ headers: {}, rawBody: '{"id":"E1"}' })).verified, true);
});

test('[gemini mock] missing key -> NOT_CONFIGURED; structured output; clamp; rate cap', async () => {
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(gemini.generateJson('x', {}), (e) => e.code === 'NOT_CONFIGURED');
  process.env.GEMINI_API_KEY = 'k'; gemini._resetLimits({ max: 2, perMinute: 10 });
  gemini._setFetch(async (url, o) => {
    const b = JSON.parse(o.body); assert.strictEqual(b.generationConfig.responseMimeType, 'application/json');
    assert.ok(!url.includes('key=')); // key goes in header, not URL
    return res(200, { candidates: [{ content: { parts: [{ text: '{"fareUsd":500,"confidence":"low","reasons":["test"]}' }] } }] });
  });
  const r = await ai.estimateFare({ pickup: 'a', dropoff: 'b', miles: 10, minutes: 20, when: 'now' });
  assert.strictEqual(r.ai.fareUsd, 64); assert.strictEqual(r.ai.clamped, true);
  await gemini.generateJson('x', {});
  await assert.rejects(gemini.generateJson('x', {}), (e) => e.code === 'RATE_LIMIT');
});

test('[gemini mock] dispatch rejects unknown driver', async () => {
  gemini._resetLimits({ max: 10 });
  gemini._setFetch(async () => res(200, { candidates: [{ content: { parts: [{ text: '{"driverId":"zzz","reasons":[]}' }] } }] }));
  await assert.rejects(ai.pickDriver({ pickup: 'a', dropoff: 'b', miles: 1 }, [{ id: 'd1' }]), /not in the list/);
});

test('[ledger] dedupes by event id', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'l-')), 'l.json');
  assert.strictEqual(ledger.append({ eventId: 'E1' }, f).duplicate, false);
  assert.strictEqual(ledger.append({ eventId: 'E1' }, f).duplicate, true);
  assert.strictEqual(ledger.read(f).length, 1);
});

test('[gemini mock] parse skips thought parts and strips ```json fences', () => {
  const r = gemini.parseCandidate({ candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'thinking...' }, { text: '```json\n{"en":"Hi","zh":"你好"}\n```' }] } }] });
  assert.deepStrictEqual(r, { en: 'Hi', zh: '你好' });
  assert.throws(() => gemini.parseCandidate({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"en":"cut' }] } }] }), /finishReason=MAX_TOKENS/);
});

test('[gemini mock] retries 503 then falls back to next model; reports answering model', async () => {
  process.env.GEMINI_API_KEY = 'k'; gemini._resetLimits({ max: 20, perMinute: 20 }); gemini._setSleep(async () => {});
  const prev = [process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODELS];
  process.env.GEMINI_MODEL = 'm-busy'; process.env.GEMINI_FALLBACK_MODELS = 'm-busy,m-ok';
  const calls = [];
  gemini._setFetch(async (url) => {
    const m = url.match(/models\/([^:]+):/)[1]; calls.push(m);
    if (m === 'm-busy') return res(503, { error: { status: 'UNAVAILABLE' } });
    return res(200, { candidates: [{ content: { parts: [{ text: '{"en":"E","zh":"Z"}' }] } }] });
  });
  const s = await ai.summarizeTrip({ paidUsd: 1 });
  assert.deepStrictEqual(s, { en: 'E', zh: 'Z', model: 'm-ok' });
  assert.deepStrictEqual(calls, ['m-busy', 'm-busy', 'm-ok']);
  gemini._setFetch(async () => res(400, {}));
  await assert.rejects(gemini.generateJson('x', {}), (e) => e.status === 400); // non-retryable: no fallback
  process.env.GEMINI_MODEL = prev[0] ?? ''; if (prev[0] === undefined) delete process.env.GEMINI_MODEL;
  if (prev[1] === undefined) delete process.env.GEMINI_FALLBACK_MODELS; else process.env.GEMINI_FALLBACK_MODELS = prev[1];
});

// --- trip flow regressions (mocked; no real API calls) ---
const flow = require('../lib/tripflow');
test('[flow] paid when capture-level OR order-level status is COMPLETED', () => {
  assert.ok(flow.isPaid({ status: 'COMPLETED', captureStatus: 'COMPLETED' }));
  assert.ok(flow.isPaid({ status: undefined, captureStatus: 'COMPLETED' }));
  assert.ok(flow.isPaid({ status: 'COMPLETED' }));
  assert.ok(!flow.isPaid({ status: 'APPROVED', captureStatus: 'PENDING' }));
  assert.strictEqual(flow.stageAfterCapture({ captureStatus: 'COMPLETED' }), 'paid');
  assert.strictEqual(flow.stageAfterCapture({ status: 'APPROVED', captureStatus: 'PENDING' }), 'capture_PENDING');
});
test('[flow] atLeast orders stages so re-dispatch is detectable', () => {
  assert.ok(flow.atLeast({ stage: 'dispatched' }, 'paid'));
  assert.ok(flow.atLeast({ stage: 'completed' }, 'dispatched'));
  assert.ok(!flow.atLeast({ stage: 'order_created' }, 'paid'));
  assert.ok(!flow.atLeast({ stage: 'capture_PENDING' }, 'paid'));
});
test('[paypal] createOrder returns approveUrl; captureOrder maps capture-only response', async () => {
  process.env.PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || 'x'; process.env.PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || 'y';
  const m = mockFetch([tok,
    [/orders\/[A-Z0-9]+\/capture/, () => res(201, { id: 'ORD12345', purchase_units: [{ payments: { captures: [{ id: 'CAP12345', status: 'COMPLETED', amount: { value: '95.00', currency_code: 'USD' } }] } }] })],
    [/v2\/checkout\/orders$/, () => res(201, { id: 'ORD12345', status: 'CREATED', links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORD12345' }] })]]);
  paypal._setFetch(m.f);
  const o = await paypal.createOrder({ amount: 95 });
  assert.strictEqual(o.approveUrl, 'https://www.sandbox.paypal.com/checkoutnow?token=ORD12345');
  const c = await paypal.captureOrder('ORD12345');
  assert.strictEqual(c.status, undefined);
  assert.strictEqual(flow.stageAfterCapture(c), 'paid');
});

test('[tripflow] payout status line: live EN+ZH, updates with status', () => {
  const a = flow.payoutStatusLine('PENDING'); const b = flow.payoutStatusLine('SUCCESS');
  assert.match(a.en, /PENDING/); assert.match(a.zh, /处理中/); assert.match(b.zh, /已到账/); assert.match(b.en, /SUCCESS/);
  assert.notStrictEqual(a.zh, b.zh);
  assert.match(flow.payoutStatusLine('WEIRD').zh, /未知状态/);
  assert.match(flow.payoutStatusLine(null, true).zh, /模拟放款/);
});
test('[prompts] summary prompt does not bake in payout status', () => {
  const { tripSummary } = require('../lib/ai/prompts');
  assert.match(tripSummary.prompt({ paidUsd: 95 }), /Do NOT mention the driver payout status/);
});
test('[ai] summary never states a payout status (sentences about payout/status are dropped)', async () => {
  const facts = { pickup: 'Glendora, CA', dropoff: 'LAX Terminal 4', miles: 32, paidUsd: 115, captureId: 'CAP1', driver: 'Driver A (demo)' };
  const { tripSummary } = require('../lib/ai/prompts');
  assert.doesNotMatch(JSON.stringify(facts), /status|PENDING|SUCCESS/);
  assert.match(tripSummary.prompt(facts), /Do NOT mention the driver payout status/);
  const en = ai.stripPayoutTalk('Driver A completed the trip from Glendora to LAX. The customer successfully paid $115 (capture CAP1). The driver payout is (PENDING). Smooth ride!', false);
  assert.strictEqual(en, 'Driver A completed the trip from Glendora to LAX. The customer successfully paid $115 (capture CAP1). Smooth ride!');
  const zh = ai.stripPayoutTalk('司机A完成了行程。客户已支付115美元。司机放款状态：处理中（PENDING）。', true);
  assert.strictEqual(zh, '司机A完成了行程。客户已支付115美元。');
  process.env.GEMINI_API_KEY = 'k'; gemini._resetLimits({ max: 20, perMinute: 20 });
  gemini._setFetch(async () => res(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ en: 'Trip done, $115 paid. Payout: PENDING.', zh: '行程完成，已付115美元。放款处理中。' }) }] } }] }));
  const s = await ai.summarizeTrip(facts);
  assert.strictEqual(s.en, 'Trip done, $115 paid.'); assert.strictEqual(s.zh, '行程完成，已付115美元。');
  gemini._setFetch(async () => res(200, { candidates: [{ content: { parts: [{ text: '{"en":"Payout PENDING.","zh":"放款处理中。"}' }] } }] }));
  await assert.rejects(ai.summarizeTrip(facts), /only described the payout status/);
});
