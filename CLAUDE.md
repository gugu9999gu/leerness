<!-- leerness:managed -->
# Claude Code Instructions

Follow AGENTS.md. Always run `leerness handoff .` at the start and `leerness session close .` before ending a session.

**⭐ 매 세션 첫 행동 (1.9.39+)**: `.harness/session-workflow.md`의 6단계 워크플로(요청분석→계획→분배→sub-agent→종합검증→마감)를 따라야 함. drift critical 시 `leerness drift check --auto-fix`로 자동 회복.

Protected files must not be deleted. Read .harness/anti-lazy-work-policy.md before claiming completion.

## 자연어 영구 룰 (1.9.8)
사용자가 "매 X마다 Y를 해줘" 같은 자연어 룰을 말하면 즉시 `leerness rule add "Y" --trigger every-X`로 등록하세요. 등록된 룰은 매 세션 `handoff`가 자동 출력하고, `session close`가 자동 검증해 보고합니다. 사용자가 "중지" / "그만" / "끄기"를 명시할 때만 `rule pause/remove`를 호출합니다.

자세한 매핑은 AGENTS.md의 "자연어 룰 처리" 표를 참고하세요.

## 사용자 명시 신규 7종 (1.9.207~213) — 백로그 완전 소진

### 1.9.207 — 사용자 요청 누락 확인 절차
- `leerness requests audit|add|list|complete|drop` — 사용자 명시 요청 누적 추적
- `.harness/user-requests.json` 자동 ID(UR-XXXX) + 중복 방지
- handoff 헤드라인 자동 노출 — `📥 미답 요청 N건` (critical) 또는 `📥 요청 N (tracked)`

### 1.9.208 — 플랫폼/API 제약 사전 체크
- `leerness constraints list|check|add` — Stripe/OpenAI/Anthropic/GitHub/Discord/Twitter 6종 기본 catalog
- `review-request` 자동 통합 — 텍스트에서 플랫폼 alias 매칭 → 제약 사전 노출
- 사용자 정의: `leerness constraints add <id> --alias name --constraint "kind:detail"`

### 1.9.209 — pre-wake sub-agent audit
- `leerness pre-wake-audit` (`--last` / `--json`) — sleep 전 6영역 점검 (missing-request / stale-progress / drift / wakeup-missed / next-action / auto-resume)
- handoff 자동 노출 — `🔍 pre-wake NC/MW (ageMin)` + 본문 섹션 (4시간 이내만)

### 1.9.210 — adaptive wakeup interval
- `leerness wakeup-interval get|set|auto|history|record` — 600~2700s 범위 자동 조절
- user-trigger 3+/2h → 15min / 활동 0 → 35min / pre-wake critical → 20min
- opt-out: `LEERNESS_FIXED_INTERVAL` env 또는 `set <secs>`

### 1.9.211 — .harness → .leerness opt-in 마이그레이션
- `leerness migrate-workspace-dir` (`--dry-run` / `--force`) — 전체 재귀 copy + 자동 마커
- `leerness workspace-dir get|guide` — 현재 디렉토리 + AI 참조 가이드
- 자동 생성: `.leerness/WHERE_TO_FIND.md` (디렉토리 구조 + 자주 묻는 위치)
- 기본 동작: `.harness` 유지 (breaking change 0)

### 1.9.212 — 멱등성 감사 + dedup 보강
- `ruleAdd` / `taskAdd` — 같은 텍스트 + 활성 상태 시 자동 skip (`--force` 우회)
- `leerness idempotency audit` — 4영역 점검 (rules / tasks / user-requests / wakeups) + severity 분류

### 1.9.213 — intent inference + scope expansion 게이트 ⭐
- `leerness intent classify|expand|domains` — 사용자 의도 파악 (precise/broad/default) + 5 도메인 catalog
- 3원칙 안전: (1) Always-Off Opt-In, (2) Dry-run 기본 (실행 X), (3) 명시 vs 추론 분리 라벨링
- 예: `leerness intent expand "맵+캐릭터+기본 게임 기능"` → `game` 도메인 자동 탐지 + 8 확장 후보 dry-run

## 운영 강화 8 라운드 (1.9.214~221)

