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
- [ ] GitHub main/tag/release가 동일 구현 커밋을 가리키는지 확인
- [ ] npm latest/exact 1.36.172, integrity/shasum, fresh-prefix 설치 확인
- [ ] leerness.com production 루트와 v1.36.172 changelog 확인
- [ ] GitHub Actions Linux/Windows fast 포함 전체 작업 성공 확인
- [x] 새 런타임 의존성·lifecycle script·환경변수 없음; `.env.example` 변경 불필요
- [x] 롤백 기준: npm exact `leerness@1.36.171` 재설치, GitHub tag `v1.36.171`, 직전 사이트 커밋 `98f559e`
