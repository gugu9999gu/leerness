# Host-pinned UI approval policy signatures (RB-03D2)

`createUiReviewAuthorityHost(anchorJson, readPolicy)` in `lib/ui-review-authority-host.js` pins a host's policy-signing key and scope once, then checks the signed current policy before and after each preparation or proof verification. Individual review requests cannot supply a replacement policy or select another signer.

This verifies a signature chain relative to host configuration. It does **not** authenticate that configuration, the host or a person. `policySourceVerified`, `acceptedAuthorityVerified`, `approvalGranted`, `cleanupAllowed`, and the existing identity/semantic flags remain false. Successful `policySource.policySignatureVerified` describes only the cryptographic check against the pinned key. No approval record or one-time challenge is written.

## Trusted bootstrap contract

Call this factory from trusted embedding code. Do not populate the anchor or reader from a project file, agent message, review request, or model response. The library does not discover a default key, create a key, register a host, read home configuration or contact a service. Production host registration and authentication are separate integration work.

The anchor JSON has exactly:

| Field | Contract |
| --- | --- |
| `schema` | `leerness.ui-review-authority-anchor/v1` |
| `hostId`, `projectKey` | Review-control identifiers |
| `publicKeySpki` | Canonical base64 of the policy signer's Ed25519 public SPKI DER key |
| `targetRef` | Exact allowed branch ref under `refs/heads/` |
| `minRevision` | Positive safe integer: host-supplied current revision floor |
| `maxPolicyValidityMs` | Safe integer from 1 through 86,400,000 |

The key signs **policies**; each policy supplies the separate key used to sign a particular target proof. The host object is frozen and its anchor is fixed. Reconfiguring an anchor requires a new host object; existing handles do not transfer across instances.

`readPolicy` must synchronously return a bounded JSON string. It is trusted code, not a sandbox, and owns its side effects, freshness and execution time. A missing reader, exception, Promise or non-string result fails closed. The host does not cache a successful policy as a fallback when a later read fails. Recursive host calls from the reader are rejected.

## Signed policy envelope

The returned JSON has exactly `schema`, `hostId`, `revision`, `issuedAt`, `expiresAt`, `policy` and `signature`.

- `schema` is `leerness.ui-review-authority-policy/v1`; `hostId` matches the anchor.
- `revision` is a positive safe integer at least the anchor's floor.
- `issuedAt` and `expiresAt` are integer Unix milliseconds. The policy must currently be valid and fit the anchor's maximum duration.
- `policy` is the complete [target-proof policy](ui-review-authorization.md), matching the pinned project and target ref. A signed `null` policy revokes the scope.
- `signature` is canonical base64 of a 64-byte Ed25519 signature. Sign UTF-8 bytes of `leerness.ui-review-authority-policy/v1\n` followed by canonical sorted JSON of the other six fields and its trailing newline. Use the existing `ui-review-run-contract.encode` representation and Node's built-in Ed25519 support.

Within one host instance, a successfully verified higher revision advances an in-memory floor, including a signed revocation. Older revisions then fail. A different certificate at the same observed revision also fails, even when both signatures are valid. Whitespace/key ordering do not change the canonical certificate identity.

This floor is not durable. On restart, the embedding host must supply its retained current `minRevision` and an authoritative current-policy reader. A previously signed policy can remain acceptable until its expiry if a newer revision or revocation has never been observed. The library does not claim freshness from signature validity alone.

## Prepare and verify

```js
const host = createUiReviewAuthorityHost(anchorJson, readPolicy);
const prepared = host.prepare(root, runJson, targetJson, currentInputJson, challengeJson);
// Give prepared.signingText and payloadDigest to the authorized target signer.
const observation = host.verify(prepared, proofJson, freshCurrentInputJson);
```

Preparation uses the existing exact-target/current-owner checks. It rejects a challenge extending beyond the policy's expiry. The new `v2` signing payload binds `policySourceDigest`, covering the anchor, signed certificate identity, revision and expiry. A renewed certificate with an unchanged leaf policy therefore still requires different proof bytes. The `v1` direct API remains available and unchanged when no source digest is supplied.

Verification requires the original handle from that host instance. It re-reads the policy, checks the target signature and current Git/control state, then re-reads the policy and checks challenge time again. Missing, revoked, expired, conflicting or changed policy aborts the operation. Files/ref writes, approval publication, challenge consumption and model invocation are not performed by this module.

The policy and Git reads are observations at multiple instants, not a cross-store transaction. Callback actions, unobserved policy rollback, ABA, a hostile process replacing trusted code, and changes after the final observation are not prevented. A future approval writer must check its own mutation boundary, authenticate the host/approver and consume challenges durably. A successful policy signature is not independent semantic review or permission to clean up source data.

Tests: `npm run test:ui-review-authority-host` selects all component groups; `npm run test:ui-review-authority-host-smoke` selects four normal/input/signature/policy groups. Both use synthetic Git evidence and ephemeral in-memory signing keys.

## Optional durable floor

Pass a handle from `openUiReviewAuthorityFloor(root, anchorJson)` as the third factory argument to preserve observed policies across restarts. This mode may write policy state during prepare/verify and reports that separately; the two-argument default remains read-only. See [provisioning, errors and trust limits](ui-review-authority-floor.md). Actual identity and approval flags remain false.

## Explicit proof consumption

`consume(prepared, proofJson, currentInputJson)` requires a durable floor and records one-time proof use after fresh verification. It does not grant approval or authenticate a person. `prepare`/`verify` retain their existing behavior. See [atomic checks, recovery and historical records](ui-review-proof-use.md).
