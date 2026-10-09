# Checked input for memory mutations

Decision/lesson add, save, drop and restore now consume one admitted source snapshot inside the existing canonical operation lock. They do not re-run the permissive read-only loader after checking the canonical file. The existing canonical backfill operation also uses this input at its locked write boundary.

## Source selection and publication

The internal `captureMemoryInput` helper checks the parent directory and leaf kind, opens an existing single-link regular file read-only, and compares file identity and metadata around a raw-buffer read. Only leaf `ENOENT` below an observed, unchanged directory admits absence. Access/read errors are not absence. A directory, symlink or multiply-linked input is not admitted as a regular memory file.

On Windows, some path-based stat implementations report a zero device identifier while descriptor-based stat reports the volume serial. This exact observation gap requires an additional read-only open of the current path and a full descriptor-to-descriptor device, inode and metadata comparison. Known nonzero device mismatches, unknown descriptor identity, changed inode/metadata and failed confirmation are still rejected; zero is not treated as a general identity wildcard. Parent checks remain path-based, within the ancestor-race limitations below.

A present canonical JSON file is UTF-8-decoded with a fatal decoder and parsed from that same buffer. It must be an array, including when it is empty. Invalid canonical data never selects Markdown fallback. When canonical is positively absent, the existing legacy parser receives a checked, UTF-8-valid Markdown buffer. Missing both input files retains empty initialization where the original command permits it. This does not certify that the legacy parser preserves arbitrary Markdown prose.

The operation's entries preserve the admitted canonical values, order and unknown fields. Duplicate checks, selection and restore append use those entries. Original bytes and identity are retained privately in a process-local WeakMap, not exposed as a public authorization token or written as a backup. Before first domain publication, the save helper re-observes the admitted source file(s) and compares presence, identity, metadata and bytes. It does not reparse or silently substitute newly read data. Duplicate no-op success also checks the source again.

JSON and generated Markdown are rendered before that publication check. The existing write primitives and canonical lock remain in use; no lock stealing, new writer protocol or automatic retry is introduced. Each checked input is bound to its canonical and legacy paths, and fabricated input objects are rejected.

## Errors and compatibility

| CLI code | Meaning |
| --- | --- |
| `store_corrupt` | Malformed UTF-8 or invalid canonical JSON |
| `store_invalid` | Non-array canonical root, unsupported input kind or invalid internal snapshot binding |
| `store_unreadable` | Source/parent observation, read or descriptor-close failure |
| `store_changed` | Observed presence, identity, metadata or bytes no longer match the admitted input |

`--force` retains explicit duplicate semantics but does not waive admission. Valid UTF-8 BOM, literal U+FFFD, Unicode and multiline canonical extension values remain accepted. Read-only memory loaders keep their prior behavior. Generic non-memory stores do not use this input reader. Plan restore is unchanged.

`migrate apply` retains its existing outer candidate-discovery behavior and dry-run/audit semantics. A selected actual backfill takes a fresh checked input inside the same canonical lock and passes it to the save helper. This is not validation of every store skipped by discovery, nor an atomic operation across decisions and lessons.

## Verification

`npm run test:memory-checked` runs `memory-input-unit-probe.js` and `memory-checked-input-probe.js`. Both are also connected to the existing test/core/fast/command pipelines.

Unit cases exercise native files, absence, wrong kinds, hard links, creation/deletion/replacement, parent identity, private snapshot binding, parser reuse, valid and invalid encoding, and controlled I/O failures. Windows adds descriptor-confirmation controls that retain mismatch and unknown-identity rejection. CLI cases use real child processes and owned fixtures; bounded filesystem fault injection makes access/read/change observations reproducible. Native successful and failed inputs are included. Separate six-process add/drop/restore batches check cooperating writers on both memory surfaces. Rejection checks compare canonical JSON, projection Markdown and archive bytes, sizes and modification times, distinguishing an injected external edit from a later product write.

Controlled errors are not an actual Windows ACL test. Six cooperating local writers are not a proof covering all external editors or distributed hosts. Source integrity and process exits are checked separately; local test success is not independent model review or release approval.

## Deliberate limits

This correction covers the canonical source and, only when selected, the legacy Markdown source. A present canonical source does not cause unused Markdown to be parsed or retained. Restore archive reads, output-target identity, full path-ancestor alias races and archive/projection publication have separate contracts. It is not a snapshot of all files in the operation.

The final source check cannot prevent a non-cooperating writer changing files immediately afterward. JSON/projection/archive publications remain sequential, not a multi-file transaction. Later I/O failure, interruption recovery, lossless original Markdown/archive payloads, JSON duplicate-key/numeric-precision preservation, and all producer/startup/MCP effects remain outside this change. Lock bookkeeping is not a memory-domain write and is not claimed absent.

No new size limit is imposed: the diagnostic reader's 1 MiB cap is not a legacy-writer compatibility policy. Input bytes, decoded text, parsed values and rendered output still use memory proportional to their sizes. A dedicated size/resource policy is pending; extra source comparisons are not reported as a measured performance improvement.
