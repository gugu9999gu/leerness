'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

// Real filesystem writes and process termination; injected I/O faults are
// explicitly synthetic. These checks do not simulate physical power loss.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const ledger = require('../lib/role-fallback');
const { removeTree } = require('./temp-cleanup');
const event = id => ({ event: 'dispatch.prepared', eventId: id, taskId: 'T-SYNC', executed: false });
const ledgerPath = root => path.join(root, '.leerness', 'execution-ledger.jsonl');
const fault = () => Object.assign(new Error('synthetic storage fault'), { code: 'EIO' });
const target = file => path.basename(String(file)) === 'execution-ledger.jsonl'
  || path.basename(String(file)).startsWith('.execution-ledger-create-');

function watch(run, hooks = {}) {
  const keys = ['openSync', 'writeSync', 'fsyncSync', 'closeSync', 'linkSync'];
  const saved = Object.fromEntries(keys.map(k => [k, fs[k]]));
  const live = new Map(), steps = [];
  fs.openSync = function(file, flags, ...args) {
    const fd = saved.openSync.call(fs, file, flags, ...args);
    const writable = typeof flags === 'string' ? /[wa+]/.test(flags) : !!(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR));
    if (target(file) && writable) live.set(fd, String(file));
    return fd;
  };
  fs.writeSync = function(fd, buffer, offset, length, position) {
    if (!live.has(fd)) return saved.writeSync.apply(fs, arguments);
    if (hooks.beforeWrite) hooks.beforeWrite({ fd, buffer, offset, length, position, saved, file: live.get(fd), steps });
    const size = hooks.shortWrite ? Math.min(13, length) : length;
    const written = saved.writeSync.call(fs, fd, buffer, offset, size, position);
    steps.push('write');
    return written;
  };
  fs.fsyncSync = function(fd) {
    if (!live.has(fd)) return saved.fsyncSync.call(fs, fd);
    steps.push('sync');
    if (hooks.beforeSync) hooks.beforeSync(live.get(fd), steps);
    saved.fsyncSync.call(fs, fd);
    if (hooks.afterSync) hooks.afterSync(live.get(fd), steps);
  };
  fs.closeSync = function(fd) {
    const tracked = live.has(fd);
    const result = saved.closeSync.call(fs, fd);
    if (tracked) { live.delete(fd); steps.push('close'); if (hooks.afterClose) hooks.afterClose(); }
    return result;
  };
  fs.linkSync = function(from, to) {
    if (target(from)) steps.push('publish');
    return saved.linkSync.call(fs, from, to);
  };
  let value, error;
  try { value = run(); } catch (e) { error = e; }
  finally { Object.assign(fs, saved); }
  assert.equal(live.size, 0, 'all writable descriptors must close');
  return { value, error, steps };
}

