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

Last generated: 2026-09-05T13:41:30.352Z

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
- T-0022 파일변경(--apply/--fix/mutate) 명령 데이터무결성 헌트: precondition 미검증 mutate·부분쓰기·인코딩 파괴 (rotate targets + auto-fix-detect-before-mutate 교훈) → next: Start T-0091 intermittent parent-detect selftest reproduction and setup-lifetime audit; keep T-0109 explicit work-scope advisory dropped because measured warning rate 63.1% exceeded the 40% stop threshold.
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
- T-0082 1.36.81 후보 diff 적대적 릴리스 검수: referee fail-closed 상태 전이, NUL 이스케이프 런타임 동치, e2e 회귀력, 문서 과장 여부 → next: Closed; regression guards retained.
- T-0087 1.36.97 렌즈 3축 심화 구현 → next: 다음 액션 작성
- T-0088 session close 가 current-state.md 를 덮어쓴다 — 사용자 보고(hive-analytics): AI 이력에 '또 덮어썼습니다. 복원하겠습니다' 가 남음. 데이터 손실 계열이라 재현 후 보존 경로 확인 필요 → next: 중복/미갱신 백로그 종결 — 보존 회귀 유지
- T-0089 e2e 타임아웃 여유 스윕 — doctor(30s→120s)만 고쳤고 agents/session 계열 11곳이 여유 1.2~2.6배로 남음. 각 호출의 하위명령별 실제 비용을 측정해 3배 미만인 곳만 상향(근거: 1.36.87 선례 '검사 대상은 속도가 아니라 동작'). 명령 단위 근사 실측: doctor 35.7s selftest 35.3s session 11.4s agents 8.2s (e2e 환경) → next: Publish and verify v1.36.176 under T-0157.
- T-0090 leerness 자체 테스트가 임시 디렉토리를 누수 — os.tmpdir()에 leerness 계열 79,591개 잔존(총 90,407 항목). e2e/selftest 블록 다수가 mkdtempSync 후 rmSync를 finally 밖에 두거나 아예 안 함. mkdtempSync 자체는 아직 1ms로 정상이나 사용자 디스크를 계속 먹는다. 정리 루틴 + 누수 블록 스윕 필요 → next: Closed; runtime leak guard retained.
- T-0091 selftest 'parent detect (1.30.2 #157)' 간헐 실패 — 게시된 1.36.100 에서도 재현되고 깨끗한 복사본에선 미발생, 게이트에선 통과. mkdtempSync 2회가 try 블록 밖이라 예외 시 테스트가 그대로 터진다. 원인 규명 + 셋업을 try 안으로 → next: 완료 — v1.36.179 GitHub/npm/leerness.com 공개 배포와 Actions 13/13 검증
- T-0093 명령 표면 감사 잔여 — invalid-json 5건(task drop --json / lesson drop --json / gate <bogus> --json / release cleanup <non-git> --json / reuse-map --include nosuchproj --json 및 retro·insights)이 --json 모드에서 JSON 아닌 출력 혼입. --json 계약은 '단일 유효 JSON 문서' 여야 한다 → next: 완료 — v1.36.173 공개 배포 및 production/CI 검증 완료
- T-0094 명령 표면 감사 잔여 — dead-flag 9건: memory archive / intent expand --expand-all·--select / auto-update status / release cleanup --keep 0·--keep -3 / setup-agents --no-setup-agents / provider add --env-flag·--version-args·--desc / reuse-map --strict-elements / api-skill add --no-crawl / parent adopt --select / toggle get gate — 광고된 플래그가 동작하지 않음 → next: 완료 — v1.36.174 공개 배포·CI 13/13 검증 완료; 다음 미해결 백로그 선택
- T-0095 명령 표면 감사 잔여 — false-claim 17건 중 핵심: update --check 가 레지스트리 조회 실패(오프라인)를 '최신입니다' 로 단정(P1) · round-history 가 leerness 도구 버전을 프로젝트 '현재 버전' 으로 표기 · plan init <path> 가 인자를 무시하고 cwd 에 71파일 워크스페이스 설치(P1) · memory bogus 가 'memory 를 모른다' 고 거짓 안내 · selftest/self check/preview show(손상 스토어) 오보고 → next: Complete; choose next real backlog item.
- T-0097 context budget 가 이월분(Preserved)을 분해해 보이도록 — 두 번 미뤄진 부채의 비용을 처음으로 계량 → next: 다음 액션 작성
- T-0099 e2e 미실행 명령 16종 잔여 — 이번 라운드가 requests/next-action/incident/brief/preview 경로를 덮었으므로 나머지(creds list|register|check|refresh · env check|sync|detect · wakeup-interval · workspace-dir · toggle · glossary · policy · path-setup · web|pc|lsp bridge · webhook serve · deploy auto · release sync-main)를 같은 방식으로 훑는다. 방법: (1) 커버리지 카운터에 다빈도 명령 대조군을 박고 수를 먼저 신뢰 가능하게 만든다 (2) 사용자 데이터/외부 입력을 쓰는 표면부터 (creds 가 최우선 — 자격증명 표면인데 e2e 실행 0회) (3) 발견은 인자 단위로 스윕한다(1.36.113 에서 같은 문장의 옆 인자를 놓쳤다). → next: 16개 잔여 CLI 명령군을 격리 픽스처·dry-run·권한거부로 전수 실행
- T-0100 개행 주입 위조 클래스 스윕 (1.36.113 완료분) → next: 다음 액션 작성
- T-0102 방치 명령 클래스 스윕 (1.36.114 완료분) → next: 다음 액션 작성
- T-0105 leerness 자신의 미배선 가드 3종: test:core / test:smoke 는 어떤 러너도 부르지 않고(ci.yml 은 test:fast 만 실행), 그 결과 scripts/e2e-core.js 도 실제로 안 돈다. 우리 도구가 우리 저장소에서 찾아낸 진짜 고아다. 선택: (a) CI 에 배선(러닝타임 증가 검토 필요) (b) 수동 명령임을 문서화 (c) 제거. 결정하면 e2e 블록 T 의 자기 기준값 단언도 함께 갱신할 것 → next: Closed; T-0106 heuristic limitation remains separate.
- T-0107 LEERNESS_WORKSPACE_DIR / migrate-workspace-dir 스플릿브레인: 해석기(_workspaceDirName) 소비처 9곳 vs '.leerness' 하드코딩 299곳(bin 261+lib 38). env 를 켜면 init 은 .leerness 를 만들고 _isInitialized 는 .leerness 를 보다 AGENTS.md 폴백으로 가려진다(실측: selftest 339/343). migrate-workspace-dir 는 copy 라 마이그레이션 후 .leerness 가 죽은 사본이 되어 '마이그레이션 성공' 이 거짓 주장이 된다. 조사→결정(전면 배선 / 기능 제거 / 불가 시 명시적 실패) 필요. → next: 완료 — .leerness canonical workspace migration and public release verified
- T-0108 P2 잔여 락 인구조사(정찰 실측): plan.md 가 progress 락으로 잠기는 오락(진입점 5곳) · decisions.json/lessons.json 진입점 4곳 중 1곳만 보호 · last-handoff.json 무락 · rules.md 부트스트랩/verifyRules 무락. 각 스토어마다 update 초크포인트를 만들어 모든 진입점을 태우고, 락 순서(progress→plan, progress→user-requests) 역순 금지를 가드로 고정한다. 1.36.130 은 실측된 유실 2건(rules.md 손글씨 파괴 · auto-fix 무락)만 고쳤다. → next: v1.36.169 GitHub/npm/leerness.com 배포 및 공개 검증
- T-0110 미해결 3종(1.36.132 기록): .leerness/state.json currentRunId 단일 슬롯 크로스토크(재현됨) · --compact/훅에서 범위 텍스트가 nextAction 으로 대체돼 소실 · MCP 도구는 LEERNESS_INTERNAL=1 로 스폰돼 프레즌스 미등록 → next: v1.36.171 공개 배포 검증
- T-0112 1.36.134 미출하 — enforce 검수 P1 5건 미해결(검수 원문: scratchpad/codex-134.out). (1)설치 실패(hook_inert) 후 훅 파일이 남는다 — 이전 상태 복원 필요 (2)sh 부재 시 verified:'skipped' 인데 ok:true — 관측 못 한 강제를 주장하지 않으려면 사람 표면에도 보여야 함 (3)저장소 하위 디렉토리에서 설치하면 실제 커밋에서 강제가 우회됨 (4)bare 저장소를 installable 로 판정(워킹트리가 없어 pre-commit 이 애초에 안 돔) (5)발화 검증이 사용자의 기존 pre-commit 체인과 strict gate 를 설치 도중 2회 실행 — 부작용. 이미 고친 것: last-handoff mtime 복원(설치가 게이트를 약화시키던 것). → next: Closed; remaining concurrency work is tracked separately.
- T-0114 T-0112 진행분(1.36.134 워킹트리, e2e·게이트 미반영): 검수 P1 5건 중 4건 수정+실측 확인 — (a)bare 저장소 거부 (b)설치 중 사용자 기존 훅 실행 0회(훅에 LEERNESS_ENFORCE_PROBE 조기종료 추가) (c)sh 부재를 성공이라 하지 않음(verify_unavailable, --skip-verify opt-out) (d)실패 시 롤백+enforce.json 미생성(초기 쓰기 제거). 남은 것: (e)하위 디렉토리 설치가 실제 커밋에서 우회되는 문제 미수정 · 실패 코드가 'error' 로 뭉개짐 · 이 4건에 대한 e2e 단언 미작성 · 게이트 재실행 필요 · 재검수 필요. → next: 후속: Windows 셸에서 enforce 자체검증/CI 계약을 안정화
- T-0115 동시성 P1-A 무락 RMW 4종(실측·대조군 확보): roles set/unset/suggest --apply (agent-roles.json, 4동시 28.8% 유실·16동시 11~15/16) · creds register/refresh (credentials.local.json, 2동시 17.5%) · decision drop/lesson drop/team remove/memory restore (드롭이 락 밖이라 **락 안에서 커밋된 add 를 파괴** 1~3/8) · _bumpUsage(bin:22224, usage-stats.json — 모든 명령이 공유하는 유일한 파일, 2동시부터 38~46% 유실). 전부 exit 0·경고 0·JSON 손상 0(조용한 lost-update). 대조군: 락 무력화 복사본 16동시 task add 9~11/16 vs 락 켜면 16/16, 24동시 24/24 고유 ID. → next: 후속: release bump가 --patch 플래그를 경고 없이 수용하고 버전 표면을 함께 동기화하는지 회귀로 보강
- T-0116 동시성 P1-B 완료 게이트가 뒤집힌다: .leerness/state.json currentRunId 전역 단일 슬롯 — 8 sub-agent 가 start→record→verify 하면 오귀속 7/8. 판별 케이스: A 가 실제 작업+테스트하고 verify pass 를 불렀는데 증거가 B 의 run 에 붙어 **B 가 completion_claim_allowed:true, 실제 작업자 A 가 false**. 락으로 못 고침(세션 스코프 부재) · run 레코드에 세션 필드가 없어 사후 추적 불가. 1.36.132 세션 주소 재사용 검토. → next: 다음 액션 작성
- T-0117 동시성 P2: --dry-run 이 조용히 무시되고 실제로 쓴다 — readme sync --dry-run 이 빈 디렉토리에 README.md 5492바이트 생성하며 'synced' 보고 · session close --dry-run 이 완전한 실제 마감(파일 2 생성·4 수정). --dry-run 이 _BOOL_FLAGS 에 있어 파싱 오류도 안 남 · 읽기형 108개 중 106개가 쓴다(무쓰기는 usage stats·library show 둘뿐), glossary 는 비-프로젝트 디렉토리에 경고 없이 파일 생성 · brief set 이 README.md 까지 무락 수정 · session close 의 current-state.md 스냅샷이 락 밖(9건 중 1건 재현) → next: 다음 사용자 요청 대기; 전체 E2E의 독립 10건은 별도 요청으로 보존
- T-0119 T-0118 원인 규명: 제품 결함 아님 — **내가 게이트 도중 저장소에 썼다**. 게이트 18:04~20:00 실행 중 18:43 에 task add 4건이 .leerness/progress-tracker.md 를 변경했고, 실패한 블록은 리포 루트 cwd 로 selftest 를 돌리므로 읽는 중 변경이 나면 j.fail>0 이 된다. 동일 조건 재현(cwd=repoRoot, env 상속) 시 exit 0 · stdout 순수 JSON · stderr 0B · pass=349/349 로 통과. 교훈: 게이트가 도는 동안 대상 저장소에 쓰지 않는다(lesson-dont-edit-under-a-mutation-runner). → next: Closed; operational lesson retained.
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
- T-0155 다음작업진행 → next: 완료 — 다음 미해결 백로그를 새 라운드에서 선택
- T-0156 다음 작업 이어서 진행하고, 남은 작업 뭐가있는지 알려줘 . → next: Recommended next: T-0109 explicit per-session scope for collision avoidance, then T-0089 CI timeout/headroom.
- T-0157 다음 작업 이어서 진행 . → next: Start T-0022 data-integrity mutation hunt, then T-0091 flaky selftest and T-0092 i18n leakage.
- T-0158 다음 작업 이어서 진행 → next: T-0092 영문 모드 i18n 누수 재현 범위 축소 및 첫 수정 라운드
- T-0160 Release v1.36.180 i18n priority-surface repayment and publication → next: Ask the mandatory UR-0090 clarification, then continue T-0092 from the measured 58-line ratchet with release cadence/idempotency audit/plan list/round-history.
- T-0161 T-0092 영문 i18n 잔여 상위 클러스터 현지화 및 v1.36.181 출하 . → next: Continue T-0092 from exact 38-line ratchet; next largest clusters are milestones or skill list (4 each), after mandatory T-0159 scope clarification.
- T-0162 v1.36.182 T-0092 i18n milestones 누수 클러스터 현지화·회귀·배포 → next: Closed. Continue T-0092 from exact 34 lines across 17 commands; prioritize skill list (4), then mode/roles/permissions/session-resume (3 each).
- T-0163 v1.36.183 T-0092 skill list i18n localization, regression, review, and public release → next: Closed. Continue T-0092 from exactly 30 Hangul lines across 16 commands; next largest clusters are mode, roles list, permissions list, and session-resume at 3 lines each. T-0159 remains waiting and untouched.
- T-0164 v1.36.184 T-0092 mode i18n localization, regression, review, and public release → next: Closed. Continue T-0092 from exactly 27 Hangul lines across 15 commands; next largest clusters are roles list, permissions list, and session-resume at 3 lines each. T-0159 remains waiting and untouched.
- T-0165 공급자 관측·프로젝트 시각화·역할 폴백·세션 조정 가능성 검토 및 핵심가치 정합 다음 작업 → next: Start M-0010 explicit v2 migration with preview, confirm, lock, rollback, and compatibility-window contract tests.
- T-0166 정확 파일 단위·짧은 TTL 세션 lease MVP 구현 → next: Connect exact-file lease preflight only when a later mutating Agent dispatch stage is explicitly approved.
- T-0167 Role/Agent/Routing schema v2 compatibility design and legacy round-trip probe → next: Implement explicit v2 migration without activating v2 runtime writes implicitly.
- T-0171 Legacy agent-roles.json bounded fail-closed loader and read-only validation projection → next: Keep legacy reads and writes fail-closed while the explicit v2 migration command is added.
- T-0172 역할 폴백·실행 이력 기반 v1: availability 계약, 선택지 resolver, 실행 provenance 기록 → next: Continue M-0010 with explicit v2 migration, then resume M-0011 router pipeline work.
- T-0173 UR-0097 State 구조 감사 및 5-scope 단계별 개발 계획 정합화 → next: P-0020 승인 후 T-0174 scope resolver/read-only state inspect 구현; UR-0097 전체 구현은 미완료
- T-0174 State scopes와 읽기 전용 저장 구조 진단 → next: T-0175 / M-0015: design private runtime reader/writer inventory, session ownership and explicit migration preview; obtain approval before implementation.
- T-0179 T-0175 사전 설계: runtime reader/writer 분류와 무손실 마이그레이션 승인 미리보기 → next: P-0021 / T-0180 approval for compatibility-only guard, then implementation and its own verification/publication. T-0175 and M-0015 remain incomplete.

