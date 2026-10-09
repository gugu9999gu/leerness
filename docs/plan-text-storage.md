# Plan and archive text storage

Existing plan goal initialization, milestone addition, scope exclusion,
milestone removal, plan restoration and the plan part of anchor draft application
use the [managed-text checks](managed-text-storage.md). Invalid UTF-8 is refused
before being rewritten. Valid Unicode, literal replacement characters, existing
UTF-8 signatures and the command's existing Markdown formatting are retained.
This does not infer or repair the meaning of already byte-valid damaged prose.

## Captured input and publication

The existing canonical plan lock now supplies a strict captured text snapshot.
Mutation parsers and renderers use that snapshot instead of a second tolerant
read. Each publication validates the candidate and checks that the captured
original remains current. Existing task/progress admission and runtime checks
remain in place. `plan add` validates paired task strings before saving its plan;
later task gates or concurrent changes can still leave a saved plan without its
new task. This is not an atomic two-file operation.

The scope-exclusion table accepts existing LF or CRLF headers and retains their
line ending for an inserted row. A malformed existing table fails unchanged
instead of reporting that an entry was added when no insertion occurred.
Existing escaping for cells and single-line milestone fields remains unchanged.

## Removal and restoration

Both plan and archive use the same strict input/output checks and 4 MiB limit.
Locks are acquired as progress -> plan -> archive for removal; restoration uses
plan -> archive. The existing other memory-domain locks and policy remain
unchanged. Both prepared candidates are checked before the first publication.

Removal publishes the selected blocks into the archive first, then updates the
active plan. Restoration publishes the restored active content first, then trims
the selected archive blocks. This order retains an original copy if a later
step fails. The operation can still leave duplicate entries or recovery files;
it is not a multi-file transaction and does not promise rollback.

If the second publication fails, the error says which first publication already
succeeded. Preserve and inspect both files and reported recovery paths before
retrying. A last-window competing write may be retained in a recovery artifact
rather than at its original pathname. Existing publisher limitations, including
late writes through displaced open handles, still apply.

No-match removal does not open or validate an archive it will not change.
Existing template protection, archive selection and restore-conflict behavior
remain. `--force` allows an intentional restore conflict but cannot waive text
validity or stale-file checks. Malformed plan-restore archive input retains the
existing `archive_corrupt` response code.

## Scope and verification

`anchors draft --apply` checks the plan only when it attempts to update that
plan. A goal already treated as authored remains a no-op; the command is not a
replacement for `encoding check`. The separate project-brief edit can occur
earlier and is not part of a transaction with the plan. Generated source signals
are not semantically certified by validating the resulting text.

Missing-plan `plan init` still delegates to the existing installation workflow.
General initialization, migrations, session-close and other prose writers remain
outside this selected slice, as do direct external edits and historical repair.
E3 and optional English authoring E4 are not complete as a whole.

Run `npm run test:plan-text` for isolated real CLI regressions: Unicode and
signatures, malformed and oversized source/candidates, selection/conflict,
draft application, stale/unsafe targets, late races and partial publication.
The tests make no provider calls or changes to user projects.
