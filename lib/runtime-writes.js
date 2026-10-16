'use strict';

// 호환 릴리스의 관측 기반 쓰기 경계. 원자 fencing/activation 프로토콜이 아니다.
// topology만 한 작업 동안 재사용하고 descriptor/indicator는 매 쓰기마다 다시 읽는다.
const fs = require('fs');
const { removeSync } = require('./safe-remove');
const path = require('path');
const os = require('os');
const { fileURLToPath } = require('url');
const { AsyncLocalStorage } = require('async_hooks');
const operations = new AsyncLocalStorage();
const descriptors = new Map();
// Recovery-only primitives captured before this module installs fs interception.
// They are not exported individually; only the bounded external-bundle helper
// below can use them.
const recoveryFs = {
  mkdtempSync: fs.mkdtempSync.bind(fs),
  openSync: fs.openSync.bind(fs),
  writeSync: fs.writeSync.bind(fs),
  fsyncSync: typeof fs.fsyncSync === 'function' ? fs.fsyncSync.bind(fs) : null,
  closeSync: fs.closeSync.bind(fs),
  chmodSync: typeof fs.chmodSync === 'function' ? fs.chmodSync.bind(fs) : null,
  rmSync: typeof fs.rmSync === 'function' ? fs.rmSync.bind(fs) : null,
  // T-0365: what lib/safe-remove.js removeSync checks and removes a target with on a Windows Node whose fs.rmSync can end
  //   the process (a full folder then goes to fs.rmSync in a child process).
  lstatSync: fs.lstatSync.bind(fs),
  unlinkSync: fs.unlinkSync.bind(fs),
  rmdirSync: fs.rmdirSync.bind(fs),
};
let installed = false;

