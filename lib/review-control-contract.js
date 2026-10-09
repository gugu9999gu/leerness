'use strict';

const { createHash } = require('node:crypto');
const { parseInputJson } = require('./review-checkpoint-transport');
const { createReviewSnapshotCandidate, SNAPSHOT_SCHEMA } = require('./review-snapshot');

const INPUT_SCHEMA = 'leerness.review-control-input/v1';
const RECORD_SCHEMA = 'leerness.review-control-record/v1';
const MAX_OPERATIONS = 128;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const BINDINGS = ['batch', 'source', 'manifest', 'objective', 'policy', 'tasks', 'evidence', 'implementations', 'dependencies'];

class ReviewControlError extends Error {
  constructor(code) { super(`Review control rejected (${code}).`); this.name = 'ReviewControlError'; this.code = code; }
}
function fail(code) { throw new ReviewControlError(code); }
function match(value, pattern) { return typeof value === 'string' && pattern.test(value); }
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('input_invalid');
}
function integer(value, min, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('input_invalid');
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value) { return `sha256:${createHash('sha256').update(stable(value)).digest('hex')}`; }
function parse(text) { try { return parseInputJson(text); } catch { fail('input_invalid'); } }
function identifier(value) { if (!match(value, ID)) fail('input_invalid'); return value; }
function snapshot(value) {
  exact(value, ['snapshotId', 'batchRevision', 'bindingDigests', 'generation']);
  integer(value.batchRevision, 1); integer(value.generation, 1);
  exact(value.bindingDigests, BINDINGS);
  if (BINDINGS.some(key => !match(value.bindingDigests[key], DIGEST))
    || value.snapshotId !== digest({ schema: SNAPSHOT_SCHEMA, bindingDigests: value.bindingDigests })) fail('input_invalid');
}
function request(text) {
  const value = parse(text);
  exact(value, ['schema', 'operation', 'batchId', 'operationId', 'expectedHead', 'generation', 'owner', 'snapshot']);
  if (value.schema !== INPUT_SCHEMA || !['claim', 'reclaim', 'publish', 'release'].includes(value.operation)) fail('input_invalid');
  identifier(value.batchId); identifier(value.operationId);
  if (value.expectedHead !== null && !match(value.expectedHead, OID)) fail('input_invalid');
  integer(value.generation, 0, MAX_OPERATIONS);
  exact(value.owner, ['sessionId', 'token']); identifier(value.owner.sessionId);
  if (!match(value.owner.token, TOKEN)) fail('input_invalid');
  let candidate = null;
  if (value.operation === 'publish') {
    try { candidate = createReviewSnapshotCandidate(JSON.stringify(value.snapshot)); } catch { fail('input_invalid'); }
    if (candidate.batchId !== value.batchId) fail('input_invalid');
  } else if (value.snapshot !== null) fail('input_invalid');
  return { ...value, owner: { sessionId: value.owner.sessionId, tokenDigest: digest(value.owner.token) },
    snapshotInputDigest: value.snapshot === null ? null : digest(value.snapshot),
    snapshot: candidate && { snapshotId: candidate.snapshotId, batchRevision: candidate.batchRevision,
      bindingDigests: candidate.bindingDigests, generation: value.generation } };
}
function record(text, projectKey, batchId) {
  try {
    const value = parse(text);
    exact(value, ['schema', 'projectKey', 'batchId', 'revision', 'generation', 'owner', 'snapshot', 'operations']);
    if (value.schema !== RECORD_SCHEMA || value.projectKey !== projectKey || value.batchId !== batchId) fail('input_invalid');
    integer(value.revision, 1, MAX_OPERATIONS); integer(value.generation, 1, value.revision);
    if (value.owner !== null) {
      exact(value.owner, ['sessionId', 'tokenDigest', 'worktreeDigest']); identifier(value.owner.sessionId);
      if (!match(value.owner.tokenDigest, DIGEST) || !match(value.owner.worktreeDigest, DIGEST)) fail('input_invalid');
    }
    if (value.snapshot !== null) { snapshot(value.snapshot); integer(value.snapshot.generation, 1, value.generation); }
    if (!Array.isArray(value.operations) || value.operations.length !== value.revision) fail('input_invalid');
    const seen = new Set();
    value.operations.forEach((item, index) => {
      exact(item, ['key', 'payload', 'revision']);
      if (!match(item.key, DIGEST) || !match(item.payload, DIGEST) || item.revision !== index + 1 || seen.has(item.key)) fail('input_invalid');
      seen.add(item.key);
    });
    return value;
  } catch { fail('record_invalid'); }
}
function transition(previous, input, worktreeDigest, projectKey) {
  const current = previous || { schema: RECORD_SCHEMA, projectKey, batchId: input.batchId,
    revision: 0, generation: 0, owner: null, snapshot: null, operations: [] };
  const normalized = { ...input, owner: { ...input.owner, worktreeDigest } };
  const key = digest(input.operationId), payload = digest(normalized);
  const replay = current.operations.find(item => item.key === key);
  if (replay) {
    if (replay.payload !== payload) fail('idempotency_conflict');
    return { replay: replay.revision, next: current };
  }
  if (current.revision === MAX_OPERATIONS) fail('history_limit');
  if (input.generation !== current.generation) fail('stale_generation');
  const next = { ...current, revision: current.revision + 1,
    operations: [...current.operations, { key, payload, revision: current.revision + 1 }] };
  if (input.operation === 'claim' || input.operation === 'reclaim') {
    if ((input.operation === 'claim') !== (current.owner === null)) fail('claim_state_conflict');
    next.generation++; next.owner = normalized.owner;
  } else {
    if (!current.owner || stable(current.owner) !== stable(normalized.owner)) fail('owner_mismatch');
    if (input.operation === 'release') next.owner = null;
    else {
      if (current.snapshot && input.snapshot.batchRevision <= current.snapshot.batchRevision) fail('snapshot_not_advanced');
      next.snapshot = input.snapshot;
    }
  }
  return { replay: null, next };
}

module.exports = { INPUT_SCHEMA, RECORD_SCHEMA, MAX_OPERATIONS, OID, ReviewControlError,
  fail, match, identifier, stable, digest, request, record, transition };
