---
leernessRole: review-evidence
readWhen:
  - 진행 보고
  - 릴리즈 검토
updateWhen:
  - 검증 결과 기록
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Review Evidence

Verification command/result history. Append-only.

## 2026-07-14 — T-0019/T-0020/T-0021 `_maskComments` review

- `node --check lib/pure-utils.js` — PASS
- `node --check bin/leerness.js` — PASS
- `node bin/leerness.js selftest --json` — PASS 289/289
- Direct helper probes plus `contract verify --json` scratch probes — reproduced valid-JavaScript false-blank, missed-comment, incomplete line-grammar, and pathological stack-overflow cases; ordinary controls passed.
- Independent read-only audit converged; `lib/pure-utils.js` and `bin/leerness.js` mtimes unchanged.

## 2026-08-24 — T-0122 release bump version-surface regression

- `node --check bin/leerness.js && node --check scripts/release-bump-probe.js && node --check scripts/e2e.js` — PASS
- `node scripts/release-bump-probe.js` — PASS; `--patch` warning 없음, 자체 패키지의 package/bin/README 버전 동기화 및 일반 패키지 package.json-only 계약 대조 완료.
- `npm run lint` — PASS (40 JavaScript files, 1 JSON file).
- `node scripts/e2e-core.js` — PASS (42/42).

## 2026-08-24 — T-0125 / T-0117 dry-run session-cache regression

- Registered reproduction probe: before the fix, two consecutive runs found `dry-run-session-cache-write` (exit 1); after the fix it exits 0.
- Real-session snapshot (`LEERNESS_SESSION_ID=dryguard001`): `session close --dry-run` exits 1 as a refused write, changes 0 files, and does not create `.leerness/cache/sessions`.
- `node --check lib/io.js` and `node --check scripts/e2e.js` — PASS.
- `npm run lint` — PASS (40 JavaScript files, 1 JSON file).
- `node scripts/e2e-core.js` — PASS (42/42).
- `node scripts/e2e.js` — T-0117 AH, cache guard AJ, and current-state lock L passed; suite result 456/466. The suite was started before the test-helper environment forwarding correction, so the post-correction real-session snapshot above is the evidence for that exact condition. The remaining 10 suite failures are independent pre-existing selftest/MCP/enforce/session-presence/temporary-directory cases.
- Manual Codex cross-review: removed only the persistent cache exemption from the central dry-run guard; retained lock/temp exemptions; found and fixed the E2E helper that had ignored its explicit environment argument.

## 2026-08-23 15:33
Task: T-0122
Command: npm test
Exit: 1
Note: lint와 버전 검사는 통과했으나, 기존 전역 selftest 2/349 실패에서 중단됨. T-0122 격리 프로브와 코어 회귀는 별도 통과.
Artifacts: 없음
- `npm pack --dry-run` — PASS; `leerness@1.36.153` package에 새 회귀 프로브 포함.
- `node bin/leerness.js verify-claim T-0122 --path . --json` 및 `node bin/leerness.js check .` — PASS.
- Manual Codex cross-review — Windows 경로 대소문자/junction 자체 패키지 판별 경계를 발견해 정규화하고, 소문자 드라이브 인자 프로브로 재확인.
- `node scripts/smoke.js` — BLOCKED (12/13): 이번 변경과 무관한 전역 selftest 실패가 선행되어 후속 검증은 통과.

## 2026-08-23 — T-0122 validation (UTC)

- `npm run lint` — PASS.
- `node scripts/release-bump-probe.js` — PASS; 자체 패키지 버전 표면 동기화와 일반 패키지 격리를 확인.
- `node scripts/e2e-core.js` — PASS (42/42).

## 2026-08-24 — T-0126 project brief grounding

- Project-brief structure assertion — PASS: Project, Purpose, Users, Success Criteria, Boundaries 5개 섹션 존재; 초기 자리표시자 0개.
- `node bin/leerness.js audit . --json` — PASS: healthy, failures 0. 기존 design-system/reuse-map/orphan-guard/milestone-link 경고 4건만 유지.
- `node bin/leerness.js check . --json` — PASS: healthy, issues 0.
- `node bin/leerness.js verify-claim T-0126 --path . --json` — PASS after evidence normalization. 첫 실행은 `README.md/package.json/docs/...`를 한 경로로 기록한 증거 형식 오류를 정확히 거부했고, 파일별 경로와 Command/Exit 로그로 수정 후 통과.
- `node bin/leerness.js scan secrets . --json` — PASS: unacknowledged 0; 승인된 기존 테스트 패턴 16건. `encoding check` — PASS: findings 0.
- `git diff --check` — PASS. `drift check` — PASS: score 0.
- `lazy detect . --json` — KNOWN FAIL: 이번 변경과 무관한 기존 T-0031 evidence 누락 및 README.ko.md의 설명 문구 TODO 오탐/미추적 2건.
- Manual Codex cross-review — README/package metadata/CLI source/interoperability/clean-room 한계와 문구를 대조. `verify-claim`의 기본 done evidence 정책과 명시적 `--lenient` 완화를 소스에서 재확인해 “증거 없는 완료 차단” 기준을 유지했고, 휴리스틱이 의미적 정확성을 증명하지 않는다는 경계를 명시함.

