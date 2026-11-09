'use strict';

 
 
const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');
const { readMemoryInputBytes } = require('./memory-input-bytes');
const { nestingDepth } = require('./memory-json-size');
const { resolveMemoryParent, sameResolvedParent } = require('./memory-parent');
const { errorLanguage } = require('./error-language');
const { assertPublicationAbsent } = require('./publication-absence');
const inputs = new WeakMap();
const files = new WeakMap();
const identity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
const sameStat = (a, b) => identity(a, b) && a.size === b.size && a.nlink === b.nlink
  && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
 
 
const pathMatchesHandle = (p, h) => sameStat(p, h) || (process.platform === 'win32'
  && p.dev === 0n && h.dev !== 0n && sameStat({ ...p, dev: h.dev }, h));
const regular = s => s.isFile() && !s.isSymbolicLink() && s.nlink === 1n;
const readFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
 
 
 
const error = (code, file, reason, reasonKo) => {
  const language = errorLanguage();
  return Object.assign(new Error(language === 'ko' ? `${reasonKo}: ${file} — 원본을 보존하고 상태를 확인한 뒤 재시도하세요`
    : `Memory input ${reason}: ${file} — ${language === 'en' ? 'preserve the original, check its state and retry' : '원본을 보존하고 상태를 확인한 뒤 재시도하세요'}`), { code, file });
};
const changed = file => error('E_STORE_CHANGED', file, 'changed during operation', '작업하는 동안 파일이 바뀌었습니다');

function confirmAbsent(file) {
  assertPublicationAbsent(file, target => error('E_STORE_CHANGED', target,
    'may be in an active or interrupted save; publication state is not proof of absence',
    '저장 중이거나 저장이 중단된 흔적이 있어 파일이 없는 것으로 처리할 수 없습니다'));
}

// A publish links the new file in place and then removes its temporary name `.<name>.publish-<pid>-<24 hex>`. A kill between
// the two leaves a complete file with two names, which the single-link rule below refuses. When a name of that shape in
// the same folder is the same file (same device and inode), it is the interrupted save's own leftover: deleting it is safe
// and the bytes stay under the other name. This only reads; it never removes anything.
function interruptedPublishName(file, stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink <= 1n || stat.ino === 0n) return null;
  const dir = path.dirname(file), prefix = `.${path.basename(file)}.publish-`;
  let names;
  try { names = fs.readdirSync(dir); } catch { return null; }
  for (const name of names.sort()) {
    if (!name.startsWith(prefix) || !/^[1-9][0-9]*-[a-f0-9]{24}$/.test(name.slice(prefix.length))) continue;
    try {
      const other = fs.lstatSync(path.join(dir, name), { bigint: true });
      if (other.isFile() && !other.isSymbolicLink() && other.ino === stat.ino && other.dev === stat.dev) return path.join(dir, name);
    } catch {}
  }
  return null;
}
function notSingleLink(file, stat) {
  const second = interruptedPublishName(file, stat);
  if (!second) return error('E_STORE_INVALID', file, 'is not a single-link regular file', '읽으려는 파일이 하드 링크가 하나뿐인 일반 파일이 아닙니다');
  const { _lineSafe, stripDefaultIgnorables } = require('./pure-utils');
  const shown = stripDefaultIgnorables(_lineSafe(second));
  return Object.assign(new Error(errorLanguage() === 'ko'
    ? `읽으려는 파일이 하드 링크가 하나뿐인 일반 파일이 아닙니다: ${file} — 이 파일을 저장하다 중단되어 두 번째 이름이 남았습니다. 그 이름 ${shown} 을 지워도 안전하고 파일 내용은 그대로 남습니다. 지운 뒤 다시 실행하세요`
    : `Memory input is not a single-link regular file: ${file} — an interrupted save of this file left a second name for it. Deleting that name is safe and the file's bytes stay: ${shown}. Delete it, then retry`),
  { code: 'E_STORE_INVALID', file, secondName: second });
}

