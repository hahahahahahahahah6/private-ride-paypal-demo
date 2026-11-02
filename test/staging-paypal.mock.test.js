'use strict';
// MOCK TESTS ported 1:1 from paypal-ride-staging/tests/test_paypal.py (7 tests). No network, no secrets.
const test = require('node:test');
const assert = require('node:assert');
const checkout = require('../lib/paypal/checkout');
const payouts = require('../lib/paypal/payouts');
const webhooks = require('../lib/paypal/webhooks');

function fakeFetchFactory(captured, body) {
  return async (url, opts = {}) => {
    captured.push({ url, data: opts.body ?? null });
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
}

test('[mock][staging] create_order posts CAPTURE intent', async () => {
  const cap = [];
  const out = await checkout.createOrder(23.5, { token: 'T', fetchImpl: fakeFetchFactory(cap, { id: 'ORD-1', links: [{ rel: 'approve', href: 'https://x/approve' }] }) });
  assert.strictEqual(out.id, 'ORD-1');
  assert.strictEqual(checkout.approveUrl(out), 'https://x/approve');
  const payload = JSON.parse(cap[0].data);
  assert.strictEqual(payload.intent, 'CAPTURE');
  assert.strictEqual(payload.purchase_units[0].amount.value, '23.50');
});

test('[mock][staging] capture_order url', async () => {
  const cap = [];
  const out = await checkout.captureOrder('ORD-1', { token: 'T', fetchImpl: fakeFetchFactory(cap, { status: 'COMPLETED' }) });
  assert.strictEqual(out.status, 'COMPLETED');
  assert.ok(cap[0].url.endsWith('/v2/checkout/orders/ORD-1/capture'));
});

test('[mock][staging] token requires credentials', async () => {
  const saved = { ...process.env }; delete process.env.PAYPAL_CLIENT_ID; delete process.env.PAYPAL_CLIENT_SECRET;
  try { await assert.rejects(checkout.getAccessToken(), checkout.PayPalError); } finally { Object.assign(process.env, saved); }
});

test('[mock][staging] payout payload single driver item', async () => {
  const cap = [];
  const out = await payouts.createPayout('driver@example.com', 19.2, { token: 'T', fetchImpl: fakeFetchFactory(cap, { batch_header: { payout_batch_id: 'B1' } }) });
  assert.strictEqual(out.batch_header.payout_batch_id, 'B1');
  const item = JSON.parse(cap[0].data).items[0];
  assert.strictEqual(item.receiver, 'driver@example.com');
  assert.strictEqual(item.amount.value, '19.20');
});

test('[mock][staging] payout rejects bad email', async () => {
  await assert.rejects(payouts.createPayout('not-an-email', 5, { token: 'T', fetchImpl: fakeFetchFactory([], {}) }), payouts.PayPalError);
});

test('[mock][staging] classify known and unknown', () => {
  assert.strictEqual(webhooks.classify({ event_type: 'PAYMENT.CAPTURE.COMPLETED' }), 'payment_completed');
  assert.strictEqual(webhooks.classify({ event_type: 'PAYMENT.PAYOUTSBATCH.SUCCESS' }), 'payout_completed');
  assert.strictEqual(webhooks.classify({ event_type: 'SOMETHING.ELSE' }), null);
});

test('[mock][staging] verify success and failure', async () => {
  const ok = await webhooks.verifySignature({}, '{"event_type":"X"}', 'WH-1', { token: 'T', fetchImpl: fakeFetchFactory([], { verification_status: 'SUCCESS' }) });
  const bad = await webhooks.verifySignature({}, '{"event_type":"X"}', 'WH-1', { token: 'T', fetchImpl: fakeFetchFactory([], { verification_status: 'FAILURE' }) });
  assert.strictEqual(ok, true);
  assert.strictEqual(bad, false);
});
