# Changelog

## 1.9.10 — 2026-05-12

**leerness-skillpack 분리 + release publish 강화 (git remote 자동 감지 + GitHub Release + gh-pages 배포)**.

### Changed — 스킬 카탈로그 동적 로드

- `leerness-skillpack`이 npm에 별도 패키지로 분리됨. leerness 본 패키지는 `_tryLoadSkillpack()`으로 다음 순서로 동적 로드:
  1. `require('leerness-skillpack/catalog.json')` 시도
  2. `<cwd>/node_modules/leerness-skillpack/catalog.json` 탐색
  3. `npm root -g`의 `leerness-skillpack/catalog.json` 탐색
  4. `LEERNESS_SKILLPACK_PATH` 환경변수 경로
  5. 모두 실패 시 leerness 본 패키지의 내장 fallback (1.9.x 호환 유지)
- `leerness init` 출력에 `Skill catalog source: skillpack v1.0.0 | builtin (fallback)` 안내.
- `leerness skill list` 헤더에 카탈로그 출처 + 출처 컬럼에 `skillpack` / `builtin` / `user` 표시.

### Added — release publish 강화

- `detectGitRemote(root)`: 현재 디렉토리의 `git remote -v origin` 자동 감지 + GitHub owner/repo 추출.
- `leerness release publish` 신규 플래그:
  - `--auto` — remote 있으면 자동 `git push` (편의)
  - `--gh-release` — gh CLI로 GitHub Release 자동 생성 (`v<version>` 태그 + 자동 노트 + tarball 첨부)
  - `--gh-pages` — `gh-pages` branch에 정적 파일 자동 배포 (orphan 또는 기존 branch). 기본 소스는 `roadmap.html`, `--gh-pages-src <file>` 또는 `--roadmap <file>`로 지정.
  - `--pack` — npm pack만 명시적 실행
- `gh-pages` 배포는 임시 git worktree로 처리해 현재 작업 트리에 영향 없음. 배포 후 `https://<owner>.github.io/<repo>/` URL 안내.

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다. leerness-skillpack은 선택 설치:

```bash
npm install leerness-skillpack    # 본 카탈로그 사용
# 또는 그대로 두면 leerness 내장 fallback이 동작 (기존과 동일)
```

## 1.9.9 — 2026-05-12

- 1.9.9 빌드 + GitHub 배포

**1.9.8 시연 중 자체 도그푸드(dogfood)로 빌드된 패치 — 룰 시스템이 정확히 작동한 증거**.

### Fixed
- `nonFlagArgs()`의 `withValue` set에 `--trigger`, `--check`, `--set`, `--min-score` 추가. 이전에는 `rule add "..." --trigger every-update` 호출 시 `every-update`가 description 끝에 합쳐져 등록되던 작은 버그.

### Demonstrated (자체 도그푸드)
- 메인 디렉토리에 사용자 자연어 룰 3종 (버전 bump / CHANGELOG 추가 / 배포 안내) 등록
- `leerness handoff`가 active rules 자동 노출 ✓
- `leerness rule pause R-0003` → handoff에서 R-0003 사라짐 ✓
- `leerness release bump --patch` → 1.9.8 → 1.9.9 자동 ✓
- `leerness release note "..."` → 이 CHANGELOG 항목 자동 작성 ✓
- `leerness session close`가 룰 검증 (`✓ pass / ⓘ manual / ○ baseline`) 자동 보고 ✓

## 1.9.8 — 2026-05-08

**자연어 룰 등록 + 매 세션 자동 노출·검증 + 코드로 자동화 가능한 release 명령군**.

### Added — User Rules

- `.harness/rules.md` — 사용자 정의 영구 룰의 단일 출처. AGENTS.md mandatory read order 10번에 자동 포함.
- `leerness rule add "<설명>" --trigger every-session|every-update|every-commit|session-start|session-close|pre-publish` — 룰 등록.
- `leerness rule list / verify / pause <id> / resume <id> / remove <id> / stop / resume-all` — 룰 라이프사이클.
- `leerness handoff`가 **active rules를 매 세션 시작 시 자동 출력** (사용자 중지 요청 전까지).
- `leerness session close`가 **활성 룰별 자동 검증 결과 (`✓ pass / ⓘ manual / ⓿ pending / ○ baseline`) 자동 보고**.

### Added — 자연어 룰 처리 지시 (AGENTS.md / CLAUDE.md)

