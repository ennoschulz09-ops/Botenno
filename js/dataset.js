/* Smart Lab – dataset.js
   Datensammler (Schicht „Sammeln“, reine Funktionen): Kandidaten-Datensätze · Kursverfolgung · Labels nach Kosten · Datenqualität
   Klassisches Skript ohne Build-Schritt: alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in fester
   Reihenfolge geladen (index.html bzw. server/load-core.js): base → engine → learning → dataset → core → selftest → ui.
   base, engine, learning, dataset, core und selftest laufen auch ohne Browser (Node.js); nur ui.js braucht das DOM. */
'use strict';

/* ============================== DATENSAMMLER: alle Kandidaten labeln (reine Funktionen) ==============================
   Jeder gescannte Coin wird zum Entscheidungszeitpunkt mit Merkmalen (buildEntryFeatures, unverändert), Entscheidung und
   Kosten-Eingaben festgehalten, 30 min verfolgt (auch nach Verdrängung aus dem Scanner) und nach Kosten gelabelt
   (Triple Barrier: Gewinnziel / Stop / Rug / Zeit). Nur Messung – kein Einfluss auf Handel, Risiko-Limits oder Lern-KI.
   Keine Uhr, kein Zustand: alle Zeiten kommen als Werte herein (im Kern env.now) → deterministisch und offline nachrechenbar.
   Ein fertiger Datensatz ist eine JSON-Zeile (Schema CAND_VERSION, Beschreibung in docs/LERNDATEN.md). */
const CAND_VERSION = 1;
/* Feste Label-Regeln – bewusst keine Einstellung, damit alle Datensätze vergleichbar bleiben (offline neu labelbar aus path.s). */
const CAND_LABEL = Object.freeze({ horizonMin: 30, tpPct: 30, slPct: 15, rugLiqPct: -40 });
const CAND_DEFAULTS = Object.freeze({
  open: 1000,                    // max. gleichzeitig verfolgte Datensätze (Kern-Option candidates.open)
  refUsd: 50,                    // feste Referenzgröße der Kostenrechnung (nicht vom Portfolio abhängig → für jeden Sub-Bot nachrechenbar)
  resampleMin: 60,               // RESAMPLE: je Coin höchstens alle 60 min ein neuer Datensatz
  triggerGapMin: 30,             // TRIGGER (Coin wird kaufwürdig): frühestens alle 30 min, höchstens einer offen
  sample15UntilSec: 300, sampleEarlySec: 15, sampleLateSec: 30, // gespeicherte Proben: alle 15 s in den ersten 5 min, danach alle 30 s
  tailSec: 120,                  // Zeit-Label nur mit einem Kurs in den letzten 2 min vor dem Horizont
  gapSec: 120, fewSamples: 10, vanishMisses: 3, // Qualität: Lücke > 2 min · < 10 Kurse · 3× kein Pool mehr gefunden
  followAfterSec: 25, followGapMs: 2000, reserve: 60, maxBatch: 30 // Verfolger: nach 25 s ohne Kurs · ≥ 2 s Abstand · 60 Anfragen/min Reserve · ≤ 30 Mints
});
const CAND_Y = ['TP', 'SL', 'RUG', 'TIME', 'NO_DATA'];
const CAND_FLAGS = ['FEW_SAMPLES', 'GAPS', 'TRUNCATED', 'VANISHED', 'POOL_SWITCH', 'NO_COST'];

/* Netto-Ergebnis in % nach Kosten für die feste Referenzgröße S (Kostenmodell 1, wie estImpact/estFees im Kern):
   v0 = S·(1−f)·(1 − S/(liq0/2+S)) − N · V = v0·(1+brutto) · Erlös = V·(1−f)·(1 − V/(liqExit/2+V)) − N · netto = Erlös/S − 1.
   f = DEX-Gebühr, N = Netzwerk- + Priority-Gebühr je Transaktion in USD. Ausstieg mit der Liquidität am Ausstieg (Rug → hoher
   Verlust). Nicht enthalten: Kursbewegung während der Bestätigung, gescheiterte Transaktionen, MEV. Höchstens −100 %. */
