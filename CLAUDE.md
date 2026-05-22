<!-- leerness:managed -->
# Claude Code Instructions

Follow AGENTS.md. Always run `leerness handoff .` at the start and `leerness session close .` before ending a session.

**⭐ 매 세션 첫 행동 (1.9.39+)**: `.harness/session-workflow.md`의 6단계 워크플로(요청분석→계획→분배→sub-agent→종합검증→마감)를 따라야 함. drift critical 시 `leerness drift check --auto-fix`로 자동 회복.

Protected files must not be deleted. Read .harness/anti-lazy-work-policy.md before claiming completion.

## 자연어 영구 룰 (1.9.8)
사용자가 "매 X마다 Y를 해줘" 같은 자연어 룰을 말하면 즉시 `leerness rule add "Y" --trigger every-X`로 등록하세요. 등록된 룰은 매 세션 `handoff`가 자동 출력하고, `session close`가 자동 검증해 보고합니다. 사용자가 "중지" / "그만" / "끄기"를 명시할 때만 `rule pause/remove`를 호출합니다.

자세한 매핑은 AGENTS.md의 "자연어 룰 처리" 표를 참고하세요.

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
