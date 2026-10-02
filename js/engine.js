/* Smart Lab – engine.js
   Analyse: Engines · Strategien & Konsens · Decision Engine · Stufen-Scores · Markt-Regime · Analytics · Backtest
   Klassisches Skript ohne Build-Schritt: alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in fester
   Reihenfolge geladen (index.html bzw. server/load-core.js): base → engine → learning → core → selftest → ui.
   base, engine, learning, core und selftest laufen auch ohne Browser (Node.js); nur ui.js braucht das DOM. */
'use strict';

/* ============================== ANALYSE-ENGINES ============================== */
function effectiveSnap(tok, now, S) {
  const staleMs = S.staleAfterSec * SEC;
  const p = tok.snap, a = tok.alt;
  const pAge = p ? now - p.fetchedAt : Infinity, aAge = a ? now - a.fetchedAt : Infinity;
  if (p && isNum(p.priceUsd) && pAge <= staleMs) return { snap: p, label: p.cached ? 'CACHED' : 'LIVE', age: pAge, fallback: false };
  if (a && isNum(a.priceUsd) && aAge <= staleMs) return { snap: a, label: 'FALLBACK', age: aAge, fallback: true };
  if (p) return { snap: p, label: pAge <= staleMs ? 'LIVE' : 'STALE', age: pAge, fallback: false };
  if (a) return { snap: a, label: 'STALE', age: aAge, fallback: true };
  return { snap: null, label: 'UNKNOWN', age: null, fallback: false };
}
function histAgo(hist, now, agoMs, tolMs) {
  const target = now - agoMs; let best = null, bd = Infinity;
  for (let i = hist.length - 1; i >= 0; i--) {
    const d = Math.abs(hist[i].t - target);
    if (d < bd) { bd = d; best = hist[i]; }
    if (hist[i].t < target - tolMs) break;
  }
  return best && bd <= tolMs ? best : null;
}
function ageClass(ms) { if (!isNum(ms)) return 'UNKNOWN'; if (ms < HOUR) return 'NEW'; if (ms < DAY) return 'EARLY'; if (ms < 7 * DAY) return 'ESTABLISHED'; return 'MATURE'; }
const W_RISK = { liquidity: 0.15, holder: 0.1, creator: 0.05, contract: 0.2, marketStructure: 0.12, volumeAnomaly: 0.08, sellPressure: 0.1, dataReliability: 0.1, execution: 0.1 };
const W_SCORE = { market: 0.08, momentum: 0.16, liquidity: 0.14, volume: 0.12, holders: 0.06, security: 0.14, trend: 0.12, data: 0.1, execution: 0.08 };
const RISK_NAMES = { liquidity: 'Liquidity Risk', holder: 'Holder Risk', creator: 'Creator Risk', contract: 'Contract Risk', marketStructure: 'Market Structure Risk', volumeAnomaly: 'Volume Anomaly Risk', sellPressure: 'Sell Pressure Risk', dataReliability: 'Data Reliability Risk', execution: 'Execution Risk' };
const COMP_NAMES = { market: 'MARKET', momentum: 'MOMENTUM', liquidity: 'LIQUIDITY', volume: 'VOLUME', trend: 'TREND', security: 'SECURITY', holders: 'HOLDERS', data: 'DATA QUALITY', execution: 'EXECUTION' };
/* Kontext-Signale beschreiben den Markt, sind aber allein kein Kaufsignal. */
const CONTEXT_SIGNALS = new Set(['VOLATILITY_EXPANSION', 'VOLATILITY_COMPRESSION', 'WHALE_ACTIVITY']);
const SIGNAL_NAMES = { MOMENTUM: 'Momentum', BREAKOUT: 'Breakout', VOLUME_EXPANSION: 'Volume Expansion', LIQUIDITY_GROWTH: 'Liquidity Growth', BUYER_DOMINANCE: 'Buyer Dominance', TREND_CONTINUATION: 'Trend Continuation', RECOVERY: 'Recovery', MEAN_REVERSION: 'Mean Reversion', VOLATILITY_EXPANSION: 'Volatility Expansion', VOLATILITY_COMPRESSION: 'Volatility Compression', WHALE_ACTIVITY: 'Whale Activity', NEW_PAIR_MOMENTUM: 'New Pair Momentum', PULLBACK: 'Pullback' };

