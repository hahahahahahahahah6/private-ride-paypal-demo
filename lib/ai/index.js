'use strict';
const { generateJsonWithModel } = require('./gemini');
const P = require('./prompts');
const { baselineFare } = require('../fare');

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
  return { driver, reasons: ai.reasons || [], runnerUpId: ai.runnerUpId || null, model };
}

async function summarizeTrip(facts) {
  const { data, model } = await generateJsonWithModel(P.tripSummary.prompt(facts), P.tripSummary.schema);
  if (typeof data.en !== 'string' || typeof data.zh !== 'string') throw new Error('AI summary missing en/zh');
  return { en: data.en, zh: data.zh, model };
}
module.exports = { estimateFare, pickDriver, summarizeTrip };
