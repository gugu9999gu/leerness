#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module);  

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { performance } = require('perf_hooks');
const { resolvePortableLaunch } = require('../lib/portable-process');

function fallbackLocatorCases() {
  const vm = require('vm'), source = fs.readFileSync(require.resolve('../lib/portable-process'), 'utf8');
  let passed = 0, failed = 0;
  function model(supplied = {}, inherited = { SystemRoot: 'C:\\root-a' }) {
    const calls = [], state = { unavailable: false };
    const realpathSync = value => value;
    realpathSync.native = value => value;
    const fakeFs = { realpathSync, readdirSync: () => ['git.exe'], statSync: file => {
      if (state.unavailable && String(file).endsWith('where.exe')) throw Object.assign(new Error('absent'), { code: 'ENOENT' });
      return { isFile: () => true, dev: 1n, ino: 2n, size: 3n, mtimeNs: 4n, ctimeNs: 5n };
    } };
    const processModel = { platform: 'win32', execPath: 'C:\\node.exe', cwd: () => 'C:\\project', env: { ...inherited } };
    const fakeCp = { spawnSync: file => { calls.push(file); return { status: 0, stdout: 'C:\\lookup\\git.exe\n' }; } };
    const moduleModel = { exports: {} };
    vm.runInNewContext(source, { module: moduleModel, exports: moduleModel.exports, process: processModel,
      require: name => name === 'fs' ? fakeFs : name === 'child_process' ? fakeCp : name === './process-deadline' ? require('../lib/process-deadline') : require(name), Buffer }, { filename: 'portable-process-fallback-model.js' });
    const env = { PATH: 'C:\\lookup', PATHEXT: '.EXE', ...supplied };
    const lookup = () => moduleModel.exports.resolvePortableLaunch('git', { env, cwd: 'C:\\project', deadlineAt: performance.now() + 10000 });
    return { calls, state, processModel, lookup };
  }
  function test(name, action) {
    try { action(); passed++; console.log('PASS fallback ' + name); }
    catch (error) { failed++; console.error('FAIL fallback ' + name + '\n' + error.stack); }
  }
  test('omitted roots follow SystemRoot changes and switchback', () => {
    const f = model(); f.lookup(); f.processModel.env.SystemRoot = 'C:\\root-b'; f.lookup(); f.processModel.env.SystemRoot = 'C:\\root-a'; f.lookup();
    assert.deepStrictEqual(f.calls, ['C:\\root-a\\System32\\where.exe', 'C:\\root-b\\System32\\where.exe', 'C:\\root-a\\System32\\where.exe']);
  });
  test('omitted roots follow WINDIR changes and switchback', () => {
    const f = model({}, { WINDIR: 'C:\\wind-a' }); f.lookup(); f.processModel.env.WINDIR = 'C:\\wind-b'; f.lookup(); f.processModel.env.WINDIR = 'C:\\wind-a'; f.lookup();
    assert.deepStrictEqual(f.calls, ['C:\\wind-a\\System32\\where.exe', 'C:\\wind-b\\System32\\where.exe', 'C:\\wind-a\\System32\\where.exe']);
  });
  test('supplied WINDIR takes precedence over inherited SystemRoot', () => {
    const f = model({ WINDIR: 'C:\\supplied' }); f.lookup(); f.processModel.env.SystemRoot = 'C:\\root-b'; f.lookup();
    assert.deepStrictEqual(f.calls, ['C:\\supplied\\System32\\where.exe']);
  });
  test('supplied SystemRoot takes precedence over all fallback values', () => {
    const f = model({ SystemRoot: 'C:\\supplied', WINDIR: 'C:\\ignored' }); f.lookup(); f.processModel.env = { SystemRoot: 'C:\\root-b', WINDIR: 'C:\\wind-b' }; f.lookup();
    assert.deepStrictEqual(f.calls, ['C:\\supplied\\System32\\where.exe']);
  });
  test('unavailable inherited locator refuses and clears prior launch', () => {
    const f = model(); f.lookup(); f.processModel.env.SystemRoot = 'C:\\unavailable'; f.state.unavailable = true;
    assert.throws(f.lookup, error => error.code === 'E_COMMAND_LOOKUP');
    f.processModel.env.SystemRoot = 'C:\\root-a'; f.state.unavailable = false; f.lookup();
    assert.deepStrictEqual(f.calls, ['C:\\root-a\\System32\\where.exe', 'C:\\root-a\\System32\\where.exe']);
  });
  test('empty supplied roots preserve inherited precedence and switchback', () => {
    const f = model({ SystemRoot: '', WINDIR: '' }, { SystemRoot: '', WINDIR: 'C:\\wind-a' }); f.lookup();
    f.processModel.env.SystemRoot = 'C:\\root-b'; f.lookup(); f.processModel.env.SystemRoot = ''; f.lookup();
    assert.deepStrictEqual(f.calls, ['C:\\wind-a\\System32\\where.exe', 'C:\\root-b\\System32\\where.exe', 'C:\\wind-a\\System32\\where.exe']);
  });
  console.log(`git-resolution-cache fallback model: ${passed}/${passed + failed} passed; actual processes launched: 0`);
  if (failed) process.exitCode = 1;
}

