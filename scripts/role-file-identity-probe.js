'use strict';

// Real role/ledger files; narrow stat and I/O seams only. No provider is invoked.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const roles = require('../lib/role-store');
const ledger = require('../lib/role-fallback');
const arena = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-role-identity-'));
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const clone = (stat, fields) => Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, fields);
// Number-based legacy Stats can have inode values above MAX_SAFE_INTEGER.
// Use a representable change; +1 can be rounded back to the original value.
const changedValue = value => value + Math.max(1, Math.abs(value) * Number.EPSILON * 2);
let total = 0, failed = 0;
function test(name, run) {
  total++;
  try { run(); process.stdout.write(`PASS ${name}\n`); }
  catch (error) { failed++; process.stderr.write(`FAIL RL_FILE_IDENTITY ${name}: ${error.stack}\n`); }
}
function fixture(kind) {
  const root = fs.mkdtempSync(path.join(arena, 'case-'));
  fs.mkdirSync(path.join(root, '.leerness'));
  const file = path.join(root, '.leerness', kind === 'roles' ? 'agent-roles.json' : 'execution-ledger.jsonl');
  if (kind === 'roles') fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, roles: {}, extension: { retained: true } }) + '\n');
  else ledger.appendExecutionEvent(root, { event: 'dispatch.prepared', eventId: 'evt-initial', taskId: 'T-PROBE', executed: false });
  return { root, file, kind, before: fs.readFileSync(file) };
}
function operation(f) {
  if (f.kind === 'roles') return roles.readRoleStore(f.root);
  if (f.kind === 'read') return ledger.readExecutionEvents(f.root, 20, { preserveAll: true });
  return ledger.appendExecutionEvent(f.root, { event: 'dispatch.prepared', eventId: 'evt-appended', taskId: 'T-PROBE', executed: false });
}
function observed(f, hooks = {}, zeroPath = true) {
  const saved = Object.fromEntries(['lstatSync', 'openSync', 'fstatSync', 'readSync', 'writeSync', 'closeSync'].map(k => [k, fs[k]]));
  const live = new Map(), meter = { opens: 0, closed: 0, writes: 0, readBytes: 0, pathStats: 0 };
  fs.lstatSync = function(file, ...args) {
    let stat = saved.lstatSync.call(fs, file, ...args);
    if (String(file) === path.dirname(f.file) && hooks.parentStat) stat = hooks.parentStat(stat, meter);
    if (String(file) === f.file) {
      meter.pathStats++;
      if (zeroPath) stat = clone(stat, { dev: 0 });
      if (hooks.pathStat) stat = hooks.pathStat(stat, meter);
    }
    return stat;
  };
  fs.openSync = function(file, ...args) {
    const target = String(file) === f.file;
    if (target) { meter.opens++; if (hooks.open) hooks.open(meter.opens, meter); }
    const fd = saved.openSync.call(fs, file, ...args);
    if (target) live.set(fd, meter.opens);
    return fd;
  };
  fs.fstatSync = function(fd, ...args) {
    const stat = saved.fstatSync.call(fs, fd, ...args);
    return live.has(fd) && hooks.handleStat ? hooks.handleStat(stat, live.get(fd), meter) : stat;
  };
  fs.readSync = function(fd, ...args) {
    const n = saved.readSync.call(fs, fd, ...args);
    if (live.has(fd)) { meter.readBytes += n; if (hooks.read) hooks.read(live.get(fd), meter); }
    return n;
  };
  fs.writeSync = function(fd, ...args) {
    if (live.has(fd) && hooks.beforeWrite) hooks.beforeWrite(live.get(fd), meter);
    const n = saved.writeSync.call(fs, fd, ...args);
    if (live.has(fd)) meter.writes += n;
    return n;
  };
  fs.closeSync = function(fd) {
    const index = live.get(fd), result = saved.closeSync.call(fs, fd);
    if (index) { live.delete(fd); meter.closed++; if (hooks.close) hooks.close(index, meter); }
    return result;
  };
  let result;
  try { result = operation(f); }
  catch (error) { result = { ok: false, code: error.code, error: error.message }; }
  finally { Object.assign(fs, saved); }
  assert.strictEqual(live.size, 0, 'all opened handles must be closed');
  return { result, meter };
}
const accepted = result => assert.strictEqual(result.ok, true, JSON.stringify(result));
function rejected(f, observation, unchanged = true) {
  assert.strictEqual(observation.result.ok, false);
  if (unchanged) assert.deepStrictEqual(fs.readFileSync(f.file), f.before, 'rejected observation must preserve original bytes');
}
const ioFailure = () => { throw Object.assign(new Error('private confirmation fault'), { code: 'EIO' }); };

