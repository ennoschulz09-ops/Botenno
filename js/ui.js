/* Smart Lab – ui.js
   Oberfläche: Views, Detail, Aktionen, Rendering (nur im Browser)
   Klassisches Skript ohne Build-Schritt: alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in fester
   Reihenfolge geladen (index.html bzw. server/load-core.js): base → engine → learning → core → selftest → ui.
   base, engine, learning, core und selftest laufen auch ohne Browser (Node.js); nur ui.js braucht das DOM. */
'use strict';

/* ============================== UI LAYER ==============================
   Nur Darstellung & Interaktion. Alle externen Daten werden über html`` escaped, Links über safeUrl validiert. */
const env = {
  now: () => Date.now(),
  fetch: (u, i) => window.fetch(u, i),
  setTimeout: (f, ms) => window.setTimeout(f, ms),
  clearTimeout: id => window.clearTimeout(id),
  random: () => Math.random(), // nur Backoff-Jitter im HTTP-Layer
  online: () => navigator.onLine !== false,
  walletProvider: () => (window.phantom && window.phantom.solana) || (window.solana && window.solana.isPhantom ? window.solana : null)
};
const core = createCore({ env, backend: createLocalBackend() });
const UI = { alertsSeenAt: 0, view: 'scanner', sort: 'score', dir: -1, q: '', onlyRec: false, safeOnly: false, age: '', maxRisk: 100, minConf: 0, detailTab: 'overview', chartTf: 'live', logCat: 'ALL', logQ: '', logPaused: false, hq: '', hMode: '', hRes: '', rankBy: 'opportunity', kbQ: '', lastTouch: 0, tests: null, testsRunning: false, bt: null, btBusy: false, pro: false };
const UI_PERSIST = ['alertsSeenAt', 'view', 'sort', 'dir', 'onlyRec', 'safeOnly', 'age', 'maxRisk', 'minConf', 'detailTab', 'chartTf', 'logCat', 'rankBy', 'pro', 'walletAuto'];
const $ = id => { const e = document.getElementById(id); if (!e) domMissing(id); return e; };
const missingDom = new Set();
function domMissing(id) { if (!missingDom.has(id)) { missingDom.add(id); core.log.warn('UI', `DOM-Element #${id} nicht gefunden`); } }
function setHTML(el, h) { if (!el) return; el.innerHTML = h && h[RAW] != null ? h[RAW] : esc(h == null ? '' : h); el._sig = null; }
function patch(el, h) { if (!el) return false; const s = h && h[RAW] != null ? h[RAW] : esc(h == null ? '' : h); if (el._sig === s) return false; el.innerHTML = s; el._sig = s; return true; }
function setText(el, s) { if (el && el.textContent !== String(s)) el.textContent = String(s); }
const tok = id => core.state.markets.get(id) || null;
const selTok = () => (core.state.selected ? tok(core.state.selected) : null);
const cls = v => (isNum(v) ? (v >= 0 ? 'up' : 'dn') : '');
const scColor = s => `hsl(${Math.round(clamp(s || 0, 0, 100) * 1.2)},85%,58%)`;
const scoreChip = s => html`<span class="sc" style="background:${scColor(s)}" title="Final Score 0–100">${s}</span>`;
const lvlChip = (level, total) => html`<span class="lvl lvl-${level}" title="Risk Score">${level === 'UNKNOWN' ? 'UNKNOWN' : level} ${total != null ? total : ''}</span>`;
const lbl = l => html`<span class="lbl ${l}" title="Datenstatus">${l}</span>`;
const DEC_LABEL = { APPROVED: 'APPROVED', BUY_CANDIDATE: 'CANDIDATE', WATCH: 'WATCH', REJECTED: 'NO TRADE' };
const decChip = d => html`<span class="dec dec-${d}">${DEC_LABEL[d] || d}</span>`;
const stCls = s => (s === 'ONLINE' || s === 'OK' ? 'ok' : s === 'DEGRADED' || s === 'STALE' ? 'warn' : s === 'OFFLINE' || s === 'ERROR' ? 'bad' : '');
const kv = (k, v, l, title, c) => html`<div class="kv${c ? ' ' + c : ''}" title="${title || ''}"><small>${k}</small><b>${v}${l ? html`<em class="lbl ${l}">${l}</em>` : ''}</b></div>`;
const kvA = (k, v, l, title) => kv(k, v, l, title, 'an');
/* MC/Coin-Preis-Verhältnis (≈ Umlauf-Supply): bevorzugt aus dem Snapshot beim Einstieg, sonst live. */
function snapRatio(sn) {
  const smc = sn ? (isNum(sn.marketCap) ? sn.marketCap : sn.fdv) : null;
  return isNum(smc) && smc > 0 && isNum(sn.priceUsd) && sn.priceUsd > 0 ? smc / sn.priceUsd : null;
}
function mcRatio(pos, t) {
  const j = pos ? core.state.journal.find(x => x.id === pos.id) : null;
  const r = snapRatio(j && j.decision && j.decision.snapshot);
  if (r != null) return r;
  const A = t && t.A;
  return A && isNum(A.core.mc) && isNum(A.core.price) && A.core.price > 0 ? A.core.mc / A.core.price : null;
}
const orderMcRatio = o => { const r = snapRatio(o.decision && o.decision.snapshot); return r != null ? r : mcRatio(o.positionId ? { id: o.positionId } : null, tok(o.tokenId)); };
const mcAt = (price, ratio) => (isNum(price) && price > 0 && isNum(ratio) ? fmtMc(price * ratio) : '—');
/* Coin-Preis und zugehörige MC untereinander, beide eindeutig gekennzeichnet. */
const pxMc = (price, ratio) => html`<span class="pxmc"><span class="px"><i class="pl">Preis</i> ${fmtPrice(price)}</span><span class="mcv">${mcAt(price, ratio)}</span></span>`;
const tokRatio = t => mcRatio(null, t);
const bar = (v, color) => html`<div class="bar"><i style="width:${clamp(v || 0, 0, 100)}%;background:${color || 'var(--cyan)'}"></i></div>`;
const riskColor = v => (v >= 75 ? 'var(--red)' : v >= 55 ? 'var(--orange)' : v >= 30 ? 'var(--yellow)' : 'var(--green)');
function saveUi() { const o = {}; for (const k of UI_PERSIST) o[k] = UI[k]; core.state.ui = o; }
function loadUi() {
  const u = core.state.ui || {};
  const views = new Set(VIEWS.map(v => v[0]));
  if (views.has(u.view)) UI.view = u.view;
  if (SORTS.some(s => s[0] === u.sort)) UI.sort = u.sort;
  if (u.dir === 1 || u.dir === -1) UI.dir = u.dir;
  for (const k of ['onlyRec', 'safeOnly', 'walletAuto']) if (typeof u[k] === 'boolean') UI[k] = u[k];
  if (['', 'NEW', 'EARLY', 'ESTABLISHED', 'MATURE'].includes(u.age)) UI.age = u.age;
  if (isNum(u.maxRisk)) UI.maxRisk = clamp(u.maxRisk, 0, 100);
  if (isNum(u.minConf)) UI.minConf = clamp(u.minConf, 0, 100);
  if (DETAIL_TABS.some(d => d[0] === u.detailTab)) UI.detailTab = u.detailTab;
  if (['live', '1m', '5m', '15m'].includes(u.chartTf)) UI.chartTf = u.chartTf;
  if (LOG_CATS.some(c => c[0] === u.logCat)) UI.logCat = u.logCat;
  if (['opportunity', 'risk', 'confidence', 'execution'].includes(u.rankBy)) UI.rankBy = u.rankBy;
  if (isNum(u.alertsSeenAt)) UI.alertsSeenAt = u.alertsSeenAt;
  if (typeof u.pro === 'boolean') UI.pro = u.pro;
}
/* Einfache Ansicht blendet die Analysedaten der Kauf-/Verkaufsentscheidung aus (Elemente mit Klasse .an);
   berechnet und genutzt werden sie weiterhin. */
function applyPro() {
  document.body.classList.toggle('pro', UI.pro);
  if (!UI.pro && UI.detailTab === 'why') UI.detailTab = 'overview';
  if (!UI.pro && AN_SORTS.has(UI.sort)) { UI.sort = 'score'; UI.dir = -1; }
}
const proToggle = () => html`<button class="btn sm ${UI.pro ? 'on' : ''}" data-act="pro" aria-pressed="${UI.pro}" title="Scores, Risikofaktoren, Strategie-Stimmen, Blocker und Entscheidungsketten ein-/ausblenden">🔬 Analyse-Daten: ${UI.pro ? 'AN' : 'AUS'}</button>`;
function spark(t, w = 60, h = 20) {
  const v = t.hist.slice(-90).map(x => x.p); if (v.length < 2) return '';
  const step = Math.max(1, Math.floor(v.length / 30)); const s = v.filter((_, i) => i % step === 0 || i === v.length - 1);
  const lo = Math.min(...s), hi = Math.max(...s), d = hi - lo || hi || 1;
  const pts = s.map((y, i) => (i * w / (s.length - 1)).toFixed(1) + ',' + (h - 2 - (y - lo) / d * (h - 4)).toFixed(1)).join(' ');
  return raw(`<svg class="spark" width="${w}" height="${h}" aria-hidden="true"><polyline fill="none" stroke="${s[s.length - 1] >= s[0] ? '#22e58f' : '#ff5470'}" stroke-width="1.6" points="${pts}"/></svg>`);
}
function tokenLinks(t) {
  const pair = (t.A && t.A.core.pairAddress) || (t.snap && t.snap.pairAddress) || null;
  const L = [['DexScreener', LINKS.dexscreener(pair, t.mint)], ['RugCheck', LINKS.rugcheck(t.mint)], ['Solscan', LINKS.solscanToken(t.mint)]];
  if (pair) L.push(['Axiom', LINKS.axiom(pair)], ['GeckoTerminal', LINKS.gecko(pair)], ['Pool (Solscan)', LINKS.solscanAccount(pair)]);
  L.push(['Birdeye', LINKS.birdeye(t.mint)], ['X-Suche', LINKS.xsearch(t.mint)]);
  for (const l of t.meta.links.slice(0, 6)) {
    let host = ''; try { host = new URL(l.url).hostname.replace(/^www\./, ''); } catch (e) { continue; }
    const name = l.type === 'twitter' || host === 'x.com' || host === 'twitter.com' ? '𝕏 ' + host : l.type === 'telegram' || host === 't.me' ? '✈ Telegram' : l.type === 'discord' ? 'Discord' : '🌐 ' + host;
    L.push([name, l.url]);
  }
  return L.filter(x => safeUrl(x[1]));
}
const linkHtml = L => html`${L.map(([n, u]) => html`<a href="${u}" target="_blank" rel="noopener noreferrer">${n}</a>`)}`;

/* ---------- Toasts ---------- */
function toast(level, msg, sub) {
  const box = $('toasts'); if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (['SUCCESS', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'].includes(level) ? level : 'INFO');
  el.setAttribute('role', level === 'ERROR' || level === 'CRITICAL' ? 'alert' : 'status');
  setHTML(el, html`${msg}${sub ? html`<small>${sub}</small>` : ''}`);
  el.addEventListener('click', () => el.remove(), { once: true });
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => el.remove(), level === 'ERROR' || level === 'CRITICAL' ? 7000 : 3800);
}

/* ---------- Sound / Vibration / Browser-Benachrichtigungen (ohne Endlosschleifen) ---------- */
let audioCtx = null, lastBeep = 0;
function unlockAudio() {
  if (!audioCtx) { try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audioCtx = new AC(); } catch (e) { audioCtx = null; } }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
}
function beep(level) {
  if (!core.S().sound || !audioCtx || Date.now() - lastBeep < 2500) return;
  lastBeep = Date.now();
  try { const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = level === 'CRITICAL' || level === 'ERROR' ? 440 : 880; g.gain.value = 0.08; o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.15); } catch (e) { /* Audio nicht verfügbar */ }
}
function showNotification(title, body) {
  if (!core.S().notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const f = () => { try { new Notification(title, { body }); } catch (e) { /* nicht unterstützt */ } };
  if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) navigator.serviceWorker.getRegistration().then(r => (r ? r.showNotification(title, { body }) : f())).catch(f); else f();
}
function updateNotifyBtn() {
  const b = $('btnNotify'); if (!b) return;
  if (!('Notification' in window)) setText(b, '🔕 nicht unterstützt');
  else setText(b, Notification.permission === 'granted' ? '🔔 Alarme aktiv' : Notification.permission === 'denied' ? '🔕 blockiert' : '🔔 Alarme an');
}
const NOTIFY_TYPES = new Set(['BUY_CANDIDATE', 'X2', 'TP_HIT', 'STOP_HIT', 'RISK', 'SYSTEM', 'WATCH', 'TRADE', 'SECURITY', 'API_FAIL', 'RPC_FAIL']);
core.on('alert', e => {
  if (NOTIFY_TYPES.has(e.type) || e.level === 'CRITICAL') {
    toast(e.level, e.tag + (e.sym ? ' · ' + e.sym : ''), e.detail);
    beep(e.level);
    const activated = navigator.userActivation ? navigator.userActivation.hasBeenActive : UI.lastTouch > 0;
    if (core.S().vibrate && navigator.vibrate && activated) { try { navigator.vibrate(e.level === 'CRITICAL' ? [300, 100, 300] : [150, 80, 150]); } catch (x) { /* */ } }
    showNotification(e.tag, (e.sym ? e.sym + ' · ' : '') + e.detail);
  }
  scheduleRender();
});

/* ---------- Kopieren (mit manuellem Fallback) ---------- */
function copyText(text, label) {
  if (!text) return;
  const ok = () => toast('SUCCESS', (label || 'Kopiert') + ' ✓', text.length > 20 ? shortAddr(text) : text);
  const manual = () => openModal({ title: 'Manuell kopieren', body: html`<input id="copyManual" readonly value="${text}" aria-label="Zu kopierender Text"><p class="note">Automatisches Kopieren wird hier blockiert. Tippe ins Feld, wähle „Alles auswählen“ und dann „Kopieren“.</p>`, onOpen: () => { const i = document.getElementById('copyManual'); if (i) { i.focus(); i.select(); try { i.setSelectionRange(0, text.length); } catch (e) { /* */ } } } });
  let done = false;
  try {
    const e = document.createElement('textarea'); e.value = text; e.readOnly = true; e.style.cssText = 'position:fixed;top:0;left:0;font-size:16px;opacity:0';
    document.body.appendChild(e); e.focus(); e.select(); e.setSelectionRange(0, text.length); done = document.execCommand('copy'); e.remove();
  } catch (x) { done = false; }
  if (done) return ok();
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, manual); else manual();
}
function download(name, mime, data) {
  const blob = new Blob([data], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/* ---------- Modal & Bestätigungen ---------- */
let modalState = null;
function openModal({ title, body, actions, onOpen, collect }) {
  closeModal(null);
  const m = $('modal');
  setText($('modalTitle'), title);
  setHTML($('modalBody'), body);
  const acts = actions || [{ id: 'close', label: 'Schließen' }];
  setHTML($('modalActions'), html`${acts.map(a => html`<button class="btn ${a.cls || ''}" data-modal="${a.id}" ${a.disabled ? raw('disabled') : ''} id="${'mb-' + a.id}">${a.label}</button>`)}`);
  m.hidden = false;
  const ret = document.activeElement;
  return new Promise(res => {
    modalState = { res, collect, ret };
    setTimeout(() => { const f = m.querySelector('input:not([readonly]),select,button:not([disabled])'); if (f) f.focus(); if (onOpen) onOpen(); }, 30);
  });
}
function closeModal(id) {
  const m = document.getElementById('modal'); const st = modalState; modalState = null;
  let data = null; if (st && st.collect && id) { try { data = st.collect(); } catch (e) { data = null; } }
  if (m && !m.hidden) { m.hidden = true; setHTML(document.getElementById('modalBody'), ''); }
  if (st) { st.res({ id, data }); if (st.ret && st.ret.focus && document.body.contains(st.ret)) { try { st.ret.focus(); } catch (e) { /* */ } } }
}
async function confirmDialog(title, text, o = {}) {
  const r = await openModal({
    title, body: html`<p>${text}</p>${o.extra || ''}${o.requireText ? html`<p class="note">Zur Bestätigung „${o.requireText}“ eingeben:</p><input id="confirmText" autocomplete="off" aria-label="Bestätigungstext">` : ''}`,
    actions: [{ id: 'cancel', label: 'Abbrechen' }, { id: 'ok', label: o.confirmLabel || 'Bestätigen', cls: o.danger ? 'bad' : 'pri' }],
    collect: () => (document.getElementById('confirmText') || {}).value
  });
  if (r.id !== 'ok') return false;
  if (o.requireText && (r.data || '').trim() !== o.requireText) { toast('WARNING', 'Abgebrochen', 'Bestätigungstext stimmt nicht'); return false; }
  return true;
}

/* ---------- Navigation ---------- */
const VIEWS = [
  ['scanner', '📡', 'Scanner'], ['signals', '⚡', 'Signale'], ['markets', '🌐', 'Markt'], ['watchlist', '👁', 'Watchlist'], ['positions', '💼', 'Positionen'],
  ['orders', '🧾', 'Orders'], ['history', '📜', 'History'], ['backtest', '🧪', 'Backtest'], ['analytics', '📊', 'Analytics'], ['learning', '🧠', 'Learning KI'], ['risk', '🛡', 'Risiko'],
  ['alerts', '💬', 'Alarm-Chat'], ['diagnostics', '🩺', 'Diagnose'], ['system', '🖥', 'System & API'], ['logs', '📋', 'Logs'], ['settings', '⚙', 'Einstellungen'], ['knowledge', '📚', 'Wissen']
];
const NAV_GROUPS = [['Trading', ['scanner', 'signals', 'positions', 'watchlist', 'orders', 'history', 'markets']], ['Analyse', ['analytics', 'learning', 'risk', 'backtest', 'alerts']], ['System & Diagnose', ['diagnostics', 'system', 'logs', 'settings', 'knowledge']]];
const BOTTOM = [['scanner', '📡', 'Scanner'], ['signals', '⚡', 'Signale'], ['positions', '💼', 'Positionen'], ['alerts', '💬', 'Alarme'], ['more', '☰', 'Mehr']];
function buildNav() {
  setHTML($('sidebar'), html`${VIEWS.map(([id, ic, name]) => html`<button data-act="view" data-view="${id}" id="nv-${id}" aria-label="${name}"><i aria-hidden="true">${ic}</i><span>${name}</span><span class="cnt" id="nc-${id}"></span></button>`)}
    <div class="sidefoot" id="sideFoot"></div>`);
  setHTML($('bottomnav'), html`${BOTTOM.map(([id, ic, name]) => html`<button data-act="${id === 'more' ? 'more' : 'view'}" data-view="${id}" id="bn-${id}" aria-label="${name}"><i aria-hidden="true">${ic}</i>${name}<span class="bdg" id="bd-${id}"></span></button>`)}`);
}
function showView(v, focus) {
  if (!VIEWS.some(x => x[0] === v)) return;
  UI.view = v; saveUi();
  document.body.classList.toggle('v-home', v === 'scanner');
  for (const [id] of VIEWS) { const s = document.getElementById('v-' + id); if (s) s.classList.toggle('hidden', id !== v); }
  renderNav();
  renderView(true);
  if (v === 'alerts') { UI.alertsSeenAt = Date.now(); saveUi(); }
  if (focus) { const c = document.getElementById('center'); if (c) { c.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'auto' }); } }
}
function renderNav() {
  const st = core.state, ss = st.metrics.scanStats || {};
  for (const [id] of VIEWS) { const b = document.getElementById('nv-' + id); if (b) { b.classList.toggle('on', id === UI.view); b.setAttribute('aria-current', id === UI.view ? 'page' : 'false'); } }
  for (const [id] of BOTTOM) { const b = document.getElementById('bn-' + id); if (b) b.classList.toggle('on', id === UI.view || (id === 'more' && !BOTTOM.some(x => x[0] === UI.view))); }
  const counts = { scanner: st.markets.size, signals: ss.candidates || 0, watchlist: Object.keys(st.watchlist).length, positions: st.positions.length, orders: st.orders.filter(o => !TERMINAL.has(o.state)).length || '', alerts: st.feed.length || '' };
  for (const [id, n] of Object.entries(counts)) setText(document.getElementById('nc-' + id), n === 0 ? '0' : n);
  const unread = st.feed.filter(e => e.ts > UI.alertsSeenAt).length;
  setText(document.getElementById('bd-signals'), ss.candidates ? String(ss.candidates) : '');
  setText(document.getElementById('bd-positions'), st.positions.length ? String(st.positions.length) : '');
  setText(document.getElementById('bd-alerts'), unread && UI.view !== 'alerts' ? (unread > 99 ? '99+' : String(unread)) : '');
  const rd = core.readiness();
  setText(document.getElementById('bd-more'), rd.state === 'BLOCKED' || rd.state === 'ERROR' || core.state.reconciliation.required ? '!' : '');
  setText(document.getElementById('sideFoot'), `Smart Lab v${APP_VERSION} · Strategy ${STRATEGY_VERSION} · Data ${DATA_ENGINE_VERSION}`);
}

/* ---------- Top Bar, Banner, Control Panel, Tiles ---------- */
const MS_TEXT = { READY: 'BOT READY', WAITING: 'BOT WAITING', BLOCKED: 'BOT BLOCKED', ERROR: 'BOT ERROR', EMERGENCY_STOP: 'EMERGENCY STOP', PAUSED: 'BOT PAUSED', STOPPED: 'BOT STOPPED' };
const MS_CLS = { READY: 'ok', WAITING: 'info', BLOCKED: 'warn', ERROR: 'bad', EMERGENCY_STOP: 'bad', PAUSED: 'warn', STOPPED: 'warn' };
function masterStatus() {
  const rd = core.readiness();
  return { state: rd.state, cls: MS_CLS[rd.state] || '', text: MS_TEXT[rd.state] || rd.state, why: rd.reason, rd };
}
const RANKS = { ONLINE: 0, UNKNOWN: 1, DEGRADED: 2, STALE: 3, OFFLINE: 4 };
function bestRpcStatus() { const s = core.rpcEndpoints().map(e => core.http.status(e.name)); return s.length ? s.sort((a, b) => RANKS[a] - RANKS[b])[0] : 'OFFLINE'; }
function renderTop() {
  const st = core.state, b = st.bot, S = core.S(), h = core.systemHealth(), now = Date.now();
  const ms = masterStatus();
  const unreal = st.positions.reduce((a, p) => a + (isNum(p.pnlUsd) ? p.pnlUsd : 0), 0);
  const unknown = st.positions.some(p => !isNum(p.pnlUsd));
  const pnl = st.portfolio.realized + unreal;
  const pr = core.portfolioRisk(); const rpc = bestRpcStatus(); const w = st.wallet;
  const mm = core.monitorMetrics(), lr = core.liveReadiness(), anoms = Object.values(st.monitor.active);
  const pills = [
    [ms.cls + ' pm', '', ms.text, ms.why],
    ['info pm', 'Modus', st.mode.replace('_', ' '), 'Handelsmodus · LIVE separat & nur mit erfülltem Gating'],
    [(b.autoTrading ? 'ok' : '') + ' pm', 'Auto', b.autoTrading ? 'AN' : 'AUS', 'Auto-Trading (nur SIMULATION, nie Echtgeld)'],
    [(w.status === 'CONNECTED' ? 'ok' : '') + ' pm an', 'Wallet', w.status === 'CONNECTED' ? shortAddr(w.pubkey) : w.status === 'NO_PROVIDER' ? 'kein Provider' : w.status === 'ERROR' ? 'Fehler' : 'nicht verbunden', 'nur lesend, keine Signaturen'],
    [stCls(rpc) + ' an', 'RPC', rpc + (st.rpc.latency != null && rpc === 'ONLINE' ? ' ' + st.rpc.latency + 'ms' : ''), st.rpc.slot ? 'Slot ' + st.rpc.slot + ' · ' + (st.rpc.endpoint || '') : 'kein verifizierter Slot'],
    [(h.score >= 80 ? 'ok' : h.score >= S.minSystemHealth ? 'warn' : 'bad') + ' an', 'Health', String(h.score), 'System Health 0–100 (APIs, RPC, Frische, Fehler)'],
    [(mm.data.fresh == null ? '' : mm.data.fresh >= 0.8 ? 'ok' : mm.data.fresh >= 0.5 ? 'warn' : 'bad') + ' an', 'Daten', mm.data.fresh == null ? '—' : Math.round(mm.data.fresh * 100) + ' %', 'Anteil frischer Marktdaten'],
    [(lr.ready ? 'ok' : 'bad') + ' an', 'Live', lr.ready ? 'bereit' : 'gesperrt', `LIVE-Gate: ${lr.checks.filter(c => !c.ok).length} von ${lr.checks.length} Prüfungen offen (${lr.checks.filter(c => !c.ok).map(c => c.name).join(', ')})`],
    [(anoms.some(a => a.sev === 'CRITICAL') ? 'bad pm' : anoms.length ? 'warn pm' : 'ok an'), 'Monitor', anoms.length ? anoms.length + ' Anomalie' + (anoms.length > 1 ? 'n' : '') : 'ok', anoms.length ? anoms.map(a => `${a.code}: ${a.msg}`).join(' · ') + (S.anomalyMode === 'act' ? '' : ' · Modus „nur warnen“') : 'keine Anomalien'],
    [(pnl > 0.005 ? 'ok' : pnl < -0.005 ? 'bad' : '') + ' pm', 'PnL', fmtSigned(pnl) + (unknown ? '*' : ''), 'SIMULIERT · fee-adjusted' + (unknown ? ' · * Position ohne aktuellen Preis' : '')],
    ['pm', 'Pos', `${st.positions.length}/${S.maxOpenPositions > 0 ? S.maxOpenPositions : '∞'}`, 'offene Positionen'],
    [(pr.score >= 60 ? 'bad' : pr.score >= 35 ? 'warn' : 'ok') + ' pm', 'Risk', String(pr.score), 'Portfolio Risk'],
    ['an', '', `${fmtTime(now)} · Scan ${st.scanner.lastAt ? fmtAge(now - st.scanner.lastAt) : '—'}`, 'Uhrzeit · letzter Scan']
  ];
  patch($('tbPills'), html`${pills.map(p => html`<span class="pill ${p[0]}" title="${p[3] || ''}">${p[1] ? p[1] + ' ' : ''}<b>${p[2]}</b></span>`)}`);
  const e = $('btnEstop');
  if (e) { e.classList.toggle('on', b.emergency); setText(e, b.emergency ? '⛔ E-STOP AKTIV · freigeben' : '⛔ EMERGENCY STOP'); e.setAttribute('aria-pressed', b.emergency ? 'true' : 'false'); }
  const ver = $('verBanner'); if (ver) { setText(ver, 'v' + APP_VERSION); ver.title = `App ${APP_VERSION} · Strategy ${STRATEGY_VERSION} · Data Engine ${DATA_ENGINE_VERSION} · Parameter v${st.activeParam}`; }
  renderBanner();
}
function renderBanner() {
  const st = core.state, b = st.bot, now = Date.now(), msgs = [];
  let bad = false;
  if (b.emergency) { msgs.push(`⛔ EMERGENCY STOP aktiv (${b.emergencyReason}) – neue Käufe blockiert. Positionen: ${core.S().estopPositionRule === 'close' ? 'werden geschlossen' : 'werden gehalten & überwacht'}.`); bad = true; }
  if (!navigator.onLine) { msgs.push('📴 OFFLINE – Anzeige möglich, Trading deaktiviert.'); bad = true; }
  const fresh = [...st.markets.values()].some(t => t.snap && now - t.snap.fetchedAt < core.S().staleAfterSec * SEC);
  if (st.scanner.running && !fresh && st.scanner.id > 2) {
    const err = core.http.snapshot('dexPairs');
    msgs.push(`DATA UNAVAILABLE – keine frischen Live-Daten (${(err && err.lastError) || 'keine Antwort'}). Öffne die App im Browser (Safari/Chrome) über deinen Hoster, nicht in einer eingebetteten Vorschau. Es werden nie Fake-Daten angezeigt.`);
    bad = true;
  }
  if (b.state === 'STOPPED' && st.positions.length) msgs.push(`■ Bot gestoppt – ${st.positions.length} offene Position(en) werden NICHT überwacht.`);
  if (b.safeMode) msgs.push('🛡 Safe Mode aktiv – Analyse läuft, keine neuen Käufe.' + (b.safeAuto ? ' Automatisch nach Fehlern aktiviert; nach Prüfung in der Steuerung deaktivieren.' : ''));
  if (st.risk.reviewRequired) msgs.push(`⚠️ Verlustserie (${st.risk.lossStreak}) – kontrollierter Review empfohlen (Analytics/History). Hinweis in Risiko-Ansicht bestätigen.`);
  if (st.reconciliation.required) { msgs.push(html`⚖️ RECONCILIATION REQUIRED – ${st.reconciliation.issues.length} ungeklärte Punkt(e) nach Neustart. Neue Käufe sind blockiert, bis du den Abgleich prüfst. <button class="btn sm warn" data-act="reconcile">Abgleich prüfen</button>`); bad = true; }
  if (!st.storageOk) msgs.push('💾 Speichern fehlgeschlagen – Zustand wird nicht dauerhaft gesichert (privater Modus/Speicher voll?).');
  const el = $('banner'); if (!el) return;
  el.hidden = !msgs.length; el.classList.toggle('bad', bad);
  patch(el, html`${msgs.map(m => html`<div>${m}</div>`)}`);
}
function buildControl() {
  const mobile = window.matchMedia('(max-width:700px)').matches;
  setHTML($('control'), html`
    <div class="ctl-top"><span class="mstat" id="cStatus" role="status">–</span><div class="ctl-why" id="cWhy" aria-live="polite"></div></div>
    <div class="ov" id="cOverview"></div>
    <details class="ctl-more" id="cCtlBox" ${mobile ? '' : raw('open')}><summary>Steuerung: Start · Pause · Stop · Safe Mode · Modus</summary>
    <div class="ctl-row">
      <button class="btn ok" data-act="start" id="cStart">▶ START</button>
      <button class="btn warn" data-act="pause" id="cPause">⏸ PAUSE</button>
      <button class="btn bad" data-act="stop" id="cStop">■ STOP</button>
      <button class="btn" data-act="safe" id="cSafe" aria-pressed="false">🛡 SAFE MODE</button>
      <div class="seg" role="group" aria-label="Handelsmodus">
        <button data-act="mode" data-mode="SIMULATION" id="mSIMULATION">SIMULATION</button>
        <button data-act="mode" data-mode="PAPER" id="mPAPER">PAPER</button>
        <button data-act="mode" data-mode="READ_ONLY" id="mREAD_ONLY">READ ONLY</button>
        <button data-act="live" class="na" id="mLIVE" title="Nur mit erfülltem Live-Gating – derzeit nicht verfügbar">LIVE</button>
      </div>
    </div></details>`);
}
function renderControl() {
  const b = core.state.bot, st = core.state;
  const s = $('cStart'), p = $('cPause'), x = $('cStop'), sf = $('cSafe');
  if (!s) return;
  s.disabled = b.emergency || b.state === 'RUNNING' || b.state === 'RECOVERING' || b.state === 'STARTING';
  p.disabled = !['RUNNING', 'RECOVERING'].includes(b.state);
  x.disabled = b.state === 'STOPPED';
  sf.classList.toggle('on', b.safeMode); sf.setAttribute('aria-pressed', String(b.safeMode));
  for (const m of ['SIMULATION', 'PAPER', 'READ_ONLY']) { const el = $('m' + m); if (el) { el.classList.toggle('on', st.mode === m); el.setAttribute('aria-pressed', String(st.mode === m)); } }
  const ms = masterStatus(), cs = $('cStatus');
  if (cs) { cs.className = 'mstat ' + ms.state; setText(cs, ms.text); }
  const soft = ms.rd.soft.filter(x2 => !['AUTO_TRADING_OFF', 'PAPER_MANUAL', 'BOT_NOT_RUNNING', 'RECOVERING'].includes(x2.code));
  patch($('cWhy'), html`${ms.why}${soft.length ? html` <span class="dim an">· Hinweis: ${soft.map(x2 => x2.msg).join(' · ')}</span>` : ''}`);
  const eq = core.equityInfo(), w = st.wallet;
  const unreal = st.positions.reduce((a, q) => a + (isNum(q.pnlUsd) ? q.pnlUsd : 0), 0), pnl = st.portfolio.realized + unreal;
  const walletTxt = w.status === 'CONNECTED' ? shortAddr(w.pubkey) : w.status === 'NO_PROVIDER' ? 'kein Provider' : w.status === 'CONNECTING' ? 'verbinde …' : w.status === 'ERROR' ? 'Fehler' : 'nicht verbunden';
  patch($('cOverview'), html`
    <div class="kv"><small>Modus</small><b>${st.mode.replace('_', ' ')}</b></div>
    <button class="kv" data-act="auto" role="switch" aria-checked="${b.autoTrading}" title="Auto-Trading – nur SIMULATION, nie Echtgeld"><small>Auto-Trading</small><span class="switch ${b.autoTrading ? 'on' : ''}"><span class="tg"></span>${b.autoTrading ? 'AN' : 'AUS'}</span></button>
    <button class="kv an" data-act="walletModal"><small>Wallet (lesend)</small><b>${walletTxt}${w.balanceLamports != null ? ' · ' + Number(lamportsToSol(BigInt(w.balanceLamports))).toFixed(3) + ' SOL' : ''}</b></button>
    <div class="kv"><small>Portfolio</small><b>${fmtUsd(eq.equity)}<em class="lbl SIMULATED">SIM</em></b></div>
    <div class="kv"><small>PnL (fee-adj.)</small><b class="${cls(pnl)}">${fmtSigned(pnl)}</b></div>
    <button class="kv" data-act="view" data-view="positions"><small>Positionen</small><b>${st.positions.length}/${core.S().maxOpenPositions} · ${fmtUsd(eq.exposure)}</b></button>`);
}
const TILE_ICONS = {
  t1: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12l6-6"/></svg>',
  t2: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
  t3: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  t4: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0112 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 004 0"/></svg>'
};
function buildTiles() {
  setHTML($('tiles'), html`
    <button class="tile t1" data-act="view" data-view="scanner" id="tl-scanner"><span class="tb" id="tb1">–</span>${raw(TILE_ICONS.t1)}<div><b>Scanner</b><small id="k1">–</small><i class="tn" id="kn1"></i></div></button>
    <button class="tile t2" data-act="view" data-view="signals" id="tl-signals"><span class="tb" id="tb2">–</span>${raw(TILE_ICONS.t2)}<div><b>Signale</b><small id="k2">–</small><i class="tn" id="kn2"></i></div></button>
    <button class="tile t3" data-act="view" data-view="watchlist" id="tl-watchlist"><span class="tb">LOKAL</span>${raw(TILE_ICONS.t3)}<div><b>Watchlist</b><small id="k3">–</small><i class="tn" id="kn3"></i></div></button>
    <button class="tile t4" data-act="view" data-view="alerts" id="tl-alerts"><span class="tb" id="tb4">–</span>${raw(TILE_ICONS.t4)}<div><b>Alarm-Chat</b><small id="k4">–</small><i class="tn" id="kn4"></i><div class="bb"><i id="kbar"></i></div></div></button>`);
}
function renderTiles() {
  const st = core.state, ss = st.metrics.scanStats || {}, dex = core.http.status('dexPairs');
  const liveLbl = dex === 'ONLINE' ? 'LIVE' : dex === 'UNKNOWN' ? 'START' : dex;
  for (const id of ['tb1', 'tb2', 'tb4']) setText($(id), liveLbl);
  const toks = [...st.markets.values()].filter(t => t.A);
  setText($('k1'), `${toks.length} Tokens · ${toks.filter(t => t.A.finalScore >= core.S().minScore).length} Empfehlungen`);
  setText($('k2'), `${ss.candidates || 0} Kandidaten` + (UI.pro ? ` · ${ss.withSignals || 0} mit Signal` : ''));
  const top = toks.length ? Math.max(...toks.map(t => t.A.finalScore)) : 0;
  setText($('k3'), `${Object.keys(st.watchlist).length} ★` + (UI.pro ? ` · Top ${top}` : ''));
  let tb = 0, tsl = 0; for (const t of toks) { if (isNum(t.A.tx.b1)) tb += t.A.tx.b1; if (isNum(t.A.tx.s1)) tsl += t.A.tx.s1; }
  const br = tb + tsl ? tb / (tb + tsl) * 100 : null;
  setText($('k4'), br == null ? 'Käufer — (keine Daten)' : `Käufer ${br.toFixed(0)} % (1h)`);
  const kb = $('kbar'); if (kb) kb.style.width = (br == null ? 50 : br) + '%';
  setText($('kn1'), String(toks.length)); setText($('kn2'), String(ss.candidates || 0)); setText($('kn3'), Object.keys(st.watchlist).length + ' ★'); setText($('kn4'), br == null ? '—' : br.toFixed(0) + '%');
  for (const [v, id] of [['scanner', 'tl-scanner'], ['signals', 'tl-signals'], ['watchlist', 'tl-watchlist'], ['alerts', 'tl-alerts']]) { const el = document.getElementById(id); if (el) el.classList.toggle('on', UI.view === v); }
}

