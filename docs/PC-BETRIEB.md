# Smart Lab – Betrieb auf dem PC (Windows)

Stand: App-Version 2.12.0 (Roadmap C1, PC-Variante). Technischer Hintergrund: `docs/ARCHITEKTUR.md`, Lerndaten: `docs/LERNDATEN.md`.

Der PC-Bot ist dieselbe App wie im Browser, nur ohne Browser-Tab: Er läuft rund um die Uhr, solange der PC an ist, und speichert seine Daten als Dateien statt im 5-MB-Speicher des Browsers. Dadurch hat er ein deutlich größeres Lern-Gedächtnis. Bedient wird er über eine einfache Oberfläche im Browser, die nur auf diesem PC erreichbar ist.

Der Handel bleibt **ausschließlich simuliert**. LIVE-Handel und Signieren sind gesperrt wie im Browser, auf dem PC gibt es keine Wallet und keine Schlüssel.

## Kurzfassung

1. Node.js 24 LTS installieren („Windows Installer (.msi)“ von https://nodejs.org).
2. Programm als ZIP von GitHub laden und nach `C:\SmartLab` entpacken.
3. `start-bot.bat` doppelklicken – die Oberfläche öffnet sich unter http://localhost:8787.
4. Im Browser ein Voll-Backup erstellen, in der PC-Oberfläche einspielen, Browser-Tab schließen.
5. Energiesparmodus aus, Autostart einrichten.

Ein `npm install` ist nicht nötig. Der Bot nutzt nur Bausteine, die in Node.js enthalten sind.

## 1. Node.js installieren

1. https://nodejs.org öffnen und auf den Download-Knopf für die **LTS-Version 24** klicken.
2. Auf der Download-Seite steht oben ein Befehlsblock (Docker, nvm, fnm, „with npm“ o. Ä.). **Diesen ignorieren.** Darunter gibt es fertige Pakete für Windows: dort **„Windows Installer (.msi)“** wählen. Windows und x64 erkennt die Seite in der Regel selbst.
3. Die heruntergeladene `.msi`-Datei doppelklicken und mit „Next“ durchklicken. Die Standardoptionen passen. Das Häkchen für zusätzliche Werkzeuge („Tools for Native Modules“ bzw. „Automatically install the necessary tools“) wird nicht gebraucht und kann leer bleiben. Am Ende die Windows-Rückfrage (Administrator) bestätigen.
4. Prüfen: ein **neues** Fenster der Eingabeaufforderung öffnen (Windows-Taste, `cmd` eingeben, Enter) und eingeben:

   ```
   node -v
   ```

   Angezeigt werden soll `v24.…`. Version 22 funktioniert auch, Mindestversion ist 20. Ältere Versionen lehnt der Bot beim Start ab.

## 2. Programm herunterladen

**Ohne Git (empfohlen):**

1. https://github.com/ennoschulz09-ops/Botenno öffnen.
2. Grüner Knopf **„Code“** → **„Download ZIP“**.
3. Die ZIP-Datei entpacken (Rechtsklick → „Alle extrahieren …“). Darin liegt ein Ordner `Botenno-main`.
4. Den **Inhalt** dieses Ordners nach `C:\SmartLab` kopieren, sodass dort direkt `start-bot.bat`, `index.html`, `js`, `server` und `docs` liegen.

Tipp: Wenn Windows später beim Start warnt („Der Computer wurde durch Windows geschützt“), vor dem Entpacken die ZIP-Datei mit Rechtsklick → „Eigenschaften“ → „Zulassen“ freigeben. Siehe auch „Häufige Fehler“.

**Mit Git** (nur wenn Git schon installiert ist):

```
git clone https://github.com/ennoschulz09-ops/Botenno.git C:\SmartLab
```

## 3. Bot starten und beenden

**Starten:** `C:\SmartLab\start-bot.bat` doppelklicken. Es öffnet sich ein schwarzes Fenster, kurz danach der Browser mit der Oberfläche **http://localhost:8787**. Im Fenster steht unter anderem:

```
Smart Lab 2.12.0 läuft (echte Marktdaten, simulierter Handel)
Oberfläche: http://localhost:8787   ·   Daten: C:\SmartLab\data
Beenden mit Strg+C (speichert vorher alles).
```

Danach erscheinen laufend wichtige Meldungen (Trades, Risiko, Lern-KI, Speicher, Warnungen).

- **Das Fenster muss offen bleiben.** Minimieren ist in Ordnung. Wird es geschlossen, endet der Bot.
- Nicht in das Fenster klicken: Im klassischen Konsolenfenster startet ein Klick die Textauswahl und hält damit die Ausgabe und den Bot an (Titelleiste zeigt „Auswählen“). Mit **Esc** geht es weiter.
- Der Browser-Tab mit der Oberfläche darf jederzeit geschlossen werden – der Bot läuft im Fenster weiter. Neu öffnen über http://localhost:8787.
- Beim allerersten Start beginnt der Bot mit leeren Daten und **Auto-Trading AUS**. Bis du es einschaltest, analysiert er nur.

**Beenden** – beide Wege speichern vorher alles (laufende Trades werden bis zu 10 s abgewartet):

- in der Oberfläche **„Bot beenden“** (unter „Daten & Einstellungen“), oder
- im Fenster **Strg+C**. Fragt Windows danach „Batchvorgang abbrechen (J/N)?“, mit J antworten.

Das Schließen des Fensters über das X speichert in der Regel auch, ist aber nicht garantiert, weil Windows den Prozess nach kurzer Zeit hart beendet. Besser die beiden Wege oben nutzen.

**Die Oberfläche** fragt alle 2 s den Stand ab:

| Bereich | Inhalt und Knöpfe |
|---|---|
| Hinweis „Abgleich nach Neustart erforderlich“ | erscheint nur nach einem harten Abbruch mitten im Trade: listet die unklaren Punkte, Knopf „Geprüft – bestätigen“ (siehe „Häufige Fehler“) |
| Kopfzeile | Zustand des Bots, Auto-Trading AN/aus, „▶ Start“, „⏸ Pause“, „Auto-Trading an“, „Auto-Trading aus“, „⛔ Not-Aus“, „Not-Aus freigeben“ |
| Überblick | Kapital, Cash, im Markt, realisiert, Drawdown, Trades, Trefferquote, Ø je Trade, Profit Factor, letzter Scan, Laufzeit |
| Offene Positionen | je Position Einsatz, Wert, PnL, Stop, Anzahl Käufe, Knopf „Verkaufen“ (ganze Position) |
| Letzte Trades | die letzten 40 geschlossenen Trades mit Ergebnis, Grund und Coin-Quelle |
| Lern-KI | gespeicherte Trades, davon gelernt, „Ausgeschlossen (verzerrt)“ mit Gründen, Modell, Drift, aktive Regeln, Hypothesen, „▶ Lernlauf jetzt“ |
| Überwachung | aktive Anomalien und Zustand der Datenquellen |
| Daten & Einstellungen | „⬇ Voll-Backup herunterladen“, „⬇ Lern-Report (CSV)“, „⬇ Journal (JSON)“, „Einstellungen importieren (JSON)“, „Voll-Backup einspielen“, „Frischer Start“, „Bot beenden“ |
| Protokoll | die letzten 80 Meldungen |

**Startoptionen** (für Fortgeschrittene, siehe „Häufige Fehler“ für die Anwendung):

| Option | Wirkung |
|---|---|
| `--port 8788` | Oberfläche auf einem anderen Port (Standard 8787) |
| `--data D:\SmartLabDaten` | anderer Datenordner (Standard `data` im Programmordner) |
| `--no-open` | Browser beim Start nicht automatisch öffnen |
| `--no-autostart` | Scanner nicht automatisch starten (dann „▶ Start“ in der Oberfläche) |
| `--mock` | Testdaten ohne Internet, nur für Tests; ohne `--data` landen sie im eigenen Ordner `data-mock`, nie in den echten Daten |

## 4. Daten aus dem Browser übernehmen

Pro Datenbestand darf immer nur **ein** Bot laufen. Sonst entstehen zwei Historien, die auseinanderlaufen. Deshalb in dieser Reihenfolge:

1. **Browser-App** öffnen und anmelden. Oben in der Übersicht den Schalter **„Auto-Trading“ auf AUS** stellen.
2. **⚙ Einstellungen** → Bereich **„Export / Import / Reset“** aufklappen → **„⬇ Voll-Backup (alle Daten)“**. Die Datei `smartlab-backup-….json` landet im Download-Ordner.
3. **Browser-Tab schließen.** Auch mit Auto-Trading AUS verwaltet die Browser-App offene Positionen weiter (Stops, Gewinnmitnahmen). Bleibt sie offen, verkauft sie dieselben Positionen ein zweites Mal in ihrer eigenen Kopie der Daten. Die Browser-App danach nicht mehr zum Handeln nutzen.
4. **PC-Oberfläche** → „Daten & Einstellungen“ → **„Voll-Backup einspielen (ersetzt alle Daten hier)“** → Datei auswählen → Rückfrage bestätigen. Meldung: „Backup eingespielt, Bot neu gestartet“.
5. Kontrollieren: Kapital, offene Positionen und letzte Trades müssen zum Browser passen.
6. **„Auto-Trading an“** klicken.

Hinweise:

- Die Sicherung wird vor dem Einspielen vollständig geprüft und probeweise geladen. Eine Sicherung aus einer **neueren** App-Version wird abgelehnt („Sicherung stammt aus der neueren Version …“) – dann zuerst den PC-Bot aktualisieren (Abschnitt 7).
- Anders als im Browser lädt der PC-Bot vor dem Einspielen **keine** automatische Sicherung des bisherigen Stands herunter. Hat der PC-Bot schon eigene Daten, vorher „⬇ Voll-Backup herunterladen“.
- Das Backup enthält selbst eingetragene RPC-Adressen und einen eventuell eingetragenen Jupiter-API-Key. Die Datei vertraulich behandeln und nach dem Einspielen aus dem Download-Ordner löschen.

**Einmalige Datenbereinigung (2.12.0):** Beim ersten Start eines Datenbestands mit Version 2.12.0 prüft der Bot alle gespeicherten Trades auf verzerrte Ergebnisse. Das passiert genau einmal – im Browser, falls du dort schon 2.12.0 geöffnet hattest, sonst nach dem Einspielen auf dem PC. Zu sehen ist:

- im Fenster bzw. Protokoll zwei Meldungen der Lern-KI: „Migration: Slippage für … Trades mit der korrigierten Formel neu berechnet (Ergebnisse unverändert)“ und „Datenbereinigung 2.12.0: … von … Trades zählen nicht mehr fürs Lernen (…) · Muster, Lektionen und Modell neu aus … sauberen Trades · … Hypothesen werden neu getestet“,
- in der Oberfläche unter „Lern-KI“ die Zahl „Ausgeschlossen (verzerrt)“ mit den Gründen (z. B. „mehr als 3 Käufe in eine Position“),
- Lektionen, Drift und Kalibrierung sind kurz leer und werden beim nächsten Lernlauf neu berechnet (automatisch oder mit „▶ Lernlauf jetzt“); bisherige Hypothesen stehen wieder auf Anfang und werden mit den sauberen Trades neu getestet.

Gelöscht wird dabei nichts, auch Kapital und Ergebnisse ändern sich nicht. Was genau ausgeschlossen wird und warum: `docs/LERNDATEN.md`.

## 5. Rund um die Uhr laufen lassen

**Energiesparmodus ausschalten:** Einstellungen → System → „Netzbetrieb und Akku“ (Windows 10: „Netzbetrieb und Energiesparen“) → „Bildschirm und Energiesparmodus“: Energiesparmodus im Netzbetrieb auf **„Nie“**. Der Bildschirm darf ausgehen. Bei einem Laptop zusätzlich in der Systemsteuerung unter „Energieoptionen“ → „Auswählen, was beim Zuklappen des Computers geschehen soll“ im Netzbetrieb „Nichts unternehmen“ einstellen.

**Autostart einrichten:**

1. Windows-Taste + R drücken, `shell:startup` eingeben, Enter. Der Autostart-Ordner öffnet sich.
2. In einem zweiten Explorer-Fenster `C:\SmartLab` öffnen, Rechtsklick auf `start-bot.bat` → „Verknüpfung erstellen“ (unter Windows 11 zuerst „Weitere Optionen anzeigen“).
3. Die Verknüpfung in den Autostart-Ordner verschieben.
4. Optional: Rechtsklick auf die Verknüpfung → „Eigenschaften“. Bei „Ausführen“ „Minimiert“ wählen. Damit sich nicht bei jedem Start der Browser öffnet, im Feld „Ziel“ hinten ` --no-open` anhängen, z. B. `C:\SmartLab\start-bot.bat --no-open`.

**Windows-Updates:** Updates starten den PC gelegentlich neu. Der Autostart bringt den Bot zurück, allerdings erst **nach der Anmeldung** am PC. Damit Windows sich nach einem Update-Neustart selbst anmeldet, unter Einstellungen → Konten → Anmeldeoptionen die Option „Meine Anmeldeinformationen verwenden, um die Einrichtung nach einem Update automatisch abzuschließen“ einschalten. Offene Positionen und alle Daten sind gespeichert; nach dem Neustart gleicht der Bot seinen Stand ab und macht weiter. Wurde er dabei mitten in einem Trade hart beendet, sperrt er neue Käufe bis zu einem bestätigten Abgleich (siehe „Häufige Fehler“).

**Sicherungen:** Der Bot schreibt selbst täglich eine Vollsicherung nach `C:\SmartLab\data\backups` (Abschnitt 8). Ab und zu eine Kopie davon auf einen USB-Stick o. Ä. legen schützt auch vor einem Festplattenschaden.

## 6. Einstellungen ändern

Die PC-Oberfläche ist eine Übergangslösung und hat noch keinen eigenen Einstellungs-Editor. Einstellungen werden als Datei übernommen:

1. In der Browser-App die Einstellungen ändern.
2. ⚙ Einstellungen → „Export / Import / Reset“ → „⬇ Settings JSON“.
3. In der PC-Oberfläche „Einstellungen importieren (JSON)“ → Datei auswählen.

Die Browser-App arbeitet dabei mit ihrer alten Kopie der Daten; die Daten auf dem PC berührt das nicht. Den Browser-Tab danach wieder schließen. Übernommen werden Einstellungen, Strategien und Watchlist. Ein Jupiter-API-Key steht aus Sicherheitsgründen nicht in dieser Datei; er kommt nur über ein Voll-Backup auf den PC.

Achtung: Der Import ersetzt alle Einstellungen des PC-Bots – auch Werte, die die Lern-KI auf dem PC inzwischen übernommen hat. Deshalb nur nutzen, wenn wirklich etwas geändert werden muss, und vorher „⬇ Voll-Backup herunterladen“.

## 7. Updates

1. Bot beenden („Bot beenden“ oder Strg+C).
2. Neue ZIP-Datei wie in Abschnitt 2 herunterladen und entpacken.
3. Alles nach `C:\SmartLab` kopieren und vorhandene Dateien ersetzen – **außer dem Ordner `data`**. Den Programmordner also nicht vorher löschen; die ZIP-Datei enthält keinen `data`-Ordner, deshalb bleibt er beim Überschreiben erhalten.
4. `start-bot.bat` wieder starten. Im Fenster steht die neue Versionsnummer.

Mit Git statt ZIP: Bot beenden, dann im Ordner `C:\SmartLab` `git pull` ausführen und neu starten. Der Ordner `data` ist von Git ausgeschlossen und bleibt unberührt.

Eigene Änderungen an `start-bot.bat` (z. B. ein anderer Port) werden bei einem Update überschrieben. Startoptionen deshalb besser in der Verknüpfung eintragen (Abschnitt 5).

Die Browser-App aktualisiert sich von selbst; der PC-Bot nur auf diesem Weg. Eine Sicherung lässt sich nur in eine gleich alte oder neuere Version einspielen.

## 8. Wo die Daten liegen

Alles liegt im Ordner `data` im Programmordner (oder im Ordner aus `--data`):

| Datei / Ordner | Inhalt |
|---|---|
| `smartlab.v3.settings.json` … `smartlab.v3.patterns.json` | je Speicherbereich eine Datei (10 Stück: Einstellungen, Laufzeit, Positionen, Trades, Logs, Statistik, Lerndaten, Experimente, Modelle, Muster) – gleiche Bereiche und gleiches Format wie im Browser |
| `.lock` | Sperrdatei, solange der Bot läuft (verhindert einen zweiten Bot mit denselben Daten) |
| `logs\bot-JJJJ-MM-TT.log` | ein Protokoll je Tag, alle Meldungen außer DEBUG; Dateien älter als 30 Tage löscht der Bot |
| `backups\smartlab-backup-JJJJ-MM-TT.json` | tägliche Vollsicherung |

- Gespeichert wird über eine temporäre Datei und anschließendes Umbenennen. Ein Absturz mitten im Schreiben hinterlässt deshalb keine halbe Datei.
- Die erste Tagessicherung entsteht etwa 1 Minute nach dem Start, danach alle 6 Stunden; innerhalb eines Tages wird die Datei überschrieben. Die 14 neuesten Dateien bleiben erhalten, ältere löscht der Bot.
- Protokolle älter als 30 Tage löscht der Bot beim Start und einmal am Tag.
- Schlägt das Speichern einer Datei fehl (z. B. Virenscanner hält sie fest), meldet der Bot einen Speicherfehler und versucht es beim nächsten Speichern vollständig erneut. Anders als im Browser kürzt er dabei nie Daten.
- Datum im Dateinamen und Zeitstempel in den Protokollen sind in UTC (deutsche Zeit minus 1 bzw. 2 Stunden). Im Fenster steht die Ortszeit.
- Eine Tagessicherung wird wie jedes Backup über „Voll-Backup einspielen“ zurückgespielt.

**Umzug auf einen anderen PC oder später auf einen Server:** „⬇ Voll-Backup herunterladen“ in der PC-Oberfläche erzeugt dieselbe Art Datei wie „⬇ Voll-Backup (alle Daten)“ im Browser. Sie lässt sich auf einem anderen PC einspielen, im Browser über ⚙ Einstellungen → „Export / Import / Reset“ → „⬆ Backup wiederherstellen“, und ist auch das Übergabeformat für einen späteren Server. Zurück im Browser gilt dessen kleineres Lern-Gedächtnis; ältere Trades fallen dann weg (siehe `docs/LERNDATEN.md`). Den alten Bot nach dem Umzug nicht weiterlaufen lassen.

## 9. Häufige Fehler

| Meldung / Problem | Ursache | Lösung |
|---|---|---|
| „Node.js ist nicht installiert …“ (im Bot-Fenster) oder „Der Befehl "node" ist entweder falsch geschrieben oder konnte nicht gefunden werden“ | Node.js fehlt, oder das Fenster wurde vor der Installation geöffnet | Abschnitt 1 wiederholen; danach ein **neues** Fenster öffnen bzw. `start-bot.bat` neu starten. Hilft das nicht: PC neu starten oder Node.js neu installieren |
| „Node.js … ist zu alt“ | Version unter 20 | Node.js 24 LTS installieren (Abschnitt 1) |
| „Port 8787 ist belegt – läuft der Bot schon? Sonst mit --port 8788 starten.“ | Ein anderes Programm (oder ein zweiter Bot mit anderem Datenordner) nutzt den Port | Zuerst prüfen, ob der Bot schon in einem anderen Fenster läuft. Sonst mit anderem Port starten: in der Autostart-Verknüpfung „Ziel“ auf `C:\SmartLab\start-bot.bat --port 8788` setzen, oder in `start-bot.bat` (Rechtsklick → „Bearbeiten“) die Zeile `node server\bot.js %*` in `node server\bot.js --port 8788 %*` ändern (wird bei Updates überschrieben). Oberfläche dann unter http://localhost:8788 |
| „Es läuft bereits ein Bot mit diesem Datenordner (Prozess …)“ | Sperrdatei `data\.lock`: ein Bot mit denselben Daten läuft schon | Das andere Fenster suchen und nutzen. Eine Sperre von vor dem letzten PC-Neustart erkennt der Bot selbst als verwaist. Nur wenn sicher kein Bot offen ist (im Task-Manager kein Eintrag „Node.js“ bzw. `node.exe`) und die Meldung trotzdem bleibt: `data\.lock` löschen und neu starten |
| Oberfläche zeigt „Bot nicht erreichbar – läuft das Fenster noch?“ | Bot-Fenster geschlossen oder Bot abgestürzt | `start-bot.bat` neu starten. Steht im Fenster eine Fehlermeldung, die letzte Datei in `data\logs` ansehen |
| „Sicherung stammt aus der neueren Version …“ | Backup aus einer neueren App-Version als der PC-Bot | PC-Bot aktualisieren (Abschnitt 7) |
| „Auto-Trading nur im SIMULATION-Modus (aktuell …)“ beim Klick auf „Auto-Trading an“ | Das Backup stammt aus der Browser-App in einem anderen Modus; die PC-Oberfläche kann den Modus nicht umstellen | In der Browser-App den Modus auf SIMULATION stellen, neues Voll-Backup erstellen und einspielen (Abschnitt 4) |
| „Der Computer wurde durch Windows geschützt“ beim Doppelklick | Windows SmartScreen bei Dateien aus dem Internet | „Weitere Informationen“ → „Trotzdem ausführen“, oder vor dem Entpacken die ZIP-Datei freigeben (Abschnitt 2) |
| Virenscanner meldet `start-bot.bat` oder blockiert Dateien in `data`; im Protokoll Speicherfehler | Der Scanner hält Dateien beim Speichern fest, oder die Festplatte ist voll | Den Ordner `C:\SmartLab` im Virenscanner als Ausnahme eintragen. Kurze Sperren wiederholt der Bot selbst; Daten werden dabei nie gekürzt |
| Bot scheint zu hängen, im Fenster passiert nichts | Textauswahl im Konsolenfenster aktiv („Auswählen“ in der Titelleiste) | Esc drücken |
| Status „BLOCKED“, im Überblick steht „Abgleich nach Neustart erforderlich – bitte prüfen & bestätigen“, es wird nichts mehr gekauft | Der Bot wurde mitten in einem Trade hart beendet (Stromausfall, Update-Neustart, Fenster geschlossen). Zur Sicherheit sperrt er neue Käufe, bis der Abgleich bestätigt ist | Offene Positionen werden weiter verwaltet und verkauft. Oben in der Oberfläche erscheint „Abgleich nach Neustart erforderlich“ mit den unklaren Punkten: Positionen und Kapital kurz prüfen, dann „Geprüft – bestätigen“. Danach kauft der Bot wieder, alle anderen Regeln gelten weiter. Vorbeugen: immer über „Bot beenden“ oder Strg+C beenden – dann lässt der Bot laufende Trades noch fertig werden (bis 10 s) und speichert |

## 10. Sicherheit

- Die Oberfläche lauscht nur auf `127.0.0.1` und ist **nur von diesem PC aus** erreichbar, nicht vom Handy und nicht aus dem Netzwerk. Anfragen mit fremdem Hostnamen werden abgelehnt, ändernde Anfragen brauchen eine feste Kennung im Header. Fremde Webseiten im selben Browser können den Bot dadurch nicht steuern. Fragt die Windows-Firewall trotzdem nach, muss kein Zugriff erlaubt werden.
- Die Oberfläche hat **keinen Login**. Wer an diesem Windows-Konto sitzt, kann den Bot bedienen.
- Der Handel ist **nur simuliert**. LIVE-Handel und Signieren sind gesperrt; auf dem PC gibt es keine Wallet, keine Seed-Phrase und keine privaten Schlüssel.
- Der Ordner `data` und alle Backups enthalten die Einstellungen inklusive selbst eingetragener RPC-Adressen und eines eventuell eingetragenen Jupiter-API-Keys. Nicht weitergeben und nicht öffentlich hochladen. Der Ordner `data` ist von Git ausgeschlossen.

## 11. Grenzen der Übergangs-Oberfläche (2.12.0)

Die PC-Oberfläche deckt den Betrieb ab, ist aber bewusst einfach gehalten. Noch nicht enthalten:

- ein Einstellungs-Editor (Einstellungen nur per Datei-Import, Abschnitt 6),
- eine Umstellung des Modus (der Modus kommt aus dem eingespielten Backup),
- Teilverkäufe (der Knopf „Verkaufen“ verkauft die ganze Position),
- die Analyse-Ansichten der Browser-App (Scanner, Charts, Backtest, Lern-Details). Für Auswertungen die Exporte nutzen. Ein Backup des PC-Bots nicht nebenher in die Browser-App einspielen: Diese würde sofort selbst weiterhandeln bzw. offene Positionen verkaufen.
