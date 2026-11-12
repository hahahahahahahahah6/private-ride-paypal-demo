'use strict';
const { generateJsonWithModel } = require('./gemini');
const P = require('./prompts');
const { baselineFare } = require('../fare');
const intakeRules = require('../intake');

async function estimateFare(trip) {
  const baseline = baselineFare(trip);
  const { data: ai, model } = await generateJsonWithModel(P.fareEstimate.prompt(trip, baseline), P.fareEstimate.schema);
  const fare = Number(ai.fareUsd);
  if (!Number.isFinite(fare)) throw new Error('AI fare missing');
  // Clamp to the stated 50%-200% band so a bad output can't create a wild charge.
  const clamped = Math.min(baseline.amount * 2, Math.max(baseline.amount * 0.5, fare));
  return { baseline, ai: { fareUsd: Math.round(clamped * 100) / 100, rawFareUsd: fare, clamped: clamped !== fare, confidence: ai.confidence, reasons: ai.reasons || [], model } };
}

async function pickDriver(trip, drivers) {
  const { data: ai, model } = await generateJsonWithModel(P.dispatch.prompt(trip, drivers), P.dispatch.schema);
  const driver = drivers.find((d) => d.id === ai.driverId);
  if (!driver) throw new Error('AI picked a driver not in the list');
  const reasons = (ai.reasons || []).map((r) => nameDriverIds(String(r), drivers));
  return { driver, reasons, runnerUpId: ai.runnerUpId || null, model };
}
// Display only: swap internal roster ids ("d1", "Driver d1") in AI reasons for display names ("Driver A (demo)").
function nameDriverIds(text, drivers) {
  const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...drivers].filter((d) => d.id && d.name).sort((a, b) => b.id.length - a.id.length)
    .reduce((t, d) => t.replace(new RegExp(`\\b(?:driver\\s+)?${reEsc(d.id)}\\b`, 'gi'), d.name), text);
}

// The payout status is never passed to the model, but a model may still guess one (e.g. "(PENDING)").
// The live status line is the only source of truth, so drop any summary sentence that talks about the payout or a status.
const PAYOUT_TALK = [/\b(PENDING|PROCESSING|SUCCESS|UNCLAIMED|ONHOLD|DENIED|FAILED)\b/, /payouts?|pay[- ]?out|paid out|\bpending\b|\bprocessing\b/i, /放款|打款|处理中|待处理|已到账|司机.{0,6}(收款|报酬|酬劳|分成)/];
function stripPayoutTalk(text, zh) {
  const parts = zh ? String(text).split(/(?<=[。！？])/) : String(text).split(/(?<=[.!?])\s+/);
  return parts.filter((x) => !PAYOUT_TALK.some((re) => re.test(x))).join(zh ? '' : ' ').trim();
}
async function summarizeTrip(facts) {
  const { data, model } = await generateJsonWithModel(P.tripSummary.prompt(facts), P.tripSummary.schema);
  if (typeof data.en !== 'string' || typeof data.zh !== 'string') throw new Error('AI summary missing en/zh');
  const en = stripPayoutTalk(data.en, false), zh = stripPayoutTalk(data.zh, true);
  if (!en || !zh) throw new Error('AI summary only described the payout status; omitted (see the live payout status line)');
  return { en, zh, model };
}
async function parseIntake(text, now = new Date()) {
  const clean = intakeRules.inputText(text);
  const { data, model } = await generateJsonWithModel(P.intake.prompt(clean, intakeRules.laNow(now)), P.intake.schema);
  return { ...intakeRules.normalize(data, now), model };
}
module.exports = { estimateFare, pickDriver, summarizeTrip, stripPayoutTalk, parseIntake, nameDriverIds };
