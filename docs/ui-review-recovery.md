# Restore the original inputs of an interrupted UI review

The OpenAI dispatch API can preserve one task's four original material files before POST and recheck the original ledger prefix in a later process. Enable this by explicitly passing a sixth JSON argument to `prepareOpenAiUiReviewDispatch`. Omitting it keeps the existing v1 behavior and does not retain material bytes.

```js
const api = require('leerness/lib/openai-ui-review-dispatch');
const policy = JSON.stringify({
  schema: 'leerness.ui-review-recovery-policy/v1',
  materials: 'local-git-until-explicit-removal',
  ledger: 'identity-and-prefix-digest',
  reviewAttemptId: originalReviewAttemptId,
});
const preview = api.prepareOpenAiUiReviewDispatch(
  root, originalRunJson, observationRequestJson, currentInputJson, configJson, policy,
);
// Show the operator the materials, local retention policy and preview.recovery.
// The approved digest covers that policy and the exact original baseline.
await api.dispatchOpenAiUiReviewRun(preview, approvedRequestDigest, apiKey);

// Later, with the original owner's run input and unchanged current packet:
const restored = api.recoverOpenAiUiReviewDispatch(root, originalRunJson, currentInputJson);
const materials = api.readRecoveredUiReviewMaterials(restored);
```

Preparation performs no writes. It records file and parent identity, paths, byte lengths and digests of source/spec/diff/render; it reads the existing execution ledger, validates implementation events and requires the declared `reviewAttemptId` to be absent. The ledger must already exist and pass the existing single-task correlation checks. `preview.recovery` discloses the policy and comparison metadata, including local resolved paths. Changing any of these changes the approval digest. JSON copies cannot substitute for the preparation or recovered handle.

This local retention policy is separate from the provider's `store` option. The explicit policy retains actual material bytes in the repository's Git object store until a separately managed removal. There is no automatic expiry, encryption or deletion operation. Backup and distribution policy must account for retained source/spec/diff/render and path/identity metadata. Credentials and provider output are excluded. The raw ledger is not copied into Git: only its original byte length, digest, identity, event count and implementation IDs are kept. Losing or rotating the original ledger prevents recovery.

The v2 intent has one parent: a bounded bundle commit containing exactly `record.json` and four material blobs. That bundle has the reserved attempt as its parent. This real Git ancestry retains the bundle and blobs through GC while the intent ref remains. Existing v1 records retain their original one-record tree contract. Material limits remain 1 MiB per file; the intent remains at most 64 KiB and HTTP body at most 4 MiB. No branch, index, working file or second mutable database is updated.

| Interruption | Recovery meaning |
| --- | --- |
| Before intent publication | Unreachable objects are not durable evidence; recovery fails. |
| After intent, before execution fence | Inputs may be restored; the attempt is still reserved. The restored handle cannot send a request. |
| After execution fence, before response locator | Original inputs can be inspected, but execution remains unknown. No retry is authorized. |
| After response locator | Original inputs and the located response are available through their separate read-only APIs. Neither constitutes a validated review receipt. |

Submission rechecks the complete original files and ledger before the fence, including through the internal submit entry point. Recovery revalidates canonical Git content/ancestry, the original run/current owner and current input digest, the retained bytes against their digests, and current file content/identity against the pre-dispatch observations. It permits an append to the ledger only when the original file/parent identity and exact old prefix remain intact. Prefix edits, file replacement, loss, invalid appended records, stale materials, owner changes and another worktree fail closed. It never writes retained bytes back to a project. Read checks cannot prevent a non-cooperating local writer from changing a file immediately after the last check.

`recoverOpenAiUiReviewDispatch` returns a frozen handle with `recoveryState: "inputs-restored"`, the historical dispatch state, material descriptors and before/after ledger digests and lengths. `readRecoveredUiReviewMaterials` rechecks current control, heads and files before returning fresh mutable buffer copies. Copies do not mutate the retained evidence. Both operations are read-only and make no provider request. Legacy v1 dispatches have no original baseline and return `recovery_missing`; they are never upgraded retroactively.

The result is trusted local comparison evidence, not actor authentication or independent semantic review. `runRecordRestored`, `approvalGranted`, `semanticVerified`, `actorIdentityVerified`, `executionBindingVerified` and `retryAllowed` remain false. A free-form provider output cannot be treated as the original callback receipt. Output/receipt validation, the original reviewer event, RunRecord/result journal linkage and final approval remain separate work.

Run `node scripts/ui-review-recovery-probe.js` for real temporary Git repositories, process interruption and loopback TLS checks; `--smoke` selects three bounded cases. No live provider or real credentials are used.
