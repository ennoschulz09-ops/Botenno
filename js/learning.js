/* Smart Lab – learning.js
   Lern-KI (reine Funktionen): Features · Records · Ursachen · Muster · Hypothesen · Experimente · Drift · Modell
   Klassisches Skript ohne Build-Schritt: alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in fester
   Reihenfolge geladen (index.html bzw. server/load-core.js): base → engine → learning → core → selftest → ui.
   base, engine, learning, core und selftest laufen auch ohne Browser (Node.js); nur ui.js braucht das DOM. */
'use strict';

/* ============================== ADAPTIVE LOSS INTELLIGENCE (reine Funktionen) ==============================
   Lernschicht: Trade Learning Record → Labels/Loss Attribution → Pattern Miner → Hypothesen → Experimente
   (zeitlich getrennt, Walk-Forward, Sensitivität, Bootstrap) → Champion/Challenger → Shadow → Promotion/Rollback.
   Grundsätze: keine Gewinn-Garantie, kein Look-Ahead (Features nur zum Einstiegszeitpunkt), keine erfundenen Werte
   (fehlend = UNKNOWN / NOT_ENOUGH_DATA). Lernen verschärft höchstens Einstiegsfilter bzw. passt Exits innerhalb
   LEARN_BOUNDS an – Risiko-Limits, Security-Blocker, Emergency Stop und LIVE-Gating bleiben unberührt. */
const LEARN_VERSION = 1;
const FEATURE_VERSION = 1;
const LOSS_FAMILIES = ['SIGNAL_FALSE_POSITIVE', 'REGIME_MISMATCH', 'LIQUIDITY_FAILURE', 'MOMENTUM_EXHAUSTION', 'VOLUME_DECOUPLING', 'SECURITY_RELATED', 'DATA_QUALITY', 'EXECUTION', 'EXIT_TOO_LATE', 'EXIT_TOO_EARLY', 'RISK_OVERSIZING', 'NOISE_OR_RANDOM'];
const LOSS_FAMILY_DE = { SIGNAL_FALSE_POSITIVE: 'Fehlsignal', REGIME_MISMATCH: 'Regime passt nicht', LIQUIDITY_FAILURE: 'Liquiditätsproblem', MOMENTUM_EXHAUSTION: 'Momentum erschöpft', VOLUME_DECOUPLING: 'Volumen ohne Preisbestätigung', SECURITY_RELATED: 'Security', DATA_QUALITY: 'Datenqualität', EXECUTION: 'Ausführungskosten', EXIT_TOO_LATE: 'Exit zu spät', EXIT_TOO_EARLY: 'Exit zu früh', RISK_OVERSIZING: 'Position zu groß', NOISE_OR_RANDOM: 'Zufall / normale Streuung' };
/* Nur diese Parameter sind lernbar – nur innerhalb dieser Grenzen. Risiko-Limits sind bewusst NICHT enthalten. */
const LEARN_BOUNDS = Object.freeze({
  minScore: TUNING_BOUNDS.minScore, stopLossPct: TUNING_BOUNDS.stopLossPct, trailPct: TUNING_BOUNDS.trailPct,
  minConfidence: [50, 90], minLiq: [5000, 250000], minPairAgeMin: [0, 120], regimeScoreBump: [0, 15], volumeConfirmPct: [0, 5]
});
const LEARN_SETTING_KEYS = ['minScore', 'minConfidence', 'minLiq', 'minPairAgeMin', 'stopLossPct', 'trailPct', 'requireVerifiedSecurity'];
/* Tabelle „Aktive Parameter“: entscheidungsrelevante Einstellungen mit Herkunft (wer, wann, warum). */
const PARAM_TABLE_KEYS = ['minScore', 'minConfidence', 'minLiq', 'minPairAgeMin', 'requireVerifiedSecurity', 'maxRiskScore', 'consensusMinWeight', 'stopLossPct', 'trailPct', 'trailActivatePct', 'tp1Pct', 'maxPositionPct', 'maxExposurePct', 'maxOpenPositions', 'maxSlippagePct', 'dailyLossLimitPct', 'ddReducePct', 'ddStopPct', 'lossCooldownMin', 'globalPauseMin', 'lossStreakLimit'];
const PARAM_SOURCE = { USER: 'USER', LEARNING: 'LEARNED', LEARNING_ROLLBACK: 'ROLLBACK', USER_ROLLBACK: 'ROLLBACK', AUTO_ROLLBACK: 'ROLLBACK', AUTO_TUNING: 'AUTO_TUNING', MIGRATION: 'MIGRATION', IMPORT: 'IMPORT', TEST: 'TEST' };
const PARAM_SOURCE_DE = { DEFAULT: 'Standardwert', USER: 'manuell geändert', LEARNED: 'von der Lern-KI übernommen', ROLLBACK: 'Rollback', AUTO_TUNING: 'altes Auto-Tuning (vor 2.7.0, ohne Out-of-Sample-Nachweis)', MIGRATION: 'beim Laden auf harte Grenze angehoben', IMPORT: 'aus Einstellungs-Import', TEST: 'Selbsttest', UNTRACKED: 'geändert vor Beginn des Änderungsprotokolls' };
const LEARN_CAPS = { records: 200, samplesKeep: 120, patterns: 300, obs: 20, falseSignals: 150, lessons: 80, timeline: 200, experiments: 60, hypotheses: 80, queue: 40, reviews: 20, versions: 30, nearMiss: 200, nearMissOpen: 40 };
const emptyRules = () => ({ blocks: [], regimeScoreBump: {}, volumeConfirmPct: 0, blockPostPump: false, blockDisc: [] });

/* ---- Statistik-Helfer (deterministisch) ---- */
const lr2 = v => (isNum(v) ? Math.round(v * 100) / 100 : null);
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function quantile(a, q) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); }
function wilson(k, n, z = 1.64) { if (!n) return null; const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) }; }
function bootstrapCI(vals, key, iters = 300) {
  if (vals.length < 5) return null;
  const rnd = prng(hashStr(String(key) + ':' + vals.length)), means = [];
  for (let b = 0; b < iters; b++) { let s = 0; for (let i = 0; i < vals.length; i++) s += vals[Math.floor(rnd() * vals.length)]; means.push(s / vals.length); }
  return { lo: lr2(quantile(means, 0.05)), hi: lr2(quantile(means, 0.95)) };
}
const evidenceLevel = n => (n >= 60 ? 'HIGH' : n >= 20 ? 'MEDIUM' : 'LOW');
const sigmoid = z => 1 / (1 + Math.exp(-clamp(z, -30, 30)));
const dotv = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const byClose = (a, b) => (a.closedAt - b.closedAt) || (a.tradeId < b.tradeId ? -1 : a.tradeId > b.tradeId ? 1 : 0);

/* ---- Buckets / Regime-Zustände ---- */
const scoreBucket = v => (!isNum(v) ? 'UNKNOWN' : v < 60 ? '<60' : v < 70 ? '60-69' : v < 80 ? '70-79' : '80+');
const confBucket = v => (!isNum(v) ? 'UNKNOWN' : v < 60 ? '<60' : v < 75 ? '60-74' : '75+');
const riskBucket = v => (!isNum(v) ? 'UNKNOWN' : v < 30 ? 'LOW' : v < 55 ? 'MODERATE' : 'HIGH');
const liqBucket = v => (!isNum(v) ? 'UNKNOWN' : v < 20000 ? '<20k' : v < 75000 ? '20-75k' : v < 250000 ? '75-250k' : '250k+');
const volBucket = v => (!isNum(v) ? 'UNKNOWN' : v < 1 ? 'LOW' : v < 3 ? 'MID' : 'HIGH');
function pumpStateOf(f) { if (f.pump) return 'PUMP'; if (isNum(f.chg1h) && f.chg1h >= 50 && isNum(f.chg5m) && f.chg5m < 0) return 'POST_PUMP'; return isNum(f.chg1h) ? 'NORMAL' : 'UNKNOWN'; }
const FEATURE_REQ = ['price', 'liquidity', 'vol1h', 'buyerRatio1h', 'chg5m', 'chg1h', 'volPct', 'rsi', 'top10Pct', 'pairAgeMin', 'finalScore', 'confidence'];
/* Herkunft eines Coins (Discovery-Quelle) als Lernmerkmal (B3). Primär = die Quelle, über die der Coin zuerst gefunden wurde. */
const DISC_DE = { BOOST: 'DexScreener Boost (bezahlt)', TOP_BOOST: 'DexScreener Top-Boost (bezahlt)', PROFILE: 'DexScreener Profil (bezahlt)', NEW_POOL: 'GeckoTerminal neue Pools', TRENDING: 'GeckoTerminal Trending', WATCHLIST: 'Watchlist (manuell)', POSITION: 'aus offener Position', OTHER: 'sonstige', UNKNOWN: 'unbekannt' };
const DISC_PAID = new Set(['BOOST', 'TOP_BOOST', 'PROFILE']);
const DISC_BLOCKABLE = new Set(['BOOST', 'TOP_BOOST', 'PROFILE', 'NEW_POOL', 'TRENDING']); // nur automatische Quellen darf die Lern-KI sperren
function discCodeOf(via) {
  const v = String(via || '');
  if (!v) return 'UNKNOWN';
  if (/Top-Boost/.test(v)) return 'TOP_BOOST';
  if (/Boost/.test(v)) return 'BOOST';
  if (/Profile/.test(v)) return 'PROFILE';
  if (/GeckoTerminal New/.test(v)) return 'NEW_POOL';
  if (/Trending/.test(v)) return 'TRENDING';
  if (/Watchlist/.test(v)) return 'WATCHLIST';
  if (/Position/.test(v)) return 'POSITION';
  return 'OTHER';
}
function discoveryOf(t) {
  const meta = (t && t.meta) || {}, via = arr(meta.via), all = [...new Set(via.map(discCodeOf))];
  return { primary: via.length ? discCodeOf(via[0]) : 'UNKNOWN', all, paid: all.some(c => DISC_PAID.has(c)), boostTotal: isNum(meta.boostTotal) ? meta.boostTotal : null };
}

/* 1) Trade Feature Builder – ausschließlich Werte zum Entscheidungszeitpunkt (kein Look-Ahead). */
function buildEntryFeatures(t, A, D, regimeTags, now) {
  const tx = A.tx || {}, ta = A.ta || null, sec = A.sec || {}, ts = (t && t.sec) || {}, strat = A.strat || { votes: [], weightSum: 0, lead: null }, px = A.core.price, dsc = discoveryOf(t);
  const f = {
    v: FEATURE_VERSION, ts: isNum(A.ts) ? A.ts : now, source: A.core.source || null, label: A.label || null, dataAgeMs: isNum(A.dataAge) ? Math.round(A.dataAge) : null,
    finalScore: A.finalScore, opportunity: A.opportunity, confidence: A.confidence ? A.confidence.total : null, risk: A.risk ? A.risk.total : null, riskLevel: A.risk ? A.risk.level : null,
    price: px, mc: A.core.mc, liquidity: A.liq.usd, liqRatioMc: lr2(A.liq.ratioMc), liqChg5: lr2(A.liq.chg5),
    vol5m: A.vol.m5, vol1h: A.vol.h1, runRate5: lr2(A.vol.runRate5),
    buyerRatio5: lr2(tx.ratio5), buyerRatio1h: lr2(tx.ratio1), txRate1h: isNum(tx.b1) && isNum(tx.s1) ? tx.b1 + tx.s1 : null, avgTrade5: lr2(tx.avgTrade5),
    chg5m: lr2(A.price.chg.m5), chg1h: lr2(A.price.chg.h1), chg24h: lr2(A.price.chg.h24), volPct: lr2(A.price.volPct), momentum: A.price.momentum, trend: A.price.trend || null,
    rsi: ta && isNum(ta.rsi) ? lr2(ta.rsi) : null, emaDist9: ta && isNum(ta.ema9) && isNum(px) && ta.ema9 > 0 ? lr2((px / ta.ema9 - 1) * 100) : null, emaDist21: ta && isNum(ta.ema21) && isNum(px) && ta.ema21 > 0 ? lr2((px / ta.ema21 - 1) * 100) : null, atrPct: ta && isNum(ta.atrPct) ? lr2(ta.atrPct) : null,
    pairAgeMin: isNum(A.core.pairAge) ? Math.round(A.core.pairAge / MIN) : null, ageClass: A.ageClass || null,
    secStatus: sec.status || 'UNKNOWN', secStale: !!sec.stale, secAgeMs: isNum(sec.age) ? Math.round(sec.age) : null, mintAuthority: ts.mintAuthority != null ? String(ts.mintAuthority).slice(0, 16) : null, freezeAuthority: ts.freezeAuthority != null ? String(ts.freezeAuthority).slice(0, 16) : null, top10Pct: isNum(sec.top10Pct) ? lr2(sec.top10Pct) : null,
    conflicts: (A.conflicts || []).length, fallback: !!A.fallback, labels: A.labels ? { ...A.labels } : null,
    pump: !!(A.pump && A.pump.detected), pumpFlags: A.pump ? A.pump.flags.length : 0,
    signals: (A.signals || []).map(s => ({ type: s.type, strength: s.strength })), sigMax: (A.signals || []).length ? Math.max(...A.signals.map(s => s.strength)) : 0,
    lead: strat.lead || null, weightSum: strat.weightSum, votes: (strat.votes || []).filter(v => v.vote === 'BUY').map(v => v.id), stage: D ? D.stageReached : null, blockerCount: D ? D.analysisBlockers.length : null,
    regime: [...(regimeTags || [])],
    disc: dsc.primary, discAll: dsc.all, discPaid: dsc.paid, boostTotal: dsc.boostTotal
  };
  f.pumpState = pumpStateOf(f);
  f.missing = FEATURE_REQ.filter(k => !isNum(f[k]));
  return f;
}
/* Migration: ältere Journal-Einträge ohne Feature-Snapshot → eingeschränkte Features (legacy), Fehlendes bleibt UNKNOWN. */
function featuresFromJournal(j) {
  const d = (j && j.decision) || {}, sn = d.snapshot || {}, chg = sn.chg || {}, vol = sn.vol || {}, tx = (sn.txns || {}).h1 || null;
  const f = {
    v: 0, legacy: true, ts: isNum(d.ts) ? d.ts : j.openedAt, source: sn.source || null, label: null, dataAgeMs: null,
    finalScore: isNum(j.score) ? j.score : null, opportunity: isNum(j.opportunity) ? j.opportunity : null, confidence: isNum(j.confidence) ? j.confidence : null, risk: j.risk && isNum(j.risk.total) ? j.risk.total : null, riskLevel: j.risk ? j.risk.level : null,
    price: isNum(sn.priceUsd) ? sn.priceUsd : null, mc: isNum(sn.marketCap) ? sn.marketCap : isNum(sn.fdv) ? sn.fdv : null, liquidity: isNum(sn.liquidityUsd) ? sn.liquidityUsd : null, liqRatioMc: null, liqChg5: null,
    vol5m: isNum(vol.m5) ? vol.m5 : null, vol1h: isNum(vol.h1) ? vol.h1 : null, runRate5: null,
    buyerRatio5: null, buyerRatio1h: tx && isNum(tx.b) && isNum(tx.s) && tx.b + tx.s > 0 ? lr2(tx.b / (tx.b + tx.s)) : null, txRate1h: tx && isNum(tx.b) && isNum(tx.s) ? tx.b + tx.s : null, avgTrade5: null,
    chg5m: isNum(chg.m5) ? chg.m5 : null, chg1h: isNum(chg.h1) ? chg.h1 : null, chg24h: isNum(chg.h24) ? chg.h24 : null, volPct: null, momentum: null, trend: null, rsi: null, emaDist9: null, emaDist21: null, atrPct: null,
    pairAgeMin: isNum(sn.pairCreatedAt) && isNum(j.openedAt) ? Math.round((j.openedAt - sn.pairCreatedAt) / MIN) : null, ageClass: null,
    secStatus: d.security ? d.security.status : 'UNKNOWN', secStale: false, secAgeMs: null, mintAuthority: null, freezeAuthority: null, top10Pct: d.security && isNum(d.security.top10Pct) ? d.security.top10Pct : null,
    conflicts: 0, fallback: false, labels: d.dataQuality || null, pump: !!(d.pump && d.pump.detected), pumpFlags: d.pump && d.pump.flags ? d.pump.flags.length : 0,
    signals: arr(j.signals).map(s => ({ type: s.type, strength: s.strength })), sigMax: arr(j.signals).length ? Math.max(...arr(j.signals).map(s => s.strength || 0)) : 0,
    lead: j.strategy || null, weightSum: null, votes: [], stage: null, blockerCount: null, regime: [...arr(j.regime)],
    disc: j.discovery || 'UNKNOWN', discAll: j.discovery ? [j.discovery] : [], discPaid: j.discovery ? DISC_PAID.has(j.discovery) : null, boostTotal: null
  };
  f.pumpState = pumpStateOf(f);
  f.missing = FEATURE_REQ.filter(k => !isNum(f[k]));
  return f;
}

