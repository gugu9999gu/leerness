'use strict';

// Read-only preflight of explicit candidate costs. Command selection, duplicate
// handling, lossless archive admission, locking and publication remain the writer's job.
const { captureMemoryFootprint, footprintErrorCode } = require('./memory-footprint-capture');
const { WriteBudgetError, parseWriteLimits, parseWriteOperation, measureArray,
  measureWriteSource, measurePublicationCost, decode } = require('./memory-write-budget-plan');
const { memoryDocumentLanguage } = require('./memory-language');
const result = (surface, error = null, measurement = null, disposition = 'unsupported') => ({
  schema: 'leerness.memory-write-budget/v1', schemaVersion: 1, surface,
  ok: error === null, disposition: error === null ? 'within-declared-budget' : disposition,
  readOnly: true, filesRechecked: error === null, recoveryMetadataRechecked: error === null,
  sourceContentValidated: error === null, candidateRelationVerified: false, archiveRecordsValidated: false,
  atomicObservation: false, approvalGranted: false, writesPerformed: false, reservationGranted: false,
  recoveryPeakBytes: null, physicalBytes: null, measurement, error });
function inspectMemoryWriteBudget(root, surface, candidateJson, operationJson, limitsJson) {
  if (typeof root !== 'string' || !root || root.includes('\0') || root.length > 32768
    || !['decisions','lessons'].includes(surface)) return result(null,{ code: 'invalid_arguments', phase: 'input' });
  try {
    if (typeof candidateJson !== 'string') throw new WriteBudgetError('serialized_json_required','candidate');
    const limits = parseWriteLimits(limitsJson);
    const operation = parseWriteOperation(operationJson,limits.operation);
    const candidate = measureArray(surface,candidateJson,limits.candidate,'candidate',memoryDocumentLanguage(root));
    const captured = captureMemoryFootprint(root,surface,JSON.stringify(limits.observation));
    const source = measureWriteSource(surface,captured.snapshots,limits.source,memoryDocumentLanguage(root));
    if (operation.kind === 'restore' && captured.snapshots.archive.exists) decode(captured.snapshots.archive.bytes,'archive',true);
    const backend = process.platform === 'win32' ? 'windows-replace' : 'posix-link';
    const costs = measurePublicationCost(captured.measurement,candidate,source.suffixBytes,operation,limits.operation,backend);
    captured.recheck();
    return result(surface,null,{ operation: operation.kind, sourceKind: source.kind,
      observed: captured.measurement, source: source.assessment, candidate,
      suffixBytes: source.suffixBytes, ...costs,
      peakScope: 'normal-publication-paths-with-shared-recovery', normalCleanupRequired: true });
  } catch (error) {
    if (error instanceof WriteBudgetError) return result(surface,{ code: error.code, phase: error.phase },null,error.disposition);
    return result(surface,{ code: footprintErrorCode(error), phase: 'observation' });
  }
}

module.exports = { inspectMemoryWriteBudget };
