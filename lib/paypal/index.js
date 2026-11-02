'use strict';
/**
 * Demo-facing PayPal interface, adapting the ported staging module (checkout/payouts/webhooks.js).
 *   createOrder({ amount, currency, description }) -> { id, status, approveUrl }
 *   captureOrder(orderId)                          -> { orderId, status, captureId, captureStatus, amount }
 *   createPayout({ receiverEmail, amount, note })  -> { simulated, payoutBatchId?, status, reason? }
 *   getPayoutStatus(payoutBatchId)                 -> { payoutBatchId, status }
 *   verifyWebhook({ headers, rawBody })            -> { verified, action }
 */
const checkout = require('./checkout');
const payouts = require('./payouts');
const webhooks = require('./webhooks');
const { NotConfiguredError, UpstreamError } = require('../errors');

let fetchImpl = (...a) => fetch(...a);
function _setFetch(f) { fetchImpl = f; } // tests only

function requireCreds() {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) throw new NotConfiguredError('PayPal Sandbox (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)');
}
const wrap = (e, what) => (e instanceof checkout.PayPalError ? new UpstreamError(`${what}: ${e.message.split(':')[0]}`, e.status || 502) : e);
function money(amount) { const n = Number(amount); if (!Number.isFinite(n) || n <= 0 || n > 1000) throw new Error('amount must be between 0 and 1000'); return n; }
const ID = /^[A-Z0-9]{5,40}$/;

async function createOrder({ amount, currency = 'USD', description }) {
  requireCreds();
  try { const o = await checkout.createOrder(money(amount), { currency, description, fetchImpl }); return { id: o.id, status: o.status, approveUrl: checkout.approveUrl(o) }; }
  catch (e) { throw wrap(e, 'PayPal create order failed'); }
}
async function captureOrder(orderId) {
  if (!ID.test(String(orderId))) throw new Error('invalid order id');
  requireCreds();
  try {
    const r = await checkout.captureOrder(orderId, { fetchImpl });
    const cap = r.purchase_units?.[0]?.payments?.captures?.[0] || {};
    return { orderId: r.id, status: r.status, captureId: cap.id, captureStatus: cap.status, amount: cap.amount };
  } catch (e) { throw wrap(e, 'PayPal capture failed'); }
}
async function createPayout({ receiverEmail, amount, note }) {
  requireCreds();
  try {
    const r = await payouts.createPayout(receiverEmail, money(amount), { note, fetchImpl });
    return { simulated: false, payoutBatchId: r.batch_header?.payout_batch_id, status: r.batch_header?.batch_status };
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      return { simulated: true, status: 'SIMULATED', reason: `Simulated payout (pending sandbox Payouts access) — PayPal returned ${e.status}. No money was sent.` };
    }
    throw wrap(e, 'PayPal payout failed');
  }
}
async function getPayoutStatus(payoutBatchId) {
  if (!ID.test(String(payoutBatchId))) throw new Error('invalid payout batch id');
  requireCreds();
  try { const r = await payouts.getPayoutBatch(payoutBatchId, { fetchImpl }); return { payoutBatchId, status: r.batch_header?.batch_status }; }
  catch (e) { throw wrap(e, 'PayPal payout status failed'); }
}
async function verifyWebhook({ headers, rawBody }) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new NotConfiguredError('PayPal webhook (PAYPAL_WEBHOOK_ID)');
  requireCreds();
  const verified = await webhooks.verifySignature(headers, rawBody, webhookId, { fetchImpl });
  return { verified, action: verified ? webhooks.classify(JSON.parse(rawBody)) : null };
}
module.exports = { createOrder, captureOrder, createPayout, getPayoutStatus, verifyWebhook, _setFetch };
