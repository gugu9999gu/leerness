---
leernessRole: context-map
readWhen:
  - 관련 파일 탐색
  - 기능 구현 전
updateWhen:
  - 파일 구조 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Context Map

## Execution Flow

```text
npm / npx / global CLI ───────────────────────┐
                                              v
MCP client → repo config (`.mcp.json`) → `leerness mcp serve` → bin/leerness.js
                                              │
                         ┌────────────────────┼────────────────────┐
                         v                    v                    v
                    lib/*.js             .leerness/            .leerness/
                 domain modules       project workspace     optional run state
                         │
                         └──────────────→ generated HTML / local preview
```

`package.json`의 `main`과 `bin.leerness`가 모두 `bin/leerness.js`를 가리킨다. MCP도 별도 서버 구현이 아니라 같은 진입점에서 도구 정의를 CLI 인자로 변환해 동일한 핸들러를 호출한다.

## Source and Runtime Map

| Area | Files | Responsibility / Start Here |
|---|---|---|
| Package entry | `package.json`, `bin/leerness.js` | CommonJS CLI/MCP 진입점. 명령 파싱·디스패치, 아직 분리되지 않은 도메인 핸들러, 워크스페이스 템플릿(`coreFiles`), 내장 selftest가 여기서 시작한다. |
| Shared I/O and Git | `lib/io.js`, `lib/git.js` | 출력/JSON 오류 계약, UTF-8 읽기, 원자적 쓰기, dry-run 쓰기 차단과 Git 실행 환경 격리의 공통 초크포인트. 저장소 변경·Git 호출 문제는 먼저 확인한다. |
| Analysis, catalogs, integrity | `lib/pure-utils.js`, `lib/analyzers.js`, `lib/search-core.js`, `lib/catalogs.js`, `lib/state-integrity.js` | 앞의 네 모듈은 부작용 없는 파서·렌더러·증거/정직성 분석·검색 랭킹·정적 데이터이고, `state-integrity.js`는 `.leerness/*.json`을 읽기 전용으로 검사한다. 판정 규칙을 바꿀 때 시작한다. |
| Workflow and verification | `lib/session-close.js`, `lib/session-presence.js`, `lib/audit.js`, `lib/drift.js`, `lib/health.js`, `lib/review-request.js`, `lib/bugfix.js`, `lib/referee.js` | handoff 마감·동시 세션 관측, 위생/드리프트/헬스, 요청 사전검토, 버그 영수증, 검증기 캘리브레이션. 대부분 `bin/leerness.js`가 프로젝트 고유 의존성을 주입한다. |
| Project model and configuration | `lib/feature.js`, `lib/toggles.js`, `lib/tech-profile.js`, `lib/migrate.js`, `lib/diagnostics.js` | 기능 그래프, 토글, 기술 프로필, 버전 간 상태 마이그레이션, 설치/환경 진단. |
| Agents and routing | `lib/agent-registry.js`, `lib/role-catalog.js`, `lib/agents.js`, `lib/routing.js`, `lib/team.js` | 외부 CLI/provider 정적 레지스트리, 역할 모델, 가용성 확인·위임, 난이도 라우팅, 팀 정의/실행 게이트. |
| MCP surface | `lib/mcp-tools.js`, `bin/leerness.js`의 `_mcpToCliArgs`·`mcpServeCmd` | `lib/mcp-tools.js`가 도구 스키마 단일 출처이고, 진입점이 stdio JSON-RPC `tools/list`/`tools/call`을 CLI 명령으로 연결한다. |
| Visualization and preview | `lib/graph.js`, `lib/dashboard.js`, `lib/library.js`, `lib/clarify.js`, `lib/preview-serve.js` | 온톨로지/문서 그래프, 읽기 중심 대시보드, UI 재사용 인벤토리, 승인형 시안과 로컬 미리보기. `leerness.html`, `roadmap.html`, 임시 preview 산출물은 결과물이지 동작의 단일 출처가 아니다. |
| Agent adapters | `AGENTS.md`, `CLAUDE.md`, `.claude/**`, `.cursor/rules/leerness.mdc`, `.github/copilot-instructions.md`, `.mcp.json` | 각 에이전트가 세션 워크플로를 발견하고 CLI 또는 MCP 표면으로 진입하게 하는 정적 지침과 연결 설정. |
| Product documentation | `README.md`, `README.ko.md`, `docs/interoperability.md`, `docs/clean-room-evaluations.md`, `docs/PUBLISH_PRECHECK.md`, `CHANGELOG.md` | 사용자 계약, 상호운용 경계, 검증 한계/실험 근거, 게시 전 점검과 릴리스 이력. |

## State Map

