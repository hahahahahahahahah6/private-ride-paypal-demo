'use strict';
function str(v, name, max = 200) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} is required`);
  if (v.length > max) throw new Error(`${name} too long (max ${max})`);
  return v.trim();
}
function num(v, name, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return n;
}
function trip(b = {}) {
  return {
    pickup: str(b.pickup, 'pickup'), dropoff: str(b.dropoff, 'dropoff'),
    miles: num(b.miles, 'miles', 0.1, 200), minutes: num(b.minutes, 'minutes', 1, 300),
    when: b.when ? str(b.when, 'when', 60) : 'now', notes: b.notes ? str(b.notes, 'notes', 300) : '',
  };
}
module.exports = { str, num, trip };
