'use strict';

const crypto = require('node:crypto');
const C = require('./review-control-contract');
const G = require('./review-control-git');
const R = require('./ui-review-run-contract');
const V = require('./ui-review-authorization-contract');
const P = require('./ui-review-authority-policy');
const F = require('./ui-review-authority-floor');
const Auth = require('./ui-review-authorization');
const A = require('./ui-review-attempt');
const J = require('./ui-review-result');
const { rootPath } = require('./ui-review-run-context');
const { withRuntimeWrites } = require('./runtime-writes');
const { freeze } = require('./openai-ui-review-request');
const SCHEMA = 'leerness.ui-review-proof-use/v1';

function context(root, pinned, challengeId) {
  rootPath(root);
  if (!C.match(challengeId, /^[0-9a-f]{64}$/)) C.fail('input_invalid');
  const ctx = G.context(root, 'proof-use');
  if (ctx.projectKey !== pinned.value.projectKey) C.fail('proof_use_scope');
  return { ...ctx, ref: `refs/leerness/ui-review-proof-use/v1/${ctx.projectKey}/${challengeId}` };
}
function record(text, pinned, challengeId) {
  const value = R.parse(text);
  V.exact(value, ['schema', 'anchor', 'certificate', 'payload', 'proof']);
  if (value.schema !== SCHEMA || C.digest(value.anchor) !== pinned.digest) C.fail('proof_use_record_invalid');
  const selected = P.certificate(R.encode(value.certificate), pinned, true), payload = value.payload, proof = value.proof;
  if (!selected.value.policy) C.fail('proof_use_record_invalid');
  const policy = V.policy(R.encode(selected.value.policy));
  V.exact(payload, ['schema', 'action', 'issuerId', 'keyId', 'policyDigest', 'challenge', 'binding', 'policySourceDigest']);
  V.exact(proof, ['schema', 'payloadDigest', 'signature']);
  Auth.challenge(R.encode(payload.challenge), policy.value.maxValidityMs);
  if (payload.schema !== 'leerness.ui-review-authorization-payload/v2' || payload.action !== 'accept-ui-review-target'
    || payload.issuerId !== policy.value.issuerId || payload.keyId !== policy.value.keyId || payload.policyDigest !== policy.digest
    || payload.policySourceDigest !== C.digest(P.source(pinned, selected)) || payload.challenge.challengeId !== challengeId
    || payload.challenge.expiresAt > selected.value.expiresAt || !payload.binding || !payload.binding.target
    || payload.binding.projectKey !== pinned.value.projectKey || payload.binding.target.ref !== pinned.value.targetRef
    || !C.match(payload.binding.controlHead, C.OID)) C.fail('proof_use_record_invalid');
  const signingText = 'leerness.ui-review-authorization/v2\n' + R.encode(payload);
  if (proof.schema !== Auth.PROOF_SCHEMA || proof.payloadDigest !== R.sha(signingText)
    || !crypto.verify(null, Buffer.from(signingText), policy.key, V.base64(proof.signature, 64))) C.fail('proof_use_record_invalid');
  if (R.encode(value) !== text) C.fail('proof_use_record_invalid');
  return value;
}
function read(ctx, pinned, challengeId) {
  const head = G.readRef(ctx);
  if (!head) return null;
  const stored = G.readCommit(ctx, head), value = record(stored.bytes, pinned, challengeId);
  if (C.stable(stored.parents) !== C.stable([value.payload.binding.controlHead])) C.fail('proof_use_record_invalid');
  G.assertContext(ctx);
  if (G.readRef(ctx) !== head) C.fail('proof_use_changed');
  return { head, bytes: stored.bytes, value };
}
function projection(saved, applied) {
  return freeze({ schema: SCHEMA, head: saved.head, recordDigest: R.sha(saved.bytes),
    payloadDigest: saved.value.proof.payloadDigest, challengeId: saved.value.payload.challenge.challengeId,
    challengeConsumed: true, applied, historical: true, signatureVerified: true, targetBindingVerified: false,
    policySourceVerified: false, retention: 'local-git-ref', ...R.authority() });
}
function safe(fn) {
  try { return fn(); } catch (error) {
    if (error instanceof C.ReviewControlError) throw error;
    if (error && ['E_DRY_RUN_WRITE', 'E_RUNTIME_LAYOUT_INCOMPATIBLE'].includes(error.code)) C.fail(error.code);
    C.fail('proof_use_unavailable');
  }
}
function readUiReviewProofUse(root, anchorJson, challengeId) {
  const pinned = P.anchor(anchorJson);
  return safe(() => { const ctx = context(root, pinned, challengeId), saved = read(ctx, pinned, challengeId);
    G.assertContext(ctx); if (!saved && G.readRef(ctx)) C.fail('proof_use_changed');
    return saved ? projection(saved, false) : null;
  });
}

