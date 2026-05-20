---
leernessRole: session-workflow
readWhen:
  - 세션 시작
  - 새 사용자 요청 도착
  - 복잡한 작업 분배 전
updateWhen:
  - 워크플로 단계 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Session Workflow — AI 하네스 엔지니어링 6단계

> **매 세션 시작 시 메인 에이전트는 이 문서를 먼저 읽고 6단계를 그대로 따른다.**
> 라운드 길이/복잡도 무관, 단순 작업도 동일 흐름 유지 — 그래야 drift 안 됨.

## Step 1. 요청 분석 + 환경 확인
```bash
leerness handoff .            # 컨텍스트 적재 + drift 자동 경고
leerness drift check .        # 4 신호 + 4단계 레벨
```
- 사용자 요청을 5W1H로 분해. 모호하면 명확화 질문 (autonomous 모드 제외).
- drift critical 시 `leerness session close .` 또는 `drift check --auto-fix` 우선 실행.

## Step 2. 계획 수립
- 작업이 3 step 이상 → TodoWrite 또는 `leerness plan add` 사용.
- 신규 capability → `leerness reuse-map` / `reuse find <query>`로 기존 자원 우선 검색.
- 다중 모듈 → 통합 사양 사전 정의 (예: TICK_SPEC.md).

## Step 3. 업무 분배 — sub-agent 매핑
```bash
leerness agents list                  # ready CLI 확인
leerness agents quota                 # 한도 확인
leerness agents dispatch "<task>" --to <id>   # 작업 유형 추천 자동
```
- 작업 유형별 최적 sub-agent:
  - 텍스트/번역/분석 → claude (1.7× 빠름)
  - 깊은 코드 추론 → codex (가장 상세)
  - 파일 직접 수정 → gemini --yolo (정확)
  - 보안 리뷰 → `leerness review --persona security`
- **충돌 방지 규칙 (필수)**:
  - 각 sub-agent에 *자신만 수정할 파일 경로* 명시
  - mtime 검증 결과 보고 의무화 (동시 쓰기는 last-writer-wins 위험)
  - 사양 사전 정의 → `leerness contract verify`로 사후 검증

## Step 4. sub-agent 작업 + 개별 자체 검증
- 각 sub-agent가 자기 모듈 자체 테스트 통과 후 보고.
- 보고 형식: 라인 수, 테스트 N/N PASS, 발견 이슈, mtime 검증 결과.

## Step 5. 종합 검증
```bash
leerness contract verify SPEC.md src/<mod>.js  # 명세 ↔ 구현 일치
leerness verify-claim T-XXX --run-tests --strict-claims
leerness review <file> --persona security,performance,ux
```
- 메인이 직접 통합 시나리오 작성 + 실행 (independent 검증).
- Sub-agent 검수 vs 메인 검수 결과 *교차 일치* 확인.

## Step 6. 세션 마감 + 인계 + 다음 라운드 추천
```bash
leerness session close .             # 1.9.59+ — --suggest default 활성 (마감 + 다음 라운드 자동)
leerness session close . --no-suggest  # suggest 비활성 (이전 동작)

# 분리 호출도 가능:
leerness skill suggest .             # 1.9.53 — 반복 패턴 → 새 skill 후보
leerness drift check .               # 4 신호 + 4 레벨 점검
leerness audit . --fix               # 누락 메타 자동 보강
```

## 🧠 Memory CRUD Quick Reference (1.9.107~135)

5 Memory Surface 모두 CRUD CLI + MCP 노출 완성:

| Surface | CREATE | READ | DELETE | RESTORE |
|---|---|---|---|---|
| **tasks** | task add | task list --json (1.9.134) | task drop | task update |
| **decisions** | decision add | decision list --json | decision drop | memory restore decisions |
| **lessons** | lesson save | lesson list [--tag] | lesson drop | memory restore lessons |
| **plan** | plan add | plan list --json | plan remove | memory restore plan |
| **rules** | rule add | rule list --json | rule remove | (rule pause/resume) |

```bash
leerness memory status [--json]              # 5종 상태 통합 조회 (T/D/R/P/L 카운트)
leerness memory archive list [--surface s]   # DELETE archive 통합 조회 (복원 후보)
leerness memory restore <surface> <target>   # archive → active 복귀 (DELETE→RESTORE cycle, 1.9.128)
```

