'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { INPUT_SCHEMA: PROBE_SCHEMA, probeNpmScripts } = require('../lib/test-npm-script-probe');
const { INPUT_SCHEMA, runNamedNpmScript } = require('../lib/test-npm-script-runner');
const { removeTree } = require('./temp-cleanup');

const CLI = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-npm-runner-test-'));
const scriptsDir = path.join(arena, 'scripts');
const nested = path.join(arena, 'functions');
fs.mkdirSync(scriptsDir);
fs.mkdirSync(nested);
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); }
}
function marker(name) { return path.join(arena, `${name}.marker`); }
function writeScript(name, body, root = scriptsDir) { fs.writeFileSync(path.join(root, name), body, 'utf8'); }
function packageFile(root = arena) { return path.join(root, 'package.json'); }
function writePackage(scripts, root = arena) { fs.writeFileSync(packageFile(root), JSON.stringify({ name: 'fixture', scripts }), 'utf8'); }
function check(id, changes = {}) {
  return { id, failedTestId: id, argv: ['npm', 'run', `test:${id}`], cwd: '.', timeoutMs: 10000, ...changes };
}
function preflight(row) {
  return probeNpmScripts({ schema: PROBE_SCHEMA, checks: [row] }, arena).results[0];
}
function request(row, options = {}) {
  const probed = preflight(row);
  return { schema: INPUT_SCHEMA, execute: true, check: row,
    commandDigest: probed.commandDigest, packageDigest: probed.packageDigest,
    scriptDigest: probed.scriptDigest, ...options };
}
function invoke(input, args = ['test-run', 'npm-script', '--stdin', '--json']) {
  const result = cp.spawnSync(process.execPath, [CLI, ...args], { cwd: arena,
    input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
    timeout: 30000, maxBuffer: 200000, windowsHide: true });
  assert.ifError(result.error);
  return { exit: result.status, data: JSON.parse(result.stdout), stderr: result.stderr };
}
function exists(name) { return fs.existsSync(marker(name)); }
function clear(...names) { for (const name of names) if (exists(name)) fs.unlinkSync(marker(name)); }

writeScript('one.cjs', `require('node:fs').writeFileSync(${JSON.stringify(marker('one'))},'one');\n`);
writeScript('other.cjs', `require('node:fs').writeFileSync(${JSON.stringify(marker('other'))},'other');\n`);
writeScript('fail.cjs', "console.error('SENSITIVE_TEST_OUTPUT');process.exit(7);\n");
writeScript('hang.cjs', `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker('late'))},'late'),4000);\n`);
writeScript('pre.cjs', `require('node:fs').writeFileSync(${JSON.stringify(marker('pre'))},'pre');\n`);
writeScript('mutate.cjs', `require('node:fs').writeFileSync(${JSON.stringify(packageFile())},'{}');\n`);
writeScript('two.cjs', `require('node:fs').writeFileSync(${JSON.stringify(marker('two'))},'two');\n`, nested);
const SCRIPTS = {
  'test:one': 'node scripts/one.cjs',
  'test:other': 'node scripts/other.cjs',
  'test:multi': 'node scripts/one.cjs && node scripts/other.cjs',
  'test:fail': 'node scripts/fail.cjs',
  'test:hang': 'node scripts/hang.cjs',
  'test:hook': 'node scripts/one.cjs',
  'pretest:hook': 'node scripts/pre.cjs',
  'test:mutate': 'node scripts/mutate.cjs',
};
writePackage(SCRIPTS);
writePackage({ 'test:two': 'node two.cjs' }, nested);

