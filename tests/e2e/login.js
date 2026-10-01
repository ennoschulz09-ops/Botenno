const { chromium, APP_URL, USER, PASS, OUT } = require('./env.js');
const { route } = require('./mock.js');
let failures = 0;
function assert(cond, msg) { if (!cond) { failures++; console.log('FAIL:', msg); } else { console.log('OK:', msg); } }

const settle = async page => { await page.waitForTimeout(50); await page.waitForFunction(() => { const b = document.querySelector('#loginForm button[type=submit]'); return !b || !b.disabled; }, null, { timeout: 15000 }); await page.waitForTimeout(50); };
(async () => {
  const browser = await chromium.launch();
  let apiCalls = 0;
  const consoleMsgs = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', m => consoleMsgs.push(m.text()));
  page.on('pageerror', e => consoleMsgs.push('[pageerror] ' + e.message));
  await ctx.route('https://**/*', async r => {
    apiCalls++;
    const req = r.request();
    const data = route(req.url(), req.method(), req.postData());
    if (data == null) return r.fulfill({ status: 404, body: 'nf' });
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) });
  });

  await page.goto(APP_URL);
  await page.waitForTimeout(500);

  // 1. Login-Gate ist sofort sichtbar, App-Inhalt nicht
  assert(await page.locator('#loginGate').isVisible(), 'Login-Gate initial sichtbar');
  assert(!(await page.locator('#topbar').isVisible()), 'Topbar initial NICHT sichtbar');
  assert(!(await page.locator('#bottomnav').isVisible()), 'Bottomnav initial NICHT sichtbar');
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  assert(focused === 'loginUser', 'Fokus initial auf Anmeldename-Feld (war: ' + focused + ')');
  assert(apiCalls === 0, 'Keine API-Calls vor Login (waren: ' + apiCalls + ')');

  // 2. Falscher Benutzername + richtiges Passwort
  await page.fill('#loginUser', 'Falsch');
  await page.fill('#loginPass', PASS);
  await page.click('#loginForm button[type=submit]');
  await settle(page);
  assert(await page.locator('#loginGate').isVisible(), 'Nach falschem Usernamen weiterhin gesperrt');
  assert(await page.locator('#loginErr').isVisible(), 'Fehlermeldung sichtbar (falscher Username)');
  const errTxt1 = await page.locator('#loginErr').innerText();
  assert(!errTxt1.includes(USER) && !errTxt1.includes(PASS), 'Fehlermeldung verrät keine Zugangsdaten');

  // 3. Richtiger Benutzername + falsches Passwort
  await page.fill('#loginUser', USER);
  await page.fill('#loginPass', 'falschesPasswort');
  await page.click('#loginForm button[type=submit]');
  await settle(page);
  assert(await page.locator('#loginGate').isVisible(), 'Nach falschem Passwort weiterhin gesperrt');

  // 4. Leere Felder
  await page.fill('#loginUser', '');
  await page.fill('#loginPass', '');
  await page.evaluate(() => document.getElementById('loginForm').requestSubmit ? document.getElementById('loginForm').requestSubmit() : document.getElementById('loginForm').dispatchEvent(new Event('submit', { cancelable: true })));
  await page.waitForTimeout(150);
  assert(await page.locator('#loginGate').isVisible(), 'Leere Felder werden abgelehnt');
  assert(apiCalls === 0, 'Weiterhin keine API-Calls vor korrektem Login (waren: ' + apiCalls + ')');

  // 5. Case-Sensitivity / Teiltreffer
  await page.fill('#loginUser', USER === USER.toLowerCase() ? USER.toUpperCase() : USER.toLowerCase());
  await page.fill('#loginPass', PASS);
  await page.click('#loginForm button[type=submit]');
  await settle(page);
  assert(await page.locator('#loginGate').isVisible(), 'Kleingeschriebener Username wird abgelehnt (case-sensitive)');

  // 6. Korrekte Zugangsdaten
  await page.fill('#loginUser', USER);
  await page.fill('#loginPass', PASS);
  await page.click('#loginForm button[type=submit]');
  await settle(page); await page.waitForTimeout(2500);
  assert(!(await page.locator('#loginGate').isVisible()), 'Login-Gate nach korrektem Login verborgen');
  assert(await page.locator('#topbar').isVisible(), 'Topbar nach Login sichtbar');
  const who = await page.locator('#whoami').innerText();
  assert(who.includes(USER) && await page.locator('#whoami').isVisible(), 'Benutzeranzeige „Angemeldet: …“ sichtbar');
  assert(apiCalls > 0, 'Scanner/API startet erst NACH erfolgreichem Login (Calls: ' + apiCalls + ')');
  await page.waitForTimeout(3000);
  const rows = await page.locator('#mkList .mrow').count();
  assert(rows > 0, 'Bestehende App funktioniert nach Login (Markt-Zeilen gerendert: ' + rows + ')');
  await page.screenshot({ path: OUT + '/login-after.png' });

  // 7. Passwort nirgends im Storage
  const lsDump = await page.evaluate(() => JSON.stringify(localStorage));
  assert(!lsDump.includes(PASS), 'Passwort nicht in localStorage');
  const passInputVal = await page.locator('#loginPass').inputValue();
  assert(passInputVal === '', 'Passwortfeld nach Login geleert');

  // 8. Logout
  await page.click('#btnLogout');
  await page.waitForTimeout(200);
  assert(await page.locator('#loginGate').isVisible(), 'Nach Logout wieder gesperrt');
  assert(!(await page.locator('#whoami').isVisible()), 'Benutzeranzeige nach Logout verborgen');

  // Re-Login nach Logout
  await page.fill('#loginUser', USER);
  await page.fill('#loginPass', PASS);
  await page.click('#loginForm button[type=submit]');
  await settle(page); await page.waitForTimeout(1500);
  assert(!(await page.locator('#loginGate').isVisible()), 'Nach Logout erneuter Login funktioniert');
  const rows2 = await page.locator('#mkList .mrow').count();
  assert(rows2 > 0, 'App nach Re-Login weiterhin funktionsfähig (Zeilen: ' + rows2 + ')');

  // 9. Reload -> erneut Login nötig (kein persistenter Session-Status)
  await page.reload();
  await page.waitForTimeout(500);
  assert(await page.locator('#loginGate').isVisible(), 'Nach Reload wieder Login-Pflicht');
  assert(!(await page.locator('#topbar').isVisible()), 'Nach Reload Topbar wieder verborgen');

  // 11. Bruteforce-Schutz: nach 5 Fehlversuchen Wartezeit, auch richtiges Passwort wird dann abgewiesen
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await ctx2.newPage();
  p2.on('console', m => consoleMsgs.push(m.text())); p2.on('pageerror', e => consoleMsgs.push('[pageerror] ' + e.message));
  await ctx2.route('https://**/*', async r => { const req = r.request(); const data = route(req.url(), req.method(), req.postData()); if (data == null) return r.fulfill({ status: 404, body: 'nf' }); r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) }); });
  await p2.goto(APP_URL); await p2.waitForTimeout(300);
  for (let i = 0; i < 5; i++) { await p2.fill('#loginUser', USER); await p2.fill('#loginPass', 'falsch' + i); await p2.click('#loginForm button[type=submit]'); await settle(p2); }
  const lockMsg = await p2.locator('#loginErr').innerText();
  assert(/gesperrt/.test(lockMsg), 'Nach 5 Fehlversuchen: Sperre gemeldet („' + lockMsg + '“)');
  await p2.fill('#loginUser', USER); await p2.fill('#loginPass', PASS); await p2.click('#loginForm button[type=submit]'); await settle(p2);
  assert(await p2.locator('#loginGate').isVisible() && /warten/.test(await p2.locator('#loginErr').innerText()), 'Während der Sperre wird auch das richtige Passwort abgewiesen');
  const guard = await p2.evaluate(() => localStorage.getItem('smartlab.auth.guard'));
  assert(guard && !guard.includes('falsch') && !guard.includes(PASS), 'Sperrzustand gespeichert, ohne Passwortdaten');
  await p2.evaluate(() => { const g = JSON.parse(localStorage.getItem('smartlab.auth.guard')); g.until = Date.now() - 1; localStorage.setItem('smartlab.auth.guard', JSON.stringify(g)); });
  await p2.fill('#loginUser', USER); await p2.fill('#loginPass', PASS); await p2.click('#loginForm button[type=submit]'); await settle(p2); await p2.waitForTimeout(1000);
  assert(!(await p2.locator('#loginGate').isVisible()) && (await p2.evaluate(() => localStorage.getItem('smartlab.auth.guard'))) === null, 'Nach Ablauf der Sperre: Login möglich, Zähler zurückgesetzt');
  await ctx2.close();

  // 10. Passwort nie im Klartext in Console-Ausgaben
  const leaked = consoleMsgs.filter(m => m.includes(PASS));
  assert(leaked.length === 0, 'Passwort erscheint in keiner Console-Ausgabe (Treffer: ' + leaked.length + ')');
  const pageErrors = consoleMsgs.filter(m => m.startsWith('[pageerror]'));
  assert(pageErrors.length === 0, 'Keine JS-Fehler während des gesamten Flows (' + pageErrors.length + ')');
  if (pageErrors.length) pageErrors.forEach(e => console.log('  ', e));

  console.log('\n' + (failures === 0 ? 'ALLE TESTS BESTANDEN' : failures + ' TEST(S) FEHLGESCHLAGEN'));
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})();
