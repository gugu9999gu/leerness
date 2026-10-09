'use strict';

// Operation-local byte observations. A trusted host callback is executable code,
// not a sandboxed provider or an authenticated independent reviewer.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { parseInputJson } = require('./review-checkpoint-transport');
const { captureCheckedFileInput, assertCheckedFileCurrent, describeCheckedFileInput } = require('./memory-input');
const { resolveMemoryParent, sameResolvedParent } = require('./memory-parent');
const { createUiReviewPacket, assessUiReview } = require('./ui-review');

const INPUT_SCHEMA = 'leerness.ui-review-observation-input/v1';
const OUTPUT_SCHEMA = 'leerness.ui-review-observation/v1';
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * MAX_FILE_BYTES;
const KINDS = Object.freeze(['source', 'spec', 'diff', 'render']);
const captures = new WeakMap();
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
class UiReviewObservationError extends Error {
  constructor(code) { super('ui_observation_' + code); this.name = 'UiReviewObservationError'; this.code = 'ui_observation_' + code; }
}
function fail(code) { throw new UiReviewObservationError(code); }
function exact(v, keys) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length
    || keys.some(k => !Object.hasOwn(v, k))) fail('shape_invalid');
}
function freeze(v) {
  if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); }
  return v;
}
function portablePath(v) {
  if (typeof v !== 'string' || !v.length || v.length > 1024) fail('path_invalid');
  const parts = v.split('/');
  if (parts.length > 32 || parts.some(s => !/^[A-Za-z0-9_.-]{1,100}$/.test(s)
    || s === '.' || s === '..' || s.endsWith('.')
    || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(s))) fail('path_invalid');
  return parts;
}
function directory(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('directory_unsupported');
  return { file, stat, resolved: resolveMemoryParent(file) };
}
function checkDirectories(dirs) {
  for (const before of dirs.values()) {
    const now = directory(before.file);
    if (!sameIdentity(before.stat, now.stat) || !sameResolvedParent(before.resolved, now.resolved)) fail('materials_changed');
  }
}
function checkCurrent(record) {
  checkDirectories(record.dirs);
  for (const file of record.files) assertCheckedFileCurrent(file.input, file.file);
  checkDirectories(record.dirs);
}
function safeFailure(error) {
  if (error instanceof UiReviewObservationError) return error;
  // The reused reader's errors contain local paths; never expose its message.
  const code = error && error.code;
  if (code === 'E_STORE_LIMIT') return new UiReviewObservationError('byte_limit');
  if (code === 'E_STORE_CHANGED') return new UiReviewObservationError('materials_changed');
  return new UiReviewObservationError('materials_unavailable');
}

function captureUiReview(root, requestJson) {
  let request, inputJson, packet;
  try {
    request = parseInputJson(requestJson);
    exact(request, ['schema', 'input', 'files']);
    if (request.schema !== INPUT_SCHEMA) fail('schema_invalid');
    inputJson = JSON.stringify(request.input);
    packet = createUiReviewPacket(inputJson);
  } catch (e) { if (e instanceof UiReviewObservationError) throw e; fail('input_invalid'); }
  if (packet.preparation.state !== 'packet-candidate') fail('packet_not_ready');
  if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')) fail('root_invalid');
  const rows = request.input.uiMaterials;
  if (!Array.isArray(request.files) || request.files.length !== rows.length * KINDS.length) fail('membership_invalid');
  const required = new Map(rows.flatMap(row => KINDS.map(kind => [row.taskId + '/' + kind, row[kind + 'Digest']])));
  // Validate the complete request before performing any filesystem I/O.
  const files = request.files.map(f => {
    exact(f, ['taskId', 'kind', 'path']);
    if (typeof f.taskId !== 'string' || !KINDS.includes(f.kind)) fail('membership_invalid');
    const key = f.taskId + '/' + f.kind, expected = required.get(key);
    if (!expected) fail('membership_invalid');
    required.delete(key);
    return { taskId: f.taskId, kind: f.kind, parts: portablePath(f.path), expected };
  });
  if (required.size) fail('membership_invalid');
  files.sort((a, b) => a.taskId + '/' + a.kind < b.taskId + '/' + b.kind ? -1 : 1);
  try {
    const canonicalRoot = path.resolve(root), dirs = new Map();
    dirs.set(canonicalRoot, directory(canonicalRoot));
    for (const f of files) {
      let parent = canonicalRoot;
      for (const part of f.parts.slice(0, -1)) {
        parent = path.join(parent, part);
        if (!dirs.has(parent)) dirs.set(parent, directory(parent));
      }
      f.file = path.join(canonicalRoot, ...f.parts);
    }
    let totalBytes = 0;
    for (const f of files) {
      checkDirectories(dirs);
      f.input = captureCheckedFileInput(f.file, { maxBytes: Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - totalBytes) });
      if (!f.input.exists) fail('material_missing');
      if (digest(f.input.bytes) !== f.expected) fail('digest_mismatch');
      totalBytes += f.input.bytes.length;
    }
    const record = { inputJson, packet, files, dirs };
    checkCurrent(record);
    const selectionDigest = digest(Buffer.from(JSON.stringify([INPUT_SCHEMA, 'selection', dirs.get(canonicalRoot).resolved,
      files.map(f => [f.taskId, f.kind, f.parts.join('/'), f.expected])]), 'utf8'));
    const handle = freeze({ packet, selectionDigest, totalBytes, materials: files.map(f => ({ taskId: f.taskId, kind: f.kind,
      digest: f.expected, byteLength: f.input.bytes.length })) });
    captures.set(handle, record);
    return handle;
  } catch (e) { throw safeFailure(e); }
}

