'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fixture, receipt, clone, encode, identity, packet, hash } = require('./ui-review-fixture');
const { runUiReviewWithLedger: run, MAX_LEDGER_BYTES } = require('../lib/ui-review-ledger');
const { appendExecutionEvent, executionLedgerPath } = require('../lib/role-fallback');
const { INPUT_SCHEMA: OBS_INPUT, KINDS } = require('../lib/ui-review-observation');
const sha = b => 'sha256:' + crypto.createHash('sha256').update(b).digest('hex');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-uib04c-'));
let counter = 0;
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
function sample(count = 1, size = null) {
  const root = path.join(temp, 'case-' + counter++); fs.mkdirSync(root);
  const input = fixture(), files = [];
  input.snapshot.checkpoint.tasks = [];
  input.uiMaterials = [];
  input.contributors[0].taskIds = [];
  for (let i = 0; i < count; i++) {
    const id = 'T-' + i, task = fixture().snapshot.checkpoint.tasks[0]; task.id = id;
    input.snapshot.checkpoint.tasks.push(task); input.contributors[0].taskIds.push(id);
    const row = { taskId: id };
    for (const kind of KINDS) {
      const name = i + '-' + kind + '.bin';
      const bytes = size === null ? Buffer.from('PRIVATE_MARKER: ' + kind + ' 한글\r\n') : Buffer.alloc(size, i + 1);
      fs.writeFileSync(path.join(root, name), bytes); row[kind + 'Digest'] = sha(bytes);
      files.push({ taskId: id, kind, path: name });
    }
    input.uiMaterials.push(row);
  }
  return { root, input, files, request: () => encode({ schema: OBS_INPUT, input, files }) };
}
function seed(count = 1) {
  const s = sample(); fs.mkdirSync(path.join(s.root, '.leerness'));
  s.impl = []; s.starts = []; s.input.contributors = [];
  for (let i = 0; i < count; i++) {
    const executor = { ...identity(), identitySource: 'user-declared' }, attemptId = 'implementation-' + i;
    s.input.contributors.push({ attemptId, taskIds: ['T-0'], executor: identity() });
    const start = appendExecutionEvent(s.root, { event: 'dispatch.prepared', eventId: 'start-event-' + i,
      taskId: 'T-0', attemptId: 'start-' + i, requestedRole: 'implementer', requestedExecutor: executor, executed: false }).event;
    const impl = appendExecutionEvent(s.root, { event: 'execution.completed', eventId: 'impl-event-' + i,
      taskId: 'T-0', attemptId, parentAttemptId: start.attemptId, requestedRole: 'implementer', actualExecutor: executor,
      evidenceRefs: [s.input.uiMaterials[0].sourceDigest, s.input.uiMaterials[0].diffDigest],
      result: { summary: 'PRIVATE_MARKER: declared implementation' }, executed: true }).event;
    s.starts.push(start); s.impl.push(impl);
  }
  return s;
}
function ledger(s) { return executionLedgerPath(s.root); }
function editLedger(s, edit) {
  const events = fs.readFileSync(ledger(s), 'utf8').trim().split('\n').map(JSON.parse);
  edit(events); fs.writeFileSync(ledger(s), events.map(encode).join('\n') + '\n');
}
function terminal(s, supplied, rc, edit = () => {}) {
  const event = { event: 'review.completed', eventId: 'review-event', taskId: 'T-0', attemptId: rc.attemptId,
    parentAttemptId: s.impl[0].attemptId, reviewOfAttemptId: s.impl[0].attemptId, requestedRole: 'reviewer',
    actualExecutor: { ...rc.reviewer, identitySource: 'user-declared' }, executed: true,
    evidenceRefs: [supplied.packet.packetId, supplied.selectionDigest, sha(Buffer.from(encode(rc))), ...supplied.implementationEventIds],
    review: { uiBoundary: rc.review }, result: { summary: 'PRIVATE_MARKER: declared review' } };
  edit(event); appendExecutionEvent(s.root, event);
}
function observe(s, fn) {
  return run(s.root, s.request(), encode(s.input), supplied => {
    const rc = receipt(s.input);
    if (fn) return fn(supplied, rc);
    terminal(s, supplied, rc); return encode(rc);
  });
}
function safe(r) {
  assert.equal(r.actorIdentityVerified, false); assert.equal(r.semanticVerified, false); assert.equal(r.independentReview, 'not-verified');
  assert.equal(r.approvalGranted, false); assert.equal(r.approvalReusable, false);
  assert.equal(r.trust, 'local-ledger-declarations'); assert.ok(Object.isFrozen(r));
  assert.ok(!encode(r).includes('PRIVATE_MARKER')); assert.ok(!encode(r).includes(temp));
}
test('real append/read/callback records link to exact observed bytes', async () => {
  const s = seed(), before = fs.readFileSync(ledger(s));
  const r = await observe(s); assert.equal(r.state, 'ledger-linked'); assert.equal(r.reasonCode, null);
  assert.equal(r.observation.state, 'observed-review'); assert.equal(r.observation.assessment.state, 'review-candidate');
  assert.notEqual(r.ledger.beforeDigest, r.ledger.afterDigest); assert.equal(r.ledger.reviewEventId, 'review-event');
  assert.ok(fs.readFileSync(ledger(s)).subarray(0, before.length).equals(before)); safe(r);
});
test('all declared implementation attempts must be linked', async () => {
  const s = seed(3), r = await observe(s); assert.equal(r.state, 'ledger-linked'); assert.equal(r.ledger.implementationEventIds.length, 3); safe(r);
});
for (const [name, edit, reason] of [
  ['missing implementation', es => es.pop(), 'implementation_ambiguous_or_missing'],
  ['duplicate implementation', es => es.push({ ...es[1], eventId: 'duplicate-terminal' }), 'implementation_ambiguous_or_missing'],
  ['failed implementation', es => { es[1].event = 'execution.failed'; }, 'implementation_not_completed'],
  ['wrong task', es => { es[1].taskId = 'T-foreign'; }, 'implementation_not_completed'],
  ['provider mismatch', es => { es[1].actualExecutor.provider = 'provider-c'; }, 'implementation_identity_mismatch'],
  ['model mismatch', es => { es[1].actualExecutor.model = 'gpt-unit-v2'; }, 'implementation_identity_mismatch'],
  ['session mismatch', es => { es[1].actualExecutor.sessionId = 'foreign-session'; }, 'implementation_identity_mismatch'],
  ['top-level session mismatch', es => { es[1].sessionId = 'foreign-session'; }, 'implementation_identity_mismatch'],
  ['missing material binding', es => { es[1].evidenceRefs = ['E-unbound']; }, 'implementation_material_unbound'],
  ['missing parent', es => es.shift(), 'implementation_parent_ambiguous_or_missing'],
  ['ambiguous parent', es => es.push({ ...es[0], eventId: 'duplicate-parent' }), 'implementation_parent_ambiguous_or_missing'],
  ['parent task mismatch', es => { es[0].taskId = 'T-foreign'; }, 'implementation_parent_mismatch'],
  ['parent role mismatch', es => { es[0].requestedRole = 'reviewer'; }, 'implementation_parent_mismatch'],
  ['parent model mismatch', es => { es[0].requestedExecutor.model = 'gpt-unit-v2'; }, 'implementation_parent_identity_mismatch'],
  ['parent absent identity', es => { es[0].requestedExecutor = null; }, 'implementation_parent_identity_mismatch'],
  ['wrong event order', es => es.reverse(), 'implementation_order_invalid'],
  ['duplicate event ID', es => { es[1].eventId = es[0].eventId; }, 'ledger_event_id_ambiguous'],
]) test('preflight rejects ' + name, async () => {
  const s = seed(); editLedger(s, edit); let calls = 0;
  const r = await observe(s, () => { calls++; return ''; });
  assert.equal(calls, 0); assert.equal(r.state, 'unlinked'); assert.equal(r.reasonCode, reason); safe(r);
});
for (const [name, edit] of [
  ['source', s => { s.input.uiMaterials[0].sourceDigest = hash('a'); }],
  ['diff', s => { s.input.uiMaterials[0].diffDigest = hash('a'); }],
]) test('capture still refuses mismatching declared ' + name, async () => {
  const s = seed(); edit(s); await assert.rejects(observe(s), /digest_mismatch/);
});
for (const [name, edit, reason] of [
  ['review provider', e => { e.actualExecutor.provider = 'provider-c'; }, 'review_identity_mismatch'],
  ['review model', e => { e.actualExecutor.model = 'claude-unit-v2'; }, 'review_identity_mismatch'],
  ['review session', e => { e.actualExecutor.sessionId = 'foreign-session'; }, 'review_identity_mismatch'],
  ['review top session', e => { e.sessionId = 'foreign-session'; }, 'review_identity_mismatch'],
  ['review task', e => { e.taskId = 'T-foreign'; }, 'review_not_completed'],
  ['review event type', e => { e.event = 'execution.completed'; }, 'review_not_completed'],
  ['review parent', e => { e.parentAttemptId = 'foreign-attempt'; }, 'review_parent_mismatch'],
  ['review target', e => { e.reviewOfAttemptId = 'foreign-attempt'; }, 'review_parent_mismatch'],
  ['packet ref', e => e.evidenceRefs.splice(0, 1), 'review_evidence_unbound'],
  ['selection ref', e => e.evidenceRefs.splice(1, 1), 'review_evidence_unbound'],
  ['receipt ref', e => e.evidenceRefs.splice(2, 1), 'review_evidence_unbound'],
  ['implementation ref', e => e.evidenceRefs.pop(), 'review_evidence_unbound'],
  ['findings absent', e => { delete e.review.uiBoundary; }, 'review_findings_mismatch'],
]) test('postflight rejects wrong ' + name, async () => {
  const s = seed(); const r = await observe(s, (supplied, rc) => { terminal(s, supplied, rc, edit); return encode(rc); });
  assert.equal(r.state, 'unlinked'); assert.equal(r.reasonCode, reason); safe(r);
});
test('missing terminal record does not become provenance', async () => {
  const s = seed(), r = await observe(s, (_p, rc) => encode(rc)); assert.equal(r.reasonCode, 'review_ambiguous_or_missing'); safe(r);
});
test('existing review attempt cannot be replayed', async () => {
  const s = seed(); const a = await observe(s); assert.equal(a.state, 'ledger-linked');
  const r = await observe(s, (_p, rc) => encode(rc)); assert.equal(r.reasonCode, 'review_attempt_reused'); safe(r);
});
test('duplicate review terminals are ambiguous', async () => {
  const s = seed(); const r = await observe(s, (p, rc) => { terminal(s, p, rc); terminal(s, p, rc, e => { e.eventId = 'duplicate-review'; }); return encode(rc); });
  assert.equal(r.reasonCode, 'review_ambiguous_or_missing'); safe(r);
});
test('editing old ledger metadata during callback invalidates history', async () => {
  const s = seed(); const r = await observe(s, (p, rc) => { editLedger(s, es => { es[0].result = { summary: 'changed' }; }); terminal(s, p, rc); return encode(rc); });
  assert.equal(r.reasonCode, 'ledger_history_changed'); safe(r);
});
test('same-content ledger file replacement is rejected', async () => {
  const s = seed(); const r = await observe(s, (_p, rc) => { const f = ledger(s), b = fs.readFileSync(f); fs.renameSync(f, f + '.old'); fs.writeFileSync(f, b); return encode(rc); });
  assert.equal(r.reasonCode, 'ledger_replaced'); safe(r);
});
test('unrelated valid append does not invalidate immutable prefix', async () => {
  const s = seed(); const r = await observe(s, (p, rc) => { appendExecutionEvent(s.root, { event: 'routing.proposed', taskId: 'T-unrelated' }); terminal(s, p, rc); return encode(rc); });
  assert.equal(r.state, 'ledger-linked'); safe(r);
});
test('malformed appended line refuses partial success', async () => {
  const s = seed(); const r = await observe(s, (p, rc) => { terminal(s, p, rc); fs.appendFileSync(ledger(s), 'PRIVATE_MARKER\n'); return encode(rc); });
  assert.equal(r.state, 'unlinked'); assert.equal(r.reasonCode, 'ledger_unavailable'); safe(r);
});
test('source modification still prevents ledger linkage', async () => {
  const s = seed(); const r = await observe(s, (p, rc) => { fs.appendFileSync(path.join(s.root, s.files[0].path), 'changed'); terminal(s, p, rc); return encode(rc); });
  assert.equal(r.observation.state, 'stale'); assert.equal(r.reasonCode, 'ui_observation_not_linkable'); safe(r);
});
test('self-review remains self-review after successful ledger correlation', async () => {
  const s = seed(); const r = await observe(s, (p, rc) => { rc.reviewer = identity(); terminal(s, p, rc); return encode(rc); });
  assert.equal(r.state, 'ledger-linked'); assert.equal(r.observation.assessment.state, 'self-review'); safe(r);
});
test('forged authenticated labels do not authenticate ledger actors', async () => {
  const s = seed(); editLedger(s, es => { es[1].actualExecutor.identitySource = 'provider-attested'; es[1].reviewerIndependent = true; });
  const r = await observe(s, (p, rc) => { terminal(s, p, rc, e => { e.actualExecutor.identitySource = 'provider-attested'; e.reviewerIndependent = true; }); return encode(rc); });
  assert.equal(r.state, 'ledger-linked'); safe(r);
});
test('callback throw is observed and no approval is created', async () => {
  const s = seed(); const r = await observe(s, () => { throw Error('PRIVATE_MARKER'); });
  assert.equal(r.observation.execution.state, 'threw'); assert.equal(r.reasonCode, 'ui_observation_not_linkable'); safe(r);
});
test('multiple tasks are explicitly outside current ledger representation', async () => {
  const s = sample(2); let called = false;
  const r = await observe(s, () => { called = true; return ''; }); assert.equal(r.reasonCode, 'single_task_required'); assert.equal(called, false); safe(r);
});
test('absent ledger never starts callback', async () => {
  const s = seed(); fs.unlinkSync(ledger(s)); const r = await observe(s, () => { throw Error('not reached'); }); assert.equal(r.reasonCode, 'ledger_missing'); safe(r);
});
test('unterminated final line is refused', async () => {
  const s = seed(); fs.writeFileSync(ledger(s), fs.readFileSync(ledger(s)).subarray(0, -1)); const r = await observe(s); assert.equal(r.reasonCode, 'ledger_incomplete_line'); safe(r);
});
test('duplicate JSON keys are refused despite legacy reader last-key semantics', async () => {
  const s = seed(); fs.appendFileSync(ledger(s), '{"event":"x","event":"x"}\n'); const r = await observe(s); assert.equal(r.reasonCode, 'ledger_unavailable'); safe(r);
});
test('over byte budget rejected before record correlation', async () => {
  const s = seed(); fs.appendFileSync(ledger(s), Buffer.alloc(MAX_LEDGER_BYTES, 32)); const r = await observe(s); assert.equal(r.reasonCode, 'ledger_unavailable'); safe(r);
});
test('hard-linked ledger rejected', async () => {
  const s = seed(); fs.linkSync(ledger(s), path.join(s.root, 'ledger-alias')); const r = await observe(s); assert.equal(r.reasonCode, 'ledger_unavailable'); safe(r);
});
test('foreign project ledger cannot supply a different selected corpus', async () => {
  const a = seed(), b = seed(); fs.appendFileSync(path.join(b.root, b.files[0].path), 'other');
  b.input.uiMaterials[0][b.files[0].kind + 'Digest'] = sha(fs.readFileSync(path.join(b.root, b.files[0].path)));
  fs.copyFileSync(ledger(a), ledger(b)); const r = await observe(b); assert.equal(r.reasonCode, 'implementation_material_unbound'); safe(r);
});
test('top-level-only known session cannot match an unknown receipt session', async () => {
  const s = seed(); s.input.contributors[0].executor.sessionId = null;
  editLedger(s, es => { es[1].actualExecutor.sessionId = null; });
  const r = await observe(s); assert.equal(r.reasonCode, 'implementation_identity_mismatch'); safe(r);
});
test('requested parent identity is used when actual parent provider is unknown', async () => {
  const s = seed(); editLedger(s, es => { es[0].actualExecutor = { provider: null, model: null, sessionId: null }; });
  const r = await observe(s); assert.equal(r.state, 'ledger-linked'); safe(r);
});
test('invalid callback is refused without reading any files', async () => {
  const stat = fs.lstatSync; let calls = 0; fs.lstatSync = () => { calls++; throw Error('no I/O'); };
  try { await assert.rejects(run(temp, '{}', '{}', null), /ui_review_ledger_callback_required/); assert.equal(calls, 0); }
  finally { fs.lstatSync = stat; }
});
test('event cap refuses oversized record set without partial correlation', async () => {
  const s = seed(); fs.appendFileSync(ledger(s), Array.from({ length: 2000 }, (_, i) => encode({ schemaVersion: 1, event: 'routing.proposed', eventId: 'extra-' + i })).join('\n') + '\n');
  const r = await observe(s); assert.equal(r.reasonCode, 'ledger_event_limit'); safe(r);
});
test('newline-terminated exact byte cap is accepted', async () => {
  const s = seed(), size = fs.statSync(ledger(s)).size;
  // Padding is preserved but not mistaken for a record. No append room remains.
  fs.appendFileSync(ledger(s), ' '.repeat(MAX_LEDGER_BYTES - size - 1) + '\n');
  const r = await observe(s, (_p, rc) => encode(rc)); assert.notEqual(r.ledger.beforeDigest, null); assert.equal(r.reasonCode, 'review_ambiguous_or_missing'); safe(r);
});
test('invalid UTF-8 ledger fails closed', async () => {
  const s = seed(); fs.appendFileSync(ledger(s), Buffer.from([255, 10])); const r = await observe(s); assert.equal(r.reasonCode, 'ledger_unavailable'); safe(r);
});
test('no callback-owned write means adapter leaves ledger byte exact', async () => {
  const s = seed(), before = fs.readFileSync(ledger(s));
  const r = await observe(s, (_p, rc) => encode(rc)); assert.equal(r.state, 'unlinked'); assert.ok(fs.readFileSync(ledger(s)).equals(before)); safe(r);
});
test('changed current input prevents host callback and terminal creation', async () => {
  const s = seed(), current = clone(s.input); current.contributors[0].attemptId = 'changed'; let calls = 0;
  const r = await run(s.root, s.request(), encode(current), () => { calls++; return ''; });
  assert.equal(calls, 0); assert.equal(r.observation.state, 'stale'); safe(r);
});
test('findings in ledger must equal the returned review', async () => {
  const s = seed(); const r = await observe(s, (p, rc) => {
    terminal(s, p, rc, e => { e.review.uiBoundary = { ...rc.review, findings: [{ category: 'instruction_to_ui_leakage', subtype: 'DEVELOPER_NOTE', sourceKind: 'developer_note', severity: 'advisory', disposition: 'review-remediation', evidenceDigest: s.input.uiMaterials[0].sourceDigest }] }; });
    return encode(rc);
  }); assert.equal(r.reasonCode, 'review_findings_mismatch'); safe(r);
});
test('finding-bearing receipt links but remains an unresolved finding', async () => {
  const s = seed(); const r = await observe(s, (p, rc) => {
    rc.review.findings = [{ category: 'instruction_to_ui_leakage', subtype: 'DEVELOPER_NOTE', sourceKind: 'developer_note', severity: 'advisory', disposition: 'review-remediation', evidenceDigest: s.input.uiMaterials[0].sourceDigest }];
    Object.assign(rc.coverage.find(c => c.subtype === 'DEVELOPER_NOTE'), { outcome: 'finding', findingIndexes: [0] });
    terminal(s, p, rc); return encode(rc);
  }); assert.equal(r.state, 'ledger-linked'); assert.equal(r.observation.assessment.state, 'findings'); safe(r);
});
test('callback failure cannot supply an error-controlled public reason', async () => {
  const s = seed(); const r = await observe(s, () => { throw Object.assign(new Error('PRIVATE_MARKER'), { uiLedgerCode: 'PRIVATE_MARKER' }); }); safe(r);
});
(async () => {
  let passed = 0;
  try {
    for (const t of cases) { try { await t.fn(); passed++; console.log('PASS ' + t.name); } catch (e) { console.error('FAIL ' + t.name + '\n' + e.stack); } }
  } finally {
    const resolved = path.resolve(temp); assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('leerness-uib04c-'));
    for (let attempt = 0; ; attempt++) {
      try { fs.rmSync(resolved, { recursive: true, force: true }); break; }
      catch (error) {
        if (attempt >= 5 || !['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES'].includes(error.code)) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
      }
    }
  }
  console.log(`UI review ledger: ${passed}/${cases.length} passed`); process.exitCode = passed === cases.length ? 0 : 1;
})();
