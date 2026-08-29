---
leernessRole: release-checklist
readWhen:
  - 배포 전
updateWhen:
  - 배포 조건/환경변수/롤백 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Release Checklist

- [ ] `leerness verify .`
- [ ] `leerness audit .`
- [ ] `leerness scan secrets .`
- [ ] `leerness encoding check .`
- [ ] 프로젝트 typecheck/lint/test
- [ ] 환경변수 (.env.example) 동기화
- [ ] 롤백 방법 확인
- [ ] CHANGELOG 갱신

## 2026-08-26 — v1.36.165

- [x] `leerness verify .`, `audit`, `check`, `lazy detect`, base `gate` 통과
- [x] secret scan 미승인 0건, encoding finding 0건
- [x] lint 통과; selftest 353/353, core 46/46, handoff 75/75, command surface 40/40, installed cleanroom 10/10, full E2E 467/467
- [x] Node 18 cross-runtime probe 및 Python/Go/Rust/혼합 런타임 verify-code 회귀 통과
- [x] 새 환경변수 없음; `.env.example` 변경 불필요
- [x] CHANGELOG/README/package version 1.36.165 동기화
- [x] npm latest/exact 1.36.165 및 tarball integrity/shasum 확인
- [x] GitHub tag/release v1.36.165가 commit `8a388c7edc91d7f16b690b03391a3a0ed909dfa5`를 가리킴
- [x] leerness.com production 1.36.165 확인
- [x] leerness-gate 0.0.3: 92/92, 설치 클린룸 12/12, Worker dry-run, 1.36.165 migration audit 통과
- [x] 롤백 기준: npm exact `leerness@1.36.164` 재설치 및 GitHub tag `v1.36.164`

## 2026-08-27 — v1.36.170

- [x] `leerness check`, `audit`, `scan secrets`, `encoding check`, `lazy detect`, `gate --claims`, `verify-claim --all` 통과
- [x] secret scan 미승인 0건, encoding finding 0건, lazy blocking 0건, claims 현재 실패 0건
- [x] lint 59 JS + 1 JSON; selftest 355/355, core 46/46, handoff 75/75, command surface 40/40, installed cleanroom 10/10, full E2E 467/467, forced interleaving 11/11
- [x] Cursor/Codex/Claude 멀티세션 직접 E2E: 24개 동시 쓰기 보존, session-scoped evidence, MCP sessionKey, ownership/child/path-escape 가드 통과
- [x] 외부 Codex 교차 리뷰에서 P0/P1/P2 없음; next-action regression probe와 release 후 persisted plan 정규화 확인
- [x] 새 환경변수·런타임 의존성·lifecycle script 없음; `.env.example` 변경 불필요
- [x] CHANGELOG/README/package version 1.36.170 동기화
- [x] 게시 시점 GitHub main/tag/release가 구현 커밋 `5bdf406f871849d6df76a3bc684f36bf0260f033`으로 일치; 후속 세션 증거는 `[skip ci]` 커밋으로 분리
- [x] npm latest/exact 1.36.170; integrity `sha512-AYLuecUlUuZPgOcNqaeTPeefKL6ngSiDieIlJ71nv+CXix5vHpSutuxj2eoHLHuk5CQ5+sEAPxZqybRQ95kNEQ==`, shasum `971f90a26e3cf7b2fab986a0349f5a0d1bd4acdf`, fresh-prefix 설치 확인
- [x] 사이트 커밋 `04b2623dcf094b2c9ad2e3edbb1b803f766d9477`, Astro 694 pages, Cloudflare deployment `5ba4d9bb`, leerness.com 루트와 v1.36.170 changelog HTTP 200
- [x] GitHub Actions run 33060937403 전체 13개 작업 성공 확인
- [x] 롤백 기준: npm exact `leerness@1.36.169` 재설치, GitHub tag `v1.36.169`, 직전 사이트 커밋 `2977c14`

## 2026-08-27 — v1.36.171

