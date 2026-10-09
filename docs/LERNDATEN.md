# Smart Lab – Lerndaten: Übertragbarkeit und Datenqualität

Stand: App-Version 2.13.0. Betrieb auf dem PC: `docs/PC-BETRIEB.md`, Architektur: `docs/ARCHITEKTUR.md`.

Dieses Dokument beschreibt, wie die Lerndaten gespeichert und zwischen Browser, PC und einem späteren Server übertragen werden, welche Trades seit 2.12.0 vom Lernen ausgeschlossen sind und worauf künftige Modelle achten müssen. Seit 2.13.0 schreibt der PC-Bot zusätzlich für jeden gescannten Coin einen Kandidaten-Datensatz mit Label nach Kosten (Abschnitt 9).

## 1. Ein Format für Browser, PC und Server

- Alle Daten liegen in 10 Speicherbereichen `smartlab.v3.*` (`settings`, `runtime`, `positions`, `trades`, `logs`, `stats`, `learning`, `experiments`, `models`, `patterns`), jeweils als JSON-Text mit `v: 3`.
- **Browser:** je Bereich ein Eintrag im `localStorage` (zusammen höchstens etwa 5 MB).
- **PC** (`server/bot.js`): je Bereich eine Datei `data/<Schlüssel>.json` mit genau demselben Inhalt (`server/store.js`). Kein 5-MB-Limit.
- **Server** (Roadmap C): soll dieselben Bereiche und dasselbe Backup-Format übernehmen.
- **Voll-Backup:** eine Datei `{ app, storageVersion: 3, exportedAt, kind: "backup", storage: { <Bereich>: … } }`. Identisch, ob es aus dem Browser („⬇ Voll-Backup (alle Daten)“), aus der PC-Oberfläche („⬇ Voll-Backup herunterladen“) oder aus der täglichen Sicherung des PC-Bots (`data/backups/`) stammt.
- **Einspielen:** Kennung und Speicherversion werden geprüft, die App-Version der Sicherung darf nicht neuer sein als die installierte, jeder Bereich wird geprüft und das Ganze zuerst in einer isolierten Instanz probeweise geladen. Erst dann wird geschrieben.
- Das Backup enthält die Einstellungen inklusive selbst eingetragener RPC-Adressen und eines eventuell eingetragenen Jupiter-API-Keys. Es ist deshalb vertraulich. Der Einstellungs-Export („Settings JSON“) enthält den Key nicht.
- **Nicht im Voll-Backup:** die Kandidaten-Datensätze des PC-Bots (`data/candidates/*.jsonl`, seit 2.13.0) – wegen ihrer Größe. Sie werden durch Kopieren des Ordners übertragen (Abschnitt 9.1).

## 2. Rohdaten und abgeleitete Daten

**Rohdaten** sind die Grundlage für alles Weitere und werden nie aus anderen Daten berechnet:

- **Learning Records** (`learning` → `learn.records`): je abgeschlossenem Trade ein Datensatz, beim Schließen eingefroren. Danach kommen nur noch der Nachlauf (`followUp`) und protokollierte Revisionen hinzu.
- **Near-Misses** (`learn.nearMiss.done`): abgelehnte Kandidaten mit 15 Minuten Kursnachlauf.
- **Journal** (`trades`): Trades mit allen Käufen und Verkäufen (`entries`, `exits`), gespeichert werden höchstens 500 Einträge – im Browser wie auf dem PC.
- **Kandidaten-Datensätze** (nur PC, seit 2.13.0, `data/candidates/`): jeder gescannte Coin mit Merkmalen, Entscheidung, 30 Minuten Kursverlauf und Label nach Kosten; außerhalb der 10 Speicherbereiche, nie gelöscht (Abschnitt 9).

Aufbau eines Learning Records:

| Feld | Inhalt |
|---|---|
| `v` | Version des Record-Formats (`LEARN_VERSION`, derzeit 1) |
| `entry` | Merkmale zum Einstiegszeitpunkt (Score, Confidence, Risiko, Liquidität, Volumen, Signale, Security-Status, Regime, Coin-Quelle `disc` …); `entry.v` = `FEATURE_VERSION` (derzeit 1) |
| `execution` | Gebühren, Slippage, Latenzen, Preis-Einfluss, Größe, Anzahl Käufe `buys`; seit 2.12.0 zusätzlich `execModel`, `exitSource`, `maxDevPct` (siehe unten) |
| `path` | Kursverlauf während der Haltedauer: MAE/MFE nach 1/2/5/15 min, größter Anstieg/Rückgang, Liquiditätsverlauf `minLiqPct`, Stichproben |
| `exit`, `plan`, `outcome` | Ausstiegsgrund und -kurs, geplanter Stop, Ergebnis in $ und % |
| `labels`, `cf` | Ursachen mit Evidenz, Fehlerklasse, „erwartbarer Verlust?“, Gegenrechnungen |
| `quality` | seit 2.12.0: `{ v: 1, ok, flags }` (Abschnitt 4) |
| `legacy` | `true` bei Records, die nachträglich aus dem Journal erzeugt wurden (eingeschränkte Merkmale) |
| `mode`, `strategy`, `paramVersion`, `modelVersion`, `regimeTags` | Kontext des Trades |

Neue Felder in `execution` (2.12.0):

