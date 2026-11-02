'use strict';
// Pure trip-stage helpers (unit-tested). Stages: estimated -> order_created -> paid -> dispatched -> completed
const STAGES = ['estimated', 'order_created', 'paid', 'dispatched', 'completed'];
const rank = (s) => STAGES.indexOf(s);
// Paid if either the order-level status or the capture-level status is COMPLETED.
function isPaid(cap) { return !!cap && (cap.status === 'COMPLETED' || cap.captureStatus === 'COMPLETED'); }
function stageAfterCapture(cap) { return isPaid(cap) ? 'paid' : 'capture_' + (cap?.captureStatus || cap?.status || 'UNKNOWN'); }
function atLeast(t, stage) { return rank(t.stage) >= rank(stage); }
// Live payout status line rendered next to the AI summary (not baked into the AI text), EN + ZH.
const PAYOUT_ZH = { PENDING: '处理中（待处理）', PROCESSING: '处理中', SUCCESS: '已到账（沙盒）', DENIED: '被拒绝', FAILED: '失败', CANCELED: '已取消', BLOCKED: '被冻结', UNCLAIMED: '待领取', RETURNED: '已退回', ONHOLD: '暂缓', REFUNDED: '已退款' };
function payoutStatusLine(status, simulated) {
  if (simulated) return { en: 'Driver payout: simulated (not sent; sandbox Payouts access pending).', zh: '司机放款：模拟放款（未实际打款，沙盒 Payouts 权限待开通）。' };
  const s = String(status || 'UNKNOWN').toUpperCase();
  return { status: s, en: `Driver payout status (PayPal Sandbox): ${s}.`, zh: `司机放款状态（PayPal 沙盒）：${PAYOUT_ZH[s] || '未知状态'}（${s}）。` };
}
module.exports = { STAGES, isPaid, stageAfterCapture, atLeast, payoutStatusLine, PAYOUT_ZH };
