'use strict';

// Explicit internal admission, not a default CLI policy. Callers keep their
// canonical operation lock and command-level selection/preservation checks.
const path = require('path');
const { captureMemoryInput, assertMemoryInputCurrent } = require('./memory-input');
const { captureMemoryFootprint } = require('./memory-footprint-capture');
const { parseWriteLimits, parseWriteOperation, measureArray, measureWriteSource, measurePublicationCost, decode } = require('./memory-write-budget-plan');
const { prepareMemoryWrite, publishPreparedMemoryWrite } = require('./memory-write-preparation');
const { memoryDocumentLanguage } = require('./memory-language');
const captures = new WeakMap(), writes = new WeakMap();
const TARGETS = ['items','canonicalBytes','projectionBytes','archiveBytes','totalPathBytes'];
const CAP = 4 * 1024 * 1024;
const fail = (code, phase = 'admission', dimension = null) => {
  throw Object.assign(new Error('Memory write admission: '+code), { code, phase, dimension });
};
const exactKeys = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
function parsePolicy(text) {
  if (typeof text !== 'string' || text.length > 8192 || Buffer.byteLength(text) > 8192) fail('policy_invalid','policy');
  let policy; try { policy = JSON.parse(text); } catch { fail('policy_invalid','policy'); }
  if (!exactKeys(policy,['limits','targets','mode']) || !['within-target','reduce-existing'].includes(policy.mode)
    || !exactKeys(policy.targets,TARGETS)
    || !TARGETS.every(k => Number.isSafeInteger(policy.targets[k]) && policy.targets[k] >= 0)) fail('policy_invalid','policy');
  const limits = parseWriteLimits(JSON.stringify(policy.limits));
  // Implementation ceilings for this opt-in path, never implicit target values.
  if (limits.operation.maxProjectionBytes > CAP || limits.operation.maxArchiveBytes > CAP) fail('policy_invalid','policy');
  return { ...policy, limits };
}
function recordFor(map, handle) {
  const record = map.get(handle);
  if (!record) fail('E_MEMORY_ADMISSION_INVALID');
  if (record.used) fail('E_MEMORY_ADMISSION_USED');
  return record;
}
function recheck(record) {
  assertMemoryInputCurrent(record.input,record.files.canonical,record.files.projection);
  record.captured.recheck();
}
function captureMemoryWriteAdmission(root, surface, policyJson) {
  if (typeof root !== 'string' || !root || root.includes('\0') || root.length > 32768
    || !['decisions','lessons'].includes(surface)) fail('invalid_arguments');
  const policy = parsePolicy(policyJson);
  root = path.resolve(root);
  const files = { canonical: path.join(root,'.leerness',surface+'.json'),
    projection: path.join(root,'.leerness',surface+'.md'), archive: path.join(root,'.leerness',surface+'.archive.md') };
  const input = captureMemoryInput(files.canonical,files.projection,() => fail('legacy_migration_required','source'), {
    maxBytes: Math.min(policy.limits.source.maxInputBytes,policy.limits.observation.maxFileBytes,policy.limits.observation.maxTotalFileBytes),
    maxDepth: policy.limits.source.maxDepth,
  });
  const captured = captureMemoryFootprint(root,surface,JSON.stringify(policy.limits.observation));
  const source = measureWriteSource(surface,captured.snapshots,policy.limits.source,memoryDocumentLanguage(root));
  const record = { root, surface, policy, files, input, captured, source, used: false };
  recheck(record);
  // Selection copies are deliberately separate from the private input used by
  // projection validation. Mutating these never changes the admitted original.
  const entries = captured.snapshots.canonical.exists ? JSON.parse(decode(captured.snapshots.canonical.bytes,'source')) : [];
  const archiveBytes = captured.snapshots.archive.exists ? Buffer.from(captured.snapshots.archive.bytes) : null;
  const handle = Object.freeze({ surface, entries, archiveBytes });
  captures.set(handle,record);
  return handle;
}
function admitTargets(policy, before, after) {
  const exceeded = TARGETS.filter(k => after[k] > policy.targets[k]);
  if (!exceeded.length) return 'within-target';
  if (policy.mode !== 'reduce-existing') fail('target_exceeded','targets',exceeded[0]);
  for (const key of TARGETS) {
    if (after[key] > policy.targets[key] && after[key] > before[key]) fail('target_increased','targets',key);
  }
  if (!TARGETS.some(k => before[k] > policy.targets[k] && after[k] < before[k])) fail('target_not_reduced','targets');
  return 'reduces-existing-excess';
}
function prepareAdmittedMemoryWrite(handle, candidateJson, operationJson) {
  const record = recordFor(captures,handle);
  record.used = true;
  const { root, surface, policy, files, input, captured, source } = record;
  const operation = parseWriteOperation(operationJson,policy.limits.operation);
  const candidate = measureArray(surface,candidateJson,policy.limits.candidate,'candidate',memoryDocumentLanguage(root));
  if (operation.kind === 'restore') {
    if (!captured.snapshots.archive.exists) fail('archive_required','operation');
    decode(captured.snapshots.archive.bytes,'archive',true);
  }
  const costs = measurePublicationCost(captured.measurement,candidate,source.suffixBytes,operation,policy.limits.operation,
    process.platform === 'win32' ? 'windows-replace' : 'posix-link');
  const before = { items: source.assessment.itemCount, canonicalBytes: captured.measurement.files.canonical.bytes,
    projectionBytes: captured.measurement.files.projection.bytes, archiveBytes: captured.measurement.files.archive.bytes,
    totalPathBytes: captured.measurement.totalPathBytes };
  const after = { items: candidate.itemCount, canonicalBytes: costs.next.canonical,
    projectionBytes: costs.next.projection, archiveBytes: costs.next.archive, totalPathBytes: costs.finalPathBytes };
  const disposition = admitTargets(policy,before,after);
  recheck(record);
  const archive = operation.kind === 'update' ? null : { path: files.archive, text: operation.archiveText,
    mode: operation.kind === 'restore' ? 'replace' : 'append', input: captured.snapshots.archive };
  // Every full output is measured before the existing serializer/renderer and
  // archive concatenation run. Candidate objects come only from bounded JSON.
  const prepared = prepareMemoryWrite(root,surface,JSON.parse(candidateJson),input,archive, {
    maxBytes: Math.max(policy.limits.observation.maxFileBytes,...Object.values(costs.next)),
  });
  recheck(record);
  const result = Object.freeze({ surface, operation: operation.kind, disposition,
    measurement: { before, after, ...costs }, approvalGranted: false, reservationGranted: false });
  writes.set(result,{ capture: record, prepared, used: false });
  return result;
}
function publishAdmittedMemoryWrite(handle) {
  const record = recordFor(writes,handle);
  record.used = true;
  recheck(record.capture);
  return publishPreparedMemoryWrite(record.prepared);
}

function assertMemoryWriteAdmissionCurrent(handle) { recheck(recordFor(captures,handle)); }

module.exports = { captureMemoryWriteAdmission, prepareAdmittedMemoryWrite, publishAdmittedMemoryWrite,
  parseMemoryWritePolicy: parsePolicy, assertMemoryWriteAdmissionCurrent };
