const { chromium, APP_URL, USER, PASS, OUT } = require('./env.js');
const { route } = require('./mock.js');
let failures = 0;
const ok = (c, m) => { if (!c) failures++; console.log((c ? 'OK: ' : 'FAIL: ') + m); };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function open(viewport) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
    page.on('dialog', d => d.accept());
    await ctx.route('https://**/*', async r => {
      const req = r.request(); const data = route(req.url(), req.method(), req.postData());
      if (data == null) return r.fulfill({ status: 404, body: 'nf' });
      r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
    });
    await page.goto(APP_URL);
    await page.fill('#loginUser', USER); await page.fill('#loginPass', PASS);
    await page.click('#loginForm button[type=submit]');
    await page.waitForTimeout(7000);
    return { ctx, page };
  }
  const visibleCount = (page, sel) => page.evaluate(s => [...document.querySelectorAll(s)].filter(e => e.offsetParent !== null).length, sel);

  // ---------- Desktop, einfache Ansicht ----------
  const { page } = await open({ width: 1600, height: 950 });
  ok(!(await page.evaluate(() => document.body.classList.contains('pro'))), 'Standard = einfache Ansicht');
  const head = await page.evaluate(() => [...document.querySelectorAll('#mkHead > *')].filter(e => e.offsetParent !== null).map(e => e.textContent.trim()));
  console.log('  Scanner-Spalten (einfach):', head.join(' | '));
  ok(head.includes('Coin-Preis') && head.some(h => h.startsWith('MC')) && !head.some(h => /Liq|Vol|K\/V|Mom|Conf|Trend/.test(h)), 'Scanner zeigt nur Coin-Preis, MC, 5m, 1h, Risk, Score, Status');
  const pills = await page.evaluate(() => [...document.querySelectorAll('#tbPills .pill')].filter(e => e.offsetParent !== null).map(e => e.textContent.trim()));
  console.log('  Kopfzeile (einfach):', pills.join(' | '));
  ok(!pills.some(p => /^(RPC|Health|Wallet)/.test(p)), 'Kopfzeile ohne Technik-Werte');
  const mcCells = await page.evaluate(() => [...document.querySelectorAll('#mkList .mrow > .mcv')].map(e => e.textContent.trim()));
  ok(mcCells.length > 0 && mcCells.every(x => /^\d+(\.\d)?[kMBT]? MC$/.test(x) || x === '—'), 'Alle MC-Zellen im Format „38k MC“ (' + mcCells.slice(0, 4).join(', ') + ')');
  const hot = await page.locator('#hot .hc').first().innerText();
  ok(/Coin-Preis \$/.test(hot) && / MC\b/.test(hot), 'Top-Kandidaten-Karte: Coin-Preis und MC gekennzeichnet');
  await page.screenshot({ path: OUT + '/d-scanner-simple.png' });

  // Detail
  await page.locator('#mkList .mrow', { hasText: 'MOCK12' }).first().click(); await page.waitForTimeout(1500);
  const dh = await page.locator('#dHead').innerText();
  ok(/Coin-Preis/.test(dh) && / MC/.test(dh), 'Detail-Kopf: Coin-Preis + MC');
  ok(!(await page.locator('#detail [data-k="why"]').isVisible()), 'Warum?-Tab in einfacher Ansicht ausgeblendet');
  ok(/Warum (Kandidat|kein Trade)\?/.test(await page.locator('#dBody').innerText()), 'Einfache Ansicht: Kurzbegründung „Warum …?“ im Detail');
  ok((await visibleCount(page, '#dBody .meter')) === 0, 'Keine Score-/Risk-Meter in einfacher Ansicht');
  await page.screenshot({ path: OUT + '/d-detail-simple.png' });
  await page.click('#detail [data-act="dtab"][data-k="risk"]'); await page.waitForTimeout(600);
  const riskTxt = await page.locator('#dBody').innerText();
  ok(/Security-Prüfbericht/i.test(riskTxt) && /Mint Authority/.test(riskTxt) && /(OK|KEINE DATEN|FEHLER)/.test(riskTxt), 'Risiko-Tab: Security-Prüfbericht mit Ergebnissen sichtbar');
  await page.screenshot({ path: OUT + '/d-risk-simple.png' });
  await page.click('#detail [data-act="dtab"][data-k="plan"]'); await page.waitForTimeout(600);
  const plan = await page.locator('#dBody').innerText();
  ok(/TP1[\s\S]*Preis \$[\s\S]* MC/.test(plan), 'Trade Plan: TPs mit Preis und MC');
  await page.screenshot({ path: OUT + '/d-plan-simple.png' });

  // Kauf -> Positionen
  await page.click('#detail [data-act="buy"]'); await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + '/d-buy-simple.png' });
  await page.click('#mb-ok'); await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.click('#nv-positions'); await page.waitForTimeout(800);
  const posTxt = await page.locator('#v-positions').innerText();
  ok(/Einstieg[\s\S]*Preis \$[\s\S]*MC/i.test(posTxt) && /TP1/i.test(posTxt) && /Stop/i.test(posTxt), 'Positionskarte: Einstieg/Stop/TP mit Preis und MC');
  ok(!/Exit-Impact/.test(posTxt), 'Positionskarte ohne Analyse-Werte (Exit-Impact)');
  await page.screenshot({ path: OUT + '/d-positions-simple.png', fullPage: true });

  // Signale
  await page.click('#nv-signals'); await page.waitForTimeout(600);
  ok((await visibleCount(page, '#v-signals .chain')) === 0 && (await visibleCount(page, '#v-signals .blk')) === 0, 'Signale ohne Entscheidungsketten/Blocker-Codes');
  await page.screenshot({ path: OUT + '/d-signals-simple.png', fullPage: true });

  // ---------- Analyse-Daten AN ----------
  await page.click('#nv-settings'); await page.waitForTimeout(400);
  await page.click('#v-settings [data-act="pro"]'); await page.waitForTimeout(600);
  ok(await page.evaluate(() => document.body.classList.contains('pro')), 'Schalter aktiviert Analyse-Ansicht');
  await page.click('#nv-signals'); await page.waitForTimeout(600);
  ok((await visibleCount(page, '#v-signals .chain')) > 0, 'Analyse-Ansicht zeigt Entscheidungsketten wieder');
  await page.screenshot({ path: OUT + '/d-signals-pro.png', fullPage: true });
  await page.click('#nv-scanner'); await page.waitForTimeout(600);
  await page.locator('#mkList .mrow', { hasText: 'MOCK22' }).first().click(); await page.waitForTimeout(1200);
  await page.click('#detail [data-act="dtab"][data-k="overview"]'); await page.waitForTimeout(600);
  const ovPro = await page.locator('#dBody').innerText();
  ok(/Stufen-Bewertung/i.test(ovPro) && /Handelsbereitschaft/.test(ovPro) && /Discovery/.test(ovPro), 'Analyse-Ansicht: Stufen-Bewertung im Detail sichtbar');
  await page.screenshot({ path: OUT + '/d-stages-pro.png' });
  await page.click('#detail [data-act="dtab"][data-k="why"]'); await page.waitForTimeout(600);
  const whyPro = await page.locator('#dBody').innerText();
  ok(/Score-Aufschlüsselung/i.test(whyPro) && /Zeitfenster-Abgleich/i.test(whyPro) && /Signal-Konflikte/i.test(whyPro) && /(kippen|ändern müsste)/i.test(whyPro), 'Warum?-Tab: Aufschlüsselung, Kipp-Punkte, Zeitfenster, Konflikte');
  await page.screenshot({ path: OUT + '/d-why-pro.png', fullPage: false });
  await page.keyboard.press('Escape');
  await page.click('#nv-scanner'); await page.waitForTimeout(600);
  const headPro = await page.evaluate(() => [...document.querySelectorAll('#mkHead > *')].filter(e => e.offsetParent !== null).map(e => e.textContent.trim()));
  console.log('  Scanner-Spalten (Analyse):', headPro.join(' | '));
  ok(headPro.some(h => h.startsWith('Liq')) && headPro.some(h => h.startsWith('Conf')), 'Analyse-Ansicht zeigt alle Spalten');
  await page.screenshot({ path: OUT + '/d-scanner-pro.png' });

  // Persistenz des Schalters über Reload
  await page.reload(); await page.fill('#loginUser', USER); await page.fill('#loginPass', PASS); await page.click('#loginForm button[type=submit]'); await page.waitForTimeout(3000);
  ok(await page.evaluate(() => document.body.classList.contains('pro')), 'Analyse-Schalter bleibt nach Reload erhalten');
  await page.click('#nv-settings'); await page.waitForTimeout(300); await page.click('#v-settings [data-act="pro"]'); await page.waitForTimeout(400);

  // ---------- Frischer Start ----------
  await page.click('#nv-positions'); await page.waitForTimeout(600);
  const before = await page.evaluate(() => ({ pos: document.querySelectorAll('#v-positions .card').length }));
  await page.click('#v-positions [data-act="freshStart"]'); await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/d-freshstart-confirm.png' });
  await page.click('#mb-ok'); await page.waitForTimeout(1000);
  const afterTxt = await page.locator('#v-positions').innerText();
  ok(before.pos >= 1 && /Keine offenen Positionen/.test(afterTxt), `Frischer Start leert Positionen (${before.pos} → 0)`);
  ok(/Cash\s*\$1000\.00/.test(afterTxt) || /\$1000\.00/.test(afterTxt), 'Cash wieder auf Startkapital');
  await page.click('#nv-history'); await page.waitForTimeout(600);
  const hist = await page.locator('#v-history').innerText();
  ok(/Frischer Start/.test(hist), 'History behält den Trade (markiert als „Frischer Start“)');
  await page.screenshot({ path: OUT + '/d-history-after-fresh.png' });

  // ---------- Mobil ----------
  for (const pro of [false, true]) {
    const m = await open({ width: 390, height: 844 });
    if (pro) { await m.page.evaluate(() => document.querySelector('[data-act="pro"]') ); await m.page.click('#bn-more'); await m.page.waitForTimeout(300); await m.page.click('#modal [data-act="pro"]'); await m.page.waitForTimeout(300); await m.page.keyboard.press('Escape'); await m.page.waitForTimeout(300); }
    const views = ['scanner', 'signals', 'positions', 'watchlist', 'orders', 'history', 'markets', 'alerts', 'learning', 'analytics', 'risk', 'settings'];
    for (const v of views) {
      await m.page.evaluate(v => { const b = document.querySelector(`[data-view="${v}"]`); if (b) b.click(); }, v);
      await m.page.waitForTimeout(500);
      const w = await m.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      if (w.sw > w.cw + 1) { failures++; console.log(`FAIL: Mobil ${pro ? 'Analyse' : 'einfach'} ${v}: horizontaler Überlauf ${w.sw} > ${w.cw}`); }
    }
    await m.page.evaluate(() => document.querySelector('[data-view="scanner"]').click()); await m.page.waitForTimeout(500);
    await m.page.screenshot({ path: OUT + `/m-scanner-${pro ? 'pro' : 'simple'}.png` });
    await m.page.evaluate(() => document.getElementById('mkList').scrollIntoView()); await m.page.waitForTimeout(300);
    await m.page.screenshot({ path: OUT + `/m-list-${pro ? 'pro' : 'simple'}.png` });
    console.log(`OK: Mobil ${pro ? 'Analyse' : 'einfach'}: ${views.length} Ansichten geprüft`);
    await m.ctx.close();
  }

  ok(errors.length === 0, 'Keine Konsolen-/JS-Fehler (' + errors.length + ')'); errors.slice(0, 5).forEach(e => console.log('   ', e));
  console.log(failures ? `\n${failures} FEHLER` : '\nALLE UI-TESTS BESTANDEN');
  await browser.close(); process.exit(failures ? 1 : 0);
})();
