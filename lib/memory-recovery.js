'use strict';

// T-0193: memory-domain multi-file mutations are not transactions. When a
// write has started and a later step fails, retain exact before/live bytes plus
// a machine-readable receipt so manual/next-run recovery is possible without
// pretending that rollback was atomic.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let sequence = 0;

function _sha(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function _safeRole(value) {
  return String(value || 'file').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'file';
}

function captureMemoryRecoveryState(files) {
  return (files || []).map(item => {
    const role = _safeRole(item.role);
    const file = path.resolve(item.file);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile()) return { role, file, exists: true, kind: stat.isDirectory() ? 'directory' : 'other', bytes: null };
      return { role, file, exists: true, kind: 'file', bytes: fs.readFileSync(file) };
    } catch (error) {
      if (error && error.code === 'ENOENT') return { role, file, exists: false, kind: 'missing', bytes: null };
      return { role, file, exists: null, kind: 'unreadable', bytes: null, error: error && (error.code || error.message) };
    }
  });
}

function _describe(root, state, artifact) {
  const out = {
    role: state.role,
    path: path.relative(root, state.file).replace(/\\/g, '/'),
    exists: state.exists,
    kind: state.kind,
  };
  if (state.error) out.error = state.error;
  if (Buffer.isBuffer(state.bytes)) {
    out.size = state.bytes.length;
    out.sha256 = _sha(state.bytes);
    if (artifact) out.artifact = artifact;
  }
  return out;
}

function _writeStateArtifact(dir, prefix, state, writeFile) {
  if (!Buffer.isBuffer(state.bytes)) return null;
  const name = `${prefix}-${_safeRole(state.role)}.bin`;
  writeFile(path.join(dir, name), state.bytes, { flag: 'wx' });
  return name;
}

function _copyCauseArtifacts(error, root, dir, writeFile, transfer = null) {
  const candidates = [];
  if (Array.isArray(error && error.recoveryArtifacts)) candidates.push(...error.recoveryArtifacts);
  if (error && error.backupFile) candidates.push({ role: 'backup-file', path: error.backupFile });
  const seen = new Set();
  const out = [];
  let index = 0;
  for (const candidate of candidates) {
    if (!candidate || !candidate.path) continue;
    const source = path.resolve(candidate.path);
    if (seen.has(source)) continue;
    seen.add(source);
    if (transfer) {
      const role = _safeRole(candidate.role || 'recovery');
      const name = `cause-${String(++index).padStart(2,'0')}-${role}.bin`;
      const relative = path.relative(root,source).replace(/\\/g,'/');
      out.push({ role, sourcePath: relative && !relative.startsWith('../') && relative!=='..' ? relative : null,
        ...transfer.copy(source,name), content: candidate.content || null });
      continue;
    }
    let stat;
    try { stat = fs.lstatSync(source); } catch { continue; }
    if (!stat.isFile()) continue;
    let bytes;
    try { bytes = fs.readFileSync(source); } catch { continue; }
    const role = _safeRole(candidate.role || 'recovery');
    const artifact = `cause-${String(++index).padStart(2, '0')}-${role}.bin`;
    writeFile(path.join(dir, artifact), bytes, { flag: 'wx' });
    const relative = path.relative(root, source).replace(/\\/g, '/');
    out.push({
      role,
      artifact,
      sourcePath: relative && !relative.startsWith('../') && relative !== '..' ? relative : null,
      size: bytes.length,
      sha256: _sha(bytes),
      content: candidate.content || null,
    });
  }
  return out;
}

function _materializeRecovery(error, root, meta, beforeStates, dir, writeFile, storage, transfer = null) {
  const liveStates = transfer ? null : captureMemoryRecoveryState((beforeStates || []).map(state => ({ role: state.role, file: state.file })));
  const before = [];
  const live = [];
  for (const state of beforeStates || []) {
    const artifact = _writeStateArtifact(dir, 'before', state, writeFile);
    before.push(_describe(root, state, artifact));
  }
  if (transfer) for (const state of beforeStates || []) {
    live.push({ role: state.role, path: path.relative(root,state.file).replace(/\\/g,'/'),
      ...transfer.copy(state.file,`live-${_safeRole(state.role)}.bin`) });
  }
  for (const state of liveStates || []) {
    const artifact = _writeStateArtifact(dir, 'live', state, writeFile);
    live.push(_describe(root, state, artifact));
  }
  const causeArtifacts = _copyCauseArtifacts(error, root, dir, writeFile, transfer);
  const receiptPath = path.join(dir, 'receipt.json');
  const conflictCode = error.code || null;
  const causeCode = error.originalOutputCode || conflictCode;
  const causeMessage = error.message || String(error);
  const receipt = {
    version: 1,
    createdAt: new Date().toISOString(),
    surface: meta && meta.surface || null,
    operation: meta && meta.operation || null,
    stage: meta && meta.stage || null,
    completed: Array.isArray(meta && meta.completed) ? meta.completed.slice() : [],
    cause: {
      code: causeCode,
      conflictCode: conflictCode !== causeCode ? conflictCode : null,
      message: causeMessage,
    },
    before,
    live,
    causeArtifacts,
    storage,
    automaticRollback: false,
    ...(meta && meta.memoryPublication ? { memoryPublication: meta.memoryPublication } : {}),
    ...(transfer ? { recoveryCosts: { ...transfer.snapshot(), snapshotBeforeReceipt: true } } : {}),
  };
  writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', encoding: 'utf8' });
  return { dir, receiptPath, causeCode, causeMessage };
}

