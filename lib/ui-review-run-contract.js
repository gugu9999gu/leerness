'use strict';

const { createHash } = require('node:crypto');
const C = require('./review-control-contract');
const { parseInputJson } = require('./review-checkpoint-transport');
const { createUiReviewPacket, assessUiReview } = require('./ui-review');
const { KINDS, portablePath } = require('./ui-review-observation');
const { createReviewSnapshotCandidate } = require('./review-snapshot');
const INPUT_SCHEMA = 'leerness.ui-review-run-input/v1';
const RECORD_SCHEMA = 'leerness.ui-review-run-record/v1';
const RETENTION_SCHEMA = 'leerness.ui-review-run-retention-input/v1';
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const encode = value => C.stable(value) + '\n';
function exact(v, keys) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length
    || keys.some(k => !Object.hasOwn(v, k))) C.fail('input_invalid');
}
function parse(text) { try { return parseInputJson(text); } catch { C.fail('input_invalid'); } }
function oid(v) { if (!C.match(v, C.OID)) C.fail('input_invalid'); }
function digest(v) { if (!C.match(v, DIGEST)) C.fail('input_invalid'); }
function relative(v) { try { portablePath(v); } catch { C.fail('input_invalid'); } }
function request(text) {
  const v = parse(text);
  exact(v, ['schema', 'runId', 'batchId', 'expectedHead', 'generation', 'owner']);
  if (v.schema !== INPUT_SCHEMA) C.fail('input_invalid');
  C.identifier(v.runId); C.identifier(v.batchId); oid(v.expectedHead);
  if (!Number.isInteger(v.generation) || v.generation < 1 || v.generation > C.MAX_OPERATIONS) C.fail('input_invalid');
  exact(v.owner, ['sessionId', 'token']); C.identifier(v.owner.sessionId);
  if (!C.match(v.owner.token, /^[0-9a-f]{64}$/)) C.fail('input_invalid');
  return { ...v, owner: { sessionId: v.owner.sessionId, tokenDigest: C.digest(v.owner.token) } };
}
function target(text) {
  const v = parse(text);
  exact(v, ['schema', 'batchId', 'runId', 'ref', 'commit', 'recordPath']);
  if (v.schema !== RETENTION_SCHEMA) C.fail('input_invalid');
  C.identifier(v.batchId); C.identifier(v.runId); oid(v.commit); relative(v.recordPath);
  if (typeof v.ref !== 'string' || !v.ref.startsWith('refs/heads/') || v.ref.length > 256) C.fail('input_invalid');
  relative(v.ref);
  if (v.ref.includes('..') || v.ref.split('/').some(p => p.startsWith('.') || p.endsWith('.lock'))) C.fail('input_invalid');
  return v;
}
function authority() {
  return { actorIdentityVerified: false, semanticVerified: false, independentReview: 'not-verified',
    acceptedAuthorityVerified: false, approvalGranted: false, cleanupAllowed: false };
}
function record(text, projectKey, batchId, runId) {
  try {
    const v = parse(text);
    exact(v, ['schema', 'projectKey', 'batchId', 'runId', 'controlHead', 'controlRecord', 'input', 'currentInputDigest',
      'files', 'packetId', 'selectionDigest', 'outcome', 'reasonCode', 'observationId', 'observationState', 'receiptJson', 'ledger']);
    if (v.schema !== RECORD_SCHEMA || v.projectKey !== projectKey || v.batchId !== batchId || v.runId !== runId) C.fail('input_invalid');
    C.identifier(v.runId); C.identifier(v.batchId); oid(v.controlHead); digest(v.currentInputDigest); digest(v.selectionDigest);
    const control = C.record(encode(v.controlRecord), projectKey, batchId);
    const packet = createUiReviewPacket(encode(v.input)), snapshot = createReviewSnapshotCandidate(encode(v.input.snapshot));
    if (packet.packetId !== v.packetId || packet.preparation.state !== 'packet-candidate'
      || !control.owner || !control.snapshot || control.snapshot.generation !== control.generation
      || control.snapshot.snapshotId !== snapshot.snapshotId || snapshot.batchId !== batchId
      || v.input.uiMaterials.length !== 1 || v.input.snapshot.checkpoint.tasks.length !== 1) C.fail('input_invalid');
    if (!Array.isArray(v.files) || v.files.length !== 4) C.fail('input_invalid');
    const seen = new Set();
    for (const f of v.files) {
      exact(f, ['taskId', 'kind', 'path']); relative(f.path);
      if (f.taskId !== v.input.uiMaterials[0].taskId || !KINDS.includes(f.kind) || seen.has(f.kind)) C.fail('input_invalid');
      seen.add(f.kind);
    }
    if (!['ledger-linked', 'unlinked'].includes(v.outcome)) C.fail('input_invalid');
    if (v.reasonCode !== null) C.identifier(v.reasonCode);
    if (v.observationId !== null && !C.match(v.observationId, /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/)) C.fail('input_invalid');
    if (![null, 'not-run', 'stale', 'needs-context', 'invalid', 'failed', 'observed-review'].includes(v.observationState)) C.fail('input_invalid');
    exact(v.ledger, ['beforeDigest', 'afterDigest', 'implementationEventIds', 'reviewEventId', 'receiptDigest']);
    for (const key of ['beforeDigest', 'afterDigest', 'receiptDigest']) if (v.ledger[key] !== null) digest(v.ledger[key]);
    if (v.ledger.reviewEventId !== null) C.identifier(v.ledger.reviewEventId);
    if (!Array.isArray(v.ledger.implementationEventIds) || v.ledger.implementationEventIds.length > 32) C.fail('input_invalid');
    v.ledger.implementationEventIds.forEach(C.identifier);
    if (new Set(v.ledger.implementationEventIds).size !== v.ledger.implementationEventIds.length) C.fail('input_invalid');
    if (v.receiptJson !== null) {
      const assessment = assessUiReview(encode(v.input), encode(v.input), v.receiptJson), receipt = parse(v.receiptJson);
      if (assessment.receiptBinding !== 'matches-reviewed' || v.observationState !== 'observed-review') C.fail('input_invalid');
      for (const cell of receipt.coverage) for (const index of cell.findingIndexes) {
        const row = v.input.uiMaterials.find(m => m.taskId === cell.taskId);
        if (!KINDS.some(k => row[k + 'Digest'] === receipt.review.findings[index].evidenceDigest)) C.fail('input_invalid');
      }
    }
    if (v.outcome === 'ledger-linked' && (v.reasonCode !== null || v.receiptJson === null || !v.observationId
      || !v.ledger.beforeDigest || !v.ledger.afterDigest || !v.ledger.reviewEventId
      || v.ledger.receiptDigest !== sha(v.receiptJson) || parse(v.receiptJson).execution !== 'completed'
      || v.ledger.implementationEventIds.length !== v.input.contributors.length)) C.fail('input_invalid');
    if (encode(v) !== text) C.fail('input_invalid'); // One canonical retained representation.
    return v;
  } catch { C.fail('record_invalid'); }
}

module.exports = { INPUT_SCHEMA, RECORD_SCHEMA, RETENTION_SCHEMA, request, target, record, parse, encode, sha, authority };
