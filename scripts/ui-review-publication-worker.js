'use strict';
const fs = require('node:fs');
const https = require('node:https');
const P = require('../lib/openai-ui-review-publication');
const U = require('../lib/ui-review-run');
const G = require('../lib/review-control-git');
const F = require('../lib/role-fallback');
const wait = new Int32Array(new SharedArrayBuffer(4));
let networkCalls = 0;
https.request = () => { networkCalls++; throw new Error('publication_must_be_offline'); };
process.on('message', ({ s, profile, policy, mode, gate }) => {
  const originalRun = G.run, originalAppend = F.appendExecutionEvent;
  const pause = phase => {
    process.send({ phase }); const end = Date.now() + 120000;
    while (!fs.existsSync(gate)) { if (Date.now() > end) throw Error('gate_timeout'); Atomics.wait(wait, 0, 0, 10); }
  };
  G.run = (...args) => {
    const resultWrite = String(args[2]).includes('create refs/leerness/review-results/');
    if (resultWrite && mode === 'before-result') pause(mode);
    const out = originalRun(...args);
    if (resultWrite && mode === 'after-result') pause(mode);
    return out;
  };
  F.appendExecutionEvent = (...args) => {
    if (mode === 'before-terminal') pause(mode);
    const out = originalAppend(...args);
    if (mode === 'after-terminal') pause(mode);
    return out;
  };
  let result;
  try {
    if (mode === 'recover-run') {
      const handle = U.recoverUiReviewRun(s.root, JSON.stringify(s.run));
      result = { ok: true, value: U.retainUiReviewRun(handle) };
    } else {
      const h = P.prepareOpenAiUiReviewPublication(s.root, JSON.stringify(s.run), JSON.stringify(s.input), JSON.stringify(profile), JSON.stringify(policy));
      if (mode === 'before-publish') pause(mode);
      result = { ok: true, value: P.publishOpenAiUiReviewResult(h, h.publicationDigest) };
    }
  } catch (e) { result = { ok: false, code: e.code || e.message }; }
  finally { G.run = originalRun; F.appendExecutionEvent = originalAppend; }
  process.send({ result, networkCalls }, () => process.disconnect());
});
process.send({ ready: true });
