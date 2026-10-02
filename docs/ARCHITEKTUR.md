# Smart Lab – Architektur & technischer Audit

Stand: App-Version 2.12.0 – Roadmap-Stufe C1 in Arbeit (PC-Variante: Bot unter Node.js ohne Browser); Stufe B „Ehrliche Simulation“ abgeschlossen (2.11.0). Abschlussbericht: `docs/ABSCHLUSSBERICHT.md`, PC-Betrieb: `docs/PC-BETRIEB.md`, Lerndaten: `docs/LERNDATEN.md`, Ziele und Leitplanken: `docs/STRATEGIE.md`.
Dieses Dokument wird in jeder Phase fortgeschrieben (siehe „Änderungsprotokoll“ am Ende).

## 1. Überblick

- **Auslieferung:** statische Dateien – `index.html` (HTML, CSS, Login-Gate) und sechs klassische Skripte unter `js/` –, veröffentlicht über GitHub Pages aus `main`. Keine Build-Pipeline, keine Abhängigkeiten von Drittbibliotheken (Playwright nur für Tests). Bis 2.11.0 war alles eine einzige Datei `index.html`.
- **Laufzeit:** im Browser (alle Daten im `localStorage` des jeweiligen Geräts) oder seit 2.12.0 als PC-Bot unter Node.js (`server/bot.js`, Daten als Dateien im Ordner `data/`). Beide nutzen dieselben Kern-Dateien und dasselbe Backup-Format.
- **Handel:** ausschließlich simuliert (SIMULATION / PAPER). LIVE ist bewusst nicht verfügbar (kein Swap-/Routing-Provider, Signieren deaktiviert). Seit 2.11.0 rechnet die Simulation mit echten Kursangeboten der Jupiter Quote API (nur Abfrage `GET /quote`, nie `/swap`), einer Wartezeit bis zur Füllung, gescheiterten Transaktionen und Priority Fees aus dem Netzwerk.
- `IMG_8763.png` ist ein Bild ohne Verwendung im Code.

## 2. Architektur (Textdiagramm)

```
Browser: Login-Gate (PBKDF2-SHA256, 600.000 Iterationen, Sperre nach 5 Fehlversuchen) → erst nach Erfolg: startApp()
PC:      server/bot.js → Sperrdatei → loadCore() (js/base … js/core per vm) → Datei-Backend, kein Login
   │
   ▼
createCore(env)  ── DOM-frei, alle Seiteneffekte über env (Uhr, fetch, Timer, Storage) → testbar, läuft im Browser und unter Node.js
   │
   ├─ HTTP-Schicht (createHttp): Rate-Limiter je Quelle, Backoff, Timeout, Abort, Dedupe, Cache, Health
   │     Quellen: DexScreener (Discovery, Pairs, SOL) · GeckoTerminal (Discovery-Fallback, Cross-Check, OHLCV)
   │              RugCheck (Security) · Solana RPC (Mint-Account, Largest Accounts, Slot, Balance, Genesis)
   ├─ Normalisierung (normDexPair, normGtPool, normOhlcv, normMintAccount, normLargest, normRug)
   │     fehlende/ungültige Werte → null (nie 0, nie erfunden)
   ├─ Security Engine (buildSecurity) → Status VERIFIED / PARTIAL / UNKNOWN / CRITICAL + Flags
   ├─ Analyse (analyzeToken): Liquidität, Preis, Volumen, Transaktionen, TA, Pump, Konflikte,
   │     Confidence, Risk-Faktoren, Signale, Final Score, Opportunity
   ├─ Strategien & Konsens (evalStrategies) → gewichtete Stimmen, Lead-Strategie
   ├─ Decision Engine (decideToken): Pipeline mit Blockern (Priorität EMERGENCY → … → SIGNAL)
   │     + gelernte Regeln (nur verschärfend)
   ├─ Execution Check (globalBlockers, execCheck, sizePosition) – Risiko-Limits (alle einstellbar), Cooldowns, Exposure, Impact
   ├─ Orders (State Machine DETECTED → … → COMPLETED/FAILED/CANCELLED/REJECTED, Idempotenz-Keys, Locks)
   ├─ Ausführung SIMULATION (Stufe B): Jupiter-Angebot Kauf + Rundreise (Honeypot, Kosten) → Wartezeit →
   │     neues Angebot → Slippage-Grenze / gescheiterte Tx (Gebühr bezahlt) → Füllung; Rückfall AMM-Schätzung (markiert)
   ├─ Positionen & Portfolio (applyBuyFill, managePositions, executeSell, closePosition, Journal)
   │     Trades laufen neben dem Scan (tradeLanes, laneOf, drainTrades)
   ├─ Risk State (Buy-Zähler, Cooldowns, Verlustserie, Tageslimit, Overtrading)
   ├─ Lern-KI (Adaptive Loss Intelligence): Records → Datenqualität (recordQuality) → Ursachen → Muster → Hypothesen
   │     → Experimente → Challenger (Shadow) → Übernahme (nur SIMULATION) → Überwachung → Auto-Rollback
   ├─ Persistenz (createStorage): 10 getrennte Schlüssel smartlab.v3.*, Versionierung, Migration v1/v2,
   │     Reconciliation nach Neustart; Backend: localStorage (Browser) bzw. eine Datei je Schlüssel (PC)
   └─ Health/Diagnose (systemHealth, botHealth, readiness, diagnostics, liveReadiness)
   ▼
Browser: UI-Schicht (DOM): Views, Detail-Panel, Modals, Charts (Canvas), Toasts, Alarm-Feed
   einfache Ansicht ↔ Analyse-Daten (body.pro)
PC:      Übergangs-Oberfläche (server/panel.js) auf 127.0.0.1: Status, Aktionen, Backup, Exporte
```

## 3. Module und Laufzeiten

Seit 2.12.0 ist der Code auf mehrere Dateien verteilt (vorher eine Datei `index.html` mit rund 8.450 Zeilen). Es gibt keinen Build-Schritt: Die Dateien unter `js/` sind klassische Skripte, die sich einen gemeinsamen globalen Gültigkeitsbereich teilen – wie vorher die eine Datei. Die Reihenfolge ist fest: `base` → `engine` → `learning` → `core` → `selftest` → `ui`.

Gründe für die Aufteilung:

- **Kleinere Dateien:** Eine Änderung betrifft nur die passende Datei. Das ist günstiger und sicherer zu bearbeiten als eine sehr große Datei.
- **Eine Codebasis:** Node.js nutzt dieselben Dateien. `server/load-core.js` führt `js/base.js`, `js/engine.js`, `js/learning.js` und `js/core.js` per `vm` aus. Browser, PC und später der Server laufen damit mit demselben Kern; nur `js/ui.js` braucht ein DOM.

Größe: `index.html` ≈ 560 Zeilen, `js/base.js` ≈ 970, `js/engine.js` ≈ 750, `js/learning.js` ≈ 780, `js/core.js` ≈ 2.740, `js/selftest.js` ≈ 1.200, `js/ui.js` ≈ 1.670.

| Bereich | Datei | Verantwortung |
|---|---|---|
| Login-Gate, CSS, HTML-Grundgerüst | `index.html` | Zugangssperre (inline), Layout, Views als `<section>`, Einbindung der Module |
| Konstanten, TUNING_BOUNDS | `js/base.js` | `APP_VERSION`, API-Adressen (inkl. Jupiter), Grenzen für Lern-/Tuning-Parameter (feste harte Grenzen seit 2.9.0 entfernt) |
| Utils, Formatierung | `js/base.js` | `num/nonNeg/int` (NaN/Infinity/negativ → null), Formatter, TA-Funktionen |
| Logger | `js/base.js` | Ringpuffer 1500 Einträge, Kategorien |
| Settings | `js/base.js` | Schema mit Min/Max, Profile, Validierung |
| Storage & Migration | `js/base.js` | v3-Schlüssel, v2/v1-Migration, Korruptionserkennung, Speicher-knapp-Rotation, Backends (localStorage, Arbeitsspeicher) |
| HTTP / Data Layer | `js/base.js` | siehe Diagramm; `okStatuses` für fachliche Fehlerantworten (z. B. „keine Route“) |
| Normalisierung + Security Engine | `js/base.js` | einheitliches Snapshot-Modell |
| Blocker-System | `js/base.js` | Codes, Prioritäten, Kategorien |
| Analyse-Engines | `js/engine.js` | Kennzahlen, Confidence, Risk, Signale, Scores |
| Strategien & Konsens | `js/engine.js` | 7 Strategien, Gewichte, Shadow |
| Decision Engine | `js/engine.js` | Pipeline, Entscheidung, Trace, gelernte Regeln |
| Stufen-Scores & Security-Prüfbericht | `js/engine.js` | erklärbare Stufen, Prüfbericht |
| Markt-Regime | `js/engine.js` | Breadth, Volatilität, Trend, Richtung, Liquidität |
| Analytics / Backtest | `js/engine.js` | perfStats, Backtest ohne Look-Ahead, Walk-Forward |
| Lern-KI (reine Funktionen) | `js/learning.js` | Features (inkl. Coin-Quelle), Records, Datenqualität (`recordQuality`, `learnable`, `slippageOf`), Attribution, Muster, Experimente, Drift, Modell, `LEARN_CAPS` |
| Core (createCore) | `js/core.js` | Scanner, Execution (Jupiter-Angebote, Wartezeit, Fehlschläge), Trade-Lanes, Positionen, Risk, Lern-Orchestrierung inkl. Migrationen, Persistenz, Backup |
| Testsystem | `js/selftest.js` | Mock-Harness (inkl. Jupiter-Attrappe), 81 Selbsttests |
| UI-Schicht | `js/ui.js` | Views, Detail, Aktionen, Rendering (nur Browser) |

- Jedes `<script src>` in `index.html` trägt `?v=APP_VERSION`, damit der Browser nach einem Update keine alten Dateien aus dem Cache nimmt. `tests/e2e/check-syntax.js` prüft die Syntax aller Dateien sowie Reihenfolge und Version der Einbindung. Beim Release werden `APP_VERSION` in `js/base.js` und alle `?v=` in `index.html` gemeinsam erhöht.
- Globale Namen müssen über alle Dateien eindeutig sein. Ein doppelter Name fällt beim Laden auf (Selbsttests unter Node.js, Browser-Tests).

### PC-Bot (`server/`, seit 2.12.0)

Betrieb ohne Browser unter Node.js ≥ 20, nur mit eingebauten Node-Modulen (kein `npm install` nötig). Anleitung für Windows: `docs/PC-BETRIEB.md`.

| Datei | Aufgabe |
|---|---|
| `server/bot.js` | Einstieg. Optionen `--port` (Standard 8787, auch `SMARTLAB_PORT`), `--data` (Standard `data/`), `--no-autostart`, `--no-open`, `--mock` (Testdaten aus `tests/e2e/mock.js`, kein Internet). Lädt den Kern, setzt das größere Lern-Gedächtnis `PC_LEARN_CAPS`, schreibt Logs (Konsole: wichtige Kategorien und Warnungen; Datei `data/logs/bot-JJJJ-MM-TT.log`: alles außer DEBUG), tägliche Vollsicherung (1 min nach dem Start, dann alle 6 h), sauberes Beenden und Neustart nach Wiederherstellung (`haltTrading`: keine neuen Scans/Käufe, laufende Anfragen nicht abbrechen → laufende Trades max. 10 s abwarten → restliche Anfragen abbrechen, speichern, Sperre freigeben), größeres Journal (`JOURNAL_CAPS` 5000), Logdateien älter als 30 Tage löschen; mit `--mock` ohne `--data` Datenordner `data-mock/`. Keine Wallet. |
| `server/load-core.js` | lädt `js/base.js` … `js/core.js` (für Tests zusätzlich `js/selftest.js`) per `vm.runInThisContext` in einen gemeinsamen Kontext und gibt `createCore`, `APP_VERSION`, `STORAGE_KEYS`, `LEARN_CAPS` u. a. zurück |
| `server/store.js` | Datei-Backend mit derselben Schnittstelle wie `localStorage`: je Schlüssel `smartlab.v3.*` eine Datei `<Schlüssel>.json` im Datenordner, atomar geschrieben (temporäre Datei + Umbenennen, bei gesperrter Datei bis zu 5 Versuche); `noRotate` (Schreibfehler werden gemeldet und beim nächsten Speichern wiederholt, nie gekürzt gespeichert); Sperrdatei `.lock` mit Prozessnummer gegen Doppelstart, verwaist wenn der Prozess fehlt oder sie vor dem letzten Systemstart geschrieben wurde; tägliche Vollsicherung `backups/smartlab-backup-JJJJ-MM-TT.json`, die 14 neuesten bleiben |
| `server/panel.js`, `server/panel/` | Übergangs-Oberfläche: HTTP-Server nur auf `127.0.0.1`, Host-Prüfung (nur `localhost`, `127.0.0.1`, `[::1]` mit eigenem Port; gegen DNS-Rebinding), ändernde Anfragen nur per POST mit Header `X-SmartLab: 1`, eigene strenge CSP. Status alle 2 s; Hinweis + Knopf „Geprüft – bestätigen“ bei offenem Abgleich nach hartem Neustart; Start/Pause, Auto-Trading, Not-Aus, Frischer Start, Lernlauf, Verkauf einer Position, Voll-Backup herunterladen/einspielen (danach wird der Kern neu erzeugt), Einstellungen importieren, Exporte, Beenden |
| `server/selftest.js` | alle Selbsttests unter Node.js (`node server/selftest.js [Suchbegriff]`) |
| `start-bot.bat` | Doppelklick-Start unter Windows; prüft, ob Node.js installiert ist, und reicht Optionen weiter |