function materialCopies(record) {
  return Object.freeze(record.files.map(f => Object.freeze({ taskId: f.taskId, kind: f.kind,
    digest: f.expected, bytes: Buffer.from(f.input.bytes) })));
}

// Read-only preview of the captured bytes. It neither executes a reviewer nor
// consumes the capture; each caller receives fresh mutable buffer copies.
function readUiReviewMaterialSnapshot(handle) {
  const record = captures.get(handle);
  if (!record) fail('capture_invalid');
  try { checkCurrent(record); return materialCopies(record); }
  catch (error) { throw safeFailure(error); }
}

// Serialized identity is comparison evidence, never a reconstructed capability.
function describeUiReviewCapture(handle) {
  const record = captures.get(handle);
  if (!record) fail('capture_invalid');
  try {
    checkCurrent(record);
    const root = record.dirs.keys().next().value;
    return freeze({ directories: [...record.dirs.values()].map(d => ({
      path: path.relative(root, d.file).split(path.sep).join('/'), resolved: d.resolved,
      dev: String(d.stat.dev), ino: String(d.stat.ino), mode: String(d.stat.mode)
    })), files: record.files.map(f => ({ taskId: f.taskId, kind: f.kind, path: f.parts.join('/'),
      digest: f.expected, byteLength: f.input.bytes.length, identity: describeCheckedFileInput(f.input, f.file) })) });
  } catch (error) { throw safeFailure(error); }
}

async function runUiReviewObservation(handle, currentInputJson, reviewer) {
  const record = captures.get(handle);
  if (!record) fail('capture_invalid');
  if (typeof reviewer !== 'function') fail('reviewer_invalid');
  // Consume before invoking any code/await. Copies and JSON reconstructions are
  // not capabilities; concurrent or subsequent use requires a fresh capture.
  captures.delete(handle);
  const result = { schema: OUTPUT_SCHEMA, packetId: record.packet.packetId, selectionDigest: handle.selectionDigest, observationId: randomUUID(),
    state: 'not-run', reasonCode: null,
    execution: { kind: 'host-callback', state: 'not-run', receiptValidated: false },
    materialBytes: { captured: true, current: false, totalBytes: handle.totalBytes },
    assessment: null,
    verification: { snapshotSourceVerified: false, renderOriginVerified: false, actorIdentityVerified: false,
      semanticVerified: false, independentReview: 'not-verified' },
    authority: { approvalGranted: false, approvalReusable: false, enforcementChanged: false, autoRemove: false },
    callbackEffects: 'not-observed' };
  let currentPacket;
  try {
    currentPacket = createUiReviewPacket(currentInputJson);
    result.assessment = assessUiReview(record.inputJson, currentInputJson);
  } catch { fail('current_input_invalid'); }
  if (currentPacket.packetId !== record.packet.packetId) {
    result.state = 'stale'; result.reasonCode = 'packet_changed'; return freeze(result);
  }
  if (currentPacket.preparation.state !== 'packet-candidate') {
    result.state = 'needs-context'; result.reasonCode = 'packet_not_ready'; return freeze(result);
  }
  try { checkCurrent(record); }
  catch (e) { result.state = 'stale'; result.reasonCode = safeFailure(e).code; return freeze(result); }
  // No path or original mutable buffer crosses into the callback.
  const materials = materialCopies(record);
  let receiptJson;
  try {
    receiptJson = await reviewer(Object.freeze({ packet: record.packet, materials }));
    result.execution.state = 'returned';
  } catch { result.execution.state = 'threw'; }
  try { checkCurrent(record); result.materialBytes.current = true; }
  catch (e) { result.state = 'stale'; result.reasonCode = safeFailure(e).code; result.assessment = null; return freeze(result); }
  if (materials.some(m => digest(m.bytes) !== m.digest)) {
    result.state = 'invalid'; result.reasonCode = 'callback_materials_changed'; result.assessment = null; return freeze(result);
  }
  if (result.execution.state === 'threw') {
    result.state = 'failed'; result.reasonCode = 'callback_failed'; return freeze(result);
  }
  try {
    if (typeof receiptJson !== 'string') fail('receipt_invalid');
    result.assessment = assessUiReview(record.inputJson, currentInputJson, receiptJson);
    const receipt = parseInputJson(receiptJson);
    // Contract validation above establishes dense, unique coverage/indexes. A
    // finding must cite bytes actually supplied for that same task, not merely
    // a well-formed digest or material belonging to another task in the batch.
    for (const cell of receipt.coverage) for (const index of cell.findingIndexes) {
      if (!record.files.some(f => f.taskId === cell.taskId && f.expected === receipt.review.findings[index].evidenceDigest)) {
        fail('finding_material_unbound');
      }
    }
    result.execution.receiptValidated = true;
    result.state = 'observed-review';
  } catch (e) {
    result.state = 'invalid'; result.reasonCode = e instanceof UiReviewObservationError
      && e.code === 'ui_observation_finding_material_unbound' ? 'finding_material_unbound' : 'receipt_invalid';
    result.assessment = null;
  }
  return freeze(result);
}

module.exports = { captureUiReview, readUiReviewMaterialSnapshot, describeUiReviewCapture, runUiReviewObservation, UiReviewObservationError,
  INPUT_SCHEMA, OUTPUT_SCHEMA, MAX_FILE_BYTES, MAX_TOTAL_BYTES, KINDS, portablePath };
