# Strategie: Ziel, Stand, Weg

Stand: 2026-10-02 · App-Version 2.12.0. Dieses Dokument ist der Kontext für jede Weiterentwicklung. Wer Code schreibt, prüft
die Änderung gegen die Leitplanken in Abschnitt 8. Technische Details: `docs/ARCHITEKTUR.md`, Lerndaten: `docs/LERNDATEN.md`.

## 1. Endziel

Ein Bot, der nach allen Kosten **dauerhaft ein positives Gesamtergebnis** erzielt, belegt durch Messung und nicht durch
Einzelerfolge. Erst danach folgt ein vorsichtiger Schritt Richtung Echtgeld (Stufe E der Roadmap). Bis dahin bleiben LIVE und
Signieren technisch gesperrt.

**Zielarchitektur (Vorgabe Nutzer): Der Datensammler speist die Daten, die KI speist die Strategien.**

```
            ┌──────────────────────────── Feedback (Ergebnisse, Learning Records) ───────────────────────────┐
            ▼                                                                                                 │
   ┌─────────────────┐   Strategien/Parameter,   ┌───────────────────────────────────────────┐               │
   │       KI        │   Kapital je Sub-Bot      │  Sub-Bots (virtuelle Portfolios)           │               │
   │ erzeugt, wählt, │ ────────────────────────▶ │  Sub-Bot 1 · Sub-Bot 2 · … · Kontrollgruppe│ ──────────────┘
   │ verteilt, zieht │                           │  handeln simuliert auf denselben Daten     │
   │ Verlierer ab    │                           └───────────────────────────────────────────┘
   └─────────────────┘                                              ▲
            ▲                                                       │ dieselben Daten für alle
            │ Labels aller Kandidaten, Aufzeichnung                 │
   ┌─────────────────────────────────────────────────────────────────────────────────────┐
   │ Datensammler: Echtzeit-Feeds, Blockchain-Merkmale, Kerzen, Querprüfung, Aufzeichnung │
   └─────────────────────────────────────────────────────────────────────────────────────┘
```

- **Datensammler:** holt die Marktdaten einmal für alle, prüft sie gegeneinander, zeichnet jede Momentaufnahme auf und
  schreibt für jeden Kandidaten nachträglich ein Label (was wäre nach Kosten passiert).
- **KI:** erzeugt Strategie-Varianten und Parameter (inkl. Kontext wie Tageszeit und Marktphase als Merkmale), wählt aus,
  verteilt sie an die Sub-Bots, verteilt das Kapital zwischen ihnen (Bandit-Verfahren mit Vergessen alter Ergebnisse) und
  zieht Verlierer ab. Ein Meta-Labeling-Modell (Abschnitt 4) ist ein Baustein der KI.
- **Sub-Bots:** virtuelle Portfolios in einem Prozess auf denselben Daten, jeder mit seiner Strategie. Eine Kontrollgruppe
  mit Standardwerten läuft immer mit. Ergebnisse fließen als Learning Records zurück an die KI (Feedback-Loop).

Das deckt sich mit der Roadmap: C2 (Datensammler), C3 (Replay-Backtest), C4 (Varianten), C5 (zentrale Lern-KI), D1–D6.

## 2. Bewertung des Stands (2.12.0)

| Bereich | Bewertung | Begründung |
|---|---|---|
| Sicherheit & Fundament | stark | LIVE gesperrt, 81 Selbsttests, 10 E2E-Suiten, CI bei jedem PR, Backups, PC-Betrieb |
| Ehrliche Messung | gut | echte Jupiter-Angebote, Wartezeit, gescheiterte Transaktionen, Gebühren (2.11.0); verzerrte Trades fürs Lernen ausgeschlossen (2.12.0) |
| Lern-Logik | solide, noch keine „KI“ | Statistik mit Schutz vor Überanpassung (Train/Validation/Test, Walk-Forward, Shadow, nur verschärfend, Rollback); für die Datenmenge angemessen |
| Datenmenge | schwach | 35 saubere von 100 gespeicherten Trades; belastbare Aussagen brauchen Hunderte bis Tausende |
| Datenquellen | schwach | Polling; DexScreener-Boosts sind bezahlte Werbung (Negativauslese); Grenzen je Minute: DexScreener Discovery 50, Pairs 240, GeckoTerminal 25, RugCheck 20, Jupiter 50, öffentliches RPC 60 (`js/core.js`); keine Echtzeit, keine Wallet-/Halter-Analyse, Kerzen nur für offene Positionen |
| Nachweis von Gewinn | keiner | in früheren Daten fiel das Sim-Kapital von 1.000 $ auf rund 220 $ (teils durch verzerrte Trades); Stops endeten im Median bei −20 % statt der geplanten −15 % |

**Gesamturteil:** Die Reihenfolge war richtig (erst ehrlich messen, dann optimieren). Das Fundament steht – etwa ein Drittel
des Weges bis zur belastbaren Antwort „profitabel ja oder nein“. Der schwierige Teil beginnt jetzt: einen echten Vorteil
finden. Ab jetzt haben Daten und Nachweis Vorrang vor Oberfläche und Komfort.

