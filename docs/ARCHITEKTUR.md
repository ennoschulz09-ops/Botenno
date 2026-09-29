# Smart Lab – Architektur & technischer Audit

Stand: Phase 6 des Master-Prompts „Ganzheitliche Optimierung“ (App-Version 2.7.0).
Dieses Dokument wird in jeder Phase fortgeschrieben (siehe „Änderungsprotokoll“ am Ende).

## 1. Überblick

- **Auslieferung:** eine einzige statische Datei `index.html` (HTML + CSS + JavaScript in einer IIFE), veröffentlicht über GitHub Pages aus `main`. Keine Build-Pipeline, kein Server, keine Abhängigkeiten von Drittbibliotheken.
- **Laufzeit:** komplett im Browser. Alle Daten (Einstellungen, Positionen, Journal, Lerndaten) liegen im `localStorage` des jeweiligen Geräts.
- **Handel:** ausschließlich simuliert (SIMULATION / PAPER). LIVE ist bewusst nicht verfügbar (kein Swap-/Routing-Provider, Signieren deaktiviert).
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
   ├─ Execution Check (globalBlockers, execCheck, sizePosition) – harte Limits, Cooldowns, Exposure, Impact
   ├─ Orders (State Machine DETECTED → … → COMPLETED/FAILED/CANCELLED/REJECTED, Idempotenz-Keys, Locks)
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
| Login-Gate, CSS, HTML-Grundgerüst | 1–457 | Zugangssperre, Layout, Views als `<section>` |
| Konstanten, HARD_LIMITS, TUNING_BOUNDS | 466–505 | Sicherheitsgrenzen (eingefroren) |
| Utils, Formatierung | 506–692 | `num/nonNeg/int` (NaN/Infinity/negativ → null), Formatter, TA-Funktionen |
| Logger | 693–726 | Ringpuffer 1500 Einträge, Kategorien |
| Settings | 727–909 | Schema mit Min/Max, `hard`-Grenzen, Profile, Validierung |
| Storage & Migration | 910–1004 | v3-Schlüssel, v2/v1-Migration, Korruptionserkennung, Speicher-knapp-Rotation |
| HTTP / Data Layer | 1005–1155 | siehe Diagramm |
| Normalisierung + Security Engine | 1156–1315 | einheitliches Snapshot-Modell |
| Blocker-System | 1316–1381 | Codes, Prioritäten, Kategorien |
| Analyse-Engines | 1382–1635 | Kennzahlen, Confidence, Risk, Signale, Scores |
| Strategien & Konsens | 1636–1668 | 7 Strategien, Gewichte, Shadow |
| Decision Engine | 1669–1754 | Pipeline, Entscheidung, Trace |
| Markt-Regime | 1755–1770 | Breadth, Volatilität, Trend, Richtung, Liquidität |
| Analytics / Backtest | 1771–1864 | perfStats, Backtest ohne Look-Ahead, Walk-Forward |
| Lern-KI (reine Funktionen) | 1865–2468 | Features, Records, Attribution, Muster, Experimente, Drift, Modell |
| Core (createCore) | 2469–4605 | Scanner, Execution, Positionen, Risk, Lern-Orchestrierung, Persistenz |
| Testsystem | (Ende des Skripts) | Mock-Harness, 69 Selbsttests |
| UI-Schicht | 5205–Ende | Views, Detail, Aktionen, Rendering |

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
- Laufzeit-Migrationen: v1 → v2 → v3, Journal → Learning Records (2.2.0), Cooldowns unter 10/5 min → auf harte Untergrenze angehoben und im Config-Log vermerkt (2.3.0).
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
| Risk | harte Limits, Cooldowns, Exposure, Korrelation, Tageslimit, Overtrading, Impact-Grenze, Drawdown-Modus (×0,5 ab 10 %) & Drawdown-Grenze (keine Auto-Käufe ab 20 %), Abschläge mit Reason Codes (Datenalter, Execution-Unsicherheit, unbestätigte Daten, Cluster-Exposure), marktweite No-Trade-Zone bei schlechter Datenlage | – |
| Portfolio | Journal, realisiert/unrealisiert, Fees/Slippage, Reconciliation nach Neustart, Positions-Lebenszyklus PLANNED → PENDING → OPEN → CLOSING ↔ PARTIAL → CLOSED → RECONCILED (UNKNOWN = Abgleich), Integritätsprüfung (Mengen, Doppelbuchungen, Journal, hängende Orders, verwaiste Positionen) | Cash-Abgleich über mehrere „Frische Starts“ hinweg nicht rekonstruierbar |
| Execution | Order-State-Machine, Idempotenz-Keys, Locks, Pre-Trade-Check mit frischen Daten, Provider-Abstraktion Quote → Build → Preflight → Sign → Send → Confirm (SIMULATION vollständig, LIVE liefert NO_ROUTER / SIGNATURE_DISABLED), Fehlercodes je Order | echter Swap-/Routing-Provider fehlt (bewusst) |
| Wallet | nur lesend, Phantom (`window.phantom.solana`), Balance per RPC, Signieren deaktiviert, stille Wiederverbindung nur mit `onlyIfTrusted` (kein Popup) | – |
| Backtest | kein Look-Ahead, Stops vor TPs, Fees/Slippage, Walk-Forward Pflicht (Validierung/Test getrennt, OOS-Anteil ausgewiesen), Run-Protokoll mit Run-ID, Datensatz-Hash, Parametern, Kosten, Code-Version und Limitierungen, Stress-Tests (Gebühren/Slippage ×2, Einstieg 1 Kerze später, engerer Stop, niedrigerer TP), Monte-Carlo-Drawdown (deterministisch), Regime-Auswertung, Trade-CSV, Lauf-Historie (20) | Daten nur aus GeckoTerminal-OHLCV eines Pools (kein Survivorship-freier Universums-Test), keine Orderbuch-Simulation |
| Lernen | Learning Records, Ursachen mit Evidenz, Counterfactuals, Muster, Hypothesen → Experimente (Train/Validation/Test, Walk-Forward) → Shadow → Übernahme nur in SIMULATION, nur verschärfend, Auto-Rollback; Fehlerklassen (statistisch · Execution · Daten · Security · Modell · Prozess) mit Prüfung „erwartbarer Verlust?“ gegen den beim Einstieg geplanten Stop; Near-Miss-Tracking (15 min Nachlauf, verpasster Gewinn vs. vermiedener Verlust je Filter, reine Messung); Tabelle aktiver Parameter mit Herkunft/Grund; neue Parameter nur noch über die Lern-KI | Near-Miss-Ergebnisse sind simuliert (ohne Kosten); Herkunft nur für die letzten 200 Konfigurationsänderungen |
| Monitoring | System/Bot Health, API Health Center, Metriken, Diagnose | keine Anomalie-Erkennung mit Aktionen (warn/degrade/pause/stop), keine Block-/Erfolgsraten (7) |
| UI | einfache/Analyse-Ansicht, „Warum?“-Tab, Entscheidungsketten | Status-Leiste System/Data/Wallet/Risk/Live-Gate nur teilweise (7) |
| Login | PBKDF2 (600k), kein Klartext, kein Persistieren, Reload → neu anmelden, Sperre 30 s → 15 min nach je 5 Fehlversuchen, gesperrt keine App-Aktionen, Eingaben während der Prüfung gesperrt | bleibt clientseitig (kein Server) |

