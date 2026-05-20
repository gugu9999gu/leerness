# Leerness

> **AI 코딩 에이전트의 거짓 완료·중복·망각·충돌을 막아주는 검수·기억·협업 CLI 하네스.**

[![npm](https://img.shields.io/badge/npm-leerness-blue)](https://www.npmjs.com/package/leerness) [![version](https://img.shields.io/badge/version-1.9.148-green)]() [![tests](https://img.shields.io/badge/e2e-219%2F219-success)]() [![mcp](https://img.shields.io/badge/MCP--tools-47-blue)]() [![json](https://img.shields.io/badge/--json-20_commands-blueviolet)]() [![rounds](https://img.shields.io/badge/autonomous--rounds-78-blueviolet)]() [![main-push](https://img.shields.io/badge/release--main--push-auto-success)]() [![multi-runtime](https://img.shields.io/badge/verify--code-node%2Fpython%2Fgo%2Frust-success)]() [![agent-roles](https://img.shields.io/badge/agent--roles-planner%2Freviewer%2Factor-success)]() [![license](https://img.shields.io/badge/license-MIT-lightgrey)]()

```
  ╔══════════════════════════════════════════════════════════════╗
  ║  ██╗     ███████╗███████╗██████╗ ███╗   ██╗███████╗███████╗  ║
  ║  ██║     ██╔════╝██╔════╝██╔══██╗████╗  ██║██╔════╝██╔════╝  ║
  ║  ██║     █████╗  █████╗  ██████╔╝██╔██╗ ██║█████╗  ███████╗  ║
  ║  ██║     ██╔══╝  ██╔══╝  ██╔══██╗██║╚██╗██║██╔══╝  ╚════██║  ║
  ║  ███████╗███████╗███████╗██║  ██║██║ ╚████║███████╗███████║  ║
  ║  ╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝  ║
  ║  v1.9.148  AI Agent Reliability Harness                      ║
  ║  verify · remember · orchestrate · audit · prevent drift     ║
  ╚══════════════════════════════════════════════════════════════╝
```

---

## leerness는 무엇인가요?

Claude Code · Cursor · Copilot · Codex · Gemini CLI 같은 **AI 코딩 에이전트와 함께 일할 때 발생하는 구조적 문제**를 자동으로 막는 CLI 하네스입니다.

AI 에이전트는 빠르게 코드를 쓰지만, 다음 **5가지 함정**에 반복해서 빠집니다:

```
  1. 거짓 완료    — "구현했습니다"는데 코드에 변경이 없거나 테스트 미실행
  2. 중복 생성    — 이미 있는 함수를 다른 프로젝트에 또 만듦
  3. 망각         — 다음 세션에서 컨텍스트(plan/decisions)를 잃음
  4. 충돌         — 멀티 에이전트가 같은 파일을 동시에 써서 작업 손실
  5. 도구 drift  — 시간이 지날수록 메인 에이전트가 도구·메타파일을 잊음
```

leerness는 이 5가지를 모두 **자동으로 감지·차단·회복**합니다.

---

## 어떻게 작동하나요?

### 1. 워크스페이스에 4개 채널을 만듭니다

```
.harness/
├── plan.md              ← 무엇을 할 것인가
├── progress-tracker.md  ← 무엇을 했는가 (증거 포함)
├── decisions.md         ← 왜 그렇게 했는가
└── session-handoff.md   ← 다음 세션에 무엇을 전달하는가
```

이 4개 파일은 사용자 메모리로 보호됩니다. leerness가 자동 업데이트하지만, 사용자/AI가 직접 편집한 내용은 **항상 보존**됩니다.

### 2. AI가 작업할 때마다 자동 검증

```
AI: "T-0042 API 호출 구현 완료했습니다"
       ↓
leerness verify-claim T-0042 --run-tests
       ↓
  evidence 파일 확인 → 테스트 실제 실행 → URL 코드 매칭
       ↓
  ✓ 검증 통과     또는    ✗ "코드에 fetch 호출 흔적 없음 (confidence 0.85)"
```

### 3. 워크스페이스 전체에서 중복·관계 추적

```bash
leerness reuse-map --all-apps --strict-elements
  → escapeHtml in 3 projects (project-a:42, project-b:18, project-c:103)
  → useCart depends on AuthContext (cycle detected)
```

### 4. 다중 AI 에이전트 안전 협업

```bash
leerness agents list                         # claude/codex/gemini/copilot 상태
leerness agents dispatch "<task>" --to gemini --write   # 권장 플래그 자동 첨부
leerness agents bench "<task>"               # 3 CLI 동시 호출 + 시간/품질 비교
leerness contract verify SPEC.md src/x.js    # 사양 ↔ 구현 함수/필드 일치 검증
```

### 5. 도구 drift 자동 감지 (1.9.37+)

라운드가 길어지면 AI가 leerness를 "점점 안 쓰는" 현상을 자동 감지:

```bash
leerness drift check .
  → 🔴 critical (100/200) — session close 4.6일 누락, task update 3.6일 stale
  → 권장: leerness session close .
```

→ `handoff` 호출 시 inline 경고 자동, severe 시 `.harness/agent-reminders.md` 자동 생성.

---

## 60초 시작

```bash
# 1) 설치 + 초기화 (방향키/스페이스 인터랙티브)
npx leerness@latest init .

# 2) AI 세션 시작 — 컨텍스트 자동 적재
npx leerness handoff .

# 3) AI 작업 끝 — 증거 자동 검증
npx leerness verify-claim T-0001 --run-tests

# 4) 세션 마감 — 다음 세션 인계
npx leerness session close .
```

---

## 적용시 효과 — 정량 데이터

`leerness-bench` 28 프로젝트 124 task 측정 결과:

| 카테고리                 |                    적용 |       미적용 |           개선 |
| ------------------------ | ----------------------: | -----------: | -------------: |
| 다중 에이전트 효율       |                 100/100 |        3/100 |  **+97** |
| 자동 검수 (verify-claim) |                  98/100 |        0/100 |            +98 |
| 재사용 인식              |                 100/100 |        0/100 |           +100 |
| 워크스페이스 가시성      |                  99/100 |        0/100 |            +99 |
| 자동 BUG 감지            |                 100/100 |        0/100 |           +100 |
| 컨텍스트 유지            |                 100/100 |        0/100 |           +100 |
| **종합**           | **597/600 (99%)** | 3/600 (0.5%) | **+594** |

### 실제 작업 시간 절감

- **수동 검수 90s → 자동 1.5s** (`verify-claim --run-tests`)
- **워크스페이스 28 프로젝트 1 명령** (vs 112 개별 명령)
- **컨텍스트 적재 500자** (`handoff --compact`, AI 토큰 비용 90% 절감)

### 실제 BUG 자동 발견 사례

- **거짓 완료**: 5건 (모두 verify-claim에서 evidence 누락 감지)
- **사양 불일치**: rpg-replay에서 `tick.damage` vs `tick.amount` 필드명 충돌 자동 감지 (contract verify)
- **보안 위험**: `contract verify`가 require()로 임의 코드 실행 → 정적 분석으로 즉시 수정 (1.9.36)
- **drift**: 실 워크스페이스에서 4.6일 stale 자동 감지 → session close 1회로 70점 회복 (1.9.37/38)

---

## 어떤 함정을 어떻게 막나요?

| AI와 일할 때 함정                    | leerness 도구                                           | 효과                                      |
| ------------------------------------ | ------------------------------------------------------- | ----------------------------------------- |
| "완료했습니다"인데 코드 변경이 없음  | `verify-claim --run-tests`                            | 증거 파일 + 테스트 실제 실행 검증         |
| "API 호출 완료"인데 URL 코드 없음    | `optimism-check`                                      | 10 카테고리 패턴 + URL 매핑 + 신뢰도 점수 |
| 같은 함수를 여러 프로젝트에 중복     | `reuse-map --strict-elements`                         | 함수명 fuzzy 중복 감지                    |
| 다음 세션이 컨텍스트 잃음            | `handoff` 3채널 자동 적재                             | 500자 압축 (`--compact`)                |
| 표면적 코드 리뷰 (도메인 깊이 부족)  | `review --persona security,performance,ux`            | 도메인 sub-agent 자동 부여                |
| 외부 AI CLI 자동 호출 위험           | `agents list/dispatch/quota`                          | 환경변수 활성화 + 명시적 분배             |
| npx 캐시로 옛 버전 실행              | `_warnIfStale` 자동 (1.9.33+)                         | npm latest 자동 비교 + 경고               |
| 멀티 sub-agent 파일 충돌             | `agents dispatch` 안내 + 경로 격리                    | last-writer-wins 위험 사전 차단           |
| sub-agent마다 사양 해석 다름         | **`contract verify`**                           | 명세 ↔ 구현 함수/필드 자동 검사          |
| 신규 모듈 capability 미등록          | **`reuse autodetect`**                          | `module.exports` 정적 분석 + 자동 등록  |
| 라운드 길어지며 메인이 leerness 잊음 | **`drift check`** + `agent-reminders.md` 자동 | 4 신호 + 자동 reminder + 학습             |
| TodoWrite ↔ progress-tracker 분리   | **`task sync --from`** (1.9.38)                 | TodoWrite JSON 자동 import                |

---

## 핵심 명령

### 일상

```bash
leerness init [path] [--language ko|en]   # 신규 프로젝트 (방향키 multi-select)
leerness handoff [path] [--compact]        # 컨텍스트 적재 (drift 자동 경고)
leerness verify-claim T-XXX --run-tests   # 증거 + 실 테스트
leerness optimism-check T-XXX              # 낙관적 표시 감지
leerness audit [path] [--fix]              # 일관성 감사 (--fix: 자동 갱신)
leerness session close [path]              # 세션 마감
leerness drift check [path]                # drift 점수 + 4단계 레벨
leerness usage stats [path]                # 명령별 누적 카운터
```

### 워크스페이스 (멀티 프로젝트)

```bash
leerness handoff --all-apps                # 전 프로젝트 통합 뷰
leerness reuse-map --all-apps --strict-elements
leerness reuse autodetect [--apply]        # src/bin/lib/app 정적 스캔 + 등록
leerness contract verify <spec> <impl>      # 명세 ↔ 구현 검증
leerness deps <capability> --run-tests     # 영향 추적 + 자동 회귀
leerness retro --all-apps --days 7         # 회고
leerness insights --all-apps                # 통계
leerness task sync --from <todo.json>      # TodoWrite import
```

### 외부 AI CLI · 멀티 에이전트

```bash
leerness setup-agents                       # 인터랙티브 활성화 + 자동 설치
leerness agents list / check / quota       # 상태/한도
leerness agents dispatch "<task>" --to gemini --write
leerness agents bench "<task>"             # 3 CLI 동시 호출 + 비교표
```

### 페르소나·리뷰

```bash
leerness persona list / show <id> / add <id>
leerness review <file> --persona security,performance,ux
```

### Agent Skills 표준 (1.9.42, agentskills.io 호환)

```bash
# Claude Code/Cursor/Copilot/Codex/Gemini CLI/Hermes Agent 등 30+ 도구와 스킬 공유
leerness skill install <url-or-path>             # SKILL.md 다운로드/import
leerness skill discover --query "<task>"         # 매칭 추천 (opt-in)
leerness skill export <id> [--out <dir>]         # 자체 skill → 표준 SKILL.md 변환
leerness skill export-all [--out <dir>]          # 1.9.43 9개 자체 skill 일괄 SKILL.md export
```

### MCP Server — leerness 도구를 메인 에이전트의 sub-tool로 (1.9.43)

```bash
leerness mcp serve   # stdio JSON-RPC로 leerness 도구 10종 노출
```

Claude Code · Hermes · Cursor 등이 `.mcp.json`에 등록하면 메인 에이전트가 leerness 검수를 sub-tool로 호출 가능:

```json
{
  "mcpServers": {
    "leerness": {
      "command": "npx",
      "args": ["leerness", "mcp", "serve"]
    }
  }
}
```

노출 도구 10종: `leerness_handoff` · `leerness_drift_check` · `leerness_audit` · `leerness_verify_claim` · `leerness_contract_verify` · `leerness_agents_list` · `leerness_reuse_map` · `leerness_whats_new` · `leerness_usage_stats` · `leerness_session_close`

opt-in 설정 (`.env`):
```bash
LEERNESS_SKILL_DISCOVER_URL=https://agentskills.io/llms.txt  # 또는 자체 카탈로그 URL
LEERNESS_SKILL_AUTO_DISCOVER=0                                 # 1=요청 자동 추천
```

> ❌ leerness는 외부 URL을 자동 fetch하지 않습니다. `LEERNESS_SKILL_DISCOVER_URL` 설정 또는 `--source` 명시 후에만 호출.

### 보안·인코딩

```bash
leerness scan secrets .       # AWS/GitHub/OpenAI/Anthropic/Google/Slack/PEM
leerness encoding check .     # BOM/UTF-16/한글 라운드트립
leerness lazy detect .        # 증거 없는 done · 빈 handoff · 추적 없는 TODO
leerness gate [path]          # verify + audit + scan + encoding + lazy 통합
```

### 버전 관리

```bash
leerness update --check       # 24h 캐시로 새 버전 감지
leerness update --yes         # 자동 마이그레이션 + 검증
```

---

## 사용 시나리오

### 시나리오 1: AI에게 작업 시키고 거짓 완료 검증

```bash
# AI에게 작업 지시 후
leerness verify-claim T-0042 --run-tests --strict-claims
# → evidence 파일 존재 + 실제 npm test 실행 + 낙관적 표시 자동 감지
# → 거짓이면 exit 1, 진짜면 진행
```

### 시나리오 2: 멀티 AI 에이전트 협업

```bash
# 1) 외부 CLI 활성화
leerness setup-agents .  # 방향키로 claude/codex/gemini 선택

# 2) 같은 task를 3 CLI에 동시 호출 → 비교
leerness agents bench "rpg-core/combat.js useSkill 함수 한 줄 요약"
#  | claude | 7s  | "..." |  ← 가장 빠름
#  | codex  | 21s | "..." |  ← 가장 상세
#  | gemini | 19s | "..." |  ← 중간

# 3) 작업 유형별 최적 CLI에 분배
leerness agents dispatch "파일 생성" --to gemini --write
#  → --yolo 자동 첨부, 안전 규칙 안내
```

### 시나리오 3: 라운드가 길어지며 drift 감지

```bash
# 며칠 후 새 세션 시작
leerness handoff .
#  ⚠ leerness drift 감지 — 메타파일이 stale합니다
#     session-handoff.md: 4.6일 stale
#     → 권장: leerness session close .

# 권장 명령 1회 실행으로 회복
leerness session close .
# 🔴 critical (100/200) → 🟠 attention (30/200)
```

### 시나리오 4: TodoWrite ↔ leerness 동기화

```bash
# Claude Code의 TodoWrite를 JSON으로 export 후
leerness task sync --from /path/to/todos.json
# → completed → done, in_progress → in-progress, pending → planned로 자동 mirror
```

---

## 디렉토리 구조

```
.harness/
├── plan.md · progress-tracker.md · current-state.md · session-handoff.md
├── decisions.md · task-log.md · review-evidence.md · guideline.md
├── architecture.md · context-map.md · feature-contracts.md · reuse-map.md
├── design-system.md · consistency-policy.md · writeback-policy.md
├── anti-lazy-work-policy.md · secret-policy.md · encoding-policy.md
├── protected-files.md · guardrails.md · language-policy.md
├── orchestrate-log.md · llm-bench-history.md (1.9.22+)
├── skill-index.md · skills/<id>/ · templates/
├── personas/<id>.md (1.9.29+, 사용자 정의 페르소나)
├── reviews/ (1.9.29+, 페르소나 리뷰 결과)
├── cache/
│   ├── update-check.json (1.9.33+)
│   └── usage-stats.json (1.9.38+ 명령 카운터)
└── agent-reminders.md (1.9.38+, drift critical 시 자동 생성)

.claude/ (commands · skills · settings.local.json)
.cursor/rules/leerness.mdc
.github/copilot-instructions.md
AGENTS.md · CLAUDE.md
```

---

## 환경변수

| 변수                                            | 효과                                 |
| ----------------------------------------------- | ------------------------------------ |
| `LEERNESS_OFFLINE=1`                          | npm 호출 스킵 (오프라인)             |
| `LEERNESS_OLLAMA_BASE_URL`                    | orchestrate opt-in (1.9.22+)         |
| `LEERNESS_ENABLE_CLAUDE/CODEX/GEMINI/COPILOT` | 외부 CLI 활성화 (1.9.30+)            |
| `LEERNESS_NO_BANNER`                          | ASCII 배너 스킵 (1.9.32+)            |
| `LEERNESS_NO_PROMPT`                          | readline prompt 비활성 (1.9.32+)     |
| `LEERNESS_NO_STALE_CHECK`                     | npx 옛 버전 경고 끄기 (1.9.33+)      |
| `LEERNESS_NO_INTERACTIVE`                     | 방향키 multi-select 비활성 (1.9.34+) |
| `LEERNESS_NO_DRIFT_CHECK`                     | drift 자동 경고 끄기 (1.9.37+)       |

---

## Claude Code / Cursor / Copilot 통합

설치 시 자동 등록:

- `.claude/commands/{handoff, session-close, audit, lazy-detect, update}.md`
- `.claude/skills/leerness.md` (스킬 정의)
- `.claude/settings.local.json` (SessionStart hook = `update --check`)
- `.cursor/rules/leerness.mdc` · `.github/copilot-instructions.md`
- `AGENTS.md` · `CLAUDE.md`

---

## 자연어 트리거

| 사용자 발화                             | 자동 실행                                   |
| --------------------------------------- | ------------------------------------------- |
| "회고해줘 / 돌아보자"                   | `leerness retro`                          |
| "최근 N일 회고"                         | `leerness retro --days N`                 |
| "통계 / 누적 지표"                      | `leerness insights`                       |
| "X 관련 자료 / X 시작 전 검토"          | `leerness brainstorm "X"`                 |
| "매 X마다 Y를 해줘"                     | `leerness rule add "Y" --trigger every-X` |
| "외부 CLI 설정"                         | `leerness setup-agents`                   |
| "drift 점검 / leerness를 잘 쓰고 있나?" | `leerness drift check`                    |

`AGENTS.md`에 자동 등록 — AI 에이전트가 자연어를 명령으로 변환.

---

## 설치 시 함정 주의

### `@latest` 명시 권장

```bash
# ❌ npx 캐시로 옛 버전 실행 가능
npx leerness init .

# ✅ 항상 최신 받음
npx leerness@latest init .

# ✅ 캐시 의심 시
npx --yes clear-npx-cache && npx --yes leerness@latest init .
```

1.9.33+ 부터 `leerness init` 시 npm latest와 자동 비교 → 옛 버전 경고.

---

## FAQ

**Q. leerness가 코드를 변경하나요?**
A. 사용자 메모리(plan/progress/decisions 등)는 **항상 보존**. 관리 인스트럭션은 머지 + preserved 블록 보존. 모든 변경 전 `.harness/archive/`에 자동 백업.

**Q. AI 에이전트 없이 사용 가능한가요?**
A. 네. 1인 개발자도 자기 자신의 작업 검증·기억·중복 감지에 활용 가능. `verify-claim` / `audit` / `reuse-map`은 모두 AI 무관.

**Q. CI에서 사용 가능?**
A. 네. 모든 명령이 exit code + `--json` 출력 + `--yes` 비대화형 지원. 임의 `LEERNESS_NO_*` env로 prompt 강제 비활성.

**Q. 외부 AI CLI를 자동 호출하나요?**
A. **절대 아니요.** `agents dispatch`는 명령 텍스트만 생성합니다. 사용자/메인이 명시적으로 spawn.

**Q. 멀티 언어 프로젝트는?**
A. 영어 인스트럭션 옵션 (`--language en`). 단 도구 출력 메시지/안내는 한국어가 풍부합니다.

---

## E2E

```bash
npm test     # = node ./scripts/e2e.js
```

**174/174 시나리오** 통과 (1.9.7~1.9.38 회귀 + 신규 검증).

---

## 변경 이력 (최근)

- **1.9.99** — **`leerness handoff --quiet` 옵션** — 자동 회수 라인 6종 모두 비활성, 기본 컨텍스트만. CI/자동화용.
- **1.9.98** — **`leerness skill publish` 보안 사전 점검** — `health` 자동 실행, issue 있으면 publish 중단. `--force`/`--no-security-check`로 우회.
- **1.9.97** — **자율 모드 27 라운드 마무리** (1.9.70~96) — MCP 도구 12→21개, handoff 5단 통합, 보안 3중 가드, JSON 9종, 매 라운드 e2e PASS.
- **1.9.96** — **`leerness handoff --json` 옵션** — 외부 AI/MCP에 handoff 데이터를 구조화 JSON으로 출력.
- **1.9.95** — **`leerness lessons --json` + MCP lessons 자동 JSON** — 외부 AI가 lessons 결과를 파싱 친화적으로 받음.
- **1.9.94** — **MCP server 21번째 도구 `leerness_benchmark`** — 1.9.46/51 benchmark를 외부 AI에 노출 (6 차원 점수 + 검수 시나리오 결과).
- **1.9.93** — **handoff 헤드라인에 health 종합 상태 1 토큰 추가** — `⚕ health: ✓/⚠` (1.9.81 + 1.9.85 통합, inline 추론으로 성능 비용 없음).
- **1.9.92** — **`skill info --json` + MCP 20번째 도구 `leerness_skill_info`** — 외부 AI가 개별 skill 상세 (능력/소스/패턴/사용 이력) 정확 파악.
- **1.9.91** — **MCP server 19번째 도구 `leerness_skill_search`** — 1.9.90 skill search를 외부 AI에 노출.
- **1.9.90** — **`leerness skill search <capability>` 새 명령** — capability 배열 부분 일치 검색 (skill match와 다른 정확 매칭). `--json` 옵션.
- **1.9.89** — **자율 모드 19 라운드 종합 검증** — stress-v35 24/24 PASS + handoff 692ms / health 689ms (회귀 없음). 자율 모드 (1.9.70~88) 안정 완료.
- **1.9.88** — **`handoff`에 brainstorm 자동 hits 노출** — 현재 task 키워드로 자동 호출 → decisions / lessons / task-log fail / skill 미리보기 1줄씩 (1.9.72 brainstorm 통합).
- **1.9.87** — **`session-workflow.md` 템플릿 갱신** — 1.9.69~86 누적 신규 기능 안내 추가 (handoff history hit / 보안 요약 / CRITICAL / 헤드라인 / health / drift --auto-fix 보안 / MCP 18 도구). init 가이드 정확성 보장.
- **1.9.86** — **MCP server 18번째 도구 `leerness_health`** — 1.9.85 health 종합 헬스 체크를 외부 AI에 노출. drift + 보안 + skill + MCP + tasks 한 호출.
- **1.9.85** — **`leerness health` 새 명령** — drift + 보안 + skill + MCP + 누적 통계 종합 헬스 체크. `--json` / `--strict` 옵션.
- **1.9.84** — **MCP server 17번째 도구 `leerness_skill_list`** — 외부 AI에 skill 카탈로그 (id/이름/출처/능력/사용 횟수) 조회 노출. `skill list --json` 옵션도 함께 추가.
- **1.9.83** — **MCP server 16번째 도구 `leerness_skill_match`** — 1.9.45/50/68 skill match를 외부 AI에 노출. rolling history 자동 누적.
- **1.9.82** — **`drift check --auto-fix` 보안 회복 통합** — 1.9.78 보안 신호 발견 시 `audit --fix` 자동 실행 → `.gitignore` + `.env.example` 동기화 후 재검사. 보안 + 세션 마감 한 번에 자동 회복.
- **1.9.81** — **`handoff` 통합 헤드라인** — drift level + 보안 상태 + MCP 활동 + skill query + 설치 skill 수를 한 줄로 압축. AI가 세션 시작 즉시 워크스페이스 상태 인지.
- **1.9.80** — **handoff 보안 critical 자동 회복** — `.env` 가 `.gitignore` 에 없으면 🚨 CRITICAL 경고 + `LEERNESS_AUTO_SECURITY_FIX=1` 시 `audit --fix` 자동 실행.
- **1.9.79** — **`leerness skill suggest` 알고리즘 강화** — 1.9.68 rolling history 빈도 (×2 가중) 추가. 반복 검색된 키워드를 신규 skill 후보로 자동 식별 (Hermes-style 학습).
- **1.9.78** — **`drift check` 5번째 신호** — `.env` + `.gitignore` 보안 누락을 drift score에 가중 (`.env` 자체 누락 시 +30, 동기화 누락 +15). 보안 위험이 drift critical 승격 가능.
- **1.9.77** — **MCP server 15번째 도구 `leerness_brainstorm`** — 1.9.72 brainstorm (decisions + skills + tasks + rules + evidence + lessons + skillHistory + taskLogFails)을 외부 AI에 노출. AI가 새 작업 시작 전 누적 컨텍스트 자동 회수.
- **1.9.76** — **`leerness handoff`에 보안 상태 요약 자동 표시** — `.env→.env.example` 누락 + `.gitignore` 시크릿 패턴 누락을 매 handoff에 1-2 line 자동 노출. AI가 세션 시작 즉시 보안 위험 인지.
- **1.9.75** — **`leerness audit` 보안 강화** — `.env` 존재 시 `.gitignore`에 시크릿 패턴 (`.env`/`.env.local`/`.env.production`/`*.pem`/`credentials.json`) 자동 검증, `--fix`로 자동 추가.
- **1.9.74** — **`session close` 마감 시 누적 회고 통계 강화** — MCP tools/call 카운트 + skill match query top + drift 통계를 자동 요약 (1.9.70 + 1.9.68 결합).
- **1.9.73** — **MCP server 14번째 도구 `leerness_env_check`** — 1.9.71 env 보안 검사를 외부 AI에 노출 (외부 워크스페이스 .env/.env.example 동기화 자동 점검).
- **1.9.72** — **`leerness brainstorm`에 skill-suggestions.md history + task-log 실패 라인 통합** — 누적 컨텍스트 기반 brainstorm 강화 (이전 매칭 이력 + task-log 실패 회수).
- **1.9.71** — **`.env` / `.env.example` 자동 동기화** — `leerness env check` / `env sync` 명령 + `audit` 통합 (`--fix`로 누락 키 자동 추가). 보안 정책: 실제 값 절대 노출 안 함 (키만 추가, 값은 빈 문자열).
- **1.9.70** — **MCP server `tools/call` 자동 사용 통계** — 도구별 호출 카운트 (`.harness/cache/usage-stats.json#mcp.tools`) + `leerness usage stats` 출력에 MCP 섹션 + 드물게 호출되는 도구 식별.
- **1.9.69** — **handoff에 skill-suggestions.md history hit 노출** (fuzzy 매칭, 최근 2건 + top 2 매치). AI가 이전 세션 결정을 일관 유지. mtime 기반 캐시 (1.9.65/66/67 캐시 패밀리 연속).
- **1.9.68** — **`skill match` 결과 → `.harness/skill-suggestions.md` rolling history 자동 누적** (AI가 다음 세션에 이전 추천 참조 가능). `--no-save` / `LEERNESS_NO_SKILL_HISTORY=1`로 끄기.
- **1.9.67** — **handoff 자동 skill 추천 default ON** (jaccard 매칭) + lessons 인덱스에 task-log.md 실패 라인 통합 (회수 범위 확장).
- **1.9.66** — **성능 최적화 2차 + MCP 13번째 도구**. `listAllSkills` 메모리 캐시 (skill list/info/match/discover/suggest 공유) + MCP `leerness_task_export` 추가 (TodoWrite 양방향 sync 외부 노출).
- **1.9.65** — **성능 최적화 1차** — usage-stats 메모리 캐시 + lessons 인덱스 캐시 (mtime invalidation). handoff -37% · drift -19% · audit -29% · skill list -17% · 100-task handoff -42% · status -48% (vs 1.9.64).
- **1.9.64** — `leerness install <SKILL.md>` 별칭 (skill install 단축) · **성능 벤치마크 1차 실측** (status/handoff/drift/audit/skill list 평균 1.2~1.5초).
- **1.9.63** — `leerness audit --strict [--threshold N]` — CI 친화 옵션 (warnings → failures 승격).
- **1.9.62** — `leerness audit` npm CVE 자동 감지 (npm audit --json 통합, OFFLINE/no-npm-audit 스킵).
- **1.9.61** — MCP server cursor 기반 페이지네이션 — `nextCursor` + `_chunkSize` override.
- **1.9.60** — `leerness task export` — progress-tracker → TodoWrite JSON 형식. **양방향 sync 완성** (1.9.38 sync + 1.9.60 export).
- **1.9.59** — `session close` **--suggest default 활성** (잊을 단계 없음, `--no-suggest`로 비활성 가능) · 설치 가이드 갱신.
- **1.9.58** — handoff lessons **fuzzy 매칭** (어간 변형, 복합어, decisions.md 매칭 추가).
- **1.9.57** — `session close --suggest` (마감 시 skill suggest + drift + 명령 통계 통합 보고) · install banner quickStart + session-workflow.md 갱신 (1.9.56/57 흐름 자동 안내).
- **1.9.56** — `handoff`에 lessons 자동 재상기 통합 (현재 in-progress task 키워드 매칭 → 과거 실패 자동 표시).
- **1.9.55** — MCP server에 `leerness_skill_suggest` + `leerness_lessons` 추가 (10 → 12 도구) · lessons --auto의 stopword 확장 (false positive 차단).
- **1.9.54** — `leerness lessons --auto` — 최근 in-progress task에서 키워드 자동 추출 → 과거 lessons 자동 매칭·재상기.
- **1.9.53** — `leerness skill suggest` — task-log / progress-tracker / usage-stats에서 반복 패턴 **자동 감지 → 새 skill 후보 제안** (Hermes-style 자동 학습의 leerness 버전).
- **1.9.52** — `skill discover` 카탈로그 형식 다양성 — JSON manifest / RSS·Atom / Markdown / llms.txt URL 4 형식 자동 감지 (`_parseSkillCatalog`).
- **1.9.51** — `benchmark --scenario <id|all>` — leerness 고유 가치 시나리오 4종 (거짓 완료 / 사양 불일치 / drift / BOM) **command 한 번에 정량 증명**.
- **1.9.50** — `skill match --embedding` — Ollama API 코사인 유사도 매칭 (opt-in, 실패 시 jaccard fallback).
- **1.9.49** — `benchmark --measure "<task>"` — 외부 CLI 실 호출 시간 측정 + leerness 검수 오버헤드 측정.
- **1.9.48** — cross-platform archive — `skill publish` tar 실패 시 PowerShell ZIP 자동 fallback (stress-v3 H1-H3 검증).
- **1.9.47** — `leerness skill publish` — 자체 skill을 SKILL.md + manifest.json 번들로 export (외부 공유 가능, agentskills.io 표준).
- **1.9.46** — `leerness benchmark` — 자체 6 차원 점수 + 6 도구 (vanilla/claude_code/hermes/leerness+claude 등) 시뮬 비교 매트릭스.
- **1.9.45** — `leerness skill match <query>` — 사용자 요청 ↔ 설치 SKILL.md description **jaccard 매칭** + 자동 추천.
- **1.9.44** — 1.9.34~43 13종 기능 통합 stress test 25/25 PASS · 발견된 BOM 처리 BUG 1건 즉시 패치 (`_parseSkillMd` UTF-8 BOM 자동 제거) · e2e 196/196.
- **1.9.43** — MCP 서버로 leerness 도구 10종 노출 (`leerness mcp serve`, Claude Code/Hermes/Cursor 등이 직접 호출 가능) · `skill export-all` (9개 일괄 SKILL.md export) · 내부 보고서 자동 비공개 (`_reports/` gitignore + npmignore).
- **1.9.42** — [agentskills.io](https://agentskills.io) 공개 표준 호환 (Claude Code · Cursor · Copilot · Codex · Gemini CLI · Hermes Agent 등 30+ 도구와 스킬 공유): `skill install <url>` · `skill discover` (opt-in) · `skill export` (SKILL.md frontmatter) · `LEERNESS_SKILL_DISCOVER_URL` .env opt-in.
- **1.9.41** — 디스크↔AI 컨텍스트 인지 갭 차단: `leerness whats-new` 명령 (CHANGELOG 자동 차분 추출) · `migrate` 후 stdout에 AI must re-read 차분 자동 출력 · `migration-report.md`에 신규 명령/파일 영구 기록 · `handoff`가 fresh migrate(24h 내) 시 자동 알림.
- **1.9.40** — dogfooding gap 차단: `leerness release pack` 통합 명령 (라운드 마감 자동화 — npm pack + parent migrate + task add + close + readme sync) · `audit`에 README ↔ package.json version mismatch 자동 감지 + `--fix`로 자동 갱신.
- **1.9.39** — AI 하네스 엔지니어링 6단계 워크플로 자동 유도 (`session-workflow.md` + handoff 끝 가이드 + AGENTS/CLAUDE 인스트럭션 통합) · `drift check --auto-fix` · `handoff --auto-recover` (critical 시 session close 자동 실행).
- **1.9.38** — drift 자동 reminder (`agent-reminders.md`) · `usage stats` 명령 · `task sync --from <todo.json>` · drift 임계 학습 (skip ≥5 → 임계 완화).
- **1.9.37** — `leerness drift check` (4 신호 + 4단계 레벨) — 라운드 길어지며 메인이 leerness 잊는 현상 자동 감지.
- **1.9.36** — `agents bench` (3 CLI 동시 비교) · `dispatch --write` (CLI별 권장 플래그) · 작업 유형 추천 · `contract verify` require() side-effect 25× 속도 회복.
- **1.9.35** — `contract verify` · `reuse autodetect` · `audit --fix` · `handoff` init 부재 경고 · `agents dispatch` 안전 규칙.
- **1.9.34** — 방향키/스페이스 인터랙티브 multi-select · 256색 그라데이션 배너 · 3단계 sub-agent 오케스트레이션 검증 (2.2× 효율).
- **1.9.33** — npx 캐시 옛 버전 자동 경고.
- **1.9.32** — ASCII 배너 · `setup-agents` 인터랙티브 + 자동 설치.
- **1.9.31** — `agents quota` (provider별 사용량 추정).
- **1.9.30** — 외부 AI CLI 오케스트레이션 (claude/codex/gemini/copilot).
- **1.9.29** — 페르소나 리뷰 (5종 내장).
- **1.9.24** — `deps <capability>` 영향 추적 + 자동 회귀.
- **1.9.22** — Ollama opt-in · `handoff --compact` · `llm-bench`.
- **1.9.18** — `verify-claim` · `--strict-elements` · depends-on 그래프.
- **1.9.17** — `--all-apps` 워크스페이스 모드.
- ... (전체 [CHANGELOG.md](CHANGELOG.md) 참조)

---

## 기여

- **이슈**: https://github.com/gugu9999gu/leerness/issues
- **PR**: e2e 통과 + 한국어 주석 + UTF-8 BOM 없음

---

## 라이선스

MIT — © leerness contributors

> **AI 에이전트가 신뢰할 수 있게 일하도록 만드는 도구.**
> 사용자 동의 없이 외부 LLM/API/CLI를 자동 호출하지 않습니다.

<!-- leerness:project-readme:start -->
## Leerness Project Harness

이 프로젝트는 Leerness v1.9.144 하네스를 사용합니다. AI 에이전트는 작업 전 `leerness handoff`로 컨텍스트를 적재하고, 작업 후 `leerness check`/`leerness audit`/`leerness session close`를 수행해야 합니다.

### Core Commands

```bash
leerness handoff .            # 세션 시작 컨텍스트 자동 로드
leerness status .             # 설치 상태
leerness verify .             # 필수 파일 검증
leerness audit .              # 일관성·계획-진행 정렬 감사
leerness scan secrets .       # 시크릿 패턴 스캔
leerness encoding check .     # UTF-8 / BOM / CRLF 검사
leerness lazy detect .        # 게으름 방지 자동 평가
leerness memory search "키"   # 결정/이력 검색
leerness session close .      # 세션 종료 + handoff 자동 작성
leerness update .             # 자동 버전 감지 + 마이그레이션
```

### Memory Surface CRUD (5 surfaces × add/list/drop)

```bash
# Tasks
leerness task add "T-9999 작업 제목"
leerness task list --json
# Decisions
leerness decision add "결정 제목" --reason "이유"
leerness decision list --query "키워드"   # 1.9.139
# Rules (영구 자연어 룰)
leerness rule add "매 commit마다 changelog 갱신" --trigger every-commit
leerness rule list
# Plan (milestones)
leerness plan add "M-XXXX 계획" --next-action "다음 단계"
leerness plan list
# Lessons (영구 교훈)
leerness lesson save "교훈 본문" --tag perf
leerness lesson list --query "키워드"     # 1.9.139
# DELETE → RESTORE (1.9.126~128)
leerness memory archive list . --query "키워드"   # 1.9.138
leerness memory restore decision <date|title>
```

### MCP server (외부 AI 통합)

Leerness v1.9.144는 stdio JSON-RPC MCP server를 내장합니다 — Claude Code · Cursor · Codex CLI 등 외부 AI에 **42개 도구**를 노출:

```jsonc
// 카테고리별
// • Core: handoff / drift_check / audit / health / verify_claim / contract_verify
// • Memory READ:  task_list / decision_list / lesson_list / plan_list / rule_list / memory_status
// • Memory WRITE: task_add / decision_add / lesson_save / plan_add / rule_add
// • Memory DELETE: task_drop / decision_drop / lesson_drop / plan_remove / rule_remove
// • Skill: skill_match / skill_list / skill_search / skill_info / skill_suggest
// • Insight: lessons / lessons_auto / brainstorm / retro / benchmark / lazy_detect
// • Workflow: session_close / agents_list / task_export / env_check / usage_stats / reuse_map / whats_new

// MCP server 실행: leerness mcp serve
// tools/list 응답: 42 도구
```

### Autonomous mode (자율 모드)

`<<autonomous-loop-dynamic>>` 신호만 보내면 AI가:
1) 다음 라운드 후보 선정 → 2) 코드 변경 → 3) stress-v* 신규 작성 + 누적 회귀 → 4) e2e 219/219 → 5) npm pack + git tag + GitHub release → 6) main 자동 push (1.9.140+) → 7) session close → 8) 다음 라운드 예약.

