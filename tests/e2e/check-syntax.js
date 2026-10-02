// Prüft die JavaScript-Syntax der App (index.html + js/*.js) ohne Browser und dass index.html alle Module
// in der richtigen Reihenfolge mit der aktuellen Version lädt (?v=APP_VERSION verhindert alte Dateien im Browser-Cache).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '../..');
const MODULES = ['js/base.js', 'js/engine.js', 'js/learning.js', 'js/core.js', 'js/selftest.js', 'js/ui.js'];
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let bad = 0;
const fail = msg => { bad++; console.error(msg); };
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
inline.forEach((code, i) => { try { new vm.Script(code, { filename: `index.html#script${i}` }); } catch (e) { fail(`Syntaxfehler in index.html (Skript ${i}): ${e.message}`); } });
for (const f of MODULES) { try { new vm.Script(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); } catch (e) { fail(`Syntaxfehler in ${f}: ${e.message}`); } }
const ver = (fs.readFileSync(path.join(ROOT, 'js/base.js'), 'utf8').match(/const APP_VERSION = '([\d.]+)'/) || [])[1];
const tags = [...html.matchAll(/<script src="([^"?]+)\?v=([^"]+)"><\/script>/g)].map(m => ({ file: m[1], v: m[2] }));
if (tags.map(t => t.file).join() !== MODULES.join()) fail(`index.html lädt nicht alle Module in der Reihenfolge ${MODULES.join(', ')} (gefunden: ${tags.map(t => t.file).join(', ') || 'keine'})`);
for (const t of tags) if (t.v !== ver) fail(`index.html: ${t.file}?v=${t.v} passt nicht zu APP_VERSION ${ver} – Version beim Release mit hochzählen`);
console.log(bad ? `${bad} Fehler` : `Syntax ok (index.html + ${MODULES.length} Module, Version ${ver})`);
process.exit(bad ? 1 : 0);
