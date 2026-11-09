'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { removeTree } = require('./temp-cleanup');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-path-'));
const cli = path.resolve(__dirname, '../bin/leerness.js');
const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1', LEERNESS_NO_AUTO_ROADMAP: '1', LEERNESS_LANG: 'en' };
for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase()); fs.mkdirSync(env[key]); }
for (const key of Object.keys(env)) if (/^(?:GIT_|LEERNESS_WORKSPACE_DIR$|LEERNESS_RUNTIME_|LEERNESS_STATE_)/i.test(key)) delete env[key];
function project(length, tag) {
  let dir = path.join(arena, tag);
  while (dir.length + 62 < length) dir = path.join(dir, 'x'.repeat(60));
  dir = path.join(dir, 'p'.repeat(length - dir.length - 1));
  assert.equal(dir.length, length); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"long-path-fixture","version":"1.0.0"}');
  return dir;
}
function run(root, args, preload) {
  const result = cp.spawnSync(process.execPath, [...(preload ? ['--require', preload] : []), cli, ...args], {
    cwd: root.length >= 260 ? arena : root, env, encoding: 'utf8', timeout: 65000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  });
  assert.ifError(result.error); return result;
}
const success = r => assert.equal(r.status, 0, r.stdout + r.stderr);
const init = root => ['init', root, '--yes', '--language', 'en', '--minimal', '--no-setup-agents', '--no-mcp', '--no-auto-roadmap', '--no-official-skills', '--no-banner'];
const txt = '원문 e\u0301 🐝';
for (const length of [170, 190, 212, 270]) {
  test('first decision and repeated lesson stay consistent at project length ' + length, { skip: process.platform !== 'win32' }, () => {
    const root = project(length, 'p' + length); success(run(root, init(root)));
    const ws = path.join(root, '.leerness'), pure = require('../lib/pure-utils');
    const surfaces = [['decisions', pure._renderDecisionsMd], ['lessons', pure._renderLessonsMd]];
    const suffixes = Object.fromEntries(surfaces.map(([name, render]) => {
      const file = path.join(ws, name + '.md'), original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const empty = render([], 'en');
      return [name, original.startsWith(empty) ? original.slice(empty.length) : original];
    }));
    success(run(root, ['decision', 'add', 'First ' + txt, '--reason', 'original reason', '--path', root]));
    success(run(root, ['decision', 'add', 'Second ' + txt, '--reason', 'second reason', '--path', root]));
    success(run(root, ['lesson', 'save', 'First ' + txt, '--path', root]));
    success(run(root, ['lesson', 'save', 'Second ' + txt, '--path', root]));
    for (const [name, renderer] of surfaces) {
      const data = JSON.parse(fs.readFileSync(path.join(ws, name + '.json'), 'utf8'));
      assert.equal(data.length, 2); assert.equal(fs.readFileSync(path.join(ws, name + '.md'), 'utf8'), renderer(data, 'en') + suffixes[name]);
      assert.equal(fs.lstatSync(path.join(ws, name + '.json')).nlink, 1);
    }
    const recovery = path.join(ws, 'archive', 'mutation-recovery');
    assert.deepEqual(fs.readdirSync(recovery), []);
    assert.equal(fs.readdirSync(ws).filter(n => n.startsWith('.leerness-write-')).length, 0);
  });
}
test('long-path replacement preserves a backup, rejects stale input and retains metadata', { skip: process.platform !== 'win32' }, () => {
  const root = project(212, 'direct'), ws = path.join(root, '.leerness'); fs.mkdirSync(ws);
  fs.writeFileSync(path.join(ws, 'HARNESS_VERSION'), require('../package.json').version);
  const file = path.join(ws, 'decisions.md'), old = Buffer.from(txt + '\r\n'), next = Buffer.from(txt + ' changed\r\n');
  fs.writeFileSync(file, old); fs.writeFileSync(file + ':leerness-probe', 'retain-stream');
  const { writeBufferIfUnchanged } = require('../lib/io');
  const result = writeBufferIfUnchanged(file, old, next, { retainBackup: true });
  assert.deepEqual(fs.readFileSync(file), next); assert.ok(result.backupFile); assert.deepEqual(fs.readFileSync(result.backupFile), old);
  assert.equal(fs.readFileSync(file + ':leerness-probe', 'utf8'), 'retain-stream');
  assert.throws(() => writeBufferIfUnchanged(file, old, Buffer.from('must not write')), { code: 'E_CONCURRENT_MODIFICATION' });
  assert.deepEqual(fs.readFileSync(file), next);
});
test.after(() => removeTree(arena, { recursive: true, force: true }));
