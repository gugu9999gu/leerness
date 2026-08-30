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
- Feature: The three highest-volume English-mode leakage surfaces render their human UI in English while preserving the Korean default and stable machine payloads.
- Input: `agents list`, `insights`, and `toggle list|get|set` in a fresh project with `--language en` or `LEERNESS_LANG=en`; the same toggle list with Korean selected as a control.
- Output: The default human output of `agents list`, `insights`, and `toggle list` contains zero Hangul. Agent installation/status labels, insight headings/units/recommendations, and toggle descriptions/guidance all follow the resolved project UI language. Korean mode retains Hangul and its established wording. Toggle JSON continues to expose the canonical `TOGGLE_REGISTRY` shape rather than locale-only projection fields.
- States: `uiLang` is resolved once at the CLI boundary and injected into modular handlers. A missing language selection remains Korean for backward compatibility. The 39-command aggregate English leakage ratchet decreases only by directly measured lines, from 104 to 58.
- Errors: Unknown toggle/subcommand/value and corrupt/unreadable toggle diagnostics use English wording in English mode. A command failure or silent output cannot count as a clean localization result, and the Korean control must remain distinguishable.
- Related files: `bin/leerness.js`, `lib/agents.js`, `lib/toggles.js`, `scripts/i18n-priority-surface-probe.js`, `scripts/e2e.js`, `package.json`.
- Test evidence ID: T-0092
