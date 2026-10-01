// E2E: XSS-Schutz – Token-Namen/Symbole aus der API werden nur als Text angezeigt, nie als HTML ausgeführt
const { chromium, APP_URL, USER, PASS } = require('./env.js');
const mock = require('./mock.js');
let failures = 0; const ok = (c, m) => { if (!c) failures++; console.log((c ? 'OK: ' : 'FAIL: ') + m); };
// Payloads ≤ 24 Zeichen (die App kürzt Symbole auf 24 Zeichen)
mock.tokens[0].sym = '<svg onload=alert(1)>';
mock.tokens[1].sym = '<b id=xss>fett</b>';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let dialogs = 0; p.on('dialog', d => { dialogs++; d.dismiss(); });
  await ctx.route('https://**/*', r => { const q = r.request(); const d = mock.route(q.url(), q.method(), q.postData()); r.fulfill(d == null ? { status: 404, body: '' } : { status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(d) }); });
  await p.goto(APP_URL); await p.fill('#loginUser', USER); await p.fill('#loginPass', PASS); await p.click('#loginForm button[type=submit]');
  await p.waitForSelector('#mkList .mrow', { timeout: 20000 }); await p.waitForTimeout(3000);
  const shownInList = await p.evaluate(() => document.querySelector('#mkList').innerText.includes('<svg onload=alert(1)>'));
  const row = p.locator('#mkList .mrow', { hasText: '<svg onload' }).first();
  if (await row.count()) { await row.click(); await p.waitForTimeout(800); }
  for (const v of ['signals', 'markets', 'alerts', 'diagnostics']) { await p.click('#nv-' + v); await p.waitForTimeout(400); }
  const injected = await p.evaluate(() => ({ b: !!document.getElementById('xss'), svg: [...document.querySelectorAll('svg')].some(s => s.hasAttribute('onload')) }));
  ok(dialogs === 0, 'Kein Skript aus Token-Daten ausgeführt (Dialoge: ' + dialogs + ')');
  ok(!injected.b && !injected.svg, 'Kein HTML-Element aus Token-Daten erzeugt');
  ok(shownInList, 'Bösartiges Symbol wird als harmloser Text angezeigt');
  ok(errors.length === 0, 'Keine JS-Fehler (' + errors.length + ')');
  console.log(failures ? failures + ' FEHLGESCHLAGEN' : 'ALLE XSS-TESTS BESTANDEN');
  await b.close(); process.exit(failures ? 1 : 0);
})();
