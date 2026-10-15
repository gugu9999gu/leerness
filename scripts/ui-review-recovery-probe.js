'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const F = require('./openai-ui-review-fixture');
const G = require('../lib/review-control-git');
const J = require('../lib/openai-ui-review-journal');
const A = require('../lib/ui-review-attempt');
const B = require('../lib/ui-review-recovery-bundle');
const R = require('../lib/ui-review-run-contract');
const C = require('../lib/review-control');
const { appendExecutionEvent, executionLedgerPath } = require('../lib/role-fallback');
const { removeTree } = require('./temp-cleanup');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-recover-'));
const children = new Set(), calls = [], key = 'fixture-' + randomUUID();
const policy = { schema: B.POLICY, materials: 'local-git-until-explicit-removal', ledger: 'identity-and-prefix-digest', reviewAttemptId: 'review-1' };
let sequence = 0, total = 0, passed = 0, server, network, cert;
const setup = extra => F.setup(path.join(arena, 'c' + sequence++), { ledger: true, ...extra });
const ctx = s => G.context(s.root, s.run.batchId);
const posts = () => calls.filter(r => r.method === 'POST').length;
const prepare = (s, p = policy) => F.API.prepareOpenAiUiReviewDispatch(s.root, F.encode(s.run), F.encode(s.request), F.encode(s.input), F.encode(F.config), F.encode(p));
const dispatch = s => { const h = prepare(s); return F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key); };
const recover = s => F.API.recoverOpenAiUiReviewDispatch(s.root, F.encode(s.run), F.encode(s.input));
const code = (fn, expected) => assert.throws(fn, e => !expected || e.code === expected, expected);
const rejected = (fn, expected) => assert.rejects(fn, e => !expected || e.code === expected, expected);
const append = (s, attemptId = 'other-attempt') => {
  const r = appendExecutionEvent(s.root, { event: 'dispatch.prepared', eventId: 'append-' + sequence++, taskId: 'T-ui', attemptId,
    requestedRole: 'reviewer', executed: false }); assert.equal(r.ok, true);
};
function worker(s, mode) {
  const child = fork(path.join(__dirname, 'openai-ui-review-worker.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  children.add(child); let resolvePhase, resolveDone, result, stderr = '', contractErrors = [];
  const phase = new Promise(r => { resolvePhase = r; }), done = new Promise(r => { resolveDone = r; });
  const timer = setTimeout(() => child.kill(), 180000);
  child.stderr.on('data', b => { stderr += b; });
  child.on('message', m => {
    if (m.ready) child.send({ s, mode, gate: path.join(arena, 'never-' + sequence++), port: server.address().port,
      cert: cert.toString(), key, recoveryPolicy: policy });
    if (m.phase) resolvePhase(m.phase);
    if (m.result) { result = m.result; contractErrors = m.contractErrors; }
  });
  child.on('exit', (exitCode, signal) => {
    clearTimeout(timer); children.delete(child); resolvePhase('exited');
    resolveDone({ result, exitCode, signal, stderr, contractErrors });
  });
  return { child, phase, done };
}
async function fresh(s) {
  const before = F.snapshot(s.root), n = calls.length, out = await worker(s, 'recover').done;
  assert.equal(out.exitCode, 0, out.stderr); assert.deepEqual(out.contractErrors, []);
  assert.equal(out.result.ok, true, JSON.stringify(out.result));
  assert.equal(out.result.value.recoveryState, 'inputs-restored');
  for (const [kind, digest] of out.result.digests) assert.equal(digest, R.sha(F.materialBytes[kind]));
  assert.deepEqual(F.snapshot(s.root), before); assert.equal(calls.length, n); return out.result.value;
}
async function test(name, run, smoke = false) {
  if (process.argv.includes('--smoke') && !smoke) return;
  if (process.argv.includes('--bundle') && !name.includes('termination at after-bundle ')) return;
  total++;
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (e) { console.error('FAIL ' + name + ': ' + e.stack); }
}
async function main() {
  const pair = F.certificate(arena); cert = pair.cert;
  server = https.createServer(pair, (req, res) => {
    const chunks = []; req.on('data', b => chunks.push(b)); req.on('end', () => {
      calls.push({ method: req.method, body: Buffer.concat(chunks) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'response', id: req.method === 'POST' ? 'resp_' + posts() : req.url.split('/').pop(),
        status: 'completed', model: 'fixture-model', created_at: 1741386163, output: [] }));
    });
  });
  server.on('tlsClientError', () => {});
  await new Promise(r => server.listen(0, '127.0.0.1', r)); network = F.bridge(server.address().port, cert);
  await test('explicit opt-in and original ledger baseline alter approval digest without writes', async () => {
    const s = setup(), before = F.snapshot(s.root), n = calls.length, old = F.prepare(s), h = prepare(s);
    assert.equal(old.recovery, undefined); assert.equal(h.recovery.policy.materials, policy.materials);
    assert.equal(h.recovery.ledger.eventCount, 2); assert.deepEqual(h.recovery.ledger.implementationEventIds, ['impl-event']);
    assert.notEqual(old.requestDigest, h.requestDigest); assert.equal(old.bodyDigest, h.bodyDigest);
    assert.notEqual(prepare(s, { ...policy, reviewAttemptId: 'review-2' }).requestDigest, h.requestDigest);
    for (const p of [null, {}, { ...policy, materials: 'automatic' }, { ...policy, ledger: 'raw-copy' }, { ...policy, extra: true }]) code(() => prepare(s, p));
    const invalid = JSON.parse(JSON.stringify(h.recovery)); invalid.capture.files[0] = invalid.capture.files[1];
    code(() => B.validate(invalid, s.request), 'recovery_record_invalid');
    await rejected(() => F.API.dispatchOpenAiUiReviewRun(h, old.requestDigest, key), 'dispatch_approval_mismatch');
    assert.deepEqual(F.snapshot(s.root), before); assert.equal(calls.length, n);
  }, true);
  await test('POST retains original blobs; fresh process restores prefix after append with no network or writes', async () => {
    const s = setup(), h = prepare(s), n = posts();
    const out = await F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key); assert.equal(out.ok, true); assert.equal(posts(), n + 1);
    append(s); const restored = await fresh(s);
    assert.ok(restored.ledger.afterBytes > restored.ledger.beforeBytes); assert.equal(restored.ledger.prefixPreserved, true);
    assert.equal(restored.schema, 'leerness.ui-review-recovered-inputs/v1'); assert.equal(restored.runRecordRestored, false);
    for (const flag of ['approvalGranted', 'semanticVerified', 'actorIdentityVerified', 'retryAllowed']) assert.equal(restored[flag], false);
    const handle = recover(s), copies = F.API.readRecoveredUiReviewMaterials(handle); copies[0].bytes.fill(0);
    assert.equal(F.API.readRecoveredUiReviewMaterials(handle)[0].digest, R.sha(F.API.readRecoveredUiReviewMaterials(handle)[0].bytes));
    code(() => F.API.readRecoveredUiReviewMaterials({ ...handle }), 'recovery_handle_invalid');
    const c = ctx(s), j = J.read(c, s.run.runId), tree = F.cmd(s.root, ['ls-tree', j.intent.value.bundleHead]);
    assert.equal(tree.split('\n').length, 5); assert.equal(tree.includes('ledger'), false);
    for (const head of [j.intent.head, j.locator.head]) {
      const bytes = G.readCommit(c, head).bytes;
      for (const secret of [key, s.run.owner.token, 'PRIVATE_SOURCE', 'execution.completed']) assert.equal(bytes.includes(secret), false);
    }
    assert.equal(G.readRef({ ...c, ref: A.runRef(c, s.run.runId) }), null);
    assert.equal((await F.lookup(s, key)).observation.ok, true); assert.equal(posts(), n + 1);
  }, true);
  await test('ledger append between preview and submission prevents reservation and POST', async () => {
    const s = setup(), h = prepare(s), n = posts(); append(s);
    await rejected(() => F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key));
    assert.equal(F.read(s), null); assert.equal(A.read(ctx(s), s.run.runId), null); assert.equal(posts(), n);
  });
  await test('ledger change after intent prevents both public and internal submission', async () => {
    const s = setup(), h = prepare(s), n = posts(), original = G.run;
    G.run = (...args) => { const r = original(...args); if (String(args[2]).includes('create refs/leerness/review-dispatches/')) append(s); return r; };
    try { await rejected(() => F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key)); } finally { G.run = original; }
    const j = J.read(ctx(s), s.run.runId); assert.equal(j.attempt.value.state, 'reserved');
    const O = require('../lib/ui-review-observation'), Q = require('../lib/openai-ui-review-request');
    const body = Q.body(O.captureUiReview(s.root, F.encode(s.request)), F.config);
    await rejected(() => J.submit(s.root, s.run.batchId, s.run.runId, j.intent.head, j.attempt.head, body, key));
    assert.equal(posts(), n); assert.equal(recover(s).state, 'reserved');
  });
  await test('missing ledger and pre-existing reviewer attempt cannot become original baseline', () => {
    const n = calls.length, s = setup({ ledger: false }); code(() => prepare(s));
    const t = setup(); append(t, policy.reviewAttemptId); code(() => prepare(t)); assert.equal(calls.length, n);
  });
  await test('original ledger prefix mutation replacement missing file and incomplete append are rejected', async () => {
    const s = setup(); await dispatch(s); const file = executionLedgerPath(s.root), bytes = fs.readFileSync(file), old = file + '.original';
    fs.writeFileSync(file, Buffer.from(bytes.toString().replace('impl-event', 'evil-event'))); code(() => recover(s));
    fs.writeFileSync(file, bytes); fs.renameSync(file, old); fs.writeFileSync(file, bytes); code(() => recover(s));
    fs.unlinkSync(file); code(() => recover(s)); fs.renameSync(old, file);
    fs.appendFileSync(file, '{'); code(() => recover(s));
  });
  await test('same-byte material replacement and stale metadata are not recaptured as original', async () => {
    const s = setup(); await dispatch(s); const handle = recover(s), file = path.join(s.root, 'source.bin');
    fs.renameSync(file, file + '.original'); fs.writeFileSync(file, F.materialBytes.source);
    code(() => recover(s), 'recovery_materials_changed'); code(() => F.API.readRecoveredUiReviewMaterials(handle), 'recovery_materials_changed');
  });
  await test('current input and original owner remain required for material access', async () => {
    const s = setup(); await dispatch(s); const h = recover(s);
    code(() => F.API.recoverOpenAiUiReviewDispatch(s.root, F.encode(s.run), F.encode({ ...s.input, unknown: true })), 'snapshot_mismatch');
    code(() => recover({ ...s, run: { ...s.run, owner: { ...s.run.owner, token: 'a'.repeat(64) } } }), 'dispatch_run_mismatch');
    C.writeReviewControl(s.root, F.encode({ ...s.common, operation: 'reclaim', operationId: 'new-owner', expectedHead: s.control.head, generation: 1, snapshot: null }));
    code(() => recover(s), 'control_changed'); code(() => F.API.readRecoveredUiReviewMaterials(h), 'control_changed');
  });
  await test('legacy locator cannot acquire a fabricated pre-dispatch baseline', async () => {
    const s = setup(), h = F.prepare(s); await F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key);
    code(() => recover(s), 'recovery_missing'); assert.equal(F.read(s).recoveryBundleHead, undefined);
  });
  for (const phase of ['after-bundle', 'after-intent', 'after-start', 'after-locator']) {
    await test('actual process termination at ' + phase + ' preserves only published evidence and never resends', async () => {
      const s = setup(), n = posts(), w = worker(s, phase); assert.equal(await w.phase, phase); w.child.kill(); await w.done;
      assert.equal(posts(), n + (phase === 'after-locator' ? 1 : 0));
      if (phase === 'after-bundle') { assert.equal(F.read(s), null); code(() => recover(s), 'recovery_missing'); }
      else {
        const restored = await fresh(s); assert.equal(restored.state, phase === 'after-intent' ? 'reserved' : phase === 'after-start' ? 'execution-unknown' : 'response-located');
        if (phase !== 'after-intent') code(() => prepare(s), 'execution_unknown');
      }
      assert.equal(posts(), n + (phase === 'after-locator' ? 1 : 0));
    });
  }
  for (const marker of ['create refs/leerness/review-dispatches/', 'update refs/leerness/review-attempts/']) {
    await test('lost publication acknowledgment at ' + (marker.startsWith('create') ? 'intent' : 'execution fence') + ' remains inspectable without POST', async () => {
      const s = setup(), n = posts(), original = G.run; let injected = false;
      G.run = (...args) => { const r = original(...args); if (!injected && String(args[2]).includes(marker)) { injected = true; return { ...r, status: 1 }; } return r; };
      try { await rejected(() => dispatch(s), 'publication_uncertain'); } finally { G.run = original; }
      assert.equal(injected, true); assert.equal(posts(), n); await fresh(s); assert.equal(posts(), n);
    });
  }
  await test('SHA256 GC preserves actual material objects; linked worktree has no original owner authority', async () => {
    const s = setup({ format: 'sha256' }); await dispatch(s); F.cmd(s.root, ['gc', '--prune=now', '--quiet']);
    assert.equal((await fresh(s)).recoveryBundleHead.length, 64);
    const linked = path.join(arena, 'linked'); F.cmd(s.root, ['worktree', 'add', '-q', '--detach', linked]);
    code(() => recover({ ...s, root: linked }), 'owner_mismatch');
  });
  await test('wrong bundle parent tree membership and substituted material fail canonical reads', async () => {
    const s = setup(); await dispatch(s); const c = ctx(s), j = J.read(c, s.run.runId), ref = J.context(c, s.run.runId).ref;
    const tree = F.cmd(s.root, ['rev-parse', j.intent.value.bundleHead + '^{tree}']);
    const entries = F.cmd(s.root, ['ls-tree', tree]);
    const badBlob = F.cmd(s.root, ['hash-object', '-w', '--stdin'], { input: 'different bytes' });
    const variants = [
      [tree, s.control.head, 'recovery_record_invalid'],
      [F.cmd(s.root, ['mktree'], { input: entries + `\n100644 blob ${badBlob}\textra\n` }), G.readCommit(c, j.attempt.head).parents[0], 'recovery_record_invalid'],
      [F.cmd(s.root, ['mktree'], { input: entries.replace(/100644 blob [0-9a-f]+\tmaterial-0/, `100644 blob ${badBlob}\tmaterial-0`) + '\n' }), G.readCommit(c, j.attempt.head).parents[0], 'recovery_materials_changed']
    ];
    for (const [badTree, parent, expected] of variants) {
      const bundle = F.cmd(s.root, ['commit-tree', badTree, '-p', parent, '--no-gpg-sign'], { input: 'invalid bundle\n' });
      const head = G.prepareCommit(c, bundle, R.encode({ ...j.intent.value, bundleHead: bundle }));
      F.cmd(s.root, ['update-ref', ref, head]); code(() => F.read(s), expected);
    }
    F.cmd(s.root, ['update-ref', ref, j.intent.head]); assert.equal(recover(s).recoveryState, 'inputs-restored');
  });
  await test('dry-run and incompatible layout prevent bundle persistence and network', async () => {
    const s = setup(), h = prepare(s), before = F.snapshot(s.root), n = posts(), git = require('../lib/git');
    git.setGitDryRun(true);
    try { await rejected(() => F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key), 'E_DRY_RUN_WRITE'); } finally { git.setGitDryRun(false); }
    assert.deepEqual(F.snapshot(s.root), before);
    fs.mkdirSync(path.join(s.root, '.git/leerness')); fs.writeFileSync(path.join(s.root, '.git/leerness/layout.json'), '{"schemaVersion":999}');
    await rejected(() => dispatch(s), 'E_RUNTIME_LAYOUT_INCOMPATIBLE'); assert.equal(posts(), n);
  }, true);
  assert.deepEqual(network.errors, []);
  console.log(`${passed}/${total} PASS; original materials and ledger prefix; actual Git, processes and loopback TLS; no provider calls`);
  if (passed !== total) process.exitCode = 1;
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(async () => {
  for (const child of children) child.kill(); network?.restore();
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  const resolved = fs.realpathSync(arena); assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('lr-recover-'));
  removeTree(resolved, { recursive: true, force: true });
});