사용자가 자연어로 "매 X마다 Y를 해줘"라고 말하면 AI 에이전트가 즉시 `leerness rule add` 명령을 호출하도록 매핑 표를 추가:

| 자연어 | leerness 명령 |
|---|---|
| "매 업데이트마다 버전 bump" | `rule add "버전 patch bump" --trigger every-update` |
| "매 커밋마다 패치노트" | `rule add "패치노트 추가" --trigger every-commit` |
| "세션 종료마다 배포" | `rule add "배포" --trigger session-close` |
| "X 룰 중지/그만" | `rule pause <id>` |
| "X 룰 제거" | `rule remove <id>` |
| "모든 룰 중지" | `rule stop` |

### Added — release 명령군 (자동화 가능한 룰의 실행 도구)

- `leerness release bump [--patch|--minor|--major]` — `package.json#version`과 `.harness/HARNESS_VERSION` 자동 bump.
- `leerness release note "<내용>"` — CHANGELOG.md에 자동 추가 (같은 버전이면 항목만, 새 버전이면 헤더+항목).
- `leerness release publish [--dry-run] [--git-push] [--npm-publish]` — npm pack + (선택) git push + (선택) npm publish 통합.

### Added — 룰 자동 검증 휴리스틱

`session close`가 매번 자동 수행:
- **version / 버전 / bump 키워드 룰** → `package.json` version이 baseline 캐시 대비 갱신됐는지.
- **changelog / 패치노트 키워드 룰** → CHANGELOG.md mtime이 갱신됐는지.
- **test / 테스트 / verify 키워드 룰** → review-evidence.md에 오늘 verify-code 흔적이 있는지.
- **deploy / 배포 / publish 키워드 룰** → 자동 검증 불가 → `ⓘ manual` (사용자 안내).

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다. `.harness/rules.md`는 자동 생성됩니다.

## 1.9.7 — 2026-05-08

코드 검증 자동 실행 + 과거 결정/실수 자동 회수 + TODO 자동 추적의 3종 자동화.

### Added — A. `leerness verify-code [path] [--build]`

`package.json#scripts`에서 `test` / `lint` / `typecheck` (또는 `tsc`) / (선택) `build`를 자동 감지해 차례로 실행. 결과는 모두 `review-evidence.md`에 자동 누적 (`Command/Tasks/exit/duration/tail`). 실패 시 `process.exit(1)` + progress의 in-progress row를 `incomplete`로 표시 권장 안내.

- `tsconfig.json`이 있고 `typecheck` script가 없으면 `npx tsc --noEmit` 자동 호출.
- 5분 timeout 내장 (장기 실행 방지).

### Added — B. `leerness lessons [--query <키>] [--limit N]`

`decisions.md`의 모든 `### 블록`, `review-evidence.md`의 실패 표지(`✗ / fail / 롤백 / incomplete / bug / 버그 / warning`) 블록, `task-log.md`의 실패 키워드 라인, `session-handoff.md`의 Incomplete 섹션을 통합 추출. `--query`로 키워드 필터.

- `leerness guide [target]`이 자동으로 lessons 섹션을 추가 (target 이름을 query로 사용).

### Added — C. `lazy detect --auto-track` + `.harness/known-todos.json`

새 TODO/FIXME/XXX의 `(file, line, text)` 위치 캡처. `known-todos.json`에 acknowledged 기록을 비교해 매번 같은 false positive를 줄이고, 새로 발견된 것만 노출. `--auto-track`으로 `progress-tracker.md`에 `T-XXXX requested`로 자동 등록 + known-todos.json에도 자동 추가.

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다.

## 1.9.6 — 2026-05-08

1.9.5 후 발견된 한 가지 한계 (옛 link 손실 자동 복구 부재)를 패치.

### Added

- **`leerness task relink [--apply] [--min-score 0.2]`** — `plan.md`의 milestone 텍스트와 `progress-tracker.md`의 task `request` 텍스트를 jaccard 토큰 유사도로 비교해 미연결 milestone을 가장 비슷한 row와 자동 매칭. default는 제안만 출력 (사용자가 명령 복사해 실행), `--apply`로 자동 적용. `--min-score`로 임계 조정 (기본 0.2).
- **`audit`이 미연결 milestone 발견 시 `leerness task relink` 안내 자동 출력**.

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다.

## 1.9.5 — 2026-05-08

1.9.4 운영 중 발견된 한계 2건 + 추가 디버그 사항을 패치합니다.

### Fixed

