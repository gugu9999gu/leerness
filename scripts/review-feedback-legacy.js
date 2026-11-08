'use strict';

// The feedback state machine, report and ledger normalizer are frozen byte for
// byte from 1.36.305. Unchanged IO/runtime dependencies come from this checkout.
// Full old-package CLI/MCP coverage additionally uses LEERNESS_PREVIOUS_INSTALL.
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto'), Module = require('module');
module.exports = function legacyReader() {
  const snapshot = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures/review-feedback-1.36.305.json.gz'))));
  const cache = new Map(), library = path.resolve(__dirname, '../lib');
  function load(name) {
    if (cache.has(name)) return cache.get(name).exports;
    const file = snapshot.files[name];
    if (!file || crypto.createHash('sha256').update(file.source).digest('hex') !== file.sha256) throw new Error('Legacy fixture digest mismatch');
    const filename = path.join(library, name), m = new Module(filename, module);
    m.filename = filename; m.paths = module.paths; cache.set(name, m);
    const nativeRequire = Module.createRequire(filename);
    m.require = id => {
      const key = id.startsWith('./') ? id.slice(2).replace(/\.js$/, '') + '.js' : null;
      return key && snapshot.files[key] ? load(key) : nativeRequire(id);
    };
    m._compile(file.source, filename);
    return m.exports;
  }
  return { feedback: load('review-feedback.js'), ledger: load('role-fallback.js'),
    sourcePackage: snapshot.sourcePackage, sourceTarballIntegrity: snapshot.sourceTarballIntegrity };
};