function key(root) {
  const value = path.resolve(root);
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function metadataRoot(value) {
  if (typeof value === 'number' || value == null) return null;
  const input = value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString() : value;
  if (typeof input !== 'string') return null;
  const absolute = path.resolve(input);
  const parsed = path.parse(absolute);
  const parts = absolute.slice(parsed.root.length).split(path.sep);
  const W = require('./workspace-dir');
  const index = parts.findIndex(part => [W.CANONICAL_WORKSPACE_DIR, W.LEGACY_WORKSPACE_DIR].includes(part.toLowerCase()));
  return index < 0 ? null : path.join(parsed.root, ...parts.slice(0, index));
}

function canonicalRoot(operation, root) {
  if (operation.failure) throw operation.failure;
  try { return require('./runtime-layout').canonicalRuntimeRoot(root); }
  catch (error) { return reject(operation, { reasonCode: error.reasonCode || 'layout_unreadable' }); }
}

function addReader(operation, root, lockWaitMs) {
  // Re-resolve each target: caching the spelling of a junction would retain
  // stale authority after retargeting. Bind both the key and reader to this
  // same canonical path, including Node 18's internal \\?\ rollback paths.
  const canonical = canonicalRoot(operation, root);
  const id = key(canonical);
  if (!operation.readers.has(id)) {
    const { createRuntimeWriterAdmission } = require('./runtime-layout');
    const admission = createRuntimeWriterAdmission(canonical, lockWaitMs);
    operation.readers.set(id, admission.reader);
    operation.migrationWaits.set(id, { waitedForLock: admission.waitedForLock, lockWaitedMs: admission.lockWaitedMs });
  }
}

function reject(operation, report) {
  const error = Object.assign(new Error(`Runtime layout blocks writes (${report.reasonCode}). Run state compatibility to diagnose; no activation is supported.`), {
    code: 'E_RUNTIME_LAYOUT_INCOMPATIBLE', reasonCode: report.reasonCode,
  });
  operation.failure = error;
  throw error;
}

function check(operation, targets = []) {
  if (!operation) return;
  if (operation.failure) throw operation.failure;
  for (const target of targets) {
    const root = metadataRoot(target);
    if (root) addReader(operation, root);
  }
  for (const reader of operation.readers.values()) {
    const report = reader();
    if (report.writeDisposition !== 'allowed') reject(operation, report);
  }
}

function assertCurrentRuntimeWrite(target) {
  const operation = operations.getStore();
  if (operation) check(operation, target == null ? [] : [target]);
}
function runtimeWriteRoots() { const operation = operations.getStore(); return operation ? [...operation.readers.keys()] : []; }
// The lock heartbeat worker touches the owner file of a lock this operation holds. It re-checks this
// operation's admission snapshots (descriptor re-read per write) instead of making new admissions,
// each of which would run `git rev-parse` in the project. Snapshots are plain data for postMessage.
function runtimeWriteAdmissions() {
  const operation = operations.getStore();
  return operation ? [...operation.readers].map(([id, reader]) => ({ id, snapshot: reader.snapshot || null })) : [];
}
function withRuntimeWriteAdmissions(admissions, fn) {
  const { createRuntimeSnapshotReader } = require('./runtime-layout');
  const operation = { readers: new Map(), migrationWaits: new Map(), failure: null };
  for (const admission of admissions) {
    // An admission that was not transferred blocks: the heartbeat stops instead of admitting afresh.
    operation.readers.set(admission && admission.id, createRuntimeSnapshotReader(admission && admission.snapshot));
  }
  check(operation);
  installRuntimeWriteInterception();
  return operations.run(operation, () => {
    const result = fn();
    if (operation.failure) throw operation.failure;
    return result;
  });
}
function runtimeMigrationWait(root) {
  const operation = operations.getStore();
  return (operation && operation.migrationWaits.get(key(canonicalRoot(operation, root))))
    || { waitedForLock: false, lockWaitedMs: 0 };
}

// best-effort catch가 거부를 성공으로 바꾸지 않게 래치한다. async도 같은 scope다.
function withRuntimeWrites(root, fn, options = {}) {
  const parent = operations.getStore();
  if (parent && !options.fresh) {
    addReader(parent, root, options.migrationLockWaitMs);
    check(parent);
    return fn();
  }
  const operation = { readers: new Map(), migrationWaits: new Map(), failure: null };
  addReader(operation, root, options.migrationLockWaitMs);
  check(operation);
  installRuntimeWriteInterception();
  return operations.run(operation, () => {
    const finish = value => { if (operation.failure) throw operation.failure; return value; };
    const failed = error => { throw operation.failure || error; };
    try {
      const result = fn();
      return result && typeof result.then === 'function' ? result.then(finish, failed) : finish(result);
    } catch (error) { return failed(error); }
  });
}

function withRuntimePathWrite(target, fn) {
  const operation = operations.getStore();
  if (operation) { check(operation, [target]); return fn(); }
  const root = metadataRoot(target);
  return root ? withRuntimeWrites(root, fn) : fn();
}

// Recovery after a latched layout failure cannot safely write through the
// changed project pathname, and normal fs interception intentionally refuses
// every further mutation. This is the one bounded escape hatch: write a finite
// bundle to a random user-temp directory outside the project. It never writes
// back into the project and never clears/overrides the latched operation error.
function assertExternalRecoveryAllowed(root) {
  const operation = operations.getStore();
  const failure = operation && operation.failure;
  const failureCode = failure && (failure.originalOutputCode || failure.code);
  if (!failure || failureCode !== 'E_RUNTIME_LAYOUT_INCOMPATIBLE') {
    const error = new Error('External recovery bypass requires a latched runtime-layout failure');
    error.code = 'E_RECOVERY_BYPASS_NOT_LATCHED';
    throw error;
  }
  const project = path.resolve(root);
  const base = path.resolve(os.tmpdir());
  // T-0349: compared as spelled and as real paths. A temp folder reached through a link, or named by an 8.3 short
  //   name (GitHub's Windows runners give C:\Users\RUNNER~1\...), can lie inside the project while its spelling does
  //   not, and the recovery bundle was then written into the project it must stay out of. A temp folder that cannot
  //   be resolved counts as unsafe. A project path that no longer exists (ENOENT or ENOTDIR: renamed or removed during
  //   the operation, one way this latch is reached) has nothing at it to lie inside, so only its spelling is compared;
  //   any other failure to resolve it counts as unsafe.
  const unsafe = () => {
    const error = new Error(`External recovery temp must stay outside project root: ${base}`);
    error.code = 'E_RECOVERY_TEMP_UNSAFE';
    throw error;
  };
  // Outside means a first component of exactly '..' (a child folder may be named '..temp', review round 1).
  const inside = (from, to) => {
    const relative = path.relative(from, to);
    return !(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative));
  };
  const real = p => { try { return { path: fs.realpathSync.native(p) }; } catch (error) { return { error }; } };
  const realBase = real(base), realProject = real(project);
  if (!realBase.path) unsafe();
  const missing = !realProject.path && ['ENOENT', 'ENOTDIR'].includes(realProject.error && realProject.error.code);
  if (!realProject.path && !missing) unsafe();
  if (inside(project, base)) unsafe();
  if (realProject.path && inside(realProject.path, realBase.path)) unsafe();
  // The bundle goes below the real path that was checked, not below the alias: a temp link retargeted into the project
  // after this check would otherwise carry the bundle there (review round 2). A real folder replaced while the
  // recovery runs is not covered, as for every path-based write here.
  return realBase.path;
}

