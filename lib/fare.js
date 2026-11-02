'use strict';
// Rule-based baseline fare, shown next to the AI estimate. Distance/minutes are user-entered
// (no maps API in this demo). Rates are demo constants, not real pricing.
const RATES = { base: 5, perMile: 2.0, perMinute: 0.35, minimum: 10 };
function baselineFare({ miles, minutes }) {
  const raw = RATES.base + miles * RATES.perMile + minutes * RATES.perMinute;
  return { amount: Math.max(RATES.minimum, Math.round(raw * 100) / 100), rates: RATES };
}
module.exports = { baselineFare, RATES };
