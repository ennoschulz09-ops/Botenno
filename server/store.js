// Datei-Speicher für den Betrieb ohne Browser. Gleiche Schlüssel und gleiches Format wie localStorage im Browser
// (smartlab.v3.* als JSON-Text), je Schlüssel eine Datei im Datenordner. Dadurch bleiben Backups zwischen Browser,
// PC und späterem Server austauschbar. Kein 5-MB-Limit wie im Browser.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

/* Schreiben über eine temporäre Datei + Umbenennen: ein Absturz mitten im Schreiben hinterlässt nie eine halbe Datei.
   Unter Windows kann das Umbenennen kurz scheitern (Virenscanner hält die Datei offen) → kurz wiederholen. */
function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; }
    catch (e) {
      if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      const until = Date.now() + 50 * (i + 1); while (Date.now() < until) { /* kurz warten */ }
    }
  }
}

function createFileBackend(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const fileOf = key => path.join(dir, encodeURIComponent(key) + '.json');
  const cache = new Map();
  let lastError = null;
  return {
    get(key) {
      if (cache.has(key)) return cache.get(key);
      try { const v = fs.readFileSync(fileOf(key), 'utf8'); cache.set(key, v); return v; }
      catch (e) { if (e.code !== 'ENOENT') lastError = e.message; return null; }
    },
    set(key, value) {
      const v = String(value);
      if (cache.get(key) === v) return true;
      try { writeAtomic(fileOf(key), v); cache.set(key, v); return true; }
      catch (e) { lastError = e.message; return false; }
    },
    remove(key) {
      cache.delete(key);
      try { fs.unlinkSync(fileOf(key)); } catch (e) { /* war nicht vorhanden */ }
    },
    dir,
    noRotate: true, // Schreibfehler sind hier vorübergehend (Virenscanner, Platte): nie wie bei vollem Browser-Speicher gekürzt speichern
    lastError: () => lastError
  };
}

/* Verhindert, dass zwei Bots gleichzeitig mit demselben Datenordner laufen (sonst überschreiben sie sich gegenseitig).
   Verwaist ist eine Sperre, wenn ihr Prozess nicht mehr läuft oder sie vor dem letzten Systemstart geschrieben wurde – nach
   einem Neustart des PCs kann ein fremdes Programm dieselbe Prozessnummer haben. */
const LOCK_BOOT_TOLERANCE_MS = 60 * 1000; // Startzeit aus der Laufzeit ist nur ungefähr (Uhrabgleich, Rundung)
function acquireLock(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '.lock');
  try {
    const pid = Number(fs.readFileSync(file, 'utf8'));
    const beforeBoot = fs.statSync(file).mtimeMs < Date.now() - os.uptime() * 1000 - LOCK_BOOT_TOLERANCE_MS;
    if (pid && pid !== process.pid && !beforeBoot) {
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
      if (alive) return { ok: false, pid };
    }
  } catch (e) { /* keine Sperre vorhanden */ }
  fs.writeFileSync(file, String(process.pid));
  return { ok: true, release: () => { try { if (Number(fs.readFileSync(file, 'utf8')) === process.pid) fs.unlinkSync(file); } catch (e) { /* schon weg */ } } };
}

/* Tägliche Vollsicherung im selben Format wie „Voll-Backup“ im Browser; die letzten `keep` Tage bleiben erhalten. */
function writeDailyBackup(dir, backup, keep = 14) {
  const bdir = path.join(dir, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(bdir, `smartlab-backup-${day}.json`);
  writeAtomic(file, JSON.stringify(backup));
  const all = fs.readdirSync(bdir).filter(f => /^smartlab-backup-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - keep))) { try { fs.unlinkSync(path.join(bdir, f)); } catch (e) { /* egal */ } }
  return file;
}

module.exports = { createFileBackend, acquireLock, writeDailyBackup, writeAtomic };
