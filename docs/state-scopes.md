# State scopes and migration design

Status: scope inspection implemented; runtime architecture remains proposed (2026-09-05).
Request: UR-0097; implementation/optimization approval: UR-0098. Audit: T-0173.
First implementation: T-0174 / approved P-0020. See [the inspection API](state-paths-api.md).

**Only path resolution and `state inspect` are implemented; the stores and migration below are designs.**
The first implementation covers path resolution and read-only inspection only. Existing writers,
data locations, task IDs, CLI/MCP contracts and approval gates remain unchanged until an
explicitly approved migration passes its compatibility tests.

## 1. Evidence from the current implementation

Audited baseline: v1.36.185, commit `c84ab03b5b5d385985ee2797a95c02c7d4004be4`.

| Surface | Existing source / storage | Structural consequence |
|---|---|---|
| Project directory | `lib/workspace-dir.js` resolves `.leerness` and migrates `.harness` | The baseline had no scope resolver. T-0174 adds one without replacing this migration; a pure selector reuses the existing inspection snapshot. |
| Session presence | `lib/session-presence.js` predicates and `bin/leerness.js` I/O use `.leerness/cache/sessions/` | Sessions have addresses and ignored runtime files already, but different worktrees cannot see each other's presence through this store. |
| Handoff freshness | `bin/leerness.js`: `.leerness/cache/handoffs/` | Session-bound freshness markers are consumed by handoff/enforcement; migrate those consumers together. |
| REPL conversation sessions | `bin/leerness.js`: `.leerness/cache/agent-sessions/<sessionId>.jsonl` | This is a separate local conversation surface, not presence. Do not promote raw conversations into public audit records. |
| Source-file lease | `lib/file-leases.js`: `.leerness/cache/file-leases.json` | Exact-file TTL coordination is local to a checkout; it is not a repository-wide task claim. |
| State substrate | `bin/leerness.js`: `.leerness/state.json`, `runs/run-N.json`, `handoff/` | Session ownership fixes same-checkout cross-talk, but counters and mutable run files remain local branch files rather than globally unique completion records. |
| Decisions and lessons | `_saveDecisions` / `_saveLessons`: JSON arrays plus Markdown projections | Valid JSON arrays take precedence. Current readers silently fall back to Markdown for invalid JSON/non-arrays; migration must not. Both the array and its projection are rewritten, so independent records still change the same tracked files on separate branches. |
| Task progress | `readProgressRows` / `writeProgressRows`: `.leerness/progress-tracker.md` | The table is currently authoritative, not an event-derived view. Reclassifying it without migrating all readers and writers would lose task updates. |
| Session close | `lib/session-close.js` reads task rows, writes handoff, updates auto-marked current-state lines, invokes further bookkeeping | File locks serialize local writes, not Git merges or a whole multi-file snapshot. The first in-progress task selects the recommendation, which need not be the current session's task. |
| Execution provenance | `lib/role-fallback.js`: `.leerness/execution-ledger.jsonl` | Revision-bound role/fallback evidence exists, but this checkout ignores the ledger. It is not a durable Git audit record. |
| Runtime-like tracked files | `git ls-files` includes `active-wakeups.json`, `auto-resume-plan.json`, `next-action-queue.json`, `pre-wake-report.json`, `last-handoff.json`, `routing-log.json` | Ignoring `cache/` alone does not remove mutable operational state from merge inputs. Classification must be per surface, not extension-based. |
| Integrity checks | `lib/state-integrity.js` inspects only immediate `.leerness/*.json` parseability | Moving to nested stores needs explicit schema/record coverage; a green legacy scan cannot attest to new scopes. |

Some fields mix intent with execution: a queued next action or resume plan may contain
user-authored instructions. Preserve those as project/task inputs, and move only execution
status/cursors to runtime. Never classify an entire mixed file as disposable cache.

## 2. Three storage layers, five semantic scopes