Lern-Gedächtnis: Browser `LEARN_CAPS` (`js/learning.js`, u. a. 200 Learning Records), PC `PC_LEARN_CAPS` (`server/bot.js`, u. a. 5000 Learning Records). Einzelheiten und Übertragbarkeit: `docs/LERNDATEN.md`.

## 4. State & Persistenz

| Schlüssel | Inhalt |
|---|---|
| `smartlab.v3.settings` | Einstellungen, Strategien, Watchlist, UI-Zustand |
| `smartlab.v3.runtime` | Modus, Bot-Wunschzustand, Risk State, Session, Alarm-Marken, Reconciliation |
| `smartlab.v3.positions` | Portfolio, offene Positionen, Orders, Idempotenz-Keys |
| `smartlab.v3.trades` | Trade-Journal (max. 500) |
| `smartlab.v3.logs` | Logs, Audit Trail, Config-Log, Alarm-Feed |
| `smartlab.v3.stats` | Verläufe, Strategie-Statistik, Parameter-Versionen, Sessions |
| `smartlab.v3.learning` / `experiments` / `models` / `patterns` | Lern-KI |

- Speicherort: im Browser der `localStorage` (etwa 5 MB); auf dem PC eine Datei je Schlüssel im Datenordner (`server/store.js`) mit genau demselben Inhalt, ohne Größenlimit.
- Jeder Schlüssel trägt `v: 3`; beschädigte Kernbereiche → RECONCILIATION REQUIRED (keine Käufe bis Bestätigung); beschädigte Lernbereiche → leere Defaults.
- Geschrieben wird nur, was sich geändert hat; bei vollem Speicher (bzw. auf dem PC bei einem Schreibfehler) werden Logs/Stats/Journal/Lerndaten rotiert.
- Laufzeit-Migrationen: v1 → v2 → v3, Journal → Learning Records (2.2.0), Cooldowns unter 10/5 min → auf harte Untergrenze angehoben und im Config-Log vermerkt (2.3.0), gespeicherte Loss-Cooldown-/Pause-Werte aus Versionen vor 2.8.0 → einmalig 0 min, laufende Pause/Cooldown beendet, im Config-Log vermerkt (2.8.0), Slippage mit begrenzter Formel neu berechnet (`slippageMigrate`) und Datenbereinigung der Lerndaten (`learnQualityMigrate`, Abgeleitetes neu aus sauberen Records, Hypothesen neu testen) (2.12.0, Einzelheiten in `docs/LERNDATEN.md`).
- Voll-Backup: Export aller Bereiche; Wiederherstellen erst nach Prüfung (Kennung, Version, jeder Bereich) und Probe-Laden in einer isolierten Instanz. Im Browser vorher automatische Sicherung des aktuellen Stands, danach Neustart mit Login; auf dem PC wird der Kern danach neu erzeugt (ohne automatische Vorab-Sicherung). Das Format ist im Browser, auf dem PC (Oberfläche und tägliche Sicherung) und für den späteren Server dasselbe.

## 5. Startfluss

1. `boot()`: nur Login-Formular aktiv, **kein** Core-Start.
2. Login erfolgreich → `startApp()` (einmalig): `core.init({ autoStart: true })` → Storage laden, validieren, migrieren, Reconciliation, Session, Parameter-Version, Tokens aus Positionen/Watchlist, Scanner-Start (Zustand RECOVERING bis Datenqualität reicht).
3. UI aufbauen (`loadUi`, `applyPro`, `buildNav`, …), Render-Schleife.
4. Scanner-Schleife (`scanOnce`, Standard 1 s, Lock gegen Parallel-Scans): Discovery → Pairs → Cross-Check → RPC-Ping → Analyse → Positionen verwalten → Lern-Nachlauf/Lernlauf → Alarme → Auto-Trading-Queue. Security-Prüfungen laufen in einer eigenen Warteschlange (1,5 s).
5. Seit 2.12.0 wartet der Scan im laufenden Betrieb nicht mehr auf Käufe und Verkäufe (`scanOnce({ awaitTrades: false })`; ein Trade dauert seit 2.11.0 2–4 s). `managePositions` bewertet alle Positionen sofort und startet Verkäufe in eigenen Trade-Lanes (`laneOf`), Auto-Käufe laufen ebenso nebenher (eine Kauf-Warteschlange, `processQueue`). Sperren je Coin bzw. Position verhindern doppelte Orders. `drainTrades()` wartet auf alle laufenden Trades (Tests, Beenden, Wiederherstellen auf dem PC). Aufrufe ohne Option (Tests, manuell) warten wie bisher.

PC-Bot: `server/bot.js` → Sperrdatei → `loadCore()` → `createCore({ env, backend: Datei-Backend })` → `init({ autoStart })` wie oben ab Schritt 2, aber ohne Login und ohne DOM; die Oberfläche ist ab dem Start unter `http://localhost:8787` erreichbar.

## 6. Bewertung je Bereich (Ist-Zustand)

