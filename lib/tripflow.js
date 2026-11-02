'use strict';
// Pure trip-stage helpers (unit-tested). Stages: estimated -> order_created -> paid -> dispatched -> completed
const STAGES = ['estimated', 'order_created', 'paid', 'dispatched', 'completed'];
const rank = (s) => STAGES.indexOf(s);
// Paid if either the order-level status or the capture-level status is COMPLETED.
function isPaid(cap) { return !!cap && (cap.status === 'COMPLETED' || cap.captureStatus === 'COMPLETED'); }
function stageAfterCapture(cap) { return isPaid(cap) ? 'paid' : 'capture_' + (cap?.captureStatus || cap?.status || 'UNKNOWN'); }
function atLeast(t, stage) { return rank(t.stage) >= rank(stage); }
module.exports = { STAGES, isPaid, stageAfterCapture, atLeast };
