'use strict';

 
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { shouldRunDoctorSelftest, runDoctorSelftest } = require('../lib/doctor-selftest');
const good = () => ({ pass: 2, total: 2, ok: true, failed: [] });

function fixture(overrides = {}) {
  const calls = { isolated: 0, inline: 0, control: 0, restore: 0 };
  return {
    calls,
    deps: {
      _selfTestReport() { calls.isolated++; return good(); },
      _selfTestCases() { calls.inline++; return [{ name: 'inline', run: () => true }]; },
      _controlSelftestEnv() { calls.control++; return { restore() { calls.restore++; } }; },
      ...overrides,
    },
  };
}

 
 
function doctorFixture(env = {}, uiLang = 'en') {
  const filename = path.resolve(__dirname, '../lib/diagnostics.js');
  const source = fs.readFileSync(filename, 'utf8');
  const realRequire = createRequire(filename);
  const logs = [], writes = [];
  const fakeProcess = {
    env: { ...env }, version: process.version, platform: process.platform, arch: process.arch,
    stdout: { isTTY: false, write: text => { writes.push(text); return true; } },
  };
  const requireForDoctor = id => {
    if (id === './io') return { log: text => logs.push(text) };
    if (['./pure-utils', './npm-process', './portable-process'].includes(id)) return {};
    if (id === 'fs') return { readdirSync: () => [] };
    return realRequire(id);
  };
  const mod = { exports: {} };
  const load = vm.runInThisContext('(function(require, module, exports, process, __filename, __dirname) {\n' + source + '\n})', { filename });
  load(requireForDoctor, mod, mod.exports, fakeProcess, filename, path.dirname(filename));
  const f = fixture();
  const deps = {
    ...f.deps, VERSION: 'test', uiLang, harnessPath: '/fixture/leerness.js',
    has: () => false, _detectShellCtx: () => ({ shell: 'test', psVersion: null }),
    _mcpToolCount: () => 98,
  };
  return { ...f, deps, logs, writes, process: fakeProcess, run: opts => mod.exports.doctorCmd(opts, deps) };
}

test('full selftest requires explicit opt-in; a false library option overrides env', () => {
  for (const value of [undefined, '', '0', 'false', 'true', '01']) {
    assert.equal(shouldRunDoctorSelftest({}, { LEERNESS_DOCTOR_SELFTEST: value }), false);
  }
  assert.equal(shouldRunDoctorSelftest({}, { LEERNESS_DOCTOR_SELFTEST: '1' }), true);
  assert.equal(shouldRunDoctorSelftest({ selftest: true }, {}), true);
  assert.equal(shouldRunDoctorSelftest({ selftest: false }, { LEERNESS_DOCTOR_SELFTEST: '1' }), false);
});

test('default path executes zero isolated, inline, or environment-control callbacks', () => {
  const f = fixture();
  const r = runDoctorSelftest(false, f.deps);
  assert.equal(r.status, 'not_run');
  assert.equal(r.ok, null);
  assert.equal(r.command, 'leerness selftest');
  assert.deepEqual(f.calls, { isolated: 0, inline: 0, control: 0, restore: 0 });
});

test('explicit isolated verification executes exactly once and preserves passing counts', () => {
  const f = fixture();
  assert.deepEqual(runDoctorSelftest(true, f.deps), { ...good(), status: 'passed' });
  assert.deepEqual(f.calls, { isolated: 1, inline: 0, control: 0, restore: 0 });
});

test('subprocess exceptions fail closed without an inline retry', () => {
  const f = fixture();
  f.deps._selfTestReport = () => { f.calls.isolated++; throw new Error('private local path'); };
  const r = runDoctorSelftest(true, f.deps);
  assert.equal(r.status, 'error');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'subprocess_error');
  assert(!JSON.stringify(r).includes('private local path'));
  assert.deepEqual(f.calls, { isolated: 1, inline: 0, control: 0, restore: 0 });
});

const invalidReports = {
  missing: null,
  empty: { pass: 0, total: 0, failed: [], ok: true },
  negative: { pass: -1, total: 1, failed: [], ok: true },
  fractional: { pass: 1.5, total: 2, failed: [], ok: true },
  unsafe: { pass: 0, total: Number.MAX_SAFE_INTEGER + 1, failed: [], ok: false },
  overcount: { pass: 3, total: 2, failed: [], ok: true },
  missingFailures: { pass: 2, total: 2, ok: true },
  unreportedFailure: { pass: 1, total: 2, failed: [], ok: false },
  falseSuccess: { pass: 1, total: 2, failed: ['failed'], ok: true },
  contradictoryOk: { pass: 2, total: 2, failed: [], ok: false },
  nonBooleanOk: { pass: 2, total: 2, failed: [], ok: 'true' },
  invalidName: { pass: 1, total: 2, failed: [null], ok: false },
  blankName: { pass: 1, total: 2, failed: [' '], ok: false },
};
for (const [name, value] of Object.entries(invalidReports)) {
  test('invalid report (' + name + ') fails without rerunning any suite', () => {
    const f = fixture();
    f.deps._selfTestReport = () => { f.calls.isolated++; return value; };
    const r = runDoctorSelftest(true, f.deps);
    assert.equal(r.status, 'error');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'invalid_report');
    assert.deepEqual(f.calls, { isolated: 1, inline: 0, control: 0, restore: 0 });
  });
}

test('a valid failed report stays failed and does not expose mutable input arrays', () => {
  const input = { pass: 1, total: 2, ok: false, failed: ['failing case'] };
  const r = runDoctorSelftest(true, { _selfTestReport: () => input });
  assert.equal(r.status, 'failed');
  assert.equal(r.ok, false);
  input.failed.push('later mutation');
  assert.deepEqual(r.failed, ['failing case']);
});

