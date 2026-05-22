<!-- leerness:managed -->
# Leerness Agent Instructions

## ⭐ 매 세션 첫 행동 (1.9.39+)
**반드시 `.harness/session-workflow.md`를 먼저 읽고 6단계 워크플로를 따른다**: 요청분석→계획→분배→sub-agent작업→종합검증→마감. 라운드 길이/복잡도 무관, drift 방지를 위해 모든 작업에 동일 흐름 유지.

## Mandatory read order (session start)
1. **.harness/session-workflow.md** (1.9.39+ 6단계 워크플로 — 최우선)
2. .harness/context-routing.md
3. .harness/session-handoff.md
4. .harness/current-state.md
5. .harness/plan.md
6. .harness/progress-tracker.md
7. .harness/guideline.md
8. .harness/protected-files.md
9. .harness/writeback-policy.md
10. .harness/anti-lazy-work-policy.md
11. **.harness/rules.md** (사용자 정의 영구 룰 — 매 세션 반드시 따름)

## Required behavior
- 작업 시작 시 `leerness handoff .`를 실행해 컨텍스트를 적재합니다 (handoff가 active rules를 자동 출력).
- 작업 분류는 `leerness route <task-type>`로 확인합니다 (planning, feature, bugfix, refactor, research, consistency, release, migration, session-start, session-close, harness-maintenance).
- 보호 파일/관리 섹션을 삭제하지 않습니다. 머지·아카이브·deprecated 표시를 사용합니다.
- 의미 있는 변경 후 progress-tracker, current-state, task-log, session-handoff를 갱신합니다.
- 완료 선언 전 `leerness check .` 또는 `leerness lazy detect .`로 자기검증합니다.
- 변경 전 secret/encoding 가드: `leerness scan secrets .`, `leerness encoding check .`.
- 같은 기능 중복 생성 전 design-system.md, consistency-policy.md, reuse-map.md를 확인합니다.
- 매 세션 종료 시 `leerness session close .`로 9개 카테고리(완료/진행중/미완료/예정/대기/보류/차단/드랍/검증) + **활성 룰 검증 결과**를 보고합니다.
- 업데이트는 `leerness update --check` (감지) → `leerness update --yes` (자동 마이그레이션).

## 자연어 회고/통찰/브레인스토밍 (1.9.13)
사용자가 자연어로 회고/통찰/브레인스토밍을 요청하면 즉시 leerness 명령으로 호출합니다.

| 사용자 발화 (자연어) | 즉시 실행할 명령 |
|---|---|
| "회고해줘 / 돌아보자 / 정리해줘" | `leerness retro` |
| "최근 N일 회고" | `leerness retro --days N` |
| "통계 / 누적 지표 / insights" | `leerness insights` |
| "X에 대해 브레인스토밍 / X 관련 자료 / X 시작 전 검토" | `leerness brainstorm "X"` |

session close가 매번 자동으로 한 줄 요약을 출력하고, 5세션마다 자동 깊은 회고를 실행합니다. 사용자가 명시 요청 시 즉시 호출.

## 자연어 룰 처리 (1.9.8)
사용자가 자연어로 영구 룰을 요청하면 즉시 leerness rule 명령으로 등록합니다.

| 사용자 발화 (자연어) | 즉시 실행할 명령 |
|---|---|
| "매 업데이트마다 버전 bump해줘" | `leerness rule add "버전을 patch로 bump" --trigger every-update` |
| "매 커밋마다 패치노트 추가해줘" | `leerness rule add "패치노트 추가" --trigger every-commit` |
| "세션 종료마다 배포해줘" | `leerness rule add "배포 (release publish)" --trigger session-close` |
| "X 룰 중지/그만/끄기" | `leerness rule pause <ID>` (해당 룰 ID는 list로 확인) |
| "X 룰 제거/삭제" | `leerness rule remove <ID>` |
| "모든 룰 중지" | `leerness rule stop` |
| "룰 다시 켜줘" | `leerness rule resume-all` 또는 `leerness rule resume <ID>` |

룰을 등록한 후 사용자에게 등록 결과(ID + trigger + 설명)를 보고하고, 그 이후 매 세션마다 자동 적용합니다. 사용자가 "중지" 또는 "제거"를 명시적으로 말하기 전까지는 룰을 비활성화하지 않습니다.

## 룰 자동 적용 (1.9.8)
leerness가 자동 검증 가능한 trigger:
- **every-update / version bump 키워드 룰**: package.json의 version이 갱신됐는지 검사 (handoff/session close가 baseline 캐시와 비교).
- **CHANGELOG / 패치노트 키워드 룰**: CHANGELOG.md의 mtime이 갱신됐는지 검사.
- **test / 테스트 / verify 키워드 룰**: review-evidence.md에 오늘 verify-code 흔적이 있는지 검사.
- **배포 / publish / push 키워드 룰**: 자동 검증 불가 → 사용자에게 release publish 명령을 안내.