**잘못 저장한 항목 복구**:
1. `memory archive list` — 복원 후보 확인
2. `memory restore decisions "PostgreSQL"` — archive → active
3. handoff 가 매 세션 자동으로 24h 내 archive 활동 알림 (1.9.129)


- session close가 누락되면 다음 세션 시작 시 drift critical 발생.
- 자동 회복 옵션: `drift check --auto-fix` (critical 시 session close 자동 실행).
- 1.9.56+ handoff가 매 세션 시작 시 **과거 lessons 자동 재상기** (현재 task 키워드 기준).
- 1.9.67+ handoff가 현재 task와 매칭되는 **설치된 skill을 자동 추천** (jaccard 기반, default ON, `--no-skill-suggest`로 끄기).
- 1.9.67+ lessons 인덱스에 `task-log.md` 실패 라인까지 포함 → 회수 범위 확장.
- 1.9.69+ handoff가 `skill-suggestions.md` rolling history (과거 같은 키워드 매칭 결과)도 자동 노출.
- 1.9.76+ handoff에 보안 요약 1~2 line 자동 (`.env` ↔ `.env.example` 동기화 + `.gitignore` 시크릿 누락).
- 1.9.80+ `.env` 가 `.gitignore` 에 누락 시 🚨 CRITICAL + `LEERNESS_AUTO_SECURITY_FIX=1` 환경변수 시 `audit --fix` 자동 실행.
- 1.9.81+ handoff Date/Project 직후 통합 헤드라인 한 줄 (drift / 보안 / MCP / skill query / 설치 skill 수).
- 1.9.85+ `leerness health` 한 줄로 종합 점검 (drift + 보안 + skills + usage + tasks).
- 1.9.78/82+ `leerness drift check --auto-fix` 가 보안 신호 발견 시 `audit --fix` 자동 실행 → 재검사.
- 1.9.86+ MCP server **18 도구** (handoff/drift/audit/verify_claim/contract/agents/reuse/whats_new/usage_stats/session_close/skill_suggest/lessons/task_export/env_check/brainstorm/skill_match/skill_list/health).
- 1.9.94+ MCP server **21 도구** (skill_search/skill_info/benchmark 추가).
- 1.9.96+ `leerness handoff --json` (외부 AI/MCP 통합용 구조화 출력).
- 1.9.98+ `leerness skill publish` 보안 사전 점검 통합 (health 통과 후 publish).
- 1.9.99+ `leerness handoff --quiet` (자동화/CI 모드 — 자동 회수 라인 비활성).
- 1.9.100 🏆 마일스톤 — 30 라운드 자율 누적, stress-v45 30/30 PASS, e2e 219/219 PASS.
- 1.9.101+ `leerness lazy detect --json` + MCP **22 도구** (`leerness_lazy_detect` 추가 — 거짓 완료/empty handoff/no test run/TODO 미추적 신호 JSON).
- 1.9.102+ `leerness audit --json` 구조화 출력 (findings 11종 kind: design_dup/design_system_default/reuse_map_empty/milestone_unlinked/handoff_not_generated/current_state_stale/readme_version_mismatch/npm_cve/gitignore_missing_secrets/env_keys_missing/strict_promoted). MCP `leerness_audit`도 JSON 자동.
- 1.9.103+ `leerness session close --json` 마감 통계 JSON (taskCounts/rules/skillCandidates/drift/topCommands/mcpStats/workspacePeers). MCP `leerness_session_close`도 JSON 자동.
- 1.9.104+ MCP **23 도구** (`leerness_retro` 추가 — 4세션 누적 회고 JSON 외부 AI 노출).
- 1.9.105+ MCP **24 도구** (`leerness_task_add` 추가 — 외부 AI 가 task 즉시 등록, 양방향 제어 완성).
- 1.9.106+ MCP **25 도구** (`leerness_task_update` 추가 — task 상태/evidence/nextAction 갱신, read+add+update 3종 surface 완성).
- 1.9.107+ MCP **26 도구** (`leerness_task_drop` 추가 — task 폐기, **task CRUD 완성**: read/add/update/drop).
- 1.9.108+ `leerness decision add` CLI + MCP **27 도구** (`leerness_decision_add` — decisions.md 영구화 + handoff lessons 회수와 통합).
- 1.9.109+ `leerness rule list --json` + MCP **29 도구** (`leerness_rule_add` + `leerness_rule_list` — 자연어 영구 룰 R/W).
- 1.9.110+ MCP **30 도구 🎉 30 도구 마일스톤** (`leerness_plan_add` — plan.md milestone + progress-tracker 자동 동기화).
- 1.9.112+ MCP **31 도구** (`leerness_lesson_save` — lessons.md 직접 write, **Memory Write Surface 5종 완성**: tasks/decisions/rules/plan/lessons).
- 1.9.113+ handoff 통합 헤드라인에 **🧠 mem T/D/R/P/L 카운트** 추가 — 5종 메모리 영구화 상태 한눈에 확인.
- 1.9.114+ `leerness memory status [--json]` + MCP **32 도구** (`leerness_memory_status`) — 상세 상태 + 최근 항목 조회.
- 1.9.115+ `leerness handoff --json` 응답에 **`memorySurface` 필드 통합** — 단일 호출로 컨텍스트 + 5종 메모리 상태 동시 회수.
- 1.9.116+ `leerness brainstorm` 회수 범위에 **lessons.md + plan.md** milestone 추가 — Memory Surface 5종 완전 통합.
- 1.9.117+ `leerness lesson list [--tag] [--json]` + MCP **33 도구** (`leerness_lesson_list`) — lessons.md 전용 조회 + tag 필터.
- 1.9.118+ `leerness decision list [--json]` + MCP **34 도구** (`leerness_decision_list`) — decisions.md 전체 조회 (Decision/Reason/Alternatives/Impact 메타).
- 1.9.119+ `leerness plan list [--json]` + MCP **35 도구** (`leerness_plan_list`) — plan.md milestone 전체 (Status/Progress/Tasks). **Memory Surface READ 5종 완전 완성**.
- 1.9.121+ handoff 6번째 자동 회수 `🆕 최근 24h 메모리 변동` — 5종 surface 의 24h 내 추가 항목 자동 노출.
- 1.9.122+ `session close --json` 응답에도 `memorySurface` 필드 통합 — 마감 시 5종 메모리 상태 동시 회수.
- 1.9.123+ `health --json` 응답에도 `memorySurface` 필드 통합 — handoff/session close/memory status 모든 JSON 명령 일관성.
- 1.9.124+ `leerness lesson drop <target>` + MCP **36 도구** (`leerness_lesson_drop`) — 잘못 저장한 lesson 제거 (archive 자동 보존).
- 1.9.125+ `leerness decision drop <target>` + MCP **37 도구** (`leerness_decision_drop`) — 잘못 저장한 결정 제거 (archive 보존).
- 1.9.126+ `leerness plan remove <M-XXXX|title>` + MCP **38 도구** (`leerness_plan_remove`) — milestone 영구 제거 (archive 보존). **Memory Surface DELETE 5종 완전 완성** 🎉.
- 1.9.127+ `leerness memory archive list [--surface decisions|lessons|plan] [--json]` + MCP **39 도구** (`leerness_memory_archive_list`) — DELETE 5종 archive 통합 조회 (복원 후보 회수).
- 1.9.128+ `leerness memory restore <surface> <target>` + MCP **40 도구 🎉** (`leerness_memory_restore`) — archive → active 복귀 (DELETE→RESTORE cycle 완성). **MCP 40 도구 마일스톤**.
- 1.9.129+ handoff **7번째 자동 회수** — `🗑 최근 24h archive` (D/L/P 카운트 + 복원 후보 안내). DELETE 활동 자동 인지.
- 1.9.130+ 🎉 **60 라운드 자율 모드 마일스톤** — JSON 4종 (handoff/memory status/session close/health) `memorySurface.archive` 필드 통합. MCP 40 / handoff auto-recovery 7 / DELETE-RESTORE cycle 완성.
- 1.9.131+ `brainstorm` 회수 범위에 3 archive 파일 (decisions/lessons/plan archive) 통합 — 과거 제거된 ideas 가 새 brainstorm 시 다시 후보로 노출. `hits.archive` 필드 + 복원 안내 라인.
- 1.9.132+ `session close` 텍스트 모드에 archive 누적 라인 추가 — 마감 시점 DELETE 활동 가시화 (handoff 7번째 회수와 symmetric). archive 가시성 6 surface 완성.
- 1.9.133+ `brainstorm` 텍스트 모드 lessonsExplicit / planMilestones display 추가 — 1.9.116에서 데이터 수집은 했지만 display 누락된 pre-existing gap fix.
- 1.9.134+ `leerness task list --json` + MCP **41 도구** (`leerness_task_list`) — progress-tracker.md task 전체 JSON 조회 + `--status` 필터. Task surface CRUD MCP 완전 완성 (add/list/update/drop).
- 1.9.135+ MCP **42 도구** (`leerness_rule_remove`) — rules.md 에서 특정 rule 제거 + archive 보존. **5 surface CRUD MCP 완전 완성** (task/decision/lesson/plan/rule 모두 add/list/delete MCP 노출).
- 1.9.136+ MCP `leerness_drift_check` JSON 응답 fix — `--json` 플래그 자동 추가하여 외부 AI가 구조화된 drift 신호 회수 (score, level, signals[], healthy).
- 1.9.137+ `.harness/session-workflow.md` 템플릿에 **🧠 Memory CRUD Quick Reference** 섹션 추가 — 5 surface × CRUD 매트릭스 + archive cycle 워크플로 가이드. 신규 `init` 워크스페이스 즉시 적용.
- 1.9.138+ `leerness memory archive list --query <keyword>` + MCP `leerness_memory_archive_list` query 인자 — archive 항목 키워드 case-insensitive 검색 (target/originalHeader 매칭).
- 1.9.139+ `leerness lesson list --query` + `leerness decision list --query` + MCP 동일 인자 — active Memory 항목 키워드 검색 (lesson: text/tag, decision: title/decision/reason/alternatives/impact).

