# Automatic test cleanup retains fixtures

T-0356 closes the remaining final-delete replacement exposure by removing the
unsafe automatic operation. `temp-cleanup.removeOwnedTree()` now returns the
frozen result `{ removed: false, retained: true, reason: 'automatic-cleanup-disabled' }`
without filesystem access or deletion. Its legacy name remains for existing test
callers; its former timeout/error-code options no longer initiate cleanup.

`memory-migration-test-support.finish()` prints
`(retained: automatic-cleanup-disabled)` after passing checks. A failed check
still exits 1 and prints `(kept)`. Test verdict and fixture retention are separate.
`removeRecorded()` counts retained directories as `left`, never `removed`.
It preserves the existing gone/invalid-record classifications. The CI shard
runner also retains leaf record directories and its record root: its former
standalone final `rmdirSync` has been removed. The summary explicitly says that
automatic cleanup is disabled and runner records are retained.

This applies to callers of the shared owned-cleanup helper, including environment
probes. An ancestor record cannot re-enable deletion of a retained memory arena.
No fallback, retry or environment option enables automatic owned deletion.

## Safety decision and tradeoff

Checking a path and then deleting it cannot exclude a replacement inside the
last native path call. The previous path-based cleanup checks
left that exposure possible. Its checks are superseded by retention,
consistent with the owner's stabilization-first preference for safe refusal.
The previous report and failure receipts remain historical evidence.

Successful test fixtures and runner JSONL records will consume disk. Review them
and scope any later reclamation explicitly; this change introduces no automatic
janitor or user-temp cleanup. Product external recovery retains the existing
`confirmExternalRecoveryDir` validation. Product bin/lib, dependencies, npm test
chain and package version are unchanged by this follow-up.

The existing environment-only `doctor --json` diagnostic can report the count
of matching temporary directories as `tmpLeftover` once its warning threshold
is exceeded. Use `LEERNESS_DOCTOR_SELFTEST=0` for that environment-only check.
`tmpLeftover: null` does not prove zero leftovers, and name matching is not
ownership evidence. It does not measure total bytes. Any capacity inventory
must remain read-only, bounded, and avoid following links. Disk reclamation
requires a separate explicit scope with proven ownership and recovery evidence;
age or a `leerness-` prefix alone never authorizes deletion. Keep failing-run
and acceptance evidence until its durable record is verified.

Explicit `removeTree()` and generic `lib/safe-remove` still delete controlled
fixtures and retain their existing retry/error behavior. They do not provide
atomic ownership enforcement against hostile replacement. This decision removes
the automatic test-cleanup hazard; it does not claim every path-based removal
or external-recovery write is atomic under all later replacements.

## Verification

`node --test scripts/memory-cleanup-parent-race-probe.js` checks direct owned
cleanup, passing/failing finish, actual pre-finish root/parent replacement,
armed final unlink/fallback/bulk/retry callbacks, recorded ancestors, and the
real shard runner. It asserts zero destructive filesystem calls, preserved
foreign names/identities/bytes, retained roots, honest counts and unchanged
failure exit semantics. Armed native replacements must remain uncalled because
there is no deletion; actual pre-finish replacements must occur. These are
distinct assertions, not a claim that the final race ran and was atomically won.

Record actual execution receipts, source revisions and regression results separately.
