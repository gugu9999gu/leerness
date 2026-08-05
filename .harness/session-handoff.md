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

Last generated: 2026-08-05T01:59:53.472Z

## Completed
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
- T-0031 R1: agents multi(--execute 포함) 위임 브리프 접두 — 백그라운드 AI 가 leerness 프로토콜을 받도록 (dispatch 만 접두하던 갭) → next: 다음 액션 작성
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

## In Progress
- 없음

## Incomplete / Waiting / On Hold / Blocked
- 없음

## Dropped
- T-0017 FINAL review of redesigned _maskComments: realistic false-blank, missed-comment, caller-integration, and crash/hang defects only → next: 없음
- T-0018 T-0017 _maskComments final adversarial review: realistic false-blank, missed-comment, caller-integration, and hang checks → next: 없음
- T-0019 FINAL adversarial review of redesigned line-leading-only _maskComments: realistic false-BLANK, missed full-line comments, caller integration, and crash/hang → next: 없음

## Verification
```
---
leernessRole: review-evidence
readWhen:
  - 진행 보고
  - 릴리즈 검토
updateWhen:
  - 검증 결과 기록
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Review Evidence

Verification command/result history. Append-only.

## 2026-07-14 — T-0019/T-0020/T-0021 `_maskComments` review

- `node --check lib/pure-utils.js` — PASS
- `node --check bin/leerness.js` — PASS
- `node bin/leerness.js selftest --json` — PASS 289/289
- Direct helper probes plus `contract verify --json` scratch probes — reproduced valid-JavaScript false-blank, missed-comment, incomplete line-grammar, and pathological stack-overflow cases; ordinary controls passed.
- Independent read-only audit converged; `lib/pure-utils.js` and `bin/leerness.js` mtimes unchanged.
```

## Recommended Direction
- 프로젝트 계획 정리

## Next Exact Step
- project-brief.md를 실제 목적으로 업데이트
