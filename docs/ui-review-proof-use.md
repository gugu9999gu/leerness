# One-time use of a verified UI review proof

`host.consume(prepared, proofJson, currentInputJson)` verifies the proof using the existing host checks, then records its use in local Git. The host must have a durable policy floor. The two existing methods, `prepare` and `verify`, do not consume proofs.

```js
const S = require('leerness/lib/ui-review-authority-floor');
const H = require('leerness/lib/ui-review-authority-host');
const U = require('leerness/lib/ui-review-proof-use');
const floor = S.openUiReviewAuthorityFloor(root, anchorJson);
const host = H.createUiReviewAuthorityHost(anchorJson, readCurrentPolicy, floor);
const prepared = host.prepare(root, runJson, targetJson, currentInputJson, challengeJson);
// Obtain the signer-generated proof for prepared.signingText.
const used = host.consume(prepared, proofJson, freshCurrentInputJson);
// Recovery after a restart, lost acknowledgement, or expiry:
const historical = U.readUiReviewProofUse(root, anchorJson, challengeId);
```

Each project/challenge ID has one immutable ref at `refs/leerness/ui-review-proof-use/v1/<projectKey>/<challengeId>`. The record retains the signed payload, proof, host public anchor and policy certificate. Its parent is the bound control commit. It contains no raw owner token, private signing key or UI material contents. A duplicate of the exact record returns `applied: false`; a different signed payload for the same challenge is rejected. Different anchors cannot reuse an existing challenge scope either. The trusted host must generate unpredictable challenge IDs.

Before the first publication, a single Git ref transaction verifies the target branch, retained run, result, attempt, control and policy-floor heads, then creates the consumption ref. A changed or deleted reference prevents publication. Existing Git/runtime write guards and fsync settings apply. Branch history, the index and working files are untouched. Objects prepared before a failed transaction may remain unreachable; failure does not mean no object files were written.

`publication_uncertain` means the operation may have committed. Read the historical record before deciding what to do next. A consumed record is not deleted on timeout or expiry. Time is checked before and after publication; expiry at the final check reports uncertainty and leaves the record available for recovery. Exact replay requires a currently valid proof and fresh host checks. Historical lookup works after expiry and does not require a live owner or unchanged target.

The historical reader validates the pinned anchor, policy certificate signature, payload/signature correspondence, scope, canonical bytes and control parent. It returns `null` when no record is observed. Missing state does not prove that no earlier record was deleted by privileged code. Corrupt, conflicting, symbolic or changed records fail closed.

Results have `challengeConsumed: true`, `historical: true`, `signatureVerified: true`, `applied`, `head`, `recordDigest` and `payloadDigest`. They deliberately retain `targetBindingVerified: false`, `policySourceVerified: false`, and false identity/approval/cleanup flags: this is evidence of past use, not a current approval or authenticated person's consent. The host result also reports whether this call wrote policy state or a consumption record.

The writer's internal entry point accepts only an opaque result produced by the actual authorization verifier. Deserializing a success-shaped JSON result does not create that provenance. All modules execute as trusted host code; this is not a sandbox against code that can directly edit Git or replace the library.

Policy source freshness, a hostile whole-store rollback, changes after the transaction, wall-clock manipulation and remote identity authentication are outside this local transaction. Current UI input is supplied by the embedding host; Git cannot atomically observe an external UI source. A future authenticated approval writer must check identity, explicit consent and its own publication boundary. Do not treat a successful consume call as permission to delete data or publish an approval.

Run `npm run test:ui-review-proof-use` for the component suite or `npm run test:ui-review-proof-use-smoke` for four focused groups. Tests use real temporary Git repositories and child processes, ephemeral fixture keys and no network.