## 🚀 1.9.140~170 — 31 라운드 자율 누적 (Feature Graph → Bridge → REPL 진화)

- 1.9.140+ release `sync-main` 자동 — release/X.Y.Z 푸시 후 main 브랜치 자동 머지 + push. **31 라운드 연속 main 자동 push** (1.9.140~170).
- 1.9.141~143 **Feature Causality Graph** — `feature_graph.md` 신규 surface. `feature add/link/list` + MCP CRUD (44~46). handoff/health/drift JSON에 `featureGraph` 필드 통합.
- 1.9.144+ ASCII 배너 1초 hold + "검수·기억·샌드박스 통합 자율 AI 에이전트" 문구 (사용자 명시).
- 1.9.145+ `leerness env detect` — OS/하드웨어/Node/도구 PATH/scripts.deps 자동 감지 + 변동 추적 (.harness/env-snapshot.json). MCP **47 도구** `leerness_env_detect`. "X은(는) 내부 또는 외부 명령... 아닙니다" 사전 방지.
- 1.9.146+ **CLI 에이전트 모드** — `leerness agent [--repl|--interactive] [--provider P] [--model M] [--role r]`. 3-tier 권한 시스템 (`permissions: basic/extended/full`, `.harness/permissions.json`). `leerness permissions list|set` CLI.
- 1.9.147+ 자동 유지보수 — webhook 수신, incident 자동 등록, `.harness/credentials.local.json` (env 이름만, 실 값 미저장).
- 1.9.149+ **REPL agent** (`leerness agent`) — multi-provider (ollama/claude/codex/gemini/copilot) 세션 관리, observability lite (`.harness/runs/*.jsonl`, kind: agent_repl_turn/cli/slash).
- 1.9.150+ **Sandboxing `runCommandSafe`** — cwd jail + shell:false + env scrub + timeout + permissions allowList. 모든 외부 명령 spawn 통합 wrapper. REPL slash-commands (`:verify :audit :handoff :health`).
- 1.9.151~154 REPL UX — install 복수선택 agents, `.env` 직접 마이그레이션 (`.env.example` 폐기), multi-provider REPL 진입 흐름 + provider 사전 ready 검증.
- 1.9.155+ REPL `:model` 모든 provider 지원, `:status` 명령, model catalog 제공.
- 1.9.156+ **`agents multi --execute`** — `_dispatchSpawn` 실 spawn + multi-signal consensus (0.4×tokens + 0.4×overlap + 0.2×lengthFit) → `.harness/agents/multi-runs/*.json`.
- 1.9.157~159 **Provider Registry** (`.harness/providers.json`) — `provider list/add/remove/sync`. 사용자 정의 CLI provider 동적 추가 (OpenRouter/Bedrock/Groq 등). MCP **48~50** (list/add/remove). 🎉 **MCP 50 도구 마일스톤**.
- 1.9.160 🎉 **90 라운드 자율 마일스톤** + `provider sync` (외부 catalog 자동 동기화).
- 1.9.161+ REPL slash 4종 추가 — `:lessons [query]`, `:brainstorm <topic>`, `:tasks`, `:plan` (Memory Surface 즉시 조회).
- 1.9.162+ handoff 통합 헤드라인 9번째 요소 — REPL slash 24h 사용량 (`.harness/runs/*.jsonl` 집계).
- 1.9.163+ `leerness health` 에 **5능력 매트릭스 자동 평가** 통합 (webAutomation/pcAutomation/multiAgentOrchestration/replMultiProvider/mcpTools) — overallScore + production-ready/beta-ready/mvp 라벨.
- 1.9.164+ **`leerness which`** 진단 명령 — 현재 실행 경로 / npm 글로벌 root / cache / PATH 후보 / 자동 진단 (구버전 충돌 해결, 사용자 명시).
- 1.9.165+ **`leerness web check|screenshot|extract`** — playwright bridge MVP (opt-in: `npm i -g playwright` + `permissions.browser`). `_tryLoadPlaywright()` + try-catch require. 5능력 #1 보강 (웹 자동화 5% → 50%).
- 1.9.166+ **`leerness pc check|click|type|screenshot`** — robotjs/@nut-tree/nut-js bridge MVP (opt-in, ⚠ full 모드 권장). `_tryLoadPCAutomation()` + 두 라이브러리 분기 (robotjs sync / nut-js async). 5능력 #2 보강 → **🎉 production-ready 76% 첫 도달**.
- 1.9.167+ **`leerness lsp check|symbols|references`** — TypeScript Compiler API opt-in + 정규식 fallback (function/class/interface/type/enum). 6번째 영역 **codeIntel** 신설 (5→6능력 매트릭스).
- 1.9.168+ **MCP Bridge 3종 노출** — `leerness_web/leerness_pc/leerness_lsp` (50→53 도구). 외부 AI (Claude/Codex/Gemini/Copilot)가 leerness 의 웹/PC/LSP 자동화 능력을 **직접 호출**. **🎉 MCP 53 도구 마일스톤**.
- 1.9.169+ **Hotfix** — `_collectWorkspacePaths()` `--include` 명시 시 cwd 자동 추가 안 함 (explicit-only). 누적 `Temp/.harness` 잔존으로 인한 e2e flake 영구 해결.
- 1.9.170+ 🎉 **100 라운드 자율 마일스톤** + 사용자 명시 2종:
  - **Tab/Shift+Tab cycle** — provider/model 빠른 전환 (readline keypress). 빌트인 5종 + `.harness/providers.json` 사용자 정의 통합.
  - **실시간 스트리밍** (`:stream on|off`, default ON) — `_cliChatStream()` + `cp.spawn(stdio:pipe)`. Claude `--output-format=stream-json --verbose` → `content_block_delta`/`thinking_delta` 파싱. 추론중/diff/thinking 실시간 표시.
  - 실제 모델 catalog 확장: claude-opus-4-7 (1M ctx), claude-sonnet-4-7, gpt-5.5, gpt-5.4, gpt-5-codex, gemini-2.5-pro/flash, gemini-3.0-pro, deepseek-coder-v2.

