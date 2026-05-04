# Leerness

**Leerness는 AI 에이전트가 프로젝트의 목표, 계획, 진행률, 작업 규율, 스킬 라이브러리, 세션 인수인계를 일관되게 관리하도록 돕는 AX 최적화 개발 하네스입니다.**

Leerness는 `.harness/` 지식 저장소를 설치하고, AI가 작업 전에 어떤 파일을 읽어야 하는지와 작업 후 어떤 파일을 갱신해야 하는지 명확히 지시합니다. 프로젝트 계획은 `plan.md`, 실제 작업 상태는 `progress-tracker.md`, 실행 기준은 `guideline.md`로 분리해서 장기 맥락과 진행률을 안정적으로 유지합니다.

## 주요 기능

| 기능 | 설명 |
|---|---|
| 계획 수립/수정 | `plan.md`로 프로젝트 목표, 범위, milestone, 제외/드랍 항목, 변경 이력을 관리합니다. |
| 진행률 추적 | `progress-tracker.md`로 사용자 요청별 작업 상태와 다음 액션을 추적합니다. |
| Guideline 정책 | `guideline.md`가 `plan.md`와 `progress-tracker.md`를 참조해 계획 이행 기준을 제공합니다. |
| 신규 프로젝트 부트스트랩 | 계획이 없는 프로젝트에서는 먼저 계획 초안을 만들고 이후 구현을 진행하도록 유도합니다. |
| Context Routing | planning, feature, ui, release, migration, debug 등 작업 유형별 참조/갱신 파일을 안내합니다. |
| Writeback Policy | 목적, 현재 상태, 아키텍처, 결정 로그, 릴리즈 체크리스트 등 정보를 어디에 기록할지 정의합니다. |
| 언어 정책 | 설치 시 언어를 자동 감지하거나 `ko/en`으로 선택해 하네스와 스킬 문서의 작성 언어를 통일합니다. |
| 세션 종료 인수인계 | 매 세션 종료 시 완료/진행중/미완료/예정/보류/대기/드랍 작업과 추천 방향을 표기합니다. |
| 스킬 라이브러리 | 검증된 작업 패턴을 스킬팩으로 설치하고, 한글명/가능 작업/최종 업데이트일/AI 검증 상태를 표시합니다. |
| 디버그 | `leerness debug`로 AGENTS 방향지시, 계획, 진행률, 라우팅, 세션 종료 정책이 정상인지 점검합니다. |

## 설치

```bash
npx leerness init
```

언어와 추천 스킬을 지정해서 설치:

```bash
npx leerness init --language ko --skills recommended
```

기존 프로젝트 또는 구버전 하네스 마이그레이션:

```bash
npx leerness migrate --dry-run
npx leerness migrate --language ko
```

## 계획 관리

```bash
leerness plan show
leerness plan init --goal "AI 상세페이지 생성 서비스"
leerness plan add "커머스 API 연동" --status planned
leerness plan update M-0002 --status in-progress --progress 40
leerness plan drop "관리자 대시보드" --reason "이번 버전 범위에서 제외"
leerness plan progress
leerness plan sync
```

`plan.md`는 전체 계획과 범위를 관리합니다. `progress-tracker.md`는 구체적인 작업 상태를 관리합니다. `guideline.md`는 계획을 어떤 기준으로 수행할지 정의합니다.

## 주요 명령어

```bash
leerness init [path] [--language auto|ko|en] [--skills recommended|all|office,commerce-api]
leerness migrate [path] [--dry-run] [--language auto|ko|en]
leerness status [path]
leerness verify [path]
leerness debug [path]
leerness route <planning|feature|ui|debugging|refactor|release|migration|new-install|skill-library|documentation|debug|session-close>
```

작업 추적:

```bash
leerness task list
leerness task add "쿠팡 API 연동 검증" --status planned
leerness task update T-0002 --status in-progress --next "인증 응답 확인"
leerness task drop T-0002 --reason "사용자가 범위에서 제외"
```

세션 종료:

```bash
leerness route session-close
leerness session close
```

스킬:

```bash
leerness skill list
leerness skill info ai-verified-skill-publisher
leerness skill add ai-verified-skill-publisher
```

## 생성되는 핵심 파일

