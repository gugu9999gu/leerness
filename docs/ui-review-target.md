# Compare a retained UI review with an exact target

`lib/ui-review-target.js` compares a retained RunRecord and its result journal with a named local Git revision and current review requirements. It reads existing records; it does not publish an approval or run a reviewer.

```js
const T = require('leerness/lib/ui-review-target');
const U = require('leerness/lib/ui-review-run');

const assessment = T.assessUiReviewTarget(absoluteProjectRoot, JSON.stringify({
  schema: T.INPUT_SCHEMA,
  target: {
    schema: U.RETENTION_SCHEMA,
    batchId, runId,
    ref: 'refs/heads/release-candidate',
    commit: exactTargetCommit,
    recordPath: 'review/run.json',
  },
  runCommit: expectedRetainedRunCommit,
  resultCommit: expectedResultJournalCommit,
  recordDigest: expectedRunRecordDigest,
}), currentUiReviewInputJson);
```

All identifiers are required. Inputs are bounded strict JSON. Unknown fields, including `accepted`, are rejected. The target must use a direct `refs/heads/...` ref, an exact commit, and a portable relative record path. A symbolic ref is not accepted. A digest uses `sha256:<64 lowercase hex digits>`.

## What is checked

1. Reuse `verifyUiReviewRunRetention`'s reader to verify the retained RunRecord, its original control parent, and the exact target record bytes. The four source/spec/diff/render files must match their original binary digests at that commit. Checkout edits and filters do not replace committed bytes.
2. Match the explicit run commit and record digest. Read the original attempt and result journal using their existing validators. The result commit must equal the explicit result commit, and its canonical record bytes must equal the retained record.
3. Reuse `assessUiReview` to compare original and current task, snapshot, criteria, policy, dependencies, materials and contributors. Preserve its coverage, execution, findings and declared independence assessment.
4. Recheck repository topology and the target, run, attempt and result refs before returning. An observed change fails the call.

The internal `readVerifiedUiReviewRunRetention` helper shares the existing validated record with this consumer, avoiding a second complete record read. The existing `verifyUiReviewRunRetention` return contract is unchanged.

## Read the result in separate parts

| Field | Meaning |
| --- | --- |
| `target` | Exact ref, commit and record path observed during the check. |
| `run` | Original run/result commits, record digest, control head, ledger outcome and terminal event ID. An `unlinked` record stays unlinked. |
| `materials` | Whether the four named files matched their stored digests, and their count/byte size. |
| `currentInputDigest` | Digest of the current declarations supplied for this call. |
| `assessment` | Existing UI review assessment, including changed bindings, receipt binding, declared coverage, execution, findings and declared independence. |
| Authority fields | Actor identity, semantics and accepted authority remain unverified; approval and cleanup remain false. |
| `effects` | Files were read; no files were written, network used, or model invoked. |

`assessment.state` may be `stale`, `incomplete`, `findings`, `self-review`, `identity-unverified`, `not-reviewed`, or another existing assessor state. `review-candidate` means compatible declarations, not an independently verified or approved result. A receipt can declare completion without a correlated terminal; consult `run.outcome` separately.

The nested assessor is a pure function: its `effects` and `verification` describe declaration assessment. Top-level `materials` and `effects` describe the actual Git reads. Neither authenticates the reviewer, proves semantic quality, or grants accepted-target authority. A branch named `accepted` has no special meaning.

## Errors and limits

Malformed target descriptors fail with `input_invalid`; malformed current review input retains the existing `UiReviewInputError` codes. Existing storage errors such as `run_missing`, `record_invalid`, `ref_invalid`, `retention_mismatch`, `result_conflict` and `git_failed` remain failures. New mismatches use `target_record_mismatch` or `target_result_mismatch`. A missing result is `result_missing`; a ref movement is `target_changed`.

This function creates no refs, journal entries, locks, coverage records or approval receipt. It can inspect history after live control ownership changes, and therefore must not be treated as a live ownership check for a future write. Its result is a point-in-time read, not a transaction or reusable authorization. It cannot detect a ref that moves away and returns between observations, or a local actor who rewrites all related history.

The verified scope is the record and four declared material files. Extra files in a target commit are outside that scope. Current requirements are caller declarations, not a trusted host's authoritative configuration. Authenticating the host, validating the meaning of the review independently, and binding a later approval or deployment to a current exact target require separate contracts.

Run `npm run test:ui-review-target` for the complete local Git probe, `npm run test:ui-review-target-smoke` for four core groups, or `node scripts/ui-review-target-probe.js --filter "<name substring>"` for a failing group. A selection matching no tests fails. Tests use synthetic local fixtures, with no provider requests.
