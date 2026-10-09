'use strict';

// A recoverable sequence of existing checked publications, not a filesystem
// transaction. The progress lock is also used by the normal task writers.
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const H = require('./history-retention');
const input = require('./memory-input');
const output = require('./memory-output');
const { decodeText, validateText } = require('./managed-text');
const { withStateLock, isStateLockHeld } = require('./state-lock');
const { sameResolvedParent } = require('./memory-parent');

const MANIFEST_SCHEMA = 'leerness.history-retention/v1';
const PREVIEW_SCHEMA = 'leerness.history-retention-preview/v1';
const RECEIPT_SCHEMA = 'leerness.history-retention-receipt/v1';
const OP = /^retain-[a-f0-9]{24}$/;
const SHA = /^[a-f0-9]{64}$/;
const MAX_SELECTION = 500;
const MAX_RECORD_BYTES = 256 * 1024;
const FILES = ['progress-before.md', 'progress-after.md', 'index-before.json', 'index-after.json'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const emptyIndex = () => json({ schema: H.SCHEMA, schemaVersion: 1, entries: [] });
const fail = (code, message, extra = {}) => { throw Object.assign(new Error(message), { code, ...extra }); };
const same = (a, b) => a === null ? b === null : b !== null && a.equals(b);
function text(bytes, file) {
  const decoded = decodeText(bytes, file);
  if (decoded.includes('\0')) fail('history_text_invalid', 'NUL text cannot be retained automatically.', { file });
  return (bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])) ? '\uFEFF' : '') + decoded;
}
function parseJson(bytes, file) {
  try { return JSON.parse(decodeText(bytes, file)); }
  catch { fail('history_record_invalid', 'Invalid history JSON; preserve the record and inspect it.', { file }); }
}
function regularDirectory(dir, create = false) {
  let stat;
  try { stat = fs.lstatSync(dir); }
  catch (error) {
    if (error.code !== 'ENOENT' || !create) throw error;
    fs.mkdirSync(dir);stat = fs.lstatSync(dir);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('history_path_invalid', 'History directories must be regular directories.', { file: dir });
}
function paths(root) {
  root = path.resolve(root);
  try { root = fs.realpathSync(root);regularDirectory(root);regularDirectory(path.join(root, '.leerness')); }
  catch (error) { fail('history_project_invalid', 'Use an existing project with a regular .leerness directory.', { cause: error.code }); }
  const workspace = path.join(root, '.leerness'), archive = path.join(workspace, 'archive');
  const history = path.join(archive, 'history');
  for (const dir of [archive, history]) {
    try { regularDirectory(dir); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { root, workspace, archive, history, progress: path.join(workspace, 'progress-tracker.md'),
    index: path.join(history, 'index.json'), journal: path.join(workspace, 'history-operation.json') };
}
function read(file, limit = H.MAX_SOURCE_BYTES) {
  return input.captureCheckedFileInput(file, { maxBytes: limit });
}
function describe(capture, file) { return capture ? input.describeCheckedFileInput(capture, file) : null; }
function snapshot(p, allowMissingIndex = false) {
  const progress = read(p.progress);
  if (!progress.exists) fail('history_progress_missing', 'No progress tracker exists; no history was changed.');
  text(progress.bytes, p.progress);
  const journal = read(p.journal, MAX_RECORD_BYTES);
  const stored = H._inspectStoredHistoryIndex(p.root);
  if (!stored.complete && !allowMissingIndex) fail('history_index_incomplete', 'A history directory has no complete index. Inspect context history status before changing it.');
  let index = null;
  try { regularDirectory(p.history);index = read(p.index, H.MAX_INDEX_BYTES); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stored.indexSha256 && (!index || sha(index.bytes) !== stored.indexSha256)) fail('history_source_changed', 'The history index changed while it was read.');
  return { p, progress, index, journal, stored, progressBytes: progress.bytes, indexBytes: index && index.exists ? index.bytes : null,
    journalBytes: journal.exists ? journal.bytes : null };
}
function current(s) {
  input.assertCheckedFileCurrent(s.progress, s.p.progress);
  input.assertCheckedFileCurrent(s.journal, s.p.journal);
  if (s.index) input.assertCheckedFileCurrent(s.index, s.p.index);
  else {
    try { fs.lstatSync(s.p.history); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    fail('history_source_changed', 'History appeared after the preview. Preview again.');
  }
}
function ids(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_SELECTION
    || value.some(id => typeof id !== 'string' || !/^T-\d{4,}$/.test(id)
      || !Number.isSafeInteger(Number(id.slice(2))) || id !== 'T-' + String(Number(id.slice(2))).padStart(4, '0'))
    || new Set(value).size !== value.length) fail('history_selection_invalid', `Select 1..${MAX_SELECTION} distinct canonical T-IDs explicitly.`);
  return value.slice().sort();
}
function reason(value = 'Explicitly selected terminal task history') {
  validateText(value, 'retention reason');
  if (!value.trim() || value.length > 500 || /[\r\n\0]/.test(value)) fail('history_reason_invalid', 'Use one short retention reason (1..500 characters).');
  return value;
}
function selectedRows(bytes, selected, file) {
  const source = text(bytes, file), segments = source.match(/[^\n]*(?:\n|$)/g).filter(Boolean);
  const lines = segments.map(segment => segment.replace(/\r?\n$/, ''));
  const header = '| ID | Status | Request | Evidence | Next Action | Updated |';
  const headers = lines.flatMap((line, i) => line === header ? [i] : []);
  if (!/^leernessRole: progress-tracker\s*$/m.test(source)
    || (source.match(/<!-- leerness:managed -->/g) || []).length !== 1
    || headers.length !== 1 || lines[headers[0] + 1] !== '|---|---|---|---|---|---|') {
    fail('history_table_ambiguous', 'Retention requires one canonical managed progress table. Keep custom or ambiguous tables in place.');
  }
  const start = headers[0] + 2, rows = [], seen = new Set();let end = start;
  while (end < lines.length && /^\|/.test(lines[end])) {
    const raw = lines[end], cells = raw.split(/(?<!\\)\|/).slice(1, -1).map(v => v.replace(/\\\|/g, '|').trim());
    if (!raw.endsWith('|') || cells.length !== 6 || !/^(T|M|D|R|UR|F|P)-\d{3,}$/.test(cells[0]) || seen.has(cells[0])) {
      fail('history_table_ambiguous', 'The task table contains an unsupported or duplicate row; preserve it and fix its format first.');
    }
    seen.add(cells[0]);rows.push({ id: cells[0], status: cells[1], request: cells[2], updated: cells[5], raw, line: end + 1 });end++;
  }
  const outside = lines.slice(0, start).concat(lines.slice(end)).join('\n');
  if (/^\|\s*T-\d+\s*\|/m.test(outside)) fail('history_table_ambiguous', 'Task rows are separated by custom prose or another section; do not move them automatically.');
  const chosen = new Set(selected), matched = rows.filter(row => chosen.has(row.id));
  for (const id of selected) {
    const row = matched.find(item => item.id === id);
    if (!row) fail('history_task_not_active', `${id} is not in the active canonical table. Use its retained operation or select a current row.`);
    if (!/^(done|dropped)$/.test(row.status)) fail('history_task_not_terminal', `${id} is ${row.status}; keep open work and unsupported status aliases in the active tracker.`);
  }
  const protectedText = outside + '\n' + rows.filter(row => !chosen.has(row.id) && !/^(done|dropped)$/.test(row.status)).map(row => row.raw).join('\n');
  for (const hit of protectedText.matchAll(/\bT-\d{4,}\b/g)) {
    if (chosen.has(hit[0])) fail('history_live_reference', `${hit[0]} is referenced by open work or surrounding prose. Keep that task active until the reference is resolved.`);
  }
  const removed = new Set(matched.map(row => row.line - 1));
  const after = Buffer.from(segments.filter((_, i) => !removed.has(i)).join(''), 'utf8');
  return { matched, after };
}
function derive(seed, beforeProgress, beforeIndex) {
  const previewDigest = sha(json(seed)), operationId = 'retain-' + previewDigest.slice(0, 24);
  const selection = selectedRows(beforeProgress, seed.tasks, 'progress-tracker.md');
  const indexValue = parseJson(beforeIndex, 'index-before.json');
  const entries = selection.matched.map(row => ({ kind: 'task', id: row.id, status: row.status, updated: row.updated,
    operationId, source: `${operationId}/progress-before.md`, sourceSha256: sha(beforeProgress), rowSha256: sha(Buffer.from(row.raw)) }));
  if (!indexValue || indexValue.schema !== H.SCHEMA || indexValue.schemaVersion !== 1 || !Array.isArray(indexValue.entries)
    || indexValue.entries.some(entry => seed.tasks.includes(entry.id))) fail('history_index_invalid', 'The saved index cannot accept this selection.');
  const all = [...indexValue.entries, ...entries];
  if (all.length > H.MAX_ENTRIES || new Set(all.map(entry => entry.source)).size > H.MAX_SOURCES) fail('history_index_limit', 'The retained-history index limit would be exceeded; no rows were moved.');
  const indexAfter = json({ ...indexValue, entries: all });
  if (indexAfter.length > H.MAX_INDEX_BYTES) fail('history_index_limit', 'The retained-history index would exceed 1 MiB; no rows were moved.');
  const bytes = [beforeProgress, selection.after, beforeIndex, indexAfter];
  const manifest = { schema: MANIFEST_SCHEMA, operationId, previewDigest, seed,
    files: Object.fromEntries(FILES.map((file, i) => [file, sha(bytes[i])])),
    rows: selection.matched.map(({ raw, request, ...row }) => ({ ...row, rowSha256: sha(Buffer.from(raw)) })) };
  if (json(manifest).length > MAX_RECORD_BYTES - 1024) fail('history_record_limit', 'The operation record is too large; select fewer tasks.');
  return { manifest, bytes, selection: selection.matched };
}
function pending(p) {
  const journal = H.inspectHistoryOperation(p.root);
  if (journal.state === 'pending') fail('history_operation_pending', 'A prior history operation must be recovered before another change.', { operationId: journal.operationId });
  return journal;
}
function prepare(root, options) {
  const p = paths(root);pending(p);
  const tasks = ids(options.tasks), why = reason(options.reason), s = snapshot(p);
  const seed = { schema: PREVIEW_SCHEMA, root: p.root, tasks, reason: why,
    progressSha256: sha(s.progressBytes), indexSha256: s.indexBytes === null ? null : sha(s.indexBytes),
    journalSha256: s.journalBytes === null ? null : sha(s.journalBytes),
    progressIdentity: describe(s.progress, p.progress), indexIdentity: describe(s.index, p.index), journalIdentity: describe(s.journal, p.journal) };
  const built = derive(seed, s.progressBytes, s.indexBytes || emptyIndex());current(s);
  return { ...built, s };
}
function preview(root, options = {}) {
  const b = prepare(root, options), m = b.manifest;
  return { ok: true, action: 'retain', readOnly: true, operationId: m.operationId, expected: m.previewDigest,
    tasks: b.selection.map(row => ({ id: row.id, status: row.status, line: row.line, request: row.request.slice(0, 240) })),
    bytes: { activeBefore: b.bytes[0].length, activeAfter: b.bytes[1].length, retainedOriginal: b.bytes[0].length },
    note: 'Original bytes are retained. Moving rows does not reclaim disk space. Apply must use this exact selection and digest.' };
}
function operationId(value) {
  if (typeof value !== 'string' || !OP.test(value)) fail('history_operation_invalid', 'Use the exact retain- operation ID reported by the preview or status command.');
  return value;
}
function expected(value) {
  if (typeof value !== 'string' || !SHA.test(value)) fail('history_preview_required', 'Run the matching preview and supply its exact --expect digest.');
  return value;
}
function validateManifest(p, m) {
  if (!m || m.schema !== MANIFEST_SCHEMA || !OP.test(m.operationId || '') || !SHA.test(m.previewDigest || '')
    || !m.seed || m.seed.schema !== PREVIEW_SCHEMA || typeof m.seed.root !== 'string'
    || !sameResolvedParent(m.seed.root, p.root) || !SHA.test(m.seed.progressSha256 || '')
    || !(m.seed.indexSha256 === null || SHA.test(m.seed.indexSha256 || ''))
    || !m.files || FILES.some(name => !SHA.test(m.files[name] || '')) || !Array.isArray(m.rows)
    || m.files[FILES[0]] !== m.seed.progressSha256 || (m.seed.indexSha256 !== null && m.files[FILES[2]] !== m.seed.indexSha256)
    || sha(json(m.seed)) !== m.previewDigest || m.operationId !== 'retain-' + m.previewDigest.slice(0, 24)) {
    fail('history_manifest_invalid', 'The operation manifest does not match this project and preview. Preserve its files for inspection.');
  }
  ids(m.seed.tasks);reason(m.seed.reason);return m;
}
function artifact(p, op, name) { return path.join(p.history, operationId(op), name); }
function loadManifest(p, op) {
  const dir = path.join(p.history, operationId(op));regularDirectory(dir);
  const value = read(path.join(dir, 'manifest.json'), MAX_RECORD_BYTES);
  if (!value.exists) fail('history_manifest_missing', 'The retained operation has no complete manifest; use preview-recover for the pending operation.', { operationId: op });
  const m = validateManifest(p, parseJson(value.bytes, 'manifest.json'));
  if (m.operationId !== op) fail('history_manifest_invalid', 'The operation directory and manifest disagree.');
  return m;
}
function captureArtifacts(p, m, live) {
  const captured = [], found = [];
  let directoryPresent = false;
  try { regularDirectory(path.join(p.history, m.operationId));directoryPresent = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of FILES) {
    const file = artifact(p, m.operationId, name), item = directoryPresent ? read(file, name.startsWith('index') ? H.MAX_INDEX_BYTES : H.MAX_SOURCE_BYTES) : null;
    if (item && item.exists && sha(item.bytes) !== m.files[name]) fail('history_artifact_changed', 'A retained original or prepared file changed. It will not be overwritten.', { file });
    captured.push({ file, input: item });found.push(item && item.exists ? item.bytes : null);
  }
  // Preparation can be reconstructed only while both live originals are exact.
  const originalState = sha(live.progressBytes) === m.seed.progressSha256
    && (live.indexBytes === null ? null : sha(live.indexBytes)) === m.seed.indexSha256;
  if (!found[0] && originalState) found[0] = live.progressBytes;
  if (!found[2] && originalState) found[2] = live.indexBytes || emptyIndex();
  if (!found[0] || !found[2]) fail('history_original_missing', 'Recovery needs verified original files. Preserve the current state and inspect the operation directory.', { operationId: m.operationId });
  const built = derive(m.seed, found[0], found[2]);
  if (!json(built.manifest).equals(json(m))) fail('history_manifest_invalid', 'The originals do not reproduce the recorded operation.');
  const manifestFile = artifact(p, m.operationId, 'manifest.json'), manifestInput = directoryPresent ? read(manifestFile, MAX_RECORD_BYTES) : null;
  if (manifestInput && manifestInput.exists && !manifestInput.bytes.equals(json(m))) fail('history_manifest_invalid', 'The retained manifest and operation journal disagree.');
  captured.push({ file: manifestFile, input: manifestInput });
  const missing = captured.some(item => !item.input || !item.input.exists);
  if (missing && !originalState) fail('history_original_missing', 'An interrupted publication is missing recovery artifacts. Do not overwrite the live tracker.', { operationId: m.operationId });
  return { ...built, captured };
}
function assertArtifacts(items) {
  for (const item of items) if (item.input) input.assertCheckedFileCurrent(item.input, item.file);
}
function checkedOutput(file, before, limit) {
  const capture = output.captureMemoryOutput(file, { maxBytes: limit });
  if (!same(capture.exists ? capture.bytes : null, before)) fail('history_source_changed', 'A source changed before publication. Keep the current file and preview again.', { file });
  return capture;
}
function publish(file, before, after, limit = H.MAX_SOURCE_BYTES, capture = null) {
  return output.publishMemoryOutput(capture || checkedOutput(file, before, limit), file, after);
}
function ensureArtifacts(p, b) {
  regularDirectory(p.archive, true);regularDirectory(p.history, true);regularDirectory(path.join(p.history, b.manifest.operationId), true);
  const values = [...b.bytes, json(b.manifest)], names = [...FILES, 'manifest.json'];
  for (let i = 0; i < names.length; i++) {
    const file = artifact(p, b.manifest.operationId, names[i]);
    const limit = names[i] === 'manifest.json' ? MAX_RECORD_BYTES : names[i].startsWith('index') ? H.MAX_INDEX_BYTES : H.MAX_SOURCE_BYTES;
    const prior = output.captureMemoryOutput(file, { maxBytes: limit });
    if (prior.exists && !prior.bytes.equals(values[i])) fail('history_artifact_changed', 'An operation file already has different bytes. It was preserved.', { file });
    output.publishMemoryOutput(prior, file, values[i]);
  }
}
function journalBytes(m, action, state) {
  return json({ schema: H.OPERATION_SCHEMA, state, action, operationId: m.operationId,
    manifest: state === 'pending' ? m : { operationId: m.operationId } });
}
function receipt(m, action) { return json({ schema: RECEIPT_SCHEMA, operationId: m.operationId, action, manifestSha256: sha(json(m)) }); }
function hasReceipt(p, m, action) {
  const file = artifact(p, m.operationId, `${action}.json`), item = read(file, MAX_RECORD_BYTES);
  if (!item.exists) return false;
  if (!item.bytes.equals(receipt(m, action))) fail('history_receipt_invalid', 'A completion receipt is invalid; preserve it for inspection.', { file });
  return true;
}
function result(m, action, replay = false) {
  return { ok: true, state: replay ? `already_${action === 'retain' ? 'retained' : 'restored'}` : action === 'retain' ? 'retained' : 'restored',
    operationId: m.operationId, tasks: m.seed.tasks, replay,
    ...(replay ? { historicalReceipt: true, currentFilesVerified: false } : { originalPreserved: true }),
    note: replay ? 'Historical completion only; no files were changed or later work certified.' : 'Explicit operation completed. Originals and recovery records remain available.' };
}
function finish(p, b, action, s) {
  const m = b.manifest, pendingBytes = journalBytes(m, action, 'pending');
  const progressTarget = action === 'retain' ? b.bytes[1] : b.bytes[0];
  const indexTarget = action === 'retain' ? b.bytes[3] : b.bytes[2];
  const progressOutput = checkedOutput(p.progress, s.progressBytes, H.MAX_SOURCE_BYTES);
  const indexOutput = s.index ? checkedOutput(p.index, s.indexBytes, H.MAX_INDEX_BYTES) : null;
  current(s);if (b.captured) assertArtifacts(b.captured);
  try {
    publish(p.journal, s.journalBytes, pendingBytes, MAX_RECORD_BYTES);
    const journalOutput = checkedOutput(p.journal, pendingBytes, MAX_RECORD_BYTES);
    ensureArtifacts(p, b);
    const saved = captureArtifacts(p, m, s);assertArtifacts(saved.captured);
    output.assertMemoryOutputCurrent(journalOutput, p.journal);
    input.assertCheckedFileCurrent(s.progress, p.progress);
    if (s.index) input.assertCheckedFileCurrent(s.index, p.index);
    const writeIndex = () => publish(p.index, s.indexBytes, indexTarget, H.MAX_INDEX_BYTES, indexOutput);
    const writeProgress = () => publish(p.progress, s.progressBytes, progressTarget, H.MAX_SOURCE_BYTES, progressOutput);
    if (action === 'retain') { writeIndex();writeProgress(); }
    else { writeProgress();writeIndex(); }
    const final = snapshot(p, true);
    if (!same(final.progressBytes, progressTarget) || !same(final.indexBytes, indexTarget)) fail('history_source_changed', 'Publication did not leave the expected files; recovery remains pending.');
    assertArtifacts(saved.captured);
    const receiptFile = artifact(p, m.operationId, `${action}.json`), value = receipt(m, action), old = read(receiptFile, MAX_RECORD_BYTES);
    if (old.exists && !old.bytes.equals(value)) fail('history_receipt_invalid', 'A completion receipt conflicts with this operation.');
    publish(receiptFile, old.exists ? old.bytes : null, value, MAX_RECORD_BYTES);
    input.assertCheckedFileCurrent(final.progress, p.progress);input.assertCheckedFileCurrent(final.index, p.index);
    assertArtifacts(saved.captured);
    publish(p.journal, pendingBytes, journalBytes(m, action, 'complete'), MAX_RECORD_BYTES, journalOutput);
    return result(m, action);
  } catch (error) {
    error.operationId = m.operationId;
    error.recovery = 'Run context history status, then preview-recover and recover with its exact digest. Preserve all recovery files.';
    throw error;
  }
}
function apply(root, options = {}) {
  const ticket = expected(options.expected), tasks = ids(options.tasks), why = reason(options.reason), p = paths(root);
  return withStateLock(p.progress, () => {
    pending(p);
    const op = 'retain-' + ticket.slice(0, 24), dir = path.join(p.history, op);
    if (fs.existsSync(dir)) {
      const m = loadManifest(p, op);
      if (m.previewDigest !== ticket || !json(m.seed.tasks).equals(json(tasks)) || m.seed.reason !== why) fail('history_preview_stale', 'This operation does not match the preview selection.');
      if (hasReceipt(p, m, 'restore')) return result(m, 'restore', true);
      if (hasReceipt(p, m, 'retain')) return result(m, 'retain', true);
      fail('history_operation_incomplete', 'The operation has no completion receipt. Inspect its pending recovery record.', { operationId: op });
    }
    const b = prepare(p.root, { tasks, reason: why });
    if (ticket !== b.manifest.previewDigest) fail('history_preview_stale', 'Source content or identity changed after the preview. Preview again before applying.');
    return finish(p, b, 'retain', b.s);
  });
}
function recoveryPlan(root, op) {
  const p = paths(root), journal = H.inspectHistoryOperation(p.root);operationId(op);
  if (journal.state !== 'pending' || journal.operationId !== op) fail('history_recovery_not_pending', 'There is no pending operation with this ID. Use status to inspect the current record.');
  const m = validateManifest(p, journal.manifest), s = snapshot(p, true), b = captureArtifacts(p, m, s);
  const progressHash = sha(s.progressBytes), indexHash = s.indexBytes === null ? null : sha(s.indexBytes);
  if (![m.files[FILES[0]], m.files[FILES[1]]].includes(progressHash)
    || ![m.seed.indexSha256, m.files[FILES[2]], m.files[FILES[3]]].includes(indexHash)) {
    fail('history_recovery_conflict', 'Current files contain changes outside the recorded operation. They were preserved; inspect the retained originals before choosing a manual reconciliation.', { operationId: op });
  }
  if (journal.action === 'restore' && !hasReceipt(p, m, 'retain')) fail('history_receipt_invalid', 'Restore recovery requires the original retention receipt.');
  const token = sha(json({ action: 'recover', operationId: op, journal: sha(s.journalBytes),
    progressIdentity: describe(s.progress, p.progress), indexIdentity: describe(s.index, p.index), journalIdentity: describe(s.journal, p.journal),
    progressHash, indexHash, artifacts: b.captured.map(item => [path.basename(item.file), describe(item.input, item.file)]) }));
  current(s);assertArtifacts(b.captured);
  return { p, b, s, action: journal.action, token };
}
function previewRecover(root, op) {
  const plan = recoveryPlan(root, op);
  requireRecoveryLockClear(plan.p, op);
  return { ok: true, readOnly: true, action: 'recover', resumes: plan.action, operationId: op, expected: plan.token,
    tasks: plan.b.manifest.seed.tasks, note: 'Finish the recorded operation using verified originals. No unrelated changes are overwritten.' };
}
function requireRecoveryLockClear(p, op) {
  if (isStateLockHeld(p.progress)) return;
  try { fs.lstatSync(p.progress + '.lock'); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  fail('history_lock_recovery_required', 'The progress lock still has a prior owner. Confirm every prior writer has stopped and preserve its lock record through manual lock recovery, then run preview-recover again. A PID or elapsed time alone is not proof.', { operationId: op });
}
function recover(root, options = {}) {
  const p = paths(root), op = operationId(options.operationId), ticket = expected(options.expected);
  requireRecoveryLockClear(p, op);
  return withStateLock(p.progress, () => {
    const journal = H.inspectHistoryOperation(p.root);
    if (journal.state === 'complete' && journal.operationId === op) {
      const m = loadManifest(p, op);
      if (!hasReceipt(p, m, journal.action)) fail('history_receipt_invalid', 'The completed operation receipt is missing.');
      return result(m, journal.action, true);
    }
    const plan = recoveryPlan(p.root, op);
    if (plan.token !== ticket) fail('history_preview_stale', 'Recovery inputs changed after the preview. Preview recovery again.');
    return finish(plan.p, plan.b, plan.action, plan.s);
  });
}
function restorePlan(root, op) {
  const p = paths(root);pending(p);operationId(op);
  const m = loadManifest(p, op), s = snapshot(p), b = captureArtifacts(p, m, s);
  if (!hasReceipt(p, m, 'retain')) fail('history_receipt_invalid', 'A completed retention receipt is required for restoration.');
  if (hasReceipt(p, m, 'restore')) fail('history_already_restored', 'This operation was already restored; no new restore preview is needed.');
  if (!s.indexBytes || sha(s.progressBytes) !== m.files[FILES[1]] || sha(s.indexBytes) !== m.files[FILES[3]]) {
    fail('history_restore_conflict', 'New work or another retention operation changed the current files. Automatic restore would overwrite it and was refused.', { operationId: op });
  }
  const token = sha(json({ action: 'restore', operationId: op, manifest: sha(json(m)),
    progressIdentity: describe(s.progress, p.progress), indexIdentity: describe(s.index, p.index), journalIdentity: describe(s.journal, p.journal) }));
  current(s);assertArtifacts(b.captured);return { p, b, s, token };
}
function previewRestore(root, op) {
  const plan = restorePlan(root, op);
  return { ok: true, readOnly: true, action: 'restore', operationId: op, expected: plan.token,
    tasks: plan.b.manifest.seed.tasks, note: 'Restore the exact original tracker bytes. Any overlapping new work blocks this operation.' };
}
function restore(root, options = {}) {
  const p = paths(root), op = operationId(options.operationId), ticket = expected(options.expected);
  return withStateLock(p.progress, () => {
    pending(p);const m = loadManifest(p, op);
    if (hasReceipt(p, m, 'restore')) return result(m, 'restore', true);
    const plan = restorePlan(p.root, op);
    if (plan.token !== ticket) fail('history_preview_stale', 'Restore inputs changed after the preview. Preview restoration again.');
    return finish(plan.p, plan.b, 'restore', plan.s);
  });
}
function status(root) {
  const p = paths(root), journal = H.inspectHistoryOperation(p.root);
  const history = H.inspectHistoryIndex(p.root);
  let locked = false;try { fs.lstatSync(p.progress + '.lock');locked = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ok: journal.state !== 'pending' && history.complete, state: journal.state, operationId: journal.operationId || null,
    action: journal.action || null, readOnly: true, progressLockPresent: locked,
    historyComplete: history.complete,
    next: journal.state === 'pending' ? (locked ? 'Confirm prior writers have stopped; preserve and manually recover their lock record before preview-recover. No automatic owner-lock removal is performed.' : 'Run preview-recover with this operation ID; preserve all recovery files.')
      : !history.complete ? 'The history index is incomplete. Preserve existing records and inspect the missing index; do not invent an empty history.'
        : 'No pending operation. Use an explicit preview before retaining or restoring history.' };
}
module.exports = { preview, apply, previewRestore, restore, previewRecover, recover, status, MAX_SELECTION };
