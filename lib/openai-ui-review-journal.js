'use strict';

const C = require('./review-control-contract');
const G = require('./review-control-git');
const R = require('./ui-review-run-contract');
const A = require('./ui-review-attempt');
const Q = require('./openai-ui-review-request');
const H = require('./openai-response-http');
const B = require('./ui-review-recovery-bundle');
const D = require('./ui-review-provider-receipt');
const K = require('./openai-ui-review-observation-record');
const { projection } = H;
const { withRuntimeWrites } = require('./runtime-writes');
const { control } = require('./ui-review-run-context');
const { createUiReviewPacket } = require('./ui-review');
const { createReviewSnapshotCandidate } = require('./review-snapshot');
const SCHEMA = 'leerness.openai-ui-review-dispatch/v1';
const RECOVERY_SCHEMA = 'leerness.openai-ui-review-dispatch/v2';
const RECEIPT_SCHEMA = 'leerness.openai-ui-review-dispatch/v3';
const OBSERVATION_SCHEMA = 'leerness.openai-ui-review-dispatch/v4';
const LOCATOR_SCHEMA = 'leerness.openai-ui-review-locator/v1';
const SHA = /^sha256:[0-9a-f]{64}$/;
function context(ctx, runId, locator = false) {
  return { ...ctx, ref: locator ? `refs/leerness/review-locators/v1/${ctx.projectKey}/${C.digest(runId).slice(7)}` : A.dispatchRef(ctx, runId) };
}
function unchanged(ctx, runId, record) {
  G.assertContext(ctx);
  if (G.readRef(context(ctx, runId)) !== record.intent.head
    || G.readRef(context(ctx, runId, true)) !== (record.locator?.head ?? null)
    || G.readRef(A.context(ctx, runId)) !== record.attempt.head) C.fail('dispatch_changed');
}
function read(ctx, runId) {
  const head = G.readRef(context(ctx, runId));
  const locatorHead = G.readRef(context(ctx, runId, true));
  if (!head) { if (locatorHead) C.fail('record_invalid'); return null; }
  const commit = G.readCommit(ctx, head), v = R.parse(commit.bytes), attempt = A.read(ctx, runId);
  const observation = v?.schema === OBSERVATION_SCHEMA, receipt = observation || v?.schema === RECEIPT_SCHEMA;
  const recoverable = receipt || v?.schema === RECOVERY_SCHEMA;
  Q.exact(v, ['schema', 'projectKey', 'batchId', 'runId', 'run', 'request', 'currentInputDigest', 'config',
    'bodyDigest', 'bodyBytes', 'packetId', 'selectionDigest', 'requestDigest', 'bindingDigest',
    ...(recoverable ? ['recovery', 'bundleHead'] : []), ...(receipt ? ['receiptPolicy'] : []), ...(observation ? ['observationPolicy'] : [])]);
  if (!attempt || (!recoverable && v.schema !== SCHEMA) || v.projectKey !== ctx.projectKey || v.batchId !== ctx.batchId || v.runId !== runId
    || ![v.currentInputDigest, v.bodyDigest, v.selectionDigest, v.requestDigest, v.bindingDigest].every(d => C.match(d, SHA))
    || !Number.isInteger(v.bodyBytes) || v.bodyBytes < 1 || v.bodyBytes > 4 * 1024 * 1024
    || R.encode(v) !== commit.bytes || Q.requestDigest(v) !== v.requestDigest) C.fail('record_invalid');
  Q.config(v.config);
  if (receipt) D.policy(v.receiptPolicy, v.config, v.recovery);
  if (observation) K.policy(v.observationPolicy, v.receiptPolicy);
  Q.exact(v.request, ['schema', 'input', 'files']);
  if (v.request.schema !== 'leerness.ui-review-observation-input/v1') C.fail('record_invalid');
  const reservedHead = attempt.value.state === 'reserved' ? attempt.head : G.readCommit(ctx, attempt.head).parents[0];
  if (commit.parents.length !== 1 || commit.parents[0] !== (recoverable ? v.bundleHead : reservedHead)
    || v.bindingDigest !== attempt.value.bindingDigest) C.fail('record_invalid');
  const control = C.record(G.readCommit(ctx, attempt.value.controlHead).bytes, ctx.projectKey, ctx.batchId);
  const run = { schema: R.INPUT_SCHEMA, batchId: ctx.batchId, runId, expectedHead: attempt.value.controlHead,
    generation: control.generation, owner: { sessionId: control.owner.sessionId, tokenDigest: control.owner.tokenDigest } };
  if (C.stable(v.run) !== C.stable(run)) C.fail('record_invalid');
  const packet = createUiReviewPacket(JSON.stringify(v.request.input));
  const snapshot = createReviewSnapshotCandidate(JSON.stringify(v.request.input.snapshot));
  if (snapshot.snapshotId !== control.snapshot.snapshotId || packet.packetId !== v.packetId) C.fail('record_invalid');
  A.assertRecord(ctx, runId, attempt, { controlHead: run.expectedHead, controlRecord: control,
    input: v.request.input, files: v.request.files, currentInputDigest: v.currentInputDigest });
  const out = { attempt, intent: { head, value: v }, locator: null, snapshotId: snapshot.snapshotId };
  if (recoverable) out.materials = B.read(ctx, v.bundleHead, reservedHead, v);
  if (locatorHead) {
    const lc = G.readCommit(ctx, locatorHead), l = R.parse(lc.bytes);
    Q.exact(l, ['schema', 'intentHead', 'attemptHead', 'response']);
    Q.exact(l.response, ['id', 'status', 'model', 'createdAt']);
    if (l.schema !== LOCATOR_SCHEMA || l.intentHead !== head || l.attemptHead !== attempt.head
      || attempt.value.state !== 'execution-unknown' || lc.parents.length !== 1 || lc.parents[0] !== attempt.head
      || R.encode(l) !== lc.bytes) C.fail('record_invalid');
    projection(Buffer.from(JSON.stringify({ object: 'response', ...l.response, created_at: l.response.createdAt, output: [] })));
    out.locator = { head: locatorHead, value: l };
  }
  unchanged(ctx, runId, out); return out;
}
function publish(ctx, runId, parent, value, verifies, locator = false) {
  const target = context(ctx, runId, locator), head = G.prepareCommit(ctx, parent, R.encode(value));
  G.assertContext(ctx);
  const transaction = 'start\noption no-deref\n' + verifies.map(([ref, oid]) => `verify ${ref} ${oid}\n`).join('')
    + `create ${target.ref} ${head}\nprepare\ncommit\n`;
  const result = G.run(ctx, ['update-ref', '--stdin'], transaction, 2048);
  if (result.error || result.signal || result.status !== 0 || result.stderr) C.fail('publication_uncertain');
  try { G.assertContext(ctx); if (G.readRef(target) !== head) C.fail('publication_uncertain'); }
  catch { C.fail('publication_uncertain'); }
  return head;
}
function intent(ctx, runId, attempt, value, recovery) {
  const prior = read(ctx, runId);
  if (prior) {
    const candidate = recovery ? { ...value, bundleHead: prior.intent.value.bundleHead } : value;
    if (R.encode(prior.intent.value) !== R.encode(candidate) || prior.attempt.head !== attempt.head) C.fail('dispatch_conflict');
    return prior.intent.head;
  }
  if ([RECOVERY_SCHEMA, RECEIPT_SCHEMA, OBSERVATION_SCHEMA].includes(value.schema) !== Boolean(recovery)) C.fail('recovery_missing');
  const bundleHead = recovery ? B.prepareCommit(ctx, attempt.head, value, recovery) : null;
  const stored = recovery ? { ...value, bundleHead } : value;
  return publish(ctx, runId, bundleHead || attempt.head, stored, [[ctx.ref, value.run.expectedHead],
    [A.context(ctx, runId).ref, attempt.head], [A.runRef(ctx, runId), '0'.repeat(attempt.head.length)]]);
}
function locator(ctx, runId, attempt, intentHead, response) {
  const value = { schema: LOCATOR_SCHEMA, intentHead, attemptHead: attempt.head,
    response: { id: response.id, status: response.status, model: response.model, createdAt: response.createdAt } };
  // A late acceptance may be kept as history after reclaim. Lookup still requires
  // the original current owner; history publication cannot grant target authority.
  return publish(ctx, runId, attempt.head, value, [[A.context(ctx, runId).ref, attempt.head],
    [context(ctx, runId).ref, intentHead]], true);
}
async function submit(root, batchId, runId, intentHead, reservationHead, body, apiKey) {
  // No exported function accepts caller JSON as an observed provider response.
  // This entry point can only spend the original reserved fence and observe its
  // own POST. Its scope/body must match the durable, previously approved intent.
  C.identifier(batchId); C.identifier(runId); H.credential(apiKey);
  if (!Buffer.isBuffer(body) || body.length < 1 || body.length > 4 * 1024 * 1024) C.fail('dispatch_body_changed');
  const payload = Buffer.from(body);
  return withRuntimeWrites(root, async () => {
    const ctx = G.context(root, batchId), record = read(ctx, runId);
    if (!record || record.intent.head !== intentHead) C.fail('dispatch_changed');
    if (record.attempt.value.state !== 'reserved') C.fail('execution_unknown');
    if (record.attempt.head !== reservationHead) C.fail('dispatch_changed');
    const value = record.intent.value;
    if (payload.length !== value.bodyBytes || R.sha(payload) !== value.bodyDigest) C.fail('dispatch_body_changed');
    if ([RECOVERY_SCHEMA, RECEIPT_SCHEMA, OBSERVATION_SCHEMA].includes(value.schema)) B.restore(root, value, true);
    control(ctx, value.run, record.snapshotId);
    const attempt = A.start(ctx, runId, record.attempt, intentHead);
    const response = await H.requestOnce(Q.transportScope(value.config), apiKey, payload);
    if (response.ok) locator(ctx, runId, attempt, intentHead, response.response);
    return { attempt, response };
  });
}

module.exports = { SCHEMA, RECOVERY_SCHEMA, RECEIPT_SCHEMA, OBSERVATION_SCHEMA, context, read, unchanged, intent, submit };
