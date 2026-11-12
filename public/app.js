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
const loading = (t) => `<p class="loading">${esc(t)}</p>`;
const money = (n) => `$${Number(n).toFixed(2)}`;

// ---- display helpers (UI only; statuses always come from PayPal API responses) ----
const GOOD = ['COMPLETED', 'SUCCESS', 'VERIFIED'];
const WAIT = ['PENDING', 'PROCESSING', 'CREATED', 'APPROVED', 'ONHOLD', 'UNCLAIMED'];
function badge(status, label) {
  const s = String(status || 'UNKNOWN').toUpperCase();
  const cls = GOOD.includes(s) ? 'ok' : WAIT.includes(s) ? 'warn' : s === 'SIMULATED' || s === 'NOT STARTED' ? 'muted' : 'err';
  return `<span class="badge ${cls}">${esc(label || s)}</span>`;
}
let current = 1;
function setStep(n) {
  current = n;
  document.querySelectorAll('#stepper li').forEach((li) => {
    const k = Number(li.dataset.step);
    li.className = k < n ? 'done' : k === n ? 'active' : '';
  });
  for (let k = 1; k <= 4; k++) {
    const c = $('card' + k);
    c.classList.toggle('done', k < n); c.classList.toggle('current', k === n); c.classList.toggle('locked', k > n);
  }
}
const glance = (id, html) => { $(id).innerHTML = html; };

async function loadStatus() {
  const s = await call('GET', '/api/status');
  const li = (ok, label) => `<li><span class="chk ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✕'}</span>${label}<span class="meta">${ok ? 'configured' : 'NOT configured'}</span></li>`;
  const allOk = s.paypal && s.webhook && s.gemini;
  $('sysDot').className = 'dot ' + (allOk ? 'ok' : 'bad');
  $('statusBody').innerHTML = `<ul>${li(s.sandboxOnly, 'Sandbox-only mode')}${li(s.paypal, 'PayPal Sandbox app')}${li(s.webhook, 'PayPal webhook ID')}${li(s.gemini, 'Gemini API key')}</ul>
    <p>API base: <code>${esc(s.apiBase)}</code><br>Model: <code>${esc(s.geminiModel)}</code> (fallbacks: ${esc(String(s.geminiFallbacks || '').replace(/,/g, ', '))})</p>`;
  if (!allOk) $('status').open = true; // surface problems, hide when healthy
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
      $('payment').innerHTML = loading('Capturing payment in PayPal Sandbox…');
      try {
        const c = await call('POST', '/api/capture', { tripId });
        if (c.tripId) tripId = c.tripId;
        $('intakeBtn').disabled = true;
        $('estimateBtn').disabled = true; // lock this trip once paid so a re-estimate can't swap tripId
        const paid = c.stage === 'paid';
        $('payment').innerHTML = `<div class="result-h">${badge(c.captureStatus)}<strong>${paid ? 'Payment captured' : 'Payment not completed'}</strong><span class="meta">PayPal Sandbox · Orders v2 capture</span></div>
          <div class="kv"><div><span>Amount</span><b>${esc(c.amount?.value)} ${esc(c.amount?.currency_code)}</b></div><div><span>Order ID</span><b class="mono">${esc(c.orderId)}</b></div><div><span>Capture ID</span><b class="mono">${esc(c.captureId)}</b></div></div>`
          + (paid ? '' : `<p class="err" style="margin-top:10px">Not marked paid (stage: ${esc(c.stage)})</p>`);
        $('paypal-buttons').hidden = paid; $('payHint').hidden = paid;
        glance('gPay', badge(c.captureStatus));
        $('dispatchBtn').disabled = !paid;
        if (paid) setStep(3);
        setTimeout(loadLedger, 1500);
      } catch (e) { $('payment').innerHTML = errHtml(e); }
    },
    onError: (e) => { $('payment').innerHTML = errHtml(e); },
  }).render('#paypal-buttons');
  document.head.appendChild(sc);
}