---

## 빠른 체크리스트

세션 끝나기 전 다음이 모두 ✓이어야 한다:
- [ ] plan/progress-tracker에 이번 라운드 task 등록됨 (또는 task sync)
- [ ] 모든 done 항목에 evidence 첨부됨 (verify-claim PASS)
- [ ] sub-agent 사용 시 contract verify PASS
- [ ] drift 점수 ≤ 30 (attention 이하) — `leerness drift check` (1.9.78: 5신호 + 보안)
- [ ] session close 호출됨
- [ ] (1.9.85+) `leerness health`로 종합 점검 — drift + 보안 + skill + MCP + tasks
- [ ] (1.9.75/76+) `.env` 사용 중이면 `.gitignore` 시크릿 패턴 OK + `.env.example` 동기화
- [ ] (1.9.80+) 보안 critical 시 `LEERNESS_AUTO_SECURITY_FIX=1` 또는 `audit --fix`로 자동 회복

## Anti-pattern (drift 신호)

- ⚠ "작업 끝났으니 보고만 하고 끝" → session close 누락 → 다음 세션 drift critical
- ⚠ "TodoWrite만 갱신하고 leerness 안 씀" → `task sync --from` 또는 `task add` 필수
- ⚠ sub-agent 분배 시 파일 경로 미명시 → 동시 쓰기 충돌
- ⚠ "테스트 돌렸으니 PASS" 자기 보고만 → verify-claim --run-tests 미실행
- ⚠ contract verify 생략 → 사양 불일치 BUG가 사용자에게 노출
