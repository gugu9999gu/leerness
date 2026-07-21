---
leernessRole: review-checklist
readWhen:
  - PR/리뷰 전
updateWhen:
  - 리뷰 기준 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Review Checklist

- [ ] 계획과 정렬되어 있는가
- [ ] progress-tracker가 갱신되었는가
- [ ] 보호 파일을 삭제하지 않았는가
- [ ] 디자인/기능 재사용을 확인했는가
- [ ] 시크릿이 코드에 들어가지 않았는가 (`leerness scan secrets`)
- [ ] 한글 인코딩 OK (`leerness encoding check`)
- [ ] 게으름 평가 통과 (`leerness lazy detect`)
