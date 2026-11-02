'use strict';
// Ported from Hao's staging module paypal-ride-staging/paypal/checkout.py (commit f4a4af2), Python -> Node.
// Docs: https://developer.paypal.com/api/rest/authentication/ , https://developer.paypal.com/docs/api/orders/v2/
// Every function takes an explicit `fetchImpl` (staging: `opener`) so tests can inject a fake.
const { PAYPAL_API_BASE } = require('../config');

// CHANGE vs staging: staging switched to https://api-m.paypal.com when PAYPAL_ENV=live.
// The demo is sandbox-locked, so the live base was removed entirely.
const SANDBOX_BASE = PAYPAL_API_BASE;
class PayPalError extends Error {}
const baseUrl = () => SANDBOX_BASE;

async function post(path, payload, token, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(baseUrl() + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
  } catch (e) { throw new PayPalError(`PayPal ${path} unreachable: ${e.message}`); }
  const text = await res.text();
  if (!res.ok) { const err = new PayPalError(`PayPal ${path} failed: ${res.status} ${text.slice(0, 300)}`); err.status = res.status; throw err; }
  return JSON.parse(text);
}

async function getAccessToken({ clientId, secret, fetchImpl = fetch } = {}) {
  clientId = clientId || process.env.PAYPAL_CLIENT_ID || '';
  secret = secret || process.env.PAYPAL_CLIENT_SECRET || '';
  if (!clientId || !secret) throw new PayPalError('PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set');
  const res = await fetchImpl(baseUrl() + '/v1/oauth2/token', { method: 'POST', body: 'grant_type=client_credentials', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64') }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new PayPalError(`PayPal token failed: ${res.status}`);
  return (await res.json()).access_token;
}

async function createOrder(amountUsd, { currency = 'USD', description, token, fetchImpl = fetch } = {}) {
  token = token || await getAccessToken({ fetchImpl });
  const unit = { amount: { currency_code: currency, value: Number(amountUsd).toFixed(2) } };
  if (description) unit.description = String(description).slice(0, 127); // CHANGE: optional description (demo shows route)
  return post('/v2/checkout/orders', { intent: 'CAPTURE', purchase_units: [unit] }, token, fetchImpl);
}

async function captureOrder(orderId, { token, fetchImpl = fetch } = {}) {
  token = token || await getAccessToken({ fetchImpl });
  return post(`/v2/checkout/orders/${orderId}/capture`, {}, token, fetchImpl);
}

function approveUrl(order) { return (order.links || []).find((l) => l.rel === 'approve')?.href || null; }

module.exports = { PayPalError, baseUrl, getAccessToken, createOrder, captureOrder, approveUrl, SANDBOX_BASE };
