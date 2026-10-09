# Legacy memory migration candidate assessment (ML-01)

Experimental internal CommonJS API in `lib/memory-migration-plan.js`, available in the unreleased 1.36.192 candidate. It evaluates **caller-supplied observations**, with no filesystem, process, network or clock access. It does not retain a backup, change a writer, authorize an operation or apply a migration. There is no new CLI/MCP command in ML-01.

```js
const { assessLegacyMemoryMigration } = require('./lib/memory-migration-plan');
const report = assessLegacyMemoryMigration(JSON.stringify({
  schemaVersion: 1,
  surface: 'decisions',
  canonicalState: 'absent',
  legacy: {
    state: 'present',
    bytesBase64: Buffer.from('### A decision\n- Decision: Keep the original\n', 'utf8').toString('base64')
  }
}));
// report.disposition === 'candidate-requires-raw-retention'
// report.sourceVerified === false; report.approvalGranted === false
```

## Input and trust boundary

The input must be a serialized JSON string with exactly the keys shown. This avoids invoking caller objects' getters or `toJSON`. Version is numeric `1`; surface is `decisions` or `lessons`. JSON duplicate keys follow `JSON.parse` semantics; this envelope is an unverified observation, never a signed statement or a raw-JSON preservation format.

`canonicalState`: `present`, `absent`, `corrupt`, `unreadable`, `unsupported`, `unknown`. An omitted state is invalid, not absence. `legacy.state`: `present`, `absent`, `unreadable`, `unsupported`, `unknown`. Present legacy requires a string `bytesBase64`; every other state requires `null`. Unknown keys and invalid field types are rejected.

The base64 representation permits faithful input of malformed UTF-8 bytes. For payloads within the raw budget it must be standard padded canonical base64 (no whitespace or alternate pad bits); an empty string represents an existing empty file. Oversized payloads are classified before allocation/decoding, so their content and pad bits are not fully inspected. Invalid UTF-8 is incomplete, not an empty source. The decoder retains the raw BOM for comparison; one leading BOM is removed only for parsing, matching the current checked-input reader.

The envelope is parsed/validated first, then canonical state, legacy state, raw budget/UTF-8, parser budget and output budget are evaluated in that order. A present or uncertain canonical state prevents legacy parsing, even if supplied legacy bytes are malformed. This does not validate that canonical file or the ignored legacy payload. The caller must have separately observed those facts; ML-01 always reports `sourceTrust: caller-supplied` and `sourceVerified: false`.

## Results

| Condition | Disposition | Meaning |
|---|---|---|
| Canonical present | `not-applicable` | Existing canonical/projection reconciliation is a separate operation |
| Canonical corrupt/unreadable/unsupported/unknown | `blocked` | Never fall back to legacy for a mutation |
| Both positively absent (as asserted by caller) | `not-applicable` | Existing initialization path |
| Legacy unknown/unreadable/unsupported | `incomplete` | No payload inference |
| Exact generated prefix, optionally with opaque suffix | `not-needed` | Current preservation path can represent these bytes; actual writer checks still apply |
| No parsed records | `not-needed` | Current preservation path retains opaque text; does not mean no meaningful user content exists |
| Other record-bearing legacy text | `candidate-requires-raw-retention` | Parsed candidate needs separately retained original bytes before any future apply |
| Malformed UTF-8 or raw/output/parser budget exceeded | `incomplete` | No migration candidate; no truncation or partially successful extraction |

The frozen report contains `schemaVersion`, `surface`, `disposition`, `reasonCodes`, `inputBytes`, `parsedRecordCount`, `candidateCanonicalBytes`, `candidateProjectionBytes`, `rawRetentionBytes`, `sourceTrust`, `semanticCoverage`, `sourceVerified`, `approvalGranted`, `writesPerformed`. It has no source text, record objects, base64 payload, path, timestamp or approval token. Every result keeps `semanticCoverage: unknown`, `sourceVerified: false`, `approvalGranted: false`, `writesPerformed: false`.

