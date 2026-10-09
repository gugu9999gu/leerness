# Read-only memory migration observation

Local development interface, first included in unreleased 1.36.193.

```sh
leerness memory-migration inspect decisions --path /path/to/project --json
leerness memory-migration inspect lessons --path /path/to/project
```

Both forms return complete JSON. Exit 0 means the observation completed with its
required sources rechecked; exit 2 means invalid arguments, blocked/incomplete assessment
or failed observation. A migration candidate does not mean migration was performed
or approved. Writes use the separate [explicit migration CLI](memory-migration-write.md).

The full MCP profile exposes `leerness_memory_migration_inspect`, a read-only tool:

```json
{"surface":"decisions","path":"/path/to/project"}
```

`surface` is required and is either `decisions` or `lessons`. `path` defaults to the
server working directory. Extra properties, pagination, source payloads and approval
arguments are rejected. MCP returns the same complete JSON in one text content block;
`isError` is the inverse of `ok`. The core profile does not expose this tool.

## Source and outcome

The existing workspace selector and runtime compatibility reader choose and admit
one project. The observer reads only the selected surface's fixed `.json` and, only
when that file is positively absent, `.md` name. A missing workspace is unreadable,
not proof that both files are absent. Existing `.harness` workspaces are inspected
without automatic migration. Other project, Git and runtime metadata is read by the
existing selection/admission helpers; the two-file limit applies to memory content.

Canonical JSON must be valid UTF-8 and have an array root. Its elements are not
validated. Corrupt, unreadable, linked, non-regular or oversized canonical files
block fallback. The legacy bytes, including any BOM, enter the existing
[pure assessment](memory-migration-plan.md) unchanged. The response includes fixed
state/reason metadata and candidate size estimates; never source text, entries,
absolute paths, parser exception messages or a migration payload.

`sourceRechecked: true` means the observations used in this response were compared
again in this call. It can accompany `ok: false`, for example a stable corrupt file.
`atomicObservation: false` is unconditional. The nested assessment deliberately
keeps `sourceTrust: caller-supplied`, `sourceVerified: false`, and
`semanticCoverage: unknown`. Neither field set is a durable attestation or a token
that a writer can accept as authorization. `approvalGranted` and `writesPerformed`
remain false.

## Bounds, changes and effects

Checked input captures private bytes, descriptor/path identity, metadata and parent
resolution. Present and absent inputs are rechecked after workspace and runtime
checks; any detected change discards the candidate. Stable pre-existing ancestor
aliases are allowed; lexical-parent rebound during the observation is rejected.
The observer does not lock or retry. Sequential path checks cannot provide an atomic
snapshot, stop a writer after the final check or prove crash durability.

Each memory file is limited to 1 MiB. Oversized stat results are rejected before
open; actual reads stop at limit plus one byte even if metadata underreports size.
The same limit applies on recheck. ML-01 also applies parser and generated-output
budgets. These are diagnostic limits, not a new writer size/item policy or a bound
on whole-command CPU, RSS, directory enumeration or Git work.

The CLI entry runs before usage, presence and workspace-migration bootstrap.
The MCP adapter retains normal profile/permission checks and uses the same observer.
Tests cover complete CLI/MCP startup and calls, unchanged file inventory/hashes/mtime,
and mutation traps that also detect attempted writes whose errors were swallowed.
Normal filesystem access-time updates are outside the no-write comparison.

Raw retention and explicit apply/rollback are available through the separate CLI in
unreleased 1.36.194. Multi-file transactions and writer item/count admission remain
outside this interface. Existing `state inspect` and `state stores` contracts are unchanged.
