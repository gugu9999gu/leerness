---
leernessRole: session-handoff
readWhen:
  - 세션 시작
  - 다음 작업 이어받기
updateWhen:
  - 세션 종료
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Session Handoff

Last generated: 2026-08-27T17:11:13.033Z

## Completed
- T-0001 프로젝트 계획 정리 → next: stale planned milestone/task 정합성 감사 후 실제 구현 백로그 우선순위 선택
- T-0002 1.36.4~1.36.11 릴리스 아크: DB렌즈 recall + 정직성 감사 3연 + handoff 넛지 + optimism/백슬래시 FP + 17th 클린룸 4/4 → next: 다음 액션 작성
- T-0003 playbook 역이식 — 9라운드 현장 검증에서 나온 헌트 질문을 코어 database 렌즈에 추가 (KO+EN, selftest 가드 갱신, 게이트+배포) → next: 다음 액션 작성
- T-0004 partial 16건 디버그: Q6 확장(dirty read+MVCC 가시성) + Q12 신설(상태 전이-이벤트 순서-inbox 멱등) — 매트릭스 부분판정 6요소 full 승격 (1.36.15) → next: 다음 액션 작성
- T-0006 게시본 1.36.15 클린룸 codex 9건 채택: Q6 MVCC/BUSY_SNAPSHOT 정직화, Q9 세대카운터 모순수정(제거X→유지), Q11 파티션≠순서/단일락≠데드락, Q12 버전조건 조건부화, selftest 앵커+병합가드 강화, 라벨 11→12 (1.36.16) → next: 다음 액션 작성
- T-0007 렌즈-외 표면 버그헌트 (게시본 1.36.16) — database 렌즈 아닌 CLI 표면(task/rule/decision/lesson 파이프라인, --json 에러경로, migrate, contract, handoff 넛지, shell-guard)의 correctness 결함 codex 적대 헌트 + 맹신 X → next: 다음 액션 작성
- T-0008 UR-0052 이연 3건 처리: P2-6 contract verify 주석/문자열 마스킹, P3-8 handoff --compact 단일 워크스페이스 분기, P1-2 10k+ ID 리더 \d{4,} 일괄(날짜 무영향) → next: 다음 액션 작성
- T-0009 Adversarially review P2-6 masking, P3-8 compact handoff, and P1-2 ID widening in working tree; reproduce concrete bugs or refute. → next: Review delivered; implement and regression-test confirmed findings.
- T-0010 Adversarial review of v1.36.18 P2-6 masking, P3-8 compact handoff, P1-2 10k ID parsing: source audit plus scratch reproduction → next: 다음 액션 작성
- T-0011 Focused adversarial re-review of _maskCommentsStrings rewrite: reproduce or refute concrete false-fails only → next: Implement lexer-aware interpolation and token-aware regex detection
- T-0012 Focused _maskCommentsStrings adversarial re-review: nested templates, regex ambiguity, and contract false-fail reproduction → next: Implement and regression-test confirmed P1 findings
- T-0013 Final convergence check on _maskCommentsStrings and _REGEX_KW: reproduce or refute concrete false-fails only; do not audit repo. → next: Await user direction to fix the reproduced keyword-lookbehind false-fail.
- T-0014 T-0013: Probe _maskCommentsStrings/_REGEX_KW only for concrete false-missing regressions → next: Await user direction to fix the reproduced keyword-lookbehind false-fail.
- T-0015 FINAL convergence check on _maskCommentsStrings(src) in lib/pure-utils.js: report only realistic false-fails in contract verify. → next: Fix reported masker/caller integration false-fails before shipping.
- T-0016 FINAL convergence check: realistic contract-verify false-fails in _maskCommentsStrings only → next: Fix confirmed contract-verify false-fails.
- T-0020 Final line-leading-only _maskComments adversarial review → next: Fix scanner state handling and add regressions if requested
- T-0021 Review _maskComments for false blanking, missed full-line comments, caller integration, crashes, and hangs → next: Fix scanner state handling and add regressions if requested
- T-0024 codex #8/#6 재현 + 동일 버그클래스 전수 sweep(CRLF 파서/--json 실패경로/로더 스키마/mutation-order 잔여) — 워크플로 wrdyfscs7 오케스트레이션, 확정+현실성 있는 것만 수정 → next: 다음 액션 작성
- T-0025 UR-0027 확장 증거: requests 계열은 dispatch(21189)가 arg(--path,cwd)만 써 positional 경로 미지원 → `requests add "text" /other/project` 가 조용히 cwd 프로젝트에 기록하고 성공 보고(실제 피해 재현: 내 leerness-pkg 에 UR-0060 오기록 후 정리). task 는 _taskPositionalPath 로 지원해 불일치가 실수를 유도. 수정은 계약변경(존재 디렉토리 인식 FP 위험)이라 신중 필요 — 별도 라운드 → next: 다음 액션 작성
- T-0026 obra/superpowers + ui-ux-pro-max 검토(12 에이전트: ADOPT 0/ADAPT 8/REJECT 2) → SessionStart 컨텍스트 주입 배선 + README 소개·사용법·효과 재구성. 1.36.22 게시(selftest 292, e2e 386/386, 커밋 f318782, 클린룸 확정). 이연: memory search BM25(정렬레이어로만, 한국어 조사 토큰화 리스크) / debug 렌즈 / skill description 필드 / review --diff / UR-0027 positional 경로 → next: 다음 액션 작성
- T-0027 memory search 랭킹/동의어(1.36.23) — BM25 정렬 레이어 이식 + 언어교차 동의어 + JSON 정합. 포지셔닝 교정(한국어 우선은 목표 아님 → npm description 영문화) → next: 다음 액션 작성
- T-0028 skill 트리거 description 9종 + 합성 우선순위 + 하네스 문서 버전표기 제거 79건 (1.36.25) → next: 다음 액션 작성
- T-0029 skill lint P1/P2 (1.36.26) — _lintSkillMeta 순수함수(2티어 severity, ko 트리거절, CJK 본문예산) + skill lint CLI → next: 다음 액션 작성
- T-0030 debug 렌즈 (1.36.27) — systematic-debugging 을 자기질문 6문항으로(강제게이트 미이식/자기보고 명시/파일매핑 미확장) + route bugfix 힌트 + 표면 5곳 → next: 다음 액션 작성
- T-0031 R1: agents multi(--execute 포함) 위임 브리프 접두 — 백그라운드 AI 가 leerness 프로토콜을 받도록 (dispatch 만 접두하던 갭) → next: 완료 — delegation-brief 토글과 --raw opt-out 유지
- T-0032 R2: 온톨로지 그래프 기본 활성(install 자동생성) + roadmap 탭 통합 + 기능 토글 스위치(gate 등, toggles.json + CLI + handoff 노출 + gate 준수) → next: 중복 종료 — T-0033이 canonical 구현 task
- T-0033 R1+R2 (1.36.29/30) — multi 위임 브리프 + 온톨로지 그래프 기본활성/roadmap 통합/토글 → next: 다음 액션 작성
- T-0034 동시성 직렬화 (1.36.31) — codex #1/#2/#5/#7: state 락 직렬화 + team add 락내 재로드 + EPERM 재시도 + pre-wake 테이블 매처 → next: 다음 액션 작성
- T-0035 e2e 그린 복원 + 게이트 exit 마스킹 교정 (1.36.32, 자기 감사) — 1.36.30/31 e2e 실패 게시 정정 → next: 다음 액션 작성
- T-0036 데이터 보존 5종 (1.36.33) — migrate --force 상태보존/positional 8종/symlink/skill 충돌/settings 손상 → next: 다음 액션 작성
- T-0037 판정 정직화 5종 (1.36.34) — codex 3차 #4/#5/#8/#9/#10 → next: 다음 액션 작성
- T-0038 deps --run-tests 정직화 + #7 DEFER (1.36.35) — codex 3차 10건 전건 처분 → next: 다음 액션 작성
- T-0039 anchors 초안 합성 (1.36.36) — 도그푸딩 재실측(brief 4/7, Goal 6/7 미전환) 후속 → next: 다음 액션 작성
- T-0040 managed force 병합 + rules 무언삭제 방지 (1.36.37) — 마이그레이션 보존 3부작 완결 + codex 4차 #1 → next: 다음 액션 작성
- T-0041 분석 정직화 (1.36.38) — codex 4차 #2/#4/#9/#10 → next: 다음 액션 작성
- T-0042 판정 정직화 배치B (1.36.39) — codex 4차 10/10 처분 완결 → next: 다음 액션 작성
- T-0043 주장 사실성 감사 (1.36.40) — 드리프트 수치 소거 + 표면별 수치 정책 확립 → next: 다음 액션 작성
- T-0044 데이터 보존 3종 2차 (1.36.41) — codex 5차 #1/#2/#3 High → next: 다음 액션 작성
- T-0045 판정 정직화 배치C (1.36.42) — codex 5차 10/10 처분 완결 → next: 다음 액션 작성
- T-0046 enforce 사용 강제 (1.36.43) — codex goal 모드 미참조 버그 대응: pre-commit 관문 강제 + init 자동설치 → next: 다음 액션 작성
- T-0047 enforce 하드닝 (1.36.44) — FP/worktree/--no-verify audit → next: 다음 액션 작성
- T-0048 adapter codex --global (1.36.45) — goal 모드 전역 조건부 지침, 사용자 머신 실설치 → next: 다음 액션 작성
- T-0049 JSON 계약 완결 (1.36.46) — persona/review/guide, codex 5차 완전 소진 → next: 다음 액션 작성
- T-0050 ACP 입장 명문화 (1.36.48) — docs/interoperability.md + decision, 사용자 질의 대응 → next: 다음 액션 작성
- T-0051 codex 6차 헌트 — 신작 표면(1.36.28~48) 10건 전수 수정 (1.36.49) → next: 다음 액션 작성
- T-0052 결함 클래스 3종 전수 스윕 (1.36.50) → next: 다음 액션 작성
- T-0053 외부 GPT 감사 P0 채택 (1.36.52) → next: 다음 액션 작성
- T-0054 UR-0061 clarify/preview (1.36.51) + UR-0062 tech 프로필/그래프 탭 (1.36.53) → next: 다음 액션 작성
- T-0055 codex 7차 헌트 12건 전수 수정 (1.36.54) → next: 다음 액션 작성
- T-0056 E2E 아티팩트 이식성 6건 자기완결화 (1.36.55) → next: 다음 액션 작성
- T-0057 F-06 스캐너 개선 + R-0001 codex 검수 사이클 1회전 (1.36.56) → next: 다음 액션 작성
- T-0058 integrity check --repair (1.36.57, 감사 F-04 종결) → next: 다음 액션 작성
- T-0059 MCP core 프로필 (1.36.58, 감사 F-09 종결) → next: 다음 액션 작성
- T-0060 F-05 1회차 en 지시레이어 완역 (1.36.59) → next: 다음 액션 작성
- T-0061 언어 전환 현지화 병합 (1.36.60, F-05 2회차) → next: 다음 액션 작성
- T-0062 F-05 3회차 정책문서 en 완역 (1.36.61) → next: 다음 액션 작성
- T-0063 leerness.com GEO/AEO/SEO (UR-0064) → next: 다음 액션 작성
- T-0064 F-05 4회차 commands/AX en 완역 (1.36.62) → next: 다음 액션 작성
- T-0065 F-05 시리즈 완결 (1.36.63) → next: 다음 액션 작성
- T-0066 lint 게이트 (1.36.64, 감사 F-10) → next: 다음 액션 작성
- T-0067 no-op 재설치 (1.36.65, 감사 F-08) → next: 다음 액션 작성
- T-0068 codex 8차 홀리스틱 헌트 11건 수정 (1.36.66) → next: 다음 액션 작성
- T-0069 F15 tech-graph 정합 (1.36.67), F14 이연 → next: 다음 액션 작성
- T-0070 F14 재구현 완결 (1.36.68) → next: 다음 액션 작성
- T-0071 whats-new 응답 상한 (1.36.69) → next: 다음 액션 작성
- T-0072 migrate 보고 상한 (1.36.70) → next: 다음 액션 작성
- T-0073 retro/insights rows 상한 + 워크스페이스 --days 버그 (1.36.71) → next: 다음 액션 작성
- T-0074 task list 상한 + lint F16 (1.36.72) → next: 다음 액션 작성
- T-0075 8차 헌트 종결 F12+F9 (1.36.73) → next: 다음 액션 작성
- T-0076 9차 헌트 6건+검수 2건 (1.36.74) → next: 다음 액션 작성
- T-0077 UR-0066 디자인 시안 워크플로 (1.36.75) → next: 다음 액션 작성
- T-0078 9차 이월 3건+티어 교정 (1.36.76) → next: 다음 액션 작성
- T-0079 MCP clarify/preview (1.36.77) → next: 다음 액션 작성
- T-0080 10차 헌트 7건+검수 3건 (1.36.78) → next: 다음 액션 작성
- T-0081 도그푸딩 P1 5건 + 검수 7건 (1.36.79) → next: 다음 액션 작성
- T-0087 1.36.97 렌즈 3축 심화 구현 → next: 다음 액션 작성
- T-0088 session close 가 current-state.md 를 덮어쓴다 — 사용자 보고(hive-analytics): AI 이력에 '또 덮어썼습니다. 복원하겠습니다' 가 남음. 데이터 손실 계열이라 재현 후 보존 경로 확인 필요 → next: 중복/미갱신 백로그 종결 — 보존 회귀 유지
- T-0097 context budget 가 이월분(Preserved)을 분해해 보이도록 — 두 번 미뤄진 부채의 비용을 처음으로 계량 → next: 다음 액션 작성
- T-0099 e2e 미실행 명령 16종 잔여 — 이번 라운드가 requests/next-action/incident/brief/preview 경로를 덮었으므로 나머지(creds list|register|check|refresh · env check|sync|detect · wakeup-interval · workspace-dir · toggle · glossary · policy · path-setup · web|pc|lsp bridge · webhook serve · deploy auto · release sync-main)를 같은 방식으로 훑는다. 방법: (1) 커버리지 카운터에 다빈도 명령 대조군을 박고 수를 먼저 신뢰 가능하게 만든다 (2) 사용자 데이터/외부 입력을 쓰는 표면부터 (creds 가 최우선 — 자격증명 표면인데 e2e 실행 0회) (3) 발견은 인자 단위로 스윕한다(1.36.113 에서 같은 문장의 옆 인자를 놓쳤다). → next: 16개 잔여 CLI 명령군을 격리 픽스처·dry-run·권한거부로 전수 실행
- T-0100 개행 주입 위조 클래스 스윕 (1.36.113 완료분) → next: 다음 액션 작성
- T-0102 방치 명령 클래스 스윕 (1.36.114 완료분) → next: 다음 액션 작성
- T-0107 LEERNESS_WORKSPACE_DIR / migrate-workspace-dir 스플릿브레인: 해석기(_workspaceDirName) 소비처 9곳 vs '.leerness' 하드코딩 299곳(bin 261+lib 38). env 를 켜면 init 은 .leerness 를 만들고 _isInitialized 는 .leerness 를 보다 AGENTS.md 폴백으로 가려진다(실측: selftest 339/343). migrate-workspace-dir 는 copy 라 마이그레이션 후 .leerness 가 죽은 사본이 되어 '마이그레이션 성공' 이 거짓 주장이 된다. 조사→결정(전면 배선 / 기능 제거 / 불가 시 명시적 실패) 필요. → next: 완료 — .leerness canonical workspace migration and public release verified
- T-0108 P2 잔여 락 인구조사(정찰 실측): plan.md 가 progress 락으로 잠기는 오락(진입점 5곳) · decisions.json/lessons.json 진입점 4곳 중 1곳만 보호 · last-handoff.json 무락 · rules.md 부트스트랩/verifyRules 무락. 각 스토어마다 update 초크포인트를 만들어 모든 진입점을 태우고, 락 순서(progress→plan, progress→user-requests) 역순 금지를 가드로 고정한다. 1.36.130 은 실측된 유실 2건(rules.md 손글씨 파괴 · auto-fix 무락)만 고쳤다. → next: v1.36.169 GitHub/npm/leerness.com 배포 및 공개 검증
- T-0110 미해결 3종(1.36.132 기록): .leerness/state.json currentRunId 단일 슬롯 크로스토크(재현됨) · --compact/훅에서 범위 텍스트가 nextAction 으로 대체돼 소실 · MCP 도구는 LEERNESS_INTERNAL=1 로 스폰돼 프레즌스 미등록 → next: v1.36.171 공개 배포 검증
- T-0114 T-0112 진행분(1.36.134 워킹트리, e2e·게이트 미반영): 검수 P1 5건 중 4건 수정+실측 확인 — (a)bare 저장소 거부 (b)설치 중 사용자 기존 훅 실행 0회(훅에 LEERNESS_ENFORCE_PROBE 조기종료 추가) (c)sh 부재를 성공이라 하지 않음(verify_unavailable, --skip-verify opt-out) (d)실패 시 롤백+enforce.json 미생성(초기 쓰기 제거). 남은 것: (e)하위 디렉토리 설치가 실제 커밋에서 우회되는 문제 미수정 · 실패 코드가 'error' 로 뭉개짐 · 이 4건에 대한 e2e 단언 미작성 · 게이트 재실행 필요 · 재검수 필요. → next: 후속: Windows 셸에서 enforce 자체검증/CI 계약을 안정화
- T-0115 동시성 P1-A 무락 RMW 4종(실측·대조군 확보): roles set/unset/suggest --apply (agent-roles.json, 4동시 28.8% 유실·16동시 11~15/16) · creds register/refresh (credentials.local.json, 2동시 17.5%) · decision drop/lesson drop/team remove/memory restore (드롭이 락 밖이라 **락 안에서 커밋된 add 를 파괴** 1~3/8) · _bumpUsage(bin:22224, usage-stats.json — 모든 명령이 공유하는 유일한 파일, 2동시부터 38~46% 유실). 전부 exit 0·경고 0·JSON 손상 0(조용한 lost-update). 대조군: 락 무력화 복사본 16동시 task add 9~11/16 vs 락 켜면 16/16, 24동시 24/24 고유 ID. → next: 후속: release bump가 --patch 플래그를 경고 없이 수용하고 버전 표면을 함께 동기화하는지 회귀로 보강
- T-0116 동시성 P1-B 완료 게이트가 뒤집힌다: .leerness/state.json currentRunId 전역 단일 슬롯 — 8 sub-agent 가 start→record→verify 하면 오귀속 7/8. 판별 케이스: A 가 실제 작업+테스트하고 verify pass 를 불렀는데 증거가 B 의 run 에 붙어 **B 가 completion_claim_allowed:true, 실제 작업자 A 가 false**. 락으로 못 고침(세션 스코프 부재) · run 레코드에 세션 필드가 없어 사후 추적 불가. 1.36.132 세션 주소 재사용 검토. → next: 다음 액션 작성
- T-0117 동시성 P2: --dry-run 이 조용히 무시되고 실제로 쓴다 — readme sync --dry-run 이 빈 디렉토리에 README.md 5492바이트 생성하며 'synced' 보고 · session close --dry-run 이 완전한 실제 마감(파일 2 생성·4 수정). --dry-run 이 _BOOL_FLAGS 에 있어 파싱 오류도 안 남 · 읽기형 108개 중 106개가 쓴다(무쓰기는 usage stats·library show 둘뿐), glossary 는 비-프로젝트 디렉토리에 경고 없이 파일 생성 · brief set 이 README.md 까지 무락 수정 · session close 의 current-state.md 스냅샷이 락 밖(9건 중 1건 재현) → next: 다음 사용자 요청 대기; 전체 E2E의 독립 10건은 별도 요청으로 보존
- T-0120 enforce: GIT_CONFIG_NOSYSTEM 환경에서 설치 훅과 실제 git commit 훅 경로 불일치 차단 → next: 다음 액션 작성
- T-0121 enforce: hooksPath의 없는 pre-commit 조상 junction/symlink를 해석해 공유 worktree를 정확히 고지 → next: 완료 — 다음 사용자 요청 대기
- T-0122 release bump가 --patch 플래그를 경고 없이 수용하고 bin VERSION·README를 함께 동기화 → next: 다음 기능 작업: T-0117 dry-run 쓰기 회귀; 전역 selftest 2건은 별도 미해결로 보존
- T-0123 다음작업 이어서 진행 → next: T-0117 dry-run 쓰기 회귀를 다음 작업으로 진행
- T-0124 T-0122: release bump --patch 플래그와 버전 표면 동기화 회귀 보강 → next: T-0117 dry-run 계약 보강
- T-0125 T-0117 dry-run 쓰기 회귀 보강 → next: T-0117 완료 기록 및 다음 요청 대기
- T-0126 T-0001: project-brief.md를 실제 프로젝트 목적에 맞게 정리 → next: T-0001의 다음 항목인 context-map.md 실제 파일 구조 정리
- T-0127 T-0001: context-map.md를 실제 파일 구조에 맞게 정리 → next: M-0001 완료; 계획에 남은 stale planned milestone/task 정합성을 감사한 뒤 실제 구현 백로그 선택
- T-0128 leerness 적용 프로젝트에서 Cursor/Codex/Claude 등 동시 AI 세션의 소통·충돌 방지·상태 추적 구현 여부를 검증하고, 전체 CLI/MCP 명령을 안전한 픽스처에서 테스트·디버그한다 → next: 세션 협업 행위 검증과 전체 CLI/MCP 명령 커버리지 감사
- T-0129 sessions send/inbox/scope가 미구현인데 목록 조회로 성공 처리되는 false-success 수정 → next: 지원하지 않는 sessions 인자를 unknown_subcommand로 거부하는 회귀 추가
- T-0130 Windows에서 _scrubEnv가 Path를 누락해 selftest·doctor·MCP·enforce 검증이 연쇄 실패하는 결함 수정 → next: 환경 키 대소문자를 보존하는 scrub 회귀와 enforce 설치 행위 검증
- T-0131 Git for Windows 번들 sh가 PATH에 없을 때 enforce install이 verify_unavailable로 과잉 거부되는 결함 수정 → next: git --exec-path 기반 sh 탐색과 실제 훅 발화 회귀
- T-0132 env check --json이 .env.example 누락 키를 보고해도 exit 0을 반환하는 false-success 수정 → next: JSON 모드에서도 누락 키가 있으면 exit 1을 유지하도록 회귀 수정
- T-0133 Windows에서 selftest 실행시간보다 짧은 smoke 30초 타임아웃 때문에 test:fast가 거짓 실패하는 결함 수정 → next: smoke check별 timeout을 지원하고 selftest에 충분한 상한 적용
- T-0134 새 command-surface 회귀 스위트가 npm test와 CI에 연결되지 않아 고아 가드가 되는 결함 수정 → next: test:commands를 npm test와 Linux/Windows CI gate에 연결
- T-0135 lazy detect가 README 설명의 일반 TODO 단어를 실제 미추적 작업으로 오인하는 false-positive 수정 → next: TODO 주석 문법만 인식하도록 스캐너 회귀 추가
- T-0136 handoff를 동시 세션 안전한 읽기 경로로 분리하고 Cursor 주소·버전 skew·공용 추적파일 쓰기를 함께 해결 → next: 릴리스 승인 시 GitHub/npm/사이트 배포를 검증하고, Cursor 작업이 멈춘 뒤 hive-analytics에서 leerness update --yes 및 adapter cursor 실증
- T-0137 v1.36.154를 GitHub·npm·leerness.com에 배포하고 각 게시본을 재검증하며 R-0002 자동 배포 룰을 적용 → next: 후속 라운드: GitHub Actions Node 20 런타임 경고와 npm publish shell:true 폐기 경고를 재현·수정하고 R-0001/R-0002 게이트로 다음 버전을 출하
- T-0138 GitHub Actions Node 20 런타임 경고와 npm publish shell:true 폐기 경고를 재현·수정하고 R-0001/R-0002 게이트로 다음 버전을 출하 → next: T-0139에서 역사적 full-E2E 픽스처의 DEP0190 경고를 별도로 제거하고 비릴리스 spawn 표면을 감사
- T-0139 전체 E2E의 역사적 shell:true 테스트 픽스처 DEP0190 경고 제거 및 비릴리스 npm·diagnostics spawn 표면 전수 감사 → next: 완료 — portable process and DEP0190 regression gates verified
- T-0140 별도 클린룸에 패키징된 leerness와 leerness-gate를 설치해 가능한 모든 안전 CLI·게이트·통합 표면을 직접 실행하고 결함을 디버그 → next: 완료 — public product and Gate clean-room coverage verified
- T-0141 npm 인증 권한을 복구해 leerness 1.36.163과 leerness-gate 0.0.3을 registry latest로 게시하고 설치본을 재검증 → next: 완료 — future publishes use credential-isolated exact-tarball path
- T-0142 Windows Node 22 agents dispatch E2E fixture 안정화 . → next: 완료 — Windows agents dispatch fixture verified in 1.36.164 CI
- T-0143 ox-alpha의 leerness v1.36.161 평가 보고서를 현재 1.36.164에서 보수적으로 재검증하고 확인된 다음 작업을 진행 → next: T-0144 commands --json 및 unknown flag 정합화
- T-0144 commands --json 누락 및 명령별 unknown flag 거부 정합화 → next: T-0145 legacy gate --claims evidence migration policy
- T-0145 gate --claims가 레거시 완료 증거 68/108건 때문에 신규 작업과 무관하게 실패하는 상태의 마이그레이션·베이스라인 정책 정립 → next: T-0146 Windows which shim-pair false-positive 교정
- T-0146 Windows which 진단이 단일 npm 글로벌 설치의 leerness 및 leerness.cmd shim 쌍을 2개 PATH 충돌로 오인하는 false-positive 교정 → next: GitHub Actions run 32992266329 완료 확인 및 push 자동-trigger 누락 원인 관찰
- T-0148 T-0146 Windows which npm shim-pair false-positive 조사·수정·검증 → next: v1.36.168 release publish
- T-0149 v1.36.168 CI 완료 확인과 자동 push 트리거 누락 원인 조사 후 다음 백로그 진행 → next: v1.36.169 release publish and CI verification
- T-0150 자동 next-action 큐가 지원하지 않는 --filter와 존재하지 않는 stress 파일 실행을 제안하는 결함 수정 → next: v1.36.169 GitHub/npm/leerness.com 배포 및 공개 설치본 검증
- T-0151 v1.36.169 GitHub/npm/leerness.com 배포 및 CI 검증 → next: v1.36.170 release publish
- T-0152 auto-resume/context가 legacy next-action을 정규화하지 않는 결함 수정 → next: v1.36.170 GitHub/npm/leerness.com release publish and verify
- T-0153 v1.36.170 CI 최종 확인 후 현재 미해결 백로그를 선택해 다음 작업 진행 → next: GitHub Actions run 33093298655의 Windows Node 18/20/22/24 전체 E2E 종료 결과 후속 확인
- T-0154 CI에서 동시 최초 .harness→.leerness 마이그레이션이 복사 중간상태를 사용자 충돌로 오판하는 레이스 수정 → next: v1.36.172 GitHub/npm/leerness.com 배포 및 Linux/Windows CI 확인