Metrics are `null` when not measured. Both-absent input is known to contain zero legacy bytes, but no candidate is rendered. `parsedRecordCount` is the existing parser's record count, not a count of all meaningful statements. Numeric output sizes appear only on `not-needed` or retention-required candidates. `rawRetentionBytes` is the complete original legacy byte length for a retention-required candidate, and zero for a path needing no new separate backup. It does not assert that retention happened.

Candidate canonical bytes match `JSON.stringify(parsedEntries, null, 2) + '\n'`, including the current writer's final newline. Candidate projection bytes include a preservable existing suffix or the whole opaque no-record text. For a retention-required candidate they measure only the generated projection; the separately retained raw bytes are reported independently. They do not include a future manifest, provenance link, temporary files or rollback copies.

Unknown fields, manual paragraphs, multi-line values, lowercase `- lesson:` and other parser omissions may remain only in the raw original. Neither record count nor a candidate certifies semantic migration completeness. The entire raw source would need to remain accessible in a later explicit migration. Appending all original records to the generated projection would risk duplicate interpretation and is not performed here.

## Resource boundaries

Exported constants fix diagnostic budgets; these do **not** change existing writer admission:

- `MAX_LEGACY_BYTES`: 1 MiB of decoded raw source bytes, checked before allocating/decoding that payload.
- `MAX_ENVELOPE_BYTES`: `ceil(MAX_LEGACY_BYTES / 3) * 4 + 4096`, including base64 and metadata/whitespace, checked before JSON parsing. It is larger than the raw budget to account for encoding overhead.
- `MAX_OUTPUT_BYTES`: 4 MiB for canonical plus projected output. A counter for the existing fixed parser/renderer format runs before the whole projection is built. No canonical JSON array payload is constructed. The counter reuses `_lineSafe` and renderer preambles; conformance tests compare it with real serializers, including escaping and Unicode. A runtime projection-size mismatch returns `projection_format_changed`/incomplete.
- `MAX_METADATA_BYTES`: 16 KiB for the fixed metadata result.
- `MAX_FENCE_SCAN_UNITS`: 32 Mi UTF-16-code-unit × line-leading-triple-backtick starts for the decision parser's fence-removal scan. This conservative estimate can reject otherwise valid large documents; it prevents a known repeated-unclosed-fence case from reaching the slow existing parser. The lesson parser does not use this fence-removal path.

Limits are inclusive; excess work is incomplete. The scan estimate is not a wall-clock, RSS, filesystem-space or lock-duration guarantee. The input envelope, decoded bytes, parser entries and temporary field fragments still consume memory. The raw limit and output limit are separate; a sub-1-MiB control-character input can expand beyond 4 MiB. Existing writers and parser semantics are unchanged.

## Errors and verification

Invalid envelope/type/schema/base64 throws `MemoryMigrationInputError` with a fixed `code`; messages never include input values or JSON parser text. Codes include `serialized_json_required`, `envelope_too_large`, `json_invalid`, `input_shape_invalid`, `schema_unsupported`, `surface_unsupported`, `canonical_state_invalid`, `legacy_shape_invalid`, `legacy_bytes_invalid`, `base64_invalid`. Diagnostic uncertainty and resource limits return reports instead of throwing. Unexpected internal implementation errors are not certified as successful diagnostics.

Run `npm run test:memory-migration`. The contract probe checks real serializer byte agreement, encoding, BOM/CRLF, manual content, unknown/corrupt states, and boundary-1/equal/+1 values. The isolation probe loads the real modules in an environment where I/O/clock access and canonical array serialization throw, with parser/renderer traps to prove early refusal. It includes successful controls so refusal is not the only reachable path.

ML-02 will bind observations to real files and validate whole-command read-only behavior. ML-03 will address prepublication raw retention, explicit apply and recovery. ML-04 will address writer item/count/size policy. None is implied by this module's candidate output.
