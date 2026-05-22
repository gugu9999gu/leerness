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
