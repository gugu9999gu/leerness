'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const G = require('../lib/review-control-git');
const C = require('../lib/review-control-contract');
const R = require('../lib/ui-review-run-contract');
const H = require('../lib/ui-review-authority-host');
const S = require('../lib/ui-review-authority-floor');
const U = require('../lib/ui-review-proof-use');
const Auth = require('../lib/ui-review-authorization');
const AF = require('./ui-review-authorization-fixture');
const F = require('./ui-review-run-fixture');
const { removeTree } = require('./temp-cleanup');
const encode = R.encode;
const reject = (fn, code) => assert.throws(fn, e => { assert.equal(e.code, code); return true; });
for (const name of ['node:http', 'node:https']) for (const key of ['request', 'get']) {
  require(name)[key] = () => { throw new Error('unexpected network'); };
}
function noAuthority(value) {
  for (const key of ['actorIdentityVerified', 'semanticVerified', 'acceptedAuthorityVerified', 'approvalGranted', 'cleanupAllowed', 'policySourceVerified', 'targetBindingVerified']) assert.equal(value[key], false);
  assert.equal(value.challengeConsumed, true); assert.equal(value.historical, true);
}
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--worker') {
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    try {
      if (!input.barrier) { console.log(JSON.stringify({ ok: true, result: U.readUiReviewProofUse(input.root, encode(input.anchor), input.challenge.challengeId) })); return; }
      const floor = S.openUiReviewAuthorityFloor(input.root, encode(input.anchor));
      const host = H.createUiReviewAuthorityHost(encode(input.anchor), () => encode(input.certificate), floor);
      const handle = host.prepare(input.root, encode(input.run), encode(input.descriptor), encode(input.current), encode(input.challenge));
      const original = G.run;
      G.run = (ctx, argv, ...rest) => {
        if (argv[0] === 'update-ref' && argv[1] === '--stdin') {
          fs.writeFileSync(path.join(input.barrier, input.id), 'ready'); const deadline = Date.now() + 30000;
          while (!fs.existsSync(path.join(input.barrier, 'release'))) {
            if (Date.now() >= deadline) throw new Error('barrier timeout');
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          }
        }
        return original(ctx, argv, ...rest);
      };
      console.log(JSON.stringify({ ok: true, result: host.consume(handle, encode(input.proof), encode(input.current)) }));
    } catch (e) { console.log(JSON.stringify({ ok: false, code: e.code || e.message })); }
    return;
  }
  const smoke = args[0] === '--smoke', filter = args[0] === '--filter' ? args[1] : null;
  assert.ok(!args.length || (args.length === 1 && smoke) || (args.length === 2 && filter));
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-proof-use-'));
  let fixture, passed = 0, total = 0;
  async function ready() {
    if (fixture) return fixture;
    const s = await AF.setup(path.join(arena, 'repo')), keys = crypto.generateKeyPairSync('ed25519'), now = Date.now();
    const anchor = { schema: H.ANCHOR_SCHEMA, hostId: 'fixture-host', publicKeySpki: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      projectKey: s.policy.projectKey, targetRef: s.policy.targetRef, minRevision: 1, maxPolicyValidityMs: 86400000 };
    const value = { schema: H.POLICY_SCHEMA, hostId: anchor.hostId, revision: 1, issuedAt: now, expiresAt: now + 4 * 3600000, policy: s.policy };
    const certificate = { ...value, signature: crypto.sign(null, Buffer.from(H.POLICY_DOMAIN + encode(value)), keys.privateKey).toString('base64') };
    S.initializeUiReviewAuthorityFloor(s.root, encode(anchor), encode(certificate));
    const floor = S.openUiReviewAuthorityFloor(s.root, encode(anchor)), host = H.createUiReviewAuthorityHost(encode(anchor), () => encode(certificate), floor);
    const handle = host.prepare(s.root, encode(s.run), encode(s.descriptor), encode(s.input), encode(s.challenge)), proof = AF.signing(handle, s.privateKey);
    let ticket;
    function capture(fn) {
      const original = Auth.verifyUiReviewAuthorization;
      Auth.verifyUiReviewAuthorization = (...args) => { ticket = original(...args); return ticket; };
      try { return fn(); } finally { Auth.verifyUiReviewAuthorization = original; }
    }
    const ctx = { ...G.context(s.root, 'proof-use'), ref: `refs/leerness/ui-review-proof-use/v1/${s.ctx.projectKey}/${s.challenge.challengeId}` };
    fixture = { s, anchor, certificate, floor, host, handle, proof, ctx,
      get checked() { if (!ticket) capture(() => host.verify(handle, encode(proof), encode(s.input))); return ticket; },
      consume: () => capture(() => host.consume(handle, encode(proof), encode(s.input))),
      publish: () => U.publishUiReviewProofUse(fixture.checked, floor, handle.policySource),
      read: () => U.readUiReviewProofUse(s.root, encode(anchor), s.challenge.challengeId),
      worker: { root: s.root, anchor, certificate, run: s.run, descriptor: s.descriptor, current: s.input, challenge: s.challenge, proof } };
    return fixture;
  }
  async function test(name, fn, selected = false) {
    if ((smoke && !selected) || (filter && !name.includes(filter))) return;
    total++; console.log('RUN ' + name); const started = Date.now();
    try { const h = await ready(); F.cmd(h.s.root, ['update-ref', '-d', h.ctx.ref]); await fn(h); passed++; console.log(`PASS ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`); }
    catch (e) { console.error('FAIL ' + name + ': ' + e.stack); }
  }
  try {
    await test('actual host consumption persists once and reads after process restart', h => {
      const first = h.consume(); noAuthority(first); assert.equal(first.applied, true);
      const before = F.snapshot(h.s.root), replay = h.publish(); noAuthority(replay); assert.equal(replay.applied, false); assert.deepEqual(F.snapshot(h.s.root), before);
      const result = cp.spawnSync(process.execPath, [__filename, '--worker'], { input: encode(h.worker), encoding: 'utf8', timeout: 60000 });
      assert.equal(result.status, 0, result.stderr); const stored = JSON.parse(result.stdout); assert.equal(stored.ok, true); noAuthority(stored.result); assert.equal(stored.result.head, first.head);
      const bytes = G.readCommit(h.ctx, first.head).bytes; assert.ok(!bytes.includes(h.s.run.owner.token));
      assert.ok(!bytes.includes('PRIVATE_MATERIAL')); assert.equal(G.readCommit(h.ctx, first.head).parents[0], h.s.run.expectedHead);
    }, true);
    await test('forged results and missing floor fail without creating a use record', h => {
      const before = F.snapshot(h.s.root);
      reject(() => U.publishUiReviewProofUse(JSON.parse(encode(h.checked)), h.floor, h.handle.policySource), 'authorization_verification_invalid');
      reject(() => U.publishUiReviewProofUse(h.checked, {}, h.handle.policySource), 'authority_floor_handle_invalid');
      const memory = H.createUiReviewAuthorityHost(encode(h.anchor), () => encode(h.certificate));
      reject(() => memory.consume(h.handle, encode(h.proof), encode(h.s.input)), 'authority_floor_required');
      assert.equal(h.read(), null); assert.deepEqual(F.snapshot(h.s.root), before);
    }, true);
    await test('target change at transaction prevents consumption atomically', h => {
      const original = G.run, ref = h.s.descriptor.target.ref, previous = h.s.descriptor.target.commit;
      const other = F.cmd(h.s.root, ['rev-parse', previous + '^']);
      G.run = (ctx, args, ...rest) => {
        if (args[0] === 'update-ref' && args[1] === '--stdin') F.cmd(h.s.root, ['update-ref', ref, other]);
        return original(ctx, args, ...rest);
      };
      try { reject(h.publish, 'publication_uncertain'); assert.equal(h.read(), null); }
      finally { G.run = original; F.cmd(h.s.root, ['update-ref', ref, previous]); }
    }, true);
    await test('uncertain acknowledgement recovers the same immutable record', h => {
      const original = G.run;
      G.run = (ctx, args, ...rest) => { const out = original(ctx, args, ...rest); return args[0] === 'update-ref' && args[1] === '--stdin' ? { ...out, error: new Error('lost acknowledgement') } : out; };
      try { reject(h.publish, 'publication_uncertain'); } finally { G.run = original; }
      const saved = h.read(); noAuthority(saved); const before = F.snapshot(h.s.root); assert.equal(h.publish().head, saved.head); assert.deepEqual(F.snapshot(h.s.root), before);
    }, true);
    await test('control and policy floor races cannot leave a consumed record', h => {
      const floor = S.floorSnapshot(h.floor, h.handle.policySource.anchorDigest);
      for (const [ref, previous] of [[h.s.ctx.ref, h.s.run.expectedHead], [floor.ref, floor.head]]) {
        const original = G.run;
        G.run = (ctx, args, ...rest) => {
          if (args[0] === 'update-ref' && args[1] === '--stdin') F.cmd(h.s.root, ['update-ref', '-d', ref]);
          return original(ctx, args, ...rest);
        };
        try { reject(h.publish, 'publication_uncertain'); assert.equal(h.read(), null); }
        finally { G.run = original; F.cmd(h.s.root, ['update-ref', ref, previous]); }
      }
    });
    await test('stored signature tampering and wrong parents reject', h => {
      const good = h.publish(), stored = G.readCommit(h.ctx, good.head), value = R.parse(stored.bytes);
      value.proof.signature = Buffer.alloc(64).toString('base64');
      const forged = G.prepareCommit(h.ctx, h.s.run.expectedHead, encode(value)); F.cmd(h.s.root, ['update-ref', h.ctx.ref, forged]);
      reject(h.read, 'proof_use_record_invalid');
      const noParent = G.prepareCommit(h.ctx, null, stored.bytes); F.cmd(h.s.root, ['update-ref', h.ctx.ref, noParent]); reject(h.read, 'proof_use_record_invalid');
    });
    await test('dry run blocks consumption but permits historical lookup and exact replay', h => {
      const io = require('../lib/io'), git = require('../lib/git'), before = F.snapshot(h.s.root);
      io.setDryRunGuard(true); git.setGitDryRun(true);
      try { reject(h.publish, 'E_DRY_RUN_WRITE'); assert.equal(h.read(), null); }
      finally { io.setDryRunGuard(false); git.setGitDryRun(false); }
      assert.deepEqual(F.snapshot(h.s.root), before); h.publish(); const saved = F.snapshot(h.s.root);
      io.setDryRunGuard(true); git.setGitDryRun(true);
      try { noAuthority(h.read()); assert.equal(h.publish().applied, false); }
      finally { io.setDryRunGuard(false); git.setGitDryRun(false); }
      assert.deepEqual(F.snapshot(h.s.root), saved);
    });
    await test('expiry at publication reports uncertainty and retains recoverable history', h => {
      const original = G.run, clock = Date.now;
      G.run = (ctx, args, ...rest) => { const out = original(ctx, args, ...rest); if (args[0] === 'update-ref' && args[1] === '--stdin') Date.now = () => h.s.challenge.expiresAt; return out; };
      try { reject(h.publish, 'publication_uncertain'); noAuthority(h.read()); reject(h.publish, 'authorization_expired_or_future'); }
      finally { G.run = original; Date.now = clock; }
    });
    await test('another valid payload cannot reuse the same challenge', h => {
      h.publish(); const changed = { ...h.s.challenge, expiresAt: h.s.challenge.expiresAt - 1 };
      const direct = Auth.prepareUiReviewAuthorization(h.s.root, encode(h.s.run), encode(h.s.descriptor), encode(h.s.input), encode(h.s.policy), encode(changed), h.handle.payload.policySourceDigest);
      const checked = Auth.verifyUiReviewAuthorization(direct, encode(AF.signing(direct, h.s.privateKey)), encode(h.s.policy), encode(h.s.input));
      const before = F.snapshot(h.s.root); reject(() => U.publishUiReviewProofUse(checked, h.floor, h.handle.policySource), 'authorization_challenge_consumed'); assert.deepEqual(F.snapshot(h.s.root), before);
    });
    await test('two actual processes consume a proof with only one publication winner', async h => {
      const barrier = path.join(arena, 'barrier'); fs.mkdirSync(barrier);
      const children = [0, 1].map(i => {
        const proc = cp.spawn(process.execPath, [__filename, '--worker'], { stdio: ['pipe', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
        proc.stdout.on('data', d => { stdout += d; }); proc.stderr.on('data', d => { stderr += d; });
        const done = new Promise((resolve, rejectPromise) => { proc.on('error', rejectPromise); proc.on('close', code => {
          try { assert.equal(code, 0, stderr); resolve(JSON.parse(stdout)); } catch (e) { rejectPromise(e); }
        }); });
        proc.stdin.end(encode({ ...h.worker, barrier, id: 'ready-' + i })); return { proc, done };
      });
      try {
        const deadline = Date.now() + 240000;
        while (![0, 1].every(i => fs.existsSync(path.join(barrier, 'ready-' + i)))) {
          assert.ok(Date.now() < deadline, 'both workers must reach publication'); await new Promise(resolve => setTimeout(resolve, 25));
        }
        fs.writeFileSync(path.join(barrier, 'release'), 'go'); const results = await Promise.all(children.map(c => c.done));
        assert.equal(results.filter(r => r.ok).length, 1); assert.equal(results.find(r => !r.ok).code, 'publication_uncertain');
        assert.equal(h.read().head, results.find(r => r.ok).result.head);
      } finally { for (const c of children) if (c.proc.exitCode === null) c.proc.kill(); }
    });
    assert.ok(total > 0); console.log(`Tests: ${passed} passed, ${total - passed} failed, ${total} total`);
    if (passed !== total) process.exitCode = 1;
  } finally {
    const resolved = fs.realpathSync(arena); assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('lr-proof-use-'));
    removeTree(resolved, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
