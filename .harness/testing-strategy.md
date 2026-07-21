---
leernessRole: testing-strategy
readWhen:
  - 검증 전
  - 릴리즈 전
updateWhen:
  - 테스트 전략 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Testing Strategy

- Typecheck (`tsc --noEmit` 또는 동등)
- Lint (`npm run lint` 등)
- Unit/Integration/E2E
- Manual smoke test
- Browser/UI smoke (frontend 변경 시)

## Evidence Format
Each completed task must reference an evidence ID stored in .harness/review-evidence.md.