- [x] `leerness verify`, `audit`, `check`, `scan secrets`, `encoding check`, `lazy detect` 통과
- [x] lint 60 JS + 1 JSON; selftest 355/355, MCP presence 22/22, core 46/46, handoff 75/75, command surface 40/40, installed cleanroom 10/10, full E2E 467/467
- [x] Cursor/Codex/Claude 세션별 state/evidence 격리와 MCP lifecycle presence 직접 회귀 통과
- [x] 외부 Codex 재검토 P0/P1/P2 없음
- [x] 새 런타임 의존성·lifecycle script·환경변수 없음; `.env.example` 변경 불필요
- [x] CHANGELOG/README/package version 1.36.171 동기화 및 npm pack dry-run 확인
- [x] GitHub main/tag/release가 구현 커밋 `6df43ff6ee05440a6c37dd48c8ca757e6afc8c08`을 가리킴
- [x] npm latest/exact 1.36.171; integrity `sha512-dInp7iKx20+hHDKyH22s4YSq0p4IUDRQmgYNebdgRz5t/VjMsAwFLsdODUV26RhW+FqDDIV2v33JddJc+C2azQ==`, shasum `0bdad10dc0206457747e3aa3067ab6d2825cf125`, fresh-prefix 설치 확인
- [x] 사이트 커밋 `98f559e810f41d3b6eea412030874369d3d28135`, Cloudflare deployment `90df9305`, leerness.com 루트와 v1.36.171 changelog HTTP 200
- [ ] GitHub Actions run 33080411100: Linux/Windows `test:fast`가 동시 최초 마이그레이션의 `workspace-dir-file-conflict`로 실패. 공개본은 v1.36.172 핫픽스로 대체
- [x] 롤백 기준: npm exact `leerness@1.36.170` 재설치, GitHub tag `v1.36.170`, 직전 사이트 커밋 `04b2623`

## 2026-08-27 — v1.36.172

- [x] v1.36.171 Linux/Windows CI 실패를 T-0154 결정론적 probe로 수정 전 연속 재현
- [x] 마이그레이션 잠금을 두 번째 상태 검사·충돌 스캔보다 먼저 획득하도록 변경
- [x] 새 probe가 실제 peer `EEXIST`와 잠금 해제 직전까지의 대기를 검증하고 10/10 반복 통과
- [x] 외부 Codex 최초 검토 P1/P2 2건 수정 후 재검토에서 P0/P1/P2 없음
- [x] `npm run test:fast`: lint 61 JS + 1 JSON, migration 18/18, MCP presence 22/22, smoke 13/13 통과
- [x] selftest 355/355, core 46/46, handoff 75/75, MCP presence 22/22, command surface 40/40, installed cleanroom 10/10, full E2E 467/467 및 `verify-claim T-0154 --strict-claims` 통과
- [x] 게시 시점 GitHub main/tag/release가 구현 커밋 `d9a6f543b88749a7707aa821894d7b74af67cb9e`로 일치; 후속 세션 증거는 `[skip ci]` 커밋으로 분리
- [x] npm latest/exact 1.36.172; integrity `sha512-8sQ9vISjRemmUXzMoJumGG2NNhb3kqm7eY3js70L2n3Hzvwg47Qli0Wv1B6tW/nQ/8utgIiDGd2/hkveNYXTJg==`, shasum `5071bb558eae9d31a801db23a66d937deda7ead7`, fresh-prefix 설치와 런타임 의존성 0 확인
- [x] 사이트 커밋 `7feb5a7c0bb4d9550ec5c1e854679afa912c36fb`, Astro 696 pages, Cloudflare deployment `928f3211`; leerness.com production 루트와 v1.36.172 changelog HTTP 200 확인
- [x] GitHub Actions run 33093298655 전체 13/13 성공: Linux/Windows fast, release-runtime 4종, Ubuntu Node 18/20/22와 Windows Node 18/20/22/24 전체 E2E 통과
- [x] 새 런타임 의존성·lifecycle script·환경변수 없음; `.env.example` 변경 불필요
- [x] 롤백 기준: npm exact `leerness@1.36.171` 재설치, GitHub tag `v1.36.171`, 직전 사이트 커밋 `98f559e`

## 2026-08-28 — v1.36.173

