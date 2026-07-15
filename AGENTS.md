<!-- leerness:managed -->
# Leerness Agent Instructions

## ⭐ 매 세션 첫 행동
**반드시 `.harness/session-workflow.md`를 먼저 읽고 6단계 워크플로를 따른다**: 요청분석→계획→분배→sub-agent작업→종합검증→마감. 라운드 길이/복잡도 무관, drift 방지를 위해 모든 작업에 동일 흐름 유지.

## Mandatory read order (session start)
1. **.harness/session-workflow.md** (6단계 워크플로 — 최우선)
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

## 자연어 회고/통찰/브레인스토밍
사용자가 자연어로 회고/통찰/브레인스토밍을 요청하면 즉시 leerness 명령으로 호출합니다.

| 사용자 발화 (자연어) | 즉시 실행할 명령 |
|---|---|
| "회고해줘 / 돌아보자 / 정리해줘" | `leerness retro` |
| "최근 N일 회고" | `leerness retro --days N` |
| "통계 / 누적 지표 / insights" | `leerness insights` |
| "X에 대해 브레인스토밍 / X 관련 자료 / X 시작 전 검토" | `leerness brainstorm "X"` |

session close가 매번 자동으로 한 줄 요약을 출력하고, 5세션마다 자동 깊은 회고를 실행합니다. 사용자가 명시 요청 시 즉시 호출.

## 자연어 룰 처리
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

## 룰 자동 적용
leerness가 자동 검증 가능한 trigger:
- **every-update / version bump 키워드 룰**: package.json의 version이 갱신됐는지 검사 (handoff/session close가 baseline 캐시와 비교).
- **CHANGELOG / 패치노트 키워드 룰**: CHANGELOG.md의 mtime이 갱신됐는지 검사.
- **test / 테스트 / verify 키워드 룰**: review-evidence.md에 오늘 verify-code 흔적이 있는지 검사.
- **배포 / publish / push 키워드 룰**: 자동 검증 불가 → 사용자에게 release publish 명령을 안내.

자동 검증 가능한 룰의 실행은 `leerness release bump`, `leerness release note "..."`, `leerness release publish`를 사용해 자동화합니다.

## 사용자 명시 신규 7종 (1.9.207~213) — 백로그 완전 소진

| 버전 | 핵심 기능 | CLI |
|---|---|---|
| 1.9.207 | 사용자 요청 누락 확인 절차 (UR-XXXX 추적) | `requests audit\|add\|list\|complete\|drop` |
| 1.9.208 | 플랫폼/API 제약 사전 체크 (6종 기본) | `constraints list\|check\|add` |
| 1.9.209 | pre-wake sub-agent audit (6 영역) | `pre-wake-audit [--last]` |
| 1.9.210 | adaptive wakeup interval (10~45min) | `wakeup-interval get\|set\|auto\|history\|record` |
| 1.9.211 | .harness → .leerness opt-in migration | `migrate-workspace-dir [--dry-run]` + `workspace-dir get\|guide` |
| 1.9.212 | 멱등성 감사 + ruleAdd/taskAdd dedup | `idempotency audit` + `rule add` / `task add` 자동 dedup |
| 1.9.213 | intent inference + 5도메인 scope expansion | `intent classify\|expand\|domains` |

### handoff 헤드라인 자동 노출 (1.9.215+)
- 1.9.207 `📥 미답 요청 N건` / `📥 요청 N (tracked)`
- 1.9.208 `🚦 N 플랫폼 제약` (현재 task에서 매칭 시)
- 1.9.209 `🔍 pre-wake NC/MW` + 본문 자동 섹션
- 1.9.210 적응 적용된 interval (handoff시 권장값 표시)
- 1.9.213 `🎯 intent broad/<domain>` 또는 `🎯 intent precise` (현재 task 자동 분류)

### 의도 보호 원칙 (1.9.213)
- **Always-Off Opt-In**: intent expansion 기본 비활성
- **Dry-run 기본**: 실제 task add 절대 X
- **명시 vs 추론 분리 라벨링**: `👤 사용자 명시` vs `🤖 AI 추론 확장`

## 운영 강화 8 라운드 (1.9.214~221) + auto-fix (1.9.222)