/* Vollanalyse eines Tokens. Rein funktional: nutzt nur übergebene, reale Daten. Kein Math.random. */
function analyzeToken(tok, ctx) {
  const { now, S } = ctx;
  const es = effectiveSnap(tok, now, S);
  const s = es.snap;
  const A = { ts: now, label: es.label, dataAge: es.age, fallback: es.fallback, stale: es.label === 'STALE' || es.label === 'UNKNOWN', unknowns: [], tags: [], flags: [] };
  const price = s && isNum(s.priceUsd) ? s.priceUsd : null;
  const liq = s ? s.liquidityUsd : null;
  const mc = s ? (s.marketCap != null ? s.marketCap : s.fdv) : null;
  const v = s ? s.vol : {}, ch = s ? s.chg : {};
  const t5 = s && s.txns ? s.txns.m5 : null, t1 = s && s.txns ? s.txns.h1 : null;
  const hist = tok.hist || [];
  const prices = hist.map(x => x.p);
  const pairAge = s && isNum(s.pairCreatedAt) ? now - s.pairCreatedAt : null;
  A.core = { price, priceRaw: s ? s.priceRaw : null, liq, mc, fdv: s ? s.fdv : null, pairAge, source: s ? s.source : null, dexId: s ? s.dexId : null, pairAddress: (s && s.pairAddress) || (tok.snap && tok.snap.pairAddress) || (tok.alt && tok.alt.pairAddress) || null, fetchedAt: s ? s.fetchedAt : null };

  /* --- Liquidity Engine --- */
  const h1m = histAgo(hist, now, MIN, 30 * SEC), h5 = histAgo(hist, now, 5 * MIN, 90 * SEC), h15 = histAgo(hist, now, 15 * MIN, 3 * MIN);
  const chgOf = (a, b) => (isNum(a) && isNum(b) && b > 0 ? (a / b - 1) * 100 : null);
  const ratioMc = isNum(liq) && isNum(mc) && mc > 0 ? liq / mc : null;
  const plannedSize = ctx.plannedSizeUsd || 0;
  const impactPlanned = isNum(liq) && liq > 0 && plannedSize > 0 ? plannedSize / (liq / 2 + plannedSize) * 100 : null;
  A.liq = {
    usd: liq, ratioMc, chg5: h5 ? chgOf(liq, h5.liq) : null, chg15: h15 ? chgOf(liq, h15.liq) : null,
    exitLiqUsd: isNum(liq) ? liq / 2 : null, impactPlanned,
    slipRisk: impactPlanned == null ? 'UNKNOWN' : impactPlanned < 1 ? 'LOW' : impactPlanned < S.maxSlippagePct ? 'MODERATE' : 'HIGH'
  };
  A.liq.shock = A.liq.chg5 != null && A.liq.chg5 <= -20;
  A.liq.spike = A.liq.chg5 != null && A.liq.chg5 >= 50;

  /* --- Price Engine --- */
  const recent = hist.filter(x => now - x.t <= 30 * MIN);
  const hi = recent.length ? Math.max(...recent.map(x => x.p)) : null;
  const lo = recent.length ? Math.min(...recent.map(x => x.p)) : null;
  const rets = logReturns(prices.slice(-80));
  const volMeasured = rets.length >= 10 ? stdev(rets) * Math.sqrt(12) * 100 : null;
  const volPct = volMeasured != null ? volMeasured : isNum(ch.m5) ? Math.abs(ch.m5) / Math.sqrt(5) : null;
  const m1 = h1m && price ? chgOf(price, h1m.p) : null;
  const m15 = isNum(ch.m15) ? ch.m15 : h15 && price ? chgOf(price, h15.p) : null;
  const emaF = prices.length >= 12 ? ema(prices, 12) : null, emaS = prices.length >= 36 ? ema(prices, 36) : null;
  let mom = 50;
  if (isNum(ch.m5)) mom += clamp(ch.m5 * 2.5, -30, 30); else A.unknowns.push('Preisänderung 5m');
  if (isNum(ch.h1)) mom += clamp(ch.h1 * 0.4, -20, 20);
  if (isNum(m1)) mom += clamp(m1 * 3, -10, 10);
  let tr = 50;
  if (isNum(ch.h1)) tr += ch.h1 > 0 ? 12 : -12;
  if (isNum(ch.h6)) tr += ch.h6 > 0 ? 10 : -10;
  if (isNum(ch.h24)) tr += ch.h24 > 0 ? 6 : -6;
  if (emaF != null && emaS != null) tr += emaF > emaS ? 15 : -15;
  A.price = {
    p: price, chg: { m1, m5: num(ch.m5), m15, h1: num(ch.h1), h6: num(ch.h6), h24: num(ch.h24) }, high: hi, low: lo,
    volPct, volLabel: volMeasured != null ? 'LIVE' : volPct != null ? 'ESTIMATED' : 'UNKNOWN',
    drawdown: hi && price ? chgOf(price, hi) : null, recovery: lo && price ? chgOf(price, lo) : null,
    emaF, emaS, momentum: Math.round(clamp(mom, 0, 100)), trend: Math.round(clamp(tr, 0, 100)),
    stability: volPct != null ? Math.round(clamp(100 - volPct * 8, 0, 100)) : null, points: prices.length
  };

  /* --- Volume Engine --- */
  const runRate5 = isNum(v.m5) && isNum(v.h1) && v.h1 > 0 ? (v.m5 * 12) / v.h1 : null;
  const turnover = isNum(v.h1) && isNum(liq) && liq > 0 ? v.h1 / liq : null;
  const anomalies = [];
  if (runRate5 != null && runRate5 > 2 && isNum(ch.m5) && Math.abs(ch.m5) < 1) anomalies.push('Volumen ohne Preisbestätigung');
  if (isNum(ch.m5) && Math.abs(ch.m5) > 10 && isNum(v.m5) && isNum(liq) && v.m5 < liq * 0.01) anomalies.push('Preisbewegung ohne Volumen');
  if (turnover != null && turnover > 15) anomalies.push('Extremer Umschlag (Wash-Trading möglich)');
  A.vol = { m5: v.m5 != null ? v.m5 : null, m15: v.m15 != null ? v.m15 : null, h1: v.h1 != null ? v.h1 : null, h6: v.h6 != null ? v.h6 : null, h24: v.h24 != null ? v.h24 : null, runRate5, turnover, buyVolume: null, sellVolume: null, anomalies };

  /* --- Transaktions-Engine --- */
  const b5 = t5 ? t5.b : null, s5 = t5 ? t5.s : null, b1 = t1 ? t1.b : null, s1 = t1 ? t1.s : null;
  const n5 = b5 != null && s5 != null ? b5 + s5 : null, n1 = b1 != null && s1 != null ? b1 + s1 : null;
  const avgTrade5 = n5 && isNum(v.m5) ? v.m5 / n5 : null;
  A.tx = {
    b5, s5, b1, s1, n5, n1, ratio5: n5 ? b5 / n5 : null, ratio1: n1 ? b1 / n1 : null,
    perMin5: n5 != null ? n5 / 5 : null, perMin1: n1 != null ? n1 / 60 : null,
    accel: n5 != null && n1 ? (n5 / 5) / (n1 / 60) : null, avgTrade5,
    whaleRel: avgTrade5 != null && isNum(liq) && liq > 0 ? avgTrade5 / liq * 100 : null,
    micro: avgTrade5 != null && avgTrade5 < 15 && n5 > 50
  };
  if (n1 == null) A.unknowns.push('Transaktionen 1h');

  /* --- Security / Holder (aus Security Engine) --- */
  const sec = tok.sec || null;
  const secAge = sec ? now - sec.checkedAt : null;
  const secStale = sec ? secAge > S.securityTtlMin * MIN : false;
  A.sec = { status: sec ? sec.status : 'UNKNOWN', stale: secStale, age: secAge, pending: !!tok.secPending, flags: sec ? sec.flags : [], top10Pct: sec ? sec.top10Pct : null };
  if (!sec) A.unknowns.push('Security (Mint/Freeze Authority, RugCheck)');
  if (!sec || !isNum(sec.top10Pct)) A.unknowns.push('Holder-Konzentration');
  A.unknowns.push('Creator-Holdings', 'Buy-/Sell-Volumen (nur Transaktionszahlen verfügbar)', 'Social/Sentiment (keine Datenquelle)');

  /* --- Technische Analyse (OHLCV wenn frisch, sonst eigene Live-Samples) --- */
  const oh = tok.ohlcv && tok.ohlcv['1m'];
  if (oh && oh.candles.length >= 30 && now - oh.fetchedAt < 3 * MIN) {
    const cl = oh.candles.map(c => c.c); const a14 = atr(oh.candles, 14);
    A.ta = { source: 'OHLCV 1m (GeckoTerminal)', label: 'LIVE', ema9: ema(cl, 9), ema21: ema(cl, 21), sma20: sma(cl, 20), rsi: rsi(cl, 14), atr: a14, atrPct: a14 && cl[cl.length - 1] ? a14 / cl[cl.length - 1] * 100 : null, roc: roc(cl, 10), vwap: vwap(oh.candles.slice(-60)) };
  } else if (prices.length >= 15) {
    A.ta = { source: 'Live-Samples (~5s)', label: 'ESTIMATED', ema9: ema(prices, 9), ema21: prices.length >= 21 ? ema(prices, 21) : null, sma20: prices.length >= 20 ? sma(prices, 20) : null, rsi: rsi(prices, 14), atr: null, atrPct: null, roc: roc(prices, 10), vwap: null };
  } else A.ta = null;

  /* --- Pump-/Manipulation-Detector (Pump ist nie automatisch ein Buy) --- */
  const pf = [];
  if (isNum(ch.m5) && ch.m5 >= 40) pf.push(`Vertikaler Anstieg (${fmtPct(ch.m5, 0)} in 5m)`);
  if (isNum(ch.h1) && ch.h1 >= 300) pf.push(`Extremer 1h-Anstieg (${fmtPct(ch.h1, 0)})`);
  if (A.tx.ratio5 != null && n5 >= 30 && A.tx.ratio5 >= 0.9) pf.push('Extremes Kauf/Verkauf-Verhältnis');
  if (runRate5 != null && runRate5 >= 5) pf.push('Volume Spike (≥5× Stundenschnitt)');
  if (A.liq.spike) pf.push('Liquiditäts-Spike (+50 % in 5m)');
  if (A.tx.whaleRel != null && A.tx.whaleRel >= 2) pf.push('Whale-dominierte Bewegung');
  A.pump = { flags: pf, score: clamp(pf.length * 25, 0, 100), detected: pf.length >= 2 || (isNum(ch.m5) && ch.m5 >= 60) };

  /* --- Data Conflict Engine (nur gleicher Pool, vergleichbare Zeitpunkte) --- */
  const conflicts = []; const prim = tok.snap, alt = tok.alt;
  A.crossChecked = false;
  if (prim && alt && Math.abs(prim.fetchedAt - alt.fetchedAt) <= 90 * SEC && prim.pairAddress && prim.pairAddress === alt.pairAddress) {
    A.crossChecked = true;
    if (isNum(prim.priceUsd) && isNum(alt.priceUsd)) { const d = Math.abs(prim.priceUsd / alt.priceUsd - 1) * 100; A.crossPriceDiff = d; if (d > 5) conflicts.push({ field: 'Preis', a: prim.priceUsd, b: alt.priceUsd, diffPct: d }); }
    if (isNum(prim.liquidityUsd) && isNum(alt.liquidityUsd) && alt.liquidityUsd > 0) { const d = Math.abs(prim.liquidityUsd / alt.liquidityUsd - 1) * 100; if (d > 35) conflicts.push({ field: 'Liquidität', a: prim.liquidityUsd, b: alt.liquidityUsd, diffPct: d }); }
  }
  A.conflicts = conflicts;

  /* --- Data Confidence Engine --- */
  const fresh = es.label === 'LIVE' || es.label === 'CACHED';
  const C = {};
  C.price = !price ? 0 : !fresh ? (es.label === 'FALLBACK' ? 45 : 12) : 68 + (A.crossChecked ? (conflicts.some(c => c.field === 'Preis') ? -40 : 27) : 12);
  C.liquidity = !isNum(liq) ? 0 : !fresh ? 12 : 70 + (A.crossChecked && !conflicts.some(c => c.field === 'Liquidität') ? 20 : 8) - (A.liq.spike ? 30 : 0);
  C.volume = !isNum(v.h1) ? 0 : !fresh ? 12 : 62 + (n5 != null ? 20 : 0) - (isNum(v.m5) && v.m5 > 0 && n5 === 0 ? 30 : 0) - anomalies.length * 10;
  C.security = !sec ? 0 : Math.round(({ VERIFIED: 92, PARTIAL: 58, CRITICAL: 88, UNKNOWN: 5 }[sec.status] || 0) * (secStale ? 0.5 : 1));
  C.market = clamp(prices.length * 3, 0, 100);
  C.onchain = sec && sec.sources.rpc ? (sec.sources.holders ? 90 : 72) : 0;
  C.social = null;
  for (const k of Object.keys(C)) if (C[k] != null) C[k] = Math.round(clamp(C[k], 0, 100));
  let ctot = 0.25 * C.price + 0.2 * C.liquidity + 0.15 * C.volume + 0.2 * C.security + 0.1 * C.market + 0.1 * C.onchain;
  if (es.fallback) ctot *= 0.7;
  C.total = Math.round(clamp(ctot, 0, 100));
  A.confidence = C;

  /* --- Rug-/Scam-Filter: getrennte Risk Factors --- */
  const R = {};
  R.liquidity = !isNum(liq) ? null : Math.max(liq < S.minLiq ? 90 : liq < S.minLiq * 2 ? 55 : 25, ratioMc != null ? (ratioMc < 0.03 ? 80 : ratioMc < 0.06 ? 50 : 20) : 40, A.liq.shock ? 90 : 0);
  R.holder = sec && isNum(sec.top10Pct) ? Math.round(clamp(sec.top10Pct * 1.1, 5, 100)) : null;
  R.creator = null;
  R.contract = !sec || sec.status === 'UNKNOWN' ? null : sec.status === 'CRITICAL' ? 100 : Math.round(clamp((sec.status === 'VERIFIED' ? 10 : 30) + sec.flags.filter(x => x.level === 'HIGH').length * 25 + sec.flags.filter(x => x.level === 'WARN').length * 8, 0, 100));
  R.marketStructure = Math.round(clamp(Math.max(A.pump.score, isNum(ch.h1) && ch.h1 < -30 ? 70 : 0, volPct != null ? clamp((volPct - 3) * 8, 0, 80) : 30), 0, 100));
  R.volumeAnomaly = Math.round(clamp(anomalies.length * 30 + (A.tx.micro ? 20 : 0), 0, 100));
  R.sellPressure = A.tx.ratio1 == null ? null : n1 >= 20 && A.tx.ratio1 < 0.4 ? 80 : A.tx.ratio1 < 0.5 ? 55 : A.tx.ratio5 != null && A.tx.ratio5 < 0.4 && n5 >= 10 ? 60 : 20;
  R.dataReliability = 100 - C.total;
  R.execution = impactPlanned == null ? null : Math.round(clamp(impactPlanned / S.maxSlippagePct * 70, 0, 100));
  let wsum = 0; const known = [];
  for (const [k, w] of Object.entries(W_RISK)) { const val = R[k]; if (val == null) { wsum += w * 50; A.unknowns.push(RISK_NAMES[k] + ' (keine Daten)'); } else { wsum += w * val; known.push(val); } }
  const rTotal = Math.round(clamp(0.65 * wsum + 0.35 * (known.length ? Math.max(...known) : 50), 0, 100));
  let level;
  if (C.total < 30) level = 'UNKNOWN';
  else if ((sec && sec.status === 'CRITICAL') || rTotal >= 75) level = 'CRITICAL';
  else if (rTotal >= 55) level = 'HIGH';
  else if (rTotal >= 30) level = 'MODERATE';
  else level = 'LOW';
  A.risk = { factors: R, total: rTotal, level };

  /* --- Signal Engine (modular, jedes Signal mit Strength/Confidence/Timestamp/Reason) --- */
  const sig = []; const addSig = (type, strength, conf, reason) => sig.push({ type, strength: Math.round(clamp(strength, 0, 100)), confidence: Math.round(clamp(conf, 0, 100)), ts: now, reason });
  const r5 = A.tx.ratio5;
  if (isNum(ch.m5) && ch.m5 >= 3 && (ch.h1 == null || ch.h1 >= 0)) addSig('MOMENTUM', ch.m5 * 5 + (ch.h1 || 0) * 0.3, C.price, `5m ${fmtPct(ch.m5)}, 1h ${fmtPct(ch.h1)}`);
  if (prices.length >= 24 && price) { const prevHigh = Math.max(...prices.slice(-24, -1)); if (price > prevHigh * 1.01 && (runRate5 == null || runRate5 >= 1.2)) addSig('BREAKOUT', 30 + (price / prevHigh - 1) * 1000, Math.min(C.price, C.market), `Preis ${fmtPct((price / prevHigh - 1) * 100)} über lokalem Hoch (${prices.length} Samples)`); }
  if (runRate5 != null && runRate5 >= 1.5 && (ch.m5 || 0) > 0) addSig('VOLUME_EXPANSION', (runRate5 - 1) * 40, C.volume, `5m-Volumen ${runRate5.toFixed(1)}× Stundenschnitt`);
  const lg = A.liq.chg15 != null ? A.liq.chg15 : A.liq.chg5;
  if (lg != null && lg >= 10 && (ch.m5 == null || ch.m5 >= -2)) addSig('LIQUIDITY_GROWTH', lg * 3, C.liquidity, `Liquidität ${fmtPct(lg)} (${A.liq.chg15 != null ? '15m' : '5m'})`);
  if (r5 != null && n5 >= 20 && r5 >= 0.6) addSig('BUYER_DOMINANCE', (r5 - 0.5) * 250, C.volume, `Käufer ${(r5 * 100).toFixed(0)} % von ${n5} Trades (5m)`);
  if (isNum(ch.h1) && isNum(ch.h6) && ch.h1 > 0 && ch.h6 > 0 && (ch.m5 == null || ch.m5 >= 0) && (emaF == null || emaS == null || emaF > emaS)) addSig('TREND_CONTINUATION', 20 + ch.h1 * 0.5 + (emaF != null && emaS != null ? 20 : 0), C.price, `1h ${fmtPct(ch.h1)}, 6h ${fmtPct(ch.h6)}${emaF != null && emaS != null ? ', EMA steigend' : ''}`);
  if (isNum(ch.h1) && ch.h1 <= -10 && isNum(ch.m5) && ch.m5 >= 3 && r5 != null && r5 >= 0.55) addSig('RECOVERY', ch.m5 * 6, C.price, `Erholung: 1h ${fmtPct(ch.h1)}, 5m ${fmtPct(ch.m5)}`);
  if (emaS != null && price && price < emaS * 0.88 && r5 != null && r5 >= 0.55) addSig('MEAN_REVERSION', (1 - price / emaS) * 300, Math.min(C.price, C.market), `Preis ${fmtPct((price / emaS - 1) * 100)} unter EMA36`);
  if (rets.length >= 40) {
    const sShort = stdev(rets.slice(-10)), sLong = stdev(rets.slice(-40));
    if (sShort != null && sLong) {
      if (sShort > sLong * 1.8) addSig('VOLATILITY_EXPANSION', (sShort / sLong - 1) * 50, C.market, `Volatilität ${(sShort / sLong).toFixed(1)}× Durchschnitt`);
      else if (sShort < sLong * 0.5) addSig('VOLATILITY_COMPRESSION', (1 - sShort / sLong) * 100, C.market, `Volatilität ${(sShort / sLong).toFixed(2)}× Durchschnitt`);
    }
  }
  if (A.tx.whaleRel != null && A.tx.whaleRel >= 0.5) addSig('WHALE_ACTIVITY', A.tx.whaleRel * 40, C.volume, `Ø Trade ${fmtUsd(avgTrade5)} = ${A.tx.whaleRel.toFixed(2)} % der Liquidität`);
  if (pairAge != null && pairAge < HOUR && r5 != null && r5 >= 0.6 && runRate5 != null && runRate5 >= 1.2) addSig('NEW_PAIR_MOMENTUM', 40 + (r5 - 0.6) * 150, Math.min(C.volume, 60), `Pair ${fmtAge(pairAge)} alt, Käufer ${(r5 * 100).toFixed(0)} %`);
  if (emaF != null && emaS != null && emaF > emaS && A.price.drawdown != null && A.price.drawdown <= -4 && A.price.drawdown >= -15) {
    const rs = rsi(prices, 14); if (rs != null && rs >= 38 && rs <= 55) addSig('PULLBACK', 40 + Math.abs(A.price.drawdown) * 2, Math.min(C.price, C.market), `Rücksetzer ${fmtPct(A.price.drawdown)} im Aufwärtstrend, RSI ${rs.toFixed(0)}`);
  }
  applySignalDecay(tok, sig, now);
  A.signals = sig;

  /* --- Komponenten-Scores (Scorecard) --- */
  const comp = {};
  comp.market = !isNum(mc) ? 30 : mc < S.minMcap || mc > S.maxMcap ? 25 : 65 + (['EARLY', 'ESTABLISHED'].includes(ageClass(pairAge)) ? 10 : 0);
  comp.momentum = A.pump.detected ? Math.min(A.price.momentum, 40) : A.price.momentum;
  comp.liquidity = !isNum(liq) ? 0 : clamp(Math.log10(liq / Math.max(S.minLiq, 1) + 1) * 60 + (ratioMc == null ? 0 : ratioMc >= 0.1 ? 25 : ratioMc >= 0.05 ? 10 : ratioMc < 0.03 ? -30 : 0), 0, 100);
  comp.volume = turnover == null ? 0 : turnover > 15 ? 40 : turnover >= 0.5 ? 70 + clamp((A.tx.ratio1 || 0.5) - 0.5, 0, 0.3) * 100 : turnover >= 0.1 ? 45 : 20;
  comp.holders = sec && isNum(sec.top10Pct) ? clamp(100 - sec.top10Pct, 0, 100) : 40;
  comp.security = !sec ? 0 : sec.status === 'VERIFIED' ? (sec.flags.some(x => x.level === 'HIGH') ? 55 : 90) : sec.status === 'PARTIAL' ? (sec.flags.some(x => x.level === 'HIGH') ? 40 : 65) : 0;
  comp.trend = A.price.trend;
  comp.data = C.total;
  comp.execution = impactPlanned == null ? 30 : clamp(100 - impactPlanned / S.maxSlippagePct * 100, 0, 100);
  for (const k of Object.keys(comp)) comp[k] = Math.round(comp[k]);
  A.components = comp;
  let fs = 0; for (const [k, w] of Object.entries(W_SCORE)) fs += w * comp[k];
  const penalty = Math.max(0, rTotal - 40) * 0.6 + (A.pump.detected ? 15 : 0);
  A.finalScore = Math.round(clamp(fs - penalty, 0, 100));
  const buySig = sig.filter(x => !CONTEXT_SIGNALS.has(x.type));
  const topSig = buySig.length ? Math.max(...buySig.map(x => x.strength)) : 0;
  A.opportunity = Math.round(clamp(0.3 * comp.momentum + 0.25 * comp.volume + 0.25 * comp.trend + 0.2 * topSig, 0, 100));
  A.executionScore = comp.execution;

  /* --- Klassifizierung, Tags, Flags --- */
  A.ageClass = ageClass(pairAge);
  if (volPct != null && volPct >= 6) A.tags.push('HIGH_VOLATILITY'); else if (volPct != null && volPct < 1.5) A.tags.push('LOW_VOLATILITY');
  if (isNum(ch.h1) && Math.abs(ch.h1) >= 15 && isNum(ch.h6) && Math.sign(ch.h1) === Math.sign(ch.h6)) A.tags.push('TRENDING');
  if (isNum(liq) && liq < S.minLiq) A.tags.push('LOW_LIQUIDITY');
  if (A.ageClass === 'NEW') A.tags.push('NEW_PAIR');
  if (sig.some(x => x.type === 'BREAKOUT')) A.tags.push('BREAKOUT');
  if (sig.some(x => x.type === 'RECOVERY')) A.tags.push('RECOVERY');
  if (A.pump.detected) A.tags.push('PUMP');
  if (isNum(pairAge) && pairAge < 15 * MIN) A.flags.push('BRANDNEU');
  if (ratioMc != null && ratioMc < 0.03) A.flags.push('DÜNNE LIQ');
  if (n1 >= 20 && A.tx.ratio1 < 0.4) A.flags.push('VERKÄUFER');
  if (isNum(ch.h1) && ch.h1 < -30) A.flags.push('DUMP');
  if (A.pump.detected) A.flags.push('PUMP');
  if (tok.meta && tok.meta.boostedAt) A.flags.push('BOOST');
  A.labels = {
    price: price ? es.label : 'UNKNOWN', liquidity: isNum(liq) ? es.label : 'UNKNOWN', volume: isNum(v.h1) ? es.label : 'UNKNOWN',
    security: !sec ? 'UNKNOWN' : secStale ? 'STALE' : 'LIVE', holders: sec && isNum(sec.top10Pct) ? (secStale ? 'STALE' : 'LIVE') : 'UNKNOWN', social: 'UNKNOWN'
  };
  A.unknowns = [...new Set(A.unknowns)];
  A.mtf = mtfAlignment(A);
  A.sigConflicts = signalConflicts(A);
  return A;
}
/* Signal-Decay (seit 2.4.0): ereignisartige Signale (Breakout, Volumen-/Liquiditätsschub, Whale, Recovery,
   New-Pair-Momentum) verlieren nach 5 min ununterbrochener Dauer Gewicht (bis min. 40 % nach 35 min).
   Verschwindet ein Signal, beginnt es beim nächsten Auftreten wieder frisch. */
