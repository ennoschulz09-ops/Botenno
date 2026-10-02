// E2E: Lern-KI (Migration aus Journal, Ansicht einfach/Analyse, echter Trade → Record, Export, Logs, Reload, Mobil)
const { chromium, APP_URL, USER, PASS, OUT, seedDeterministic } = require('./env.js');
const { route } = require('./mock.js');
const fs = require('fs');
let failures = 0;
const ok = (c, m) => { if (!c) failures++; console.log((c ? 'OK: ' : 'FAIL: ') + m); };
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function mint(i) { let s = 'Lg'; let x = i * 6007 + 17; while (s.length < 44) { s += B58[x % 58]; x = Math.floor(x / 3) + s.length * 29; } return s; }

function seedJournal(mints) {
  const now = Date.now(), journal = [];
  for (let i = 0; i < 30; i++) {
    const opened = now - (40 - i) * 3600e3, closed = opened + 20 * 60e3, win = i % 3 === 0, pct = win ? 12 : -8 - (i % 4), size = 40;
    const price = 0.0001 * (1 + i / 10);
    journal.unshift({
      id: 'T-LEG' + i, tokenId: 'solana:' + mints[i], symbol: 'LEG' + i, name: 'Legacy ' + i, mint: mints[i], pair: mints[i], dexId: 'raydium', mode: 'SIMULATION', status: 'CLOSED',
      openedAt: opened, closedAt: closed, entries: [{ orderId: 'o' + i, ts: opened, price: price * 1.002, refPrice: price, qty: size / price, usd: size, fees: 0.12, impactPct: 0.2, latencyMs: 400 }],
      exits: [{ orderId: 'x' + i, ts: closed, price: price * (1 + pct / 100) * 0.998, refPrice: price * (1 + pct / 100), qty: size / price, usd: size * (1 + pct / 100), fees: 0.12, impactPct: 0.2, reason: win ? 'TP1' : 'STOP_LOSS' }],
      sizeUsd: size, feesUsd: 0.24, slippageUsd: 0.1, score: i % 2 ? 66 : 78, opportunity: 60, confidence: 72, risk: { total: 35, level: 'MODERATE' },
      signals: [{ type: 'MOMENTUM', strength: i % 2 ? 75 : 60, reason: 'x' }], strategy: i % 2 ? 'momentum' : 'breakout', auto: true, reason: 'Legacy', sources: ['DexScreener'], tags: [], regime: i % 2 ? ['CHOPPY'] : ['TRENDING'],
      decision: { ts: opened - 1500, snapshot: { priceUsd: price, marketCap: 400000, liquidityUsd: 60000, chg: { m5: 4, h1: 12, h24: 30 }, vol: { m5: 5000, h1: 40000 }, txns: { h1: { b: 500, s: 350 } }, pairCreatedAt: opened - 5 * 3600e3 }, security: { status: 'VERIFIED' } },
      paramVersion: 1, result: { pnlUsd: +(size * pct / 100 - 0.24).toFixed(4), pnlPct: pct, win }, exitReason: win ? 'TP1' : 'STOP_LOSS', mae2m: win ? -1 : i % 2 ? -7 : -2, holdMs: 20 * 60e3
    });
  }
  localStorage.setItem('smartlab.v3.trades', JSON.stringify({ v: 3, tradeSeq: 60, journal }));
  localStorage.setItem('smartlab.v3.positions', JSON.stringify({ v: 3, tradeSeq: 60, portfolio: { startCapital: 1000, cash: 1000, realized: 0, fees: 0, peakEquity: 1000, maxDD: 0 }, positions: [], orders: [], usedKeys: [] }));
  localStorage.setItem('smartlab.v3.runtime', JSON.stringify({ v: 3, tradeSeq: 60, savedAt: now, app: '2.1.1', mode: 'SIMULATION', bot: { desired: 'RUNNING', autoTrading: false, safeMode: false, emergency: false, emergencyReason: '' }, risk: { buyCount: {}, coinCooldown: {}, stratCooldown: {}, lossCooldownUntil: 0, globalPauseUntil: 0, lossStreak: 0, dayKey: '', dailyPnl: 0, dailyStartEquity: null, dailyTrades: 0, dailyLimitHit: false, reviewRequired: false, buyTimes: [] }, session: {}, seen: {}, alertMarks: {}, reconciliation: { required: false, issues: [], at: now } }));
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mints = Array.from({ length: 30 }, (_, i) => mint(i));
  async function open(viewport, ctx0) {
    const ctx = ctx0 || await browser.newContext({ viewport, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
    page.on('dialog', d => d.accept());
    if (!ctx0) await ctx.route('https://**/*', async r => {
      const req = r.request(); const data = route(req.url(), req.method(), req.postData());
      if (data == null) return r.fulfill({ status: 404, body: 'nf' });
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
    });
    await page.goto(APP_URL); await seedDeterministic(page);
    return { ctx, page };
  }
  const login = async (page, wait = 6000) => { await page.fill('#loginUser', USER); await page.fill('#loginPass', PASS); await page.click('#loginForm button[type=submit]'); await page.waitForTimeout(wait); };
  const vis = (page, sel) => page.evaluate(s => [...document.querySelectorAll(s)].filter(e => e.offsetParent !== null).length, sel);
  const goLearn = async page => { await page.click('#nv-learning'); await page.waitForTimeout(700); };

  // ---------- Migration aus bestehendem Journal ----------
  const { ctx, page } = await open({ width: 1500, height: 950 });
  await page.evaluate(seedJournal, mints);
  await login(page);
  await goLearn(page);
  let txt = await page.locator('#v-learning').innerText();
  ok(/Ausgewertete Trades\s*30 \(30 legacy\)/i.test(txt), 'Migration: 30 Journal-Trades als legacy Learning Records übernommen');
  ok(/MIGRATION/i.test(txt) && /30 Trades aus dem Journal/.test(txt), 'Timeline enthält Migrations-Eintrag');
  ok(/Verlust-Observatorium/i.test(txt) && /(Fehlsignal|Zufall|Unbekannt|Exit|Datenqualität|Ausführung|Regime)/.test(txt), 'Verlust-Observatorium zeigt Ursachen');
  ok((await vis(page, '#v-learning .an')) === 0, 'Einfache Ansicht: Analyse-Abschnitte (Experimente, Drift, …) ausgeblendet');
  ok(/Datenbasis/i.test(txt) && /30 \/ 24/.test(txt), 'Datenbasis-Fortschritt sichtbar (Experiment 30/24)');
  ok(/Fehlerklassen/i.test(txt) && /(Normaler statistischer Verlust|Execution-Fehler|Modell-|Datenfehler|Unklar)/.test(txt) && /Erwartbar\?/i.test(txt), 'Fehlerklassen + Spalte „Erwartbar?“ sichtbar (einfache Ansicht)');
  ok(/Knapp verpasst \(Near-Misses\)/i.test(txt) && /In Beobachtung/i.test(txt) && /nie automatisch gelockert/.test(txt), 'Near-Miss-Panel mit Transparenzhinweis sichtbar');
  ok(/Coin-Quellen – woher kommen/i.test(txt) && /unbekannt/i.test(txt) && /Quelle meiden/.test(txt), 'Coin-Quellen-Panel sichtbar (ältere Trades als „unbekannt“)');
  ok(/Aktive Parameter – Wert, Herkunft, Grund/i.test(txt) && (await page.evaluate(() => { const t = [...document.querySelectorAll('#v-learning table')].find(x => /Herkunft/.test(x.querySelector('thead') ? x.querySelector('thead').textContent : '')); return t ? t.querySelectorAll('tbody tr').length : 0; })) >= 15, 'Tabelle „Aktive Parameter“ mit ≥ 15 Zeilen');
  ok(/Standardwert/.test(txt), 'Herkunft „Standardwert“ angezeigt');
  await page.screenshot({ path: OUT + '/l-learning-simple.png', fullPage: true });

  // Lernlauf manuell
  await page.click('#v-learning [data-act="learnRun"]'); await page.waitForTimeout(800);
  txt = await page.locator('#v-learning').innerText();
  ok(/Letzter Lernlauf\s*\d/i.test(txt), 'Lernlauf ausgeführt (Zeitstempel gesetzt)');

  // Analyse-Ansicht
  await page.click('#nv-settings'); await page.waitForTimeout(300); await page.click('#v-settings [data-act="pro"]'); await page.waitForTimeout(300);
  await goLearn(page);
  txt = await page.locator('#v-learning').innerText();
  ok(/Pattern Miner/i.test(txt) && /Modell-Register/i.test(txt) && /Drift-Erkennung/i.test(txt) && /Kalibrierung/i.test(txt), 'Analyse-Ansicht: Pattern Miner, Modell-Register, Drift, Kalibrierung sichtbar');
  ok(/Muster-Karte/i.test(txt) && /momentum/.test(txt) && /CHOPPY|TRENDING/.test(txt), 'Muster-Karte Strategie × Regime');
  ok(/M-1/.test(txt) && /BASELINE/.test(txt), 'Baseline-Modell M-1 im Register');
  ok(/Experimente/.test(txt), 'Experimente-Bereich vorhanden');
  ok(/Grund \/ Änderung/.test(txt) && /lernbar, nur verschärfend/.test(txt) && /0–1440/.test(txt) && !/harte Grenze/.test(txt), 'Analyse-Ansicht: Grund & Grenzen der aktiven Parameter');
  const hyps = await page.evaluate(() => document.querySelectorAll('#v-learning details').length);
  console.log('  Aufklappbare Details (Verluste/Experimente):', hyps);
  await page.screenshot({ path: OUT + '/l-learning-pro.png', fullPage: true });
  // Details bleiben beim Aktualisieren offen
  const det = page.locator('#v-learning details[data-k]').first();
  if (await det.count()) { await det.locator('summary').click(); await page.waitForTimeout(2500); ok(await det.evaluate(d => d.open), 'Aufgeklappte Details bleiben bei Live-Aktualisierung offen'); }

  // Export CSV
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#v-learning [data-act="export"][data-kind="learning-report-csv"]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8').trim().split('\n');
  ok(/lossFamily/.test(csv[0]) && /errorClass,lossVerdict/.test(csv[0]) && csv.length === 31, `Lern-Report CSV: Kopf + ${csv.length - 1} Zeilen`);
  ok(/,discovery,learnable,qualityFlags,execModel,exitSource$/.test(csv[0]) && csv.slice(1).every(l => /,(ja|nein),[^,]*,[12]?,[A-Z_]*$/.test(l)), 'Lern-Report CSV: Datenqualität am Ende (learnable ja/nein, Kennzeichen, execModel, exitSource)');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#v-learning [data-act="export"][data-kind="model-registry-json"]')]);
  const reg = JSON.parse(fs.readFileSync(await dl2.path(), 'utf8'));
  ok(reg.models && reg.models.champion && reg.bounds && reg.bounds.minScore, 'Modell-Register JSON exportiert');

  // Echter (simulierter) Trade → neuer, nicht-legacy Record
  await page.click('#nv-scanner'); await page.waitForTimeout(500);
  await page.locator('#mkList .mrow', { hasText: 'MOCK12' }).first().click(); await page.waitForTimeout(1200);
  await page.click('#detail [data-act="buy"]'); await page.waitForTimeout(500); await page.click('#mb-ok'); await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.click('#nv-positions'); await page.waitForTimeout(700);
  if (!(await page.locator('#v-positions [data-act="sell"][data-frac="ALL"]').first().isVisible({ timeout: 8000 }).catch(() => false))) {
    try { // Diagnose: warum ist keine Position entstanden?
      await page.click('#nv-orders', { timeout: 3000 }); await page.waitForTimeout(500);
      console.log('  Orders nach dem Kauf:', (await page.locator('#v-orders').innerText()).split('\n').slice(0, 8).join(' | '));
      await page.click('#nv-positions'); await page.waitForTimeout(500);
    } catch (e) { console.log('  Diagnose nicht möglich:', e.message.split('\n')[0]); }
  }
  await page.locator('#v-positions [data-act="sell"][data-frac="ALL"]').first().click(); await page.waitForTimeout(500);
  await page.click('#mb-ok'); await page.waitForTimeout(2500); await page.keyboard.press('Escape');
  await goLearn(page);
  txt = await page.locator('#v-learning').innerText();
  ok(/Ausgewertete Trades\s*31 \(30 legacy\)/i.test(txt), 'Neuer Trade wurde als Learning Record erfasst (31, davon 30 legacy)');
  ok(/MOCK12/.test(txt) && /läuft/.test(txt), 'Neuer Record mit laufendem 15-min-Nachlauf');

  // Logs-Filter
  await page.click('#nv-logs'); await page.waitForTimeout(400);
  await page.click('#logCats [data-k="LEARNING"]'); await page.waitForTimeout(500);
  const logs = await page.locator('#logList').innerText();
  ok(/Migration: 30/.test(logs) && /MOCK12/.test(logs), 'Log-Kategorie „Learning“ zeigt Migration und neuen Trade');
  await page.click('#logCats [data-k="TRADE"]'); await page.waitForTimeout(400);
  const tlogs = await page.locator('#logList').innerText();
  ok(/BUY #1 MOCK12.*Jupiter/.test(tlogs) && /SELL MOCK12/.test(tlogs), 'Kauf und Verkauf zum (nachgebildeten) Jupiter-Angebot, nach Wartezeit');

  // Persistenz über Reload
  await page.reload(); await login(page, 3000); await goLearn(page);
  txt = await page.locator('#v-learning').innerText();
  ok(/Ausgewertete Trades\s*31 \(30 legacy\)/i.test(txt), 'Lerndaten bleiben nach Reload erhalten');
  const keys = await page.evaluate(() => ['learning', 'experiments', 'models', 'patterns'].map(k => [k, (localStorage.getItem('smartlab.v3.' + k) || '').length]));
  console.log('  Speichergrößen (Zeichen):', keys.map(([k, n]) => k + '=' + n).join(', '));
  ok(keys.every(([, n]) => n > 10), 'Alle vier Lern-Speicherbereiche geschrieben');
  await ctx.close();

  // ---------- Mobil ----------
  for (const pro of [false, true]) {
    const m = await open({ width: 390, height: 844 });
    await m.page.evaluate(seedJournal, mints);
    await login(m.page, 4000);
    if (pro) { await m.page.click('#bn-more'); await m.page.waitForTimeout(300); await m.page.click('#modal [data-act="pro"]'); await m.page.waitForTimeout(300); await m.page.keyboard.press('Escape'); await m.page.waitForTimeout(300); }
    await m.page.evaluate(() => { const b = document.querySelector('[data-view="learning"]'); if (b) b.click(); }); await m.page.waitForTimeout(800);
    const w = await m.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, shown: !document.getElementById('v-learning').classList.contains('hidden') }));
    ok(w.shown && w.sw <= w.cw + 1, `Mobil ${pro ? 'Analyse' : 'einfach'}: Learning-Ansicht ohne horizontalen Überlauf (${w.sw}/${w.cw})`);
    await m.page.screenshot({ path: OUT + `/m-learning-${pro ? 'pro' : 'simple'}.png`, fullPage: true });
    await m.ctx.close();
  }

  ok(errors.length === 0, 'Keine Konsolen-/JS-Fehler (' + errors.length + ')'); errors.slice(0, 5).forEach(e => console.log('   ', e));
  console.log(failures ? `\n${failures} FEHLER` : '\nALLE LERN-E2E-TESTS BESTANDEN');
  await browser.close(); process.exit(failures ? 1 : 0);
})();
