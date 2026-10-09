'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { INPUT_SCHEMA, runNodeSelection } = require('../lib/test-node-runner');
const { removeTree } = require('./temp-cleanup');

const CLI = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-node-runner-test-'));
const marker = path.join(arena, 'selected-marker');
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); }
}
function request(testFile, testName, changes = {}) {
  return { schema: INPUT_SCHEMA, execute: true, cwd: '.', testFile, testName, timeoutMs: 10000, ...changes };
}
function fixture(name, source) { fs.writeFileSync(path.join(arena, name), source, 'utf8'); }
function invoke(input, argv = ['test-run', 'node', '--stdin', '--json']) {
  const result = cp.spawnSync(process.execPath, [CLI, ...argv], { cwd: arena,
    input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
    timeout: 30000, maxBuffer: 200000, windowsHide: true });
  assert.ifError(result.error);
  return { exit: result.status, data: JSON.parse(result.stdout), stderr: result.stderr };
}
function clearMarker() { if (fs.existsSync(marker)) fs.unlinkSync(marker); }
const append = value => `require('node:fs').appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify(value)});`;
fixture('cases.test.cjs', `const test=require('node:test');\n`
  + `test('alpha',()=>{${append('alpha')}});\n`
  + `test('beta',()=>{${append('beta')}});\n`
  + `test('gamma',()=>{${append('gamma')}});\n`);
fixture('duplicate.test.cjs', `const test=require('node:test');\n`
  + `test('beta',()=>{${append('first')}});\n`
  + `test('beta',()=>{${append('second')}});\n`);
fixture('skip.test.cjs', "require('node:test').skip('beta',()=>{throw Error('must not run')});\n");
fixture('fail.test.cjs', "require('node:test')('beta',()=>{throw Error('SENSITIVE_TEST_OUTPUT')});\n");
fixture('literal.test.cjs', `const test=require('node:test');\n`
  + `test('a.b',()=>{${append('literal')}});\n`
  + `test('axb',()=>{${append('regex')}});\n`);
fixture('unicode.test.cjs', `require('node:test')('한글 검사',()=>{${append('unicode')}});\n`);
fs.mkdirSync(path.join(arena, '검사'));
fixture('검사/한글.test.cjs', `require('node:test')('한글 경로',()=>{${append('unicode-path')}});\n`);
fixture('hang.test.cjs', `const test=require('node:test');\n`
  + `test('beta',async()=>{await new Promise(resolve=>setTimeout(resolve,2000));${append('late')}});\n`);
fixture('many-output.test.cjs', "const test=require('node:test');for(let i=0;i<1000;i++)test('beta',()=>{});\n");
fixture('nested.test.cjs', "require('node:test')('beta',async t=>{await t.test('child',()=>{});});\n");

