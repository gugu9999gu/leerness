'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');
const { captureCheckedFileInput } = require('./memory-input');

const SCHEMA = 'leerness.history-index/v1';
const MAX_INDEX_BYTES = 1024 * 1024;
const MAX_ENTRIES = 10000;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCES = 256;
const HISTORY_REL = path.join('.leerness', 'archive', 'history');
const INDEX_FILE = 'index.json';
const OPERATION_SCHEMA = 'leerness.history-operation/v1';
const MANIFEST_SCHEMA = 'leerness.history-retention/v1';
const RECEIPT_SCHEMA = 'leerness.history-retention-receipt/v1';
const TASK_ID_RE = /^T-(\d{4,})$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const TERMINAL_STATUS_RE = /^(?:done|dropped)$/;

const fail = (code, message, extra = {}) => { throw Object.assign(new Error(message || code), { code, ...extra }); };
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function _capture(file, maxBytes) {
  try { return captureCheckedFileInput(file, { maxBytes }); }
  catch (error) {
    if (error && error.code === 'E_STORE_LIMIT') fail('history_source_limit', `Retained history exceeds byte limit: ${file}`, { file, maxBytes });
    if (error && error.code === 'E_STORE_CORRUPT') fail('history_source_encoding', `Retained history is not valid UTF-8: ${file}`, { file });
    if (error && /^E_STORE_/.test(error.code || '')) fail('history_source_invalid', `Retained history cannot be read safely: ${file}`, { file, cause: error.code });
    throw error;
  }
}
function _decode(input, file) {
  if (!input.exists || !Buffer.isBuffer(input.bytes)) fail('history_source_missing', `Missing retained history file: ${file}`, { file });
  try { return new TextDecoder('utf-8', { fatal: true }).decode(input.bytes); }
  catch { fail('history_source_encoding', `Retained history is not valid UTF-8: ${file}`, { file }); }
}
function _safePath(root, relative, operationId) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || path.isAbsolute(relative)) fail('history_index_invalid', 'Invalid retained source path');
  const parts = relative.split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) fail('history_index_invalid', 'Invalid retained source path');
  if (parts.length !== 2 || parts[0] !== operationId || !/^[-A-Za-z0-9._]+$/.test(parts[0]) || !/^[-A-Za-z0-9._]+$/.test(parts[1])) {
    fail('history_index_invalid', 'Retained source must be one file below its operation directory');
  }
  const base = path.resolve(root, HISTORY_REL), file = path.resolve(base, ...parts);
  if (path.dirname(file) !== path.resolve(base, operationId)) fail('history_index_invalid', 'Retained source escaped history namespace');
  return file;
}
function inspectHistoryOperation(root) {
  const file = path.resolve(root, '.leerness', 'history-operation.json');
  try { fs.lstatSync(path.dirname(file)); }
  catch (error) { if (error.code === 'ENOENT') return { state: 'absent', file }; throw error; }
  const input = _capture(file, 256 * 1024);
  if (!input.exists) return { state: 'absent', file };
  let value;
  try { value = JSON.parse(_decode(input, file)); }
  catch { fail('history_operation_invalid', 'The history operation record is invalid; preserve it for recovery.', { file }); }
  if (!value || value.schema !== OPERATION_SCHEMA || !['pending', 'complete'].includes(value.state)
    || !['retain', 'restore'].includes(value.action) || !/^retain-[a-f0-9]{24}$/.test(value.operationId || '')
    || !value.manifest || value.manifest.operationId !== value.operationId) {
    fail('history_operation_invalid', 'The history operation record is invalid; preserve it for recovery.', { file });
  }
  return { ...value, file, sha256: sha256(input.bytes) };
}
function inspectHistoryIndex(root) {
  const operation = inspectHistoryOperation(root);
  if (operation.state === 'pending') return Object.freeze({ state: 'incomplete', complete: false,
    entries: [], taskEntries: [], sources: [], indexFile: path.resolve(root, HISTORY_REL, INDEX_FILE),
    reason: 'history_operation_pending', operationId: operation.operationId });
  const stored = _inspectStoredHistoryIndex(root);
  if (operation.state !== 'complete') return stored;
  const incomplete = reason => Object.freeze({ state: 'incomplete', complete: false,
    entries: [], taskEntries: [], sources: [], indexFile: stored.indexFile,
    reason, operationId: operation.operationId });
  // A completed journal is durable evidence that history once existed. Do not
  // reinterpret a lost namespace or a substituted empty index as fresh history.
  if (stored.state !== 'ready') return incomplete('history_completed_index_missing');
  const operationDir = path.resolve(root, HISTORY_REL, operation.operationId);
  let dirStat;
  try { dirStat = fs.lstatSync(operationDir); }
  catch (error) { if (error.code === 'ENOENT') return incomplete('history_operation_archive_missing'); throw error; }
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return incomplete('history_operation_archive_invalid');
  const manifestFile = path.join(operationDir, 'manifest.json');
  const receiptFile = path.join(operationDir, `${operation.action}.json`);
  const manifestInput = _capture(manifestFile, 256 * 1024);
  const receiptInput = _capture(receiptFile, 256 * 1024);
  if (!manifestInput.exists || !receiptInput.exists) return incomplete('history_operation_archive_missing');
  let manifest, receipt;
  try {
    manifest = JSON.parse(_decode(manifestInput, manifestFile));
    receipt = JSON.parse(_decode(receiptInput, receiptFile));
  } catch { return incomplete('history_operation_archive_invalid'); }
  const expectedIndex = operation.action === 'retain' ? 'index-after.json' : 'index-before.json';
  if (!manifest || manifest.schema !== MANIFEST_SCHEMA || manifest.operationId !== operation.operationId
    || !manifest.files || !SHA_RE.test(manifest.files[expectedIndex] || '')
    || !receipt || receipt.schema !== RECEIPT_SCHEMA || receipt.operationId !== operation.operationId
    || receipt.action !== operation.action || receipt.manifestSha256 !== sha256(manifestInput.bytes)) {
    return incomplete('history_operation_archive_invalid');
  }
  if (stored.indexSha256 !== manifest.files[expectedIndex]) return incomplete('history_operation_index_mismatch');
  return stored;
}
// Recovery inspects the stored index while the journal fences ordinary readers.
// Callers must validate the pending operation and both captured file identities.
function _inspectStoredHistoryIndex(root) {
  root = path.resolve(root);
  const dir = path.join(root, HISTORY_REL), indexFile = path.join(dir, INDEX_FILE);
  let dirStat;
  try { dirStat = fs.lstatSync(dir, { bigint: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return Object.freeze({ state: 'absent', complete: true, entries: [], taskEntries: [], sources: [], indexFile });
    throw error;
  }
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) fail('history_index_invalid', `History namespace is not a regular directory: ${dir}`, { file: dir });
  const input = _capture(indexFile, MAX_INDEX_BYTES);
  if (!input.exists) return Object.freeze({ state: 'incomplete', complete: false, entries: [], taskEntries: [], sources: [], indexFile, reason: 'history_index_missing' });
  let parsed;
  try { parsed = JSON.parse(_decode(input, indexFile)); }
  catch (error) { if (error.code) throw error; fail('history_index_invalid', `History index is invalid JSON: ${indexFile}`, { file: indexFile }); }
  if (!parsed || parsed.schema !== SCHEMA || parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > MAX_ENTRIES) {
    fail('history_index_invalid', `History index schema is invalid: ${indexFile}`, { file: indexFile });
  }
  const ids = new Set(), sources = new Set(), sourceDigests = new Map(), entries = [];
  for (const raw of parsed.entries) {
    if (!raw || raw.kind !== 'task' || typeof raw.id !== 'string' || !TASK_ID_RE.test(raw.id)
      || !Number.isSafeInteger(Number(raw.id.slice(2))) || typeof raw.status !== 'string' || !TERMINAL_STATUS_RE.test(raw.status)
      || typeof raw.updated !== 'string' || typeof raw.operationId !== 'string' || !raw.operationId || typeof raw.source !== 'string'
      || typeof raw.sourceSha256 !== 'string' || !SHA_RE.test(raw.sourceSha256)
      || typeof raw.rowSha256 !== 'string' || !SHA_RE.test(raw.rowSha256)) {
      fail('history_index_invalid', `History index contains an invalid task entry: ${indexFile}`, { file: indexFile });
    }
    if (ids.has(raw.id)) fail('history_index_invalid', `History index contains duplicate task id ${raw.id}`, { file: indexFile, taskId: raw.id });
    const sourceFile = _safePath(root, raw.source, raw.operationId);
    if (sourceDigests.has(sourceFile) && sourceDigests.get(sourceFile) !== raw.sourceSha256) {
      fail('history_index_invalid', `History index has conflicting source digests: ${raw.source}`, { file: indexFile });
    }
    ids.add(raw.id); sources.add(sourceFile); sourceDigests.set(sourceFile, raw.sourceSha256);
    entries.push(Object.freeze({ kind: 'task', id: raw.id, status: raw.status, updated: raw.updated, operationId: raw.operationId,
      source: raw.source, sourceFile, sourceSha256: raw.sourceSha256, rowSha256: raw.rowSha256, retained: true }));
  }
  if (sources.size > MAX_SOURCES) fail('history_index_limit', 'History index references too many source files', { maxSources: MAX_SOURCES });
  return Object.freeze({ state: 'ready', complete: true, entries, taskEntries: entries, sources: [...sources], indexFile,
    indexSha256: sha256(input.bytes), indexBytes: input.bytes.length });
}
function _parseTaskLine(line) {
  if (!/^\|\s*T-\d{4,}\s*\|/.test(line)) return null;
  const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(s => String(s).replace(/\\\|/g, '|').trim());
  if (cells.length < 6) return null;
  const [id, status, request, evidence, nextAction, updated] = cells;
  return { id, status, request, evidence, nextAction, updated };
}
function _loadSource(entry, cache) {
  if (cache.has(entry.sourceFile)) return cache.get(entry.sourceFile);
  const input = _capture(entry.sourceFile, MAX_SOURCE_BYTES);
  if (!input.exists) fail('history_source_missing', `Missing retained history source: ${entry.source}`, { taskId: entry.id, file: entry.sourceFile });
  if (sha256(input.bytes) !== entry.sourceSha256) fail('history_source_changed', `Retained history digest mismatch: ${entry.source}`, { taskId: entry.id, file: entry.sourceFile });
  const text = _decode(input, entry.sourceFile), rows = new Map();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const row = _parseTaskLine(line); if (!row) continue;
    if (rows.has(row.id)) fail('history_source_invalid', `Duplicate retained task ${row.id}: ${entry.source}`, { taskId: row.id });
    rows.set(row.id, { row, raw: line, line: index + 1, rowSha256: sha256(Buffer.from(line, 'utf8')) });
  }
  const loaded = Object.freeze({ text, rows, file: entry.sourceFile, relative: entry.source });
  cache.set(entry.sourceFile, loaded); return loaded;
}
function _taskFromEntry(entry, cache) {
  const loaded = _loadSource(entry, cache), found = loaded.rows.get(entry.id);
  if (!found) fail('history_task_missing', `Indexed retained task is missing from source: ${entry.id}`, { taskId: entry.id, file: entry.sourceFile });
  if (found.rowSha256 !== entry.rowSha256) fail('history_task_changed', `Retained task row digest mismatch: ${entry.id}`, { taskId: entry.id, file: entry.sourceFile });
  if (found.row.status !== entry.status || found.row.updated !== entry.updated) fail('history_index_stale', `History index metadata does not match retained task: ${entry.id}`, { taskId: entry.id });
  return Object.freeze({ ...found.row, retained: true, historySource: entry.source, historyOperationId: entry.operationId });
}
function _readyIndex(root) {
  const index = inspectHistoryIndex(root);
  if (!index.complete) fail('history_index_incomplete', `Retained history is incomplete: ${index.reason}. Use context history status and preview-recover before changing it.`, { file: index.indexFile, reason: index.reason, operationId: index.operationId });
  return index;
}
function historyTaskMetadata(root) { return _readyIndex(root).taskEntries.slice(); }
function findArchivedTask(root, id) {
  const entry = _readyIndex(root).taskEntries.find(item => item.id === id);
  return entry ? _taskFromEntry(entry, new Map()) : null;
}
function listArchivedTasks(root, selectedEntries = null) {
  const index = _readyIndex(root);
  const entries = selectedEntries === null ? index.taskEntries : selectedEntries;
  if (!Array.isArray(entries)) fail('history_index_invalid', 'Selected retained task entries must be an array');
  const known = new Map(index.taskEntries.map(entry => [entry.id, entry]));
  const sameEntry = (a, b) => !!a && !!b
    && ['id','status','updated','operationId','source','sourceSha256','rowSha256'].every(key => a[key] === b[key]);
  const normalized = entries.map(entry => {
    const id = entry && entry.id;
    const canonical = id && known.get(id);
    if (!sameEntry(canonical, entry)) fail('history_index_stale', `Selected retained task entry changed in the current index: ${id || '(missing)'}`);
    return canonical;
  });
  const cache = new Map(); return normalized.map(entry => _taskFromEntry(entry, cache));
}
function reservedTaskMax(root) {
  let max = 0;
  for (const entry of historyTaskMetadata(root)) { const match = TASK_ID_RE.exec(entry.id); if (match) max = Math.max(max, Number(match[1])); }
  assertTaskIdCapacity(max);
  return max;
}
function assertTaskIdCapacity(max, count = 1) {
  if (!Number.isSafeInteger(max) || max < 0 || !Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(max + count)) {
    fail('history_id_exhausted', 'Insufficient safe numeric task IDs remain; current tasks were not changed.');
  }
}
function combineTaskRows(activeRows, archivedRows) {
  const out = [], ids = new Set();
  for (const row of [...(activeRows || []), ...(archivedRows || [])]) {
    if (!row || !TASK_ID_RE.test(String(row.id || ''))) continue;
    if (ids.has(row.id)) fail('history_task_duplicate', `Task id exists in both active and retained history: ${row.id}`, { taskId: row.id });
    ids.add(row.id); out.push(row);
  }
  return out;
}
function taskCounts(activeRows, root) {
  const archived = historyTaskMetadata(root), all = combineTaskRows(activeRows, archived), byStatus = {};
  for (const row of all) byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  return { total: all.length, active: (activeRows || []).filter(row => TASK_ID_RE.test(String(row && row.id || ''))).length, retained: archived.length, byStatus };
}
function historyArchiveEntries(root) {
  return historyTaskMetadata(root).map(entry => ({ kind: 'task', id: entry.id, status: entry.status, updated: entry.updated,
    operationId: entry.operationId, source: entry.source, retained: true }));
}
function searchHistory(root, isHit, scoreHits, query, limitPerSource = 5) {
  if (typeof isHit !== 'function' || typeof scoreHits !== 'function') fail('history_search_invalid', 'History search callbacks are required');
  if (!Number.isSafeInteger(limitPerSource) || limitPerSource < 1 || limitPerSource > 100) fail('history_search_invalid', 'History search limit is invalid');
  const index = _readyIndex(root), cache = new Map(), blocks = []; let total = 0;
  const sourceEntries = new Map();
  for (const entry of index.taskEntries) {
    if (!sourceEntries.has(entry.sourceFile)) sourceEntries.set(entry.sourceFile, []);
    sourceEntries.get(entry.sourceFile).push(entry);
  }
  for (const entries of sourceEntries.values()) {
    const loaded = _loadSource(entries[0], cache), raw = [];
    for (const entry of entries) {
      const found = loaded.rows.get(entry.id);
      if (!found) fail('history_task_missing', `Indexed retained task is missing from source: ${entry.id}`, { taskId: entry.id, file: entry.sourceFile });
      if (found.rowSha256 !== entry.rowSha256) fail('history_task_changed', `Retained task row digest mismatch: ${entry.id}`, { taskId: entry.id, file: entry.sourceFile });
      if (found.row.status !== entry.status || found.row.updated !== entry.updated) fail('history_index_stale', `History index metadata does not match retained task: ${entry.id}`, { taskId: entry.id });
      if (isHit(found.raw)) raw.push({ line: found.line, text: found.raw.trim() });
    }
    if (!raw.length) continue;
    const scored = scoreHits(query, raw).sort((a, b) => (b.score - a.score) || (a.line - b.line));
    const top = scored.slice(0, limitPerSource), entry = entries[0];
    blocks.push({ file: path.join('.leerness', 'archive', 'history', entry.source).replace(/\\/g, '/'), top, best: top[0] ? top[0].score : 0 });
    total += raw.length;
  }
  blocks.sort((a, b) => (b.best - a.best) || a.file.localeCompare(b.file));
  return { total, blocks, sourcesScanned: sourceEntries.size, complete: true };
}

module.exports = { SCHEMA, MAX_INDEX_BYTES, MAX_ENTRIES, MAX_SOURCE_BYTES, MAX_SOURCES,
  inspectHistoryIndex, historyTaskMetadata, findArchivedTask, listArchivedTasks, reservedTaskMax,
  combineTaskRows, taskCounts, historyArchiveEntries, searchHistory, assertTaskIdCapacity,
  OPERATION_SCHEMA, inspectHistoryOperation, _inspectStoredHistoryIndex };