function candNet(grossPct, cost, liqExit) {
  if (!cost || !isNum(grossPct) || !(cost.refUsd > 0) || !(cost.liq0 > 0) || !isNum(cost.txFeeUsd) || !isNum(cost.dexFeePct)) return null;
  const S = cost.refUsd, f = cost.dexFeePct / 100, N = cost.txFeeUsd, L1 = isNum(liqExit) ? Math.max(0, liqExit) : cost.liq0;
  const v0 = S * (1 - f) * (1 - S / (cost.liq0 / 2 + S)) - N;
  const V = Math.max(0, v0 * (1 + grossPct / 100));
  const fin = V > 0 ? Math.max(0, V * (1 - f) * (1 - V / (L1 / 2 + V)) - N) : 0;
  return lr2((fin / S - 1) * 100);
}

/* Label aus den Proben [tSec, pct, liqPct] (zeitlich geordnet) – dieselbe Funktion online und offline (path.s → identisches Label).
   Barrieren auf dem Bruttokurs, die erste überschrittene entscheidet; RUG (Liquidität ≤ rugLiqPct) vor SL vor TP bei derselben
   Beobachtung. hitPct = beobachteter Wert beim Treffer (Durchrutschen bleibt sichtbar, z. B. −40 statt −15). MFE/MAE immer über das
   volle Fenster. Ohne Barriere: TIME mit dem letzten Kurs in den letzten tailSec, sonst NO_DATA. o.vanished (Pool verschwunden):
   ohne Barriere NO_DATA – nie einen Verlust erfinden. */
function candLabel(samples, cfg, cost, o = {}) {
  const C = cfg || CAND_LABEL, H = C.horizonMin * 60, tail = CAND_DEFAULTS.tailSec;
  let y = null, tHit = null, hitPct = null, hitLq = null, mfe = null, mae = null, tMfe = null, tMae = null, minLiq = null, endPct = null, endLq = null;
  for (const x of arr(samples)) {
    const t = x[0], pct = x[1], lq = isNum(x[2]) ? x[2] : null;
    if (!isNum(t) || !isNum(pct) || t < 0 || t > H) continue;
    if (mfe == null || pct > mfe) { mfe = pct; tMfe = t; }
    if (mae == null || pct < mae) { mae = pct; tMae = t; }
    if (lq != null && (minLiq == null || lq < minLiq)) minLiq = lq;
    if (!y) {
      const k = lq != null && lq <= C.rugLiqPct ? 'RUG' : pct <= -C.slPct ? 'SL' : pct >= C.tpPct ? 'TP' : null;
      if (k) { y = k; tHit = t; hitPct = pct; hitLq = lq; }
    }
    if (t >= H - tail) { endPct = pct; endLq = lq; }
  }
  if (!y) y = o.vanished || endPct == null ? 'NO_DATA' : 'TIME';
  const gross = y === 'TIME' ? endPct : y === 'NO_DATA' ? null : hitPct, lqX = y === 'TIME' ? endLq : hitLq;
  const liq0 = cost && cost.liq0, liqExit = lqX != null && isNum(liq0) ? liq0 * (1 + lqX / 100) : liq0;
  const netPct = gross == null ? null : candNet(gross, cost, liqExit);
  return { cfg: { horizonMin: C.horizonMin, tpPct: C.tpPct, slPct: C.slPct, rugLiqPct: C.rugLiqPct }, y, tHitSec: tHit, hitPct, endPct, grossPct: gross, netPct, win: netPct == null ? null : netPct > 0, mfePct: mfe, maePct: mae, tMfeSec: tMfe, tMaeSec: tMae, minLiqPct: minLiq };
}

/* Datensatz zum Entscheidungszeitpunkt. Einstiegskurs = A.core.price zum Abrufzeitpunkt t0 (snap.fetchedAt).
   ctx: { now, why, regimeTags, mode, paramVersion, modelVersion, settingsHash, solUsd, prioLamports, dexFeePct, seen, quoteCheck, app, refUsd }.
   Interne Verfolgung unter c._ (wird von candFinish entfernt). */
