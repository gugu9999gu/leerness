# Canonical memory restoration

Unreleased 1.36.195 adds [writer item admission](memory-item-admission.md) before
conflict checks and validates parsed restore candidates before publication.

`leerness memory restore decisions <target>` and `leerness memory restore lessons <target>` restore selected entries from the existing Markdown archives. The singular `decision` and `lesson` aliases remain supported.

## Active source and preservation

An existing valid canonical JSON array is the active source. Restoration retains its array order, parsed values, multiline fields and unknown extension fields, then adds entries parsed from the selected archive blocks. A missing, stale or empty projection cannot replace that array. When canonical JSON is absent, the existing legacy Markdown fallback remains available. Invalid JSON or a non-array JSON root is not treated as absence, including with `--force`.

Conflict detection uses the existing identity rules: exact trimmed decision title or lesson text after the established projection normalization. It derives those identities from canonical data instead of trusting a potentially stale projection. A canonical entry hidden from Markdown still causes a conflict. A stale Markdown-only identity does not override the canonical array. `--force` retains its explicit duplicate behavior, and duplicates inside the same selected archive batch retain the existing behavior.

Selected archive blocks that yield no decision/lesson entries, including empty or whitespace-only bodies, fail with `archive_entry_invalid` before memory-domain writes. A selected block whose integrity record no longer matches its text, or whose record line is malformed or misplaced (T-0331, see [memory item admission](memory-item-admission.md)), fails with `archive_changed` the same way. The rejection applies to the whole selection even when another block is valid, including date selection and `--force`. Unselected empty blocks remain in the archive. Both canonical and generated Markdown outputs are prepared before their publication. An unrenderable surviving item cannot cause a premature Markdown append or silently disappear through reparsing.

## Limits

This is canonical **value** preservation, not an exact-byte or all-memory preservation guarantee. JSON formatting and projection Markdown are regenerated. Raw Markdown-only notes require a separate retention/migration policy; this change does not provide it. Fields or newlines already omitted by the legacy archive serializer cannot be recovered here. Existing selection remains date-or-target-substring matching. This is not complete archive validation: parsing one or more records does not prove that all prose in a block was represented.

The cooperating operation lock and current root guard remain in place. The [checked-input followup](memory-checked-input.md) admits canonical/effective legacy source bytes, distinguishes read errors from absence and rechecks those inputs before publication. This is not complete item/size validation or a snapshot of the archive and all output targets, and it does not eliminate the final race with non-cooperating writers. The canonical, projection and archive writes remain sequential, not an atomic multi-file transaction; a later I/O failure can still need manual recovery. Plan restoration, read-only fallback, runtime layout and release policy are unchanged.

## Regression

Run `npm run test:memory-restore` for the actual CLI matrix. It checks canonical survivors, stale/missing projections, canonical-only duplicates, legacy fallback, explicit duplicates, malformed and empty selected blocks, mixed valid/empty batches, date and force selection, unselected empty-block retention, and domain byte/mtime preservation on rejection. Integration controls also combine a mixed valid/empty archive with valid BOM-prefixed canonical JSON and malformed canonical UTF-8, with and without `--force`. Canonical corruption takes precedence; valid canonical input still reaches archive-entry validation, and both rejections preserve memory-domain files. The test is also part of the existing test, core, fast and command pipelines; prior gates are retained.
