'use strict';

// ML-01: caller-supplied observations only. No filesystem observation, candidate
// payload export, execution authority, writer policy, or retained backup.
const { TextDecoder } = require('node:util');
const { _decisionsFromMd, _parseLessonEntries, _renderDecisionsMd, _renderLessonsMd } = require('./pure-utils');
const { measureLegacyCandidate } = require('./memory-migration-budget');

const MAX_LEGACY_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_ENVELOPE_BYTES = Math.ceil(MAX_LEGACY_BYTES / 3) * 4 + 4096;
// Existing decision fence removal may rescan the remainder for each opener.
// This conservative work estimate bounds that path without changing its parser.
const MAX_FENCE_SCAN_UNITS = 32 * 1024 * 1024;
const CANONICAL_STATES = ['present', 'absent', 'corrupt', 'unreadable', 'unsupported', 'unknown'];
const LEGACY_STATES = ['present', 'absent', 'unreadable', 'unsupported', 'unknown'];

class MemoryMigrationInputError extends Error {
  constructor(code) {
    super(`Memory migration input: ${code}`); // Fixed code, never input/parser text.
    this.name = 'MemoryMigrationInputError';
    this.code = code;
  }
}
const fail = code => { throw new MemoryMigrationInputError(code); };
const hasExactKeys = (value, keys) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));

const decodeEnvelope = text => {
  if (typeof text !== 'string') fail('serialized_json_required');
  if (text.length > MAX_ENVELOPE_BYTES || Buffer.byteLength(text) > MAX_ENVELOPE_BYTES) fail('envelope_too_large');
  let input;
  try { input = JSON.parse(text); } catch { fail('json_invalid'); }
  if (!hasExactKeys(input, ['schemaVersion', 'surface', 'canonicalState', 'legacy'])) fail('input_shape_invalid');
  if (input.schemaVersion !== 1) fail('schema_unsupported');
  if (!['decisions', 'lessons'].includes(input.surface)) fail('surface_unsupported');
  if (!CANONICAL_STATES.includes(input.canonicalState)) fail('canonical_state_invalid');
  if (!hasExactKeys(input.legacy, ['state', 'bytesBase64']) || !LEGACY_STATES.includes(input.legacy.state)) fail('legacy_shape_invalid');
  if (input.legacy.state === 'present' ? typeof input.legacy.bytesBase64 !== 'string' : input.legacy.bytesBase64 !== null) fail('legacy_bytes_invalid');
  return input;
};

const result = (surface, disposition, reason, metrics = {}) => {
  const report = {
    schemaVersion: 1, surface, disposition, reasonCodes: Object.freeze([reason]),
    inputBytes: null, parsedRecordCount: null,
    candidateCanonicalBytes: null, candidateProjectionBytes: null, rawRetentionBytes: null,
    ...metrics,
    sourceTrust: 'caller-supplied', semanticCoverage: 'unknown',
    sourceVerified: false, approvalGranted: false, writesPerformed: false
  };
  // Only fixed enums, bounded numbers and fixed booleans can enter this report.
  if (Buffer.byteLength(JSON.stringify(report)) > MAX_METADATA_BYTES) fail('metadata_budget_exceeded');
  return Object.freeze(report);
};

const readLegacyBytes = encoded => {
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail('base64_invalid');
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const length = encoded.length / 4 * 3 - padding;
  if (length > MAX_LEGACY_BYTES) return { length, bytes: null };
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) fail('base64_invalid');
  return { length, bytes };
};

const assessText = (surface, text, inputBytes) => {
  // Existing checked input strips one leading BOM for parsing; projection/raw
  // comparison retains it. Budget the same text that will reach that parser.
  const parsedText = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (surface === 'decisions' && parsedText.length) {
    let starts = 0;
    const maxStarts = Math.floor(MAX_FENCE_SCAN_UNITS / parsedText.length);
    for (const _ of parsedText.matchAll(/^```/gm)) {
      if (++starts > maxStarts) return result(surface, 'incomplete', 'parser_budget_exceeded', { inputBytes });
    }
  }
  const entries = surface === 'decisions' ? _decisionsFromMd(parsedText) : _parseLessonEntries(parsedText);
  const common = { inputBytes, parsedRecordCount: entries.length };
  const measured = measureLegacyCandidate(surface, entries, MAX_OUTPUT_BYTES);
  if (!measured) return result(surface, 'incomplete', 'output_budget_exceeded', common);
  // Whole projection allocation happens only after the fixed-format byte count.
  // The canonical JSON payload is never constructed or returned.
  const generated = surface === 'decisions' ? _renderDecisionsMd(entries) : _renderLessonsMd(entries);
  if (Buffer.byteLength(generated) !== measured.projectionBytes) return result(surface, 'incomplete', 'projection_format_changed', common);
  const matchesPrefix = text.startsWith(generated);
  const noRecords = entries.length === 0;
  const projectionBytes = matchesPrefix ? inputBytes
    : noRecords ? measured.projectionBytes + inputBytes : measured.projectionBytes;
  if (measured.canonicalBytes + projectionBytes > MAX_OUTPUT_BYTES) return result(surface, 'incomplete', 'output_budget_exceeded', common);
  const notNeeded = matchesPrefix || noRecords;
  const reason = matchesPrefix ? 'generated_projection_preservable'
    : noRecords ? 'opaque_text_preservable' : 'raw_retention_required';
  return result(surface, notNeeded ? 'not-needed' : 'candidate-requires-raw-retention', reason, {
    ...common, candidateCanonicalBytes: measured.canonicalBytes,
    candidateProjectionBytes: projectionBytes, rawRetentionBytes: notNeeded ? 0 : inputBytes
  });
};

const assessLegacyMemoryMigration = serializedInput => {
  const input = decodeEnvelope(serializedInput);
  const surface = input.surface;
  if (input.canonicalState === 'present') return result(surface, 'not-applicable', 'canonical_present');
  if (input.canonicalState !== 'absent') return result(surface, 'blocked', `canonical_${input.canonicalState}`);
  if (input.legacy.state === 'absent') return result(surface, 'not-applicable', 'legacy_absent', { inputBytes: 0 });
  if (input.legacy.state !== 'present') return result(surface, 'incomplete', `legacy_${input.legacy.state}`);
  const { bytes, length } = readLegacyBytes(input.legacy.bytesBase64);
  if (bytes === null) return result(surface, 'incomplete', 'input_budget_exceeded', { inputBytes: length });
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return result(surface, 'incomplete', 'legacy_utf8_invalid', { inputBytes: length }); }
  return assessText(surface, text, length);
};

module.exports = {
  MAX_LEGACY_BYTES, MAX_OUTPUT_BYTES, MAX_METADATA_BYTES, MAX_ENVELOPE_BYTES, MAX_FENCE_SCAN_UNITS,
  MemoryMigrationInputError, assessLegacyMemoryMigration
};