(async () => {
  try {
    await test('one exact npm entry exits zero without claiming one test passed', async () => {
      clear('one', 'other');
      const result = invoke(request(check('one')));
      assert.equal(result.exit, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.data.run.executionStatus, 'exit-zero');
      assert.equal(result.data.run.scriptExitZeroObserved, true);
      assert.equal(result.data.run.runnerSelectorVerified, false);
      assert.equal(result.data.run.testPassVerified, false);
      assert.equal(result.data.run.finalGatePassed, false);
      assert.equal(result.data.run.evidenceReusable, false);
      assert.equal(exists('one'), true);
      assert.equal(exists('other'), false);
    });
    await test('named entry may run more than one underlying command', async () => {
      clear('one', 'other');
      const result = invoke(request(check('multi')));
      assert.equal(result.exit, 0);
      assert.equal(exists('one') && exists('other'), true);
      assert.equal(result.data.run.testPassVerified, false);
      assert.equal(result.data.run.runnerSelectorVerified, false);
    });
    await test('nested package npm script runs in its declared package', async () => {
      clear('two');
      const row = check('two', { argv: ['npm', '--prefix', 'functions', 'run', 'test:two'] });
      const result = invoke(request(row));
      assert.equal(result.exit, 0);
      assert.equal(exists('two'), true);
    });
    await test('npm exit failure and output stay separate from a test pass', async () => {
      const result = invoke(request(check('fail')));
      assert.equal(result.exit, 1);
      assert.equal(result.data.run.executionStatus, 'script-failed');
      assert.equal(result.data.run.exitCode, 7);
      assert.equal(result.data.run.scriptExitZeroObserved, false);
      assert.ok(!JSON.stringify(result.data).includes('SENSITIVE_TEST_OUTPUT'));
      assert.ok(!result.stderr.includes('SENSITIVE_TEST_OUTPUT'));
    });
    await test('changed package or script digest prevents execution', async () => {
      clear('one');
      const original = fs.readFileSync(packageFile());
      const planned = request(check('one'));
      try {
        writePackage({ ...SCRIPTS, 'test:one': 'node scripts/other.cjs' });
        const result = invoke(planned);
        assert.equal(result.exit, 1);
        assert.equal(result.data.run.executionStatus, 'preflight-changed');
        assert.equal(result.data.run.executed, false);
        assert.equal(exists('one'), false);
      } finally { fs.writeFileSync(packageFile(), original); }
    });
    await test('changed command digest prevents execution', async () => {
      clear('one');
      const planned = request(check('one'));
      planned.check.timeoutMs = 9999;
      const result = invoke(planned);
      assert.equal(result.exit, 1);
      assert.equal(result.data.run.executionStatus, 'preflight-changed');
      assert.equal(exists('one'), false);
    });
    await test('npm pre/post lifecycle hooks block the requested script', async () => {
      clear('one', 'pre');
      const probe = preflight(check('hook'));
      assert.equal(probe.lifecycleHooksPresent, true);
      const result = invoke(request(check('hook')));
      assert.equal(result.exit, 1);
      assert.equal(result.data.run.executionStatus, 'lifecycle-hooks-present');
      assert.equal(exists('one') || exists('pre'), false);
    });
    await test('package mutation during execution invalidates the observed exit', async () => {
      const original = fs.readFileSync(packageFile());
      try {
        const result = invoke(request(check('mutate')));
        assert.equal(result.exit, 1);
        assert.equal(result.data.run.executionStatus, 'package-changed');
        assert.equal(result.data.run.exitCode, 0);
        assert.equal(result.data.run.scriptExitZeroObserved, false);
      } finally { fs.writeFileSync(packageFile(), original); }
    });
    await test('bounded timeout stops a delayed npm test process', async () => {
      clear('late');
      const result = invoke(request(check('hang', { timeoutMs: 100 })));
      assert.equal(result.exit, 1);
      assert.equal(result.data.run.executionStatus, 'timeout');
      await new Promise(resolve => setTimeout(resolve, 4200));
      assert.equal(exists('late'), false, JSON.stringify(result.data.run));
    });
    await test('invalid shape and arbitrary selector arguments cannot run', async () => {
      clear('one');
      const planned = request(check('one'));
      for (const input of [{ ...planned, execute: false }, { ...planned, secret: 'DO_NOT_ECHO' },
        { ...planned, check: check('one', { argv: ['npm', 'run', 'test:one', '--', '--filter', 'one'] }) }]) {
        const result = invoke(input);
        assert.equal(result.exit, 2);
        assert.equal(result.data.ok, false);
        assert.ok(!JSON.stringify(result.data).includes('DO_NOT_ECHO'));
      }
      assert.equal(exists('one'), false);
    });
    await test('unavailable npm CLI and missing script do not execute', async () => {
      clear('one');
      const noNpm = await runNamedNpmScript(request(check('one')), arena, { npmCliPath: path.join(arena, 'missing-npm-cli.js') });
      assert.equal(noNpm.executionStatus, 'npm-unavailable');
      assert.equal(noNpm.executed, false);
      const missing = preflight(check('missing'));
      const absent = await runNamedNpmScript({ schema: INPUT_SCHEMA, execute: true, check: check('missing'),
        commandDigest: missing.commandDigest, packageDigest: missing.packageDigest,
        scriptDigest: '0'.repeat(64) }, arena);
      assert.equal(absent.executionStatus, 'script-missing');
      assert.equal(exists('one'), false);
    });
    await test('duplicate JSON keys and unsupported CLI forms fail closed', async () => {
      const planned = request(check('one'));
      const raw = JSON.stringify(planned).replace('"schema":', '"schema":"other","schema":');
      assert.equal(invoke(raw).data.error.code, 'duplicate_json_key');
      assert.equal(invoke(planned, ['test-run', 'npm-script', '--bogus', '--json']).exit, 2);
    });
  } finally {
    const actual = fs.realpathSync(arena);
    const temp = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(actual).toLowerCase(), temp.toLowerCase());
    assert.ok(path.basename(actual).startsWith('leerness-npm-runner-test-'));
    removeTree(actual, { recursive: true, force: true });
  }
  console.log(`test npm script runner: ${passed}/${passed + failed} passed`);
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
