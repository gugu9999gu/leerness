'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { INPUT_SCHEMA, probeNpmScripts } = require('../lib/test-npm-script-probe');
const { removeTree } = require('./temp-cleanup');

const cli = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-test-script-'));
const marker = path.join(arena, 'SHOULD-NOT-RUN');
fs.mkdirSync(path.join(arena, 'functions'));
fs.writeFileSync(path.join(arena, 'package.json'), JSON.stringify({ name: 'fixture', scripts: {
  'test:one': `node -e "require('fs').writeFileSync('${marker.replaceAll('\\', '/')}','ran')"`,
  'pretest:one': `node -e "require('fs').writeFileSync('${marker.replaceAll('\\', '/')}','pre')"`,
  'test:functions-suite': 'node scripts/run-all.js',
} }));
fs.writeFileSync(path.join(arena, 'functions', 'package.json'), JSON.stringify({ scripts: {
  'test:two': 'node scripts/test-two.js',
} }));
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); }
}
function check(id, failedTestId = id, changes = {}) {
  return { id, failedTestId, argv: ['npm', 'run', `test:${failedTestId}`], cwd: '.', timeoutMs: 60000, ...changes };
}
function input(...checks) { return { schema: INPUT_SCHEMA, checks }; }
function invoke(value, args = ['test-plan', 'script-probe', '--stdin', '--json']) {
  const result = cp.spawnSync(process.execPath, [cli, ...args], { cwd: arena,
    input: typeof value === 'string' ? value : JSON.stringify(value), encoding: 'utf8',
    timeout: 15000, windowsHide: true });
  assert.ifError(result.error);
  return { exit: result.status, data: JSON.parse(result.stdout), stderr: result.stderr };
}
try {
  test('exact root and nested npm scripts resolve without running their bodies', () => {
    const result = probeNpmScripts(input(check('one'), check('two', 'two', {
      argv: ['npm', '--prefix', 'functions', 'run', '--silent', 'test:two'],
    })), arena);
    assert.deepEqual(result.results.map(row => row.status), ['named-script-present', 'named-script-present']);
    assert.deepEqual(result.results.map(row => row.packageDir), ['.', 'functions']);
    assert.equal(result.allNamedScriptsPresent, true);
    assert.deepEqual(result.results.map(row => row.lifecycleHooksPresent), [true, false]);
    assert.equal(result.executed, false);
    assert.equal(result.runnerSelectorVerified, false);
    assert.equal(result.coverageVerified, false);
    assert.equal(result.finalGatePassed, false);
    assert.equal(result.evidenceReusable, false);
    assert.equal(fs.existsSync(marker), false);
  });
  test('missing named script is visible and is never turned into a pass', () => {
    const result = probeNpmScripts(input(check('missing')), arena);
    assert.equal(result.results[0].status, 'script-missing');
    assert.equal(result.results[0].scriptDigest, null);
    assert.equal(result.allNamedScriptsPresent, false);
  });
  test('extra filter arguments are rejected even when the suite script exists', () => {
    const attempted = check('suite', 'functions-suite', {
      argv: ['npm', 'run', 'test:functions-suite', '--', '--filter', 'one'],
    });
    const result = invoke(input(attempted));
    assert.equal(result.exit, 2);
    assert.equal(result.data.error.code, 'test_script_selector_unsupported');
    assert.equal(fs.existsSync(marker), false);
  });
  test('script name must match the failed test ID exactly', () => {
    const result = invoke(input(check('one', 'one', { argv: ['npm', 'run', 'test:functions-suite'] })));
    assert.equal(result.exit, 2);
    assert.equal(result.data.error.code, 'test_script_script_name_mismatch');
  });
  test('CLI reports present scripts but does not echo script bodies or execute them', () => {
    const result = invoke(input(check('one')));
    assert.equal(result.exit, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.data.scriptProbe.results[0].status, 'named-script-present');
    assert.ok(!JSON.stringify(result.data).includes('SHOULD-NOT-RUN'));
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(path.join(arena, '.leerness')), false);
  });
  test('command digest equals planner digest but is not execution evidence', () => {
    const selected = check('one');
    const result = probeNpmScripts(input(selected), arena);
    const expected = createHash('sha256').update(JSON.stringify([selected.argv, selected.cwd, selected.timeoutMs])).digest('hex');
    assert.equal(result.results[0].commandDigest, expected);
    assert.equal(result.results[0].executionStatus, 'not-run');
  });
  test('named script resolution handles a package larger than the stdin limit', () => {
    const target = path.join(arena, 'functions', 'package.json');
    const original = fs.readFileSync(target);
    try {
      fs.writeFileSync(target, JSON.stringify({ description: 'x'.repeat(70000), scripts: { 'test:two': 'node two.js' } }));
      const result = probeNpmScripts(input(check('two', 'two', { cwd: 'functions' })), arena);
      assert.equal(result.results[0].status, 'named-script-present');
      fs.writeFileSync(target, JSON.stringify({ description: 'x'.repeat(270000), scripts: { 'test:two': 'node two.js' } }));
      assert.equal(invoke(input(check('two', 'two', { cwd: 'functions' }))).data.error.code,
        'test_script_package_too_large');
    } finally { fs.writeFileSync(target, original); }
  });
  test('malformed or duplicate package keys and invalid script values fail closed', () => {
    const target = path.join(arena, 'functions', 'package.json');
    const original = fs.readFileSync(target);
    const nested = input(check('two', 'two', { cwd: 'functions' }));
    try {
      for (const bytes of [Buffer.from([0xff]),
        Buffer.from('{"scripts":{"test:two":"one","test:two":"two"}}'),
        Buffer.from('{"scripts":{"test:two":null}}')]) {
        fs.writeFileSync(target, bytes);
        const result = invoke(nested);
        assert.equal(result.exit, 2);
        assert.ok(['test_script_package_invalid', 'test_script_script_invalid'].includes(result.data.error.code));
      }
    } finally { fs.writeFileSync(target, original); }
  });
  test('path escape, arbitrary runner and npm selector flags are not inspected', () => {
    for (const changes of [{ cwd: '../outside' }, { argv: ['node', 'scripts/test-one.js'] },
      { argv: ['npm', 'run', 'test:one', '--test-name-pattern=one'] },
      { argv: ['npm', '--prefix', '../outside', 'run', 'test:one'] }]) {
      const result = invoke(input(check('one', 'one', changes)));
      assert.equal(result.exit, 2);
      assert.ok(result.data.error.code.startsWith('test_script_'));
    }
  });
  test('duplicate IDs, invalid input fields and duplicate JSON keys fail closed', () => {
    const duplicate = invoke(input(check('one'), check('one')));
    assert.equal(duplicate.data.error.code, 'test_script_id_duplicate');
    const field = invoke(input(check('one', 'one', { secret: 'do not echo' })));
    assert.equal(field.data.error.code, 'test_script_fields_invalid');
    assert.ok(!JSON.stringify(field.data).includes('do not echo'));
    const raw = JSON.stringify(input(check('one'))).replace('"schema":', '"schema":"other","schema":');
    assert.equal(invoke(raw).data.error.code, 'duplicate_json_key');
  });
  test('batch and CLI flags are bounded', () => {
    const batch = invoke(input(...Array.from({ length: 33 }, (_, i) => check(`id-${i}`))));
    assert.equal(batch.data.error.code, 'test_script_checks_invalid');
    const flags = invoke(input(check('one')), ['test-plan', 'script-probe', '--bogus', '--json']);
    assert.equal(flags.data.error.code, 'invalid_cli_arguments');
  });
} finally {
  const resolved = fs.realpathSync(arena);
  assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(resolved).startsWith('leerness-test-script-'));
  removeTree(resolved, { recursive: true, force: true });
}
console.log(`test npm script probe: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
