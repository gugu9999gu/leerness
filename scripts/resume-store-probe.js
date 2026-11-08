'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const cp = require('node:child_process');
const source = path.resolve(__dirname, '..');
const cliFile = path.join(source, 'bin/leerness.js');
const arena = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-resume-store-'));
const version = require('../package.json').version;
const { projectWriter } = require('../lib/runtime-writes');
const compiled = new Module(cliFile, module);
compiled.filename = cliFile;
compiled.paths = Module._nodeModulePaths(path.dirname(cliFile));
compiled._compile(fs.readFileSync(cliFile, 'utf8') + '\nmodule.exports.resumeProbe = { _loadActiveWakeups, _recordWakeup, _loadAutoResumePlan, _writeAutoResumePlan, _runPreWakeAudit };', cliFile);
const api = compiled.exports.resumeProbe;
const now = new Date().toISOString();
let sequence = 0;
const kinds = [
  { file: 'active-wakeups.json', read: api._loadActiveWakeups,
    write: projectWriter(root => api._recordWakeup(root, { expectedFireAt: now, status: 'pending', source: 'fixture' })),
    valid: { wakeups: [{ expectedFireAt: '2026-01-01T00:00:00Z', status: 'pending', source: 'kept', extension: 1 }], extension: { kept: '한글' } } },
  { file: 'auto-resume-plan.json', read: api._loadAutoResumePlan,
    write: projectWriter(root => api._writeAutoResumePlan(root, { focus: 'new focus', nextActions: [] })),
    valid: { savedAt: now, focus: 'old focus', nextActions: [], extension: { kept: '한글' } } },
];
function fixture(kind, bytes) {
  const root = path.join(arena, '한글 project ' + sequence++), dir = path.join(root, '.leerness');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'HARNESS_VERSION'), version + '\n');
  fs.writeFileSync(path.join(dir, 'LANGUAGE'), 'en\n');
  const file = path.join(dir, kind.file);
  if (bytes !== undefined) fs.writeFileSync(file, bytes);
  return { root, dir, file };
}
for (const kind of kinds) {
  for (const [name, bytes, code] of [
    ['JSON syntax', '{"private_marker":"do-not-echo",', 'E_STORE_CORRUPT'],
    ['invalid UTF-8', Buffer.from([0x7b, 0xff, 0x7d]), 'E_STORE_CORRUPT'],
    ['null root', 'null', 'E_STORE_INVALID'],
    ['array root', '[]', 'E_STORE_INVALID'],
    ['missing shape', '{}', 'E_STORE_INVALID'],
    ['future schema', JSON.stringify({ ...kind.valid, schemaVersion: 99 }), 'E_STORE_INVALID'],
  ]) {
    test(kind.file + ' refuses ' + name + ' on write and preserves bytes', () => {
      const f = fixture(kind, bytes), before = fs.readFileSync(f.file), stamp = fs.statSync(f.file, { bigint: true }).mtimeNs;
      assert.throws(() => kind.write(f.root), error => error.code === code && !error.message.includes('do-not-echo'));
      assert.deepEqual(fs.readFileSync(f.file), before);
      assert.equal(fs.statSync(f.file, { bigint: true }).mtimeNs, stamp);
      assert.equal(fs.readdirSync(f.dir).some(name => name.includes('.corrupt-')), false);
    });
  }
  test(kind.file + ' refuses corrupt explicit read', () => {
    const f = fixture(kind, '{bad');
    assert.throws(() => kind.read(f.root), { code: 'E_STORE_CORRUPT' });
  });
  test(kind.file + ' preserves BOM CRLF and extension metadata on update', () => {
    const f = fixture(kind, '\uFEFF' + JSON.stringify(kind.valid, null, 2).replace(/\n/g, '\r\n') + '\r\n');
    kind.write(f.root);
    const text = fs.readFileSync(f.file, 'utf8');
    assert.equal(text.charCodeAt(0), 0xfeff);
    assert.equal(/(?<!\r)\n/.test(text), false);
    const saved = JSON.parse(text.slice(1));
    assert.deepEqual(saved.extension, kind.valid.extension);
    if (kind.file.startsWith('active')) assert.deepEqual(saved.wakeups[0], kind.valid.wakeups[0]);
  });
  test(kind.file + ' refuses hard linked target', () => {
    const f = fixture(kind, JSON.stringify(kind.valid)), outside = path.join(arena, 'hard-' + sequence++);
    fs.linkSync(f.file, outside);
    const before = fs.readFileSync(outside);
    assert.throws(() => kind.write(f.root), { code: 'E_STORE_INVALID' });
    assert.deepEqual(fs.readFileSync(outside), before);
  });
  test(kind.file + ' genuine absence creates a valid store', () => {
    const f = fixture(kind);
    kind.write(f.root);
    const saved = JSON.parse(fs.readFileSync(f.file, 'utf8'));
    if (kind.file.startsWith('active')) assert.equal(saved.wakeups.length, 1);
    else assert.equal(saved.focus, 'new focus');
  });
  test(kind.file + ' missing parent read does not initialize a workspace', () => {
    const root = path.join(arena, 'missing-' + sequence++);
    fs.mkdirSync(root);
    kind.read(root);
    assert.deepEqual(fs.readdirSync(root), []);
  });
}
function cli(f, args) {
  const env = { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_LOCK_WARN: '1' };
  delete env.NODE_OPTIONS;
  const result = cp.spawnSync(process.execPath, [cliFile, ...args, '--path', f.root, '--json'], { cwd: f.root, env, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.error, undefined);
  return result;
}
test('resume CLI reports corrupt plan as a JSON error', () => {
  const f = fixture(kinds[1], '{bad'), result = cli(f, ['resume']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).code, 'store_corrupt');
  assert.equal(fs.readFileSync(f.file, 'utf8'), '{bad');
});
test('session-resume reports unreadable wakeup state instead of healthy absence', () => {
  const f = fixture(kinds[0], '{bad'), result = cli(f, ['session-resume']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.signals.some(s => s.kind === 'resume-store-error' && s.code === 'store_corrupt'), true);
  assert.equal(fs.readFileSync(f.file, 'utf8'), '{bad');
});
test('session-resume auto-fix preserves wakeup extension metadata', () => {
  const f = fixture(kinds[0], JSON.stringify(kinds[0].valid)), result = cli(f, ['session-resume', '--auto-fix']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const saved = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  assert.equal(saved.wakeups[0].status, 'superseded');
  assert.deepEqual(saved.extension, kinds[0].valid.extension);
});
for (const kind of kinds) {
  test(kind.file + ' refuses unreadable input', () => {
    const f = fixture(kind, JSON.stringify(kind.valid)), open = fs.openSync;
    fs.openSync = function (file, ...args) {
      if (String(file) === f.file) throw Object.assign(new Error('controlled read failure'), { code: 'EACCES' });
      return open.call(this, file, ...args);
    };
    try { assert.throws(() => kind.write(f.root), { code: 'E_STORE_UNREADABLE' }); }
    finally { fs.openSync = open; }
    assert.deepEqual(JSON.parse(fs.readFileSync(f.file, 'utf8')), kind.valid);
  });
  test(kind.file + ' rereads only after the real store lock is held', () => {
    const f = fixture(kind, JSON.stringify(kind.valid));
    const text = require('../lib/managed-text'), capture = text.captureTextEdit;
    text.captureTextEdit = function (file, ...args) {
      if (path.resolve(file) === f.file) {
        assert.equal(require('../lib/state-lock').isStateLockHeld(file), true);
        fs.writeFileSync(file, '{concurrent-corruption');
      }
      return capture.call(this, file, ...args);
    };
    try { assert.throws(() => kind.write(f.root), { code: 'E_STORE_CORRUPT' }); }
    finally { text.captureTextEdit = capture; }
    assert.equal(fs.readFileSync(f.file, 'utf8'), '{concurrent-corruption');
  });
  test(kind.file + ' preserves another writer change after capture', () => {
    const f = fixture(kind, JSON.stringify(kind.valid));
    const text = require('../lib/managed-text'), publish = text.publishTextEdit;
    text.publishTextEdit = function (edit, file, value) {
      if (path.resolve(file) === f.file) fs.writeFileSync(file, 'concurrent source bytes');
      return publish.call(this, edit, file, value);
    };
    try { assert.throws(() => kind.write(f.root), { code: 'E_STORE_CHANGED' }); }
    finally { text.publishTextEdit = publish; }
    assert.equal(fs.readFileSync(f.file, 'utf8'), 'concurrent source bytes');
  });
  test(kind.file + ' propagates publication failure without false success', () => {
    const f = fixture(kind, JSON.stringify(kind.valid));
    const text = require('../lib/managed-text'), publish = text.publishTextEdit;
    text.publishTextEdit = () => { throw Object.assign(new Error('controlled publication failure'), { code: 'EIO' }); };
    try { assert.throws(() => kind.write(f.root), error => error.resumeStore === true && error.code === 'EIO'); }
    finally { text.publishTextEdit = publish; }
    assert.deepEqual(JSON.parse(fs.readFileSync(f.file, 'utf8')), kind.valid);
  });
  test(kind.file + ' rejects invalid known fields', () => {
    const invalid = kind.file.startsWith('active') ? { wakeups: [null] } : { savedAt: 'not-a-date', nextActions: [] };
    const f = fixture(kind, JSON.stringify(invalid));
    assert.throws(() => kind.write(f.root), { code: 'E_STORE_INVALID' });
    assert.deepEqual(JSON.parse(fs.readFileSync(f.file, 'utf8')), invalid);
  });
}
test('active wakeups retain existing deduplication and last-20 limit', () => {
  const f = fixture(kinds[0], JSON.stringify({ ...kinds[0].valid, wakeups: [] }));
  for (let i = 0; i < 22; i++) projectWriter(api._recordWakeup)(f.root, { expectedFireAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(), status: 'pending' });
  const before = api._loadActiveWakeups(f.root).wakeups;
  projectWriter(api._recordWakeup)(f.root, { ...before[19], source: 'replacement' });
  const saved = api._loadActiveWakeups(f.root);
  assert.equal(saved.wakeups.length, 20);
  assert.equal(saved.wakeups[19].source, 'replacement');
  assert.deepEqual(saved.extension, kinds[0].valid.extension);
});
test('unchanged wakeup update does not rewrite the store', () => {
  const f = fixture(kinds[0], JSON.stringify(kinds[0].valid));
  const before = fs.statSync(f.file, { bigint: true }).mtimeNs;
  projectWriter(root => require('../lib/resume-store').updateWakeups(path.join(root, '.leerness/active-wakeups.json'), () => 0))(f.root);
  assert.equal(fs.statSync(f.file, { bigint: true }).mtimeNs, before);
});
test('simultaneous real wakeup writers preserve both entries', async () => {
  const f = fixture(kinds[0], JSON.stringify({ wakeups: [], extension: 'kept' }));
  const code = `const {projectWriter}=require(${JSON.stringify(path.join(source, 'lib/runtime-writes'))});const store=require(${JSON.stringify(path.join(source, 'lib/resume-store'))});projectWriter(root=>store.updateWakeups(${JSON.stringify(f.file)},w=>w.push({expectedFireAt:process.argv[1],status:'pending'})))(${JSON.stringify(f.root)});`;
  const run = expected => new Promise((resolve, reject) => {
    const child = cp.spawn(process.execPath, ['-e', code, expected], { cwd: arena, windowsHide: true, env: { ...process.env, LEERNESS_NO_LOCK_WARN: '1' } });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('writer timed out')); }, 15000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', status => { clearTimeout(timer); status === 0 ? resolve() : reject(new Error(stderr || 'writer failed ' + status)); });
  });
  await Promise.all([run('2026-01-01T00:00:00Z'), run('2026-01-02T00:00:00Z')]);
  const saved = JSON.parse(fs.readFileSync(f.file, 'utf8'));
  assert.deepEqual(saved.wakeups.map(w => w.expectedFireAt).sort(), ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z']);
  assert.equal(saved.extension, 'kept');
});
test('pre-wake audit marks even one corrupt resume store as needing attention', () => {
  const f = fixture(kinds[1], '{bad');
  const report = api._runPreWakeAudit(f.root);
  assert.equal(report.findings.warning.some(item => item.kind === 'resume-store-error' && item.code === 'store_corrupt'), true);
  assert.equal(report.findings.info.some(item => item.kind === 'no-auto-resume-plan'), false);
  assert.equal(report.summary.needsAttention, true);
  assert.equal(fs.readFileSync(f.file, 'utf8'), '{bad');
});
test('resume CLI keeps Korean errors localized', () => {
  const f = fixture(kinds[1], '{bad');
  fs.writeFileSync(path.join(f.dir, 'LANGUAGE'), 'ko\n');
  const result = cli(f, ['resume']);
  assert.equal(result.status, 1);
  const error = JSON.parse(result.stdout);
  assert.equal(error.code, 'store_corrupt');
  assert.match(error.error, /원본을 보존/);
});
test('session-resume auto-fix refuses dry-run without changing original bytes', () => {
  const bytes = JSON.stringify(kinds[0].valid), f = fixture(kinds[0], bytes);
  const result = cli(f, ['session-resume', '--auto-fix', '--dry-run']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).code, 'dry_run_unsupported');
  assert.equal(fs.readFileSync(f.file, 'utf8'), bytes);
});
