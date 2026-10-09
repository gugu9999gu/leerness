'use strict';

const crypto = require('node:crypto');
const C = require('./review-control-contract');
const R = require('./ui-review-run-contract');
const V = require('./ui-review-authorization-contract');
const { freeze } = require('./openai-ui-review-request');
const ANCHOR_SCHEMA = 'leerness.ui-review-authority-anchor/v1';
const POLICY_SCHEMA = 'leerness.ui-review-authority-policy/v1';
const POLICY_DOMAIN = 'leerness.ui-review-authority-policy/v1\n';

function anchor(text) {
  try {
    const value = R.parse(text);
    V.exact(value, ['schema', 'hostId', 'publicKeySpki', 'projectKey', 'targetRef', 'minRevision', 'maxPolicyValidityMs']);
    if (value.schema !== ANCHOR_SCHEMA) C.fail('input_invalid');
    C.identifier(value.hostId); C.identifier(value.projectKey); V.targetRef(value.targetRef);
    if (!Number.isSafeInteger(value.minRevision) || value.minRevision < 1
      || !Number.isSafeInteger(value.maxPolicyValidityMs) || value.maxPolicyValidityMs < 1 || value.maxPolicyValidityMs > 86400000) C.fail('input_invalid');
    return { value: freeze(value), key: V.publicKey(value.publicKeySpki), digest: C.digest(value) };
  } catch { C.fail('authority_anchor_invalid'); }
}
function certificate(text, pinned, historical = false) {
  const value = R.parse(text);
  V.exact(value, ['schema', 'hostId', 'revision', 'issuedAt', 'expiresAt', 'policy', 'signature']);
  if (value.schema !== POLICY_SCHEMA || value.hostId !== pinned.value.hostId) C.fail('authority_policy_scope');
  if (!Number.isSafeInteger(value.revision) || value.revision < pinned.value.minRevision) C.fail('authority_policy_rollback');
  if (!Number.isSafeInteger(value.issuedAt) || value.issuedAt < 0 || !Number.isSafeInteger(value.expiresAt)
    || value.expiresAt <= value.issuedAt || value.expiresAt - value.issuedAt > pinned.value.maxPolicyValidityMs) C.fail('input_invalid');
  const { signature, ...payload } = value;
  if (!crypto.verify(null, Buffer.from(POLICY_DOMAIN + R.encode(payload), 'utf8'), pinned.key, V.base64(signature, 64))) C.fail('authority_policy_signature');
  const now = Date.now();
  if (!historical && (now < value.issuedAt || now >= value.expiresAt)) C.fail('authority_policy_expired_or_future');
  if (value.policy !== null) {
    V.policy(R.encode(value.policy));
    if (value.policy.projectKey !== pinned.value.projectKey || value.policy.targetRef !== pinned.value.targetRef) C.fail('authority_policy_scope');
  }
  return { value, digest: C.digest(value) };
}

function source(pinned, selected) {
  return { schema: 'leerness.ui-review-policy-source/v1', hostId: pinned.value.hostId, anchorDigest: pinned.digest,
    certificateDigest: selected.digest, revision: selected.value.revision, expiresAt: selected.value.expiresAt,
    policySignatureVerified: true, trustAnchorSource: 'host-configuration', hostIdentityVerified: false };
}

module.exports = { ANCHOR_SCHEMA, POLICY_SCHEMA, POLICY_DOMAIN, anchor, certificate, source };
