# leerness

**2.0.0 major transition:** ordinary handoff reads do not record a session, default JSON may omit diagnostics, and `doctor.healthy` can be null. Existing 1.x consumers must follow the [consumer transition guide](docs/lean-readonly-compatibility.md) and [2.0.0 release notes](docs/release-notes-2.0.0.md). A candidate or source version does not establish publication; verify the approved artifact and registry version using the [install/update/rollback guide](docs/release-candidate-guide.md).

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

[![npm](https://img.shields.io/npm/v/leerness)](https://www.npmjs.com/package/leerness) · ![MCP tools](https://img.shields.io/badge/MCP--tools-104-blue) · **0 runtime deps** · **0 install scripts** · offline-first · Node ≥ 18 · MIT

**🇰🇷 한국어 전문: [README.ko.md](./README.ko.md)**

**2.0.0 is an unreleased candidate.** The public release observed on 2026-11-08 was **1.36.305**. A source version or local tarball does not establish publication or release approval. Existing 1.36.305 users do not need to install this candidate.

The candidate changes observable 1.x contracts: ordinary handoff reads no longer record sessions or run environment diagnostics, default JSON can omit diagnostics, and `doctor.healthy` can be `null`. Read the [2.0.0 changes, upgrade and rollback notes](docs/release-notes-2.0.0.md) before updating hooks or JSON consumers. Installing a package does not by itself update project instructions or restore project data.

---

검수 batch의 명시적 로컬 저장 API: [소유권 세대·스냅샷·CAS·복구](docs/review-control-api.md). 자동 검수/승인과 runtime 전환은 별도 단계입니다.

한국어 설명을 유지하며 새 하네스를 영어로 작성하려면 [선택형 작성 언어](docs/authoring-language.md)를 설정할 수 있습니다. 기존 기록은 자동 번역하지 않습니다.

작업자·검수자의 반복 읽기를 줄이는 [컨텍스트 읽기 범위](docs/context-reading.md)는 현재 규칙과 담당 작업을 재사용하도록 안내합니다. 실제 소스·검증 근거 확인은 유지하며, 기존 프로젝트에는 하네스 업데이트가 필요합니다.

개발 중인 CTX-02B는 `.leerness/archive/history/index.json`으로 보존 task의 ID·상태·원본 digest를 색인해 전체 집계와 ID 예약을 유지하고, 정확한 task 조회·검증·검색 때만 보존 원문을 확인합니다. 보관 적용·복원·자동 정리는 아직 활성화하지 않습니다.

## Try it in 30 seconds

Unpinned `npx` resolves the published package, observed here as 1.36.305; it does not install this unreleased candidate. Recording and diagnostic behavior depends on that selected version.

```bash
npx -y leerness init . --yes   # adds .leerness/ memory + guard files to your project
npx leerness handoff .         # read context; see version-specific recording behavior below
```

In this 2.0 candidate, ordinary `handoff`, `handoff --compact` and `handoff --json` read stored context without session or freshness writes, environment/provider inventories, or automatic workspace migration. This applies on the first read without a Leerness cache too; it is not a timing guarantee. Use `handoff --record` when presence or a freshness receipt is required, `handoff --inspect` for diagnostics, and `handoff --writeback` only when automation explicitly needs legacy state updates. `--no-record` suppresses recording. A session that has only read is invisible to other sessions, so an empty session list does not prove nobody else is working. See [the exact flag effects and read limits](docs/lean-readonly.md).

For an existing project using `.harness/`, ordinary observation commands leave it in place; a stateful command can still trigger the legacy workspace transition. Inspect an isolated project copy first with `leerness migrate-workspace-dir <project-copy> --dry-run`; omit `--dry-run` only for an explicitly chosen migration. The migration retains the legacy tree in ignored `.leerness-backup/` after canonical copies and hashes verify, preserves an existing structured-state substrate, remaps old observability runs, and rewrites operational path references. It refuses independently live conflicting state, an existing backup destination, or escaping links/junctions. Retain hidden files, untracked originals and all existing backups; Git alone may not contain them. Follow the [upgrade and recovery procedure](docs/release-notes-2.0.0.md#upgrade-with-originals-preserved).

For Cursor, `npx leerness adapter cursor --path .` preserves existing project hooks and generates a local `sessionStart` bridge that maps the host's session address to `LEERNESS_SESSION_ID`. Verify hook execution and rule applicability in the actual installed editor before relying on them. If the host supplies no session identity, provide one explicitly; in the 2.0 candidate, request `handoff --record` when a receipt is required.

Your project now has agent-independent memory. To see the flagship feature — catching a false "done" claim:

```bash
npx leerness task add "Implement payment API"   # prints the new id, e.g. T-0002 — use it below
npx leerness task update T-0002 --status done --evidence "payment.js implemented + tested"
npx leerness verify-claim T-0002   # exit 1 — payment.js does not exist. Claim rejected.
```

Now write the implementation and record evidence, then run the **same** `verify-claim T-0002` again. A successful check means the applicable evidence checks passed; creating a file alone does not prove that the payment API works.

> Tip: test counts are static declaration-pattern heuristics, not execution or coverage proof. Add `--run-tests --test-cmd "<your trusted test command>" --json` to check the selected command's exit status and supported reporter output. `evidenceLevel: "executed"` includes failed runs; inspect `ok`, `reasons`, and `run` together. `semanticVerified` remains `false`. See [verification evidence and runnable examples](docs/verification-evidence.md) for skipped runs, unparsed output, and reporting limits.

> Want a smaller footprint? `leerness init . --minimal` installs only the core memory + verification files instead of the full set.

---

## No terminal? Let your AI run it

You never have to type a command yourself. Paste this into Claude Code, Cursor, Codex, or any coding agent:

> Set up leerness in this project by running `npx -y leerness init . --yes`. Follow my existing project rules and use the host agent's planning and test tools. Read `leerness handoff .` when project context is needed, select verification commands for the work's actual acceptance criteria, and use `leerness session close .` when a handoff needs recording. Keep my custom instructions and backups.

The agent installs and operates it for you. In this candidate, newly generated AGENTS/CLAUDE/Cursor/Copilot guidance makes Leerness tools optional unless an actual owner or project policy requires them. Retained custom text and existing rules remain authoritative. Existing instructions need an explicit, rehearsed project migration; external editor applicability needs its own check.

Prefer pure natural language? leerness ships an **MCP server with 104 tools** (`leerness mcp serve`). Connect it once to Claude Desktop / Claude Code and just ask: *"what was I working on?"*, *"did the AI actually finish T-0001?"*

Explicit-input rule applicability advisory: [`rule assess` and `leerness_rule_assess`](docs/rule-applicability.md). This does not change existing rules or gates.

Unpublished development interface: [`memory-migration inspect` and its MCP tool](docs/memory-migration-observation.md) inspect and recheck bounded legacy migration candidates without writing files.

Unpublished development interface: [explicit memory migration](docs/memory-migration-write.md) retains original Markdown before CLI `prepare`, `apply` and `rollback` steps. Each write command requires `--confirm`.

Unpublished development behavior: [memory item admission](docs/memory-item-admission.md) rejects unsupported writer items before duplicate checks or publication, preserving original domain files on rejection.

Optional [memory command policies](docs/memory-command-policy.md) apply explicit resource limits to CLI/MCP decision and lesson writes before candidate serialization. Operating defaults remain unchanged.

Unpublished development API: [memory candidate budgets](docs/memory-candidate-budget.md) measure caller-supplied JSON against explicit limits without enabling writer limits or granting write permission.

Unpublished development API: [memory footprint observation](docs/memory-footprint.md) checks bounded file bytes and recovery metadata without exporting content or enabling writer limits.

Unpublished development interface: [`review-snapshot candidate|compare --stdin` and `leerness_review_snapshot`](docs/review-snapshot-transport.md) compare caller-supplied snapshot bindings without source inspection, persistence, model calls or review approval.


---

## Claude and Codex already have memory. Why leerness?

Built-in harnesses remember what the AI **said**. leerness verifies what the AI **did** — and keeps working when you switch agents.

| | Built-in (CLAUDE.md, agent memory) | leerness |
|---|---|---|
| Memory | per-agent, free-form notes | structured tasks / decisions / lessons / rules — agent-independent files in your repo |
| "Done" claims | trusted as written | **evidence-gated**: claimed files, test counts, and run output are checked against reality — bluffs exit 1 |
| Switching agents (Claude → Codex → Cursor) | context lost | same `.leerness/` state, same one-call handoff |
| Secrets · encoding · drift guards | none | `scan secrets` · `encoding check` · `drift check --auto-fix` — CI-ready |
| Lock-in | one vendor | any agent, any language, 0 runtime dependencies |

---

## Role-first model routing and fallback

Roles remain stable while providers and models are replaceable execution resources. Configure a role with a primary executor, ordered candidates, and a fallback policy, then resolve the current task against separate installation, opt-in, authentication, entitlement, quota, reachability, and policy signals:

```bash
leerness roles set coder --provider codex --model gpt-model-id \
  --candidate claude:claude-model-id --policy balanced
leerness roles validate --json
leerness agents resolve "implement the API" --role coder --json
leerness agents fallback provider "implement the API" --role coder \
  --provider claude --model claude-model-id --approved-by owner --json
leerness agents history --json
```

Resolution never silently executes a fallback. Each applied choice is bound to the role-store and availability revisions it inspected. High-risk substitutions require a visible approver, lowering detected high risk requires both `--approved-by` and `--reason`, and high-risk review is selectable only when different families can be inferred from concrete model IDs. `dispatch` and `fallback` normally prepare or record a choice with `executed:false`. Role-free `agents multi --execute` and `agents bench` can spawn opted-in external CLIs and record their outcomes; both reject `--role` because provider-default fan-out cannot prove one role/model contract.

---

## Make it enforced, not optional

Before changing a multi-agent project's storage, inspect its actual workspace and proposed
Git-private/common scopes with `leerness state inspect . --json`. It is read-only: no data
migration, runtime activation, or provider calls. See [the state inspection API](docs/state-paths-api.md)
and [the staged architecture plan](docs/state-scopes.md).

`leerness state compatibility . --json` separately checks whether the observed runtime
layout permits this client's legacy writes. It creates no state and exposes bounded
failure reasons. This is a pre-migration compatibility guard, not a migration or a way
to stop older clients. See [the compatibility API and limits](docs/runtime-compatibility-api.md).

By default leerness is **cooperative**: your AI agent runs the commands because CLAUDE.md / AGENTS.md tell it to. A determined agent could skip them. To turn the guideline into a guardrail:

```bash
leerness ci init          # writes .github/workflows/leerness-gate.yml — runs `leerness gate` on every PR
```

The generated workflow is production-grade: it **pins the leerness version** (reproducible — the gate's verdict can't change from a silent upgrade), runs with **least-privilege permissions** (`contents: read`), and cancels superseded runs.

Then make that check **required** in GitHub branch protection. Now a PR that skips verification (or whose claims fail) **cannot merge** — the gate runs independently of the agent, returns a non-zero exit code, and blocks. That is the difference between a guideline and a guardrail. For exact per-claim enforcement, run `leerness gate --claims` — it adds a 6th check that runs `verify-claim` on **every** completed task and fails the gate if any "done" task's evidence doesn't match reality (the default 5-check gate already blocks false-done via heuristics; `--claims` makes it precise). A task is a completed claim when its tracker status is exactly `done`, `completed`, `verified` or `완료` (any case, also in brackets as older trackers wrote it, `[완료]`); `unverified`, `not-done` or `미완료` are not.

For a mature repository that predates strict claim verification, do not rewrite historical evidence merely to make the gate green. Create an explicit, reviewed debt boundary instead:

```bash
leerness verify-claim baseline create --before T-0123 --yes
leerness verify-claim --all          # applies exact-match legacy debt policy
leerness verify-claim --all --raw    # ignores the baseline and audits raw verdicts
```

The baseline stores no replacement evidence. It accepts only failures before the named tracker row whose **complete row and failure reasons still match their SHA-256 fingerprint**. A changed legacy row, a newly failing task, an entry at/after the boundary, or a corrupt baseline fails closed. `verify-claim <T-ID>` always remains raw for focused audits. Creation is one-shot: the CLI refuses to recalculate or overwrite an existing baseline, so a changed historical row cannot be relaundered by rerunning the command. The tracked `.leerness/claims-baseline.json` is repository policy, not a signature against a malicious repository writer: protect any removal or replacement with ordinary branch review and CODEOWNERS when the threat model requires that separation.

For read-only `verify-claim --all`, completed claims share one Git working-tree snapshot taken when the first claim needs it. A sweep with `--run-tests` or `--referee` reads Git per claim because those commands can change files during the sweep. A single-task check continues to read Git for itself.

For secrets, pair the gate with a **dedicated scanner** in the same workflow. `scan secrets` gives your agent the same signal locally; a dedicated scanner is the hard-guarantee layer:

```yaml
# add to .github/workflows/leerness-gate.yml (or a separate job)
- uses: gitleaks/gitleaks-action@v2                 # dedicated scanner — the hard-guarantee layer
- run: npx leerness@<pinned-version> scan secrets . --json   # same check your agent runs locally
```

---

## Low-risk by design

**MIT · 0 runtime dependencies · offline-first**, and all state is plain files in *your* repo. Lock-in is near zero — if it doesn't earn its place, remove the tool and your `task` / `decision` / `lesson` files stay exactly where they are. **Pin a version** in CI so the gate's verdict can't change from a silent upgrade.

---

## What is inside (the 60-second tour)

- **Memory** — `task` / `plan` / `decision` / `lesson` / `rule`: canonical JSON + markdown projections, archive/restore.
- **Handoff** — `handoff` (session start context) · `session close` (closing report). Survives agent swaps.
- **Verification** — `verify-claim` (evidence vs reality, stub/fake-test/inflated-count detection, `--run-tests --test-cmd` for any language; `--all` checks every completed claim for CI; `baseline create --before <T-ID> --yes` isolates fingerprint-bound legacy debt; `--raw` audits the original verdicts) · `contract verify` (spec ↔ impl) · `gate` (one-call CI gate).
- **Audit** — `audit` · `lazy detect` · `drift check` keep the workspace honest over time.
- **Security** — `scan secrets` (committed-secret detection) · `encoding check` (BOM/CP949) — also runs at `session close`.
- **Visualize** — `graph --html` writes a self-contained interactive ontology graph (`leerness.html`) of the whole harness (memory surfaces + skills + feature-graph) — click a node to read its content. Optional tracked auto-refresh: `LEERNESS_AUTO_GRAPH=1 leerness handoff . --writeback`.

Full command reference, workflows, and architecture: **[README.ko.md](./README.ko.md)** (Korean) · `leerness commands` · `leerness help`.

## Links

- npm: https://www.npmjs.com/package/leerness
- Site & release videos: https://leerness.pages.dev
- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- How this gets tested — methodology, results, and limitations: [docs/clean-room-evaluations.md](./docs/clean-room-evaluations.md)
- Quality terms (QA, QC, gate, RCA, CAPA, traceability) mapped to the commands that do them, what may block, and what is not built yet: [docs/quality-system.md](./docs/quality-system.md)
- Local development addition (unreleased): [review-checkpoint CLI/MCP advisory](./docs/review-checkpoint-transport.md). This checkout includes `leerness_review_checkpoint`; published packages may not include it. It does not approve work or call a model.
- Interoperability (MCP · ACP stance · state substrate): [docs/interoperability.md](./docs/interoperability.md)
- Contributing & test tiers (`test:fast` / `test:core` / `npm test`): [CONTRIBUTING.md](./CONTRIBUTING.md)

## License

MIT

<!-- leerness:project-readme:start -->
## Leerness Project Harness

이 프로젝트는 Leerness v2.0.0 하네스를 사용합니다. 호스트 에이전트의 계획·검토·테스트 도구를 재사용합니다. `leerness handoff`·`leerness check`·`leerness audit`·`leerness session close`는 관련이 있거나 명시적으로 선택했거나 적용되는 현재 사용자·프로젝트 규칙이 요구할 때만 사용합니다. 완료 주장에는 실제 근거가 필요하며 명령과 쓰기는 해당 범위의 승인이 필요합니다.

### 정체성 — AI 에이전트 운영 레이어 (UR-0030)

Leerness 는 **실행기/코딩 에이전트가 아니라**, 어떤 AI 코딩 에이전트(Claude Code · Codex · Cursor · Goose 등) 위에도 얹는 **범용 운영 레이어**입니다. 5개 공통 계층을 제공합니다:

- **기억(Memory)** — 프로젝트 상태/결정/진행을 `.leerness/` 에 영속화
- **정책(Policy)** — 8단계 권한 등급 + enforce (read-only→publish), MCP 호출 게이트
- **인수인계(Handoff)** — 에이전트 간 컨텍스트 표준 전달 + `get_project_context` 1콜 온보딩
- **검증(Verification)** — 근거 기반 완료 검증으로 허위 완료 감지 (권고; CI 게이트 필수화 시 차단)
- **감사(Audit)** — drift/idempotency/secret/encoding 자동 감사 (self-heal: drift·idempotency --auto-fix, encoding --apply; secret 은 감지 전용)

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
leerness plan add "M-XXXX 계획" --next "다음 단계"
leerness plan list
# Lessons (영구 교훈)
leerness lesson save "교훈 본문" --tag perf
leerness lesson list --query "키워드"     # 1.9.139
# DELETE → RESTORE (1.9.126~128)
leerness memory archive list . --query "키워드"   # 1.9.138
leerness memory restore decision <date|title>
```

### MCP server (외부 AI 통합)

Leerness v2.0.0는 stdio JSON-RPC MCP server를 내장합니다 — Claude Code · Cursor · Codex CLI 등 외부 AI에 **104개 도구**를 노출:

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
// tools/list 응답: 104 도구
```

### Autonomous mode (자율 모드)

`<<autonomous-loop-dynamic>>` 신호는 적용되는 현재 규칙 안에서 범위가 정해진 개발 반복을 요청할 수 있습니다.
관련 변경과 실제 테스트를 선택합니다. 신호·테스트 통과·session close는 배포 승인이 아니며, npm 게시·Git 태그·main push·다음 라운드 예약은 해당 작업과 대상을 명시한 승인이 필요합니다.

현재 사용 중인 하네스 버전: **2.0.0**. 공개 릴리스 여부는 공개 저장소의 태그와 배포 기록에서 별도로 확인합니다.

### 성능 가이드

- `leerness handoff .` — 필요한 프로젝트 컨텍스트 조회
- `leerness memory status --json` — 메모리 상태 조회
- `leerness task list --json` — 작업 목록 조회
- `leerness drift check --json` — 명시적으로 선택한 정합성 진단
- MCP `tools/list` — 사용 가능한 도구 목록 조회
- 실행 시간은 데이터·환경·캐시 상태에 따라 달라집니다. 필요한 명령만 선택하고 같은 조건에서 직접 측정합니다.

### 빠른 시작

```bash
# 1. 설치 (글로벌)
npm install -g leerness

# 2. 프로젝트에 하네스 설치
cd my-project && leerness init . --yes --skills recommended

# 3. 필요한 경우 컨텍스트 읽기
leerness handoff .            # 컨텍스트 자동 로드

# 4. 기록이 필요한 경우 마감 도구 선택
leerness session close .      # 9 카테고리 + 룰 검증 + 다음 라운드 추천

# 5. release 자동화 (main 자동 push 포함)
leerness release pack --close --auto-main-push
```

### Planning Files

- `.leerness/plan.md`: 전체 목표, milestone, 제외/드랍 범위
- `.leerness/progress-tracker.md`: 요청 단위 상태와 증거
- `.leerness/current-state.md`: 지금 이어서 할 작업
- `.leerness/session-handoff.md`: 다음 세션 인수인계 (자동 작성)
- `.leerness/lessons.md` / `decisions.md` / `rules.md`: 영구 메모리 (5 surface)

Last synced by Leerness v2.0.0: 2026-11-08
<!-- leerness:project-readme:end -->
GitHub 로그인 계정 확인용 서버 어댑터: [설정·연결·승인과의 구분](docs/github-login.md). 실제 앱 등록/브라우저 세션 연결과 대상별 승인은 후속입니다.

지정 검수자의 결과에는 실패 이유·필수 개선 결과·통과 조건을 남깁니다. `review-feedback start|submit|show`는 기준과 지적 이력을 고정하고, 진전 없는 반복이나 횟수 소진을 판단 요청으로 종료합니다. 1차·최종처럼 검수자를 순서 있는 단계로 지정할 수 있고(단계마다 새 세션), NO GO이면 통과 조건별 상태·남은 검수 횟수·다음 명령을 담은 GO까지의 경로를 프로젝트 언어로 보여 줍니다. [설정·사용 예와 적용 범위](docs/review-feedback.md).

설치·업데이트의 README·환경설정·줄 병합·마이그레이션 보고서 저장은 잘못된 문자나 감지된 동시 수정이 있으면 중단합니다. 정상 다국어와 기존 설정값을 보존하며, 도중에 실패하면 앞서 완료된 단계를 알립니다. [저장 검사와 적용 범위](docs/install-text-storage.md).

로그인 없이 화면 문구와 검수 결과를 검사하려면 [UI 검사 명령 사용법](docs/ui-review-cli.md)의 `ui scan` 및 `ui review packet|assess`를 사용합니다.

쉬운 작업 보고는 설치 프로젝트에서 `leerness toggle set plain-language-reporting on`으로 켭니다(기본 꺼짐). 한 번만 쉽게 설명해 달라는 요청은 설정을 바꾸지 않습니다. [중복 정보 검사](docs/ui-information-quality.md)는 `leerness ui information --stdin --json`으로 제공된 화면 메타데이터를 검토하며 자동 삭제나 승인 없이 후보와 판단 불가를 구분합니다.

[TEST-01 검사 계획](docs/test-execution-plan.md)은 `leerness test-plan assess --stdin --json`으로 선언된 실패 검사, 관련 검사, 필수 최종 검사의 순서와 미실행 항목을 보여 줍니다. 계획만 만들며 검사 실행이나 통과 판정은 하지 않습니다.

로컬 에뮬레이터나 서버의 포트가 열려 있는지는 `leerness test-plan probe --stdin --json`으로 짧게 확인할 수 있습니다. `leerness test-plan http-probe --stdin --json`은 로컬 HTTP 응답이 지정한 상태·본문 조건과 맞는지도 확인합니다. `leerness test-plan firestore-probe --stdin --json`은 로컬 Firestore 규칙 검사 응답의 형식을 관측하고, 선택적으로 Firebase 허브가 알리는 포트와 대조합니다. `leerness test-plan script-probe --stdin --json`은 개별 npm 검사 명령의 존재를 확인하고 검증되지 않은 필터 옵션을 거부합니다. 어느 결과도 서비스 신원이나 실제 테스트 통과를 증명하지는 않습니다. [입력 예시와 제한](docs/test-execution-plan.md)을 확인하세요.

Node 기본 실행기의 검사 한 건을 실제로 실행하려면 `leerness test-run node --stdin --json`에 신뢰하는 검사 파일과 정확한 이름을 명시합니다. 0건·복수건 선택을 통과로 처리하지 않으며, npm 전체 검사 명령이나 최종 자동 검증의 통과 증거로 재사용하지 않습니다. [실행 예시와 제한](docs/test-execution-plan.md)을 확인하세요.

명시한 npm 검사 명령 하나를 실행하려면 `leerness test-run npm-script --stdin --json`에 앞선 `script-probe`의 명령·패키지·스크립트 해시를 함께 전달합니다. 명령이 종료 코드 0으로 끝나도 내부 검사가 정확히 한 건만 실행됐는지 또는 통과했는지는 확인되지 않습니다. [실행 예시와 제한](docs/test-execution-plan.md)을 확인하세요.

검사 묶음에서 대상이 실제 선택 목록에 있는지는 `leerness test-run suite-list --stdin --json`으로 신뢰하는 프로젝트 명령의 `--list` 결과를 관측합니다. 개별 검사 이름이 등록돼 있어도 묶음에서는 제외될 수 있습니다. 이 목록은 검사 실행이나 통과의 근거가 아닙니다. [입력 예시와 제한](docs/test-execution-plan.md)을 확인하세요.

설치 중에는 별도의 "CLI 에이전트 활성화"를 묻지 않습니다. Codex·Claude Code 등은 생성된 프로젝트 지침과 어댑터를 각 프로그램에서 읽습니다. 기존에 Leerness의 별도 에이전트 위임을 설정한 프로젝트의 `LEERNESS_ENABLE_*` 값은 설치·업데이트 과정에서 보존됩니다.
