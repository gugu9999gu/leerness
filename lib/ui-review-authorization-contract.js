'use strict';

const crypto = require('node:crypto');
const C = require('./review-control-contract');
const R = require('./ui-review-run-contract');
const POLICY_SCHEMA = 'leerness.ui-review-authorization-policy/v1';
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) C.fail('input_invalid');
}
function base64(value, length) {
  if (typeof value !== 'string' || value.length !== Math.ceil(length / 3) * 4) C.fail('input_invalid');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== length || bytes.toString('base64') !== value) C.fail('input_invalid');
  return bytes;
}
function publicKey(value) {
  const bytes = base64(value, 44), key = crypto.createPublicKey({ key: bytes, type: 'spki', format: 'der' });
  if (key.asymmetricKeyType !== 'ed25519' || !key.export({ type: 'spki', format: 'der' }).equals(bytes)) C.fail('input_invalid');
  return key;
}
function targetRef(ref) {
  R.target(R.encode({ schema: R.RETENTION_SCHEMA, batchId: 'validation', runId: 'validation',
    ref, commit: '0'.repeat(40), recordPath: 'validation.json' }));
}
function policy(text) {
  try {
    const value = R.parse(text);
    exact(value, ['schema', 'issuerId', 'keyId', 'publicKeySpki', 'projectKey', 'targetRef', 'maxValidityMs']);
    if (value.schema !== POLICY_SCHEMA) C.fail('input_invalid');
    for (const key of ['issuerId', 'keyId', 'projectKey']) C.identifier(value[key]);
    targetRef(value.targetRef);
    if (!Number.isSafeInteger(value.maxValidityMs) || value.maxValidityMs < 1 || value.maxValidityMs > 3600000) C.fail('input_invalid');
    return { value, key: publicKey(value.publicKeySpki), digest: C.digest(value) };
  } catch { C.fail('authorization_policy_invalid'); }
}
module.exports = { POLICY_SCHEMA, exact, base64, publicKey, targetRef, policy };