### 1.9.214 — drift 차단 + AGENTS/CLAUDE 7 라운드 통합
- CLAUDE.md 신규 7 라운드 누적 갱신

### 1.9.215 — handoff 헤드라인 통합
- 현재 활성 task에서 constraints/intent 자동 분석
- `🚦 N 플랫폼 제약` / `🎯 intent broad/<domain>`

### 1.9.216 — MCP 5종 추가 (54→59)
- requests_audit / constraints_check / pre_wake_audit / intent_classify / idempotency_audit

### 1.9.217 — session close 자동 통합
- 마감 시 자동 호출: requests / pre-wake / idempotency
- `--no-pre-wake` opt-out

### 1.9.218 — handoff JSON 통합 강화 + 5축 100/100
- handoff --json: userRequestsAudit / preWakeAudit / idempotencyAudit
- 5축 매트릭스 100/100 도달

### 1.9.219 — 80 라운드 마일스톤
- `_reports/milestone-1.9.219-80-rounds.md`
- session-workflow.md 신규 기능 통합

### 1.9.220 — 비정상 종료 자율 재개 ⭐ (사용자 명시)
- `leerness session-resume` — 5신호 감지 (last-handoff/wakeup-missed/in-progress-stale/auto-resume-plan/release-branch)
- handoff 헤드라인: `🔌 비정상종료 severity (N신호)`
- 절전/시스템종료/AI 세션종료 후 재시작 시 자동 진단

### 1.9.221 — MCP 60 도구 마일스톤 🎉
- `leerness_session_resume` MCP 도구 (60번째)
- handoff/session close JSON 4 통합 필드 완성 (userRequests/preWake/idempotency/abnormalShutdown)

### 1.9.222 — session-resume --auto-fix + handoff 본문 자동 노출
- `leerness session-resume --auto-fix` — 오래된 wakeup 자동 supersede (안전 회복)
- handoff 본문에 `## 🚨/⚠ 비정상 종료 감지` 섹션 자동 (high/medium severity 시)

## 사용자 요청 자동 완료 시스템 (1.9.223~225) — 4 라운드 누적 완성

### 1.9.223 — requests auto-complete by pattern
- `leerness requests auto-complete` — "Round X.Y.Z — 구현 완료" 패턴 자동 감지
- 기본 dry-run, `--apply` 명시 시 적용
- 안전 가드: 현재 버전 이하만 후보 (미래 버전 무시)
- handoff 헤드라인 `📥 자동완료가능 N건` + JSON 5번째 통합 필드 `deliveredRequests`

### 1.9.224 — MCP 61 + handoff 본문 + session close --auto-apply-delivered
- MCP 도구 60 → 61 (`leerness_requests_auto_complete`)
- handoff 본문에 `## 📥 사용자 요청 자동 완료 가능` 자동 섹션
- `session close --auto-apply-delivered` 플래그 (마감 시 자동 완료)

### 1.9.225 — drift check --auto-fix 통합 + env opt-in
- `drift check --auto-fix` 시 delivered 패턴 자동 적용 (1.9.82 패턴 확장)
- `LEERNESS_AUTO_APPLY_DELIVERED=1` env opt-in (자율 모드용)
- handoff 첫 호출 시 자동 정리

## 라운드 진행도 가시화 (1.9.226~227)

### 1.9.226 — round-history CLI + handoff 헤드라인 + MCP 62
- `leerness round-history` 새 명령 (git tag v1.9.X 기반)
- 마일스톤 자동 감지 (50/75/100/125/150/175/200/250/300/400/500)
- handoff 헤드라인 17번째 요소: `🔄 R182 → R200 (18R 남음)`
- MCP 도구 61 → 62 (`leerness_round_history`)

### 1.9.227 — handoff/session close --json roundHistory 통합 + CLAUDE/AGENTS 누적
- handoff --json 6번째 통합 필드: `roundHistory`
- session close --json 6번째 통합 필드: `roundHistory`
- CLAUDE.md / AGENTS.md drift 차단 갱신 (1.9.222~226)

## 가시화 + 자동화 9 라운드 (1.9.228~237) ⭐

