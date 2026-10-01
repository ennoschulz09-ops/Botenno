// Performance-Messung: viele Tokens, Scan-/Analyse-/Render-Zeit aus der System-Ansicht
const { chromium, APP_URL, USER, PASS, OUT } = require('./env.js');
const { route } = require('./mockbig.js');
(async () => {
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await ctx.route('https://**/*', async r => { const req = r.request(); const data = route(req.url(), req.method(), req.postData()); if (data == null) return r.fulfill({ status: 404, body: 'nf' }); r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) }); });
  await page.goto(APP_URL);
  const maxTok = +(process.env.MAXTOK || 400);
  await page.evaluate(n => localStorage.setItem('smartlab.v3.settings', JSON.stringify({ v: 3, settings: { maxTokens: n, chunksPerTick: 6 }, strategies: {}, watchlist: {}, ui: {} })), maxTok);
  await page.fill('#loginUser', USER); await page.fill('#loginPass', PASS); await page.click('#loginForm button[type=submit]');
  const samples = [];
  for (let i = 0; i < +(process.env.ROUNDS || 6); i++) {
    await page.waitForTimeout(10000);
    await page.click('#nv-system'); await page.waitForTimeout(900);
    const txt = await page.locator('#v-system').innerText();
    const g = re => { const m = txt.match(re); return m ? m[1] : '—'; };
    samples.push({ t: (i + 1) * 10, tokens: g(/Tokens gescannt\s*(\d+)/i), scan: g(/\nScan\s*(\d+) ms/i), analyse: g(/Analyse\s*(\d+) ms/i), render: g(/Render\s*(\d+) ms/i), scansPerSec: g(/Scans\/s\s*([\d.]+)/i) });
    await page.click('#nv-scanner'); await page.waitForTimeout(300);
  }
  const heap = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  const ls = await page.evaluate(() => { let n = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += (localStorage.getItem(k) || '').length; } return n; });
  console.table(samples); console.log('JS-Heap MB:', heap, '· localStorage Zeichen:', ls, '· Fehler:', errors.length); errors.slice(0, 3).forEach(e => console.log('  ', e));
  await browser.close();
})();