const DECAY_SIGNALS = new Set(['BREAKOUT', 'VOLUME_EXPANSION', 'LIQUIDITY_GROWTH', 'WHALE_ACTIVITY', 'RECOVERY', 'NEW_PAIR_MOMENTUM']);
const DECAY_START_MS = 5 * MIN, DECAY_SPAN_MS = 30 * MIN, DECAY_FLOOR = 0.4;
function applySignalDecay(tok, sig, now) {
  const seen = tok.sigSeen || (tok.sigSeen = {}), active = new Set();
  for (const s of sig) {
    active.add(s.type);
    if (!isNum(seen[s.type])) seen[s.type] = now;
    s.since = seen[s.type];
    const age = now - s.since;
    if (DECAY_SIGNALS.has(s.type) && age > DECAY_START_MS) {
      const f = Math.max(DECAY_FLOOR, 1 - (age - DECAY_START_MS) / DECAY_SPAN_MS);
      s.rawStrength = s.strength; s.strength = Math.round(s.strength * f); s.decay = Math.round(f * 100) / 100;
      s.reason += ` · abgeschwächt ×${s.decay.toFixed(2)} (seit ${fmtAge(age)} aktiv)`;
    }
  }
  for (const k of Object.keys(seen)) if (!active.has(k)) delete seen[k];
}
/* Multi-Timeframe-Abgleich: Richtung je Zeitfenster (5m / 1h / 6h / 24h) relativ zur 5m-Richtung. */
function mtfAlignment(A) {
  const ch = A.price.chg, dir = v => (!isNum(v) ? null : v > 1 ? 1 : v < -1 ? -1 : 0);
  const d = { m5: dir(ch.m5), h1: dir(ch.h1), h6: dir(ch.h6), h24: dir(ch.h24) };
  const known = Object.values(d).filter(x => x != null);
  if (d.m5 == null || known.length < 2) return { dirs: d, score: null, label: 'UNKNOWN' };
  const agree = known.filter(x => x === d.m5).length / known.length;
  return { dirs: d, score: Math.round(agree * 100), label: agree === 1 ? (d.m5 > 0 ? 'ALIGNED_UP' : d.m5 < 0 ? 'ALIGNED_DOWN' : 'FLAT') : agree >= 0.5 ? 'PARTIAL' : 'MIXED' };
}
/* Signal-Konflikt-Detektor: Kaufsignale, die anderen Messwerten widersprechen. HIGH zählt doppelt. */
const CONFLICT_DE = { MTF_DIVERGENCE: 'Zeitfenster widersprechen sich', MTF_DOWNTREND: 'gegen den Tagestrend', OVERBOUGHT: 'überkauft', VOLUME_NO_PRICE: 'Volumen ohne Preis', CONTRADICTORY: 'widersprüchliche Strategien', LIQ_DIVERGENCE: 'Liquidität fällt bei steigendem Preis', TREND_CONFLICT: 'Trend unbestätigt', SELL_PRESSURE: 'Verkäuferüberhang' };
function signalConflicts(A) {
  const out = [], has = t => A.signals.some(x => x.type === t), buy = A.signals.filter(x => !CONTEXT_SIGNALS.has(x.type)), ch = A.price.chg, ta = A.ta;
  const add = (code, severity, text) => out.push({ code, severity, text });
  if (!buy.length) return out;
  if (isNum(ch.m5) && ch.m5 > 0 && isNum(ch.h1) && ch.h1 <= -15) add('MTF_DIVERGENCE', 'HIGH', `Kaufsignal auf 5m (${fmtPct(ch.m5)}), aber 1h deutlich fallend (${fmtPct(ch.h1)})`);
  if (isNum(ch.h24) && ch.h24 <= -40 && isNum(ch.h1) && ch.h1 > 0) add('MTF_DOWNTREND', 'WARN', `24h ${fmtPct(ch.h24)} – kurzfristige Stärke gegen den Tagestrend`);
  if ((has('MOMENTUM') || has('BREAKOUT')) && ta && isNum(ta.rsi) && ta.rsi >= 80) add('OVERBOUGHT', 'HIGH', `RSI ${ta.rsi.toFixed(0)} – überkauft bei Momentum/Breakout`);
  if (has('VOLUME_EXPANSION') && isNum(ch.m5) && Math.abs(ch.m5) < 1) add('VOLUME_NO_PRICE', 'WARN', `Volumen-Anstieg ohne Preisbestätigung (5m ${fmtPct(ch.m5)})`);
  if (has('MEAN_REVERSION') && (has('MOMENTUM') || has('TREND_CONTINUATION'))) add('CONTRADICTORY', 'WARN', 'Mean Reversion und Momentum/Trend gleichzeitig – widersprüchliche Lesart');
  if (isNum(A.liq.chg5) && A.liq.chg5 <= -10 && isNum(ch.m5) && ch.m5 > 3) add('LIQ_DIVERGENCE', 'HIGH', `Preis steigt (${fmtPct(ch.m5)}), Liquidität fällt (${fmtPct(A.liq.chg5)})`);
  if (has('TREND_CONTINUATION') && ta && isNum(ta.ema9) && isNum(ta.ema21) && ta.ema9 < ta.ema21) add('TREND_CONFLICT', 'WARN', 'Trendsignal, aber EMA9 unter EMA21');
  if (A.tx.ratio5 != null && A.tx.n5 >= 10 && A.tx.ratio5 < 0.45) add('SELL_PRESSURE', 'WARN', `Kaufsignal bei Verkäuferüberhang (5m ${Math.round(A.tx.ratio5 * 100)} % Käufer)`);
  return out;
}
const conflictWeight = list => sum(arr(list).map(c => (c.severity === 'HIGH' ? 2 : 1)));
/* Score-Attribution: Final Score = 50 + Σ Gewicht × (Komponente − 50) − Risiko-/Pump-Abzug (vor Rundung/Begrenzung).
   Dazu: was die aktuelle Entscheidung kippen würde. */