현재 누적: **70 라운드 (1.9.40 → 1.9.144)** · 매 라운드 GitHub release/태그 생성 · _reports/는 비공개 보존.

### 성능 가이드 (1.9.140 측정)

- `leerness handoff .` — 평균 ~1.5s (캐시 워밍업 후 ~0.6s)
- `leerness memory status --json` — 평균 ~250ms
- `leerness task list --json` — 평균 ~200ms
- `leerness drift check --json` — 평균 ~400ms
- MCP `tools/list` 응답 — 평균 ~150ms
- usage-stats / lessons / listAllSkills 모두 메모리 캐싱 (1.9.65/66)

### 빠른 시작

```bash
# 1. 설치 (글로벌)
npm install -g leerness

# 2. 프로젝트에 하네스 설치
cd my-project && leerness init . --yes --skills recommended

# 3. AI 세션 시작 시
leerness handoff .            # 컨텍스트 자동 로드

# 4. 세션 종료 시
leerness session close .      # 9 카테고리 + 룰 검증 + 다음 라운드 추천

# 5. release 자동화 (1.9.140 main 자동 push 포함)
leerness release pack --close --auto-main-push
```

### Planning Files

- `.harness/plan.md`: 전체 목표, milestone, 제외/드랍 범위
- `.harness/progress-tracker.md`: 요청 단위 상태와 증거
- `.harness/current-state.md`: 지금 이어서 할 작업
- `.harness/session-handoff.md`: 다음 세션 인수인계 (자동 작성)
- `.harness/lessons.md` / `decisions.md` / `rules.md`: 영구 메모리 (5 surface)

Last synced by Leerness v1.9.144: 2026-05-20
<!-- leerness:project-readme:end -->