### 1.9.228 — health --json roundHistory + session-workflow.md drift 차단
- health --json 6번째 통합 필드: `roundHistory` (3 명령 일관성)
- session-workflow.md 갱신 (마지막 1.9.171 → 1.9.228)
- handoff 헤드라인 label list 갱신 (12 → 14 버전)

### 1.9.229 — leerness milestones CLI + MCP 63
- 도달 마일스톤 + ETA 예측 (25/50/.../500)
- MCP 도구 62 → 63 (+leerness_milestones)

### 1.9.230 — handoff/session close/health --json milestones 통합 + 헤드라인 ETA
- JSON 7번째 통합 필드: `milestones` (3 명령 일관성)

### 1.9.231 — leerness pulse 새 명령 + MCP 64
- 한 줄 종합 요약 (10 핵심 지표)
- MCP 63 → 64 (+leerness_pulse)

### 1.9.232 — pulse BUG fix + handoff --pulse + session close 자동 pulse
- pulse memorySurface BUG fix (T0/D0/R0/P0/L0 → 실제 카운트)
- `handoff --pulse` 옵션 신설
- session close 끝에 pulse 한 줄 자동

### 1.9.233 — leerness commands CLI + MCP 65
- 9 카테고리 51 CLI 명령 목록
- MCP 64 → 65 (+leerness_commands)

### 1.9.234 — handoff/session close/health --json recentChanges (8 필드)
- JSON 8번째 통합 필드: `recentChanges` (최근 5 라운드 자동 회수)
- AI 컨텍스트 절약 (~500 토큰)

