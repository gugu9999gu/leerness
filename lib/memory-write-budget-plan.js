'use strict';

const { TextDecoder } = require('util');
const { assessMemoryCandidateBudget } = require('./memory-candidate-budget');
const { parseFootprintLimits } = require('./memory-footprint-capture');
const { projectionParts } = require('./memory-migration-budget');
const { _renderDecisionsMd, _renderLessonsMd, _memoryPreambleLanguages } = require('./pure-utils');
const MIB4 = 4 * 1024 * 1024;
const ARRAY_CAPS = { maxInputBytes: MIB4, maxItems: 10000, maxItemBytes: MIB4,
  maxCanonicalBytes: MIB4, maxProjectionBytes: MIB4, maxDepth: 64, maxNodes: 100000 };
const OPERATION_CAPS = { maxArchiveInputBytes: MIB4, maxArchiveBytes: Number.MAX_SAFE_INTEGER,
  maxProjectionBytes: Number.MAX_SAFE_INTEGER, maxFinalPathBytes: Number.MAX_SAFE_INTEGER,
  maxNormalPeakPathBytes: Number.MAX_SAFE_INTEGER };
class WriteBudgetError extends Error {
  constructor(code, phase, disposition = 'unsupported') { super(code); this.code = code; this.phase = phase; this.disposition = disposition; }
}
const fail = (code, phase, disposition) => { throw new WriteBudgetError(code,phase,disposition); };
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === expected.length && expected.every(k => Object.hasOwn(value,k));
function parseEnvelope(text, maxBytes, phase) {
  if (typeof text !== 'string') fail('serialized_json_required',phase);
  if (text.length > maxBytes || Buffer.byteLength(text) > maxBytes) fail('envelope_bytes_exceeded',phase,'exceeded');
  try { return JSON.parse(text); } catch { fail('json_invalid',phase); }
}
function parseWriteLimits(text) {
  const limits = parseEnvelope(text,4096,'limits');
  if (!keys(limits,['observation','source','candidate','operation'])) fail('limits_invalid','limits');
  try { parseFootprintLimits(JSON.stringify(limits.observation)); } catch { fail('limits_invalid','limits'); }
  for (const [name, caps] of [['source',ARRAY_CAPS],['candidate',ARRAY_CAPS],['operation',OPERATION_CAPS]]) {
    const value = limits[name];
    if (!keys(value,Object.keys(caps)) || !Object.keys(caps).every(k => Number.isSafeInteger(value[k]) && value[k] >= 0 && value[k] <= caps[k])) fail('limits_invalid','limits');
  }
  return limits;
}
function parseWriteOperation(text, limits) {
  // Escaped archive text may occupy more bytes in the JSON envelope than on disk.
  const operation = parseEnvelope(text,Math.min(MIB4,6 * limits.maxArchiveInputBytes + 128),'operation');
  if (!keys(operation,['kind','archiveText']) || !['update','drop','restore'].includes(operation.kind)) fail('operation_invalid','operation');
  if (operation.kind === 'update') {
    if (operation.archiveText !== null) fail('operation_invalid','operation');
  } else {
    if (typeof operation.archiveText !== 'string') fail('operation_invalid','operation');
    if (operation.archiveText.length > limits.maxArchiveInputBytes
      || Buffer.byteLength(operation.archiveText) > limits.maxArchiveInputBytes) fail('archive_input_bytes_exceeded','operation','exceeded');
  }
  return operation;
}
function measureArray(surface, text, limits, phase, language = 'ko') {
  const result = assessMemoryCandidateBudget(surface,text,JSON.stringify(limits),language);
  if (result.disposition !== 'within-declared-budget') fail(result.reasonCodes[0],phase,result.disposition);
  return result;
}
function decode(bytes, phase, preserveBom = false) {
  try { return new TextDecoder('utf-8',{ fatal: true, ignoreBOM: preserveBom }).decode(bytes); }
  catch { fail('utf8_invalid',phase); }
}
// language: the header the writer renders (memoryDocumentLanguage). Measuring the source with the Korean header
// misjudged English projections at exact limits (cross-model review 2026-09-30: decisions 181 vs 183 bytes).
function measureWriteSource(surface, snapshots, limits, language = 'ko') {
  const { canonical, projection } = snapshots;
  if (!canonical.exists && projection.exists) fail('legacy_migration_required','source');
  const text = canonical.exists ? decode(canonical.bytes,'source') : '[]';
  const assessment = measureArray(surface,text,limits,'source',language);
  let suffixBytes = 0;
  if (projection.exists) {
    const current = decode(projection.bytes,'projection',true);
    // T-0318: any known header variant is the generated header (the writer replaces it with the project's).
    const header = _memoryPreambleLanguages('ko').map(lang => surface === 'decisions' ? _renderDecisionsMd([],lang) : _renderLessonsMd([],lang))
      .find(variant => current.startsWith(variant));
    let cursor = 0;
    function match(part) {
      if (part === undefined || !current.startsWith(part,cursor)) fail('projection_diverged','projection');
      cursor += part.length;
    }
    match(header);
    for (const entry of JSON.parse(text)) for (const part of projectionParts(surface,entry)) match(part);
    suffixBytes = Buffer.byteLength(current.slice(cursor));
  }
  return { assessment, suffixBytes, kind: canonical.exists ? 'canonical' : 'empty' };
}
const exact = value => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n) fail('size_unrepresentable','operation');
  return Number(value);
};
function measurePublicationCost(observed, candidate, suffixBytes, operation, limits, backend) {
  if (!['windows-replace','posix-link'].includes(backend)) fail('publication_backend_unsupported','operation');
  if (operation.kind === 'restore') {
    if (observed.files.archive.state !== 'present') fail('archive_absent','archive');
  }
  const next = { canonical: candidate.measurements.canonicalBytes,
    projection: exact(BigInt(candidate.measurements.projectionBytes) + BigInt(suffixBytes)),
    archive: operation.kind === 'update' ? observed.files.archive.bytes
      : exact(BigInt(Buffer.byteLength(operation.archiveText)) + (operation.kind === 'drop' ? BigInt(observed.files.archive.bytes) : 0n)) };
  if (next.projection > limits.maxProjectionBytes) fail('projection_bytes_exceeded','operation','exceeded');
  if (next.archive > limits.maxArchiveBytes) fail('archive_bytes_exceeded','operation','exceeded');
  const order = operation.kind === 'drop' ? ['archive','canonical','projection']
    : operation.kind === 'restore' ? ['canonical','projection','archive'] : ['canonical','projection'];
  let total = BigInt(observed.totalPathBytes), peak = total;
  const stages = [];
  for (const role of order) {
    const previous = observed.files[role], bytes = BigInt(next[role]);
    const aliases = previous.state === 'absent' || backend === 'posix-link' ? 2n : 1n;
    const stagePeak = total + bytes * aliases;
    total += bytes - BigInt(previous.bytes);
    if (stagePeak > peak) peak = stagePeak;
    stages.push({ role, previousState: previous.state, previousBytes: previous.bytes,
      nextBytes: next[role], peakPathBytes: exact(stagePeak), afterPathBytes: exact(total) });
  }
  const finalPathBytes = exact(total), normalPeakPathBytes = exact(peak);
  if (finalPathBytes > limits.maxFinalPathBytes) fail('final_path_bytes_exceeded','operation','exceeded');
  if (normalPeakPathBytes > limits.maxNormalPeakPathBytes) fail('normal_peak_path_bytes_exceeded','operation','exceeded');
  return { next, stages, finalPathBytes, normalPeakPathBytes, publicationBackend: backend,
    publicationAssumption: 'all-listed-stages-publish', unchangedOutputsMaySkipPublication: true };
}

module.exports = { WriteBudgetError, parseWriteLimits, parseWriteOperation, measureArray,
  measureWriteSource, measurePublicationCost, decode };