function observe(file, maxBytes = null, prefix = false) {
  let fd = null, confirmationFd = null, failure = null;
  try {
    const parentPath = path.dirname(file);
    const parent = fs.lstatSync(parentPath, { bigint: true });
    if (parent.isSymbolicLink() || !parent.isDirectory()) throw error('E_STORE_INVALID', file, 'parent is not a regular directory', '읽으려는 파일의 상위 폴더가 일반 폴더가 아닙니다');
    const resolvedParent = resolveMemoryParent(parentPath);
    const parentStable = () => {
      const now = fs.lstatSync(parentPath, { bigint: true });
      return now.isDirectory() && !now.isSymbolicLink() && identity(parent, now)
        && sameResolvedParent(resolvedParent, resolveMemoryParent(parentPath));
    };
    let before;
    try { before = fs.lstatSync(file, { bigint: true }); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      if (!parentStable()) throw changed(file);
      confirmAbsent(file);
      if (!parentStable()) throw changed(file);
      return { file, parent, resolvedParent, stat: null, bytes: null, maxBytes, prefix };
    }
    if (!regular(before)) throw notSingleLink(file, before);
    if (!prefix && maxBytes !== null && before.size > BigInt(maxBytes)) {
      throw Object.assign(error('E_STORE_LIMIT', file, 'exceeds diagnostic byte limit', '읽으려는 파일이 바이트 한도를 넘습니다'), { bytesRead: 0 });
    }
    try {
      fd = fs.openSync(file, readFlags);
    } catch (e) { if (e.code === 'ENOENT' || e.code === 'ELOOP') throw changed(file); throw e; }
    const opened = fs.fstatSync(fd, { bigint: true });
    if (process.platform === 'win32' && (opened.dev === 0n || opened.ino === 0n)) {
      throw error('E_STORE_INVALID', file, 'descriptor identity is unavailable', '읽으려는 파일의 식별 정보를 얻을 수 없습니다');
    }
    if (!regular(opened) || !pathMatchesHandle(before, opened)) throw changed(file);
    let bytes;
    if (prefix) {
      const buffer = Buffer.alloc(Math.min(maxBytes, Number(opened.size)));
      let got = 0;
      while (got < buffer.length) {
        const n = fs.readSync(fd, buffer, got, buffer.length - got, got);
        if (!n) break;
        got += n;
      }
      bytes = buffer.subarray(0, got);
    } else bytes = readMemoryInputBytes(fd, maxBytes, file, opened.size);
    const after = fs.fstatSync(fd, { bigint: true });
    let afterPath;
    try { afterPath = fs.lstatSync(file, { bigint: true }); }
    catch (e) { if (e.code === 'ENOENT') throw changed(file); throw e; }
    if (!parentStable() || !regular(afterPath) || !sameStat(opened, after)
      || !sameStat(before, afterPath) || !pathMatchesHandle(afterPath, after)
      || (prefix ? BigInt(bytes.length) !== (after.size < BigInt(maxBytes) ? after.size : BigInt(maxBytes))
        : after.size !== BigInt(bytes.length))) throw changed(file);
    if (process.platform === 'win32' && (before.dev === 0n || afterPath.dev === 0n)) {
       
       
      try { confirmationFd = fs.openSync(file, readFlags); }
      catch (e) { if (e.code === 'ENOENT' || e.code === 'ELOOP') throw changed(file); throw e; }
      const confirmed = fs.fstatSync(confirmationFd, { bigint: true });
      if (!regular(confirmed) || !sameStat(after, confirmed) || !parentStable()) throw changed(file);
    }
    return { file, parent, resolvedParent, stat: after, bytes, maxBytes, prefix };
  } catch (e) {
    failure = e;
    if (e && /^E_STORE_/.test(e.code)) throw e;
    throw error('E_STORE_UNREADABLE', file, 'could not be read', '파일을 읽지 못했습니다');
  } finally {
    let closeFailed = false;
    for (const openedFd of [confirmationFd, fd]) {
      if (openedFd !== null) {
        try { fs.closeSync(openedFd); } catch { closeFailed = true; }
      }
    }
    if (closeFailed && !failure) throw error('E_STORE_UNREADABLE', file, 'could not be closed', '파일을 닫지 못했습니다');
  }
}

function decode(observation) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(observation.bytes); }
  catch { throw error('E_STORE_CORRUPT', observation.file, 'has malformed UTF-8', '파일에 UTF-8 로 읽을 수 없는 바이트가 있습니다'); }
}

function captureMemoryInput(canonicalFile, legacyFile, parseLegacy, options = {}) {
  const maxBytes = options.maxBytes === undefined ? null : options.maxBytes;
  const maxDepth = options.maxDepth === undefined ? null : options.maxDepth;
  if ((maxBytes !== null && (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 4 * 1024 * 1024))
    || (maxDepth !== null && (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 64))) {
    throw error('E_STORE_INVALID', canonicalFile, 'explicit input limits are invalid', '지정한 입력 한도가 올바르지 않습니다');
  }
  const canonical = observe(path.resolve(canonicalFile),maxBytes);
  let entries, legacy = null;
  if (canonical.stat !== null) {
    const text = decode(canonical);
    if (maxDepth !== null && nestingDepth(text,maxDepth) === null) {
      throw Object.assign(error('E_STORE_LIMIT',canonical.file,'exceeds declared JSON depth', 'JSON 의 깊이가 지정한 한도를 넘습니다'), { limitKind: 'depth' });
    }
    try { entries = JSON.parse(text); }
    catch { throw error('E_STORE_CORRUPT', canonical.file, 'has invalid JSON', '파일의 JSON 이 올바르지 않습니다'); }
    if (!Array.isArray(entries)) throw error('E_STORE_INVALID', canonical.file, 'JSON root is not an array', 'JSON 의 최상위가 배열이 아닙니다');
  } else {
    legacy = observe(path.resolve(legacyFile),maxBytes);
    entries = legacy.stat === null ? [] : parseLegacy(decode(legacy));
    if (!Array.isArray(entries)) throw error('E_STORE_INVALID', legacy.file, 'legacy parser did not return an array', '이전 형식을 읽은 결과가 배열이 아닙니다');
  }
   
   
  const input = Object.freeze({ entries, source: canonical.stat !== null ? 'canonical' : legacy.stat !== null ? 'legacy' : 'empty' });
  inputs.set(input, { canonical, legacy, legacyFile: path.resolve(legacyFile) });
  return input;
}

