---
leernessRole: feature-contracts
readWhen:
  - 기능 구현/수정 전
updateWhen:
  - 기능 입출력/상태/오류 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Feature Contracts

## Template
- Feature:
- Input:
- Output:
- States:
- Errors:
- Related files:
- Test evidence ID:

## Parent-detect selftest — ambient-temp isolation and partial-setup cleanup
- Feature: The `parent detect (1.30.2 #157)` selftest measures only its own fixture and cleans every directory it successfully creates.
- Input: A normal OS temp directory, a temp directory whose ancestor contains an unrelated `.leerness/`, and an injected failure on the second `mkdtempSync` call.
- Output: The positive fixture finds its immediate `.leerness/` parent, the standalone control remains `null`, and the first setup directory is absent after a second-setup failure.
- States: Fixture setup variables begin as `null`; each successful allocation becomes cleanup-owned before the next allocation. The parent lookup is depth-bounded to the immediate fixture parent while the public helper keeps its normal default depth.
- Errors: Setup failures remain visible to the selftest runner and cannot leak a previously created directory. Ambient parent workspaces cannot turn the standalone control into a false failure.
- Related files: `bin/leerness.js`, `scripts/parent-detect-selftest-probe.js`, `package.json`.
- Test evidence ID: T-0091

## Honest read/status surfaces — version provenance, child routing, damaged previews
- Feature: Read-only/status commands preserve the provenance and failure state of what they inspected instead of collapsing it into a successful generic fallback.
- Input: `round-history [path]`, `release cadence [path]`, `memory <subcommand>`, and `preview list|show|serve` against valid, missing, malformed-JSON, and schema-invalid stores.
- Output: Round history and release-cadence JSON expose `cliVersion`, `harnessVersion`, `harnessVersionState`, `latestTagVersion`, and the backward-compatible `currentVersion` only with `currentVersionScope: "leerness_cli"`; `latestTags[].date` retains its established full ISO timestamp and an additive `dateOnly` exposes the calendar projection. Status and handoff version-skew use the same installed-base interpretation. Human round-history output labels every source, including a missing harness. Observation-only CLI routes (`about`, `identity`, `status`, `commands`, `install-safety`, `capabilities`, `round-history`, `milestones`, `pulse`, `release cadence`) resolve an existing legacy `.harness/` in place and do not write usage telemetry; `status` reports the selected `workspaceDir` and corresponding version/missing paths. Read-only MCP tools preserve both their explicit target and incidental server cwd; writable MCP calls remain attributable to the canonical target. Aggregate pulse/handoff/health/session-close callers preserve independently measured Git history and expose workspace or Git provenance failures as structured data. Successful recent-change aggregation keeps the established `recentChanges` array; `recentChangesState` and `recentChangesError` add provenance without breaking array consumers. Release cadence resolves one root with `--path > positional > cwd` for both validation and execution, and exposes `dataSufficient:false`/`level:"insufficient-data"` until at least two tags with a positive time span exist. Missing memory children return `subcommand_required`; invalid direct and nested children identify the actual line-safe bad token with `unknown_subcommand` and valid executable choices. Direct preview reads/serving distinguish `store_corrupt`, `store_invalid`, and `store_unreadable`.
- States: A missing preview store and a valid `[]` are successful empty states. Handoff/session-close retain their existing best-effort pending-preview summary so a damaged optional store does not prevent session recovery, while direct preview inspection fails closed. Git round tags and recent-change subjects use NUL-delimited full-ref records and count only exact `refs/tags/vX.Y.Z` names with real calendar/time values and ISO offsets within ±14:00. HARNESS_VERSION accepts only exact canonical or documented legacy formats; in `leerness@X+plus@Y`, X is the installed Leerness version. Existing `update --check`/`self check` offline `unknown` behavior and positional `plan init <path>` routing remain regression controls.
- Errors: Preview corruption never becomes `total:0` or `not_found`, all rejected paths preserve the original store bytes, and a non-canonical ID or canonical record with an absolute/traversing/link-escaping/missing `mockupPath` is rejected before any outside file is read, approved, or served. Nested preview fields, status enums, reserved output keys, contracts, and ID uniqueness are validated before writes. `preview add --mockup` accepts absolute in-root input only after normalizing it to a relative stored path, accepts legitimate `..name` files and inward input links, and rejects outward links before saving; generated/temporary/cleanup paths reject every linked ancestor, including a linked `.leerness/previews`, before write or recursive deletion. Outgoing records are revalidated immediately before the write. A Leerness CLI version is never presented as an unqualified project version. Split-brain `.harness/`+`.leerness/` workspaces and invalid workspace overrides fail nonzero with their exact `workspace_dir_*` code rather than becoming a successful `unreadable` state. A Git spawn exception, timeout, signal, or nonzero exit becomes `git_history_unavailable`; direct history consumers fail nonzero, while aggregates use `roundCount:null`, milestone derived counts/collections `null`, and `recentChanges:null` plus `recentChangesState:"unavailable"`/`recentChangesError` rather than fabricated R0/empty history. Each Git failure class is exercised independently through round-history, milestones, release cadence, pulse, health, handoff, and session close. Test Git fixtures use the same environment-scrubbing choke point, so inherited foreign repository/index/one-shot config variables cannot redirect fixture writes. Diagnostic values, malformed version markers, and stored preview text cannot inject extra terminal behavior through C0/C1, ESC, DEL, CR/LF, or Unicode U+2028/U+2029. Ref names containing delimiter lookalikes, suffixes, ambiguous short forms, or invalid dates never become counts, recent changes, cadence, or ETA evidence.
- Related files: `bin/leerness.js`, `lib/pure-utils.js`, `lib/clarify.js`, `lib/preview-serve.js`, `lib/mcp-tools.js`, `scripts/false-claim-probe.js`, `package.json`.
- Test evidence ID: T-0095

