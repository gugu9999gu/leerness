'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const git = require('../lib/git');
let reading = false, reads = 0;
const originalGit = git.gitSpawn;
git.gitSpawn = (args, options) => {
  if (reading) {
    reads++;
    const writes = ['update-ref', 'hash-object', 'mktree', 'commit-tree', 'update-index', 'add', 'commit', 'fetch'];
    const command = args.find(v => [...writes, 'cat-file', 'ls-tree', 'symbolic-ref', 'for-each-ref', 'rev-parse', 'config', 'status', 'rev-list'].includes(v));
    assert.ok(!writes.includes(command), 'unexpected Git mutation/network: ' + command);
  }
  return originalGit(args, options);
};
for (const name of ['node:http', 'node:https']) for (const key of ['request', 'get']) {
  require(name)[key] = () => { throw new Error('unexpected network'); };
}
const API = require('../lib/ui-review-authorization');
const T = require('../lib/ui-review-target');
const R = require('../lib/ui-review-run-contract');
const G = require('../lib/review-control-git');
const Control = require('../lib/review-control');
const A = require('../lib/ui-review-attempt');
const J = require('../lib/ui-review-result');
const F = require('./ui-review-run-fixture');
const { clone, encode } = require('./ui-review-fixture');
const reject = (fn, code) => assert.throws(fn, e => { assert.equal(e.code, code); return true; });
function readonly(s, fn) {
  const before = F.snapshot(s.root); reading = true;
  try { return fn(); }
  finally { reading = false; assert.deepEqual(F.snapshot(s.root), before, 'file bytes/mtime changed'); }
}
function noAuthority(v) {
  for (const k of ['actorIdentityVerified', 'semanticVerified', 'acceptedAuthorityVerified', 'approvalGranted', 'cleanupAllowed', 'policySourceVerified', 'challengeConsumed']) assert.equal(v[k], false);
  assert.equal(v.independentReview, 'not-verified');
  assert.ok(Object.isFrozen(v)); assert.ok(Object.isFrozen(v.binding || v.payload.binding));
}
const { setup: setupFixture, signing } = require('./ui-review-authorization-fixture');
function prepare(s, policy = s.policy, challenge = s.challenge, run = s.run) {
  return API.prepareUiReviewAuthorization(s.root, encode(run), encode(s.descriptor), encode(s.input), encode(policy), encode(challenge));
}
function verify(s, proof = s.proof, policy = s.policy, current = s.input, handle = s.handle) {
  return API.verifyUiReviewAuthorization(handle, encode(proof), encode(policy), encode(current));
}
async function main() {
  const args = process.argv.slice(2), smoke = args[0] === '--smoke', filter = args[0] === '--filter' ? args[1] : null;
  assert.ok(!args.length || (args.length === 1 && smoke) || (args.length === 2 && filter), 'use --smoke or --filter <substring>');
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-authority-'));
  let base, sequence = 0, total = 0, passed = 0;
  async function setup(edit, linked = true) { return setupFixture(path.join(arena, 'case-' + sequence++), edit, linked); }
  async function common() {
    if (!base) { base = await setup(); base.handle = readonly(base, () => prepare(base)); base.proof = signing(base.handle, base.privateKey); }
    return base;
  }
  async function test(name, fn, selected = false) {
    if ((smoke && !selected) || (filter && !name.includes(filter))) return;
    total++; const start = Date.now(); console.log('RUN ' + name);
    try { await fn(); passed++; console.log(`PASS ${name} (${((Date.now() - start) / 1000).toFixed(1)}s)`); }
    catch (e) { console.error('FAIL ' + name + ': ' + e.stack); }
  }
  try {
    await test('valid signature binds exact target and current owner without approval or writes', async () => {
      const s = await common(), out = readonly(s, () => verify(s)); noAuthority(out); noAuthority(s.handle);
      assert.equal(s.handle.payload.schema, 'leerness.ui-review-authorization-payload/v1');
      assert.equal(s.handle.signingText, 'leerness.ui-review-authorization/v1\n' + R.encode(s.handle.payload));
      assert.equal(Object.hasOwn(s.handle.payload, 'policySourceDigest'), false);
      assert.equal(out.signatureVerified, true); assert.equal(out.targetBindingVerified, true);
      assert.equal(out.binding.target.commit, s.descriptor.target.commit);
      assert.equal(out.binding.owner.sessionId, s.run.owner.sessionId);
      assert.ok(!s.handle.signingText.includes(s.run.owner.token));
      assert.equal(out.binding.recordDigest, s.descriptor.recordDigest);
      assert.deepEqual(out.effects, { filesRead: true, filesWritten: false, networkUsed: false, modelInvoked: false });
      assert.throws(() => { s.handle.payload.binding.target.commit = 'bad'; }, TypeError);
    }, true);
    await test('wrong key tampered payload signature and extra claimed authority reject before Git', async () => {
      const s = await common(), before = reads, other = crypto.generateKeyPairSync('ed25519');
      readonly(s, () => {
        for (const proof of [signing(s.handle, other.privateKey), signing(s.handle, s.privateKey, s.handle.signingText + ' '),
          { ...s.proof, signature: Buffer.alloc(64).toString('base64') }]) reject(() => verify(s, proof), 'authorization_signature_invalid');
        reject(() => verify(s, { ...s.proof, payloadDigest: R.sha('another') }), 'authorization_proof_mismatch');
        reject(() => verify(s, { ...s.proof, acceptedAuthorityVerified: true }), 'input_invalid');
        reject(() => verify(s, { ...s.proof, signature: s.proof.signature.slice(0, -1) }), 'input_invalid');
        reject(() => verify(s, s.proof, s.policy, s.input, clone(s.handle)), 'authorization_handle_invalid');
        reject(() => API.verifyUiReviewAuthorization(s.handle, encode(s.proof), undefined, encode(s.input)), 'authorization_policy_invalid');
      }); assert.equal(reads, before);
    }, true);
    await test('malformed noncanonical and replaced policies reject before Git', async () => {
      const s = await common(), before = reads, other = crypto.generateKeyPairSync('ed25519');
      readonly(s, () => {
        for (const change of [{ publicKeySpki: s.policy.publicKeySpki + '\n' }, { publicKeySpki: Buffer.alloc(44).toString('base64') },
          { publicKeySpki: s.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64') },
          { targetRef: 'refs/heads/../escape' }, { maxValidityMs: 3600001 }, { maxValidityMs: 0 }, { accepted: true }]) {
          reject(() => prepare(s, { ...s.policy, ...change }), 'authorization_policy_invalid');
        }
        for (const change of [{ keyId: 'new-key' }, { issuerId: 'new-issuer' }, { maxValidityMs: 1000 },
          { publicKeySpki: other.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }]) {
          reject(() => verify(s, s.proof, { ...s.policy, ...change }), 'authorization_policy_changed');
        }
        reject(() => API.prepareUiReviewAuthorization(s.root, encode(s.run), encode(s.descriptor), encode(s.input),
          encode(s.policy).replace('"schema":', '"keyId":"duplicate","schema":'), encode(s.challenge)), 'authorization_policy_invalid');
      }); assert.equal(reads, before);
    }, true);
    await test('invalid future expired and excessive challenges reject before Git', async () => {
      const s = await common(), before = reads;
      readonly(s, () => {
        for (const change of [{ challengeId: 'short' }, { issuedAt: -1 }, { expiresAt: s.challenge.issuedAt },
          { expiresAt: s.challenge.issuedAt + 3600001 }, { issuedAt: 1.5 }, { accepted: true }]) {
          reject(() => prepare(s, s.policy, { ...s.challenge, ...change }), 'input_invalid');
        }
        const clock = Date.now;
        try {
          Date.now = () => s.challenge.issuedAt - 1;
          reject(() => prepare(s), 'authorization_expired_or_future'); reject(() => verify(s), 'authorization_expired_or_future');
          Date.now = () => s.challenge.expiresAt;
          reject(() => prepare(s), 'authorization_expired_or_future'); reject(() => verify(s), 'authorization_expired_or_future');
        } finally { Date.now = clock; }
      }); assert.equal(reads, before);
    }, true);
    await test('project target and owner substitutions cannot reuse proof', async () => {
      const s = await common(); readonly(s, () => {
        for (const change of [{ projectKey: 'another-project' }, { targetRef: 'refs/heads/other' }]) reject(() => prepare(s, { ...s.policy, ...change }), 'authorization_scope_mismatch');
        for (const owner of [{ ...s.run.owner, sessionId: 'other-session' }, { ...s.run.owner, token: 'a'.repeat(64) }]) {
          reject(() => prepare(s, s.policy, s.challenge, { ...s.run, owner }), 'owner_mismatch');
        }
      });
    });
    await test('changed current criteria and contributors reject and fresh input is mandatory', async () => {
      const s = await common(); readonly(s, () => {
        reject(() => API.verifyUiReviewAuthorization(s.handle, encode(s.proof), encode(s.policy)), 'input_invalid');
        const criteria = clone(s.input); criteria.snapshot.materials.acceptanceDigest = R.sha('changed');
        reject(() => verify(s, s.proof, s.policy, criteria), 'snapshot_mismatch');
        const current = clone(s.input); current.contributors[0].attemptId = 'changed';
        reject(() => verify(s, s.proof, s.policy, current), 'authorization_review_ineligible');
      });
    });
    await test('target and live control changes after signing reject', async () => {
      const s = await common(), t = s.descriptor.target;
      F.cmd(s.root, ['update-ref', t.ref, s.run.expectedHead]);
      try { readonly(s, () => reject(() => verify(s), 'target_changed')); }
      finally { F.cmd(s.root, ['update-ref', t.ref, t.commit]); }
      Control.writeReviewControl(s.root, encode({ ...s.common, operation: 'release', operationId: 'release-after-signing', expectedHead: s.run.expectedHead, generation: s.run.generation, snapshot: null }));
      try { readonly(s, () => reject(() => verify(s), 'control_changed')); }
      finally { F.cmd(s.root, ['update-ref', s.ctx.ref, s.run.expectedHead]); }
    });
    await test('owner control movement during target read is rejected', async () => {
      const s = await common(), assess = T.assessUiReviewTarget; let moved = false;
      T.assessUiReviewTarget = (...args) => {
        const out = assess(...args); reading = false;
        try { Control.writeReviewControl(s.root, encode({ ...s.common, operation: 'release', operationId: 'release-during-read', expectedHead: s.run.expectedHead, generation: s.run.generation, snapshot: null })); }
        finally { reading = true; } moved = true; return out;
      };
      reading = true;
      try { reject(() => verify(s), 'control_changed'); assert.equal(moved, true); }
      finally { reading = false; T.assessUiReviewTarget = assess; F.cmd(s.root, ['update-ref', s.ctx.ref, s.run.expectedHead]); }
    });
    await test('target movement between target assessment and final control check rejects', async () => {
      const s = await common(), assess = T.assessUiReviewTarget;
      const refs = [[s.descriptor.target.ref, s.descriptor.target.commit], [A.runRef(s.ctx, s.run.runId), s.descriptor.runCommit],
        [J.context(s.ctx, s.run.runId).ref, s.descriptor.resultCommit], [A.context(s.ctx, s.run.runId).ref, G.readRef(A.context(s.ctx, s.run.runId))]];
      for (const [ref, head] of refs) {
        let moved = false;
        T.assessUiReviewTarget = (...args) => {
          const out = assess(...args); reading = false;
          try { F.cmd(s.root, ['update-ref', ref, s.run.expectedHead]); }
          finally { reading = true; } moved = true; return out;
        };
        reading = true;
        try { reject(() => verify(s), 'target_changed'); assert.equal(moved, true); }
        finally { reading = false; T.assessUiReviewTarget = assess; F.cmd(s.root, ['update-ref', ref, head]); }
      }
    });
    await test('expiration during target read rejects prepare and verify', async () => {
      const s = await common(), assess = T.assessUiReviewTarget, clock = Date.now;
      T.assessUiReviewTarget = (...args) => { const out = assess(...args); Date.now = () => s.challenge.expiresAt; return out; };
      try {
        for (const fn of [() => prepare(s), () => verify(s)]) { Date.now = clock; readonly(s, () => reject(fn, 'authorization_expired_or_future')); }
      } finally { T.assessUiReviewTarget = assess; Date.now = clock; }
    });
    for (const [name, edit, linked] of [
      ['incomplete coverage', rc => rc.coverage.pop(), true],
      ['same-session review', (rc, s) => { rc.reviewer.sessionId = s.input.contributors[0].executor.sessionId; }, true],
      ['unlinked successful declarations', null, false],
    ]) await test(name + ' cannot prepare authorization', async () => {
      const s = await setup(edit, linked); readonly(s, () => reject(() => prepare(s), 'authorization_review_ineligible'));
    });
    await test('rechecking under dry-run is read-only and does not consume challenge', async () => {
      const s = await common(), io = require('../lib/io'); io.setDryRunGuard(true); git.setGitDryRun(true);
      try { const a = readonly(s, () => verify(s)), b = readonly(s, () => verify(s)); assert.deepEqual(a, b); noAuthority(b); }
      finally { io.setDryRunGuard(false); git.setGitDryRun(false); }
    });
    assert.ok(total > 0, 'zero matching tests is failure');
    console.log(`Tests: ${passed} passed, ${total - passed} failed, ${total} total`);
    if (passed !== total) process.exitCode = 1;
  } finally {
    const resolved = fs.realpathSync(arena); assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('lr-authority-'));
    for (let attempt = 0; ; attempt++) {
      try { fs.rmSync(resolved, { recursive: true, force: true }); break; }
      catch (e) { if (attempt >= 5 || !['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES'].includes(e.code)) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1)); }
    }
  }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
