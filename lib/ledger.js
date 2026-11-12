'use strict';
// Append-only JSON-file ledger (data/ledger.json, git-ignored). Dedupes by event id.
const fs = require('fs');
const path = require('path');
const FILE = process.env.LEDGER_FILE || path.join(__dirname, '..', 'data', 'ledger.json');
function read(file = FILE) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } }
function append(entry, file = FILE) {
  const all = read(file);
  if (entry.eventId && all.some((e) => e.eventId === entry.eventId)) return { duplicate: true };
  all.push({ ...entry, recordedAt: new Date().toISOString() });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2));
  return { duplicate: false };
}
// Ledger row for a verified webhook. Payout batch events carry their id/status under resource.batch_header.
function webhookEntry(ev, action) {
  const r = ev.resource || {};
  return { type: 'webhook', action, eventId: ev.id, eventType: ev.event_type,
    resourceId: r.id ?? r.batch_header?.payout_batch_id, status: r.status ?? r.batch_header?.batch_status, verified: true };
}
module.exports = { read, append, webhookEntry };
