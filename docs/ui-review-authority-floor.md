# Durable UI approval policy floor

The optional local Git store preserves the highest observed signed policy and its exact certificate digest across process restarts. A lower revision or different certificate at the same revision is rejected. Revocation is stored before the host rejects the policy. Expired stored certificates remain valid historical floors; incoming policies must still be current.

```js
const S = require('leerness/lib/ui-review-authority-floor');
const H = require('leerness/lib/ui-review-authority-host');

// Provision once, explicitly, with a currently valid signed certificate.
S.initializeUiReviewAuthorityFloor(projectRoot, anchorJson, certificateJson);

// Normal startup: absence, damage, or incompatible scope is an error.
const floor = S.openUiReviewAuthorityFloor(projectRoot, anchorJson);
const host = H.createUiReviewAuthorityHost(anchorJson, readCurrentPolicy, floor);
// host.prepare(...) and host.verify(...) keep their existing arguments.
```

The anchor and reader are trusted host configuration. The floor handle is bound to that anchor and must come from `openUiReviewAuthorityFloor`; a caller-provided object with an `observe` method is rejected. The root must be an absolute path to a recognized Git project whose project key matches the anchor. The default two-argument host factory remains read-only and memory-only.

`floor.observe(certificateJson)` validates the signature, scope and time, compares with the retained floor, and records a newer certificate. It returns `head`, `revision`, `certificateDigest`, `revoked`, `applied`, `retention: 'local-git-ref'`, and the existing false authority flags. Exact replay reads without writing. `initializeUiReviewAuthorityFloor` refuses any existing floor and never acts as reset or recovery.

Storage uses `refs/leerness/ui-review-authority/v1/<projectKey>/<anchorDigest>`, existing Git object/fsync primitives and an expected-old ref update. Each advance retains its predecessor as its sole parent. It does not change the working tree, index, branch history, or a second task database. Linked worktrees use their common Git ref storage. No private keys, source materials or login tokens are stored.

Concurrent writers cannot both publish against the same previous head. An update error, timeout or failure to re-read the published head produces `publication_uncertain`; the update may already have happened. Re-read and replay the exact certificate to reconcile. Do not retry with an older policy or erase the ref. Missing state fails with `authority_floor_missing`; rollback and conflicting content use `authority_policy_rollback` and `authority_policy_revision_conflict`. Dry-run blocks initialization/advancement through the existing Git write guard; exact replay remains possible.

With the floor attached, a successful host result adds `policyFloor` (the final observation) and `effects.filesWritten` (whether any floor advancement occurred during that call). Preparing or verifying may preserve newer policy state even if target validation subsequently fails. A thrown error does not imply rollback. Neither the extra receipt nor the optional storage changes signed proof bytes or grants approval.

The host must protect this local store and anchor. This is persistence against ordinary restarts and cooperating concurrent writers, not authenticated remote storage or protection against an attacker rewriting the entire repository. Missing state is never recreated by open/observe, but a privileged caller can explicitly initialize again after deletion. An already-open handle detects rollback below its in-memory high-water mark; a fresh process cannot detect a valid whole-store rollback without an external trusted checkpoint. Anchor rotation creates a different scope and needs a separate trusted migration procedure.

Git and policy observations are not a cross-store transaction. Unobserved revocation, source freshness, ABA, physical disk durability beyond Git/OS guarantees, actual host/person identity, one-time challenge consumption, approval publication and independent semantic review remain outside this component. All identity/approval/cleanup flags remain false.

Run `npm run test:ui-review-authority-floor` for component tests, including real child-process restart/race scenarios and target integration. `npm run test:ui-review-authority-floor-smoke` selects four fast policy-storage groups. Fixtures use ephemeral in-memory keys, synthetic projects and no network.