(async () => {
  try {
    await test('exact selected test runs and other callbacks do not', async () => {
      clearMarker();
      const result = invoke(request('cases.test.cjs', 'beta'));
      assert.equal(result.exit, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.data.run.fixtureSelectionVerified, true);
      assert.equal(result.data.run.selectionStatus, 'exactly-one');
      assert.equal(result.data.run.executionStatus, 'passed');
      assert.equal(result.data.run.selectedCount, 1);
      assert.equal(result.data.run.selectedTestPassed, true);
      assert.equal(result.data.run.projectScriptSelectorVerified, false);
      assert.equal(result.data.run.finalGatePassed, false);
      assert.equal(result.data.run.evidenceReusable, false);
      assert.equal(fs.readFileSync(marker, 'utf8'), 'beta');
    });
    await test('zero matches reject the Node file-level synthetic pass', async () => {
      clearMarker();
      const result = invoke(request('cases.test.cjs', 'missing'));
      assert.equal(result.exit, 1);
      assert.equal(result.data.run.selectionStatus, 'zero-selected');
      assert.equal(result.data.run.selectedCount, 0);
      assert.equal(result.data.run.selectedTestPassed, false);
      assert.equal(fs.existsSync(marker), false);
    });
    await test('duplicate exact names cannot pass as one selected test', async () => {
      clearMarker();
      const result = invoke(request('duplicate.test.cjs', 'beta'));
      assert.equal(result.exit, 1);
      assert.equal(result.data.run.selectionStatus, 'multiple-selected');
      assert.equal(result.data.run.selectedCount, 2);
      assert.equal(fs.readFileSync(marker, 'utf8'), 'firstsecond');
    });
    await test('regex characters in names are matched literally', async () => {
      clearMarker();
      const result = invoke(request('literal.test.cjs', 'a.b'));
      assert.equal(result.exit, 0);
      assert.equal(fs.readFileSync(marker, 'utf8'), 'literal');
    });
    await test('Korean test names survive the input and reporter boundary', async () => {
      clearMarker();
      const result = invoke(request('unicode.test.cjs', '한글 검사'));
      assert.equal(result.exit, 0);
      assert.equal(result.data.run.selectedTestPassed, true);
      assert.equal(fs.readFileSync(marker, 'utf8'), 'unicode');
    });
    await test('Korean test directories and filenames resolve inside the project', async () => {
      clearMarker();
      const result = invoke(request('한글.test.cjs', '한글 경로', { cwd: '검사' }));
      assert.equal(result.exit, 0);
      assert.equal(result.data.run.nodeVersion, process.version);
      assert.equal(fs.readFileSync(marker, 'utf8'), 'unicode-path');
    });
    await test('skipped and failed tests do not become passes or echo errors', async () => {
      const skipped = invoke(request('skip.test.cjs', 'beta'));
      assert.equal(skipped.exit, 1);
      assert.equal(skipped.data.run.executionStatus, 'skipped');
      const failedRun = invoke(request('fail.test.cjs', 'beta'));
      assert.equal(failedRun.exit, 1);
      assert.equal(failedRun.data.run.selectionStatus, 'exactly-one');
      assert.equal(failedRun.data.run.executionStatus, 'failed');
      assert.ok(!JSON.stringify(failedRun.data).includes('SENSITIVE_TEST_OUTPUT'));
      assert.ok(!failedRun.stderr.includes('SENSITIVE_TEST_OUTPUT'));
    });
    await test('nested subtest is not mistaken for exactly one executed case', async () => {
      const result = invoke(request('nested.test.cjs', 'beta'));
      assert.equal(result.exit, 1);
      assert.equal(result.data.run.selectionStatus, 'multiple-selected');
    });
    await test('timeout stops the test process and does not report success', async () => {
      clearMarker();
      const result = invoke(request('hang.test.cjs', 'beta', { timeoutMs: 100 }));
      assert.equal(result.exit, 1);
      assert.equal(result.data.run.executionStatus, 'timeout');
      assert.equal(result.data.run.selectedTestPassed, false);
      await new Promise(resolve => setTimeout(resolve, 2300));
      assert.equal(fs.existsSync(marker), false);
    });
    await test('bounded reporter output fails closed', async () => {
      const result = invoke(request('many-output.test.cjs', 'beta'));
      assert.equal(result.exit, 1);
      assert.equal(result.data.run.executionStatus, 'output-limit');
      assert.equal(result.data.run.selectedTestPassed, false);
    });
    await test('explicit execution, file, path and input schema are required', async () => {
      clearMarker();
      for (const value of [request('cases.test.cjs', 'beta', { execute: false }),
        request('../outside.test.cjs', 'beta'), request('cases.test.cjs', 'beta', { cwd: '../outside' }),
        request('cases.test.cjs', 'beta', { testName: '\uD800' }),
        request('cases.test.cjs', 'beta', { secret: 'NEVER_ECHO' })]) {
        const result = invoke(value);
        assert.equal(result.exit, 2);
        assert.equal(result.data.ok, false);
        assert.ok(!JSON.stringify(result.data).includes('NEVER_ECHO'));
      }
      const raw = JSON.stringify(request('cases.test.cjs', 'beta')).replace('"schema":', '"schema":"other","schema":');
      assert.equal(invoke(raw).data.error.code, 'duplicate_json_key');
      assert.equal(fs.existsSync(marker), false);
    });
    await test('unsupported CLI form and extension cannot execute', async () => {
      assert.equal(invoke(request('cases.test.cjs', 'beta'), ['test-run', 'node', '--bogus', '--json']).exit, 2);
      assert.equal(invoke(request('cases.js', 'beta')).data.error.code, 'test_node_runner_test_file_unsupported');
      assert.equal(invoke(request('missing.test.cjs', 'beta')).data.error.code, 'test_node_runner_test_file_unavailable');
    });
    await test('direct module and CLI agree on one selected result', async () => {
      const result = await runNodeSelection(request('cases.test.cjs', 'beta'), arena);
      assert.equal(result.selectedTestPassed, true);
      assert.equal(result.selectedCount, 1);
    });
    await test('a briefly held selector fixture is waited out, not reported as an unavailable selector', async () => {
      // Windows can refuse the fixture delete while the last child test process exits, and Node 26
      // rmSync does not retry EPERM. Two refusals must not turn into runtime-selector-unavailable.
      const original = fs.rmSync;
      let refused = 0;
      fs.rmSync = function (target, ...rest) {
        if (refused < 2 && path.basename(String(target)).startsWith('leerness-node-selector-')) {
          refused++;
          throw Object.assign(new Error('injected hold'), { code: 'EPERM' });
        }
        return original.call(this, target, ...rest);
      };
      try {
        const result = await runNodeSelection(request('cases.test.cjs', 'beta'), arena);
        assert.equal(refused, 2, `fixture cleanup stopped after ${refused} refusal(s) instead of waiting`);
        assert.equal(result.fixtureSelectionVerified, true, JSON.stringify(result));
        assert.equal(result.selectedTestPassed, true);
      } finally { fs.rmSync = original; }
    });
  } finally {
    const actual = fs.realpathSync(arena);
    const temp = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(actual).toLowerCase(), temp.toLowerCase());
    assert.ok(path.basename(actual).startsWith('leerness-node-runner-test-'));
    removeTree(actual, { recursive: true, force: true });
  }
  console.log(`test node runner: ${passed}/${passed + failed} passed`);
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
