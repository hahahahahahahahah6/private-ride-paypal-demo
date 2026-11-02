'use strict';
// Ported from paypal-ride-staging/paypal/webhooks.py.
// Docs: https://developer.paypal.com/docs/api/webhooks/v1/#verify-webhook-signature
// Rule: never trust a webhook body on its own; verify with PayPal before any ledger write.
const { baseUrl, getAccessToken } = require('./checkout');

const ACTIONABLE = {
  'CHECKOUT.ORDER.APPROVED': 'order_approved',
  'PAYMENT.CAPTURE.COMPLETED': 'payment_completed',
  'PAYMENT.PAYOUTSBATCH.SUCCESS': 'payout_completed',
};
const classify = (event) => ACTIONABLE[event?.event_type] ?? null;

async function verifySignature(headers, body, webhookId, { token, fetchImpl = fetch } = {}) {
  token = token || await getAccessToken({ fetchImpl });
  const h = (k) => headers[k] || '';
  try {
    const payload = { auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'), transmission_sig: h('paypal-transmission-sig'), transmission_time: h('paypal-transmission-time'), webhook_id: webhookId, webhook_event: JSON.parse(body) };
    const res = await fetchImpl(baseUrl() + '/v1/notifications/verify-webhook-signature', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
    if (!res.ok) return false;
    return (await res.json()).verification_status === 'SUCCESS';
  } catch { return false; } // staging behavior: network/parse errors -> not verified
}
module.exports = { ACTIONABLE, classify, verifySignature };
