# Runtime compatibility, before migration

P-0021 / T-0180 implements compatibility checking only. Legacy data stays in place.
No command creates a descriptor, moves data, activates a runtime or finalizes a run.

## Read-only diagnosis

```sh
leerness state compatibility . --json
```

Accepts one optional project path or `--path`; the explicit flag takes precedence.
Unknown/duplicate flags, blank paths and extra operands fail before bookkeeping.
Exit 0 means the observed legacy layout is compatible; exit 1 means blocked.
`state inspect` remains a separate metadata-only path/inventory operation.

```json
{
  "schema": "leerness.runtime-compatibility/v1",
  "schemaVersion": 1,
  "ok": true,
  "compatible": true,
  "writeDisposition": "allowed",
  "reasonCode": "legacy_absent",
  "scope": "worktree",
  "observedLayout": "legacy",
  "supportedWriterProtocol": 1,
  "activationSupported": false,
  "workspaceAdmission": "operation-start"
}
```

The report contains bounded reason codes, not descriptor text, raw Git output, private
conversations or inferred migration success. It creates no cache, lock or presence record.

## Reader exports

- createRuntimeCompatibilityReader(root): capture topology/admission and return a fresh observation function.
- inspectRuntimeCompatibility(root): new admission and one read-only report.
- assertRuntimeWriteAllowed(root): join writer admission, then return an allowed report or throw a bounded compatibility error.

## Fields

- schema: `leerness.runtime-compatibility/v1`.
- schemaVersion: 1.
- ok: the observation is compatible.
- compatible: the legacy writer is admitted by this observation.
- writeDisposition: `allowed` or `blocked`.
- reasonCode: bounded stable reason, never descriptor contents.
- scope: `worktree`, `project-local`, or `unknown` when authority cannot be established.
- observedLayout: `legacy`, `unsupported`, or `unknown`.
- supportedWriterProtocol: 1.
- activationSupported: false.
- workspaceAdmission: `operation-start`.

## Fixed authority and strict input

- Git: `<GIT_DIR>/leerness/layout.json`, fixed for the whole worktree, outside projectKey.
- Non-Git: `<projectRoot>/.leerness/cache/state-layout.json`, independent of workspace selection.
- Only the six fields described in [the migration contract](worktree-runtime-migration.md)
  are accepted. Maximum 16 KiB; strict UTF-8, no BOM, duplicate/unknown keys, hard links,
  unsafe parent links, special files or changed-during-read input.
- New Git `leerness/projects` (even empty), alternate legacy-workspace layout indicators,
  non-Git state-runtime, or unresolved introduction of Git block legacy writes.
- Missing Git is acceptable only for positively identified non-repositories. Broken Git,
  discovery overrides, ambiguous ownership and topology changes fail closed.

## Writer operation boundary

`createRuntimeCompatibilityReader(root)` resolves one immutable Git topology snapshot.
It admits workspace ownership/selection once at operation start. It rechecks directory
types/links, topology identity, descriptor bytes and fixed runtime indicators on later reads.
It does not recursively scan runtime records or reclassify an operation's own transient files.
This distinction preserves existing init and lock-owned legacy workspace migration.
New public inspections and later writer operations make a new workspace admission.
New writer operations may read-only wait for an existing regular, single-linked legacy
workspace migration lock before classifying ownership. They reclassify after the peer
finishes; waiting never grants lock ownership or permission to overwrite a conflict.
The existing migration wait budget defaults to 10 seconds, is configurable through
`LEERNESS_WORKSPACE_MIGRATION_LOCK_WAIT_MS`, and is clamped to 0–60 seconds. Expired or
non-regular/linked lock observations block with `workspace_dir_migration_locked`; no
lock is read, reclaimed or deleted by admission. The budget bounds contention waiting,
not unrelated Git/filesystem I/O. Public `state compatibility` remains immediate.
An observed non-workspace denial is terminal even if a peer subsequently removes its
descriptor. A conflict snapshot gets at most one extra classification when no lock is
seen, covering a peer that completed between observations without accepting persistent
dual-live state.

Canonical project identities share one admitted reader across 8.3, namespaced and
junction aliases. Each target is resolved again, so retargeting an alias does not retain
stale authority. Nested operations on another project receive independent admission;
an operation never waits for its own migration lock through an equivalent path.
Standalone stores may coexist with their producers' exact lock/release, temporary,
corruption-backup and first-install names. Unknown names, links and incorrect entry
kinds remain refused; the reader does not open store or recovery contents. This
preserves concurrent role/provenance writers without accepting an arbitrary folder.
Existing standalone output directories are recognized by exact name and regular
directory kind, so a producer's first successful write does not block its next operation:

