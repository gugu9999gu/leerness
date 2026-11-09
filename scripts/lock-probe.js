 
//
 
 
 
 
 
//
 
'use strict';
require('./temp-cleanup').trackTemp(module);  
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = process.env.LOCKPROBE_OUT;
const rec = [];
const held = new Set();
const norm = p => { try { return path.resolve(String(p)); } catch { return String(p); } };
 
 
 
 
const LOCK_INTERNAL = /\.lock(?:\.release-[0-9a-f]+)?(?:[\\/]|$)/i;
 
 
const isState = p => /[\\/]\.leerness[\\/]/.test(p) && !/[\\/]archive[\\/]/.test(p)
  && !LOCK_INTERNAL.test(p) && !/\.tmp-\d+-\d+$/.test(p) && !/[\\/]\.[^\\/]+\.publish-\d+-[0-9a-f]+$/.test(p);
const relOf = p => (p.split(/[\\/]\.leerness[\\/]/)[1] || p).replace(/\\/g, '/');
 
 
 
const STALL_TARGET = String(process.env.LOCKPROBE_STALL_TARGET || '').replace(/\\/g, '/').replace(/^\.?\/+/, '');
const STALL_ABSOLUTE = process.env.LOCKPROBE_STALL_TARGET && path.isAbsolute(process.env.LOCKPROBE_STALL_TARGET)
  ? norm(process.env.LOCKPROBE_STALL_TARGET).replace(/\\/g, '/') : null;
const STALL_PREFIX = String(process.env.LOCKPROBE_STALL_PREFIX || '').replace(/\\/g, '/').replace(/^\.?\/+/, '');
const STALL_MS = Math.max(0, Math.min(10000, Number(process.env.LOCKPROBE_STALL_MS) || 0));
const READY_FILE = process.env.LOCKPROBE_READY_FILE ? path.resolve(process.env.LOCKPROBE_READY_FILE) : null;
 
 
 
 
 
 
 
 
const targetMatcher = raw => {
  const value = String(raw || '');
  if (!value) return () => false;
  if (path.isAbsolute(value)) { const full = norm(value).replace(/\\/g, '/'); return p => norm(p).replace(/\\/g, '/') === full; }
  const rel = value.replace(/\\/g, '/').replace(/^\.?\/+/, '');
  return p => relOf(norm(p)) === rel;
};
const REACH_FILE = process.env.LOCKPROBE_REACH_FILE ? path.resolve(process.env.LOCKPROBE_REACH_FILE) : null;
const isReachTarget = REACH_FILE ? targetMatcher(process.env.LOCKPROBE_REACH_TARGET) : () => false;
const WAIT_FILE = process.env.LOCKPROBE_WAIT_FILE ? path.resolve(process.env.LOCKPROBE_WAIT_FILE) : null;
const WAIT_MAX_MS = Math.max(0, Math.min(60000, Number(process.env.LOCKPROBE_WAIT_MAX_MS) || 15000));
let stalled = false;
const shouldStall = p => {
  if (stalled || STALL_MS <= 0) return false;
  // The owner record of a lock is renamed into the lock folder from a temporary name (lib/state-lock.js), and a lock folder is renamed on
  // release. Neither is a write of the state file this stalls on, so a prefix must not stop at them.
  if (LOCK_INTERNAL.test(String(p))) return false;

  if (STALL_ABSOLUTE) return norm(p).replace(/\\/g, '/') === STALL_ABSOLUTE;
  const rel = relOf(norm(p));
  return (STALL_TARGET && rel === STALL_TARGET) || (STALL_PREFIX && rel.startsWith(STALL_PREFIX));
};
const stall = ms => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { const until = Date.now() + ms; while (Date.now() < until) {} }
};
const _existsRaw = fs.existsSync.bind(fs);
const _readRaw = fs.readFileSync.bind(fs);
 
 
 
 
const REACH_LOCKS_FILE = process.env.LOCKPROBE_REACH_LOCKS_FILE ? path.resolve(process.env.LOCKPROBE_REACH_LOCKS_FILE) : null;
 
 
 
 
 