| Bereich | Vorhanden | Lücken (Phase) |
|---|---|---|
| Datenebene | Rate-Limit, Backoff, Timeout, Dedupe, Cache mit TTL, Health je Quelle, Schema-Validierung, Stale-Erkennung, NaN/Infinity/negativ/unplausibel → null, Zählung ungültiger Felder & verworfener Datensätze je Quelle (System-Ansicht) | – |
| Scanner | Schnellfilter, Security-Queue, Priorisierung, Entscheidungskette je Token, Stufen-Scores Discovery → Datenqualität → Security → Markt → Handelsbereitschaft mit Teilbegründungen (`stageScores`) | – |
| Security | eigene Engine, CRITICAL blockiert immer (auch manuell), Stale-Security blockiert, Prüfbericht mit 14 Checks (Ergebnis, Schweregrad, Quelle, Zeitpunkt, Aktion aus den echten Blockern, `securityReport`), NO_DATA getrennt von PASS | Creator-/Wallet-Historie ohne Datenquelle (bleibt NO_DATA) |
| Signale | 12 Signaltypen, 7 Strategien, Konsens, Confidence getrennt vom Score, Score-Attribution (pro/contra/Abzüge = Final Score) mit Kipp-Punkten, Signal-Konflikt-Detektor (8 Muster, Gewicht ≥ 3 blockiert Auto-Käufe, abschaltbar), Multi-Timeframe-Abgleich 5m/1h/6h/24h, Signal-Decay für Ereignis-Signale | Kontextgewichtung nach Regime nur über gelernte Regeln |
| Risk | Limits (alle per Einstellung bis 0 = aus, Profil „Lernmodus (ohne Limits)“), Cooldowns, Exposure, Korrelation, Tageslimit, Overtrading, Impact-Grenze, Drawdown-Modus (×0,5 ab 10 %) & Drawdown-Grenze (keine Auto-Käufe ab 20 %), Abschläge mit Reason Codes (Datenalter, Execution-Unsicherheit, unbestätigte Daten, Cluster-Exposure), marktweite No-Trade-Zone bei schlechter Datenlage | – |
| Portfolio | Journal, realisiert/unrealisiert, Fees/Slippage, Reconciliation nach Neustart, Positions-Lebenszyklus PLANNED → PENDING → OPEN → CLOSING ↔ PARTIAL → CLOSED → RECONCILED (UNKNOWN = Abgleich), Integritätsprüfung (Mengen, Doppelbuchungen, Journal, hängende Orders, verwaiste Positionen); seit 2.12.0 Slippage mit begrenzter Formel (`slippageOf`, Altwerte neu berechnet) | Cash-Abgleich über mehrere „Frische Starts“ hinweg nicht rekonstruierbar |
| Execution | Order-State-Machine, Idempotenz-Keys, Locks, Pre-Trade-Check mit frischen Daten, Provider-Abstraktion Quote → Build → Preflight → Sign → Send → Confirm (SIMULATION vollständig, LIVE liefert NO_ROUTER / SIGNATURE_DISABLED), Fehlercodes je Order. Seit 2.11.0: echtes Jupiter-Angebot je Kauf und Verkauf (nur Abfrage), Rundreise-Prüfung beim Kauf (kein Verkaufsweg → NO_SELL_ROUTE, zu teuer → ROUND_TRIP_COST, 5 min je Coin gemerkt), Füllung erst nach einstellbarer Wartezeit zum dann gültigen Angebot, Slippage-Grenze (sonst SLIPPAGE_EXCEEDED), einstellbarer Anteil gescheiterter Transaktionen (TX_FAILED), Netzwerk- und Priority-Gebühr auch beim Scheitern, Priority Fee aus `getRecentPrioritizationFees` (75. Perzentil, fester Wert als Minimum), Position ohne Verkaufsweg zählt 0 $ und wird nach 30 min als Totalverlust abgeschrieben; ohne Jupiter Rückfall auf AMM-Schätzung (abschaltbar, als „geschätzt“ markiert). Seit 2.12.0: Trades laufen neben dem Scan (Trade-Lanes), Kauf-Blocker PRICE_CONFLICT (Jupiter-Angebot > 25 % unter DexScreener: Rug oder veralteter Kurs), Käufe und Verkäufe speichern ihre Quelle (`JUPITER`, `AMM`, `WRITE_OFF`) | echter Swap-/Routing-Provider fehlt (bewusst); kein Sandwich-/MEV-Modell; Jupiter-Kontingent des kostenlosen Zugangs begrenzt (lokal 50 Abfragen/min) |
| Wallet | nur lesend, Phantom (`window.phantom.solana`), Balance per RPC, Signieren deaktiviert, stille Wiederverbindung nur mit `onlyIfTrusted` (kein Popup) | – |
| Backtest | kein Look-Ahead, Stops vor TPs, Fees/Slippage, Walk-Forward Pflicht (Validierung/Test getrennt, OOS-Anteil ausgewiesen), Run-Protokoll mit Run-ID, Datensatz-Hash, Parametern, Kosten, Code-Version und Limitierungen, Stress-Tests (Gebühren/Slippage ×2, Einstieg 1 Kerze später, engerer Stop, niedrigerer TP), Monte-Carlo-Drawdown (deterministisch), Regime-Auswertung, Trade-CSV, Lauf-Historie (20) | Daten nur aus GeckoTerminal-OHLCV eines Pools (kein Survivorship-freier Universums-Test), keine Orderbuch-Simulation |
| Lernen | Learning Records, Ursachen mit Evidenz, Counterfactuals, Muster, Hypothesen → Experimente (Train/Validation/Test, Walk-Forward) → Shadow → Übernahme nur in SIMULATION, nur verschärfend, Auto-Rollback; Fehlerklassen (statistisch · Execution · Daten · Security · Modell · Prozess) mit Prüfung „erwartbarer Verlust?“ gegen den beim Einstieg geplanten Stop; Near-Miss-Tracking (15 min Nachlauf, verpasster Gewinn vs. vermiedener Verlust je Filter, reine Messung); Tabelle aktiver Parameter mit Herkunft/Grund; neue Parameter nur noch über die Lern-KI; seit 2.11.0 Coin-Quelle (Boost, Top-Boost, Profil, neue Pools, Trending, Watchlist) als Merkmal in Features, Mustern, Near-Misses und Exporten, Auswertung je Quelle, Hypothese „Quelle meiden“ (BLOCK_DISC, nur automatische Quellen, erst nach Test + Shadow wirksam); seit 2.12.0 Datenqualität je Record (`recordQuality`): PYRAMIDED (mehr als 3 Käufe), PRICE_CONFLICT (Kauf-Füllkurs > 25 % neben dem Referenzkurs), ESTIMATED_RUG_EXIT (Verkauf bei Liquiditätsabzug nur geschätzt) – solche Trades bleiben gespeichert, im Journal und im Export, zählen aber nicht für Muster, Fehlsignale, Lektionen, Hypothesen, Experimente, Verlustmodell, Kalibrierung, Drift, Verlustserien-Review und Shadow-/Live-Bewertung („Fürs Lernen ausgeschlossen“); Records speichern Ausführungsmodell (`execModel`), Verkaufsquelle und größte Kursabweichung beim Kauf; Lern-Gedächtnis auf dem PC 5000 statt 200 Records (`docs/LERNDATEN.md`) | Near-Miss-Ergebnisse sind simuliert (ohne Kosten); Herkunft nur für die letzten 200 Konfigurationsänderungen; Trades vor 2.11.0 ohne Quelle („unbekannt“); Verkaufsquelle von Trades vor 2.12.0 nicht gespeichert (Modell 2 → `UNKNOWN`, Rug-Ausstiege damit konservativ ausgeschlossen); im Browser weiter nur 200 Records |
| Monitoring | System/Bot Health, API Health Center, Diagnose; Kennzahlen der letzten 60 min (Signale/Stunde, Security- und Risiko-Blockquote, Freigabequote, Orders, Erfolgsquote, Ø Ausführungszeit, Fehlercodes, Datenfrische, Zustand der Lern-KI); Anomalie-Monitor mit 14 Reason Codes (u. a. DATA_STALE_WIDE, PRIMARY_API_DOWN, EXEC_FAILURES, EXEC_SLOW, SLIPPAGE_SPIKE, TX_FAIL_RATE, QUOTES_ESTIMATED, RECONCILIATION, PORTFOLIO_INTEGRITY, LOSS_BURST, EQUITY_DROP, LEARNING_ERRORS, STORAGE_FAIL; simulierte Fehlschläge TX_FAILED/SLIPPAGE_EXCEEDED und NO_ROUTE zählen nicht als EXEC_FAILURES), Kennzahlen „Ausführung“ (Anteil echter Angebote, Fehlquote, bezahlte Gebühren gescheiterter Tx, aktuelle Priority Fee), Schweregrad und Aktion WARN / DEGRADE / PAUSE / HARD_STOP; Standard „nur warnen“, mit „handeln“ Größe ×0,5, Pause neuer Auto-Käufe (ANOMALY_PAUSE) bzw. einmaliger Not-Stopp; Alarm + Verlauf je Anomalie | Kennzahlen nur für die laufende Sitzung (nicht gespeichert) |
| UI | einfache/Analyse-Ansicht, „Warum?“-Tab, Entscheidungsketten, Statusleiste (Analyse-Ansicht) mit System, Daten, Wallet, Risiko, Live-Gate und Monitor; Monitor-Pill auch in der einfachen Ansicht, sobald eine Anomalie aktiv ist; Pills brechen auf dem Desktop um statt abgeschnitten zu werden | – |
| Login | PBKDF2 (600k), kein Klartext, kein Persistieren, Reload → neu anmelden, Sperre 30 s → 15 min nach je 5 Fehlversuchen, gesperrt keine App-Aktionen, Eingaben während der Prüfung gesperrt | bleibt clientseitig (kein Server); PC-Oberfläche ohne Login (nur 127.0.0.1) |
| PC-Betrieb | seit 2.12.0: Kern unter Node.js ohne Browser (`server/`), Datei-Speicher je Schlüssel (atomar), Sperrdatei gegen Doppelstart, tägliche Vollsicherung (14 Tage), Logs je Tag (30 Tage), sauberes Beenden (laufende Trades werden fertig), Übergangs-Oberfläche auf 127.0.0.1 inkl. Bestätigung des Abgleichs nach Neustart, Selbsttests unter Node.js, Windows-Start per `start-bot.bat`; Speicherfehler kürzen nie Daten (`noRotate`) | Oberfläche ohne Einstellungs-Editor (nur Import), ohne Modus-Umstellung und Teilverkäufe; keine Datenbank; Server-Betrieb (C1–C3) folgt |