// Internal writer: only opaque results minted by the real verifier are admitted.
function publishUiReviewProofUse(verified, floorHandle, source) {
  const evidence = Auth.verifiedAuthorizationContext(verified), { root, payload, proof } = evidence;
  return safe(() => withRuntimeWrites(root, () => {
    const floor = F.floorSnapshot(floorHandle, source.anchorDigest), pinned = P.anchor(R.encode(floor.anchor));
    const selected = P.certificate(R.encode(floor.certificate), pinned);
    if (C.digest(source) !== payload.policySourceDigest || C.digest(P.source(pinned, selected)) !== payload.policySourceDigest) C.fail('authority_policy_changed');
    const ctx = context(root, pinned, payload.challenge.challengeId), b = payload.binding;
    if (G.context(floor.root, 'proof-use').topology[2] !== ctx.topology[2]) C.fail('proof_use_scope');
    const control = G.context(root, b.batchId);
    const refs = [[b.target.ref, b.target.commit], [A.runRef(control, b.runId), b.runCommit],
      [J.context(control, b.runId).ref, b.resultCommit], [A.context(control, b.runId).ref, b.attemptCommit],
      [control.ref, b.controlHead], [floor.ref, floor.head]];
    const bytes = R.encode({ schema: SCHEMA, anchor: floor.anchor, certificate: floor.certificate, payload, proof });
    record(bytes, pinned, payload.challenge.challengeId);
    Auth.liveTime(payload.challenge);
    const prior = read(ctx, pinned, payload.challenge.challengeId);
    if (prior && prior.bytes !== bytes) C.fail('authorization_challenge_consumed');
    for (const [ref, head] of refs) if (!C.match(head, C.OID) || G.readRef({ ...ctx, ref }) !== head) C.fail('proof_use_binding_changed');
    G.assertContext(ctx);
    if (prior) { Auth.liveTime(payload.challenge); return projection(prior, false); }
    const head = G.prepareCommit(ctx, b.controlHead, bytes);
    G.assertContext(ctx); Auth.liveTime(payload.challenge); P.certificate(R.encode(floor.certificate), pinned);
    const transaction = 'start\noption no-deref\n' + refs.map(([ref, oid]) => `verify ${ref} ${oid}\n`).join('')
      + `create ${ctx.ref} ${head}\nprepare\ncommit\n`;
    const result = G.run(ctx, ['update-ref', '--stdin'], transaction, 2048);
    if (result.error || result.signal || result.status !== 0 || result.stderr) C.fail('publication_uncertain');
    try {
      const saved = read(ctx, pinned, payload.challenge.challengeId);
      if (!saved || saved.head !== head || saved.bytes !== bytes) C.fail('publication_uncertain');
      Auth.liveTime(payload.challenge); P.certificate(R.encode(floor.certificate), pinned);
      return projection(saved, true);
    } catch { C.fail('publication_uncertain'); }
  }));
}

module.exports = { SCHEMA, readUiReviewProofUse, publishUiReviewProofUse };
