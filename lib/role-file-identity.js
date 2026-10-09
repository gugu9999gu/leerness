'use strict';

// Role configuration and execution-ledger handle checks. Schema, parent,
// revision and mutation authority remain with their respective callers.
const fs = require('fs');
const sameRoleFileIdentity = (a, b) => !!a && !!b
  && a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.nlink === b.nlink;
const sameRoleFileSnapshot = (a, b) => sameRoleFileIdentity(a, b)
  && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const regular = stat => !!stat && stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1;
const knownHandle = stat => regular(stat)
  && (process.platform !== 'win32' || (stat.dev !== 0 && stat.ino !== 0));
const rolePathMatchesHandle = (named, handle) => regular(named) && knownHandle(handle)
  && (sameRoleFileSnapshot(named, handle) || (process.platform === 'win32'
    && named.dev === 0 && sameRoleFileSnapshot({ ...named, dev: handle.dev }, handle)));
const confirmationError = error => Object.assign(new Error('file identity confirmation failed'), { code: error.code || 'EIO' });

function confirmRoleFilePath(file, handle, named, changed) {
  if (!rolePathMatchesHandle(named, handle)) throw changed();
  if (process.platform !== 'win32' || named.dev !== 0) return named;
  // A path stat with dev=0 cannot prove the volume. Confirm the current path
  // through a second handle, without rereading content or allowing writes.
  let fd = null, failure = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
      | (fs.constants.O_NONBLOCK || 0));
    const confirmed = fs.fstatSync(fd);
    const finalName = fs.lstatSync(file);
    if (!knownHandle(confirmed) || !sameRoleFileSnapshot(handle, confirmed)
      || !rolePathMatchesHandle(finalName, confirmed)) throw changed();
    return finalName;
  } catch (error) { failure = error; throw confirmationError(error); }
  finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (error) { if (!failure) throw confirmationError(error); }
    }
  }
}

module.exports = { sameRoleFileIdentity, sameRoleFileSnapshot, rolePathMatchesHandle, confirmRoleFilePath };
