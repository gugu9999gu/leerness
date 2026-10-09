'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const API = require('../lib/ui-review-run');
const A = require('../lib/ui-review-attempt');
const G = require('../lib/review-control-git');
const R = require('../lib/ui-review-run-contract');
const C = require('../lib/review-control');
const F = require('./ui-review-run-fixture');
const { encode } = require('./ui-review-fixture');
const { executionLedgerPath } = require('../lib/role-fallback');
const { removeTree } = require('./temp-cleanup');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ui-attempt-'));
const children = new Set();
let total = 0, passed = 0, sequence = 0;
const setup = options => F.setup(path.join(arena, 'case-' + sequence++), options);
const read = s => API.readUiReviewAttempt(s.root, s.run.batchId, s.run.runId);
const reserve = s => A.reserve(G.context(s.root, s.run.batchId), R.request(encode(s.run)), s.request, s.input);
const count = s => fs.existsSync(path.join(s.root, 'callbacks.log')) ? fs.readFileSync(path.join(s.root, 'callbacks.log'), 'utf8').trim().split('\n').length : 0;
const reject = (fn, code) => assert.throws(fn, e => e.code === code, code);
const rejected = (fn, code) => assert.rejects(fn, e => e.code === code, code);
async function test(name, fn) {
  if (process.argv.includes('--smoke') && total >= 7 && !['killed process recovery at after-start',
    'two real processes race at start: exactly one callback', 'dry run cannot create a reservation'].includes(name)) return;
  total++; try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { console.error('FAIL ' + name + ': ' + error.stack); }
}
function worker(s, mode, gate = path.join(arena, 'gate-' + sequence++)) {
  const child = fork(path.join(__dirname, 'ui-review-attempt-worker.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }); children.add(child);
  let resolvePhase, resolveDone, result, errors = '';
  const phase = new Promise(resolve => { resolvePhase = resolve; });
  const done = new Promise(resolve => { resolveDone = resolve; });
  const timer = setTimeout(() => child.kill(), 45000);
  child.stderr.on('data', b => { errors += b; });
  child.on('message', m => {
    if (m.ready) child.send({ s, mode, gate });
    if (m.phase) resolvePhase(m.phase);
    if (m.result) result = m.result;
  });
  child.on('exit', (code, signal) => { clearTimeout(timer); children.delete(child); resolvePhase('exited'); resolveDone({ result, code, signal, errors }); });
  return { child, phase, done };
}
async function main() {
  try {
    await test('absent read leaves all bytes and mtimes unchanged', () => { const s = setup(), before = F.snapshot(s.root); assert.equal(read(s), null); assert.deepEqual(F.snapshot(s.root), before); });
    await test('reservation survives a fresh process and omits credentials/material text', async () => {
      const s = setup(), r = reserve(s), before = F.snapshot(s.root), out = await worker(s, 'read').done;
      assert.equal(out.result.value.state, 'reserved'); assert.equal(out.result.value.retryAllowed, false);
      assert.deepEqual(F.snapshot(s.root), before);
      const raw = G.readCommit(G.context(s.root, s.run.batchId), r.head).bytes;
      assert.ok(!raw.includes(s.run.owner.token)); assert.ok(!raw.includes('PRIVATE_MATERIAL'));
    });
    await test('identical reservation replay is read-only', () => { const s = setup(), r = reserve(s), before = F.snapshot(s.root); assert.equal(reserve(s).head, r.head); assert.deepEqual(F.snapshot(s.root), before); });
    await test('same run ID with different request is rejected before callback', async () => {
      const s = setup(); reserve(s); s.request.files.reverse(); const before = F.snapshot(s.root);
      await rejected(() => F.observe(s), 'attempt_conflict'); assert.equal(s.callbacks, 0); assert.deepEqual(F.snapshot(s.root), before);
    });
    await test('observation records unknown before callback and retained result recovers read-only', async () => {
      const s = setup(); const h = await F.observe(s, (supplied, rc) => { assert.equal(read(s).state, 'execution-unknown'); F.terminal(s, supplied, rc); return encode(rc); });
      assert.equal(read(s).retryAllowed, false); await rejected(() => F.observe(s), 'execution_unknown');
      const saved = API.retainUiReviewRun(h), before = F.snapshot(s.root), out = read(s);
      assert.equal(out.state, 'retained-record'); assert.equal(out.runCommit, saved.head); assert.deepEqual(F.snapshot(s.root), before); assert.equal(s.callbacks, 1);
      for (const k of ['actorIdentityVerified', 'semanticVerified', 'acceptedAuthorityVerified', 'approvalGranted', 'cleanupAllowed']) assert.equal(out[k], false);
    });
    await test('missing ledger retains a no-execution result without starting callback', async () => {
      const s = setup({ ledger: false }), h = await F.observe(s); assert.equal(read(s).state, 'reserved'); API.retainUiReviewRun(h);
      assert.equal(read(s).state, 'retained-record'); assert.equal(s.callbacks, 0);
    });
    await test('failed host execution is never retried before or after retention', async () => {
      const s = setup(), h = await F.observe(s, () => { throw new Error('PRIVATE_MATERIAL'); });
      await rejected(() => F.observe(s), 'execution_unknown'); API.retainUiReviewRun(h); await rejected(() => F.observe(s), 'run_conflict'); assert.equal(s.callbacks, 1);
    });
    for (const phase of ['before-reserve', 'after-reserve', 'before-start', 'after-start', 'callback', 'after-callback', 'after-retain']) {
      await test('killed process recovery at ' + phase, async () => {
        const s = setup(), w = worker(s, phase); assert.equal(await w.phase, phase); w.child.kill(); await w.done;
        const callbacks = count(s), state = read(s);
        if (phase === 'before-reserve') assert.equal(state, null);
        else assert.equal(state.state, ['after-reserve', 'before-start'].includes(phase) ? 'reserved' : phase === 'after-retain' ? 'retained-record' : phase === 'after-callback' ? 'observed-result' : 'execution-unknown');
        const out = await worker(s, 'normal').done;
        if (['before-reserve', 'after-reserve', 'before-start'].includes(phase)) { assert.equal(out.result.ok, true); assert.equal(count(s), 1); }
        else { assert.equal(out.result.code, phase === 'after-retain' ? 'run_conflict' : 'execution_unknown'); assert.equal(count(s), callbacks); }
        assert.equal(callbacks, ['callback', 'after-callback', 'after-retain'].includes(phase) ? 1 : 0);
      });
    }
    for (const phase of ['reserve', 'start']) await test('two real processes race at ' + phase + ': exactly one callback', async () => {
      const s = setup(), gate = path.join(arena, 'race-' + sequence++); if (phase === 'start') reserve(s);
      const a = worker(s, 'before-' + phase, gate), b = worker(s, 'before-' + phase, gate);
      assert.equal(await a.phase, 'before-' + phase); assert.equal(await b.phase, 'before-' + phase); fs.writeFileSync(gate, 'go');
      const out = await Promise.all([a.done, b.done]); assert.equal(out.filter(r => r.result && r.result.ok).length, 1, JSON.stringify(out));
      assert.equal(count(s), 1); assert.equal(read(s).state, 'retained-record');
    });
    await test('lost start CAS response persists unknown with zero callbacks and refuses retry', async () => {
      const s = setup(), original = G.run;
      G.run = (...args) => { const r = original(...args); return String(args[2]).includes('update refs/leerness/review-attempts/') ? { ...r, error: new Error('response lost') } : r; };
      try { await rejected(() => F.observe(s), 'publication_uncertain'); } finally { G.run = original; }
      assert.equal(s.callbacks, 0); assert.equal(read(s).state, 'execution-unknown'); await rejected(() => F.observe(s), 'execution_unknown');
    });
    await test('unknown is still recoverable after owner reclaim, without execution permission', async () => {
      const s = setup(), h = await F.observe(s); C.writeReviewControl(s.root, encode({ ...s.common, operation: 'reclaim', operationId: 'new-owner', expectedHead: s.control.head, generation: 1, snapshot: null }));
      assert.equal(read(s).state, 'observed-result'); reject(() => API.retainUiReviewRun(h), 'control_changed'); await rejected(() => F.observe(s), 'control_changed'); assert.equal(s.callbacks, 1);
    });
    await test('linked worktree reads shared unknown but cannot reuse owner credential', async () => {
      const s = setup(); await F.observe(s); const linked = path.join(arena, 'linked-' + sequence++); F.cmd(s.root, ['worktree', 'add', '--detach', linked, 'HEAD']);
      fs.mkdirSync(path.join(linked, '.leerness')); fs.writeFileSync(path.join(linked, '.leerness/HARNESS_VERSION'), '1.0.0\n');
      const x = { ...s, root: linked }; assert.equal(read(x).state, 'observed-result'); await rejected(() => F.observe(x), 'owner_mismatch');
    });
    await test('concurrent no-execution handle cannot replace a started attempt result', async () => {
      const s = setup(), ledger = fs.readFileSync(executionLedgerPath(s.root)); fs.unlinkSync(executionLedgerPath(s.root));
      const empty = await F.observe(s); fs.writeFileSync(executionLedgerPath(s.root), ledger); const good = await F.observe(s);
      reject(() => API.retainUiReviewRun(empty), 'publication_uncertain'); API.retainUiReviewRun(good); assert.equal(read(s).state, 'retained-record');
    });
    await test('retained no-execution result fences an already prepared start', async () => {
      const s = setup(), ledger = fs.readFileSync(executionLedgerPath(s.root)); fs.unlinkSync(executionLedgerPath(s.root));
      const empty = await F.observe(s); fs.writeFileSync(executionLedgerPath(s.root), ledger); const gate = path.join(arena, 'retained-gate'), w = worker(s, 'before-start', gate);
      assert.equal(await w.phase, 'before-start'); API.retainUiReviewRun(empty); fs.writeFileSync(gate, 'go'); const out = await w.done;
      assert.equal(out.result.code, 'publication_uncertain'); assert.equal(count(s), 0); assert.equal(read(s).state, 'retained-record');
    });
    await test('control changes at start CAS prevent callback', async () => {
      const s = setup(), gate = path.join(arena, 'control-gate'), w = worker(s, 'before-start', gate); assert.equal(await w.phase, 'before-start');
      C.writeReviewControl(s.root, encode({ ...s.common, operation: 'reclaim', operationId: 'new-owner', expectedHead: s.control.head, generation: 1, snapshot: null }));
      fs.writeFileSync(gate, 'go'); assert.equal((await w.done).result.code, 'publication_uncertain'); assert.equal(count(s), 0); assert.equal(read(s).state, 'reserved');
    });
    await test('dry run cannot create a reservation', async () => {
      const s = setup(), before = F.snapshot(s.root), git = require('../lib/git');
      git.setGitDryRun(true); try { await rejected(() => F.observe(s), 'E_DRY_RUN_WRITE'); } finally { git.setGitDryRun(false); }
      assert.deepEqual(F.snapshot(s.root), before);
    });
    await test('malformed and symbolic attempt refs fail closed', () => {
      const s = setup(), r = reserve(s), ctx = G.context(s.root, s.run.batchId), ref = A.context(ctx, s.run.runId).ref;
      const bad = G.prepareCommit(ctx, s.control.head, R.encode({ ...r.value, state: 'approved' })); F.cmd(s.root, ['update-ref', ref, bad]); reject(() => read(s), 'record_invalid');
      F.cmd(s.root, ['symbolic-ref', ref, ctx.ref]); reject(() => read(s), 'ref_invalid');
    });
    await test('late runtime rejection at start leaves reserved with zero callbacks', async () => {
      const s = setup(), original = G.run;
      G.run = (...args) => {
        if (String(args[2]).includes('update refs/leerness/review-attempts/')) {
          fs.mkdirSync(path.join(s.root, '.git/leerness')); fs.writeFileSync(path.join(s.root, '.git/leerness/layout.json'), '{"schemaVersion":999}');
        }
        return original(...args);
      };
      try { await rejected(() => F.observe(s), 'E_RUNTIME_LAYOUT_INCOMPATIBLE'); } finally { G.run = original; }
      assert.equal(s.callbacks, 0); assert.equal(read(s).state, 'reserved');
    });
    await test('unknown with a forged parent is rejected', () => {
      const s = setup(), r = reserve(s), ctx = G.context(s.root, s.run.batchId);
      const bad = G.prepareCommit(ctx, s.control.head, R.encode({ ...r.value, state: 'execution-unknown' }));
      F.cmd(s.root, ['update-ref', A.context(ctx, s.run.runId).ref, bad]); reject(() => read(s), 'record_invalid');
    });
    await test('older RunRecord without a reservation remains legacy-retained', async () => {
      const s = setup(), r = API.retainUiReviewRun(await F.observe(s)), ctx = G.context(s.root, s.run.batchId);
      F.cmd(s.root, ['update-ref', '-d', A.context(ctx, s.run.runId).ref]);
      F.cmd(s.root, ['update-ref', '-d', require('../lib/ui-review-result').context(ctx, s.run.runId).ref]); const before = F.snapshot(s.root);
      assert.equal(read(s).state, 'legacy-retained'); assert.equal(read(s).runCommit, r.head); assert.deepEqual(F.snapshot(s.root), before);
    });
    await test('wrong batch, root and run ID inputs fail closed', () => {
      const s = setup(); reserve(s); reject(() => API.readUiReviewAttempt(s.root, 'other-batch', s.run.runId), 'record_invalid');
      reject(() => API.readUiReviewAttempt('.', s.run.batchId, s.run.runId), 'root_invalid'); reject(() => API.readUiReviewAttempt(s.root, s.run.batchId, '../bad'), 'input_invalid');
    });
    await test('SHA-256 and Git GC preserve unknown and retained recovery', async () => {
      const s = setup({ format: 'sha256' }), h = await F.observe(s); F.cmd(s.root, ['gc', '--prune=now', '--quiet']); assert.equal(read(s).attemptHead.length, 64);
      API.retainUiReviewRun(h); F.cmd(s.root, ['gc', '--prune=now', '--quiet']); assert.equal(read(s).state, 'retained-record');
    });
  } finally {
    for (const child of children) child.kill();
    const owned = path.resolve(arena); assert.equal(path.dirname(owned), path.resolve(os.tmpdir())); assert.ok(path.basename(owned).startsWith('leerness-ui-attempt-'));
    removeTree(owned, { recursive: true, force: true });
  }
  console.log(`UI review attempt: ${passed}/${total} PASS`);
  console.log(JSON.stringify({ total, passed, failed: total - passed, node: process.version, independentReview: false }));
  if (passed !== total) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
