'use strict';

const path = require('path');
const { TextDecoder } = require('util');
const { resolveStatePaths } = require('./state-paths');
const { createRuntimeCompatibilityReader } = require('./runtime-layout');
const { captureCheckedFileInput, assertCheckedFileCurrent } = require('./memory-input');
const { resolveMemoryParent, sameResolvedParent } = require('./memory-parent');
const { MAX_BYTES } = require('./store-diagnostic-read');
const { assessLegacyMemoryMigration } = require('./memory-migration-plan');

const RESPONSE_SCHEMA = 'leerness.memory-migration-observation/v1';
function failure(code) {
  return { schema: RESPONSE_SCHEMA, schemaVersion: 1, ok: false, readOnly: true,
    sourceRechecked: false, atomicObservation: false, approvalGranted: false,
    writesPerformed: false, assessment: null, error: { code } };
}
function capture(file, canonical) {
  let input;
  try { input = captureCheckedFileInput(file, { maxBytes: MAX_BYTES }); }
  catch (error) {
    const states = { E_STORE_INVALID: 'unsupported', E_STORE_LIMIT: 'unsupported',
      E_STORE_UNREADABLE: 'unreadable', E_STORE_CHANGED: 'unknown' };
    return { state: states[error.code] || 'unknown', reasonCode: error.code === 'E_STORE_LIMIT'
      ? 'input_budget_exceeded' : 'source_unavailable', input: null, file };
  }
  if (!input.exists) return { state: 'absent', reasonCode: 'observed_absence', input, file };
  if (canonical) {
    let text, document;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes); }
    catch { return { state: 'corrupt', reasonCode: 'invalid_utf8', input, file }; }
    try { document = JSON.parse(text); }
    catch { return { state: 'corrupt', reasonCode: 'invalid_json', input, file }; }
    if (!Array.isArray(document)) return { state: 'corrupt', reasonCode: 'array_required', input, file };
  }
  return { state: 'present', reasonCode: canonical ? 'array_items_unchecked' : 'bytes_observed', input, file };
}
const metadata = record => ({ state: record.state, reasonCode: record.reasonCode });

// Private, operation-local observations. The pure assessment keeps its caller
// provenance: checking the source never upgrades it into writer authorization.
function inspectMemoryMigration(root, surface) {
  if (typeof root !== 'string' || !root || root.includes('\0') || root.length > 32768
    || !['decisions', 'lessons'].includes(surface)) return failure('invalid_arguments');
  try {
    const lexicalRoot = path.resolve(root);
    const originalRoot = resolveMemoryParent(lexicalRoot);
    const resolved = resolveStatePaths(lexicalRoot);
    const runtime = createRuntimeCompatibilityReader(lexicalRoot);
    if (!runtime().compatible) return failure('runtime_incompatible');
    const workspace = resolved.workspace.selectedPath;
    const canonical = capture(path.join(workspace, `${surface}.json`), true);
    const legacy = canonical.state === 'absent' ? capture(path.join(workspace, `${surface}.md`), false)
      : { state: 'unknown', reasonCode: 'not_observed', input: null };
    const assessment = assessLegacyMemoryMigration(JSON.stringify({ schemaVersion: 1, surface,
      canonicalState: canonical.state, legacy: { state: legacy.state,
        bytesBase64: legacy.state === 'present' ? legacy.input.bytes.toString('base64') : null } }));
    try {
      const now = resolveStatePaths(lexicalRoot);
      if (!sameResolvedParent(originalRoot, resolveMemoryParent(lexicalRoot))
        || now.projectRoot !== resolved.projectRoot || now.workspace.selectedPath !== workspace
        || now.workspace.status !== resolved.workspace.status) return failure('source_changed');
      if (!runtime().compatible || !createRuntimeCompatibilityReader(lexicalRoot)().compatible) return failure('runtime_changed');
      // File comparisons follow potentially slower Git/layout checks. Neither
      // ordering can make multiple pathname observations atomic.
      for (const record of [canonical, legacy]) if (record.input) assertCheckedFileCurrent(record.input, record.file);
    } catch { return failure('source_recheck_failed'); }
    const sourceRechecked = !!canonical.input && (canonical.state !== 'absent' || !!legacy.input);
    return { schema: RESPONSE_SCHEMA, schemaVersion: 1,
      ok: sourceRechecked && !['blocked', 'incomplete'].includes(assessment.disposition),
      surface, readOnly: true, sourceRechecked, atomicObservation: false,
      approvalGranted: false, writesPerformed: false, maxBytesPerFile: MAX_BYTES,
      canonical: metadata(canonical), legacy: metadata(legacy), assessment };
  } catch { return failure('observation_failed'); }
}

module.exports = { RESPONSE_SCHEMA, failure, inspectMemoryMigration };
