'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');
const cp = require('child_process');
const locks = require('../lib/state-lock');
const ledger = require('../lib/role-fallback');
const { removeTree } = require('./temp-cleanup');
const record = id => ({ event: 'dispatch.prepared', eventId: id, taskId: 'T-LOCK', executed: false });
const cli = path.resolve(__dirname, '../bin/leerness.js');
function cliLock() {
  // Execute the real CLI implementation without dispatching a CLI command.
  const loaded = new Module(cli + '.lock-probe', module);
  loaded.filename = cli; loaded.paths = Module._nodeModulePaths(path.dirname(cli));
  loaded._compile(fs.readFileSync(cli, 'utf8').replace(/^#![^\r\n]*\r?\n/, '')
    + '\nmodule.exports.__lockProbe = _withLock;\n', cli);
  return loaded.exports.__lockProbe;
}
const tests = [];
const test = (name, run) => tests.push({ name, run });
const lockFile = root => path.join(root, '.leerness', 'execution-ledger.jsonl');
const seed = root => { fs.mkdirSync(path.join(root, '.leerness')); ledger.appendExecutionEvent(root, record('initial')); };
const pending = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|LOCALAPPDATA)$/i.test(k)));
env.LEERNESS_OFFLINE = '1';
const child = (mode, root, id) => new Promise((resolve, reject) => {
  const p = cp.spawn(process.execPath, [__filename, '--child', mode, root, id || ''], {
    env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let out = '', err = '';
  p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
  const timeout = setTimeout(() => p.kill('SIGKILL'), 20000);
  p.on('error', reject); p.on('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, out, err }); });
});
test('separate async callers cannot borrow the pending CLI lock', async root => {
  const withLock = cliLock(), target = path.join(root, 'store.json');
  let finish, entered = false;
  const first = withLock(target, () => new Promise(resolve => { finish = resolve; }));
  try {
    assert.throws(() => withLock(target, () => { entered = true; }, { maxWaitMs: 5 }),
      error => error.code === 'E_LOCK_BUSY', 'LOCK_ASYNC_SCOPE_BYPASS');
    assert.equal(entered, false);
    assert(fs.existsSync(target + '.lock'));
  } finally { finish(1); assert.equal(await first, 1); }
  assert.equal(fs.existsSync(target + '.lock'), false);
});
test('CLI and library nested work share one owner token', root => {
  const withCliLock = cliLock(), target = path.join(root, 'store.json');
  withCliLock(target, () => {
    const before = fs.readdirSync(target + '.lock');
    assert.equal(locks.withStateLock(target, () => locks.isStateLockHeld(target)), true);
    assert.deepEqual(fs.readdirSync(target + '.lock'), before);
  });
  assert.equal(locks.isStateLockHeld(target), false);
});
test('library holder excludes a separate CLI call without blocking its Promise', async root => {
  const withCliLock = cliLock(), target = path.join(root, 'store.json'), done = pending();
  const first = locks.withStateLock(target, () => done.promise);
  try { assert.throws(() => withCliLock(target, () => assert.fail('foreign entry')), { code: 'E_LOCK_BUSY' }); }
  finally { done.resolve(); await first; }
});
test('nested work remains admitted after await', async root => {
  const target = path.join(root, 'store.json');
  assert.equal(await locks.withStateLock(target, async () => {
    await Promise.resolve(); return locks.withStateLock(target, () => 42);
  }), 42);
});
test('a pending lock does not block an unrelated file', async root => {
  const done = pending(), first = locks.withStateLock(path.join(root, 'one'), () => done.promise);
  try { assert.equal(locks.withStateLock(path.join(root, 'two'), () => 7), 7); }
  finally { done.resolve(); await first; }
});
for (const alias of ['relative', ...(process.platform === 'win32' ? ['case'] : [])]) test(`${alias} spelling cannot bypass an active owner`, async root => {
  const target = path.join(root, 'store.json'), done = pending();
  const first = locks.withStateLock(target, () => done.promise);
  const other = alias === 'case' ? target.toUpperCase() : path.relative(process.cwd(), target);
  try { assert.throws(() => locks.withStateLock(other, () => assert.fail('alias entry')), { code: 'E_LOCK_BUSY' }); }
  finally { done.resolve(); await first; }
});
test('detached old async context cannot borrow a later owner', async root => {
  const target = path.join(root, 'store.json'), detached = pending(), current = pending(); let late;
  locks.withStateLock(target, () => {
    late = detached.promise.then(() => {
      assert.throws(() => locks.withStateLock(target, () => assert.fail('stale scope')), { code: 'E_LOCK_BUSY' });
    });
  });
  const active = locks.withStateLock(target, () => current.promise);
  try { detached.resolve(); await late; }
  finally { current.resolve(); await active; }
});
test('sync exceptions and Promise rejection release the owner', async root => {
  const target = path.join(root, 'store.json');
  assert.throws(() => locks.withStateLock(target, () => { throw new Error('sync fixture'); }), /sync fixture/);
  assert(!fs.existsSync(target + '.lock'));
  await assert.rejects(locks.withStateLock(target, async () => { throw new Error('async fixture'); }), /async fixture/);
  assert(!fs.existsSync(target + '.lock'));
});
test('nested work checks the stored owner before entry', root => {
  const target = path.join(root, 'store.json');
  assert.throws(() => locks.withStateLock(target, () => {
    const ownerFile = path.join(target + '.lock', fs.readdirSync(target + '.lock')[0]);
    const owner = JSON.parse(fs.readFileSync(ownerFile)); owner.token = 'f'.repeat(32);
    fs.writeFileSync(ownerFile, JSON.stringify(owner));
    assert.throws(() => locks.withStateLock(target, () => assert.fail('lost owner')), { code: 'E_LOCK_OWNERSHIP_LOST' });
  }), { code: 'E_LOCK_OWNERSHIP_LOST' });
  assert(fs.existsSync(target + '.lock'), 'unconfirmed owner must not be deleted');
});
test('ledger appends use the real shared lock even with a legacy hook', root => {
  seed(root); let hookRan = false;
  ledger.appendExecutionEvent(root, record('legacy'), { withLock: (file, fn) => {
    assert.equal(locks.isStateLockHeld(file), true);
    assert(fs.existsSync(file + '.lock')); hookRan = true; return fn();
  } });
  assert(hookRan); assert.equal(ledger.readExecutionEvents(root).events.length, 2);
});
test('the ledger transaction holds one owner across reads and nested appends', root => {
  seed(root);
  ledger.withExecutionLedgerLock(root, () => {
    const file = lockFile(root), before = fs.readdirSync(file + '.lock');
    assert.equal(ledger.readExecutionEvents(root).events.length, 1);
    ledger.appendExecutionEvent(root, record('nested'));
    assert.deepEqual(fs.readdirSync(file + '.lock'), before);
    assert.equal(ledger.readExecutionEvents(root).events.length, 2);
  });
});
test('default ledger append cannot borrow an unrelated pending CLI lock', async root => {
  seed(root); const file = lockFile(root), before = fs.readFileSync(file), done = pending();
  const active = cliLock()(file, () => done.promise);
  try {
    assert.throws(() => ledger.appendExecutionEvent(root, record('forbidden'), { withLock: () => assert.fail('hook bypass') }), { code: 'E_LOCK_BUSY' });
    assert(fs.readFileSync(file).equals(before));
  } finally { done.resolve(); await active; }
});
test('the library lock respects dry-run before metadata creation', root => {
  const io = require('../lib/io'), target = path.join(root, 'store.json');
  io.setDryRunGuard(true);
  try { assert.throws(() => locks.withStateLock(target, () => assert.fail('dry run entered')), { code: 'E_DRY_RUN_WRITE' }); }
  finally { io.setDryRunGuard(false); }
  assert.deepEqual(fs.readdirSync(root), []);
});
for (const mode of ['cli', 'library']) test(`another process using ${mode} honors the same ledger lock`, async root => {
  seed(root); const file = lockFile(root), before = fs.readFileSync(file);
  await ledger.withExecutionLedgerLock(root, async () => {
    const result = await child(mode, root);
    assert.equal(result.code, 0, result.err); assert.equal(result.out.trim(), 'E_LOCK_TIMEOUT');
    assert(fs.readFileSync(file).equals(before));
  });
});
test('independent processes serialize complete ledger transactions', async root => {
  seed(root);
  const results = await Promise.all(['a','b','c','d'].map(id => child('append', root, id)));
  for (const result of results) assert.equal(result.code, 0, result.err);
  const result = ledger.readExecutionEvents(root, 30, { preserveAll: true }); assert.equal(result.ok, true);
  assert.equal(result.events.length, 13); assert.equal(new Set(result.events.map(e => e.eventId)).size, 13);
  assert(!fs.existsSync(lockFile(root) + '.lock'));
});
if (process.argv[2] === '--child') {
  const [mode, root, id] = process.argv.slice(3);
  if (mode === 'append') {
    for (let i = 0; i < 3; i++) ledger.withExecutionLedgerLock(root, () => ledger.appendExecutionEvent(root, record(id + i)));
  } else {
    const withLock = mode === 'cli' ? cliLock() : locks.withStateLock;
    assert.throws(() => withLock(lockFile(root), () => assert.fail('foreign process entered'), { maxWaitMs: 20 }), error => {
      assert.equal(error.code, 'E_LOCK_TIMEOUT'); process.stdout.write(error.code); return true;
    });
  }
} else {
(async () => {
  const arena = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-state-lock-'));
  const args = process.argv.slice(2);
  let passed = 0;
  try {
    assert(args.length === 0 || (args.length === 2 && args[0] === '--filter' && args[1]), 'Usage: --filter <substring>');
    const selected = args.length ? tests.filter(t => t.name.includes(args[1])) : tests;
    assert(selected.length, 'no tests selected');
    for (const t of selected) {
      const root = fs.mkdtempSync(path.join(arena, 'case-'));
      try { await t.run(root); passed++; console.log('PASS ' + t.name); }
      catch (error) { console.error('FAIL SHARED_LOCK ' + t.name + '\n' + error.stack); }
    }
    console.log(`Tests: ${passed} passed, ${selected.length - passed} failed, ${selected.length} total`);
    process.exitCode = passed === selected.length ? 0 : 1;
  } finally {
    assert(path.dirname(arena) === fs.realpathSync.native(os.tmpdir()));
    removeTree(arena, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
