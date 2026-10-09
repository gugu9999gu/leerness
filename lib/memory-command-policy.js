'use strict';

// Adapter for the existing locked CLI handlers. Inputs below are private command
// working copies from bounded JSON/Markdown parsing and string-valued CLI fields,
// not a serializer for arbitrary objects, getters or user-supplied JS callbacks.
const admission = require('./memory-write-admission');
const { measureParsedMemoryJson, jsonStringBytes } = require('./memory-json-size');
const { assertMemoryItems } = require('./memory-items');
const { projectionParts } = require('./memory-migration-budget');
const { _renderDecisionsMd, _renderLessonsMd } = require('./pure-utils');
const contexts = new WeakMap(), outcomes = new WeakMap();
const fail = (reasonCode, phase = 'policy') => {
  throw Object.assign(new Error('Memory write policy: ' + reasonCode), { code: 'E_MEMORY_POLICY', reasonCode, phase });
};
function guarded(fn) {
  try { return fn(); } catch (e) {
    if (e.code === 'E_MEMORY_POLICY') throw e;
    if (e.code !== 'E_MEMORY_PARTIAL_WRITE' && (e.phase || ['E_STORE_LIMIT','E_OUTPUT_LIMIT'].includes(e.code))) {
      throw Object.assign(new Error('Memory write policy rejected the operation'), {
        code: 'E_MEMORY_POLICY', reasonCode: e.code, phase: e.phase || (e.memoryPublication ? 'publication' : 'source'), dimension: e.dimension || e.limitKind || null,
        ...(e.memoryPublication ? { memoryPublication: e.memoryPublication } : {}),
      });
    }
    throw e;
  }
}
function validateOption(option) {
  if (!option.missing && !option.values.length) return null;
  if (option.missing || option.values.length !== 1) fail('policy_option_invalid');
  guarded(() => admission.parseMemoryWritePolicy(option.values[0]));
  return option.values[0];
}
function capture(root, surface, policyJson) {
  return guarded(() => {
    const policy = admission.parseMemoryWritePolicy(policyJson);
    const input = admission.captureMemoryWriteAdmission(root,surface,policyJson);
    contexts.set(input,policy);
    return input;
  });
}
function recheck(input) { return guarded(() => admission.assertMemoryWriteAdmissionCurrent(input)); }
function checkCount(input, count) {
  const policy = contexts.get(input);
  if (policy && count > policy.limits.candidate.maxItems) fail('items_exceeded','candidate');
}
function checkCandidate(input, entries) {
  const policy = contexts.get(input);
  if (!policy) return;
  const limits = policy.limits.candidate;
  checkCount(input,entries.length);
  try { measureParsedMemoryJson(entries,limits,true); }
  catch (e) { fail(e.code,'candidate'); }
  assertMemoryItems(input.surface,entries);
  const render = input.surface === 'decisions' ? _renderDecisionsMd : _renderLessonsMd;
  let bytes = Buffer.byteLength(render([]));
  if (bytes > limits.maxProjectionBytes) fail('projection_bytes_exceeded','candidate');
  for (const entry of entries) for (const part of projectionParts(input.surface,entry)) {
    bytes += Buffer.byteLength(part);
    if (bytes > limits.maxProjectionBytes) fail('projection_bytes_exceeded','candidate');
  }
}
function archiveLimit(input) { return contexts.get(input)?.limits.operation.maxArchiveInputBytes ?? null; }
function joinArchive(input, parts) {
  const limit = archiveLimit(input);
  if (limit !== null) {
    let bytes = 0;
    for (const part of parts) {
      bytes += Buffer.byteLength(part);
      if (bytes > limit) fail('archive_input_bytes_exceeded','operation');
    }
  }
  return parts.join('');
}
function publish(input, entries, archive) {
  if (!contexts.has(input)) return false;
  checkCandidate(input,entries);
  const operation = { kind: archive ? archive.mode === 'replace' ? 'restore' : 'drop' : 'update', archiveText: archive ? archive.text : null };
  if (archive) {
    joinArchive(input,[archive.text]);
    // Account for escaped operation JSON before serializing the full envelope.
    const bytes = Buffer.byteLength(JSON.stringify({ kind: operation.kind, archiveText: '' })) - 2 + jsonStringBytes(archive.text);
    if (bytes > Math.min(4 * 1024 * 1024,6 * archiveLimit(input) + 128)) fail('envelope_bytes_exceeded','operation');
  }
  return guarded(() => {
    const write = admission.prepareAdmittedMemoryWrite(input,JSON.stringify(entries),JSON.stringify(operation));
    outcomes.set(input,admission.publishAdmittedMemoryWrite(write));
    return true;
  });
}
module.exports = { capture, validateOption, recheck, checkCount, checkCandidate, archiveLimit, joinArchive, publish,
  outcome: input => outcomes.has(input) ? { memoryPublication: outcomes.get(input) } : {},
  warnCleanup: outcome => { if (outcome.memoryPublication?.cleanupPending) process.stderr.write(
    "Memory publication cleanup pending: " + JSON.stringify(outcome.memoryPublication) + "\n"); },
  has: input => contexts.has(input), fail, guarded,
  supportsTool: name => ['leerness_decision_add','leerness_lesson_save','leerness_decision_drop','leerness_lesson_drop','leerness_memory_restore'].includes(name) };
