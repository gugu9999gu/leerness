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
