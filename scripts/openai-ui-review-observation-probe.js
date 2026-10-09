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
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-observation-')), children = new Set(), calls = [], serverErrors = [];
const key = 'fixture-' + randomUUID(), config = { ...F.config, store: true, timeoutMs: 15000 };
const recovery = { schema: B.POLICY, materials: 'local-git-until-explicit-removal', ledger: 'identity-and-prefix-digest', reviewAttemptId: 'review-1' };
const K = require('../lib/openai-ui-review-observation-record');
const CC = require('../lib/review-control-contract');
const A = require('../lib/ui-review-attempt');
const E = require('../lib/ui-review-result');
const { removeTree } = require('./temp-cleanup');
const observationPolicy = { schema: K.POLICY, retention: 'local-git-until-explicit-removal' };
const policy = { schema: D.POLICY, modelMatch: 'exact' };
let sequence = 0, passed = 0, total = 0, server, network, pair, current, onGet, editResponse;
const setup = () => F.setup(path.join(arena, 'c' + sequence++), { ledger: true });
const prepare = (s, r = recovery, p = policy, c = config) => F.API.prepareOpenAiUiReviewDispatch(s.root, F.encode(s.run), F.encode(s.request), F.encode(s.input), F.encode(c), F.encode(r), F.encode(p), F.encode(observationPolicy));
const get = (s, input = s.input, run = s.run, profile = config.profile) => F.API.observeOpenAiUiReviewReceipt(s.root, F.encode(run), F.encode(input), F.encode(profile), key);
const posts = () => calls.filter(c => c.method === 'POST').length;
const dispatch = async s => { current = s; const h = prepare(s); assert.equal((await F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key)).ok, true); return h; };
const ready = async () => { const s = setup(); await dispatch(s); return s; };
const append = s => assert.equal(appendExecutionEvent(s.root, { event: 'dispatch.prepared', eventId: 'extra-' + sequence++, taskId: 'T-ui', attemptId: 'other-' + sequence++, requestedRole: 'reviewer', executed: false }).ok, true);
const rejects = (fn, code) => assert.rejects(fn, e => !code || e.code === code, code);
function rc(s) { const r = RF.receipt(s.input); r.reviewer = { provider: config.provider, model: config.model, sessionId: null }; return r; }
const recover = s => F.API.recoverOpenAiUiReviewReceipt(s.root, F.encode(s.run), F.encode(s.input), F.encode(config.profile));
const target = s => { const ctx = G.context(s.root, s.run.batchId); return { ...ctx, ref: `refs/leerness/provider-observations/v1/${ctx.projectKey}/${CC.digest(s.run.runId).slice(7)}` }; };
function fresh(s, mode = 'recover-receipt', phaseAction) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'openai-ui-review-worker.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    children.add(child); let output, stderr = '', reached = false;
    const gate = path.join(arena, 'gate-' + randomUUID());
    const timer = setTimeout(() => child.kill(), 300000);
    child.stderr.on('data', b => { stderr += b; }); child.on('error', reject);
    child.on('message', m => {
      if (m.ready) child.send({ s, mode, gate, port: server.address().port, cert: pair.cert.toString(), key, config });
      if (m.phase && phaseAction) { reached = true; phaseAction(child, gate, m.phase); }
      if (m.result) output = m;
    });
    child.on('exit', code => { clearTimeout(timer); children.delete(child);
      try { if (phaseAction && reached && !output) return resolve(null); assert.equal(code, 0, stderr); assert.deepEqual(output.contractErrors, []); resolve(output.result); }
      catch (e) { reject(e); }
    });
  });
}
async function test(name, fn, smoke = false, claim = false, depth = false) {
  if (process.argv.includes('--depth') && !depth) return;
  if (process.argv.includes('--claim') && !claim) return;
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
  await test('explicit storage opt-in changes approval only; old receipt GET and dry-run contracts remain intact', async () => {
    const s = setup(), before = F.snapshot(s.root), n = calls.length;
    const old = F.API.prepareOpenAiUiReviewDispatch(s.root, F.encode(s.run), F.encode(s.request), F.encode(s.input), F.encode(config), F.encode(recovery), F.encode(policy));
    const h = prepare(s); assert.notEqual(h.requestDigest, old.requestDigest); assert.equal(h.bodyDigest, old.bodyDigest);
    assert.deepEqual(h.observationPolicy, observationPolicy);
    assert.throws(() => F.API.prepareOpenAiUiReviewDispatch(s.root, F.encode(s.run), F.encode(s.request), F.encode(s.input), F.encode(config), F.encode(recovery), undefined, F.encode(observationPolicy)));
    await rejects(() => F.API.dispatchOpenAiUiReviewRun(h, old.requestDigest, key), 'dispatch_approval_mismatch');
    assert.deepEqual(F.snapshot(s.root), before); assert.equal(calls.length, n);
    current = s; assert.equal((await F.API.dispatchOpenAiUiReviewRun(old, old.requestDigest, key)).ok, true);
    await rejects(() => get(s), 'observation_policy_missing');
    const snapshot = F.snapshot(s.root);
    assert.equal((await F.API.retrieveOpenAiUiReviewReceipt(s.root, F.encode(s.run), F.encode(s.input), F.encode(config.profile), key)).state, 'receipt-observed');
    assert.deepEqual(F.snapshot(s.root), snapshot);
    const t = await ready(), snap = F.snapshot(t.root), count = calls.length, git = require('../lib/git'), io = require('../lib/io');
    git.setGitDryRun(true);
    try { await rejects(() => get(t), 'E_DRY_RUN_WRITE'); } finally { git.setGitDryRun(false); }
    io.setDryRunGuard(true);
    try { await rejects(() => get(t), 'E_DRY_RUN_WRITE'); } finally { io.setDryRunGuard(false); }
    assert.equal(calls.length, count); assert.deepEqual(F.snapshot(t.root), snap);
    fs.mkdirSync(path.join(t.root, '.git/leerness')); fs.writeFileSync(path.join(t.root, '.git/leerness/layout.json'), '{"schemaVersion":999}');
    const future = F.snapshot(t.root);
    await rejects(() => get(t), 'E_RUNTIME_LAYOUT_INCOMPATIBLE'); assert.equal(calls.length, count); assert.deepEqual(F.snapshot(t.root), future);
  }, true);
  await test('actual POST GET stores one canonical record and fresh recovery reuses its ID without network or writes', async () => {
    const s = await ready(), before = F.snapshot(s.root), n = calls.length, saved = await get(s), ctx = target(s);
    assert.equal(saved.state, 'receipt-observed'); assert.equal(calls.length, n + 1); assert.equal(calls.at(-1).method, 'GET');
    assert.match(saved.observationId, /^[0-9a-f-]{36}$/); assert.equal(saved.provenance, 'local-journal-of-bound-get');
    const journal = J.read(ctx, s.run.runId), record = G.readCommit(ctx, saved.recordHead);
    assert.equal(journal.intent.value.schema, J.OBSERVATION_SCHEMA); assert.deepEqual(record.parents, [journal.locator.head]);
    assert.equal(saved.recordHead, G.readRef(ctx)); assert.equal(saved.recordDigest, R.sha(record.bytes));
    const stored = K.decode(record.bytes, ctx, journal).value;
    assert.equal(stored.observationId, saved.observationId); assert.equal(stored.response.output[0].content[0].text, saved.receiptJson);
    for (const flag of ['ledgerLinked', 'runRecordRestored', 'approvalGranted', 'semanticVerified', 'actorIdentityVerified', 'retryAllowed']) assert.equal(saved[flag], false);
    const after = F.snapshot(s.root);
    for (const file of Object.keys(before).filter(p => !p.startsWith('.git' + path.sep))) assert.deepEqual(after[file], before[file], file);
    assert.deepEqual(after[path.join('.git', 'index')], before[path.join('.git', 'index')]);
    const child = await fresh(s); assert.equal(child.ok, true, JSON.stringify(child)); assert.deepEqual(child.value, saved);
    assert.deepEqual(await get(s), saved); assert.deepEqual(recover(s), saved);
    assert.equal(calls.length, n + 1); assert.deepEqual(F.snapshot(s.root), after);
    assert.equal(G.readRef({ ...ctx, ref: A.runRef(ctx, s.run.runId) }), null); assert.equal(G.readRef(E.context(ctx, s.run.runId)), null);
  }, true, true);
  await test('unresolved GET creates no record; valid missing coverage is stored as incomplete', async () => {
    const s = await ready(), ctx = target(s);
    for (const [edit, reason] of [
      [v => { v.status = 'incomplete'; }, 'receipt_response_incomplete'],
      [v => { v.output[0].content[0] = { type: 'refusal', refusal: 'private' }; }, 'receipt_refused'],
      [v => { const r = rc(s); r.attemptId = 'other'; v.output[0].content[0].text = F.encode(r); }, 'receipt_binding_mismatch'],
    ]) { editResponse = edit; assert.equal((await get(s)).reasonCode, reason); assert.equal(G.readRef(ctx), null); }
    editResponse = v => { const r = rc(s); r.coverage.pop(); v.output[0].content[0].text = F.encode(r); };
    const saved = await get(s); assert.equal(saved.assessment.state, 'incomplete'); assert.deepEqual(recover(s), saved);
  });
  await test('wrong owner profile input and material replacement cannot publish an observation', async () => {
    const s = await ready(), n = calls.length;
    await rejects(() => get(s, s.input, { ...s.run, owner: { ...s.run.owner, token: 'a'.repeat(64) } }), 'dispatch_run_mismatch');
    await rejects(() => get(s, s.input, s.run, { ...config.profile, profileRevision: 'v2' }), 'dispatch_profile_mismatch');
    const input = RF.clone(s.input); input.uiMaterials[0].specDigest = RF.hash('e');
    await rejects(() => get(s, input), 'snapshot_mismatch'); assert.equal(calls.length, n);
    onGet = () => { const file = path.join(s.root, 'source.bin'); fs.renameSync(file, file + '.old'); fs.writeFileSync(file, F.materialBytes.source); };
    await rejects(() => get(s), 'recovery_materials_changed'); assert.equal(G.readRef(target(s)), null); assert.equal(calls.length, n + 1);
  });
  await test('fresh recovery permits later append but rejects rewriting the GET-time extension to the original prefix', async () => {
    const s = await ready(); onGet = () => append(s);
    const saved = await get(s); assert.ok(saved.ledger.afterBytes > saved.ledger.beforeBytes);
    append(s); const n = calls.length, result = await fresh(s); assert.equal(result.ok, true); assert.deepEqual(result.value, saved);
    const file = executionLedgerPath(s.root), text = fs.readFileSync(file, 'utf8'); assert.ok(text.includes('extra-'));
    fs.writeFileSync(file, text.replace('extra-', 'other-'));
    const failed = await fresh(s); assert.equal(failed.ok, false); assert.equal(calls.length, n);
    assert.equal(G.readRef(target(s)), saved.recordHead);
  }, true);
  await test('process death on each side of CAS is recovered from actual refs without repeating POST', async () => {
    for (const phase of ['before-observation', 'after-observation']) {
      const s = await ready(), n = posts(), gets = calls.length;
      assert.equal(await fresh(s, phase, child => child.kill()), null);
      const result = await fresh(s); assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(calls.length, gets + 1); assert.equal(posts(), n);
      if (phase === 'before-observation') {
        assert.equal(result.value, null); const saved = await get(s); assert.ok(saved.recordHead); assert.equal(calls.length, gets + 2);
      } else { assert.ok(result.value.observationId); assert.deepEqual(await get(s), result.value); assert.equal(calls.length, gets + 1); }
      assert.equal(posts(), n);
    }
  });
  await test('lost CAS acknowledgement reports uncertainty and recovers the already published record without GET', async () => {
    const s = await ready(), original = G.run; let published = null;
    G.run = (...args) => { const result = original(...args); if (String(args[2]).includes('create refs/leerness/provider-observations/')) {
      assert.equal(result.status, 0); published = String(args[2]).match(/create refs\/leerness\/provider-observations\/\S+ ([0-9a-f]+)/)[1]; return { ...result, status: 1 }; } return result; };
    try { await rejects(() => get(s), 'publication_uncertain'); } finally { G.run = original; }
    assert.ok(published); const n = calls.length, result = await fresh(s); assert.equal(result.ok, true); assert.equal(result.value.recordHead, published);
    assert.deepEqual(await get(s), result.value); assert.equal(calls.length, n);
  });
  await test('two actual GET observers race create-only CAS and preserve the same winning record', async () => {
    const s = await ready(), n = calls.length, gates = [];
    const phase = (child, gate) => { gates.push(gate); if (gates.length === 2) gates.forEach(g => fs.writeFileSync(g, 'go')); };
    const results = await Promise.all([fresh(s, 'before-observation', phase), fresh(s, 'before-observation', phase)]);
    assert.equal(gates.length, 2); assert.equal(calls.length, n + 2);
    assert.equal(results.filter(r => r.ok).length, 1); assert.equal(results.find(r => !r.ok).code, 'publication_uncertain');
    const winner = results.find(r => r.ok).value; assert.deepEqual(recover(s), winner); assert.deepEqual(await get(s), winner); assert.equal(calls.length, n + 2);
  });
  await test('wrong parent and concurrent ref replacement fail recovery instead of returning stale history', async () => {
    const s = await ready(), saved = await get(s), ctx = target(s), n = calls.length;
    const bytes = G.readCommit(ctx, saved.recordHead).bytes, bad = G.prepareCommit(ctx, saved.intentHead, bytes);
    F.cmd(s.root, ['update-ref', ctx.ref, bad, saved.recordHead]); assert.throws(() => recover(s), e => e.code === 'observation_record_invalid');
    F.cmd(s.root, ['update-ref', ctx.ref, saved.recordHead, bad]); const original = G.readRef; let changed = false;
    G.readRef = target => { const head = original(target); if (!changed && target.ref === ctx.ref) { changed = true; F.cmd(s.root, ['update-ref', ctx.ref, bad, saved.recordHead]); } return head; };
    try { assert.throws(() => recover(s), e => e.code === 'observation_changed'); } finally { G.readRef = original; }
    assert.equal(changed, true); assert.equal(calls.length, n);
  });
  await test('competing run or result refuses GET; owner change after CAS reports uncertain retained history', async () => {
    const s = await ready(), ctx = target(s), n = calls.length, head = F.cmd(s.root, ['rev-parse', 'HEAD']);
    for (const ref of [A.runRef(ctx, s.run.runId), E.context(ctx, s.run.runId).ref]) {
      F.cmd(s.root, ['update-ref', ref, head]); await rejects(() => get(s), 'observation_conflict'); F.cmd(s.root, ['update-ref', '-d', ref]);
    }
    assert.equal(calls.length, n); const original = G.run; let changed = false;
    G.run = (...args) => { const result = original(...args); if (!changed && String(args[2]).includes('create refs/leerness/provider-observations/')) {
      assert.equal(result.status, 0); changed = true;
      C.writeReviewControl(s.root, F.encode({ ...s.common, operation: 'release', operationId: 'release', expectedHead: s.control.head, generation: s.control.generation, snapshot: null }));
    } return result; };
    try { await rejects(() => get(s), 'publication_uncertain'); } finally { G.run = original; }
    assert.equal(changed, true); assert.ok(G.readRef(ctx)); assert.throws(() => recover(s)); assert.equal(calls.length, n + 1);
  });
  await test('bounded HTTP response that exceeds canonical journal size creates no Git objects or ref', async () => {
    const s = await ready(), before = F.snapshot(s.root);
    editResponse = v => { v.output[0].padding = ''; v.output[0].padding = 'x'.repeat(65520 - Buffer.byteLength(JSON.stringify(v))); };
    await rejects(() => get(s), 'observation_record_limit'); assert.equal(G.readRef(target(s)), null); assert.deepEqual(F.snapshot(s.root), before);
  });
  await test('HTTP-valid deep metadata is rejected before publishing an unreadable journal', async () => {
    const s = await ready(), before = F.snapshot(s.root), n = calls.length;
    editResponse = v => { let nested = 'leaf'; for (let i = 0; i < 13; i++) nested = { nested };
      v.output[0].extra = nested;
      require('../lib/openai-response-http').projection(Buffer.from(JSON.stringify(v)));
    };
    await rejects(() => get(s), 'observation_record_invalid'); assert.equal(calls.length, n + 1);
    assert.equal(G.readRef(target(s)), null); assert.deepEqual(F.snapshot(s.root), before);
  }, true, false, true);
  await test('when only the observation ref is past the Windows path limit, its publication is refused with git_long_paths_required and a later GET publishes it once long paths are on', async () => {
    // T-0326: with a 79-character Git directory path the observation ref (provider-observations, the longest family)
    // has a 261-character lock path and every other ref of the run at most 259. Git for Windows without core.longpaths
    // cannot lock it, so the check refuses the publication before Git runs, and the catch that turns publication errors
    // into publication_uncertain keeps that code. Lengths are taken from the real path. Host Git configuration is off.
    // Other platforms have no such limit and run the same flow without placing the project.
    const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM, GIT_DEFAULT_REF_FORMAT: process.env.GIT_DEFAULT_REF_FORMAT };
    const empty = path.join(arena, 'empty.gitconfig'); fs.writeFileSync(empty, '');
    process.env.GIT_CONFIG_GLOBAL = empty; process.env.GIT_CONFIG_NOSYSTEM = '1'; process.env.GIT_DEFAULT_REF_FORMAT = 'files';
    try {
      const base = fs.realpathSync.native(arena), windows = process.platform === 'win32', pad = 74 - base.length - 5;
      assert.ok(pad >= 0 || !windows, `the test folder (${base.length} characters) is too deep to place a 74-character project`);
      const root = path.join(base, 'band' + 'x'.repeat(Math.max(0, pad)));
      const s = F.setup(root, { ledger: true }); await dispatch(s);
      const ctx = target(s), n = posts();
      if (windows) assert.equal(path.join(root, '.git', ctx.ref + '.lock').length, 261);
      if (windows) {
        await rejects(() => get(s), 'git_long_paths_required'); assert.equal(G.readRef(ctx), null);
        F.cmd(root, ['config', 'core.longpaths', 'true']);
      }
      const observed = await get(s); assert.equal(observed.state, 'receipt-observed'); assert.equal(G.readRef(ctx), observed.recordHead);
      assert.equal(posts(), n);
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
  assert.deepEqual(network.errors, []); assert.deepEqual(serverErrors, [], 'fixture errors cannot count as product rejection');
  console.log(`UI provider observation: ${passed}/${total} PASS; actual Git, processes and loopback TLS; no provider calls`);
  if (passed !== total) process.exitCode = 1;
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(async () => {
  for (const child of children) child.kill(); network?.restore();
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  const resolved = fs.realpathSync(arena); assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('lr-observation-'));
  removeTree(resolved, { recursive: true, force: true });
});