/* ---- Preisverlauf einer Position (MAE/MFE in Zeitfenstern, Runup, Drawdown, Liquiditätsabfluss) ---- */
function newPath() { return { mae: { m1: 0, m2: 0, m5: 0, m15: 0 }, mfe: { m1: 0, m2: 0, m5: 0, m15: 0 }, maxRun: 0, maxDD: 0, tMaxLoss: null, tMaxProfit: null, minLiqPct: 0, samples: [], lastT: -1e12, n: 0 }; }
function updatePath(p, tRelMs, pnlPct, liqPct) {
  if (!p || !isNum(pnlPct) || !isNum(tRelMs) || tRelMs < 0) return;
  p.n++;
  for (const [k, lim] of [['m1', MIN], ['m2', 2 * MIN], ['m5', 5 * MIN], ['m15', 15 * MIN]]) if (tRelMs <= lim) { p.mae[k] = Math.min(p.mae[k], pnlPct); p.mfe[k] = Math.max(p.mfe[k], pnlPct); }
  if (pnlPct > p.maxRun) { p.maxRun = pnlPct; p.tMaxProfit = tRelMs; }
  if (pnlPct < p.maxDD) { p.maxDD = pnlPct; p.tMaxLoss = tRelMs; }
  if (isNum(liqPct)) p.minLiqPct = Math.min(p.minLiqPct, liqPct);
  if (tRelMs - p.lastT >= Math.max(5 * SEC, tRelMs / 40)) {
    p.samples.push([Math.round(tRelMs / 1000), lr2(pnlPct)]); p.lastT = tRelMs;
    if (p.samples.length > 50) p.samples = p.samples.filter((_, i, a) => i % 2 === 0 || i === a.length - 1);
  }
}

/* Datenqualität eines Learning Records (ab 2.12.0). Verzerrte Trades bleiben gespeichert und exportierbar (Rohdaten für
   spätere Modelle), zählen aber nicht für Muster, Lektionen, Hypothesen, Experimente, Kalibrierung, Drift und Verlustmodell –
   sonst lernt die KI aus Messfehlern statt aus dem Einstiegssignal. */
const LEARN_MAX_BUYS = 3;       // mehr Käufe in eine Position: das Ergebnis spiegelt das Nachkaufen, nicht das Einstiegssignal
const PRICE_CONFLICT_PCT = 25;  // Füllkurs so weit neben dem Referenzkurs: Kursquellen widersprechen sich (Rug oder veralteter Kurs)
const RECORD_FLAGS_DE = { PYRAMIDED: `mehr als ${LEARN_MAX_BUYS} Käufe in eine Position`, PRICE_CONFLICT: `Füllkurs mehr als ${PRICE_CONFLICT_PCT} % neben dem Marktkurs`, ESTIMATED_RUG_EXIT: 'Verkauf bei Liquiditätsabzug nur geschätzt (Scheinergebnis)' };
function recordQuality(rec) {
  const x = (rec && rec.execution) || {}, flags = [];
  if (isNum(x.buys) && x.buys > LEARN_MAX_BUYS) flags.push('PYRAMIDED');
  if (isNum(x.maxDevPct) && Math.abs(x.maxDevPct) > PRICE_CONFLICT_PCT) flags.push('PRICE_CONFLICT');
  const liqDrop = (rec.exit && rec.exit.reason === 'LIQUIDITY_COLLAPSE') || (rec.path && isNum(rec.path.minLiqPct) && rec.path.minLiqPct <= -40);
  if (liqDrop && x.exitSource !== 'JUPITER' && x.exitSource !== 'WRITE_OFF') flags.push('ESTIMATED_RUG_EXIT');
  return { v: 1, ok: !flags.length, flags };
}
const learnable = r => !(r && r.quality && r.quality.ok === false);
/* Slippage in USD gegenüber dem Referenzkurs beim Entscheid: Kauf (Füllkurs ÷ Referenz − 1) × Einsatz, Verkauf (Referenz −
   Füllkurs) × Menge. Begrenzt auf den Einsatz (die alte Kauf-Formel lief bei Rug-Kursen ins Unendliche). Abschreibungen ohne
   Verkaufsweg sind keine Slippage. */
function slippageOf(entries, exits) {
  let s = 0;
  for (const e of arr(entries)) if (isNum(e.price) && isNum(e.refPrice) && e.refPrice > 0 && isNum(e.usd)) s += (e.usd - (e.fees || 0)) * (e.price / e.refPrice - 1);
  for (const x of arr(exits)) if (x.reason !== 'NO_SELL_ROUTE' && isNum(x.price) && isNum(x.refPrice) && isNum(x.qty)) s += x.qty * (x.refPrice - x.price);
  return m6(s);
}

/* 2) Trade Learning Record – beim Schließen eingefroren. Nachträglich nur Follow-up + Revisionen (protokolliert). */
function buildLearningRecord(pos, j, o) {
  const f = o.features || null, p = o.path || newPath(), res = (j && j.result) || {};
  const first = pos.entries[0] || null, last = pos.exits.length ? pos.exits[pos.exits.length - 1] : null;
  const pnlPct = isNum(res.pnlPct) ? res.pnlPct : pos.investedUsd > 0 ? pos.realizedUsd / pos.investedUsd * 100 : null;
  const marketPnl = last && isNum(last.refPrice) && isNum(pos.entryPrice) && pos.entryPrice > 0 ? (last.refPrice / pos.entryPrice - 1) * 100 : null;
  const devs = arr(pos.entries).map(e => (isNum(e.price) && isNum(e.refPrice) && e.refPrice > 0 ? (e.price / e.refPrice - 1) * 100 : null)).filter(isNum);
  return {
    v: LEARN_VERSION, tradeId: pos.id, tokenId: pos.tokenId, symbol: pos.symbol, openedAt: pos.openedAt, closedAt: pos.closedAt, mode: pos.mode,
    strategy: pos.strategy || (j && j.strategy) || null, paramVersion: pos.paramVersion, modelVersion: pos.learnVersion || null,
    regimeTags: f ? [...(f.regime || [])] : [...arr(j && j.regime)], legacy: !!(f && f.legacy),
    entry: f,
    execution: {
      entryLatencyMs: lr2(avg(pos.entries.map(e => e.latencyMs).filter(isNum))), exitLatencyMs: isNum(o.exitLatencyMs) ? o.exitLatencyMs : null,
      feesUsd: lr2(pos.feesUsd), slippageUsd: lr2(pos.slippageUsd), estimatedImpactPct: first && isNum(first.impactPct) ? lr2(first.impactPct) : null, exitImpactPct: last && isNum(last.impactPct) ? lr2(last.impactPct) : null,
      dataAgeMs: f ? f.dataAgeMs : null, sizeUsd: lr2(pos.investedUsd), sizePct: isNum(o.equity) && o.equity > 0 ? lr2(pos.investedUsd / o.equity * 100) : null, buys: pos.entries.length,
      // ab 2.12.0: Ausführungsmodell (1 = geschätzt/sofort, 2 = echtes Angebot + Wartezeit), Quelle des letzten Verkaufs, größte Kursabweichung beim Kauf
      execModel: arr(pos.entries).some(e => e.source) ? 2 : 1, exitSource: last ? last.source || null : null, maxDevPct: devs.length ? lr2(devs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a))) : null
    },
    path: {
      mae1m: lr2(p.mae.m1), mae2m: lr2(isNum(o.mae2m) ? Math.min(p.mae.m2, o.mae2m) : p.mae.m2), mae5m: lr2(p.mae.m5), mae15m: lr2(p.mae.m15),
      mfe1m: lr2(p.mfe.m1), mfe2m: lr2(p.mfe.m2), mfe5m: lr2(p.mfe.m5), mfe15m: lr2(p.mfe.m15),
      maxRunupPct: lr2(p.maxRun), maxDrawdownPct: lr2(p.maxDD), timeToMaxLossMs: p.tMaxLoss, timeToMaxProfitMs: p.tMaxProfit,
      givebackPct: isNum(pnlPct) ? lr2(Math.max(0, p.maxRun - pnlPct)) : null, minLiqPct: lr2(p.minLiqPct), samples: p.samples.slice(), n: p.n
    },
    exit: { reason: pos.exitReason || (j && j.exitReason) || null, price: last ? last.refPrice : null, marketPnlPct: lr2(marketPnl), holdMs: pos.closedAt - pos.openedAt, exits: pos.exits.length },
    plan: { stopPct: isNum(pos.plannedStopPct) ? lr2(pos.plannedStopPct) : null },
    outcome: { pnlUsd: lr2(isNum(res.pnlUsd) ? res.pnlUsd : pos.realizedUsd), pnlPct: lr2(pnlPct), win: isNum(res.pnlUsd) ? res.pnlUsd > 0 : pos.realizedUsd > 0 },
    labels: null, followUp: null, cf: null, revisions: []
  };
}

