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
- 최신 사용자 요청 UR-0097: State 구조 감사/계획 반영(T-0173) 완료. 5-scope 설계 docs/state-scopes.md, 실제 architecture/reuse-map, M-0014..M-0018 계획을 반영했다. 아래 v1.36.185 항목은 이전 릴리스 이력이다.
- P-0020 사용자 승인과 최적화 요청을 UR-0098로 등록했다. T-0174 5-scope resolver + read-only state inspect 구현 후 검증 중이며 기존 데이터 이동·삭제·runtime 전환은 없다. 전용 104개 검사 및 Node18 scope58/CLI20 통과; 독립 Codex P2 3건을 재현·수정했고 재검수와 전체 회귀·배포 검증은 진행 중이다.
- 독립 읽기 전용 검수의 문서 지적 2개 수정·재검수 2/2 FIXED, 문서 계약 8/8 및 strict verify-claim 통과. session close/check/lazy는 통과했으나 R-0002 배포는 미실행/pending이다.
- 명령 표면 감사 잔여 — i18n 누수 클래스 13건: pulse/round-history/milestones/session-resume/clarify/preview/requests/intent/review-request/plan/route/library/skill/web/pc/lsp/toggle/retro/tech/graph/dashboard/deps/insights/persona/agent-mode/py-check/api-skill 이 --language en·LEERNESS_LANG=en·en 프로젝트에서도 한국어 출력. 대조군: health 는 완전 영어(플래그 배선은 존재). 1,488회 실행 감사(2026-08-05) <!-- leerness:auto -->
- v1.36.185 후보에서 공급자 상태의 설치·활성·인증·모델 호출 가능성·quota 축을 분리하고, 확인하지 않은 잔여량을 `unknown`으로 유지함
- exact-file TTL lease, strict Role/Agent/Routing v2 schema와 legacy 양방향 projection, bounded fail-closed role-store loader, availability-aware fallback와 revision-bound execution provenance를 구현함
- 전용 probe는 provider 24/24, lease 57/57, schema 88/88, role-store 65/65, fallback 80/80 통과. 전체 `npm test`는 selftest 355/355, core 52/52, command surface 40/40, installed cleanroom 10/10, full E2E 467/467(4,947초)로 종료 코드 0
- 독립 Codex 읽기 전용 최종 검수는 후속 delta까지 포함해 `CLEAN`. T-0165/T-0166/T-0167/T-0171/T-0172는 증거와 함께 done, UR-0096은 completed
- package/bin/README/HARNESS_VERSION/CHANGELOG가 1.36.185로 동기화되었고 구현 SHA `585c8f421edda7db200cc78c59a7ca889c05dd10`에서 GitHub main/tag/Release와 npm latest를 게시함. Release asset SHA-256은 `bd9cb9f18bd89c665a93612d85287e0ac1afecd9d36015105e3f67dc6320dda1`, npm shasum은 `67f8673847fb86ea5010493be038900ba8fc7d90`로 로컬 pack과 일치함
- 사이트 commit `b39a79cceb6130d15825496d9d0a72ada5b9023c`와 Cloudflare deployment `cd2d9405-9741-4f1b-b685-92408d82c698`를 게시했고 production root/changelog/llms/Pages origin이 첫 시도에 1.36.185를 노출함. 공개 fresh-prefix 설치본도 CLI/package 1.36.185, runtime dependency 0, install script 없음, selftest 355/355를 확인함
- 최종 로컬 gate는 6/6, 완료 claims 147건 신규 실패 0. 다섯 task claim은 각각 통과했고, 실제 pack은 88 files, 2,175,087 bytes, shasum `67f8673847fb86ea5010493be038900ba8fc7d90`를 산출함. GitHub Actions run `33932206889`는 구현 SHA에서 13/13 성공했고 failure/cancelled/skipped/timed_out/annotation은 모두 0
- `session close` 뒤 다섯 task claim은 모두 `ok=true`, 최종 gate 6/6·check healthy. 구현 파일은 이미 게시 커밋에 있어 post-close Git 대조는 생성된 `leerness.html`만 현재 diff로 보고 `gitCrossCheck=false/strongMismatch=true`를 정직하게 표시함
- pre-wake critical 2건은 UR-0028의 오래된 미매칭 1건과 Actions를 104분 기다린 wakeup 지연 기록이며, v1.36.185 릴리스 실패나 현재 blocker가 아님
- T-0159 실제 프로젝트 코드 기반 시안 워크플로는 페이지·기능·둘 다 중 범위 명확화 대기

## Next
- T-0174 독립 검수·회귀·배포 검증 후 M-0015 명시적 private runtime migration 범위 설계 <!-- leerness:auto -->
- M-0015 private runtime → M-0016 common control → M-0017 immutable memory/run finalize → M-0018 generated view/adapter 순서. 기존 원문과 legacy writer 호환을 단계별 검증한다.
- M-0010 역할 migration은 동일 State scope 계약에 연결하고 M-0011..M-0013은 그 위에서 진행한다. T-0092 i18n은 별도 잔여 백로그다.

## Blockers
- (없음) <!-- leerness:auto -->
- 기술적 차단 없음. P-0020은 승인되었고 구현 검증 중이다. UR-0097 전체 구조 전환은 아직 미완료다.