let firstHeld = new Set(), firstHeldKnown = !REACH_LOCKS_FILE;
if (REACH_LOCKS_FILE && REACH_FILE) {
  const until = Date.now() + 2000;
  for (;;) {
    try { const heldOn = JSON.parse(_readRaw(REACH_LOCKS_FILE, 'utf8')).heldOn; if (Array.isArray(heldOn)) { firstHeld = new Set(heldOn); firstHeldKnown = true; break; } } catch {}
    if (Date.now() >= until) break;
    stall(10);
  }
}
const heldByFirst = p => firstHeld.has(relOf(norm(p)));
 
 
const report = firstHeldKnown ? {} : { heldUnknown: true };
 
 
 
let reportFailed = false;
 
 
const FAIL_AFTER = process.env.LOCKPROBE_REPORT_FAIL_AFTER === undefined ? Infinity : Number(process.env.LOCKPROBE_REPORT_FAIL_AFTER);
let writes = 0;
const writeReport = () => {
  try {
    if (++writes > FAIL_AFTER) throw Object.assign(new Error('injected report write failure'), { code: 'EACCES' });
    fs.writeFileSync.call(fs, REACH_FILE, JSON.stringify(report), 'utf8');
    return true;
  } catch (error) {
    reportFailed = true;
     
     
    process.exitCode = 97;
    if (writes <= FAIL_AFTER) { try { fs.unlinkSync.call(fs, REACH_FILE); } catch {} }
    try { process.stderr.write(`lock-probe: the race report could not be written (${error && error.code || error})\n`); } catch {}
    return false;
  }
};
if (REACH_FILE) {
  process.on('exit', () => {
    if (!report.read && !report.lock && !reportFailed) return;
    if (reportFailed) report.failed = true; else report.complete = true;
    if (!writeReport() || report.failed) process.exitCode = 97;
  });
}
const isWatchedLock = p => { const lock = String(p); return /\.lock$/i.test(lock) && (isReachTarget(lock.slice(0, -'.lock'.length)) || heldByFirst(lock)); };
 
const reachedRead = (p, how) => {
  if (!REACH_FILE || report.read) return;
  try { if (isReachTarget(String(p))) { report.read = { target: relOf(norm(p)), how, at: Date.now() }; writeReport(); } } catch {}
};
 
const reachedLock = (p, error) => {
  if (!REACH_FILE || report.lock) return;
  try {
    if (!isWatchedLock(p)) return;
    if (error && error.code !== 'EEXIST') return;
    report.lock = { target: relOf(norm(p)), result: error ? 'contended' : 'acquired', at: Date.now() };
    writeReport();
  } catch {}
};
for (const [name, how] of [['readFileSync', 'read'], ['existsSync', 'exists'], ['statSync', 'stat'], ['lstatSync', 'stat'], ['accessSync', 'stat']]) {
  const original = fs[name].bind(fs);
  fs[name] = function (p, ...a) { try { return original(p, ...a); } finally { reachedRead(p, how); } };
}

const _mkdir = fs.mkdirSync.bind(fs);
fs.mkdirSync = function (p, ...a) {
  const isLock = /\.lock$/.test(String(p));
  let r;
  try { r = _mkdir(p, ...a); } catch (error) { if (isLock) reachedLock(p, error); throw error; }
  if (isLock) reachedLock(p, null);
  try { if (isLock) held.add(norm(p)); } catch {}
  return r;
};
const _rmdir = fs.rmdirSync.bind(fs);
fs.rmdirSync = function (p, ...a) {
  const r = _rmdir(p, ...a);
  try { if (/\.lock$/.test(String(p))) held.delete(norm(p)); } catch {}
  return r;
};
 
const _open = fs.openSync.bind(fs);
fs.openSync = function (p, flags, ...a) {
  const isLock = String(flags) === 'wx' && /\.lock$/.test(String(p));
  let r;
  try { r = _open(p, flags, ...a); }
  catch (error) { if (isLock) reachedLock(p, error); else reachedRead(p, 'open'); throw error; }
  if (isLock) reachedLock(p, null); else reachedRead(p, 'open');
  try { if (isLock) held.add(norm(p)); } catch {}
  return r;
};
const _unlink = fs.unlinkSync.bind(fs);
fs.unlinkSync = function (p, ...a) {
  const r = _unlink(p, ...a);
  try { if (/\.lock$/.test(String(p))) held.delete(norm(p)); } catch {}
  return r;
};

 
 
 
 
