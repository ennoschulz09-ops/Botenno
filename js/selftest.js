/* Smart Lab – selftest.js
   Selbsttests: Test-Harness (Mock-Netzwerk, Speicher im Arbeitsspeicher) und alle Selbsttests
   Klassisches Skript ohne Build-Schritt: alle Dateien teilen sich den globalen Gültigkeitsbereich und werden in fester
   Reihenfolge geladen (index.html bzw. server/load-core.js): base → engine → learning → core → selftest → ui.
   base, engine, learning, core und selftest laufen auch ohne Browser (Node.js); nur ui.js braucht das DOM. */
'use strict';

/* ============================== TESTING SYSTEM (Selbsttest & Chaos-Tests) ==============================
   Läuft ausschließlich gegen isolierte Core-Instanzen mit Memory-Storage und Mock-Netzwerk.
   TESTDATEN werden nie im Live-Scanner angezeigt und nie gespeichert. */
function mockResponse(status, body, headers = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, headers: { get: k => (k.toLowerCase() in headers ? headers[k.toLowerCase()] : null) }, text: async () => text };
}
const tMint = n => ('Tst' + n).padEnd(40, 'A');
function makeTestHarness() {
  let offset = 0; let online = true;
  const base = Date.UTC(2026, 0, 5, 12, 0, 0), start = Date.now();
  const H = { market: {}, fail: null, rpcFail: false, rugFail: false, delays: {}, calls: [] };
  const env = {
    now: () => base + (Date.now() - start) + offset, advance: ms => { offset += ms; },
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id),
    random: () => 0.5, online: () => online, setOnline: v => { online = v; }, walletProvider: () => null,
    fetch: async (url, init) => {
      H.calls.push(url);
      if (init && init.signal && init.signal.aborted) throw new DOMException('aborted', 'AbortError');
      if (H.fail) { const f = H.fail(url, init); if (f) { if (f instanceof Error) throw f; return mockResponse(f.status, f.body, f.headers || {}); } }
      const d = Object.keys(H.delays).find(k => url.includes(k));
      if (d) await new Promise(r => setTimeout(r, H.delays[d]));
      if (url.startsWith(DEX_API + '/tokens/v1/solana/')) {
        const mints = url.split('/').pop().split(',');
        if (mints.length === 1 && mints[0] === WSOL) return mockResponse(200, [{ chainId: 'solana', dexId: 'raydium', pairAddress: tMint(9), baseToken: { address: WSOL, symbol: 'SOL', name: 'Wrapped SOL' }, quoteToken: { address: USDC, symbol: 'USDC' }, priceUsd: '150.00', liquidity: { usd: 5e6 }, volume: {}, txns: {}, priceChange: { h1: 0.5, h24: 2 } }]);
        return mockResponse(200, mints.filter(m => H.market[m]).map(m => H.market[m]()));
      }
      if (url.startsWith(DEX_API)) return mockResponse(200, []);
      if (url.startsWith(GT_API)) return mockResponse(200, url.includes('/ohlcv/') ? { data: { attributes: { ohlcv_list: [] } } } : { data: [] });
      if (url.startsWith(RUG_API)) return H.rugFail ? mockResponse(500, 'err') : mockResponse(200, { score: 120, score_normalised: 4, risks: [], lpLockedPct: 100 });
      if (url.startsWith(JUP_API_FREE) || url.startsWith(JUP_API_KEYED)) return H.jupiter(url, init);
      if (init && init.method === 'POST') {
        if (H.rpcFail) return mockResponse(503, 'down');
        const body = parseJSON(init.body, {});
        if (body.method === 'getAccountInfo') return mockResponse(200, { jsonrpc: '2.0', id: 1, result: { value: { owner: TOKEN_PROGRAM, data: { parsed: { type: 'mint', info: { decimals: 6, supply: '1000000000000', mintAuthority: null, freezeAuthority: null, isInitialized: true } } } } } });
        if (body.method === 'getTokenLargestAccounts') return mockResponse(200, { jsonrpc: '2.0', id: 1, result: { value: Array.from({ length: 10 }, (_, i) => ({ address: tMint(i + 1), amount: '20000000000', decimals: 6 })) } });
        if (body.method === 'getSlot') return mockResponse(200, { jsonrpc: '2.0', id: 1, result: 300000000 });
        if (body.method === 'getBalance') return mockResponse(200, { jsonrpc: '2.0', id: 1, result: { value: 1000000000 } });
        if (body.method === 'getRecentPrioritizationFees') return mockResponse(200, { jsonrpc: '2.0', id: 1, result: Array.from({ length: 8 }, (_, i) => ({ slot: 300000000 + i, prioritizationFee: H.prioFee * (i + 1) / 8 })) });
        return mockResponse(200, { jsonrpc: '2.0', id: 1, error: { message: 'unbekannte Methode' } });
      }
      return mockResponse(404, 'not found');
    }
  };
  H.env = env;
  /* Jupiter-Attrappe: Konstantprodukt-AMM auf Preis/Liquidität des Test-Pairs (6 Decimals, SOL 150 $, 0,25 % Gebühr + optionale Steuer). */
  H.prioFee = 1000; H.jup = { noRoute: new Set(), noSell: new Set(), taxPct: 0, down: false, calls: 0, buyOutFactor: 1 };
  H.jupiter = (url, init) => {
    H.jup.calls++; H.jup.lastHeaders = (init && init.headers) || null;
    if (H.jup.down) return mockResponse(503, 'down');
    const u = new URL(url), inM = u.searchParams.get('inputMint'), outM = u.searchParams.get('outputMint'), amt = Number(u.searchParams.get('amount')), bps = Number(u.searchParams.get('slippageBps'));
    const buy = inM === WSOL, mint = buy ? outM : inM, pf = H.market[mint];
    if (!pf || H.jup.noRoute.has(mint) || (!buy && H.jup.noSell.has(mint))) return mockResponse(400, { error: 'Could not find any route', errorCode: 'COULD_NOT_FIND_ANY_ROUTE' });
    const pr = pf(), price = Number(pr.priceUsd), liq = pr.liquidity.usd, sol = 150, keep = 1 - 0.0025 - H.jup.taxPct / 100;
    let out;
    if (buy) { const usd = amt / 1e9 * sol; out = Math.floor(usd * keep / (price * (1 + usd / (liq / 2))) * 1e6 * H.jup.buyOutFactor); } // Faktor ≠ 1: Jupiter-Kurs weicht vom Marktkurs ab
    else { const usd = amt / 1e6 * price; out = Math.floor(usd * keep / (1 + usd / (liq / 2)) / sol * 1e9); }
    return mockResponse(200, { inputMint: inM, outputMint: outM, inAmount: String(amt), outAmount: String(out), otherAmountThreshold: String(Math.floor(out * (1 - bps / 1e4))), slippageBps: bps, priceImpactPct: '0', routePlan: [{ swapInfo: { label: 'Raydium' }, percent: 100 }], contextSlot: 1 });
  };
  H.pair = (mint, o = {}) => () => ({
    chainId: 'solana', dexId: 'raydium', url: 'https://dexscreener.com/solana/test', pairAddress: o.pair || ('Pa' + mint.slice(3)),
    baseToken: { address: mint, name: 'Testtoken ' + mint.slice(3, 5), symbol: o.sym || 'TST' + mint.slice(3, 4) }, quoteToken: { address: WSOL, symbol: 'SOL' },
    priceUsd: o.price === null ? null : String(o.price != null ? o.price : 0.001), priceNative: '0.0000066',
    txns: { m5: { buys: o.b5 != null ? o.b5 : 60, sells: o.s5 != null ? o.s5 : 30 }, h1: { buys: o.b1 != null ? o.b1 : 600, sells: o.s1 != null ? o.s1 : 350 }, h6: { buys: 2000, sells: 1500 }, h24: { buys: 5000, sells: 4000 } },
    volume: { m5: o.v5 != null ? o.v5 : 12000, h1: o.v1 != null ? o.v1 : 80000, h6: 300000, h24: 900000 },
    priceChange: { m5: o.c5 != null ? o.c5 : 6, h1: o.c1 != null ? o.c1 : 12, h6: 20, h24: 40 },
    liquidity: { usd: o.liq != null ? o.liq : 150000 }, fdv: o.mc || 1500000, marketCap: o.mc || 1500000, pairCreatedAt: env.now() - 3 * DAY
  });
  return H;
}
async function testCore(H, settings) {
  const core = createCore({ env: H.env, backend: H.backend || (H.backend = createMemoryBackend()) });
  core.init({ autoStart: false });
  core.updateSettings({ minPairAgeMin: 0, simLatencyMs: 0, ...(settings || {}) }, 'TEST'); // Wartezeit nur in eigenen Tests (Laufzeit)
  await core._t.updateSolPrice(true);
  return core;
}
async function prepToken(core, H, n, o) {
  const m = tMint(n); H.market[m] = H.pair(m, o);
  core._t.ensureToken(m, 'Test');
  await core._t.fetchChunk([m], true);
  const t = core.state.markets.get(tokenIdOf(m));
  t.sec = await core._t.checkSecurity(m);
  return t;
}
const codes = r => (r && r.blockers ? r.blockers.map(b => b.code) : []);
function assert(c, msg) { if (!c) throw new Error(msg); }

/* Lern-KI-Testdaten (TESTDATEN – nur in isolierten Instanzen, nie gespeichert oder angezeigt) */
function mkLearnRec(i, o = {}) {
  const t0 = Date.UTC(2026, 0, 1) + i * 20 * MIN, pnlPct = o.pnlPct != null ? o.pnlPct : 5, size = 50, pnlUsd = lr2(size * pnlPct / 100 - 0.2), regime = o.regime || ['CHOPPY', 'NEUTRAL'];
  return {
    v: LEARN_VERSION, tradeId: 'TST-' + String(i).padStart(4, '0'), tokenId: tokenIdOf(tMint(i % 9 + 1)), symbol: 'TST' + i, openedAt: t0, closedAt: t0 + 10 * MIN, mode: 'SIMULATION', strategy: o.strategy || 'momentum', paramVersion: 1, modelVersion: 'M-1', regimeTags: [...regime], legacy: false,
    entry: { v: FEATURE_VERSION, ts: t0 + (o.entryTs != null ? o.entryTs : -2000), finalScore: o.score != null ? o.score : 75, confidence: 75, risk: 30, liquidity: 80000, volPct: o.vol != null ? o.vol : 2, buyerRatio1h: 0.6, txRate1h: 900, chg5m: 3, chg1h: o.chg1h != null ? o.chg1h : 10, secStatus: 'VERIFIED', signals: [{ type: 'MOMENTUM', strength: 60 }], sigMax: 60, pumpState: 'NORMAL', pairAgeMin: 600, ageClass: 'YOUNG', labels: { price: 'LIVE' }, conflicts: 0, fallback: false, regime: [...regime], missing: [] },
    execution: { sizeUsd: size, feesUsd: 0.2, slippageUsd: 0.1, entryLatencyMs: 300, estimatedImpactPct: 0.1, exitImpactPct: 0.1, sizePct: 5 },
    path: { mae1m: 0, mae2m: -1, mae5m: -2, mae15m: -3, mfe2m: 2, maxRunupPct: Math.max(0, pnlPct) + 2, maxDrawdownPct: -3, samples: [], n: 10, minLiqPct: 0 },
    exit: { reason: pnlPct < 0 ? 'STOP_LOSS' : 'TP1', marketPnlPct: pnlPct, holdMs: 10 * MIN, exits: 1 },
    outcome: { pnlUsd, pnlPct, win: pnlUsd > 0 }, labels: null, followUp: null, cf: null, revisions: []
  };
}
/* Score 62 verliert systematisch, Score 80 gewinnt (echter Effekt) bzw. mit noise: Ergebnis unabhängig vom Score. */
const oosSet = (n, noise) => Array.from({ length: n }, (_, i) => { const low = i % 2 === 1; return mkLearnRec(i, { score: low ? 62 : 80, pnlPct: noise ? (i % 4 < 2 ? -8 : 8) : low ? -10 - (i % 3) : 6 + (i % 5) }); });
const learnTestBase = () => ({ minScore: 60, minConfidence: 60, minLiq: 10000, minPairAgeMin: 0, stopLossPct: 15, trailPct: 12, requireVerifiedSecurity: false, trailActivatePct: 25, tp3Pct: 120, rules: emptyRules() });
const learnTestCfg = { minTest: 8, championId: 'M-1', drift: 'STABLE' };
async function learnTrade(H, core, n, exitPrice) {
  const t = await prepToken(core, H, n);
  const b = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(b.ok, 'Buy fehlgeschlagen: ' + codes(b).join(',') + (b.error || ''));
  const feat = JSON.stringify(b.order.decision.features), pos = core.state.positions.find(p => p.tokenId === t.id);
  H.env.advance(30 * SEC); H.market[t.mint] = H.pair(t.mint, { price: exitPrice }); await core._t.fetchChunk([t.mint], true); await core._t.managePositions();
  const s = await core.executeSell(pos.id, 'ALL', 'MANUAL'); assert(s.ok, 'Sell fehlgeschlagen: ' + (s.error || codes(s).join(',')));
  return { t, pos, feat, rec: core.state.learn.records.find(r => r.tradeId === pos.id) };
}

/* Backtest-Testdaten: deterministische Kerzen mit periodischen Volumen-/Preisschüben */
function btTestCandles() { const c = []; let p = 1; for (let i = 0; i < 300; i++) { const o = p; p = p * (1 + Math.sin(i / 7) * 0.02 + (i % 50 === 25 ? 0.12 : 0)); c.push({ t: i * MIN, o, h: Math.max(o, p) * 1.01, l: Math.min(o, p) * 0.99, c: p, v: 1000 + (i % 50 === 25 ? 9000 : 0) }); } return c; }
const btTestCfg = () => ({ strategy: 'volume', capital: 1000, sizePct: 10, feePct: 0.3, slipPct: 0.5, tpPct: 10, slPct: 8, trailActPct: 8, trailPct: 5, timeBars: 30 });

