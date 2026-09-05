# Worktree runtime migration: compatibility before relocation

Status: **P-0021 approved; T-0180 compatibility implementation under verification** (2026-09-06).
T-0179 records the original source audit. T-0175 / M-0015 remain incomplete.
Only A is authorized: diagnosis and observed-layout rejection. Storage relocation,
descriptor creation, activation, common control, finalize and cleanup are not implemented.

Source baseline: v1.36.186, commit `1805da9d2611a852be6a1b8636efa2977dd081f1`
(product source identical to release tag v1.36.186). Source references below use function
names so that line-number drift does not silently change the claimed boundary.
The [five-scope design](state-scopes.md) and [implemented inspection API](state-paths-api.md)
remain authoritative for the existing resolver. B/C below remain unimplemented proposals.
The [compatibility API](runtime-compatibility-api.md) describes the implemented A boundary.

## 1. Why a compatibility release comes first

`lib/state-paths.js:resolveStatePaths` currently returns `activeLayout: legacy`,
`runtimeActivated: false`, `migrationAvailable: false` as constants. Existing writers
continue to use `.leerness`. A new manifest is invisible to v1.36.186 and older clients;
removing `state.json` lets `_loadLeernessState` create a new legacy state instead of stopping them.

`bin/leerness.js:main` performs automatic workspace migration and usage recording before
ordinary handlers. `_recordRun` writes with `fs.appendFileSync`; execution-ledger code
also writes through file descriptors. Guarding only a handler or `writeUtf8` misses writes.
`_handoffVersionSkew` warns about older CLIs; it is not a write barrier. Installed Git
hooks read legacy freshness paths directly. These are source-audit findings, not executed
mixed-version or interruption tests.

The release sequence is therefore:

1. **A — compatibility only (P-0021 / T-0180):** strict layout reader, read-only diagnosis
   and observed-layout write rejection. Legacy storage stays authoritative; no activation API.
2. **B — explicit migration (separate preview/approval):** prove participating clients are
   upgraded and stopped, specify a writer-admission protocol, snapshot/copy/validate, then
   activate one worktree and a named migration unit. Unknown participants mean defer activation.
3. **C — later units and integration:** migrate other coupled stores; connect M-0016 control,
   M-0017 immutable records and M-0018 views. No claim that A completes these milestones.

A does not retroactively fence old or already-admitted writers. Even a check immediately
before a write has a check/write race; activation must not run concurrently with A-only
clients. Presence counts, elapsed time, PID probes and an empty lock directory do not prove
quiescence. The operator's maintenance declaration is a prerequisite, not an unbypassable
technical guarantee. Unmanaged clients, other clones and other hosts remain outside it.

## 2. Source-backed inventory and ownership

Paths in this table use the current canonical `.leerness/` spelling. Many writers hardcode
that directory; the configurable workspace selector does not redirect all of them. The 22
known surface names match `lib/state-inventory.js:SURFACES`; its current classification tags
are not field-level migration authority. This is **not a complete inventory of every cache or
mutating command**. The reader/writer examples identify coupling, not an exhaustive call graph.
Before B, each migration unit needs a closed writer/reader registry and tests for all entries.

