'use strict';
const { _decisionsFromMd, _parseLessonEntries } = require('./pure-utils');
const { assertMemoryItems } = require('./memory-items');
const { nestingDepth } = require('./memory-json-size');
const MAX_ENTRIES = 10000;
const SELECTED_PER_SURFACE = 2;
const SOURCES = Object.freeze(['decisions', 'lessons'].flatMap(surface => ['json', 'markdown'].map(format => Object.freeze({
  id: `memory:${surface}:${format}`, file: `.leerness/${surface}.${format === 'json' ? 'json' : 'md'}`, role: 'memory', surface, format,
}))));
const fail = code => { throw Object.assign(new Error(code), { code }); };
function validateQuery(query) {
  if (query !== null && (typeof query !== 'string' || !query.trim() || Buffer.byteLength(query, 'utf8') > 256 || /[\u0000-\u001f]/.test(query))) fail('invalid_memory_query');
}
function captureMemory(read, task, query = null) {
  validateQuery(query);
  const sources = [], groups = [], counts = [], needle = query === null ? null : query.toLowerCase();
  for (const surface of ['decisions', 'lessons']) {
    const canonical = read(SOURCES.find(s => s.surface === surface && s.format === 'json'));
    sources.push(canonical);
    let selected = canonical;
    if (!canonical.input.exists) {
      selected = read(SOURCES.find(s => s.surface === surface && s.format === 'markdown'));
      sources.push(selected);
    }
    if (!selected.input.exists) {
      counts.push({ surface, state: 'absent', matched: 0, selected: 0 });
      continue;
    }
    let entries;
    if (selected.format === 'json') {
      if (nestingDepth(selected.text, 64) === null) fail('memory_source_invalid');
      try { entries = JSON.parse(selected.text.replace(/^\ufeff/, '')); } catch { fail('memory_source_invalid'); }
    } else entries = surface === 'decisions' ? _decisionsFromMd(selected.text) : _parseLessonEntries(selected.text);
    try { assertMemoryItems(surface, entries); } catch { fail('memory_source_invalid'); }
    if (entries.length > MAX_ENTRIES) fail('memory_source_limit');
    const matches = [];
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      const text = Object.values(entry).filter(value => typeof value === 'string').join('\n');
      const hit = needle !== null ? text.toLowerCase().includes(needle)
        : !!task && (text.match(/\b(?:T|M|D|R|UR|F|P)-\d{3,32}\b/g) || []).includes(task.id);
      if (hit) matches.push({ index, value: entry });
    }
    counts.push({ surface, state: selected.format, matched: matches.length, selected: Math.min(matches.length, SELECTED_PER_SURFACE) });
    if (matches.length) groups.push({ id: selected.id, sourceRef: { id: selected.id, revision: selected.meta.sha256 },
      representation: 'parsed-entry-values', indexScope: 'source-revision-only', entries: matches.slice(0, SELECTED_PER_SURFACE) });
  }
  return { sources, groups, selection: { method: query === null ? 'exact-task-reference' : 'literal-case-insensitive-query',
    perSurfaceLimit: SELECTED_PER_SURFACE, counts, allMatchesSelected: counts.every(row => row.matched === row.selected) } };
}
module.exports = { SOURCES, captureMemory, validateQuery };