- **F. `task fix-evidence --set` link 보존**: 기존 evidence의 `plan:M-XXXX` 링크를 새 텍스트에 자동으로 `(plan:M-XXXX)` 형태로 부착. `--no-preserve-link`로 끌 수 있음. 이전엔 링크가 사라져 audit이 milestone 미연결로 잡았음.
- **G. `impact` 동적 참조 (medium)**: `path.join`, `path.resolve`, `readFile`, `writeFile`, `fs.*`, `new URL` 등이 base 파일명을 인자로 받는 패턴을 별도 카테고리(medium)로 분리. default 출력에 strong + medium 모두 표시. site-cli의 `build.js`처럼 동적으로 컴포넌트를 읽는 빌더가 더 이상 weak로만 잡히지 않음.

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다.

## 1.9.4 — 2026-05-08

1.9.3 운영 중 발견된 5개 한계점을 모두 패치합니다.

### Fixed

- **A. impact 정확도**: 강한 참조(`import / require / @import / href / src / url / include`)와 약한 참조(식별자 등장)를 분리해 default는 강한 참조만 출력. word boundary 추가로 `cards` 안의 `card`가 false positive로 잡히던 문제 해결. `--all`로 약한 참조까지 표시.
- **B. cross-platform 종료 코드**: main이 끝난 뒤 `process.exit(process.exitCode)`을 명시. 셸 wrapper나 npx 파이프라인에서 `$?`이 0으로 보이던 문제 해결. `ui consistency --fail-on-violation`은 `--strict-exit`로 즉시 `process.exit(1)`도 가능.
- **C. lazy detect string literal 휴리스틱**: 매치 위치가 `'…'`/`"…"`/`` `…` `` 안이면 카운트에서 제외. leerness CLI 자기 자신(bin/harness.js)도 자동 skip. 메인 디렉토리에서 30개 잡히던 false positive 사실상 0.

### Added

- **D. `leerness task fix-evidence`** — `done` 상태이면서 evidence가 비어있거나 `user-request` / `plan:M-XXXX` 단독인 row를 일괄 점검. `--set "<텍스트>"`로 일괄 갱신, 또는 row별 `task update` 명령을 출력해 가이드.
- **E. `.leerness-skip-dirs` 파일** — 프로젝트 루트에 두면 추가 skip 디렉토리(예: `_apps/`, `leerness-pkg/`)가 모든 walk에서 적용됨. 1줄당 1개 디렉토리, `#` 주석 지원. 기본 skip 셋에도 `out`, `tmp`, `temp`, `.svelte-kit`, `.parcel-cache` 추가.

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다.

## 1.9.3 — 2026-05-08

이번 릴리스는 "이전 작업과 새 작업의 인과관계·재귀 안내·디자인 일관성"을 자동화합니다.

### Added — 인과관계·재사용·일관성

- `leerness impact <target>` — 변경 전 영향 분석. `<target>`을 `import/require/href/src/@import/url()`로 참조하는 모든 파일을 단일 패스로 식별.
- `leerness reuse find <query>` — `reuse-map.md`, `design-system.md`, `feature-contracts.md`, `plan/progress`, 그리고 코드의 export/식별자에서 기존 자원을 통합 검색.
- `leerness reuse register <name> --where <path> --kind component|hook|util|api [--note ...]` — `reuse-map.md`에 자동 row 추가.
- `leerness ui consistency [path] [--strict] [--fail-on-violation]` — `design-system.md`의 토큰 표를 파싱해 코드의 hex 색상이 토큰에 등록되어 있는지 검사. `--strict`는 px/rem 사이즈도, `--fail-on-violation`은 비-제로 종료.
- `leerness graph [path] [--out <file>]` — 의존성 그래프를 mermaid 형식으로 출력하거나 파일로 저장.
- `leerness guide [target]` — 위 4개를 한 번에 실행하는 변경 전 통합 가이드.

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다.

## 1.9.2 — 2026-05-08

스킬을 살아 있는 학습 사이클로 끌어올린 릴리스. 동일 API 작업이 반복될 때 기존 패턴을 발견·재사용하고, 더 나은 방법이 생기면 최적화 이력으로 누적합니다.

### Added — 스킬 학습 사이클

- `leerness skill learn <id> --doc <url> --command "..." --capability "..." [--note ...]`
  - 새 스킬을 `.harness/skills/<id>/skill.json`에 생성하거나, 카탈로그 스킬을 로컬에 materialize.
  - `--doc` / `--capability`는 반복 가능 (n번 적으면 모두 누적).
  - `skill.json` 스키마 확장: `sources[]`, `patterns[]`, `optimizations[]`, `usage{count,lastUsed,lastNote}`.
