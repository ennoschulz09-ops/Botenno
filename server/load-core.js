// Lädt den Kern der App in Node.js – genau dieselben Dateien wie im Browser (js/base.js … js/core.js), nur ohne
// Oberfläche (js/ui.js braucht ein DOM). Die Dateien sind klassische Skripte mit gemeinsamem globalem Gültigkeitsbereich;
// vm.runInThisContext gibt ihnen hier denselben Rahmen. Darf pro Prozess nur einmal laufen.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CORE_FILES = ['js/base.js', 'js/engine.js', 'js/learning.js', 'js/core.js'];
let loaded = null;

function loadCore({ withTests = false } = {}) {
  if (loaded) {
    if (withTests && !loaded.tests) throw new Error('Kern wurde bereits ohne Selbsttests geladen');
    return loaded.api;
  }
  const files = withTests ? [...CORE_FILES, 'js/selftest.js'] : CORE_FILES;
  for (const f of files) {
    const file = path.join(ROOT, f);
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
  }
  const get = name => vm.runInThisContext(name);
  const api = {
    ROOT,
    get,
    createCore: get('createCore'),
    createMemoryBackend: get('createMemoryBackend'),
    APP_VERSION: get('APP_VERSION'),
    STORAGE_KEYS: get('STORAGE_KEYS'),
    LEARN_CAPS: get('LEARN_CAPS'),
    JOURNAL_CAPS: get('JOURNAL_CAPS'),
    perfStats: get('perfStats'),
    RECORD_FLAGS_DE: get('RECORD_FLAGS_DE'),
    runSelfTests: withTests ? get('runSelfTests') : null
  };
  loaded = { api, tests: withTests };
  return api;
}

module.exports = { loadCore, ROOT };
