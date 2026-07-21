---
leernessRole: ax-migration-guide
readWhen:
  - 마이그레이션 전
updateWhen:
  - 마이그레이션 정책 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# AX Migration Guide

- Back up before changes (`.harness/archive/`).
- 기존 프로젝트 메모리 보존 (preserve-by-default).
- .env.example/.gitignore는 라인 단위 머지.
- 보호 파일을 삭제하지 않습니다.
- 마이그레이션 보고서는 `.harness/migration-report.md`.
- 자동: `leerness update --yes`가 위 절차를 백업·머지·검증까지 한번에 수행합니다.