- `leerness skill use <id> [--note ...]`: 사용 횟수+1, lastUsed 갱신.
- `leerness skill optimize <id> --before "..." --after "..." [--note ...]`: 최적화 이력 누적.
- `leerness skill remove <id>`: 사용자 정의 스킬 삭제 (카탈로그 스킬은 로컬 메타만 정리).
- `leerness skill consolidate [--threshold 0.3]`: 모든 스킬의 capability 토큰 jaccard 비교로 통합 후보 자동 발견.
- `leerness skill list`가 카탈로그 + 사용자 스킬을 합쳐 출력 (출처/사용횟수/최종 컬럼 추가).
- `leerness skill info <id>`가 sources/patterns/optimizations까지 모두 표시.

### Added — 게이트 통합

- `leerness gate [path]` — `verify + audit + scan secrets + encoding check + lazy detect`을 한번에 실행해 단일 요약을 출력. 한 단계라도 실패하면 비-제로 종료.
- `leerness self check`을 `leerness update --check`의 thin wrapper로 통합. 단일 출처(npm view + 캐시)로 일원화하면서 1.8.0과의 호환을 위해 명령 자체는 유지.

### Migration

기존 1.9.x 사용자는 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다. 카탈로그 스킬에 대한 사용 기록은 처음 `skill use`/`skill optimize` 시점부터 누적되기 시작합니다.

## 1.9.1 — 2026-05-08

1.9.0을 실 프로젝트(memo-cli)에서 운영하며 발견한 **5개 메타 감사 사항**을 패치합니다.

### Fixed

- **P1**: `autoUpdateInstall`이 legacy `leerness-plus update --check` SessionStart hook을 자동 정리. fork 시절 잔재로 인해 매 세션 npm 호출이 2회 발생하던 문제 해소.
- **P2**: `managedMerge`에 `MERGE_OVERWRITE_FILES` 화이트리스트 추가 (`skill-index.md`, `manifest.json`, `skills-lock.json`, `HARNESS_VERSION`, `LANGUAGE`, `context-routing.md`). 다단계 migrate를 거쳐도 표/메타데이터가 누적되지 않음.
- **P4**: `audit`이 `<!-- leerness:na <reason> -->` 마커를 인식. CLI 패키지 등 디자인 토큰/재사용 맵이 NA인 프로젝트에서 영구 경고가 사라짐.
- **P6**: `lazy detect`의 evidence 정규식을 `/^plan:M-\d{4}\s*$/`로 좁힘. `plan:M-XXXX` 단독은 부족 판정, `tests:32/32 (plan:M-0002)`처럼 검증 키워드 동반 시 통과.
- **P7**: `install`이 끝날 때 디폴트 `M-0001`이 plan에 있는데 progress에 row가 없으면 `T-XXXX` 자동 생성. audit "milestones without progress entry: M-0001" 경고가 init 직후 사라짐.

### Added

- `leerness skill list [path]` 출력에 **설치됨** 컬럼 추가 (root가 인자/현재 디렉토리에 있을 때).

### Migration

기존 1.9.0 설치본은 `npx leerness@latest update . --yes`로 즉시 자동 마이그레이션됩니다.

## 1.9.0 — 2026-05-08

이번 minor 릴리스는 1.8.0의 6개 결함을 수정하고, 자동 감지·자동 업데이트·핸드오프 자동 작성·게으름/시크릿/인코딩 자동 가드를 흡수한 큰 강화입니다. 기존 `npx leerness init` 흐름은 그대로 유지됩니다.

### Fixed (vs 1.8.0)

- B1: `task update`가 in-place 갱신하도록 progress-tracker를 구조화 파싱.
- B2: `plan add`의 milestone ID와 progress task ID 분리. evidence 컬럼에 `plan:M-XXXX` 링크.
- B3: `plan add --status/--progress/--next/--evidence` 인자가 progress row에 일관 반영.
- B4: `task list`가 표만 정돈 출력 (frontmatter 노출 안 함).
- B5: `routes.feature`이 참조하는 `feature-implementation` 스킬을 카탈로그에 추가하고 init이 `.harness/skills/feature-implementation/{README.md,skill.json}`을 자동 생성.
- B6: `session close`가 progress-tracker를 구조화 파싱하여 status 컬럼 정확 매칭.

