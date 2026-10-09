'use strict';

const crypto = require('node:crypto');
const C = require('./review-control-contract');
const G = require('./review-control-git');
const R = require('./ui-review-run-contract');
const T = require('./ui-review-target');
const A = require('./ui-review-attempt');
const J = require('./ui-review-result');
const UI = require('./ui-review');
const { rootPath, control } = require('./ui-review-run-context');
const { createReviewSnapshotCandidate } = require('./review-snapshot');
const { freeze } = require('./openai-ui-review-request');
const { POLICY_SCHEMA, exact, base64, policy } = require('./ui-review-authorization-contract');
const PROOF_SCHEMA = 'leerness.ui-review-authorization-proof/v1';
const DOMAIN = 'leerness.ui-review-authorization/v1\n';
const prepared = new WeakMap(), verified = new WeakMap();

function challenge(text, maxValidityMs) {
  const value = R.parse(text);
  exact(value, ['challengeId', 'issuedAt', 'expiresAt']);
  if (!C.match(value.challengeId, /^[0-9a-f]{64}$/) || !Number.isSafeInteger(value.issuedAt) || value.issuedAt < 0
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= value.issuedAt
    || value.expiresAt - value.issuedAt > maxValidityMs) C.fail('input_invalid');
  return value;
}
function liveTime(value) {
  const now = Date.now();
  if (now < value.issuedAt || now >= value.expiresAt) C.fail('authorization_expired_or_future');
}
function binding(root, runJson, targetJson, currentJson, scope) {
  rootPath(root);
  const run = R.request(runJson), target = R.parse(targetJson);
  const current = R.parse(currentJson);
  UI.createUiReviewPacket(currentJson);
  const snapshot = createReviewSnapshotCandidate(R.encode(current.snapshot));
  if (!target || !target.target || target.target.batchId !== run.batchId || target.target.runId !== run.runId) C.fail('authorization_scope_mismatch');
  const ctx = G.context(root, run.batchId);
  if (ctx.projectKey !== scope.projectKey || target.target.ref !== scope.targetRef) C.fail('authorization_scope_mismatch');
  control(ctx, run, snapshot.snapshotId);
  const attempt = { ...A.context(ctx, run.runId) }, attemptCommit = G.readRef(attempt);
  const assessed = T.assessUiReviewTarget(root, targetJson, currentJson);
  if (assessed.run.controlHead !== run.expectedHead) C.fail('control_changed');
  if (assessed.assessment.state !== 'review-candidate' || assessed.run.outcome !== 'ledger-linked') C.fail('authorization_review_ineligible');
  control(ctx, run, snapshot.snapshotId);
  const refs = [[assessed.target.ref, assessed.target.commit], [A.runRef(ctx, run.runId), assessed.run.runCommit],
    [J.context(ctx, run.runId).ref, assessed.run.resultCommit], [attempt.ref, attemptCommit]];
  for (const [ref, head] of refs) if (G.readRef({ ...ctx, ref }) !== head) C.fail('target_changed');
  if (G.readRef(ctx) !== run.expectedHead) C.fail('control_changed');
  G.assertContext(ctx);
  return { projectKey: ctx.projectKey, worktreeDigest: ctx.worktreeDigest, batchId: run.batchId, runId: run.runId,
    target: assessed.target, runCommit: assessed.run.runCommit, resultCommit: assessed.run.resultCommit,
    attemptCommit, recordDigest: assessed.run.recordDigest, currentInputDigest: assessed.currentInputDigest,
    controlHead: run.expectedHead, generation: run.generation, owner: run.owner };
}
function checked(fn) {
  try { return fn(); }
  catch (error) {
    if (error instanceof C.ReviewControlError || error instanceof UI.UiReviewInputError) throw error;
    throw new C.ReviewControlError('authorization_unavailable');
  }
}

// The supplied policy is a declaration, not a trusted-host authentication result.
function prepareUiReviewAuthorization(root, runJson, targetJson, currentJson, policyJson, challengeJson, policySourceDigest) {
  return checked(() => {
    if (policySourceDigest !== undefined && !C.match(policySourceDigest, /^sha256:[0-9a-f]{64}$/)) C.fail('input_invalid');
    const selected = policy(policyJson), time = challenge(challengeJson, selected.value.maxValidityMs);
    liveTime(time);
    const value = binding(root, runJson, targetJson, currentJson, selected.value);
    liveTime(time);
    const version = policySourceDigest === undefined ? 'v1' : 'v2';
    const payload = { schema: 'leerness.ui-review-authorization-payload/' + version, action: 'accept-ui-review-target',
      issuerId: selected.value.issuerId, keyId: selected.value.keyId, policyDigest: selected.digest, challenge: time, binding: value };
    if (policySourceDigest !== undefined) payload.policySourceDigest = policySourceDigest;
    const signingText = DOMAIN.replace('/v1', '/' + version) + R.encode(payload), payloadDigest = R.sha(signingText);
    const handle = freeze({ schema: 'leerness.ui-review-authorization-prepared/v1', payload, signingText, payloadDigest,
      policySourceVerified: false, challengeConsumed: false, ...R.authority() });
    prepared.set(handle, { root, runJson, targetJson, payload, signingText, payloadDigest });
    return handle;
  });
}

// Fresh policy and current input are mandatory. Checking a proof never consumes it or grants approval.
function verifyUiReviewAuthorization(handle, proofJson, currentPolicyJson, currentInputJson) {
  return checked(() => {
    const saved = prepared.get(handle);
    if (!saved) C.fail('authorization_handle_invalid');
    const selected = policy(currentPolicyJson), proof = R.parse(proofJson);
    exact(proof, ['schema', 'payloadDigest', 'signature']);
    if (proof.schema !== PROOF_SCHEMA || proof.payloadDigest !== saved.payloadDigest) C.fail('authorization_proof_mismatch');
    if (selected.digest !== saved.payload.policyDigest) C.fail('authorization_policy_changed');
    liveTime(saved.payload.challenge);
    const signature = base64(proof.signature, 64);
    if (!crypto.verify(null, Buffer.from(saved.signingText, 'utf8'), selected.key, signature)) C.fail('authorization_signature_invalid');
    const current = binding(saved.root, saved.runJson, saved.targetJson, currentInputJson, selected.value);
    if (C.stable(current) !== C.stable(saved.payload.binding)) C.fail('authorization_binding_changed');
    liveTime(saved.payload.challenge);
    const result = freeze({ schema: 'leerness.ui-review-authorization-verification/v1', scope: 'ui-boundary-only',
      payloadDigest: saved.payloadDigest, policyDigest: selected.digest, issuerId: selected.value.issuerId, keyId: selected.value.keyId,
      challengeId: saved.payload.challenge.challengeId, expiresAt: saved.payload.challenge.expiresAt,
      binding: current, signatureVerified: true, targetBindingVerified: true, policySourceVerified: false,
      challengeConsumed: false, ...R.authority(),
      effects: { filesRead: true, filesWritten: false, networkUsed: false, modelInvoked: false } });
    verified.set(result, freeze({ root: saved.root, payload: saved.payload, proof, policy: selected.value }));
    return result;
  });
}

function verifiedAuthorizationContext(result) {
  const value = verified.get(result);
  if (!value) C.fail('authorization_verification_invalid');
  return value;
}

module.exports = { POLICY_SCHEMA, PROOF_SCHEMA, prepareUiReviewAuthorization, verifyUiReviewAuthorization,
  verifiedAuthorizationContext, challenge, liveTime };
