---
leernessRole: current-state
readWhen:
  - 세션 시작
  - 작업 이어받기
updateWhen:
  - 현재 상태 변경
  - 다음 작업 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Current State

Updated: 2026-08-26

## Now
- T-0145 완료: 레거시 claims 실패 68건을 명시적 T-0145 이전 경계와 exact 행+사유 SHA-256 지문으로 격리하고 신규·변경·손상·동시 생성은 fail-closed <!-- leerness:auto -->
- v1.36.167 GitHub·npm·leerness.com 릴리스 및 공개 게시본 검증 진행 중

## Next
- v1.36.167 구현 커밋·태그·npm exact tarball·사이트 changelog 게시 및 CI/공개 엔드포인트 검증 <!-- leerness:auto -->
- T-0146: Windows `which`가 같은 npm 설치의 `leerness`/`leerness.cmd` shim pair를 PATH 충돌로 오인하는 false-positive 교정

## Blockers
- (없음) <!-- leerness:auto -->
- 없음
