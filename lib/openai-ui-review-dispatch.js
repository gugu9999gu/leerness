'use strict';

const C = require('./review-control-contract');
const G = require('./review-control-git');
const R = require('./ui-review-run-contract');
const A = require('./ui-review-attempt');
const J = require('./openai-ui-review-journal');
const Q = require('./openai-ui-review-request');
const H = require('./openai-response-http');
const B = require('./ui-review-recovery-bundle');
const D = require('./ui-review-provider-receipt');
const K = require('./openai-ui-review-observation-record');
const O = require('./openai-ui-review-observation');
const { rootPath, control } = require('./ui-review-run-context');
const { withRuntimeWrites } = require('./runtime-writes');
const { captureUiReview } = require('./ui-review-observation');
const { createUiReviewPacket } = require('./ui-review');
const { createReviewSnapshotCandidate } = require('./review-snapshot');
const handles = new WeakMap();
const recovered = new WeakMap();
function safe(error) {
  if (error instanceof C.ReviewControlError) return error;
  return new C.ReviewControlError(error && ['E_DRY_RUN_WRITE', 'E_RUNTIME_LAYOUT_INCOMPATIBLE'].includes(error.code)
    ? error.code : 'dispatch_unavailable');
}
function authority() { return { ...R.authority(), retryAllowed: false, executionBindingVerified: false }; }
function summary(record) {
  const v = record.intent.value;
  return Q.freeze({ schema: 'leerness.openai-ui-review-dispatch-observation/v1', runId: v.runId,
    requestDigest: v.requestDigest, intentHead: record.intent.head, attemptHead: record.attempt.head,
    state: record.locator ? 'response-located' : record.attempt.value.state,
    locatorHead: record.locator?.head ?? null, response: record.locator?.value.response ?? null,
    config: v.config, provenance: 'trusted-local-dispatch-journal',
    ...(v.recovery ? { recoveryBundleHead: v.bundleHead, recoveryPolicy: v.recovery.policy } : {}),
    ...(v.receiptPolicy ? { receiptPolicy: v.receiptPolicy } : {}),
    ...(v.observationPolicy ? { observationPolicy: v.observationPolicy } : {}), ...authority() });
}
function requestBody(capture, config, recovery, receiptPolicy) {
  return Q.body(capture, config, receiptPolicy ? D.instructions(receiptPolicy, config, recovery, capture.packet) : '');
}
function prepareOpenAiUiReviewDispatch(root, runInputJson, observationRequestJson, currentInputJson, configJson, recoveryPolicyJson, receiptPolicyJson, observationPolicyJson) {
  rootPath(root);
  try {
    const run = R.request(runInputJson), request = R.parse(observationRequestJson), current = R.parse(currentInputJson);
    const config = Q.config(R.parse(configJson)), snapshot = createReviewSnapshotCandidate(JSON.stringify(request.input.snapshot));
    const capture = captureUiReview(root, observationRequestJson), packet = capture.packet;
    if (snapshot.batchId !== run.batchId || packet.packetId !== createUiReviewPacket(currentInputJson).packetId) C.fail('snapshot_mismatch');
    if (request.input.uiMaterials.length !== 1 || request.input.snapshot.checkpoint.tasks.length !== 1) C.fail('single_task_required');
    const ctx = G.context(root, run.batchId);
    control(ctx, run, snapshot.snapshotId);
    if (G.readRef({ ...ctx, ref: A.runRef(ctx, run.runId) })) C.fail('run_conflict');
    const prior = A.read(ctx, run.runId);
    if (prior && prior.value.state !== 'reserved') C.fail('execution_unknown');
    const recovery = recoveryPolicyJson === undefined ? null : B.prepare(root, request, capture, recoveryPolicyJson);
    const receiptPolicy = receiptPolicyJson === undefined ? null : D.policy(R.parse(receiptPolicyJson), config, recovery?.metadata);
    const observationPolicy = observationPolicyJson === undefined ? null : K.policy(R.parse(observationPolicyJson), receiptPolicy);
    const body = requestBody(capture, config, recovery?.metadata, receiptPolicy);
    const value = { schema: observationPolicy ? J.OBSERVATION_SCHEMA : receiptPolicy ? J.RECEIPT_SCHEMA : recovery ? J.RECOVERY_SCHEMA : J.SCHEMA, projectKey: ctx.projectKey, batchId: run.batchId, runId: run.runId,
      run, request, currentInputDigest: C.digest(current), config, bodyDigest: R.sha(body), bodyBytes: body.length,
      packetId: packet.packetId, selectionDigest: capture.selectionDigest,
      bindingDigest: A.binding(ctx, run, request, C.digest(current)), ...(recovery ? { recovery: recovery.metadata } : {}),
      ...(receiptPolicy ? { receiptPolicy } : {}), ...(observationPolicy ? { observationPolicy } : {}) };
    value.requestDigest = Q.requestDigest(value);
    if (Buffer.byteLength(R.encode(recovery ? { ...value, bundleHead: 'f'.repeat(64) } : value)) > 65536) C.fail('dispatch_record_limit');
    const handle = Q.freeze({ schema: 'leerness.openai-ui-review-dispatch-preview/v1', runId: run.runId,
      requestDigest: value.requestDigest, bodyDigest: value.bodyDigest, bodyBytes: body.length,
      config, packet, selectionDigest: capture.selectionDigest, materials: capture.materials,
      ...(recovery ? { recovery: recovery.metadata } : {}),
      ...(receiptPolicy ? { receiptPolicy } : {}), ...(observationPolicy ? { observationPolicy } : {}),
      ...authority() });
    handles.set(handle, { ctx, run, request, current, capture, value, body, recovery, snapshotId: snapshot.snapshotId });
    return handle;
  } catch (error) { throw safe(error); }
}
async function dispatchOpenAiUiReviewRun(handle, approvedRequestDigest, apiKey) {
  const prepared = handles.get(handle);
  if (!prepared) C.fail('dispatch_handle_invalid');
  if (approvedRequestDigest !== handle.requestDigest) C.fail('dispatch_approval_mismatch');
  try { H.credential(apiKey); } catch { C.fail('dispatch_credential_invalid'); }
  handles.delete(handle);
  try {
    return await withRuntimeWrites(prepared.ctx.root, async () => {
      const { ctx, run, request, current, capture, value, body, recovery, snapshotId } = prepared;
      control(ctx, run, snapshotId);
      if (!requestBody(capture, value.config, value.recovery, value.receiptPolicy).equals(body)) C.fail('dispatch_body_changed');
      if (recovery) B.assertCurrent(recovery);
      const reserved = A.reserve(ctx, run, request, current);
      const intentHead = J.intent(ctx, run.runId, reserved, value, recovery);
      // Material identity is checked again after durable intent publication and
      // immediately before the atomic execution fence. A CAS loser never sends.
      if (!requestBody(capture, value.config, value.recovery, value.receiptPolicy).equals(body)) C.fail('dispatch_body_changed');
      if (recovery) B.assertCurrent(recovery);
      control(ctx, run, snapshotId);
      const submitted = await J.submit(ctx.root, run.batchId, run.runId, intentHead, reserved.head, body, apiKey);
      const { attempt, response: result } = submitted;
      if (!result.ok) return Q.freeze({ ok: false, state: 'execution-unknown', error: result.error,
        runId: run.runId, intentHead, attemptHead: attempt.head, ...authority() });
      return Q.freeze({ ok: true, ...summary(J.read(ctx, run.runId)) });
    });
  } catch (error) { throw safe(error); }
}
function readOpenAiUiReviewDispatch(root, batchId, runId) {
  rootPath(root);
  try {
    C.identifier(batchId); C.identifier(runId);
    const record = J.read(G.context(root, batchId), runId);
    return record ? summary(record) : null;
  } catch (error) { throw safe(error); }
}
async function retrieveOpenAiUiReviewDispatch(root, runInputJson, profileJson, apiKey) {
  try { return await O.retrieve(root, runInputJson, profileJson, apiKey, undefined, false); }
  catch (error) { throw safe(error); }
}
async function retrieveOpenAiUiReviewReceipt(root, runInputJson, currentInputJson, profileJson, apiKey) {
  try { return await O.retrieve(root, runInputJson, profileJson, apiKey, currentInputJson, true); }
  catch (error) { throw safe(error); }
}
async function observeOpenAiUiReviewReceipt(root, runInputJson, currentInputJson, profileJson, apiKey) {
  try { return await O.observe(root, runInputJson, currentInputJson, profileJson, apiKey); }
  catch (error) { throw safe(error); }
}
function recoverOpenAiUiReviewReceipt(root, runInputJson, currentInputJson, profileJson) {
  try { return O.recover(root, runInputJson, currentInputJson, profileJson); }
  catch (error) { throw safe(error); }
}