/* 3) Loss Attribution – Ursachenfamilien mit Evidence 0–100; ohne Evidenz → NOISE_OR_RANDOM bzw. UNKNOWN. */
function attributeLoss(rec, ctx) {
  const f = rec.entry || {}, x = rec.execution || {}, p = rec.path || {}, o = rec.outcome || {}, fu = rec.followUp, S = ctx.S || {};
  const ev = {}, why = {};
  const set = (k, score, text) => { const s = Math.round(clamp(score, 0, 100)); if (s > (ev[k] || 0)) { ev[k] = s; why[k] = text; } };
  const labs = Object.values(f.labels || {}).filter(l => ['STALE', 'FALLBACK', 'UNKNOWN'].includes(l)).length;
  if (f.conflicts > 0) set('DATA_QUALITY', 55 + 15 * Math.min(2, f.conflicts), `${f.conflicts} Datenkonflikt(e) beim Einstieg`);
  if (f.fallback) set('DATA_QUALITY', 65, 'Einstieg nur mit Fallback-Daten');
  if (labs >= 2) set('DATA_QUALITY', 45 + 10 * labs, `${labs} Datenlabels STALE/FALLBACK/UNKNOWN beim Einstieg`);
  if (isNum(f.dataAgeMs) && isNum(S.staleAfterSec) && f.dataAgeMs > S.staleAfterSec * SEC * 0.6) set('DATA_QUALITY', 45, `Datenalter ${fmtAge(f.dataAgeMs)} beim Einstieg`);
  if (f.secStatus && f.secStatus !== 'VERIFIED') set('SECURITY_RELATED', f.secStatus === 'CRITICAL' ? 95 : f.secStatus === 'PARTIAL' ? 45 : 60, `Security beim Einstieg: ${f.secStatus}`);
  if (f.secStale) set('SECURITY_RELATED', 55, 'Security-Daten beim Einstieg veraltet');
  if (rec.exit && rec.exit.reason === 'RISK_INCREASE') set('SECURITY_RELATED', 70, 'Exit wegen gestiegenem Risiko / Security');
  if (rec.exit && rec.exit.reason === 'NO_SELL_ROUTE') set('SECURITY_RELATED', 95, 'Kein Verkaufsweg mehr (Honeypot oder Liquidität entzogen) – Totalverlust');
  const cost = (x.feesUsd || 0) + (x.slippageUsd || 0);
  if (isNum(o.pnlUsd) && o.pnlUsd < 0 && cost > 0) { const share = cost / Math.abs(o.pnlUsd); if (share >= 0.3) set('EXECUTION', 40 + Math.min(55, share * 60), `Fees + Slippage (${fmtUsd(cost, 3)}) = ${(share * 100).toFixed(0)} % des Verlusts`); }
  if (isNum(x.estimatedImpactPct) && isNum(S.maxSlippagePct) && x.estimatedImpactPct > S.maxSlippagePct * 0.7) set('EXECUTION', 60, `Price Impact ${x.estimatedImpactPct.toFixed(2)} % nahe am Limit`);
  if (isNum(x.entryLatencyMs) && x.entryLatencyMs > 8000) set('EXECUTION', 45, `Ausführungslatenz ${Math.round(x.entryLatencyMs)} ms`);
  if (rec.exit && rec.exit.reason === 'LIQUIDITY_COLLAPSE') set('LIQUIDITY_FAILURE', 90, 'Exit wegen Liquiditätsabfluss');
  if (isNum(p.minLiqPct) && p.minLiqPct <= -25) set('LIQUIDITY_FAILURE', 55 + Math.min(40, -p.minLiqPct - 25), `Liquidität fiel während des Trades um ${(-p.minLiqPct).toFixed(0)} %`);
  if (isNum(x.exitImpactPct) && x.exitImpactPct > 3) set('LIQUIDITY_FAILURE', 50, `Exit-Impact ${x.exitImpactPct.toFixed(2)} %`);
  if (isNum(p.maxRunupPct) && p.maxRunupPct >= Math.max(8, (S.tp1Pct || 30) * 0.4) && isNum(o.pnlPct) && p.maxRunupPct - o.pnlPct >= 12) set('EXIT_TOO_LATE', 50 + Math.min(45, p.maxRunupPct - o.pnlPct), `Zwischengewinn +${p.maxRunupPct.toFixed(1)} % wieder abgegeben`);
  const stopExit = /STOP|BREAK_EVEN|TIME_EXIT|MOMENTUM_REVERSAL/.test((rec.exit && rec.exit.reason) || '');
  if (stopExit && fu && isNum(fu.maxAfterPct)) { const thr = Math.max(8, (S.stopLossPct || 15) * 0.6); if (fu.maxAfterPct >= thr) set('EXIT_TOO_EARLY', 50 + Math.min(45, fu.maxAfterPct - thr), `Nach dem Exit stieg der Coin-Preis noch um ${fu.maxAfterPct.toFixed(1)} % (15 min)`); }
  if (f.sigMax >= 70 && isNum(p.mae2m) && p.mae2m <= -5 && (!isNum(p.mfe2m) || p.mfe2m < 3)) set('SIGNAL_FALSE_POSITIVE', 55 + Math.min(40, -p.mae2m * 3), `Starkes Signal (${f.sigMax}), aber ${p.mae2m.toFixed(1)} % in den ersten 2 min`);
  if (((isNum(f.chg1h) && f.chg1h >= 60) || (isNum(f.chg5m) && f.chg5m >= 20) || f.pump || f.pumpState === 'POST_PUMP') && isNum(p.mae5m) && p.mae5m <= -5) set('MOMENTUM_EXHAUSTION', 55 + (f.pump ? 20 : 0) + Math.min(20, Math.max(0, f.chg1h || 0) / 10), `Starker Anstieg vor Einstieg (1h ${fmtPct(f.chg1h)}), danach Umkehr`);
  if ((f.signals || []).some(s => s.type === 'VOLUME_EXPANSION') && isNum(f.chg5m) && f.chg5m < 2) set('VOLUME_DECOUPLING', 60, `Volume Expansion bei nur ${fmtPct(f.chg5m)} Preisbewegung (5m)`);
  else if (isNum(f.runRate5) && f.runRate5 >= 2 && isNum(f.chg5m) && f.chg5m <= 0) set('VOLUME_DECOUPLING', 55, `Volumen ${f.runRate5.toFixed(1)}× bei fallendem Preis`);
  if (ctx.cohort) { const c = ctx.cohort(rec); if (c && c.n >= 5 && isNum(c.expOther) && c.exp < 0 && c.exp < c.expOther) set('REGIME_MISMATCH', 45 + Math.min(45, c.n * 3), `${rec.strategy || 'manuell'} im Regime ${c.tag}: Ø ${fmtPct(c.exp)} (n=${c.n}) vs. sonst ${fmtPct(c.expOther)}`); }
  if (isNum(x.sizePct) && isNum(S.maxPositionPct) && x.sizePct >= S.maxPositionPct * 0.9 && isNum(o.pnlUsd) && isNum(ctx.medianLossUsd) && ctx.medianLossUsd < 0 && o.pnlUsd < ctx.medianLossUsd * 1.5) set('RISK_OVERSIZING', 55, `Größe ${x.sizePct.toFixed(1)} % des Portfolios, Verlust über 1,5× Median`);
  const req = [isNum(f.finalScore), isNum(f.liquidity), isNum(f.chg5m), isNum(f.volPct), p.n > 3, isNum(p.mae2m), !!(rec.exit && rec.exit.reason), !!(fu && isNum(fu.maxAfterPct))];
  const dataCompleteness = Math.round(req.filter(Boolean).length / req.length * 100);
  const ranked = Object.entries(ev).filter(([, s]) => s >= 50).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const unknown = !ranked.length && dataCompleteness < 50;
  if (!ranked.length) { ev.NOISE_OR_RANDOM = unknown ? 30 : 60; why.NOISE_OR_RANDOM = unknown ? 'Zu wenig Daten für eine Ursachenzuordnung (UNKNOWN)' : 'Kein Muster mit ausreichender Evidenz – Verlust im Rahmen normaler Streuung'; }
  return { primaryCause: ranked.length ? ranked[0][0] : unknown ? 'UNKNOWN' : 'NOISE_OR_RANDOM', secondaryCauses: ranked.slice(1, 4).map(r => r[0]), evidence: ev, why, dataCompleteness, unknown };
}
function labelTrade(rec, ctx) {
  const o = rec.outcome || {}, p = rec.path || {}, f = rec.entry || {}, x = rec.execution || {};
  const att = o.win ? null : attributeLoss(rec, ctx);
  const badLab = Object.values(f.labels || {}).some(l => ['STALE', 'FALLBACK', 'UNKNOWN'].includes(l));
  const dataQuality = !rec.entry ? 'UNKNOWN' : f.conflicts > 0 || f.fallback ? 'BAD' : badLab || f.secStale ? 'DEGRADED' : f.labels ? 'GOOD' : 'UNKNOWN';
  const signalQuality = !isNum(p.mae2m) || !(p.n > 0 || rec.legacy) ? 'UNKNOWN' : p.mae2m <= -5 && (!isNum(p.mfe2m) || p.mfe2m < 3) ? 'FALSE_POSITIVE' : isNum(p.maxRunupPct) && p.maxRunupPct >= 5 ? 'GOOD' : 'WEAK';
  const tooLate = isNum(p.maxRunupPct) && isNum(o.pnlPct) && p.maxRunupPct >= 8 && p.maxRunupPct - o.pnlPct >= 12;
  const exitQuality = att && (att.evidence.EXIT_TOO_EARLY || 0) >= 50 ? 'TOO_EARLY' : tooLate ? 'TOO_LATE' : rec.followUp || p.n > 3 ? 'OK' : 'UNKNOWN';
  const costPct = isNum(x.sizeUsd) && x.sizeUsd > 0 ? ((x.feesUsd || 0) + (x.slippageUsd || 0)) / x.sizeUsd * 100 : null;
  const executionQuality = costPct == null ? 'UNKNOWN' : costPct >= 3 ? 'COSTLY' : 'OK';
  const coh = ctx.cohort ? ctx.cohort(rec) : null;
  const regimeFit = att && (att.evidence.REGIME_MISMATCH || 0) >= 50 ? 'MISFIT' : coh && coh.n >= 5 ? 'FIT' : 'UNKNOWN';
  const primary = att ? att.primaryCause : null;
  const avoidable = !att ? 'NO' : att.unknown ? 'UNKNOWN' : primary === 'NOISE_OR_RANDOM' ? 'NO' : (att.evidence[primary] || 0) >= 65 ? 'LIKELY' : 'POSSIBLE';
  const labels = { lossFamily: primary, secondary: att ? att.secondaryCauses : [], evidence: att ? att.evidence : {}, why: att ? att.why : {}, dataCompleteness: att ? att.dataCompleteness : null, avoidable, dataQuality, signalQuality, executionQuality, exitQuality, regimeFit };
  return withErrorClass(labels, rec, ctx.S);
}
function withErrorClass(labels, rec, S) {
  const ec = errorClassify({ ...rec, labels }, S || {});
  return Object.assign(labels, { errorClass: ec ? ec.cls : null, errorWhy: ec ? ec.why : null, lossVerdict: ec ? ec.verdict : null, expectedLoss: ec ? ec.expected : null });
}

/* 4) Counterfactual Engine – historische Simulationen aus dem gespeicherten Preispfad (Näherung). */
function pathValueAt(s, tSec) {
  if (!s.length) return null; if (tSec <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) if (s[i][0] >= tSec) { const [t0, v0] = s[i - 1], [t1, v1] = s[i]; return t1 === t0 ? v1 : v0 + (v1 - v0) * (tSec - t0) / (t1 - t0); }
  return null;
}
function fullPath(rec) {
  const s = ((rec.path && rec.path.samples) || []).slice(), fu = rec.followUp, ex = rec.exit || {};
  if (fu && arr(fu.samples).length && isNum(ex.marketPnlPct) && isNum(ex.holdMs)) { const h = Math.round(ex.holdMs / 1000); for (const [t, v] of fu.samples) s.push([h + t, lr2(((1 + ex.marketPnlPct / 100) * (1 + v / 100) - 1) * 100)]); }
  return s;
}
function simulateExit(s, c) {
  let high = 0, trail = false;
  for (const [tSec, v] of s) {
    if (v <= -c.stopPct) return { pnlPct: v, reason: 'STOP', tSec };
    if (trail && v <= ((1 + high / 100) * (1 - c.trailPct / 100) - 1) * 100) return { pnlPct: v, reason: 'TRAIL', tSec };
    if (v >= c.tp3Pct) return { pnlPct: c.tp3Pct, reason: 'TP3', tSec };
    if (v > high) high = v;
    if (high >= c.trailActPct) trail = true;
  }
  const last = s[s.length - 1];
  return last ? { pnlPct: last[1], reason: 'END_OF_DATA', tSec: last[0], open: true } : null;
}
const CF_NOTE = 'Historische Simulation (Näherung aus gespeichertem Preispfad, ohne Teilverkäufe) – keine Aussage, was sicher passiert wäre';
function counterfactuals(rec, S) {
  const s = fullPath(rec), o = rec.outcome || {}, f = rec.entry || {}, hold = (rec.exit.holdMs || 0) / 1000, ex = rec.exit.marketPnlPct, out = [];
  const add = (scenario, result, note) => out.push({ scenario, result: isNum(result) ? lr2(result) : null, note: note || CF_NOTE });
  for (const m of [1, 2, 5]) {
    const v = s.length ? pathValueAt(s, m * 60) : null;
    if (hold <= m * 60 || !isNum(ex) || !isNum(v)) add(`Einstieg ${m} min später`, null, !s.length ? 'Kein Preispfad gespeichert – NOT_ENOUGH_DATA' : 'nicht anwendbar (Trade kürzer als Verzögerung)');
    else add(`Einstieg ${m} min später`, ((1 + ex / 100) / (1 + v / 100) - 1) * 100);
  }
  for (const d of [5, 10]) add(`Einstieg erst ab Score ${S.minScore + d}`, isNum(f.finalScore) ? (f.finalScore >= S.minScore + d ? o.pnlPct : 0) : null, !isNum(f.finalScore) ? 'Score unbekannt' : f.finalScore >= S.minScore + d ? 'Trade wäre trotzdem eröffnet worden' : 'Trade wäre nicht eröffnet worden (Ergebnis 0)');
  const base = { stopPct: S.stopLossPct, trailActPct: S.trailActivatePct, trailPct: S.trailPct, tp3Pct: S.tp3Pct };
  for (const [label, c] of [[`Stop −${Math.max(2, S.stopLossPct - 5)} % (enger)`, { stopPct: Math.max(2, S.stopLossPct - 5) }], [`Stop −${S.stopLossPct + 5} % (weiter)`, { stopPct: S.stopLossPct + 5 }], [`Trailing ${Math.max(2, S.trailPct - 5)} % (enger)`, { trailPct: Math.max(2, S.trailPct - 5) }]]) {
    const r = s.length >= 3 ? simulateExit(s, { ...base, ...c }) : null;
    add(label, r ? r.pnlPct : null, !r ? 'Kein ausreichender Preispfad – NOT_ENOUGH_DATA' : r.open ? CF_NOTE + ' · am Datenende noch offen' : CF_NOTE);
  }
  for (const tag of arr(rec.regimeTags).filter(x => ['RISK_OFF', 'HIGH_VOLATILITY', 'CHOPPY', 'BEARISH', 'LIQUIDITY_CONTRACTION'].includes(x))) add(`Regime ${tag} generell blockiert`, 0, 'Trade wäre nicht eröffnet worden (Ergebnis 0)');
  if (isNum(f.liquidity) && isNum(S.minLiq)) add('Nur bei doppelter Mindest-Liquidität', f.liquidity >= S.minLiq * 2 ? o.pnlPct : 0, f.liquidity >= S.minLiq * 2 ? 'Trade wäre trotzdem eröffnet worden' : 'Trade wäre nicht eröffnet worden (Ergebnis 0)');
  if (f.lead && arr(f.votes).length) add(`Nur Strategie ${f.lead} statt Konsens`, arr(f.votes).length > 1 ? o.pnlPct : o.pnlPct, arr(f.votes).length > 1 ? `Lead-Strategie stimmte ebenfalls für BUY (${f.votes.length} Stimmen) – gleicher Einstieg` : 'Nur eine Strategie beteiligt – identisch');
  return out;
}

