'use strict';

const { rootPath, control } = require('./ui-review-run-context');
const C = require('./review-control-contract');
const G = require('./review-control-git');
const R = require('./ui-review-run-contract');
const A = require('./ui-review-attempt');
const J = require('./ui-review-result');
const { withRuntimeWrites } = require('./runtime-writes');
const { runUiReviewWithLedger } = require('./ui-review-ledger');
const { createUiReviewPacket } = require('./ui-review');
const { createReviewSnapshotCandidate } = require('./review-snapshot');
const { MAX_FILE_BYTES, MAX_TOTAL_BYTES } = require('./ui-review-observation');
const handles = new WeakMap();
function safe(error) {
  if (error instanceof C.ReviewControlError) return error;
  return new C.ReviewControlError(error && ['E_DRY_RUN_WRITE', 'E_RUNTIME_LAYOUT_INCOMPATIBLE'].includes(error.code)
    ? error.code : 'run_unavailable');
}
function runContext(ctx, runId) {
  return { ...ctx, ref: A.runRef(ctx, runId) };
}
function stored(ctx, runId) {
  const rctx = runContext(ctx, runId), head = G.readRef(rctx);
  if (!head) return null;
  const commit = G.readCommit(rctx, head), value = R.record(commit.bytes, ctx.projectKey, ctx.batchId, runId);
  if (commit.parents.length !== 1 || commit.parents[0] !== value.controlHead) C.fail('record_invalid');
  // The parent preserves the control record whose owner/snapshot fenced this run.
  const parent = G.readCommit(ctx, value.controlHead);
  if (C.stable(C.record(parent.bytes, ctx.projectKey, ctx.batchId)) !== C.stable(value.controlRecord)) C.fail('record_invalid');
  return { ref: rctx.ref, head, recordDigest: R.sha(commit.bytes), recordJson: commit.bytes, record: value,
    retention: 'local-git-ref', ...R.authority() };
}
async function observeUiReviewRun(root, runInputJson, observationRequestJson, currentInputJson, reviewer) {
  rootPath(root); const input = R.request(runInputJson);
  if (typeof reviewer !== 'function') C.fail('reviewer_invalid');
  try {
    const request = R.parse(observationRequestJson), currentInput = R.parse(currentInputJson);
    const packet = createUiReviewPacket(JSON.stringify(request.input)), currentPacket = createUiReviewPacket(currentInputJson);
    const snapshot = createReviewSnapshotCandidate(JSON.stringify(request.input.snapshot));
    if (snapshot.batchId !== input.batchId || packet.packetId !== currentPacket.packetId) C.fail('snapshot_mismatch');
    if (request.input.uiMaterials.length !== 1 || request.input.snapshot.checkpoint.tasks.length !== 1) C.fail('single_task_required');
    return await withRuntimeWrites(root, async () => {
      const ctx = G.context(root, input.batchId), before = control(ctx, input, snapshot.snapshotId);
      if (stored(ctx, input.runId)) C.fail('run_conflict');
      let attempt = A.reserve(ctx, input, request, currentInput), executionFenceError = null, receiptJson = null;
      const observation = await runUiReviewWithLedger(root, observationRequestJson, currentInputJson, async supplied => {
        // Ledger/capture setup precedes this boundary; check ownership again immediately before host execution.
        try {
          control(ctx, input, snapshot.snapshotId);
          attempt = A.start(ctx, input.runId, attempt);
        } catch (error) { executionFenceError = error; throw error; }
        receiptJson = await reviewer(supplied); return receiptJson;
      });
      // Observation deliberately captures callback failures. A failed execution
      // fence must not become a competing failure RunRecord that can win retain.
      if (executionFenceError) throw executionFenceError;
      const observed = observation.observation;
      const value = { schema: R.RECORD_SCHEMA, projectKey: ctx.projectKey, batchId: input.batchId, runId: input.runId,
        controlHead: before.head, controlRecord: before.value, input: request.input, currentInputDigest: C.digest(currentInput),
        files: request.files, packetId: observation.packetId, selectionDigest: observation.selectionDigest,
        outcome: observation.state, reasonCode: observation.reasonCode,
        observationId: observed ? observed.observationId : null, observationState: observed ? observed.state : null,
        receiptJson: observed && observed.state === 'observed-review' && observed.execution.receiptValidated ? receiptJson : null,
        ledger: observation.ledger };
      const bytes = R.encode(value); R.record(bytes, ctx.projectKey, input.batchId, input.runId);
      const resultHead = attempt.value.state === 'execution-unknown' ? J.save(ctx, input.runId, attempt, bytes) : null;
      return makeHandle({ ctx, input, snapshotId: snapshot.snapshotId, bytes, attemptHead: attempt.head, resultHead }, value);
    });
  } catch (error) { throw safe(error); }
}
function makeHandle(capture, value) {
  const handle = Object.freeze({ runId: capture.input.runId, recordDigest: R.sha(capture.bytes), outcome: value.outcome, ...R.authority() });
  handles.set(handle, capture); return handle;
}
function recoverUiReviewRun(root, runInputJson) {
  rootPath(root); const input = R.request(runInputJson);
  try {
    const ctx = G.context(root, input.batchId), attempt = A.read(ctx, input.runId);
    const result = J.read(ctx, input.runId, attempt);
    if (!result) C.fail('result_missing');
    const value = result.record, snapshotId = value.controlRecord.snapshot.snapshotId;
    if (input.expectedHead !== value.controlHead) C.fail('control_changed');
    control(ctx, input, snapshotId);
    if (G.readRef(A.context(ctx, input.runId)) !== attempt.head
      || G.readRef(J.context(ctx, input.runId)) !== result.head) C.fail('result_changed');
    return makeHandle({ ctx, input, snapshotId, bytes: result.bytes, attemptHead: attempt.head, resultHead: result.head }, value);
  } catch (error) { throw safe(error); }
}
function retainUiReviewRun(handle) {
  const capture = handles.get(handle); if (!capture) C.fail('handle_invalid');
  try {
    return withRuntimeWrites(capture.ctx.root, () => {
      const { ctx, input, snapshotId, bytes, attemptHead, resultHead } = capture;
      G.assertContext(ctx);
      if (resultHead && G.readRef(J.context(ctx, input.runId)) !== resultHead) C.fail('result_changed');
      const prior = stored(ctx, input.runId);
      if (prior) {
        if (prior.recordJson !== bytes) C.fail('run_conflict');
        return { ...prior, applied: false };
      }
      control(ctx, input, snapshotId);
      const rctx = runContext(ctx, input.runId), head = G.prepareCommit(ctx, input.expectedHead, bytes);
      G.assertContext(ctx);
      const transaction = `start\noption no-deref\nverify ${ctx.ref} ${input.expectedHead}\n`
        + `verify ${A.context(ctx, input.runId).ref} ${attemptHead}\n`
        + (resultHead ? `verify ${J.context(ctx, input.runId).ref} ${resultHead}\n` : '')
        + `create ${rctx.ref} ${head}\nprepare\ncommit\n`;
      const result = G.run(ctx, ['update-ref', '--stdin'], transaction, 2048);
      if (result.error || result.signal || result.status !== 0 || result.stderr) C.fail('publication_uncertain');
      try {
        const saved = stored(ctx, input.runId);
        if (!saved || saved.head !== head || saved.recordJson !== bytes) C.fail('publication_uncertain');
        return { ...saved, applied: true };
      } catch { C.fail('publication_uncertain'); }
    });
  } catch (error) { throw safe(error); }
}
function readUiReviewRun(root, batchId, runId) {
  rootPath(root); C.identifier(batchId); C.identifier(runId);
  try { const ctx = G.context(root, batchId), value = stored(ctx, runId); G.assertContext(ctx); return value; }
  catch (error) { throw safe(error); }
}
function readUiReviewAttempt(root, batchId, runId) {
  rootPath(root); C.identifier(batchId); C.identifier(runId);
  try {
    const ctx = G.context(root, batchId), attempt = A.read(ctx, runId), retained = stored(ctx, runId);
    const result = J.read(ctx, runId, attempt);
    if (!attempt) {
      G.assertContext(ctx);
      if (G.readRef(A.context(ctx, runId)) !== null
        || G.readRef(J.context(ctx, runId)) !== null
        || G.readRef(runContext(ctx, runId)) !== (retained ? retained.head : null)) C.fail('attempt_changed');
      return retained ? { schema: 'leerness.ui-review-attempt/v1', batchId, runId,
        state: 'legacy-retained', attemptHead: null, runCommit: retained.head, retryAllowed: false, ...R.authority() } : null;
    }
    if (retained) A.assertRecord(ctx, runId, attempt, retained.record);
    if (retained && result && retained.recordJson !== result.bytes) C.fail('result_conflict');
    G.assertContext(ctx);
    if (G.readRef(A.context(ctx, runId)) !== attempt.head
      || G.readRef(J.context(ctx, runId)) !== (result ? result.head : null)
      || G.readRef(runContext(ctx, runId)) !== (retained ? retained.head : null)) C.fail('attempt_changed');
    return { schema: 'leerness.ui-review-attempt/v1', batchId, runId,
      state: retained ? 'retained-record' : result ? 'observed-result' : attempt.value.state, attemptHead: attempt.head,
      resultCommit: result ? result.head : null,
      runCommit: retained ? retained.head : null, retryAllowed: false, ...R.authority() };
  } catch (error) { throw safe(error); }
}
function targetBlob(ctx, commit, file, limit) {
  const entry = G.output(ctx, ['ls-tree', '-z', commit, '--', file], undefined, 2048);
  const parts = /^(100644|100755) blob ([0-9a-f]+)\t([^\0]+)\0$/.exec(entry);
  if (!parts || !C.match(parts[2], C.OID) || parts[3] !== file) C.fail('retention_mismatch');
  // Binary, no checkout filters, CRLF conversion, text decoding, or unbounded buffering.
  return G.output(ctx, ['cat-file', 'blob', parts[2]], undefined, limit, null);
}
function readVerifiedUiReviewRunRetention(root, inputJson) {
  rootPath(root); const input = R.target(inputJson);
  try {
    const ctx = G.context(root, input.batchId), saved = stored(ctx, input.runId);
    if (!saved) C.fail('run_missing');
    const target = { ...ctx, ref: input.ref };
    if (G.readRef(target) !== input.commit) C.fail('target_changed');
    const recordBytes = targetBlob(ctx, input.commit, input.recordPath, 65536);
    if (!recordBytes.equals(Buffer.from(saved.recordJson))) C.fail('retention_mismatch');
    let totalBytes = 0;
    for (const f of saved.record.files) {
      const bytes = targetBlob(ctx, input.commit, f.path, Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - totalBytes));
      if (R.sha(bytes) !== saved.record.input.uiMaterials[0][f.kind + 'Digest']) C.fail('retention_mismatch');
      totalBytes += bytes.length;
    }
    G.assertContext(ctx);
    if (G.readRef(target) !== input.commit || G.readRef(runContext(ctx, input.runId)) !== saved.head) C.fail('target_changed');
    const retention = { schema: 'leerness.ui-review-run-retention/v1', runId: input.runId, batchId: input.batchId,
      runCommit: saved.head, recordDigest: saved.recordDigest, ref: input.ref, commit: input.commit,
      retained: true, materialFiles: saved.record.files.length, materialBytes: totalBytes,
      sourceTrust: 'local-ledger-declarations', ...R.authority() };
    return { ctx, saved, retention };
  } catch (error) { throw safe(error); }
}
function verifyUiReviewRunRetention(root, inputJson) {
  return readVerifiedUiReviewRunRetention(root, inputJson).retention;
}

module.exports = { INPUT_SCHEMA: R.INPUT_SCHEMA, RETENTION_SCHEMA: R.RETENTION_SCHEMA,
  observeUiReviewRun, recoverUiReviewRun, retainUiReviewRun, readUiReviewRun, readUiReviewAttempt, verifyUiReviewRunRetention,
  readVerifiedUiReviewRunRetention };
