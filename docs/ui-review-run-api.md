# UI review run retention API

This opt-in CommonJS API joins the existing UI material/ledger observer to immutable local Git records. It does not dispatch providers or grant review approval. Import `leerness/lib/ui-review-run` directly; it is not enabled by a CLI command, MCP tool or install hook.

## Observe, then retain

`await observeUiReviewRun(root, runInputJson, observationRequestJson, currentInputJson, reviewer)` returns an opaque in-process handle. Since 1.36.219, an outcome whose callback started is journaled in local Git before the handle is returned. `retainUiReviewRun(handle)` explicitly publishes the RunRecord without invoking the callback again. Copies/JSON reconstructions are not handles. A failed or unlinked observation can be retained as such. Invalid capture requests throw before creating a handle.

The run input is strict JSON (64 KiB, no unknown/duplicate fields):

```json
{
  "schema": "leerness.ui-review-run-input/v1",
  "runId": "run-1",
  "batchId": "batch-ui",
  "expectedHead": "0000000000000000000000000000000000000000",
  "generation": 1,
  "owner": { "sessionId": "session-1", "token": "<64 lowercase hex characters>" }
}
```

Use an actual full control commit and owner token from the review-control API. Before callback execution and before publication, the control owner, worktree, generation, published snapshot and expected head must agree. The UI input and current input must bind the same packet. Retention publishes a new create-only `refs/leerness/review-runs/v1/<projectKey>/<runId SHA-256>` ref while verifying the control ref in one Git transaction. The run commit contains only `record.json`, with the observed control commit as its parent; no source branch or index is changed. Control history remains the existing store.

RunRecord holds bounded validated input metadata, file selection/digests, observation result and ledger references, plus a validated receipt when available. It excludes source/render file bytes, raw ledger logs, prompts and owner tokens. Records are at most 64 KiB; explicit limits can reject a large combined input even when its components fit individually. Data supplied to this API must already satisfy the host's data policy.

An identical handle can reconcile a publication timeout by reading the existing identical record. A different result with the same run ID conflicts. `readUiReviewRun(root, batchId, runId)` can inspect persisted results in a fresh process. Since 1.36.218, observation also reserves the run ID durably and fences callback start as described below. Retention never reruns a callback. Failed publication can leave unreachable Git objects and does not claim rollback or perform cleanup.

## Durable attempts and interruption recovery

`observeUiReviewRun` now reserves `refs/leerness/review-attempts/v1/<projectKey>/<runId SHA-256>` before material/ledger capture. Its bounded canonical record contains the control revision and a digest of the normalized run input, observation request, current-input digest and owning worktree. It stores no raw token, material or callback error. Reuse the same run ID and exact request across retries; changing IDs defeats this per-ID protection. Different batches cannot reuse the same project/run ID.

| Observed state | Meaning and recovery |
| --- | --- |
| absent (`null`) | No durable attempt or retained result was observed. This is not proof that an older API or another host never executed. |
| `reserved` | No callback has crossed this reservation's start transaction. The identical request may resume through `observeUiReviewRun`, subject to fresh owner/control and CAS checks. |
| `execution-unknown` | A start transaction committed. The callback may be pending, running, finished, or never called because its response was lost. A new observation under this ID is refused. |
| `observed-result` | The completed local observation is journaled, but no RunRecord has been explicitly retained. Recover its handle using the original live owner/control and retain it without another callback. This may be a failed or invalid outcome. |
| `retained-record` | The existing immutable RunRecord matches the reservation. Read that result; it may describe failure or no execution. |
| `legacy-retained` | A valid RunRecord exists without an attempt record, as produced by older versions. It cannot establish an earlier reservation or execution fence. |

`readUiReviewAttempt(root, batchId, runId)` returns this state, attempt/run commit IDs, `resultCommit` when a journal exists, and the existing false authority flags. It is read-only, including in a fresh process or linked worktree. `retryAllowed` is always false: an observed status is not execution authorization. Reads check the attempt, result and run refs again and reject observed changes with `attempt_changed`; no read can prevent a writer from advancing immediately afterward.

Immediately before the host callback, one Git transaction verifies the current control ref, verifies the absence of a retained run and changes the reserved ref to `execution-unknown` using its exact old head. Only the caller receiving a successful transaction response proceeds. A loser or uncertain response throws rather than retaining a competing callback-failure result. No-execution observations keep `reserved`; retaining either outcome verifies the captured attempt head together with the control ref and creates the run ref atomically. This prevents a no-execution handle from overwriting a concurrently started attempt.

The reservation commit retains the control commit as parent; the start commit retains the reservation. A crash after reservation can resume the same request. A crash after start but before journal publication remains unknown, including a crash before the actual callback or while validating its response. A durable provider reconciliation adapter is still required for this gap. The API does not reconstruct results from caller declarations or the mutable ledger, assert that a provider did not execute, reset the reservation, retry under a fresh ID, or take over on a timer.

## Recover a journaled observation

