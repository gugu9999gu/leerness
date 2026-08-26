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
- 대기 중 <!-- leerness:auto -->
- v1.36.167 구현 커밋 `9412a32`, GitHub Release·npm latest·leerness.com production 게시 완료; 공개 게시본/해시/격리 설치 검증 통과
- GitHub CI run 32974961842 전체 OS·Node E2E 매트릭스 진행 중
- pre-wake critical 1건은 이번 릴리스 결함이 아니라 기존 영상 요청 UR-0028/UR-0051의 task/plan/decision 링크 누락

## Next
- T-0146: Windows `which`가 같은 npm 설치의 `leerness`/`leerness.cmd` shim pair를 PATH 충돌로 오인하는 false-positive 교정
- R2: 온톨로지 그래프 기본 활성(install 자동생성) + roadmap 탭 통합 + 기능 토글 스위치(gate 등, toggles.json + CLI + handoff 노출 + gate 준수) <!-- leerness:auto -->

## Blockers
- (없음) <!-- leerness:auto -->
- 없음
