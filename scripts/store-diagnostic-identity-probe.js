'use strict';

// Actual files and CLI, with narrow metadata/I/O seams. No provider execution.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const { readStoreFile, MAX_BYTES } = require('../lib/store-diagnostic-read');
const arena = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-diagnostic-identity-'));
const clone = (s, changes) => Object.assign(Object.create(Object.getPrototypeOf(s)), s, changes);
let total = 0, failed = 0;
function test(name, run) {
  total++;
  try { run(); process.stdout.write(`PASS ${name}\n`); }
  catch (error) { failed++; process.stderr.write(`FAIL SD_FILE_IDENTITY ${name}: ${error.stack}\n`); }
}
function fixture(name = 'decisions.json', bytes = Buffer.from('[]')) {
  const root = fs.mkdtempSync(path.join(arena, 'case-')), workspace = path.join(root, '.leerness');
  fs.mkdirSync(workspace);
  const file = path.join(workspace, name); fs.writeFileSync(file, bytes);
  return { root, workspace, name, file, bytes };
}
function fingerprint(f) {
  const s = fs.lstatSync(f.file, { bigint: true });
  return [fs.readFileSync(f.file), s.size, s.mtimeNs, s.ctimeNs, s.ino];
}
function observed(f, hooks = {}, zeroPath = true) {
  const saved = Object.fromEntries(['lstatSync', 'openSync', 'fstatSync', 'readSync', 'closeSync'].map(k => [k, fs[k]]));
  const handles = new Map(), meter = { opens: 0, closed: 0, readBytes: 0, requested: 0 };
  fs.lstatSync = function(file, ...args) {
    let s = saved.lstatSync.call(fs, file, ...args);
    if (String(file) === f.workspace && hooks.parent) s = hooks.parent(s);
    if (String(file) === f.file) {
      if (zeroPath) s = clone(s, { dev: 0n });
      if (hooks.path) s = hooks.path(s);
    }
    return s;
  };
  fs.openSync = function(file, ...args) {
    const target = String(file) === f.file;
    if (target) { meter.opens++; if (hooks.open) hooks.open(meter.opens); }
    const fd = saved.openSync.call(fs, file, ...args);
    if (target) handles.set(fd, meter.opens);
    return fd;
  };
  fs.fstatSync = function(fd, ...args) {
    const s = saved.fstatSync.call(fs, fd, ...args);
    return handles.has(fd) && hooks.handle ? hooks.handle(s, handles.get(fd)) : s;
  };
  fs.readSync = function(fd, buffer, offset, length, position) {
    if (handles.has(fd) && hooks.read) hooks.read();
    const n = saved.readSync.call(fs, fd, buffer, offset, length, position);
    if (handles.has(fd)) { meter.readBytes += n; meter.requested = Math.max(meter.requested, length); }
    return n;
  };
  fs.closeSync = function(fd) {
    const index = handles.get(fd), value = saved.closeSync.call(fs, fd);
    if (index) { handles.delete(fd); meter.closed++; if (hooks.close) hooks.close(index); }
    return value;
  };
  let result;
  try { result = readStoreFile(f.workspace, f.name); }
  finally { Object.assign(fs, saved); }
  assert.strictEqual(handles.size, 0, 'every opened handle must be closed');
  return { result, meter };
}
function accepted(result, bytes) {
  assert.strictEqual(result.status, 'valid', JSON.stringify(result));
  assert.strictEqual(result.reasonCode, 'read_ok');
  assert.strictEqual(result.text, bytes.toString('utf8'));
  assert.strictEqual(result.bytesRead, bytes.length);
}
function refused(result, reason) {
  assert.notStrictEqual(result.status, 'valid');
  assert.strictEqual(Object.hasOwn(result, 'text'), false, 'failed observations must not expose source text');
  if (reason) assert.strictEqual(result.reasonCode, reason);
  assert(!JSON.stringify(result).includes('private I/O fault'));
}
const ioFailure = () => { throw Object.assign(new Error('private I/O fault'), { code: 'EIO' }); };
for (const name of ['decisions.json', 'lessons.json', 'agent-roles.json', 'decisions.md', 'lessons.md']) {
  test(`native ${name} observation preserves bytes and metadata`, () => {
    const f = fixture(name), before = fingerprint(f); accepted(readStoreFile(f.workspace, name), f.bytes);
    assert.deepStrictEqual(fingerprint(f), before);
  });
}
test('actual CLI admits valid canonical stores without exposing their text', () => {
  const f = fixture('decisions.json', Buffer.from('[{"title":"synthetic-private-source"}]'));
  fs.writeFileSync(path.join(f.workspace, 'lessons.json'), '[]');
  fs.writeFileSync(path.join(f.workspace, 'agent-roles.json'), '{"schemaVersion":1,"roles":{}}');
  const before = fingerprint(f);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP)$/i.test(k)));
  const child = cp.spawnSync(process.execPath, [path.resolve(__dirname, '../bin/leerness.js'), 'state', 'stores', '--path', f.root, '--json'],
    { cwd: arena, env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.strictEqual(child.status, 0, child.stderr || child.stdout);
  const report = JSON.parse(child.stdout); assert.strictEqual(report.ok, true);
  assert.strictEqual(report.readOnly, true); assert.strictEqual(report.writesPerformed, false);
  assert(report.stores.every(s => s.canonical.status === 'valid'));
  assert(!child.stdout.includes('synthetic-private-source'));
  assert.deepStrictEqual(fingerprint(f), before);
});
if (process.platform === 'win32') {
  test('zero path device requires confirmation without a second content read', () => {
    const f = fixture(), before = fingerprint(f), { result, meter } = observed(f); accepted(result, f.bytes);
    assert.strictEqual(meter.opens, 2); assert.strictEqual(meter.closed, 2);
    assert.strictEqual(meter.readBytes, f.bytes.length); assert.deepStrictEqual(fingerprint(f), before);
  });
  test('nonzero path device retains the single-handle fast path', () => {
    const f = fixture(), fd = fs.openSync(f.file, 'r'), dev = fs.fstatSync(fd, { bigint: true }).dev; fs.closeSync(fd);
    const { result, meter } = observed(f, { path: s => clone(s, { dev }) }); accepted(result, f.bytes);
    assert.strictEqual(meter.opens, 1);
  });
  for (const field of ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']) test(`confirmation rejects changed ${field}`, () => {
    const f = fixture(), before = fingerprint(f);
    const { result } = observed(f, { handle: (s, index) => index === 2 ? clone(s, { [field]: s[field] + 1n }) : s });
    refused(result, 'changed_during_read'); assert.deepStrictEqual(fingerprint(f), before);
  });
  for (const field of ['dev', 'ino']) test(`unavailable opened ${field} is rejected before read`, () => {
    const f = fixture(), { result, meter } = observed(f, { handle: s => clone(s, { [field]: 0n }) });
    refused(result, 'changed_before_read'); assert.strictEqual(meter.readBytes, 0);
  });
  test('a nonzero different pathname device is rejected', () => {
    const { result } = observed(fixture(), { path: s => clone(s, { dev: 987654321n }) }); refused(result, 'changed_before_read');
  });
  for (const action of ['open', 'stat', 'close']) test(`confirmation ${action} failure stays a bounded unreadable result`, () => {
    const f = fixture(), hooks = {};
    if (action === 'open') hooks.open = index => { if (index === 2) ioFailure(); };
    if (action === 'stat') hooks.handle = (s, index) => { if (index === 2) ioFailure(); return s; };
    if (action === 'close') hooks.close = index => { if (index === 2) ioFailure(); };
    refused(observed(f, hooks).result, 'read_failed');
  });
  test('primary close failure suppresses otherwise valid text', () => {
    const { result } = observed(fixture(), { close: index => { if (index === 1) ioFailure(); } }); refused(result, 'read_failed');
  });
  test('both closes are attempted while preserving an earlier identity failure', () => {
    const o = observed(fixture(), { handle: (s, i) => i === 2 ? clone(s, { ino: s.ino + 1n }) : s, close: ioFailure });
    refused(o.result, 'changed_during_read'); assert.strictEqual(o.meter.closed, 2);
  });
  test('last pathname link is rejected after matching handles', () => {
    let confirmed = false;
    refused(observed(fixture(), { handle: (s, i) => { if (i === 2) confirmed = true; return s; },
      path: s => confirmed ? clone(s, { isSymbolicLink: () => true }) : s }).result, 'changed_during_read');
  });
  test('parent is rechecked after confirmation', () => {
    let confirmed = false;
    refused(observed(fixture(), { handle: (s, i) => { if (i === 2) confirmed = true; return s; },
      parent: s => confirmed ? clone(s, { ino: s.ino + 1n }) : s }).result, 'workspace_changed');
  });
  test('actual file replacement during confirmation preserves original evidence', () => {
    const f = fixture(), retained = f.file + '.retained';
    const o = observed(f, { open: i => { if (i === 2) { fs.renameSync(f.file, retained); fs.writeFileSync(f.file, f.bytes); } } });
    refused(o.result, 'changed_during_read'); assert.deepStrictEqual(fs.readFileSync(retained), f.bytes);
  });
} else test('POSIX device zero does not waive strict identity', () => refused(observed(fixture()).result, 'changed_before_read'));

