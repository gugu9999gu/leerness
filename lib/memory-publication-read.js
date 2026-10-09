'use strict';

// Backend byte comparisons also run after a pathname has been displaced or
// linked. Unlike input admission, these reads must accept a hard-link alias.
// The caller still validates the identity and semantics of the compared bytes.
const fs = require('fs');
const { readMemoryInputBytes } = require('./memory-input-bytes');
const { errorLanguage } = require('./error-language');
// T-0337: Korean in a Korean project (lib/error-language.js); the English text everywhere else, as before.
const failure = (code, file) => Object.assign(new Error(errorLanguage() === 'ko' ? '저장 대상 파일을 읽어 확인하지 못했습니다'
  : 'Memory publication read failed'), { code, file });
function validatePublicationLimit(maxBytes) {
  if (maxBytes !== null && (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 4 * 1024 * 1024)) {
    throw failure('E_OUTPUT_INVALID', null);
  }
}
function readPublicationBytes(file, maxBytes = null) {
  validatePublicationLimit(maxBytes);
  if (maxBytes === null) return fs.readFileSync(file);
  let fd, confirmationFd;
  const regular = stat => stat.isFile() && !stat.isSymbolicLink();
  const limit = () => Object.assign(failure('E_OUTPUT_LIMIT',file), { bytesRead: 0 });
  try {
    const before = fs.lstatSync(file, { bigint: true });
    if (!regular(before)) throw failure('E_OUTPUT_CHANGED',file);
    if (before.size > BigInt(maxBytes)) throw limit();
    fd = fs.openSync(file,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!regular(opened)) throw failure('E_OUTPUT_CHANGED',file);
    const bytes = readMemoryInputBytes(fd,maxBytes,file,opened.size);
    const after = fs.fstatSync(fd, { bigint: true });
    const current = fs.lstatSync(file, { bigint: true });
    const equal = (a,b) => ['ino','mode','size','nlink','mtimeNs','ctimeNs'].every(key => a[key] === b[key]);
    const deviceMatches = (p,h) => p.dev === h.dev || (process.platform === 'win32' && p.dev === 0n && h.dev !== 0n);
    if (!regular(current) || !equal(before,opened) || !deviceMatches(before,opened)
      || !equal(opened,after) || opened.dev !== after.dev || !equal(after,current) || !deviceMatches(current,after)
      || after.size !== BigInt(bytes.length)) throw failure('E_OUTPUT_CHANGED',file);
    if (process.platform === 'win32' && (before.dev === 0n || current.dev === 0n)) {
      confirmationFd = fs.openSync(file,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
      const confirmed = fs.fstatSync(confirmationFd, { bigint: true });
      if (!regular(confirmed) || !equal(after,confirmed) || after.dev !== confirmed.dev || after.dev === 0n || after.ino === 0n) {
        throw failure('E_OUTPUT_CHANGED',file);
      }
    }
    return bytes;
  } catch (error) {
    if (error.code === 'E_STORE_LIMIT') error.code = 'E_OUTPUT_LIMIT';
    throw error;
  } finally {
    try { if (confirmationFd !== undefined) fs.closeSync(confirmationFd); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
}
module.exports = { readPublicationBytes, validatePublicationLimit };
