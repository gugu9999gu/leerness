'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  INPUT_SCHEMA, MATERIAL_SCHEMA, SNAPSHOT_SCHEMA, COMPARISON_SCHEMA, MAX_BYTES,
  ReviewSnapshotInputError, createReviewSnapshotCandidate, compareReviewSnapshotInputs
} = require('../lib/review-snapshot');

const hash = char => `sha256:${char.repeat(64)}`;
function fixture() {
  return {
    schema: INPUT_SCHEMA,
    batch: { id: 'RB-02', revision: 1, objectiveRevision: 'acceptance-1', policyRevision: 'policy-1' },
    materials: {
      schema: MATERIAL_SCHEMA, manifestDigest: hash('1'), acceptanceDigest: hash('2'),
      policyDigest: hash('3'), evidenceDigest: hash('4'), implementationDigest: hash('5'), dependenciesDigest: hash('6')
    },
    checkpoint: {
      schema: 'leerness.review-checkpoint-input/v1',
      objective: { id: 'O-order', criteria: ['C-api', 'C-storage'] },
      context: { event: 'task-report', purposeComplete: true, executionMode: 'direct' },
      snapshot: { kind: 'git', baseCommit: 'a'.repeat(40), headCommit: 'b'.repeat(40) },
      limits: { maxTasks: 5, maxFiles: 10, maxChangedLines: 400, maxWaitingHours: 24 },
      metrics: { fileCount: 3, changedLines: 90, waitingHours: 1 },
      tasks: [
        { id: 'T-storage', objectiveId: 'O-order', criteria: ['C-storage'], dependsOn: [], implementation: 'implemented', verification: 'passed', evidenceRefs: ['E-unit', 'E-types'], risk: 'normal', riskTags: [], aspects: ['code', 'tests'] },
        { id: 'T-api', objectiveId: 'O-order', criteria: ['C-api', 'C-storage'], dependsOn: ['T-storage', 'D-one', 'D-two'], implementation: 'implemented', verification: 'passed', evidenceRefs: ['E-integration'], risk: 'normal', riskTags: [], aspects: ['code', 'compatibility'] }
      ],
      externalDependencies: [{ id: 'D-one', state: 'satisfied', revision: 'v1' }, { id: 'D-two', state: 'satisfied', revision: 'v2' }]
    }
  };
}
const encode = value => JSON.stringify(value);
const create = value => createReviewSnapshotCandidate(encode(value));
const compare = (a, b) => compareReviewSnapshotInputs(encode(a), encode(b));
let total = 0;
let passed = 0;
function test(name, callback) {
  total++;
  try { callback(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); }
}
function rejection(name, mutate, code) {
  test(name, () => {
    const value = fixture();
    mutate(value);
    assert.throws(() => create(value), error => error instanceof ReviewSnapshotInputError && error.code === code);
  });
}
function change(name, mutate, expected) {
  test(name, () => {
    const before = fixture();
    const after = fixture();
    mutate(after);
    const result = compare(before, after);
    assert.equal(result.schema, COMPARISON_SCHEMA);
    assert.equal(result.bindingState, 'changed');
    assert.notEqual(result.previousSnapshotId, result.currentSnapshotId);
    assert.deepEqual(result.reasonCodes, expected);
    assert.equal(result.reviewValidity, 'unverified');
    assert.equal(result.approvalReusable, false);
    assert.ok(Object.values(result.effects).every(value => value === false));
  });
}

