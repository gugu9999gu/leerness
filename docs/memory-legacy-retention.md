# Legacy Markdown preservation

Decision and lesson mutations now use the existing checked projection boundary
when canonical JSON is absent, as well as when it exists. This applies to
`decision add/drop`, `lesson save/drop`, `memory restore decisions/lessons`, and
their canonical backfill in `migrate apply --yes`.

The legacy parser's array is not proof that its input can be safely rewritten.
Before a domain write, the original Markdown must begin with the exact output of
the existing renderer for the parsed entries. That generated prefix can be
replaced; any remaining appended text is retained exactly as UTF-8 bytes. Later
canonical mutations continue to preserve that opaque suffix once, without
importing it into the JSON store.

When the parser finds no entries, there are no parsed records to remove. A
nonmatching original, including a fresh init template, frontmatter or manual
notes, is retained in full after the generated projection. This may leave an
additional template/header visible in the document. It is retained text, not a
second active record. Missing files still initialize normally.

The generated header follows the harness authoring language: an explicit
`--authoring-language`, else the project's stored language (the manifest, then
`.leerness/LANGUAGE`). Projects without a stored language keep the Korean header.
The language of one command (`--language`, `LEERNESS_LANG`) does not change the
file. A prefix that carries the English or the Korean header is recognized as
generated, so a project written before a language change, or by a version that
only had the Korean header, keeps working; the next write replaces only that
header, and records and appended text must still match exactly. The write
preflight and admission budget accept either header and size the header that
will be written. `memory-migration` bundles still render the Korean header,
because their verification re-renders the recorded bytes; the next ordinary
write replaces it.

A record-bearing legacy file whose prefix does not match is refused with
`projection_diverged` in CLI JSON mode (`E_PROJECTION_DIVERGED` internally).
Examples include custom preambles, edits within records, CRLF normalization and
leading UTF-8 BOMs. These inputs are not necessarily corrupt: automatic rewrite
cannot certify their raw preservation. Keep the original and reconcile it
manually before retrying; `--force` does not waive this boundary. No new archival
format or automatic general-purpose migration is introduced.

The decoder now includes leading BOMs in projection comparisons, including
canonical-backed projections. Malformed UTF-8 is still rejected separately.
Read-only fallback, actual duplicate no-ops and migration dry runs leave the
original alone. A dry run is not certification that a later write will pass.

Rejection is checked before writes to that surface's canonical JSON, Markdown
or drop archive. Existing source and output snapshots, operation locks, and
partial-write recovery remain in force. This does not promise zero CLI runtime
bookkeeping, a transaction across both migration surfaces, atomic multi-file
publication, historical archive recovery, item/size admission, or protection
against every external writer. Nonmatching record-bearing documents require a
separately designed lossless migration; silently deleting or normalizing their
content is not the fallback.

Run `npm run test:memory-legacy` for actual CLI preservation, positive controls,
forced mutation, dry-run and byte/mtime/presence checks. The probe is also wired
into the standard test, fast, commands and core suites.
