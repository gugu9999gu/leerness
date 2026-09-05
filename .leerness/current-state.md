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

Updated: 2026-09-06

## Now
- P-0021 사용자 승인 / UR-0100: T-0180 compatibility-only 진단·쓰기 경계 구현 및 통합검증 진행 중. legacy 위치 유지, activation 미구현 <!-- leerness:auto -->
- v1.36.187 첫 후보2f4ce37 CI33982239269는4/13 성공·9/13 실패로 보존한다. 최소 설치 preview 회귀, 플랫폼별 encoding/REPL fixture를 수정했고 Windows 실제16초 지연 교체 및 불확실 timeout 복구 보존을 검증했다. 최종 delta 실제 Codex 정적 검수 CLEAN; 수정 후보의 전체 지원 CI와 공개 배포는 아직 대기다.
- docs/worktree-runtime-migration.md에 22개 알려진 표면(전수 writer 검증 아님), session ownership, presence/freshness+hook/structured-state 이전 단위를 분리했다. 구버전은 새 descriptor를 읽지 않으므로 M-0015-A 호환 guard와 실제 migration B를 별도 승인 단계로 나눴다.
- 검수 반영: Git 호환 guard는 projectKey 밖의 worktree 고정 위치, non-Git guard는 selected workspace와 무관한 canonical 위치로 구현했다. Windows replacement 직전·Git mutation 분류·다른 operation에서 재사용한 FD·MCP telemetry 오류 누락 네 건을 재현·수정했고 실제 Codex 재검토에서 4/4 FIXED를 받았다. 실행 로그의 사용자 task·요청 사본·승인 provenance는 mixed/private로 보존한다.
- 최신 사용자 요청 UR-0097: State 구조 감사/계획 반영(T-0173) 완료. 5-scope 설계 docs/state-scopes.md, 실제 architecture/reuse-map, M-0014..M-0018 계획을 반영했다. 아래 v1.36.185 항목은 이전 릴리스 이력이다.
- 승인된 T-0174 / P-0020 / UR-0098 / M-0014를 v1.36.186으로 구현·검증·출하했다. 5-scope resolver와 read-only state inspect, 단일 Git 조회·workspace snapshot 재사용·불필요한 I/O/기록 생략을 적용했다. 기존 데이터 이동·삭제·runtime 전환은 없다.
- 전용104개, Node18 scope58/CLI20, 공개 설치본 selftest355/355 및 state inspect 통과. 독립 Codex P2 3건 재현·수정 뒤 focused re-review CLEAN; 고정 구현 SHA bd33683의 CI33959679140은13/13 성공(전체 E2E467/467, 지원 OS/Node 조합 모두 포함). 로컬 장시간 npm test의 초기 단계는 마지막 수정 전이므로 최종 전용·설치형 재실행과 고정 CI 증거를 함께 보존한다.
- GitHub main/tag/Release와 npm latest/exact1.36.186의 아티팩트 무결성을 이전 출하 라운드에서 확인했다. 사이트 commit9a11b8b, production deployment ad2a3760-eba1-433d-bc9d-c2d1f4429fcd, root/changelog/llms/Pages HTTP200 검증 이력을 보존한다. 별도 main push 재실행 CI33964861084를 이번 마감에 조회해 Windows Node24 selftest1/355 실패를 발견했다. T-0181로 원인 확인을 추적하며, 이전 고정 CI13/13 성공과 새 실패를 함께 보존한다.
- T-0173 문서 검수 지적2개 수정·재검수2/2 FIXED와 문서 계약8/8 이력 보존. 그때 pending이었던 R-0002 출하는 이번 승인 구현 라운드의 v1.36.186 공개 검증으로 이행했다.
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
- T-0180 기존 writer 회귀·구버전 대조군·독립 Codex 검수와 지원 runtime 검증. T-0181의 진단 누락 수정과 원인 미확인 CI 실패를 구분하고 출하 전 재검증 <!-- leerness:auto -->
- M-0015 private runtime → M-0016 common control → M-0017 immutable memory/run finalize → M-0018 generated view/adapter 순서. 기존 원문과 legacy writer 호환을 단계별 검증한다.
- M-0010 역할 migration은 동일 State scope 계약에 연결하고 M-0011..M-0013은 그 위에서 진행한다. T-0092 i18n은 별도 잔여 백로그다.

## Blockers
- P-0021 승인 완료. 원 CI 실패의 errno는 미확인; 진단 JSON 폐기·exitCode 누출은 별도 fault injection으로 재현 후 수정·검증 중 <!-- leerness:auto -->
- P-0020 승인 범위는 출하·검증 완료. P-0021는 승인 후 구현·검증 중이며 UR-0097 전체 구조 전환과 M-0015..M-0018은 미완료다. 새 제품 릴리스는 아직 미실행이며 R-0002는 이번 호환 기능 검증·출하 경계에서 이행할 pending으로 유지한다. T-0181 원 CI errno는 미확정이며 진단 누락 수정과 구분한다.