function recoverOpenAiUiReviewDispatch(root, runInputJson, currentInputJson) {
  rootPath(root);
  try {
    const run = R.request(runInputJson), ctx = G.context(root, run.batchId), record = J.read(ctx, run.runId);
    if (!record || !record.intent.value.recovery) C.fail('recovery_missing');
    const value = record.intent.value;
    if (C.stable(run) !== C.stable(value.run)) C.fail('dispatch_run_mismatch');
    if (C.digest(R.parse(currentInputJson)) !== value.currentInputDigest) C.fail('snapshot_mismatch');
    control(ctx, run, record.snapshotId);
    const ledger = B.restore(root, value);
    control(ctx, run, record.snapshotId); J.unchanged(ctx, run.runId, record);
    const handle = Q.freeze({ ...summary(record), schema: 'leerness.ui-review-recovered-inputs/v1',
      recoveryState: 'inputs-restored', ledger, materials: value.recovery.capture.files.map(({ identity, path, ...f }) => f),
      materialBytesRestored: true, runRecordRestored: false, ...authority() });
    recovered.set(handle, { ctx, run, record }); return handle;
  } catch (error) { throw safe(error); }
}
function readRecoveredUiReviewMaterials(handle) {
  const saved = recovered.get(handle);
  if (!saved) C.fail('recovery_handle_invalid');
  try {
    const { ctx, run, record } = saved;
    control(ctx, run, record.snapshotId); J.unchanged(ctx, run.runId, record);
    B.restore(ctx.root, record.intent.value);
    control(ctx, run, record.snapshotId); J.unchanged(ctx, run.runId, record);
    return Object.freeze(record.materials.map(m => Object.freeze({ ...m, bytes: Buffer.from(m.bytes) })));
  } catch (error) { throw safe(error); }
}

module.exports = { prepareOpenAiUiReviewDispatch, dispatchOpenAiUiReviewRun, readOpenAiUiReviewDispatch, retrieveOpenAiUiReviewDispatch,
  recoverOpenAiUiReviewDispatch, readRecoveredUiReviewMaterials, retrieveOpenAiUiReviewReceipt, observeOpenAiUiReviewReceipt, recoverOpenAiUiReviewReceipt };