if (process.platform !== 'win32') {
  console.log('git-resolution-cache: Windows-only locator check skipped');
  process.exit(0);
}
if (process.argv.includes('--fallback-only')) { fallbackLocatorCases(); return; }

const systemWhere = path.join(process.env.SystemRoot || process.env.WINDIR || '', 'System32', 'where.exe');
const located = cp.spawnSync(systemWhere, ['git'], { encoding: 'utf8', shell: false });
assert.strictEqual(located.status, 0, 'real Git must be available for this Windows probe');
const realGit = String(located.stdout).split(/\r?\n/).find(candidate => /[\\/]git\.(?:exe|com)$/i.test(candidate));
assert(realGit && fs.statSync(realGit).isFile(), 'a native Git executable must be available');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-git-cache-'));
const early = path.join(sandbox, 'early');
const other = path.join(sandbox, 'other');
const cwd = path.join(sandbox, 'cwd');
const realGitDir = path.dirname(realGit);
const fakeGit = path.join(early, 'git.exe');
const cwdShadow = path.join(cwd, 'git.exe');
const linkedCwd = path.join(sandbox, 'linked-cwd');
for (const dir of [early, other, cwd]) fs.mkdirSync(dir);

function withPath(dirs) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  env.Path = dirs.join(path.delimiter);
  return env;
}

function samePath(left, right) {
  const canonical = value => {
    try { return fs.realpathSync.native(value).toLowerCase(); }
    catch { return path.resolve(value).toLowerCase(); }
  };
  return canonical(left) === canonical(right);
}

const originalSpawnSync = cp.spawnSync;
let whereCalls = 0;
cp.spawnSync = function countedSpawnSync(file, ...args) {
  if (samePath(file, systemWhere)) whereCalls++;
  return originalSpawnSync.call(this, file, ...args);
};

