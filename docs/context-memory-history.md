# Selected memory and retained-task context

The current tracker remains the task authority. This service connects existing checked reads and history-retention primitives to the bounded packet service; it does not introduce a second database, automatic archiving, a cache authority, a new task-claim store or runtime activation.

## Selected decisions and lessons

```sh
leerness context packet --path /project --task T-0001 --with-memory --json
leerness context packet --path /project --memory-query "publication timeout" --json
```

The ordinary packet remains unchanged in scope: without these options it does not open the active decisions/lessons bodies or inspect retained history. `--with-memory` selects entries that explicitly reference the selected task ID; a reference to T-00010 does not match T-0001. `--memory-query` instead selects a literal, case-insensitive substring and implies memory inclusion. No regular expression, language model, fuzzy inference or provider invocation is used. At most two matching entries from each surface are selected in original order. `memorySelection` reports matched/selected counts and `allMatchesSelected`; it does not claim that the selected entries represent all relevant project knowledge.

MCP uses `includeMemory:boolean` and `memoryQuery:string` on `leerness_context_packet`. An explicit false `includeMemory` combined with a query is rejected. Queries must be nonblank, contain no ASCII control characters and fit within 256 UTF-8 bytes. Duplicate CLI flags and unknown fields fail closed. Existing project read-policy enforcement still runs before the direct service call.

Canonical `.leerness/decisions.json` / `lessons.json` take precedence. Each is read with the existing checked reader and 4 MiB limit, parsed as an array and validated with the existing memory-item shape rules. Depth above 64 or more than 10,000 entries is refused. Corrupt canonical data never silently falls back to a valid Markdown projection. Only when JSON is absent does the existing legacy Markdown parser read `decisions.md` / `lessons.md`. Missing canonical files are captured too, so their appearance invalidates an already captured legacy snapshot.

Selected entries are explicitly labeled `parsed-entry-values`. Canonical JSON entry fields, including additional authored fields, are returned without inventing summaries. Legacy parsers retain their existing projection limitations: arbitrary prose, formatting and unparsed content are not certified as fully interpreted. Their whole source document remains exactly retrievable. A revision-local array index is **not a permanent memory ID**. This change does not assign IDs, migrate records, rewrite sources or pretend that old flat memory already has immutable record identity.

## Budget and exact original bytes

The existing 8,192-byte UTF-8 domain-response limit includes all metadata, counters and missing IDs, plus the CLI newline. Task and required policy bodies take precedence over selected memory. A selected memory group that does not fit is omitted whole, `complete` is false and its registered document ID appears in `missingRequiredIds`. `sourceRevision.selectedSources` provides its SHA-256 and byte length even when its selected entry values are omitted. No body is partially truncated.

`complete:true` is limited to the selected task, listed policies and the explicitly selected entries. It is not all matching entries, all possible instructions, semantic approval or execution authority. A limited memory selection is separately visible through `allMatchesSelected:false`. There are at most two selected memory groups and all required missing document IDs are returned; no dynamic, unbounded memory-ID catalogue or cursor is claimed implemented.

```sh
leerness context source --path /project --id memory:decisions:json --revision <sha256> --json
leerness context source --path /project --id memory:lessons:markdown --revision <sha256> --offset 2048 --json
```

The four fixed memory document IDs use surfaces `decisions`/`lessons` and formats `json`/`markdown`. They are not arbitrary filesystem paths. Source pages contain at most 2,048 raw bytes encoded as base64. Concatenate decoded bytes, then verify total length and SHA-256; BOM, CRLF, emoji and combining marks survive. The digest binds the whole source document, not an index or reserialized entry. Page boundaries can split a UTF-8 sequence. Raw document retrieval preserves a malformed-but-valid-UTF-8 JSON document for inspection; packet interpretation refuses it.

## Retained tasks and explicit restoration

An explicit `context packet --task T-0002` first searches the active tracker. Only if that exact task is absent does it inspect the existing retained-history index and load the selected original source. It never automatically selects terminal history as the next actionable task. `data.selection` becomes `explicit-retained-task`, and the row retains its existing task ID and history provenance. Current task ID allocation/reservation remains owned by the existing history mechanism.

The checked history inputs include the operation journal, index, relevant completion manifest/receipt and the one selected retained tracker source. Their byte digests join `sourceRevision`. An older selected operation does not trigger reading other operations' tracker bodies. Metadata that points to missing or changed bytes, stale row metadata, a pending operation, malformed index or missing completion records yields an explicit error, not a healthy empty task list. No persistent index cache is added.

`context source --id task:T-0002 --revision <taskSource.sha256>` reads the exact current or retained row, including its original line ending. The row digest is the same before retention, during retained lookup and after an exact restoration. An active row takes precedence; a request with an obsolete digest fails rather than substituting unrelated historical bytes. Arbitrary prior policy/memory versions and the older decisions/lessons drop archives are outside this new retained-task lookup.

Use the **existing explicit** history commands, not automatic changes during a read:

```sh
leerness context history preview --path /project --tasks T-0002 --json
leerness context history apply --path /project --tasks T-0002 --expect <preview.expected> --json
leerness context packet --path /project --task T-0002 --with-memory --json
leerness context history preview-restore --path /project --operation <operationId> --json
leerness context history restore --path /project --operation <operationId> --expect <restorePreview.expected> --json
```

A full original tracker and index are retained before publication. Restoration is the existing whole-snapshot operation: intervening work blocks it rather than being overwritten or merged speculatively. It is not a selective single-row restore into an independently changed tracker. Interrupted operations keep their established pending/recovery behavior and ownership protection. The current change does not alter the writer, bypass locks, clear an old owner's lock, waive project-write policy, perform any operation on the owner's live project, or claim immunity to arbitrary OS/manual deletion.

## Evidence and remaining work

`node --test scripts/context-memory-history-probe.js` covers optional-source isolation, exact task references, literal selection and limits, canonical corruption, legacy source preservation, source changes, whole-source omission, explicit retain/read/restore byte round-trip, new-work restore refusal, selected-history-only reads, pending/stale/missing history, linked paths, CLI/MCP parity and OFFLINE-unset blocked-network instrumentation. Its positive HTTP control proves the instrumented path is blocked before transport; this is not an OS-wide network sandbox. The existing history reader/writer, packet and task-preservation suites remain in place. The new probe joins the existing `test:lean-readonly` tier, not a new compulsory product self-validation gate.

Counters include actual successful selected-file capture and revalidation bytes. For a retained task, history journal/index/manifest/receipt reads are included, and `historyBodiesRead` counts the selected original tracker body. Directory metadata, module loading, Git output and total process I/O remain outside these counters. A single large retained snapshot may still need a full bounded source read per page. No performance improvement percentage, token savings or all-client acceptance is inferred from those counts.

Remaining work includes migrating older handoff/task/state read adapters without semantic drift, broader client/integration acceptance, permanent decision/lesson identity and archived-memory integration where explicitly designed, and LEAN-03/04B ownership/runtime/finalize. Same-session self-review and focused tests do not constitute independent approval or public release authorization.