/* ---------- Scanner-Ansicht (Live Market Table, keyed Rows) ---------- */
const SORTS = [['score', 'Score', t => t.A.finalScore], ['mc', 'MC', t => t.A.core.mc], ['mom', '5m 🚀', t => t.A.price.chg.m5], ['chg', '1h %', t => t.A.price.chg.h1], ['vol', 'Volumen', t => t.A.vol.h1], ['liq', 'Liquidität', t => t.A.liq.usd], ['momentum', 'Momentum', t => t.A.price.momentum], ['risk', 'Risiko', t => t.A.risk.total], ['conf', 'Confidence', t => t.A.confidence.total], ['opp', 'Opportunity', t => t.A.opportunity], ['age', 'Neu', t => t.A.core.pairAge]];
const AN_SORTS = new Set(['vol', 'liq', 'momentum', 'conf', 'opp']);
const HEAD = [['', null], ['Token', null], ['Coin-Preis', null, 'r'], ['MC', 'mc', 'r'], ['5m', 'mom', 'r'], ['1h', 'chg', 'r'], ['Liq', 'liq', 'r an'], ['Vol 1h', 'vol', 'r c-vol an'], ['K/V 1h', null, 'r c-bs an'], ['Mom.', 'momentum', 'r c-mom an'], ['Risk', 'risk'], ['Conf', 'conf', 'r an'], ['Score', 'score'], ['Status', null], ['Trend', null, 'c-spark an'], ['', null]];
function passesFilter(t, q, S) {
  const A = t.A, D = t.D;
  if (q && !(t.symbol.toLowerCase().includes(q) || (t.name || '').toLowerCase().includes(q) || t.mint.toLowerCase().includes(q))) return false;
  if (UI.onlyRec && !(A.finalScore >= S.minScore || D.decision === 'APPROVED' || D.decision === 'BUY_CANDIDATE')) return false;
  if (UI.safeOnly && (['HIGH', 'CRITICAL', 'UNKNOWN'].includes(A.risk.level) || A.flags.some(f => ['DÜNNE LIQ', 'VERKÄUFER', 'DUMP', 'PUMP'].includes(f)))) return false;
  if (UI.age && A.ageClass !== UI.age) return false;
  if (A.risk.total > UI.maxRisk) return false;
  if (A.confidence.total < UI.minConf) return false;
  return true;
}
function rowHtml(t) {
  const A = t.A, D = t.D, c = A.price.chg, w = !!core.state.watchlist[t.id];
  return html`<button class="star ${w ? 'on' : ''}" data-act="star" data-id="${t.id}" aria-label="${w ? 'Von Watchlist entfernen' : 'Zur Watchlist hinzufügen'}">${w ? '★' : '☆'}</button>
<div class="tok"><b>${t.symbol}</b><small>${t.name}</small><span class="flags an">${A.flags.map(f => html`<span class="f ${f === 'BOOST' ? 'B' : f === 'PUMP' || f === 'DUMP' ? 'X' : ''}">${f}</span>`)}</span>${A.label !== 'LIVE' ? html` ${lbl(A.label)}` : ''}</div>
<div class="cell num r" title="Coin-Preis ${A.core.priceRaw || ''}">${fmtPrice(A.core.price)}</div>
<div class="cell num r mcv" title="Market Cap">${fmtMc(A.core.mc)}</div>
<div class="cell num r ${cls(c.m5)}">${fmtPct(c.m5, 0)}</div>
<div class="cell num r ${cls(c.h1)}">${fmtPct(c.h1, 0)}</div>
<div class="cell num r an">${fmtUsd(A.liq.usd)}</div>
<div class="cell num r c-vol an">${fmtUsd(A.vol.h1)}</div>
<div class="cell num r c-bs an">${A.tx.b1 != null ? A.tx.b1 : '—'}/${A.tx.s1 != null ? A.tx.s1 : '—'}</div>
<div class="cell num r c-mom an">${A.price.momentum}</div>
<div class="cell">${lvlChip(A.risk.level, A.risk.total)}</div>
<div class="cell num r an">${A.confidence.total}%</div>
<div class="c-score">${scoreChip(A.finalScore)}</div>
<div class="c-status">${decChip(D.decision)}</div>
<div class="cell c-spark an">${spark(t)}</div>
<button class="more" data-act="ctx" data-id="${t.id}" aria-label="Aktionen für ${t.symbol}">⋯</button>
<div class="cal"><div><small>Coin-Preis</small>${fmtPrice(A.core.price)}</div><div class="mcv"><small>MC</small>${fmtMc(A.core.mc)}</div><div class="${cls(c.m5)}"><small>5m</small>${fmtPct(c.m5, 0)}</div><div class="${cls(c.h1)}"><small>1h</small>${fmtPct(c.h1, 0)}</div><div><small>Risk</small>${A.risk.level === 'UNKNOWN' ? '?' : A.risk.total}</div><div class="an"><small>Liq</small>${fmtUsd(A.liq.usd)}</div><div class="an"><small>Vol 1h</small>${fmtUsd(A.vol.h1)}</div><div class="an"><small>Käufer</small>${A.tx.ratio1 != null ? (A.tx.ratio1 * 100).toFixed(0) + '%' : '—'}</div></div>
<button class="ca" data-act="copy" data-v="${t.mint}" data-l="Mint" aria-label="Mint-Adresse kopieren"><code>${t.mint}</code><span>⧉ kopieren</span></button>`;
}
function hotCard(t) {
  return html`<div class="hc" data-act="select" data-id="${t.id}" role="button" tabindex="0"><small>🔥 Top Score · ${DEC_LABEL[t.D.decision]}</small><br><b>${t.symbol}</b> ${scoreChip(t.A.finalScore)}<br><small>Coin-Preis ${fmtPrice(t.A.core.price)} · <span class="mcv">${fmtMc(t.A.core.mc)}</span></small><br><small>5m ${fmtPct(t.A.price.chg.m5, 0)} · Risiko ${t.A.risk.level}</small><span class="an"><br>${spark(t, 110, 22)}</span></div>`;
}
function renderScanner() {
  const st = core.state, S = core.S(), now = Date.now();
  patch($('sortChips'), html`${SORTS.map(([k, n]) => html`<button data-act="sort" data-k="${k}" class="${(k === UI.sort ? 'on' : '') + (AN_SORTS.has(k) ? ' an' : '')}" aria-pressed="${k === UI.sort}">${n}${k === UI.sort ? (UI.dir < 0 ? ' ▼' : ' ▲') : ''}</button>`)}`);
  patch($('mkHead'), html`${HEAD.map(([n, k, c]) => (k ? html`<button class="${(c || '') + (UI.sort === k ? ' on' : '')}" data-act="sort" data-k="${k}">${n}${UI.sort === k ? (UI.dir < 0 ? ' ▼' : ' ▲') : ''}</button>` : html`<span class="${c || ''}">${n}</span>`))}`);
  for (const [id, v] of [['swRec', UI.onlyRec], ['swSafe', UI.safeOnly]]) { const el = document.getElementById(id); if (el) { el.classList.toggle('on', v); el.setAttribute('aria-checked', String(v)); } }
  const all = [...st.markets.values()].filter(t => t.A && t.D);
  const q = UI.q.trim().toLowerCase();
  const getter = (SORTS.find(s => s[0] === UI.sort) || SORTS[0])[2];
  const list = all.filter(t => passesFilter(t, q, S)).sort((a, b) => {
    const x = getter(a), y = getter(b);
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * UI.dir;
  }).slice(0, 150);
  const hot = all.filter(t => t.D.decision !== 'REJECTED').sort((a, b) => b.A.finalScore - a.A.finalScore).slice(0, 3);
  patch($('hot'), html`${hot.map(hotCard)}`);
  const dex = core.http.snapshot('dexPairs');
  patch($('mkInfo'), html`${all.length} gescannt · ${list.length} angezeigt · sortiert nach ${(SORTS.find(s => s[0] === UI.sort) || SORTS[0])[1]}<span class="an"> · DexScreener ${dex ? dex.status : '—'}${dex && dex.latency ? ' · ' + Math.round(dex.latency) + ' ms' : ''} · ${core.state.regime.tags.join(' · ')}</span>`);
  const box = $('mkList'); if (!box) return;
  if (!box._rows) box._rows = new Map();
  const rows = box._rows, keep = new Set();
  if (!list.length) {
    for (const el of rows.values()) el.remove(); rows.clear();
    const msg = !st.markets.size ? (st.scanner.running ? 'Warte auf Live-Daten … (keine Demo- oder Fake-Daten)' : 'Scanner gestoppt – START drücken.') : all.length ? 'Keine Tokens passen zu Suche/Filter. Das ist normal, wenn die Filter streng sind.' : 'Tokens entdeckt, warte auf Marktdaten …';
    patch(box, html`<div class="empty">${msg}</div>`);
    return;
  }
  if (box._sig) { box.innerHTML = ''; box._sig = null; }
  list.forEach((t, i) => {
    let el = rows.get(t.id);
    if (!el) { el = document.createElement('div'); el.dataset.id = t.id; el.setAttribute('role', 'row'); el.tabIndex = 0; rows.set(t.id, el); }
    keep.add(t.id);
    const c = 'mrow' + (t.D.decision === 'APPROVED' || t.D.decision === 'BUY_CANDIDATE' ? ' hit' : '') + (t.id === st.selected ? ' sel' : '') + (now - t.meta.discoveredAt < 6000 ? ' nw' : '');
    if (el.className !== c) el.className = c;
    patch(el, rowHtml(t));
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
  });
  for (const [id, el] of rows) if (!keep.has(id)) { el.remove(); rows.delete(id); }
}
function renderFilterForm() {
  const S = core.S();
  const f = [['minLiq', 'Min. Liquidität $'], ['minVol1h', 'Min. Vol 1h $'], ['minMcap', 'Min. MC ($)'], ['maxMcap', 'Max. MC ($)'], ['minBuyRatio', 'Min. Käuferanteil (0–1)'], ['minScore', 'Min. Final Score']];
  patch($('filterForm'), html`<div class="row" style="margin-bottom:10px"><b class="mut">Profil:</b>${Object.keys(PROFILES).map(p => html`<button class="btn sm" data-act="profile" data-p="${p}">${p}</button>`)}</div>
    <div class="form">${f.map(([k, n]) => html`<label class="fld">${n}<input type="number" step="any" data-set="${k}" value="${S[k]}"></label>`)}
    <label class="fld">Ansicht: max. Risk Score<input type="number" min="0" max="100" data-ui="maxRisk" value="${UI.maxRisk}"></label>
    <label class="fld">Ansicht: min. Confidence<input type="number" min="0" max="100" data-ui="minConf" value="${UI.minConf}"></label></div>
    <p class="note">Filter- und Profilwerte gelten auch für die Kaufentscheidung (Decision Engine). „Ansicht“-Filter betreffen nur die Anzeige. Harte Sicherheitsgrenzen bleiben immer aktiv.</p>`);
}