function candOpen(t, A, D, ctx) {
  const now = ctx.now, why = ctx.why, p0 = A.core.price, t0 = A.core.fetchedAt, liq0 = isNum(A.liq.usd) && A.liq.usd > 0 ? A.liq.usd : null;
  const refUsd = ctx.refUsd > 0 ? ctx.refUsd : CAND_DEFAULTS.refUsd, sol = ctx.solUsd > 0 ? ctx.solUsd : null;
  const prio = isNum(ctx.prioLamports) ? ctx.prioLamports : null, fee = isNum(ctx.dexFeePct) ? ctx.dexFeePct : null;
  const cost = { model: 1, refUsd, liq0, impactInPct: null, dexFeePct: fee, txFeeUsd: null, prioLamports: prio, solUsd: sol, roundTripPct: null };
  if (sol != null && liq0 != null && prio != null && fee != null) { // sonst bleiben die Kostenfelder leer → NO_COST, netPct null
    cost.impactInPct = lr2(refUsd / (liq0 / 2 + refUsd) * 100);
    cost.txFeeUsd = m6((BASE_FEE_LAMPORTS + prio) / 1e9 * sol);
    cost.roundTripPct = -candNet(0, cost, liq0);
  }
  const tags = [...arr(ctx.regimeTags)], qc = ctx.quoteCheck, seen = ctx.seen, ab = arr(D.analysisBlockers), x0 = [0, 0, liq0 != null ? 0 : null, 1];
  return {
    v: CAND_VERSION, id: 'C-' + now.toString(36) + '-' + hashStr(t.id).toString(36) + (why === 'TRIGGER' ? 'T' : ''), app: ctx.app || null, why, ts: now, t0,
    tokenId: t.id, mint: t.mint, symbol: t.symbol, pair: A.core.pairAddress || null, dex: A.core.dexId || null, source: A.core.source || null, mode: ctx.mode || null,
    entry: buildEntryFeatures(t, A, D, tags, now),
    decision: {
      decision: D.decision, stage: PIPELINE[D.stageReached] || null, analysisCodes: ab.map(b => b.code), execCodes: arr(D.execBlockers).map(b => b.code), wouldBuy: !ab.length,
      strategy: D.strategy || null, positionSize: isNum(D.positionSize) ? lr2(D.positionSize) : null, paramVersion: ctx.paramVersion != null ? ctx.paramVersion : null, modelVersion: ctx.modelVersion || null, settingsHash: ctx.settingsHash || null
    },
    context: {
      regimeTags: tags, inUniverseMs: t.meta && isNum(t.meta.discoveredAt) ? now - t.meta.discoveredAt : null, firstSeenMc: seen && isNum(seen.mc) ? seen.mc : null, firstSeenAt: seen && isNum(seen.t) ? seen.t : null,
      histN: arr(t.hist).length, taSource: A.ta ? (/OHLCV/.test(A.ta.source) ? 'ohlcv' : 'live') : null, crossChecked: !!A.crossChecked, impactPlannedPct: lr2(A.liq.impactPlanned),
      quote: qc ? { roundTripPct: isNum(qc.roundTripPct) ? qc.roundTripPct : null, noSellRoute: !!qc.noSellRoute, ageMs: isNum(qc.at) ? now - qc.at : null } : null
    },
    cost, trade: null,
    _: { p0, liq0, lastAt: t0, lastS: 0, n: 1, nExt: 0, maxGap: 0, s: [x0], mx: x0, mn: x0, ml: liq0 != null ? x0 : null, last: x0, hTp: false, hSl: false, hRug: false, misses: 0, poolSwitch: false, truncated: false, done: false }
  };
}

/* Neuer Kurs für einen offenen Datensatz. obs: { at (snap.fetchedAt), price, liq, pair, ext (vom Verfolger) }.
   Nur neuere Abrufe (at > lastAt) innerhalb des Horizonts. Barrieren werden auf JEDEM Kurs geprüft, gespeichert werden Proben
   im 15-s-/30-s-Takt plus die erste Überschreitung jeder Barriere (→ Label aus path.s reproduzierbar). Werte gerundet wie gespeichert.
   Anderer Pool als beim Einstieg: Kurs zählt, Liquidität nicht vergleichbar (null) und Flag POOL_SWITCH. */
