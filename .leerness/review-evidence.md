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

## 2026-08-28 — T-0154 concurrent first-migration lock order

Task: T-0154
Command: node scripts/workspace-dir-lock-order-probe.js (10회 반복); npm run test:fast; npm test
Exit: 0
Note: v1.36.171 GitHub Actions run 33080411100의 Linux/Windows fast job에서 동시 최초 `.harness`→`.leerness` 마이그레이션이 `workspace-dir-file-conflict`로 실패한 것을 재현했다. 라이브 마이그레이션이 두 번째 workspace 검사·충돌 스캔 전에 프로젝트 잠금을 획득하도록 수정했다. 결정론적 probe는 peer의 실제 `open(..., 'wx')` EEXIST와 victim 잠금 해제 직전까지의 차단을 단언하며 10/10 반복 통과했다. `npm run test:fast`는 lint 61 JS + 1 JSON, migration 18/18, MCP presence 22/22, smoke 13/13을 통과했다. 전체 `npm test`는 selftest 355/355, core 46/46, handoff 75/75, command surface 40/40, installed cleanroom 10/10, full E2E 467/467을 5,447초에 통과했다. 외부 Codex 최초 검토의 P1/P2 2건(legacy-path ratchet, probe short-lock false-pass)을 수정한 뒤 재검토 결과 P0/P1/P2 없음.
Artifacts: lib/workspace-dir.js, scripts/workspace-dir-lock-order-probe.js, package.json, CHANGELOG.md, README.md, .leerness/bugfix-receipts.json, .leerness/release-checklist.md

## 2026-08-28 — v1.36.172 public release verification

Task: T-0154
Command: git ls-remote origin refs/heads/main refs/tags/v1.36.172; gh release view v1.36.172; npm view leerness@latest; fresh-prefix registry install; npm run site:build; npm run site:deploy; node pipeline/verify-deploy.cjs --url https://leerness.com --expect 1.36.172
Exit: 0
Note: GitHub main/tag/release가 구현 SHA `d9a6f543b88749a7707aa821894d7b74af67cb9e`로 일치한다. npm latest/exact는 1.36.172이며 registry integrity는 `sha512-8sQ9vISjRemmUXzMoJumGG2NNhb3kqm7eY3js70L2n3Hzvwg47Qli0Wv1B6tW/nQ/8utgIiDGd2/hkveNYXTJg==`, shasum은 `5071bb558eae9d31a801db23a66d937deda7ead7`; fresh-prefix 설치본은 v1.36.172, 런타임 의존성 0, install script 없음이고 설치된 tarball의 `workspace-dir-lock-order-probe.js`도 `WORKSPACE_LOCK_ORDER_OK`로 통과했다. 사이트는 commit `7feb5a7c0bb4d9550ec5c1e854679afa912c36fb`에서 696 pages를 빌드하고 Cloudflare deployment `928f3211`로 게시했다. `https://leerness.com/`과 `/changelog/1.36.172/`은 HTTP 200이며 첫 production 검증 시도에서 최신 버전과 TOCTOU 수정 내용을 노출했다. GitHub Actions run 33093298655의 Linux/Windows fast 잡은 모두 성공했고 전체 행렬은 기록 시점 실행 중이다.
Artifacts: https://github.com/gugu9999gu/leerness/releases/tag/v1.36.172, https://www.npmjs.com/package/leerness/v/1.36.172, https://leerness.com/changelog/1.36.172/, https://github.com/gugu9999gu/leerness/actions/runs/33093298655

## 2026-08-28 — T-0153 close verification and CI partial result

- `verify-claim T-0153 --strict-claims --json` — PASS after correcting the evidence boundary so the package verifier no longer interprets the site repository's `pipeline/verify-deploy.cjs` as a missing package file; evidence complete, claims consistent, git cross-check true, scope creep 0.
- `verify-claim T-0154 --strict-claims --json` — PASS was recorded before implementation commit `d9a6f543b88749a7707aa821894d7b74af67cb9e`. A post-commit rerun correctly reports git-mismatch because the implementation files are no longer in the working diff; `--lenient` then passes file/test/log existence without misrepresenting that distinction.
- GitHub Actions run 33093298655 partial close snapshot — 9/13 jobs success, 0 failure: Linux/Windows fast, all four release-runtime jobs, and Ubuntu Node 18/20/22 full E2E passed. Windows Node 18/20/22/24 full E2E remains in progress and is explicitly carried as the next action.