/* Kandidaten-Kette: SECURITY PASS → LIQUIDITY PASS → SCORE TOO LOW → FINAL: NO TRADE */
function chainHtml(ch) {
  if (!ch) return '';
  return html`<div class="chain" aria-label="Entscheidungskette">${ch.steps.map(x => html`<span class="${x.ok ? 'p' : x.na ? 'n' : 'x'}" title="${x.value || ''}${x.msg ? ' · ' + x.msg : ''}">${x.k} ${x.ok ? 'PASS' : x.na ? '—' : x.code.replace(/_/g, ' ')}${x.value ? html` <small class="dim">${x.value}</small>` : ''}</span><i>→</i>`)}<span class="fin ${ch.decision === 'APPROVED' || ch.decision === 'BUY_CANDIDATE' ? 'buy' : ''}">FINAL: ${ch.final}</span></div>`;
}
/* ---------- Signale (Buy Candidates, Watch, Rejection Engine) ---------- */
function signalCard(t) {
  const A = t.A, D = t.D;
  const votes = (A.strat ? A.strat.votes : []).filter(v => v.vote === 'BUY' || v.strength > 0);
  return html`<div class="card ${D.decision === 'APPROVED' || D.decision === 'BUY_CANDIDATE' ? 'hit' : ''}">
    <div class="ch"><button class="star ${core.state.watchlist[t.id] ? 'on' : ''}" data-act="star" data-id="${t.id}" aria-label="Watchlist">${core.state.watchlist[t.id] ? '★' : '☆'}</button><b>${t.symbol}</b>${decChip(D.decision)}${scoreChip(A.finalScore)}${lvlChip(A.risk.level, A.risk.total)}<span class="ag">${fmtAge(A.core.pairAge)} · ${A.ageClass}</span></div>
    <div class="grid4" style="margin-top:8px">${kv('Coin-Preis', fmtPrice(A.core.price))}${kv('MC', html`<span class="mcv">${fmtMc(A.core.mc)}</span>`)}${kv('5m', html`<span class="${cls(A.price.chg.m5)}">${fmtPct(A.price.chg.m5, 0)}</span>`)}${kv('1h', html`<span class="${cls(A.price.chg.h1)}">${fmtPct(A.price.chg.h1, 0)}</span>`)}</div>
    <div class="grid4 an" style="margin-top:8px">${kv('Opportunity', A.opportunity)}${kv('Risk', A.risk.total + ' ' + A.risk.level)}${kv('Confidence', A.confidence.total + '%')}${kv('Execution', A.executionScore)}</div>
    <div class="an" style="margin-top:8px">${A.signals.length ? A.signals.map(s => html`<span class="sig" title="${s.reason}">${SIGNAL_NAMES[s.type]} <i>${s.strength}</i></span>`) : html`<span class="mut">Keine Signale</span>`}</div>
    ${votes.length ? html`<div class="note an">Strategien: ${votes.map(v => html`<span class="chip ${v.vote === 'BUY' ? 'ok' : ''} ${v.shadow ? 'vio' : ''}" title="${v.reasons.join('; ')}">${v.name}${v.shadow ? ' (Shadow)' : ''}: ${v.vote === 'BUY' ? 'BUY' : '—'} ${v.strength}</span> `)} · Konsens ${A.strat.weightSum}</div>` : ''}
    <div class="an" style="margin-top:6px">${D.blockers.slice(0, 5).map(b => html`<span class="blk p${b.prio}" title="${b.cat} · Priorität ${b.prio}">${b.code}</span>`)}</div>
    <div class="an">${chainHtml(core.candidateChain(t))}</div>
    <div class="note">${D.reason}</div>
    <div class="row" style="margin-top:8px"><button class="btn sm" data-act="select" data-id="${t.id}">Details & Trace</button><button class="btn sm pri" data-act="buy" data-id="${t.id}">💱 Simulate Buy</button></div></div>`;
}
function renderSignals(sec) {
  const toks = [...core.state.markets.values()].filter(t => t.A && t.D);
  const cand = toks.filter(t => t.D.decision === 'APPROVED' || t.D.decision === 'BUY_CANDIDATE').sort((a, b) => b.A.finalScore - a.A.finalScore);
  const watch = toks.filter(t => t.D.decision === 'WATCH').sort((a, b) => b.A.finalScore - a.A.finalScore).slice(0, 12);
  const rr = Object.entries(core.state.metrics.rejectReasons || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const pre = Object.entries(core.state.metrics.preTradeRejects || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const ms = masterStatus();
  patch(sec, html`<h2>⚡ Signale & Kandidaten</h2>
    <div class="panel tight"><div class="ctl-top"><span class="mstat ${ms.state}">${ms.text}</span><div class="ctl-why">${ms.why}</div></div></div>
    <p class="note">APPROVED = alle Prüfungen bestanden · CANDIDATE = Analyse positiv, Ausführung wartet (z. B. Auto-Trading aus) · WATCH = Filter & Security ok, aber kein Konsens/Score. Kein Kandidat ist kein Fehler (WAITING), sondern eine valide NO-TRADE-Entscheidung.</p>
    <h3>Buy Candidates (${cand.length})</h3>
    ${cand.length ? html`<div class="cards2">${cand.map(signalCard)}</div>` : html`<div class="empty">Keine validen Kandidaten. NO TRADE ist eine vollwertige Entscheidung.</div>`}
    <h3>Watch (${watch.length})</h3>
    ${watch.length ? html`<div class="cards2">${watch.map(signalCard)}</div>` : html`<div class="empty">Keine Tokens auf Watch-Level.</div>`}
    <div class="grid2 an" style="margin-top:12px"><div class="panel"><h3 style="margin-top:0">Häufigste Ablehnungsgründe (aktueller Scan)</h3>${rr.length ? html`<table class="tbl">${rr.map(([c, n]) => html`<tr><td><span class="blk">${c}</span></td><td class="mut">${(BLOCKER_DEFS[c] || [])[2] || ''}</td><td class="r num">${n}</td></tr>`)}</table>` : html`<div class="empty">—</div>`}</div>
    <div class="panel"><h3 style="margin-top:0">Pre-Trade-Ablehnungen (kumuliert)</h3>${pre.length ? html`<table class="tbl">${pre.map(([c, n]) => html`<tr><td><span class="blk">${c}</span></td><td class="r num">${n}</td></tr>`)}</table>` : html`<div class="empty">Noch keine</div>`}</div></div>`);
}

/* ---------- Markt: Regime & Ranking ---------- */
function renderMarkets(sec) {
  const st = core.state, rg = st.regime || { tags: [] };
  const toks = [...st.markets.values()].filter(t => t.A && t.D && t.D.decision !== 'REJECTED' || (t.A && t.A.finalScore >= 40));
  const key = UI.pro ? { opportunity: t => t.A.opportunity, risk: t => -t.A.risk.total, confidence: t => t.A.confidence.total, execution: t => t.A.executionScore }[UI.rankBy] : t => t.A.finalScore;
  const top = toks.filter(t => t.A).sort((a, b) => key(b) - key(a)).slice(0, 25);
  patch(sec, html`<h2>🌐 Markt</h2>
    <div class="panel"><div class="row">${rg.tags.map(x => html`<span class="chip ${x === 'RISK_ON' ? 'ok' : x === 'RISK_OFF' ? 'bad' : x === 'HIGH_VOLATILITY' ? 'warn' : 'info'}">${x}</span>`)}</div>
      <div class="grid4" style="margin-top:10px">${kvA('Breadth (1h > 0)', rg.breadth != null ? (rg.breadth * 100).toFixed(0) + '%' : '—')}${kvA('Median 1h', fmtPct(rg.medH1))}${kvA('Median |5m|', rg.medM5 != null ? rg.medM5.toFixed(1) + '%' : '—')}${kv('SOL-Preis', st.sol ? fmtUsd(st.sol.usd) : '—', st.sol ? (Date.now() - st.sol.at < 60000 ? 'LIVE' : 'STALE') : 'UNKNOWN')}</div>
      <p class="note an">Regime aus ${rg.n || 0} Tokens mit Daten. Bei Risk-Off erhöht sich die Vorsicht nicht automatisch aggressiver – keine Revenge-Logik.</p></div>
    <h3>Top-Tokens${UI.pro ? '' : ' nach Score'}</h3>
    <div class="seg an" role="group" aria-label="Ranking">${[['opportunity', 'Opportunity'], ['risk', 'Niedrigstes Risiko'], ['confidence', 'Data Confidence'], ['execution', 'Execution Score']].map(([k, n]) => html`<button data-act="rank" data-k="${k}" class="${UI.rankBy === k ? 'on' : ''}">${n}</button>`)}</div>
    <div class="panel tw" style="margin-top:10px"><table class="tbl"><thead><tr><th>#</th><th>Token</th><th class="r">Coin-Preis</th><th class="r">MC</th><th class="r an">Opportunity</th><th class="r">Risk</th><th class="r an">Confidence</th><th class="r an">Execution</th><th class="r">Score</th><th>Status</th></tr></thead><tbody>
    ${top.map((t, i) => html`<tr class="click" data-act="select" data-id="${t.id}"><td class="num">${i + 1}</td><td><b>${t.symbol}</b></td><td class="r num">${fmtPrice(t.A.core.price)}</td><td class="r num mcv">${fmtMc(t.A.core.mc)}</td><td class="r num an">${t.A.opportunity}</td><td class="r">${lvlChip(t.A.risk.level, t.A.risk.total)}</td><td class="r num an">${t.A.confidence.total}%</td><td class="r num an">${t.A.executionScore}</td><td class="r">${scoreChip(t.A.finalScore)}</td><td>${decChip(t.D.decision)}</td></tr>`)}
    </tbody></table>${top.length ? '' : html`<div class="empty">Noch keine analysierten Tokens.</div>`}</div>`);
}

/* ---------- Watchlist ---------- */
function renderWatchlist(sec) {
  const st = core.state, ids = Object.keys(st.watchlist).sort((a, b) => (st.watchlist[a].priority - st.watchlist[b].priority) || (st.watchlist[b].addedAt - st.watchlist[a].addedAt));
  patch(sec, html`<h2>👁 Watchlist</h2>
    <div class="toolbar"><input id="wlAdd" placeholder="Mint-Adresse hinzufügen" aria-label="Mint-Adresse" autocomplete="off"><button class="btn" data-act="wlAdd">＋ Hinzufügen</button></div>
    ${ids.length ? html`<div class="cards2">${ids.map(id => {
      const w = st.watchlist[id], t = tok(id), A = t && t.A;
      return html`<div class="card"><div class="ch"><button class="star on" data-act="star" data-id="${id}" aria-label="Entfernen">★</button><b>${(t && t.symbol !== '?' ? t.symbol : w.symbol) || shortAddr(mintOfId(id))}</b>${A ? html`${scoreChip(A.finalScore)}${lvlChip(A.risk.level, A.risk.total)}${lbl(A.label)}` : html`<span class="lbl UNKNOWN">KEINE DATEN</span>`}<span class="ag">P${w.priority}</span></div>
        ${A ? html`<div class="grid4" style="margin-top:8px">${kv('Coin-Preis', fmtPrice(A.core.price))}${kv('MC', html`<span class="mcv">${fmtMc(A.core.mc)}</span>`)}${kv('5m', fmtPct(A.price.chg.m5, 0))}${kv('1h', fmtPct(A.price.chg.h1, 0))}${kvA('Liq', fmtUsd(A.liq.usd))}</div>` : html`<p class="note">Noch keine Marktdaten (Token wird priorisiert abgefragt).</p>`}
        <div class="form" style="margin-top:8px">
          <label class="fld">Notiz<input data-wl="${id}" data-f="note" value="${w.note}" maxlength="200"></label>
          <label class="fld">Priorität<select data-wl="${id}" data-f="priority">${[1, 2, 3].map(p => html`<option value="${p}" ${w.priority === p ? raw('selected') : ''}>${p === 1 ? '1 – hoch' : p === 2 ? '2 – normal' : '3 – niedrig'}</option>`)}</select></label>
          <label class="fld">Alarm Coin-Preis ≥ ($)<input type="number" step="any" data-wl="${id}" data-f="priceAbove" value="${w.priceAbove != null ? w.priceAbove : ''}"></label>
          <label class="fld">Alarm Coin-Preis ≤ ($)<input type="number" step="any" data-wl="${id}" data-f="priceBelow" value="${w.priceBelow != null ? w.priceBelow : ''}"></label>
          <label class="fld">Alarm Score ≥<input type="number" data-wl="${id}" data-f="scoreAbove" value="${w.scoreAbove != null ? w.scoreAbove : ''}"></label>
          <label class="fld inl">Alerts aktiv<input type="checkbox" data-wl="${id}" data-f="alerts" ${w.alerts ? raw('checked') : ''}></label>
        </div>
        <button class="ca" data-act="copy" data-v="${mintOfId(id)}" data-l="Mint"><code>${mintOfId(id)}</code><span>⧉ kopieren</span></button>
        <div class="row" style="margin-top:8px"><button class="btn sm" data-act="select" data-id="${id}">Details</button><button class="btn sm bad" data-act="wlRemove" data-id="${id}">Entfernen</button></div></div>`;
    })}</div>` : html`<div class="empty">Watchlist ist leer. Tippe im Scanner auf ☆, um Tokens zu beobachten.</div>`}`);
}

/* ---------- Positionen ---------- */
function positionCard(p) {
  const S = core.S(), t = tok(p.tokenId), now = Date.now();
  const pnlOk = isNum(p.pnlUsd);
  const eq = core.equityInfo(), r = mcRatio(p, t);
  const tpTxt = (i) => html`${pxMc(p.tps[i], r)}${p.tpHit[i] ? ' ✓' : ''}`;
  const lcCls = { OPEN: 'ok', PARTIAL: 'info', CLOSING: 'warn', UNKNOWN: 'bad' }[p.lc] || '';
  return html`<div class="card"><div class="ch"><b>${p.symbol}</b><span class="chip ${lcCls}" title="Lebenszyklus">${POS_LC_DE[p.lc] || p.lc || 'offen'}</span><span class="chip vio">${p.mode}</span><span class="chip">${p.strategy || 'manuell'}</span>${lbl(p.priceLabel || 'UNKNOWN')}<span class="ag">Haltedauer ${fmtAge(now - p.openedAt)}</span></div>
    <div class="grid4" style="margin-top:8px">
      ${kv('Einstieg', pxMc(p.entryPrice, r), null, 'Ø Füll-Coin-Preis und die daraus abgeleitete MC')}${kv('Aktuell', pxMc(p.lastPrice, r), p.priceLabel)}
      ${kv('PnL (fee-adj.)', pnlOk ? fmtSigned(p.pnlUsd) : 'nicht verfügbar', pnlOk ? 'SIMULATED' : 'UNKNOWN')}${kv('PnL %', pnlOk ? fmtPct(p.pnlPct) : '—')}
      ${kv('Größe (Kosten)', fmtUsd(p.costUsd))}${kv('Anteil', eq.equity > 0 ? (p.costUsd / eq.equity * 100).toFixed(1) + '%' : '—')}
      ${kv('Stop (' + p.stopType + ')', pxMc(p.stop, r))}${kv('Trailing', p.trailing ? 'aktiv' : 'ab +' + S.trailActivatePct + '%')}
      ${kv('TP1', tpTxt(0))}${kv('TP2', tpTxt(1))}${kv('TP3', pxMc(p.tps[2], r))}${kvA('Risk', t && t.A ? t.A.risk.level + ' ' + t.A.risk.total : '—')}
      ${kv('Realisiert', fmtSigned(p.realizedUsd), 'SIMULATED')}${kv('Fees', fmtUsd(p.feesUsd, 4))}${kvA('Exit-Impact (voll)', isNum(p.exitImpactPct) ? p.exitImpactPct.toFixed(2) + '%' : '—', 'ESTIMATED')}${kv('Buys', p.entries.length + '/' + (S.maxBuysPerCoin > 0 ? S.maxBuysPerCoin : '∞'))}
    </div>
    ${p.timeExitFlag ? html`<p class="note warn">⏱ Time Exit Candidate – erwartete Bewegung blieb aus.</p>` : ''}
    ${p.exitPending ? html`<p class="note bad">Exit ausgesetzt (${p.exitPending.code}): ${p.exitPending.blocker}</p>` : ''}
    ${p.noRouteSince ? html`<p class="note bad">Kein Verkaufsweg über Jupiter seit ${fmtAge(now - p.noRouteSince)} – zählt mit 0 $; ohne neuen Verkaufsweg wird die Position nach ${NO_ROUTE_WRITEOFF_MIN} min als Totalverlust abgeschrieben.</p>` : ''}
    ${p.failedTx ? html`<p class="note warn">${p.failedTx} gescheiterte Verkaufs-Transaktion(en) – Netzwerkgebühren sind im Ergebnis enthalten.</p>` : ''}
    ${arr(p.lcHistory).length ? html`<details class="an"><summary class="mut">Lebenszyklus (${p.lcHistory.length} Schritte)</summary><ul class="trace">${p.lcHistory.map(h => html`<li><b>${fmtTime(h.ts)}</b><span>${POS_LC_DE[h.s] || h.s}${h.note ? ' – ' + h.note : ''}</span></li>`)}</ul></details>` : ''}
    <div class="row" style="margin-top:8px"><button class="btn sm" data-act="select" data-id="${p.tokenId}">Details</button><button class="btn sm warn" data-act="sell" data-id="${p.id}" data-frac="0.25">Verkaufen 25 %</button><button class="btn sm warn" data-act="sell" data-id="${p.id}" data-frac="0.5">50 %</button><button class="btn sm bad" data-act="sell" data-id="${p.id}" data-frac="ALL">100 %</button></div></div>`;
}
function renderPositions(sec) {
  const st = core.state, eq = core.equityInfo(), pf = st.portfolio;
  const unreal = st.positions.reduce((a, p) => a + (isNum(p.pnlUsd) ? p.pnlUsd : 0), 0);
  patch(sec, html`<h2>💼 Positionen <span class="lbl SIMULATED">SIMULATED</span></h2>
    <div class="row" style="margin:0 0 10px"><button class="btn sm warn" data-act="freshStart" title="Startkapital wiederherstellen und Positionen verwerfen – gesammelte Analysedaten bleiben erhalten">↺ Frischer Start (Startkapital ${fmtUsd(core.S().simCapitalUsd)})</button></div>
    <div class="grid4">${kv('Equity', fmtUsd(eq.equity), eq.estimated ? 'ESTIMATED' : 'SIMULATED')}${kv('Cash', fmtUsd(pf.cash))}${kv('Exposure', fmtUsd(eq.exposure) + ' · ' + eq.exposurePct.toFixed(1) + '%')}${kv('Unrealisiert', fmtSigned(unreal))}${kv('Realisiert', fmtSigned(pf.realized))}${kv('Fees gesamt', fmtUsd(pf.fees, 2))}${kv('Startkapital', fmtUsd(pf.startCapital))}${kv('Max Drawdown', (pf.maxDD || 0).toFixed(2) + '%')}</div>
    <p class="note">Alle Positionen sind virtuell (SIMULATION/PAPER) mit echten Marktdaten, geschätzter Slippage und Gebühren. Es gibt keine echten Orders. Ausführung: Provider ${core.execProvider()} (LIVE: nicht angebunden).</p>
    ${(() => { const pi = core.portfolioIntegrity(); return pi.ok ? html`<p class="note an">✓ Portfolio-Integrität: Mengen, Füllungen, Journal und Orders konsistent.</p>` : html`<div class="panel bad"><b>Portfolio-Integrität: ${pi.issues.length} Auffälligkeit(en)</b>${pi.issues.map(i => html`<div class="check"><span class="ic fail">${i.code}</span><div><small>${i.msg}</small></div></div>`)}<p class="note">Unklare Zustände werden nicht still als offen oder geschlossen gewertet. Diagnose → Abgleich prüfen.</p></div>`; })()}
    ${st.positions.length ? html`<div class="cards2">${st.positions.map(positionCard)}</div>` : html`<div class="empty">Keine offenen Positionen.</div>`}`);
}

/* ---------- Orders ---------- */
function renderOrders(sec) {
  const os = core.state.orders.slice(0, 120);
  patch(sec, html`<h2>🧾 Orders</h2><p class="note">Jede Order hat eine eindeutige ID und Idempotency-Key. Tx: nur echte Signaturen würden verlinkt – im Simulationsmodus existiert keine Transaktion.</p>
    <div class="panel tw">${os.length ? html`<table class="tbl"><thead><tr><th>Zeit</th><th>Token</th><th>Typ</th><th class="r">Größe</th><th class="r">Coin-Preis</th><th class="r">MC</th><th>Status</th><th class="an">Tx</th><th>Grund</th></tr></thead><tbody>
    ${os.map(o => { const r = orderMcRatio(o); return html`<tr class="click" data-act="order" data-id="${o.id}"><td class="num">${fmtTime(o.createdAt)}</td><td><b>${o.symbol}</b></td><td>${o.side} <small class="mut">${o.auto ? 'Bot' : 'manuell'} · ${o.mode}</small></td><td class="r num">${o.sizeUsd != null ? fmtUsd(o.sizeUsd) : '—'}</td><td class="r num">${o.fillPrice != null ? fmtPrice(o.fillPrice) : '—'}</td><td class="r num mcv">${o.fillPrice != null ? mcAt(o.fillPrice, r) : '—'}</td><td><span class="chip ${o.state === 'COMPLETED' ? 'ok' : o.state === 'REJECTED' || o.state === 'FAILED' ? 'bad' : o.state === 'CANCELLED' ? '' : 'info'}">${o.state}</span></td><td class="mut an">${o.txSig ? 'Tx' : 'SIMULIERT'}</td><td class="mut"><span class="an">${o.blockers && o.blockers[0] ? o.blockers[0].code + ': ' : ''}</span>${(o.reason || '').slice(0, 80)}</td></tr>`; })}
    </tbody></table>` : html`<div class="empty">Noch keine Orders.</div>`}</div>`);
}
function orderModal(id) {
  const o = core.state.orders.find(x => x.id === id); if (!o) return;
  const r = orderMcRatio(o);
  openModal({ title: 'Order Receipt · ' + o.id, body: html`
    <div class="grid2">${kv('Token', o.symbol)}${kv('Seite', o.side + (o.buyNo ? ' #' + o.buyNo : ''))}${kv('Status', o.state)}${kv('Modus', o.mode)}${kv('Größe', o.sizeUsd != null ? fmtUsd(o.sizeUsd) : '—')}${kv('Menge', o.qty != null ? fmtNum(o.qty, 2) : '—')}${kv('Referenz', pxMc(o.estPrice, r))}${kv('Füllung', pxMc(o.fillPrice, r), o.fillPrice ? 'SIMULATED' : null)}${kvA('Abweichung zum Signalpreis', isNum(o.expSlipPct) ? o.expSlipPct.toFixed(3) + '%' : '—', o.quote && o.quote.source === 'JUPITER' ? 'SIMULATED' : 'ESTIMATED')}${kv('Fees', o.fees ? fmtUsd(o.fees.total, 4) : '—', 'ESTIMATED')}${kvA('Latenz', o.latencyMs != null ? o.latencyMs + ' ms' : '—')}${kv('Transaktion', 'keine (Simulation)')}</div>
    ${o.reason ? html`<p class="note">${o.reason}</p>` : ''}
    <p class="note">Provider: ${o.provider || 'SIMULATION'}${o.route ? ' · ' + o.route : ''}${o.failureCode ? html` · <span class="chip bad">${o.failureCode}</span> ${EXEC_FAIL[o.failureCode] || ''}` : ''}</p>
    ${o.quote ? html`<p class="note">Angebot: ${o.quote.source === 'JUPITER' ? 'echtes Jupiter-Angebot (nur abgefragt, nie ausgeführt)' : 'AMM-Schätzung' + (o.quote.fallbackReason ? ' – ' + o.quote.fallbackReason : '')}${isNum(o.quote.roundTripPct) ? ' · Kauf + sofortiger Verkauf kostet ' + o.quote.roundTripPct.toFixed(2) + ' %' : ''}${o.quote.noSellRoute ? ' · kein Verkaufsweg' : ''}${o.quote.latencyApplied ? ' · Füllung zum Angebot nach der Wartezeit' : ''}${isNum(o.quote.prioLamports) ? ' · Priority Fee ' + fmtNum(o.quote.prioLamports) + ' Lamports' : ''}${o.fees && o.fees.failedTx ? ' · Transaktion gescheitert, Gebühr ' + fmtUsd(o.fees.total, 4) + ' bezahlt' : ''}</p>` : ''}
    <p class="note mono">Mint: ${o.mint}<span class="an"> · Key: ${o.key || '—'}</span></p>
    ${o.blockers ? html`<div class="an"><h3>Blocker</h3>${o.blockers.map(b => html`<div class="check"><span class="ic fail">P${b.prio}</span><div><b>${b.code}</b><small>${b.msg}</small></div></div>`)}</div>` : ''}
    <div class="an"><h3>State Machine</h3><ul class="trace">${o.history.map(h => html`<li><b>${fmtTime(h.ts)}</b><span>${h.s}${h.note ? ' – ' + h.note : ''}</span></li>`)}</ul></div>
    <div class="row" style="margin-top:8px"><button class="btn sm" data-act="copy" data-v="${o.mint}" data-l="Mint">⧉ Copy Mint</button>${o.fillPrice ? html`<button class="btn sm" data-act="copy" data-v="${String(o.fillPrice)}" data-l="Coin-Preis">⧉ Coin-Preis kopieren</button>` : ''}</div>` });
}

/* ---------- History & Trade Replay ---------- */
function renderHistory() {
  const q = UI.hq.trim().toLowerCase();
  const list = core.state.journal.filter(j => (!UI.hMode || j.mode === UI.hMode) && (!UI.hRes || (UI.hRes === 'open' ? !['CLOSED', 'RESET'].includes(j.status) : j.result && (UI.hRes === 'win' ? j.result.win : !j.result.win))) && (!q || (j.symbol + ' ' + j.mint + ' ' + (j.reason || '') + ' ' + (j.exitReason || '') + ' ' + (j.strategy || '')).toLowerCase().includes(q))).slice(0, 200);
  patch($('hList'), list.length ? html`<div class="panel tw"><table class="tbl"><thead><tr><th>Eröffnet</th><th>Token</th><th>Modus</th><th class="an">Strategie</th><th class="r">Größe</th><th class="r">PnL</th><th>Exit</th><th class="r">Halten</th><th class="r an">Score</th></tr></thead><tbody>
    ${list.map(j => html`<tr class="click" data-act="trade" data-id="${j.id}"><td class="num">${fmtDateTime(j.openedAt)}</td><td><b>${j.symbol}</b></td><td>${j.mode}</td><td class="an">${j.strategy || 'manuell'}</td><td class="r num">${fmtUsd(j.sizeUsd)}</td><td class="r num ${j.result ? cls(j.result.pnlUsd) : ''}">${j.result ? fmtSigned(j.result.pnlUsd) + ' (' + fmtPct(j.result.pnlPct) + ')' : j.status === 'RESET' ? 'Frischer Start' : j.status}</td><td>${j.exitReason || '—'}</td><td class="r num">${j.holdMs ? fmtAge(j.holdMs) : '—'}</td><td class="r an">${scoreChip(j.score)}</td></tr>`)}
    </tbody></table></div>` : html`<div class="empty">Keine Trades${q || UI.hMode || UI.hRes ? ' für diesen Filter' : ''}. Alle Trades sind simuliert und klar gekennzeichnet.</div>`);
}
function tradeModal(id) {
  const j = core.state.journal.find(x => x.id === id); if (!j) return;
  const d = j.decision || {}, sn = d.snapshot || {}, r = mcRatio({ id: j.id }, tok(j.tokenId));
  openModal({ title: `Trade Replay · ${j.symbol} (${j.mode})`, body: html`
    <div class="grid2">${kvA('Trade ID', j.id)}${kv('Status', j.status === 'RESET' ? 'Frischer Start (nicht gewertet)' : j.status)}${kv('Eröffnet', fmtDateTime(j.openedAt))}${kv('Geschlossen', fmtDateTime(j.closedAt))}${kv('Investiert', fmtUsd(j.sizeUsd))}${kv('Ergebnis', j.result ? fmtSigned(j.result.pnlUsd) : '—', 'SIMULATED')}${kv('Fees', fmtUsd(j.feesUsd, 4))}${kvA('Slippage', fmtUsd(j.slippageUsd, 4), 'ESTIMATED')}${kv('Exit-Grund', j.exitReason || '—')}${kvA('MAE 2 min', isNum(j.mae2m) ? fmtPct(j.mae2m) : '—')}${kvA('Ø Exec-Latenz', j.execLatencyMs != null ? Math.round(j.execLatencyMs) + ' ms' : '—')}${kvA('Param-Version', 'v' + j.paramVersion)}</div>
    <h3>Markt beim Einstieg</h3>
    <div class="grid2">${kv('Coin-Preis', fmtPrice(sn.priceUsd))}${kv('MC', html`<span class="mcv">${fmtMc(isNum(sn.marketCap) ? sn.marketCap : sn.fdv)}</span>`)}${kvA('Liquidität', fmtUsd(sn.liquidityUsd))}${kvA('Vol 1h', fmtUsd(sn.vol && sn.vol.h1))}${kvA('Quelle', sn.source || '—')}${kvA('Zeit', fmtTime(sn.fetchedAt))}${kvA('Security', d.security ? d.security.status : '—')}${kvA('SOL-Preis', d.sol ? fmtUsd(d.sol) : '—')}</div>
    <div class="an"><h3>Entscheidung</h3><p>Score <b>${j.score}</b> · Confidence <b>${j.confidence}</b> · Risk <b>${j.risk ? j.risk.total + ' ' + j.risk.level : '—'}</b> · Strategie <b>${j.strategy || 'manuell'}</b> · Regime ${(j.regime || []).join(', ')}</p></div>
    <p class="note">${j.reason}</p>
    <div class="an">${j.signals.map(s => html`<span class="sig" title="${s.reason}">${SIGNAL_NAMES[s.type] || s.type} <i>${s.strength}</i></span>`)}</div>
    <div class="an">${(j.tags || []).map(x => html`<span class="chip info">${x}</span> `)}</div>
    ${d.trace ? html`<div class="an"><h3>Decision Trace</h3><ul class="trace">${d.trace.map(x => html`<li><span class="ic">${x.ok === true ? '✅' : x.ok === false ? '❌' : '·'}</span><b>${x.stage}</b><span>${x.detail}</span></li>`)}</ul></div>` : ''}
    <h3>Ausführungen</h3><div class="tw"><table class="tbl"><tr><th>Zeit</th><th>Typ</th><th class="r">Coin-Preis</th><th class="r">MC</th><th class="r">USD</th><th class="r">Fees</th><th>Grund</th></tr>
    ${j.entries.map(e => html`<tr><td class="num">${fmtTime(e.ts)}</td><td>BUY</td><td class="r num">${fmtPrice(e.price)}</td><td class="r num mcv">${mcAt(e.price, r)}</td><td class="r num">${fmtUsd(e.usd)}</td><td class="r num">${fmtUsd(e.fees, 4)}</td><td>—</td></tr>`)}
    ${j.exits.map(e => html`<tr><td class="num">${fmtTime(e.ts)}</td><td>SELL</td><td class="r num">${fmtPrice(e.price)}</td><td class="r num mcv">${mcAt(e.price, r)}</td><td class="r num">${fmtUsd(e.usd)}</td><td class="r num">${fmtUsd(e.fees, 4)}</td><td>${e.reason} (${fmtSigned(e.realized)})</td></tr>`)}</table></div>` });
}

/* ---------- Backtest Lab ---------- */
function renderBacktest(sec) {
  const st = core.state;
  const opts = [...st.markets.values()].filter(t => (t.snap && t.snap.pairAddress) || (t.alt && t.alt.pairAddress)).sort((a, b) => (b.id === st.selected) - (a.id === st.selected) || ((b.A ? b.A.finalScore : 0) - (a.A ? a.A.finalScore : 0))).slice(0, 80);
  const S = core.S();
  setHTML(sec, html`<h2>🧪 Backtest Lab</h2>
    <p class="note">Historische OHLCV-Kerzen von GeckoTerminal (max. 1000). Signal auf geschlossener Kerze → Einstieg zum Open der nächsten Kerze (kein Look-Ahead). Stops werden vor Take Profits geprüft. Historische Liquidität/Käuferdaten sind nicht verfügbar – Slippage ist eine Schätzung. Vergangene Performance ist keine Garantie.</p>
    <div class="panel"><div class="form">
      <label class="fld">Token / Pool<select id="btTok">${opts.map(t => html`<option value="${t.id}">${t.symbol} · ${shortAddr((t.snap && t.snap.pairAddress) || t.alt.pairAddress)}</option>`)}</select></label>
      <label class="fld">Timeframe<select id="btTf"><option value="1m">1 Minute</option><option value="5m" selected>5 Minuten</option><option value="15m">15 Minuten</option></select></label>
      <label class="fld">Strategie<select id="btStrat">${Object.entries(BT_STRATEGIES).map(([k, v]) => html`<option value="${k}">${v.name}</option>`)}</select></label>
      <label class="fld">Positionsgröße % Kapital<input id="btSize" type="number" value="10" min="1" max="100"></label>
      <label class="fld">Take Profit %<input id="btTp" type="number" value="${S.tp1Pct}" min="1"></label>
      <label class="fld">Stop Loss %<input id="btSl" type="number" value="${S.stopLossPct}" min="1" max="90"></label>
      <label class="fld">Trailing ab %<input id="btTa" type="number" value="${S.trailActivatePct}" min="1"></label>
      <label class="fld">Trailing Abstand %<input id="btTr" type="number" value="${S.trailPct}" min="1" max="90"></label>
      <label class="fld">Time Exit (Kerzen)<input id="btTime" type="number" value="24" min="1"></label>
      <label class="fld">Fee % je Seite<input id="btFee" type="number" step="0.01" value="${S.dexFeePct + 0.05}"></label>
      <label class="fld">Slippage % je Seite (Schätzung)<input id="btSlip" type="number" step="0.1" value="1"></label>
      <p class="note" style="grid-column:1/-1">Walk-Forward ist verpflichtend: Parameter nur auf Train (50 %), Prüfung auf Validation (25 %), Ergebnis auf Test (25 %, Out-of-Sample). Zusätzlich: Stress-Szenarien, Monte-Carlo-Drawdown und Regime-Auswertung.</p>
    </div><div class="row" style="margin-top:10px"><button class="btn pri" data-act="btRun" id="btRunBtn" ${opts.length ? '' : raw('disabled')}>${UI.btBusy ? '⏳ läuft …' : '▶ Backtest starten'}</button>${opts.length ? '' : html`<span class="mut">Keine Pools mit Adresse im Scanner.</span>`}</div></div>
    <div id="btRes"></div>
    ${core.state.btRuns.length ? html`<div class="panel tw"><h3 style="margin-top:0">Run-Historie (versioniert)</h3><table class="tbl"><thead><tr><th>Run-ID</th><th>Zeit</th><th>Token</th><th>Strategie</th><th>TF</th><th class="r">Kerzen</th><th class="r">Test-Trades</th><th class="r">Test netto</th><th class="r">Validation netto</th><th class="r">MC-DD 95 %</th><th>Datensatz</th></tr></thead><tbody>
      ${core.state.btRuns.map(r => html`<tr><td class="num">${r.id}</td><td class="num">${fmtDateTime(r.ts)}</td><td>${r.symbol}</td><td>${r.strategy} (${r.param})</td><td>${r.tf}</td><td class="r num">${r.n}</td><td class="r num">${r.testTrades}</td><td class="r num ${cls(r.testNet)}">${fmtSigned(r.testNet)}</td><td class="r num ${cls(r.valNet)}">${fmtSigned(r.valNet)}</td><td class="r num">${isNum(r.mcP95) ? r.mcP95.toFixed(1) + '%' : '—'}</td><td class="mut num">${r.hash}</td></tr>`)}</tbody></table>
      <p class="note">Gleiche Kerzen + gleiche Parameter + gleiche Kosten + gleiche Code-Version ergeben dieselbe Run-ID und dasselbe Ergebnis.</p></div>` : ''}`);
  renderBtResult();
}
function metricGrid(m) {
  return html`<div class="grid4">${kv('Trades', m.trades)}${kv('Win Rate', m.winRate != null ? (m.winRate * 100).toFixed(1) + '%' : '—')}${kv('Ø Gewinn', fmtUsd(m.avgWin))}${kv('Ø Verlust', fmtUsd(m.avgLoss))}${kv('Profit Factor', m.profitFactor == null ? '—' : m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2))}${kv('Max Drawdown', isNum(m.maxDD) ? m.maxDD.toFixed(2) + '%' : '—')}${kv('Expectancy', fmtUsd(m.expectancy))}${kv('Fees', fmtUsd(m.fees))}${kv('Slippage', fmtUsd(m.slippage), 'ESTIMATED')}${kv('Exposure', isNum(m.exposure) ? m.exposure.toFixed(1) + '%' : '—')}${kv('Ø Haltedauer', m.avgHoldBars != null ? m.avgHoldBars.toFixed(1) + ' Kerzen' : '—')}${kv('Netto', fmtSigned(m.netPnl) + (isNum(m.returnPct) ? ' (' + fmtPct(m.returnPct) + ')' : ''))}</div>`;
}
function renderBtResult() {
  const el = document.getElementById('btRes'); if (!el) return;
  const r = UI.bt;
  if (!r) { patch(el, html`<div class="empty">Noch kein Backtest ausgeführt.</div>`); return; }
  if (r.error) { patch(el, html`<div class="panel bad">Backtest nicht möglich: ${r.error}</div>`); return; }
  const def = BT_STRATEGIES[r.cfg.strategy], m = r.meta, pf = v => (v == null ? '—' : v === Infinity ? '∞' : v.toFixed(2));
  patch(el, html`<div class="panel"><h3 style="margin-top:0">${r.symbol} · ${def.name} · ${r.tf} · ${r.n} Kerzen</h3>
    <div class="grid3">${kv('Run-ID', m.id)}${kv('Zeitraum', fmtDateTime(r.from) + ' – ' + fmtDateTime(r.to))}${kv('Datenquelle', m.dataset.source + ' · Hash ' + m.dataset.hash)}
      ${kv('Strategie-/Code-Version', m.code)}${kv('Parameter', `${def.param} = ${r.wf.chosen} · TP ${r.cfg.tpPct} % · SL ${r.cfg.slPct} % · Trailing ab ${r.cfg.trailActPct} % / ${r.cfg.trailPct} % · Time Exit ${r.cfg.timeBars}`)}${kv('Kosten (je Seite)', `Gebühr ${r.cfg.feePct} % · Slippage ${r.cfg.slipPct} %`)}
      ${kv('Walk-Forward', m.split)}${kv('Out-of-Sample-Anteil', m.oosPct + ' % (Validation + Test)')}${kv('Test-Trades', r.wf.test.trades)}</div>
    <p class="note">${m.wf}.${r.wf.lowSample ? ' Achtung: zu wenige Trades im Training (< 3) – Aussagekraft gering.' : ''}</p>
    <table class="tbl"><tr><th>${def.param}</th><th class="r">Train Trades</th><th class="r">Train Expectancy</th><th class="r">Train Win Rate</th></tr>${r.wf.grid.map(g => html`<tr><td>${g.param}${g.param === r.wf.chosen ? ' ✓' : ''}</td><td class="r num">${g.train.trades}</td><td class="r num">${fmtUsd(g.train.expectancy)}</td><td class="r num">${g.train.winRate != null ? (g.train.winRate * 100).toFixed(0) + '%' : '—'}</td></tr>`)}</table>
    <h3>Validation (25 %)</h3>${metricGrid(r.wf.validation)}<h3>Test (25 %, out-of-sample)</h3>${metricGrid(r.wf.test)}
    <h3>Equity-Kurve (Test)</h3><div class="chartbox small"><canvas data-chart="bt" aria-label="Backtest Equity"></canvas></div>
    <h3>Stress-Szenarien (Test-Zeitraum)</h3><div class="tw"><table class="tbl"><tr><th>Szenario</th><th class="r">Trades</th><th class="r">Netto</th><th class="r">Δ zur Basis</th><th class="r">Profit Factor</th><th class="r">Max DD</th></tr>${r.stress.map(x => html`<tr><td>${x.name}</td><td class="r num">${x.trades}</td><td class="r num ${cls(x.net)}">${fmtSigned(x.net)}</td><td class="r num ${cls(x.delta)}">${x.name === 'Basis' ? '—' : fmtSigned(x.delta)}</td><td class="r num">${pf(x.pf)}</td><td class="r num">${isNum(x.maxDD) ? x.maxDD.toFixed(2) + '%' : '—'}</td></tr>`)}</table></div>
    <p class="note">Robust ist eine Strategie nur, wenn sie auch unter schlechteren Annahmen nicht zusammenbricht.</p>
    <div class="grid2 lgrid"><div><h3>Monte-Carlo-Drawdown (Test-Trades, ${r.mc ? r.mc.iters : 0} Durchläufe)</h3>${r.mc ? html`<div class="grid3">${kv('Median', r.mc.p50.toFixed(1) + '%')}${kv('95 %', r.mc.p95.toFixed(1) + '%')}${kv('Schlechtester', r.mc.worst.toFixed(1) + '%')}</div><p class="note">Zufällige Reihenfolge der Trades (fester Seed = Run-ID): so tief kann der Drawdown bei denselben Trades auch ausfallen.</p>` : html`<p class="mut">Zu wenige Test-Trades (mind. 5).</p>`}</div>
      <div><h3>Ergebnisse nach Regime (Test)</h3>${Object.keys(r.regimes).length ? html`<table class="tbl"><tr><th>Regime</th><th class="r">Trades</th><th class="r">Win Rate</th><th class="r">Netto</th></tr>${Object.entries(r.regimes).sort().map(([k, x]) => html`<tr><td>${k}</td><td class="r num">${x.n}</td><td class="r num">${Math.round(x.wins / x.n * 100)}%</td><td class="r num ${cls(x.net)}">${fmtSigned(x.net)}</td></tr>`)}</table><p class="note">Regime zur Signal-Kerze (Volatilitäts-Terzile über den Zeitraum, nur Auswertung).</p>` : html`<p class="mut">Keine Test-Trades.</p>`}</div></div>
    <h3>In-Sample (gesamter Zeitraum, nur zur Information)</h3>${metricGrid(r.inSample)}
    <h3>Trades (Test)</h3><div class="row" style="margin-bottom:6px"><button class="btn sm" data-act="btCsv">⬇ Trades CSV</button></div><div class="tw"><table class="tbl"><tr><th>Einstieg</th><th>Ausstieg</th><th class="r">Einstieg Coin-Preis</th><th class="r">Ausstieg Coin-Preis</th><th class="r">PnL</th><th>Grund</th><th>Regime</th></tr>${r.wf.testTrades.slice(-60).map(t => html`<tr><td class="num">${fmtDateTime(t.entryT)}</td><td class="num">${fmtDateTime(t.exitT)}</td><td class="r num">${fmtPrice(t.entry)}</td><td class="r num">${fmtPrice(t.exit)}</td><td class="r num ${cls(t.pnl)}">${fmtSigned(t.pnl)}</td><td>${t.reason}</td><td class="mut">${t.regime || '—'}</td></tr>`)}</table></div>
    <h3>Wesentliche Limitierungen</h3><ul class="list-plain">${m.limitations.map(x => html`<li class="mut">${x}</li>`)}</ul></div>`);
  drawCharts(el);
}
async function runBacktestUi() {
  if (UI.btBusy) return;
  const v = id => (document.getElementById(id) || {}).value;
  const id = v('btTok'), tf = v('btTf');
  const nums = { sizePct: [+v('btSize'), 1, 100], tpPct: [+v('btTp'), 0.5, 5000], slPct: [+v('btSl'), 0.5, 90], trailActPct: [+v('btTa'), 0.5, 5000], trailPct: [+v('btTr'), 0.5, 90], timeBars: [+v('btTime'), 1, 1000], feePct: [+v('btFee'), 0, 10], slipPct: [+v('btSlip'), 0, 20] };
  const cfg = { strategy: v('btStrat'), capital: 1000 };
  for (const [k, [x, lo, hi]] of Object.entries(nums)) { if (!Number.isFinite(x) || x < lo || x > hi) { toast('WARNING', 'Ungültige Eingabe', `${k}: ${lo}–${hi}`); return; } cfg[k] = x; }
  if (!BT_STRATEGIES[cfg.strategy] || !tok(id)) { toast('WARNING', 'Bitte Token und Strategie wählen'); return; }
  UI.btBusy = true; setText(document.getElementById('btRunBtn'), '⏳ lädt Kerzen …');
  try {
    const d = await core.fetchCandlesForBacktest(id, tf);
    if (d.candles.length < 60) throw new Error(`Zu wenige Kerzen (${d.candles.length}) – mindestens 60 nötig`);
    const c = d.candles, wf = walkForward(c, cfg), n = c.length, b = wf.split.test[0];
    const cfgC = { ...cfg, param: wf.chosen }, meta = btRunMeta(c, cfg, { pair: d.pair, symbol: tok(id).symbol, tf, chosen: wf.chosen });
    const stress = btStress(c, cfgC, b, n), mc = mcDrawdown(wf.testTrades, cfg.capital, meta.id), regimes = btByRegime(wf.testTrades, c);
    UI.bt = { symbol: tok(id).symbol, tf, cfg, n, from: c[0].t, to: c[n - 1].t, wf, meta, stress, mc, regimes, inSample: runBacktest(c, cfgC).metrics };
    core.recordBacktest({ id: meta.id, symbol: UI.bt.symbol, strategy: cfg.strategy, param: `${BT_STRATEGIES[cfg.strategy].param}=${wf.chosen}`, tf, n, hash: meta.dataset.hash, testTrades: wf.test.trades, testNet: wf.test.netPnl, valNet: wf.validation.netPnl, mcP95: mc ? mc.p95 : null, stressWorst: Math.min(...stress.map(x => x.net)) });
  } catch (e) { UI.bt = { error: e.message }; }
  finally { UI.btBusy = false; setText(document.getElementById('btRunBtn'), '▶ Backtest starten'); renderBtResult(); }
}

/* ---------- Analytics ---------- */
function renderAnalytics(sec) {
  const st = core.state, trades = st.journal, perf = perfStats(trades), closed = trades.filter(j => j.status === 'CLOSED' && j.result);
  const exitR = {}; for (const j of closed) exitR[j.exitReason || '—'] = (exitR[j.exitReason || '—'] || 0) + 1;
  const pnlDist = bucketize(closed.map(j => j.result.pnlPct), [-20, -10, -5, 0, 5, 10, 25, 50], ['< −20%', '−20…−10', '−10…−5', '−5…0', '0…5', '5…10', '10…25', '25…50', '> 50%']);
  const holdDist = bucketize(closed.map(j => (j.holdMs || 0) / MIN), [2, 5, 15, 30, 60, 240], ['< 2m', '2–5m', '5–15m', '15–30m', '30–60m', '1–4h', '> 4h']);
  const scoreDist = bucketize(closed.map(j => j.score), [50, 60, 70, 80, 90], ['< 50', '50–60', '60–70', '70–80', '80–90', '≥ 90']);
  const riskDist = bucketize(closed.map(j => j.risk && j.risk.total), [20, 35, 50, 65], ['< 20', '20–35', '35–50', '50–65', '≥ 65']);
  const byStrat = {}; for (const j of closed) { const k = j.strategy || 'manuell'; (byStrat[k] = byStrat[k] || []).push(j); }
  const sigPerf = {}; for (const j of closed) for (const s of j.signals) { const x = sigPerf[s.type] || (sigPerf[s.type] = { n: 0, w: 0, pnl: 0 }); x.n++; if (j.result.win) x.w++; x.pnl += j.result.pnlUsd; }
  const dist = (title, rows) => html`<div class="panel"><h3 style="margin-top:0">${title}</h3>${rows.map(r => html`<div class="meter"><span>${r.label}</span>${bar(closed.length ? r.n / closed.length * 100 : 0, 'var(--violet)')}<span class="num r">${r.n}</span></div>`)}</div>`;
  patch(sec, html`<h2>📊 Analytics <span class="lbl SIMULATED">SIMULATED</span></h2>
    <p class="note">Kennzahlen aus simulierten/Paper-Trades. Historische Performance ist keine Garantie oder sichere Zukunftsaussage.</p>
    <div class="grid4">${kv('Trades gesamt', perf.trades)}${kv('Gewinner / Verlierer', perf.wins + ' / ' + perf.losses)}${kv('Win Rate', perf.winRate != null ? (perf.winRate * 100).toFixed(1) + '%' : '—')}${kv('Profit Factor', perf.profitFactor == null ? '—' : perf.profitFactor === Infinity ? '∞' : perf.profitFactor.toFixed(2))}${kv('Ø Gewinn', fmtUsd(perf.avgWin))}${kv('Ø Verlust', fmtUsd(perf.avgLoss))}${kv('Expectancy', fmtUsd(perf.expectancy))}${kv('Max Drawdown', fmtUsd(perf.maxDD))}${kv('Ø Haltedauer', fmtAge(perf.avgHold))}${kv('Fees', fmtUsd(perf.fees))}${kv('Brutto / Netto', fmtSigned(perf.gross) + ' / ' + fmtSigned(perf.net))}${kv('Bester / Schlechtester', fmtSigned(perf.best) + ' / ' + fmtSigned(perf.worst))}</div>
    <h3>PnL-Graph (Equity, simuliert)</h3><div class="chartbox small"><canvas data-chart="equity" aria-label="Equity-Verlauf"></canvas></div>
    <div class="grid2" style="margin-top:12px">${dist('PnL-Verteilung', pnlDist)}${dist('Haltedauer', holdDist)}${dist('Score-Verteilung (Entry)', scoreDist)}${dist('Risk-Verteilung (Entry)', riskDist)}</div>
    <div class="panel"><h3 style="margin-top:0">Exit-Gründe</h3>${Object.keys(exitR).length ? Object.entries(exitR).sort((a, b) => b[1] - a[1]).map(([k, n]) => html`<span class="chip">${k}: ${n}</span> `) : html`<span class="mut">—</span>`}</div>
    <div class="panel tw"><h3 style="margin-top:0">Strategie-Vergleich & Diagnose</h3><table class="tbl"><thead><tr><th>Strategie</th><th class="r">Signale</th><th class="r">Akzeptiert</th><th class="r">Abgelehnt</th><th class="r">Ausgeführt</th><th class="r">Profitabel</th><th class="r">Unprofitabel</th><th class="r">Trades</th><th class="r">Ø PnL</th><th class="r">Max DD</th><th class="r">Ø Größe</th></tr></thead><tbody>
      ${[...STRATEGY_DEFS.map(d => d.id), 'manuell'].map(id => { const s = st.stratStats[id] || {}; const tr = byStrat[id] || []; const p = perfStats(tr); return html`<tr><td>${(STRATEGY_DEFS.find(d => d.id === id) || { name: 'Manuell' }).name}${st.strategies[id] && !st.strategies[id].enabled ? html` <span class="chip vio">aus/Shadow</span>` : ''}</td><td class="r num">${s.signals || 0}</td><td class="r num">${s.accepted || 0}</td><td class="r num">${s.rejected || 0}</td><td class="r num">${s.executed || 0}</td><td class="r num">${s.profitable || 0}</td><td class="r num">${s.unprofitable || 0}</td><td class="r num">${tr.length}</td><td class="r num">${fmtUsd(p.expectancy)}</td><td class="r num">${fmtUsd(p.maxDD)}</td><td class="r num">${tr.length ? fmtUsd(avg(tr.map(j => j.sizeUsd))) : '—'}</td></tr>`; })}
    </tbody></table><p class="note">Transparente Gegenüberstellung – kein „Gewinner“-Ranking bei zu kleiner Stichprobe.</p></div>
    <div class="grid2"><div class="panel"><h3 style="margin-top:0">Signal-Qualität (in Trades)</h3>${Object.keys(sigPerf).length ? html`<table class="tbl"><tr><th>Signal</th><th class="r">Trades</th><th class="r">Win Rate</th><th class="r">Σ PnL</th></tr>${Object.entries(sigPerf).sort((a, b) => b[1].n - a[1].n).map(([k, x]) => html`<tr><td>${SIGNAL_NAMES[k] || k}</td><td class="r num">${x.n}</td><td class="r num">${(x.w / x.n * 100).toFixed(0)}%</td><td class="r num ${cls(x.pnl)}">${fmtSigned(x.pnl)}</td></tr>`)}</table>` : html`<div class="empty">Noch keine abgeschlossenen Trades.</div>`}</div>
    <div class="panel"><h3 style="margin-top:0">False Signals (starke Signale, sofortige Gegenbewegung)</h3>${st.falseSignals.length ? html`<table class="tbl">${st.falseSignals.slice(0, 12).map(f => html`<tr><td class="num">${fmtTime(f.ts)}</td><td>${f.symbol}</td><td>${f.signals.join(', ')}</td><td class="r num dn">${fmtPct(f.mae2m)}</td></tr>`)}</table>` : html`<div class="empty">Keine erfasst.</div>`}</div></div>
    <div class="panel tw"><h3 style="margin-top:0">Parameter-Versionen (Überwachung ${core.S().ffAutoTuning ? 'AN' : 'AUS'})</h3><table class="tbl"><tr><th>Version</th><th>Zeit</th><th>Status</th><th>Parameter</th><th class="r">Trades</th><th class="r">Expectancy</th><th>Notiz</th><th></th></tr>
      ${[...st.paramVersions].reverse().map(p => html`<tr><td>v${p.version}${p.version === st.activeParam ? ' (aktiv)' : ''}</td><td class="num">${fmtDateTime(p.ts)}</td><td><span class="chip ${p.status === 'STABLE' ? 'ok' : p.status === 'ROLLED_BACK' ? 'bad' : 'info'}">${p.status}</span></td><td class="mut">${Object.entries(p.params).map(([k, v]) => k + '=' + v).join(', ')}</td><td class="r num">${p.tradeCount || 0}</td><td class="r num">${p.perf ? fmtUsd(p.perf.expectancy) : '—'}</td><td class="mut">${p.note || ''}</td><td>${p.version !== st.activeParam ? html`<button class="btn sm" data-act="rollback" data-v="${p.version}">Aktivieren</button>` : ''}</td></tr>`)}</table>
      <p class="note">Neue Parameter entstehen nur über die Lern-KI (Train → Validation → Test, Walk-Forward, Shadow-Phase, nur verschärfend) – nie aus einer Suche über dieselben Trades, an denen sie gemessen werden. Bewertung einer Version erst ab ${core.S().minTradesForTuning} abgeschlossenen Trades, nur in SIMULATION, nur innerhalb fester Grenzen (${Object.entries(TUNING_BOUNDS).map(([k, v]) => k + ' ' + v[0] + '–' + v[1]).join(', ')}). Risiko-Limits, Kill Switch, Security- und Stale-Data-Blocks verändert sie nie. Schlechtere Versionen werden automatisch zurückgerollt.</p></div>
    <div class="panel"><h3 style="margin-top:0">Trading Session</h3><div class="grid4">${kv('Session', st.session ? st.session.id : '—')}${kv('Start', st.session ? fmtDateTime(st.session.startedAt) : '—')}${kv('Trades', st.session ? st.session.trades : 0)}${kv('Wins / Losses', st.session ? st.session.wins + ' / ' + st.session.losses : '—')}${kv('Session PnL', st.session ? fmtSigned(st.session.pnl) : '—', 'SIMULATED')}${kv('Heute PnL', fmtSigned(st.risk.dailyPnl))}${kv('Käufe heute', st.risk.dailyTrades)}${kv('Tag', st.risk.dayKey)}</div>
      <div class="row" style="margin-top:10px"><button class="btn" data-act="newSession">↻ Neue Session</button><button class="btn sm" data-act="export" data-kind="analytics-json">⬇ Analytics JSON</button><button class="btn sm" data-act="export" data-kind="journal-csv">⬇ Journal CSV</button></div>
      ${st.sessions.length ? html`<table class="tbl" style="margin-top:10px"><tr><th>Session</th><th>Start</th><th>Ende</th><th class="r">Trades</th><th class="r">PnL</th></tr>${st.sessions.slice(0, 8).map(s => html`<tr><td>${s.id}</td><td class="num">${fmtDateTime(s.startedAt)}</td><td class="num">${fmtDateTime(s.endedAt)}</td><td class="r num">${s.trades}</td><td class="r num">${fmtSigned(s.pnl)}</td></tr>`)}</table>` : ''}</div>`);
  drawCharts(sec);
}

/* ---------- Lern-KI (Adaptive Loss Intelligence) ---------- */
const LSTAT = { BASELINE: 'info', CHALLENGER: 'vio', READY: 'warn', LIVE: 'warn', STABLE: 'ok', RETIRED: '', ROLLED_BACK: 'bad', REJECTED: 'bad', VALIDATED: 'ok', INSUFFICIENT_DATA: '', IDEA: 'info', TESTING: 'vio', SHADOW: 'vio', PROMOTED: 'ok', VALIDATED_HOLD: 'warn', DRIFT: 'bad', WATCH: 'warn', STABLE_LEARNING_PATTERN: 'ok', HYPOTHESIS: 'info', INSUFFICIENT: '', ACTIVE: 'ok', EXPIRED: '', REVIEW: 'warn', AVOID: 'bad', PREFER: 'ok', NOT_ENOUGH_DATA: '', CALIBRATED: 'ok', NOT_CALIBRATED: 'warn', WEAK: 'warn', INSUFFICIENT_EVIDENCE: '', LIKELY: 'bad', POSSIBLE: 'warn', NO: 'ok', UNKNOWN: '' };
const LSTAT_DE = { BASELINE: 'Ausgangsparameter', CHALLENGER: 'im Shadow-Test (keine Orders)', READY: 'Shadow bestanden – wartet auf Freigabe', LIVE: 'übernommen – wird überwacht', STABLE: 'übernommen & bestätigt', RETIRED: 'abgelöst', ROLLED_BACK: 'zurückgerollt', REJECTED: 'verworfen', VALIDATED_HOLD: 'validiert – wartet', STABLE_LEARNING_PATTERN: 'stabiles Muster (OOS bestätigt)', HYPOTHESIS: 'Hypothese', INSUFFICIENT: 'zu wenig Daten', NOT_ENOUGH_DATA: 'zu wenig Daten', INSUFFICIENT_DATA: 'zu wenig Daten', INSUFFICIENT_EVIDENCE: 'zu wenig Daten' };
const lchip = s => html`<span class="chip ${LSTAT[s] || ''}" title="${LSTAT_DE[s] || ''}">${s}</span>`;
const famDe = f => (f === 'UNKNOWN' ? 'Unbekannt (zu wenig Daten)' : LOSS_FAMILY_DE[f] || f || '—');
const nv = v => (v == null ? '—' : v);
const pctOf = v => (isNum(v) ? Math.round(v * 100) + ' %' : '—');
const nNeed = (n, need) => html`<div class="meter"><span>${n} / ${need}</span>${bar(need ? n / need * 100 : 0, n >= need ? 'var(--green)' : 'var(--violet)')}<span class="num r">${n >= need ? '✓' : Math.round(n / need * 100) + '%'}</span></div>`;
function modelCard(v, S, active) {
  if (!v) return html`<div class="empty">—</div>`;
  const sh = v.shadow, lv = v.live, applied = Object.entries(v.applied || {});
  return html`<div class="card" style="padding:10px;margin-bottom:8px"><div class="ch"><b>${v.id}</b>${lchip(v.status)}${active ? html`<span class="chip ok">aktiv</span>` : ''}<span class="ag">${v.note || ''}</span></div>
    <p class="mut" style="margin:6px 0">${LSTAT_DE[v.status] || ''}${v.experimentId ? ' · Experiment ' + v.experimentId : ''}${v.promotedAt ? ' · übernommen ' + fmtDateTime(v.promotedAt) + (v.promotedBy === 'AUTO' ? ' (automatisch)' : ' (manuell)') : ''}${v.rolledBackAt ? ' · Rollback ' + fmtDateTime(v.rolledBackAt) + ': ' + (v.rollbackReason || '') : ''}${v.reason ? ' · ' + v.reason : ''}</p>
    ${applied.length ? html`<div>${applied.map(([k, c]) => html`<span class="chip">${k}: ${c.from} → ${c.to}</span> `)}</div>` : ''}
    ${v.change && !applied.length && v.status !== 'BASELINE' ? html`<div class="mut">Änderung: ${JSON.stringify(v.change)}</div>` : ''}
    ${sh && ['CHALLENGER', 'READY'].includes(v.status) ? html`<h3>Shadow-Phase</h3>${nNeed(sh.n, S.learnShadowTrades)}<div class="grid3">${kv('Challenger (Shadow)', fmtSigned(sh.chNet), 'SIMULATED')}${kv('Champion (echt)', fmtSigned(sh.baseNet), 'SIMULATED')}${kv('Vom Challenger vermieden', sh.blocked + ' Trades')}${kv('Max DD Challenger', fmtUsd(sh.cDD))}${kv('Max DD Champion', fmtUsd(sh.bDD))}${kv('Parallel-Entscheidungen', sh.decN + (sh.wouldBlock ? ' · ' + sh.wouldBlock + '× NO TRADE' : ''))}</div>
      ${sh.decisions.length ? html`<div class="an tw"><table class="tbl"><tr><th>Zeit</th><th>Token</th><th>Champion</th><th>Challenger</th><th class="r">Score</th></tr>${sh.decisions.slice(0, 6).map(d => html`<tr><td class="num">${fmtTime(d.ts)}</td><td>${d.symbol}</td><td>${d.champion}</td><td><span class="chip ${d.challenger === 'BUY' ? 'ok' : 'warn'}">${d.challenger}</span></td><td class="r num">${d.score}</td></tr>`)}</table></div>` : ''}` : ''}
    ${lv && v.status === 'LIVE' ? html`<h3>Live-Überwachung</h3>${nNeed(lv.n, S.learnShadowTrades)}<div class="grid3">${kv('Netto seit Übernahme', fmtSigned(lv.net), 'SIMULATED')}${kv('Ø je Trade', lv.n ? fmtSigned(lv.net / lv.n) : '—')}${kv('Baseline Ø je Trade', lv.baseline ? fmtSigned(lv.baseline.expectancy) : 'keine')}</div>` : ''}
    <div class="row" style="margin-top:8px">${v.status === 'READY' ? html`<button class="btn sm pri" data-act="learnPromote" data-id="${v.id}">✓ Übernehmen (nur SIMULATION)</button>` : ''}${['CHALLENGER', 'READY'].includes(v.status) ? html`<button class="btn sm" data-act="learnReject" data-id="${v.id}">✕ Verwerfen</button>` : ''}${active && ['LIVE', 'STABLE'].includes(v.status) ? html`<button class="btn sm warn" data-act="learnRollback" data-id="${v.id}">↺ Rollback auf ${v.basedOn}</button>` : ''}</div></div>`;
}
function renderLearning(sec) {
  const st = core.state, S = core.S(), L = st.learn, R = st.research, M = st.models, lv = core.learnView();
  const recs = L.records, losses = recs.filter(r => !r.outcome.win), legacy = recs.filter(r => r.legacy).length, fresh = recs.length - legacy;
  const fam = lv.fam || { losses: 0, counts: {} }, famRows = Object.entries(fam.counts).sort((a, b) => b[1] - a[1]);
  const avoid = { LIKELY: 0, POSSIBLE: 0, NO: 0, UNKNOWN: 0 }; for (const r of losses) if (r.labels) avoid[r.labels.avoidable] = (avoid[r.labels.avoidable] || 0) + 1;
  const ch = lv.challenger, champ = lv.champion, drift = L.drift, cal = L.calibration, lm = L.lossModel;
  const maxPat = Math.max(0, ...Object.values(st.patterns).map(a => a.n));
  const base = lv.base, stats = (lv.stats || []).filter(x => x.n >= 5);
  const topPat = [...stats].filter(x => x.entry && isNum(x.expPct) && base).sort((a, b) => Math.abs(b.expPct - base.expPct) - Math.abs(a.expPct - base.expPct)).slice(0, 14);
  const strats = [...new Set(stats.filter(x => x.dims.strategy && x.dims.regime && Object.keys(x.dims).length === 2).map(x => x.dims.strategy))];
  const regs = [...new Set(stats.filter(x => x.dims.strategy && x.dims.regime && Object.keys(x.dims).length === 2).map(x => x.dims.regime))];
  const cell = (s, r) => stats.find(x => x.key === `strategy=${s}&regime=${r}`);
  const lessons = L.lessons.filter(l => l.status !== 'EXPIRED');
  const recent = [...recs].reverse().slice(0, 15);
  const ec = lv.errors, nm = lv.nearMiss, ds = lv.disc, ap = core.activeParams();
  const NMV = { FILTER_COSTLY: ['warn', 'kostet eher Chancen'], FILTER_HELPS: ['ok', 'schützt eher'], NOT_ENOUGH_DATA: ['', 'zu wenig Daten'] };
  const DSV = { WORSE: ['bad', 'schlechter als Ø'], BETTER: ['ok', 'besser als Ø'], AVERAGE: ['', 'im Schnitt'], NOT_ENOUGH_DATA: ['', 'zu wenig Daten'] };
  const openD = new Set([...sec.querySelectorAll('details[data-k][open]')].map(d => d.dataset.k));
  const changed = patch(sec, html`<h2>🧠 Learning KI <span class="lbl SIMULATED">SIMULATED</span></h2>
    <p class="note">Lernt aus jedem abgeschlossenen (simulierten) Trade – vor allem aus Verlusten: Was war beim Einstieg messbar, wie verlief der Coin-Preis danach, welche Ursache ist belegt? Regeln entstehen nur aus zeitlich getrennt validierten Experimenten (Train → Validation → Test, Walk-Forward), laufen danach im Shadow-Modus (keine Orders) und werden nur in SIMULATION übernommen – ausschließlich verschärfend und mit automatischem Rollback. Risiko-Limits, Security-Blocker, Emergency Stop und LIVE-Gating werden von der KI nie verändert. Keine Gewinn-Garantie.</p>
    ${!S.learnEnabled ? html`<div class="panel bad">Lern-KI ist ausgeschaltet (Einstellungen → Lern-KI). Gelernte Regeln sind inaktiv.</div>` : ''}
    ${L.corrupted.length ? html`<div class="panel warn">Beschädigte Lerndaten (${L.corrupted.join(', ')}) wurden beim Start verworfen und neu begonnen. Handel war nicht betroffen.</div>` : ''}
    <div class="grid4">${kv('Lern-KI', S.learnEnabled ? 'AN' : 'AUS')}${kv('Ausgewertete Trades', recs.length + (legacy ? ` (${legacy} legacy)` : ''))}${kv('Davon Verluste', losses.length)}${kv('Aktives Modell', champ ? champ.id + ' · ' + champ.status : '—')}${kv('Challenger', ch ? ch.id + ' · ' + ch.status : 'keiner')}${kv('Drift', drift ? drift.status : 'NOT_ENOUGH_DATA')}${kv('Gelernte Regeln aktiv', lv.rulesText.length ? lv.rulesText.length + '' : 'keine')}${kv('Letzter Lernlauf', L.lastRunAt ? fmtTime(L.lastRunAt) : '—')}</div>
    <div class="row" style="margin:10px 0"><button class="btn" data-act="learnRun">▶ Lernlauf jetzt</button><button class="btn sm" data-act="view" data-view="settings">⚙ Lern-Einstellungen</button></div>
    <div class="grid2 lgrid">
      <div class="panel"><h3 style="margin-top:0">Datenbasis – ab wann sind Aussagen belastbar?</h3>
        <div class="mut" style="font-size:12px">Experiment (3 × Test-Fenster)</div>${nNeed(fresh + legacy, S.learnMinTest * 3)}
        <div class="mut" style="font-size:12px">Stabiles Muster (größtes Muster)</div>${nNeed(maxPat, S.learnMinPattern)}
        <div class="mut" style="font-size:12px">Drift-Erkennung (ohne legacy)</div>${nNeed(fresh, 30)}
        <div class="mut" style="font-size:12px">Kalibrierung & Loss-Modell (ohne legacy)</div>${nNeed(fresh, 40)}
        <p class="note">Unterhalb dieser Mengen meldet die KI NOT_ENOUGH_DATA statt Scheinsicherheit. Belastbar wird es typischerweise ab 60–100 Trades je Marktphase; hohe Trefferquoten bei kleiner Stichprobe werden als Warnsignal markiert, nicht als Regel.</p></div>
      <div class="panel"><h3 style="margin-top:0">Aktive gelernte Regeln (nur verschärfend)</h3>
        ${lv.rulesText.length ? html`<div>${lv.rulesText.map(t => html`<span class="chip warn">${t}</span> `)}</div>` : html`<p class="mut">Keine – der Bot handelt mit deinen Einstellungen.</p>`}
        ${champ && Object.keys(champ.applied || {}).length ? html`<p class="mut">Vom aktiven Modell gesetzte Einstellungen: ${Object.entries(champ.applied).map(([k, c]) => k + ' ' + c.from + ' → ' + c.to).join(', ')}</p>` : ''}
        <p class="note">Lernbar sind nur: Min. Score, Min. Confidence, Min. Liquidität, Min. Pair-Alter, „nur VERIFIED Security“, Stop-Loss (${LEARN_BOUNDS.stopLossPct.join('–')} %), Trailing (${LEARN_BOUNDS.trailPct.join('–')} %) sowie Sperren je Strategie × Regime, Score-Aufschlag je Regime (max. +${LEARN_BOUNDS.regimeScoreBump[1]}), Volume-Bestätigung und „kein Einstieg nach Pump“. Manuelle Trades sind davon nicht betroffen.</p></div></div>
    <div class="grid2 lgrid"><div class="panel"><h3 style="margin-top:0">Aktives Modell (Champion)</h3>${modelCard(champ, S, true)}</div>
      <div class="panel"><h3 style="margin-top:0">Challenger (Shadow)</h3>${ch ? modelCard(ch, S, false) : html`<p class="mut">Kein Challenger. Neue Kandidaten entstehen nur aus validierten Experimenten${drift && drift.status === 'DRIFT' ? ' – aktuell wegen Drift pausiert' : ''}.</p>`}</div></div>
    <div class="panel"><h3 style="margin-top:0">Verlust-Observatorium – warum wurde verloren?</h3>
      ${famRows.length ? html`<div class="grid2 lgrid"><div>${famRows.map(([k, n]) => html`<div class="meter"><span title="${k}">${famDe(k)}</span>${bar(n / fam.losses * 100, k === 'NOISE_OR_RANDOM' || k === 'UNKNOWN' ? 'var(--dim)' : 'var(--red)')}<span class="num r">${n}</span></div>`)}</div>
        <div class="grid2">${kv('Wahrscheinlich vermeidbar', avoid.LIKELY)}${kv('Möglicherweise vermeidbar', avoid.POSSIBLE)}${kv('Normale Streuung', avoid.NO)}${kv('Unklar (zu wenig Daten)', avoid.UNKNOWN)}</div></div>` : html`<div class="empty">Noch keine ausgewerteten Verluste.</div>`}
      ${ec.n ? html`<h3>Fehlerklassen – nicht jeder Verlust ist ein Fehler</h3><div class="grid2 lgrid"><div>${ERROR_CLASSES.filter(c => ec.classes[c]).map(c => html`<div class="meter"><span>${ERROR_CLASS_DE[c]}</span>${bar(ec.classes[c] / ec.n * 100, c === 'STATISTICAL' || c === 'UNKNOWN' ? 'var(--dim)' : 'var(--red)')}<span class="num r">${ec.classes[c]}</span></div>`)}</div>
        <div class="grid2">${kv('Erwartbar (im Plan, Zufall)', ec.verdicts.EXPECTED)}${kv('Im Plan, mit Ursache', ec.verdicts.WITHIN_PLAN_WITH_CAUSE + ec.verdicts.WITHIN_PLAN)}${kv('Größer als geplant', ec.verdicts.OVER_PLAN)}${kv('Ohne geplanten Stop', ec.verdicts.UNKNOWN)}</div></div>
        <p class="note">„Erwartbar“ = Verlust innerhalb des beim Einstieg geplanten Risikos (Stop + Slippage-Toleranz + Kosten) ohne belegte Ursache: normaler Teil der Strategie, daraus wird nichts „gelernt“. Aus Verlusten mit belegter Ursache entstehen höchstens Hypothesen, die erst getestet werden.</p>` : ''}
      ${recent.length ? html`<div class="tw" style="margin-top:10px"><table class="tbl"><thead><tr><th>Geschlossen</th><th>Token</th><th>Strategie</th><th class="r">PnL</th><th>Ursache</th><th class="r an">Evidenz</th><th>Vermeidbar</th><th>Fehlerklasse</th><th>Erwartbar?</th><th class="an">Daten</th><th class="an">Signal</th><th class="an">Exit</th><th class="r an">MAE 2m</th><th class="r an">Nachlauf max</th></tr></thead><tbody>
        ${recent.map(r => { const l = r.labels || {}; return html`<tr><td class="num">${fmtDateTime(r.closedAt)}</td><td>${r.symbol}${r.legacy ? html` <span class="chip">legacy</span>` : ''}</td><td>${r.strategy || 'manuell'}</td><td class="r num ${cls(r.outcome.pnlPct)}">${fmtPct(r.outcome.pnlPct)}</td><td>${r.outcome.win ? html`<span class="mut">Gewinn</span>` : famDe(l.lossFamily)}</td><td class="r num an">${l.lossFamily ? (l.evidence || {})[l.lossFamily] : '—'}</td><td>${r.outcome.win ? '—' : lchip(l.avoidable || 'UNKNOWN')}</td><td title="${l.errorWhy || ''}">${r.outcome.win || !l.errorClass ? '—' : ERROR_CLASS_DE[l.errorClass] || l.errorClass}</td><td title="${l.expectedLoss && isNum(l.expectedLoss.plannedPct) ? `geplant −${l.expectedLoss.plannedPct} % + Toleranz ${l.expectedLoss.tolPct} %${l.expectedLoss.source === 'SETTINGS' ? ' (Stop aus aktuellen Einstellungen, Näherung)' : ''}` : ''}">${r.outcome.win || !l.lossVerdict ? '—' : html`<span class="chip ${l.lossVerdict === 'EXPECTED' ? 'ok' : l.lossVerdict === 'OVER_PLAN' ? 'bad' : l.lossVerdict === 'UNKNOWN' ? '' : 'warn'}">${l.lossVerdict === 'EXPECTED' ? 'ja' : l.lossVerdict === 'OVER_PLAN' ? 'nein – über Plan' : l.lossVerdict === 'UNKNOWN' ? 'unklar' : 'im Plan, Ursache'}</span>`}</td><td class="an">${l.dataQuality || '—'}</td><td class="an">${l.signalQuality || '—'}</td><td class="an">${l.exitQuality || '—'}</td><td class="r num an">${fmtPct(r.path.mae2m)}</td><td class="r num an">${r.followUp ? fmtPct(r.followUp.maxAfterPct) : L.followUps.some(f => f.tradeId === r.tradeId) ? 'läuft' : '—'}</td></tr>`; })}
      </tbody></table></div>
      <div class="an">${recent.filter(r => !r.outcome.win).slice(0, 6).map(r => { const l = r.labels || {}; return html`<details class="panel" style="margin:6px 0" data-k="cf-${r.tradeId}"><summary><b>${r.symbol}</b> ${fmtPct(r.outcome.pnlPct)} · ${famDe(l.lossFamily)}${arr(l.secondary).length ? ' · auch: ' + l.secondary.map(famDe).join(', ') : ''} <span class="mut">(Datenvollständigkeit ${l.dataCompleteness != null ? l.dataCompleteness + ' %' : '—'})</span></summary>
        <ul class="mut">${Object.entries(l.why || {}).map(([k, t]) => html`<li><b>${famDe(k)}</b> (${(l.evidence || {})[k]}): ${t}</li>`)}</ul>
        <div class="tw"><table class="tbl"><tr><th>Was wäre wenn … (historische Simulation)</th><th class="r">Ergebnis</th><th>Hinweis</th></tr>${arr(r.cf).map(c => html`<tr><td>${c.scenario}</td><td class="r num ${cls(c.result)}">${c.result == null ? '—' : fmtPct(c.result)}</td><td class="mut">${c.note || CF_NOTE}</td></tr>`)}</table></div>
        <p class="note">Tatsächlich: ${fmtPct(r.outcome.pnlPct)}. Counterfactuals sind Näherungen aus dem gespeicherten Preispfad – keine Aussage darüber, was sicher passiert wäre.</p></details>`; })}</div>` : ''}</div>
    <div class="panel"><h3 style="margin-top:0">Was die KI gelernt hat (Lektionen)</h3>
      ${lessons.length ? lessons.slice(0, 12).map(l => html`<div class="check"><span class="ic ${l.kind === 'AVOID' ? 'fail' : 'pass'}">${l.kind === 'AVOID' ? 'MEIDEN' : 'GUT'}</span><div><b>${l.text}</b><small>${lchip(l.status)} ${l.stable ? 'stabil, Out-of-Sample bestätigt' : 'Beobachtung – noch keine Regel'} · Evidenz ${l.evidence} · ${l.confirmed}× bestätigt · gültig bis ${fmtDateTime(l.expiresAt)}</small></div></div>`) : html`<div class="empty">Noch keine belastbaren Lektionen – es braucht mindestens 8 Trades in einem Muster mit deutlich abweichendem Ergebnis.</div>`}
      <p class="note">Lektionen sind Wissen, keine Handelsregeln. Sie laufen nach 7 Tagen ohne Bestätigung ab; bei Drift werden sie zur Überprüfung markiert.</p></div>
    <div class="panel" id="discPanel"><h3 style="margin-top:0">Coin-Quellen – woher kommen gute und schlechte Trades?</h3>
      ${ds.rows.length ? html`<div class="tw"><table class="tbl"><thead><tr><th>Quelle (zuerst gefunden über)</th><th class="r">Trades</th><th class="r">Trefferquote</th><th class="r">Ø je Trade</th><th class="r an">Netto</th><th class="r an">Near-Misses (verpasst / vermieden)</th><th>Einordnung</th></tr></thead><tbody>${ds.rows.map(r => html`<tr><td>${DISC_DE[r.disc] || r.disc}${r.paid ? html` <span class="chip warn">bezahlt</span>` : ''}</td><td class="r num">${r.n}</td><td class="r num">${r.winRate != null ? (r.winRate * 100).toFixed(0) + ' %' : '—'}</td><td class="r num ${cls(r.avgPct)}">${fmtPct(r.avgPct)}</td><td class="r num an ${cls(r.netUsd)}">${r.n ? fmtSigned(r.netUsd) : '—'}</td><td class="r num an">${r.nm ? `${r.nm} (${r.nmMissed} / ${r.nmAvoided})` : '—'}</td><td><span class="chip ${DSV[r.verdict][0]}">${DSV[r.verdict][1]}</span></td></tr>`)}</tbody></table></div>` : html`<div class="empty">Noch keine abgeschlossenen Trades mit gespeicherter Quelle.</div>`}
      <p class="note">Jeder Coin merkt sich, über welche Quelle er zuerst gefunden wurde. Boosts und Profile sind bezahlte Werbung auf DexScreener. Verglichen wird ab ${DISC_MIN_N} Trades je Quelle mit dem Gesamtschnitt (${ds.n ? fmtPct(ds.basePct) : '—'} je Trade). Liegt eine Quelle deutlich darunter, schlägt die Lern-KI „Quelle meiden“ als Hypothese vor – übernommen wird das erst nach Out-of-Sample-Test und Shadow-Phase. Trades von vor Version 2.11.0 erscheinen als „unbekannt“.</p></div>
    <div class="panel"><h3 style="margin-top:0">Knapp verpasst (Near-Misses) – was kosten oder sparen die Filter?</h3>
      <div class="grid4">${kv('In Beobachtung', lv.nearMissOpen + (lv.nearMissSkipped ? ` (${lv.nearMissSkipped} übersprungen)` : ''))}${kv('Ausgewertet', nm.n + (nm.noData ? ` (+${nm.noData} ohne Daten)` : ''))}${kv('Verpasste Gewinne (TP1 vor Stop)', nm.missed)}${kv('Vermiedene Verluste (Stop vor TP1)', nm.avoided)}${kv('Σ verpasste Gewinne (sim.)', nm.n ? fmtPct(nm.gainPct) : '—', 'SIMULATED')}${kv('Σ vermiedene Verluste (sim.)', nm.n ? fmtPct(-nm.lossPct) : '—', 'SIMULATED')}${kv('Neutral nach 15 min', nm.neutral)}${kv('Fenster', '15 min')}</div>
      ${nm.rows.length ? html`<div class="tw" style="margin-top:8px"><table class="tbl"><thead><tr><th>Filter / Blocker</th><th class="r">n</th><th class="r">verpasst</th><th class="r">vermieden</th><th class="r">neutral</th><th class="r">Ø Ergebnis (sim.)</th><th>Einordnung</th></tr></thead><tbody>${nm.rows.map(r => html`<tr><td>${r.code}${r.kind === 'RISK' ? html` <span class="chip">Risiko/Portfolio</span>` : ''}</td><td class="r num">${r.n}</td><td class="r num">${r.missed}</td><td class="r num">${r.avoided}</td><td class="r num">${r.neutral}</td><td class="r num ${cls(r.avgSimPct)}">${fmtPct(r.avgSimPct)}</td><td><span class="chip ${NMV[r.verdict][0]}">${NMV[r.verdict][1]}</span></td></tr>`)}</tbody></table></div>` : html`<div class="empty">Noch keine ausgewerteten Near-Misses. Erfasst werden Kandidaten, denen genau ein Filter fehlte (z. B. Score bis 10 Punkte unter Minimum) oder die nur an Risiko-/Portfolio-Limits scheiterten.</div>`}
      ${L.nearMiss.done.length ? html`<details class="an" data-k="nm-recent" style="margin-top:8px"><summary>Letzte Near-Misses</summary><div class="tw"><table class="tbl"><tr><th>Zeit</th><th>Token</th><th>Filter</th><th class="r">Score</th><th class="r">max / min</th><th class="r">nach 15 min</th><th>Ergebnis</th></tr>${L.nearMiss.done.slice(0, 12).map(m => html`<tr><td class="num">${fmtDateTime(m.ts)}</td><td>${m.symbol}</td><td title="${m.msg || ''}">${m.code}${isNum(m.gap) ? ' (' + m.gap + ')' : ''}</td><td class="r num">${nv(m.score)}</td><td class="r num">${fmtPct(m.maxPct)} / ${fmtPct(m.minPct)}</td><td class="r num ${cls(m.endPct)}">${fmtPct(m.endPct)}</td><td>${NM_OUTCOME_DE[m.outcome] || m.outcome}${isNum(m.simPct) ? ' · sim. ' + fmtPct(m.simPct) : ''}</td></tr>`)}</table></div></details>` : ''}
      <p class="note">Reine Messung mit simuliertem Exit (Stop/Trailing/TP3, ohne Gebühren) – Näherung, keine Aussage, was sicher passiert wäre. Filter werden daraus nie automatisch gelockert: die Lern-KI darf nur verschärfen. „Kostet eher Chancen“ ist ein Hinweis zur manuellen Prüfung, erst ab ${NEAR_MISS_MIN_N} Fällen je Filter.</p></div>
    <div class="panel"><h3 style="margin-top:0">Aktive Parameter – Wert, Herkunft, Grund</h3><div class="tw"><table class="tbl"><thead><tr><th>Parameter</th><th class="r">Wert</th><th>Herkunft</th><th>seit</th><th class="an">Grund / Änderung</th><th class="an">Grenzen</th></tr></thead><tbody>
      ${ap.map(p => html`<tr><td title="${p.key}">${p.label}</td><td class="r num">${typeof p.value === 'boolean' ? (p.value ? 'an' : 'aus') : p.value + (p.unit && p.unit !== '$' ? ' ' + p.unit : '')}${p.value !== p.def && p.def !== undefined ? html` <small class="mut">(Std. ${typeof p.def === 'boolean' ? (p.def ? 'an' : 'aus') : p.def})</small>` : ''}</td><td><span class="chip ${p.source === 'LEARNED' ? 'vio' : p.source === 'DEFAULT' ? '' : p.source === 'UNTRACKED' || p.source === 'AUTO_TUNING' ? 'warn' : 'info'}" title="${PARAM_SOURCE_DE[p.source] || p.source}">${PARAM_SOURCE_DE[p.source] || p.source}</span></td><td class="num">${p.since ? fmtDateTime(p.since) : '—'}</td><td class="mut an">${p.reason}</td><td class="mut an">${p.bounds}</td></tr>`)}
      </tbody></table></div><p class="note">Herkunft aus dem Änderungsprotokoll (letzte 200 Änderungen) und dem aktiven Lern-Modell. Parameter ändern sich nur manuell, durch die Lern-KI nach bestandener Validierung + Shadow-Phase (nur SIMULATION) oder durch Rollback – nie unprotokolliert.</p></div>
    <div class="an">
      ${strats.length && regs.length ? html`<div class="panel tw"><h3 style="margin-top:0">Muster-Karte: Strategie × Marktregime (Ø PnL je Trade, n)</h3><table class="tbl"><tr><th>Strategie</th>${regs.map(r => html`<th class="r">${r}</th>`)}</tr>${strats.map(s => html`<tr><td>${s}</td>${regs.map(r => { const c = cell(s, r); return html`<td class="r num ${c ? cls(c.expPct) : ''}">${c ? fmtPct(c.expPct) + ' (' + c.n + ')' : '—'}</td>`; })}</tr>`)}</table></div>` : ''}
      <div class="panel tw"><h3 style="margin-top:0">Pattern Miner – auffälligste Einstiegs-Muster</h3>${topPat.length ? html`<table class="tbl"><thead><tr><th>Muster</th><th class="r">n</th><th class="r">Trefferquote</th><th class="r">Ø PnL</th><th class="r">Median</th><th class="r">Profit Factor</th><th class="r">Ø MAE 5m</th><th class="r">Anteil Verluste</th><th>Status</th><th>Hinweis</th></tr></thead><tbody>${topPat.map(p => html`<tr><td>${p.key.replace(/&/g, ' · ')}</td><td class="r num">${p.n}</td><td class="r num">${pctOf(p.winRate)}</td><td class="r num ${cls(p.expPct)}">${fmtPct(p.expPct)}</td><td class="r num">${fmtPct(p.medianPct)}</td><td class="r num">${p.profitFactor == null ? '—' : p.profitFactor === Infinity ? '∞' : p.profitFactor}</td><td class="r num">${fmtPct(p.avgMae)}</td><td class="r num">${p.ddContribution != null ? p.ddContribution + ' %' : '—'}</td><td>${lchip(p.status)}</td><td class="mut">${p.warning || (p.ci ? 'Band ' + fmtPct(p.ci.lo) + ' … ' + fmtPct(p.ci.hi) : '')}</td></tr>`)}</tbody></table><p class="note">Gesamt Ø ${fmtPct(base.expPct)} je Trade. Nur Merkmale zum Einstiegszeitpunkt – Exit-Gründe werden angezeigt, erzeugen aber keine Einstiegsregeln.</p>` : html`<div class="empty">Noch zu wenige Trades (mind. 5 je Muster).</div>`}</div>
      <div class="grid2 lgrid"><div class="panel tw"><h3 style="margin-top:0">Hypothesen</h3>${R.hypotheses.length ? html`<table class="tbl"><tr><th>ID</th><th>Hypothese</th><th>Status</th><th class="r">n</th></tr>${R.hypotheses.slice(0, 15).map(h => html`<tr><td class="num">${h.id}</td><td>${h.title}<br><small class="mut">${h.statement}${h.result ? ' · ' + h.result.reason : ''}</small></td><td>${lchip(h.status)}</td><td class="r num">${h.sampleSize}</td></tr>`)}</table>` : html`<div class="empty">Noch keine Hypothesen.</div>`}</div>
        <div class="panel"><h3 style="margin-top:0">Research Queue (Priorität)</h3>${R.queue.length ? R.queue.slice(0, 8).map(q => html`<div class="meter" title="${Object.entries(q.factors).map(([k, v]) => k + ' ' + v).join(', ')}"><span>${q.id}</span>${bar(q.priority, 'var(--violet)')}<span class="num r">${q.priority}</span></div><small class="mut">${q.title}</small>`) : html`<div class="empty">Leer – nichts zu testen.</div>`}
          <p class="note">Priorität aus Wirkung, Evidenz, Aktualität, Breite, Sicherheit, Aufwand und Risiko. Je Lernlauf wird genau ein Experiment ausgeführt.</p></div></div>
      <div class="panel"><h3 style="margin-top:0">Experimente (zeitlich getrennt: Train 60 % · Validation 20 % · Test 20 % + Walk-Forward)</h3>${R.experiments.length ? R.experiments.slice(0, 8).map(e => html`<details class="panel" style="margin:6px 0" data-k="ex-${e.id}"><summary><b>${e.id}</b> ${lchip(e.decision)} ${e.title} <span class="mut">· ${fmtDateTime(e.ts)}</span></summary>
        <p class="mut">${e.reason}</p>
        ${e.trainWindow ? html`<div class="grid3">${kv('Train', e.tradesTrain + ' Trades · ' + fmtDateTime(e.trainWindow[0]) + ' – ' + fmtDateTime(e.trainWindow[1]))}${kv('Validation', e.tradesValidation + ' Trades')}${kv('Test (Out-of-Sample)', e.tradesTest + ' Trades · bis ' + fmtDateTime(e.testWindow[1]))}</div>` : ''}
        ${e.change ? html`<p>Getestete Änderung: <code>${JSON.stringify(e.change)}</code></p>` : ''}
        ${e.metricsBaseline && e.metricsBaseline.test ? html`<div class="tw"><table class="tbl"><tr><th></th><th class="r">Trades</th><th class="r">Netto</th><th class="r">Ø je Trade</th><th class="r">Trefferquote</th><th class="r">Profit Factor</th><th class="r">Max DD</th></tr>${[['Baseline (Test)', e.metricsBaseline.test], ['Challenger (Test)', e.metricsChallenger.test], ['Baseline (Validation)', e.metricsBaseline.validation], ['Challenger (Validation)', e.metricsChallenger.validation]].map(([n, m]) => html`<tr><td>${n}</td><td class="r num">${m.n}/${m.of}</td><td class="r num ${cls(m.net)}">${fmtSigned(m.net)}</td><td class="r num">${fmtSigned(m.expectancy)}</td><td class="r num">${pctOf(m.winRate)}</td><td class="r num">${m.profitFactor == null ? '—' : m.profitFactor === Infinity ? '∞' : m.profitFactor}</td><td class="r num">${fmtUsd(m.maxDD)}</td></tr>`)}</table></div>` : ''}
        ${e.robustness ? html`${e.robustness.checks.map(c => html`<div class="check"><span class="ic ${c.ok ? 'pass' : 'fail'}">${c.ok ? 'OK' : 'NEIN'}</span><div><b>${c.name}</b><small>${c.detail}</small></div></div>`)}${e.robustness.simulatedExits ? html`<p class="note">Exit-Änderung per Resimulation des gespeicherten Preispfads (Näherung).</p>` : ''}` : ''}
        <p class="note">${e.rollbackPlan}</p></details>`) : html`<div class="empty">Noch keine Experimente.</div>`}</div>
      <div class="grid2 lgrid"><div class="panel"><h3 style="margin-top:0">Drift-Erkennung ${drift ? lchip(drift.status) : ''}</h3>${drift && drift.checks && drift.checks.length ? html`<div class="tw"><table class="tbl"><tr><th>Bereich</th><th>Prüfung</th><th class="r">Wert</th><th>Status</th></tr>${drift.checks.map(c => html`<tr><td>${c.group}</td><td>${c.name}</td><td class="r num">${c.value == null ? '—' : c.value + ' ' + c.metric}</td><td>${lchip(c.status)}</td></tr>`)}</table></div><p class="note">Vergleich: letzte ${drift.curN} vs. vorherige ${drift.refN} Trades. Bei DRIFT werden keine neuen Modelle übernommen.</p>` : html`<div class="empty">NOT_ENOUGH_DATA – ab 30 Trades (ohne legacy).</div>`}</div>
        <div class="panel"><h3 style="margin-top:0">Kalibrierung Score → Trefferquote ${cal ? lchip(cal.status) : ''}</h3>${cal && cal.n ? html`<div class="tw"><table class="tbl"><tr><th>Score</th><th class="r">n</th><th class="r">Trefferquote</th><th class="r">Band (90 %)</th></tr>${cal.bins.filter(b => b.n).map(b => html`<tr><td>${b.lo}–${Math.min(b.hi, 100)}</td><td class="r num">${b.n}</td><td class="r num">${pctOf(b.rate)}</td><td class="r num">${pctOf(b.ciLo)} – ${pctOf(b.ciHi)}</td></tr>`)}</table></div><p class="note">Brier (Test) ${nv(cal.brierCal)} vs. ohne Score ${nv(cal.brierBase)} – ${cal.calibrated ? 'Score ist aussagekräftig kalibriert' : 'noch keine belastbare Wahrscheinlichkeit'}.</p>` : html`<div class="empty">Noch keine Daten.</div>`}
          <h3>Loss-Risiko-Modell ${lm ? lchip(lm.status) : ''}</h3>${lm && lm.w ? html`<div class="grid3">${kv('AUC (Test)', nv(lm.auc))}${kv('Brier vs. Basis', nv(lm.brier) + ' / ' + nv(lm.brierBase))}${kv('Train / Test', lm.nTrain + ' / ' + lm.nTest)}</div><p class="note">Logistische Regression auf Einstiegs-Features, Ziel = früher starker Verlust. Nur Research-Signal in der Detailansicht – ersetzt keine Regel.</p>` : html`<p class="mut">${lm ? `INSUFFICIENT_EVIDENCE – ${lm.n || 0} von ${lm.need || 40} Trades` : '—'}</p>`}</div></div>
      <div class="panel tw"><h3 style="margin-top:0">Modell-Register</h3><table class="tbl"><tr><th>Version</th><th>Status</th><th>Erstellt</th><th>Basis</th><th>Änderung</th><th>Shadow</th><th>Live</th></tr>${[...M.versions].reverse().map(v => html`<tr><td>${v.id}${v.id === M.champion ? ' (aktiv)' : ''}</td><td>${lchip(v.status)}</td><td class="num">${fmtDateTime(v.ts)}</td><td>${v.basedOn || '—'}</td><td class="mut">${v.note || ''}</td><td class="num">${v.shadow ? v.shadow.n + ' · ' + fmtSigned(v.shadow.chNet) + ' vs. ' + fmtSigned(v.shadow.baseNet) : '—'}</td><td class="num">${v.live ? v.live.n + ' · ' + fmtSigned(v.live.net) : '—'}</td></tr>`)}</table></div>
      <div class="panel tw"><h3 style="margin-top:0">False Signals 2.0</h3>${L.falseSignals.length ? html`<table class="tbl"><tr><th>Zeit</th><th>Token</th><th>Signale</th><th class="r">Score</th><th class="r">MAE 1m / 2m / 5m</th><th>Regime</th><th>Einordnung</th></tr>${L.falseSignals.slice(0, 15).map(f => html`<tr><td class="num">${fmtDateTime(f.ts)}</td><td>${f.symbol}</td><td>${f.signals.map(x => SIGNAL_NAMES[x] || x).join(', ')}</td><td class="r num">${nv(f.entryScore)}</td><td class="r num">${[f.mae1m, f.mae2m, f.mae5m].map(fmtPct).join(' / ')}</td><td class="mut">${arr(f.regime).join(', ')}</td><td>${f.classification}${f.recoveredLater ? ' (später erholt)' : ''}</td></tr>`)}</table>` : html`<div class="empty">Keine – erfasst werden starke Signale (≥ 70) mit ≤ −5 % in den ersten 2 Minuten.</div>`}</div>
    </div>
    ${L.reviews.length ? html`<div class="panel"><h3 style="margin-top:0">Kontrollierte Reviews nach Verlustserien</h3>${L.reviews.slice(0, 3).map(rv => html`<div class="card" style="padding:10px;margin-bottom:8px"><div class="ch"><b>${rv.id}</b><span class="chip warn">CONTROLLED_REVIEW</span><span class="ag">${fmtDateTime(rv.ts)} · ${rv.streak} Verluste</span></div>
      <p class="mut">Schwerpunkte: ${Object.entries(rv.shares).map(([k, n]) => k + ' ' + n).join(', ') || '—'} · Strategien: ${rv.strategies.map(([k, n]) => k + ' ' + n).join(', ')} · Regime: ${rv.regimes.map(([k, n]) => k + ' ' + n).join(', ') || '—'}</p>
      <p class="mut">${rv.unusual.probability != null ? `Wahrscheinlichkeit einer solchen Serie bei bisheriger Trefferquote ${pctOf(rv.unusual.winRate)}: ${(rv.unusual.probability * 100).toFixed(1)} % → ${rv.unusual.unusual ? 'statistisch ungewöhnlich' : 'im Rahmen normaler Streuung'}` : 'Zu wenig Vorgeschichte für eine Einordnung.'} · Fehlsignale: ${rv.falseSignalCluster} · Drift: ${rv.drift}</p>
      ${rv.featureDiffs.length ? html`<p class="mut an">Größte Unterschiede Verlierer vs. frühere Gewinner: ${rv.featureDiffs.map(d => `${d.feature} ${d.losses} vs. ${d.wins}`).join(' · ')}</p>` : ''}
      <p class="note">${rv.note}</p></div>`)}</div>` : ''}
    <div class="panel"><h3 style="margin-top:0">Lern-Timeline</h3>${L.timeline.length ? html`<div class="tw"><table class="tbl">${L.timeline.slice(0, 25).map(e => html`<tr><td class="num">${fmtDateTime(e.ts)}</td><td><span class="chip">${e.type}</span></td><td>${e.text}</td></tr>`)}</table></div>` : html`<div class="empty">Noch keine Lern-Ereignisse. Sie entstehen mit jedem abgeschlossenen Trade.</div>`}</div>
    <div class="panel"><h3 style="margin-top:0">Export</h3><div class="row"><button class="btn sm" data-act="export" data-kind="learning-report-csv">⬇ Lern-Report CSV</button><button class="btn sm" data-act="export" data-kind="learning-json">⬇ Learning Records JSON</button><button class="btn sm" data-act="export" data-kind="experiments-json">⬇ Hypothesen & Experimente JSON</button><button class="btn sm" data-act="export" data-kind="patterns-json">⬇ Muster JSON</button><button class="btn sm" data-act="export" data-kind="model-registry-json">⬇ Modell-Register JSON</button></div>
      <p class="note an">Alle Lerndaten liegen getrennt im Browser-Speicher (smartlab.v3.learning / experiments / models / patterns) und bleiben beim „Frischen Start“ erhalten.</p></div>
    <p class="note" style="display:${UI.pro ? 'none' : 'block'}">Muster-Karte, Hypothesen, Experimente, Drift, Kalibrierung, Modell-Register und False Signals: „Analyse-Daten“ in den Einstellungen einschalten.</p>`);
  if (changed) for (const d of sec.querySelectorAll('details[data-k]')) if (openD.has(d.dataset.k)) d.open = true; // Aufgeklappte Details beim Aktualisieren behalten
}

/* ---------- Risiko-Dashboard ---------- */
function renderRisk(sec) {
  const st = core.state, S = core.S(), r = st.risk, now = Date.now(), eq = core.equityInfo(), pr = core.portfolioRisk(), pf = st.portfolio;
  const cool = Object.entries(r.coinCooldown).filter(([, v]) => v > now).map(([id, v]) => [id, v, 'Coin']).concat(Object.entries(r.stratCooldown).filter(([, v]) => v > now).map(([id, v]) => [id, v, 'Strategie']));
  const corr = core.positionCorrelations();
  const posT = st.positions.map(p => tok(p.tokenId)).filter(t => t && t.A);
  const w = st.wallet;
  const dd = pf.peakEquity > 0 ? (pf.peakEquity - eq.equity) / pf.peakEquity * 100 : 0;
  patch(sec, html`<h2>🛡 Risiko</h2>
    <div class="grid4">${kv('Portfolio Risk', pr.score)}${kv('Open Exposure', fmtUsd(eq.exposure) + ' (' + eq.exposurePct.toFixed(1) + '%)')}${kv('Max. Exposure', S.maxExposurePct + '%')}${kv('Max. Position', S.maxPositionPct + '% = ' + fmtUsd(eq.equity * S.maxPositionPct / 100))}${kv('Drawdown aktuell', dd.toFixed(2) + '%')}${kv('Max Drawdown', (pf.maxDD || 0).toFixed(2) + '%')}${kv('Verlustserie', r.lossStreak + ' / ' + S.lossStreakLimit)}${kv('Globale Pause', r.globalPauseUntil > now ? 'noch ' + fmtAge(r.globalPauseUntil - now) : 'nein')}${kv('Loss-Cooldown', r.lossCooldownUntil > now ? 'noch ' + fmtAge(r.lossCooldownUntil - now) : 'frei')}${kv('Tages-PnL / Limit', fmtSigned(r.dailyPnl) + ' / −' + S.dailyLossLimitPct + '%')}${kv('Execution Risk (Ø Exit-Impact)', isNum(avg(st.positions.map(p => p.exitImpactPct).filter(isNum))) ? avg(st.positions.map(p => p.exitImpactPct).filter(isNum)).toFixed(2) + '%' : '—', 'ESTIMATED')}${kv('Data Risk (Ø Confidence)', posT.length ? Math.round(avg(posT.map(t => t.A.confidence.total))) + '%' : '—')}${kv('Security Risk', posT.length ? posT.filter(t => t.A.sec.status !== 'VERIFIED').length + ' nicht VERIFIED' : '—')}${kv('Käufe letzte Stunde', r.buyTimes.filter(x => now - x < HOUR).length + ' / ' + S.maxTradesPerHour)}${kv('Offene Positionen', st.positions.length + ' / ' + S.maxOpenPositions)}${kv('Tageslimit erreicht', r.dailyLimitHit ? 'JA – Auto-Trading aus' : 'nein')}</div>
    ${r.reviewRequired ? html`<div class="panel" style="margin-top:12px"><b class="warn">Review nach Verlustserie empfohlen.</b> <span class="mut">Prüfe History & Analytics. Der Bot wird nach Verlusten nicht aggressiver (keine Revenge-Logik, kein Martingale).</span>${st.learn.reviews[0] ? html` <span class="mut">Die Lern-KI hat die Serie analysiert (${st.learn.reviews[0].id}: ${Object.entries(st.learn.reviews[0].shares).map(([k, n]) => k + ' ' + n).join(', ') || '—'}; ${st.learn.reviews[0].unusual.unusual ? 'statistisch ungewöhnlich' : 'im Rahmen normaler Streuung'}).</span> <button class="btn sm" data-act="view" data-view="learning">🧠 Analyse ansehen</button>` : ''} <button class="btn sm" data-act="ackReview">Review erledigt</button></div>` : ''}
    <h3>Risk-Graph: Exposure, Drawdown, Portfolio Risk</h3><div class="chartbox small"><canvas data-chart="risk" aria-label="Risikoverlauf"></canvas></div>
    <div class="grid2" style="margin-top:12px"><div class="panel"><h3 style="margin-top:0">Limits (alle einstellbar, 0 = aus)</h3><table class="tbl">
      ${[['Max. Käufe pro Coin', S.maxBuysPerCoin > 0 ? S.maxBuysPerCoin : 'unbegrenzt'], ['Coin-Cooldown nach Verkauf', S.sellCooldownMin > 0 ? S.sellCooldownMin + ' min' : 'aus'], ['Loss-Cooldown', S.lossCooldownMin > 0 ? S.lossCooldownMin + ' min' : 'aus'], ['Verlustserie bis Pause', S.lossStreakLimit > 0 ? S.lossStreakLimit : 'aus'], ['Globale Pause', S.globalPauseMin > 0 ? S.globalPauseMin + ' min' : 'aus'], ['Nachkauf nur im Gewinn', S.addOnlyInProfit ? '≥ +' + PYRAMID_MIN_PNL_PCT + ' %' : 'aus'], ['Tagesverlust-Limit', S.dailyLossLimitPct > 0 ? S.dailyLossLimitPct + ' %' : 'aus'], ['Drawdown-Grenze', S.ddStopPct > 0 ? S.ddStopPct + ' %' : 'aus'], ['Käufe pro Stunde', S.maxTradesPerHour > 0 ? S.maxTradesPerHour : 'aus'], ['Max. offene Positionen', S.maxOpenPositions > 0 ? S.maxOpenPositions : 'unbegrenzt'], ['Safe Mode nach Scan-Fehlern', S.autoSafeMode ? 'an' : 'aus']].map(([k, v]) => html`<tr><td>${k}</td><td class="r num">${v}</td></tr>`)}</table>
      <p class="note">Einstellungen → Risiko. Profil „Lernmodus (ohne Limits)“ stellt alle auf einmal ab. Security-Sperren, Datenprüfungen und LIVE-Gating sind keine Limits und bleiben aktiv.</p></div>
    <div class="panel"><h3 style="margin-top:0">Aktive Cooldowns</h3>${cool.length ? html`<table class="tbl">${cool.map(([id, v, k]) => html`<tr><td>${(tok(id) || { symbol: shortAddr(mintOfId(id)) }).symbol}</td><td>${k}</td><td class="r num">${fmtAge(v - now)}</td></tr>`)}</table>` : html`<div class="empty">Keine Coin-Cooldowns.</div>`}
      <h3>Korrelation offener Positionen</h3>${corr.length ? html`<table class="tbl">${corr.map(c => html`<tr><td>${c.a} ↔ ${c.b}</td><td class="r num ${c.r != null && c.r >= S.correlationLimit ? 'bad' : ''}">${c.r == null ? 'zu wenig Daten' : c.r.toFixed(2)}</td></tr>`)}</table>` : html`<div class="empty">Weniger als 2 Positionen.</div>`}</div></div>
    ${walletPanel()}`);
  drawCharts(sec);
}

/* Wallet-Panel (gekapselter Adapter): Provider, Status, Public Key, Netzwerk, Balance, Signatur-Workflow */
function walletPanel() {
  const w = core.state.wallet;
  return html`<div class="panel"><h3 style="margin-top:0">Wallet (nur lesend · vorbereitet für später)</h3><p class="note">Nur Public Key, Netzwerk und SOL-Balance (per RPC verifiziert). Private Keys, Seed Phrases und Secret Keys werden nie abgefragt, gespeichert oder geloggt. Signieren ist deaktiviert.</p>
    <div class="grid4">${kv('Status', w.status)}${kv('Provider', w.provider || '—')}${kv('Adresse', w.pubkey ? shortAddr(w.pubkey) : '—')}${kv('Netzwerk (RPC)', w.network || '—', w.network ? 'LIVE' : 'UNKNOWN')}${kv('Balance', w.balanceLamports != null ? lamportsToSol(BigInt(w.balanceLamports)) + ' SOL' : '—', w.balanceLamports != null ? 'LIVE' : 'UNKNOWN')}${kv('Stand', w.balanceAt ? fmtTime(w.balanceAt) : '—')}${kv('Signatur-Workflow', 'deaktiviert')}${kv('Live-Gating', core.liveReadiness().ready ? 'erfüllt' : 'nicht erfüllt')}</div>
    ${w.error ? html`<p class="note bad">${w.error}</p>` : ''}
    <div class="row" style="margin-top:8px">${w.status === 'CONNECTED' ? html`<button class="btn sm" data-act="walletBal">↻ Balance & Netzwerk</button><button class="btn sm bad" data-act="walletOff">Trennen</button>` : html`<button class="btn sm" data-act="wallet">Wallet verbinden (lesend)</button>`}<button class="btn sm" data-act="live">LIVE-Gating ansehen</button></div></div>`;
}
/* ---------- Alarm-Chat ---------- */
function renderAlerts(sec) {
  const f = core.state.feed;
  patch(sec, html`<h2>💬 Alarm-Chat</h2><div class="toolbar"><button class="btn" data-act="notify">🔔 Browser-Benachrichtigungen</button><button class="btn sm" data-act="clearFeed">Verlauf leeren</button></div>
    ${f.length ? f.slice(0, 80).map(e => html`<div class="bub ${e.level}"><small>${fmtTime(e.ts)} · ${e.tag}<span class="an">${e.label ? ' · Daten ' + e.label : ''}${isNum(e.dataAge) ? ' (' + fmtAge(e.dataAge) + ' alt)' : ''}</span></small>${e.sym ? html`<b>${e.sym}</b> · ` : ''}${e.detail}
      ${e.mint ? html`<div class="note">${isNum(e.price) ? 'Coin-Preis ' + fmtPrice(e.price) + ' · ' : ''}${isNum(e.mc) ? html`<span class="mcv">${fmtMc(e.mc)}</span>` : ''}${e.risk ? ' · Risiko ' + e.risk : ''}<span class="an">${isNum(e.score) ? ' · Score ' + e.score : ''}${isNum(e.riskScore) ? ' · Risk ' + e.riskScore : ''}${isNum(e.conf) ? ' · Confidence ' + e.conf + '%' : ''}${isNum(e.strength) ? ' · Stärke ' + e.strength : ''}</span></div>
      <button class="ca" data-act="copy" data-v="${e.mint}" data-l="Mint"><code>${e.mint}</code><span>⧉ kopieren</span></button>
      <div class="lk"><a href="#" data-act="select" data-id="${e.tokenId}">🔍 Details</a>${linkHtml([['DexScreener', LINKS.dexscreener(null, e.mint)], ['RugCheck', LINKS.rugcheck(e.mint)], ['Solscan', LINKS.solscanToken(e.mint)]])}</div>` : ''}</div>`) : html`<div class="empty">Noch keine Alarme. Sie erscheinen hier wie in einem Chat.</div>`}`);
}

/* ---------- Diagnose: Warum kauft der Bot nicht? (global vs. je Kandidat getrennt) ---------- */
const CHECK_LABEL = { pass: 'OK', fail: 'BLOCK', warn: 'HINWEIS', info: 'INFO', na: 'N/A' };
const checkRows = list => html`${list.map(x => html`<div class="check"><span class="ic ${x.status}">${CHECK_LABEL[x.status]}</span><div><b>${x.name}</b><small>${x.detail}</small></div></div>`)}`;
function renderDiagnostics(sec) {
  const d = core.diagnostics(), rd = d.readiness, ms = masterStatus();
  const rr = Object.entries(d.rejectReasons || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  patch(sec, html`<h2>🩺 Diagnose – Warum kauft der Bot nicht?</h2>
    <div class="panel"><div class="ctl-top"><span class="mstat ${ms.state}">${ms.text}</span><div class="ctl-why">${rd.reason}</div></div>
      ${rd.hard.length ? html`<h3>Harte Blocker (global)</h3>${rd.hard.map(b => html`<div class="check"><span class="ic fail">P${b.prio}</span><div><b>${b.code}</b><small>${b.msg}</small></div></div>`)}` : ''}
      ${rd.soft.length ? html`<h3>Hinweise (kein Block)</h3>${rd.soft.map(b => html`<div class="check"><span class="ic warn">INFO</span><div><b>${b.code}</b><small>${b.msg}</small></div></div>`)}` : ''}
      <p class="note">READY = System gesund und Kandidat vorhanden · WAITING = System gesund, aktuell kein geeignetes Setup (kein Fehler) · BLOCKED = echte harte Sicherheits-/Systemblockade · ERROR = technischer Fehler · EMERGENCY STOP = Not-Aus. Niedriger Score, kein Konsens oder kein Kandidat lösen nie BLOCKED aus.</p></div>
    <div class="grid2"><div class="panel"><h3 style="margin-top:0">System & Sicherheit (global)</h3>${checkRows(d.system)}</div>
      <div><div class="panel"><h3 style="margin-top:0">Trading-Einstellungen</h3>${checkRows(d.trading)}</div><div class="panel"><h3 style="margin-top:0">Markt (informativ)</h3>${checkRows(d.market)}</div></div></div>
    <div class="panel"><h3 style="margin-top:0">Kandidaten im Detail (je Token, kein globaler Block)</h3>
      <p class="note">Je Stufe: PASS · Ablehnungsgrund · „—“ = nicht erreicht. Werte stehen klein daneben (Security, Liquidität, MC, Volumen, Momentum, Risk, Score, Confidence, Konsens).</p>
      ${d.chains.length ? d.chains.map(c => html`<div class="card" style="margin-bottom:8px;padding:10px"><div class="ch"><a href="#" data-act="select" data-id="${c.id}"><b>${c.symbol}</b></a>${decChip(c.chain.decision)}${scoreChip(c.score)}${c.chain.reason ? html`<span class="ag">${c.chain.reason}</span>` : ''}</div>
        ${chainHtml(c.chain)}</div>`) : html`<div class="empty">Noch keine analysierten Kandidaten.</div>`}</div>
    <div class="grid2"><div class="panel"><h3 style="margin-top:0">Candidate Pipeline (aktueller Scan)</h3>${PIPELINE.map((p, i) => { const n = d.funnel[p] || 0, first = d.funnel.DISCOVERY || 1; return html`<div class="meter"><span>${i + 1}. ${p.replace('_', ' ')}</span>${bar(n / first * 100, 'var(--pink)')}<span class="num r">${n}</span></div>`; })}</div>
      <div class="panel"><h3 style="margin-top:0">Häufigste NO-TRADE-Gründe</h3>${rr.length ? html`<div class="tw"><table class="tbl">${rr.map(([c, n]) => html`<tr><td><span class="blk">${c}</span></td><td class="mut">${(BLOCKER_DEFS[c] || [])[2] || ''}</td><td class="r num">${n}</td></tr>`)}</table></div>` : html`<div class="empty">—</div>`}</div></div>
    <p><button class="btn" data-act="view" data-view="system">🖥 System & API Health, Metriken, Selbsttest →</button></p>`);
}
/* ---------- System & API Health (tiefe Diagnose, Metriken, Tests) ---------- */
function renderSystem(sec) {
  const st = core.state, h = core.systemHealth(), now = Date.now(), perf = st.metrics.perf, c = st.metrics.counters;
  const names = core.http.names().map(n => core.http.snapshot(n));
  const closed = st.journal.filter(j => j.status === 'CLOSED' && j.result);
  const wr = closed.length ? closed.filter(j => j.result.win).length / closed.length : null;
  const selT = selTok();
  const optional = new Set(['gecko', 'rugcheck', 'dexDisc', 'dexSol', 'jupiter']);
  const mm = core.monitorMetrics(), anoms = Object.values(st.monitor.active), act = core.S().anomalyMode === 'act';
  const ACT_DE = { WARN: 'warnen', DEGRADE: 'Größe ×0,5', PAUSE: 'Auto-Käufe pausieren', HARD_STOP: 'Not-Stopp' }, SEV_CLS = { WARN: 'warn', HIGH: 'bad', CRITICAL: 'bad' };
  const pct = v => (v == null ? '—' : Math.round(v * 100) + ' %');
  patch(sec, html`<h2>🖥 System & API Health</h2>
    <div class="panel" id="monitorPanel"><h3 style="margin-top:0">Monitoring – letzte 60 Minuten</h3>
      <div class="grid4">${kv('Signale / Stunde', mm.signals.perHour)}${kv('Security-Blockquote', pct(mm.blocks.security))}${kv('Risiko-Blockquote', pct(mm.blocks.risk))}${kv('Freigegeben (aktueller Scan)', pct(mm.blocks.approved))}${kv('Orders (60 min)', mm.exec.orders + (mm.exec.failed ? ` · ${mm.exec.failed} fehlgeschlagen` : ''))}${kv('Erfolgsquote Orders', pct(mm.exec.successRate))}${kv('Ø Ausführungszeit', mm.exec.avgLatencyMs == null ? '—' : mm.exec.avgLatencyMs + ' ms')}${kv('Frische Marktdaten', pct(mm.data.fresh))}${kv('Lern-KI', mm.learn.status)}${kv('Letzter Lernlauf', mm.learn.lastRunAgeMs == null ? '—' : 'vor ' + fmtAge(mm.learn.lastRunAgeMs))}${kv('Lern-Fehler (60 min)', mm.learn.errorsHour)}${kv('Drift', mm.learn.drift)}</div>
      <h3>Ausführung (ehrliche Simulation)</h3><div class="grid4">${kv('Echte Angebote (Jupiter)', mm.exec.quotes ? `${pct(mm.exec.jupiterShare)} von ${mm.exec.quotes}` : '—')}${kv('Gescheiterte Transaktionen', mm.exec.txAttempts ? `${mm.exec.txFailed} von ${mm.exec.txAttempts} (${pct(mm.exec.txFailRate)})` : '—', 'SIMULATED')}${kv('Bezahlte Gebühren gescheiterter Tx', fmtUsd(mm.exec.failedTxFeesUsd || 0, 4), 'SIMULATED')}${kv('Priority Fee', `${fmtNum(mm.exec.prioLamports)} Lamports · ${mm.exec.prioAuto ? 'aus Netzwerkgebühren' : core.S().priorityFeeMode === 'auto' ? 'Mindestwert (noch keine Netzdaten)' : 'fest'}`)}</div>
      ${Object.keys(mm.exec.failureCodes).length ? html`<p class="mut">Fehlercodes: ${Object.entries(mm.exec.failureCodes).map(([k, n]) => k + ' ' + n).join(' · ')}</p>` : ''}
      <h3>Anomalien ${anoms.length ? html`<span class="chip ${anoms.some(a => a.sev !== 'WARN') ? 'bad' : 'warn'}">${anoms.length} aktiv</span>` : html`<span class="chip ok">keine</span>`} <span class="chip ${act ? 'warn' : ''}">Modus: ${act ? 'handeln' : 'nur warnen'}</span></h3>
      ${anoms.length ? anoms.map(a => html`<div class="check"><span class="ic ${SEV_CLS[a.sev] === 'warn' ? 'warn' : 'fail'}">${a.sev}</span><div><b>${a.code}</b> – ${a.msg}<small>seit ${fmtAge(now - a.since)} · Aktion: ${ACT_DE[a.action]}${act || a.action === 'WARN' ? '' : ' (nicht ausgeführt, Modus „nur warnen“)'}</small></div></div>`) : html`<p class="mut">Keine Auffälligkeiten: Datenfrische, Hauptquelle, Orders, Transaktions-Fehlquote, echte Angebote, Slippage, Abgleich, Portfolio-Integrität, Verlusthäufung, Kapitalverlauf, Lern-KI und Speicher werden bei jedem Scan geprüft.</p>`}
      ${st.monitor.history.length ? html`<details class="an" data-k="mon-hist"><summary>Verlauf (${st.monitor.history.length})</summary><div class="tw"><table class="tbl">${st.monitor.history.slice(0, 20).map(e => html`<tr><td class="num">${fmtDateTime(e.ts)}</td><td>${e.event === 'START' ? 'Beginn' : 'Ende'}</td><td>${e.code}</td><td class="mut">${e.msg}</td></tr>`)}</table></div></details>` : ''}
      <p class="note">Reaktion einstellbar unter Einstellungen → System → „Anomalie-Monitor: Reaktion“. Standard ist „nur warnen“; mit „handeln“ werden Positionen gedrosselt, neue Auto-Käufe pausiert und bei kritischen Portfolio-Fehlern der Not-Stopp ausgelöst.</p></div>
    <div class="grid2"><div class="panel"><h3 style="margin-top:0">Bot Health</h3>${core.botHealth().map(x => html`<div class="check"><span class="ic ${x.status === 'OK' ? 'pass' : x.status === 'DEGRADED' ? 'warn' : 'fail'}">${x.status}</span><div><b>${x.name}</b><small>${x.detail}</small></div></div>`)}</div>
    <div class="panel"><h3 style="margin-top:0">System Health ${h.score}/100</h3>${Object.entries(h.parts).map(([k, v]) => html`<div class="meter"><span>${k}</span>${bar(v == null ? 0 : v, v >= 80 ? 'var(--green)' : v >= 50 ? 'var(--yellow)' : 'var(--red)')}<span class="num r">${v == null ? '—' : v}</span></div>`)}
      <p class="note">Zählt nur kritische Quellen (DexScreener Pairs, RPC, Datenfrische, Fehlerrate). Optionale Quellen (GeckoTerminal, RugCheck, Discovery) senken die Health nicht, werden unten aber als DEGRADED/OFFLINE angezeigt.</p>
      <h3>Network Health (Solana RPC)</h3><div class="grid2">${kv('Status', bestRpcStatus())}${kv('Slot', st.rpc.slot != null ? fmtNum(st.rpc.slot) : '—', st.rpc.slot ? (now - st.rpc.slotAt < 30000 ? 'LIVE' : 'STALE') : 'UNKNOWN')}${kv('Latenz', st.rpc.latency != null ? st.rpc.latency + ' ms' : '—')}${kv('Endpoint', st.rpc.endpoint || '—')}${kv('Slot-Fortschritt', st.rpc.prevSlot != null && st.rpc.slot != null ? '+' + (st.rpc.slot - st.rpc.prevSlot) : '—')}${kv('Verbindung', navigator.onLine ? 'online' : 'offline')}</div></div></div>
    <div class="panel tw"><h3 style="margin-top:0">API Health Center</h3><table class="tbl"><thead><tr><th>Quelle</th><th>Status</th><th class="r">Latenz</th><th>Letzter Erfolg</th><th>Letzter Fehler</th><th class="r">Fehlerrate</th><th class="r">Rate Limit</th><th>Backoff / Reset</th><th class="r">Datenalter</th><th>Letzte Meldung</th></tr></thead><tbody>
      ${names.map(x => html`<tr><td>${x.label}${optional.has(x.name) ? html` <span class="chip">optional</span>` : ''}</td><td class="st-${x.status}"><b>${x.status}</b></td><td class="r num">${x.latency != null ? Math.round(x.latency) + ' ms' : '—'}</td><td class="num">${x.lastSuccess ? fmtTime(x.lastSuccess) : '—'}</td><td class="num">${x.lastFailure ? fmtTime(x.lastFailure) : '—'}</td><td class="r num">${x.errorRate != null ? (x.errorRate * 100).toFixed(0) + '%' : '—'}</td><td class="r num">${x.used}/${x.limitPerMin}/min${x.rateLimited ? ' · ' + x.rateLimited + '× limitiert' : ''}</td><td class="num">${x.backoffUntil > now ? 'noch ' + fmtAge(x.backoffUntil - now) : x.resetAt ? fmtTime(x.resetAt) : '—'}</td><td class="r num">${x.dataAge != null ? fmtAge(x.dataAge) : '—'}</td><td class="mut">${x.lastError || ''}</td></tr>`)}
    </tbody></table><p class="note">SOL-Preis: ${st.sol ? fmtUsd(st.sol.usd) + ' · ' + fmtAge(now - st.sol.at) + ' alt · ' + (st.sol.derived ? 'abgeleitet aus ' + st.sol.n + ' SOL-Pools (priceUsd / priceNative)' : 'SOL/USDC-Pool') : 'unbekannt'}</p></div>
    <div class="panel tw"><h3 style="margin-top:0">Datenvalidierung (Eingangsdaten dieser Sitzung)</h3><table class="tbl"><thead><tr><th>Quelle</th><th class="r">Datensätze</th><th class="r">übernommen</th><th class="r">verworfen</th><th class="r">ungültige Felder</th><th>häufigste Felder</th><th>letzte Auffälligkeit</th></tr></thead><tbody>
      ${Object.entries(st.dataQuality).map(([k, q]) => html`<tr><td>${{ dexscreener: 'DexScreener', geckoterminal: 'GeckoTerminal', ohlcv: 'OHLCV-Kerzen' }[k] || k}</td><td class="r num">${q.records}</td><td class="r num">${q.accepted}</td><td class="r num ${q.rejected ? 'dn' : ''}">${q.rejected}</td><td class="r num ${q.invalidFields ? 'dn' : ''}">${q.invalidFields}</td><td class="mut">${Object.entries(q.byField).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, n]) => f + ' ' + n).join(', ') || '—'}</td><td class="mut">${q.lastIssue ? q.lastIssue + (q.lastIssueAt ? ' · ' + fmtTime(q.lastIssueAt) : '') : '—'}</td></tr>`)}
    </tbody></table><p class="note">Ungültige Werte (NaN, Infinity, negativ, Preis 0, unplausibel groß) werden verworfen und als unbekannt behandelt – nie als 0. Ohne gültigen Preis, frische Daten und Security gibt es keinen Kauf.</p></div>
    <div class="grid2"><div class="panel"><h3 style="margin-top:0">API-Latenz (ms)</h3><div class="chartbox small"><canvas data-chart="apiLat"></canvas></div><h3>API-Fehlerrate (%)</h3><div class="chartbox small"><canvas data-chart="apiFail"></canvas></div></div>
    <div class="panel"><h3 style="margin-top:0">Scanner-Graph (Ø je Scan / Minute)</h3><div class="chartbox small"><canvas data-chart="scanner"></canvas></div>
      <h3>Metriken</h3><div class="grid3">${kv('Scans/s', (st.scanner.scansWindow.length / 10).toFixed(2))}${kv('Scans gesamt', c.scans)}${kv('Tokens gescannt', st.markets.size)}${kv('Kandidaten', (st.metrics.scanStats || {}).fastPass || 0)}${kv('Buy-Signale', c.buySignals)}${kv('Abgelehnt (Pre-Trade)', c.rejected)}${kv('Ausgeführt', c.executed)}${kv('Win Rate', wr != null ? (wr * 100).toFixed(0) + '%' : '—')}${kv('PnL realisiert', fmtSigned(st.portfolio.realized), 'SIMULATED')}${kv('Drawdown max', (st.portfolio.maxDD || 0).toFixed(2) + '%')}${kv('Offene Positionen', st.positions.length)}${kv('API-Fehler', c.apiErrors)}${kv('Verspätete Antworten verworfen', st.scanner.lateIgnored)}${kv('Übersprungene Scans', st.scanner.skipped)}${kv('Security-Queue', st.secQueue.length)}</div>
      <h3>Performance</h3><div class="grid3">${kv('Scan', perf.scan != null ? perf.scan + ' ms' : '—')}${kv('Analyse', perf.analysis != null ? perf.analysis + ' ms' : '—')}${kv('Decision/Exec', perf.exec != null ? perf.exec + ' ms' : '—')}${kv('Render', perf.render != null ? perf.render + ' ms' : '—')}${kv('API Ø', names.length ? Math.round(avg(names.map(x => x.latency).filter(isNum)) || 0) + ' ms' : '—')}${kv('Requests aktiv', core.http.inflightCount())}</div></div></div>
    <div class="panel"><h3 style="margin-top:0">Selbsttest & Chaos-Tests</h3><p class="note">Laufen gegen isolierte Instanzen mit Mock-Netzwerk (Testdaten werden nie im Scanner angezeigt): normaler Scan, kein Kandidat, niedriger Score, kein Konsens, harter Block, API-/RPC-Ausfall, Stale Data, Duplicate Scan/Order, 2-Buy-Limit, Cooldown, Verlustserie, Emergency Stop, Reload-Recovery, Abgleich, Simulation und Live-Gating.</p>
      <button class="btn pri" data-act="runTests" ${UI.testsRunning ? raw('disabled') : ''}>${UI.testsRunning ? '⏳ läuft …' : '▶ Selbsttest starten'}</button>
      ${UI.tests ? html`<p><b class="${UI.tests.every(x => x.ok) ? 'ok' : 'bad'}">${UI.tests.filter(x => x.ok).length}/${UI.tests.length} bestanden</b></p>${UI.tests.map(x => html`<div class="check"><span class="ic ${x.ok ? 'pass' : 'fail'}">${x.ok ? 'PASS' : 'FAIL'}</span><div><b>[${x.group}] ${x.name}</b><small>${x.detail} · ${x.ms} ms</small></div></div>`)}` : ''}</div>
    ${core.S().debugMode ? html`<div class="panel"><h3 style="margin-top:0">Debug: Decision Trace ${selT ? '· ' + selT.symbol : ''}</h3>${selT && selT.D ? html`<pre class="raw">${JSON.stringify({ decision: selT.D.decision, blockers: selT.D.blockers, trace: selT.D.trace, components: selT.A.components, risk: selT.A.risk, confidence: selT.A.confidence }, null, 2)}</pre>` : html`<p class="mut">Token auswählen.</p>`}
      <h3>Rohdaten (letzte API-Antworten)</h3>${core.S().rawApiLog ? names.filter(x => x.lastRaw).map(x => html`<details><summary>${x.label} · ${fmtTime(x.lastRaw.ts)}</summary><pre class="raw">${x.lastRaw.sample}</pre></details>`) : html`<p class="mut">„Rohdaten speichern“ in den Einstellungen aktivieren.</p>`}</div>` : ''}`);
  drawCharts(sec);
}