## In Progress
- T-0092 명령 표면 감사 잔여 — i18n 누수 클래스 13건: pulse/round-history/milestones/session-resume/clarify/preview/requests/intent/review-request/plan/route/library/skill/web/pc/lsp/toggle/retro/tech/graph/dashboard/deps/insights/persona/agent-mode/py-check/api-skill 이 --language en·LEERNESS_LANG=en·en 프로젝트에서도 한국어 출력. 대조군: health 는 완전 영어(플래그 배선은 존재). 1,488회 실행 감사(2026-08-05) → next: Continue from exact 27 lines across 15 commands. Next largest clusters: roles list, permissions list, session-resume (3 each).
- T-0175 Worktree runtime 분리와 명시적 호환 마이그레이션 → next: P-0021/T-0180 compatibility-only approval; actual migration B requires separate approval.

## Incomplete / Waiting / On Hold / Blocked
- T-0159 실제 프로젝트 코드 기반 시안 구현·표시·승인 워크플로로 전환 (UR-0090) → next: 사용자에게 페이지 또는 기능 중 어느 쪽인지, 또는 둘 다인지 확인한 뒤 preview add로 설계 승인 요청

## Dropped
- T-0005 게시본 1.36.13~1.36.15 누적 신규 표면 클린룸 리뷰 (database 렌즈 8→12문항, cap 16, selftest 앵커) — codex 적대 검증 + 맹신 X → next: 없음
- T-0017 FINAL review of redesigned _maskComments: realistic false-blank, missed-comment, caller-integration, and crash/hang defects only → next: 없음
- T-0018 T-0017 _maskComments final adversarial review: realistic false-blank, missed-comment, caller-integration, and hang checks → next: 없음
- T-0019 FINAL adversarial review of redesigned line-leading-only _maskComments: realistic false-BLANK, missed full-line comments, caller integration, and crash/hang → next: 없음
- T-0023 codex fresh-hunt 이연: #7 --json이 mutation 전 early-return(reuse/release/encoding --apply --json이 apply 보고하나 미적용, bin 20278/14988/2609) + #8 CRLF plan tasks:[] & JSON 스키마 미검증 crash(requests/memory --json) + #6 copyRec lstatSync 심링크. 재현→수정 다음 라운드 → next: 없음
- T-0109 P3-A: 세션 레코드에 scope{files,baseSha,note,at} + 'leerness sessions scope' + 표류/겹침 권고를 4표면에. 선언 없는 자동 겹침 추론은 70.6% 발화라 기각(선언 시 27.3%). 중단 규칙 선언: 현장 발화율이 커밋 대비 40% 초과면 되돌린다. → next: Do not revive range-scope advisories without a newly measured design below 40%; retain exact-source evidence in commit 252c22d and scripts/e2e.js AB.
- T-0111 1.36.133 npm publish 미완 — 루트 .env 의 NPM_TOKEN·LEERNESS_NPM_TOKEN 둘 다 npm whoami 401(만료/폐기 추정). 커밋 252c22d 는 main 에 푸시됨, npm dist-tags.latest 는 1.36.132. 유효 토큰으로 'npm publish' 만 다시 하면 됨(빌드는 dry-run 통과, 47파일). → next: 없음
- T-0118 1.36.134 게이트 미통과 1건: e2e 'selftest --json 계약 실패 (stdout 오염 또는 stderr 잡음)'. 내 직접 재현은 **통과**(exit 0 · stdout 63,725B 유효 JSON · stderr 0B) — 즉 e2e 실행 환경에서만 발생하는 조건부 실패다. 게이트 로그: scratchpad/gate-134e.log. 다음 세션은 그 블록이 어떤 env/cwd 로 selftest 를 부르는지부터 확인할 것(내 재현 환경과 다른 지점이 원인). → next: 없음
- T-0147 Windows which 진단이 단일 npm 글로벌 설치의 leerness 및 leerness.cmd shim 쌍을 2개 PATH 충돌로 오인하는 false-positive 교정 . → next: 없음