- `execModel`: `2` = mindestens ein Kauf zu einem echten Jupiter-Kursangebot mit Wartezeit (ab 2.11.0), `1` = nur geschätzte Füllung (vor 2.11.0 oder ausschließlich AMM-Schätzung, weil Jupiter nicht erreichbar war). Einzelne Füllungen in Modell 2 können trotzdem auf der AMM-Schätzung beruhen; das steht im Journal je Kauf bzw. Verkauf unter `source` (`JUPITER` oder `AMM`).
- `exitSource`: Quelle des letzten Verkaufs: `JUPITER`, `AMM`, `WRITE_OFF` (Abschreibung ohne Verkaufsweg) oder – bei der Migration für ältere Trades vergeben – `ESTIMATED` (Modell 1) bzw. `UNKNOWN` (Modell 2, Quelle nicht gespeichert).
- `maxDevPct`: größte Abweichung eines Kauf-Füllkurses vom Referenzkurs beim Entscheid, in Prozent.

**Abgeleitete Daten** werden aus den Rohdaten berechnet und lassen sich jederzeit neu aufbauen:

- Muster (`patterns`) und Fehlsignal-Liste – neu aufgebaut durch `rebuildFromRecords()`,
- Lektionen, Verlustmodell, Kalibrierung, Drift – neu berechnet im nächsten Lernlauf,
- Hypothesen und Experimente (`experiments`) – Experimente werden auf den Records neu ausgeführt.

Nicht automatisch neu aufgebaut werden das aktive Modell und seine Regeln (`models`). Sie entstehen nur über validierte Experimente, Shadow-Phase und Übernahme und bleiben bei einer Bereinigung unverändert.

## 3. Warum eine Qualitätsprüfung nötig war

Die Auswertung echter Nutzerdaten (Journal und Backup, 2026-10-02) zeigte vier Probleme:

1. **Browser-Speicher voll:** Der `localStorage` (5 MB) war ausgeschöpft. Bei jedem Speichern wurden Trades und Lerndaten gekürzt („Speicher knapp – … rotiert“: Lerndaten auf die letzten 100 Records ohne Kursstichproben, Journal auf 150 Einträge). Was dabei verloren ging, lässt sich nicht wiederherstellen. Abhilfe ist der PC-Bot ohne dieses Limit.
2. **Nachkäufe:** Einzelne Positionen hatten bis zu 164 Käufe. Ihr Ergebnis beschreibt das Nachkaufen, nicht das Einstiegssignal, aus dem die Lern-KI lernen soll.
3. **Kurskonflikt beim Rug:** Bei einem Coin bot Jupiter 99 % unter dem DexScreener-Kurs an (Rug im Gange). Die alte Slippage-Formel machte daraus einen absurd hohen Betrag, ein Vielfaches des Einsatzes.
4. **Scheingewinne:** Vor 2.11.0 verkaufte die Simulation bei einem Liquiditätsabzug zum alten Kurs. Solche Ausstiege zeigten Gewinne, die in Wirklichkeit nicht erzielbar waren.

Punkt 2 bis 4 sind genau das, was die Qualitätsregeln seit 2.12.0 ausschließen.

## 4. Qualitätsregeln (`recordQuality`, `js/learning.js`)

Jeder Record erhält beim Schließen (und für Altbestände bei der Migration) das Feld `quality`. Ein Record mit mindestens einem Kennzeichen gilt als „fürs Lernen ausgeschlossen“ (`learnable(r)` ist dann `false`).

| Kennzeichen | Regel | Anzeige |
|---|---|---|
| `PYRAMIDED` | `execution.buys` > 3 (`LEARN_MAX_BUYS`), also ab dem 4. Kauf in dieselbe Position | „mehr als 3 Käufe in eine Position“ |
| `PRICE_CONFLICT` | Betrag von `execution.maxDevPct` > 25 (`PRICE_CONFLICT_PCT`): ein Kauf wurde mehr als 25 % neben dem Referenzkurs gefüllt | „Füllkurs mehr als 25 % neben dem Marktkurs“ |
| `ESTIMATED_RUG_EXIT` | Liquiditätsabzug (Ausstiegsgrund `LIQUIDITY_COLLAPSE` oder `path.minLiqPct` ≤ −40) **und** der Verkaufskurs stammt nicht aus einem echten Angebot (`exitSource` weder `JUPITER` noch `WRITE_OFF`) | „Verkauf bei Liquiditätsabzug nur geschätzt (Scheinergebnis)“ |

Zusätzlich verhindert der neue Kauf-Blocker **`PRICE_CONFLICT`** (Kategorie Daten), dass solche Trades überhaupt entstehen: Kein Kauf, wenn das echte Jupiter-Angebot mehr als 25 % unter dem DexScreener-Kurs liegt.

Slippage wird seit 2.12.0 so berechnet (`slippageOf`): Kauf (Einsatz − Gebühren) × (Füllkurs ÷ Referenzkurs − 1), Verkauf Menge × (Referenzkurs − Füllkurs); Abschreibungen ohne Verkaufsweg zählen nicht als Slippage. Bei Füllkursen weit unter dem Referenzkurs ist der Betrag damit höchstens so groß wie der Einsatz. Die alte Kauf-Formel lief in diesem Fall gegen unendlich.

## 5. Was „ausgeschlossen“ bedeutet

Ausgeschlossene Trades werden **nicht gelöscht**. Sie bleiben:

- als Learning Record gespeichert und in allen Exporten (Learning Records JSON, Lern-Report CSV, Voll-Backup),
- im Journal und damit in Kapital, Ergebnis und den Statistiken (Analytics, Trefferquote, Profit Factor),
- in der Lern-Ansicht sichtbar: Kennzahl „Fürs Lernen ausgeschlossen“ mit Gründen, Hinweis „nicht gelernt“ am Trade; in der PC-Oberfläche „Ausgeschlossen (verzerrt)“.

Sie zählen **nicht** für:

- Muster, Fehlsignal-Liste und Lektionen,
- Hypothesen und Experimente,
- Verlustmodell, Kalibrierung und Drift,
- Verlustserien-Review und den Vergleich mit früheren Trades bei der Ursachenbewertung,
- die Shadow- und Live-Bewertung von Modellen,
- die Auswertungen der Lern-Ansicht (Ursachen, Fehlerklassen, Coin-Quellen).

Beim Schließen eines solchen Trades erscheint im Log eine Warnung „… gespeichert, zählt aber nicht fürs Lernen – …“.

## 6. Einmalige Bereinigung (Migration 2.12.0)

Läuft genau einmal je Datenbestand beim ersten Start mit 2.12.0 (`learn.qualityV` < 1), im Browser wie auf dem PC:

1. **Slippage neu berechnen** (`slippageMigrate`) für Journal und offene Positionen mit der neuen Formel (markiert mit `slipV: 2`). Ergebnisse und Kapital ändern sich nicht.
2. **Fehlende Angaben ergänzen** (`learnQualityMigrate`): Für jeden Record werden `buys`, `execModel`, `exitSource`, `maxDevPct` und die Slippage aus dem Journal ergänzt. Die Verkaufsquelle wurde vor 2.12.0 nicht gespeichert und wird deshalb abgeleitet: Abschreibung → `WRITE_OFF`, Modell 2 → `UNKNOWN` (der Verkauf kann auch auf die AMM-Schätzung zurückgefallen sein), Modell 1 → `ESTIMATED`. Damit gelten alte Ausstiege bei Liquiditätsabzug ohne nachweisbares Jupiter-Angebot als `ESTIMATED_RUG_EXIT` – lieber einen gültigen Trade verlieren als aus einem Scheinergebnis lernen. Records, deren Trade nicht mehr im Journal steht, gelten als Modell 1 mit Quelle `ESTIMATED`.
3. **Qualität bestimmen** (`recordQuality`) für alle Records.
4. **Abgeleitetes neu aufbauen:** Muster und Fehlsignal-Liste nur aus sauberen Records; Lektionen, Verlustmodell, Kalibrierung und Drift werden geleert und im nächsten Lernlauf neu berechnet.
5. **Forschung neu starten:** Alle Hypothesen außer `SHADOW` und `PROMOTED` gehen zurück auf `IDEA` mit dem Ergebnis `RETEST` („Datenbasis bereinigt (2.12.0) – wird mit sauberen Trades neu getestet“). Bisherige Experimente erhalten den Vermerk `invalidated`, die Warteschlange wird geleert.
6. Vermerk im Log und in der Lern-Zeitleiste (`MIGRATION`) mit der Zahl ausgeschlossener Trades.

Records werden dabei nicht gelöscht. Das aktive Modell und seine Regeln bleiben unverändert.

## 7. Lern-Gedächtnis: Browser und PC

| Bereich | Browser (`LEARN_CAPS`, `js/learning.js`) | PC (`PC_LEARN_CAPS`, `server/bot.js`) |
|---|---|---|
| Learning Records | 200 | 5000 |
| ausgewertete Near-Misses | 200 | 2000 |
| Fehlsignale | 150 | 1000 |
| Lern-Zeitleiste | 200 | 1000 |
| Muster | 300 | 2000 |
| Lektionen | 80 | 200 |
| Hypothesen | 80 | 200 |
| Experimente | 60 | 200 |
| Verlustserien-Reviews | 20 | 100 |

Gleich bleiben auf dem PC: offene Near-Misses (40), Modellversionen (30), Warteschlange (40), Kursstichproben je Record (120), Beobachtungen je Muster (20) und das Journal (500 gespeicherte Einträge). Im Browser kommt das 5-MB-Limit mit der Kürzung aus Abschnitt 3 hinzu.

**Zurück in den Browser:** Ein Backup des PC-Bots lässt sich im Browser einspielen, dort gelten aber nur die Browser-Grenzen. Behalten werden die 200 neuesten Records; Muster werden beim Laden ohne Sortierung nach Relevanz auf 300 gekürzt, die übrigen Listen auf ihre Browser-Grenze. Danach kann zusätzlich die Kürzung bei vollem Speicher greifen. Das PC-Backup sollte deshalb die Hauptkopie bleiben.

## 8. Hinweise für künftige Modelle