// Streaming recovery uses the same latch and external-only destination. The
// producer receives a finite named-file sink, never raw privileged descriptors.
// Partial evidence is deliberately retained if this attempt fails.
function writeExternalRecoveryStream(root, build, maxChunkBytes) {
  const base = assertExternalRecoveryAllowed(root);
  if (typeof build !== 'function' || !Number.isSafeInteger(maxChunkBytes) || maxChunkBytes < 1 || maxChunkBytes > 65536) {
    throw Object.assign(new Error('Invalid external recovery stream'),{code:'E_RECOVERY_BUNDLE_INVALID'});
  }
  const { createRecoverySink } = require('./memory-recovery-sink');
  const dir = recoveryFs.mkdtempSync(path.join(base,'leerness-memory-recovery-'));
  const sink = createRecoverySink(recoveryFs,dir,{maxChunkBytes,maxFiles:128,maxBytes:128*1024*1024});
  try {
    try { if(recoveryFs.chmodSync)recoveryFs.chmodSync(dir,0o700); } catch {}
    const result=build(sink,dir);
    if(result&&typeof result.then==='function')throw Object.assign(new Error('Recovery producer must be synchronous'),{code:'E_RECOVERY_BUNDLE_INVALID'});
    return dir;
  } catch(error) {
    error.recoveryBundleDirectory=dir;
    error.recoveryBundleProgress=sink.snapshot();
    throw error;
  } finally {sink.close();}
}

function writeExternalRecoveryBundle(root, files) {
  const base = assertExternalRecoveryAllowed(root);
  if (!Array.isArray(files) || files.length < 1 || files.length > 128) {
    const error = new Error('External recovery bundle has an invalid file count');
    error.code = 'E_RECOVERY_BUNDLE_INVALID';
    throw error;
  }
  let total = 0;
  const normalized = files.map(item => {
    const name = item && String(item.name || '');
    if (!name || name !== path.basename(name) || /[\\/]/.test(name)) {
      const error = new Error(`Invalid external recovery artifact name: ${name}`);
      error.code = 'E_RECOVERY_BUNDLE_INVALID';
      throw error;
    }
    const bytes = Buffer.isBuffer(item.bytes) ? Buffer.from(item.bytes) : Buffer.from(item.bytes || '');
    total += bytes.length;
    if (total > 128 * 1024 * 1024) {
      const error = new Error('External recovery bundle exceeds 128 MiB');
      error.code = 'E_RECOVERY_BUNDLE_TOO_LARGE';
      throw error;
    }
    return { name, bytes };
  });
  const dir = recoveryFs.mkdtempSync(path.join(base, 'leerness-memory-recovery-'));
  try {
    try { if (recoveryFs.chmodSync) recoveryFs.chmodSync(dir, 0o700); } catch {}
    for (const item of normalized) {
      const file = path.join(dir, item.name);
      let fd = null;
      try {
        fd = recoveryFs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
        let offset = 0;
        while (offset < item.bytes.length) {
          const written = recoveryFs.writeSync(fd, item.bytes, offset, item.bytes.length - offset, null);
          if (!(written > 0)) {
            const error = new Error(`External recovery write made no progress: ${item.name}`);
            error.code = 'E_RECOVERY_WRITE_STALLED';
            throw error;
          }
          offset += written;
        }
        if (recoveryFs.fsyncSync) recoveryFs.fsyncSync(fd);
      } finally {
        if (fd !== null) try { recoveryFs.closeSync(fd); } catch {}
      }
    }
    return dir;
  } catch (error) {
    try { if (recoveryFs.rmSync) removeSync(dir, { recursive: true, force: true }, { fsImpl: recoveryFs }); } catch {}
    throw error;
  }
}