## Verification
```
Command: GitHub Actions/check-runs APIs; atomic fast-forward main/tag push; `release publish . --gh-release --npm-publish`; npm latest/exact metadata; site worktree-source build/push/deploy; `verify-deploy` and four public HTTP/version probes.
Exit: 0 for all completed publication commands and probes. Fresh-prefix public selftest and final session-close checks are recorded separately below when they finish.
Tests: Frozen SHA `bd33683acc3e22a4f82e5cab9bba42ce1149600c` completed workflow `33959679140` with13/13 successful jobs, failure/cancelled/skipped/timed_out0; check-runs independently returned13 successes and annotation count0 before main promotion. All seven OS/Node state-scope steps and full E2E jobs passed, including Ubuntu18/20/22 and Windows18/20/22/24. Windows18 full E2E467/467 finished in6127seconds with runtime DEP0190 warnings0.
Publication: main and tag `v1.36.186` were atomically pushed to the tested SHA. The non-draft/non-prerelease GitHub Release asset is2205607bytes and its server-reported SHA256 `534e8270bd13647b4b41be64fee098aceb30f6fcb6ed51c0c8406ca42dbeace3` matches the local tarball. npm latest/exact both resolve to1.36.186; registry SHA1 `2b50abb48c501ee03569017f06d876fa0ffa49bf`, integrity `sha512-mytfzVF3e6QQ5zs/NCLmHkiDK2sP9+nlbyfIQRPW9jkQjusK1HsYGZagV2VBUNkH9dq3N2x1kETk+8i5H6xgVQ==`, fileCount97 and unpackedSize7238495 match the tested artifact.
Site: generated data commit `9a11b8b0245dec06d5ce55ceb114c81f2373988c`,710-page build, Cloudflare production deployment `ad2a3760-eba1-433d-bc9d-c2d1f4429fcd` on branch main. Root, `/changelog/1.36.186/`, `/llms.txt` and Pages origin all returned HTTP200 with the new version; `verify-deploy` passed on its first attempt. No UI source or scheduled/video pipeline setting changed.
Publication boundary: tag/release stay fixed at the tested SHA; final main may add only an evidence/state `[skip ci]` successor. The normal main push triggered automatic CI replay `33964861084` on the exact same tested SHA. That replay is still running, is not counted as another successful matrix, and does not replace the completed13/13 pre-publication run. No second product candidate was introduced.
Artifacts: https://github.com/gugu9999gu/leerness/releases/tag/v1.36.186, https://www.npmjs.com/package/leerness/v/1.36.186, https://leerness.com/changelog/1.36.186/, https://ad2a3760.leerness-site.pages.dev/, https://github.com/gugu9999gu/leerness/actions/runs/33959679140

Fresh public consumer: registry installation with lifecycle scripts disabled into a new temporary prefix succeeded; CLI/package version1.36.186, selftest ok=true/pass355/total355/fail0 and real state inspect ok=true/schema leerness.state-inspection/v1 were verified. It reports legacy layout with runtimeActivated=false and migrationAvailable=false. Direct Node package-object assertions verified runtime dependencies0 and preinstall/install/postinstall scripts0. An initial PowerShell reporting expression counted an absent dependencies property as one; that reporting-only null coercion was corrected by the direct package assertion, not by changing the package. R-0002 GitHub/npm/site publication and verification are satisfied. Final session close/claim/gate results follow below.

Session close: exited0, emitted all task categories and active-rule results, refreshed current-state/session-handoff/pre-wake and generated leerness.html. R-0002 automatic version check passed1.36.185→1.36.186; R-0001 remains a manual check backed by the independent Codex evidence above. Gate passed6/6 with149 completed claims,68 accepted historical baseline entries and0 new failures; check was healthy/0issues and lazy detect had0 blockers. Pre-wake critical1 is the pre-existing unmatched UR-0028, confirmed by requests audit. The generated global next-task suggestion selected the unrelated legacy i18n/router backlog, so the current-state/handoff direction was explicitly restored to the user's T-0175/M-0015 migration-design/approval boundary without changing those older tasks.

Post-close claim: `verify-claim T-0174 --require-evidence --json` exited0 with ok=true, files present, evidence complete, claims consistent, implementation substance true and reasons empty. It is explicitly static evidence (semanticVerified=false, testCountMatch=null), not another test execution. Git cross-check is true because the current diff contains the cited review-evidence.md; the14 implementation files are already committed at the tested/published SHA. The only scope advisory is the generated session-close artifact leerness.html (count1), not an unreviewed product change. Post-close check remained healthy/0issues and git diff --check passed. Final evidence successor contains only governance/state and this generated artifact; bin/lib/scripts/docs/package/README/CHANGELOG/CI content remains identical to tag v1.36.186.

## 2026-09-05 — T-0179 runtime migration design (review pending)

Task: T-0179 / UR-0099, parent T-0175 / M-0015. P-0021 / T-0180 are proposed only; broader UR-0097 remains in-progress.
Baseline: v1.36.186 / HEAD1805da9d2611a852be6a1b8636efa2977dd081f1. No bin/lib/scripts/package/README/CHANGELOG/CI diff. Normal harness task/request/preview and session bookkeeping is not claimed to be a globally no-write operation.
Command: source/Git read-only audit; inline Node runtime-migration-document-contract; `node bin/leerness.js verify . --json`; `git diff --check`.
Exit: 0 for completed document checks. Tests: 8/8 inline document-contract assertions passed: all22 known inventory surfaces covered; selected source-function anchors exist; local links resolve; preview unapproved and no activation API; incomplete task/milestone links; UR0099 links and UR0097 incomplete; ownership/compatibility/metadata caveats; product code/version unchanged. These are document/reference checks, not migration behavior or product E2E.
Independent source audits: two read-only agents each compared8 selected source SHA256/mtime/size snapshots before/after with8/8 unchanged (overlapping sets, not16 unique files). No fixture mutation, implementation or provider dispatch. Parent confirmed claims against the actual CLI and domain source before synthesis.
R-0001: real independent `codex exec --ephemeral --sandbox read-only --skip-git-repo-check` is reviewing the five planning documents against source; result pending at this entry. Sub-agent reports are not substituted for this review. No unknown/future descriptor or race test is claimed executed.
Design/lens: existing Git/workspace/session/I/O components are reused through a proposed narrow runtime-layout reader rather than a new general-purpose StateManager. Every mutable safety decision is rechecked; path discovery reuse must not create stale guard authority. Presence is observation, mtime is freshness, run status is not immutable evidence, and project policy must not follow the shared runtime helper accidentally. Actual migration remains separate from compatibility-only rejection.
Scope/approval: no product implementation, data relocation, activation, hooks/index/scheduler changes, worktree removal, new version, push, npm publication or site deployment. R-0002 is still pending at the new-feature approval boundary; the earlier v1.36.186 release is not counted as a release of this planning delta. P-0021 approval will authorize only the compatibility slice, followed by its own validation/publication.

Final design review: independent real `codex exec` completed with exit0 and three source-backed findings (P1 two, P2 one). Parent checked all three against `lib/state-paths.js` path-derived key/canonical fallback, `_leernessStateDir` hardcoded writer, `_runPreWakeAudit` request copy, agent one-shot `_recordRun` task text, and `lib/routing.js:routeCmd` approval fields. The initial document was wrong about project-keyed guard stability, selected-workspace guard authority and the completeness of runtime-only field descriptions. No unimplemented runtime exploit/race is claimed reproduced.
Corrections: proposed Git admission descriptor now has a fixed worktree-wide location outside projectKey; missing/legacy descriptor with projects/ present blocks even after a project rename. Non-Git admission uses a canonical selection-independent anchor and refuses alternate/dual/unresolved backend indicators. Mixed/private task, request and human-approval provenance requires retained private originals outside the removal scope or separately approved durable promotion, never automatic public copying or disposal.
Focused independent read-only agent re-review (not another Codex CLI run): all3 findings FIXED, no residual P0-P2 in that limited delta; two read calls, four document/source SHA256+mtime snapshots4/4 unchanged. It explicitly did not test a guard implementation. R-0001 is satisfied by the completed actual Codex review plus source confirmation/corrections and this scoped independent recheck.
Command: inline Node runtime-migration-document-contract rerun; `node bin/leerness.js verify . --json`; `git diff --check`. Exit: 0. Tests: 11/11 document/reference assertions passed, comprising the original8 checks and3 explicit correction contracts. They verify wording, references, tracking and absence of product mutation; they do not prove implemented migration/fencing. Check healthy/0issues, lazy detect0issues, encoding0findings and secrets0unacknowledged/14acknowledged; pre-close gate6/6 with149 completed claims,68 historical baseline entries and0 new failures.
```

