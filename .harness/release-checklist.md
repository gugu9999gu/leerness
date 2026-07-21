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
