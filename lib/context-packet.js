'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { captureCheckedFileInput, assertCheckedFileCurrent } = require('./memory-input');
const { MAX_TEXT_BYTES } = require('./managed-text');
const { createRuntimeCompatibilityReader } = require('./runtime-layout');
const { gitSpawn } = require('./git');
const { parseProgressRows, rawProgressRow, ROW } = require('./progress-rows');
const memory = require('./context-memory');
const { selectNextTask } = require('./session-next');
const MAX_PACKET_BYTES = 8192;
const PAGE_BYTES = 2048;
const TASK_ID = /^(?:T|M|D|R|UR|F|P)-\d{3,32}$/;
const SOURCES = Object.freeze([
  ['tasks', '.leerness/progress-tracker.md', 'selection'],
  ['plan', '.leerness/plan.md', 'selection'],
  ['agents', 'AGENTS.md', 'required'],
  ['workflow', '.leerness/session-workflow.md', 'required'],
  ['routing', '.leerness/context-routing.md', 'required'],
  ['rules', '.leerness/rules.md', 'required'],
  ['guideline', '.leerness/guideline.md', 'required'],
  ['protected', '.leerness/protected-files.md', 'required'],
  ['writeback', '.leerness/writeback-policy.md', 'required'],
  ['anti-lazy', '.leerness/anti-lazy-work-policy.md', 'required'],
  ['source-of-truth', 'SOURCE_OF_TRUTH.md', 'when-present'],
].map(([id, file, role]) => Object.freeze({ id, file, role })));
const snapshots = new WeakMap();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const clone = value => JSON.parse(JSON.stringify(value));
const fits = value => Buffer.byteLength(JSON.stringify(value) + '\n', 'utf8') <= MAX_PACKET_BYTES;
function decode(bytes) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return bytes.toString('utf8'); }
  catch { fail('invalid_utf8'); }
}
function source(root, spec) {
  const file = path.join(root, spec.file);
  const input = captureCheckedFileInput(file, { maxBytes: MAX_TEXT_BYTES });
  return { ...spec, file, input, text: input.exists ? decode(input.bytes) : null,
    meta: { id: spec.id, path: spec.file, state: input.exists ? 'present' : 'missing',
      sha256: input.exists ? hash(input.bytes) : null, byteLength: input.exists ? input.bytes.length : null } };
}
function layoutReader(root) {
  if (typeof root !== 'string' || !root.trim() || /[\u0000-\u001f]/.test(root)) fail('invalid_path');
  const reader = createRuntimeCompatibilityReader(root);
  const report = reader();
  if (!report.compatible || !reader.snapshot) fail('runtime_layout_unavailable');
  root = reader.snapshot.root;
  const stat = fs.lstatSync(path.join(root, '.leerness'));
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('invalid_workspace');
  return { root, reader, layout: { kind: report.observedLayout, scope: report.scope, reasonCode: report.reasonCode } };
}
function gitHead(runtime) {
  if (!runtime.reader.snapshot.git) return { commit: null, status: 'not_a_repository' };
  const result = gitSpawn(['-C', runtime.root, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8', timeout: 2000, maxBuffer: 4096 });
  if (result.error) fail('git_revision_unavailable');
  const oid = String(result.stdout || '').trim();
  if (result.status === 0 && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(oid)) return { commit: oid, status: 'observed' };
  if (result.status !== 0) return { commit: null, status: 'unavailable' };
  fail('git_revision_unavailable');
}
function checkedRows(captured) {
  if (!captured.input.exists) fail('task_source_missing');
  const text = captured.text.replace(/^\ufeff/, '');
  const rows = parseProgressRows(text);
  const candidates = text.split('\n').filter(line => ROW.test(line));
  if (candidates.some(line => line.split(/(?<!\\)\|/).length !== 8) || rows.length !== candidates.length || new Set(rows.map(row => row.id)).size !== rows.length
    || rows.some(row => !TASK_ID.test(row.id))) fail('task_source_invalid');
  return rows;
}
function exactTask(captured, id) {
  const rows = checkedRows(captured);
  if (!rows.some(row => row.id === id)) fail('task_not_found');
  const raw = rawProgressRow(captured.input.bytes, id);
  if (!raw) fail('task_source_invalid');
  return raw;
}

function verify(record) {
  let readBytes = 0, readFiles = 0;
  for (const item of record.sources) {
    const measured = assertCheckedFileCurrent(item.input, item.file);
    readBytes += measured.readBytes;
    readFiles += measured.readFiles;
  }
  const report = record.runtime.reader();
  if (!report.compatible || JSON.stringify({ kind: report.observedLayout, scope: report.scope, reasonCode: report.reasonCode }) !== JSON.stringify(record.runtime.layout)
    || JSON.stringify(gitHead(record.runtime)) !== JSON.stringify(record.head)) fail('source_changed');
  return { scope: 'selected-source-body-reads-including-revalidation',
    readBytes: readBytes + record.sources.reduce((n, s) => n + (s.input.bytes?.length || 0), 0),
    readFiles: record.sources.filter(s => s.input.exists).length,
    readOperations: readFiles + record.sources.filter(s => s.input.exists).length,
    historyBodiesRead: record.sources.filter(s => s.role === 'history-source' && s.input.exists).length, cacheUsed: false };
}
function revision(record) {
  const value = { gitCommit: record.head.commit, gitObservation: record.head.status, layout: record.runtime.layout,
    selectedSources: record.sources.map(s => s.meta), taskRevision: null, resultRef: null };
  return { ...value, selectionDigest: hash(Buffer.from(JSON.stringify(value))) };
}
function retainedTask(runtime, id, sources) {
  if (!/^T-\d{4,}$/.test(id)) return null;
  const retained = require('./history-retention').captureArchivedTask(runtime.root, id);
  if (!retained) return null;
  for (const item of retained.captures) {
    const relative = path.relative(runtime.root, item.file).split(path.sep).join('/');
    const isSource = item.file === retained.sourceFile;
    sources.push({ file: item.file, input: item.input, role: isSource ? 'history-source' : 'history-metadata',
      meta: { id: isSource ? 'history:' + id : 'history-metadata:' + relative, path: relative,
        state: item.input.exists ? 'present' : 'missing', sha256: item.input.exists ? hash(item.input.bytes) : null,
        byteLength: item.input.exists ? item.input.bytes.length : null } });
  }
  return retained;
}
function captureSnapshot(root, { task = null, includeMemory = false, memoryQuery = null } = {}) {
  if (task !== null && (typeof task !== 'string' || !TASK_ID.test(task))) fail('invalid_task');
  if (typeof includeMemory !== 'boolean' || (!includeMemory && memoryQuery !== null)) fail('invalid_arguments');
  memory.validateQuery(memoryQuery);
  const runtime = layoutReader(root), head = gitHead(runtime);
  const sources = SOURCES.map(spec => source(runtime.root, spec));
  const rows = checkedRows(sources[0]);
  if (!sources[1].input.exists) fail('plan_source_missing');
  let selected = task === null ? selectNextTask(rows, sources[1].text)
    : { row: rows.find(row => row.id === task), source: 'explicit-task' };
  let retained = null;
  if (task !== null && !selected.row) {
    retained = retainedTask(runtime, task, sources);
    if (!retained) fail('task_not_found');
    selected = { row: retained.row, source: 'explicit-retained-task' };
  }
  const taskBytes = retained ? retained.rowBytes : selected.row ? exactTask(sources[0], selected.row.id) : null;
  const taskSource = taskBytes ? { id: 'task:' + selected.row.id,
    path: retained ? path.relative(runtime.root, retained.sourceFile).split(path.sep).join('/') : sources[0].meta.path,
    sha256: hash(taskBytes), byteLength: taskBytes.length } : null;
  const selectedMemory = includeMemory ? memory.captureMemory(spec => source(runtime.root, spec), selected.row, memoryQuery) : null;
  if (selectedMemory) sources.push(...selectedMemory.sources);
  const record = { runtime, head, sources, selected, taskSource, selectedMemory };
  const token = Object.freeze({});
  snapshots.set(token, record);
  return token;
}
function renderPacket(snapshot) {
  const record = snapshots.get(snapshot);
  if (!record) fail('invalid_snapshot');
  const measurements = verify(record);
  const required = record.sources.filter(s => s.role === 'required' || (s.role === 'when-present' && s.input.exists));
  const taskId = record.taskSource?.id || null;
  const missingRequiredIds = [...(taskId ? [taskId] : []), ...required.map(s => s.id), ...(record.selectedMemory?.groups.map(g => g.id) || [])];
  const response = { schemaVersion: 1, schema: 'leerness.context-packet/v1', ok: true,
    observedAt: new Date().toISOString(), sourceRevision: revision(record),
    navigationOnly: true, completenessScope: record.selectedMemory ? 'selected-task-listed-policies-and-selected-memory' : 'selected-task-and-listed-policy-sources',
    data: { task: null, taskSource: record.taskSource, selection: record.selected.source, policies: [],
      ...(record.selectedMemory ? { memory: [], memorySelection: record.selectedMemory.selection } : {}) },
    warnings: [...required.filter(s => !s.input.exists).map(s => ({ code: 'source_missing', id: s.id })),
      ...(record.head.status === 'unavailable' ? [{ code: 'git_revision_unavailable' }] : [])],
    complete: false, missingRequiredIds, missingRequiredCount: missingRequiredIds.length, measurements };
  const include = (id, mutate, revert) => {
    const before = response.missingRequiredIds;
    mutate(); response.missingRequiredIds = before.filter(value => value !== id);
    response.missingRequiredCount = response.missingRequiredIds.length;
    response.complete = response.missingRequiredCount === 0 && record.head.status !== 'unavailable';
    if (!fits(response)) {
      revert(); response.missingRequiredIds = before; response.missingRequiredCount = before.length; response.complete = false;
    }
  };
  if (record.selected.row) include(taskId, () => { response.data.task = record.selected.row; }, () => { response.data.task = null; });
  for (const item of required) {
    if (item.input.exists) include(item.id, () => response.data.policies.push({ id: item.id, text: item.text, unabridged: true }), () => response.data.policies.pop());
  }
  for (const group of record.selectedMemory?.groups || []) {
    include(group.id, () => response.data.memory.push(group), () => response.data.memory.pop());
  }
  response.complete = response.missingRequiredCount === 0 && record.head.status !== 'unavailable';
  if (!fits(response)) fail('minimum_packet_too_large');
  return clone(response);
}
function currentPacket(root, options) { return renderPacket(captureSnapshot(root, options)); }
function exactSource(root, { id, revision: expected, offset = 0 } = {}) {
  if (typeof id !== 'string' || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)
    || !Number.isSafeInteger(offset) || offset < 0) fail('invalid_source_request');
  const task = id.startsWith('task:') ? id.slice(5) : null;
  const spec = [...SOURCES, ...memory.SOURCES].find(s => s.id === (task === null ? id : 'tasks'));
  if (!spec || (task !== null && !TASK_ID.test(task))) fail('invalid_source_id');
  const runtime = layoutReader(root), head = gitHead(runtime), captured = source(runtime.root, spec);
  if (!captured.input.exists) fail('source_missing');
  const sources = [captured];
  let bytes, sourcePath = spec.file;
  if (task === null) bytes = captured.input.bytes;
  else if (checkedRows(captured).some(row => row.id === task)) bytes = exactTask(captured, task);
  else {
    const retained = retainedTask(runtime, task, sources);
    if (!retained) fail('task_not_found');
    bytes = retained.rowBytes;
    sourcePath = path.relative(runtime.root, retained.sourceFile).split(path.sep).join('/');
  }
  const digest = hash(bytes);
  if (digest !== expected) fail('source_changed');
  if (offset > bytes.length) fail('invalid_source_offset');
  const end = Math.min(offset + PAGE_BYTES, bytes.length);
  const record = { runtime, head, sources };
  const measurements = verify(record);
  const response = { schemaVersion: 1, schema: 'leerness.context-source/v1', ok: true, observedAt: new Date().toISOString(),
    sourceRevision: revision(record), data: { id, path: sourcePath, sha256: digest, byteLength: bytes.length,
      encoding: 'base64', offset, returnedBytes: end - offset, bytes: bytes.subarray(offset, end).toString('base64'),
      nextOffset: end < bytes.length ? end : null }, warnings: [], complete: end === bytes.length, measurements };
  if (!fits(response)) fail('minimum_packet_too_large');
  return response;
}
const SAFE_CODES = new Set(['invalid_path', 'invalid_workspace', 'invalid_utf8', 'runtime_layout_unavailable', 'git_revision_unavailable',
  'task_source_missing', 'task_source_invalid', 'plan_source_missing', 'task_not_found', 'invalid_task', 'invalid_snapshot',
  'source_missing', 'source_changed', 'invalid_source_request', 'invalid_source_id', 'invalid_source_offset', 'minimum_packet_too_large',
  'invalid_arguments', 'policy_blocked', 'invalid_memory_query', 'memory_source_invalid', 'memory_source_limit',
  'history_source_invalid', 'history_source_changed', 'history_source_encoding', 'history_source_missing', 'history_source_limit',
  'history_index_invalid', 'history_index_incomplete', 'history_index_stale', 'history_index_limit', 'history_task_missing',
  'history_task_changed', 'history_selection_invalid', 'history_operation_invalid']);
function failure(error) {
  const raw = error?.code;
  const code = raw === 'E_STORE_CHANGED' ? 'source_changed' : raw === 'E_STORE_LIMIT' ? 'input_too_large'
    : SAFE_CODES.has(raw) ? raw : 'source_unavailable';
  return { schemaVersion: 1, schema: 'leerness.context-error/v1', ok: false, observedAt: new Date().toISOString(),
    sourceRevision: null, data: null, warnings: [], complete: false, error: { code } };
}
module.exports = { MAX_PACKET_BYTES, PAGE_BYTES, SOURCES, captureSnapshot, renderPacket, currentPacket, exactSource, failure };
