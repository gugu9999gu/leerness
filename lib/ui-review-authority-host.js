'use strict';

const C = require('./review-control-contract');
const R = require('./ui-review-run-contract');
const Auth = require('./ui-review-authorization');
const { freeze } = require('./openai-ui-review-request');
const { ANCHOR_SCHEMA, POLICY_SCHEMA, POLICY_DOMAIN, anchor, certificate, source: policySource } = require('./ui-review-authority-policy');
const { bindFloor } = require('./ui-review-authority-floor');
const { publishUiReviewProofUse } = require('./ui-review-proof-use');

// Bootstrap is trusted host code, never project/request-selected configuration.
// This module verifies signatures relative to that configuration, not the host's identity.
function createUiReviewAuthorityHost(anchorJson, readPolicy, revisionFloor) {
  const pinned = anchor(anchorJson), handles = new WeakMap();
  const observeFloor = revisionFloor === undefined ? null : bindFloor(revisionFloor, pinned.digest);
  let floorWritten = false, floorState = null;
  if (typeof readPolicy !== 'function') C.fail('authority_reader_invalid');
  let latest = { revision: pinned.value.minRevision, digest: null }, busy = false;
  function guarded(fn) {
    if (busy) C.fail('authority_host_busy');
    busy = true; floorWritten = false; floorState = null;
    try { return fn(); } finally { busy = false; }
  }
  function current() {
    let text;
    try { text = readPolicy(); } catch { C.fail('authority_policy_unavailable'); }
    if (typeof text !== 'string') C.fail('authority_policy_unavailable');
    let selected;
    try { selected = certificate(text, pinned); }
    catch (error) { if (error instanceof C.ReviewControlError) throw error; C.fail('authority_policy_invalid'); }
    if (selected.value.revision < latest.revision) C.fail('authority_policy_rollback');
    if (selected.value.revision === latest.revision && latest.digest !== null && selected.digest !== latest.digest) C.fail('authority_policy_revision_conflict');
    if (observeFloor) {
      floorState = observeFloor(text); floorWritten = floorWritten || floorState.applied;
    }
    latest = { revision: selected.value.revision, digest: selected.digest };
    if (selected.value.policy === null) C.fail('authority_policy_revoked');
    return selected;
  }
  function persistence() {
    return observeFloor ? { policyFloor: floorState, effects: { filesRead: true, filesWritten: floorWritten, networkUsed: false, modelInvoked: false } } : {};
  }
  function source(selected) { return policySource(pinned, selected); }
  function same(selected) {
    if (current().digest !== selected.digest) C.fail('authority_policy_changed');
  }
  function liveChallenge(inner) {
    const { issuedAt, expiresAt } = inner.payload.challenge, now = Date.now();
    if (now < issuedAt || now >= expiresAt) C.fail('authorization_expired_or_future');
  }
  function check(handle, proofJson, currentInputJson) {
    const saved = handles.get(handle);
    if (!saved) C.fail('authority_handle_invalid');
    same(saved.selected);
    const checked = Auth.verifyUiReviewAuthorization(saved.inner, proofJson, R.encode(saved.selected.value.policy), currentInputJson);
    same(saved.selected); liveChallenge(saved.inner);
    return { checked, selected: saved.selected };
  }
  return freeze({
    prepare(root, runJson, targetJson, currentInputJson, challengeJson) {
      return guarded(() => {
        const selected = current(), challenge = R.parse(challengeJson);
        if (!challenge || challenge.expiresAt > selected.value.expiresAt) C.fail('authority_challenge_outlives_policy');
        const policySource = source(selected), sourceDigest = C.digest(policySource);
        const inner = Auth.prepareUiReviewAuthorization(root, runJson, targetJson, currentInputJson,
          R.encode(selected.value.policy), challengeJson, sourceDigest);
        same(selected); liveChallenge(inner);
        const handle = freeze({ ...inner, policySource, ...persistence() });
        handles.set(handle, { inner, selected }); return handle;
      });
    },
    verify(handle, proofJson, currentInputJson) {
      return guarded(() => {
        const { checked, selected } = check(handle, proofJson, currentInputJson);
        return freeze({ ...checked, policySource: source(selected), ...persistence() });
      });
    },
    consume(handle, proofJson, currentInputJson) {
      return guarded(() => {
        if (!observeFloor) C.fail('authority_floor_required');
        const { checked, selected } = check(handle, proofJson, currentInputJson);
        const stored = publishUiReviewProofUse(checked, revisionFloor, source(selected));
        return freeze({ ...stored, effects: { filesRead: true, filesWritten: floorWritten || stored.applied, networkUsed: false, modelInvoked: false } });
      });
    },
  });
}

module.exports = { ANCHOR_SCHEMA, POLICY_SCHEMA, POLICY_DOMAIN, createUiReviewAuthorityHost };