## 7. Sicherheitskritische Stellen

- `HARD_LIMITS` (eingefroren) + `SETTINGS_SCHEMA` mit `hard`-Grenzen: nur verschärfbar.
- `globalBlockers` / `execCheck` / `MANUAL_HARD`: letzte Prüfung vor jeder Order.
- `setMode('LIVE')` / `liveReadiness`: LIVE nie aktivierbar ohne Provider.
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

- **69 Selbsttests** in der App (System → Selbsttest): Grundlagen, Trading-Limits, Daten/Stale, Security, Chaos (API-/RPC-Ausfall, 429, falsches JSON, Scanner-Lock, verspätete Antworten, Reload-Recovery), Status-Logik, LIVE-Gating, Storage, Backtest (Look-Ahead, Reproduzierbarkeit, Stress/Einstiegsverzögerung, Monte-Carlo/Regime), Portfolio & Execution, Signal & Risk, 11 Lern-KI-Tests, 4 Adaptive-KI-Tests (Fehlerklassen, Near-Misses, aktive Parameter, kein naives Tuning).
- **Browser-E2E** (Playwright, außerhalb des Repos): Login, Cooldown-Migration, UI einfach/Analyse inkl. Mobil, Lern-KI, Backup/Restore, Backtest-Bericht, XSS-Smoke.
- **Lücken:** Monitoring-Aktionen (Phase 7), UI-Smoke für LIVE-Gate/Wallet.

