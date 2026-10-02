# Smart Lab – Lerndaten: Übertragbarkeit und Datenqualität

Stand: App-Version 2.12.0. Betrieb auf dem PC: `docs/PC-BETRIEB.md`, Architektur: `docs/ARCHITEKTUR.md`.

Dieses Dokument beschreibt, wie die Lerndaten gespeichert und zwischen Browser, PC und einem späteren Server übertragen werden, welche Trades seit 2.12.0 vom Lernen ausgeschlossen sind und worauf künftige Modelle achten müssen.

## 1. Ein Format für Browser, PC und Server

- Alle Daten liegen in 10 Speicherbereichen `smartlab.v3.*` (`settings`, `runtime`, `positions`, `trades`, `logs`, `stats`, `learning`, `experiments`, `models`, `patterns`), jeweils als JSON-Text mit `v: 3`.
- **Browser:** je Bereich ein Eintrag im `localStorage` (zusammen höchstens etwa 5 MB).
- **PC** (`server/bot.js`): je Bereich eine Datei `data/<Schlüssel>.json` mit genau demselben Inhalt (`server/store.js`). Kein 5-MB-Limit.
- **Server** (Roadmap C): soll dieselben Bereiche und dasselbe Backup-Format übernehmen.
- **Voll-Backup:** eine Datei `{ app, storageVersion: 3, exportedAt, kind: "backup", storage: { <Bereich>: … } }`. Identisch, ob es aus dem Browser („⬇ Voll-Backup (alle Daten)“), aus der PC-Oberfläche („⬇ Voll-Backup herunterladen“) oder aus der täglichen Sicherung des PC-Bots (`data/backups/`) stammt.
- **Einspielen:** Kennung und Speicherversion werden geprüft, die App-Version der Sicherung darf nicht neuer sein als die installierte, jeder Bereich wird geprüft und das Ganze zuerst in einer isolierten Instanz probeweise geladen. Erst dann wird geschrieben.
- Das Backup enthält die Einstellungen inklusive selbst eingetragener RPC-Adressen und eines eventuell eingetragenen Jupiter-API-Keys. Es ist deshalb vertraulich. Der Einstellungs-Export („Settings JSON“) enthält den Key nicht.

## 2. Rohdaten und abgeleitete Daten

**Rohdaten** sind die Grundlage für alles Weitere und werden nie aus anderen Daten berechnet:

- **Learning Records** (`learning` → `learn.records`): je abgeschlossenem Trade ein Datensatz, beim Schließen eingefroren. Danach kommen nur noch der Nachlauf (`followUp`) und protokollierte Revisionen hinzu.
- **Near-Misses** (`learn.nearMiss.done`): abgelehnte Kandidaten mit 15 Minuten Kursnachlauf.
- **Journal** (`trades`): Trades mit allen Käufen und Verkäufen (`entries`, `exits`), gespeichert werden höchstens 500 Einträge – im Browser wie auf dem PC.

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