`recoverUiReviewRun(root, runInputJson)` is a synchronous, read-only operation returning a new opaque handle from the journal. Supply the original run input, including its owner token. It verifies the current control revision, generation, owner and original worktree, then binds the journal to the exact execution attempt and request. It does not read current material files, replay the ledger or call a reviewer. The recovered observation is historical; target-byte verification and any future semantic/accepted-policy checks remain separate.

```js
const handle = recoverUiReviewRun(projectRoot, originalRunInputJson);
const saved = retainUiReviewRun(handle);
```

The journal uses create-only `refs/leerness/review-results/v1/<projectKey>/<runId SHA-256>`. Its commit contains the exact canonical RunRecord bytes and has the execution-unknown attempt commit as parent. Run retention still uses the original control parent and verifies the journal ref in its transaction. No-execution observations keep the existing reservation/handle flow and do not create a result journal. A lost journal publication response throws `publication_uncertain`; read and recover the saved outcome instead of invoking the reviewer again. A lost retention response is similarly reconciled with a recovered handle and identical bytes.

A late callback may journal its historical outcome after owner reclaim, but cannot recover or retain it under the changed control. Linked worktrees may inspect shared journal status; they cannot recover as the original worktree. Trusted local writers can alter refs, so these checks establish local consistency, not cryptographic provider authentication. Both failed and successful observations retain all false authority flags. Custom result refs also require explicit retention/transfer; ordinary branch pushes do not include them.

This is at-most-once callback entry for cooperating callers of this API, with the same run ID in one shared local repository. It is not exactly-once external execution or an authenticated reviewer. Direct calls to the lower-level observation/ledger APIs, older installed versions, other run IDs, clones/hosts and trusted-host ref deletion/reset are outside the fence. Custom attempt refs must be retained/transferred explicitly alongside run/control refs. Ordinary branch pushes do not transfer them. Owner reclaim fences later store writes but cannot cancel an already started external request.

## Verify a host-designated retained revision

`verifyUiReviewRunRetention(root, inputJson)` accepts:

```json
{
  "schema": "leerness.ui-review-run-retention-input/v1",
  "batchId": "batch-ui",
  "runId": "run-1",
  "ref": "refs/heads/review-records",
  "commit": "0000000000000000000000000000000000000000",
  "recordPath": "records/run-1.json"
}
```

The host explicitly commits the exact canonical RunRecord bytes and four observed material files at their original portable relative paths to its chosen retained revision. This API does not perform that integration. It checks the direct ref against the exact commit before and after reading, exact RunRecord bytes, regular blob modes and actual bounded file digests. It reuses the original selected paths; renaming files needs an explicit future mapping contract. A symlink, missing file, changed bytes, wrong record or moving ref fails. Reads bypass replacement objects and lazy network fetches using the existing Git gateway. File limits remain 1 MiB each / 8 MiB total.

Successful retention verification means bytes match at the designated local Git revision. It does not authenticate the host's claim that the ref is accepted, establish remote retention, prove source commit/manifest lineage, validate render origin, replay the original execution ledger or authenticate actors. It never changes current coverage or grants cleanup authority. A stale or failed run may be retained; its old observation remains historical. All results retain `actorIdentityVerified:false`, `semanticVerified:false`, `independentReview:'not-verified'`, `acceptedAuthorityVerified:false`, `approvalGranted:false`, `cleanupAllowed:false`.

## Storage and failure boundaries

Saved bound GET observations can use the separate
[result publication API](openai-ui-review-publication.md) to create this existing
result journal with the original observation UUID. It returns a recovery handle;
retaining that RunRecord remains an explicit call to `retainUiReviewRun`.

The shared review-control Git gateway supplies bounded shell-free commands, sanitized foreign Git environment, runtime/dry-run write guards, common-directory resolution and Git fsync settings. Ref transactions coordinate cooperating local writers; hostile local Git writers, hook effects, OS/power-loss durability and other clones are outside that boundary. No source bytes are automatically staged or published. Local custom refs require explicit retention/transfer and are not automatically cloned or pushed.

Errors use fixed codes through `ReviewControlError`; paths, tokens, raw callback errors and Git stderr are not returned. `publication_uncertain` requires read/reconciliation. `git_long_paths_required` means the user's own Git cannot read or lock a ref at the path length the call needs (Windows without `core.longpaths`); Git did not run for that call and it wrote no ref (see `review-control-api.md`). `attempt_conflict` rejects a changed reservation binding, `execution_unknown` prevents another observation after start, and `attempt_changed` rejects a changing recovery read. `result_missing` means no journal was found, not that execution did not happen. `result_conflict` rejects incompatible journal ancestry/bytes and `result_changed` rejects a changed journal during recovery/retention. `control_changed`, `owner_mismatch`, `stale_generation`, `snapshot_mismatch`, `run_conflict`, `target_changed`, `retention_mismatch` and strict input/record errors never imply approval. General finalization, authenticated dispatch, accepted-authority policy and managed cleanup remain separate work.
# Exact target assessment

Use [the target assessment API](ui-review-target.md) to combine the existing binary retention check with current review requirements and the explicit run/result journal commits. This read-only result preserves unverified authority and grants no approval.
