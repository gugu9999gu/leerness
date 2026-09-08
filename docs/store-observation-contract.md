# Store observation: current boundaries and staged changes

T-0187-B / T-0191. Source baseline: product code at `70b2a124`; the later
`7694fb8` commit changes verification documentation only. This is a bounded
inventory and implementation contract, not a claim that the proposed API exists.

## Current behavior

| Surface | What it observes | Missing / invalid / unreadable behavior | Boundary |
| --- | --- | --- | --- |
| `state inspect` / `inspectLegacyInventory` | Known paths, file kinds, sizes and times | `absent`, `unreadable`, or blocked parent metadata | Does not read payloads; `ok:true` does not validate store contents |
| `findCorruptedStateJson` used by check/health/audit | Nonempty, readable, top-level `.leerness/*.json` syntax | Missing or unreadable directory returns no findings; unreadable/blank files are skipped | No recursive scan or schema validation; no findings is not proof every store was checked |
| `readRoleStore` / `roles validate` | Role file boundaries, size checks before and after a whole-file read, strict UTF-8, JSON and role schema | Missing is explicit; malformed JSON, invalid shape and unreadable state are rejected separately | The read itself has no byte cap; this role schema does not apply to other stores |
| `_loadDecisions`, `_loadLessons` | JSON array, otherwise Markdown fallback | Missing, malformed JSON, non-array JSON and caught JSON read errors can all fall back | Returned array does not identify the chosen source or canonical error; items are not fully schema-validated |
| `_assertStoreParsable` | Existing JSON syntax at a save boundary | Parse/read failure becomes `E_STORE_CORRUPT`; valid JSON with wrong shape passes | A late save guard is not a multi-file transaction |
| `state compatibility` | Fixed runtime layout descriptor and admission conditions | Missing compatible legacy layout differs from unsupported/unreadable conditions via `reasonCode` | Compatibility-only; no payload migration, runtime activation or memory validation |

Sources: [inventory](../lib/state-inventory.js), [inspection](../lib/state-inspect.js),
[integrity](../lib/state-integrity.js), [roles](../lib/role-store.js),
[runtime layout](../lib/runtime-layout.js), and the `_loadDecisions`, `_loadLessons`,
`_assertStoreParsable`, `lessonDropCmd`, `decisionDropCmd`, `memoryRestoreCmd`
functions in [the CLI](../bin/leerness.js). Function names are navigation anchors,
not a promise that these internal functions are public exports.

### Legacy memory needs separate read and write contracts

- A readable JSON array wins over Markdown, even if individual items are unsuitable.
- A non-array JSON document is parseable but is not a valid memory array; the loader
  falls back while the syntax-only save guard permits it.
- Blank JSON falls back on read and fails the save guard, yet the integrity scan skips it.
- JSON read exceptions are caught by the loader; Markdown read exceptions are not.
  `existsSync` false is not a positively observed `ENOENT` reason.
- Add/save can exit on deduplication before reaching the save guard. A successful
  no-op therefore does not certify the canonical file.
- Drop appends to the archive before the final save guard. Restore appends to active
  Markdown before the final save guard. Refusing the canonical save does not undo
  those earlier writes. JSON then Markdown saves are sequential, not transactional.

The ordering and fallback statements above are source observations, not destructive
tests against user data. Do not activate migration B assuming zero mutation on failure.

## Proposed observation contract — not implemented

Keep `state inspect` metadata-only. Add a separately requested, read-only store
diagnostic surface in a later implementation; do not silently add payload reads to
the existing command. Start with decisions, lessons and roles, not arbitrary files.

Each domain adapter should describe these independent facts:

| Axis | Proposed values / rule |
| --- | --- |
| Canonical observation | `missing`, `valid`, `invalid_json`, `invalid_shape`, `unreadable`, `unsupported`, `unknown`; preserve the native domain reason code |
| Effective source | `canonical`, `legacy_markdown`, `none`; no silent switch of authority |
| Fallback | Explicit attempted/used state and reason; fallback availability does not make canonical data valid |
| Validation | Separate syntax, schema and item validation; unperformed checks are unknown, not true |
| Coverage | Enumerated stores, skipped stores and reason, bytes/limits; no “all healthy” from an empty findings list |
| Write effects | Zero for the diagnostic itself; not a promise about separate mutation commands |

These labels are design vocabulary, not existing wire fields. Public output should
contain paths/allowlisted codes and bounded metadata, not memory text, parse-error
excerpts, credentials, prompts or provider output. Missing optional data is not a
failure; inability to determine its state must not become success. Preserve existing
read fallback until an explicit compatibility change is implemented and tested.

Reuse domain validators and scope resolution. Avoid a universal schema or recursive
payload scan. A role-validator error must remain an error; an array-only legacy
memory read must not be advertised as complete item validation. Before parsing,
require bounded regular-file reads, appropriate link/identity checks and strict
decoding. Reuse pure domain schema validation on bounded input; do not assume the
current `readRoleStore` whole-file read enforces a physical read cap during growth.
A diagnostic snapshot is not a writer lease or a durable authority.

## Implementation order and acceptance gates

1. **Observability:** separate read-only diagnostics, preserving existing metadata-only
   behavior. Check valid/absent/blank/syntax/shape/read-error/oversize inputs and
   effective-source provenance; assert original bytes, file set and mtimes unchanged.
2. **Memory mutation admission:** validate the canonical source inside the operation's
   lock and before archive, projection, log or canonical writes. Retest add, dedup,
   drop and restore. Handle concurrent replacement and failed later writes explicitly;
   an early check alone does not create a transaction.
3. **Migration B:** reuse the validated source-selection contract. Refuse uncertain
   canonical authority, retain originals and evidence, and prove rollback and legacy
   writer admission. Only then advance runtime activation.

Characterization checks of today's skip behavior document a gap; they are not an
acceptance requirement to preserve that gap forever. New diagnostics require new
tests for explicit unknown/error reporting. Existing role/runtime guards must not
be weakened, and a source inventory is not a complete writer audit.