function checkedFileSnapshot(observation) {
  const input = Object.freeze({ exists: observation.stat !== null,
    bytes: observation.bytes === null ? null : Buffer.from(observation.bytes) });
  files.set(input, observation);
  return input;
}

function captureCheckedFileInput(file, options = {}) {
  const maxBytes = options.maxBytes === undefined ? null : options.maxBytes;
  if (maxBytes !== null && (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 4 * 1024 * 1024)) {
    throw error('E_STORE_INVALID', file, 'diagnostic byte limit is invalid', '지정한 바이트 한도가 올바르지 않습니다');
  }
  return checkedFileSnapshot(observe(path.resolve(file), maxBytes));
}

function captureCheckedFilePrefix(file, maxBytes = 64 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 64 * 1024) {
    throw error('E_STORE_INVALID', file, 'prefix byte limit is invalid', '지정한 제한 읽기 한도가 올바르지 않습니다');
  }
  return checkedFileSnapshot(observe(path.resolve(file), maxBytes, true));
}

 
 
function getLegacyMemoryInput(input, file) {
  const record = inputs.get(input);
  if (!record || !record.legacy || record.legacy.stat === null || record.legacy.file !== path.resolve(file)) {
    throw error('E_STORE_INVALID', file, 'legacy snapshot does not belong to this file', '이전 형식 스냅숏이 이 파일의 것이 아닙니다');
  }
  return checkedFileSnapshot(record.legacy);
}

function assertCheckedFileCurrent(input, file) {
  const previous = files.get(input);
  if (!previous || previous.file !== path.resolve(file)) {
    throw error('E_STORE_INVALID', file, 'snapshot does not belong to this file', '스냅숏이 이 파일의 것이 아닙니다');
  }
  const current = observe(previous.file, previous.maxBytes, previous.prefix);
  if (!identity(previous.parent, current.parent) || !sameResolvedParent(previous.resolvedParent, current.resolvedParent)
    || (previous.stat === null) !== (current.stat === null)) throw changed(previous.file);
  if (previous.stat !== null && (!sameStat(previous.stat, current.stat) || !previous.bytes.equals(current.bytes))) throw changed(previous.file);
  return { readBytes: current.bytes?.length || 0, readFiles: current.stat === null ? 0 : 1 };
}

function assertMemoryInputCurrent(input, canonicalFile, legacyFile) {
  const record = inputs.get(input);
  if (!record || record.canonical.file !== path.resolve(canonicalFile) || record.legacyFile !== path.resolve(legacyFile)) {
    throw error('E_STORE_INVALID', canonicalFile, 'snapshot does not belong to this store', '스냅숏이 이 저장소의 것이 아닙니다');
  }
  for (const previous of [record.canonical, record.legacy]) {
    if (!previous) continue;
    const current = observe(previous.file,previous.maxBytes);
    if (!identity(previous.parent, current.parent) || !sameResolvedParent(previous.resolvedParent, current.resolvedParent)
      || (previous.stat === null) !== (current.stat === null)) throw changed(previous.file);
    if (previous.stat !== null && (!sameStat(previous.stat, current.stat) || !previous.bytes.equals(current.bytes))) throw changed(previous.file);
  }
   
   
}

function describeCheckedFileInput(input, file) {
  const record = files.get(input);
  if (!record || record.file !== path.resolve(file)) throw error('E_STORE_INVALID', file, 'snapshot does not belong to file', '스냅숏이 이 파일의 것이 아닙니다');
  const describe = (stat, keys) => stat === null ? null
    : Object.freeze(Object.fromEntries(keys.map(key => [key, String(stat[key])])));
  return Object.freeze({ parent: describe(record.parent, ['dev', 'ino', 'mode']),
    resolvedParent: record.resolvedParent,
    stat: describe(record.stat, ['dev', 'ino', 'mode', 'size', 'nlink', 'mtimeNs', 'ctimeNs']) });
}

module.exports = { captureMemoryInput, assertMemoryInputCurrent, captureCheckedFileInput, captureCheckedFilePrefix, assertCheckedFileCurrent,
  getLegacyMemoryInput, describeCheckedFileInput };
