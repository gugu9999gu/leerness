'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const api = require('../lib/ui-boundary-contracts');
const ui = require('../lib/ui-boundary');
const roles = require('../lib/role-agent-schema');
const checkpoint = require('../lib/review-checkpoint');
const transport = require('../lib/review-checkpoint-transport');
const snapshot = require('../lib/review-snapshot');
const ledger = require('../lib/role-fallback');
const { removeTree } = require('./temp-cleanup');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const example = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../docs/review-checkpoint-example.json'), 'utf8'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-uib02-'));
const clone = value => JSON.parse(JSON.stringify(value));
const digest = 'sha256:' + 'a'.repeat(64);
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function input(sourceKind = 'acceptance_criterion', sensitivity = 'none') {
  return { schema: ui.INPUT_SCHEMA, policyVersion: ui.POLICY_VERSION, taskKind: 'ui',
    candidate: { sourceKind, intent: 'internal', userNeed: 'unknown', use: 'context', surface: 'rendered', sensitivity } };
}
const review = () => api.createUiBoundaryReview(JSON.stringify(input()), digest);
function invalid(fn, code) {
  assert.throws(fn, error => {
    assert.ok(error instanceof api.UiBoundaryContractError);
    if (code) assert.equal(error.code, 'ui_boundary_' + code);
    assert.ok(!error.message.includes('PRIVATE_MARKER')); return true;
  });
}
function packet(kind) {
  const p = clone(example); if (kind !== undefined) p.tasks[0].uiBoundary = api.createUiBoundaryTask(kind); return p;
}
function materials(p) {
  return { schema: snapshot.INPUT_SCHEMA, checkpoint: p,
    batch: { id: 'ui-batch', revision: 1, objectiveRevision: 'criteria-1', policyRevision: 'policy-1' },
    materials: { schema: snapshot.MATERIAL_SCHEMA,
      ...Object.fromEntries(['manifestDigest', 'acceptanceDigest', 'policyDigest', 'evidenceDigest', 'implementationDigest', 'dependenciesDigest'].map(k => [k, digest])) } };
}
function event(extension = review()) {
  return { event: 'review.completed', taskId: 'T-UI', attemptId: 'review-1', parentAttemptId: 'impl-1',
    actualExecutor: { provider: 'fixture', model: 'fixture-model', sessionId: 'self-session' },
    reviewerIndependent: false, evidenceRefs: ['fixture-evidence'], executed: true,
    review: { reviewerIndependent: false, uiBoundary: extension } };
}
function fixtureDir(name) { const p = path.join(temp, name); fs.mkdirSync(p); return p; }
function command(cwd, args, stdin) {
  const r = cp.spawnSync(process.execPath, [CLI, ...args], { cwd, input: stdin, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '1', LEERNESS_NO_STALE_CHECK: '1' } });
  if (r.error) throw r.error; return r;
}