## `leerness which` — PATH candidate/install separation
- Feature: Report executable PATH artifacts without mistaking one Windows npm install's shim variants for separate installations.
- Input: The raw `where.exe leerness`/`which -a leerness` result plus adjacent npm package metadata and shim targets.
- Output: `pathCandidates` preserves the raw ordered strings; additive `pathInstallations` groups only proven same-package Windows npm shims. Conflict diagnostics use installation count.
- States: Windows extensionless/`.cmd`/`.ps1` variants merge only when canonical directory and resolved `package.json#bin.leerness` target match. Unproven, tampered, non-standard, cross-directory, and POSIX candidates remain separate.
- Errors: Metadata/read/parse/target verification failure is fail-conservative and leaves candidates ungrouped.
- Related files: `lib/diagnostics.js`, `lib/portable-process.js`, `scripts/which-shim-probe.js`, `scripts/release-runtime-probe.js`.
- Test evidence ID: T-0146

## Memory DELETE commands — `--json` single-document contract
- Feature: `task drop`, `decision drop`, `lesson drop`, `rule remove`, and `plan remove` preserve their existing mutation/archive behavior while supporting machine-readable output.
- Input: The existing task/rule ID or decision/lesson/milestone match target plus optional `--json`.
- Output: Human mode keeps the existing success message. JSON mode writes exactly one success object to stdout, writes no human success text to stderr, and identifies the affected surface and removal count/status. Enabled auto-roadmap refreshes remain active but silent in JSON mode.
- States: Mutation and archive/update side effects complete before the success document is emitted. `task drop` records dropped state; the other four surfaces remove active records while preserving their existing archive files.
- Errors: Missing targets, missing stores, and unmatched records use structured nonzero `failJson` responses when `--json` is present.
- Related files: `bin/leerness.js`, `scripts/e2e-core.js`.
- Test evidence ID: T-0093

## Command option behavior matrix — advertised flags are observable or rejected
- Feature: Keep ten historically suspect command-option surfaces aligned with their documented behavior instead of accepting inert flags.
- Input: `memory archive list`, `intent expand`, `auto-update status`, `release cleanup --keep`, `setup-agents --no-setup-agents`, `provider add`, `reuse-map --strict-elements`, `api-skill add --no-crawl`, `parent adopt --select`, and `toggle get` through real CLI processes.
- Output: `auto-update status` and `toggle get` are read-only JSON/human queries; setup opt-out returns an explicit skip; provider list exposes persisted `versionArgs` and emits no Korean UI text in English mode; API-skill JSON exposes whether crawl ran. `intent expand --expand-all|--select` fails with `unknown_flag` because expansion remains presentation-only and approved work is registered separately with `task add`.
- States: Missing auto-update settings are a healthy `installed:false` state; malformed settings (including parseable non-object containers, non-array SessionStart values, scalar hook entries, and mistyped known hook fields) fail nonzero without rewriting bytes. Exact SessionStart matcher/command pairs plus both `/update` directives are required for `installed:true`; inert `echo` lookalikes and empty files remain uninstalled and `install` repairs them. `init --no-setup-agents` preserves existing provider activation values and makes no provider choice in a fresh config. `--no-crawl` fetches the requested URL but makes no secondary request. Existing archive/release/reuse/parent behavior remains unchanged.
- Errors: Foreign intent flags and invalid negative cleanup retention fail closed; corrupt status input is `settings_corrupt`; unknown toggle IDs, including object-prototype names such as `toString`, remain errors.
- Related files: `bin/leerness.js`, `lib/toggles.js`, `scripts/dead-flags-probe.js`, `package.json`.
- Test evidence ID: T-0094

