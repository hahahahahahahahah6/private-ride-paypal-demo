const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let tripId = null;
async function call(method, url, data) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error || 'request failed'), { code: j.code });
  return j;
}
const errHtml = (e) => `<p class="err">${e.code === 'NOT_CONFIGURED' ? 'Not configured: ' : 'Error: '}${esc(e.message)}</p>`;

async function loadStatus() {
  const s = await call('GET', '/api/status');
  const li = (ok, label) => `<li class="${ok ? 'ok' : 'err'}">${label}: ${ok ? 'configured' : 'NOT configured'}</li>`;
  $('statusBody').innerHTML = `<ul>${li(s.paypal, 'PayPal Sandbox app')}${li(s.webhook, 'PayPal webhook ID')}${li(s.gemini, 'Gemini API key')}</ul>
    <p>API base: <code>${esc(s.apiBase)}</code> · model: <code>${esc(s.geminiModel)}</code></p>`;
  if (s.paypal && s.paypalClientId) loadPayPal(s.paypalClientId);
  else $('paypal-buttons').innerHTML = '<p class="err">Not configured: PayPal Sandbox client ID/secret missing in .env.</p>';
}

function loadPayPal(clientId) {
  const sc = document.createElement('script');
  // JS SDK: https://developer.paypal.com/sdk/js/configuration/
  sc.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
  sc.onload = () => paypal.Buttons({
    createOrder: async () => { if (!tripId) throw new Error('Get an estimate first'); return (await call('POST', '/api/orders', { tripId })).id; },
    onApprove: async () => {
      try {
        const c = await call('POST', '/api/capture', { tripId });
        $('payment').innerHTML = `<p class="ok">Captured (Sandbox): status ${esc(c.captureStatus)}</p><p>Order <code>${esc(c.orderId)}</code><br>Capture ID <code>${esc(c.captureId)}</code><br>Amount ${esc(c.amount?.value)} ${esc(c.amount?.currency_code)}</p>`;
        if (c.tripId) tripId = c.tripId;
        $('estimateBtn').disabled = true; // lock this trip once paid so a re-estimate can't swap tripId
        $('dispatchBtn').disabled = c.stage !== 'paid';
        if (c.stage !== 'paid') $('payment').innerHTML += `<p class="err">Not marked paid (stage: ${esc(c.stage)})</p>`;
      } catch (e) { $('payment').innerHTML = errHtml(e); }
    },
    onError: (e) => { $('payment').innerHTML = errHtml(e); },
  }).render('#paypal-buttons');
  document.head.appendChild(sc);
}

$('estimateBtn').onclick = async () => {
  $('estimate').textContent = 'Asking Gemini…';
  try {
    const r = await call('POST', '/api/estimate', ['pickup', 'dropoff', 'miles', 'minutes', 'when', 'notes'].reduce((o, k) => ({ ...o, [k]: $(k).value }), {}));
    tripId = r.tripId;
    $('estimate').innerHTML = `<div class="row"><div><h4>Rule-based baseline</h4><p><b>$${r.baseline.amount.toFixed(2)}</b></p></div>
      <div><h4>Gemini estimate <small>(${esc(r.ai.model || '')})</small></h4><p><b>$${r.ai.fareUsd.toFixed(2)}</b> (${esc(r.ai.confidence)} confidence)${r.ai.clamped ? ' — clamped to 50–200% of baseline' : ''}</p>
      <ul>${r.ai.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div><p>You will be charged the Gemini estimate in Sandbox.</p>`;
  } catch (e) { $('estimate').innerHTML = errHtml(e); }
};
$('dispatchBtn').onclick = async () => {
  $('dispatchBtn').disabled = true; $('dispatch').textContent = 'Asking Gemini to dispatch…';
  try {
    const r = await call('POST', '/api/dispatch', { tripId });
    $('dispatch').innerHTML = `<p class="ok">Assigned: ${esc(r.driver.name)} (${esc(r.driver.vehicle)})${r.model ? ` · AI model: ${esc(r.model)}` : ''}</p><ul>${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    $('completeBtn').disabled = r.stage !== 'dispatched';
  } catch (e) { $('dispatch').innerHTML = errHtml(e); $('dispatchBtn').disabled = false; }
};
$('completeBtn').onclick = async () => {
  $('completeBtn').disabled = true; $('complete').textContent = 'Sending sandbox payout + AI summary…';
  try {
    const r = await call('POST', '/api/complete', { tripId });
    const p = r.payout;
    const payoutHtml = p.simulated
      ? `<p class="sim">Simulated payout (pending sandbox Payouts access) — no money was sent. $${p.amount.toFixed(2)}</p><p>${esc(p.reason)}</p>`
      : `<p class="ok">Sandbox payout created: batch <code>${esc(p.payoutBatchId)}</code>, status <b id="pstatus">${esc(p.status)}</b>, $${p.amount.toFixed(2)}</p><button id="refreshPayout">Refresh payout status</button>`;
    const sum = r.summary ? `<h4>AI trip summary <small>(${esc(r.summary.model || '')})</small></h4><p>${esc(r.summary.en)}</p><p>${esc(r.summary.zh)}</p><p id="plineEn"><b>${esc(r.payoutLine.en)}</b></p><p id="plineZh"><b>${esc(r.payoutLine.zh)}</b></p>` : `<p class="err">Summary failed: ${esc(r.summaryError)}</p>`;
    $('complete').innerHTML = payoutHtml + sum;
    if (!p.simulated) $('refreshPayout').onclick = async () => { try { const s = await call('GET', `/api/payouts/${p.payoutBatchId}`); $('pstatus').textContent = s.status; if ($('plineEn')) { $('plineEn').innerHTML = '<b>' + esc(s.payoutLine.en) + '</b>'; $('plineZh').innerHTML = '<b>' + esc(s.payoutLine.zh) + '</b>'; } } catch (e) { alert(e.message); } };
  } catch (e) { $('complete').innerHTML = errHtml(e); $('completeBtn').disabled = false; }
};
$('ledgerBtn').onclick = async () => { $('ledger').textContent = JSON.stringify(await call('GET', '/api/ledger'), null, 2); };
loadStatus().catch((e) => { $('statusBody').innerHTML = errHtml(e); });
