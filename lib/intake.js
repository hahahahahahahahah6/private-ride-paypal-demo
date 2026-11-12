'use strict';
// Natural-language trip intake: validation/normalization of Gemini's extraction (pure, unit-tested).
// Gemini only proposes form values. It never sees or returns a price, and nothing here moves money:
// the operator reviews the filled form and still clicks "Get AI fare estimate" (same guardrails as before).
const TZ = 'America/Los_Angeles';
const MAX_TEXT = 500;

function inputText(v) {
  if (typeof v !== 'string') throw new Error('text is required');
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length < 4) throw new Error('Please describe the trip in a sentence (where from, where to, when).');
  if (t.length > MAX_TEXT) throw new Error(`text too long (max ${MAX_TEXT} characters)`);
  return t;
}
function cleanStr(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>`]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s || /^(null|none|unknown|n\/a|未知|无)$/i.test(s) || /https?:\/\//i.test(s)) return null;
  return s.slice(0, max);
}
function intIn(v, min, max) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
function numIn(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10) / 10 : null;
}
// Human-readable LA time for the form's "When" field, e.g. "Thu, Nov 12, 8:00 AM".
function laLabel(d) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
}
// "Wednesday, 2026-11-11 19:45 (UTC-08:00)" — the reference "now" given to the model.
function laNow(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' }).formatToParts(now).map((x) => [x.type, x.value]));
  const off = (p.timeZoneName || 'GMT-08:00').replace('GMT', 'UTC');
  return `${p.weekday}, ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} (${off})`;
}
function pickupTime(v, now) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const ms = d.getTime() - now.getTime();
  if (ms < -60 * 60 * 1000 || ms > 90 * 24 * 60 * 60 * 1000) return null; // past or >90 days out: ask the operator
  return d;
}

// raw = Gemini JSON. Only whitelisted fields survive; anything else (e.g. a price) is dropped.
function normalize(raw, now = new Date()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('AI returned no trip details');
  const t = pickupTime(raw.pickupTime, now);
  const out = {
    pickup: cleanStr(raw.pickup, 120),
    dropoff: cleanStr(raw.dropoff, 120),
    pickupTime: t ? t.toISOString() : null,
    when: t ? laLabel(t) : null,
    passengers: intIn(raw.passengers, 1, 7),
    luggage: intIn(raw.luggage, 0, 20),
    notes: cleanStr(raw.notes, 200),
    estMiles: numIn(raw.estMiles, 0.1, 200),
    estMinutes: numIn(raw.estMinutes, 1, 300),
  };
  if (out.estMinutes != null) out.estMinutes = Math.round(out.estMinutes);
  if (!out.pickup && !out.dropoff) throw new Error('Could not find a trip in that sentence. Try: "Tomorrow 8am from Glendora to LAX Terminal 4, 2 people".');
  const missing = [];
  if (!out.pickup) missing.push('pickup');
  if (!out.dropoff) missing.push('dropoff');
  if (!out.pickupTime) missing.push('pickupTime');
  if (out.passengers == null) missing.push('passengers');
  if (out.estMiles == null || out.estMinutes == null) missing.push('distance');
  out.missing = missing;
  return out;
}
module.exports = { inputText, normalize, laNow, laLabel, TZ, MAX_TEXT };
