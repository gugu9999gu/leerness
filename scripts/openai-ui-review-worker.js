'use strict';

const fs = require('node:fs');
const F = require('./openai-ui-review-fixture');
const G = require('../lib/review-control-git');
const sleep = new Int32Array(new SharedArrayBuffer(4));
process.on('message', async ({ s, mode, gate, port, cert, key, recoveryPolicy, receiptPolicy, observationPolicy, config = F.config }) => {
  const network = F.bridge(port, cert), original = G.run, originalOutput = G.output;
  function pause(phase) {
    process.send({ phase }); const deadline = Date.now() + 120000;
    while (!fs.existsSync(gate)) { if (Date.now() > deadline) throw new Error('fixture_gate_timeout'); Atomics.wait(sleep, 0, 0, 10); }
  }
  G.run = (...args) => {
    const txn = String(args[2]);
    const phase = txn.includes('create refs/leerness/review-dispatches/') ? 'intent'
      : txn.includes('update refs/leerness/review-attempts/') ? 'start'
        : txn.includes('create refs/leerness/review-locators/') ? 'locator'
          : txn.includes('create refs/leerness/provider-observations/') ? 'observation' : null;
    if (phase && mode === 'before-' + phase) pause(mode);
    const result = original(...args);
    if (phase && mode === 'after-' + phase) pause(mode);
    return result;
  };
  // Bundle object creation calls the exported output helper. Its underlying
  // lexical run() is not intercepted by assigning the exported G.run above.
  G.output = (...args) => {
    const bundle = args[1][0] === 'commit-tree' && String(args[2]) === 'leerness UI recovery bundle v1\n';
    if (bundle && mode === 'before-bundle') pause(mode);
    const result = originalOutput(...args);
    if (bundle && mode === 'after-bundle') pause(mode);
    return result;
  };
  let result;
  try {
    if (mode === 'lookup') result = { ok: true, value: await F.lookup(s, key) };
    else if (mode === 'receipt') result = { ok: true, value: await F.API.retrieveOpenAiUiReviewReceipt(s.root, F.encode(s.run), F.encode(s.input), F.encode(config.profile), key) };
    else if (['observe-receipt', 'before-observation', 'after-observation'].includes(mode)) result = { ok: true, value: await F.API.observeOpenAiUiReviewReceipt(s.root, F.encode(s.run), F.encode(s.input), F.encode(config.profile), key) };
    else if (mode === 'recover-receipt') result = { ok: true, value: F.API.recoverOpenAiUiReviewReceipt(s.root, F.encode(s.run), F.encode(s.input), F.encode(config.profile)) };
    else if (mode === 'read') result = { ok: true, value: F.read(s) };
    else if (mode === 'recover') {
      const h = F.API.recoverOpenAiUiReviewDispatch(s.root, F.encode(s.run), F.encode(s.input));
      const { sha } = require('../lib/ui-review-run-contract');
      result = { ok: true, value: h, digests: F.API.readRecoveredUiReviewMaterials(h).map(m => [m.kind, sha(m.bytes)]) };
    }
    else {
      const h = F.API.prepareOpenAiUiReviewDispatch(s.root, F.encode(s.run), F.encode(s.request), F.encode(s.input),
        F.encode(config), recoveryPolicy === undefined ? undefined : F.encode(recoveryPolicy), receiptPolicy === undefined ? undefined : F.encode(receiptPolicy),
        observationPolicy === undefined ? undefined : F.encode(observationPolicy));
      result = { ok: true, value: await F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key) };
    }
  } catch (e) { result = { ok: false, code: e.code || e.message }; }
  finally { G.run = original; G.output = originalOutput; network.restore(); }
  process.send({ result, contractErrors: network.errors }, () => process.disconnect());
});
process.send({ ready: true });