## 2026-08-28 — T-0093 Memory DELETE JSON contract

Task: T-0093 / T-0155
Command: isolated published-v1.36.172 probes; auto-roadmap-on five-command probe; `npm run test:fast`; `npm test`; external `codex exec review --uncommitted --ephemeral`
Exit: 0
Note: 공개본 1.36.172의 task/decision/lesson/rule/plan DELETE 성공 경로는 mutation 뒤 단일 JSON을 내지 않거나 사람용 출력을 섞었다. 5개 핸들러를 성공/오류 모두 구조화하고, auto-roadmap은 side effect를 유지하되 JSON 모드에서 조용히 실행한다. 외부 Codex 1차는 auto-roadmap stdout 혼입 P2를, 재검토는 rule remove 갱신 누락과 기존 HTML로 인한 비공허 회귀 P2 두 건을 재현했다. 모두 반영한 뒤 `test:fast` 13/13과 전체 `npm test`가 통과했다: lint 61 JS + 1 JSON, selftest 355/355, core 51/51, handoff 75/75, MCP presence 22/22, command surface 40/40, installed cleanroom 10/10, full E2E 467/467 (5,417초). Leerness verify/audit/check/lazy/gate 6/6과 122 claims(신규 실패 0)가 통과했고, `verify-claim T-0093 --strict-claims`는 Git 교차검증 7/7 및 scope creep 0으로 통과했다. v1.36.172 GitHub Actions run 33093298655도 최종 13/13 성공을 확인했다.
Artifacts: bin/leerness.js, scripts/e2e-core.js, .leerness/feature-contracts.md, .leerness/bugfix-receipts.json, CHANGELOG.md

## 2026-08-28 — v1.36.173 public release verification

Task: T-0155 / UR-0085
Command: git ls-remote origin refs/heads/main refs/tags/v1.36.173; gh release view v1.36.173; token-isolated `release publish --npm-publish`; npm latest/exact metadata; fresh-cache/fresh-prefix registry install; `npm run site:build`; `npm run site:deploy`; `verify-deploy --expect 1.36.173`; direct production HTTP checks
Exit: 0
Note: GitHub main과 annotated tag peeled target, 공개 Release가 구현 SHA `fe0cf4cd36cd8aef49d77e0e92fbfacca9d01980`으로 일치한다. npm latest/exact는 1.36.173이고 integrity `sha512-jDRe4nRI+qeqpcbichL1LF9AbfZ/zCUr8mXP/MXuckc/lXc8kHwUanOlzRo75QEDkRAK4LItP6DWcq/3UrzFAA==`, shasum `d1a009235c8f829cc517536cb53dde3b15a5b670`; 새 cache/prefix 설치본은 `.leerness`만 생성하고 DELETE JSON 5/5 및 명령별 roadmap 재생성을 통과했다. 사이트는 commit `cc8c951`에서 697 pages를 빌드하고 Cloudflare production deployment `1513bc64-e0c4-4410-b908-d754eb49b290`로 게시했다. leerness.com 루트, v1.36.173 changelog, Pages 원본은 모두 HTTP 200이고 최신 버전/수정 내용을 노출한다. GitHub Actions run 33116152701은 구현 SHA에서 fast Ubuntu/Windows, Ubuntu Node 18/20/22, Windows Node 18/20/22/24, release-runtime Ubuntu/Windows Node 24/26 전체 13/13이 성공했고 실패·취소·skip은 0이다.
Artifacts: https://github.com/gugu9999gu/leerness/releases/tag/v1.36.173, https://www.npmjs.com/package/leerness/v/1.36.173, https://leerness.com/changelog/1.36.173/, https://github.com/gugu9999gu/leerness/actions/runs/33116152701

## 2026-08-28 — T-0094 dead-flag and multi-session validation