## 2026-08-24 — T-0127 / T-0001 context map grounding

- Context-map contract assertion — PASS: 실행 흐름·소스/런타임·상태·검증/배포·변경 라우팅 섹션, package entry, 핵심 앵커를 확인했고 초기 `src/**`/`tests/**` 자리표시자 행은 0개.
- Referenced-path audit — PASS: 문서에 인용한 핵심 파일/디렉터리 56개가 모두 존재. `package.json`의 `main`과 `bin.leerness`는 모두 `bin/leerness.js`, npm `files`에는 `.leerness`가 포함되지 않음을 대조.
- `node bin/leerness.js verify . --json` — PASS: healthy, failures 0. `check . --json` — PASS: healthy, issues 0.
- `node bin/leerness.js verify-claim T-0127 --path . --json` 및 `verify-claim T-0001` — PASS.
- `node bin/leerness.js audit . --json` — PASS: healthy, failures 0. 기존 design-system/reuse-map/orphan-guard/milestone-link 경고 4건만 유지.
- `node bin/leerness.js health . --json` — PASS: healthy, stateIntegrity corrupted 0, criticalSecurity false. `drift check` — PASS: score 0.
- Secret/encoding guards — PASS: unacknowledged secrets 0, encoding findings 0. `git diff --check` — PASS.
- `lazy detect . --json` — KNOWN FAIL: 이번 변경과 무관한 기존 T-0031 evidence 누락 및 README.ko.md 설명 문구 TODO 오탐/미추적 2건.
- Manual Codex cross-review — `state-integrity.js`를 순수 모듈로 오분류한 표현, 누락된 `session-presence.js`, 추적 파일 `.env.example`까지 포함할 수 있던 `.env*` 표기를 발견·재현해 읽기 전용 integrity 경계, 세션 모듈, 정확한 ignore 패턴으로 수정. 에이전트별 진입도 “CLI와 MCP 모두”가 아닌 “CLI 또는 MCP”로 정밀화.
- Scope note — 이 라운드는 하네스 문서/상태만 변경했으므로 애플리케이션 테스트 스위트나 배포는 실행하지 않음.

## 2026-08-26 — T-0143 cross-runtime verify-code/gate regression

Task: T-0143
Command: npm test
Exit: 0
Note: selftest 353/353, core behavior 46/46, handoff 75/75 (parallel 8), command surface 40/40, installed cleanroom 10/10, full E2E 467/467. Python/Go/Rust, Node+Python 혼합, npm placeholder, JS-only tests 디렉터리, 실패 후 성공 회복, lazy/gate 증거 판정을 전용 probe로 검증했고 Node 18에서도 통과. 독립 리뷰 결과 P0/P1 없음.
Artifacts: bin/leerness.js, scripts/verify-code-cross-runtime-probe.js, package.json, CHANGELOG.md, README.md

## 2026-08-26 — T-0143 release verification

Task: T-0143
Command: npm view leerness@1.36.165 version dist.integrity dist.shasum; gh release view v1.36.165; node pipeline/verify-deploy.cjs --url https://leerness.com --expect 1.36.165; npm test; npm run test:installed; npm run deploy:dry-run
Exit: 0
Note: npm latest/exact는 1.36.165이고 registry integrity는 sha512-6WtoXVVRKfLEfneeXWWZ+mwll45YPgk0wpQM0pLiU3LJJ5tQV9tfasjFMhstrWjcVWOdMMUFbYnM/DpwEHQuZg==, shasum은 c33c15759c32954f626c38b2783f031159ce88af. GitHub release v1.36.165는 commit 8a388c7edc91d7f16b690b03391a3a0ed909dfa5를 가리킨다. leerness.com production은 1.36.165를 반환한다. leerness-gate 0.0.3은 92/92 단위 테스트, 12/12 설치 클린룸, Worker dry-run, leerness verify-code/check/lazy/gate/secret/encoding 및 1.36.165 migration audit(willChange 0)를 통과했다. 전역 설치·사용자 로컬 설치·npx exact 실행도 모두 1.36.165로 정합화했다.
Artifacts: https://github.com/gugu9999gu/leerness/releases/tag/v1.36.165, https://www.npmjs.com/package/leerness/v/1.36.165, https://leerness.com/changelog/1.36.165/, ../leerness-gate/package.json
