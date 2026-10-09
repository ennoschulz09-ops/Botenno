#!/usr/bin/env node
// Smart Lab – Bot auf dem eigenen PC, ohne Browser. Läuft rund um die Uhr, solange der PC an ist.
//   Start:       node server/bot.js        (unter Windows: Doppelklick auf start-bot.bat)
//   Oberfläche:  http://localhost:8787      (nur auf diesem PC erreichbar)
//   Beenden:     Strg+C im Fenster oder „Bot beenden“ in der Oberfläche – speichert vorher alles
// Optionen: --port 8787 · --data <Ordner> (Standard: data/, mit --mock data-mock/) · --no-autostart · --no-open · --mock (Testdaten ohne Internet)
// Handel ist ausschließlich simuliert (SIMULATION/PAPER). LIVE und Signieren bleiben gesperrt – wie im Browser.
'use strict';
const fs = require('fs');
const path = require('path');

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) { console.error(`Node.js ${process.versions.node} ist zu alt – bitte Node.js 22 oder 24 (LTS) installieren: https://nodejs.org`); process.exit(1); }

const { loadCore, ROOT } = require('./load-core');
const { createFileBackend, acquireLock, writeDailyBackup } = require('./store');
const { startPanel } = require('./panel');

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) o[k] = v; else if (argv[i + 1] && !argv[i + 1].startsWith('--')) o[k] = argv[++i]; else o[k] = true;
  }
  return o;
}
const args = parseArgs(process.argv.slice(2));
const MOCK = !!args.mock;
const DATA = path.resolve(args.data ? String(args.data) : path.join(ROOT, MOCK ? 'data-mock' : 'data')); // Testdaten nie in die echten Daten
const PORT = Number(args.port || process.env.SMARTLAB_PORT || 8787);

/* Größeres Lern-Gedächtnis als im Browser (dort begrenzt der 5-MB-Speicher auf 200 Trades). Die Rohdaten (Learning Records)
   sind das, was später auf einen Server oder in neue Modelle übertragen wird. */
const PC_LEARN_CAPS = { records: 5000, nearMiss: 2000, falseSignals: 1000, timeline: 1000, patterns: 2000, lessons: 200, hypotheses: 200, experiments: 200, reviews: 100 };
const PC_JOURNAL_CAPS = { max: 5000, keep: 5000, persist: 5000 }; // Journal passend dazu (Browser: 500 gespeichert)
const LOG_KEEP_DAYS = 30; // Tages-Logdateien in data/logs
/* Datensammler (js/dataset.js): jeder gescannte Coin wird 30 min verfolgt und nach Kosten bewertet – Trainingsdaten für eine
   spätere KI. Handel und Lern-KI ändern sich dadurch nicht. Fertige Datensätze: eine JSON-Zeile je Kandidat in
   data/candidates/cand-JJJJ-MM-TT.jsonl (UTC-Tag des Entscheidungszeitpunkts `ts`). Nur anhängen – nie kürzen, nie löschen,
   nicht Teil des Voll-Backups (je Kandidat ~3 KB). */
const PC_CANDIDATES = { open: 1000 }; // höchstens so viele Kandidaten gleichzeitig verfolgen (je ~5 KB Arbeitsspeicher)
const CAND_PENDING_MAX = 5000; // Zeilen, die nach einem Schreibfehler im Speicher auf den nächsten Versuch warten

const lock = acquireLock(DATA);
if (!lock.ok) { console.error(`Es läuft bereits ein Bot mit diesem Datenordner (Prozess ${lock.pid}). Zwei Bots würden sich gegenseitig die Daten überschreiben.`); process.exit(1); }

const K = loadCore();
Object.assign(K.LEARN_CAPS, PC_LEARN_CAPS);
Object.assign(K.JOURNAL_CAPS, PC_JOURNAL_CAPS);