/* Speichersparend: der Standard-Hinweis wird nicht je Szenario gespeichert (Anzeige ergänzt ihn). */
const compactCf = list => list.map(c => (c.note === CF_NOTE ? { scenario: c.scenario, result: c.result } : c));

/* 5) False-Signal-Datenbank 2.0 */
function falseSignalRecord(rec) {
  const f = rec.entry || {}, p = rec.path || {};
  const strong = arr(f.signals).filter(s => s.strength >= 70);
  if (!strong.length || !isNum(p.mae2m) || p.mae2m > -5) return null;
  const recovered = isNum(p.maxRunupPct) && p.maxRunupPct >= 5 && isNum(p.timeToMaxProfitMs) && p.timeToMaxProfitMs > 2 * MIN;
  return {
    tradeId: rec.tradeId, ts: rec.closedAt, symbol: rec.symbol, signals: strong.map(s => s.type), strengths: strong.map(s => s.strength), entryScore: f.finalScore, regime: arr(rec.regimeTags),
    liquidity: f.liquidity, volatility: f.volPct, buyerRatio: f.buyerRatio1h, securityStatus: f.secStatus, mae1m: p.mae1m, mae2m: p.mae2m, mae5m: p.mae5m, reversalMagnitude: p.mae2m,
    recoveredLater: recovered, classification: recovered ? 'EARLY_SHAKEOUT' : rec.outcome.win ? 'FALSE_START' : 'FALSE_SIGNAL', evidence: { combo: strong.map(s => s.type).sort().join('+'), pnlPct: rec.outcome.pnlPct, legacy: !!rec.legacy }
  };
}

/* 6) Pattern Miner – inkrementelle Aggregate je Merkmalskombination; nur Einstiegs-Merkmale dürfen Hypothesen erzeugen. */
const PATTERN_DIMS = {
  strategy: { entry: true, f: r => [r.strategy || 'manuell'] },
  regime: { entry: true, f: r => { const t = arr(r.regimeTags).filter(x => x !== 'UNKNOWN'); return t.length ? t : ['UNKNOWN']; } },
  score: { entry: true, f: r => [scoreBucket(r.entry && r.entry.finalScore)] },
  conf: { entry: true, f: r => [confBucket(r.entry && r.entry.confidence)] },
  risk: { entry: true, f: r => [riskBucket(r.entry && r.entry.risk)] },
  liq: { entry: true, f: r => [liqBucket(r.entry && r.entry.liquidity)] },
  age: { entry: true, f: r => [(r.entry && r.entry.ageClass) || 'UNKNOWN'] },
  vol: { entry: true, f: r => [volBucket(r.entry && r.entry.volPct)] },
  signals: { entry: true, f: r => [arr(r.entry && r.entry.signals).filter(s => s.strength >= 50).map(s => s.type).sort().slice(0, 2).join('+') || 'NONE'] },
  sec: { entry: true, f: r => [(r.entry && r.entry.secStatus) || 'UNKNOWN'] },
  pump: { entry: true, f: r => [(r.entry && r.entry.pumpState) || 'UNKNOWN'] },
  disc: { entry: true, f: r => [(r.entry && r.entry.disc) || 'UNKNOWN'] },
  exit: { entry: false, f: r => [(r.exit && r.exit.reason) || 'UNKNOWN'] }
};
const PATTERN_COMBOS = [['strategy'], ['regime'], ['score'], ['conf'], ['risk'], ['liq'], ['age'], ['vol'], ['signals'], ['sec'], ['pump'], ['exit'],
  ['strategy', 'regime'], ['strategy', 'score'], ['strategy', 'vol'], ['regime', 'score'], ['vol', 'score'], ['signals', 'vol'], ['signals', 'regime'], ['liq', 'age'], ['sec', 'score'], ['strategy', 'exit'], ['disc'], ['disc', 'score'], ['disc', 'age']];
function patternKeysOf(rec) {
  const out = [];
  for (const combo of PATTERN_COMBOS) {
    let parts = [{}];
    for (const d of combo) { const vals = PATTERN_DIMS[d].f(rec); const nx = []; for (const p of parts) for (const v of vals) nx.push({ ...p, [d]: v }); parts = nx; }
    for (const dims of parts) out.push({ key: combo.map(d => d + '=' + dims[d]).join('&'), dims, entry: combo.every(d => PATTERN_DIMS[d].entry) });
  }
  return out;
}
function updatePatternAgg(agg, rec, dims, entry) {
  const a = agg || { dims, entry, n: 0, wins: 0, losses: 0, sumPnl: 0, sumPct: 0, gw: 0, gl: 0, sumMae: 0, nMae: 0, sumMfe: 0, nMfe: 0, fp: 0, obs: [], firstSeen: rec.closedAt, lastSeen: rec.closedAt, regimes: [] };
  const o = rec.outcome, p = rec.path || {};
  if (!isNum(o.pnlUsd) || !isNum(o.pnlPct)) return a;
  a.n++; if (o.win) { a.wins++; a.gw = lr2(a.gw + o.pnlUsd); } else { a.losses++; a.gl = lr2(a.gl - o.pnlUsd); }
  a.sumPnl = lr2(a.sumPnl + o.pnlUsd); a.sumPct = lr2(a.sumPct + o.pnlPct);
  if (isNum(p.mae5m)) { a.sumMae = lr2(a.sumMae + p.mae5m); a.nMae++; }
  if (isNum(p.maxRunupPct)) { a.sumMfe = lr2(a.sumMfe + p.maxRunupPct); a.nMfe++; }
  if (rec.labels && rec.labels.signalQuality === 'FALSE_POSITIVE') a.fp++;
  a.obs.push([rec.closedAt, o.pnlPct, o.pnlUsd]); a.obs.sort((x, y) => x[0] - y[0]); if (a.obs.length > LEARN_CAPS.obs) a.obs.shift();
  a.firstSeen = Math.min(a.firstSeen, rec.closedAt); a.lastSeen = Math.max(a.lastSeen, rec.closedAt);
  for (const t of arr(rec.regimeTags)) if (!a.regimes.includes(t)) a.regimes.push(t);
  return a;
}
function patternStats(key, a, base, cfg) {
  const vals = a.obs.map(x => x[1]), exp = a.n ? a.sumPnl / a.n : null, expPct = a.n ? a.sumPct / a.n : null;
  const cut = Math.floor(a.obs.length * 0.6), is = a.obs.slice(0, cut), oos = a.obs.slice(cut);
  const dIs = is.length ? avg(is.map(x => x[1])) - base.expPct : null, dOos = oos.length ? avg(oos.map(x => x[1])) - base.expPct : null;
  const oosConfirmed = oos.length >= 5 && is.length >= 6 && dIs != null && dOos != null && Math.sign(dIs) === Math.sign(dOos) && Math.abs(dOos) >= 1;
  let status = a.n < Math.max(5, Math.round(cfg.minPattern / 4)) ? 'INSUFFICIENT' : 'HYPOTHESIS';
  if (a.n >= cfg.minPattern && oosConfirmed) status = 'STABLE_LEARNING_PATTERN';
  const winRate = a.n ? a.wins / a.n : null;
  return {
    key, dims: a.dims, entry: a.entry, n: a.n, wins: a.wins, losses: a.losses, winRate, expectancy: lr2(exp), expPct: lr2(expPct), profitFactor: a.gl > 0 ? lr2(a.gw / a.gl) : a.gw > 0 ? Infinity : null,
    medianPct: lr2(median(vals)), tailPct: lr2(quantile(vals, 0.05)), ddContribution: base.totalLoss > 0 ? lr2(a.gl / base.totalLoss * 100) : null, avgMae: a.nMae ? lr2(a.sumMae / a.nMae) : null, avgMfe: a.nMfe ? lr2(a.sumMfe / a.nMfe) : null,
    fpRate: a.n ? lr2(a.fp / a.n) : null, ci: bootstrapCI(vals, key), lastSeen: a.lastSeen, firstSeen: a.firstSeen, regimes: a.regimes.length, oosConfirmed, status,
    direction: expPct == null ? null : expPct < base.expPct ? 'WORSE' : 'BETTER', evidence: evidenceLevel(a.n), warning: a.n < 15 && winRate != null && winRate >= 0.8 ? 'Hohe Trefferquote bei kleiner Stichprobe – Warnsignal, keine Regel' : null
  };
}

/* 7) Hypothesis Engine – aus Einstiegs-Mustern und Ursachenclustern testbare, nur verschärfende Änderungen. */
const HYP_DEF = {
  MIN_SCORE: { title: c => `Mindest-Score auf ${c.minScore} anheben`, test: 'Score-Buckets zeitlich getrennt (Train/Validation/Test) + Walk-Forward' },
  MIN_CONF: { title: c => `Mindest-Confidence auf ${c.minConfidence} anheben`, test: 'Confidence-Kohorten OOS vergleichen' },
  MIN_LIQ: { title: c => `Mindest-Liquidität auf ${fmtUsd(c.minLiq)} anheben`, test: 'Liquiditäts-Kohorten OOS vergleichen' },
  REQUIRE_VERIFIED: { title: () => 'Nur VERIFIED Security handeln', test: 'Fresh/Verified vs. Partial/Stale Security-Kohorten' },
  BLOCK_STRAT_REGIME: { title: c => `Strategie ${c.rules.blocks[0].split('|')[0]} im Regime ${c.rules.blocks[0].split('|')[1]} sperren`, test: 'Regime-bedingte Strategie-Auswertung OOS' },
  REGIME_SCORE_BUMP: { title: c => { const [t, b] = Object.entries(c.rules.regimeScoreBump)[0]; return `Im Regime ${t} +${b} Punkte Mindest-Score`; }, test: 'Score-Aussagekraft je Regime OOS' },
  VOLUME_CONFIRM: { title: c => `Volume-Signale nur mit ≥ +${c.rules.volumeConfirmPct} % Preisbestätigung (5m)`, test: 'Volume × Price Confirmation OOS' },
  BLOCK_POST_PUMP: { title: () => 'Keine Einstiege direkt im/nach Pump', test: 'Post-Pump vs. Normal Kohorte OOS' },
  MIN_PAIR_AGE: { title: c => `Pairs erst ab ${c.minPairAgeMin} min Alter`, test: 'Token-Alter-Kohorten OOS' },
  TRAIL_TIGHTER: { title: c => `Trailing-Abstand auf ${c.trailPct} % verringern`, test: 'MFE-Giveback-Analyse + Exit-Resimulation OOS' },
  STOP_WIDER: { title: c => `Stop-Loss auf ${c.stopLossPct} % erweitern`, test: 'Exit-too-early-Analyse + Exit-Resimulation OOS' },
  BLOCK_DISC: { title: c => `Coins aus Quelle ${DISC_DE[c.rules.blockDisc[0]] || c.rules.blockDisc[0]} meiden`, test: 'Quellen-Kohorten zeitlich getrennt (OOS) vergleichen' }
};
function hypothesisOf(type, change, source, now) {
  const key = type + ':' + JSON.stringify(change);
  return { id: 'H-' + hashStr(key).toString(36).toUpperCase(), key, type, change, title: HYP_DEF[type].title(change), statement: source.statement, test: HYP_DEF[type].test, status: 'IDEA', source: { patternKey: source.patternKey || null, n: source.n || null, expPct: source.expPct != null ? source.expPct : null, basePct: source.basePct != null ? source.basePct : null }, createdAt: now, updatedAt: now, sampleSize: source.n || 0, experimentIds: [], result: null };
}
function generateHypotheses(stats, famStats, base, P, now) {
  const out = [], push = (type, change, src) => { if (change) out.push(hypothesisOf(type, change, src, now)); };
  const bucketHi = { '<60': 60, '60-69': 70, '70-79': 80 }, confHi = { '<60': 60, '60-74': 75 }, liqHi = { '<20k': 20000, '20-75k': 75000, '75-250k': 250000 };
  for (const s of stats) {
    if (!s.entry || s.status === 'INSUFFICIENT' || s.direction !== 'WORSE' || s.n < 8 || !isNum(s.expPct) || s.expPct > base.expPct - 2) continue;
    const src = { patternKey: s.key, n: s.n, expPct: s.expPct, basePct: base.expPct, statement: `Muster ${s.key}: Ø ${fmtPct(s.expPct)} je Trade (n=${s.n}) vs. Gesamt ${fmtPct(base.expPct)}` };
    const d = s.dims, keys = Object.keys(d);
    if (keys.length === 1 && d.score && bucketHi[d.score] && bucketHi[d.score] > P.minScore) push('MIN_SCORE', { minScore: clamp(bucketHi[d.score], ...LEARN_BOUNDS.minScore) }, src);
    if (keys.length === 1 && d.conf && confHi[d.conf] && confHi[d.conf] > P.minConfidence) push('MIN_CONF', { minConfidence: clamp(confHi[d.conf], ...LEARN_BOUNDS.minConfidence) }, src);
    if (keys.length === 1 && d.liq && liqHi[d.liq] && liqHi[d.liq] > P.minLiq) push('MIN_LIQ', { minLiq: clamp(liqHi[d.liq], ...LEARN_BOUNDS.minLiq) }, src);
    if (keys.length === 1 && d.sec && ['PARTIAL', 'UNKNOWN'].includes(d.sec) && !P.requireVerifiedSecurity) push('REQUIRE_VERIFIED', { requireVerifiedSecurity: true }, src);
    if (keys.length === 1 && d.pump && ['PUMP', 'POST_PUMP'].includes(d.pump) && !P.rules.blockPostPump) push('BLOCK_POST_PUMP', { rules: { blockPostPump: true } }, src);
    if (keys.length === 1 && d.age === 'NEW' && P.minPairAgeMin < 60) push('MIN_PAIR_AGE', { minPairAgeMin: 60 }, src);
    if (keys.length === 1 && d.signals && d.signals.includes('VOLUME_EXPANSION') && !(P.rules.volumeConfirmPct > 0)) push('VOLUME_CONFIRM', { rules: { volumeConfirmPct: 2 } }, src);
    if (keys.length === 1 && d.disc && DISC_BLOCKABLE.has(d.disc) && !arr(P.rules.blockDisc).includes(d.disc)) push('BLOCK_DISC', { rules: { blockDisc: [d.disc] } }, src);
    if (keys.length === 2 && d.strategy && d.regime && d.strategy !== 'manuell' && d.regime !== 'UNKNOWN' && !P.rules.blocks.includes(d.strategy + '|' + d.regime)) push('BLOCK_STRAT_REGIME', { rules: { blocks: [d.strategy + '|' + d.regime] } }, src);
    if (keys.length === 2 && d.regime && d.score && bucketHi[d.score] && d.regime !== 'UNKNOWN') { const bump = clamp(bucketHi[d.score] - P.minScore, 5, LEARN_BOUNDS.regimeScoreBump[1]); if (bump > (P.rules.regimeScoreBump[d.regime] || 0)) push('REGIME_SCORE_BUMP', { rules: { regimeScoreBump: { [d.regime]: bump } } }, src); }
  }
  if (famStats && famStats.losses >= 10) {
    const late = famStats.shares.EXIT_TOO_LATE || 0, early = famStats.shares.EXIT_TOO_EARLY || 0;
    if (late >= 0.3 && P.trailPct - 3 >= LEARN_BOUNDS.trailPct[0]) push('TRAIL_TIGHTER', { trailPct: P.trailPct - 3 }, { n: famStats.losses, statement: `${(late * 100).toFixed(0)} % der Verluste mit hohem Giveback (EXIT_TOO_LATE)` });
    if (early >= 0.3 && P.stopLossPct + 3 <= LEARN_BOUNDS.stopLossPct[1]) push('STOP_WIDER', { stopLossPct: P.stopLossPct + 3 }, { n: famStats.losses, statement: `${(early * 100).toFixed(0)} % der Verluste mit Erholung direkt nach Stop (EXIT_TOO_EARLY)` });
  }
  const seen = new Set(); return out.filter(h => (seen.has(h.id) ? false : (seen.add(h.id), true)));
}

