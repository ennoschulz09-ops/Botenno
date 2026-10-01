// Prüft die JavaScript-Syntax des App-Skripts in index.html (schnell, ohne Browser).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!scripts.length) { console.error('Kein <script> in index.html gefunden'); process.exit(1); }
let bad = 0;
scripts.forEach((code, i) => { try { new vm.Script(code, { filename: `index.html#script${i}` }); } catch (e) { bad++; console.error(`Syntaxfehler in Skript ${i}: ${e.message}`); } });
console.log(bad ? `${bad} Skript(e) mit Syntaxfehlern` : `Syntax ok (${scripts.length} Skript(e))`);
process.exit(bad ? 1 : 0);