## English priority command surfaces — zero-Hangul human output
- Feature: Priority English-mode CLI surfaces render human UI without Hangul while preserving the Korean default and stable machine payloads.
- Input: `agents list`, `insights`, `toggle list|get|set`, `release cadence`, `idempotency audit`, `plan list`, `round-history`, `milestones`, `skill list`, and `mode get|set` in a fresh project through stored `language: en`, `LEERNESS_LANG=en`, or explicit `--language en`; the same commands with Korean selected as controls.
- Output: Each migrated human surface contains zero tool-authored Hangul, including decomposed and extended Hangul-script code points. `skill list` uses explicit English catalog metadata and falls back only to a Latin-script legacy field or a lossless ASCII projection of the stable skill ID instead of guessing a translation. That projection escapes spaces, pipes, backslashes, controls, and non-ASCII code points injectively, so literal escape/entity-like IDs remain distinct. English human table cells flatten controls and encode `|`, preventing forged rows; Korean valid string metadata bypasses that normalization and remains byte-compatible. `mode` localizes healthy reads, successful writes, corrupt-manifest provenance, missing-harness, invalid-value, unknown-subcommand, shared pre-dispatch human errors, and stale-version human branches without changing existing state-transition semantics. Skill/toggle/mode JSON retains the canonical locale-independent key shape, Korean metadata, and every representable raw falsy/null/object value rather than presentation-only English fields; stale notices never contaminate JSON stderr.
- States: UI language precedence remains explicit flag > environment > stored manifest > Korean compatibility default. `skill list --path <root>` and every `mode` layer (pre-dispatch errors, stale checks, and the handler) resolve the same `--path`-first then path-like-positional project root before reading locale or cache, independently of cwd. `LEERNESS_SKILLPACK_PATH` is an explicit pin and outranks ambient cwd/global packs. Korean-, Japanese-, compatibility-Jamo-, or decomposed-Hangul-only metadata falls back safely in English; finite non-negative numeric usage and string dates render normally, while malformed human counts/dates become `0`/`-` without crashing either locale. Missing/`undefined` JSON fields keep their canonical defaults and keys, while source-representable falsy/null/object fields remain raw. External skillpacks preserve explicit `displayNameEn` plus already-English legacy `displayName`/`name`. Mode error JSON, including errors raised by shared pre-dispatch flag/path guards, remains byte-identical across UI languages, while human manifest reason codes map to closed English labels and unknown future codes do not fall back to Korean prose. If the locked manifest reread becomes corrupt, mode set preserves it, regenerates no instruction documents, and returns `manifest_corrupt` instead of success. The 39-command leakage ratchet freezes both the measured total and each command's residual: 104 → 58 → 38 → 34 → 30 → 27.
- Errors: Unknown toggle/mode subcommands or values and corrupt/unreadable toggle/manifest diagnostics use English wording in English human mode, including an early flag error whose target is a stored-English `--path` project reached from a Korean cwd. Mode JSON errors preserve the established canonical message and stable error code across locales. Known user/environment path substrings are removed before Hangul measurement, while adjacent tool-authored prose remains measurable. A failed, silent, missing, duplicated, or per-command-drifted aggregate probe cannot count as clean; stored-English/stored-Korean/env/flag routes, conflicting cwd/positional/`--path` roots, positional stale-cache lookup, lock-time manifest corruption, explicit-vs-ambient skillpack precedence, Korean valid-byte controls, builtin/external/mode JSON equality and exact shape, mode mutation and fail-closed siblings, falsy/null/object metadata, injective ID collision cases, complete Unicode-script boundaries, and Markdown-row injection must all pass before lowering the ratchet.
- Related files: `bin/leerness.js`, `lib/agents.js`, `lib/toggles.js`, `lib/catalogs.js`, `scripts/i18n-priority-surface-probe.js`, `scripts/i18n-next-cluster-probe.js`, `scripts/e2e.js`, `package.json`.
- Test evidence ID: T-0092

