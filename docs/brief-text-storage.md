# Project brief and README text storage

Updating a project brief now checks both files before saving either one. Invalid
text or ambiguous managed sections cause a failure instead of silently replacing
damaged characters or appending a duplicate README block. A detected concurrent
edit is preserved through the existing checked publisher.

## Existing commands

- `brief set` and `brief update` capture the brief under its canonical lock,
  parse that same text, then capture README under its own lock. Lock order is
  brief -> README. Both candidates are validated before publishing brief first,
  then README. The critical section contains only document preparation/saving.
- Existing briefs change only requested fields. Metadata, unknown sections and
  untouched fields remain. The parser accepts LF, CRLF and a heading at EOF.
  Direction updates retain existing entries before adding the new one. A new
  or empty brief keeps the existing canonical layout and placeholder policy.
- Repeated known `##` headings are refused during mutations. README markers
  must be absent or exactly one ordered start/end pair. Incomplete, reversed or
  duplicate markers, including ones introduced by candidate values, are refused.
  Read-only views retain their existing inspection behavior. This is the existing
  simple section format, not a complete Markdown/fenced-code parser.
- `brief export --out <file>` strictly reads the source, captures the explicit
  destination under its lock and rechecks the source before publication. Export
  to stdout remains observation-only. The checked file export requires an
  accessible workspace source directory; a missing brief inside that directory
  still uses existing project defaults. Destination parent creation follows the
  shared lock behavior. The explicit destination selects what may be replaced.
- `anchors draft --apply` uses checked publication for the brief's Purpose
  update. Existing gap/no-op detection, signal gathering and draft replacement
  policy remain. The plan uses its existing checked boundary. A later plan
  failure now identifies an earlier saved brief draft. No-op calls and upstream
  draft signal readers are not a general encoding audit.

The existing 4 MiB boundary applies to selected source/target input and generated
output, including any retained UTF-8 signature. Invalid UTF-8 bytes, unpaired
Unicode candidates, unsafe files, changed snapshots and oversized content are
rejected. Valid Korean, other languages, symbols, combining characters and
literal replacement characters remain valid. Existing signatures are retained;
new files do not get one automatically. Candidate sections and generated README
text keep existing formatting rules; this is not a whole-document EOL conversion
or a promise that regenerated text has identical whitespace.

## Failure and recovery

Two publications are not a transaction. If README fails after the brief is saved,
the error says the brief was saved and was not rolled back. A later anchor plan
failure similarly reports the earlier brief change. The shared publisher can
retain competing bytes in a recovery artifact instead of the original pathname.
Inspect the named files and recovery paths before retrying; a failed command
does not imply an untouched workspace. Parents may already have been created
by lock setup, and ordinary runtime admission/command records remain separate.

The writer composes `managed-text`, `memory-input`, state locks and existing
README/blueprint builders. No global replacement engine or dependency is added.
Dry-run mutations retain the existing `dry_run_unsupported` result with no file
changes. Locks coordinate cooperating writers; snapshots do not prevent every
external race or provide power-loss durability. Byte checks cannot reconstruct
historically damaged prose or certify its meaning. Other generation/migration
writers, general README writers, upstream anchor signals and optional English
authoring remain separate work.

Run `npm run test:brief-text` for real CLI regressions in isolated workspaces.
Use `node scripts/brief-text-probe.js --match export` to focus on exports while
fixing them. Shared publication details are in
[managed text storage](managed-text-storage.md).
