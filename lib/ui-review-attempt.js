'use strict';

const C = require('./review-control-contract');
const G = require('./review-control-git');
const R = require('./ui-review-run-contract');
const SCHEMA = 'leerness.ui-review-attempt-record/v1';

function context(ctx, runId) {
  return { ...ctx, ref: `refs/leerness/review-attempts/v1/${ctx.projectKey}/${C.digest(runId).slice(7)}` };
}
function runRef(ctx, runId) {
  return `refs/leerness/review-runs/v1/${ctx.projectKey}/${C.digest(runId).slice(7)}`;
}
function dispatchRef(ctx, runId) {
  return `refs/leerness/review-dispatches/v1/${ctx.projectKey}/${C.digest(runId).slice(7)}`;
}
function parse(bytes, ctx, runId) {
  try {
    const value = R.parse(bytes);
    const keys = ['schema', 'projectKey', 'batchId', 'runId', 'controlHead', 'bindingDigest', 'state'];
    if (!value || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))
      || value.schema !== SCHEMA || value.projectKey !== ctx.projectKey || value.batchId !== ctx.batchId
      || value.runId !== runId || !C.match(value.controlHead, C.OID)
      || !C.match(value.bindingDigest, /^sha256:[0-9a-f]{64}$/)
      || !['reserved', 'execution-unknown'].includes(value.state) || R.encode(value) !== bytes) C.fail('record_invalid');
    return value;
  } catch { C.fail('record_invalid'); }
}
function read(ctx, runId) {
  const actx = context(ctx, runId), head = G.readRef(actx);
  if (!head) return null;
  let stored = G.readCommit(ctx, head);
  const value = parse(stored.bytes, ctx, runId);
  if (stored.parents.length !== 1) C.fail('record_invalid');
  if (value.state === 'execution-unknown') {
    stored = G.readCommit(ctx, stored.parents[0]);
    const reserved = parse(stored.bytes, ctx, runId);
    if (C.stable(reserved) !== C.stable({ ...value, state: 'reserved' }) || stored.parents.length !== 1) C.fail('record_invalid');
  }
  if (stored.parents[0] !== value.controlHead) C.fail('record_invalid');
  const control = G.readCommit(ctx, value.controlHead);
  const original = C.record(control.bytes, ctx.projectKey, ctx.batchId);
  if (!original.owner || !original.snapshot || original.snapshot.generation !== original.generation) C.fail('record_invalid');
  G.assertContext(ctx);
  return { head, value };
}
function binding(ctx, input, request, currentInputDigest) {
  return C.digest({ input, request, currentInputDigest, worktreeDigest: ctx.worktreeDigest });
}
function assertRecord(ctx, runId, attempt, value) {
  const run = { schema: R.INPUT_SCHEMA, batchId: ctx.batchId, runId, expectedHead: value.controlHead,
    generation: value.controlRecord.generation,
    owner: { sessionId: value.controlRecord.owner.sessionId, tokenDigest: value.controlRecord.owner.tokenDigest } };
  const request = { schema: 'leerness.ui-review-observation-input/v1', input: value.input, files: value.files };
  if (value.controlHead !== attempt.value.controlHead
    || binding({ ...ctx, worktreeDigest: value.controlRecord.owner.worktreeDigest }, run, request,
      value.currentInputDigest) !== attempt.value.bindingDigest) C.fail('attempt_conflict');
}
function publish(ctx, runId, previous, value, dispatchHead) {
  if (dispatchHead !== undefined && !C.match(dispatchHead, C.OID)) C.fail('dispatch_invalid');
  const actx = context(ctx, runId), head = G.prepareCommit(ctx, previous || value.controlHead, R.encode(value));
  G.assertContext(ctx);
  const zero = '0'.repeat(head.length);
  // The same transaction fences owner changes, competing callers and a retained
  // no-execution result. A successful response is required before host execution.
  const transaction = `start\noption no-deref\nverify ${ctx.ref} ${value.controlHead}\n`
    + `verify ${runRef(ctx, runId)} ${zero}\n`
    + (dispatchHead === undefined ? '' : `verify ${dispatchRef(ctx, runId)} ${dispatchHead}\n`)
    + (previous ? `update ${actx.ref} ${head} ${previous}\n` : `create ${actx.ref} ${head}\n`)
    + 'prepare\ncommit\n';
  const result = G.run(ctx, ['update-ref', '--stdin'], transaction, 2048);
  if (result.error || result.signal || result.status !== 0 || result.stderr) C.fail('publication_uncertain');
  // These immutable bytes were just prepared here. Confirm reachability without
  // parsing their entire parent chain again; recovery reads validate that chain.
  try { G.assertContext(ctx); if (G.readRef(actx) !== head) C.fail('publication_uncertain'); }
  catch { C.fail('publication_uncertain'); }
  return { head, value };
}
function reserve(ctx, input, request, currentInput) {
  const digest = binding(ctx, input, request, C.digest(currentInput)), prior = read(ctx, input.runId);
  if (prior) {
    if (prior.value.bindingDigest !== digest || prior.value.controlHead !== input.expectedHead) C.fail('attempt_conflict');
    if (prior.value.state !== 'reserved') C.fail('execution_unknown');
    return prior;
  }
  return publish(ctx, input.runId, null, { schema: SCHEMA, projectKey: ctx.projectKey,
    batchId: ctx.batchId, runId: input.runId, controlHead: input.expectedHead, bindingDigest: digest, state: 'reserved' });
}
function start(ctx, runId, reservation, dispatchHead) {
  if (reservation.value.state !== 'reserved') C.fail('execution_unknown');
  return publish(ctx, runId, reservation.head, { ...reservation.value, state: 'execution-unknown' }, dispatchHead);
}

module.exports = { context, runRef, dispatchRef, read, reserve, start, binding, assertRecord };
