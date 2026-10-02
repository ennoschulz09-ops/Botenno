// Gemeinsame Umgebung der Browser-Tests: Playwright, Pfad zur App, Ausgabeordner und Login-Daten.
//
// Zwei Wege zum Login – das echte Passwort steht nie im Repo:
// 1. E2E_USER und E2E_PASS gesetzt → Tests laufen gegen die echte index.html.
// 2. Nicht gesetzt (Standard, auch in CI) → es wird eine Testkopie der App in tests/e2e/out erzeugt, deren
//    Login-Hash zu einem zufälligen Wegwerf-Passwort passt. Die echte index.html und ihr Passwort bleiben unverändert;
//    die Testkopie (.e2e-app-<pid>.html neben index.html) ist per .gitignore ausgeschlossen und wird nach dem Test gelöscht.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const APP_FILE = path.resolve(__dirname, '../../index.html');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

function testCopy() {
  const html = fs.readFileSync(APP_FILE, 'utf8');
  const kdf = html.match(/const AUTH_KDF = Object\.freeze\(\{ ctx: '([^']+)', salt: '([0-9a-f]+)', iterations: (\d+), hash: '([0-9a-f]{64})' \}\);/);
  const who = html.match(/id="whoami"[^>]*>[^<]*<b>([^<]+)<\/b>/);
  if (!kdf || !who) { console.error('FEHLER: AUTH_KDF oder Benutzeranzeige in index.html nicht gefunden – Testkopie nicht möglich.'); process.exit(2); }
  const [, ctx, salt, iterations, hash] = kdf, user = who[1], pass = 'test-' + crypto.randomBytes(12).toString('hex');
  const testHash = crypto.pbkdf2Sync(Buffer.from(ctx + user + ':' + pass, 'utf8'), Buffer.from(salt, 'hex'), Number(iterations), 32, 'sha256').toString('hex');
  // Neben index.html ablegen, damit die Module unter js/ relativ gefunden werden (Datei ist per .gitignore ausgeschlossen).
  const file = path.join(path.dirname(APP_FILE), `.e2e-app-${process.pid}.html`);
  fs.writeFileSync(file, html.replace(`hash: '${hash}'`, `hash: '${testHash}'`));
  process.on('exit', () => { try { fs.unlinkSync(file); } catch (e) { /* schon entfernt */ } });
  return { file, user, pass };
}

let APP_URL, USER = process.env.E2E_USER, PASS = process.env.E2E_PASS;
if (USER && PASS) APP_URL = 'file://' + APP_FILE;
else { const t = testCopy(); APP_URL = 'file://' + t.file; USER = t.user; PASS = t.pass; }

// Seit 2.11.0 scheitert ein Teil der simulierten Transaktionen zufällig, und die Füllung erfolgt erst nach einer
// Wartezeit zum dann gültigen Kurs. Browser-Tests, die einen Kauf durchspielen, brauchen ein festes Ergebnis:
// keine zufälligen Fehlschläge und eine weite Slippage-Grenze (die Mock-Preise steigen bei jedem Abruf).
// Die Fehlschlag-Logik selbst prüfen die Selbsttests der App. Aufruf nach page.goto, vor dem Login.
const DETERMINISTIC = { simTxFailPct: 0, maxSlippagePct: 10 };
async function seedDeterministic(page) {
  await page.evaluate(s => {
    const k = 'smartlab.v3.settings', cur = JSON.parse(localStorage.getItem(k) || 'null');
    const d = cur && cur.settings ? cur : { v: 3, settings: {}, strategies: {}, watchlist: {}, ui: {} };
    Object.assign(d.settings, s); localStorage.setItem(k, JSON.stringify(d));
  }, DETERMINISTIC);
}

module.exports = { chromium, APP_URL, USER, PASS, OUT, seedDeterministic };
