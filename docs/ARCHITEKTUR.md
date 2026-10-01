# Smart Lab – Architektur & technischer Audit

Stand: Roadmap-Stufe B „Ehrliche Simulation“ abgeschlossen (App-Version 2.11.0). Abschlussbericht: `docs/ABSCHLUSSBERICHT.md`.
Dieses Dokument wird in jeder Phase fortgeschrieben (siehe „Änderungsprotokoll“ am Ende).

## 1. Überblick

- **Auslieferung:** eine einzige statische Datei `index.html` (HTML + CSS + JavaScript in einer IIFE), veröffentlicht über GitHub Pages aus `main`. Keine Build-Pipeline, kein Server, keine Abhängigkeiten von Drittbibliotheken.
- **Laufzeit:** komplett im Browser. Alle Daten (Einstellungen, Positionen, Journal, Lerndaten) liegen im `localStorage` des jeweiligen Geräts.
- **Handel:** ausschließlich simuliert (SIMULATION / PAPER). LIVE ist bewusst nicht verfügbar (kein Swap-/Routing-Provider, Signieren deaktiviert). Seit 2.11.0 rechnet die Simulation mit echten Kursangeboten der Jupiter Quote API (nur Abfrage `GET /quote`, nie `/swap`), einer Wartezeit bis zur Füllung, gescheiterten Transaktionen und Priority Fees aus dem Netzwerk.
- `IMG_8763.png` ist ein Bild ohne Verwendung im Code.

## 2. Architektur (Textdiagramm)

```
Login-Gate (PBKDF2-SHA256, 600.000 Iterationen, Sperre nach 5 Fehlversuchen)
   │  erst nach Erfolg: startApp()
   ▼
createCore(env)  ── DOM-frei, alle Seiteneffekte über env (Uhr, fetch, Timer, Storage) → testbar
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
   ├─ Risk State (Buy-Zähler, Cooldowns, Verlustserie, Tageslimit, Overtrading)
   ├─ Lern-KI (Adaptive Loss Intelligence): Records → Ursachen → Muster → Hypothesen → Experimente
   │     → Challenger (Shadow) → Übernahme (nur SIMULATION) → Überwachung → Auto-Rollback
   ├─ Persistenz (createStorage): 10 getrennte Schlüssel smartlab.v3.*, Versionierung, Migration v1/v2,
   │     Reconciliation nach Neustart
   └─ Health/Diagnose (systemHealth, botHealth, readiness, diagnostics, liveReadiness)
   ▼
UI-Schicht (DOM): Views, Detail-Panel, Modals, Charts (Canvas), Toasts, Alarm-Feed
   einfache Ansicht ↔ Analyse-Daten (body.pro)
```

## 3. Module in `index.html` (Zeilen ca.)

| Bereich | Zeilen | Verantwortung |
|---|---|---|
| Login-Gate, CSS, HTML-Grundgerüst | 1–460 | Zugangssperre, Layout, Views als `<section>` |
| Konstanten, TUNING_BOUNDS | 469–509 | API-Adressen (inkl. Jupiter), Grenzen für Lern-/Tuning-Parameter (feste harte Grenzen seit 2.9.0 entfernt) |
| Utils, Formatierung | 510–696 | `num/nonNeg/int` (NaN/Infinity/negativ → null), Formatter, TA-Funktionen |
| Logger | 697–730 | Ringpuffer 1500 Einträge, Kategorien |
| Settings | 731–927 | Schema mit Min/Max, Profile, Validierung |
| Storage & Migration | 928–1022 | v3-Schlüssel, v2/v1-Migration, Korruptionserkennung, Speicher-knapp-Rotation |
| HTTP / Data Layer | 1023–1174 | siehe Diagramm; `okStatuses` für fachliche Fehlerantworten (z. B. „keine Route“) |
| Normalisierung + Security Engine | 1175–1355 | einheitliches Snapshot-Modell |
| Blocker-System | 1356–1428 | Codes, Prioritäten, Kategorien |
| Analyse-Engines | 1429–1754 | Kennzahlen, Confidence, Risk, Signale, Scores |
| Strategien & Konsens | 1755–1787 | 7 Strategien, Gewichte, Shadow |
| Decision Engine | 1788–1879 | Pipeline, Entscheidung, Trace, gelernte Regeln |
| Stufen-Scores & Security-Prüfbericht | 1880–2000 | erklärbare Stufen, Prüfbericht |
| Markt-Regime | 2001–2021 | Breadth, Volatilität, Trend, Richtung, Liquidität |
| Analytics / Backtest | 2022–2168 | perfStats, Backtest ohne Look-Ahead, Walk-Forward |
| Lern-KI (reine Funktionen) | 2169–2912 | Features (inkl. Coin-Quelle), Records, Attribution, Muster, Experimente, Drift, Modell |
| Core (createCore) | 2913–5552 | Scanner, Execution (Jupiter-Angebote, Wartezeit, Fehlschläge), Positionen, Risk, Lern-Orchestrierung, Persistenz |
| Testsystem | 5553–6694 | Mock-Harness (inkl. Jupiter-Attrappe), 78 Selbsttests |
| UI-Schicht | 6695–Ende | Views, Detail, Aktionen, Rendering |

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