| Surface(s) | Current readers / writers | Field ownership and disposition |
|---|---|---|
| `cache/sessions/` | CLI `_sessionPresenceRecord`, `_readSessionEntries`, `_sessionSignal`, `sessionsCmd`; handoff, session close, hook session-start; `lib/session-presence.js` identity helpers | Per-session observations plus `.host-salt`. Preserve original address, source, timestamps and close tombstones. Not a live-agent registry. Smallest candidate unit: this entire directory and its consumers. |
| `cache/handoffs/` | `_recordHandoffFreshness`, `_latestHandoffFreshness`, `_getLastHandoffGap`; `enforceCmd` generated pre-commit and self-probe | Per-session freshness plus the reserved `unaddressed` marker. The hook uses filesystem mtime; copying must not manufacture a recent handoff. CLI and installed hooks must switch together. |
| `cache/agent-sessions/` | REPL `sessionPath` / `saveSession` | Raw conversation history, currently timestamp-addressed. Private; never automatically promote messages, prompts or history to tracked records. Owner mapping needs an explicit contract. |
| `cache/agent-runs/` | `_runsDir`, `_recordRun`, run-history consumers | Mixed/private intent and observations: one-shot records include raw user `task` text (up to 200 characters), provider/model, error and timing. Preserve task text and original IDs privately; not immutable reviewed completion evidence or cleanup-eligible disposable cache. |
| `cache/file-leases.json` | `lib/file-leases.js`, CLI `fileLeaseCmd` | Session owner, physical target identity, lease ID and expiry for this worktree. Keep distinct from repository task claims; do not move live leases into common control or silently renew TTL. |
| `state.json`, `runs/`, `handoff/` | `_loadLeernessState`, `_saveLeernessState`, `_loadRun`, `_saveRun`, `_updateRun`, `stateCmd` start/record/verify/handoff branches; MCP child calls | Coupled counter/current-run/session-owner map, per-run evidence and handoff artifact. Move only as one validated unit. Completed runs remain mutable today; M-0017 promotion is separate. |
| `execution-ledger.jsonl` | `lib/role-fallback.js`, agent history/record consumers | Mixed runtime provenance and potential durable-result inputs. Bind actual provider/model/fallback and reviewed revision when promoting later; the existing ignored ledger is not a finalize receipt. |
| `decisions.json`, `decisions.md` | `_loadDecisions`, `_saveDecisions` | Valid JSON array is the current authority; Markdown is a view/fallback. Strict import must reject invalid/non-array JSON rather than trust that fallback. Defer immutable import to M-0017. |
| `lessons.json`, `lessons.md` | `_loadLessons`, `_saveLessons` | Same strict-source boundary; validated lessons become separate immutable records only in M-0017. Preserve original Markdown text. |
| `progress-tracker.md` | Task parser/writers; `lib/session-close.js` | Task IDs, request, evidence, status and next action include project authority/user intent. Not disposable runtime. Keep unchanged until M-0018 has an accepted-input model. |
| `current-state.md` | Handoff readers; `lib/session-close.js:_upsertAutoLines` | User-written context plus generated auto lines. Preserve non-auto text; do not call the whole file a generated view. |
| `session-handoff.md` | Handoff readers; `lib/session-close.js` | Project instructions/context plus generated task summaries and session material. Split by ownership with original-byte retention, not by filename alone. |
| `active-wakeups.json` | `_loadActiveWakeups`, `_writeActiveWakeups`, `_recordWakeup`, `_analyzeWakeupStatus` | Requested schedule/source and runtime registration/status timestamps are mixed. Preserve scheduling intent; no scheduler changes or automatic execution in this migration. |
| `auto-resume-plan.json` | `_loadAutoResumePlan`, `_buildAutoResumePlan`, `_writeAutoResumePlan`, `resumeCmd` | `focus`, next-action titles/commands and note carry intent; `savedAt`, expected-fire data and context snapshot describe execution. Current task selection is not session ownership. Defer splitting. |
| `next-action-queue.json` | `_loadNextActionQueue`, `_writeNextActionQueue`, `_compactNextActionQueue` | Proposed titles/commands and IDs may encode intent. Preserve order, provenance and raw input; migration must not execute, silently deduplicate or rewrite these commands. |
| `pre-wake-report.json` | `_runPreWakeAudit`, pre-wake reporting, session-close integration | Mixed user-request copy and observations: `findings.critical[].items[].text` retains request text (up to 80 characters) beside IDs/counts/timestamps. Preserve the copy and its canonical request link; not proof of scheduled execution, liveness or safe disposal. |
| `last-handoff.json` | `_lastHandoffPath`, `_getLastHandoffGap`, legacy hook fallback | Legacy compatibility stamp, not a per-session ownership authority. Do not borrow another session's freshness. Include fallback retirement in the freshness unit. |
| `routing-log.json` | `lib/routing.js:routeCmd`, `_loadLog`, `_appendLog`, `_showLog`; dashboard reader | Mixed user intent and approval provenance: redacted original `task`, `declaredTier`, `riskDowngrade`, `requested` and `approvedBy` alongside assignments/observations. Bounded mutable list (200 records), not immutable approval evidence. Preserve fields and invalid-store rejection; no automatic cleanup or public promotion. |

Additional mutation paths outside the 22-surface metadata inventory include usage/update
caches, installation/migration metadata, hook installation, locks and session-close generated
artifacts. A's write-guard coverage must include these before any compatibility claim. Merely
adding 22 path checks is insufficient. Existing `check`/`audit`/`health` use
`lib/state-integrity.js:findCorruptedStateJson`, which only parses immediate workspace JSON,
skips some unreadable/empty cases and does not validate nested runtime layouts or schemas.

### Identity and minimum migration units

- Reuse `deriveSessionKey` and `normalizePresenceEnv`; keep case folding, explicit MCP
  addresses and reserved-key rules. Do not derive ownership from PID, model, branch or newest run.