/* ---------- Logs ---------- */
const LOG_CATS = [['ALL', 'Alle'], ['API', 'API'], ['SCANNER', 'Scanner'], ['TRADE', 'Trade'], ['RISK', 'Risk'], ['SECURITY', 'Security'], ['LEARNING', 'Learning'], ['RESEARCH', 'Research'], ['EXPERIMENT', 'Experimente'], ['MODEL', 'Modell'], ['DRIFT', 'Drift'], ['ERROR', 'Fehler'], ['DEBUG', 'Debug'], ['SYSTEM', 'System']];
function renderLogs() {
  patch($('logCats'), html`${LOG_CATS.map(([k, n]) => html`<button data-act="logCat" data-k="${k}" class="${UI.logCat === k ? 'on' : ''}">${n}</button>`)}`);
  setText($('btnLogPause'), UI.logPaused ? '▶ Fortsetzen' : '⏸ Anhalten');
  if (UI.logPaused) return;
  const q = UI.logQ.trim().toLowerCase();
  const list = core.log.entries.filter(e => {
    if (UI.logCat === 'ERROR' && !['ERROR', 'CRITICAL'].includes(e.level)) return false;
    if (UI.logCat === 'DEBUG' && e.level !== 'DEBUG') return false;
    if (!['ALL', 'ERROR', 'DEBUG'].includes(UI.logCat) && e.category !== UI.logCat && e.level !== UI.logCat) return false;
    return !q || (e.message + ' ' + e.category).toLowerCase().includes(q);
  }).slice(-300).reverse();
  patch($('logList'), list.length ? html`${list.map(e => html`<div class="logrow"><span class="dim">${fmtTime(e.ts)}${e.restored ? '*' : ''}</span><span class="lv-${e.level}">${e.level}</span><span class="cat mut">${e.category}</span><span class="m">${e.message}${e.meta ? html` <span class="dim">${JSON.stringify(e.meta).slice(0, 200)}</span>` : ''}</span></div>`)}` : html`<div class="empty">Keine Logs für diesen Filter.</div>`);
}

