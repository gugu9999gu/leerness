'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const S = require('../lib/ui-review-authority-floor');
const H = require('../lib/ui-review-authority-host');
const G = require('../lib/review-control-git');
const C = require('../lib/review-control-contract');
const R = require('../lib/ui-review-run-contract');
const F = require('./ui-review-run-fixture');
const AF = require('./ui-review-authorization-fixture');
const git = require('../lib/git');
const { removeTree } = require('./temp-cleanup');
for (const name of ['node:http', 'node:https']) for (const key of ['request', 'get']) {
  require(name)[key] = () => { throw new Error('unexpected network'); };
}
const encode = R.encode, worker = path.join(__dirname, 'ui-review-authority-floor-worker.js');
const reject = (fn, code) => assert.throws(fn, e => { assert.equal(e.code, code); return true; });
function make(root, leaf) {
  const keys = crypto.generateKeyPairSync('ed25519'), now = Date.now(), ctx = G.context(root, 'authority-floor');
  const anchor = { schema: H.ANCHOR_SCHEMA, hostId: 'fixture-host', publicKeySpki: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    projectKey: ctx.projectKey, targetRef: 'refs/heads/candidate', minRevision: 1, maxPolicyValidityMs: 86400000 };
  const policy = leaf || { schema: 'leerness.ui-review-authorization-policy/v1', issuerId: 'fixture-issuer', keyId: 'fixture-key',
    publicKeySpki: anchor.publicKeySpki, projectKey: ctx.projectKey, targetRef: anchor.targetRef, maxValidityMs: 3600000 };
  const payload = { schema: H.POLICY_SCHEMA, hostId: anchor.hostId, revision: 1, issuedAt: now, expiresAt: now + 4 * 3600000, policy };
  const sign = (changes = {}) => { const value = { ...payload, ...changes }; return { ...value,
    signature: crypto.sign(null, Buffer.from(H.POLICY_DOMAIN + encode(value)), keys.privateKey).toString('base64') }; };
  const certificate = sign(), ref = `refs/leerness/ui-review-authority/v1/${ctx.projectKey}/${C.digest(anchor).slice(7)}`;
  return { root, anchor, certificate, sign, ctx: { ...ctx, ref },
    init: () => S.initializeUiReviewAuthorityFloor(root, encode(anchor), encode(certificate)),
    open: () => S.openUiReviewAuthorityFloor(root, encode(anchor)) };
}
function child(h, certificate) {
  const result = cp.spawnSync(process.execPath, [worker], { input: encode({ root: h.root, anchor: h.anchor, certificate }), encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}
function noAuthority(value) {
  for (const key of ['actorIdentityVerified', 'semanticVerified', 'acceptedAuthorityVerified', 'approvalGranted', 'cleanupAllowed']) assert.equal(value[key], false);
}
async function main() {
  const args = process.argv.slice(2), smoke = args[0] === '--smoke', filter = args[0] === '--filter' ? args[1] : null;
  assert.ok(!args.length || (args.length === 1 && smoke) || (args.length === 2 && filter));
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-authority-floor-')), root = path.join(arena, 'repo');
  fs.mkdirSync(root); F.cmd(root, ['init', '-q', '--template=']);
  F.cmd(root, ['config', 'core.hooksPath', path.join(root, 'empty-hooks')]);
  fs.mkdirSync(path.join(root, '.leerness')); fs.writeFileSync(path.join(root, '.leerness/HARNESS_VERSION'), '1.0.0\n');
  let passed = 0, total = 0;
  async function test(name, fn, selected = false) {
    if ((smoke && !selected) || (filter && !name.includes(filter))) return;
    total++; const start = Date.now(); console.log('RUN ' + name);
    try { await fn(); passed++; console.log(`PASS ${name} (${((Date.now() - start) / 1000).toFixed(1)}s)`); }
    catch (e) { console.error('FAIL ' + name + ': ' + e.stack); }
  }
  try {
    await test('initialization is explicit and replay preserves bytes and history', () => {
      const h = make(root); reject(h.open, 'authority_floor_missing'); const first = h.init(); noAuthority(first);
      reject(h.init, 'authority_floor_exists'); const store = h.open(), before = F.snapshot(root);
      assert.equal(store.observe(encode(h.certificate)).applied, false); assert.deepEqual(F.snapshot(root), before);
      const second = store.observe(encode(h.sign({ revision: 2 })));
      assert.deepEqual(G.readCommit(h.ctx, second.head).parents, [first.head]); assert.equal(second.revision, 2);
      assert.equal(F.cmd(root, ['status', '--porcelain']), '?? .leerness/');
    }, true);
    await test('a project folder too deep for Git refs on Windows is refused before any write and works once core.longpaths is on', () => {
      // T-0326: the floor ref is refs/leerness/ui-review-authority/v1/project-<64 hex>/<64 hex>. On Windows, Git without
      // core.longpaths cannot lock it once its lock path reaches 260 characters (initialization used to fail as
      // git_failed), and a ref written with long paths breaks the user's own Git there (git log --all, fsck and gc
      // fail). So initialization and opening are refused with git_long_paths_required before anything is written;
      // after `git config core.longpaths true` the floor initializes and advances, and the user's own Git still reads,
      // packs and checks the repository.
      // The user's global and system Git configuration are switched off so that every machine runs the same case.
      const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM, GIT_DEFAULT_REF_FORMAT: process.env.GIT_DEFAULT_REF_FORMAT };
      const empty = path.join(arena, 'empty.gitconfig'); fs.writeFileSync(empty, '');
      process.env.GIT_CONFIG_GLOBAL = empty; process.env.GIT_CONFIG_NOSYSTEM = '1'; process.env.GIT_DEFAULT_REF_FORMAT = 'files';
      try {
        let deep = path.join(arena, 'deep');
        while (deep.length < 130) deep = path.join(deep, 'nested-project-folder');
        fs.mkdirSync(deep, { recursive: true }); F.cmd(deep, ['init', '-q', '--template=']);
        F.cmd(deep, ['config', 'core.hooksPath', path.join(deep, 'empty-hooks')]);
        fs.mkdirSync(path.join(deep, '.leerness')); fs.writeFileSync(path.join(deep, '.leerness/HARNESS_VERSION'), '1.0.0\n');
        const h = make(deep);
        if (process.platform === 'win32') {
          const before = F.snapshot(deep);
          reject(h.init, 'git_long_paths_required'); reject(h.open, 'git_long_paths_required');
          assert.deepEqual(F.snapshot(deep), before);
          F.cmd(deep, ['config', 'core.longpaths', 'true']);
          assert.ok(path.join(deep, '.git', h.ctx.ref + '.lock').length >= 260, 'the case must reach MAX_PATH');
        }
        const first = h.init(); noAuthority(first);
        const second = h.open().observe(encode(h.sign({ revision: 2 })));
        assert.deepEqual(G.readCommit(h.ctx, second.head).parents, [first.head]); assert.equal(second.revision, 2);
        assert.equal(h.open().observe(encode(h.sign({ revision: 2 }))).applied, false);
        assert.ok(F.cmd(deep, ['log', '--all', '--format=%H']).split('\n').includes(second.head));
        F.cmd(deep, ['gc', '--quiet']); F.cmd(deep, ['fsck', '--no-progress']);
        assert.equal(h.open().observe(encode(h.sign({ revision: 2 }))).applied, false);
      } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      }
    }, true);
    await test('new process rejects rollback and same revision certificate conflict', () => {
      const h = make(root); h.init(); h.open().observe(encode(h.sign({ revision: 2 })));
      assert.equal(child(h, h.certificate).code, 'authority_policy_rollback');
      assert.equal(child(h, h.sign({ revision: 2, expiresAt: h.certificate.expiresAt - 1 })).code, 'authority_policy_revision_conflict');
      assert.equal(child(h, h.sign({ revision: 2 })).result.applied, false);
    }, true);
    await test('revocation remains the floor after its certificate expires', () => {
      const h = make(root); h.init(); const now = Date.now(), revoked = h.sign({ revision: 2, policy: null, expiresAt: now + 10000 });
      const clock = Date.now; Date.now = () => now;
      try {
        assert.equal(h.open().observe(encode(revoked)).revoked, true);
        Date.now = () => now + 20000;
        const store = h.open(); reject(() => store.observe(encode(h.certificate)), 'authority_policy_rollback');
        reject(() => store.observe(encode(revoked)), 'authority_policy_expired_or_future');
        const next = store.observe(encode(h.sign({ revision: 3 }))); assert.equal(next.revoked, false);
      } finally { Date.now = clock; }
    }, true);
    await test('invalid signatures and scopes do not change durable bytes', () => {
      const h = make(root); h.init(); const store = h.open(), before = F.snapshot(root);
      reject(() => store.observe(encode({ ...h.certificate, revision: 99 })), 'authority_policy_signature');
      reject(() => store.observe(encode(h.sign({ policy: { ...h.certificate.policy, projectKey: 'other' } }))), 'authority_policy_scope');
      reject(() => store.observe(encode(h.sign({ issuedAt: Date.now() + 100000 }))), 'authority_policy_expired_or_future');
      assert.deepEqual(F.snapshot(root), before);
    }, true);
    await test('missing corrupt symbolic and wrong anchor stores fail closed', () => {
      const h = make(root), initial = h.init(), store = h.open(); F.cmd(root, ['update-ref', '-d', h.ctx.ref]);
      reject(h.open, 'authority_floor_missing'); reject(() => store.observe(encode(h.certificate)), 'authority_floor_missing');
      const bad = G.prepareCommit(h.ctx, null, encode({ schema: S.SCHEMA, anchorDigest: 'sha256:' + '0'.repeat(64), certificate: h.certificate }));
      F.cmd(root, ['update-ref', h.ctx.ref, bad]); reject(h.open, 'authority_floor_invalid');
      const forged = G.prepareCommit(h.ctx, null, encode({ schema: S.SCHEMA, anchorDigest: C.digest(h.anchor), certificate: { ...h.certificate, revision: 99 } }));
      F.cmd(root, ['update-ref', h.ctx.ref, forged]); reject(h.open, 'authority_policy_signature');
      F.cmd(root, ['update-ref', h.ctx.ref, initial.head]);
      F.cmd(root, ['symbolic-ref', h.ctx.ref, 'refs/heads/absent']); reject(h.open, 'ref_invalid');
    });
    await test('opaque floor handles and project scopes are pinned', () => {
      const h = make(root); h.init(); const other = make(root);
      reject(() => H.createUiReviewAuthorityHost(encode(other.anchor), () => '', h.open()), 'authority_floor_handle_invalid');
      reject(() => H.createUiReviewAuthorityHost(encode(h.anchor), () => '', { observe() {} }), 'authority_floor_handle_invalid');
      reject(() => S.openUiReviewAuthorityFloor(root, encode({ ...h.anchor, projectKey: 'other' })), 'authority_floor_scope');
    });
    await test('two actual processes publish competing certificates with one CAS winner', async () => {
      const h = make(root); h.init(); const barrier = path.join(arena, 'barrier'); fs.mkdirSync(barrier);
      const certificates = [h.sign({ revision: 2 }), h.sign({ revision: 2, expiresAt: h.certificate.expiresAt - 1 })];
      const children = certificates.map((certificate, i) => {
        const proc = cp.spawn(process.execPath, [worker], { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '', stderr = ''; proc.stdout.on('data', d => { stdout += d; }); proc.stderr.on('data', d => { stderr += d; });
        const done = new Promise((resolve, rejectPromise) => { proc.on('error', rejectPromise); proc.on('exit', code => {
          try { assert.equal(code, 0, stderr); resolve(JSON.parse(stdout)); } catch (e) { rejectPromise(e); }
        }); });
        proc.stdin.end(encode({ root, anchor: h.anchor, certificate, barrier, id: 'ready-' + i })); return { proc, done };
      });
      try {
        const deadline = Date.now() + 14000;
        while (![0, 1].every(i => fs.existsSync(path.join(barrier, 'ready-' + i)))) {
          assert.ok(Date.now() < deadline, 'both processes must reach CAS'); await new Promise(resolve => setTimeout(resolve, 20));
        }
        fs.writeFileSync(path.join(barrier, 'release'), 'go'); const results = await Promise.all(children.map(c => c.done));
        assert.equal(results.filter(r => r.ok).length, 1); assert.equal(results.find(r => !r.ok).code, 'publication_uncertain');
        const winner = results.findIndex(r => r.ok); assert.equal(child(h, certificates[winner]).result.applied, false);
        assert.equal(child(h, certificates[1 - winner]).code, 'authority_policy_revision_conflict');
      } finally { for (const c of children) if (c.proc.exitCode === null) c.proc.kill(); }
    });
    await test('uncertain publication reconciles from durable data without another commit', () => {
      const h = make(root); h.init(); const store = h.open(), next = h.sign({ revision: 2 }), original = G.run;
      G.run = (ctx, args, ...rest) => { const result = original(ctx, args, ...rest); return args[0] === 'update-ref' ? { ...result, error: new Error('lost acknowledgement') } : result; };
      try { reject(() => store.observe(encode(next)), 'publication_uncertain'); } finally { G.run = original; }
      const before = F.snapshot(root); assert.equal(h.open().observe(encode(next)).applied, false); assert.deepEqual(F.snapshot(root), before);
    });
    await test('dry run permits exact replay and blocks both initialization and advancement', () => {
      const h = make(root); h.init(); const store = h.open(), other = make(root), before = F.snapshot(root);
      require('../lib/io').setDryRunGuard(true); git.setGitDryRun(true);
      try {
        assert.equal(store.observe(encode(h.certificate)).applied, false);
        reject(() => store.observe(encode(h.sign({ revision: 2 }))), 'E_DRY_RUN_WRITE'); reject(other.init, 'E_DRY_RUN_WRITE');
      } finally { require('../lib/io').setDryRunGuard(false); git.setGitDryRun(false); }
      assert.deepEqual(F.snapshot(root), before);
    });
    await test('an open store detects rollback of an already observed Git floor', () => {
      const h = make(root), first = h.init(), store = h.open(), newer = h.sign({ revision: 2 }); store.observe(encode(newer));
      F.cmd(root, ['update-ref', h.ctx.ref, first.head]); reject(() => store.observe(encode(newer)), 'authority_policy_rollback');
    });
    await test('expiry during publication fails but preserves the newly durable floor', () => {
      const h = make(root); h.init(); const store = h.open(), next = h.sign({ revision: 2 }), original = G.run, clock = Date.now;
      G.run = (ctx, args, ...rest) => { const out = original(ctx, args, ...rest); if (args[0] === 'update-ref') Date.now = () => next.expiresAt; return out; };
      try { reject(() => store.observe(encode(next)), 'authority_policy_expired_or_future'); } finally { G.run = original; Date.now = clock; }
      assert.equal(child(h, h.certificate).code, 'authority_policy_rollback');
    });
    await test('linked worktrees observe the same durable floor', () => {
      F.cmd(root, ['-c', 'user.name=Floor Fixture', '-c', 'user.email=floor@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture']);
      const linked = path.join(arena, 'linked'); F.cmd(root, ['worktree', 'add', '--detach', '-q', linked, 'HEAD']);
      const h = make(root); h.init(); const next = h.sign({ revision: 2 });
      const fromLinked = S.openUiReviewAuthorityFloor(linked, encode(h.anchor)).observe(encode(next));
      assert.equal(h.open().observe(encode(next)).head, fromLinked.head);
      reject(() => h.open().observe(encode(h.certificate)), 'authority_policy_rollback');
    });
    await test('host integrates durable policy checks with actual target verification', async () => {
      const s = await AF.setup(path.join(arena, 'target')), h = make(s.root, s.policy); h.init();
      let text = encode(h.sign({ revision: 2 }));
      const host = H.createUiReviewAuthorityHost(encode(h.anchor), () => text, h.open());
      const handle = host.prepare(s.root, encode(s.run), encode(s.descriptor), encode(s.input), encode(s.challenge));
      noAuthority(handle); assert.equal(handle.effects.filesWritten, true); assert.equal(handle.policyFloor.revision, 2);
      const out = host.verify(handle, encode(AF.signing(handle, s.privateKey)), encode(s.input));
      assert.equal(out.signatureVerified, true); noAuthority(out); assert.equal(out.effects.filesWritten, false);
      text = encode(h.sign({ revision: 3, policy: null }));
      reject(() => host.verify(handle, encode(AF.signing(handle, s.privateKey)), encode(s.input)), 'authority_policy_revoked');
      assert.equal(child(h, h.sign({ revision: 2 })).code, 'authority_policy_rollback');
      text = encode(h.sign({ revision: 2 })); const restarted = H.createUiReviewAuthorityHost(encode(h.anchor), () => text, h.open());
      reject(() => restarted.prepare(s.root, '', '', '', ''), 'authority_policy_rollback');
    });
    assert.ok(total > 0); console.log(`Tests: ${passed} passed, ${total - passed} failed, ${total} total`);
    if (passed !== total) process.exitCode = 1;
  } finally {
    const resolved = fs.realpathSync(arena); assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('lr-authority-floor-'));
    removeTree(resolved, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
