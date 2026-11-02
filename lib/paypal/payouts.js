'use strict';
// Ported from paypal-ride-staging/paypal/payouts.py. Docs: https://developer.paypal.com/docs/api/payments.payouts-batch/v1/
// Payouts is restricted; until approved, the caller must record "simulated/pending", never "paid".
const crypto = require('crypto');
const { PayPalError, baseUrl, getAccessToken } = require('./checkout');

async function createPayout(receiverEmail, amountUsd, { note = 'Ride payout', currency = 'USD', token, fetchImpl = fetch } = {}) {
  if (!receiverEmail || !receiverEmail.includes('@')) throw new PayPalError('driver PayPal email required for payout');
  token = token || await getAccessToken({ fetchImpl });
  const payload = {
    sender_batch_header: { sender_batch_id: `ride-${crypto.randomBytes(8).toString('hex')}`, email_subject: 'Your ride payout is on its way' },
    items: [{ recipient_type: 'EMAIL', receiver: receiverEmail, note, amount: { value: Number(amountUsd).toFixed(2), currency } }],
  };
  const res = await fetchImpl(baseUrl() + '/v1/payments/payouts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (!res.ok) {
    // 403 here is the classic "Payouts not enabled" signal.
    const err = new PayPalError(`Payouts failed (${res.status}); if 403, Payouts is not yet approved on this app: ${text.slice(0, 400)}`);
    err.status = res.status; throw err;
  }
  return JSON.parse(text);
}

// CHANGE: added (not in staging) — GET batch status, needed by the demo's "refresh payout status".
async function getPayoutBatch(batchId, { token, fetchImpl = fetch } = {}) {
  token = token || await getAccessToken({ fetchImpl });
  const res = await fetchImpl(`${baseUrl()}/v1/payments/payouts/${batchId}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) { const err = new PayPalError(`Payout status failed (${res.status})`); err.status = res.status; throw err; }
  return res.json();
}

module.exports = { createPayout, getPayoutBatch, PayPalError };