/* ---------- Einstellungen ---------- */
function settingField(d, S) {
  const v = S[d.k];
  if (d.t === 'bool') return html`<label class="fld inl">${d.l}<input type="checkbox" data-set="${d.k}" ${v ? raw('checked') : ''}></label>`;
  if (d.t === 'select') return html`<label class="fld">${d.l}<select data-set="${d.k}">${d.opts.map(o => html`<option value="${o[0]}" ${o[0] === v ? raw('selected') : ''}>${o[1]}</option>`)}</select></label>`;
  if (d.t === 'text') return html`<label class="fld" style="grid-column:1/-1">${d.l}<input data-set="${d.k}" value="${v}"${d.secret ? raw(' type="password"') : ''} autocomplete="off" spellcheck="false"><small class="dim">Keine API-Keys in öffentliche Geräte eingeben; Keys werden nur lokal gespeichert und in Logs maskiert.</small></label>`;
  return html`<label class="fld">${d.l}${d.u ? ' (' + d.u + ')' : ''}<input type="number" data-set="${d.k}" value="${v}" min="${d.min}" max="${d.max}" step="${d.step || (d.t === 'int' ? 1 : 'any')}"></label>`;
}
function renderSettings(sec) {
  const S = core.S(), st = core.state;
  const sections = [...new Set(SETTINGS_SCHEMA.map(d => d.s))];
  setHTML(sec, html`<h2>⚙ Einstellungen</h2>
    <div class="panel"><h3 style="margin-top:0">Ansicht</h3><div class="row">${proToggle()}</div>
      <p class="note">AUS (Standard): nur die für dich relevanten Werte. AN: zusätzlich alle Analysedaten, mit denen der Bot seine Kauf-/Verkaufsentscheidungen trifft (Scores, Risikofaktoren, Confidence, Strategie-Stimmen, Blocker, Entscheidungsketten, Indikatoren). Der Bot rechnet immer mit allen Daten.</p></div>
    <p class="note">Alle Werte werden validiert (endliche Zahlen, Min/Max, Prozente, keine negativen Kapitalwerte). Sichere Defaults: SIMULATION, Auto-Trading AUS. Änderungen werden versioniert protokolliert.</p>
    <div class="row" style="margin-bottom:10px"><b class="mut">Profil:</b>${Object.keys(PROFILES).map(p => html`<button class="btn sm" data-act="profile" data-p="${p}">${p}</button>`)}</div>
    ${sections.map(s => html`<details class="panel" ${s === 'Filter' || s === 'Risiko' ? raw('open') : ''}><summary><b>${s}</b></summary><div class="form" style="margin-top:10px">${SETTINGS_SCHEMA.filter(d => d.s === s).map(d => settingField(d, S))}</div></details>`)}
    <details class="panel" open><summary><b>Strategien</b></summary><div class="tw" style="margin-top:10px"><table class="tbl"><thead><tr><th>Strategie</th><th>Aktiv</th><th>Gewicht</th><th>Min Score</th><th>Risk Limit</th><th>Min Liq $</th><th>Min Conf</th><th>Cooldown min</th><th>Größe %</th></tr></thead><tbody>
      ${STRATEGY_DEFS.map(def => { const c = st.strategies[def.id]; return html`<tr><td><b>${def.name}</b><br><small class="mut">${def.desc}</small></td><td><input type="checkbox" data-strat="${def.id}" data-f="enabled" ${c.enabled ? raw('checked') : ''} aria-label="${def.name} aktiv"></td>${Object.keys(STRATEGY_FIELDS).map(f => html`<td><input type="number" step="any" style="width:84px" data-strat="${def.id}" data-f="${f}" value="${c[f]}" aria-label="${def.name} ${f}"></td>`)}</tr>`; })}
    </tbody></table></div><p class="note">Mehrere Strategien stimmen ab (Konsens ≥ ${S.consensusMinWeight}). Die Risk Engine hat immer Vorrang: mehrere BUY-Signale + Risk-Block ⇒ NO BUY. Deaktivierte Strategien laufen im Shadow Mode mit (keine Orders).</p></details>
    <details class="panel"><summary><b>Export / Import / Reset</b></summary><div class="row" style="margin-top:10px">
      <button class="btn sm" data-act="export" data-kind="settings-json">⬇ Settings JSON</button><button class="btn sm" data-act="export" data-kind="journal-json">⬇ Journal JSON</button><button class="btn sm" data-act="export" data-kind="journal-csv">⬇ Journal CSV</button><button class="btn sm" data-act="export" data-kind="analytics-json">⬇ Analytics JSON</button><button class="btn sm" data-act="export" data-kind="logs-json">⬇ Logs JSON</button>
      <button class="btn sm" data-act="importSettings">⬆ Settings/Watchlist importieren</button></div>
      <div class="row" style="margin-top:10px"><button class="btn sm" data-act="export" data-kind="backup-json">⬇ Voll-Backup (alle Daten)</button><button class="btn sm" data-act="restoreBackup">⬆ Backup wiederherstellen</button></div>
      <p class="note">Das Voll-Backup enthält Einstellungen, Positionen, Journal, Logs, Statistiken und Lerndaten – damit lässt sich der Stand auch auf ein anderes Gerät übertragen. Keine Passwörter oder Keys; selbst eingetragene RPC-URLs sind enthalten, die Datei daher vertraulich behandeln. Vor dem Wiederherstellen wird die Datei vollständig geprüft und der aktuelle Stand automatisch als Backup heruntergeladen.</p>
      <div class="row" style="margin-top:10px"><button class="btn sm warn" data-act="freshStart">↺ Frischer Start (Startkapital, Positionen leeren, Analysedaten behalten)</button><button class="btn sm warn" data-act="resetSettings">Einstellungen zurücksetzen</button><button class="btn sm warn an" data-act="resetPortfolio">Sim-Portfolio zurücksetzen</button><button class="btn sm bad" data-act="factoryReset">Factory Reset</button></div></details>
    <details class="panel"><summary><b>Config Change Log & Audit Trail</b></summary>
      <h3>Konfigurationsänderungen</h3>${st.configLog.length ? html`<div class="tw"><table class="tbl">${st.configLog.slice(0, 40).map(c => html`<tr><td class="num">${fmtDateTime(c.ts)}</td><td>${c.who}</td><td>${c.kind}</td><td class="mut">${c.changes.map(x => x.key + ': ' + x.from + ' → ' + x.to).join(' · ')}</td></tr>`)}</table></div>` : html`<p class="mut">Keine Änderungen.</p>`}
      <h3>Audit Trail (wer/was/wann/warum)</h3>${st.auditLog.length ? html`<div class="tw"><table class="tbl">${st.auditLog.slice(0, 60).map(a => html`<tr><td class="num">${fmtDateTime(a.ts)}</td><td>${a.who}</td><td>${a.what}</td><td class="mut">${a.detail}${a.why ? ' · ' + a.why : ''}</td></tr>`)}</table></div>` : html`<p class="mut">Noch keine Einträge.</p>`}</details>
    <div class="panel"><h3 style="margin-top:0">Über</h3><p class="mut">Smart Lab v${APP_VERSION} · Strategy Engine ${STRATEGY_VERSION} · Data Engine ${DATA_ENGINE_VERSION} · Storage v${STORAGE_VERSION} · Parameter v${st.activeParam}. Datenquellen: DexScreener, GeckoTerminal, RugCheck, Solana JSON-RPC. LIVE-Trading ist nicht verfügbar (REQUIRES EXTERNAL PROVIDER) – es werden keine Private Keys verarbeitet.</p></div>`);
}