The three physical layers are **versioned project data**, **worktree-private execution**,
and **repository-common coordination**. Immutable-Record and Generated-View are semantic
scopes within that topology, not two additional database servers.

| Scope | Proposed location | Authority and writer |
|---|---|---|
| Project | `<project>/.leerness/` and optional `config/` | Versioned policy, role definitions, project identity, task specifications and human-authored context; explicit project mutations only. |
| Worktree | `<gitDir>/leerness/projects/<projectKey>/runtime/` | Per-session/per-run execution state. One owner per mutable session record; no branch name as identity. |
| Common-Control | `<gitCommonDir>/leerness/control/projects/<projectKey>/` | Claims, leases, dependencies, registered worktrees, fencing revisions and run status. All writes pass the same ControlStore transaction boundary. |
| Immutable-Record | `<project>/.leerness/memory/{decisions,lessons}/` and `.leerness/records/runs/<runId>/` | Individual durable knowledge/result/review records. Exclusive creation; corrected decisions link `supersedes`, never silently overwrite. |
| Generated-View | `.leerness/generated/` for canonical projections; private runtime `views/` for live session views | Deterministic output with input digests and schema/generator versions. Canonical summary is written only by the consolidator. Live view is local and ignored. |

The main worktree commonly has `gitDir === gitCommonDir`. Distinct `runtime/` and
`control/` namespaces are therefore mandatory even there. A session subdirectory is still
required: two agents can operate in one worktree.

