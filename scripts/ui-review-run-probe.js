'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const git = require('../lib/git');
const { removeTree } = require('./temp-cleanup');

if (process.argv[2] === '--worker') {
  const original = git.gitSpawn;
  let mode;
  git.gitSpawn = (args, options) => {
    const publishing = args.includes('update-ref') && args.includes('--stdin')
      && String(options.input).includes('create refs/leerness/review-runs/');
    if (publishing && mode.startsWith('race:')) {
      process.send({ phase: 'cas-ready' }); const deadline = Date.now() + 20000;
      while (!fs.existsSync(mode.slice(5))) {
        if (Date.now() > deadline) throw new Error('CAS barrier timeout');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    if (publishing && mode === 'before') { process.send({ phase: 'before' }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000); }
    const result = original(args, options);
    if (publishing && mode === 'after' && result.status === 0) { process.send({ phase: 'after' }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000); }
    return result;
  };
  const API = require('../lib/ui-review-run');
  process.on('message', async s => {
    mode = s.mode;
    try {
      const value = s.read ? API.readUiReviewRun(s.root, s.run.batchId, s.run.runId)
        : API.retainUiReviewRun(await API.observeUiReviewRun(s.root, JSON.stringify(s.run), JSON.stringify(s.request), JSON.stringify(s.request.input), () => { throw new Error('unexpected callback'); }));
      process.send({ result: { ok: true, value } }, () => process.exit(0));
    } catch (error) { process.send({ result: { ok: false, code: error.code } }, () => process.exit(0)); }
  });
  process.send({ ready: true });
} else main().catch(error => { console.error(error.stack); process.exitCode = 1; });

async function main() {
  const API = require('../lib/ui-review-run');
  const R = require('../lib/ui-review-run-contract');
  const C = require('../lib/review-control');
  const G = require('../lib/review-control-git');
  const { encode, clone } = require('./ui-review-fixture');
  const { executionLedgerPath } = require('../lib/role-fallback');
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ui-review-run-'));
  let total = 0, passed = 0, sequence = 0;
  const children = new Set();
  async function test(name, fn) {
    if (process.argv.includes('--smoke') && total >= 10) return;
    total++; try { await fn(); passed++; console.log('PASS ' + name); }
    catch (error) { console.error('FAIL ' + name + ': ' + error.stack); }
  }
  const F = require('./ui-review-run-fixture');
  const { cmd, observe, terminal, snapshot } = F;
  const setup = options => F.setup(path.join(arena, 'case-' + sequence++), options);
  function reject(fn, code) { assert.throws(fn, e => e.code === code, code); }
  function rejected(fn, code) { return assert.rejects(fn, e => e.code === code, code); }
  function safe(value) {
    for (const k of ['actorIdentityVerified', 'semanticVerified', 'acceptedAuthorityVerified', 'approvalGranted', 'cleanupAllowed']) assert.equal(value[k], false);
    assert.equal(value.independentReview, 'not-verified');
  }
  function target(s, saved, edit) {
    fs.mkdirSync(path.join(s.root, 'records'));
    fs.writeFileSync(path.join(s.root, 'records/run.json'), saved.recordJson);
    if (edit) edit();
    cmd(s.root, ['add', '--', 'records/run.json', ...s.request.files.map(f => f.path)]); cmd(s.root, ['commit', '-qm', 'retained evidence']);
    const commit = cmd(s.root, ['rev-parse', 'HEAD']); cmd(s.root, ['update-ref', 'refs/heads/retained', commit]);
    return { schema: API.RETENTION_SCHEMA, batchId: s.run.batchId, runId: s.run.runId, ref: 'refs/heads/retained', commit, recordPath: 'records/run.json' };
  }
  function worker(s, mode = 'normal', read = false) {
    const child = fork(__filename, ['--worker'], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }); children.add(child);
    let resolvePhase, resolveDone; let result, errors = '';
    child.stderr.on('data', b => { errors += b; });
    const phase = new Promise(resolve => { resolvePhase = resolve; });
    const done = new Promise(resolve => { resolveDone = resolve; });
    const timer = setTimeout(() => { child.kill(); }, 45000);
    child.on('message', message => {
      if (message.ready) child.send({ root: s.root, run: s.run, request: s.request, mode, read });
      if (message.phase) resolvePhase(message.phase);
      if (message.result) result = message.result;
    });
    child.on('exit', (code, signal) => { clearTimeout(timer); children.delete(child); resolvePhase('exited'); resolveDone({ result, code, signal, errors }); });
    return { child, phase, done };
  }
  let s, handle, saved, retained;
  try {
    await test('real ledger and binary file observations become a bounded opaque handle', async () => {
      s = setup(); handle = await observe(s); assert.equal(handle.outcome, 'ledger-linked'); safe(handle); assert.ok(Object.isFrozen(handle));
    });
    await test('create-only retention binds exact control parent and excludes raw material/token', () => {
      const source = cmd(s.root, ['rev-parse', 'HEAD']); saved = API.retainUiReviewRun(handle); assert.equal(saved.applied, true); safe(saved);
      assert.equal(saved.record.controlHead, s.control.head); assert.equal(saved.record.ledger.reviewEventId, 'review-event');
      assert.ok(!saved.recordJson.includes(s.run.owner.token)); assert.ok(!saved.recordJson.includes('PRIVATE_MATERIAL'));
      assert.equal(cmd(s.root, ['rev-parse', 'HEAD']), source); assert.equal(cmd(s.root, ['diff', '--cached', '--name-only']), '');
    });
    await test('same handle replay does not rerun callback or change any repo byte/mtime', () => {
      const before = snapshot(s.root); const replay = API.retainUiReviewRun(handle);
      assert.equal(replay.applied, false); assert.equal(replay.head, saved.head); assert.equal(s.callbacks, 1); assert.deepEqual(snapshot(s.root), before);
    });
    await test('a JSON handle reconstruction cannot publish', () => { reject(() => API.retainUiReviewRun(clone(handle)), 'handle_invalid'); });
    await test('a project folder too deep for Git refs on Windows refuses a run before any write and works with long paths on globally', async () => {
      // T-0326: the run, attempt, dispatch and result refs (refs/leerness/<family>/v1/project-<64 hex>/<64 hex>) are
      // written in update-ref --stdin transactions. On Windows, Git without core.longpaths cannot lock them once their
      // lock paths reach 260 characters, and refs written with long paths break the user's own Git there. So the
      // observation is refused with git_long_paths_required before the callback runs or anything is written; with
      // core.longpaths=true in the user's global Git configuration it is observed and retained, and the user's own Git
      // still reads the repository.
      // The user's own global and system Git configuration are replaced by test files for this test only.
      const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM, GIT_DEFAULT_REF_FORMAT: process.env.GIT_DEFAULT_REF_FORMAT };
      const empty = path.join(arena, 'empty.gitconfig'); fs.writeFileSync(empty, '');
      // Other platforms have no such limit, so there the run is set up, observed and retained without the setting.
      const longPaths = process.platform === 'win32' ? path.join(arena, 'longpaths.gitconfig') : empty;
      if (longPaths !== empty) fs.writeFileSync(longPaths, '[core]\n\tlongpaths = true\n');
      process.env.GIT_CONFIG_GLOBAL = longPaths; process.env.GIT_CONFIG_NOSYSTEM = '1'; process.env.GIT_DEFAULT_REF_FORMAT = 'files';
      try {
        let deep = path.join(arena, 'deep');
        while (deep.length < 130) deep = path.join(deep, 'nested-project-folder');
        fs.mkdirSync(path.dirname(deep), { recursive: true });
        const d = F.setup(deep), projectKey = require('../lib/review-control-git').context(deep, 'probe').projectKey;
        if (process.platform === 'win32') {
          // A run ref's last segment is a 64-hex digest, so its lock path length is fixed by the project key and the root.
          assert.ok(path.join(deep, '.git', `refs/leerness/review-runs/v1/${projectKey}/${'0'.repeat(64)}.lock`).length >= 260, 'the case must reach MAX_PATH');
          process.env.GIT_CONFIG_GLOBAL = empty;
          const before = snapshot(deep);
          await rejected(() => observe(d), 'git_long_paths_required');
          assert.equal(d.callbacks, 0); assert.deepEqual(snapshot(deep), before);
          process.env.GIT_CONFIG_GLOBAL = longPaths;
        }
        const h = await observe(d); assert.equal(h.outcome, 'ledger-linked'); safe(h);
        const kept = API.retainUiReviewRun(h); assert.equal(kept.applied, true); assert.equal(kept.record.controlHead, d.control.head);
        assert.ok(cmd(deep, ['log', '--all', '--format=%H']).split('\n').includes(kept.head));
        cmd(deep, ['fsck', '--no-progress']);
      } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      }
    });
    await test('fresh process reads exact canonical RunRecord and trust flags', async () => {
      const out = await worker(s, 'normal', true).done; assert.equal(out.code, 0, out.errors); assert.equal(out.result.ok, true);
      assert.equal(out.result.value.recordJson, saved.recordJson); safe(out.result.value);
    });
    await test('re-observing a retained run ID is rejected before callback', async () => { await rejected(() => observe(s), 'run_conflict'); assert.equal(s.callbacks, 1); });
    await test('GC preserves run and referenced control history', () => {
      cmd(s.root, ['gc', '--prune=now', '--quiet']); assert.equal(API.readUiReviewRun(s.root, s.run.batchId, s.run.runId).recordJson, saved.recordJson);
    });
    await test('retained record plus four exact binary materials verifies without any writes', () => {
      retained = target(s, saved); const before = snapshot(s.root);
      const value = API.verifyUiReviewRunRetention(s.root, encode(retained)); assert.equal(value.retained, true); assert.equal(value.materialFiles, 4); safe(value);
      assert.deepEqual(snapshot(s.root), before);
    });
    await test('working-tree edits do not replace fixed target Git bytes', () => {
      fs.writeFileSync(path.join(s.root, 'source.bin'), 'dirty replacement');
      assert.equal(API.verifyUiReviewRunRetention(s.root, encode(retained)).retained, true);
    });
    await test('wrong target revision and unsafe ref/path inputs fail without writes', () => {
      const before = snapshot(s.root);
      reject(() => API.verifyUiReviewRunRetention(s.root, encode({ ...retained, commit: 'a'.repeat(40) })), 'target_changed');
      for (const item of [{ recordPath: '../record.json' }, { ref: 'HEAD' }, { ref: 'refs/heads/x..y' }, { ref: 'refs/heads/x.lock' }, { extra: true }]) {
        reject(() => API.verifyUiReviewRunRetention(s.root, encode({ ...retained, ...item })), 'input_invalid');
      }
      assert.deepEqual(snapshot(s.root), before);
    });
    await test('changed material committed to target cannot satisfy original digest', async () => {
      const x = setup(), r = API.retainUiReviewRun(await observe(x)); const t = target(x, r, () => fs.writeFileSync(path.join(x.root, 'source.bin'), 'changed'));
      reject(() => API.verifyUiReviewRunRetention(x.root, encode(t)), 'retention_mismatch');
    });
    await test('a missing target material fails retention', async () => {
      const x = setup(), r = API.retainUiReviewRun(await observe(x)); const t = target(x, r, () => fs.unlinkSync(path.join(x.root, 'spec.bin')));
      reject(() => API.verifyUiReviewRunRetention(x.root, encode(t)), 'retention_mismatch');
    });
    await test('wrong canonical target record fails retention', async () => {
      const x = setup(), r = API.retainUiReviewRun(await observe(x)); const t = target(x, r, () => fs.appendFileSync(path.join(x.root, 'records/run.json'), '\n'));
      reject(() => API.verifyUiReviewRunRetention(x.root, encode(t)), 'retention_mismatch');
    });
    await test('symbolic target ref is rejected', () => {
      cmd(s.root, ['symbolic-ref', 'refs/heads/alias', retained.ref]);
      reject(() => API.verifyUiReviewRunRetention(s.root, encode({ ...retained, ref: 'refs/heads/alias' })), 'ref_invalid');
    });
    await test('target moving during actual blob reads cannot produce a retention receipt', () => {
      const original = G.output; let moved = false;
      G.output = (...args) => {
        const bytes = original(...args);
        if (!moved && args[1][0] === 'cat-file') { moved = true; cmd(s.root, ['update-ref', retained.ref, saved.head]); }
        return bytes;
      };
      try { reject(() => API.verifyUiReviewRunRetention(s.root, encode(retained)), 'target_changed'); assert.equal(moved, true); }
      finally { G.output = original; cmd(s.root, ['update-ref', retained.ref, retained.commit]); }
    });
    await test('symlink blob mode at target fails even if its bytes equal observed content', async () => {
      const x = setup(), r = API.retainUiReviewRun(await observe(x)), t = target(x, r);
      const blob = cmd(x.root, ['rev-parse', t.commit + ':spec.bin']);
      cmd(x.root, ['update-index', '--cacheinfo', '120000,' + blob + ',spec.bin']); cmd(x.root, ['commit', '-qm', 'symlink fixture']);
      t.commit = cmd(x.root, ['rev-parse', 'HEAD']); cmd(x.root, ['update-ref', t.ref, t.commit]);
      reject(() => API.verifyUiReviewRunRetention(x.root, encode(t)), 'retention_mismatch');
    });
    await test('oversized target blob fails bounded verification', async () => {
      const x = setup(), r = API.retainUiReviewRun(await observe(x));
      const t = target(x, r, () => fs.writeFileSync(path.join(x.root, 'source.bin'), Buffer.alloc(1024 * 1024 + 1, 65)));
      reject(() => API.verifyUiReviewRunRetention(x.root, encode(t)), 'git_failed');
    });
    await test('malformed run JSON and invalid callback fail before observation effects', async () => {
      const x = setup(), before = snapshot(x.root);
      for (const raw of ['\uFEFF' + encode(x.run), encode(x.run).replace('{', '{"runId":"duplicate",'), encode({ ...x.run, extra: 1 }), encode({ ...x.run, owner: { ...x.run.owner, token: 'bad' } }), ' '.repeat(65537)]) {
        await rejected(() => API.observeUiReviewRun(x.root, raw, encode(x.request), encode(x.input), () => { throw new Error('must not run'); }), 'input_invalid');
      }
      await rejected(() => API.observeUiReviewRun(x.root, encode(x.run), encode(x.request), encode(x.input), null), 'reviewer_invalid');
      assert.deepEqual(snapshot(x.root), before);
    });
    await test('owner and generation mismatch prevent host callback', async () => {
      const x = setup();
      await rejected(() => observe(x, null, { ...x.run, owner: { ...x.run.owner, token: 'f'.repeat(64) } }), 'owner_mismatch');
      await rejected(() => observe(x, null, { ...x.run, generation: 2 }), 'stale_generation'); assert.equal(x.callbacks, 0);
    });
    await test('changed packet prevents host callback', async () => {
      const x = setup(), current = clone(x.input); current.snapshot.batch.revision++;
      await rejected(() => observe(x, null, x.run, current), 'snapshot_mismatch'); assert.equal(x.callbacks, 0);
    });
    await test('absent ledger is durably recorded as unlinked, not approved', async () => {
      const x = setup({ ledger: false }), h = await observe(x); const r = API.retainUiReviewRun(h);
      assert.equal(x.callbacks, 0); assert.equal(r.record.outcome, 'unlinked'); assert.equal(r.record.reasonCode, 'ledger_missing'); safe(r);
    });
    await test('host callback failure is retained without leaking thrown text', async () => {
      const x = setup(), h = await observe(x, () => { throw new Error('PRIVATE_MATERIAL callback secret'); }); const r = API.retainUiReviewRun(h);
      assert.equal(r.record.observationState, 'failed'); assert.equal(r.record.receiptJson, null); assert.ok(!r.recordJson.includes('PRIVATE_MATERIAL')); safe(r);
    });
    await test('invalid receipt text is excluded from failure record', async () => {
      const x = setup(), h = await observe(x, () => 'PRIVATE_MATERIAL invalid receipt'); const r = API.retainUiReviewRun(h);
      assert.equal(r.record.observationState, 'invalid'); assert.equal(r.record.receiptJson, null); assert.ok(!r.recordJson.includes('PRIVATE_MATERIAL'));
    });
    await test('callback buffer mutation stays invalid after retention', async () => {
      const x = setup(), h = await observe(x, (supplied, rc) => { supplied.materials[0].bytes[0] ^= 1; return encode(rc); });
      const r = API.retainUiReviewRun(h); assert.equal(r.record.observationState, 'invalid'); assert.equal(r.record.outcome, 'unlinked'); safe(r);
    });
    await test('incomplete semantic coverage can be preserved but never promoted', async () => {
      const x = setup(), h = await observe(x, (supplied, rc) => { rc.coverage.pop(); terminal(x, supplied, rc); return encode(rc); });
      const r = API.retainUiReviewRun(h); assert.equal(JSON.parse(r.record.receiptJson).coverage.length, 4); safe(r);
    });
    await test('control advanced after observation fences publication and preserves ledger effects', async () => {
      const x = setup(), h = await observe(x);
      C.writeReviewControl(x.root, encode({ ...x.common, operation: 'reclaim', operationId: 'new-owner', expectedHead: x.control.head, generation: 1, snapshot: null }));
      reject(() => API.retainUiReviewRun(h), 'control_changed'); assert.ok(fs.readFileSync(executionLedgerPath(x.root), 'utf8').includes('review.completed'));
      assert.equal(API.readUiReviewRun(x.root, x.run.batchId, x.run.runId), null);
    });
    await test('old retained record remains readable/replayable after reclaim, without new approval', () => {
      C.writeReviewControl(s.root, encode({ ...s.common, operation: 'reclaim', operationId: 'reclaim', expectedHead: s.control.head, generation: 1, snapshot: null }));
      const r = API.retainUiReviewRun(handle); assert.equal(r.applied, false); assert.equal(r.head, saved.head); safe(r);
    });
    await test('dry-run retention refuses writes and leaves complete repo unchanged', async () => {
      const x = setup({ ledger: false }), h = await observe(x), before = snapshot(x.root);
      git.setGitDryRun(true); try { reject(() => API.retainUiReviewRun(h), 'E_DRY_RUN_WRITE'); } finally { git.setGitDryRun(false); }
      assert.deepEqual(snapshot(x.root), before);
    });
    await test('runtime incompatible descriptor blocks retention before publication', async () => {
      const x = setup({ ledger: false }), h = await observe(x); fs.mkdirSync(path.join(x.root, '.git/leerness'));
      fs.writeFileSync(path.join(x.root, '.git/leerness/layout.json'), '{"schemaVersion":999}'); const before = snapshot(x.root);
      reject(() => API.retainUiReviewRun(h), 'E_RUNTIME_LAYOUT_INCOMPATIBLE'); assert.deepEqual(snapshot(x.root), before);
    });
    await test('descriptor changed at actual Git transaction is rejected by shared write guard', async () => {
      const x = setup({ ledger: false }), h = await observe(x), original = G.run;
      G.run = (...args) => {
        fs.mkdirSync(path.join(x.root, '.git/leerness'));
        fs.writeFileSync(path.join(x.root, '.git/leerness/layout.json'), '{"schemaVersion":999}');
        return original(...args);
      };
      try { reject(() => API.retainUiReviewRun(h), 'E_RUNTIME_LAYOUT_INCOMPATIBLE'); }
      finally { G.run = original; }
      assert.equal(API.readUiReviewRun(x.root, x.run.batchId, x.run.runId), null);
    });
    await test('linked worktree cannot reuse another worktree owner credential', async () => {
      const x = setup(), linked = path.join(arena, 'linked'); cmd(x.root, ['worktree', 'add', '--detach', linked, 'HEAD']);
      fs.mkdirSync(path.join(linked, '.leerness')); fs.writeFileSync(path.join(linked, '.leerness/HARNESS_VERSION'), '1.0.0\n');
      await rejected(() => API.observeUiReviewRun(linked, encode(x.run), encode(x.request), encode(x.input), () => { throw new Error('not allowed'); }), 'owner_mismatch');
    });
    await test('two processes compete at the actual create-ref transaction: one publishes', async () => {
      const x = setup({ ledger: false }), gate = path.join(arena, 'cas-release');
      const A = require('../lib/ui-review-attempt');
      A.reserve(G.context(x.root, x.run.batchId), R.request(encode(x.run)), x.request, x.input);
      const a = worker(x, 'race:' + gate), b = worker(x, 'race:' + gate);
      assert.equal(await a.phase, 'cas-ready'); assert.equal(await b.phase, 'cas-ready'); fs.writeFileSync(gate, 'go');
      const rs = await Promise.all([a.done, b.done]); assert.equal(rs.filter(r => r.result && r.result.ok).length, 1);
      assert.equal(rs.find(r => !r.result.ok).result.code, 'publication_uncertain');
      assert.equal(API.readUiReviewRun(x.root, x.run.batchId, x.run.runId).record.outcome, 'unlinked');
    });
    await test('control CAS races with run create: stale run is never published', async () => {
      const x = setup({ ledger: false }), gate = path.join(arena, 'control-release'), w = worker(x, 'race:' + gate);
      assert.equal(await w.phase, 'cas-ready');
      C.writeReviewControl(x.root, encode({ ...x.common, operation: 'reclaim', operationId: 'racing-owner', expectedHead: x.control.head, generation: 1, snapshot: null }));
      fs.writeFileSync(gate, 'go'); const out = await w.done; assert.equal(out.result.code, 'publication_uncertain');
      assert.equal(API.readUiReviewRun(x.root, x.run.batchId, x.run.runId), null);
    });
    await test('uncertain response after a real commit reconciles the same handle without re-execution', async () => {
      const x = setup(), h = await observe(x), original = G.run;
      G.run = (...args) => { const result = original(...args); return String(args[2]).includes('create refs/leerness/review-runs/')
        ? { ...result, error: new Error('PRIVATE_MATERIAL timeout') } : result; };
      try { reject(() => API.retainUiReviewRun(h), 'publication_uncertain'); }
      finally { G.run = original; }
      const r = API.retainUiReviewRun(h); assert.equal(r.applied, false); assert.equal(x.callbacks, 1); safe(r);
    });
    for (const mode of ['before', 'after']) await test('process termination ' + mode + ' transaction has explicit persisted outcome', async () => {
      const x = setup({ ledger: false }), w = worker(x, mode); assert.equal(await w.phase, mode); w.child.kill(); await w.done;
      const r = API.readUiReviewRun(x.root, x.run.batchId, x.run.runId);
      if (mode === 'before') assert.equal(r, null); else { assert.equal(r.record.outcome, 'unlinked'); safe(r); }
    });
    await test('SHA-256 Git object format supports run and target retention', async () => {
      const x = setup({ format: 'sha256' }), r = API.retainUiReviewRun(await observe(x)); assert.equal(r.head.length, 64);
      const t = target(x, r); assert.equal(API.verifyUiReviewRunRetention(x.root, encode(t)).retained, true);
    });
    await test('malformed immutable record and symbolic run ref fail closed', () => {
      const ctx = G.context(s.root, s.run.batchId), ref = saved.ref;
      const bad = G.prepareCommit(ctx, s.control.head, saved.recordJson.replace('"outcome":"ledger-linked"', '"outcome":"approved"'));
      cmd(s.root, ['update-ref', ref, bad]); reject(() => API.readUiReviewRun(s.root, s.run.batchId, s.run.runId), 'record_invalid');
      const invalidUtf8 = G.prepareCommit(ctx, s.control.head, Buffer.concat([Buffer.from([255]), Buffer.from(saved.recordJson)]));
      cmd(s.root, ['update-ref', ref, invalidUtf8]); reject(() => API.readUiReviewRun(s.root, s.run.batchId, s.run.runId), 'record_invalid');
      cmd(s.root, ['update-ref', ref, saved.head]); cmd(s.root, ['symbolic-ref', ref, retained.ref]);
      reject(() => API.readUiReviewRun(s.root, s.run.batchId, s.run.runId), 'ref_invalid');
    });
  } finally {
    for (const child of children) child.kill();
    // Delete only this probe's owned temp directory, after validating both parent and prefix.
    const owned = path.resolve(arena), base = path.resolve(os.tmpdir());
    assert.equal(path.dirname(owned), base); assert.ok(path.basename(owned).startsWith('leerness-ui-review-run-'));
    removeTree(owned, { recursive: true, force: true });
  }
  console.log(`UI review run: ${passed}/${total} PASS`);
  console.log(JSON.stringify({ total, passed, failed: total - passed, node: process.version, independentReview: false }));
  if (passed !== total) process.exitCode = 1;
}
