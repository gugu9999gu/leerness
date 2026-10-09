# Managed task text storage

Explicit environment snapshots share [checked capture and metadata preservation](env-snapshot-storage.md) across detection and full-text handoff writeback.

Explicit legacy handoff recording preserves metadata and its existing rolling history through [checked history storage](handoff-history-text-storage.md).

Handoff reminder generation and cleanup have a distinct generated-content ownership boundary: [reminder storage](reminder-text-storage.md).

Team add/remove use the shared boundary for [canonical JSON and generated Markdown](teams-text-storage.md), preflighting both files and reporting partial saves while refusing to discard authored projection text.

The existing `env sync` command uses [checked environment example storage](env-sync-text-storage.md), appending missing names with empty values while preserving authored text and keeping the private source read-only.

Feature graph add/link mutations use the same checked storage boundary with [scoped graph edits](feature-graph-text-storage.md), preserving unrelated authored text instead of re-rendering the whole graph.

Task table updates refuse malformed UTF-8 input and invalid Unicode output
before saving. Previously a tolerant decode could replace damaged bytes and
write the replacement back. A detected competing edit now causes failure with
the checked publisher's recovery evidence instead of a successful overwrite.

## Selected boundary

`writeProgressRows` covers task upserts, duplicate repair and lazy auto-track.
It captures input under the existing progress lock before parsing. Headers,
rows, row-loss checks and preserved suffixes use that same captured text.
Observation-only callers retain their existing read behavior.

`lib/managed-text.js` composes `memory-input`, `memory-output` and `state-lock`.
It does not add another filesystem replacement engine:

- `captureTextEdit(file)` strictly decodes checked bytes, records an existing
  UTF-8 signature, and binds a private snapshot to the exact resolved path.
- `publishTextEdit(edit, file, text)` requires the current lock and an unused
  authentic snapshot, validates Unicode and size, checks that input is still
  current, then calls the existing checked publisher.
- `assertTextEditCurrent(edit, file, text)` performs the same preparation checks
  without publishing or consuming the snapshot. Paired writers can preflight
  both candidates; subsequent publication still checks each original again.
- Once preparation succeeds and the checked publisher is attempted, the
  snapshot is consumed even if publication fails. Rejected preparation does not
  publish or consume it. Inspect failures and recapture changed or uncertain
  sources before retrying.

The selected input and output limit is 4 MiB, including a retained UTF-8 signature.
Callers can pass a smaller `maxBytes` to `captureTextEdit`; that bound stays with
the snapshot and applies again to publication. The default remains 4 MiB.
The checked reader and publisher already support this limit. Oversized data is
rejected without truncation. Candidate strings with unpaired surrogates are
rejected before encoding; valid pairs, Korean, other languages, combining marks,
literal replacement characters and user symbols are accepted. A literal `�`
does not prove an earlier loss, and byte-valid damaged prose is not repaired.

The storage helper preserves raw Unicode and line endings. It retains an existing
UTF-8 signature and does not add one for a newly created file. The table renderer
still applies its existing cell policy: pipes are escaped, controls and embedded
line breaks become spaces, and table whitespace/newlines can be reformatted.
This is not a byte-exact whole-table round-trip promise.

Task-sync JSON is read as checked, bounded UTF-8. All content and activeForm
strings used by the importer are validated before the first row is saved,
including invalid Unicode represented by JSON escapes. Unused fields are not
semantically validated. Other per-row gates keep their existing behavior and can
still produce partial imports; this is not an atomic batch transaction.

Paired plan operations preflight the tracker before editing the plan. A later
failure can still leave only part of a multi-file operation completed.

## Failure and recovery limits

The existing publisher checks bytes, identity and parent observations. On
Windows it uses the shared ReplaceFileW helper. On POSIX it uses the existing
rename-away and exclusive-link publication, which can briefly leave the target
pathname absent. Existing runtime admission and dry-run guards remain in force.
The shared Windows writer removes known temporary files separately, then removes
only an empty reservation directory. Unexpected contents remain with a cleanup
notice. This avoids the native Node 24.0.0 Windows recursive-removal crash observed
with a Korean pathname; it does not change general-purpose directory removal.

A late race or partial replacement can leave competing bytes in a recovery
artifact while the canonical path contains different bytes. The operation must
not report success in those detected cases. Preserve and inspect the error's
recovery paths and partial-publication fields. The CLI exposes available recovery
paths in the error message; it does not serialize every low-level field.

These are bounded checks, not filesystem transactions or power-loss durability.
Successful cleanup does not retain future writes through already-open displaced
descriptors. Do not infer protection against every external race.

Other prose stores, initialization/migration writers, external agent edits and
automatic historical repair are outside this slice. ENC-01 E3 remains open for
the other selected stores. [Optional English authoring](authoring-language.md)
is available separately and does not replace byte integrity checks.

Selected plan commands now reuse this helper too; see
[plan and archive storage](plan-text-storage.md) for their paired-write order,
partial failure and remaining generation boundaries.

The first three session-close documents also use this boundary; see
[session-close text storage](session-close-text-storage.md) for source checks,
frontmatter preservation, per-file locking and partial completion.

Project brief commands also reuse these checks; see
[brief and README storage](brief-text-storage.md) for selective section edits,
paired preflight, export destinations and anchor partial-save reporting.

Generated instruction creation and managed merge also reuse these checks; see
[generation text storage](generation-text-storage.md) for preserve/force rules,
per-file locks, unchanged saves and partial installation failures.

Installer line/environment merges, README synchronization and migration reports
also use this boundary; [installer text storage](install-text-storage.md) covers
configuration copying, partial failures and the retained merge policies.

Rule mutations and archived IDs also use this boundary; [rule text storage](rule-text-storage.md)
describes source capture, rules-before-archive locking and archive-first removal
with explicit partial-save errors.

[Mode changes](mode-text-storage.md) preflight the manifest and both instruction
files under ordered locks. They use a 64 KiB manifest limit and report confirmed
save steps and the failed phase without claiming a three-file transaction.

Run the focused regression with `npm run test:managed-text`. The probe uses
temporary fixtures and real CLI operations, including malformed source,
candidate validation, Unicode, BOM, lock, stale-input and publication failures.

[Explicit handoff date writeback](handoff-text-storage.md) also uses a captured
current-state document and the checked publisher. Existing observation modes
and other handoff side effects remain separate.

[Audit timestamp fixes](audit-text-storage.md) check both date documents under
their canonical locks, recheck eligibility and count confirmed saves. A failed
timestamp stops later audit work and reports partial progress without rollback.
Other audit fixes remain separate.

[Audit README version fixes](audit-readme-storage.md) reuse that same boundary
for badge and sync-stamp saves. The project package is a checked read-only source;
confirmed fixes and partial publication errors are reported explicitly.


The selected ignore/example saves are covered separately by [audit environment storage](audit-env-storage.md). The original limits above remain specific to this document; general observations, generic env sync and other writers are not certified.