## 3. Daten: Rate und Qualität

**Schneller**
- Echtzeit statt Polling: neue Pools (Pump.fun, PumpSwap, Raydium, Meteora) direkt aus der Blockchain per Websocket über
  einen RPC-Anbieter (z. B. Helius, QuickNode, Triton; Gratis-Stufen knapp, sinnvoll ab grob 50 $/Monat – Preise vorher
  prüfen). Größter Hebel.
- Spezial-Feeds für Memecoins (z. B. PumpPortal, Birdeye, Codex, SolanaTracker): teils kostenpflichtig, Abhängigkeit beachten.
- Bündeln (DexScreener bis zu 30 Adressen je Abfrage), Cache, ein zentraler Datensammler statt Abfragen je Bot.

**Besser**
- Eigene Blockchain-Merkmale: Halter-Verteilung (Top-10-Anteil), Dev-Wallet, gebündelte Käufe im ersten Block, Sniper-Anteil,
  LP gelockt/verbrannt, Mint-/Freeze-Rechte, Käufer/Verkäufer je Minute, eindeutige Käufer.
- Eigene Kerzen aus dem Trade-Strom für alle Kandidaten.
- Querprüfung der Quellen (PRICE_CONFLICT ist der Anfang), Datenalter je Wert.
- Alles aufzeichnen: Grundlage für Replay (C3) und Training.

**Mehr Lerndaten ohne mehr Trades (wichtigster Punkt)**
- Jeden gescannten Kandidaten labeln: Was wäre nach Kosten passiert, z. B. „+30 % vor −15 % innerhalb von 30 min“
  (Triple-Barrier-Labeling). Aus Dutzenden Trades werden Zehntausende Beispiele. Das Near-Miss-Tracking ist der Anfang.

**Speicher:** SQLite oder Parquet, sobald Aufzeichnungen dazukommen (JSON-Dateien reichen dafür nicht).

## 4. KI-Ansatz

- **Modelltyp:** Für tabellarische Marktdaten sind Entscheidungsbaum-Modelle (LightGBM, XGBoost) Stand der Technik; sie
  schlagen dort meist neuronale Netze und Sprachmodelle. Wenige Merkmale, starke Regularisierung, Kalibrierung.
- **Meta-Labeling:** Die Strategie schlägt einen Kauf vor, das Modell entscheidet Ja/Nein und die Größe.
- **Training offline in Python** aus dem Backup-/Record-Format (`docs/LERNDATEN.md`), nur `learnable` Records und
  Kandidaten-Labels; das fertige Modell wird für die Entscheidung in den Node-Bot geladen (z. B. als Bäume in JSON oder ONNX).
- **Vorlagen nur als Ideengeber:** Freqtrade/FreqAI (gutes ML-Trading-Framework, aber für Börsen wie Binance, nicht für
  Solana-Memecoins), FinRL/TensorTrade (Reinforcement Learning, braucht sehr viele Daten, bei Memecoins stark
  überanpassungsgefährdet), Qlib (Aktienforschung). Keine Vorlage passt direkt.
- **Sprachmodelle** als Forschungsassistent: Hypothesen, Auswertungen, Code. Nicht als Kursvorhersage im
  Live-Betrieb.

## 5. Sub-Bots und Feedback-Loop: Schutz vor Selbsttäuschung

- Bei vielen Varianten sieht immer eine zufällig profitabel aus (Mehrfachtest-Problem). Vor jeder Übernahme: zurückgehaltene
  Daten (Holdout, nie zum Optimieren benutzt), Walk-Forward, Mindestanzahl Trades, korrigierte Kennzahlen, Vorwärtstest,
  Vergleich mit der Kontrollgruppe.
- Tageszeit, Marktphase und ähnliche Faktoren als **Merkmale** ins Modell bzw. in die Strategie-Zuteilung, nicht je ein
  eigener Bot – sonst hat jeder zu wenig Daten.
- Feedback-Loop-Risiken: Überanpassung an die letzte Woche, wechselnde Marktphasen, Lücke zwischen Simulation und Realität.
  Gegenmittel: Vergessen mit Maß, Drift-Erkennung (vorhanden), Kontrollgruppe, Vorwärtstests.

## 6. Ergänzungen (bisher nicht eingeplant)

- **Erfolgskriterien vorab** (Vorschlag): ≥ 500 saubere Trades; Erwartungswert nach allen Kosten mit 95 % Sicherheit > 0;
  maximaler Drawdown < 25 %; 4 Wochen Vorwärtstest stabil, in mindestens 3 von 4 Wochen positiv.
- **Abbruch-/Schwenk-Kriterium:** Ist nach etwa 8–12 Wochen sauberer Daten kein Vorteil messbar, Markt wechseln (z. B.
  größere Solana-Coins oder Börsen-Futures, wo Daten besser und Rugs seltener sind).