- Jeder Schlüssel trägt `v: 3`; beschädigte Kernbereiche → RECONCILIATION REQUIRED (keine Käufe bis Bestätigung); beschädigte Lernbereiche → leere Defaults.
- Geschrieben wird nur, was sich geändert hat; bei vollem Speicher werden Logs/Stats/Journal/Lerndaten rotiert.
- Laufzeit-Migrationen: v1 → v2 → v3, Journal → Learning Records (2.2.0), Cooldowns unter 10/5 min → auf harte Untergrenze angehoben und im Config-Log vermerkt (2.3.0), gespeicherte Loss-Cooldown-/Pause-Werte aus Versionen vor 2.8.0 → einmalig 0 min, laufende Pause/Cooldown beendet, im Config-Log vermerkt (2.8.0).
- Voll-Backup: Export aller Bereiche; Wiederherstellen erst nach Prüfung (Kennung, Version, jeder Bereich) und Probe-Laden in einer isolierten Instanz, vorher automatische Sicherung des aktuellen Stands, danach Neustart mit Login.

## 5. Startfluss

1. `boot()`: nur Login-Formular aktiv, **kein** Core-Start.
2. Login erfolgreich → `startApp()` (einmalig): `core.init({ autoStart: true })` → Storage laden, validieren, migrieren, Reconciliation, Session, Parameter-Version, Tokens aus Positionen/Watchlist, Scanner-Start (Zustand RECOVERING bis Datenqualität reicht).
3. UI aufbauen (`loadUi`, `applyPro`, `buildNav`, …), Render-Schleife.
4. Scanner-Schleife (`scanOnce`, Standard 1 s, Lock gegen Parallel-Scans): Discovery → Pairs → Cross-Check → RPC-Ping → Analyse → Positionen verwalten → Lern-Nachlauf/Lernlauf → Alarme → Auto-Trading-Queue. Security-Prüfungen laufen in einer eigenen Warteschlange (1,5 s).

## 6. Bewertung je Bereich (Ist-Zustand)

