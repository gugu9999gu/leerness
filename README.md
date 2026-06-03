# Leerness

> **AI 코딩 에이전트의 거짓 완료·중복·망각·충돌을 막아주는 검수·기억·협업 CLI 하네스.**
> **A CLI harness that stops AI coding agents from faking completion, duplicating work, forgetting context, and colliding.**

[![npm](https://img.shields.io/badge/npm-leerness-blue)](https://www.npmjs.com/package/leerness) [![version](https://img.shields.io/badge/version-1.9.290-green)]() [![tests](https://img.shields.io/badge/e2e-235%2F235-success)]() [![selftest](https://img.shields.io/badge/selftest-38-success)]() [![mcp](https://img.shields.io/badge/MCP--tools-79-brightgreen)]() [![providers](https://img.shields.io/badge/AI_providers-10-brightgreen)]() [![license](https://img.shields.io/badge/license-MIT-lightgrey)]()

```
  ╔══════════════════════════════════════════════════════════════╗
  ║  ██╗     ███████╗███████╗██████╗ ███╗   ██╗███████╗███████╗  ║
  ║  ██║     ██╔════╝██╔════╝██╔══██╗████╗  ██║██╔════╝██╔════╝  ║
  ║  ██║     █████╗  █████╗  ██████╔╝██╔██╗ ██║█████╗  ███████╗  ║
  ║  ██║     ██╔══╝  ██╔══╝  ██╔══██╗██║╚██╗██║██╔══╝  ╚════██║  ║
  ║  ███████╗███████╗███████╗██║  ██║██║ ╚████║███████╗███████║  ║
  ║  ╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝  ║
  ║  AI Agent Reliability Harness  (버전: 상단 배지 참조)        ║
  ║  verify · remember · orchestrate · audit · drift · roles     ║
  ╚══════════════════════════════════════════════════════════════╝
```

<p align="center"><b>🇰🇷 <a href="#한국어">한국어</a> &nbsp;·&nbsp; 🇬🇧 <a href="#english">English</a></b></p>

---

<a id="한국어"></a>

# 🇰🇷 한국어

## 한눈에 보기

`leerness`는 **Claude Code · Cursor · Copilot · Codex · Antigravity · Grok · opencode · Qwen · Aider · Goose** 같은 AI 코딩 에이전트와 함께 일할 때 생기는 구조적 문제를 자동으로 막아주는 CLI 도구입니다.

AI는 코드를 빠르게 쓰지만, 다음 **5가지 함정**에 반복해서 빠집니다 — leerness는 이를 모두 자동으로 감지·차단·회복합니다.

| # | 함정 | leerness의 방어 |
|---|------|-----------------|
| 1 | **거짓 완료** — "구현했습니다"인데 코드 변경/테스트가 없음 | `verify-claim --run-tests` (증거 파일 + 실제 테스트 실행) |
| 2 | **중복 생성** — 이미 있는 함수를 또 만듦 | `reuse-map` (워크스페이스 전체 중복 감지) |
| 3 | **망각** — 다음 세션에서 계획·결정을 잃음 | `handoff` (컨텍스트 자동 적재) |
| 4 | **충돌** — 멀티 에이전트가 같은 파일을 동시에 수정 | `agents dispatch` (경로 격리 + 역할 분배) |
| 5 | **도구 drift** — 시간이 지나며 도구·메타파일을 잊음 | `drift check` (자동 감지 + 회복) |

---

## ⏱️ 60초 시작

```bash
# 1) 설치 + 초기화 — 시스템 언어를 자동 감지해 한/영 가이드 표시 (1.9.269)
npx leerness@latest init .

# 2) AI 세션 시작 — 컨텍스트 자동 적재
npx leerness handoff .

# 3) AI 작업 끝 — "정말 했는지" 증거로 검증
npx leerness verify-claim T-0001 --run-tests

# 4) 세션 마감 — 다음 세션으로 자동 인계
npx leerness session close .
```

> 💡 `@latest`를 붙이면 npx 캐시로 옛 버전이 실행되는 함정을 피할 수 있습니다.

---

## 🧩 작동 방식

### 1. 워크스페이스에 "기억 채널"을 만듭니다

```
.harness/
├── plan.md              ← 무엇을 할 것인가
├── progress-tracker.md  ← 무엇을 했는가 (증거 포함)
├── decisions.md         ← 왜 그렇게 했는가
└── session-handoff.md   ← 다음 세션에 무엇을 넘기는가
```

이 파일들은 **사용자 메모리로 보호**됩니다. leerness가 자동 갱신하되, 사람이나 AI가 직접 쓴 내용은 **항상 보존**되고 변경 전 `.harness/archive/`에 백업됩니다.

### 2. AI가 "완료"라고 할 때마다 증거로 검증

```
AI: "T-0042 API 호출 구현 완료했습니다"
        ↓  leerness verify-claim T-0042 --run-tests
  evidence 파일 확인 → 테스트 실제 실행 → 코드 매칭
        ↓
  ✓ 검증 통과   또는   ✗ "코드에 fetch 호출 흔적 없음 (신뢰도 0.85)"
```

### 3. 여러 AI 에이전트를 역할별로 지휘 (1.9.270 신규)

모델마다 강점이 다릅니다. **역할을 모델에 매핑**해 적재적소로 일을 시킵니다.

```bash
leerness roles set 코딩   --provider codex  --model gpt-5.5         # 코딩 담당
leerness roles set 검수자 --provider claude --model claude-opus-4-7 # 검수 담당
leerness roles suggest                       # 활성 에이전트 기반 최적 배치 + 근거 추천
leerness agents dispatch "이 변경 검수" --role 검수자   # 역할 → 모델 자동 라우팅
```

> 역할 7종: 지휘(commander)·검수(reviewer)·코딩(coder)·설계(architect)·디자인(designer)·디버그(debugger)·분배(dispatcher). 한국어 별칭 지원.

### 4. 라운드가 길어지면 "leerness를 안 쓰는" drift를 자동 감지

```bash
leerness drift check .
  → 🔴 critical (110/200) — session close 11일 누락
  → 권장: leerness session close .   (1회 실행으로 🟠 attention 회복)
```

### AGENTS.md(정적) vs leerness(동적) — 보완 관계

leerness는 [AGENTS.md](https://agents.md)를 **대체하지 않고 보완**합니다.

| 정적 — AGENTS.md | 동적 — leerness |
|---|---|
| 코딩 규칙·테스트 명령·금지·배포 절차 (자주 안 변함) | 현재 목표·수정 파일·실패 시도·검증 결과·다음 인수인계 (매 작업 변함) |
| 사람이 작성 | `leerness state`/MCP `leerness_state_*` 가 `.leerness/` 에 기록 |

→ 규칙은 AGENTS.md, **작업 상태/기억/검증/인수인계는 leerness** (모든 에이전트 공통 운영 레이어).

---

## 📊 적용 효과 (정량)

`leerness-bench` 28 프로젝트 124 task 측정:

| 항목 | 적용 | 미적용 |
|------|-----:|-------:|
| 다중 에이전트 효율 | 100/100 | 3/100 |
| 자동 검수 (verify-claim) | 98/100 | 0/100 |
| 재사용 인식 | 100/100 | 0/100 |
| 자동 BUG 감지 | 100/100 | 0/100 |
| 컨텍스트 유지 | 100/100 | 0/100 |
| **종합** | **597/600 (99%)** | **3/600 (0.5%)** |

- 수동 검수 **90초 → 자동 1.5초**
- 컨텍스트 적재 **500자** (`handoff --compact`, AI 토큰 90% 절감)

---

## 🛠️ 핵심 명령

```bash
# 일상
leerness init [path]                 # 신규 설치 (시스템 언어 자동 감지)
leerness handoff [path] [--compact]  # 세션 시작 컨텍스트 적재
leerness verify-claim T-XXX --run-tests   # 거짓 완료 검증
leerness audit [path] [--fix]        # 일관성 감사 (--fix 자동 갱신)
leerness session close [path]        # 세션 마감 + 다음 세션 인계
leerness drift check [path]          # leerness 미사용 drift 점수

# 멀티 AI 에이전트 · 역할
leerness setup-agents                # 활성화 (claude/codex/agy/grok/opencode/qwen/aider/goose/copilot/ollama)
leerness agents list | quota         # 상태 / 한도
leerness agents dispatch "<task>" --role coder   # 역할 기반 모델 라우팅
leerness agents bench "<task>"       # 여러 CLI 동시 호출 + 비교
leerness roles list | set | suggest | verify     # 모델별 역할 부여

# 보안 · 인코딩
leerness scan secrets .              # API 키/토큰 패턴 스캔
leerness encoding check .            # BOM/UTF-16/한글 라운드트립
leerness gate [path]                 # verify+audit+scan+encoding+lazy 통합

# 버전
leerness update --check              # 새 버전 감지
leerness update --yes                # 자동 마이그레이션 + 검증
```

전체 명령은 `leerness commands`, MCP 도구는 `leerness mcp serve`로 확인하세요.

---

## ❓ FAQ

**Q. leerness가 내 코드를 바꾸나요?**
A. 사용자 메모리(plan/progress/decisions)는 **항상 보존**, 모든 변경 전 자동 백업합니다. 소스 코드는 직접 수정하지 않습니다.

**Q. AI 에이전트 없이도 쓸 수 있나요?**
A. 네. 1인 개발자의 작업 검증·기억·중복 감지에도 유용합니다.

**Q. 외부 AI CLI를 자동으로 호출하나요?**
A. **절대 아니요.** `agents dispatch`는 실행 명령 텍스트만 생성합니다. 실제 실행은 사용자/메인 에이전트가 명시적으로 합니다.

**Q. CI에서 쓸 수 있나요?**
A. 네. 모든 명령이 exit code + `--json` + `--yes` 비대화형을 지원합니다.

---

## 🔒 보안·투명성

leerness 는 권한이 큰 CLI 하네스입니다(child_process · git · 외부 CLI · 자동화 브리지 · hook 설치). **할 수 있는 전부와 끄는 법**을 공개합니다.

```bash
leerness capabilities          # 권한 표면 + opt-out + 주의 명령 (--json 지원)
```

- **런타임 의존성 0** · **postinstall 없음** · **변경 전 자동 백업** · **동의 없는 외부 호출 금지**
- `init` 시 `.claude/settings.local.json` 에 SessionStart hook(`update --check`)이 설치됩니다 → 끄기: `leerness init . --no-auto-update`
- 회사/운영 코드에서는 먼저 한 프로젝트에서 `init` 후 `git diff` 로 검토하고 커밋하세요.
- 자세히: [SECURITY.md](SECURITY.md)

**설치 부담 완화 옵션 (1.9.276):**

```bash
leerness init . --dry-run     # 생성/수정될 파일 미리보기 (실제 변경 0)
leerness init . --minimal     # 핵심 파일만 (에디터 통합/가이드/roadmap/.env 생략)
leerness init . --no-env      # .env/.env.example 자동 생성만 생략
```

**도구별 어댑터 (1.9.280) — 내 에이전트만 연결:**

```bash
leerness init . --minimal --no-env   # 1) 최소 설치 / minimal install
leerness adapter cursor              # 2) 내 도구만 (.cursor + .mcp.json) / only my tool
leerness adapter list                # 가능 어댑터 (claude/cursor/codex/goose/opencode/aider/qwen/...)
# MCP 지원 도구는 .mcp.json 에 leerness 등록 → 상태 verb(state_*) 직접 호출
```

### 릴리스 채널 (안정 vs 실험)

leerness는 활발히 개발됩니다(잦은 1.9.x). 채널을 골라 안정성을 제어하세요:

```bash
npm i leerness            # latest (안정) — 일반 사용자 기본
npm i leerness@next       # next (실험) — 조기 검증용
npm i leerness@1.9.275    # 버전 고정 — 재현성 (운영 코드 권장)
leerness release channel  # 현재 채널/정책 확인 (--json)
```

---

<a id="english"></a>

# 🇬🇧 English

## At a glance

`leerness` is a CLI harness that automatically prevents the structural problems that arise when working with AI coding agents like **Claude Code · Cursor · Copilot · Codex · Antigravity · Grok · opencode · Qwen · Aider · Goose**.

AI writes code fast, but repeatedly falls into **5 traps** — leerness detects, blocks, and recovers from all of them.

| # | Trap | leerness defense |
|---|------|------------------|
| 1 | **Fake completion** — "done!" but no code change / no tests run | `verify-claim --run-tests` (evidence files + real test execution) |
| 2 | **Duplication** — rebuilding a function that already exists | `reuse-map` (workspace-wide duplicate detection) |
| 3 | **Amnesia** — losing plans/decisions across sessions | `handoff` (automatic context loading) |
| 4 | **Collisions** — multiple agents editing the same file | `agents dispatch` (path isolation + role routing) |
| 5 | **Tool drift** — forgetting tools/meta files over time | `drift check` (auto detection + recovery) |

---

## ⏱️ 60-second start

```bash
# 1) Install + init — auto-detects system language for KO/EN guides (1.9.269)
npx leerness@latest init .

# 2) Start an AI session — auto-load context
npx leerness handoff .

# 3) After AI claims "done" — verify with evidence
npx leerness verify-claim T-0001 --run-tests

# 4) Close the session — hand off to the next one
npx leerness session close .
```

> 💡 Adding `@latest` avoids the trap of npx running a stale cached version.

---

## 🧩 How it works

### 1. Creates "memory channels" in your workspace

```
.harness/
├── plan.md              ← what to do
├── progress-tracker.md  ← what was done (with evidence)
├── decisions.md         ← why it was done that way
└── session-handoff.md   ← what to pass to the next session
```

These are **protected as user memory**. leerness updates them automatically, but anything a human or AI wrote is **always preserved** and backed up to `.harness/archive/` before any change.

### 2. Verifies every "done" with evidence

```
AI: "Finished implementing the T-0042 API call"
        ↓  leerness verify-claim T-0042 --run-tests
  check evidence files → actually run tests → match code
        ↓
  ✓ verified   or   ✗ "no trace of a fetch call in code (confidence 0.85)"
```

### 3. Directs multiple AI agents by role (new in 1.9.270)

Each model has different strengths. **Map roles to models** to put the right model on the right job.

```bash
leerness roles set coder    --provider codex  --model gpt-5.5
leerness roles set reviewer --provider claude --model claude-opus-4-7
leerness roles suggest                      # recommend optimal layout from active agents + rationale
leerness agents dispatch "review this change" --role reviewer   # role → model auto-routing
```

> 7 roles: commander · reviewer · coder · architect · designer · debugger · dispatcher.

### 4. Detects "drift" when you stop using leerness over long rounds

```bash
leerness drift check .
  → 🔴 critical (110/200) — session close missing for 11 days
  → recommended: leerness session close .   (one run recovers to 🟠 attention)
```

### AGENTS.md (static) vs leerness (dynamic) — complementary

leerness **complements, not replaces** [AGENTS.md](https://agents.md).

| Static — AGENTS.md | Dynamic — leerness |
|---|---|
| coding rules, test commands, prohibitions, deploy steps (rarely change) | current goal, files changed, failed attempts, verification, next handoff (change every task) |
| written by humans | recorded to `.leerness/` via `leerness state` / MCP `leerness_state_*` |

→ Rules live in AGENTS.md; **work state/memory/verification/handoff live in leerness** (the shared operating layer for any agent).

---

## 📊 Measured impact

From `leerness-bench` across 28 projects / 124 tasks:

| Metric | With | Without |
|--------|-----:|--------:|
| Multi-agent efficiency | 100/100 | 3/100 |
| Auto-verification (verify-claim) | 98/100 | 0/100 |
| Reuse awareness | 100/100 | 0/100 |
| Auto bug detection | 100/100 | 0/100 |
| Context retention | 100/100 | 0/100 |
| **Total** | **597/600 (99%)** | **3/600 (0.5%)** |

- Manual review **90s → 1.5s automated**
- Context load **~500 chars** (`handoff --compact`, ~90% fewer AI tokens)

---

## 🛠️ Core commands

```bash
# Daily
leerness init [path]                 # new install (auto-detects system language)
leerness handoff [path] [--compact]  # load session-start context
leerness verify-claim T-XXX --run-tests   # verify fake completion
leerness audit [path] [--fix]        # consistency audit (--fix auto-update)
leerness session close [path]        # close session + hand off
leerness drift check [path]          # leerness-disuse drift score

# Multi AI agents · roles
leerness setup-agents                # enable (claude/codex/agy/grok/opencode/qwen/aider/goose/copilot/ollama)
leerness agents list | quota         # status / limits
leerness agents dispatch "<task>" --role coder   # role-based model routing
leerness agents bench "<task>"       # call several CLIs at once + compare
leerness roles list | set | suggest | verify     # per-model role assignment

# Security · encoding
leerness scan secrets .              # API key/token pattern scan
leerness encoding check .            # BOM/UTF-16/CJK round-trip
leerness gate [path]                 # verify+audit+scan+encoding+lazy combined

# Versions
leerness update --check              # detect new version
leerness update --yes                # auto-migrate + verify
```

Run `leerness commands` for the full list, or `leerness mcp serve` to expose tools to a main agent.

---

## ❓ FAQ

**Q. Does leerness change my code?**
A. User memory (plan/progress/decisions) is **always preserved** and backed up before any change. It never edits your source code directly.

**Q. Can I use it without an AI agent?**
A. Yes. Solo developers can use it for self-verification, memory, and duplicate detection.

**Q. Does it auto-call external AI CLIs?**
A. **Never.** `agents dispatch` only generates command text. Actual execution is explicit, by you or your main agent.

**Q. Can I use it in CI?**
A. Yes. Every command supports exit codes, `--json`, and non-interactive `--yes`.

---

## 🔒 Security & transparency

leerness is a powerful CLI harness (child_process, git, external CLIs, automation bridges, hook install). It discloses **everything it can do and how to turn each off**.

```bash
leerness capabilities          # capability surface + opt-out + cautious commands (--json supported)
```

- **Zero runtime deps** · **no postinstall** · **auto-backup before changes** · **never auto-calls external services without consent**
- `init` installs a SessionStart hook (`update --check`) in `.claude/settings.local.json` → disable with `leerness init . --no-auto-update`
- For company/production code, trial `init` in one project, review with `git diff`, then commit.
- Details: [SECURITY.md](SECURITY.md)

**Lighter-install options (1.9.276):**

```bash
leerness init . --dry-run     # preview files to be created/modified (zero changes)
leerness init . --minimal     # core files only (skips editor integrations/guides/roadmap/.env)
leerness init . --no-env      # skip only .env/.env.example auto-creation
```

### Release channels (stable vs experimental)

leerness is actively developed (frequent 1.9.x). Pick a channel to control stability:

```bash
npm i leerness            # latest (stable) — default for most users
npm i leerness@next       # next (experimental) — early validation
npm i leerness@1.9.275    # pin a version — reproducibility (recommended for prod)
leerness release channel  # show current channel/policy (--json)
```

---

## 🔧 Environment variables / 환경변수

| Variable | Effect |
|----------|--------|
| `LEERNESS_OFFLINE=1` | Skip npm calls (offline) / npm 호출 스킵 |
| `LEERNESS_ENABLE_CLAUDE/CODEX/AGY/GROK/COPILOT/OLLAMA` | Enable external CLIs / 외부 CLI 활성화 |
| `LEERNESS_NO_BANNER` | Skip ASCII banner / 배너 스킵 |
| `LEERNESS_NO_DRIFT_CHECK` | Disable drift warning / drift 경고 끄기 |
| `LEERNESS_NO_INTERACTIVE` | Disable arrow-key select / 방향키 선택 끄기 |

---

## 📜 Recent highlights / 최근 변경

- **1.9.271** — README 한/영 이중 사용자 친화 재작성 / Bilingual KO-EN README rewrite.
- **1.9.270** — agent roles: 모델별 역할 부여 / per-model role assignment (`roles` CLI + `dispatch --role`).
- **1.9.269** — init 시 OS 시스템 언어 감지 / OS system-language detection on init.
- **1.9.268** — grok 정식 provider 승격 / grok promoted to a first-class provider.
- **1.9.265~267** — CLI 에이전트 슬래시 명령 레지스트리 + `--help` probe 자동 갱신.

> 전체 이력 / full history: [CHANGELOG.md](CHANGELOG.md)

---

## 🤝 Contributing / 기여

- Issues: https://github.com/gugu9999gu/leerness/issues
- PRs: e2e 통과 + 한국어 주석 + UTF-8 (no BOM) / pass e2e, Korean comments, UTF-8 without BOM.
- 테스트 / Tests:
  ```bash
  npm run test:fast   # 빠른 핵심-경로 smoke (selftest + 13 체크, ~10초) / fast core-path smoke (~10s)
  npm test            # 전체 게이트 (selftest + e2e 220+) / full gate
  ```

## 📄 License

MIT — © leerness contributors

> **AI 에이전트가 신뢰할 수 있게 일하도록 만드는 도구. 사용자 동의 없이 외부 LLM/API/CLI를 자동 호출하지 않습니다.**
> **A tool that makes AI agents work reliably. It never auto-calls external LLMs/APIs/CLIs without your consent.**

<!-- leerness:project-readme:start -->
## Leerness Project Harness

이 프로젝트는 Leerness v1.9.290 하네스를 사용합니다. AI 에이전트는 작업 전 `leerness handoff`로 컨텍스트를 적재하고, 작업 후 `leerness check`/`leerness audit`/`leerness session close`를 수행해야 합니다.

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

Leerness v1.9.290는 stdio JSON-RPC MCP server를 내장합니다 — Claude Code · Cursor · Codex CLI 등 외부 AI에 **79개 도구**를 노출:

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
// tools/list 응답: 79 도구
```

### Autonomous mode (자율 모드)

`<<autonomous-loop-dynamic>>` 신호만 보내면 AI가:
1) 다음 라운드 후보 선정 → 2) 코드 변경 → 3) stress-v* 신규 작성 + 누적 회귀 → 4) e2e 219/219 → 5) npm pack + git tag + GitHub release → 6) main 자동 push (1.9.140+) → 7) session close → 8) 다음 라운드 예약.

현재 누적: **70 라운드 (1.9.40 → 1.9.290)** · 매 라운드 GitHub release/태그 생성 · _reports/는 비공개 보존.

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

Last synced by Leerness v1.9.290: 2026-06-03
<!-- leerness:project-readme:end -->

