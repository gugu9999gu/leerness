#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { resolvePortableLaunch } = require('../lib/portable-process');

if (process.platform !== 'win32') {
  console.log('git-resolution-cache: Windows-only locator check skipped');
  process.exit(0);
}

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
} finally {
  cp.spawnSync = originalSpawnSync;
  if (fs.existsSync(linkedCwd)) fs.rmdirSync(linkedCwd);
  const tempRoot = fs.realpathSync.native(os.tmpdir());
  const resolvedSandbox = fs.realpathSync.native(sandbox);
  if (path.dirname(resolvedSandbox).toLowerCase() !== tempRoot.toLowerCase()
      || !path.basename(resolvedSandbox).startsWith('leerness-git-cache-')) {
    throw new Error('refusing to remove a sandbox outside the designated temp directory');
  }
  fs.rmSync(resolvedSandbox, { recursive: true, force: true });
}