### 1.9.235 — leerness release cleanup CLI
- 50+ release/* branches 정리 (수동, --apply --keep N)

### 1.9.236 — MCP 66 (release_cleanup) + drift --auto-fix 통합
- MCP 65 → 66 (+leerness_release_cleanup)
- `drift check --auto-fix` 50+ branches 자동 정리

### 1.9.237 — session close --auto-cleanup-branches + handoff body 50+ 경고
- 마감 시 자동 정리 (1.9.224 패턴 확장)
- handoff body 50+ branches 누적 경고 자동

## 사용자 명시 백로그 UR-0013~0018 (1.9.239~252) — 6 요청 완전 소진

### 1.9.239~240 — UR-0013: py 스크립트 + agent 모드 효율화
- `leerness py-check` / `agent-mode start|tick` 명령 + MCP 67/68
- handoff py auto-detect + JSON 9번째 필드 `pyFiles` + 헤드라인 통합

### 1.9.241~243 — UR-0014: 한국어 PowerShell/셸 인코딩 사전 감지
- `leerness env` + `env encoding [--apply]` — .ps1/.bat 비-ASCII + BOM 없음 → CP949 오인식 감지
- JSON 10번째 필드 `envInfo` + drift --auto-fix 통합 + CJK 분류 (Korean/Japanese/Chinese)

### 1.9.245 — UR-0015: API skill cache
- `leerness api-skill add <url> --direction "..."` — 공식 문서 + 관련 링크 자동 정리 (`.harness/api-skills/`)
- handoff 자동 매칭 노출 + audit `api_skill_missing` finding (1.9.247)

### 1.9.246~247 — UR-0016: REPL agent UX/UI
- 컨텍스트 게이지 + 서브에이전트 가시화 + 정상완료 초록색 강조 (status bar)
- multi-provider auto-fallback (`:fallback on` / transient 실패 시 자동 전환)

### 1.9.248 — UR-0017: Gemini CLI 제거 → Antigravity (agy)
- EXTERNAL_AGENTS / provider cycle / setup-agents / MCP / dispatch 전체 교체
- `LEERNESS_ENABLE_GEMINI` → `LEERNESS_ENABLE_AGY` · install hint `npm i -g @google/antigravity-cli`

### 1.9.249~252 — UR-0018: 터미널 출력 인코딩 자동 회복 (4 라운드)
- **1.9.249** (Windows): `_ensureStdoutEncoding()` IIFE — chcp 65001 자동 + stdout/stderr setEncoding('utf8'). opt-out `LEERNESS_NO_AUTOCHCP=1`
- **1.9.250** (POSIX): `posixEncodingOk` + `isWSL` 감지 (`/proc/version` microsoft / `WSL_DISTRO_NAME`) → JSON envInfo 4 필드 (terminalEncodingOk/autoChcpApplied/posixEncodingOk/isWSL) 3 명령 propagate
- **1.9.251** (init 안내): `_terminalEncodingNotice()` 헬퍼 신설 + `leerness init` 완료 시 인코딩 점검 노출
- **1.9.252** (DRY): env summary 인라인 분기를 헬퍼로 통합 + `agent-mode start` 인코딩 점검 (진입점 3곳 일관)

## 자율 모드 마일스톤 — 1.9.252 시점

- **R208 누적 라운드** (baseline v1.9.6)
- **🎉 114 main-push streak** (1.9.140 부터)
- **🎉 75 npm publish streak** (1.9.178 부터)
- **handoff/session close/health JSON 11 필드** (3 × 11 = 33 통합 포인트)
- **MCP 70 도구**
- **사용자 명시 백로그 UR-0013~0018 완전 소진**
- **9 카테고리 57 CLI 명령**

---
<!-- leerness:migration-preserved -->
## Preserved previous content

Previous content was backed up before migration. Archive reference:

`.harness/archive/leerness-1.9.206-2026-05-22T02-21-43-187Z`

<details>
<summary>Previous CLAUDE.md</summary>

```md
<!-- leerness:managed -->
# Claude Code Instructions

Follow AGENTS.md. Always run `leerness handoff .` at the start and `leerness session close .` before ending a session.

**⭐ 매 세션 첫 행동 (1.9.39+)**: `.harness/session-workflow.md`의 6단계 워크플로(요청분석→계획→분배→sub-agent→종합검증→마감)를 따라야 함. drift critical 시 `leerness drift check --auto-fix`로 자동 회복.

Protected files must not be deleted. Read .harness/anti-lazy-work-policy.md before claiming completion.

## 자연어 영구 룰 (1.9.8)
사용자가 "매 X마다 Y를 해줘" 같은 자연어 룰을 말하면 즉시 `leerness rule add "Y" --trigger every-X`로 등록하세요. 등록된 룰은 매 세션 `handoff`가 자동 출력하고, `session close`가 자동 검증해 보고합니다. 사용자가 "중지" / "그만" / "끄기"를 명시할 때만 `rule pause/remove`를 호출합니다.

자세한 매핑은 AGENTS.md의 "자연어 룰 처리" 표를 참고하세요.

## ⚠ 사용자 요청 사전 검토 의무 (1.9.176 사용자 명시)
사용자가 새 기능/구현 요청을 주면 **무조건 구현 전**에:
\`\`\`bash
leerness review-request "<사용자 요청>"
# 또는 REPL: :review "<request>"
\`\`\`
→ 충돌/재사용/효율/권장 단계 분석 결과를 사용자에게 제시 → 사용자 결정 후 구현.
*"그냥 바로 해줘"* 같은 명시적 옵트아웃 시에만 review 생략.

## REPL Agent (1.9.149~170) — 🎉 100 라운드 자율 마일스톤
사용자가 "에이전트 / REPL / 대화형 모드"를 요청하면 `leerness agent .` 실행:
- **Tab** → provider cycle (ollama ⇄ claude ⇄ codex ⇄ gemini ⇄ copilot)
- **Shift+Tab** → 현재 provider 모델 cycle (catalog 기준)
- 실시간 스트리밍 default ON — 추론중/diff/thinking 실시간 표시
- `:stream on|off`, `:provider <p>`, `:model <m>`, `:status`, `:verify`, `:audit`, `:lessons`, `:brainstorm <q>`

## Bridge 3종 (1.9.165~167) — opt-in 의존성
- 웹: `leerness web check|screenshot|extract <url>` — playwright opt-in
- PC: `leerness pc check|click|type|screenshot` — robotjs opt-in (⚠ full 권한)
- LSP: `leerness lsp check|symbols|references` — typescript opt-in + regex fallback (의존성 0)

**MCP 53 도구** (1.9.168) — 외부 AI 직접 호출. **6 능력 매트릭스 72% production-ready**.

```

</details>
