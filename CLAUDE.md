# CLAUDE.md – Übergabe für Claude Code

## Projekt

Smart Lab: Solana-Memecoin-Scanner mit Analyse, Security-Prüfung, simuliertem Handel und Lern-KI. Läuft im Browser (GitHub Pages aus `main`) und seit 2.12.0 als PC-Bot unter Node.js (`server/`). Der Handel ist ausschließlich simuliert (SIMULATION/PAPER) – mit echten Marktdaten und echten Jupiter-Kursangeboten, die nur abgefragt (`GET /quote`), nie ausgeführt werden. Der Nutzer ist kein Entwickler und betreibt den Bot auf seinem Windows-PC (`docs/PC-BETRIEB.md`).

## Feste Regeln

- Mit dem Nutzer auf Deutsch sprechen, verständlich, ohne unnötigen Fachjargon.
- LIVE-Handel und Signieren bleiben gesperrt. Kein Swap-Anbieter, kein `/swap`, keine Wallet und keine Schlüssel im PC-Bot. Nichts einbauen, das echtes Geld bewegen könnte.
- Keine Geheimnisse in Code, Dateien oder Commits: keine Passwörter, Schlüssel, Tokens, Seeds; keine Namen oder Kennungen von KI-Modellen in Dateien. Den Login-Hash in `index.html` (`AUTH_KDF`) nicht anfassen; `E2E_USER`/`E2E_PASS` nie in Dateien schreiben.
- Der Ordner `data/` enthält die echten Daten des Nutzers: nie löschen, überschreiben, committen oder hochladen. Tests immer mit eigenem Datenordner (`--data`) und eigenem Port. Auf dem PC kann der echte Bot gleichzeitig laufen (Port 8787, `data/`) – nicht ohne Rückfrage beenden.
- Vorher den Nutzer fragen: bei Änderungen an Risiko-Limits oder deren Standardwerten, am Verhalten der Lern-KI (was gelernt oder übernommen wird, Qualitätsregeln, Grenzen), an Datenmigrationen und bei großen oder unklaren Änderungen.
- Arbeiten über Branch und Pull Request, nie direkt auf `main` pushen (`main` ist sofort live auf GitHub Pages).
- Verhaltensänderungen („was handelt der Bot jetzt anders?“) im PR und im Änderungsprotokoll beschreiben.

## Struktur

- `index.html`: HTML, CSS, Login-Gate (inline); lädt die Module in fester Reihenfolge, jeweils mit `?v=APP_VERSION`.
- `js/`: klassische Skripte ohne Build-Schritt mit gemeinsamem globalem Gültigkeitsbereich, Reihenfolge `base.js` → `engine.js` → `learning.js` → `core.js` → `selftest.js` → `ui.js`. Kein `import`/`export`; neue globale Namen müssen über alle Dateien eindeutig sein.
  - `base.js`: Konstanten (`APP_VERSION`), Utils, Logger, Settings (`SETTINGS_SCHEMA`), Storage, HTTP, Normalisierung, Security, Blocker
  - `engine.js`: Analyse, Strategien, Decision Engine, Regime, Analytics, Backtest
  - `learning.js`: Lern-KI als reine Funktionen, Datenqualität (`recordQuality`, `learnable`), `LEARN_CAPS`
  - `core.js`: `createCore` – Scanner, Ausführung, Trade-Lanes, Positionen, Risiko, Lern-Orchestrierung, Migrationen, Persistenz, Backup
  - `selftest.js`: Mock-Harness und Selbsttests (`SELF_TESTS`)
  - `ui.js`: Oberfläche – die einzige Datei, die das DOM benutzen darf
- `base.js` bis `core.js` laufen auch unter Node.js und müssen DOM-frei bleiben; Seiteneffekte nur über `env` (Uhr, `fetch`, Timer, Zufall) und das Speicher-Backend.
- `server/`: PC-Bot, nur Node-Bordmittel – `bot.js` (Start, Optionen, `PC_LEARN_CAPS`), `load-core.js` (lädt `js/` per `vm`; neue Kern-Funktionen für den Server dort im `api`-Objekt oder über das Rückgabeobjekt von `createCore` freigeben), `store.js` (Datei-Speicher, Sperre, Tagessicherung), `panel.js` + `panel/` (Oberfläche auf 127.0.0.1), `selftest.js`.
- `tests/e2e/`: `check-syntax.js`, `run-all.js` (Liste der Suiten), einzelne Suiten, `mock.js` (Mock-Netz, auch für `--mock`), `env.js`.
- `docs/`: `ARCHITEKTUR.md` (Architektur, Änderungsprotokoll), `ABSCHLUSSBERICHT.md` (Bericht, Release-Checkliste), `PC-BETRIEB.md` (Anleitung für den Nutzer), `LERNDATEN.md` (Backup-Format, Datenqualität, Hinweise für Modelle).
- `start-bot.bat`: Windows-Start; Zeilenenden CRLF beibehalten (`.gitattributes`).

## Befehle

```
node tests/e2e/check-syntax.js                      # Syntax, Reihenfolge und Version der Module (ohne Browser)
node server/selftest.js [Suchbegriff]               # Selbsttests unter Node.js (ohne Browser, wenige Sekunden)
npm ci && npx playwright install chromium           # einmalig, nur für die Browser-Tests
node tests/e2e/run-all.js [suite ...]               # Browser-Suiten (alle oder einzelne)
npm test                                            # alles: Syntax, Selbsttests unter Node.js, Browser-Suiten
node server/bot.js --mock --data <tmp> --port 8790  # PC-Bot mit Testdaten ohne Internet; <tmp> = eigener temporärer Ordner, nie data/
```

## Release-Checkliste

1. `APP_VERSION` in `js/base.js` erhöhen **und** alle `?v=` in `index.html` auf dieselbe Version setzen (sonst schlägt `check-syntax.js` fehl).
2. Eintrag im Änderungsprotokoll von `docs/ARCHITEKTUR.md` im Stil der vorhandenen Einträge (mit Verhaltensänderung und Migration), Stand-Zeile anpassen; in `docs/ABSCHLUSSBERICHT.md` Stand, Tabelle und Migrationen ergänzen.
3. Betrifft die Änderung gespeicherte Daten: einmalige Migration mit Versionsmarke, im Log vermerkt, mit Selbsttest.
4. Alle Tests grün: `check-syntax.js`, `server/selftest.js`, `run-all.js` (bzw. `npm test`) und die CI im PR.
5. Release-Checkliste in `docs/ABSCHLUSSBERICHT.md` durchgehen (keine Geheimnisse im Diff, LIVE-Gate gesperrt, Mobil-Ansicht).

## Gut zu wissen

- Lern-KI: nur aus `learnable` Records lernen; Rohdaten (Learning Records) nie löschen, Abgeleitetes lässt sich neu aufbauen (`docs/LERNDATEN.md`).
- Backups aus einer neueren App-Version lassen sich nicht in eine ältere einspielen. Der Nutzer aktualisiert den PC-Bot per ZIP oder `git pull`; `data/` bleibt dabei erhalten.
- Bekannte Lücken der PC-Oberfläche: kein Einstellungs-Editor, kein Knopf zum Bestätigen des Abgleichs nach einem harten Neustart (`docs/PC-BETRIEB.md`, Abschnitt 11).