test('native role reads and existing-store saves preserve extensions', () => {
  const f = fixture('roles'), before = fs.statSync(f.file);
  const state = roles.readRoleStore(f.root); accepted(state);
  assert.deepStrictEqual(fs.readFileSync(f.file), f.before);
  assert.strictEqual(fs.statSync(f.file).mtimeMs, before.mtimeMs);
  roles.saveRoles(f.root, { coder: { provider: 'codex', model: 'synthetic-model' } }, state);
  const after = roles.readRoleStore(f.root); accepted(after);
  assert.strictEqual(after.document.extension.retained, true);
  assert.strictEqual(after.roles.coder.model, 'synthetic-model');
});
test('native ledger reads and existing-file appends retain both events', () => {
  const f = fixture('append'); accepted(operation(f));
  const result = ledger.readExecutionEvents(f.root, 20, { preserveAll: true }); accepted(result);
  assert.deepStrictEqual(result.events.map(e => e.eventId).sort(), ['evt-appended', 'evt-initial']);
  assert(fs.readFileSync(f.file).subarray(0, f.before.length).equals(f.before));
});
for (const kind of ['roles', 'read']) test(`actual CLI ${kind} reads are admitted`, () => {
  const f = fixture(kind);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP)$/i.test(k)));
  const args = kind === 'roles' ? ['roles', 'validate'] : ['agents', 'history'];
  const child = cp.spawnSync(process.execPath, [CLI, ...args, '--path', f.root, '--json'], { cwd: arena, env, windowsHide: true, encoding: 'utf8', timeout: 30000 });
  assert.strictEqual(child.status, 0, child.stderr || child.stdout);
  assert.doesNotThrow(() => JSON.parse(child.stdout));
  assert.deepStrictEqual(fs.readFileSync(f.file), f.before);
});

