// E2E: Voll-Backup exportieren und auf einem „zweiten Gerät“ (frischer Browser-Kontext) wiederherstellen
const { chromium, APP_URL, USER, PASS, OUT } = require('./env.js');
const { route } = require('./mock.js');
const fs = require('fs');
let failures = 0; const ok = (c, m) => { if (!c) failures++; console.log((c ? 'OK: ' : 'FAIL: ') + m); };
(async () => {
  const browser = await chromium.launch(); const errors = [];
  async function open() {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true }); const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await ctx.route('https://**/*', async r => { const req = r.request(); const data = route(req.url(), req.method(), req.postData()); if (data == null) return r.fulfill({ status: 404, body: 'nf' }); r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(data) }); });
    await page.goto(APP_URL); return { ctx, page };
  }
  const login = async (page, w = 5000) => { await page.fill('#loginUser', USER); await page.fill('#loginPass', PASS); await page.click('#loginForm button[type=submit]'); await page.waitForTimeout(w); };
  // Gerät A: Trade eröffnen, Einstellung ändern, Backup exportieren
  const A = await open(); await login(A.page);
  await A.page.locator('#mkList .mrow', { hasText: 'MOCK12' }).first().click(); await A.page.waitForTimeout(1200);
  await A.page.click('#detail [data-act="buy"]'); await A.page.waitForTimeout(500); await A.page.click('#mb-ok'); await A.page.waitForTimeout(2500); await A.page.keyboard.press('Escape');
  await A.page.click('#nv-settings'); await A.page.waitForTimeout(400);
  await A.page.locator('#v-settings details', { hasText: 'Export / Import / Reset' }).locator('summary').click(); await A.page.waitForTimeout(200);
  const [dl] = await Promise.all([A.page.waitForEvent('download'), A.page.click('#v-settings [data-act="export"][data-kind="backup-json"]')]);
  const file = await dl.path(); const bk = JSON.parse(fs.readFileSync(file, 'utf8'));
  ok(bk.kind === 'backup' && bk.storage.positions.positions.length === 1 && Object.keys(bk.storage).length === 10, 'Backup enthält alle 10 Bereiche und die offene Position');
  ok(!fs.readFileSync(file, 'utf8').includes(PASS), 'Backup enthält kein Passwort');
  fs.copyFileSync(file, OUT + '/backup-test.json');
  // defekte Datei wird abgelehnt
  fs.writeFileSync(OUT + '/backup-bad.json', JSON.stringify({ ...bk, app: '99.0.0' }));
  const [fc0] = await Promise.all([A.page.waitForEvent('filechooser'), A.page.click('#v-settings [data-act="restoreBackup"]')]);
  await fc0.setFiles(OUT + '/backup-bad.json'); await A.page.waitForTimeout(700);
  ok(/neueren Version/.test(await A.page.locator('#toasts').innerText().catch(() => '')), 'Sicherung aus neuerer Version wird abgelehnt');
  await A.ctx.close();
  // Gerät B: leer starten, Backup wiederherstellen
  const B = await open(); await login(B.page, 3000);
  await B.page.click('#nv-positions'); await B.page.waitForTimeout(500);
  ok(/Keine offenen Positionen/.test(await B.page.locator('#v-positions').innerText()), 'Gerät B startet ohne Positionen');
  await B.page.click('#nv-settings'); await B.page.waitForTimeout(400);
  await B.page.locator('#v-settings details', { hasText: 'Export / Import / Reset' }).locator('summary').click(); await B.page.waitForTimeout(200);
  const [fc] = await Promise.all([B.page.waitForEvent('filechooser'), B.page.click('#v-settings [data-act="restoreBackup"]')]);
  await fc.setFiles(OUT + '/backup-test.json'); await B.page.waitForTimeout(700);
  const [dlSafety] = await Promise.all([B.page.waitForEvent('download'), B.page.click('#mb-ok')]);
  ok(/smartlab-backup-/.test(dlSafety.suggestedFilename()), 'Vor dem Überschreiben wird der aktuelle Stand gesichert');
  await B.page.waitForTimeout(2500);
  ok(await B.page.locator('#loginGate').isVisible(), 'Nach Wiederherstellen: Seite neu geladen, Login verlangt');
  await login(B.page, 3000);
  await B.page.click('#nv-positions'); await B.page.waitForTimeout(600);
  const pos = await B.page.locator('#v-positions').innerText();
  ok(/MOCK12/.test(pos), 'Position von Gerät A ist auf Gerät B vorhanden');
  await B.page.click('#nv-settings'); await B.page.waitForTimeout(400); await B.page.locator('#v-settings details', { hasText: 'Config Change Log' }).locator('summary').click();
  ok(/RESTORE/.test(await B.page.locator('#v-settings').innerText()), 'Wiederherstellen im Audit Trail protokolliert');
  await B.ctx.close();
  ok(errors.length === 0, 'Keine Konsolen-/JS-Fehler (' + errors.length + ')'); errors.slice(0, 5).forEach(e => console.log('   ', e));
  console.log(failures ? `\n${failures} FEHLER` : '\nALLE BACKUP-TESTS BESTANDEN');
  await browser.close(); process.exit(failures ? 1 : 0);
})();