## In Progress
- 없음

## Incomplete / Waiting / On Hold / Blocked
- 없음

## Dropped
- T-0017 FINAL review of redesigned _maskComments: realistic false-blank, missed-comment, caller-integration, and crash/hang defects only → next: 없음
- T-0018 T-0017 _maskComments final adversarial review: realistic false-blank, missed-comment, caller-integration, and hang checks → next: 없음
- T-0019 FINAL adversarial review of redesigned line-leading-only _maskComments: realistic false-BLANK, missed full-line comments, caller integration, and crash/hang → next: 없음
- T-0147 Windows which 진단이 단일 npm 글로벌 설치의 leerness 및 leerness.cmd shim 쌍을 2개 PATH 충돌로 오인하는 false-positive 교정 . → next: 없음

## Verification
```
## 2026-08-26 — T-0143 release verification

Task: T-0143
Command: npm view leerness@1.36.165 version dist.integrity dist.shasum; gh release view v1.36.165; node pipeline/verify-deploy.cjs --url https://leerness.com --expect 1.36.165; npm test; npm run test:installed; npm run deploy:dry-run
Exit: 0
Note: npm latest/exact는 1.36.165이고 registry integrity는 sha512-6WtoXVVRKfLEfneeXWWZ+mwll45YPgk0wpQM0pLiU3LJJ5tQV9tfasjFMhstrWjcVWOdMMUFbYnM/DpwEHQuZg==, shasum은 c33c15759c32954f626c38b2783f031159ce88af. GitHub release v1.36.165는 commit 8a388c7edc91d7f16b690b03391a3a0ed909dfa5를 가리킨다. leerness.com production은 1.36.165를 반환한다. leerness-gate 0.0.3은 92/92 단위 테스트, 12/12 설치 클린룸, Worker dry-run, leerness verify-code/check/lazy/gate/secret/encoding 및 1.36.165 migration audit(willChange 0)를 통과했다. 전역 설치·사용자 로컬 설치·npx exact 실행도 모두 1.36.165로 정합화했다.
Artifacts: https://github.com/gugu9999gu/leerness/releases/tag/v1.36.165, https://www.npmjs.com/package/leerness/v/1.36.165, https://leerness.com/changelog/1.36.165/, ../leerness-gate/package.json

## 2026-08-28 — T-0154 concurrent first-migration lock order

Task: T-0154
Command: node scripts/workspace-dir-lock-order-probe.js (10회 반복); npm run test:fast; npm test
Exit: 0
Note: v1.36.171 GitHub Actions run 33080411100의 Linux/Windows fast job에서 동시 최초 `.harness`→`.leerness` 마이그레이션이 `workspace-dir-file-conflict`로 실패한 것을 재현했다. 라이브 마이그레이션이 두 번째 workspace 검사·충돌 스캔 전에 프로젝트 잠금을 획득하도록 수정했다. 결정론적 probe는 peer의 실제 `open(..., 'wx')` EEXIST와 victim 잠금 해제 직전까지의 차단을 단언하며 10/10 반복 통과했다. `npm run test:fast`는 lint 61 JS + 1 JSON, migration 18/18, MCP presence 22/22, smoke 13/13을 통과했다. 전체 `npm test`는 selftest 355/355, core 46/46, handoff 75/75, command surface 40/40, installed cleanroom 10/10, full E2E 467/467을 5,447초에 통과했다. 외부 Codex 최초 검토의 P1/P2 2건(legacy-path ratchet, probe short-lock false-pass)을 수정한 뒤 재검토 결과 P0/P1/P2 없음.
Artifacts: lib/workspace-dir.js, scripts/workspace-dir-lock-order-probe.js, package.json, CHANGELOG.md, README.md, .leerness/bugfix-receipts.json, .leerness/release-checklist.md

## 2026-08-28 — v1.36.172 public release verification

Task: T-0154
Command: git ls-remote origin refs/heads/main refs/tags/v1.36.172; gh release view v1.36.172; npm view leerness@latest; fresh-prefix registry install; npm run site:build; npm run site:deploy; node pipeline/verify-deploy.cjs --url https://leerness.com --expect 1.36.172
Exit: 0
Note: GitHub main/tag/release가 구현 SHA `d9a6f543b88749a7707aa821894d7b74af67cb9e`로 일치한다. npm latest/exact는 1.36.172이며 registry integrity는 `sha512-8sQ9vISjRemmUXzMoJumGG2NNhb3kqm7eY3js70L2n3Hzvwg47Qli0Wv1B6tW/nQ/8utgIiDGd2/hkveNYXTJg==`, shasum은 `5071bb558eae9d31a801db23a66d937deda7ead7`; fresh-prefix 설치본은 v1.36.172, 런타임 의존성 0, install script 없음이고 설치된 tarball의 `workspace-dir-lock-order-probe.js`도 `WORKSPACE_LOCK_ORDER_OK`로 통과했다. 사이트는 commit `7feb5a7c0bb4d9550ec5c1e854679afa912c36fb`에서 696 pages를 빌드하고 Cloudflare deployment `928f3211`로 게시했다. `https://leerness.com/`과 `/changelog/1.36.172/`은 HTTP 200이며 첫 production 검증 시도에서 최신 버전과 TOCTOU 수정 내용을 노출했다. GitHub Actions run 33093298655의 Linux/Windows fast 잡은 모두 성공했고 전체 행렬은 기록 시점 실행 중이다.
Artifacts: https://github.com/gugu9999gu/leerness/releases/tag/v1.36.172, https://www.npmjs.com/package/leerness/v/1.36.172, https://leerness.com/changelog/1.36.172/, https://github.com/gugu9999gu/leerness/actions/runs/33093298655

## 2026-08-28 — T-0153 close verification and CI partial result

- `verify-claim T-0153 --strict-claims --json` — PASS after correcting the evidence boundary so the package verifier no longer interprets the site repository's `pipeline/verify-deploy.cjs` as a missing package file; evidence complete, claims consistent, git cross-check true, scope creep 0.
- `verify-claim T-0154 --strict-claims --json` — PASS was recorded before implementation commit `d9a6f543b88749a7707aa821894d7b74af67cb9e`. A post-commit rerun correctly reports git-mismatch because the implementation files are no longer in the working diff; `--lenient` then passes file/test/log existence without misrepresenting that distinction.
- GitHub Actions run 33093298655 partial close snapshot — 9/13 jobs success, 0 failure: Linux/Windows fast, all four release-runtime jobs, and Ubuntu Node 18/20/22 full E2E passed. Windows Node 18/20/22/24 full E2E remains in progress and is explicitly carried as the next action.
```

## Recommended Direction
- 게시본 1.36.13~1.36.15 누적 신규 표면 클린룸 리뷰 (database 렌즈 8→12문항, cap 16, selftest 앵커) — codex 적대 검증 + 맹신 X

## Next Exact Step
- 다음 액션 작성
