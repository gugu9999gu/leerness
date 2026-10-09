'use strict';

const C = require('./review-control-contract');
const G = require('./review-control-git');
const R = require('./ui-review-run-contract');
const A = require('./ui-review-attempt');
const E = require('./ui-review-result');
const J = require('./openai-ui-review-journal');
const O = require('./openai-ui-review-observation');
const B = require('./ui-review-recovery-bundle');
const Q = require('./openai-ui-review-request');
const L = require('./ui-review-ledger');
const F = require('./role-fallback');
const U = require('./ui-review-run');
const { rootPath, control } = require('./ui-review-run-context');
const { withRuntimeWrites } = require('./runtime-writes');
const { assertWriteAllowed } = require('./io');
const { assertGitWriteAllowed } = require('./git');
const POLICY = 'leerness.openai-ui-review-publication-policy/v1';
const handles = new WeakMap();
const authority = () => ({ ...R.authority(), executionBindingVerified: false, retryAllowed: false });
function safe(error) {
  if (error instanceof C.ReviewControlError) return error;
  if (error instanceof L.LedgerCorrelationError) return new C.ReviewControlError(error.code);
  return new C.ReviewControlError(['E_DRY_RUN_WRITE', 'E_RUNTIME_LAYOUT_INCOMPATIBLE', 'E_LOCK_BUSY',
    'E_LOCK_TIMEOUT', 'E_LOCK_OWNERSHIP_LOST', 'E_LOCK_RELEASE', 'ledger_sync_failed'].includes(error?.code)
    ? error.code : 'result_publication_unavailable');
}
function load(args) {
  const { root, runJson, currentJson, profileJson, policyJson } = args;
  rootPath(root);
  const policy = R.parse(policyJson);
  Q.exact(policy, ['schema', 'observationHead', 'reviewOfAttemptId', 'retention']);
  if (policy.schema !== POLICY || !C.match(policy.observationHead, C.OID)
    || policy.retention !== 'local-git-until-explicit-removal') C.fail('publication_policy_invalid');
  C.identifier(policy.reviewOfAttemptId);
  // Only the durable journal is an input. No caller receipt or callback can stand in for it.
  const { observed, context: original } = O.readStoredContext(root, runJson, currentJson, profileJson);
  if (!observed) C.fail('observation_missing');
  if (observed.recordHead !== policy.observationHead) C.fail('observation_changed');
  const { run, ctx, journal } = original;
  if (!journal || journal.intent.head !== observed.intentHead || journal.locator?.head !== observed.locatorHead
    || journal.attempt.head !== observed.attemptHead) C.fail('observation_changed');
  const receipt = R.parse(observed.receiptJson), intent = journal.intent.value;
  if (receipt.execution !== 'completed') C.fail('review_not_completed');
  if (intent.request.input.contributors.filter(c => c.attemptId === policy.reviewOfAttemptId).length !== 1) C.fail('review_parent_mismatch');
  const s = { args, policy, observed, run, ctx, journal, receipt, intent };
  s.observationRef = `refs/leerness/provider-observations/v1/${ctx.projectKey}/${C.digest(run.runId).slice(7)}`;
  s.binding = { run, policy, observationDigest: observed.recordDigest, intentHead: observed.intentHead,
    locatorHead: observed.locatorHead, attemptHead: observed.attemptHead, receiptDigest: observed.receiptDigest };
  s.publicationDigest = C.digest(s.binding);
  const evidenceRefs = [intent.packetId, intent.selectionDigest, observed.receiptDigest,
    ...observed.ledger.implementationEventIds, observed.recordDigest, s.publicationDigest,
    ...['source', 'spec', 'diff', 'render'].map(k => intent.request.input.uiMaterials[0][k + 'Digest'])];
  s.expectedEvent = F.normalizeExecutionEvent({ schemaVersion: 1, event: 'review.completed',
    eventId: 'review-observation-' + observed.observationId, taskId: intent.request.input.uiMaterials[0].taskId,
    attemptId: receipt.attemptId, parentAttemptId: policy.reviewOfAttemptId, reviewOfAttemptId: policy.reviewOfAttemptId,
    requestedRole: 'reviewer', actualExecutor: { ...receipt.reviewer, identitySource: 'local-bound-get-declaration' },
    executed: true, reviewerIndependent: null, review: { uiBoundary: receipt.review },
    evidenceRefs });
  // Ledger redaction must not silently turn a required reference into a different
  // value. Reject an unrepresentable binding before writing a terminal event.
  if (C.stable(s.expectedEvent.evidenceRefs) !== C.stable(evidenceRefs)) C.fail('review_evidence_unbound');
  // The shared reader already validates the journal, current owner, materials
  // and complete GET-time ledger prefix. Write boundaries recheck them below.
  return s;
}
function fences(s) {
  return [[s.ctx.ref, s.run.expectedHead], [s.observationRef, s.observed.recordHead],
    [J.context(s.ctx, s.run.runId).ref, s.journal.intent.head],
    [J.context(s.ctx, s.run.runId, true).ref, s.journal.locator.head]];
}
function check(s) {
  control(s.ctx, s.run, s.journal.snapshotId); J.unchanged(s.ctx, s.run.runId, s.journal);
  if (G.readRef({ ...s.ctx, ref: s.observationRef }) !== s.observed.recordHead) C.fail('observation_changed');
  B.restore(s.ctx.root, s.intent, false, { bytes: s.observed.ledger.afterBytes, digest: s.observed.ledger.afterDigest });
  control(s.ctx, s.run, s.journal.snapshotId); J.unchanged(s.ctx, s.run.runId, s.journal);
  if (G.readRef({ ...s.ctx, ref: s.observationRef }) !== s.observed.recordHead) C.fail('observation_changed');
}
function inspect(s) {
  return L.inspectUiReviewLedgerTerminal(s.ctx.root, JSON.stringify(s.intent.request.input), s.intent.recovery.ledger,
    { bytes: s.observed.ledger.afterBytes, digest: s.observed.ledger.afterDigest },
    s.observed.receiptJson, s.intent.selectionDigest, s.expectedEvent);
}
function record(s, terminal) {
  const original = G.readCommit(s.ctx, s.run.expectedHead);
  const value = { schema: R.RECORD_SCHEMA, projectKey: s.ctx.projectKey, batchId: s.run.batchId, runId: s.run.runId,
    controlHead: s.run.expectedHead, controlRecord: C.record(original.bytes, s.ctx.projectKey, s.run.batchId),
    input: s.intent.request.input, currentInputDigest: s.intent.currentInputDigest, files: s.intent.request.files,
    packetId: s.intent.packetId, selectionDigest: s.intent.selectionDigest, outcome: 'ledger-linked', reasonCode: null,
    observationId: s.observed.observationId, observationState: 'observed-review', receiptJson: s.observed.receiptJson,
    ledger: terminal.ledger };
  const bytes = R.encode(value);
  if (Buffer.byteLength(bytes) > 65536) C.fail('record_limit');
  R.record(bytes, s.ctx.projectKey, s.run.batchId, s.run.runId);
  A.assertRecord(s.ctx, s.run.runId, s.journal.attempt, value);
  return bytes;
}
function prior(s, terminal) {
  const result = E.read(s.ctx, s.run.runId, s.journal.attempt);
  const retained = U.readUiReviewRun(s.ctx.root, s.run.batchId, s.run.runId);
  if ((result || retained) && !terminal.event) C.fail('result_conflict');
  if (result || retained) {
    const bytes = record(s, terminal);
    if ((result && result.bytes !== bytes) || (retained && retained.recordJson !== bytes)
      || (retained && !result)) C.fail('result_conflict');
  }
  return { result, retained };
}
function prepareOpenAiUiReviewPublication(root, runJson, currentJson, profileJson, policyJson) {
  try {
    const args = { root, runJson, currentJson, profileJson, policyJson }, s = load(args), terminal = inspect(s);
    const { result, retained } = prior(s, terminal);
    capacity(s, terminal);
    // Validate the full record size/shape before allowing any new ledger write.
    record(s, terminal.event ? terminal : { ledger: { beforeDigest: s.observed.ledger.beforeDigest,
      afterDigest: R.sha(''), implementationEventIds: s.observed.ledger.implementationEventIds,
      reviewEventId: s.expectedEvent.eventId, receiptDigest: s.observed.receiptDigest } });
    check(s);
    const handle = Q.freeze({ schema: 'leerness.openai-ui-review-publication-preview/v1', runId: s.run.runId,
      publicationDigest: s.publicationDigest, observationHead: s.observed.recordHead, observationId: s.observed.observationId,
      reviewOfAttemptId: s.policy.reviewOfAttemptId, reviewEventId: s.expectedEvent.eventId,
      terminalPresent: !!terminal.event, resultHead: result?.head || null, runRecordRetained: !!retained, assessment: s.observed.assessment,
      retention: s.policy.retention, ...authority() });
    handles.set(handle, { args, binding: C.stable(s.binding) }); return handle;
  } catch (error) { throw safe(error); }
}
function publishOpenAiUiReviewResult(handle, approvedDigest) {
  const saved = handles.get(handle);
  if (!saved) C.fail('publication_handle_invalid');
  if (approvedDigest !== handle.publicationDigest) C.fail('publication_approval_mismatch');
  try {
    return withRuntimeWrites(saved.args.root, () => {
      assertWriteAllowed(saved.args.root); assertGitWriteAllowed();
      const s = load(saved.args);
      if (C.stable(s.binding) !== saved.binding) C.fail('publication_binding_changed');
      return F.withExecutionLedgerLock(s.ctx.root, () => {
        check(s);
        let terminal = inspect(s); const existing = prior(s, terminal);
        capacity(s, terminal);
        if (!terminal.event) {
          // All interpretation and prior-result checks precede the first event write.
          F.appendExecutionEvent(s.ctx.root, s.expectedEvent);
          terminal = inspect(s);
          if (!terminal.event) C.fail('review_terminal_missing');
        } else F.synchronizeExecutionLedger(s.ctx.root);
        const bytes = record(s, terminal);
        check(s);
        const resultHead = E.save(s.ctx, s.run.runId, s.journal.attempt, bytes, fences(s));
        check(s);
        const final = inspect(s), result = E.read(s.ctx, s.run.runId, s.journal.attempt);
        if (!final.event || record(s, final) !== bytes || result?.head !== resultHead || result.bytes !== bytes) C.fail('publication_uncertain');
        return Q.freeze({ schema: 'leerness.openai-ui-review-published-result/v1', runId: s.run.runId,
          observationId: s.observed.observationId, reviewEventId: final.event.eventId,
          resultHead, recordDigest: R.sha(bytes), ledgerLinked: true, runRecordRetained: !!existing.retained,
          runHandle: U.recoverUiReviewRun(s.ctx.root, saved.args.runJson), ...authority() });
      });
    });
  } catch (error) { throw safe(error); }
}

function capacity(s, terminal) {
  if (terminal.event) return;
  const bytes = Buffer.byteLength(JSON.stringify({ ...s.expectedEvent, at: new Date().toISOString() }) + '\n');
  if (terminal.currentEvents >= L.MAX_EVENTS) C.fail('ledger_event_limit');
  if (terminal.currentBytes + bytes > L.MAX_LEDGER_BYTES) C.fail('ledger_byte_limit');
}

module.exports = { POLICY, prepareOpenAiUiReviewPublication, publishOpenAiUiReviewResult };