const note = (target, how) => {
  const t = norm(target);
  if (!isState(t)) return;
  rec.push({ file: relOf(t), how, locked: held.size > 0, heldOn: [...held].map(relOf).sort() });
};
const _w = fs.writeFileSync.bind(fs);
fs.writeFileSync = function (p, ...a) { try { note(p, 'write'); } catch {} return _w(p, ...a); };
const stallBefore = (to) => {
  try {
    if (shouldStall(to)) {
      stalled = true;
      const target = norm(to);
      const ready = { target: relOf(target), locked: held.has(target + '.lock'), heldOn: [...held].map(relOf).sort() };
      if (READY_FILE) _w(READY_FILE, JSON.stringify(ready), 'utf8');
      if (WAIT_FILE) {
         
         
        const started = Date.now();
        while (!_existsRaw(WAIT_FILE) && Date.now() - started < WAIT_MAX_MS) stall(10);
        ready.reached = _existsRaw(WAIT_FILE);
        ready.waitedMs = Date.now() - started;
        if (READY_FILE) _w(READY_FILE, JSON.stringify(ready), 'utf8');
      }
      stall(STALL_MS);
       
      if (WAIT_FILE) { ready.resumedAt = Date.now(); if (READY_FILE) _w(READY_FILE, JSON.stringify(ready), 'utf8'); }
    }
  } catch {}
};
const _r = fs.renameSync.bind(fs);
fs.renameSync = function (from, to) {
  try { note(to, 'rename'); } catch {}
  stallBefore(to);
  const r = _r(from, to);
   
   
   
  try {
    const source = norm(from);
    if (held.has(source) && /\.lock$/i.test(String(from)) && LOCK_INTERNAL.test(String(to))) held.delete(source);
  } catch {}
  return r;
};
const _a = fs.appendFileSync.bind(fs);
fs.appendFileSync = function (p, ...args) { try { note(p, 'append'); } catch {} return _a(p, ...args); };
 
 
 
 
const _l = fs.linkSync.bind(fs);
fs.linkSync = function (from, to) {
  try { note(to, 'link'); } catch {}
  stallBefore(to);
  return _l(from, to);
};
 
 
 
const cp = require('child_process');
const _spawnSync = cp.spawnSync;
cp.spawnSync = function (file, args, options) {
  const to = options && options.env && options.env.LEERNESS_REPLACE_TO;
  if (to) { try { note(to, 'replace'); } catch {} stallBefore(to); }
  return _spawnSync.apply(this, arguments);
};

process.on('exit', () => {
  if (!OUT) return;
  try { fs.appendFileSync(OUT, rec.map(r => JSON.stringify(r)).join('\n') + (rec.length ? '\n' : ''), 'utf8'); } catch {}
});

 
 
if (require.main === module) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lock-probe-selftest-'));
  try {
    const harness = path.join(root, '.leerness');
    const state = path.join(harness, 'state.json');
    const lock = `${state}.lock`;
    const tombstone = `${lock}.release-0123456789abcdef0123456789abcdef`;
    const ownerName = 'owner-0123456789abcdef0123456789abcdef.json';
    fs.mkdirSync(harness, { recursive: true });
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, ownerName), '{"token":"0123456789abcdef0123456789abcdef"}\n');
    fs.writeFileSync(state, '{"phase":"held"}\n');
    fs.renameSync(lock, tombstone);
    const movedOwner = path.join(tombstone, ownerName);
     
    fs.writeFileSync(movedOwner, '{"phase":"deletion-pending"}\n');
    fs.unlinkSync(movedOwner);
    fs.writeFileSync(state, '{"phase":"released"}\n');
    const stateRows = rec.filter(row => row.file === 'state.json');
    const passed = rec.length === 2
      && stateRows.length === 2
      && stateRows[0].locked === true
      && stateRows[0].heldOn.length === 1
      && stateRows[0].heldOn[0] === 'state.json.lock'
      && stateRows[1].locked === false
      && stateRows[1].heldOn.length === 0
      && rec.every(row => !/\.lock\.release-/i.test(row.file))
      && held.size === 0;
    if (!passed) {
      process.stderr.write(`lock-probe selftest failed: ${JSON.stringify({ stateRows, held: [...held], rec })}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write('lock-probe selftest passed: release tombstone is internal and public lock lifetime ended\n');
    }
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
}
