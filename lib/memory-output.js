'use strict';

// T-0193: checked publication for memory-domain files. This is a pathname
// conflict boundary, not a multi-file transaction. Windows existing-file
// replacement delegates to the reviewed ReplaceFileW helper. POSIX existing
// files use rename-away + exclusive hard-link install so a competing pathname
// writer is never overwritten, but readers can observe a short missing-path
// window because Node does not expose rename-exchange/CAS primitives. Successful
// cleanup also cannot retain writes that arrive later through an already-open
// descriptor to the displaced inode; this boundary protects pathname races.
const fs = require('fs');
const { removeSync } = require('./safe-remove');
const { readPublicationBytes } = require('./memory-publication-read');
const path = require('path');
const crypto = require('crypto');
const { resolveMemoryParent, sameResolvedParent } = require('./memory-parent');
const { readMemoryInputBytes } = require('./memory-input-bytes');
const { errorLanguage } = require('./error-language');

const snapshots = new WeakMap();
const readFlags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
// Keep native cleanup handles separate from pathname cleanup. If an ancestor is
// renamed after a prepared file is created, its old pathname is no longer
// addressable through the original string. A still-open fd can at least scrub
// uncommitted planned bytes before that handle is closed.
const rawFtruncateSync = fs.ftruncateSync.bind(fs);
const rawFsyncSync = typeof fs.fsyncSync === 'function' ? fs.fsyncSync.bind(fs) : null;

function sameIdentity(a, b) {
  return !!a && !!b && String(a.dev) === String(b.dev) && String(a.ino) === String(b.ino);
}
function sameStat(a, b) {
  return sameIdentity(a, b)
    && Number(a.size) === Number(b.size)
    && Number(a.nlink) === Number(b.nlink)
    && Number(a.mode) === Number(b.mode)
    && Number(a.mtimeMs) === Number(b.mtimeMs)
    && Number(a.ctimeMs) === Number(b.ctimeMs);
}
function pathMatchesHandle(p, h) {
  return sameStat(p, h) || (process.platform === 'win32'
    && Number(p.dev) === 0 && Number(h.dev) !== 0
    && sameStat({ ...p, dev: h.dev }, h));
}
function regular(stat) {
  return stat && stat.isFile() && !stat.isSymbolicLink() && Number(stat.nlink) === 1;
}
// T-0337: the message follows the language the CLI registers (lib/error-language.js). Every project used to get the
// English reason with Korean advice: an English project now gets English advice and a Korean project a Korean
// reason, each keeping the part it had. With no language registered the text is as before. Codes never change.
function changed(file, reason = 'changed before publication', reasonKo = '저장하기 전에 파일이 바뀌었습니다') {
  const language = errorLanguage();
  const error = new Error(language === 'ko' ? `${reasonKo}: ${file} — 외부 변경을 보존하고 다시 시도하세요`
    : `Memory output ${reason}: ${file} — ${language === 'en' ? 'preserve the external change and retry' : '외부 변경을 보존하고 다시 시도하세요'}`);
  error.code = 'E_OUTPUT_CHANGED';
  error.file = file;
  return error;
}
function unavailable(file, reason, reasonKo) {
  const error = new Error(errorLanguage() === 'ko' ? `파일을 비교한 뒤 저장하는 방식을 쓸 수 없습니다: ${file} — ${reasonKo}`
    : `Memory output compare-and-publish unavailable: ${file} — ${reason}`);
  error.code = 'E_OUTPUT_CAS_UNAVAILABLE';
  error.file = file;
  return error;
}
function parentIdentity(stat) {
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode };
}
function fileIdentity(stat) {
  return { dev: stat.dev, ino: stat.ino, nlink: Number(stat.nlink), mode: Number(stat.mode) };
}
function sameParent(a, b) {
  return sameIdentity(a, b) && Number(a.mode) === Number(b.mode);
}
function resolvedParent(parentPath, target) {
  try {
    return resolveMemoryParent(parentPath);
  } catch {
    throw changed(target, 'parent resolution is unreadable', '대상 파일의 상위 폴더 경로를 확인할 수 없습니다');
  }
}
function sameOutputParent(previous, current) {
  return sameParent(previous.parent, current.parent)
    && sameResolvedParent(previous.resolvedParent, current.resolvedParent);
}

