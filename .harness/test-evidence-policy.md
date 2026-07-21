---
leernessRole: test-evidence-policy
readWhen:
  - 검증 결과 기록 시
updateWhen:
  - 검증 형식 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Test Evidence Policy

매 검증은 `.harness/review-evidence.md`에 누적 기록합니다.

## Format
```
## YYYY-MM-DD HH:MM
Task: T-XXXX
Command: <명령>
Exit: <코드>
Note: <주요 결과 요약>
Artifacts: <스크린샷/로그 경로>
```
