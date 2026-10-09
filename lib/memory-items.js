'use strict';

// Operation preflight for parsed memory values. No coercion, filtering, IDs,
// size/count policy, raw-JSON fidelity claim, or changes to read-only loaders.
const fields = {
  decisions: ['date', 'title', 'decision', 'reason', 'alternatives', 'impact'],
  lessons: ['date', 'text', 'tag'],
};
function unsupported(surface, index, field) {
  throw Object.assign(new Error('Unsupported memory item shape — 원본을 보존하고 항목 형식을 확인한 뒤 재시도하세요'),
    { code: 'E_STORE_ITEM_UNSUPPORTED', surface, index, field });
}
function assertMemoryItems(surface, entries) {
  if (typeof surface !== 'string' || !Object.hasOwn(fields, surface)) unsupported(null, null, null);
  if (!Array.isArray(entries)) unsupported(surface, null, null);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(entry))) unsupported(surface, index, null);
    for (const field of fields[surface]) {
      const descriptor = Object.getOwnPropertyDescriptor(entry, field);
      if (!descriptor) continue;
      if (!Object.hasOwn(descriptor, 'value') || (descriptor.value !== null && typeof descriptor.value !== 'string')) {
        unsupported(surface, index, field);
      }
    }
  }
  return entries;
}
module.exports = { assertMemoryItems };
