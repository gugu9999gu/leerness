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