- **Nur auf `learnable` Records trainieren** (`quality.ok !== false`). Ausgeschlossene Records eignen sich für gesonderte Auswertungen (z. B. Rug-Erkennung), gehören aber nie ungekennzeichnet in einen Trainingsdatensatz.
- **`execModel` beachten:** Ergebnisse aus Modell 1 (vor 2.11.0, geschätzte Ausführung) sind systematisch zu optimistisch. Nie mit echten Kursangeboten (Modell 2) mischen, ohne `execModel` als Merkmal mitzuführen oder getrennt auszuwerten. Innerhalb von Modell 2 die Quelle je Füllung (`source`, `exitSource`) beachten.
- **`FEATURE_VERSION` beachten:** Merkmale verschiedener Versionen (`entry.v`) sind nicht direkt vergleichbar. Bei einer neuen Version getrennt trainieren oder ausdrücklich umrechnen. `legacy`-Records haben nur eingeschränkte Merkmale.
- **Kein Look-Ahead:** Merkmale nur aus `entry` (Zeitpunkt des Einstiegs). `path`, `exit`, `outcome`, `followUp` und `labels` liegen danach und dürfen nur Zielgrößen sein. Aufteilung in Training und Test zeitlich, nicht zufällig.
- **Rohdaten nie löschen oder überschreiben.** Abgeleitetes lässt sich aus den Records jederzeit neu berechnen; verlorene Records nicht.
- **Exporte:** „Learning Records JSON“ (Browser: Lern-Ansicht → Export; PC: http://localhost:8787/api/export?kind=learning-json) und das Voll-Backup enthalten die vollständigen Records inklusive `quality`, `execModel` und `exitSource`. Der Lern-Report als CSV hat seit 2.12.0 am Ende die Spalten `learnable` (ja/nein), `qualityFlags`, `execModel` und `exitSource`; für Training nur Zeilen mit `learnable = ja` verwenden.
- Near-Miss-Ergebnisse sind simuliert und ohne Kosten gerechnet.
- Für Kandidaten-Datensätze gelten zusätzlich die Hinweise in Abschnitt 9.8.

## 9. Kandidaten-Datensätze (seit 2.13.0)

Learning Records gibt es nur für ausgeführte Trades – für ein Modell sind das zu wenige. Der **Datensammler** (`js/dataset.js`, Schicht „Sammeln“) hält deshalb **jeden gescannten Coin** zum Entscheidungszeitpunkt fest (Merkmale, Entscheidung, Kosten-Eingaben), verfolgt seinen Kurs 30 Minuten lang und schreibt danach ein Label: Was wäre mit einem Kauf nach Kosten passiert (Triple Barrier: Gewinnziel, Stop, Rug, Zeit)? Das sind die Trainingsdaten für ein späteres Meta-Labeling-Modell (`docs/STRATEGIE.md`, Abschnitt 4) und die Grundlage für Datensammler und Sub-Bots.

Es ist reine Messung: Handel, Risiko-Limits, Lern-KI und Einstellungen ändern sich dadurch nicht. Die Lern-KI liest diese Datensätze nicht; sie sind für Auswertungen und Training außerhalb der App gedacht.

### 9.1 Wo die Daten liegen

- **Nur auf dem PC-Bot.** Der Datensammler ist eine Option je Kern-Instanz (`createCore({ …, candidates: { open: 1000 } })`); im Browser, in den normalen Tests und im Prüfkern beim Einspielen eines Backups fehlt sie – dann ist er ganz aus (kein Zustand, keine Anfragen).
- **Datei:** `data/candidates/cand-JJJJ-MM-TT.jsonl`, eine Datei je UTC-Tag des Entscheidungszeitpunkts `ts`, eine JSON-Zeile je abgeschlossenem Datensatz (JSON Lines). Zeilen werden nur angehängt. Ein Datensatz ist erst nach 30 Minuten fertig: Die Datei eines Tages bekommt deshalb kurz nach Mitternacht noch Zeilen, und innerhalb einer Datei stehen die Zeilen in der Reihenfolge des Abschlusses, nicht nach `ts`.
- **Nie gelöscht:** Der Bot löscht diese Dateien nicht (die 30-Tage-Löschung betrifft nur `data/logs`). Schlägt das Schreiben fehl, hält der Bot bis zu 5000 Zeilen im Speicher und versucht es mit dem nächsten Batch erneut; darüber hinaus werden die ältesten verworfen (Warnung im Protokoll).
- **Nicht im Voll-Backup** und nicht in der täglichen Sicherung – wegen der Größe (etwa 3–5 KB je Datensatz, grob 15–25 MB am Tag). Zum Umziehen den Ordner `data/candidates` kopieren. Das ist eine bewusste Ausnahme vom gemeinsamen Backup-Format; das Zeilenformat ist über `v` (`CAND_VERSION`) versioniert.
- **Herunterladen:** PC-Oberfläche, Bereich „Kandidaten-Daten (für die KI)“ (je Tag ein Knopf „⬇ JSONL“), oder direkt `http://localhost:8787/api/candidates?day=JJJJ-MM-TT`; `/api/candidates` listet alle Tage mit Größe.
- **Offene Datensätze** (die letzten 30 Minuten) stehen nur im Arbeitsspeicher. Beim Beenden („Bot beenden“, Strg+C) und beim Einspielen eines Backups werden sie vorzeitig abgeschlossen und geschrieben (`end` = `SHUTDOWN` bzw. `RELOAD`, Kennzeichen `TRUNCATED`). Bei einem harten Abbruch (Stromausfall, Fenster geschlossen) gehen sie verloren.

### 9.2 Anlässe (`why`)

| `why` | Wann ein Datensatz entsteht |
|---|---|
| `FIRST` | erste Sichtung des Coins mit frischem Kurs, seit der Kern läuft. Nach einem Neustart oder dem Einspielen eines Backups beginnt das neu; ein Coin ohne Datensatz seit einem Tag wird vergessen und zählt danach wieder als `FIRST`. Wann der Coin tatsächlich zuerst gefunden wurde, steht in `context.firstSeenAt`. |
| `RESAMPLE` | frühestens 60 Minuten nach dem letzten `FIRST`/`RESAMPLE` desselben Coins, solange er im Scanner ist |
| `TRIGGER` | der Coin wird kaufwürdig (`decision.wouldBuy`: keine Blocker der Analyse). Höchstens ein offener `TRIGGER` je Coin, mindestens 30 Minuten Abstand; darf sich mit anderen Datensätzen desselben Coins überschneiden. Ist ein `FIRST`/`RESAMPLE` schon beim Öffnen kaufwürdig, zählt er zugleich als `TRIGGER` – es entsteht kein zweiter Datensatz, `why` bleibt `FIRST` bzw. `RESAMPLE`, `decision.wouldBuy` ist `true`. |

- **Bedingungen:** Analyse vorhanden, Kurs > 0, frischer DexScreener-Abruf (nicht älter als die Einstellung „Marktdaten gelten als STALE nach“, Standard 20 s). Einstiegskurs ist der Analysekurs genau dieses Abrufs. Sonst versucht der Bot es beim nächsten Scan erneut; gezählt wird der Anlass einmal als übersprungen (`skipped.data`).
- **Obergrenze:** höchstens 1000 gleichzeitig offene Datensätze. Vorrang `TRIGGER` vor `FIRST` vor `RESAMPLE`; `RESAMPLE` nur, solange weniger als 80 % der Grenze belegt sind. Bei gleichem Vorrang gilt eine gemischte, reproduzierbare Reihenfolge (kein Vorteil für früh entdeckte Coins). Wegen der Grenze übersprungene Anlässe werden gezählt (`skipped.cap`, `skipped.resample`) und nicht nachgeholt: Nach einem übersprungenen `FIRST`/`RESAMPLE` folgt frühestens 60 Minuten später ein `RESAMPLE`, nach einem übersprungenen `TRIGGER` frühestens 30 Minuten später der nächste.

### 9.3 Kursverfolgung

- Jeder Scan schreibt offene Datensätze mit den frischen DexScreener-Kursen des Scanners fort (nur neuere Abrufe als der letzte).
- **Verfolger:** Ist der Coin nicht mehr im Scanner (verdrängt) oder sein Kurs veraltet, fragt der Bot nach 25 s ohne Kurs selbst bei DexScreener nach – über denselben Endpunkt wie der Scanner, bis zu 30 Coins je Anfrage, eine Anfrage gleichzeitig, mindestens 2 s Abstand, nicht offline und nicht im Backoff, und nur solange von den 240 Anfragen/min der Quelle „DexScreener Pairs“ mindestens 60 für den Scanner frei bleiben. Der Coin kommt dadurch nicht in den Scanner zurück. Ohne Verfolger würden gerade Dumps und Rugs fehlen, weil der Scanner solche Coins verdrängt.
- **Pool:** der Pool des Einstiegs, sonst der Pool mit der höchsten Liquidität (Kennzeichen `POOL_SWITCH`).
- **Verschwunden:** Findet der Verfolger 3-mal in Folge keinen Pool mehr (oder der Scanner 3-mal in Folge keinen), gilt der Pool als verschwunden (`VANISHED`); der Verfolger fragt dann nicht mehr nach.
- **Proben:** Die Barrieren werden auf jedem Kurs geprüft. Gespeichert (`path.s`) werden Proben alle 15 s in den ersten 5 Minuten, danach alle 30 s, dazu die erste Überschreitung jeder Barriere, höchster und tiefster Kurs, tiefste Liquidität und der letzte Kurs – zusammen etwa 70 Einträge.

### 9.4 Aufbau eines Datensatzes

Zeitpunkte in Millisekunden seit 1970 (UTC), Zeiten im Pfad in Sekunden nach `t0`. Prozentwerte sind auf 2 Nachkommastellen gerundet.

| Feld | Inhalt |
|---|---|
| `v` | Format-Version (`CAND_VERSION`, derzeit 1) |
| `id` | `C-<ts>-<Prüfsumme der tokenId>` (beides Base 36), bei `TRIGGER` mit Endung `T`; eindeutig |
| `app` | App-Version beim Öffnen |
| `why` | Anlass `FIRST`, `RESAMPLE` oder `TRIGGER` (9.2) |
| `ts` | Entscheidungszeitpunkt (Uhr des Kerns) |
| `t0` | Abrufzeitpunkt des Einstiegskurses bei DexScreener; Bezugspunkt für Pfad und Horizont |
| `tokenId`, `mint`, `symbol` | Coin (`tokenId` = `solana:<mint>`) |
| `pair`, `dex`, `source` | Adresse des Einstiegs-Pools, DEX, Datenquelle (`dexscreener`) |
| `mode` | Modus des Bots (SIMULATION/PAPER) |
| `entry` | Merkmale zum Entscheidungszeitpunkt aus `buildEntryFeatures` – dasselbe Format wie `entry` der Learning Records, `entry.v` = `FEATURE_VERSION` (1, unverändert) |
| `decision` | Entscheidung des Bots (Tabelle unten) |
| `context` | Umstände der Datenerhebung (Tabelle unten) |
| `cost` | Kosten-Eingaben (9.6) |
| `label` | Ergebnis (9.5) |
| `path` | Kursverlauf (Tabelle unten) |
| `quality` | Datenqualität `{ v: 1, ok, flags }` (9.7) |
| `trade` | `{ tradeId, orderId, at }`, wenn der Bot den Coin während des Datensatzes gekauft hat (erster Kauf; `tradeId` = `tradeId` des Learning Records = Journal-ID), sonst `null` |
| `end` | Abschluss: `HORIZON` (30 Minuten erreicht), `SHUTDOWN` (Bot beendet), `RELOAD` (Backup eingespielt) |

`decision`:

| Feld | Inhalt |
|---|---|
| `decision` | `APPROVED`, `BUY_CANDIDATE`, `WATCH` oder `REJECTED` |
| `stage` | Name der erreichten Stufe der Entscheidungskette (z. B. `EXECUTION_CHECK`); `entry.stage` enthält dieselbe Stufe als Nummer |
| `analysisCodes` | Codes der Blocker aus der Analyse (Filter des Signals) |
| `execCodes` | Codes der Blocker der Ausführungsprüfung (Risiko-Limits, Kapital, Cooldowns …) |
| `wouldBuy` | `true`, wenn es keine Analyse-Blocker gibt: Das Signal sagt „kaufen“, unabhängig vom Zustand des Portfolios |
| `strategy` | führende Strategie |
| `positionSize` | geplante Positionsgröße in $ (0 ohne Größenberechnung) |
| `paramVersion`, `modelVersion` | aktive Parameter-Version und aktives Modell der Lern-KI |
| `settingsHash` | kurzer Fingerabdruck der Werte der Parameter-Tabelle (`PARAM_TABLE_KEYS`): gleiche Filter ergeben denselben Wert |

`context`:

| Feld | Inhalt |
|---|---|
| `regimeTags` | Markt-Regime zum Entscheidungszeitpunkt |
| `inUniverseMs` | wie lange der Coin schon im Scanner ist |
| `firstSeenMc`, `firstSeenAt` | Market Cap und Zeitpunkt beim ersten Fund (gespeichert, überdauert Neustarts) |
| `histN` | Zahl der Kurspunkte, die der Scanner für den Coin hat |
| `taSource` | Herkunft der technischen Indikatoren: `ohlcv` (Kerzen), `live` (aus Scanner-Kursen) oder `null` |
| `crossChecked` | Kurs von einer zweiten Quelle (GeckoTerminal) bestätigt |
| `impactPlannedPct` | geschätzter Preis-Einfluss der geplanten Positionsgröße in % |
| `quote` | letzte Jupiter-Rundreise-Prüfung des Coins `{ roundTripPct, noSellRoute, ageMs }` oder `null` |

`path`:

| Feld | Inhalt |
|---|---|
| `n` | Zahl der Kursbeobachtungen einschließlich Einstieg |
| `nExt` | davon vom Verfolger |
| `maxGapSec` | größte Lücke zwischen zwei Beobachtungen, einschließlich der Lücke vom letzten Kurs bis zum Horizont bzw. Abschluss |
| `tEndSec` | Zeitpunkt des letzten Kurses |
| `s` | Proben `[tSec, pct, liqPct]`: `pct` = (Kurs ÷ Einstiegskurs − 1) · 100, `liqPct` = (Liquidität ÷ `liq0` − 1) · 100 oder `null` (unbekannt oder anderer Pool); erste Probe `[0, 0, 0]` (ohne bekannte Liquidität `[0, 0, null]`) |

### 9.5 Label (`label`)

Die Regeln sind fest (`CAND_LABEL` = `{ horizonMin: 30, tpPct: 30, slPct: 15, rugLiqPct: -40 }`), bewusst keine Einstellung, damit alle Datensätze vergleichbar bleiben. Sie stehen in jedem Datensatz unter `label.cfg`.

| Feld | Inhalt |
|---|---|
| `y` | `TP`, `SL`, `RUG`, `TIME` oder `NO_DATA` |
| `tHitSec`, `hitPct` | Zeitpunkt und beobachtete Kursänderung beim Treffer einer Barriere |
| `endPct` | Kursänderung beim letzten Kurs in den letzten 2 Minuten vor dem Horizont |
| `grossPct`, `netPct`, `win` | Ergebnis vor und nach Kosten, `win` = `netPct` > 0 |
| `mfePct`, `tMfeSec`, `maePct`, `tMaeSec` | höchste und tiefste Kursänderung im ganzen Fenster mit Zeitpunkt |
| `minLiqPct` | tiefste Liquidität des Einstiegs-Pools im ganzen Fenster (Änderung in %) |

- **Barrieren** auf dem Bruttokurs ab Einstieg: `TP` bei ≥ +30 %, `SL` bei ≤ −15 %, `RUG`, wenn die Liquidität des Einstiegs-Pools um 40 % oder mehr gesunken ist (`liqPct` ≤ −40). Geprüft wird jeder frische Kurs; die zuerst überschrittene Barriere entscheidet `y`. Trifft eine Beobachtung mehrere, gilt `RUG` vor `SL` vor `TP`.
- **Durchrutschen bleibt sichtbar:** `hitPct` ist der tatsächlich beobachtete Wert. Fällt der Kurs zwischen zwei Abrufen von −5 % auf −40 %, steht dort −40 und nicht −15.
- **Voller Horizont:** Nach einem Treffer wird bis Minute 30 weiter verfolgt; MFE, MAE und `minLiqPct` gelten immer für das ganze Fenster (Grundlage, um andere Ausstiegsregeln offline zu prüfen).
- **`TIME`:** keine Barriere; `endPct` = letzter Kurs in Minute 28–30. Gibt es dort keinen Kurs, ist das Label `NO_DATA`. Ein vorzeitig abgeschlossener Datensatz (`TRUNCATED`) ohne Barriere ist deshalb fast immer `NO_DATA` (`TIME` nur, wenn schon ein Kurs aus Minute 28–30 vorliegt).
- **Pool verschwunden (`VANISHED`):** ohne vorher beobachtete Barriere `NO_DATA` – es wird nie ein Verlust erfunden. Eine vorher beobachtete Barriere (z. B. `RUG`) bleibt bestehen.
- **Anderer Pool (`POOL_SWITCH`):** Dessen Kurse zählen, seine Liquidität nicht (`liqPct` = `null`), sonst entstünde ein Schein-Rug.
- **Ergebnis:** `grossPct` = `hitPct` bei `TP`/`SL`/`RUG`, `endPct` bei `TIME`, `null` bei `NO_DATA`. `netPct` rechnet das Kostenmodell (9.6) mit der Liquidität am Ausstieg (`liq0` · (1 + `liqPct`/100) der Ausstiegs-Beobachtung; unbekannt → `liq0`). Ohne `netPct` ist `win` = `null`.
- **Nachrechnen:** `candLabel(path.s, label.cfg, cost, { vanished: quality.flags.includes('VANISHED') })` aus `js/dataset.js` ergibt aus der gespeicherten Zeile genau das gespeicherte `label` (Selbsttest). Die Barrieren werden dabei wie online auf den gerundeten Werten geprüft. Mit anderen Barrieren (z. B. Gewinnziel +20 %) lässt sich offline neu labeln, aber nur näherungsweise: Kurse zwischen den Proben fehlen; enthalten sind Extremwerte und die Treffer der festen Barrieren.

### 9.6 Kostenmodell (`cost`, Modell 1)

Gerechnet wird mit einer **festen Referenzgröße von 50 $** (`refUsd`), unabhängig von Kapital und Positionsgröße – so bleibt jeder Datensatz für jedes Portfolio und jeden Sub-Bot nachrechenbar. Die Formel entspricht der Kosten-Schätzung des Kerns: Preis-Einfluss eines Konstantprodukt-Pools, DEX-Gebühr, Netzwerk- und Priority-Gebühr je Transaktion.

```
S      = refUsd (50 $),  f = dexFeePct / 100,  N = txFeeUsd (je Transaktion)
v0     = S · (1 − f) · (1 − S / (liq0/2 + S)) − N            Wert nach dem Kauf
V      = v0 · (1 + grossPct/100)                              Wert am Ausstieg vor dem Verkauf
E      = V · (1 − f) · (1 − V / (liqExit/2 + V)) − N          Erlös nach dem Verkauf
netPct = (E / S − 1) · 100                                    höchstens −100
```

| Feld | Inhalt |
|---|---|
| `model` | Version des Kostenmodells (1) |
| `refUsd` | Referenzgröße 50 $ |
| `liq0` | Liquidität des Einstiegs-Pools in $ |
| `impactInPct` | Preis-Einfluss des Kaufs: S / (liq0/2 + S) · 100 |
| `dexFeePct` | DEX-Gebühr je Swap aus den Einstellungen (Standard 0,25 %) |
| `txFeeUsd` | Netzwerk-Grundgebühr (5000 Lamports) plus Priority Fee, umgerechnet mit `solUsd` |
| `prioLamports`, `solUsd` | Priority Fee zum Entscheidungszeitpunkt (wie bei Käufen) und SOL-Kurs |
| `roundTripPct` | Kosten für Kauf und Verkauf ohne Kursbewegung bei gleicher Liquidität in % (= −`netPct` bei `grossPct` 0) |

Beispiel (SOL 150 $, Priority Fee 100.000 Lamports, DEX-Gebühr 0,25 %): Bei 10.000 $ Liquidität kostet die Rundreise 2,51 %; aus +30 % brutto werden +26,38 % netto, aus −15 % brutto −17,02 % netto. Bei 100.000 $ Liquidität kostet die Rundreise 0,76 %.

Fehlt SOL-Kurs, Liquidität, Priority Fee oder DEX-Gebühr, bleiben die berechneten Kostenfelder `null`, `netPct` ist `null` und `quality` trägt `NO_COST`.

**Nicht enthalten:** Kursbewegung zwischen Entscheidung und Bestätigung der Transaktion (Latenz), gescheiterte Transaktionen und Sandwich-/MEV-Angriffe. Das Modell rechnet mit einem Pool statt mit einem echten Jupiter-Angebot (die letzte Rundreise-Prüfung steht, falls vorhanden, in `context.quote`) und unterstellt einen Ausstieg genau zum beobachteten Kurs beim Treffer. Die Netto-Ergebnisse sind deshalb eher zu günstig. Für eine andere Größe lässt sich neu rechnen: `candNet(grossPct, { ...cost, refUsd: X }, liqExit)`.

### 9.7 Datenqualität (`quality`)

| Kennzeichen | Regel |
|---|---|
| `FEW_SAMPLES` | weniger als 10 Kursbeobachtungen (`path.n`) |
| `GAPS` | eine Lücke über 2 Minuten (`path.maxGapSec` > 120), auch vom letzten Kurs bis zum Horizont |
| `TRUNCATED` | vor dem Horizont abgeschlossen (Bot beendet, Backup eingespielt) |
| `VANISHED` | Pool am Ende verschwunden (3-mal in Folge nicht gefunden) |
| `POOL_SWITCH` | mindestens ein Kurs aus einem anderen Pool als beim Einstieg |
| `NO_COST` | Kosten nicht berechenbar, `netPct` = `null` |

`ok` ist nur ohne jedes Kennzeichen `true`.

### 9.8 Hinweise für Modelle

- **Nach `tokenId` gruppieren:** Ein Coin hat oft mehrere Datensätze (`FIRST`, `RESAMPLE` alle 60 Minuten, `TRIGGER`), deren 30-Minuten-Fenster sich überschneiden können. Sie sind stark voneinander abhängig. Alle Datensätze eines Coins gehören in denselben Teil (Training oder Test), z. B. über eine Gruppen-Kreuzvalidierung.
- **Zeitlich aufteilen** nach `ts`, nie zufällig, mit mindestens 30 Minuten Abstand zwischen Training und Test (Horizont).
- **Nur `quality.ok`** fürs Training verwenden oder die Kennzeichen als Gewicht einsetzen.
- **Kein Look-Ahead:** Merkmale nur aus `entry` (dazu bei Bedarf `decision` und `cost`). `label`, `path`, `quality`, `trade` und `end` liegen nach dem Entscheidungszeitpunkt und sind Zielgrößen bzw. Filter.
- **Anteil `NO_DATA` beobachten:** Verschwundene Pools sind oft Rugs. Wer `NO_DATA`/`VANISHED` einfach weglässt, macht die Daten besser, als der Markt ist. Den Anteil je Zeitraum und je Gruppe (z. B. Coin-Quelle) ausweisen; steigt er, ist das ein Warnsignal für eine Verzerrung (Datenquelle, Verfolger-Kontingent).
- **`path.nExt` ÷ `path.n`** ist der Anteil der Kurse vom Verfolger. Ein hoher Anteil heißt: Der Scanner hat den Coin früh verdrängt. Als Kontrollgröße nutzen, nicht als Merkmal.
- **Meta-Labeling:** Die Strategie schlägt vor (`decision.wouldBuy` = `true`), das Modell entscheidet Ja/Nein. Dafür alle Datensätze mit `decision.wouldBuy` verwenden, nicht nur `why` = `TRIGGER` (ein schon kaufwürdiger `FIRST`/`RESAMPLE` zählt als Trigger). Zielgröße: `label.win` bzw. `label.netPct`. Datensätze mit `wouldBuy` = `false` zeigen, was die Filter aussortieren – wie Near-Misses, aber für alle Coins und nach Kosten.
- **`entry` ist `FEATURE_VERSION` 1**, unverändert und identisch zu den Learning Records: Ein auf Kandidaten trainiertes Modell lässt sich auf `entry` echter Trades anwenden.
- **Erhebungsfelder nicht als Marktmerkmal:** `context.taSource`, `context.histN`, `context.inUniverseMs`, `context.crossChecked`, `why` und `path.nExt` beschreiben, wie die Daten erhoben wurden. Ein Modell, das sie nutzt, lernt die Datenquelle statt des Marktes (Kerzen holt der Bot z. B. vor allem für Coins mit offener Position – `taSource` = `ohlcv` verrät dann einen Kauf). Diese Felder zum Filtern und Aufteilen verwenden. `trade` dient nur dem Abgleich mit den Learning Records.
- **Einlesen:** Datei für Datei, Zeilen mit unbekanntem `v` überspringen, nach `id` entdoppeln, nach `ts` sortieren.

### 9.9 Verhältnis zu Near-Misses und Learning Records

| | Learning Records | Near-Misses | Kandidaten-Datensätze |
|---|---|---|---|
| Was | ausgeführte Trades | knapp abgelehnte Kandidaten (ein Filter) | jeder gescannte Coin (`FIRST`, `RESAMPLE`, `TRIGGER`) |
| Nachlauf | Haltedauer und Nachlauf (`followUp`) | 15 Minuten, nur solange der Coin im Scanner ist | 30 Minuten, auch nach Verdrängung aus dem Scanner |
| Barrieren | – (Ausstieg nach den Regeln des Bots) | Gewinnziel und Stop aus den Einstellungen | fest: +30 %, −15 %, Liquidität −40 % |
| Kosten | simulierte Ausführung mit echten Angeboten | ohne Kosten | Kostenmodell 1 mit 50 $ |
| Speicher | Bereich `learning` (Browser und PC, im Backup) | Bereich `learning` (Browser und PC, im Backup) | nur PC, `data/candidates/*.jsonl`, nicht im Backup |
| Nutzt die Lern-KI | ja (nur `learnable`) | ja (Auswertung je Filter) | nein (Training außerhalb der App) |

Das Near-Miss-Tracking ist unverändert. Verknüpfung: `trade.tradeId` eines Kandidaten-Datensatzes = `tradeId` des Learning Records desselben Trades.