function scoreAttribution(A, D, S) {
  if (!A || !D) return null;
  const items = Object.entries(W_SCORE).map(([k, w]) => ({ key: k, name: COMP_NAMES[k], value: A.components[k], weight: w, delta: Math.round(w * (A.components[k] - 50) * 10) / 10 }));
  const penRisk = Math.max(0, A.risk.total - 40) * 0.6, penPump = A.pump.detected ? 15 : 0, penalties = [];
  if (penRisk) penalties.push({ name: `Risiko ${A.risk.total} über 40`, delta: -Math.round(penRisk * 10) / 10 });
  if (penPump) penalties.push({ name: 'Pump erkannt', delta: -15 });
  const raw = 50 + sum(Object.entries(W_SCORE).map(([k, w]) => w * (A.components[k] - 50))) - penRisk - penPump;
  const flips = [], ok = D.decision === 'APPROVED' || D.decision === 'BUY_CANDIDATE';
  if (ok) {
    flips.push(`Score ${A.finalScore}, Grenze ${S.minScore} → Puffer ${A.finalScore - S.minScore} Punkte`);
    flips.push(`Data Confidence ${A.confidence.total}, Grenze ${S.minConfidence} → Puffer ${A.confidence.total - S.minConfidence}`);
    flips.push(`Risk ${A.risk.total}, Grenze ${S.maxRiskScore} → Puffer ${S.maxRiskScore - A.risk.total}`);
    if (isNum(A.liq.usd)) flips.push(`Liquidität ${fmtUsd(A.liq.usd)} – unter ${fmtUsd(S.minLiq)} wäre es NO TRADE`);
    if (isNum(A.sec.age)) flips.push(`Security-Daten gelten noch ${fmtAge(Math.max(0, S.securityTtlMin * MIN - A.sec.age))}, danach Neuprüfung`);
    flips.push('Jeder kritische Security-Befund (z. B. aktive Freeze Authority), Pump oder Datenkonflikt blockiert sofort – unabhängig vom Score');
  } else {
    for (const b of D.blockers.slice(0, 4)) flips.push(`Muss erfüllt sein: ${b.code} – ${b.msg}`);
    if (A.finalScore < S.minScore) flips.push(`Es fehlen ${S.minScore - A.finalScore} Score-Punkte bis zur Grenze ${S.minScore}`);
  }
  return { base: 50, items, pro: items.filter(x => x.delta > 0).sort((a, b) => b.delta - a.delta), contra: items.filter(x => x.delta < 0).sort((a, b) => a.delta - b.delta), penalties, raw: Math.round(raw * 10) / 10, finalScore: A.finalScore, flips };
}

/* ============================== STRATEGIEN & KONSENS ============================== */
function evalStrategies(A, strategies, S) {
  const has = t => A.signals.find(x => x.type === t);
  const rules = {
    momentum: () => { const m = has('MOMENTUM'), b = has('BUYER_DOMINANCE'); return m && b ? { strength: (m.strength + b.strength) / 2, why: 'Momentum + Käuferdominanz' } : null; },
    breakout: () => { const b = has('BREAKOUT'), v = has('VOLUME_EXPANSION'); return b && v ? { strength: (b.strength + v.strength) / 2, why: 'Breakout mit Volumenbestätigung' } : null; },
    volume: () => { const v = has('VOLUME_EXPANSION'); return v && (A.tx.ratio5 || 0) >= 0.55 && (A.price.chg.m5 || 0) > 0 ? { strength: v.strength, why: 'Volume Expansion, Preis & Käufer bestätigen' } : null; },
    liquidity: () => { const l = has('LIQUIDITY_GROWTH'); return l && (A.price.chg.m5 == null ? false : A.price.chg.m5 >= 0) ? { strength: l.strength, why: 'Liquidität wächst, Preis stabil' } : null; },
    pullback: () => { const p = has('PULLBACK'); return p ? { strength: p.strength, why: 'Pullback im Aufwärtstrend' } : null; },
    meanrev: () => { const m = has('MEAN_REVERSION'); return m ? { strength: m.strength, why: 'Mean Reversion unter EMA' } : null; },
    trend: () => { const t = has('TREND_CONTINUATION'); return t ? { strength: t.strength, why: 'Trendfortsetzung' } : null; }
  };
  const votes = [];
  for (const def of STRATEGY_DEFS) {
    const cfg = strategies[def.id];
    if (!cfg.enabled && !S.ffShadowMode) continue;
    const r = rules[def.id]();
    const reasons = []; let vote = 'NONE';
    if (r) {
      if (A.finalScore < cfg.minScore) reasons.push(`Score ${A.finalScore} < ${cfg.minScore}`);
      if (A.risk.total > cfg.riskLimit) reasons.push(`Risk ${A.risk.total} > ${cfg.riskLimit}`);
      if (!isNum(A.liq.usd) || A.liq.usd < cfg.minLiquidity) reasons.push(`Liquidität < ${fmtUsd(cfg.minLiquidity)}`);
      if (A.confidence.total < cfg.minConfidence) reasons.push(`Confidence ${A.confidence.total} < ${cfg.minConfidence}`);
      if (!reasons.length) vote = 'BUY';
    } else reasons.push('kein passendes Signal');
    votes.push({ id: def.id, name: def.name, enabled: cfg.enabled, shadow: !cfg.enabled, vote, strength: r ? Math.round(r.strength) : 0, weight: cfg.weight, why: r ? r.why : null, reasons });
  }
  const buy = votes.filter(x => x.enabled && x.vote === 'BUY');
  const weightSum = Math.round(sum(buy.map(x => x.weight)) * 100) / 100;
  const lead = [...buy].sort((a, b) => b.weight * b.strength - a.weight * a.strength)[0];
  return { votes, weightSum, consensus: buy.length > 0 && weightSum >= S.consensusMinWeight, lead: lead ? lead.id : null };
}

/* ============================== DECISION ENGINE ==============================
   Pipeline: DISCOVERY → BASIC → LIQUIDITY → SECURITY → MARKET STRUCTURE → SIGNALS → RISK → DECISION → EXECUTION CHECK → TRADE
   Ein hoher Score überstimmt niemals harte Sicherheitsregeln. NO TRADE ist eine vollwertige Entscheidung. */