$('estimateBtn').onclick = async () => {
  $('estimateBtn').disabled = true;
  $('estimate').innerHTML = loading('Asking Gemini for a fare…');
  try {
    const r = await call('POST', '/api/estimate', ['pickup', 'dropoff', 'miles', 'minutes', 'when', 'notes'].reduce((o, k) => ({ ...o, [k]: $(k).value }), {}));
    tripId = r.tripId;
    $('estimate').innerHTML = `<div class="compare">
        <div class="tile"><div class="lbl">Rule-based baseline</div><div class="amt">${money(r.baseline.amount)}</div><div class="meta">Base + per-mile + per-minute</div></div>
        <div class="tile hl"><div class="lbl">Gemini estimate</div><div class="amt">${money(r.ai.fareUsd)}</div>
          <div class="meta">${badge('INFO', esc(r.ai.confidence) + ' confidence').replace('badge err', 'badge info')} · model <code>${esc(r.ai.model || '')}</code>${r.ai.clamped ? ' · clamped to 50–200% of baseline' : ''}</div>
          <ul>${r.ai.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
      <p class="note">The customer is charged the Gemini estimate in Sandbox. Guardrail: the AI fare is always kept within 50–200% of the baseline.</p>`;
    glance('gRoute', `${esc(r.trip?.pickup || $('pickup').value)} → ${esc(r.trip?.dropoff || $('dropoff').value)}`);
    glance('gFare', money(r.ai.fareUsd));
    $('payHint').textContent = `Pay ${money(r.ai.fareUsd)} with the yellow PayPal button (Sandbox buyer account).`;
    setStep(2);
  } catch (e) { $('estimate').innerHTML = errHtml(e); }
  if (current < 3) $('estimateBtn').disabled = false;
};
$('dispatchBtn').onclick = async () => {
  $('dispatchBtn').disabled = true; $('dispatch').innerHTML = loading('Asking Gemini to pick a driver…');
  try {
    const r = await call('POST', '/api/dispatch', { tripId });
    const initials = esc(String(r.driver.name || '?').replace(/\(.*\)/, '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2));
    $('dispatch').innerHTML = `<div class="driver"><div class="avatar">${initials}</div><div>
      <div class="result-h">${badge('SUCCESS', 'ASSIGNED')}<strong>${esc(r.driver.name)}</strong><span class="meta">${esc(r.driver.vehicle)}${r.model ? ` · AI model <code>${esc(r.model)}</code>` : ''}</span></div>
      <ul>${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div>`;
    glance('gDriver', esc(r.driver.name));
    $('completeBtn').disabled = r.stage !== 'dispatched';
    if (r.stage === 'dispatched') setStep(4);
  } catch (e) { $('dispatch').innerHTML = errHtml(e); $('dispatchBtn').disabled = false; }
};

function showPayoutStatus(status, line) {
  $('pstatus').innerHTML = badge(status);
  glance('gPayout', badge(status));
  if ($('plineEn') && line) { $('plineEn').textContent = line.en; $('plineZh').textContent = line.zh; }
}
async function refreshPayout(batchId) {
  const s = await call('GET', `/api/payouts/${batchId}`);
  showPayoutStatus(s.status, s.payoutLine);
  $('pchecked').textContent = 'Last checked ' + new Date().toLocaleTimeString();
  return s.status;
}
$('completeBtn').onclick = async () => {
  $('completeBtn').disabled = true; $('complete').innerHTML = loading('Sending Sandbox payout and asking Gemini for a summary…');
  try {
    const r = await call('POST', '/api/complete', { tripId });
    const p = r.payout;
    const payoutHtml = p.simulated
      ? `<div class="payout"><div class="result-h">${badge('SIMULATED')}<strong>Simulated payout — no money was sent</strong></div><div class="big">${money(p.amount)}</div><p class="note">${esc(p.reason)}</p></div>`
      : `<div class="payout"><div class="result-h"><span id="pstatus"></span><strong>Driver payout (PayPal Payouts, Sandbox)</strong><span class="meta">live status from PayPal</span></div>
          <div class="kv"><div><span>Amount (80% of fare)</span><b>${money(p.amount)}</b></div><div><span>Payout batch ID</span><b class="mono">${esc(p.payoutBatchId)}</b></div><div><span>Status check</span><b><button id="refreshPayout" class="btn small">Refresh payout status</button></b></div></div>
          <p class="meta" id="pchecked" style="margin:8px 0 0"></p></div>`;
    const sum = r.summary
      ? `<div class="summary"><h4>AI trip summary <span class="zh">AI 行程总结</span></h4><div class="meta">Written by <code>${esc(r.summary.model || '')}</code> at trip completion from trip facts only. It does not state the payout status; see the live line below.</div>
          <p>${esc(r.summary.en)}</p><p>${esc(r.summary.zh)}</p></div>
         <div class="live"><small class="meta">Live payout status · 实时放款状态 (refreshes automatically)</small><span id="plineEn">${esc(r.payoutLine.en)}</span><span id="plineZh">${esc(r.payoutLine.zh)}</span></div>`
      : `<p class="err" style="margin-top:12px">Summary failed: ${esc(r.summaryError)}</p>`;
    $('complete').innerHTML = payoutHtml + sum;
    setStep(5);
    loadLedger();
    if (p.simulated) { glance('gPayout', badge('SIMULATED')); return; }
    showPayoutStatus(p.status, r.payoutLine);
    $('refreshPayout').onclick = async () => { try { await refreshPayout(p.payoutBatchId); } catch (e) { alert(e.message); } };
    // Light auto-refresh (read-only GET) until PayPal reports a final status, so the screen never shows a stale PENDING.
    let tries = 0;
    const tick = async () => {
      tries++;
      let st = null;
      try { st = await refreshPayout(p.payoutBatchId); } catch { /* manual button still works */ }
      if (st && WAIT.includes(String(st).toUpperCase()) && tries < 8) setTimeout(tick, 5000);
      else if (st) loadLedger();
    };
    if (WAIT.includes(String(p.status).toUpperCase())) setTimeout(tick, 5000);
  } catch (e) { $('complete').innerHTML = errHtml(e); $('completeBtn').disabled = false; }
};

// ---- ledger ----
function ledgerRow(e) {
  const t = e.recordedAt ? new Date(e.recordedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—';
  let what = '', detail = '', amount = '—', check = '';
  if (e.type === 'webhook') {
    what = `<b>${esc(e.eventType)}</b><small>PayPal webhook</small>`;
    detail = e.resourceId ? `${/PAYOUTSBATCH/.test(e.eventType || '') ? 'Batch' : 'Resource'} <span class="mono">${esc(e.resourceId)}</span>` : '—';
    check = e.verified ? badge('VERIFIED', '✓ SIGNATURE VERIFIED') : badge('FAILED', 'UNVERIFIED');
  } else if (e.type === 'capture_api_response') {
    what = '<b>Payment captured</b><small>Capture API response</small>';
    detail = `Order <span class="mono">${esc(e.orderId)}</span><br>Capture <span class="mono">${esc(e.captureId)}</span>`;
    amount = e.amount ? `${esc(e.amount.value)} ${esc(e.amount.currency_code)}` : '—';
    check = '<span class="badge info">API RESPONSE</span>';
  } else if (e.type === 'payout_created' || e.type === 'payout_simulated') {
    what = `<b>${e.type === 'payout_simulated' ? 'Driver payout (simulated)' : 'Driver payout created'}</b><small>Payouts API response</small>`;
    detail = e.payoutBatchId ? `Batch <span class="mono">${esc(e.payoutBatchId)}</span>` : '—';
    amount = e.amount != null ? money(e.amount) : '—';
    check = e.type === 'payout_simulated' ? badge('SIMULATED') : '<span class="badge info">API RESPONSE</span>';
  } else {
    what = `<b>${esc(e.type)}</b>`; detail = esc(JSON.stringify(e));
  }
  const atCreation = e.type === 'payout_created' && e.status ? ' <small class="meta" title="Status returned by the Payouts API when the batch was created. The live status is shown in step 4 and in the PAYOUTSBATCH webhook row.">at creation</small>' : '';
  return `<tr><td>${esc(t)}</td><td class="evt">${what}</td><td>${detail}</td><td>${amount}</td><td>${e.status ? badge(e.status) + atCreation : ''}</td><td>${check}</td></tr>`;
}
async function loadLedger() {
  try {
    const rows = await call('GET', '/api/ledger');
    $('ledger').textContent = JSON.stringify(rows, null, 2);
    $('ledgerTable').innerHTML = rows.length
      ? `<table><thead><tr><th>Time</th><th>Event</th><th>IDs</th><th>Amount</th><th>Status <small>(when recorded)</small></th><th>Check</th></tr></thead><tbody>${rows.map(ledgerRow).join('')}</tbody></table>`
      : '<div class="empty">No ledger entries yet. They appear after a payment is captured.</div>';
  } catch (e) { $('ledgerTable').innerHTML = errHtml(e); }
}
$('ledgerBtn').onclick = loadLedger;
$('rawToggle').onchange = () => { const raw = $('rawToggle').checked; $('ledger').hidden = !raw; $('ledgerTable').hidden = raw; };
// ---- natural-language intake (fills the form only; the operator still clicks "Get AI fare estimate") ----
const FIELD_LABEL = { pickup: 'pickup 上车点', dropoff: 'dropoff 目的地', pickupTime: 'time 时间', passengers: 'passengers 人数', distance: 'miles/minutes 里程/时长' };
const markFilled = (id, v) => { $(id).value = v; $(id).classList.add('ai-filled'); };
['pickup', 'dropoff', 'miles', 'minutes', 'when', 'notes'].forEach((id) => $(id).addEventListener('input', () => {
  $(id).classList.remove('ai-filled'); if ($(id + 'Tag')) $(id + 'Tag').hidden = true;
}));
$('intakeBtn').onclick = async () => {
  if (current > 2) return; // trip already paid: form is locked
  $('intakeBtn').disabled = true; $('intakeOut').innerHTML = loading('Reading your sentence with Gemini…');
  try {
    const r = await call('POST', '/api/intake', { text: $('intakeText').value });
    if (r.pickup) markFilled('pickup', r.pickup);
    if (r.dropoff) markFilled('dropoff', r.dropoff);
    if (r.when) markFilled('when', r.when);
    const extra = [r.passengers ? `${r.passengers} passenger${r.passengers > 1 ? 's' : ''}` : '', r.luggage != null ? `${r.luggage} bag${r.luggage === 1 ? '' : 's'}` : '', r.notes || ''].filter(Boolean).join(', ');
    if (extra) markFilled('notes', extra);
    if (r.estMiles != null && r.estMinutes != null) { markFilled('miles', r.estMiles); markFilled('minutes', r.estMinutes); $('milesTag').hidden = false; $('minutesTag').hidden = false; }
    const miss = (r.missing || []).map((k) => FIELD_LABEL[k] || k);
    $('intakeOut').innerHTML = `<div class="filled"><b>Filled from your sentence — please check · 已根据你的描述填好，请核对</b>
      <span class="meta">Highlighted fields were filled by <code>${esc(r.model || 'Gemini')}</code>. Miles/minutes are AI estimates; edit anything, then click “Get AI fare estimate”.</span>
      ${miss.length ? `<div class="miss">Not in your sentence · 还缺：${esc(miss.join(', '))}${miss.includes(FIELD_LABEL.distance) ? ' (form defaults kept)' : ''}</div>` : ''}</div>`;
  } catch (e) { $('intakeOut').innerHTML = errHtml(e); }
  $('intakeBtn').disabled = current > 2;
};
// Voice input: browser Web Speech API (Chrome/Edge/Safari). Hidden when unsupported; typing always works.
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  $('micWrap').hidden = false;
  let rec = null;
  $('micBtn').onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = $('micLang').value; rec.interimResults = true; rec.maxAlternatives = 1;
    const base = $('intakeText').value ? $('intakeText').value + ' ' : '';
    rec.onresult = (ev) => { $('intakeText').value = base + Array.from(ev.results).map((x) => x[0].transcript).join(''); };
    rec.onerror = (ev) => { $('intakeOut').innerHTML = `<p class="err">Voice input unavailable (${esc(ev.error)}). Please type instead.</p>`; };
    rec.onend = () => { rec = null; $('micBtn').classList.remove('rec'); $('micBtn').setAttribute('aria-pressed', 'false'); };
    try { rec.start(); $('micBtn').classList.add('rec'); $('micBtn').setAttribute('aria-pressed', 'true'); } catch { rec = null; }
  };
})();
setStep(1);
loadLedger();
loadStatus().catch((e) => { $('statusBody').innerHTML = errHtml(e); $('status').open = true; });