function candObserve(c, obs) {
  const _ = c && c._; if (!_ || _.done || !obs || !isNum(obs.at) || !(obs.at > _.lastAt) || !isNum(obs.price) || !(obs.price > 0)) return false;
  const L = CAND_LABEL, K = CAND_DEFAULTS, tRel = obs.at - c.t0;
  if (tRel > L.horizonMin * MIN) return false;
  const sw = !!(obs.pair && c.pair && obs.pair !== c.pair); if (sw) _.poolSwitch = true;
  const t = Math.round(tRel / 1000), pct = lr2((obs.price / _.p0 - 1) * 100), lq = !sw && isNum(obs.liq) && _.liq0 > 0 ? lr2((obs.liq / _.liq0 - 1) * 100) : null;
  const gap = Math.round((obs.at - _.lastAt) / 1000); if (gap > _.maxGap) _.maxGap = gap;
  _.lastAt = obs.at; _.n++; if (obs.ext) _.nExt++; _.misses = 0;
  const x = [t, pct, lq, _.n]; // 4. Feld: laufende Nummer (nur intern, für die Reihenfolge)
  _.last = x;
  if (pct > _.mx[1]) _.mx = x;
  if (pct < _.mn[1]) _.mn = x;
  if (lq != null && (!_.ml || lq < _.ml[2])) _.ml = x;
  let hit = false;
  if (!_.hTp && pct >= L.tpPct) { _.hTp = true; hit = true; }
  if (!_.hSl && pct <= -L.slPct) { _.hSl = true; hit = true; }
  if (!_.hRug && lq != null && lq <= L.rugLiqPct) { _.hRug = true; hit = true; }
  const due = t - _.lastS >= (t <= K.sample15UntilSec ? K.sampleEarlySec : K.sampleLateSec);
  if (due || hit) { _.s.push(x); if (due) _.lastS = t; }
  return true;
}

/* Datenqualität eines (abgeschlossenen) Datensatzes – für Training nur quality.ok verwenden. */
function candQuality(c) {
  const _ = c._ || {}, K = CAND_DEFAULTS, flags = [];
  if (!(_.n >= K.fewSamples)) flags.push('FEW_SAMPLES');
  if (_.maxGap > K.gapSec) flags.push('GAPS');
  if (_.truncated) flags.push('TRUNCATED');
  if (_.misses >= K.vanishMisses) flags.push('VANISHED');
  if (_.poolSwitch) flags.push('POOL_SWITCH');
  if (!c.cost || c.cost.roundTripPct == null) flags.push('NO_COST');
  return { v: 1, ok: !flags.length, flags };
}

/* Abschluss: Horizont erreicht (end 'HORIZON') oder vorzeitig (SHUTDOWN/RELOAD → TRUNCATED, falls der Horizont fehlt).
   Proben + Extremwerte (MFE, MAE, tiefste Liquidität) + letzter Kurs → path.s; Label daraus. Gibt den fertigen Datensatz zurück. */
function candFinish(c, now, end) {
  const _ = c._, stop = Math.min(now, c.t0 + CAND_LABEL.horizonMin * MIN);
  _.done = true; _.truncated = now < c.t0 + CAND_LABEL.horizonMin * MIN;
  const tailGap = Math.round(Math.max(0, stop - _.lastAt) / 1000); if (tailGap > _.maxGap) _.maxGap = tailGap;
  const all = [..._.s]; for (const x of [_.mx, _.mn, _.ml, _.last]) if (x && !all.includes(x)) all.push(x);
  all.sort((a, b) => a[3] - b[3]);
  const s = all.map(x => [x[0], x[1], x[2]]), quality = candQuality(c);
  const label = candLabel(s, CAND_LABEL, c.cost, { vanished: quality.flags.includes('VANISHED') });
  const { _: drop, trade, ...head } = c;
  return { ...head, label, path: { n: _.n, nExt: _.nExt, maxGapSec: _.maxGap, tEndSec: _.last[0], s }, quality, trade: trade || null, end };
}

/* Verfolger: aus den DexScreener-Pools eines Coins den Einstiegs-Pool wählen, sonst den mit der höchsten Liquidität (switched). */
function candPickPair(snaps, mint, pair) {
  let best = null;
  for (const sn of arr(snaps)) {
    if (!sn || sn.mint !== mint || !isNum(sn.priceUsd) || !(sn.priceUsd > 0)) continue;
    if (pair && sn.pairAddress === pair) return { snap: sn, switched: false };
    if (!best || (sn.liquidityUsd || 0) > (best.liquidityUsd || 0)) best = sn;
  }
  return best ? { snap: best, switched: !!pair && best.pairAddress !== pair } : null;
}