const PIPELINE = ['DISCOVERY', 'BASIC_FILTER', 'LIQUIDITY_FILTER', 'SECURITY_FILTER', 'MARKET_STRUCTURE', 'SIGNAL_ENGINE', 'RISK_ENGINE', 'DECISION', 'EXECUTION_CHECK', 'TRADE'];
function decideToken(tok, A, ctx) {
  const S = ctx.S; const trace = []; const all = [];
  const stageRun = (name, fn) => { const B = []; const add = (c, m, x) => B.push(mkBlocker(c, m, x)); const detail = fn(add); trace.push({ stage: name, ok: B.length === 0, detail: B.length ? B.map(b => b.msg).join(' · ') : detail }); all.push(...B); return B.length === 0; };
  trace.push({ stage: 'DISCOVERY', ok: true, detail: 'Quelle: ' + ((tok.meta && tok.meta.via && tok.meta.via.join(', ')) || '—') });
  const basicOk = stageRun('BASIC_FILTER', add => {
    if (!isNum(A.core.price)) add('PRICE_MISSING', 'Kein gültiger Preis vorhanden');
    if (A.stale) add('DATA_STALE', `Marktdaten veraltet (${A.dataAge == null ? 'keine' : fmtAge(A.dataAge)})`);
    if (!isNum(A.core.mc)) add('MCAP_RANGE', 'MC (Market Cap) unbekannt');
    else if (A.core.mc < S.minMcap || A.core.mc > S.maxMcap) add('MCAP_RANGE', `${fmtMc(A.core.mc)} außerhalb ${fmtMc(S.minMcap)} bis ${fmtMc(S.maxMcap)}`);
    if (!isNum(A.vol.h1) || A.vol.h1 < S.minVol1h) add('LOW_VOLUME', `Vol 1h ${fmtUsd(A.vol.h1)} < ${fmtUsd(S.minVol1h)}`);
    if (A.tx.ratio1 == null || A.tx.ratio1 < S.minBuyRatio) add('BUYER_RATIO', `Käufer 1h ${A.tx.ratio1 == null ? '—' : (A.tx.ratio1 * 100).toFixed(0) + ' %'} < ${(S.minBuyRatio * 100).toFixed(0)} %`);
    if (S.minPairAgeMin > 0 && (A.core.pairAge == null || A.core.pairAge < S.minPairAgeMin * MIN)) add('PAIR_TOO_NEW', A.core.pairAge == null ? 'Pair-Alter unbekannt' : `Pair erst ${fmtAge(A.core.pairAge)} alt (< ${S.minPairAgeMin} min)`);
    return 'Coin-Preis, Frische, MC, Volumen, Käuferanteil ok';
  });
  const liqOk = stageRun('LIQUIDITY_FILTER', add => {
    if (!isNum(A.liq.usd) || A.liq.usd < S.minLiq) add('LOW_LIQUIDITY', `Liquidität ${fmtUsd(A.liq.usd)} < ${fmtUsd(S.minLiq)}`);
    if (A.liq.ratioMc != null && A.liq.ratioMc < 0.03) add('THIN_LIQUIDITY', `Liquidität/MC nur ${(A.liq.ratioMc * 100).toFixed(1)} %`);
    if (A.liq.shock) add('LIQUIDITY_SHOCK', `Liquidität ${fmtPct(A.liq.chg5)} in 5m`);
    return `Liquidität ${fmtUsd(A.liq.usd)}, Verhältnis ${A.liq.ratioMc == null ? '—' : (A.liq.ratioMc * 100).toFixed(1) + ' %'}`;
  });
  const fastPass = basicOk && liqOk;
  const secOk = stageRun('SECURITY_FILTER', add => {
    const st = A.sec.status;
    if (st === 'CRITICAL') add('SECURITY_CRITICAL', (A.sec.flags.find(x => x.level === 'CRITICAL') || {}).msg || 'Kritisches Sicherheitsrisiko');
    else if (st === 'UNKNOWN') add('SECURITY_UNKNOWN', A.sec.pending ? 'Sicherheitsprüfung läuft …' : fastPass ? 'Sicherheitsprüfung ausstehend' : 'Nicht geprüft (Schnellfilter nicht bestanden)');
    else if (st === 'PARTIAL' && S.requireVerifiedSecurity) add('SECURITY_UNVERIFIED', 'Nur eine Sicherheitsquelle verfügbar (PARTIAL)');
    if (A.sec.stale) add('SECURITY_STALE', `Security-Daten ${fmtAge(A.sec.age)} alt`);
    return 'Security ' + st;
  });
  stageRun('MARKET_STRUCTURE', add => {
    if (A.pump.detected) add('PUMP_DETECTED', A.pump.flags.join(', '));
    const pc = A.conflicts.find(c => c.field === 'Preis');
    if (pc) add('DATA_CONFLICT', `Preis weicht ${pc.diffPct.toFixed(1)} % zwischen DexScreener und GeckoTerminal ab`);
    if (A.fallback) add('DATA_FALLBACK', 'Primärquelle nicht aktuell – nur GeckoTerminal-Fallback');
    return A.tags.length ? A.tags.join(', ') : 'unauffällig';
  });
  stageRun('SIGNAL_ENGINE', add => {
    if (!A.signals.some(x => !CONTEXT_SIGNALS.has(x.type))) add('NO_SIGNAL', 'Keine Kaufsignale (nur Kontext-Signale)');
    if (S.signalConflictBlock && conflictWeight(A.sigConflicts) >= 3) add('SIGNAL_CONFLICT', A.sigConflicts.map(c => c.text).join(' · '));
    return A.signals.map(x => SIGNAL_NAMES[x.type] + ' ' + x.strength).join(', ');
  });
  stageRun('RISK_ENGINE', add => {
    if (A.risk.level === 'CRITICAL' || A.risk.total > S.maxRiskScore) add('RISK_TOO_HIGH', `Risk ${A.risk.total} (${A.risk.level}) > ${S.maxRiskScore}`);
    if (A.confidence.total < S.minConfidence) add('CONFIDENCE_LOW', `Confidence ${A.confidence.total} < ${S.minConfidence}`);
    return `Risk ${A.risk.total} ${A.risk.level}, Confidence ${A.confidence.total}`;
  });
  const strat = evalStrategies(A, ctx.strategies, S);
  A.strat = strat;
  stageRun('DECISION', add => {
    if (A.finalScore < S.minScore) add('SCORE_TOO_LOW', `Final Score ${A.finalScore} < ${S.minScore}`);
    if (!strat.consensus) add('NO_CONSENSUS', `Konsens ${strat.weightSum} < ${S.consensusMinWeight}`);
    // Gelernte Regeln (nur nach Validierung + Shadow übernommen) – können Einstiege ausschließlich zusätzlich blockieren
    const R = ctx.rules, tags = arr(ctx.regime);
    if (R) {
      const bump = maxBump(R, tags);
      if (bump > 0 && A.finalScore < S.minScore + bump) add('LEARNED_RULE', `Gelernt: im Regime ${tags.filter(t => (R.regimeScoreBump[t] || 0) === bump).join('/')} Score ≥ ${S.minScore + bump} nötig (${A.finalScore})`);
      const blk = arr(R.blocks).find(b => { const [st, tg] = b.split('|'); return st === (strat.lead || 'manuell') && tags.includes(tg); });
      if (blk) add('LEARNED_RULE', `Gelernt: Strategie ${blk.split('|')[0]} im Regime ${blk.split('|')[1]} gesperrt`);
      if (R.volumeConfirmPct > 0 && A.signals.some(x => x.type === 'VOLUME_EXPANSION') && isNum(A.price.chg.m5) && A.price.chg.m5 < R.volumeConfirmPct) add('LEARNED_RULE', `Gelernt: Volume-Signal ohne Preisbestätigung (5m ${fmtPct(A.price.chg.m5)} < +${R.volumeConfirmPct} %)`);
      if (R.blockPostPump && ['PUMP', 'POST_PUMP'].includes(pumpStateOf({ pump: A.pump.detected, chg1h: A.price.chg.h1, chg5m: A.price.chg.m5 }))) add('LEARNED_RULE', 'Gelernt: kein Einstieg direkt nach Pump');
      const disc = discoveryOf(tok).primary;
      if (arr(R.blockDisc).includes(disc)) add('LEARNED_RULE', `Gelernt: Coins aus Quelle ${DISC_DE[disc]} meiden`);
    }
    return `Score ${A.finalScore}, Konsens ${strat.weightSum} (${strat.votes.filter(x => x.enabled && x.vote === 'BUY').map(x => x.name).join(', ')})`;
  });
  const analysisBlockers = sortBlockers(all);
  const ex = ctx.execCheck ? ctx.execCheck(tok, A, { auto: true, lead: strat.lead }) : { blockers: [], sizing: null };
  trace.push({ stage: 'EXECUTION_CHECK', ok: ex.blockers.length === 0, detail: ex.blockers.length ? ex.blockers.map(b => b.msg).join(' · ') : 'Portfolio, Limits, Cooldowns, Ausführung ok' + (ex.sizing ? ` · Größe ${fmtUsd(ex.sizing.size)}` : '') });
  let decision;
  if (!analysisBlockers.length && !ex.blockers.length) decision = 'APPROVED';
  else if (!analysisBlockers.length) decision = 'BUY_CANDIDATE';
  else if (fastPass && secOk && !analysisBlockers.some(b => b.prio <= 3)) decision = 'WATCH';
  else decision = 'REJECTED';
  trace.push({ stage: 'TRADE', ok: decision === 'APPROVED' ? true : null, detail: decision === 'APPROVED' ? 'Freigegeben für Ausführung' : 'Kein Trade (NO TRADE ist eine valide Entscheidung)' });
  const blockers = sortBlockers([...analysisBlockers, ...ex.blockers]);
  let stageReached = PIPELINE.length - 1;
  for (let i = 0; i < trace.length; i++) if (trace[i].ok === false) { stageReached = i; break; }
  const reason = decision === 'APPROVED' ? 'Alle Prüfungen bestanden: ' + (strat.votes.filter(x => x.enabled && x.vote === 'BUY').map(x => x.why).join('; ') || '—')
    : decision === 'BUY_CANDIDATE' ? 'Analyse positiv, Ausführung blockiert: ' + ex.blockers.slice(0, 2).map(b => b.msg).join('; ')
      : blockers.slice(0, 3).map(b => b.msg).join('; ') || 'Keine Freigabe';
  return {
    tokenId: tok.id, ts: A.ts, decision, reason, blockers, analysisBlockers, execBlockers: ex.blockers, trace, fastPass, secOk, stageReached,
    score: A.finalScore, opportunity: A.opportunity, confidence: A.confidence.total, risk: { total: A.risk.total, level: A.risk.level },
    signals: A.signals.map(x => ({ type: x.type, strength: x.strength })), strategy: strat.lead, consensus: strat.weightSum,
    positionSize: ex.sizing ? ex.sizing.size : 0, executionRisk: A.liq.slipRisk, dataQuality: A.labels
  };
}

/* ============================== STUFEN-SCORES & SECURITY-PRÜFBERICHT (erklärbar) ==============================
   Scanner-Stufen: Discovery → Datenqualität → Security → Markt → Handelsbereitschaft. Jede Stufe liefert einen
   Score 0–100 oder null (= keine Daten), einen Status PASS / WARN / FAIL / NO_DATA und Teilbegründungen.
   Grundregel: „Daten nicht verfügbar“ ist nie „kein Risiko“ – NO_DATA wird wie ein offenes Risiko behandelt. */
