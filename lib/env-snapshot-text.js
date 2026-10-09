'use strict';
const path = require('path');
const { captureTextEdit, assertTextEditCurrent, publishTextEdit, validateText } = require('./managed-text');
const { withStateLock } = require('./state-lock');
const { assertWriteAllowed } = require('./io');
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string';
const nullableString = value => value === null || string(value);
const fields = {
  os: { platform: string, type: string, release: string, arch: string, version: nullableString },
  hardware: { cpuCount: Number.isFinite, cpuModel: nullableString, totalMemoryGB: Number.isFinite, freeMemoryGB: Number.isFinite },
  locale: { lang: nullableString, encoding: string }, shell: { name: string }, node: { version: string, path: nullableString }
};
const toolFields = { version: nullableString, path: nullableString };
const dependencyFields = { command: string, usedBy: string, foundInPath: value => typeof value === 'boolean' };
const dependencyKey = value => JSON.stringify([value.command, value.usedBy]);
const invalid = (file, reason) => Object.assign(new Error(`Environment snapshot ${reason}: ${file}. Preserve the original and check it before retrying.`), { code: 'E_ENV_SNAPSHOT_INVALID' });
function validateRecord(value, schema, file) {
  if (!object(value) || Object.entries(schema).some(([key, test]) => own(value, key) && !test(value[key]))) throw invalid(file, 'has incompatible generated fields');
}
function validateSnapshot(value, file) {
  validateRecord(value, { capturedAt: v => string(v) && Number.isFinite(Date.parse(v)), leernessVersion: string }, file);
  for (const [key, schema] of Object.entries(fields)) if (own(value, key)) validateRecord(value[key], schema, file);
  if (own(value, 'tools')) {
    if (!object(value.tools)) throw invalid(file, 'requires an object of tools');
    for (const tool of Object.values(value.tools)) validateRecord(tool, toolFields, file);
  }
  if (own(value, 'scriptDependencies')) {
    if (!Array.isArray(value.scriptDependencies)) throw invalid(file, 'requires a dependency array');
    const seen = new Set();
    for (const dep of value.scriptDependencies) {
      validateRecord(dep, dependencyFields, file);
      if (Object.keys(dependencyFields).some(key => !own(dep, key)) || seen.has(dependencyKey(dep))) throw invalid(file, 'has incomplete or ambiguous dependency rows');
      seen.add(dependencyKey(dep));
    }
  }
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'string') validateText(item, file);
    else if (typeof item === 'number' && !Number.isFinite(item)) throw invalid(file, 'has a non-finite metadata number');
    else if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) { validateText(key, file);pending.push(child); }
  }
}
function mergeCollection(previous, current, schema, file) {
  const next = new Map(current);
  for (const [key, value] of previous) {
    if (!next.has(key) && Object.keys(value).some(field => !own(schema, field))) throw invalid(file, 'would remove an annotated tool or dependency; move its notes to top-level metadata first');
    if (next.has(key)) next.set(key, { ...value, ...next.get(key) });
  }
  return next;
}
function mergeSnapshot(previous, current, file) {
  const merged = { ...previous, ...current };
  for (const key of Object.keys(fields)) merged[key] = { ...previous[key], ...current[key] };
  merged.tools = Object.fromEntries(mergeCollection(Object.entries(previous.tools || {}), Object.entries(current.tools), toolFields, file));
  const dependencies = values => values.map(value => [dependencyKey(value), value]);
  merged.scriptDependencies = [...mergeCollection(dependencies(previous.scriptDependencies || []), dependencies(current.scriptDependencies), dependencyFields, file).values()];
  return merged;
}
function writeEnvironmentSnapshot(root, collect, compare, { onlyChanges = false } = {}) {
  const file = path.resolve(root, '.leerness/environment.json');
  let phase = 'permission', published = false;
  try {
    assertWriteAllowed(file);phase = 'lock';
    return withStateLock(file, () => {
      phase = 'read';const input = captureTextEdit(file);
      phase = 'parse';let previous = null;
      if (input.exists) {
        try { previous = JSON.parse(input.text); } catch { throw invalid(file, 'has malformed JSON'); }
        validateSnapshot(previous, file);
      }
      phase = 'detect';const snapshot = collect(root);validateSnapshot(snapshot, file);
      phase = 'compare';const diff = compare(previous, snapshot);
      if (onlyChanges && previous && !diff.changes.length && !diff.missing.length) {
        phase = 'source-check';assertTextEditCurrent(input, file, input.text);
        phase = 'lock-release';return { snapshot, diff, persisted: false };
      }
      phase = 'candidate';const merged = mergeSnapshot(previous || {}, snapshot, file);
      const eol = (input.text.match(/\r?\n/) || ['\n'])[0];
      const candidate = (JSON.stringify(merged, null, 2) + '\n').replace(/\n/g, eol);
      phase = 'publication';published = publishTextEdit(input, file, candidate).published;
      phase = 'lock-release';return { snapshot, diff, persisted: true };
    });
  } catch (error) {
    error.environmentSnapshotStorage = { file, phase: error.lockReleaseError || /LOCK_RELEASE/.test(error.code || '') ? 'lock-release' : phase };
    if (published) error.outputPublished = true;
    throw error;
  }
}
module.exports = { writeEnvironmentSnapshot };
