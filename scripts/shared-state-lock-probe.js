'use strict';
require('./temp-cleanup').trackTemp(module);  
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
function cliLock(probe = '_withLock') {
   
  const loaded = new Module(cli + '.lock-probe', module);
  loaded.filename = cli; loaded.paths = Module._nodeModulePaths(path.dirname(cli));
  loaded._compile(fs.readFileSync(cli, 'utf8').replace(/^#![^\r\n]*\r?\n/, '')
    + '\nmodule.exports.__lockProbe = ' + probe + ';\n', cli);
  return loaded.exports.__lockProbe;
}
const tests = [];
const test = (name, run) => tests.push({ name, run });
const lockFile = root => path.join(root, '.leerness', 'execution-ledger.jsonl');
const seed = root => { fs.mkdirSync(path.join(root, '.leerness')); ledger.appendExecutionEvent(root, record('initial')); };
const pending = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|LOCALAPPDATA|HOME|USERPROFILE|XDG_STATE_HOME)$/i.test(k)));
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
// ---------------------------------------------------------------------------------------------------------------
// Dead-owner reclaim (T-0376). Owner files are back-dated instead of waited for. A test about the kill itself uses a
// real child that is really killed; a test that only seeds a dead owner uses deadPid().
// ---------------------------------------------------------------------------------------------------------------
const crypto = require('crypto');
const errorLang = require('../lib/error-language');
const sleepMs = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hex = n => crypto.randomBytes(n).toString('hex');
const age = (p, ms) => { const d = new Date(Date.now() - ms); fs.utimesSync(p, d, d); };
const NOTICE = {
  en: /⚠ Cleared a lock left by a stopped process \(pid (\d+)\): ([^\r\n]+)\. Its last change may be incomplete\./g,
  ko: /⚠ 멈춘 프로세스\(pid (\d+)\)가 남긴 잠금을 풀었습니다: ([^\r\n]+)\. 마지막 변경이 끝나지 않았을 수 있습니다\./g,
};
const notices = (text, lang) => [...String(text).matchAll(NOTICE[lang])].map(m => ({ pid: Number(m[1]), file: m[2] }));
const flip = h => (h[0] === 'a' ? 'b' : 'a') + h.slice(1);
// An owner record is borrowed from a real acquisition, so no probe repeats the identity code it checks.
function ownerTemplate(root) {
  if (!ownerTemplate.value) {
    const t = path.join(root, 'template-store.json');
    locks.withStateLock(t, () => {
      const lock = t + '.lock';
      ownerTemplate.value = JSON.parse(fs.readFileSync(path.join(lock, fs.readdirSync(lock)[0]), 'utf8'));
    });
  }
  return ownerTemplate.value;
}
function plant(root, target, o = {}) {
  const lock = target + '.lock', token = o.token || hex(16);
  const record = { ...ownerTemplate(root), token, createdAt: new Date().toISOString(),
    ...(o.pid !== undefined ? { pid: o.pid } : {}), ...(o.patch || {}) };
  fs.mkdirSync(lock);
  const file = path.join(lock, o.fileName || `owner-${token}.json`);
  if (o.ownerAs === 'dir') { fs.mkdirSync(file); fs.writeFileSync(path.join(file, 'inner.txt'), 'x'); }
  else if (o.ownerAs === 'link') {
    const dest = path.join(path.dirname(target), 'owner-link-destination-' + hex(4));
    fs.mkdirSync(dest); fs.writeFileSync(path.join(dest, 'inner.txt'), 'x');
    fs.symlinkSync(dest, file, 'junction');
  } else fs.writeFileSync(file, o.body !== undefined ? o.body : JSON.stringify(record) + '\n');
  const ageMs = o.ageMs === undefined ? 60000 : o.ageMs;
  age(file, ageMs); age(lock, ageMs);
  return { lock, file, token, record };
}
// An owner record padded with an extra field to exactly `size` bytes.
function sized(root, pid, token, size) {
  const record = { ...ownerTemplate(root), pid, token, pad: '' };
  record.pad = 'x'.repeat(size - Buffer.byteLength(JSON.stringify(record) + '\n'));
  const body = JSON.stringify(record) + '\n';
  assert.equal(Buffer.byteLength(body), size);
  return body;
}
function tree(dir) {
  const out = {};
  (function visit(d, rel) {
    for (const name of fs.readdirSync(d).sort()) {
      const f = path.join(d, name), st = fs.lstatSync(f), key = rel + name;
      if (st.isSymbolicLink()) out[key] = 'link';
      else if (st.isDirectory()) { out[key + '/'] = 'dir'; visit(f, key + '/'); }
      else out[key] = st.size + ':' + crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
    }
  })(dir, '');
  return out;
}
function lockState(lock) {
  let st; try { st = fs.lstatSync(lock); } catch (e) { return { missing: e.code }; }
  if (st.isSymbolicLink()) return { link: fs.readlinkSync(lock), inner: tree(fs.realpathSync(lock)) };
  if (st.isDirectory()) return { dir: tree(lock) };
  return { file: crypto.createHash('sha1').update(fs.readFileSync(lock)).digest('hex') };
}
// Runs fn with stderr captured; the real stderr is restored even when fn throws.
function observe(fn) {
  const write = process.stderr.write; let stderr = '', value, error = null;
  process.stderr.write = function (chunk, encoding, callback) {
    stderr += String(chunk); const done = typeof encoding === 'function' ? encoding : callback; if (done) done(); return true;
  };
  try { value = fn(); } catch (e) { error = e; } finally { process.stderr.write = write; }
  return { value, error, stderr };
}
function attempt(target, opts = {}, lang = 'en') {
  let ran = false; const t0 = Date.now();
  const r = observe(() => errorLang.withErrorLanguage(lang, () => locks.withStateLock(target, () => { ran = true; return 1; }, { maxWaitMs: 300, ...opts })));
  return { ran, error: r.error, stderr: r.stderr, ms: Date.now() - t0 };
}
// A PID no process can have. A really killed child's PID can come back as another process on Windows while a long test
// still uses it, and the product then rightly reads it as live. The tests that need a real kill use launch().
let deadPids = 0;
async function deadPid() { return 2147483647 - 4 * deadPids++; }
// A child that can be talked to: it prints lines, waits to be killed, and reports its end.
function launch(mode, root, spec) {
  const p = cp.spawn(process.execPath, [__filename, '--child', mode, root, ''], {
    env: { ...env, ...(spec && spec.home ? { LOCALAPPDATA: spec.home, XDG_STATE_HOME: spec.home, HOME: spec.home, USERPROFILE: spec.home } : {}),
      LOCK_PROBE_SPEC: JSON.stringify(spec || {}) }, cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const run = { p, out: '', err: '', poke: null };
  p.stdout.on('data', d => { run.out += d; if (run.poke) run.poke(); }); p.stderr.on('data', d => { run.err += d; });
  run.closed = new Promise((resolve, reject) => { p.on('error', reject); p.on('close', (code, signal) => { run.code = code; run.signal = signal; resolve(run); }); });
  run.until = (re, ms = 20000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child output never matched ${re}: ${run.out}${run.err}`)), ms);
    const check = () => { if (re.test(run.out)) { clearTimeout(timer); run.poke = null; resolve(run.out); } };
    run.poke = check; check();
  });
  run.kill = async () => { try { p.kill('SIGKILL'); } catch {} await run.closed; };
  setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 90000).unref();
  return run;
}
const abnormal = run => run.code !== 0 || !!run.signal;
let rowSeq = 0;
function rowFixture(root, o = {}) {
  const base = path.join(root, 'row-' + rowSeq++), dir = o.workspace ? path.join(base, '.leerness') : base;
  fs.mkdirSync(dir, { recursive: true });
  // A live workspace, or the runtime layout check blocks every write inside it.
  if (o.workspace) fs.writeFileSync(path.join(dir, 'HARNESS_VERSION'), '1.36.306\n');
  return { base, dir, target: path.join(dir, o.name || 'store.json') };
}
// One row: the owner must be kept untouched with `reason`, or (reason null) reclaimed.
function expectRow(label, row, reason, extra = {}) {
  const lock = row.target + '.lock', before = lockState(lock);
  // A row that must be reclaimed returns as soon as it is, so it can be given a long budget: a loaded machine delays the reclaim
  // for longer than a short budget (this failed once with 400 ms while other probes ran). A row that must stay waits the budget out.
  const r = attempt(row.target, { maxWaitMs: reason === null ? 5000 : 400, staleMs: 1, ...(extra.opts || {}) });
  if (reason === null) {
    assert.equal(r.ran, true, `${label}: expected a reclaim, got ${r.error && r.error.message}`);
    assert.equal(fs.existsSync(lock), false, `${label}: the lock must be gone after the callback`);
    assert.equal(notices(r.stderr, 'en').length, 1, `${label}: exactly one notice`);
  } else {
    assert.equal(r.ran, false, `${label}: the callback ran although the lock must stay`);
    assert.equal(r.error && r.error.code, 'E_LOCK_TIMEOUT', `${label}: ${r.error && r.error.message}`);
    assert.equal(r.error.lockState, reason, `${label}: lockState`);
    assert.deepStrictEqual(lockState(lock), before, `${label}: the lock was touched`);
    if (!extra.skipPath) assert(r.error.message.includes(`Lock path: ${lock}`), `${label}: the message names the lock path`);
    if (extra.message) assert(extra.message.test(r.error.message), `${label}: message was ${r.error.message}`);
    assert.equal(r.stderr.includes('Cleared a lock'), false, `${label}: no notice for a lock that was kept`);
  }
  return r;
}
function dropLink(p) { try { fs.rmdirSync(p); } catch { try { fs.unlinkSync(p); } catch {} } }

test('dead-owner reclaim: a really killed holder is reclaimed, its store bytes stay, and the notice names it (en)', async root => {
  const target = path.join(root, 'store.json'), store = path.join(root, 'held-store.txt'), lock = target + '.lock';
  const holder = launch('hold', root, { target, store, content: 'half written store' });
  try {
    await holder.until(/^held$/m);
    const ownerFile = path.join(lock, fs.readdirSync(lock)[0]);
    assert.equal(JSON.parse(fs.readFileSync(ownerFile, 'utf8')).pid, holder.p.pid);
    await holder.kill();
    assert(fs.existsSync(ownerFile), 'a kill leaves the owner record behind');
    const fresh = attempt(target, { maxWaitMs: 600 });
    assert.equal(fresh.ran, false); assert.equal(fresh.error && fresh.error.code, 'E_LOCK_TIMEOUT');
    assert.equal(fresh.error.lockState, 'dead-owner', 'a dead owner touched seconds ago is still inside the veto');
    assert(/Its owner has stopped\. Retry; the next write clears it\./.test(fresh.error.message), fresh.error.message);
    assert(fs.existsSync(ownerFile));
    age(ownerFile, 60000); age(lock, 60000);
    const r = attempt(target, { maxWaitMs: 5000 });
    assert.equal(r.ran, true, r.error && r.error.message);
    assert(r.ms < 3000, `an old dead owner clears in about a poll, took ${r.ms} ms`);
    const seen = notices(r.stderr, 'en');
    assert.deepStrictEqual(seen, [{ pid: holder.p.pid, file: 'store.json' }], r.stderr);
    assert.equal(fs.existsSync(lock), false);
    assert.equal(fs.readFileSync(store, 'utf8'), 'half written store', 'reclaim must never touch the store bytes');
  } finally { await holder.kill(); }
});
test('dead-owner reclaim: the Korean notice, and LEERNESS_NO_LOCK_WARN silences only the notice', async root => {
  const pid = await deadPid(), saved = process.env.LEERNESS_NO_LOCK_WARN;
  const a = rowFixture(root); plant(root, a.target, { pid });
  const ko = attempt(a.target, { maxWaitMs: 3000 }, 'ko');
  assert.equal(ko.ran, true, ko.error && ko.error.message);
  assert.deepStrictEqual(notices(ko.stderr, 'ko'), [{ pid, file: 'store.json' }], ko.stderr);
  assert.equal(notices(ko.stderr, 'en').length, 0);
  const b = rowFixture(root); plant(root, b.target, { pid });
  process.env.LEERNESS_NO_LOCK_WARN = '1';
  try {
    const quiet = attempt(b.target, { maxWaitMs: 3000 });
    assert.equal(quiet.ran, true, quiet.error && quiet.error.message); assert.equal(quiet.stderr, '');
    assert.equal(fs.existsSync(b.target + '.lock'), false);
  } finally { if (saved === undefined) delete process.env.LEERNESS_NO_LOCK_WARN; else process.env.LEERNESS_NO_LOCK_WARN = saved; }
});
test('dead-owner reclaim: a waiter already waiting at the kill gets the lock about 5 s after the last touch, not sooner', async root => {
  const target = path.join(root, 'store.json'), store = path.join(root, 'order.txt');
  const holder = launch('hold', root, { target, store: path.join(root, 'held-store.txt'), content: 'x' });
  let waiter;
  try {
    await holder.until(/^held$/m);
    waiter = launch('write', root, { target, store, id: 'w', lang: 'en', opts: { maxWaitMs: 25000 } });
    await waiter.until(/^waiting$/m); await pause(400);
    const killedAt = Date.now(); await holder.kill();
    await waiter.closed;
    assert.equal(waiter.code, 0, waiter.out + waiter.err);
    const afterKill = Number(/^done (\d+)$/m.exec(waiter.out)[1]) - killedAt;
    assert(afterKill >= 3000, `the lock was taken ${afterKill} ms after the kill, inside the 5 s veto`);
    assert(afterKill <= 15000, `the lock took ${afterKill} ms to clear`);
    assert.deepStrictEqual(notices(waiter.err, 'en'), [{ pid: holder.p.pid, file: 'store.json' }], waiter.err);
    assert.equal(fs.readFileSync(store, 'utf8'), 'w\n');
  } finally { await holder.kill(); if (waiter) await waiter.kill(); }
});
test('dead-owner reclaim: four waiters after one dead owner all finish, and at least one of them prints the notice', async root => {
  // The first version of this test claimed exactly one notice. On Windows the same file can be unlinked by more than one
  // process at the same moment (measured, Node 18 to 26), so more than one waiter can remove a folder and print.
  // What holds is that every waiter finishes with its line written once and that the clearing is announced.
  const target = path.join(root, 'store.json'), store = path.join(root, 'order.txt'), pid = await deadPid();
  plant(root, target, { pid }); fs.writeFileSync(store, '');
  const startAt = Date.now() + 2500;
  const runs = ['a', 'b', 'c', 'd'].map(id => launch('write', root, { target, store, id, startAt, lang: 'ko', opts: { maxWaitMs: 20000 } }));
  try { await Promise.all(runs.map(r => r.closed)); } finally { for (const r of runs) await r.kill(); }
  for (const r of runs) assert.equal(r.code, 0, r.out + r.err);
  assert.deepStrictEqual(fs.readFileSync(store, 'utf8').trim().split('\n').sort(), ['a', 'b', 'c', 'd']);
  const all = runs.flatMap(r => notices(r.err, 'ko'));
  assert(all.length >= 1, 'at least one notice: ' + runs.map(r => r.err).join('|'));
  for (const n of all) assert.deepStrictEqual(n, { pid, file: 'store.json' }, 'every notice names the dead owner and the store');
  assert.equal(fs.existsSync(target + '.lock'), false);
});
test('dead-owner reclaim: the 5 s freshness veto holds at 3.5 s of owner age and lets go at 6.5 s', async root => {
  const pid = await deadPid();
  const young = rowFixture(root); plant(root, young.target, { pid, ageMs: 3500 });
  expectRow('owner touched 3.5 s ago', young, 'dead-owner');
  const old = rowFixture(root); plant(root, old.target, { pid, ageMs: 6500 });
  expectRow('owner touched 6.5 s ago', old, null);
});
test('dead-owner reclaim: owner records that cannot be proven dead on this host stay untouched (control row is reclaimed)', async root => {
  const pid = await deadPid(), tpl = ownerTemplate(root);
  const rows = [
    ['control: a valid dead owner', null, r => plant(root, r.target, { pid })],
    ['v1 owner record', 'legacy-owner', r => plant(root, r.target, { pid, patch: { v: 1 } })],
    ['host id is not 32 hex', 'legacy-owner', r => plant(root, r.target, { pid, patch: { hostId: 'xyz' } })],
    ['record token differs from the file name', 'malformed-owner', r => plant(root, r.target, { pid, patch: { token: hex(16) } })],
    ['record is not JSON', 'malformed-owner', r => plant(root, r.target, { pid, body: '{not json' })],
    ['pid stored as a string', 'malformed-owner', r => plant(root, r.target, { pid, patch: { pid: String(pid) } })],
    ['oversize owner (4097 bytes)', 'malformed-owner', r => { const token = hex(16); return plant(root, r.target, { pid, token, body: sized(root, pid, token, 4097) }); }],
    ['owner of exactly 4096 bytes (control: reclaimed)', null, r => { const token = hex(16); return plant(root, r.target, { pid, token, body: sized(root, pid, token, 4096) }); }],
    ['owner is a directory', 'malformed-owner', r => plant(root, r.target, { ownerAs: 'dir' })],
    ['owner is a link', 'malformed-owner', r => plant(root, r.target, { ownerAs: 'link' })],
    ['pid 4 or 1 (alive, EPERM)', 'live-owner', r => plant(root, r.target, { pid: process.platform === 'win32' ? 4 : 1 })],
    ['pid 2^40 (not a valid pid)', 'unknown-identity', r => plant(root, r.target, { pid: 2 ** 40 })],
    ['another host name', 'other-host', r => plant(root, r.target, { pid, patch: { host: 'another-computer' } })],
    ['another host id', 'other-host', r => plant(root, r.target, { pid, patch: { hostId: flip(tpl.hostId) } })],
    ['another pid scope', 'other-host', r => plant(root, r.target, { pid, patch: { pidScopeId: flip(tpl.pidScopeId) } })],
    ['two owner files', 'unexpected-entries', r => {
      const first = plant(root, r.target, { pid }), second = path.join(first.lock, `owner-${hex(16)}.json`);
      fs.writeFileSync(second, JSON.stringify({ ...first.record, token: path.basename(second).slice(6, 38) }) + '\n'); age(second, 60000);
    }],
    ['an extra entry beside the owner', 'unexpected-entries', r => {
      const first = plant(root, r.target, { pid }); fs.writeFileSync(path.join(first.lock, 'stray.txt'), 'x'); age(first.lock, 60000);
    }],
    ['owner file name is not owner-<32 hex>.json', 'unexpected-entries', r => plant(root, r.target, { pid, fileName: 'owner-abc.json' })],
    ['lock is a plain file (legacy)', 'legacy-file', r => { fs.writeFileSync(r.target + '.lock', String(pid)); age(r.target + '.lock', 60000); }],
    ['lock folder is a link to a folder holding a valid dead owner', 'link', r => {
      const dest = path.join(r.dir, 'real-lock'), token = hex(16);
      fs.mkdirSync(dest); const file = path.join(dest, `owner-${token}.json`);
      fs.writeFileSync(file, JSON.stringify({ ...tpl, pid, token, createdAt: new Date().toISOString() }) + '\n'); age(file, 60000);
      fs.symlinkSync(dest, r.target + '.lock', 'junction');
    }],
  ];
  const links = [];
  try {
    for (const [label, reason, build] of rows) {
      const r = rowFixture(root); build(r);
      if (/link/.test(label)) links.push(r.target + '.lock');
      expectRow(label, r, reason);
    }
  } finally { for (const l of links) { try { if (fs.lstatSync(l).isSymbolicLink()) dropLink(l); } catch {} } }
});
test('dead-owner reclaim: an owner that is a link by lstat is kept even when stat would call it a file', async root => {
  // A file symlink cannot always be created (Windows without developer mode), so lstat is answered by a patch.
  const pid = await deadPid(), row = rowFixture(root), s = plant(root, row.target, { pid });
  const original = fs.lstatSync; let asked = 0;
  fs.lstatSync = function (p, ...rest) {
    const st = original.call(fs, p, ...rest);
    if (path.resolve(String(p)) === path.resolve(s.file)) { asked++; return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { isFile: () => false, isSymbolicLink: () => true }); }
    return st;
  };
  try { expectRow('owner reported as a link', row, 'malformed-owner'); } finally { fs.lstatSync = original; }
  assert(asked > 0, 'the owner was never looked at with lstat');
});
test('dead-owner reclaim: keepOnCrash, any recorded value keeps a dead owner locked and an absent field does not', async root => {
  const pid = await deadPid();
  const rows = [
    ['marker memory-migration', 'kept-for-recovery', 'memory-migration', /A memory migration stopped partway/],
    ['marker with an unknown value', 'kept-for-recovery', 'a-future-marker', /cannot be checked from here \(kept-for-recovery\)/],
    ['marker false', 'kept-for-recovery', false, null], ['marker null', 'kept-for-recovery', null, null],
    ['marker 0', 'kept-for-recovery', 0, null], ['marker empty string', 'kept-for-recovery', '', null],
  ];
  for (const [label, reason, value, message] of rows) {
    const r = rowFixture(root); plant(root, r.target, { pid, patch: { keepOnCrash: value } });
    expectRow(label, r, reason, message ? { message } : {});
  }
  const control = rowFixture(root); plant(root, control.target, { pid });
  expectRow('no marker (control: reclaimed)', control, null);
  // The option writes the marker, and only when it is given.
  const t = path.join(root, 'marker-store.json'), readOwner = opts => locks.withStateLock(t, () => {
    const lock = t + '.lock'; return JSON.parse(fs.readFileSync(path.join(lock, fs.readdirSync(lock)[0]), 'utf8'));
  }, opts);
  assert.equal('keepOnCrash' in readOwner(), false, 'a plain lock keeps its record shape');
  assert.equal(readOwner({ keepOnCrash: 'memory-migration' }).keepOnCrash, 'memory-migration');
  // And the marker survives a real kill.
  const target = path.join(root, 'migration-store.json'), holder = launch('hold', root, { target, store: path.join(root, 'held.txt'), content: 'm', opts: { keepOnCrash: 'memory-migration' } });
  try {
    await holder.until(/^held$/m); await holder.kill();
    const lock = target + '.lock', file = path.join(lock, fs.readdirSync(lock)[0]);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).keepOnCrash, 'memory-migration');
    age(file, 60000); age(lock, 60000);
    expectRow('really killed holder with the marker', { target, dir: root }, 'kept-for-recovery', { message: /A memory migration stopped partway/ });
  } finally { await holder.kill(); }
});
test('dead-owner reclaim: the history journal decides for the progress tracker lock only', async root => {
  const pid = await deadPid();
  const op = state => JSON.stringify({ schema: 'leerness.history-operation/v1', state, action: 'retain',
    operationId: 'retain-' + 'a'.repeat(24), manifest: { operationId: 'retain-' + 'a'.repeat(24) } });
  const rows = [
    ['no journal (control: reclaimed)', 'progress-tracker.md', null, null, null],
    ['complete journal (control: reclaimed)', 'progress-tracker.md', op('complete'), null, null],
    ['pending journal', 'progress-tracker.md', op('pending'), 'kept-for-recovery', /A history operation stopped partway/],
    ['journal with an unknown schema', 'progress-tracker.md', '{}', 'kept-for-recovery', null],
    ['journal that is not JSON', 'progress-tracker.md', '{not json', 'kept-for-recovery', null],
    ['pending journal, another store lock (control: reclaimed)', 'lessons.json', op('pending'), null, null],
  ];
  for (const [label, name, journal, reason, message] of rows) {
    const r = rowFixture(root, { workspace: true, name });
    if (journal !== null) fs.writeFileSync(path.join(r.dir, 'history-operation.json'), journal);
    plant(root, r.target, { pid });
    expectRow(label, r, reason, message ? { message } : {});
  }
});
test('dead-owner reclaim: a file moved aside by an unfinished save keeps the lock, anywhere in the store folder', async root => {
  const pid = await deadPid();
  const aside = (r, scratchName, files) => { const d = path.join(r.dir, scratchName); fs.mkdirSync(d, { recursive: true }); for (const f of files) fs.writeFileSync(path.join(d, f), f + ' bytes'); return d; };
  const recovery = r => { const d = path.join(r.base, '.leerness', 'archive', 'mutation-recovery'); fs.mkdirSync(d, { recursive: true }); return d; };
  const rows = [
    ['publish-cas of the lock target itself, target absent', 'displaced-target', /Move .*before back to store\.json/,
      r => aside(r, '.store.json.publish-cas-abc123', ['before'])],
    ['publish-cas of a sibling file, sibling absent', 'displaced-target', /Move .*before back to other\.json/,
      r => aside(r, '.other.json.publish-cas-Zy9x', ['before', 'next'])],
    ['publish-cas of a sibling file, sibling present (control: reclaimed)', null, null,
      r => { fs.writeFileSync(path.join(r.dir, 'other.json'), 'live'); aside(r, '.other.json.publish-cas-Zy9x', ['before']); }],
    ['agent roles scratch, file absent', 'displaced-target', /back to agent-roles\.json/,
      r => aside(r, '.agent-roles-cas-Q1w2', ['before'])],
    ['agent roles scratch, file present (control: reclaimed)', null, null,
      r => { fs.writeFileSync(path.join(r.dir, 'agent-roles.json'), 'live'); aside(r, '.agent-roles-cas-Q1w2', ['before']); }],
    ['scratch folder without a before file (control: reclaimed)', null, null,
      r => aside(r, '.other.json.publish-cas-Zy9x', ['next'])],
    ['a plain file named like a scratch folder (control: reclaimed)', null, null,
      r => fs.writeFileSync(path.join(r.dir, '.other.json.publish-cas-Zy9x'), 'a plain file')],
    ['Windows replace with next and before, in the mutation recovery folder', 'displaced-target', /A save stopped after moving a file aside\. Its original is .*before/,
      r => { const d = path.join(recovery(r), `.leerness-write-${pid}-k3j2`); fs.mkdirSync(d); for (const f of ['next', 'before']) fs.writeFileSync(path.join(d, f), f); }],
    ['Windows replace with next and before, in the target folder', 'displaced-target', /A save stopped after moving a file aside/,
      r => aside(r, `.leerness-write-${pid}-k3j2`, ['next', 'before'])],
    ['Windows replace with before only (control: reclaimed)', null, null,
      r => aside(r, `.leerness-write-${pid}-k3j2`, ['before'])],
    ['Windows replace with next only (control: reclaimed)', null, null,
      r => aside(r, `.leerness-write-${pid}-k3j2`, ['next'])],
    ['Windows replace of another pid (control: reclaimed)', null, null,
      r => aside(r, `.leerness-write-${pid + 1}-k3j2`, ['next', 'before'])],
    ['Windows replace of a pid with extra digits (control: reclaimed)', null, null,
      r => aside(r, `.leerness-write-${pid}0-k3j2`, ['next', 'before'])],
  ];
  for (const [label, reason, message, build] of rows) {
    const r = rowFixture(root, { workspace: true }); build(r); plant(root, r.target, { pid });
    expectRow(label, r, reason, message ? { message } : {});
  }
});
test('dead-owner reclaim: a plain file named like a scratch folder does not block the scan (ENOTDIR as POSIX reports it)', async root => {
  // Windows answers ENOENT for a path below a plain file, POSIX answers ENOTDIR; the patch makes both platforms answer ENOTDIR.
  const pid = await deadPid(), row = rowFixture(root, { workspace: true }), plain = path.join(row.dir, '.other.json.publish-cas-Zy9x');
  fs.writeFileSync(plain, 'a plain file'); plant(root, row.target, { pid });
  const lstat = fs.lstatSync; let through = 0;
  fs.lstatSync = function (p, ...rest) {
    if (String(p).startsWith(plain + path.sep)) { through++; throw Object.assign(new Error('ENOTDIR: not a directory, lstat'), { code: 'ENOTDIR' }); }
    return lstat.call(fs, p, ...rest);
  };
  try { expectRow('plain file named like a scratch folder', row, null); } finally { fs.lstatSync = lstat; }
  assert(through > 0, 'the scan must have looked below the plain file');
});
test('dead-owner reclaim: the dead writer\'s second file name is removed, and only that name', async root => {
  const pid = await deadPid(), bytes = 'complete new bytes\n';
  const live = (r, name) => { const f = path.join(r.dir, name); fs.writeFileSync(f, bytes); return f; };
  const stats = f => fs.statSync(f);
  for (const [liveName, aliasName] of [['data.md', `.data.md.publish-${pid}-${hex(12)}`],
    ['agent-roles.json', `.agent-roles-create-${pid}-${hex(12)}`], ['execution-ledger.jsonl', `.execution-ledger-create-${pid}-${hex(12)}`],
    ['store.json', `.store.json.publish-${pid}-${hex(12)}`],
    // A name with a line separator in it (`.` does not match U+2028 or U+2029): the pid-named pattern must still find it.
    ['d' + String.fromCharCode(0x2029) + 'ata.md', `.d${String.fromCharCode(0x2029)}ata.md.publish-${pid}-${hex(12)}`],
    ['d' + String.fromCharCode(0x2028) + 'ata.md', `.d${String.fromCharCode(0x2028)}ata.md.publish-${pid}-${hex(12)}`]]) {
    const r = rowFixture(root, { workspace: true }), file = live(r, liveName), alias = path.join(r.dir, aliasName);
    fs.linkSync(file, alias); assert.equal(stats(file).nlink, 2);
    plant(root, r.target, { pid });
    expectRow(`alias ${aliasName.slice(0, 22)} of the dead pid`, r, null);
    assert.equal(fs.existsSync(alias), false, `${aliasName}: the second name must be removed`);
    assert.equal(stats(file).nlink, 1); assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'the live bytes are unchanged');
  }
  const keep = (label, build, reason = null) => {
    const r = rowFixture(root, { workspace: true }), made = build(r); plant(root, r.target, { pid, ...(made.seed || {}) });
    expectRow(label, r, reason);
    for (const a of made.stay) assert.equal(fs.existsSync(a), true, `${label}: ${a} must stay`);
    return { r, made };
  };
  const stayLinked = (label, aliasOf) => keep(label, r => {
    const file = live(r, 'data.md'), alias = path.join(r.dir, aliasOf(r)); fs.linkSync(file, alias);
    return { stay: [alias], file };
  }).made;
  assert.equal(stats(stayLinked('alias of a live pid', () => `.data.md.publish-${process.pid}-${hex(12)}`).file).nlink, 2);
  stayLinked('alias of a pid with extra digits', () => `.data.md.publish-${pid}0-${hex(12)}`);
  stayLinked('alias name with 23 hex characters', () => `.data.md.publish-${pid}-${hex(12).slice(1)}`);
  keep('dead-pid name that is a different file', r => {
    const file = live(r, 'data.md'), alias = path.join(r.dir, `.data.md.publish-${pid}-${hex(12)}`);
    // bigint: NTFS file numbers pass 2^53, where two neighbours round to the same Number.
    fs.writeFileSync(alias, bytes); assert.notEqual(fs.statSync(alias, { bigint: true }).ino, fs.statSync(file, { bigint: true }).ino);
    return { stay: [alias, file] };
  });
  { // a scratch folder's next, linked to the live file, goes; before stays
    const r = rowFixture(root, { workspace: true }), file = live(r, 'data.md'), scratch = path.join(r.dir, '.data.md.publish-cas-abc123');
    fs.mkdirSync(scratch); fs.linkSync(file, path.join(scratch, 'next')); fs.writeFileSync(path.join(scratch, 'before'), 'old bytes');
    plant(root, r.target, { pid }); expectRow('scratch next linked to the live file', r, null);
    assert.equal(fs.existsSync(path.join(scratch, 'next')), false); assert.equal(fs.existsSync(path.join(scratch, 'before')), true);
    assert.equal(stats(file).nlink, 1);
    const roles = rowFixture(root, { workspace: true }), rolesFile = live(roles, 'agent-roles.json'), rolesScratch = path.join(roles.dir, '.agent-roles-cas-Q1w2');
    fs.mkdirSync(rolesScratch); fs.linkSync(rolesFile, path.join(rolesScratch, 'next'));
    plant(root, roles.target, { pid }); expectRow('agent roles scratch next linked to the live file', roles, null);
    assert.equal(fs.existsSync(path.join(rolesScratch, 'next')), false); assert.equal(stats(rolesFile).nlink, 1);
  }
  keep('a kept owner leaves its alias alone', r => {
    const file = live(r, 'data.md'), alias = path.join(r.dir, `.data.md.publish-${pid}-${hex(12)}`); fs.linkSync(file, alias);
    return { stay: [alias], seed: { patch: { keepOnCrash: 'memory-migration' } } };
  }, 'kept-for-recovery');
  { // the second name goes before the owner record does
    const r = rowFixture(root, { workspace: true }), file = live(r, 'data.md'), alias = path.join(r.dir, `.data.md.publish-${pid}-${hex(12)}`);
    fs.linkSync(file, alias); const s = plant(root, r.target, { pid });
    const original = fs.unlinkSync, order = [];
    fs.unlinkSync = function (p, ...rest) { order.push(p === alias ? 'alias' : p === s.file ? 'owner' : 'other'); return original.call(fs, p, ...rest); };
    try { expectRow('order of removal', r, null); } finally { fs.unlinkSync = original; }
    assert.deepStrictEqual(order.filter(x => x !== 'other'), ['alias', 'owner']);
  }
});
test('dead-owner reclaim: a kill between linkSync and detach in publishMemoryOutput leaves a two-name file that the next write repairs', async root => {
  const row = rowFixture(root, { workspace: true }), file = path.join(row.dir, 'data.md'), out = require('../lib/memory-output');
  const killer = launch('publish-kill', root, { target: row.target, file });
  await killer.closed;
  assert(abnormal(killer), 'the writer must have been killed: ' + killer.out + killer.err); assert(!/SURVIVED/.test(killer.out));
  assert.equal(fs.readFileSync(file, 'utf8'), 'complete bytes\n'); assert.equal(fs.statSync(file).nlink, 2);
  const alias = fs.readdirSync(row.dir).filter(n => n.startsWith('.data.md.publish-' + killer.p.pid + '-'));
  assert.equal(alias.length, 1, 'the temporary name is left behind: ' + fs.readdirSync(row.dir));
  assert.throws(() => out.captureMemoryOutput(file), /./, 'a file with two names is refused before the repair');
  const lock = row.target + '.lock', owner = path.join(lock, fs.readdirSync(lock)[0]); age(owner, 60000); age(lock, 60000);
  const r = attempt(row.target, { maxWaitMs: 5000 });
  assert.equal(r.ran, true, r.error && r.error.message);
  assert.deepStrictEqual(notices(r.stderr, 'en'), [{ pid: killer.p.pid, file: 'store.json' }]);
  assert.equal(fs.existsSync(path.join(row.dir, alias[0])), false); assert.equal(fs.statSync(file).nlink, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), 'complete bytes\n');
  assert.equal(out.captureMemoryOutput(file).exists, true, 'the repaired file can be read again');
});
// The live owner another process would have written: this process is alive, so the record reads as a live owner.
function liveOwnerFile(root, lock) {
  const token = hex(16), file = path.join(lock, `owner-${token}.json`);
  return { token, file, body: JSON.stringify({ ...ownerTemplate(root), pid: process.pid, token, createdAt: new Date().toISOString() }) + '\n' };
}
test('dead-owner reclaim: a live owner that replaces the dead one just before the unlink survives untouched', async root => {
  const pid = await deadPid(), row = rowFixture(root), dead = plant(root, row.target, { pid }), live = liveOwnerFile(root, dead.lock);
  const original = fs.readFileSync; let swapped = 0;
  fs.readFileSync = function (p, ...rest) {
    const bytes = original.call(fs, p, ...rest);
    if (!swapped && path.resolve(String(p)) === path.resolve(dead.file)) {
      // The reclaimer has just read the dead record. Meanwhile another waiter finished the reclaim and a new holder took the lock.
      swapped++; fs.unlinkSync(dead.file); fs.rmdirSync(dead.lock); fs.mkdirSync(dead.lock);
      fs.writeFileSync(live.file, live.body); age(live.file, 60000);
    }
    return bytes;
  };
  let r; try { r = attempt(row.target, { maxWaitMs: 700 }); } finally { fs.readFileSync = original; }
  assert.equal(swapped, 1, 'the swap hook must have fired');
  assert.equal(r.ran, false, 'a live holder must still exclude the waiter'); assert.equal(r.error && r.error.code, 'E_LOCK_TIMEOUT');
  assert.equal(r.error.lockState, 'live-owner');
  assert.equal(fs.readFileSync(live.file, 'utf8'), live.body, 'the live owner record must survive');
  assert.deepStrictEqual(fs.readdirSync(dead.lock), [path.basename(live.file)]);
  assert.equal(r.stderr.includes('Cleared a lock'), false, 'nothing was cleared, so nothing is announced');
});
test('dead-owner reclaim: a live owner file that appears just before the rmdir survives, and the folder stays', async root => {
  const pid = await deadPid(), row = rowFixture(root), dead = plant(root, row.target, { pid }), live = liveOwnerFile(root, dead.lock);
  const original = fs.readFileSync; let added = 0;
  fs.readFileSync = function (p, ...rest) {
    const bytes = original.call(fs, p, ...rest);
    if (!added && path.resolve(String(p)) === path.resolve(dead.file)) { added++; fs.writeFileSync(live.file, live.body); age(live.file, 60000); }
    return bytes;
  };
  let r; try { r = attempt(row.target, { maxWaitMs: 700 }); } finally { fs.readFileSync = original; }
  assert.equal(added, 1, 'the hook must have fired');
  assert.equal(r.ran, false); assert.equal(r.error && r.error.code, 'E_LOCK_TIMEOUT'); assert.equal(r.error.lockState, 'live-owner');
  assert.equal(fs.readFileSync(live.file, 'utf8'), live.body, 'the live owner record must survive the rmdir attempts');
  assert.equal(fs.existsSync(dead.file), false, 'only the dead record was removed');
  assert.deepStrictEqual(fs.readdirSync(dead.lock), [path.basename(live.file)]);
  assert.equal(r.stderr.includes('Cleared a lock'), false, 'the rmdir never succeeded, so a reclaim that met a new owner\'s file announces nothing');
});
test('dead-owner reclaim: the waiter that loses the race for the owner file announces nothing and removes nothing', async root => {
  const pid = await deadPid(), row = rowFixture(root), dead = plant(root, row.target, { pid });
  const original = fs.unlinkSync; let raced = 0;
  fs.unlinkSync = function (p, ...rest) {
    // Another waiter's unlink lands first; this one then meets ENOENT.
    if (!raced && path.resolve(String(p)) === path.resolve(dead.file)) { raced++; original.call(fs, p, ...rest); }
    return original.call(fs, p, ...rest);
  };
  let r; try { r = attempt(row.target, { maxWaitMs: 600 }); } finally { fs.unlinkSync = original; }
  assert.equal(raced, 1, 'the race hook must have fired');
  assert.equal(r.ran, false, 'the loser must not go on to clear the folder the winner is still working on');
  assert.equal(r.error && r.error.code, 'E_LOCK_TIMEOUT'); assert.equal(r.error.lockState, 'empty');
  assert.equal(r.stderr.includes('Cleared a lock'), false, 'only the process whose unlink succeeded announces the reclaim');
  assert.deepStrictEqual(fs.readdirSync(dead.lock), [], 'the folder is left as the winner left it');
});
// Replaces the test 'KNOWN DEFECT dead-owner reclaim: a second reclaimer whose unlink also succeeded must not remove the new
// holder's empty folder'. That test asserted "never removes the new holder's folder", which cannot be guaranteed: on Windows the
// same file can be unlinked by more than one process at once (measured, Node 18 to 26), so a second waiter's rmdir can take the
// folder a new holder has just made, and no check by the second waiter can tell. The tests below pin what does hold: a holder
// whose folder simply vanished goes round again and ends as the one holder, it does not remove the folder now at that path, and
// a folder replaced by another process fails that one write cleanly. Another pins the message when the folder keeps vanishing.
test('dead-owner reclaim: a folder that vanishes under a new holder is not a failure; the write goes round again and one holder remains', async root => {
  const pid = await deadPid(), mkdir = fs.mkdirSync, rename = fs.renameSync, rmdir = fs.rmdirSync;
  for (const [label, moment] of [['right after the holder made its folder', 'mkdir'], ['just before its owner record is put into the folder', 'rename']]) {
    const row = rowFixture(root), lock = row.target + '.lock', isLock = p => path.resolve(String(p)) === path.resolve(lock);
    plant(root, row.target, { pid });
    let vanished = 0, entered = 0, owners = null, holdersSeen = null;
    fs.mkdirSync = function (p, ...rest) {
      const r = mkdir.call(fs, p, ...rest);
      // The dead owner was already removed by this process, so this is the new holder's own mkdir.
      if (moment === 'mkdir' && !vanished && isLock(p)) { vanished++; rmdir.call(fs, lock); }
      return r;
    };
    fs.renameSync = function (from, to) {
      if (moment === 'rename' && !vanished && path.resolve(path.dirname(String(to))) === path.resolve(lock)) { vanished++; rmdir.call(fs, lock); }
      return rename.call(fs, from, to);
    };
    let r;
    try {
      r = observe(() => errorLang.withErrorLanguage('en', () => locks.withStateLock(row.target, () => {
        entered++; owners = fs.readdirSync(lock); holdersSeen = owners.map(n => JSON.parse(fs.readFileSync(path.join(lock, n), 'utf8')).pid);
        return 1;
      }, { maxWaitMs: 3000 })));
    } finally { fs.mkdirSync = mkdir; fs.renameSync = rename; }
    assert.equal(vanished, 1, `${label}: the folder must have vanished once`);
    assert.equal(r.error, null, `${label}: a vanished folder is not a failure: ${r.error && r.error.message}`);
    assert.equal(entered, 1, `${label}: the callback ran exactly once`);
    assert.equal(owners.length, 1, `${label}: one holder, one owner record: ${owners}`); assert.deepStrictEqual(holdersSeen, [process.pid]);
    assert.equal(fs.existsSync(lock), false, `${label}: the lock is released afterwards`);
    assert.deepStrictEqual(fs.readdirSync(row.dir).filter(n => /\.tmp-/.test(n)), [], `${label}: no temporary owner file is left`);
  }
});
test('dead-owner reclaim: after its folder vanished a writer does not remove the folder now at that path, which is a new holder\'s', async root => {
  const row = rowFixture(root), lock = row.target + '.lock', mkdir = fs.mkdirSync, rename = fs.renameSync, rmdir = fs.rmdirSync;
  let swapped = 0, removedAfter = 0;
  fs.renameSync = function (from, to) {
    if (!swapped && path.resolve(path.dirname(String(to))) === path.resolve(lock)) {
      swapped++; rmdir.call(fs, lock);
      try { return rename.call(fs, from, to); }            // ENOENT: the folder is gone
      finally { mkdir.call(fs, lock); }                    // and a new holder has made its own, not filled yet
    }
    return rename.call(fs, from, to);
  };
  fs.rmdirSync = function (p, ...rest) { if (swapped && path.resolve(String(p)) === path.resolve(lock)) removedAfter++; return rmdir.call(fs, p, ...rest); };
  let r; try { r = attempt(row.target, { maxWaitMs: 500 }); } finally { fs.renameSync = rename; fs.rmdirSync = rmdir; }
  assert.equal(swapped, 1, 'the hook must have fired');
  assert.equal(removedAfter, 0, 'a writer whose folder vanished must not rmdir the path again: whatever is there is not its own');
  assert.equal(r.ran, false, 'the new holder\'s folder keeps this writer out'); assert.equal(r.error && r.error.code, 'E_LOCK_TIMEOUT');
  assert.equal(r.error.lockState, 'empty'); assert.deepStrictEqual(fs.readdirSync(lock), [], 'the new holder\'s folder is untouched');
  assert.deepStrictEqual(fs.readdirSync(row.dir).filter(n => /\.tmp-/.test(n)), [], 'the temporary owner file of the failed attempt is removed');
});
test('dead-owner reclaim: a folder replaced under a new holder fails that one write cleanly and says to retry, in both languages', async root => {
  const mkdir = fs.mkdirSync, rename = fs.renameSync, rmdir = fs.rmdirSync;
  for (const [lang, line] of [['en', 'What to do: The lock is gone now. Retry.'], ['ko', '조치: 지금은 잠금이 없습니다. 다시 실행하세요.']]) {
    const row = rowFixture(root), lock = row.target + '.lock'; let swapped = 0;
    fs.renameSync = function (from, to) {
      if (!swapped && path.resolve(path.dirname(String(to))) === path.resolve(lock)) { swapped++; rmdir.call(fs, lock); mkdir.call(fs, lock); }
      return rename.call(fs, from, to);
    };
    let r; try { r = attempt(row.target, { maxWaitMs: 500 }, lang); } finally { fs.renameSync = rename; }
    assert.equal(swapped, 1, 'the hook must have fired');
    // Where the file system hands the same inode to the new folder the check cannot tell them apart, and this writer is the one holder.
    if (r.ran) { assert.equal(fs.existsSync(lock), false, 'the lock is released afterwards'); continue; }
    assert.equal(r.error && r.error.code, 'E_LOCK_TIMEOUT', r.error && r.error.stack); assert(/E_LOCK_OWNERSHIP/.test(r.error.message.split('\n')[0]), r.error.message);
    assert.equal(r.error.message.split('\n')[2].trim(), line);
  }
});
test('dead-owner reclaim: a second owner file that lands beside a new holder\'s stops that holder before its callback', async root => {
  const row = rowFixture(root), lock = row.target + '.lock', other = path.join(lock, 'owner-' + 'f'.repeat(32) + '.json'), readdir = fs.readdirSync;
  let injected = 0;
  fs.readdirSync = function (p, ...rest) {
    if (!injected && path.resolve(String(p)) === path.resolve(lock) && readdir.call(fs, p).length === 1) { injected++; fs.writeFileSync(other, '{}\n'); }
    return readdir.call(fs, p, ...rest);
  };
  let r; try { r = attempt(row.target, { maxWaitMs: 200 }); } finally { fs.readdirSync = readdir; }
  assert.equal(injected, 1, 'the hook must have fired');
  assert.equal(r.ran, false, 'a holder that sees another owner in its folder must not run'); assert.equal(r.error && r.error.code, 'E_LOCK_TIMEOUT');
  assert(/E_LOCK_OWNERSHIP/.test(r.error.message.split('\n')[0]), r.error.message);
});
test('dead-owner reclaim: a waiter whose rmdir finds the folder already gone prints no notice', async root => {
  const pid = await deadPid(), row = rowFixture(root), dead = plant(root, row.target, { pid }), original = fs.rmdirSync;
  let raced = 0;
  fs.rmdirSync = function (p, ...rest) {
    if (!raced && path.resolve(String(p)) === path.resolve(dead.lock)) { raced++; original.call(fs, p, ...rest); throw Object.assign(new Error('ENOENT: no such file or directory, rmdir'), { code: 'ENOENT' }); }
    return original.call(fs, p, ...rest);
  };
  let r; try { r = attempt(row.target, { maxWaitMs: 3000 }); } finally { fs.rmdirSync = original; }
  assert.equal(raced, 1, 'the hook must have fired'); assert.equal(r.ran, true, r.error && r.error.message);
  assert.deepStrictEqual(notices(r.stderr, 'en'), [], 'another waiter removed the folder, so this one does not announce it');
});
test('a mkdir that fails with ENOENT is not a vanished folder: it fails at once and does not spend the wait', async root => {
  const row = rowFixture(root), lock = row.target + '.lock', mkdir = fs.mkdirSync; let calls = 0;
  fs.mkdirSync = function (p, ...rest) {
    if (path.resolve(String(p)) === path.resolve(lock)) { calls++; throw Object.assign(new Error('ENOENT: no such file or directory, mkdir'), { code: 'ENOENT' }); }
    return mkdir.call(fs, p, ...rest);
  };
  let r; try { r = attempt(row.target, { maxWaitMs: 2000 }); } finally { fs.mkdirSync = mkdir; }
  assert.equal(calls, 1, 'no second attempt'); assert.equal(r.error && r.error.code, 'E_LOCK_TIMEOUT'); assert(r.ms < 1000, `took ${r.ms} ms`);
});
test('dead-owner reclaim: a folder that keeps vanishing ends as a lock-gone failure that says to retry, in both languages', async root => {
  const mkdir = fs.mkdirSync, rmdir = fs.rmdirSync;
  for (const [lang, line] of [['en', 'What to do: The lock is gone now. Retry.'], ['ko', '조치: 지금은 잠금이 없습니다. 다시 실행하세요.']]) {
    const row = rowFixture(root), lock = row.target + '.lock'; let vanished = 0;
    fs.mkdirSync = function (p, ...rest) { const r = mkdir.call(fs, p, ...rest); if (path.resolve(String(p)) === path.resolve(lock)) { vanished++; rmdir.call(fs, lock); } return r; };
    let r; try { r = attempt(row.target, { maxWaitMs: 250 }, lang); } finally { fs.mkdirSync = mkdir; }
    assert(vanished >= 2, `${lang}: the writer went round again (${vanished} tries)`);
    assert.equal(r.ran, false); assert.equal(r.error && r.error.code, 'E_LOCK_TIMEOUT'); assert.equal(r.error.lockState, 'gone');
    assert(r.error.message.split('\n')[2].trim() === line, `${lang}: ${r.error.message}`);
    assert(/ENOENT/.test(r.error.message.split('\n')[0]), `${lang}: the cause is named: ${r.error.message}`);
  }
});
test('dead-owner reclaim: a first rmdir that fails with ENOTEMPTY is retried and the lock is taken in the same wait', async root => {
  const pid = await deadPid(), row = rowFixture(root), dead = plant(root, row.target, { pid });
  const original = fs.rmdirSync; let calls = 0;
  fs.rmdirSync = function (p, ...rest) {
    if (path.resolve(String(p)) === path.resolve(dead.lock) && calls++ === 0) throw Object.assign(new Error('ENOTEMPTY: directory not empty, rmdir'), { code: 'ENOTEMPTY' });
    return original.call(fs, p, ...rest);
  };
  let r; try { r = attempt(row.target, { maxWaitMs: 3000 }); } finally { fs.rmdirSync = original; }
  assert(calls >= 2, 'the rmdir must be tried again after ENOTEMPTY');
  assert.equal(r.ran, true, 'with the default 30 s stale age an empty folder would otherwise block this wait: ' + (r.error && r.error.message));
  assert(r.ms < 2500, `took ${r.ms} ms`);
  assert.deepStrictEqual(notices(r.stderr, 'en'), [{ pid, file: 'store.json' }], 'the retried rmdir removed the folder, so this waiter announces the reclaim once');
});
test('dead-owner reclaim: an old empty folder that is replaced by a new one is not removed before it is stale itself', async root => {
  const row = rowFixture(root), lock = row.target + '.lock'; fs.mkdirSync(lock); age(lock, 60000);
  const readdir = fs.readdirSync, rmdir = fs.rmdirSync; let injectedAt = 0, removedAt = 0;
  fs.readdirSync = function (p, ...rest) {
    if (!injectedAt && path.resolve(String(p)) === path.resolve(lock) && /_reclaimLockDirectory/.test(new Error().stack)) {
      // Between the stale folder check's two looks, a holder replaces the old empty folder with a new one it has not filled yet.
      injectedAt = Date.now(); rmdir.call(fs, lock); fs.mkdirSync(lock);
    }
    return readdir.call(fs, p, ...rest);
  };
  fs.rmdirSync = function (p, ...rest) { if (!removedAt && path.resolve(String(p)) === path.resolve(lock)) removedAt = Date.now(); return rmdir.call(fs, p, ...rest); };
  let r; try { r = attempt(row.target, { maxWaitMs: 6000, staleMs: 1000 }); } finally { fs.readdirSync = readdir; fs.rmdirSync = rmdir; }
  assert(injectedAt, 'the replacement hook must have fired inside _reclaimLockDirectory');
  assert.equal(r.ran, true, r.error && r.error.message);
  assert(removedAt - injectedAt >= 900, `the new folder was removed ${removedAt - injectedAt} ms after it appeared, before it was stale (staleMs 1000)`);
});
test('dead-owner reclaim cadence: a live owner file is read at most every 250 ms, and not at all while it is fresh', async root => {
  for (const [label, ageMs, least, most] of [['fresh live owner', 0, 0, 1], ['live owner touched a minute ago', 60000, 2, 9]]) {
    const row = rowFixture(root), s = plant(root, row.target, { pid: process.pid, ageMs });
    const readFile = fs.readFileSync, open = fs.openSync; let reads = 0, inRead = false;
    const mine = p => path.resolve(String(p)) === path.resolve(s.file);
    fs.readFileSync = function (p, ...rest) { if (mine(p)) reads++; const was = inRead; inRead = true; try { return readFile.call(fs, p, ...rest); } finally { inRead = was; } };
    fs.openSync = function (p, ...rest) { if (!inRead && mine(p)) reads++; return open.call(fs, p, ...rest); };
    let r; try { r = attempt(row.target, { maxWaitMs: 1500 }); } finally { fs.readFileSync = readFile; fs.openSync = open; }
    assert.equal(r.ran, false, label); assert.equal(r.error && r.error.lockState, 'live-owner', label);
    // One read belongs to the final message, which classifies the lock once more.
    assert(reads >= least && reads <= most, `${label}: the owner file was read ${reads} times in 1.5 s (allowed ${least}..${most})`);
  }
});
test('dead-owner reclaim: every owner read in a wait is inside the 250 ms cadence, so a holder\'s release rename never meets an open file', async root => {
  const pid = await deadPid(), row = rowFixture(root), s = plant(root, row.target, { pid, ageMs: 60000, patch: { host: 'another-computer' } });
  const times = [], readFile = fs.readFileSync;
  fs.readFileSync = function (p, ...rest) { if (path.resolve(String(p)) === path.resolve(s.file)) times.push(Date.now()); return readFile.call(fs, p, ...rest); };
  const startedAt = Date.now();
  let r; try { r = attempt(row.target, { maxWaitMs: 1500 }); } finally { fs.readFileSync = readFile; }
  assert.equal(r.error && r.error.lockState, 'other-host');
  for (let i = 1; i < times.length - 1; i++) assert(times[i] - times[i - 1] >= 200, `reads ${times[i] - times[i - 1]} ms apart`);
  // The first look is also at 250 ms, not at the first contention: an owner file opened at once would meet a holder's release.
  assert(times.length >= 2, 'the wait must have looked at the owner more than once: ' + times.length);
  assert(times[0] - startedAt >= 200, `the first owner read came ${times[0] - startedAt} ms into the wait`);
});

// A real child is killed at each point of the crash table, then a fresh process (or this one) takes over.
async function crashed(root, point, planted) {
  const row = rowFixture(root, { workspace: true }), lock = row.target + '.lock';
  const dead = planted ? await deadPid() : null, owner = planted ? plant(root, row.target, { pid: dead }) : null;
  const run = launch('kill-at', root, { point, target: row.target, lock, opts: { maxWaitMs: 8000 } });
  await run.closed;
  assert(abnormal(run), `${point}: the child must have been killed: ${run.out}${run.err}`);
  assert(!/SURVIVED/.test(run.out), `${point}: the kill did not stop the child`);
  return { row, lock, dead, owner, run };
}
const crashEmptyFolder = (point, how) => test(`crash table: killed ${how} leaves an empty folder that clears once it is stale`, async root => {
  const c = await crashed(root, point, point === 'reclaim-before-rmdir');
  assert.deepStrictEqual(fs.readdirSync(c.lock), [], 'the folder must be empty');
  const scan = () => locks.inspectStateLocks(path.dirname(c.row.dir), { lang: 'en' });
  // A folder younger than 5 s may still be in its creation window and be filled, so the scan calls it in use; later it is clearing.
  const fresh = scan();
  assert(fresh.active.some(x => x.reason === 'empty' && x.path.endsWith('store.json.lock')) && fresh.clearing.length === 0, JSON.stringify(fresh));
  const early = attempt(c.row.target, { maxWaitMs: 500 });
  assert.equal(early.ran, false); assert.equal(early.error && early.error.lockState, 'empty');
  assert(/Retry in 30 seconds/.test(early.error.message), early.error.message);
  age(c.lock, 60000);
  const old = scan();
  assert(old.clearing.some(x => x.reason === 'empty' && x.path.endsWith('store.json.lock')) && old.active.length === 0, JSON.stringify(old));
  const late = attempt(c.row.target, { maxWaitMs: 3000 });
  assert.equal(late.ran, true, late.error && late.error.message);
});
crashEmptyFolder('reclaim-before-rmdir', 'after the owner was unlinked and before the rmdir');
crashEmptyFolder('create-before-temp-open', 'after mkdir and before the owner record was started');
test('crash table: killed before the owner unlink leaves the dead owner unchanged, and the next writer reclaims it', async root => {
  const c = await crashed(root, 'reclaim-before-unlink', true);
  assert.equal(fs.readFileSync(c.owner.file, 'utf8'), JSON.stringify(c.owner.record) + '\n', 'the dead owner record is unchanged');
  assert.deepStrictEqual(fs.readdirSync(c.lock), [path.basename(c.owner.file)]);
  assert.equal(c.run.err.includes('Cleared'), false);
  const r = attempt(c.row.target, { maxWaitMs: 4000 });
  assert.equal(r.ran, true, r.error && r.error.message);
  assert.deepStrictEqual(notices(r.stderr, 'en'), [{ pid: c.dead, file: 'store.json' }]);
});
test('crash table: killed after the rmdir leaves no lock and the next writer is not delayed', async root => {
  const c = await crashed(root, 'reclaim-after-rmdir', true);
  assert.equal(fs.existsSync(c.lock), false);
  const r = attempt(c.row.target, { maxWaitMs: 4000 });
  assert.equal(r.ran, true, r.error && r.error.message); assert(r.ms < 1500, `took ${r.ms} ms`); assert.equal(r.stderr, '');
});
// The owner record is written to a name outside the lock folder first and then renamed in. Before that, a kill in these three
// places left a zero-byte or partial owner inside the folder that stayed protected for ever (limit L3). Now the folder is empty.
for (const [point, how, shape] of [['create-temp-empty', 'right after the temporary owner file was created', 'empty'],
  ['create-temp-partial', 'in the middle of writing the owner record', 'partial'],
  ['create-temp-written', 'after the record was written and before it was renamed into the folder', 'complete']]) {
  test(`crash table: killed ${how} leaves an empty lock folder and a stray temporary file, never a malformed owner`, async root => {
    const c = await crashed(root, point, false);
    assert.deepStrictEqual(fs.readdirSync(c.lock), [], 'nothing was ever put into the lock folder');
    const strays = fs.readdirSync(c.row.dir).filter(n => /^store\.json\.tmp-[1-9][0-9]*-[1-9][0-9]*$/.test(n));
    assert.equal(strays.length, 1, fs.readdirSync(c.row.dir).join(' '));
    const stray = path.join(c.row.dir, strays[0]), text = fs.readFileSync(stray, 'utf8');
    assert(strays[0].includes(`.tmp-${c.run.p.pid}-`), 'the temporary name carries the writer\'s pid: ' + strays[0]);
    if (shape === 'empty') assert.equal(text, '');
    else if (shape === 'partial') { assert(text.length > 0); assert.throws(() => JSON.parse(text), /./, 'a cut record is not JSON'); }
    else assert.equal(JSON.parse(text).pid, c.run.p.pid);
    // The empty folder clears by itself like any other, and the stray file is not a lock.
    age(c.lock, 60000);
    const scanned = locks.inspectStateLocks(path.dirname(c.row.dir), { lang: 'en' });
    assert.deepStrictEqual([scanned.stuck.length, scanned.active.length, scanned.clearing.length, scanned.leftovers.length], [0, 0, 1, 0], JSON.stringify(scanned));
    const r = attempt(c.row.target, { maxWaitMs: 3000 });
    assert.equal(r.ran, true, r.error && r.error.message); assert.equal(r.stderr, '');
    assert.equal(fs.existsSync(stray), true, 'the stray file blocks nothing, and it is left for a person to delete');
  });
}
test('crash table: killed right after the owner record was renamed in leaves a complete dead owner that clears after the veto', async root => {
  const c = await crashed(root, 'create-owner-renamed', false), [name] = fs.readdirSync(c.lock), file = path.join(c.lock, name);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).pid, c.run.p.pid);
  assert.deepStrictEqual(fs.readdirSync(c.row.dir).filter(n => /\.tmp-/.test(n)), [], 'the rename moved the temporary file, so no stray name is left');
  const early = attempt(c.row.target, { maxWaitMs: 600 });
  assert.equal(early.error && early.error.lockState, 'dead-owner', 'inside the 5 s veto the dead owner stays');
  age(file, 60000); age(c.lock, 60000);
  const r = attempt(c.row.target, { maxWaitMs: 4000 });
  assert.equal(r.ran, true, r.error && r.error.message);
  assert.deepStrictEqual(notices(r.stderr, 'en'), [{ pid: c.run.p.pid, file: 'store.json' }]);
});
test('crash table: killed right after the release rename leaves only a tombstone, which blocks nothing', async root => {
  const c = await crashed(root, 'release-after-rename', false);
  assert.equal(fs.existsSync(c.lock), false, 'the lock itself is gone');
  const tombs = fs.readdirSync(c.row.dir).filter(n => /^store\.json\.lock\.release-[a-f0-9]{32}$/.test(n));
  assert.equal(tombs.length, 1, fs.readdirSync(c.row.dir).join(' '));
  const inspected = locks.inspectStateLocks(path.dirname(c.row.dir), { lang: 'en' });
  assert.equal(inspected.leftovers.length, 1); assert.deepStrictEqual([inspected.stuck.length, inspected.active.length, inspected.clearing.length], [0, 0, 0]);
  const r = attempt(c.row.target, { maxWaitMs: 4000 });
  assert.equal(r.ran, true, r.error && r.error.message); assert(r.ms < 1500); assert.equal(r.stderr, '');
});
test('crash table: a holder killed inside its callback leaves the store bytes as they were, and reclaim does not touch them', async root => {
  const row = rowFixture(root, { workspace: true }), store = path.join(row.dir, 'store.json'), lock = store + '.lock';
  const holder = launch('hold', root, { target: store, store, content: 'bytes the dead holder wrote' });
  try {
    await holder.until(/^held$/m); await holder.kill();
    age(path.join(lock, fs.readdirSync(lock)[0]), 60000); age(lock, 60000);
    const r = attempt(store, { maxWaitMs: 4000 });
    assert.equal(r.ran, true, r.error && r.error.message);
    assert.equal(fs.readFileSync(store, 'utf8'), 'bytes the dead holder wrote');
  } finally { await holder.kill(); }
});

// Buckets of the lock scan used by verify and init.
test('verify buckets: inspectStateLocks sorts every reason into active, clearing, stuck or leftovers', async root => {
  const pid = await deadPid(), main = rowFixture(root, { workspace: true }), ws = main.dir, base = main.base;
  const at = name => path.join(ws, name + '.json'), minutes = n => n * 60000, links = [];
  const emptyOwner = (name, ageMs) => plant(root, at(name), { body: '', ageMs });
  const expected = {
    'live-fresh': ['active', 'live-owner', () => plant(root, at('live-fresh'), { pid: process.pid, ageMs: 0 })],
    'live-old': ['stuck', 'live-owner', () => plant(root, at('live-old'), { pid: process.pid, ageMs: minutes(6) })],
    'host-young': ['active', 'other-host', () => plant(root, at('host-young'), { pid, patch: { host: 'another-computer' }, ageMs: minutes(1) })],
    'host-old': ['stuck', 'other-host', () => plant(root, at('host-old'), { pid, patch: { host: 'another-computer' }, ageMs: minutes(6) })],
    'v1-young': ['active', 'legacy-owner', () => plant(root, at('v1-young'), { pid, patch: { v: 1 }, ageMs: minutes(1) })],
    'dead-fresh': ['clearing', 'dead-owner', () => plant(root, at('dead-fresh'), { pid, ageMs: 0 })],
    'dead-old': ['clearing', 'dead-owner', () => plant(root, at('dead-old'), { pid, ageMs: minutes(600) })],
    'empty': ['clearing', 'empty', () => { fs.mkdirSync(at('empty') + '.lock'); age(at('empty') + '.lock', minutes(600)); }],
    // A folder younger than 5 s is a live process between its mkdir and its owner record, not something left behind.
    'empty-young': ['active', 'empty', () => { fs.mkdirSync(at('empty-young') + '.lock'); age(at('empty-young') + '.lock', 1000); }],
    'kept': ['stuck', 'kept-for-recovery', () => plant(root, at('kept'), { pid, patch: { keepOnCrash: 'memory-migration' }, ageMs: 0 })],
    'malformed-young': ['active', 'malformed-owner', () => emptyOwner('malformed-young', 1000)],
    'malformed-old': ['stuck', 'malformed-owner', () => emptyOwner('malformed-old', 10000)],
    // The age is measured from the newer of the folder and the owner file.
    'folder-old-owner-new': ['active', 'malformed-owner', () => { emptyOwner('folder-old-owner-new', 1000); age(at('folder-old-owner-new') + '.lock', minutes(600)); }],
    'owner-old-folder-new': ['active', 'malformed-owner', () => { emptyOwner('owner-old-folder-new', minutes(600)); age(at('owner-old-folder-new') + '.lock', 1000); }],
    'two-owners': ['stuck', 'unexpected-entries', () => {
      const first = plant(root, at('two-owners'), { pid, ageMs: 10000 }), t = hex(16), f = path.join(first.lock, `owner-${t}.json`);
      fs.writeFileSync(f, JSON.stringify({ ...first.record, token: t }) + '\n'); age(f, 10000); age(first.lock, 10000);
    }],
    'link': ['stuck', 'link', () => {
      // A link is ours only beside the store it would lock.
      const dest = path.join(ws, 'link-destination'); fs.mkdirSync(dest); fs.writeFileSync(at('link'), '{}');
      fs.symlinkSync(dest, at('link') + '.lock', 'junction'); links.push(at('link') + '.lock');
      fs.symlinkSync(dest, at('unpaired') + '.lock', 'junction'); links.push(at('unpaired') + '.lock');
    }],
    'legacy-young': ['active', 'legacy-file', () => { fs.writeFileSync(path.join(ws, 'legacy-young.md'), 'x'); fs.writeFileSync(path.join(ws, 'legacy-young.md.lock'), ''); age(path.join(ws, 'legacy-young.md.lock'), minutes(1)); }],
    'legacy-old': ['stuck', 'legacy-file', () => { fs.writeFileSync(path.join(ws, 'legacy-old.md'), 'x'); fs.writeFileSync(path.join(ws, 'legacy-old.md.lock'), ''); age(path.join(ws, 'legacy-old.md.lock'), minutes(6)); }],
  };
  const rel = name => `.leerness/${name}`;
  const locksOf = {};
  for (const [name, [, , build]] of Object.entries(expected)) { build(); locksOf[name] = name.startsWith('legacy') ? `${name}.md.lock` : `${name}.json.lock`; }
  const tomb = path.join(ws, 'x.json.lock.release-' + 'd'.repeat(32)); fs.mkdirSync(tomb);
  try {
    const out = locks.inspectStateLocks(base, { lang: 'en' });
    assert.equal(out.truncated, false);
    for (const [name, [bucket, reason]] of Object.entries(expected)) {
      const row = out[bucket].find(x => x.path === rel(locksOf[name]));
      assert(row, `${name}: expected in ${bucket}; got ${JSON.stringify(out)}`);
      assert.equal(row.reason, reason, name);
      assert.equal('action' in row, bucket === 'stuck', `${name}: only stuck rows carry an action`);
      for (const other of ['active', 'clearing', 'stuck']) if (other !== bucket) assert(!out[other].some(x => x.path === rel(locksOf[name])), `${name} must only be in ${bucket}`);
    }
    assert.equal(out.active.length + out.clearing.length + out.stuck.length, Object.keys(expected).length, 'a link with no store beside it is not ours');
    assert.deepStrictEqual(out.leftovers.map(x => x.path), [rel('x.json.lock.release-' + 'd'.repeat(32))]);
    const byName = name => Object.values(out).flat().find(x => x && x.path === rel(locksOf[name]));
    assert.equal(byName('live-fresh').pid, process.pid); assert.equal(byName('dead-old').pid, pid); assert.equal(byName('host-young').pid, null);
    assert(byName('dead-old').ageMs >= minutes(590), 'age is measured from the newer of folder and owner time');
    assert(/Its heartbeat has stopped/.test(byName('live-old').action) && /delete that lock/.test(byName('live-old').action));
    assert(/renamed computer/.test(byName('host-old').action));
    assert(/memory migration stopped partway/.test(byName('kept').action));
    assert(/That path is a link/.test(byName('link').action));
    const ko = locks.inspectStateLocks(base, { lang: 'ko' });
    assert(/잠금 갱신이 멈춰 있어/.test(ko.stuck.find(x => x.path === rel(locksOf['live-old'])).action));
    // A displaced file anywhere in the folder is stuck for every dead owner in it.
    const other = rowFixture(root, { workspace: true });
    plant(root, other.target, { pid, ageMs: 0 }); fs.mkdirSync(path.join(other.dir, '.sibling.json.publish-cas-abc123')); fs.writeFileSync(path.join(other.dir, '.sibling.json.publish-cas-abc123', 'before'), 'x');
    const displaced = locks.inspectStateLocks(other.base, { lang: 'en' });
    assert.deepStrictEqual(displaced.stuck.map(x => x.reason), ['displaced-target'], JSON.stringify(displaced));
  } finally { for (const l of links) dropLink(l); }
});
function snapshotAll(dir) {
  const out = {};
  (function visit(d, rel) {
    for (const name of fs.readdirSync(d).sort()) {
      const f = path.join(d, name), st = fs.lstatSync(f, { bigint: true }), key = rel + name;
      out[key] = { mtime: String(st.mtimeNs), size: String(st.size), link: st.isSymbolicLink() ? fs.readlinkSync(f) : null,
        hash: st.isFile() ? crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex') : null };
      if (st.isDirectory() && !st.isSymbolicLink()) visit(f, key + '/');
    }
  })(dir, '');
  return out;
}
test('inspectStateLocks is read-only: names, bytes and mtimes stay, and an absent host seed is not created', async root => {
  const pid = await deadPid(), main = rowFixture(root, { workspace: true });
  plant(root, path.join(main.dir, 'a.json'), { pid }); plant(root, path.join(main.dir, 'b.json'), { pid: process.pid, ageMs: 0 });
  plant(root, path.join(main.dir, 'c.json'), { pid, patch: { keepOnCrash: 'x' } }); fs.mkdirSync(path.join(main.dir, 'd.json.lock'));
  plant(root, path.join(main.dir, 'e.json'), { body: '' }); fs.mkdirSync(path.join(main.dir, 'f.json.lock.release-' + 'e'.repeat(32)));
  fs.mkdirSync(path.join(main.dir, '.g.json.publish-cas-abc123')); fs.writeFileSync(path.join(main.dir, '.g.json.publish-cas-abc123', 'before'), 'x');
  const before = snapshotAll(main.base);
  const first = locks.inspectStateLocks(main.base, { lang: 'en' }), second = locks.inspectStateLocks(main.base, { lang: 'ko' });
  assert(first.stuck.length >= 3 && second.stuck.length === first.stuck.length);
  assert.deepStrictEqual(snapshotAll(main.base), before, 'a scan must not change a name, a byte or a modification time');
  // A process with no host seed: the scan must not create one and must not remember "no identity".
  const fresh = path.join(root, 'fresh-home'); fs.mkdirSync(fresh);
  const run = launch('inspect-no-seed', root, { root: main.base, target: path.join(main.dir, 'later.json'), home: fresh });
  await run.closed;
  assert.equal(run.code, 0, run.out + run.err);
  const report = JSON.parse(run.out.trim().split('\n').pop());
  // Only where the identity comes from the seed file does an empty home folder leave a process without an identity. On Linux with
  // a machine id the identity has another source, so the scan sees the lock as a live owner there and this check cannot apply.
  if (report.seedBased) assert(report.activeReasons.includes('unknown-identity'), 'the scan must have reached the identity check: ' + run.out);
  if (report.seedBased) {
    assert.equal(report.seedAfterInspect, false, 'the scan created the host seed');
    assert.equal(report.ran, true, `a write after a scan must still get its identity (code ${report.code})`);
    assert.equal(report.seedAfterWrite, true, 'the first write creates the seed');
  } else assert.equal(report.ran, true, `code ${report.code}`);
});
const paths = out => Object.values(out).filter(Array.isArray).flat().map(x => x.path).sort();
const bucketOf = (out, p) => ['active', 'clearing', 'stuck', 'leftovers'].filter(b => out[b].some(x => x.path === p));
const linkTo = (dest, link, keep) => { fs.mkdirSync(dest, { recursive: true }); fs.writeFileSync(path.join(dest, 'data.txt'), 'x'); fs.symlinkSync(dest, link, 'junction'); keep.push(link); };
test('verify scan: other tools\' lock files, foreign empty folders, nested worktrees and backups are not locks of ours', async root => {
  const pid = await deadPid(), main = rowFixture(root, { workspace: true }), base = main.base, ws = main.dir;
  const w = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); age(p, 6 * 60000); };
  w(path.join(base, 'Cargo.lock'), '# cargo\n'); w(path.join(base, 'Gemfile'), 'source "x"\n'); w(path.join(base, 'Gemfile.lock'), '');
  w(path.join(base, 'Pipfile'), '[x]\n'); w(path.join(base, 'Pipfile.lock'), '{}\n'); w(path.join(base, 'Podfile'), 'x\n'); w(path.join(base, 'Podfile.lock'), '');
  w(path.join(base, '.venv', '.lock'), ''); w(path.join(base, '.lock'), '');
  w(path.join(ws, 'skills', 'uv', 'uv.lock'), 'version = 1\n');   // no `uv` beside it
  fs.mkdirSync(path.join(base, 'other.lock')); fs.mkdirSync(path.join(base, '.foo', 'a.lock'), { recursive: true }); w(path.join(base, '.foo', 'a.lock', 'owner-x'), '');
  const worktree = path.join(base, '.claude', 'worktrees', 'w1'); fs.mkdirSync(worktree, { recursive: true }); w(path.join(worktree, '.git'), 'gitdir: x\n');
  plant(root, path.join(worktree, 'n.json'), { pid });
  fs.mkdirSync(path.join(base, '.leerness-backup')); plant(root, path.join(base, '.leerness-backup', 'old.json'), { pid });
  // A skipped folder inside the workspace (the caller names what to skip, as SCAN_SKIP_DIRS does for verify).
  fs.mkdirSync(path.join(ws, 'skipme')); plant(root, path.join(ws, 'skipme', 'n.json'), { pid });
  const skip = name => name === '.leerness-backup' || name === 'skipme';
  assert.deepStrictEqual(paths(locks.inspectStateLocks(base, { lang: 'en', skipDir: skip })), [], 'nothing here is one of our locks');
  // Controls: each exclusion is what hides its row.
  assert.deepStrictEqual(paths(locks.inspectStateLocks(base, { lang: 'en' })), ['.leerness-backup/old.json.lock', '.leerness/skipme/n.json.lock'], 'without skipDir the backup copy and the skipped folder are seen');
  fs.unlinkSync(path.join(worktree, '.git'));
  assert.deepStrictEqual(paths(locks.inspectStateLocks(base, { lang: 'en', skipDir: skip })), ['.claude/worktrees/w1/n.json.lock'], 'without its .git the worktree lock is seen');
  fs.mkdirSync(path.join(ws, 'inside.lock'));
  assert(paths(locks.inspectStateLocks(base, { lang: 'en', skipDir: skip })).includes('.leerness/inside.lock'), 'an empty folder inside the workspace is counted');
  // A lock file beside its store counts inside the workspace at any size, and never outside it, empty or not.
  fs.writeFileSync(path.join(base, 'AGENTS.md'), 'x'); fs.writeFileSync(path.join(base, 'AGENTS.md.lock'), '');
  assert(!paths(locks.inspectStateLocks(base, { lang: 'en', skipDir: skip })).includes('AGENTS.md.lock'), 'an empty lock file beside its store at the project root is not ours');
  fs.writeFileSync(path.join(ws, 'plan.md'), 'x'); fs.writeFileSync(path.join(ws, 'plan.md.lock'), '12345');
  assert(paths(locks.inspectStateLocks(base, { lang: 'en', skipDir: skip })).includes('.leerness/plan.md.lock'), 'a lock file with content beside its store inside the workspace is counted');
  fs.writeFileSync(path.join(ws, 'skills', 'uv', 'uv'), '');
  assert(paths(locks.inspectStateLocks(base, { lang: 'en', skipDir: skip })).includes('.leerness/skills/uv/uv.lock'), 'beside a name that exists, a lock file inside the workspace is counted whatever tool made it');
});
test('scan rules: a lock file or link counts only inside the workspace and beside its store, at any size; a file named just .lock never counts', async root => {
  const main = rowFixture(root, { workspace: true }), base = main.base, ws = main.dir, links = [];
  const w = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); age(p, 6 * 60000); };
  try {
    // Inside the workspace, with the store beside it: empty, small and large files, and a link.
    for (const [name, size] of [['empty.md', 0], ['small.md', 5], ['large.md', 200000]]) { w(path.join(ws, name), 'x'); w(path.join(ws, name + '.lock'), 'y'.repeat(size)); }
    w(path.join(ws, 'sub', 'deep.md'), 'x'); w(path.join(ws, 'sub', 'deep.md.lock'), '');
    w(path.join(ws, 'linked.md'), 'x'); linkTo(path.join(ws, 'link-target'), path.join(ws, 'linked.md.lock'), links);
    // Inside the workspace, but nothing beside it, or named just .lock.
    w(path.join(ws, 'alone.md.lock'), ''); w(path.join(ws, '.lock'), ''); w(path.join(ws, 'sub', '.lock'), 'z');
    linkTo(path.join(ws, 'link-target-2'), path.join(ws, 'alone-link.md.lock'), links);
    // Outside the workspace, with the store beside it, in every shape.
    w(path.join(base, 'Gemfile'), 'x'); w(path.join(base, 'Gemfile.lock'), ''); w(path.join(base, 'Podfile'), 'x'); w(path.join(base, 'Podfile.lock'), 'GEM\n');
    w(path.join(base, '.lock'), ''); w(path.join(base, '.venv', '.lock'), ''); w(path.join(base, '.venv', 'x'), 'x'); w(path.join(base, '.venv', 'x.lock'), '');
    w(path.join(base, 'rooted.md'), 'x'); linkTo(path.join(base, 'outer-target'), path.join(base, 'rooted.md.lock'), links);
    const found = locks.inspectStateLocks(base, { lang: 'en' });
    assert.deepStrictEqual(paths(found), ['.leerness/empty.md.lock', '.leerness/large.md.lock', '.leerness/linked.md.lock', '.leerness/small.md.lock', '.leerness/sub/deep.md.lock'], JSON.stringify(found));
    assert.deepStrictEqual(bucketOf(found, '.leerness/large.md.lock'), ['stuck'], 'a 200 KB file is a legacy lock too, and 6 minutes old');
    assert.equal(found.stuck.find(x => x.path === '.leerness/linked.md.lock').reason, 'link');
    assert.equal(found.stuck.find(x => x.path === '.leerness/small.md.lock').reason, 'legacy-file');
  } finally { for (const l of links) dropLink(l); }
});
test('scan rules: outside the workspace a lock folder counts only if it holds an owner record named the way leerness writes it', async root => {
  const pid = await deadPid(), main = rowFixture(root, { workspace: true }), base = main.base;
  const folder = (p, names) => { fs.mkdirSync(p, { recursive: true }); for (const n of names) { fs.writeFileSync(path.join(p, n), ''); age(path.join(p, n), 60000); } age(p, 60000); };
  folder(path.join(base, '.foo', 'a.lock'), ['owner-x']);                   // owner-<anything> is not the owner file name
  folder(path.join(base, '.foo', 'b.lock'), ['owner-' + 'A'.repeat(32) + '.json']);   // upper case hex is not what leerness writes
  folder(path.join(base, '.foo', 'c.lock'), []);                            // empty
  folder(path.join(base, '.foo', 'd.lock'), ['notes.txt']);
  assert.deepStrictEqual(paths(locks.inspectStateLocks(base, { lang: 'en' })), [], 'none of these is one of our locks');
  plant(root, path.join(base, '.foo', 'e.json'), { pid }); plant(root, path.join(base, 'f.json'), { body: '' });
  const found = locks.inspectStateLocks(base, { lang: 'en' });
  assert.deepStrictEqual(paths(found), ['.foo/e.json.lock', 'f.json.lock'], 'a folder with an owner record named owner-<32 hex>.json is counted, in a dot folder and at the root');
  assert.deepStrictEqual(bucketOf(found, '.foo/e.json.lock'), ['clearing']);
});
test('scan rules: the .lock suffix is compared without case where the file system folds case (Windows, macOS), and with case elsewhere', async root => {
  const main = rowFixture(root, { workspace: true }), base = main.base, ws = main.dir;
  const upper = path.join(ws, 'up.json.LOCK'); fs.mkdirSync(upper); const owner = path.join(upper, 'owner-' + hex(16) + '.json'); fs.writeFileSync(owner, ''); age(owner, 60000); age(upper, 60000);
  const tomb = path.join(ws, 'up2.json.LOCK.release-' + 'c'.repeat(32)); fs.mkdirSync(tomb);
  const folds = process.platform === 'win32' || process.platform === 'darwin';
  const found = locks.inspectStateLocks(base, { lang: 'en' });
  assert.deepStrictEqual(paths(found), folds ? ['.leerness/up.json.LOCK', '.leerness/up2.json.LOCK.release-' + 'c'.repeat(32)] : [], JSON.stringify(found));
  if (folds) { assert.deepStrictEqual(bucketOf(found, '.leerness/up.json.LOCK'), ['stuck']); assert.equal(found.stuck[0].reason, 'malformed-owner'); assert.equal(found.leftovers.length, 1); }
  // The same name is the same lock on those systems, so a writer is really blocked by it.
  if (folds) { const r = attempt(path.join(ws, 'up.json'), { maxWaitMs: 300 }); assert.equal(r.ran, false); assert.equal(r.error && r.error.lockState, 'malformed-owner'); }
});
test('scan rules: the workspace is walked first with an entry budget of its own, so a large project folder cannot hide its locks', async root => {
  const pid = await deadPid(), main = rowFixture(root, { workspace: true }), base = main.base, ws = main.dir;
  fs.mkdirSync(path.join(ws, 'sub')); plant(root, path.join(ws, 'a.json'), { pid }); plant(root, path.join(ws, 'sub', 'deep.json'), { pid });
  for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(base, `bulk-${i}.txt`), '');
  const small = locks.inspectStateLocks(base, { lang: 'en', maxEntries: 40 });
  assert.equal(small.truncated, true, 'the project folder alone has more entries than the limit');
  assert(paths(small).includes('.leerness/a.json.lock'), 'the workspace was walked before the project folder was read: ' + JSON.stringify(small));
  // The limit is per budget: 100 entries in the project folder do not shorten the workspace walk, and fewer than the limit do not truncate.
  const roomy = locks.inspectStateLocks(base, { lang: 'en', maxEntries: 150 });
  assert.equal(roomy.truncated, false); assert(paths(roomy).includes('.leerness/a.json.lock'));
  // A workspace with more entries than the limit is itself cut off, and says so.
  for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(ws, `junk-${String(i).padStart(2, '0')}.txt`), '');
  const cut = locks.inspectStateLocks(base, { lang: 'en', maxEntries: 40 });
  assert.equal(cut.truncated, true);
  // Two budgets, not one: 33 entries in the workspace and 31 in the project folder are each under 40, and together over it.
  const apart = rowFixture(root, { workspace: true });
  for (let i = 0; i < 30; i++) { fs.writeFileSync(path.join(apart.dir, `junk-${i}.txt`), ''); fs.writeFileSync(path.join(apart.base, `bulk-${i}.txt`), ''); }
  plant(root, path.join(apart.dir, 'z.json'), { pid });
  const separate = locks.inspectStateLocks(apart.base, { lang: 'en', maxEntries: 40 });
  assert.equal(separate.truncated, false, 'each budget is its own: ' + JSON.stringify(separate)); assert(paths(separate).includes('.leerness/z.json.lock'));
  // Only the workspace overflows (the project folder holds a handful of entries), so only the walk of the workspace can say so.
  const crowded = rowFixture(root, { workspace: true });
  for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(crowded.dir, `junk-${String(i).padStart(2, '0')}.txt`), '');
  assert.equal(locks.inspectStateLocks(crowded.base, { lang: 'en', maxEntries: 40 }).truncated, true, 'the walk of the workspace stops at its own limit');
  assert.equal(locks.inspectStateLocks(crowded.base, { lang: 'en', maxEntries: 100 }).truncated, false);
  assert.equal(locks.inspectStateLocks(base, { lang: 'en' }).truncated, false, 'the default limit is 20000 entries');
});
test('scan rules: optional usage writers skip blocked stores and no runtime writer fails open', async root => {
  const pid = await deadPid(), main = rowFixture(root, { workspace: true }), base = main.base, ws = main.dir, cache = path.join(ws, 'cache');
  fs.mkdirSync(cache);
  const rows = [
    ['usage-stats, malformed owner for 10 minutes', 'usage-stats.json', { body: '', ageMs: 600000 }, 'active', 'malformed-owner'],
    ['usage-stats, owner on another host for 10 minutes', 'usage-stats.json', { pid, patch: { host: 'another-computer' }, ageMs: 600000 }, 'active', 'other-host'],
    ['usage-stats, kept for recovery', 'usage-stats.json', { pid, patch: { keepOnCrash: 'x' }, ageMs: 600000 }, 'active', 'kept-for-recovery'],
    ['usage-stats, owner dead', 'usage-stats.json', { pid, ageMs: 600000 }, 'clearing', 'dead-owner'],
    ['control: another store in the same folder', 'other-store.json', { body: '', ageMs: 600000 }, 'stuck', 'malformed-owner'],
  ];
  const seenPaths = new Set();
  for (const [label, name, opts, bucket, reason] of rows) {
    const target = path.join(cache, name), rel = `.leerness/cache/${name}.lock`;
    if (seenPaths.has(name)) fs.rmSync(target + '.lock', { recursive: true, force: true });
    seenPaths.add(name); plant(root, target, opts);
    const found = locks.inspectStateLocks(base, { lang: 'en' });
    assert.deepStrictEqual(bucketOf(found, rel), [bucket], `${label}: ${JSON.stringify(found)}`);
    assert.equal([...found.active, ...found.clearing, ...found.stuck].find(x => x.path === rel).reason, reason, label);
  }
  // Empty folder and a time ahead of the clock on the same store: still not stuck.
  const empty = path.join(cache, 'usage-stats.json.lock'); fs.rmSync(empty, { recursive: true, force: true }); fs.mkdirSync(empty);
  const ahead = new Date(Date.now() + 3600000); fs.utimesSync(empty, ahead, ahead);
  assert.deepStrictEqual(bucketOf(locks.inspectStateLocks(base, { lang: 'en' }), '.leerness/cache/usage-stats.json.lock'), ['active']);
  const sources = [path.join(__dirname, '..', 'bin', 'leerness.js'), ...fs.readdirSync(path.join(__dirname, '..', 'lib')).filter(n => n.endsWith('.js')).map(n => path.join(__dirname, '..', 'lib', n))];
  const callers = sources.flatMap(f => { const text = fs.readFileSync(f, 'utf8'); return [...text.matchAll(/failOpen\s*:\s*true/g)].map(() => path.relative(path.join(__dirname, '..'), f).replace(/\\/g, '/')); });
  assert.deepStrictEqual(callers, [], 'runtime writers must not bypass a missing lock: ' + callers);
  const bump = cliLock('_bumpUsage'), bumpMcp = cliLock('_bumpMcpUsageBody');
  const original = { commands: { fixture: 1 }, mcp: { tools: { fixture: 2 } }, drift: { skipped: 3 }, owner: 'preserve' };
  const store = path.join(cache, 'usage-stats.json');fs.writeFileSync(store, JSON.stringify(original));
  const before = fs.readFileSync(store), held = lockState(empty);
  const control = rowFixture(root, { workspace: true }), target = path.join(control.dir, 'cache', 'usage-stats.json');
  fs.mkdirSync(path.dirname(target));fs.writeFileSync(target, JSON.stringify(original));
  const originalLock = locks.withStateLock, options = [];
  locks.withStateLock = (file, fn, opts) => { if (file === store || file === target) options.push(opts);return originalLock(file, fn, opts); };
  try {
    for (const update of [() => bump(base, 'fixture'), () => bumpMcp(base, 'fixture'), () => bump(base, null, 'skipped')]) {
      assert.strictEqual(update(), false);
      assert.deepStrictEqual(fs.readFileSync(store), before);
      assert.deepStrictEqual(lockState(empty), held);
    }
    assert.strictEqual(bump(control.base, 'fixture'), true);
    assert.strictEqual(bumpMcp(control.base, 'fixture'), true);
    assert.strictEqual(bump(control.base, null, 'skipped'), true);
  } finally { locks.withStateLock = originalLock; }
  assert.strictEqual(options.length, 6);
  for (const opts of options) { assert.strictEqual(opts.maxWaitMs, 300);assert.strictEqual(opts.failOpen, false); }
  const stats = JSON.parse(fs.readFileSync(target));
  assert.strictEqual(stats.commands.fixture, 2);assert.strictEqual(stats.mcp.tools.fixture, 3);
  assert.strictEqual(stats.drift.skipped, 4);assert.strictEqual(stats.owner, original.owner);
});
test('scan rules: a time more than 5 s ahead of the clock makes a lock stuck, because the 5 s rule and the age of an empty folder never run out', async root => {
  const pid = await deadPid(), main = rowFixture(root, { workspace: true }), base = main.base, ws = main.dir;
  const ahead = (p, ms) => { const d = new Date(Date.now() + ms); fs.utimesSync(p, d, d); };
  const rows = [
    ['dead owner, owner and folder in 2099', 'a', s => plant(root, s, { pid }), 3600000, 'stuck', 'dead-owner'],
    ['dead owner, 3 s ahead (inside the 5 s window)', 'b', s => plant(root, s, { pid }), 3000, 'clearing', 'dead-owner'],
    ['dead owner, 8 s ahead', 'c', s => plant(root, s, { pid }), 8000, 'stuck', 'dead-owner'],
    ['empty folder, 1 hour ahead', 'd', s => fs.mkdirSync(s + '.lock'), 3600000, 'stuck', 'empty'],
    ['empty folder, 3 s ahead', 'e', s => fs.mkdirSync(s + '.lock'), 3000, 'active', 'empty'],
    ['live owner, 1 hour ahead', 'f', s => plant(root, s, { pid: process.pid, ageMs: 0 }), 3600000, 'stuck', 'live-owner'],
    ['owner on another host, 1 hour ahead', 'g', s => plant(root, s, { pid, patch: { host: 'another-computer' } }), 3600000, 'stuck', 'other-host'],
  ];
  const futureEn = /Its recorded time is more than 5 s in the future, so it will not clear by itself/, futureKo = /기록된 시각이 5초 넘게 미래라서 저절로 풀리지 않습니다/;
  for (const [label, id, build, ms, bucket, reason] of rows) {
    const store = path.join(ws, id + '.json'), lock = store + '.lock'; build(store);
    ahead(lock, ms); for (const n of fs.readdirSync(lock)) ahead(path.join(lock, n), ms);
    const found = locks.inspectStateLocks(base, { lang: 'en' }), rel = `.leerness/${id}.json.lock`;
    assert.deepStrictEqual(bucketOf(found, rel), [bucket], `${label}: ${JSON.stringify(found)}`);
    const row = [...found.active, ...found.clearing, ...found.stuck].find(x => x.path === rel);
    assert.equal(row.reason, reason, label);
    if (bucket === 'stuck' && ['dead-owner', 'empty', 'live-owner'].includes(reason)) {
      assert(futureEn.test(row.action), `${label}: the action must not promise that it clears by itself: ${row.action}`);
      assert(futureKo.test(locks.inspectStateLocks(base, { lang: 'ko' }).stuck.find(x => x.path === rel).action), label + ' (ko)');
      const r = attempt(store, { maxWaitMs: 300, staleMs: 1 });
      assert.equal(r.ran, false, `${label}: a lock dated ahead is never reclaimed`); assert(futureEn.test(r.error.message), `${label}: the write failure says the same: ${r.error.message}`);
    }
  }
});
test('scan rules: a release leftover counts only as a real empty folder or one holding only its own token\'s owner file, and nothing else is called safe to delete', async root => {
  const main = rowFixture(root, { workspace: true }), base = main.base, ws = main.dir, links = [];
  const tomb = (name, token) => path.join(ws, `${name}.json.lock.release-${token}`);
  const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32), D = 'd'.repeat(32), E = 'e'.repeat(32), F = 'f'.repeat(32), G = '1'.repeat(32), H = '2'.repeat(32);
  try {
    fs.mkdirSync(tomb('empty', A)); age(tomb('empty', A), 60000);
    fs.mkdirSync(tomb('own', B)); fs.writeFileSync(path.join(tomb('own', B), `owner-${B}.json`), '{}\n');
    fs.mkdirSync(tomb('other-owner', C)); fs.writeFileSync(path.join(tomb('other-owner', C), `owner-${A}.json`), '{}\n');
    fs.mkdirSync(tomb('data', D)); fs.writeFileSync(path.join(tomb('data', D), 'precious.txt'), 'data');
    fs.mkdirSync(tomb('own-and-more', E)); fs.writeFileSync(path.join(tomb('own-and-more', E), `owner-${E}.json`), '{}\n'); fs.writeFileSync(path.join(tomb('own-and-more', E), 'more.txt'), 'x');
    fs.writeFileSync(tomb('file', F), 'a plain file');
    fs.mkdirSync(path.join(base, 'link-destination')); fs.symlinkSync(path.join(base, 'link-destination'), tomb('link', G), 'junction'); links.push(tomb('link', G));   // an empty folder: only the link check can refuse it
    fs.mkdirSync(tomb('owner-is-a-folder', H)); fs.mkdirSync(path.join(tomb('owner-is-a-folder', H), `owner-${H}.json`));
    const found = locks.inspectStateLocks(base, { lang: 'en' });
    assert.deepStrictEqual(found.leftovers.map(x => x.path).sort(), [`.leerness/empty.json.lock.release-${A}`, `.leerness/own.json.lock.release-${B}`], JSON.stringify(found));
    assert.deepStrictEqual([found.active.length, found.clearing.length, found.stuck.length], [0, 0, 0], 'a leftover is never a lock');
    for (const x of found.leftovers) assert.equal('action' in x, false);
    // Nothing was touched, and the text printed for the others never says "safe to delete".
    for (const t of [tomb('data', D), tomb('own-and-more', E), tomb('file', F), tomb('link', G), tomb('owner-is-a-folder', H), tomb('other-owner', C)]) assert(fs.existsSync(t), t);
    assert(fs.existsSync(path.join(base, 'link-destination')));
  } finally { for (const l of links) dropLink(l); }
});
// Characters built from code points on purpose: a source escape can be decoded on the way in.
const CH = c => String.fromCharCode(c);
// U+2028 is a legal file name character on Windows and POSIX, and `.` in a regular expression does not match it: the row that
// pins the two name patterns of condition 11 and of the publish finish on every platform. POSIX adds ESC and a line break.
function craftedNames() { return ['ev' + CH(0x202e) + 'il' + CH(0x200b) + 'name', 'ls' + CH(0x2028) + 'sep', ...(process.platform === 'win32' ? [] : ['esc' + CH(0x1b) + '[31m' + CH(10) + 'red' + CH(7)])]; }
const FORBIDDEN = new RegExp('[' + [[0, 9], [11, 0x1f], [0x7f, 0x9f], [0x2028, 0x2029], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]].map(([a, b]) => CH(a) + '-' + CH(b)).join('') + ']');
test('sanitizing: crafted names and owner fields never reach a message, a notice or a scan row', async root => {
  const pid = await deadPid(), evil = 'x' + CH(0x1b) + '[31m' + CH(10) + 'HOST' + CH(0x202e) + CH(7);
  const rows = [];
  for (const n of craftedNames()) {
    const a = rowFixture(root, { workspace: true, name: n + '.json' });
    plant(root, a.target, { body: '', ageMs: 60000 }); rows.push([`lock name ${JSON.stringify(n)}`, a, 'malformed-owner']);
    const b = rowFixture(root, { workspace: true, name: n + '.json' }); plant(root, b.target, { pid, patch: { host: evil, createdAt: evil } });
    rows.push([`host and createdAt ${JSON.stringify(n)}`, b, 'other-host']);
    const c = rowFixture(root, { workspace: true }); plant(root, c.target, { pid, patch: { keepOnCrash: evil } });
    rows.push(['keepOnCrash value', c, 'kept-for-recovery']);
    const d = rowFixture(root, { workspace: true }); plant(root, d.target, { pid });
    const scratch = path.join(d.dir, `.${n}.json.publish-cas-abc123`); fs.mkdirSync(scratch); fs.writeFileSync(path.join(scratch, 'before'), 'x');
    rows.push([`displaced name ${JSON.stringify(n)}`, d, 'displaced-target']);
  }
  for (const [label, row, reason] of rows) {
    const r = expectRow(label, row, reason, { skipPath: true });
    assert.equal(r.error.message.split('\n').length, 3, `${label}: three lines, no injected breaks: ${JSON.stringify(r.error.message)}`);
    assert(!FORBIDDEN.test(r.error.message), `${label}: forbidden character in ${JSON.stringify(r.error.message)}`);
    assert(!r.error.message.includes('HOST'), `${label}: the owner's host string reached the message`);
    const found = locks.inspectStateLocks(row.base, { lang: 'en' });
    for (const x of Object.values(found).filter(Array.isArray).flat()) for (const v of [x.path, x.reason, x.action]) if (typeof v === 'string') assert(!FORBIDDEN.test(v), `${label}: scan row ${JSON.stringify(v)}`);
    const ko = locks.inspectStateLocks(row.base, { lang: 'ko' });
    for (const x of Object.values(ko).filter(Array.isArray).flat()) for (const v of [x.path, x.action]) if (typeof v === 'string') assert(!FORBIDDEN.test(v), `${label} (ko): ${JSON.stringify(v)}`);
  }
  for (const n of craftedNames()) {
    const row = rowFixture(root, { workspace: true, name: n + '.json' }); plant(root, row.target, { pid });
    const r = attempt(row.target, { maxWaitMs: 3000 });
    assert.equal(r.ran, true, r.error && r.error.message);
    const text = r.stderr.replace(/\n$/, '');
    assert(notices(text, 'en').length === 1 && !FORBIDDEN.test(text), `notice for ${JSON.stringify(n)}: ${JSON.stringify(r.stderr)}`);
    assert(/name\.json|red *\.json|ls *sep\.json/.test(text), `the readable part of the name stays: ${text}`);
  }
});
test('file leases: a lock failure carries the lock path and its state in the error details', async root => {
  // The lease surface hides the lock message, so the details are the only place the person can learn which lock it was.
  const FL = require('../lib/file-leases'), row = rowFixture(root, { workspace: true });
  fs.mkdirSync(path.join(row.dir, 'cache')); const store = FL.storePath(row.base); fs.writeFileSync(path.join(row.base, 'tracked.txt'), 'x');
  const owner = plant(root, store, { body: '', ageMs: 60000 });
  let error = null;
  try { FL.acquire(row.base, 'tracked.txt', 'session-a', { withLock: (target, fn) => locks.withStateLock(target, fn, { maxWaitMs: 300 }) }); } catch (e) { error = e; }
  assert(error && error.code === 'lease_lock_unavailable', error && error.stack);
  assert.equal(error.details.lockCode, 'E_LOCK_TIMEOUT'); assert.equal(error.details.lockPath, store + '.lock');
  assert.equal(error.details.lockState, 'malformed-owner'); assert.equal(error.details.mutationMayHaveApplied, false);
  assert.equal(fs.existsSync(owner.file), true);
});
// ---- The CLI surfaces: verify, init, gate, update, and the stores that publish two files under one lock ----
const { copyTreeSync } = require('../lib/copy-tree');
const cliEnv = { ...env, LEERNESS_INTERNAL: '1', LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1',
  LEERNESS_NO_STALE_CHECK: '1', LEERNESS_OFFLINE: '1' };
function runCli(cwd, args, extra = {}) {
  const r = cp.spawnSync(process.execPath, [...(extra.prefix || []), cli, ...args], { cwd, env: { ...cliEnv, ...(extra.env || {}) },
    encoding: 'utf8', timeout: extra.timeout || 120000, windowsHide: true });
  assert.ifError(r.error);
  return r;
}
// A project made by the real `init`, copied for each test.
function projectCopy(root, name = 'project') {
  const seedDir = path.join(path.dirname(root), 'cli-seed-project');
  if (!fs.existsSync(seedDir)) {
    fs.mkdirSync(seedDir); fs.writeFileSync(path.join(seedDir, 'package.json'), '{"name":"p","version":"0.1.0"}');
    const made = runCli(seedDir, ['init', seedDir, '--yes', '--minimal', '--language', 'en']);
    assert.equal(made.status, 0, made.stdout + made.stderr);
  }
  const dir = path.join(root, name); copyTreeSync(seedDir, dir);
  return dir;
}
const LOCK_LINES = {
  active: { en: /ℹ Lock in use \(ends when that work finishes\): \.leerness\/zz-active\.json\.lock \(pid \d+\)/, ko: /ℹ 사용 중인 잠금 \(작업이 끝나면 풀립니다\): \.leerness\/zz-active\.json\.lock \(pid \d+\)/ },
  clearing: { en: /Lock left by a stopped process; the next write clears it: \.leerness\/zz-clear\.json\.lock/, ko: /멈춘 프로세스가 남긴 잠금입니다\. 다음 쓰기에서 풀립니다: \.leerness\/zz-clear\.json\.lock/ },
  leftovers: { en: /Release leftover \(blocks nothing, safe to delete\): \.leerness\/zz-left\.json\.lock\.release-d{32}/, ko: /해제 중 남은 폴더 \(쓰기를 막지 않으며 지워도 됩니다\): \.leerness\/zz-left\.json\.lock\.release-d{32}/ },
  stuck: { en: /Stuck lock: \.leerness\/zz-stuck\.json\.lock \(malformed-owner\)\. Its owner cannot be checked from here/, ko: /막힌 잠금: \.leerness\/zz-stuck\.json\.lock \(malformed-owner\)\. 여기서는 소유자를 확인할 수 없습니다/ },
};
function plantBucket(root, project, bucket, pid) {
  const ws = path.join(project, '.leerness');
  if (bucket === 'stuck') plant(root, path.join(ws, 'zz-stuck.json'), { body: '', ageMs: 60000 });
  else if (bucket === 'clearing') plant(root, path.join(ws, 'zz-clear.json'), { pid, ageMs: 60000 });
  else if (bucket === 'active') plant(root, path.join(ws, 'zz-active.json'), { pid: process.pid, ageMs: 0 });
  else if (bucket === 'leftovers') fs.mkdirSync(path.join(ws, 'zz-left.json.lock.release-' + 'd'.repeat(32)));
}
const lockCounts = j => Object.fromEntries(['active', 'clearing', 'stuck', 'leftovers'].map(k => [k, j.locks[k].length]));
test('verify and init: every bucket reports itself, and only stuck locks fail (text, Korean and JSON)', async root => {
  const pid = await deadPid();
  for (const bucket of ['stuck', 'clearing', 'active', 'leftovers']) {
    const project = projectCopy(root, bucket);
    plantBucket(root, project, bucket, pid);
    const stuck = bucket === 'stuck', want = Object.fromEntries(['active', 'clearing', 'stuck', 'leftovers'].map(k => [k, k === bucket ? 1 : 0]));
    const json = runCli(project, ['verify', project, '--json', '--language', 'en']), data = JSON.parse(json.stdout);
    assert.equal(json.status, stuck ? 1 : 0, `${bucket}: ${json.stdout}`); assert.equal(data.ok, !stuck); assert.equal(data.healthy, !stuck);
    assert.deepStrictEqual(lockCounts(data), want, `${bucket}: ${json.stdout}`); assert.equal(data.locks.truncated, false);
    assert.equal(data.failures.some(f => LOCK_LINES.stuck.en.test(f)), stuck, `${bucket}: failures ${JSON.stringify(data.failures)}`);
    if (stuck) { assert.equal(data.failures.length, 1, JSON.stringify(data.failures)); assert(/delete that lock/.test(data.locks.stuck[0].action)); }
    for (const lang of ['en', 'ko']) {
      const text = runCli(project, ['verify', project, '--language', lang]), out = text.stdout + text.stderr;
      assert.equal(text.status, stuck ? 1 : 0, `${bucket} ${lang}: ${out}`);
      assert(LOCK_LINES[bucket][lang].test(out), `${bucket} ${lang}: expected line missing in ${out}`);
      assert.equal(/verify passed/.test(out), !stuck, `${bucket} ${lang}: ${out}`);
      for (const other of Object.keys(LOCK_LINES)) if (other !== bucket && other !== 'stuck') assert(!LOCK_LINES[other][lang].test(out), `${bucket} ${lang}: line of ${other}`);
    }
  }
});
test('init: it reports locks after installing, fails only for stuck ones, and --dry-run and --json follow', async root => {
  const pid = await deadPid();
  for (const bucket of ['stuck', 'clearing', 'active', 'leftovers']) {
    const project = projectCopy(root, bucket), stuck = bucket === 'stuck';
    plantBucket(root, project, bucket, pid);
    const before = fs.readFileSync(path.join(project, '.leerness', 'HARNESS_VERSION'), 'utf8');
    const install = runCli(project, ['init', project, '--yes', '--minimal', '--language', 'en']), out = install.stdout + install.stderr;
    assert.equal(install.status, stuck ? 1 : 0, `${bucket}: ${out.slice(-1500)}`);
    assert(LOCK_LINES[bucket].en.test(out), `${bucket}: lock line missing in ${out.slice(-1500)}`);
    assert.equal(/The files were installed, but writes to the stores above will fail until this is resolved\./.test(out), stuck, `${bucket}: ${out.slice(-800)}`);
    const dry = runCli(project, ['init', project, '--dry-run', '--minimal', '--language', 'en']), dryOut = dry.stdout + dry.stderr;
    assert.equal(dry.status, stuck ? 1 : 0, `${bucket} dry-run: ${dryOut.slice(-1500)}`);
    assert.equal(/Dry run: nothing was installed, but writes to the stores above will fail\./.test(dryOut), stuck, `${bucket} dry-run: ${dryOut.slice(-800)}`);
    assert.equal(/The files were installed/.test(dryOut), false, 'a dry run installs nothing');
    const js = runCli(project, ['init', project, '--yes', '--minimal', '--language', 'en', '--json']);
    const data = JSON.parse(js.stdout.slice(js.stdout.indexOf('{')));
    assert.equal(js.status, stuck ? 1 : 0, js.stdout); assert.equal(data.ok, !stuck, js.stdout); assert.equal(data.action, 'init');
    assert.deepStrictEqual(lockCounts(data), Object.fromEntries(['active', 'clearing', 'stuck', 'leftovers'].map(k => [k, k === bucket ? 1 : 0])), js.stdout);
    assert.equal(fs.readFileSync(path.join(project, '.leerness', 'HARNESS_VERSION'), 'utf8'), before);
  }
});
test('gate and update: a stuck lock fails the verify step and the update exit, and the other buckets do not', async root => {
  const pid = await deadPid();
  for (const bucket of ['stuck', 'clearing']) {
    const project = projectCopy(root, bucket), stuck = bucket === 'stuck';
    plantBucket(root, project, bucket, pid);
    const gate = runCli(project, ['gate', project, '--json', '--language', 'en']), data = JSON.parse(gate.stdout);
    const step = data.checks.find(c => c.name === 'verify');
    assert.equal(gate.status, stuck ? 1 : 0, gate.stdout); assert.equal(step.ok, !stuck, gate.stdout);
    if (stuck) { assert(Array.isArray(step.failures) && step.failures.some(f => LOCK_LINES.stuck.en.test(f)), gate.stdout); assert.equal(data.checks.filter(c => !c.ok).length, 1, 'only the lock fails the gate'); }
    const update = runCli(project, ['update', project, '--force', '--yes', '--language', 'en']), out = update.stdout + update.stderr;
    assert(/update complete/.test(out), `${bucket}: update must still run to its end: ${out.slice(-1200)}`);
    assert.equal(update.status, stuck ? 1 : 0, `${bucket}: ${out.slice(-1200)}`);
    assert.equal(LOCK_LINES.stuck.en.test(out), stuck, `${bucket}: ${out.slice(-1200)}`);
  }
});
test('verify changes nothing in the project, locks included, apart from the usage counter the command wrapper writes', async root => {
  const pid = await deadPid(), project = projectCopy(root);
  for (const bucket of ['stuck', 'clearing', 'active', 'leftovers']) plantBucket(root, project, bucket, pid);
  const usage = path.join(project, '.leerness', 'cache', 'usage-stats.json');
  const snap = () => { const s = snapshotAll(project); for (const k of Object.keys(s)) if (path.join(project, k) === usage || k.startsWith('.leerness/cache/usage-stats.json')) delete s[k]; return s; };
  const before = snap();
  for (const args of [['verify', project, '--language', 'en'], ['verify', project, '--json', '--language', 'ko']]) {
    const r = runCli(project, args); assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.deepStrictEqual(snap(), before, `${args.join(' ')} changed the project`);
  }
});
test('verify and init: backup copies, other tools\' lock files and nested worktrees are not reported', async root => {
  const pid = await deadPid(), project = projectCopy(root), ws = path.join(project, '.leerness');
  fs.mkdirSync(path.join(project, '.leerness-backup')); plant(root, path.join(project, '.leerness-backup', 'old.json'), { pid });
  plant(root, path.join(project, '.leerness-backup', 'bad.json'), { body: '', ageMs: 600000 });
  fs.writeFileSync(path.join(project, 'Cargo.lock'), '# cargo\n'); fs.writeFileSync(path.join(project, 'Gemfile'), 'x\n'); fs.writeFileSync(path.join(project, 'Gemfile.lock'), 'GEM\n');
  age(path.join(project, 'Cargo.lock'), 600000); age(path.join(project, 'Gemfile.lock'), 600000);
  // Other tools' empty lock files, which an earlier version of the scan reported as stuck locks (verify and init failed): an
  // empty .venv/.lock (uv), an empty Gemfile.lock beside its Gemfile, Pipfile.lock and Podfile.lock, a root .lock, and a
  // folder that is not named the way leerness names an owner record.
  for (const [name, text] of [['.venv/.lock', ''], ['.lock', ''], ['Gemfile.lock', ''], ['Pipfile', '[x]\n'], ['Pipfile.lock', ''], ['Podfile', 'x\n'], ['Podfile.lock', ''], ['.foo/a.lock/owner-x', '']]) {
    const f = path.join(project, name); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); age(f, 600000);
  }
  // Release leftovers that are not empty, and a link, are never called safe to delete.
  const linkTarget = path.join(project, 'precious-data'); fs.mkdirSync(linkTarget); fs.writeFileSync(path.join(linkTarget, 'keep.txt'), 'data');
  const dataFolder = path.join(ws, 'x.json.lock.release-' + 'd'.repeat(32)); fs.mkdirSync(dataFolder); fs.writeFileSync(path.join(dataFolder, 'keep.txt'), 'data');
  fs.mkdirSync(path.join(project, 'other.lock')); fs.mkdirSync(path.join(ws, 'skills', 'uv'), { recursive: true }); fs.writeFileSync(path.join(ws, 'skills', 'uv', 'uv.lock'), 'v\n');
  const worktree = path.join(project, '.claude', 'worktrees', 'w1'); fs.mkdirSync(worktree, { recursive: true }); fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: x\n');
  plant(root, path.join(worktree, 'n.json'), { body: '', ageMs: 600000 });
  const json = runCli(project, ['verify', project, '--json', '--language', 'en']), data = JSON.parse(json.stdout);
  assert.equal(json.status, 0, json.stdout); assert.deepStrictEqual(lockCounts(data), { active: 0, clearing: 0, stuck: 0, leftovers: 0 }, json.stdout);
  const init = runCli(project, ['init', project, '--yes', '--minimal', '--language', 'en', '--json']);
  assert.equal(init.status, 0, init.stdout); assert.deepStrictEqual(lockCounts(JSON.parse(init.stdout.slice(init.stdout.indexOf('{')))), { active: 0, clearing: 0, stuck: 0, leftovers: 0 });
  const linked = path.join(ws, 'y.json.lock.release-' + 'e'.repeat(32)); fs.symlinkSync(linkTarget, linked, 'junction');
  try {
    for (const lang of ['en', 'ko']) {
      const text = runCli(project, ['verify', project, '--language', lang]), out = text.stdout + text.stderr;
      assert.equal(text.status, 0, out); assert(/verify passed|검증 통과|통과/.test(out), out);
      assert(!/safe to delete|지워도 됩니다|Stuck lock|막힌 잠금/.test(out), `${lang}: ${out}`);
    }
  } finally { dropLink(linked); }
  assert(fs.existsSync(path.join(linkTarget, 'keep.txt')) && fs.existsSync(path.join(dataFolder, 'keep.txt')), 'the scan changed nothing');
});
test('sanitizing: a lock whose name carries control and bidi characters is shown without them by verify and init', async root => {
  for (const n of craftedNames()) {
    const project = projectCopy(root, 'n' + craftedNames().indexOf(n)), ws = path.join(project, '.leerness');
    plant(root, path.join(ws, n + '.json'), { body: '', ageMs: 600000 });
    const json = runCli(project, ['verify', project, '--json', '--language', 'en']), data = JSON.parse(json.stdout);
    assert.equal(json.status, 1); assert.equal(data.locks.stuck.length, 1, json.stdout);
    for (const v of [data.locks.stuck[0].path, data.locks.stuck[0].action, ...data.failures]) assert(!FORBIDDEN.test(v), `verify --json: ${JSON.stringify(v)}`);
    for (const args of [['verify', project, '--language', 'en'], ['verify', project, '--language', 'ko'], ['init', project, '--yes', '--minimal', '--language', 'en'], ['init', project, '--yes', '--minimal', '--language', 'en', '--json']]) {
      const r = runCli(project, args), lines = (r.stdout + r.stderr).split(/\r?\n/).filter(l => /\.lock/.test(l));
      assert(lines.length > 0, `${args.join(' ')}: no lock line in ${r.stdout}`);
      for (const l of lines) assert(!FORBIDDEN.test(l), `${args.join(' ')}: ${JSON.stringify(l)}`);
    }
  }
});
// ---- The order of the death proof, the sentences, and the smaller rules of the scan ----
test('dead-owner reclaim: a live holder is reported as live whatever its marker, the history journal or a moved-aside file say (the death proof comes first)', async root => {
  const live = process.pid, op = state => JSON.stringify({ schema: 'leerness.history-operation/v1', state, action: 'retain',
    operationId: 'retain-' + 'a'.repeat(24), manifest: { operationId: 'retain-' + 'a'.repeat(24) } });
  const rows = [
    ['live pid with a keepOnCrash marker', {}, r => plant(root, r.target, { pid: live, patch: { keepOnCrash: 'memory-migration' } }), 'store.json.lock'],
    ['live pid on the tracker lock with a pending history journal', { name: 'progress-tracker.md', workspace: true },
      r => { fs.writeFileSync(path.join(r.dir, 'history-operation.json'), op('pending')); plant(root, r.target, { pid: live }); }, '.leerness/progress-tracker.md.lock'],
    ['live pid with a file moved aside in the folder', { workspace: true },
      r => { const d = path.join(r.dir, '.other.json.publish-cas-abc123'); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'before'), 'x'); plant(root, r.target, { pid: live }); }, '.leerness/store.json.lock'],
    ['live pid with a Windows replace scratch holding next and before', { workspace: true },
      r => { const d = path.join(r.dir, `.leerness-write-${live}-k3j2`); fs.mkdirSync(d); for (const f of ['next', 'before']) fs.writeFileSync(path.join(d, f), f); plant(root, r.target, { pid: live }); }, '.leerness/store.json.lock'],
  ];
  for (const [label, fixture, build, rel] of rows) {
    const r = rowFixture(root, fixture); build(r);
    expectRow(label, r, 'live-owner', { message: new RegExp(`Process ${live} on this computer holds it`) });
    const found = locks.inspectStateLocks(r.base, { lang: 'en' });
    assert.deepStrictEqual(bucketOf(found, rel), ['active'], `${label}: a working holder is in use, never stuck or kept: ${JSON.stringify(found)}`);
  }
});
test('lock failure texts: every action sentence, in English and Korean, word for word, and the delete sentence only where it belongs', async root => {
  const pid = await deadPid(), links = [];
  const op = state => JSON.stringify({ schema: 'leerness.history-operation/v1', state, action: 'retain', operationId: 'retain-' + 'a'.repeat(24), manifest: { operationId: 'retain-' + 'a'.repeat(24) } });
  const T = {
    liveYoung: [`Process ${process.pid} on this computer holds it. Wait for it to finish, or stop it if it is stuck, then retry; the lock then clears by itself.`,
      `이 컴퓨터의 프로세스 ${process.pid} 가 잡고 있습니다. 끝날 때까지 기다리거나 멈췄다면 종료한 뒤 다시 실행하세요. 그러면 잠금이 저절로 풀립니다.`],
    liveOld: [' Its heartbeat has stopped, so the number may have been reused. Only if you have confirmed that no leerness command is running on this project, delete that lock.',
      ' 잠금 갱신이 멈춰 있어 번호가 재사용됐을 수 있습니다. 이 프로젝트에서 실행 중인 leerness 명령이 없음을 확인한 경우에만 그 잠금을 지우세요.'],
    dead: ['Its owner has stopped. Retry; the next write clears it. If this repeats, delete that lock.', '소유자 프로세스가 이미 끝났습니다. 다시 실행하면 다음 쓰기에서 풀립니다. 계속 반복되면 그 잠금을 지우세요.'],
    empty: ['It has no owner record. Retry in 30 seconds; an empty lock clears by itself.', '소유자 기록이 없습니다. 30초 뒤 다시 실행하면 빈 잠금은 저절로 풀립니다.'],
    history: ['A history operation stopped partway and its process has ended. Retain the entire lock, owner record, archive and recovery files. Stop all writers and independently confirm the recorded owner has ended. Run leerness context history status and follow docs/history-retention.md for explicit non-destructive recovery; if ownership or artifacts are uncertain, stop.',
      '기록 보관 작업이 중간에 멈췄고 그 프로세스는 이미 끝났습니다. 잠금 디렉터리 전체와 소유자 기록, 보관본, 복구 파일을 보존하세요. 모든 쓰기를 중단하고 기록된 소유자의 종료를 별도로 확인하세요. leerness context history status 와 docs/history-retention.md 의 명시적 비파괴 복구 절차를 따르며, 소유권이나 자료가 불확실하면 중단하세요.'],
    migration: ['A memory migration stopped partway and its process has ended. Retain the entire lock, owner record, archive and recovery files. Stop all writers and independently confirm the recorded owner has ended. Run leerness memory-migration inspect and follow docs/memory-migration-write.md for explicit non-destructive recovery; if ownership or artifacts are uncertain, stop.',
      '메모리 이전이 중간에 멈췄고 그 프로세스는 이미 끝났습니다. 잠금 디렉터리 전체와 소유자 기록, 보관본, 복구 파일을 보존하세요. 모든 쓰기를 중단하고 기록된 소유자의 종료를 별도로 확인하세요. leerness memory-migration inspect 와 docs/memory-migration-write.md 의 명시적 비파괴 복구 절차를 따르며, 소유권이나 자료가 불확실하면 중단하세요.'],
    link: ['That path is a link, which leerness never creates. Remove the link itself, not what it points to.', '그 경로는 링크입니다. leerness 는 링크를 만들지 않습니다. 가리키는 대상이 아니라 링크 자체만 지우세요.'],
    cannot: reason => [`Its owner cannot be checked from here (${reason}). Check that no leerness command is running on this project, including on other computers, then delete that lock.`,
      `여기서는 소유자를 확인할 수 없습니다 (${reason}). 다른 컴퓨터를 포함해 이 프로젝트에서 실행 중인 leerness 명령이 없는지 확인한 뒤 그 잠금을 지우세요.`],
    hostTail: [' A restart or a renamed computer also looks like this.', ' 재시작했거나 컴퓨터 이름이 바뀌어도 이렇게 보입니다.'],
  };
  const displacedKnown = (r, before) => [`A save stopped after moving store.json aside. Move ${before} back to store.json, then delete that lock.`,
    `저장이 중간에 멈춰 store.json 이 옆으로 옮겨진 상태입니다. ${before} 를 store.json 으로 되돌린 뒤 그 잠금을 지우세요.`];
  const displacedUnknown = (r, before) => [`A save stopped after moving a file aside. Its original is ${before}, and it belongs to the file now missing beside store.json. Move it back under that name, then delete that lock.`,
    `저장이 중간에 멈춰 파일이 옆으로 옮겨진 상태입니다. 원본은 ${before} 이고, store.json 옆에서 사라진 파일의 것입니다. 그 이름으로 되돌린 뒤 그 잠금을 지우세요.`];
  const staleOpts = { maxWaitMs: 300, staleMs: 1 };
  const rows = [
    ['live owner touched a minute ago', 'live-owner', {}, staleOpts, r => plant(root, r.target, { pid: process.pid }), () => [T.liveYoung[0], T.liveYoung[1]], false],
    ['live owner touched 6 minutes ago', 'live-owner', {}, staleOpts, r => plant(root, r.target, { pid: process.pid, ageMs: 360000 }), () => [T.liveYoung[0] + T.liveOld[0], T.liveYoung[1] + T.liveOld[1]], true],
    ['live owner touched 4 minutes 50 seconds ago', 'live-owner', {}, staleOpts, r => plant(root, r.target, { pid: process.pid, ageMs: 290000 }), () => [T.liveYoung[0], T.liveYoung[1]], false],
    ['dead owner inside the 5 s rule', 'dead-owner', {}, staleOpts, r => plant(root, r.target, { pid, ageMs: 1000 }), () => T.dead, true],
    ['empty folder', 'empty', {}, { maxWaitMs: 300 }, r => fs.mkdirSync(r.target + '.lock'), () => T.empty, false],
    ['pending history journal', 'kept-for-recovery', { workspace: true, name: 'progress-tracker.md' }, staleOpts,
      r => { fs.writeFileSync(path.join(r.dir, 'history-operation.json'), op('pending')); plant(root, r.target, { pid }); }, () => T.history, false],
    ['memory migration marker', 'kept-for-recovery', {}, staleOpts, r => plant(root, r.target, { pid, patch: { keepOnCrash: 'memory-migration' } }), () => T.migration, false],
    ['unknown marker value', 'kept-for-recovery', {}, staleOpts, r => plant(root, r.target, { pid, patch: { keepOnCrash: 'a-future-marker' } }), () => T.cannot('kept-for-recovery'), true],
    ['moved-aside file, name known', 'displaced-target', { workspace: true }, staleOpts,
      r => { const d = path.join(r.dir, '.store.json.publish-cas-abc123'); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'before'), 'x'); plant(root, r.target, { pid }); },
      r => displacedKnown(r, path.join(r.dir, '.store.json.publish-cas-abc123', 'before')), true],
    ['moved-aside file, Windows arm (name unknown)', 'displaced-target', { workspace: true }, staleOpts,
      r => { const d = path.join(r.dir, `.leerness-write-${pid}-k3j2`); fs.mkdirSync(d); for (const f of ['next', 'before']) fs.writeFileSync(path.join(d, f), f); plant(root, r.target, { pid }); },
      r => displacedUnknown(r, path.join(r.dir, `.leerness-write-${pid}-k3j2`, 'before')), true],
    ['a link', 'link', {}, staleOpts, r => linkTo(path.join(r.dir, 'real-lock'), r.target + '.lock', links), () => T.link, false],
    ['owner record that is not JSON', 'malformed-owner', {}, staleOpts, r => plant(root, r.target, { body: '', ageMs: 60000 }), () => T.cannot('malformed-owner'), true],
    ['version 1 owner', 'legacy-owner', {}, staleOpts, r => plant(root, r.target, { pid, patch: { v: 1 } }), () => T.cannot('legacy-owner'), true],
    ['two owner files', 'unexpected-entries', {}, staleOpts, r => { const f = plant(root, r.target, { pid }); fs.writeFileSync(path.join(f.lock, 'stray.txt'), 'x'); }, () => T.cannot('unexpected-entries'), true],
    ['a legacy lock file', 'legacy-file', {}, staleOpts, r => { fs.writeFileSync(r.target + '.lock', '123'); age(r.target + '.lock', 60000); }, () => T.cannot('legacy-file'), true],
    ['owner on another computer', 'other-host', {}, staleOpts, r => plant(root, r.target, { pid, patch: { host: 'another-computer' } }), () => [T.cannot('other-host')[0] + T.hostTail[0], T.cannot('other-host')[1] + T.hostTail[1]], true],
    ['owner whose pid cannot be checked', 'unknown-identity', {}, staleOpts, r => plant(root, r.target, { pid: 2 ** 40 }), () => [T.cannot('unknown-identity')[0] + T.hostTail[0], T.cannot('unknown-identity')[1] + T.hostTail[1]], true],
  ];
  try {
    for (const [label, reason, fixture, opts, build, expected, deletes] of rows) {
      for (const [i, lang] of ['en', 'ko'].entries()) {
        const r = rowFixture(root, fixture); build(r);
        const preserved = label === 'pending history journal' || label === 'memory migration marker' ? snapshotAll(r.dir) : null;
        const result = attempt(r.target, opts, lang);
        assert.equal(result.ran, false, `${label} (${lang})`); assert.equal(result.error && result.error.lockState, reason, `${label} (${lang}): ${result.error && result.error.message}`);
        const lines = result.error.message.split('\n'), prefix = lang === 'en' ? '  What to do: ' : '  조치: ';
        assert(lines[2].startsWith(prefix), `${label} (${lang}): ${lines[2]}`);
        assert.equal(lines[2].slice(prefix.length), expected(r)[i], `${label} (${lang})`);
        assert.equal(/delete that lock|그 잠금을 지우세요|지운 뒤/.test(lines[2]), deletes, `${label} (${lang}): the delete sentence ${deletes ? 'is' : 'is not'} said here`);
        if (preserved) {
          assert.deepStrictEqual(snapshotAll(r.dir), preserved, `${label} (${lang}): the lock, owner and archive remain unchanged`);
          assert(!/delete|rename|move|restore|지우|삭제|이동|되돌리/.test(lines[2]), `${label} (${lang}): no unqualified destructive recovery instruction`);
        }
      }
    }
  } finally { for (const l of links) dropLink(l); }
});
test('dead-owner reclaim: an owner file over 4096 bytes is refused before any read, so a huge or special file is never opened', async root => {
  const pid = await deadPid(), row = rowFixture(root), s = plant(root, row.target, { pid, body: 'x'.repeat(3 * 1024 * 1024) });
  const readFile = fs.readFileSync, open = fs.openSync; let reads = 0;
  const mine = p => path.resolve(String(p)) === path.resolve(s.file);
  fs.readFileSync = function (p, ...rest) { if (mine(p)) reads++; return readFile.call(fs, p, ...rest); };
  fs.openSync = function (p, ...rest) { if (mine(p)) reads++; return open.call(fs, p, ...rest); };
  let r; try { r = attempt(row.target, { maxWaitMs: 400, staleMs: 1 }); } finally { fs.readFileSync = readFile; fs.openSync = open; }
  assert.equal(r.ran, false); assert.equal(r.error && r.error.lockState, 'malformed-owner');
  assert.equal(reads, 0, 'the size is checked from the file status, and the file is never opened');
});
test('dead-owner reclaim: with staleMs 1 the first check of the owner comes after 1 ms, not 250 ms, so a short wait still reclaims', async root => {
  // The waiting is simulated, so the verdict does not depend on how loaded the machine is: every sleep of the lock code only moves a
  // clock forward, and the first owner check falls at 1 ms of that clock (staleMs 1) or at 250 ms (the mutant, which ignores staleMs).
  const pid = await deadPid(), row = rowFixture(root); plant(root, row.target, { pid });
  const realNow = Date.now, realWait = Atomics.wait; let offset = 0, slept = 0;
  Date.now = () => realNow.call(Date) + offset;
  Atomics.wait = (array, index, value, ms) => { offset += ms; slept += ms; return 'timed-out'; };
  let r; try { r = attempt(row.target, { maxWaitMs: 200, staleMs: 1 }); } finally { Date.now = realNow; Atomics.wait = realWait; }
  assert.equal(r.ran, true, `a dead owner must be reclaimed within 200 ms of waiting when staleMs is 1: ${r.error && r.error.message} (${slept} ms slept)`);
  assert(slept < 100, `the reclaim came after ${slept} ms of waiting`);
});
test('dead-owner reclaim: an owner record whose pid scope id is not 32 hex characters is a legacy record, whatever else it holds', async root => {
  const pid = await deadPid(), row = rowFixture(root); plant(root, row.target, { pid, patch: { pidScopeId: 'xyz' } });
  expectRow('pid scope id is not hex', row, 'legacy-owner');
});
test('dead-owner reclaim: a failure of the publish finish stops the reclaim and keeps the owner, and the next wait finishes the job', async root => {
  const pid = await deadPid(), row = rowFixture(root, { workspace: true }), file = path.join(row.dir, 'data.md'), bytes = 'complete new bytes\n';
  fs.writeFileSync(file, bytes); const alias = path.join(row.dir, `.data.md.publish-${pid}-${hex(12)}`); fs.linkSync(file, alias);
  const s = plant(root, row.target, { pid }), unlink = fs.unlinkSync; let tried = 0;
  fs.unlinkSync = function (p, ...rest) { if (p === alias) { tried++; throw Object.assign(new Error('EPERM: operation not permitted, unlink'), { code: 'EPERM' }); } return unlink.call(fs, p, ...rest); };
  let r; try { r = attempt(row.target, { maxWaitMs: 700, staleMs: 1 }); } finally { fs.unlinkSync = unlink; }
  assert(tried >= 1, 'the finish must have tried to remove the second name');
  assert.equal(r.ran, false, 'a reclaim that could not finish the writer\'s last step must not take the lock'); assert.equal(r.error && r.error.lockState, 'dead-owner');
  assert.equal(fs.existsSync(s.file), true, 'the dead owner record stays'); assert.equal(fs.existsSync(alias), true); assert.equal(r.stderr.includes('Cleared a lock'), false);
  const again = attempt(row.target, { maxWaitMs: 3000, staleMs: 1 });
  assert.equal(again.ran, true, again.error && again.error.message); assert.equal(fs.existsSync(alias), false); assert.equal(fs.statSync(file).nlink, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), bytes);
});
test('dead-owner reclaim: a second name that someone else removes first is not a failure', async root => {
  // The unlink of the second name always meets ENOENT here (another waiter took it first), so a reclaim that stopped on it would
  // never get through, however long it waits.
  const pid = await deadPid(), row = rowFixture(root, { workspace: true }), file = path.join(row.dir, 'data.md');
  fs.writeFileSync(file, 'complete new bytes\n'); const alias = path.join(row.dir, `.data.md.publish-${pid}-${hex(12)}`); fs.linkSync(file, alias);
  plant(root, row.target, { pid }); const unlink = fs.unlinkSync; let met = 0;
  fs.unlinkSync = function (p, ...rest) { if (p === alias) { met++; throw Object.assign(new Error('ENOENT: no such file or directory, unlink'), { code: 'ENOENT' }); } return unlink.call(fs, p, ...rest); };
  try { expectRow('alias already removed', row, null); } finally { fs.unlinkSync = unlink; }
  assert(met >= 1, 'the finish must have tried to remove the second name');
});
test('dead-owner reclaim: the second name is removed only for a regular file with a real, non-zero identity that equals the live file\'s', async root => {
  const pid = await deadPid(), lstat = fs.lstatSync;
  for (const [label, fake, aliasStays] of [
    ['both names report inode 0 (a file system that gives no identity)', (p, o, alias) => ({ ino: 0n }), true],
    ['inodes that differ only above 2^53 (a Number would call them equal)', (p, o, alias) => ({ ino: o && o.bigint ? (1n << 60n) + (p === alias ? 1n : 2n) : 2 ** 60 }), true],
  ]) {
    const row = rowFixture(root, { workspace: true }), file = path.join(row.dir, 'data.md'), alias = path.join(row.dir, `.data.md.publish-${pid}-${hex(12)}`);
    fs.writeFileSync(file, 'bytes\n'); fs.writeFileSync(alias, 'other bytes\n'); plant(root, row.target, { pid });
    fs.lstatSync = function (p, ...rest) {
      const st = lstat.call(fs, p, ...rest);
      if (path.resolve(String(p)) === path.resolve(file) || path.resolve(String(p)) === path.resolve(alias)) {
        return Object.assign(Object.create(Object.getPrototypeOf(st)), st, fake(path.resolve(String(p)), rest[0], path.resolve(alias)));
      }
      return st;
    };
    try { expectRow(label, row, null); } finally { fs.lstatSync = lstat; }
    assert.equal(fs.existsSync(alias), aliasStays, `${label}: a name that is not provably the live file stays`);
    assert.equal(fs.readFileSync(alias, 'utf8'), 'other bytes\n');
  }
});
test('dead-owner reclaim: a scratch folder that is a link never lets the finish remove a name outside the store folder', async root => {
  const pid = await deadPid(), links = [];
  try {
    // Control: a real scratch folder whose next is the live file's second name goes (the same row as in the second-name test).
    const control = rowFixture(root, { workspace: true }), cfile = path.join(control.dir, 'store-a.json'), cscratch = path.join(control.dir, '.store-a.json.publish-cas-abc123');
    fs.writeFileSync(cfile, 'live\n'); fs.mkdirSync(cscratch); fs.linkSync(cfile, path.join(cscratch, 'next'));
    plant(root, control.target, { pid }); expectRow('real scratch folder', control, null);
    assert.equal(fs.existsSync(path.join(cscratch, 'next')), false);
    // The attack: the scratch name is a junction to a folder elsewhere, and that folder's `next` is a second name of the live file.
    const row = rowFixture(root, { workspace: true }), file = path.join(row.dir, 'store-b.json'), outside = path.join(row.base, 'elsewhere');
    fs.writeFileSync(file, 'live\n'); fs.mkdirSync(outside); fs.linkSync(file, path.join(outside, 'next')); fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
    const scratch = path.join(row.dir, '.store-b.json.publish-cas-abc123'); fs.symlinkSync(outside, scratch, 'junction'); links.push(scratch);
    plant(root, row.target, { pid }); expectRow('scratch folder that is a link', row, null);
    assert.equal(fs.existsSync(path.join(outside, 'next')), true, 'a name reached through a link is not removed');
    assert.equal(fs.statSync(file).nlink, 2); assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
  } finally { for (const l of links) dropLink(l); }
});
test('scan rules: the depth limits (8 in the workspace, 3 in other dot folders), the workspace archive, and folders that hold their own .git', async root => {
  const main = rowFixture(root, { workspace: true }), base = main.base, ws = main.dir;
  const at = (dir, name) => { fs.mkdirSync(dir, { recursive: true }); plant(root, path.join(dir, name + '.json'), { body: '' }); return path.relative(base, path.join(dir, name + '.json.lock')).split(path.sep).join('/'); };
  const deep = (start, n) => { let d = start; for (let i = 1; i < n; i++) d = path.join(d, 'd' + i); return d; };
  const expectIn = [at(deep(ws, 8), 'w8'), at(deep(path.join(base, '.foo'), 3), 'o3'), at(path.join(ws, 'sub', 'archive'), 'nested-archive'), at(path.join(base, '.plain-dot'), 'top')];
  const expectOut = [at(deep(ws, 9), 'w9'), at(deep(path.join(base, '.foo'), 4), 'o4'), at(path.join(ws, 'archive'), 'archive'),
    at(path.join(base, 'not-a-dot-folder'), 'plain'), at(path.join(base, '.hasgit'), 'hasgit')];
  fs.writeFileSync(path.join(base, '.hasgit', '.git'), 'gitdir: x\n');
  let found = paths(locks.inspectStateLocks(base, { lang: 'en' }));
  assert.deepStrictEqual(found, expectIn.slice().sort(), 'exactly the locks inside the limits are seen');
  for (const p of expectOut) assert(!found.includes(p), `${p} is outside the scan`);
  // Controls: with its .git gone the folder is walked.
  fs.unlinkSync(path.join(base, '.hasgit', '.git'));
  found = paths(locks.inspectStateLocks(base, { lang: 'en' }));
  assert(found.includes(expectOut[4]), 'a folder without its own .git is walked');
});
test('the owner record is written complete to a temporary name beside the store and renamed into the lock folder', async root => {
  const target = path.join(root, 'store.json'), lock = target + '.lock', open = fs.openSync, rename = fs.renameSync, calls = [];
  fs.openSync = function (p, flags, ...rest) { if (String(flags) === 'wx') calls.push({ op: 'open', p: String(p), flags: String(flags) }); return open.call(fs, p, flags, ...rest); };
  fs.renameSync = function (from, to) { calls.push({ op: 'rename', from: String(from), to: String(to), tempText: /\.tmp-/.test(String(from)) && fs.existsSync(from) ? fs.readFileSync(from, 'utf8') : null }); return rename.call(fs, from, to); };
  try { locks.withStateLock(target, () => 1); } finally { fs.openSync = open; fs.renameSync = rename; }
  const created = calls.find(c => c.op === 'open' && /\.tmp-[1-9][0-9]*-[1-9][0-9]*$/.test(c.p)), moved = calls.find(c => c.op === 'rename' && /owner-[a-f0-9]{32}\.json$/.test(c.to));
  assert(created && moved, JSON.stringify(calls));
  assert.equal(path.dirname(created.p), path.dirname(lock), 'the temporary file is beside the lock folder, not inside it');
  assert.equal(path.basename(created.p).startsWith('store.json.tmp-' + process.pid + '-'), true, created.p);
  assert.equal(moved.from, created.p); assert.equal(path.dirname(moved.to), lock);
  const record = JSON.parse(moved.tempText); assert.equal(record.pid, process.pid); assert.equal(path.basename(moved.to), `owner-${record.token}.json`);
  assert.equal(calls.some(c => c.op === 'open' && path.dirname(c.p) === lock), false, 'nothing is opened exclusively inside the lock folder any more');
  assert.deepStrictEqual(fs.readdirSync(root).filter(n => /\.tmp-/.test(n)), [], 'no temporary file is left');
});
test('the temporary owner name is one the runtime layout already admits for a store file', async root => {
  const R = require('../lib/runtime-layout'), project = path.join(root, 'standalone'), ws = path.join(project, '.leerness'), store = path.join(ws, 'execution-ledger.jsonl');
  fs.mkdirSync(ws, { recursive: true });
  let name = null; const open = fs.openSync;
  fs.openSync = function (p, flags, ...rest) { if (String(flags) === 'wx' && /\.tmp-/.test(String(p))) name = path.basename(String(p)); return open.call(fs, p, flags, ...rest); };
  try { locks.withStateLock(store, () => 1); } finally { fs.openSync = open; }
  assert(name && /^execution-ledger\.jsonl\.tmp-[1-9][0-9]*-[1-9][0-9]*$/.test(name), String(name));
  // A workspace that holds only standalone store files is judged by name; a stray temporary owner file must not turn it foreign.
  fs.writeFileSync(path.join(ws, name), '');
  const report = R.inspectRuntimeCompatibility(project);
  assert.equal(report.writeDisposition, 'allowed', report.reasonCode);
  fs.rmSync(path.join(ws, name)); fs.writeFileSync(path.join(ws, name + '-extra'), '');
  assert.equal(R.inspectRuntimeCompatibility(project).writeDisposition, 'blocked', 'control: a name the layout does not know is still refused');
});
test('creation failures leave neither a temporary file nor a lock folder: a failed rename is retried, a failed write stops with its code', async root => {
  const rename = fs.renameSync, write = fs.writeFileSync;
  // The rename into the folder fails once with EPERM (antivirus on Windows): the attempt is undone and the next one succeeds.
  {
    const target = path.join(root, 'retry.json'), lock = target + '.lock'; let failed = 0, ran = 0;
    fs.renameSync = function (from, to) { if (!failed && /owner-[a-f0-9]{32}\.json$/.test(String(to))) { failed++; throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' }); } return rename.call(fs, from, to); };
    try { locks.withStateLock(target, () => { ran++; }, { maxWaitMs: 3000 }); } finally { fs.renameSync = rename; }
    assert.equal(failed, 1); assert.equal(ran, 1); assert.equal(fs.existsSync(lock), false);
    assert.deepStrictEqual(fs.readdirSync(root).filter(n => /^retry\.json/.test(n)), [], 'neither a temporary file nor a lock folder is left');
  }
  // The write of the record fails with a code that is not retried: the writer stops with it, and cleans up.
  {
    const target = path.join(root, 'nospace.json'), lock = target + '.lock'; let failed = 0, ran = 0, fd = null;
    const open = fs.openSync; fs.openSync = function (p, flags, ...rest) { const x = open.call(fs, p, flags, ...rest); if (String(flags) === 'wx' && /\.tmp-/.test(String(p))) fd = x; return x; };
    fs.writeFileSync = function (f, ...rest) { if (fd !== null && f === fd && !failed) { failed++; throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }); } return write.call(fs, f, ...rest); };
    let r; try { r = attempt(target, { maxWaitMs: 1000 }); } finally { fs.writeFileSync = write; fs.openSync = open; }
    assert.equal(failed, 1); assert.equal(r.ran, false); assert.equal(r.error && r.error.code, 'E_LOCK_TIMEOUT'); assert(/\(ENOSPC\)/.test(r.error.message.split('\n')[0]), r.error.message);
    assert.equal(fs.existsSync(lock), false, 'the folder this attempt made is removed'); assert.deepStrictEqual(fs.readdirSync(root).filter(n => /^nospace\.json/.test(n)), [], 'and so is the temporary file');
  }
});
test('read-only scans do not remember "no pid scope" on the Linux path either: a later write still gets its identity', async root => {
  // The child pretends to be on Linux and has a host seed, so the pid scope comes from /proc/self/ns/pid. The first read fails
  // (as it does here on Windows), the scan runs read-only, then the namespace becomes readable and a write must work.
  const home = path.join(root, 'linux-home'), stateDir = path.join(home, 'leerness'); fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'lock-host-id'), 'a1'.repeat(32) + '\n');
  const main = rowFixture(root, { workspace: true });
  plant(root, path.join(main.dir, 'seen.json'), { pid: process.pid });   // a v2 record, so the scan reaches the identity check
  const run = launch('linux-pid-scope', root, { root: main.base, target: path.join(main.dir, 'later.json'), home });
  await run.closed; assert.equal(run.code, 0, run.out + run.err);
  const report = JSON.parse(run.out.trim().split('\n').pop());
  assert.equal(report.scanSawNoIdentity, true, 'both scans (an unreadable namespace name, and a failing read) must have met the missing pid scope: ' + run.out);
  assert.equal(report.ran, true, `a write after the scan must get its identity (code ${report.code}): ${run.out}`);
});
test('the managed .gitignore keeps lock folders out of a commit, and only lock folders', async root => {
  const { PROTECTED_GITIGNORE_LINES } = require('../lib/workspace-dir'), repo = path.join(root, 'repo'), git = (...a) => cp.spawnSync('git', a, { cwd: repo, encoding: 'utf8', windowsHide: true });
  fs.mkdirSync(repo); assert.equal(git('init', '-q').status, 0, 'git must be available');
  fs.writeFileSync(path.join(repo, '.gitignore'), PROTECTED_GITIGNORE_LINES.join('\n') + '\n');
  const owner = (dir) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'owner-' + hex(16) + '.json'), '{"host":"private"}\n'); };
  owner(path.join(repo, '.leerness', 'progress-tracker.md.lock')); owner(path.join(repo, '.leerness', 'cache', 'x.json.lock')); owner(path.join(repo, '.leerness', 'a', 'b', 'c.json.lock'));
  fs.writeFileSync(path.join(repo, '.leerness', `progress-tracker.md.tmp-${process.pid}-1`), '{"host":"private"}\n');
  fs.writeFileSync(path.join(repo, '.leerness', 'progress-tracker.md'), '# tracker\n'); fs.writeFileSync(path.join(repo, '.leerness', 'lessons.json'), '[]\n');
  fs.mkdirSync(path.join(repo, 'src')); fs.writeFileSync(path.join(repo, 'src', 'a.lock'), 'a plain file named like a lock\n');
  assert.equal(git('add', '-A').status, 0);
  const staged = git('ls-files').stdout.split(/\r?\n/).filter(Boolean).sort();
  assert.deepStrictEqual(staged, ['.gitignore', '.leerness/lessons.json', '.leerness/progress-tracker.md', 'src/a.lock'], 'owner records are never staged, in a lock folder or under a temporary name, and the files around them are');
});
test('memory input: a file with a second name left by an interrupted publish is refused with that name and with the way out, in both languages, and reading never removes it', async root => {
  const MI = require('../lib/memory-input'), pid = await deadPid(), dir = path.join(root, 'store'); fs.mkdirSync(dir);
  const file = path.join(dir, 'data.json'); fs.writeFileSync(file, '[]\n');
  const alias = path.join(dir, `.data.json.publish-${pid}-${hex(12)}`); fs.linkSync(file, alias);
  const before = snapshotAll(dir), refuse = (lang, how) => { let e = null; errorLang.withErrorLanguage(lang, () => { try { how(); } catch (x) { e = x; } }); return e; };
  for (const [lang, safe, then] of [['en', /^Memory input is not a single-link regular file: .* — an interrupted save of this file left a second name for it\. Deleting that name is safe and the file's bytes stay: /, /\. Delete it, then retry$/],
    ['ko', /^읽으려는 파일이 하드 링크가 하나뿐인 일반 파일이 아닙니다: .* — 이 파일을 저장하다 중단되어 두 번째 이름이 남았습니다\. 그 이름 /, / 을 지워도 안전하고 파일 내용은 그대로 남습니다\. 지운 뒤 다시 실행하세요$/]]) {
    for (const [label, how] of [['checked file input', () => MI.captureCheckedFileInput(file)], ['canonical memory input', () => MI.captureMemoryInput(file, path.join(dir, 'data.md'), () => [])]]) {
      const e = refuse(lang, how);
      assert(e && e.code === 'E_STORE_INVALID', `${label} (${lang}): ${e && e.stack}`);
      assert(safe.test(e.message) && then.test(e.message), `${label} (${lang}): ${e.message}`);
      assert(e.message.includes(alias), `${label} (${lang}): the second name is in the message: ${e.message}`); assert.equal(e.secondName, alias);
    }
  }
  assert.deepStrictEqual(snapshotAll(dir), before, 'reading changed no name, byte or time'); assert.equal(fs.statSync(file).nlink, 2);
  fs.unlinkSync(alias);
  assert.equal(MI.captureCheckedFileInput(file).exists, true, 'after the name is deleted the file reads again');
});
test('memory input: a second name that is not provably the interrupted publish\'s own is not named, and the refusal stays the plain one', async root => {
  const MI = require('../lib/memory-input'), pid = await deadPid(), dir = path.join(root, 'store'); fs.mkdirSync(dir);
  const file = path.join(dir, 'data.json'), other = path.join(dir, 'other.json'); fs.writeFileSync(file, '[]\n'); fs.writeFileSync(other, '[]\n');
  const plain = /^Memory input is not a single-link regular file: [^\n]*? — preserve the original, check its state and retry$/;
  const refusal = () => { let e = null; try { errorLang.withErrorLanguage('en', () => MI.captureCheckedFileInput(file)); } catch (x) { e = x; } return e; };
  const rows = [
    ['a copy under another name', f => fs.linkSync(f, path.join(dir, 'data-copy.json'))],
    ['the right shape with 23 hex characters', f => fs.linkSync(f, path.join(dir, `.data.json.publish-${pid}-${hex(12).slice(1)}`))],
    ['a pid of 0', f => fs.linkSync(f, path.join(dir, `.data.json.publish-0-${hex(12)}`))],
    ['a pid with a leading zero', f => fs.linkSync(f, path.join(dir, `.data.json.publish-0${pid}-${hex(12)}`))],
    ['the name of another file', f => fs.linkSync(f, path.join(dir, `.other.json.publish-${pid}-${hex(12)}`))],
    ['upper case hex', f => fs.linkSync(f, path.join(dir, `.data.json.publish-${pid}-${hex(12).toUpperCase()}`))],
  ];
  for (const [label, link] of rows) {
    link(file); const e = refusal(); assert(e && e.code === 'E_STORE_INVALID', `${label}: ${e && e.stack}`);
    assert.equal(e.secondName, undefined, `${label}: nothing is named`); assert(plain.test(e.message), `${label}: ${e.message}`);
    for (const n of fs.readdirSync(dir)) if (n !== 'data.json' && n !== 'other.json') fs.unlinkSync(path.join(dir, n));
  }
  // The right shape, but a different file: the file has its second name elsewhere (a copy), the shaped name is only a lookalike.
  fs.linkSync(file, path.join(dir, 'data-copy.json')); fs.writeFileSync(path.join(dir, `.data.json.publish-${pid}-${hex(12)}`), '[]\n');
  const e = refusal(); assert(e && e.secondName === undefined && plain.test(e.message), e && e.message);
});
test('file leases: the lock path in the error details is cleaned of control, line-separator and bidi characters, and the raw path stays on the error', async root => {
  // JSON.stringify does not escape U+202E, U+200B, U+2028 or U+009B, so a project folder named with them would reach a JSON consumer as it is.
  const FL = require('../lib/file-leases'), RLO = String.fromCharCode(0x202e), ZWSP = String.fromCharCode(0x200b), LS = String.fromCharCode(0x2028), CSI = String.fromCharCode(0x9b);
  const base = path.join(root, 'ev' + RLO + 'il' + ZWSP + LS + 'dir' + CSI + 'x'), ws = path.join(base, '.leerness');
  fs.mkdirSync(path.join(ws, 'cache'), { recursive: true }); fs.writeFileSync(path.join(ws, 'HARNESS_VERSION'), '1.36.306\n'); fs.writeFileSync(path.join(base, 'tracked.txt'), 'x');
  const store = FL.storePath(base); plant(root, store, { body: '', ageMs: 60000 });
  let error = null;
  try { FL.acquire(base, 'tracked.txt', 'session-a', { withLock: (target, fn) => locks.withStateLock(target, fn, { maxWaitMs: 300 }) }); } catch (e) { error = e; }
  assert(error && error.code === 'lease_lock_unavailable', error && error.stack);
  const shown = error.details.lockPath, wanted = (store + '.lock').split(RLO).join('').split(ZWSP).join('').split(LS).join(' ').split(CSI).join(' ');
  assert.equal(shown, wanted, 'the same cleaning as the other lock surfaces: the readable name stays, the characters go');
  assert(!FORBIDDEN.test(shown) && !FORBIDDEN.test(JSON.stringify(error.details)), JSON.stringify(error.details));
  assert.equal(error.details.lockState, 'malformed-owner');
  // The same cleaning is what the failure message of the lock itself uses, so the two cannot disagree.
  let raw = null; try { errorLang.withErrorLanguage('en', () => locks.withStateLock(store, () => 1, { maxWaitMs: 300 })); } catch (e) { raw = e; }
  assert.equal(raw.lockPath, store + '.lock', 'the error object keeps the real path for programs'); assert(raw.message.includes(`Lock path: ${shown}`), raw.message);
});
test('sanitizing: a scan row for a moved-aside file the Windows way carries no raw file name in its action (the name is unknown, so the action names the store file)', async root => {
  const pid = await deadPid();
  for (const n of craftedNames()) {
    const row = rowFixture(root, { workspace: true, name: n + '.json' }); plant(root, row.target, { pid });
    const scratch = path.join(row.dir, `.leerness-write-${pid}-k3j2`); fs.mkdirSync(scratch); for (const f of ['next', 'before']) fs.writeFileSync(path.join(scratch, f), f);
    for (const lang of ['en', 'ko']) {
      const found = locks.inspectStateLocks(row.base, { lang }), stuck = found.stuck.find(x => x.reason === 'displaced-target');
      assert(stuck, `${JSON.stringify(n)} ${lang}: ${JSON.stringify(found)}`);
      assert(!FORBIDDEN.test(stuck.action) && !FORBIDDEN.test(stuck.path), `${lang}: ${JSON.stringify(stuck)}`);
      assert(/\.json/.test(stuck.action), 'the action still names the store file, cleaned: ' + stuck.action);
    }
  }
});
test('a stuck lock on the usage counter fails neither verify nor init, and the command that counts usage goes on', async root => {
  const project = projectCopy(root), ws = path.join(project, '.leerness'), store = path.join(ws, 'cache', 'usage-stats.json');
  fs.mkdirSync(path.dirname(store), { recursive: true }); plant(root, store, { body: '', ageMs: 600000 });
  const json = runCli(project, ['verify', project, '--json', '--language', 'en']), data = JSON.parse(json.stdout);
  assert.equal(json.status, 0, json.stdout); assert.equal(data.ok, true); assert.deepStrictEqual(lockCounts(data), { active: 1, clearing: 0, stuck: 0, leftovers: 0 }, json.stdout);
  assert.equal(data.locks.active[0].path, '.leerness/cache/usage-stats.json.lock');
  const init = runCli(project, ['init', project, '--yes', '--minimal', '--language', 'en']); assert.equal(init.status, 0, init.stdout + init.stderr);
  assert(!/writes to the stores above will fail/.test(init.stdout + init.stderr), 'init does not claim that writes will fail');
  // The writers really go on: the counter waits 300 ms, warns, and lets the command finish.
  const add = runCli(project, ['task', 'add', 'a task while the counter lock is stuck', '--path', project, '--json', '--language', 'en']);
  assert.equal(add.status, 0, add.stdout + add.stderr);
  assert(fs.readFileSync(path.join(ws, 'progress-tracker.md'), 'utf8').includes('a task while the counter lock is stuck'));
});
test('verify and init: a scan that stops at 20000 entries says so in both languages, a lock in the workspace is still found, and the Korean init lines are exact', async root => {
  const project = projectCopy(root, 'big'), ws = path.join(project, '.leerness');
  plant(root, path.join(ws, 'zz-stuck.json'), { body: '', ageMs: 60000 });
  // Entries in the project folder itself: the walk of its top level is what the second budget counts.
  for (let i = 0; i < 20001; i++) fs.closeSync(fs.openSync(path.join(project, `bulk-${i}.txt`), 'w'));
  const LINES = { en: 'Lock scan stopped at 20000 entries; some folders were not checked.', ko: '잠금 검사를 20000개 항목에서 멈췄습니다. 일부 폴더는 확인하지 못했습니다.' };
  const json = runCli(project, ['verify', project, '--json', '--language', 'en']), data = JSON.parse(json.stdout);
  assert.equal(json.status, 1, json.stdout.slice(0, 600)); assert.equal(data.locks.truncated, true);
  assert.deepStrictEqual(data.locks.stuck.map(x => x.path), ['.leerness/zz-stuck.json.lock'], 'the workspace is walked first, with a budget of its own');
  for (const lang of ['en', 'ko']) {
    const text = runCli(project, ['verify', project, '--language', lang]), out = text.stdout + text.stderr;
    assert.equal(text.status, 1, out.slice(-600)); assert(out.includes(LINES[lang]), `${lang} verify: ${out.slice(-800)}`);
    assert(out.includes(lang === 'en' ? 'Stuck lock: .leerness/zz-stuck.json.lock' : '막힌 잠금: .leerness/zz-stuck.json.lock'), `${lang}: ${out.slice(-800)}`);
  }
  const KO = { installed: '파일은 설치했지만, 해결할 때까지 위 저장소 쓰기는 실패합니다.', dry: '시험 실행이라 설치하지 않았지만, 위 저장소 쓰기는 실패합니다.' };
  const EN = { installed: 'The files were installed, but writes to the stores above will fail until this is resolved.', dry: 'Dry run: nothing was installed, but writes to the stores above will fail.' };
  for (const [lang, T] of [['en', EN], ['ko', KO]]) {
    const install = runCli(project, ['init', project, '--yes', '--minimal', '--language', lang]), out = install.stdout + install.stderr;
    assert.equal(install.status, 1, out.slice(-800)); assert(out.includes(LINES[lang]), `${lang} init: ${out.slice(-800)}`); assert(out.includes(T.installed), `${lang} init: ${out.slice(-800)}`);
    const dry = runCli(project, ['init', project, '--dry-run', '--minimal', '--language', lang]), dryOut = dry.stdout + dry.stderr;
    assert.equal(dry.status, 1, dryOut.slice(-800)); assert(dryOut.includes(T.dry), `${lang} dry run: ${dryOut.slice(-800)}`); assert(dryOut.includes(LINES[lang]), `${lang} dry run: ${dryOut.slice(-800)}`);
  }
});
test('a decisions or lessons store with a second name left by an interrupted publish: the real commands refuse with that name, write nothing, and removing it ends the dead end', async root => {
  const pid = await deadPid();
  for (const [store, command] of [['decisions', ['decision', 'add', 'a decision after the kill']], ['lessons', ['lesson', 'save', 'a lesson after the kill']]]) {
    const project = projectCopy(root, 'two-names-' + store), ws = path.join(project, '.leerness'), canonical = path.join(ws, store + '.json');
    // One real save first, so the canonical file and its projection exist and agree.
    const first = runCli(project, [...command.slice(0, 2), command[2] + ' (first)', '--path', project, '--json', '--language', 'en']); assert.equal(first.status, 0, first.stdout + first.stderr);
    const alias = path.join(ws, `.${store}.json.publish-${pid}-${hex(12)}`); fs.linkSync(canonical, alias);
    const before = snapshotAll(ws);
    for (const lang of ['en', 'ko']) {
      const r = runCli(project, [...command, '--path', project, '--json', '--language', lang]), data = JSON.parse(r.stdout);
      assert.equal(r.status, 1, `${store} ${lang}: ${r.stdout}`); assert.equal(data.ok, false); assert.equal(data.code, 'store_invalid');
      assert(data.error.includes(alias), `${store} ${lang}: the message names the second name: ${data.error}`);
      assert(lang === 'en' ? /Deleting that name is safe and the file's bytes stay/.test(data.error) : /지워도 안전하고 파일 내용은 그대로 남습니다/.test(data.error), `${store} ${lang}: ${data.error}`);
    }
    const after = snapshotAll(ws); for (const k of Object.keys(after)) if (k.startsWith('cache/usage-stats.json')) { delete after[k]; delete before[k]; }
    assert.deepStrictEqual(after, before, `${store}: a refused command changes nothing in the workspace`);
    fs.unlinkSync(alias);
    const again = runCli(project, [...command, '--path', project, '--json', '--language', 'en']);
    assert.equal(again.status, 0, `${store}: after the name is deleted the command works: ${again.stdout}${again.stderr}`);
  }
});
// Two files published under one lock: a kill between them leaves a split pair that fails closed with a way out.
function killHook(root, name, fileName) {
  const hook = path.join(root, `kill-before-${name}.cjs`);
  fs.writeFileSync(hook, `const path = require('path'), out = require(${JSON.stringify(path.resolve(__dirname, '../lib/memory-output'))}), publish = out.publishMemoryOutput;
out.publishMemoryOutput = function (token, file, bytes) { if (path.basename(String(file)) === ${JSON.stringify(fileName)}) process.kill(process.pid, 'SIGKILL'); return publish.apply(this, arguments); };\n`);
  return ['--require', hook];
}
function ageLocks(ws, names) {
  for (const n of names) { const lock = path.join(ws, n + '.lock'); for (const f of fs.readdirSync(lock)) age(path.join(lock, f), 60000); age(lock, 60000); }
}
test('projection kill: lessons killed between the .json and the .md leave a split pair; the next save reclaims, fails closed with the new text, and moving the .md aside is the way out', async root => {
  const project = projectCopy(root), ws = path.join(project, '.leerness'), pure = require('../lib/pure-utils');
  const entry = { date: '2026-09-11', text: 'base', tag: 'tag' };
  fs.writeFileSync(path.join(ws, 'lessons.json'), JSON.stringify([entry], null, 2) + '\n'); fs.writeFileSync(path.join(ws, 'lessons.md'), pure._renderLessonsMd([entry], 'en'));
  const mdBefore = fs.readFileSync(path.join(ws, 'lessons.md'));
  const killed = runCli(project, ['lesson', 'save', 'second lesson', '--path', project, '--json'], { prefix: killHook(root, 'lessons-md', 'lessons.md') });
  assert.notEqual(killed.status, 0, 'the save must have been killed: ' + killed.stdout + killed.stderr); assert.equal(killed.stdout.trim(), '');
  assert(fs.readFileSync(path.join(ws, 'lessons.json'), 'utf8').includes('second lesson'), 'the canonical file is ahead');
  assert(fs.readFileSync(path.join(ws, 'lessons.md')).equals(mdBefore), 'the projection is behind');
  const [lockOwner] = fs.readdirSync(path.join(ws, 'lessons.json.lock')); assert.equal(JSON.parse(fs.readFileSync(path.join(ws, 'lessons.json.lock', lockOwner), 'utf8')).pid, killed.pid);
  ageLocks(ws, ['lessons.json']);
  const again = runCli(project, ['lesson', 'save', 'third lesson', '--path', project, '--json'], {});
  const data = JSON.parse(again.stdout);
  assert.notEqual(again.status, 0, again.stdout); assert.equal(data.code, 'projection_diverged', again.stdout);
  assert(/left behind by an interrupted save/.test(data.error) && /move this file aside and retry/.test(data.error) && /rebuilt from its \.json store/.test(data.error), data.error);
  assert.deepStrictEqual(notices(again.stderr, 'en'), [{ pid: killed.pid, file: 'lessons.json' }], again.stderr);
  assert.equal(fs.existsSync(path.join(ws, 'lessons.json.lock')), false, 'the lock was cleared and released');
  assert(!fs.readFileSync(path.join(ws, 'lessons.json'), 'utf8').includes('third lesson'), 'a refused save writes nothing');
  fs.renameSync(path.join(ws, 'lessons.md'), path.join(ws, 'lessons.md.aside'));
  const fixed = runCli(project, ['lesson', 'save', 'third lesson', '--path', project, '--json'], {});
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  const rebuilt = fs.readFileSync(path.join(ws, 'lessons.md'), 'utf8'), canonical = JSON.parse(fs.readFileSync(path.join(ws, 'lessons.json'), 'utf8'));
  assert.deepStrictEqual(canonical.map(x => x.text), ['base', 'second lesson', 'third lesson']);
  assert.equal(rebuilt, pure._renderLessonsMd(canonical, 'en'), 'the projection is rebuilt from the .json store');
});
test('projection kill: teams killed between teams.json and teams.md leave two dead locks; the next write reclaims both, fails closed with the new text, and moving teams.md aside is the way out', async root => {
  const project = projectCopy(root), ws = path.join(project, '.leerness'), pure = require('../lib/pure-utils');
  const initial = [{ id: 'original', name: 'first', members: ['worker'], personas: ['review'], schedule: 'manual', status: 'active' }];
  fs.writeFileSync(path.join(ws, 'teams.json'), JSON.stringify(initial, null, 2) + '\n'); fs.writeFileSync(path.join(ws, 'teams.md'), pure._renderTeamsMd(initial));
  const mdBefore = fs.readFileSync(path.join(ws, 'teams.md'));
  const killed = runCli(project, ['team', 'add', 'new', '--name', 'Second', '--path', project, '--json'], { prefix: killHook(root, 'teams-md', 'teams.md') });
  assert.notEqual(killed.status, 0, 'the write must have been killed: ' + killed.stdout + killed.stderr); assert.equal(killed.stdout.trim(), '');
  assert(JSON.parse(fs.readFileSync(path.join(ws, 'teams.json'), 'utf8')).some(t => t.id === 'new'), 'teams.json is ahead');
  assert(fs.readFileSync(path.join(ws, 'teams.md')).equals(mdBefore), 'teams.md is behind');
  assert.deepStrictEqual(fs.readdirSync(ws).filter(n => /\.lock$/.test(n)).sort(), ['teams.json.lock', 'teams.md.lock'], 'a kill inside the nested lock leaves both');
  ageLocks(ws, ['teams.json', 'teams.md']);
  const again = runCli(project, ['team', 'add', 'other', '--name', 'Third', '--path', project, '--json'], {}), data = JSON.parse(again.stdout);
  assert.notEqual(again.status, 0, again.stdout); assert.equal(data.code, 'E_TEAM_PROJECTION_EDITED', again.stdout);
  assert(/an edit or an interrupted save can cause/.test(data.error) && /rebuilt from teams\.json if you move it aside/.test(data.error), data.error);
  assert.deepStrictEqual(notices(again.stderr, 'en').map(x => x.file).sort(), ['teams.json', 'teams.md'], again.stderr);
  assert.equal(fs.readdirSync(ws).some(n => /^teams\.(json|md)\.lock$/.test(n)), false, 'both locks were cleared and released');
  fs.renameSync(path.join(ws, 'teams.md'), path.join(ws, 'teams.md.aside'));
  const fixed = runCli(project, ['team', 'add', 'other', '--name', 'Third', '--path', project, '--json'], {});
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  const teams = JSON.parse(fs.readFileSync(path.join(ws, 'teams.json'), 'utf8'));
  assert.deepStrictEqual(teams.map(t => t.id), ['original', 'new', 'other']);
  assert.equal(fs.readFileSync(path.join(ws, 'teams.md'), 'utf8'), pure._renderTeamsMd(teams), 'teams.md is rebuilt from teams.json');
});
function killSelf() {
  process.kill(process.pid, 'SIGKILL');
  process.stdout.write('SURVIVED\n');   // only reached if the kill did not work
  process.exit(9);
}
// Child modes of the dead-owner tests; each reads its parameters from LOCK_PROBE_SPEC.
const reclaimChildren = {
  hold(spec) {
    locks.withStateLock(spec.target, () => {
      if (spec.content !== undefined) fs.writeFileSync(spec.store, spec.content);
      process.stdout.write('held\n');
      return new Promise(() => {});
    }, spec.opts || {});
    setInterval(() => {}, 1000);
  },
  write(spec) {
    process.stdout.write('waiting\n');
    if (spec.startAt) while (Date.now() < spec.startAt) sleepMs(5);
    try {
      errorLang.withErrorLanguage(spec.lang || 'en', () => locks.withStateLock(spec.target, () => { fs.appendFileSync(spec.store, spec.id + '\n'); }, spec.opts || {}));
      process.stdout.write(`done ${Date.now()}\n`);
    } catch (e) { process.stdout.write(JSON.stringify({ code: e.code, lockState: e.lockState }) + '\n'); process.exitCode = 3; }
  },
  // Takes the lock and is killed at one named step of the acquire, reclaim or release code.
  'kill-at'(spec) {
    // The owner record is written to `<store>.tmp-<pid>-<n>` and renamed into the lock folder, so the creation points are named by that.
    const ownerRe = /owner-[a-f0-9]{32}\.json$/, tempRe = /\.tmp-[1-9][0-9]*-[1-9][0-9]*$/, real = {};
    for (const k of ['unlinkSync', 'rmdirSync', 'openSync', 'closeSync', 'renameSync', 'writeFileSync']) real[k] = fs[k];
    let tempFd = null;
    const isLock = p => path.resolve(String(p)) === path.resolve(spec.lock);
    const watchTempFd = () => { fs.openSync = function (p, ...r) { const fd = real.openSync.call(fs, p, ...r); if (tempRe.test(String(p))) tempFd = fd; return fd; }; };
    const points = {
      'reclaim-before-unlink': () => { fs.unlinkSync = function (p, ...r) { if (ownerRe.test(String(p))) killSelf(); return real.unlinkSync.call(fs, p, ...r); }; },
      'reclaim-before-rmdir': () => { fs.rmdirSync = function (p, ...r) { if (isLock(p)) killSelf(); return real.rmdirSync.call(fs, p, ...r); }; },
      'reclaim-after-rmdir': () => { fs.rmdirSync = function (p, ...r) { const x = real.rmdirSync.call(fs, p, ...r); if (isLock(p)) killSelf(); return x; }; },
      'create-before-temp-open': () => { fs.openSync = function (p, ...r) { if (tempRe.test(String(p))) killSelf(); return real.openSync.call(fs, p, ...r); }; },
      'create-temp-empty': () => { fs.openSync = function (p, ...r) { const fd = real.openSync.call(fs, p, ...r); if (tempRe.test(String(p))) killSelf(); return fd; }; },
      'create-temp-partial': () => {
        watchTempFd();
        fs.writeFileSync = function (f, data, ...r) {
          if (tempFd !== null && f === tempFd) { fs.writeSync(f, Buffer.from(String(data)).subarray(0, 20)); killSelf(); }
          return real.writeFileSync.call(fs, f, data, ...r);
        };
      },
      'create-temp-written': () => {
        watchTempFd();
        fs.closeSync = function (fd) { if (tempFd !== null && fd === tempFd) killSelf(); return real.closeSync.call(fs, fd); };
      },
      'create-owner-renamed': () => { fs.renameSync = function (a, b) { const x = real.renameSync.call(fs, a, b); if (ownerRe.test(String(b))) killSelf(); return x; }; },
      'release-after-rename': () => { fs.renameSync = function (a, b) { const x = real.renameSync.call(fs, a, b); if (/\.lock\.release-[a-f0-9]{32}$/.test(String(b))) killSelf(); return x; }; },
    };
    points[spec.point]();
    errorLang.withErrorLanguage('en', () => locks.withStateLock(spec.target, () => { process.stdout.write('in-callback\n'); }, spec.opts || {}));
    process.stdout.write('finished\n');
  },
  // Scans, then writes, in a process whose host seed folder is empty.
  'inspect-no-seed'(spec) {
    const seedFile = path.join(require('../lib/machine-cache').machineStateDir(), 'lock-host-id');
    const report = { seedBased: process.platform !== 'linux' || !['/etc/machine-id', '/var/lib/dbus/machine-id'].some(f => fs.existsSync(f)) };
    const found = locks.inspectStateLocks(spec.root, { workspaceDir: '.leerness', lang: 'en' });
    report.activeReasons = found.active.map(x => x.reason); report.seedAfterInspect = fs.existsSync(seedFile);
    try { locks.withStateLock(spec.target, () => { report.ran = true; }, { maxWaitMs: 500 }); } catch (e) { report.ran = false; report.code = e.code; }
    report.seedAfterWrite = fs.existsSync(seedFile);
    process.stdout.write(JSON.stringify(report) + '\n');
  },
  // Pretends to be Linux with a host seed in place, so the pid scope comes from /proc/self/ns/pid. The first read of it fails, the
  // read-only scan runs, then the namespace becomes readable and a write must still get its identity.
  'linux-pid-scope'(spec) {
    const realReadlink = fs.readlinkSync, report = {};
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const namespace = value => { fs.readlinkSync = function (p, ...r) {
      if (String(p) !== '/proc/self/ns/pid') return realReadlink.call(fs, p, ...r);
      if (value === null) throw Object.assign(new Error('ENOENT: no such file or directory, readlink'), { code: 'ENOENT' });
      return value;
    }; };
    // Two ways the read can fail: it names nothing that looks like a namespace, or it throws.
    const scans = [];
    for (const value of ['not-a-namespace', null]) { namespace(value); scans.push(locks.inspectStateLocks(spec.root, { workspaceDir: '.leerness', lang: 'en' }).active.some(x => x.reason === 'unknown-identity')); }
    report.scanSawNoIdentity = scans.every(Boolean);
    fs.readlinkSync = function (p, ...r) { if (String(p) === '/proc/self/ns/pid') return 'pid:[4026531836]'; return realReadlink.call(fs, p, ...r); };
    try { locks.withStateLock(spec.target, () => { report.ran = true; }, { maxWaitMs: 500 }); } catch (e) { report.ran = false; report.code = e.code; }
    process.stdout.write(JSON.stringify(report) + '\n');
  },
  'publish-kill'(spec) {
    const out = require('../lib/memory-output'), realLink = fs.linkSync;
    locks.withStateLock(spec.target, () => {
      const token = out.captureMemoryOutput(spec.file);
      fs.linkSync = function (from, to) {
        const r = realLink.call(fs, from, to);
        if (path.resolve(String(to)) === path.resolve(spec.file)) killSelf();
        return r;
      };
      out.publishMemoryOutput(token, spec.file, 'complete bytes\n');
    });
  },
};
if (process.argv[2] === '--child') {
  const [mode, root, id] = process.argv.slice(3);
  if (mode === 'append') {
    for (let i = 0; i < 3; i++) ledger.withExecutionLedgerLock(root, () => ledger.appendExecutionEvent(root, record(id + i)));
  } else if (reclaimChildren[mode]) {
    reclaimChildren[mode](JSON.parse(process.env.LOCK_PROBE_SPEC || '{}'));
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
