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

- Back up before changes (`.leerness/archive/`).
- 기존 프로젝트 메모리 보존 (preserve-by-default).
- .env.example/.gitignore는 라인 단위 머지.
- 보호 파일을 삭제하지 않습니다.
- 마이그레이션 보고서는 `.leerness/migration-report.md`.
- 자동: `leerness update --yes`가 위 절차를 백업·머지·검증까지 한번에 수행합니다.
- 레거시 완료 증거는 소급 수정하지 않습니다. 명시적 경계 이전의 현재 실패만 `leerness verify-claim baseline create --before <T-ID> --yes`로 격리합니다.
- claims baseline은 전체 tracker 행+실패 사유 지문이 같을 때만 적용됩니다. 변경·신규 실패·손상 baseline은 fail-closed하며 `verify-claim --all --raw`로 원판정을 감사합니다.
- 생성된 claims baseline은 CLI로 덮어쓰지 않습니다. 새 정책이 필요하면 기존 tracked 파일의 제거/교체를 별도 코드리뷰로 승인합니다.
