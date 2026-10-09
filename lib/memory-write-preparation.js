'use strict';

// Internal, call-local writer preparation. The caller owns the canonical lock and
// command semantics. Handles are single-use, not serialized approval capabilities.
const path = require('path');
const { assertMemoryItems } = require('./memory-items');
const { assertMemoryInputCurrent, assertCheckedFileCurrent } = require('./memory-input');
const { prepareMemoryProjection, assertMemoryProjectionCurrent } = require('./memory-projection');
const { captureMemoryOutput, assertMemoryOutputCurrent, publishMemoryOutput } = require('./memory-output');
const { attachMemoryRecovery } = require('./memory-recovery');
const { publicationResult, retainedCandidates } = require('./memory-publication-result');
const { inspectMemoryWriteBudget } = require('./memory-write-budget');
const { memoryDocumentLanguage } = require('./memory-language');
const records = new WeakMap();
const invalid = code => { throw Object.assign(new Error('Memory write preparation is invalid or already used'),{ code }); };
function recordFor(handle) {
  const record = records.get(handle);
  if (!record) invalid('E_MEMORY_PLAN_INVALID');
  if (record.used) invalid('E_MEMORY_PLAN_USED');
  return record;
}
function checkOriginal(record) {
  assertMemoryInputCurrent(record.input,record.canonical.file,record.projectionTarget.file);
  assertMemoryProjectionCurrent(record.projection,record.projectionTarget.file);
  if (record.archiveInput) assertCheckedFileCurrent(record.archiveInput,record.archive.file);
  for (const target of record.targets) assertMemoryOutputCurrent(target.snapshot,target.file);
}
function prepareMemoryWrite(root, surface, entries, input, archive = null, readOptions = {}) {
  if (typeof root !== 'string' || !root || !['decisions','lessons'].includes(surface)) invalid('E_MEMORY_PLAN_INVALID');
  root = path.resolve(root);
  const workspace = path.join(root,'.leerness');
  const files = { canonical: path.join(workspace,surface+'.json'), projection: path.join(workspace,surface+'.md'),
    archive: path.join(workspace,surface+'.archive.md') };
  const archiveMode = archive && archive.mode !== undefined ? archive.mode : 'append';
  if (archive !== null && (typeof archive !== 'object' || Array.isArray(archive)
    || typeof archive.path !== 'string' || path.resolve(archive.path) !== files.archive
    || typeof archive.text !== 'string' || !['append','replace'].includes(archiveMode)
    || (archiveMode === 'replace' && (!archive.input || archive.input.exists !== true)))) invalid('E_MEMORY_PLAN_INVALID');
  assertMemoryItems(surface,entries);
  const json = JSON.stringify(entries,null,2) + '\n';
  // Render the serialized canonical candidate, never a caller array that may
  // have changed during serialization or may change after preparation returns.
  const canonicalEntries = JSON.parse(json);
  assertMemoryItems(surface,canonicalEntries);
  const projection = prepareMemoryProjection(surface,input,files.projection,canonicalEntries,readOptions,memoryDocumentLanguage(root));
  const target = (role, bytes) => ({ role, file: files[role], snapshot: captureMemoryOutput(files[role],readOptions), bytes });
  const canonical = target('canonical',Buffer.from(json));
  const projectionTarget = target('projection',Buffer.from(projection.text));
  const archiveTarget = archive ? target('archive',null) : null;
  const operation = { kind: archive ? archiveMode === 'replace' ? 'restore' : 'drop' : 'update',
    archiveText: archive ? archive.text : null };
  if (archiveTarget) archiveTarget.bytes = operation.kind === 'drop'
    ? Buffer.concat([archiveTarget.snapshot.bytes || Buffer.alloc(0),Buffer.from(operation.archiveText)])
    : Buffer.from(operation.archiveText);
  const targets = [canonical,projectionTarget,...(archiveTarget ? [archiveTarget] : [])];
  const record = { root, surface, input, json, projection, canonical, projectionTarget, archive: archiveTarget,
    archiveInput: operation.kind === 'restore' ? archive.input : null, operation, targets, used: false };
  record.maxReadBytes = readOptions.maxBytes === undefined ? null : readOptions.maxBytes;
  checkOriginal(record);
  // These are copies of the admitted pre-publication target bytes. A fresh raw
  // read here could turn a later external change into the supposed original.
  record.before = targets.map(t => ({ role: t.role, file: t.file, exists: t.snapshot.exists,
    kind: t.snapshot.exists ? 'file' : 'missing', bytes: t.snapshot.bytes === null ? null : Buffer.from(t.snapshot.bytes) }));
  const handle = Object.freeze({ surface, operation: operation.kind });
  records.set(handle,record);
  return handle;
}
function assessPreparedMemoryWrite(handle, limitsJson) {
  const record = recordFor(handle);
  checkOriginal(record);
  const result = inspectMemoryWriteBudget(record.root,record.surface,record.json,JSON.stringify(record.operation),limitsJson);
  checkOriginal(record);
  return { ...result, preparedBytesUsed: true, originalInputsRechecked: true };
}
function publishPreparedMemoryWrite(handle) {
  const record = recordFor(handle);
  record.used = true;
  checkOriginal(record);
  // Reject dry-run/runtime write denial before any publication begins. The
  // backend's conflict wrapper must not relabel this as an output race.
  const { assertWriteAllowed } = require('./io');
  for (const target of record.targets) assertWriteAllowed(target.file);
  const { root, surface, canonical, projectionTarget, projection, archive, archiveInput, operation } = record;
  const completed = [], outputs = [];
  const publish = target => {
    const result = publishMemoryOutput(target.snapshot,target.file,target.bytes);
    outputs.push({ role: target.role, ...result });
  };
  let stage = operation.kind === 'drop' ? 'archive-append' : 'canonical-write';
  let recoveryOperation = operation.kind === 'restore' ? 'restore-active' : operation.kind;
  try {
    if (operation.kind === 'drop') {
      publish(archive);
      completed.push('archive-append'); stage = 'canonical-write';
    }
    publish(canonical); completed.push('canonical-write');
    stage = 'projection-check';
    assertMemoryProjectionCurrent(projection,projectionTarget.file);
    assertMemoryOutputCurrent(projectionTarget.snapshot,projectionTarget.file);
    stage = 'projection-write';
    publish(projectionTarget); completed.push('projection-write');
    if (operation.kind === 'restore') {
      // Keep the existing receipt contract for the later archive phase.
      completed.splice(0,completed.length,'active-publication');
      recoveryOperation = 'restore'; stage = 'archive-check';
      assertCheckedFileCurrent(archiveInput,archive.file);
      assertMemoryOutputCurrent(archive.snapshot,archive.file);
      stage = 'archive-rewrite';
      publish(archive); completed.push('archive-rewrite');
    }
    return record.maxReadBytes === null ? undefined : publicationResult(root,record.maxReadBytes,outputs);
  } catch (error) {
    const partial = completed.length > 0 || !!(error && error.outputMutationStarted && !error.outputRolledBack);
    if (record.maxReadBytes !== null) {
      // Earlier successful targets may still retain a cleanup backup. Keep it
      // visible and eligible for the existing receipt's cause-artifact copies.
      const artifacts = retainedCandidates([...outputs,error]);
      error.memoryPublication = publicationResult(root,record.maxReadBytes,[...outputs,error]);
      error.recoveryArtifacts = artifacts;
    }
    if (!partial) throw error;
    throw attachMemoryRecovery(error,root,{ surface, operation: recoveryOperation, stage, completed,
      ...(error.memoryPublication ? { memoryPublication: error.memoryPublication } : {}) },record.before,
    record.maxReadBytes === null ? null : { maxChunkBytes: Math.min(65536,record.maxReadBytes) });
  }
}

module.exports = { prepareMemoryWrite, assessPreparedMemoryWrite, publishPreparedMemoryWrite };
