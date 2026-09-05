'use strict';

// 호환 릴리스의 관측 기반 쓰기 경계. 원자 fencing/activation 프로토콜이 아니다.
// topology만 한 작업 동안 재사용하고 descriptor/indicator는 매 쓰기마다 다시 읽는다.
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { AsyncLocalStorage } = require('async_hooks');
const operations = new AsyncLocalStorage();
const descriptors = new Map();
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
  installRuntimeWriteInterception, projectWriter, pathWriter, runtimeWriteRoots, runtimeMigrationWait };
