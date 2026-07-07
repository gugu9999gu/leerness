# leerness

```
██╗     ███████╗███████╗██████╗ ███╗   ██╗███████╗███████╗
██║     ██╔════╝██╔════╝██╔══██╗████╗  ██║██╔════╝██╔════╝
██║     █████╗  █████╗  ██████╔╝██╔██╗ ██║█████╗  ███████╗
██║     ██╔══╝  ██╔══╝  ██╔══██╗██║╚██╗██║██╔══╝  ╚════██║
███████╗███████╗███████╗██║  ██║██║ ╚████║███████╗███████║
╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝
```

> **The AI-coding operations layer that makes "done" require evidence — for any language, any AI agent.**
> leerness does not write code. It gives your AI agent persistent memory, verified completion, and clean handoffs — stored inside your repo as plain files, exposed via CLI + MCP.

[![npm](https://img.shields.io/npm/v/leerness)](https://www.npmjs.com/package/leerness) · ![MCP tools](https://img.shields.io/badge/MCP--tools-86-blue) · **0 runtime deps** · **0 install scripts** · offline-first · Node ≥ 18 · MIT

**🇰🇷 한국어 전문: [README.ko.md](./README.ko.md)**

---

## Try it in 30 seconds

```bash
npx -y leerness init . --yes   # adds .harness/ memory + guard files to your project
npx leerness handoff .         # everything your AI should know right now, in one call
```

Your project now has agent-independent memory. To see the flagship feature — catching a false "done" claim:

```bash
npx leerness task add "Implement payment API"   # prints the new id, e.g. T-0002 — use it below
npx leerness task update T-0002 --status done --evidence "payment.js implemented + tested"
npx leerness verify-claim T-0002   # exit 1 — payment.js does not exist. Claim rejected.
```

Now actually write `payment.js`, then run the **same** `verify-claim T-0002` → it exits 0. That is the whole idea: **"done" must match reality.**

> Tip: if your evidence claims a specific test count (e.g. "5 tests passed"), leerness measures the real count and rejects a mismatch — so claim only what's true, or add `--run-tests --test-cmd "<your test cmd>"` to verify by running them.

> Want a smaller footprint? `leerness init . --minimal` installs only the core memory + verification files instead of the full set.

---

## No terminal? Let your AI run it

You never have to type a command yourself. Paste this into Claude Code, Cursor, Codex, or any coding agent:

> Set up leerness in this project by running `npx -y leerness init . --yes`. From now on, run `leerness handoff .` at the start of every session, verify finished work with `leerness verify-claim`, and run `leerness session close .` before you finish.

The agent installs and operates it for you — `leerness init` also writes the instructions into CLAUDE.md / AGENTS.md so future sessions pick them up automatically.

Prefer pure natural language? leerness ships an **MCP server with 86 tools** (`leerness mcp serve`). Connect it once to Claude Desktop / Claude Code and just ask: *"what was I working on?"*, *"did the AI actually finish T-0001?"*

---

## Claude and Codex already have memory. Why leerness?

Built-in harnesses remember what the AI **said**. leerness verifies what the AI **did** — and keeps working when you switch agents.

| | Built-in (CLAUDE.md, agent memory) | leerness |
|---|---|---|
| Memory | per-agent, free-form notes | structured tasks / decisions / lessons / rules — agent-independent files in your repo |
| "Done" claims | trusted as written | **evidence-gated**: claimed files, test counts, and run output are checked against reality — bluffs exit 1 |
| Switching agents (Claude → Codex → Cursor) | context lost | same `.harness/` state, same one-call handoff |
| Secrets · encoding · drift guards | none | `scan secrets` · `encoding check` · `drift check --auto-fix` — CI-ready |
| Lock-in | one vendor | any agent, any language, 0 runtime dependencies |

This positioning is checked by **self-administered clean-room evaluations** — AI agents do a fresh `npm install` into temp dirs and drive it by behavior only, including adversarial attacks against the verifier itself (fake tests, comment-only stubs, inflated test counts — all rejected). To be clear: these are *AI* clean-room runs, **not third-party human audits or peer review** — they make the claim *checkable* rather than a marketing line. Methodology, results, and honest limitations: **[docs/clean-room-evaluations.md](./docs/clean-room-evaluations.md)**.

---

## Guidance vs enforcement (be honest about this)

By default leerness is **cooperative**: your AI agent runs the commands because CLAUDE.md / AGENTS.md tell it to. A determined agent could skip them. To make verification **enforced**, not optional:

```bash
leerness ci init          # writes .github/workflows/leerness-gate.yml — runs `leerness gate` on every PR
```

The generated workflow is production-grade: it **pins the leerness version** (reproducible — the gate's verdict can't change from a silent upgrade), runs with **least-privilege permissions** (`contents: read`), and cancels superseded runs.

Then make that check **required** in GitHub branch protection. Now a PR that skips verification (or whose claims fail) **cannot merge** — the gate runs independently of the agent, returns a non-zero exit code, and blocks. That is the difference between a guideline and a guardrail. For exact per-claim enforcement, run `leerness gate --claims` — it adds a 6th check that runs `verify-claim` on **every** completed task and fails the gate if any "done" task's evidence doesn't match reality (the default 5-check gate already blocks false-done via heuristics; `--claims` makes it precise).

For secrets, pair the gate with a **dedicated scanner** in the same workflow — leerness's `scan secrets` is a convenience guard (the same signal your agent sees locally), not a hard guarantee:

```yaml
# add to .github/workflows/leerness-gate.yml (or a separate job)
- uses: gitleaks/gitleaks-action@v2                 # dedicated scanner — the hard-guarantee layer
- run: npx leerness@<pinned-version> scan secrets . --json   # convenience layer — same check your agent runs locally
```

---

## Maturity — and why trying it is still cheap

Be honest with yourself before you depend on this: leerness is **early and largely solo-maintained**, developed mostly through autonomous AI rounds — so its own `selftest` + e2e suites are the primary quality signal, and external adoption is still small. Don't make it load-bearing on faith: **pin a version**, and treat the differentiated slice — `verify-claim` + the CI `gate` as a required check — as the part worth relying on.

(Contributor note — three test tiers, fastest to slowest: `npm run test:fast` = selftest + smoke (commands run without crashing, <1 min, dev loop); `npm run test:core` = selftest + a flagship behavioral suite (verify-claim / gate / contract / scan actually reject bad input and pass honest input, ~20 s, pre-commit / quick CI); `npm test` = selftest + the entire e2e suite (**10+ minutes by design**, the release gate).)

The asymmetry is what makes a trial reasonable anyway: MIT, **0 runtime dependencies**, offline-first, and all state is plain files in *your* repo. Lock-in is near zero — if it doesn't earn its place, remove the tool and your `task`/`decision`/`lesson` files stay. (For secret scanning specifically, mature dedicated tools like gitleaks/trufflehog exist — use those if you need a hard guarantee; leerness's `scan secrets` is a convenience guard, not a replacement.)

---

## What is inside (the 60-second tour)

- **Memory** — `task` / `plan` / `decision` / `lesson` / `rule`: canonical JSON + markdown projections, archive/restore.
- **Handoff** — `handoff` (session start context) · `session close` (closing report). Survives agent swaps.
- **Verification** — `verify-claim` (evidence vs reality, stub/fake-test/inflated-count detection, `--run-tests --test-cmd` for any language; `--all` checks **every** completed claim at once for CI) · `contract verify` (spec ↔ impl) · `gate` (one-call CI gate).
- **Audit** — `audit` · `lazy detect` · `drift check` keep the workspace honest over time.
- **Security** — `scan secrets` (committed-secret detection) · `encoding check` (BOM/CP949) — also runs at `session close`.
- **Visualize** — `graph --html` writes a self-contained interactive ontology graph (`leerness.html`) of the whole harness (memory surfaces + skills + feature-graph) — click a node to read its content. Optional auto-refresh on `handoff` (`LEERNESS_AUTO_GRAPH=1`).

Full command reference, workflows, and architecture: **[README.ko.md](./README.ko.md)** (Korean) · `leerness commands` · `leerness help`.

## Links

- npm: https://www.npmjs.com/package/leerness
- Site & release videos: https://leerness.pages.dev
- Changelog: [CHANGELOG.md](./CHANGELOG.md)

## License

MIT

<!-- leerness:project-readme:start -->
## Leerness Project Harness

이 프로젝트는 Leerness v1.35.15 하네스를 사용합니다. AI 에이전트는 작업 전 `leerness handoff`로 컨텍스트를 적재하고, 작업 후 `leerness check`/`leerness audit`/`leerness session close`를 수행해야 합니다.

### 정체성 — AI 에이전트 운영 레이어 (UR-0030)

Leerness 는 **실행기/코딩 에이전트가 아니라**, 어떤 AI 코딩 에이전트(Claude Code · Codex · Cursor · Goose 등) 위에도 얹는 **범용 운영 레이어**입니다. 5개 공통 계층을 제공합니다:

- **기억(Memory)** — 프로젝트 상태/결정/진행을 `.harness/` 에 영속화
- **정책(Policy)** — 8단계 권한 등급 + enforce (read-only→publish), MCP 호출 게이트
- **인수인계(Handoff)** — 에이전트 간 컨텍스트 표준 전달 + `get_project_context` 1콜 온보딩
- **검증(Verification)** — 근거 기반 완료 검증으로 허위 완료 차단
- **감사(Audit)** — drift/idempotency/secret/encoding 자동 감사 + self-heal

AGENTS.md(정적 지침)을 **대체하지 않고 보완**합니다 — 정적 규칙은 AGENTS.md, 동적 상태·검증·인수인계는 leerness. 정체성 조회: `leerness about` (MCP `leerness_about`).

### Core Commands

```bash
leerness handoff .            # 세션 시작 컨텍스트 자동 로드
leerness status .             # 설치 상태
leerness verify .             # 필수 파일 검증
leerness audit .              # 일관성·계획-진행 정렬 감사
leerness scan secrets .       # 시크릿 패턴 스캔
leerness encoding check .     # UTF-8 / BOM / NUL / .bat 인코딩 검사
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

Leerness v1.35.15는 stdio JSON-RPC MCP server를 내장합니다 — Claude Code · Cursor · Codex CLI 등 외부 AI에 **86개 도구**를 노출:

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
// tools/list 응답: 86 도구
```

### Autonomous mode (자율 모드)

`<<autonomous-loop-dynamic>>` 신호만 보내면 AI가:
1) 다음 라운드 후보 선정 → 2) 코드 변경 → 3) stress-v* 신규 작성 + 누적 회귀 → 4) e2e 219/219 → 5) npm pack + git tag + GitHub release → 6) main 자동 push (1.9.140+) → 7) session close → 8) 다음 라운드 예약.

현재 누적: **70 라운드 (1.9.40 → 1.35.15)** · 매 라운드 GitHub release/태그 생성 · _reports/는 비공개 보존.

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

Last synced by Leerness v1.35.15: 2026-07-07
<!-- leerness:project-readme:end -->

