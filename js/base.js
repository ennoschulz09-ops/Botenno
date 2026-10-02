/* Smart Lab – base.js
   Grundlagen: Konstanten · Utils · Logger · Settings · Storage · HTTP/Data Layer · Normalisierung & Security · Blocker
   Klassisches Skript ohne Build-Schritt: alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in fester
   Reihenfolge geladen (index.html bzw. server/load-core.js): base → engine → learning → core → selftest → ui.
   base, engine, learning, core und selftest laufen auch ohne Browser (Node.js); nur ui.js braucht das DOM. */
'use strict';

/* =====================================================================
   SMART LAB – Solana Memecoin Terminal
   Grundsätze: NO FAKE DATA · NO FAKE TRADES · NO DUPLICATE ORDERS · FAIL CLOSED
   ===================================================================== */

/* ============================== KONSTANTEN ============================== */
const APP_VERSION = '2.12.0';
/* true, wenn Version a älter als b ist (fehlende Version = sehr alt). */
const verLt = (a, b) => { if (typeof a !== 'string') return true; const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); } return false; };
const STRATEGY_VERSION = '1.0.0';
const DATA_ENGINE_VERSION = '1.0.0';
const STORAGE_KEY_V2 = 'smartlab.v2';
const STORAGE_VERSION = 3;
/* Storage logisch getrennt: Settings · Runtime · Positionen/Orders · Trades · Logs · Statistiken */
const RESTORE_NOTE_KEY = 'smartlab.restore.note';
const STORAGE_KEYS = Object.freeze({ settings: 'smartlab.v3.settings', runtime: 'smartlab.v3.runtime', positions: 'smartlab.v3.positions', trades: 'smartlab.v3.trades', logs: 'smartlab.v3.logs', stats: 'smartlab.v3.stats', learning: 'smartlab.v3.learning', experiments: 'smartlab.v3.experiments', models: 'smartlab.v3.models', patterns: 'smartlab.v3.patterns' });
const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;
const LAMPORTS_PER_SOL = 1000000000n;
const BASE_FEE_LAMPORTS = 5000;
const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const NON_MEME = new Set([WSOL, USDC, USDT]);
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const DEX_API = 'https://api.dexscreener.com';
const GT_API = 'https://api.geckoterminal.com/api/v2';
const RUG_API = 'https://api.rugcheck.xyz/v1';
const GT_HEADERS = { Accept: 'application/json;version=20230302' };
/* Stufe B: echte Kursangebote über die Jupiter Quote API – nur Abfrage (GET /quote), nie /swap, nie Signatur. */
const JUP_API_FREE = 'https://lite-api.jup.ag/swap/v1';   // kostenloser Zugang ohne Key (Rate-Limit)
const JUP_API_KEYED = 'https://api.jup.ag/swap/v1';       // mit eigenem API-Key (Header x-api-key)
const JUP_NO_ROUTE = new Set(['COULD_NOT_FIND_ANY_ROUTE', 'NO_ROUTES_FOUND', 'TOKEN_NOT_TRADABLE', 'ROUTE_PLAN_DOES_NOT_CONSUME_ALL_THE_AMOUNT', 'MARKET_NOT_FOUND']);
const SWAP_CU = 300000;                  // geschätzte Compute Units eines Jupiter-Swaps (µLamports/CU → Lamports)
const PRIO_FEE_MAX_LAMPORTS = 10000000;  // Obergrenze der automatischen Priority-Fee-Schätzung (0,01 SOL)
const QUOTE_CHECK_TTL = 5 * MIN;         // so lange gilt ein Honeypot-/Rundreise-Befund für einen Coin
const NO_ROUTE_WRITEOFF_MIN = 30;        // so lange ohne Verkaufsweg → Position wird als Totalverlust abgeschrieben
const SELL_RETRY_MS = 20 * SEC;          // Wartezeit nach gescheitertem Verkaufsangebot
const PYRAMID_MIN_PNL_PCT = 10;     // Buy #2 nur bei Gewinn (kein Averaging Down / Martingale)
const MIN_ORDER_USD = 5;

/* Ab 2.9.0 gibt es keine festen (harten) Grenzen mehr – Entscheidung Nutzer (2026-10-01). Alle Risiko-Limits sind
   Einstellungen und lassen sich bis „0 = aus“ stellen. Die Lern-KI verändert sie weiterhin nie (LEARN_SETTING_KEYS). */
/* Parameter, die Self-Optimization verändern darf – nur innerhalb dieser Grenzen. */
const TUNING_BOUNDS = Object.freeze({ minScore: [55, 90], stopLossPct: [8, 25], trailPct: [8, 20] });