## Agent / Model Provenance
- T-0179: actual independent codex exec completed; P1 two/P2 one confirmed from source and corrected. A separate bounded read-only agent recheck reported3/3 FIXED. The older dispatch.prepared rows below are not execution/review completion evidence.
- 2026-09-05T09:37:46 dispatch.prepared · role=- · agy
- 2026-09-05T09:37:46 dispatch.prepared · role=- · claude
- 2026-09-05T09:37:56 dispatch.prepared · role=- · claude

## Recommended Direction
- UR-0097 State scope direction: T-0179 initial migration design complete, M-0015 runtime implementation incomplete. Reuse existing components, deliver compatibility-only guard before separately approved activation. T-0092 remains an unrelated i18n backlog; the generic oldest-task suggestion was not accepted as this user's direction.

## Next Exact Step
- Request approval for P-0021 / T-0180: fixed worktree/non-Git compatibility descriptor reader, bounded read-only diagnostic and observed-layout write rejection; legacy storage unchanged. No data copy, activation, cleanup or Common-Control implementation is authorized by that preview.
- Newly observed T-0181: reproduce/isolate Windows Node24 UR-0113 encoding safety selftest failure in CI33964861084/job101303078325 before the next product release. This is the unchanged v1.36.186 SHA; do not mark it fixed, suppressed or successfully rerun.

