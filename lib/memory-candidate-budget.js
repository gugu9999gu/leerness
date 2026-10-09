'use strict';

// Caller-supplied candidate diagnostic only. No writer defaults, filesystem,
// operation planning, original-byte verification, retention or execution grant.
const { assertMemoryItems } = require('./memory-items');
const { measureParsedMemoryJson, nestingDepth } = require('./memory-json-size');
const { projectionParts } = require('./memory-migration-budget');
const { _renderDecisionsMd, _renderLessonsMd } = require('./pure-utils');
const LIMIT_KEYS = ['maxInputBytes','maxItems','maxItemBytes','maxCanonicalBytes','maxProjectionBytes','maxDepth','maxNodes'];
const LIMIT_CODES = new Set(['item_bytes_exceeded','canonical_bytes_exceeded','nodes_exceeded']);
class MemoryBudgetInputError extends Error {
  constructor(code) { super('Memory candidate budget input: ' + code); this.name = 'MemoryBudgetInputError'; this.code = code; }
}
const fail = code => { throw new MemoryBudgetInputError(code); };
const parseLimits = text => {
  if (typeof text !== 'string') fail('serialized_limits_required');
  // Metadata envelope guard, not a memory writer size policy.
  if (text.length > 2048 || Buffer.byteLength(text) > 2048) fail('limits_envelope_too_large');
  let limits; try { limits = JSON.parse(text); } catch { fail('limits_invalid'); }
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)
    || Object.keys(limits).length !== LIMIT_KEYS.length
    || !LIMIT_KEYS.every(key => Object.hasOwn(limits,key) && Number.isSafeInteger(limits[key]) && limits[key] >= 0)) fail('limits_invalid');
  return limits;
};
// T-0318: `language` selects the generated header the writer will use (caller-supplied, default Korean).
const assessMemoryCandidateBudget = (surface, text, limitsJson, language = 'ko') => {
  if (surface !== 'decisions' && surface !== 'lessons') fail('surface_unsupported');
  if (typeof text !== 'string') fail('serialized_json_required');
  const limits = parseLimits(limitsJson);
  let inputBytes = null, itemCount = null;
  const result = (disposition, reason, measurements = null, index = null, field = null) => ({
    schemaVersion: 1, surface, disposition, reasonCodes: [reason], inputBytes, itemCount, measurements, index, field,
    sourceVerified: false, approvalGranted: false, writesPerformed: false,
    projectionScope: 'generated-only', retentionBytes: null,
  });
  if (text.length > limits.maxInputBytes) return result('exceeded','input_bytes_exceeded');
  inputBytes = Buffer.byteLength(text);
  if (inputBytes > limits.maxInputBytes) return result('exceeded','input_bytes_exceeded');
  const depth = nestingDepth(text,limits.maxDepth);
  if (depth === null) return result('exceeded','depth_exceeded');
  let entries; try { entries = JSON.parse(text); } catch { return result('unsupported','json_invalid'); }
  if (!Array.isArray(entries)) return result('unsupported','array_required');
  itemCount = entries.length;
  if (itemCount > limits.maxItems) return result('exceeded','items_exceeded');
  let measured;
  try { measured = measureParsedMemoryJson(entries,limits); assertMemoryItems(surface,entries); }
  catch (error) {
    if (LIMIT_CODES.has(error.code)) return result('exceeded',error.code,null,error.index);
    if (error.code === 'E_STORE_ITEM_UNSUPPORTED') return result('unsupported','item_unsupported',null,error.index,error.field);
    throw error;
  }
  const render = surface === 'decisions' ? _renderDecisionsMd : _renderLessonsMd;
  let projectionBytes = Buffer.byteLength(render([], language));
  if (projectionBytes > limits.maxProjectionBytes) return result('exceeded','projection_bytes_exceeded');
  for (let index = 0; index < entries.length; index++) {
    for (const part of projectionParts(surface,entries[index])) {
      const bytes = Buffer.byteLength(part);
      if (bytes > limits.maxProjectionBytes - projectionBytes) return result('exceeded','projection_bytes_exceeded',null,index);
      projectionBytes += bytes;
    }
  }
  return result('within-declared-budget','candidate_measured',{ ...measured, projectionBytes, depth });
};

module.exports = { assessMemoryCandidateBudget, MemoryBudgetInputError };
