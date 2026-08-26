// lib/claims-baseline.js — explicit, fingerprint-bound legacy claim debt.
//
// A baseline never edits historical evidence and never makes a new failure pass.
// It can acknowledge only failures that existed before an explicit tracker-row
// boundary, and only while the complete row plus the verifier reasons remain
// byte-for-byte equivalent after canonical JSON normalization.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { absRoot, exists, read, mkdirp, writeUtf8 } = require('./io');

const SCHEMA_VERSION = 1;
const KIND = 'leerness-claims-baseline';
const POLICY = 'exact-progress-row-and-reasons';
const FILE_NAME = 'claims-baseline.json';

function baselinePath(root) {
  return path.join(absRoot(root), '.leerness', FILE_NAME);
}

function _canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(_canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + _canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function _sha256(value) {
  return crypto.createHash('sha256').update(_canonical(value)).digest('hex');
}

function _normalizedRow(row) {
  return {
    id: String(row && row.id || ''),
    status: String(row && row.status || ''),
    request: String(row && row.request || ''),
    evidence: String(row && row.evidence || ''),
    nextAction: String(row && row.nextAction || ''),
    updated: String(row && row.updated || ''),
  };
}

function normalizeReasons(reasons) {
  return Array.from(new Set((Array.isArray(reasons) ? reasons : [])
    .map(x => String(x || '').trim()).filter(Boolean))).sort();
}

function claimFingerprint(row, reasons) {
  return _sha256({ row: _normalizedRow(row), reasons: normalizeReasons(reasons) });
}

function _withoutIntegrity(doc) {
  const out = { ...doc };
  delete out.integrity;
  return out;
}

function _integrity(doc) {
  return 'sha256:' + _sha256(_withoutIntegrity(doc));
}

function validateBaseline(doc) {
  const problems = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, problems: ['root-not-object'] };
  if (doc.schemaVersion !== SCHEMA_VERSION) problems.push('unsupported-schema');
  if (doc.kind !== KIND) problems.push('wrong-kind');
  if (doc.policy !== POLICY) problems.push('wrong-policy');
  if (typeof doc.createdAt !== 'string' || Number.isNaN(Date.parse(doc.createdAt))) problems.push('invalid-created-at');
  if (typeof doc.createdByVersion !== 'string' || !doc.createdByVersion.trim()) problems.push('invalid-created-by-version');
  if (typeof doc.beforeTaskId !== 'string' || !/^[A-Z]+-\d{3,}$/.test(doc.beforeTaskId)) problems.push('invalid-before-task');
  if (!Number.isInteger(doc.evaluatedBefore) || doc.evaluatedBefore < 0) problems.push('invalid-evaluated-before');
  if (!Number.isInteger(doc.rawFailedBefore) || doc.rawFailedBefore < 0) problems.push('invalid-raw-failed-before');
  if (!Array.isArray(doc.entries)) problems.push('entries-not-array');
  const ids = new Set();
  for (const entry of Array.isArray(doc.entries) ? doc.entries : []) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { problems.push('invalid-entry'); continue; }
    if (typeof entry.id !== 'string' || !/^[A-Z]+-\d{3,}$/.test(entry.id)) problems.push('invalid-entry-id');
    else if (ids.has(entry.id)) problems.push('duplicate-entry-id');
    else ids.add(entry.id);
    if (!/^[a-f0-9]{64}$/.test(String(entry.fingerprint || ''))) problems.push('invalid-entry-fingerprint');
    const reasons = normalizeReasons(entry.reasons);
    const reasonsAreCanonical = Array.isArray(entry.reasons)
      && entry.reasons.every(reason => typeof reason === 'string' && reason.trim())
      && JSON.stringify(entry.reasons) === JSON.stringify(reasons);
    if (!reasons.length || !reasonsAreCanonical) problems.push('invalid-entry-reasons');
  }
  if (doc.rawFailedBefore !== (Array.isArray(doc.entries) ? doc.entries.length : -1)) problems.push('failed-count-mismatch');
  if (!/^sha256:[a-f0-9]{64}$/.test(String(doc.integrity || ''))) problems.push('invalid-integrity-format');
  else if (doc.integrity !== _integrity(doc)) problems.push('integrity-mismatch');
  return { ok: problems.length === 0, problems: Array.from(new Set(problems)) };
}

function loadBaseline(root) {
  const file = baselinePath(root);
  if (!exists(file)) return { state: 'absent', file, doc: null, problems: [] };
  let doc;
  try { doc = JSON.parse(read(file)); }
  catch (error) { return { state: 'invalid', file, doc: null, problems: ['invalid-json'], error: error.message }; }
  const checked = validateBaseline(doc);
  if (!checked.ok) return { state: 'invalid', file, doc, problems: checked.problems };
  return { state: 'valid', file, doc, problems: [] };
}