## Provider capacity observation — no speculative quota claims
- Feature: `agents quota` separates local CLI facts and append-only availability observations from provider-verified capacity.
- Input: Built-in and project provider definitions, enablement environment flags, registered safe authentication probes, and active `agents availability` observations.
- Output: Versioned JSON reports installation, enablement, authentication, local routing eligibility, model callability, observed quota state, and `verifiedRemainingAmount:null` as separate fields; human output states the same observation boundary.
- States: Disabled providers receive presence-only checks and no command execution. Authentication may support local routing but never proves model entitlement or remaining credits. Recorded availability is routing evidence, not an official provider balance.
- Errors: Credential values, account identifiers, raw authentication evidence, browser sessions, GUI state, and inferred token/credit amounts must not be emitted or persisted. Partial or corrupt availability history fails closed.
- Related files: `lib/agents.js`, `scripts/provider-capacity-probe.js`, `scripts/e2e.js`.
- Test evidence ID: T-0165

## Exact-file session lease — explicit advisory coordination
- Feature: `lease acquire|release|list|check` and the paired MCP tools coordinate one exact canonical file with a short TTL without claiming an OS-enforced lock.
- Input: Project root, exact file path, explicit session key, bounded TTL, optional note, or a lease ID for release.
- Output: Acquire/release writes a versioned ignored lease store; list/check are byte-for-byte read-only and expose ownership/conflict evidence.
- States: Lexical aliases and proven file-identity aliases converge; unrelated sibling paths and different project roots remain independent. Expired rows stop blocking and are pruned only during a successful mutation.
- Errors: Traversal, outward links, alternate data streams, hard-link convergence conflicts, invalid identities/TTL/arity, corrupt or oversized stores, and lock failures fail closed without changing the original bytes. Ambient handoff/status surfaces do not invent lease warnings.
- Related files: `lib/file-leases.js`, `bin/leerness.js`, `lib/mcp-tools.js`, `scripts/file-lease-probe.js`.
- Test evidence ID: T-0166

## Role / Agent / Routing schema v2 — lossless compatibility foundation
- Feature: Pure validators and projections define separate Role, Agent, and Routing Policy documents while preserving the legacy assignment store.
- Input: Legacy `.leerness/agent-roles.json` or the three canonical v2 documents: `role-definitions.json`, `agent-instances.json`, and `routing-policy.json`.
- Output: Deterministic legacy-to-v2 projection, strict per-document and bundle validation, and a lossless reverse projection that retains legacy role keys plus unknown top-level/per-role fields.
- States: `agent-roles.json` remains schema v1 compatibility input/output. V2 schema files remain preview-only and are not automatically written, migrated, or activated at runtime. Null budgets remain unknown; multiple Agent instances may share a Role/provider/model while keeping distinct IDs.
- Errors: Corrupt/future schema, alias collision, provider/model coupling inside Role definitions, missing or cross-role fallback targets, fallback/inheritance cycles, disabled-primary reverse projection, and weakened pipeline safety requirements fail closed.
- Related files: `lib/role-agent-schema.js`, `docs/role-agent-routing-v2.md`, `scripts/role-agent-schema-probe.js`.
- Test evidence ID: T-0167

## Legacy role-store validation — fail closed and preserve bytes
- Feature: Every legacy role read, write, route, and role-bound dispatch uses one bounded loader, with `roles validate` as a read-only diagnostic/projection preview.
- Input: Missing, valid, empty, BOM-only, invalid UTF-8, corrupt JSON, unsupported schema, malformed role shape, oversized, linked, or non-regular `.leerness/agent-roles.json`.
- Output: Missing is an explicit empty configuration; valid stores expose a content revision and read-only v2 projection counts; valid `list|set|unset|dispatch` behavior and unknown extension fields remain compatible.
- States: Reads never rewrite the store. Writes preserve unknown fields and continue emitting legacy schema version 1, including compatible `primary`, `candidates`, `fallbackPolicy`, and `requirements` extensions.
- Errors: Invalid stores return stable `store_corrupt|store_invalid|store_unreadable` diagnostics, preserve exact source bytes, and stop provider execution and rescue overwrites.
- Related files: `lib/role-store.js`, `bin/leerness.js`, `lib/agents.js`, `lib/routing.js`, `scripts/role-store-loader-probe.js`.
- Test evidence ID: T-0171

