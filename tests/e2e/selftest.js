const { chromium, APP_URL, USER, PASS, OUT } = require('./env.js');
const { route } = require('./mock.js');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('[console.error] ' + m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await ctx.route('https://**/*', async r => {
    const req = r.request();
    const data = route(req.url(), req.method(), req.postData());
    if (data == null) return r.fulfill({ status: 404, body: 'nf' });
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
  });
  await page.goto(APP_URL);
  await page.waitForTimeout(300);
  await page.fill('#loginUser', USER);
  await page.fill('#loginPass', PASS);
  await page.click('#loginForm button[type=submit]');
  await page.waitForTimeout(2000);
  console.log('Eingeloggt, Topbar sichtbar:', await page.locator('#topbar').isVisible());

  await page.click('#nv-system'); await page.waitForTimeout(300);
  await page.click('[data-act="runTests"]');
  await page.waitForFunction(() => /bestanden/.test(document.querySelector('#v-system').innerText) && !/läuft/.test(document.querySelector('[data-act="runTests"]').innerText), null, { timeout: 120000 });
  const tr = await page.evaluate(() => [...document.querySelectorAll('#v-system .check')].map(e => e.innerText.replace(/\n/g, ' ')).filter(x => /^(PASS|FAIL)/.test(x)));
  const pass = tr.filter(x => x.startsWith('PASS'));
  const fail = tr.filter(x => x.startsWith('FAIL'));
  console.log('SELF-TESTS:', pass.length, 'pass,', fail.length, 'fail');
  fail.forEach(x => console.log('  FAIL:', x));
  tr.filter(x => /Lern-KI|Adaptive KI|Monitoring/.test(x)).forEach(x => console.log('  ', x)); const lossTest = tr.find(x => /Loss-Cooldown/.test(x));
  console.log('LOSS-COOLDOWN TEST:', lossTest);

  console.log('CONSOLE/PAGE ERRORS:', errors.length);
  errors.forEach(e => console.log('  ', e));

  await browser.close();
  process.exit(fail.length === 0 && errors.length === 0 ? 0 : 1);
})();