if (process.argv[2] === '--child') {
  const [mode, root] = process.argv.slice(3);
  if (mode === 'read') {
    process.stdout.write(JSON.stringify(ledger.readExecutionEvents(root, 20, { preserveAll: true })));
  } else if (mode === 'partial') {
    watch(() => ledger.appendExecutionEvent(root, event('evt-child')), { beforeWrite: io => {
      io.saved.writeSync.call(fs, io.fd, io.buffer, io.offset, Math.min(17, io.length), io.position);
      process.kill(process.pid, 'SIGKILL');
    } });
    throw new Error('termination seam was not reached');
  } else {
    assert.equal(ledger.appendExecutionEvent(root, event('evt-child')).ok, true);
    process.kill(process.pid, 'SIGKILL'); // success exists on disk, caller receives no acknowledgement
    throw new Error('termination did not stop process');
  }
} else {
  const arena = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-ledger-sync-'));
  const cases = [];
  const test = (name, run) => cases.push({ name, run });
  function fixture(existing) {
    const root = fs.mkdtempSync(path.join(arena, 'case-'));
    fs.mkdirSync(path.join(root, '.leerness'));
    if (existing) ledger.appendExecutionEvent(root, event('evt-initial'));
    return { root, file: ledgerPath(root), before: existing ? fs.readFileSync(ledgerPath(root)) : Buffer.alloc(0) };
  }
  const write = f => ledger.appendExecutionEvent(f.root, event('evt-written'));
  const healthy = f => {
    const result = ledger.readExecutionEvents(f.root, 20, { preserveAll: true });
    assert.equal(result.ok, true, JSON.stringify(result)); return result;
  };
  for (const existing of [false, true]) {
    const kind = existing ? 'append' : 'create';
    test(`${kind}: synchronize the written descriptor before success`, () => {
      const f = fixture(existing), r = watch(() => write(f));
      assert.ifError(r.error); assert.equal(r.value.ok, true);
      assert.equal(r.steps.filter(x => x === 'sync').length, 1, 'LEDGER_SYNC_MISSING');
      assert(r.steps.indexOf('write') < r.steps.indexOf('sync'));
      assert(r.steps.indexOf('sync') < r.steps.indexOf('close'));
      if (!existing) assert(r.steps.indexOf('sync') < r.steps.indexOf('publish'));
      assert.equal(healthy(f).events.length, existing ? 2 : 1);
    });
    test(`${kind}: short writes complete before one synchronization`, () => {
      const f = fixture(existing), r = watch(() => write(f), { shortWrite: true });
      assert.ifError(r.error); assert(r.steps.filter(x => x === 'write').length > 1);
      assert.equal(r.steps.filter(x => x === 'sync').length, 1);
      assert(r.steps.lastIndexOf('write') < r.steps.indexOf('sync'));
      assert.equal(healthy(f).events.length, existing ? 2 : 1);
    });
    test(`${kind}: synchronization failure is explicit and never retried`, () => {
      const f = fixture(existing), r = watch(() => write(f), { beforeSync: () => { throw fault(); } });
      assert(r.error, 'LEDGER_SYNC_MISSING'); assert.equal(r.error.code, 'ledger_sync_failed');
      assert.equal(r.value, undefined); assert.equal(r.steps.filter(x => x === 'sync').length, 1);
      if (existing) {
        const bytes = fs.readFileSync(f.file); assert(bytes.subarray(0, f.before.length).equals(f.before));
        assert.equal(healthy(f).events.length, 2, 'complete but unconfirmed bytes must not be removed');
      } else { assert.equal(fs.existsSync(f.file), false); assert(!r.steps.includes('publish')); }
    });
    test(`${kind}: first synchronization error survives a close error`, () => {
      const f = fixture(existing), r = watch(() => write(f), {
        beforeSync: () => { throw fault(); }, afterClose: () => { throw new Error('synthetic close fault'); },
      });
      assert.equal(r.error && r.error.code, 'ledger_sync_failed');
    });
    test(`${kind}: write failure is not synchronized or reported as success`, () => {
      const f = fixture(existing), r = watch(() => write(f), { beforeWrite: () => { throw fault(); } });
      assert.equal(r.error && r.error.code, 'EIO'); assert(!r.steps.includes('sync'));
      if (existing) assert(fs.readFileSync(f.file).equals(f.before));
      else assert.equal(fs.existsSync(f.file), false);
    });
    test(`${kind}: close failure after synchronization still rejects success`, () => {
      const f = fixture(existing), r = watch(() => write(f), { afterClose: () => { throw fault(); } });
      assert.equal(r.error && r.error.code, 'EIO'); assert(r.steps.includes('sync'));
      if (!existing) assert.equal(fs.existsSync(f.file), false);
    });
  }
  test('append: an edit during synchronization is detected after synchronization', () => {
    const f = fixture(true), r = watch(() => write(f), { afterSync: () => fs.appendFileSync(f.file, 'unexpected\n') });
    assert.equal(r.error && r.error.code, 'ledger_file_changed');
    assert(fs.readFileSync(f.file).subarray(0, f.before.length).equals(f.before));
  });
  test('append: partial write failure preserves bytes and blocks a subsequent append', () => {
    const f = fixture(true); let writes = 0;
    const r = watch(() => write(f), { shortWrite: true, beforeWrite: () => { if (writes++) throw fault(); } });
    assert.equal(r.error && r.error.code, 'EIO'); assert(!r.steps.includes('sync'));
    const partial = fs.readFileSync(f.file); assert.equal(partial.length, f.before.length + 13);
    assert.throws(() => require('../lib/state-lock').withStateLock(f.file, () => write(f), { maxWaitMs: 10 }));
    assert(fs.readFileSync(f.file).equals(partial));
  });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP)$/i.test(k)));
  const child = (mode, root) => cp.spawnSync(process.execPath, [__filename, '--child', mode, root], {
    env, cwd: arena, encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  for (const existing of [false, true]) test(`${existing ? 'append' : 'create'}: fresh process reads after writer dies without acknowledgement`, () => {
    const f = fixture(existing), writer = child('complete', f.root);
    assert.ifError(writer.error); assert.notEqual(writer.status, 0); assert.equal(writer.stdout, '');
    const before = fs.readFileSync(f.file), reader = child('read', f.root);
    assert.ifError(reader.error); assert.equal(reader.status, 0, reader.stderr);
    const result = JSON.parse(reader.stdout); assert.equal(result.ok, true);
    assert.equal(result.events.filter(e => e.eventId === 'evt-child').length, 1);
    assert(fs.readFileSync(f.file).equals(before), 'recovery reads must not append again');
  });
  test('append: process death during write leaves rejected history intact', () => {
    const f = fixture(true), writer = child('partial', f.root);
    assert.ifError(writer.error); assert.notEqual(writer.status, 0);
    const partial = fs.readFileSync(f.file); assert.equal(partial.length, f.before.length + 17);
    const reader = child('read', f.root); assert.equal(reader.status, 0, reader.stderr);
    assert.equal(JSON.parse(reader.stdout).ok, false);
    assert.throws(() => require('../lib/state-lock').withStateLock(f.file, () => write(f), { maxWaitMs: 10 }));
    assert(fs.readFileSync(f.file).equals(partial));
  });
  const args = process.argv.slice(2);
  let selected = cases;
  if (args.length) {
    selected = cases.filter(c => c.name.includes(args[1]));
  }
  let passed = 0;
  try {
    assert(args.length === 0 || (args.length === 2 && args[0] === '--filter' && args[1]), 'Usage: --filter <name substring>');
    assert(selected.length > 0, 'no tests selected');
    for (const c of selected) {
      try { c.run(); passed++; process.stdout.write(`PASS ${c.name}\n`); }
      catch (error) { process.stderr.write(`FAIL LEDGER_SYNC ${c.name}: ${error.stack}\n`); }
    }
    process.stdout.write(`Tests: ${passed} passed, ${selected.length - passed} failed, ${selected.length} total\n`);
    process.exitCode = passed === selected.length ? 0 : 1;
  } finally {
    assert(path.dirname(arena) === fs.realpathSync.native(os.tmpdir()));
    removeTree(arena, { recursive: true, force: true });
  }
}