/* ---------- Wissensbasis (lokal) ---------- */
const KB = [
  ['Trading', 'NO TRADE ist eine valide Entscheidung', 'Ein entdeckter Token ist kein Kaufgrund. Der Bot handelt nur, wenn Datenqualität, Sicherheit, Risiko, Portfolio-Limits, Cooldowns und Strategie-Konsens gleichzeitig passen.'],
  ['Risk Management', 'Positionsgröße', 'Größe = Kapital × Strategie-% × Risiko-, Confidence- und Volatilitätsfaktor, begrenzt durch Liquidität (Impact ≤ halbe max. Slippage), freie Exposure, max. Positionsgröße und Cash. Bei zu geringer Datenqualität ist die Größe 0.'],
  ['Risk Management', 'Stops & Take Profits', 'Prozent-Stop, optional ATR-Stop (aus 1m-OHLCV), Trailing ab definiertem Gewinn, Break-even nach TP1, TP1–TP3 als Teilverkäufe, Time Exit, Liquiditätsabfluss- und Risiko-Exit.'],
  ['Risk Management', 'Buy-Limit & Cooldowns', 'Alle Limits sind Einstellungen (Einstellungen → Risiko) und lassen sich bis 0 = aus stellen. Standard: max. 2 Käufe pro Coin, Nachkauf nur im Gewinn (≥ +10 %), 15 min Coin-Cooldown nach Verkauf, Loss-Cooldown und globale Pause 0 min. Das Profil „Lernmodus (ohne Limits)“ schaltet alle Pausen und Limits auf einmal ab.'],
  ['Market Structure', 'Käufer/Verkäufer-Verhältnis', 'DexScreener liefert Transaktionszahlen (nicht Buy-/Sell-Volumen). Das Verhältnis zeigt Druck, sagt aber nichts über Trade-Größen – deshalb wird zusätzlich die Ø-Trade-Größe relativ zur Liquidität betrachtet.'],
  ['Market Structure', 'Pump- & Manipulationsmuster', 'Vertikaler Anstieg, extreme Kaufquote, Volumen- oder Liquiditäts-Spikes und Whale-dominierte Bewegungen erhöhen das Risiko. Ein Pump wird nie automatisch als Kaufsignal gewertet.'],
  ['Solana', 'Mint Authority', 'Ist die Mint Authority aktiv, kann jederzeit neue Supply erzeugt werden. Der Bot prüft das per Solana RPC (getAccountInfo, jsonParsed) und blockiert aktive Mint Authorities.'],
  ['Solana', 'Freeze Authority', 'Eine aktive Freeze Authority kann Token-Konten einfrieren – Verkauf wäre dann unmöglich. Status CRITICAL, Käufe blockiert.'],
  ['Solana', 'Token-2022-Extensions', 'Permanent Delegate, Transfer Hook, Transfer Fee oder Non-Transferable können Verkäufe verhindern oder verteuern. Sie werden aus den Mint-Daten erkannt und als Risiko markiert.'],
  ['Solana', 'Lamports & Gebühren', '1 SOL = 1.000.000.000 Lamports. Gebühren = Basisgebühr (5000 Lamports) + Priority Fee + DEX-Gebühr. Umrechnung erfolgt exakt über BigInt; ohne aktuellen SOL-Preis wird nicht gehandelt.'],
  ['Liquidity', 'Liquidität / MC (Market Cap)', 'Ein niedriges Verhältnis (< 3 %) bedeutet dünne Exit-Liquidität: Schon kleine Verkäufe bewegen den Preis stark.'],
  ['Slippage', 'Price Impact (AMM)', 'Geschätzt über die Konstantprodukt-Formel: Impact ≈ Größe / (Liquidität/2 + Größe). Das ist eine Schätzung (ESTIMATED); echte Pools, Gebührenstufen und MEV können abweichen.'],
  ['Memecoin Risks', 'Rug Pull & Holder-Konzentration', 'Hohe Konzentration bei wenigen Wallets, ungesperrte LP und aktive Authorities sind typische Rug-Risiken. Holder-Daten via RPC enthalten Pool-/LP-Konten und sind daher Beobachtungen mit begrenzter Confidence – keine Insider-Behauptungen.'],
  ['Memecoin Risks', 'Boosts sind Werbung', 'DexScreener-Boosts sind bezahlte Promotion. Sie werden als Flag angezeigt, erhöhen aber nicht den Score.'],
  ['Technical Indicators', 'EMA, RSI, ATR, VWAP', 'EMA glättet den Preis (Trend), RSI misst Überkauft/Überverkauft, ATR die typische Schwankung (für Stops), VWAP den volumengewichteten Durchschnittspreis. Indikatoren unterstützen Entscheidungen, ersetzen aber keine Risikoanalyse.'],
  ['Strategy Logic', 'Strategie-Konsens', 'Mehrere Strategien stimmen gewichtet ab. Nur wenn die Summe der Gewichte der BUY-Stimmen die Schwelle erreicht und die Risk Engine nicht blockiert, entsteht ein Kandidat.'],
  ['Strategy Logic', 'Backtest ohne Look-Ahead', 'Signale werden auf geschlossenen Kerzen berechnet, der Einstieg erfolgt zum Open der nächsten Kerze. Walk-Forward trennt Training, Validierung und Test. Vergangene Ergebnisse sind keine Garantie.'],
  ['Diagnostics', 'Datenlabels', 'LIVE = frisch von der API, CACHED = aus kurzem Request-Cache, STALE = zu alt (blockiert Käufe), FALLBACK = nur Zweitquelle, ESTIMATED = berechnete Schätzung, SIMULATED = virtuell, UNKNOWN = keine Daten.'],
  ['Diagnostics', 'Data Confidence', 'Gesamtwert aus Preis-, Liquiditäts-, Volumen-, Security-, Marktstruktur- und On-Chain-Confidence. Cross-Checks mit GeckoTerminal erhöhen, Konflikte senken den Wert. Unter der Mindest-Confidence gibt es keine Käufe.'],
  ['Diagnostics', 'System Health', 'Kombiniert Status der APIs und RPCs, Datenfrische und Fehlerraten. Liegt der Wert unter der Mindestschwelle, wird Trading eingeschränkt; nach Ausfällen geht der Bot in RECOVERING, bis die Datenqualität reicht.'],
  ['Lern-KI', 'Wie lernt der Bot aus Verlusten?', 'Jeder abgeschlossene Trade wird als Learning Record eingefroren: Merkmale zum Einstiegszeitpunkt (kein Look-Ahead), Preisverlauf (MAE/MFE nach 1/2/5/15 min), Exit und 15 min Nachlauf. Verluste bekommen eine Ursachenfamilie mit Evidenz (z. B. Fehlsignal, Momentum erschöpft, Liquiditätsproblem, Exit zu spät) – ohne ausreichende Daten UNKNOWN statt Vermutung.'],
  ['Lern-KI', 'Wann ändert die KI etwas?', 'Nur wenn ein Muster als Hypothese in einem zeitlich getrennten Experiment (Train/Validation/Test + Walk-Forward, Sensitivität, Bootstrap, Leakage-Test) besteht, danach als Challenger im Shadow-Modus besser abschneidet und der Modus SIMULATION ist. Änderungen verschärfen nur Einstiegsfilter bzw. passen Exits in festen Grenzen an; nach der Übernahme wird überwacht und bei schlechterer Live-Evidenz automatisch zurückgerollt.'],
  ['Lern-KI', 'Was die KI nie verändert', 'Risiko-Limits (Buy-Limit, Cooldowns, Pausen, Exposure – die stellst nur du ein), Security-Blocker, Emergency Stop, LIVE-Gating und manuelle Trades. Es wird kein Code zur Laufzeit erzeugt oder ausgeführt, und es gibt keine Gewinn-Garantie.'],
  ['Diagnostics', 'Warum ist LIVE nicht verfügbar?', 'Echte Orders erfordern einen verifizierten Wallet-Adapter mit Signatur-Freigabe, einen Swap-/Routing-Provider sowie echte Bestätigungen und Reconciliation. Das ist in dieser Datei nicht sicher umsetzbar – daher REQUIRES EXTERNAL PROVIDER statt vorgetäuschter Funktion.']
];
function renderKnowledge(sec) {
  const q = UI.kbQ.trim().toLowerCase();
  const list = KB.filter(k => !q || k.join(' ').toLowerCase().includes(q));
  const topics = [...new Set(list.map(k => k[0]))];
  const body = html`${topics.map(tp => html`<h3>${tp}</h3>${list.filter(k => k[0] === tp).map(k => html`<div class="kb"><b>${k[1]}</b><p>${k[2]}</p></div>`)}`)}${list.length ? '' : html`<div class="empty">Kein Eintrag gefunden.</div>`}`;
  if (!document.getElementById('kbq')) setHTML(sec, html`<h2>📚 Wissensbasis</h2><div class="toolbar"><input type="search" id="kbq" placeholder="Wissensbasis durchsuchen" aria-label="Wissensbasis durchsuchen"></div><div class="panel" id="kbList"></div>`);
  patch(document.getElementById('kbList'), body);
}

/* ---------- Token-Detail (Right Panel) ---------- */
const DETAIL_TABS = [['overview', 'Übersicht'], ['chart', 'Chart'], ['risk', 'Risiko & Security'], ['plan', 'Trade Plan'], ['why', 'Warum?']];
function detailHead(t) {
  const A = t.A, D = t.D, w = !!core.state.watchlist[t.id];
  if (!A) return html`<div class="dhead"><h2>${t.symbol}</h2><button class="dclose" data-act="closeDetail" aria-label="Details schließen">✕</button></div><p class="mut">Warte auf Marktdaten … (keine Platzhalterwerte)</p>`;
  const c = A.price.chg;
  return html`<div class="dhead"><div style="min-width:0"><h2>${t.symbol} <small class="mut">${t.name}</small></h2>
    <div class="row" style="margin-top:4px">${decChip(D.decision)}${scoreChip(A.finalScore)}${lvlChip(A.risk.level, A.risk.total)}<span class="chip info an" title="Data Confidence">Conf ${A.confidence.total}%</span><span class="chip">${A.ageClass}</span>${lbl(A.label)}</div></div>
    <button class="dclose" data-act="closeDetail" aria-label="Details schließen">✕</button></div>
    <div class="row" style="margin-top:8px"><span><small class="mut">Coin-Preis </small><b class="num" style="font-size:21px" title="${A.core.priceRaw || ''}">${fmtPrice(A.core.price)}</b></span><b class="num mcv" style="font-size:17px">${fmtMc(A.core.mc)}</b></div>
    <div class="row" style="margin-top:4px"><span class="num ${cls(c.m5)}">5m ${fmtPct(c.m5)}</span><span class="num ${cls(c.h1)}">1h ${fmtPct(c.h1)}</span><span class="num ${cls(c.h24)}">24h ${fmtPct(c.h24)}</span><span class="mut an">· ${A.dataAge != null ? fmtAge(A.dataAge) + ' alt' : ''} · ${A.core.source || '—'}</span></div>
    <button class="ca" data-act="copy" data-v="${t.mint}" data-l="Mint"><code>${t.mint}</code><span>⧉ Mint</span></button>
    <div class="row" style="margin-top:8px"><button class="btn sm ${w ? 'on' : ''}" data-act="star" data-id="${t.id}">${w ? '★ Watchlist' : '☆ Watchlist'}</button><button class="btn sm pri" data-act="buy" data-id="${t.id}">💱 Simulate Buy</button><button class="btn sm" data-act="analyze" data-id="${t.id}">🔍 Neu analysieren</button><button class="btn sm" data-act="ctx" data-id="${t.id}" aria-label="Weitere Aktionen">⋯</button></div>`;
}
function meterRow(name, v, color, label) { return html`<div class="meter"><span>${name}</span>${bar(v, color)}<span class="num r">${v == null ? '—' : v}${label ? '' : ''}</span></div>`; }
/* Scanner-Stufen & Security-Prüfbericht (Anzeige) */
const RES_CHIP = { PASS: ['ok', 'OK'], WARN: ['warn', 'HINWEIS'], FAIL: ['bad', 'FEHLER'], NO_DATA: ['vio', 'KEINE DATEN'] };
const resChip = r => { const [c, t] = RES_CHIP[r] || ['', r]; return html`<span class="chip ${c}">${t}</span>`; };
const ACT_CHIP = { BLOCK: 'bad', RISIKO: 'warn', HINWEIS: 'info', OFFEN: 'vio', KEINE: '' };
const okMark = ok => html`<span class="${ok === true ? 'ok' : ok === false ? 'bad' : 'mut'}">${ok === true ? '✓' : ok === false ? '✗' : '?'}</span>`;
function secReportHtml(t) {
  const rep = securityReport(t, t.A, t.D, core.S()); if (!rep) return '';
  return html`<h3 style="margin-top:0">Security-Prüfbericht <span class="chip ${rep.gate === 'PASSED' ? 'ok' : rep.gate === 'CAUTION' ? 'warn' : 'bad'}">${SEC_GATE_DE[rep.gate]}</span></h3>
    <div class="tw"><table class="tbl"><thead><tr><th>Prüfung</th><th>Ergebnis</th><th>Aktion</th><th class="an">Schwere</th><th class="an">Quelle</th><th class="an">Stand</th></tr></thead><tbody>
    ${rep.checks.map(c => html`<tr><td><b>${c.check}</b><br><small class="mut">${c.detail}</small></td><td>${resChip(c.result)}</td><td><span class="chip ${ACT_CHIP[c.action]}">${c.action}</span></td><td class="an">${c.severity}</td><td class="an mut">${c.source}</td><td class="an num">${c.ts ? fmtTime(c.ts) : '—'}</td></tr>`)}
    </tbody></table></div>
    <p class="note">KEINE DATEN heißt nicht „kein Risiko“ – fehlende Security-Daten blockieren Käufe. BLOCK = diese Prüfung verhindert gerade einen Kauf; kein Score, Signal oder gelernte Regel kann das ausgleichen.</p>`;
}
function stagesHtml(t) {
  const st = stageScores(t, t.A, t.D, core.S()); if (!st) return '';
  return html`<h3>Stufen-Bewertung (Scanner)</h3>${STAGE_ORDER.map(k => { const x = st[k]; return html`<div class="stg"><div class="meter"><span>${STAGE_NAMES[k]}</span>${bar(x.score == null ? 0 : x.score, x.status === 'PASS' ? 'var(--green)' : x.status === 'WARN' ? 'var(--yellow)' : x.status === 'FAIL' ? 'var(--red)' : 'var(--dim)')}<span class="num r">${x.score == null ? '—' : x.score}</span></div><small>${resChip(x.status)} ${x.reasons.map((r, i) => html`${i ? ' · ' : ''}${okMark(r.ok)} ${r.text}`)}</small></div>`; })}
    <p class="note">Jede Stufe mit Teilbegründungen (✓ erfüllt · ✗ nicht erfüllt · ? keine Daten). „—“ = keine Daten, nicht 0 und nicht „kein Risiko“.</p>`;
}
function tabOverview(t) {
  const A = t.A; if (!A) return '';
  const tx = A.tx, v = A.vol;
  const seen = core.state.seen[t.id];
  return html`${t.D ? whyShortHtml(t) : ''}<div class="grid3">${kv('Coin-Preis', fmtPrice(A.core.price), A.labels.price)}${kv('MC', html`<span class="mcv">${fmtMc(A.core.mc)}</span>`, A.labels.price)}${kvA('FDV', fmtMc(A.core.fdv).replace(' MC', ' FDV'))}${kv('Liquidität', fmtUsd(A.liq.usd), A.labels.liquidity)}
    ${kvA('Liq/MC', A.liq.ratioMc != null ? (A.liq.ratioMc * 100).toFixed(1) + '%' : '—')}${kvA('Vol 5m', fmtUsd(v.m5))}${kv('Vol 1h', fmtUsd(v.h1), A.labels.volume)}
    ${kv('Vol 24h', fmtUsd(v.h24))}${kvA('Txns 5m K/V', (tx.b5 != null ? tx.b5 : '—') + '/' + (tx.s5 != null ? tx.s5 : '—'))}${kvA('Txns 1h K/V', (tx.b1 != null ? tx.b1 : '—') + '/' + (tx.s1 != null ? tx.s1 : '—'))}
    ${kvA('Käufer 5m', tx.ratio5 != null ? (tx.ratio5 * 100).toFixed(0) + '%' : '—')}${kvA('Käufer 1h', tx.ratio1 != null ? (tx.ratio1 * 100).toFixed(0) + '%' : '—')}${kvA('Ø Trade 5m', fmtUsd(tx.avgTrade5))}
    ${kvA('Run-Rate 5m', v.runRate5 != null ? v.runRate5.toFixed(2) + '×' : '—')}${kvA('Volatilität/min', A.price.volPct != null ? A.price.volPct.toFixed(2) + '%' : '—', A.price.volLabel)}${kvA('Drawdown 30m', fmtPct(A.price.drawdown))}
    ${kv('Pair-Alter', fmtAge(A.core.pairAge))}${kv('DEX', A.core.dexId || '—')}${kvA('Top-10 Holder', A.sec.top10Pct != null ? A.sec.top10Pct.toFixed(1) + '%' : '—', A.labels.holders)}</div>
    <div class="an">${stagesHtml(t)}<h3>Opportunity vs. Risk vs. Confidence</h3>
    ${meterRow('Opportunity', A.opportunity, 'var(--green)')}${meterRow('Risk', A.risk.total, riskColor(A.risk.total))}${meterRow('Confidence', A.confidence.total, 'var(--cyan)')}${meterRow('Execution', A.executionScore, 'var(--violet)')}
    <h3>Technische Analyse ${A.ta ? lbl(A.ta.label) : ''}</h3>${A.ta ? html`<div class="grid3">${kv('EMA 9 (Preis)', fmtPrice(A.ta.ema9))}${kv('EMA 21 (Preis)', fmtPrice(A.ta.ema21))}${kv('SMA 20 (Preis)', fmtPrice(A.ta.sma20))}${kv('RSI 14', A.ta.rsi != null ? A.ta.rsi.toFixed(0) : '—')}${kv('ATR %', A.ta.atrPct != null ? A.ta.atrPct.toFixed(2) + '%' : '—')}${kv('ROC 10', fmtPct(A.ta.roc))}${kv('VWAP (Preis)', fmtPrice(A.ta.vwap))}${kv('Momentum', A.price.momentum)}${kv('Trend', A.price.trend)}</div><p class="note">Quelle: ${A.ta.source}. Indikatoren unterstützen Entscheidungen, ersetzen aber keine Risikoanalyse.</p>` : html`<p class="mut">Nicht genug Datenpunkte (mind. 15 Live-Samples oder frische 1m-OHLCV via Chart-Tab).</p>`}
    <h3>Signale</h3>${A.signals.length ? A.signals.map(s => html`<div class="check"><span class="ic ${CONTEXT_SIGNALS.has(s.type) ? 'na' : 'pass'}">${s.strength}</span><div><b>${SIGNAL_NAMES[s.type]}</b><small>${s.reason} · Confidence ${s.confidence}</small></div></div>`) : html`<p class="mut">Keine Signale aktiv.</p>`}
    ${A.flags.length ? html`<h3>Flags</h3><div class="row">${A.flags.map(f => html`<span class="f ${f === 'BOOST' ? 'B' : f === 'PUMP' || f === 'DUMP' ? 'X' : ''}">${f}</span>`)}</div>` : ''}</div>
    <h3>Links</h3><div class="lk">${linkHtml(tokenLinks(t))}</div>
    <p class="note">Entdeckt ${fmtAge(Date.now() - t.meta.discoveredAt)} her<span class="an"> via ${t.meta.via.join(', ')}</span>${seen ? ` · MC beim Fund ${fmtMc(seen.mc)} → jetzt ${fmtMc(A.core.mc)} (${fmtPct((A.core.mc / seen.mc - 1) * 100)})` : ''}</p>`;
}
function tabRisk(t) {
  const A = t.A; if (!A) return '';
  const sec = t.sec, now = Date.now();
  const q = [['Coin-Preis', A.labels.price, A.dataAge, A.core.source], ['Liquidität', A.labels.liquidity, A.dataAge, A.core.source], ['Volumen', A.labels.volume, A.dataAge, A.core.source], ['Security', A.labels.security, sec ? now - sec.checkedAt : null, sec ? Object.entries(sec.sources).filter(x => x[1]).map(x => x[0]).join('+') || 'keine' : '—'], ['Holders', A.labels.holders, sec ? now - sec.checkedAt : null, sec ? sec.holderSrc || '—' : '—'], ['Social', 'UNKNOWN', null, 'keine Datenquelle']];
  return html`<div class="kv" style="margin-bottom:8px"><small>Risiko gesamt</small><b>${lvlChip(A.risk.level, A.risk.total)}</b></div>
    ${secReportHtml(t)}
    <div class="an"><h3 style="margin-top:0">Scorecard</h3>${Object.entries(A.components).map(([k, v]) => meterRow(COMP_NAMES[k], v, v >= 65 ? 'var(--green)' : v >= 40 ? 'var(--yellow)' : 'var(--red)'))}${meterRow('RISK (gesamt)', A.risk.total, riskColor(A.risk.total))}
    <h3>Risk Factors</h3>${Object.entries(A.risk.factors).map(([k, v]) => html`<div class="meter"><span>${RISK_NAMES[k].replace(' Risk', '')}</span>${bar(v, riskColor(v || 0))}<span class="num r">${v == null ? '?' : v}</span></div>`)}
    <p class="note">Gesamt ${A.risk.total} → ${A.risk.level}. „?“ = keine Daten (fließt neutral ein, keine Annahme).</p></div>
    <h3>Token Security ${sec ? html`<span class="lvl lvl-${sec.status === 'VERIFIED' ? 'LOW' : sec.status === 'PARTIAL' ? 'MODERATE' : sec.status === 'CRITICAL' ? 'CRITICAL' : 'UNKNOWN'}">${sec.status}</span>` : html`<span class="lvl lvl-UNKNOWN">${t.secPending ? 'PRÜFUNG LÄUFT' : 'UNKNOWN'}</span>`}</h3>
    ${sec ? html`<div class="grid2">${kv('Mint Authority', sec.mintAuthority)}${kv('Freeze Authority', sec.freezeAuthority)}${kvA('Programm', sec.program || '—')}${kvA('Decimals', sec.decimals != null ? sec.decimals : '—')}${kvA('Top-10', sec.top10Pct != null ? sec.top10Pct.toFixed(1) + '%' : '—')}${kvA('RugCheck (norm.)', sec.rugScoreNorm != null ? sec.rugScoreNorm : '—')}${kv('LP gesperrt', sec.lpLockedPct != null ? sec.lpLockedPct.toFixed(0) + '%' : '—')}${kv('Geprüft', fmtAge(now - sec.checkedAt) + ' her')}</div>
      ${sec.flags.length ? sec.flags.map(f => html`<div class="check"><span class="ic ${f.level === 'CRITICAL' ? 'fail' : 'warn'}">${f.level}</span><div><b>${f.code}</b><small>${f.msg}</small></div></div>`) : html`<p class="ok">Keine Risk Flags gefunden.</p>`}` : html`<p class="mut">Noch nicht geprüft. Käufe bleiben blockiert (Security Unknown = No Buy).</p>`}
    <p class="note">Beobachtungen, keine Sicherheitsgarantie. Holder-Daten via RPC enthalten Pool-Konten.</p><button class="btn sm" data-act="secRecheck" data-id="${t.id}">🛡 Security neu prüfen</button>
    <div class="an">${A.pump.flags.length ? html`<h3>Pump / Manipulation</h3>${A.pump.flags.map(f => html`<div class="check"><span class="ic warn">!</span><div>${f}</div></div>`)}` : ''}
    ${A.vol.anomalies.length ? html`<h3>Volumen-Anomalien</h3>${A.vol.anomalies.map(f => html`<div class="check"><span class="ic warn">!</span><div>${f}</div></div>`)}` : ''}
    <h3>Datenkonflikte</h3>${A.conflicts.length ? A.conflicts.map(c => html`<div class="check"><span class="ic fail">KONFLIKT</span><div><b>${c.field}</b><small>DexScreener ${c.field === 'Preis' ? fmtPrice(c.a) : fmtUsd(c.a)} vs. GeckoTerminal ${c.field === 'Preis' ? fmtPrice(c.b) : fmtUsd(c.b)} (${c.diffPct.toFixed(1)} %)</small></div></div>`) : html`<p class="mut">${A.crossChecked ? 'Cross-Check mit GeckoTerminal: keine Konflikte' + (A.crossPriceDiff != null ? ` (Δ Preis ${A.crossPriceDiff.toFixed(2)} %)` : '') : 'Kein Cross-Check verfügbar (Zweitquelle fehlt/nicht zeitgleich).'}</p>`}
    <h3>Data Quality</h3><table class="tbl">${q.map(r => html`<tr><td>${r[0]}</td><td>${lbl(r[1])}</td><td class="num">${r[2] != null ? fmtAge(r[2]) : '—'}</td><td class="mut">${r[3]}</td></tr>`)}</table></div>`;
}
function tabPlan(t) {
  const A = t.A, S = core.S(); if (!A) return '';
  const ex = core.execCheck(t, { auto: false, preTrade: false });
  const sz = ex.sizing, p = A.core.price;
  const oh = t.ohlcv && t.ohlcv['1m']; const a14 = oh && oh.candles.length >= 20 ? atr(oh.candles, 14) : null;
  const pos = core.state.positions.find(x => x.tokenId === t.id);
  const exitImp = sz && sz.size > 0 ? core.estImpact(sz.size, A.liq.usd) : null;
  const autoB = t.D.blockers;
  const r = tokRatio(t), at = f => (p ? pxMc(p * f, r) : '—');
  return html`<h3 style="margin-top:0">Execution Preview <span class="lbl SIMULATED">${core.state.mode}</span></h3>
    <div class="grid2">${kv('Token', t.symbol)}${kvA('Seite', 'BUY')}${kv('Vorgeschlagene Größe', sz && sz.size > 0 ? fmtUsd(sz.size) : '0', 'ESTIMATED')}${kvA('begrenzt durch', (sz && sz.capBy) || '—')}${kv('Geschätzt', pxMc(p, r), A.label)}${kvA('Erw. Price Impact', sz && isNum(sz.impactPct) ? sz.impactPct.toFixed(3) + '%' : '—', 'ESTIMATED')}${kv('Gebühren gesamt', sz && sz.fees ? fmtUsd(sz.fees.total, 4) : '—', 'ESTIMATED')}${kvA('Max. Price Impact', S.maxSlippagePct + '%')}</div>
    ${sz && sz.fees ? html`<p class="note an">Fees: Netzwerk ${fmtUsd(sz.fees.network, 5)} + Priority ${fmtUsd(sz.fees.priority, 5)} (${sz.fees.lamports} Lamports @ SOL-Preis ${fmtUsd(sz.fees.solUsd)}) + DEX ${fmtUsd(sz.fees.dex, 4)}</p>` : ''}
    ${sz && sz.factors && sz.factors.caps ? html`<p class="note an">Sizing: Basis ${sz.factors.basePct}% · Risk-Faktor ${sz.factors.fRisk} · Confidence-Faktor ${sz.factors.fConf} · Volatilitäts-Faktor ${sz.factors.fVol} · Risiko-Abschläge ×${sz.factors.fAdj} · Limits: ${Object.entries(sz.factors.caps).map(([k, v]) => k + ' ' + fmtUsd(v)).join(', ')}</p>` : sz && sz.reason ? html`<p class="note warn">${sz.reason}</p>` : ''}
    ${sz && sz.factors && arr(sz.factors.adj).length ? html`<div class="note">Größe reduziert (Risk Engine): ${sz.factors.adj.map(a => html`<span class="chip warn" title="${a.code}">${a.text}</span> `)}</div>` : ''}
    <h3>Trade Plan</h3><div class="grid2">${kv('Stop Loss (−' + S.stopLossPct + '%)', at(1 - S.stopLossPct / 100))}${kvA('ATR-Stop (' + S.atrMult + '× ATR)', a14 && p ? pxMc(p - S.atrMult * a14, r) : 'ATR n/v', a14 ? 'LIVE' : 'UNKNOWN')}${kv('TP1 +' + S.tp1Pct + '% (' + Math.round(S.tp1Frac * 100) + '%)', at(1 + S.tp1Pct / 100))}${kv('TP2 +' + S.tp2Pct + '% (' + Math.round(S.tp2Frac * 100) + '%)', at(1 + S.tp2Pct / 100))}${kv('TP3 +' + S.tp3Pct + '% (Rest)', at(1 + S.tp3Pct / 100))}${kv('Trailing', 'ab +' + S.trailActivatePct + '%, Abstand ' + S.trailPct + '%')}${kv('Time Exit', S.timeExitMin + ' min < ' + S.timeExitMinPnlPct + '%')}${kv('Break-even nach TP1', S.breakEvenAfterTp1 ? 'ja' : 'nein')}</div>
    <div class="an"><h3>Liquidity Exit Test</h3><div class="grid2">${kv('Verfügbare Liquidität', fmtUsd(A.liq.usd))}${kv('Exit-Liquidität (Quote-Seite)', fmtUsd(A.liq.exitLiqUsd), 'ESTIMATED')}${kv('Erw. Exit-Slippage', exitImp != null ? (exitImp * 100).toFixed(3) + '%' : '—', 'ESTIMATED')}${kv('Exit Risk', A.liq.slipRisk)}</div></div>
    ${pos ? html`<p class="note info">Offene Position: ${fmtUsd(pos.costUsd)} · Einstieg Coin-Preis ${fmtPrice(pos.entryPrice)} (${mcAt(pos.entryPrice, mcRatio(pos, t))}) · PnL ${isNum(pos.pnlUsd) ? fmtSigned(pos.pnlUsd) : 'n/v'}</p>` : ''}
    <h3>Was einen manuellen Kauf gerade verhindert</h3>${ex.blockers.length ? ex.blockers.map(b => html`<div class="check"><span class="ic fail">P${b.prio}</span><div><b class="an">${b.code}</b><small>${b.msg}</small></div></div>`) : html`<p class="ok">Nichts – ein manueller Sim-Kauf ist möglich (harte Regeln werden beim Kauf erneut geprüft).</p>`}
    <div class="an"><h3>Blocker (Auto-Bot)</h3>${autoB.length ? autoB.slice(0, 8).map(b => html`<span class="blk p${b.prio}" title="${b.msg}">${b.code}</span>`) : html`<p class="ok">Keine – Token wäre für den Bot freigegeben.</p>`}</div>
    <div class="row" style="margin-top:10px"><button class="btn pri" data-act="buy" data-id="${t.id}">💱 Sim-Kauf vorbereiten</button></div>
    <div class="an"><h3>Live-Order-Precheck (Vorbereitung, derzeit nicht ausführbar)</h3>${core.preLiveChecks(t, sz && sz.size > 0 ? sz.size : 20).map(c => html`<div class="check"><span class="ic ${c.ok ? 'pass' : 'fail'}">${c.ok ? 'OK' : 'NEIN'}</span><div><b>${c.name}</b><small>${c.detail}</small></div></div>`)}
    <p class="note">Vor einer echten Order müssten alle Punkte bestehen. Route/Provider fehlt → NO TRADE im Live-Modus. Simulation bleibt davon unberührt.</p></div>`;
}
/* Score-Aufschlüsselung, Kipp-Punkte, Signal-Konflikte und Zeitfenster-Abgleich */
const MTF_DE = { ALIGNED_UP: 'alle Zeitfenster steigend', ALIGNED_DOWN: 'alle Zeitfenster fallend', FLAT: 'seitwärts', PARTIAL: 'teilweise übereinstimmend', MIXED: 'widersprüchlich', UNKNOWN: 'zu wenig Daten' };
const dirArrow = d => (d == null ? '—' : d > 0 ? '▲' : d < 0 ? '▼' : '▬');
function attributionHtml(t) {
  const at = scoreAttribution(t.A, t.D, core.S()); if (!at) return '';
  const A = t.A, row = (name, d) => html`<div class="meter"><span>${name}</span>${bar(Math.min(100, Math.abs(d) * 8), d >= 0 ? 'var(--green)' : 'var(--red)')}<span class="num r ${d >= 0 ? 'up' : 'dn'}">${d > 0 ? '+' : ''}${d}</span></div>`;
  return html`<h3>Score-Aufschlüsselung</h3><p class="note">Final Score = 50 (neutral) + Beiträge der Komponenten − Abzüge = ${at.raw} → ${at.finalScore} (gerundet, 0–100)</p>
    <div class="grid2 lgrid"><div><b class="ok">Treibt den Score</b>${at.pro.length ? at.pro.map(x => row(x.name, x.delta)) : html`<p class="mut">—</p>`}</div>
    <div><b class="bad">Spricht dagegen</b>${[...at.contra.map(x => row(x.name, x.delta)), ...at.penalties.map(x => row(x.name, x.delta))]}${!at.contra.length && !at.penalties.length ? html`<p class="mut">—</p>` : ''}</div></div>
    <h3>${t.D.decision === 'APPROVED' || t.D.decision === 'BUY_CANDIDATE' ? 'Was die Entscheidung kippen würde' : 'Was sich ändern müsste'}</h3><ul class="list-plain">${at.flips.map(f => html`<li>${f}</li>`)}</ul>
    <h3>Zeitfenster-Abgleich <span class="chip ${A.mtf.label === 'MIXED' ? 'warn' : A.mtf.label === 'UNKNOWN' ? '' : 'info'}">${MTF_DE[A.mtf.label]}</span></h3>
    <div class="grid4">${['m5', 'h1', 'h6', 'h24'].map(k => kv(k.replace('m', '').replace('h', '') + (k[0] === 'm' ? ' min' : ' h'), dirArrow(A.mtf.dirs[k]) + ' ' + fmtPct(A.price.chg[k])))}</div>
    <h3>Signal-Konflikte</h3>${A.sigConflicts.length ? A.sigConflicts.map(c => html`<div class="check"><span class="ic ${c.severity === 'HIGH' ? 'fail' : 'warn'}">${c.severity}</span><div><b>${CONFLICT_DE[c.code] || c.code}</b><small>${c.text}</small></div></div>`) : html`<p class="mut">Keine Widersprüche zwischen Signalen und Messwerten.</p>`}
    ${conflictWeight(A.sigConflicts) >= 3 ? html`<p class="note">Konflikt-Gewicht ${conflictWeight(A.sigConflicts)} ≥ 3 → Auto-Kauf wird verhindert${core.S().signalConflictBlock ? '' : ' (in den Einstellungen deaktiviert)'}.</p>` : ''}`;
}
/* Kompakte Begründung für die einfache Ansicht */
function whyShortHtml(t) {
  const at = scoreAttribution(t.A, t.D, core.S()); if (!at) return '';
  const D = t.D, ok = D.decision === 'APPROVED' || D.decision === 'BUY_CANDIDATE';
  return html`<div class="panel tight whyshort"><b>Warum ${ok ? 'Kandidat' : 'kein Trade'}?</b>
    <small>${at.pro.slice(0, 2).map(x => html`<span class="ok">▲ ${x.name}</span> `)}${at.contra.slice(0, 2).map(x => html`<span class="bad">▼ ${x.name}</span> `)}${t.A.sigConflicts.length ? html`<span class="warn">⚠ ${t.A.sigConflicts.length} Signal-Konflikt(e)</span>` : ''}</small>
    <small class="mut">${ok ? at.flips[0] : at.flips[0] || D.reason}</small></div>`;
}
/* Lern-KI als Research-Signal (ersetzt nie Regeln, Security oder Limits; ohne Evidenz → Enthaltung). */
function learnSignalHtml(t) {
  const d = core.learnDecision(t); if (!d) return '';
  return html`<h3>Lern-KI (Research-Signal)</h3><div class="grid3">${kv('Modell-Score (niedriger Verlust-Risiko = hoch)', d.modelScore == null ? '—' : d.modelScore)}${kv('Kalibrierte Trefferquote', d.calibratedProbability == null ? '—' : Math.round(d.calibratedProbability * 100) + ' %' + (d.uncertainty != null ? ' ± ' + Math.round(d.uncertainty * 100) : ''))}${kv('Evidenz', d.evidenceLevel + ' · n=' + d.sampleSize)}${kv('Drift', d.driftStatus)}${kv('Enthaltung', d.abstain || 'nein')}${kv('Gelernte Regeln aktiv', d.rulesActive ? 'ja' : 'nein')}</div><p class="note">Nur Zusatzinformation aus vergangenen simulierten Trades. Enthält sich bei zu wenig oder zu schwacher Evidenz (${d.abstain || 'validiertes Modell'}). Entscheidungen trifft weiterhin die regelbasierte Engine.</p>`;
}
function tabWhy(t) {
  const A = t.A, D = t.D; if (!A) return '';
  const facts = [['Coin-Preis', fmtPrice(A.core.price), A.labels.price], ['MC', fmtMc(A.core.mc), A.labels.price], ['Liquidität', fmtUsd(A.liq.usd), A.labels.liquidity], ['Volumen 1h', fmtUsd(A.vol.h1), A.labels.volume], ['Käufer 1h', A.tx.ratio1 != null ? (A.tx.ratio1 * 100).toFixed(0) + '%' : '—', A.labels.volume], ['Security', A.sec.status, A.labels.security], ['Pair-Alter', fmtAge(A.core.pairAge), A.core.pairAge != null ? 'LIVE' : 'UNKNOWN']];
  const risks = [...(t.sec ? t.sec.flags.map(f => f.msg) : []), ...A.pump.flags, ...A.vol.anomalies, ...A.conflicts.map(c => `Datenkonflikt ${c.field} (${c.diffPct.toFixed(1)} %)`), ...Object.entries(A.risk.factors).filter(([, v]) => v != null && v >= 60).map(([k, v]) => `${RISK_NAMES[k]} ${v}`)];
  const sentence = D.decision === 'APPROVED' ? `Der Bot würde ${t.symbol} kaufen: ${D.reason}.` : D.decision === 'BUY_CANDIDATE' ? `Die Analyse für ${t.symbol} ist positiv, aber die Ausführung ist blockiert: ${D.execBlockers.slice(0, 2).map(b => b.msg).join('; ')}.` : `Der Bot handelt ${t.symbol} nicht. Wichtigste Gründe: ${D.blockers.slice(0, 3).map(b => b.msg).join('; ')}.`;
  return html`<div class="panel tight"><b>${sentence}</b>${chainHtml(core.candidateChain(t))}<p class="note">Regelbasierte Erklärung aus gemessenen Daten – keine externe KI, keine erfundenen Werte. Dies ist eine Entscheidung für diesen Token, kein globaler Bot-Block.</p></div>
    <h3>Fakten</h3><table class="tbl">${facts.map(f => html`<tr><td>${f[0]}</td><td class="num">${f[1]}</td><td>${lbl(f[2])}</td></tr>`)}</table>
    <h3>Signale</h3>${A.signals.length ? A.signals.map(s => html`<span class="sig" title="${s.reason}">${SIGNAL_NAMES[s.type]} <i>${s.strength}</i></span>`) : html`<p class="mut">keine</p>`}
    <h3>Risiken</h3>${risks.length ? html`<ul class="list-plain">${risks.map(r => html`<li>${r}</li>`)}</ul>` : html`<p class="mut">Keine auffälligen Risiken gemessen (keine Garantie).</p>`}
    <h3>Unbekannt / nicht genug Daten</h3><ul class="list-plain">${A.unknowns.map(u => html`<li class="mut">${u}</li>`)}</ul>
    ${attributionHtml(t)}
    ${learnSignalHtml(t)}
    <h3>Blocker (nach Priorität)</h3>${D.blockers.length ? D.blockers.map(b => html`<div class="check"><span class="ic fail">P${b.prio}</span><div><b>${b.code}</b> <span class="chip">${b.cat}</span><small>${b.msg}</small></div></div>`) : html`<p class="ok">Keine Blocker.</p>`}
    <h3>Decision Trace</h3><ul class="trace">${D.trace.map(x => html`<li><span class="ic">${x.ok === true ? '✅' : x.ok === false ? '❌' : '·'}</span><b>${x.stage}</b><span>${x.detail}</span></li>`)}</ul>
    <h3>Strategie-Stimmen</h3><div class="tw"><table class="tbl"><tr><th>Strategie</th><th>Stimme</th><th class="r">Stärke</th><th class="r">Gewicht</th><th>Begründung</th></tr>${(A.strat ? A.strat.votes : []).map(v => html`<tr><td>${v.name}${v.shadow ? html` <span class="chip vio">Shadow</span>` : ''}</td><td class="${v.vote === 'BUY' ? 'ok' : 'mut'}">${v.vote}</td><td class="r num">${v.strength}</td><td class="r num">${v.weight}</td><td class="mut">${v.why || ''}${v.reasons.length ? ' – ' + v.reasons.join('; ') : ''}</td></tr>`)}</table></div>`;
}
const TAB_RENDER = { overview: tabOverview, risk: tabRisk, plan: tabPlan, why: tabWhy };
function emptyDetail() {
  const st = core.state, pos = st.positions;
  return html`<h2>Token-Details</h2><p class="mut">Wähle einen Token im Scanner, um Coin-Preis, MC, Chart, Security und Trade Plan zu sehen.</p>
    <div class="grid2" style="margin-top:12px">${kv('Tokens', st.markets.size)}${kv('Kandidaten', (st.metrics.scanStats || {}).candidates || 0)}${kv('Positionen', pos.length)}${kvA('Health', core.systemHealth().score)}</div>
    <h3>Letzte Alarme</h3>${st.feed.slice(0, 5).map(e => html`<div class="check"><span class="ic ${e.level === 'CRITICAL' || e.level === 'ERROR' ? 'fail' : e.level === 'WARNING' ? 'warn' : 'pass'}">${fmtTime(e.ts).slice(0, 5)}</span><div><b>${e.tag}${e.sym ? ' · ' + e.sym : ''}</b><small>${e.detail}</small></div></div>`)}${st.feed.length ? '' : html`<p class="mut">Noch keine.</p>`}`;
}
function renderDetail() {
  const box = $('detail'); if (!box) return;
  const t = selTok();
  if (!t) {
    if (box._tokenId) { box._tokenId = null; box._tab = null; box._sig = null; }
    patch(box, emptyDetail());
    box.classList.remove('open'); const bd = $('backdrop'); if (bd) bd.classList.remove('open');
    return;
  }
  if (box._tokenId !== t.id || box._tab !== UI.detailTab) {
    box._tokenId = t.id; box._tab = UI.detailTab;
    setHTML(box, html`<div id="dHead"></div><div class="tabs" role="tablist">${DETAIL_TABS.map(([k, n]) => html`<button role="tab" data-act="dtab" data-k="${k}" class="${(UI.detailTab === k ? 'on' : '') + (k === 'why' ? ' an' : '')}" aria-selected="${UI.detailTab === k}">${n}</button>`)}</div><div id="dBody"></div>`);
    if (UI.detailTab === 'chart') buildChartTab(t);
  }
  patch(document.getElementById('dHead'), detailHead(t));
  if (UI.detailTab === 'chart') { renderChartInfo(t); drawChart(); }
  else patch(document.getElementById('dBody'), TAB_RENDER[UI.detailTab](t));
}
function selectToken(id, openTab) {
  if (!tok(id)) { toast('WARNING', 'Token nicht mehr im Scanner', 'Er wurde evtl. aus dem Universe entfernt'); return; }
  core.select(id);
  if (openTab) UI.detailTab = openTab;
  chartState.i0 = chartState.i1 = null;
  const box = $('detail'); box._tokenId = null;
  if (window.matchMedia('(max-width:1100px)').matches) { box.classList.add('open'); $('backdrop').classList.add('open'); }
  renderDetail(); renderView();
  if (UI.chartTf !== 'live') loadOhlcv(id, UI.chartTf);
}
function closeDetail() {
  const box = $('detail'); box.classList.remove('open'); $('backdrop').classList.remove('open');
  core.select(null); renderDetail(); renderView();
}