// ---------- Netzwerk: echt (Standard) oder Testdaten (--mock, z. B. für CI ohne Internet) ----------
let fetchImpl = (u, i) => fetch(u, i);
if (MOCK) {
  const { route } = require(path.join(ROOT, 'tests/e2e/mock.js'));
  fetchImpl = async (url, init = {}) => {
    const data = route(url, init.method || 'GET', init.body);
    if (data == null) return new Response('nf', { status: 404 });
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
const env = {
  now: () => Date.now(),
  fetch: fetchImpl,
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: id => clearTimeout(id),
  random: () => Math.random(),
  online: () => true,
  walletProvider: () => null // keine Wallet auf dem PC-Bot – nur Simulation
};

// ---------- Logs: Konsole (wichtige Meldungen) + Tagesdatei (alles außer DEBUG) ----------
const LOGDIR = path.join(DATA, 'logs');
fs.mkdirSync(LOGDIR, { recursive: true });
const CONSOLE_CATS = new Set(['TRADE', 'RISK', 'SYSTEM', 'LEARNING', 'STORAGE']);
const hhmmss = ts => new Date(ts).toLocaleTimeString('de-DE');
function onLog(e) {
  if (e.level === 'DEBUG') return;
  const line = `${new Date(e.ts).toISOString()} ${e.level.padEnd(8)} ${e.category.padEnd(10)} ${e.message}`;
  try { fs.appendFileSync(path.join(LOGDIR, `bot-${new Date(e.ts).toISOString().slice(0, 10)}.log`), line + '\n'); } catch (x) { /* Log-Fehler nie den Bot stoppen lassen */ }
  if (['WARNING', 'ERROR', 'CRITICAL'].includes(e.level) || CONSOLE_CATS.has(e.category)) console.log(`${hhmmss(e.ts)} ${e.level.padEnd(7)} ${e.category.padEnd(9)} ${e.message}`);
}
/* Logdateien älter als LOG_KEEP_DAYS löschen (beim Start und einmal am Tag); Datum im Namen ist UTC wie beim Schreiben.
   Nur data/logs – Kandidaten-Daten (data/candidates) und Sicherungen werden hier nie angefasst. */
function pruneLogs() {
  const cutoff = new Date(Date.now() - LOG_KEEP_DAYS * 24 * 3600e3).toISOString().slice(0, 10);
  let n = 0;
  try { for (const f of fs.readdirSync(LOGDIR)) { const m = /^bot-(\d{4}-\d{2}-\d{2})\.log$/.exec(f); if (m && m[1] < cutoff) { try { fs.unlinkSync(path.join(LOGDIR, f)); n++; } catch (e) { /* gesperrt – nächstes Mal */ } } } } catch (e) { /* Ordner fehlt */ }
  if (n && holder.core) holder.core.log.info('SYSTEM', `${n} Logdatei(en) älter als ${LOG_KEEP_DAYS} Tage gelöscht`);
  return n;
}

// ---------- Datensammler: fertige Kandidaten als JSONL anhängen (ein Batch je Scan bzw. beim Beenden/Wiederherstellen) ----------
const CANDDIR = path.join(DATA, 'candidates');
let candPending = []; // [{ day, line }] – nach Schreibfehlern (Virenscanner hält die Datei, Platte voll), nächster Batch versucht es erneut
const candBroken = new Set(); // Tage, deren letzter Schreibversuch scheiterte (am Dateiende kann eine halbe Zeile stehen)
let candErrAt = 0, candDropAt = 0, candDropped = 0;
const utcDay = ts => { const d = new Date(ts); return (isNaN(d) ? new Date() : d).toISOString().slice(0, 10); };
function endsWithNewline(file) {
  try {
    const size = fs.statSync(file).size; if (!size) return true;
    const fd = fs.openSync(file, 'r'), b = Buffer.alloc(1);
    try { fs.readSync(fd, b, 0, 1, size - 1); } finally { fs.closeSync(fd); }
    return b[0] === 10;
  } catch (e) { return true; } // Datei fehlt → nichts zu reparieren
}
function writeCandidates(recs, log) {
  const items = candPending;
  for (const r of recs || []) { try { items.push({ day: utcDay(r.ts), line: JSON.stringify(r) }); } catch (e) { log.error('STORAGE', 'Datensammler: Datensatz nicht lesbar – ' + e.message); } }
  if (!items.length) return 0;
  const byDay = new Map(); for (const it of items) { const a = byDay.get(it.day); if (a) a.push(it); else byDay.set(it.day, [it]); }
  const rest = []; let err = null, written = 0;
  try { fs.mkdirSync(CANDDIR, { recursive: true }); } catch (e) { err = e; }
  for (const [day, list] of byDay) { // je Tagesdatei ein einziger Schreibvorgang
    const file = path.join(CANDDIR, `cand-${day}.jsonl`);
    try {
      const nl = candBroken.has(day) && !endsWithNewline(file) ? '\n' : ''; // halbe Zeile vom Fehlversuch abschließen, nichts verkleben
      fs.appendFileSync(file, nl + list.map(x => x.line).join('\n') + '\n');
      candBroken.delete(day); written += list.length;
    } catch (e) { err = err || e; candBroken.add(day); rest.push(...list); }
  }
  if (rest.length > CAND_PENDING_MAX) { // älteste zuerst verwerfen (innerhalb eines Tages bleibt die Reihenfolge erhalten)
    rest.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    const drop = rest.length - CAND_PENDING_MAX; rest.splice(0, drop); candDropped += drop;
  }
  candPending = rest;
  const now = Date.now(); // Meldungen höchstens alle 10 min (ein Batch kommt bis zu einmal je Scan)
  if (candDropped && now - candDropAt >= 10 * 60e3) { candDropAt = now; log.warn('STORAGE', `Datensammler: Schreibpuffer voll – ${candDropped} ältere Kandidaten-Zeile(n) verworfen`); candDropped = 0; }
  if (err && now - candErrAt >= 10 * 60e3) { candErrAt = now; log.error('STORAGE', `Datensammler: Kandidaten-Daten konnten nicht gespeichert werden (${err.code || err.message}) – ${rest.length} Zeile(n) warten im Speicher auf den nächsten Versuch`); }
  else if (!err && candErrAt) { candErrAt = 0; log.info('STORAGE', 'Datensammler: Kandidaten-Daten werden wieder gespeichert'); }
  return written;
}

// ---------- Kern starten (nach einer Wiederherstellung wird er neu erzeugt – wie ein Neuladen im Browser) ----------
const backend = createFileBackend(DATA);
const holder = { core: null, startedAt: Date.now(), dataDir: DATA, mock: MOCK, lastBackup: null, K, candPending: () => candPending.length };
function bootCore() {
  const core = K.createCore({ env, backend, candidates: PC_CANDIDATES });
  core.log.on(onLog);
  core.on('candidates', recs => writeCandidates(recs, core.log)); // je Kern neu – auch nach einer Wiederherstellung
  core.init({ autoStart: !args['no-autostart'] });
  holder.core = core;
  return core;
}
/* Keine neuen Scans und Käufe, laufende Trades (Kursangebot, Wartezeit) bis zu 10 s fertig werden lassen, erst dann alle
   noch offenen Anfragen abbrechen – sonst scheitern Trades mitten im Kursangebot oder fallen auf Schätzungen zurück.
   Davor die offenen Kandidaten vorzeitig abschließen (end SHUTDOWN bzw. RELOAD); der Listener schreibt sie sofort weg. */
async function quiesce(core, reason) {
  try { core.haltTrading(); } catch (e) { /* schon angehalten */ }
  await Promise.race([core.drainTrades(), new Promise(r => setTimeout(r, 10000))]);
  try { core.candidatesFlush(reason); } catch (e) { core.log.error('STORAGE', 'Datensammler: ' + e.message); }
  try { core.http.abortAll(); } catch (e) { /* egal */ }
}
holder.reload = async () => {
  await quiesce(holder.core, 'RELOAD'); // Wiederherstellen: restoreBackup hat den Scanner schon gestoppt und den Speicher eingefroren
  bootCore();
  holder.core.log.info('SYSTEM', 'Bot nach Wiederherstellung neu gestartet');
};
bootCore();
pruneLogs();
setInterval(pruneLogs, 24 * 3600e3);

// Tägliche Vollsicherung (gleiches Format wie „Voll-Backup“ im Browser)
function dailyBackup() {
  try { holder.lastBackup = writeDailyBackup(DATA, holder.core.exportBackup()); }
  catch (e) { holder.core.log.error('STORAGE', 'Tägliche Sicherung fehlgeschlagen: ' + e.message); }
}
setTimeout(dailyBackup, 60 * 1000);
setInterval(dailyBackup, 6 * 60 * 60 * 1000);

// ---------- Oberfläche ----------
const panel = startPanel(holder, { port: PORT, shutdown: () => shutdown('Oberfläche') });
panel.on('listening', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\nSmart Lab ${K.APP_VERSION} läuft (${MOCK ? 'TESTDATEN, kein Internet' : 'echte Marktdaten, simulierter Handel'})`);
  console.log(`Oberfläche: ${url}   ·   Daten: ${DATA}`);
  console.log('Beenden mit Strg+C (speichert vorher alles).\n');
  if (!args['no-open'] && !MOCK && process.platform === 'win32') require('child_process').exec(`start "" "${url}"`);
});
panel.on('error', e => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} ist belegt – läuft der Bot schon? Sonst mit --port 8788 starten.` : 'Oberfläche konnte nicht starten: ' + e.message);
  shutdown('Fehler');
});

