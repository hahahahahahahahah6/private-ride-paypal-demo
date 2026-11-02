'use strict';
// All Gemini prompts + JSON schemas live here.
const fareEstimate = {
  prompt: (t, baseline) => `You estimate fares for a small private car service (one family, not a ride-hailing company).
Trip: pickup "${t.pickup}", dropoff "${t.dropoff}", ${t.miles} miles, about ${t.minutes} minutes, time: ${t.when}. Notes: ${t.notes || 'none'}.
Rule-based baseline fare: $${baseline.amount} USD.
Suggest a fair price in USD. Stay within 50%-200% of the baseline. Give short reasons (time of day, traffic, waiting, luggage). Do not invent facts not given.`,
  schema: {
    type: 'object',
    properties: {
      fareUsd: { type: 'number' },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      reasons: { type: 'array', items: { type: 'string' } },
    },
    required: ['fareUsd', 'confidence', 'reasons'],
  },
};
const dispatch = {
  prompt: (t, drivers) => `Pick the best driver for this trip. Trip: "${t.pickup}" -> "${t.dropoff}", ${t.miles} mi, time ${t.when}. Notes: ${t.notes || 'none'}.
Drivers (JSON): ${JSON.stringify(drivers)}
Consider distance to pickup, availability, vehicle fit, rating. Choose exactly one driverId from the list.`,
  schema: {
    type: 'object',
    properties: {
      driverId: { type: 'string' },
      reasons: { type: 'array', items: { type: 'string' } },
      runnerUpId: { type: 'string' },
    },
    required: ['driverId', 'reasons'],
  },
};
const tripSummary = {
  prompt: (trip) => `Write a short trip summary for the passenger (an older family member). Use only these facts: ${JSON.stringify(trip)}.
Give one English version and one Simplified Chinese version, plain and friendly, 2-4 sentences each. Mention the amount paid and the payout status exactly as given (if payout is simulated, say so).`,
  schema: {
    type: 'object',
    properties: { en: { type: 'string' }, zh: { type: 'string' } },
    required: ['en', 'zh'],
  },
};
module.exports = { fareEstimate, dispatch, tripSummary };