- [x] T-0093 공개본 1.36.172 격리 재현: Memory DELETE 5종 성공 `--json` 경로가 빈 stdout/사람용 stderr를 내는 동일 클래스 확인
- [x] task/decision/lesson/rule/plan DELETE 성공·오류 JSON을 단일 문서/clean stderr로 통일하고, `onEveryChange` auto-roadmap을 JSON 모드에서 조용히 갱신
- [x] 각 명령 전에 기존 `leerness.html`을 제거하는 비공허 회귀로 다섯 명령의 실제 재생성을 독립 검증
- [x] 외부 Codex 1차 P2(자동 로드맵 stdout 혼입)와 재검토 P2 2건(rule remove 누락, 기존 산출물로 인한 허위 통과)을 모두 재현·수정
- [x] `npm run test:fast` 13/13 및 전체 `npm test` 통과: lint 61 JS + 1 JSON, selftest 355/355, core 51/51, handoff 75/75, MCP presence 22/22, command surface 40/40, installed cleanroom 10/10, full E2E 467/467 (5,417초)
- [x] package/bin/README/HARNESS_VERSION/CHANGELOG 1.36.173 동기화
- [x] Leerness verify/audit/check/lazy/gate/claim 게이트: gate 6/6, claims 122건 신규 실패 0, T-0093 strict claim 통과(scope creep 0)
- [x] GitHub main/tag/release SHA `fe0cf4cd36cd8aef49d77e0e92fbfacca9d01980`, Actions run 33116152701 13/13 성공, npm latest/exact/fresh install, 사이트 commit `cc8c951`·deployment `1513bc64`·HTTP 200 완료
- [x] 새 런타임 의존성·lifecycle script·환경변수 없음; `.env.example` 변경 불필요
- [x] 롤백 기준: npm exact `leerness@1.36.172` 재설치, GitHub tag `v1.36.172`, 직전 사이트 커밋 `7feb5a7`

## 2026-08-28 — v1.36.174

- [x] T-0094 dead-flag probe 11/11 통과: intent/setup-agents/provider/api-skill/auto-update/toggle의 문서화 옵션을 실제 동작 또는 명시적 거부로 고정
- [x] `npm run test:fast` 및 전체 `npm test` 통과: lint 62 JS + 1 JSON, selftest 355/355, core 51/51, handoff 75/75, MCP presence 22/22, command surface 40/40, installed cleanroom 10/10, full E2E 467/467
- [x] Cursor/Codex/Claude 멀티세션 직접 E2E: 24개 동시 쓰기 보존, 세션별 evidence/handoff/presence 귀속, sibling 차단과 hook 무쓰기 보장
- [x] `.harness/` → `.leerness/` fresh install·canonical migration·dual-live fail-closed 회귀 통과
- [x] 외부 Codex 반복 검토에서 발견한 P1/P2를 수정하고 최종 재검토 `NO_P0_P1_P2`
- [x] `verify`, `audit`, `check`, `lazy detect`, `gate --claims`, `verify-claim T-0094 --strict-claims`, secrets/encoding/lens 통과
- [x] package/bin/README/HARNESS_VERSION/CHANGELOG 1.36.174 동기화, `npm pack --dry-run` 72 files 확인
- [x] 새 런타임 의존성·lifecycle script·환경변수 없음; `.env.example` 변경 불필요 (`npm audit --omit=dev`는 의도적으로 lockfile이 없는 0-dependency 패키지라 ENOLOCK/N/A)
- [x] GitHub main/tag/release가 구현 SHA `0cb57225b72d7b93e83172ad53818d72e1ae1cf8`로 일치하고 exact tarball 자산 첨부 확인
- [x] GitHub Actions run 33148033939 전체 13/13 성공: 양 OS fast, release-runtime Ubuntu/Windows Node 24/26, Ubuntu Node 18/20/22와 Windows Node 18/20/22/24 전체 E2E; 실패·취소·skip 0
- [x] npm latest/exact 1.36.174; integrity `sha512-Xsc+FGWyyyfpOQM2vzVJfh8YOmB/XuEMGGyqNWmjxMZ0brT3zuUoi6TDZTqYJPkAnTGRrKv46xohcCHbaHKvuA==`, shasum `75bff52f2c1977547a3ebabea7f9e3c4ed954042`, fresh-prefix 설치 확인
- [x] 사이트 커밋 `b50d537fa7225ff4c758382a3a7e11c4a79d1e88`, Astro 698 pages, Cloudflare deployment `383c96e7-0fdc-4438-84e1-03afd78bf9ba`; leerness.com 루트와 v1.36.174 changelog HTTP 200 확인
- [x] 별도 `leerness-gate` 0.0.3 도그푸딩: 92/92, installed cleanroom 12/12, Worker dry-run 통과; 공개 leerness 1.36.174 migration plan은 missing/canonical pending 0, version drift 1건만 보고
- [x] 롤백 기준: npm exact `leerness@1.36.173` 재설치, GitHub tag `v1.36.173`, 직전 사이트 커밋 `cc8c951`

## 2026-08-29 — v1.36.176

