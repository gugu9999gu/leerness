# Session-close text storage

Session close refuses damaged text instead of silently copying decoder
replacement characters into its first three documents. A detected concurrent
change causes failure rather than a successful overwrite. Existing LF or CRLF
handoff frontmatter and UTF-8 signatures survive publication.

## Selected files and ordering

The tracker and review evidence are captured with the existing checked reader
before parsing. The same captured text supplies task rows and the evidence
excerpt. Both sources are checked again before each selected document save.
Missing tracker/evidence retain their existing empty/no-evidence behavior.

Handoff, current state and task log are prepared with `managed-text`, each
under its own existing canonical lock. All candidates are validated before
the first publication. Publication reacquires each individual lock and checks
the original snapshot again. No lock spans the later audits, and no nested or
shared multi-document lock is introduced. Direct library calls without an
injected lock use the shared state lock too.

The command still has no dry-run preview. The existing I/O admission guard
returns `dry_run_unsupported` without writing, before snapshot lock checks.

Publication order remains handoff, current state, task log. A missing current
state is skipped; missing handoff/log are created. The log uses checked append
by rendering the captured prefix plus the new entry. Its previous bytes and
signature are retained. All five selected inputs and the three candidates use
the existing 4 MiB limit, including any retained UTF-8 signature. Oversized files
are rejected without truncation; preserve/archive history explicitly before
retrying. Invalid UTF-8 and unpaired generated Unicode are rejected. Valid
Korean, other languages, combining marks, symbols and literal replacement
characters remain valid input. This does not detect every damaged sentence.

The existing handoff generated-body replacement policy is unchanged: only
leading, closed frontmatter is retained. Empty frontmatter is valid; LF, CRLF
and a closing delimiter at EOF are supported. An unclosed leading frontmatter
block now fails without publication. Separators inside the old body are not
interpreted as frontmatter. Current state keeps its existing automatic-line
policy and authored sections. New generated lines use the existing LF style;
this is not a promise to retain every whole-document line ending.

## Failure and limits

Snapshots do not reserve several files. If a source or later target changes
after an earlier save, close fails and names the earlier published documents.
Those writes are not rolled back. A failure within one publication retains the
checked publisher's recovery evidence; competing bytes may be in a recovery
artifact instead of the canonical pathname. Preserve and inspect those paths
before retrying. Do not interpret a failed close as an untouched workspace.

This is not a filesystem transaction, crash-recovery protocol, or guarantee
against every external write. Source changes after their final check can still
happen. Presence/command runtime records can precede document preflight. Later
rule, roadmap, session-counter, audit and other side effects retain their own
existing behavior and are outside this boundary. The handoff body preservation
limitation, general generation/migration, other prose writers, external agent
edits, historical repairs and optional English authoring remain separate work.

Run `npm run test:session-close-text` for isolated real CLI cases. During a
focused fix, `node scripts/session-close-text-probe.js --match frontmatter`
runs only matching groups. The probe covers Unicode, damaged input, limits,
unsafe files, stale snapshots, final-publication races and partial completion.
Shared publisher details are in [managed text storage](managed-text-storage.md).
