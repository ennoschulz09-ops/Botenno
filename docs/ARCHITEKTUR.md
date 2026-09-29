# Smart Lab – Architektur & technischer Audit

Stand: Phase 1 des Master-Prompts „Ganzheitliche Optimierung“ (App-Version 2.3.0).
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
| Testsystem | 4606–5204 | Mock-Harness, 47 Selbsttests |
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
| Scanner | Schnellfilter, Security-Queue, Priorisierung, Entscheidungskette je Token | keine getrennten Stufen-Scores Discovery/Quality/Security/Market/Readiness (2) |
| Security | eigene Engine, CRITICAL blockiert immer (auch manuell), Stale-Security blockiert | kein strukturierter Prüfbericht je Check; „keine Daten“ und „kein Risiko“ nicht überall getrennt sichtbar (2) |
| Signale | 12 Signaltypen, 7 Strategien, Konsens, Confidence getrennt vom Score | keine Attribution pro/contra, kein Signal-Konflikt-Detektor, kein Multi-Timeframe-Abgleich, kein Signal-Alter (3) |
| Risk | harte Limits, Cooldowns, Exposure, Korrelation, Tageslimit, Overtrading, Impact-Grenze | kein Drawdown-Modus, keine Staleness-/Execution-Penalty mit Reason Codes (3) |
| Portfolio | Journal, realisiert/unrealisiert, Fees/Slippage, Reconciliation nach Neustart | Positionen nur OPEN/CLOSED statt Lebenszyklus (4) |
| Execution | Order-State-Machine, Idempotenz-Keys, Locks, Pre-Trade-Check mit frischen Daten | keine Provider-Abstraktion (Quote/Build/Simulate/Sign/Send/Confirm), keine Failure-Codes (4) |
| Wallet | nur lesend, Phantom/Solflare/Backpack, Balance per RPC, Signieren deaktiviert | Wiederverbindung nur manuell (4) |
| Backtest | kein Look-Ahead, Stops vor TPs, Walk-Forward, Fees/Slippage | kein Run-Protokoll/Versionen, keine Stress-/Regime-Auswertung, kein Trade-Export (5) |
| Lernen | vollständig seit 2.2.0 | Near-Misses/Opportunity Cost, Fehlerklassen nach PDF, Herkunft aktiver Parameter; altes naives Auto-Tuning ohne OOS-Nachweis (6) |
| Monitoring | System/Bot Health, API Health Center, Metriken, Diagnose | keine Anomalie-Erkennung mit Aktionen (warn/degrade/pause/stop), keine Block-/Erfolgsraten (7) |
| UI | einfache/Analyse-Ansicht, „Warum?“-Tab, Entscheidungsketten | Status-Leiste System/Data/Wallet/Risk/Live-Gate nur teilweise (7) |
| Login | PBKDF2 (600k), kein Klartext, kein Persistieren, Reload → neu anmelden, Sperre 30 s → 15 min nach je 5 Fehlversuchen, gesperrt keine App-Aktionen | bleibt clientseitig (kein Server) |

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

- **50 Selbsttests** in der App (System → Selbsttest): Grundlagen, Trading-Limits, Daten/Stale, Security, Chaos (API-/RPC-Ausfall, 429, falsches JSON, Scanner-Lock, verspätete Antworten, Reload-Recovery), Status-Logik, LIVE-Gating, Storage, Backtest-Look-Ahead, 11 Lern-KI-Tests.
- **Browser-E2E** (Playwright, außerhalb des Repos): Login, Cooldown-Migration, UI einfach/Analyse inkl. Mobil, Lern-KI.
- **Lücken:** Property-/Grenzwert-Tests für harte Limits und Positionsgröße, Positions-Lebenszyklus, Execution-Provider, Monitoring-Aktionen, Backtest-Reproduzierbarkeit, UI-Smoke für LIVE-Gate/Wallet/Diagnose.

## 10. Technische Schulden

- Eine sehr große Datei (bewusst beibehalten: einfache Auslieferung, geringes Risiko).
- Altes Auto-Tuning (`maybeTune`) wählt Parameter ohne Out-of-Sample-Nachweis, wenn die Lern-KI aus ist.

## 11. Bewusste Abweichungen / Entscheidungen

- Loss-Cooldown / globale Pause: ab Phase 1 wieder harte Untergrenze 10 / 5 min (Entscheidung Nutzer, 2026-09-29).
- Einzeldatei bleibt; `app.js` wird gelöscht (Entscheidung Nutzer).
- Umsetzung phasenweise, jede Phase einzeln getestet und gemergt.

## Änderungsprotokoll

- Phase 0: Audit erstellt.
- Phase 1 (2.3.0): harte Untergrenzen Loss-Cooldown 10 min / globale Pause 5 min wiederhergestellt; `app.js` entfernt; Datenvalidierung mit Zählung je Quelle; Voll-Backup & geprüftes Wiederherstellen; Login mit PBKDF2, Fehlversuch-Sperre und gesperrten App-Aktionen; Randfall „Positionsgröße > Exposure“ behoben (durch Fuzz-Test gefunden); 3 neue Selbsttests, neue E2E-Tests für Backup und Login-Sperre.