Task: T-0094
Command: node scripts/dead-flags-probe.js; npm run test:fast; npm test; npm pack --dry-run; external `codex exec` read-only review
Exit: 0
Note: 10개 의심 표면을 실제 CLI/MCP 프로세스로 감사해 6개 결함 표면(intent expand, auto-update, setup-agents, provider, api-skill, toggle)을 수정하고 4개(memory archive, release cleanup, reuse-map strict-elements, parent adopt select)는 기존 정상 동작으로 보수적으로 확정했다. 외부 Codex 검토가 api-skill positional 흡수, auto-update lookalike/손상 hook 형상, init opt-out provider 덮어쓰기, toggle prototype ID를 재현했고 모두 회귀로 고정한 뒤 최종 `NO_P0_P1_P2`로 수렴했다. `npm run test:fast` 13/13, 전체 `npm test`는 selftest 355/355, core 51/51, handoff 75/75, MCP presence 22/22, command surface 40/40, installed cleanroom 10/10, full E2E 467/467을 6,673초에 통과했다. 멀티세션은 동시 24쓰기 전부 보존, 사용자 상태 쓰기 41종 canonical 락, sessionKey별 evidence/run/handoff/presence 격리, Claude↔Codex 상호 가시성, read-only handoff 추적 파일 쓰기 0으로 확인했다. `.harness`→`.leerness` canonical migration과 fresh 설치의 `.leerness` 단독 생성도 통과했다. `npm pack --dry-run`은 72 files/1.9 MB, 예상 shasum `75bff52f2c1977547a3ebabea7f9e3c4ed954042`; `npm audit --omit=dev`는 의도적으로 lockfile이 없는 0-runtime-dependency 패키지라 ENOLOCK으로 비적용이며 lockfile은 생성하지 않았다.
Artifacts: bin/leerness.js, lib/agent-registry.js, lib/mcp-tools.js, lib/toggles.js, scripts/dead-flags-probe.js, scripts/e2e.js, package.json, CHANGELOG.md, README.md, .leerness/feature-contracts.md, .leerness/bugfix-receipts.json

## 2026-08-28 — v1.36.174 public release verification

Task: T-0094
Command: release publish --git-push/--npm-publish/--gh-release; npm latest/exact metadata; fresh-cache/fresh-prefix registry install; npm run site:build; npm run site:deploy; verify-deploy --expect 1.36.174; direct production HTTP checks
Exit: 0
Note: GitHub main, annotated tag peeled target, 공개 Release가 구현 SHA `0cb57225b72d7b93e83172ad53818d72e1ae1cf8`로 일치하고 동일 `leerness-1.36.174.tgz`를 자산으로 첨부했다. GitHub 자산과 로컬 SHA-256은 `84a24c9a9079b60f2114064418a27936f1315885b9e6416845ffc21619097711`로 일치한다. npm latest/exact는 1.36.174이고 integrity `sha512-Xsc+FGWyyyfpOQM2vzVJfh8YOmB/XuEMGGyqNWmjxMZ0brT3zuUoi6TDZTqYJPkAnTGRrKv46xohcCHbaHKvuA==`, shasum `75bff52f2c1977547a3ebabea7f9e3c4ed954042`는 로컬 tarball SHA-1과 일치한다. 새 cache/prefix 설치본은 v1.36.174, runtime deps 0, install scripts 0이며 dead-flag probe와 fresh init의 `.leerness` 생성/`.harness` 미생성을 통과했다. 별도 `leerness-gate` 0.0.3은 92/92, installed cleanroom 12/12, Worker dry-run을 통과했고 공개 CLI의 migration plan은 1.36.165→1.36.174 version drift 외 missing/canonical pending 0건이었다. 활성 T-0025와 untracked harness를 방해하지 않도록 실제 update/writeback은 수행하지 않았다. 사이트는 commit `b50d537fa7225ff4c758382a3a7e11c4a79d1e88`에서 698 pages를 빌드하고 Cloudflare production deployment `383c96e7-0fdc-4438-84e1-03afd78bf9ba`로 게시했다. leerness.com 루트와 v1.36.174 changelog는 첫 production probe에서 HTTP 200과 최신 버전을 노출했다. GitHub Actions run 33148033939는 구현 SHA에서 양 OS fast, release-runtime Ubuntu/Windows Node 24/26, Ubuntu Node 18/20/22 및 Windows Node 18/20/22/24 전체 E2E까지 13/13 성공했고 실패·취소·skip은 0이다.
Artifacts: https://github.com/gugu9999gu/leerness/releases/tag/v1.36.174, https://www.npmjs.com/package/leerness/v/1.36.174, https://leerness.com/changelog/1.36.174/, https://github.com/gugu9999gu/leerness/actions/runs/33148033939

## 2026-08-29 — T-0089 disabled-provider bench isolation

