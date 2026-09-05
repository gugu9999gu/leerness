'use strict';

// In-memory transport and descriptor fixtures: never launches Git or changes a
// repository. Exercise the real runtime operation/latch and gitSpawn boundary.
const assert = require('assert');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const portable = require('../lib/portable-process');
const originalSpawn = portable.spawnPortableSync;
const calls = [];
portable.spawnPortableSync = (command, args, opts) => {
  assert.strictEqual(command, 'git');
  calls.push({ args, opts });
  return { status: 0, stdout: 'fixture\n', stderr: '' };
};
const git = require('../lib/git');
const layout = require('../lib/runtime-layout');
const runtime = require('../lib/runtime-writes');
const originalReader = layout.createRuntimeCompatibilityReader;
let compatible = true;
layout.createRuntimeCompatibilityReader = () => () => ({
  compatible, writeDisposition: compatible ? 'allowed' : 'blocked', reasonCode: compatible ? 'legacy_absent' : 'layout_unsupported',
});
const source = path.resolve(__dirname, '../lib/git.js');
const stamp = () => ({ mtime: String(fs.statSync(source, { bigint: true }).mtimeNs),
  hash: crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex') });
const before = stamp();
const cwd = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;
const test = (name, fn) => {
  try { fn(); passed++; }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
};
const writes = [
  ['branch', 'audit-branch'], ['branch', 'audit-branch', 'HEAD'], ['branch', '-f', 'audit-branch'],
  ['branch', '-D', 'audit-branch'], ['branch', '-m', 'old', 'new'], ['branch', '-C', 'old', 'new'],
  ['branch', '-u', 'origin/main'], ['branch', '--set-upstream-to=origin/main', 'audit-branch'],
  ['branch', '--unset-upstream'], ['branch', '--edit-description'], ['branch', '--create-reflog', 'audit-branch'],
  ['branch', '--list', '--no-list', 'audit-branch'], ['branch', '-avD', 'audit-branch'],
  ['tag', 'audit-tag'], ['tag', 'audit-tag', 'HEAD'], ['tag', '-m', 'fixture', 'audit-tag'],
  ['tag', '--message=fixture', 'audit-tag'], ['tag', '--create-reflog', 'audit-tag'],
  ['tag', '-a', 'audit-tag'], ['tag', '-d', 'audit-tag'], ['tag', '-f', 'audit-tag'],
  ['symbolic-ref', 'HEAD', 'refs/heads/audit-branch'],
  ['symbolic-ref', '-q', 'HEAD', 'refs/heads/audit-branch'],
  ['symbolic-ref', '--short', 'HEAD', 'refs/heads/audit-branch'],
  ['symbolic-ref', '--delete', '-q', 'HEAD'],
  ['config', '--show-scope', 'audit.name', 'fixture'],
  ['config', '--local', '--add', 'audit.name', 'fixture'],
  ['config', '--unset', 'audit.name'], ['config', 'set', 'audit.name', 'fixture'],
  ['remote', '-v', 'add', 'fixture', 'https://example.invalid/repo'],
  ['remote', '-v', 'remove', 'fixture'], ['remote', 'set-url', 'fixture', 'https://example.invalid/repo'],
  ['worktree', 'add', 'fixture'], ['stash', 'push'], ['notes', 'add', '-m', 'fixture'],
  ['submodule', 'update'], ['-C', cwd, '-c', 'audit.name=fixture', 'tag', 'audit-tag'],
  ['--git-dir', path.join(cwd, '.git'), 'branch', 'audit-branch'],
];
const reads = [
  ['rev-parse', '--show-toplevel'], ['rev-parse', '--path-format=absolute', '--git-dir'],
  ['status', '--porcelain'], ['log', '-1', '--format=%H'], ['branch'], ['branch', '-avv'],
  ['branch', '--list', 'release/*'], ['branch', '--merged', 'main', '--list', 'release/*'],
  ['branch', '--contains=HEAD'], ['branch', '--show-current'], ['tag'], ['tag', '-n2', 'v*'],
  ['tag', '--list', 'v*', '--sort=creatordate', '--format=%(refname:short)'],
  ['tag', '--contains', 'HEAD', '--list', 'v*'], ['tag', '--verify', 'v1'],
  ['symbolic-ref', 'HEAD'], ['symbolic-ref', '-q', 'HEAD'], ['symbolic-ref', '--short', '--no-recurse', 'HEAD'],
  ['config', '--get', 'core.hooksPath'], ['config', '--local', '--show-scope', '--get-all', 'audit.name'],
  ['config', '--list'], ['remote'], ['remote', '-v'], ['remote', 'get-url', 'origin'],
  ['worktree', 'list', '--porcelain'], ['stash', 'list'], ['stash', 'show'],
  ['notes', 'list'], ['notes', 'show', 'HEAD'], ['submodule', 'status'],
  ['-C', cwd, '-c', 'audit.name=fixture', 'rev-parse', '--git-dir'],
];
try {
  for (const args of writes) {
    test(`runtime blocks ${args.join(' ')}`, () => {
      compatible = true;
      const count = calls.length;
      assert.throws(() => runtime.withRuntimeWrites(cwd, () => {
        compatible = false;
        git.gitSpawn(args, { cwd, encoding: 'utf8' });
      }), error => error.code === 'E_RUNTIME_LAYOUT_INCOMPATIBLE');
      assert.strictEqual(calls.length, count, 'transport reached after rejection');
    });
    test(`dry-run blocks ${args.join(' ')}`, () => {
      git.setGitDryRun(true);
      const count = calls.length;
      try { assert.throws(() => git.gitSpawn(args, { cwd }), error => error.code === 'E_DRY_RUN_WRITE'); }
      finally { git.setGitDryRun(false); }
      assert.strictEqual(calls.length, count, 'transport reached during dry-run');
    });
  }
  for (const args of reads) test(`read remains available: ${args.join(' ')}`, () => {
    compatible = true;
    git.setGitDryRun(true);
    const count = calls.length;
    try {
      runtime.withRuntimeWrites(cwd, () => { compatible = false; git.gitSpawn(args, { cwd, shell: true }); });
    } finally { git.setGitDryRun(false); }
    assert.strictEqual(calls.length, count + 1);
    assert.strictEqual(calls[count].opts.shell, false);
    assert.strictEqual(calls[count].args[0], '--no-optional-locks');
  });
  test('source bytes and mtime unchanged during probe', () => assert.deepStrictEqual(stamp(), before));
} finally {
  git.setGitDryRun(false);
  portable.spawnPortableSync = originalSpawn;
  layout.createRuntimeCompatibilityReader = originalReader;
}
console.log(`RUNTIME_GIT_WRITE_PROBE ${passed}/${passed + failed} passed; Git processes launched: 0`);
if (failed) process.exitCode = 1;