## 7. Sicherheitskritische Stellen

- Risiko-Limits: seit 2.9.0 keine festen Grenzen mehr – alle über `SETTINGS_SCHEMA` einstellbar (0 = aus), validiert auf gültige Bereiche. Die Lern-KI verändert sie nie. Nicht abschaltbar bleiben: Security-Blocker (CRITICAL, Prüfung ausstehend), Datenprüfungen (kein Preis, veraltete Daten, Gebühren unbekannt), Doppel-Order-Schutz, Abgleich nach Neustart, LIVE-Gating.
- `globalBlockers` / `execCheck` / `MANUAL_HARD`: letzte Prüfung vor jeder Order.
- `setMode('LIVE')` / `liveReadiness`: LIVE nie aktivierbar ohne Provider; seit 2.10.1 zusätzlich nur mit aktiven Risiko-Limits (kein Lernmodus); seit 2.11.0 zusätzlich nur mit echten Kursangeboten ohne Schätz-Rückfall, Honeypot-Schutz und aktiver Rundreise-Kostenprüfung (≤ 20 %).
- Jupiter: ausschließlich `GET /quote` (Selbsttest prüft, dass nie ein anderer Pfad aufgerufen wird); optionaler API-Key nur als Header `x-api-key`, lokal gespeichert (Passwortfeld, Format geprüft), Teil von Voll-Backups wie die RPC-URLs, aber nicht im Einstellungs-Export; im Konfigurations-Protokoll und Log-Export nur maskiert („••• (gesetzt)“).
- `requestSignature`: deaktiviert.
- Lern-KI: `mergeParams` (nur verschärfend), `sanitizeRules`, Übernahme nur SIMULATION.
- Login: Hash im Quelltext öffentlich sichtbar (GitHub Pages) → clientseitige Sperre, **kein** Server-Schutz. PBKDF2 macht Offline-Raten teuer, verhindert es aber nicht bei schwachen Passwörtern.
- CSP: `script-src 'self' 'unsafe-inline'` (`'self'` für die Module unter `js/`, auch unter `file://`; `'unsafe-inline'` für das Login-Gate in `index.html`), `connect-src https:`, keine externen Skripte.
- PC-Oberfläche (`server/panel.js`): lauscht nur auf `127.0.0.1`, Host-Prüfung gegen DNS-Rebinding, ändernde Anfragen nur per POST mit Header `X-SmartLab` (fremde Webseiten können ihn ohne CORS-Freigabe nicht setzen), eigene strenge CSP, Werte aus Marktdaten werden vor der Anzeige escaped. Kein Login – Schutz über den Benutzer des PCs. Der PC-Bot hat keine Wallet; LIVE und Signieren sind gesperrt wie im Browser.
- Alle dynamischen Texte laufen durch den `html`-Template-Escaper; Links nur über `safeUrl` (kein `javascript:`).