function _externalRecovery(error, root, meta, beforeStates, transferState = null, maxChunkBytes = null) {
  const { assertExternalRecoveryAllowed, writeExternalRecoveryBundle, writeExternalRecoveryStream } = require('./runtime-writes');
  // Reject a non-authorized retry before opening or copying any live source.
  assertExternalRecoveryAllowed(root);
  if (transferState) {
    let result;
    const dir = writeExternalRecoveryStream(root,(sink,directory)=>{
      const transfer=transferState.start(sink,'external-temp',directory);
      const write=(file,bytes)=>transfer.writeBytes(path.basename(file),Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes));
      result=_materializeRecovery(error,root,meta,beforeStates,directory,write,'external-temp',transfer);
    },maxChunkBytes);
    return {...result,dir,receiptPath:path.join(dir,'receipt.json')};
  }
  // Build the receipt entirely in memory first. runtime-writes owns the only
  // bypass that may persist this bundle after a layout failure, and constrains
  // it to a random user-temp directory outside the project.
  const virtualDir = path.join(path.resolve(root), '.leerness-external-recovery-bundle');
  const files = [];
  const collect = (file, bytes) => files.push({ name: path.basename(file), bytes: Buffer.from(bytes) });
  const recovery = _materializeRecovery(error, root, meta, beforeStates, virtualDir, collect, 'external-temp');
  const dir = writeExternalRecoveryBundle(root, files);
  return { ...recovery, dir, receiptPath: path.join(dir, 'receipt.json') };
}

function attachMemoryRecovery(error, root, meta, beforeStates, options = null) {
  if (!error || typeof error !== 'object') error = new Error(String(error));
  if (error.memoryRecoveryReceipt) return error;
  const maxChunkBytes=options ? options.maxChunkBytes : null;
  const transferState=options ? require('./memory-recovery-transfer').createRecoveryTransfer(maxChunkBytes) : null;

  const conflictCode = error.code || null;
  const causeCode = error.originalOutputCode || conflictCode;
  const causeMessage = error.message || String(error);
  const base = path.join(path.resolve(root), '.leerness', 'archive', 'mutation-recovery');
  const id = `memory-${Date.now()}-${process.pid}-${++sequence}-${crypto.randomBytes(4).toString('hex')}`;
  const dir = path.join(base, id);
  try {
    fs.mkdirSync(dir, { recursive: true });
    let recovery;
    if (transferState) {
      const sink=require('./memory-recovery-sink').createRecoverySink(fs,dir,{maxChunkBytes});
      const transfer=transferState.start(sink,'project',path.relative(root,dir).replace(/\\/g,'/'));
      const write=(file,bytes)=>transfer.writeBytes(path.basename(file),Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes));
      try {recovery=_materializeRecovery(error,root,meta,beforeStates,dir,write,'project',transfer);}
      finally {sink.close();}
    } else {
      const localWrite = (file, bytes, options) => fs.writeFileSync(file, bytes, options);
      recovery = _materializeRecovery(error, root, meta, beforeStates, dir, localWrite, 'project');
    }
    const relativeReceipt = path.relative(root, recovery.receiptPath).replace(/\\/g, '/');
    error.memoryRecoveryReceipt = relativeReceipt;
    error.memoryRecoveryDirectory = path.relative(root, recovery.dir).replace(/\\/g, '/');
    error.memoryRecoveryExternal = false;
    error.causeCode = causeCode;
    error.code = 'E_MEMORY_PARTIAL_WRITE';
    error.message = `${causeMessage} — memory mutation이 부분 적용됐을 수 있습니다. 복구 receipt: ${relativeReceipt}`;
    return error;
  } catch (receiptError) {
    const primaryError = receiptError && (receiptError.code || receiptError.message);
    const primaryErrorMessage = receiptError && receiptError.message || null;
    try {
      // Do not write through a project pathname whose runtime authority has
      // changed. Preserve evidence in a random user-temp directory instead.
      const recovery = _externalRecovery(error, root, meta, beforeStates,transferState,maxChunkBytes);
      error.memoryRecoveryReceipt = recovery.receiptPath;
      error.memoryRecoveryDirectory = recovery.dir;
      error.memoryRecoveryExternal = true;
      error.memoryRecoveryPrimaryError = primaryError;
      error.memoryRecoveryPrimaryErrorMessage = primaryErrorMessage;
      error.causeCode = causeCode;
      error.code = 'E_MEMORY_PARTIAL_WRITE';
      error.message = `${causeMessage} — memory mutation이 부분 적용됐을 수 있습니다. 외부 복구 receipt: ${recovery.receiptPath}`;
      return error;
    } catch (fallbackError) {
      error.causeCode = causeCode;
      error.code = 'E_MEMORY_PARTIAL_WRITE';
      error.memoryRecoveryPrimaryError = primaryError;
      error.memoryRecoveryPrimaryErrorMessage = primaryErrorMessage;
      error.memoryRecoveryError = fallbackError && (fallbackError.code || fallbackError.message);
      error.memoryRecoveryErrorMessage = fallbackError && fallbackError.message || null;
      if (fallbackError.recoveryBundleDirectory) error.memoryRecoveryFailedExternalDirectory = fallbackError.recoveryBundleDirectory;
      error.message = `${causeMessage} — memory mutation이 부분 적용됐을 수 있으며 복구 receipt 생성도 실패했습니다: ${error.memoryRecoveryError}`;
      return error;
    }
  } finally {
    if (transferState) error.memoryRecoveryCosts=transferState.snapshot();
  }
}

module.exports = { captureMemoryRecoveryState, attachMemoryRecovery };
