'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const { createUiReviewPacket: create, assessUiReview: assess, UiReviewInputError, INPUT_SCHEMA,
  RECEIPT_SCHEMA, POLICY_VERSION, MAX_BYTES, SUBTYPES } = require('../lib/ui-review');
const { createUiBoundaryTask, REVIEW_SCHEMA } = require('../lib/ui-boundary-contracts');
const { INPUT_SCHEMA: SNAPSHOT_INPUT, MATERIAL_SCHEMA } = require('../lib/review-snapshot');
const { scanUiBoundary, INPUT_SCHEMA: SCAN_INPUT } = require('../lib/ui-boundary-scanner');
const hash = c => 'sha256:' + c.repeat(64);
const clone = v => JSON.parse(JSON.stringify(v));
const encode = v => JSON.stringify(v);
const identity = (provider = 'provider-a', model = 'gpt-unit-v1', sessionId = 'session-implementation') => ({ provider, model, sessionId });
function fixture() {
  return { schema: INPUT_SCHEMA, policyVersion: POLICY_VERSION,
    snapshot: { schema: SNAPSHOT_INPUT,
      batch: { id: 'batch-ui', revision: 1, objectiveRevision: 'criteria-1', policyRevision: 'policy-1' },
      materials: { schema: MATERIAL_SCHEMA, manifestDigest: hash('1'), acceptanceDigest: hash('2'),
        policyDigest: hash('3'), evidenceDigest: hash('4'), implementationDigest: hash('5'), dependenciesDigest: hash('6') },
      checkpoint: { schema: 'leerness.review-checkpoint-input/v1',
        objective: { id: 'O-ui', criteria: ['C-copy'] }, context: { event: 'task-report', purposeComplete: true, executionMode: 'direct' },
        snapshot: { kind: 'git', baseCommit: 'a'.repeat(40), headCommit: 'b'.repeat(40) },
        limits: { maxTasks: 100, maxFiles: 10, maxChangedLines: 400, maxWaitingHours: 24 },
        metrics: { fileCount: 2, changedLines: 20, waitingHours: 1 },
        tasks: [{ id: 'T-ui', objectiveId: 'O-ui', criteria: ['C-copy'], dependsOn: [], implementation: 'implemented',
          verification: 'passed', evidenceRefs: ['E-copy'], risk: 'normal', riskTags: [], aspects: ['ux', 'tests'], uiBoundary: createUiBoundaryTask('ui') }],
      } },
    uiMaterials: [{ taskId: 'T-ui', sourceDigest: hash('7'), specDigest: hash('8'), diffDigest: hash('9'), renderDigest: hash('a') }],
    contributors: [{ attemptId: 'implementation-1', taskIds: ['T-ui'], executor: identity() }],
  };
}
const packet = input => create(encode(input));
function receipt(input = fixture()) {
  const p = packet(input);
  return { schema: RECEIPT_SCHEMA, policyVersion: POLICY_VERSION, packetId: p.packetId,
    attemptId: 'review-1', execution: 'completed', reviewer: identity('provider-b', 'claude-unit-v1', 'session-review'),
    coverage: p.taskCoverage.flatMap(t => SUBTYPES.map(subtype => ({ taskId: t.taskId, subtype, outcome: 'no-finding', findingIndexes: [] }))),
    review: { schema: REVIEW_SCHEMA, policyVersion: POLICY_VERSION,
      taskKind: p.applicability === 'not-applicable' ? 'non-ui' : p.applicability === 'unknown' ? 'unknown' : 'ui', evidenceVerified: false, findings: [] },
  };
}
function evaluate(previous, current = previous, r = receipt(previous)) { return assess(encode(previous), encode(current), encode(r)); }
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
function noAuthority(result) {
  assert.deepEqual(result.verification, { sourceVerified: false, evidenceVerified: false, renderVerified: false,
    executionVerified: false, actorIdentityVerified: false, semanticVerified: false, independentReview: 'not-verified' });
  assert.ok(Object.values(result.effects).every(v => v === false));
  if (result.reviewValidity) assert.equal(result.reviewValidity, 'unverified');
}
function reject(fn, code) {
  assert.throws(fn, e => {
    assert.ok(e instanceof UiReviewInputError, String(e));
    assert.equal(e.code, 'ui_review_' + code);
    assert.ok(!String(e).includes('PRIVATE_MARKER')); assert.ok(!JSON.stringify(e).includes('PRIVATE_MARKER'));
    return true;
  });
}
test('fixed packet requests every subtype without granting approval', () => {
  const p = packet(fixture()); assert.equal(p.preparation.state, 'packet-candidate');
  assert.deepEqual(p.taskCoverage[0].requiredSubtypes, SUBTYPES); assert.equal(Object.keys(p.questions).length, 5); noAuthority(p);
});
test('review questions cover every visible string and name the legitimate case', () => {
  // The scanner cannot see requirement, criterion or narration wording, so the reviewer must read
  // all copy, not only scanner candidates, and must know what is not a finding.
  const p = packet(fixture());
  assert.match(p.questions.SPEC_TO_COPY, /every visible string and accessible name, not only scanner candidates/);
  assert.match(p.questions.SPEC_TO_COPY, /speaks to the user or to the builder/);
  for (const [subtype, q] of Object.entries(p.questions)) {
    assert.match(q, /every visible string and accessible name/, subtype);
    assert.match(q, /is not a finding|are not findings|keep fields/, subtype);
  }
});
test('complete compatible declarations are still unverified', () => {
  const r = evaluate(fixture()); assert.equal(r.state, 'review-candidate');
  assert.equal(r.independence.state, 'compatible-declarations'); assert.equal(r.independence.identityVerified, false);
  assert.equal(r.declaredCoverage.length, 5); noAuthority(r);
});
test('no receipt stays not reviewed', () => {
  const f = fixture(); const r = assess(encode(f), encode(f)); assert.equal(r.state, 'not-reviewed'); noAuthority(r);
});
test('explicit not-run receipt is representable', () => {
  const f = fixture(); const r = receipt(f); Object.assign(r, { execution: 'not-run', attemptId: null, reviewer: null, coverage: [] });
  assert.equal(evaluate(f, f, r).state, 'not-reviewed');
});
for (const key of ['sourceDigest', 'specDigest', 'diffDigest', 'renderDigest']) {
  test('stale after ' + key, () => {
    const before = fixture(); const after = fixture(); after.uiMaterials[0][key] = hash('c');
    const r = evaluate(before, after); assert.equal(r.state, 'stale'); assert.ok(r.reasonCodes.includes('ui-materials-changed'));
    assert.ok(r.declaredCoverage.every(c => c.outcome === 'stale')); noAuthority(r);
  });
  test('missing ' + key + ' needs evidence', () => {
    const f = fixture(); f.uiMaterials[0][key] = null; const p = packet(f);
    assert.equal(p.preparation.state, 'needs-context'); assert.deepEqual(p.missingMaterials, [{ taskId: 'T-ui', kind: key }]);
    assert.equal(evaluate(f).state, 'needs-context');
  });
}
const snapshotChanges = [
  ['source', s => { s.checkpoint.snapshot.headCommit = 'c'.repeat(40); }, 'source-changed'],
  ['batch', s => { s.batch.revision++; }, 'batch-changed'],
  ['criteria definitions', s => { s.materials.acceptanceDigest = hash('c'); }, 'acceptance-changed'],
  ['policy', s => { s.materials.policyDigest = hash('c'); }, 'policy-changed'],
  ['manifest', s => { s.materials.manifestDigest = hash('c'); }, 'manifest-changed'],
  ['test evidence', s => { s.materials.evidenceDigest = hash('c'); }, 'evidence-changed'],
  ['attempt evidence', s => { s.materials.implementationDigest = hash('c'); }, 'implementation-attempts-changed'],
  ['dependency evidence', s => { s.materials.dependenciesDigest = hash('c'); }, 'dependencies-changed'],
  ['task verification', s => { s.checkpoint.tasks[0].verification = 'failed'; }, 'tasks-changed'],
  ['UI declaration', s => { s.checkpoint.tasks[0].uiBoundary.taskKind = 'unknown'; }, 'tasks-changed'],
];
for (const [name, change, code] of snapshotChanges) test('reuse RB-02 stale: ' + name, () => {
  const before = fixture(); const after = fixture(); change(after.snapshot);
  const r = evaluate(before, after); assert.equal(r.state, 'stale'); assert.ok(r.reasonCodes.includes(code)); noAuthority(r);
});
test('non-Git exact content identity is also bound', () => {
  const f = fixture(); f.snapshot.checkpoint.snapshot = { kind: 'content', digest: hash('b') };
  const next = clone(f); next.snapshot.checkpoint.snapshot.digest = hash('c'); assert.equal(evaluate(f, next).state, 'stale');
});
test('unknown applicability never becomes review ready', () => {
  const f = fixture(); f.snapshot.checkpoint.tasks[0].uiBoundary.taskKind = 'unknown';
  assert.equal(packet(f).applicability, 'unknown'); assert.equal(evaluate(f).state, 'needs-context');
});
test('missing and explicit non-UI extensions do not request new review', () => {
  for (const explicit of [false, true]) {
    const f = fixture(); f.uiMaterials = []; f.contributors = [];
    if (explicit) f.snapshot.checkpoint.tasks[0].uiBoundary.taskKind = 'non-ui'; else delete f.snapshot.checkpoint.tasks[0].uiBoundary;
    assert.equal(packet(f).applicability, 'not-applicable'); const r = evaluate(f); assert.equal(r.state, 'not-applicable');
    assert.deepEqual(r.declaredCoverage, []); noAuthority(r);
  }
});
test('last UI task becoming non-UI invalidates old binding without approving it', () => {
  const f = fixture(); const current = clone(f); current.snapshot.checkpoint.tasks[0].uiBoundary.taskKind = 'non-ui'; current.uiMaterials = [];
  const r = evaluate(f, current); assert.equal(r.state, 'not-applicable'); assert.equal(r.bindingState, 'changed'); noAuthority(r);
});
for (const [name, edit] of [
  ['attempt', c => { c.attemptId = 'implementation-2'; }],
  ['provider', c => { c.executor.provider = 'provider-c'; }],
  ['model', c => { c.executor.model = 'gpt-unit-v2'; }],
  ['session', c => { c.executor.sessionId = 'another-session'; }],
]) test('contributor material invalidates prior review: ' + name, () => {
  const f = fixture(); const current = clone(f); edit(current.contributors[0]);
  const r = evaluate(f, current); assert.equal(r.state, 'stale'); assert.ok(r.reasonCodes.includes('ui-contributors-changed'));
});
for (const [name, edit, basis] of [
  ['same attempt', r => { r.attemptId = 'implementation-1'; }, 'same-attempt'],
  ['same session', r => { r.reviewer.sessionId = 'session-implementation'; }, 'same-session'],
  ['same provider', r => { r.reviewer.provider = 'provider-a'; }, 'same-provider'],
  ['same model', r => { r.reviewer.model = 'gpt-unit-v1'; }, 'same-model'],
  ['same family', r => { r.reviewer.model = 'gpt-unit-v9'; }, 'same-model-family'],
]) test('existing independence policy: ' + name, () => {
  const f = fixture(); const r = receipt(f); edit(r); const a = evaluate(f, f, r);
  assert.equal(a.state, ['same-attempt', 'same-session'].includes(basis) ? 'self-review' : 'not-independent');
  assert.equal(a.independence.state, 'not-independent'); assert.ok(a.independence.bases.includes(basis)); noAuthority(a);
});
for (const [name, edit] of [
  ['unknown reviewer', r => { r.reviewer = null; }],
  ['unknown provider', r => { r.reviewer.provider = null; }],
  ['unknown model', r => { r.reviewer.model = null; }],
  ['opaque model', r => { r.reviewer.model = 'opaque-id'; }],
  ['ambiguous family', r => { r.reviewer.model = 'claude-gpt-unit'; }],
]) test('unverified identity: ' + name, () => {
  const f = fixture(); const r = receipt(f); edit(r); assert.equal(evaluate(f, f, r).state, 'identity-unverified');
});
test('all contributing attempts participate in independence', () => {
  const f = fixture(); f.contributors.push({ attemptId: 'implementation-2', taskIds: ['T-ui'], executor: identity('provider-b', 'claude-unit-v2', 'second-implementation') });
  assert.equal(evaluate(f).state, 'not-independent');
});
test('missing contributing task membership needs context', () => {
  const f = fixture(); f.contributors = []; assert.deepEqual(packet(f).missingContributors, ['T-ui']); assert.equal(evaluate(f).state, 'needs-context');
});
test('unknown contributor executor cannot prove independent review', () => {
  const f = fixture(); f.contributors[0].executor = null; assert.equal(evaluate(f).state, 'identity-unverified');
});
for (const execution of ['failed', 'partial']) test('execution ' + execution + ' cannot satisfy review', () => {
  const f = fixture(); const r = receipt(f); r.execution = execution; assert.equal(evaluate(f, f, r).state, 'incomplete');
});
for (const subtype of SUBTYPES) {
  test('missing coverage ' + subtype, () => {
    const f = fixture(); const r = receipt(f); r.coverage = r.coverage.filter(c => c.subtype !== subtype);
    const a = evaluate(f, f, r); assert.equal(a.state, 'incomplete'); assert.ok(a.declaredCoverage.some(c => c.subtype === subtype && c.outcome === 'missing'));
  });
  test('inconclusive coverage ' + subtype, () => {
    const f = fixture(); const r = receipt(f); r.coverage.find(c => c.subtype === subtype).outcome = 'inconclusive';
    assert.equal(evaluate(f, f, r).state, 'incomplete');
  });
}
function addFinding(r, subtype = 'SPEC_TO_COPY') {
  const sourceKinds = { SPEC_TO_COPY: 'specification', IMPLEMENTATION_NARRATION: 'implementation_instruction', DEVELOPER_NOTE: 'developer_note', CRITERIA_TO_COPY: 'acceptance_criterion', DEBUG_METADATA: 'debug_metadata' };
  r.review.findings.push({ category: 'instruction_to_ui_leakage', subtype, sourceKind: sourceKinds[subtype],
    severity: 'advisory', disposition: 'review-remediation', evidenceDigest: hash('d') });
  const cell = r.coverage.find(c => c.subtype === subtype); cell.outcome = 'finding'; cell.findingIndexes = [r.review.findings.length - 1];
}
for (const subtype of SUBTYPES) test('typed semantic finding ' + subtype, () => {
  const f = fixture(); const r = receipt(f); addFinding(r, subtype); const a = evaluate(f, f, r);
  assert.equal(a.state, 'findings'); assert.equal(a.findingCount, 1); noAuthority(a);
});
test('UIB-03 security projection is bound to typed coverage once', () => {
  const f = fixture(); const r = receipt(f);
  r.review = scanUiBoundary(encode({ schema: SCAN_INPUT, policyVersion: POLICY_VERSION, taskKind: 'ui', surfaces: [
    { kind: 'text', exposure: 'rendered', attribute: null, text: 'DEBUG: ' + 'gh' + 'p_' + 'a1B2'.repeat(9) },
  ] })).review;
  const cell = r.coverage.find(c => c.subtype === 'DEBUG_METADATA'); cell.outcome = 'finding'; cell.findingIndexes = [0];
  const a = evaluate(f, f, r); assert.equal(a.state, 'findings'); assert.equal(a.findingCount, 1);
  assert.equal(r.review.findings[0].category, 'security'); noAuthority(a);
});
test('claimed receipt digest mismatch is stale', () => {
  const f = fixture(); const r = receipt(f); r.packetId = hash('e'); const a = evaluate(f, f, r);
  assert.equal(a.state, 'stale'); assert.equal(a.receiptBinding, 'mismatch');
});
test('advisory context change does not change material identity but readiness is reevaluated', () => {
  const f = fixture(); const current = clone(f); current.snapshot.checkpoint.context.purposeComplete = false;
  assert.equal(packet(f).packetId, packet(current).packetId);
  const a = evaluate(f, current); assert.equal(a.bindingState, 'unchanged'); assert.equal(a.state, 'needs-context');
});
test('capacity tightening cannot use unchanged bindings to bypass RB-01 split', () => {
  const f = fixture(); const current = clone(f); current.snapshot.checkpoint.limits.maxFiles = 1;
  const a = evaluate(f, current); assert.equal(a.bindingState, 'unchanged'); assert.equal(a.state, 'needs-context');
  assert.ok(a.reasonCodes.includes('files-limit-exceeded'));
});
test('disconnected tasks preserve RB-01 split requirement', () => {
  const f = fixture(); const second = clone(f.snapshot.checkpoint.tasks[0]); second.id = 'T-second'; second.criteria = ['C-other'];
  f.snapshot.checkpoint.objective.criteria.push('C-other'); f.snapshot.checkpoint.tasks.push(second);
  f.uiMaterials.push({ ...f.uiMaterials[0], taskId: second.id }); f.contributors[0].taskIds.push(second.id);
  assert.equal(evaluate(f).state, 'needs-context'); assert.ok(packet(f).preparation.reasonCodes.includes('disconnected-scope'));
});
test('non-UI security aspects remain visible and unreviewed', () => {
  const f = fixture(); f.snapshot.checkpoint.tasks[0].risk = 'high';
  const p = packet(f); assert.ok(p.taskCoverage[0].requestedAspects.includes('security'));
  assert.equal(p.taskCoverage[0].reviewStatus, 'not-reviewed'); assert.equal(evaluate(f).scope, 'ui-boundary-only');
});
test('source material key order and set order are stable', () => {
  const f = fixture(); f.contributors.push({ attemptId: 'implementation-2', taskIds: ['T-ui'], executor: identity('provider-c', 'gpt-unit-v2', 'other-session') });
  const next = clone(f); next.contributors.reverse(); next.snapshot.checkpoint.tasks[0].aspects.reverse();
  next.uiMaterials[0] = Object.fromEntries(Object.entries(next.uiMaterials[0]).reverse());
  const reverse = v => Array.isArray(v) ? v.map(reverse) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverse(x)])) : v;
  assert.equal(packet(f).packetId, packet(reverse(next)).packetId);
});
test('outputs cannot mutate later packet or required taxonomy', () => {
  const f = fixture(); const p = packet(f); const original = packet(f); p.questions.SPEC_TO_COPY = 'changed'; p.taskCoverage[0].requiredSubtypes.pop();
  assert.deepEqual(packet(f), original); assert.equal(SUBTYPES.length, 5);
});
test('identity values are not echoed in assessment', () => {
  const f = fixture(); const r = receipt(f); r.reviewer.sessionId = 'PRIVATE_MARKER';
  assert.ok(!encode(evaluate(f, f, r)).includes('PRIVATE_MARKER'));
});

