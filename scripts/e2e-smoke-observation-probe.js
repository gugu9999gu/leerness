'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const { performance } = require('node:perf_hooks');
const helper = require('./e2e-child-diagnostics');
const root = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
function check(name, body) {
  try { body(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}
function execute(file, name, result, expectedFailure) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
  const marker = `function ${name}(label, args, opts = {}) {`;
  const start = source.indexOf(marker);
  assert(start >= 0 && source.indexOf(marker, start + marker.length) === -1);
  const end = source.indexOf('\nconsole.log(', start);
  assert(end > start);
  const lines = [], calls = [];
  const context = {
    ...helper, performance, CLI: path.join(root, 'bin/leerness.js'), tmp: root,
    total: 0, failed: 0, console: { log: (...args) => lines.push(args.join(' ')) },
    process: { execPath: process.execPath, stdout: { write: text => lines.push(text) }, stderr: { write: text => lines.push(text) } },
    cp: { spawnSync: (...args) => { calls.push(args); return result; } },
  };
  vm.runInNewContext(source.slice(start, end) + `\nthis.receipt = ${name}('fixture', ['handoff'], {expectFail: ${expectedFailure}});`, context, { timeout: 3000 });
  assert.equal(context.total, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].timeout, 30000, 'original timeout must not be raised');
  return { context, lines };
}
const timeout = cp.spawnSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { encoding: 'utf8', timeout: 300 });
assert.equal(timeout.error?.code, 'ETIMEDOUT');
const missing = cp.spawnSync(path.join(root, 'no-such-smoke-executable'), [], { encoding: 'utf8' });
assert.equal(missing.error?.code, 'ENOENT');
const exited = cp.spawnSync(process.execPath, ['-e', 'process.exitCode = 7'], { encoding: 'utf8', timeout: 5000 });
assert.equal(exited.status, 7);
const rows = [
  ['success', {status: 0, signal: null, stdout: 'healthy', stderr: ''}, false, true],
  ['expected real rejection', exited, true, true],
  ['unexpected real rejection', exited, false, false],
  ['unexpected success', {status: 0, signal: null}, true, false],
  ['native timeout is not expected rejection', timeout, true, false],
  ['native spawn failure is not expected rejection', missing, true, false],
  ['signal termination is not expected rejection', {status: null, signal: 'SIGTERM'}, true, false],
  ['error plus status zero is not success', {status: 0, error: {code: 'ETIMEDOUT'}}, false, false],
  ['error plus nonzero is not expected rejection', {status: 1, error: {code: 'ENOBUFS'}}, true, false],
  ['missing status is not expected rejection', {}, true, false],
  ['negative status is not expected rejection', {status: -1}, true, false],
  ['fractional status is not expected rejection', {status: 0.5}, true, false],
];
for (const [file, name] of [['e2e.js', 'run'], ['smoke.js', 'check']]) {
  for (const [label, result, expectFail, ok] of rows) check(file + ': ' + label, () => {
    const {context} = execute(file, name, result, expectFail);
    assert.equal(context.receipt.ok, ok);
    assert.equal(context.failed, ok ? 0 : 1);
  });
  check(file + ': failure carries bounded child diagnostics', () => {
    const result = {...timeout, stdout: 's'.repeat(900), stderr: 'e'.repeat(900)};
    const {lines} = execute(file, name, result, true);
    const diagnostic = lines.map(line => { try { return JSON.parse(line); } catch { return null; } }).find(x => x?.timeoutMs === 30000);
    assert(diagnostic, 'missing child diagnostics');
    assert.equal(diagnostic.errorCode, 'ETIMEDOUT');
    assert.equal(diagnostic.stdoutBytes, 900);
    assert.equal(diagnostic.stdoutTail.length, 256);
    assert.equal(diagnostic.stderrTail.length, 256);
    assert(Number.isFinite(diagnostic.elapsedMs) && diagnostic.elapsedMs >= 0);
  });
  check(file + ': healthy invocation records time', () => {
    const {lines} = execute(file, name, {status: 0, signal: null}, false);
    assert(lines.some(line => /elapsedMs=\d+/.test(line)));
  });
}
for (const [name, args, env, expected] of [
  ['full mode remains default', [], {}, false],
  ['explicit smoke mode', ['--smoke-only'], {}, true],
  ['full shard remains allowed', [], {LEERNESS_E2E_SHARD: '1/4'}, false],
]) check(name, () => assert.equal(helper.e2eSmokeOnly(args, env), expected));
for (const [name, args, env] of [
  ['unknown argument', ['--smok-only'], {}],
  ['duplicate argument', ['--smoke-only', '--smoke-only'], {}],
  ['smoke plus shard', ['--smoke-only'], {LEERNESS_E2E_SHARD: '1/4'}],
  ['smoke plus shard timing', ['--smoke-only'], {LEERNESS_E2E_TIMES: 'timings.json'}],
]) check('reject ' + name, () => {
  assert.equal(typeof helper.e2eSmokeOnly, 'function');
  assert.throws(() => helper.e2eSmokeOnly(args, env), /smoke|Usage/);
});
function finishContext(smokeOnly, {warning = false, changed = false, initError = false, shardError = false} = {}) {
  const source = fs.readFileSync(path.join(__dirname, 'e2e.js'), 'utf8');
  const start = source.indexOf('function finishE2e() {');
  const end = source.indexOf('function run(label, args, opts = {}) {', start);
  assert(start >= 0 && end > start);
  const lines = [];
  let finished = 0;
  const context = {
    ...helper, smokeOnly, total: 0, failed: 0, _e2eStart: Date.now(),
    runtimeWarningFile: '', runtimeDep0190: warning ? ['owned warning'] : [],
    fs: {existsSync: () => false}, _pkgLeerness: '', _pkgLeernessBefore: new Map(),
    repoGuard: {snapshot: () => new Map(), diff: () => changed ? ['owned-change'] : []},
    _e2eHomeInit: {status: 0, error: initError ? {code: 'ETIMEDOUT'} : undefined},
    process: {stderr: {write() {}}, exitCode: 0},
    console: {log: (...args) => lines.push(args.join(' '))},
    require: name => { assert.equal(name, './temp-cleanup'); return {trackTemp: () => ({active: false})}; },
    module: {},
    e2eShard: {finish: () => { finished++; return {ok: !shardError, spec: null, ran: 4, total: 4, problems: [], missing: [], repeated: [], unknown: []}; }},
  };
  vm.runInNewContext(source.slice(start, end) + '\nfinishE2e();', context, {timeout: 3000});
  return {context, lines, finished};
}
check('smoke finalizer explicitly excludes full E2E and shard coverage', () => {
  const r = finishContext(true);
  assert.equal(r.finished, 0);
  assert.equal(r.context.total, 2);
  assert.equal(r.context.failed, 0);
  assert(r.lines.some(line => /smoke-only \(full E2E not run\)/.test(line)));
});
check('full finalizer still validates the entire shard guard inventory', () => {
  const r = finishContext(false);
  assert.equal(r.finished, 1);
  assert.equal(r.context.total, 3);
  assert.equal(r.context.failed, 0);
  assert(r.lines.some(line => /E2E result: 3\/3 passed/.test(line)));
});
for (const [label, flag, smoke] of [
  ['smoke warnings', 'warning', true], ['smoke repository mutation', 'changed', true],
  ['smoke setup error with status zero', 'initError', true], ['full shard failure', 'shardError', false],
]) check(label + ' remains failure', () => {
  const r = finishContext(smoke, {[flag]: true});
  assert.equal(r.context.failed, 1);
  assert.equal(r.context.process.exitCode, 1);
});
console.log(`Smoke observation controls: ${passed}/${passed + failed} passed`);
process.exitCode = failed ? 1 : 0;
