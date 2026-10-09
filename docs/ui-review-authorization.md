# Signed UI review proof checks (RB-03D1)

`lib/ui-review-authorization.js` checks that a signature covers an exact retained UI review target, the live owner/control record, and a bounded validity period. It uses `ui-review-target` and `ui-review-run-context` to re-read the existing records. It creates no files, refs, approval records, network requests, model executions, or production keys.

This is a library component. CLI/MCP approval commands, trusted host policy registration and actual approval publication are not implemented here.

## Prepare the bytes to sign

`prepareUiReviewAuthorization(root, runJson, targetJson, currentInputJson, policyJson, challengeJson)` requires an absolute root and JSON strings. `runJson` is the existing UI run request including the current owner's token. `targetJson` is the exact descriptor from [UI target assessment](ui-review-target.md). `currentInputJson` is an explicitly supplied current UI input, not a stored fallback.

The policy has exactly these fields:

| Field | Contract |
| --- | --- |
| `schema` | `leerness.ui-review-authorization-policy/v1` |
| `issuerId`, `keyId`, `projectKey` | Review-control identifiers; the project must match the resolved Git context |
| `publicKeySpki` | Canonical base64 of a 44-byte Ed25519 public SPKI DER key |
| `targetRef` | Exact allowed `refs/heads/…` target ref |
| `maxValidityMs` | Integer from 1 through 3,600,000 |

The challenge has exactly `challengeId` (64 lowercase hex characters), `issuedAt` and `expiresAt` (integer Unix milliseconds). The host should issue a fresh unpredictable challenge. Issuance must not be in the future, expiry must be strictly later than now, and duration must not exceed the policy. Time is checked before and after reads; this depends on the local clock.

The returned, deeply frozen handle contains `payload`, `signingText` and `payloadDigest`. The payload binds the policy digest, challenge, project/worktree, owner session and token **digest**, generation/control head, target ref/commit/record path, attempt/run/result commits, record digest and current input digest. It does not expose the owner token. The text to sign is the literal domain prefix `leerness.ui-review-authorization/v1\n` followed by the existing canonical sorted JSON encoding of the payload, including its trailing newline. Sign its UTF-8 bytes without trimming or reformatting. `payloadDigest` is SHA-256 of those exact bytes.

Use the standard Ed25519 algorithm with a null algorithm parameter, as specified by [Node's crypto API](https://nodejs.org/docs/latest-v18.x/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback). The implementation uses Node's built-in key parsing and signature verification. It adds no cryptographic dependencies or custom signature algorithm.

## Verify with fresh inputs

`verifyUiReviewAuthorization(handle, proofJson, currentPolicyJson, currentInputJson)` requires the original in-process handle; a JSON copy is rejected. Supply the current policy and current input again. The proof has exactly:

```json
{
  "schema": "leerness.ui-review-authorization-proof/v1",
  "payloadDigest": "sha256:<digest from preparation>",
  "signature": "<canonical base64 of the 64-byte Ed25519 signature>"
}
```

Malformed keys, extra authority fields, changed policy, expired/future proofs, wrong signatures, moved control/target records, changed current input, incomplete/self-review findings or unlinked reviews fail closed. The underlying assessment must be `review-candidate` and the saved run must be `ledger-linked`. These are compatibility checks over local evidence and declarations, not independent semantic review.

Successful output has `signatureVerified: true` and `targetBindingVerified: true`. `policySourceVerified`, `challengeConsumed`, `actorIdentityVerified`, `semanticVerified`, `acceptedAuthorityVerified`, `approvalGranted` and `cleanupAllowed` remain **false**. `independentReview` remains `not-verified`.

## Remaining authority boundary

The optional seventh preparation argument, `policySourceDigest`, is a SHA-256 digest supplied by an integrating policy verifier. When present, the signing payload and text domain use `v2` and include that digest. Without it, the original `v1` payload/text are preserved. Providing a digest itself confers no trust or permission. The [host policy wrapper](ui-review-authority-host.md) computes it from the pinned anchor and verified current policy certificate, and checks the policy again after target verification.

The caller supplies the policy. This component cannot establish that the key belongs to an authorized person or that the policy came from a trusted host. A malicious caller can supply its own key and valid signature; that yields a signature check only. The result must not be used as an approval, cleanup permission or independent-review claim.

Repeated checking of the same proof is allowed until expiry; no challenge is consumed. Trusted policy provenance, one-time challenge consumption, atomic approval writing, authenticated reviewer identity and independent semantic review remain separate work. Reference rechecks observe multiple instants, not a repository-wide atomic transaction; ABA changes or hostile history replacement are outside this guarantee. A later writer must revalidate at its own mutation boundary.

Run `npm run test:ui-review-authorization` for all component cases, or `npm run test:ui-review-authorization-smoke` for the focused normal/signature/policy/time groups. The tests use actual temporary Git repositories and ephemeral in-memory signing keys.
