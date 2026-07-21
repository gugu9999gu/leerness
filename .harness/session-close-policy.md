---
leernessRole: session-close-policy
readWhen:
  - 세션 종료 전
updateWhen:
  - 세션 종료 형식 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Session Close Policy

Every session must list:
- Completed
- In progress
- Incomplete
- Planned
- Waiting
- On hold
- Blocked
- Dropped
- Verification (commands run, results)
- Recommended next direction
- Next exact step

`leerness session close`가 위 9개 카테고리를 자동 추출하고, session-handoff.md에 다음 세션을 위한 인수인계 블록을 자동 작성합니다.
