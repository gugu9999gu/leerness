# Bounded context packet and exact source reads

This bounded read service now includes selected active memory and explicit retained-task reads. It is not completed task migration, arbitrary archived-memory restore or a release approval. See [selected memory and retained-task context](context-memory-history.md). Existing `context current`, handoff and legacy MCP JSON contracts remain unchanged.

## Commands

```sh
leerness context packet --path /project --json
leerness context packet --path /project --task T-0001 --json
leerness context source --path /project --id rules --revision <sha256> --json
leerness context source --path /project --id rules --revision <sha256> --offset 2048 --json
leerness context source --path /project --id task:T-0001 --revision <taskSource.sha256> --json
```

`packet` and `source` always return compact JSON. Repeated flags, unknown arguments, arbitrary source paths and fractional/negative byte offsets are rejected. `--help` describes both commands. An omitted path uses the caller directory; a supplied empty path is not substituted. `packet --task` selects an exact active-tracker row, including a waiting or terminal row for inspection. Without it, the existing owner-priority selector chooses an actionable task. An explicitly requested task absent from the active tracker can be read from verified retained history, labeled `explicit-retained-task`; automatic next-task selection never selects retained terminal work.

MCP core and full profiles expose `leerness_context_packet` with `{path?, task?, includeMemory?, memoryQuery?}` and `leerness_context_source` with `{path?, id, revision, offset?}`. Both call the same library service directly, after the existing policy check. They do not spawn another CLI process, mutate process arguments/environment, record session freshness or probe a model/provider. These are additive tools; older handoff/state/task adapters have not all been replaced.

## Size and completeness

The entire domain response JSON, including schema, observation, source revision, data, warnings, missing IDs and measurements, plus its CLI newline is at most **8,192 UTF-8 bytes**. This is not JavaScript string length or a token estimate. MCP transports that same domain JSON inside its text result; the outer JSON-RPC framing/request ID is not included in this domain limit.

The response is navigation only. `completenessScope` is `selected-task-and-listed-policy-sources`, or `selected-task-listed-policies-and-selected-memory` with explicit memory inclusion. Neither means every instruction, dependency, decision, lesson, test or evidence required to execute a task. `complete:true` is not execution authority, review approval or proof of tests passing. It means the selected task and the required registered policy source bodies fit and were observed successfully. No actionable task is represented by `task:null` and `selection:none`, not a newly invented completed task.

The selected task is included first, then whole policy bodies. A body that does not fit is omitted completely, never truncated or guessed into a summary. `complete:false`, `missingRequiredIds` and `missingRequiredCount` identify all omitted/missing required sources. `data.taskSource` remains an exact task-row reference when the task itself is too large. Missing source metadata is distinct from a present-but-omitted body. A source that appears only after capture makes the snapshot stale.

The base slice has eleven registered documents and at most one selected task reference. Optional memory uses four fixed JSON/Markdown paths and selects at most two document groups. Explicit retained-task reads add checked history metadata and one original tracker source, not a general dynamic document catalogue. The missing-ID set is therefore bounded by construction and fully returned. It does not implement a dynamic many-thousand-ID catalogue, ID pagination or automatic discovery of every document mentioned in an instruction. A minimum envelope that cannot fit is a bounded error, not malformed/truncated JSON.

## Source registry and revision

Selection inputs: `tasks` = `.leerness/progress-tracker.md`, `plan` = `.leerness/plan.md`.

Required policy bodies: `agents` = `AGENTS.md`; `workflow`, `routing`, `rules`, `guideline`, `protected`, `writeback`, `anti-lazy` map to `.leerness/session-workflow.md`, `.leerness/context-routing.md`, `.leerness/rules.md`, `.leerness/guideline.md`, `.leerness/protected-files.md`, `.leerness/writeback-policy.md`, `.leerness/anti-lazy-work-policy.md`. `source-of-truth` = `SOURCE_OF_TRUTH.md` is additionally required when present. These logical IDs are fixed paths, not arbitrary filesystem capabilities.

`sourceRevision` contains an observed Git commit or null and its observation status, the existing legacy runtime-layout marker/scope, each selected source's logical ID/path/exact-byte SHA-256/byte length/presence, and a digest of this fixed-order projection. Observation time is excluded from the digest. Editing a selected file without committing therefore changes `selectionDigest` even under the same HEAD. Dirty files outside the selected set are not represented. General task-control revision and `resultRef` are null because their LEAN-03/04B authority is not implemented or activated.

The existing checked file reader rejects symlinks, nonregular/multilink files, malformed UTF-8 and files over its 4 MiB per-source admission limit. Duplicate/malformed task rows fail closed. The runtime resolver and selected inputs are revalidated before returning; a changed source returns an error rather than mixed-version data. No read-lock over arbitrary external editors or atomic cross-file transaction is claimed. Unsupported runtime layouts are not guessed into a compatible empty workspace.

## Exact bytes and pagination

Use the returned source `sha256` as `--revision`; memory group `sourceRef.revision` is that same document digest. It binds the exact registered document or task row, not the whole packet's `selectionDigest`. Pages return at most 2,048 raw bytes as base64 plus byte offset, total byte length and `nextOffset`. For a task, the hash and bytes cover its exact tracker row including its original newline. For a document, BOM, CRLF, emoji and combining marks are preserved. A page may end inside a UTF-8 sequence: concatenate decoded byte pages before decoding text. Do not concatenate independently decoded partial strings.

In `source`, `complete` means this is the final page. Continue using the same ID/revision and the returned `nextOffset` until null; verify the concatenated byte length and SHA-256. A changed or missing source fails closed. An explicit retained task uses its verified preserved source; no unavailable past version is reconstructed or silently replaced with current text. Exact byte retrieval/reassembly and retained-task lookup are implemented. This read command never writes restored bytes. The existing explicit `context history` preview/apply/preview-restore/restore pipeline now has byte-round-trip integration tests with packet/source. Arbitrary policy/memory version recovery and selective merging of a restored row into new work are not implemented here.

## Reads, cache and safety boundaries

Measurements report actual successful selected-source body bytes read during capture and revalidation, unique source-file count and read-operation count. The checked reader now returns successful revalidation byte/file counts; its existing identity checks are unchanged. Counts exclude Node module loading, directory metadata, runtime descriptor reads and Git output. They are not total command I/O, model tokens or a measured speedup. Source pagination revalidates its admitted source, so repeated pages reread it rather than pretending to be a free cached lookup.

No new persistent cache or index is created by this slice. An unrelated stale/corrupt history index is not an authority and does not replace selected source data with an empty result. Ordinary packets do not read historical bodies. An explicitly retained task reads one selected original tracker and checked history metadata; stale or incomplete history fails closed. Optional memory reads selected active JSON or legacy Markdown, not every history body. Arbitrary memory/archive support still needs its own identity and restore integration. No automatic archiving/deletion, state migration, receipt, task claim or result publication is added by these reads.

`node --test scripts/context-packet-probe.js` exercises UTF-8/envelope limits, all omitted IDs, oversized tasks, exact BOM/CRLF/page round-trip, same-HEAD dirty revision, stale snapshots, errors, existing policy refusal, CLI/MCP semantic parity, no project writes and OFFLINE-unset network/CLI-child instrumentation with a positive blocking control. This instrumentation is not an OS-wide sandbox. The probe is part of the existing `test:lean-readonly` tier, not a new mandatory product self-validation gate.

The shared row predicate also remains connected to the legacy writer. Two integration controls require malformed-row loss to be rejected before publication and authored text after the last tracker row to survive an actual locked write. These protect existing mutation behavior; packet/source themselves remain read-only.