const STAGE_NAMES = { discovery: 'Discovery', quality: 'Datenqualität', security: 'Security', market: 'Markt', readiness: 'Handelsbereitschaft' };
const STAGE_ORDER = ['discovery', 'quality', 'security', 'market', 'readiness'];
function stageScores(tok, A, D, S) {
  const st = {}, R = (ok, text) => ({ ok, text });
  if (!A || !D) return null;
  { // Discovery: Wie belastbar ist die Identität des Kandidaten?
    const via = (tok.meta && tok.meta.via) || [], r = [];
    r.push(R(via.length > 0, via.length ? 'Gefunden über ' + via.join(', ') : 'Fundquelle unbekannt'));
    r.push(R(isNum(A.core.price), isNum(A.core.price) ? 'Coin-Preis vorhanden' : 'kein gültiger Coin-Preis'));
    r.push(R(!!A.core.pairAddress, A.core.pairAddress ? 'Pool-Adresse bekannt' : 'Pool-Adresse unbekannt'));
    r.push(R(A.crossChecked ? true : null, A.crossChecked ? 'Von zweiter Quelle bestätigt (GeckoTerminal)' : 'Nicht von zweiter Quelle bestätigt'));
    r.push(R(isNum(A.core.pairAge) ? true : null, isNum(A.core.pairAge) ? 'Pair-Alter ' + fmtAge(A.core.pairAge) : 'Pair-Alter unbekannt'));
    const score = Math.round(25 * isNum(A.core.price) + 20 * !!A.core.pairAddress + 25 * !!A.crossChecked + 15 * isNum(A.core.pairAge) + 15 * (via.length > 0));
    st.discovery = { score, status: !isNum(A.core.price) ? 'FAIL' : score >= 70 ? 'PASS' : 'WARN', reasons: r };
  }
  { // Datenqualität: Frische, Quelle, Konflikte, Confidence
    const c = A.confidence.total, r = [];
    r.push(R(!A.stale, `Marktdaten ${A.label}${A.dataAge != null ? ' · ' + fmtAge(A.dataAge) + ' alt' : ''}`));
    r.push(R(!A.fallback, A.fallback ? 'Nur Fallback-Quelle aktuell' : 'Primärquelle aktuell'));
    r.push(R(!A.conflicts.length, A.conflicts.length ? A.conflicts.map(x => `Konflikt ${x.field} ${x.diffPct.toFixed(1)} %`).join(', ') : 'Keine Datenkonflikte'));
    r.push(R(c >= S.minConfidence, `Data Confidence ${c} (min. ${S.minConfidence})`));
    if (A.unknowns.length) r.push(R(null, 'Unbekannt: ' + A.unknowns.slice(0, 4).join(', ')));
    st.quality = { score: c, status: A.stale || !isNum(A.core.price) ? 'FAIL' : c >= S.minConfidence && !A.conflicts.length && !A.fallback ? 'PASS' : 'WARN', reasons: r };
  }
  { // Security: eigenes Gate, kann durch keinen anderen Score ausgeglichen werden
    const s = A.sec, sec = tok.sec, r = [];
    if (!sec || s.status === 'UNKNOWN') {
      r.push(R(null, s.pending ? 'Sicherheitsprüfung läuft …' : 'Keine Security-Daten – das ist kein Freispruch, Käufe bleiben blockiert'));
      st.security = { score: null, status: 'NO_DATA', reasons: r };
    } else {
      const au = v => (v === 'REVOKED' ? true : v === 'ACTIVE' ? false : null);
      r.push(R(au(sec.mintAuthority), 'Mint Authority ' + sec.mintAuthority));
      r.push(R(au(sec.freezeAuthority), 'Freeze Authority ' + sec.freezeAuthority));
      for (const f of sec.flags.filter(x => x.code !== 'MINT_AUTHORITY' && x.code !== 'FREEZE_AUTHORITY').slice(0, 5)) r.push(R(f.level === 'WARN' ? null : false, f.msg));
      if (s.stale) r.push(R(false, `Security-Daten ${fmtAge(s.age)} alt`));
      const high = sec.flags.filter(x => x.level === 'HIGH').length, warn = sec.flags.filter(x => x.level === 'WARN').length;
      const score = s.status === 'CRITICAL' ? 0 : Math.round(clamp((s.status === 'VERIFIED' ? 100 : 70) - high * 20 - warn * 5 - (s.stale ? 30 : 0), 0, 100));
      st.security = { score, status: s.status === 'CRITICAL' || s.stale ? 'FAIL' : s.status === 'VERIFIED' && !high ? 'PASS' : 'WARN', reasons: r };
    }
  }
  { // Markt: Liquidität, Volumen, Käuferanteil, Stabilität, MC-Bereich, Manipulation
    const liq = A.liq.usd, v1 = A.vol.h1, ratio = A.tx.ratio1, r = [], parts = [];
    const logScore = (v, min) => clamp(Math.log10(Math.max(1e-9, v / Math.max(1, min))) * 50 + 50, 0, 100);
    if (isNum(liq)) { parts.push(logScore(liq, S.minLiq)); r.push(R(liq >= S.minLiq, `Liquidität ${fmtUsd(liq)} (min. ${fmtUsd(S.minLiq)})`)); } else r.push(R(null, 'Liquidität unbekannt'));
    if (A.liq.ratioMc != null) r.push(R(A.liq.ratioMc >= 0.03, `Liquidität/MC ${(A.liq.ratioMc * 100).toFixed(1)} %`));
    if (isNum(v1)) { parts.push(logScore(v1, S.minVol1h)); r.push(R(v1 >= S.minVol1h, `Volumen 1h ${fmtUsd(v1)} (min. ${fmtUsd(S.minVol1h)})`)); } else r.push(R(null, 'Volumen unbekannt'));
    if (ratio != null) { parts.push(clamp((ratio - 0.4) / 0.3 * 100, 0, 100)); r.push(R(ratio >= S.minBuyRatio, `Käuferanteil 1h ${Math.round(ratio * 100)} % (min. ${Math.round(S.minBuyRatio * 100)} %)`)); } else r.push(R(null, 'Käuferanteil unbekannt'));
    if (A.price.stability != null) parts.push(A.price.stability);
    r.push(isNum(A.core.mc) ? R(A.core.mc >= S.minMcap && A.core.mc <= S.maxMcap, `${fmtMc(A.core.mc)} (erlaubt ${fmtMc(S.minMcap)} – ${fmtMc(S.maxMcap)})`) : R(null, 'MC unbekannt'));
    if (A.liq.shock) r.push(R(false, `Liquiditätsabfluss ${fmtPct(A.liq.chg5)} in 5 min`));
    if (A.pump.detected) r.push(R(false, 'Pump/Manipulation: ' + A.pump.flags.join(', ')));
    for (const an of A.vol.anomalies) r.push(R(false, an));
    let score = parts.length ? Math.round(avg(parts)) : null;
    if (score != null && (A.pump.detected || A.liq.shock)) score = Math.min(score, 30);
    st.market = { score, status: score == null ? 'NO_DATA' : A.pump.detected || A.liq.shock ? 'FAIL' : r.some(x => x.ok === false) ? 'WARN' : 'PASS', reasons: r };
  }
  { // Handelsbereitschaft: Ergebnis der Entscheidung inkl. aller Blocker (nach Priorität)
    const d = D.decision, r = [R(A.finalScore >= S.minScore, `Final Score ${A.finalScore} (min. ${S.minScore})`)];
    if (D.blockers.length) for (const b of D.blockers.slice(0, 4)) r.push(R(false, `${b.code}: ${b.msg}`)); else r.push(R(true, 'Alle Prüfungen bestanden'));
    const score = d === 'APPROVED' ? A.finalScore : d === 'BUY_CANDIDATE' ? Math.round(A.finalScore * 0.8) : d === 'WATCH' ? Math.min(A.finalScore, 45) : Math.min(A.finalScore, 20);
    st.readiness = { score, status: d === 'APPROVED' ? 'PASS' : d === 'REJECTED' ? 'FAIL' : 'WARN', reasons: r, decision: d };
  }
  return st;
}
/* Security-Prüfbericht: je Check Ergebnis, Schweregrad, Quelle, Zeitpunkt und Policy-Aktion.
   Die Aktion stammt aus den tatsächlich gesetzten Blockern – Bericht und Entscheidung können nicht auseinanderlaufen. */
const SEC_GATE_DE = { PASSED: 'bestanden', CAUTION: 'mit Hinweisen', UNVERIFIED: 'nicht verifiziert', BLOCKED: 'blockiert' };
function securityReport(tok, A, D, S) {
  if (!A) return null;
  const sec = tok.sec, codes = new Set((D ? D.analysisBlockers : []).map(b => b.code)), out = [];
  const snapTs = isNum(A.ts) && isNum(A.dataAge) ? A.ts - A.dataAge : null;
  const add = (check, result, severity, source, ts, detail, blockCode) => out.push({ check, result, severity, source, ts, detail, action: blockCode && codes.has(blockCode) ? 'BLOCK' : result === 'FAIL' ? 'RISIKO' : result === 'WARN' ? 'HINWEIS' : result === 'NO_DATA' ? 'OFFEN' : 'KEINE' });
  const secSrc = !sec ? '—' : [sec.sources.rpc && 'Solana RPC', sec.sources.rug && 'RugCheck'].filter(Boolean).join(' + ') || '—', secTs = sec ? sec.checkedAt : null;
  const authCheck = (name, v, code) => {
    if (!sec || v === 'UNKNOWN') add(name, 'NO_DATA', 'HIGH', secSrc, secTs, 'Status unbekannt – nicht als „kein Risiko“ gewertet', 'SECURITY_UNKNOWN');
    else if (v === 'ACTIVE') add(name, 'FAIL', 'CRITICAL', secSrc, secTs, code === 'MINT' ? 'Supply kann jederzeit erhöht werden' : 'Konten können eingefroren werden (Verkauf unmöglich)', 'SECURITY_CRITICAL');
    else add(name, 'PASS', 'INFO', secSrc, secTs, 'widerrufen (REVOKED)');
  };
  authCheck('Mint Authority', sec ? sec.mintAuthority : 'UNKNOWN', 'MINT');
  authCheck('Freeze Authority', sec ? sec.freezeAuthority : 'UNKNOWN', 'FREEZE');
  { const ext = sec ? sec.flags.filter(f => ['PERMANENT_DELEGATE', 'NON_TRANSFERABLE', 'TRANSFER_HOOK', 'TRANSFER_FEE', 'DEFAULT_FROZEN', 'MINT_NOT_FOUND'].includes(f.code)) : [];
    if (!sec || !sec.program) add('Token-Programm & Extensions', 'NO_DATA', 'HIGH', secSrc, secTs, 'Programm unbekannt', null);
    else if (ext.length) add('Token-Programm & Extensions', 'FAIL', ext.some(f => f.level === 'CRITICAL') ? 'CRITICAL' : 'HIGH', secSrc, secTs, ext.map(f => f.msg).join(' · '), ext.some(f => f.level === 'CRITICAL') ? 'SECURITY_CRITICAL' : null);
    else add('Token-Programm & Extensions', 'PASS', 'INFO', secSrc, secTs, sec.program + ' ohne riskante Extensions'); }
  { if (!sec || !sec.sources.rug) add('RugCheck-Risiken', 'NO_DATA', 'WARN', 'RugCheck', secTs, 'RugCheck nicht verfügbar oder deaktiviert', null);
    else { const danger = sec.flags.filter(f => f.code.startsWith('RUG_') && f.code !== 'RUG_WARN' || f.code === 'RUGGED'), warn = sec.flags.filter(f => f.code === 'RUG_WARN');
      if (danger.length) add('RugCheck-Risiken', 'FAIL', danger.some(f => f.level === 'CRITICAL') ? 'CRITICAL' : 'HIGH', 'RugCheck', secTs, danger.map(f => f.msg).join(' · '), danger.some(f => f.level === 'CRITICAL') ? 'SECURITY_CRITICAL' : null);
      else if (warn.length) add('RugCheck-Risiken', 'WARN', 'WARN', 'RugCheck', secTs, warn.map(f => f.msg).join(' · '), null);
      else add('RugCheck-Risiken', 'PASS', 'INFO', 'RugCheck', secTs, 'keine Warnungen'); } }
  { const t10 = sec ? sec.top10Pct : null;
    if (!isNum(t10)) add('Holder-Konzentration', 'NO_DATA', 'WARN', sec && sec.holderSrc || '—', secTs, 'Top-Holder unbekannt', null);
    else add('Holder-Konzentration', t10 > 60 ? 'FAIL' : t10 > 40 ? 'WARN' : 'PASS', t10 > 60 ? 'HIGH' : t10 > 40 ? 'WARN' : 'INFO', sec.holderSrc, secTs, `Top-10 halten ${t10.toFixed(1)} %${sec.holderSrc && sec.holderSrc.startsWith('RPC') ? ' (inkl. Pool-/LP-Konten)' : ''}`, null); }
  { const lp = sec ? sec.lpLockedPct : null;
    if (!isNum(lp)) add('LP gesperrt/verbrannt', 'NO_DATA', 'WARN', 'RugCheck', secTs, 'LP-Status unbekannt', null);
    else add('LP gesperrt/verbrannt', lp < 50 ? 'WARN' : 'PASS', lp < 50 ? 'WARN' : 'INFO', 'RugCheck', secTs, `${lp.toFixed(0)} % gesperrt/verbrannt`, null); }
  add('Creator-/Deployer-Historie', 'NO_DATA', 'INFO', '—', null, sec && sec.creator ? `Creator ${shortAddr(sec.creator)} bekannt, Wallet-Historie ohne Datenquelle` : 'Keine Datenquelle für Wallet-Historie angebunden', null);
  if (A.liq.chg5 == null) add('Liquiditätsabfluss (5 min)', 'NO_DATA', 'HIGH', A.core.source || '—', snapTs, 'Noch kein 5-min-Verlauf', null);
  else add('Liquiditätsabfluss (5 min)', A.liq.shock ? 'FAIL' : 'PASS', A.liq.shock ? 'HIGH' : 'INFO', A.core.source || '—', snapTs, `Liquidität ${fmtPct(A.liq.chg5)} in 5 min`, 'LIQUIDITY_SHOCK');
  add('Pump / Manipulation', A.pump.detected ? 'FAIL' : A.pump.flags.length ? 'WARN' : 'PASS', A.pump.detected ? 'HIGH' : A.pump.flags.length ? 'WARN' : 'INFO', A.core.source || '—', snapTs, A.pump.flags.length ? A.pump.flags.join(', ') : 'keine Muster erkannt', 'PUMP_DETECTED');
  { const pc = A.conflicts.find(c => c.field === 'Preis'), lc = A.conflicts.find(c => c.field === 'Liquidität');
    if (pc) add('Provider-Abgleich', 'FAIL', 'HIGH', 'DexScreener ↔ GeckoTerminal', snapTs, `Preis weicht ${pc.diffPct.toFixed(1)} % ab`, 'DATA_CONFLICT');
    else if (lc) add('Provider-Abgleich', 'WARN', 'WARN', 'DexScreener ↔ GeckoTerminal', snapTs, `Liquidität weicht ${lc.diffPct.toFixed(1)} % ab`, null);
    else if (A.crossChecked) add('Provider-Abgleich', 'PASS', 'INFO', 'DexScreener ↔ GeckoTerminal', snapTs, 'Preis & Liquidität stimmen überein');
    else add('Provider-Abgleich', 'NO_DATA', 'WARN', 'nur DexScreener', snapTs, 'Keine zweite Quelle zum Abgleich', null); }
  if (!sec) add('Aktualität der Security-Daten', 'NO_DATA', 'HIGH', '—', null, 'Noch nicht geprüft', 'SECURITY_UNKNOWN');
  else add('Aktualität der Security-Daten', A.sec.stale ? 'FAIL' : 'PASS', A.sec.stale ? 'HIGH' : 'INFO', secSrc, secTs, `geprüft vor ${fmtAge(A.sec.age)}`, 'SECURITY_STALE');
  { const imp = A.liq.impactPlanned;
    if (imp == null) add('Ausführbarkeit (Price Impact)', 'NO_DATA', 'WARN', 'Schätzung', snapTs, 'Impact nicht schätzbar', null);
    else add('Ausführbarkeit (Price Impact)', imp > S.maxSlippagePct ? 'FAIL' : imp > S.maxSlippagePct / 2 ? 'WARN' : 'PASS', imp > S.maxSlippagePct ? 'HIGH' : imp > S.maxSlippagePct / 2 ? 'WARN' : 'INFO', 'Schätzung (AMM)', snapTs, `${imp.toFixed(2)} % bei geplanter Größe (max. ${S.maxSlippagePct} %)`, 'SLIPPAGE_TOO_HIGH'); }
  { const w = A.tx.whaleRel;
    if (w == null && !A.tx.micro) add('Wallet-Cluster / große Trades', 'NO_DATA', 'WARN', A.core.source || '—', snapTs, 'Transaktionsdaten fehlen', null);
    else if (A.tx.micro) add('Wallet-Cluster / große Trades', 'WARN', 'WARN', A.core.source || '—', snapTs, 'Viele Mikro-Trades – Wash-Trading möglich', null);
    else add('Wallet-Cluster / große Trades', w > 1 ? 'WARN' : 'PASS', w > 1 ? 'WARN' : 'INFO', A.core.source || '—', snapTs, `Ø Trade = ${w.toFixed(2)} % der Liquidität`, null); }
  const gate = out.some(c => c.action === 'BLOCK') ? 'BLOCKED' : out.slice(0, 2).some(c => c.result === 'NO_DATA') ? 'UNVERIFIED' : out.some(c => c.result === 'FAIL' || c.result === 'WARN') ? 'CAUTION' : 'PASSED';
  return { gate, checks: out, noData: out.filter(c => c.result === 'NO_DATA').length, checkedAt: secTs };
}