| Bereich | Vorhanden | Lücken (Phase) |
|---|---|---|
| Datenebene | Rate-Limit, Backoff, Timeout, Dedupe, Cache mit TTL, Health je Quelle, Schema-Validierung, Stale-Erkennung, NaN/Infinity/negativ/unplausibel → null, Zählung ungültiger Felder & verworfener Datensätze je Quelle (System-Ansicht) | – |
| Scanner | Schnellfilter, Security-Queue, Priorisierung, Entscheidungskette je Token, Stufen-Scores Discovery → Datenqualität → Security → Markt → Handelsbereitschaft mit Teilbegründungen (`stageScores`) | – |
| Security | eigene Engine, CRITICAL blockiert immer (auch manuell), Stale-Security blockiert, Prüfbericht mit 14 Checks (Ergebnis, Schweregrad, Quelle, Zeitpunkt, Aktion aus den echten Blockern, `securityReport`), NO_DATA getrennt von PASS | Creator-/Wallet-Historie ohne Datenquelle (bleibt NO_DATA) |
| Signale | 12 Signaltypen, 7 Strategien, Konsens, Confidence getrennt vom Score, Score-Attribution (pro/contra/Abzüge = Final Score) mit Kipp-Punkten, Signal-Konflikt-Detektor (8 Muster, Gewicht ≥ 3 blockiert Auto-Käufe, abschaltbar), Multi-Timeframe-Abgleich 5m/1h/6h/24h, Signal-Decay für Ereignis-Signale | Kontextgewichtung nach Regime nur über gelernte Regeln |
| Risk | Limits (alle per Einstellung bis 0 = aus, Profil „Lernmodus (ohne Limits)“), Cooldowns, Exposure, Korrelation, Tageslimit, Overtrading, Impact-Grenze, Drawdown-Modus (×0,5 ab 10 %) & Drawdown-Grenze (keine Auto-Käufe ab 20 %), Abschläge mit Reason Codes (Datenalter, Execution-Unsicherheit, unbestätigte Daten, Cluster-Exposure), marktweite No-Trade-Zone bei schlechter Datenlage | – |
| Portfolio | Journal, realisiert/unrealisiert, Fees/Slippage, Reconciliation nach Neustart, Positions-Lebenszyklus PLANNED → PENDING → OPEN → CLOSING ↔ PARTIAL → CLOSED → RECONCILED (UNKNOWN = Abgleich), Integritätsprüfung (Mengen, Doppelbuchungen, Journal, hängende Orders, verwaiste Positionen) | Cash-Abgleich über mehrere „Frische Starts“ hinweg nicht rekonstruierbar |
| Execution | Order-State-Machine, Idempotenz-Keys, Locks, Pre-Trade-Check mit frischen Daten, Provider-Abstraktion Quote → Build → Preflight → Sign → Send → Confirm (SIMULATION vollständig, LIVE liefert NO_ROUTER / SIGNATURE_DISABLED), Fehlercodes je Order. Seit 2.11.0: echtes Jupiter-Angebot je Kauf und Verkauf (nur Abfrage), Rundreise-Prüfung beim Kauf (kein Verkaufsweg → NO_SELL_ROUTE, zu teuer → ROUND_TRIP_COST, 5 min je Coin gemerkt), Füllung erst nach einstellbarer Wartezeit zum dann gültigen Angebot, Slippage-Grenze (sonst SLIPPAGE_EXCEEDED), einstellbarer Anteil gescheiterter Transaktionen (TX_FAILED), Netzwerk- und Priority-Gebühr auch beim Scheitern, Priority Fee aus `getRecentPrioritizationFees` (75. Perzentil, fester Wert als Minimum), Position ohne Verkaufsweg zählt 0 $ und wird nach 30 min als Totalverlust abgeschrieben; ohne Jupiter Rückfall auf AMM-Schätzung (abschaltbar, als „geschätzt“ markiert) | echter Swap-/Routing-Provider fehlt (bewusst); kein Sandwich-/MEV-Modell; Jupiter-Kontingent des kostenlosen Zugangs begrenzt (lokal 50 Abfragen/min) |
| Wallet | nur lesend, Phantom (`window.phantom.solana`), Balance per RPC, Signieren deaktiviert, stille Wiederverbindung nur mit `onlyIfTrusted` (kein Popup) | – |
| Backtest | kein Look-Ahead, Stops vor TPs, Fees/Slippage, Walk-Forward Pflicht (Validierung/Test getrennt, OOS-Anteil ausgewiesen), Run-Protokoll mit Run-ID, Datensatz-Hash, Parametern, Kosten, Code-Version und Limitierungen, Stress-Tests (Gebühren/Slippage ×2, Einstieg 1 Kerze später, engerer Stop, niedrigerer TP), Monte-Carlo-Drawdown (deterministisch), Regime-Auswertung, Trade-CSV, Lauf-Historie (20) | Daten nur aus GeckoTerminal-OHLCV eines Pools (kein Survivorship-freier Universums-Test), keine Orderbuch-Simulation |
| Lernen | Learning Records, Ursachen mit Evidenz, Counterfactuals, Muster, Hypothesen → Experimente (Train/Validation/Test, Walk-Forward) → Shadow → Übernahme nur in SIMULATION, nur verschärfend, Auto-Rollback; Fehlerklassen (statistisch · Execution · Daten · Security · Modell · Prozess) mit Prüfung „erwartbarer Verlust?“ gegen den beim Einstieg geplanten Stop; Near-Miss-Tracking (15 min Nachlauf, verpasster Gewinn vs. vermiedener Verlust je Filter, reine Messung); Tabelle aktiver Parameter mit Herkunft/Grund; neue Parameter nur noch über die Lern-KI; seit 2.11.0 Coin-Quelle (Boost, Top-Boost, Profil, neue Pools, Trending, Watchlist) als Merkmal in Features, Mustern, Near-Misses und Exporten, Auswertung je Quelle, Hypothese „Quelle meiden“ (BLOCK_DISC, nur automatische Quellen, erst nach Test + Shadow wirksam) | Near-Miss-Ergebnisse sind simuliert (ohne Kosten); Herkunft nur für die letzten 200 Konfigurationsänderungen; Trades vor 2.11.0 ohne Quelle („unbekannt“) |
| Monitoring | System/Bot Health, API Health Center, Diagnose; Kennzahlen der letzten 60 min (Signale/Stunde, Security- und Risiko-Blockquote, Freigabequote, Orders, Erfolgsquote, Ø Ausführungszeit, Fehlercodes, Datenfrische, Zustand der Lern-KI); Anomalie-Monitor mit 14 Reason Codes (u. a. DATA_STALE_WIDE, PRIMARY_API_DOWN, EXEC_FAILURES, EXEC_SLOW, SLIPPAGE_SPIKE, TX_FAIL_RATE, QUOTES_ESTIMATED, RECONCILIATION, PORTFOLIO_INTEGRITY, LOSS_BURST, EQUITY_DROP, LEARNING_ERRORS, STORAGE_FAIL; simulierte Fehlschläge TX_FAILED/SLIPPAGE_EXCEEDED und NO_ROUTE zählen nicht als EXEC_FAILURES), Kennzahlen „Ausführung“ (Anteil echter Angebote, Fehlquote, bezahlte Gebühren gescheiterter Tx, aktuelle Priority Fee), Schweregrad und Aktion WARN / DEGRADE / PAUSE / HARD_STOP; Standard „nur warnen“, mit „handeln“ Größe ×0,5, Pause neuer Auto-Käufe (ANOMALY_PAUSE) bzw. einmaliger Not-Stopp; Alarm + Verlauf je Anomalie | Kennzahlen nur für die laufende Sitzung (nicht gespeichert) |
| UI | einfache/Analyse-Ansicht, „Warum?“-Tab, Entscheidungsketten, Statusleiste (Analyse-Ansicht) mit System, Daten, Wallet, Risiko, Live-Gate und Monitor; Monitor-Pill auch in der einfachen Ansicht, sobald eine Anomalie aktiv ist; Pills brechen auf dem Desktop um statt abgeschnitten zu werden | – |
| Login | PBKDF2 (600k), kein Klartext, kein Persistieren, Reload → neu anmelden, Sperre 30 s → 15 min nach je 5 Fehlversuchen, gesperrt keine App-Aktionen, Eingaben während der Prüfung gesperrt | bleibt clientseitig (kein Server) |