/* ---------- Charts (Canvas, keine erfundenen Datenpunkte) ---------- */
const chartState = { i0: null, i1: null, hover: null, drag: null, loading: false, err: '' };
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888'; }
function buildChartTab(t) {
  setHTML(document.getElementById('dBody'), html`<div class="chartctl" role="toolbar" aria-label="Chart-Steuerung">${[['live', 'Live'], ['1m', '1m'], ['5m', '5m'], ['15m', '15m']].map(([k, n]) => html`<button class="btn sm ${UI.chartTf === k ? 'on' : ''}" data-act="tf" data-k="${k}">${n}</button>`)}<span style="flex:1"></span><button class="btn sm" data-act="zoomIn" aria-label="Zoom in">＋</button><button class="btn sm" data-act="zoomOut" aria-label="Zoom out">－</button><button class="btn sm" data-act="zoomReset">Reset</button></div>
    <div class="chartbox" id="chartBox"><canvas id="chartCv" aria-label="Preischart ${t.symbol}"></canvas><div class="charttip" id="chartTip"></div></div><div class="note" id="chartInfo"></div>`);
  const cv = document.getElementById('chartCv');
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomChart(e.deltaY < 0 ? 0.8 : 1.25); }, { passive: false });
  cv.addEventListener('pointerdown', e => { chartState.drag = { x: e.clientX, i0: chartState.i0, i1: chartState.i1 }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect(); chartState.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (chartState.drag && e.pointerType === 'mouse' ? e.buttons === 1 : chartState.drag) {
      const d = chartData(selTok()); const n = d.pts.length; if (n > 2 && chartState.lastVis) {
        const per = (r.width - 70) / chartState.lastVis.len; const shift = Math.round((chartState.drag.x - e.clientX) / per);
        const len = chartState.lastVis.len; let i1 = (chartState.drag.i1 == null ? n - 1 : chartState.drag.i1) + shift; i1 = clamp(i1, len - 1, n - 1);
        chartState.i1 = i1 >= n - 1 ? null : i1; chartState.i0 = i1 - len + 1;
      }
    }
    drawChart();
  });
  const end = () => { chartState.drag = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { chartState.hover = null; chartState.drag = null; drawChart(); });
}
function chartData(t) {
  if (!t) return { kind: 'line', pts: [] };
  if (UI.chartTf === 'live') return { kind: 'line', pts: t.hist.map(h => ({ t: h.t, o: h.p, h: h.p, l: h.p, c: h.p, v: null })), src: 'Live-Samples aus DexScreener (~5 s, nur während die App läuft)', label: 'LIVE' };
  const oh = t.ohlcv[UI.chartTf];
  if (!oh) return { kind: 'candle', pts: [], src: chartState.loading ? 'GeckoTerminal OHLCV wird geladen …' : chartState.err || 'Keine OHLCV-Daten geladen' };
  return { kind: 'candle', pts: oh.candles, src: `GeckoTerminal OHLCV ${UI.chartTf} · Stand ${fmtTime(oh.fetchedAt)}`, label: Date.now() - oh.fetchedAt < 2 * MIN ? 'LIVE' : 'STALE' };
}
function positionLines(t) {
  const p = core.state.positions.find(x => x.tokenId === t.id); if (!p) return [];
  const L = [{ v: p.entryPrice, label: 'Entry', c: cssVar('--cyan') }, { v: p.stop, label: p.stopType === 'TRAILING' ? 'Trailing' : 'Stop', c: cssVar('--red') }];
  p.tps.forEach((v, i) => { if (!p.tpHit[i]) L.push({ v, label: 'TP' + (i + 1), c: cssVar('--green') }); });
  return L.filter(x => isNum(x.v));
}
async function loadOhlcv(id, tf) {
  chartState.loading = true; chartState.err = '';
  try { await core.fetchOhlcv(id, tf); } catch (e) { chartState.err = 'OHLCV nicht verfügbar: ' + e.message; }
  finally { chartState.loading = false; if (core.state.selected === id) { renderChartInfo(tok(id)); drawChart(); } }
}
function renderChartInfo(t) {
  const d = chartData(t);
  patch(document.getElementById('chartInfo'), html`${d.label ? lbl(d.label) : ''} ${d.src || ''} · ${d.pts.length} Punkte${d.kind === 'candle' ? ' · EMA 9/21, Volumen' : ' · EMA 9/21'}${positionLines(t).length ? ' · Entry/Stop/TP-Linien' : ''} · Mausrad/＋－ zoomen, ziehen verschiebt.`);
}
function zoomChart(f) {
  const d = chartData(selTok()); const n = d.pts.length; if (n < 3) return;
  const i1 = chartState.i1 == null ? n - 1 : chartState.i1; const i0 = chartState.i0 == null ? Math.max(0, n - 120) : chartState.i0;
  const len = clamp(Math.round((i1 - i0 + 1) * f), 8, n);
  chartState.i0 = Math.max(0, i1 - len + 1); chartState.i1 = chartState.i1 == null ? null : i1;
  drawChart();
}
function drawChart() {
  const cv = document.getElementById('chartCv'), t = selTok(); if (!cv || !t) return;
  const d = chartData(t), n = d.pts.length;
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  const muted = cssVar('--muted'), grid = '#ffffff12', tip = document.getElementById('chartTip');
  if (n < 2) { c.fillStyle = muted; c.font = '13px system-ui,sans-serif'; c.textAlign = 'center'; c.fillText(n ? 'Zu wenige Datenpunkte' : 'Keine Chartdaten – es werden keine Punkte erfunden', w / 2, h / 2); if (tip) tip.style.display = 'none'; return; }
  let i1 = chartState.i1 == null ? n - 1 : Math.min(chartState.i1, n - 1);
  let i0 = chartState.i0 == null ? Math.max(0, n - 120) : clamp(chartState.i0, 0, i1);
  if (i1 - i0 < 4) i0 = Math.max(0, i1 - 4);
  const vis = d.pts.slice(i0, i1 + 1); chartState.lastVis = { len: vis.length };
  const closes = d.pts.map(p => p.c), e9 = emaSeries(closes, 9).slice(i0, i1 + 1), e21 = emaSeries(closes, 21).slice(i0, i1 + 1);
  const padR = 66, volH = d.kind === 'candle' ? 36 : 0, padT = 8, padB = 16 + volH;
  const plotW = w - padR - 4, plotH = h - padT - padB;
  let lo = Math.min(...vis.map(p => p.l)), hi = Math.max(...vis.map(p => p.h));
  const lines = positionLines(t);
  for (const L of lines) if (L.v > lo / 2 && L.v < hi * 2) { lo = Math.min(lo, L.v); hi = Math.max(hi, L.v); }
  const pv = (hi - lo) * 0.06 || hi * 0.01 || 1e-12; lo -= pv; hi += pv;
  const step = plotW / vis.length;
  const X = i => 4 + (i + 0.5) * step, Y = v => padT + (1 - (v - lo) / (hi - lo)) * plotH;
  c.font = '10px ui-monospace,monospace'; c.textAlign = 'left'; c.textBaseline = 'middle';
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4, y = Y(v); c.strokeStyle = grid; c.beginPath(); c.moveTo(4, y); c.lineTo(4 + plotW, y); c.stroke(); c.fillStyle = muted; c.fillText(fmtPrice(v), 8 + plotW, y); }
  if (volH) { const vm = Math.max(...vis.map(p => p.v || 0)) || 1; vis.forEach((p, i) => { const bh = (p.v || 0) / vm * (volH - 6); c.fillStyle = p.c >= p.o ? '#22e58f44' : '#ff547044'; c.fillRect(X(i) - step * 0.35, h - 14 - bh, Math.max(1, step * 0.7), bh); }); }
  if (d.kind === 'candle') {
    vis.forEach((p, i) => { const up = p.c >= p.o; c.strokeStyle = c.fillStyle = up ? '#22e58f' : '#ff5470'; c.beginPath(); c.moveTo(X(i), Y(p.h)); c.lineTo(X(i), Y(p.l)); c.stroke(); const y1 = Y(Math.max(p.o, p.c)), y2 = Y(Math.min(p.o, p.c)); c.fillRect(X(i) - Math.max(1, step * 0.33), y1, Math.max(2, step * 0.66), Math.max(1, y2 - y1)); });
  } else {
    c.strokeStyle = cssVar('--cyan'); c.lineWidth = 1.6; c.beginPath(); vis.forEach((p, i) => (i ? c.lineTo(X(i), Y(p.c)) : c.moveTo(X(i), Y(p.c)))); c.stroke(); c.lineWidth = 1;
  }
  const drawEma = (arrE, col) => { c.strokeStyle = col; c.beginPath(); let s = false; arrE.forEach((v, i) => { if (v == null) return; if (!s) { c.moveTo(X(i), Y(v)); s = true; } else c.lineTo(X(i), Y(v)); }); c.stroke(); };
  drawEma(e9, '#fbbf24aa'); drawEma(e21, '#a78bfaaa');
  c.setLineDash([5, 4]);
  for (const L of lines) { if (L.v < lo || L.v > hi) continue; const y = Y(L.v); c.strokeStyle = L.c; c.beginPath(); c.moveTo(4, y); c.lineTo(4 + plotW, y); c.stroke(); c.fillStyle = L.c; c.fillText(L.label, 6, y - 7); }
  c.setLineDash([]);
  c.fillStyle = muted; c.textAlign = 'left'; c.fillText(fmtTime(vis[0].t), 4, h - 6); c.textAlign = 'right'; c.fillText(fmtTime(vis[vis.length - 1].t), 4 + plotW, h - 6);
  const hv = chartState.hover;
  if (hv && hv.x >= 4 && hv.x <= 4 + plotW && tip) {
    const i = clamp(Math.floor((hv.x - 4) / step), 0, vis.length - 1), p = vis[i];
    c.strokeStyle = '#ffffff44'; c.beginPath(); c.moveTo(X(i), padT); c.lineTo(X(i), h - 14); c.stroke();
    tip.style.display = 'block';
    setHTML(tip, d.kind === 'candle' ? html`${fmtDateTime(p.t)}<br>O ${fmtPrice(p.o)} H ${fmtPrice(p.h)}<br>L ${fmtPrice(p.l)} C ${fmtPrice(p.c)}<br>Vol ${fmtUsd(p.v)}` : html`${fmtTime(p.t)}<br>${fmtPrice(p.c)}`);
    tip.style.left = Math.min(w - 150, Math.max(4, X(i) + 10)) + 'px'; tip.style.top = '8px';
  } else if (tip) tip.style.display = 'none';
}
/* Kleine Linien-Charts (Analytics, Risk, API, Scanner, Backtest) */
function drawSeries(cv, series, o = {}) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  const muted = cssVar('--muted'); c.font = '10px ui-monospace,monospace';
  const pts = series.flatMap(s => s.pts).filter(p => isNum(p.v) && isNum(p.t));
  if (pts.length < 2) { c.fillStyle = muted; c.font = '12px system-ui,sans-serif'; c.textAlign = 'center'; c.fillText(o.empty || 'Noch nicht genug Daten', w / 2, h / 2); return; }
  const t0 = Math.min(...pts.map(p => p.t)), t1 = Math.max(...pts.map(p => p.t));
  let lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
  if (o.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (hi === lo) { hi += Math.abs(hi) * 0.05 || 1; lo -= Math.abs(lo) * 0.05 || 1; }
  const pl = 4, pr = 62, pt = 16, pb = 16, W = w - pl - pr, Hh = h - pt - pb;
  const X = t => pl + (t1 === t0 ? W / 2 : (t - t0) / (t1 - t0) * W), Y = v => pt + (1 - (v - lo) / (hi - lo)) * Hh;
  c.textBaseline = 'middle';
  for (let k = 0; k <= 3; k++) { const v = lo + (hi - lo) * k / 3, y = Y(v); c.strokeStyle = '#ffffff10'; c.beginPath(); c.moveTo(pl, y); c.lineTo(pl + W, y); c.stroke(); c.fillStyle = muted; c.textAlign = 'left'; c.fillText((o.fmt || (x => x.toFixed(1)))(v), pl + W + 4, y); }
  if (o.zero && lo < 0 && hi > 0) { c.strokeStyle = '#ffffff40'; c.beginPath(); c.moveTo(pl, Y(0)); c.lineTo(pl + W, Y(0)); c.stroke(); }
  let lx = pl;
  for (const s of series) {
    const p = s.pts.filter(q => isNum(q.v)); c.strokeStyle = s.color; c.lineWidth = 1.6; c.beginPath();
    p.forEach((q, i) => (i ? c.lineTo(X(q.t), Y(q.v)) : c.moveTo(X(q.t), Y(q.v)))); c.stroke(); c.lineWidth = 1;
    c.fillStyle = s.color; c.textAlign = 'left'; c.fillText('● ' + s.label, lx, 7); lx += c.measureText('● ' + s.label).width + 12;
  }
  c.fillStyle = muted; c.textAlign = 'left'; c.fillText(fmtTime(t0), pl, h - 6); c.textAlign = 'right'; c.fillText(fmtTime(t1), pl + W, h - 6);
}
const PALETTE = ['#38bdf8', '#f472b6', '#22e58f', '#fbbf24', '#a78bfa', '#fb923c', '#60a5fa'];
const CHARTS = {
  equity: () => [[{ label: 'Equity (SIMULATED)', color: '#38bdf8', pts: core.state.hist.equity.map(p => ({ t: p.t, v: p.v })) }], { fmt: v => fmtUsd(v, 0), empty: 'Noch keine Equity-Historie' }],
  risk: () => [[{ label: 'Exposure %', color: '#38bdf8', pts: core.state.hist.risk.map(p => ({ t: p.t, v: p.exposurePct })) }, { label: 'Drawdown %', color: '#ff5470', pts: core.state.hist.risk.map(p => ({ t: p.t, v: p.ddPct })) }, { label: 'Portfolio Risk', color: '#fbbf24', pts: core.state.hist.risk.map(p => ({ t: p.t, v: p.risk })) }], { zero: true }],
  apiLat: () => { const names = [...new Set(core.state.hist.api.flatMap(p => Object.keys(p.apis)))]; return [names.map((n, i) => ({ label: (core.http.sources[n] ? core.http.sources[n].cfg.label : n).replace('DexScreener', 'Dex'), color: PALETTE[i % PALETTE.length], pts: core.state.hist.api.map(p => ({ t: p.t, v: p.apis[n] ? p.apis[n].lat : null })) })), { fmt: v => Math.round(v) + 'ms', empty: 'Daten nach ~1 Minute' }]; },
  apiFail: () => { const names = [...new Set(core.state.hist.api.flatMap(p => Object.keys(p.apis)))]; return [names.map((n, i) => ({ label: (core.http.sources[n] ? core.http.sources[n].cfg.label : n).replace('DexScreener', 'Dex'), color: PALETTE[i % PALETTE.length], pts: core.state.hist.api.map(p => ({ t: p.t, v: p.apis[n] && p.apis[n].fail != null ? p.apis[n].fail * 100 : null })) })), { zero: true, fmt: v => v.toFixed(0) + '%', empty: 'Daten nach ~1 Minute' }]; },
  scanner: () => [[['candidates', 'Kandidaten', '#38bdf8'], ['accepted', 'Approved', '#22e58f'], ['rejected', 'Rejected', '#ff5470'], ['executed', 'Executed', '#fbbf24']].map(([k, l, col]) => ({ label: l, color: col, pts: core.state.hist.scanner.map(p => ({ t: p.t, v: p[k] })) })), { zero: true, empty: 'Daten nach ~1 Minute' }],
  bt: () => { const r = UI.bt; const curve = r && (r.wf ? r.wf.testCurve : r.res && r.res.curve) || []; return [[{ label: 'Equity (Backtest)', color: '#a78bfa', pts: curve.map(p => ({ t: p.t, v: p.v })) }], { fmt: v => fmtUsd(v, 0) }]; }
};
function drawCharts(root) { (root || document).querySelectorAll('canvas[data-chart]').forEach(cv => { const f = CHARTS[cv.dataset.chart]; if (f) { try { const [s, o] = f(); drawSeries(cv, s, o); } catch (e) { core.log.warn('UI', 'Chart-Fehler: ' + e.message); } } }); }

/* ---------- Render-Steuerung (DOM Batching, nur geänderte Bereiche) ---------- */
const VIEW_RENDER = { system: renderSystem, scanner: renderScanner, signals: renderSignals, markets: renderMarkets, watchlist: renderWatchlist, positions: renderPositions, orders: renderOrders, history: renderHistory, backtest: renderBacktest, analytics: renderAnalytics, learning: renderLearning, risk: renderRisk, alerts: renderAlerts, diagnostics: renderDiagnostics, logs: renderLogs, settings: renderSettings, knowledge: renderKnowledge };
const STATIC_VIEWS = new Set(['settings', 'backtest', 'knowledge']);
const LIVE_INPUTS = new Set(['q', 'hq', 'lq', 'kbq']);
function renderView(force) {
  const v = UI.view, sec = document.getElementById('v-' + v); if (!sec || !VIEW_RENDER[v]) return;
  if (!force && STATIC_VIEWS.has(v)) return;
  const ae = document.activeElement;
  if (!force && ae && sec.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName) && !LIVE_INPUTS.has(ae.id)) return;
  VIEW_RENDER[v](sec);
}
let renderQueued = false, lastRender = 0;
function scheduleRender(force) {
  if (renderQueued) return;
  renderQueued = true;
  const wait = force ? 0 : Math.max(0, 800 - (performance.now() - lastRender));
  setTimeout(() => requestAnimationFrame(() => { renderQueued = false; renderAll(force); }), wait);
}
function renderAll(force) {
  if (!force && Date.now() - UI.lastTouch < 900) { scheduleRender(); return; } // keine Re-Renders während Tippen/Klicken
  const t0 = performance.now();
  try { renderTop(); renderControl(); renderTiles(); renderNav(); renderView(); renderDetail(); }
  catch (e) { core.log.error('UI', 'Render-Fehler: ' + e.message); if (window.console) console.error(e); }
  lastRender = performance.now();
  core.state.metrics.perf.render = Math.round(lastRender - t0);
}
core.on('scan', () => scheduleRender());
core.on('trade', () => scheduleRender(true));
core.on('bot', () => scheduleRender(true));
core.on('settings', () => scheduleRender());