## Current Round Boundary
- T-0179 design only is done: document contracts11/11, actual Codex review3 findings corrected, bounded independent recheck3/3 FIXED; verify-claim executed document verify with exit0 (semanticVerified=false). Product E2E/migration tests were not run in this design round.
- Session close exited0; post-close gate6/6 with150 completed claims,68 historical baseline entries and0 new failures. R-0001 manual review evidence is satisfied. R-0002 is pending (version unchanged); no new GitHub push/npm/site publication and no new product version.
- Pre-wake critical2: existing unmatched UR-0028 and75-minute elapsed wakeup record. These are retained observations, not proof of scheduler/process state. No scheduling or video setting was changed.
- P-0021 proposed, T-0180 planned, parent T-0175/M-0015 and broader UR-0097 incomplete. T-0181 was registered after session close as a planned release-verification follow-up; it is not a completed diagnosis.
- All bin/lib/scripts/package/README/CHANGELOG/CI source remains identical to HEAD1805da9 and release product v1.36.186. Normal harness bookkeeping and generated leerness.html changed; original data locations, Git index/hooks and the dirty saved main checkout remain untouched. No worktree cleanup occurred.

## 2026-09-06 — Approved compatibility implementation, superseding the approval-wait above

- Latest checkpoint (supersedes candidate notes below): standalone exact-directory/file output admission repaired after genuine1.36.74 regression. Original E2E unchanged, Node20/26 each2/2+11/11 observations; reader305/305 on18/26 after two missing glossary imports were restored. Actual Codex review01a07372-1fca-7df1-b717-4516e9f788bd exit0/CLEAN, static only. Final core is running; freeze/push reviewed successor, then require supported CI and a newly packed exact artifact before R-0002 publication. All earlier187 packs are stale. No public187 or actual migration B yet.
- Preserve failed evidence: candidate4 e8037bc CI33989990574 fast bothOS/runtime4 succeeded but Linux full E2E466/467 failed at the API producer case. Previous candidates' full Windows jobs are still being collected, not cancelled to erase results. T-0181 original186 errno remains inconclusive. Saved main beb039d with its original five dirty files remains untouched.