/* ============================== MARKET REGIME ============================== */
function computeRegime(analyses, sol) {
  const h1 = analyses.map(a => a.price.chg.h1).filter(isNum), m5 = analyses.map(a => a.price.chg.m5).filter(isNum);
  // Low-Quality-Markt: Großteil der analysierten Tokens veraltet, nur Fallback oder mit sehr niedriger Confidence → No-Trade-Zone
  const lowQ = analyses.length ? analyses.filter(a => a.stale || a.fallback || (a.confidence && a.confidence.total < 40)).length / analyses.length : 0;
  const lowQuality = analyses.length >= 10 && lowQ >= 0.7;
  if (h1.length < 5) return { tags: lowQuality ? ['LOW_QUALITY_MARKET'] : ['UNKNOWN'], breadth: null, medH1: null, medM5: null, medVol: null, n: h1.length, lowQ, sol };
  const breadth = h1.filter(x => x > 0).length / h1.length;
  const medH1 = median(h1), medM5 = median(m5.map(Math.abs)), vols = analyses.map(a => a.price.volPct).filter(isNum), medVol = median(vols);
  const tags = [];
  if (breadth > 0.6 && medH1 > 5) tags.push('RISK_ON'); else if (breadth < 0.35 && medH1 < -5) tags.push('RISK_OFF');
  if (medM5 != null && medM5 > 8) tags.push('HIGH_VOLATILITY'); else if (medM5 != null && medM5 < 1.5) tags.push('LOW_VOLATILITY');
  if (Math.abs(medH1) > 10) tags.push('TRENDING'); else tags.push('CHOPPY');
  tags.push(breadth >= 0.55 && medH1 > 2 ? 'BULLISH' : breadth <= 0.4 && medH1 < -2 ? 'BEARISH' : 'NEUTRAL');
  const lq = analyses.map(a => a.liq && a.liq.chg5).filter(isNum), medLiq = lq.length >= 5 ? median(lq) : null;
  if (medLiq != null && medLiq > 3) tags.push('LIQUIDITY_EXPANSION'); else if (medLiq != null && medLiq < -3) tags.push('LIQUIDITY_CONTRACTION');
  if (medM5 != null && medM5 > 15) tags.push('VOL_SHOCK');
  if (lowQuality) tags.push('LOW_QUALITY_MARKET');
  return { tags, breadth, medH1, medM5, medVol, medLiq, lowQ, n: h1.length, sol };
}

/* ============================== ANALYTICS (reine Funktionen) ============================== */
function perfStats(trades) {
  const closed = trades.filter(t => t.status === 'CLOSED' && t.result && isNum(t.result.pnlUsd));
  const pnl = closed.map(t => t.result.pnlUsd);
  const wins = pnl.filter(x => x > 0), losses = pnl.filter(x => x <= 0);
  const gw = sum(wins), gl = -sum(losses);
  let eq = 0, peak = 0, maxDD = 0;
  for (const t of [...closed].sort((a, b) => a.closedAt - b.closedAt)) { eq += t.result.pnlUsd; peak = Math.max(peak, eq); maxDD = Math.max(maxDD, peak - eq); }
  return {
    trades: closed.length, wins: wins.length, losses: losses.length, winRate: closed.length ? wins.length / closed.length : null,
    avgWin: wins.length ? gw / wins.length : null, avgLoss: losses.length ? -gl / losses.length : null,
    profitFactor: gl > 0 ? gw / gl : wins.length ? Infinity : null, expectancy: closed.length ? sum(pnl) / closed.length : null,
    maxDD, fees: sum(closed.map(t => t.feesUsd || 0)), slippage: sum(closed.map(t => t.slippageUsd || 0)),
    gross: sum(pnl) + sum(closed.map(t => t.feesUsd || 0)), net: sum(pnl),
    avgHold: closed.length ? avg(closed.map(t => t.closedAt - t.openedAt)) : null,
    best: pnl.length ? Math.max(...pnl) : null, worst: pnl.length ? Math.min(...pnl) : null
  };
}
function bucketize(values, edges, labels) {
  const out = labels.map(l => ({ label: l, n: 0 }));
  for (const v of values) { if (!isNum(v)) continue; let i = edges.findIndex(e => v < e); if (i === -1) i = edges.length; out[i].n++; }
  return out;
}

/* ============================== BACKTEST (ohne Look-Ahead) ==============================
   Signal auf Kerze i (geschlossen) → Einstieg zum Open von Kerze i+1. Stops vor TPs geprüft (konservativ). */
