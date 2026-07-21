---
leernessRole: guardrails
readWhen:
  - 모든 작업 전
  - 보안/권한/리팩토링 전
updateWhen:
  - 금지 규칙 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Guardrails

- 토큰/키/비밀번호를 저장하지 않습니다. 환경변수 이름만 기록합니다.
- 요청 없는 대규모 리팩토링을 하지 않습니다 (5개 이상 파일 변경 시 사용자 사전 승인).
- API/DB/환경변수 변경은 영향 범위를 task-log에 기록합니다.
- Leerness 보호 파일/관리 섹션을 삭제하지 않습니다.
- 한글 인코딩은 BOM 없는 UTF-8을 유지합니다.
- destructive Git 작업(`git reset --hard`, `git push --force` 등)은 사용자 명시 승인 후에만 수행합니다.