function buildBaseline(rows, rawResult, options = {}) {
  const beforeTaskId = String(options.beforeTaskId || '');
  const boundaryIndex = rows.findIndex(row => row.id === beforeTaskId);
  if (boundaryIndex < 0) {
    const error = new Error(`progress-tracker boundary not found: ${beforeTaskId}`);
    error.code = 'E_CLAIMS_BASELINE_BOUNDARY';
    throw error;
  }
  const eligibleRows = rows.slice(0, boundaryIndex).filter(row => /done|완료|completed/i.test(String(row.status || '')));
  const eligible = new Map(eligibleRows.map(row => [row.id, row]));
  const failures = (rawResult.results || []).filter(result => result && !result.ok && eligible.has(result.id));
  const entries = failures.map(result => ({
    id: result.id,
    fingerprint: claimFingerprint(eligible.get(result.id), result.reasons),
    reasons: normalizeReasons(result.reasons),
  }));
  const doc = {
    schemaVersion: SCHEMA_VERSION,
    kind: KIND,
    createdAt: String(options.createdAt || new Date().toISOString()),
    createdByVersion: String(options.version || 'unknown'),
    beforeTaskId,
    policy: POLICY,
    evaluatedBefore: eligibleRows.length,
    rawFailedBefore: entries.length,
    entries,
  };
  doc.integrity = _integrity(doc);
  return {
    doc,
    stats: {
      evaluatedBefore: eligibleRows.length,
      baselined: entries.length,
      failuresAtOrAfterBoundary: (rawResult.results || []).filter(result => result && !result.ok && !eligible.has(result.id)).length,
    },
  };
}

function saveBaseline(root, doc, withLock) {
  const checked = validateBaseline(doc);
  if (!checked.ok) {
    const error = new Error(`refusing to write invalid claims baseline: ${checked.problems.join(', ')}`);
    error.code = 'E_CLAIMS_BASELINE_INVALID';
    throw error;
  }
  const file = baselinePath(root);
  const write = () => {
    mkdirp(path.dirname(file));
    if (exists(file)) {
      const error = new Error(`claims baseline already exists and will not be overwritten: ${file}`);
      error.code = 'E_CLAIMS_BASELINE_EXISTS';
      throw error;
    }
    const temp = file + `.tmp-${process.pid}-${Date.now()}`;
    writeUtf8(temp, JSON.stringify(doc, null, 2) + '\n');
    try { fs.renameSync(temp, file); }
    catch (error) {
      try { fs.rmSync(temp, { force: true }); } catch {}
      throw error;
    }
  };
  if (typeof withLock === 'function') withLock(file, write);
  else write();
  return file;
}

function _rawResult(rawResult, state, extra = {}) {
  return {
    ...rawResult,
    rawFailed: rawResult.failed,
    baselined: 0,
    baseline: { state, ...extra },
    errors: [],
  };
}

function applyBaseline(rows, rawResult, loaded, options = {}) {
  if (options.raw) return _rawResult(rawResult, 'ignored');
  if (!loaded || loaded.state === 'absent') return _rawResult(rawResult, 'absent', { file: loaded && loaded.file });
  if (loaded.state !== 'valid') {
    return {
      ..._rawResult(rawResult, 'invalid', { file: loaded.file, problems: loaded.problems || [] }),
      ok: false,
      errors: ['baseline-invalid'],
    };
  }

  const doc = loaded.doc;
  const duplicateIds = rows.map(row => row.id).filter((id, index, all) => all.indexOf(id) !== index);
  const boundaryIndex = rows.findIndex(row => row.id === doc.beforeTaskId);
  const rowIndex = new Map(rows.map((row, index) => [row.id, index]));
  const outOfScope = doc.entries.filter(entry => !rowIndex.has(entry.id) || rowIndex.get(entry.id) >= boundaryIndex).map(entry => entry.id);
  if (boundaryIndex < 0 || duplicateIds.length || outOfScope.length) {
    const problems = [
      ...(boundaryIndex < 0 ? ['boundary-missing'] : []),
      ...(duplicateIds.length ? ['duplicate-progress-id'] : []),
      ...(outOfScope.length ? ['entry-outside-boundary'] : []),
    ];
    return {
      ..._rawResult(rawResult, 'invalid-context', { file: loaded.file, problems, outOfScope: outOfScope.slice(0, 20) }),
      ok: false,
      errors: ['baseline-invalid-context'],
    };
  }

  const rowsById = new Map(rows.map(row => [row.id, row]));
  const entriesById = new Map(doc.entries.map(entry => [entry.id, entry]));
  let accepted = 0;
  const mismatched = [];
  const newFailures = [];
  const acceptedIds = new Set();
  const results = (rawResult.results || []).map(result => {
    if (!result || result.ok) return result;
    const entry = entriesById.get(result.id);
    if (!entry) { newFailures.push(result.id); return result; }
    const fingerprint = claimFingerprint(rowsById.get(result.id), result.reasons);
    if (fingerprint !== entry.fingerprint) {
      mismatched.push(result.id);
      return { ...result, baselineAccepted: false, baselineMismatch: true };
    }
    accepted++;
    acceptedIds.add(result.id);
    return {
      ...result,
      ok: true,
      rawOk: false,
      reasons: [],
      baselineAccepted: true,
      baselineReasons: normalizeReasons(result.reasons),
    };
  });
  const failed = results.filter(result => result && !result.ok).length;
  const inactiveEntries = doc.entries.filter(entry => !acceptedIds.has(entry.id) && !mismatched.includes(entry.id)).map(entry => entry.id);
  return {
    ok: failed === 0,
    total: rawResult.total,
    failed,
    rawFailed: rawResult.failed,
    baselined: accepted,
    results,
    baseline: {
      state: 'applied',
      file: loaded.file,
      beforeTaskId: doc.beforeTaskId,
      entries: doc.entries.length,
      accepted,
      mismatched: mismatched.slice(0, 20),
      newFailures: newFailures.slice(0, 20),
      inactiveEntries: inactiveEntries.slice(0, 20),
    },
    errors: [],
  };
}

module.exports = {
  SCHEMA_VERSION,
  FILE_NAME,
  baselinePath,
  normalizeReasons,
  claimFingerprint,
  validateBaseline,
  loadBaseline,
  buildBaseline,
  saveBaseline,
  applyBaseline,
};