const BT_STRATEGIES = {
  momentum: { name: 'Momentum', param: 'thr', grid: [2, 3, 5, 8], def: 3, fn: (c, i, p, x) => { const r = roc(x.cl.slice(0, i + 1), 5); return r != null && r > p.thr && x.e9[i] > x.e21[i] && c[i].v > (x.vs[i] || Infinity) * 1.5; } },
  breakout: { name: 'Breakout', param: 'look', grid: [10, 20, 30], def: 20, fn: (c, i, p, x) => { if (i < p.look + 1) return false; let hh = 0; for (let j = i - p.look; j < i; j++) hh = Math.max(hh, c[j].h); return c[i].c > hh && c[i].v > (x.vs[i] || Infinity) * 1.5; } },
  trend: { name: 'Trend Following', param: 'rsiMax', grid: [65, 70, 75], def: 70, fn: (c, i, p, x) => i > 0 && x.e9[i - 1] != null && x.e21[i - 1] != null && x.e9[i - 1] <= x.e21[i - 1] && x.e9[i] > x.e21[i] && x.rs[i] != null && x.rs[i] >= 50 && x.rs[i] <= p.rsiMax },
  meanrev: { name: 'Mean Reversion', param: 'dev', grid: [10, 15, 20], def: 15, fn: (c, i, p, x) => x.rs[i] != null && x.rs[i] < 30 && x.e21[i] != null && c[i].c < x.e21[i] * (1 - p.dev / 100) },
  volume: { name: 'Volume Expansion', param: 'mult', grid: [2, 3, 4], def: 3, fn: (c, i, p, x) => c[i].v > (x.vs[i] || Infinity) * p.mult && c[i].c > c[i].o }
};
function btPrecompute(c) {
  const cl = c.map(x => x.c), e9 = emaSeries(cl, 9), e21 = emaSeries(cl, 21);
  const rs = cl.map((_, i) => (i >= 15 ? rsi(cl.slice(Math.max(0, i - 60), i + 1), 14) : null));
  const vs = c.map((_, i) => (i >= 20 ? sum(c.slice(i - 20, i).map(k => k.v)) / 20 : null)); // Durchschnitt der VORHERIGEN 20 Kerzen
  return { cl, e9, e21, rs, vs };
}
function runBacktest(candles, cfg) {
  const def = BT_STRATEGIES[cfg.strategy]; if (!def) throw new Error('Unbekannte Strategie');
  const c = candles; const x = btPrecompute(c);
  const p = { [def.param]: cfg.param != null ? cfg.param : def.def };
  const feePct = cfg.feePct / 100, slip = cfg.slipPct / 100;
  let equity = cfg.capital, peak = equity, maxDD = 0; const trades = []; const curve = [{ t: c[0] ? c[0].t : 0, v: equity }];
  let pos = null, barsIn = 0;
  const from = cfg.from || 0, to = cfg.to == null ? c.length : cfg.to;
  for (let i = Math.max(from, 22); i < to; i++) {
    if (pos) {
      if (i < pos.i) continue; // Einstieg liegt (bei Verzögerung) noch in der Zukunft
      const k = c[i]; let exit = null;
      if (k.l <= pos.stop) exit = { price: Math.min(k.o, pos.stop) * (1 - slip), reason: pos.trailing ? 'TRAILING_STOP' : 'STOP_LOSS' };
      else if (k.h >= pos.tp) exit = { price: Math.max(k.o, pos.tp) * (1 - slip), reason: 'TAKE_PROFIT' };
      else if (i - pos.i >= cfg.timeBars) exit = { price: k.c * (1 - slip), reason: 'TIME_EXIT' };
      if (!exit) { pos.high = Math.max(pos.high, k.h); if (pos.high >= pos.entry * (1 + cfg.trailActPct / 100)) { pos.trailing = true; pos.stop = Math.max(pos.stop, pos.high * (1 - cfg.trailPct / 100)); } }
      if (exit) {
        const gross = pos.qty * exit.price, fee = gross * feePct, net = gross - fee;
        const pnl = net - pos.cost; equity += net; barsIn += i - pos.i + 1;
        trades.push({ entryT: pos.t, sigT: pos.sigT, exitT: k.t, entry: pos.entry, exit: exit.price, pnl, pnlPct: pnl / pos.cost * 100, reason: exit.reason, bars: i - pos.i + 1, fees: pos.fee + fee, slippage: pos.cost * slip + gross * slip });
        pos = null; peak = Math.max(peak, equity); maxDD = Math.max(maxDD, peak > 0 ? (peak - equity) / peak : 0); curve.push({ t: k.t, v: equity });
      }
      continue;
    }
    const d = Math.max(0, Math.round(cfg.entryDelay || 0)); // Stress-Szenario: Einstieg d Kerzen später
    if (i + 1 + d < to && def.fn(c, i, p, x)) {
      const n = c[i + 1 + d]; const entry = n.o * (1 + slip); const cost = equity * cfg.sizePct / 100; if (cost <= 0) continue;
      const fee = cost * feePct; const qty = (cost - fee) / entry; equity -= cost;
      // Einstieg auf Kerze i+1(+d); deren Low/High wird ab dieser Kerze für Exits geprüft.
      pos = { i: i + 1 + d, t: n.t, entry, qty, cost, fee, sigT: c[i].t, stop: entry * (1 - cfg.slPct / 100), tp: entry * (1 + cfg.tpPct / 100), high: entry, trailing: false };
    }
  }
  if (pos) { const k = c[to - 1]; const gross = pos.qty * k.c * (1 - slip); const fee = gross * feePct; const pnl = gross - fee - pos.cost; equity += gross - fee; trades.push({ entryT: pos.t, sigT: pos.sigT, exitT: k.t, entry: pos.entry, exit: k.c, pnl, pnlPct: pnl / pos.cost * 100, reason: 'END_OF_DATA', bars: to - pos.i, fees: pos.fee + fee, slippage: 0 }); curve.push({ t: k.t, v: equity }); }
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const gw = sum(wins.map(t => t.pnl)), gl = -sum(losses.map(t => t.pnl));
  const span = Math.max(1, to - Math.max(from, 22));
  return {
    params: p, trades, curve, metrics: {
      trades: trades.length, winRate: trades.length ? wins.length / trades.length : null, avgWin: wins.length ? gw / wins.length : null, avgLoss: losses.length ? -gl / losses.length : null,
      profitFactor: gl > 0 ? gw / gl : wins.length ? Infinity : null, maxDD: maxDD * 100, expectancy: trades.length ? sum(trades.map(t => t.pnl)) / trades.length : null,
      fees: sum(trades.map(t => t.fees)), slippage: sum(trades.map(t => t.slippage)), exposure: barsIn / span * 100, avgHoldBars: trades.length ? avg(trades.map(t => t.bars)) : null,
      netPnl: equity - cfg.capital, returnPct: (equity / cfg.capital - 1) * 100
    }
  };
}
/* ---- Backtest-Research: Run-Protokoll (reproduzierbar), Stress-Szenarien, Monte-Carlo-Drawdown, Regime-Auswertung ---- */
const BT_LIMITS = [
  'Nur OHLCV-Kerzen von GeckoTerminal (max. 1000) – keine historische Liquidität, Käufer-/Verkäuferdaten oder Security-Historie',
  'Slippage und Gebühren sind Annahmen je Seite, kein echtes Orderbuch; Price Impact nicht modelliert',
  'Kerzenbasierte Ausführung: innerhalb einer Kerze wird der Stop vor dem Take Profit geprüft (konservativ)',
  'Survivorship: nur Pools, die heute noch Daten liefern',
  'Strategien des Backtests sind vereinfachte Kerzen-Varianten der Live-Strategien',
  'Vergangene Ergebnisse sind keine Garantie für die Zukunft'
];
function candleHash(c) { let h = 2166136261; for (const k of c) for (const v of [k.t, k.o, k.h, k.l, k.c, k.v]) { const s = String(v); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } } return (h >>> 0).toString(36).toUpperCase(); }
function btRunMeta(candles, cfg, info) {
  const def = BT_STRATEGIES[cfg.strategy];
  const dataset = { source: 'GeckoTerminal OHLCV', pool: info.pair || null, symbol: info.symbol || null, tf: info.tf, n: candles.length, from: candles[0].t, to: candles[candles.length - 1].t, hash: candleHash(candles) };
  const params = { strategy: cfg.strategy, [def.param]: info.chosen, sizePct: cfg.sizePct, tpPct: cfg.tpPct, slPct: cfg.slPct, trailActPct: cfg.trailActPct, trailPct: cfg.trailPct, timeBars: cfg.timeBars };
  const costs = { feePct: cfg.feePct, slipPct: cfg.slipPct, note: 'je Seite' }, code = `App ${APP_VERSION} · Strategy ${STRATEGY_VERSION}`;
  return { id: 'BT-' + hashStr(dataset.hash + JSON.stringify(params) + JSON.stringify(costs) + code).toString(36).toUpperCase(), dataset, params, costs, code, split: 'Train 50 % → Validation 25 % → Test 25 % (zeitlich getrennt)', oosPct: 50, wf: `Parameter „${def.param}“ nur auf Train gewählt (Raster ${def.grid.join(', ')}), auf Validation geprüft, Ergebnis separat auf Test`, limitations: BT_LIMITS };
}
/* Stress: dieselbe Strategie mit schlechteren Annahmen auf demselben (Test-)Zeitraum */
function btStress(candles, cfg, from, to) {
  const base = runBacktest(candles, { ...cfg, from, to }).metrics;
  const sc = [['Basis', {}], ['Gebühren ×2', { feePct: cfg.feePct * 2 }], ['Slippage ×2', { slipPct: cfg.slipPct * 2 }], ['Einstieg 1 Kerze später', { entryDelay: 1 }], ['Stop 20 % enger', { slPct: cfg.slPct * 0.8 }], ['Take Profit 20 % niedriger', { tpPct: cfg.tpPct * 0.8 }]];
  return sc.map(([name, ch]) => { const m = name === 'Basis' ? base : runBacktest(candles, { ...cfg, ...ch, from, to }).metrics; return { name, trades: m.trades, net: m.netPnl, pf: m.profitFactor, maxDD: m.maxDD, winRate: m.winRate, delta: m.netPnl - base.netPnl }; });
}
/* Monte-Carlo: Trade-Reihenfolge zufällig (mit Zurücklegen, fester Seed) → Verteilung des Max Drawdowns */
function mcDrawdown(trades, capital, seedKey, iters = 400) {
  if (trades.length < 5) return null;
  const rnd = prng(hashStr(String(seedKey))), pnls = trades.map(t => t.pnl), dds = [];
  for (let k = 0; k < iters; k++) { let eq = capital, peak = capital, dd = 0; for (let i = 0; i < pnls.length; i++) { eq += pnls[Math.floor(rnd() * pnls.length)]; peak = Math.max(peak, eq); dd = Math.max(dd, peak > 0 ? (peak - eq) / peak : 0); } dds.push(dd * 100); }
  return { p50: quantile(dds, 0.5), p95: quantile(dds, 0.95), worst: Math.max(...dds), iters };
}
/* Regime je Kerze (nur Vergangenheit bis zur Signal-Kerze): Volatilität (ATR%-Terzil) und Trend (EMA21-Steigung).
   Die Terzil-Grenzen werden über den gesamten Zeitraum bestimmt – nur zur Auswertung, nie für Handelsentscheidungen. */
function btRegimes(c) {
  const cl = c.map(x => x.c), e21 = emaSeries(cl, 21);
  const atrp = c.map((_, i) => { if (i < 14) return null; let s = 0; for (let j = i - 13; j <= i; j++) s += Math.max(c[j].h - c[j].l, Math.abs(c[j].h - c[j - 1].c), Math.abs(c[j].l - c[j - 1].c)); return c[i].c > 0 ? s / 14 / c[i].c * 100 : null; });
  const v = atrp.filter(isNum), q1 = quantile(v, 1 / 3), q2 = quantile(v, 2 / 3);
  return c.map((_, i) => ({ vol: atrp[i] == null ? 'UNKNOWN' : atrp[i] < q1 ? 'LOW_VOL' : atrp[i] < q2 ? 'MID_VOL' : 'HIGH_VOL', trend: i >= 26 && e21[i] != null && e21[i - 5] != null ? (e21[i] > e21[i - 5] * 1.002 ? 'UP' : e21[i] < e21[i - 5] * 0.998 ? 'DOWN' : 'FLAT') : 'UNKNOWN' }));
}
function btByRegime(trades, candles) {
  const reg = btRegimes(candles), idx = new Map(candles.map((k, i) => [k.t, i])), out = {};
  for (const tr of trades) {
    const i = idx.get(tr.sigT != null ? tr.sigT : tr.entryT), r = i != null ? reg[i] : { vol: 'UNKNOWN', trend: 'UNKNOWN' };
    tr.regime = r.vol + ' · ' + r.trend;
    for (const key of ['Volatilität ' + r.vol, 'Trend ' + r.trend]) { const o = out[key] || (out[key] = { n: 0, wins: 0, net: 0 }); o.n++; if (tr.pnl > 0) o.wins++; o.net += tr.pnl; }
  }
  return out;
}
function btTradesCsv(trades) {
  const cols = ['entryTime', 'exitTime', 'entryPrice', 'exitPrice', 'pnlUsd', 'pnlPct', 'reason', 'bars', 'feesUsd', 'slippageUsd', 'regime'];
  return [cols, ...trades.map(t => [isoTime(t.entryT), isoTime(t.exitT), t.entry, t.exit, t.pnl.toFixed(4), t.pnlPct.toFixed(2), t.reason, t.bars, (t.fees || 0).toFixed(4), (t.slippage || 0).toFixed(4), t.regime || ''])].map(r => r.map(csvCell).join(',')).join('\n');
}
/* Walk-Forward: Parameter nur auf Training wählen, auf Validation prüfen, Ergebnis separat auf Test berichten. */
function walkForward(candles, cfg) {
  const n = candles.length; const a = Math.floor(n * 0.5), b = Math.floor(n * 0.75);
  const def = BT_STRATEGIES[cfg.strategy];
  const rows = def.grid.map(g => ({ param: g, train: runBacktest(candles, { ...cfg, param: g, from: 0, to: a }).metrics }));
  const eligible = rows.filter(r => r.train.trades >= 3);
  const best = (eligible.length ? eligible : rows).sort((x, y) => (y.train.expectancy || -Infinity) - (x.train.expectancy || -Infinity))[0];
  const validation = runBacktest(candles, { ...cfg, param: best.param, from: a, to: b }).metrics;
  const test = runBacktest(candles, { ...cfg, param: best.param, from: b, to: n });
  return { split: { train: [0, a], validation: [a, b], test: [b, n] }, grid: rows, chosen: best.param, validation, test: test.metrics, testCurve: test.curve, testTrades: test.trades, lowSample: !eligible.length };
}
