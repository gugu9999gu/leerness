'use strict';

 
 
const fs = require('fs');
const { removeSync } = require('./safe-remove');
const path = require('path');
const os = require('os');
const { fileURLToPath } = require('url');
const { AsyncLocalStorage } = require('async_hooks');
const operations = new AsyncLocalStorage();
const descriptors = new Map();
 
 
 
const recoveryFs = {
  mkdtempSync: fs.mkdtempSync.bind(fs),
  openSync: fs.openSync.bind(fs),
  writeSync: fs.writeSync.bind(fs),
  fsyncSync: typeof fs.fsyncSync === 'function' ? fs.fsyncSync.bind(fs) : null,
  closeSync: fs.closeSync.bind(fs),
  chmodSync: typeof fs.chmodSync === 'function' ? fs.chmodSync.bind(fs) : null,
  rmSync: typeof fs.rmSync === 'function' ? fs.rmSync.bind(fs) : null,
   
   
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
 
 
 
function runtimeWriteAdmissions() {
  const operation = operations.getStore();
  return operation ? [...operation.readers].map(([id, reader]) => ({ id, snapshot: reader.snapshot || null })) : [];
}
function withRuntimeWriteAdmissions(admissions, fn) {
  const { createRuntimeSnapshotReader } = require('./runtime-layout');
  const operation = { readers: new Map(), migrationWaits: new Map(), failure: null };
  for (const admission of admissions) {
     
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
   
   
   
   
   
   
  const unsafe = () => {
    const error = new Error(`External recovery temp must stay outside project root: ${base}`);
    error.code = 'E_RECOVERY_TEMP_UNSAFE';
    throw error;
  };
   
  const inside = (from, to) => {
    const relative = path.relative(from, to);
    return !(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative));
  };
  const real = p => { try { return { path: fs.realpathSync.native(process.platform === 'win32' && p.length >= 260
    ? path.toNamespacedPath(p) : p) }; } catch (error) { return { error }; } };
  const realBase = real(base), realProject = real(project);
  if (!realBase.path) unsafe();
  const missing = !realProject.path && ['ENOENT', 'ENOTDIR'].includes(realProject.error && realProject.error.code);
  if (!realProject.path && !missing) unsafe();
  if (inside(project, base)) unsafe();
  if (realProject.path && inside(realProject.path, realBase.path)) unsafe();



  return realBase.path;
}
// T-0356: the checked real temp folder itself can be replaced by a link into the project between the
// check and mkdtemp. Confirm the new folder is a direct child of that real folder and outside the project
// before writing into it; otherwise remove only the empty folder just created and refuse. A swap after this
// point remains possible because Node has no directory-relative file calls.
function confirmExternalRecoveryDir(root, base, dir) {
  let real = null, project = path.resolve(root);
  try { real = fs.realpathSync.native(process.platform === 'win32' && dir.length >= 260
    ? path.toNamespacedPath(dir) : dir); } catch {}
  try { project = fs.realpathSync.native(process.platform === 'win32' && project.length >= 260
    ? path.toNamespacedPath(project) : project); }
  catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error && error.code)) project = null; }
  const child = real ? path.relative(base, real) : '';
  const fromProject = real && project ? path.relative(project, real) : '';
  const direct = !!child && child !== '..' && !child.startsWith('..' + path.sep) && !path.isAbsolute(child) && !child.includes(path.sep);
  const outside = fromProject === '..' || fromProject.startsWith('..' + path.sep) || path.isAbsolute(fromProject);
  if (direct && outside) return;
  try { recoveryFs.rmdirSync(dir); } catch {}
  const error = new Error(`External recovery temp must stay outside project root: ${base}`);
  error.code = 'E_RECOVERY_TEMP_UNSAFE';
  throw error;
}

 
 
 
function writeExternalRecoveryStream(root, build, maxChunkBytes) {
  const base = assertExternalRecoveryAllowed(root);
  if (typeof build !== 'function' || !Number.isSafeInteger(maxChunkBytes) || maxChunkBytes < 1 || maxChunkBytes > 65536) {
    throw Object.assign(new Error('Invalid external recovery stream'),{code:'E_RECOVERY_BUNDLE_INVALID'});
  }
  const { createRecoverySink } = require('./memory-recovery-sink');
  const prefix = path.join(base,'leerness-memory-recovery-');
  const dir = recoveryFs.mkdtempSync(process.platform === 'win32' && prefix.length + 6 >= 248
    ? path.toNamespacedPath(prefix) : prefix);
  confirmExternalRecoveryDir(root, base, dir);
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
  const prefix = path.join(base, 'leerness-memory-recovery-');
  const dir = recoveryFs.mkdtempSync(process.platform === 'win32' && prefix.length + 6 >= 248
    ? path.toNamespacedPath(prefix) : prefix);
  confirmExternalRecoveryDir(root, base, dir);
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
