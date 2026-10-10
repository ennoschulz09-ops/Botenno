// E2E: PC-Bot (server/bot.js) als eigener Prozess mit Testdaten (--mock, kein Internet) – Oberfläche im Browser,
// Einstellungen importieren, Voll-Backup herunterladen und wieder einspielen, Schutz der lokalen API,
// Sperre gegen einen zweiten Bot auf demselben Datenordner und sauberes Beenden mit Speichern + Neustart.
// Datensammler: offene Kandidaten werden beim Wiederherstellen (RELOAD) und Beenden (SHUTDOWN) als JSONL-Zeilen in
// data/candidates/cand-<UTC-Tag>.jsonl angehängt (nie gekürzt), Download über /api/candidates, Log-Bereinigung lässt sie in Ruhe.
// Der Datenordner liegt in tests/e2e/out/pc-<pid> und wird am Ende immer gelöscht; laufende Bots werden immer beendet.
const { chromium, OUT } = require('./env.js');
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const BOT = path.join(ROOT, 'server/bot.js');
const DATA = path.join(OUT, 'pc-' + process.pid);
const APP_VERSION = (fs.readFileSync(path.join(ROOT, 'js/base.js'), 'utf8').match(/const APP_VERSION = '([\d.]+)'/) || [])[1];
const FEATURE_VERSION = Number((fs.readFileSync(path.join(ROOT, 'js/learning.js'), 'utf8').match(/const FEATURE_VERSION = (\d+);/) || [])[1]);
const AREAS = ['settings', 'runtime', 'positions', 'trades', 'logs', 'stats', 'learning', 'experiments', 'models', 'patterns']; // wie STORAGE_KEYS in js/base.js
let failures = 0;
const ok = (c, m) => { if (!c) failures++; console.log((c ? 'OK: ' : 'FAIL: ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Hilfen: freier Port, HTTP ohne fetch (fetch kann den Host-Header nicht setzen), Warten mit Zeitlimit ---------- */
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
function req(port, { method = 'GET', path: p = '/', headers = {}, body = null, host = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...(host ? { Host: host } : {}), ...headers }, timeout: 10000 }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('timeout', () => r.destroy(new Error('Zeitüberschreitung')));
    r.on('error', reject);
    if (body != null) r.write(body);
    r.end();
  });
}
const status = async port => { const r = await req(port, { path: '/api/status' }); if (r.status !== 200) throw new Error('Status ' + r.status); return JSON.parse(r.text); };
async function waitFor(fn, ms = 10000, every = 200) {
  const until = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* noch nicht bereit */ }
    if (Date.now() > until) return null;
    await sleep(every);
  }
}

