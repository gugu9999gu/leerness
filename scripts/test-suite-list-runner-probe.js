'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { INPUT_SCHEMA, runSuiteList } = require('../lib/test-suite-list-runner');
const { removeTree } = require('./temp-cleanup');

const CLI = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-suite-list-'));
const scripts = path.join(arena, 'scripts');
fs.mkdirSync(scripts);
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); }
}
function wrapper(name, body) {
  fs.writeFileSync(path.join(scripts, name), body, 'utf8');
  return `scripts/${name}`;
}
function listed(name, selected, skipped = []) {
  return wrapper(name, `process.stdout.write(${JSON.stringify(JSON.stringify({ selected, skipped }))});\n`);
}
function request(file, changes = {}) {
  return { schema: INPUT_SCHEMA, execute: true, cwd: '.', wrapperFile: file,
    failedTestId: 'target', timeoutMs: 10000, ...changes };
}
function invoke(input, args = ['test-run', 'suite-list', '--stdin', '--json']) {
  const result = cp.spawnSync(process.execPath, [CLI, ...args], { cwd: arena,
    input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
    timeout: 30000, maxBuffer: 200000, windowsHide: true });
  assert.ifError(result.error);
  return { exit: result.status, data: JSON.parse(result.stdout), stderr: result.stderr };
}

const marker = path.join(arena, 'not-list.marker');
const one = wrapper('one.cjs', `if (!process.argv.includes('--list')) require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran');\n`
  + `process.stdout.write(JSON.stringify({selected:['test:target'],skipped:[['test:old','SENSITIVE_REASON_TOKEN']]}));\n`);
const many = listed('many.cjs', ['test:target', 'test:other', 'parity:third']);
const none = listed('none.cjs', []);
const skipped = listed('skipped.cjs', ['test:other'], [['test:target', 'SENSITIVE_SKIP_REASON']]);
const overlap = listed('overlap.cjs', ['test:target'], [['test:target', 'duplicate']]);
const duplicate = listed('duplicate.cjs', ['test:target', 'test:target']);
const extra = wrapper('extra.cjs', `process.stdout.write(JSON.stringify({selected:['test:target'],skipped:[],passed:true}));\n`);
const noisy = wrapper('noisy.cjs', `process.stdout.write('log\\n'+JSON.stringify({selected:['test:target'],skipped:[]}));\n`);
const badUtf8 = wrapper('utf8.cjs', 'process.stdout.write(Buffer.from([255]));\n');
const overflow = wrapper('overflow.cjs', "process.stdout.write('x'.repeat(70000));\n");
const failing = wrapper('fail.cjs', "console.error('SENSITIVE_ERROR');process.exit(7);\n");
const mutation = wrapper('mutate.cjs', "require('node:fs').writeFileSync(process.argv[1], 'process.exit(0);\\n');"
  + "process.stdout.write(JSON.stringify({selected:['test:target'],skipped:[]}));\n");
const lateMarker = path.join(arena, 'late.marker');
const hanging = wrapper('hang.cjs', `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(lateMarker)},'late'),4000);\n`);
const unicode = listed('한글.cjs', ['test:target']);

