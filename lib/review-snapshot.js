'use strict';

// RB-02 prerequisite only: caller-supplied snapshot bindings, never a durable
// record or review approval. Serialized JSON is the inert input boundary.
const { createHash } = require('node:crypto');
const { validateReviewCheckpointInput } = require('./review-checkpoint');

const INPUT_SCHEMA = 'leerness.review-snapshot-input/v1';
const MATERIAL_SCHEMA = 'leerness.review-snapshot-materials/v1';
const SNAPSHOT_SCHEMA = 'leerness.review-snapshot-candidate/v1';
const COMPARISON_SCHEMA = 'leerness.review-snapshot-comparison/v1';
const MAX_BYTES = 65536;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MATERIAL_KEYS = ['manifestDigest', 'acceptanceDigest', 'policyDigest', 'evidenceDigest', 'implementationDigest', 'dependenciesDigest'];
const CHANGE_CODES = Object.freeze({
  batch: 'batch-changed',
  source: 'source-changed',
  manifest: 'manifest-changed',
  objective: 'acceptance-changed',
  policy: 'policy-changed',
  tasks: 'tasks-changed',
  evidence: 'evidence-changed',
  implementations: 'implementation-attempts-changed',
  dependencies: 'dependencies-changed'
});

class ReviewSnapshotInputError extends Error {
  constructor(code, field) {
    super(`${code} at ${field}`); // Never echo input values or parser messages.
    this.name = 'ReviewSnapshotInputError';
    this.code = code;
    this.field = field;
  }
}
function fail(code, field) { throw new ReviewSnapshotInputError(code, field); }
function object(value, field, keys) {
  if (!value || Array.isArray(value) || typeof value !== 'object') fail('object_required', field);
  if (Object.keys(value).some(key => !keys.includes(key))) fail('unknown_field', field);
  for (const key of keys) if (!Object.hasOwn(value, key)) fail('field_required', `${field}.${key}`);
}
function identifier(value, field) {
  if (typeof value !== 'string' || !ID.test(value)) fail('identifier_invalid', field);
}
function decode(text) {
  // Do not coerce objects: toJSON, getters and arbitrary prototypes are not run.
  if (typeof text !== 'string') fail('serialized_json_required', '$');
  if (text.length > MAX_BYTES || Buffer.byteLength(text, 'utf8') > MAX_BYTES) fail('input_too_large', '$');
  let input;
  try { input = JSON.parse(text); } catch { fail('json_invalid', '$'); }
  object(input, '$', ['schema', 'checkpoint', 'batch', 'materials']);
  if (input.schema !== INPUT_SCHEMA) fail('schema_unsupported', '$.schema');
  object(input.batch, '$.batch', ['id', 'revision', 'objectiveRevision', 'policyRevision']);
  for (const key of ['id', 'objectiveRevision', 'policyRevision']) identifier(input.batch[key], `$.batch.${key}`);
  if (!Number.isSafeInteger(input.batch.revision) || input.batch.revision < 1) fail('revision_invalid', '$.batch.revision');
  object(input.materials, '$.materials', ['schema', ...MATERIAL_KEYS]);
  if (input.materials.schema !== MATERIAL_SCHEMA) fail('schema_unsupported', '$.materials.schema');
  for (const key of MATERIAL_KEYS) {
    if (typeof input.materials[key] !== 'string' || !DIGEST.test(input.materials[key])) fail('digest_required', `$.materials.${key}`);
  }
  try { validateReviewCheckpointInput(input.checkpoint); } catch (error) {
    if (error && error.name === 'ReviewCheckpointInputError') {
      fail(error.code, `$.checkpoint${error.field.slice(1)}`);
    }
    throw error;
  }
  if (input.checkpoint.snapshot === null) fail('source_snapshot_required', '$.checkpoint.snapshot');
  if (input.checkpoint.tasks.some(task => task.objectiveId !== input.checkpoint.objective.id)) {
    fail('mixed_objectives', '$.checkpoint.tasks');
  }
  return input;
}

// Only validated, bounded JSON reaches canonicalization. Object-key order and
// explicitly set-valued task lists do not change semantic binding identity.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function digest(value) { return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`; }
function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function bindings(input) {
  const { checkpoint, batch, materials } = input;
  const tasks = checkpoint.tasks.map(task => ({
    ...task,
    criteria: [...task.criteria].sort(),
    dependsOn: [...task.dependsOn].sort(),
    evidenceRefs: [...task.evidenceRefs].sort(),
    riskTags: [...task.riskTags].sort(),
    aspects: [...task.aspects].sort()
  })).sort(byId);
  return {
    batch: { id: batch.id, revision: batch.revision },
    source: checkpoint.snapshot,
    manifest: { schema: MATERIAL_SCHEMA, digest: materials.manifestDigest },
    objective: { id: checkpoint.objective.id, criteria: [...checkpoint.objective.criteria].sort(), revision: batch.objectiveRevision, digest: materials.acceptanceDigest },
    policy: { revision: batch.policyRevision, digest: materials.policyDigest },
    tasks,
    evidence: { digest: materials.evidenceDigest },
    implementations: { digest: materials.implementationDigest },
    dependencies: { external: [...(checkpoint.externalDependencies || [])].sort(byId), digest: materials.dependenciesDigest }
  };
}
function effects() {
  return { filesRead: false, filesWritten: false, networkUsed: false, modelInvoked: false, approvalGranted: false, enforceChanged: false };
}
function createReviewSnapshotCandidate(text) {
  const input = decode(text);
  const content = bindings(input);
  const bindingDigests = {};
  for (const key of Object.keys(CHANGE_CODES)) {
    bindingDigests[key] = digest({ schema: SNAPSHOT_SCHEMA, binding: key, value: content[key] });
  }
  return freeze({
    schema: SNAPSHOT_SCHEMA,
    snapshotId: digest({ schema: SNAPSHOT_SCHEMA, bindingDigests }),
    batchId: input.batch.id,
    batchRevision: input.batch.revision,
    sourceKind: input.checkpoint.snapshot.kind,
    bindingDigests,
    sourceTrust: 'caller-supplied',
    verification: { sourceVerified: false, manifestVerified: false, evidenceVerified: false, actorIdentityVerified: false, reviewStatus: 'not-evaluated' },
    durability: 'not-persisted',
    approvalReusable: false,
    effects: effects()
  });
}

function compareReviewSnapshotInputs(previousText, currentText) {
  // Reconstruct both sides from validated input. Never trust a caller's claimed
  // snapshotId or accept a fabricated prior candidate as an approval receipt.
  const previous = createReviewSnapshotCandidate(previousText);
  const current = createReviewSnapshotCandidate(currentText);
  const changedBindings = Object.keys(CHANGE_CODES).filter(key => previous.bindingDigests[key] !== current.bindingDigests[key]);
  return freeze({
    schema: COMPARISON_SCHEMA,
    previousSnapshotId: previous.snapshotId,
    currentSnapshotId: current.snapshotId,
    bindingState: changedBindings.length ? 'changed' : 'unchanged',
    changedBindings,
    reasonCodes: changedBindings.map(key => CHANGE_CODES[key]),
    reviewValidity: 'unverified',
    approvalReusable: false,
    sourceTrust: 'caller-supplied',
    durability: 'not-persisted',
    effects: effects()
  });
}

module.exports = {
  INPUT_SCHEMA, MATERIAL_SCHEMA, SNAPSHOT_SCHEMA, COMPARISON_SCHEMA, MAX_BYTES,
  ReviewSnapshotInputError, createReviewSnapshotCandidate, compareReviewSnapshotInputs
};
