# Audit timestamp fixes

`leerness audit . --fix` retains its existing date repair rules:

- Replace the first `Last generated: (auto)` or `Last generated: (자동)` match
  in `.leerness/session-handoff.md`.
- Replace the first `Updated: YYYY-MM-DD` match in `.leerness/current-state.md`
  when that date is older than seven days or cannot be parsed as a date.

Each selected file is captured under the existing canonical state lock, then
saved through the [managed text boundary](managed-text-storage.md). Direct
library calls without an injected lock use that same lock implementation.
Eligibility is checked again using the captured text. A document removed before
capture stays missing. An already resolved date does not count as a new fix.

Normal Unicode, user symbols, a UTF-8 BOM, line endings, later dates and other
notes remain exact. Malformed UTF-8 and edits exceeding 4 MiB including the BOM
are refused. Identical output keeps its modification time. Changed or removed
captured sources are rejected before publication; the publisher also checks
the target and parent. `--force` does not bypass those checks. `--dry-run`
refuses the write before lock metadata is created.

## Results and partial failure

`fixed` increases only after a timestamp edit reports a successful publication.
It does not increase for missing files, unchanged candidates or uncertain
publication failures. Other audit fix counters keep their existing semantics.

If one of these timestamp fixes fails, later audit checks and fixes stop. The
command exits nonzero. JSON output remains a single parseable object and adds
`incomplete: true` plus a `timestamp_fix_failed` finding containing:

- `file`, `phase` (`preflight` or `publication`) and `causeCode`;
- `completedFixes` and `completedTimestampFiles` for earlier confirmed saves;
- `publicationAttempted`, meaning the checked publisher was invoked, not proof
  that the target changed;
- `rolledBack: false`: the audit does not undo earlier completed fixes;
- recovery paths and low-level publication/cleanup flags when available.

A publication error can occur before or after changing the failed target. A
late conflict may leave competing bytes in a recovery artifact. Inspect the
target, error and retained recovery files before retrying. Do not interpret a
zero fix count as proof that every file is unchanged. A low-level
`outputRolledBack` field concerns that publisher only, not the entire audit.
The human output also identifies the failed file/phase, previous fix count and
skipped checks, and lists available recovery paths.

Warnings still describe observations made before fixes. Existing strict-mode
warning promotion remains in place for completed audits; a timestamp failure
already fails the command and stops subsequent strict processing. `fixApplied`
is the existing flag indicating that `--fix` was requested. It is not proof
that every requested fix completed.

## Boundaries and verification

Without `--fix`, this change adds no date writes. It does not certify ordinary
observation reads, validate every document's encoding, repair historical
corruption, translate text or impose a whole-command memory limit. An encoding
whose text does not match an existing repair trigger is not selected for saving.
README version fixes have a [separate checked contract](audit-readme-storage.md).
Gitignore, example-env and other audit writers remain separate.

The two timestamps are separate saves, not a transaction. Canonical locks
coordinate participating Leerness writers, not every external editor. These
bounded checks do not guarantee every possible external race, future writes
through displaced descriptors or power-loss durability.

Run `npm run test:audit-text` for the focused real-CLI and direct-library
regression. It uses temporary projects and isolated homes with normal and
malformed text, byte limits, no-op dates, concurrent edits, publication failures,
partial progress, dry-run and existing strict behavior. No AI provider is called.


The selected ignore/example saves are covered separately by [audit environment storage](audit-env-storage.md). The original limits above remain specific to this document; general observations, generic env sync and other writers are not certified.
