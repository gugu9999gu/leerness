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
const H = require('../lib/ui-review-authority-host');
const Auth = require('../lib/ui-review-authorization');
const C = require('../lib/review-control-contract');
const R = require('../lib/ui-review-run-contract');
const F = require('./ui-review-run-fixture');
const AF = require('./ui-review-authorization-fixture');
const { clone, encode } = require('./ui-review-fixture');
const reject = (fn, code) => assert.throws(fn, e => { assert.equal(e.code, code); return true; });
function readonly(s, fn) {
  const before = F.snapshot(s.root); reading = true;
  try { return fn(); }
  finally { reading = false; assert.deepEqual(F.snapshot(s.root), before, 'file bytes/mtime changed'); }
}
function noAuthority(value) {
  for (const key of ['policySourceVerified', 'actorIdentityVerified', 'semanticVerified', 'acceptedAuthorityVerified', 'approvalGranted', 'cleanupAllowed', 'challengeConsumed']) assert.equal(value[key], false);
  assert.equal(value.policySource.policySignatureVerified, true); assert.equal(value.policySource.hostIdentityVerified, false);
  assert.equal(value.independentReview, 'not-verified'); assert.ok(Object.isFrozen(value.policySource));
}
function makeHost(s) {
  const keys = crypto.generateKeyPairSync('ed25519'), now = Date.now();
  const anchor = { schema: H.ANCHOR_SCHEMA, hostId: 'fixture-host',
    publicKeySpki: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    projectKey: s.policy.projectKey, targetRef: s.policy.targetRef, minRevision: 1, maxPolicyValidityMs: 86400000 };
  const payload = { schema: H.POLICY_SCHEMA, hostId: anchor.hostId, revision: 1,
    issuedAt: now, expiresAt: now + 4 * 3600000, policy: s.policy };
  const sign = (value, key = keys.privateKey) => ({ ...value,
    signature: crypto.sign(null, Buffer.from(H.POLICY_DOMAIN + R.encode(value), 'utf8'), key).toString('base64') });
  const state = { text: encode(sign(payload)), calls: 0, hook: null };
  const reader = () => { state.calls++; if (state.hook) state.hook(); return state.text; };
  return { anchor, payload, sign, state, reader, host: H.createUiReviewAuthorityHost(encode(anchor), reader) };
}
const prepare = (s, h, challenge = s.challenge) => h.host.prepare(s.root, encode(s.run), encode(s.descriptor), encode(s.input), encode(challenge));
const verify = (s, h, handle = h.handle, proof = h.proof) => h.host.verify(handle, encode(proof), encode(s.input));
async function main() {
  const args = process.argv.slice(2), smoke = args[0] === '--smoke', filter = args[0] === '--filter' ? args[1] : null;
  assert.ok(!args.length || (args.length === 1 && smoke) || (args.length === 2 && filter), 'use --smoke or --filter <substring>');
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-authority-host-'));
  let base, standard, passed = 0, total = 0;
  async function common() { if (!base) base = await AF.setup(path.join(arena, 'repo')); return base; }
  async function ready() {
    const s = await common();
    if (!standard) { standard = makeHost(s); standard.handle = readonly(s, () => prepare(s, standard)); standard.proof = AF.signing(standard.handle, s.privateKey); }
    return { s, h: standard };
  }
  async function test(name, fn, selected = false) {
    if ((smoke && !selected) || (filter && !name.includes(filter))) return;
    total++; const start = Date.now(); console.log('RUN ' + name);
    try { await fn(); passed++; console.log(`PASS ${name} (${((Date.now() - start) / 1000).toFixed(1)}s)`); }
    catch (e) { console.error('FAIL ' + name + ': ' + e.stack); }
  }
  try {
    await test('valid host policy binds certificate and exact Git target without granting approval', async () => {
      const { s, h } = await ready(), out = readonly(s, () => verify(s, h));
      noAuthority(h.handle); noAuthority(out); assert.equal(out.signatureVerified, true);
      assert.equal(h.state.calls, 4); assert.equal(h.handle.payload.schema, 'leerness.ui-review-authorization-payload/v2');
      assert.ok(h.handle.signingText.startsWith('leerness.ui-review-authorization/v2\n'));
      assert.equal(h.handle.payload.policySourceDigest, C.digest(out.policySource));
      assert.equal(out.binding.target.commit, s.descriptor.target.commit);
      assert.equal(out.policySource.certificateDigest, C.digest(JSON.parse(h.state.text)));
      assert.ok(!h.handle.signingText.includes(s.run.owner.token));
      assert.throws(() => { h.handle.policySource.revision = 2; }, TypeError);
    }, true);
    await test('malformed anchors source digests and reader contracts reject before Git', async () => {
      const { s, h } = await ready(), before = reads;
      readonly(s, () => {
        for (const change of [{ minRevision: 0 }, { minRevision: 1.5 }, { maxPolicyValidityMs: 86400001 },
          { targetRef: 'refs/heads/../escape' }, { publicKeySpki: h.anchor.publicKeySpki + '\n' }, { accepted: true }]) {
          reject(() => H.createUiReviewAuthorityHost(encode({ ...h.anchor, ...change }), h.reader), 'authority_anchor_invalid');
        }
        reject(() => H.createUiReviewAuthorityHost(encode(h.anchor), null), 'authority_reader_invalid');
        reject(() => Auth.prepareUiReviewAuthorization(s.root, '', '', '', '', '', 'invalid'), 'input_invalid');
        for (const reader of [() => { throw new Error('private failure'); }, () => ({}), () => Promise.resolve(h.state.text)]) {
          const bad = H.createUiReviewAuthorityHost(encode(h.anchor), reader);
          reject(() => bad.prepare(s.root, '', '', '', ''), 'authority_policy_unavailable');
        }
        const bad = H.createUiReviewAuthorityHost(encode(h.anchor), () => h.state.text.replace('"revision":', '"revision":1,"revision":'));
        reject(() => bad.prepare(s.root, '', '', '', ''), 'input_invalid');
      }); assert.equal(reads, before);
    }, true);
    await test('self signed and modified policies cannot replace the pinned host signer', async () => {
      const s = await common(), h = makeHost(s), before = reads;
      readonly(s, () => {
        for (const certificate of [h.sign(h.payload, crypto.generateKeyPairSync('ed25519').privateKey),
          { ...h.sign(h.payload), expiresAt: h.payload.expiresAt - 1 },
          { ...h.sign(h.payload), policy: { ...s.policy, issuerId: 'impostor' } }]) {
          h.state.text = encode(certificate); reject(() => prepare(s, h), 'authority_policy_signature');
        }
      }); assert.equal(reads, before);
    }, true);
    await test('signed wrong scope future expired and excessive policies reject before Git', async () => {
      const s = await common(), h = makeHost(s), before = reads;
      readonly(s, () => {
        for (const [change, code] of [[{ hostId: 'another-host' }, 'authority_policy_scope'],
          [{ revision: 0 }, 'authority_policy_rollback'], [{ issuedAt: -1 }, 'input_invalid'],
          [{ expiresAt: h.payload.issuedAt + 86400001 }, 'input_invalid'],
          [{ policy: { ...s.policy, projectKey: 'other-project' } }, 'authority_policy_scope'],
          [{ policy: { ...s.policy, targetRef: 'refs/heads/other' } }, 'authority_policy_scope'],
          [{ policy: { ...s.policy, accepted: true } }, 'authorization_policy_invalid']]) {
          h.state.text = encode(h.sign({ ...h.payload, ...change })); reject(() => prepare(s, h), code);
        }
        h.state.text = encode(h.sign(h.payload)); const clock = Date.now;
        try {
          for (const time of [h.payload.issuedAt - 1, h.payload.expiresAt]) {
            Date.now = () => time; reject(() => prepare(s, h), 'authority_policy_expired_or_future');
          }
        } finally { Date.now = clock; }
      }); assert.equal(reads, before);
    }, true);
    await test('handles cannot cross host instances or be reconstructed from JSON', async () => {
      const { s, h } = await ready(), other = H.createUiReviewAuthorityHost(encode(h.anchor), h.reader), before = h.state.calls;
      readonly(s, () => {
        reject(() => other.verify(h.handle, encode(h.proof), encode(s.input)), 'authority_handle_invalid');
        reject(() => h.host.verify(clone(h.handle), encode(h.proof), encode(s.input)), 'authority_handle_invalid');
      }); assert.equal(h.state.calls, before);
    });
    await test('a changed actual Git target is still rejected through the host wrapper', async () => {
      const { s, h } = await ready(), t = s.descriptor.target;
      F.cmd(s.root, ['update-ref', t.ref, s.run.expectedHead]);
      try { readonly(s, () => reject(() => verify(s, h), 'target_changed')); }
      finally { F.cmd(s.root, ['update-ref', t.ref, t.commit]); }
    });
    await test('policy replacement during actual preparation and verification rejects', async () => {
      const s = await common();
      for (const method of ['prepareUiReviewAuthorization', 'verifyUiReviewAuthorization']) {
        const h = makeHost(s), original = Auth[method];
        if (method.startsWith('verify')) { h.handle = readonly(s, () => prepare(s, h)); h.proof = AF.signing(h.handle, s.privateKey); }
        let invoked = false;
        Auth[method] = (...args) => { const result = original(...args); invoked = true; h.state.text = encode(h.sign({ ...h.payload, revision: 2 })); return result; };
        try { readonly(s, () => reject(() => method.startsWith('prepare') ? prepare(s, h) : verify(s, h), 'authority_policy_changed')); assert.equal(invoked, true); }
        finally { Auth[method] = original; }
      }
    });
    await test('challenge must fit policy life and stay valid after final source read', async () => {
      const s = await common(), h = makeHost(s), clock = Date.now;
      readonly(s, () => reject(() => prepare(s, h, { ...s.challenge, expiresAt: h.payload.expiresAt + 1 }), 'authority_challenge_outlives_policy'));
      h.handle = readonly(s, () => prepare(s, h)); h.proof = AF.signing(h.handle, s.privateKey);
      const finalRead = h.state.calls + 2; h.state.hook = () => { if (h.state.calls === finalRead) Date.now = () => s.challenge.expiresAt; };
      try { readonly(s, () => reject(() => verify(s, h), 'authorization_expired_or_future')); }
      finally { Date.now = clock; }
    });
    await test('reader reentry cannot recursively prepare or corrupt the host state', async () => {
      const s = await common(), h = makeHost(s); let observed;
      h.state.hook = () => { try { prepare(s, h); } catch (e) { observed = e.code; } };
      h.handle = readonly(s, () => prepare(s, h)); assert.equal(observed, 'authority_host_busy'); noAuthority(h.handle);
    });
    await test('same leaf policy at a new revision invalidates old proof bytes and blocks rollback', async () => {
      const { s, h } = await ready(), old = h.handle, oldProof = h.proof, previous = h.state.text;
      h.state.text = encode(h.sign({ ...h.payload, revision: 2 }));
      readonly(s, () => reject(() => verify(s, h), 'authority_policy_changed'));
      h.state.text = previous; readonly(s, () => reject(() => verify(s, h), 'authority_policy_rollback'));
      h.state.text = encode(h.sign({ ...h.payload, revision: 2 }));
      h.handle = readonly(s, () => prepare(s, h)); h.proof = AF.signing(h.handle, s.privateKey);
      assert.equal(old.payload.policyDigest, h.handle.payload.policyDigest); assert.notEqual(old.payloadDigest, h.handle.payloadDigest);
      readonly(s, () => reject(() => verify(s, h, h.handle, oldProof), 'authorization_proof_mismatch'));
      noAuthority(readonly(s, () => verify(s, h)));
    });
    await test('a signed conflicting revision cannot replace its previously observed content', async () => {
      const { s, h } = await ready(), original = h.state.text, current = JSON.parse(original);
      const { signature, ...payload } = current; assert.ok(signature);
      h.state.text = encode(h.sign({ ...payload, expiresAt: payload.expiresAt - 1 }));
      try { readonly(s, () => reject(() => verify(s, h), 'authority_policy_revision_conflict')); }
      finally { h.state.text = original; }
    });
    await test('signed revocation blocks outstanding proof and remains a rollback floor', async () => {
      const { s, h } = await ready(), previous = h.state.text, revision = JSON.parse(previous).revision + 1;
      h.state.text = encode(h.sign({ ...h.payload, revision, policy: null }));
      readonly(s, () => reject(() => verify(s, h), 'authority_policy_revoked'));
      h.state.text = previous; readonly(s, () => reject(() => verify(s, h), 'authority_policy_rollback'));
    });
    await test('restart floor is explicit and cannot be inferred from an old signed certificate', async () => {
      const s = await common(), h = makeHost(s), old = h.state.text;
      const host = H.createUiReviewAuthorityHost(encode({ ...h.anchor, minRevision: 2 }), () => old);
      readonly(s, () => reject(() => host.prepare(s.root, '', '', '', ''), 'authority_policy_rollback'));
    });
    await test('read-only dry-run checking neither grants authority nor consumes the challenge', async () => {
      const s = await common(), h = makeHost(s), io = require('../lib/io');
      io.setDryRunGuard(true); git.setGitDryRun(true);
      try {
        h.handle = readonly(s, () => prepare(s, h)); h.proof = AF.signing(h.handle, s.privateKey);
        const first = readonly(s, () => verify(s, h)), second = readonly(s, () => verify(s, h));
        assert.deepEqual(first, second); noAuthority(second);
      } finally { io.setDryRunGuard(false); git.setGitDryRun(false); }
    });
    assert.ok(total > 0, 'zero matching tests is failure');
    console.log(`Tests: ${passed} passed, ${total - passed} failed, ${total} total`);
    if (passed !== total) process.exitCode = 1;
  } finally {
    const resolved = fs.realpathSync(arena); assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('lr-authority-host-'));
    for (let attempt = 0; ; attempt++) {
      try { fs.rmSync(resolved, { recursive: true, force: true }); break; }
      catch (e) { if (attempt >= 5 || !['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES'].includes(e.code)) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1)); }
    }
  }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
