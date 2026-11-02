'use strict';
// Mock drivers for the demo (clearly fictional). Payout receivers must be Sandbox personal accounts:
// set DRIVER_SANDBOX_EMAIL in .env to a sandbox account from developer.paypal.com -> Sandbox accounts.
module.exports = () => [
  { id: 'd1', name: 'Driver A (demo)', vehicle: 'Sedan, 4 seats', minutesToPickup: 6, rating: 4.9, available: true },
  { id: 'd2', name: 'Driver B (demo)', vehicle: 'Minivan, 7 seats', minutesToPickup: 14, rating: 4.7, available: true },
  { id: 'd3', name: 'Driver C (demo)', vehicle: 'SUV, 5 seats', minutesToPickup: 3, rating: 4.5, available: false },
].map((d) => ({ ...d, payoutEmail: process.env.DRIVER_SANDBOX_EMAIL || '' }));