자동 검증 가능한 룰의 실행은 `leerness release bump`, `leerness release note "..."`, `leerness release publish`를 사용해 자동화합니다.

---
<!-- leerness:migration-preserved -->
## Preserved previous content

Previous content was backed up before migration. Archive reference:

`.harness/archive/leerness-1.9.206-2026-05-22T02-21-43-187Z`

<details>
<summary>Previous AGENTS.md</summary>

```md
<!-- leerness:managed -->
# Leerness Agent Instructions

## ⭐ 매 세션 첫 행동 (1.9.39+)
**반드시 `.harness/session-workflow.md`를 먼저 읽고 6단계 워크플로를 따른다**: 요청분석→계획→분배→sub-agent작업→종합검증→마감. 라운드 길이/복잡도 무관, drift 방지를 위해 모든 작업에 동일 흐름 유지.

## Mandatory read order (session start)
1. **.harness/session-workflow.md** (1.9.39+ 6단계 워크플로 — 최우선)
2. .harness/context-routing.md
3. .harness/session-handoff.md
4. .harness/current-state.md
5. .harness/plan.md
6. .harness/progress-tracker.md
7. .harness/guideline.md
8. .harness/protected-files.md
9. .harness/writeback-policy.md
10. .harness/anti-lazy-work-policy.md
11. **.harness/rules.md** (사용자 정의 영구 룰 — 매 세션 반드시 따름)

## Required behavior
- 작업 시작 시 `leerness handoff .`를 실행해 컨텍스트를 적재합니다 (handoff가 active rules를 자동 출력).
- 작업 분류는 `leerness route <task-type>`로 확인합니다 (planning, feature, bugfix, refactor, research, consistency, release, migration, session-start, session-close, harness-maintenance).
- 보호 파일/관리 섹션을 삭제하지 않습니다. 머지·아카이브·deprecated 표시를 사용합니다.
- 의미 있는 변경 후 progress-tracker, current-state, task-log, session-handoff를 갱신합니다.
- 완료 선언 전 `leerness check .` 또는 `leerness lazy detect .`로 자기검증합니다.
- 변경 전 secret/encoding 가드: `leerness scan secrets .`, `leerness encoding check .`.
- 같은 기능 중복 생성 전 design-system.md, consistency-policy.md, reuse-map.md를 확인합니다.
- 매 세션 종료 시 `leerness session close .`로 9개 카테고리(완료/진행중/미완료/예정/대기/보류/차단/드랍/검증) + **활성 룰 검증 결과**를 보고합니다.
- 업데이트는 `leerness update --check` (감지) → `leerness update --yes` (자동 마이그레이션).

## 자연어 회고/통찰/브레인스토밍 (1.9.13)
사용자가 자연어로 회고/통찰/브레인스토밍을 요청하면 즉시 leerness 명령으로 호출합니다.

| 사용자 발화 (자연어) | 즉시 실행할 명령 |
|---|---|
| "회고해줘 / 돌아보자 / 정리해줘" | `leerness retro` |
| "최근 N일 회고" | `leerness retro --days N` |
| "통계 / 누적 지표 / insights" | `leerness insights` |
| "X에 대해 브레인스토밍 / X 관련 자료 / X 시작 전 검토" | `leerness brainstorm "X"` |

session close가 매번 자동으로 한 줄 요약을 출력하고, 5세션마다 자동 깊은 회고를 실행합니다. 사용자가 명시 요청 시 즉시 호출.

## 자연어 룰 처리 (1.9.8)
사용자가 자연어로 영구 룰을 요청하면 즉시 leerness rule 명령으로 등록합니다.

| 사용자 발화 (자연어) | 즉시 실행할 명령 |
|---|---|
| "매 업데이트마다 버전 bump해줘" | `leerness rule add "버전을 patch로 bump" --trigger every-update` |
| "매 커밋마다 패치노트 추가해줘" | `leerness rule add "패치노트 추가" --trigger every-commit` |
| "세션 종료마다 배포해줘" | `leerness rule add "배포 (release publish)" --trigger session-close` |
| "X 룰 중지/그만/끄기" | `leerness rule pause <ID>` (해당 룰 ID는 list로 확인) |
| "X 룰 제거/삭제" | `leerness rule remove <ID>` |
| "모든 룰 중지" | `leerness rule stop` |
| "룰 다시 켜줘" | `leerness rule resume-all` 또는 `leerness rule resume <ID>` |

룰을 등록한 후 사용자에게 등록 결과(ID + trigger + 설명)를 보고하고, 그 이후 매 세션마다 자동 적용합니다. 사용자가 "중지" 또는 "제거"를 명시적으로 말하기 전까지는 룰을 비활성화하지 않습니다.

## 룰 자동 적용 (1.9.8)
leerness가 자동 검증 가능한 trigger:
- **every-update / version bump 키워드 룰**: package.json의 version이 갱신됐는지 검사 (handoff/session close가 baseline 캐시와 비교).
- **CHANGELOG / 패치노트 키워드 룰**: CHANGELOG.md의 mtime이 갱신됐는지 검사.
- **test / 테스트 / verify 키워드 룰**: review-evidence.md에 오늘 verify-code 흔적이 있는지 검사.
- **배포 / publish / push 키워드 룰**: 자동 검증 불가 → 사용자에게 release publish 명령을 안내.

자동 검증 가능한 룰의 실행은 `leerness release bump`, `leerness release note "..."`, `leerness release publish`를 사용해 자동화합니다.

## ⚠ 사용자 요청 사전 검토 의무 (1.9.176 — 사용자 명시)
**사용자가 "X 구현해줘 / X 만들어줘 / X 추가해줘" 같은 요청을 줬을 때 무조건 즉시 구현하지 말 것.**
먼저 `leerness review-request "<요청>"` (또는 REPL `:review "<요청>"`) 를 호출해 다음을 분석한 후 사용자에게 결과 요약 제시:
1. 추정 작업 유형 (route)
2. 충돌 신호 (과거 실패 lesson + 진행 중 task)
3. 재사용 후보 (skill / reuse-map)
4. 더 효율적인 단계 제안 (sub-agent 분배 / plan add)
5. 권장 단계 (작업 유형별)
6. `proceed`: true → 즉시 진행 / false → 사용자 확인 필요

| 사용자 발화 | 즉시 실행할 명령 |
|---|---|
| "X 구현해줘 / X 추가해줘 / X 만들어줘" | `leerness review-request "<요청>"` → 분석 결과 표시 → 사용자 확인 후 구현 |
| "그냥 바로 해줘 / review 건너뛰어줘" | review 생략하고 즉시 진행 (사용자 명시 옵트아웃) |

REPL 안에서 `:review "<request>"` slash 즉시 호출. MCP 도구 `leerness_review_request` 로 외부 AI 도 동일 분석 가능.

## REPL Agent + Bridge 명령 (1.9.149~170)
사용자가 "에이전트 켜줘 / REPL 모드 / 대화형" 또는 코드 인텔리전스/웹/PC 자동화를 요청하면 즉시 호출합니다.

| 사용자 발화 | 즉시 실행할 명령 |
|---|---|
| "에이전트 켜줘 / REPL 모드 시작" | `leerness agent .` (default: 활성 CLI 자동 선택) |
| "Claude로 대화" / "Codex로 대화" | `leerness agent . --provider claude` (또는 codex/gemini/copilot/ollama) |
| "스트리밍 끄고 / 일괄 응답" | REPL 안에서 `:stream off` |
| "다른 provider로 / Tab" | REPL에서 `Tab` (provider cycle) / `Shift+Tab` (model cycle) |
| "웹 스크린샷" / "URL 캡처" | `leerness web screenshot <url> --out shot.png` (1.9.165, playwright opt-in) |
| "마우스 클릭 / 자동화" | `leerness pc click <x> <y>` (1.9.166, robotjs opt-in, ⚠ full 권한) |
| "함수 찾아줘" / "심볼 추출" | `leerness lsp symbols <file>` (1.9.167, typescript opt-in + regex fallback) |
| "참조 검색" / "어디서 호출되나" | `leerness lsp references <name> --in <dir>` |
| "권한 모드 확인" | `leerness permissions list` (basic/extended/full) |
| "최신 버전 작동 확인" | `leerness which` (1.9.164, 진단 — 구버전 충돌 / npm cache / PATH 충돌) |

**MCP 53 도구** (1.9.168) — 외부 AI에서 위 명령들을 직접 호출 가능: `leerness_web/leerness_pc/leerness_lsp`.

## 6 능력 매트릭스 (1.9.167+)
`leerness health --json` → `capabilityMatrix` 필드:
1. **웹 자동화** (`webAutomation`) — playwright bridge (1.9.165, 사용자 설치 시 90%)
2. **PC 조작** (`pcAutomation`) — robotjs/nut-tree bridge (1.9.166)
3. **멀티 에이전트 오케스트레이션** (`multiAgentOrchestration`) — agents multi --execute + consensus (1.9.156)
4. **REPL multi-provider** (`replMultiProvider`) — 5종 + Tab cycle + 실시간 스트리밍 (1.9.149~170)
5. **MCP 도구** (`mcpTools`) — 53 도구 (1.9.168)
6. **코드 인텔리전스** (`codeIntel`) — LSP 어댑터 (1.9.167)

`overallScore` ≥ 70 = `production-ready`, ≥ 50 = `beta-ready`, else `mvp`.

```

</details>