test('read failure remains bounded and closes its handle', () => {
  const f = fixture(), o = observed(f, { read: ioFailure }, false); refused(o.result, 'read_failed');
  assert.strictEqual(o.meter.closed, 1);
});
test('exact 1MiB is allowed, while known 1MiB+1 is refused before opening', () => {
  const f = fixture('decisions.md', Buffer.alloc(MAX_BYTES, 0x20)); accepted(readStoreFile(f.workspace, f.name), f.bytes);
  const large = fixture('decisions.md', Buffer.alloc(MAX_BYTES + 1, 0x20));
  const o = observed(large, {}, false); refused(o.result, 'size_limit'); assert.strictEqual(o.meter.opens, 0);
});
test('growth beyond small observed metadata consumes at most limit+1 bytes', () => {
  const f = fixture('decisions.md', Buffer.alloc(MAX_BYTES + 1024, 0x20));
  const o = observed(f, { path: s => clone(s, { size: 2n }), handle: s => clone(s, { size: 2n }) }, false);
  refused(o.result, 'size_limit'); assert.strictEqual(o.result.bytesRead, MAX_BYTES + 1);
  assert.strictEqual(o.meter.readBytes, MAX_BYTES + 1); assert(o.meter.requested <= MAX_BYTES + 1);
});
test('invalid UTF-8 remains unsupported after identity admission', () => {
  const f = fixture('decisions.md', Buffer.from([0xff])); refused(readStoreFile(f.workspace, f.name), 'invalid_utf8');
});
test('unsupported paths never open a file', () => {
  const f = fixture(); f.name = '../private'; const o = observed(f); refused(o.result, 'store_not_supported'); assert.strictEqual(o.meter.opens, 0);
});
process.stdout.write(`\n${total - failed}/${total} passed; artifacts: ${arena}\n`);
process.exitCode = failed ? 1 : 0;
