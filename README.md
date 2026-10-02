# Botenno – Smart Lab Solana Bot

Solana-Memecoin-Scanner mit Analyse, Security-Prüfung, simuliertem Handel und Lern-KI. Die App läuft im Browser (veröffentlicht über GitHub Pages: https://ennoschulz09-ops.github.io/Botenno/) oder seit 2.12.0 als Bot auf dem eigenen PC, ohne Browser.

Echter Handel ist gesperrt: Es gibt keinen Swap-Anbieter, Signieren ist deaktiviert. Die Simulation rechnet seit 2.11.0 mit echten Kursangeboten von Jupiter (nur Abfrage, nie ausgeführt), einer Wartezeit bis zur Füllung, gescheiterten Transaktionen und Priority Fees aus dem Netzwerk. Architektur und Änderungsprotokoll: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).

## Aufbau

Kein Build-Schritt. Die Dateien unter `js/` sind klassische Skripte mit gemeinsamem globalem Gültigkeitsbereich und werden in fester Reihenfolge geladen. Browser und PC nutzen denselben Kern.

| Pfad | Inhalt |
|---|---|
| `index.html` | HTML, CSS, Login und Einbindung der Module (mit `?v=` + App-Version) |
| `js/base.js` → `js/engine.js` → `js/learning.js` → `js/core.js` → `js/selftest.js` → `js/ui.js` | Grundlagen und Datenquellen → Analyse und Entscheidung → Lern-KI → Kern (Scanner, Ausführung, Positionen, Speicher) → Selbsttests → Oberfläche (nur Browser) |
| `server/` | PC-Bot unter Node.js: `bot.js` (Start), `load-core.js` (lädt den Kern aus `js/`), `store.js` (Datei-Speicher), `panel.js` + `panel/` (Oberfläche), `selftest.js` |
| `start-bot.bat` | Start des PC-Bots unter Windows per Doppelklick |
| `tests/e2e/` | Syntax-Prüfung, Browser-Tests, Test-Runner |
| `docs/` | [Architektur](docs/ARCHITEKTUR.md), [Abschlussbericht](docs/ABSCHLUSSBERICHT.md), [PC-Betrieb](docs/PC-BETRIEB.md), [Lerndaten](docs/LERNDATEN.md) |

## Betrieb auf dem PC

Der PC-Bot läuft rund um die Uhr, solange der PC an ist, speichert seine Daten als Dateien im Ordner `data/` (kein 5-MB-Limit wie im Browser) und hat ein größeres Lern-Gedächtnis. Bedient wird er über eine Oberfläche unter http://localhost:8787, die nur auf diesem PC erreichbar ist. Der Handel bleibt simuliert.

Voraussetzung ist Node.js (empfohlen 24 LTS, mindestens 20). Für den Betrieb ist kein `npm install` nötig.

```
node server/bot.js            # unter Windows: Doppelklick auf start-bot.bat
```

Schritt-für-Schritt-Anleitung für Windows (Installation, Übernahme der Daten aus dem Browser, Autostart, Updates, häufige Fehler): [docs/PC-BETRIEB.md](docs/PC-BETRIEB.md). Backup-Format und Datenqualität der Lern-KI: [docs/LERNDATEN.md](docs/LERNDATEN.md).

## Tests

Bei jedem Push auf `main` und bei jedem PR laufen automatisch (GitHub Actions, `.github/workflows/tests.yml`):

- eine Syntax-Prüfung von `index.html` und allen Modulen (inkl. Reihenfolge und Version der Einbindung),
- die Selbsttests der App (System → Selbsttest),
- 8 Browser-Test-Suiten (Login, Oberfläche inkl. Mobil, Lern-KI, Backup, Migration, Backtest, Lernmodus-Profil, XSS-Schutz).

Lokal (Node.js 22 oder neuer):

```
node tests/e2e/check-syntax.js    # Syntax, ohne Browser
node server/selftest.js           # Selbsttests unter Node.js, ohne Browser
npm ci
npx playwright install chromium
npm test                          # alles: Syntax, Selbsttests unter Node.js, alle Browser-Suiten
node tests/e2e/run-all.js login   # nur einzelne Browser-Suiten
node server/bot.js --mock --data <temporärer Ordner> --port 8790   # PC-Bot mit Testdaten, ohne Internet
```

Für die Syntax-Prüfung, die Selbsttests unter Node.js und den PC-Bot wird kein `npm ci` gebraucht; Playwright ist nur für die Browser-Tests nötig.

Das echte Login-Passwort wird dafür nicht gebraucht und steht nirgends im Repo. Ohne `E2E_USER`/`E2E_PASS` erzeugen die Tests eine Testkopie der App mit einem zufälligen Wegwerf-Passwort (`.e2e-app-*.html` neben `index.html`, ignoriert und nach dem Test gelöscht). Mit gesetzten Variablen laufen sie gegen die echte `index.html`. Screenshots landen in `tests/e2e/out/` (ignoriert, wird nie veröffentlicht).
