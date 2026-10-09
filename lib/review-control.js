'use strict';

const path = require('node:path');
const { randomBytes } = require('node:crypto');
const C = require('./review-control-contract');
const G = require('./review-control-git');
const { withRuntimeWrites } = require('./runtime-writes');

const OUTPUT_SCHEMA = 'leerness.review-control/v1';
function rootPath(root) { if (typeof root !== 'string' || !path.isAbsolute(root)) C.fail('root_invalid'); }
function result(ctx, head, value, applied, operationRevision) {
  return { schema: OUTPUT_SCHEMA, batchId: ctx.batchId, head, revision: value ? value.revision : 0,
    generation: value ? value.generation : 0,
    owner: value && value.owner ? { sessionId: value.owner.sessionId, worktreeDigest: value.owner.worktreeDigest } : null,
    snapshot: value ? value.snapshot : null, applied, operationRevision,
    retention: head ? 'local-git-ref' : 'absent',
    sourceTrust: 'caller-supplied', actorIdentityVerified: false, approvalGranted: false,
    runtimeActivated: false, cleanupAllowed: false };
}
function safe(fn) {
  try { return fn(); } catch (error) {
    if (error instanceof C.ReviewControlError) throw error;
    if (error && ['E_DRY_RUN_WRITE', 'E_RUNTIME_LAYOUT_INCOMPATIBLE'].includes(error.code)) C.fail(error.code);
    C.fail('store_unavailable');
  }
}
function readReviewControl(root, batchId) {
  rootPath(root); C.identifier(batchId);
  return safe(() => {
    const ctx = G.context(root, batchId), current = G.read(ctx);
    G.assertContext(ctx);
    return result(ctx, current.head, current.value, false, null);
  });
}
function writeReviewControl(root, inputJson) {
  rootPath(root); const input = C.request(inputJson); // Validate before any I/O.
  return safe(() => withRuntimeWrites(root, () => {
    const ctx = G.context(root, input.batchId), current = G.read(ctx);
    const change = C.transition(current.value, input, ctx.worktreeDigest, ctx.projectKey);
    G.assertContext(ctx);
    if (change.replay !== null) return result(ctx, current.head, current.value, false, change.replay);
    if (current.head !== input.expectedHead) C.fail('revision_conflict');
    const head = G.publish(ctx, current.head, change.next);
    return result(ctx, head, change.next, true, change.next.revision);
  }));
}

module.exports = { INPUT_SCHEMA: C.INPUT_SCHEMA, OUTPUT_SCHEMA, MAX_OPERATIONS: C.MAX_OPERATIONS,
  ReviewControlError: C.ReviewControlError, createReviewControlToken: () => randomBytes(32).toString('hex'),
  readReviewControl, writeReviewControl };
