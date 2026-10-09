'use strict';

const fs = require('fs');
const path = require('path');
const { resolveMemoryParent, sameResolvedParent } = require('./memory-parent');
const { captureCheckedFileInput, assertCheckedFileCurrent } = require('./memory-input');
const { fail } = require('./memory-migration-material');

function directory(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('migration_directory_unsupported');
  return { file, dev: stat.dev, ino: stat.ino, mode: stat.mode, resolved: resolveMemoryParent(file) };
}
function assertDirectory(previous) {
  const now = directory(previous.file);
  if (now.dev !== previous.dev || now.ino !== previous.ino || now.mode !== previous.mode
    || !sameResolvedParent(now.resolved, previous.resolved)) fail('migration_directory_changed');
}
function openStorage(workspace, operationId, create = false, checkRequest = () => {}) {
  const directories = [directory(workspace)];
  let current = workspace;
  const check = () => { checkRequest(); directories.forEach(assertDirectory); };
  for (const name of ['archive', 'memory-migrations', operationId]) {
    check(); current = path.join(current, name);
    if (create) {
      try { fs.mkdirSync(current, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST' || name === operationId) throw error; }
    }
    directories.push(directory(current)); check();
  }
  return { dir: current, check };
}
function readArtifact(storage, name, maxBytes) {
  storage.check();
  const file = path.join(storage.dir, name);
  const input = captureCheckedFileInput(file, { maxBytes });
  storage.check();
  if (!input.exists) fail('migration_artifact_missing');
  return { file, input, bytes: input.bytes, check: () => { storage.check(); assertCheckedFileCurrent(input, file); } };
}
function createArtifact(storage, name, bytes) {
  storage.check();
  const file = path.join(storage.dir, name);
  let fd = null, failed = false;
  try {
    fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    fs.writeFileSync(fd, bytes); fs.fsyncSync(fd);
    fs.closeSync(fd); fd = null;
    const observed = readArtifact(storage, name, Math.max(bytes.length, 1));
    if (!observed.bytes.equals(bytes)) fail('migration_artifact_mismatch');
    observed.check(); return observed;
  } catch (error) { failed = true; throw error; }
  finally {
    if (fd !== null) {
      try { fs.closeSync(fd); }
      catch (error) { if (!failed) throw error; }
    }
  }
}
module.exports = { directory, assertDirectory, openStorage, readArtifact, createArtifact };