const packetInvalid = [
  ['wrong schema', f => { f.schema = 'PRIVATE_MARKER'; }, 'schema_unsupported'],
  ['wrong policy', f => { f.policyVersion = 'PRIVATE_MARKER'; }, 'policy_unsupported'],
  ['unknown root', f => { f.PRIVATE_MARKER = true; }, 'unknown_field'],
  ['missing root field', f => { delete f.snapshot; }, 'field_required'],
  ['null snapshot', f => { f.snapshot = null; }, 'object_required'],
  ['no source snapshot', f => { f.snapshot.checkpoint.snapshot = null; }, 'source_snapshot_required'],
  ['empty material membership', f => { f.uiMaterials = []; }, 'ui_material_membership_incomplete'],
  ['wrong material task', f => { f.uiMaterials[0].taskId = 'T-other'; }, 'ui_task_reference_invalid'],
  ['duplicate material', f => { f.uiMaterials.push(clone(f.uiMaterials[0])); }, 'duplicate_entry'],
  ['raw material', f => { f.uiMaterials[0].rawText = 'PRIVATE_MARKER'; }, 'unknown_field'],
  ['invalid digest', f => { f.uiMaterials[0].specDigest = 'PRIVATE_MARKER'; }, 'digest_invalid'],
  ['unknown contributor task', f => { f.contributors[0].taskIds = ['T-other']; }, 'task_reference_invalid'],
  ['duplicate contributor', f => { f.contributors.push(clone(f.contributors[0])); }, 'duplicate_entry'],
  ['empty membership', f => { f.contributors[0].taskIds = []; }, 'task_membership_required'],
  ['duplicate membership', f => { f.contributors[0].taskIds.push('T-ui'); }, 'duplicate_entry'],
  ['identity claims', f => { f.contributors[0].executor.verified = true; }, 'unknown_field'],
  ['invalid provider', f => { f.contributors[0].executor.provider = 'PRIVATE_MARKER()'; }, 'provider_invalid'],
  ['invalid model', f => { f.contributors[0].executor.model = 'PRIVATE_MARKER()'; }, 'model_invalid'],
  ['invalid session', f => { f.contributors[0].executor.sessionId = 'PRIVATE_MARKER/path'; }, 'identifier_invalid'],
];
for (const [name, edit, code] of packetInvalid) test('packet rejects ' + name, () => { const f = fixture(); edit(f); reject(() => packet(f), code); });
const receiptInvalid = [
  ['approval flag', r => { r.approved = true; }, 'unknown_field'],
  ['raw transcript', r => { r.transcript = 'PRIVATE_MARKER'; }, 'unknown_field'],
  ['wrong schema', r => { r.schema = 'PRIVATE_MARKER'; }, 'schema_unsupported'],
  ['wrong policy', r => { r.policyVersion = 'PRIVATE_MARKER'; }, 'policy_unsupported'],
  ['bad packet id', r => { r.packetId = 'PRIVATE_MARKER'; }, 'digest_invalid'],
  ['no attempt after execution', r => { r.attemptId = null; }, 'attempt_required'],
  ['unsupported execution', r => { r.execution = 'approved'; }, 'enum_invalid'],
  ['not-run with coverage', r => { r.execution = 'not-run'; }, 'not_run_conflict'],
  ['duplicate coverage', r => { r.coverage.push(clone(r.coverage[0])); }, 'duplicate_entry'],
  ['unknown task', r => { r.coverage[0].taskId = 'T-other'; }, 'ui_task_reference_invalid'],
  ['unknown subtype', r => { r.coverage[0].subtype = 'PRIVATE_MARKER'; }, 'enum_invalid'],
  ['approved outcome', r => { r.coverage[0].outcome = 'approved'; }, 'enum_invalid'],
  ['unbacked finding outcome', r => { r.coverage[0].outcome = 'finding'; }, 'finding_outcome_mismatch'],
  ['invalid finding index', r => { r.coverage[0].outcome = 'finding'; r.coverage[0].findingIndexes = [0]; }, 'finding_reference_invalid'],
  ['orphan finding', r => { addFinding(r); r.coverage[0].outcome = 'no-finding'; r.coverage[0].findingIndexes = []; }, 'finding_unassigned'],
  ['finding subtype mismatch', r => { addFinding(r); r.coverage[0].subtype = 'DEBUG_METADATA'; }, 'finding_subtype_mismatch'],
  ['repeated finding reference', r => { addFinding(r); r.coverage[0].findingIndexes.push(0); }, 'finding_reference_duplicate'],
  ['finding under no-finding outcome', r => { addFinding(r); r.coverage[0].outcome = 'no-finding'; }, 'finding_outcome_mismatch'],
  ['verified evidence promotion', r => { r.review.evidenceVerified = true; }, 'ui_boundary_unverified_evidence_required'],
  ['wrong review task kind', r => { r.review.taskKind = 'non-ui'; }, 'review_task_kind_mismatch'],
];
for (const [name, edit, code] of receiptInvalid) test('receipt rejects ' + name, () => {
  const f = fixture(); const r = receipt(f); edit(r); reject(() => evaluate(f, f, r), code);
});
test('duplicate raw and escaped-equivalent keys reject at shared parser', () => {
  const json = encode(fixture());
  for (const key of ['schema', '\\u0073chema']) reject(() => create(json.replace('"schema":', '"' + key + '":"PRIVATE_MARKER","schema":')), 'duplicate_json_key');
});
test('malformed JSON has no raw parser message', () => reject(() => create('{PRIVATE_MARKER'), 'invalid_json'));
test('non-string input is not coerced', () => {
  let calls = 0; reject(() => create({ toString() { calls++; return 'PRIVATE_MARKER'; } }), 'input_json_required'); assert.equal(calls, 0);
});
test('full 65536-byte input boundary', () => {
  const json = encode(fixture()); const n = Buffer.byteLength(json); assert.ok(create(json + ' '.repeat(MAX_BYTES - n)).packetId);
  reject(() => create(json + ' '.repeat(MAX_BYTES - n + 1)), 'input_too_large');
});
test('over-limit receipt rejects before result evaluation', () => {
  const f = fixture(); reject(() => assess(encode(f), encode(f), ' '.repeat(MAX_BYTES + 1)), 'input_too_large');
});
test('deep input is bounded before domain traversal', () => reject(() => create('['.repeat(18) + '0' + ']'.repeat(18)), 'input_structure_limit'));
test('coverage array cap rejects surplus cells', () => {
  const f = fixture(); const r = receipt(f); r.coverage = Array.from({ length: 161 }, () => clone(r.coverage[0]));
  reject(() => evaluate(f, f, r), 'array_limit');
});
test('contributor cap rejects 33 attempts', () => {
  const f = fixture(); f.contributors = Array.from({ length: 33 }, (_, i) => ({ ...clone(f.contributors[0]), attemptId: 'a' + i }));
  reject(() => packet(f), 'array_limit');
});
test('maximum 32 tasks and 160 cells survive without truncation', () => {
  const f = fixture(); const t = clone(f.snapshot.checkpoint.tasks[0]); const m = clone(f.uiMaterials[0]);
  f.snapshot.checkpoint.tasks = Array.from({ length: 32 }, (_, i) => ({ ...clone(t), id: 'T-' + String(i).padStart(2, '0') }));
  f.uiMaterials = f.snapshot.checkpoint.tasks.map(t => ({ ...m, taskId: t.id }));
  f.contributors[0].taskIds = f.snapshot.checkpoint.tasks.map(t => t.id);
  const a = evaluate(f); assert.equal(a.state, 'review-candidate'); assert.equal(a.declaredCoverage.length, 160); noAuthority(a);
  f.snapshot.checkpoint.tasks.push({ ...t, id: 'T-extra' }); reject(() => packet(f), 'ui_tasks_limit');
});
test('new UI task cannot inherit another task coverage', () => {
  const f = fixture(); const current = clone(f); const t = clone(current.snapshot.checkpoint.tasks[0]); t.id = 'T-new';
  current.snapshot.checkpoint.tasks.push(t); current.uiMaterials.push({ ...current.uiMaterials[0], taskId: t.id }); current.contributors[0].taskIds.push(t.id);
  const a = evaluate(f, current); assert.equal(a.state, 'stale'); assert.ok(a.declaredCoverage.filter(c => c.taskId === 'T-new').every(c => c.outcome === 'missing'));
});
test('32 typed findings project once each; a 33rd finding is rejected', () => {
  const f = fixture(); const r = receipt(f);
  for (let i = 0; i < 32; i++) addFinding(r);
  r.coverage[0].findingIndexes = Array.from({ length: 32 }, (_, i) => i);
  assert.equal(evaluate(f, f, r).findingCount, 32);
  addFinding(r); reject(() => evaluate(f, f, r), 'ui_boundary_findings_limit');
});
test('library invocation performs no filesystem IO or process execution', () => {
  const f = fixture(); const r = receipt(f); const saved = [];
  try {
    for (const [target, keys] of [[fs, ['readFileSync', 'writeFileSync', 'appendFileSync', 'statSync', 'readdirSync']], [cp, ['spawnSync', 'execSync', 'spawn', 'execFileSync']]]) {
      for (const key of keys) { saved.push([target, key, target[key]]); target[key] = () => { throw Error('unexpected effect'); }; }
    }
    noAuthority(evaluate(f, f, r));
  } finally { for (const [target, key, value] of saved) target[key] = value; }
});

let passed = 0;
for (const { name, fn } of cases) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { console.error('FAIL ' + name + '\n' + e.stack); }
}
console.log(`UI review contract: ${passed}/${cases.length} passed`);
process.exitCode = passed === cases.length ? 0 : 1;
