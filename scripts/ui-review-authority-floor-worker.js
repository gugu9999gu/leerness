'use strict';

const fs = require('node:fs');
const path = require('node:path');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
if (input.barrier) {
  const git = require('../lib/git'), original = git.gitSpawn;
  git.gitSpawn = (args, options) => {
    if (args.includes('update-ref')) {
      fs.writeFileSync(path.join(input.barrier, input.id), 'ready');
      const deadline = Date.now() + 15000;
      while (!fs.existsSync(path.join(input.barrier, 'release'))) {
        if (Date.now() >= deadline) throw new Error('barrier timeout');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    return original(args, options);
  };
}
try {
  const S = require('../lib/ui-review-authority-floor');
  const result = S.openUiReviewAuthorityFloor(input.root, JSON.stringify(input.anchor)).observe(JSON.stringify(input.certificate));
  console.log(JSON.stringify({ ok: true, result }));
} catch (e) { console.log(JSON.stringify({ ok: false, code: e.code || e.message })); }
