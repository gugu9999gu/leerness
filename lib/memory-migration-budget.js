'use strict';

// ML-01 internal counter for the fixed, string/null records produced by the
// legacy parsers. It counts the current writer format without building outputs.
const { _lineSafe, _renderDecisionsMd, _renderLessonsMd } = require('./pure-utils');
const { jsonStringBytes } = require('./memory-json-size');
const FIELDS = Object.freeze({
  decisions: ['date', 'title', 'decision', 'reason', 'alternatives', 'impact'],
  lessons: ['date', 'text', 'tag']
});

function* projectionParts(surface, entry) {
  if (surface === 'lessons') {
    yield '\n### '; yield _lineSafe(entry.date); yield '\n- Lesson: ';
    yield _lineSafe(entry.text); yield '\n';
    if (entry.tag) { yield '- Tag: '; yield _lineSafe(entry.tag); yield '\n'; }
    return;
  }
  yield '\n### ';
  if (entry.date) { yield _lineSafe(entry.date); yield ' — '; }
  yield _lineSafe(entry.title); yield '\n';
  for (const [name, key] of [['Decision', 'decision'], ['Reason', 'reason'], ['Alternatives', 'alternatives'], ['Impact', 'impact']]) {
    yield `- ${name}:`;
    const value = _lineSafe(entry[key] || '');
    if (value) { yield ' '; yield value; }
    yield '\n';
  }
}

const measureLegacyCandidate = (surface, entries, maxOutputBytes) => {
  const fields = FIELDS[surface];
  const preamble = surface === 'decisions' ? _renderDecisionsMd([]) : _renderLessonsMd([]);
  // Pretty JSON array delimiters, separators, and the writer's final newline.
  let canonicalBytes = entries.length ? 5 + 2 * (entries.length - 1) : 3;
  let projectionBytes = Buffer.byteLength(preamble);
  if (canonicalBytes + projectionBytes > maxOutputBytes) return null;
  for (const entry of entries) {
    canonicalBytes += 7; // "  {\n" and "  }"
    for (let index = 0; index < fields.length; index++) {
      const key = fields[index];
      const value = entry[key];
      canonicalBytes += 4 + jsonStringBytes(key) + 2
        + (value === null ? 4 : jsonStringBytes(value))
        + (index < fields.length - 1 ? 1 : 0) + 1;
      if (canonicalBytes + projectionBytes > maxOutputBytes) return null;
    }
    for (const part of projectionParts(surface, entry)) {
      projectionBytes += Buffer.byteLength(part);
      if (canonicalBytes + projectionBytes > maxOutputBytes) return null;
    }
  }
  return { canonicalBytes, projectionBytes };
};

module.exports = { measureLegacyCandidate, projectionParts };