## 8. Performance (gemessen, Phase 0)

Mock mit 400 Tokens, `maxTokens` 400, 6 Batch-Requests je Scan, Chromium headless:

| Messung | Wert |
|---|---|
| Scan-Dauer | 11–39 ms |
| Analyse aller Tokens | 11–20 ms |
| Render | 4–33 ms |
| Scans pro Sekunde | ~1,0–1,1 (Intervall 1 s) |
| JS-Heap | ~32 MB |

Kein Hotspot gefunden, der eine Optimierung rechtfertigt. Render ist bereits gedrosselt (≥ 800 ms, nur aktive View, DOM-Patch nur bei geänderter Ausgabe).

## 9. Tests (Ist)

- **81 Selbsttests** in der App (System → Selbsttest), seit 2.12.0 auch ohne Browser unter Node.js (`node server/selftest.js`, Teil von `npm test`): Grundlagen, Trading-Limits, Daten/Stale, Security, Chaos (API-/RPC-Ausfall, 429, falsches JSON, Scanner-Lock, verspätete Antworten, Reload-Recovery), Status-Logik, LIVE-Gating, Storage, Backtest (Look-Ahead, Reproduzierbarkeit, Stress/Einstiegsverzögerung, Monte-Carlo/Regime), Portfolio & Execution, Signal & Risk, 11 Lern-KI-Tests, 4 Adaptive-KI-Tests (Fehlerklassen, Near-Misses, aktive Parameter, kein naives Tuning), 3 Monitoring-Tests (Anomalien & Modi, Not-Stopp, Kennzahlen), 5 Tests „Ehrliche Simulation“ (Jupiter-Angebote/Honeypot/Rundreise/Rückfall/API-Key, Wartezeit/Slippage-Grenze/gescheiterte Tx/Priority Fee, kein Verkaufsweg → Abschreibung, Fehlquote im Monitor, Coin-Quelle als Lernmerkmal), seit 2.12.0 „Trades blockieren den Scan nicht“ (Verkauf läuft nebenher, kein Doppel-Verkauf) und „Keine falschen Learnings“ (verzerrte Trades zählen nicht, alte Daten werden bereinigt, Rug-Ausstiege mit unbekannter Quelle ausgeschlossen, Kurskonflikt blockiert) sowie „Schreibfehler im Datei-Speicher → nie gekürzt“. Die Test-Umgebung bildet Jupiter als Konstantprodukt-AMM nach; echte Jupiter-Antworten sind in der Cloud-Testumgebung nicht erreichbar.
- **E2E-Suiten** (Playwright, `tests/e2e/`, seit Roadmap-Schritt A1 im Repo), 10 Suiten: Selbsttests, Login, UI einfach/Analyse inkl. Mobil, Lern-KI, Backup/Restore, Migration, Backtest-Bericht, Lernmodus-Profil, XSS-Schutz und seit 2.12.0 PC-Bot (`pcbot`); `node tests/e2e/run-all.js [Suite]`. `npm test` führt nacheinander Syntax-Prüfung, Selbsttests unter Node.js und alle Suiten aus.
- **PC-Bot-Suite** (`tests/e2e/pcbot.js`, seit 2.12.0): startet `server/bot.js --mock` als eigenen Prozess mit Datenordner unter `tests/e2e/out/` und prüft: Oberfläche lädt ohne Konsolen- und CSP-Fehler, „Auto-Trading an“, Einstellungen importieren (auch Ablehnung einer kaputten Datei), Voll-Backup herunterladen und mit Neustart des Kerns wieder einspielen, Schutz der lokalen API (Pflicht-Header, Host-Prüfung, CSP), Sperre lehnt einen zweiten Bot auf demselben Datenordner ab, Beenden speichert, nach einem Neustart sind die Daten noch da, eine Sperre von vor dem Systemstart gilt als verwaist, offener Abgleich wird angezeigt und lässt sich bestätigen.
- **Syntax-Prüfung** (`tests/e2e/check-syntax.js`, ohne Browser): Syntax von `index.html` und allen Modulen, Reihenfolge der Module und `?v=` passend zu `APP_VERSION`.
- **PC-Bot ohne Internet:** `node server/bot.js --mock --data <temporärer Ordner> --port 8790` startet den Bot mit Testdaten.
- **CI** (GitHub Actions, `.github/workflows/tests.yml`) bei jedem Push auf `main` und jedem PR: Syntax-Prüfung → Selbsttests unter Node.js (`node server/selftest.js`, eigener Schritt seit 2.12.0) → alle 10 Suiten (`node tests/e2e/run-all.js`). Ohne `E2E_USER`/`E2E_PASS` nutzen die Tests eine Testkopie der App mit zufälligem Wegwerf-Passwort – das echte Passwort steht nirgends im Repo und wird nicht als Secret gebraucht.
- **Lücken:** Monitoring-Aktionen (Phase 7), UI-Smoke für LIVE-Gate/Wallet.

## 10. Technische Schulden

- Bis 2.11.0 eine sehr große Datei; seit 2.12.0 aufgeteilt. `js/core.js` bleibt mit etwa 2.700 Zeilen die größte Datei.
- Kein Modulsystem: Alle Dateien teilen sich den globalen Gültigkeitsbereich (bewusst, damit es ohne Build-Schritt im Browser und unter Node.js läuft). Abhängigkeiten zwischen den Dateien ergeben sich nur aus der Ladereihenfolge.
- Die PC-Oberfläche ist eine Übergangslösung bis zum Server (Roadmap C).

## 11. Bewusste Abweichungen / Entscheidungen

- Feste (harte) Grenzen: ab 2.9.0 auf Wunsch des Nutzers aufgehoben. Alle Risiko-Limits sind Einstellungen und können auf 0 = aus gestellt werden; Standardwerte unverändert. Gedacht für durchgehendes Lernen in SIMULATION; LIVE bleibt gesperrt.
- Loss-Cooldown / globale Pause: in Phase 1 auf harte Untergrenze 10 / 5 min gesetzt; ab 2.8.0 auf Wunsch des Nutzers wieder 0 min (Standard und Untergrenze, weiterhin einstellbar). Folge: nach Verlusten bzw. einer Verlustserie gibt es keine automatische Handelspause mehr – Verlustserien lösen nur noch einen Review-Hinweis aus. Tageslimit, Drawdown-Grenze, Overtrading-Schutz und Coin-Cooldown (15 min) bleiben unverändert.
- Einzeldatei bis 2.11.0; `app.js` wird gelöscht (Entscheidung Nutzer). Ab 2.12.0 aufgeteilt in `index.html` + `js/` – ohne Build-Schritt, damit Änderungen kleiner bleiben und der Kern auch unter Node.js läuft.
- PC-Variante vor dem Server (Roadmap C1): gleicher Kern und gleiches Backup-Format, damit die Daten später ohne Umwandlung auf einen Server umziehen können. Der Bot handelt dort ebenfalls nur simuliert.
- Datenqualität vor Datenmenge (2.12.0): verzerrte Trades werden nicht gelöscht, sondern fürs Lernen ausgeschlossen; Abgeleitetes wird aus den sauberen Rohdaten neu aufgebaut.
- Umsetzung phasenweise, jede Phase einzeln getestet und gemergt.