| Exact top-level directory | Existing producer |
| --- | --- |
| `previews` | Preview commands and direct store-free builder |
| `api-skills` | API document/skeleton storage |
| `skills` | Local skill learn/install |
| `personas` | Custom persona templates |
| `skills-export` | Local skill export/export-all |
| `reviews` | Review prompt `--emit md` directory |
| `incidents` | Incident JSON storage |
| `skills-publish`, `skills-publish-tarball` | Existing local publication staging |

Admission neither enumerates nor reads their contents, and does not certify domain
records, authorize publication, or bypass a producer's own checks. Linked directories,
wrong entry kinds, lookalike names and foreign siblings remain refused. The existing
E2E API collision/corruption/JSON contract is preserved without requiring `init`.

The same exact-name rule covers existing standalone files below, including their
already-defined lock/temporary/recovery shapes. Metadata recognition is not a claim
that each command can execute without its own prerequisites or user authorization.

| Exact top-level files | Existing producer |
| --- | --- |
| `user-requests.json` | Request recording |
| `shell-failures.json` | Shell analysis `--record` (not command execution) |
| `platform-constraints.json` | Custom platform constraints |
| `wakeup-history.json` | Local wakeup history/interval settings |
| `agent-slash-commands.json` | Slash-command snapshot recording |
| `environment.json` | Environment detection writeback |
| `agent-permissions.json`, `credentials.local.json` | Explicit local settings/credential registration |
| `llm-bench-history.md` | Manual benchmark recording |
| `glossary.md`, `glossary.json` | Glossary build |
| `reuse-map.md`, `design-system.md` | Reuse registration/design-guide merge |
| `skill-suggestions.md`, `skill-auto-cache.json` | Skill suggestions/official catalog cache |
| `provider-probe-cache.json`, `orchestrate-log.md` | Provider-probe cache/explicit orchestration log |
| `feature-graph.md` | Feature graph, with the existing project/explicit-force gate |
| `enforce.json` | Hook installation, still requiring Git and its installation checks |
| `agent-reminders.md` | Explicit stale-handoff writeback |

No cache refresh, provider call, server, credential operation, scheduling or publication
is performed by compatibility inspection. This is a bounded legacy-producer inventory,
not a new migration manifest or a guarantee about unregistered external writers.

`withRuntimeWrites(root, callback)` provides an operation-local synchronous/async failure
latch. CLI admission precedes automatic workspace migration and bookkeeping and uses the
handler's actual target/precedence. MCP telemetry, long-lived REPL turns, known direct
module writers, I/O paths, retained descriptors and lock heartbeat use the same reader.
Synchronous filesystem interception is active only inside writer operations; importing
the module alone does not modify the host's filesystem methods. Windows subprocess-based
replacement and mutating Git commands have explicit pre-attempt checks.

CLI startup rejection uses `runtime_layout_incompatible`; direct writer rejection uses
`E_RUNTIME_LAYOUT_INCOMPATIBLE` with `reasonCode`. Unsafe descriptor parents or ambiguous
standalone ownership are rejected before domain-specific validation. Direct read-only
store APIs retain their own specific diagnostics. Existing workspace selection errors
(such as conflicting live workspaces) retain their established CLI error contract.

`pathWriter` recognizes metadata paths; callers writing arbitrary project files must carry
their project operation explicitly. Raw external editors, subprocesses, old installed hooks,
other clones and unsupported external writers are not fenced by this API. A caught guard
error must not become successful completion. Already prepared recovery material is retained
if later incompatibility prevents cleanup; do not automatically delete it or assume rollback.

Topology is reused to avoid repeated Git processes; compatibility itself is never a stale
cache. A 50-read fixture used one Git query and one workspace enumeration after admission,
versus 50 enumerations in the first implementation. This is an I/O count, not a throughput benchmark.

## Limits and verification

An external change between the final check and actual write is still possible. Generation
is not a fencing token. Do not activate a future layout under A-only clients. Real v1.36.186
CLI and already-loaded writer controls demonstrate that older clients ignore the descriptor.
Phase B requires separate approval, stopped/upgraded participants, a writer admission
protocol and verified recovery/retention. None is supplied by an `allowed` report.

`npm run test:runtime-compatibility` runs reader, bounded admission/alias/denial controls,
real CLI/MCP/module/lock/FD, Git transport,
Windows replacement and encoding-diagnostic probes. Windows-only controls are not implied
by POSIX results. Release-only old-client controls require an existing installation:

```sh
node scripts/legacy-runtime-negative-probe.js /path/to/installed/leerness-1.36.186
```

The probe does not install a package and checks the old installation's source remains unchanged.
