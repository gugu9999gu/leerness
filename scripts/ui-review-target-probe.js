'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const git = require('../lib/git');
let reading = false, reads = 0;
const originalGit = git.gitSpawn;
git.gitSpawn = (args, options) => {
  if (reading) {
    reads++;
    const writes = ['update-ref', 'hash-object', 'mktree', 'commit-tree', 'update-index', 'add', 'commit', 'fetch'];
    const command = args.find(v => [...writes, 'cat-file', 'ls-tree', 'symbolic-ref', 'for-each-ref', 'rev-parse', 'config', 'status', 'rev-list'].includes(v));
    assert.ok(!writes.includes(command), 'read path attempted Git write/network: ' + command);
  }
  return originalGit(args, options);
};
for (const module of ['node:http', 'node:https']) {
  require(module).request = () => { throw new Error('unexpected network request'); };
  require(module).get = () => { throw new Error('unexpected network request'); };
}
const T = require('../lib/ui-review-target');
const U = require('../lib/ui-review-run');
const R = require('../lib/ui-review-run-contract');
const G = require('../lib/review-control-git');
const A = require('../lib/ui-review-attempt');
const J = require('../lib/ui-review-result');
const UI = require('../lib/ui-review');
const F = require('./ui-review-run-fixture');
const { clone, encode, hash, fixture } = require('./ui-review-fixture');
function operator(fn) { const before = reading; reading = false; try { return fn(); } finally { reading = before; } }
function invoke(s, input = s.descriptor, current = s.input) {
  const before = F.snapshot(s.root); reading = true;
  try { return T.assessUiReviewTarget(s.root, encode(input), encode(current)); }
  finally { reading = false; assert.deepEqual(F.snapshot(s.root), before, 'read changed file bytes/mtime'); }
}
function noAuthority(value) {
  for (const k of ['actorIdentityVerified', 'semanticVerified', 'acceptedAuthorityVerified', 'approvalGranted', 'cleanupAllowed']) assert.equal(value[k], false);
  assert.equal(value.independentReview, 'not-verified');
  assert.deepEqual(value.effects, { filesRead: true, filesWritten: false, networkUsed: false, modelInvoked: false });
}
function reject(fn, code) { assert.throws(fn, e => { assert.equal(e.code, code); return true; }); }

