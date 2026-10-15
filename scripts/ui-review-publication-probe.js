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
const RF = require('./ui-review-fixture');
const P = require('../lib/openai-ui-review-publication');
const U = require('../lib/ui-review-run');
const G = require('../lib/review-control-git');
const E = require('../lib/ui-review-result');
const C = require('../lib/review-control');
const CC = require('../lib/review-control-contract');
const R = require('../lib/ui-review-run-contract');
const L = require('../lib/role-fallback');
const B = require('../lib/ui-review-recovery-bundle');
const D = require('../lib/ui-review-provider-receipt');
const K = require('../lib/openai-ui-review-observation-record');
const { removeTree } = require('./temp-cleanup');
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === '--smoke') && !(args.length === 2 && args[0] === '--filter' && args[1].trim())) throw Error('invalid_probe_arguments');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-publication-')), children = new Set();
const config = { ...F.config, store: true, timeoutMs: 15000 }, key = 'fixture-' + randomUUID();
const recovery = { schema: B.POLICY, materials: 'local-git-until-explicit-removal', ledger: 'identity-and-prefix-digest', reviewAttemptId: 'review-1' };
const receiptPolicy = { schema: D.POLICY, modelMatch: 'exact' }, observationPolicy = { schema: K.POLICY, retention: 'local-git-until-explicit-removal' };
let sequence = 0, calls = 0, passed = 0, total = 0, current, edit, server, network, pair;
const encode = JSON.stringify, file = s => L.executionLedgerPath(s.root);
const events = s => { const h = L.readExecutionEvents(s.root, 2000, { preserveAll: true }); assert.equal(h.ok, true); return h.events; };
const terminals = s => events(s).filter(e => e.event === 'review.completed');
const ctx = s => G.context(s.root, s.run.batchId);
const resultHead = s => G.readRef(E.context(ctx(s), s.run.runId));
const policy = s => ({ schema: P.POLICY, observationHead: s.observed.recordHead, reviewOfAttemptId: 'implementation-1', retention: 'local-git-until-explicit-removal' });
const prepare = (s, p = policy(s)) => P.prepareOpenAiUiReviewPublication(s.root, encode(s.run), encode(s.input), encode(config.profile), encode(p));
const publish = s => { const h = prepare(s); return P.publishOpenAiUiReviewResult(h, h.publicationDigest); };
const reject = (fn, code) => assert.throws(fn, e => !code || e.code === code, code);
function extra(s) { L.appendExecutionEvent(s.root, { event: 'dispatch.prepared', eventId: 'extra-' + sequence++, taskId: 'T-ui', attemptId: 'extra-' + sequence++, executed: false }); }
async function ready(change, beforeObservation) {
  const s = F.setup(path.join(arena, 'c' + sequence++), { ledger: true });
  if (change) change(s);
  current = s; edit = s.edit || null;
  const h = F.API.prepareOpenAiUiReviewDispatch(s.root, encode(s.run), encode(s.request), encode(s.input), encode(config), encode(recovery), encode(receiptPolicy), encode(observationPolicy));
  assert.equal((await F.API.dispatchOpenAiUiReviewRun(h, h.requestDigest, key)).ok, true);
  if (beforeObservation) beforeObservation(s);
  s.observed = await F.API.observeOpenAiUiReviewReceipt(s.root, encode(s.run), encode(s.input), encode(config.profile), key);
  assert.ok(s.observed.recordHead, s.observed.reasonCode || s.observed.state); return s;
}
function fresh(s, mode = 'publish', onPhase) {
  return new Promise((resolve, rejectPromise) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|TEMP|TMP|LOCALAPPDATA|USERPROFILE)$/i.test(k)));
    const child = fork(path.join(__dirname, 'ui-review-publication-worker.js'), [], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    children.add(child); const gate = path.join(arena, 'gate-' + randomUUID()); let output, stderr = '', reached = false;
    const timer = setTimeout(() => child.kill(), 300000);
    child.stderr.on('data', b => { stderr += b; }); child.on('error', rejectPromise);
    child.on('message', m => {
      if (m.ready) child.send({ s, profile: config.profile, policy: policy(s), mode, gate });
      if (m.phase) { reached = true; onPhase?.(child, gate, m.phase); }
      if (m.result) output = m;
    });
    child.on('exit', code => {
      clearTimeout(timer); children.delete(child);
      try {
        if (!output && reached) return resolve({ killedPid: child.pid });
        assert.equal(code, 0, stderr); assert.ok(output, stderr); assert.equal(output.networkCalls, 0);
        resolve(output.result);
      } catch (e) { rejectPromise(e); }
    });
  });
}
async function test(name, fn, smoke = false) {
  if (args[0] === '--smoke' && !smoke) return;
  if (args[0] === '--filter' && !name.includes(args[1])) return;
  total++; const before = calls, started = Date.now(); console.log('RUN ' + name);
  try { await fn(); passed++; console.log('PASS ' + name + ` (${calls - before} fixture HTTP calls; ${((Date.now() - started) / 1000).toFixed(1)}s)`); }
  catch (e) { console.error('FAIL ' + name + ': ' + e.stack); }
}
async function main() {
  pair = F.certificate(arena);
  server = https.createServer(pair, (req, res) => {
    req.resume(); req.on('end', () => {
      calls++; const receipt = RF.receipt(current.input);
      receipt.reviewer = { provider: config.provider, model: config.model, sessionId: null };
      if (edit) edit(receipt);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(encode({ object: 'response', id: 'resp_fixture', status: req.method === 'POST' ? 'queued' : 'completed',
        model: config.model, created_at: 1741386163, output: req.method === 'POST' ? [] : [{ id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: encode(receipt), annotations: [] }] }] }));
    });
  });
  server.on('tlsClientError', () => {});
  await new Promise(r => server.listen(0, '127.0.0.1', r)); network = F.bridge(server.address().port, pair.cert);
  await test('preview is read-only; approved publication, later appends and fresh RunRecord retention reuse one event', async () => {
    const s = await ready(), before = F.snapshot(s.root), h = prepare(s), n = calls;
    assert.deepEqual(F.snapshot(s.root), before); assert.equal(h.terminalPresent, false);
    reject(() => P.publishOpenAiUiReviewResult({ ...h }, h.publicationDigest), 'publication_handle_invalid');
    reject(() => P.publishOpenAiUiReviewResult(h, R.sha('wrong')), 'publication_approval_mismatch');
    assert.deepEqual(F.snapshot(s.root), before);
    const out = P.publishOpenAiUiReviewResult(h, h.publicationDigest), event = terminals(s)[0], bytes = fs.readFileSync(file(s));
    assert.equal(out.ledgerLinked, true); assert.equal(out.observationId, s.observed.observationId); assert.equal(terminals(s).length, 1);
    for (const k of ['approvalGranted', 'actorIdentityVerified', 'semanticVerified', 'executionBindingVerified']) assert.equal(out[k], false);
    const repeat = () => P.publishOpenAiUiReviewResult(h, h.publicationDigest);
    assert.equal(repeat().recordDigest, out.recordDigest); assert.deepEqual(fs.readFileSync(file(s)), bytes);
    extra(s); assert.equal(repeat().recordDigest, out.recordDigest); assert.deepEqual(terminals(s), [event]);
    const recovered = await fresh(s, 'recover-run'); assert.equal(recovered.ok, true, encode(recovered));
    assert.equal(recovered.value.recordDigest, out.recordDigest); assert.equal(recovered.value.record.observationId, s.observed.observationId);
    assert.equal(repeat().runRecordRetained, true); assert.equal(calls, n);
  }, true);
  await test('explicit parent chooses the requested contributor and rejects omitted or unrelated parent', async () => {
    const s = await ready(s => {
      const second = structuredClone(s.input.contributors[0]); second.attemptId = 'implementation-2'; s.input.contributors.push(second);
      const original = events(s).find(e => e.eventId === 'impl-event');
      L.appendExecutionEvent(s.root, { ...original, eventId: 'impl-event-2', attemptId: second.attemptId });
    });
    reject(() => prepare(s, { ...policy(s), reviewOfAttemptId: 'unknown' }), 'review_parent_mismatch');
    const missing = policy(s); delete missing.reviewOfAttemptId; reject(() => prepare(s, missing));
    const h = prepare(s, { ...policy(s), reviewOfAttemptId: 'implementation-2' });
    P.publishOpenAiUiReviewResult(h, h.publicationDigest); assert.equal(terminals(s)[0].parentAttemptId, 'implementation-2');
    reject(() => publish(s), 'review_terminal_conflict');
  });
  await test('partial and failed receipts cannot create a completed terminal', async () => {
    for (const execution of ['partial', 'failed']) {
      const s = await ready(s => { s.edit = r => { r.execution = execution; }; }), before = fs.readFileSync(file(s)), n = calls;
      reject(() => prepare(s), 'review_not_completed'); assert.deepEqual(fs.readFileSync(file(s)), before); assert.equal(resultHead(s), null); assert.equal(calls, n);
    }
  }, true);
  await test('unrepresentable evidence references fail before appending a terminal', async () => {
    const s = await ready(s => {
      const lines = fs.readFileSync(file(s), 'utf8').trimEnd().split('\n').map(JSON.parse);
      lines[1].eventId = 'sk-' + 'a'.repeat(40);
      fs.writeFileSync(file(s), lines.map(encode).join('\n') + '\n');
    });
    const before = fs.readFileSync(file(s)), n = calls;
    reject(() => prepare(s), 'review_evidence_unbound');
    assert.deepEqual(fs.readFileSync(file(s)), before); assert.equal(resultHead(s), null); assert.equal(calls, n);
  });
  await test('completed findings and inconclusive coverage remain evidence without approval', async () => {
    const s = await ready(s => { s.edit = r => {
      r.coverage[0].outcome = 'inconclusive';
      r.review.findings.push({ category: 'instruction_to_ui_leakage', subtype: 'DEVELOPER_NOTE', sourceKind: 'developer_note',
        severity: 'advisory', disposition: 'review-remediation', evidenceDigest: s.input.uiMaterials[0].specDigest });
      const cell = r.coverage.find(c => c.subtype === 'DEVELOPER_NOTE'); cell.outcome = 'finding'; cell.findingIndexes = [0];
    }; });
    const h = prepare(s), out = P.publishOpenAiUiReviewResult(h, h.publicationDigest);
    assert.equal(out.approvalGranted, false); assert.equal(terminals(s).length, 1);
    assert.equal(R.parse(G.readCommit(ctx(s), resultHead(s)).bytes).receiptJson, s.observed.receiptJson);
  });
  await test('changed observation head, owner and source bytes fail before terminal writes', async () => {
    for (const kind of ['head', 'owner', 'material']) {
      const s = await ready(), h = prepare(s), bytes = fs.readFileSync(file(s)), n = calls;
      if (kind === 'head') {
        const target = { ...ctx(s), ref: `refs/leerness/provider-observations/v1/${ctx(s).projectKey}/${CC.digest(s.run.runId).slice(7)}` };
        F.cmd(s.root, ['update-ref', target.ref, s.observed.locatorHead, s.observed.recordHead]);
      } else if (kind === 'owner') C.writeReviewControl(s.root, encode({ ...s.common, operation: 'release', operationId: 'release', expectedHead: s.control.head, generation: s.control.generation, snapshot: null }));
      else fs.appendFileSync(path.join(s.root, 'source.bin'), 'changed');
      reject(() => P.publishOpenAiUiReviewResult(h, h.publicationDigest));
      assert.deepEqual(fs.readFileSync(file(s)), bytes); assert.equal(resultHead(s), null); assert.equal(calls, n);
    }
  });
  await test('the complete GET-time prefix is still binding during publication', async () => {
    const s = await ready(undefined, extra), h = prepare(s), text = fs.readFileSync(file(s), 'utf8');
    fs.writeFileSync(file(s), text.replace(/extra-/g, 'other-')); const changed = fs.readFileSync(file(s)), n = calls;
    reject(() => P.publishOpenAiUiReviewResult(h, h.publicationDigest));
    assert.deepEqual(fs.readFileSync(file(s)), changed); assert.equal(resultHead(s), null); assert.equal(calls, n);
  });
  await test('other terminal IDs and changed event content are conflicts, including after result publication', async () => {
    const a = await ready(), rc = R.parse(a.observed.receiptJson);
    F.terminal(a, { packet: { packetId: a.observed.packetId }, selectionDigest: a.observed.selectionDigest, implementationEventIds: a.observed.ledger.implementationEventIds }, rc);
    const bytes = fs.readFileSync(file(a)); reject(() => publish(a), 'review_terminal_conflict'); assert.deepEqual(fs.readFileSync(file(a)), bytes);
    const b = await ready(); publish(b);
    const lines = fs.readFileSync(file(b), 'utf8').trimEnd().split('\n').map(JSON.parse);
    lines.at(-1).reviewerIndependent = true; fs.writeFileSync(file(b), lines.map(encode).join('\n') + '\n');
    const modified = fs.readFileSync(file(b)); reject(() => publish(b), 'review_terminal_conflict'); assert.deepEqual(fs.readFileSync(file(b)), modified);
  }, true);
  await test('a conflicting canonical result cannot overwrite or duplicate a terminal', async () => {
    const s = await ready(); publish(s); const c = ctx(s), old = resultHead(s), original = G.readCommit(c, old);
    const value = R.parse(original.bytes); value.observationId = randomUUID();
    const head = G.prepareCommit(c, original.parents[0], R.encode(value)); F.cmd(s.root, ['update-ref', E.context(c, s.run.runId).ref, head, old]);
    const bytes = fs.readFileSync(file(s)); reject(() => prepare(s), 'result_conflict'); assert.deepEqual(fs.readFileSync(file(s)), bytes); assert.equal(resultHead(s), head);
  });
  await test('lost append and result acknowledgements reconcile the existing event and original timestamp', async () => {
    for (const boundary of ['append', 'result']) {
      const s = await ready(), h = prepare(s), append = L.appendExecutionEvent, run = G.run; let reached = false;
      if (boundary === 'append') L.appendExecutionEvent = (...a) => { const out = append(...a); reached = true; throw Object.assign(Error('lost_ack'), { code: 'EIO', out }); };
      else G.run = (...a) => { const out = run(...a); if (String(a[2]).includes('create refs/leerness/review-results/')) { assert.equal(out.status, 0); reached = true; return { ...out, status: 1 }; } return out; };
      try { reject(() => P.publishOpenAiUiReviewResult(h, h.publicationDigest)); } finally { L.appendExecutionEvent = append; G.run = run; }
      assert.equal(reached, true); assert.equal(terminals(s).length, 1); const original = terminals(s)[0], n = calls;
      const out = publish(s); assert.ok(out.resultHead); assert.deepEqual(terminals(s), [original]); assert.equal(calls, n);
    }
  }, true);
  await test('file synchronization failure is not success and recovery resynchronizes without appending', async () => {
    const s = await ready(), h = prepare(s), originalOpen = fs.openSync, originalSync = fs.fsyncSync, originalClose = fs.closeSync;
    const fds = new Set(); let syncs = 0, fail = true;
    fs.openSync = function(p, flags, ...rest) { const fd = originalOpen.call(fs, p, flags, ...rest); if (String(p) === file(s) && (flags === 'a' || (typeof flags === 'number' && (flags & fs.constants.O_APPEND)))) fds.add(fd); return fd; };
    fs.fsyncSync = function(fd) { if (fds.has(fd)) { syncs++; if (fail) throw Object.assign(Error('injected_sync_failure'), { code: 'EIO' }); } return originalSync.call(fs, fd); };
    fs.closeSync = function(fd) { fds.delete(fd); return originalClose.call(fs, fd); };
    try {
      reject(() => P.publishOpenAiUiReviewResult(h, h.publicationDigest), 'ledger_sync_failed'); assert.equal(resultHead(s), null);
      const bytes = fs.readFileSync(file(s)); fail = false; const out = publish(s);
      assert.ok(out.resultHead); assert.deepEqual(fs.readFileSync(file(s)), bytes); assert.ok(syncs >= 2);
    } finally { fs.openSync = originalOpen; fs.fsyncSync = originalSync; fs.closeSync = originalClose; }
  });
  await test('event limit rejects before append and does not poison a readable ledger', async () => {
    const s = await ready(), lines = [];
    for (let i = 0; i < 1998; i++) lines.push(encode({ schemaVersion: 1, at: new Date().toISOString(), event: 'dispatch.prepared', eventId: 'limit-' + i, taskId: 'T-ui', attemptId: 'limit-' + i, executed: false }));
    fs.appendFileSync(file(s), lines.join('\n') + '\n'); assert.equal(events(s).length, 2000);
    const bytes = fs.readFileSync(file(s)); reject(() => prepare(s), 'ledger_event_limit'); assert.deepEqual(fs.readFileSync(file(s)), bytes); assert.equal(resultHead(s), null);
  });
  await test('file dry-run, Git dry-run and runtime incompatibility do not create lock metadata or records', async () => {
    for (const kind of ['file', 'git', 'runtime']) {
      const s = await ready(), h = prepare(s), io = require('../lib/io'), git = require('../lib/git');
      if (kind === 'runtime') { fs.mkdirSync(path.join(s.root, '.leerness/cache'), { recursive: true }); fs.writeFileSync(path.join(s.root, '.leerness/cache/state-layout.json'), '{"schemaVersion":999}'); }
      const snap = F.snapshot(s.root), n = calls;
      if (kind === 'file') io.setDryRunGuard(true); if (kind === 'git') git.setGitDryRun(true);
      try { reject(() => P.publishOpenAiUiReviewResult(h, h.publicationDigest), kind === 'runtime' ? 'E_RUNTIME_LAYOUT_INCOMPATIBLE' : 'E_DRY_RUN_WRITE'); }
      finally { io.setDryRunGuard(false); git.setGitDryRun(false); }
      assert.deepEqual(F.snapshot(s.root), snap); assert.equal(calls, n);
    }
  });
  await test('control changes at the Git result CAS preserve the event but do not publish a result', async () => {
    const s = await ready(), h = prepare(s), original = G.run; let changed = false;
    G.run = (...a) => { if (!changed && String(a[2]).includes('create refs/leerness/review-results/')) {
      changed = true; C.writeReviewControl(s.root, encode({ ...s.common, operation: 'release', operationId: 'release', expectedHead: s.control.head, generation: s.control.generation, snapshot: null }));
    } return original(...a); };
    try { reject(() => P.publishOpenAiUiReviewResult(h, h.publicationDigest), 'publication_uncertain'); } finally { G.run = original; }
    assert.equal(changed, true); assert.equal(terminals(s).length, 1); assert.equal(resultHead(s), null);
  });
  await test('two actual processes serialize publication; an explicit contention retry reuses the winner without HTTP', async () => {
    const s = await ready(), gates = [], n = calls;
    const phase = (child, gate) => { gates.push(gate); if (gates.length === 2) gates.forEach(g => fs.writeFileSync(g, 'go')); };
    const out = await Promise.all([fresh(s, 'before-publish', phase), fresh(s, 'before-publish', phase)]);
    assert.ok(out.some(r => r.ok), encode(out));
    for (let i = 0; i < out.length; i++) if (!out[i].ok) {
      assert.ok(['E_LOCK_BUSY', 'E_LOCK_TIMEOUT'].includes(out[i].code), encode(out[i]));
      out[i] = await fresh(s); assert.equal(out[i].ok, true, encode(out[i]));
    }
    assert.equal(out[0].value.resultHead, out[1].value.resultHead);
    assert.equal(out[0].value.recordDigest, out[1].value.recordDigest); assert.equal(terminals(s).length, 1); assert.equal(calls, n);
  });
  await test('process interruption preserves uncertain state; fixture operator recovery never repeats HTTP or terminal', async () => {
    for (const phase of ['before-terminal', 'after-terminal', 'before-result', 'after-result']) {
      const s = await ready(), n = calls, killed = await fresh(s, phase, child => child.kill()); assert.ok(killed.killedPid);
      const lock = file(s) + '.lock', resolved = fs.realpathSync(lock);
      assert.equal(resolved, lock); assert.equal(path.dirname(lock), path.join(s.root, '.leerness'));
      assert.ok(path.relative(arena, lock) && !path.relative(arena, lock).startsWith('..'));
      const names = fs.readdirSync(lock); assert.equal(names.length, 1);
      const owner = JSON.parse(fs.readFileSync(path.join(lock, names[0]), 'utf8')); assert.equal(owner.pid, killed.killedPid);
      const h = prepare(s); assert.equal(h.terminalPresent, phase !== 'before-terminal');
      const original = terminals(s)[0] || null;
      // The child exit was observed above. This is an explicit fixture operator
      // action, not product auto-takeover. Preserve actual ledger/Git bytes.
      removeTree(lock, { recursive: true, force: true });
      const out = await fresh(s); assert.equal(out.ok, true, encode(out)); assert.equal(terminals(s).length, 1);
      if (original) assert.deepEqual(terminals(s)[0], original); assert.equal(calls, n);
    }
  });
  assert.deepEqual(network.errors, []); assert.ok(total > 0, 'zero matching tests is a failure');
  console.log(`Tests: ${passed} passed, ${total - passed} failed, ${total} total`);
  if (passed !== total) process.exitCode = 1;
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; }).finally(async () => {
  for (const child of children) child.kill(); network?.restore();
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  const resolved = fs.realpathSync(arena); assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('lr-publication-'));
  for (let attempt = 0; ; attempt++) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); break; }
    catch (error) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
});