- Presence without a valid address remains unregistered. Existing anonymous structured-state
  behavior is compatibility data, not permission to attribute it to the currently calling agent.
  Import unknown ownership as unresolved; concurrent mutation needs an explicitly accepted owner.
- Preserve presence `.host-salt` privately with the directory; no public salt or identity export.
  Preserve ambiguous case variants and invalid close records; do not prune during migration.
- Unit B1 candidate is presence alone. It still requires A and the B admission/maintenance
  contract; it cannot be sold as full session/runtime isolation. Freshness with installed hooks
  is B2; `state.json + runs + handoff` is B3. Unit selection is part of B's separate approval.
- A completed run's status does not make its bytes immutable. Existing verify-claim and
  handoff evidence must keep resolving throughout B3. Do not reassign run counters or owner maps.
- `_leernessStateDir` also serves project `policy.json` via `_policyFile` / `_savePolicy`.
  Replacing that helper wholesale would relocate policy with runtime; split the callers first.
- `state verify` records a supplied result; it does not execute tests. `session close` updates
  tracked summaries and presence, but does not call `state handoff` or finalize immutable runs.
  `runs list/show` instead reads `cache/agent-runs`, not the structured `runs/` directory.
- MCP `callLeerness` supplies a validated per-call session address when present; otherwise
  inherited environment identity or anonymous state can still be shared. A stdio connection
  ID is not a replacement ownership key. Invalid explicit CLI addresses may fall back to an
  ambient address today; do not silently carry that behavior into a strict migration owner map.
- Agent-run task text, pre-wake request copies and routing approval provenance require a
  retained private copy outside any checkout/private Git directory scheduled for removal, or
  separately approved durable promotion that preserves their meaning and privacy. An existing
  request/task link must be verified, not assumed to contain the whole original. Unresolved
  retention blocks cleanup; M-0017 must not auto-publish raw task/approver/conversation data.
  The old inspector's `runtime` tags do not authorize movement, deletion or lossy partitioning.

## 3. Approved compatibility slice (P-0021)

### Descriptor location and conservative decoding

Git compatibility descriptor: `<GIT_DIR>/leerness/layout.json`. This is a fixed,
worktree-wide admission location, deliberately **not keyed by projectKey**. An incompatible
descriptor conservatively blocks A's Leerness metadata writes for every subproject in that
worktree; it does not select a project's runtime. The runtime payload paths stay under
`<GIT_DIR>/leerness/projects/<projectKey>/runtime/` as proposed by the existing resolver.