## 7. Sicherheitskritische Stellen

- Risiko-Limits: seit 2.9.0 keine festen Grenzen mehr – alle über `SETTINGS_SCHEMA` einstellbar (0 = aus), validiert auf gültige Bereiche. Die Lern-KI verändert sie nie. Nicht abschaltbar bleiben: Security-Blocker (CRITICAL, Prüfung ausstehend), Datenprüfungen (kein Preis, veraltete Daten, Gebühren unbekannt), Doppel-Order-Schutz, Abgleich nach Neustart, LIVE-Gating.
- `globalBlockers` / `execCheck` / `MANUAL_HARD`: letzte Prüfung vor jeder Order.
- `setMode('LIVE')` / `liveReadiness`: LIVE nie aktivierbar ohne Provider; seit 2.10.1 zusätzlich nur mit aktiven Risiko-Limits (kein Lernmodus); seit 2.11.0 zusätzlich nur mit echten Kursangeboten ohne Schätz-Rückfall, Honeypot-Schutz und aktiver Rundreise-Kostenprüfung (≤ 20 %).
- Jupiter: ausschließlich `GET /quote` (Selbsttest prüft, dass nie ein anderer Pfad aufgerufen wird); optionaler API-Key nur als Header `x-api-key`, lokal gespeichert (Passwortfeld, Format geprüft), Teil von Voll-Backups wie die RPC-URLs, aber nicht im Einstellungs-Export; im Konfigurations-Protokoll und Log-Export nur maskiert („••• (gesetzt)“).
- `requestSignature`: deaktiviert.
- Lern-KI: `mergeParams` (nur verschärfend), `sanitizeRules`, Übernahme nur SIMULATION.
- Login: Hash im Quelltext öffentlich sichtbar (GitHub Pages) → clientseitige Sperre, **kein** Server-Schutz. PBKDF2 macht Offline-Raten teuer, verhindert es aber nicht bei schwachen Passwörtern.
- CSP: `script-src 'unsafe-inline'` (nötig bei Einzeldatei), `connect-src https:`, keine externen Skripte.
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