test('requesting tests without a runner cannot report success', () => {
  assert.equal(runDoctorSelftest(true).reason, 'runner_unavailable');
});

test('explicit inline DI cases preserve failures and restore the controlled environment once', () => {
  const f = fixture({ _selfTestReport: undefined });
  f.deps._selfTestCases = () => {
    f.calls.inline++;
    return [
      { name: 'pass', run: () => true },
      { name: 'false', run: () => false },
      { name: 'throw', run: () => { throw new Error('failure'); } },
    ];
  };
  const r = runDoctorSelftest(true, f.deps);
  assert.deepEqual(r, { status: 'failed', pass: 1, total: 3, ok: false, failed: ['false', 'throw'] });
  assert.deepEqual(f.calls, { isolated: 0, inline: 1, control: 1, restore: 1 });
});

test('a Promise is not a passing synchronous case', async () => {
  const r = runDoctorSelftest(true, {
    _selfTestCases: () => [{ name: 'async case', run: () => Promise.reject(new Error('async failure')) }],
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failed, ['async case']);
  await new Promise(resolve => setImmediate(resolve));
});

for (const cases of [[], null, [null], [{ name: '', run() {} }], [{ name: 'missing run' }]]) {
  test('invalid inline suite is not a zero-test success: ' + JSON.stringify(cases), () => {
    const f = fixture({ _selfTestReport: undefined, _selfTestCases: () => cases });
    assert.equal(runDoctorSelftest(true, f.deps).reason, 'invalid_cases');
    assert.equal(f.calls.restore, 1);
  });
}

test('suite enumeration failure restores the environment and remains an error', () => {
  const f = fixture({ _selfTestReport: undefined, _selfTestCases: () => { throw new Error('enumeration'); } });
  assert.equal(runDoctorSelftest(true, f.deps).reason, 'inline_execution_error');
  assert.equal(f.calls.restore, 1);
});

test('environment setup and restore failures cannot report success', () => {
  const setup = fixture({ _selfTestReport: undefined, _controlSelftestEnv: () => { throw new Error('setup'); } });
  assert.equal(runDoctorSelftest(true, setup.deps).reason, 'inline_execution_error');
  assert.equal(setup.calls.inline, 0);
  const restore = fixture({ _selfTestReport: undefined, _controlSelftestEnv: () => ({ restore() { throw new Error('restore'); } }) });
  assert.equal(runDoctorSelftest(true, restore.deps).reason, 'environment_restore_error');
});

test('doctor JSON marks unverified core health as unknown, not healthy or failed', () => {
  const f = doctorFixture();
  const r = f.run({ json: true });
  assert.equal(r.healthy, null);
  assert.equal(r.selftest.status, 'not_run');
  assert.equal(r.diagnosisScope, 'environment');
  assert.equal(r.mcpTools, 98);
  assert.deepEqual(JSON.parse(f.writes.join('')), r);
  assert.equal(f.process.exitCode, undefined);
  assert.deepEqual(f.calls, { isolated: 0, inline: 0, control: 0, restore: 0 });
});

for (const [lang, notRun, falseSuccess] of [
  ['en', 'selftest not run', 'leerness install OK'],
  ['ko', 'selftest 미실행', 'leerness 설치 정상'],
]) {
  test('doctor text clearly distinguishes unverified health (' + lang + ')', () => {
    const f = doctorFixture({}, lang);
    f.run({});
    const text = f.logs.join('\n');
    assert(text.includes(notRun));
    assert(text.includes('leerness selftest'));
    assert(!text.includes(falseSuccess));
    assert(!text.includes('0/0'));
    assert.equal(f.process.exitCode, undefined);
  });
}

test('doctor explicit env opt-in reports verified success with a single isolated call', () => {
  const f = doctorFixture({ LEERNESS_DOCTOR_SELFTEST: '1' });
  const r = f.run({ json: true });
  assert.equal(r.healthy, true);
  assert.equal(r.diagnosisScope, 'environment+selftest');
  assert.equal(f.calls.isolated, 1);
  assert.equal(f.calls.inline, 0);
});

test('doctor library option can opt in or override an ambient opt-in', () => {
  const enabled = doctorFixture();
  assert.equal(enabled.run({ json: true, selftest: true }).healthy, true);
  const disabled = doctorFixture({ LEERNESS_DOCTOR_SELFTEST: '1' });
  assert.equal(disabled.run({ json: true, selftest: false }).healthy, null);
  assert.equal(disabled.calls.isolated, 0);
});

test('doctor error is nonzero, never falls back, and does not render a fake zero-test pass', () => {
  const f = doctorFixture({ LEERNESS_DOCTOR_SELFTEST: '1' });
  f.deps._selfTestReport = () => { f.calls.isolated++; throw new Error('timeout'); };
  const r = f.run({});
  assert.equal(r.healthy, false);
  assert.equal(f.process.exitCode, 1);
  assert.equal(f.calls.inline, 0);
  assert(f.logs.join('\n').includes('selftest execution error'));
  assert(!f.logs.join('\n').includes('0/0'));
});

test('doctor valid failed JSON sets a nonzero exit code and preserves failing case names', () => {
  const f = doctorFixture();
  f.deps._selfTestReport = () => ({ pass: 1, total: 2, ok: false, failed: ['regression'] });
  const r = f.run({ json: true, selftest: true });
  assert.equal(r.healthy, false);
  assert.equal(f.process.exitCode, 1);
  assert.deepEqual(JSON.parse(f.writes.join('')).selftest.failed, ['regression']);
});

test('routine diagnosis does not clear an existing process failure', () => {
  const f = doctorFixture();
  f.process.exitCode = 7;
  f.run({ json: true });
  assert.equal(f.process.exitCode, 7);
});
