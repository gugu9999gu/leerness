'use strict';

// Direct assertions for the RB-01 pure module; no CLI/model/production actions.
const assert = require('node:assert/strict');
const { assessReviewCheckpoint: assess, validateReviewCheckpointInput: validate, ReviewCheckpointInputError, INPUT_SCHEMA, MAX_BYTES } = require('../lib/review-checkpoint');
const cases = [];
const test = (name, fn) => cases.push({ name, fn });
function task(id, dependsOn = []) {
  return { id, objectiveId: 'order-create', criteria: ['order-create-works'], dependsOn,
    implementation: 'implemented', verification: 'passed', evidenceRefs: [`evidence:${id}`], risk: 'normal', riskTags: [], aspects: ['code', 'tests'] };
}
function fixture() {
  return { schema: INPUT_SCHEMA, objective: { id: 'order-create', criteria: ['order-create-works'] },
    tasks: [task('migration'), task('repository', ['migration']), task('api', ['repository']), task('unit', ['api']), task('integration', ['unit'])],
    context: { event: 'task-report', purposeComplete: true, executionMode: 'direct' },
    snapshot: { kind: 'git', baseCommit: 'a'.repeat(40), headCommit: 'b'.repeat(40) },
    limits: { maxTasks: 8, maxFiles: 10, maxChangedLines: 400, maxWaitingHours: 24 },
    metrics: { fileCount: 5, changedLines: 180, waitingHours: 1 } };
}
function changed(fn) { const value = fixture(); fn(value); return value; }
function rejects(name, edit, code) {
  test(name, () => assert.throws(() => assess(changed(edit)), error => error instanceof ReviewCheckpointInputError && (!code || error.code === code)));
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const has = (values, text) => assert.ok(values.includes(text), `missing ${text}`);

test('order vertical slice forms a packet candidate, not approval', () => {
  const result = assess(fixture());
  assert.equal(result.grouping.state, 'eligible');
  assert.equal(result.checkpoint.state, 'due');
  has(result.checkpoint.triggerCodes, 'purpose-boundary');
  assert.equal(result.preparation.state, 'packet-candidate');
  assert.equal(result.taskCoverage.length, 5);
  assert.equal(result.sourceTrust, 'caller-supplied');
  assert.deepEqual(result.effects, { modelInvoked: false, filesRead: false, filesWritten: false, approvalGranted: false, enforceChanged: false });
  assert.deepEqual(result.verification, { snapshotVerified: false, evidenceVerified: false, independentReview: 'not-run' });
  assert.ok(result.taskCoverage.every(t => t.reviewStatus === 'not-reviewed' && t.evidenceStatus === 'unverified'));
});
test('signup UI, RLS and commerce do not become one objective', () => {
  const input = fixture();
  input.tasks = [task('signup'), task('rls'), task('commerce')];
  input.tasks.forEach(t => { t.objectiveId = t.id; });
  input.tasks[1].riskTags = ['authorization'];
  const result = assess(input);
  assert.equal(result.grouping.state, 'split-required');
  has(result.grouping.reasonCodes, 'mixed-objectives');
  has(result.checkpoint.triggerCodes, 'risk-boundary');
  assert.equal(result.effects.approvalGranted, false);
});
test('one completed task does not wait for a task-count quota', () => {
  const result = assess(changed(x => { x.tasks = [task('only')]; }));
  assert.equal(result.checkpoint.state, 'due');
  assert.equal(result.preparation.state, 'packet-candidate');
});
test('unfinished low-risk work is not due without a boundary', () => {
  const result = assess(changed(x => { x.context.purposeComplete = false; x.tasks[0].implementation = 'implementing'; }));
  assert.equal(result.checkpoint.state, 'not-due');
  assert.equal(result.preparation.state, 'needs-evidence');
});
test('RLS safety review is due before implementation finishes', () => {
  const result = assess(changed(x => { x.context.purposeComplete = false; x.tasks[0].implementation = 'planned'; x.tasks[0].riskTags = ['authorization']; }));
  assert.equal(result.checkpoint.earlyReviewSuggested, true);
  has(result.checkpoint.triggerCodes, 'risk-boundary');
  assert.equal(result.preparation.state, 'needs-evidence');
  has(result.taskCoverage[0].requestedAspects, 'security');
});
test('destructive migration requires data and compatibility aspects', () => {
  const result = assess(changed(x => { x.tasks[0].riskTags = ['destructive-migration']; }));
  for (const aspect of ['code', 'security', 'data', 'compatibility']) has(result.taskCoverage[0].requestedAspects, aspect);
  assert.ok(!result.taskCoverage[1].requestedAspects.includes('data'));
});
for (const risk of ['high', 'critical']) test(`${risk} risk triggers review`, () => {
  has(assess(changed(x => { x.tasks[0].risk = risk; })).checkpoint.triggerCodes, 'risk-boundary');
});
for (const event of ['manual-review', 'integration', 'release', 'risk-apply']) test(`${event} never waits for all tasks`, () => {
  const result = assess(changed(x => { x.context.event = event; x.context.purposeComplete = false; }));
  assert.equal(result.checkpoint.state, 'due');
  assert.equal(result.preparation.state, 'needs-evidence');
  assert.equal(result.effects.approvalGranted, false);
});
test('unknown risk cannot become a complete packet', () => {
  const result = assess(changed(x => { x.tasks[0].risk = 'unknown'; }));
  assert.equal(result.grouping.state, 'needs-context');
  has(result.preparation.reasonCodes, 'risk-unknown');
});
test('explicitly disconnected criteria need a scope split', () => {
  const input = fixture(); input.objective.criteria = ['first', 'second'];
  input.tasks = [task('first'), task('second')];
  input.tasks[0].criteria = ['first']; input.tasks[1].criteria = ['second'];
  has(assess(input).grouping.reasonCodes, 'disconnected-scope');
  input.tasks[1].dependsOn = ['first'];
  assert.equal(assess(input).grouping.state, 'eligible');
});
test('missing acceptance coverage is visible', () => {
  const result = assess(changed(x => { x.objective.criteria.push('rollback-works'); }));
  assert.deepEqual(result.grouping.uncoveredCriteria, ['rollback-works']);
  has(result.preparation.reasonCodes, 'acceptance-coverage-missing');
});
for (const [metric, limit] of [['fileCount', 'maxFiles'], ['changedLines', 'maxChangedLines']]) {
  test(`${metric}: at limit is due, beyond it needs split`, () => {
    const input = fixture(); input.context.purposeComplete = false; input.metrics[metric] = input.limits[limit];
    const at = assess(input); has(at.checkpoint.triggerCodes, 'capacity-boundary'); assert.equal(at.grouping.state, 'eligible');
    input.metrics[metric]++; assert.equal(assess(input).grouping.state, 'split-required');
  });
  test(`${metric}: unknown is not zero`, () => {
    const result = assess(changed(x => { x.metrics[metric] = null; }));
    assert.equal(result.grouping.state, 'needs-context'); assert.equal(result.preparation.state, 'needs-evidence');
  });
}
test('too many tasks need split; no accidental approval', () => {
  const result = assess(changed(x => { x.limits.maxTasks = 4; }));
  has(result.grouping.reasonCodes, 'tasks-limit-exceeded'); assert.equal(result.effects.approvalGranted, false);
});
test('waiting boundary preserves incomplete work', () => {
  const result = assess(changed(x => { x.context.purposeComplete = false; x.metrics.waitingHours = 24; }));
  has(result.checkpoint.triggerCodes, 'waiting-boundary'); assert.equal(result.preparation.state, 'needs-evidence');
});
test('missing wait metric matters only when a wait limit is configured', () => {
  const input = changed(x => { x.metrics.waitingHours = null; });
  has(assess(input).grouping.reasonCodes, 'waiting-time-unknown');
  delete input.limits.maxWaitingHours;
  assert.equal(assess(input).grouping.state, 'eligible');
});
for (const verification of ['not-run', 'failed', 'partial', 'inconclusive']) test(`${verification} verification never becomes verified`, () => {
  const result = assess(changed(x => { x.tasks[0].verification = verification; }));
  assert.equal(result.preparation.state, 'needs-evidence'); assert.equal(result.verification.evidenceVerified, false);
});
test('claimed pass without an evidence reference is incomplete', () => {
  has(assess(changed(x => { x.tasks[0].evidenceRefs = []; })).preparation.reasonCodes, 'evidence-missing');
});
test('blocked task remains blocked even with purposeComplete', () => {
  has(assess(changed(x => { x.tasks[0].implementation = 'blocked'; })).preparation.reasonCodes, 'implementation-blocked');
});
test('snapshot missing is not a reviewable frozen target', () => {
  has(assess(changed(x => { x.snapshot = null; })).preparation.reasonCodes, 'snapshot-missing');
});
test('non-Git content digest does not claim Git durability', () => {
  const result = assess(changed(x => { x.snapshot = { kind: 'content', digest: `sha256:${'c'.repeat(64)}` }; }));
  assert.equal(result.snapshot.kind, 'content'); assert.equal(result.snapshot.headCommit, undefined);
  assert.equal(result.verification.snapshotVerified, false);
});
test('SHA256 Git object IDs accepted, abbreviated hashes rejected', () => {
  validate(changed(x => { x.snapshot.baseCommit = 'a'.repeat(64); x.snapshot.headCommit = 'b'.repeat(64); }));
  assert.throws(() => assess(changed(x => { x.snapshot.headCommit = 'b'.repeat(7); })), { code: 'commit_invalid' });
});
for (const mode of ['direct', 'delegated', 'parallel']) test(`${mode} is metadata, never an agent launch`, () => {
  const result = assess(changed(x => { x.context.executionMode = mode; }));
  assert.equal(result.execution.requestedMode, mode);
  assert.equal(result.execution.agentCreated, false);
  assert.equal(result.execution.delegationAssessmentRequired, mode !== 'direct');
});
test('external dependency must have an explicit state and revision', () => {
  const input = fixture(); input.tasks[0].dependsOn.push('schema-contract');
  input.externalDependencies = [{ id: 'schema-contract', state: 'pending', revision: null }];
  has(assess(input).preparation.reasonCodes, 'dependency-unresolved');
  input.externalDependencies[0] = { id: 'schema-contract', state: 'satisfied', revision: 'contract:r1' };
  assert.equal(assess(input).preparation.state, 'packet-candidate');
});
test('frozen input and independent output objects', () => {
  const input = freeze(fixture()); const before = JSON.stringify(input); const result = assess(input);
  result.taskCoverage[0].criteria.push('changed-output'); result.snapshot.headCommit = 'c'.repeat(40);
  assert.equal(JSON.stringify(input), before);
});
test('canonical key ordering and repeat calls are deterministic', () => {
  const input = fixture(); const reversed = Object.fromEntries(Object.entries(input).reverse());
  assert.deepEqual(assess(input), assess(input));
  assert.equal(assess(input).inputDigest, assess(reversed).inputDigest);
});
for (const change of [x => { x.snapshot.headCommit = 'c'.repeat(40); }, x => { x.tasks[0].evidenceRefs.push('new-evidence'); }, x => { x.limits.maxTasks++; }]) {
  test('changed snapshot/evidence/limits changes input digest', () => assert.notEqual(assess(fixture()).inputDigest, assess(changed(change)).inputDigest));
}

const negatives = [
  ['null optional dependencies rejected', x => { x.externalDependencies = null; }, 'array_limit'],
  ['false optional dependencies rejected', x => { x.externalDependencies = false; }, 'array_limit'],
  ['empty-string optional dependencies rejected', x => { x.externalDependencies = ''; }, 'array_limit'],
  ['mixed Git object algorithms rejected', x => { x.snapshot.headCommit = 'b'.repeat(64); }, 'commit_algorithm_mismatch'],
  ['unknown top field', x => { x.approved = true; }, 'unknown_field'],
  ['unsupported schema', x => { x.schema = 'leerness.review-checkpoint-input/v2'; }, 'schema_unsupported'],
  ['missing objective', x => { delete x.objective; }, 'field_required'],
  ['null objective', x => { x.objective = null; }, 'object_required'],
  ['empty criteria', x => { x.objective.criteria = []; }, 'array_limit'],
  ['duplicate criteria', x => { x.objective.criteria.push(x.objective.criteria[0]); }, 'duplicate_value'],
  ['unknown objective field', x => { x.objective.text = 'private'; }, 'unknown_field'],
  ['empty tasks', x => { x.tasks = []; }, 'array_limit'],
  ['too many tasks', x => { x.tasks = Array.from({ length: 101 }, (_, i) => task(`task${i}`)); }, 'array_limit'],
  ['duplicate task IDs', x => { x.tasks[1].id = x.tasks[0].id; }, 'duplicate_task'],
  ['unknown criterion', x => { x.tasks[0].criteria = ['missing']; }, 'criterion_unknown'],
  ['unknown task field', x => { x.tasks[0].observedModel = 'pretend'; }, 'unknown_field'],
  ['control in ID', x => { x.tasks[0].id = 'bad\nidentifier'; }, 'identifier_invalid'],
  ['path is not an ID', x => { x.tasks[0].id = '../outside'; }, 'identifier_invalid'],
  ['self dependency', x => { x.tasks[0].dependsOn = ['migration']; }, 'dependency_cycle'],
  ['dependency cycle', x => { x.tasks[0].dependsOn = ['integration']; }, 'dependency_cycle'],
  ['missing dependency', x => { x.tasks[0].dependsOn = ['missing']; }, 'dependency_missing'],
  ['duplicate dependency', x => { x.tasks[1].dependsOn.push('migration'); }, 'duplicate_value'],
  ['unused external dependency', x => { x.externalDependencies = [{ id: 'unused', state: 'unknown', revision: null }]; }, 'dependency_unused'],
  ['overlapping external ID', x => { x.externalDependencies = [{ id: 'api', state: 'unknown', revision: null }]; }, 'duplicate_dependency'],
  ['satisfied external without revision', x => { x.externalDependencies = [{ id: 'unused', state: 'satisfied', revision: null }]; }, 'dependency_revision_required'],
  ['bad external state', x => { x.externalDependencies = [{ id: 'unused', state: 'approved', revision: null }]; }, 'enum_invalid'],
  ['bad implementation', x => { x.tasks[0].implementation = 'approved'; }, 'enum_invalid'],
  ['bad verification', x => { x.tasks[0].verification = 'probably-passed'; }, 'enum_invalid'],
  ['bad risk', x => { x.tasks[0].risk = 'safe'; }, 'enum_invalid'],
  ['bad risk tag', x => { x.tasks[0].riskTags = ['whatever']; }, 'enum_invalid'],
  ['duplicate risk tag', x => { x.tasks[0].riskTags = ['payment', 'payment']; }, 'duplicate_value'],
  ['empty aspects', x => { x.tasks[0].aspects = []; }, 'array_limit'],
  ['duplicate aspect', x => { x.tasks[0].aspects = ['code', 'code']; }, 'duplicate_value'],
  ['bad aspect', x => { x.tasks[0].aspects = ['approved']; }, 'enum_invalid'],
  ['duplicate evidence reference', x => { x.tasks[0].evidenceRefs = ['e1', 'e1']; }, 'duplicate_value'],
  ['string completion boolean', x => { x.context.purposeComplete = 'true'; }, 'boolean_required'],
  ['bad event', x => { x.context.event = 'execute'; }, 'enum_invalid'],
  ['unknown mode', x => { x.context.executionMode = 'auto'; }, 'enum_invalid'],
  ['caller cannot supply permission', x => { x.context.approval = true; }, 'unknown_field'],
  ['zero task limit', x => { x.limits.maxTasks = 0; }, 'number_invalid'],
  ['fractional task limit', x => { x.limits.maxTasks = 2.5; }, 'number_invalid'],
  ['negative size', x => { x.metrics.changedLines = -1; }, 'number_invalid'],
  ['NaN size', x => { x.metrics.fileCount = NaN; }, 'json_value_invalid'],
  ['Infinity size', x => { x.metrics.fileCount = Infinity; }, 'json_value_invalid'],
  ['fractional file count', x => { x.metrics.fileCount = 0.5; }, 'number_invalid'],
  ['unknown snapshot kind', x => { x.snapshot = { kind: 'dirty', digest: `sha256:${'a'.repeat(64)}` }; }, 'snapshot_kind_invalid'],
  ['uppercase hash is not canonical', x => { x.snapshot.headCommit = 'B'.repeat(40); }, 'commit_invalid'],
  ['snapshot unknown field', x => { x.snapshot.approved = true; }, 'unknown_field'],
  ['bad content digest', x => { x.snapshot = { kind: 'content', digest: 'sha256:short' }; }, 'digest_invalid'],
  ['BigInt rejected', x => { x.metrics.changedLines = BigInt(2); }, 'json_value_invalid'],
  ['undefined rejected', x => { x.metrics.changedLines = undefined; }, 'json_value_invalid'],
  ['function rejected', x => { x.extra = () => true; }, 'json_value_invalid'],
  ['date object rejected', x => { x.extra = new Date(0); }, 'json_object_invalid'],
  ['symbol key rejected', x => { x[Symbol('extra')] = 1; }, 'json_key_invalid'],
  ['cycle rejected', x => { x.extra = x; }, 'input_cycle'],
  ['sparse array rejected', x => { delete x.tasks[2]; }, 'json_array_invalid'],
  ['array custom key rejected', x => { x.tasks.extra = true; }, 'json_array_invalid'],
  ['very large input bounded', x => { x.extra = 'x'.repeat(MAX_BYTES + 1); }, 'input_too_large'],
  ['aggregate string allocation bounded', x => { x.extra = ['x'.repeat(40000), 'y'.repeat(40000)]; }, 'input_too_large'],
  ['deep input bounded', x => { let v = x; for (let i = 0; i < 20; i++) { v.extra = {}; v = v.extra; } }, 'input_structure_limit']
];
for (const [name, edit, code] of negatives) rejects(name, edit, code);
test('getters are rejected without being invoked', () => {
  const input = fixture(); let invoked = false;
  Object.defineProperty(input, 'extra', { enumerable: true, get() { invoked = true; throw new Error('getter invoked'); } });
  assert.throws(() => assess(input), { code: 'json_accessor_or_hidden_field' }); assert.equal(invoked, false);
});
test('hidden fields rejected', () => {
  const input = fixture(); Object.defineProperty(input, 'extra', { value: true });
  assert.throws(() => assess(input), { code: 'json_accessor_or_hidden_field' });
});
test('error messages do not echo unknown field/value contents', () => {
  const input = fixture(); input['PRIVATE_FIELD_DO_NOT_ECHO'] = 'PRIVATE_VALUE_DO_NOT_ECHO';
  assert.throws(() => assess(input), error => error.code === 'unknown_field' && !error.message.includes('PRIVATE'));
});
test('no runtime filesystem/network/process/time/random dependency', () => {
  const fs = require('node:fs'); const cp = require('node:child_process');
  const http = require('node:http'); const https = require('node:https');
  const net = require('node:net'); const bindings = [];
  const block = (obj, key) => { bindings.push([obj, key, obj[key]]); obj[key] = () => { throw new Error(`forbidden ${key}`); }; };
  try {
    for (const key of ['readFileSync', 'writeFileSync', 'appendFileSync', 'mkdirSync', 'readdirSync', 'statSync', 'openSync']) block(fs, key);
    for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) block(cp, key);
    block(http, 'request'); block(http, 'get'); block(https, 'request'); block(https, 'get'); block(net, 'connect'); block(net, 'createConnection');
    block(Date, 'now'); block(Math, 'random');
    assert.equal(assess(fixture()).preparation.state, 'packet-candidate');
  } finally { for (const [obj, key, value] of bindings.reverse()) obj[key] = value; }
});

let passed = 0;
for (const entry of cases) {
  try { entry.fn(); passed++; }
  catch (error) { console.error(`FAIL ${entry.name}: ${error.stack}`); }
}
console.log(`review-checkpoint: ${passed}/${cases.length} passed`);
if (!cases.length || passed !== cases.length) process.exitCode = 1;
