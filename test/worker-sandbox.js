/*
 * worker.js'i Node içinde, gerçek importScripts davranışıyla çalıştırır.
 * Hem worker testleri hem panel test koşumu bunu kullanır; böylece panel
 * testleri de gerçek motor worker'ıyla konuşur.
 */
'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');

function createWorkerSandbox(onPost) {
  const sandbox = {
    console, setTimeout, clearTimeout, Date, Math, JSON, Promise, Worker: undefined,
    postMessage: (m) => onPost(m)
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.importScripts = (...files) => {
    for (const f of files) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/engine', f), 'utf8'), sandbox, { filename: f });
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/engine/worker.js'), 'utf8'), sandbox, { filename: 'worker.js' });
  return sandbox;
}

module.exports = { createWorkerSandbox };
