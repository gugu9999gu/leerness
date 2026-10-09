'use strict';

const C = require('./review-control-contract');
const G = require('./review-control-git');
const R = require('./ui-review-run-contract');
const V = require('./ui-review-authorization-contract');
const P = require('./ui-review-authority-policy');
const { rootPath } = require('./ui-review-run-context');
const { withRuntimeWrites } = require('./runtime-writes');
const { freeze } = require('./openai-ui-review-request');
const SCHEMA = 'leerness.ui-review-authority-floor/v1';
const handles = new WeakMap();

function context(root, pinned) {
  rootPath(root);
  const ctx = G.context(root, 'authority-floor');
  if (ctx.projectKey !== pinned.value.projectKey) C.fail('authority_floor_scope');
  return { ...ctx, ref: `refs/leerness/ui-review-authority/v1/${ctx.projectKey}/${pinned.digest.slice(7)}` };
}
function read(ctx, pinned) {
  const head = G.readRef(ctx);
  if (!head) C.fail('authority_floor_missing');
  const stored = G.readCommit(ctx, head), value = R.parse(stored.bytes);
  V.exact(value, ['schema', 'anchorDigest', 'certificate']);
  if (value.schema !== SCHEMA || value.anchorDigest !== pinned.digest) C.fail('authority_floor_invalid');
  // Expiry must never erase a previously observed revocation or revision floor.
  const selected = P.certificate(R.encode(value.certificate), pinned, true);
  G.assertContext(ctx);
  if (G.readRef(ctx) !== head) C.fail('authority_floor_changed');
  return { head, selected };
}
function follows(next, previous) {
  if (next.value.revision < previous.value.revision) C.fail('authority_policy_rollback');
  if (next.value.revision === previous.value.revision && next.digest !== previous.digest) C.fail('authority_policy_revision_conflict');
}
function publish(ctx, pinned, previous, selected) {
  const value = { schema: SCHEMA, anchorDigest: pinned.digest, certificate: selected.value };
  const head = G.prepareCommit(ctx, previous, R.encode(value));
  G.assertContext(ctx);
  const result = G.run(ctx, ['update-ref', '--no-deref', ctx.ref, head, previous || '0'.repeat(head.length)]);
  if (result.error || result.signal || result.status !== 0 || result.stderr) C.fail('publication_uncertain');
  try { if (read(ctx, pinned).head !== head) C.fail('publication_uncertain'); }
  catch { C.fail('publication_uncertain'); }
  return head;
}
function receipt(head, selected, applied) {
  return freeze({ schema: SCHEMA, head, revision: selected.value.revision, certificateDigest: selected.digest,
    revoked: selected.value.policy === null, applied, retention: 'local-git-ref', ...R.authority() });
}
function safe(fn) {
  try { return fn(); } catch (error) {
    if (error instanceof C.ReviewControlError) throw error;
    if (error && ['E_DRY_RUN_WRITE', 'E_RUNTIME_LAYOUT_INCOMPATIBLE'].includes(error.code)) C.fail(error.code);
    C.fail('authority_floor_unavailable');
  }
}
function initializeUiReviewAuthorityFloor(root, anchorJson, certificateJson) {
  const pinned = P.anchor(anchorJson), selected = P.certificate(certificateJson, pinned);
  return safe(() => withRuntimeWrites(root, () => {
    const ctx = context(root, pinned);
    if (G.readRef(ctx)) C.fail('authority_floor_exists');
    return receipt(publish(ctx, pinned, null, selected), selected, true);
  }));
}
function openUiReviewAuthorityFloor(root, anchorJson) {
  const pinned = P.anchor(anchorJson), ctx = safe(() => context(root, pinned));
  let latest = safe(() => read(ctx, pinned)), busy = false;
  function observe(certificateJson) {
    if (busy) C.fail('authority_floor_busy');
    busy = true;
    try {
      const selected = P.certificate(certificateJson, pinned);
      return safe(() => withRuntimeWrites(root, () => {
        const current = read(ctx, pinned);
        follows(current.selected, latest.selected); follows(selected, current.selected);
        const applied = selected.digest !== current.selected.digest;
        const head = applied ? publish(ctx, pinned, current.head, selected) : current.head;
        // Keep the newly durable floor even if the certificate expires at this boundary.
        latest = { head, selected };
        P.certificate(certificateJson, pinned);
        return receipt(head, selected, applied);
      }));
    } finally { busy = false; }
  }
  const handle = freeze({ observe });
  handles.set(handle, { anchorDigest: pinned.digest, observe, ctx, pinned }); return handle;
}
function bindFloor(handle, anchorDigest) {
  const saved = handles.get(handle);
  if (!saved || saved.anchorDigest !== anchorDigest) C.fail('authority_floor_handle_invalid');
  return saved.observe;
}

function floorSnapshot(handle, anchorDigest) {
  bindFloor(handle, anchorDigest);
  const { ctx, pinned } = handles.get(handle), current = safe(() => read(ctx, pinned));
  return freeze({ root: ctx.root, ref: ctx.ref, head: current.head, anchor: pinned.value,
    certificate: current.selected.value, certificateDigest: current.selected.digest });
}

module.exports = { SCHEMA, initializeUiReviewAuthorityFloor, openUiReviewAuthorityFloor, bindFloor, floorSnapshot };
