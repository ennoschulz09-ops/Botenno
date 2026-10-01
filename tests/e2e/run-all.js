// Führt alle Browser-Tests nacheinander aus und meldet eine Zusammenfassung (Exit-Code 1, sobald einer fehlschlägt).
const { spawnSync } = require('child_process');
const path = require('path');
const SUITES = ['selftest', 'login', 'ui', 'learning', 'backup', 'migration', 'bt', 'profile', 'xss'];
const only = process.argv.slice(2);
const results = [];
for (const name of SUITES.filter(s => !only.length || only.includes(s))) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, name + '.js')], { stdio: 'inherit', env: process.env, timeout: 6 * 60 * 1000 });
  results.push({ name, ok: r.status === 0, code: r.status, sec: Math.round((Date.now() - t0) / 1000) });
  console.log(`\n=== ${name}: ${r.status === 0 ? 'BESTANDEN' : 'FEHLGESCHLAGEN (Exit ' + r.status + ')'} · ${results.at(-1).sec} s\n`);
}
console.log('ZUSAMMENFASSUNG');
for (const r of results) console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${r.name} (${r.sec} s)`);
const failed = results.filter(r => !r.ok);
console.log(failed.length ? `${failed.length} von ${results.length} Test-Suiten fehlgeschlagen` : `Alle ${results.length} Test-Suiten bestanden`);
process.exit(failed.length ? 1 : 0);