| 버전 | 핵심 기능 | CLI / 통합 |
|---|---|---|
| 1.9.214 | drift 차단 + AGENTS/CLAUDE 7 라운드 누적 | (drift baseline) |
| 1.9.215 | handoff 헤드라인 통합 | `🚦 constraints` / `🎯 intent` 자동 |
| 1.9.216 | MCP 5종 추가 (54→59) | `requests_audit` / `constraints_check` / `pre_wake_audit` / `intent_classify` / `idempotency_audit` |
| 1.9.217 | session close 자동 통합 | `requests` / `pre-wake` / `idempotency` 자동 + `--no-pre-wake` |
| 1.9.218 | handoff JSON 통합 강화 + 5축 100/100 | `--json` 4 필드 (userR/preW/idemp/abnormal) |
| 1.9.219 | 🎉 80 라운드 마일스톤 | `_reports/milestone-1.9.219-80-rounds.md` |
| 1.9.220 | 🔌 비정상 종료 자율 재개 (사용자 명시) | `session-resume` (5신호) + handoff 헤드라인 |
| 1.9.221 | 🎉 MCP 60 도구 마일스톤 | `leerness_session_resume` MCP + handoff/session close JSON 4 통합 |
| 1.9.222 | 🛡 session-resume --auto-fix + 본문 자동 노출 | `session-resume --auto-fix` (wakeup supersede) + handoff `## 🚨/⚠ 비정상 종료 감지` 본문 |

### 비정상 종료 자율 재개 워크플로 (1.9.220~222)
1. 깨어남 후 handoff 첫 출력 → 헤드라인 `🔌 비정상종료 <severity>` 자동 노출
2. severity high/medium 시 → 본문 `## 🚨/⚠ 비정상 종료 감지` 자동 섹션
3. `leerness session-resume` → 5신호 분석 + 재개 가이드 7단계 출력
4. `leerness session-resume --auto-fix` (1.9.222) → 30분+ 지난 pending wakeup 자동 `superseded`
5. 안전 재개 후 다음 라운드 진입

### 사용자 요청 자동 완료 시스템 (1.9.223~225) — 4 라운드 완성

| 버전 | 핵심 기능 | CLI / Trigger |
|---|---|---|
| 1.9.223 | delivered 패턴 자동 감지 | `requests auto-complete [--apply]` + handoff 헤드라인 `📥 자동완료가능 N건` |
| 1.9.224 | MCP 61 + handoff 본문 + session close auto-apply | `leerness_requests_auto_complete` MCP + `session close --auto-apply-delivered` |
| 1.9.225 | drift --auto-fix 통합 + env opt-in | `drift check --auto-fix` 자동 / `LEERNESS_AUTO_APPLY_DELIVERED=1` env |

### 라운드 진행도 가시화 (1.9.226~234)
- `leerness round-history` 새 명령 (git tag v1.9.X 기반)
- `leerness milestones` (1.9.229) — 도달 + ETA
- `leerness pulse` (1.9.231) — 한 줄 종합 요약
- `leerness commands` (1.9.233) — 9 카테고리 51 CLI
- handoff 헤드라인 17번째: `🔄 R<N> → R<milestone> (<X>R 남음)`
- handoff/session close/health --json **8 통합 필드** (1.9.234): userRequests / preWake / idempotency / abnormalShutdown / deliveredRequests / roundHistory / milestones / recentChanges
- MCP **66 도구** (1.9.226 round_history / 1.9.229 milestones / 1.9.231 pulse / 1.9.233 commands / 1.9.236 release_cleanup)

### release cleanup 생태계 (1.9.235~237 — 3 라운드 완성)
- 1.9.235 `leerness release cleanup --apply --keep N` (수동)
- 1.9.236 MCP 66 + `drift check --auto-fix` 자동 통합 (50+ 시)
- 1.9.237 `session close --auto-cleanup-branches` + handoff body 50+ 경고

### 사용자 명시 백로그 UR-0013~0018 (1.9.239~252 — 6 요청 완전 소진)

| UR | 버전 | 핵심 기능 | CLI / 동작 |
|---|---|---|---|
| UR-0013 | 1.9.239~240 | py 스크립트 + agent 모드 효율화 | `py-check` / `agent-mode start\|tick` + MCP 67/68 + JSON `pyFiles` |
| UR-0014 | 1.9.241~243 | 한국어 셸 인코딩 사전 감지 | `env` / `env encoding [--apply]` + JSON `envInfo` + CJK 분류 |
| UR-0015 | 1.9.245 | API skill cache | `api-skill add <url> --direction` + handoff 매칭 + audit finding |
| UR-0016 | 1.9.246~247 | REPL UX/UI | 컨텍스트 게이지 + 서브에이전트 가시화 + multi-provider fallback |
| UR-0017 | 1.9.248 | Gemini → Antigravity (agy) | EXTERNAL_AGENTS/provider/MCP/dispatch 전체 교체 |
| UR-0018 | 1.9.249~252 | 터미널 인코딩 자동 회복 | Windows chcp 65001 + POSIX/WSL LANG + init/agent-mode/env 점검 |

