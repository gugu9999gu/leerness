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

Updated: 2026-09-01

## Now
- 명령 표면 감사 잔여 — i18n 누수 클래스 13건: pulse/round-history/milestones/session-resume/clarify/preview/requests/intent/review-request/plan/route/library/skill/web/pc/lsp/toggle/retro/tech/graph/dashboard/deps/insights/persona/agent-mode/py-check/api-skill 이 --language en·LEERNESS_LANG=en·en 프로젝트에서도 한국어 출력. 대조군: health 는 완전 영어(플래그 배선은 존재). 1,488회 실행 감사(2026-08-05) <!-- leerness:auto -->
- v1.36.183에서 English `skill list`의 4줄 누수를 stored/env/explicit locale 모두 0으로 만들고 39-command 측정 래칫을 34→30으로 강화함. 한국어 유효 메타데이터 바이트와 canonical JSON 값은 보존됨
- 전체 `npm test` 467/467(5,068초), 지연 경쟁 11/11, 범프 후 `test:fast`와 smoke 13/13 통과. 외부 Codex 최종 재검토는 actionable P0/P1/P2 없음
- v1.36.183 GitHub/npm/leerness.com 공개 완료. 구현/tag SHA `6e412c7`, 공개 pack digest 일치, fresh-prefix selftest 355/355, production HTTP 4/4, GitHub Actions 13/13 성공 및 failure/cancelled/skipped 0; 최종 claims gate 6/6, 완료 주장 141건 신규 실패 0
- T-0159 실제 프로젝트 코드 기반 시안 워크플로는 페이지·기능·둘 다 중 범위 명확화 대기

## Next
- audit --fix 가 README 관리블록의 Last synced 도장만 갱신하고 본문(하네스 버전 3곳·도구 수)은 낡은 채로 둔다 → 탐지기가 영구 침묵. 실측: --fix 후 낡은 1.20.0 3곳 잔존, 재감지 false. readme sync 는 0곳 잔존. 수정: --fix 가 readme sync 경로를 호출 <!-- leerness:auto -->
- 사용자에게 실제 구현 기반 시안의 적용 범위가 페이지·기능·둘 다 중 어느 것인지 확인하고, 답변 후 preview add로 설계 승인 절차 시작
- T-0092를 정확한 30줄/16명령에서 계속 낮춤. 다음 최대 클러스터는 mode·roles list·permissions list·session-resume 각 3줄

## Blockers
- (없음) <!-- leerness:auto -->
- 없음