- P-0021 approved / UR-0100 / T-0180 in-progress. Candidate1.36.187 implements strict runtime compatibility diagnosis and observed writer rejection; actual migration B, control store, immutable finalize and generated-view transition remain unimplemented.
- Actual Codex review found four writer defects, all reproduced/fixed and rereviewed4/4 FIXED. Additional actual Codex found exact installer detach auxiliary omission, reproduced with both installers and fixed; independent bounded recheck FIXED. Details and before/after failures are in review-evidence.md.
- Reader143/143 on Windows26/18, writer79/79, Git108/108, replacement3/3, REPL4/4 on26/18/24, old-client negative3/3. Full npm test and frozen supported CI/publication are not complete at this entry.
- T-0181 diagnostic loss/exit-status defect fixed with2/2 injected and2/2 actual Windows controls on26/24; original prior CI errno remains unknown. Do not claim the underlying OS failure reproduced or fixed.
- Next exact step: finish final runtime suite and full regression, freeze candidate and run supported OS/Node CI, then satisfy R-0002 GitHub/npm/site verification. Only afterward close T-0180 and propose separately approved B; M-0015 remains incomplete. Version187 prepared locally, not yet public.
- Corrected candidate boundary: first release-branch CI33982239269 failed9/13; preview round-trip and platform-fixture regressions are fixed. Final runtime154/79/5/108/7/2 all passed on Windows26, commands complete including202/202 and40/40, final actual Codex static delta review CLEAN. Windows replacement budget30s retains no-timeout-retry/recovery safety. Freeze corrected SHA, then require supported CI and public artifact verification; earlier186 errno remains unknown.
- Latest boundary: second candidate d3eaf15 / CI33983778451 cancelled after fast Ubuntu and Windows failures (4 release-runtime success, 7 full gates cancelled). Both actual-copy early admission and actual Node20 namespace rollback are reproduced/fixed. Canonical per-target identity, read-only migration join and strict denial latches now pass four-runtime migration72/72/alias24/24 and admission21/21/Git108/108 each. Actual Codex admission delta review CLEAN. Resolve the intermediate full-E2E T-0090 fixture cleanup leak before freezing the next candidate. No new public release; no actual runtime migration B.
- Later diagnostic boundary: intermediate full E2E463/467 in7061s, not a pass. Actual selftest/doctor exit0 still leaked three owned fixture families through swallowed native Windows errors. Native retry options alone failed352/355; bounded JS cleanup restored355/355 and actual healthy/persistent-error9/9 on18/26, plus transient/nontransient/replaced-directory3/3 each. BigInt identity precision follow-up and full T-0090/frozen regression are pending final verification. Existing Git-unavailable/damaged CLI expectations are being split from preserved low-level advisory controls; do not weaken zero-write or hook assertions.
- Latest frozen source: ef41542. Final bigint cleanup9/9 on18/26, unchanged whole T-0090+warning2/2 (1083.555s,10 real CLI exits0/leak0), E2E133+1342/2, core exit0, exact artifact install355/355 and packaged old-client3/3 passed. CI33988718549 has both fast OS jobs failed79/80 at the same old dangling-ledger domain expectation; seven full E2E jobs remain running. The test-only fix retains real file links where allowed, uses Windows permission-only junction fallback, and verifies both initial admission/domain refusals with full no-write snapshots. Four-runtime8/8, Node20 full80/80, actual Codex static delta CLEAN. Next: freeze test-only successor, get supported CI/full E2E results and repack; previous ef41542 pack is superseded by that test-file change. No public187 release or actual migration B.