### UR-0018 터미널 인코딩 자동 회복 — 4 라운드 상세
1. **1.9.249** (Windows): `_ensureStdoutEncoding()` IIFE — chcp 65001 자동 + setEncoding('utf8'). opt-out `LEERNESS_NO_AUTOCHCP=1`
2. **1.9.250** (POSIX/WSL): `posixEncodingOk` + `isWSL` 감지 → JSON envInfo 4 필드 (terminalEncodingOk/autoChcpApplied/posixEncodingOk/isWSL) 3 명령 propagate
3. **1.9.251** (init 안내): `_terminalEncodingNotice()` 헬퍼 + `leerness init` 완료 시 점검
4. **1.9.252** (DRY): env summary 통합 + `agent-mode start` 점검 (진입점 3곳 일관)

### 5축 매트릭스 (1.9.218 — 100/100 달성, 1.9.252 유지)
- A. agent 자동화 — 10/10
- B. multi-agent consensus — 10/10
- C. skill 자동 회수 — 10/10
- D. task 회고 + 7일+ stale — 10/10
- E. next-action queue + lazy detect — 10/10

### UR-0019~0020 + 테스트 인프라 (1.9.253~261 — 9 라운드)

| 버전 | 기능 | 비고 |
|---|---|---|
| 1.9.253 | CLAUDE/AGENTS 문서 1.9.238~252 누적 갱신 | drift 차단 |
| 1.9.254~255 | UR-0019 `leerness path-setup [--apply]` — CLI PATH 자동 등록 | Windows User PATH(setx 회피)/Unix rc, dry-run 기본 + require.main 가드 |
| 1.9.256~257 | 단위 테스트 인프라 — 순수 함수 export + 실 동작 검증 | _isSecretKey/compareVer/_classifyCJK 등 + release 브랜치 213→20 정리 |
| 1.9.258~259 | `leerness selftest` — 코어 함수 무결성 (15 케이스) | MCP 71 + npm test 게이트 (fast-fail) |
| 1.9.260~261 | UR-0020 `leerness shell-guard "<cmd>"` — 셸 호환성 린터 | PS5.1 && 미지원 등 6 규칙 + 실패 메모리 + MCP 72 (CLI+MCP+selftest 3중) |

**require.main 가드** (1.9.255): CLI 직접 실행 시에만 main() → `require('harness.js')` 로 내부 함수 단위 테스트 가능 (init 부작용 0).

**shell-guard 6 규칙**: ps5-chain(PS5.1 &&→`A; if ($?) {B}`) / ps-devnull(`2>$null`) / ps-inline-env(`$env:VAR`) / ps-rm-rf(`Remove-Item`) / cmd-semicolon / ps-version-unknown. `.harness/shell-failures.json` 실패 메모리 + environment.json 버전 변동 감지.

### 자율 모드 마일스톤 — 1.9.261 시점
- **R217 누적 라운드** · **123 main-push streak** · **84 npm publish streak**
- handoff/session close/health JSON **11 통합 필드** (3 × 11 = 33 포인트)
- MCP **72 도구** · 9 카테고리 **59 CLI 명령** · 사용자 백로그 **UR-0013~0020 완전 소진**
- **selftest 무결성** (CLI + MCP + npm test 게이트) · **require.main 가드 + 14종 export**

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

## ⭐ 매 세션 첫 행동
**반드시 `.harness/session-workflow.md`를 먼저 읽고 6단계 워크플로를 따른다**: 요청분석→계획→분배→sub-agent작업→종합검증→마감. 라운드 길이/복잡도 무관, drift 방지를 위해 모든 작업에 동일 흐름 유지.

## Mandatory read order (session start)
1. **.harness/session-workflow.md** (6단계 워크플로 — 최우선)
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

## 자연어 회고/통찰/브레인스토밍
사용자가 자연어로 회고/통찰/브레인스토밍을 요청하면 즉시 leerness 명령으로 호출합니다.

| 사용자 발화 (자연어) | 즉시 실행할 명령 |
|---|---|
| "회고해줘 / 돌아보자 / 정리해줘" | `leerness retro` |
| "최근 N일 회고" | `leerness retro --days N` |
| "통계 / 누적 지표 / insights" | `leerness insights` |
| "X에 대해 브레인스토밍 / X 관련 자료 / X 시작 전 검토" | `leerness brainstorm "X"` |

session close가 매번 자동으로 한 줄 요약을 출력하고, 5세션마다 자동 깊은 회고를 실행합니다. 사용자가 명시 요청 시 즉시 호출.

## 자연어 룰 처리
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

## 룰 자동 적용
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
