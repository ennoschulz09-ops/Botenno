// Übergangs-Oberfläche des PC-Bots. Fragt alle 2 s den Status ab; alle Werte aus Marktdaten (z. B. Coin-Symbole)
// werden vor der Anzeige escaped. Ändernde Anfragen tragen den Header X-SmartLab (Schutz gegen fremde Webseiten).
'use strict';
const $ = id => document.getElementById(id);
const esc = v => String(v == null ? '' : v).replace(/[&<>"'`]/g, c => '&#' + c.charCodeAt(0) + ';');
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const usd = (v, d = 2) => (isNum(v) ? (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
const signed = v => (isNum(v) ? (v > 0 ? '+' : '') + usd(v) : '—');
const pct = v => (isNum(v) ? (v > 0 ? '+' : '') + v.toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' %' : '—');
const cls = v => (isNum(v) ? (v >= 0 ? 'up' : 'dn') : '');
const time = ts => (ts ? new Date(ts).toLocaleTimeString('de-DE') : '—');
const dt = ts => (ts ? new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const age = ms => (!isNum(ms) ? '—' : ms < 60e3 ? Math.round(ms / 1e3) + ' s' : ms < 3600e3 ? Math.round(ms / 60e3) + ' min' : (ms / 3600e3).toFixed(1) + ' h');
const kpi = (k, v, c = '') => `<div class="kpi"><small>${esc(k)}</small><b class="${c}">${v}</b></div>`;
const table = (head, rows) => (rows.length ? `<table><thead><tr>${head.map(h => `<th class="${h.r ? 'r' : ''}">${esc(h.t || h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>` : '<p class="mut">keine</p>');
let last = null, busy = false;

function msg(text, bad) { const m = $('msg'); m.textContent = text; m.style.color = bad ? '#ffb4b4' : ''; }
async function post(url, body, type = 'application/json') {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': type, 'X-SmartLab': '1' }, body });
  return r.json().catch(() => ({ ok: false, error: 'Antwort nicht lesbar' }));
}
async function action(a, extra = {}) {
  if (a === 'emergency' && !confirm('Not-Aus auslösen? Neue Käufe werden blockiert.')) return;
  if (a === 'fresh-start' && !confirm('Frischer Start: Kapital zurück auf Startwert, offene Positionen werden verworfen. Lerndaten bleiben. Fortfahren?')) return;
  msg('…');
  const r = await post('/api/action', JSON.stringify({ action: a, ...extra }));
  msg(r.ok ? 'erledigt' : 'Fehler: ' + (r.error || 'unbekannt'), !r.ok);
  refresh();
}

function render(s) {
  last = s;
  const b = s.bot, p = s.portfolio;
  const st = $('state'); st.textContent = `${b.state} · ${b.readiness}`; st.className = 'chip ' + (b.emergency ? 'bad' : b.state === 'RUNNING' ? 'ok' : 'warn');
  const au = $('auto'); au.textContent = 'Auto-Trading ' + (b.autoTrading ? 'AN' : 'aus'); au.className = 'chip ' + (b.autoTrading ? 'ok' : '');
  $('reason').textContent = `${b.reason || ''}${s.mock ? ' · TESTDATEN (kein Internet)' : ''} · Modus ${s.mode} – Handel nur simuliert, LIVE gesperrt`;
  $('kpis').innerHTML = [
    kpi('Kapital (Equity)', usd(p.equity)), kpi('Startkapital', usd(p.start, 0)), kpi('Cash', usd(p.cash)),
    kpi('Im Markt', `${usd(p.exposure)} · ${isNum(p.exposurePct) ? p.exposurePct.toFixed(1) : '—'} %`),
    kpi('Realisiert', signed(p.realized), cls(p.realized)), kpi('Drawdown', isNum(p.drawdownPct) ? p.drawdownPct.toFixed(1) + ' %' : '—'),
    kpi('Trades', s.perf.trades), kpi('Trefferquote', isNum(s.perf.winRate) ? Math.round(s.perf.winRate * 100) + ' %' : '—'),
    kpi('Ø je Trade', signed(s.perf.expectancy), cls(s.perf.expectancy)), kpi('Profit Factor', isNum(s.perf.profitFactor) ? s.perf.profitFactor.toFixed(2) : '—'),
    kpi('Letzter Scan', s.scanner.lastAt ? 'vor ' + age(s.now - s.scanner.lastAt) : '—'), kpi('Coins im Scanner', s.scanner.tokens),
    kpi('System-Health', s.scanner.health + '/100'), kpi('Läuft seit', age(s.now - s.startedAt))
  ].join('');
  $('positions').innerHTML = table(['Coin', 'Strategie', 'Eröffnet', { t: 'Einsatz', r: 1 }, { t: 'Wert', r: 1 }, { t: 'PnL', r: 1 }, 'Stop', 'Käufe', 'Status', ''],
    s.positions.map(x => `<tr><td><b>${esc(x.symbol)}</b>${x.noRoute ? ' <span class="chip bad">kein Verkaufsweg</span>' : ''}</td><td>${esc(x.strategy || 'manuell')}</td><td>${dt(x.openedAt)}</td><td class="r">${usd(x.costUsd)}</td><td class="r">${usd(x.value)}</td><td class="r ${cls(x.pnlPct)}">${signed(x.pnlUsd)} (${pct(x.pnlPct)})</td><td>${esc(x.stopType || '')}</td><td>${x.buys}</td><td>${esc(x.lc || '')} · ${esc(x.priceLabel || '')}</td><td><button data-sell="${esc(x.id)}">Verkaufen</button></td></tr>`));
  $('trades').innerHTML = table(['Geschlossen', 'Coin', 'Strategie', 'Quelle', { t: 'Einsatz', r: 1 }, { t: 'Ergebnis', r: 1 }, 'Grund', 'Käufe'],
    s.trades.map(x => `<tr><td>${dt(x.closedAt)}</td><td><b>${esc(x.symbol)}</b></td><td>${esc(x.strategy || 'manuell')}</td><td>${esc(x.discovery || '—')}</td><td class="r">${usd(x.sizeUsd)}</td><td class="r ${cls(x.pnlUsd)}">${signed(x.pnlUsd)} (${pct(x.pnlPct)})</td><td>${esc(x.exitReason || '')}</td><td>${x.buys}</td></tr>`));
  const L = s.learn, hyp = Object.entries(L.hypotheses).map(([k, n]) => `${esc(k)} ${n}`).join(' · ') || 'keine';
  $('learn').innerHTML = `<div class="kpis">${kpi('Lern-KI', L.enabled ? 'AN' : 'AUS')}${kpi('Trades gespeichert', L.records)}${kpi('Davon gelernt', L.learnable)}${kpi('Ausgeschlossen (verzerrt)', L.excluded)}${kpi('Modell', esc(L.champion || '—'))}${kpi('Drift', esc(L.drift))}</div>
    ${L.excluded ? `<p class="note">Nicht gelernt: ${Object.entries(L.byFlag).map(([k, n]) => `${n}× ${esc(k)}`).join(' · ')}</p>` : ''}
    <p class="note">Aktive gelernte Regeln: ${L.rules.length ? L.rules.map(esc).join(' · ') : 'keine'} · Hypothesen: ${hyp} · letzter Lernlauf ${time(L.lastRunAt)}</p>
    ${L.lessons.length ? `<ul class="note">${L.lessons.map(l => `<li>${esc(l.kind === 'AVOID' ? 'Meiden' : 'Gut')}: ${esc(l.text)} (${esc(l.status)})</li>`).join('')}</ul>` : ''}`;
  $('monitor').innerHTML = s.monitor.length ? s.monitor.map(a => `<p><span class="chip ${a.sev === 'WARN' ? 'warn' : 'bad'}">${esc(a.sev)}</span> <b>${esc(a.code)}</b> – ${esc(a.msg)}</p>`).join('') : '<p class="mut">Keine Auffälligkeiten.</p>';
  $('apis').innerHTML = table(['Quelle', 'Status', { t: 'Latenz', r: 1 }, 'Letzter Fehler'], s.apis.map(a => `<tr><td>${esc(a.name)}</td><td><span class="chip ${a.status === 'ONLINE' ? 'ok' : a.status === 'OFFLINE' ? 'bad' : 'warn'}">${esc(a.status)}</span></td><td class="r">${isNum(a.latency) ? a.latency + ' ms' : '—'}</td><td class="mut">${esc(a.lastError)}</td></tr>`));
  $('logs').innerHTML = s.logs.map(e => `<div class="lv-${esc(e.level)}">${time(e.ts)} ${esc(e.level)} ${esc(e.category)} – ${esc(e.message)}</div>`).join('');
  $('datainfo').textContent = `Daten: ${s.dataDir} · tägliche Sicherung: ${s.lastBackup || 'noch keine (erste nach 1 min)'} · Version ${s.app}`;
}

async function refresh() {
  if (busy) return; busy = true;
  try { const r = await fetch('/api/status', { cache: 'no-store' }); render(await r.json()); }
  catch (e) { const st = $('state'); st.textContent = 'Bot nicht erreichbar – läuft das Fenster noch?'; st.className = 'chip bad'; }
  finally { busy = false; }
}

document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.act) action(b.dataset.act);
  else if (b.dataset.sell) { if (confirm('Diese Position komplett verkaufen?')) action('sell', { posId: b.dataset.sell, frac: 'ALL' }); }
  else if (b.id === 'btnShutdown') {
    if (!confirm('Bot beenden? Alles wird gespeichert. Neu starten über start-bot.bat.')) return;
    post('/api/shutdown', '{}').then(() => { msg('Bot beendet.'); $('state').textContent = 'beendet'; });
  }
});
async function upload(input, url, okText) {
  const f = input.files && input.files[0]; if (!f) return;
  msg('lädt …');
  const r = await post(url, await f.text());
  input.value = '';
  msg(r.ok ? okText + (r.errors && r.errors.length ? ' (Hinweise: ' + r.errors.join('; ') + ')' : '') : 'Fehler: ' + (r.error || (r.errors || []).join('; ')), !r.ok);
  refresh();
}
$('fSettings').addEventListener('change', e => upload(e.target, '/api/settings', 'Einstellungen übernommen'));
$('fRestore').addEventListener('change', e => {
  if (!confirm('Voll-Backup einspielen? Alle Daten dieses PC-Bots werden ersetzt (vorher ggf. selbst ein Backup herunterladen).')) { e.target.value = ''; return; }
  upload(e.target, '/api/restore', 'Backup eingespielt, Bot neu gestartet');
});
refresh();
setInterval(refresh, 2000);
