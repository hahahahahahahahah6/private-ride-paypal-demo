'use strict';
// Loads .env (no dependency) and enforces Sandbox-only. Never logs secret values.
const fs = require('fs');
const path = require('path');

function loadDotEnv(file = path.join(__dirname, '..', '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Hard-coded: this demo can never reach live PayPal.
const PAYPAL_API_BASE = 'https://api-m.sandbox.paypal.com';

function assertSandbox(env = process.env) {
  if (env.PAYPAL_ENV !== 'sandbox') {
    throw new Error('Refusing to start: PAYPAL_ENV must be exactly "sandbox". This demo never uses live PayPal.');
  }
}

function status(env = process.env) {
  const has = (k) => Boolean(env[k] && env[k].trim());
  return {
    paypal: has('PAYPAL_CLIENT_ID') && has('PAYPAL_CLIENT_SECRET'),
    webhook: has('PAYPAL_WEBHOOK_ID'),
    gemini: has('GEMINI_API_KEY'),
    geminiModel: env.GEMINI_MODEL || 'gemini-3.5-flash',
    geminiFallbacks: env.GEMINI_FALLBACK_MODELS || 'gemini-3.5-flash,gemini-3.5-flash-lite',
  };
}

module.exports = { loadDotEnv, assertSandbox, status, PAYPAL_API_BASE };