const SELF_TESTS = [
  ['Grundlagen', 'Token-Identität: solana:<mint>, nie nur Symbol', async () => {
    const a = tMint(1), b = tMint(2);
    assert(tokenIdOf(a) === 'solana:' + a, 'ID-Format falsch');
    assert(tokenIdOf(a) !== tokenIdOf(b), 'unterschiedliche Mints müssen unterschiedliche IDs haben');
    assert(!isMint('0OIl-invalid') && !isMint('SOL'), 'ungültige Mint akzeptiert');
    const H = makeTestHarness(); const core = await testCore(H);
    await prepToken(core, H, 1, { sym: 'SAME' }); await prepToken(core, H, 2, { sym: 'SAME' });
    assert(core.state.markets.size === 2, 'Gleiches Symbol darf Tokens nicht zusammenlegen');
    return 'gleiches Symbol → 2 getrennte Tokens';
  }],
  ['Grundlagen', 'Decimal Precision & SOL/Lamports', async () => {
    assert(fmtPrice(0.00001234) === '$0.0₄1234', 'fmtPrice klein: ' + fmtPrice(0.00001234));
    assert(lamportsToSol(1234567890n) === '1.234567890', 'lamportsToSol');
    assert(solToLamports('0.000005') === 5000n && solToLamports('1.5') === 1500000000n, 'solToLamports');
    assert(rawToUi('1234500', 6) === 1.2345, 'rawToUi');
    return 'Preise, SOL und Token-Decimals exakt';
  }],
  ['Grundlagen', 'Config Validation: Bereiche, Logik-Checks, Limits frei einstellbar', async () => {
    const { settings: s, errors } = validateSettings({ simCapitalUsd: -5, maxBuysPerCoin: 5, sellCooldownMin: 1, lossStreakLimit: 9, scanIntervalMs: 'abc', minMcap: 1e6, maxMcap: 1e5 });
    assert(s.simCapitalUsd === 10, 'negatives Kapital nicht begrenzt');
    assert(s.maxBuysPerCoin === 5 && s.sellCooldownMin === 1 && s.lossStreakLimit === 9, 'Limits nicht frei einstellbar: ' + [s.maxBuysPerCoin, s.sellCooldownMin, s.lossStreakLimit]);
    const off = validateSettings({ maxBuysPerCoin: 0, sellCooldownMin: 0, lossStreakLimit: 0, dailyLossLimitPct: 0, ddStopPct: 0, ddReducePct: 0, maxTradesPerHour: 0, maxOpenPositions: 0, correlationLimit: 0, maxExposurePct: 100 }).settings;
    assert(off.maxBuysPerCoin === 0 && off.sellCooldownMin === 0 && off.lossStreakLimit === 0 && off.dailyLossLimitPct === 0 && off.ddStopPct === 0 && off.ddReducePct === 0 && off.maxTradesPerHour === 0 && off.maxOpenPositions === 0 && off.correlationLimit === 0 && off.maxExposurePct === 100, '0 = aus nicht einstellbar');
    assert(s.scanIntervalMs === 1000 && errors.some(e => e.key === 'scanIntervalMs'), 'NaN nicht abgelehnt');
    assert(s.minMcap <= s.maxMcap && errors.some(e => /Market Cap/.test(e.msg)), 'Min/Max nicht geprüft');
    assert(!Object.keys(TUNING_BOUNDS).some(k => ['maxBuysPerCoin', 'sellCooldownMin', 'lossCooldownMin', 'globalPauseMin', 'maxExposurePct'].includes(k)), 'Auto-Tuning darf Risiko-Limits nicht verändern');
    return `${errors.length} Validierungsfehler korrekt erkannt · alle Limits bis 0 = aus einstellbar`;
  }],
  ['Grundlagen', 'Grenzwert-Fuzz: keine Eingabe erzeugt ungültige Einstellungen', async () => {
    const pool = [-1e9, -1, 0, 0.4, 1, 2, 3, 4, 7, 50, 51, 99, 1e9, NaN, Infinity, -Infinity, '12', '-5', 'abc', '', null, true, {}, [], '1e308'];
    const keys = ['maxBuysPerCoin', 'sellCooldownMin', 'lossCooldownMin', 'lossStreakLimit', 'globalPauseMin', 'minTradesForTuning', 'maxExposurePct', 'maxPositionPct', 'minScore', 'stopLossPct', 'simCapitalUsd', 'maxSlippagePct'];
    const rnd = prng(4242);
    for (let i = 0; i < 400; i++) {
      const input = {}; for (const k of keys) if (rnd() < 0.7) input[k] = pool[Math.floor(rnd() * pool.length)];
      const { settings: o } = validateSettings(input);
      const bad = [];
      for (const k of keys) { const d = SETTINGS_INDEX[k]; if (!(o[k] >= d.min && o[k] <= d.max)) bad.push(k + ' außerhalb ' + d.min + '–' + d.max); }
      if (!(o.maxPositionPct <= o.maxExposurePct)) bad.push('Position > Exposure');
    for (const k of keys) if (!isNum(o[k])) bad.push(k + ' nicht endlich');
      assert(!bad.length, `Eingabe ${JSON.stringify(input)} verletzt: ${bad.join(', ')}`);
    }
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1); core._t.analyzeAll();
    const eq = core.equityInfo().equity, S = core.S();
    for (const sz of [null, -5, 0, NaN, 4.99, 1e9, eq * S.maxPositionPct / 100 + 0.01]) {
      const x = core.execCheck(t, { sizeUsd: sz, auto: false });
      if (x.sizing.size > 0) assert(x.sizing.size <= eq * S.maxPositionPct / 100 + 1e-6 && x.sizing.size <= core.state.portfolio.cash + 1e-6, `Größe ${x.sizing.size} über Limit (Eingabe ${sz})`);
      else assert(x.blockers.some(b => b.code === 'SIZE_ZERO'), `ungültige Größe ${sz} nicht blockiert`);
    }
    return '400 Zufallseingaben · alle Werte im gültigen Bereich · Positionsgröße nie über Max./Cash';
  }],
  ['Daten', 'Datenvalidierung: NaN/Infinity/negativ/unplausibel → null (nie 0) und gezählt', async () => {
    const dq = newDq(), m = tMint(3);
    const sn = normDexPair({ chainId: 'solana', baseToken: { address: m, symbol: 'X' }, priceUsd: '0', liquidity: { usd: -500 }, volume: { h1: 'NaN', m5: 'Infinity', h24: 5e15 }, priceChange: { m5: 1e9, h1: '12.5' }, marketCap: 'abc', fdv: 1000 }, 1, dq);
    assert(sn && sn.priceUsd === null && sn.liquidityUsd === null && sn.vol.h1 === null && sn.vol.m5 === null && sn.vol.h24 === null && sn.chg.m5 === null && sn.chg.h1 === 12.5 && sn.marketCap === null && sn.fdv === 1000, 'ungültige Werte nicht verworfen: ' + JSON.stringify(sn));
    assert(dq.invalidFields === 7 && dq.accepted === 1 && dq.byField.liquidityUsd === 1, 'Zählung falsch: ' + JSON.stringify(dq));
    assert(normDexPair({ chainId: 'solana', baseToken: { address: 'kein-mint' } }, 1, dq) === null && normDexPair({ chainId: 'eth' }, 1, dq) === null && dq.rejected === 2, 'verworfene Datensätze nicht gezählt');
    const c = normOhlcv({ data: { attributes: { ohlcv_list: [[1, 1, 2, 0.5, 1.5, 10], [2, 1, 0.5, 2, 1, 10], [3, NaN, 1, 1, 1, 1], [4, 1, 1, 1, 1, -1]] } } }, dq);
    assert(c.length === 1, 'ungültige Kerzen übernommen');
    return `${dq.invalidFields} ungültige Felder und ${dq.rejected} verworfene Datensätze korrekt erkannt`;
  }],
  ['System', 'Voll-Backup: Export → Prüfung → Wiederherstellen; defekte/neuere Sicherungen abgelehnt', async () => {
    const H = makeTestHarness(); const core = await testCore(H, { minScore: 72 });
    const t = await prepToken(core, H, 1);
    assert((await core.executeBuy(t.id, { sizeUsd: 20 })).ok, 'Buy fehlgeschlagen');
    const b = core.exportBackup();
    assert(b.kind === 'backup' && b.storage.settings && b.storage.positions && b.storage.learning && !JSON.stringify(b).includes('loginPass'), 'Backup unvollständig');
    const bad = [[{ ...b, kind: 'x' }, /Kennung/], [{ ...b, app: '99.0.0' }, /neueren Version/], [{ ...b, storage: { ...b.storage, trades: { v: 2 } } }, /beschädigt/], [{ ...b, storage: { ...b.storage, evil: { v: 3 } } }, /Unbekannte/], [{ ...b, storageVersion: 2 }, /Speicherversion/]];
    for (const [x, rx] of bad) { const r = core.validateBackup(x); assert(r && rx.test(r), 'nicht abgelehnt: ' + r); }
    const H2 = makeTestHarness(); const target = await testCore(H2);
    const r = target.restoreBackup(JSON.parse(JSON.stringify(b)));
    assert(r.ok, 'Wiederherstellen fehlgeschlagen: ' + r.error);
    const c3 = createCore({ env: H2.env, backend: H2.backend }); c3.init({ autoStart: false });
    assert(c3.state.positions.length === 1 && c3.state.positions[0].id === core.state.positions[0].id && c3.S().minScore === 72 && !c3.state.reconciliation.required, 'Stand nach Wiederherstellen abweichend');
    assert(c3.state.auditLog.some(a => a.what === 'RESTORE'), 'Wiederherstellen nicht protokolliert');
    return 'Export vollständig · 5 fehlerhafte Varianten abgelehnt · Stand 1:1 wiederhergestellt · protokolliert';
  }],
  ['Trading', 'Max. 2 Käufe pro Coin (Buy #3 BLOCKED)', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    const r1 = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(r1.ok, 'Buy #1 fehlgeschlagen: ' + codes(r1).join(',') + (r1.error || ''));
    H.market[t.mint] = H.pair(t.mint, { price: 0.0013 }); await core._t.fetchChunk([t.mint], true); await core._t.managePositions();
    const r2 = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(r2.ok, 'Buy #2 fehlgeschlagen: ' + codes(r2).join(','));
    H.market[t.mint] = H.pair(t.mint, { price: 0.002 }); await core._t.fetchChunk([t.mint], true);
    const r3 = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(!r3.ok && codes(r3).includes('BUY_LIMIT_REACHED'), 'Buy #3 nicht blockiert: ' + codes(r3).join(','));
    return 'Buy #1 ✓ · Buy #2 ✓ · Buy #3 BUY_LIMIT_REACHED';
  }],
  ['Trading', 'Coin-Cooldown 15 min nach Verkauf', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    assert((await core.executeBuy(t.id, { sizeUsd: 20 })).ok, 'Buy fehlgeschlagen');
    const s = await core.executeSell(core.state.positions[0].id, 'ALL', 'MANUAL'); assert(s.ok, 'Sell fehlgeschlagen');
    const r = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(codes(r).includes('COOLDOWN_ACTIVE'), 'kein Coin-Cooldown: ' + codes(r).join(','));
    H.env.advance(15 * MIN + SEC); await core._t.updateSolPrice(true); t.sec = await core._t.checkSecurity(t.mint);
    const r2 = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(!codes(r2).includes('COOLDOWN_ACTIVE'), 'Cooldown nach 15 min noch aktiv');
    return 'Cooldown aktiv direkt nach Verkauf, frei nach 15 min';
  }],
  ['Trading', 'Loss-Cooldown & globale Pause: Standard 0 (aus), einstellbar, nie negativ', async () => {
    assert(SETTINGS_INDEX.lossCooldownMin.min === 0 && SETTINGS_INDEX.globalPauseMin.min === 0 && defaultSettings().lossCooldownMin === 0 && defaultSettings().globalPauseMin === 0, 'Standard/Untergrenze nicht 0');
    const v = validateSettings({ lossCooldownMin: -5, globalPauseMin: -3 }).settings;
    assert(v.lossCooldownMin === 0 && v.globalPauseMin === 0, 'negative Werte nicht auf 0 begrenzt: ' + v.lossCooldownMin + '/' + v.globalPauseMin);
    // Standard 0/0: drei Verluste in Folge → weder Cooldown noch Pause, aber Review-Hinweis
    const H0 = makeTestHarness(); const c0 = await testCore(H0);
    for (let i = 1; i <= 3; i++) {
      const t = await prepToken(c0, H0, i);
      assert((await c0.executeBuy(t.id, { sizeUsd: 20 })).ok, `Buy ${i} fehlgeschlagen`);
      assert((await c0.executeSell(c0.state.positions[0].id, 'ALL', 'MANUAL')).ok, 'Sell fehlgeschlagen');
    }
    const p0 = await c0.executeBuy((await prepToken(c0, H0, 7)).id, { sizeUsd: 20 });
    assert(c0.state.risk.lossStreak === 3 && c0.state.risk.reviewRequired && !codes(p0).includes('LOSS_COOLDOWN') && !codes(p0).includes('GLOBAL_PAUSE') && p0.ok, 'Cooldown/Pause trotz 0 aktiv: ' + codes(p0).join(','));
    // Einstellbar: mit 10 / 5 min greifen beide und laufen ab
    const H = makeTestHarness(); const core = await testCore(H, { lossCooldownMin: 10, globalPauseMin: 5 });
    assert(core.S().lossCooldownMin === 10 && core.S().globalPauseMin === 5, 'Einstellung 10/5 nicht übernommen');
    const refresh = async () => { await core._t.updateSolPrice(true); };
    for (let i = 1; i <= 3; i++) {
      const t = await prepToken(core, H, i);
      const b = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(b.ok, `Buy ${i} fehlgeschlagen: ` + codes(b).join(','));
      const s = await core.executeSell(core.state.positions[0].id, 'ALL', 'MANUAL'); assert(s.ok, 'Sell fehlgeschlagen');
      const probe = await core.executeBuy((await prepToken(core, H, 10 + i)).id, { sizeUsd: 20 });
      assert(codes(probe).includes('LOSS_COOLDOWN'), `Loss-Cooldown greift nach Verlust ${i} nicht: ` + codes(probe).join(','));
      if (i === 3) break;
      H.env.advance(10 * MIN + SEC); await refresh();
      const free = await core.executeBuy((await prepToken(core, H, 20 + i)).id, { sizeUsd: 1 });
      assert(!codes(free).includes('LOSS_COOLDOWN'), 'Loss-Cooldown nach 10 min noch aktiv');
    }
    assert(core.state.risk.lossStreak === 3, 'Verlustserie ' + core.state.risk.lossStreak);
    const p8 = await core.executeBuy((await prepToken(core, H, 8)).id, { sizeUsd: 20 });
    assert(codes(p8).includes('GLOBAL_PAUSE'), 'globale Pause nach 3 Verlusten fehlt: ' + codes(p8).join(','));
    H.env.advance(10 * MIN + SEC); await refresh();
    const p9 = await core.executeBuy((await prepToken(core, H, 9)).id, { sizeUsd: 20 });
    assert(!codes(p9).includes('GLOBAL_PAUSE') && !codes(p9).includes('LOSS_COOLDOWN'), 'Pause/Cooldown laufen nicht ab: ' + codes(p9).join(','));
    // Umstellung 2.8.0: gespeicherte 10/5 aus 2.7.0 → 0/0, laufende Pause/Cooldown beendet, protokolliert
    const Hm = makeTestHarness(); Hm.backend = createMemoryBackend(); const nm = Hm.env.now();
    Hm.backend.set(STORAGE_KEYS.settings, JSON.stringify({ v: STORAGE_VERSION, settings: { lossCooldownMin: 10, globalPauseMin: 5 }, strategies: {}, watchlist: {}, ui: {} }));
    Hm.backend.set(STORAGE_KEYS.runtime, JSON.stringify({ v: STORAGE_VERSION, tradeSeq: 0, savedAt: nm, app: '2.7.0', mode: 'SIMULATION', risk: { lossCooldownUntil: nm + 10 * MIN, globalPauseUntil: nm + 5 * MIN, lossStreak: 3 } }));
    const cm = createCore({ env: Hm.env, backend: Hm.backend }); cm.init({ autoStart: false });
    assert(cm.S().lossCooldownMin === 0 && cm.S().globalPauseMin === 0 && cm.state.risk.lossCooldownUntil === 0 && cm.state.risk.globalPauseUntil === 0, 'Umstellung 2.8.0: Werte/laufende Pause nicht zurückgesetzt');
    assert(cm.state.configLog.some(c => c.who === 'MIGRATION' && c.changes.some(x => x.key === 'lossCooldownMin' && x.from === 10 && x.to === 0)), 'Umstellung 2.8.0 nicht protokolliert');
    return 'Standard 0/0: kein Cooldown, keine Pause, Review-Hinweis · eingestellt 10/5: Cooldown nach jedem Verlust, Pause nach 3 Verlusten, beide laufen ab · Umstellung aus 2.7.0 protokolliert';
  }],
  ['Trading', 'Lernmodus (ohne Limits): keine Limit-Sperren mehr – Security- & Datenprüfungen bleiben', async () => {
    const H = makeTestHarness(); const core = await testCore(H, PROFILES['Lernmodus (ohne Limits)']), S = core.S();
    assert(S.maxBuysPerCoin === 0 && S.sellCooldownMin === 0 && S.dailyLossLimitPct === 0 && S.ddStopPct === 0 && S.maxTradesPerHour === 0 && S.maxOpenPositions === 0 && !S.addOnlyInProfit && !S.autoSafeMode && S.minScore === 65, 'Profil nicht (nur auf Limits) angewendet');
    const LIMITS = ['BUY_LIMIT_REACHED', 'COOLDOWN_ACTIVE', 'STRATEGY_COOLDOWN', 'LOSS_COOLDOWN', 'GLOBAL_PAUSE', 'NO_AVERAGING_DOWN', 'OVERTRADING', 'MAX_POSITIONS', 'DAILY_LOSS_LIMIT', 'DRAWDOWN_LIMIT', 'CONCENTRATION', 'LOW_QUALITY_MARKET'];
    const limitHit = r => codes(r).filter(c => LIMITS.includes(c));
    const t = await prepToken(core, H, 1), price = async p => { H.market[t.mint] = H.pair(t.mint, { price: p }); await core._t.fetchChunk([t.mint], true); };
    for (let i = 1; i <= 4; i++) { // gleicher Coin, 4× Kauf → Verlust → sofort wieder kaufen
      const b = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(b.ok, `Kauf ${i} blockiert: ` + codes(b).join(','));
      await price(0.0009);
      assert((await core.executeSell(core.state.positions.find(p => p.tokenId === t.id).id, 'ALL', 'MANUAL')).ok, 'Verkauf fehlgeschlagen');
      await price(0.001);
    }
    assert(core.state.risk.lossStreak === 4 && !core.state.risk.reviewRequired, 'Verlustserie/Review falsch');
    assert((await core.executeBuy(t.id, { sizeUsd: 20 })).ok, 'Kauf nach 4 Verlusten blockiert'); await price(0.0009);
    const avgDown = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(avgDown.ok, 'Nachkauf im Verlust blockiert: ' + codes(avgDown).join(','));
    for (let n = 2; n <= 6; n++) { const r = await core.executeBuy((await prepToken(core, H, n)).id, { sizeUsd: 20 }); assert(r.ok, `Position ${n} blockiert: ` + codes(r).join(',')); }
    assert(core.state.positions.length === 6, 'unbegrenzte Positionen nicht möglich: ' + core.state.positions.length);
    core.state.risk.dailyLimitHit = true; core.state.risk.dailyPnl = -900; core.state.portfolio.peakEquity = 1e6;
    const auto = core.execCheck(await prepToken(core, H, 7), { auto: true });
    assert(!limitHit(auto).length, 'Limit-Sperren trotz Lernmodus: ' + limitHit(auto).join(','));
    const bad = await prepToken(core, H, 8); bad.sec = buildSecurity({ exists: true, program: 'spl-token', mintAuthority: null, freezeAuthority: tMint(4), extensions: [] }, null, normRug({ score: 1, risks: [] }), H.env.now());
    const sec = await core.executeBuy(bad.id, { sizeUsd: 20 }); assert(!sec.ok && codes(sec).includes('SECURITY_CRITICAL'), 'Security-Sperre aufgehoben');
    const rl = core.liveReadiness().checks.find(c => /^Risikolimits/.test(c.name)); assert(rl && !rl.ok, 'LIVE-Gate akzeptiert den Lernmodus ohne Limits');
    core.updateSettings({ ...defaultSettings(), simCapitalUsd: core.S().simCapitalUsd, maxPositionPct: 5, maxExposurePct: 30 }, 'TEST');
    assert(core.liveReadiness().checks.find(c => /^Risikolimits/.test(c.name)).ok, 'LIVE-Gate lehnt Standard-Limits ab');
    return '4 Verluste in Folge auf demselben Coin ohne Pause · Nachkauf im Verlust · 6 Positionen · Tageslimit/Drawdown/Overtrading aus · Security bleibt · LIVE-Gate lehnt Lernmodus ab';
  }],
  ['Trading', 'Frischer Start: Startkapital & Positionen neu, Analysedaten bleiben', async () => {
    const H = makeTestHarness(); const core = await testCore(H);
    const t1 = await prepToken(core, H, 1);
    assert((await core.executeBuy(t1.id, { sizeUsd: 20 })).ok, 'Buy 1 fehlgeschlagen');
    assert((await core.executeSell(core.state.positions[0].id, 'ALL', 'MANUAL')).ok, 'Sell fehlgeschlagen');
    H.env.advance(10 * MIN + SEC); await core._t.updateSolPrice(true); // Loss-Cooldown (Gebühren = kleiner Verlust) abwarten
    const t2 = await prepToken(core, H, 2);
    const b2 = await core.executeBuy(t2.id, { sizeUsd: 20 }); assert(b2.ok, 'Buy 2 fehlgeschlagen: ' + codes(b2).join(','));
    const st = core.state, openId = st.positions[0].id, journalBefore = st.journal.length, closedBefore = st.journal.filter(j => j.status === 'CLOSED').length;
    const pvBefore = st.paramVersions.length, logsBefore = core.log.entries.length, perfBefore = JSON.stringify(perfStats(st.journal));
    const r = core.freshStart(); assert(r.ok && r.dropped === 1, 'freshStart: ' + JSON.stringify(r));
    assert(core.state.positions.length === 0, 'Positionen nicht geleert');
    assert(core.state.portfolio.cash === core.S().simCapitalUsd && core.state.portfolio.realized === 0, 'Portfolio nicht auf Startkapital');
    assert(core.state.journal.length === journalBefore && core.state.journal.find(j => j.id === openId).status === 'RESET', 'Journal verändert oder Position nicht als RESET markiert');
    assert(core.state.journal.filter(j => j.status === 'CLOSED').length === closedBefore && JSON.stringify(perfStats(core.state.journal)) === perfBefore, 'Statistik/geschlossene Trades verändert');
    assert(core.state.paramVersions.length === pvBefore && core.log.entries.length >= logsBefore, 'Analysedaten verloren');
    assert(!Object.keys(core.state.risk.buyCount).length && core.state.risk.lossStreak === 0 && !core.state.risk.dailyLimitHit, 'Risiko-Zähler nicht frei');
    assert((await core.executeBuy(t2.id, { sizeUsd: 20 })).ok, 'Nach frischem Start kein Neukauf möglich');
    return `1 Position verworfen · Cash = Startkapital · ${closedBefore} Trade(s) & Statistik behalten · Neukauf ok`;
  }],
  ['Trading', 'Duplicate Order Protection (Doppelklick, parallele Signale)', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => core.executeBuy(t.id, { sizeUsd: 20 })));
    const ok = rs.filter(r => r.ok).length;
    assert(ok === 1, `${ok} Orders ausgeführt statt 1`);
    assert(rs.filter(r => !r.ok).every(r => codes(r).includes('TRADE_LOCKED')), 'Sperrgrund falsch');
    assert(core.state.positions.length === 1 && core.state.positions[0].entries.length === 1, 'mehr als eine Füllung');
    return '5 parallele Käufe → genau 1 Order';
  }],
  ['Trading', 'Emergency Stop / Kill Switch blockiert Käufe', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    core._t.enqueue(t.id, 'momentum');
    await core.emergencyStop('Test');
    assert(core.state.queue.length === 0, 'Queue nicht geleert');
    const r = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(codes(r)[0] === 'EMERGENCY_STOP', 'Kauf trotz Emergency Stop: ' + codes(r).join(','));
    assert(!core.start().ok, 'Start trotz Emergency Stop möglich');
    return 'Käufe blockiert, Queue geleert, Start gesperrt';
  }],
  ['Trading', 'Kein Nachkauf im Verlust (No Martingale / Blind DCA)', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    assert((await core.executeBuy(t.id, { sizeUsd: 20 })).ok, 'Buy #1 fehlgeschlagen');
    H.market[t.mint] = H.pair(t.mint, { price: 0.0009 }); await core._t.fetchChunk([t.mint], true); await core._t.managePositions();
    const r = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(codes(r).includes('NO_AVERAGING_DOWN'), 'Nachkauf im Verlust erlaubt: ' + codes(r).join(','));
    return 'Buy #2 bei −10 % → NO_AVERAGING_DOWN';
  }],
  ['Trading', 'Max. Exposure wird eingehalten', async () => {
    const H = makeTestHarness(); const core = await testCore(H, { maxExposurePct: 1, maxPositionPct: 1 });
    const a = await prepToken(core, H, 1), b = await prepToken(core, H, 2);
    assert((await core.executeBuy(a.id, { sizeUsd: 10 })).ok, 'erster Kauf fehlgeschlagen');
    const r = await core.executeBuy(b.id, { sizeUsd: 10 }); assert(codes(r).includes('EXPOSURE_LIMIT'), 'Exposure-Limit ignoriert: ' + codes(r).join(','));
    return 'zweite Position → EXPOSURE_LIMIT';
  }],
  ['Daten', 'Stale Data = No Buy', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    H.fail = url => (url.includes(t.mint) ? { status: 500, body: 'err' } : null);
    H.env.advance(30 * SEC);
    const r = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(!r.ok && codes(r).includes('DATA_STALE'), 'Kauf mit veralteten Daten: ' + codes(r).join(','));
    return 'Daten 30 s alt → DATA_STALE';
  }],
  ['Daten', 'No Data / Missing Price = No Buy', async () => {
    const H = makeTestHarness(); const core = await testCore(H);
    const t = await prepToken(core, H, 1, { price: null });
    const r = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(!r.ok && codes(r).includes('PRICE_MISSING'), 'Kauf ohne Preis: ' + codes(r).join(','));
    const m = tMint(5); core._t.ensureToken(m, 'Test');
    const r2 = await core.executeBuy(tokenIdOf(m), { sizeUsd: 20 }); assert(!r2.ok && codes(r2).includes('PRICE_MISSING'), 'Kauf ohne Daten');
    return 'Preis null / keine Daten → PRICE_MISSING';
  }],
  ['Daten', 'Security Unknown = No Buy (auch manuell)', async () => {
    const H = makeTestHarness(); H.rpcFail = true; H.rugFail = true;
    const core = await testCore(H); const t = await prepToken(core, H, 1);
    assert(t.sec.status === 'UNKNOWN', 'Security sollte UNKNOWN sein: ' + t.sec.status);
    core._t.analyzeAll();
    assert(t.D.decision !== 'APPROVED' && t.D.blockers.some(b => b.code === 'SECURITY_UNKNOWN'), 'Auto-Decision ohne Security');
    const r = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(codes(r).includes('SECURITY_UNKNOWN'), 'manueller Kauf ohne Security');
    return 'SECURITY_UNKNOWN blockiert Auto & manuell';
  }],
  ['Daten', 'Security CRITICAL (Freeze Authority) erkannt', async () => {
    const sec = buildSecurity({ exists: true, program: 'spl-token', mintAuthority: null, freezeAuthority: tMint(3), extensions: [] }, null, null, Date.now());
    assert(sec.status === 'CRITICAL' && sec.flags.some(f => f.code === 'FREEZE_AUTHORITY'), 'Freeze Authority nicht erkannt');
    const ok = buildSecurity({ exists: true, program: 'spl-token', mintAuthority: null, freezeAuthority: null, extensions: [] }, null, normRug({ score: 1, risks: [] }), Date.now());
    assert(ok.status === 'VERIFIED', 'saubere Daten nicht VERIFIED');
    return 'CRITICAL / VERIFIED korrekt';
  }],
  ['Security', 'Security-Gate: Freeze Authority blockiert trotz Top-Marktdaten (auch manuell)', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1, { liq: 900000, v1: 600000, b1: 900, s1: 200 });
    t.sec = buildSecurity({ exists: true, program: 'spl-token', mintAuthority: null, freezeAuthority: tMint(4), extensions: [] }, null, normRug({ score: 1, risks: [] }), H.env.now());
    core._t.analyzeAll();
    const st = stageScores(t, t.A, t.D, core.S()), rep = securityReport(t, t.A, t.D, core.S());
    assert(t.D.decision === 'REJECTED' && t.D.blockers.some(b => b.code === 'SECURITY_CRITICAL'), 'Security-Fail nicht hart blockiert: ' + t.D.decision);
    assert(st.security.status === 'FAIL' && st.security.score === 0 && st.readiness.status === 'FAIL', 'Stufen spiegeln den Security-Fail nicht');
    assert(st.market.status !== 'FAIL', 'Marktdaten sollten gut sein (Test ungültig)');
    const fz = rep.checks.find(c => c.check === 'Freeze Authority');
    assert(rep.gate === 'BLOCKED' && fz.result === 'FAIL' && fz.action === 'BLOCK' && fz.severity === 'CRITICAL' && fz.source && fz.ts, 'Prüfbericht unvollständig: ' + JSON.stringify(fz));
    const r = await core.executeBuy(t.id, { sizeUsd: 20 });
    assert(!r.ok && codes(r).includes('SECURITY_CRITICAL'), 'manueller Kauf trotz Security-Fail möglich');
    return `Markt ${st.market.score} (${st.market.status}), Security FAIL → Gate BLOCKED, Kauf auch manuell verhindert`;
  }],
  ['Security', 'Keine Daten ≠ kein Risiko: fehlende Security-Daten sind NO_DATA und blockieren', async () => {
    const H = makeTestHarness(); H.rpcFail = true; H.rugFail = true;
    const core = await testCore(H); const t = await prepToken(core, H, 1);
    core._t.analyzeAll();
    const st = stageScores(t, t.A, t.D, core.S()), rep = securityReport(t, t.A, t.D, core.S());
    assert(st.security.status === 'NO_DATA' && st.security.score === null, 'Security-Stufe nicht NO_DATA: ' + JSON.stringify(st.security));
    const mint = rep.checks.find(c => c.check === 'Mint Authority');
    assert(mint.result === 'NO_DATA' && mint.action === 'BLOCK' && rep.gate === 'BLOCKED', 'fehlende Daten als unbedenklich gewertet: ' + JSON.stringify(mint));
    assert(!rep.checks.some(c => c.result === 'PASS' && /Authority|RugCheck|Holder/.test(c.check)), 'PASS ohne Datenbasis');
    assert(t.D.decision !== 'APPROVED' && t.D.blockers.some(b => b.code === 'SECURITY_UNKNOWN'), 'Kauf trotz fehlender Security-Daten freigegeben');
    return `${rep.noData} Prüfungen ohne Daten → offen/blockiert, nichts als „sicher“ gewertet`;
  }],
  ['Security', 'Scanner-Stufen erklärbar und konsistent zur Entscheidung', async () => {
    const H = makeTestHarness(); const core = await testCore(H);
    const toks = [await prepToken(core, H, 1), await prepToken(core, H, 2, { liq: 3000 }), await prepToken(core, H, 3, { price: null })];
    core._t.analyzeAll();
    for (const t of toks) {
      const st = stageScores(t, t.A, t.D, core.S());
      for (const k of STAGE_ORDER) { const x = st[k]; assert(x && x.reasons.length && ['PASS', 'WARN', 'FAIL', 'NO_DATA'].includes(x.status) && (x.score === null || (isNum(x.score) && x.score >= 0 && x.score <= 100)), `${t.symbol} Stufe ${k} ungültig`); }
      assert(st.readiness.status === (t.D.decision === 'APPROVED' ? 'PASS' : t.D.decision === 'REJECTED' ? 'FAIL' : 'WARN'), `${t.symbol}: Bereitschaft passt nicht zur Entscheidung ${t.D.decision}`);
      assert(t.D.blockers.every(b => st.readiness.reasons.some(r => r.text.startsWith(b.code)) || t.D.blockers.indexOf(b) >= 4), `${t.symbol}: Blocker fehlen in der Begründung`);
    }
    const low = stageScores(toks[1], toks[1].A, toks[1].D, core.S()), nop = stageScores(toks[2], toks[2].A, toks[2].D, core.S());
    assert(low.market.reasons.some(r => r.ok === false && /Liquidität/.test(r.text)), 'zu niedrige Liquidität nicht begründet');
    assert(nop.discovery.status === 'FAIL' && nop.quality.status === 'FAIL', 'fehlender Preis nicht als FAIL erkannt');
    return '3 Kandidaten · 5 Stufen je Kandidat mit Begründung · Bereitschaft = Entscheidung';
  }],
  ['Signal & Risk', 'Score-Attribution: Beiträge ergeben den Final Score, Kipp-Punkte benannt', async () => {
    const H = makeTestHarness(); const core = await testCore(H);
    const toks = [await prepToken(core, H, 1), await prepToken(core, H, 2, { liq: 3000 }), await prepToken(core, H, 3, { c5: -4, c1: -12, b5: 20, s5: 60 })];
    core._t.analyzeAll();
    for (const t of toks) {
      const at = scoreAttribution(t.A, t.D, core.S());
      assert(Math.abs(clamp(Math.round(at.raw), 0, 100) - t.A.finalScore) <= 1, `${t.symbol}: Summe ${at.raw} ≠ Final Score ${t.A.finalScore}`);
      assert(at.items.length === Object.keys(W_SCORE).length && at.flips.length > 0, `${t.symbol}: Aufschlüsselung unvollständig`);
      if (t.D.decision === 'REJECTED') assert(t.D.blockers.slice(0, 1).every(b => at.flips.some(f => f.includes(b.code))), `${t.symbol}: Blocker nicht als Kipp-Punkt genannt`);
    }
    return `3 Kandidaten: Beiträge + Abzüge = Final Score (±1 Rundung), Kipp-Punkte vorhanden`;
  }],
  ['Signal & Risk', 'Signal-Konflikte & Zeitfenster-Abgleich (blockiert nur Auto-Käufe, abschaltbar)', async () => {
    const A0 = { signals: [{ type: 'MOMENTUM', strength: 70 }, { type: 'MEAN_REVERSION', strength: 50 }], price: { chg: { m5: 5, h1: -20, h6: 3, h24: -50 } }, ta: { rsi: 85, ema9: 1, ema21: 2 }, liq: { chg5: -15 }, tx: { ratio5: 0.4, n5: 30 } };
    const cs = signalConflicts(A0), codesC = cs.map(c => c.code).sort().join(',');
    assert(codesC === 'CONTRADICTORY,LIQ_DIVERGENCE,MTF_DIVERGENCE,OVERBOUGHT,SELL_PRESSURE', 'Konflikte falsch: ' + codesC);
    assert(conflictWeight(cs) === 8 && mtfAlignment(A0).label === 'PARTIAL' && mtfAlignment({ price: { chg: { m5: 3, h1: 5, h6: 8, h24: 20 } } }).label === 'ALIGNED_UP', 'Gewicht/MTF falsch');
    assert(!signalConflicts({ ...A0, signals: [] }).length, 'Konflikte ohne Kaufsignal');
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1); core._t.analyzeAll();
    const A2 = { ...t.A, sigConflicts: cs };
    assert(decideToken(t, A2, core.buildCtx()).analysisBlockers.some(b => b.code === 'SIGNAL_CONFLICT'), 'Konflikt blockiert nicht');
    assert(!MANUAL_HARD.has('SIGNAL_CONFLICT'), 'Konflikt würde manuelle Käufe blockieren');
    core.updateSettings({ signalConflictBlock: false }, 'TEST');
    assert(!decideToken(t, A2, core.buildCtx()).analysisBlockers.some(b => b.code === 'SIGNAL_CONFLICT'), 'Schalter wirkt nicht');
    return `5 Konflikte erkannt (Gewicht 8), MTF PARTIAL · blockiert Auto-Käufe, abschaltbar, manuell frei`;
  }],
  ['Signal & Risk', 'Signal-Decay: alte Ereignis-Signale verlieren Gewicht, neue starten frisch', async () => {
    const tok = {}, t0 = 1e12, S1 = () => [{ type: 'BREAKOUT', strength: 80, reason: 'x' }, { type: 'MOMENTUM', strength: 60, reason: 'y' }];
    let s0 = S1(); applySignalDecay(tok, s0, t0); assert(s0[0].strength === 80, 'frisches Signal abgeschwächt');
    let s1 = S1(); applySignalDecay(tok, s1, t0 + 20 * MIN); assert(s1[0].strength === 40 && s1[0].decay === 0.5 && /abgeschwächt/.test(s1[0].reason), 'Decay nach 20 min falsch: ' + s1[0].strength);
    let s2 = S1(); applySignalDecay(tok, s2, t0 + 60 * MIN); assert(s2[0].strength === 32 && s2[1].strength === 60, 'Untergrenze/Nicht-Ereignis-Signal falsch');
    applySignalDecay(tok, [], t0 + 61 * MIN); let s3 = S1(); applySignalDecay(tok, s3, t0 + 62 * MIN);
    assert(s3[0].strength === 80, 'Signal nach Pause nicht frisch');
    return 'Breakout 80 → 40 (20 min) → 32 (Untergrenze) · Momentum unverändert · nach Pause wieder 80';
  }],
  ['Signal & Risk', 'Risk-Guardrails: Drawdown, Datenalter, Execution → nur kleiner, mit Reason Codes', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1, { liq: 900000 }); core._t.analyzeAll();
    const base = core.execCheck(t, { auto: false }).sizing, eq = core.equityInfo().equity;
    assert(base.factors.adj.every(a => a.f > 0 && a.f < 1), 'Abschlag ≥ 1');
    core.state.portfolio.peakEquity = eq / 0.88;
    const dd = core.execCheck(t, { auto: false }).sizing;
    assert(dd.factors.adj.some(a => a.code === 'DRAWDOWN_MODE') && dd.size <= base.size + 1e-9 && dd.factors.caps.Strategie < base.factors.caps.Strategie, 'Drawdown-Modus verkleinert nicht');
    core.state.portfolio.peakEquity = eq / 0.75;
    assert(core.globalBlockers({ auto: true }).some(b => b.code === 'DRAWDOWN_LIMIT') && !core.globalBlockers({ auto: false }).some(b => b.code === 'DRAWDOWN_LIMIT'), 'Drawdown-Grenze wirkt nicht (nur Auto)');
    core.state.portfolio.peakEquity = eq;
    t.A = { ...t.A, dataAge: core.S().staleAfterSec * SEC * 0.8, liq: { ...t.A.liq, impactPlanned: core.S().maxSlippagePct } };
    const pen = core.execCheck(t, { auto: false }).sizing;
    assert(['DATA_AGE', 'EXECUTION_UNCERTAINTY'].every(c => pen.factors.adj.some(a => a.code === c)) && pen.factors.fAdj < base.factors.fAdj, 'Datenalter/Execution-Abschlag fehlt');
    const syn = (n, stale) => Array.from({ length: n }, (_, i) => ({ price: { chg: { h1: 2, m5: 1 }, volPct: 1 }, liq: { chg5: 0 }, stale, fallback: false, confidence: { total: stale ? 20 : 80 } }));
    assert(computeRegime(syn(12, true), null).tags.includes('LOW_QUALITY_MARKET') && !computeRegime(syn(12, false), null).tags.includes('LOW_QUALITY_MARKET'), 'Low-Quality-Markt falsch erkannt');
    core.state.regime = { tags: ['LOW_QUALITY_MARKET'], lowQ: 0.8 };
    assert(core.globalBlockers({ auto: true }).some(b => b.code === 'LOW_QUALITY_MARKET') && !core.globalBlockers({ auto: false }).some(b => b.code === 'LOW_QUALITY_MARKET'), 'No-Trade-Zone wirkt nicht (nur Auto)');
    return `Abschläge ${[...new Set([...dd.factors.adj, ...pen.factors.adj].map(a => a.code))].join(', ')} · Drawdown-Grenze & No-Trade-Zone nur für Auto`;
  }],
  ['Portfolio & Execution', 'Positions-Lebenszyklus: OPEN → CLOSING → PARTIAL → CLOSED → RECONCILED, ungültige Übergänge verboten', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    assert((await core.executeBuy(t.id, { sizeUsd: 40 })).ok, 'Buy fehlgeschlagen');
    const pos = core.state.positions[0];
    assert(pos.lc === 'OPEN' && pos.lcHistory.map(h => h.s).join('>') === 'PLANNED>PENDING>OPEN', 'Start-Lebenszyklus falsch: ' + pos.lcHistory.map(h => h.s).join('>'));
    assert((await core.executeSell(pos.id, 0.25, 'MANUAL')).ok && pos.lc === 'PARTIAL', 'Teilverkauf nicht PARTIAL: ' + pos.lc);
    assert(!core._t.posTransition(pos, 'RECONCILED') && pos.lc === 'PARTIAL', 'ungültiger Übergang erlaubt');
    assert((await core.executeSell(pos.id, 'ALL', 'MANUAL')).ok, 'Restverkauf fehlgeschlagen');
    const j = core.state.journal.find(x => x.id === pos.id);
    assert(j.lc === 'RECONCILED' && j.lcHistory.map(h => h.s).join('>') === 'PLANNED>PENDING>OPEN>CLOSING>PARTIAL>CLOSING>CLOSED>RECONCILED', 'Lebenszyklus unvollständig: ' + j.lcHistory.map(h => h.s).join('>'));
    return j.lcHistory.map(h => h.s).join(' → ');
  }],
  ['Portfolio & Execution', 'Portfolio-Integrität: keine Doppelbuchung bei parallelen Verkäufen, Abweichungen sichtbar', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    assert((await core.executeBuy(t.id, { sizeUsd: 40 })).ok, 'Buy fehlgeschlagen');
    const pos = core.state.positions[0];
    const [a, b] = await Promise.all([core.executeSell(pos.id, 0.25, 'MANUAL'), core.executeSell(pos.id, 0.25, 'MANUAL')]);
    assert([a, b].filter(r => r.ok).length === 1 && [a, b].some(r => codes(r).includes('TRADE_LOCKED')), 'paralleler Verkauf nicht verhindert');
    assert(pos.exits.length === 1 && core.portfolioIntegrity().ok, 'Integrität nach Teilverkauf verletzt: ' + JSON.stringify(core.portfolioIntegrity().issues));
    pos.qty *= 2;
    const pi = core.portfolioIntegrity();
    assert(!pi.ok && pi.issues.some(i => i.code === 'QTY_MISMATCH') && core.botHealth().find(x => x.name === 'Portfolio').status === 'ERROR', 'Mengenabweichung nicht erkannt');
    return 'paralleler Verkauf → 1× gebucht, 1× TRADE_LOCKED · Mengenabweichung erkannt (Portfolio ERROR)';
  }],
  ['Portfolio & Execution', 'Execution-Provider: Simulation vollständig, LIVE ohne Router/Signatur, Fehlercodes auditierbar', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const T = core._t;
    const lq = T.liveProvider.quote({ side: 'BUY', sizeUsd: 10, snap: { priceUsd: 1, liquidityUsd: 1e6 } });
    assert(!lq.ok && lq.code === 'NO_ROUTER' && T.liveProvider.sign({}).code === 'SIGNATURE_DISABLED' && !T.liveProvider.available, 'LIVE-Provider nicht gesperrt');
    assert(core.execProvider('LIVE') === 'LIVE' && core.execProvider() === 'SIMULATION', 'Provider-Auswahl falsch');
    const t = await prepToken(core, H, 1);
    const r = await core.executeBuy(t.id, { sizeUsd: 20 });
    assert(r.ok && r.order.provider === 'SIMULATION' && /Jupiter/.test(r.order.route) && r.order.quote.source === 'JUPITER' && r.order.history.some(h => h.s === 'SUBMITTING' && /Preflight ok/.test(h.note)), 'Provider-Schritte fehlen im Order-Verlauf');
    H.rpcFail = true; H.rugFail = true; const t2 = await prepToken(core, H, 2);
    const r2 = await core.executeBuy(t2.id, { sizeUsd: 20 });
    assert(!r2.ok && r2.order.failureCode === 'PRE_TRADE_BLOCKED', 'Fehlercode fehlt: ' + (r2.order && r2.order.failureCode));
    const sq = await T.simProvider.quote({ side: 'BUY', sizeUsd: 10, snap: { priceUsd: null } });
    assert(!sq.ok && sq.code === 'QUOTE_FAILED', 'ungültige Quote nicht abgewiesen');
    return 'SIMULATION: Quote→Preflight→Sign→Send→Confirm · LIVE: NO_ROUTER / SIGNATURE_DISABLED · Codes PRE_TRADE_BLOCKED, QUOTE_FAILED';
  }],
  ['Portfolio & Execution', 'Trades blockieren den Scan nicht: Verkauf läuft nebenher, kein Doppel-Verkauf', async () => {
    const H = makeTestHarness(); const core = await testCore(H, { simLatencyMs: 300 }); const t = await prepToken(core, H, 1);
    assert((await core.executeBuy(t.id, { sizeUsd: 20 })).ok, 'Kauf fehlgeschlagen');
    const pos = core.state.positions[0];
    H.market[t.mint] = H.pair(t.mint, { price: 0.0008 }); // −20 % → Stop-Loss
    const t0 = Date.now(); await core._t.scanOnce({ awaitTrades: false }); const scanMs = Date.now() - t0;
    assert(core.state.locks.has('pos:' + pos.id) && pos.lc === 'CLOSING' && scanMs < 250, `Scan hat auf den Verkauf gewartet (${scanMs} ms, ${pos.lc})`);
    await core._t.scanOnce({ awaitTrades: false }); // zweiter Scan während des Verkaufs
    await core.drainTrades();
    const sells = core.state.orders.filter(o => o.side === 'SELL' && o.positionId === pos.id);
    assert(!core.state.positions.length && sells.length === 1 && sells[0].state === 'COMPLETED', 'Verkauf nicht genau einmal ausgeführt: ' + sells.map(o => o.state).join(','));
    return `Scan fertig nach ${scanMs} ms, Verkauf mit 300 ms Wartezeit lief nebenher · genau 1 Verkauf`;
  }],
  ['Portfolio & Execution', 'Neustart während Verkauf → Abgleich statt stiller Annahme', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    assert((await core.executeBuy(t.id, { sizeUsd: 20 })).ok, 'Buy fehlgeschlagen');
    const pos = core.state.positions[0]; core._t.posTransition(pos, 'CLOSING', 'Test: Absturz während Verkauf'); core.persistNow();
    const c2 = createCore({ env: H.env, backend: H.backend }); c2.init({ autoStart: false });
    const p2 = c2.state.positions[0];
    assert(p2 && p2.lc === 'OPEN' && p2.lcHistory.some(h => h.s === 'UNKNOWN') && c2.state.reconciliation.required && c2.state.reconciliation.issues.some(x => /unterbrochen/.test(x)), 'unterbrochener Verkauf nicht abgeglichen');
    return 'CLOSING beim Neustart → UNKNOWN → OPEN (aus bestätigten Füllungen) + RECONCILIATION REQUIRED';
  }],
  ['Portfolio & Execution', 'Wallet: nur lesend, stille Wiederverbindung nur mit Vertrauen, nie signieren', async () => {
    const H = makeTestHarness(); let trusted = false; const calls = [], signCalls = [];
    const prov = { isPhantom: true, connect: async o => { calls.push(o || null); if (o && o.onlyIfTrusted && !trusted) throw new Error('User rejected'); return { publicKey: { toString: () => tMint(5) } }; }, on() {}, signTransaction: async () => signCalls.push(1), signAllTransactions: async () => signCalls.push(1), signMessage: async () => signCalls.push(1) };
    H.env.walletProvider = () => prov;
    const core = await testCore(H);
    const s1 = await core.walletConnect({ silent: true });
    assert(!s1.ok && core.state.wallet.status === 'NOT_CONNECTED' && calls[0] && calls[0].onlyIfTrusted, 'stille Verbindung ohne Vertrauen nicht sauber abgelehnt');
    const s2 = await core.walletConnect();
    assert(s2.ok && core.state.wallet.status === 'CONNECTED' && core.state.wallet.pubkey === tMint(5), 'Verbindung fehlgeschlagen');
    const sig = await core.requestSignature();
    assert(!sig.ok && sig.code === 'SIGNING_DISABLED' && !signCalls.length, 'Signatur-Pfad nicht gesperrt');
    assert(!/secret|seed|private/i.test(JSON.stringify(core.state.wallet)), 'Wallet-State enthält sensible Felder');
    core.walletDisconnect(); assert(core.state.wallet.status === 'NOT_CONNECTED', 'Trennen fehlgeschlagen');
    trusted = true; const s3 = await core.walletConnect({ silent: true });
    assert(s3.ok && core.state.wallet.status === 'CONNECTED' && !signCalls.length, 'stille Wiederverbindung mit Vertrauen fehlgeschlagen');
    return 'onlyIfTrusted ohne Vertrauen → abgelehnt · manuell verbunden · Signatur gesperrt (0 Aufrufe) · Wiederverbindung ok';
  }],
  ['Daten', 'Pump wird nie als Buy interpretiert', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1, { c5: 75, v5: 60000, v1: 90000, b5: 290, s5: 10 });
    core._t.analyzeAll();
    assert(t.A.pump.detected && t.D.decision !== 'APPROVED' && t.D.blockers.some(b => b.code === 'PUMP_DETECTED'), 'Pump nicht blockiert');
    return 'PUMP_DETECTED: ' + t.A.pump.flags.length + ' Muster';
  }],
  ['Chaos', 'API-Ausfall → OFFLINE, keine Fake-Daten, kein Kauf', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    const priceBefore = t.snap.priceUsd;
    H.fail = () => new TypeError('Failed to fetch');
    for (let i = 0; i < 4; i++) { H.env.advance(70 * SEC); await core._t.scanOnce(); }
    assert(core.http.status('dexPairs') === 'OFFLINE', 'Status nicht OFFLINE: ' + core.http.status('dexPairs'));
    assert(t.snap.priceUsd === priceBefore, 'Snapshot verändert ohne Daten');
    const r = await core.executeBuy(t.id, { sizeUsd: 20 });
    assert(!r.ok && codes(r).some(c => ['SYSTEM_UNHEALTHY', 'DATA_STALE', 'PRICE_MISSING', 'FEE_UNKNOWN'].includes(c)), 'Kauf trotz Ausfall');
    return 'dexPairs OFFLINE, Kauf blockiert (' + codes(r).slice(0, 2).join(', ') + ')';
  }],
  ['Chaos', 'Falsches JSON & Nullwerte werden sicher behandelt', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const m = tMint(1);
    H.fail = url => (url.includes(m) ? { status: 200, body: '{kaputt' } : null);
    core._t.ensureToken(m, 'Test');
    let code = null; try { await core._t.fetchChunk([m], true); } catch (e) { code = e.code; }
    assert(code === 'BAD_JSON', 'BAD_JSON nicht erkannt: ' + code);
    assert(!core.state.markets.get(tokenIdOf(m)).snap, 'Snapshot aus kaputtem JSON');
    const n = normDexPair({ chainId: 'solana', baseToken: { address: m }, priceUsd: null, liquidity: null, volume: null, txns: { m5: null }, priceChange: 'x' }, Date.now());
    assert(n && n.priceUsd === null && n.liquidityUsd === null && n.vol.h1 === null && n.txns.m5 === null, 'Nullwerte falsch normalisiert');
    assert(normDexPair(null) === null && normDexPair({ chainId: 'eth' }) === null, 'ungültige Pairs akzeptiert');
    return 'BAD_JSON erkannt, Nullwerte bleiben null';
  }],
  ['Chaos', 'Rate Limit (429) → Backoff, keine weiteren Requests', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const m = tMint(1);
    H.fail = url => (url.includes(m) ? { status: 429, body: 'slow down' } : null);
    let c1 = null; try { await core._t.fetchChunk([m], true); } catch (e) { c1 = e.code; }
    const calls = H.calls.length; let c2 = null;
    try { await core._t.fetchChunk([m], true); } catch (e) { c2 = e.code; }
    assert(c1 === 'HTTP_429' && c2 === 'BACKOFF' && H.calls.length === calls, `429=${c1}, danach=${c2}, Requests +${H.calls.length - calls}`);
    return 'HTTP 429 → Backoff ≥ 9 s, kein weiterer Request';
  }],
  ['Chaos', 'Doppelter Scan (Scanner Lock)', async () => {
    const H = makeTestHarness(); const core = await testCore(H);
    const [a, b] = await Promise.all([core._t.scanOnce(), core._t.scanOnce()]);
    assert((a.skipped ? 1 : 0) + (b.skipped ? 1 : 0) === 1, 'Scans liefen parallel');
    return 'zweiter paralleler Scan übersprungen';
  }],
  ['Chaos', 'Verspätete Response überschreibt keine neueren Daten', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const m = tMint(1), m2 = tMint(2);
    core._t.ensureToken(m, 'Test'); core._t.ensureToken(m2, 'Test');
    H.market[m] = H.pair(m, { price: 0.001 }); H.market[m2] = H.pair(m2);
    H.delays[m + ',' + m2] = 80;
    const slow = core._t.fetchChunk([m, m2], true);
    await new Promise(r => setTimeout(r, 5));
    H.market[m] = H.pair(m, { price: 0.002 });
    await core._t.fetchChunk([m], true);
    await slow;
    const p = core.state.markets.get(tokenIdOf(m)).snap.priceUsd;
    assert(p === 0.002, 'alte Antwort hat neuere überschrieben: ' + p);
    assert(core.state.scanner.lateIgnored >= 1, 'Race nicht erkannt');
    return 'verspätete Antwort verworfen';
  }],
  ['Chaos', 'Reload/Crash Recovery (RECONCILING)', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    assert((await core.executeBuy(t.id, { sizeUsd: 20 })).ok, 'Buy fehlgeschlagen');
    core.state.orders.unshift({ id: 'ORD-STUCK', key: 'stuck', tokenId: t.id, mint: t.mint, symbol: t.symbol, side: 'BUY', state: 'SUBMITTING', history: [{ s: 'SUBMITTING', ts: H.env.now() }], createdAt: H.env.now() });
    core.persistNow();
    const core2 = createCore({ env: H.env, backend: H.backend }); core2.init({ autoStart: false });
    const stuck = core2.state.orders.find(o => o.id === 'ORD-STUCK');
    assert(stuck && stuck.state === 'CANCELLED' && stuck.history.some(h => h.s === 'RECONCILING'), 'hängende Order nicht abgeglichen');
    assert(core2.state.positions.length === 1 && core2.state.risk.buyCount[t.id] === 1, 'Position/Buy-Zähler nicht wiederhergestellt');
    assert(core2.state.orders.filter(o => o.side === 'BUY' && o.state === 'COMPLETED').length === 1, 'abgeschlossene Order verloren');
    return 'Order RECONCILING → CANCELLED, Position & Zähler erhalten';
  }],
  ['Chaos', 'Offline-Modus: UI offen, Trading deaktiviert', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    H.env.setOnline(false);
    const r = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(codes(r).includes('OFFLINE'), 'Kauf offline möglich: ' + codes(r).join(','));
    return 'OFFLINE blockiert';
  }],
  ['System', 'LIVE-Modus nicht versehentlich aktivierbar', async () => {
    const H = makeTestHarness(); const core = await testCore(H);
    const r = core.setMode('LIVE'); assert(!r.ok && core.state.mode === 'SIMULATION', 'LIVE aktiviert');
    assert(core.setAutoTrading(true).ok, 'Auto-Trading in SIMULATION muss möglich sein');
    core.setMode('READ_ONLY'); assert(!core.setAutoTrading(true).ok, 'Auto-Trading in READ ONLY möglich');
    return 'LIVE verweigert, Modi getrennt';
  }],
  ['System', 'Timer Safety (keine doppelten Timer)', async () => {
    const H = makeTestHarness(); const core = await testCore(H);
    assert(core._t.startScanner() === true && core._t.startScanner() === false, 'Scanner doppelt gestartet');
    await new Promise(r => setTimeout(r, 30));
    assert(core._t.timers.size <= 2, 'zu viele Timer: ' + core._t.timers.size);
    core._t.stopScanner(); await new Promise(r => setTimeout(r, 60));
    assert(core._t.timers.size === 0, 'Timer nach Stop aktiv: ' + core._t.timers.size);
    return 'Start idempotent, Stop räumt alle Timer ab';
  }],
  ['System', 'Order State Machine & kein Math.random im Trading', async () => {
    assert(ORDER_TRANSITIONS.DETECTED.indexOf('COMPLETED') === -1 && [...TERMINAL].every(s => ORDER_TRANSITIONS[s].length === 0), 'ungültige Übergänge möglich');
    const fns = [analyzeToken, decideToken, evalStrategies, runBacktest, walkForward, computeRegime, perfStats, createCore, buildSecurity];
    assert(fns.every(f => !String(f).includes('Math.random')), 'Math.random in Handelslogik gefunden');
    return 'Terminalzustände final, keine Zufallslogik';
  }],
  ['Status', 'Normaler Scan liefert Analyse & Entscheidungen', async () => {
    const H = makeTestHarness(); const core = await testCore(H);
    for (let i = 1; i <= 4; i++) { const m = tMint(i); H.market[m] = H.pair(m); core._t.ensureToken(m, 'Test'); }
    const r = await core._t.scanOnce();
    assert(!r.error && !r.skipped, 'Scan fehlgeschlagen: ' + (r.error || 'skipped'));
    const toks = [...core.state.markets.values()].filter(t => t.A && t.D);
    assert(toks.length === 4, `${toks.length} statt 4 Tokens analysiert`);
    assert(toks.every(t => core.candidateChain(t).text.includes('FINAL:')), 'Kandidaten-Kette fehlt');
    return '4 Tokens gescannt, Kette pro Kandidat vorhanden';
  }],
  ['Status', 'Kein Kandidat / niedriger Score → WAITING, nicht BLOCKED', async () => {
    const H = makeTestHarness(); const core = await testCore(H, { minScore: 99 });
    const t = await prepToken(core, H, 1);
    core._t.setBotState('STARTING'); core._t.setBotState('RUNNING');
    core._t.analyzeAll();
    const rd = core.readiness();
    assert(t.D.blockers.some(b => b.code === 'SCORE_TOO_LOW'), 'SCORE_TOO_LOW erwartet');
    assert(rd.state === 'WAITING', 'Status ' + rd.state + ': ' + rd.reason);
    assert(core.candidateChain(t).text.includes('SCORE TOO LOW') && core.candidateChain(t).final === 'NO TRADE', 'Kette falsch: ' + core.candidateChain(t).text);
    return 'WAITING · ' + core.candidateChain(t).text.split(' → ').slice(-2).join(' → ');
  }],
  ['Status', 'Kein Konsens → WAITING, nicht BLOCKED', async () => {
    const H = makeTestHarness(); const core = await testCore(H, { consensusMinWeight: 5 });
    const t = await prepToken(core, H, 1);
    core._t.setBotState('STARTING'); core._t.setBotState('RUNNING');
    core._t.analyzeAll();
    assert(t.D.blockers.some(b => b.code === 'NO_CONSENSUS'), 'NO_CONSENSUS erwartet');
    assert(core.readiness().state === 'WAITING', 'Status ' + core.readiness().state);
    return 'NO_CONSENSUS → WAITING';
  }],
  ['Status', 'Kandidat vorhanden → READY; harter Block → BLOCKED', async () => {
    const H = makeTestHarness(); const core = await testCore(H);
    await prepToken(core, H, 1);
    core._t.setBotState('STARTING'); core._t.setBotState('RUNNING');
    core._t.analyzeAll();
    const r1 = core.readiness();
    assert(r1.state === 'READY', 'erwartet READY, ist ' + r1.state + ': ' + r1.reason);
    core.setSafeMode(true);
    const r2 = core.readiness(); assert(r2.state === 'BLOCKED' && r2.hard[0].code === 'SAFE_MODE', 'Safe Mode nicht BLOCKED');
    core.setSafeMode(false); core.state.risk.dailyLimitHit = true;
    assert(core.readiness().state === 'BLOCKED', 'Tageslimit nicht BLOCKED');
    core.state.risk.dailyLimitHit = false; await core.emergencyStop('Test');
    assert(core.readiness().state === 'EMERGENCY_STOP', 'Emergency nicht erkannt');
    return 'READY → BLOCKED (Safe Mode, Tageslimit) → EMERGENCY STOP';
  }],
  ['Chaos', 'RPC- & RugCheck-Ausfall → Security Unknown, BLOCKED', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    H.rpcFail = true; H.rugFail = true; core._t.setBotState('STARTING'); core._t.setBotState('RUNNING');
    for (let i = 0; i < 6; i++) { H.env.advance(3.5 * MIN); await core._t.updateSolPrice(true); t.sec = await core._t.checkSecurity(t.mint); await core._t.fetchChunk([t.mint], true); } // > 10 min: RugCheck-Cache abgelaufen
    assert(t.sec.status === 'UNKNOWN', 'Security ' + t.sec.status);
    const rd = core.readiness();
    assert(rd.hard.some(b => b.code === 'SECURITY_SOURCES_DOWN'), 'SECURITY_SOURCES_DOWN fehlt: ' + rd.hard.map(b => b.code).join(','));
    const r = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(!r.ok, 'Kauf trotz RPC-Ausfall');
    return 'RPC OFFLINE → ' + codes(r).slice(0, 2).join(', ');
  }],
  ['Chaos', 'Inkonsistenter Speicher → RECONCILIATION REQUIRED', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    assert((await core.executeBuy(t.id, { sizeUsd: 20 })).ok, 'Buy fehlgeschlagen');
    const tr = JSON.parse(H.backend.get(STORAGE_KEYS.trades)); tr.tradeSeq = 999; H.backend.set(STORAGE_KEYS.trades, JSON.stringify(tr));
    const core2 = createCore({ env: H.env, backend: H.backend }); core2.init({ autoStart: false });
    assert(core2.state.reconciliation.required, 'Abgleich nicht angefordert');
    core2._t.setBotState('STARTING'); core2._t.setBotState('RUNNING');
    await core2._t.updateSolPrice(true); const t2 = core2.state.markets.get(t.id); await core2._t.fetchChunk([t.mint], true); t2.sec = await core2._t.checkSecurity(t.mint);
    const b = await core2.executeBuy(t.id, { sizeUsd: 20 });
    assert(codes(b).includes('RECONCILIATION_REQUIRED'), 'Kauf trotz offenem Abgleich: ' + codes(b).join(','));
    assert(core2.readiness().state === 'BLOCKED', 'Status nicht BLOCKED');
    core2.ackReconciliation();
    assert(!core2.state.reconciliation.required && !core2.globalBlockers({}).some(x => x.code === 'RECONCILIATION_REQUIRED'), 'Bestätigung wirkt nicht');
    return 'Seq-Konflikt erkannt, Käufe blockiert bis Bestätigung';
  }],
  ['System', 'Live-Gating: LIVE nur mit allen Voraussetzungen, Auto ≠ Echtgeld', async () => {
    const H = makeTestHarness(); const core = await testCore(H);
    const lr = core.liveReadiness();
    assert(!lr.ready && lr.checks.find(c => c.name === 'Wallet verbunden').ok === false && lr.checks.find(c => /Routing/.test(c.name)).ok === false, 'Gating unvollständig');
    const r = core.setMode('LIVE'); assert(!r.ok && Array.isArray(r.checks) && core.state.mode === 'SIMULATION', 'LIVE aktiviert');
    assert(core.setAutoTrading(true).ok && core.state.mode === 'SIMULATION', 'Auto-Trading verändert Modus');
    const sig = await core.requestSignature(); assert(!sig.ok && sig.code === 'SIGNING_DISABLED', 'Signatur nicht blockiert');
    const w = await core.walletConnect(); assert(!w.ok && core.state.wallet.status === 'NO_PROVIDER', 'Wallet ohne Provider verbunden');
    return `${lr.checks.filter(c => !c.ok).length} Gating-Checks offen, Signieren deaktiviert`;
  }],
  ['Daten', 'SOL-Preis-Fallback aus SOL-quotierten Pools', async () => {
    const H = makeTestHarness(); H.fail = url => (url.endsWith('/tokens/v1/solana/' + WSOL) ? { status: 500, body: 'x' } : null);
    const core = await testCore(H);
    assert(!core.state.sol, 'Direktpreis sollte fehlen');
    const ms = [1, 2, 3].map(tMint); ms.forEach(m => { H.market[m] = H.pair(m); core._t.ensureToken(m, 'Test'); });
    await core._t.fetchChunk(ms, true);
    assert(core.state.sol && core.state.sol.derived && Math.abs(core.state.sol.usd - 0.001 / 0.0000066) < 0.01, 'abgeleiteter SOL-Preis falsch: ' + JSON.stringify(core.state.sol));
    return 'SOL ≈ ' + fmtUsd(core.state.sol.usd) + ' aus ' + core.state.sol.n + ' Pools';
  }],
  ['System', 'Storage logisch getrennt (Settings/Runtime/Positionen/Trades/Logs/Stats)', async () => {
    const H = makeTestHarness(); const core = await testCore(H);
    core.persistNow();
    const missing = Object.values(STORAGE_KEYS).filter(k => H.backend.get(k) == null);
    assert(!missing.length, 'fehlende Bereiche: ' + missing.join(', '));
    const before = H.backend.get(STORAGE_KEYS.trades);
    core.updateSettings({ minScore: 70 });
    assert(H.backend.get(STORAGE_KEYS.trades) === before && JSON.parse(H.backend.get(STORAGE_KEYS.settings)).settings.minScore === 70, 'Bereiche nicht getrennt');
    return Object.keys(STORAGE_KEYS).length + ' Bereiche, nur geänderte werden geschrieben';
  }],
  ['Lern-KI', 'Loss Learning Record beim Schließen (Features, Preispfad, Labels, Counterfactuals, Nachlauf)', async () => {
    const H = makeTestHarness(); const core = await testCore(H);
    const { t, rec } = await learnTrade(H, core, 1, 0.0009);
    assert(rec && !rec.legacy && rec.entry && rec.entry.v === FEATURE_VERSION && isNum(rec.entry.finalScore), 'Record/Features fehlen');
    assert(rec.path.n >= 1 && rec.path.mae2m <= -9 && rec.path.samples.length >= 1, 'Preispfad (MAE) fehlt: ' + JSON.stringify(rec.path).slice(0, 120));
    assert(rec.outcome.win === false && rec.labels && rec.labels.lossFamily && isNum(rec.labels.dataCompleteness), 'Labels/Ursache fehlen');
    assert(arr(rec.cf).length >= 5 && rec.cf.every(c => typeof c.scenario === 'string'), 'Counterfactuals fehlen');
    assert(core.state.learn.followUps.some(f => f.tradeId === rec.tradeId), 'Nachlauf nicht gestartet');
    H.env.advance(MIN); H.market[t.mint] = H.pair(t.mint, { price: 0.00105 }); await core._t.fetchChunk([t.mint], true); core._t.learnFollowUps();
    H.env.advance(15 * MIN); await core._t.fetchChunk([t.mint], true); core._t.learnFollowUps();
    assert(rec.followUp && rec.followUp.maxAfterPct > 10 && rec.revisions.length === 1 && !core.state.learn.followUps.length, 'Nachlauf nicht ausgewertet: ' + JSON.stringify(rec.followUp));
    assert(Object.keys(core.state.patterns).length > 10, 'Pattern-Aggregate fehlen');
    return `Ursache ${rec.labels.lossFamily} · MAE 2m ${fmtPct(rec.path.mae2m)} · Nachlauf max ${fmtPct(rec.followUp.maxAfterPct)} · ${rec.cf.length} Counterfactuals`;
  }],
  ['Lern-KI', 'Ursachen-Zuordnung mit Evidenz; ohne Daten → UNKNOWN', async () => {
    const S = defaultSettings();
    const liq = mkLearnRec(1, { pnlPct: -12 }); liq.exit.reason = 'LIQUIDITY_COLLAPSE'; liq.path.minLiqPct = -60;
    const a = attributeLoss(liq, { S }); assert(a.primaryCause === 'LIQUIDITY_FAILURE' && a.evidence.LIQUIDITY_FAILURE >= 80, 'Liquidität nicht erkannt: ' + JSON.stringify(a.evidence));
    const mom = mkLearnRec(2, { pnlPct: -9, chg1h: 90 }); mom.path.mae5m = -10;
    const b = attributeLoss(mom, { S }); assert(b.primaryCause === 'MOMENTUM_EXHAUSTION', 'Momentum-Erschöpfung nicht erkannt: ' + b.primaryCause);
    const empty = { entry: null, execution: {}, path: {}, exit: {}, outcome: { pnlUsd: -1, pnlPct: -2, win: false } };
    const u = attributeLoss(empty, { S }), l = labelTrade(empty, { S });
    assert(u.primaryCause === 'UNKNOWN' && u.unknown && l.avoidable === 'UNKNOWN' && l.dataQuality === 'UNKNOWN' && l.signalQuality === 'UNKNOWN', 'fehlende Daten nicht als UNKNOWN markiert');
    const noise = mkLearnRec(3, { pnlPct: -3 }); const nz = attributeLoss(noise, { S });
    assert(nz.primaryCause === 'NOISE_OR_RANDOM' && labelTrade(noise, { S }).avoidable === 'NO', 'kleiner Verlust ohne Muster nicht als Zufall eingestuft: ' + nz.primaryCause);
    return 'LIQUIDITY_FAILURE · MOMENTUM_EXHAUSTION · NOISE_OR_RANDOM · UNKNOWN korrekt';
  }],
  ['Lern-KI', 'Kein Look-Ahead: Features eingefroren zum Einstieg, Leakage wird erkannt', async () => {
    const H = makeTestHarness(); const core = await testCore(H);
    const { rec, feat } = await learnTrade(H, core, 2, 0.0009);
    assert(JSON.stringify(rec.entry) === feat, 'Features wurden nach dem Einstieg verändert');
    assert(rec.entry.ts <= rec.openedAt, 'Feature-Zeitstempel nach Einstieg');
    assert(!Object.keys(rec.entry).some(k => /pnl|exit|outcome|mae|mfe/i.test(k)), 'Ergebnisdaten in den Einstiegs-Features');
    const h = hypothesisOf('MIN_SCORE', { minScore: 70 }, { statement: 'Test', n: 30 }, 0);
    const leak = oosSet(60); leak[40].entry.ts = leak[40].openedAt + 60000;
    const e = runExperiment(h, leak, learnTestBase(), learnTestCfg);
    assert(e.decision === 'REJECTED' && e.robustness.checks.some(c => /Leakage/.test(c.name) && !c.ok), 'Leakage nicht erkannt: ' + e.reason);
    return 'Features = Snapshot zum Einstieg · Leakage-Check lehnt ab';
  }],
  ['Lern-KI', 'Walk-Forward & Out-of-Sample: echte Regel validiert, Zufall nicht', async () => {
    const h = hypothesisOf('MIN_SCORE', { minScore: 70 }, { statement: 'Test', n: 30 }, 0);
    const e = runExperiment(h, oosSet(60), learnTestBase(), learnTestCfg);
    assert(e.decision === 'VALIDATED', 'robuste Regel nicht validiert: ' + e.reason);
    assert(e.trainWindow[1] < e.validationWindow[0] && e.validationWindow[1] < e.testWindow[0], 'Fenster nicht zeitlich getrennt');
    assert(e.tradesTrain === 36 && e.tradesValidation === 12 && e.tradesTest === 12 && e.robustness.folds.length === 3, 'Split/Walk-Forward falsch');
    assert(e.change.minScore > 60 && e.metricsChallenger.test.net > e.metricsBaseline.test.net, 'Test-Metriken falsch');
    const z = runExperiment(h, oosSet(60, true), learnTestBase(), learnTestCfg);
    assert(z.decision !== 'VALIDATED', 'Zufallsmuster wurde validiert');
    return `Regel ${JSON.stringify(e.change)} validiert (Train ${e.tradesTrain}/Val ${e.tradesValidation}/Test ${e.tradesTest}) · Zufall: ${z.decision}`;
  }],
  ['Lern-KI', 'Kleine Stichprobe → keine Regel, kein Modell, keine Übernahme', async () => {
    const h = hypothesisOf('MIN_SCORE', { minScore: 70 }, { statement: 'Test', n: 6 }, 0);
    const e = runExperiment(h, oosSet(12), learnTestBase(), learnTestCfg);
    assert(e.decision === 'INSUFFICIENT_DATA', 'kleine Stichprobe nicht abgelehnt: ' + e.decision);
    assert(trainLossModel(oosSet(20)).status === 'INSUFFICIENT_EVIDENCE' && calibrate(oosSet(20)).status === 'NOT_ENOUGH_DATA' && detectDrift(oosSet(20)).status === 'NOT_ENOUGH_DATA', 'Modell/Kalibrierung/Drift ohne Daten');
    assert(learningDecisionFor({}, null, null, null).abstain === 'INSUFFICIENT_EVIDENCE', 'Modell entscheidet ohne Evidenz');
    const H = makeTestHarness(); const core = await testCore(H, { minScore: 60 });
    oosSet(12).forEach(r => core._t.addRecord(r)); core._t.learnRun(true);
    assert(!core.state.models.challenger && core.state.models.champion === 'M-1' && core.S().minScore === 60, 'Übernahme trotz kleiner Stichprobe');
    const hi = Object.values(core.state.patterns).map(a => patternStats('x', a, { expPct: 0, totalLoss: 1 }, { minPattern: 20 })).filter(x => x.status === 'STABLE_LEARNING_PATTERN');
    assert(!hi.length, 'stabiles Muster bei n=12');
    return 'INSUFFICIENT_DATA · kein Challenger · kein stabiles Muster';
  }],
  ['Lern-KI', 'Champion/Challenger: Shadow → Übernahme (SIMULATION) → Auto-Rollback', async () => {
    const H = makeTestHarness(); const core = await testCore(H, { minScore: 60, learnShadowTrades: 5 }); const st = core.state, T = core._t;
    const riskKeys = ['maxBuysPerCoin', 'sellCooldownMin', 'lossCooldownMin', 'lossStreakLimit', 'globalPauseMin', 'maxExposurePct', 'maxPositionPct', 'dailyLossLimitPct', 'ddStopPct', 'maxTradesPerHour', 'maxOpenPositions'], risk0 = riskKeys.map(k => core.S()[k]).join(',');
    oosSet(60).forEach(r => T.addRecord(r)); T.learnRun(true);
    const ch = st.models.versions.find(v => v.id === st.models.challenger);
    assert(ch && ch.status === 'CHALLENGER' && core.S().minScore === 60, 'kein Challenger im Shadow: ' + JSON.stringify(st.research.hypotheses.map(h => h.status + ':' + (h.result ? h.result.reason : ''))) + ' · Drift ' + (st.learn.drift && st.learn.drift.status));
    const now = H.env.now(), mk = (i, low, pnl) => { const r = mkLearnRec(100 + i, { score: low ? 62 : 80, pnlPct: pnl }); r.openedAt = now + i * SEC; r.closedAt = now + i * SEC + 500; r.entry.ts = r.openedAt - 100; return r; };
    [[0, 8], [0, 7], [1, -10], [1, -12], [0, 9]].forEach(([low, pnl], i) => T.shadowEval(mk(i, !!low, pnl)));
    assert(ch.status === 'LIVE' && st.models.champion === ch.id, 'Challenger nicht übernommen: ' + ch.status);
    const promoted = core.S().minScore > 60 || Object.keys(st.models.rules.regimeScoreBump).length > 0;
    assert(promoted, 'Übernahme ohne Wirkung');
    const t2 = H.env.now() + 10 * SEC; for (let i = 0; i < 5; i++) { const r = mkLearnRec(200 + i, { score: 80, pnlPct: -12 }); r.openedAt = t2 + i * SEC; r.closedAt = r.openedAt + 500; T.liveEval(r); }
    assert(ch.status === 'ROLLED_BACK' && st.models.champion === 'M-1' && core.S().minScore === 60 && !Object.keys(st.models.rules.regimeScoreBump).length, 'Auto-Rollback fehlgeschlagen: ' + ch.status);
    assert(riskKeys.map(k => core.S()[k]).join(',') === risk0, 'Risiko-Limits durch die Lern-KI verändert');
    assert(st.auditLog.some(a => a.what === 'MODEL_PROMOTE') && st.auditLog.some(a => a.what === 'MODEL_ROLLBACK'), 'Audit fehlt');
    return `${ch.id}: Shadow ${fmtSigned(ch.shadow.chNet)} vs. ${fmtSigned(ch.shadow.baseNet)} → übernommen → Live schlechter → Rollback auf M-1`;
  }],
  ['Lern-KI', 'Lernen verschärft nur: Risiko-Limits, Security & manuelle Trades unberührt', async () => {
    const base = learnTestBase(); base.requireVerifiedSecurity = true;
    const P = mergeParams(base, { minScore: 10, minConfidence: 5, minLiq: 1, minPairAgeMin: -5, stopLossPct: 99, trailPct: 1, requireVerifiedSecurity: false, rules: { regimeScoreBump: { CHOPPY: 99 }, volumeConfirmPct: 99 } });
    assert(P.minScore === 60 && P.minConfidence === 60 && P.minLiq === 10000 && P.minPairAgeMin === 0 && P.requireVerifiedSecurity === true, 'Einstiegsfilter gelockert');
    assert(P.stopLossPct === LEARN_BOUNDS.stopLossPct[1] && P.trailPct === LEARN_BOUNDS.trailPct[0] && P.rules.regimeScoreBump.CHOPPY === 15 && P.rules.volumeConfirmPct === 5, 'Grenzen nicht eingehalten');
    assert(!LEARN_SETTING_KEYS.some(k => /cooldown|pause|buys|exposure|position|daily|streak|drawdown|^dd|trades|health/i.test(k)), 'Lern-Parameter berühren Risiko-Limits');
    const H = makeTestHarness(); const core = await testCore(H, { minScore: 85 }); const t = await prepToken(core, H, 1);
    core.state.models.rules = sanitizeRules({ regimeScoreBump: { CHOPPY: 15 } });
    core.state.regime = { tags: ['CHOPPY'] }; core._t.analyzeAll();
    assert(t.D.analysisBlockers.some(b => b.code === 'LEARNED_RULE'), 'gelernte Regel greift nicht (Auto)');
    core.state.regime = { tags: ['CHOPPY'] };
    const r = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(r.ok, 'manueller Kauf durch gelernte Regel blockiert: ' + codes(r).join(','));
    return 'Filter nur verschärft · Bounds geklemmt · Regel blockiert Auto, nicht manuell';
  }],
  ['Lern-KI', 'Keine falschen Learnings: verzerrte Trades zählen nicht, alte Daten werden bereinigt, Kurskonflikt blockiert', async () => {
    const ok = mkLearnRec(1), pyr = mkLearnRec(2), conf = mkLearnRec(3), rug = mkLearnRec(4), rugJ = mkLearnRec(5);
    pyr.execution.buys = 8; conf.execution.maxDevPct = -98.9; rug.exit.reason = 'LIQUIDITY_COLLAPSE'; rug.execution.exitSource = 'ESTIMATED'; rugJ.exit.reason = 'LIQUIDITY_COLLAPSE'; rugJ.execution.exitSource = 'JUPITER';
    assert(recordQuality(ok).ok && recordQuality(pyr).flags.join() === 'PYRAMIDED' && recordQuality(conf).flags.join() === 'PRICE_CONFLICT' && recordQuality(rug).flags.join() === 'ESTIMATED_RUG_EXIT' && recordQuality(rugJ).ok, 'Qualitätsprüfung falsch');
    const sl = slippageOf([{ price: 6.15e-6, refPrice: 5.81e-4, usd: 28.82, fees: 0.01 }], []);
    assert(sl < 0 && sl >= -28.82, 'Slippage nicht auf den Einsatz begrenzt: ' + sl);
    // Alter Stand (vor 2.12.0): Records ohne Qualitätsprüfung, Journal mit Nachkäufen / Rug-Kauf / geschätztem Rug-Exit, validierte Hypothese
    const H = makeTestHarness(); const c0 = await testCore(H), L0 = c0.state.learn, t0 = Date.UTC(2026, 0, 1);
    const recs = Array.from({ length: 12 }, (_, i) => mkLearnRec(10 + i, { pnlPct: i % 2 ? 6 : -8 }));
    const bad = { pyr: recs[0], conf: recs[1], rug: recs[2] }; bad.pyr.strategy = 'scalp';
    const jEntry = (r, entries, exits) => ({ id: r.tradeId, tokenId: r.tokenId, symbol: r.symbol, mint: tMint(1), status: 'CLOSED', mode: 'SIMULATION', openedAt: r.openedAt, closedAt: r.closedAt, entries, exits, sizeUsd: 50, feesUsd: 0.1, slippageUsd: -999, result: { pnlUsd: r.outcome.pnlUsd, pnlPct: r.outcome.pnlPct, win: r.outcome.win }, signals: [], exitReason: r.exit.reason });
    const e1 = (ts, price, ref, src) => ({ orderId: 'o' + ts, ts, price, refPrice: ref, qty: 25 / price, usd: 25, fees: 0.01, impactPct: (price / ref - 1) * 100, source: src });
    const x1 = (ts, price, ref, reason) => ({ orderId: 'x' + ts, ts, price, refPrice: ref, qty: 1000, usd: 1000 * price, fees: 0.01, reason });
    c0.state.journal = recs.map((r, i) => r === bad.pyr ? jEntry(r, Array.from({ length: 8 }, (_, k) => e1(t0 + k, 0.001, 0.001)), [x1(t0 + 99, 0.0009, 0.0009, 'STOP_LOSS')])
      : r === bad.conf ? jEntry(r, [e1(t0 + 1, 0.001, 0.001, 'JUPITER'), e1(t0 + 2, 6.15e-6, 5.81e-4, 'JUPITER')], [x1(t0 + 99, 0, 2e-6, 'NO_SELL_ROUTE')])
      : r === bad.rug ? jEntry(r, [e1(t0 + 1, 0.001, 0.001)], [x1(t0 + 99, 0.00112, 0.00115, 'LIQUIDITY_COLLAPSE')])
      : jEntry(r, [e1(t0 + 1, 0.001, 0.001, 'JUPITER')], [x1(t0 + 99, 0.00105, 0.00105, 'TP1')]));
    bad.rug.exit.reason = 'LIQUIDITY_COLLAPSE';
    for (const r of recs) { delete r.execution.buys; L0.records.push(r); }
    L0.qualityV = 0; L0.backfilled = true; L0.lessons = [{ id: 'L-X', key: 'strategy=scalp', kind: 'PREFER', text: 'alt', status: 'WATCH' }];
    for (const r of recs) for (const k of patternKeysOf(r)) c0.state.patterns[k.key] = updatePatternAgg(c0.state.patterns[k.key], r, k.dims, k.entry);
    const hyp = hypothesisOf('MIN_SCORE', { minScore: 70 }, { statement: 'alt', n: 12 }, t0); hyp.status = 'VALIDATED_HOLD'; c0.state.research.hypotheses.push(hyp);
    c0.state.research.experiments.push({ id: 'E-ALT', decision: 'VALIDATED', hypothesisId: hyp.id });
    c0._t.touch('learning', 'patterns', 'experiments'); c0.persistNow();
    const c1 = createCore({ env: H.env, backend: H.backend }); c1.init({ autoStart: false });
    const L = c1.state.learn, q = c1.learnQuality();
    assert(q.total === 12 && q.excluded === 3 && q.byFlag.PYRAMIDED === 1 && q.byFlag.PRICE_CONFLICT === 1 && q.byFlag.ESTIMATED_RUG_EXIT === 1, 'Bereinigung falsch: ' + JSON.stringify(q));
    assert(!c1.state.patterns['strategy=scalp'] && Object.values(c1.state.patterns).every(a => a.n <= 9) && !L.lessons.length, 'Muster/Lektionen enthalten verzerrte Trades');
    const h1 = c1.state.research.hypotheses.find(h => h.id === hyp.id);
    assert(h1.status === 'IDEA' && h1.result.decision === 'RETEST' && c1.state.research.experiments[0].invalidated, 'Hypothese nicht zum Neutest zurückgesetzt');
    const jc = c1.state.journal.find(j => j.id === bad.conf.tradeId);
    assert(jc.slipV === 2 && jc.slippageUsd > -26 && jc.slippageUsd < 0, 'Slippage nicht neu berechnet: ' + jc.slippageUsd);
    const run = c1._t.learnRun(true);
    assert(run.n === 9, 'Lernlauf nutzt verzerrte Trades: n=' + run.n);
    // Laufender Betrieb: Kurskonflikt (Jupiter 99 % unter DexScreener) blockiert den Kauf; Verkaufsquelle wird gespeichert
    const H2 = makeTestHarness(); const core = await testCore(H2); const t = await prepToken(core, H2, 1);
    H2.jup.buyOutFactor = 100;
    const r = await core.executeBuy(t.id, { sizeUsd: 20 });
    assert(!r.ok && codes(r).includes('PRICE_CONFLICT') && core.execCheck(t, {}).blockers.some(b => b.code === 'PRICE_CONFLICT'), 'Kurskonflikt nicht blockiert: ' + codes(r).join(','));
    H2.jup.buyOutFactor = 1; const { rec } = await learnTrade(H2, core, 2, 0.0011);
    assert(rec && rec.execution.execModel === 2 && rec.execution.exitSource === 'JUPITER' && rec.quality && rec.quality.ok && Math.abs(rec.execution.maxDevPct) < 1, 'Ausführungsdaten fehlen im Record: ' + JSON.stringify(rec && rec.execution));
    return `3 von 12 alten Trades ausgeschlossen (Nachkäufe, Kurskonflikt, geschätzter Rug-Exit) · Muster/Lektionen neu · Hypothese neu zu testen · Lernlauf n=9 · Kurskonflikt → PRICE_CONFLICT`;
  }],
  ['Lern-KI', 'Drift-Erkennung (Feature & Outcome) und NOT_ENOUGH_DATA', async () => {
    assert(detectDrift(oosSet(10)).status === 'NOT_ENOUGH_DATA', 'Drift ohne Daten');
    const rs = Array.from({ length: 80 }, (_, i) => mkLearnRec(i, i < 60 ? { vol: 1 + (i % 10) / 10, pnlPct: i % 3 ? 6 : -6 } : { vol: 8 + (i % 5), pnlPct: i % 4 ? -9 : 5 }));
    const d = detectDrift(rs), v = d.checks.find(c => c.name === 'Volatilität'), w = d.checks.find(c => c.name === 'Trefferquote');
    assert(d.status === 'DRIFT' && v.status === 'DRIFT' && w.status !== 'STABLE', 'Drift nicht erkannt: ' + JSON.stringify(d.checks.map(c => c.name + ':' + c.status)));
    const same = detectDrift(Array.from({ length: 80 }, (_, i) => mkLearnRec(i, { vol: 1 + (i % 10) / 10, pnlPct: i % 2 ? 5 : -5 })));
    assert(same.checks.find(c => c.name === 'Volatilität').status === 'STABLE', 'Fehlalarm bei gleicher Verteilung');
    return `Volatilität PSI ${v.value} → DRIFT · Trefferquote Δ ${w.value}`;
  }],
  ['Lern-KI', 'Persistenz: Records, Muster, Hypothesen, Experimente & Modelle überstehen Neustart', async () => {
    const H = makeTestHarness(); const core = await testCore(H, { minScore: 60 });
    oosSet(40).forEach(r => core._t.addRecord(r)); core._t.learnRun(true); core.persistNow();
    const a = core.state, snap = [a.learn.records.length, Object.keys(a.patterns).length, a.research.hypotheses.length, a.research.experiments.length, a.models.versions.length, a.models.champion, a.models.challenger];
    const core2 = createCore({ env: H.env, backend: H.backend }); core2.init({ autoStart: false });
    const b = core2.state, snap2 = [b.learn.records.length, Object.keys(b.patterns).length, b.research.hypotheses.length, b.research.experiments.length, b.models.versions.length, b.models.champion, b.models.challenger];
    assert(JSON.stringify(snap) === JSON.stringify(snap2), 'Lerndaten nach Neustart verändert: ' + snap + ' vs ' + snap2);
    assert(snap[0] === 40 && snap[2] > 0 && snap[3] > 0, 'nichts gelernt: ' + snap);
    return `${snap[0]} Records · ${snap[1]} Muster · ${snap[2]} Hypothesen · ${snap[3]} Experimente · ${snap[4]} Modellversionen`;
  }],
  ['Lern-KI', 'Beschädigter Lernspeicher → sichere Defaults, Handel unberührt', async () => {
    const H = makeTestHarness(); H.backend = createMemoryBackend();
    H.backend.set(STORAGE_KEYS.learning, '{kaputt');
    H.backend.set(STORAGE_KEYS.models, JSON.stringify({ v: STORAGE_VERSION, models: { champion: 'X', versions: 'nope' } }));
    H.backend.set(STORAGE_KEYS.patterns, JSON.stringify({ v: STORAGE_VERSION, patterns: { a: { n: 'x' } } }));
    H.backend.set(STORAGE_KEYS.experiments, JSON.stringify({ v: STORAGE_VERSION, research: { hypotheses: [{ id: 1 }, { id: 'H-1', type: 'EVAL', change: {} }], experiments: 'x' } }));
    const core = await testCore(H), st = core.state;
    assert(!st.reconciliation.required, 'Lerndaten lösen Abgleich aus');
    assert(!st.learn.records.length && st.models.champion === 'M-1' && !Object.keys(st.patterns).length && !st.research.hypotheses.length && st.learn.corrupted.includes('learning'), 'Defaults nicht gesetzt');
    const t = await prepToken(core, H, 1); assert((await core.executeBuy(t.id, { sizeUsd: 20 })).ok, 'Handel blockiert');
    const r = sanitizeRules({ regimeScoreBump: { CHOPPY: 999, 'bad key': 5 }, blocks: ['<script>|X', 'momentum|CHOPPY'], volumeConfirmPct: -3, blockPostPump: 'ja' });
    assert(r.regimeScoreBump.CHOPPY === 15 && !('bad key' in r.regimeScoreBump) && r.blocks.length === 1 && r.volumeConfirmPct === 0 && r.blockPostPump === false, 'manipulierte Regeln nicht bereinigt');
    return 'kaputte Lernbereiche verworfen · kein Abgleich · Kauf möglich · Regeln bereinigt';
  }],
  ['Lern-KI', 'Deterministisch: gleiche Daten → gleiche Experimente, Modelle, Hypothesen', async () => {
    const h = hypothesisOf('MIN_SCORE', { minScore: 70 }, { statement: 'Test', n: 30 }, 0);
    const e1 = runExperiment(h, oosSet(60), learnTestBase(), learnTestCfg), e2 = runExperiment(h, oosSet(60), learnTestBase(), learnTestCfg);
    assert(JSON.stringify(e1) === JSON.stringify(e2), 'Experiment nicht deterministisch');
    const m1 = trainLossModel(oosSet(60)), m2x = trainLossModel(oosSet(60));
    assert(JSON.stringify(m1) === JSON.stringify(m2x) && m1.w, 'Loss-Modell nicht deterministisch');
    assert(JSON.stringify(bootstrapCI([1, -2, 3, 4, -1, 2], 'k')) === JSON.stringify(bootstrapCI([1, -2, 3, 4, -1, 2], 'k')), 'Bootstrap nicht deterministisch');
    const agg = {}; for (const r of oosSet(40)) for (const k of patternKeysOf(r)) agg[k.key] = updatePatternAgg(agg[k.key], r, k.dims, k.entry);
    const stats = Object.entries(agg).map(([k, a]) => patternStats(k, a, { expPct: -1, totalLoss: 100 }, { minPattern: 20 }));
    assert(JSON.stringify(generateHypotheses(stats, null, { expPct: -1 }, learnTestBase(), 0)) === JSON.stringify(generateHypotheses(stats, null, { expPct: -1 }, learnTestBase(), 0)), 'Hypothesen nicht deterministisch');
    return `Experiment ${e1.id} · Modell AUC ${m1.auc} · identisch bei Wiederholung`;
  }],
  ['Backtest', 'Backtest reproduzierbar & versioniert (Run-ID aus Daten, Parametern, Kosten, Code)', async () => {
    const c = btTestCandles(), cfg = btTestCfg();
    const w1 = walkForward(c, cfg), w2 = walkForward(c, cfg);
    assert(JSON.stringify(w1.test) === JSON.stringify(w2.test) && w1.chosen === w2.chosen, 'Walk-Forward nicht reproduzierbar');
    const m1 = btRunMeta(c, cfg, { tf: '1m', chosen: w1.chosen }), m2 = btRunMeta(c, cfg, { tf: '1m', chosen: w1.chosen });
    const c2 = c.map((k, i) => (i === 100 ? { ...k, c: k.c * 1.001 } : k));
    assert(m1.id === m2.id && m1.id !== btRunMeta(c2, cfg, { tf: '1m', chosen: w1.chosen }).id && m1.id !== btRunMeta(c, { ...cfg, feePct: 0.5 }, { tf: '1m', chosen: w1.chosen }).id, 'Run-ID nicht eindeutig/stabil');
    assert(m1.oosPct === 50 && m1.limitations.length >= 5 && m1.dataset.n === c.length && m1.costs.feePct === cfg.feePct, 'Run-Protokoll unvollständig');
    return `Run ${m1.id} · Datensatz ${m1.dataset.hash} · ${w1.test.trades} Test-Trades · identisch bei Wiederholung`;
  }],
  ['Backtest', 'Stress: höhere Kosten verbessern das Ergebnis nie · Einstieg später ohne Look-Ahead', async () => {
    const c = btTestCandles(), cfg = { ...btTestCfg(), param: 3 };
    const st = btStress(c, cfg, 150, c.length), base = st[0];
    assert(st.find(x => x.name === 'Gebühren ×2').net <= base.net + 1e-9 && st.find(x => x.name === 'Slippage ×2').net <= base.net + 1e-9, 'höhere Kosten verbessern das Ergebnis');
    const d0 = runBacktest(c, cfg), d1 = runBacktest(c, { ...cfg, entryDelay: 1 }), cut = runBacktest(c.slice(0, 220), { ...cfg, entryDelay: 1 });
    assert(d1.trades.length && d0.trades[0].entryT + MIN === d1.trades[0].entryT, 'Verzögerung verschiebt den Einstieg nicht um genau 1 Kerze');
    assert(d1.trades.filter(t => t.exitT < 210 * MIN).every((t, i) => cut.trades[i] && cut.trades[i].entryT === t.entryT && Math.abs(cut.trades[i].pnl - t.pnl) < 1e-9), 'verzögerter Einstieg hängt von zukünftigen Kerzen ab');
    return `Basis ${fmtSigned(base.net)} · Gebühren ×2 ${fmtSigned(st[1].net)} · Slippage ×2 ${fmtSigned(st[2].net)} · Verzögerung ohne Look-Ahead`;
  }],
  ['Backtest', 'Monte-Carlo-Drawdown deterministisch, Regime-Auswertung vollständig', async () => {
    const c = btTestCandles(), r = runBacktest(c, { ...btTestCfg(), param: 3 });
    const a = mcDrawdown(r.trades, 1000, 'X'), b = mcDrawdown(r.trades, 1000, 'X');
    assert(a && JSON.stringify(a) === JSON.stringify(b) && a.p95 >= a.p50 && a.worst >= a.p95, 'Monte-Carlo nicht deterministisch/monoton');
    const reg = btByRegime(r.trades, c), vol = Object.entries(reg).filter(([k]) => k.startsWith('Volatilität')), tr = Object.entries(reg).filter(([k]) => k.startsWith('Trend'));
    assert(sum(vol.map(([, x]) => x.n)) === r.trades.length && sum(tr.map(([, x]) => x.n)) === r.trades.length && r.trades.every(t => t.regime), 'Regime-Zuordnung unvollständig');
    assert(Math.abs(sum(vol.map(([, x]) => x.net)) - sum(r.trades.map(t => t.pnl))) < 1e-6, 'Regime-Summe ≠ Gesamt');
    return `MC-DD Median ${a.p50.toFixed(1)} % / 95 % ${a.p95.toFixed(1)} % · ${vol.length} Volatilitäts- und ${tr.length} Trend-Regime`;
  }],
  ['Adaptive KI', 'Fehlerklassen: normaler Verlust ≠ Fehler · „erwartbar?“ gegen den geplanten Stop', async () => {
    const S = defaultSettings(), lab = (i, o, fx) => { const r = mkLearnRec(i, o); r.plan = { stopPct: 15 }; if (fx) fx(r); r.labels = labelTrade(r, { S }); return r; };
    const n = lab(1, { pnlPct: -3 });
    assert(n.labels.lossFamily === 'NOISE_OR_RANDOM' && n.labels.errorClass === 'STATISTICAL' && n.labels.lossVerdict === 'EXPECTED', 'normaler Verlust nicht als erwartbar eingestuft: ' + [n.labels.errorClass, n.labels.lossVerdict]);
    const gap = lab(2, { pnlPct: -40 });
    assert(gap.labels.errorClass === 'EXECUTION' && gap.labels.lossVerdict === 'OVER_PLAN' && /Kurslücke/.test(gap.labels.errorWhy), 'Verlust über Plan nicht als Execution-Fehler erkannt: ' + [gap.labels.errorClass, gap.labels.lossVerdict]);
    const cases = [
      ['EXECUTION', lab(3, { pnlPct: -12 }, r => { r.exit.reason = 'LIQUIDITY_COLLAPSE'; r.path.minLiqPct = -60; })],
      ['DATA', lab(4, { pnlPct: -10 }, r => { r.entry.conflicts = 2; r.entry.fallback = true; })],
      ['SECURITY', lab(5, { pnlPct: -10 }, r => { r.entry.secStatus = 'CRITICAL'; })],
      ['MODEL', lab(6, { pnlPct: -10 }, r => { r.entry.sigMax = 85; r.path.mae2m = -8; r.path.mfe2m = 0; })],
      ['PROCESS', lab(7, { pnlPct: -5 }, r => { r.entry.blockerCount = 2; })]
    ];
    for (const [want, r] of cases) assert(r.labels.errorClass === want, `${want} erwartet, war ${r.labels.errorClass} (${r.labels.lossFamily})`);
    assert(cases.every(([, r]) => r.labels.lossVerdict !== 'EXPECTED'), 'Verlust mit belegter Ursache als erwartbar eingestuft');
    const noPlan = mkLearnRec(8, { pnlPct: -3 }); noPlan.labels = labelTrade(noPlan, { S });
    assert(noPlan.labels.expectedLoss.source === 'SETTINGS' && noPlan.labels.expectedLoss.plannedPct === S.stopLossPct, 'ohne geplanten Stop keine gekennzeichnete Näherung');
    const empty = { entry: null, execution: {}, path: {}, exit: {}, outcome: { pnlUsd: -1, pnlPct: -2, win: false } };
    assert(labelTrade(empty, { S }).errorClass === 'UNKNOWN' && labelTrade(mkLearnRec(9, { pnlPct: 8 }), { S }).errorClass === null, 'UNKNOWN/Gewinn falsch klassifiziert');
    const st = errorClassStats([n, gap, ...cases.map(c => c[1])]);
    assert(st.n === 7 && st.classes.STATISTICAL === 1 && st.classes.EXECUTION === 2 && st.verdicts.EXPECTED === 1 && st.verdicts.OVER_PLAN === 1, 'Statistik falsch: ' + JSON.stringify(st));
    // Migration: ältere Verluste ohne Fehlerklasse bekommen sie beim Laden – die Ursache bleibt unverändert
    const H = makeTestHarness(); const core = await testCore(H), old = lab(10, { pnlPct: -3 });
    for (const k of ['errorClass', 'errorWhy', 'lossVerdict', 'expectedLoss']) delete old.labels[k];
    core._t.addRecord(old); core.persistNow();
    const core2 = createCore({ env: H.env, backend: H.backend }); core2.init({ autoStart: false });
    const re = core2.state.learn.records.find(r => r.tradeId === old.tradeId);
    assert(re && re.labels.errorClass === 'STATISTICAL' && re.labels.lossFamily === 'NOISE_OR_RANDOM', 'Migration der Fehlerklasse fehlt');
    return 'Zufall → erwartbar · Kurslücke → Execution · Daten/Security/Modell/Prozess getrennt · Migration ok';
  }],
  ['Adaptive KI', 'Near-Misses: 15 min Nachlauf → verpasster Gewinn vs. vermiedener Verlust, reine Messung', async () => {
    const H = makeTestHarness(); const core = await testCore(H, { minScore: 65, tp1Pct: 30, stopLossPct: 15 }), S0 = core.S();
    const A0 = { core: { price: 1, mc: 1 }, finalScore: 60, confidence: { total: 80 }, risk: { total: 30, level: 'LOW' } };
    const mkD = (codes, dec = 'WATCH', exec = [], o = {}) => ({ decision: dec, fastPass: true, secOk: true, analysisBlockers: codes.map(c => ({ code: c, msg: c })), execBlockers: exec.map(c => ({ code: c, msg: c })), ...o });
    const one = nearMissOf(A0, mkD(['SCORE_TOO_LOW']), S0);
    assert(one && one.gap === 5 && one.kind === 'ANALYSIS', 'Score knapp unter Minimum nicht erfasst');
    assert(!nearMissOf({ ...A0, finalScore: 40 }, mkD(['SCORE_TOO_LOW']), S0), 'weit unter Minimum als Near-Miss erfasst');
    assert(!nearMissOf(A0, mkD(['SECURITY_CRITICAL'], 'REJECTED'), S0) && !nearMissOf(A0, mkD(['SCORE_TOO_LOW'], 'WATCH', [], { secOk: false }), S0), 'Security-Problem als Near-Miss erfasst');
    assert(!nearMissOf(A0, mkD(['SCORE_TOO_LOW', 'NO_CONSENSUS']), S0) && !nearMissOf(A0, mkD([], 'APPROVED'), S0), 'mehrere Blocker/APPROVED als Near-Miss erfasst');
    assert(nearMissOf(A0, mkD([], 'BUY_CANDIDATE', ['LOSS_COOLDOWN']), S0).kind === 'RISK' && !nearMissOf(A0, mkD([], 'BUY_CANDIDATE', ['AUTO_TRADING_OFF', 'LOSS_COOLDOWN']), S0), 'Risiko-/Systemblocker falsch behandelt');
    const up = await prepToken(core, H, 1), dn = await prepToken(core, H, 2), gone = await prepToken(core, H, 3);
    for (const t of [up, dn, gone]) { t.A = { ...A0, core: { price: t.snap.priceUsd, mc: 1.5e6 }, finalScore: 62 }; t.D = mkD(['SCORE_TOO_LOW']); }
    const N = core.state.learn.nearMiss;
    core._t.nearMissTick(H.env.now()); core._t.nearMissTick(H.env.now());
    assert(N.open.length === 3, 'Near-Misses nicht (einmalig) erfasst: ' + N.open.length);
    delete H.market[gone.mint];
    const step = async (pUp, pDn) => { H.env.advance(MIN); H.market[up.mint] = H.pair(up.mint, { price: pUp }); H.market[dn.mint] = H.pair(dn.mint, { price: pDn }); await core._t.fetchChunk([up.mint, dn.mint, gone.mint], true); core._t.nearMissTick(H.env.now()); };
    await step(0.0011, 0.00095); await step(0.00135, 0.0008);
    for (let i = 0; i < 14; i++) await step(0.0013, 0.0007);
    const by = t => N.done.find(m => m.tokenId === t.id), u = by(up), d = by(dn), g = by(gone);
    assert(!N.open.length && u && d && g, 'Beobachtung nicht nach 15 min abgeschlossen');
    assert(u.outcome === 'MISSED_GAIN' && u.maxPct >= 30 && u.simPct > 0, 'verpasster Gewinn nicht erkannt: ' + JSON.stringify([u.outcome, u.maxPct, u.simPct]));
    assert(d.outcome === 'AVOIDED_LOSS' && d.minPct <= -15 && d.simPct < 0, 'vermiedener Verlust nicht erkannt: ' + JSON.stringify([d.outcome, d.minPct, d.simPct]));
    assert(g.outcome === 'NO_DATA' && g.simPct == null, 'fehlende Kursdaten nicht als NO_DATA markiert (keine erfundenen Werte)');
    assert(!('samples' in u) && !('samples' in d), 'Preispfad dauerhaft gespeichert');
    const st = nearMissStats(N.done);
    assert(st.n === 2 && st.missed === 1 && st.avoided === 1 && st.noData === 1 && st.rows[0].verdict === 'NOT_ENOUGH_DATA', 'Statistik falsch: ' + JSON.stringify(st));
    assert(core.S().minScore === 65 && !core.state.configLog.some(c => !['TEST', 'MIGRATION'].includes(c.who)), 'Near-Miss-Messung hat Einstellungen verändert');
    core.persistNow(); const core2 = createCore({ env: H.env, backend: H.backend }); core2.init({ autoStart: false });
    assert(core2.state.learn.nearMiss.done.length === 3, 'Near-Misses nach Neustart verloren');
    return `verpasst ${fmtPct(u.simPct)} · vermieden ${fmtPct(d.simPct)} · 1× NO_DATA · Filter unverändert · übersteht Neustart`;
  }],
  ['Adaptive KI', 'Aktive Parameter: Wert, Herkunft & Grund nachvollziehbar (Standard, manuell, gelernt, unprotokolliert)', async () => {
    const H = makeTestHarness(); const core = await testCore(H), row = k => core.activeParams().find(p => p.key === k);
    assert(row('maxOpenPositions').source === 'DEFAULT' && row('lossCooldownMin').bounds === '0–1440' && /lernbar/.test(row('minScore').bounds), 'Standard/Grenzen falsch');
    core.updateSettings({ minConfidence: 70 }, 'USER');
    const r1 = row('minConfidence'); assert(r1.source === 'USER' && r1.value === 70 && isNum(r1.since) && r1.reason.includes('→ 70'), 'manuelle Änderung nicht nachvollziehbar: ' + JSON.stringify(r1));
    const M = core.state.models, from = core.S().minScore;
    M.versions.push({ id: 'M-2', ts: H.env.now(), status: 'LIVE', params: {}, rules: emptyRules(), basedOn: 'M-1', change: { minScore: 75 }, applied: { minScore: { from, to: 75 } }, experimentId: 'E-TEST', hypothesisId: null, note: 'Testmodell', promotedAt: H.env.now() });
    core.updateSettings({ minScore: 75 }, 'LEARNING', { noVersion: true }); M.champion = 'M-2';
    const r2 = row('minScore'); assert(r2.source === 'LEARNED' && r2.reason.includes('E-TEST') && r2.reason.includes(from + ' → 75'), 'gelernte Änderung ohne Herkunft: ' + JSON.stringify(r2));
    core.updateSettings({ minScore: 80 }, 'USER'); assert(row('minScore').source === 'USER', 'manuelle Änderung nach dem Lernen nicht erkannt');
    core.state.configLog.length = 0;
    assert(row('minScore').source === 'UNTRACKED' && row('minConfidence').source === 'UNTRACKED', 'unprotokollierte Werte als bekannt ausgegeben');
    return 'Standard · manuell · gelernt (Experiment) · manuell überschrieben · unprotokolliert ehrlich markiert';
  }],
  ['Adaptive KI', 'Auto-Tuning ohne Lern-KI ändert keine Parameter (keine Suche ohne Out-of-Sample-Nachweis)', async () => {
    const H = makeTestHarness(); const core = await testCore(H, { ffAutoTuning: true, learnEnabled: false, minScore: 60 }), st = core.state, v = st.activeParam, now = H.env.now();
    // Scheinbarer Effekt: höhere Scores gewinnen – die alte Suche hätte minScore auf 65 gesetzt (In-Sample)
    for (let i = 0; i < 30; i++) st.journal.unshift({ id: 'J' + i, symbol: 'T' + i, status: 'CLOSED', mode: 'SIMULATION', paramVersion: v, score: i % 2 ? 66 : 61, signals: [], result: { pnlUsd: i % 2 ? 5 : -5, pnlPct: i % 2 ? 10 : -10, win: !!(i % 2) }, sizeUsd: 50, feesUsd: 0.1, slippageUsd: 0, holdMs: MIN, openedAt: now - (31 - i) * MIN, closedAt: now - (30 - i) * MIN });
    const before = st.paramVersions.length;
    core._t.maybeTune();
    assert(core.S().minScore === 60 && st.paramVersions.length === before && !st.configLog.some(c => c.who === 'AUTO_TUNING'), 'naive Parameter-Suche noch aktiv');
    assert(st.paramVersions.find(p => p.version === v).perf, 'Version wird nicht mehr bewertet');
    return 'minScore bleibt 60 trotz scheinbarem In-Sample-Vorteil · Version bewertet';
  }],
  ['Monitoring', 'Anomalie-Monitor: Reason Codes, Standard nur warnen, „handeln“ pausiert und drosselt', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1), st = core.state; core._t.analyzeAll();
    const now = H.env.now();
    for (let i = 0; i < 3; i++) st.orders.unshift({ id: 'TF' + i, side: 'BUY', symbol: 'X', state: 'FAILED', createdAt: now - i * SEC, failureCode: 'QUOTE_FAILED', history: [] });
    for (let i = 0; i < 3; i++) st.orders.unshift({ id: 'TC' + i, side: 'BUY', symbol: 'X', state: 'COMPLETED', createdAt: now - i * SEC, latencyMs: 120, expSlipPct: core.S().maxSlippagePct * 3, history: [] });
    let r = core._t.monitorTick(H.env.now());
    const ex = r.active.find(a => a.code === 'EXEC_FAILURES'), sl = r.active.find(a => a.code === 'SLIPPAGE_SPIKE');
    assert(ex && ex.action === 'PAUSE' && ex.sev === 'HIGH' && sl && sl.action === 'DEGRADE', 'Anomalien nicht erkannt: ' + JSON.stringify(r.active.map(a => a.code)));
    assert(st.feed.some(e => /Anomalie EXEC_FAILURES/.test(e.detail)) && st.monitor.history.some(e => e.code === 'EXEC_FAILURES' && e.event === 'START'), 'kein Alarm/Verlauf');
    const adj = () => (core.execCheck(t, { auto: false }).sizing.factors || { adj: [] }).adj.map(a => a.code);
    assert(!core.globalBlockers({ auto: true }).some(b => b.code === 'ANOMALY_PAUSE') && !adj().includes('ANOMALY_DEGRADE'), 'Modus „nur warnen“ darf nicht eingreifen');
    core.updateSettings({ anomalyMode: 'act' }, 'TEST');
    assert(core.globalBlockers({ auto: true }).some(b => b.code === 'ANOMALY_PAUSE') && !core.globalBlockers({ auto: false }).some(b => b.code === 'ANOMALY_PAUSE'), 'Modus „handeln“ pausiert Auto-Käufe nicht (oder blockiert manuelle)');
    assert(adj().includes('ANOMALY_DEGRADE'), 'Modus „handeln“ drosselt die Positionsgröße nicht');
    st.orders = st.orders.filter(o => !/^T[FC]/.test(o.id)); H.env.advance(SEC);
    r = core._t.monitorTick(H.env.now());
    assert(!r.active.length && st.monitor.history.some(e => e.code === 'EXEC_FAILURES' && e.event === 'END') && !core.globalBlockers({ auto: true }).some(b => b.code === 'ANOMALY_PAUSE'), 'Anomalie endet nicht: ' + JSON.stringify(r.active.map(a => a.code)));
    return 'EXEC_FAILURES → PAUSE · SLIPPAGE_SPIKE → DEGRADE · nur warnen greift nicht ein · handeln: nur Auto pausiert, Größe ×0,5 · Ende protokolliert';
  }],
  ['Monitoring', 'Kritischer Portfolio-Fehler: Not-Stopp nur im Modus „handeln“ und nur einmal', async () => {
    const H = makeTestHarness(); const core = await testCore(H), st = core.state;
    st.portfolio.cash = -50;
    core._t.monitorTick(H.env.now());
    assert(st.monitor.active.PORTFOLIO_INTEGRITY && st.monitor.active.PORTFOLIO_INTEGRITY.action === 'HARD_STOP' && !st.bot.emergency, 'Modus „nur warnen“: Anomalie erkannt, aber kein Not-Stopp erwartet');
    core.updateSettings({ anomalyMode: 'act' }, 'TEST');
    core._t.monitorTick(H.env.now());
    assert(st.bot.emergency && /Anomalie-Monitor/.test(st.bot.emergencyReason), 'kein Not-Stopp im Modus „handeln“');
    st.bot.emergency = false; core._t.monitorTick(H.env.now());
    assert(!st.bot.emergency, 'Not-Stopp wird nach Freigabe sofort erneut ausgelöst');
    return 'NEGATIVE_CASH → HARD_STOP · warnen: kein Eingriff · handeln: Not-Stopp genau einmal';
  }],
  ['Monitoring', 'Kennzahlen: Signale, Blockquoten, Order-Erfolg, Latenz, Datenfrische, Lern-KI', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    const b = await core.executeBuy(t.id, { sizeUsd: 20 }); assert(b.ok, 'Kauf fehlgeschlagen: ' + codes(b).join(','));
    core._t.analyzeAll();
    const m = core.monitorMetrics();
    assert(m.exec.orders >= 1 && m.exec.completed >= 1 && m.exec.successRate === 1 && isNum(m.exec.avgLatencyMs), 'Order-Kennzahlen falsch: ' + JSON.stringify(m.exec));
    assert(m.signals.analyzed >= 1 && m.blocks.security != null && m.blocks.risk != null && isNum(m.signals.perHour), 'Signale/Blockquoten fehlen: ' + JSON.stringify([m.signals, m.blocks]));
    assert(m.learn.enabled && ['OK', 'WARN'].includes(m.learn.status) && m.data.fresh === 1, 'Lern-/Daten-Status falsch: ' + JSON.stringify([m.learn, m.data]));
    core.updateSettings({ learnEnabled: false }, 'TEST');
    assert(core.monitorMetrics().learn.status === 'AUS', 'Lern-KI aus nicht erkannt');
    return `${m.exec.orders} Order(s), Erfolg ${Math.round(m.exec.successRate * 100)} %, Ø ${m.exec.avgLatencyMs} ms · Daten ${Math.round(m.data.fresh * 100)} % frisch · Lern-KI ${m.learn.status}`;
  }],
  ['Ehrliche Simulation', 'Echte Kursangebote (Jupiter): Füllung zum Angebot, Honeypot & Rundreise-Kosten blockieren, Rückfall markiert', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    const r = await core.executeBuy(t.id, { sizeUsd: 20 });
    assert(r.ok && r.order.quote.source === 'JUPITER' && /Raydium/.test(r.order.route) && isNum(r.order.quote.roundTripPct) && r.order.quote.roundTripPct > 0 && r.order.quote.roundTripPct < 3, 'Kauf nicht über Jupiter-Angebot: ' + JSON.stringify(r.order && r.order.quote));
    const pos = core.state.positions[0], e = pos.entries[0];
    assert(pos.decimals === 6 && e.source === 'JUPITER' && e.price > 0.001 && e.price < 0.00101 && r.order.fees.dex === 0, 'Füllpreis/Decimals/Gebühren falsch: ' + e.price);
    const s1 = await core.executeSell(pos.id, 'ALL', 'MANUAL');
    assert(s1.ok && s1.order.quote.source === 'JUPITER' && !core.state.positions.length && s1.order.fillPrice < 0.001, 'Verkauf nicht über Jupiter-Angebot');
    const t2 = await prepToken(core, H, 2); H.jup.noSell.add(t2.mint);
    const h = await core.executeBuy(t2.id, { sizeUsd: 20 });
    assert(!h.ok && codes(h).includes('NO_SELL_ROUTE') && core.execCheck(t2, {}).blockers.some(b => b.code === 'NO_SELL_ROUTE') && !core.state.positions.length, 'Honeypot nicht blockiert: ' + codes(h).join(','));
    const t3 = await prepToken(core, H, 3); H.jup.taxPct = 12.5;
    const x = await core.executeBuy(t3.id, { sizeUsd: 20 }); H.jup.taxPct = 0;
    assert(!x.ok && codes(x).includes('ROUND_TRIP_COST'), 'Rundreise-Kosten nicht blockiert: ' + codes(x).join(','));
    core.updateSettings({ jupApiKey: 'test-key_1' }, 'TEST'); const t4 = await prepToken(core, H, 4);
    assert((await core.executeBuy(t4.id, { sizeUsd: 20 })).ok && H.calls.some(u => u.startsWith(JUP_API_KEYED)) && H.jup.lastHeaders && H.jup.lastHeaders['x-api-key'] === 'test-key_1', 'API-Key nicht verwendet');
    assert(validateSettings({ jupApiKey: 'a b<script>' }, core.S()).errors.length === 1, 'ungültiger API-Key angenommen');
    assert(!core.exportData('settings-json').data.includes('test-key_1') && !core.exportData('logs-json').data.includes('test-key_1'), 'API-Key im Einstellungs-/Log-Export');
    core.updateSettings({ jupApiKey: '' }, 'TEST');
    H.jup.down = true; const t5 = await prepToken(core, H, 5);
    const f = await core.executeBuy(t5.id, { sizeUsd: 20 });
    assert(f.ok && f.order.quote.source === 'AMM' && /Jupiter/.test(f.order.quote.fallbackReason || '') && /AMM/.test(f.order.route), 'Rückfall nicht als Schätzung markiert');
    core.updateSettings({ quoteFallback: false }, 'TEST'); const t6 = await prepToken(core, H, 6);
    const n = await core.executeBuy(t6.id, { sizeUsd: 20 }); H.jup.down = false;
    assert(!n.ok && n.order.failureCode === 'QUOTE_FAILED', 'ohne Rückfall trotzdem gehandelt');
    assert(core.liveReadiness().checks.find(c => /^Ehrliche Ausführung/.test(c.name)).ok, 'LIVE-Gate: ehrliche Ausführung nicht erkannt');
    core.updateSettings({ quoteFallback: true }, 'TEST');
    assert(!core.liveReadiness().checks.find(c => /^Ehrliche Ausführung/.test(c.name)).ok, 'LIVE-Gate akzeptiert Schätz-Rückfall');
    assert(H.calls.filter(u => /jup\.ag/.test(u)).every(u => /\/swap\/v1\/quote\?/.test(u)), 'Jupiter-Aufruf außer /quote');
    return `Kauf/Verkauf zum Jupiter-Angebot (Rundreise ${r.order.quote.roundTripPct} %) · Honeypot → NO_SELL_ROUTE · Steuer → ROUND_TRIP_COST · API-Key per Header · Rückfall AMM markiert · nur /quote`;
  }],
  ['Ehrliche Simulation', 'Ausführung wie on-chain: Wartezeit, Füllung zum späteren Angebot, Slippage-Grenze, gescheiterte Transaktion kostet Gebühr', async () => {
    const H = makeTestHarness(); const core = await testCore(H, { simLatencyMs: 40 });
    const t = await prepToken(core, H, 1); H.jup.calls = 0;
    H.market[t.mint] = () => H.pair(t.mint, { price: H.jup.calls >= 3 ? 0.00102 : 0.001 })(); // Preis steigt während der Wartezeit um 2 %
    const r = await core.executeBuy(t.id, { sizeUsd: 20 });
    assert(r.ok && r.order.quote.latencyApplied && r.order.fillPrice > 0.00102 && r.order.expSlipPct > 2 && r.order.latencyMs >= 40 && r.order.history.some(x => /Warte 40 ms/.test(x.note || '')), 'Füllung nicht zum späteren Preis: ' + r.order.fillPrice);
    const t2 = await prepToken(core, H, 2); H.jup.calls = 0;
    H.market[t2.mint] = () => H.pair(t2.mint, { price: H.jup.calls >= 3 ? 0.00105 : 0.001 })(); // +5 % > 3 % Slippage-Grenze
    const cash0 = core.state.portfolio.cash, real0 = core.state.portfolio.realized;
    const r2 = await core.executeBuy(t2.id, { sizeUsd: 20 }), lost = cash0 - core.state.portfolio.cash;
    assert(!r2.ok && r2.order.failureCode === 'SLIPPAGE_EXCEEDED' && r2.order.fees.failedTx && lost > 0.01 && lost < 0.05 && Math.abs(core.state.portfolio.realized - (real0 - lost)) < 1e-6 && core.state.positions.length === 1, 'Slippage-Fehlschlag falsch verbucht: ' + lost);
    const pos = core.state.positions[0]; core.updateSettings({ simTxFailPct: 50 }, 'TEST'); H.env.random = () => 0.1;
    const s1 = await core.executeSell(pos.id, 'ALL', 'MANUAL');
    assert(!s1.ok && s1.order.failureCode === 'TX_FAILED' && pos.failedTx === 1 && pos.realizedUsd < 0 && core.state.positions.length === 1, 'gescheiterter Verkauf falsch: ' + (s1.order && s1.order.failureCode));
    H.env.random = () => 0.9; const s2 = await core.executeSell(pos.id, 'ALL', 'MANUAL');
    const j = core.state.journal.find(x => x.id === pos.id);
    assert(s2.ok && !core.state.positions.length && j.result && Math.abs(j.result.pnlUsd - pos.realizedUsd) < 1e-6 && pos.lc === 'RECONCILED' && core.portfolioIntegrity().ok, 'Gebühr des Fehlversuchs nicht im Ergebnis/Abgleich');
    H.prioFee = 2e6; const t3 = await prepToken(core, H, 3);
    const r3 = await core.executeBuy(t3.id, { sizeUsd: 20 });
    assert(r3.ok && r3.order.quote.prioLamports === 468750, 'Priority Fee nicht aus Netzwerkgebühren: ' + (r3.order.quote && r3.order.quote.prioLamports));
    core.updateSettings({ priorityFeeMode: 'fixed' }, 'TEST'); const t4 = await prepToken(core, H, 4);
    const r4 = await core.executeBuy(t4.id, { sizeUsd: 20 });
    assert(r4.ok && r4.order.quote.prioLamports === core.S().priorityFeeLamports, 'fester Wert nicht verwendet');
    return `Füllung nach 40 ms zum +2 %-Preis · +5 % → SLIPPAGE_EXCEEDED, Gebühr ${fmtUsd(lost, 4)} bezahlt · TX_FAILED → neuer Versuch, Ergebnis abgeglichen · Priority Fee automatisch ${r3.order.quote.prioLamports} Lamports`;
  }],
  ['Ehrliche Simulation', 'Kein Verkaufsweg: Position zählt 0 $, nach 30 min Totalverlust abgeschrieben und gelernt', async () => {
    const H = makeTestHarness(); const core = await testCore(H); const t = await prepToken(core, H, 1);
    assert((await core.executeBuy(t.id, { sizeUsd: 20 })).ok, 'Kauf fehlgeschlagen');
    const pos = core.state.positions[0]; H.jup.noSell.add(t.mint);
    const s1 = await core.executeSell(pos.id, 'ALL', 'STOP_LOSS', { auto: true });
    assert(!s1.ok && s1.order.failureCode === 'NO_ROUTE' && pos.noRouteSince > 0 && pos.sellRetryAt > H.env.now() && core.state.positions.length === 1, 'fehlender Verkaufsweg nicht erkannt');
    await core._t.managePositions();
    assert(pos.value === 0 && core.equityInfo().equity < core.S().simCapitalUsd - 19, 'Position ohne Verkaufsweg nicht mit 0 bewertet: ' + pos.value);
    H.env.advance(31 * MIN); await core._t.fetchChunk([t.mint], true);
    const s2 = await core.executeSell(pos.id, 'ALL', 'STOP_LOSS', { auto: true });
    const j = core.state.journal.find(x => x.id === pos.id), rec = core.state.learn.records.find(x => x.tradeId === pos.id);
    assert(s2.ok && s2.writtenOff && !core.state.positions.length && s2.order.state === 'CANCELLED' && s2.order.failureCode === 'WRITTEN_OFF', 'nicht abgeschrieben');
    assert(j.exitReason === 'NO_SELL_ROUTE' && Math.abs(j.result.pnlUsd + 20) < 1e-6 && pos.lc === 'RECONCILED' && rec && rec.labels && rec.labels.lossFamily === 'SECURITY_RELATED', 'Totalverlust falsch verbucht/gelernt: ' + JSON.stringify(j.result) + ' ' + (rec && rec.labels && rec.labels.lossFamily));
    return `NO_ROUTE → Wert 0 $ · nach ${NO_ROUTE_WRITEOFF_MIN} min abgeschrieben (${fmtSigned(j.result.pnlUsd)}) · Lern-KI: ${rec.labels.lossFamily}`;
  }],
  ['Ehrliche Simulation', 'Monitor: simulierte Fehlschläge sind kein Systemfehler, auffällige Fehlquote wird gemeldet', async () => {
    const H = makeTestHarness(); const core = await testCore(H), st = core.state, now = H.env.now();
    for (let i = 0; i < 4; i++) st.orders.unshift({ id: 'TX' + i, side: 'BUY', symbol: 'X', state: 'FAILED', createdAt: now - i * SEC, failureCode: i < 2 ? 'TX_FAILED' : 'SLIPPAGE_EXCEEDED', history: [] });
    for (let i = 0; i < 6; i++) st.orders.unshift({ id: 'OK' + i, side: 'BUY', symbol: 'X', state: 'COMPLETED', createdAt: now - i * SEC, latencyMs: 1600, expSlipPct: 0.5, quote: { source: 'JUPITER' }, history: [] });
    const r = core._t.monitorTick(H.env.now()), m = core.monitorMetrics();
    assert(!r.active.some(a => a.code === 'EXEC_FAILURES') && r.active.some(a => a.code === 'TX_FAIL_RATE' && a.action === 'DEGRADE') && m.exec.txFailRate === 0.4 && m.exec.jupiterShare === 1, 'Fehlquote falsch: ' + JSON.stringify([r.active.map(a => a.code), m.exec.txFailRate, m.exec.jupiterShare]));
    return 'TX_FAILED / SLIPPAGE_EXCEEDED zählen nicht als EXEC_FAILURES · 40 % Fehlquote → TX_FAIL_RATE (Größe ×0,5 nur im Modus „handeln“)';
  }],
  ['Ehrliche Simulation', 'Coin-Quelle als Lernmerkmal: gespeichert, ausgewertet, „Quelle meiden“ nur als getestete Hypothese', async () => {
    const map = { 'DexScreener Top-Boost': 'TOP_BOOST', 'DexScreener Boost': 'BOOST', 'DexScreener Profile': 'PROFILE', 'GeckoTerminal New': 'NEW_POOL', 'GeckoTerminal Trending': 'TRENDING', Watchlist: 'WATCHLIST', Position: 'POSITION', Test: 'OTHER', '': 'UNKNOWN' };
    assert(Object.entries(map).every(([v, c]) => discCodeOf(v) === c), 'Quellen falsch zugeordnet');
    const H = makeTestHarness(); const core = await testCore(H);
    const m = tMint(1); H.market[m] = H.pair(m); core._t.ensureToken(m, 'DexScreener Boost'); core._t.ensureToken(m, 'GeckoTerminal Trending');
    const { rec, pos } = await learnTrade(H, core, 1, 0.0011);
    const j = core.state.journal.find(x => x.id === pos.id);
    assert(rec && rec.entry.disc === 'BOOST' && rec.entry.discPaid === true && rec.entry.discAll.includes('TRENDING') && j.discovery === 'BOOST', 'Quelle nicht im Lern-Record/Journal: ' + JSON.stringify(rec && rec.entry && [rec.entry.disc, rec.entry.discAll]));
    assert(patternKeysOf(rec).some(k => k.key === 'disc=BOOST'), 'Quelle fehlt in der Musterauswertung');
    const recs = Array.from({ length: 30 }, (_, i) => { const r = mkLearnRec(i, { pnlPct: i % 3 === 0 ? -12 : 6 }); r.entry.disc = i % 3 === 0 ? 'PROFILE' : 'NEW_POOL'; return r; });
    const ds = discoveryStats(recs, [{ disc: 'PROFILE', outcome: 'AVOIDED_LOSS' }, { disc: 'NEW_POOL', outcome: 'NO_DATA' }]), pr = ds.rows.find(x => x.disc === 'PROFILE');
    assert(pr && pr.n === 10 && pr.verdict === 'WORSE' && pr.nmAvoided === 1 && ds.rows.find(x => x.disc === 'NEW_POOL').verdict === 'BETTER', 'Quellen-Auswertung falsch: ' + JSON.stringify(ds.rows));
    const base = learnTestBase(), st = (disc, expPct) => ({ key: 'disc=' + disc, dims: { disc }, entry: true, status: 'HYPOTHESIS', direction: 'WORSE', n: 10, expPct });
    const hy = generateHypotheses([st('PROFILE', -12), st('WATCHLIST', -12)], null, { expPct: 0 }, base, H.env.now());
    assert(hy.length === 1 && hy[0].type === 'BLOCK_DISC' && hy[0].change.rules.blockDisc[0] === 'PROFILE' && hy[0].status === 'IDEA', 'Hypothese „Quelle meiden“ falsch: ' + JSON.stringify(hy.map(h => h.change)));
    const P = mergeParams(base, { rules: { blockDisc: ['PROFILE', 'WATCHLIST'] } });
    assert(P.rules.blockDisc.join() === 'PROFILE' && !passesParams(recs[0], P) && passesParams(recs[1], P) && sanitizeRules({ blockDisc: ['BOOST', '<x>', 'BOOST', 'POSITION'] }).blockDisc.join() === 'BOOST', 'Regel nicht korrekt begrenzt');
    const t2 = await prepToken(core, H, 2); core._t.ensureToken(t2.mint, 'X'); t2.meta.via = ['DexScreener Profile'];
    core.state.models.rules = sanitizeRules({ blockDisc: ['PROFILE'] }); core._t.analyzeAll();
    assert(t2.D.analysisBlockers.some(b => b.code === 'LEARNED_RULE' && /Profil/.test(b.msg)), 'gelernte Quellen-Regel greift nicht');
    return 'Quelle in Features, Journal & Mustern · PROFILE schlechter als Ø → Hypothese BLOCK_DISC (nur automatische Quellen) · Regel greift erst nach Übernahme';
  }],
  ['System', 'Backtest ohne Look-Ahead', async () => {
    const c = []; let p = 1;
    for (let i = 0; i < 300; i++) { const o = p; p = p * (1 + Math.sin(i / 7) * 0.02 + (i % 50 === 25 ? 0.12 : 0)); c.push({ t: i * MIN, o, h: Math.max(o, p) * 1.01, l: Math.min(o, p) * 0.99, c: p, v: 1000 + (i % 50 === 25 ? 9000 : 0) }); }
    const cfg = { strategy: 'volume', capital: 1000, sizePct: 10, feePct: 0.3, slipPct: 0.5, tpPct: 10, slPct: 8, trailActPct: 8, trailPct: 5, timeBars: 30 };
    const full = runBacktest(c, cfg);
    const cut = runBacktest(c.slice(0, 200), cfg);
    const firstTrades = full.trades.filter(t => t.exitT < 190 * MIN);
    assert(firstTrades.every((t, i) => cut.trades[i] && cut.trades[i].entryT === t.entryT && Math.abs(cut.trades[i].pnl - t.pnl) < 1e-9), 'Ergebnisse hängen von zukünftigen Kerzen ab');
    assert(full.trades.every(t => t.entryT > 0), 'Einstieg auf Signalkerze');
    return `${full.trades.length} Trades, identisch bei abgeschnittener Zukunft`;
  }]
];
async function runSelfTests(onProgress) {
  const results = [];
  for (const [group, name, fn] of SELF_TESTS) {
    const t0 = performance.now(); let ok = false, detail = '';
    try { detail = await fn(); ok = true; } catch (e) { detail = e && e.message ? e.message : String(e); }
    results.push({ group, name, ok, detail, ms: Math.round(performance.now() - t0) });
    if (onProgress) onProgress(results);
  }
  return results;
}