(async () => {
  try {
    await test('one listed target is a list observation, never a test pass', async () => {
      const result = invoke(request(one));
      assert.equal(result.exit, 0);
      assert.equal(result.stderr, '');
      assert.equal(result.data.run.executionStatus, 'list-observed');
      assert.equal(result.data.run.targetStatus, 'selected');
      assert.equal(result.data.run.selectedCount, 1);
      assert.equal(result.data.run.skippedCount, 1);
      assert.equal(result.data.run.focusListed, true);
      assert.equal(result.data.run.runnerSelectorVerified, false);
      assert.equal(result.data.run.testPassVerified, false);
      assert.equal(result.data.run.testsNotRunVerified, false);
      assert.equal(result.data.run.finalGatePassed, false);
      assert.equal(result.data.run.evidenceReusable, false);
      assert.ok(!JSON.stringify(result.data).includes('SENSITIVE_REASON_TOKEN'));
      assert.equal(fs.existsSync(marker), false);
    });
    await test('target among many listed entries is not a focused list', async () => {
      const result = invoke(request(many));
      assert.equal(result.exit, 1);
      assert.equal(result.data.run.selectedCount, 3);
      assert.equal(result.data.run.targetStatus, 'selected');
      assert.equal(result.data.run.focusListed, false);
      assert.equal(result.data.run.testPassVerified, false);
    });
    await test('skipped and absent targets remain separate', async () => {
      const ignored = invoke(request(skipped));
      assert.equal(ignored.exit, 1);
      assert.equal(ignored.data.run.targetStatus, 'skipped');
      assert.ok(!JSON.stringify(ignored.data).includes('SENSITIVE_SKIP_REASON'));
      const absent = invoke(request(none));
      assert.equal(absent.exit, 1);
      assert.equal(absent.data.run.targetStatus, 'absent');
      assert.equal(absent.data.run.selectedCount, 0);
    });
    await test('overlap, duplicate names, extra keys and logs invalidate a manifest', async () => {
      for (const file of [overlap, duplicate, extra, noisy]) {
        const result = invoke(request(file));
        assert.equal(result.exit, 1);
        assert.equal(result.data.run.executionStatus, 'manifest-invalid');
        assert.equal(result.data.run.listObserved, false);
      }
    });
    await test('invalid UTF-8 and excessive output cannot become a list', async () => {
      for (const file of [badUtf8, overflow]) {
        const result = invoke(request(file));
        assert.equal(result.exit, 1);
        assert.equal(result.data.run.listObserved, false);
        assert.ok(['manifest-invalid', 'output-limit'].includes(result.data.run.executionStatus));
      }
    });
    await test('wrapper failure does not reveal stderr or count as selection', async () => {
      const result = invoke(request(failing));
      assert.equal(result.exit, 1);
      assert.equal(result.data.run.executionStatus, 'wrapper-failed');
      assert.equal(result.data.run.exitCode, 7);
      assert.ok(!JSON.stringify(result.data).includes('SENSITIVE_ERROR'));
      assert.equal(result.stderr, '');
    });
    await test('changed wrapper during execution invalidates the list', async () => {
      const result = invoke(request(mutation));
      assert.equal(result.exit, 1);
      assert.equal(result.data.run.executionStatus, 'wrapper-changed');
      assert.equal(result.data.run.listObserved, false);
    });
    await test('a Korean wrapper filename stays usable and output-free', async () => {
      const result = invoke(request(unicode));
      assert.equal(result.exit, 0);
      assert.equal(result.data.run.focusListed, true);
    });
    await test('timeout attempts to terminate the wrapper tree', async () => {
      const result = invoke(request(hanging, { timeoutMs: 100 }));
      assert.equal(result.exit, 1);
      assert.equal(result.data.run.executionStatus, 'timeout');
      await new Promise(resolve => setTimeout(resolve, 4200));
      assert.equal(fs.existsSync(lateMarker), false);
    });
    await test('invalid paths, execution flag and extra selectors do not execute', async () => {
      for (const input of [request(one, { execute: false }), request(one, { wrapperFile: '../one.cjs' }),
        request(one, { wrapperFile: 'scripts/one.txt' }), request(one, { failedTestId: 'target;echo' }),
        { ...request(one), extra: 'SENSITIVE_INPUT' }]) {
        const result = invoke(input);
        assert.equal(result.exit, 2);
        assert.ok(!JSON.stringify(result.data).includes('SENSITIVE_INPUT'));
      }
      assert.equal(fs.existsSync(marker), false);
    });
    await test('duplicate JSON keys and unsupported CLI flags fail closed', async () => {
      const source = JSON.stringify(request(one));
      const raw = source.replace('"schema":', '"schema":"other","schema":');
      assert.equal(invoke(raw).data.error.code, 'duplicate_json_key');
      assert.equal(invoke(request(one), ['test-run', 'suite-list', '--bogus', '--json']).exit, 2);
    });
    await test('direct module and CLI report the same focus status', async () => {
      const direct = await runSuiteList(request(one), arena);
      const cli = invoke(request(one));
      assert.equal(direct.focusListed, cli.data.run.focusListed);
      assert.equal(direct.outputDigest, cli.data.run.outputDigest);
    });
  } finally {
    const actual = fs.realpathSync(arena);
    const temp = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(actual).toLowerCase(), temp.toLowerCase());
    assert.ok(path.basename(actual).startsWith('leerness-suite-list-'));
    removeTree(actual, { recursive: true, force: true });
  }
  console.log(`test suite list runner: ${passed}/${passed + failed} passed`);
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
