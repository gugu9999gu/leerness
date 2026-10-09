'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const API = require('../lib/ui-review-authorization');
const T = require('../lib/ui-review-target');
const U = require('../lib/ui-review-run');
const G = require('../lib/review-control-git');
const J = require('../lib/ui-review-result');
const F = require('./ui-review-run-fixture');
const { encode } = require('./ui-review-fixture');

async function setup(root, edit, linked = true) {
  const s = F.setup(root);
  const observed = await F.observe(s, edit || !linked ? (supplied, rc) => {
    if (edit) edit(rc, s); if (linked) F.terminal(s, supplied, rc); return encode(rc);
  } : undefined);
  const saved = U.retainUiReviewRun(observed); s.ctx = G.context(s.root, s.run.batchId);
  fs.mkdirSync(path.join(s.root, 'records')); fs.writeFileSync(path.join(s.root, 'records/run.json'), saved.recordJson);
  F.cmd(s.root, ['add', '--', 'records/run.json', ...s.request.files.map(f => f.path)]); F.cmd(s.root, ['commit', '-qm', 'authorization target']);
  const commit = F.cmd(s.root, ['rev-parse', 'HEAD']); F.cmd(s.root, ['update-ref', 'refs/heads/candidate', commit]);
  s.descriptor = { schema: T.INPUT_SCHEMA, target: { schema: U.RETENTION_SCHEMA, batchId: s.run.batchId, runId: s.run.runId,
    ref: 'refs/heads/candidate', commit, recordPath: 'records/run.json' }, runCommit: saved.head,
    resultCommit: G.readRef(J.context(s.ctx, s.run.runId)), recordDigest: saved.recordDigest };
  const keys = crypto.generateKeyPairSync('ed25519'); s.privateKey = keys.privateKey;
  s.policy = { schema: API.POLICY_SCHEMA, issuerId: 'fixture-issuer', keyId: 'fixture-key',
    publicKeySpki: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    projectKey: s.ctx.projectKey, targetRef: s.descriptor.target.ref, maxValidityMs: 3600000 };
  const now = Date.now(); s.challenge = { challengeId: crypto.randomBytes(32).toString('hex'), issuedAt: now, expiresAt: now + 3600000 };
  return s;
}
function signing(handle, key, text = handle.signingText) {
  return { schema: API.PROOF_SCHEMA, payloadDigest: handle.payloadDigest,
    signature: crypto.sign(null, Buffer.from(text, 'utf8'), key).toString('base64') };
}
module.exports = { setup, signing };
