'use strict';
 
 
const fs = require('fs');
const path = require('path');
const os = require('os');
const { mkdirpRaw, assertWriteAllowed, mutationRecoveryFolder } = require('./io');
const { withRuntimePathWrite, assertCurrentRuntimeWrite } = require('./runtime-writes');
const { errorLanguage } = require('./error-language');
function _sleepSyncMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms | 0)); }
  catch { const end = Date.now() + ms; while (Date.now() < end) {} }
}
 
 
 
 
 
 
const _lockScopes = new (require('async_hooks').AsyncLocalStorage)();
const _heldLocks = new Map();   
 
 
const _LOCK_RETRY_CODES = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);
const _lockFailOpen = [];    
 
 
 
const _LOCK_UNKNOWN_OWNER_STALE_MS = 5 * 60 * 1000;
// A waiter reads the owner only this often: opening it on every poll kept the file open and failed the holder's release rename on Windows.
const _LOCK_OWNER_CHECK_MS = 250;
// An owner file touched this recently is never reclaimed. The time only blocks a reclaim and never allows one.
const _LOCK_OWNER_FRESH_MS = 5000;
const _LOCK_OWNER_MAX_BYTES = 4096;
const _LOCK_MAX_SCAN_ENTRIES = 20000;
const _LOCK_HEX32_RE = /^[a-f0-9]{32}$/;
// A release leftover: `<store>.lock.release-<token>`. The store name is never empty, and it may hold a line break.
const _LOCK_TOMBSTONE_RE = /[\s\S]\.lock\.release-([a-f0-9]{32})$/;
const _LOCK_LEASE = 'worker-v1';
const _LOCK_OWNER_VERSION = 2;
const _LOCK_OWNER_FILE_RE = /^owner-([a-f0-9]{32})\.json$/;
 
 
const _PROCESS_STARTED_AT_MS = Math.round(Date.now() - process.uptime() * 1000);
let _lockHostIdentityCache;
let _lockPidScopeIdentityCache;
function _readLockHostSeed(file) {
  try { const v = String(fs.readFileSync(file, 'utf8') || '').trim(); return /^[a-f0-9]{64}$/i.test(v) ? v.toLowerCase() : null; }
  catch { return null; }
}
function _persistentLockHostSeed(readOnly) {
   
   
  const dir = require('./machine-cache').machineStateDir();
  if (!dir) return null;
  const fp = path.join(dir, 'lock-host-id');
  let seed = _readLockHostSeed(fp); if (seed) return seed;
  if (readOnly) return null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const candidate = require('crypto').randomBytes(32).toString('hex');
    fs.writeFileSync(fp, candidate + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return candidate;
  } catch {}
   
   
  for (let i = 0; i < 4; i++) { _sleepSyncMs(10 + i * 10); seed = _readLockHostSeed(fp); if (seed) return seed; }
  return null;
}
// readOnly: never create the host seed and never remember "no identity", so a read-only check leaves no trace.
function _lockHostIdentity(readOnly) {
  if (_lockHostIdentityCache !== undefined) return _lockHostIdentityCache;
  let raw = null;
  try {
    if (process.platform === 'linux') {
      let machine = null; let boot = null;
      for (const fp of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        try { const v = String(fs.readFileSync(fp, 'utf8') || '').trim(); if (/^[a-f0-9-]{16,}$/i.test(v)) { machine = v; break; } } catch {}
      }
       
       
       
      try {
        const v = String(fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8') || '').trim();
        if (/^[a-f0-9-]{16,}$/i.test(v)) boot = v;
      } catch {}
      if (machine && boot) raw = `${machine}|boot:${boot}`;
    }
    if (!raw) raw = _persistentLockHostSeed(readOnly);
  } catch { raw = null; }
  if (!raw && readOnly) return null;
  _lockHostIdentityCache = raw
    ? require('crypto').createHash('sha256').update(`leerness-lock-host-v1|${process.platform}|${raw}`).digest('hex').slice(0, 32)
    : null;
  return _lockHostIdentityCache;
}
function _lockPidScopeIdentity(readOnly) {
  if (_lockPidScopeIdentityCache !== undefined) return _lockPidScopeIdentityCache;
  const hostId = _lockHostIdentity(readOnly);
  if (!hostId) { if (!readOnly) _lockPidScopeIdentityCache = null; return null; }
  let scope = hostId;
  if (process.platform === 'linux') {
     
     
     
    try {
      const ns = String(fs.readlinkSync('/proc/self/ns/pid') || '').trim();
      if (!/^pid:\[[0-9]+\]$/.test(ns)) { if (!readOnly) _lockPidScopeIdentityCache = null; return null; }
      scope = `${hostId}|${ns}`;
    } catch { if (!readOnly) _lockPidScopeIdentityCache = null; return null; }
  }
  _lockPidScopeIdentityCache = require('crypto').createHash('sha256')
    .update(`leerness-lock-pid-scope-v1|${process.platform}|${scope}`).digest('hex').slice(0, 32);
  return _lockPidScopeIdentityCache;
}
let _lockHeartbeatWorker = null;
let _lockHeartbeatUnavailable = false;
function _ensureLockHeartbeat() {
  if (_lockHeartbeatWorker) return true;
  if (_lockHeartbeatUnavailable) return false;
  try {
    const { Worker } = require('worker_threads');
    const worker = new Worker(`
      'use strict';
      const fs = require('fs');
      const { parentPort, workerData } = require('worker_threads');
      // A plain require here resolves from the working folder; Node 22.11.0 on Windows crashes if that path does not fit the ANSI code page.
      const { withRuntimeWriteAdmissions } = require('module').createRequire(workerData.runtimeWrites)(workerData.runtimeWrites);
      const locks = new Map();
      function touch(ownerPath, entry) {
        try {
          const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
          if (!owner || owner.token !== entry.token || owner.lease !== 'worker-v1') { locks.delete(ownerPath); return; }
          // Re-check the holding operation's admission; a new admission would run git in the project.
          const beat = () => fs.utimesSync(ownerPath, new Date(), new Date());
          if (entry.admissions.length) withRuntimeWriteAdmissions(entry.admissions, beat); else beat();
        } catch { locks.delete(ownerPath); }
      }
      parentPort.on('message', (m) => {
        if (!m || typeof m.ownerPath !== 'string') return;
        if (m.op === 'add' && typeof m.token === 'string') {
          const entry = { token: m.token, admissions: Array.isArray(m.admissions) ? m.admissions : [] };
          locks.set(m.ownerPath, entry); touch(m.ownerPath, entry);
        }
        else if (m.op === 'remove') locks.delete(m.ownerPath);
      });
      const timer = setInterval(() => { for (const [p, t] of locks) touch(p, t); }, 1000);
      if (timer.unref) timer.unref();
    `, { eval: true, workerData: { runtimeWrites: require.resolve('../lib/runtime-writes') } });
    worker.on('error', () => { _lockHeartbeatWorker = null; _lockHeartbeatUnavailable = true; });
    worker.on('exit', (code) => { _lockHeartbeatWorker = null; if (code !== 0) _lockHeartbeatUnavailable = true; });
    worker.unref();
    _lockHeartbeatWorker = worker;
    return true;
  } catch { _lockHeartbeatUnavailable = true; return false; }
}
function _lockHeartbeat(op, ownerPath, token) {
  try {
    if (!_lockHeartbeatWorker) return;
    const admissions = op === 'add' ? require('./runtime-writes').runtimeWriteAdmissions() : [];
    _lockHeartbeatWorker.postMessage({ op, ownerPath, token, admissions });
  } catch {}
}
function _newLockOwner(lease, keepOnCrash) {
  const hostId = _lockHostIdentity();
  const pidScopeId = _lockPidScopeIdentity();
  if (!hostId || !pidScopeId) {
    const err = new Error('lock host or PID-scope identity is unavailable');
    err.code = 'E_LOCK_HOST_ID';
    throw err;
  }
  return {
    v: _LOCK_OWNER_VERSION,
    pid: process.pid,
    host: String(os.hostname() || '').toLowerCase(),
    hostId,
    pidScopeId,
    token: require('crypto').randomBytes(16).toString('hex'),
    lease: lease ? _LOCK_LEASE : null,
    processStartedAtMs: _PROCESS_STARTED_AT_MS,
    createdAt: new Date().toISOString(),
    ...(keepOnCrash ? { keepOnCrash } : {})
  };
}
function _lockOwnerPath(lockPath, token) {
  return path.join(lockPath, `owner-${token}.json`);
}
// Where a new owner record is written before it is renamed into the lock folder: `<store>.tmp-<pid>-<n>`, a name
// lib/runtime-layout.js already admits for a store file (STORE_AUXILIARY). n starts with the time, so it cannot meet
// the temporary name lib/io.js writeUtf8 gives the same store in the same process (a small counter).
let _ownerTempSeq = 0;
function _ownerTempPath(targetPath) {
  return `${targetPath}.tmp-${process.pid}-${Date.now()}${++_ownerTempSeq}`;
}
function _readLockOwner(ownerPath) {
  let raw = null;
  try { raw = fs.readFileSync(ownerPath, 'utf8'); }
  catch (e) { return { raw: null, owner: null, error: (e && e.code) || 'unknown' }; }
  try {
    const value = JSON.parse(raw);
    if (!value || !Number.isSafeInteger(value.pid) || value.pid <= 0
      || typeof value.host !== 'string' || typeof value.token !== 'string' || value.token.length < 16) {
      return { raw, owner: null, error: null };
    }
    return { raw, owner: value, error: null };
  } catch { return { raw, owner: null, error: null }; }
}
function _sameLockDirectory(a, b) {
  if (!a || !b || !a.isDirectory() || !b.isDirectory()) return false;
   
   
  return !a.ino || !b.ino || (a.ino === b.ino && a.dev === b.dev);
}
function _reclaimLockDirectory(lockPath, staleMs) {
  let dirStat = null; let names = null;
  // Names first, then age: a folder replaced in between looks young, not stale.
  try { names = fs.readdirSync(lockPath); dirStat = fs.statSync(lockPath); } catch { return false; }
  if (!dirStat.isDirectory()) return false;
  if (names.length === 0) {
     
     
    if (!(Date.now() - dirStat.mtimeMs > staleMs)) return false;
    try { fs.rmdirSync(lockPath); return true; } catch { return false; }
  }
   
   
   
  return false;
}
function _reclaimStaleLock(lockPath, staleMs) {
  let stat = null;
  try { stat = fs.statSync(lockPath); } catch { return false; }
  if (stat.isDirectory()) return _reclaimLockDirectory(lockPath, staleMs);
   
  if (stat.isFile()) return false;
  return false;
}
function _namesOrEmpty(dir) {
  try { return fs.readdirSync(dir); }
  catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return []; throw e; }
}
function _present(file) {
  try { fs.lstatSync(file); return true; }
  catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false; throw e; }
}
function _tempName(table, name) {
  for (const [re, read] of table) { const m = re.exec(name); if (m) return read(m); }
  return null;
}
// Scratch folders of a compare-and-publish: the old file is moved to `before`, the new bytes sit in `next`.
// A file name can hold a line separator (U+2028, U+2029) or a line break, which `.` does not match, so the name part is [\s\S]+.
const _SCRATCH_NAMES = [
  [/^\.([\s\S]+)\.publish-cas-[A-Za-z0-9]+$/, m => m[1]],
  [/^\.agent-roles-cas-[A-Za-z0-9]+$/, () => 'agent-roles.json']];