function observe(file, maxBytes = null) {
  const target = path.resolve(file);
  const parentPath = path.dirname(target);
  let parent;
  try { parent = fs.lstatSync(parentPath); }
  catch { throw changed(target, 'parent is unreadable', '대상 파일의 상위 폴더를 읽을 수 없습니다'); }
  if (parent.isSymbolicLink() || !parent.isDirectory()) throw changed(target, 'parent is not a stable directory', '대상 파일의 상위 폴더가 안정된 일반 폴더가 아닙니다');
  const parentResolved = resolvedParent(parentPath, target);

  let before;
  try { before = fs.lstatSync(target); }
  catch (error) {
    if (!error || error.code !== 'ENOENT') throw changed(target, 'target is unreadable', '대상 파일을 읽을 수 없습니다');
    const parentNow = fs.lstatSync(parentPath);
    const parentResolvedNow = resolvedParent(parentPath, target);
    if (!parentNow.isDirectory() || parentNow.isSymbolicLink() || !sameParent(parent, parentNow)
      || !sameResolvedParent(parentResolved, parentResolvedNow)) {
      throw changed(target, 'parent changed while observing absence', '파일이 없음을 확인하는 동안 상위 폴더가 바뀌었습니다');
    }
    return {
      file: target, parentPath, parent: parentIdentity(parent), resolvedParent: parentResolvedNow,
      stat: null, pathStat: null, bytes: null, maxBytes,
    };
  }
  if (!regular(before)) throw changed(target, 'target is not a single-link regular file', '대상 파일이 하드 링크가 하나뿐인 일반 파일이 아닙니다');
  if (maxBytes !== null && before.size > maxBytes) {
    throw Object.assign(changed(target,'exceeds declared byte limit', '대상 파일이 지정한 바이트 한도를 넘습니다'), { code: 'E_OUTPUT_LIMIT', bytesRead: 0 });
  }

  let fd = null;
  let confirmationFd = null;
  try {
    try { fd = fs.openSync(target, readFlags); }
    catch (error) {
      if (error && ['ENOENT', 'ELOOP'].includes(error.code)) throw changed(target);
      throw error;
    }
    const opened = fs.fstatSync(fd);
    if (process.platform === 'win32' && (Number(opened.dev) === 0 || Number(opened.ino) === 0)) throw changed(target);
    if (!regular(opened) || !pathMatchesHandle(before, opened)) throw changed(target);
    let bytes;
    try { bytes = readMemoryInputBytes(fd,maxBytes,target,BigInt(opened.size)); }
    catch (error) { if (error.code === 'E_STORE_LIMIT') error.code = 'E_OUTPUT_LIMIT'; throw error; }
    const afterHandle = fs.fstatSync(fd);
    let afterPath;
    try { afterPath = fs.lstatSync(target); }
    catch (error) {
      if (error && error.code === 'ENOENT') throw changed(target);
      throw error;
    }
    const parentNow = fs.lstatSync(parentPath);
    const parentResolvedNow = resolvedParent(parentPath, target);
    const pathVsHandle = pathMatchesHandle(afterPath, afterHandle);
    if (!regular(afterPath) || !sameStat(opened, afterHandle) || !sameStat(before, afterPath)
      || !pathVsHandle || Number(afterHandle.size) !== bytes.length
      || !parentNow.isDirectory() || parentNow.isSymbolicLink() || !sameParent(parent, parentNow)
      || !sameResolvedParent(parentResolved, parentResolvedNow)) {
      throw changed(target);
    }
    // Node 22/24 Windows builds can expose dev=0 on path stats while handle
    // stats contain the volume id. Confirm the current pathname through a
    // second descriptor so the snapshot is not admitted from an unknown device.
    if (process.platform === 'win32' && (Number(before.dev) === 0 || Number(afterPath.dev) === 0)) {
      confirmationFd = fs.openSync(target, readFlags);
      const confirmed = fs.fstatSync(confirmationFd);
      if (!regular(confirmed) || !sameStat(afterHandle, confirmed)) throw changed(target);
    }
    return {
      file: target,
      parentPath,
      parent: parentIdentity(parentNow),
      resolvedParent: parentResolvedNow,
      stat: afterHandle,
      pathStat: afterPath,
      bytes: Buffer.from(bytes), maxBytes,
    };
  } catch (error) {
    if (error && /^E_OUTPUT_/.test(error.code || '')) throw error;
    throw changed(target, 'target could not be observed safely', '대상 파일을 안전하게 확인하지 못했습니다');
  } finally {
    for (const fdValue of [confirmationFd, fd]) {
      if (fdValue !== null) {
        try { fs.closeSync(fdValue); } catch {}
      }
    }
  }
}

