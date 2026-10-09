# Canonical memory UTF-8 admission

Memory mutations validate the bytes of existing `decisions.json` and `lessons.json` with a fatal UTF-8 decoder before parsing JSON. Previously, permissive text decoding could replace malformed bytes inside a JSON string with U+FFFD, allowing a syntactically valid array to pass and then overwriting the original bytes during a save.

## Behavior

The shared memory-array guard is called under the existing canonical operation lock before duplicate checks or selection in decision add/drop, lesson save/drop, and memory restore decisions/lessons. The save helpers accept the checked input used by the operation and revalidate its source before publication; a caller without an input still captures one defensively. See [Checked input for memory mutations](memory-checked-input.md). This change does not alter the generic guard used by other stores.

Malformed UTF-8 or invalid JSON produces the existing `store_corrupt` CLI error category. A valid JSON root that is not an array remains `store_invalid`. `--force` does not bypass these checks. A duplicate no-op also rejects a malformed canonical file rather than reporting success.

A valid literal replacement character (U+FFFD), UTF-8 BOM, Korean text, supplementary Unicode and multiline values remain accepted. Canonical absence retains the existing Markdown fallback/empty-initialization behavior. Read-only commands retain their existing permissive behavior; their success is not a certificate of encoding integrity.

## Verification

Run `node scripts/memory-utf8-admission-probe.js` or `npm run test:memory-utf8`. The probe is also included in the existing test, core, command and fast chains.

The owned-fixture matrix tests both surfaces, three malformed byte sequences, and six operations: add/save, duplicate no-op, forced duplicate, drop, restore and forced restore. Positive controls cover valid U+FFFD, BOM, Unicode/multiline unknown fields, missing canonical, empty initialization and read-only behavior. Rejected cases compare memory-domain file sets, bytes and modification times; successful cases verify both the requested operation and full surviving canonical values. Source file hashes and modification times are checked separately. Reports retain actual child status, signal and error data.

## Boundaries

This is a bounded memory-input correction, not full memory admission. The checked-input followup decodes and parses one admitted buffer, supplies those entries directly to mutation callers, distinguishes observed absence from read errors, and revalidates the canonical/effective legacy source before publication. Read-only loaders remain separate. This snapshot does not include every archive/output target, does not validate complete item schemas or impose a size policy, and cannot prevent a non-cooperating writer racing the final check-to-write interval. Details and test boundaries are in [Checked input for memory mutations](memory-checked-input.md).

No raw-retention format, backup lifecycle, automatic repair or source deletion is introduced. Valid writes still use the existing JSON and Markdown serializers. Raw JSON bytes, Markdown-only content, removed/archive unknown fields and already-corrupted historical values are not recovered by this change. Archive and active-file writes remain separate; partial-write recovery and multi-file atomicity are not claimed. Startup/lock bookkeeping is outside the tested memory-domain no-write boundary. Plan restore, runtime migration and finalize are unchanged.