/* ---------- Datensammler: Tagesdateien lesen und jede Zeile gegen das Schema prüfen ---------- */
const CAND_DIR = path.join(DATA, 'candidates');
const OLD_DAY = '2000-01-01', OLD_CAND = path.join(CAND_DIR, `cand-${OLD_DAY}.jsonl`), OLD_CAND_TEXT = '{"v":1,"note":"alte Datei – darf nie gelöscht werden"}\n';
const OLD_LOG = path.join(DATA, 'logs', `bot-${OLD_DAY}.log`);
const utcDay = ts => new Date(ts).toISOString().slice(0, 10);
function candFiles() { // { Tag: Inhalt } ohne die alte Testdatei, Tage aufsteigend
  let names = []; try { names = fs.readdirSync(CAND_DIR).sort(); } catch (e) { /* noch nichts geschrieben */ }
  const out = {};
  for (const f of names) { const m = /^cand-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f); if (m && m[1] !== OLD_DAY) out[m[1]] = fs.readFileSync(path.join(CAND_DIR, f), 'utf8'); }
  return out;
}
/* Der Test ist kürzer als der 30-min-Horizont: jede Zeile stammt aus einem vorzeitigen Abschluss (RELOAD/SHUTDOWN) mit TRUNCATED. */
function candCheck(files) {
  const recs = [], errs = [], ids = new Set();
  for (const [day, text] of Object.entries(files)) {
    if (!text.endsWith('\n')) errs.push(`${day}: letzte Zeile ohne Zeilenumbruch`);
    text.split('\n').slice(0, -1).forEach((line, i) => {
      let r; try { r = JSON.parse(line); } catch (e) { errs.push(`${day}:${i + 1} kein gültiges JSON`); return; }
      const bad = [], q = r.quality || {};
      if (r.v !== 1) bad.push('v');
      if (typeof r.id !== 'string' || ids.has(r.id)) bad.push('id fehlt/doppelt'); ids.add(r.id);
      if (!Number.isFinite(r.ts) || utcDay(r.ts) !== day) bad.push('ts/UTC-Tag');
      if (typeof r.tokenId !== 'string' || typeof r.mint !== 'string') bad.push('tokenId/mint');
      if (!r.entry || r.entry.v !== FEATURE_VERSION) bad.push('entry.v');
      if (!r.decision || !Array.isArray(r.decision.analysisCodes)) bad.push('decision.analysisCodes');
      if (!r.cost || r.cost.refUsd !== 50) bad.push('cost.refUsd');
      if (!r.label || !['TP', 'SL', 'RUG', 'TIME', 'NO_DATA'].includes(r.label.y)) bad.push('label.y');
      if (!r.path || !Array.isArray(r.path.s) || !r.path.s.length) bad.push('path.s');
      if (typeof q.ok !== 'boolean' || !Array.isArray(q.flags)) bad.push('quality');
      if (!['RELOAD', 'SHUTDOWN'].includes(r.end) || !(q.flags || []).includes('TRUNCATED')) bad.push(`end ${r.end} ohne TRUNCATED`);
      if (bad.length) errs.push(`${day}:${i + 1} ${bad.join(', ')}`);
      recs.push(r);
    });
  }
  return { recs, errs };
}
const appended = (before, after) => Object.entries(before).every(([d, t]) => typeof after[d] === 'string' && after[d].startsWith(t)); // nur angehängt, nie gekürzt
const openCands = async port => { const s = await status(port); return s.candidates && s.candidates.enabled && s.candidates.open > 0 && s; };

/* ---------- Bot-Prozesse: starten, auf Bereitschaft/Ende warten, immer aufräumen ---------- */
const runs = [];
function startBot(port) {
  const child = spawn(process.execPath, [BOT, '--mock', '--no-open', '--data', DATA, '--port', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const bot = { child, port, out: '', exited: null };
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', d => { bot.out += d; }); child.stderr.on('data', d => { bot.out += d; });
  bot.exit = new Promise(r => child.on('exit', (code, signal) => { bot.exited = { code, signal }; r(bot.exited); }));
  runs.push(bot);
  return bot;
}
const waitExit = (bot, ms) => Promise.race([bot.exit, sleep(ms).then(() => null)]);
async function waitReady(bot, ms = 20000) { const s = await waitFor(async () => (bot.exited ? 'exit' : status(bot.port)), ms); return s === 'exit' ? null : s; }
function killAll() { for (const b of runs) if (!b.exited) { try { b.child.kill('SIGKILL'); } catch (e) { /* schon beendet */ } } }
process.on('exit', () => { killAll(); try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) { /* egal */ } });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(1)); // z. B. Zeitlimit von run-all → Bots nicht verwaist zurücklassen
setTimeout(() => { console.log('FAIL: Zeitlimit von 3 min überschritten – Abbruch'); process.exit(1); }, 3 * 60 * 1000).unref();