// ---------- Sauberes Beenden: keine neuen Scans, laufende Trades abwarten (max. 10 s), speichern ----------
let stopping = false;
async function shutdown(reason) {
  if (stopping) return; stopping = true;
  console.log(`\nBot wird beendet (${reason}) – speichere …`);
  const core = holder.core;
  await quiesce(core, 'SHUTDOWN');
  for (let i = 0; candPending.length && i < 3; i++) { await new Promise(r => setTimeout(r, 300)); writeCandidates([], core.log); } // Schreibpuffer nachholen
  if (candPending.length) console.error(`${candPending.length} Kandidaten-Zeile(n) konnten nicht gespeichert werden (${CANDDIR}).`);
  try { core.persistNow(); } catch (e) { console.error('Speichern fehlgeschlagen:', e.message); }
  try { panel.close(); } catch (e) { /* egal */ }
  lock.release();
  console.log('Gespeichert. Tschüss.');
  setTimeout(() => process.exit(0), 100);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => shutdown(sig));
process.on('uncaughtException', e => { try { holder.core.log.error('SYSTEM', 'Unerwarteter Fehler: ' + (e && e.stack || e)); holder.core.persistNow(); } catch (x) { console.error(e); } });
process.on('unhandledRejection', e => { try { holder.core.log.error('SYSTEM', 'Unbehandelter Fehler: ' + (e && e.message || e)); } catch (x) { console.error(e); } });
