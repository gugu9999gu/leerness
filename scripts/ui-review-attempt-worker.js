'use strict';

const fs = require('node:fs');
const path = require('node:path');
const API = require('../lib/ui-review-run');
const G = require('../lib/review-control-git');
const F = require('./ui-review-run-fixture');
const { encode } = require('./ui-review-fixture');
process.on('message', async ({ s, mode, gate }) => {
  const pause = phase => {
    process.send({ phase }); const deadline = Date.now() + 25000;
    while (!fs.existsSync(gate)) {
      if (Date.now() > deadline) throw new Error('worker barrier timeout');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  };
  const original = G.run;
  G.run = (...args) => {
    const body = String(args[2]);
    const phase = body.includes('create refs/leerness/review-attempts/') ? 'reserve'
      : body.includes('update refs/leerness/review-attempts/') ? 'start'
        : body.includes('create refs/leerness/review-results/') ? 'result'
          : body.includes('create refs/leerness/review-runs/') ? 'retain' : null;
    if (phase && mode === 'before-' + phase) pause(mode);
    const result = original(...args);
    if (phase && mode === 'after-' + phase && result.status === 0) pause(mode);
    return result;
  };
  try {
    if (mode === 'read') {
      process.send({ result: { ok: true, value: API.readUiReviewAttempt(s.root, s.run.batchId, s.run.runId) } }, () => process.exit(0)); return;
    }
    const handle = mode.startsWith('recover') ? API.recoverUiReviewRun(s.root, encode(s.run)) : await F.observe(s, (supplied, rc) => {
      fs.appendFileSync(path.join(s.root, 'callbacks.log'), 'called\n');
      if (mode === 'callback') pause(mode);
      F.terminal(s, supplied, rc); return encode(rc);
    });
    if (mode === 'recover-race') pause('recover-race');
    if (mode === 'after-callback') pause(mode);
    const value = API.retainUiReviewRun(handle);
    process.send({ result: { ok: true, head: value.head } }, () => process.exit(0));
  } catch (error) { process.send({ result: { ok: false, code: error.code, name: error.name } }, () => process.exit(0)); }
});
process.send({ ready: true });