if (process.platform === 'win32') for (const kind of ['roles', 'read', 'append']) {
  const confirmation = kind === 'append' ? 4 : 2;
  test(`${kind}: zero path device requires matching confirmation without content reread`, () => {
    const f = fixture(kind), { result, meter } = observed(f); accepted(result);
    assert.strictEqual(meter.opens, kind === 'append' ? 5 : 2);
    assert.strictEqual(meter.readBytes, f.before.length);
  });
  test(`${kind}: known pathname device keeps fast path`, () => {
    const f = fixture(kind), fd = fs.openSync(f.file, 'r'), dev = fs.fstatSync(fd).dev; fs.closeSync(fd);
    const { result, meter } = observed(f, { pathStat: stat => clone(stat, { dev }) }); accepted(result);
    assert.strictEqual(meter.opens, kind === 'append' ? 2 : 1);
  });
  for (const field of ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs']) test(`${kind}: confirmation ${field} mismatch is rejected before mutation`, () => {
    const f = fixture(kind);
    const o = observed(f, { handleStat: (s, index) => {
      if (index !== confirmation) return s;
      const next = changedValue(s[field]); assert.notStrictEqual(next, s[field]);
      return clone(s, { [field]: next });
    } });
    rejected(f, o); assert.strictEqual(o.meter.writes, 0);
  });
  for (const field of ['dev', 'ino']) test(`${kind}: unavailable opened ${field} is rejected`, () => {
    const f = fixture(kind); rejected(f, observed(f, { handleStat: s => clone(s, { [field]: 0 }) }));
  });
  test(`${kind}: a nonzero wrong path device is never treated as unknown`, () => {
    const f = fixture(kind); rejected(f, observed(f, { pathStat: s => clone(s, { dev: 987654321 }) }));
  });
  for (const action of ['open', 'stat', 'close']) test(`${kind}: confirmation ${action} failure blocks admission and closes handles`, () => {
    const f = fixture(kind), hooks = {};
    if (action === 'open') hooks.open = index => { if (index === confirmation) ioFailure(); };
    if (action === 'stat') hooks.handleStat = (s, index) => { if (index === confirmation) ioFailure(); return s; };
    if (action === 'close') hooks.close = index => { if (index === confirmation) ioFailure(); };
    const o = observed(f, hooks); rejected(f, o);
    assert(!JSON.stringify(o.result).includes('private confirmation fault'));
  });
  test(`${kind}: final pathname link observation is rejected`, () => {
    const f = fixture(kind); let confirmed = false;
    rejected(f, observed(f, {
      handleStat: (s, index) => { if (index === confirmation) confirmed = true; return s; },
      pathStat: s => confirmed ? clone(s, { isSymbolicLink: () => true }) : s,
    }));
  });
  test(`${kind}: parent is rechecked after confirmation`, () => {
    const f = fixture(kind); let confirmed = false;
    rejected(f, observed(f, {
      handleStat: (s, index) => { if (index === confirmation) confirmed = true; return s; },
      parentStat: s => confirmed ? clone(s, { ino: changedValue(s.ino) }) : s,
    }));
  });
  test(`${kind}: actual replacement at confirmation preserves displaced original`, () => {
    const f = fixture(kind), retained = f.file + '.retained';
    const o = observed(f, { open: index => {
      if (index === confirmation) { fs.renameSync(f.file, retained); fs.writeFileSync(f.file, f.before); }
    } });
    rejected(f, o); assert.deepStrictEqual(fs.readFileSync(retained), f.before);
  });
  test(`${kind}: primary read close failure does not admit a read or append`, () => {
    const f = fixture(kind); rejected(f, observed(f, { close: index => { if (index === 1) ioFailure(); } }));
  });
}
if (process.platform === 'win32') {
  test('post-append confirmation rejects a replacement and retains appended original', () => {
    const f = fixture('append'), retained = f.file + '.retained';
    const o = observed(f, { open: index => {
      if (index === 5) { fs.renameSync(f.file, retained); fs.writeFileSync(f.file, f.before); }
    } });
    rejected(f, o);
    assert(o.meter.writes > 0);
    assert(fs.readFileSync(retained).subarray(0, f.before.length).equals(f.before));
    assert(fs.readFileSync(retained).includes(Buffer.from('evt-appended')));
  });
  test('append I/O failure preserves identity reason and closes original handle', () => {
    const f = fixture('append');
    const o = observed(f, { beforeWrite: ioFailure, close: index => { if (index === 3) throw new Error('secondary cleanup fault'); } });
    rejected(f, o); assert.strictEqual(o.result.code, 'EIO');
  });
  test('role stale validated inode cannot overwrite a replacement with identical bytes', () => {
    const f = fixture('roles'), state = roles.readRoleStore(f.root); accepted(state);
    fs.renameSync(f.file, f.file + '.retained'); fs.writeFileSync(f.file, f.before);
    assert.throws(() => roles.saveRoles(f.root, {}, state));
    assert.deepStrictEqual(fs.readFileSync(f.file), f.before);
  });
} else {
  test('POSIX pathname device zero does not waive a known device mismatch', () => {
    const f = fixture('roles'); rejected(f, observed(f));
  });
}
process.stdout.write(`\n${total - failed}/${total} passed; artifacts: ${arena}\n`);
process.exitCode = failed ? 1 : 0;