| State | Files | Contract |
|---|---|---|
| Primary project workspace | `.leerness/*.md`, `.leerness/*.json` | 계획·진행·결정·교훈·룰·요청·검증·handoff를 저장하는 저장소 로컬 평문 상태. `plan.md`, `progress-tracker.md`, `current-state.md`, `session-handoff.md`, `review-evidence.md`가 기본 작업 루프다. |
| Canonical memory pairs | `.leerness/decisions.json` + `decisions.md`, `.leerness/lessons.json` + `lessons.md` | JSON이 구조화 원본이고 Markdown은 사람이 읽는 projection이다. 저장 함수/마이그레이션을 거치지 않은 한쪽만의 수정은 피한다. |
| Policies and metadata | `.leerness/rules.md`, `.leerness/leerness-config.json`, `.leerness/manifest.json`, `.leerness/enforce.json`, `.leerness/environment.json`, `.leerness/tech-profile.json`, `.leerness/HARNESS_VERSION`, `.leerness/LANGUAGE`, 정책 문서들 | 세션 규칙, 설치 버전/언어, enforce·환경·프로젝트 기술 신호를 보존한다. 손상 JSON은 `state-integrity`와 각 checked loader가 탐지한다. |
| Ephemeral/local state | `.leerness/cache/**`, `.leerness/archive/**`, `.leerness/runs/**`, `.leerness/agent-sessions/**`, `.leerness/incidents/**`, `*.local.json`, `.env`, `.env.local`, `.env.production`, `.env.*.local` | 캐시·백업·실행 이력·로컬 자격증명 메타. 대부분 `.gitignore` 대상이며 실제 비밀값을 문서나 추적 파일에 넣지 않는다. `.env.example`은 키 이름만 담는 추적 가능 샘플이다. |
| Optional structured run substrate | `.leerness/state.json`, `.leerness/runs/**`, `.leerness/handoff/**`, `.leerness/policy.json` | `leerness state ...`와 관련 MCP verb가 만들고 쓰는 에이전트 간 JSON run 상태. 기본 `.leerness` 워크스페이스와 별개다. |

## Verification and Distribution Map

| Area | Files / Commands | Notes |
|---|---|---|
| Static checks | `scripts/lint.js`, `npm run lint` | JavaScript 구문·저장소 규칙과 JSON 유효성을 빠르게 확인한다. |
| Embedded unit/invariant checks | `bin/leerness.js`의 `_selfTestCases`, `leerness selftest` | 핵심 순수함수, 배선, 표면 계약을 진입점 내부에서 검증한다. 별도 `tests/**` 디렉터리는 없다. |
| Integration tests | `scripts/e2e-core.js`, `scripts/e2e.js`, `scripts/smoke.js` | 중간 티어 코어 E2E, 전체 spawn 기반 E2E, 빠른 smoke 시나리오. |
| Targeted regressions | `scripts/e2e-concurrency.js`, `scripts/lock-probe.js`, `scripts/release-bump-probe.js`, `scripts/migration-compat.js` | 동시성/락, 릴리스 버전 표면, 마이그레이션 호환성처럼 비용이 크거나 전용 조건이 필요한 회귀 프로브. |
| CI | `.github/workflows/ci.yml` | Ubuntu/Windows와 지원 Node 버전에서 version → selftest → e2e-core → e2e를 실행하고, 별도 fast job은 `test:fast`를 실행한다. |
| npm distribution | `package.json`의 `files`·scripts | 게시물은 `bin/`, `lib/`, `scripts/`, `docs/`와 주요 문서를 싣는다. 이 저장소의 `.leerness/**` dogfood 상태와 루트 HTML 산출물은 패키지 소스가 아니다. |

## Change Routing

T-0174 추가 표면: `lib/state-paths.js`/`state-git.js`의 5-scope resolver와
`state-inventory.js`/`state-inspect.js`의 읽기 전용 진단. `state inspect`는 기존 substrate
명령과 별도의 early dispatch이며 자동 migration/usage/skillpack 조회를 거치지 않는다.
기존 `.leerness` writer 경로는 유지한다. 관련 회귀는 `npm run test:state-scopes`.

| Change | Inspect / Update Together |
|---|---|
| CLI 명령 또는 플래그 | `bin/leerness.js` 디스패치·도움말·JSON/exit 계약 → 소유 `lib/*.js` → 관련 selftest/E2E. |
| MCP 도구 | `lib/mcp-tools.js` 스키마 → `_mcpToCliArgs` 매핑과 `mcpServeCmd` → MCP 왕복 E2E. |
| 신규 프로젝트에 설치되는 하네스 파일 | `bin/leerness.js`의 `coreFiles()`와 managed merge/migration 경로. 이 저장소의 `.leerness/**`만 고치면 npm 사용자의 설치 템플릿은 바뀌지 않는다. |
| 상태 쓰기·동시성 | `lib/io.js`, `bin/leerness.js`의 `_withLock`, 해당 store의 checked loader/save 함수 → lock/concurrency 회귀. |
| Git 동작 | `lib/git.js` 단일 실행 경로와 호출 모듈 → 격리 환경·worktree·Windows 경로 회귀. |
| 검증 판정 | `lib/analyzers.js`/`pure-utils.js`/`state-integrity.js` → `verify-claim`, audit/health/check, 클린룸 문서와 회귀. |
| 그래프·대시보드·미리보기 | 해당 `lib/graph.js`/`dashboard.js`/`library.js`/`clarify.js`/`preview-serve.js` → 생성된 HTML은 재생성해 확인한다. |
| 릴리스 | `package.json`, `bin/leerness.js` 버전 표면, `README*`, `CHANGELOG.md`, `docs/PUBLISH_PRECHECK.md`, CI와 release probe. |