// Temporary names that a first publish links to the live name and then removes.
const _PID_NAMES = [
  [/^\.([\s\S]+)\.publish-([1-9][0-9]*)-[a-f0-9]{24}$/, m => ({ live: m[1], pid: m[2] })],
  [/^\.agent-roles-create-([1-9][0-9]*)-[a-f0-9]{24}$/, m => ({ live: 'agent-roles.json', pid: m[1] })],
  [/^\.execution-ledger-create-([1-9][0-9]*)-[a-f0-9]{24}$/, m => ({ live: 'execution-ledger.jsonl', pid: m[1] })]];
// A publish moves the old file aside before it installs the new one, and one lock can cover several files,
// so this looks at the whole folder, not at the target alone.
function _displacedFile(targetPath, pid) {
  const dir = path.dirname(targetPath);
  for (const name of _namesOrEmpty(dir)) {
    const base = _tempName(_SCRATCH_NAMES, name);
    if (base && !_present(path.join(dir, base)) && _present(path.join(dir, name, 'before'))) {
      return { scratch: path.join(dir, name), name: base };
    }
  }
  // The Windows replace keeps both files in a scratch folder; next and before together mean the target may be missing.
  const prefix = `.leerness-write-${pid}-`;
  for (const parent of [mutationRecoveryFolder(targetPath), dir]) {
    if (!parent) continue;
    for (const name of _namesOrEmpty(parent)) {
      if (!name.startsWith(prefix)) continue;
      const scratch = path.join(parent, name);
      if (_present(path.join(scratch, 'next')) && _present(path.join(scratch, 'before'))) return { scratch, name: null };
    }
  }
  return null;
}
function _publishAlias(dir, name, pid) {
  const own = _tempName(_PID_NAMES, name);
  if (own) return Number(own.pid) === pid ? { alias: path.join(dir, name), live: path.join(dir, own.live) } : null;
  const live = _tempName(_SCRATCH_NAMES, name);
  if (!live) return null;
  // `next` counts only inside a real folder. Through a link it could name a file somewhere else.
  const scratch = path.join(dir, name);
  try { if (!fs.lstatSync(scratch).isDirectory()) return null; }
  catch { return null; }
  return { alias: path.join(scratch, 'next'), live: path.join(dir, live) };
}
function _sameFile(a, b) {
  try {
    const x = fs.lstatSync(a, { bigint: true }), y = fs.lstatSync(b, { bigint: true });
    return x.isFile() && y.isFile() && x.ino !== 0n && x.ino === y.ino && x.dev === y.dev;
  } catch { return false; }
}
// A publish links the new file into place and then removes its temporary name. A kill between the two leaves
// a complete file with two names, and every later read refuses a file with two links. This is the writer's own
// last step, so no bytes change; a name that is not linked to its live file is left alone.
function _finishDeadPublish(targetPath, pid) {
  const dir = path.dirname(targetPath);
  for (const name of _namesOrEmpty(dir)) {
    const link = _publishAlias(dir, name, pid);
    if (!link || !_sameFile(link.alias, link.live)) continue;
    try { fs.unlinkSync(link.alias); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
function _historyRecoveryPending(targetPath) {
  if (path.basename(targetPath) !== 'progress-tracker.md') return false;
  try { return require('./history-retention').inspectHistoryOperation(path.dirname(path.dirname(targetPath))).state === 'pending'; }
  catch { return true; }
}
function _classifyLock(lockPath, targetPath, opts = {}) {
  let st;
  try { st = fs.lstatSync(lockPath); }
  catch (e) { return { reason: e.code === 'ENOENT' ? 'gone' : 'unreadable' }; }
  let mt = { mtimeMs: st.mtimeMs };
  if (st.isSymbolicLink()) return { reason: 'link', ...mt };
  if (st.isFile()) return { reason: 'legacy-file', ...mt };
  if (!st.isDirectory()) return { reason: 'unexpected-entries', ...mt };
  try {
    const names = fs.readdirSync(lockPath);
    if (!names.length) return { reason: 'empty', ...mt };
    const named = names.length === 1 ? _LOCK_OWNER_FILE_RE.exec(names[0]) : null;
    if (!named) return { reason: 'unexpected-entries', ...mt };
    const ownerPath = path.join(lockPath, names[0]);
    const file = fs.lstatSync(ownerPath);
    mt = { mtimeMs: Math.max(st.mtimeMs, file.mtimeMs) };
    if (!file.isFile() || file.size > _LOCK_OWNER_MAX_BYTES) return { reason: 'malformed-owner', ...mt };
    const fresh = Date.now() - file.mtimeMs < _LOCK_OWNER_FRESH_MS;
    if (fresh && opts.reclaim) return { reason: 'fresh-owner', ...mt };
    const read = _readLockOwner(ownerPath);
    if (read.error) return { reason: read.error === 'ENOENT' ? 'gone' : 'unreadable', ...mt };
    const w = read.owner;
    if (!w || w.token !== named[1]) return { reason: 'malformed-owner', ...mt };
    if (w.v !== _LOCK_OWNER_VERSION || !_LOCK_HEX32_RE.test(w.hostId || '') || !_LOCK_HEX32_RE.test(w.pidScopeId || '')) {
      return { reason: 'legacy-owner', ...mt };
    }
    const hostId = _lockHostIdentity(opts.readOnly), pidScopeId = _lockPidScopeIdentity(opts.readOnly);
    if (!hostId || !pidScopeId) return { reason: 'unknown-identity', ...mt };
    if (w.hostId !== hostId || w.pidScopeId !== pidScopeId || w.host !== String(os.hostname() || '').toLowerCase()) {
      return { reason: 'other-host', ...mt };
    }
    try { process.kill(w.pid, 0); return { reason: 'live-owner', pid: w.pid, ...mt }; }
    catch (e) {
      if (e.code === 'EPERM') return { reason: 'live-owner', pid: w.pid, ...mt };
      if (e.code !== 'ESRCH') return { reason: 'unknown-identity', ...mt };
    }
    if (w.keepOnCrash !== undefined) {
      return { reason: 'kept-for-recovery', keep: w.keepOnCrash === 'memory-migration' ? 'memory-migration' : 'unknown', pid: w.pid, ...mt };
    }
    if (_historyRecoveryPending(targetPath)) return { reason: 'kept-for-recovery', keep: 'history', pid: w.pid, ...mt };
    const displaced = _displacedFile(targetPath, w.pid);
    if (displaced) return { reason: 'displaced-target', pid: w.pid, ...displaced, ...mt };
    return { reason: 'dead-owner', pid: w.pid, ownerPath, ...mt };
  } catch { return { reason: 'unreadable', ...mt }; }
}
function _safeText(value) {
  const { _lineSafe, stripDefaultIgnorables } = require('./pure-utils');
  return stripDefaultIgnorables(_lineSafe(value));
}
// Death is stable and tokens are random, so a gap between the check and the unlink is harmless: only the
// dead token's own file is removed, and rmdir succeeds only on an empty folder.
// Two waiters can both get through the unlink: on Windows the same file can be unlinked by more than one process at
// once (measured, Node 18 to 26). The second one's rmdir then meets whatever folder is at the path, possibly an empty
// one a new holder has just made. Nothing is held then, so that holder finds its folder gone and goes round again
// (see _withLockBody). If another process has already made a new folder there, the creation check fails that one write
// cleanly instead, and a retry succeeds. The notice is printed only by a waiter whose rmdir removed the folder: a reclaim that met
// a new owner's file prints nothing. The notice can still come from more than one waiter; it is not exactly-once.
function _reclaimDeadOwner(lockPath, targetPath) {
  const seen = _classifyLock(lockPath, targetPath, { reclaim: true });
  if (seen.reason !== 'dead-owner') return false;
  try { _finishDeadPublish(targetPath, seen.pid); } catch { return false; }
  try { fs.unlinkSync(seen.ownerPath); } catch { return false; }   // ENOENT: another waiter won
  let removed = false;
  for (let i = 0; i < 3; i++) {
    try { fs.rmdirSync(lockPath); removed = true; break; }
    catch (e) { if (e.code === 'ENOENT') break; _sleepSyncMs(5); }
  }
  if (removed && process.env.LEERNESS_NO_LOCK_WARN !== '1') {
    const file = _safeText(path.basename(targetPath));
    try {
      process.stderr.write(errorLanguage() === 'en'
        ? `⚠ Cleared a lock left by a stopped process (pid ${seen.pid}): ${file}. Its last change may be incomplete.\n`
        : `⚠ 멈춘 프로세스(pid ${seen.pid})가 남긴 잠금을 풀었습니다: ${file}. 마지막 변경이 끝나지 않았을 수 있습니다.\n`);
    } catch {}
  }
  return true;
}
function _withLock(targetPath, fn, opts = {}) {
  targetPath = path.resolve(targetPath);
  return withRuntimePathWrite(targetPath, () => {
    assertWriteAllowed(targetPath);
    return _lockScopes.run(new Map(_lockScopes.getStore() || []), () => _withLockBody(targetPath, fn, opts));
  });
}
function _withLockBody(targetPath, fn, opts = {}) {
  const lockPath = targetPath + '.lock';
   
   
  const scope = _lockScopes.getStore();
  const lockKey = _stateLockKey(targetPath);
  let bailCode = null, lastCode = null;
  if (_heldLocks.has(lockKey)) {
    if (isStateLockHeld(targetPath)) {
      const current = _readLockOwner(_lockOwnerPath(lockPath, _heldLocks.get(lockKey)));
      if (current.owner && current.owner.token === _heldLocks.get(lockKey)) return fn();
       
      throw Object.assign(new Error(errorLanguage() === 'ko' ? '중첩 작업을 시작하기 전에 상태 잠금 소유권을 잃었습니다'
        : 'state lock ownership was lost before nested work'), { code: 'E_LOCK_OWNERSHIP_LOST' });
    }
     
    throw Object.assign(new Error(errorLanguage() === 'ko' ? '같은 프로세스의 다른 비동기 작업이 상태 잠금을 잡고 있습니다'
      : 'state lock is held by another async operation in this process'), { code: 'E_LOCK_BUSY' });
  }
   
   
  const maxWaitMs = opts.maxWaitMs == null ? 35000 : Math.max(0, Number(opts.maxWaitMs) || 0);
  const staleMs = opts.staleMs == null ? 30000 : Math.max(0, Number(opts.staleMs) || 0);
   
   
   
  try { mkdirpRaw(path.dirname(lockPath)); } catch {}    
  const start = Date.now();
  const ownerCheckMs = Math.min(staleMs, _LOCK_OWNER_CHECK_MS);
  let nextOwnerCheck = start + ownerCheckMs;
  let owner = null; let ownerPath = null; let held = false;
  while (Date.now() - start <= maxWaitMs) {
    try {
      let fd = null; let madeDir = false; let madeOwner = false; let createdDirStat = null; let temp = null;
      try {
        fs.mkdirSync(lockPath); madeDir = true;
        createdDirStat = fs.statSync(lockPath);
        owner = _newLockOwner(_ensureLockHeartbeat(), opts.keepOnCrash);
        ownerPath = _lockOwnerPath(lockPath, owner.token);
        // The record is written complete under a name outside the lock folder and then renamed in, so a kill leaves
        // either an empty folder (it clears by itself) or a complete owner, never a zero-byte or partial one.
        temp = _ownerTempPath(targetPath);
        fd = fs.openSync(temp, 'wx');
        fs.writeFileSync(fd, JSON.stringify(owner) + '\n', 'utf8');
        fs.closeSync(fd); fd = null;
        fs.renameSync(temp, ownerPath); temp = null; madeOwner = true;
         
         
         
        const currentDirStat = fs.statSync(lockPath);
        const names = fs.readdirSync(lockPath);
        const confirmed = _readLockOwner(ownerPath);
        if (!_sameLockDirectory(createdDirStat, currentDirStat)
          || names.length !== 1 || names[0] !== path.basename(ownerPath)
          || !confirmed || confirmed.error || !confirmed.owner || confirmed.owner.token !== owner.token) {
          const verifyErr = new Error('lock ownership was not durable after creation');
          verifyErr.code = 'E_LOCK_OWNERSHIP'; throw verifyErr;
        }
      } catch (e) {
        if (fd !== null) { try { fs.closeSync(fd); } catch {} }
        if (temp !== null) { try { fs.unlinkSync(temp); } catch {} }
        if (madeOwner && ownerPath) { try { fs.unlinkSync(ownerPath); } catch {} }
        // The folder this attempt made is gone: a waiter's rmdir took it (see _reclaimDeadOwner). The folder now at that
        // path is not ours, so it is not removed here, and nothing is held, so go round again.
        if (madeDir && e.code === 'ENOENT') { lastCode = e.code; continue; }
        if (madeDir) { try { fs.rmdirSync(lockPath); } catch {} }
        throw e;
      }
      held = true; break;
    }
    catch (e) {
       
       
       
       
       
       
      lastCode = e.code || null;    
      if (!_LOCK_RETRY_CODES.has(e.code)) { bailCode = e.code || 'unknown'; break; }
      if (Date.now() >= nextOwnerCheck) {
        nextOwnerCheck = Date.now() + ownerCheckMs;
        if (_reclaimDeadOwner(lockPath, targetPath)) continue;
      }
      if (_reclaimStaleLock(lockPath, staleMs)) continue;
      _sleepSyncMs(15 + Math.floor((Date.now() - start) / 50));   
    }
  }
  if (held) {
    _heldLocks.set(lockKey, owner.token);
    scope.set(lockKey, owner.token);
    if (owner.lease === _LOCK_LEASE) _lockHeartbeat('add', ownerPath, owner.token);
  }
  else {
    const _why = bailCode || (lastCode && lastCode !== 'EEXIST' ? `${lastCode} 지속(${maxWaitMs}ms)` : 'timeout');
    const waitedMs = Date.now() - start;
     
     
    const _en = errorLanguage() === 'en';
    const _whyText = _en && !bailCode && lastCode && lastCode !== 'EEXIST' ? `${lastCode} persisted (${maxWaitMs}ms)` : _why;
    if (opts.failOpen === true) {
      _lockFailOpen.push({ file: path.basename(targetPath), reason: _why, waitedMs });
      if (process.env.LEERNESS_NO_LOCK_WARN !== '1') {
        try {
          process.stderr.write(_en ? `⚠ Lock acquisition failed — continuing without protection for a non-critical record only: ${path.basename(targetPath)} (${_whyText}).\n`
            : `⚠ 락 획득 실패 — 비핵심 기록만 보호 없이 진행합니다: ${path.basename(targetPath)} (${_why}).\n`);
        } catch {   }
      }
    } else {
      const seen = _classifyLock(lockPath, targetPath, { readOnly: true });
      const _file = _safeText(path.basename(targetPath)), _where = _safeText(lockPath);
      const cause = bailCode || (lastCode && lastCode !== 'EEXIST' ? lastCode : null);
      const err = new Error(_en
        ? `Lock acquisition failed — stopped to protect the data from concurrent writes: ${_file} (${_whyText})\n  Lock path: ${_where}\n  What to do: ${_lockAction(seen, _file, 'en', cause)}`
        : `락 획득 실패 — 동시 쓰기로부터 데이터를 보호하기 위해 중단합니다: ${_file} (${_why})\n  잠금 경로: ${_where}\n  조치: ${_lockAction(seen, _file, 'ko', cause)}`);
      err.code = bailCode === 'E_LOCK_HOST_ID' ? 'E_LOCK_HOST_ID' : 'E_LOCK_TIMEOUT';
      err.lockPath = lockPath; err.waitedMs = waitedMs; err.lockState = seen.reason;
      throw err;
    }
  }
   
   
   
   
   
  let releaseSettled = false;
  let releaseResult = null;
  const release = () => {
     
     
    if (releaseSettled) return releaseResult;
    if (!held) return null;
    _lockHeartbeat('remove', ownerPath, owner.token);
    _heldLocks.delete(lockKey);
    scope.delete(lockKey);
     
     
     
     
    const releasePath = `${lockPath}.release-${owner.token}`;
    const releaseOwnerPath = _lockOwnerPath(releasePath, owner.token);
    let quarantined = false;
    let ownerRemoved = false;
    const releaseSuccess = () => {
      releaseSettled = true; releaseResult = null; held = false; return null;
    };
    const releaseFailure = (reason, code) => {
      _lockFailOpen.push({ file: path.basename(targetPath), reason, waitedMs: 0 });
      const err = new Error(errorLanguage() === 'en' ? `Lock ownership could not be confirmed, so the result is not reported as a success: ${path.basename(lockPath)} (${reason})`
        : `락 소유권을 확인하지 못해 작업 결과를 성공으로 확정하지 않습니다: ${path.basename(lockPath)} (${reason})`);
      err.code = code || 'E_LOCK_RELEASE'; err.lockPath = lockPath;
      if (quarantined) err.releasePath = releasePath;
      if (process.env.LEERNESS_NO_LOCK_WARN !== '1') {
        try { process.stderr.write(`⚠ ${err.message}\n`); } catch {}
      }
      releaseSettled = true; releaseResult = err;
      return releaseResult;
    };
    for (let i = 0; i < 6; i++) {
      try {
        if (!quarantined) {
          const current = _readLockOwner(ownerPath);
          if (!current || current.error) {
            if (current && current.error === 'ENOENT') {
              return releaseFailure('ownership-lost', 'E_LOCK_OWNERSHIP_LOST');
            }
            const readErr = new Error(`lock owner read failed: ${(current && current.error) || 'unknown'}`);
            readErr.code = (current && current.error) || 'unknown';
            throw readErr;
          }
          if (!current.owner || current.owner.token !== owner.token) {
            return releaseFailure('ownership-lost', 'E_LOCK_OWNERSHIP_LOST');
          }
          fs.renameSync(lockPath, releasePath);
          quarantined = true;
        }
        if (!ownerRemoved) {
           
           
          const moved = _readLockOwner(releaseOwnerPath);
          if (!moved || moved.error) {
            if (moved && moved.error === 'ENOENT') {
              return releaseFailure('ownership-lost-after-rename', 'E_LOCK_OWNERSHIP_LOST');
            }
            const readErr = new Error(`moved lock owner read failed: ${(moved && moved.error) || 'unknown'}`);
            readErr.code = (moved && moved.error) || 'unknown';
            throw readErr;
          }
          if (!moved.owner || moved.owner.token !== owner.token) {
            return releaseFailure('ownership-lost-after-rename', 'E_LOCK_OWNERSHIP_LOST');
          }
          fs.unlinkSync(releaseOwnerPath); ownerRemoved = true;
        }
        fs.rmdirSync(releasePath); return releaseSuccess();
      }
      catch (e) {
        if (e.code === 'ENOENT') {
          return quarantined && ownerRemoved ? releaseSuccess() : releaseFailure('ownership-lost', 'E_LOCK_OWNERSHIP_LOST');
        }
        if (e.code === 'ENOTEMPTY' || e.code === 'EEXIST') {
          if (!quarantined || !ownerRemoved) {
            _sleepSyncMs(10 + i * 10);
            continue;
          }
           
           
           
          let remaining = null;
          try { remaining = fs.readdirSync(releasePath); }
          catch (readErr) {
            if (readErr && readErr.code === 'ENOENT') return releaseSuccess();
            _sleepSyncMs(10 + i * 10);
            continue;
          }
          const ownName = path.basename(releaseOwnerPath);
          if (remaining.some(name => name !== ownName)) {
            return releaseFailure('release-tombstone-contaminated', 'E_LOCK_RELEASE');
          }
          _sleepSyncMs(10 + i * 10);
          continue;
        }
        _sleepSyncMs(10 + i * 10);
      }
    }
    return releaseFailure('release-failed', 'E_LOCK_RELEASE');
  };
  const releaseAndRethrow = e => {
    const releaseErr = release();
    if (releaseErr && e && typeof e === 'object') e.lockReleaseError = releaseErr.code;
    throw e;
  };
  let out;
  try { assertCurrentRuntimeWrite(targetPath); out = fn(); }
  catch (e) { return releaseAndRethrow(e); }
  let then = null;
  try { then = out && out.then; }
  catch (e) { return releaseAndRethrow(e); }
  if (typeof then === 'function') {
     
     
    let settlement = null;
    const onFulfilled = v => {
      if (settlement) return settlement.kind === 'fulfilled' ? settlement.value : undefined;
      settlement = { kind: 'fulfilled', value: v, error: null };
      const releaseErr = release();
      if (releaseErr) {
        settlement.kind = 'release-failed'; settlement.error = releaseErr; throw releaseErr;
      }
      return v;
    };
    const onRejected = e => {
      if (settlement) return undefined;
      settlement = { kind: 'rejected', value: undefined, error: e };
      return releaseAndRethrow(e);
    };
    let thenResult;
    try {
      thenResult = then.call(out, onFulfilled, onRejected);
    } catch (e) {
      if (!settlement) {
         
         
        settlement = { kind: 'rejected', value: undefined, error: e };
        return releaseAndRethrow(e);
      }
      if (settlement.kind === 'fulfilled') return settlement.value;
      throw settlement.error;
    }
    if (settlement && settlement.kind !== 'fulfilled') throw settlement.error;
    return thenResult;
  }
  const releaseErr = release();
  if (releaseErr) throw releaseErr;
  return out;
}
// A lock dated more than 5 s ahead of this clock: the 5 s rule and the 30 s age of an empty folder never run out for it.
function _lockFuture(seen) {
  return Number.isFinite(seen.mtimeMs) && seen.mtimeMs - Date.now() > _LOCK_OWNER_FRESH_MS;
}
function _lockAction(seen, file, lang, cause) {
  const t = (en, ko) => (lang === 'en' ? en : ko);
  // These three reasons promise that the lock clears by itself, which a future time makes untrue.
  if (_lockFuture(seen) && (seen.reason === 'dead-owner' || seen.reason === 'empty' || seen.reason === 'live-owner')) {
    return t('Its recorded time is more than 5 s in the future, so it will not clear by itself (check the clock). If no leerness command is running on this project, including on other computers, delete that lock.',
      '기록된 시각이 5초 넘게 미래라서 저절로 풀리지 않습니다 (시계를 확인하세요). 다른 컴퓨터를 포함해 이 프로젝트에서 실행 중인 leerness 명령이 없다면 그 잠금을 지우세요.');
  }
  switch (seen.reason) {
    case 'live-owner': {
      const wait = t(`Process ${seen.pid} on this computer holds it. Wait for it to finish, or stop it if it is stuck, then retry; the lock then clears by itself.`,
        `이 컴퓨터의 프로세스 ${seen.pid} 가 잡고 있습니다. 끝날 때까지 기다리거나 멈췄다면 종료한 뒤 다시 실행하세요. 그러면 잠금이 저절로 풀립니다.`);
      if (Date.now() - seen.mtimeMs < _LOCK_UNKNOWN_OWNER_STALE_MS) return wait;
      return wait + t(' Its heartbeat has stopped, so the number may have been reused. Only if you have confirmed that no leerness command is running on this project, delete that lock.',
        ' 잠금 갱신이 멈춰 있어 번호가 재사용됐을 수 있습니다. 이 프로젝트에서 실행 중인 leerness 명령이 없음을 확인한 경우에만 그 잠금을 지우세요.');
    }
    case 'dead-owner':
      return t('Its owner has stopped. Retry; the next write clears it. If this repeats, delete that lock.',
        '소유자 프로세스가 이미 끝났습니다. 다시 실행하면 다음 쓰기에서 풀립니다. 계속 반복되면 그 잠금을 지우세요.');
    case 'empty':
      return t('It has no owner record. Retry in 30 seconds; an empty lock clears by itself.',
        '소유자 기록이 없습니다. 30초 뒤 다시 실행하면 빈 잠금은 저절로 풀립니다.');
    case 'kept-for-recovery':
      if (seen.keep === 'history') {
        return t('A history operation stopped partway and its process has ended. Retain the entire lock, owner record, archive and recovery files. Stop all writers and independently confirm the recorded owner has ended. Run leerness context history status and follow docs/history-retention.md for explicit non-destructive recovery; if ownership or artifacts are uncertain, stop.',
          '기록 보관 작업이 중간에 멈췄고 그 프로세스는 이미 끝났습니다. 잠금 디렉터리 전체와 소유자 기록, 보관본, 복구 파일을 보존하세요. 모든 쓰기를 중단하고 기록된 소유자의 종료를 별도로 확인하세요. leerness context history status 와 docs/history-retention.md 의 명시적 비파괴 복구 절차를 따르며, 소유권이나 자료가 불확실하면 중단하세요.');
      }
      if (seen.keep === 'memory-migration') {
        return t('A memory migration stopped partway and its process has ended. Retain the entire lock, owner record, archive and recovery files. Stop all writers and independently confirm the recorded owner has ended. Run leerness memory-migration inspect and follow docs/memory-migration-write.md for explicit non-destructive recovery; if ownership or artifacts are uncertain, stop.',
          '메모리 이전이 중간에 멈췄고 그 프로세스는 이미 끝났습니다. 잠금 디렉터리 전체와 소유자 기록, 보관본, 복구 파일을 보존하세요. 모든 쓰기를 중단하고 기록된 소유자의 종료를 별도로 확인하세요. leerness memory-migration inspect 와 docs/memory-migration-write.md 의 명시적 비파괴 복구 절차를 따르며, 소유권이나 자료가 불확실하면 중단하세요.');
      }
      break;
    case 'displaced-target': {
      const before = _safeText(path.join(seen.scratch, 'before'));
      if (seen.name) {
        const name = _safeText(seen.name);
        return t(`A save stopped after moving ${name} aside. Move ${before} back to ${name}, then delete that lock.`,
          `저장이 중간에 멈춰 ${name} 이 옆으로 옮겨진 상태입니다. ${before} 를 ${name} 으로 되돌린 뒤 그 잠금을 지우세요.`);
      }
      return t(`A save stopped after moving a file aside. Its original is ${before}, and it belongs to the file now missing beside ${file}. Move it back under that name, then delete that lock.`,
        `저장이 중간에 멈춰 파일이 옆으로 옮겨진 상태입니다. 원본은 ${before} 이고, ${file} 옆에서 사라진 파일의 것입니다. 그 이름으로 되돌린 뒤 그 잠금을 지우세요.`);
    }
    case 'link':
      return t('That path is a link, which leerness never creates. Remove the link itself, not what it points to.',
        '그 경로는 링크입니다. leerness 는 링크를 만들지 않습니다. 가리키는 대상이 아니라 링크 자체만 지우세요.');
    case 'gone':
      return !cause || cause === 'ENOENT' || cause === 'E_LOCK_OWNERSHIP' ? t('The lock is gone now. Retry.', '지금은 잠금이 없습니다. 다시 실행하세요.')
        : t('Fix the cause shown above, then retry.', '위에 나온 원인을 해결한 뒤 다시 실행하세요.');
  }
  const hostLike = seen.reason === 'other-host' || seen.reason === 'unknown-identity';
  return t(`Its owner cannot be checked from here (${seen.reason}). Check that no leerness command is running on this project, including on other computers, then delete that lock.${hostLike ? ' A restart or a renamed computer also looks like this.' : ''}`,
    `여기서는 소유자를 확인할 수 없습니다 (${seen.reason}). 다른 컴퓨터를 포함해 이 프로젝트에서 실행 중인 leerness 명령이 없는지 확인한 뒤 그 잠금을 지우세요.${hostLike ? ' 재시작했거나 컴퓨터 이름이 바뀌어도 이렇게 보입니다.' : ''}`);
}
function _lockBucket(seen, ageMs, failOpen) {
  if (seen.reason === 'gone') return null;
  // An empty folder is a live creation window until it is 5 s old, and only then something the next write clears.
  const clears = seen.reason === 'dead-owner' || (seen.reason === 'empty' && ageMs >= _LOCK_OWNER_FRESH_MS);
  // A store whose writers pass failOpen goes on after a short wait, so its lock never stops a write: it is shown as in use or clearing, never as stuck.
  if (failOpen) return clears ? 'clearing' : 'active';
  // The 5 s rule and the age of an empty folder never run out for a time that lies ahead of this clock.
  if (_lockFuture(seen)) return 'stuck';
  if (clears) return 'clearing';
  switch (seen.reason) {
    case 'empty': return 'active';
    case 'kept-for-recovery': case 'displaced-target': case 'link': return 'stuck';
    case 'malformed-owner': case 'unexpected-entries': return ageMs < _LOCK_OWNER_FRESH_MS ? 'active' : 'stuck';
    default: return ageMs < _LOCK_UNKNOWN_OWNER_STALE_MS ? 'active' : 'stuck';
  }
}
// Stores whose writers pass the failOpen option, as paths below the workspace folder. Today that is the usage counter
// written by bin/leerness.js _bumpUsage. A probe checks that no other caller passes the option.
const _FAIL_OPEN_STORES = ['cache/usage-stats.json'];
// Read-only: it never reclaims, never creates the host seed and never changes a lock. Age is diagnostic only.
// opts.maxEntries lowers the entry limit of each of the two budgets (the workspace folder, then everything else).
function inspectStateLocks(root, opts = {}) {
  root = path.resolve(root);
  const lang = opts.lang === 'en' ? 'en' : 'ko';
  const workspace = path.join(root, opts.workspaceDir || '.leerness');
  const skip = opts.skipDir || (() => false);
  const limit = Number.isSafeInteger(opts.maxEntries) && opts.maxEntries > 0 ? opts.maxEntries : _LOCK_MAX_SCAN_ENTRIES;
  const out = { active: [], clearing: [], stuck: [], leftovers: [], truncated: false };
  // The file system folds case on Windows and macOS, so `X.LOCK` is the same lock there.
  const caseless = process.platform === 'win32' || process.platform === 'darwin';
  const fold = s => (caseless ? s.toLowerCase() : s);
  const failOpen = new Set(_FAIL_OPEN_STORES.map(r => fold(path.join(workspace, ...r.split('/')) + '.lock')));
  const rel = p => _safeText(path.relative(root, p).split(path.sep).join('/'));
  const nested = dir => { try { fs.lstatSync(path.join(dir, '.git')); return true; } catch { return false; } };
  const ageOf = ms => (Number.isFinite(ms) ? Math.max(0, Date.now() - ms) : 0);
  const addLock = p => {
    const seen = _classifyLock(p, p.slice(0, -'.lock'.length), { readOnly: true });
    const ageMs = ageOf(seen.mtimeMs);
    const bucket = _lockBucket(seen, ageMs, failOpen.has(fold(p)));
    if (!bucket) return;
    const row = { path: rel(p), reason: seen.reason, pid: Number.isSafeInteger(seen.pid) ? seen.pid : null, ageMs: Math.round(ageMs) };
    if (bucket === 'stuck') row.action = _lockAction(seen, _safeText(path.basename(p).slice(0, -'.lock'.length)), lang, null);
    out[bucket].push(row);
  };
  // A release leftover counts only as a real folder (a link never does) that is empty or holds only its own token's owner
  // file, so "safe to delete" is never said of a folder that holds anything else.
  const leftover = (p, d, name) => {
    try {
      if (!d.isDirectory() || d.isSymbolicLink()) return null;
      const st = fs.lstatSync(p);
      if (!st.isDirectory() || st.isSymbolicLink()) return null;
      const names = fs.readdirSync(p), token = _LOCK_TOMBSTONE_RE.exec(name)[1];
      if (names.length > 1 || (names.length === 1 && names[0] !== `owner-${token}.json`)) return null;
      if (names.length === 1 && !fs.lstatSync(path.join(p, names[0])).isFile()) return null;
      return st.mtimeMs;
    } catch { return null; }
  };
  // Returns true when the entry is a lock artifact that must not be walked into.
  const look = (dir, d, inWorkspace) => {
    const p = path.join(dir, d.name), name = fold(d.name);
    if (_LOCK_TOMBSTONE_RE.test(name)) {
      const mtimeMs = leftover(p, d, name);
      if (mtimeMs !== null) out.leftovers.push({ path: rel(p), reason: 'release-leftover', pid: null, ageMs: Math.round(ageOf(mtimeMs)) });
      return true;
    }
    // leerness never makes a lock named just `.lock`: a store name comes before the suffix.
    if (name === '.lock' || !name.endsWith('.lock')) return false;
    if (d.isDirectory() && !d.isSymbolicLink()) {
      // Outside the workspace a folder is ours only if it holds an owner record under the exact name leerness writes.
      let names = []; try { names = fs.readdirSync(p); } catch {}
      if (inWorkspace || names.some(n => _LOCK_OWNER_FILE_RE.test(n))) addLock(p);
      return true;
    }
    // A lock file or link is what leerness left before 1.36.160. It counts only inside the workspace, at any size, and
    // only when the store it guards exists beside it. Outside the workspace the same names belong to other tools
    // (Gemfile.lock, Pipfile.lock, Podfile.lock, a tool's .venv/.lock) and never count.
    if (inWorkspace && (d.isFile() || d.isSymbolicLink()) && fs.existsSync(p.slice(0, -'.lock'.length))) addLock(p);
    return false;
  };
  const walk = (dir, depth, maxDepth, inWorkspace, budget) => {
    if (budget.stop || depth > maxDepth) return;
    let list; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const d of list) {
      if (++budget.n > limit) { budget.stop = true; out.truncated = true; return; }
      if (look(dir, d, inWorkspace) || !d.isDirectory() || d.isSymbolicLink() || d.name === '.git' || skip(d.name)) continue;
      if (inWorkspace && depth === 1 && d.name === 'archive') continue;
      const child = path.join(dir, d.name);
      if (!nested(child)) walk(child, depth + 1, maxDepth, inWorkspace, budget);
      if (budget.stop) return;
    }
  };
  // The workspace is walked first and has an entry budget of its own, so a large project folder cannot hide its locks.
  walk(workspace, 1, 8, true, { n: 0, stop: false });
  const rest = { n: 0, stop: false };
  let top = []; try { top = fs.readdirSync(root, { withFileTypes: true }); } catch {}
  for (const d of top) {
    if (++rest.n > limit) { rest.stop = true; out.truncated = true; break; }
    look(root, d, false);
  }
  for (const d of top) {
    if (rest.stop) break;
    const p = path.join(root, d.name);
    if (!d.isDirectory() || d.isSymbolicLink() || !d.name.startsWith('.') || d.name === '.git' || p === workspace || skip(d.name) || fold(d.name).endsWith('.lock')) continue;
    if (!nested(p)) walk(p, 1, 3, false, rest);
  }
  return out;
}

function _stateLockKey(targetPath) {
  const key = path.resolve(targetPath) + '.lock';
  return process.platform === 'win32' ? key.toLowerCase() : key;
}
function isStateLockHeld(targetPath) {
  const key = _stateLockKey(targetPath), token = _heldLocks.get(key);
  return !!token && !!_lockScopes.getStore() && _lockScopes.getStore().get(key) === token;
}
module.exports = { withStateLock: _withLock, isStateLockHeld, inspectStateLocks,
  stateLockDiagnostics: () => _lockFailOpen.map(entry => ({ ...entry })) };
