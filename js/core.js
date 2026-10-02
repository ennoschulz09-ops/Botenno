/* Smart Lab – core.js
   Kern (createCore): Scanner · Ausführung · Positionen · Portfolio · Risiko · Lern-Orchestrierung · Persistenz
   Klassisches Skript ohne Build-Schritt: alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in fester
   Reihenfolge geladen (index.html bzw. server/load-core.js): base → engine → learning → core → selftest → ui.
   base, engine, learning, core und selftest laufen auch ohne Browser (Node.js); nur ui.js braucht das DOM. */
'use strict';

/* ============================== CORE: Scanner · Execution · Positionen · Portfolio · Risk State ==============================
   createCore() ist DOM-frei und über env (Uhr, fetch, Timer, Storage) injizierbar → testbar. */
const ORDER_TRANSITIONS = {
  DETECTED: ['ANALYZING', 'REJECTED', 'CANCELLED'],
  ANALYZING: ['APPROVED', 'REJECTED', 'CANCELLED', 'FAILED'],
  APPROVED: ['QUEUED', 'SUBMITTING', 'CANCELLED'],
  QUEUED: ['SUBMITTING', 'CANCELLED'],
  SUBMITTING: ['SUBMITTED', 'FAILED', 'CANCELLED'],
  SUBMITTED: ['CONFIRMING', 'FAILED'],
  CONFIRMING: ['CONFIRMED', 'PARTIALLY_FILLED', 'FAILED'],
  PARTIALLY_FILLED: ['COMPLETED', 'FAILED'],
  CONFIRMED: ['COMPLETED'],
  RECONCILING: ['COMPLETED', 'CANCELLED', 'FAILED'],
  COMPLETED: [], FAILED: [], CANCELLED: [], REJECTED: []
};
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'REJECTED']);
/* Positions-Lebenszyklus: PLANNED → PENDING → OPEN → (CLOSING ↔ PARTIAL) → CLOSED → RECONCILED.
   UNKNOWN = Zustand unklar → Abgleich nötig (wird nie still als offen/geschlossen interpretiert). */
const POSITION_TRANSITIONS = { PLANNED: ['PENDING', 'FAILED'], PENDING: ['OPEN', 'FAILED'], OPEN: ['CLOSING', 'UNKNOWN'], PARTIAL: ['CLOSING', 'UNKNOWN'], CLOSING: ['OPEN', 'PARTIAL', 'CLOSED', 'UNKNOWN'], CLOSED: ['RECONCILED', 'UNKNOWN'], RECONCILED: [], UNKNOWN: ['OPEN', 'PARTIAL', 'CLOSED'], FAILED: [] };
const POS_LC_DE = { PLANNED: 'geplant', PENDING: 'Order läuft', OPEN: 'offen', PARTIAL: 'teilverkauft', CLOSING: 'wird verkauft', CLOSED: 'geschlossen', RECONCILED: 'abgeglichen', UNKNOWN: 'unklar – Abgleich nötig', FAILED: 'fehlgeschlagen' };
/* Fehlercodes der Ausführung (auditierbar in jeder Order) */
const EXEC_FAIL = { PRE_TRADE_BLOCKED: 'Pre-Trade-Prüfung hat blockiert', NO_ROUTER: 'Kein Swap-/Routing-Provider (LIVE nicht verfügbar)', QUOTE_FAILED: 'Kein gültiges Angebot (Preis/Liquidität/Gebühren)', PREFLIGHT_FAILED: 'Preflight fehlgeschlagen', SIGNATURE_DISABLED: 'Signieren deaktiviert', SEND_FAILED: 'Senden fehlgeschlagen', CONFIRM_FAILED: 'Bestätigung fehlgeschlagen', EMERGENCY_STOP: 'Emergency Stop während der Ausführung', INTERNAL: 'Interner Fehler', NO_ROUTE: 'Kein Handelsweg über Jupiter', SLIPPAGE_EXCEEDED: 'Preis lief während der Ausführung weg – Slippage-Grenze überschritten', TX_FAILED: 'Transaktion nicht bestätigt (simuliert: Netzwerk/Blockhash)', WRITTEN_OFF: 'Kein Verkaufsweg – als Totalverlust abgeschrieben' };
const BOT_TRANSITIONS = {
  STOPPED: ['STARTING', 'EMERGENCY_STOP'],
  STARTING: ['RECOVERING', 'RUNNING', 'PAUSED', 'ERROR', 'STOPPED', 'EMERGENCY_STOP'],
  RECOVERING: ['RUNNING', 'PAUSED', 'ERROR', 'STOPPED', 'EMERGENCY_STOP'],
  RUNNING: ['PAUSED', 'RECOVERING', 'ERROR', 'STOPPED', 'EMERGENCY_STOP'],
  PAUSED: ['RUNNING', 'RECOVERING', 'ERROR', 'STOPPED', 'EMERGENCY_STOP'],
  ERROR: ['RECOVERING', 'STARTING', 'STOPPED', 'EMERGENCY_STOP'],
  EMERGENCY_STOP: ['PAUSED', 'STOPPED']
};
/* Für manuelle Trades gelten nur die harten Sicherheitsregeln (Manual Override ohne Safety Bypass). */
const MANUAL_HARD = new Set(['PRICE_MISSING', 'DATA_STALE', 'DATA_FALLBACK', 'DATA_CONFLICT', 'SECURITY_CRITICAL', 'SECURITY_UNKNOWN', 'SECURITY_UNVERIFIED', 'SECURITY_STALE', 'LOW_LIQUIDITY', 'LIQUIDITY_SHOCK']);
const ALERT_TAGS = { BUY_CANDIDATE: '🔔 BUY CANDIDATE', SCORE: '⭐ SCORE', X2: '🚀 x2 seit Fund', NEW_TOKEN: '🆕 NEUER TOKEN', LIQ_SPIKE: '💧 LIQUIDITY SPIKE', LIQ_COLLAPSE: '⚠️ LIQUIDITY COLLAPSE', VOL_SPIKE: '📈 VOLUME SPIKE', WHALE: '🐋 WHALE ACTIVITY', SECURITY: '🛡 SECURITY RISK', SELL_CANDIDATE: '↘ SELL CANDIDATE', STOP_HIT: '⛔ STOP HIT', TP_HIT: '🎯 TAKE PROFIT', API_FAIL: '📡 API FAILURE', RPC_FAIL: '🛰 RPC FAILURE', WATCH: '👁 WATCHLIST', RISK: '⚠️ RISK', SYSTEM: '⚙ SYSTEM', TRADE: '💱 TRADE', POSITION_DATA: '⚠️ POSITIONSDATEN', LEGACY: '🔔 Alarm' };
/* Nur diese globalen Blocker bedeuten „BLOCKED“. Kein Kandidat / niedriger Score / kein Konsens → WAITING, nie BLOCKED. */
const HARD_GLOBAL = new Set(['EMERGENCY_STOP', 'SAFE_MODE', 'OFFLINE', 'SYSTEM_UNHEALTHY', 'FEE_UNKNOWN', 'DAILY_LOSS_LIMIT', 'GLOBAL_PAUSE', 'LOSS_COOLDOWN', 'RECONCILIATION_REQUIRED', 'SECURITY_SOURCES_DOWN', 'LIVE_UNAVAILABLE', 'LOW_QUALITY_MARKET', 'DRAWDOWN_LIMIT', 'ANOMALY_PAUSE']);
const GENESIS = { '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'mainnet-beta', 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG': 'devnet', '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY': 'testnet' };
const CHAIN_STEPS = [
  ['DATA', ['PRICE_MISSING', 'DATA_STALE', 'DATA_CONFLICT', 'DATA_FALLBACK']],
  ['SECURITY', ['SECURITY_CRITICAL', 'SECURITY_UNKNOWN', 'SECURITY_UNVERIFIED', 'SECURITY_STALE']],
  ['LIQUIDITY', ['LOW_LIQUIDITY', 'THIN_LIQUIDITY', 'LIQUIDITY_SHOCK']],
  ['MARKET', ['MCAP_RANGE', 'PAIR_TOO_NEW']],
  ['VOLUME', ['LOW_VOLUME', 'BUYER_RATIO']],
  ['MOMENTUM', ['NO_SIGNAL', 'PUMP_DETECTED', 'SIGNAL_CONFLICT']],
  ['RISK', ['RISK_TOO_HIGH']],
  ['SCORE', ['SCORE_TOO_LOW']],
  ['CONFIDENCE', ['CONFIDENCE_LOW']],
  ['CONSENSUS', ['NO_CONSENSUS']],
  ['LEARNING', ['LEARNED_RULE']]
];
/* Kandidaten-Kette: SECURITY PASS → LIQUIDITY PASS → … → FINAL. Rein funktional aus Analyse + Entscheidung. */
function candidateChain(t) {
  const A = t.A, D = t.D; if (!A || !D) return null;
  const steps = CHAIN_STEPS.map(([k, codes]) => {
    const hit = D.analysisBlockers.find(b => codes.includes(b.code));
    // Security wird erst nach bestandenen Schnellfiltern geprüft → „nicht erreicht“ statt Fehler
    const na = !!hit && hit.code === 'SECURITY_UNKNOWN' && !D.fastPass;
    return { k, ok: !hit, na, code: hit ? hit.code : null, msg: na ? 'nicht geprüft (Schnellfilter nicht bestanden)' : hit ? hit.msg : '' };
  });
  const values = { DATA: A.label + (A.dataAge != null ? ' · ' + fmtAge(A.dataAge) : ''), SECURITY: A.sec.status, LIQUIDITY: fmtUsd(A.liq.usd), MARKET: fmtMc(A.core.mc), VOLUME: fmtUsd(A.vol.h1), MOMENTUM: String(A.price.momentum), RISK: A.risk.total + ' ' + A.risk.level, SCORE: String(A.finalScore), CONFIDENCE: A.confidence.total + '%', CONSENSUS: String(A.strat ? A.strat.weightSum : 0), LEARNING: D.analysisBlockers.some(b => b.code === 'LEARNED_RULE') ? 'Regel greift' : 'ok' };
  steps.forEach(x => { x.value = values[x.k]; });
  const firstFail = steps.find(x => !x.ok && !x.na);
  const final = D.decision === 'APPROVED' ? 'BUY – freigegeben' : D.decision === 'BUY_CANDIDATE' ? 'BEREIT – Ausführung wartet: ' + (D.execBlockers[0] ? D.execBlockers[0].msg : '—') : 'NO TRADE';
  const text = steps.map(x => x.k + ' ' + (x.ok ? 'PASS' : x.na ? '—' : x.code.replace(/_/g, ' '))).join(' → ') + ' → FINAL: ' + final;
  return { steps, final, text, reason: firstFail ? firstFail.msg : D.decision === 'BUY_CANDIDATE' ? (D.execBlockers[0] || {}).msg || '' : '', decision: D.decision };
}
const csvCell = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