if (process.argv[2] === '--worker') {
  const value = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const out = invoke(value); noAuthority(out); console.log(JSON.stringify(out));
} else main().catch(e => { console.error(e.stack); process.exitCode = 1; });

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--smoke')
    || (args.length === 2 && args[0] === '--filter' && args[1].length), 'use --smoke or --filter <substring>');
  const filter = args[0] === '--filter' ? args[1] : null;
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-target-'));
  let total = 0, passed = 0, sequence = 0, base;
  function target(s, saved) {
    fs.mkdirSync(path.join(s.root, 'records'), { recursive: true });
    fs.writeFileSync(path.join(s.root, 'records/run.json'), saved.recordJson);
    F.cmd(s.root, ['add', '--', 'records/run.json', ...s.request.files.map(f => f.path)]);
    F.cmd(s.root, ['commit', '-qm', 'target evidence']);
    const commit = F.cmd(s.root, ['rev-parse', 'HEAD']); F.cmd(s.root, ['update-ref', 'refs/heads/candidate', commit]);
    return { schema: U.RETENTION_SCHEMA, batchId: s.run.batchId, runId: s.run.runId,
      ref: 'refs/heads/candidate', commit, recordPath: 'records/run.json' };
  }
  async function setup(edit) {
    const s = F.setup(path.join(arena, 'case-' + sequence++));
    s.materialBytes = Object.fromEntries(s.request.files.map(f => [f.path, fs.readFileSync(path.join(s.root, f.path))]));
    const handle = await F.observe(s, edit ? (supplied, rc) => { edit(rc, s); return encode(rc); } : undefined);
    const saved = U.retainUiReviewRun(handle), ctx = G.context(s.root, s.run.batchId);
    s.saved = saved; s.ctx = ctx;
    s.descriptor = { schema: T.INPUT_SCHEMA, target: target(s, saved), runCommit: saved.head,
      resultCommit: G.readRef(J.context(ctx, s.run.runId)), recordDigest: saved.recordDigest };
    return s;
  }
  async function common() { if (!base) base = await setup(); return base; }
  async function test(name, fn, smoke = false) {
    if ((filter && !name.includes(filter)) || (args[0] === '--smoke' && !smoke)) return;
    total++; const start = Date.now(); console.log('RUN ' + name);
    try { await fn(); passed++; console.log(`PASS ${name} (${((Date.now() - start) / 1000).toFixed(1)}s)`); }
    catch (e) { console.error('FAIL ' + name + ': ' + e.stack); }
  }
  try {
    await test('invalid inputs reject before any Git reads', () => {
      const descriptor = { schema: T.INPUT_SCHEMA, target: { schema: U.RETENTION_SCHEMA, batchId: 'b', runId: 'r',
        ref: 'refs/heads/candidate', commit: 'a'.repeat(40), recordPath: 'record.json' },
        runCommit: 'b'.repeat(40), resultCommit: 'c'.repeat(40), recordDigest: hash('d') };
      const inputs = ['{}', '\uFEFF' + encode(descriptor), encode({ ...descriptor, accepted: true }),
        encode({ ...descriptor, resultCommit: null }), encode({ ...descriptor, recordDigest: 'bad' }),
        encode({ ...descriptor, target: { ...descriptor.target, recordPath: '../record.json' } })];
      const before = reads; reading = true;
      try {
        for (const text of inputs) reject(() => T.assessUiReviewTarget(arena, text, encode(fixture())), 'input_invalid');
        assert.throws(() => T.assessUiReviewTarget(arena, encode(descriptor), '{}'), UI.UiReviewInputError);
      } finally { reading = false; }
      assert.equal(reads, before);
    }, true);
    await test('exact target binds retained record and result without granting authority; fresh process agrees', async () => {
      const s = await common(), out = invoke(s); noAuthority(out);
      assert.equal(out.assessment.state, 'review-candidate'); assert.equal(out.materials.files, 4);
      assert.equal(out.run.recordDigest, s.saved.recordDigest); assert.equal(out.run.resultCommit, s.descriptor.resultCommit);
      assert.equal(out.assessment.independence.state, 'compatible-declarations');
      const inputFile = path.join(arena, 'fresh.json'); fs.writeFileSync(inputFile, encode({ root: s.root, input: s.input, descriptor: s.descriptor }));
      const before = F.snapshot(s.root), child = spawnSync(process.execPath, [__filename, '--worker', inputFile], { encoding: 'utf8', timeout: 120000, maxBuffer: 65536 });
      assert.equal(child.status, 0, String(child.stderr || child.error)); assert.deepEqual(JSON.parse(child.stdout), out);
      assert.deepEqual(F.snapshot(s.root), before); assert.equal(s.callbacks, 1);
    }, true);
    await test('same target bytes cannot hide changed criteria policy dependencies contributors or materials', async () => {
      const s = await common();
      for (const [edit, binding] of [
        [v => { v.snapshot.materials.acceptanceDigest = hash('b'); }, 'snapshot'],
        [v => { v.snapshot.materials.policyDigest = hash('b'); }, 'snapshot'],
        [v => { v.snapshot.materials.dependenciesDigest = hash('b'); }, 'snapshot'],
        [v => { v.contributors[0].attemptId = 'other-contributor'; }, 'contributors'],
        [v => { v.uiMaterials[0].sourceDigest = hash('b'); }, 'uiMaterials'],
      ]) {
        const current = clone(s.input); edit(current); const out = invoke(s, s.descriptor, current);
        assert.equal(out.assessment.state, 'stale'); assert.ok(out.assessment.changedBindings.includes(binding)); noAuthority(out);
      }
    }, true);
    await test('wrong run result digest revision and another run are rejected', async () => {
      const s = await common();
      for (const [change, code] of [[{ runCommit: s.descriptor.target.commit }, 'target_record_mismatch'],
        [{ recordDigest: hash('e') }, 'target_record_mismatch'], [{ resultCommit: s.saved.head }, 'target_result_mismatch'],
        [{ target: { ...s.descriptor.target, commit: s.saved.head } }, 'target_changed'],
        [{ target: { ...s.descriptor.target, runId: 'another-run' } }, 'run_missing']]) reject(() => invoke(s, { ...s.descriptor, ...change }), code);
    });
    await test('each changed material and changed record bytes fail exact Git target verification', async () => {
      const s = await common(), t = s.descriptor.target;
      for (const file of [...s.request.files.map(f => f.path), t.recordPath]) {
        // Reset the fixture content via its known original bytes, not a repository reset.
        for (const f of s.request.files) fs.writeFileSync(path.join(s.root, f.path), s.materialBytes[f.path]);
        fs.writeFileSync(path.join(s.root, t.recordPath), s.saved.recordJson);
        fs.appendFileSync(path.join(s.root, file), '\nchanged');
        F.cmd(s.root, ['add', '--', ...s.request.files.map(f => f.path), t.recordPath]); F.cmd(s.root, ['commit', '-qm', 'changed target fixture']);
        const commit = F.cmd(s.root, ['rev-parse', 'HEAD']); F.cmd(s.root, ['update-ref', t.ref, commit]);
        try { reject(() => invoke(s, { ...s.descriptor, target: { ...t, commit } }), 'retention_mismatch'); }
        finally { F.cmd(s.root, ['update-ref', t.ref, t.commit]); }
      }
    });
    await test('target run attempt and result refs moving after assessment are rejected', async () => {
      const s = await common();
      const refs = [[s.descriptor.target.ref, s.descriptor.target.commit], [s.saved.ref, s.saved.head],
        [A.context(s.ctx, s.run.runId).ref, G.readRef(A.context(s.ctx, s.run.runId))],
        [J.context(s.ctx, s.run.runId).ref, s.descriptor.resultCommit]];
      for (const [ref, original] of refs) {
        const assess = UI.assessUiReview; let moved = false;
        UI.assessUiReview = (...values) => { const out = assess(...values); operator(() => F.cmd(s.root, ['update-ref', ref, s.run.expectedHead])); moved = true; return out; };
        reading = true;
        try { reject(() => T.assessUiReviewTarget(s.root, encode(s.descriptor), encode(s.input)), 'target_changed'); assert.equal(moved, true); }
        finally { reading = false; UI.assessUiReview = assess; F.cmd(s.root, ['update-ref', ref, original]); }
      }
    }, true);
    await test('missing result cannot be replaced by a retained record', async () => {
      const s = await common(), ref = J.context(s.ctx, s.run.runId).ref;
      F.cmd(s.root, ['update-ref', '-d', ref]);
      try { reject(() => invoke(s), 'result_missing'); }
      finally { F.cmd(s.root, ['update-ref', ref, s.descriptor.resultCommit]); }
    });
    await test('extra and duplicate coverage in actual stored Git records are rejected', async () => {
      const s = await common();
      for (const taskId of ['unexpected-task', 'T-ui']) {
        const value = clone(s.saved.record), rc = JSON.parse(value.receiptJson);
        rc.coverage.push({ ...rc.coverage[0], taskId }); value.receiptJson = encode(rc);
        value.ledger.receiptDigest = R.sha(value.receiptJson);
        const bytes = R.encode(value), head = G.prepareCommit(s.ctx, value.controlHead, bytes);
        F.cmd(s.root, ['update-ref', s.saved.ref, head]);
        try { reject(() => invoke(s, { ...s.descriptor, runCommit: head, recordDigest: R.sha(bytes) }), 'record_invalid'); }
        finally { F.cmd(s.root, ['update-ref', s.saved.ref, s.saved.head]); }
      }
    });
    for (const [name, edit, state] of [
      ['missing coverage', r => { r.coverage.pop(); }, 'incomplete'],
      ['inconclusive coverage', r => { r.coverage[0].outcome = 'inconclusive'; }, 'incomplete'],
      ['partial execution', r => { r.execution = 'partial'; }, 'incomplete'],
      ['failed execution', r => { r.execution = 'failed'; }, 'incomplete'],
      ['not-run receipt', r => { r.execution = 'not-run'; r.attemptId = null; r.reviewer = null; r.coverage = []; }, 'not-reviewed'],
      ['same-session review', (r, s) => { r.reviewer.sessionId = s.input.contributors[0].executor.sessionId; }, 'self-review'],
      ['unknown actor', r => { r.reviewer = null; }, 'identity-unverified'],
      ['unresolved finding', (r, s) => {
        r.review.findings.push({ category: 'instruction_to_ui_leakage', subtype: 'DEVELOPER_NOTE', sourceKind: 'developer_note',
          severity: 'advisory', disposition: 'review-remediation', evidenceDigest: s.input.uiMaterials[0].specDigest });
        const cell = r.coverage.find(c => c.subtype === 'DEVELOPER_NOTE'); cell.outcome = 'finding'; cell.findingIndexes = [0];
      }, 'findings'],
    ]) await test('retained ' + name + ' remains visible without approval', async () => {
      const s = await setup(edit), out = invoke(s); assert.equal(out.assessment.state, state); noAuthority(out);
      if (state === 'findings') assert.equal(out.assessment.findingCount, 1);
      assert.equal(s.callbacks, 1);
    });
    await test('dirty checkout and dry-run flags do not change the fixed target or write state', async () => {
      const s = await common(); fs.writeFileSync(path.join(s.root, 'source.bin'), 'dirty checkout');
      const io = require('../lib/io'); io.setDryRunGuard(true); git.setGitDryRun(true);
      try { assert.equal(invoke(s).assessment.state, 'review-candidate'); }
      finally { io.setDryRunGuard(false); git.setGitDryRun(false); }
    });
    assert.ok(total > 0, 'zero matching tests is a failure');
    console.log(`Tests: ${passed} passed, ${total - passed} failed, ${total} total`);
    if (passed !== total) process.exitCode = 1;
  } finally {
    const resolved = fs.realpathSync(arena); assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('lr-target-'));
    for (let attempt = 0; ; attempt++) {
      try { fs.rmSync(resolved, { recursive: true, force: true }); break; }
      catch (e) { if (attempt >= 5 || !['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES'].includes(e.code)) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1)); }
    }
  }
}
