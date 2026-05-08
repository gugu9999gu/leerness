# Leerness

> 한국어 우선 AI 개발 하네스. 비파괴 마이그레이션 / 자동 버전 감지·업데이트 / 계획·진행·핸드오프 자동화 / 게으름·시크릿·인코딩 자동 가드 / Claude Code 슬래시 통합.

## 빠르게 시작

```bash
# 신규 프로젝트
npx leerness init . --language ko --skills recommended

# 기존 leerness 1.x.x 프로젝트 자동 업그레이드
npx leerness@latest update . --yes
# 또는 비파괴 마이그레이션만
npx leerness@latest migrate . --dry-run
npx leerness@latest migrate .
```

대화식 init 흐름은 언어(한/영/자동) 및 스킬 라이브러리 (추천/전체/직접) 선택을 안내합니다.

## 핵심 명령

```bash
leerness handoff .              # 세션 시작 컨텍스트 자동 적재
leerness status .               # 설치 상태
leerness verify .               # 필수 파일 검증
leerness audit .                # 디자인/재사용/계획↔진행 정렬 감사
leerness check .                # pre-action 체크
leerness scan secrets .         # AWS/GitHub/OpenAI/Anthropic/Google/Slack/PEM/하드코딩 password 패턴
leerness encoding check .       # UTF-8/BOM/UTF-16 BOM/NUL/.bat의 chcp 65001/한글 라운드트립
leerness lazy detect .          # 증거 없는 done, 빈 handoff, 추적 없는 TODO/FIXME 자동 감지
leerness memory search "키"     # decisions/log/handoff/plan/progress 즉시 grep
leerness session close .        # 세션 종료 + handoff/current-state 자동 작성
leerness update --check         # 24h 캐시 자동 버전 감지
leerness update --yes           # 새 버전 자동 마이그레이션 + verify/audit
```

`leerness route <type>` 으로 작업 유형별 read/update 라우트 확인 (`planning, feature, bugfix, refactor, research, consistency, release, migration, session-start, session-close, harness-maintenance`).

## 자동 버전 감지·업데이트

`init`/`migrate`가 끝나면 `.claude/settings.local.json`의 SessionStart hook에 `leerness update --check`이 자동 등록됩니다 (`--no-auto-update`로 끄기 가능). 24시간 캐시(`.harness/cache/update-check.json`)로 npm 호출 폭주를 막습니다.

| 명령 | 동작 |
|---|---|
| `leerness update --check` | 현재 `.harness/HARNESS_VERSION` ↔ `npm view leerness version` 비교 |
| `leerness update --yes` | 새 버전 발견 시 `npx leerness@latest migrate .`에 위임 → 백업·머지 후 `status`/`verify`/`audit` 자동 실행 → `task-log.md`/`review-evidence.md`에 누적 |
| `leerness update --from <tarball>` | 로컬 tarball / 오프라인 / 사내 미러 |
| `LEERNESS_OFFLINE=1` 환경변수 | npm 호출 건너뜀 |

## 비파괴 마이그레이션 정책

- 모든 변경 전에 `.harness/archive/leerness-<version>-<timestamp>/` 백업 자동 생성.
- 사용자 메모리(plan / progress / current-state / decisions / task-log / architecture / context-map / feature-contracts / reuse-map / design-system 등) 기본 보존.
- 관리되는 인스트럭션(AGENTS.md, CLAUDE.md, .cursor/rules/leerness.mdc, .github/copilot-instructions.md)은 새 템플릿으로 머지하되 이전 내용을 `<!-- leerness:migration-preserved -->` 블록으로 보존.
- `.env.example`, `.gitignore`, `.gitattributes`는 라인 단위 머지.
- 결과 보고서: `.harness/migration-report.md`.

## 디렉토리 구조

```
.harness/
├── plan.md / progress-tracker.md / current-state.md / session-handoff.md
├── decisions.md / task-log.md / review-evidence.md
├── guideline.md / writeback-policy.md / context-routing.md / task-type-map.md
├── architecture.md / context-map.md / feature-contracts.md
├── design-system.md / consistency-policy.md / reuse-map.md
├── anti-lazy-work-policy.md / secret-policy.md / encoding-policy.md
├── test-evidence-policy.md / session-close-policy.md / review-checklist.md / release-checklist.md
├── protected-files.md / guardrails.md / language-policy.md / leerness-maintenance.md
├── plan-progress-boundary.md
├── AX_PLAN_GUIDE.md / AX_MIGRATION_GUIDE.md / AX_NEW_PROJECT_GUIDE.md / AX_SKILL_LIBRARY_GUIDE.md
├── skill-index.md / skills/<id>/{README.md, skill.json}
└── templates/{end-of-session-report.md, decision.md, task-row.md}
.claude/
├── commands/{handoff, session-close, audit, lazy-detect, update, viewwork-ping}.md
├── skills/leerness.md
└── settings.local.json (SessionStart + Stop hooks)
.cursor/rules/leerness.mdc
.github/copilot-instructions.md
AGENTS.md / CLAUDE.md
```

## 게으름 방지 (Anti-Lazy)

`anti-lazy-work-policy.md`의 6개 규칙 + `lazy detect` 자동 점검:

1. 증거 없는 완료 금지 (`evidence` 컬럼이 비었거나 plan-link만이면 경고)
2. 빈 핸드오프 금지
3. 부분 구현 자기보고 (`incomplete` 표기 + Next Exact Step 1줄)
4. 검증 기록 누적 (`review-evidence.md`)
5. 새 TODO/FIXME → progress-tracker에 동일 ID로 추적
6. 자동 감지: 증거 없는 done, 추적 없는 TODO, blocker 방치, 검증 흔적 부재

## 시크릿/인코딩 자동 가드

- `scan secrets`: 9개 패턴 (AWS/GitHub PAT/GitHub fine-grained/OpenAI/Anthropic/Google/Slack/PEM private key/하드코딩 password).
- `encoding check`: BOM, UTF-16 BOM, NUL, .bat의 chcp 65001 누락, 한글 텍스트의 UTF-8 라운드트립.

## Claude Code 통합

설치 시 자동 등록:
- `.claude/commands/handoff.md`, `session-close.md`, `audit.md`, `lazy-detect.md`, `update.md`, `viewwork-ping.md`
- `.claude/skills/leerness.md` — Claude Code 스킬 정의
- `.claude/settings.local.json` — SessionStart (`update --check`) + Stop (`viewwork emit`) hook

## 스킬 라이브러리

`leerness skill list` / `leerness skill info <id>` / `leerness skill add <id>`.

기본 카탈로그: `office`, `commerce-api`, `crawling`, `firebase`, `ads-analytics`, `appstore-review`, `ai-verified-skill-publisher`, `feature-implementation`.

## E2E

```bash
npm test
# = node ./scripts/e2e.js
```

빈 임시 디렉토리에서 30+개 시나리오 실측 (B1 in-place upsert 회귀 검증 포함).

## 라이선스

MIT.