/* ---------- Kontextmenü ---------- */
function openCtx(id, anchor) {
  const t = tok(id); if (!t) return;
  const m = $('ctx'), w = !!core.state.watchlist[id], pair = (t.A && t.A.core.pairAddress) || null, pr = t.A && (t.A.core.priceRaw || (isNum(t.A.core.price) ? String(t.A.core.price) : null));
  setHTML(m, html`<button role="menuitem" data-act="star" data-id="${id}">${w ? '★ Von Watchlist entfernen' : '☆ Zur Watchlist'}</button>
    <button role="menuitem" data-act="select" data-id="${id}">🔍 Analysieren / Details</button>
    <button role="menuitem" data-act="buy" data-id="${id}">💱 Simulate Buy</button><hr>
    <button role="menuitem" data-act="copy" data-v="${t.mint}" data-l="Mint">⧉ Copy Mint</button>
    ${pair ? html`<button role="menuitem" data-act="copy" data-v="${pair}" data-l="Pair">⧉ Copy Pair</button>` : ''}
    ${pr ? html`<button role="menuitem" data-act="copy" data-v="${pr}" data-l="Coin-Preis">⧉ Coin-Preis kopieren</button>` : ''}<hr>
    ${tokenLinks(t).slice(0, 9).map(([n, u]) => html`<a role="menuitem" href="${u}" target="_blank" rel="noopener noreferrer">↗ ${n}</a>`)}`);
  m.hidden = false;
  const r = anchor.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = clamp(r.right - mw, 8, window.innerWidth - mw - 8) + 'px';
  m.style.top = (r.bottom + mh + 8 > window.innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + 'px';
  const first = m.querySelector('button'); if (first) first.focus();
}
function closeCtx() { const m = document.getElementById('ctx'); if (m && !m.hidden) m.hidden = true; }

/* ---------- Manueller Sim-Kauf: Execution Preview + Bestätigung + Receipt ---------- */
function buyPreviewHtml(t, size) {
  const S = core.S();
  const ex = core.execCheck(t, { auto: false, preTrade: false, sizeUsd: size });
  const sz = ex.sizing || {}, A = t.A;
  return html`<div class="grid2">${kv('Token', t.symbol)}${kv('Kauf', '#' + ((core.state.risk.buyCount[t.id] || 0) + 1) + ' von ' + Math.min(S.maxBuysPerCoin, 2))}${kv('Modus', core.state.mode, 'SIMULATED')}${kv('Geschätzt', pxMc(A.core.price, tokRatio(t)), A.label)}${kvA('Erw. Price Impact', isNum(sz.impactPct) ? sz.impactPct.toFixed(3) + '%' : '—', 'ESTIMATED')}${kvA('Max. Price Impact', S.maxSlippagePct + '%')}${kv('Gebühren', sz.fees ? fmtUsd(sz.fees.total, 4) : '—', 'ESTIMATED')}${kv('Risiko', lvlChip(A.risk.level, A.risk.total))}${kvA('Confidence', A.confidence.total + '%')}</div>
    ${ex.blockers.length ? html`<h3>Das verhindert den Kauf</h3>${ex.blockers.map(b => html`<div class="check"><span class="ic fail">P${b.prio}</span><div><b class="an">${b.code}</b><small>${b.msg}</small></div></div>`)}` : html`<p class="ok">Vorabprüfung ok. Beim Bestätigen werden Daten frisch geladen und alle harten Regeln erneut geprüft (Pre-Trade-Check).</p>`}
    <p class="note">Simulation: keine echte Order, keine Transaktion. Füllung zum Live-Preis + geschätztem Impact, Gebühren geschätzt.</p>`;
}
let buyModalToken = null;
async function openBuy(id) {
  buyModalToken = id;
  try { await openBuyInner(id); } finally { buyModalToken = null; }
}
async function openBuyInner(id) {
  const t = tok(id); if (!t || !t.A) { toast('WARNING', 'Keine Analyse vorhanden', 'Warte auf Marktdaten'); return; }
  if (core.state.mode === 'READ_ONLY') { toast('WARNING', 'READ ONLY aktiv', 'Handel ist in diesem Modus deaktiviert'); return; }
  const eq = core.equityInfo(), S = core.S();
  const sugg = core.execCheck(t, { auto: false, preTrade: false }).sizing;
  const def = sugg && sugg.size > 0 ? sugg.size : m2(Math.min(eq.equity * S.maxPositionPct / 100, eq.equity * 0.02));
  const r = await openModal({
    title: `Simulate Buy · ${t.symbol}`,
    body: html`<label class="fld">Betrag in USD (max. ${fmtUsd(eq.equity * S.maxPositionPct / 100)})<input id="buySize" type="number" min="${MIN_ORDER_USD}" step="any" value="${def}" inputmode="decimal"></label><div id="buyPrev" style="margin-top:10px">${buyPreviewHtml(t, def)}</div>`,
    actions: [{ id: 'cancel', label: 'Abbrechen' }, { id: 'ok', label: '✓ Sim-Kauf bestätigen', cls: 'pri' }],
    collect: () => Number((document.getElementById('buySize') || {}).value)
  });
  if (r.id !== 'ok') return;
  const size = r.data;
  if (!Number.isFinite(size) || size <= 0) { toast('WARNING', 'Ungültiger Betrag'); return; }
  toast('INFO', 'Pre-Trade-Check läuft …', t.symbol);
  const res = await core.executeBuy(id, { sizeUsd: size, reason: 'Manueller Sim-Kauf (Nutzer)' });
  if (res.ok) receiptModal(res.order);
  else toast('ERROR', 'Kauf abgelehnt', res.blockers ? res.blockers.slice(0, 3).map(b => b.code).join(', ') : res.error);
  scheduleRender(true);
}
function receiptModal(o) {
  openModal({ title: 'Order Receipt (SIMULATED)', body: html`<div class="grid2">${kvA('Order ID', o.id)}${kv('Status', o.state)}${kv('Token', o.symbol)}${kv('Seite', o.side)}${kv('Füllung', pxMc(o.fillPrice, orderMcRatio(o)), 'SIMULATED')}${kv('Größe', fmtUsd(o.sizeUsd))}${kv('Menge', fmtNum(o.qty, 2))}${kv('Fees', o.fees ? fmtUsd(o.fees.total, 4) : '—', 'ESTIMATED')}${kv('Zeit', fmtDateTime(o.history[o.history.length - 1].ts))}${kv('Transaktion', 'keine – Simulation')}</div><p class="note">Kein Explorer-Link: es existiert keine echte Transaktions-Signatur.</p>` });
}
async function openSell(posId, frac) {
  const p = core.state.positions.find(x => x.id === posId); if (!p) return;
  const qty = frac === 'ALL' ? p.qty : Math.min(p.qty, p.initialQty * frac);
  const t = tok(p.tokenId), liq = t && t.A ? t.A.liq.usd : null, gross = isNum(p.lastPrice) ? qty * p.lastPrice : null;
  const imp = gross != null ? core.estImpact(gross, liq) : null, fees = gross != null ? core.estFees(gross) : null;
  const net = gross != null && imp != null && fees ? gross * (1 - imp) - fees.total : null;
  const ok = await confirmDialog(`Verkaufen · ${p.symbol} (${frac === 'ALL' ? '100' : Math.round(frac * 100)} %)`, 'Simulierter Verkauf mit frischem Preis (Pre-Exit-Check).', {
    confirmLabel: 'Verkaufen', danger: true,
    extra: html`<div class="grid2">${kv('Menge', fmtNum(qty, 2))}${kv('Aktuell', pxMc(p.lastPrice, mcRatio(p, t)), p.priceLabel)}${kv('Erw. Erlös netto', net != null ? fmtUsd(net) : 'n/v', 'ESTIMATED')}${kvA('Price Impact', imp != null ? (imp * 100).toFixed(3) + '%' : 'n/v', 'ESTIMATED')}</div>`
  });
  if (!ok) return;
  const r = await core.executeSell(posId, frac, 'MANUAL', { detail: 'Manueller Verkauf' });
  if (r.ok) receiptModal(r.order); else toast('ERROR', 'Verkauf nicht ausgeführt', r.blockers ? r.blockers.map(b => b.msg).join('; ') : r.error);
  scheduleRender(true);
}

/* ---------- Aktionen (zentraler, einmalig registrierter Event-Handler) ---------- */
const ACTIONS = {
  view: el => { const v = el.dataset.view; if (v === 'more') return ACTIONS.more(); showView(v, true); },
  more: () => {
    const ms = masterStatus(), h = core.systemHealth(), dex = core.http.status('dexPairs');
    return openModal({ title: 'Mehr', body: html`<div class="ctl-top"><span class="mstat ${ms.state}">${ms.text}</span><div class="ctl-why">${ms.why}</div></div>
      <p class="note an">Health ${h.score} · DexScreener ${dex} · RPC ${bestRpcStatus()} · RugCheck ${core.http.status('rugcheck')}</p>
      <div class="row" style="margin:8px 0">${proToggle()}</div>
      ${NAV_GROUPS.map(([g, ids]) => html`<div class="navgrp"><h3>${g}</h3><div class="grid2">${ids.map(id => { const v = VIEWS.find(x => x[0] === id); return html`<button class="btn" data-act="navgo" data-view="${id}">${v[1]} ${v[2]}</button>`; })}</div></div>`)}` });
  },
  navgo: el => { closeModal(null); showView(el.dataset.view, true); },
  pro: () => {
    UI.pro = !UI.pro; saveUi(); applyPro(); core.persistNow();
    document.querySelectorAll('[data-act="pro"]').forEach(b => { b.classList.toggle('on', UI.pro); b.setAttribute('aria-pressed', String(UI.pro)); b.textContent = '🔬 Analyse-Daten: ' + (UI.pro ? 'AN' : 'AUS'); });
    const box = $('detail'); if (box) box._tokenId = null;
    renderView(true); renderAll(true);
    toast('INFO', 'Analyse-Daten ' + (UI.pro ? 'eingeblendet' : 'ausgeblendet'), UI.pro ? 'Alle Messwerte der Kauf-/Verkaufsanalyse sichtbar' : 'Nur die für dich relevanten Werte – der Bot rechnet weiter mit allen Daten');
  },
  select: el => { closeCtx(); if (el.dataset.id) selectToken(el.dataset.id); },
  star: el => { const id = el.dataset.id; closeCtx(); if (core.state.watchlist[id]) { core.removeWatch(id); toast('INFO', 'Von Watchlist entfernt'); } else { const r = core.addWatch(id); toast(r.ok ? 'SUCCESS' : 'ERROR', r.ok ? 'Zur Watchlist hinzugefügt ★' : r.error); } scheduleRender(true); },
  ctx: el => { const m = document.getElementById('ctx'); if (!m.hidden && m._for === el) { closeCtx(); return; } m._for = el; openCtx(el.dataset.id, el); },
  copy: el => { closeCtx(); copyText(el.dataset.v, el.dataset.l ? el.dataset.l + ' kopiert' : 'Kopiert'); },
  closeDetail: () => closeDetail(),
  dtab: el => { UI.detailTab = el.dataset.k; saveUi(); renderDetail(); const t = selTok(); if (UI.detailTab === 'chart' && t && UI.chartTf !== 'live') loadOhlcv(t.id, UI.chartTf); },
  tf: el => { UI.chartTf = el.dataset.k; saveUi(); chartState.i0 = chartState.i1 = null; const t = selTok(); const box = $('detail'); box._tokenId = null; renderDetail(); if (t && UI.chartTf !== 'live') loadOhlcv(t.id, UI.chartTf); },
  zoomIn: () => zoomChart(0.7), zoomOut: () => zoomChart(1.4), zoomReset: () => { chartState.i0 = chartState.i1 = null; drawChart(); },
  sort: el => { const k = el.dataset.k; if (UI.sort === k) UI.dir = -UI.dir; else { UI.sort = k; UI.dir = k === 'age' || k === 'risk' ? 1 : -1; } saveUi(); renderScanner(); },
  rank: el => { UI.rankBy = el.dataset.k; saveUi(); renderView(true); },
  start: () => { const r = core.start(); toast(r.ok ? 'SUCCESS' : 'ERROR', r.ok ? 'Bot gestartet' : r.error, r.ok ? 'Recovery → Running, sobald Datenqualität ausreicht' : ''); scheduleRender(true); },
  pause: () => { core.pause(); toast('INFO', 'Bot pausiert', 'Scanner & Exits laufen weiter, keine neuen Auto-Trades'); scheduleRender(true); },
  stop: async () => { if (core.state.positions.length && !(await confirmDialog('Bot stoppen?', `${core.state.positions.length} offene Position(en) werden bei gestopptem Bot nicht überwacht (keine Stops/TPs).`, { danger: true, confirmLabel: 'Stoppen' }))) return; core.stop(); toast('WARNING', 'Bot gestoppt', 'Scanner aus, Timer gelöscht, Requests abgebrochen'); scheduleRender(true); },
  safe: () => { core.setSafeMode(!core.state.bot.safeMode); toast('INFO', 'Safe Mode ' + (core.state.bot.safeMode ? 'AN' : 'AUS')); scheduleRender(true); },
  mode: el => { const r = core.setMode(el.dataset.mode); toast(r.ok ? 'INFO' : 'ERROR', r.ok ? 'Modus: ' + el.dataset.mode.replace('_', ' ') : r.error); scheduleRender(true); },
  live: async () => {
    const lr = core.liveReadiness();
    const r = await openModal({ title: 'LIVE-Gating', body: html`<p>LIVE muss separat und ausdrücklich aktiviert werden. <b>Auto-Trading bedeutet nie Echtgeldhandel.</b> Alle Voraussetzungen müssen erfüllt sein:</p>
      ${lr.checks.map(c => html`<div class="check"><span class="ic ${c.ok ? 'pass' : 'fail'}">${c.ok ? 'OK' : 'FEHLT'}</span><div><b>${c.name}</b><small>${c.detail}</small></div></div>`)}
      <p class="note">${lr.ready ? 'Alle Voraussetzungen erfüllt.' : 'LIVE ist derzeit nicht aktivierbar (REQUIRES EXTERNAL PROVIDER). Es wird keine Funktion vorgetäuscht. Private Keys oder Seeds werden nie verarbeitet.'}</p>
      <label class="fld" style="margin-top:8px">Zur ausdrücklichen Bestätigung „LIVE“ eingeben<input id="liveConfirm" autocomplete="off" ${lr.ready ? '' : raw('disabled')}></label>`,
      actions: [{ id: 'close', label: 'Schließen' }, { id: 'wallet', label: 'Wallet verbinden (lesend)' }, { id: 'go', label: 'LIVE aktivieren', cls: 'bad', disabled: !lr.ready }],
      collect: () => (document.getElementById('liveConfirm') || {}).value });
    if (r.id === 'wallet') { await ACTIONS.wallet(); return; }
    if (r.id === 'go') { if ((r.data || '').trim() !== 'LIVE') { toast('WARNING', 'Nicht bestätigt'); return; } const res = core.setMode('LIVE'); toast(res.ok ? 'CRITICAL' : 'ERROR', res.ok ? 'LIVE aktiv' : res.error); }
  },
  walletModal: () => openModal({ title: 'Wallet', body: walletPanel() }),
  freshStart: async () => {
    const st = core.state, S = core.S();
    if (!(await confirmDialog('Frischer Start?', `Das Sim-Portfolio startet neu mit ${fmtUsd(S.simCapitalUsd)} Startkapital. ${st.positions.length} offene Position(en) werden verworfen (nicht verkauft, nicht gewertet). Buy-Zähler, Cooldowns und Tageslimit werden zurückgesetzt, damit der Bot neu anfangen kann.`, { confirmLabel: '↺ Frisch starten', danger: true, extra: html`<p class="note ok">Behalten wird alles Gesammelte: Trade-Journal & History, Statistiken, Lern- und Analysedaten, Parameter-Versionen, Logs, Alarme, Watchlist und Einstellungen.</p>` }))) return;
    const r = core.freshStart();
    toast(r.ok ? 'SUCCESS' : 'ERROR', r.ok ? 'Frischer Start' : r.error, r.ok ? `Startkapital ${fmtUsd(S.simCapitalUsd)} · ${r.dropped} Position(en) verworfen · Analysedaten behalten` : '');
    renderView(true); scheduleRender(true);
  },
  reconcile: async () => {
    const rc = core.state.reconciliation;
    const r = await openModal({ title: 'Abgleich (Reconciliation)', body: html`<p>Nach dem Neustart wurden Punkte gefunden, die nicht eindeutig waren. Sie wurden konservativ aufgelöst (keine Füllung ohne Nachweis, Buy-Zähler nie gesenkt). Bitte prüfen und bestätigen – bis dahin sind neue Käufe blockiert, Exits laufen weiter.</p><ul class="list-plain">${rc.issues.map(x => html`<li>${x}</li>`)}</ul>`, actions: [{ id: 'close', label: 'Später' }, { id: 'ack', label: 'Geprüft – bestätigen', cls: 'pri' }] });
    if (r.id === 'ack') { core.ackReconciliation(); toast('SUCCESS', 'Abgleich bestätigt'); scheduleRender(true); }
  },
  auto: async () => {
    const b = core.state.bot;
    if (b.autoTrading) { core.setAutoTrading(false); toast('INFO', 'Auto-Trading AUS'); scheduleRender(true); return; }
    const S = core.S();
    if (!(await confirmDialog('Auto-Trading aktivieren?', `Der Bot führt im Modus ${core.state.mode} virtuelle Trades mit echten Marktdaten aus. Auto-Trading bedeutet nie Echtgeldhandel – LIVE ist separat gesperrt.`, { confirmLabel: 'Aktivieren', extra: html`<ul class="list-plain"><li>Max. ${Math.min(S.maxBuysPerCoin, 2)} Käufe pro Coin, Nachkauf nur im Gewinn</li><li>Max. ${S.maxOpenPositions} Positionen, Exposure ≤ ${S.maxExposurePct} %, Position ≤ ${S.maxPositionPct} %</li><li>Cooldowns: ${S.sellCooldownMin} min nach Verkauf, ${S.lossCooldownMin} min nach Verlust, Pause nach ${S.lossStreakLimit} Verlusten</li><li>Tagesverlust-Limit ${S.dailyLossLimitPct} % → Auto-Trading aus</li></ul>` }))) return;
    const r = core.setAutoTrading(true); toast(r.ok ? 'SUCCESS' : 'ERROR', r.ok ? 'Auto-Trading AN (SIMULATION)' : r.error); scheduleRender(true);
  },
  estop: async () => {
    if (!core.state.bot.emergency) { await core.emergencyStop('Manuell ausgelöst'); scheduleRender(true); return; }
    if (await confirmDialog('Emergency Stop freigeben?', 'Der Bot geht in PAUSED. Auto-Trades starten erst nach START und nur, wenn alle Checks bestehen.', { confirmLabel: 'Freigeben', danger: true })) { core.releaseEmergency(); toast('WARNING', 'Emergency Stop freigegeben', 'Bot ist PAUSED'); scheduleRender(true); }
  },
  notify: async () => { unlockAudio(); if (!('Notification' in window)) { toast('WARNING', 'Browser-Benachrichtigungen nicht unterstützt', 'iPhone: nur als Home-Bildschirm-App mit Service Worker'); updateNotifyBtn(); return; } try { await Notification.requestPermission(); } catch (e) { /* */ } updateNotifyBtn(); },
  buy: el => { closeCtx(); openBuy(el.dataset.id); },
  sell: el => openSell(el.dataset.id, el.dataset.frac === 'ALL' ? 'ALL' : Number(el.dataset.frac)),
  order: el => orderModal(el.dataset.id),
  trade: el => tradeModal(el.dataset.id),
  analyze: el => { const t = tok(el.dataset.id); if (!t) return; core.enqueueSecurity(t, 5000, true); if (UI.chartTf !== 'live') loadOhlcv(t.id, UI.chartTf); toast('INFO', 'Analyse angestoßen', 'Security & Chart werden neu geladen'); },
  secRecheck: el => ACTIONS.analyze(el),
  profile: el => { const r = core.updateSettings(PROFILES[el.dataset.p], 'PROFILE:' + el.dataset.p); toast('INFO', 'Profil ' + el.dataset.p + ' angewendet', r.errors.filter(e => !e.soft).map(e => e.msg).join('; ')); renderFilterForm(); renderView(true); },
  rollback: async el => { const v = +el.dataset.v; if (await confirmDialog('Parameter-Version aktivieren?', `Version v${v} wird aktiviert (nur tunebare Parameter).`)) { core.rollbackTo(v); renderView(true); } },
  newSession: async () => { if (await confirmDialog('Neue Trading Session?', 'Session-Statistiken werden abgeschlossen. Buy-Zähler werden nur für Tokens ohne offene Position zurückgesetzt (Regel in Einstellungen). Cooldowns bleiben aktiv.')) { const r = core.newSession(); toast('SUCCESS', 'Neue Session gestartet', r.reset + ' Buy-Zähler zurückgesetzt'); renderView(true); } },
  resetPortfolio: async () => { if (await confirmDialog('Sim-Portfolio zurücksetzen?', `Cash wird auf das Startkapital (${fmtUsd(core.S().simCapitalUsd)}) gesetzt. Nur ohne offene Positionen möglich. Journal bleibt erhalten.`, { danger: true })) { const r = core.resetPortfolio(); toast(r.ok ? 'SUCCESS' : 'ERROR', r.ok ? 'Portfolio zurückgesetzt' : r.error); renderView(true); } },
  resetSettings: async () => { if (await confirmDialog('Einstellungen zurücksetzen?', 'Alle Einstellungen und Strategien werden auf sichere Defaults gesetzt (Journal, Watchlist und Positionen bleiben).', { danger: true })) { core.resetSettings(); toast('SUCCESS', 'Einstellungen zurückgesetzt'); renderView(true); renderFilterForm(); } },
  factoryReset: async () => { if (await confirmDialog('Factory Reset', 'Löscht ALLE lokalen Daten (Einstellungen, Watchlist, Journal, Positionen, Logs). Nicht umkehrbar.', { danger: true, requireText: 'RESET', confirmLabel: 'Alles löschen' })) { core.factoryReset(); location.reload(); } },
  learnRun: () => { const r = core.learnRunNow(); toast('SUCCESS', 'Lernlauf ausgeführt', r ? `${r.n} Trades ausgewertet` : 'Lern-KI ist ausgeschaltet'); renderView(true); },
  learnPromote: async el => { if (await confirmDialog('Gelerntes Modell übernehmen?', `${el.dataset.id} hat die Shadow-Phase bestanden. Die Änderung wird nur in SIMULATION übernommen, verschärft ausschließlich Einstiegsfilter bzw. passt Exits innerhalb fester Grenzen an und wird danach überwacht (automatischer Rollback bei schlechterer Live-Evidenz). Risiko-Limits und Security bleiben unverändert.`)) { const r = core.learnPromote(el.dataset.id, 'USER'); toast(r.ok ? 'SUCCESS' : 'ERROR', r.ok ? 'Modell übernommen' : r.error); renderView(true); } },
  learnReject: async el => { if (await confirmDialog('Challenger verwerfen?', `${el.dataset.id} wird verworfen; die zugrunde liegende Hypothese wird erst mit deutlich mehr Daten erneut getestet.`)) { const r = core.learnReject(el.dataset.id); toast(r.ok ? 'SUCCESS' : 'ERROR', r.ok ? 'Challenger verworfen' : r.error); renderView(true); } },
  learnRollback: async el => { if (await confirmDialog('Rollback des gelernten Modells?', 'Die vom Modell gesetzten Einstellungen werden auf die vorherigen Werte zurückgesetzt (nur solange du sie nicht selbst geändert hast) und gelernte Regeln entfernt.', { danger: true })) { const r = core.learnRollback(el.dataset.id, 'USER', 'manuell'); toast(r.ok ? 'SUCCESS' : 'ERROR', r.ok ? 'Rollback ausgeführt' : r.error, r.ok && r.skipped.length ? 'Nicht überschrieben (von dir geändert): ' + r.skipped.join(', ') : ''); renderView(true); } },
  export: el => { try { const f = core.exportData(el.dataset.kind); download(f.name, f.mime, f.data); toast('SUCCESS', 'Export erstellt', f.name); } catch (e) { toast('ERROR', 'Export fehlgeschlagen', e.message); } },
  restoreBackup: () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      if (f.size > 15e6) { toast('ERROR', 'Datei zu groß'); return; }
      const rd = new FileReader();
      rd.onload = async () => {
        const obj = parseJSON(String(rd.result));
        const err = core.validateBackup(obj);
        if (err) { toast('ERROR', 'Backup ungültig', err); return; }
        const n = obj.storage.positions && Array.isArray(obj.storage.positions.positions) ? obj.storage.positions.positions.length : 0, j = obj.storage.trades && Array.isArray(obj.storage.trades.journal) ? obj.storage.trades.journal.length : 0;
        if (!(await confirmDialog('Backup wiederherstellen?', `Sicherung vom ${str(String(obj.exportedAt), 30)} (v${obj.app}) mit ${n} offenen Position(en) und ${j} Journal-Einträgen. Alle aktuellen Daten auf diesem Gerät werden ersetzt. Vorher wird der aktuelle Stand automatisch als Backup heruntergeladen. Danach lädt die Seite neu (erneuter Login).`, { danger: true }))) return;
        try { const cur = core.exportData('backup-json'); download(cur.name, cur.mime, cur.data); } catch (e) { toast('ERROR', 'Sicherung des aktuellen Stands fehlgeschlagen – Abbruch', e.message); return; }
        const r = core.restoreBackup(obj);
        if (!r.ok) { toast('ERROR', 'Wiederherstellen fehlgeschlagen', r.error); return; }
        toast('SUCCESS', 'Backup wiederhergestellt', 'Seite lädt neu …');
        setTimeout(() => location.reload(), 900);
      };
      rd.readAsText(f);
    });
    inp.click();
  },
  importSettings: () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; if (!f) return; if (f.size > 2e6) { toast('ERROR', 'Datei zu groß'); return; } const rd = new FileReader(); rd.onload = () => { const r = core.importSettings(String(rd.result)); toast(r.ok ? 'SUCCESS' : 'ERROR', r.ok ? `Import ok (${r.watchlist} Watchlist-Einträge)` : 'Import fehlgeschlagen', r.errors.filter(e => !e.soft).map(e => e.msg).slice(0, 3).join('; ')); renderView(true); }; rd.onerror = () => toast('ERROR', 'Datei nicht lesbar'); rd.readAsText(f); }, { once: true });
    inp.click();
  },
  runTests: async () => { if (UI.testsRunning) return; UI.testsRunning = true; UI.tests = null; renderView(true); try { UI.tests = await runSelfTests(); const ok = UI.tests.filter(x => x.ok).length; core.log[ok === UI.tests.length ? 'success' : 'error']('SYSTEM', `Selbsttest: ${ok}/${UI.tests.length} bestanden`); toast(ok === UI.tests.length ? 'SUCCESS' : 'ERROR', `Selbsttest: ${ok}/${UI.tests.length} bestanden`); } catch (e) { toast('ERROR', 'Selbsttest abgebrochen', e.message); } finally { UI.testsRunning = false; renderView(true); } },
  btRun: () => runBacktestUi(),
  btCsv: () => { const r = UI.bt; if (!r || !r.wf) return; download(`smartlab-backtest-${r.meta.id}.csv`, 'text/csv', btTradesCsv(r.wf.testTrades)); toast('SUCCESS', 'Export erstellt', r.wf.testTrades.length + ' Test-Trades'); },
  clearFeed: () => { core.clearFeed(); renderView(true); },
  logsPause: () => { UI.logPaused = !UI.logPaused; renderLogs(); },
  logCat: el => { UI.logCat = el.dataset.k; saveUi(); renderLogs(); },
  wallet: async () => { closeModal(null); const r = await core.walletConnect(); UI.walletAuto = !!r.ok; saveUi(); toast(r.ok ? 'SUCCESS' : 'WARNING', r.ok ? 'Wallet verbunden (nur lesend)' : 'Wallet nicht verbunden', r.error || ''); scheduleRender(true); renderView(true); },
  walletOff: () => { UI.walletAuto = false; saveUi(); core.walletDisconnect(); closeModal(null); renderView(true); scheduleRender(true); },
  walletBal: async () => { await Promise.all([core.walletBalance(), core.walletNetwork()]); closeModal(null); renderView(true); scheduleRender(true); },
  ackReview: () => { core.state.risk.reviewRequired = false; core.persistNow(); renderView(true); renderBanner(); },
  wlAdd: () => { const i = document.getElementById('wlAdd'); const v = i ? i.value.trim() : ''; const r = core.addWatch(v); toast(r.ok ? 'SUCCESS' : 'ERROR', r.ok ? 'Zur Watchlist hinzugefügt' : r.error); if (r.ok) renderView(true); },
  wlRemove: el => { core.removeWatch(el.dataset.id); renderView(true); }
};
document.addEventListener('click', e => {
  if (!authed) return; // gesperrt: keine App-Aktionen (das Login-Formular hat eigene Handler)
  const mb = e.target.closest('[data-modal]');
  if (mb) { closeModal(mb.dataset.modal); return; }
  if (e.target.id === 'modal') { closeModal(null); return; }
  const ctx = document.getElementById('ctx');
  if (ctx && !ctx.hidden && !e.target.closest('#ctx') && !e.target.closest('[data-act="ctx"]')) closeCtx();
  const el = e.target.closest('[data-act]');
  if (el) {
    if (el.tagName === 'A') e.preventDefault();
    const fn = ACTIONS[el.dataset.act];
    if (fn) { try { const r = fn(el, e); if (r && r.catch) r.catch(x => { core.log.error('UI', x.message); toast('ERROR', 'Aktion fehlgeschlagen', x.message); }); } catch (x) { core.log.error('UI', x.message); toast('ERROR', 'Aktion fehlgeschlagen', x.message); } }
    return;
  }
  const row = e.target.closest('.mrow');
  if (row && !e.target.closest('a,button,input')) selectToken(row.dataset.id);
  const tr = e.target.closest('a[target=_blank]'); if (tr) closeCtx();
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.set) {
    const d = SETTINGS_INDEX[el.dataset.set]; if (!d) return;
    const v = d.t === 'bool' ? el.checked : el.value;
    const r = core.updateSettings({ [d.k]: v });
    const errs = r.errors.filter(x => x.key === d.k || !x.soft);
    if (errs.length) toast(errs.some(x => !x.soft) ? 'ERROR' : 'WARNING', 'Einstellung angepasst', errs.map(x => x.msg).join('; '));
    else if (r.changes.length) toast('SUCCESS', 'Gespeichert', d.l);
    el.value !== undefined && d.t !== 'bool' && (el.value = core.S()[d.k]);
    if (d.t === 'bool') el.checked = !!core.S()[d.k];
    return;
  }
  if (el.dataset.strat) {
    const f = el.dataset.f, v = f === 'enabled' ? el.checked : Number(el.value);
    const r = core.updateStrategies({ [el.dataset.strat]: { [f]: v } });
    if (r.errors.length) toast('ERROR', 'Ungültiger Wert', r.errors.map(x => x.msg).join('; '));
    const cur = core.state.strategies[el.dataset.strat][f];
    if (f === 'enabled') el.checked = cur; else el.value = cur;
    return;
  }
  if (el.dataset.wl) {
    const f = el.dataset.f; core.updateWatch(el.dataset.wl, { [f]: f === 'alerts' ? el.checked : el.value });
    toast('SUCCESS', 'Watchlist gespeichert'); return;
  }
  if (el.dataset.ui) { const v = Number(el.value); if (Number.isFinite(v)) { UI[el.dataset.ui] = clamp(v, 0, 100); saveUi(); renderScanner(); } return; }
  if (el.id === 'fAge') { UI.age = el.value; saveUi(); renderScanner(); }
  if (el.id === 'fRec') { UI.onlyRec = el.checked; saveUi(); renderScanner(); }
  if (el.id === 'fSafe') { UI.safeOnly = el.checked; saveUi(); renderScanner(); }
  if (el.id === 'fRec' || el.id === 'fSafe') { const lb = el.closest('label'); if (lb) lb.setAttribute('aria-checked', String(el.checked)); }
  if (el.id === 'hMode' || el.id === 'hRes') { UI[el.id] = el.value; renderHistory(); }
});
let inputTimer = null;
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'buySize') { const t = selTokFromModal(); if (t) patch(document.getElementById('buyPrev'), buyPreviewHtml(t, Number(el.value))); return; }
  if (!['q', 'hq', 'lq', 'kbq'].includes(el.id)) return;
  clearTimeout(inputTimer);
  inputTimer = setTimeout(() => {
    if (el.id === 'q') { UI.q = el.value; renderScanner(); }
    if (el.id === 'hq') { UI.hq = el.value; renderHistory(); }
    if (el.id === 'lq') { UI.logQ = el.value; renderLogs(); }
    if (el.id === 'kbq') { UI.kbQ = el.value; renderKnowledge(document.getElementById('v-knowledge')); }
  }, 150);
});
const selTokFromModal = () => (buyModalToken ? tok(buyModalToken) : null);
document.addEventListener('keydown', e => {
  if (!authed) return;
  if (e.key === 'Escape') { if (modalState) { closeModal(null); return; } const c = document.getElementById('ctx'); if (c && !c.hidden) { closeCtx(); return; } if (core.state.selected) { closeDetail(); return; } }
  if (e.key === 'Enter' || e.key === ' ') {
    const row = e.target.closest && e.target.closest('.mrow');
    if (row && e.target === row) { e.preventDefault(); selectToken(row.dataset.id); return; }
    const rb = e.target.closest && e.target.closest('[role="button"][data-act]');
    if (rb && e.target === rb) { e.preventDefault(); rb.click(); return; }
    const sw = e.target.closest && e.target.closest('label.switch');
    if (sw && e.target === sw) { e.preventDefault(); sw.click(); }
  }
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !modalState) { e.preventDefault(); showView('scanner'); const q = document.getElementById('q'); if (q) q.focus(); }
});
document.addEventListener('pointerdown', () => { UI.lastTouch = Date.now(); unlockAudio(); }, { passive: true, capture: true });
window.addEventListener('scroll', () => closeCtx(), { passive: true });
window.addEventListener('online', () => { core.log.info('SYSTEM', 'Netzwerk wieder online'); scheduleRender(true); });
window.addEventListener('offline', () => { core.log.warn('SYSTEM', 'Netzwerk offline – Trading deaktiviert'); scheduleRender(true); });
let resizeTimer = null;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { drawChart(); drawCharts(document.getElementById('v-' + UI.view)); }, 200); });
window.addEventListener('error', e => { core.log.error('UI', 'Unerwarteter Fehler: ' + (e.message || 'unbekannt')); });
window.addEventListener('unhandledrejection', e => { core.log.error('UI', 'Unbehandelte Promise-Ablehnung: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason))); });
window.addEventListener('pagehide', () => { try { core.persistNow(); } catch (e) { /* */ } });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { try { core.persistNow(); } catch (e) { /* */ } } else scheduleRender(true); });

/* ---------- App-Start (läuft erst nach erfolgreichem Login) ---------- */
let appStarted = false;
function startApp() {
  if (appStarted) return;
  appStarted = true;
  core.init({ autoStart: true });
  loadUi(); applyPro();
  buildNav(); buildControl(); buildTiles();
  const q = document.getElementById('q'); if (q) q.value = UI.q;
  const fr = document.getElementById('fRec'); if (fr) fr.checked = UI.onlyRec;
  const fs = document.getElementById('fSafe'); if (fs) fs.checked = UI.safeOnly;
  const fa = document.getElementById('fAge'); if (fa) fa.value = UI.age;
  renderFilterForm(); updateNotifyBtn();
  showView(UI.view);
  renderAll(true);
  // Wallet: stille Wiederverbindung nur, wenn sie zuletzt verbunden war und die Wallet dieser Seite vertraut (kein Popup)
  if (UI.walletAuto) core.walletConnect({ silent: true }).then(() => scheduleRender(true)).catch(() => {});
  setInterval(() => { renderTop(); if (UI.view === 'risk' || UI.view === 'positions') renderNav(); }, 1000);
  if (core.state.loadInfo.migrated) toast('INFO', `Daten aus Version ${core.state.loadInfo.migrated} übernommen`, 'Einstellungen, Watchlist, Positionen und Alarme wurden migriert');
  if (core.state.reconciliation.required) toast('WARNING', 'Abgleich erforderlich', 'Neue Käufe blockiert, bis der Abgleich bestätigt ist');
  if (core.state.loadInfo.corrupted) toast('WARNING', 'Gespeicherter Zustand war beschädigt', 'Start mit sicheren Defaults');
  core.log.info('UI', 'UI initialisiert');
}