`projectKey` is a path-derived namespace, not a persistent logical project identity. A branch
that renames a monorepo folder gets a new key but consults the same compatibility descriptor.
The descriptor is private metadata, not tracked knowledge or `.leerness/manifest.json`.
B still needs stable project binding or an explicitly approved relocation registry before
activating movable subprojects; unresolved moves must not create a new legacy authority.
Main-worktree Git directories can equal the common Git directory; the private `layout.json`
and `projects/…` remain distinct from `control/…`. Git documents linked worktrees' private
and common metadata separately. [Git worktree details](https://git-scm.com/docs/git-worktree#_details)

For genuinely non-Git projects the descriptor is the selection-independent
`<projectRoot>/.leerness/cache/state-layout.json`, the canonical sibling of the resolver's
`<projectRoot>/.leerness/cache/state-runtime/`. Do not root it in the selected `.harness`.
Changing `LEERNESS_WORKSPACE_DIR` must not choose another guard for the same writer target.
An alternate `.harness/cache/state-layout.json` or `.harness/cache/state-runtime` is an
ambiguous layout and blocks writes, even if a canonical descriptor also exists. No dual
authority or preference-based fallback. Workspace migration checks this before copying;
it must preserve or refuse, not relocate the descriptor as an ordinary cache file.
There is no common coordination store for non-Git. Introducing Git must also inspect the
canonical non-Git descriptor/runtime indicators and refuse an unresolved backend transition.
Git errors, inaccessible parents and damaged gitfiles must not choose a non-Git backend.
Ordinary non-Git use without a Git executable must remain supported: extract/reuse the
existing bounded repository-marker discovery semantics rather than catching all Git errors
as non-Git. Git-backed writes fail closed if their layout cannot be resolved. This discovery
change requires its own baseline regression tests and must not alter `state inspect` silently.
Caller workspace/Git-discovery overrides must not select a different admission authority for
identical canonical write targets. Unknown or conflicting topology/ownership blocks writes;
do not read foreign workspace content or fall back around a workspace conflict.

Descriptor fields: `schema: leerness.runtime-layout/v1`, `schemaVersion: 1`,
`scope: worktree` (Git) or `project-local` (non-Git), positive safe-integer `generation`, `layout: legacy`, and
`requiredWriterProtocol: 1`. A supports only the legacy layout/protocol combination.
Generation is provenance, **not an implemented fencing token**. A does not create descriptors;
it accepts externally supplied fixtures during tests and diagnoses future transition states.
No preview/apply/activate/rollback command is delivered in A.

| Observed descriptor/runtime state | A behavior |
|---|---|
| Descriptor absent and no new/alternate layout indicators | Legacy backend, no files created by diagnosis. |
| Strictly valid supported legacy descriptor; no new/alternate layout indicators | Keep legacy writes and location. Revalidate at mutation admission. |
| Git `leerness/projects/` exists (even empty), but fixed descriptor is absent or legacy | Ambiguous new/old-key layout: block the whole worktree without a recursive scan. A new projectKey must not bypass this check. |
| Non-Git proposed runtime, alternate descriptor/runtime or unresolved backend transition exists | Block writes; never pick whichever descriptor agrees with the current selection. |
| Invalid, empty, truncated, oversized, unreadable, linked or scope-mismatched descriptor | Structured bounded error; preserve bytes, no repair/fallback. |
| Future schema/protocol/layout | Incompatible: block writes before side effects; diagnostic reports the incompatibility. |

Reject unsafe descriptor parent links, use bounded regular-file reads (maximum
16 KiB), validate exact fields/types, and return reason codes rather than raw descriptor text.
Do not copy secrets, arbitrary paths or supplied commands into errors. A deleted descriptor
and deleted runtime cannot be recovered by inference; arbitrary external deletion is not fenced.

### Entry points and honest limits

Read-only CLI: `leerness state compatibility [path] --json`.
It reports compatibility separately from the existing metadata-only `state inspect` contract.
Diagnostic fields should include schema, observed layout, supported protocol, reason code,
write disposition and `activationSupported: false`; no mutation/counter/cache/salt/lock writes.
Missing data is not presented as a completed migration. No raw conversation is returned.

Use one domain-specific reader/guard (`lib/runtime-layout.js`), not a speculative
all-purpose StateManager. CLI and MCP execution must share it. Admission checks go before
auto workspace migration, usage, stale-update caching, lock creation and hook installation,
as well as at actual module/REPL/FD/log writer boundaries. Resolve the actual target project,
not the unrelated current directory. Global-only commands must not mutate or block that cwd.
Do not let existing `catch {}` best-effort logging turn an incompatible-layout rejection into
success. Recheck after waiting for a data lock and at each later mutation of a long-lived process.

This is **observed-layout rejection**, not atomic check/write fencing. A in-flight operation
can pass its check before an external descriptor changes. B must specify writer admission
and stop/drain all older participating clients before activation; it cannot infer safety from
A being installed somewhere. Initialization/update/downgrade/hook refresh must preserve or
refuse an incompatible descriptor, never reset it to legacy. A does not promise to modify
an already-installed old executable, external editor, Git hook or arbitrary worktree removal.

### Reuse and optimization constraints

- Reuse `lib/git.js` and the canonical project/worktree resolver. Do not shell-parse gitfiles
  or add an independent Git subprocess wrapper. Scope/path discovery can share one immutable
  invocation snapshot, but mutable compatibility decisions cannot be cached across writes,
  lock waits, MCP requests or REPL turns.
- `writeUtf8` skips identical bytes and uses temp/rename. It is not create-only publication,
  portable revision CAS, a multi-file transaction or a proven power-loss durability protocol.
- `writeBufferIfUnchanged` is Windows-only metadata-preserving replacement; POSIX currently
  throws `E_METADATA_PRESERVATION_UNAVAILABLE`. Do not reuse it as a portable ControlStore CAS.
- `_withLock` serializes cooperating writers to one canonical target. Keep the existing
  no-automatic-takeover policy for owner-bearing locks. It does not freeze another path or client.
- Existing `.harness` migration's inventory/hash/recheck/stage patterns are references only;
  its lock is not taken by all writers, and its backup restore is not post-activation rollback.
- Node >=18, zero runtime dependencies, no network/provider call from diagnosis or admission.
  Measure real-entry-point filesystem/Git calls and byte/mtime invariance before claiming an
  optimization. Do not trade a fresh safety check for a faster stale cache.

## 4. Future B activation and recovery gates (not P-0021 implementation)

1. Enumerate the chosen unit's writers/readers, client versions, installed hooks, tracked
   files and owners. Stop/upgrade participants and require an explicit maintenance declaration;
   unknown old clients or unverifiable scope block activation. Recheck actual versions at use.
   Establish the fixed compatibility boundary before any project-keyed staging/publication;
   establish stable project bindings or refuse project moves. A metadata path hash is not a
   logical identity. Do not activate B solely because A's observed-layout checks passed.
2. Read strict original bytes/schema, source file identity, timestamps, permissions and Git
   tracking. Record a digest-bound preview and unresolved owners. Preserve invalid data;
   do not use permissive loaders, repair, prune or merge-by-text as an import shortcut.
3. Stage copies in an exclusive private transaction directory; validate counts, IDs, counters,
   ownership, provenance, content digests and required metadata. Source changes after preview
   invalidate it. ACL/ADS/hard-link or cross-filesystem preservation unsupported by a backend
   must cause refusal, not an unnoticed metadata loss. No runtime content enters a tracked archive.
4. Under the future admission protocol, revalidate inputs and switch one versioned authority
   descriptor. No dual writable legacy/new truth. Crash injection is required before/after each
   publication point; uncertain commit means recovery-required, not automatic success.
5. Before activation, rollback discards only owned staging after identity validation and leaves
   originals untouched. After activation/new writes, first quiesce and reconcile newer events;
   never copy an old backup over them. Preserve an explicit recovery receipt and artifacts.
6. Separately preview any Git index/ignore change and retain original files. Preserve user text
   in mixed documents; no blanket untrack/delete or merge=union. Worktree removal remains gated
   on M-0017 durable finalization and M-0018 adapter support, not merely a successful copy.

Filesystem rename alone is not evidence of durable multi-file commit. Node's fsync API
documents OS/device-dependent flush behavior; a future backend must state and test its actual
durability support instead of promising recovery from every power failure.
[Node 18 fsync documentation](https://nodejs.org/docs/latest-v18.x/api/fs.html#fsfsyncsyncfd)

## 5. Acceptance and delivery evidence

P-0021 approval authorizes A only. Implementation acceptance must include:

- A legacy control with no descriptor has unchanged command output/bytes apart from its
  already documented writes. Main/two linked worktrees, sibling monorepo projects, detached
  HEAD, aliases and non-Git remain distinct as specified by the resolver.
- Missing, valid legacy, malformed, empty, oversized, permission-denied, symlink/junction,
  unknown protocol and deleted-descriptor-with-runtime cases give deterministic dispositions.
- A cross-branch monorepo subproject rename keeps the fixed worktree guard; old-key runtime
  with a missing descriptor blocks even under a new key. Different genuine worktrees stay
  isolated. The coarse whole-worktree block is explicit in diagnostics, not labelled per-project.
- Non-Git `.harness`/`.leerness` forced-selection variants consult the same canonical guard;
  alternate descriptors/dual runtimes, foreign paths, Git discovery overrides and introducing
  Git cannot reopen legacy writes against an incompatible or unresolved target.
- Fixtures with agent-run task text, pre-wake copied request text and routing approver/risk
  provenance remain private and byte-preserved. A retains the current inspector tags as
  metadata-only hints; future migration needs strict field classification and retention proof.
- A pre-existing incompatible descriptor produces zero writes through actual CLI startup,
  MCP calls, REPL, direct module invocation, FD append, usage/update cache, locks, init/update
  and hook-install paths. Unsupported writer paths block the compatibility release, not only B.
- Descriptor changes while a command waits on a lock are re-read. A changes-after-final-check
  race is documented and not passed off as fencing. No activation under A-only writers.
- Old v1.36.186 and an already-running legacy writer are negative controls: the tests must
  demonstrate they do not honor the new guard. This is a known limit, not a suppressed failure.
- `state inspect` retains metadata-only/no-content/no-write behavior. The new diagnostic is
  independently tested for bounded content, errors, no outputs of secrets and byte/mtime stability.
- Existing presence, handoff, structured-state, MCP, lease and fallback probes; installed
  cleanroom; supported Node and Windows/POSIX CI; independent Codex review; then public release
  verification. No test count or release claim from v1.36.186 is reused as evidence for A.

The original T-0179 planning round ran document/reference checks and source review only.
The approved T-0180 round adds implementation and regression evidence, including real old
v1.36.186 CLI and already-loaded writer negative controls. Those clients ignore the descriptor;
this is an observed limit, not evidence that activation is safe. Final cross-platform/full
release validation is tracked separately in review-evidence.md; it is not implied by this design.
The broader UR-0097 and migration B/C remain open.