The audited repository confirmed the linked checkout's Git directory ends in
`.git/worktrees/t0165-convergence`, while the main checkout and both common-directory
queries resolve to the main `.git`. This matches the [Git worktree documentation](https://git-scm.com/docs/git-worktree#_details).
Use Git's [absolute path queries](https://git-scm.com/docs/git-rev-parse#_options_for_files),
not string concatenation with `<project>/.git`, which can be a gitfile.

### Identity and unsupported environments

- Resolve topology through the existing `lib/git.js` environment-sanitizing, shell-free
  gateway. Resolve the worktree root separately from the Leerness project root.
- Preserve existing workspace markers and foreign-directory detection. A directory with
  only new `config/memory/records/generated` children is not automatically recognized by
  today's workspace classifier; a versioned marker/compatibility update is required.
- P-0020 uses a deterministic project key derived from the canonical repository-relative
  project path (`.` for the root); identical subprojects across linked worktrees match,
  sibling monorepo projects do not. A future explicit project ID can preserve identity
  across project moves. Neither ID is a credential or an authorization boundary.
- Resolve Windows case/alias/junction and symlink containment before writing. Reject
  ambiguous mappings instead of silently sharing or relocating another project's state.
- Bare repositories, broken gitfiles, permission failures, unsupported Git and Git absence
  must be distinguishable. Git errors do not silently select a different storage backend.
- True non-Git projects retain an explicitly labelled, ignored project-local runtime
  fallback; they have no cross-worktree coordination guarantee. Inspection creates nothing.
- Submodules use their own Git topology. Separate clones and separate hosts do not share
  `gitCommonDir`; remote coordination is out of scope. Network filesystems need a separate
  locking guarantee before they are supported for common control.

## 3. Module boundaries and reuse

The inspection modules exist now. Store/facade/view names below remain planned contracts:

| Module | Responsibility | Existing component to reuse |
|---|---|---|
| `lib/state-paths.js`, `lib/state-git.js` (implemented) | Five-scope map, canonical project namespace and read-only Git topology; no activation | `lib/git.js`, one `lib/workspace-dir.js` snapshot + pure selection without migration |
| `lib/state-inventory.js`, `lib/state-inspect.js` (implemented) | Fixed known-surface metadata inventory and CLI JSON/text projection; no recursive content scan | Existing workspace discovery; CLI exact early dispatch skips usage/migration/stale checks and unused skillpack/npm discovery |
| `lib/state-manager.js` | Narrow orchestration facade, schema dispatch, explicit migration status; no giant all-purpose store | Existing CLI/MCP adapters delegate to this facade incrementally |
| `lib/worktree-state.js` | Addressed sessions, runs, handoffs and resumable execution; explicit ownership | Session key and freshness contracts in `lib/session-presence.js`; existing run ownership rules |
| `lib/control-store.js` | Repository-scoped task claim, revision CAS and fencing; transaction ordering | Existing lock primitives after common-root/multi-process validation; no duplication of Git execution |
| `lib/memory-store.js` | Strict, bounded immutable record load/create; supersession/index projection | Existing decision/lesson parsers and renderers as legacy import adapters |
| `lib/run-record.js` | Validate execution/review envelopes, finalize and durable receipt | `lib/role-agent-schema.js`, `lib/role-store.js`, `lib/role-fallback.js` provenance contracts |
| `lib/state-views.js` | Pure deterministic rendering from an explicitly consistent snapshot | Existing Markdown renderers and dashboard serialization, preserving handwritten text |

Dependency direction: CLI/MCP → StateManager → domain stores / views → path, Git and I/O
primitives. Read-only topology inspection must not call initialization, workspace migration,
telemetry, presence registration, lease creation or providers. Avoid reusing a convenient
helper whose discovery path has write side effects.

Runtime dependencies remain zero, Node >=18. Start with bounded JSON records and existing
file-lock primitives, not a new YAML parser or SQLite package. `ControlStore` is a storage
interface; a database backend is a future evidence-driven option, not an MVP dependency.

## 4. Concurrency and conflict rules

1. A session owns its mutable runtime files; other sessions submit records/messages through
   a store operation, never directly edit its progress or handoff.
2. Runtime is not a Git merge input. Moving files alone is insufficient: migrate ignore
   rules, old writers, hooks, telemetry, integrity checks, packaging and cleanup too.
3. Persistent knowledge is record-oriented. Use built-in random UUIDs or an equivalently
   collision-resistant scheme, not a branch-local maximum counter. Preserve legacy IDs as
   qualified import metadata; never merge two unrelated `T-0174`/`run-0001` by label alone.
4. Same ID + same canonical payload is an idempotent replay. Same ID + different payload is
   `record_id_conflict` and changes no records. Create atomically without overwrite.
5. Generated-file conflicts are resolved by regenerating from accepted inputs. Preserve
   human-written sections as project context before deprecating old mixed documents.
6. Semantic decision disagreement creates a separate decision/review, not `merge=union`.
7. A single logical consolidator publishes canonical project summaries. A role label alone
   is insufficient: validate owner, lease generation and expected revision at publication.
   Expired writers cannot publish after a successor acquires ownership (fencing).
8. Physical source-file leases and repository task claims are distinct. Two worktrees can
   edit their separate copies of the same path. Intentional duplicate task execution is
   coordinated by a repository task key; source leases remain keyed by physical identity.
9. Common control transactions cannot rely on a thread holding a lock elsewhere. Define
   lock ordering, bounded critical sections, stale-owner recovery and byte/row limits;
   verify concurrent acquisition and crash recovery with real processes.
   Existing lock ownership must not be stolen solely because a PID looks absent or a TTL
   expires. A new task-claim lease and a local write mutex have different recovery contracts.
10. Visibility is not authority: provider observations can be unknown or stale. A role or
    policy revision change requires revalidation; cross-worktree policy divergence cannot
    be resolved by taking whichever branch updated control most recently.

Presence currently records handoff/close observations, not a heartbeat protocol or proof
that a process is alive. Common control must distinguish observed presence, a held lease,
an expired heartbeat and unknown availability. Retain existing session identity validation.

## 5. Run/review provenance and finalize

Each run has separate implementer, reviewer and terminal result records. Fields include:
schema version, globally unique run/task/agent identity, role, requested and actual
provider/model, observed identity source, resolution/fallback chain and reasons,
role/routing/availability revisions, branch/base/source commit, changed-file or diff digest,
commands with exit results, tests/evidence references, issues, timestamps, and next role.
Unknown model identity is explicitly unknown; never claim a specific model because it was
requested. Existing strict high-risk review-independence policy remains intact.

A review binds to the exact reviewed source commit (or explicitly identified uncommitted
diff digest). Approval of one commit does not approve a later commit or a conflict-resolved
merge. Dirty work is not represented as clean `HEAD` evidence. Record source commit and
publication commit separately to avoid a self-referential commit hash inside its own record.

Proposed lifecycle:

```text
running → execution-terminal → review/gate evaluated → finalize-prepared
        → immutable records durable → integrated/accepted → cleanup-eligible
```

`failed`, `blocked` and `rejected` are valid terminal records; persisting them is not a
successful task-completion claim. A record on an unmerged branch is provisional evidence,
not canonical accepted project state. Consolidation uses accepted records from the selected
integration revision plus an explicit control snapshot, not arbitrary branch-local files.

Proposed `finalize` must be bounded, idempotent and crash-recoverable: validate owner/revision,
freeze input digests, persist records, verify them by reading back, then update the control
receipt. A missing/different record or changed source revision prevents cleanup. Do not mark
finalized before the durable writes succeed. Recovery uses the journal/receipt to complete
or reject a partial attempt without recreating a different result under the same ID.

**A file written in a worktree is not yet safe against worktree removal.** Cleanup eligibility
requires records/evidence referenced by an accepted retained Git revision (or an explicitly
configured durable store); merely staged/untracked records are insufficient. Local ignored
logs must be promoted or have their missing evidence represented before that receipt.

Leerness can enforce finalize on its own adapter cleanup path, not intercept arbitrary
external `git worktree remove --force`, manual deletion or `git prune`. There is no promise
of an unbypassable Git removal hook. Worktree locks may reduce accidental pruning but are
not a substitute for finalization and user-authorized cleanup. Never delete a worktree or
its metadata as a side effect of inspect, handoff or migration.

## 6. Staged delivery and migration order

| Stage | Tracking | Deliverable / gate |
|---|---|---|
| Audit and design | T-0173 | Actual state map, reuse inventory, structural risks, compatibility order and preview; no runtime activation. |
| Scope foundation | M-0014 / T-0174 / P-0020 | Resolver and `state inspect` read-only CLI contract; current/proposed locations distinguished; no stores moved and no new execution adapter. |
| Private runtime | M-0015 / T-0175 | Explicit inventory/preview/confirm migration of session/runtime surfaces; per-session ownership; interrupted migration recovery. |
| Common control | M-0016 / T-0176 | Task identity, claims, owner generations, version/revision compatibility and bounded ControlStore transactions. |
| Durable records | M-0017 / T-0177 | Append-only memory import, run/review records and finalize durability receipts; old evidence retained. |
| Views and adapters | M-0018 / T-0178 | Accepted-input snapshot, single-writer summaries, integrity/claims/CLI/MCP/cleanup integration; legacy window closed only with evidence. |

M-0010's existing v2 validators stay usable and legacy runtime writes stay authoritative.
Finalize its storage/migration design against M-0014 before implementing another independent
path migration. Runtime activation must also satisfy M-0015 compatibility and M-0016 control
contracts. M-0011 dispatch, M-0012 live visualization and M-0013 UI consume the same State API.
Do not prematurely move the already documented role files into `config/`: filename aliases,
CLI/MCP compatibility and the migration manifest must be specified first.

Migration rules:

- Inventory all writers/readers and classify fields, not just filenames. Snapshot original
  bytes, inventory digest, source schema and Git tracking before asking to apply.
- Legacy memory import must distinguish missing JSON from corrupt/invalid JSON. Existing
  permissive loaders may fall back to stale Markdown; reuse parsers/renderers only behind a
  strict source selection/validation boundary. Invalid canonical data stops migration and
  preserves all original bytes, rather than silently promoting a Markdown fallback.
- Quiesce all participating writers; a new lock cannot stop an old CLI that does not know it.
  Detect active legacy clients and refuse activation; do not claim mixed-version safety
  from a new manifest alone. Old clients must be upgraded/stopped before the boundary moves.
- Stage copied data and validate digests, IDs, counters and provenance before activating one
  versioned manifest. Use single-authority writes; do not create two independent writable
  JSON/Markdown or legacy/v2 truths during a compatibility window.
- Preserve originals as explicitly labelled legacy archives. Never blanket-untrack or delete
  `.leerness`. Index/ignore changes and project instructions are part of an approved migration.
- Pre-activation rollback preserves bytes. Post-activation rollback must first reconcile
  newer events/records; copying an old backup over new writes is not rollback.
- Default handoff and inspect remain tracked-file-read-only. Explicit project memory,
  consolidation and finalization are the durable-write boundaries.

## 7. Acceptance matrix

- Main + two real linked worktrees: private paths differ, common paths match, sibling
  subprojects remain separate; branch switch/detached HEAD do not change runtime identity.
- Same worktree, two sessions: no current-run/evidence cross-talk; absent/invalid explicit
  session identity fails safely for concurrent mutation instead of silently borrowing ownership.
- Non-Git, Git missing, bare, broken gitfile, moved worktree, submodule, spaces, Unicode,
  Windows alias/case/junction, permission errors and inherited Git location overrides.
- Inspect/show: byte and mtime snapshots of project and Git metadata remain identical, no
  cache/usage/salt/lease/lock creation, no subprocess provider calls, bounded stdout/JSON errors.
- Multi-process claim/lease races, owner expiry/replacement, clock movement, duplicate IDs,
  truncated JSONL, corrupt/future schema, failed writes and interruption at every commit point.
- Independent records merge without shared counter edits; conflicting IDs/policy revisions
  fail closed; decision disagreement stays explicit; generated views reproduce from digests.
- Finalize replay, record durability failure, stale review commit, rejected review, failed
  tests, missing provenance, evidence outside retained Git and worktree-removal preflight.
- Legacy fixtures, handoff/MCP presence, file-lease and role-fallback probes plus installed
  cleanroom and supported Node/Windows/POSIX release tests before enabling new runtime writes.

## Inspection optimization and verification boundaries

Each valid inspection makes one Git topology query through the existing gateway. On Windows
the gateway also runs the trusted System32 executable locator; the normal console encoding
bootstrap is unchanged. Inspection skips unrelated `npm root -g` skillpack discovery and
does not call providers, register presence, take usage locks, or write caches.
Workspace discovery enumerates the two immediate workspace directories once. Inventory covers
known leaves in both existing locations (selected/unselected are explicit), with cached parent
metadata: it does not read state contents,
enumerate runtime descendants, query Git tracking, or certify record/schema integrity.
No long-lived path cache is used: moving a worktree or changing the target refreshes topology.

`npm run test:state-scopes` checks selector compatibility, real main/two linked worktrees,
project namespaces, moved/detached worktrees, actual submodule topology, aliases, Git failure
taxonomy, and CLI byte/mtime preservation with normal bookkeeping enabled. The scope probe
also passed on Node 18/Windows; POSIX execution remains a separate CI check, not implied by it.
Later concurrency/finalize/adapter acceptance bullets above do not apply to the implemented
inspection-only stage and are not reported complete by its tests.

## Not included in P-0020

No automatic migration, control database, task dispatch, paid provider calls, source lease
relocation, decision import, finalize command, worktree deletion or dashboard is implied by
the path-inspection preview. Existing review/release rules still apply to implementation.
Later stages require their own
implementation scope and verification; this design does not mark them complete.
