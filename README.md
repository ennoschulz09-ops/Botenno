# Botenno – Smart Lab Solana Bot

Solana-Memecoin-Scanner mit Analyse, Security-Prüfung, simuliertem Handel und Lern-KI. Die App ist die Einzeldatei `index.html` (läuft im Browser, veröffentlicht über GitHub Pages): https://ennoschulz09-ops.github.io/Botenno/

Echter Handel ist gesperrt: Es gibt keinen Swap-Anbieter, Signieren ist deaktiviert. Architektur und Änderungsprotokoll: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).

## Tests

Bei jedem Push auf `main` und bei jedem PR laufen automatisch (GitHub Actions, `.github/workflows/tests.yml`):

- eine Syntax-Prüfung von `index.html`,
- die Selbsttests der App (System → Selbsttest),
- 8 Browser-Test-Suiten (Login, Oberfläche inkl. Mobil, Lern-KI, Backup, Migration, Backtest, Lernmodus-Profil, XSS-Schutz).

Lokal (Node.js 22):

```
npm ci
npx playwright install chromium
npm test                          # alles
node tests/e2e/run-all.js login   # nur einzelne Suiten
```

Das echte Login-Passwort wird dafür nicht gebraucht und steht nirgends im Repo. Ohne `E2E_USER`/`E2E_PASS` erzeugen die Tests eine Testkopie der App mit einem zufälligen Wegwerf-Passwort in `tests/e2e/out/` (ignoriert, wird nie veröffentlicht). Mit gesetzten Variablen laufen sie gegen die echte `index.html`. Screenshots landen ebenfalls in `tests/e2e/out/`.
