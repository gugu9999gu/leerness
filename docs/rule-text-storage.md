# Rule and archive text storage

Rule mutations reject malformed UTF-8 and detected competing edits before
reporting success. They preserve valid Korean and other Unicode text instead of
silently decoding damaged bytes and saving replacement characters over them.

## Selected commands

`rule add`, `pause`, `resume`, `stop`, `resume-all` and `remove` capture the source
under the existing rules lock. Parsing, ID allocation, malformed Markdown row
salvage and preservation of authored notes use that same captured text. They
reuse the checked reader and publisher in [managed text storage](managed-text-storage.md).

Adding a rule also captures the archive under its lock so archived IDs cannot
be reused. Both add and remove lock rules before the archive. An absent archive
is not created merely to allocate an ID. Duplicate adds preserve bytes and
modification times and still check that their captured source has not changed.
An invalid trigger does not bootstrap an empty rules file.

Inputs and generated outputs are limited to 4 MiB, including an existing UTF-8
signature (BOM). Invalid UTF-8, unpaired surrogates and oversized text stop the
operation without truncation. Existing signatures are retained; new files do
not gain one. Valid combining marks, surrogate pairs, user symbols and literal
replacement characters are accepted. A literal replacement character alone is
not evidence of corruption. This does not repair earlier text loss.

The existing rule table policy remains: cells escape pipes and flatten embedded
line breaks; rendering can normalize line endings and surrounding whitespace.
Authored content outside the managed table and recoverable malformed Markdown
rows are retained. This is not a byte-exact formatting guarantee for edited
tables. A generated file that is already unchanged is not rewritten.

## Removal and partial progress

Removal prepares and validates both the remaining rules and the appended
archive before saving either. It saves the archive first, then removes the
active row. This order keeps a recorded copy before removal but is not a
two-file transaction.

- If saving the archive fails, active rules have not been saved. Inspect the
  archive and any recovery paths because a late failure can follow publication.
- If the archive saves but updating active rules fails, the error states that
  the archive was saved and earlier changes were not rolled back. The rule may
  still appear in both files. Inspect both files and recovery paths before
  retrying; automatic retries can append another archive entry.

The shared publisher checks the captured bytes, file identity and parent
observations again when saving. Detected late conflicts fail and expose available
recovery paths. Competing bytes can reside in a recovery artifact rather than
the final pathname. These are bounded checks, not protection against every
external race, power loss or future writes through an already-open descriptor.
Dry-run and existing runtime admission checks still apply.

## Scope and verification

Read-only rule observations, verification-cache storage, existing verification
semantics, external agent edits and global language policy are separate. This
change does not add a rule restore command or certify that an agent followed
the rules. No current project rule needs to be edited to use this boundary in
an updated installation.

Run `npm run test:rule-text` for isolated real CLI tests. The probe covers valid
multilingual text, signatures, malformed bytes and generated output, size and
target checks, archived IDs, outer notes, stale captures, publication conflicts,
paired-save failures, no-ops, dry-run and cooperating rule additions. It invokes
no models and gives child commands a temporary home and project.
