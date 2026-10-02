// Führt alle Selbsttests der App unter Node.js aus (gleicher Code wie System → Selbsttest im Browser).
// Beweist, dass der Kern ohne Browser läuft. Aufruf: node server/selftest.js [Suchbegriff]
'use strict';
const { loadCore } = require('./load-core');

(async () => {
  const filter = (process.argv[2] || '').toLowerCase();
  const K = loadCore({ withTests: true });
  const SELF_TESTS = K.get('SELF_TESTS');
  if (filter) { const keep = SELF_TESTS.filter(([g, n]) => (g + ' ' + n).toLowerCase().includes(filter)); SELF_TESTS.length = 0; SELF_TESTS.push(...keep); }
  const t0 = Date.now();
  const results = await K.runSelfTests();
  const fail = results.filter(r => !r.ok);
  for (const r of results) if (!r.ok || process.env.VERBOSE) console.log(`${r.ok ? 'PASS' : 'FAIL'} [${r.group}] ${r.name}: ${r.detail}`);
  console.log(`Selbsttests unter Node.js ${process.version}: ${results.length - fail.length} von ${results.length} bestanden (${Math.round((Date.now() - t0) / 1000)} s)`);
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('Selbsttests abgebrochen:', e); process.exit(1); });
