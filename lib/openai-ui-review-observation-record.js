'use strict';

// Pure canonical format. This module cannot publish caller-supplied observations.
const C = require('./review-control-contract');
const R = require('./ui-review-run-contract');
const Q = require('./openai-ui-review-request');
const H = require('./openai-response-http');
const D = require('./ui-review-provider-receipt');
const { MAX_LEDGER_BYTES } = require('./ui-review-ledger');
const POLICY = 'leerness.openai-ui-review-observation-policy/v1';
const SCHEMA = 'leerness.openai-ui-review-observation-record/v1';
const SHA = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function policy(v, receiptPolicy) {
  Q.exact(v, ['schema', 'retention']);
  if (v.schema !== POLICY || v.retention !== 'local-git-until-explicit-removal'
    || !receiptPolicy || receiptPolicy.schema !== D.POLICY) C.fail('observation_policy_invalid');
  return v;
}
function validate(v, ctx, journal, currentJson) {
  const intent = journal.intent.value, baseline = intent.recovery?.ledger;
  policy(intent.observationPolicy, intent.receiptPolicy);
  Q.exact(v, ['schema', 'projectKey', 'batchId', 'runId', 'intentHead', 'locatorHead', 'attemptHead',
    'observationId', 'response', 'ledger']);
  if (v.schema !== SCHEMA || v.projectKey !== ctx.projectKey || v.batchId !== ctx.batchId || v.runId !== intent.runId
    || v.intentHead !== journal.intent.head || v.locatorHead !== journal.locator?.head || v.attemptHead !== journal.attempt.head
    || !C.match(v.observationId, UUID)) C.fail('observation_record_invalid');
  Q.exact(v.response, ['id', 'status', 'model', 'createdAt', 'output']);
  let projected;
  try { projected = H.projection(Buffer.from(JSON.stringify({ object: 'response', ...v.response, created_at: v.response.createdAt }))); }
  catch { C.fail('observation_record_invalid'); }
  if (C.stable(projected) !== C.stable(v.response)) C.fail('observation_record_invalid');
  const observed = D.assess(intent, { ok: true, response: projected }, currentJson === undefined ? JSON.stringify(intent.request.input) : currentJson, journal.locator.value.response);
  if (observed.state !== 'receipt-observed') C.fail('observation_record_invalid');
  const l = v.ledger;
  Q.exact(l, ['beforeDigest', 'afterDigest', 'beforeBytes', 'afterBytes', 'implementationEventIds', 'reviewAttemptId', 'prefixPreserved', 'trust']);
  if (!baseline || l.beforeDigest !== baseline.prefixDigest || l.beforeBytes !== baseline.prefixBytes
    || !Number.isSafeInteger(l.afterBytes) || l.afterBytes < l.beforeBytes || l.afterBytes > MAX_LEDGER_BYTES
    || !C.match(l.afterDigest, SHA) || (l.afterBytes === l.beforeBytes && l.afterDigest !== l.beforeDigest)
    || C.stable(l.implementationEventIds) !== C.stable(baseline.implementationEventIds)
    || l.reviewAttemptId !== baseline.reviewAttemptId || l.prefixPreserved !== true || l.trust !== 'local-ledger-declarations') C.fail('observation_record_invalid');
  return observed;
}
function encode(v, ctx, journal, currentJson) {
  const bytes = R.encode(v);
  if (Buffer.byteLength(bytes) > 65536) C.fail('observation_record_limit');
  // The journal envelope adds depth/nodes to an otherwise valid HTTP response.
  // Prove that the complete record can be read before creating any Git objects.
  try { R.parse(bytes); } catch { C.fail('observation_record_invalid'); }
  validate(v, ctx, journal, currentJson); return bytes;
}
function decode(bytes, ctx, journal, currentJson) {
  if (typeof bytes !== 'string' || Buffer.byteLength(bytes) > 65536) C.fail('observation_record_limit');
  const value = R.parse(bytes);
  if (R.encode(value) !== bytes) C.fail('observation_record_invalid');
  return { value, observed: validate(value, ctx, journal, currentJson) };
}

module.exports = { POLICY, SCHEMA, policy, encode, decode };