test('candidate carries no approval, verification or persistence claim', () => {
  const result = create(fixture());
  assert.equal(result.schema, SNAPSHOT_SCHEMA);
  assert.match(result.snapshotId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(result.sourceTrust, 'caller-supplied');
  assert.equal(result.durability, 'not-persisted');
  assert.equal(result.approvalReusable, false);
  assert.equal(result.verification.reviewStatus, 'not-evaluated');
  for (const [key, value] of Object.entries(result.verification)) if (key !== 'reviewStatus') assert.equal(value, false);
  assert.ok(Object.values(result.effects).every(value => value === false));
  assert.equal(Object.keys(result.bindingDigests).length, 9);
});
test('same input is unchanged but never reusable approval', () => {
  const value = fixture();
  const result = compare(value, value);
  assert.equal(result.bindingState, 'unchanged');
  assert.equal(result.previousSnapshotId, result.currentSnapshotId);
  assert.deepEqual(result.changedBindings, []);
  assert.deepEqual(result.reasonCodes, []);
  assert.equal(result.reviewValidity, 'unverified');
  assert.equal(result.approvalReusable, false);
});
test('caller input bytes and object remain unchanged', () => {
  const value = fixture();
  const text = encode(value);
  createReviewSnapshotCandidate(text);
  compareReviewSnapshotInputs(text, text);
  assert.equal(encode(value), text);
});
test('candidate and nested metadata are frozen', () => {
  const result = create(fixture());
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.bindingDigests));
  assert.ok(Object.isFrozen(result.verification));
  assert.ok(Object.isFrozen(result.effects));
  assert.throws(() => { result.bindingDigests.source = hash('0'); }, TypeError);
});
test('comparison and arrays are frozen', () => {
  const result = compare(fixture(), fixture());
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.reasonCodes));
  assert.ok(Object.isFrozen(result.changedBindings));
  assert.throws(() => result.reasonCodes.push('invented'), TypeError);
});
test('object key order and JSON whitespace do not affect identity', () => {
  function reverse(value) {
    if (Array.isArray(value)) return value.map(reverse);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverse(item)]));
    return value;
  }
  assert.equal(create(fixture()).snapshotId, createReviewSnapshotCandidate(JSON.stringify(reverse(fixture()), null, 2)).snapshotId);
});
test('set-valued arrays and task/external ordering normalize', () => {
  const before = fixture();
  const after = fixture();
  after.checkpoint.objective.criteria.reverse();
  after.checkpoint.tasks.reverse();
  after.checkpoint.externalDependencies.reverse();
  for (const task of after.checkpoint.tasks) for (const key of ['criteria', 'dependsOn', 'evidenceRefs', 'riskTags', 'aspects']) task[key].reverse();
  assert.equal(compare(before, after).bindingState, 'unchanged');
});
test('risk-tag set ordering normalizes', () => {
  const a = fixture(); const b = fixture();
  a.checkpoint.tasks[0].riskTags = ['authorization', 'sensitive-data'];
  b.checkpoint.tasks[0].riskTags = ['sensitive-data', 'authorization'];
  assert.equal(compare(a, b).bindingState, 'unchanged');
});
for (const [name, mutate] of [
  ['event', value => { value.checkpoint.context.event = 'release'; }],
  ['elapsed time', value => { value.checkpoint.metrics.waitingHours = 60; }],
  ['unknown metrics', value => { value.checkpoint.metrics.fileCount = null; value.checkpoint.metrics.changedLines = null; }],
  ['capacity limits', value => { value.checkpoint.limits.maxTasks = 1; }],
  ['implementation topology', value => { value.checkpoint.context.executionMode = 'parallel'; }],
  ['purpose-completion trigger', value => { value.checkpoint.context.purposeComplete = false; }]
]) test(`${name} does not alter material identity or grant approval`, () => {
  const a = fixture(); const b = fixture(); mutate(b);
  const result = compare(a, b);
  assert.equal(result.bindingState, 'unchanged'); assert.equal(result.approvalReusable, false);
});
change('batch revision changes', value => { value.batch.revision++; }, ['batch-changed']);
change('batch identity changes', value => { value.batch.id = 'RB-another'; }, ['batch-changed']);
change('source head changes even for claimed record-only commits', value => { value.checkpoint.snapshot.headCommit = 'c'.repeat(40); }, ['source-changed']);
change('source base changes', value => { value.checkpoint.snapshot.baseCommit = 'c'.repeat(40); }, ['source-changed']);
change('source kind changes', value => { value.checkpoint.snapshot = { kind: 'content', digest: hash('0') }; }, ['source-changed']);
change('exact manifest digest changes', value => { value.materials.manifestDigest = hash('0'); }, ['manifest-changed']);
change('acceptance material changes without revision bump', value => { value.materials.acceptanceDigest = hash('0'); }, ['acceptance-changed']);
change('objective revision changes', value => { value.batch.objectiveRevision = 'v2'; }, ['acceptance-changed']);
change('policy material changes without revision bump', value => { value.materials.policyDigest = hash('0'); }, ['policy-changed']);
change('policy revision changes', value => { value.batch.policyRevision = 'v2'; }, ['policy-changed']);
change('evidence material changes', value => { value.materials.evidenceDigest = hash('0'); }, ['evidence-changed']);
change('implementation-attempt material changes', value => { value.materials.implementationDigest = hash('0'); }, ['implementation-attempts-changed']);
change('dependency material changes', value => { value.materials.dependenciesDigest = hash('0'); }, ['dependencies-changed']);
change('external dependency revision changes', value => { value.checkpoint.externalDependencies[0].revision = 'v3'; }, ['dependencies-changed']);
change('external dependency becomes unknown', value => { value.checkpoint.externalDependencies[0].state = 'unknown'; value.checkpoint.externalDependencies[0].revision = null; }, ['dependencies-changed']);
change('task required aspect changes', value => { value.checkpoint.tasks[0].aspects.push('security'); }, ['tasks-changed']);
change('task verification failure is preserved', value => { value.checkpoint.tasks[0].verification = 'failed'; }, ['tasks-changed']);
change('task evidence reference changes', value => { value.checkpoint.tasks[0].evidenceRefs.push('E-new'); }, ['tasks-changed']);
change('task risk changes', value => { value.checkpoint.tasks[0].risk = 'high'; }, ['tasks-changed']);
change('task risk tags change', value => { value.checkpoint.tasks[0].riskTags.push('authorization'); }, ['tasks-changed']);
change('task implementation state changes', value => { value.checkpoint.tasks[0].implementation = 'blocked'; }, ['tasks-changed']);
change('task criterion membership changes', value => { value.checkpoint.tasks[1].criteria.pop(); }, ['tasks-changed']);
change('multiple changed categories are all reported deterministically', value => {
  value.materials.policyDigest = hash('0'); value.materials.evidenceDigest = hash('0'); value.materials.manifestDigest = hash('0');
}, ['manifest-changed', 'policy-changed', 'evidence-changed']);
test('non-Git content snapshots stay unverified and not persisted', () => {
  const value = fixture(); value.checkpoint.snapshot = { kind: 'content', digest: hash('a') };
  const result = create(value);
  assert.equal(result.sourceKind, 'content'); assert.equal(result.durability, 'not-persisted');
  assert.equal(result.verification.sourceVerified, false);
  const updated = JSON.parse(encode(value)); updated.checkpoint.snapshot.digest = hash('b');
  assert.deepEqual(compare(value, updated).reasonCodes, ['source-changed']);
});
test('64-character Git object identifiers are supported', () => {
  const value = fixture(); value.checkpoint.snapshot.baseCommit = 'a'.repeat(64); value.checkpoint.snapshot.headCommit = 'b'.repeat(64);
  assert.equal(create(value).sourceKind, 'git');
});
test('failed, incomplete and unknown evidence does not become a pass', () => {
  const value = fixture(); value.checkpoint.tasks[0].verification = 'failed';
  value.checkpoint.tasks[0].evidenceRefs = []; value.checkpoint.tasks[0].risk = 'unknown';
  const result = create(value);
  assert.equal(result.verification.reviewStatus, 'not-evaluated'); assert.equal(result.approvalReusable, false);
});
for (const key of ['schema', 'checkpoint', 'batch', 'materials']) rejection(`missing top-level ${key}`, value => { delete value[key]; }, 'field_required');
rejection('unknown top-level fields cannot invent an approval', value => { value.approved = true; }, 'unknown_field');
rejection('unsupported input schema', value => { value.schema = 'v2'; }, 'schema_unsupported');
rejection('unsupported materials schema', value => { value.materials.schema = 'v2'; }, 'schema_unsupported');
rejection('missing source snapshot', value => { value.checkpoint.snapshot = null; }, 'source_snapshot_required');
rejection('mixed objectives', value => { value.checkpoint.tasks[0].objectiveId = 'O-unrelated'; }, 'mixed_objectives');
rejection('duplicate task', value => { value.checkpoint.tasks[1].id = value.checkpoint.tasks[0].id; }, 'duplicate_task');
rejection('dependency cycle', value => { value.checkpoint.tasks[0].dependsOn = ['T-api']; }, 'dependency_cycle');
rejection('unknown task criterion', value => { value.checkpoint.tasks[0].criteria = ['C-unknown']; }, 'criterion_unknown');
rejection('unknown checkpoint field', value => { value.checkpoint.extra = true; }, 'unknown_field');
rejection('unknown material field', value => { value.materials.reviewed = true; }, 'unknown_field');
rejection('unknown batch field', value => { value.batch.approved = true; }, 'unknown_field');
for (const revision of [0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) rejection(`invalid revision ${revision}`, value => { value.batch.revision = revision; }, 'revision_invalid');
for (const key of ['manifestDigest', 'acceptanceDigest', 'policyDigest', 'evidenceDigest', 'implementationDigest', 'dependenciesDigest']) {
  rejection(`missing ${key}`, value => { delete value.materials[key]; }, 'field_required');
  rejection(`unknown/null ${key}`, value => { value.materials[key] = null; }, 'digest_required');
}
rejection('malformed digest', value => { value.materials.manifestDigest = 'sha256:unverified'; }, 'digest_required');
rejection('mixed Git hash algorithms', value => { value.checkpoint.snapshot.headCommit = 'b'.repeat(64); }, 'commit_algorithm_mismatch');
for (const value of [null, {}, [], 1, true, Buffer.from('{}')]) test('non-string input rejected without coercion', () => {
  assert.throws(() => createReviewSnapshotCandidate(value), error => error.code === 'serialized_json_required');
});
test('object hooks are never executed', () => {
  let calls = 0;
  assert.throws(() => createReviewSnapshotCandidate({ toJSON() { calls++; return fixture(); } }), error => error.code === 'serialized_json_required');
  assert.equal(calls, 0);
});
for (const text of ['', '{', 'null', '[]', '42', 'true']) test(`invalid root ${text || '(empty)'}`, () => {
  assert.throws(() => createReviewSnapshotCandidate(text), ReviewSnapshotInputError);
});
test('size limit applies before parse', () => {
  assert.throws(() => createReviewSnapshotCandidate(' '.repeat(MAX_BYTES + 1)), error => error.code === 'input_too_large');
});
test('UTF-8 byte limit is not a character-count limit', () => {
  assert.throws(() => createReviewSnapshotCandidate('한'.repeat(22000)), error => error.code === 'input_too_large');
});
test('safe parse errors never include arbitrary input content', () => {
  const marker = 'private_fixture_marker';
  assert.throws(() => createReviewSnapshotCandidate(`{"${marker}"`), error => error.code === 'json_invalid' && !error.message.includes(marker));
});
test('fabricated snapshot candidate is not a valid previous input', () => {
  assert.throws(() => compareReviewSnapshotInputs(encode(create(fixture())), encode(fixture())), ReviewSnapshotInputError);
});
test('invalid current input cannot be reported unchanged', () => {
  assert.throws(() => compareReviewSnapshotInputs(encode(fixture()), '{}'), ReviewSnapshotInputError);
});
test('library invocation does not use filesystem, process launch, network or clock APIs', () => {
  const script = `const api = require(process.argv[1]); const input = process.argv[2];
    // Initialize Node's own lazy stdio, promises and crypto dependencies before
    // denying APIs; these setup operations are not calls to the product API.
    const output = process.stdout.write.bind(process.stdout); void process.stderr;
    require('node:assert/strict'); require('node:crypto').createHash('sha256').update('warmup').digest('hex');
    const modules = ['node:fs','node:child_process','node:net','node:http','node:https','node:dns'].map(name => require(name));
    modules.push(...modules.map(mod => mod.promises).filter(Boolean));
    let denials = 0; const denied = () => { denials++; throw Error('unexpected effect'); };
    for (const mod of modules) for (const key of Object.keys(mod)) if (typeof mod[key] === 'function') mod[key] = denied;
    Date.now = denied; Math.random = denied;
    try { modules[0].readFileSync('unused-guard-control'); } catch {}
    if (denials !== 1) throw Error('effect guard inactive'); denials = 0;
    const a = api.createReviewSnapshotCandidate(input); const b = api.compareReviewSnapshotInputs(input,input);
    if (denials !== 0 || b.bindingState !== 'unchanged' || a.approvalReusable !== false) throw Error('invalid result');
    output('no-effects');`;
  const result = spawnSync(process.execPath, ['-e', script, path.resolve(__dirname, '../lib/review-snapshot.js'), encode(fixture())], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || String(result.error || ''));
  assert.equal(result.stdout, 'no-effects');
});

console.log(JSON.stringify({ suite: 'review-snapshot', passed, total, failed: total - passed }));
if (passed !== total) process.exitCode = 1;