```text
.harness/
  plan.md                         # 프로젝트 목표, 범위, milestone, 제외/드랍 항목
  progress-tracker.md             # 사용자 요청별 작업 상태와 진행률
  guideline.md                    # plan/progress 기반 실행 기준
  LANGUAGE                        # ko 또는 en
  language-policy.md              # 문서/스킬 작성 언어 규칙
  project-brief.md                # 프로젝트 목적/사용자/성공 기준
  current-state.md                # 현재 상태/다음 작업/블로커
  architecture.md                 # 구조/모듈/데이터 흐름
  context-map.md                  # 기능별 참조 파일 지도
  decisions.md                    # 결정 로그
  guardrails.md                   # 금지사항/보안/민감영역 규칙
  design-system.md                # UI/UX/컴포넌트 일관성
  feature-contracts.md            # 기능 입력/출력/상태/오류 계약
  testing-strategy.md             # 검증 전략
  release-checklist.md            # 배포/npm/git/환경변수/롤백 조건
  session-handoff.md              # 다음 세션 인수인계
  session-close-policy.md         # 세션 종료 보고 규칙
  anti-lazy-work-policy.md        # 게으른 작업 방지 규칙
  context-routing.md              # 작업 유형별 읽기/갱신 라우팅
  writeback-policy.md             # 어떤 정보를 어디에 기록할지
  task-type-map.md                # 사용자 요청 → 작업 유형 매핑
  AX_PLAN_GUIDE.md                # AI용 계획 수립/수정/동기화 가이드
  AX_MIGRATION_GUIDE.md           # AI용 구버전 마이그레이션 가이드
  AX_NEW_PROJECT_GUIDE.md         # AI용 신규 설치/프로젝트 반영 가이드
  AX_SKILL_LIBRARY_GUIDE.md       # AI용 스킬 라이브러리 가이드
```

## 디버그

```bash
leerness debug
```

점검 항목:

- `AGENTS.md`가 plan, guideline, language-policy, context-routing, writeback-policy, progress-tracker를 참조하는지
- `plan.md`에 milestone과 out-of-scope 영역이 있는지
- `guideline.md`가 `plan.md`와 `progress-tracker.md`를 참조하는지
- `progress-tracker.md`가 작업 상태 표를 갖고 있는지
- 세션 종료 정책이 미완료/예정/보류/대기 작업 목록화를 요구하는지
- 하네스 파일에 토큰/비밀번호/private key 의심 패턴이 없는지

## 세션 종료 보고 기준

AI는 의미 있는 세션이 끝날 때 아래를 정리해야 합니다.

- 계획 진행 요약
- 이번 세션에서 완료한 작업
- 사용자가 요청한 작업 중 진행 중인 작업
- 미완료/미시작 작업
- 예정/planned 작업
- 보류/on-hold 작업
- 대기/waiting 작업
- 차단/blocked 작업
- 사용자가 드랍한 작업과 이유
- 실행한 검증과 결과
- 변경한 파일과 갱신한 하네스 메모리
- 리스크, 가정, 블로커
- 추가로 진행하면 좋은 추천 방향
- 다음 세션에서 바로 수행할 단 하나의 정확한 작업

## Leerness 최신 버전 유지

AI 에이전트가 작업을 시작하기 전 또는 마이그레이션/배포/릴리즈 작업을 수행하기 전, 현재 프로젝트의 Leerness 버전과 npm registry의 최신 버전을 비교할 수 있습니다.

```bash
leerness self check .
```

이 명령은 내부적으로 아래 기준을 확인합니다.

```bash
npm view leerness version
leerness --version
cat .harness/HARNESS_VERSION
```

최신 버전이 감지되면 바로 덮어쓰지 않고 안전한 마이그레이션 순서를 안내합니다.

```bash
npx --yes leerness@<latest> migrate . --dry-run
npx --yes leerness@<latest> migrate .
npx --yes leerness@<latest> verify .
npx --yes leerness@<latest> debug .
```

관련 방향지시는 `.harness/leerness-maintenance.md`에 생성됩니다. npm 조회 실패나 고정 버전 사용도 작업 로그와 세션 인수인계에 기록하도록 설계했습니다.

## 라이선스

MIT