function captureMemoryOutput(file, options = {}) {
  const maxBytes = options.maxBytes === undefined ? null : options.maxBytes;
  if (maxBytes !== null && (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 4 * 1024 * 1024)) {
    throw unavailable(file,'explicit byte limit is invalid', '지정한 바이트 한도가 올바르지 않습니다');
  }
  const observation = observe(file,maxBytes);
  const token = Object.freeze({
    exists: observation.stat !== null,
    bytes: observation.bytes === null ? null : Buffer.from(observation.bytes),
  });
  snapshots.set(token, observation);
  return token;
}

function recordFor(token, file) {
  const observation = snapshots.get(token);
  const target = path.resolve(file);
  if (!observation || observation.file !== target) throw changed(target, 'snapshot does not belong to target', '스냅숏이 이 대상 파일의 것이 아닙니다');
  return observation;
}

function assertMemoryOutputCurrent(token, file) {
  const previous = recordFor(token, file);
  const current = observe(previous.file,previous.maxBytes);
  if (!sameOutputParent(previous, current)
    || (previous.stat === null) !== (current.stat === null)) throw changed(previous.file);
  if (previous.stat !== null && (!sameStat(previous.pathStat, current.pathStat) || !previous.bytes.equals(current.bytes))) {
    throw changed(previous.file);
  }
  return current;
}

function cleanupFile(file) {
  if (!file) return null;
  try { if (fs.existsSync(file)) fs.unlinkSync(file); return null; }
  catch (error) { return error; }
}
function cleanupDir(dir) {
  if (!dir) return null;
  try { if (fs.existsSync(dir)) removeSync(dir, { recursive: true }); return null; }
  catch (error) { return error; }
}
function markOutputError(error, details = {}) {
  if (!error || typeof error !== 'object') error = new Error(String(error));
  const originalCode = error.code || null;
  if (!/^E_OUTPUT_/.test(originalCode || '')) {
    error.originalOutputCode = originalCode;
    error.code = 'E_OUTPUT_CHANGED';
  }
  Object.assign(error, details);
  return error;
}
function scrubPreparedHandle(fd, error) {
  if (fd === null) return;
  try {
    rawFtruncateSync(fd, 0);
    if (rawFsyncSync) rawFsyncSync(fd);
    error.preparedBytesScrubbed = true;
  } catch (scrubError) {
    error.preparedBytesScrubbed = false;
    error.preparedScrubError = scrubError && (scrubError.code || scrubError.message);
  }
}
function closePreparedHandle(fd, error = null) {
  if (fd === null) return;
  try { fs.closeSync(fd); }
  catch (closeError) {
    if (error) error.preparedCloseError = closeError && (closeError.code || closeError.message);
  }
}

