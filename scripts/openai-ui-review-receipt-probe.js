'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const F = require('./openai-ui-review-fixture');
const RF = require('./ui-review-fixture');
const D = require('../lib/ui-review-provider-receipt');
const B = require('../lib/ui-review-recovery-bundle');
const G = require('../lib/review-control-git');
const J = require('../lib/openai-ui-review-journal');
const C = require('../lib/review-control');
const R = require('../lib/ui-review-run-contract');
const { appendExecutionEvent, executionLedgerPath } = require('../lib/role-fallback');
const { removeTree } = require('./temp-cleanup');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-receipt-')), children = new Set(), calls = [], serverErrors = [];
const key = 'fixture-' + randomUUID(), config = { ...F.config, store: true, timeoutMs: 15000 };
const recovery = { schema: B.POLICY, materials: 'local-git-until-explicit-removal', ledger: 'identity-and-prefix-digest', reviewAttemptId: 'review-1' };
const policy = { schema: D.POLICY, modelMatch: 'exact' };
let sequence = 0, passed = 0, total = 0, server, network, pair, current, onGet, editResponse;
const setup = () => F.setup(path.join(arena, 'c' + sequence++), { ledger: true });
const prepare = (s, r = recovery, p = policy, c = config) => F.API.prepareOpenAiUiReviewDispatch(s.root, F.encode(s.run), F.encode(s.request), F.encode(s.input), F.encode(c), F.encode(r), F.encode(p));
const get = (s, input = s.input, run = s.run, profile = config.profile) => F.API.retrieveOpenAiUiReviewReceipt(s.root, F.encode(run), F.encode(input), F.encode(profile), key);
const posts = () => calls.filter(c => c.method === 'POST').length;
const dispatch = async s => { current = s; const h = prepare(s); assert.equal((await F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key)).ok, true); return h; };
const ready = async () => { const s = setup(); await dispatch(s); return s; };
const append = s => assert.equal(appendExecutionEvent(s.root, { event: 'dispatch.prepared', eventId: 'extra-' + sequence++, taskId: 'T-ui', attemptId: 'other-' + sequence++, requestedRole: 'reviewer', executed: false }).ok, true);
const rejects = (fn, code) => assert.rejects(fn, e => !code || e.code === code, code);
function rc(s) { const r = RF.receipt(s.input); r.reviewer = { provider: config.provider, model: config.model, sessionId: null }; return r; }
function fresh(s) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'openai-ui-review-worker.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    children.add(child); let output, stderr = '';
    const timer = setTimeout(() => child.kill(), 180000);
    child.stderr.on('data', b => { stderr += b; }); child.on('error', reject);
    child.on('message', m => {
      if (m.ready) child.send({ s, mode: 'receipt', port: server.address().port, cert: pair.cert.toString(), key, config });
      if (m.result) output = m;
    });
    child.on('exit', code => { clearTimeout(timer); children.delete(child);
      try { assert.equal(code, 0, stderr); assert.deepEqual(output.contractErrors, []); assert.equal(output.result.ok, true, JSON.stringify(output)); resolve(output.result.value); }
      catch (e) { reject(e); }
    });
  });
}
async function test(name, fn, smoke = false) {
  if (process.argv.includes('--smoke') && !smoke) return;
  total++; onGet = null; editResponse = null;
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { console.error('FAIL ' + name + ': ' + e.stack); }
}
async function main() {
  pair = F.certificate(arena);
  server = https.createServer(pair, (req, res) => {
    const chunks = []; req.on('data', b => chunks.push(b)); req.on('end', () => {
      calls.push({ method: req.method, body: Buffer.concat(chunks), url: req.url });
      if (req.method === 'GET' && onGet) {
        const fn = onGet; onGet = null;
        try { fn(); } catch (e) { serverErrors.push(e.stack); res.writeHead(500); res.end(); return; }
      }
      const value = { object: 'response', id: req.method === 'POST' ? 'resp_' + posts() : req.url.split('/').pop(), status: req.method === 'POST' ? 'queued' : 'completed',
        model: config.model, created_at: 1741386163, output: req.method === 'POST' ? [] : [{ id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: F.encode(rc(current)), annotations: [] }] }] };
      if (req.method === 'GET' && editResponse) editResponse(value);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value));
    });
  });
  server.on('tlsClientError', () => {});
  await new Promise(r => server.listen(0, '127.0.0.1', r)); network = F.bridge(server.address().port, pair.cert);
  await test('explicit receipt opt-in changes approval digest and rejects incompatible policy before writes', async () => {
    const s = setup(), before = F.snapshot(s.root), n = calls.length;
    const old = F.API.prepareOpenAiUiReviewDispatch(s.root, F.encode(s.run), F.encode(s.request), F.encode(s.input), F.encode(config), F.encode(recovery));
    const h = prepare(s); assert.notEqual(old.requestDigest, h.requestDigest); assert.notEqual(old.bodyDigest, h.bodyDigest);
    assert.deepEqual(h.receiptPolicy, policy);
    for (const p of [null, {}, { ...policy, modelMatch: 'alias' }]) assert.throws(() => prepare(s, recovery, p));
    assert.throws(() => prepare(s, { ...recovery, reviewAttemptId: 'a'.repeat(81) }));
    assert.throws(() => prepare(s, recovery, policy, F.config));
    assert.throws(() => F.API.prepareOpenAiUiReviewDispatch(s.root, F.encode(s.run), F.encode(s.request), F.encode(s.input), F.encode(config), undefined, F.encode(policy)));
    await rejects(() => F.API.dispatchOpenAiUiReviewRun(h, old.requestDigest, key), 'dispatch_approval_mismatch');
    assert.deepEqual(F.snapshot(s.root), before); assert.equal(calls.length, n);
  }, true);
  await test('actual POST binds receipt instructions; fresh process GET validates original receipt without writes or repeat POST', async () => {
    const s = await ready(), n = posts(), before = F.snapshot(s.root), sent = JSON.parse(calls.at(-1).body.toString());
    assert.ok(sent.instructions.includes(RF.packet(s.input).packetId)); assert.ok(sent.instructions.includes('review-1'));
    assert.ok(sent.instructions.includes('inconclusive')); assert.equal(sent.instructions.includes(s.run.owner.token), false);
    const j = J.read(G.context(s.root, s.run.batchId), s.run.runId); assert.equal(j.intent.value.schema, J.RECEIPT_SCHEMA);
    const result = await fresh(s); assert.equal(result.state, 'receipt-observed'); assert.equal(result.receiptDigest, R.sha(F.encode(rc(s))));
    assert.equal(result.responseId, j.locator.value.response.id); assert.equal(result.ledger.beforeDigest, j.intent.value.recovery.ledger.prefixDigest);
    assert.equal(result.ledger.beforeBytes, result.ledger.afterBytes); assert.match(result.responseDigest, /^sha256:/);
    for (const flag of ['ledgerLinked', 'runRecordRestored', 'approvalGranted', 'semanticVerified', 'actorIdentityVerified', 'retryAllowed']) assert.equal(result[flag], false);
    assert.deepEqual(F.snapshot(s.root), before); assert.equal(posts(), n); assert.equal(calls.at(-1).method, 'GET');
    assert.equal(F.API.recoverOpenAiUiReviewDispatch(s.root, F.encode(s.run), F.encode(s.input)).recoveryState, 'inputs-restored');
  }, true);
  await test('legacy v1 and v2 remain readable but cannot acquire receipt policy retroactively', async () => {
    for (const recoverable of [false, true]) {
      const s = setup(); current = s;
      const h = F.API.prepareOpenAiUiReviewDispatch(s.root, F.encode(s.run), F.encode(s.request), F.encode(s.input), F.encode(config), recoverable ? F.encode({ ...recovery, reviewAttemptId: 'a'.repeat(81) }) : undefined);
      assert.equal((await F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key)).ok, true);
      const n = calls.length; await rejects(() => get(s), 'receipt_policy_missing'); assert.equal(calls.length, n);
      assert.equal((await F.lookup(s, key)).observation.ok, true);
    }
  });
  await test('wrong owner profile or current input rejects before network', async () => {
    const s = await ready(), n = calls.length;
    await rejects(() => get(s, s.input, { ...s.run, owner: { ...s.run.owner, token: 'a'.repeat(64) } }), 'dispatch_run_mismatch');
    await rejects(() => get(s, s.input, s.run, { ...config.profile, profileRevision: 'v2' }), 'dispatch_profile_mismatch');
    const input = RF.clone(s.input); input.uiMaterials[0].specDigest = RF.hash('e');
    await rejects(() => get(s, input), 'snapshot_mismatch'); assert.equal(calls.length, n);
  });
  await test('completed transport is insufficient: wrong attempt refusal incomplete model and malformed output remain unresolved', async () => {
    const s = await ready(), n = posts();
    for (const [edit, expected] of [
      [v => { const r = rc(s); r.attemptId = 'other'; v.output[0].content[0].text = F.encode(r); }, 'receipt_binding_mismatch'],
      [v => { v.output[0].content[0] = { type: 'refusal', refusal: 'private refusal' }; }, 'receipt_refused'],
      [v => { v.status = 'incomplete'; }, 'receipt_response_incomplete'],
      [v => { v.model = config.model + '-alias'; }, 'receipt_response_mismatch'],
      [v => { v.output.push(v.output[0]); }, 'receipt_output_invalid'],
      [v => { v.output[0].content[0].text = '{"schema":1,"schema":2}'; }, 'receipt_invalid'],
    ]) { editResponse = edit; const result = await get(s); assert.equal(result.reasonCode, expected); assert.equal(result.receiptJson, null); }
    assert.equal(posts(), n);
  }, true);
  await test('missing coverage stays incomplete and findings stay findings after real GET', async () => {
    const s = await ready();
    editResponse = v => { const r = rc(s); r.coverage.pop(); v.output[0].content[0].text = F.encode(r); };
    const incomplete = await get(s); assert.equal(incomplete.state, 'receipt-observed'); assert.equal(incomplete.assessment.state, 'incomplete');
    editResponse = v => { const r = rc(s); r.coverage[0].outcome = 'finding'; r.coverage[0].findingIndexes = [0];
      r.review.findings = [{ category: 'instruction_to_ui_leakage', subtype: r.coverage[0].subtype, sourceKind: 'specification', severity: 'advisory', disposition: 'review-remediation', evidenceDigest: s.input.uiMaterials[0].specDigest }];
      v.output[0].content[0].text = F.encode(r); };
    assert.equal((await get(s)).assessment.state, 'findings');
  });
  await test('normal ledger append during GET retains original baseline', async () => {
    const s = await ready(); onGet = () => append(s);
    const result = await get(s); assert.equal(result.state, 'receipt-observed'); assert.ok(result.ledger.afterBytes > result.ledger.beforeBytes);
    assert.equal(result.ledgerLinked, false);
  });
  await test('same-byte material replacement during GET is rejected after response', async () => {
    const s = await ready(), n = calls.length; onGet = () => { const file = path.join(s.root, 'source.bin'); fs.renameSync(file, file + '.old'); fs.writeFileSync(file, F.materialBytes.source); };
    await rejects(() => get(s), 'recovery_materials_changed'); assert.equal(calls.length, n + 1);
  }, true);
  await test('ledger prefix rewrite during GET cannot become a new baseline', async () => {
    const s = await ready(); onGet = () => { const file = executionLedgerPath(s.root); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('impl-event', 'evil-event')); };
    await rejects(() => get(s));
  });
  await test('control owner release during GET invalidates the result', async () => {
    const s = await ready(); onGet = () => C.writeReviewControl(s.root, F.encode({ ...s.common, operation: 'release', operationId: 'release', expectedHead: s.control.head, generation: s.control.generation, snapshot: null }));
    await rejects(() => get(s));
  });
  await test('locator removal during GET invalidates the result', async () => {
    const s = await ready(), ctx = G.context(s.root, s.run.batchId); onGet = () => F.cmd(s.root, ['update-ref', '-d', J.context(ctx, s.run.runId, true).ref]);
    await rejects(() => get(s), 'dispatch_changed');
  });
  await test('dry-run blocks receipt POST while receipt GET stays read-only', async () => {
    const s = await ready(), before = F.snapshot(s.root), n = posts(), git = require('../lib/git');
    git.setGitDryRun(true); try { assert.equal((await get(s)).state, 'receipt-observed'); } finally { git.setGitDryRun(false); }
    assert.deepEqual(F.snapshot(s.root), before); assert.equal(posts(), n);
    const t = setup(), h = prepare(t), snap = F.snapshot(t.root); git.setGitDryRun(true);
    try { await rejects(() => F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key), 'E_DRY_RUN_WRITE'); } finally { git.setGitDryRun(false); }
    assert.deepEqual(F.snapshot(t.root), snap); assert.equal(posts(), n);
  });
  assert.deepEqual(network.errors, []);
  assert.deepEqual(serverErrors, [], 'fixture mutation failures cannot count as product rejection');
  console.log(`UI provider receipt: ${passed}/${total} PASS; actual Git, processes and loopback TLS; no provider calls`);
  if (passed !== total) process.exitCode = 1;
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(async () => {
  for (const child of children) child.kill(); network?.restore();
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  const resolved = fs.realpathSync(arena); assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('lr-receipt-'));
  removeTree(resolved, { recursive: true, force: true });
});
