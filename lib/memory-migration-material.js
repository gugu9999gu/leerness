'use strict';

const crypto = require('crypto');
const { TextDecoder } = require('util');
const { assessLegacyMemoryMigration, MAX_LEGACY_BYTES, MAX_OUTPUT_BYTES } = require('./memory-migration-plan');
const { _decisionsFromMd, _parseLessonEntries, _renderDecisionsMd, _renderLessonsMd } = require('./pure-utils');
const OPERATION_ID = /^[a-f0-9]{32}$/;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function material(surface, operationId, raw) {
  if (!['decisions', 'lessons'].includes(surface) || typeof operationId !== 'string' || !OPERATION_ID.test(operationId)
    || !Buffer.isBuffer(raw) || raw.length > MAX_LEGACY_BYTES) fail('migration_input_invalid');
  const assessment = assessLegacyMemoryMigration(JSON.stringify({ schemaVersion: 1, surface,
    canonicalState: 'absent', legacy: { state: 'present', bytesBase64: raw.toString('base64') } }));
  if (assessment.disposition !== 'candidate-requires-raw-retention') fail('migration_not_required_or_supported');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  const entries = surface === 'decisions' ? _decisionsFromMd(text) : _parseLessonEntries(text);
  const canonical = Buffer.from(JSON.stringify(entries, null, 2) + '\n');
  const generated = surface === 'decisions' ? _renderDecisionsMd(entries) : _renderLessonsMd(entries);
  // A fixed inert link, not the original record-bearing text: re-parsing this
  // projection must not duplicate source records. Normal writers retain suffixes.
  const projection = Buffer.from(generated + `\n<!-- leerness-memory-migration:${operationId} -->\n`
    + `[Original Markdown](archive/memory-migrations/${operationId}/source.md)\n`);
  if (canonical.length + projection.length > MAX_OUTPUT_BYTES) fail('migration_output_budget');
  return { raw, canonical, projection, count: entries.length };
}
const describeBytes = bytes => ({ bytes: bytes.length, sha256: sha256(bytes) });
module.exports = { OPERATION_ID, sha256, fail, material, describeBytes };
