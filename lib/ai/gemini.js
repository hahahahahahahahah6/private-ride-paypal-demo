'use strict';
// Gemini REST client with structured JSON output, retry/backoff and model fallback.
// Docs: https://ai.google.dev/api/generate-content  (POST v1beta/models/{model}:generateContent)
//       https://ai.google.dev/gemini-api/docs/structured-output (responseMimeType + responseJsonSchema)
const { NotConfiguredError, UpstreamError } = require('../errors');

let fetchImpl = (...a) => fetch(...a);
function _setFetch(f) { fetchImpl = f; }
let sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function _setSleep(f) { sleep = f; }

const DEFAULT_MODEL = 'gemini-3.5-flash';
const DEFAULT_FALLBACKS = 'gemini-3.5-flash,gemini-3.5-flash-lite';
const RETRY_STATUS = new Set([429, 500, 503]);
const ATTEMPTS_PER_MODEL = 2;

// Protect the key: global cap + simple per-minute window (counts every HTTP call, incl. retries).
const limits = { max: Number(process.env.AI_MAX_REQUESTS || 200), perMinute: 10, used: 0, window: [] };
function _resetLimits(o = {}) { Object.assign(limits, { used: 0, window: [] }, o); }
function checkLimit() {
  const now = Date.now();
  limits.window = limits.window.filter((t) => now - t < 60_000);
  if (limits.used >= limits.max) throw Object.assign(new Error('AI request cap reached for this server run'), { code: 'RATE_LIMIT' });
  if (limits.window.length >= limits.perMinute) throw Object.assign(new Error('Too many AI requests, wait a minute'), { code: 'RATE_LIMIT' });
  limits.used++; limits.window.push(now);
}

function modelList(env = process.env) {
  const list = [env.GEMINI_MODEL || DEFAULT_MODEL, ...(env.GEMINI_FALLBACK_MODELS || DEFAULT_FALLBACKS).split(',')]
    .map((s) => s.trim()).filter(Boolean);
  for (const m of list) if (!/^[\w.-]{3,80}$/.test(m)) throw new Error('invalid Gemini model name');
  return [...new Set(list)];
}

// Extract JSON from a candidate: skip thought parts, strip ```json fences.
function parseCandidate(data) {
  const cand = data.candidates?.[0];
  const parts = cand?.content?.parts || [];
  let text = parts.filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1];
  try { return JSON.parse(text); } catch {
    const why = cand?.finishReason && cand.finishReason !== 'STOP' ? ` (finishReason=${cand.finishReason})` : '';
    throw new UpstreamError(`Gemini returned non-JSON output${why}`, 502, { finishReason: cand?.finishReason || null, textLength: text.length });
  }
}

async function callOnce(model, key, prompt, schema) {
  checkLimit();
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      // 4096: thinking models spend output tokens on thoughts; 1024 truncated the bilingual summary.
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: 4096 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new UpstreamError(`Gemini request failed (${res.status})`, res.status, { message: data.error?.status });
  return parseCandidate(data);
}

// Returns { data, model } — model is the one that actually answered.
async function generateJsonWithModel(prompt, schema) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new NotConfiguredError('Gemini (GEMINI_API_KEY)');
  const models = modelList();
  let last;
  for (const model of models) {
    for (let i = 0; i < ATTEMPTS_PER_MODEL; i++) {
      try { return { data: await callOnce(model, key, prompt, schema), model }; } catch (e) {
        last = e;
        if (e.code === 'RATE_LIMIT') throw e;
        const retryable = RETRY_STATUS.has(e.status) || /non-JSON/.test(e.message);
        if (!retryable) { if (e.status === 404) break; throw e; }
        if (i < ATTEMPTS_PER_MODEL - 1) await sleep(1000 * 2 ** i + Math.floor(Math.random() * 250));
      }
    }
  }
  throw last;
}
async function generateJson(prompt, schema) { return (await generateJsonWithModel(prompt, schema)).data; }

module.exports = { generateJson, generateJsonWithModel, parseCandidate, modelList, _setFetch, _setSleep, _resetLimits };