- **78 Selbsttests** in der App (System → Selbsttest): Grundlagen, Trading-Limits, Daten/Stale, Security, Chaos (API-/RPC-Ausfall, 429, falsches JSON, Scanner-Lock, verspätete Antworten, Reload-Recovery), Status-Logik, LIVE-Gating, Storage, Backtest (Look-Ahead, Reproduzierbarkeit, Stress/Einstiegsverzögerung, Monte-Carlo/Regime), Portfolio & Execution, Signal & Risk, 11 Lern-KI-Tests, 4 Adaptive-KI-Tests (Fehlerklassen, Near-Misses, aktive Parameter, kein naives Tuning), 3 Monitoring-Tests (Anomalien & Modi, Not-Stopp, Kennzahlen), 5 Tests „Ehrliche Simulation“ (Jupiter-Angebote/Honeypot/Rundreise/Rückfall/API-Key, Wartezeit/Slippage-Grenze/gescheiterte Tx/Priority Fee, kein Verkaufsweg → Abschreibung, Fehlquote im Monitor, Coin-Quelle als Lernmerkmal). Die Test-Umgebung bildet Jupiter als Konstantprodukt-AMM nach; echte Jupiter-Antworten sind in der Cloud-Testumgebung nicht erreichbar.
- **Browser-E2E** (Playwright, `tests/e2e/`, seit Roadmap-Schritt A1 im Repo): Selbsttests, Login, UI einfach/Analyse inkl. Mobil, Lern-KI, Backup/Restore, Migration, Backtest-Bericht, Lernmodus-Profil, XSS-Schutz; `npm test` bzw. `node tests/e2e/run-all.js`.
- **CI** (GitHub Actions, `.github/workflows/tests.yml`): Syntax-Prüfung + alle Suiten bei jedem Push auf `main` und jedem PR. Ohne `E2E_USER`/`E2E_PASS` nutzen die Tests eine Testkopie der App mit zufälligem Wegwerf-Passwort – das echte Passwort steht nirgends im Repo und wird nicht als Secret gebraucht.
- **Lücken:** Monitoring-Aktionen (Phase 7), UI-Smoke für LIVE-Gate/Wallet.

## 10. Technische Schulden

- Eine sehr große Datei (bewusst beibehalten: einfache Auslieferung, geringes Risiko).

## 11. Bewusste Abweichungen / Entscheidungen

- Feste (harte) Grenzen: ab 2.9.0 auf Wunsch des Nutzers aufgehoben. Alle Risiko-Limits sind Einstellungen und können auf 0 = aus gestellt werden; Standardwerte unverändert. Gedacht für durchgehendes Lernen in SIMULATION; LIVE bleibt gesperrt.
- Loss-Cooldown / globale Pause: in Phase 1 auf harte Untergrenze 10 / 5 min gesetzt; ab 2.8.0 auf Wunsch des Nutzers wieder 0 min (Standard und Untergrenze, weiterhin einstellbar). Folge: nach Verlusten bzw. einer Verlustserie gibt es keine automatische Handelspause mehr – Verlustserien lösen nur noch einen Review-Hinweis aus. Tageslimit, Drawdown-Grenze, Overtrading-Schutz und Coin-Cooldown (15 min) bleiben unverändert.
- Einzeldatei bleibt; `app.js` wird gelöscht (Entscheidung Nutzer).
- Umsetzung phasenweise, jede Phase einzeln getestet und gemergt.

## Änderungsprotokoll

- Phase 0: Audit erstellt.
- Roadmap Stufe B (2.11.0) – ehrliche Simulation: **B1** echte Jupiter-Kursangebote für Kauf und Verkauf (nur Abfrage), Rundreise-Prüfung beim Kauf mit neuen Blockern NO_SELL_ROUTE (Honeypot-Verdacht) und ROUND_TRIP_COST, echte Preisabweichung gegen die Slippage-Grenze, Rückfall auf AMM-Schätzung (markiert, abschaltbar), optionaler API-Key; **B2** Füllung nach einstellbarer Wartezeit (Standard 1,5 s) zum dann gültigen Angebot, Slippage-Grenze wie on-chain, 5 % gescheiterte Transaktionen (einstellbar), Gebühren auch beim Scheitern, Priority Fee automatisch aus dem Netzwerk, Positionen ohne Verkaufsweg mit 0 $ bewertet und nach 30 min abgeschrieben; **B3** Coin-Quelle als Lernmerkmal mit Auswertung „Coin-Quellen“ und Hypothese „Quelle meiden“. Monitor: TX_FAIL_RATE, QUOTES_ESTIMATED, Kennzahlen „Ausführung“; LIVE-Gate um „Ehrliche Ausführung“ erweitert; Profil „Lernmodus“ schaltet die Rundreise-Kostenprüfung aus (Honeypot-Schutz bleibt). Kleinkorrektur: Positionskarte zeigt „Buys x/∞“ bei unbegrenzten Käufen. **Verhaltensänderung:** Ergebnisse der Simulation werden realistischer und damit meist schlechter als vorher. 5 neue Selbsttests, E2E-Attrappen für Jupiter und Priority Fees, Lern- und UI-E2E erweitert.
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