- **Lücke Simulation ↔ Echtgeld:** Sandwich/MEV, nicht landende Transaktionen, Slippage bei echter Größe – nur mit
  Mini-Beträgen messbar (E2/E4).
- **Tempo und Wettbewerb:** Profi-Sniper sind Millisekunden schnell, ein Laptop nie. Strategien wählen, bei denen Tempo
  nicht entscheidet (zweite Welle, Rug-Vermeidung, Exits).
- **Kapazität:** Vorteile bei Memecoins tragen nur kleine Beträge.
- **Laufende Kosten** (APIs, RPC, Server) müssen vom Gewinn gedeckt sein.
- **Steuern (DE):** jeder Swap ist ein steuerlicher Vorgang; Gewinne bei Haltedauer unter einem Jahr steuerpflichtig (E5).
- **Echtgeld-Sicherheit:** getrennte Signier-Komponente, feste Limits, Wallet nur mit Spielgeld (E1, E3, E4).
- **24/7-Betrieb:** Laptop schläft, WLAN fällt aus → für den Datensammler früh einen kleinen Server einplanen; Alarme aufs Handy.
- **Versionierung:** welches Modell, welche Merkmale, welche Daten zu welcher Entscheidung führten (Modell-Register und
  `FEATURE_VERSION` sind der Anfang).

## 7. Realismus und Hebel für die Erfolgsquote

**Einschätzung:** Die meisten Memecoin-Bots verlieren Geld; der Markt ist feindlich (Rugs, Insider, Sniper, MEV). Chance auf
einen kleinen, echten, dauerhaften Vorteil grob 10–20 %, auf nennenswerte skalierbare Gewinne deutlich weniger. Das Projekt
lohnt sich trotzdem (Können, Infrastruktur), und die Quote lässt sich erhöhen:

1. **Vorteil durch Nicht-Verlieren:** Rugs, Honeypots und Dumps zuverlässig meiden ist leichter lernbar als Pumps vorhersagen.
2. **Alle Kandidaten labeln** (etwa 100-mal mehr Lerndaten).
3. **Exits optimieren** (D3): Stops rutschen heute; MFE/MAE-Daten liegen vor.
4. **Kostenfilter** (D2): nur kaufen, wenn die erwartete Bewegung die Rundreise-Kosten klar übersteigt.
5. **Disziplin:** wenige, vorher festgelegte Hypothesen; einfache Modelle; Holdout nie anfassen; Kontrollgruppe; Vorwärtstests.
6. **Echtgeld klein und spät:** zuerst nur die Lücke zwischen Simulation und Realität messen.

**Phasen:** Daten (Echtzeit, Blockchain-Merkmale, Aufzeichnung, Kandidaten-Labels, SQLite) → Messen (Replay der echten Logik,
Kontrollgruppe) → Modell (Meta-Labeling, Python-Training, strikte Validierung) → Varianten, Bandit, Feedback-Loop →
Mini-Echtgeld nach den Gates der Stufe E.

## 8. Leitplanken für jeden Code

Jede Änderung soll den Weg zum Endziel ebnen, nicht verbauen:

- **Messbar:** alles mit Zeitstempel, Quelle und Datenalter speichern; Merkmale versioniert (`FEATURE_VERSION`); neue
  Merkmale auch in Learning Records und Exporte.
- **Wiederholbar:** der Kern bleibt deterministisch und mit aufgezeichneten Daten erneut abspielbar (Seiteneffekte nur über
  `env` und das Speicher-Backend, keine versteckte Zeit- oder Zufallsquelle).
- **Getrennt:** Daten sammeln, entscheiden und ausführen sind getrennte Schichten; eine Datenquelle kann später vom
  Datensammler kommen, ohne dass Entscheidung oder Ausführung sich ändern.
- **Austauschbar:** Strategien und Parameter als Einheiten, die die KI erzeugen, zuteilen und abziehen kann; mehrere
  Portfolios auf denselben Daten müssen möglich bleiben (kein globaler Einzel-Portfolio-Zwang in neuem Code).
- **Ehrlich:** Kosten (Gebühren, Slippage, Priority Fee, gescheiterte Transaktionen) überall eingerechnet; nur `learnable`
  Daten fürs Lernen; Kandidaten-Labels und Near-Misses mitschreiben, nicht nur ausgeführte Trades.
- **Geprüft:** keine Verbesserung ohne Messung gegen Kontrollgruppe bzw. Holdout; Selbsttest für jede neue Regel.
- **Getrennt von Echtgeld:** Simulation und Echtgeld strikt getrennt; LIVE und Signieren bleiben gesperrt, bis die Gates der
  Stufe E erfüllt und vom Nutzer freigegeben sind.
- **Portabel:** Daten im gemeinsamen Backup-Format (Browser = PC = Server), Rohdaten nie löschen, Abgeleitetes neu aufbaubar.
