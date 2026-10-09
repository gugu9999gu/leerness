# Mode changes and regenerated instructions

`leerness mode set minimal|standard` prepares the manifest, `AGENTS.md` and
`CLAUDE.md` before saving. Damaged text or an invalid generated candidate in any
of them stops the command before the first save. A later storage failure is
reported as failure instead of a successful mode change with missing instructions.

## Preparation and preservation

The command holds the existing canonical locks in this order: manifest,
`AGENTS.md`, then `CLAUDE.md`. Each document is captured once under its lock.
Manifest parsing, metadata preservation, language selection, previous-mode
template subtraction and instruction merging use those captured sources.
Both requested templates are generated before publication begins.

The manifest uses the existing authoring-policy limit of 64 KiB. Instruction
files use the shared 4 MiB limit. Limits apply to source and replacement bytes,
including an existing UTF-8 signature (BOM). Checked input rejects malformed
UTF-8, unsafe file targets and excessive size. Generated text rejects unpaired
surrogates. The shared helper allows a smaller per-snapshot limit while keeping
its 4 MiB default; callers cannot enlarge that bound after capture.

Valid Korean and other Unicode, combining marks, symbols, existing signatures,
custom instructions and unrelated parsed manifest metadata are retained. New
files do not gain a signature. JSON retains the existing parse/stringify policy;
this is not a byte-exact JSON round trip or validation of every escaped value in
unknown metadata. Instruction merge retains its existing whitespace/newline
policy. A valid specific backup pointer is retained; the command does not create
a backup or change archive retention. Identical candidates keep their bytes and
modification times.

Saved authoring language remains separate from the user's explanation language.
Flag/environment language precedence stays the same; a display override does
not rewrite the saved language. Missing manifests still start from the existing
standard-mode default. Corrupt JSON keeps the `manifest_corrupt` error contract.

## Saving and failure reports

After all candidates pass preflight, the command saves the manifest, `AGENTS.md`
and `CLAUDE.md` in that order. Success keeps the existing `mode`, `previous` and
`regenerated` fields. The regenerated count describes completed instruction
steps, including identical output; it does not count changed files.

A detected storage or generation failure returns a nonzero exit code. JSON
uses `mode_update_failed` and includes:

- `requestedMode`: the request, not a claim about the final stored mode.
- `phase`: `preflight` or `publication`.
- `failedFile`: the document being prepared or saved.
- `completedFiles`: confirmed earlier save steps in order.
- `publicationAttempted`: whether saving had started.
- `rolledBack: false` and the available underlying `causeCode`.

Before publication, this command has not saved any of the three documents.
Once publication starts, earlier saves are not rolled back. The failed file
itself may also have changed before a late error. For example, if `CLAUDE.md`
fails after the other two saves, the manifest and `AGENTS.md` may already use the
requested mode while `CLAUDE.md` still needs attention. Inspect all three files
and the error's recovery paths before retrying. A retry uses current stored
state; it is not an automatic rollback or reconstruction of the previous mode.

This is not a three-file transaction, power-loss guarantee or protection against
every external writer. A separate writer can change a file after its checked
publication. Competing bytes may be preserved in recovery artifacts instead of
the canonical pathname. Runtime admission and dry-run guards remain in force.

## Scope and tests

Mode observations, other manifest writers, historical text repair, entire
template localization and actual agent compliance are separate. Existing
projects receive this behavior when using the updated package; this change
does not apply a new mode to them automatically.

Run `npm run test:mode-text` for temporary-home, real CLI regressions. They cover
source/output validation, Unicode and signatures, mode transitions, metadata
and custom notes, archived pointers, byte limits, captured-source and final
publication conflicts, partial saves, dry-run and cooperating mode changes.
See [shared storage](managed-text-storage.md) and
[generated instruction storage](generation-text-storage.md) for reused behavior.