### Added — 자동 감지·업데이트

- `leerness update [--check|--yes|--force|--from <tarball>]`
  - 현재 `.harness/HARNESS_VERSION` 자동 파싱 (1.8.0 bare, `leerness@1.8.0+plus@x.y.z` legacy plus 표기 모두 인식).
  - `npm view leerness version`으로 최신 비교 (24h 캐시).
  - 새 버전 발견 시 `npx leerness@latest migrate .`에 자동 위임 → 백업·머지·검증.
  - post-migration 으로 `status`/`verify`/`audit`을 자동 실행, `task-log.md`/`review-evidence.md` 자동 누적.
- `leerness auto-update install` — `.claude/settings.local.json`의 SessionStart hook + `/update` 슬래시 커맨드 자동 등록.
- `init`/`migrate`가 끝나면 위 hook을 기본 등록 (`--no-auto-update`로 끌 수 있음).
- `LEERNESS_OFFLINE=1` 환경변수로 npm 호출 건너뜀 (CI/오프라인 호환).

### Added — 컨텍스트·핸드오프 자동화

- `leerness handoff [path]` — 세션 시작 컨텍스트 자동 적재 + `current-state.md` 스탬프 자동 갱신.
- `leerness check [path]` — pre-action 정합 검증 (필수 파일·보호 정책).
- `leerness session close`가 `session-handoff.md`와 `current-state.md`를 **자동 작성** (이전엔 출력만 했음).
- `.harness/templates/{end-of-session-report.md, decision.md, task-row.md}` 표준 템플릿 추가.

### Added — 자동 가드

- `leerness audit [path]` — 디자인 가이드 중복·design 토큰·reuse-map·plan↔progress 정렬·handoff 신선도 감사.
- `leerness scan secrets [path]` — AWS/GitHub/GitHub fine-grained/OpenAI/Anthropic/Google/Slack/PEM/하드코딩 password 9개 패턴.
- `leerness encoding check [path]` — UTF-8 BOM, UTF-16 BOM, NUL, .bat의 chcp 65001 누락, 한글 라운드트립.
- `leerness lazy detect [path]` — 증거 없는 done, 빈 handoff, 추적 없는 TODO/FIXME, blocker 방치 자동 감지.
- `leerness memory search "키"` — decisions/log/handoff/plan/progress/evidence/architecture grep.

### Added — 정책 강화

- `.harness/anti-lazy-work-policy.md` — 1줄 선언 → 6개 규칙 + 자동 점검 항목.
- `.harness/secret-policy.md` — 패턴 목록 명시.
- `.harness/encoding-policy.md` — BOM/UTF-8/.bat chcp/Python coding/LF 통일.
- `.harness/test-evidence-policy.md` — 검증 기록 누적 형식.
- `.harness/review-evidence.md` — 자동 누적 evidence 파일.
- `.harness/guardrails.md` — 5개 파일 이상 리팩토링 사전 승인, destructive Git 가드.
- `.harness/task-type-map.md` — `bugfix`, `refactor`, `research`, `session-start` 작업 유형 추가.

### Added — Claude Code 통합

- `.claude/commands/{handoff, session-close, audit, lazy-detect, update, viewwork-ping}.md` 슬래시 커맨드.
- `.claude/skills/leerness.md` Claude Code 스킬 정의.
- `.claude/settings.local.json` SessionStart + Stop hook 자동 등록.

### Added — ViewWork 통합

- `leerness viewwork install` — `.viewwork/` 셋업 + Claude Code Stop hook 등록.
- `leerness viewwork emit` — JSONL 1줄 추가 (`.viewwork/agent-events.jsonl`).
- `session close`가 자동으로 viewwork emit.

### Changed

- `.gitignore`에 `.harness/archive/`, `.harness/migration-report.md`, `.harness/cache/` 라인 머지.
- `.gitattributes` 자동 생성 (`* text=auto eol=lf`, `*.bat eol=crlf`, `*.ps1 eol=crlf`).
- `routes.feature`이 가리키는 경로를 `.harness/skills/feature-implementation/README.md`로 정정.

### E2E

`npm test` (= `node scripts/e2e.js`)가 빈 임시 디렉토리에서 30+개 시나리오를 실측합니다 (B1 in-place upsert 회귀 + offline `update --check` + SessionStart hook 검증 포함).

## 1.8.0 — 2026-05-07

(이전 메인테이너의 릴리스. https://github.com/gugu9999gu/leerness 참고.)
