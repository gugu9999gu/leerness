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