Task: T-0089 / T-0157
Command: disabled-provider PATH marker probe; `node scripts/release-runtime-probe.js`; `npm run test:fast`; `npm test`; `gate --claims`; `verify-claim T-0089 --strict-claims`; external Codex focused review
Exit: 0
Note: `agents bench`가 비활성 provider를 `_checkAgent` 전에 제외하도록 수정했다. 10개 provider 플래그를 모두 0으로 둔 PATH 마커 프로브는 외부 Codex 실행 0회로 394/362/342ms에 3/3 통과했고 기존 15초 제한은 최대값 대비 약 38.1배 여유다. opt-in 단일 provider 행렬은 각 대상만 정확히 한 번 검사한다. 빠른 게이트 13/13과 전체 `npm test`가 통과했다: lint 63 JS + 1 JSON, selftest 355/355, core 51/51, MCP presence 22/22, command surface 40/40, installed cleanroom 10/10, full E2E 467/467(6,535초). 외부 리뷰는 최초 P1과 타이밍 증거 P2를 수정한 뒤 `NO_P0_P1_P2`로 수렴했다. T-0109는 명시적 범위 설계의 실측 경고율 63.1%가 사전 중단 기준 40%를 넘어서 보수적으로 드랍했다.
Artifacts: lib/agents.js, scripts/e2e.js, scripts/release-runtime-probe.js, CHANGELOG.md, .leerness/progress-tracker.md

## 2026-08-29 — v1.36.176 public release verification

Task: T-0157 / UR-0087
Command: `release publish --git-push --npm-publish --gh-release`; `git ls-remote`; `gh release view`; npm latest/exact metadata; fresh-prefix registry install and installed selftest; `npm run site:build`; `npm run site:deploy`; production HTTP probes
Exit: 0
Note: GitHub main과 tag `v1.36.176`은 구현 SHA `b0be547de857776b9299d5093f09dfe3c055b13d`로 일치하고 공개 Release가 생성됐다. npm latest/exact는 1.36.176이며 registry integrity는 `sha512-LY3Fv6DLRrArlpdnWtZJ5RaYSZdzMz/pplk1pIUBQF3nSKikjsDXi/+L2r1deZaFgtJp8NxMh7TT3RSH5SQ6zg==`, shasum은 `08477513fada829c678f0090709862c29bda1900`으로 로컬 pack과 일치한다. 작업공간 밖 공개 설치본은 version 1.36.176과 selftest 355/355를 확인했다. 사이트는 commit `899aefd`에서 700 pages를 빌드하고 Cloudflare production deployment `46e84679-2464-49a0-8495-e03a2bf768e5`로 게시했다. leerness.com 루트, v1.36.176 changelog, Pages 원본은 HTTP 200이며 버전과 agents bench 변경을 노출한다. GitHub Actions run 33240896988은 구현 SHA에서 전체 13/13 성공, 실패 0으로 완료됐다.
Artifacts: https://github.com/gugu9999gu/leerness/releases/tag/v1.36.176, https://www.npmjs.com/package/leerness/v/1.36.176, https://leerness.com/changelog/1.36.176/, https://github.com/gugu9999gu/leerness/actions/runs/33240896988

## 2026-08-30 — T-0022 mutation data-integrity boundary

Task: T-0022 / UR-0088
Command: `node scripts/mutation-integrity-probe.js`; `npm run test:fast`; `npm test`; `gate --claims`; `verify-claim T-0022 --strict-claims --require-evidence`; `npm pack --dry-run --json`; external Codex focused review plus direct reproductions
Exit: 0
Note: env encoding apply, drift auto-fix, and session close encoding repair now share one scan/plan/apply boundary and the common CAS writer. Windows replacement uses ReplaceFileW with a retained displaced original, explicit artifact roles, identity rechecks, bounded sharing-violation retry, and visible cleanup/partial-progress failures; unsupported or ambiguous CP949, corrupt BOM, shebang/batch, scanner I/O failure, stale plans, ADS/open handles, hard links, and concurrent last-window writers fail closed or preserve recoverable bytes. Auto-fix reports every stage in JSON and does not stop critical session recovery after a security repair. External Codex review reproduced three P2 findings (missing CP949 decoder, read-only non-mutating skip ordering, unborn/missing Git distinction); all were fixed and added to the mutation probe. `npm test` passed with lint 65 JS + 1 JSON, selftest 355/355, core 52/52, handoff 75/75, MCP presence 22/22, command surface 40/40, installed cleanroom 10/10, and full E2E 467/467 in 6,747 seconds. Multi-session coverage retained 24 concurrent writes, 41 canonical-lock state writers, Claude↔Codex visibility, per-session evidence/run/handoff/presence isolation, and 11 delayed race pairs. The explicit per-session work-scope P3 remains unimplemented and is not claimed here. Final gate passed 6/6 with 135 claims, zero new failures; strict T-0022 evidence is complete with scope creep 0. Pack dry-run contains 75 files and includes the new encoding module and mutation probe.
Artifacts: lib/io.js, lib/shell-encoding.js, lib/drift.js, lib/session-close.js, lib/health.js, bin/leerness.js, scripts/mutation-integrity-probe.js, scripts/e2e-core.js, package.json, .github/workflows/ci.yml, CHANGELOG.md, README.md

