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

Updated: 2026-09-05

## Now
- v1.36.185 후보에서 공급자 상태의 설치·활성·인증·모델 호출 가능성·quota 축을 분리하고, 확인하지 않은 잔여량을 `unknown`으로 유지함
- exact-file TTL lease, strict Role/Agent/Routing v2 schema와 legacy 양방향 projection, bounded fail-closed role-store loader, availability-aware fallback와 revision-bound execution provenance를 구현함
- 전용 probe는 provider 24/24, lease 57/57, schema 88/88, role-store 65/65, fallback 80/80 통과. 전체 `npm test`는 selftest 355/355, core 52/52, command surface 40/40, installed cleanroom 10/10, full E2E 467/467(4,947초)로 종료 코드 0
- 독립 Codex 읽기 전용 최종 검수는 후속 delta까지 포함해 `CLEAN`. T-0165/T-0166/T-0167/T-0171/T-0172는 증거와 함께 done, UR-0096은 completed
- package/bin/README/HARNESS_VERSION/CHANGELOG가 1.36.185로 동기화되었고 GitHub/npm/leerness.com 공개 검증은 아직 시작 전
- 최종 로컬 gate는 6/6, 완료 claims 147건 신규 실패 0. 다섯 task claim은 각각 통과했고, pack dry-run은 88 files, 2,175,087 bytes, shasum `67f8673847fb86ea5010493be038900ba8fc7d90`를 산출함
- T-0159 실제 프로젝트 코드 기반 시안 워크플로는 페이지·기능·둘 다 중 범위 명확화 대기

## Next
- 최종 Leerness 게이트와 다섯 task claim을 검증한 뒤 v1.36.185를 GitHub main/tag/Release, npm latest, leerness.com에 게시하고 공개 설치본·사이트·Actions 13/13을 확인
- 게시가 끝나면 M-0010의 explicit v2 migration을 preview/confirm/lock/rollback과 legacy compatibility-window 계약 테스트부터 구현
- 이어서 M-0011의 Light Router·Tester·conditional gate·lease preflight, 이후 M-0012 read-only 통합 시각화와 M-0013 승인형 UI를 순차 진행

## Blockers
- (없음) <!-- leerness:auto -->
- 없음