// Machine caches live outside every project workspace. Writing one inside a project operation would
// re-run that project's layout admission — and latch a refusal — for a file the admission does not
// govern, turning a best-effort cache into a command failure. Anything under a workspace directory is
// refused here, so this cannot become a way around project admission.
function outsideRuntimeWrites(target, fn) {
  if (metadataRoot(target)) {
    throw Object.assign(new Error(`Machine write target is inside a project workspace: ${target}`), { code: 'E_MACHINE_WRITE_IN_WORKSPACE' });
  }
  return operations.exit(fn);
}

function projectWriter(fn) {
  return function (...args) { return withRuntimeWrites(args[0], () => fn.apply(this, args)); };
}

function pathWriter(fn) {
  return function (...args) { return withRuntimePathWrite(args[0], () => fn.apply(this, args)); };
}

function writingFlags(flags) {
  if (typeof flags === 'number') return !!(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND));
  return typeof flags === 'string' && /[wa+]/.test(flags);
}

// 제품은 동기 path/FD writer를 사용한다. import만으로 host fs를 바꾸지 않고
// 첫 명시적 writer에서 설치하며, operation 밖의 외부 편집은 이 경계의 대상이 아니다.
function installRuntimeWriteInterception() {
  if (installed) return;
  installed = true;
  const both = new Set(['renameSync', 'copyFileSync', 'cpSync', 'linkSync', 'symlinkSync']);
  const mutations = ['writeFileSync', 'appendFileSync', 'unlinkSync', 'rmSync', 'rmdirSync',
    'renameSync', 'copyFileSync', 'cpSync', 'mkdirSync', 'mkdtempSync', 'mkdtempDisposableSync', 'chmodSync', 'utimesSync',
    'symlinkSync', 'linkSync', 'truncateSync', 'writeSync', 'writevSync', 'ftruncateSync', 'fchmodSync', 'futimesSync'];
  for (const name of mutations) {
    const original = fs[name];
    if (typeof original !== 'function') continue;
    fs[name] = function (...args) {
      const operation = operations.getStore();
      check(operation, both.has(name) ? args.slice(0, 2) : [args[0]]);
      if (typeof args[0] === 'number') {
        const opened = descriptors.get(args[0]);
        if (opened && opened !== operation) {
          try { check(opened); }
          catch (error) { if (operation) operation.failure = error; throw error; }
        }
      }
      return original.apply(this, args);
    };
  }
  const open = fs.openSync;
  fs.openSync = function (file, flags, ...args) {
    const operation = operations.getStore();
    if (writingFlags(flags)) check(operation, [file]);
    const fd = open.call(this, file, flags, ...args);
    if (operation && writingFlags(flags)) descriptors.set(fd, operation);
    return fd;
  };
  const close = fs.closeSync;
  fs.closeSync = function (fd) {
    const result = close.call(this, fd);
    descriptors.delete(fd);
    return result;
  };
}

module.exports = { withRuntimeWrites, withRuntimePathWrite, assertCurrentRuntimeWrite,
  installRuntimeWriteInterception, writeExternalRecoveryBundle, writeExternalRecoveryStream, assertExternalRecoveryAllowed,
  projectWriter, pathWriter, runtimeWriteRoots, runtimeWriteAdmissions, withRuntimeWriteAdmissions,
  runtimeMigrationWait, outsideRuntimeWrites };