- [x] T-0109 중단 규칙 적용: 가장 좁은 명시적 세션 범위 설계도 경고율 63.1%로 사전 기준 40%를 초과해 구현을 되돌리고 `dropped`로 보존
- [x] T-0089 수정: `agents bench`가 opt-in 되지 않은 provider의 외부 CLI/version probe를 실행하지 않도록 후보를 먼저 제한
- [x] PATH 실행 마커 직접 프로브 3/3 통과(394/362/342ms, 최대 394ms, 기존 15초 제한 대비 약 38.1배 여유)
- [x] 외부 Codex 리뷰의 P1/P2를 재현·수정하고 최종 재검토 `NO_P0_P1_P2`
- [x] `npm run test:fast` 및 전체 `npm test` 통과: lint 63 JS + 1 JSON, selftest 355/355, core 51/51, MCP presence 22/22, command surface 40/40, installed cleanroom 10/10, full E2E 467/467(6,535초)
- [x] 멀티 세션 E2E: 동시 24쓰기 무손실, 41개 사용자 상태 쓰기 canonical 락, Claude↔Codex 상호 가시성, sessionKey별 evidence/run/handoff/presence 격리, 다른 세션 증거 차용 차단
- [x] `.harness/` → `.leerness/` fresh 설치·canonical migration·dual-live fail-closed·설치본 legacy run remap 통과
- [x] `verify`, `audit`, `check`, secrets, encoding, lazy, lens, rules 및 `gate --claims` 6/6 통과; claims 133건의 신규 실패 0, T-0089 strict claim 통과
- [x] package/bin/README/HARNESS_VERSION/CHANGELOG 1.36.176 동기화; `npm pack --dry-run` 73 files, shasum `08477513fada829c678f0090709862c29bda1900`
- [x] GitHub main/tag/release가 구현 SHA `b0be547de857776b9299d5093f09dfe3c055b13d`로 일치
- [x] npm latest/exact 1.36.176; integrity `sha512-LY3Fv6DLRrArlpdnWtZJ5RaYSZdzMz/pplk1pIUBQF3nSKikjsDXi/+L2r1deZaFgtJp8NxMh7TT3RSH5SQ6zg==`, shasum 로컬 일치, fresh-prefix 공개 설치본 selftest 355/355
- [x] 사이트 커밋 `899aefd`, Astro 700 pages, Cloudflare production deployment `46e84679-2464-49a0-8495-e03a2bf768e5`; leerness.com 루트·v1.36.176 changelog·Pages 원본 HTTP 200
- [x] GitHub Actions run 33240896988 전체 13/13 성공, 실패 0; 구현 SHA `b0be547de857776b9299d5093f09dfe3c055b13d` 확인
- [x] 새 런타임 의존성·lifecycle script·환경변수 없음; `.env.example` 변경 불필요
- [x] 롤백 기준: npm exact `leerness@1.36.175` 재설치, GitHub tag `v1.36.175`, 직전 사이트 커밋 `dd0de8c`

## 2026-08-30 — v1.36.177