try {
  const env = withPath([early, realGitDir]);
  const lookup = (workdir = cwd, currentEnv = env) =>
    resolvePortableLaunch('git', { cwd: workdir, env: currentEnv });
  const first = lookup();
  assert(samePath(first.file, realGit), 'the first lookup must use the trusted PATH Git');
  assert.strictEqual(whereCalls, 1);
  first.file = fakeGit;
  first.argsPrefix.push('--unsafe');
  const exposed = lookup();
  assert(samePath(exposed.file, realGit), 'the unchanged lookup must preserve the Git location');
  assert.strictEqual(whereCalls, 1, 'the unchanged lookup should reuse the verified location');
  exposed.file = fakeGit;
  exposed.argsPrefix.push('--unsafe');
  const afterCallerMutation = lookup();
  assert(samePath(afterCallerMutation.file, realGit), 'a caller cannot replace the cached executable');
  assert.deepStrictEqual(afterCallerMutation.argsPrefix, [], 'a caller cannot add cached Git arguments');
  assert.strictEqual(whereCalls, 1);

  fs.writeFileSync(fakeGit, 'first');
  assert(samePath(lookup().file, fakeGit), 'a new earlier PATH candidate must invalidate the cache');
  assert.strictEqual(whereCalls, 2);
  fs.writeFileSync(fakeGit, 'replaced with different content');
  assert(samePath(lookup().file, fakeGit), 'a changed candidate must be checked again');
  assert.strictEqual(whereCalls, 3);
  fs.unlinkSync(fakeGit);
  assert(samePath(lookup().file, realGit), 'removing the candidate must restore the original Git');
  assert.strictEqual(whereCalls, 4);

  fs.writeFileSync(cwdShadow, 'untrusted current directory');
  assert(samePath(lookup(cwd, env).file, realGit), 'a cwd-only Git shadow must stay excluded');
  assert.strictEqual(whereCalls, 4, 'a cwd shadow must not force a new location check');

  const changedEnv = withPath([other, realGitDir]);
  assert(samePath(lookup(cwd, changedEnv).file, realGit), 'changing PATH must trigger a lookup');
  assert.strictEqual(whereCalls, 5);
  assert(samePath(lookup(cwd, env).file, realGit), 'switching back to the original PATH must still be safe');
  assert.strictEqual(whereCalls, 6, 'switching back to the original environment must recheck the locator');
  assert(samePath(lookup(cwd, env).file, realGit));
  assert.strictEqual(whereCalls, 6, 'a cwd shadow must not force repeated location checks');
  assert(samePath(lookup(realGitDir, env).file, realGit), 'a cwd on PATH must be resolved separately');
  assert.strictEqual(whereCalls, 7);
  fs.writeFileSync(fakeGit, 'earlier PATH Git');
  fs.symlinkSync(cwd, linkedCwd, 'junction');
  assert(samePath(lookup(linkedCwd, env).file, fakeGit), 'the junction initially uses the earlier PATH Git');
  assert.strictEqual(whereCalls, 8);
  fs.rmdirSync(linkedCwd);
  fs.symlinkSync(realGitDir, linkedCwd, 'junction');
  const retargeted = lookup(linkedCwd, env);
  assert(samePath(retargeted.file, realGit), 'a retargeted cwd junction must recheck cwd-first selection');
  assert.strictEqual(whereCalls, 9);
  console.log('git-resolution-cache: 14 Windows path, replacement, and cwd checks passed');

  let passed = 0, failed = 0;
  function test(name, action) {
    try { action(); passed++; console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
  }
  function fresh() {
    delete require.cache[require.resolve('../lib/portable-process')];
    return require('../lib/portable-process').resolvePortableLaunch;
  }
  const fullEnv = withPath([early, realGitDir]);
  const envA = { ...fullEnv, LC_ALL: 'C', GIT_AUTHOR_NAME: 'Cache A' };
  const envB = { ...fullEnv, LC_ALL: 'en_US', GIT_AUTHOR_NAME: 'Cache B' };
  const native = launch => { assert.strictEqual(launch.kind, 'native'); assert(samePath(launch.file, fakeGit)); };
  test('alternating complete environment keys retain separately verified launches', () => {
    const resolve = fresh(), start = whereCalls;
    for (const env of [envA, envB, envA, envB, envA]) native(resolve('git', { cwd, env }));
    assert.strictEqual(whereCalls - start, 2, 'complete keys remain distinct but revisits reuse their verified launch');
  });
  test('PATH changes and switchback invalidate all alternate-environment entries', () => {
    const resolve = fresh(), start = whereCalls;
    native(resolve('git', { cwd, env: envA })); native(resolve('git', { cwd, env: envB }));
    assert(samePath(resolve('git', { cwd, env: withPath([other, realGitDir]) }).file, realGit));
    native(resolve('git', { cwd, env: envA }));
    assert.strictEqual(whereCalls - start, 4);
  });
  test('PATHEXT changes and switchback force fresh resolution', () => {
    const resolve = fresh(), start = whereCalls;
    for (const PATHEXT of ['.EXE', '.EXE;.COM', '.EXE']) native(resolve('git', { cwd, env: { ...envA, PATHEXT } }));
    assert.strictEqual(whereCalls - start, 3);
  });
  test('cwd changes and switchback force fresh resolution', () => {
    const resolve = fresh(), start = whereCalls;
    for (const workdir of [cwd, other, cwd]) native(resolve('git', { cwd: workdir, env: envA }));
    assert.strictEqual(whereCalls - start, 3);
  });
  test('execPath changes and switchback force fresh resolution', () => {
    const resolve = fresh(), start = whereCalls;
    for (const execPath of [process.execPath, path.join(sandbox, 'other-node.exe'), process.execPath]) native(resolve('git', { cwd, env: envA, execPath }));
    assert.strictEqual(whereCalls - start, 3);
  });
  test('replacement invalidates every environment entry', () => {
    const resolve = fresh(), start = whereCalls;
    native(resolve('git', { cwd, env: envA })); native(resolve('git', { cwd, env: envB }));
    fs.writeFileSync(fakeGit, 'replacement with a distinct longer identity');
    native(resolve('git', { cwd, env: envA })); native(resolve('git', { cwd, env: envB }));
    assert.strictEqual(whereCalls - start, 4);
  });
  test('unknown fingerprint performs fresh locator checks and retains no cached launch', () => {
    const resolve = fresh(), start = whereCalls, read = fs.readdirSync;
    native(resolve('git', { cwd, env: envA }));
    fs.readdirSync = function(file, ...args) {
      if (samePath(file, early)) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return read.call(this, file, ...args);
    };
    try { native(resolve('git', { cwd, env: envA })); native(resolve('git', { cwd, env: envA })); }
    finally { fs.readdirSync = read; }
    native(resolve('git', { cwd, env: envA }));
    assert.strictEqual(whereCalls - start, 4);
  });
  test('permission-failed locator on unknown identity refuses without keeping old entries', () => {
    const resolve = fresh(), read = fs.readdirSync, spawn = cp.spawnSync;
    native(resolve('git', { cwd, env: envA }));
    fs.readdirSync = function(file, ...args) {
      if (samePath(file, early)) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      return read.call(this, file, ...args);
    };
    cp.spawnSync = function(file, ...args) {
      if (samePath(file, systemWhere)) return { status: null, error: Object.assign(new Error('denied'), { code: 'EACCES' }) };
      return spawn.call(this, file, ...args);
    };
    try { assert.throws(() => resolve('git', { cwd, env: envA, deadlineAt: performance.now() + 10000 }), { code: 'EACCES' }); }
    finally { fs.readdirSync = read; cp.spawnSync = spawn; }
    const start = whereCalls; native(resolve('git', { cwd, env: envA }));
    assert.strictEqual(whereCalls - start, 1, 'an uncertain failed observation discards prior launches');
  });
  test('cache is bounded and eviction cannot replace the selected executable', () => {
    const resolve = fresh(), start = whereCalls;
    const variants = Array.from({ length: 9 }, (_, n) => ({ ...envA, GIT_AUTHOR_NAME: 'Cache ' + n }));
    for (const env of variants) native(resolve('git', { cwd, env }));
    native(resolve('git', { cwd, env: variants[0] })); native(resolve('git', { cwd, env: variants[8] }));
    assert.strictEqual(whereCalls - start, 10);
  });
  test('locator error for a new complete key discards other cached launches', () => {
    const resolve = fresh(), spawn = cp.spawnSync;
    native(resolve('git', { cwd, env: envA }));
    cp.spawnSync = function(file, ...args) {
      if (samePath(file, systemWhere)) return { status: null, error: Object.assign(new Error('denied'), { code: 'EACCES' }) };
      return spawn.call(this, file, ...args);
    };
    try { assert.throws(() => resolve('git', { cwd, env: envB, deadlineAt: performance.now() + 10000 }), { code: 'EACCES' }); }
    finally { cp.spawnSync = spawn; }
    const start = whereCalls; native(resolve('git', { cwd, env: envA }));
    assert.strictEqual(whereCalls - start, 1);
  });
  test('a newly reachable alternate-key hit still refuses an expired deadline', () => {
    const resolve = fresh(); native(resolve('git', { cwd, env: envA })); native(resolve('git', { cwd, env: envB }));
    assert.throws(() => resolve('git', { cwd, env: envA, deadlineAt: performance.now() - 1 }), { code: 'ETIMEDOUT' });
  });
  test('an existing warm hit also refuses an expired deadline', () => {
    const resolve = fresh(); native(resolve('git', { cwd, env: envA }));
    assert.throws(() => resolve('git', { cwd, env: envA, deadlineAt: performance.now() - 1 }), { code: 'ETIMEDOUT' });
  });
  test('future deadlines retain the existing locator timeout bound', () => {
    const resolve = fresh(), spawn = cp.spawnSync; let timeout;
    cp.spawnSync = function(file, args, options) {
      if (samePath(file, systemWhere)) timeout = options.timeout;
      return spawn.apply(this, arguments);
    };
    try { native(resolve('git', { cwd, env: envA, deadlineAt: performance.now() + 10000 })); }
    finally { cp.spawnSync = spawn; }
    assert(timeout > 0 && timeout <= 5000);
  });
  console.log(`git-resolution-cache additional: ${passed}/${passed + failed} passed`);
  if (failed) process.exitCode = 1;
  fallbackLocatorCases();
} finally {
  cp.spawnSync = originalSpawnSync;
  const tempRoot = fs.realpathSync.native(os.tmpdir());
  const resolvedSandbox = fs.realpathSync.native(sandbox);
  if (path.dirname(resolvedSandbox).toLowerCase() !== tempRoot.toLowerCase()
      || !path.basename(resolvedSandbox).startsWith('leerness-git-cache-')) {
    throw new Error('refusing to remove a sandbox outside the designated temp directory');
  }
  const retained = require('./temp-cleanup').removeOwnedTree(require('./temp-cleanup').ownTree(resolvedSandbox));
  assert.strictEqual(retained.removed, false);
  console.log('git-resolution-cache fixtures retained: ' + resolvedSandbox);
}