## 10. Technische Schulden

- Eine sehr große Datei (bewusst beibehalten: einfache Auslieferung, geringes Risiko).

## 11. Bewusste Abweichungen / Entscheidungen

- Loss-Cooldown / globale Pause: ab Phase 1 wieder harte Untergrenze 10 / 5 min (Entscheidung Nutzer, 2026-09-29).
- Einzeldatei bleibt; `app.js` wird gelöscht (Entscheidung Nutzer).
- Umsetzung phasenweise, jede Phase einzeln getestet und gemergt.

## Änderungsprotokoll

- Phase 0: Audit erstellt.
- Phase 6 (2.7.0): Fehlerklassen & „erwartbarer Verlust?“ (geplanter Stop wird ab jetzt je Position gespeichert; ältere Verluste werden beim Laden ergänzt, Stop aus den aktuellen Einstellungen als gekennzeichnete Näherung), Near-Miss-Tracking mit Opportunity-Cost-Auswertung je Filter (ohne automatische Lockerung), Tabelle „Aktive Parameter“ mit Herkunft und Grund, naive Parameter-Suche des alten Auto-Tunings entfernt (Einstellung überwacht nur noch Versionen und rollt schlechtere zurück), Lern-Report-CSV um Fehlerklasse ergänzt. Login: Eingaben während der PBKDF2-Prüfung gesperrt (verhinderte, dass eine neue Eingabe beim Fehlschlag des vorherigen Versuchs gelöscht wurde). 4 neue Selbsttests.
- Phase 5 (2.6.0): Backtest reproduzierbar und versioniert (Run-ID aus Datensatz-Hash + Parametern + Code-Version), Walk-Forward immer aktiv, Stress-Tests inkl. Einstiegsverzögerung ohne Look-Ahead, Monte-Carlo-Drawdown, Auswertung je Regime, Trade-CSV-Export, Lauf-Historie (gespeichert, max. 20). 3 neue Selbsttests, neuer E2E-Test für den Backtest-Bericht.
- Phase 4 (2.5.0): Positions-Lebenszyklus mit Verlauf (Migration für bestehende Positionen, unterbrochene Verkäufe → Abgleich), Execution-Provider-Abstraktion mit Fehlercodes, Portfolio-Integrität (Positionen-Ansicht, Bot Health), stille Wallet-Wiederverbindung. 5 neue Selbsttests.
- Phase 3 (2.4.0): Score-Attribution & Kipp-Punkte, Signal-Konflikte, Zeitfenster-Abgleich, Signal-Decay, Regime VOL_SHOCK / LOW_QUALITY_MARKET, Drawdown-Modus/-Grenze, Risiko-Abschläge mit Reason Codes; einfache Ansicht mit Kurzbegründung „Warum …?“. **Verhaltensänderungen:** Auto-Käufe werden zusätzlich bei widersprüchlichen Signalen, hohem Drawdown und marktweit schlechter Datenlage verhindert; automatische Positionsgrößen können durch die Abschläge kleiner ausfallen; Ereignis-Signale verlieren nach 5 min an Stärke.
- Phase 2: Stufen-Scores und Security-Prüfbericht (Detail → Übersicht im Analyse-Modus bzw. Risiko & Security in beiden Modi); 3 Security-Selbsttests (Gate nicht kompensierbar, NO_DATA ≠ PASS, Stufen konsistent zur Entscheidung).
- Phase 1 (2.3.0): harte Untergrenzen Loss-Cooldown 10 min / globale Pause 5 min wiederhergestellt; `app.js` entfernt; Datenvalidierung mit Zählung je Quelle; Voll-Backup & geprüftes Wiederherstellen; Login mit PBKDF2, Fehlversuch-Sperre und gesperrten App-Aktionen; Randfall „Positionsgröße > Exposure“ behoben (durch Fuzz-Test gefunden); 3 neue Selbsttests, neue E2E-Tests für Backup und Login-Sperre.