for (const [role, duty] of [['designer', 'designer'], ['coder', 'implementer'], ['tester', 'tester'], ['reviewer', 'reviewer'], ['security', 'security']]) {
  test(`${role} role schema accepts its duty without adding authority`, () => {
    const def = { uiBoundary: api.createUiBoundaryRole(duty) };
    const doc = { schemaVersion: 2, kind: 'role-definitions', roles: { [role]: def } };
    const before = clone(doc); assert.equal(roles.validateRoleDefinitions(doc).ok, true); assert.deepEqual(doc, before);
    const instructions = api.uiBoundaryRoleInstructions(def.uiBoundary, api.createUiBoundaryTask('ui'));
    assert.equal(instructions.responsibility, duty); assert.equal(instructions.permissionGrant, false);
    assert.equal(instructions.contextRenderable, false); assert.equal(instructions.centralStringAllowlistRequired, false);
    assert.deepEqual(instructions.subtypes, Object.values(ui.TAXONOMY));
    assert.ok(instructions.duty.length > 30);
  });
  test(`${role} does not accept a conflicting duty`, () => {
    const ext = api.createUiBoundaryRole(duty === 'designer' ? 'tester' : 'designer');
    const r = roles.validateRoleDefinitions({ schemaVersion: 2, kind: 'role-definitions', roles: { [role]: { uiBoundary: ext } } });
    assert.equal(r.ok, false); assert.ok(r.problems.some(p => p.code === 'ui_boundary_role_duty_mismatch'));
  });
}
test('non-UI or absent policy requests no role instructions', () => {
  assert.equal(api.uiBoundaryRoleInstructions(undefined, undefined), null);
  assert.equal(api.uiBoundaryRoleInstructions(undefined, api.createUiBoundaryTask('non-ui')), null);
});
test('unknown task scope still carries the explicit default-deny instructions', () => {
  assert.equal(api.uiBoundaryRoleInstructions(api.createUiBoundaryRole('reviewer'), api.createUiBoundaryTask('unknown')).contextRenderable, false);
});
test('duty never bypasses permission ceilings', () => {
  const r = roles.validateRoleDefinitions({ schemaVersion: 2, kind: 'role-definitions', roles: {
    coder: { uiBoundary: api.createUiBoundaryRole('implementer'), approve: true },
  } }); assert.equal(r.ok, false); assert.ok(r.problems.some(x => x.code === 'builtin-role-authority-widening'));
});
test('unextended role definitions and provider mappings are unchanged', () => {
  const legacy = { schemaVersion: 1, projectNote: 'retain', roles: { coder: { provider: 'fixture', model: 'fixture-model', uiBoundary: { opaque: 'legacy data' } } } };
  const before = clone(legacy); const projected = roles.projectLegacyRoleStore(legacy);
  assert.equal(projected.ok, true); assert.deepEqual(legacy, before);
  const restored = roles.projectAgentInstancesToLegacy(projected.agentInstances, legacy);
  assert.equal(restored.ok, true);
  assert.equal(roles.validateRoleDefinitions({ schemaVersion: 2, kind: 'role-definitions', roles: { coder: {} } }).ok, true);
  assert.ok(JSON.stringify(restored).includes('legacy data'));
});
test('unsupported role extension is rejected without copying its raw values', () => {
  const r = roles.validateRoleDefinitions({ schemaVersion: 2, kind: 'role-definitions', roles: { coder: { uiBoundary: { PRIVATE_MARKER: 'PRIVATE_MARKER' } } } });
  assert.equal(r.ok, false); assert.ok(!JSON.stringify(r).includes('PRIVATE_MARKER'));
});
test('role ID objects are not coerced', () => {
  let called = false; invalid(() => api.validateUiBoundaryRole(api.createUiBoundaryRole('tester'), { toString() { called = true; return 'tester'; } }), 'role_identifier_invalid');
  assert.equal(called, false);
});
for (const kind of ['ui', 'unknown']) test(`${kind} task adds scoped unreviewed UI coverage only`, () => {
  const legacy = checkpoint.assessReviewCheckpoint(packet()); const current = checkpoint.assessReviewCheckpoint(packet(kind));
  const covered = current.taskCoverage[0]; assert.ok(covered.requestedAspects.includes('ux'));
  assert.deepEqual(covered.uiBoundary.requestedDomains, [api.DOMAIN]);
  assert.equal(covered.uiBoundary.applicability, kind === 'ui' ? 'applicable' : 'unknown');
  assert.equal(covered.uiBoundary.reviewStatus, 'not-reviewed'); assert.equal(covered.uiBoundary.evidenceStatus, 'unverified');
  assert.deepEqual(current.taskCoverage.slice(1), legacy.taskCoverage.slice(1));
  for (const field of ['grouping', 'checkpoint', 'preparation', 'execution', 'verification', 'effects']) assert.deepEqual(current[field], legacy[field]);
});
test('non-UI and missing extensions preserve coverage exactly', () => {
  const legacy = checkpoint.assessReviewCheckpoint(packet()); const current = checkpoint.assessReviewCheckpoint(packet('non-ui'));
  assert.deepEqual(current.taskCoverage, legacy.taskCoverage); assert.notEqual(current.inputDigest, legacy.inputDigest);
});
test('invalid task extension reaches the existing structured transport error', () => {
  const p = packet('ui'); p.tasks[0].uiBoundary.policyVersion = 'PRIVATE_MARKER';
  const r = transport.assessReviewCheckpointJson(JSON.stringify(p)); assert.equal(r.ok, false);
  assert.equal(r.error.code, 'ui_boundary_policy_unsupported'); assert.ok(!JSON.stringify(r).includes('PRIVATE_MARKER'));
});
test('empty or false optional task field is not treated as absent', () => {
  for (const ext of [null, false, {}, undefined]) {
    const p = packet(); p.tasks[0].uiBoundary = ext;
    assert.throws(() => checkpoint.validateReviewCheckpointInput(p));
  }
});
test('task policy changes are included in existing snapshot identity', () => {
  const previous = JSON.stringify(materials(packet())); const current = JSON.stringify(materials(packet('ui')));
  const r = snapshot.compareReviewSnapshotInputs(previous, current);
  assert.ok(r.changedBindings.includes('tasks')); assert.equal(r.approvalReusable, false);
  assert.equal(snapshot.compareReviewSnapshotInputs(current, current).reviewValidity, 'unverified');
  const nonUi = JSON.stringify(materials(packet('non-ui')));
  assert.ok(snapshot.compareReviewSnapshotInputs(current, nonUi).changedBindings.includes('tasks'));
});
test('real CLI carries optional UI coverage and leaves its workspace untouched', () => {
  const dir = fixtureDir('cli'); const r = command(dir, ['review-checkpoint', 'assess', '--stdin', '--json'], JSON.stringify(packet('ui')));
  assert.equal(r.status, 0, r.stderr); const data = JSON.parse(r.stdout);
  assert.deepEqual(data.assessment, checkpoint.assessReviewCheckpoint(packet('ui')));
  assert.deepEqual(fs.readdirSync(dir), []);
});
test('real MCP uses the same coverage without writing or granting approval', () => {
  const dir = fixtureDir('mcp');
  const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_review_checkpoint', arguments: { inputJson: JSON.stringify(packet('ui')) } } };
  const r = command(dir, ['mcp', 'serve', '--profile', 'full'], JSON.stringify(call) + '\n');
  assert.equal(r.status, 0, r.stderr); const rpc = JSON.parse(r.stdout.trim());
  const data = JSON.parse(rpc.result.content[0].text); assert.equal(data.ok, true);
  assert.deepEqual(data.assessment, checkpoint.assessReviewCheckpoint(packet('ui')));
  assert.deepEqual(fs.readdirSync(dir), []);
});

