#!/usr/bin/env node
'use strict';

// T-0303: generated runtime cache must not create a strict Git mismatch for
// an unrelated, already committed claim when an older project lacks .gitignore.
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cli = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-claim-cache-'));
const env = {
  ...process.env,
  LEERNESS_OFFLINE: '1',
  LEERNESS_NO_PROMPT: '1',
  LEERNESS_NO_AUTOCHCP: '1',
  LEERNESS_NO_AUTO_ROADMAP: '1',
  LEERNESS_NO_STALE_CHECK: '1',
  LEERNESS_INTERNAL: '1',
};

function exec(program, args) {
  return cp.spawnSync(program, args, {
    cwd: root, env, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
  });
}
function git(...args) {
  const result = exec('git', args);
  assert.strictEqual(result.status, 0,
    `git ${args[0]}: ${String(result.stderr).slice(0, 400)}`);
  return result.stdout;
}
function check(id) {
  const result = exec(process.execPath,
    [cli, 'verify-claim', id, '--strict-claims', '--json', '--path', root]);
  let data;
  try { data = JSON.parse(result.stdout); }
  catch { throw new Error(`verify-claim ${id}: ${String(result.stdout).slice(0, 500)} ${String(result.stderr).slice(0, 300)}`); }
  return { exit: result.status, data };
}
function sweep() {
  const result = exec(process.execPath,
    [cli, 'verify-claim', '--all', '--strict-claims', '--json', '--path', root]);
  let data;
  try { data = JSON.parse(result.stdout); }
  catch { throw new Error(`verify-claim --all: ${String(result.stdout).slice(0, 500)} ${String(result.stderr).slice(0, 300)}`); }
  return { exit: result.status, data };
}

try {
  git('init', '-q');
  git('config', 'user.email', 'claim-cache@example.invalid');
  git('config', 'user.name', 'Claim Cache Probe');
  fs.mkdirSync(path.join(root, 'empty-hooks'));
  git('config', 'core.hooksPath', path.join(root, 'empty-hooks'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, '.leerness'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'),
    "function a() { return 'a'; }\nmodule.exports = a;\n", 'utf8');
  fs.writeFileSync(path.join(root, 'src', 'b.js'),
    "function b() { return 'b'; }\nmodule.exports = b;\n", 'utf8');
  fs.writeFileSync(path.join(root, '.leerness', 'HARNESS_VERSION'), '1.36.286\n', 'utf8');
  fs.writeFileSync(path.join(root, '.leerness', 'progress-tracker.md'),
    '# Progress Tracker\n\n| ID | Status | Request | Evidence | Next Action | Updated |\n'
    + '|---|---|---|---|---|---|\n'
    + '| T-0001 | done | code claim | Files: src/a.js | none | 2026-09-27 |\n'
    + '| T-0002 | done | explicit runtime claim | Files: .leerness/cache/runtime.json | none | 2026-09-27 |\n', 'utf8');
  git('add', '.leerness', 'src');
  git('commit', '-qm', 'clean fixture');
  assert.strictEqual(git('status', '--porcelain'), '', 'fixture must start clean');

  const cacheDir = path.join(root, '.leerness', 'cache');
  fs.mkdirSync(cacheDir);
  fs.writeFileSync(path.join(cacheDir, 'runtime.json'), '{"generated":true}\n', 'utf8');
  const status = git('status', '--porcelain=v1', '--untracked-files=all');
  assert(status.includes('.leerness/cache/runtime.json'),
    'fixture must expose the untracked cache when .gitignore is missing');

  const codeWithCacheOnly = check('T-0001');
  assert.strictEqual(codeWithCacheOnly.data.ok, true,
    `cache-only strict claim should stay valid: ${codeWithCacheOnly.data.reasons}`);
  assert.strictEqual(codeWithCacheOnly.data.git.applicable, false,
    'an unclaimed generated cache alone must not activate the Git cross-check');
  const explicitCache = check('T-0002');
  assert.strictEqual(explicitCache.data.ok, true,
    `an explicitly claimed cache file retains its prior Git comparison: ${explicitCache.data.reasons}`);
  assert.strictEqual(explicitCache.data.git.claimedInGit, 1);
  const aggregate = sweep();
  assert.deepStrictEqual(aggregate.data.results.map(r => [r.id, r.ok]),
    [['T-0001', true], ['T-0002', true]]);
  console.log('PASS: unclaimed runtime cache does not create a strict false mismatch');

  const bPath = path.join(root, 'src', 'b.js');
  const bOriginal = fs.readFileSync(bPath, 'utf8');
  fs.appendFileSync(bPath, '// unrelated real code change\n', 'utf8');
  const unrelatedCode = check('T-0001');
  assert.strictEqual(unrelatedCode.data.ok, false,
    'a different changed code file must still block a strict claim');
  assert(unrelatedCode.data.reasons.includes('git-mismatch'));
  fs.writeFileSync(bPath, bOriginal, 'utf8');
  console.log('PASS: unrelated code changes still fail strict Git comparison');

  fs.appendFileSync(path.join(root, 'src', 'a.js'), '// claimed real code change\n', 'utf8');
  const claimedCode = check('T-0001');
  assert.strictEqual(claimedCode.data.ok, true,
    `a claimed code change must still pass: ${claimedCode.data.reasons}`);
  assert.strictEqual(claimedCode.data.git.claimedInGit, 1);
  console.log('PASS: claimed code changes still satisfy strict Git comparison');
} finally {
  const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(root));
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    'temporary cleanup target must remain inside the system temp directory');
  fs.rmSync(root, { recursive: true, force: true });
}