function createCore(opts) {
  const env = opts.env;
  const log = createLogger(env, 1500);
  const store = createStorage(opts.backend, log);
  const http = createHttp(env, log);
  const subs = new Map();
  const on = (ev, fn) => { if (!subs.has(ev)) subs.set(ev, new Set()); subs.get(ev).add(fn); return () => subs.get(ev).delete(fn); };
  const emit = (ev, data) => { const s = subs.get(ev); if (s) s.forEach(fn => { try { fn(data); } catch (e) { log.error('UI', 'Listener-Fehler (' + ev + '): ' + e.message); } }); };
  const seqs = { order: 0, pos: 0, alert: 0 };

  http.define('dexDisc', { label: 'DexScreener Discovery', limitPerMin: 50, staleMs: 3 * MIN });
  http.define('dexPairs', { label: 'DexScreener Pairs', limitPerMin: 240, staleMs: 45 * SEC });
  http.define('dexSol', { label: 'DexScreener SOL-Preis', limitPerMin: 10, staleMs: 3 * MIN });
  http.define('gecko', { label: 'GeckoTerminal', limitPerMin: 25, staleMs: 3 * MIN });
  http.define('rugcheck', { label: 'RugCheck', limitPerMin: 20, staleMs: 20 * MIN, timeoutMs: 10000 });
  http.define('jupiter', { label: 'Jupiter Quote', limitPerMin: 50, staleMs: 10 * MIN, timeoutMs: 6000 });

  const freshPortfolio = cap => ({ startCapital: cap, cash: cap, realized: 0, fees: 0, peakEquity: cap, maxDD: 0 });
  const state = {
    settings: defaultSettings(), strategies: defaultStrategies(), mode: 'SIMULATION',
    bot: { state: 'STOPPED', desired: 'RUNNING', autoTrading: false, safeMode: false, safeAuto: false, emergency: false, emergencyReason: '', lastError: null, errorStreak: 0, errorAt: 0, startedAt: 0, readyAt: 0 },
    scanner: { id: 0, lock: false, running: false, lastAt: 0, lastDuration: 0, skipped: 0, errors: 0, lateIgnored: 0, nextAt: 0, lastDisc: 0, lastGtDisc: 0, gtKind: 0, lastCross: 0, lastRpc: 0, lastRpcAll: 0, lastOhlcv: 0, scansWindow: [] },
    markets: new Map(), selected: null, sol: null, feeMarket: null,
    positions: [], orders: [], journal: [], feed: [], queue: [], locks: new Set(), usedKeys: new Map(),
    portfolio: freshPortfolio(1000),
    risk: { buyCount: {}, coinCooldown: {}, stratCooldown: {}, lossCooldownUntil: 0, globalPauseUntil: 0, lossStreak: 0, dayKey: '', dailyPnl: 0, dailyStartEquity: null, dailyTrades: 0, dailyLimitHit: false, reviewRequired: false, buyTimes: [] },
    watchlist: {}, seen: {}, alertMarks: {}, stratMarks: {},
    rpc: { slot: null, prevSlot: null, slotAt: 0, latency: null, endpoint: null },
    wallet: { status: 'NOT_CONNECTED', pubkey: null, provider: null, network: null, networkAt: 0, balanceLamports: null, balanceAt: 0, error: '' },
    tradeSeq: 0, reconciliation: { required: false, issues: [], at: 0 },
    monitor: { active: {}, history: [], sigTimes: [] },
    metrics: { perf: { scan: null, analysis: null, exec: null, render: null }, counters: { scans: 0, buySignals: 0, rejected: 0, executed: 0, apiErrors: 0 }, funnel: {}, scanStats: {}, minute: { t: 0, scans: 0, candidates: 0, accepted: 0, rejected: 0, executed: 0 }, rejectReasons: {}, preTradeRejects: {} },
    hist: { equity: [], risk: [], api: [], scanner: [] },
    paramVersions: [], activeParam: 1, configLog: [], auditLog: [], sessions: [], session: null, stratStats: {}, falseSignals: [],
    secQueue: [], secBusy: false, regime: { tags: ['UNKNOWN'] }, storageOk: true, lastSaveAt: 0, ui: {}, loadInfo: {},
    dataQuality: { dexscreener: newDq(), geckoterminal: newDq(), ohlcv: newDq() }, btRuns: [],
    learn: freshLearn(), research: freshResearch(), models: freshModels(null, 0), patterns: {}
  };
  const S = () => state.settings;

  /* ---------- Timer-Verwaltung (keine doppelten Timer) ---------- */
  const timers = new Map();
  function setT(name, fn, ms) { clearT(name); timers.set(name, env.setTimeout(() => { timers.delete(name); fn(); }, ms)); }
  function clearT(name) { if (timers.has(name)) { env.clearTimeout(timers.get(name)); timers.delete(name); } }

  /* ---------- Audit / Logging-Hilfen ---------- */
  function audit(who, what, detail, why) {
    state.auditLog.unshift({ ts: env.now(), who, what, detail: str(String(detail || ''), 300), why: str(String(why || ''), 300) });
    if (state.auditLog.length > 400) state.auditLog.length = 400;
  }
  function noteApiError(src, e) {
    if (!e) return;
    if (!['BACKOFF', 'RATE_LIMIT_LOCAL', 'ABORTED', 'OFFLINE'].includes(e.code)) state.metrics.counters.apiErrors++;
    if (S().debugMode) log.debug('API', `${src}: ${e.message}`);
  }
  http.onStatus((name, prev, st) => {
    const src = http.sources[name]; if (!src) return;
    const label = src.cfg.label;
    if (st === 'OFFLINE') { log.error('API', `${label}: OFFLINE – ${src.lastError || 'keine Antwort'}`); alert(src.cfg.kind === 'rpc' ? 'RPC_FAIL' : 'API_FAIL', null, `${label} ist OFFLINE: ${src.lastError || 'keine Antwort'}`, 'ERROR', { key: name }); }
    else if (st === 'DEGRADED') log.warn('API', `${label}: DEGRADED – ${src.lastError || 'hohe Latenz/Fehlerrate'}`);
    else if (st === 'STALE') log.warn('API', `${label}: STALE – seit ${fmtAge(env.now() - src.lastSuccess)} keine erfolgreiche Antwort`);
    else if (st === 'ONLINE' && prev !== 'UNKNOWN') log.success('API', `${label}: wieder ONLINE`);
    else if (st === 'ONLINE') log.info('API', `${label}: ONLINE`);
  });

  /* ---------- Alerts (dedupliziert, keine Endlosschleifen) ---------- */
  function alert(type, t, detail, level = 'INFO', extra = {}) {
    const now = env.now();
    const key = type + ':' + (t ? t.id : '-') + (extra.key ? ':' + extra.key : '');
    const cd = extra.cooldownMs != null ? extra.cooldownMs : S().alertCooldownMin * MIN;
    if (state.alertMarks[key] && now - state.alertMarks[key] < cd) return null;
    state.alertMarks[key] = now;
    const A = t && t.A;
    const e = {
      id: 'a' + now.toString(36) + '_' + (++seqs.alert), ts: now, type, level, tag: ALERT_TAGS[type] || type,
      tokenId: t ? t.id : null, mint: t ? t.mint : null, sym: t ? t.symbol : null,
      mc: A ? A.core.mc : null, price: A ? A.core.price : null, score: A ? A.finalScore : null, risk: A ? A.risk.level : null,
      riskScore: A ? A.risk.total : null, conf: A ? A.confidence.total : null, dataAge: A ? A.dataAge : null, label: A ? A.label : null,
      detail: String(detail).slice(0, 300), strength: extra.strength != null ? extra.strength : null
    };
    state.feed.unshift(e); if (state.feed.length > 120) state.feed.length = 120;
    persist(); emit('alert', e);
    return e;
  }

  /* ---------- Universe ---------- */
  function mergeLinks(t, links) {
    for (const l of links || []) if (!t.meta.links.some(x => x.url === l.url) && t.meta.links.length < 12) t.meta.links.push(l);
  }
  const openPos = id => state.positions.find(p => p.tokenId === id && p.status === 'OPEN') || null;
  function pinnedIds() {
    const ids = new Set();
    for (const p of state.positions) ids.add(p.tokenId);
    for (const q of state.queue) ids.add(q.tokenId);
    if (state.selected) ids.add(state.selected);
    for (const id of Object.keys(state.watchlist)) ids.add(id);
    for (const f of state.learn.followUps) ids.add(f.tokenId); // Nachlauf-Beobachtung nach dem Exit
    return ids;
  }
  function priorityOf(t) {
    let p = 0;
    if (openPos(t.id)) p += 1000;
    if (state.selected === t.id) p += 800;
    const w = state.watchlist[t.id]; if (w) p += 500 + (4 - (w.priority || 2)) * 30;
    if (t.A) { p += t.A.finalScore * 2; if (t.D && (t.D.decision === 'APPROVED' || t.D.decision === 'BUY_CANDIDATE')) p += 150; if (isNum(t.A.liq.usd)) p += Math.log10(t.A.liq.usd + 1) * 5; }
    if (t.meta.discoveredAt && env.now() - t.meta.discoveredAt < 5 * MIN) p += 60;
    return p;
  }
  function evictOne() {
    const pinned = pinnedIds(); let worst = null, wp = Infinity;
    for (const t of state.markets.values()) {
      if (pinned.has(t.id) || state.locks.has(t.id)) continue;
      const p = priorityOf(t) - (t.lastSeenAt ? (env.now() - t.lastSeenAt) / MIN : 50);
      if (p < wp) { wp = p; worst = t; }
    }
    if (!worst) return false;
    state.markets.delete(worst.id); return true;
  }
  function ensureToken(mint, via) {
    if (!isMint(mint) || NON_MEME.has(mint)) return null;
    const id = tokenIdOf(mint);
    let t = state.markets.get(id);
    if (t) { if (via && !t.meta.via.includes(via) && t.meta.via.length < 6) t.meta.via.push(via); return t; }
    if (state.markets.size >= S().maxTokens && !evictOne()) return null;
    t = { id, mint, symbol: '?', name: '', meta: { discoveredAt: env.now(), via: via ? [via] : [], boostedAt: 0, links: [] }, snap: null, snapReqAt: 0, alt: null, altReqAt: 0, hist: [], ohlcv: {}, sec: null, secPending: false, secFailAt: 0, A: null, D: null, lastReqAt: 0, lastSeenAt: 0, isNew: true, noPair: 0 };
    const sn = state.seen[id]; if (sn && sn.sym) t.symbol = sn.sym;
    state.markets.set(id, t);
    return t;
  }
  function pushHist(t, sn) {
    const last = t.hist[t.hist.length - 1];
    if (isNum(sn.priceUsd) && (!last || sn.fetchedAt - last.t >= 4000)) {
      t.hist.push({ t: sn.fetchedAt, p: sn.priceUsd, liq: sn.liquidityUsd, mc: sn.marketCap != null ? sn.marketCap : sn.fdv });
      if (t.hist.length > 720) t.hist.shift();
    }
  }
  /* Race-Condition-Schutz: nur neuere Requests dürfen den State überschreiben. */
  function applySnapshot(sn, reqAt) {
    if (NON_MEME.has(sn.mint)) return false;
    const t = state.markets.get(sn.id) || ensureToken(sn.mint, 'DexScreener');
    if (!t) return false;
    if (t.snapReqAt && (reqAt < t.snapReqAt || (reqAt === t.snapReqAt && sn.cached))) {
      if (reqAt < t.snapReqAt) { state.scanner.lateIgnored++; if (S().debugMode) log.debug('SCANNER', `Verspätete Antwort für ${t.symbol} verworfen (Race-Schutz)`); }
      return false;
    }
    t.snap = sn; t.snapReqAt = reqAt; t.lastSeenAt = env.now(); t.noPair = 0;
    if (sn.symbol && sn.symbol !== '?') t.symbol = sn.symbol;
    if (sn.name) t.name = sn.name;
    mergeLinks(t, sn.links);
    if (!sn.cached) pushHist(t, sn);
    const mc = sn.marketCap != null ? sn.marketCap : sn.fdv;
    if (!state.seen[t.id] && isNum(mc)) state.seen[t.id] = { mc, t: env.now(), sym: t.symbol };
    return true;
  }
  function applyAlt(t, sn, reqAt) {
    if (t.altReqAt && reqAt < t.altReqAt) { state.scanner.lateIgnored++; return false; }
    t.alt = sn; t.altReqAt = reqAt; t.lastSeenAt = t.lastSeenAt || env.now();
    if ((t.symbol === '?' || !t.symbol) && sn.symbol) t.symbol = sn.symbol;
    if (!t.name && sn.name) t.name = sn.name;
    if (!t.snap || env.now() - t.snap.fetchedAt > S().staleAfterSec * SEC) pushHist(t, sn);
    return true;
  }

  /* ---------- Data Layer: Discovery, Pairs, Cross-Check, OHLCV, RPC, Security ---------- */
  const listValidator = d => (Array.isArray(d) ? null : 'Antwort ist keine Liste');
  const gtValidator = d => (d && Array.isArray(d.data) ? null : 'unerwartetes Schema');
  async function discovery() {
    const now = env.now(), sc = state.scanner;
    if (now - sc.lastDisc >= S().discoveryIntervalSec * SEC || (state.markets.size < 5 && now - sc.lastDisc >= 5 * SEC)) {
      sc.lastDisc = now;
      const eps = [['/token-profiles/latest/v1', 'Profile'], ['/token-boosts/latest/v1', 'Boost'], ['/token-boosts/top/v1', 'Top-Boost']];
      const res = await Promise.allSettled(eps.map(([p]) => http.request('dexDisc', DEX_API + p, { cacheMs: 5 * SEC, validate: listValidator, keepRaw: S().rawApiLog })));
      let added = 0;
      res.forEach((r, i) => {
        if (r.status !== 'fulfilled') { noteApiError('dexDisc', r.reason); return; }
        for (const x of r.value.data) {
          if (!x || x.chainId !== 'solana' || !isMint(x.tokenAddress)) continue;
          const had = state.markets.has(tokenIdOf(x.tokenAddress));
          const t = ensureToken(x.tokenAddress, 'DexScreener ' + eps[i][1]);
          if (!t) continue;
          if (!had) added++;
          if (i > 0) { t.meta.boostedAt = now; if (isNum(x.totalAmount)) t.meta.boostTotal = Math.max(t.meta.boostTotal || 0, x.totalAmount); }
          mergeLinks(t, normLinks(x.links, 'type'));
        }
      });
      if (added) log.info('SCANNER', `${added} neue Tokens entdeckt (Universe: ${state.markets.size})`);
    }
    if (S().ffCrossCheck && now - sc.lastGtDisc >= 15 * SEC) {
      sc.lastGtDisc = now;
      const kind = sc.gtKind++ % 2 ? 'trending_pools' : 'new_pools';
      try {
        const r = await http.request('gecko', `${GT_API}/networks/solana/${kind}?page=1`, { cacheMs: 10 * SEC, headers: GT_HEADERS, validate: gtValidator, keepRaw: S().rawApiLog });
        for (const it of r.data.data) {
          const sn = normGtPool(it, r.fetchedAt, state.dataQuality.geckoterminal); if (!sn) continue;
          const t = ensureToken(sn.mint, 'GeckoTerminal ' + (kind === 'new_pools' ? 'New' : 'Trending'));
          if (t) applyAlt(t, sn, r.fetchedAt);
        }
      } catch (e) { noteApiError('gecko', e); }
    }
  }
  async function fetchChunk(mints, noCache) {
    const now0 = env.now();
    for (const m of mints) { const t = state.markets.get(tokenIdOf(m)); if (t) t.lastReqAt = now0; }
    const r = await http.request('dexPairs', DEX_API + '/tokens/v1/solana/' + mints.join(','), { cacheMs: noCache ? 0 : 800, noCache: !!noCache, validate: listValidator, keepRaw: S().rawApiLog });
    const best = {}, solRatios = [];
    for (const p of r.data) {
      const sn = normDexPair(p, r.fetchedAt, state.dataQuality.dexscreener);
      if (sn && p.quoteToken && p.quoteToken.address === WSOL && sn.priceNative > 0 && sn.priceUsd > 0) solRatios.push(sn.priceUsd / sn.priceNative);
      if (!sn || !mints.includes(sn.mint)) continue;
      const cur = best[sn.mint];
      if (!cur || (sn.liquidityUsd || 0) > (cur.liquidityUsd || 0)) best[sn.mint] = sn;
    }
    // SOL/USD = priceUsd / priceNative bei SOL-quotierten Pools (reale Daten, nur Fallback wenn Direktpreis fehlt/alt)
    if (!r.cached && solRatios.length >= 3 && (!state.sol || state.sol.derived || env.now() - state.sol.at > MIN)) {
      const med = median(solRatios);
      if (isNum(med) && med > 1 && med < 100000) state.sol = { usd: m6(med), at: r.fetchedAt, reqAt: r.fetchedAt, chg: state.sol ? state.sol.chg : null, derived: true, n: solRatios.length };
    }
    let applied = 0;
    for (const m of mints) {
      const sn = best[m];
      if (sn) { sn.cached = !!r.cached; if (applySnapshot(sn, r.fetchedAt)) applied++; }
      else { const t = state.markets.get(tokenIdOf(m)); if (t && !r.cached) t.noPair++; }
    }
    return applied;
  }
  async function fetchMarket() {
    const budget = Math.min(S().chunksPerTick, http.remaining('dexPairs'));
    if (budget <= 0) return;
    const scored = [...state.markets.values()].map(t => ({ t, p: priorityOf(t) })).sort((a, b) => b.p - a.p);
    const first = []; const used = new Set();
    for (const { t } of scored) { if (first.length >= 30) break; first.push(t.mint); used.add(t.mint); }
    const rest = scored.map(x => x.t).filter(t => !used.has(t.mint)).sort((a, b) => a.lastReqAt - b.lastReqAt).map(t => t.mint);
    const chunks = [first];
    for (let i = 0; i < rest.length && chunks.length < budget; i += 30) chunks.push(rest.slice(i, i + 30));
    const res = await Promise.allSettled(chunks.map(ch => fetchChunk(ch)));
    res.forEach(r => { if (r.status === 'rejected') noteApiError('dexPairs', r.reason); });
  }
  async function refreshToken(t, force) {
    if (!force && t.snap && env.now() - t.snap.fetchedAt < 1500) return;
    try { await fetchChunk([t.mint], true); }
    catch (e) { noteApiError('dexPairs', e); log.warn('TRADE', `Pre-Trade-Refresh für ${t.symbol} fehlgeschlagen: ${e.message}`); }
  }
  /* SOL-Preis (für Fee Engine) – eigener, seltener Request, damit Token-Batches nicht durch WSOL-Pairs aufgebläht werden. */
  async function updateSolPrice(force) {
    if (!force && state.sol && env.now() - state.sol.reqAt < 20 * SEC) return;
    if (state.scanner.solBusy) return;
    state.scanner.solBusy = true;
    try {
      const r = await http.request('dexSol', DEX_API + '/tokens/v1/solana/' + WSOL, { cacheMs: 10 * SEC, validate: listValidator });
      let best = null;
      for (const p of r.data) {
        const sn = normDexPair(p, r.fetchedAt, state.dataQuality.dexscreener);
        const q = p && p.quoteToken && p.quoteToken.address;
        if (!sn || sn.mint !== WSOL || (q !== USDC && q !== USDT) || !isNum(sn.priceUsd)) continue;
        if (!best || (sn.liquidityUsd || 0) > (best.liquidityUsd || 0)) best = sn;
      }
      if (best && (!state.sol || state.sol.derived || r.fetchedAt >= state.sol.reqAt)) state.sol = { usd: best.priceUsd, at: best.fetchedAt, reqAt: r.fetchedAt, chg: best.chg, liq: best.liquidityUsd, derived: false };
    } catch (e) { noteApiError('dexSol', e); }
    finally { state.scanner.solBusy = false; }
  }
  async function crossCheck() {
    const now = env.now(), sc = state.scanner;
    const dexDown = ['OFFLINE', 'STALE'].includes(http.status('dexPairs'));
    if (!S().ffCrossCheck && !dexDown) return;
    if (now - sc.lastCross < (dexDown ? 8 : 12) * SEC) return;
    sc.lastCross = now;
    const pairs = [];
    const add = t => { const pa = (t.snap && t.snap.pairAddress) || (t.alt && t.alt.pairAddress); if (pa && !pairs.includes(pa) && pairs.length < 30) pairs.push(pa); };
    for (const id of pinnedIds()) { const t = state.markets.get(id); if (t) add(t); }
    [...state.markets.values()].filter(t => t.A).sort((a, b) => b.A.finalScore - a.A.finalScore).slice(0, 30).forEach(add);
    if (!pairs.length) return;
    try {
      const r = await http.request('gecko', `${GT_API}/networks/solana/pools/multi/${pairs.join(',')}`, { headers: GT_HEADERS, validate: gtValidator, keepRaw: S().rawApiLog });
      for (const it of r.data.data) { const sn = normGtPool(it, r.fetchedAt, state.dataQuality.geckoterminal); if (!sn) continue; const t = state.markets.get(sn.id); if (t) applyAlt(t, sn, r.fetchedAt); }
    } catch (e) { noteApiError('gecko', e); }
  }
  async function fetchOhlcv(id, tf = '1m', force = false) {
    const t = state.markets.get(id); if (!t) throw new Error('Token nicht im Scanner');
    const pair = (t.snap && t.snap.pairAddress) || (t.alt && t.alt.pairAddress);
    if (!pair) throw new Error('Keine Pool-Adresse bekannt – Chart nicht verfügbar');
    const agg = { '1m': 1, '5m': 5, '15m': 15 }[tf]; if (!agg) throw new Error('Ungültiger Timeframe');
    const r = await http.request('gecko', `${GT_API}/networks/solana/pools/${pair}/ohlcv/minute?aggregate=${agg}&limit=300&currency=usd`, {
      cacheMs: force ? 0 : 30 * SEC, noCache: force, headers: GT_HEADERS,
      validate: d => (d && d.data && d.data.attributes && Array.isArray(d.data.attributes.ohlcv_list) ? null : 'unerwartetes OHLCV-Schema')
    });
    const candles = normOhlcv(r.data, state.dataQuality.ohlcv);
    t.ohlcv[tf] = { candles, fetchedAt: r.fetchedAt, pair, cached: r.cached };
    return t.ohlcv[tf];
  }
  async function fetchCandlesForBacktest(id, tf) {
    const t = state.markets.get(id); if (!t) throw new Error('Token nicht im Scanner');
    const pair = (t.snap && t.snap.pairAddress) || (t.alt && t.alt.pairAddress);
    if (!pair) throw new Error('Keine Pool-Adresse bekannt');
    const agg = { '1m': 1, '5m': 5, '15m': 15 }[tf];
    const r = await http.request('gecko', `${GT_API}/networks/solana/pools/${pair}/ohlcv/minute?aggregate=${agg}&limit=1000&currency=usd`, { cacheMs: 60 * SEC, headers: GT_HEADERS, validate: d => (d && d.data && d.data.attributes && Array.isArray(d.data.attributes.ohlcv_list) ? null : 'unerwartetes OHLCV-Schema') });
    return { candles: normOhlcv(r.data), fetchedAt: r.fetchedAt, pair };
  }
  function ohlcvForPositions() {
    if (env.now() - state.scanner.lastOhlcv < 60 * SEC || !state.positions.length) return;
    state.scanner.lastOhlcv = env.now();
    for (const p of state.positions.slice(0, 3)) fetchOhlcv(p.tokenId, '1m').catch(e => noteApiError('gecko', e));
  }
  function rpcEndpoints() {
    return S().rpcUrls.split(',').map(x => safeUrl(x.trim())).filter(Boolean).slice(0, 4).map((url, i) => {
      const name = 'rpc' + i; const src = http.sources[name];
      if (src && src.cfg.url !== url) delete http.sources[name];
      if (!http.sources[name]) http.define(name, { label: 'RPC ' + (i + 1) + ' · ' + maskUrl(url).replace('https://', ''), limitPerMin: 60, staleMs: 2 * MIN, kind: 'rpc', url });
      return { name, url };
    });
  }
  const RANK = { ONLINE: 0, UNKNOWN: 1, DEGRADED: 2, STALE: 3, OFFLINE: 4 };
  function rankedRpc() {
    return rpcEndpoints().sort((a, b) => (RANK[http.status(a.name)] - RANK[http.status(b.name)]) || ((http.sources[a.name].latency || 9e9) - (http.sources[b.name].latency || 9e9)));
  }
  const rpcValidator = d => (!d || typeof d !== 'object' ? 'keine JSON-RPC-Antwort' : d.error ? 'RPC-Fehler: ' + str(d.error.message, 100) : !('result' in d) ? 'result fehlt' : null);
  async function rpcCall(method, params, o = {}) {
    const eps = rankedRpc(); if (!eps.length) throw httpError('NO_RPC', 'Keine gültige RPC-URL konfiguriert');
    let lastErr;
    for (const ep of eps.slice(0, o.single ? 1 : 2)) {
      try {
        const r = await http.request(ep.name, ep.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), cacheMs: o.cacheMs || 0, maskInLog: true, keepRaw: S().rawApiLog, validate: rpcValidator });
        return r.data.result;
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }
  async function rpcPing() {
    const now = env.now(); if (now - state.scanner.lastRpc < 10 * SEC) return;
    state.scanner.lastRpc = now;
    const eps = rankedRpc(); if (!eps.length) return;
    const all = now - state.scanner.lastRpcAll > 60 * SEC;
    if (all) state.scanner.lastRpcAll = now;
    const targets = all ? eps : eps.slice(0, 1);
    const res = await Promise.allSettled(targets.map(async ep => {
      const t0 = env.now();
      const r = await http.request(ep.name, ep.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: [{ commitment: 'confirmed' }] }), maskInLog: true, validate: d => (d && isNum(d.result) ? null : rpcValidator(d) || 'ungültiger Slot') });
      return { ep, slot: r.data.result, ms: env.now() - t0 };
    }));
    const ok = res.filter(x => x.status === 'fulfilled').map(x => x.value).sort((a, b) => RANK[http.status(a.ep.name)] - RANK[http.status(b.ep.name)]);
    if (ok.length) { const b = ok[0]; state.rpc.prevSlot = state.rpc.slot; state.rpc.slot = b.slot; state.rpc.slotAt = env.now(); state.rpc.latency = b.ms; state.rpc.endpoint = http.sources[b.ep.name].cfg.label; }
    res.forEach(x => { if (x.status === 'rejected') noteApiError('rpc', x.reason); });
  }
  function enqueueSecurity(t, prio, force) {
    if (t.secPending) return;
    if (!force && t.sec && env.now() - t.sec.checkedAt < S().securityTtlMin * MIN && (t.sec.sources.rpc || t.sec.sources.rug)) return;
    if (!force && t.secFailAt && env.now() - t.secFailAt < 2 * MIN) return;
    const q = state.secQueue.find(x => x.id === t.id);
    if (q) q.prio = Math.max(q.prio, prio); else state.secQueue.push({ id: t.id, prio });
    if (state.secQueue.length > 60) { state.secQueue.sort((a, b) => b.prio - a.prio); state.secQueue.length = 60; }
  }
  async function checkSecurity(mint) {
    const s = S(); let mintInfo = null, holders = null, rug = null;
    try { mintInfo = normMintAccount(await rpcCall('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }])); }
    catch (e) { noteApiError('rpc', e); }
    if (s.ffHolderAnalysis && mintInfo && mintInfo.exists && mintInfo.supply) {
      try { holders = normLargest(await rpcCall('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }], { single: true }), mintInfo.supply); }
      catch (e) { if (s.debugMode) log.debug('SECURITY', 'Holder-Daten nicht verfügbar: ' + e.message); }
    }
    if (s.ffRugcheck) {
      try { const r = await http.request('rugcheck', `${RUG_API}/tokens/${mint}/report/summary`, { cacheMs: 10 * MIN, keepRaw: s.rawApiLog, validate: d => (d && typeof d === 'object' && !Array.isArray(d) ? null : 'unerwartetes Schema') }); rug = normRug(r.data); }
      catch (e) { noteApiError('rugcheck', e); }
    }
    return buildSecurity(mintInfo, holders, rug, env.now());
  }
  async function processSecurity() {
    if (state.secBusy || !state.secQueue.length) return;
    state.secQueue.sort((a, b) => b.prio - a.prio);
    const item = state.secQueue.shift();
    const t = state.markets.get(item.id); if (!t) return;
    state.secBusy = true; t.secPending = true;
    try {
      const sec = await checkSecurity(t.mint);
      t.sec = sec;
      if (!sec.sources.rpc && !sec.sources.rug) t.secFailAt = env.now();
      log.sec(`Security ${t.symbol} (${shortAddr(t.mint)}): ${sec.status}`, { flags: sec.flags.map(f => f.code), sources: sec.sources });
      if (sec.status === 'CRITICAL') { alert('SECURITY', t, sec.flags.filter(f => f.level === 'CRITICAL').map(f => f.msg).join('; '), 'WARNING', { cooldownMs: DAY }); }
    } catch (e) { t.secFailAt = env.now(); log.warn('SECURITY', `Security-Check ${t.symbol} fehlgeschlagen: ${e.message}`); }
    finally { t.secPending = false; state.secBusy = false; }
  }

  /* ---------- Portfolio, Gebühren, Price Impact ---------- */
  function estImpact(size, liq) { return isNum(liq) && liq > 0 && isNum(size) && size >= 0 ? size / (liq / 2 + size) : null; }
  /* Priority Fee: fester Wert oder (Standard) automatisch aus den aktuellen Netzwerkgebühren – der feste Wert gilt dann als Minimum. */
  function prioLamportsNow() {
    const s = S(), fm = state.feeMarket;
    return s.priorityFeeMode === 'auto' && fm && env.now() - fm.at < 2 * MIN ? Math.max(s.priorityFeeLamports, fm.lamports) : s.priorityFeeLamports;
  }
  /* dexInRoute: bei einem echten Jupiter-Angebot steckt die DEX-Gebühr bereits im Kurs → nicht doppelt rechnen. */
  function estFees(sizeUsd, o = {}) {
    const sol = state.sol && state.sol.usd; if (!isNum(sol) || !isNum(sizeUsd)) return null;
    const s = S(), prio = isNum(o.prioLamports) ? o.prioLamports : prioLamportsNow();
    const network = BASE_FEE_LAMPORTS / 1e9 * sol, priority = prio / 1e9 * sol, dex = o.dexInRoute ? 0 : sizeUsd * s.dexFeePct / 100;
    return { network: m6(network), priority: m6(priority), dex: m6(dex), total: m6(network + priority + dex), solUsd: sol, lamports: BASE_FEE_LAMPORTS + prio, prioLamports: prio, dexInRoute: !!o.dexInRoute };
  }
  /* Aktuelle Priority Fees (Solana RPC getRecentPrioritizationFees, 75. Perzentil für den Pool des Coins) – max. alle 30 s je Pool. */
  async function updatePriorityFee(t) {
    if (S().priorityFeeMode !== 'auto') return null;
    const acct = (t && ((t.snap && t.snap.pairAddress) || (t.alt && t.alt.pairAddress))) || null, fm = state.feeMarket;
    if (fm && fm.acct === acct && env.now() - fm.at < 30 * SEC) return fm;
    if (state.feeMarketErrAt && env.now() - state.feeMarketErrAt < 10 * MIN) return fm; // RPC kann es nicht → 10 min Pause, fester Wert gilt
    try {
      const res = await rpcCall('getRecentPrioritizationFees', acct && isMint(acct) ? [[acct]] : [], { single: true });
      const vals = arr(res).map(x => x && x.prioritizationFee).filter(isNum);
      if (!vals.length) return fm;
      const micro = quantile(vals, 0.75);
      state.feeMarket = { at: env.now(), acct, microPerCu: Math.round(micro), lamports: Math.round(clamp(micro * SWAP_CU / 1e6, 0, PRIO_FEE_MAX_LAMPORTS)), n: vals.length };
      return state.feeMarket;
    } catch (e) { state.feeMarketErrAt = env.now(); log.warn('TRADE', 'Priority Fee nicht aus dem Netzwerk ermittelbar – fester Wert gilt (neuer Versuch in 10 min): ' + e.message); return fm; }
  }
  function equityInfo() {
    let exposure = 0, value = 0, unknown = 0;
    for (const p of state.positions) { exposure += p.costUsd; if (isNum(p.value)) value += p.value; else { value += p.costUsd; unknown++; } }
    const equity = state.portfolio.cash + value;
    return { equity, cash: state.portfolio.cash, exposure, value, unknown, exposurePct: equity > 0 ? exposure / equity * 100 : 0, estimated: unknown > 0 };
  }
  function valuePosition(pos, p, liq) {
    if (pos.noRouteSince) return { net: 0, impactPct: 100, noRoute: true }; // kein Verkaufsweg → aktuell nichts wert
    const gross = pos.qty * p; const imp = estImpact(gross, liq); const fees = estFees(gross);
    if (imp == null || !fees) return { net: null, impactPct: imp != null ? imp * 100 : null };
    return { net: gross * (1 - imp) - fees.total, impactPct: imp * 100, fees };
  }
  let healthCache = { at: -1, val: null };
  function systemHealth() {
    const now = env.now();
    if (healthCache.val && now - healthCache.at < 500) return healthCache.val;
    let val;
    if (!env.online()) val = { score: 0, parts: { offline: true } };
    else {
      const conf = n => SOURCE_STATUS_CONF[http.status(n)];
      const rpcs = rpcEndpoints().map(e => conf(e.name));
      const toks = [...state.markets.values()].filter(t => t.snap);
      const freshShare = toks.length ? toks.filter(t => now - t.snap.fetchedAt <= S().staleAfterSec * SEC).length / toks.length : 0;
      const crit = ['dexPairs', ...rpcEndpoints().map(e => e.name)].map(n => http.snapshot(n)).filter(x => x && x.total > 0);
      const dexErr = (http.snapshot('dexPairs') || {}).errorRate;
      const rpcErr = crit.filter(x => x.kind === 'rpc').map(x => x.errorRate || 0);
      const errRate = dexErr == null && !rpcErr.length ? null : Math.max(dexErr || 0, rpcErr.length ? Math.min(...rpcErr) : 0);
      const parts = { dexPairs: conf('dexPairs'), rpc: rpcs.length ? Math.max(...rpcs) : 0, freshness: Math.round(freshShare * 100), errors: errRate == null ? 50 : Math.round(100 - errRate * 100) };
      const w = { dexPairs: 0.4, rpc: 0.15, freshness: 0.3, errors: 0.15 };
      let tot = 0, ws = 0; for (const [k, wt] of Object.entries(w)) if (parts[k] != null) { tot += parts[k] * wt; ws += wt; }
      val = { score: Math.round(tot / ws), parts };
    }
    healthCache = { at: now, val };
    return val;
  }
  function bucketSeries(hist, now, span = 30 * MIN, step = 30 * SEC) {
    const n = Math.floor(span / step), out = new Array(n).fill(null);
    for (const h of hist) { const i = Math.floor((h.t - (now - span)) / step); if (i >= 0 && i < n) out[i] = h.p; }
    for (let i = 1; i < n; i++) if (out[i] == null) out[i] = out[i - 1];
    return out;
  }
  function corrBetween(ta, tb, now) {
    const a = bucketSeries(ta.hist, now), b = bucketSeries(tb.hist, now); const ra = [], rb = [];
    for (let i = 1; i < a.length; i++) if (a[i] && a[i - 1] && b[i] && b[i - 1]) { ra.push(Math.log(a[i] / a[i - 1])); rb.push(Math.log(b[i] / b[i - 1])); }
    return pearson(ra, rb);
  }
  function maxCorrelation(t) {
    const now = env.now(); let best = null;
    for (const p of state.positions) {
      if (p.tokenId === t.id) continue;
      const pt = state.markets.get(p.tokenId); if (!pt) continue;
      const r = corrBetween(t, pt, now);
      if (r != null && (!best || r > best.r)) best = { r, sym: p.symbol };
    }
    return best;
  }
  function positionCorrelations() {
    const now = env.now(), out = [];
    for (let i = 0; i < state.positions.length; i++) for (let j = i + 1; j < state.positions.length; j++) {
      const a = state.markets.get(state.positions[i].tokenId), b = state.markets.get(state.positions[j].tokenId);
      if (!a || !b) continue;
      out.push({ a: state.positions[i].symbol, b: state.positions[j].symbol, r: corrBetween(a, b, now) });
    }
    return out;
  }

  /* ---------- Position Sizing ---------- */
  function drawdownPct() {
    const eq = equityInfo().equity, pf = state.portfolio, peak = Math.max(pf.peakEquity || 0, eq || 0);
    return peak > 0 && isNum(eq) ? Math.max(0, (peak - eq) / peak * 100) : 0;
  }
  /* Anteil des erlaubten Exposures, der bereits in Positionen derselben Strategie steckt (Cluster-Konzentration). */
  function clusterShare(leadId, eq) {
    if (!leadId || !(eq > 0)) return 0;
    const same = sum(state.positions.filter(p => p.strategy === leadId).map(p => p.costUsd || 0));
    return same / Math.max(1e-9, eq * S().maxExposurePct / 100);
  }
  function sizePosition(t, A, leadId, manualSize) {
    const s = S(), eqi = equityInfo(), eq = eqi.equity;
    if (!isNum(eq) || eq <= 0) return { size: 0, reason: 'Kein Kapital verfügbar' };
    if (!A) return { size: 0, reason: 'Keine Analyse vorhanden' };
    const maxPos = eq * s.maxPositionPct / 100;
    if (manualSize != null) {
      if (!isNum(manualSize) || manualSize <= 0) return { size: 0, reason: 'Ungültiger Betrag' };
      if (manualSize < MIN_ORDER_USD) return { size: 0, reason: `Betrag < Minimum ${fmtUsd(MIN_ORDER_USD)}` };
      if (manualSize > maxPos + 1e-9) return { size: 0, reason: `Betrag über max. Positionsgröße (${fmtUsd(maxPos)})` };
      return { size: m2(manualSize), manual: true, capBy: 'manuell', factors: {} };
    }
    if (A.confidence.total < s.minConfidence) return { size: 0, reason: `Datenqualität unzureichend (Confidence ${A.confidence.total}) → Position Size 0` };
    const cfg = leadId && state.strategies[leadId];
    const basePct = Math.min(cfg ? cfg.positionSizePct : s.maxPositionPct / 2, s.maxPositionPct);
    const fRisk = clamp(1.2 - A.risk.total / 100, 0.2, 1), fConf = clamp((A.confidence.total - 40) / 60, 0, 1);
    const fVol = A.price.volPct != null ? clamp(1 - Math.max(0, A.price.volPct - 5) / 30, 0.3, 1) : 0.6;
    const liq = A.liq.usd, mi = s.maxSlippagePct / 2 / 100;
    // Risiko-Abschläge mit Reason Codes (können die Größe nur verkleinern)
    const adj = [], dd = drawdownPct();
    if (s.ddReducePct > 0 && dd >= s.ddReducePct) adj.push({ code: 'DRAWDOWN_MODE', f: 0.5, text: `Drawdown ${dd.toFixed(1)} % ≥ ${s.ddReducePct} % → Größe ×0,5` });
    if (isNum(A.dataAge) && A.dataAge > s.staleAfterSec * SEC * 0.5) adj.push({ code: 'DATA_AGE', f: 0.7, text: `Daten ${fmtAge(A.dataAge)} alt → Größe ×0,7` });
    if (A.liq.impactPlanned != null && A.liq.impactPlanned > s.maxSlippagePct / 2) adj.push({ code: 'EXECUTION_UNCERTAINTY', f: 0.6, text: `erwarteter Price Impact ${A.liq.impactPlanned.toFixed(2)} % → Größe ×0,6` });
    if (!A.crossChecked) adj.push({ code: 'UNCONFIRMED_DATA', f: 0.85, text: 'nicht von zweiter Quelle bestätigt → Größe ×0,85' });
    const deg = anomalyActive('DEGRADE'); if (deg) adj.push({ code: 'ANOMALY_DEGRADE', f: 0.5, text: `Anomalie ${deg.code}: ${deg.msg} → Größe ×0,5` });
    const cl = clusterShare(leadId, eq); if (cl >= 0.5) adj.push({ code: 'CLUSTER_EXPOSURE', f: 0.7, text: `${Math.round(cl * 100)} % des erlaubten Exposures bereits in Strategie ${leadId} → Größe ×0,7` });
    const fAdj = adj.reduce((m, a) => m * a.f, 1);
    const caps = {
      Strategie: eq * basePct / 100 * fRisk * fConf * fVol * fAdj,
      Liquidität: isNum(liq) && liq > 0 ? mi * (liq / 2) / (1 - mi) : 0,
      Exposure: Math.max(0, eq * s.maxExposurePct / 100 - eqi.exposure),
      'Max. Position': maxPos,
      Cash: Math.max(0, state.portfolio.cash * 0.98)
    };
    const capBy = Object.entries(caps).sort((a, b) => a[1] - b[1])[0];
    const size = Math.max(0, capBy[1]);
    const factors = { basePct, fRisk: m2(fRisk), fConf: m2(fConf), fVol: m2(fVol), fAdj: m2(fAdj), adj, caps: Object.fromEntries(Object.entries(caps).map(([k, v]) => [k, m2(v)])) };
    if (size < MIN_ORDER_USD) return { size: 0, reason: `Größe ${fmtUsd(size)} < Minimum ${fmtUsd(MIN_ORDER_USD)} (begrenzt durch ${capBy[0]})`, factors, capBy: capBy[0] };
    return { size: m2(size), capBy: capBy[0], factors };
  }

  /* ---------- Execution Check (harte Regeln, Portfolio, Limits, Cooldowns) ---------- */
  function closedTradesRecent(n) { return state.journal.filter(j => j.status === 'CLOSED').slice(0, n); }
  function globalBlockers({ auto, ownOrder = null } = {}) {
    const B = []; const add = (c, m) => B.push(mkBlocker(c, m));
    const b = state.bot, s = S(), now = env.now(), r = state.risk;
    if (b.emergency) add('EMERGENCY_STOP', 'Emergency Stop aktiv' + (b.emergencyReason ? ': ' + b.emergencyReason : ''));
    if (state.mode === 'LIVE') add('LIVE_UNAVAILABLE', 'LIVE: kein verifizierter Wallet-/Swap-Provider (REQUIRES EXTERNAL PROVIDER)');
    if (state.mode === 'READ_ONLY') add('MODE_READ_ONLY', 'READ ONLY / WATCH-ONLY: Trades immer blockiert');
    if (b.safeMode) add('SAFE_MODE', 'Safe Mode: keine neuen Käufe' + (b.safeAuto ? ' (automatisch nach Fehlern aktiviert)' : ''));
    if (auto) {
      if (!b.autoTrading) add('AUTO_TRADING_OFF', 'Auto-Trading ist AUS (Bot analysiert nur)');
      if (state.mode === 'PAPER') add('PAPER_MANUAL', 'PAPER-Modus: nur manuelle Trades');
      if (b.state === 'RECOVERING' || b.state === 'STARTING') add('RECOVERING', 'Recovery – warte auf ausreichende Datenqualität');
      else if (b.state !== 'RUNNING') add('BOT_NOT_RUNNING', 'Bot-Status: ' + b.state);
    }
    if (!env.online()) add('OFFLINE', 'Keine Netzwerkverbindung');
    const h = systemHealth(); if (h.score < s.minSystemHealth) add('SYSTEM_UNHEALTHY', `System Health ${h.score} < ${s.minSystemHealth}`);
    if (!state.sol || now - state.sol.at > 5 * MIN) add('FEE_UNKNOWN', 'SOL-Preis unbekannt/veraltet → Gebühren nicht berechenbar');
    if (state.reconciliation.required) add('RECONCILIATION_REQUIRED', 'Abgleich nach Neustart erforderlich – bitte prüfen & bestätigen');
    const rpcSt = rpcEndpoints().map(e => http.status(e.name));
    if (rpcSt.length && rpcSt.every(x => x === 'OFFLINE') && (!s.ffRugcheck || http.status('rugcheck') === 'OFFLINE')) add('SECURITY_SOURCES_DOWN', 'Alle Security-Quellen (RPC' + (s.ffRugcheck ? ', RugCheck' : '') + ') OFFLINE');
    if (r.dailyLimitHit && s.dailyLossLimitPct > 0) add('DAILY_LOSS_LIMIT', `Tagesverlust-Limit erreicht (${fmtSigned(r.dailyPnl)})`);
    if (auto && s.ddStopPct > 0) { const dd = drawdownPct(); if (dd >= s.ddStopPct) add('DRAWDOWN_LIMIT', `Drawdown ${dd.toFixed(1)} % ≥ ${s.ddStopPct} % – keine neuen Auto-Käufe`); }
    if (auto) { const an = anomalyActive('PAUSE'); if (an) add('ANOMALY_PAUSE', `Anomalie ${an.code}: ${an.msg}`); }
    if (auto && s.lowQualityMarketBlock && arr(state.regime.tags).includes('LOW_QUALITY_MARKET')) add('LOW_QUALITY_MARKET', `${Math.round((state.regime.lowQ || 0) * 100)} % der Tokens mit veralteten/unsicheren Daten – No-Trade-Zone`);
    // Pause/Cooldown nur, solange sie eingestellt sind – auf 0 gestellt endet eine laufende Pause sofort
    if (s.globalPauseMin > 0 && r.globalPauseUntil > now) add('GLOBAL_PAUSE', `Globale Pause nach Verlustserie – noch ${fmtAge(r.globalPauseUntil - now)}`);
    if (s.lossCooldownMin > 0 && r.lossCooldownUntil > now) add('LOSS_COOLDOWN', `Loss-Cooldown – noch ${fmtAge(r.lossCooldownUntil - now)}`);
    const hourBuys = r.buyTimes.filter(x => now - x < HOUR).length;
    if (s.maxTradesPerHour <= 0) { /* Overtrading-Limit und -Bremse aus */ }
    else if (hourBuys >= s.maxTradesPerHour) add('OVERTRADING', `${hourBuys} Käufe in 60 min (Limit ${s.maxTradesPerHour})`);
    else {
      const last = closedTradesRecent(5);
      if (last.length === 5 && now - last[0].closedAt < 30 * MIN && avg(last.map(j => j.holdMs || 0)) < 2 * MIN) add('OVERTRADING', 'Sehr kurze Haltezeiten der letzten 5 Trades – Throttle');
      else if (last.length === 5 && avg(last.map(j => j.sizeUsd > 0 ? (j.slippageUsd || 0) / j.sizeUsd * 100 : 0)) > s.maxSlippagePct * 0.8) add('OVERTRADING', 'Hohe durchschnittliche Slippage – Throttle');
    }
    const active = state.orders.filter(o => !TERMINAL.has(o.state) && o.id !== ownOrder).length;
    if (active >= s.maxActiveOrders) add('MAX_ACTIVE_ORDERS', `${active} aktive Order(s)`);
    return B;
  }
  function execCheck(t, A, o = {}) {
    const { auto = false, preTrade = false, sizeUsd = null, ownOrder = null, lead = null, fromQueue = false } = o;
    const B = globalBlockers({ auto, ownOrder });
    const add = (c, m) => B.push(mkBlocker(c, m));
    const s = S(), now = env.now(), r = state.risk;
    const pos = openPos(t.id);
    const maxBuys = s.maxBuysPerCoin; // 0 = unbegrenzt
    const bc = r.buyCount[t.id] || 0;
    if (maxBuys > 0 && bc >= maxBuys) add('BUY_LIMIT_REACHED', `Buy #${bc + 1} blockiert – max. ${maxBuys} Käufe pro Coin`);
    if (!pos && s.maxOpenPositions > 0 && state.positions.length >= s.maxOpenPositions) add('MAX_POSITIONS', `${state.positions.length}/${s.maxOpenPositions} Positionen offen`);
    if (pos && s.addOnlyInProfit) {
      const pnl = isNum(pos.lastPrice) && isNum(pos.entryPrice) && pos.priceLabel !== 'STALE' ? (pos.lastPrice / pos.entryPrice - 1) * 100 : null;
      if (pnl == null || pnl < PYRAMID_MIN_PNL_PCT) add('NO_AVERAGING_DOWN', pnl == null ? 'Kein aktueller Positionspreis – kein Nachkauf' : `Nachkauf nur ab +${PYRAMID_MIN_PNL_PCT} % (aktuell ${fmtPct(pnl)}) – kein Martingale/DCA`);
    }
    if (s.sellCooldownMin > 0 && (r.coinCooldown[t.id] || 0) > now) add('COOLDOWN_ACTIVE', `Coin-Cooldown noch ${fmtAge(r.coinCooldown[t.id] - now)}`);
    if (auto && s.strategyCooldowns && (r.stratCooldown[t.id] || 0) > now) add('STRATEGY_COOLDOWN', `Strategie-Cooldown noch ${fmtAge(r.stratCooldown[t.id] - now)}`);
    if (!ownOrder && (state.locks.has(t.id) || (!fromQueue && state.queue.some(q => q.tokenId === t.id)))) add('TRADE_LOCKED', 'Laufende/eingereihte Order für diesen Token');
    const es = effectiveSnap(t, now, s);
    if (preTrade) {
      if (!es.snap || !isNum(es.snap.priceUsd)) add('PRICE_MISSING', 'Pre-Trade: kein gültiger Preis');
      else if (es.fallback) add('DATA_FALLBACK', 'Pre-Trade: nur Fallback-Quelle aktuell');
      else if (es.age > s.snapshotMaxAgeSec * SEC) add('DATA_STALE', `Pre-Trade: Daten ${fmtAge(es.age)} alt (max. ${s.snapshotMaxAgeSec}s)`);
    }
    if (!pos && state.positions.length && s.correlationLimit > 0) { const c = maxCorrelation(t); if (c && c.r >= s.correlationLimit) add('CONCENTRATION', `Korrelation ${c.r.toFixed(2)} mit offener Position ${c.sym}`); }
    const sizing = sizePosition(t, A, lead, sizeUsd);
    // Befund des letzten echten Angebots (Stufe B) – verhindert wiederholte Abfragen; Preisabweichung nur bei ähnlicher oder größerer Ordergröße
    const qc = t.quoteCheck;
    if (qc && now - qc.at < QUOTE_CHECK_TTL) {
      if (qc.noBuyRoute) add('NO_ROUTE', `Kein Handelsweg über Jupiter (${str(qc.msg || '—', 80)})`);
      for (const b of quoteBlockers({ ...qc, impactPct: isNum(qc.sizeUsd) && sizing.size >= qc.sizeUsd * 0.9 ? qc.impactPct : null }, s)) B.push(b);
    }
    if (!(sizing.size > 0)) add('SIZE_ZERO', sizing.reason || 'Positionsgröße 0');
    else {
      const eq = equityInfo();
      if (eq.exposure + sizing.size > eq.equity * s.maxExposurePct / 100 + 1e-6) add('EXPOSURE_LIMIT', `Exposure ${fmtUsd(eq.exposure + sizing.size)} > ${s.maxExposurePct} % von ${fmtUsd(eq.equity)}`);
      if (sizing.size > state.portfolio.cash + 1e-9) add('INSUFFICIENT_CASH', `Cash ${fmtUsd(state.portfolio.cash)} < ${fmtUsd(sizing.size)}`);
      const imp = estImpact(sizing.size, es.snap ? es.snap.liquidityUsd : null);
      sizing.impactPct = imp != null ? imp * 100 : null;
      sizing.fees = estFees(sizing.size);
      if (imp == null) add('SLIPPAGE_TOO_HIGH', 'Price Impact nicht schätzbar (Liquidität unbekannt)');
      else if (imp * 100 > s.maxSlippagePct) add('SLIPPAGE_TOO_HIGH', `Erw. Price Impact ${(imp * 100).toFixed(2)} % > ${s.maxSlippagePct} %`);
    }
    return { blockers: sortBlockers(B), sizing };
  }

  /* ---------- Orders (State Machine, Idempotenz) ---------- */
  function newOrder(t, side, meta) {
    const now = env.now();
    return {
      id: 'ORD-' + now.toString(36).toUpperCase() + '-' + (++seqs.order).toString(36).toUpperCase(), key: meta.key, tokenId: t.id, mint: t.mint, symbol: t.symbol, side, mode: state.mode,
      auto: !!meta.auto, reason: str(meta.reason || '', 300), strategy: meta.strategy || null, buyNo: meta.buyNo || null, positionId: meta.positionId || null,
      state: 'DETECTED', history: [{ s: 'DETECTED', ts: now, note: meta.auto ? 'Bot-Kandidat' : 'Manuelle Aktion' }], createdAt: now,
      sizeUsd: null, qty: null, estPrice: null, fillPrice: null, expSlipPct: null, estFees: null, fees: null, txSig: null, simulated: true, latencyMs: null, blockers: null, decision: null
    };
  }
  function transition(o, to, note) {
    if (!(ORDER_TRANSITIONS[o.state] || []).includes(to)) throw new Error(`Ungültiger Order-Übergang ${o.state} → ${to}`);
    o.state = to; o.history.push({ s: to, ts: env.now(), note: note ? String(note).slice(0, 200) : undefined });
    if (S().debugMode) log.debug('TRADE', `${o.id} ${o.side} ${o.symbol}: ${to}${note ? ' – ' + note : ''}`);
  }
  function trimOrders() { if (state.orders.length > 300) state.orders = state.orders.filter((o, i) => i < 200 || !TERMINAL.has(o.state)); }
  function immutableDecision(t, A, D, ex, blockers) {
    return deepClone({
      ts: env.now(), tokenId: t.id, snapshot: t.snap ? { ...t.snap, links: undefined } : null, security: t.sec ? { status: t.sec.status, mintAuthority: t.sec.mintAuthority, freezeAuthority: t.sec.freezeAuthority, top10Pct: t.sec.top10Pct, flags: t.sec.flags, checkedAt: t.sec.checkedAt } : null,
      score: A.finalScore, opportunity: A.opportunity, confidence: A.confidence, risk: A.risk, components: A.components, signals: A.signals, tags: A.tags, pump: A.pump,
      strategies: A.strat ? A.strat.votes : null, trace: D.trace, blockers, sizing: ex.sizing, decision: blockers.length ? 'REJECTED' : 'APPROVED', reason: D.reason, dataQuality: A.labels, regime: state.regime.tags, sol: state.sol ? state.sol.usd : null,
      features: buildEntryFeatures(t, A, D, state.regime.tags, env.now()) // Feature-Snapshot zum Entscheidungszeitpunkt (Lern-KI)
    });
  }
  function recordRejection(blockers) {
    state.metrics.counters.rejected++;
    const c = blockers[0] && blockers[0].code; if (c) state.metrics.preTradeRejects[c] = (state.metrics.preTradeRejects[c] || 0) + 1;
  }
  function stratStat(id, field) { if (!id) return; const st = state.stratStats[id] || (state.stratStats[id] = { signals: 0, accepted: 0, rejected: 0, executed: 0, profitable: 0, unprofitable: 0 }); st[field] = (st[field] || 0) + 1; }
  function sourcesUsed(t) { const s = []; if (t.snap) s.push('DexScreener'); if (t.alt) s.push('GeckoTerminal'); if (t.sec && t.sec.sources.rpc) s.push('Solana RPC'); if (t.sec && t.sec.sources.rug) s.push('RugCheck'); return s; }

  /* ---------- Positions-Lebenszyklus ---------- */
  function posTransition(pos, to, note) {
    const from = pos.lc || 'OPEN';
    if (from === to) return true;
    if (!(POSITION_TRANSITIONS[from] || []).includes(to)) { log.warn('TRADE', `Ungültiger Positions-Übergang ${from} → ${to} (${pos.symbol}) ignoriert`); return false; }
    pos.lc = to;
    const h = pos.lcHistory || (pos.lcHistory = []);
    h.push({ s: to, ts: env.now(), note: note ? str(String(note), 140) : undefined }); if (h.length > 30) h.splice(0, h.length - 30);
    return true;
  }
  const lcBack = pos => (pos.exits.length ? 'PARTIAL' : 'OPEN');
  /* ---------- Echte Kursangebote (B1): Jupiter Quote API – reine Abfrage, nie Swap, nie Signatur ---------- */
  const jupValidator = d => (d && typeof d === 'object' && !Array.isArray(d) ? null : 'unerwartetes Schema');
  const sleep = ms => new Promise(r => env.setTimeout(r, ms));
  const lamportsOfUsd = usd => { const sol = state.sol && state.sol.usd; return isNum(sol) && sol > 0 && isNum(usd) && usd > 0 ? Math.floor(usd / sol * 1e9) : 0; };
  const usdOfLamports = l => { const sol = state.sol && state.sol.usd; return isNum(sol) ? Number(l) / 1e9 * sol : null; };
  function rawOfQty(qty, dec) { const x = Math.floor(qty * Math.pow(10, dec)); return Number.isFinite(x) && x > 0 ? BigInt(x).toString() : null; }
  /* Decimals aus dem Angebot ableiten, falls die Mint-Daten (RPC) fehlen: Rohmenge × Preis ÷ Einsatz ≈ 10^Decimals. */
  function inferDecimals(rawOut, usdIn, priceUsd) {
    const x = Number(rawOut); if (!(x > 0) || !(usdIn > 0) || !(priceUsd > 0)) return null;
    const e = Math.log10(x * priceUsd / usdIn), d = Math.round(e);
    return d >= 0 && d <= 18 && Math.abs(e - d) < 0.3 ? d : null;
  }
  const tokenDecimals = (t, pos) => (pos && isNum(pos.decimals) ? pos.decimals : t && t.sec && isNum(t.sec.decimals) ? t.sec.decimals : null);
  const slipBps = () => Math.round(clamp(S().maxSlippagePct, 0.1, 50) * 100);
  async function jupQuote(inputMint, outputMint, amountRaw, bps) {
    const key = String(S().jupApiKey || '').trim();
    const url = `${key ? JUP_API_KEYED : JUP_API_FREE}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}&slippageBps=${bps}`;
    let r;
    try { r = await http.request('jupiter', url, { headers: key ? { 'x-api-key': key } : undefined, okStatuses: [400, 422], validate: jupValidator, keepRaw: S().rawApiLog }); }
    catch (e) { return { ok: false, noRoute: false, code: e.code || 'NETWORK', msg: e.message }; }
    const d = r.data, code = String(d.errorCode || d.error_code || ''), out = /^\d+$/.test(String(d.outAmount || '')) ? String(d.outAmount) : null;
    if (r.status !== 200 || !out || out === '0') {
      const msg = str(String(d.error || d.message || (out === '0' ? 'Angebot ohne Gegenwert' : 'kein Angebot')), 120);
      return { ok: false, noRoute: out === '0' || (r.status !== 200 && (JUP_NO_ROUTE.has(code) || /route|tradable/i.test(msg))), code: code || 'NO_QUOTE', msg };
    }
    const labels = [...new Set(arr(d.routePlan).map(x => x && x.swapInfo && x.swapInfo.label).filter(Boolean).map(x => str(String(x), 24)))].slice(0, 3);
    return { ok: true, outAmount: out, minOut: /^\d+$/.test(String(d.otherAmountThreshold || '')) ? String(d.otherAmountThreshold) : null, labels, at: r.fetchedAt };
  }
  /* Kauf: SOL → Coin. Dazu (optional) die Rundreise: dieselbe Menge sofort zurück in SOL → Honeypot (kein Verkaufsweg) und Rundreise-Kosten. */
  async function jupBuyQuote(req, price) {
    const fees = estFees(req.sizeUsd, { dexInRoute: true });
    if (!fees) return { ok: false, code: 'QUOTE_FAILED', msg: 'Gebühren unbekannt (SOL-Preis fehlt)' };
    const lam = lamportsOfUsd(req.sizeUsd - fees.total), spent = usdOfLamports(lam), bps = slipBps();
    if (!(lam > 0)) return { ok: false, code: 'QUOTE_FAILED', msg: 'Betrag nach Gebühren ≤ 0' };
    const bq = await jupQuote(WSOL, req.mint, lam, bps);
    if (!bq.ok) return { ok: false, noRoute: bq.noRoute, code: bq.noRoute ? 'NO_ROUTE' : 'QUOTE_FAILED', msg: 'Jupiter (Kauf): ' + bq.msg };
    const dec = isNum(req.decimals) ? req.decimals : inferDecimals(bq.outAmount, spent, price);
    const qty = isNum(dec) ? rawToUi(bq.outAmount, dec) : null;
    if (!(qty > 0)) return { ok: false, code: 'QUOTE_FAILED', msg: 'Jupiter (Kauf): Token-Decimals unbekannt' };
    const fillPrice = spent / qty;
    const out = { ok: true, side: 'BUY', source: 'JUPITER', refPrice: price, impact: fillPrice / price - 1, fees, fillPrice, qty, rawOut: bq.outAmount, decimals: dec, bps, route: 'Jupiter: ' + (bq.labels.join(' → ') || 'Route'), quotedAt: bq.at, roundTripPct: null, noSellRoute: false, sellErr: null };
    if (req.roundTrip) {
      const sq = await jupQuote(req.mint, WSOL, bq.outAmount, bps);
      if (sq.ok) { const back = usdOfLamports(sq.outAmount); out.roundTripPct = lr2((1 - (back - fees.network - fees.priority) / req.sizeUsd) * 100); }
      else if (sq.noRoute) { out.noSellRoute = true; out.sellErr = sq.msg; }
      else out.sellErr = sq.msg; // Netzwerk/Rate-Limit: kein Urteil (weder Honeypot noch unbedenklich)
    }
    return out;
  }
  async function jupSellQuote(req, price) {
    const raw = isNum(req.decimals) ? rawOfQty(req.qty, req.decimals) : null;
    if (!raw) return { ok: false, code: 'QUOTE_FAILED', msg: 'Jupiter (Verkauf): Token-Decimals unbekannt' };
    const bps = slipBps(), sq = await jupQuote(req.mint, WSOL, raw, bps);
    if (!sq.ok) return { ok: false, noRoute: sq.noRoute, code: sq.noRoute ? 'NO_ROUTE' : 'QUOTE_FAILED', msg: 'Jupiter (Verkauf): ' + sq.msg };
    const proceeds = usdOfLamports(sq.outAmount), fees = estFees(proceeds, { dexInRoute: true });
    if (!fees || !isNum(proceeds)) return { ok: false, code: 'QUOTE_FAILED', msg: 'Gebühren unbekannt (SOL-Preis fehlt)' };
    const fillPrice = proceeds / req.qty;
    return { ok: true, side: 'SELL', source: 'JUPITER', refPrice: price, impact: 1 - fillPrice / price, impactEstimated: false, fees, fillPrice, qty: req.qty, proceeds, net: proceeds - fees.total, decimals: req.decimals, bps, route: 'Jupiter: ' + (sq.labels.join(' → ') || 'Route'), quotedAt: sq.at };
  }
  /* Rückfall ohne Jupiter: Live-Preis + geschätzter Price Impact (AMM-Formel) + Gebühren – als geschätzt markiert. */
  function ammQuote(req, price, liq) {
    if (req.side === 'BUY') {
      const impact = estImpact(req.sizeUsd, liq), fees = estFees(req.sizeUsd);
      if (impact == null || !fees) return { ok: false, code: 'QUOTE_FAILED', msg: impact == null ? 'Price Impact nicht schätzbar' : 'Gebühren unbekannt' };
      const fillPrice = price * (1 + impact);
      return { ok: true, side: 'BUY', source: 'AMM', refPrice: price, impact, fees, fillPrice, qty: (req.sizeUsd - fees.total) / fillPrice, bps: slipBps(), route: 'SIMULIERT (AMM-Schätzung)', fallbackReason: req.fallbackReason || null };
    }
    let imp = estImpact(req.qty * price, liq); const impEst = imp == null;
    if (imp == null) imp = S().maxSlippagePct / 100;
    const fillPrice = price * (1 - imp), proceeds = req.qty * fillPrice, fees = estFees(proceeds);
    if (!fees) return { ok: false, code: 'QUOTE_FAILED', msg: 'Gebühren unbekannt' };
    return { ok: true, side: 'SELL', source: 'AMM', refPrice: price, impact: imp, impactEstimated: impEst, fees, fillPrice, qty: req.qty, proceeds, net: proceeds - fees.total, bps: slipBps(), route: 'SIMULIERT (AMM-Schätzung)', fallbackReason: req.fallbackReason || null };
  }
  /* Befund aus dem Kaufangebot → Blocker (gilt QUOTE_CHECK_TTL lang auch für Analyse/Auto-Käufe dieses Coins). */
  function quoteBlockers(qc, s) {
    const out = []; if (!qc) return out;
    if (qc.priceConflict) out.push(mkBlocker('PRICE_CONFLICT', `Jupiter-Kurs ${isNum(qc.impactPct) ? Math.abs(qc.impactPct).toFixed(0) + ' % ' : ''}unter DexScreener – Kursquellen widersprechen sich (Rug oder veralteter Kurs)`));
    if (qc.noSellRoute && s.honeypotBlock) out.push(mkBlocker('NO_SELL_ROUTE', `Kein Verkaufsweg über Jupiter (${str(qc.sellErr || '—', 80)}) – Honeypot-Verdacht`));
    if (s.maxRoundTripLossPct > 0 && isNum(qc.roundTripPct) && qc.roundTripPct > s.maxRoundTripLossPct) out.push(mkBlocker('ROUND_TRIP_COST', `Kauf + sofortiger Verkauf kostet ${qc.roundTripPct.toFixed(1)} % > ${s.maxRoundTripLossPct} %`));
    if (qc.source === 'JUPITER' && isNum(qc.impactPct) && qc.impactPct > s.maxSlippagePct) out.push(mkBlocker('SLIPPAGE_TOO_HIGH', `Echtes Angebot: Kurs ${qc.impactPct.toFixed(2)} % über Marktpreis > ${s.maxSlippagePct} %`));
    return out;
  }
  /* Ausführungsbedingungen wie on-chain: Wartezeit bis zur Bestätigung, Füllung zum dann gültigen Angebot,
     Slippage-Grenze (sonst scheitert die Transaktion) und ein Anteil gescheiterter Transaktionen. Gebühren fallen auch beim Scheitern an. */
  async function simConfirm(q, ctx) {
    const s = S(), t0 = env.now();
    let q2 = q, latencyApplied = false;
    if (s.simLatencyMs > 0) {
      await sleep(s.simLatencyMs);
      if (ctx && ctx.requote) {
        const r = await ctx.requote(q.source);
        if (r && r.ok) { q2 = r; latencyApplied = true; }
        else if (r && r.noRoute) return { ok: false, code: 'NO_ROUTE', msg: 'Nach der Wartezeit kein Handelsweg mehr: ' + str(r.msg || '', 80), feeLoss: true };
      }
    }
    const tol = q.bps / 1e4;
    if (q.side === 'BUY' ? q2.qty < q.qty * (1 - tol) : q2.proceeds < q.proceeds * (1 - tol)) {
      const dev = q.side === 'BUY' ? (1 - q2.qty / q.qty) * 100 : (1 - q2.proceeds / q.proceeds) * 100;
      return { ok: false, code: 'SLIPPAGE_EXCEEDED', msg: `${EXEC_FAIL.SLIPPAGE_EXCEEDED} (${dev.toFixed(2)} % > ${(tol * 100).toFixed(2)} %)`, feeLoss: true };
    }
    if (s.simTxFailPct > 0 && env.random() * 100 < s.simTxFailPct) return { ok: false, code: 'TX_FAILED', msg: EXEC_FAIL.TX_FAILED, feeLoss: true };
    return { ok: true, fillPrice: q2.fillPrice, q: q2, latencyApplied, waitMs: env.now() - t0 };
  }
  /* ---------- Execution-Provider: Quote → Build → Preflight → Sign → Send → Confirm ----------
     SIMULATION: echtes Jupiter-Angebot (sonst AMM-Schätzung), Wartezeit, Slippage-Grenze, gescheiterte Transaktionen – keine Transaktion.
     LIVE ist nicht angebunden: jeder Schritt liefert NO_ROUTER / SIGNATURE_DISABLED – es wird nie etwas signiert oder gesendet. */
  const simProvider = {
    id: 'SIMULATION', available: true,
    async quote(req) {
      const s = S(), snap = req.snap, price = snap && snap.priceUsd, liq = snap && snap.liquidityUsd;
      if (!isNum(price) || price <= 0) return { ok: false, code: 'QUOTE_FAILED', msg: 'kein gültiger Coin-Preis' };
      if (s.realQuotes && req.mint && req.source !== 'AMM') {
        const jq = req.side === 'BUY' ? await jupBuyQuote(req, price) : await jupSellQuote(req, price);
        if (jq.ok || jq.noRoute || !s.quoteFallback || req.source === 'JUPITER') return jq; // kein Handelsweg: keine Schätzung als Ersatz
        req.fallbackReason = jq.msg;
      }
      return ammQuote(req, price, liq);
    },
    build: () => ({ ok: true, note: 'keine Transaktion (Simulation)' }),
    preflight: q => (q.qty > 0 && isNum(q.fillPrice) && q.fillPrice > 0 ? { ok: true } : { ok: false, code: 'PREFLIGHT_FAILED', msg: 'Menge nach Gebühren ≤ 0' }),
    sign: () => ({ ok: true, simulated: true }),
    send: () => ({ ok: true, sig: null }),
    confirm: simConfirm
  };
  const liveProvider = {
    id: 'LIVE', available: false,
    quote: () => ({ ok: false, code: 'NO_ROUTER', msg: EXEC_FAIL.NO_ROUTER }), build: () => ({ ok: false, code: 'NO_ROUTER', msg: EXEC_FAIL.NO_ROUTER }),
    preflight: () => ({ ok: false, code: 'NO_ROUTER', msg: EXEC_FAIL.NO_ROUTER }), sign: () => ({ ok: false, code: 'SIGNATURE_DISABLED', msg: EXEC_FAIL.SIGNATURE_DISABLED }),
    send: () => ({ ok: false, code: 'NO_ROUTER', msg: EXEC_FAIL.NO_ROUTER }), confirm: () => ({ ok: false, code: 'NO_ROUTER', msg: EXEC_FAIL.NO_ROUTER })
  };
  const execProvider = mode => ((mode || state.mode) === 'LIVE' ? liveProvider : simProvider);
  /* Führt Build → Preflight → Sign → Send → Confirm aus; bricht beim ersten Fehler mit Fehlercode ab. */
  async function runProviderSteps(P, q, ord, onSubmit, ctx) {
    for (const step of ['build', 'preflight', 'sign', 'send']) {
      const r = P[step](q); if (!r.ok) return { ok: false, code: r.code, msg: r.msg || EXEC_FAIL[r.code] };
      if (step === 'preflight') { transition(ord, 'SUBMITTING', `${P.id}: Preflight ok – keine echte Order`); const stop = onSubmit && onSubmit(); if (stop) return stop; }
    }
    transition(ord, 'SUBMITTED', `${P.id}: ${P.id === 'SIMULATION' ? 'simulierte Übermittlung – keine Transaktion' : 'gesendet'}`);
    transition(ord, 'CONFIRMING', P.id === 'SIMULATION' && S().simLatencyMs > 0 ? `Warte ${S().simLatencyMs} ms auf Bestätigung (simuliert)` : undefined);
    const c = await P.confirm(q, ctx); if (!c.ok) return { ok: false, code: c.code, msg: c.msg || EXEC_FAIL[c.code], feeLoss: !!c.feeLoss };
    return { ok: true, fillPrice: c.fillPrice, q: c.q || q, latencyApplied: !!c.latencyApplied };
  }
  /* Gescheiterte Transaktion: Netzwerk- und Priority-Gebühr sind trotzdem bezahlt (wie on-chain), der Swap fand nicht statt. */
  function chargeFailedTx(ord, fees, pos) {
    const usd = m6(Math.min(Math.max(0, state.portfolio.cash), (fees && (fees.network || 0) + (fees.priority || 0)) || 0));
    ord.fees = { network: fees ? fees.network : 0, priority: fees ? fees.priority : 0, dex: 0, total: usd, failedTx: true };
    if (!(usd > 0)) return 0;
    const pf = state.portfolio;
    pf.cash = m6(pf.cash - usd); pf.fees = m6(pf.fees + usd); pf.realized = m6(pf.realized - usd); pf.failedTxFees = m6((pf.failedTxFees || 0) + usd);
    state.risk.dailyPnl = m6(state.risk.dailyPnl - usd);
    state.metrics.counters.txFailed = (state.metrics.counters.txFailed || 0) + 1;
    if (pos) { pos.feesUsd += usd; pos.realizedUsd += -usd; pos.failedTx = (pos.failedTx || 0) + 1; journalUpdate(pos); }
    return usd;
  }
  function failOrder(ord, key, code, msg) {
    ord.failureCode = code;
    const to = ['FAILED', 'REJECTED', 'CANCELLED'].find(x => (ORDER_TRANSITIONS[ord.state] || []).includes(x));
    if (to) transition(ord, to, `${code}: ${msg || EXEC_FAIL[code] || ''}`); else ord.state = 'FAILED';
    if (key) state.usedKeys.delete(key);
    log.error('TRADE', `${ord.side} ${ord.symbol} abgebrochen – ${code}: ${msg || EXEC_FAIL[code] || ''}`);
    persistNow();
    return { ok: false, order: ord, error: msg || EXEC_FAIL[code], code };
  }
  async function executeBuy(tokenId, o = {}) {
    const { auto = false, sizeUsd = null, reason = '', lead = null, fromQueue = false } = o;
    const t0 = env.now();
    const t = state.markets.get(tokenId);
    if (!t) return { ok: false, blockers: [mkBlocker('PRICE_MISSING', 'Token nicht im Scanner')] };
    const bc = state.risk.buyCount[tokenId] || 0, buyNo = bc + 1;
    const key = `${tokenId}:BUY:${buyNo}:${state.session ? state.session.id : 's0'}`;
    if (state.locks.has(tokenId)) { log.risk(`Parallele Aktion für ${t.symbol} verhindert (Trade Lock)`); return { ok: false, blockers: [mkBlocker('TRADE_LOCKED')] }; }
    if (state.usedKeys.has(key)) { log.risk(`Duplicate Order verhindert: Buy #${buyNo} ${t.symbol}`); return { ok: false, blockers: [mkBlocker('DUPLICATE_ORDER', `Buy #${buyNo} für ${t.symbol} existiert bereits`)] }; }
    state.locks.add(tokenId); state.usedKeys.set(key, 'pending');
    const ord = newOrder(t, 'BUY', { key, auto, reason, strategy: lead, buyNo });
    state.orders.unshift(ord); trimOrders();
    try {
      transition(ord, 'ANALYZING', 'Pre-Trade-Check mit frischen Daten');
      persistNow();
      await refreshToken(t);
      const ctx = buildCtx();
      const A = analyzeToken(t, ctx); t.A = A;
      const D = decideToken(t, A, { ...ctx, execCheck: null });
      const ex = execCheck(t, A, { auto, preTrade: true, sizeUsd, ownOrder: ord.id, lead: lead || D.strategy, fromQueue });
      const hard = auto ? D.analysisBlockers : D.analysisBlockers.filter(b => MANUAL_HARD.has(b.code) || (b.code === 'RISK_TOO_HIGH' && A.risk.level === 'CRITICAL'));
      const blockers = sortBlockers([...hard, ...ex.blockers]);
      ord.decision = immutableDecision(t, A, D, ex, blockers);
      if (blockers.length) {
        delete ord.decision.features; // Feature-Snapshot nur für ausgeführte Trades nötig (Speicher sparen)
        ord.failureCode = 'PRE_TRADE_BLOCKED';
        ord.blockers = blockers; transition(ord, 'REJECTED', blockers[0].code + ': ' + blockers[0].msg);
        state.usedKeys.delete(key); recordRejection(blockers); stratStat(lead || D.strategy, 'rejected');
        log.risk(`Buy ${t.symbol} abgelehnt: ${blockers.slice(0, 3).map(b => b.code).join(', ')}`);
        persistNow();
        return { ok: false, order: ord, blockers };
      }
      const size = ex.sizing.size, P = execProvider();
      ord.provider = P.id;
      await updatePriorityFee(t);
      const q = await P.quote({ side: 'BUY', sizeUsd: size, snap: t.snap, mint: t.mint, decimals: tokenDecimals(t, openPos(t.id)), roundTrip: true });
      if (!q.ok) {
        if (q.noRoute) t.quoteCheck = { at: env.now(), source: 'JUPITER', noBuyRoute: true, msg: q.msg };
        return failOrder(ord, key, q.code, q.msg);
      }
      // Befund des echten Angebots: Honeypot (kein Verkaufsweg), Rundreise-Kosten, echte Preisabweichung
      t.quoteCheck = { at: env.now(), source: q.source, noSellRoute: !!q.noSellRoute, sellErr: q.sellErr || null, roundTripPct: isNum(q.roundTripPct) ? q.roundTripPct : null, impactPct: lr2(q.impact * 100), sizeUsd: size,
        priceConflict: q.source === 'JUPITER' && q.impact * 100 < -PRICE_CONFLICT_PCT }; // Angebot weit UNTER dem Marktkurs: Rug im Gange oder veralteter Kurs
      ord.quote = { source: q.source, route: q.route, impactPct: lr2(q.impact * 100), roundTripPct: t.quoteCheck.roundTripPct, noSellRoute: !!q.noSellRoute, fallbackReason: q.fallbackReason || null, prioLamports: q.fees.prioLamports };
      const qb = quoteBlockers(t.quoteCheck, S());
      if (qb.length) {
        delete ord.decision.features; ord.decision.decision = 'REJECTED'; ord.decision.blockers = qb;
        ord.failureCode = 'PRE_TRADE_BLOCKED'; ord.blockers = qb; transition(ord, 'REJECTED', qb[0].code + ': ' + qb[0].msg);
        state.usedKeys.delete(key); recordRejection(qb); stratStat(lead || D.strategy, 'rejected');
        log.risk(`Buy ${t.symbol} nach echtem Angebot abgelehnt: ${qb.map(b => b.code).join(', ')}`);
        if (qb.some(b => b.code === 'NO_SELL_ROUTE')) alert('SECURITY', t, `${t.symbol}: kein Verkaufsweg über Jupiter – Honeypot-Verdacht, Kauf verhindert`, 'WARNING', { cooldownMs: HOUR, key: 'honeypot' });
        persistNow();
        return { ok: false, order: ord, blockers: qb };
      }
      const price = q.refPrice;
      ord.sizeUsd = size; ord.estPrice = price; ord.expSlipPct = q.impact * 100; ord.estFees = q.fees; ord.route = q.route;
      transition(ord, 'APPROVED', `Alle Pre-Trade-Checks bestanden · ${q.source === 'JUPITER' ? 'echtes Angebot' : 'Schätzung'}: ${q.route}`);
      const requote = async src => { await refreshToken(t, true); return P.quote({ side: 'BUY', sizeUsd: size, snap: t.snap, mint: t.mint, decimals: q.decimals, source: src }); };
      const run = await runProviderSteps(P, q, ord, () => (state.bot.emergency ? { ok: false, code: 'EMERGENCY_STOP', msg: EXEC_FAIL.EMERGENCY_STOP } : null), { requote });
      if (!run.ok) {
        if (run.feeLoss) { const lost = chargeFailedTx(ord, q.fees, null); log.trade(`${state.mode} BUY ${t.symbol} gescheitert (${run.code}) – Netzwerkgebühr ${fmtUsd(lost, 4)} trotzdem bezahlt`, { order: ord.id }); }
        const r = failOrder(ord, key, run.code, run.msg); if (run.code === 'EMERGENCY_STOP') r.blockers = [mkBlocker('EMERGENCY_STOP')]; return r;
      }
      const fq = run.q, fillPrice = run.fillPrice, qty = fq.qty, fees = fq.fees, impact = fillPrice / price - 1;
      if (!(qty > 0)) throw new Error('Menge nach Gebühren ≤ 0');
      transition(ord, 'CONFIRMED', `Simulierte Füllung: ${fq.source === 'JUPITER' ? 'echtes Jupiter-Angebot' : 'Live-Preis + geschätzter Price Impact'}${run.latencyApplied ? ` nach ${S().simLatencyMs} ms Wartezeit` : ''}`);
      ord.fillPrice = fillPrice; ord.qty = qty; ord.fees = fees; ord.expSlipPct = impact * 100; ord.priceAt = t.snap ? t.snap.fetchedAt : null; ord.latencyMs = env.now() - t0;
      if (ord.quote) { ord.quote.fillSource = fq.source; ord.quote.latencyApplied = run.latencyApplied; }
      const leadId = lead || D.strategy;
      applyBuyFill(t, ord, A, D, { price: fillPrice, refPrice: price, qty, size, fees, impact, lead: leadId, decimals: fq.decimals, source: fq.source });
      state.risk.buyCount[tokenId] = buyNo;
      state.risk.buyTimes = state.risk.buyTimes.filter(x => env.now() - x < DAY); state.risk.buyTimes.push(env.now());
      state.risk.dailyTrades++;
      if (leadId && state.strategies[leadId]) state.risk.stratCooldown[tokenId] = env.now() + state.strategies[leadId].cooldownMin * MIN;
      transition(ord, 'COMPLETED', 'Order Receipt erstellt (SIMULATED)');
      state.usedKeys.set(key, ord.id);
      state.metrics.counters.executed++; state.metrics.minute.executed++; state.metrics.perf.exec = ord.latencyMs;
      stratStat(leadId, 'executed');
      audit(auto ? 'BOT' : 'USER', 'BUY', `${t.symbol} Buy #${buyNo}: ${fmtUsd(size)} @ ${pxMcTxt(t.A, fillPrice)} (${state.mode})`, reason || D.reason);
      log.trade(`${state.mode} BUY #${buyNo} ${t.symbol}: ${fmtUsd(size)} @ ${pxMcTxt(t.A, fillPrice)} · ${fq.source === 'JUPITER' ? 'Jupiter' : 'geschätzt'} · Abweichung ${(impact * 100).toFixed(2)} % · Fees ${fmtUsd(fees.total, 4)}`, { order: ord.id });
      alert('TRADE', t, `${state.mode} BUY #${buyNo}: ${fmtUsd(size)} @ ${pxMcTxt(t.A, fillPrice)}`, 'SUCCESS', { cooldownMs: 0, key: ord.id });
      persistNow(); emit('trade', { order: ord });
      return { ok: true, order: ord };
    } catch (e) {
      ord.failureCode = ord.failureCode || 'INTERNAL';
      if (!TERMINAL.has(ord.state)) { try { transition(ord, 'FAILED', e.message); } catch (x) { ord.state = 'FAILED'; } }
      state.usedKeys.delete(key);
      log.error('TRADE', `Buy ${t.symbol} fehlgeschlagen: ${e.message}`);
      persistNow();
      return { ok: false, order: ord, error: e.message };
    } finally { state.locks.delete(tokenId); emit('order', ord); }
  }
  function applyBuyFill(t, o, A, D, f) {
    const now = env.now();
    let pos = openPos(t.id);
    if (!pos) {
      pos = {
        id: 'T-' + now.toString(36).toUpperCase() + '-' + (++seqs.pos).toString(36).toUpperCase(), tokenId: t.id, mint: t.mint, symbol: t.symbol, name: t.name,
        pair: A.core.pairAddress, dexId: A.core.dexId, mode: state.mode, status: 'OPEN', openedAt: now, entries: [], exits: [],
        qty: 0, initialQty: 0, costUsd: 0, investedUsd: 0, feesUsd: 0, slippageUsd: 0, realizedUsd: 0, entryPrice: null,
        highest: f.refPrice, stop: null, stopType: 'PERCENT', tps: [], tpHit: [false, false, false], breakEven: false, trailing: false,
        strategy: f.lead || null, entryLiq: A.liq.usd, lastPrice: f.refPrice, lastPriceAt: now, priceLabel: 'LIVE', value: null, pnlUsd: null, pnlPct: null,
        mae2m: 0, timeExitFlag: false, exitPending: null, paramVersion: state.activeParam, entryScore: A.finalScore,
        path: newPath(), learnVersion: state.models.champion, equityAtEntry: m2(equityInfo().equity),
        lc: 'OPEN', lcHistory: [{ s: 'PLANNED', ts: o.createdAt, note: 'Order ' + o.id }, { s: 'PENDING', ts: (o.history.find(h => h.s === 'SUBMITTING') || { ts: now }).ts, note: (o.provider || 'SIMULATION') + ' · ' + (o.route || '') }, { s: 'OPEN', ts: now, note: 'gefüllt' }]
      };
      state.positions.unshift(pos);
      journalOpen(pos, t, A, D, o);
    }
    if (pos.entries.length) { pos.lcHistory = pos.lcHistory || []; pos.lcHistory.push({ s: pos.lc || 'OPEN', ts: now, note: `Nachkauf #${pos.entries.length + 1} (Order ${o.id})` }); }
    pos.entries.push({ orderId: o.id, ts: now, price: f.price, refPrice: f.refPrice, qty: f.qty, usd: f.size, fees: f.fees.total, impactPct: f.impact * 100, latencyMs: o.latencyMs, source: f.source || null });
    if (isNum(f.decimals)) pos.decimals = f.decimals;
    const sq = sum(pos.entries.map(e => e.qty));
    pos.entryPrice = sum(pos.entries.map(e => e.price * e.qty)) / sq;
    pos.qty += f.qty; pos.initialQty += f.qty; pos.costUsd += f.size; pos.investedUsd += f.size; pos.feesUsd += f.fees.total;
    pos.slippageUsd += (f.size - f.fees.total) * (f.price / f.refPrice - 1); // Mehrkosten gegenüber dem Referenzkurs (begrenzt, siehe slippageOf)
    state.tradeSeq++;
    state.portfolio.cash = m6(state.portfolio.cash - f.size);
    state.portfolio.fees = m6(state.portfolio.fees + f.fees.total);
    setStops(pos, t);
    journalUpdate(pos);
  }
  function setStops(pos, t) {
    const s = S(), e = pos.entryPrice;
    let stop = e * (1 - s.stopLossPct / 100), type = 'PERCENT';
    const oh = t && t.ohlcv && t.ohlcv['1m'];
    if (s.useAtrStop && oh && oh.candles.length >= 20 && env.now() - oh.fetchedAt < 5 * MIN) {
      const a = atr(oh.candles, 14);
      if (a) { const as = e - s.atrMult * a; if (as > stop && as < e) { stop = as; type = 'ATR'; } }
    }
    if (!pos.trailing && !pos.breakEven) { pos.stop = stop; pos.stopType = type; pos.plannedStopPct = e > 0 ? (1 - stop / e) * 100 : null; } // geplantes Risiko für „erwartbarer Verlust?“
    pos.tps = [s.tp1Pct, s.tp2Pct, s.tp3Pct].map(p => e * (1 + p / 100));
  }
  function exitDecision(pos, t, p, pnlPct, liq, now) {
    const s = S(), A = t && t.A;
    if (p <= pos.stop) return { code: pos.stopType === 'TRAILING' ? 'TRAILING_STOP' : pos.stopType === 'BREAK_EVEN' ? 'BREAK_EVEN' : pos.stopType === 'ATR' ? 'ATR_STOP' : 'STOP_LOSS', frac: 'ALL', detail: `${pxMcTxt(A, p)} ≤ Stop ${pxMcTxt(A, pos.stop)}` };
    if (isNum(liq) && isNum(pos.entryLiq) && pos.entryLiq > 0 && liq < pos.entryLiq * (1 - s.liqCollapsePct / 100)) return { code: 'LIQUIDITY_COLLAPSE', frac: 'ALL', detail: `Liquidität ${fmtUsd(liq)} (Entry ${fmtUsd(pos.entryLiq)})` };
    if (s.exitOnRiskCritical && A && (A.sec.status === 'CRITICAL' || (A.risk.level === 'CRITICAL' && A.confidence.total >= 50))) return { code: 'RISK_INCREASE', frac: 'ALL', detail: `Risiko ${A.risk.level} (${A.risk.total})` };
    if (pnlPct >= s.tp3Pct) return { code: 'TP3', frac: 'ALL', detail: `+${pnlPct.toFixed(1)} % ≥ TP3` };
    if (pnlPct >= s.tp1Pct && !pos.tpHit[0]) return { code: 'TP1', frac: s.tp1Frac, detail: `+${pnlPct.toFixed(1)} % ≥ TP1` };
    if (pnlPct >= s.tp2Pct && !pos.tpHit[1]) return { code: 'TP2', frac: s.tp2Frac, detail: `+${pnlPct.toFixed(1)} % ≥ TP2` };
    if (s.momentumReversalExit && A && isNum(A.price.chg.m5) && A.price.chg.m5 <= -10 && A.tx.ratio5 != null && A.tx.ratio5 < 0.4 && pnlPct < s.tp1Pct) return { code: 'MOMENTUM_REVERSAL', frac: 'ALL', detail: `5m ${fmtPct(A.price.chg.m5)}, Käufer ${(A.tx.ratio5 * 100).toFixed(0)} %` };
    const held = now - pos.openedAt;
    if (held >= s.timeExitMin * MIN && pnlPct < s.timeExitMinPnlPct) {
      if (!pos.timeExitFlag) { pos.timeExitFlag = true; alert('SELL_CANDIDATE', t, `Time Exit Candidate: ${pos.symbol} nach ${fmtAge(held)} nur ${fmtPct(pnlPct)}`, 'INFO', { key: 'time' }); }
      if (s.timeExitAuto) return { code: 'TIME_EXIT', frac: 'ALL', detail: `${fmtAge(held)} ohne erwartete Bewegung (${fmtPct(pnlPct)})` };
    }
    if (p <= pos.stop * 1.03) alert('SELL_CANDIDATE', t, `${pos.symbol} nahe am Stop (${pxMcTxt(A, p)} / Stop ${pxMcTxt(A, pos.stop)})`, 'WARNING', { key: 'nearstop' });
    return null;
  }
  /* Trades laufen neben dem Scan (seit 2.12.0): Der Scan bewertet die Positionen sofort und stößt Verkäufe und Käufe an,
     wartet aber nicht auf deren Ausführung (Kursangebot, Wartezeit). Jede Aktion sperrt ihren Coin bzw. ihre Position
     selbst, deshalb kann nichts doppelt ausgeführt werden. drainTrades() wartet auf alle laufenden Trades. */
  const tradeLanes = new Set();
  function laneOf(p, what) {
    const q = Promise.resolve(p).catch(e => log.error('TRADE', `${what} fehlgeschlagen: ${e && e.message}`)).finally(() => tradeLanes.delete(q));
    tradeLanes.add(q);
    return q;
  }
  const drainTrades = () => Promise.all([...tradeLanes]);
  /* Bewertet alle offenen Positionen (Kurs, PnL, Trailing, Exit-Entscheidung) ohne zu warten; gestartete Verkäufe
     laufen nebenher. Das zurückgegebene Promise ist erfüllt, wenn diese Verkäufe fertig sind. */
  function managePositions() {
    const now = env.now(), s = S(), sells = [];
    for (const pos of [...state.positions]) {
      if (pos.status !== 'OPEN' || state.locks.has('pos:' + pos.id)) continue;
      const t = state.markets.get(pos.tokenId) || ensureToken(pos.mint, 'Position');
      const es = t ? effectiveSnap(t, now, s) : null;
      if (!es || !es.snap || !isNum(es.snap.priceUsd) || es.label === 'STALE' || es.label === 'UNKNOWN') {
        pos.priceLabel = es ? es.label : 'UNKNOWN'; pos.value = null; pos.pnlUsd = null; pos.pnlPct = null;
        if (!pos.staleSince) pos.staleSince = now;
        else if (now - pos.staleSince > MIN) alert('POSITION_DATA', t, `Keine aktuellen Preisdaten für ${pos.symbol} – PnL nicht verfügbar, Exits ausgesetzt`, 'WARNING');
        continue;
      }
      pos.staleSince = 0;
      const p = es.snap.priceUsd, liq = es.snap.liquidityUsd;
      pos.lastPrice = p; pos.lastPriceAt = es.snap.fetchedAt; pos.priceLabel = es.label; pos.highest = Math.max(pos.highest || p, p);
      const pnlPct = (p / pos.entryPrice - 1) * 100;
      if (now - pos.openedAt <= 2 * MIN) pos.mae2m = Math.min(pos.mae2m || 0, pnlPct);
      if (pos.path) updatePath(pos.path, now - pos.openedAt, pnlPct, isNum(liq) && isNum(pos.entryLiq) && pos.entryLiq > 0 ? (liq / pos.entryLiq - 1) * 100 : null);
      const val = valuePosition(pos, p, liq);
      pos.value = val.net; pos.exitImpactPct = val.impactPct;
      pos.pnlUsd = val.net != null ? val.net - pos.costUsd : null;
      pos.pnlPct = pos.pnlUsd != null && pos.costUsd > 0 ? pos.pnlUsd / pos.costUsd * 100 : null;
      if (pnlPct >= s.trailActivatePct && !pos.trailing) { pos.trailing = true; log.trade(`${pos.symbol}: Trailing Stop aktiviert (${fmtPct(pnlPct)})`); }
      if (pos.trailing) { const ts = pos.highest * (1 - s.trailPct / 100); if (ts > pos.stop) { pos.stop = ts; pos.stopType = 'TRAILING'; } }
      const ex = exitDecision(pos, t, p, pnlPct, liq, now);
      if (ex && !(pos.sellRetryAt > now)) sells.push(laneOf(executeSell(pos.id, ex.frac, ex.code, { auto: true, detail: ex.detail }), `Verkauf ${pos.symbol}`));
    }
    return Promise.all(sells);
  }
  async function executeSell(posId, frac, reasonCode, o = {}) {
    const { auto = false, emergency = false, detail = '' } = o;
    const pos = state.positions.find(p => p.id === posId);
    if (!pos || pos.status !== 'OPEN') return { ok: false, error: 'Position nicht offen' };
    const lk = 'pos:' + pos.id;
    if (state.locks.has(lk)) return { ok: false, blockers: [mkBlocker('TRADE_LOCKED', 'Position wird bereits bearbeitet')] };
    const key = `${pos.id}:SELL:${pos.exits.length + 1}`;
    if (state.usedKeys.has(key)) return { ok: false, blockers: [mkBlocker('DUPLICATE_ORDER')] };
    state.locks.add(lk); state.usedKeys.set(key, 'pending');
    const t = state.markets.get(pos.tokenId) || ensureToken(pos.mint, 'Position');
    const ord = newOrder(t || { id: pos.tokenId, mint: pos.mint, symbol: pos.symbol }, 'SELL', { key, auto, reason: reasonCode + (detail ? ' – ' + detail : ''), strategy: pos.strategy, positionId: pos.id });
    state.orders.unshift(ord); trimOrders();
    const t0 = env.now();
    posTransition(pos, 'CLOSING', `${reasonCode}${detail ? ' – ' + detail : ''} (Order ${ord.id})`);
    try {
      transition(ord, 'ANALYZING', emergency ? 'Emergency Exit – Pre-Exit-Check' : 'Pre-Exit-Check');
      persistNow();
      if (t) await refreshToken(t);
      const es = t ? effectiveSnap(t, env.now(), S()) : null;
      const B = [];
      if (!es || !es.snap || !isNum(es.snap.priceUsd)) B.push(mkBlocker('PRICE_MISSING', 'Kein verifizierter Preis – Exit wird nicht simuliert (kein Fantasiepreis)'));
      else if (es.label === 'STALE') B.push(mkBlocker('DATA_STALE', `Preis ${fmtAge(es.age)} alt – Exit ausgesetzt`));
      if (!estFees(1)) B.push(mkBlocker('FEE_UNKNOWN'));
      if (B.length) {
        pos.exitPending = { code: reasonCode, since: pos.exitPending ? pos.exitPending.since : env.now(), blocker: B[0].msg };
        ord.failureCode = 'PRE_TRADE_BLOCKED';
        ord.blockers = B; transition(ord, 'REJECTED', B[0].msg); state.usedKeys.delete(key);
        posTransition(pos, lcBack(pos), 'Verkauf ausgesetzt: ' + B[0].msg); persistNow();
        return { ok: false, order: ord, blockers: B };
      }
      const p = es.snap.priceUsd, P = execProvider();
      let qty = frac === 'ALL' ? pos.qty : Math.min(pos.qty, pos.initialQty * frac);
      if (pos.qty - qty < pos.initialQty * 0.01) qty = pos.qty;
      ord.provider = P.id;
      if (t) await updatePriorityFee(t);
      const q = await P.quote({ side: 'SELL', qty, snap: es.snap, mint: pos.mint, decimals: tokenDecimals(t, pos) });
      if (!q.ok) {
        pos.sellRetryAt = env.now() + SELL_RETRY_MS;
        if (q.noRoute) {
          pos.noRouteSince = pos.noRouteSince || env.now();
          const since = env.now() - pos.noRouteSince;
          if (auto && since >= NO_ROUTE_WRITEOFF_MIN * MIN) return writeOffPosition(pos, t, ord, key, p, q.msg);
          pos.exitPending = { code: reasonCode, since: pos.exitPending ? pos.exitPending.since : env.now(), blocker: 'Kein Verkaufsweg über Jupiter' };
          alert('POSITION_DATA', t, `${pos.symbol}: kein Verkaufsweg über Jupiter seit ${fmtAge(since)} – Position zählt mit 0 $, Abschreibung nach ${NO_ROUTE_WRITEOFF_MIN} min`, 'WARNING', { key: 'noroute' });
        }
        posTransition(pos, lcBack(pos), 'Angebot fehlgeschlagen: ' + str(q.msg || q.code, 100)); return failOrder(ord, key, q.code, q.msg);
      }
      pos.noRouteSince = 0;
      ord.route = q.route; ord.quote = { source: q.source, route: q.route, impactPct: lr2(q.impact * 100), fallbackReason: q.fallbackReason || null, prioLamports: q.fees.prioLamports };
      transition(ord, 'APPROVED', 'Pre-Exit-Check bestanden' + (q.impactEstimated ? ' (Impact geschätzt: max. Slippage)' : '') + ` · ${q.source === 'JUPITER' ? 'echtes Angebot' : 'Schätzung'}: ${q.route}`);
      const requote = async src => {
        if (t) await refreshToken(t, true);
        const es2 = t ? effectiveSnap(t, env.now(), S()) : null, sn = es2 && es2.snap && isNum(es2.snap.priceUsd) && es2.label !== 'STALE' ? es2.snap : es.snap;
        return P.quote({ side: 'SELL', qty, snap: sn, mint: pos.mint, decimals: q.decimals, source: src });
      };
      const run = await runProviderSteps(P, q, ord, null, { requote });
      if (!run.ok) {
        if (run.feeLoss) { const lost = chargeFailedTx(ord, q.fees, pos); log.trade(`${pos.mode} SELL ${pos.symbol} gescheitert (${run.code}) – Netzwerkgebühr ${fmtUsd(lost, 4)} trotzdem bezahlt, neuer Versuch folgt`, { order: ord.id }); }
        if (run.code === 'NO_ROUTE') { pos.noRouteSince = pos.noRouteSince || env.now(); pos.sellRetryAt = env.now() + SELL_RETRY_MS; } else pos.sellRetryAt = env.now() + 2 * SEC;
        posTransition(pos, lcBack(pos), 'Ausführung abgebrochen: ' + run.code); return failOrder(ord, key, run.code, run.msg);
      }
      const fq = run.q, fillPrice = run.fillPrice, proceeds = fq.proceeds, fees = fq.fees, net = fq.net, imp = 1 - fillPrice / p;
      if (ord.quote) { ord.quote.fillSource = fq.source; ord.quote.latencyApplied = run.latencyApplied; }
      transition(ord, 'CONFIRMED', `Simulierte Füllung: ${fq.source === 'JUPITER' ? 'echtes Jupiter-Angebot' : 'Schätzung'}${run.latencyApplied ? ` nach ${S().simLatencyMs} ms Wartezeit` : ''}`);
      const costPortion = pos.costUsd * (qty / pos.qty);
      const realized = net - costPortion;
      pos.exits.push({ orderId: ord.id, ts: env.now(), price: fillPrice, refPrice: p, qty, usd: net, fees: fees.total, impactPct: imp * 100, reason: reasonCode, realized, source: fq.source || null });
      pos.qty -= qty; pos.costUsd -= costPortion;
      if (pos.qty <= pos.initialQty * 1e-9) { pos.qty = 0; pos.costUsd = 0; }
      pos.realizedUsd += realized; pos.feesUsd += fees.total; pos.slippageUsd += qty * (p - fillPrice); pos.exitPending = null;
      state.tradeSeq++;
      state.portfolio.cash = m6(state.portfolio.cash + net); state.portfolio.realized = m6(state.portfolio.realized + realized); state.portfolio.fees = m6(state.portfolio.fees + fees.total);
      const r = state.risk;
      r.coinCooldown[pos.tokenId] = env.now() + S().sellCooldownMin * MIN;
      r.dailyPnl = m6(r.dailyPnl + realized);
      ord.sizeUsd = net; ord.qty = qty; ord.fillPrice = fillPrice; ord.estPrice = p; ord.fees = fees; ord.expSlipPct = imp * 100; ord.latencyMs = env.now() - t0; ord.priceAt = es.snap.fetchedAt;
      if (reasonCode === 'TP1') { pos.tpHit[0] = true; if (S().breakEvenAfterTp1 && pos.qty > 0) { const be = pos.costUsd / pos.qty; if (be > pos.stop) { pos.stop = be; pos.stopType = 'BREAK_EVEN'; pos.breakEven = true; } } }
      if (reasonCode === 'TP2') pos.tpHit[1] = true;
      transition(ord, 'COMPLETED', 'Order Receipt erstellt (SIMULATED)');
      state.usedKeys.set(key, ord.id);
      log.trade(`${pos.mode} SELL ${pos.symbol} (${reasonCode}): ${fmtUsd(net)} @ ${pxMcTxt(t && t.A, fillPrice)} · realisiert ${fmtSigned(realized)}`, { order: ord.id });
      audit(auto ? 'BOT' : 'USER', 'SELL', `${pos.symbol} ${reasonCode}: ${fmtUsd(net)} (${fmtSigned(realized)})`, detail);
      if (/STOP|BREAK_EVEN/.test(reasonCode)) alert('STOP_HIT', t, `${pos.symbol}: ${reasonCode} ${detail}`, 'WARNING', { cooldownMs: 0, key: ord.id });
      else if (/^TP/.test(reasonCode)) alert('TP_HIT', t, `${pos.symbol}: ${reasonCode} ${fmtSigned(realized)}`, 'SUCCESS', { cooldownMs: 0, key: ord.id });
      else alert('TRADE', t, `${pos.mode} SELL ${pos.symbol} (${reasonCode}): ${fmtSigned(realized)}`, 'INFO', { cooldownMs: 0, key: ord.id });
      if (pos.qty <= 0) closePosition(pos, reasonCode); else { posTransition(pos, 'PARTIAL', `${reasonCode}: ${fmtNum(qty, 2)} verkauft, Rest ${fmtNum(pos.qty, 2)}`); journalUpdate(pos); }
      checkDailyLimit();
      persistNow(); emit('trade', { order: ord });
      return { ok: true, order: ord };
    } catch (e) {
      ord.failureCode = ord.failureCode || 'INTERNAL';
      if (!TERMINAL.has(ord.state)) { try { transition(ord, 'FAILED', e.message); } catch (x) { ord.state = 'FAILED'; } }
      state.usedKeys.delete(key);
      if (pos.lc === 'CLOSING') posTransition(pos, lcBack(pos), 'Fehler: ' + e.message);
      log.error('TRADE', `Sell ${pos.symbol} fehlgeschlagen: ${e.message}`);
      persistNow();
      return { ok: false, order: ord, error: e.message };
    } finally { state.locks.delete(lk); emit('order', ord); }
  }
  /* Seit NO_ROUTE_WRITEOFF_MIN min kein Verkaufsweg: Position als Totalverlust abschreiben – so endet ein Honeypot auch im echten Handel. */
  function writeOffPosition(pos, t, ord, key, refPrice, why) {
    const qty = pos.qty, realized = -pos.costUsd;
    ord.failureCode = 'WRITTEN_OFF'; ord.qty = qty; ord.sizeUsd = 0; ord.estPrice = refPrice;
    transition(ord, 'CANCELLED', `${EXEC_FAIL.WRITTEN_OFF} (${str(why || '', 80)})`);
    pos.exits.push({ orderId: ord.id, ts: env.now(), price: 0, refPrice, qty, usd: 0, fees: 0, impactPct: 100, reason: 'NO_SELL_ROUTE', realized, source: 'WRITE_OFF' });
    pos.qty = 0; pos.costUsd = 0; pos.realizedUsd += realized; pos.exitPending = null; state.tradeSeq++;
    state.portfolio.realized = m6(state.portfolio.realized + realized); state.risk.dailyPnl = m6(state.risk.dailyPnl + realized);
    state.usedKeys.set(key, ord.id);
    log.trade(`${pos.mode} ${pos.symbol}: seit ${NO_ROUTE_WRITEOFF_MIN} min kein Verkaufsweg → als Totalverlust abgeschrieben (${fmtSigned(realized)})`, { order: ord.id });
    audit('BOT', 'WRITE_OFF', `${pos.symbol}: Totalverlust ${fmtSigned(realized)} (kein Verkaufsweg)`, str(why || '', 120));
    alert('STOP_HIT', t, `${pos.symbol}: kein Verkaufsweg seit ${NO_ROUTE_WRITEOFF_MIN} min – als Totalverlust abgeschrieben (${fmtSigned(realized)})`, 'CRITICAL', { cooldownMs: 0, key: ord.id });
    closePosition(pos, 'NO_SELL_ROUTE');
    checkDailyLimit(); persistNow(); emit('trade', { order: ord });
    return { ok: true, order: ord, writtenOff: true };
  }
  function closePosition(pos, reason) {
    const now = env.now(), s = S(), r = state.risk;
    pos.status = 'CLOSED'; pos.closedAt = now; pos.exitReason = reason;
    if (!pos.lc || pos.lc === 'OPEN' || pos.lc === 'PARTIAL') posTransition(pos, 'CLOSING', reason);
    posTransition(pos, 'CLOSED', reason);
    state.positions = state.positions.filter(p => p.id !== pos.id);
    const pnl = pos.realizedUsd, win = pnl > 0;
    if (!win) {
      r.lossStreak++; r.lossCooldownUntil = now + s.lossCooldownMin * MIN;
      log.risk(`Verlust ${pos.symbol} ${fmtSigned(pnl)} → ${s.lossCooldownMin > 0 ? `Loss-Cooldown ${s.lossCooldownMin} min` : 'kein Loss-Cooldown (0 min)'} (Serie ${r.lossStreak})`);
      if (s.lossStreakLimit > 0 && r.lossStreak >= s.lossStreakLimit) {
        r.globalPauseUntil = now + s.globalPauseMin * MIN; r.reviewRequired = true;
        const pauseTxt = s.globalPauseMin > 0 ? `globale Pause ${s.globalPauseMin} min` : 'keine globale Pause (0 min)';
        log.risk(`${r.lossStreak} Verluste in Folge → ${pauseTxt}`);
        alert('RISK', null, `${r.lossStreak} Verluste in Folge → ${pauseTxt}. Kontrollierter Review empfohlen.`, s.globalPauseMin > 0 ? 'CRITICAL' : 'WARNING', { key: 'streak', cooldownMs: 0 });
      }
    } else r.lossStreak = 0;
    ensureSession();
    const se = state.session; se.trades++; if (win) se.wins++; else se.losses++; se.pnl = m6(se.pnl + pnl);
    journalClose(pos);
    stratStat(pos.strategy, win ? 'profitable' : 'unprofitable');
    const j = state.journal.find(x => x.id === pos.id);
    // Abgleich: Journal muss dasselbe Ergebnis tragen wie das Portfolio – sonst UNKNOWN statt stiller Annahme
    if (j && j.status === 'CLOSED' && j.result && Math.abs(j.result.pnlUsd - m6(pos.realizedUsd)) < 1e-6 && pos.qty === 0) posTransition(pos, 'RECONCILED', 'Journal & Portfolio stimmen überein');
    else { posTransition(pos, 'UNKNOWN', 'Journal weicht ab'); state.reconciliation = { required: true, issues: [...state.reconciliation.issues, `Position ${pos.id} (${pos.symbol}): Journal weicht beim Schließen ab`].slice(-40), at: now }; }
    if (j) { j.lc = pos.lc; j.lcHistory = deepClone(pos.lcHistory || []); }
    if (j && isNum(pos.mae2m) && pos.mae2m <= -5 && j.signals.some(x => x.strength >= 70)) {
      state.falseSignals.unshift({ ts: now, tradeId: pos.id, symbol: pos.symbol, signals: j.signals.filter(x => x.strength >= 70).map(x => x.type), mae2m: pos.mae2m, pnlUsd: pnl });
      if (state.falseSignals.length > 60) state.falseSignals.length = 60;
    }
    const eq = equityInfo(); state.hist.equity.push({ t: now, v: m2(eq.equity), realized: m2(state.portfolio.realized) }); if (state.hist.equity.length > 500) state.hist.equity.shift();
    try { learnOnClose(pos, j); } catch (e) { log.error('LEARNING', `Lernschritt für ${pos.symbol} fehlgeschlagen: ${e.message}`); }
    maybeTune();
  }
  function checkDailyLimit() {
    const r = state.risk, s = S();
    const base = r.dailyStartEquity || state.portfolio.startCapital;
    if (s.dailyLossLimitPct > 0 && !r.dailyLimitHit && r.dailyPnl <= -base * s.dailyLossLimitPct / 100) {
      r.dailyLimitHit = true;
      if (state.bot.autoTrading) { state.bot.autoTrading = false; audit('BOT', 'AUTO_TRADING_OFF', 'Tagesverlust-Limit erreicht'); }
      log.risk(`Tagesverlust-Limit erreicht (${fmtSigned(r.dailyPnl)}) → Auto-Trading deaktiviert`);
      alert('RISK', null, `Tagesverlust-Limit erreicht (${fmtSigned(r.dailyPnl)}) → Auto-Trading deaktiviert`, 'CRITICAL', { key: 'daily', cooldownMs: HOUR });
    }
  }

  /* ---------- Trade Journal ---------- */
  function journalOpen(pos, t, A, D, o) {
    state.journal.unshift({
      id: pos.id, tokenId: pos.tokenId, symbol: pos.symbol, name: t.name, mint: pos.mint, pair: pos.pair, dexId: pos.dexId, mode: pos.mode, status: 'OPEN',
      openedAt: pos.openedAt, closedAt: null, entries: [], exits: [], sizeUsd: 0, feesUsd: 0, slippageUsd: 0,
      score: A.finalScore, opportunity: A.opportunity, confidence: A.confidence.total, risk: { total: A.risk.total, level: A.risk.level },
      signals: A.signals.map(x => ({ type: x.type, strength: x.strength, reason: x.reason })), strategy: pos.strategy, auto: o.auto,
      reason: o.reason || D.reason, sources: sourcesUsed(t), discovery: discoveryOf(t).primary, tags: [...A.tags], regime: [...(state.regime.tags || [])],
      decision: o.decision, paramVersion: state.activeParam, result: null, exitReason: null, mae2m: null, holdMs: null
    });
    if (state.journal.length > 800) state.journal = state.journal.filter((j, i) => i < 600 || j.status === 'OPEN');
  }
  function journalUpdate(pos) {
    const j = state.journal.find(x => x.id === pos.id); if (!j) return;
    j.entries = deepClone(pos.entries); j.exits = deepClone(pos.exits); j.sizeUsd = m6(pos.investedUsd); j.feesUsd = m6(pos.feesUsd); j.slippageUsd = m6(pos.slippageUsd);
    j.mae2m = pos.mae2m; j.execLatencyMs = avg(pos.entries.map(e => e.latencyMs).filter(isNum));
  }
  function journalClose(pos) {
    journalUpdate(pos);
    const j = state.journal.find(x => x.id === pos.id); if (!j) return;
    j.status = 'CLOSED'; j.closedAt = pos.closedAt; j.exitReason = pos.exitReason; j.holdMs = pos.closedAt - pos.openedAt;
    j.result = { pnlUsd: m6(pos.realizedUsd), pnlPct: pos.investedUsd > 0 ? pos.realizedUsd / pos.investedUsd * 100 : null, win: pos.realizedUsd > 0 };
  }

  /* ---------- Trade Queue & Auto-Trading ---------- */
  function enqueue(tokenId, lead) {
    if (state.queue.some(q => q.tokenId === tokenId) || state.locks.has(tokenId) || state.queue.length >= 5) return false;
    state.queue.push({ tokenId, lead, at: env.now() });
    stratStat(lead, 'accepted');
    return true;
  }
  let queueBusy = false;
  async function processQueue() {
    if (queueBusy) return;
    queueBusy = true;
    try {
      while (state.queue.length) {
        if (state.bot.emergency) { state.queue = []; break; }
        if (state.orders.filter(o => !TERMINAL.has(o.state)).length >= S().maxActiveOrders) break;
        const q = state.queue.shift();
        const t = state.markets.get(q.tokenId); if (!t) continue;
        if (env.now() - q.at > 30 * SEC) { log.info('TRADE', `Queue-Eintrag ${t.symbol} verfallen (älter als 30 s)`); continue; }
        await executeBuy(q.tokenId, { auto: true, lead: q.lead, fromQueue: true, reason: t.D ? t.D.reason : '' });
      }
    } finally { queueBusy = false; }
  }
  async function maybeAutoTrade() {
    if (globalBlockers({ auto: true }).length) return;
    const cands = [...state.markets.values()].filter(t => t.D && t.D.decision === 'APPROVED').sort((a, b) => b.A.finalScore - a.A.finalScore);
    for (const t of cands) enqueue(t.id, t.D.strategy);
    if (state.queue.length) await processQueue();
  }

  /* ---------- Analyse aller Tokens ---------- */
  function buildCtx() {
    const eq = equityInfo();
    return { now: env.now(), S: S(), strategies: state.strategies, plannedSizeUsd: Math.max(0, (eq.equity || 0) * S().maxPositionPct / 100), execCheck: (t, A, o) => execCheck(t, A, o), rules: S().learnEnabled ? state.models.rules : null, regime: state.regime.tags };
  }
  function analyzeAll() {
    const ctx = buildCtx(), pinned = pinnedIds(), now = env.now();
    const funnel = Object.fromEntries(PIPELINE.map(p => [p, 0]));
    const reasons = {}; let fastPass = 0, approved = 0, cand = 0, rejected = 0, withSignals = 0; const analyses = [];
    for (const t of state.markets.values()) {
      if (!t.snap && !t.alt) { t.A = null; t.D = null; continue; }
      try { t.A = analyzeToken(t, ctx); t.D = decideToken(t, t.A, ctx); }
      catch (e) { log.error('SCANNER', `Analysefehler ${t.symbol}: ${e.message}`); t.A = null; t.D = null; continue; }
      analyses.push(t.A);
      for (let i = 0; i < t.D.trace.length && t.D.trace[i].ok === true; i++) funnel[t.D.trace[i].stage]++;
      if (t.D.fastPass) { fastPass++; enqueueSecurity(t, 100 + t.A.finalScore); }
      if (pinned.has(t.id)) enqueueSecurity(t, 1000);
      if (t.A.signals.some(x => !CONTEXT_SIGNALS.has(x.type))) withSignals++;
      if (t.D.decision === 'APPROVED') approved++;
      if (t.D.decision === 'APPROVED' || t.D.decision === 'BUY_CANDIDATE') cand++;
      if (t.D.decision !== 'APPROVED' && t.D.decision !== 'BUY_CANDIDATE') { if (t.D.decision === 'REJECTED') rejected++; const ab = t.D.analysisBlockers.filter(b => !(b.code === 'SECURITY_UNKNOWN' && !t.D.fastPass)); const c = ab[0] && ab[0].code; if (c) reasons[c] = (reasons[c] || 0) + 1; }
      if (t.A.strat) for (const v of t.A.strat.votes) if (v.enabled && v.vote === 'BUY') { const k = v.id + ':' + t.id; if (!state.stratMarks[k] || now - state.stratMarks[k] > 30 * MIN) { state.stratMarks[k] = now; stratStat(v.id, 'signals'); state.metrics.counters.buySignals++; state.monitor.sigTimes.push(now); } }
    }
    state.metrics.funnel = funnel; state.metrics.rejectReasons = reasons;
    state.metrics.scanStats = { tokens: analyses.length, fastPass, approved, candidates: cand, rejected, withSignals };
    const m = state.metrics.minute; m.scans++; m.candidates += fastPass; m.accepted += approved; m.rejected += rejected;
    const solT = state.sol ? { usd: state.sol.usd, h1: state.sol.chg ? state.sol.chg.h1 : null, h24: state.sol.chg ? state.sol.chg.h24 : null } : null;
    state.regime = computeRegime(analyses, solT);
    try { shadowDecisions(now); } catch (e) { log.error('LEARNING', 'Shadow-Bewertung: ' + e.message); }
    try { nearMissTick(now); } catch (e) { log.error('LEARNING', 'Near-Miss-Tracking: ' + e.message); }
  }
  function runAlerts() {
    const s = S();
    for (const t of state.markets.values()) {
      const A = t.A, D = t.D; if (!A || !D) continue;
      if (t.isNew) { t.isNew = false; if (s.alertNewTokens && D.fastPass) alert('NEW_TOKEN', t, `Neuer Token: ${t.symbol} (${A.ageClass}, Liq ${fmtUsd(A.liq.usd)})`, 'INFO'); }
      if (D.decision === 'APPROVED' || D.decision === 'BUY_CANDIDATE') alert('BUY_CANDIDATE', t, D.reason, 'SUCCESS', { strength: A.finalScore });
      else if (A.finalScore >= s.alertScore && D.decision !== 'REJECTED') alert('SCORE', t, `Final Score ${A.finalScore} ≥ ${s.alertScore}`, 'INFO', { strength: A.finalScore });
      if (s.alertX2) { const seen = state.seen[t.id]; if (seen && seen.mc > 0 && isNum(A.core.mc) && A.core.mc >= seen.mc * 2 && isNum(A.liq.usd) && A.liq.usd >= s.minLiq) alert('X2', t, `x${(A.core.mc / seen.mc).toFixed(1)} seit Fund (${fmtMc(seen.mc)} → ${fmtMc(A.core.mc)})`, 'SUCCESS', { cooldownMs: DAY }); }
      if (D.fastPass) {
        if (A.liq.spike) alert('LIQ_SPIKE', t, `Liquidität ${fmtPct(A.liq.chg5)} in 5 min`, 'INFO');
        if (A.liq.shock) alert('LIQ_COLLAPSE', t, `Liquidität ${fmtPct(A.liq.chg5)} in 5 min`, 'WARNING');
        const vs = A.signals.find(x => x.type === 'VOLUME_EXPANSION' && x.strength >= 80); if (vs) alert('VOL_SPIKE', t, vs.reason, 'INFO', { strength: vs.strength });
        const wh = A.signals.find(x => x.type === 'WHALE_ACTIVITY' && x.strength >= 70); if (wh) alert('WHALE', t, wh.reason, 'INFO', { strength: wh.strength });
      }
      const w = state.watchlist[t.id];
      if (w && w.alerts) {
        const p = A.core.price;
        if (isNum(w.priceAbove) && isNum(p) && p >= w.priceAbove) alert('WATCH', t, `${pxMcTxt(A, p)} ≥ Alarm ${pxMcTxt(A, w.priceAbove)}`, 'INFO', { key: 'above' });
        if (isNum(w.priceBelow) && isNum(p) && p <= w.priceBelow) alert('WATCH', t, `${pxMcTxt(A, p)} ≤ Alarm ${pxMcTxt(A, w.priceBelow)}`, 'WARNING', { key: 'below' });
        if (isNum(w.scoreAbove) && A.finalScore >= w.scoreAbove) alert('WATCH', t, `Score ${A.finalScore} ≥ ${w.scoreAbove}`, 'INFO', { key: 'score' });
      }
    }
  }

  /* ---------- Bot-Zustand, Readiness, Recovery ---------- */
  function setBotState(to, note) {
    const from = state.bot.state; if (from === to) return true;
    if (!(BOT_TRANSITIONS[from] || []).includes(to)) { log.warn('SYSTEM', `Ungültiger Bot-Zustandswechsel ${from} → ${to} ignoriert`); return false; }
    state.bot.state = to;
    log.info('SYSTEM', `Bot: ${from} → ${to}${note ? ' (' + note + ')' : ''}`);
    emit('bot', { from, to });
    return true;
  }
  function isReady() {
    const s = S(), now = env.now();
    return env.online() && http.status('dexPairs') === 'ONLINE' && [...state.markets.values()].some(t => t.snap && now - t.snap.fetchedAt < s.staleAfterSec * SEC) && systemHealth().score >= s.minSystemHealth;
  }
  function updateReadiness() {
    const b = state.bot;
    if (b.state === 'RECOVERING' && isReady()) { setBotState(b.desired === 'PAUSED' ? 'PAUSED' : 'RUNNING', 'READY – Datenqualität ausreichend'); b.readyAt = env.now(); }
    else if (b.state === 'RUNNING' && (!env.online() || systemHealth().score < 30)) setBotState('RECOVERING', `System Health ${systemHealth().score} – Trading pausiert bis Datenqualität zurück ist`);
    else if (b.state === 'ERROR' && env.now() - b.errorAt > 30 * SEC) setBotState('RECOVERING', 'Automatischer Recovery-Versuch');
  }
  function ensureSession() { if (!state.session || !state.session.id) state.session = { id: 'S-' + env.now().toString(36).toUpperCase(), startedAt: env.now(), trades: 0, wins: 0, losses: 0, pnl: 0 }; }
  function dayRollover() {
    const k = dayKeyOf(env.now()), r = state.risk;
    if (r.dayKey !== k) {
      if (r.dayKey) log.info('RISK', `Tageswechsel: Tagesmetriken zurückgesetzt (Vortag ${fmtSigned(r.dailyPnl)}, ${r.dailyTrades} Käufe)`);
      r.dayKey = k; r.dailyPnl = 0; r.dailyTrades = 0; r.dailyLimitHit = false; r.dailyStartEquity = equityInfo().equity;
      for (const [key, ts] of Object.entries(state.alertMarks)) if (env.now() - ts > DAY) delete state.alertMarks[key];
    }
  }
  function sampleMetrics() {
    const now = env.now(), m = state.metrics.minute, H = state.hist;
    if (!m.t) m.t = now;
    if (now - m.t >= MIN) {
      // Speicher begrenzen: kurzlebige Markierungen & alte Fund-Daten rotieren
      for (const [k, v] of Object.entries(state.stratMarks)) if (now - v > 30 * MIN) delete state.stratMarks[k];
      for (const [k, v] of Object.entries(state.seen)) if (now - v.t > 2 * DAY && !state.markets.has(k)) delete state.seen[k];
      const sc = Math.max(1, m.scans);
      H.scanner.push({ t: now, candidates: m.candidates / sc, accepted: m.accepted / sc, rejected: m.rejected / sc, executed: m.executed, scans: m.scans });
      const apis = {}; for (const n of http.names()) { const x = http.snapshot(n); if (x.total > 0) apis[n] = { lat: x.latency != null ? Math.round(x.latency) : null, fail: x.errorRate != null ? m2(x.errorRate) : null, st: x.status }; }
      H.api.push({ t: now, apis });
      Object.assign(m, { t: now, scans: 0, candidates: 0, accepted: 0, rejected: 0, executed: 0 });
      for (const k of ['scanner', 'api']) if (H[k].length > 240) H[k].splice(0, H[k].length - 240);
    }
    if (!H.lastRisk || now - H.lastRisk >= 30 * SEC) {
      H.lastRisk = now;
      const eq = equityInfo(), pf = state.portfolio;
      pf.peakEquity = Math.max(pf.peakEquity || eq.equity, eq.equity);
      const dd = pf.peakEquity > 0 ? (pf.peakEquity - eq.equity) / pf.peakEquity * 100 : 0;
      pf.maxDD = Math.max(pf.maxDD || 0, dd);
      const pr = portfolioRisk();
      H.risk.push({ t: now, exposurePct: m2(eq.exposurePct), ddPct: m2(dd), risk: pr.score, equity: m2(eq.equity) });
      if (H.risk.length > 480) H.risk.splice(0, H.risk.length - 480);
      if (state.positions.length || !H.equity.length || now - H.equity[H.equity.length - 1].t > 10 * MIN) { H.equity.push({ t: now, v: m2(eq.equity), realized: m2(pf.realized) }); if (H.equity.length > 500) H.equity.shift(); }
    }
  }
  function portfolioRisk() {
    const eq = equityInfo(); let w = 0, tot = 0;
    for (const p of state.positions) { const t = state.markets.get(p.tokenId); const r = t && t.A ? t.A.risk.total : 60; tot += r * p.costUsd; w += p.costUsd; }
    const posRisk = w > 0 ? tot / w : 0;
    const expF = clamp(eq.exposurePct / Math.max(1, S().maxExposurePct), 0, 1.5);
    return { score: Math.round(clamp(posRisk * (0.4 + 0.6 * expF), 0, 100)), posRisk: Math.round(posRisk), exposurePct: eq.exposurePct };
  }

  /* ---------- Scanner (Lock, Scan IDs, kein paralleler Vollscan) ---------- */
  /* o.awaitTrades = false (laufender Bot): nicht auf Käufe/Verkäufe warten. Standard (Tests, manuell): warten. */
  async function scanOnce(o = {}) {
    const sc = state.scanner;
    if (sc.lock) { sc.skipped++; if (S().debugMode) log.debug('SCANNER', 'Scan übersprungen – vorheriger Scan läuft noch (Scanner Lock)'); return { skipped: true }; }
    sc.lock = true;
    const scanId = ++sc.id, t0 = env.now();
    try {
      dayRollover();
      http.tick();
      await discovery();
      await Promise.all([fetchMarket(), updateSolPrice()]);
      await crossCheck();
      rpcPing().catch(e => noteApiError('rpc', e));
      ohlcvForPositions();
      const ta = env.now(); analyzeAll(); state.metrics.perf.analysis = env.now() - ta;
      const exits = managePositions();
      try { learnFollowUps(); learnRun(false); } catch (e) { log.error('LEARNING', 'Lernlauf fehlgeschlagen: ' + e.message); }
      runAlerts();
      try { monitorTick(env.now()); } catch (e) { log.error('SYSTEM', 'Anomalie-Monitor: ' + e.message); }
      const buys = laneOf(maybeAutoTrade(), 'Auto-Trading');
      if (o.awaitTrades !== false) await Promise.all([exits, buys]);
      state.bot.errorStreak = 0;
      return { scanId };
    } catch (e) {
      sc.errors++; state.bot.errorStreak++; state.bot.lastError = e.message;
      log.error('SCANNER', `Scan #${scanId} fehlgeschlagen: ${e.message}`);
      if (state.bot.errorStreak >= 5 && !S().autoSafeMode) { if (state.bot.errorStreak === 5) alert('SYSTEM', null, 'Wiederholte Scan-Fehler – automatischer Safe Mode ist aus, der Bot handelt weiter: ' + e.message, 'WARNING', { key: 'scanerr' }); }
      else if (state.bot.errorStreak >= 5 && !['ERROR', 'EMERGENCY_STOP', 'STOPPED'].includes(state.bot.state)) {
        setBotState('ERROR', e.message); state.bot.errorAt = env.now(); state.bot.safeMode = true; state.bot.safeAuto = true;
        alert('SYSTEM', null, 'Wiederholte Scan-Fehler – Safe Mode aktiviert: ' + e.message, 'CRITICAL', { key: 'scanerr' });
      }
      return { scanId, error: e.message };
    } finally {
      try { updateReadiness(); sampleMetrics(); } catch (e) { log.error('SYSTEM', 'Readiness/Metrics: ' + e.message); }
      sc.lock = false; sc.lastAt = env.now(); sc.lastDuration = env.now() - t0;
      state.metrics.perf.scan = sc.lastDuration; state.metrics.counters.scans++;
      sc.scansWindow.push(env.now()); while (sc.scansWindow.length && env.now() - sc.scansWindow[0] > 10 * SEC) sc.scansWindow.shift();
      persist(); emit('scan', { scanId });
    }
  }
  function loop() {
    if (!state.scanner.running) return;
    const started = env.now();
    scanOnce({ awaitTrades: false }).finally(() => {
      if (!state.scanner.running) return;
      const base = S().scanIntervalMs;
      const delay = http.status('dexPairs') === 'OFFLINE' ? Math.min(base * 5, 15000) : Math.max(base - (env.now() - started), 100);
      state.scanner.nextAt = env.now() + delay;
      setT('scan', loop, delay);
    });
  }
  function secLoop() {
    if (!state.scanner.running) return;
    processSecurity().catch(e => log.error('SECURITY', e.message)).finally(() => { if (state.scanner.running) setT('sec', secLoop, 1500); });
  }
  function startScanner() {
    if (state.scanner.running) return false;
    state.scanner.running = true;
    loop(); secLoop();
    log.info('SCANNER', `Scanner gestartet (Intervall ${S().scanIntervalMs} ms)`);
    return true;
  }
  function stopScanner() {
    if (!state.scanner.running) return false;
    state.scanner.running = false;
    clearT('scan'); clearT('sec');
    http.abortAll();
    log.info('SCANNER', 'Scanner gestoppt – Timer gelöscht, Requests abgebrochen');
    return true;
  }

  /* ---------- Bot Control ---------- */
  function start() {
    const b = state.bot;
    if (b.emergency) return { ok: false, error: 'Emergency Stop aktiv – zuerst freigeben' };
    b.desired = 'RUNNING';
    if (b.state === 'PAUSED') { setBotState(isReady() ? 'RUNNING' : 'RECOVERING', 'fortgesetzt'); audit('USER', 'RESUME', ''); persist(); return { ok: true }; }
    if (['RUNNING', 'RECOVERING', 'STARTING'].includes(b.state)) return { ok: true };
    setBotState('STARTING', 'Start angefordert'); b.startedAt = env.now();
    startScanner();
    setBotState('RECOVERING', 'Warte auf ausreichende Datenqualität');
    audit('USER', 'START', ''); persistNow();
    return { ok: true };
  }
  function pause() {
    const b = state.bot; b.desired = 'PAUSED';
    if (['RUNNING', 'RECOVERING'].includes(b.state)) setBotState('PAUSED', 'keine neuen Auto-Trades, Scanner & Exits laufen weiter');
    state.queue = []; audit('USER', 'PAUSE', ''); persistNow();
    return { ok: true };
  }
  function stop() {
    const b = state.bot; b.desired = 'STOPPED';
    stopScanner();
    for (const q of state.queue) log.info('TRADE', `Queue-Eintrag ${q.tokenId} beim Stop verworfen`);
    state.queue = [];
    if (b.state !== 'STOPPED') setBotState('STOPPED', 'Clean Stop');
    audit('USER', 'STOP', state.positions.length ? `${state.positions.length} offene Position(en) werden NICHT überwacht` : '');
    persistNow();
    return { ok: true, warning: state.positions.length ? 'Offene Positionen werden bei gestopptem Bot nicht überwacht.' : null };
  }
  async function emergencyStop(reason = 'Manuell ausgelöst') {
    const b = state.bot;
    if (b.emergency) return { ok: true };
    b.emergency = true; b.emergencyReason = str(reason, 120); b.autoTrading = false;
    if (!setBotState('EMERGENCY_STOP', reason)) b.state = 'EMERGENCY_STOP';
    const cancelled = state.queue.length; state.queue = [];
    for (const o of state.orders) if (['DETECTED', 'QUEUED'].includes(o.state)) { try { transition(o, 'CANCELLED', 'Emergency Stop'); } catch (e) { /* bereits terminal */ } }
    log.crit('SYSTEM', `EMERGENCY STOP: ${reason} – neue Käufe blockiert, ${cancelled} Queue-Einträge verworfen`);
    audit('USER', 'EMERGENCY_STOP', reason);
    alert('SYSTEM', null, `EMERGENCY STOP aktiv: ${reason}`, 'CRITICAL', { key: 'estop', cooldownMs: 0 });
    persistNow();
    if (S().estopPositionRule === 'close') for (const p of [...state.positions]) await executeSell(p.id, 'ALL', 'EMERGENCY', { emergency: true, detail: 'Emergency Stop – Positionsregel „schließen“' });
    if (!S().keepScannerOnEstop) stopScanner();
    emit('bot', { to: 'EMERGENCY_STOP' });
    return { ok: true };
  }
  function releaseEmergency() {
    const b = state.bot; if (!b.emergency) return { ok: true };
    b.emergency = false; b.emergencyReason = ''; b.desired = 'PAUSED';
    if (!setBotState('PAUSED', 'Emergency Stop freigegeben – Bot pausiert, Start erforderlich')) b.state = 'PAUSED';
    if (!state.scanner.running) startScanner();
    audit('USER', 'EMERGENCY_RELEASE', ''); log.warn('SYSTEM', 'Emergency Stop freigegeben – Bot bleibt PAUSED bis START');
    persistNow();
    return { ok: true };
  }
  /* Master-Status: READY · WAITING · BLOCKED · ERROR · EMERGENCY_STOP (+ Lebenszyklus STOPPED/PAUSED). */
  function readiness() {
    const b = state.bot, now = env.now(), ss = state.metrics.scanStats || {};
    if (b.emergency) return { state: 'EMERGENCY_STOP', reason: 'Not-Aus aktiv' + (b.emergencyReason ? ': ' + b.emergencyReason : ''), hard: [mkBlocker('EMERGENCY_STOP')], soft: [] };
    if (b.state === 'ERROR') return { state: 'ERROR', reason: 'Technischer Fehler: ' + (b.lastError || 'unbekannt'), hard: [], soft: [] };
    if (b.state === 'STOPPED') return { state: 'STOPPED', reason: 'Scanner gestoppt – START drücken', hard: [], soft: [] };
    const gb = globalBlockers({ auto: false });
    const hard = gb.filter(x => HARD_GLOBAL.has(x.code)), soft = gb.filter(x => !HARD_GLOBAL.has(x.code));
    if (b.state === 'PAUSED') return { state: 'PAUSED', reason: 'Pausiert – Scanner & Exits laufen, keine neuen Auto-Trades', hard, soft };
    const fresh = [...state.markets.values()].some(t => t.snap && now - t.snap.fetchedAt < S().staleAfterSec * SEC);
    if (b.state === 'RECOVERING' || b.state === 'STARTING') {
      if (!fresh && now - (b.startedAt || now) > 45 * SEC) hard.unshift(mkBlocker('SYSTEM_UNHEALTHY', 'Keine frischen Marktdaten seit Start (' + http.status('dexPairs') + ')'));
      else if (!hard.length) return { state: 'WAITING', reason: 'Start/Recovery – Datenqualität wird geprüft', hard, soft };
    }
    if (hard.length) return { state: 'BLOCKED', reason: hard[0].msg, hard, soft };
    if ((ss.candidates || 0) > 0) {
      const wait = [...state.markets.values()].filter(t => t.D && t.D.decision === 'BUY_CANDIDATE').map(t => t.D.execBlockers[0]).filter(Boolean)[0];
      return { state: 'READY', reason: `${ss.candidates} Kandidat(en) – ${ss.approved ? ss.approved + ' freigegeben' : 'Ausführung wartet: ' + (wait ? wait.msg : '—')}`, hard, soft };
    }
    const top = Object.entries(state.metrics.rejectReasons || {}).sort((a, x) => x[1] - a[1])[0];
    return { state: 'WAITING', reason: 'Kein geeignetes Setup' + (top ? ` – häufigster Grund: ${(BLOCKER_DEFS[top[0]] || [])[2] || top[0]} (${top[1]}×)` : ''), hard, soft };
  }
  /* LIVE-Gating: LIVE nur separat, ausdrücklich und wenn ALLE Voraussetzungen erfüllt sind. Auto-Trading bedeutet nie Echtgeld. */
  function liveReadiness() {
    const w = state.wallet, s = S(), now = env.now(), h = systemHealth();
    const hardErr = validateSettings(s, s).errors.filter(e => !e.soft).length;
    const checks = [
      { name: 'Wallet verbunden', ok: w.status === 'CONNECTED', detail: w.status === 'CONNECTED' ? `${w.provider} · ${shortAddr(w.pubkey)}` : 'nicht verbunden' },
      { name: 'Netzwerk mainnet-beta (Genesis-Hash via RPC)', ok: w.network === 'mainnet-beta' && now - w.networkAt < 10 * MIN, detail: w.network ? `${w.network} · ${fmtAge(now - w.networkAt)} alt` : 'nicht verifiziert' },
      { name: 'Balance verifiziert (RPC)', ok: w.balanceLamports != null && now - w.balanceAt < 5 * MIN, detail: w.balanceLamports != null ? lamportsToSol(BigInt(w.balanceLamports)) + ' SOL' : 'unbekannt' },
      { name: 'Risikolimits geprüft (alle aktiv, kein Lernmodus)', ok: hardErr === 0 && s.maxPositionPct <= 5 && s.dailyLossLimitPct > 0 && s.dailyLossLimitPct <= 10 && s.maxExposurePct <= 30 && s.ddStopPct > 0 && s.maxOpenPositions > 0 && s.maxBuysPerCoin > 0 && s.addOnlyInProfit, detail: `Position ≤ 5 % (${s.maxPositionPct}), Tagesverlust 1–10 % (${s.dailyLossLimitPct || 'aus'}), Exposure ≤ 30 % (${s.maxExposurePct}), Drawdown-Grenze an (${s.ddStopPct || 'aus'}), Positionen begrenzt (${s.maxOpenPositions || 'aus'}), Käufe pro Coin begrenzt (${s.maxBuysPerCoin || 'aus'}), Nachkauf nur im Gewinn (${s.addOnlyInProfit ? 'an' : 'aus'})` },
      { name: 'Ehrliche Ausführung (echte Kursangebote, Honeypot-Schutz, Kostenprüfung)', ok: s.realQuotes && !s.quoteFallback && s.honeypotBlock && s.maxRoundTripLossPct > 0 && s.maxRoundTripLossPct <= 20, detail: `Jupiter-Angebote ${s.realQuotes ? 'an' : 'aus'}, ohne Schätz-Rückfall (${s.quoteFallback ? 'Rückfall an' : 'ok'}), Honeypot-Schutz ${s.honeypotBlock ? 'an' : 'aus'}, Rundreise-Kosten ≤ 20 % (${s.maxRoundTripLossPct || 'aus'})` },
      { name: 'Emergency Stop aus', ok: !state.bot.emergency, detail: state.bot.emergency ? 'aktiv' : 'aus' },
      { name: 'System Health ausreichend', ok: h.score >= s.minSystemHealth, detail: `${h.score} / min. ${s.minSystemHealth}` },
      { name: 'Kein offener Abgleich', ok: !state.reconciliation.required, detail: state.reconciliation.required ? 'RECONCILIATION REQUIRED' : 'ok' },
      { name: 'Swap-/Routing-Provider', ok: false, detail: `NOT AVAILABLE – Execution-Provider „${liveProvider.id}“ ist nicht angebunden (${EXEC_FAIL.NO_ROUTER}); aktiv: ${simProvider.id}` },
      { name: 'Signatur-Workflow', ok: false, detail: 'vorbereitet, aber deaktiviert – keine Transaktionen werden signiert' }
    ];
    return { ready: checks.every(c => c.ok), checks };
  }
  /* Vorbereitung Live-Order: alle Prüfungen, die vor einer echten Order bestehen müssten. Bei Unsicherheit NO TRADE. */
  function preLiveChecks(t, sizeUsd) {
    const s = S(), now = env.now(), A = t && t.A, w = state.wallet;
    if (!A) return [{ name: 'Analyse', ok: false, detail: 'keine Daten' }];
    const es = effectiveSnap(t, now, s), imp = estImpact(sizeUsd, A.liq.usd), fees = estFees(sizeUsd), sol = state.sol && state.sol.usd;
    const balUsd = w.balanceLamports != null && isNum(sol) ? Number(w.balanceLamports) / 1e9 * sol : null;
    const eq = equityInfo();
    return [
      { name: 'Mint', ok: isMint(t.mint) && !!(t.sec && t.sec.sources.rpc), detail: shortAddr(t.mint) + (t.sec && t.sec.sources.rpc ? ' · on-chain geprüft' : ' · nicht on-chain geprüft') },
      { name: 'Pool', ok: isMint(A.core.pairAddress), detail: A.core.pairAddress ? shortAddr(A.core.pairAddress) + ' · ' + (A.core.dexId || '—') : 'unbekannt' },
      { name: 'Route', ok: false, detail: 'kein Routing-Provider (NOT AVAILABLE)' },
      { name: 'Liquidität', ok: isNum(A.liq.usd) && A.liq.usd >= s.minLiq, detail: fmtUsd(A.liq.usd) + ' / min. ' + fmtUsd(s.minLiq) },
      { name: 'Slippage / Price Impact', ok: imp != null && imp * 100 <= s.maxSlippagePct, detail: imp != null ? (imp * 100).toFixed(3) + ' % / max. ' + s.maxSlippagePct + ' %' : 'nicht schätzbar' },
      { name: 'Balance', ok: balUsd != null && fees != null && balUsd >= sizeUsd + fees.total, detail: balUsd != null ? fmtUsd(balUsd) + ' verfügbar' : 'Wallet-Balance unbekannt' },
      { name: 'Position Size', ok: isNum(sizeUsd) && sizeUsd > 0 && sizeUsd <= eq.equity * s.maxPositionPct / 100, detail: fmtUsd(sizeUsd) + ' / max. ' + fmtUsd(eq.equity * s.maxPositionPct / 100) },
      { name: 'Risk Limit', ok: A.risk.total <= s.maxRiskScore && A.risk.level !== 'CRITICAL', detail: A.risk.total + ' ' + A.risk.level + ' / max. ' + s.maxRiskScore },
      { name: 'Security', ok: ['VERIFIED', 'PARTIAL'].includes(A.sec.status) && !A.sec.stale, detail: A.sec.status },
      { name: 'Datenfrische', ok: !!es.snap && !es.fallback && es.age <= s.snapshotMaxAgeSec * SEC, detail: es.age != null ? fmtAge(es.age) + ' alt (max. ' + s.snapshotMaxAgeSec + ' s)' : 'keine Daten' },
      { name: 'Duplicate-Schutz', ok: !state.locks.has(t.id) && !state.queue.some(q => q.tokenId === t.id), detail: state.locks.has(t.id) ? 'laufende Order' : 'frei' }
    ];
  }
  function setMode(m) {
    if (m === 'LIVE') {
      const lr = liveReadiness();
      log.sec('LIVE-Modus angefragt – Gating nicht erfüllt: ' + lr.checks.filter(c => !c.ok).map(c => c.name).join(', '));
      audit('USER', 'MODE_LIVE_DENIED', 'Gating: ' + lr.checks.filter(c => !c.ok).map(c => c.name).join(', '));
      return { ok: false, error: 'LIVE nicht aktivierbar – Voraussetzungen fehlen (REQUIRES EXTERNAL PROVIDER).', checks: lr.checks };
    }
    if (!['SIMULATION', 'PAPER', 'READ_ONLY'].includes(m)) return { ok: false, error: 'Unbekannter Modus' };
    const from = state.mode; if (from === m) return { ok: true };
    state.mode = m; state.queue = [];
    audit('USER', 'MODE', `${from} → ${m}`); log.info('SYSTEM', `Modus: ${from} → ${m}`);
    persistNow(); emit('bot', {});
    return { ok: true };
  }
  function setAutoTrading(on) {
    const b = state.bot;
    if (on) {
      if (state.mode !== 'SIMULATION') return { ok: false, error: `Auto-Trading nur im SIMULATION-Modus (aktuell ${state.mode})` };
      if (b.emergency) return { ok: false, error: 'Emergency Stop aktiv' };
      if (state.risk.dailyLimitHit && S().dailyLossLimitPct > 0) return { ok: false, error: 'Tagesverlust-Limit erreicht – heute kein Auto-Trading' };
    }
    b.autoTrading = !!on; audit('USER', on ? 'AUTO_TRADING_ON' : 'AUTO_TRADING_OFF', state.mode);
    log.info('SYSTEM', `Auto-Trading ${on ? 'AN' : 'AUS'} (${state.mode})`); persistNow();
    return { ok: true };
  }
  function setSafeMode(on) { state.bot.safeMode = !!on; if (!on) state.bot.safeAuto = false; audit('USER', on ? 'SAFE_MODE_ON' : 'SAFE_MODE_OFF', ''); log.info('SYSTEM', `Safe Mode ${on ? 'AN' : 'AUS'}`); persistNow(); return { ok: true }; }

  /* ---------- Settings / Strategien / Versionierung ---------- */
  const pickTunable = () => ({ minScore: S().minScore, stopLossPct: S().stopLossPct, trailPct: S().trailPct });
  function newParamVersion(params, status, note) {
    const v = state.paramVersions.reduce((mx, x) => Math.max(mx, x.version), 0) + 1;
    const pv = { version: v, ts: env.now(), params, status, note, perf: null, tradeCount: 0, basedOn: state.activeParam };
    state.paramVersions.push(pv); if (state.paramVersions.length > 40) state.paramVersions.shift();
    state.activeParam = v; return pv;
  }
  function updateSettings(patch, who = 'USER', o = {}) {
    const before = state.settings;
    const { settings, errors } = validateSettings(patch, before);
    const changes = [];
    for (const k of Object.keys(settings)) if (settings[k] !== before[k]) changes.push({ key: k, from: before[k], to: settings[k] });
    state.settings = settings; healthCache.at = -1;
    if (changes.length) {
      const mask = (k, v) => (k === 'rpcUrls' ? maskUrl(String(v).split(',')[0]) + '…' : SETTINGS_INDEX[k] && SETTINGS_INDEX[k].secret ? (v ? '••• (gesetzt)' : '(leer)') : v); // Keys nie im Protokoll
      state.configLog.unshift({ ts: env.now(), who, kind: 'settings', changes: changes.map(c => ({ ...c, from: mask(c.key, c.from), to: mask(c.key, c.to) })) });
      if (state.configLog.length > 200) state.configLog.length = 200;
      log.info('SYSTEM', `Konfiguration geändert (${who}): ${changes.map(c => c.key).join(', ')}`);
      if (!o.noVersion && changes.some(c => c.key in TUNING_BOUNDS)) newParamVersion(pickTunable(), 'STABLE', 'Manuelle Änderung');
    }
    persistNow(); emit('settings', {});
    return { errors, changes };
  }
  function updateStrategies(patch, who = 'USER') {
    const before = state.strategies;
    const { strategies, errors } = validateStrategies(patch, before);
    const changes = [];
    for (const id of Object.keys(strategies)) for (const k of Object.keys(strategies[id])) if (strategies[id][k] !== before[id][k]) changes.push({ key: id + '.' + k, from: before[id][k], to: strategies[id][k] });
    state.strategies = strategies;
    if (changes.length) { state.configLog.unshift({ ts: env.now(), who, kind: 'strategy', changes }); log.info('SYSTEM', `Strategie geändert: ${changes.map(c => c.key).join(', ')}`); }
    persistNow(); emit('settings', {});
    return { errors, changes };
  }
  function applyTunable(params, who) {
    const patch = {};
    for (const [k, [lo, hi]] of Object.entries(TUNING_BOUNDS)) if (isNum(params[k])) patch[k] = clamp(params[k], lo, hi);
    return updateSettings(patch, who, { noVersion: true });
  }
  /* Parameter-Versionen überwachen: Kennzahlen je Version, automatischer Rollback schlechterer Kandidaten (nur SIMULATION).
     Neue Parameter entstehen seit 2.7.0 ausschließlich über die Lern-KI (Train/Validation/Test, Walk-Forward, Shadow, Rollback) –
     die frühere naive Suche über alle Trades (ohne Out-of-Sample-Nachweis) ist entfernt. Harte Limits unveränderbar. */
  let tuneHintAt = -Infinity;
  function maybeTune() {
    const s = S(); if (!s.ffAutoTuning || state.mode !== 'SIMULATION') return;
    const cur = state.paramVersions.find(p => p.version === state.activeParam); if (!cur) return;
    const minN = Math.max(1, s.minTradesForTuning);
    const trades = state.journal.filter(j => j.status === 'CLOSED' && j.paramVersion === cur.version && j.mode === 'SIMULATION');
    cur.tradeCount = trades.length;
    if (trades.length < minN) return;
    const perf = perfStats(trades);
    if (cur.status === 'CANDIDATE') {
      const base = state.paramVersions.find(p => p.version === cur.basedOn);
      if (base && base.perf && isNum(base.perf.expectancy) && isNum(perf.expectancy) && (perf.expectancy < base.perf.expectancy - Math.abs(base.perf.expectancy) * 0.1 || perf.maxDD > base.perf.maxDD * 1.25 + 1e-9)) {
        cur.status = 'ROLLED_BACK'; cur.perf = perf;
        applyTunable(base.params, 'AUTO_ROLLBACK'); state.activeParam = base.version; base.status = 'STABLE';
        state.configLog.unshift({ ts: env.now(), who: 'AUTO_ROLLBACK', kind: 'strategy', changes: [{ key: 'paramVersion', from: cur.version, to: base.version }] });
        log.risk(`Auto-Rollback: Version ${cur.version} schlechter als ${base.version} (Expectancy ${fmtUsd(perf.expectancy)} vs ${fmtUsd(base.perf.expectancy)})`);
        alert('RISK', null, `Auto-Rollback auf Parameter-Version ${base.version}`, 'WARNING', { key: 'rollback', cooldownMs: 0 });
        return;
      }
      cur.status = 'STABLE';
    }
    cur.perf = perf;
    if (!s.learnEnabled && env.now() - tuneHintAt > DAY) { tuneHintAt = env.now(); log.info('LEARNING', 'Auto-Tuning schlägt keine Parameter vor, solange die Lern-KI aus ist – Optimierung nur mit Out-of-Sample-Nachweis über die Lern-KI'); }
  }
  function rollbackTo(version) {
    const pv = state.paramVersions.find(p => p.version === version); if (!pv) return { ok: false, error: 'Version nicht gefunden' };
    applyTunable(pv.params, 'USER_ROLLBACK'); state.activeParam = pv.version;
    log.info('SYSTEM', `Parameter-Version ${version} manuell aktiviert`); persistNow();
    return { ok: true };
  }

  /* ---------- Watchlist ---------- */
  function addWatch(id) {
    const mint = mintOfId(id) || id; if (!isMint(mint)) return { ok: false, error: 'Ungültige Mint-Adresse' };
    const tid = tokenIdOf(mint);
    if (!state.watchlist[tid]) { const t = ensureToken(mint, 'Watchlist'); state.watchlist[tid] = { note: '', priority: 2, alerts: true, priceAbove: null, priceBelow: null, scoreAbove: null, addedAt: env.now(), symbol: t ? t.symbol : '' }; log.info('UI', `Watchlist: ${t ? t.symbol : shortAddr(mint)} hinzugefügt`); }
    persist(); return { ok: true };
  }
  function removeWatch(id) { delete state.watchlist[id]; persist(); return { ok: true }; }
  function updateWatch(id, patch) {
    const w = state.watchlist[id]; if (!w) return { ok: false };
    if ('note' in patch) w.note = str(String(patch.note), 200);
    if ('priority' in patch) w.priority = clamp(Math.round(+patch.priority) || 2, 1, 3);
    if ('alerts' in patch) w.alerts = !!patch.alerts;
    for (const k of ['priceAbove', 'priceBelow', 'scoreAbove']) if (k in patch) { const v = patch[k] === '' || patch[k] == null ? null : Number(patch[k]); w[k] = v == null ? null : Number.isFinite(v) && v > 0 ? (k === 'scoreAbove' ? clamp(Math.round(v), 1, 100) : v) : w[k]; }
    persist(); return { ok: true };
  }

  /* ---------- Wallet (nur lesend: Public Key + Balance, keine Signaturen) ---------- */
  /* Wallet-Adapter (gekapselt): Provider, Verbindungsstatus, Public Key, Netzwerk, Balance, Signatur-Workflow.
     Private Keys / Seeds / Secret Keys werden NIE gelesen, gespeichert oder geloggt. Signieren ist deaktiviert. */
  const walletHooked = new WeakSet();
  const providerName = p => (p.isPhantom ? 'Phantom' : p.isSolflare ? 'Solflare' : p.isBackpack ? 'Backpack' : 'Wallet');
  function walletReset(status, error) {
    state.wallet = { status, pubkey: null, provider: null, network: null, networkAt: 0, balanceLamports: null, balanceAt: 0, error: error || '' };
  }
  function hookProvider(prov) {
    if (walletHooked.has(prov) || typeof prov.on !== 'function') return;
    walletHooked.add(prov);
    try {
      prov.on('accountChanged', pk => {
        const k = pk && typeof pk.toString === 'function' ? pk.toString() : null;
        if (!isMint(k)) { walletReset('NOT_CONNECTED'); log.info('SYSTEM', 'Wallet: Konto getrennt'); }
        else { state.wallet.pubkey = k; state.wallet.balanceLamports = null; state.wallet.balanceAt = 0; log.info('SYSTEM', 'Wallet: Konto gewechselt ' + shortAddr(k)); walletBalance(); }
        emit('bot', {});
      });
      prov.on('disconnect', () => { walletReset('NOT_CONNECTED'); log.info('SYSTEM', 'Wallet getrennt (Provider)'); emit('bot', {}); });
    } catch (e) { /* Provider ohne Events */ }
  }
  async function walletNetwork() {
    try { const g = await rpcCall('getGenesisHash', [], { cacheMs: 10 * MIN }); state.wallet.network = GENESIS[g] || 'unbekannt'; state.wallet.networkAt = env.now(); }
    catch (e) { state.wallet.network = null; state.wallet.error = 'Netzwerk nicht verifiziert: ' + e.message; }
  }
  /* silent: stille Wiederverbindung nur, wenn die Wallet dieser Seite bereits vertraut (onlyIfTrusted) – kein Popup, keine Signatur. */
  async function walletConnect(o = {}) {
    if (state.wallet.status === 'CONNECTING') return { ok: false, error: 'Verbindung läuft bereits' };
    const prov = env.walletProvider ? env.walletProvider() : null;
    if (!prov || typeof prov.connect !== 'function') { if (!o.silent) walletReset('NO_PROVIDER'); return { ok: false, error: 'Kein Wallet-Provider gefunden (z. B. Phantom- oder Solflare-Extension bzw. deren In-App-Browser).' }; }
    state.wallet.status = 'CONNECTING';
    try {
      const r = await (o.silent ? prov.connect({ onlyIfTrusted: true }) : prov.connect());
      const pkObj = (r && r.publicKey) || prov.publicKey; const pk = pkObj && typeof pkObj.toString === 'function' ? pkObj.toString() : null;
      if (!isMint(pk)) throw new Error('Wallet lieferte keinen gültigen Public Key');
      state.wallet = { status: 'CONNECTED', pubkey: pk, provider: providerName(prov), network: null, networkAt: 0, balanceLamports: null, balanceAt: 0, error: '' };
      hookProvider(prov);
      audit('USER', o.silent ? 'WALLET_RECONNECT' : 'WALLET_CONNECT', shortAddr(pk)); log.info('SYSTEM', `Wallet ${o.silent ? 'wieder' : ''}verbunden (nur lesend): ${shortAddr(pk)}`);
      await Promise.all([walletBalance(), walletNetwork()]);
      return { ok: true };
    } catch (e) { if (o.silent) { walletReset('NOT_CONNECTED'); return { ok: false, error: 'stille Wiederverbindung nicht möglich' }; } walletReset('ERROR', str(e && e.message, 120) || 'Verbindung abgelehnt'); return { ok: false, error: state.wallet.error }; }
  }
  async function walletBalance() {
    if (state.wallet.status !== 'CONNECTED') return;
    try { const r = await rpcCall('getBalance', [state.wallet.pubkey, { commitment: 'confirmed' }]); if (r && isNum(r.value) && r.value >= 0) { state.wallet.balanceLamports = String(Math.round(r.value)); state.wallet.balanceAt = env.now(); state.wallet.error = ''; } }
    catch (e) { state.wallet.error = 'Balance nicht verifiziert: ' + e.message; }
  }
  function walletDisconnect() {
    const prov = env.walletProvider ? env.walletProvider() : null;
    try { if (prov && prov.disconnect) prov.disconnect(); } catch (e) { /* ignorieren */ }
    walletReset('NOT_CONNECTED');
    audit('USER', 'WALLET_DISCONNECT', '');
  }
  /* Signatur-Workflow: vorbereitet (klare Schnittstelle), aber deaktiviert – es wird nichts signiert. */
  async function requestSignature() {
    log.sec('Signatur angefragt – abgelehnt: Signatur-Workflow deaktiviert (kein Live-Provider)');
    return { ok: false, code: 'SIGNING_DISABLED', error: 'Signieren ist deaktiviert – LIVE ist nicht verfügbar.' };
  }

  /* ---------- Diagnose: Warum kauft der Bot nicht? ---------- */
  function diagnostics() {
    const now = env.now(), s = S(), b = state.bot, r = state.risk, h = systemHealth(), eq = equityInfo(), st = state.metrics.scanStats || {};
    const rd = readiness();
    const system = [], trading = [], market = [];
    const c = (list, name, status, detail) => list.push({ name, status, detail });
    // System & harte Sicherheitsblocker (rot nur bei echter Blockade)
    c(system, 'Emergency Stop', b.emergency ? 'fail' : 'pass', b.emergency ? 'AKTIV: ' + b.emergencyReason : 'aus');
    c(system, 'Bot-Lebenszyklus', b.state === 'RUNNING' ? 'pass' : b.state === 'ERROR' ? 'fail' : 'warn', `Status ${b.state}`);
    c(system, 'System Health', h.score >= s.minSystemHealth ? 'pass' : 'fail', `${h.score} / min. ${s.minSystemHealth}`);
    c(system, 'Marktdaten (DexScreener)', http.status('dexPairs') === 'ONLINE' ? 'pass' : http.status('dexPairs') === 'OFFLINE' ? 'fail' : 'warn', `${http.status('dexPairs')} · ${state.markets.size} Tokens im Universe`);
    const rpcSt = rpcEndpoints().map(e => http.status(e.name));
    c(system, 'Security-Quellen (RPC/RugCheck)', rpcSt.includes('ONLINE') || http.status('rugcheck') === 'ONLINE' ? 'pass' : rd.hard.some(x => x.code === 'SECURITY_SOURCES_DOWN') ? 'fail' : 'warn', `RPC ${rpcSt.join('/') || '—'}, RugCheck ${http.status('rugcheck')}`);
    c(system, 'SOL-Preis (Fee Engine)', state.sol && now - state.sol.at < 5 * MIN ? 'pass' : 'fail', state.sol ? `${fmtUsd(state.sol.usd)} · ${fmtAge(now - state.sol.at)} alt${state.sol.derived ? ' · abgeleitet aus SOL-Pools' : ''}` : 'unbekannt');
    c(system, 'Safe Mode', b.safeMode ? 'fail' : 'pass', b.safeMode ? 'aktiv – keine neuen Käufe' : 'aus');
    c(system, 'Abgleich (Reconciliation)', state.reconciliation.required ? 'fail' : 'pass', state.reconciliation.required ? state.reconciliation.issues.length + ' offene Punkte' : 'ok');
    c(system, 'Tagesverlust-Limit', r.dailyLimitHit ? 'fail' : 'pass', `Heute ${fmtSigned(r.dailyPnl)} / Limit −${s.dailyLossLimitPct} %`);
    c(system, 'Globale Pause', r.globalPauseUntil > now ? 'fail' : 'pass', r.globalPauseUntil > now ? `noch ${fmtAge(r.globalPauseUntil - now)} (Serie ${r.lossStreak})` : `Verlustserie ${r.lossStreak}/${s.lossStreakLimit}`);
    c(system, 'Loss-Cooldown', r.lossCooldownUntil > now ? 'fail' : 'pass', r.lossCooldownUntil > now ? `noch ${fmtAge(r.lossCooldownUntil - now)}` : 'frei');
    // Trading-Einstellungen (Hinweise, keine Blockade)
    c(trading, 'Modus', state.mode === 'SIMULATION' ? 'pass' : 'warn', `${state.mode}${state.mode === 'PAPER' ? ' – nur manuelle Trades' : state.mode === 'READ_ONLY' ? ' – Beobachtung, kein Handel' : ''}`);
    c(trading, 'Auto-Trading', b.autoTrading ? 'pass' : 'warn', b.autoTrading ? 'AN (nur SIMULATION, nie Echtgeld)' : 'AUS – der Bot analysiert nur (sichere Voreinstellung)');
    c(trading, 'Exposure', eq.exposurePct < s.maxExposurePct ? 'pass' : 'warn', `${eq.exposurePct.toFixed(1)} % / max. ${s.maxExposurePct} %`);
    c(trading, 'Offene Positionen', state.positions.length < s.maxOpenPositions ? 'pass' : 'warn', `${state.positions.length} / ${s.maxOpenPositions}`);
    const hourBuys = r.buyTimes.filter(x => now - x < HOUR).length;
    c(trading, 'Overtrading-Schutz', hourBuys < s.maxTradesPerHour ? 'pass' : 'warn', `${hourBuys} Käufe in 60 min / Limit ${s.maxTradesPerHour}`);
    // Markt (informativ – „kein Kandidat“ ist NIE ein globaler Block)
    const toks = [...state.markets.values()].filter(t => t.A && t.D);
    c(market, 'Tokens analysiert', 'info', `${st.tokens || 0} von ${state.markets.size}`);
    c(market, 'Schnellfilter bestanden', 'info', `${st.fastPass || 0} (Liquidität, Volumen, MC, Käuferanteil, Frische)`);
    c(market, 'Security VERIFIED/PARTIAL', 'info', `${toks.filter(t => t.D.fastPass && ['VERIFIED', 'PARTIAL'].includes(t.A.sec.status)).length} Kandidaten`);
    c(market, 'Mit Kaufsignal', 'info', `${st.withSignals || 0} Tokens`);
    c(market, 'Buy Candidates', 'info', `${st.candidates || 0} (Score ≥ ${s.minScore}, Konsens ≥ ${s.consensusMinWeight})`);
    const chains = toks.filter(t => t.D.fastPass || t.A.finalScore >= 45).sort((a, x) => x.A.finalScore - a.A.finalScore).slice(0, 10).map(t => ({ id: t.id, symbol: t.symbol, score: t.A.finalScore, chain: candidateChain(t) }));
    const summary = `${rd.state === 'EMERGENCY_STOP' ? 'EMERGENCY STOP' : rd.state}: ${rd.reason}. Beobachtet ${state.markets.size} Tokens · ${st.fastPass || 0} bestehen Schnellfilter · ${st.candidates || 0} Kandidaten.`;
    return { readiness: rd, system, trading, market, chains, funnel: state.metrics.funnel, summary, rejectReasons: state.metrics.rejectReasons, preTradeRejects: state.metrics.preTradeRejects };
  }
  function botHealth() {
    const now = env.now(), s = S(), sc = state.scanner, r = state.risk;
    const apis = ['dexPairs', 'dexDisc', 'gecko', 'rugcheck'].map(n => http.status(n));
    const rpcs = rpcEndpoints().map(e => http.status(e.name));
    const toks = [...state.markets.values()].filter(t => t.snap);
    const fresh = toks.length ? toks.filter(t => now - t.snap.fetchedAt <= s.staleAfterSec * SEC).length / toks.length : 0;
    const failedRecent = state.orders.filter(o => o.state === 'FAILED' && now - o.createdAt < 10 * MIN).length;
    const rl = state.metrics.perf.render;
    return [
      { name: 'Scanner', status: !sc.running ? (state.bot.state === 'STOPPED' ? 'DEGRADED' : 'ERROR') : now - sc.lastAt < Math.max(6000, s.scanIntervalMs * 5) ? 'OK' : 'DEGRADED', detail: sc.running ? `Scan #${sc.id}, ${sc.lastDuration} ms, übersprungen ${sc.skipped}` : 'gestoppt' },
      { name: 'Data', status: fresh >= 0.6 ? 'OK' : fresh > 0 ? 'DEGRADED' : 'ERROR', detail: `${Math.round(fresh * 100)} % der Tokens frisch` },
      { name: 'APIs', status: apis[0] === 'ONLINE' ? (apis.every(x => x === 'ONLINE' || x === 'UNKNOWN') ? 'OK' : 'DEGRADED') : 'ERROR', detail: apis.join(' / ') },
      { name: 'RPC', status: rpcs.includes('ONLINE') ? 'OK' : rpcs.includes('DEGRADED') || rpcs.includes('UNKNOWN') ? 'DEGRADED' : 'ERROR', detail: rpcs.join(' / ') || 'keine RPC konfiguriert' },
      { name: 'Risk', status: r.dailyLimitHit || r.globalPauseUntil > now ? 'DEGRADED' : 'OK', detail: r.dailyLimitHit ? 'Tageslimit erreicht' : r.globalPauseUntil > now ? 'globale Pause' : 'normal' },
      { name: 'Execution', status: failedRecent ? 'DEGRADED' : 'OK', detail: `${state.orders.filter(o => !TERMINAL.has(o.state)).length} aktiv, ${failedRecent} Fehler (10 min) · LIVE nicht verfügbar` },
      { name: 'Portfolio', status: (() => { const pi = portfolioIntegrity(); return pi.ok ? 'OK' : pi.issues.some(i => ['NEGATIVE_CASH', 'QTY_MISMATCH', 'DOUBLE_FILL', 'DUPLICATE_POSITION'].includes(i.code)) ? 'ERROR' : 'DEGRADED'; })(), detail: (() => { const pi = portfolioIntegrity(); return pi.ok ? `${state.positions.length} Position(en) konsistent` : pi.issues.slice(0, 2).map(i => i.code).join(', '); })() },
      { name: 'Storage', status: state.storageOk ? 'OK' : 'ERROR', detail: state.storageOk ? `gespeichert ${fmtAge(now - state.lastSaveAt)}` : store.status().lastError },
      { name: 'UI', status: rl == null ? 'OK' : rl < 50 ? 'OK' : rl < 200 ? 'DEGRADED' : 'ERROR', detail: rl == null ? '—' : `Render ${rl} ms` }
    ];
  }

  /* ---------- Monitoring: Kennzahlen der letzten Stunde + Anomalie-Monitor ----------
     Jede Anomalie hat einen Reason Code, einen Schweregrad und eine Aktion (WARN / DEGRADE / PAUSE / HARD_STOP).
     Standard „nur warnen“ (anomalyMode 'warn'); erst mit 'act' drosselt, pausiert oder stoppt der Monitor wirklich. */
  const CRIT_INTEGRITY = new Set(['NEGATIVE_CASH', 'QTY_MISMATCH', 'DOUBLE_FILL', 'DUPLICATE_POSITION']);
  /* Erwartbare Fehlschläge der ehrlichen Simulation (Stufe B) – kein Systemfehler; eigene Quote-Kennzahl statt EXEC_FAILURES. */
  const MARKET_FAIL = new Set(['TX_FAILED', 'SLIPPAGE_EXCEEDED']), ROUTE_FAIL = new Set(['NO_ROUTE']); // QUOTE_FAILED (z. B. Jupiter weg, kein Rückfall) bleibt ein Systemfehler
  const RISK_CATS = new Set(['LIMITS', 'COOLDOWN', 'PORTFOLIO']);
  function monitorMetrics() {
    const now = env.now(), s = S(), M = state.monitor;
    while (M.sigTimes.length && now - M.sigTimes[0] > HOUR) M.sigTimes.shift();
    const toks = [...state.markets.values()].filter(t => t.snap), dec = [...state.markets.values()].filter(t => t.D);
    const share = fn => (dec.length ? lr2(dec.filter(fn).length / dec.length) : null);
    const ords = state.orders.filter(o => now - o.createdAt <= HOUR), done = ords.filter(o => o.state === 'COMPLETED'), failed = ords.filter(o => o.state === 'FAILED');
    const last5 = state.orders.filter(o => o.state === 'COMPLETED' && isNum(o.latencyMs)).slice(0, 5);
    const fills = state.orders.filter(o => o.state === 'COMPLETED' && isNum(o.expSlipPct)).slice(0, 5);
    const codes = {}; for (const o of failed) codes[o.failureCode || 'UNBEKANNT'] = (codes[o.failureCode || 'UNBEKANNT'] || 0) + 1;
    const sysFailed = failed.filter(o => !MARKET_FAIL.has(o.failureCode) && !ROUTE_FAIL.has(o.failureCode)), mktFailed = failed.filter(o => MARKET_FAIL.has(o.failureCode));
    const quoted = ords.filter(o => o.quote && o.quote.source), jupN = quoted.filter(o => (o.quote.fillSource || o.quote.source) === 'JUPITER').length, fm = state.feeMarket;
    const L = state.learn, learnErr = log.entries.filter(e => e.category === 'LEARNING' && (e.level === 'ERROR' || e.level === 'CRITICAL') && now - e.ts <= HOUR).length;
    const learnStatus = !s.learnEnabled ? 'AUS' : learnErr || (L.records.length && now - L.lastRunAt > 10 * MIN) ? 'WARN' : 'OK';
    return {
      signals: { perHour: M.sigTimes.length, analyzed: dec.length },
      blocks: { security: share(t => t.D.analysisBlockers.some(b => /^SECURITY_/.test(b.code) && b.code !== 'SECURITY_UNKNOWN')), risk: share(t => [...t.D.analysisBlockers, ...t.D.execBlockers].some(b => b.code === 'RISK_TOO_HIGH' || RISK_CATS.has((BLOCKER_DEFS[b.code] || [])[1]))), approved: share(t => t.D.decision === 'APPROVED') },
      exec: { orders: ords.length, completed: done.length, failed: failed.length, failed10: sysFailed.filter(o => now - o.createdAt <= 10 * MIN).length,
        txAttempts: done.length + mktFailed.length, txFailed: mktFailed.length, txFailRate: done.length + mktFailed.length ? lr2(mktFailed.length / (done.length + mktFailed.length)) : null, failedTxFeesUsd: lr2(state.portfolio.failedTxFees || 0),
        quotes: quoted.length, jupiterShare: quoted.length ? lr2(jupN / quoted.length) : null, prioLamports: prioLamportsNow(), prioAuto: s.priorityFeeMode === 'auto' && !!fm && now - fm.at < 2 * MIN, successRate: done.length + failed.length ? lr2(done.length / (done.length + failed.length)) : null, avgLatencyMs: done.filter(o => isNum(o.latencyMs)).length ? Math.round(avg(done.map(o => o.latencyMs).filter(isNum))) : null, recentLatencyMs: last5.length >= 3 ? Math.round(avg(last5.map(o => o.latencyMs))) : null, recentSlipPct: fills.length >= 3 ? lr2(avg(fills.map(o => o.expSlipPct))) : null, failureCodes: codes },
      data: { tokens: toks.length, fresh: toks.length ? lr2(toks.filter(t => now - t.snap.fetchedAt <= s.staleAfterSec * SEC).length / toks.length) : null, primary: http.status('dexPairs') },
      learn: { status: learnStatus, enabled: !!s.learnEnabled, lastRunAgeMs: L.lastRunAt ? now - L.lastRunAt : null, records: L.records.length, followUps: L.followUps.length, nearMissOpen: L.nearMiss.open.length, drift: driftStatus(), errorsHour: learnErr }
    };
  }
  function monitorTick(now) {
    const s = S(), M = state.monitor, mm = monitorMetrics(), found = [];
    const add = (code, sev, action, msg) => found.push({ code, sev, action, msg });
    if (mm.data.tokens >= 5 && mm.data.fresh != null && mm.data.fresh < 0.5) add('DATA_STALE_WIDE', 'HIGH', 'PAUSE', `nur ${Math.round(mm.data.fresh * 100)} % der Marktdaten frisch`);
    if (mm.data.primary === 'OFFLINE') add('PRIMARY_API_DOWN', 'HIGH', 'PAUSE', 'DexScreener (Hauptquelle) offline');
    if (mm.exec.failed10 >= 3) add('EXEC_FAILURES', 'HIGH', 'PAUSE', `${mm.exec.failed10} fehlgeschlagene Orders in 10 min`);
    if (mm.exec.txAttempts >= 8 && mm.exec.txFailRate > Math.max(0.25, 3 * s.simTxFailPct / 100)) add('TX_FAIL_RATE', 'WARN', 'DEGRADE', `${Math.round(mm.exec.txFailRate * 100)} % der Transaktionen gescheitert (Slippage/Netzwerk, letzte Stunde)`);
    if (mm.exec.quotes >= 5 && s.realQuotes && mm.exec.jupiterShare != null && mm.exec.jupiterShare < 0.5) add('QUOTES_ESTIMATED', 'WARN', 'WARN', `nur ${Math.round(mm.exec.jupiterShare * 100)} % der Füllungen mit echtem Jupiter-Angebot – Rest geschätzt`);
    if (mm.exec.recentLatencyMs != null && mm.exec.recentLatencyMs > 5000) add('EXEC_SLOW', 'WARN', 'DEGRADE', `Ø Ausführungszeit ${mm.exec.recentLatencyMs} ms (letzte Orders)`);
    if (mm.exec.recentSlipPct != null && mm.exec.recentSlipPct > s.maxSlippagePct) add('SLIPPAGE_SPIKE', 'WARN', 'DEGRADE', `Ø Slippage ${mm.exec.recentSlipPct} % > ${s.maxSlippagePct} % (letzte Orders)`);
    if (state.reconciliation.required) add('RECONCILIATION', 'HIGH', 'PAUSE', 'Abgleich nach Neustart offen');
    const pi = portfolioIntegrity(), crit = pi.issues.filter(i => CRIT_INTEGRITY.has(i.code));
    if (crit.length) add('PORTFOLIO_INTEGRITY', 'CRITICAL', 'HARD_STOP', str(crit.map(i => i.msg).join(' · '), 200));
    else if (pi.issues.length) add('PORTFOLIO_CHECK', 'WARN', 'WARN', str(pi.issues.map(i => i.msg).join(' · '), 200));
    const losses30 = state.journal.filter(j => j.status === 'CLOSED' && j.result && !j.result.win && now - j.closedAt <= 30 * MIN).length;
    if (losses30 >= 5) add('LOSS_BURST', 'HIGH', 'PAUSE', `${losses30} Verluste in 30 min`);
    const eqs = state.hist.risk.filter(x => now - x.t <= HOUR && isNum(x.equity)).map(x => x.equity), eqNow = equityInfo().equity;
    if (eqs.length && isNum(eqNow)) { const top = Math.max(...eqs); if (top > 0 && (top - eqNow) / top >= 0.1) add('EQUITY_DROP', 'HIGH', 'PAUSE', `Kapital in 60 min um ${((top - eqNow) / top * 100).toFixed(1)} % gefallen`); }
    if (mm.learn.errorsHour >= 3) add('LEARNING_ERRORS', 'WARN', 'WARN', `${mm.learn.errorsHour} Fehler der Lern-KI in 60 min`);
    if (!state.storageOk) add('STORAGE_FAIL', 'HIGH', 'WARN', 'Speichern im Browser fehlgeschlagen');
    const act = s.anomalyMode === 'act', ACT_DE = { WARN: 'nur Warnung', DEGRADE: 'Positionsgröße ×0,5', PAUSE: 'neue Auto-Käufe pausiert', HARD_STOP: 'Not-Stopp' };
    const seen = new Set();
    for (const f of found) {
      seen.add(f.code);
      let a = M.active[f.code];
      if (a) { a.msg = f.msg; a.last = now; }
      else {
        a = M.active[f.code] = { ...f, since: now, last: now };
        M.history.unshift({ ts: now, code: f.code, sev: f.sev, action: f.action, msg: f.msg, event: 'START', applied: act });
        const what = act ? ACT_DE[f.action] : f.action === 'WARN' ? 'nur Warnung' : `nur Warnung (Modus „nur warnen“, sonst: ${ACT_DE[f.action]})`;
        log.warn('SYSTEM', `Anomalie ${f.code}: ${f.msg} → ${what}`);
        alert('SYSTEM', null, `Anomalie ${f.code}: ${f.msg} → ${what}`, f.sev === 'CRITICAL' ? 'CRITICAL' : 'WARNING', { key: 'anom:' + f.code, cooldownMs: 10 * MIN });
      }
      // Not-Stopp genau einmal je Anomalie (auch wenn erst später auf „handeln“ umgestellt wird)
      if (act && f.action === 'HARD_STOP' && !a.stopDone && !state.bot.emergency) { a.stopDone = true; emergencyStop('Anomalie-Monitor: ' + f.msg).catch(e => log.error('SYSTEM', 'Not-Stopp fehlgeschlagen: ' + e.message)); }
    }
    for (const code of Object.keys(M.active)) if (!seen.has(code)) {
      const a = M.active[code]; delete M.active[code];
      M.history.unshift({ ts: now, code, sev: a.sev, action: a.action, msg: 'behoben', event: 'END', applied: act });
      log.info('SYSTEM', `Anomalie ${code} behoben (seit ${fmtAge(now - a.since)})`);
    }
    if (M.history.length > 50) M.history.length = 50;
    return { active: Object.values(M.active), metrics: mm };
  }
  const anomalyActive = action => S().anomalyMode === 'act' ? Object.values(state.monitor.active).find(a => a.action === action) || null : null;

  /* ---------- ADAPTIVE LOSS INTELLIGENCE: Orchestrierung ----------
     Trade schließt → Learning Record (Features zum Einstieg, Preispfad, Exit) → Labels & Ursachen → Counterfactuals →
     Pattern-Aggregate → 15-min-Nachlauf. Periodisch: Drift, Kalibrierung, Loss-Modell, Lessons, Hypothesen, Research Queue,
     ein Experiment je Lauf → validierter Challenger im Shadow → Übernahme (nur SIMULATION) → Live-Überwachung → Auto-Rollback.
     Lernfehler stören nie den Handel (try/catch, eigene Log-Kategorien). Gelernte Regeln verschärfen nur Einstiegsfilter. */
  const lrev = { learning: 0, experiments: 0, models: 0, patterns: 0 }, lsaved = { learning: -1, experiments: -1, models: -1, patterns: -1 };
  const touch = (...ks) => { for (const k of ks) lrev[k]++; };
  let learnDue = false;
  const learnCache = { at: -1, stats: [], base: null, fam: null };
  function learnTimeline(type, text, ref) {
    state.learn.timeline.unshift({ ts: env.now(), type, text: str(String(text), 300), ref: ref || null });
    if (state.learn.timeline.length > LEARN_CAPS.timeline) state.learn.timeline.length = LEARN_CAPS.timeline;
    touch('learning');
  }
  const learnParamsNow = () => pickLearn(S());
  const curParams = () => ({ ...learnParamsNow(), trailActivatePct: S().trailActivatePct, tp3Pct: S().tp3Pct, rules: deepClone(state.models.rules) });
  const champion = () => state.models.versions.find(v => v.id === state.models.champion) || null;
  const challenger = () => (state.models.challenger ? state.models.versions.find(v => v.id === state.models.challenger) || null : null);
  const hypOf = id => state.research.hypotheses.find(h => h.id === id) || null;
  const learnRecs = () => state.learn.records.filter(learnable); // nur saubere Records lernen (recordQuality)
  const driftStatus = () => (state.learn.drift ? state.learn.drift.status : 'NOT_ENOUGH_DATA');
  /* Immer nur ein Challenger gleichzeitig; kein neuer, solange ein übernommenes Modell noch überwacht wird oder Drift vorliegt. */
  const slotFree = () => !challenger() && driftStatus() !== 'DRIFT' && !(champion() && champion().status === 'LIVE');
  function capVersions() {
    const M = state.models; if (M.versions.length <= LEARN_CAPS.versions) return;
    const keep = new Set([M.champion, M.challenger, 'M-1']); let v = champion(); while (v && v.basedOn) { keep.add(v.basedOn); v = M.versions.find(x => x.id === v.basedOn); }
    while (M.versions.length > LEARN_CAPS.versions) { const i = M.versions.findIndex(x => !keep.has(x.id)); if (i < 0) break; M.versions.splice(i, 1); }
  }

  /* Kohorten-Kontext für Labels – nur Trades, die VOR diesem Trade geschlossen wurden (kein Look-Ahead). */
  function labelCtx(rec) {
    const prior = state.learn.records.filter(r => learnable(r) && r.tradeId !== rec.tradeId && r.closedAt <= rec.closedAt && r.outcome && isNum(r.outcome.pnlPct));
    const losses = prior.filter(r => !r.outcome.win && isNum(r.outcome.pnlUsd)).map(r => r.outcome.pnlUsd);
    const cohort = x => {
      const strat = x.strategy || 'manuell', same = prior.filter(r => (r.strategy || 'manuell') === strat); let worst = null;
      for (const tag of arr(x.regimeTags).filter(t => t !== 'UNKNOWN')) {
        const inT = same.filter(r => arr(r.regimeTags).includes(tag)), outT = same.filter(r => !arr(r.regimeTags).includes(tag));
        if (inT.length < 5) continue;
        const c = { tag, n: inT.length, exp: lr2(avg(inT.map(r => r.outcome.pnlPct))), expOther: outT.length >= 5 ? lr2(avg(outT.map(r => r.outcome.pnlPct))) : null };
        if (!worst || c.exp < worst.exp) worst = c;
      }
      return worst;
    };
    return { S: S(), cohort, medianLossUsd: losses.length >= 5 ? median(losses) : null };
  }
  /* Positionen aus der Zeit vor dem Lern-Update haben keinen Preispfad → nur MAE 2m bekannt, Rest UNKNOWN (null). */
  function legacyPath(rec, mae2m) {
    const p = rec.path;
    for (const k of ['mae1m', 'mae5m', 'mae15m', 'mfe1m', 'mfe2m', 'mfe5m', 'mfe15m', 'maxRunupPct', 'maxDrawdownPct', 'givebackPct', 'minLiqPct']) p[k] = null;
    p.mae2m = isNum(mae2m) ? lr2(mae2m) : null; p.samples = []; p.n = 0; p.timeToMaxLossMs = null; p.timeToMaxProfitMs = null;
  }
  function addRecord(rec) {
    const L = state.learn;
    L.records.push(rec); L.records.sort(byClose);
    if (L.records.length > LEARN_CAPS.records) L.records.splice(0, L.records.length - LEARN_CAPS.records);
    if (!learnable(rec)) { touch('learning'); return; } // verzerrter Trade: gespeichert, aber nicht in Muster/Fehlsignale
    const fs = falseSignalRecord(rec);
    if (fs) { L.falseSignals.unshift(fs); if (L.falseSignals.length > LEARN_CAPS.falseSignals) L.falseSignals.length = LEARN_CAPS.falseSignals; }
    for (const k of patternKeysOf(rec)) state.patterns[k.key] = updatePatternAgg(state.patterns[k.key], rec, k.dims, k.entry);
    const keys = Object.keys(state.patterns);
    if (keys.length > LEARN_CAPS.patterns) {
      keys.sort((a, b) => state.patterns[a].n - state.patterns[b].n || state.patterns[a].lastSeen - state.patterns[b].lastSeen);
      for (const k of keys.slice(0, keys.length - LEARN_CAPS.patterns)) delete state.patterns[k];
    }
    touch('learning', 'patterns');
  }

  /* Wird von closePosition() aufgerufen – friert den Trade als Learning Record ein. */
  function learnOnClose(pos, j) {
    if (!S().learnEnabled || !j || j.status !== 'CLOSED' || state.learn.records.some(r => r.tradeId === pos.id)) return null;
    const d = j.decision || {}, last = pos.exits[pos.exits.length - 1] || null, ord = last ? state.orders.find(o => o.id === last.orderId) : null;
    const features = d.features && d.features.v === FEATURE_VERSION ? d.features : featuresFromJournal(j);
    const rec = buildLearningRecord(pos, j, { features, path: pos.path || null, equity: pos.equityAtEntry, mae2m: pos.mae2m, exitLatencyMs: ord && isNum(ord.latencyMs) ? ord.latencyMs : null });
    if (!pos.path) { legacyPath(rec, pos.mae2m); rec.legacy = true; }
    rec.labels = labelTrade(rec, labelCtx(rec));
    rec.cf = compactCf(counterfactuals(rec, S()));
    rec.quality = recordQuality(rec);
    addRecord(rec);
    if (!rec.quality.ok) log.warn('LEARNING', `${rec.symbol}: gespeichert, zählt aber nicht fürs Lernen – ${rec.quality.flags.map(f => RECORD_FLAGS_DE[f] || f).join(', ')}`);
    if (d.features) delete d.features; // liegt jetzt im Learning Record – nicht doppelt in Journal/Order speichern
    if (last && isNum(last.refPrice) && last.refPrice > 0) {
      state.learn.followUps = state.learn.followUps.filter(f => f.tradeId !== rec.tradeId).slice(-19);
      state.learn.followUps.push({ tradeId: rec.tradeId, tokenId: pos.tokenId, symbol: pos.symbol, exitAt: pos.closedAt, exitPrice: last.refPrice, until: pos.closedAt + 15 * MIN, samples: [], maxAfterPct: null, minAfterPct: null, lastT: -1e12 });
    }
    const fam = rec.labels.lossFamily;
    log.info('LEARNING', `${rec.symbol}: ${rec.outcome.win ? 'Gewinn' : 'Verlust'} ${fmtPct(rec.outcome.pnlPct)} ausgewertet${fam ? ` · Ursache: ${LOSS_FAMILY_DE[fam] || fam} (Evidenz ${rec.labels.evidence[fam] || '—'})` : ''}${rec.legacy ? ' · eingeschränkte Features (legacy)' : ''}`);
    learnTimeline(rec.outcome.win ? 'WIN' : 'LOSS', `${rec.symbol} ${fmtPct(rec.outcome.pnlPct)}${fam ? ' · ' + (LOSS_FAMILY_DE[fam] || fam) : ''}`, rec.tradeId);
    if (learnable(rec)) { shadowEval(rec); liveEval(rec); }
    const r = state.risk;
    if (!rec.outcome.win && S().lossStreakLimit > 0 && r.lossStreak >= S().lossStreakLimit) {
      const rv = lossStreakReview(learnRecs(), Math.min(r.lossStreak, 10), state.learn.drift, state.research.hypotheses, env.now());
      if (!state.learn.reviews.some(x => x.id === rv.id)) {
        state.learn.reviews.unshift(rv); if (state.learn.reviews.length > LEARN_CAPS.reviews) state.learn.reviews.length = LEARN_CAPS.reviews;
        const top = Object.entries(rv.shares).sort((a, b) => b[1] - a[1])[0];
        log.warn('LEARNING', `CONTROLLED_REVIEW: ${rv.streak} Verluste in Folge analysiert${top ? ' · Schwerpunkt ' + top[0] : ''} · ${rv.unusual.unusual ? 'statistisch ungewöhnlich' : 'im Rahmen der Streuung'} – keine aggressivere Handelsweise`);
        learnTimeline('REVIEW', `Kontrollierter Review nach ${rv.streak} Verlusten${top ? ' (Schwerpunkt ' + top[0] + ')' : ''}`, rv.id);
      }
    }
    learnDue = true;
    return rec;
  }

  /* 15 min Nachlauf nach dem Exit: Wie entwickelte sich der Coin-Preis danach? (für EXIT_TOO_EARLY & Counterfactuals) */
  function learnFollowUps() {
    const L = state.learn; if (!L.followUps.length) return;
    const now = env.now(), s = S();
    for (const f of [...L.followUps]) {
      const t = state.markets.get(f.tokenId), sn = t && t.snap;
      if (sn && isNum(sn.priceUsd) && sn.fetchedAt >= f.exitAt && now - sn.fetchedAt <= s.staleAfterSec * SEC) {
        const tRel = sn.fetchedAt - f.exitAt, pct = (sn.priceUsd / f.exitPrice - 1) * 100;
        f.maxAfterPct = isNum(f.maxAfterPct) ? Math.max(f.maxAfterPct, pct) : pct;
        f.minAfterPct = isNum(f.minAfterPct) ? Math.min(f.minAfterPct, pct) : pct;
        if (tRel - f.lastT >= 15 * SEC) { f.samples.push([Math.round(tRel / 1000), lr2(pct)]); f.lastT = tRel; if (f.samples.length > 60) f.samples = f.samples.filter((_, i, a) => i % 2 === 0 || i === a.length - 1); }
      }
      if (now >= f.until) finishFollowUp(f);
    }
  }
  function finishFollowUp(f) {
    const L = state.learn; L.followUps = L.followUps.filter(x => x !== f);
    const rec = L.records.find(r => r.tradeId === f.tradeId); if (!rec) return;
    rec.followUp = f.samples.length ? { windowMin: 15, maxAfterPct: lr2(f.maxAfterPct), minAfterPct: lr2(f.minAfterPct), endPct: f.samples[f.samples.length - 1][1], samples: f.samples.slice(), n: f.samples.length }
      : { windowMin: 15, maxAfterPct: null, minAfterPct: null, endPct: null, samples: [], n: 0, status: 'NOT_ENOUGH_DATA' };
    const before = rec.labels ? rec.labels.lossFamily : null;
    rec.labels = labelTrade(rec, labelCtx(rec)); rec.cf = compactCf(counterfactuals(rec, S()));
    rec.revisions.push({ ts: env.now(), what: 'FOLLOW_UP', note: `Nachlauf 15 min: max ${fmtPct(rec.followUp.maxAfterPct)}, min ${fmtPct(rec.followUp.minAfterPct)}` + (before !== rec.labels.lossFamily ? ` · Ursache ${before || '—'} → ${rec.labels.lossFamily || '—'}` : '') });
    touch('learning'); learnDue = true;
  }

  /* Near-Misses: nach jeder Analyse neue Kandidaten erfassen, laufende 15 min fortschreiben (nur Messung, kein Handelseinfluss). */
  function nearMissTick(now) {
    const s = S(); if (!s.learnEnabled) return;
    const N = state.learn.nearMiss; let changed = false;
    for (const m of [...N.open]) {
      const t = state.markets.get(m.tokenId), sn = t && t.snap;
      if (sn && isNum(sn.priceUsd) && sn.priceUsd > 0 && sn.fetchedAt >= m.ts && sn.fetchedAt > m.lastAt && now - sn.fetchedAt <= s.staleAfterSec * SEC) {
        const tRel = sn.fetchedAt - m.ts, pct = lr2((sn.priceUsd / m.price - 1) * 100);
        m.lastAt = sn.fetchedAt; m.n++;
        m.maxPct = isNum(m.maxPct) ? Math.max(m.maxPct, pct) : pct; m.minPct = isNum(m.minPct) ? Math.min(m.minPct, pct) : pct; m.endPct = pct;
        if (!m.hit && pct >= s.tp1Pct) { m.hit = 'TP'; m.hitT = Math.round(tRel / 1000); } else if (!m.hit && pct <= -s.stopLossPct) { m.hit = 'STOP'; m.hitT = Math.round(tRel / 1000); }
        if (tRel - m.lastT >= 15 * SEC || m.hit && m.hitT === Math.round(tRel / 1000)) { m.samples.push([Math.round(tRel / 1000), pct]); m.lastT = tRel; if (m.samples.length > 60) m.samples = m.samples.filter((_, i, a) => i % 2 === 0 || i === a.length - 1); }
      }
      if (now >= m.ts + NEAR_MISS_WINDOW) {
        N.open = N.open.filter(x => x !== m);
        const r = nearMissOutcome(m, s), { samples, lastT, lastAt, ...keep } = m; // Preispfad nicht dauerhaft speichern (Speicher)
        N.done.unshift({ ...keep, ...r, closedAt: now }); changed = true;
        if (N.done.length > LEARN_CAPS.nearMiss) N.done.length = LEARN_CAPS.nearMiss;
      }
    }
    for (const t of state.markets.values()) {
      const nm = t.A && t.D ? nearMissOf(t.A, t.D, s) : null; if (!nm) continue;
      if (N.open.some(m => m.tokenId === t.id) || N.done.some(m => m.tokenId === t.id && now - m.ts < 2 * NEAR_MISS_WINDOW) || openPos(t.id)) continue;
      if (N.open.length >= LEARN_CAPS.nearMissOpen) { N.skipped++; continue; }
      N.open.push({ id: 'NM-' + hashStr(t.id + ':' + now).toString(36).toUpperCase(), tokenId: t.id, symbol: t.symbol, ts: now, price: t.A.core.price, mc: t.A.core.mc, score: t.A.finalScore, code: nm.code, kind: nm.kind, gap: nm.gap, msg: str(nm.msg, 160), disc: discoveryOf(t).primary, regime: [...arr(state.regime.tags)], samples: [[0, 0]], n: 1, lastT: 0, lastAt: t.snap ? t.snap.fetchedAt : now, maxPct: 0, minPct: 0, endPct: 0, hit: null, hitT: null });
      changed = true;
    }
    if (changed) touch('learning'); // Zwischenstände laufender Beobachtungen werden mit dem nächsten Speichern mitgenommen
  }

  /* ---- Periodischer Lernlauf ---- */
  function learnBase(recs) { const pct = recs.map(r => r.outcome.pnlPct).filter(isNum); return { n: recs.length, expPct: pct.length ? avg(pct) : 0, winRate: recs.length ? recs.filter(r => r.outcome.win).length / recs.length : null, totalLoss: -sum(recs.filter(r => !r.outcome.win && isNum(r.outcome.pnlUsd)).map(r => r.outcome.pnlUsd)) }; }
  function familyStats(recs) {
    const losses = recs.filter(r => !r.outcome.win && r.labels && r.labels.lossFamily), counts = {};
    for (const r of losses) counts[r.labels.lossFamily] = (counts[r.labels.lossFamily] || 0) + 1;
    return { losses: losses.length, counts, shares: Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, n / losses.length])) };
  }
  const patternStatsAll = base => Object.entries(state.patterns).map(([k, a]) => patternStats(k, a, base, { minPattern: S().learnMinPattern }));
  function updateLessons(stats, base, now) {
    const L = state.learn, drift = driftStatus();
    for (const st of stats) {
      if (!st.entry || st.status === 'INSUFFICIENT' || st.n < 8 || !isNum(st.expPct) || Math.abs(st.expPct - base.expPct) < 3) continue;
      const id = 'L-' + hashStr(st.key).toString(36).toUpperCase(), kind = st.expPct < base.expPct ? 'AVOID' : 'PREFER';
      const text = `${st.key.replace(/&/g, ' · ')}: Ø ${fmtPct(st.expPct)} je Trade (n=${st.n}, Trefferquote ${st.winRate != null ? Math.round(st.winRate * 100) + ' %' : '—'}) vs. gesamt ${fmtPct(base.expPct)}`;
      let l = L.lessons.find(x => x.id === id);
      if (!l) { l = { id, key: st.key, kind, createdAt: now, confirmed: 0 }; L.lessons.unshift(l); learnTimeline('LESSON', (kind === 'AVOID' ? 'Lektion (meiden): ' : 'Lektion (bevorzugen): ') + text, id); }
      else if (l.kind === kind) l.confirmed++;
      Object.assign(l, { kind, text, n: st.n, expPct: st.expPct, basePct: lr2(base.expPct), evidence: st.evidence, stable: st.status === 'STABLE_LEARNING_PATTERN', oos: st.oosConfirmed, updatedAt: now, expiresAt: now + 7 * DAY, status: drift === 'DRIFT' ? 'REVIEW' : st.status === 'STABLE_LEARNING_PATTERN' ? 'ACTIVE' : 'WATCH' });
    }
    for (const l of L.lessons) if (l.status !== 'EXPIRED' && now > l.expiresAt) { l.status = 'EXPIRED'; learnTimeline('LESSON', `Lektion abgelaufen (nicht erneut bestätigt): ${l.key}`, l.id); }
    L.lessons.sort((a, b) => (a.status === 'EXPIRED') - (b.status === 'EXPIRED') || b.updatedAt - a.updatedAt);
    if (L.lessons.length > LEARN_CAPS.lessons) L.lessons.length = LEARN_CAPS.lessons;
  }
  function mergeHypotheses(hyps, now) {
    const R = state.research, n = learnRecs().length, freeSlot = slotFree();
    for (const h of hyps) {
      const ex = hypOf(h.id);
      if (!ex) { R.hypotheses.unshift(h); log.info('RESEARCH', `Neue Hypothese ${h.id}: ${h.title} – ${h.statement}`); learnTimeline('HYPOTHESIS', `${h.id}: ${h.title}`, h.id); continue; }
      Object.assign(ex, { source: h.source, statement: h.statement, sampleSize: h.sampleSize, updatedAt: now });
      if (['REJECTED', 'INSUFFICIENT_DATA'].includes(ex.status) && n >= Math.max((ex.lastTestN || 0) + 10, Math.ceil((ex.lastTestN || 0) * 1.5))) { ex.status = 'IDEA'; ex.retests = (ex.retests || 0) + 1; }
    }
    for (const h of R.hypotheses) if (h.status === 'VALIDATED_HOLD' && freeSlot) h.status = 'IDEA';
    if (R.hypotheses.length > LEARN_CAPS.hypotheses) {
      const rank = h => (['SHADOW', 'PROMOTED', 'TESTING', 'VALIDATED_HOLD', 'IDEA'].includes(h.status) ? 0 : 1);
      R.hypotheses.sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt); R.hypotheses.length = LEARN_CAPS.hypotheses;
    }
  }
  function buildQueue(stats, now) {
    const R = state.research, byKey = Object.fromEntries(stats.map(x => [x.key, x])), q = [];
    for (const h of R.hypotheses) {
      if (h.status !== 'IDEA') continue;
      const st = h.source && h.source.patternKey ? byKey[h.source.patternKey] : null;
      const f = {
        impact: isNum(h.source.expPct) && isNum(h.source.basePct) ? Math.abs(h.source.expPct - h.source.basePct) / 10 : 0.5,
        evidence: (h.sampleSize || 0) / (S().learnMinPattern * 2), recency: st ? 1 - (now - st.lastSeen) / (7 * DAY) : 0.8,
        breadth: st ? st.regimes / 4 : 0.5, certainty: st ? (st.oosConfirmed ? 1 : 0.4) : 0.5,
        cheap: ['TRAIL_TIGHTER', 'STOP_WIDER'].includes(h.type) ? 0.5 : 1, safety: h.type === 'STOP_WIDER' ? 0.4 : h.type === 'TRAIL_TIGHTER' ? 0.7 : 1
      };
      q.push({ id: h.id, title: h.title, type: h.type, n: h.sampleSize, priority: researchPriority(f), factors: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, lr2(clamp(v, 0, 1))])) });
    }
    q.sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
    R.queue = q.slice(0, LEARN_CAPS.queue);
  }
  function runNextExperiment(P, now) {
    const R = state.research, L = state.learn, s = S(), item = R.queue[0]; if (!item) return null;
    const h = hypOf(item.id); R.queue.shift(); if (!h) return null;
    h.status = 'TESTING';
    const recs = learnRecs(), e = runExperiment(h, recs, P, { minTest: s.learnMinTest, championId: state.models.champion, drift: driftStatus() });
    e.ts = now;
    h.lastTestN = recs.length; h.experimentIds = [e.id, ...h.experimentIds.filter(x => x !== e.id)].slice(0, 10); h.updatedAt = now;
    h.result = { decision: e.decision, reason: e.reason, at: now };
    h.status = e.decision === 'VALIDATED' ? 'VALIDATED' : e.decision === 'REJECTED' ? 'REJECTED' : 'INSUFFICIENT_DATA';
    R.experiments = [e, ...R.experiments.filter(x => x.id !== e.id)].slice(0, LEARN_CAPS.experiments);
    (e.decision === 'VALIDATED' ? log.success : log.info)('EXPERIMENT', `${e.id} (${h.title}): ${e.decision} – ${e.reason}`);
    learnTimeline('EXPERIMENT', `${e.id}: ${h.title} → ${e.decision}`, e.id);
    if (e.decision === 'VALIDATED') createChallenger(h, e, P, now);
    touch('experiments');
    return e;
  }
  function createChallenger(h, e, P, now) {
    const M = state.models;
    if (!slotFree()) { h.status = 'VALIDATED_HOLD'; h.result.reason += challenger() ? ' · wartet: anderer Challenger läuft' : driftStatus() === 'DRIFT' ? ' · zurückgestellt: Drift erkannt' : ' · wartet: übernommenes Modell wird noch überwacht'; return null; }
    const Pc = mergeParams(P, e.change), id = 'M-' + (++M.seq);
    const v = { id, ts: now, status: 'CHALLENGER', params: pickLearn(Pc), rules: deepClone(Pc.rules), P: Pc, base: P, basedOn: M.champion, change: deepClone(e.change), applied: null, prevRules: null, experimentId: e.id, hypothesisId: h.id, note: h.title,
      shadow: { since: now, n: 0, blocked: 0, baseNet: 0, chNet: 0, bEq: 0, bPeak: 0, bDD: 0, cEq: 0, cPeak: 0, cDD: 0, trades: [], decisions: [], seen: {}, decN: 0, wouldBlock: 0 }, live: null };
    M.versions.push(v); M.challenger = id; capVersions();
    e.challengerVersion = id; h.status = 'SHADOW';
    log.info('MODEL', `Challenger ${id} im Shadow-Modus: ${h.title} (Experiment ${e.id}) – keine Orders, nur Parallel-Bewertung über ${S().learnShadowTrades} Trades`);
    learnTimeline('MODEL', `Challenger ${id} startet Shadow-Phase: ${h.title}`, id);
    alert('SYSTEM', null, `Lern-KI: Challenger ${id} (${h.title}) startet Shadow-Phase über ${S().learnShadowTrades} Trades – keine echten Änderungen`, 'INFO', { key: 'ch:' + id, cooldownMs: 0 });
    touch('models');
    return v;
  }
  /* Shadow: Challenger bewertet jeden neuen echten Trade parallel (Einstiegsfilter bzw. Exit-Resimulation), ohne Orders. */
  function shadowEval(rec) {
    const v = challenger(); if (!v || v.status !== 'CHALLENGER' || rec.legacy || !rec.entry || rec.openedAt < v.shadow.since) return;
    const sh = v.shadow, sim = exitDiffers(v.P, v.base), oc = outcomeUnder(rec, v.P, sim), ob = outcomeUnder(rec, v.base, sim);
    sh.n++; if (!oc.taken) sh.blocked++;
    sh.baseNet = lr2(sh.baseNet + ob.pnlUsd); sh.chNet = lr2(sh.chNet + oc.pnlUsd);
    sh.bEq += ob.pnlUsd; sh.bPeak = Math.max(sh.bPeak, sh.bEq); sh.bDD = lr2(Math.max(sh.bDD, sh.bPeak - sh.bEq));
    sh.cEq += oc.pnlUsd; sh.cPeak = Math.max(sh.cPeak, sh.cEq); sh.cDD = lr2(Math.max(sh.cDD, sh.cPeak - sh.cEq));
    sh.trades.push({ tradeId: rec.tradeId, symbol: rec.symbol, taken: oc.taken, base: lr2(ob.pnlUsd), ch: lr2(oc.pnlUsd), sim: !!oc.sim }); if (sh.trades.length > 50) sh.trades.shift();
    touch('models');
    const need = S().learnShadowTrades; if (sh.n < need) return;
    const ddOk = sh.cDD <= sh.bDD * 1.25 + 0.01;
    if (sh.chNet > sh.baseNet + 1e-9 && ddOk) challengerPassed(v);
    else if (sh.chNet < sh.baseNet - 1e-9 || !ddOk) rejectChallenger(v, `Shadow schlechter als Champion (${fmtSigned(sh.chNet)} vs. ${fmtSigned(sh.baseNet)}, DD ${fmtUsd(sh.cDD)} vs. ${fmtUsd(sh.bDD)})`);
    else if (sh.n >= need * 3) rejectChallenger(v, 'Keine messbare Wirkung in der Shadow-Phase');
  }
  function shadowDecisions(now) {
    const v = challenger(); if (!v || v.status !== 'CHALLENGER') return;
    const sh = v.shadow;
    for (const [k, ts] of Object.entries(sh.seen)) if (now - ts > 30 * MIN) delete sh.seen[k];
    for (const t of state.markets.values()) {
      if (!t.A || !t.D || !(t.D.decision === 'APPROVED' || t.D.decision === 'BUY_CANDIDATE') || sh.seen[t.id]) continue;
      sh.seen[t.id] = now;
      const f = buildEntryFeatures(t, t.A, t.D, state.regime.tags, now), ok = passesParams({ entry: f, strategy: t.D.strategy, regimeTags: f.regime }, v.P);
      sh.decisions.unshift({ ts: now, tokenId: t.id, symbol: t.symbol, champion: t.D.decision, challenger: ok ? 'BUY' : 'NO_TRADE', score: t.A.finalScore });
      if (sh.decisions.length > 30) sh.decisions.length = 30;
      sh.decN++; if (!ok) sh.wouldBlock++;
      touch('models');
    }
  }
  function challengerPassed(v) {
    v.shadow.passedAt = env.now();
    if (S().learnAutoPromote && state.mode === 'SIMULATION' && driftStatus() !== 'DRIFT') { learnPromote(v.id, 'AUTO'); return; }
    v.status = 'READY'; touch('models');
    const why = !S().learnAutoPromote ? 'automatische Übernahme ist aus' : state.mode !== 'SIMULATION' ? 'nur im SIMULATION-Modus' : 'Drift erkannt';
    log.info('MODEL', `${v.id} hat die Shadow-Phase bestanden (${fmtSigned(v.shadow.chNet)} vs. ${fmtSigned(v.shadow.baseNet)}) – wartet auf Freigabe (${why})`);
    learnTimeline('MODEL', `${v.id} bestand Shadow-Phase – wartet auf Freigabe (${why})`, v.id);
    alert('SYSTEM', null, `Lern-KI: ${v.id} (${v.note}) bestand die Shadow-Phase – Freigabe in „Learning KI“ möglich`, 'INFO', { key: 'ready:' + v.id, cooldownMs: 0 });
  }
  function rejectChallenger(v, why, who = 'LEARNING') {
    const M = state.models; v.status = 'REJECTED'; v.reason = why; v.rejectedAt = env.now(); if (M.challenger === v.id) M.challenger = null;
    const h = hypOf(v.hypothesisId); if (h) { h.status = 'REJECTED'; h.result = { decision: 'REJECTED', reason: why, at: env.now() }; h.lastTestN = learnRecs().length; }
    log.info('MODEL', `${v.id} verworfen: ${why}`); learnTimeline('MODEL', `${v.id} verworfen: ${why}`, v.id);
    if (who === 'USER') audit('USER', 'MODEL_REJECT', v.id, why);
    touch('models', 'experiments');
  }
  function learnReject(id) {
    const v = state.models.versions.find(x => x.id === id);
    if (!v || !['CHALLENGER', 'READY'].includes(v.status)) return { ok: false, error: 'Kein aktiver Challenger' };
    rejectChallenger(v, 'Manuell verworfen', 'USER'); persistNow(); return { ok: true };
  }
  /* Übernahme: nur SIMULATION, nur nach bestandener Shadow-Phase, nur LEARN_SETTING_KEYS innerhalb LEARN_BOUNDS,
     Einstiegsfilter nur verschärfend (mergeParams gegen die AKTUELLEN Einstellungen). Risiko-Limits bleiben unberührt. */
  function learnPromote(id, who = 'USER') {
    const M = state.models, v = M.versions.find(x => x.id === id);
    if (!v || !(v.status === 'READY' || (who === 'AUTO' && v.status === 'CHALLENGER'))) return { ok: false, error: 'Nur ein Challenger mit bestandener Shadow-Phase kann übernommen werden' };
    if (state.mode !== 'SIMULATION') return { ok: false, error: 'Übernahme nur im SIMULATION-Modus' };
    const now = env.now(), s = S(), Pn = mergeParams(curParams(), v.change || {}), patch = {}, applied = {};
    for (const k of LEARN_SETTING_KEYS) if (Pn[k] !== s[k]) { patch[k] = Pn[k]; applied[k] = { from: s[k], to: Pn[k] }; }
    if (Object.keys(patch).length) { const r = updateSettings(patch, 'LEARNING', { noVersion: true }); if (r.errors.length) return { ok: false, error: r.errors.map(e => e.msg).join(', ') }; }
    const old = champion(); if (old) { old.retiredStatus = old.status; old.status = 'RETIRED'; }
    v.prevRules = deepClone(M.rules); M.rules = sanitizeRules(Pn.rules);
    Object.assign(v, { status: 'LIVE', applied, params: pickLearn(Pn), rules: deepClone(M.rules), promotedAt: now, promotedBy: who, live: { since: now, n: 0, net: 0, eq: 0, peak: 0, dd: 0, trades: [], baseline: liveBaseline() } });
    M.champion = v.id; M.challenger = null;
    const h = hypOf(v.hypothesisId); if (h) h.status = 'PROMOTED';
    const what = [...Object.entries(applied).map(([k, c]) => `${k} ${c.from} → ${c.to}`), ...rulesText(M.rules, v.prevRules)].join(', ') || 'keine Änderung';
    newParamVersion(pickTunable(), 'LEARNED', `Lern-KI ${v.id}: ${v.note}`);
    audit(who === 'AUTO' ? 'BOT' : 'USER', 'MODEL_PROMOTE', `${v.id}: ${what}`, `Experiment ${v.experimentId} · Shadow ${fmtSigned(v.shadow ? v.shadow.chNet : null)} vs. ${fmtSigned(v.shadow ? v.shadow.baseNet : null)}`);
    log.success('MODEL', `${v.id} übernommen (${who === 'AUTO' ? 'automatisch, SIMULATION' : 'manuell'}): ${what} – Überwachung über ${s.learnShadowTrades} Trades, automatischer Rollback bei schlechterer Live-Evidenz`);
    learnTimeline('PROMOTION', `${v.id} übernommen: ${what}`, v.id);
    alert('SYSTEM', null, `Lern-KI: ${v.id} übernommen (${v.note}) – wird überwacht, Rollback automatisch`, 'SUCCESS', { key: 'prom:' + v.id, cooldownMs: 0 });
    touch('models', 'experiments'); persistNow(); emit('settings', {});
    return { ok: true, applied };
  }
  function rulesText(R, prev) {
    const out = [], P = prev || emptyRules();
    for (const b of R.blocks) if (!P.blocks.includes(b)) out.push(`Sperre ${b.replace('|', ' im Regime ')}`);
    for (const [t, v] of Object.entries(R.regimeScoreBump)) if ((P.regimeScoreBump[t] || 0) !== v) out.push(`Regime ${t}: Score +${v}`);
    if (R.volumeConfirmPct !== (P.volumeConfirmPct || 0)) out.push(`Volume-Bestätigung ≥ +${R.volumeConfirmPct} %`);
    if (R.blockPostPump && !P.blockPostPump) out.push('keine Einstiege nach Pump');
    for (const c of arr(R.blockDisc)) if (!arr(P.blockDisc).includes(c)) out.push(`Quelle ${DISC_DE[c] || c} meiden`);
    return out;
  }
  function liveBaseline() {
    const rs = learnRecs().filter(r => !r.legacy && isNum(r.outcome.pnlUsd)).slice(-30);
    if (rs.length < 5) return null;
    let eq = 0, pk = 0, dd = 0; for (const r of rs) { eq += r.outcome.pnlUsd; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
    return { n: rs.length, expectancy: lr2(avg(rs.map(r => r.outcome.pnlUsd))), dd: lr2(dd) };
  }
  /* Live-Überwachung nach der Übernahme → STABLE oder automatischer Rollback. */
  function liveEval(rec) {
    const v = champion(); if (!v || v.status !== 'LIVE' || !v.live || rec.legacy || rec.openedAt < v.live.since) return;
    const L = v.live, pnl = rec.outcome.pnlUsd || 0;
    L.n++; L.net = lr2(L.net + pnl); L.eq += pnl; L.peak = Math.max(L.peak, L.eq); L.dd = lr2(Math.max(L.dd, L.peak - L.eq));
    L.trades.push({ tradeId: rec.tradeId, symbol: rec.symbol, pnl: lr2(pnl) }); if (L.trades.length > 50) L.trades.shift();
    touch('models');
    if (L.n < S().learnShadowTrades) return;
    const exp = L.net / L.n, b = L.baseline;
    const worse = b ? exp < b.expectancy - Math.abs(b.expectancy) * 0.1 - 0.01 || (L.dd > b.dd * 1.25 + 0.01 && L.net < 0) : L.net < 0;
    if (worse) { learnRollback(v.id, 'AUTO', `Live-Evidenz schlechter: Ø ${fmtSigned(exp)} je Trade vs. Baseline ${b ? fmtSigned(b.expectancy) : '—'} (${L.n} Trades)`); return; }
    v.status = 'STABLE'; v.stableAt = env.now();
    log.success('MODEL', `${v.id} bestätigt (STABLE): Ø ${fmtSigned(exp)} je Trade über ${L.n} Trades`);
    learnTimeline('MODEL', `${v.id} nach ${L.n} Trades bestätigt (STABLE)`, v.id);
  }
  function learnRollback(id, who = 'USER', why = '') {
    const M = state.models, v = M.versions.find(x => x.id === (id || M.champion));
    if (!v || v.id !== M.champion || !['LIVE', 'STABLE'].includes(v.status)) return { ok: false, error: 'Nur das aktive gelernte Modell kann zurückgerollt werden' };
    const prev = M.versions.find(x => x.id === v.basedOn); if (!prev) return { ok: false, error: 'Vorgängerversion fehlt' };
    const s = S(), patch = {}, skipped = [];
    for (const [k, c] of Object.entries(v.applied || {})) { if (s[k] === c.to) patch[k] = c.from; else skipped.push(k); }
    if (Object.keys(patch).length) updateSettings(patch, who === 'AUTO' ? 'LEARNING_ROLLBACK' : 'USER_ROLLBACK', { noVersion: true });
    M.rules = sanitizeRules(v.prevRules || prev.rules);
    v.status = 'ROLLED_BACK'; v.rolledBackAt = env.now(); v.rollbackReason = why || 'manuell'; v.rolledBackBy = who;
    prev.status = prev.retiredStatus || (prev.id === 'M-1' ? 'BASELINE' : 'STABLE'); M.champion = prev.id;
    const h = hypOf(v.hypothesisId); if (h) { h.status = 'ROLLED_BACK'; h.lastTestN = learnRecs().length; }
    newParamVersion(pickTunable(), 'STABLE', `Rollback ${v.id} → ${prev.id}`);
    audit(who === 'AUTO' ? 'BOT' : 'USER', 'MODEL_ROLLBACK', `${v.id} → ${prev.id}: ${Object.keys(patch).join(', ') || 'nur Regeln'}${skipped.length ? ' · manuell geändert, nicht überschrieben: ' + skipped.join(', ') : ''}`, why);
    log.warn('MODEL', `Rollback ${v.id} → ${prev.id} (${who === 'AUTO' ? 'automatisch' : 'manuell'}): ${why || 'manuell'}`);
    learnTimeline('ROLLBACK', `Rollback ${v.id} → ${prev.id}: ${why || 'manuell'}`, v.id);
    alert('RISK', null, `Lern-KI Rollback ${v.id} → ${prev.id}: ${why || 'manuell'}`, 'WARNING', { key: 'rb:' + v.id, cooldownMs: 0 });
    touch('models', 'experiments'); persistNow(); emit('settings', {});
    return { ok: true, restored: Object.keys(patch), skipped };
  }
  function learnRun(force) {
    const s = S(), L = state.learn, now = env.now();
    if (!s.learnEnabled) return null;
    if (!force && (now - L.lastRunAt < 20 * SEC || (!learnDue && now - L.lastRunAt < 5 * MIN))) return null;
    learnDue = false; L.lastRunAt = now; touch('learning');
    const recs = learnRecs(); if (!recs.length) return { n: 0, excluded: L.records.length }; // nur saubere Records (siehe recordQuality)
    const t0 = env.now(), base = learnBase(recs);
    const prev = driftStatus();
    L.drift = { ...detectDrift(recs), at: now };
    if (L.drift.status !== prev && ['WATCH', 'DRIFT'].includes(L.drift.status)) {
      const bad = L.drift.checks.filter(c => c.status === L.drift.status).map(c => c.group + ': ' + c.name).join(', ');
      log.warn('DRIFT', `Drift-Status ${L.drift.status}: ${bad}`); learnTimeline('DRIFT', `Drift ${L.drift.status}: ${bad}`);
      if (L.drift.status === 'DRIFT') alert('RISK', null, `Lern-KI: Drift erkannt (${bad}) – keine neuen Modell-Übernahmen, Lektionen werden überprüft`, 'WARNING', { key: 'drift', cooldownMs: HOUR });
    }
    L.calibration = { ...calibrate(recs), at: now };
    if (!L.lossModel || recs.length - L.lastModelN >= 5 || force) { L.lossModel = { ...trainLossModel(recs), at: now }; L.lastModelN = recs.length; }
    const stats = patternStatsAll(base), fam = familyStats(recs);
    updateLessons(stats, base, now);
    const P = curParams();
    mergeHypotheses(generateHypotheses(stats, fam, base, P, now), now);
    buildQueue(stats, now);
    runNextExperiment(P, now);
    Object.assign(learnCache, { at: now, stats, base, fam });
    touch('learning', 'experiments');
    return { n: recs.length, ms: env.now() - t0 };
  }
  /* Muster und Fehlsignal-Liste vollständig aus den sauberen Records neu aufbauen (nach Datenbereinigung). */
  function rebuildFromRecords() {
    const L = state.learn, recs = L.records.filter(learnable);
    state.patterns = {}; L.falseSignals = [];
    for (const r of recs) {
      for (const k of patternKeysOf(r)) state.patterns[k.key] = updatePatternAgg(state.patterns[k.key], r, k.dims, k.entry);
      const fs = falseSignalRecord(r); if (fs) L.falseSignals.unshift(fs);
    }
    if (L.falseSignals.length > LEARN_CAPS.falseSignals) L.falseSignals.length = LEARN_CAPS.falseSignals;
    const keys = Object.keys(state.patterns);
    if (keys.length > LEARN_CAPS.patterns) {
      keys.sort((a, b) => state.patterns[a].n - state.patterns[b].n || state.patterns[a].lastSeen - state.patterns[b].lastSeen);
      for (const k of keys.slice(0, keys.length - LEARN_CAPS.patterns)) delete state.patterns[k];
    }
    learnCache.at = -1; learnDue = true;
    touch('learning', 'patterns');
  }
  /* Migration 2.12.0: Slippage mit der begrenzten Formel neu berechnen (die alte Kauf-Formel ergab bei Rug-Kursen
     Fantasiewerte, z. B. −23.000 $ bei 509 $ Einsatz). Ergebnisse (PnL) ändern sich dadurch nicht. */
  function slippageMigrate() {
    let n = 0;
    for (const j of state.journal) if (j.slipV !== 2 && arr(j.entries).length) { j.slippageUsd = slippageOf(j.entries, j.exits); j.slipV = 2; n++; }
    for (const p of state.positions) if (p.slipV !== 2 && arr(p.entries).length) { p.slippageUsd = slippageOf(p.entries, p.exits); p.slipV = 2; n++; }
    if (n) log.info('LEARNING', `Migration: Slippage für ${n} Trades mit der korrigierten Formel neu berechnet (Ergebnisse unverändert)`);
    return n;
  }
  /* Migration 2.12.0: Datenqualität der vorhandenen Learning Records prüfen. Fehlende Angaben (Ausführungsmodell, Quelle des
     Verkaufs, Kursabweichung beim Kauf) werden aus dem Journal ergänzt. Verzerrte Trades zählen danach nicht mehr fürs Lernen;
     alles daraus Abgeleitete (Muster, Lektionen, Fehlsignale, Verlustmodell, Kalibrierung, Drift) wird aus den sauberen Records
     neu berechnet und bisherige Hypothesen werden mit sauberen Daten neu getestet. Die Rohdaten selbst bleiben unverändert. */
  function learnQualityMigrate() {
    const L = state.learn; if (L.qualityV >= 1) return null;
    const byId = new Map(state.journal.map(j => [j.id, j]));
    for (const r of L.records) {
      const x = r.execution || (r.execution = {}), j = byId.get(r.tradeId);
      if (j) {
        const en = arr(j.entries), ex = arr(j.exits), last = ex[ex.length - 1];
        if (!isNum(x.buys)) x.buys = en.length;
        if (x.execModel === undefined) x.execModel = en.some(e => e.source) ? 2 : 1;
        // Vor 2.12.0 wurde die Quelle des Verkaufs nicht gespeichert: mit echten Angeboten (Modell 2) war es Jupiter, vorher geschätzt
        if (x.exitSource === undefined) x.exitSource = last ? last.source || (last.reason === 'NO_SELL_ROUTE' ? 'WRITE_OFF' : x.execModel === 2 ? 'JUPITER' : 'ESTIMATED') : null;
        if (x.maxDevPct === undefined) { const devs = en.map(e => (isNum(e.price) && isNum(e.refPrice) && e.refPrice > 0 ? (e.price / e.refPrice - 1) * 100 : null)).filter(isNum); x.maxDevPct = devs.length ? lr2(devs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a))) : null; }
        x.slippageUsd = lr2(slippageOf(en, ex));
      } else {
        if (x.execModel === undefined) x.execModel = 1;
        if (x.exitSource === undefined) x.exitSource = 'ESTIMATED';
      }
      r.quality = recordQuality(r);
    }
    const q = learnQuality();
    rebuildFromRecords();
    L.lessons = []; L.lossModel = null; L.lastModelN = 0; L.calibration = null; L.drift = null;
    const R = state.research; let retest = 0;
    for (const h of R.hypotheses) if (!['SHADOW', 'PROMOTED'].includes(h.status)) { h.status = 'IDEA'; h.lastTestN = 0; h.result = { decision: 'RETEST', reason: 'Datenbasis bereinigt (2.12.0) – wird mit sauberen Trades neu getestet', at: env.now() }; retest++; }
    for (const e of R.experiments) if (!e.invalidated) e.invalidated = 'Datenbasis bereinigt (2.12.0) – Ergebnis nicht mehr maßgeblich';
    R.queue = [];
    L.qualityV = 1;
    touch('learning', 'patterns', 'experiments');
    if (q.total) {
      const why = Object.entries(q.byFlag).map(([f, n]) => `${n}× ${RECORD_FLAGS_DE[f] || f}`).join(', ');
      log.warn('LEARNING', `Datenbereinigung 2.12.0: ${q.excluded} von ${q.total} Trades zählen nicht mehr fürs Lernen${why ? ' (' + why + ')' : ''} · Muster, Lektionen und Modell neu aus ${q.learnable} sauberen Trades · ${retest} Hypothesen werden neu getestet`);
      learnTimeline('MIGRATION', `Datenbereinigung: ${q.excluded} von ${q.total} Trades ausgeschlossen, ${retest} Hypothesen neu zu testen`);
    }
    return q;
  }
  /* Migration: bereits abgeschlossene Journal-Trades → Learning Records (legacy, eingeschränkte Features). */
  function learnBackfill() {
    const L = state.learn; if (L.backfilled) return 0;
    const have = new Set(L.records.map(r => r.tradeId));
    const js = state.journal.filter(j => j.status === 'CLOSED' && j.result && isNum(j.result.pnlUsd) && isNum(j.closedAt) && isNum(j.openedAt) && !have.has(j.id)).sort((a, b) => a.closedAt - b.closedAt).slice(-LEARN_CAPS.records);
    for (const j of js) {
      const entries = arr(j.entries), exits = arr(j.exits), q = sum(entries.map(e => e.qty || 0));
      const pos = { id: j.id, tokenId: j.tokenId, symbol: j.symbol, openedAt: j.openedAt, closedAt: j.closedAt, mode: j.mode, strategy: j.strategy, paramVersion: j.paramVersion, entries, exits, investedUsd: j.sizeUsd || 0, realizedUsd: j.result.pnlUsd, feesUsd: j.feesUsd || 0, slippageUsd: j.slippageUsd || 0, entryPrice: q > 0 ? sum(entries.map(e => e.price * e.qty)) / q : null, exitReason: j.exitReason };
      const rec = buildLearningRecord(pos, j, { features: featuresFromJournal(j), path: null, equity: null, mae2m: j.mae2m });
      legacyPath(rec, j.mae2m); rec.legacy = true;
      rec.labels = labelTrade(rec, labelCtx(rec)); rec.cf = compactCf(counterfactuals(rec, S()));
      rec.quality = recordQuality(rec);
      addRecord(rec);
    }
    L.backfilled = true;
    if (js.length) { log.info('LEARNING', `Migration: ${js.length} abgeschlossene Trades aus dem Journal übernommen (legacy – eingeschränkte Features, fehlende Werte bleiben UNKNOWN)`); learnTimeline('MIGRATION', `${js.length} Trades aus dem Journal übernommen (legacy)`); learnDue = true; }
    touch('learning', 'patterns');
    return js.length;
  }
  /* Research-Signal für die Detailansicht – ersetzt nie Regeln, Security oder Limits. */
  function learnDecision(t) {
    if (!t || !t.A || !t.D) return null;
    const f = buildEntryFeatures(t, t.A, t.D, state.regime.tags, env.now()), L = state.learn;
    return { ...learningDecisionFor(f, L.lossModel && L.lossModel.w ? L.lossModel : null, L.calibration, L.drift), rulesActive: !!S().learnEnabled && rulesText(state.models.rules).length > 0 };
  }
  function learnQuality() {
    const all = state.learn.records, byFlag = {}; let excluded = 0;
    for (const r of all) if (!learnable(r)) { excluded++; for (const f of r.quality.flags) byFlag[f] = (byFlag[f] || 0) + 1; }
    return { total: all.length, learnable: all.length - excluded, excluded, byFlag };
  }
  function learnView() {
    const recs = learnRecs();
    if (learnCache.at < 0 && recs.length) { const base = learnBase(recs); Object.assign(learnCache, { at: env.now(), stats: patternStatsAll(base), base, fam: familyStats(recs) }); }
    return { stats: learnCache.stats, base: learnCache.base, fam: learnCache.fam || familyStats(recs), champion: champion(), challenger: challenger(), rulesText: rulesText(state.models.rules), params: curParams(), errors: errorClassStats(recs), nearMiss: nearMissStats(state.learn.nearMiss.done), disc: discoveryStats(recs, state.learn.nearMiss.done), nearMissOpen: state.learn.nearMiss.open.length, nearMissSkipped: state.learn.nearMiss.skipped, quality: learnQuality() };
  }
  /* Aktive Parameter mit Herkunft: letzter Eintrag im Änderungsprotokoll bzw. aktives gelerntes Modell. Unbekanntes bleibt als solches markiert. */
  function activeParams() {
    const s = S(), champ = champion();
    return PARAM_TABLE_KEYS.filter(k => k in s).map(k => {
      const def = SETTINGS_SCHEMA.find(x => x.k === k) || {};
      let last = null;
      for (const c of state.configLog) { const ch = arr(c.changes).find(x => x.key === k); if (ch) { last = { ts: c.ts, who: c.who, from: ch.from, to: ch.to }; break; } }
      const learned = !!(champ && champ.applied && champ.applied[k] && champ.applied[k].to === s[k] && (!last || last.who === 'LEARNING'));
      let source, reason, since = null;
      if (learned) { source = 'LEARNED'; since = champ.promotedAt || (last && last.ts); reason = `${champ.id}: ${champ.note || ''}${champ.experimentId ? ' · Experiment ' + champ.experimentId : ''} · ${champ.applied[k].from} → ${champ.applied[k].to}`; }
      else if (last && last.to === s[k]) { source = PARAM_SOURCE[last.who] || last.who; since = last.ts; reason = `${last.from} → ${last.to}`; }
      else if (s[k] === def.def) { source = 'DEFAULT'; reason = 'unverändert'; }
      else { source = 'UNTRACKED'; reason = last ? `letzter protokollierter Wert ${last.to}` : 'kein Eintrag im Änderungsprotokoll (max. 200)'; }
      const lb = LEARN_BOUNDS[k];
      return { key: k, label: def.l || k, unit: def.u || '', value: s[k], def: def.def, source, reason, since, learnable: LEARN_SETTING_KEYS.includes(k), bounds: lb ? `${lb[0]}–${lb[1]} (lernbar, nur verschärfend)` : LEARN_SETTING_KEYS.includes(k) ? 'lernbar, nur einschaltbar' : isNum(def.min) ? `${def.min}–${def.max}` : '—' };
    });
  }

  /* ---------- Portfolio-Integrität: eine Quelle der Wahrheit, Invarianten sichtbar prüfen ---------- */
  function portfolioIntegrity() {
    const issues = [], now = env.now(), pf = state.portfolio, add = (code, msg) => issues.push({ code, msg });
    if (!isNum(pf.cash) || pf.cash < -1e-6) add('NEGATIVE_CASH', `Cash ${fmtUsd(pf.cash)} negativ/ungültig`);
    const seen = new Set();
    for (const p of state.positions) {
      if (seen.has(p.tokenId)) add('DUPLICATE_POSITION', `${p.symbol}: mehrere offene Positionen für denselben Token`); seen.add(p.tokenId);
      const qIn = sum(p.entries.map(e => e.qty || 0)), qOut = sum(p.exits.map(e => e.qty || 0));
      if (Math.abs(qIn - qOut - p.qty) > Math.max(1e-9, qIn * 1e-6)) add('QTY_MISMATCH', `${p.symbol}: Menge ${fmtNum(p.qty, 4)} ≠ Käufe ${fmtNum(qIn, 4)} − Verkäufe ${fmtNum(qOut, 4)}`);
      if (!(p.qty > 0)) add('EMPTY_OPEN_POSITION', `${p.symbol}: offene Position ohne Menge`);
      if (new Set(p.entries.map(e => e.orderId)).size !== p.entries.length || new Set(p.exits.map(e => e.orderId)).size !== p.exits.length) add('DOUBLE_FILL', `${p.symbol}: dieselbe Order mehrfach verbucht`);
      const j = state.journal.find(x => x.id === p.id); if (!j || j.status !== 'OPEN') add('JOURNAL_MISSING', `${p.symbol}: kein offener Journal-Eintrag`);
      if (!['OPEN', 'PARTIAL', 'CLOSING'].includes(p.lc)) add('LIFECYCLE', `${p.symbol}: Lebenszyklus ${p.lc || '—'}`);
      if (p.lc === 'CLOSING' && !state.locks.has('pos:' + p.id)) add('LIFECYCLE', `${p.symbol}: „wird verkauft“ ohne laufende Order`);
      if (p.staleSince && now - p.staleSince > 5 * MIN) add('ORPHANED', `${p.symbol}: seit ${fmtAge(now - p.staleSince)} keine Preisdaten`);
    }
    for (const o of state.orders) if (!TERMINAL.has(o.state) && now - o.createdAt > 2 * MIN) add('STUCK_ORDER', `Order ${o.id} (${o.side} ${o.symbol}) hängt in ${o.state}`);
    for (const j of state.journal) if (j.status === 'OPEN' && !state.positions.some(p => p.id === j.id)) add('ORPHAN_JOURNAL', `Journal ${j.id} (${j.symbol}) offen ohne Position`);
    return { ok: !issues.length, issues, checkedAt: now };
  }

  /* ---------- Persistenz (versioniert) & Recovery ---------- */
  let persistTimer = null, storageFrozen = false;
  function persist() { if (persistTimer || storageFrozen) return; persistTimer = env.setTimeout(() => { persistTimer = null; persistNow(); }, 5000); }
  function serialize() {
    const now = env.now();
    const seen = {}; for (const [k, v] of Object.entries(state.seen)) if (now - v.t < 2 * DAY) seen[k] = v;
    const marks = {}; for (const [k, v] of Object.entries(state.alertMarks)) if (now - v < DAY) marks[k] = v;
    const seq = state.tradeSeq;
    return {
      settings: { settings: state.settings, strategies: state.strategies, watchlist: state.watchlist, ui: state.ui },
      positions: { tradeSeq: seq, portfolio: state.portfolio, positions: state.positions, orders: state.orders.slice(0, 150), usedKeys: [...state.usedKeys.entries()].filter(([, v]) => v !== 'pending').slice(-600) },
      trades: { tradeSeq: seq, journal: state.journal.slice(0, 500) },
      runtime: { tradeSeq: seq, savedAt: now, app: APP_VERSION, mode: state.mode, bot: { desired: state.bot.desired, autoTrading: state.bot.autoTrading, safeMode: state.bot.safeMode, emergency: state.bot.emergency, emergencyReason: state.bot.emergencyReason }, risk: state.risk, session: state.session, seen, alertMarks: marks, reconciliation: state.reconciliation },
      logs: { logs: log.entries.slice(-200), auditLog: state.auditLog.slice(0, 300), configLog: state.configLog.slice(0, 100), feed: state.feed.slice(0, 80) },
      stats: { hist: state.hist, stratStats: state.stratStats, falseSignals: state.falseSignals.slice(0, 50), paramVersions: state.paramVersions, activeParam: state.activeParam, sessions: state.sessions.slice(0, 50), btRuns: state.btRuns.slice(0, 20) },
      // Lerndaten nur schreiben, wenn sich etwas geändert hat (große Bereiche, getrennte Schlüssel)
      learning: lrev.learning !== lsaved.learning ? { learn: state.learn } : null,
      experiments: lrev.experiments !== lsaved.experiments ? { research: state.research } : null,
      models: lrev.models !== lsaved.models ? { models: state.models } : null,
      patterns: lrev.patterns !== lsaved.patterns ? { patterns: state.patterns } : null
    };
  }
  function persistNow() {
    if (persistTimer) { env.clearTimeout(persistTimer); persistTimer = null; }
    if (storageFrozen) return true;
    const revs = { ...lrev };
    const ok = store.save(serialize());
    if (ok) Object.assign(lsaved, revs);
    if (ok !== state.storageOk && !ok) log.error('STORAGE', 'Speichern fehlgeschlagen: ' + store.status().lastError);
    state.storageOk = ok; if (ok) state.lastSaveAt = env.now();
    return ok;
  }
  function hydrate(d) {
    if (!d) return;
    state.settings = validateSettings(d.settings || d.settingsIn || {}, defaultSettings()).settings;
    /* Ab 2.8.0 (Entscheidung Nutzer): Loss-Cooldown und globale Pause wieder 0. Gespeicherte Werte aus älteren Versionen
       (2.3.0–2.7.x erzwangen 10 / 5 min) werden einmalig auf 0 gesetzt – sichtbar protokolliert. Danach frei einstellbar. */
    const zeroed = [], oldVer = !d.app || verLt(String(d.app), '2.8.0');
    if (oldVer) for (const [k, name] of [['lossCooldownMin', 'Loss-Cooldown'], ['globalPauseMin', 'Globale Pause']])
      if (state.settings[k] !== 0) { zeroed.push({ key: k, from: state.settings[k], to: 0 }); log.info('RISK', `${name}: ${state.settings[k]} min → 0 min (Umstellung 2.8.0)`); state.settings = { ...state.settings, [k]: 0 }; }
    if (d.app && verLt(String(d.app), '2.11.0')) log.info('TRADE', `Ab 2.11.0 ehrliche Simulation: echte Jupiter-Kursangebote (nur Abfrage), Füllung nach ${state.settings.simLatencyMs} ms Wartezeit, ${state.settings.simTxFailPct} % gescheiterte Transaktionen, Priority Fee aus dem Netzwerk – einstellbar unter Einstellungen → Ausführung`);
    state.strategies = validateStrategies(d.strategies, defaultStrategies()).strategies;
    if (['SIMULATION', 'PAPER', 'READ_ONLY'].includes(d.mode)) state.mode = d.mode;
    if (d.bot && typeof d.bot === 'object') {
      state.bot.desired = ['RUNNING', 'PAUSED', 'STOPPED'].includes(d.bot.desired) ? d.bot.desired : 'RUNNING';
      state.bot.autoTrading = d.bot.autoTrading === true && state.mode === 'SIMULATION';
      state.bot.safeMode = d.bot.safeMode === true; state.bot.emergency = d.bot.emergency === true; state.bot.emergencyReason = str(d.bot.emergencyReason, 120);
    }
    const numMap = (o, maxV) => { const out = {}; if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (k.startsWith('solana:') && isNum(v) && v >= 0) out[k] = maxV != null ? Math.min(v, maxV) : v; return out; };
    if (d.risk && typeof d.risk === 'object') {
      const r = d.risk, R = state.risk;
      R.buyCount = numMap(r.buyCount); R.coinCooldown = numMap(r.coinCooldown); R.stratCooldown = numMap(r.stratCooldown);
      for (const k of ['lossCooldownUntil', 'globalPauseUntil', 'lossStreak', 'dailyPnl', 'dailyTrades']) if (isNum(r[k])) R[k] = r[k];
      if (oldVer) { R.lossCooldownUntil = 0; R.globalPauseUntil = 0; } // laufende Pause/Cooldown aus der alten 10/5-Regel beenden
      if (isNum(r.dailyStartEquity)) R.dailyStartEquity = r.dailyStartEquity;
      R.dayKey = typeof r.dayKey === 'string' ? r.dayKey : ''; R.dailyLimitHit = r.dailyLimitHit === true; R.reviewRequired = r.reviewRequired === true;
      R.buyTimes = arr(r.buyTimes).filter(isNum);
    }
    const pf = d.portfolio;
    state.portfolio = pf && isNum(pf.cash) && isNum(pf.startCapital) ? { ...freshPortfolio(pf.startCapital), ...Object.fromEntries(Object.entries(pf).filter(([, v]) => isNum(v))) } : freshPortfolio(state.settings.simCapitalUsd);
    state.positions = arr(d.positions).filter(p => p && p.status === 'OPEN' && isMint(p.mint) && isNum(p.qty) && p.qty > 0 && isNum(p.entryPrice) && p.entryPrice > 0 && Array.isArray(p.entries));
    for (const p of state.positions) { p.value = null; p.pnlUsd = null; p.pnlPct = null; p.priceLabel = 'STALE'; if (!POSITION_TRANSITIONS[p.lc]) { p.lc = p.exits.length ? 'PARTIAL' : 'OPEN'; p.lcHistory = [{ s: p.lc, ts: env.now(), note: 'Lebenszyklus aus Positionsdaten abgeleitet (Migration)' }]; } }
    state.orders = arr(d.orders).filter(o => o && typeof o.id === 'string' && ORDER_TRANSITIONS[o.state] && Array.isArray(o.history));
    state.journal = arr(d.journal).filter(j => j && typeof j.id === 'string' && isMint(j.mint));
    state.feed = arr(d.feed).filter(f => f && typeof f.id === 'string').slice(0, 120);
    state.watchlist = {};
    if (d.watchlist && typeof d.watchlist === 'object') for (const [k, w] of Object.entries(d.watchlist)) if (isMint(mintOfId(k)) && w && typeof w === 'object') state.watchlist[k] = { note: str(w.note, 200), priority: clamp(+w.priority || 2, 1, 3), alerts: w.alerts !== false, priceAbove: isNum(w.priceAbove) ? w.priceAbove : null, priceBelow: isNum(w.priceBelow) ? w.priceBelow : null, scoreAbove: isNum(w.scoreAbove) ? w.scoreAbove : null, addedAt: isNum(w.addedAt) ? w.addedAt : env.now(), symbol: str(w.symbol, 24) };
    if (d.seen && typeof d.seen === 'object') for (const [k, v] of Object.entries(d.seen)) if (v && isNum(v.mc) && isNum(v.t)) state.seen[k] = { mc: v.mc, t: v.t, sym: str(v.sym, 24) };
    if (d.alertMarks && typeof d.alertMarks === 'object') for (const [k, v] of Object.entries(d.alertMarks)) if (isNum(v)) state.alertMarks[k] = v;
    state.paramVersions = arr(d.paramVersions).filter(p => p && isNum(p.version) && p.params);
    if (isNum(d.activeParam)) state.activeParam = d.activeParam;
    state.configLog = arr(d.configLog).slice(0, 200); state.auditLog = arr(d.auditLog).slice(0, 400); state.sessions = arr(d.sessions).slice(0, 50);
    if (d.session && typeof d.session === 'object' && d.session.id) state.session = d.session;
    if (d.stratStats && typeof d.stratStats === 'object') state.stratStats = d.stratStats;
    state.falseSignals = arr(d.falseSignals).slice(0, 60);
    state.btRuns = arr(d.btRuns).filter(r => r && typeof r.id === 'string' && isNum(r.ts)).slice(0, 20);
    if (d.hist && typeof d.hist === 'object') for (const k of ['equity', 'risk', 'api', 'scanner']) state.hist[k] = arr(d.hist[k]).slice(-500);
    state.usedKeys = new Map(arr(d.usedKeys).filter(x => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string'));
    const restored = arr(d.logs).filter(e => e && LOG_LEVELS.includes(e.level) && isNum(e.ts)).map(e => ({ ...e, restored: true }));
    log.entries.unshift(...restored);
    if (d.ui && typeof d.ui === 'object') state.ui = d.ui;
    if (isNum(d.tradeSeq)) state.tradeSeq = d.tradeSeq;
    if (d.reconciliation && d.reconciliation.required === true) state.reconciliation = { required: true, issues: arr(d.reconciliation.issues).map(x => str(String(x), 200)), at: isNum(d.reconciliation.at) ? d.reconciliation.at : env.now() };
    if (zeroed.length) state.configLog.unshift({ ts: env.now(), who: 'MIGRATION', kind: 'settings', changes: zeroed });
    const lp = loadLearnParts(d);
    state.learn = lp.learn; state.research = lp.research; state.patterns = lp.patterns;
    if (lp.models) state.models = lp.models;
  }
  /* Recovery: bekannte Fälle deterministisch & konservativ auflösen, alles Unsichere → RECONCILIATION REQUIRED (keine neuen Käufe bis bestätigt). */
  function reconcile(loadInfo = {}) {
    const issues = [];
    for (const o of state.orders) {
      if (TERMINAL.has(o.state)) continue;
      const from = o.state; o.state = 'RECONCILING'; o.history.push({ s: 'RECONCILING', ts: env.now(), note: 'Nach Neustart ungeklärt (' + from + ')' });
      const inPos = f => state.positions.some(p => arr(p[f]).some(e => e.orderId === o.id)) || state.journal.some(j => arr(j[f]).some(e => e.orderId === o.id));
      const filled = o.side === 'BUY' ? inPos('entries') : inPos('exits');
      transition(o, filled ? 'COMPLETED' : 'CANCELLED', filled ? 'Abgleich: Füllung gefunden' : 'Abgleich: keine Füllung gefunden → nicht ausgeführt');
      if (!filled && o.key && state.usedKeys.get(o.key) === 'pending') state.usedKeys.delete(o.key);
      issues.push(`Order ${o.id} (${o.side} ${o.symbol}) war ${from} → ${filled ? 'COMPLETED' : 'CANCELLED'}`);
    }
    for (const [k, v] of [...state.usedKeys.entries()]) if (v === 'pending') state.usedKeys.delete(k);
    for (const p of state.positions) if (p.lc === 'CLOSING' || p.lc === 'UNKNOWN') { const to = p.exits.length ? 'PARTIAL' : 'OPEN'; if (p.lc === 'CLOSING') posTransition(p, 'UNKNOWN', 'Neustart während eines Verkaufs'); posTransition(p, to, 'Abgleich: Menge aus bestätigten Füllungen'); issues.push(`Position ${p.symbol}: Verkauf beim Neustart unterbrochen → ${to} (Menge aus bestätigten Füllungen)`); }
    for (const j of state.journal) if (j.status === 'OPEN' && !state.positions.some(p => p.id === j.id)) { j.status = 'UNRESOLVED'; issues.push(`Journal ${j.id} (${j.symbol}) offen ohne Position → UNRESOLVED`); }
    for (const p of state.positions) if (!state.journal.some(j => j.id === p.id)) {
      state.journal.unshift({ id: p.id, tokenId: p.tokenId, symbol: p.symbol, name: p.name || '', mint: p.mint, pair: p.pair, dexId: p.dexId, mode: p.mode, status: 'OPEN', openedAt: p.openedAt, closedAt: null, entries: deepClone(p.entries), exits: deepClone(p.exits), sizeUsd: p.investedUsd, feesUsd: p.feesUsd, slippageUsd: p.slippageUsd, score: p.entryScore, confidence: null, risk: null, signals: [], strategy: p.strategy, auto: null, reason: 'Aus Positionsdaten rekonstruiert (Abgleich)', sources: [], tags: ['RECONCILED'], regime: [], decision: null, paramVersion: p.paramVersion, result: null, exitReason: null, mae2m: null, holdMs: null });
      issues.push(`Position ${p.symbol} ohne Journal-Eintrag → Eintrag rekonstruiert`);
    }
    // Buy-Zähler nie senken: mindestens Anzahl abgeschlossener BUY-Orders der aktuellen Session
    const sid = state.session ? state.session.id : null;
    if (sid) {
      const cnt = {}; for (const o of state.orders) if (o.side === 'BUY' && o.state === 'COMPLETED' && o.key && o.key.endsWith(':' + sid)) cnt[o.tokenId] = (cnt[o.tokenId] || 0) + 1;
      for (const [id, n] of Object.entries(cnt)) if ((state.risk.buyCount[id] || 0) < n) { state.risk.buyCount[id] = n; issues.push(`Buy-Zähler ${id.slice(7, 13)}… auf ${n} korrigiert`); }
    }
    const sq = loadInfo.seqs;
    if (sq) { const vals = [sq.runtime, sq.positions, sq.trades].filter(x => x != null); if (vals.length && new Set(vals).size > 1) issues.push(`Speicherbereiche nicht synchron (Runtime ${sq.runtime}, Positionen ${sq.positions}, Trades ${sq.trades})`); }
    for (const c of loadInfo.corrupted || []) issues.push(`Speicherbereich „${c}“ beschädigt – mit sicheren Defaults ersetzt`);
    if (issues.length) {
      state.reconciliation = { required: true, issues: [...state.reconciliation.issues, ...issues].slice(-40), at: env.now() };
      log.warn('SYSTEM', `RECONCILIATION REQUIRED: ${issues.length} Punkt(e) – neue Käufe blockiert bis zur Bestätigung`);
    }
    return issues.length;
  }
  function ackReconciliation() {
    if (!state.reconciliation.required) return { ok: true };
    audit('USER', 'RECONCILIATION_ACK', state.reconciliation.issues.length + ' Punkte bestätigt', state.reconciliation.issues.slice(0, 5).join('; '));
    state.reconciliation = { required: false, issues: [], at: env.now() };
    log.info('SYSTEM', 'Abgleich bestätigt – Handel wieder möglich (alle anderen Regeln gelten weiter)');
    persistNow();
    return { ok: true };
  }
  function init(o = {}) {
    const loaded = store.load();
    const rn = parseJSON(opts.backend.get(RESTORE_NOTE_KEY));
    if (rn) opts.backend.remove(RESTORE_NOTE_KEY);
    state.loadInfo = { migrated: loaded.migrated || 0, corrupted: arr(loaded.corrupted).length > 0, hadData: !!loaded.data };
    hydrate(loaded.data);
    reconcile({ seqs: loaded.data && loaded.data.seqs, corrupted: arr(loaded.corrupted).filter(c => ['runtime', 'positions', 'trades', 'v2'].includes(c)) });
    ensureSession();
    if (!state.paramVersions.length) { state.paramVersions.push({ version: 1, ts: env.now(), params: pickTunable(), status: 'STABLE', note: 'Initiale Parameter', perf: null, tradeCount: 0, basedOn: null }); state.activeParam = 1; }
    if (!state.models.versions[0].ts) state.models = freshModels(learnParamsNow(), env.now());
    state.learn.corrupted = arr(loaded.corrupted).filter(c => LEARN_STORAGE_KEYS.includes(c));
    try { learnBackfill(); } catch (e) { log.error('LEARNING', 'Migration der Lerndaten fehlgeschlagen: ' + e.message); }
    try { slippageMigrate(); learnQualityMigrate(); } catch (e) { log.error('LEARNING', 'Datenbereinigung 2.12.0 fehlgeschlagen: ' + e.message); }
    // Ab 2.7.0: Fehlerklasse & „erwartbarer Verlust?“ für bereits ausgewertete Verluste ergänzen (Ursache bleibt unverändert)
    let ecAdded = 0;
    for (const r of state.learn.records) if (r.labels && !r.outcome.win && !('errorClass' in r.labels)) { withErrorClass(r.labels, r, S()); ecAdded++; }
    if (ecAdded) { touch('learning'); log.info('LEARNING', `Migration: Fehlerklasse für ${ecAdded} ausgewertete Verluste ergänzt (ohne geplanten Stop → aktueller Stop-Loss als Näherung)`); }
    if (rn && isNum(rn.at)) { audit('USER', 'RESTORE', `Sicherung vom ${str(String(rn.from), 30)} (v${str(String(rn.app), 12)}) wiederhergestellt`); log.info('STORAGE', `Sicherung vom ${str(String(rn.from), 30)} wiederhergestellt`); }
    for (const p of state.positions) ensureToken(p.mint, 'Position');
    for (const id of Object.keys(state.watchlist)) ensureToken(mintOfId(id), 'Watchlist');
    rpcEndpoints();
    dayRollover();
    if (state.bot.emergency) { state.bot.state = 'EMERGENCY_STOP'; if (S().keepScannerOnEstop && o.autoStart !== false) startScanner(); }
    else if (o.autoStart !== false && state.bot.desired !== 'STOPPED') { setBotState('STARTING', 'Systemstart'); state.bot.startedAt = env.now(); startScanner(); setBotState('RECOVERING', 'Datenqualität wird geprüft'); }
    log.info('SYSTEM', `Smart Lab v${APP_VERSION} initialisiert · Modus ${state.mode} · Auto-Trading ${state.bot.autoTrading ? 'AN' : 'AUS'}${state.loadInfo.migrated ? ' · Daten aus v' + state.loadInfo.migrated + ' migriert' : ''}`);
    persistNow();
  }

  /* ---------- Export / Import / Reset ---------- */
  function exportData(kind) {
    const ts = new Date(env.now()).toISOString().replace(/[:.]/g, '-');
    if (kind === 'journal-csv') {
      const cols = ['id', 'mode', 'status', 'symbol', 'mint', 'pair', 'openedAt', 'closedAt', 'sizeUsd', 'feesUsd', 'slippageUsd', 'pnlUsd', 'pnlPct', 'score', 'confidence', 'risk', 'strategy', 'signals', 'exitReason', 'holdMin', 'reason', 'discovery'];
      const rows = state.journal.map(j => [j.id, j.mode, j.status, j.symbol, j.mint, j.pair, isoTime(j.openedAt), isoTime(j.closedAt), j.sizeUsd, j.feesUsd, j.slippageUsd, j.result ? j.result.pnlUsd : '', j.result && isNum(j.result.pnlPct) ? j.result.pnlPct.toFixed(2) : '', j.score, j.confidence, j.risk ? j.risk.total : '', j.strategy, j.signals.map(s => s.type).join('|'), j.exitReason, j.holdMs ? (j.holdMs / MIN).toFixed(1) : '', j.reason, j.discovery || '']);
      return { name: `smartlab-journal-${ts}.csv`, mime: 'text/csv', data: [cols, ...rows].map(r => r.map(csvCell).join(',')).join('\n') };
    }
    if (kind === 'backup-json') return { name: `smartlab-backup-${ts}.json`, mime: 'application/json', data: JSON.stringify(exportBackup()) };
    if (kind === 'learning-report-csv') {
      const cols = ['tradeId', 'symbol', 'strategy', 'openedAt', 'closedAt', 'pnlUsd', 'pnlPct', 'win', 'lossFamily', 'secondary', 'evidence', 'avoidable', 'dataCompleteness', 'dataQuality', 'signalQuality', 'exitQuality', 'executionQuality', 'regimeFit', 'score', 'regime', 'mae2m', 'mfe2m', 'maxRunupPct', 'followUpMaxPct', 'exitReason', 'legacy', 'errorClass', 'lossVerdict', 'plannedStopPct', 'discovery'];
      const rows = state.learn.records.map(r => { const l = r.labels || {}; return [r.tradeId, r.symbol, r.strategy || 'manuell', isoTime(r.openedAt), isoTime(r.closedAt), r.outcome.pnlUsd, r.outcome.pnlPct, r.outcome.win, l.lossFamily || '', arr(l.secondary).join('|'), l.lossFamily ? (l.evidence || {})[l.lossFamily] : '', l.avoidable, l.dataCompleteness, l.dataQuality, l.signalQuality, l.exitQuality, l.executionQuality, l.regimeFit, r.entry ? r.entry.finalScore : '', arr(r.regimeTags).join('|'), r.path.mae2m, r.path.mfe2m, r.path.maxRunupPct, r.followUp ? r.followUp.maxAfterPct : '', r.exit.reason, !!r.legacy, l.errorClass || '', l.lossVerdict || '', l.expectedLoss && isNum(l.expectedLoss.plannedPct) ? l.expectedLoss.plannedPct : '', (r.entry && r.entry.disc) || '']; });
      return { name: `smartlab-learning-report-${ts}.csv`, mime: 'text/csv', data: [cols, ...rows].map(r => r.map(csvCell).join(',')).join('\n') };
    }
    const payloads = {
      'journal-json': () => ({ journal: state.journal }),
      'settings-json': () => ({ settings: Object.fromEntries(Object.entries(state.settings).filter(([k]) => !(SETTINGS_INDEX[k] && SETTINGS_INDEX[k].secret))), strategies: state.strategies, watchlist: state.watchlist }), // ohne API-Keys (Datei wird oft weitergegeben)
      'analytics-json': () => ({ performance: perfStats(state.journal), stratStats: state.stratStats, falseSignals: state.falseSignals, paramVersions: state.paramVersions, sessions: state.sessions, hist: state.hist }),
      'logs-json': () => ({ logs: log.entries, audit: state.auditLog, config: state.configLog }),
      'learning-json': () => ({ learning: state.learn }),
      'experiments-json': () => ({ research: state.research }),
      'patterns-json': () => ({ patterns: state.patterns, stats: learnView().stats }),
      'model-registry-json': () => ({ models: state.models, rulesActive: rulesText(state.models.rules), bounds: LEARN_BOUNDS })
    };
    if (!payloads[kind]) throw new Error('Unbekannter Export');
    return { name: `smartlab-${kind.replace('-json', '')}-${ts}.json`, mime: 'application/json', data: JSON.stringify({ app: APP_VERSION, exportedAt: isoTime(env.now()), kind, ...payloads[kind]() }, null, 2) };
  }
  /* Voll-Backup: alle Speicherbereiche (smartlab.v3.*) in einer Datei – z. B. zur Sicherung oder zum Übertragen auf ein anderes Gerät.
     Enthält keine Passwörter oder Keys; nur selbst eingetragene RPC-URLs stehen in den Einstellungen. */
  function exportBackup() {
    persistNow();
    const storage = {};
    for (const [k, key] of Object.entries(STORAGE_KEYS)) { const d = parseJSON(opts.backend.get(key)); if (d && typeof d === 'object') storage[k] = d; }
    return { app: APP_VERSION, storageVersion: STORAGE_VERSION, exportedAt: isoTime(env.now()), kind: 'backup', storage };
  }
  function validateBackup(obj) {
    if (!obj || typeof obj !== 'object' || obj.kind !== 'backup' || !obj.storage || typeof obj.storage !== 'object' || Array.isArray(obj.storage)) return 'Keine Smart-Lab-Sicherung (Kennung „backup“ fehlt)';
    if (obj.storageVersion !== STORAGE_VERSION) return `Speicherversion ${String(obj.storageVersion).slice(0, 8)} wird nicht unterstützt (erwartet ${STORAGE_VERSION})`;
    if (typeof obj.app !== 'string' || !/^\d+\.\d+\.\d+$/.test(obj.app)) return 'App-Version der Sicherung fehlt';
    if (verLt(APP_VERSION, obj.app)) return `Sicherung stammt aus der neueren Version ${obj.app} – bitte zuerst die App aktualisieren`;
    const unknown = Object.keys(obj.storage).filter(k => !STORAGE_KEYS[k]);
    if (unknown.length) return 'Unbekannte Bereiche in der Sicherung: ' + unknown.slice(0, 3).join(', ');
    if (!obj.storage.settings) return 'Sicherung enthält keine Einstellungen';
    for (const [k, d] of Object.entries(obj.storage)) if (!d || typeof d !== 'object' || d.v !== STORAGE_VERSION) return `Bereich „${k}“ ist beschädigt`;
    return null;
  }
  /* Wiederherstellen: prüfen → in einer isolierten Instanz vollständig laden (wie ein echter Start) → erst dann schreiben.
     Danach ist der Speicher eingefroren, bis die Seite neu geladen wird (kein Überschreiben durch den laufenden Bot). */
  function restoreBackup(obj) {
    const err = validateBackup(obj); if (err) return { ok: false, error: err };
    try {
      const mem = createMemoryBackend();
      for (const [k, d] of Object.entries(obj.storage)) mem.set(STORAGE_KEYS[k], JSON.stringify(d));
      const probe = createCore({ env: { ...env, fetch: async () => { throw new Error('Probe ohne Netzwerk'); } }, backend: mem });
      probe.init({ autoStart: false });
      if (probe.state.loadInfo.corrupted) return { ok: false, error: 'Sicherung lässt sich nicht fehlerfrei laden (beschädigte Bereiche)' };
    } catch (e) { return { ok: false, error: 'Sicherung lässt sich nicht laden: ' + str(e.message, 120) }; }
    stopScanner(); storageFrozen = true;
    for (const [k, key] of Object.entries(STORAGE_KEYS)) { if (obj.storage[k]) opts.backend.set(key, JSON.stringify(obj.storage[k])); else opts.backend.remove(key); }
    opts.backend.remove(STORAGE_KEY_V2);
    opts.backend.set(RESTORE_NOTE_KEY, JSON.stringify({ at: env.now(), from: obj.exportedAt, app: obj.app }));
    return { ok: true };
  }
  /* Versionierte Backtest-Runs: Zusammenfassung je Run-ID (Dataset-Hash + Parameter + Kosten + Code-Version) */
  function recordBacktest(sum0) {
    if (!sum0 || typeof sum0.id !== 'string') return;
    state.btRuns = [{ ...sum0, ts: env.now() }, ...state.btRuns.filter(r => r.id !== sum0.id)].slice(0, 20);
    log.info('SYSTEM', `Backtest ${sum0.id} (${sum0.symbol} ${sum0.strategy} ${sum0.tf}): Test ${fmtSigned(sum0.testNet)} bei ${sum0.testTrades} Trades`); persist();
  }
  function importSettings(text) {
    const d = parseJSON(text); if (!d || typeof d !== 'object') return { ok: false, errors: [{ msg: 'Datei ist kein gültiges JSON' }] };
    const errors = [];
    if (d.settings) errors.push(...updateSettings(d.settings, 'IMPORT').errors);
    if (d.strategies) errors.push(...updateStrategies(d.strategies, 'IMPORT').errors);
    let wl = 0;
    if (d.watchlist && typeof d.watchlist === 'object') for (const [k, w] of Object.entries(d.watchlist)) if (isMint(mintOfId(k))) { addWatch(k); updateWatch(k, w || {}); wl++; }
    audit('USER', 'IMPORT', `Settings/Strategien/Watchlist (${wl} Einträge)`);
    return { ok: true, errors, watchlist: wl };
  }
  function resetSettings() { const r = updateSettings(defaultSettings(), 'RESET'); updateStrategies(defaultStrategies(), 'RESET'); audit('USER', 'CONFIG_RESET', ''); return r; }
  function resetPortfolio() {
    if (state.positions.length) return { ok: false, error: 'Nicht möglich: offene Positionen vorhanden' };
    state.portfolio = freshPortfolio(S().simCapitalUsd); state.risk.dailyStartEquity = S().simCapitalUsd; state.hist.equity = [];
    audit('USER', 'PORTFOLIO_RESET', fmtUsd(S().simCapitalUsd)); persistNow(); return { ok: true };
  }
  /* Frischer Start: Startkapital zurück, offene Positionen und Orders verworfen, Risiko-Zähler/Cooldowns
     frei. Journal, Statistiken, Lern-/Analysedaten, Logs, Alarme, Watchlist und Einstellungen bleiben erhalten;
     verworfene Positionen stehen im Journal als RESET und zählen nicht in die Performance-Statistik. */
  function freshStart() {
    if (state.locks.size) return { ok: false, error: 'Eine Order wird gerade ausgeführt – bitte kurz warten' };
    const now = env.now(), cap = S().simCapitalUsd;
    let cancelled = 0;
    for (const o of state.orders) {
      if (TERMINAL.has(o.state)) continue;
      const to = ['CANCELLED', 'FAILED', 'COMPLETED'].find(x => (ORDER_TRANSITIONS[o.state] || []).includes(x));
      if (to) { transition(o, to, 'Frischer Start'); cancelled++; }
    }
    const dropped = state.positions.length;
    for (const p of state.positions) {
      const j = state.journal.find(x => x.id === p.id);
      if (j && j.status === 'OPEN') { j.status = 'RESET'; j.closedAt = now; j.exitReason = 'FRESH_START'; j.holdMs = now - j.openedAt; }
    }
    state.positions = [];
    for (const [k, v] of [...state.usedKeys.entries()]) if (v === 'pending') state.usedKeys.delete(k);
    state.portfolio = freshPortfolio(cap);
    Object.assign(state.risk, { buyCount: {}, coinCooldown: {}, stratCooldown: {}, lossCooldownUntil: 0, globalPauseUntil: 0, lossStreak: 0, dailyPnl: 0, dailyTrades: 0, dailyStartEquity: cap, dailyLimitHit: false, reviewRequired: false, buyTimes: [] });
    state.reconciliation = { required: false, issues: [], at: now };
    if (state.session) state.sessions.unshift({ ...state.session, endedAt: now, note: 'Frischer Start' });
    state.session = null; ensureSession();
    audit('USER', 'FRESH_START', `Startkapital ${fmtUsd(cap)} · ${dropped} Position(en) verworfen · ${cancelled} Order(s) storniert · Analysedaten behalten`);
    log.info('SYSTEM', `Frischer Start: Portfolio ${fmtUsd(cap)}, ${dropped} Position(en) verworfen – Journal, Statistiken und Lerndaten bleiben erhalten`);
    persistNow(); emit('trade', {}); emit('bot', {});
    return { ok: true, dropped, cancelled };
  }
  function newSession() {
    ensureSession(); state.sessions.unshift({ ...state.session, endedAt: env.now() });
    let reset = 0;
    if (S().resetBuyCountOnSession) for (const id of Object.keys(state.risk.buyCount)) if (!openPos(id)) { delete state.risk.buyCount[id]; reset++; }
    state.session = null; ensureSession();
    audit('USER', 'SESSION_RESET', `${reset} Buy-Zähler zurückgesetzt (Cooldowns bleiben aktiv)`); log.info('SYSTEM', `Neue Session ${state.session.id} – ${reset} Buy-Zähler zurückgesetzt`);
    persistNow(); return { ok: true, reset };
  }
  function factoryReset() {
    stopScanner();
    storageFrozen = true; // nach Reset nichts mehr zurückschreiben
    store.clear(); for (const k of ['c', 'w', 's', 'h', 'fd']) opts.backend.remove(k);
    return { ok: true };
  }
  function select(id) {
    state.selected = id && state.markets.has(id) ? id : null;
    const t = state.selected && state.markets.get(state.selected);
    if (t) enqueueSecurity(t, 2000);
  }

  return {
    state, log, http, env, on, init, S,
    start, pause, stop, emergencyStop, releaseEmergency, setMode, setAutoTrading, setSafeMode,
    executeBuy, executeSell, execCheck: (t, o) => execCheck(t, t.A, o), globalBlockers, buildCtx, estFees, estImpact, equityInfo, portfolioRisk, positionCorrelations,
    systemHealth, diagnostics, botHealth, readiness, drawdownPct, portfolioIntegrity, execProvider: m => execProvider(m).id, candidateChain, liveReadiness, preLiveChecks, ackReconciliation, requestSignature, rpcEndpoints, fetchOhlcv, fetchCandlesForBacktest, walletConnect, walletDisconnect, walletBalance, walletNetwork,
    updateSettings, updateStrategies, rollbackTo, addWatch, removeWatch, updateWatch, select, exportData, importSettings, resetSettings, resetPortfolio, freshStart,
    learnView, learnQuality, learnDecision, learnPromote, learnReject, learnRollback, activeParams, monitorMetrics, exportBackup, validateBackup, restoreBackup, recordBacktest, learnRunNow: () => { const r = learnRun(true); persistNow(); return r; },
    newSession, factoryReset, persistNow, enqueueSecurity, clearFeed: () => { state.feed = []; persist(); },
    drainTrades,
    _t: { touch, posTransition, runProviderSteps, liveProvider, simProvider, updatePriorityFee, writeOffPosition, scanOnce, updateSolPrice, applySnapshot, applyAlt, fetchChunk, reconcile, analyzeAll, startScanner, stopScanner, timers, managePositions, closePosition, processQueue, enqueue, checkSecurity, ensureToken, maybeAutoTrade, setBotState, learnRun, learnOnClose, learnFollowUps, finishFollowUp, createChallenger, shadowEval, liveEval, addRecord, nearMissTick, maybeTune, updateSettings, monitorTick }
  };
}