for (const sourceKind of Object.keys(ui.TAXONOMY)) {
  test(`${sourceKind} review finding retains consistent provenance and no raw text`, () => {
    const r = api.createUiBoundaryReview(JSON.stringify(input(sourceKind)), digest);
    assert.equal(r.evidenceVerified, false); assert.equal(r.findings[0].subtype, ui.TAXONOMY[sourceKind]);
    assert.equal(r.findings[0].sourceKind, sourceKind); assert.equal(r.findings[0].evidenceDigest, digest);
    assert.equal(r.findings[0].severity, 'advisory'); assert.deepEqual(api.validateUiBoundaryReview(r), r);
  });
  test(`${sourceKind} sensitive review has one delegated security finding`, () => {
    const r = api.createUiBoundaryReview(JSON.stringify(input(sourceKind, 'confirmed')), digest);
    assert.equal(r.findings.length, 1); assert.equal(r.findings[0].category, 'security');
    assert.equal(r.findings[0].severity, 'delegated'); assert.equal(r.findings[0].subtype, ui.TAXONOMY[sourceKind]);
  });
}
test('sensitive unknown or product-copy origin retains a null UI subtype', () => {
  for (const source of ['product_copy', 'unknown']) {
    const r = api.createUiBoundaryReview(JSON.stringify(input(source, 'suspected')), digest);
    assert.equal(r.findings[0].subtype, null); assert.equal(r.findings[0].category, 'security');
  }
});
test('non-UI builder has no findings or mandatory digest', () => {
  const p = input(); p.taskKind = 'non-ui'; p.candidate = null;
  const r = api.createUiBoundaryReview(JSON.stringify(p)); assert.deepEqual(r.findings, []); assert.equal(r.evidenceVerified, false);
});
test('empty findings are unverified, not a clean semantic review', () => {
  const p = input('product_copy'); Object.assign(p.candidate, { intent: 'explicit', userNeed: 'act', use: 'product-copy' });
  const r = api.createUiBoundaryReview(JSON.stringify(p)); assert.deepEqual(r.findings, []); assert.equal(r.evidenceVerified, false);
});
test('copy eligibility results are not accepted as assessment input', () => {
  assert.throws(() => api.createUiBoundaryReview(JSON.stringify(ui.assessUiBoundary(JSON.stringify(input()))), digest));
});
for (const [field, value, code] of [
  ['subtype', 'DEBUG_METADATA', 'subtype_source_mismatch'], ['sourceKind', 'unknown', 'subtype_source_mismatch'],
  ['severity', 'critical', 'enum_invalid'], ['disposition', 'auto-delete', 'enum_invalid'],
  ['category', 'PRIVATE_MARKER', 'enum_invalid'], ['evidenceDigest', 'PRIVATE_MARKER', 'digest_invalid'],
]) test(`invalid finding ${field} is rejected`, () => {
  const r = review(); r.findings[0][field] = value; invalid(() => api.validateUiBoundaryReview(r), code);
});
test('UI category cannot claim an unmapped source', () => {
  const r = review(); r.findings[0].subtype = null; r.findings[0].sourceKind = 'product_copy';
  invalid(() => api.validateUiBoundaryReview(r), 'ui_subtype_required');
});
test('security and UI severity/disposition vocabularies cannot be interchanged', () => {
  const r = review(); r.findings[0].category = 'security'; invalid(() => api.validateUiBoundaryReview(r), 'enum_invalid');
});
test('cannot claim evidence verification or non-UI findings', () => {
  const r = review(); r.evidenceVerified = true; invalid(() => api.validateUiBoundaryReview(r), 'unverified_evidence_required');
  r.evidenceVerified = false; r.taskKind = 'non-ui'; invalid(() => api.validateUiBoundaryReview(r), 'non_ui_findings');
});
test('32 findings survive; 33 fail before processing rows', () => {
  const r = review(); r.findings = Array.from({ length: 32 }, () => clone(r.findings[0]));
  assert.equal(api.validateUiBoundaryReview(r).findings.length, 32);
  r.findings.push(r.findings[0]); invalid(() => api.validateUiBoundaryReview(r), 'findings_limit');
});
test('sparse/inherited/symbol/accessor finding arrays are rejected without getters', () => {
  const r = review(); let called = false;
  r.findings = new Array(1); invalid(() => api.validateUiBoundaryReview(r), 'findings_array_invalid');
  r.findings = [review().findings[0]]; r.findings[Symbol('PRIVATE_MARKER')] = 1; invalid(() => api.validateUiBoundaryReview(r), 'findings_array_invalid');
  r.findings = [review().findings[0]]; Object.defineProperty(r.findings, '0', { get() { called = true; return {}; } });
  invalid(() => api.validateUiBoundaryReview(r), 'data_field_required'); assert.equal(called, false);
});
for (const [name, make, validate] of [
  ['role', () => api.createUiBoundaryRole('tester'), api.validateUiBoundaryRole],
  ['task', () => api.createUiBoundaryTask('ui'), api.validateUiBoundaryTask],
  ['review', review, api.validateUiBoundaryReview],
]) {
  for (const field of ['schema', 'policyVersion']) test(`${name} rejects unsupported ${field}`, () => {
    const x = make(); x[field] = 'PRIVATE_MARKER'; invalid(() => validate(x), field === 'schema' ? 'schema_unsupported' : 'policy_unsupported');
  });
  test(`${name} rejects unknown, symbol, hidden and accessor fields`, () => {
    for (const key of ['PRIVATE_MARKER', '__proto__', Symbol('PRIVATE_MARKER')]) {
      const x = make(); Object.defineProperty(x, key, { value: 'PRIVATE_MARKER', enumerable: true }); invalid(() => validate(x), 'fields_invalid');
    }
    const hidden = make(); Object.defineProperty(hidden, 'schema', { enumerable: false }); invalid(() => validate(hidden), 'data_field_required');
    let called = false; const accessor = make(); Object.defineProperty(accessor, 'schema', { get() { called = true; return 'PRIVATE_MARKER'; } });
    invalid(() => validate(accessor), 'data_field_required'); assert.equal(called, false);
  });
  test(`${name} rejects null, arrays and executable prototypes`, () => {
    for (const x of [null, [], new Date(), Object.create(make())]) invalid(() => validate(x), 'object_required');
  });
}
test('finding raw text and arbitrary metadata fields are rejected', () => {
  for (const field of ['renderedText', 'prompt', 'path', 'PRIVATE_MARKER', 'approvalGranted']) {
    const r = review(); r.findings[0][field] = 'PRIVATE_MARKER'; invalid(() => api.validateUiBoundaryReview(r), 'fields_invalid');
  }
});
test('returned role and review values cannot mutate later calls or caller input', () => {
  const r = review(); const checked = api.validateUiBoundaryReview(r); checked.findings[0].subtype = 'bad';
  assert.equal(r.findings[0].subtype, 'CRITERIA_TO_COPY'); assert.equal(review().findings[0].subtype, 'CRITERIA_TO_COPY');
  const instructions = api.uiBoundaryRoleInstructions(api.createUiBoundaryRole('tester'), api.createUiBoundaryTask('ui'));
  instructions.subtypes.length = 0; assert.equal(Object.values(ui.TAXONOMY).length, 5);
});
test('real ledger roundtrip preserves 32 valid findings and self-review identity', () => {
  const dir = fixtureDir('roundtrip'); const ext = review(); ext.findings = Array.from({ length: 32 }, () => clone(ext.findings[0]));
  const e = event(ext); e.review.password = 'PRIVATE_MARKER';
  const appended = ledger.appendExecutionEvent(dir, e); const read = ledger.readExecutionEvents(dir, 10);
  assert.equal(read.ok, true); assert.deepEqual(read.events[0].review.uiBoundary, ext);
  assert.equal(read.events[0].reviewerIndependent, false); assert.equal(read.events[0].review.password, '***');
  assert.equal(read.events[0].parentAttemptId, 'impl-1'); assert.equal(appended.event.review.uiBoundary.findings.length, 32);
  assert.ok(!fs.readFileSync(appended.file, 'utf8').includes('PRIVATE_MARKER'));
});
test('ledger metadata survives generic entry caps without exempting sibling secrets', () => {
  const dir = fixtureDir('cap'); const e = event(); e.review = { ...Object.fromEntries(Array.from({ length: 105 }, (_, i) => ['note' + i, 'value'])), uiBoundary: review(), password: 'PRIVATE_MARKER' };
  const result = ledger.appendExecutionEvent(dir, e); assert.deepEqual(result.event.review.uiBoundary, review());
  const read = ledger.readExecutionEvents(dir, 10); assert.equal(read.ok, true); assert.deepEqual(read.events[0].review.uiBoundary, review());
  assert.ok(!fs.readFileSync(result.file, 'utf8').includes('PRIVATE_MARKER'));
});
test('invalid ledger extension is rejected before creating its workspace', () => {
  const dir = fixtureDir('invalid'); const e = event(); e.review.uiBoundary.findings[0].renderedText = 'PRIVATE_MARKER';
  invalid(() => ledger.appendExecutionEvent(dir, e), 'fields_invalid'); assert.deepEqual(fs.readdirSync(dir), []);
});
test('invalid appended extension preserves existing bytes and mtime', () => {
  const dir = fixtureDir('preserve'); const result = ledger.appendExecutionEvent(dir, event());
  const before = fs.readFileSync(result.file); const stamp = fs.statSync(result.file).mtimeMs;
  const e = event(); e.review.uiBoundary.evidenceVerified = true;
  invalid(() => ledger.appendExecutionEvent(dir, e), 'unverified_evidence_required');
  assert.deepEqual(fs.readFileSync(result.file), before); assert.equal(fs.statSync(result.file).mtimeMs, stamp);
});
test('invalid persisted extension fails closed instead of becoming current evidence', () => {
  const dir = fixtureDir('read-invalid'); const result = ledger.appendExecutionEvent(dir, event());
  const stored = JSON.parse(fs.readFileSync(result.file, 'utf8')); stored.review.uiBoundary.findings[0].evidenceDigest = 'PRIVATE_MARKER';
  fs.writeFileSync(result.file, JSON.stringify(stored) + '\n');
  const before = fs.readFileSync(result.file); const read = ledger.readExecutionEvents(dir, 10);
  assert.equal(read.ok, false); assert.equal(read.invalidLines, 1); assert.deepEqual(read.events, []);
  assert.ok(!JSON.stringify(read).includes('PRIVATE_MARKER')); assert.deepEqual(fs.readFileSync(result.file), before);
});
test('UI metadata does not replace parent attempt or executed proof', () => {
  for (const field of ['parentAttemptId', 'executed', 'evidenceRefs']) {
    const e = event(); delete e[field];
    const dir = fixtureDir('missing-' + field);
    assert.throws(() => ledger.appendExecutionEvent(dir, e), error => error.code === 'ledger_terminal_incomplete');
  }
});
test('legacy ledger without an extension stays readable and has no fabricated UI policy', () => {
  const dir = fixtureDir('legacy'); const e = event(); delete e.review.uiBoundary;
  const r = ledger.appendExecutionEvent(dir, e); const read = ledger.readExecutionEvents(dir, 10);
  assert.equal(read.ok, true); assert.equal(Object.hasOwn(read.events[0].review, 'uiBoundary'), false);
  assert.deepEqual(read.events[0], r.event);
});

let failed = 0;
try {
  for (const { name, fn } of tests) {
    try { fn(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); }
  }
} finally {
  // This exact absolute directory was created by this probe; never delete a
  // caller-supplied path or follow a directory outside the temp prefix.
  const resolved = path.resolve(temp);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('leerness-uib02-'));
  removeTree(resolved, { recursive: true, force: true });
}
console.log(`UI boundary contracts: ${tests.length - failed}/${tests.length} passed`);
if (failed) process.exitCode = 1;