function publishAbsent(previous, value) {
  const { assertWriteAllowed, detachCommittedHardLink } = require('./io');
  const file = previous.file;
  const parent = previous.parentPath;
  const next = path.join(parent, `.${path.basename(file)}.publish-${process.pid}-${crypto.randomBytes(12).toString('hex')}`);
  let linked = false;
  let nextFd = null;
  try {
    assertWriteAllowed(file);
    assertWriteAllowed(next);
    if (process.platform === 'win32') {
      // Keeping the prepared source descriptor open prevents linkSync on some
      // Windows filesystems. Preserve the existing Windows create contract;
      // descriptor-based orphan-byte scrubbing is POSIX-only.
      fs.writeFileSync(next, value, { flag: 'wx', mode: 0o666 });
    } else {
      nextFd = fs.openSync(next, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o666);
      fs.writeFileSync(nextFd, value);
    }
    assertMemoryOutputCurrentToken(previous, file);
    try {
      fs.linkSync(next, file);
      linked = true;
    } catch (error) {
      if (error && error.code === 'EEXIST') throw changed(file, 'another writer created the target', '다른 작업이 대상 파일을 먼저 만들었습니다');
      if (error && ['EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) {
        throw unavailable(file, `exclusive hard-link install failed (${error.code})`, `하드 링크로 새 파일을 단독 설치하지 못했습니다 (${error.code})`);
      }
      throw error;
    }
    const detached = detachCommittedHardLink(next, file, value, { maxReadBytes: previous.maxBytes });
    const current = observe(file,previous.maxBytes);
    if (!sameOutputParent(previous, current) || current.stat === null || !current.bytes.equals(value)) {
      throw markOutputError(changed(file, 'new target failed post-publication validation', '새로 만든 대상 파일이 저장 후 검증을 통과하지 못했습니다'), { outputMutationStarted: true });
    }
    closePreparedHandle(nextFd);
    nextFd = null;
    return { published: true, created: true, recoveryArtifacts: [], ...detached };
  } catch (error) {
    if (linked) {
      // linkSync already committed a directory entry. A now-missing pathname is
      // not proof of rollback when an ancestor may have moved or retargeted;
      // only an explicit successful rollback may set outputRolledBack=true.
      error.outputTargetVisibleAfterFailure = (() => { try { return fs.lstatSync(file).isFile(); } catch { return false; } })();
      error.outputMutationStarted = true;
    } else {
      scrubPreparedHandle(nextFd, error);
    }
    const cleanupError = cleanupFile(next);
    if (cleanupError) { error.cleanupError = cleanupError.code || cleanupError.message; error.cleanupArtifact = next; }
    closePreparedHandle(nextFd, error);
    nextFd = null;
    throw markOutputError(error, { outputMutationStarted: !!error.outputMutationStarted });
  }
}

// Internal variant avoids a second WeakMap lookup after a prepared file is
// written. It still performs a full fresh path/handle observation.
function assertMemoryOutputCurrentToken(previous, file) {
  const current = observe(file,previous.maxBytes);
  if (!sameOutputParent(previous, current)
    || (previous.stat === null) !== (current.stat === null)) throw changed(previous.file);
  if (previous.stat !== null && (!sameStat(previous.pathStat, current.pathStat) || !previous.bytes.equals(current.bytes))) {
    throw changed(previous.file);
  }
  return current;
}

function publishWindows(previous, value) {
  const { writeBufferIfUnchanged } = require('./io');
  let result = null;
  try {
    assertMemoryOutputCurrentToken(previous, previous.file);
    result = writeBufferIfUnchanged(previous.file, previous.bytes, value, {
      expectedIdentity: fileIdentity(previous.pathStat),
      retainBackup: false,
      maxReadBytes: previous.maxBytes,
    });
    const current = observe(previous.file,previous.maxBytes);
    if (!sameOutputParent(previous, current) || !current.bytes.equals(value)) {
      throw markOutputError(changed(previous.file, 'target or parent changed after publication', '저장한 뒤 대상 파일이나 상위 폴더가 바뀌었습니다'), {
        outputMutationStarted: true,
        outputPublished: true,
      });
    }
    return { published: true, created: false, ...result };
  } catch (error) {
    if (result) {
      // A later bounded observation can throw before the equality check below.
      // The replacement has already committed; preserve that partial state and
      // any earlier cleanup evidence instead of reporting a pre-write denial.
      for (const key of ['backupFile','cleanupError','cleanupDirectory']) if (result[key]) error[key] = result[key];
      error.recoveryArtifacts = [...(error.recoveryArtifacts || []),...(result.recoveryArtifacts || [])];
    }
    const attempted = !!(error && (error.backupFile || (Array.isArray(error.recoveryArtifacts) && error.recoveryArtifacts.length)));
    throw markOutputError(error, {
      outputMutationStarted: !!result || attempted || !!error.outputMutationStarted,
      outputPublished: !!result || attempted || !!error.outputPublished,
    });
  }
}

function publishPosix(previous, value) {
  const { assertWriteAllowed, detachCommittedHardLink } = require('./io');
  const file = previous.file;
  // Admission must happen before mkdtemp as well: --dry-run promises zero
  // persistent changes and fs.mkdtempSync is not a domain write that may escape
  // that contract just because publication later aborts.
  assertWriteAllowed(file);
  const scratch = fs.mkdtempSync(path.join(previous.parentPath, `.${path.basename(file)}.publish-cas-`));
  const next = path.join(scratch, 'next');
  const before = path.join(scratch, 'before');
  let displaced = false;
  let installed = false;
  let nextFd = null;
  try {
    assertWriteAllowed(file);
    assertWriteAllowed(next);
    nextFd = fs.openSync(next, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, Number(previous.pathStat.mode) & 0o777);
    fs.writeFileSync(nextFd, value);
    assertMemoryOutputCurrentToken(previous, file);
    fs.renameSync(file, before);
    displaced = true;

    const captured = fs.lstatSync(before);
    const capturedBytes = readPublicationBytes(before,previous.maxBytes);
    if (!regular(captured) || !sameIdentity(captured, previous.pathStat) || !capturedBytes.equals(previous.bytes)) {
      // The writer that won immediately before rename is restored below. Never
      // publish our value over an unvalidated displaced pathname.
      throw changed(file, 'another writer won the compare-and-publish window', '비교하고 저장하는 사이에 다른 작업이 먼저 썼습니다');
    }
    try {
      fs.linkSync(next, file);
      installed = true;
    } catch (error) {
      if (error && error.code === 'EEXIST') throw changed(file, 'another writer created the target during publication', '저장하는 동안 다른 작업이 대상 파일을 만들었습니다');
      if (error && ['EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) {
        throw unavailable(file, `exclusive hard-link install failed (${error.code})`, `하드 링크로 새 파일을 단독 설치하지 못했습니다 (${error.code})`);
      }
      throw error;
    }
    const detached = detachCommittedHardLink(next, file, value, { maxReadBytes: previous.maxBytes });
    const current = observe(file,previous.maxBytes);
    if (!sameOutputParent(previous, current) || !current.bytes.equals(value)) {
      throw changed(file, 'published target failed validation', '저장한 대상 파일이 검증을 통과하지 못했습니다');
    }
    closePreparedHandle(nextFd);
    nextFd = null;
    const cleanupError = cleanupFile(before) || cleanupDir(scratch);
    const out = { published: true, created: false, recoveryArtifacts: [], ...detached };
    if (cleanupError) {
      out.cleanupError = cleanupError.code || cleanupError.message;
      out.cleanupDirectory = scratch;
      if (fs.existsSync(before)) out.backupFile = before;
    }
    return out;
  } catch (error) {
    let rolledBack = false;
    // If the pathname is still absent, restore exactly the inode we captured.
    // If another writer created the pathname, preserve that winner and retain
    // `before` as recovery evidence instead of overwriting it.
    if (displaced) {
      let liveExists = false;
      try { liveExists = fs.lstatSync(file).isFile(); } catch {}
      if (!liveExists && fs.existsSync(before)) {
        try { fs.renameSync(before, file); rolledBack = true; } catch {}
      }
    }
    if (!installed) scrubPreparedHandle(nextFd, error);
    const cleanupError = cleanupFile(next);
    if (cleanupError) { error.cleanupError = cleanupError.code || cleanupError.message; error.cleanupArtifact = next; }
    closePreparedHandle(nextFd, error);
    nextFd = null;
    if ((!displaced || rolledBack) && !fs.existsSync(before)) {
      const directoryError = cleanupDir(scratch);
      if (directoryError) { error.cleanupError = error.cleanupError || directoryError.code || directoryError.message; error.cleanupDirectory = scratch; }
    }
    if (fs.existsSync(before)) {
      error.backupFile = error.backupFile || before;
      error.recoveryArtifacts = error.recoveryArtifacts || [{ role: 'displaced-original', path: before }];
    }
    throw markOutputError(error, {
      outputMutationStarted: displaced,
      outputPublished: installed,
      outputRolledBack: rolledBack,
    });
  }
}

function publishMemoryOutput(token, file, value) {
  const previous = recordFor(token, file);
  const content = Buffer.isBuffer(value) ? value : String(value);
  const length = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content,'utf8');
  if (previous.maxBytes !== null && length > previous.maxBytes) {
    throw Object.assign(changed(file,'prepared output exceeds declared byte limit', '저장할 내용이 지정한 바이트 한도를 넘습니다'), { code: 'E_OUTPUT_LIMIT', bytesRead: 0 });
  }
  const bytes = Buffer.from(content,'utf8');
  if (previous.stat !== null && previous.bytes.equals(bytes)) {
    assertMemoryOutputCurrentToken(previous, previous.file);
    return { unchanged: true, published: false, recoveryArtifacts: [] };
  }
  if (previous.stat === null) return publishAbsent(previous, bytes);
  if (process.platform === 'win32') return publishWindows(previous, bytes);
  return publishPosix(previous, bytes);
}

module.exports = { captureMemoryOutput, assertMemoryOutputCurrent, publishMemoryOutput };