(async () => {
  const t0 = Date.now();
  let browser = null, page = null;
  try {
    fs.rmSync(DATA, { recursive: true, force: true });
    // Alte Dateien vor dem ersten Start: die Log-Bereinigung darf nur die Logdatei löschen, nie Kandidaten-Daten
    fs.mkdirSync(CAND_DIR, { recursive: true }); fs.mkdirSync(path.dirname(OLD_LOG), { recursive: true });
    fs.writeFileSync(OLD_CAND, OLD_CAND_TEXT); fs.writeFileSync(OLD_LOG, 'alt\n');
    const oldT = Date.parse(OLD_DAY + 'T12:00:00Z') / 1000; fs.utimesSync(OLD_CAND, oldT, oldT); fs.utimesSync(OLD_LOG, oldT, oldT);
    const bot = startBot(await freePort()), port = bot.port;
    const st0 = await waitReady(bot);
    ok(!!st0, `PC-Bot startet mit Testdaten und beantwortet /api/status (${Math.round((Date.now() - t0) / 100) / 10} s)`);
    if (!st0) throw new Error('Bot nicht erreichbar');
    ok(st0.app === APP_VERSION && st0.mock === true && st0.mode === 'SIMULATION', `Status: Version ${st0.app}, Testdaten, Modus ${st0.mode}`);
    ok(!fs.existsSync(OLD_LOG) && fs.readFileSync(OLD_CAND, 'utf8') === OLD_CAND_TEXT, 'Log-Bereinigung beim Start: alte Logdatei gelöscht, alte Kandidaten-Datei (data/candidates) unangetastet');
    const stC = await waitFor(() => openCands(port), 20000);
    ok(!!stC && stC.candidates.cap === 1000 && stC.candidates.written === 0 && stC.candidates.pending === 0, `/api/status: Datensammler an, ${stC ? stC.candidates.open : 0} Kandidaten offen (Grenze ${stC ? stC.candidates.cap : '–'})`);

    // ---------- 1. Oberfläche lädt ohne Fehler und ohne CSP-Verstöße ----------
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    page = await ctx.newPage();
    const errors = [], dialogs = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
    const until = (fn, arg, ms = 10000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
    const msgText = () => page.locator('#msg').innerText();
    const clearMsg = () => page.evaluate(() => { document.getElementById('msg').textContent = ''; });
    const waitMsg = (re, ms = 10000) => until(s => new RegExp(s).test(document.getElementById('msg').textContent), re.source, ms);
    const jsonFile = (name, data) => ({ name, mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)) });

    await page.goto(`http://localhost:${port}/`);
    await until(() => !/lädt/.test(document.getElementById('state').textContent));
    const chip = await page.locator('#state').innerText();
    ok(/^[A-Z_]+ · [A-Z_]+$/.test(chip), `Status-Chip zeigt echten Zustand („${chip}“)`);
    const kpis = await page.locator('#kpis').innerText();
    ok((await page.locator('#kpis .kpi').count()) >= 10 && /Kapital \(Equity\)/.test(kpis) && /Startkapital\s*\$1\.000/.test(kpis), 'Überblick mit Kennzahlen gefüllt (Equity, Startkapital $1.000 …)');
    ok(/TESTDATEN/.test(await page.locator('#reason').innerText()), 'Hinweis „TESTDATEN (kein Internet)“ sichtbar');
    const info = await page.locator('#datainfo').innerText();
    ok(info.includes('Version ' + APP_VERSION) && info.includes(DATA), `Datenordner und Version ${APP_VERSION} (= APP_VERSION) angezeigt`);
    ok(await until(() => document.querySelectorAll('#cand .kpi').length >= 6 && /Offen \/ Grenze\s*\d+ \/ 1000/.test(document.getElementById('cand').innerText)), 'Bereich „Kandidaten-Daten“ zeigt offene Kandidaten / Grenze 1000');
    ok(await until(d => !!document.querySelector(`#candDays a[href="/api/candidates?day=${d}"]`), OLD_DAY), 'Tagesliste mit Download-Link (vorhandene Datei vom ' + OLD_DAY + ')');

    // ---------- 2. Auto-Trading einschalten ----------
    await clearMsg();
    await page.click('button[data-act="auto-on"]');
    ok(await until(() => document.getElementById('auto').textContent === 'Auto-Trading AN'), 'Klick „Auto-Trading an“ → Chip zeigt „Auto-Trading AN“');
    ok((await status(port)).bot.autoTrading === true, '/api/status: bot.autoTrading = true');

    // ---------- 3. Einstellungen importieren (Format wie „Einstellungen exportieren“: { settings, strategies, watchlist }) ----------
    ok(st0.settings.maxOpenPositions !== 7, `Ausgangswert maxOpenPositions = ${st0.settings.maxOpenPositions}`);
    await clearMsg();
    await page.setInputFiles('#fSettings', jsonFile('einstellungen.json', { settings: { maxOpenPositions: 7 } }));
    ok(await waitMsg(/^Einstellungen übernommen$/), `Meldung „Einstellungen übernommen“ ohne Hinweise („${await msgText()}“)`);
    ok((await status(port)).settings.maxOpenPositions === 7, 'Import wirkt: maxOpenPositions = 7');
    await clearMsg();
    await page.setInputFiles('#fSettings', jsonFile('kaputt.json', 'kein JSON {'));
    ok(await waitMsg(/^Fehler: Datei ist kein gültiges JSON/), 'Kaputte Einstellungsdatei wird mit Fehlermeldung abgelehnt');
    ok((await status(port)).settings.maxOpenPositions === 7, 'Kaputte Datei ändert nichts');

    // ---------- 4. Voll-Backup herunterladen ----------
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('a.btn:has-text("Voll-Backup herunterladen")')]);
    const backupText = fs.readFileSync(await dl.path(), 'utf8'), bk = JSON.parse(backupText);
    ok(/^smartlab-backup-pc-.+\.json$/.test(dl.suggestedFilename()), `Download als Datei „${dl.suggestedFilename()}“`);
    ok(bk.kind === 'backup' && bk.app === APP_VERSION && Number.isInteger(bk.storageVersion) && typeof bk.exportedAt === 'string', 'Backup hat Kennung, App-/Speicherversion und Zeitstempel (Browser-Format)');
    ok(AREAS.every(k => bk.storage[k] && bk.storage[k].v === bk.storageVersion) && Object.keys(bk.storage).length === AREAS.length, `Backup enthält alle ${AREAS.length} Speicherbereiche`);
    ok(bk.storage.settings.settings.maxOpenPositions === 7 && bk.storage.runtime.bot.autoTrading === true, 'Backup enthält die importierte Einstellung und Auto-Trading AN');

    // ---------- 5. Nachträglich ändern, dann Backup wieder einspielen ----------
    await clearMsg();
    await page.setInputFiles('#fSettings', jsonFile('einstellungen-2.json', { settings: { maxOpenPositions: 9 } }));
    ok(await waitMsg(/^Einstellungen übernommen$/) && (await status(port)).settings.maxOpenPositions === 9, 'Zweiter Import: maxOpenPositions = 9');
    await clearMsg(); dialogs.length = 0;
    await page.setInputFiles('#fRestore', jsonFile(dl.suggestedFilename(), backupText));
    ok(await waitMsg(/^Backup eingespielt/, 30000), `Meldung „${await msgText()}“`);
    ok(dialogs.some(d => /Voll-Backup einspielen\?/.test(d)), 'Vor dem Einspielen wird nachgefragt');
    const st5 = await waitFor(async () => { const s = await status(port); return s.scanner.running && s; }, 15000);
    ok(!!st5, 'Bot antwortet nach der Wiederherstellung, Scanner läuft wieder');
    ok(st5 && st5.settings.maxOpenPositions === 7 && st5.bot.autoTrading === true, 'Einstellung wieder auf dem gesicherten Wert (7), Auto-Trading AN');
    ok(st5 && st5.logs.some(l => l.message === 'Bot nach Wiederherstellung neu gestartet') && st5.logs.some(l => /^Sicherung vom .* wiederhergestellt$/.test(l.message)), 'Protokoll: „Bot nach Wiederherstellung neu gestartet“ + „Sicherung … wiederhergestellt“');
    ok(await until(() => document.getElementById('auto').textContent === 'Auto-Trading AN'), 'Oberfläche nach Wiederherstellung aktuell');

    // ---------- 5b. Datensammler: offene Kandidaten des alten Kerns beim Wiederherstellen abgeschlossen (RELOAD) ----------
    const f5 = candFiles(), c5 = candCheck(f5), n5 = c5.recs.length, day = n5 ? utcDay(c5.recs[0].ts) : utcDay(Date.now());
    const dayFile = path.join(CAND_DIR, `cand-${day}.jsonl`);
    ok(n5 > 0 && fs.existsSync(dayFile) && c5.recs.every(r => r.end === 'RELOAD'), `Wiederherstellung: ${n5} Kandidaten mit end RELOAD in cand-${day}.jsonl (UTC-Tag)`);
    ok(c5.errs.length === 0, `Jede Zeile gültig: v 1, entry.v ${FEATURE_VERSION}, Codes, cost.refUsd 50, label.y, path.s, TRUNCATED, Tagesdatei = UTC-Tag von ts (${c5.errs.length} Fehler)`);
    c5.errs.slice(0, 5).forEach(e => console.log('   ', e));
    const st5c = await waitFor(() => openCands(port), 20000);
    ok(!!st5c && st5c.candidates.written === 0, `Neuer Kern nach Wiederherstellung sammelt wieder (${st5c ? st5c.candidates.open : 0} offen)`);

    // ---------- 6. Schutz der lokalen API (fremde Webseiten, DNS-Rebinding) ----------
    const noHdr = await req(port, { method: 'POST', path: '/api/action', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'auto-off' }) });
    ok(noHdr.status === 403, `POST /api/action ohne X-SmartLab → ${noHdr.status} (erwartet 403)`);
    ok((await status(port)).bot.autoTrading === true, 'Abgelehnte Aktion wurde nicht ausgeführt (Auto-Trading weiter AN)');
    const evil = await req(port, { path: '/api/status', host: `evil.example:${port}` });
    ok(evil.status === 403 && !/portfolio/.test(evil.text), `GET /api/status mit Host evil.example → ${evil.status} ohne Daten (erwartet 403)`);
    const evilStop = await req(port, { method: 'POST', path: '/api/shutdown', host: `evil.example:${port}`, headers: { 'X-SmartLab': '1' }, body: '{}' });
    ok(evilStop.status === 403, `POST /api/shutdown mit fremdem Host (trotz Kennung) → ${evilStop.status} (erwartet 403)`);
    const bogus = await req(port, { path: '/api/export?kind=bogus' });
    ok(bogus.status === 400, `GET /api/export?kind=bogus → ${bogus.status} (erwartet 400)`);
    const exp = await req(port, { path: '/api/export?kind=settings-json' });
    ok(exp.status === 200 && /attachment/.test(exp.headers['content-disposition'] || '') && JSON.parse(exp.text).settings.maxOpenPositions === 7, 'GET /api/export?kind=settings-json → Datei mit aktuellen Einstellungen');
    const root = await req(port, { path: '/' }), csp = root.headers['content-security-policy'] || '';
    ok(root.status === 200 && /default-src 'none'/.test(csp) && /script-src 'self'/.test(csp) && !/script-src[^;]*unsafe/.test(csp) && /frame-ancestors 'none'/.test(csp), 'Startseite mit strenger Content-Security-Policy (kein Inline-Skript, kein Einbetten)');
    ok(root.headers['x-content-type-options'] === 'nosniff', 'Header X-Content-Type-Options: nosniff');

    // ---------- 6b. Kandidaten-Daten: Tagesliste und Download (nur gültige Tage, nur aus data/candidates) ----------
    const cl = await req(port, { path: '/api/candidates' }), cdays = cl.status === 200 ? JSON.parse(cl.text).days : [];
    const cd = cdays.find(d => d.day === day);
    ok(!!cd && cd.bytes === fs.statSync(dayFile).size && cdays.every((d, i) => !i || cdays[i - 1].day > d.day) && cdays.at(-1).day === OLD_DAY, `GET /api/candidates listet die Tage, neueste zuerst (${cdays.map(d => d.day).join(', ')})`);
    const cdl = await req(port, { path: `/api/candidates?day=${day}` });
    ok(cdl.status === 200 && cdl.text === fs.readFileSync(dayFile, 'utf8') && cdl.headers['content-disposition'] === `attachment; filename="cand-${day}.jsonl"`, `GET /api/candidates?day=${day} → Datei als Anhang, Inhalt identisch (${cdl.text.length} Bytes)`);
    ok(/^application\/x-ndjson/.test(cdl.headers['content-type'] || '') && cdl.headers['x-content-type-options'] === 'nosniff' && /default-src 'none'/.test(cdl.headers['content-security-policy'] || ''), 'Download mit Content-Type application/x-ndjson, nosniff und CSP');
    const badDays = ['../../x', '..%2F..%2Fsmartlab.v3.settings', '2026-13', '2026-13-01', '2026-02-30', ''];
    const badRes = await Promise.all(badDays.map(d => req(port, { path: '/api/candidates?day=' + d })));
    ok(badRes.every(r => r.status === 400), `Ungültige Tage (${badDays.map(d => d || '„“').join(', ')}) → ${badRes.map(r => r.status).join('/')} (erwartet 400)`);
    const unk = await req(port, { path: '/api/candidates?day=1999-01-01' });
    ok(unk.status === 404, `Gültiger Tag ohne Datei → ${unk.status} (erwartet 404)`);
    const evilC = await req(port, { path: `/api/candidates?day=${day}`, host: `evil.example:${port}` });
    ok(evilC.status === 403 && !evilC.text.includes('"entry"'), `Kandidaten-Download mit fremdem Host → ${evilC.status} (erwartet 403)`);
    ok(!!(await status(port)), 'Bot läuft nach den abgelehnten Anfragen weiter');

    // ---------- 7. Zweiter Bot auf demselben Datenordner wird abgewiesen ----------
    const twin = startBot(await freePort());
    const te = await waitExit(twin, 15000);
    ok(!!te && te.code === 1 && /läuft bereits/.test(twin.out), `Zweiter Bot mit demselben Datenordner beendet sich mit Exit 1 und „läuft bereits“ (Exit ${te ? te.code : 'keiner'})`);
    ok(fs.readFileSync(path.join(DATA, '.lock'), 'utf8').trim() === String(bot.child.pid), 'Sperre gehört weiter dem ersten Bot');
    ok(!!(await status(port)), 'Erster Bot läuft nach dem Doppelstart-Versuch weiter');

    // Konsole/CSP prüfen, bevor der Bot endet (danach meldet der Browser absichtlich „nicht erreichbar“)
    const cspV = await page.evaluate(() => window.__csp);
    ok(errors.length === 0 && cspV.length === 0, `Keine Konsolen-/JS-Fehler und keine CSP-Verstöße (${errors.length + cspV.length})`);
    errors.concat(cspV).slice(0, 5).forEach(e => console.log('   ', e));
    if (failures) await page.screenshot({ path: OUT + '/pcbot-fehler.png', fullPage: true });

    // ---------- 8. „Bot beenden“ in der Oberfläche: speichert, gibt die Sperre frei, Neustart übernimmt die Daten ----------
    await clearMsg(); dialogs.length = 0;
    const tStop = Date.now();
    await page.click('#btnShutdown');
    const e1 = await waitExit(bot, 15000);
    ok(!!e1 && e1.code === 0 && /Gespeichert\. Tschüss\./.test(bot.out), `„Bot beenden“ → Prozess endet mit Exit 0 nach dem Speichern (Exit ${e1 ? e1.code : 'keiner'})`);
    ok(dialogs.some(d => /Bot beenden\?/.test(d)), 'Vor dem Beenden wird nachgefragt');
    ok(await waitMsg(/^Bot beendet\.$/), 'Meldung „Bot beendet.“');
    ok(await until(() => /nicht erreichbar/.test(document.getElementById('state').textContent), null, 8000), 'Oberfläche zeigt danach „Bot nicht erreichbar“');
    await browser.close(); browser = null;

    const file = k => path.join(DATA, `smartlab.v3.${k}.json`);
    ok(AREAS.every(k => fs.existsSync(file(k))), `Datenordner enthält alle ${AREAS.length} Speicherdateien (smartlab.v3.*.json)`);
    const saved = JSON.parse(fs.readFileSync(file('settings'), 'utf8'));
    ok(saved.settings.maxOpenPositions === 7, 'smartlab.v3.settings.json enthält maxOpenPositions = 7');
    // Laufende Änderungen speichert der Kern nur gebündelt alle 5 s – erst das Speichern beim Beenden schreibt den letzten Stand
    ok(JSON.parse(fs.readFileSync(file('runtime'), 'utf8')).savedAt >= tStop, 'Beim Beenden gespeichert (runtime.savedAt nach dem Klick auf „Bot beenden“)');
    ok(!fs.existsSync(path.join(DATA, '.lock')), 'Sperrdatei .lock nach dem Beenden entfernt');
    const logFiles = fs.readdirSync(path.join(DATA, 'logs')).filter(f => /^bot-\d{4}-\d{2}-\d{2}\.log$/.test(f));
    ok(logFiles.some(f => fs.readFileSync(path.join(DATA, 'logs', f), 'utf8').includes('Bot nach Wiederherstellung neu gestartet')), 'Tages-Logdatei enthält „Bot nach Wiederherstellung neu gestartet“');
    const f8 = candFiles(), c8 = candCheck(f8), nShut = c8.recs.filter(r => r.end === 'SHUTDOWN').length;
    ok(nShut > 0 && c8.recs.length === n5 + nShut && appended(f5, f8), `Beim Beenden: ${nShut} weitere Kandidaten (end SHUTDOWN) angehängt, Datei nicht gekürzt (${c8.recs.length} Zeilen)`);
    ok(c8.errs.length === 0, `Alle Zeilen weiter gültig (${c8.errs.length} Fehler)`); c8.errs.slice(0, 5).forEach(e => console.log('   ', e));
    const logText = logFiles.map(f => fs.readFileSync(path.join(DATA, 'logs', f), 'utf8')).join('');
    const mR = /Datensammler: (\d+) offene Kandidaten vorzeitig abgeschlossen \(RELOAD\)/.exec(logText), mS = /Datensammler: (\d+) offene Kandidaten vorzeitig abgeschlossen \(SHUTDOWN\)/.exec(logText);
    ok(!!mR && Number(mR[1]) === n5 && !!mS && Number(mS[1]) === nShut, `Protokoll nennt dieselben Anzahlen (RELOAD ${mR ? mR[1] : '–'}, SHUTDOWN ${mS ? mS[1] : '–'})`);

    const bot2 = startBot(await freePort());
    const st8 = await waitReady(bot2);
    ok(!!st8 && st8.settings.maxOpenPositions === 7 && st8.bot.autoTrading === true, 'Neustart auf demselben Datenordner: Einstellung (7) und Auto-Trading AN bleiben erhalten');
    ok(st8 && fs.readFileSync(path.join(DATA, '.lock'), 'utf8').trim() === String(bot2.child.pid), 'Neuer Bot übernimmt die Sperre');
    ok(!!(st8 && await waitFor(() => openCands(bot2.port), 20000)), 'Neustart: Datensammler verfolgt wieder Kandidaten');
    const stop = st8 ? await req(bot2.port, { method: 'POST', path: '/api/shutdown', headers: { 'X-SmartLab': '1' }, body: '{}' }) : { status: 0 };
    const e2 = await waitExit(bot2, 15000);
    ok(stop.status === 200 && !!e2 && e2.code === 0 && !fs.existsSync(path.join(DATA, '.lock')), `POST /api/shutdown mit Kennung → Exit 0, Sperre frei (Exit ${e2 ? e2.code : 'keiner'})`);
    const f8b = candFiles(), c8b = candCheck(f8b);
    ok(c8b.recs.length > c8.recs.length && appended(f8, f8b) && c8b.errs.length === 0, `Nach Neustart + Beenden weitere Zeilen angehängt, nie gekürzt (${c8.recs.length} → ${c8b.recs.length} Zeilen, ${c8b.errs.length} Fehler)`);

    // ---------- 9. Nach PC-Neustart: verwaiste Sperre + offener Abgleich (Bot war mitten im Trade hart beendet worden) ----------
    // Sperre einer noch laufenden fremden Prozessnummer (dieser Testprozess), aber vor dem letzten Systemstart geschrieben → verwaist
    fs.writeFileSync(path.join(DATA, '.lock'), String(process.pid));
    const beforeBoot = (Date.now() - os.uptime() * 1000 - 10 * 60e3) / 1000; fs.utimesSync(path.join(DATA, '.lock'), beforeBoot, beforeBoot);
    const rt = JSON.parse(fs.readFileSync(file('runtime'), 'utf8'));
    rt.reconciliation = { required: true, issues: ['Position P-TEST (TEST): Kauf unklar – konservativ als nicht gefüllt gewertet'], at: Date.now() };
    fs.writeFileSync(file('runtime'), JSON.stringify(rt));
    const bot3 = startBot(await freePort());
    const st9 = await waitReady(bot3);
    ok(!!st9, 'Sperre von vor dem PC-Neustart gilt als verwaist – Bot startet trotz fremder laufender Prozessnummer');
    ok(st9 && st9.reconcile.required === true && st9.reconcile.issues.length === 1, 'Status meldet offenen Abgleich nach hartem Neustart');
    if (st9) {
      browser = await chromium.launch(); page = await browser.newPage(); dialogs.length = 0; errors.length = 0;
      page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
      page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
      await page.goto(`http://localhost:${bot3.port}/`);
      ok(await until(() => !document.getElementById('recon').hidden), 'Oberfläche zeigt „Abgleich nach Neustart erforderlich“');
      ok(/P-TEST \(TEST\)/.test(await page.locator('#reconIssues').innerText()), 'Offene Punkte werden aufgelistet');
      await page.click('button[data-act="ack-reconcile"]');
      ok(await waitFor(async () => !(await status(bot3.port)).reconcile.required, 10000), 'Klick „Geprüft – bestätigen“ → Abgleich erledigt, neue Käufe wieder möglich');
      ok(dialogs.some(d => /Abgleich bestätigen\?/.test(d)) && await until(() => document.getElementById('recon').hidden), 'Vorher Rückfrage, danach verschwindet der Hinweis');
      ok(await until(d => !!document.querySelector(`#candDays a[href="/api/candidates?day=${d}"]`), day), `Kandidaten-Tagesliste zeigt den Download für ${day}`);
      ok(!errors.length, 'Keine JS-Fehler in der Oberfläche (' + errors.length + ')');
      await browser.close(); browser = null;
      await req(bot3.port, { method: 'POST', path: '/api/shutdown', headers: { 'X-SmartLab': '1' }, body: '{}' });
    }
    const e3 = await waitExit(bot3, 15000);
    ok(!!e3 && e3.code === 0 && !fs.existsSync(path.join(DATA, '.lock')), `Dritter Bot endet sauber (Exit ${e3 ? e3.code : 'keiner'})`);
    ok(appended(f8b, candFiles()) && fs.readFileSync(OLD_CAND, 'utf8') === OLD_CAND_TEXT, 'Nach drei Starts: Kandidaten-Dateien nur ergänzt, alte Datei vom ' + OLD_DAY + ' unverändert');
  } catch (e) {
    ok(false, 'Abbruch: ' + (e && e.stack || e));
    if (page) await page.screenshot({ path: OUT + '/pcbot-fehler.png', fullPage: true }).catch(() => {});
  } finally {
    if (browser) await browser.close().catch(() => {});
    killAll();
    await Promise.all(runs.map(b => waitExit(b, 3000)));
    if (failures) {
      fs.writeFileSync(OUT + '/pcbot-ausgabe.log', runs.map((b, i) => `===== Bot ${i + 1} (Port ${b.port}, Exit ${b.exited ? b.exited.code : '?'}) =====\n${b.out}`).join('\n'));
      console.log('   Ausgabe der Bot-Prozesse: ' + OUT + '/pcbot-ausgabe.log');
    }
    fs.rmSync(DATA, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} FEHLER` : `\nALLE PC-BOT-TESTS BESTANDEN (${Math.round((Date.now() - t0) / 1000)} s)`);
  process.exit(failures ? 1 : 0);
})();
