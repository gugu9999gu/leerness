# Audit README version fixes

`leerness audit . --fix` checks README version edits under the existing README
state lock and uses the [managed text boundary](managed-text-storage.md).
The two existing version meanings stay distinct:

- A version badge uses `package.json`'s project version.
- `Last synced by Leerness v...` uses the running Leerness version. The trailing
  sync date and other prose are not rewritten by this fix.

The first matching version still decides whether each fix is needed. An eligible
badge fix replaces all existing supported numeric version patterns with colors
`green`, `blue` or `red`, setting the color to green. An eligible stamp fix
replaces all matching stamps. Other patterns remain unchanged. These are the
existing matching rules, not a new Markdown or version parser.

## Source preservation

Before each save, the README is captured as strict UTF-8 and the version source
is captured from `package.json`. Eligibility and the replacement are computed
again from these inputs. The package input is checked again before publication.
The README lock coordinates participating writers; the package is a checked
read-only reference, not locked or rewritten by this command.

Normal Unicode, user symbols, a UTF-8 BOM, line endings and unrelated content
remain exact. Malformed UTF-8, unsafe file identities and sources or prepared
README output exceeding 4 MiB including a BOM are refused. A missing README or
package is not created. A missing source before capture or a no-op candidate
does not count as a saved fix. Unchanged output keeps its modification time.

In fix mode, observed package metadata must be a valid JSON object with an
optional string `version`. If supplied, its value is substituted literally;
this operation does not perform general semantic-version validation or
normalization. A UTF-8 BOM is accepted without changing the package. Invalid
JSON is reported without echoing parser excerpts from the metadata.

`--force` cannot bypass the checks. `--dry-run` refuses the save before creating
README lock metadata.

## Failure and counts

Each of the badge and stamp fixes counts once, only after confirmed publication.
Saving both therefore counts as two fixes. Replacing several occurrences in one
save counts as one. An unsupported badge color, already resolved version or
absent target does not count as a new fix.

A failed README fix stops later audit checks and fixes, exits nonzero and emits
one parseable JSON result. It includes `incomplete: true` and a
`readme_fix_failed` finding with the failed file/phase, `causeCode`,
`completedFixes`, `completedTimestampFiles` and `completedReadmeFixes` (`badge`
and/or `stamp`). `sourceFile` identifies a failed package source when applicable.
Available recovery paths and publisher flags are retained.

`publicationAttempted` means the publisher was invoked, not proof that the
target changed. A publication error can occur after changing the README. A
zero fix count does not prove no files changed. Earlier confirmed saves remain
in the count and are not undone (`rolledBack: false`). Inspect the target and
any recovery artifacts before retrying. The human output reports the same
partial progress and available recovery paths.

Warnings still describe pre-fix observations. A completed audit retains its
existing strict-mode warning promotion. A README error already fails and stops
subsequent strict processing. The existing `fixApplied` field indicates that
`--fix` was requested, not that every fix completed.

## Limits and verification

These are separate saved steps, not a README-pair or whole-audit transaction.
Bounded source/publication checks cannot exclude every external race, writes
after the final checks, writes through displaced descriptors or power loss.

General observation reads and read-only audit behavior remain separate. A README
with no eligible version pattern is not certified as valid UTF-8. Source capture
limits do not bound every earlier observation read. Historical text recovery,
gitignore/example-env fixes and other audit writers remain separate.

Run `npm run test:audit-readme-text` for isolated real-CLI regression cases.
They cover Unicode and size limits, version meanings, concurrent README/package
changes, partial saves, detected final publication conflicts and failure
reporting. They use temporary projects and homes and call no AI provider.


The selected ignore/example saves are covered separately by [audit environment storage](audit-env-storage.md). The original limits above remain specific to this document; general observations, generic env sync and other writers are not certified.