## 2026-08-30 — v1.36.177 public release verification

Task: T-0022 / UR-0088
Command: `release publish --git-push --npm-publish --gh-release`; `git ls-remote`; `gh release view`; npm latest/exact metadata; fresh-cache/fresh-prefix registry install and installed selftest; site build/deploy; production HTTP probes
Exit: 0 for publication checks; the GitHub Actions matrix later exposed a CI-only contract mismatch
Note: GitHub main and tag `v1.36.177` resolve to implementation SHA `211177a0c284f4c86b47fc2734abab2b43090948`; the public non-draft, non-prerelease Release exists. npm latest and exact are 1.36.177 with integrity `sha512-XSFjIkRiRb8/r7GpP5kPVcYU1/5PsrSdRMDM0TD5GMHdHA+bhtPwbVDRenYk17XFQK0enal4gJx0qptoVwaGzA==` and shasum `d2f2dbaac4d23e157ef3b0f575ae5f320c4066ce`, matching the local pack dry-run. A fresh registry install has version/CLI 1.36.177, runtime dependencies 0, install scripts 0, both new shipped files present, and selftest 355/355. The site source commit is `16d9481`; 701 pages built, Cloudflare Pages deployment `c3ab4a30` completed, and the production root, `/changelog/1.36.177/`, and the Pages origin all returned HTTP 200 with version 1.36.177 on the first probe. GitHub Actions run 33265056280 targets the implementation SHA; Ubuntu Node 18/20/22 full-E2E jobs failed, and the inspected Node 22 log reported exactly one stale assertion (`encoding-check BOM 스킵 실패`, 466/467) against the intentional POSIX byte-exact no-op contract.
Artifacts: https://github.com/gugu9999gu/leerness/releases/tag/v1.36.177, https://www.npmjs.com/package/leerness/v/1.36.177, https://leerness.com/changelog/1.36.177/, https://github.com/gugu9999gu/leerness/actions/runs/33265056280, https://c3ab4a30.leerness-site.pages.dev/

## 2026-08-30 — v1.36.178 CI contract correction pre-release verification

Task: T-0022 / UR-0088
Command: focused `scripts/e2e.js` correction; `npm run test:fast`; `verify`, `audit`, `scan secrets`, `encoding check`, `check`, `lazy detect`; code/test/recovery/contract lenses; external Codex read-only focused review
Exit: 0
Note: The full-E2E fixture now uses an unambiguous UTF-8 emoji payload, requires `.sh` to remain byte-exact, requires Windows `.ps1` output to be exactly BOM plus the original payload, requires POSIX `.ps1` to remain byte-exact, and checks the CLI exit status. This matches the already-passing dedicated mutation-integrity and e2e-core platform contracts. `npm run test:fast` passed with lint 65 JS + 1 JSON, mutation-integrity, MCP presence 22/22, false-claim 199/199, and smoke 13/13. Leerness guards reported verify healthy, audit failures 0, unacknowledged secrets 0, encoding findings 0, check issues 0, and lazy blocking issues 0. The external Codex review checked syntax, fixture eligibility, exact-byte assertions, platform branching, failure semantics, and version surfaces, then concluded `No findings`. Lenses were answered conservatively: the change is a single explicit branch, the assertion can fail and invokes the real CLI, unknown mutation states remain fail-closed, and the shipped platform contract is unchanged. `npm pack --dry-run` produced 75 files with shasum `0d348ea077730cf5ac196776c4cd29ca3d37fe8b` and integrity `sha512-7EnoHp2CR7xt11ZeXIhiBORr6tqLkguDJzPU9iNYEdFEa+JCkFihzNP2nWuaUvgY5WJtLT3sH/bhdi5jLduTUw==`.
Artifacts: scripts/e2e.js, package.json, bin/leerness.js, README.md, CHANGELOG.md, .leerness/HARNESS_VERSION, https://github.com/gugu9999gu/leerness/actions/runs/33265056280
