# leerness

```
██╗     ███████╗███████╗██████╗ ███╗   ██╗███████╗███████╗
██║     ██╔════╝██╔════╝██╔══██╗████╗  ██║██╔════╝██╔════╝
██║     █████╗  █████╗  ██████╔╝██╔██╗ ██║█████╗  ███████╗
██║     ██╔══╝  ██╔══╝  ██╔══██╗██║╚██╗██║██╔══╝  ╚════██║
███████╗███████╗███████╗██║  ██║██║ ╚████║███████╗███████║
╚══════╝╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝
```

> **AI 코딩 에이전트를 위한 운영 레이어(operating layer).** 코드를 대신 쓰는 도구가 아니라, AI 에이전트의 **기억·인수인계·검증·감사·보안 가드**를 프로젝트에 영속화하는 CLI + MCP 서버입니다.

[![npm](https://img.shields.io/npm/v/leerness)](https://www.npmjs.com/package/leerness) · ![MCP tools](https://img.shields.io/badge/MCP--tools-85-blue) · **런타임 의존성 0** · **install-script 0** · offline-first · Node ≥ 18 · MIT

> 이 문서는 **외부 다중 모델(Codex / Claude Sonnet / Claude Opus)이 README 를 보지 않고 leerness 를 직접 설치·실행·소스 분석한 객관 리뷰**를 바탕으로 재구성되었습니다. 매 릴리스마다 자동 갱신됩니다.

---

## leerness가 뭔가요?

AI 코딩 에이전트(Claude Code, Cursor, Codex, Aider, Goose 등)는 코드를 잘 쓰지만 세 가지 약점이 있습니다.

1. **기억하지 못합니다** — 세션이 바뀌면 현재 상태·결정·다음 작업을 잊습니다.
2. **거짓 완료를 선언합니다** — 증거(파일·테스트·로그) 없이 "완료했습니다"라고 말합니다.
3. **표준이 없습니다** — 여러 에이전트 간 인수인계, 보안/인코딩 점검, 드리프트 관리가 제각각입니다.

leerness는 이 문제들을 해결하는 **외부 운영 substrate**입니다. 어떤 에이전트 위에도 얹어, 프로젝트의 상태를 `.harness/` 파일로 영속화하고 CLI · MCP 도구로 노출합니다. **leerness 자체는 LLM을 호출하거나 코드를 실행하지 않습니다.**

---

## 해결하는 문제

| 문제 | leerness의 해법 |
|---|---|
| 세션 간 맥락·결정·다음 작업 유실 | `task`/`decision`/`lesson`/`plan`/`rule` 메모리를 영속화하고, 세션 시작 시 `handoff` 1콜로 회수 |
| 증거 없는 "완료" 주장 | `verify-claim --require-evidence`, `lazy detect`, anti-lazy 정책으로 차단 |
| Claude → Codex → Cursor 교체 시 맥락 소실 | 표준 세션 워크플로(handoff → 작업 → session close)로 에이전트 독립 인수인계 |
| 하드코딩 시크릿 · 인코딩 깨짐(BOM/CP949) | `scan secrets`, `encoding check` 자동 감지 (CI 게이트) |
| 워크스페이스 노화(drift)를 에이전트가 모름 | `drift check [--auto-fix]` 점수화 + 자동 회복 |
| 명세 ↔ 구현 불일치 | `contract verify spec.md impl.js` 함수/필드 일치 검사 |
| 여러 AI CLI의 역할/분배 표준 부재 | `agents`/`roles`/`team` 오케스트레이션(기본 opt-in, dispatch는 실행이 아닌 명령 생성) |

---

## 빠른 시작

```bash
# 설치 (런타임 의존성 0 — 추가 패키지 없음)
npm install -g leerness

# 프로젝트 초기화 (.harness/ 거버넌스 문서 + .claude/.cursor/.github 어댑터 생성)
leerness init .

# 세션 시작 — 이전 맥락/기억/다음 작업을 1콜로 회수
leerness handoff .

#   ... 에이전트가 작업 ...
leerness task add "사용자 인증 API 구현"
leerness gate .                 # verify + audit + scan secrets + encoding + lazy 통합 게이트

# 세션 종료 — 마감 통계 + 다음 라운드 추천 + 인수인계 문서 자동 생성
leerness session close .
```

CLAUDE.md / AGENTS.md 에 `세션 시작 시 leerness handoff .`, `종료 전 leerness session close .` 지침을 추가하면 에이전트가 자동으로 호출합니다.

---

## 거짓 완료 차단 — 핵심 차별점

세 모델의 블라인드 리뷰가 공통으로 꼽은 leerness의 핵심 가치입니다. AI 에이전트가 가장 자주 하는 거짓말 "다 했어요"를, leerness는 **완료 주장을 실제 코드와 대조**해 검증합니다.

```bash
# 에이전트가 "결제 API 연동 완료"라고 주장하지만 코드엔 호출 흔적이 없으면:
leerness verify-claim T-0001 --require-evidence
#   ⚠ FAIL (낙관 1) · [Payment] 결제: evidence에 주장 있으나 코드에 호출 흔적 없음 → exit 1
```

- `optimism-check` · `verify-claim` — evidence의 도메인 주장(API·DB·결제·이메일·큐·캐시·알림·스토리지 등 10종)을 실제 소스 호출과 대조. **JavaScript뿐 아니라 Python·Ruby·Go·C#·Java·PHP·Rust 구현도 인식**합니다(1.13).
- `lazy detect` — 증거 없는 done, 빈 handoff, 테스트 미실행, 미추적 TODO를 탐지.
- 정직한 완료는 통과하고 가짜 완료만 exit 1로 차단 — `gate` 또는 CI에 그대로 연결됩니다.

---

## 핵심 개념 — 5계층

- **기억(Memory)** — `task`/`plan`/`decision`/`lesson`/`rule`/`feature`(그래프). canonical JSON 을 단일 진실소스로 저장하고 마크다운은 projection. archive/restore 지원.
- **인수인계(Handoff)** — `handoff`(세션 시작 컨텍스트), `session close`(마감 보고). 에이전트 교체에도 맥락 보존.
- **검증(Verification)** — `verify-claim`(증거 강제), `contract verify`(명세↔구현), `verify-code`(테스트/빌드 실행 + 증거 기록).
- **감사(Audit)** — `scan secrets`, `encoding check`, `lazy detect`, `drift check`, `audit`, 그리고 이를 묶는 `gate`.
- **정책/보안(Policy)** — 8단계 권한 등급 enforce, 외부 에이전트 opt-in, 자연어 영구 룰(`rule add ... --trigger`).

---

## 명령 카테고리

- **초기화/진단**: `init` · `status` · `which` · `doctor` · `selftest` · `capabilities`
- **메모리**: `task` · `plan` · `decision` · `lesson` · `rule` · `feature` · `memory status/search`
- **인수인계/세션**: `handoff` · `session close` · `pulse` · `health`
- **검증/감사**: `check` · `gate` · `audit` · `drift check` · `lazy detect` · `scan secrets` · `encoding check` · `verify-code` · `verify-claim` · `contract verify`
- **외부 에이전트**: `agents list/check/dispatch` · `provider` · `roles` · `adapter`
- **운영/확장**: `release` · `migrate` · `team` · `install-safety` · `route` · `review`(페르소나)
- **브리지(opt-in)**: `web`(playwright) · `pc`(robotjs) · `lsp`
- **MCP**: `mcp serve` — stdio JSON-RPC 서버로 85개 도구 노출

전체 명령은 `leerness commands` 또는 `leerness --help` 로 확인하세요.

> **경로 규칙** — 대부분 명령은 `[path]` 위치 인자를 받습니다. `task`/`decision`/`lesson` 등 메모리 명령에 다른 폴더를 지정할 땐 `--path <dir>` 또는 `./dir` 형태를 쓰세요(맨 폴더 이름만 주면 현재 폴더로 처리됩니다). 출력은 한국어가 기본이며 `--language en` 으로 영어를 늘릴 수 있습니다(일부 메시지는 한국어 유지).

---

## 대표 워크플로

**기본 세션 사이클**
```bash
leerness handoff .                          # 이전 맥락 자동 로드
leerness task add "API 응답 검증 로직 구현"
leerness task update T-0001 --status in-progress --evidence "검증 함수 구현"
leerness gate .                             # 배포 전 통합 품질 게이트
leerness session close .                    # 마감 + 다음 에이전트 인수인계
```

**보안·검증 게이트 (CI)**
```bash
leerness scan secrets .                     # 커밋 대상 하드코딩 시크릿 → exit 1
leerness contract verify spec.md src/api.js # 명세 함수/필드 누락 → exit 1
leerness verify-claim T-0001 --require-evidence
```

**다중 에이전트 조율**
```bash
leerness agents list                        # 설치된 외부 AI CLI 가용성
leerness agents dispatch "코드 리뷰" --to codex   # 실행 명령 생성(직접 실행은 사용자/메인 에이전트)
```

**MCP (외부 AI 에이전트에 도구로 노출)**
```bash
leerness mcp serve                          # JSON-RPC over stdio, 85 도구
```

---

## 아키텍처 (외부 리뷰 검증)

- **런타임 의존성 0 / install-script 0** — `package.json` 의 dependencies/optional/peer 가 전부 비어 있고 postinstall 도 없습니다. 순수 Node stdlib(`fs`/`path`/`child_process`/`readline`). 공급망 공격면 최소. `leerness install-safety` 로 확인 가능.
- **canonical JSON 단일 진실소스 + 마크다운 projection** — 메모리는 JSON 으로 저장하고 사람이 읽는 `.md` 는 파생물. 파이프(`|`)·개행·백틱·이모지·한글이 마크다운 테이블에서도 안전(셀 이스케이프 + round-trip).
- **원자적 UTF-8 쓰기** — temp + rename 으로 부분쓰기 손상 방지, BOM 자동 strip.
- **shell 미경유 MCP** — `mcp serve` 의 도구 호출은 셸을 거치지 않고 인자를 직접 전달(명령 주입 차단).
- **순수 `--json` / 일관 exit code** — 성공·실패·미존재 경로 모두 파싱 가능한 JSON(`{ok,error,code}`) + 실패 시 exit 1. 자동화·CI 친화.
- **모듈 분리(DI)** + **내장 자가검증** — `lib/` 순수 유틸/IO/카탈로그 분리, `selftest` 210 케이스로 설치 무결성 검증(`doctor` 가 함께 실행). 문서(README) 부재에도 코어 무결성 진단은 통과.

---

## 차별점

- **진짜 0-dependency** — SaaS 가 아니라 파일 기반 로컬 운영 메모리. 네트워크 불필요(업데이트 확인 제외).
- **에이전트 중립** — Claude / Codex / Cursor / Aider / Goose 등 어디에나 적용.
- **거짓 완료 방지** — 완료 주장에 evidence 를 요구하는 anti-lazy 흐름.
- **통합 게이트** — 보안·인코딩·드리프트·검증을 `gate` 하나로.
- **한국어 우선 + Windows/인코딩 1급 시민** — CP949/BOM 가드, 한국어 출력 기본(`--language en` 지원).
- **자기기술(self-describing)** — `about`/`commands`/`capabilities`/`doctor` 로 도구가 스스로 설명.
- **지속적 외부 검증** — 다중 모델 클린룸 리뷰로 회귀 0 을 유지하며 진화.

---

## 보안

- 시크릿/키/토큰을 소스에 하드코딩하지 마세요. `.env` 사용 + `.gitignore` 포함. `scan secrets`/`gate` 가 커밋 대상 시크릿을 차단합니다.
- 외부 AI CLI 연동은 **기본 비활성**입니다(`LEERNESS_ENABLE_*` opt-in). 브리지(web/pc/lsp)도 opt-in.
- 자세한 권한 표면은 [SECURITY.md](./SECURITY.md) 참고.

---

## 링크

- 홈페이지: https://leerness.com
- npm: https://www.npmjs.com/package/leerness
- GitHub: https://github.com/gugu9999gu/leerness
- 변경 이력: [CHANGELOG.md](./CHANGELOG.md)

## 라이선스

MIT

<!-- leerness:project-readme:start -->
## Leerness Project Harness

이 프로젝트는 Leerness v1.16.0 하네스를 사용합니다. AI 에이전트는 작업 전 `leerness handoff`로 컨텍스트를 적재하고, 작업 후 `leerness check`/`leerness audit`/`leerness session close`를 수행해야 합니다.

### 정체성 — AI 에이전트 운영 레이어 (UR-0030)

Leerness 는 **실행기/코딩 에이전트가 아니라**, 어떤 AI 코딩 에이전트(Claude Code · Codex · Cursor · Goose 등) 위에도 얹는 **범용 운영 레이어**입니다. 5개 공통 계층을 제공합니다:

- **기억(Memory)** — 프로젝트 상태/결정/진행을 `.leerness/` 에 영속화
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

Leerness v1.16.0는 stdio JSON-RPC MCP server를 내장합니다 — Claude Code · Cursor · Codex CLI 등 외부 AI에 **85개 도구**를 노출:

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
// tools/list 응답: 85 도구
```

### Autonomous mode (자율 모드)

`<<autonomous-loop-dynamic>>` 신호만 보내면 AI가:
1) 다음 라운드 후보 선정 → 2) 코드 변경 → 3) stress-v* 신규 작성 + 누적 회귀 → 4) e2e 219/219 → 5) npm pack + git tag + GitHub release → 6) main 자동 push (1.9.140+) → 7) session close → 8) 다음 라운드 예약.

현재 누적: **70 라운드 (1.9.40 → 1.16.0)** · 매 라운드 GitHub release/태그 생성 · _reports/는 비공개 보존.

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

Last synced by Leerness v1.16.0: 2026-06-09
<!-- leerness:project-readme:end -->

