#!/usr/bin/env node
'use strict';

// T-0306: the secret scan follows Git's view of the repository. A nested repository or worktree is a
// separate repository (Git never lists its files here), .git/info/exclude ignores like .gitignore,
// and multi-segment skip entries such as .leerness/archive apply. An unignored file in the
// repository itself is the control that must still be reported as committed.
const assert = require('assert');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cli = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-secret-scope-'));
const root = path.join(base, 'repo');
const env = {
  ...process.env,
  LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_AUTO_ROADMAP: '1',
  LEERNESS_NO_STALE_CHECK: '1', LEERNESS_INTERNAL: '1',
  GIT_CONFIG_NOSYSTEM: '1',
};
// Built at runtime so this source never contains a scanner match.
const token = () => 'gh' + 'p_' + crypto.randomBytes(18).toString('hex');

function exec(program, args, cwd) {
  return cp.spawnSync(program, args, { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
}
function git(cwd, ...args) {
  const result = exec('git', args, cwd);
  assert.strictEqual(result.status, 0, `git ${args.join(' ')}: ${String(result.stderr).slice(0, 400)}`);
  return result.stdout;
}
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function scan(dir) {
  const result = exec(process.execPath, [cli, 'scan', 'secrets', dir, '--json'], dir);
  let data;
  try { data = JSON.parse(result.stdout); }
  catch { throw new Error(`scan secrets: ${String(result.stdout).slice(0, 500)} ${String(result.stderr).slice(0, 300)}`); }
  const files = key => new Set((data[key] || []).map(f => String(f.file).replace(/\\/g, '/')));
  return { committed: files('committed'), ignored: files('ignored'), all: JSON.stringify(data) };
}

try {
  fs.mkdirSync(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'secret-scope@example.invalid');
  git(root, 'config', 'user.name', 'Secret Scope Probe');
  git(root, 'config', 'core.hooksPath', path.join(base, 'no-hooks'));
  write(path.join(root, '.gitignore'), 'ignored-dir/\n');
  write(path.join(root, 'src', 'app.js'), `const control = '${token()}';\n`);
  write(path.join(root, 'ignored-dir', 'leak.js'), `const ignoredByGitignore = '${token()}';\n`);
  write(path.join(root, 'private', 'leak.js'), `const ignoredByExclude = '${token()}';\n`);
  fs.appendFileSync(path.join(root, '.git', 'info', 'exclude'), '\nprivate/\n');
  write(path.join(root, 'wt', 'child', '.git'), 'gitdir: ../../.git/worktrees/child\n');
  write(path.join(root, 'wt', 'child', 'leak.js'), `const worktreeCopy = '${token()}';\n`);
  fs.mkdirSync(path.join(root, 'vendor', 'lib', '.git'), { recursive: true });
  write(path.join(root, 'vendor', 'lib', 'leak.js'), `const nestedRepository = '${token()}';\n`);
  write(path.join(root, '.leerness', 'archive', 'old', 'leak.js'), `const archived = '${token()}';\n`);
  write(path.join(root, '.leerness-backup', 'leak.js'), `const legacyBackup = '${token()}';\n`);

  const r = scan(root);
  assert(r.committed.has('src/app.js'), `the unignored control must be reported as committed: ${r.all.slice(0, 600)}`);
  assert(r.ignored.has('ignored-dir/leak.js') && !r.committed.has('ignored-dir/leak.js'), '.gitignore still classifies as ignored');
  console.log('PASS: control is committed and .gitignore still classifies as ignored');
  assert(r.ignored.has('private/leak.js') && !r.committed.has('private/leak.js'),
    `.git/info/exclude must classify as ignored: ${r.all.slice(0, 600)}`);
  console.log('PASS: .git/info/exclude classifies as ignored, not committed');
  for (const file of ['wt/child/leak.js', 'vendor/lib/leak.js']) {
    assert(!r.all.includes(file), `${file} belongs to a separate repository and must not be scanned here`);
  }
  console.log('PASS: nested worktree and nested repository are not scanned as this repository');
  for (const file of ['.leerness/archive/old/leak.js', '.leerness-backup/leak.js']) {
    assert(!r.all.includes(file), `${file} is a leerness backup and must be skipped`);
  }
  console.log('PASS: .leerness/archive and .leerness-backup are skipped');

  // A real linked worktree reads info/exclude from the common Git directory.
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
  const linked = path.join(base, 'linked');
  git(root, 'worktree', 'add', '-q', linked);
  fs.appendFileSync(path.join(root, '.git', 'info', 'exclude'), 'linked-private/\n');
  write(path.join(linked, 'linked-private', 'leak.js'), `const linkedExcluded = '${token()}';\n`);
  write(path.join(linked, 'linked-src', 'app.js'), `const linkedControl = '${token()}';\n`);
  const w = scan(linked);
  assert(w.committed.has('linked-src/app.js'), `linked worktree control must be committed: ${w.all.slice(0, 600)}`);
  assert(w.ignored.has('linked-private/leak.js') && !w.committed.has('linked-private/leak.js'),
    `linked worktree must use the common info/exclude: ${w.all.slice(0, 600)}`);
  console.log('PASS: a linked worktree root uses the common .git/info/exclude');

  // Encoding diagnostics share the nested-repository boundary.
  write(path.join(root, 'src', 'bad.txt'), Buffer.from([0x6f, 0x6b, 0x20, 0xff, 0xfe, 0x0a]));
  write(path.join(root, 'vendor', 'lib', 'bad.txt'), Buffer.from([0x6f, 0x6b, 0x20, 0xff, 0xfe, 0x0a]));
  const enc = exec(process.execPath, [cli, 'encoding', 'check', root, '--json'], root);
  const encText = String(enc.stdout);
  assert(/src\/bad\.txt/.test(encText), `encoding control must be reported: ${encText.slice(0, 400)}`);
  assert(!/vendor\/lib\/bad\.txt/.test(encText), 'encoding check must not inspect a nested repository');
  console.log('PASS: encoding check reports the control and skips the nested repository');
} finally {
  const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(base));
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    'temporary cleanup target must remain inside the system temp directory');
  fs.rmSync(base, { recursive: true, force: true });
}
