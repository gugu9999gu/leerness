'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const API = require('../lib/ui-review-run');
const A = require('../lib/ui-review-attempt');
const J = require('../lib/ui-review-result');
const G = require('../lib/review-control-git');
const R = require('../lib/ui-review-run-contract');
const C = require('../lib/review-control');
const F = require('./ui-review-run-fixture');
const { encode } = require('./ui-review-fixture');
const { executionLedgerPath } = require('../lib/role-fallback');
const { removeTree } = require('./temp-cleanup');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ui-result-'));
const children = new Set();
let total = 0, passed = 0, sequence = 0;
const setup = options => F.setup(path.join(arena, 'case-' + sequence++), options);
const read = s => API.readUiReviewAttempt(s.root, s.run.batchId, s.run.runId);
const recover = s => API.recoverUiReviewRun(s.root, encode(s.run));
const ref = s => J.context(G.context(s.root, s.run.batchId), s.run.runId).ref;
const reject = (fn, code) => assert.throws(fn, e => e.code === code, code);
const rejected = (fn, code) => assert.rejects(fn, e => e.code === code, code);
function reclaim(s) { C.writeReviewControl(s.root, encode({ ...s.common, operation: 'reclaim', operationId: 'new-owner', expectedHead: s.control.head, generation: 1, snapshot: null })); }
function worker(s, mode, gate = path.join(arena, 'gate-' + sequence++)) {
  const child = fork(path.join(__dirname, 'ui-review-attempt-worker.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }); children.add(child);
  let phaseResolve, doneResolve, result, errors = '';
  const phase = new Promise(resolve => { phaseResolve = resolve; }), done = new Promise(resolve => { doneResolve = resolve; });
  const timer = setTimeout(() => child.kill(), 60000);
  child.stderr.on('data', b => { errors += b; });
  child.on('message', m => { if (m.ready) child.send({ s, mode, gate }); if (m.phase) phaseResolve(m.phase); if (m.result) result = m.result; });
  child.on('exit', (code, signal) => { clearTimeout(timer); children.delete(child); phaseResolve('exited'); doneResolve({ result, code, signal, errors }); });
  return { child, phase, done };
}
async function test(name, fn) {
  if (process.argv.includes('--smoke') && total >= 5 && !['crash after-result resumes in fresh process', 'two fresh recoveries converge without executing again'].includes(name)) return;
  total++; try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { console.error('FAIL ' + name + ': ' + error.stack); }
}
async function main() {
  try {
    await test('observed result restores exact handle without writes or current file access', async () => {
      const s = setup(), h = await F.observe(s), state = read(s); assert.equal(state.state, 'observed-result');
      assert.equal(state.retryAllowed, false); assert.equal(state.runCommit, null); assert.ok(state.resultCommit);
      for (const f of s.request.files) fs.unlinkSync(path.join(s.root, f.path)); fs.unlinkSync(executionLedgerPath(s.root));
      const before = F.snapshot(s.root), recovered = recover(s); assert.deepEqual(recovered, h); assert.deepEqual(F.snapshot(s.root), before);
      const saved = API.retainUiReviewRun(recovered); assert.equal(saved.recordDigest, h.recordDigest); assert.equal(s.callbacks, 1);
      assert.equal(read(s).state, 'retained-record'); assert.equal(saved.approvalGranted, false); assert.equal(saved.actorIdentityVerified, false);
    });
    await test('lost result publication response recovers without calling reviewer again', async () => {
      const s = setup(), original = G.run;
      G.run = (...args) => { const r = original(...args); return String(args[2]).includes('create refs/leerness/review-results/') ? { ...r, error: new Error('lost response') } : r; };
      try { await rejected(() => F.observe(s), 'publication_uncertain'); } finally { G.run = original; }
      assert.equal(read(s).state, 'observed-result'); API.retainUiReviewRun(recover(s));
      await rejected(() => F.observe(s), 'run_conflict'); assert.equal(s.callbacks, 1);
    });
    await test('failure result preserves safe failure state and never invents a receipt', async () => {
      const s = setup(); await F.observe(s, () => { throw new Error('PRIVATE_MATERIAL'); });
      const r = API.retainUiReviewRun(recover(s)); assert.equal(r.record.observationState, 'failed'); assert.equal(r.record.receiptJson, null);
      assert.ok(!r.recordJson.includes('PRIVATE_MATERIAL')); assert.ok(!r.recordJson.includes(s.run.owner.token)); assert.equal(r.semanticVerified, false);
    });
    await test('absent and reserved attempts cannot manufacture a result', async () => {
      const s = setup({ ledger: false }), before = F.snapshot(s.root); reject(() => recover(s), 'result_missing'); assert.deepEqual(F.snapshot(s.root), before);
      await F.observe(s); assert.equal(read(s).state, 'reserved'); reject(() => recover(s), 'result_missing');
    });
    await test('wrong owner generation and input cannot recover another result', async () => {
      const s = setup(); await F.observe(s); const before = F.snapshot(s.root);
      for (const [change, code] of [[{ owner: { ...s.run.owner, token: 'f'.repeat(64) } }, 'owner_mismatch'], [{ generation: 2 }, 'stale_generation'], [{ expectedHead: 'a'.repeat(40) }, 'control_changed'], [{ extra: true }, 'input_invalid']]) {
        reject(() => API.recoverUiReviewRun(s.root, encode({ ...s.run, ...change })), code);
      }
      assert.deepEqual(F.snapshot(s.root), before);
    });
    for (const boundary of ['before-result', 'after-result', 'after-callback', 'after-retain']) await test('crash ' + boundary + ' resumes in fresh process', async () => {
      const s = setup(), w = worker(s, boundary); assert.equal(await w.phase, boundary); w.child.kill(); await w.done;
      const before = fs.readFileSync(path.join(s.root, 'callbacks.log'), 'utf8'); assert.equal(before, 'called\n');
      const out = await worker(s, 'recover').done;
      if (boundary === 'before-result') { assert.equal(out.result.code, 'result_missing'); assert.equal(read(s).state, 'execution-unknown'); }
      else { assert.equal(out.result.ok, true, JSON.stringify(out)); assert.equal(read(s).state, 'retained-record'); }
      assert.equal(fs.readFileSync(path.join(s.root, 'callbacks.log'), 'utf8'), before);
    });
    await test('two fresh recoveries converge without executing again', async () => {
      const s = setup(); await F.observe(s); const gate = path.join(arena, 'race'), a = worker(s, 'recover-race', gate), b = worker(s, 'recover-race', gate);
      assert.equal(await a.phase, 'recover-race'); assert.equal(await b.phase, 'recover-race'); fs.writeFileSync(gate, 'go');
      const out = await Promise.all([a.done, b.done]); assert.ok(out.some(r => r.result && r.result.ok), JSON.stringify(out));
      for (const r of out) assert.ok(r.result && (r.result.ok || r.result.code === 'publication_uncertain'), JSON.stringify(out));
      const saved = API.retainUiReviewRun(recover(s)); assert.equal(saved.applied, false); assert.equal(s.callbacks, 1);
      assert.ok(!fs.existsSync(path.join(s.root, 'callbacks.log')));
    });
    await test('reclaimed control preserves late historical result but prevents retention', async () => {
      const s = setup(); await F.observe(s, (supplied, rc) => { F.terminal(s, supplied, rc); reclaim(s); return encode(rc); });
      assert.equal(read(s).state, 'observed-result'); reject(() => recover(s), 'control_changed'); assert.equal(API.readUiReviewRun(s.root, s.run.batchId, s.run.runId), null);
    });
    await test('linked worktree may inspect shared result but cannot retain as original owner', async () => {
      const s = setup(); await F.observe(s); const linked = path.join(arena, 'linked'); F.cmd(s.root, ['worktree', 'add', '--detach', linked, 'HEAD']);
      fs.mkdirSync(path.join(linked, '.leerness')); fs.writeFileSync(path.join(linked, '.leerness/HARNESS_VERSION'), '1.0.0\n');
      assert.equal(read({ ...s, root: linked }).resultCommit, read(s).resultCommit); reject(() => recover({ ...s, root: linked }), 'owner_mismatch');
    });
    await test('result ref deletion after recovery fences retention', async () => {
      const s = setup(); await F.observe(s); const h = recover(s); F.cmd(s.root, ['update-ref', '-d', ref(s)]);
      reject(() => API.retainUiReviewRun(h), 'result_changed'); assert.equal(read(s).state, 'execution-unknown');
    });
    await test('result changes at the actual retain transaction cannot publish a run', async () => {
      const s = setup(); await F.observe(s); const h = recover(s), original = G.run; let changed = false;
      G.run = (...args) => {
        if (String(args[2]).includes('create refs/leerness/review-runs/')) { F.cmd(s.root, ['update-ref', '-d', ref(s)]); changed = true; }
        return original(...args);
      };
      try { reject(() => API.retainUiReviewRun(h), 'publication_uncertain'); } finally { G.run = original; }
      assert.equal(changed, true); assert.equal(API.readUiReviewRun(s.root, s.run.batchId, s.run.runId), null);
    });
    await test('malformed symbolic wrong-parent and wrong-binding result records fail closed', async () => {
      const s = setup(); await F.observe(s); const ctx = G.context(s.root, s.run.batchId), a = A.read(ctx, s.run.runId), r = J.read(ctx, s.run.runId, a);
      for (const [bytes, parent, code] of [[r.bytes + '\n', a.head, 'record_invalid'], [r.bytes, s.control.head, 'result_conflict'], [R.encode({ ...r.record, currentInputDigest: 'sha256:' + 'a'.repeat(64) }), a.head, 'attempt_conflict']]) {
        F.cmd(s.root, ['update-ref', ref(s), G.prepareCommit(ctx, parent, bytes)]); reject(() => recover(s), code);
      }
      F.cmd(s.root, ['symbolic-ref', ref(s), ctx.ref]); reject(() => recover(s), 'ref_invalid');
    });
    await test('dry run allows read-only recovery and prevents retention', async () => {
      const s = setup(); await F.observe(s); const before = F.snapshot(s.root), git = require('../lib/git'); git.setGitDryRun(true);
      try { const h = recover(s); reject(() => API.retainUiReviewRun(h), 'E_DRY_RUN_WRITE'); } finally { git.setGitDryRun(false); }
      assert.deepEqual(F.snapshot(s.root), before);
    });
    await test('late incompatible runtime blocks result publication', async () => {
      const s = setup(), original = G.run;
      G.run = (...args) => {
        if (String(args[2]).includes('create refs/leerness/review-results/')) { fs.mkdirSync(path.join(s.root, '.git/leerness')); fs.writeFileSync(path.join(s.root, '.git/leerness/layout.json'), '{"schemaVersion":999}'); }
        return original(...args);
      };
      try { await rejected(() => F.observe(s), 'E_RUNTIME_LAYOUT_INCOMPATIBLE'); } finally { G.run = original; }
      assert.equal(read(s).state, 'execution-unknown'); assert.equal(s.callbacks, 1);
    });
    await test('SHA-256 GC preserves result and original attempt ancestry', async () => {
      const s = setup({ format: 'sha256' }); await F.observe(s); F.cmd(s.root, ['gc', '--prune=now', '--quiet']); assert.equal(read(s).resultCommit.length, 64);
      API.retainUiReviewRun(recover(s)); assert.equal(read(s).state, 'retained-record');
    });
  } finally {
    for (const child of children) child.kill();
    const owned = path.resolve(arena); assert.equal(path.dirname(owned), path.resolve(os.tmpdir())); assert.ok(path.basename(owned).startsWith('leerness-ui-result-'));
    removeTree(owned, { recursive: true, force: true });
  }
  console.log(`UI review result: ${passed}/${total} PASS`);
  console.log(JSON.stringify({ total, passed, failed: total - passed, node: process.version, independentReview: false }));
  if (passed !== total) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