/* 8) Research Runner – Parameter-Wiedergabe auf historischen Records (nur verschärfende Einstiegsfilter, Exit-Resimulation). */
function mergeParams(base, ch) {
  const P = { ...base, rules: { blocks: [...base.rules.blocks], regimeScoreBump: { ...base.rules.regimeScoreBump }, volumeConfirmPct: base.rules.volumeConfirmPct || 0, blockPostPump: !!base.rules.blockPostPump, blockDisc: arr(base.rules.blockDisc).filter(c => DISC_BLOCKABLE.has(c)) } };
  for (const k of LEARN_SETTING_KEYS) if (ch[k] !== undefined) P[k] = k === 'requireVerifiedSecurity' ? !!ch[k] || !!base[k] : clamp(ch[k], ...LEARN_BOUNDS[k]);
  // Einstiegsfilter nur verschärfen (nie lockern)
  for (const k of ['minScore', 'minConfidence', 'minLiq', 'minPairAgeMin']) if (isNum(base[k])) P[k] = Math.max(P[k], base[k]);
  const r = ch.rules || {};
  for (const b of arr(r.blocks)) if (!P.rules.blocks.includes(b)) P.rules.blocks.push(b);
  for (const [t, v] of Object.entries(r.regimeScoreBump || {})) P.rules.regimeScoreBump[t] = Math.max(P.rules.regimeScoreBump[t] || 0, clamp(v, ...LEARN_BOUNDS.regimeScoreBump));
  if (isNum(r.volumeConfirmPct)) P.rules.volumeConfirmPct = Math.max(P.rules.volumeConfirmPct, clamp(r.volumeConfirmPct, ...LEARN_BOUNDS.volumeConfirmPct));
  if (r.blockPostPump) P.rules.blockPostPump = true;
  for (const c of arr(r.blockDisc)) if (DISC_BLOCKABLE.has(c) && !P.rules.blockDisc.includes(c)) P.rules.blockDisc.push(c);
  return P;
}
const maxBump = (rules, tags) => Math.max(0, ...arr(tags).map(t => (rules && rules.regimeScoreBump && rules.regimeScoreBump[t]) || 0));
function passesParams(rec, P) {
  const f = rec.entry || {}, R = P.rules || emptyRules(), strat = rec.strategy || 'manuell';
  if (isNum(f.finalScore) && f.finalScore < P.minScore + maxBump(R, rec.regimeTags)) return false;
  if (isNum(f.confidence) && isNum(P.minConfidence) && f.confidence < P.minConfidence) return false;
  if (isNum(f.liquidity) && isNum(P.minLiq) && f.liquidity < P.minLiq) return false;
  if (P.requireVerifiedSecurity && f.secStatus && f.secStatus !== 'VERIFIED' && f.secStatus !== 'UNKNOWN') return false;
  if (P.minPairAgeMin > 0 && isNum(f.pairAgeMin) && f.pairAgeMin < P.minPairAgeMin) return false;
  if (arr(R.blocks).some(b => { const [s, t] = b.split('|'); return s === strat && arr(rec.regimeTags).includes(t); })) return false;
  if (R.volumeConfirmPct > 0 && arr(f.signals).some(s => s.type === 'VOLUME_EXPANSION') && isNum(f.chg5m) && f.chg5m < R.volumeConfirmPct) return false;
  if (R.blockPostPump && ['PUMP', 'POST_PUMP'].includes(f.pumpState)) return false;
  if (arr(R.blockDisc).includes(f.disc)) return false;
  return true;
}
const exitDiffers = (a, b) => a.stopLossPct !== b.stopLossPct || a.trailPct !== b.trailPct;
function outcomeUnder(rec, P, sim) {
  if (!passesParams(rec, P)) return { taken: false, pnlUsd: 0, pnlPct: 0, tradeId: rec.tradeId };
  const o = rec.outcome;
  if (!sim) return { taken: true, pnlUsd: o.pnlUsd, pnlPct: o.pnlPct, tradeId: rec.tradeId, rec };
  const s = fullPath(rec);
  if (s.length < 3) return { taken: true, pnlUsd: o.pnlUsd, pnlPct: o.pnlPct, tradeId: rec.tradeId, rec, approx: true };
  const r = simulateExit(s, { stopPct: P.stopLossPct, trailActPct: P.trailActivatePct, trailPct: P.trailPct, tp3Pct: P.tp3Pct });
  const size = rec.execution.sizeUsd || 0, fees = rec.execution.feesUsd || 0;
  return { taken: true, pnlUsd: lr2(size * r.pnlPct / 100 - fees), pnlPct: r.pnlPct, tradeId: rec.tradeId, rec, sim: true };
}
function metricsOf(outs) {
  const taken = outs.filter(o => o.taken), pnl = taken.map(o => o.pnlUsd);
  const wins = pnl.filter(x => x > 0), losses = pnl.filter(x => x <= 0), gw = sum(wins), gl = -sum(losses);
  let eq = 0, peak = 0, dd = 0; for (const o of outs) { eq += o.pnlUsd; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const recs = taken.map(o => o.rec).filter(Boolean), regimes = new Set(); recs.forEach(r => arr(r.regimeTags).forEach(t => regimes.add(t)));
  return {
    n: taken.length, of: outs.length, net: lr2(sum(pnl)), expectancy: taken.length ? lr2(sum(pnl) / taken.length) : null, perOpportunity: outs.length ? lr2(sum(pnl) / outs.length) : null,
    winRate: taken.length ? lr2(wins.length / taken.length) : null, avgWin: wins.length ? lr2(gw / wins.length) : null, avgLoss: losses.length ? lr2(-gl / losses.length) : null,
    profitFactor: gl > 0 ? lr2(gw / gl) : wins.length ? Infinity : null, maxDD: lr2(dd), tailPct: lr2(quantile(taken.map(o => o.pnlPct), 0.05)),
    avgMae: lr2(avg(recs.map(r => r.path && r.path.mae5m).filter(isNum))), avgMfe: lr2(avg(recs.map(r => r.path && r.path.maxRunupPct).filter(isNum))),
    fees: lr2(sum(recs.map(r => r.execution.feesUsd || 0))), slippage: lr2(sum(recs.map(r => r.execution.slippageUsd || 0))), exposure: lr2(sum(recs.map(r => r.execution.sizeUsd || 0))), regimes: regimes.size
  };
}
function candidateGrid(h, base) {
  const c = h.change, g = [];
  const up = (k, steps) => { for (const v of steps) { const x = clamp(v, ...LEARN_BOUNDS[k]); if (x > base[k] && !g.some(y => y[k] === x)) g.push({ [k]: x }); } };
  if (h.type === 'MIN_SCORE') up('minScore', [base.minScore + 5, base.minScore + 10, c.minScore]);
  else if (h.type === 'MIN_CONF') up('minConfidence', [base.minConfidence + 5, base.minConfidence + 10, c.minConfidence]);
  else if (h.type === 'MIN_LIQ') up('minLiq', [base.minLiq * 1.5, base.minLiq * 2, c.minLiq]);
  else if (h.type === 'MIN_PAIR_AGE') up('minPairAgeMin', [30, 60, 120]);
  else if (h.type === 'TRAIL_TIGHTER') { for (const v of [base.trailPct - 2, base.trailPct - 4]) { const x = clamp(v, ...LEARN_BOUNDS.trailPct); if (x < base.trailPct && !g.some(y => y.trailPct === x)) g.push({ trailPct: x }); } }
  else if (h.type === 'STOP_WIDER') { for (const v of [base.stopLossPct + 3, base.stopLossPct + 6]) { const x = clamp(v, ...LEARN_BOUNDS.stopLossPct); if (x > base.stopLossPct && !g.some(y => y.stopLossPct === x)) g.push({ stopLossPct: x }); } }
  else if (h.type === 'REGIME_SCORE_BUMP') { const [t] = Object.keys(c.rules.regimeScoreBump); for (const b of [5, 10]) g.push({ rules: { regimeScoreBump: { [t]: b } } }); }
  else if (h.type === 'VOLUME_CONFIRM') for (const v of [1, 2, 3]) g.push({ rules: { volumeConfirmPct: v } });
  else g.push(c);
  return g;
}
/* Experiment: Parameter nur auf Training wählen, auf Validation/Test prüfen, Walk-Forward (3 Fenster), Sensitivität, Bootstrap, Leakage-Test. */
function runExperiment(h, recs, base, cfg) {
  const rs = recs.filter(r => r.outcome && isNum(r.outcome.pnlUsd) && r.entry).slice().sort(byClose), n = rs.length;
  const id = 'E-' + hashStr(h.id + ':' + n + ':' + (n ? rs[n - 1].tradeId : '') + ':' + JSON.stringify(base)).toString(36).toUpperCase();
  const e = { id, type: h.type, hypothesis: h.id, title: h.title, baselineVersion: cfg.championId || null, challengerVersion: null, dataWindow: n ? [rs[0].closedAt, rs[n - 1].closedAt] : null, trainWindow: null, validationWindow: null, testWindow: null, tradesTrain: 0, tradesValidation: 0, tradesTest: 0, change: null, metricsBaseline: null, metricsChallenger: null, robustness: null, drift: cfg.drift || null, decision: 'INSUFFICIENT_DATA', reason: '', rollbackPlan: `Bei schlechterer Shadow-/Live-Evidenz automatische Rückkehr zu ${cfg.championId || 'Baseline'}` };
  if (n < cfg.minTest * 3) { e.reason = `Nur ${n} verwertbare Trades – mindestens ${cfg.minTest * 3} nötig (NOT_ENOUGH_DATA)`; return e; }
  const a = Math.floor(n * 0.6), b = Math.floor(n * 0.8), train = rs.slice(0, a), val = rs.slice(a, b), test = rs.slice(b);
  const win = s => (s.length ? [s[0].closedAt, s[s.length - 1].closedAt] : null);
  Object.assign(e, { trainWindow: win(train), validationWindow: win(val), testWindow: win(test), tradesTrain: train.length, tradesValidation: val.length, tradesTest: test.length });
  const grid = candidateGrid(h, base);
  if (!grid.length) { e.decision = 'REJECTED'; e.reason = 'Keine verschärfende Änderung innerhalb der Grenzen möglich'; return e; }
  const simOf = P => exitDiffers(P, base);
  const ev = (set, P, sim) => metricsOf(set.map(r => outcomeUnder(r, P, sim)));
  const pick = set => { let best = null; for (const ch of grid) { const P = mergeParams(base, ch), sim = simOf(P), m = ev(set, P, sim), mb = ev(set, base, sim); const gain = m.net - mb.net; if (!best || gain > best.gain) best = { ch, P, sim, gain, m, mb }; } return best; };
  const best = pick(train);
  e.change = best.ch;
  if (!(best.gain > 0)) { e.decision = 'REJECTED'; e.reason = 'Auf den Trainingsdaten keine Verbesserung gegenüber der Baseline'; e.metricsBaseline = { train: best.mb }; e.metricsChallenger = { train: best.m }; return e; }
  const P = best.P, sim = best.sim;
  e.metricsBaseline = { train: best.mb, validation: ev(val, base, sim), test: ev(test, base, sim) };
  e.metricsChallenger = { train: best.m, validation: ev(val, P, sim), test: ev(test, P, sim) };
  const folds = [0.4, 0.6, 0.8].map(q => { const cut = Math.floor(n * q), end = Math.min(n, cut + Math.max(3, Math.floor(n * 0.2))); const tr = rs.slice(0, cut), te = rs.slice(cut, end); const pk = pick(tr); const Pf = pk && pk.gain > 0 ? pk.P : base, sf = pk ? pk.sim : false; const mb = ev(te, base, sf), mc = ev(te, Pf, sf); return { from: te.length ? te[0].closedAt : null, to: te.length ? te[te.length - 1].closedAt : null, n: te.length, base: mb.net, challenger: mc.net, better: mc.net >= mb.net && Pf !== base }; });
  const wfWins = folds.filter(f => f.better).length;
  const gi = grid.indexOf(best.ch), neigh = [grid[gi - 1], grid[gi + 1]].filter(Boolean);
  const sens = neigh.map(ch => { const Pn = mergeParams(base, ch), sn = simOf(Pn); return { change: ch, gain: lr2(ev(test, Pn, sn).net - ev(test, base, sn).net) }; });
  const sensitivityOk = sens.every(x => x.gain >= -Math.abs(e.metricsBaseline.test.net) * 0.25 - 0.01);
  const diffs = test.map(r => outcomeUnder(r, P, sim).pnlUsd - outcomeUnder(r, base, sim).pnlUsd);
  const ci = bootstrapCI(diffs, id), meanDiff = avg(diffs) || 0;
  const regimeSub = {}; for (const r of test) for (const t of arr(r.regimeTags)) { const s = regimeSub[t] || (regimeSub[t] = { n: 0, gain: 0 }); s.n++; s.gain = lr2(s.gain + outcomeUnder(r, P, sim).pnlUsd - outcomeUnder(r, base, sim).pnlUsd); }
  const subs = Object.entries(regimeSub).filter(([, s]) => s.n >= 3), subsOk = !subs.length || subs.filter(([, s]) => s.gain >= 0).length >= Math.ceil(subs.length / 2);
  const leakage = rs.filter(r => isNum(r.entry.ts) && r.entry.ts > r.openedAt + 5000).length;
  const complexity = 1 + Object.keys(best.ch).filter(k => k !== 'rules').length + (best.ch.rules ? Object.keys(best.ch.rules).length : 0) - 1;
  const mt = e.metricsChallenger.test, bt = e.metricsBaseline.test, vt = e.metricsChallenger.validation, bv = e.metricsBaseline.validation;
  const lowSample = test.length < cfg.minTest;
  const checks = [
    ['Test-Fenster groß genug', !lowSample, `${test.length} Trades (min. ${cfg.minTest})`],
    ['Test (OOS) besser als Baseline', mt.net > bt.net, `${fmtUsd(mt.net)} vs. ${fmtUsd(bt.net)}`],
    ['Validation nicht schlechter', vt.net >= bv.net, `${fmtUsd(vt.net)} vs. ${fmtUsd(bv.net)}`],
    ['Walk-Forward ≥ 2 von 3 Fenstern', wfWins >= 2, `${wfWins}/3`],
    ['Parameter-Sensitivität robust', sensitivityOk, sens.length ? sens.map(s => fmtSigned(s.gain)).join(', ') : 'kein Nachbarwert'],
    ['Bootstrap-Band (5 %) nicht klar negativ', !!ci && meanDiff > 0 && ci.lo > -Math.abs(meanDiff) * complexity, ci ? `Ø ${fmtSigned(meanDiff)} je Trade, Band ${fmtSigned(ci.lo)} bis ${fmtSigned(ci.hi)}` : 'zu wenig Daten'],
    ['Max Drawdown nicht > 25 % schlechter', mt.maxDD <= bt.maxDD * 1.25 + 0.01, `${fmtUsd(mt.maxDD)} vs. ${fmtUsd(bt.maxDD)}`],
    ['Regime-Subgruppen mehrheitlich ok', subsOk, subs.map(([t, s]) => `${t} ${fmtSigned(s.gain)}`).join(', ') || '—'],
    ['Kein Feature-Leakage (Features ≤ Einstieg)', leakage === 0, `${leakage} Verstöße`]
  ].map(([name, ok, detail]) => ({ name, ok, detail }));
  e.robustness = { checks, folds, sensitivity: sens, bootstrap: ci, meanDiff: lr2(meanDiff), complexity, subgroups: regimeSub, simulatedExits: sim, lowSample };
  const ok = checks.every(c => c.ok);
  e.decision = ok ? 'VALIDATED' : 'REJECTED';
  e.reason = ok ? `Robust besser auf Out-of-Sample-Daten (${test.length} Test-Trades) – Kandidat für Shadow-Phase` : 'Nicht erfüllt: ' + checks.filter(c => !c.ok).map(c => c.name).join(', ');
  return e;
}

/* 9) Kalibrierung (Score → Trefferquote) mit OOS-Brier-Prüfung; ohne ausreichende Daten keine Wahrscheinlichkeit. */
const CAL_BINS = [[0, 50], [50, 60], [60, 70], [70, 80], [80, 90], [90, 101]];
function calibrate(recs) {
  const rs = recs.filter(r => r.entry && isNum(r.entry.finalScore) && r.outcome && isNum(r.outcome.pnlUsd)).slice().sort(byClose);
  const mk = set => CAL_BINS.map(([lo, hi]) => { const b = set.filter(r => r.entry.finalScore >= lo && r.entry.finalScore < hi), k = b.filter(r => r.outcome.win).length; const w = wilson(k, b.length); return { lo, hi, n: b.length, wins: k, rate: b.length ? lr2(k / b.length) : null, ciLo: w ? lr2(w.lo) : null, ciHi: w ? lr2(w.hi) : null }; });
  const cut = Math.floor(rs.length * 0.7), tr = rs.slice(0, cut), te = rs.slice(cut), trBins = mk(tr);
  const baseRate = tr.length ? tr.filter(r => r.outcome.win).length / tr.length : null;
  let bc = 0, bb = 0;
  for (const r of te) { const b = trBins.find(x => r.entry.finalScore >= x.lo && r.entry.finalScore < x.hi); const pc = b && b.n >= 8 ? b.rate : baseRate, y = r.outcome.win ? 1 : 0; bc += (pc - y) ** 2; bb += (baseRate - y) ** 2; }
  const calibrated = tr.length >= 30 && te.length >= 10 && bc < bb;
  return { n: rs.length, bins: mk(rs), baseRate: lr2(baseRate), brierCal: te.length ? lr2(bc / te.length) : null, brierBase: te.length ? lr2(bb / te.length) : null, calibrated, status: rs.length < 40 ? 'NOT_ENOUGH_DATA' : calibrated ? 'CALIBRATED' : 'NOT_CALIBRATED' };
}
/* Loss-Risk-Modell: logistische Regression (deterministisch), Ziel = früher starker Verlust. Nur Research-Signal. */
const LM_FEATS = [['finalScore', v => v / 100], ['confidence', v => v / 100], ['risk', v => v / 100], ['liquidity', v => Math.log10(Math.max(1, v)) / 6], ['volPct', v => Math.min(v, 20) / 10], ['buyerRatio1h', v => v], ['chg5m', v => clamp(v, -50, 100) / 50], ['chg1h', v => clamp(v, -90, 300) / 100], ['pairAgeMin', v => Math.log10(1 + v) / 4], ['sigMax', v => v / 100]];
function lmVector(f) { const x = [1]; for (const [k, tf] of LM_FEATS) x.push(f && isNum(f[k]) ? tf(f[k]) : 0); x.push(f && f.secStatus === 'VERIFIED' ? 1 : 0); return x; }
const lossTarget = r => ((r.path && isNum(r.path.mae5m) && r.path.mae5m <= -8) || (!r.outcome.win && isNum(r.outcome.pnlPct) && r.outcome.pnlPct <= -8) ? 1 : 0);
function aucOf(p, y) { let pos = 0, neg = 0, s = 0; for (let i = 0; i < p.length; i++) { if (!y[i]) continue; pos++; for (let j = 0; j < p.length; j++) if (!y[j]) s += p[i] > p[j] ? 1 : p[i] === p[j] ? 0.5 : 0; } for (const v of y) if (!v) neg++; return pos && neg ? lr2(s / (pos * neg)) : null; }
function trainLossModel(recs) {
  const rs = recs.filter(r => r.entry && !r.legacy && r.outcome && isNum(r.outcome.pnlPct)).slice().sort(byClose);
  if (rs.length < 40) return { status: 'INSUFFICIENT_EVIDENCE', n: rs.length, need: 40 };
  const cut = Math.floor(rs.length * 0.7), tr = rs.slice(0, cut), te = rs.slice(cut);
  const X = tr.map(r => lmVector(r.entry)), Y = tr.map(lossTarget), d = X[0].length, w = new Array(d).fill(0);
  for (let ep = 0; ep < 300; ep++) { const g = new Array(d).fill(0); for (let i = 0; i < X.length; i++) { const e = sigmoid(dotv(w, X[i])) - Y[i]; for (let k = 0; k < d; k++) g[k] += e * X[i][k]; } for (let k = 0; k < d; k++) w[k] -= 0.5 * (g[k] / X.length + (k ? 0.01 * w[k] : 0)); }
  const pr = te.map(r => sigmoid(dotv(w, lmVector(r.entry)))), yt = te.map(lossTarget), baseRate = avg(Y);
  const brier = avg(pr.map((p, i) => (p - yt[i]) ** 2)), brierBase = avg(yt.map(y => (baseRate - y) ** 2)), auc = aucOf(pr, yt);
  const regimes = new Set(); tr.forEach(r => arr(r.regimeTags).forEach(t => regimes.add(t)));
  return { status: auc != null && auc >= 0.55 && brier <= brierBase ? 'VALIDATED' : 'WEAK', w: w.map(v => Math.round(v * 1e4) / 1e4), feats: [...LM_FEATS.map(x => x[0]), 'secVerified'], n: rs.length, nTrain: tr.length, nTest: te.length, brier: lr2(brier), brierBase: lr2(brierBase), auc, baseRate: lr2(baseRate), regimeCoverage: regimes.size };
}
function learningDecisionFor(f, model, calib, drift) {
  const out = { modelScore: null, calibratedProbability: null, evidenceLevel: 'LOW', uncertainty: null, sampleSize: model ? model.n || 0 : 0, outOfSample: false, regimeCoverage: model && model.regimeCoverage || 0, driftStatus: drift ? drift.status : 'NOT_ENOUGH_DATA', abstain: null };
  if (!model || !model.w) { out.abstain = 'INSUFFICIENT_EVIDENCE'; return out; }
  const pLoss = sigmoid(dotv(model.w, lmVector(f)));
  out.modelScore = Math.round(100 * (1 - pLoss)); out.outOfSample = true;
  out.evidenceLevel = model.status === 'VALIDATED' && model.nTest >= 30 ? 'HIGH' : model.status === 'VALIDATED' ? 'MEDIUM' : 'LOW';
  if (calib && calib.calibrated && isNum(f.finalScore)) { const b = calib.bins.find(x => f.finalScore >= x.lo && f.finalScore < x.hi); if (b && b.n >= 15) { out.calibratedProbability = b.rate; out.uncertainty = isNum(b.ciHi) && isNum(b.ciLo) ? lr2((b.ciHi - b.ciLo) / 2) : null; } }
  if (model.status !== 'VALIDATED') out.abstain = 'WEAK_MODEL';
  return out;
}

/* 10) Drift Detector – Verteilungs- und Performance-Drift zwischen Referenz- und aktuellem Fenster. */
function psi(ref, cur) {
  if (ref.length < 20 || cur.length < 10) return null;
  const qs = [0.2, 0.4, 0.6, 0.8].map(q => quantile(ref, q)), bin = v => qs.filter(q => v > q).length;
  const dist = a => { const c = [0, 0, 0, 0, 0]; for (const v of a) c[bin(v)]++; return c.map(x => (x + 0.5) / (a.length + 2.5)); };
  const r = dist(ref), c = dist(cur); return lr2(sum(r.map((ri, i) => (c[i] - ri) * Math.log(c[i] / ri))));
}
function stdDiff(a, b) {
  if (a.length < 5 || b.length < 5) return null;
  const sa = stdev(a), sb = stdev(b), sp = Math.sqrt(((sa || 0) ** 2 + (sb || 0) ** 2) / 2), d = avg(b) - avg(a), scale = Math.max(1, Math.abs(avg(a)));
  if (!(sp > 1e-9 * scale)) return Math.abs(d) > 1e-9 * scale ? Math.sign(d) * 9.99 : 0; // konstante Werte: Rundungsrauschen ≠ Drift
  return lr2(d / sp);
}
function detectDrift(recs) {
  const rs = recs.filter(r => r.entry && !r.legacy && r.outcome).slice().sort(byClose);
  if (rs.length < 30) return { status: 'NOT_ENOUGH_DATA', n: rs.length, need: 30, checks: [] };
  const k = Math.max(10, Math.floor(rs.length * 0.25)), cur = rs.slice(-k), ref = rs.slice(Math.max(0, rs.length - k - 60), rs.length - k);
  const lvl = (v, w, d) => (v == null ? 'NOT_ENOUGH_DATA' : Math.abs(v) >= d ? 'DRIFT' : Math.abs(v) >= w ? 'WATCH' : 'STABLE');
  const col = (set, fn) => set.map(fn).filter(isNum), checks = [];
  for (const [name, fn] of [['Volatilität', r => r.entry.volPct], ['Liquidität (log)', r => (isNum(r.entry.liquidity) ? Math.log10(Math.max(1, r.entry.liquidity)) : null)], ['Käuferanteil 1h', r => r.entry.buyerRatio1h], ['Transaktionen 1h', r => r.entry.txRate1h]]) { const v = psi(col(ref, fn), col(cur, fn)); checks.push({ group: 'Feature', name, value: v, metric: 'PSI', status: lvl(v, 0.1, 0.25) }); }
  const wr = s => s.filter(r => r.outcome.win).length / s.length, d1 = wr(cur) - wr(ref);
  checks.push({ group: 'Outcome', name: 'Trefferquote', value: lr2(d1), metric: 'Δ', status: lvl(d1, 0.15, 0.3) });
  const d2 = stdDiff(ref.map(r => r.outcome.pnlPct), cur.map(r => r.outcome.pnlPct)); checks.push({ group: 'Outcome', name: 'PnL-Verteilung', value: d2, metric: 'Std-Δ', status: lvl(d2, 0.5, 0.8) });
  const sigRate = (set, t) => { const s = set.filter(r => arr(r.entry.signals).some(x => x.type === t)); return s.length >= 5 ? s.filter(r => r.outcome.win).length / s.length : null; };
  const types = [...new Set(rs.flatMap(r => arr(r.entry.signals).map(s => s.type)))];
  let worstSig = null; for (const t of types) { const a = sigRate(ref, t), b = sigRate(cur, t); if (a != null && b != null && (!worstSig || Math.abs(b - a) > Math.abs(worstSig.d))) worstSig = { t, d: b - a }; }
  checks.push({ group: 'Signal', name: worstSig ? `Trefferquote ${worstSig.t}` : 'Signal-Trefferquoten', value: worstSig ? lr2(worstSig.d) : null, metric: 'Δ', status: worstSig ? lvl(worstSig.d, 0.2, 0.35) : 'NOT_ENOUGH_DATA' });
  const freq = s => { const m = {}; for (const r of s) for (const t of arr(r.regimeTags)) m[t] = (m[t] || 0) + 1 / s.length; return m; }, fr = freq(ref), fc = freq(cur);
  const tvd = lr2(sum([...new Set([...Object.keys(fr), ...Object.keys(fc)])].map(t => Math.abs((fc[t] || 0) - (fr[t] || 0)))) / 2);
  checks.push({ group: 'Regime', name: 'Regime-Häufigkeiten', value: tvd, metric: 'TVD', status: lvl(tvd, 0.3, 0.5) });
  for (const [name, fn] of [['Latenz', r => r.execution.entryLatencyMs], ['Slippage %', r => (r.execution.sizeUsd > 0 ? (r.execution.slippageUsd || 0) / r.execution.sizeUsd * 100 : null)], ['Price Impact', r => r.execution.estimatedImpactPct]]) { const v = stdDiff(col(ref, fn), col(cur, fn)); checks.push({ group: 'Execution', name, value: v, metric: 'Std-Δ', status: lvl(v, 0.5, 0.8) }); }
  const deg = s => s.filter(r => r.labels && ['BAD', 'DEGRADED'].includes(r.labels.dataQuality)).length / s.length, d3 = deg(cur) - deg(ref);
  checks.push({ group: 'Datenquelle', name: 'Anteil degradierter Daten', value: lr2(d3), metric: 'Δ', status: lvl(Math.max(0, d3), 0.15, 0.3) });
  const order = { STABLE: 0, NOT_ENOUGH_DATA: 0, WATCH: 1, DRIFT: 2 };
  const worst = checks.reduce((m, c) => (order[c.status] > order[m] ? c.status : m), 'STABLE');
  return { status: worst, n: rs.length, refN: ref.length, curN: cur.length, checks };
}

/* 11) Fehler-Analyse nach Verlustserie (CONTROLLED_REVIEW) – nie aggressiver handeln, nur analysieren. */
const FAMILY_GROUP = { SIGNAL_FALSE_POSITIVE: 'Entry', REGIME_MISMATCH: 'Entry', MOMENTUM_EXHAUSTION: 'Entry', VOLUME_DECOUPLING: 'Entry', SECURITY_RELATED: 'Entry', EXIT_TOO_LATE: 'Exit', EXIT_TOO_EARLY: 'Exit', EXECUTION: 'Execution', LIQUIDITY_FAILURE: 'Execution', RISK_OVERSIZING: 'Execution', DATA_QUALITY: 'Data Quality', NOISE_OR_RANDOM: 'Zufall', UNKNOWN: 'Unbekannt' };
function lossStreakReview(recs, streak, drift, hyps, now) {
  const rs = recs.slice().sort(byClose), losses = rs.slice(-streak).filter(r => !r.outcome.win), prior = rs.slice(0, -streak), wins = prior.filter(r => r.outcome.win).slice(-30);
  const count = (list, fn) => { const m = {}; for (const r of list) for (const v of fn(r)) m[v] = (m[v] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const feats = ['finalScore', 'confidence', 'risk', 'liquidity', 'volPct', 'buyerRatio1h', 'chg5m', 'chg1h'];
  const diffs = feats.map(k => { const a = wins.map(r => r.entry && r.entry[k]).filter(isNum), b = losses.map(r => r.entry && r.entry[k]).filter(isNum); return { feature: k, wins: lr2(avg(a)), losses: lr2(avg(b)), d: stdDiff(a, b) }; }).filter(x => x.d != null).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const shares = {}; for (const r of losses) { const g = FAMILY_GROUP[(r.labels && r.labels.lossFamily) || 'UNKNOWN'] || 'Unbekannt'; shares[g] = (shares[g] || 0) + 1; }
  const p = prior.length ? prior.filter(r => r.outcome.win).length / prior.length : null, prob = p != null ? Math.pow(1 - p, streak) : null;
  return {
    id: 'R-' + hashStr(losses.map(r => r.tradeId).join(',')).toString(36).toUpperCase(), ts: now, tag: 'CONTROLLED_REVIEW', streak,
    strategies: count(losses, r => [r.strategy || 'manuell']), regimes: count(losses, r => arr(r.regimeTags)), featureDiffs: diffs.slice(0, 5), shares,
    unusual: { winRate: p != null ? lr2(p) : null, probability: prob != null ? Math.round(prob * 1000) / 1000 : null, unusual: prob != null && prob < 0.05, n: prior.length },
    falseSignalCluster: losses.filter(r => r.labels && r.labels.signalQuality === 'FALSE_POSITIVE').length, drift: drift ? drift.status : 'NOT_ENOUGH_DATA',
    hypotheses: arr(hyps).filter(h => ['IDEA', 'TESTING'].includes(h.status)).slice(0, 3).map(h => ({ id: h.id, title: h.title })),
    tradeIds: losses.map(r => r.tradeId), note: 'Keine aggressivere Handelsweise, keine größeren Positionen – nur Analyse und Hypothesen'
  };
}

/* 11b) Fehlerklassen – nicht jeder Verlust ist ein Fehler. Verlustfamilie → eine von sechs Klassen,
   dazu die Prüfung „erwartbarer Verlust?“: lag der Verlust im geplanten Risiko (Stop beim Einstieg + Slippage-Toleranz + Kosten)? */
const ERROR_CLASS_OF = { NOISE_OR_RANDOM: 'STATISTICAL', EXECUTION: 'EXECUTION', LIQUIDITY_FAILURE: 'EXECUTION', DATA_QUALITY: 'DATA', SECURITY_RELATED: 'SECURITY', SIGNAL_FALSE_POSITIVE: 'MODEL', REGIME_MISMATCH: 'MODEL', MOMENTUM_EXHAUSTION: 'MODEL', VOLUME_DECOUPLING: 'MODEL', EXIT_TOO_LATE: 'MODEL', EXIT_TOO_EARLY: 'MODEL', RISK_OVERSIZING: 'PROCESS', UNKNOWN: 'UNKNOWN' };
const ERROR_CLASSES = ['STATISTICAL', 'EXECUTION', 'DATA', 'SECURITY', 'MODEL', 'PROCESS', 'UNKNOWN'];
const ERROR_CLASS_DE = { STATISTICAL: 'Normaler statistischer Verlust', EXECUTION: 'Execution-Fehler', DATA: 'Datenfehler', SECURITY: 'Security-Fehler', MODEL: 'Modell-/Strategiefehler', PROCESS: 'Prozessfehler', UNKNOWN: 'Unklar (zu wenig Daten)' };
const LOSS_VERDICT_DE = { EXPECTED: 'erwartbar – im geplanten Risiko, keine systematische Ursache', WITHIN_PLAN_WITH_CAUSE: 'im geplanten Risiko, aber mit belegter Ursache (Lernkandidat)', WITHIN_PLAN: 'im geplanten Risiko, Ursache unklar', OVER_PLAN: 'größer als geplant – prüfen', UNKNOWN: 'kein geplanter Stop bekannt' };
function expectedLossCheck(rec, S) {
  const o = (rec && rec.outcome) || {}, x = (rec && rec.execution) || {};
  if (o.win || !isNum(o.pnlPct)) return null;
  const fromPlan = !!(rec.plan && isNum(rec.plan.stopPct)), planned = fromPlan ? rec.plan.stopPct : S && isNum(S.stopLossPct) ? S.stopLossPct : null;
  if (!isNum(planned)) return { verdict: 'UNKNOWN', plannedPct: null, actualPct: lr2(o.pnlPct), tolPct: null, source: 'NONE' };
  const costPct = isNum(x.sizeUsd) && x.sizeUsd > 0 ? ((x.feesUsd || 0) + (x.slippageUsd || 0)) / x.sizeUsd * 100 : 0;
  const tolPct = lr2(Math.max(1, isNum(S && S.maxSlippagePct) ? S.maxSlippagePct : 0) + costPct);
  return { verdict: -o.pnlPct <= planned + tolPct ? 'WITHIN_PLAN' : 'OVER_PLAN', plannedPct: lr2(planned), actualPct: lr2(o.pnlPct), tolPct, source: fromPlan ? 'PLAN' : 'SETTINGS' };
}
function errorClassify(rec, S) {
  const l = (rec && rec.labels) || {}, o = (rec && rec.outcome) || {}, f = (rec && rec.entry) || {};
  if (o.win || !l.lossFamily) return null;
  const exp = expectedLossCheck(rec, S);
  let cls = ERROR_CLASS_OF[l.lossFamily] || 'UNKNOWN', why = (l.why || {})[l.lossFamily] || ERROR_CLASS_DE[cls];
  if (isNum(f.blockerCount) && f.blockerCount > 0) { cls = 'PROCESS'; why = `Einstieg trotz ${f.blockerCount} aktiver Analyse-Blocker (manuell)`; }
  else if (exp && exp.verdict === 'OVER_PLAN' && (cls === 'STATISTICAL' || cls === 'UNKNOWN')) { cls = 'EXECUTION'; why = `Stop nicht zum geplanten Kurs ausgeführt (Kurslücke/Latenz): ${fmtPct(exp.actualPct)} statt ≈ −${exp.plannedPct} %`; }
  const verdict = !exp ? 'UNKNOWN' : exp.verdict === 'OVER_PLAN' ? 'OVER_PLAN' : exp.verdict === 'UNKNOWN' ? 'UNKNOWN' : cls === 'STATISTICAL' ? 'EXPECTED' : cls === 'UNKNOWN' ? 'WITHIN_PLAN' : 'WITHIN_PLAN_WITH_CAUSE';
  return { cls, why, verdict, expected: exp };
}
function errorClassStats(recs) {
  const classes = Object.fromEntries(ERROR_CLASSES.map(c => [c, 0])), verdicts = { EXPECTED: 0, WITHIN_PLAN_WITH_CAUSE: 0, WITHIN_PLAN: 0, OVER_PLAN: 0, UNKNOWN: 0 };
  let n = 0;
  for (const r of recs) { const l = r.labels; if (r.outcome.win || !l || !l.errorClass) continue; n++; classes[l.errorClass] = (classes[l.errorClass] || 0) + 1; verdicts[l.lossVerdict || 'UNKNOWN'] = (verdicts[l.lossVerdict || 'UNKNOWN'] || 0) + 1; }
  return { n, classes, verdicts };
}

/* 11b2) Coin-Quellen (B3) – Ergebnis je primärer Discovery-Quelle: abgeschlossene Trades + ausgewertete Near-Misses. */
const DISC_MIN_N = 8;
function discoveryStats(recs, nmDone) {
  const by = {}, grp = c => by[c] || (by[c] = { disc: c, n: 0, wins: 0, sumPct: 0, sumUsd: 0, nm: 0, nmMissed: 0, nmAvoided: 0 });
  const done = arr(recs).filter(r => r && r.outcome && isNum(r.outcome.pnlPct));
  for (const r of done) { const x = grp((r.entry && r.entry.disc) || 'UNKNOWN'); x.n++; if (r.outcome.win) x.wins++; x.sumPct += r.outcome.pnlPct; x.sumUsd += isNum(r.outcome.pnlUsd) ? r.outcome.pnlUsd : 0; }
  for (const m of arr(nmDone)) { if (!m || m.outcome === 'NO_DATA') continue; const x = grp(m.disc || 'UNKNOWN'); x.nm++; if (m.outcome === 'MISSED_GAIN') x.nmMissed++; else if (m.outcome === 'AVOIDED_LOSS') x.nmAvoided++; }
  const basePct = done.length ? avg(done.map(r => r.outcome.pnlPct)) : null;
  const rows = Object.values(by).map(x => {
    const avgPct = x.n ? x.sumPct / x.n : null;
    const verdict = x.n < DISC_MIN_N || basePct == null ? 'NOT_ENOUGH_DATA' : avgPct < basePct - 2 ? 'WORSE' : avgPct > basePct + 2 ? 'BETTER' : 'AVERAGE';
    return { disc: x.disc, paid: DISC_PAID.has(x.disc), n: x.n, winRate: x.n ? lr2(x.wins / x.n) : null, avgPct: lr2(avgPct), netUsd: lr2(x.sumUsd), nm: x.nm, nmMissed: x.nmMissed, nmAvoided: x.nmAvoided, verdict };
  }).sort((a, b) => b.n - a.n || b.nm - a.nm || (a.disc < b.disc ? -1 : 1));
  return { n: done.length, basePct: lr2(basePct), rows };
}

/* 11c) Near-Misses – knapp nicht gehandelte Kandidaten 15 min beobachten: Opportunity Cost vs. vermiedener Verlust je Filter.
   Reine Messung: Filter werden daraus nie automatisch gelockert (die Lern-KI darf ausschließlich verschärfen). */
const NEAR_MISS_WINDOW = 15 * MIN, NEAR_MISS_MIN_N = 10;
const NM_SKIP = new Set(['NO_SIGNAL', 'PRICE_MISSING', 'DATA_STALE', 'DATA_CONFLICT', 'DATA_FALLBACK', 'MCAP_RANGE', 'SECURITY_CRITICAL', 'SECURITY_UNKNOWN', 'SECURITY_STALE', 'SECURITY_UNVERIFIED']);
const NM_SYSTEM = new Set(['AUTO_TRADING_OFF', 'PAPER_MANUAL', 'RECOVERING', 'BOT_NOT_RUNNING', 'MODE_READ_ONLY', 'LIVE_UNAVAILABLE', 'OFFLINE', 'SYSTEM_UNHEALTHY', 'FEE_UNKNOWN', 'EMERGENCY_STOP', 'SAFE_MODE', 'RECONCILIATION_REQUIRED', 'SECURITY_SOURCES_DOWN', 'TRADE_LOCKED', 'MAX_ACTIVE_ORDERS',
  'NO_SELL_ROUTE', 'ROUND_TRIP_COST', 'NO_ROUTE', 'PRICE_CONFLICT']); // Honeypot/Rundreise: der Preispfad zeigt keinen erzielbaren Gewinn (Verkauf unmöglich bzw. Kosten ignoriert)
const NM_OUTCOME_DE = { MISSED_GAIN: 'verpasster Gewinn', AVOIDED_LOSS: 'vermiedener Verlust', NEUTRAL: 'neutral', NO_DATA: 'keine Daten' };
function nearMissOf(A, D, S) {
  if (!A || !D || !A.core || !isNum(A.core.price) || !(A.core.price > 0) || D.decision === 'APPROVED') return null;
  if (D.decision === 'BUY_CANDIDATE') {
    if (D.execBlockers.some(b => NM_SYSTEM.has(b.code))) return null; // kein Filter-Entscheid, sondern Systemzustand
    const b = D.execBlockers[0]; return b ? { code: b.code, kind: 'RISK', gap: null, msg: b.msg } : null;
  }
  if (!D.fastPass || !D.secOk || D.analysisBlockers.length !== 1) return null;
  const b = D.analysisBlockers[0]; if (NM_SKIP.has(b.code)) return null;
  let gap = null;
  if (b.code === 'SCORE_TOO_LOW') { gap = S.minScore - A.finalScore; if (gap > 10) return null; }
  else if (b.code === 'CONFIDENCE_LOW') { gap = S.minConfidence - A.confidence.total; if (gap > 10) return null; }
  else if (b.code === 'RISK_TOO_HIGH') { gap = A.risk.total - S.maxRiskScore; if (A.risk.level === 'CRITICAL' || gap > 10) return null; }
  return { code: b.code, kind: 'ANALYSIS', gap, msg: b.msg };
}
/* Ergebnis nach 15 min: TP1 vor Stop → verpasster Gewinn, Stop vor TP1 → vermiedener Verlust. simPct = Exit-Simulation ohne Kosten (Näherung). */
function nearMissOutcome(m, S) {
  const s = arr(m.samples);
  if (s.length < 3) return { outcome: 'NO_DATA', simPct: null };
  const r = simulateExit(s, { stopPct: S.stopLossPct, trailActPct: S.trailActivatePct, trailPct: S.trailPct, tp3Pct: S.tp3Pct });
  const outcome = m.hit === 'TP' ? 'MISSED_GAIN' : m.hit === 'STOP' ? 'AVOIDED_LOSS' : 'NEUTRAL';
  return { outcome, simPct: r ? lr2(r.pnlPct) : null };
}
function nearMissStats(done) {
  const by = {}, tot = { n: 0, missed: 0, avoided: 0, neutral: 0, noData: 0, gainPct: 0, lossPct: 0 };
  for (const m of done) {
    const g = by[m.code] || (by[m.code] = { code: m.code, kind: m.kind, n: 0, missed: 0, avoided: 0, neutral: 0, noData: 0, sim: [] });
    if (m.outcome === 'NO_DATA') { g.noData++; tot.noData++; continue; }
    g.n++; tot.n++;
    if (m.outcome === 'MISSED_GAIN') { g.missed++; tot.missed++; } else if (m.outcome === 'AVOIDED_LOSS') { g.avoided++; tot.avoided++; } else { g.neutral++; tot.neutral++; }
    if (isNum(m.simPct)) { g.sim.push(m.simPct); if (m.simPct > 0) tot.gainPct += m.simPct; else tot.lossPct -= m.simPct; }
  }
  const rows = Object.values(by).map(g => {
    const avgSim = g.sim.length ? lr2(avg(g.sim)) : null;
    const verdict = g.n < NEAR_MISS_MIN_N || avgSim == null ? 'NOT_ENOUGH_DATA' : avgSim > 0 ? 'FILTER_COSTLY' : 'FILTER_HELPS';
    return { code: g.code, kind: g.kind, n: g.n, missed: g.missed, avoided: g.avoided, neutral: g.neutral, noData: g.noData, avgSimPct: avgSim, verdict };
  }).sort((a, b) => b.n - a.n || (a.code < b.code ? -1 : 1));
  return { ...tot, gainPct: lr2(tot.gainPct), lossPct: lr2(tot.lossPct), rows };
}

/* 12) Research-Priorität (0–100) */
function researchPriority(f) { const w = { impact: 0.25, evidence: 0.2, recency: 0.15, breadth: 0.1, certainty: 0.1, cheap: 0.1, safety: 0.1 }; return Math.round(100 * sum(Object.entries(w).map(([k, x]) => x * clamp(f[k] || 0, 0, 1)))); }

/* 13) Lern-Zustand: Defaults & Validierung beim Laden (beschädigte Teile → leere Defaults, kein Einfluss auf den Handel) */
const freshLearn = () => ({ v: LEARN_VERSION, records: [], followUps: [], falseSignals: [], lessons: [], timeline: [], reviews: [], calibration: null, drift: null, lossModel: null, lastRunAt: 0, lastModelN: 0, backfilled: false, corrupted: [], nearMiss: freshNearMiss(), qualityV: 1 });
const freshNearMiss = () => ({ open: [], done: [], skipped: 0 });
const freshResearch = () => ({ hypotheses: [], experiments: [], queue: [] });
const pickLearn = P => Object.fromEntries(LEARN_SETTING_KEYS.map(k => [k, P[k]]));
const freshModels = (params, now) => ({ seq: 1, champion: 'M-1', challenger: null, rules: emptyRules(), versions: [{ id: 'M-1', ts: now, status: 'BASELINE', params: params || {}, rules: emptyRules(), basedOn: null, change: null, applied: null, experimentId: null, hypothesisId: null, note: 'Baseline – Ausgangsparameter vor dem Lernen', shadow: null, live: null }] });
const LEARN_STORAGE_KEYS = ['learning', 'experiments', 'models', 'patterns'];
function sanitizeRules(r) {
  const o = emptyRules(); if (!r || typeof r !== 'object') return o;
  o.blocks = arr(r.blocks).filter(b => typeof b === 'string' && /^[\w-]{1,40}\|[A-Z_]{2,40}$/.test(b)).slice(0, 20);
  if (r.regimeScoreBump && typeof r.regimeScoreBump === 'object') for (const [t, v] of Object.entries(r.regimeScoreBump)) if (/^[A-Z_]{2,40}$/.test(t) && isNum(v)) o.regimeScoreBump[t] = clamp(Math.round(v), ...LEARN_BOUNDS.regimeScoreBump);
  o.volumeConfirmPct = isNum(r.volumeConfirmPct) ? clamp(r.volumeConfirmPct, ...LEARN_BOUNDS.volumeConfirmPct) : 0;
  o.blockPostPump = r.blockPostPump === true;
  o.blockDisc = [...new Set(arr(r.blockDisc).filter(c => DISC_BLOCKABLE.has(c)))];
  return o;
}
const objs = (a, max, ok = () => true) => arr(a).filter(x => x && typeof x === 'object' && ok(x)).slice(0, max);
function loadLearnParts(d) {
  const out = { learn: freshLearn(), research: freshResearch(), models: null, patterns: {} };
  const L = d && d.learn, R = d && d.research, M = d && d.models, P = d && d.patterns;
  if (L && typeof L === 'object') {
    const ol = out.learn;
    ol.records = objs(L.records, 1e4, r => typeof r.tradeId === 'string' && isNum(r.closedAt) && isNum(r.openedAt) && r.outcome && typeof r.outcome === 'object' && r.exit && r.execution && r.path).sort(byClose).slice(-LEARN_CAPS.records);
    for (const r of ol.records) { r.regimeTags = arr(r.regimeTags).filter(t => typeof t === 'string'); r.revisions = arr(r.revisions); }
    ol.followUps = objs(L.followUps, 20, f => typeof f.tradeId === 'string' && isNum(f.exitPrice) && f.exitPrice > 0 && isNum(f.until)).map(f => ({ ...f, samples: arr(f.samples).filter(Array.isArray) }));
    ol.falseSignals = objs(L.falseSignals, LEARN_CAPS.falseSignals, f => typeof f.tradeId === 'string');
    ol.lessons = objs(L.lessons, LEARN_CAPS.lessons, l => typeof l.id === 'string' && typeof l.text === 'string');
    ol.timeline = objs(L.timeline, LEARN_CAPS.timeline, e => isNum(e.ts) && typeof e.text === 'string');
    ol.reviews = objs(L.reviews, LEARN_CAPS.reviews, r => typeof r.id === 'string');
    for (const k of ['calibration', 'drift', 'lossModel']) ol[k] = L[k] && typeof L[k] === 'object' ? L[k] : null;
    if (ol.lossModel && ol.lossModel.w && !(Array.isArray(ol.lossModel.w) && ol.lossModel.w.length === LM_FEATS.length + 2 && ol.lossModel.w.every(isNum))) ol.lossModel = null;
    ol.lastRunAt = isNum(L.lastRunAt) ? L.lastRunAt : 0; ol.lastModelN = isNum(L.lastModelN) ? L.lastModelN : 0; ol.backfilled = L.backfilled === true;
    ol.qualityV = isNum(L.qualityV) ? L.qualityV : 0; // < 1: Datenqualität der vorhandenen Records noch nicht geprüft (Migration 2.12.0)
    const NM = L.nearMiss && typeof L.nearMiss === 'object' ? L.nearMiss : {}; // ab 2.7.0 – ältere Stände starten leer
    ol.nearMiss = {
      open: objs(NM.open, LEARN_CAPS.nearMissOpen, m => typeof m.tokenId === 'string' && typeof m.code === 'string' && isNum(m.ts) && isNum(m.price) && m.price > 0).map(m => ({ ...m, samples: arr(m.samples).filter(s => Array.isArray(s) && isNum(s[0]) && isNum(s[1])).slice(-60) })),
      done: objs(NM.done, LEARN_CAPS.nearMiss, m => typeof m.code === 'string' && isNum(m.ts) && typeof m.outcome === 'string'),
      skipped: isNum(NM.skipped) ? NM.skipped : 0
    };
  }
  if (R && typeof R === 'object') {
    out.research.hypotheses = objs(R.hypotheses, LEARN_CAPS.hypotheses, h => typeof h.id === 'string' && HYP_DEF[h.type] && h.change && typeof h.change === 'object').map(h => ({ ...h, experimentIds: arr(h.experimentIds), source: h.source && typeof h.source === 'object' ? h.source : {} }));
    out.research.experiments = objs(R.experiments, LEARN_CAPS.experiments, e => typeof e.id === 'string' && typeof e.decision === 'string');
    out.research.queue = objs(R.queue, LEARN_CAPS.queue, q => typeof q.id === 'string');
  }
  if (M && typeof M === 'object' && Array.isArray(M.versions)) {
    const versions = objs(M.versions, LEARN_CAPS.versions + 5, v => typeof v.id === 'string' && /^M-\d+$/.test(v.id) && v.params && typeof v.params === 'object').map(v => ({ ...v, rules: sanitizeRules(v.rules), prevRules: v.prevRules ? sanitizeRules(v.prevRules) : null, P: v.P ? { ...v.P, rules: sanitizeRules(v.P.rules) } : null, base: v.base ? { ...v.base, rules: sanitizeRules(v.base.rules) } : null }));
    if (versions.some(v => v.id === M.champion)) {
      out.models = { seq: Math.max(isNum(M.seq) ? M.seq : 1, ...versions.map(v => +v.id.slice(2))), champion: M.champion, challenger: versions.some(v => v.id === M.challenger && ['CHALLENGER', 'READY'].includes(v.status)) ? M.challenger : null, rules: sanitizeRules(M.rules), versions };
    }
  }
  if (P && typeof P === 'object') for (const [k, a] of Object.entries(P)) if (a && isNum(a.n) && a.dims && typeof a.dims === 'object' && Array.isArray(a.obs) && Object.keys(out.patterns).length < LEARN_CAPS.patterns) out.patterns[k] = a;
  return out;
}
