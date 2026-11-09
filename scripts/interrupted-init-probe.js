'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { createHash } = require('node:crypto');
const { inspectRuntimeCompatibility } = require('../lib/runtime-layout');
const { removeTree } = require('./temp-cleanup');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-init-'));
const cli = path.resolve(__dirname, '../bin/leerness.js');
const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_PATH_CHECK: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_AUTO_ROADMAP: '1', LEERNESS_LANG: 'en' };
for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP']) {
  env[key] = path.join(arena, key.toLowerCase()); fs.mkdirSync(env[key]);
}
for (const key of Object.keys(env)) if (/^(?:GIT_|LEERNESS_WORKSPACE_DIR$|LEERNESS_RUNTIME_|LEERNESS_STATE_)/i.test(key)) delete env[key];
const hook = path.join(arena, 'stop.cjs');
fs.writeFileSync(hook, String.raw`
'use strict';
const fs = require('fs'), path = require('path');
const names = new Map();
const open = fs.openSync.bind(fs), write = fs.writeFileSync.bind(fs), mkdir = fs.mkdirSync.bind(fs), rename = fs.renameSync.bind(fs), link = fs.linkSync.bind(fs);
const stop = name => { if (process.env.INIT_STOP_AT === name) { fs.writeSync(2, 'STOPPED_AT=' + name + '\n'); process.kill(process.pid, 'SIGKILL'); } };
fs.openSync = function(p, ...args) { const fd = open(p, ...args); names.set(fd, String(p)); return fd; };
fs.mkdirSync = function(p, ...args) { const result = mkdir(p, ...args); if (path.basename(String(p)) === 'HARNESS_VERSION.lock') stop('empty-lock'); return result; };
fs.writeFileSync = function(p, ...args) {
  const result = write(p, ...args), name = typeof p === 'number' ? names.get(p) || '' : String(p);
  if (/HARNESS_VERSION\.tmp-[1-9][0-9]*-[1-9][0-9]*$/.test(name)) stop('owner-temp');
  if (/\.HARNESS_VERSION\.publish-[1-9][0-9]*-[a-f0-9]{24}$/.test(name)) stop('staged-marker');
  return result;
};
fs.renameSync = function(a, b) { const result = rename(a, b); if (path.basename(path.dirname(String(b))) === 'HARNESS_VERSION.lock' && /^owner-/.test(path.basename(String(b)))) stop('owner-ready'); return result; };
fs.linkSync = function(a, b) { const result = link(a, b); if (path.basename(String(b)) === 'HARNESS_VERSION') stop('marker-linked'); return result; };
`);
let seq = 0;
function fixture() {
  const root = path.join(arena, 'p' + ++seq); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"init-probe","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(root, 'personal.txt'), Buffer.from('\uFEFF원문 e\u0301\r\n'));
  return root;
}
function run(root, args, mode = null) {
  return cp.spawnSync(process.execPath, [...(mode ? ['--require', hook] : []), cli, ...args], {
    cwd: root, env: { ...env, INIT_STOP_AT: mode || '' }, encoding: 'utf8', timeout: 65000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
  });
}
const init = root => ['init', root, '--yes', '--minimal', '--no-setup-agents', '--no-mcp', '--no-auto-roadmap', '--no-official-skills', '--no-banner'];
const success = result => { assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr); };
function snapshot(root) {
  const out = [];
  const visit = p => { const st = fs.lstatSync(p); if (st.isDirectory()) { out.push([path.relative(root, p), 'dir']); for (const n of fs.readdirSync(p).sort()) visit(path.join(p, n)); } else out.push([path.relative(root, p), st.isSymbolicLink() ? fs.readlinkSync(p) : createHash('sha256').update(fs.readFileSync(p)).digest('hex')]); };
  visit(root); return out;
}
for (const mode of ['empty-lock', 'owner-temp', 'owner-ready', 'staged-marker', 'marker-linked']) {
  test('init resumes after a real process kill at ' + mode, () => {
    const root = fixture(), personal = fs.readFileSync(path.join(root, 'personal.txt'));
    const stopped = run(root, init(root), mode);
    assert.ifError(stopped.error); assert.notEqual(stopped.status, 0); assert.match(stopped.stderr, new RegExp('STOPPED_AT=' + mode));
    const ws = path.join(root, '.leerness'), lock = path.join(ws, 'HARNESS_VERSION.lock');
    const retained = fs.readdirSync(ws).filter(n => /^HARNESS_VERSION\.tmp-|^\.HARNESS_VERSION\.publish-/.test(n))
      .map(n => ({ name: n, bytes: fs.readFileSync(path.join(ws, n)), links: fs.lstatSync(path.join(ws, n)).nlink }));
    const aged = new Date(Date.now() - 65000);
    fs.utimesSync(lock, aged, aged);
    for (const n of fs.readdirSync(lock)) fs.utimesSync(path.join(lock, n), aged, aged);
    const result = run(root, init(root)); success(result);
    assert.equal(fs.readFileSync(path.join(ws, 'HARNESS_VERSION'), 'utf8').trim(), require('../package.json').version);
    assert.ok(fs.existsSync(path.join(ws, 'progress-tracker.md')));
    assert.deepEqual(fs.readFileSync(path.join(root, 'personal.txt')), personal);
    for (const entry of retained) if (entry.links === 1) assert.deepEqual(fs.readFileSync(path.join(ws, entry.name)), entry.bytes, entry.name);
    assert.equal(fs.lstatSync(path.join(ws, 'HARNESS_VERSION')).nlink, 1);
    success(run(root, ['task', 'add', 'Post-restart task', '--path', root, '--json']));
  });
}
for (const name of ['HARNESS_VERSION.tmp-0-1', '.HARNESS_VERSION.publish-1-wrong', '.HARNESS_VERSION.publish-1-' + 'a'.repeat(23), 'arbitrary.tmp-10-1']) {
  test('unknown install-like file remains blocked: ' + name, () => {
    const root = fixture(), ws = path.join(root, '.leerness'); fs.mkdirSync(ws); fs.writeFileSync(path.join(ws, name), 'retain');
    const before = snapshot(root), report = inspectRuntimeCompatibility(root);
    assert.equal(report.reasonCode, 'workspace_ambiguous'); assert.deepEqual(snapshot(root), before);
  });
}
for (const kind of ['directory', 'hardlink', 'symlink']) {
  test('marker staging ' + kind + ' is refused before publication', () => {
    const root = fixture(), ws = path.join(root, '.leerness'); fs.mkdirSync(ws);
    const p = path.join(ws, '.HARNESS_VERSION.publish-123-' + 'b'.repeat(24));
    if (kind === 'directory') fs.mkdirSync(p);
    else if (kind === 'hardlink') fs.linkSync(path.join(root, 'personal.txt'), p);
    else if (process.platform === 'win32') {
      const target = path.join(root, 'link-target'); fs.mkdirSync(target);
      fs.symlinkSync(target, p, 'junction');
    } else fs.symlinkSync(path.join(root, 'personal.txt'), p);
    const before = snapshot(root); assert.equal(inspectRuntimeCompatibility(root).reasonCode, 'workspace_ambiguous'); assert.deepEqual(snapshot(root), before);
  });
}
test('resuming does not authorize a conflicting legacy workspace', () => {
  const root = fixture(), { LEGACY_WORKSPACE_DIR } = require('../lib/workspace-dir'); fs.mkdirSync(path.join(root, '.leerness')); fs.mkdirSync(path.join(root, LEGACY_WORKSPACE_DIR));
  fs.mkdirSync(path.join(root, '.leerness', 'HARNESS_VERSION.lock')); fs.writeFileSync(path.join(root, LEGACY_WORKSPACE_DIR, 'HARNESS_VERSION'), '1.0.0');
  const before = snapshot(root); assert.equal(inspectRuntimeCompatibility(root).reasonCode, 'workspace_ambiguous'); assert.deepEqual(snapshot(root), before);
});
test.after(() => removeTree(arena, { recursive: true, force: true }));