/* ============================== UTILS ============================== */
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const num = v => {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const nonNeg = v => { const n = num(v); return n == null || n < 0 ? null : n; };
const int = v => { const n = num(v); return n == null || n < 0 ? null : Math.round(n); };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const m2 = v => Math.round(v * 100) / 100;
const m6 = v => Math.round(v * 1e6) / 1e6;
const arr = v => (Array.isArray(v) ? v : []);
const str = (v, max = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const isMint = s => typeof s === 'string' && B58.test(s);
const tokenIdOf = mint => 'solana:' + mint;
const mintOfId = id => (typeof id === 'string' && id.startsWith('solana:') ? id.slice(7) : null);
const shortAddr = a => (a && a.length > 10 ? a.slice(0, 4) + '…' + a.slice(-4) : a || '');
const sum = a => a.reduce((x, y) => x + y, 0);
const avg = a => (a.length ? sum(a) / a.length : null);
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const parseJSON = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch (e) { return d; } };
const deepClone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
const dayKeyOf = ts => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

const esc = s => String(s).replace(/[&<>"'`]/g, c => '&#' + c.charCodeAt(0) + ';');
/* Sicheres Templating: alle Interpolationen werden escaped, außer explizit per raw() markiert. */
const RAW = Symbol('raw');
const raw = s => ({ [RAW]: String(s) });
function hv(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(hv).join('');
  if (typeof v === 'object' && RAW in v) return v[RAW];
  return esc(v);
}
function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += hv(vals[i]) + strings[i + 1];
  return raw(out);
}
/* URL-Validierung: nur https, keine Credentials. */
function safeUrl(u) {
  if (typeof u !== 'string' || u.length > 600) return null;
  try {
    const x = new URL(u.trim());
    if (x.protocol !== 'https:' || x.username || x.password) return null;
    return x.href;
  } catch (e) { return null; }
}
function maskUrl(u) {
  try {
    const x = new URL(u);
    const path = x.pathname.split('/').map(p => (p.length >= 16 ? '***' : p)).join('/');
    return x.protocol + '//' + x.host + path + (x.search ? '?***' : '');
  } catch (e) { return '(ungültige URL)'; }
}
const LINKS = {
  dexscreener: (pair, mint) => 'https://dexscreener.com/solana/' + encodeURIComponent(isMint(pair) ? pair : mint),
  rugcheck: mint => 'https://rugcheck.xyz/tokens/' + encodeURIComponent(mint),
  solscanToken: mint => 'https://solscan.io/token/' + encodeURIComponent(mint),
  solscanAccount: a => 'https://solscan.io/account/' + encodeURIComponent(a),
  solscanTx: sig => 'https://solscan.io/tx/' + encodeURIComponent(sig),
  birdeye: mint => 'https://birdeye.so/token/' + encodeURIComponent(mint) + '?chain=solana',
  gecko: pair => 'https://www.geckoterminal.com/solana/pools/' + encodeURIComponent(pair),
  axiom: pair => 'https://axiom.trade/meme/' + encodeURIComponent(pair),
  xsearch: mint => 'https://x.com/search?q=' + encodeURIComponent(mint)
};

/* ---- Formatierung (Decimal Precision für sehr kleine Preise) ---- */
const SUBS = '₀₁₂₃₄₅₆₇₈₉';
function fmtPrice(p) {
  if (!isNum(p)) return '—';
  if (p === 0) return '$0';
  const a = Math.abs(p), s = p < 0 ? '-$' : '$';
  if (a >= 1000) return s + a.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a >= 1) return s + a.toFixed(4);
  if (a >= 0.001) return s + a.toPrecision(4);
  let e = Math.floor(Math.log10(a));
  let mant = (a / Math.pow(10, e)).toFixed(3);
  if (mant.startsWith('10')) { e += 1; mant = (a / Math.pow(10, e)).toFixed(3); }
  const zeros = -e - 1;
  const digits = mant.replace('.', '').replace(/0+$/, '') || '0';
  return s + '0.0' + String(zeros).split('').map(d => SUBS[+d]).join('') + digits;
}
function fmtUsd(n, d = 2) {
  if (!isNum(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return s + '$' + (a / 1e3).toFixed(1) + 'K';
  return s + '$' + a.toFixed(d);
}
/* Market Cap immer mit „MC“ gekennzeichnet (38k MC, 1.2M MC, 5B MC) – nie mit dem Coin-Preis verwechselbar. */
function fmtMc(n) {
  if (!isNum(n) || n <= 0) return '—';
  const U = [[1, ''], [1e3, 'k'], [1e6, 'M'], [1e9, 'B'], [1e12, 'T']];
  let i = U.length - 1; while (i > 0 && n < U[i][0]) i--;
  const fmt = v => (v < 10 && i > 0 ? String(Math.round(v * 10) / 10) : String(Math.round(v)));
  let s = fmt(n / U[i][0]);
  if (+s >= 1000 && i < U.length - 1) { i++; s = fmt(n / U[i][0]); }
  return s + U[i][1] + ' MC';
}
/* Text-Ausgabe (Logs, Alarme): „Coin-Preis $0.0₄123 · 38k MC“ – MC über das aktuelle MC/Preis-Verhältnis. */
function pxMcTxt(A, price) {
  const r = A && isNum(A.core.mc) && isNum(A.core.price) && A.core.price > 0 ? A.core.mc / A.core.price : null;
  return 'Coin-Preis ' + fmtPrice(price) + (r != null && isNum(price) && price > 0 ? ' · ' + fmtMc(price * r) : '');
}
const fmtSigned = (n, f = fmtUsd) => (!isNum(n) ? '—' : (n > 0 ? '+' : '') + f(n));
function fmtPct(v, d = 1) { return isNum(v) ? (v > 0 ? '+' : '') + v.toFixed(d) + '%' : '—'; }
function fmtNum(v, d = 0) { return isNum(v) ? v.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—'; }
function fmtAge(ms) {
  if (!isNum(ms) || ms < 0) return '—';
  if (ms < MIN) return Math.round(ms / SEC) + 's';
  if (ms < HOUR) return Math.round(ms / MIN) + 'm';
  if (ms < DAY) return (ms / HOUR).toFixed(1) + 'h';
  return (ms / DAY).toFixed(1) + 'd';
}
const fmtTime = ts => (isNum(ts) && ts > 0 ? new Date(ts).toLocaleTimeString('de-DE', { hour12: false }) : '—');
const fmtDateTime = ts => (isNum(ts) && ts > 0 ? new Date(ts).toLocaleString('de-DE', { hour12: false }) : '—');
const isoTime = ts => (isNum(ts) ? new Date(ts).toISOString() : '');

/* ---- SOL / Lamports (exakt über BigInt) ---- */
function lamportsToSol(l) {
  const b = BigInt(l); const neg = b < 0n; const a = neg ? -b : b;
  return (neg ? '-' : '') + (a / LAMPORTS_PER_SOL).toString() + '.' + (a % LAMPORTS_PER_SOL).toString().padStart(9, '0');
}
function solToLamports(s) {
  const m = String(s).trim().match(/^(\d+)(?:\.(\d{0,9}))?$/);
  if (!m) return null;
  return BigInt(m[1]) * LAMPORTS_PER_SOL + BigInt((m[2] || '').padEnd(9, '0'));
}
/* Token-Rohbetrag + Decimals -> Zahl (für Anzeigen/Prozente) */
function rawToUi(amountStr, decimals) {
  if (typeof amountStr !== 'string' || !/^\d+$/.test(amountStr) || !isNum(decimals)) return null;
  const b = BigInt(amountStr), d = 10n ** BigInt(decimals);
  return Number(b / d) + Number(b % d) / Number(d);
}

/* ---- Technische Indikatoren (reine Funktionen, nur auf vorhandenen Daten) ---- */
function emaSeries(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let e = sum(values.slice(0, period)) / period;
  out[period - 1] = e;
  for (let i = period; i < values.length; i++) { e = values[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
const ema = (values, period) => { const s = emaSeries(values, period); return s.length ? s[s.length - 1] : null; };
function sma(values, period) { if (values.length < period) return null; return sum(values.slice(-period)) / period; }
function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = values[i] - values[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= period; l /= period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    g = (g * (period - 1) + Math.max(d, 0)) / period;
    l = (l * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (l === 0) return g === 0 ? 50 : 100;
  return 100 - 100 / (1 + g / l);
}
function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  let a = sum(trs.slice(0, period)) / period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}
function roc(values, n) { if (values.length <= n) return null; const a = values[values.length - 1 - n]; return a > 0 ? (values[values.length - 1] / a - 1) * 100 : null; }
function vwap(candles) { let pv = 0, v = 0; for (const c of candles) { pv += ((c.h + c.l + c.c) / 3) * c.v; v += c.v; } return v > 0 ? pv / v : null; }
function stdev(a) { if (a.length < 2) return null; const m = avg(a); return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1)); }
function pearson(a, b) {
  const n = Math.min(a.length, b.length); if (n < 8) return null;
  const x = a.slice(-n), y = b.slice(-n), mx = avg(x), my = avg(y);
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sx += (x[i] - mx) ** 2; sy += (y[i] - my) ** 2; }
  return sx > 0 && sy > 0 ? sxy / Math.sqrt(sx * sy) : null;
}
function logReturns(p) { const r = []; for (let i = 1; i < p.length; i++) if (p[i - 1] > 0 && p[i] > 0) r.push(Math.log(p[i] / p[i - 1])); return r; }

/* ============================== LOGGER ============================== */
const LOG_LEVELS = ['DEBUG', 'INFO', 'SUCCESS', 'WARNING', 'ERROR', 'CRITICAL', 'TRADE', 'RISK', 'SECURITY'];
const SECRET_KEY_RX = /secret|private|seed|password|passphrase|api[-_]?key|authorization|mnemonic/i;
function sanitizeMeta(meta, depth = 0) {
  if (meta == null || depth > 3) return meta == null ? undefined : '[…]';
  if (typeof meta === 'string') return meta.length > 500 ? meta.slice(0, 500) + '…' : meta;
  if (typeof meta !== 'object') return meta;
  if (Array.isArray(meta)) return meta.slice(0, 20).map(x => sanitizeMeta(x, depth + 1));
  const o = {};
  for (const k of Object.keys(meta).slice(0, 30)) o[k] = SECRET_KEY_RX.test(k) ? '***' : sanitizeMeta(meta[k], depth + 1);
  return o;
}
function createLogger(env, max = 1500) {
  const entries = []; let seq = 0; const subs = new Set();
  function log(level, category, message, meta) {
    const e = { id: ++seq, ts: env.now(), level, category, message: String(message), meta: sanitizeMeta(meta) };
    entries.push(e);
    if (entries.length > max) entries.splice(0, entries.length - max);
    subs.forEach(fn => { try { fn(e); } catch (x) { /* Listener-Fehler dürfen Logging nicht brechen */ } });
    return e;
  }
  const api = { entries, log, on: fn => { subs.add(fn); return () => subs.delete(fn); } };
  api.debug = (c, m, x) => log('DEBUG', c, m, x);
  api.info = (c, m, x) => log('INFO', c, m, x);
  api.success = (c, m, x) => log('SUCCESS', c, m, x);
  api.warn = (c, m, x) => log('WARNING', c, m, x);
  api.error = (c, m, x) => log('ERROR', c, m, x);
  api.crit = (c, m, x) => log('CRITICAL', c, m, x);
  api.trade = (m, x) => log('TRADE', 'TRADE', m, x);
  api.risk = (m, x) => log('RISK', 'RISK', m, x);
  api.sec = (m, x) => log('SECURITY', 'SECURITY', m, x);
  return api;
}

/* ============================== SETTINGS ============================== */
const SETTINGS_SCHEMA = [
  // Scanner
  { k: 'scanIntervalMs', s: 'Scanner', l: 'Scan-Intervall', t: 'int', def: 1000, min: 1000, max: 60000, u: 'ms' },
  { k: 'discoveryIntervalSec', s: 'Scanner', l: 'Discovery-Intervall (neue Tokens)', t: 'int', def: 20, min: 10, max: 600, u: 's' },
  { k: 'maxTokens', s: 'Scanner', l: 'Max. Tokens im Scanner', t: 'int', def: 150, min: 20, max: 400 },
  { k: 'chunksPerTick', s: 'Scanner', l: 'Batch-Requests pro Scan (je 30 Tokens)', t: 'int', def: 2, min: 1, max: 6 },
  { k: 'staleAfterSec', s: 'Scanner', l: 'Marktdaten gelten als STALE nach', t: 'int', def: 20, min: 5, max: 300, u: 's' },
  { k: 'securityTtlMin', s: 'Scanner', l: 'Security-Daten gültig für', t: 'int', def: 30, min: 5, max: 240, u: 'min' },
  { k: 'rpcUrls', s: 'Scanner', l: 'Solana RPC-URLs (Komma-getrennt, nur https)', t: 'text', def: 'https://api.mainnet-beta.solana.com, https://solana-rpc.publicnode.com' },
  { k: 'keepScannerOnEstop', s: 'Scanner', l: 'Scanner bei Emergency Stop weiterlaufen lassen', t: 'bool', def: true },
  // Filter
  { k: 'minLiq', s: 'Filter', l: 'Min. Liquidität', t: 'num', def: 10000, min: 0, max: 1e9, u: '$' },
  { k: 'minVol1h', s: 'Filter', l: 'Min. Volumen 1h', t: 'num', def: 20000, min: 0, max: 1e10, u: '$' },
  { k: 'minMcap', s: 'Filter', l: 'Min. MC (Market Cap)', t: 'num', def: 50000, min: 0, max: 1e11, u: '$' },
  { k: 'maxMcap', s: 'Filter', l: 'Max. MC (Market Cap)', t: 'num', def: 5000000, min: 1000, max: 1e12, u: '$' },
  { k: 'minBuyRatio', s: 'Filter', l: 'Min. Käuferanteil 1h (0–1)', t: 'num', def: 0.55, min: 0, max: 1, step: 0.01 },
  { k: 'minScore', s: 'Filter', l: 'Min. Final Score', t: 'int', def: 65, min: 0, max: 100 },
  { k: 'minPairAgeMin', s: 'Filter', l: 'Min. Pair-Alter für Auto-Buys', t: 'int', def: 10, min: 0, max: 10080, u: 'min' },
  // Risiko
  { k: 'simCapitalUsd', s: 'Risiko', l: 'Startkapital Simulation/Paper', t: 'num', def: 1000, min: 10, max: 1e7, u: '$' },
  { k: 'maxExposurePct', s: 'Risiko', l: 'Max. Portfolio-Exposure', t: 'num', def: 30, min: 1, max: 100, u: '%' },
  { k: 'maxPositionPct', s: 'Risiko', l: 'Max. Positionsgröße', t: 'num', def: 5, min: 0.1, max: 100, u: '%' },
  { k: 'maxOpenPositions', s: 'Risiko', l: 'Max. offene Positionen (0 = unbegrenzt)', t: 'int', def: 3, min: 0, max: 100 },
  { k: 'dailyLossLimitPct', s: 'Risiko', l: 'Tagesverlust-Limit – Auto-Trading aus (0 = aus)', t: 'num', def: 10, min: 0, max: 100, u: '%' },
  { k: 'maxRiskScore', s: 'Risiko', l: 'Max. Risk Score für Käufe', t: 'int', def: 60, min: 0, max: 100 },
  { k: 'minConfidence', s: 'Risiko', l: 'Min. Data Confidence', t: 'int', def: 60, min: 0, max: 100 },
  { k: 'minSystemHealth', s: 'Risiko', l: 'Min. System Health für Trading (0 = aus)', t: 'int', def: 60, min: 0, max: 100 },
  { k: 'requireVerifiedSecurity', s: 'Risiko', l: 'Nur VERIFIED Security (RPC + RugCheck)', t: 'bool', def: false },
  { k: 'maxBuysPerCoin', s: 'Risiko', l: 'Max. Käufe pro Coin (0 = unbegrenzt)', t: 'int', def: 2, min: 0, max: 100 },
  { k: 'addOnlyInProfit', s: 'Risiko', l: `Nachkauf nur im Gewinn (ab +${PYRAMID_MIN_PNL_PCT} %, kein Nachkaufen im Verlust)`, t: 'bool', def: true },
  { k: 'sellCooldownMin', s: 'Risiko', l: 'Coin-Cooldown nach Verkauf (0 = aus)', t: 'int', def: 15, min: 0, max: 1440, u: 'min' },
  { k: 'lossCooldownMin', s: 'Risiko', l: 'Loss-Cooldown (global) nach Verlust (0 = aus)', t: 'int', def: 0, min: 0, max: 1440, u: 'min' },
  { k: 'lossStreakLimit', s: 'Risiko', l: 'Verlustserie bis globale Pause & Review (0 = aus)', t: 'int', def: 3, min: 0, max: 100 },
  { k: 'globalPauseMin', s: 'Risiko', l: 'Globale Pause nach Verlustserie (0 = aus)', t: 'int', def: 0, min: 0, max: 1440, u: 'min' },
  { k: 'maxTradesPerHour', s: 'Risiko', l: 'Overtrading-Limit Käufe/Stunde inkl. Bremse (0 = aus)', t: 'int', def: 6, min: 0, max: 1000 },
  { k: 'correlationLimit', s: 'Risiko', l: 'Korrelations-Grenze Konzentration (0 = aus)', t: 'num', def: 0.85, min: 0, max: 1, step: 0.01 },
  { k: 'ddReducePct', s: 'Risiko', l: 'Drawdown-Modus: Positionsgröße halbieren ab (0 = aus)', t: 'num', def: 10, min: 0, max: 100, u: '%' },
  { k: 'ddStopPct', s: 'Risiko', l: 'Drawdown-Grenze: keine Auto-Käufe ab (0 = aus)', t: 'num', def: 20, min: 0, max: 100, u: '%' },
  { k: 'signalConflictBlock', s: 'Risiko', l: 'Auto-Kauf bei widersprüchlichen Signalen verhindern', t: 'bool', def: true },
  { k: 'strategyCooldowns', s: 'Risiko', l: 'Strategie-Cooldown je Coin anwenden (Dauer je Strategie einstellbar)', t: 'bool', def: true },
  { k: 'lowQualityMarketBlock', s: 'Risiko', l: 'Marktweite Handelspause bei schlechter Datenlage', t: 'bool', def: true },
  { k: 'consensusMinWeight', s: 'Risiko', l: 'Min. Strategie-Konsens (Summe Gewichte)', t: 'num', def: 1.5, min: 0, max: 5, step: 0.1 },
  // Ausführung
  { k: 'maxSlippagePct', s: 'Ausführung', l: 'Max. Slippage / Price Impact (100 = praktisch aus)', t: 'num', def: 3, min: 0.1, max: 100, u: '%' },
  { k: 'dexFeePct', s: 'Ausführung', l: 'DEX-Gebühr (Schätzung)', t: 'num', def: 0.25, min: 0, max: 5, step: 0.01, u: '%' },
  { k: 'priorityFeeLamports', s: 'Ausführung', l: 'Priority Fee (fester Wert bzw. Mindestwert bei „automatisch“)', t: 'int', def: 100000, min: 0, max: 100000000, u: 'lamports' },
  { k: 'priorityFeeMode', s: 'Ausführung', l: 'Priority Fee ermitteln', t: 'select', def: 'auto', opts: [['auto', 'automatisch aus aktuellen Netzwerkgebühren (Solana RPC)'], ['fixed', 'fester Wert']] },
  { k: 'realQuotes', s: 'Ausführung', l: 'Echte Kursangebote (Jupiter) für Kauf und Verkauf abfragen – nur Abfrage, wird nie ausgeführt', t: 'bool', def: true },
  { k: 'jupApiKey', s: 'Ausführung', l: 'Jupiter API-Key (optional, leer = kostenloser Zugang)', t: 'text', def: '', secret: true },
  { k: 'quoteFallback', s: 'Ausführung', l: 'Ohne Jupiter-Angebot mit AMM-Schätzung weiter simulieren (als „geschätzt“ markiert)', t: 'bool', def: true },
  { k: 'honeypotBlock', s: 'Ausführung', l: 'Kauf verhindern, wenn es keinen Verkaufsweg gibt (Honeypot-Verdacht)', t: 'bool', def: true },
  { k: 'maxRoundTripLossPct', s: 'Ausführung', l: 'Max. Verlust bei Kauf und sofortigem Verkauf – Gebühren, Price Impact, Steuer (0 = aus)', t: 'num', def: 15, min: 0, max: 100, u: '%' },
  { k: 'simLatencyMs', s: 'Ausführung', l: 'Ausführungszeit: Füllung zum Preis nach dieser Wartezeit (0 = sofort)', t: 'int', def: 1500, min: 0, max: 30000, u: 'ms' },
  { k: 'simTxFailPct', s: 'Ausführung', l: 'Anteil gescheiterter Transaktionen – Netzwerkgebühr fällt trotzdem an (0 = aus)', t: 'num', def: 5, min: 0, max: 50, u: '%' },
  { k: 'snapshotMaxAgeSec', s: 'Ausführung', l: 'Max. Datenalter beim Pre-Trade-Check', t: 'int', def: 5, min: 2, max: 30, u: 's' },
  { k: 'maxActiveOrders', s: 'Ausführung', l: 'Max. gleichzeitige Orders', t: 'int', def: 1, min: 1, max: 20 },
  // Exits
  { k: 'stopLossPct', s: 'Exits', l: 'Stop Loss', t: 'num', def: 15, min: 2, max: 50, u: '%' },
  { k: 'useAtrStop', s: 'Exits', l: 'ATR-Stop verwenden (wenn OHLCV vorhanden)', t: 'bool', def: true },
  { k: 'atrMult', s: 'Exits', l: 'ATR-Multiplikator', t: 'num', def: 2.5, min: 1, max: 6, step: 0.1 },
  { k: 'tp1Pct', s: 'Exits', l: 'Take Profit 1', t: 'num', def: 30, min: 2, max: 500, u: '%' },
  { k: 'tp1Frac', s: 'Exits', l: 'TP1 Verkaufsanteil (0–1)', t: 'num', def: 0.33, min: 0.05, max: 1, step: 0.01 },
  { k: 'tp2Pct', s: 'Exits', l: 'Take Profit 2', t: 'num', def: 60, min: 3, max: 1000, u: '%' },
  { k: 'tp2Frac', s: 'Exits', l: 'TP2 Verkaufsanteil (0–1)', t: 'num', def: 0.33, min: 0.05, max: 1, step: 0.01 },
  { k: 'tp3Pct', s: 'Exits', l: 'Take Profit 3 (Rest)', t: 'num', def: 120, min: 4, max: 5000, u: '%' },
  { k: 'breakEvenAfterTp1', s: 'Exits', l: 'Break-even-Stop nach TP1', t: 'bool', def: true },
  { k: 'trailActivatePct', s: 'Exits', l: 'Trailing aktiv ab Gewinn', t: 'num', def: 25, min: 1, max: 500, u: '%' },
  { k: 'trailPct', s: 'Exits', l: 'Trailing-Abstand', t: 'num', def: 12, min: 2, max: 50, u: '%' },
  { k: 'timeExitMin', s: 'Exits', l: 'Time Exit nach', t: 'int', def: 45, min: 5, max: 1440, u: 'min' },
  { k: 'timeExitMinPnlPct', s: 'Exits', l: 'Time Exit wenn PnL unter', t: 'num', def: 5, min: -50, max: 100, u: '%' },
  { k: 'timeExitAuto', s: 'Exits', l: 'Time Exit automatisch ausführen', t: 'bool', def: true },
  { k: 'exitOnRiskCritical', s: 'Exits', l: 'Exit bei kritischem Risiko', t: 'bool', def: true },
  { k: 'liqCollapsePct', s: 'Exits', l: 'Exit bei Liquiditätsabfluss ab', t: 'num', def: 40, min: 10, max: 90, u: '%' },
  { k: 'momentumReversalExit', s: 'Exits', l: 'Exit bei Momentum-Umkehr', t: 'bool', def: true },
  { k: 'estopPositionRule', s: 'Exits', l: 'Emergency Stop: offene Positionen', t: 'select', def: 'hold', opts: [['hold', 'halten & weiter überwachen'], ['close', 'alle Sim/Paper-Positionen schließen']] },
  // Alerts
  { k: 'sound', s: 'Alerts', l: 'Ton', t: 'bool', def: true },
  { k: 'vibrate', s: 'Alerts', l: 'Vibration', t: 'bool', def: true },
  { k: 'notify', s: 'Alerts', l: 'Browser-Benachrichtigungen', t: 'bool', def: true },
  { k: 'alertNewTokens', s: 'Alerts', l: 'Alarm bei neuen Tokens (gefiltert)', t: 'bool', def: false },
  { k: 'alertScore', s: 'Alerts', l: 'Alarm ab Final Score', t: 'int', def: 75, min: 40, max: 100 },
  { k: 'alertX2', s: 'Alerts', l: 'Alarm bei x2 seit Fund', t: 'bool', def: true },
  { k: 'alertCooldownMin', s: 'Alerts', l: 'Alarm-Cooldown je Token & Typ', t: 'int', def: 10, min: 1, max: 1440, u: 'min' },
  // System & Feature Flags
  { k: 'debugMode', s: 'System', l: 'Debug-Modus (verbose Logs, Decision Trace)', t: 'bool', def: false },
  { k: 'rawApiLog', s: 'System', l: 'Rohdaten der letzten API-Antworten speichern', t: 'bool', def: false },
  { k: 'ffCrossCheck', s: 'System', l: 'Feature: GeckoTerminal Cross-Check & Fallback', t: 'bool', def: true },
  { k: 'ffRugcheck', s: 'System', l: 'Feature: RugCheck-Sicherheitsdaten', t: 'bool', def: true },
  { k: 'ffHolderAnalysis', s: 'System', l: 'Feature: Holder-Analyse via RPC', t: 'bool', def: true },
  { k: 'ffShadowMode', s: 'System', l: 'Feature: Shadow Mode (deaktivierte Strategien mitrechnen)', t: 'bool', def: true },
  { k: 'ffAutoTuning', s: 'System', l: 'Feature: Parameter-Versionen überwachen & schlechtere zurückrollen (nur Simulation; neue Parameter nur über die Lern-KI)', t: 'bool', def: false },
  { k: 'minTradesForTuning', s: 'System', l: 'Min. abgeschlossene Trades für Optimierung', t: 'int', def: 20, min: 1, max: 1000 },
  { k: 'autoSafeMode', s: 'System', l: 'Safe Mode automatisch nach 5 Scan-Fehlern (stoppt neue Käufe)', t: 'bool', def: true },
  { k: 'anomalyMode', s: 'System', l: 'Anomalie-Monitor: Reaktion', t: 'select', def: 'warn', opts: [['warn', 'nur warnen (Standard)'], ['act', 'handeln: drosseln, pausieren, bei kritischen Fehlern Not-Stopp']] },
  { k: 'resetBuyCountOnSession', s: 'System', l: 'Buy-Zähler bei neuer Session zurücksetzen (nur ohne offene Position)', t: 'bool', def: true },
  // Lern-KI (Adaptive Loss Intelligence) – verändert nie Risiko-Limits, Security, Emergency Stop oder LIVE-Gating
  { k: 'learnEnabled', s: 'Lern-KI', l: 'Lern-KI aktiv (Verlust-Analyse, Muster, Experimente)', t: 'bool', def: true },
  { k: 'learnAutoPromote', s: 'Lern-KI', l: 'Validierte Verbesserungen automatisch übernehmen (nur SIMULATION, nach Shadow-Phase, mit Auto-Rollback)', t: 'bool', def: true },
  { k: 'learnMinPattern', s: 'Lern-KI', l: 'Min. Trades für ein stabiles Muster', t: 'int', def: 20, min: 10, max: 500 },
  { k: 'learnMinTest', s: 'Lern-KI', l: 'Min. Trades im Test-Fenster (Out-of-Sample)', t: 'int', def: 8, min: 5, max: 200 },
  { k: 'learnShadowTrades', s: 'Lern-KI', l: 'Trades je Shadow- und Überwachungsphase', t: 'int', def: 10, min: 5, max: 200 }
];
const SETTINGS_INDEX = Object.fromEntries(SETTINGS_SCHEMA.map(d => [d.k, d]));
const defaultSettings = () => Object.fromEntries(SETTINGS_SCHEMA.map(d => [d.k, d.def]));

const PROFILES = {
  Konservativ: { minLiq: 30000, minVol1h: 50000, minMcap: 100000, maxMcap: 10000000, minBuyRatio: 0.6, minScore: 75, maxRiskScore: 45, minConfidence: 70, maxPositionPct: 2, maxExposurePct: 15 },
  Ausgewogen: { minLiq: 10000, minVol1h: 20000, minMcap: 50000, maxMcap: 5000000, minBuyRatio: 0.55, minScore: 65, maxRiskScore: 60, minConfidence: 60, maxPositionPct: 5, maxExposurePct: 30 },
  Aggressiv: { minLiq: 5000, minVol1h: 10000, minMcap: 20000, maxMcap: 5000000, minBuyRatio: 0.5, minScore: 60, maxRiskScore: 70, minConfidence: 55, maxPositionPct: 5, maxExposurePct: 40 },
  /* Lernmodus: alle Pausen und Risiko-Limits aus, damit durchgehend gehandelt und gelernt wird. Kauf-Filter bleiben unverändert. */
  'Lernmodus (ohne Limits)': { dailyLossLimitPct: 0, ddStopPct: 0, ddReducePct: 0, lossCooldownMin: 0, globalPauseMin: 0, lossStreakLimit: 0, sellCooldownMin: 0, maxBuysPerCoin: 0, addOnlyInProfit: false, maxTradesPerHour: 0, maxOpenPositions: 0, maxExposurePct: 100, correlationLimit: 0, signalConflictBlock: false, strategyCooldowns: false, lowQualityMarketBlock: false, minPairAgeMin: 0, maxActiveOrders: 20, autoSafeMode: false, anomalyMode: 'warn', maxRoundTripLossPct: 0 }
};

function coerceSetting(d, v) {
  if (d.t === 'bool') return typeof v === 'boolean' ? v : v === 'true' || v === 1 || v === '1' ? true : v === 'false' || v === 0 || v === '0' ? false : undefined;
  if (d.t === 'select') return d.opts.some(o => o[0] === v) ? v : undefined;
  if (d.t === 'text') {
    if (typeof v !== 'string') return undefined;
    if (d.k === 'rpcUrls') {
      const list = v.split(',').map(s => s.trim()).filter(Boolean);
      if (!list.length || list.length > 4 || list.some(u => !safeUrl(u))) return undefined;
      return list.join(', ');
    }
    if (d.k === 'jupApiKey') { const k = v.trim(); return /^[\w.-]{0,200}$/.test(k) ? k : undefined; }
    return v.slice(0, 500);
  }
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  let x = clamp(n, d.min, d.max);
  if (d.t === 'int') x = Math.round(x);
  return x;
}
/* Validierung inkl. logischer Checks. Liefert immer ein vollständiges, gültiges Settings-Objekt. */
function validateSettings(input, base) {
  const out = { ...(base || defaultSettings()) };
  const errors = [];
  if (input && typeof input === 'object') {
    for (const key of Object.keys(input)) {
      const d = SETTINGS_INDEX[key];
      if (!d) continue;
      const raw0 = input[key];
      const v = coerceSetting(d, raw0);
      if (v === undefined) { errors.push({ key, msg: `${d.l}: ungültiger Wert „${String(raw0).slice(0, 40)}“` }); continue; }
      if (d.t !== 'bool' && d.t !== 'select' && d.t !== 'text' && Number(raw0) !== v) errors.push({ key, msg: `${d.l}: auf zulässigen Bereich ${d.min}–${d.max} begrenzt (${v})`, soft: true });
      out[key] = v;
    }
  }
  const revert = (keys, msg) => { keys.forEach(k => { out[k] = (base || defaultSettings())[k]; }); errors.push({ key: keys[0], msg }); };
  if (out.minMcap > out.maxMcap) revert(['minMcap', 'maxMcap'], 'Min. MC (Market Cap) muss ≤ Max. MC (Market Cap) sein');
  if (!(out.tp1Pct < out.tp2Pct && out.tp2Pct < out.tp3Pct)) revert(['tp1Pct', 'tp2Pct', 'tp3Pct'], 'Take Profits müssen aufsteigend sein (TP1 < TP2 < TP3)');
  if (out.tp1Frac + out.tp2Frac > 1) revert(['tp1Frac', 'tp2Frac'], 'TP1- + TP2-Anteil darf 100 % nicht überschreiten');
  if (out.maxPositionPct > out.maxExposurePct) revert(['maxPositionPct'], 'Max. Positionsgröße darf Max. Exposure nicht überschreiten');
  if (out.maxPositionPct > out.maxExposurePct) out.maxPositionPct = out.maxExposurePct; // auch der Rückfallwert darf die Exposure nicht überschreiten
  if (out.ddReducePct > 0 && out.ddStopPct > 0 && !(out.ddReducePct < out.ddStopPct)) revert(['ddReducePct', 'ddStopPct'], 'Drawdown-Modus muss unter der Drawdown-Grenze liegen (oder eines davon 0 = aus)');
  return { settings: out, errors };
}

/* ---- Strategien (Multi-Strategy, separat aktivierbar) ---- */
const STRATEGY_DEFS = [
  { id: 'momentum', name: 'Momentum', desc: 'Kurzfristiges Momentum (5m/1h) mit Käuferdominanz' },
  { id: 'breakout', name: 'Breakout', desc: 'Ausbruch über das lokale Hoch mit Volumenbestätigung' },
  { id: 'volume', name: 'Volume Expansion', desc: 'Volumen-Run-Rate deutlich über Stundenschnitt, Preis bestätigt' },
  { id: 'liquidity', name: 'Liquidity Growth', desc: 'Wachsende Pool-Liquidität bei stabilem Preis' },
  { id: 'pullback', name: 'Pullback', desc: 'Rücksetzer im Aufwärtstrend (EMA/RSI)' },
  { id: 'meanrev', name: 'Mean Reversion', desc: 'Überverkauft unter EMA mit zurückkehrenden Käufern' },
  { id: 'trend', name: 'Trend Following', desc: 'Trendfortsetzung 1h/6h/24h + EMA-Ausrichtung' }
];
function defaultStrategies() {
  const base = { weight: 1, minScore: 65, riskLimit: 60, minLiquidity: 15000, minConfidence: 60, cooldownMin: 15, positionSizePct: 2 };
  return {
    momentum: { ...base, enabled: true },
    breakout: { ...base, enabled: true },
    volume: { ...base, enabled: true, weight: 0.8 },
    liquidity: { ...base, enabled: true, weight: 0.6 },
    pullback: { ...base, enabled: false, weight: 0.8 },
    meanrev: { ...base, enabled: false, weight: 0.6, riskLimit: 50 },
    trend: { ...base, enabled: true }
  };
}
const STRATEGY_FIELDS = { weight: [0, 3], minScore: [0, 100], riskLimit: [0, 100], minLiquidity: [0, 1e9], minConfidence: [0, 100], cooldownMin: [0, 1440], positionSizePct: [0.1, 100] };
function validateStrategies(input, base) {
  const out = deepClone(base || defaultStrategies()); const errors = [];
  if (!input || typeof input !== 'object') return { strategies: out, errors };
  for (const def of STRATEGY_DEFS) {
    const src = input[def.id]; if (!src || typeof src !== 'object') continue;
    if (typeof src.enabled === 'boolean') out[def.id].enabled = src.enabled;
    for (const [f, [lo, hi]] of Object.entries(STRATEGY_FIELDS)) {
      if (!(f in src)) continue;
      const n = Number(src[f]);
      if (!Number.isFinite(n)) { errors.push({ key: def.id + '.' + f, msg: `${def.name}: ${f} ungültig` }); continue; }
      out[def.id][f] = clamp(n, lo, hi);
    }
  }
  return { strategies: out, errors };
}

/* ============================== STORAGE (versioniert + Migration) ============================== */
function createLocalBackend() {
  return {
    get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    remove(k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignorieren */ } }
  };
}
function createMemoryBackend() {
  const m = new Map();
  return { get: k => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, String(v)); return true; }, remove: k => { m.delete(k); }, _map: m };
}
/* Migration der alten v1-Schlüssel (c, w, fd, h) in das v2-Format. */
function migrateV1(backend) {
  const c = parseJSON(backend.get('c')), w = parseJSON(backend.get('w')), fd = parseJSON(backend.get('fd')), h = parseJSON(backend.get('h'));
  if (!c && !w && !fd && !h) return null;
  const settingsIn = {};
  if (c && typeof c === 'object') {
    if (isNum(+c.liq)) settingsIn.minLiq = +c.liq;
    if (isNum(+c.vol)) settingsIn.minVol1h = +c.vol;
    if (isNum(+c.mmin)) settingsIn.minMcap = +c.mmin;
    if (isNum(+c.mmax)) settingsIn.maxMcap = +c.mmax;
    if (isNum(+c.ratio)) settingsIn.minBuyRatio = +c.ratio;
    if (isNum(+c.score)) settingsIn.minScore = +c.score;
    if (c.sound != null) settingsIn.sound = !!+c.sound;
  }
  const watchlist = {};
  for (const a of arr(w)) if (isMint(a)) watchlist[tokenIdOf(a)] = { note: '', priority: 2, alerts: true, priceAbove: null, priceBelow: null, scoreAbove: null, addedAt: Date.now(), symbol: '' };
  const seen = {};
  if (h && typeof h === 'object') for (const [a, v] of Object.entries(h)) if (isMint(a) && v && isNum(v.mc) && isNum(v.t)) seen[tokenIdOf(a)] = { mc: v.mc, t: v.t, sym: '' };
  const feed = arr(fd).filter(f => f && isMint(f.addr)).slice(0, 60).map((f, i) => ({ id: 'v1_' + i, ts: Date.now(), type: 'LEGACY', level: 'INFO', tag: String(f.tag || 'Alarm').slice(0, 40), tokenId: tokenIdOf(f.addr), mint: f.addr, sym: str(f.sym, 24), mc: num(f.mc), detail: 'Übernommen aus Version 1 (Zeit: ' + str(f.t, 8) + ')' }));
  return { v: 2, settingsIn, watchlist, seen, feed, migratedFrom: 1 };
}
function createStorage(backend, log) {
  let lastOk = true, lastSaveAt = 0, lastError = '';
  const lastWritten = {};
  /* Lädt v3 (getrennte Schlüssel), sonst v2 (ein Schlüssel), sonst v1-Migration. */
  function load() {
    const parts = {}, corrupted = [];
    for (const [k, key] of Object.entries(STORAGE_KEYS)) {
      const raw0 = backend.get(key); if (raw0 == null) continue;
      const d = parseJSON(raw0);
      if (!d || typeof d !== 'object' || d.v !== STORAGE_VERSION) { corrupted.push(k); continue; }
      parts[k] = d; lastWritten[k] = raw0;
    }
    if (Object.keys(parts).length || corrupted.length) {
      const coreBad = corrupted.filter(c => !LEARN_STORAGE_KEYS.includes(c)), learnBad = corrupted.filter(c => LEARN_STORAGE_KEYS.includes(c));
      if (coreBad.length) log && log.error('STORAGE', 'Beschädigte Speicherbereiche: ' + coreBad.join(', ') + ' – Abgleich erforderlich');
      if (learnBad.length) log && log.warn('LEARNING', 'Beschädigte Lerndaten (' + learnBad.join(', ') + ') – mit leeren Defaults neu gestartet, Handel unberührt');
      const data = Object.assign({ v: STORAGE_VERSION }, parts.patterns, parts.models, parts.experiments, parts.learning, parts.stats, parts.logs, parts.trades, parts.positions, parts.runtime, parts.settings);
      data.seqs = { runtime: parts.runtime ? parts.runtime.tradeSeq : null, positions: parts.positions ? parts.positions.tradeSeq : null, trades: parts.trades ? parts.trades.tradeSeq : null };
      return { data, corrupted };
    }
    const raw2 = backend.get(STORAGE_KEY_V2);
    if (raw2 != null) {
      const d = parseJSON(raw2);
      if (!d) { log && log.error('STORAGE', 'Gespeicherter v2-Zustand ist beschädigt (JSON) – Start mit sicheren Defaults'); return { data: null, corrupted: ['v2'] }; }
      log && log.info('STORAGE', 'Zustand aus Version 2 übernommen (wird getrennt gespeichert)');
      return { data: d, migrated: 2 };
    }
    const m = migrateV1(backend);
    if (m) { log && log.info('STORAGE', 'Daten aus Version 1 migriert (Einstellungen, Watchlist, Alarme)'); return { data: m, migrated: 1 }; }
    return { data: null };
  }
  /* Schreibt nur geänderte Bereiche. Reihenfolge: Settings → Positionen → Trades → Runtime → Logs → Stats → Lerndaten. */
  function save(sections) {
    let ok = true;
    for (const k of ['settings', 'positions', 'trades', 'runtime', 'logs', 'stats', 'models', 'learning', 'experiments', 'patterns']) {
      if (!sections[k]) continue;
      let str0;
      try { str0 = JSON.stringify({ v: STORAGE_VERSION, ...sections[k] }); } catch (e) { ok = false; lastError = 'Serialisierung fehlgeschlagen (' + k + ')'; continue; }
      if (lastWritten[k] === str0) continue;
      let w = backend.set(STORAGE_KEYS[k], str0);
      if (!w && ['logs', 'stats', 'trades', 'learning', 'experiments', 'patterns'].includes(k)) {
        const L = sections.learning && sections.learning.learn;
        const slim = k === 'logs' ? { ...sections.logs, logs: [], auditLog: arr(sections.logs.auditLog).slice(0, 80), feed: arr(sections.logs.feed).slice(0, 30), configLog: arr(sections.logs.configLog).slice(0, 30) }
          : k === 'stats' ? { ...sections.stats, hist: {} }
            : k === 'learning' ? { learn: { ...L, records: arr(L.records).slice(-100).map(r => ({ ...r, path: { ...r.path, samples: [] }, followUp: r.followUp ? { ...r.followUp, samples: [] } : null })), timeline: arr(L.timeline).slice(0, 50), falseSignals: arr(L.falseSignals).slice(0, 50) } }
              : k === 'experiments' ? { research: { ...sections.experiments.research, experiments: arr(sections.experiments.research.experiments).slice(0, 15) } }
                : k === 'patterns' ? { patterns: Object.fromEntries(Object.entries(sections.patterns.patterns).sort((a, b) => b[1].n - a[1].n).slice(0, 120)) }
                  : { ...sections.trades, journal: arr(sections.trades.journal).slice(0, 150) };
        str0 = JSON.stringify({ v: STORAGE_VERSION, ...slim });
        w = backend.set(STORAGE_KEYS[k], str0);
        if (w) log && log.warn('STORAGE', `Speicher knapp – ${k} rotiert`);
      }
      if (w) lastWritten[k] = str0; else { ok = false; lastError = 'localStorage nicht verfügbar oder voll'; }
    }
    if (ok && backend.get(STORAGE_KEY_V2) != null) backend.remove(STORAGE_KEY_V2);
    lastOk = ok; if (ok) lastSaveAt = Date.now();
    return ok;
  }
  function clear() { for (const key of Object.values(STORAGE_KEYS)) backend.remove(key); backend.remove(STORAGE_KEY_V2); for (const k of Object.keys(lastWritten)) delete lastWritten[k]; }
  return { load, save, status: () => ({ ok: lastOk, lastSaveAt, lastError }), clear, backend };
}

/* ============================== HTTP / DATA LAYER ==============================
   Pro Quelle: Rate Limiter (Sliding Window), Backoff (1s,2s,4s… mit Jitter nur technisch),
   Request-IDs, AbortController + Timeout, Deduplizierung laufender Requests, Cache, Health. */
const SOURCE_STATUS_CONF = { ONLINE: 100, DEGRADED: 60, STALE: 30, OFFLINE: 0, UNKNOWN: 20 };
function httpError(code, message, extra) { const e = new Error(message); e.code = code; Object.assign(e, extra || {}); return e; }
function createHttp(env, log) {
  const sources = {};
  const inflight = new Map();
  const cache = new Map();
  const controllers = new Set();
  let seq = 0;
  const statusListeners = new Set();

  function define(name, cfg) {
    if (sources[name]) { Object.assign(sources[name].cfg, cfg); return sources[name]; }
    sources[name] = {
      name, cfg: { label: name, limitPerMin: 60, timeoutMs: 8000, staleMs: 60000, ...cfg },
      reqTimes: [], results: [], latency: null, lastLatency: null, lastSuccess: 0, lastFailure: 0, lastError: '', lastStatus: null,
      consecutiveFail: 0, backoffUntil: 0, backoffStep: 0, total: 0, errors: 0, rateLimited: 0, schemaErrors: 0,
      remaining: null, resetAt: null, lastRaw: null, prevStatus: 'UNKNOWN'
    };
    return sources[name];
  }
  function remaining(name) {
    const s = sources[name]; if (!s) return 0;
    const t = env.now(); while (s.reqTimes.length && t - s.reqTimes[0] > MIN) s.reqTimes.shift();
    return Math.max(0, s.cfg.limitPerMin - s.reqTimes.length);
  }
  function status(name) {
    const s = sources[name]; if (!s) return 'UNKNOWN';
    if (s.total === 0) return 'UNKNOWN';
    if (!env.online()) return 'OFFLINE';
    if (s.consecutiveFail >= 3) return 'OFFLINE';
    const recent = s.results.slice(-20); const errRate = recent.length ? recent.filter(r => !r.ok).length / recent.length : 0;
    if (s.lastSuccess && env.now() - s.lastSuccess > s.cfg.staleMs) return s.consecutiveFail > 0 ? 'OFFLINE' : 'STALE';
    if (!s.lastSuccess) return s.consecutiveFail > 0 ? 'DEGRADED' : 'UNKNOWN';
    if (s.consecutiveFail > 0 || errRate >= 0.3 || (s.latency || 0) > 3500) return 'DEGRADED';
    return 'ONLINE';
  }
  function checkTransition(s) {
    const st = status(s.name);
    if (st !== s.prevStatus) { const prev = s.prevStatus; s.prevStatus = st; statusListeners.forEach(fn => { try { fn(s.name, prev, st); } catch (e) { /* ignorieren */ } }); }
  }
  function pushResult(s, ok, ms) { s.results.push({ ts: env.now(), ok, ms }); if (s.results.length > 60) s.results.shift(); }
  function onSuccess(s, ms) {
    s.total++; s.consecutiveFail = 0; s.backoffStep = 0; s.backoffUntil = 0; s.lastSuccess = env.now(); s.lastLatency = ms;
    s.latency = s.latency == null ? ms : s.latency * 0.7 + ms * 0.3; pushResult(s, true, ms); checkTransition(s);
  }
  function onFail(s, msg, ms, opts = {}) {
    s.total++; s.errors++; s.consecutiveFail++; s.lastFailure = env.now(); s.lastError = msg; pushResult(s, false, ms || 0);
    s.backoffStep = Math.min(s.backoffStep + 1, 7);
    let wait = Math.min(1000 * Math.pow(2, s.backoffStep - 1), 60000);
    if (opts.retryAfterMs) wait = Math.max(wait, opts.retryAfterMs);
    if (opts.rateLimited) { s.rateLimited++; wait = Math.max(wait, 10000); }
    // Jitter nur zur technischen Streuung von Retries – niemals für Handelsentscheidungen.
    wait = Math.round(wait * (0.9 + env.random() * 0.2));
    s.backoffUntil = env.now() + wait;
    checkTransition(s);
  }
  async function request(name, url, opts = {}) {
    const s = sources[name] || define(name, {});
    const method = opts.method || 'GET';
    const key = method + ' ' + url + (opts.body ? ' ' + opts.body : '');
    if (opts.cacheMs && !opts.noCache) {
      const c = cache.get(key);
      if (c && env.now() - c.ts < opts.cacheMs) return { data: c.data, cached: true, fetchedAt: c.ts, requestId: c.rid, ms: 0 };
    }
    if (inflight.has(key)) return inflight.get(key);
    if (!env.online()) throw httpError('OFFLINE', 'Keine Netzwerkverbindung (Offline)');
    if (env.now() < s.backoffUntil) throw httpError('BACKOFF', `${s.cfg.label}: Backoff aktiv (noch ${Math.ceil((s.backoffUntil - env.now()) / 1000)}s)`);
    if (remaining(name) <= 0) { s.rateLimited++; throw httpError('RATE_LIMIT_LOCAL', `${s.cfg.label}: lokales Rate-Limit erreicht (${s.cfg.limitPerMin}/min)`); }
    s.reqTimes.push(env.now());
    const rid = ++seq; const startedAt = env.now();
    const p = (async () => {
      const ctrl = new AbortController(); controllers.add(ctrl);
      let timedOut = false;
      const timer = env.setTimeout(() => { timedOut = true; ctrl.abort(); }, opts.timeoutMs || s.cfg.timeoutMs);
      const onExtAbort = () => ctrl.abort();
      if (opts.signal) { if (opts.signal.aborted) ctrl.abort(); else opts.signal.addEventListener('abort', onExtAbort, { once: true }); }
      let res;
      try {
        res = await env.fetch(url, { method, headers: opts.headers, body: opts.body, signal: ctrl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      } catch (e) {
        const ms = env.now() - startedAt;
        let err;
        if (timedOut) err = httpError('TIMEOUT', `${s.cfg.label}: Timeout nach ${Math.round((opts.timeoutMs || s.cfg.timeoutMs) / 1000)}s`);
        else if (ctrl.signal.aborted) err = httpError('ABORTED', `${s.cfg.label}: Request abgebrochen`);
        else err = httpError('NETWORK', `${s.cfg.label}: Netzwerk-/CORS-Fehler (${str(e && e.message, 80) || 'fetch failed'})`);
        if (err.code !== 'ABORTED') onFail(s, err.message, ms);
        throw err;
      } finally {
        env.clearTimeout(timer); controllers.delete(ctrl);
        if (opts.signal) opts.signal.removeEventListener('abort', onExtAbort);
      }
      const ms = env.now() - startedAt;
      try {
        const rem = res.headers && res.headers.get ? res.headers.get('x-ratelimit-remaining') : null;
        const reset = res.headers && res.headers.get ? res.headers.get('x-ratelimit-reset') : null;
        if (rem != null && isNum(+rem)) s.remaining = +rem;
        if (reset != null && isNum(+reset)) s.resetAt = +reset > 1e12 ? +reset : +reset > 1e9 ? +reset * 1000 : env.now() + +reset * 1000;
      } catch (e) { /* Header nicht lesbar (CORS) */ }
      s.lastStatus = res.status;
      if (res.status === 429) {
        let ra = null; try { ra = res.headers && res.headers.get ? num(res.headers.get('retry-after')) : null; } catch (e) { /* */ }
        const err = httpError('HTTP_429', `${s.cfg.label}: Rate Limit (HTTP 429)`);
        onFail(s, err.message, ms, { rateLimited: true, retryAfterMs: ra ? ra * 1000 : 0 }); throw err;
      }
      const okStatus = !res.ok && Array.isArray(opts.okStatuses) && opts.okStatuses.includes(res.status); // Fachfehler mit JSON-Antwort (z. B. „keine Route“) – kein Quellenfehler
      if (!res.ok && !okStatus) {
        const err = httpError('HTTP_' + res.status, `${s.cfg.label}: HTTP ${res.status}${res.status >= 500 ? ' (Serverfehler)' : ''}`);
        onFail(s, err.message, ms); throw err;
      }
      let text;
      try { text = await res.text(); } catch (e) { const err = httpError('READ', `${s.cfg.label}: Antwort nicht lesbar`); onFail(s, err.message, ms); throw err; }
      let data;
      try { data = JSON.parse(text); } catch (e) { s.schemaErrors++; const err = httpError('BAD_JSON', `${s.cfg.label}: ungültiges JSON`); onFail(s, err.message, ms); throw err; }
      if (opts.validate) {
        const v = opts.validate(data);
        if (v) { s.schemaErrors++; const err = httpError('SCHEMA', `${s.cfg.label}: ${v}`); onFail(s, err.message, ms); throw err; }
      }
      onSuccess(s, ms);
      if (opts.keepRaw) s.lastRaw = { ts: env.now(), url: opts.maskInLog ? maskUrl(url) : url, sample: text.slice(0, 4000) };
      if (opts.cacheMs) { cache.set(key, { ts: startedAt, data, rid }); if (cache.size > 300) cache.delete(cache.keys().next().value); }
      return { data, cached: false, fetchedAt: startedAt, requestId: rid, ms, status: res.status };
    })();
    inflight.set(key, p);
    p.then(() => inflight.delete(key), () => inflight.delete(key));
    return p;
  }
  function abortAll() { controllers.forEach(c => { try { c.abort(); } catch (e) { /* */ } }); controllers.clear(); }
  function snapshot(name) {
    const s = sources[name]; if (!s) return null;
    const recent = s.results.slice(-30);
    return {
      name, label: s.cfg.label, status: status(name), latency: s.latency, lastLatency: s.lastLatency, lastSuccess: s.lastSuccess, lastFailure: s.lastFailure,
      lastError: s.lastError, errorRate: recent.length ? recent.filter(r => !r.ok).length / recent.length : null, total: s.total, errors: s.errors,
      rateLimited: s.rateLimited, limitPerMin: s.cfg.limitPerMin, used: s.cfg.limitPerMin - remaining(name), backoffUntil: s.backoffUntil,
      resetAt: s.resetAt, remainingHdr: s.remaining, dataAge: s.lastSuccess ? env.now() - s.lastSuccess : null, lastStatus: s.lastStatus,
      confidence: SOURCE_STATUS_CONF[status(name)], lastRaw: s.lastRaw, kind: s.cfg.kind || 'api', schemaErrors: s.schemaErrors
    };
  }
  return {
    define, request, remaining, status, snapshot, abortAll, sources,
    names: () => Object.keys(sources),
    onStatus: fn => { statusListeners.add(fn); return () => statusListeners.delete(fn); },
    tick: () => Object.values(sources).forEach(checkTransition),
    clearCache: () => cache.clear(),
    inflightCount: () => inflight.size,
    _recordSuccess: (name, ms = 100) => onSuccess(sources[name] || define(name, {}), ms)
  };
}

/* ============================== NORMALIZATION LAYER ==============================
   Alle Quellen -> einheitlicher MarketSnapshot. Fehlende Werte = null (nie erfunden). */
/* Datenvalidierung je Quelle: gelieferte, aber ungültige Felder (NaN, Infinity, negativ, 0-Preis, unplausibel groß)
   werden zu null – nie zu 0 – und gezählt. Ganze Datensätze ohne gültige Identität werden verworfen und gezählt. */
const PLAUS_MAX = Object.freeze({ price: 1e7, usd: 1e13, pct: 1e6 });
const newDq = () => ({ records: 0, accepted: 0, rejected: 0, invalidFields: 0, byField: {}, lastIssue: '', lastIssueAt: 0 });
function dqField(dq, name, raw, v, max, at) {
  let out = v;
  if (out != null && isNum(max) && Math.abs(out) > max) out = null;
  if (dq && out == null && raw != null && raw !== '') { dq.invalidFields++; dq.byField[name] = (dq.byField[name] || 0) + 1; dq.lastIssue = `${name} = ${String(raw).slice(0, 24)}`; dq.lastIssueAt = at || 0; }
  return out;
}
const dqReject = (dq, why, at) => { if (dq) { dq.rejected++; dq.lastIssue = why; dq.lastIssueAt = at || 0; } return null; };
function normTxn(t) { return t && typeof t === 'object' ? { b: int(t.buys), s: int(t.sells) } : null; }
function normLinks(list, typeKey) {
  const out = [];
  for (const l of arr(list)) {
    if (!l || typeof l !== 'object') continue;
    const u = safeUrl(l.url); if (!u) continue;
    const type = str(l[typeKey] || l.type || '', 20).toLowerCase() || 'website';
    out.push({ type, label: str(l.label, 30) || type, url: u });
  }
  return out;
}
function normDexPair(p, fetchedAt, dq) {
  if (dq) dq.records++;
  if (!p || typeof p !== 'object') return dqReject(dq, 'Datensatz kein Objekt', fetchedAt);
  if (p.chainId !== 'solana') return dqReject(dq, 'falsche Chain: ' + str(String(p.chainId), 16), fetchedAt);
  const bt = p.baseToken && typeof p.baseToken === 'object' ? p.baseToken : {};
  const mint = bt.address;
  if (!isMint(mint)) return dqReject(dq, 'ungültige Mint-Adresse', fetchedAt);
  const vol = p.volume || {}, ch = p.priceChange || {}, lq = p.liquidity || {}, tx = p.txns || {}, info = p.info || {};
  const F = (name, raw, parse, max) => dqField(dq, name, raw, parse(raw), max, fetchedAt);
  const price = F('priceUsd', p.priceUsd, v => { const n = nonNeg(v); return n && n > 0 ? n : null; }, PLAUS_MAX.price);
  if (dq) dq.accepted++;
  const priceRaw = typeof p.priceUsd === 'string' && /^\d+(\.\d+)?([eE]-?\d+)?$/.test(p.priceUsd) ? p.priceUsd : null;
  return {
    source: 'dexscreener', id: tokenIdOf(mint), mint,
    symbol: str(bt.symbol, 24) || '?', name: str(bt.name, 64),
    pairAddress: isMint(p.pairAddress) ? p.pairAddress : null, dexId: str(p.dexId, 24) || null, url: safeUrl(p.url),
    quoteSymbol: str((p.quoteToken || {}).symbol, 12) || null,
    priceUsd: price && price > 0 ? price : null, priceRaw: price && price > 0 ? priceRaw : null, priceNative: F('priceNative', p.priceNative, nonNeg),
    marketCap: F('marketCap', p.marketCap, nonNeg, PLAUS_MAX.usd), fdv: F('fdv', p.fdv, nonNeg, PLAUS_MAX.usd), liquidityUsd: F('liquidityUsd', lq.usd, nonNeg, PLAUS_MAX.usd),
    vol: { m5: F('vol.m5', vol.m5, nonNeg, PLAUS_MAX.usd), h1: F('vol.h1', vol.h1, nonNeg, PLAUS_MAX.usd), h6: F('vol.h6', vol.h6, nonNeg, PLAUS_MAX.usd), h24: F('vol.h24', vol.h24, nonNeg, PLAUS_MAX.usd) },
    chg: { m5: F('chg.m5', ch.m5, num, PLAUS_MAX.pct), h1: F('chg.h1', ch.h1, num, PLAUS_MAX.pct), h6: F('chg.h6', ch.h6, num, PLAUS_MAX.pct), h24: F('chg.h24', ch.h24, num, PLAUS_MAX.pct) },
    txns: { m5: normTxn(tx.m5), h1: normTxn(tx.h1), h6: normTxn(tx.h6), h24: normTxn(tx.h24) },
    pairCreatedAt: nonNeg(p.pairCreatedAt), boostsActive: int((p.boosts || {}).active) || 0,
    links: [...normLinks(info.websites, 'label').map(l => ({ ...l, type: 'website' })), ...normLinks(info.socials, 'type')],
    fetchedAt
  };
}
function normGtPool(item, fetchedAt, dq) {
  if (dq) dq.records++;
  if (!item || typeof item !== 'object' || !item.attributes) return dqReject(dq, 'Datensatz ohne Attribute', fetchedAt);
  const a = item.attributes, rel = item.relationships || {};
  const baseId = ((rel.base_token || {}).data || {}).id;
  const mint = typeof baseId === 'string' && baseId.startsWith('solana_') ? baseId.slice(7) : null;
  if (!isMint(mint)) return dqReject(dq, 'ungültige Mint-Adresse', fetchedAt);
  if (NON_MEME.has(mint)) return null;
  const name = str(a.name, 80);
  const v = a.volume_usd || {}, c = a.price_change_percentage || {}, tx = a.transactions || {};
  const F = (nm, raw, parse, max) => dqField(dq, nm, raw, parse(raw), max, fetchedAt);
  const price = F('priceUsd', a.base_token_price_usd, x => { const n = nonNeg(x); return n && n > 0 ? n : null; }, PLAUS_MAX.price);
  if (dq) dq.accepted++;
  const created = typeof a.pool_created_at === 'string' ? Date.parse(a.pool_created_at) : NaN;
  return {
    source: 'geckoterminal', id: tokenIdOf(mint), mint, symbol: (name.split('/')[0] || '').trim().slice(0, 24) || '?', name,
    pairAddress: isMint(a.address) ? a.address : null, dexId: str(((rel.dex || {}).data || {}).id, 24) || null, url: null, quoteSymbol: null,
    priceUsd: price && price > 0 ? price : null, priceRaw: null, priceNative: null,
    marketCap: F('marketCap', a.market_cap_usd, nonNeg, PLAUS_MAX.usd), fdv: F('fdv', a.fdv_usd, nonNeg, PLAUS_MAX.usd), liquidityUsd: F('liquidityUsd', a.reserve_in_usd, nonNeg, PLAUS_MAX.usd),
    vol: { m5: F('vol.m5', v.m5, nonNeg, PLAUS_MAX.usd), m15: F('vol.m15', v.m15, nonNeg, PLAUS_MAX.usd), h1: F('vol.h1', v.h1, nonNeg, PLAUS_MAX.usd), h6: F('vol.h6', v.h6, nonNeg, PLAUS_MAX.usd), h24: F('vol.h24', v.h24, nonNeg, PLAUS_MAX.usd) },
    chg: { m5: F('chg.m5', c.m5, num, PLAUS_MAX.pct), m15: F('chg.m15', c.m15, num, PLAUS_MAX.pct), h1: F('chg.h1', c.h1, num, PLAUS_MAX.pct), h6: F('chg.h6', c.h6, num, PLAUS_MAX.pct), h24: F('chg.h24', c.h24, num, PLAUS_MAX.pct) },
    txns: { m5: normTxn(tx.m5), m15: normTxn(tx.m15), h1: normTxn(tx.h1), h24: normTxn(tx.h24) },
    pairCreatedAt: Number.isFinite(created) ? created : null, boostsActive: 0, links: [], fetchedAt
  };
}
function normOhlcv(data, dq) {
  const list = arr(((data || {}).data || {}).attributes ? data.data.attributes.ohlcv_list : null);
  const seen = new Set(); const out = [];
  for (const r of list) {
    if (dq) dq.records++;
    if (!Array.isArray(r) || r.length < 6) { dqReject(dq, 'Kerze unvollständig'); continue; }
    const [t, o, h, l, c, v] = r.map(Number);
    if (![t, o, h, l, c, v].every(Number.isFinite) || o <= 0 || h <= 0 || l <= 0 || c <= 0 || v < 0 || h < l) { dqReject(dq, 'Kerze ungültig (NaN/≤0/High<Low)'); continue; }
    if (dq) dq.accepted++;
    const ts = t < 1e12 ? t * 1000 : t;
    if (seen.has(ts)) continue; seen.add(ts);
    out.push({ t: ts, o, h, l, c, v });
  }
  return out.sort((a, b) => a.t - b.t);
}
function normMintAccount(result) {
  if (!result || typeof result !== 'object' || !('value' in result)) return null;
  const v = result.value;
  if (v === null) return { exists: false };
  const parsed = v && v.data && v.data.parsed;
  if (!parsed || parsed.type !== 'mint' || !parsed.info) return null;
  const i = parsed.info;
  const auth = x => (x === null ? null : typeof x === 'string' && isMint(x) ? x : undefined);
  return {
    exists: true,
    program: v.owner === TOKEN_2022_PROGRAM ? 'token-2022' : v.owner === TOKEN_PROGRAM ? 'spl-token' : 'unbekannt',
    mintAuthority: 'mintAuthority' in i ? auth(i.mintAuthority) : undefined,
    freezeAuthority: 'freezeAuthority' in i ? auth(i.freezeAuthority) : undefined,
    decimals: int(i.decimals),
    supply: typeof i.supply === 'string' && /^\d+$/.test(i.supply) ? i.supply : null,
    extensions: arr(i.extensions).map(e => ({ ext: str(e && e.extension, 40), state: e && e.state && typeof e.state === 'object' ? e.state : null })).filter(e => e.ext)
  };
}
function normLargest(result, supplyStr) {
  const list = arr(result && result.value);
  if (!list.length || typeof supplyStr !== 'string' || !/^\d+$/.test(supplyStr)) return null;
  const supply = BigInt(supplyStr); if (supply <= 0n) return null;
  const amounts = list.map(x => (x && typeof x.amount === 'string' && /^\d+$/.test(x.amount) ? BigInt(x.amount) : null)).filter(x => x != null);
  if (!amounts.length) return null;
  const pct = b => Number((b * 1000000n) / supply) / 10000;
  const top10 = amounts.slice(0, 10).reduce((a, b) => a + b, 0n);
  return { top1Pct: pct(amounts[0]), top10Pct: pct(top10), accounts: list.slice(0, 10).map((x, i) => ({ address: isMint(x.address) ? x.address : null, pct: amounts[i] != null ? pct(amounts[i]) : null })), note: 'inkl. Pool-/LP-Konten' };
}
function normRug(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const risks = arr(d.risks).map(r => ({ name: str(r && r.name, 80), level: str(r && r.level, 12).toLowerCase(), value: str(r && r.value, 40), desc: str(r && r.description, 200), score: num(r && r.score) })).filter(r => r.name);
  const tok = d.token && typeof d.token === 'object' ? d.token : null;
  const auth = (o, k) => (o && k in o ? (o[k] === null ? null : isMint(o[k]) ? o[k] : undefined) : undefined);
  return {
    score: num(d.score), scoreNorm: num(d.score_normalised), risks, lpLockedPct: num(d.lpLockedPct),
    rugged: typeof d.rugged === 'boolean' ? d.rugged : null,
    mintAuthority: tok ? auth(tok, 'mintAuthority') : auth(d, 'mintAuthority'),
    freezeAuthority: tok ? auth(tok, 'freezeAuthority') : auth(d, 'freezeAuthority'),
    topHolders: arr(d.topHolders).slice(0, 10).map(h => ({ address: isMint(h && h.address) ? h.address : null, pct: num(h && h.pct), insider: !!(h && h.insider) })),
    totalHolders: int(d.totalHolders), creator: isMint(d.creator) ? d.creator : null, tokenProgram: str(d.tokenProgram, 60) || null
  };
}
/* Security Engine: kombiniert On-Chain-Mint-Daten (RPC), Holder-Konzentration und RugCheck. Keine Sicherheitsgarantie. */
const CRITICAL_RISK_RX = /freeze authority|mint authority|permanent delegate|transfer fee|honeypot|rugged|non.?transferable/i;
function buildSecurity(mintInfo, holders, rug, now) {
  const flags = []; const f = (code, level, msg) => flags.push({ code, level, msg });
  const src = { rpc: !!(mintInfo && mintInfo.exists), rug: !!rug, holders: !!holders };
  let mintA = 'UNKNOWN', freezeA = 'UNKNOWN';
  const fromVal = v => (v === null ? 'REVOKED' : typeof v === 'string' ? 'ACTIVE' : 'UNKNOWN');
  if (src.rpc) { mintA = fromVal(mintInfo.mintAuthority); freezeA = fromVal(mintInfo.freezeAuthority); }
  if (rug) { if (mintA === 'UNKNOWN') mintA = fromVal(rug.mintAuthority); if (freezeA === 'UNKNOWN') freezeA = fromVal(rug.freezeAuthority); }
  if (mintInfo && mintInfo.exists === false) f('MINT_NOT_FOUND', 'CRITICAL', 'Mint-Account on-chain nicht gefunden');
  if (mintA === 'ACTIVE') f('MINT_AUTHORITY', 'CRITICAL', 'Mint Authority aktiv – Supply kann erhöht werden');
  if (freezeA === 'ACTIVE') f('FREEZE_AUTHORITY', 'CRITICAL', 'Freeze Authority aktiv – Konten können eingefroren werden');
  for (const e of (mintInfo && mintInfo.extensions) || []) {
    const n = e.ext.toLowerCase();
    if (n.includes('permanentdelegate')) f('PERMANENT_DELEGATE', 'CRITICAL', 'Token-2022: Permanent Delegate (Token können entzogen werden)');
    else if (n.includes('nontransferable')) f('NON_TRANSFERABLE', 'CRITICAL', 'Token-2022: nicht übertragbar');
    else if (n.includes('transferhook')) f('TRANSFER_HOOK', 'HIGH', 'Token-2022: Transfer Hook (Verkauf kann eingeschränkt sein)');
    else if (n.includes('transferfee')) f('TRANSFER_FEE', 'HIGH', 'Token-2022: Transfer-Gebühr');
    else if (n.includes('defaultaccountstate')) f('DEFAULT_FROZEN', 'HIGH', 'Token-2022: Default Account State');
  }
  if (rug) {
    if (rug.rugged === true) f('RUGGED', 'CRITICAL', 'RugCheck: als „rugged“ markiert');
    for (const r of rug.risks) {
      if (r.level === 'danger') f('RUG_' + r.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30), CRITICAL_RISK_RX.test(r.name) ? 'CRITICAL' : 'HIGH', 'RugCheck: ' + r.name + (r.value ? ' (' + r.value + ')' : ''));
      else if (r.level === 'warn') f('RUG_WARN', 'WARN', 'RugCheck: ' + r.name + (r.value ? ' (' + r.value + ')' : ''));
    }
    if (isNum(rug.lpLockedPct) && rug.lpLockedPct < 50) f('LP_UNLOCKED', 'WARN', `LP nur ${rug.lpLockedPct.toFixed(0)}% gesperrt/verbrannt`);
  }
  let top10 = holders ? holders.top10Pct : null, top1 = holders ? holders.top1Pct : null, holderSrc = holders ? 'RPC (inkl. Pool-Konten)' : null;
  if (top10 == null && rug && rug.topHolders.length) { const p = rug.topHolders.map(h => h.pct).filter(isNum); if (p.length) { top10 = sum(p.slice(0, 10)); top1 = p[0]; holderSrc = 'RugCheck'; } }
  if (isNum(top10) && top10 > 60) f('HOLDER_CONCENTRATION', 'HIGH', `Top-10-Holder halten ${top10.toFixed(1)}% (${holderSrc})`);
  else if (isNum(top10) && top10 > 40) f('HOLDER_CONCENTRATION', 'WARN', `Top-10-Holder halten ${top10.toFixed(1)}% (${holderSrc})`);
  const critical = flags.some(x => x.level === 'CRITICAL');
  const authoritiesKnown = mintA !== 'UNKNOWN' && freezeA !== 'UNKNOWN';
  let status;
  if (critical) status = 'CRITICAL';
  else if (src.rpc && src.rug && authoritiesKnown) status = 'VERIFIED';
  else if ((src.rpc || src.rug) && authoritiesKnown) status = 'PARTIAL';
  else status = 'UNKNOWN';
  return {
    status, mintAuthority: mintA, freezeAuthority: freezeA, program: mintInfo && mintInfo.program || (rug && rug.tokenProgram) || null,
    decimals: mintInfo && mintInfo.decimals, supply: mintInfo && mintInfo.supply,
    flags, top10Pct: top10, top1Pct: top1, holderSrc, holderAccounts: holders ? holders.accounts : null,
    rugScoreNorm: rug ? rug.scoreNorm : null, rugRisks: rug ? rug.risks : [], lpLockedPct: rug ? rug.lpLockedPct : null,
    totalHolders: rug ? rug.totalHolders : null, creator: rug ? rug.creator : null, sources: src, checkedAt: now
  };
}

/* ============================== BLOCKER SYSTEM ==============================
   Priorität (Safety Priority): EMERGENCY → SYSTEM → DATA → SECURITY → PORTFOLIO → LIMITS → COOLDOWN → EXECUTION → STRATEGY → SIGNAL */
const BLOCKER_DEFS = {
  EMERGENCY_STOP: [0, 'EMERGENCY', 'Emergency Stop aktiv'],
  LIVE_UNAVAILABLE: [1, 'SYSTEM', 'Live-Ausführung nicht verfügbar'],
  MODE_READ_ONLY: [1, 'SYSTEM', 'READ-ONLY-Modus'],
  SAFE_MODE: [1, 'SYSTEM', 'Safe Mode aktiv'],
  AUTO_TRADING_OFF: [1, 'SYSTEM', 'Auto-Trading aus'],
  PAPER_MANUAL: [1, 'SYSTEM', 'PAPER: nur manuelle Trades'],
  BOT_NOT_RUNNING: [1, 'SYSTEM', 'Bot läuft nicht'],
  RECOVERING: [1, 'SYSTEM', 'System im Recovery'],
  SYSTEM_UNHEALTHY: [1, 'SYSTEM', 'System Health zu niedrig'],
  OFFLINE: [1, 'SYSTEM', 'Offline'],
  RECONCILIATION_REQUIRED: [1, 'SYSTEM', 'Abgleich erforderlich (Reconciliation)'],
  SECURITY_SOURCES_DOWN: [1, 'SYSTEM', 'Alle Security-Quellen offline'],
  PRICE_MISSING: [2, 'DATA', 'Preis fehlt'],
  DATA_STALE: [2, 'DATA', 'Daten veraltet'],
  DATA_FALLBACK: [2, 'DATA', 'Nur Fallback-Daten'],
  DATA_CONFLICT: [2, 'DATA', 'Datenkonflikt'],
  CONFIDENCE_LOW: [2, 'DATA', 'Data Confidence zu niedrig'],
  FEE_UNKNOWN: [2, 'DATA', 'Gebühren unbekannt (SOL-Preis fehlt)'],
  SECURITY_CRITICAL: [3, 'SECURITY', 'Kritisches Sicherheitsrisiko'],
  SECURITY_UNKNOWN: [3, 'SECURITY', 'Sicherheitsstatus unbekannt'],
  SECURITY_UNVERIFIED: [3, 'SECURITY', 'Security nicht voll verifiziert'],
  SECURITY_STALE: [3, 'SECURITY', 'Security-Daten veraltet'],
  RISK_TOO_HIGH: [3, 'SECURITY', 'Risiko zu hoch'],
  PUMP_DETECTED: [3, 'SECURITY', 'Pump/Manipulation erkannt'],
  LOW_LIQUIDITY: [3, 'SECURITY', 'Liquidität zu niedrig'],
  THIN_LIQUIDITY: [3, 'SECURITY', 'Liquidität im Verhältnis zur MC zu dünn'],
  LIQUIDITY_SHOCK: [3, 'SECURITY', 'Liquiditätsabfluss'],
  DAILY_LOSS_LIMIT: [4, 'PORTFOLIO', 'Tagesverlust-Limit erreicht'],
  EXPOSURE_LIMIT: [4, 'PORTFOLIO', 'Max. Exposure erreicht'],
  CONCENTRATION: [4, 'PORTFOLIO', 'Konzentrationsrisiko'],
  MAX_POSITIONS: [5, 'LIMITS', 'Max. offene Positionen'],
  BUY_LIMIT_REACHED: [5, 'LIMITS', 'Buy-Limit pro Coin erreicht'],
  NO_AVERAGING_DOWN: [5, 'LIMITS', 'Kein Nachkauf im Verlust'],
  COOLDOWN_ACTIVE: [6, 'COOLDOWN', 'Coin-Cooldown aktiv'],
  LOSS_COOLDOWN: [6, 'COOLDOWN', 'Loss-Cooldown aktiv'],
  GLOBAL_PAUSE: [6, 'COOLDOWN', 'Globale Pause (Verlustserie)'],
  OVERTRADING: [6, 'COOLDOWN', 'Overtrading-Schutz'],
  STRATEGY_COOLDOWN: [6, 'COOLDOWN', 'Strategie-Cooldown'],
  TRADE_LOCKED: [7, 'EXECUTION', 'Token/Order gesperrt (laufende Aktion)'],
  DUPLICATE_ORDER: [7, 'EXECUTION', 'Doppelte Order verhindert'],
  MAX_ACTIVE_ORDERS: [7, 'EXECUTION', 'Max. gleichzeitige Orders'],
  SLIPPAGE_TOO_HIGH: [7, 'EXECUTION', 'Slippage/Price Impact zu hoch'],
  NO_SELL_ROUTE: [3, 'SECURITY', 'Kein Verkaufsweg (Honeypot-Verdacht)'],
  NO_ROUTE: [7, 'EXECUTION', 'Kein Handelsweg (Jupiter)'],
  PRICE_CONFLICT: [2, 'DATA', 'Kursquellen widersprechen sich (Jupiter vs. DexScreener)'],
  ROUND_TRIP_COST: [7, 'EXECUTION', 'Kauf + sofortiger Verkauf zu teuer (Gebühren/Impact/Steuer)'],
  SIZE_ZERO: [7, 'EXECUTION', 'Positionsgröße 0'],
  INSUFFICIENT_CASH: [7, 'EXECUTION', 'Nicht genug (virtuelles) Kapital'],
  MCAP_RANGE: [8, 'STRATEGY', 'MC (Market Cap) außerhalb Bereich'],
  LOW_VOLUME: [8, 'STRATEGY', 'Volumen zu niedrig'],
  BUYER_RATIO: [8, 'STRATEGY', 'Käuferanteil zu niedrig'],
  PAIR_TOO_NEW: [8, 'STRATEGY', 'Pair zu neu / Alter unbekannt'],
  SCORE_TOO_LOW: [8, 'STRATEGY', 'Score zu niedrig'],
  NO_CONSENSUS: [8, 'STRATEGY', 'Kein Strategie-Konsens'],
  LEARNED_RULE: [8, 'STRATEGY', 'Gelernte Regel (validiert, nur verschärfend)'],
  SIGNAL_CONFLICT: [8, 'STRATEGY', 'Widersprüchliche Signale'],
  LOW_QUALITY_MARKET: [2, 'DATA', 'Marktweit schlechte Datenqualität (No-Trade-Zone)'],
  DRAWDOWN_LIMIT: [4, 'PORTFOLIO', 'Drawdown-Grenze erreicht'],
  ANOMALY_PAUSE: [3, 'SYSTEM', 'Anomalie-Monitor: neue Auto-Käufe pausiert'],
  NO_SIGNAL: [9, 'SIGNAL', 'Kein Kaufsignal']
};
function mkBlocker(code, msg, extra) {
  const d = BLOCKER_DEFS[code] || [9, 'OTHER', code];
  return { code, prio: d[0], cat: d[1], msg: msg || d[2], ...(extra || {}) };
}
function sortBlockers(list) {
  const seen = new Set(); const out = [];
  for (const b of [...list].sort((a, b) => a.prio - b.prio)) { if (seen.has(b.code)) continue; seen.add(b.code); out.push(b); }
  return out;
}
