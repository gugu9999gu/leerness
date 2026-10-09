'use strict';

const C = require('./review-control-contract');
const G = require('./review-control-git');
const R = require('./ui-review-run-contract');
const U = require('./ui-review-run');
const A = require('./ui-review-attempt');
const J = require('./ui-review-result');
const UI = require('./ui-review');
const { rootPath } = require('./ui-review-run-context');
const INPUT_SCHEMA = 'leerness.ui-review-target-input/v1';

function request(text) {
  const v = R.parse(text), keys = ['schema', 'target', 'runCommit', 'resultCommit', 'recordDigest'];
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length
    || keys.some(k => !Object.hasOwn(v, k)) || v.schema !== INPUT_SCHEMA
    || !C.match(v.runCommit, C.OID) || !C.match(v.resultCommit, C.OID)
    || !C.match(v.recordDigest, /^sha256:[0-9a-f]{64}$/)) C.fail('input_invalid');
  R.target(R.encode(v.target));
  return v;
}

// A read-only observation of exact retained bytes and current declarations.
// Neither a ref name nor a matching digest supplies an approval authority.
function assessUiReviewTarget(root, inputJson, currentInputJson) {
  rootPath(root);
  const input = request(inputJson);
  UI.createUiReviewPacket(currentInputJson); // Reject malformed current input before Git reads.
  try {
    const { ctx, saved, retention } = U.readVerifiedUiReviewRunRetention(root, R.encode(input.target));
    if (saved.head !== input.runCommit || saved.recordDigest !== input.recordDigest) C.fail('target_record_mismatch');
    const attempt = A.read(ctx, input.target.runId), result = J.read(ctx, input.target.runId, attempt);
    if (!result) C.fail('result_missing');
    if (result.head !== input.resultCommit || result.bytes !== saved.recordJson) C.fail('target_result_mismatch');
    const assessment = UI.assessUiReview(R.encode(saved.record.input), currentInputJson,
      saved.record.receiptJson === null ? undefined : saved.record.receiptJson);
    G.assertContext(ctx);
    const refs = [[input.target.ref, input.target.commit], [saved.ref, saved.head],
      [A.context(ctx, input.target.runId).ref, attempt.head], [J.context(ctx, input.target.runId).ref, result.head]];
    for (const [ref, head] of refs) if (G.readRef({ ...ctx, ref }) !== head) C.fail('target_changed');
    return {
      schema: 'leerness.ui-review-target-assessment/v1', scope: 'ui-boundary-only',
      target: { ref: input.target.ref, commit: input.target.commit, recordPath: input.target.recordPath },
      run: { batchId: input.target.batchId, runId: input.target.runId, runCommit: saved.head,
        resultCommit: result.head, recordDigest: saved.recordDigest, controlHead: saved.record.controlHead,
        outcome: saved.record.outcome, reviewEventId: saved.record.ledger.reviewEventId },
      materials: { bytesVerified: true, files: retention.materialFiles, bytes: retention.materialBytes },
      currentInputDigest: C.digest(R.parse(currentInputJson)), assessment,
      sourceTrust: 'local-git-records-and-declarations', ...R.authority(),
      effects: { filesRead: true, filesWritten: false, networkUsed: false, modelInvoked: false },
    };
  } catch (error) {
    if (error instanceof C.ReviewControlError || error instanceof UI.UiReviewInputError) throw error;
    throw new C.ReviewControlError('target_unavailable');
  }
}

module.exports = { INPUT_SCHEMA, assessUiReviewTarget };