## Role fallback and execution provenance v1 — revision-bound decisions
- Feature: `agents resolve|fallback|dispatch|record|history|availability` exposes explicit role-preserving choices and append-only provenance without silently invoking a model.
- Input: A valid legacy role assignment with ordered candidates, strict/balanced/continuity policy, observed provider/model availability, task risk signals, explicit selection, and any required visible approval/reason.
- Output: Resolution includes a unique resolution ID plus role-store and semantic availability revisions. A selected fallback or prepared role dispatch is committed only while both revisions still match. Ledger events expose task/attempt links, requested role/executor, actual executor, evidence, substitution, and review independence.
- States: For each availability axis, the newest applicable provider-wide or exact-model observation wins. A newer provider-wide denial defeats an older exact-model allow. High-risk reviewer independence is proven only when both providers are explicit and distinct and recognizable concrete model IDs belong to different families; opaque declared family labels remain unverified. A review event derives the implementer identity from exactly one prior implementation terminal event for the same task rather than trusting caller-supplied identity. Role-bound `multi --execute` and `bench` are rejected because provider-default fan-out cannot prove the selected model contract.
- Errors: Invalid or duplicate presets/roles, corrupt/partial or semantically invalid availability ledgers, stale role or availability snapshots, invisible approval identities, unapproved high-risk substitution, unapproved high-risk tier downgrade, unavailable/ambiguous choices, incomplete or non-canonical terminal provenance, missing/mismatched review targets, duplicate terminal attempts, and unproven reviewer independence fail closed. Credential-bearing keys are redacted even when suffixed with `Input`, `Output`, or `Prompt`; only narrowly named token-count metrics remain visible.
- Related files: `lib/role-fallback.js`, `lib/role-catalog.js`, `lib/agents.js`, `lib/routing.js`, `bin/leerness.js`, `lib/mcp-tools.js`, `scripts/role-fallback-probe.js`.
- Test evidence ID: T-0172

## State scope inspection v1 — P-0020 approved, UR-0098 optimization
- Feature: `state inspect [path] [--path path] [--json]` and `resolveStatePaths` expose the five proposed scopes without activating them. Explicit `--path` takes precedence; invalid/duplicate flags, blank paths and extra positionals fail before discovery or writes.
- Input: An existing project directory, its existing workspace classifier snapshot, and one bounded `git rev-parse` call through `lib/git.js`. Git location overrides are sanitized by the existing gateway. Genuine non-Git directories are distinct from unavailable/broken/unsupported Git and bare repositories.
- Output: Versioned JSON includes canonical project identity, Git topology, current workspace, five named scopes, proposed paths, warnings, and a fixed-list metadata-only legacy inventory. Project key is SHA-256 of the canonical repository-relative path. Main and linked worktrees share common control per project, never private runtime. Sibling projects have different keys. No branch name forms an identity.
- States: `runtimeActivated: false`, `migrationAvailable: false`, `activeLayout: legacy`. All existing readers/writers and data remain in place. Non-Git fallback has no common control guarantee. Mixed progress/queue/memory surfaces require field-aware migration, not blind file moves. Paths are proposals, not write authorization.
- Errors: Stable path/Git/workspace errors; no raw Git stderr or file contents in output. Workspace conflicts/links are refused. Nested inventory links are reported without traversal. Metadata errors do not mean absent. Inspection is not a migration-integrity or schema-validation claim.
- Optimization: Reuse one workspace snapshot via a pure selector; one Git subprocess per inspection; fixed leaf metadata with per-call parent caching; no recursive scans or runtime file reads. Early dispatch bypasses automatic migration, usage, presence and stale-check bookkeeping without changing other state commands.
- Verification: Real main/two linked worktrees, subprojects, detached branch, submodule/separate Git directory, spaces/Unicode/aliases; fallback/error paths; byte+mtime snapshots of target/cwd/Git under normal execution; bounded I/O counts; legacy selector equivalence; CLI/catalog compatibility.
- Related files: `lib/state-git.js`, `lib/state-paths.js`, `lib/state-inventory.js`, `lib/state-inspect.js`, `lib/workspace-dir.js`, `bin/leerness.js`, `docs/state-scopes.md`.
- Test evidence ID: T-0174 (in progress; no runtime migration, common store, finalize, MCP or provider execution in this stage).
