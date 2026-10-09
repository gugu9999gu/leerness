'use strict';

// Internal counters for values produced by JSON.parse, not arbitrary JS objects.
const jsonStringBytes = value => {
  let bytes = 2;
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) bytes += 2;
    else if (code < 32 || (code >= 0xd800 && code <= 0xdfff)) bytes += 6;
    else bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
};
const exceeded = (code, index = null) => { throw Object.assign(new Error(code), { code, index }); };

// Count pretty JSON with indent=2 and a final newline, plus each root item's
// compact JSON size. The iterative traversal does not stringify containers.
const measureParsedMemoryJson = (entries, limits, beforeStringify = false) => {
  let canonicalBytes = 1, nodeCount = 0, maxItemBytes = 0;
  let compactBytes = 0;
  const itemBytes = new Array(entries.length).fill(0);
  const stack = [{ value: entries, depth: 0, index: null }];
  const add = (compact, pretty, index) => {
    if (beforeStringify) {
      if (compact > limits.maxInputBytes - compactBytes) exceeded('input_bytes_exceeded', index);
      compactBytes += compact;
    }
    if (index !== null) {
      if (compact > limits.maxItemBytes - itemBytes[index]) exceeded('item_bytes_exceeded', index);
      itemBytes[index] += compact; maxItemBytes = Math.max(maxItemBytes, itemBytes[index]);
    }
    if (pretty > limits.maxCanonicalBytes - canonicalBytes) exceeded('canonical_bytes_exceeded', index);
    canonicalBytes += pretty;
  };
  if (canonicalBytes > limits.maxCanonicalBytes) exceeded('canonical_bytes_exceeded');
  while (stack.length) {
    const { value, depth, index } = stack.pop();
    if (beforeStringify && value !== null && typeof value === 'object' && depth + 1 > limits.maxDepth) exceeded('depth_exceeded', index);
    if (++nodeCount > limits.maxNodes) exceeded('nodes_exceeded', index);
    if (value === null || typeof value !== 'object') {
      const bytes = typeof value === 'string' ? jsonStringBytes(value)
        : value === null || (typeof value === 'number' && !Number.isFinite(value)) ? 4 : String(value).length;
      add(bytes, bytes, index); continue;
    }
    const array = Array.isArray(value), keys = array ? null : Object.keys(value);
    const length = array ? value.length : keys.length;
    // Every pending child consumes at least one value visit. Do not push a
    // wide frontier that already exceeds the caller's traversal budget.
    if (length > limits.maxNodes - nodeCount - stack.length) exceeded('nodes_exceeded', index);
    const compact = 2 + Math.max(0, length - 1);
    const pretty = length ? 4 + 2 * (length - 1) + length * 2 * (depth + 1) + 2 * depth : 2;
    if (!Number.isSafeInteger(pretty)) exceeded('canonical_bytes_exceeded', index);
    add(compact, pretty, index);
    for (let i = length - 1; i >= 0; i--) {
      const key = array ? i : keys[i];
      if (!array) { const bytes = jsonStringBytes(key); add(bytes + 1, bytes + 2, index); }
      stack.push({ value: value[key], depth: depth + 1, index: depth === 0 ? i : index });
    }
  }
  return { canonicalBytes, maxItemBytes, nodeCount };
};

// Lexical guard before JSON.parse; syntax validation remains the parser's job.
const nestingDepth = (text, limit) => {
  let depth = 0, maximum = 0, quoted = false, escaped = false;
  for (const char of text) {
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === '[' || char === '{') { depth++; maximum = Math.max(maximum,depth); if (depth > limit) return null; }
    else if (char === ']' || char === '}') depth--;
  }
  return maximum;
};

module.exports = { jsonStringBytes, measureParsedMemoryJson, nestingDepth };