- [x] T-0022 공용 CAS/Windows ReplaceFileW 데이터 무결성 경계와 공용 encoding scan/plan/apply 구현
- [x] 외부 Codex 리뷰 P2 3건을 직접 재현하고 수정: CP949 decoder 부재 fail-closed, read-only 비변경 skip 순서, unborn/missing Git 구분
- [x] mutation-integrity: CP949·모호 UTF-8·손상 BOM·shebang/batch·스캔 I/O·stale plan·ADS/open handle·hard link·동시 writer·partial replacement·cleanup 실패·bounded retry 전부 통과
- [x] `npm run test:fast` 및 전체 `npm test` 통과: lint 65 JS + 1 JSON, selftest 355/355, core 52/52, handoff 75/75, MCP presence 22/22, command surface 40/40, installed cleanroom 10/10, full E2E 467/467(6,747초)
- [x] 멀티 세션 E2E: 동시 24쓰기 무손실, 사용자 상태 writer 41종 canonical 락, Claude↔Codex 상호 가시성, sessionKey별 evidence/run/handoff/presence 격리, 지연 경쟁 11쌍 통과
- [x] `.harness/` → `.leerness/` fresh 설치·canonical migration·dual-live fail-closed·설치본 legacy run remap 통과
- [x] `scan secrets`, `encoding check`, `check`, `lazy detect`, code/test/recovery/contract lens, rules 및 `gate --claims` 6/6 통과; claims 135건 신규 실패 0
- [x] `verify-claim T-0022 --strict-claims --require-evidence`: evidence complete, claims consistent, Git 13/13, scope creep 0
- [x] package/bin/README/HARNESS_VERSION/CHANGELOG 1.36.177 동기화; `npm pack --dry-run` 75 files, shasum `d2f2dbaac4d23e157ef3b0f575ae5f320c4066ce`
- [x] 새 런타임 의존성·lifecycle script·환경변수 없음; `.env.example` 변경 불필요
- [x] GitHub main/tag/release가 구현 SHA `211177a0c284f4c86b47fc2734abab2b43090948`로 일치하고 공개 Release 확인
- [x] npm latest/exact 1.36.177; registry integrity `sha512-XSFjIkRiRb8/r7GpP5kPVcYU1/5PsrSdRMDM0TD5GMHdHA+bhtPwbVDRenYk17XFQK0enal4gJx0qptoVwaGzA==`, shasum `d2f2dbaac4d23e157ef3b0f575ae5f320c4066ce`, fresh-prefix selftest 355/355
- [x] 사이트 commit `16d9481`, Astro 701 pages, Cloudflare deployment `c3ab4a30`; leerness.com 루트·v1.36.177 changelog·Pages 원본 HTTP 200
- [ ] GitHub Actions run 33265056280: Ubuntu Node 18/20/22 full E2E가 실패했으며 Node 22 로그의 단일 실패는 구 POSIX `.ps1` BOM 기대(`encoding-check BOM 스킵 실패`). v1.36.178에서 플랫폼 계약을 교정해 대체 검증
- [x] 롤백 기준: npm exact `leerness@1.36.176` 재설치, GitHub tag `v1.36.176`, 직전 사이트 커밋 `899aefd`

## 2026-08-30 — v1.36.178

- [x] v1.36.177 공개 CI 실패 범위 확인: Ubuntu Node 18/20/22 3개 작업 실패, Windows/POSIX 제품 계약과 구 full-E2E 기대 불일치로 격리
- [x] `scripts/e2e.js`가 `.sh` 전체 바이트를 보존하고, unambiguous UTF-8 `.ps1`은 Windows에서만 BOM+원문을 정확히 요구하며 POSIX에서는 byte-exact no-op을 요구하도록 수정
- [x] 외부 Codex 읽기 전용 교차 리뷰 최종 `No findings`; 구문·fixture eligibility·전용 mutation-integrity 계약과의 일치 확인
- [x] `npm run test:fast` 통과: lint 65 JS + 1 JSON, mutation-integrity, MCP presence 22/22, false-claim 199/199, smoke 13/13 포함
- [x] `verify`, `audit`, `scan secrets`, `encoding check`, `check`, `lazy detect` 및 code/test/recovery/contract lens 통과; failures/issues/blocking 0, 미승인 secret 0, encoding finding 0
- [x] package/bin/README/HARNESS_VERSION/CHANGELOG 1.36.178 동기화; 새 런타임 의존성·lifecycle script·환경변수 없음
- [x] `npm pack --dry-run`: 75 files, shasum `0d348ea077730cf5ac196776c4cd29ca3d37fe8b`, integrity `sha512-7EnoHp2CR7xt11ZeXIhiBORr6tqLkguDJzPU9iNYEdFEa+JCkFihzNP2nWuaUvgY5WJtLT3sH/bhdi5jLduTUw==`, `scripts/e2e.js` 포함
- [x] 공개 시점 GitHub main/tag/release가 구현 SHA `45c45b63a4544e58d084426c05400deab0e9c605`로 일치; npm latest/exact 1.36.178과 registry shasum/integrity가 로컬 pack과 일치하고 fresh-prefix selftest 통과; 사이트 commit `87c8eec`, Astro 702 pages, Cloudflare deployment `e45ef150`; leerness.com 루트·v1.36.178 changelog·Pages 원본 첫 시도 검증 통과
- [x] GitHub Actions run 33268510915이 구현 SHA `45c45b63a4544e58d084426c05400deab0e9c605`에서 전체 13/13 성공, 실패·취소·스킵 0; Ubuntu Node 18/20/22 및 Windows Node 18/20/22/24 full E2E 전부 통과
- [x] 롤백 기준: npm exact `leerness@1.36.177` 재설치, GitHub tag `v1.36.177`, 직전 사이트 커밋 `16d9481`