## Änderungsprotokoll

- Phase 0: Audit erstellt.
- Roadmap C1, PC-Variante (2.12.0) – Betrieb ohne Browser und saubere Lerndaten: **Module** `index.html` in sechs klassische Skripte unter `js/` aufgeteilt (base, engine, learning, core, selftest, ui; gemeinsamer globaler Gültigkeitsbereich, kein Build-Schritt, kein Verhalten geändert), `index.html` behält HTML, CSS und Login-Gate, `?v=APP_VERSION` gegen alte Dateien im Browser-Cache, CSP um `'self'` ergänzt, Syntax-Prüfung kontrolliert Reihenfolge und Version; **Trades nebenher:** der Scan wartet im laufenden Betrieb nicht mehr auf Käufe und Verkäufe (Trade-Lanes, `drainTrades`), Sperren je Coin/Position verhindern Doppel-Orders; **Lerndaten** nach Auswertung echter Nutzerdaten (Browser-Speicher voll, bis zu 164 Nachkäufe je Position, Rug mit Jupiter-Angebot 99 % unter DexScreener, Scheingewinne bei Liquiditätsabzug vor 2.11.0): Kennzeichen PYRAMIDED (> 3 Käufe), PRICE_CONFLICT (Kauf-Füllkurs > 25 % neben dem Referenzkurs) und ESTIMATED_RUG_EXIT (geschätzter Verkauf bei Liquiditätsabzug) – solche Trades bleiben gespeichert und im Export, zählen aber nicht fürs Lernen; Records speichern Ausführungsmodell, Verkaufsquelle und größte Kursabweichung, Verkäufe ihre Quelle; neuer Kauf-Blocker PRICE_CONFLICT; Slippage-Formel begrenzt; Lern-Ansicht zeigt „Fürs Lernen ausgeschlossen“; Lern-Report-CSV mit den Spalten learnable, qualityFlags, execModel, exitSource; Ausführungsmodell 2 nur bei echtem Jupiter-Kauf, alte Verkäufe ohne gespeicherte Quelle gelten als `UNKNOWN` (Rug-Ausstiege damit ausgeschlossen); **PC-Bot** (`server/`): Kern unter Node.js, Datei-Speicher je `smartlab.v3.*`-Schlüssel (atomar), Sperrdatei gegen Doppelstart, tägliche Vollsicherung (14 Tage), größeres Lern-Gedächtnis (`PC_LEARN_CAPS`, 5000 statt 200 Records), Übergangs-Oberfläche nur auf 127.0.0.1 mit Host-Prüfung und Pflicht-Header, sauberes Beenden ohne Abbruch laufender Trades, Bestätigung des Abgleichs nach hartem Neustart in der Oberfläche, verwaiste Sperre nach PC-Neustart erkannt, Speicherfehler kürzen nie Daten, Journal bis 5000 Einträge, Logdateien 30 Tage, `--mock` schreibt nach `data-mock/`, `start-bot.bat`, npm-Skripte `bot` und `test:node`; Hinweis zum Voll-Backup korrigiert (ein eingetragener Jupiter-API-Key ist enthalten). **Migration:** einmalig Slippage neu berechnet (Ergebnisse unverändert), fehlende Angaben der Learning Records aus dem Journal ergänzt, Muster und Fehlsignale neu aus sauberen Records, Lektionen, Verlustmodell, Kalibrierung und Drift neu berechnet, Hypothesen (außer Shadow/übernommen) neu zu testen, bisherige Experimente als ungültig markiert; aktives Modell und Regeln bleiben. **Verhaltensänderungen:** Stops und Verkäufe anderer Positionen warten nicht mehr auf laufende Trades; Käufe mit stark widersprüchlichen Kursquellen werden blockiert; die Lern-KI lernt nur noch aus sauberen Trades. 3 neue Selbsttests (81), Selbsttests auch unter Node.js (eigener CI-Schritt), neue E2E-Suite `pcbot` (Oberfläche ohne Konsolen-/CSP-Fehler, Auto-Trading, Einstellungen-Import, Backup herunterladen und mit Neustart einspielen, API-Schutz über Header/Host/CSP, Sperre gegen zweiten Bot, Beenden speichert, Neustart behält Daten, verwaiste Sperre nach PC-Neustart, Abgleich bestätigen), damit 10 Suiten; Dokumentation `docs/PC-BETRIEB.md`, `docs/LERNDATEN.md` und `CLAUDE.md`.
- Roadmap Stufe B (2.11.0) – ehrliche Simulation: **B1** echte Jupiter-Kursangebote für Kauf und Verkauf (nur Abfrage), Rundreise-Prüfung beim Kauf mit neuen Blockern NO_SELL_ROUTE (Honeypot-Verdacht) und ROUND_TRIP_COST, echte Preisabweichung gegen die Slippage-Grenze, Rückfall auf AMM-Schätzung (markiert, abschaltbar), optionaler API-Key; **B2** Füllung nach einstellbarer Wartezeit (Standard 1,5 s) zum dann gültigen Angebot, Slippage-Grenze wie on-chain, 5 % gescheiterte Transaktionen (einstellbar), Gebühren auch beim Scheitern, Priority Fee automatisch aus dem Netzwerk, Positionen ohne Verkaufsweg mit 0 $ bewertet und nach 30 min abgeschrieben; **B3** Coin-Quelle als Lernmerkmal mit Auswertung „Coin-Quellen“ und Hypothese „Quelle meiden“. Monitor: TX_FAIL_RATE, QUOTES_ESTIMATED, Kennzahlen „Ausführung“; LIVE-Gate um „Ehrliche Ausführung“ erweitert; Profil „Lernmodus“ schaltet die Rundreise-Kostenprüfung aus (Honeypot-Schutz bleibt). Kleinkorrektur: Positionskarte zeigt „Buys x/∞“ bei unbegrenzten Käufen. **Verhaltensänderung:** Ergebnisse der Simulation werden realistischer und damit meist schlechter als vorher. 5 neue Selbsttests, E2E-Attrappen für Jupiter und Priority Fees, Lern- und UI-E2E erweitert; Browser-Tests mit Kauf setzen eine deterministische Ausführung (keine zufälligen Fehlschläge, Slippage-Grenze 10 %, weil die Mock-Preise bei jedem Abruf steigen), die Fehlschlag-Logik prüfen die Selbsttests.
- Roadmap A3 / Phase 8 (2.10.1): Sicherheitsprüfung (CSP, Escaping, Links, kein eval, keine Geheimnisse) ohne Befund bis auf das LIVE-Gate: Limits auf 0 = aus galten als „geprüft“ – jetzt müssen alle Risiko-Limits aktiv sein. Performance mit 400 Tokens unverändert (Scan 17–41 ms, Analyse 11–20 ms, Render 4–22 ms, 25 MB). Abschlussbericht und Release-Checkliste in `docs/ABSCHLUSSBERICHT.md`.
- Roadmap A2 / Phase 7 (2.10.0): Monitoring-Kennzahlen, Anomalie-Monitor mit Reason Codes und Aktionen (Standard nur warnen, einstellbar unter System → „Anomalie-Monitor: Reaktion“), Statusleiste mit Daten, Live-Gate und Monitor, Pill „Pos“ zeigt ∞ bei unbegrenzten Positionen. 3 neue Selbsttests, UI-E2E erweitert.
- Roadmap A1: Tests ins Repo (`tests/e2e/`, gemeinsames `env.js`, Runner `run-all.js`, Syntax-Prüfung), CI über GitHub Actions; XSS-Test mit echten Prüfungen statt reiner Ausgabe; Login-Test wartet auf das Ende der PBKDF2-Prüfung statt fester Zeiten.
- 2.9.0 (Nutzerwunsch): feste Grenzen (`HARD_LIMITS`) entfernt – Max. Käufe pro Coin, Coin-Cooldown, Verlustserie, Exposure, Positionsgröße, Min. Trades für Optimierung frei einstellbar; 0 = aus für Tageslimit, Drawdown-Modus/-Grenze, Overtrading (inkl. Bremse), max. Positionen, Korrelation, System-Health; neue Schalter: Nachkauf nur im Gewinn, Strategie-Cooldowns, marktweite Handelspause, automatischer Safe Mode; Profil „Lernmodus (ohne Limits)“ (nur Limits, Kauf-Filter unverändert); Risiko-Ansicht zeigt Limits als einstellbar. Standardwerte unverändert. Selbsttests angepasst + 1 neuer (Lernmodus), neuer E2E-Test für das Profil.
- 2.8.0 (Nutzerwunsch): Loss-Cooldown und globale Pause wieder 0 min (Standard und Untergrenze), einmalige Umstellung gespeicherter Werte inkl. Beenden laufender Pausen, protokolliert. **Verhaltensänderung:** nach Verlusten keine automatische Handelspause mehr. Selbsttest und Migrations-E2E angepasst.
- Phase 6 (2.7.0): Fehlerklassen & „erwartbarer Verlust?“ (geplanter Stop wird ab jetzt je Position gespeichert; ältere Verluste werden beim Laden ergänzt, Stop aus den aktuellen Einstellungen als gekennzeichnete Näherung), Near-Miss-Tracking mit Opportunity-Cost-Auswertung je Filter (ohne automatische Lockerung), Tabelle „Aktive Parameter“ mit Herkunft und Grund, naive Parameter-Suche des alten Auto-Tunings entfernt (Einstellung überwacht nur noch Versionen und rollt schlechtere zurück), Lern-Report-CSV um Fehlerklasse ergänzt. Login: Eingaben während der PBKDF2-Prüfung gesperrt (verhinderte, dass eine neue Eingabe beim Fehlschlag des vorherigen Versuchs gelöscht wurde). 4 neue Selbsttests.
- Phase 5 (2.6.0): Backtest reproduzierbar und versioniert (Run-ID aus Datensatz-Hash + Parametern + Code-Version), Walk-Forward immer aktiv, Stress-Tests inkl. Einstiegsverzögerung ohne Look-Ahead, Monte-Carlo-Drawdown, Auswertung je Regime, Trade-CSV-Export, Lauf-Historie (gespeichert, max. 20). 3 neue Selbsttests, neuer E2E-Test für den Backtest-Bericht.
- Phase 4 (2.5.0): Positions-Lebenszyklus mit Verlauf (Migration für bestehende Positionen, unterbrochene Verkäufe → Abgleich), Execution-Provider-Abstraktion mit Fehlercodes, Portfolio-Integrität (Positionen-Ansicht, Bot Health), stille Wallet-Wiederverbindung. 5 neue Selbsttests.
- Phase 3 (2.4.0): Score-Attribution & Kipp-Punkte, Signal-Konflikte, Zeitfenster-Abgleich, Signal-Decay, Regime VOL_SHOCK / LOW_QUALITY_MARKET, Drawdown-Modus/-Grenze, Risiko-Abschläge mit Reason Codes; einfache Ansicht mit Kurzbegründung „Warum …?“. **Verhaltensänderungen:** Auto-Käufe werden zusätzlich bei widersprüchlichen Signalen, hohem Drawdown und marktweit schlechter Datenlage verhindert; automatische Positionsgrößen können durch die Abschläge kleiner ausfallen; Ereignis-Signale verlieren nach 5 min an Stärke.
- Phase 2: Stufen-Scores und Security-Prüfbericht (Detail → Übersicht im Analyse-Modus bzw. Risiko & Security in beiden Modi); 3 Security-Selbsttests (Gate nicht kompensierbar, NO_DATA ≠ PASS, Stufen konsistent zur Entscheidung).
- Phase 1 (2.3.0): harte Untergrenzen Loss-Cooldown 10 min / globale Pause 5 min wiederhergestellt; `app.js` entfernt; Datenvalidierung mit Zählung je Quelle; Voll-Backup & geprüftes Wiederherstellen; Login mit PBKDF2, Fehlversuch-Sperre und gesperrten App-Aktionen; Randfall „Positionsgröße > Exposure“ behoben (durch Fuzz-Test gefunden); 3 neue Selbsttests, neue E2E-Tests für Backup und Login-Sperre.
