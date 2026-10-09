'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../bin/leerness');
const { INPUT_SCHEMA, TestExecutionInputError, planTestExecution } = require('../lib/test-execution-plan');
const { removeTree } = require('./temp-cleanup');
const cli = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-test-plan-'));
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); }
}
function check(id, stage, changes = {}) {
  return { id, stage, argv: ['npm', 'run', id], cwd: '.', timeoutMs: 300000,
    testIds: [], relatedTo: [], coverageIds: [], prerequisites: [], ...changes };
}
function input() {
  return { schema: INPUT_SCHEMA,
    checks: [
      check('focused-a', 'focused', { testIds: ['failed-a'], prerequisites: ['emulator'] }),
      check('focused-b', 'focused', { testIds: ['failed-b'] }),
      check('related-a', 'related', { relatedTo: ['focused-a'], coverageIds: ['functions'] }),
      check('related-b', 'related', { relatedTo: ['focused-b'], coverageIds: ['other'] }),
      check('final', 'final', { coverageIds: ['functions', 'api'], timeoutMs: 7200000 }),
    ], failedTestIds: ['failed-a'], requiredCoverage: ['functions', 'api'], readiness: [{ id: 'emulator', status: 'ready' }] };
}
function invoke(value, args = ['test-plan', 'assess', '--stdin', '--json']) {
  const result = cp.spawnSync(process.execPath, [cli, ...args], { cwd: arena,
    input: typeof value === 'string' ? value : JSON.stringify(value), encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.ifError(result.error);
  return { exit: result.status, data: JSON.parse(result.stdout) };
}
try {
  test('installed Korean and English strategy points to the read-only planner', () => {
    for (const lang of ['ko', 'en']) {
      const files = core.coreFiles(arena, lang);
      assert.ok(files['.leerness/testing-strategy.md'].includes('leerness test-plan assess --stdin --json'));
      assert.ok(files['.leerness/testing-strategy.md'].includes('leerness test-plan probe --stdin --json'));
      assert.ok(files['.leerness/testing-strategy.md'].includes('leerness test-plan http-probe --stdin --json'));
      assert.ok(files['.leerness/testing-strategy.md'].includes('leerness test-plan script-probe --stdin --json'));
      assert.ok(files['.leerness/testing-strategy.md'].includes('leerness test-run node --stdin --json'));
      assert.ok(files['.leerness/testing-strategy.md'].includes(lang === 'ko'
        ? '어느 명령도 테스트를 실행하거나' : 'None runs tests'));
    }
  });
  test('failed test selects only its focused check, mapped related check and every final gate', () => {
    const p = planTestExecution(input());
    assert.deepEqual(p.stages.focused.map(x => x.checkId), ['focused-a']);
    assert.deepEqual(p.stages.related.map(x => x.checkId), ['related-a']);
    assert.deepEqual(p.stages.final.map(x => x.checkId), ['final']);
    assert.deepEqual(p.notSelectedCheckIds, ['focused-b', 'related-b']);
    assert.equal(p.status, 'advisory-plan');
    assert.deepEqual(p.unrunCheckIds, ['focused-a', 'related-a', 'final']);
    assert.equal(p.finalGatePassed, false);
    assert.equal(p.evidenceReusable, false);
  });
  test('zero or unmapped failures are rejected rather than treated as a pass', () => {
    const shuffled = input(); shuffled.checks.reverse();
    assert.deepEqual(planTestExecution(shuffled).unrunCheckIds, ['focused-a', 'related-a', 'final']);
    const empty = input(); empty.failedTestIds = [];
    assert.throws(() => planTestExecution(empty), TestExecutionInputError);
    const unknown = input(); unknown.failedTestIds = ['not-registered'];
    assert.throws(() => planTestExecution(unknown), error => error.code === 'test_plan_test_unmapped');
  });
  test('ambiguous selectors are rejected rather than running an arbitrary check', () => {
    const value = input(); value.checks[1].testIds = ['failed-a'];
    assert.throws(() => planTestExecution(value), error => error.code === 'test_plan_test_ambiguous');
  });
  test('test IDs on a non-focused check are rejected as misleading', () => {
    const value = input(); value.checks[2].testIds = ['failed-a'];
    assert.throws(() => planTestExecution(value), error => error.code === 'test_plan_focused_tests_only');
  });
  test('missing final coverage remains visible and blocks a complete plan', () => {
    const value = input(); value.checks[4].coverageIds = ['functions'];
    const p = planTestExecution(value);
    assert.equal(p.status, 'incomplete-final-coverage');
    assert.deepEqual(p.uncoveredRequiredCoverage, ['api']);
    assert.equal(p.coverageVerified, false);
  });
  test('unavailable declared service blocks affected checks without claiming a live probe', () => {
    const value = input(); value.readiness[0].status = 'unavailable';
    const p = planTestExecution(value);
    assert.equal(p.status, 'declared-prerequisite-blocked');
    assert.deepEqual(p.blockedCheckIds, ['focused-a']);
    assert.equal(p.readinessVerified, false);
  });
  test('missing related mapping is explicit, not silently considered complete', () => {
    const value = input(); value.checks = value.checks.filter(x => x.id !== 'related-a');
    const p = planTestExecution(value);
    assert.equal(p.status, 'needs-related-review');
    assert.equal(p.needsRelatedReview, true);
  });
  test('unknown prerequisite and escaping cwd are rejected', () => {
    const missing = input(); missing.checks[0].prerequisites = ['ghost'];
    assert.throws(() => planTestExecution(missing), error => error.code === 'test_plan_prerequisite_missing');
    const escape = input(); escape.checks[0].cwd = '../outside';
    assert.throws(() => planTestExecution(escape), error => error.code === 'test_plan_cwd_invalid');
  });
  test('CLI does not execute declared argv or echo command content', () => {
    const value = input();
    const marker = path.join(arena, 'SHOULD-NOT-EXIST');
    value.checks[0].argv = ['node', '-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'secret')`];
    const result = invoke(value);
    assert.equal(result.exit, 0);
    assert.equal(result.data.plan.executed, false);
    assert.equal(fs.existsSync(marker), false);
    assert.ok(!JSON.stringify(result.data).includes(marker));
    assert.ok(!JSON.stringify(result.data).includes('secret'));
  });
  test('CLI rejects duplicate JSON keys with a bounded error', () => {
    const raw = JSON.stringify(input()).replace('"schema":', '"schema":"other","schema":');
    const result = invoke(raw);
    assert.equal(result.exit, 2);
    assert.equal(result.data.error.code, 'duplicate_json_key');
  });
  test('invalid command syntax is refused before stdin is assessed', () => {
    const result = invoke(input(), ['test-plan', 'assess', '--bogus', '--json']);
    assert.equal(result.exit, 2);
    assert.equal(result.data.error.code, 'invalid_cli_arguments');
  });
  test('opaque command digest changes with argv but does not certify execution', () => {
    const a = planTestExecution(input());
    const value = input(); value.checks[0].argv[2] = 'changed';
    const b = planTestExecution(value);
    assert.notEqual(a.stages.focused[0].commandDigest, b.stages.focused[0].commandDigest);
    assert.equal(b.commandVerified, false);
    assert.equal(b.finalGatePassed, false);
  });
  test('valid and rejected CLI calls leave an unrelated project file unchanged', () => {
    const marker = path.join(arena, 'keep.txt'); fs.writeFileSync(marker, 'owner data\n');
    const before = fs.readFileSync(marker);
    invoke(input()); invoke('{not-json');
    assert.deepEqual(fs.readFileSync(marker), before);
  });
  test('documented example parses and reports the declared service gap', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'test-execution-plan.md'), 'utf8');
    const example = JSON.parse(doc.match(/```json\n([\s\S]*?)\n```/)[1]);
    const result = planTestExecution(example);
    assert.equal(result.status, 'declared-prerequisite-blocked');
    assert.deepEqual(result.unrunCheckIds, ['auth-unit', 'auth-related', 'required-ci']);
  });
} finally {
  const resolved = fs.realpathSync(arena);
  assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(resolved).startsWith('leerness-test-plan-'));
  removeTree(resolved, { recursive: true, force: true });
}
console.log(`test execution plan: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
