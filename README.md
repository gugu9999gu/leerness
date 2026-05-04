# Leerness

**Leerness는 AI 에이전트가 대규모 프로젝트에서도 필요한 문서를 먼저 읽고, 작업 후 적재적소에 프로젝트 메모리를 갱신하며, 세션 종료마다 진행/미완료/추천 방향을 명확히 남기도록 만드는 AX 최적화 개발 하네스입니다.**

Leerness의 목적은 단순히 `.md` 파일을 많이 만드는 것이 아닙니다. AI가 어떤 상황에 어떤 파일을 봐야 하는지, 어떤 작업 후 어떤 파일을 갱신해야 하는지까지 명확히 지시합니다.

## 핵심 개념

```text
Agent = Model + Leerness Harness
```

모델은 추론하고, Leerness는 다음을 제공합니다.

| 영역 | 역할 |
|---|---|
| Context Routing | 작업 유형별로 읽을 파일과 갱신할 파일을 지정 |
| Writeback Policy | 어떤 정보를 어느 `.harness/*.md` 파일에 기록할지 정의 |
| Task Type Map | 사용자 요청을 feature/ui/release/migration 등으로 분류 |
| Project Memory | 목적, 현재 상태, 아키텍처, 결정 로그, 릴리즈 조건 유지 |
| Skill Libraries | 검증된 성공 패턴을 재사용 가능한 스킬로 설치/배포 |
| AX Guides | AI가 구버전 마이그레이션 또는 신규 설치를 안전하게 수행하도록 안내 |
| Session Close Policy | 세션 종료 시 완료/진행중/미완료/검증/추천 방향을 강제 기록 |
| Anti-Lazy Work Policy | 검증 없는 완료 선언, 모호한 요약, 미완료 작업 은폐를 방지 |

## 설치

```bash
npx leerness init
```

추천 스킬 포함:

```bash
npx leerness init --skills recommended
```

기존 프로젝트 또는 구버전 하네스 마이그레이션:

```bash
npx leerness migrate --dry-run
npx leerness migrate
```

## 주요 명령어

```bash
leerness init [path] [--yes] [--skills recommended|all|office,commerce-api]
leerness migrate [path] [--dry-run]
leerness status [path]
leerness verify [path]
leerness route <task-type>
leerness session close [path]

leerness skill list
leerness skill info <name>
leerness skill add <name>
leerness skill learn <name> --from <validated-skill-path>

leerness library guide [path]
leerness library validate <path> [--strict-ai]
leerness library verify <path> --ai --reviewer leerness-ai
leerness library build <path>
leerness library publish <built-library> --target npm|git [--execute]
```

작업 유형 라우팅 확인:

```bash
leerness route release
leerness route feature
leerness route migration
leerness route new-install
```

## 생성되는 핵심 파일

```text
.harness/
  project-brief.md              # 프로젝트 목적/사용자/성공 기준
  current-state.md              # 현재 상태/다음 작업/블로커
  architecture.md               # 구조/모듈/데이터 흐름
  context-map.md                # 기능별 참조 파일 지도
  decisions.md                  # 결정 로그
  guardrails.md                 # 금지사항/보안/민감영역 규칙
  design-system.md              # UI/UX/컴포넌트 일관성
  feature-contracts.md          # 기능 입력/출력/상태/오류 계약
  testing-strategy.md           # 검증 전략
  release-checklist.md          # 배포/npm/git/환경변수/롤백 조건
  session-handoff.md            # 다음 세션 인수인계
  session-close-policy.md        # 세션 종료 보고 규칙
  progress-tracker.md            # 사용자 요청별 진행/미완료 추적
  anti-lazy-work-policy.md       # 게으른 작업 방지 규칙
  context-routing.md            # 작업 유형별 읽기/갱신 라우팅
  writeback-policy.md           # 어떤 정보를 어디에 기록할지
  task-type-map.md              # 사용자 요청 → 작업 유형 매핑
  AX_MIGRATION_GUIDE.md         # AI용 구버전 마이그레이션 가이드
  AX_NEW_PROJECT_GUIDE.md       # AI용 신규 설치/프로젝트 반영 가이드
  AX_SKILL_LIBRARY_GUIDE.md     # AI용 스킬 라이브러리 가이드
```

각 핵심 파일에는 `readWhen`, `updateWhen`, `doNotStore` 메타데이터가 들어갑니다. AI는 이 정보를 기준으로 파일을 참조하고 갱신해야 합니다.

## AGENTS.md의 역할

`AGENTS.md`는 단순 지침 파일이 아니라 AI 작업 라우터입니다.

모든 작업은 다음 순서를 따릅니다.

1. 작업 유형을 분류한다.
2. `.harness/context-routing.md`와 `.harness/task-type-map.md`를 읽는다.
3. 작업 유형별 필수 파일을 읽는다.
4. 작업을 수행한다.
5. `.harness/writeback-policy.md`에 따라 필요한 파일을 갱신한다.
6. `current-state.md`, `task-log.md`, `session-handoff.md`를 최신화한다.

## AX 마이그레이션 가이드

구버전 Leerness, project-harness, 자체 AGENTS/CLAUDE 문서가 있는 프로젝트는 다음 파일을 기준으로 AI가 마이그레이션합니다.

```text
.harness/AX_MIGRATION_GUIDE.md
```

이 가이드는 다음을 지시합니다.

- 기존 하네스/지침 파일 백업
- legacy 내용의 새 목적지 매핑
- 충돌되는 규칙 처리
- 민감정보 제거
- 새 Context Routing/Writeback Policy 생성
- 마이그레이션 후 검증 및 session-handoff 갱신

## AX 신규 설치 가이드

이미 진행 중인 프로젝트에 처음 Leerness를 설치했다면 다음 파일을 기준으로 프로젝트 내용을 반영합니다.

```text
.harness/AX_NEW_PROJECT_GUIDE.md
```

이 가이드는 AI에게 다음을 요구합니다.

- 실제 파일 구조와 프레임워크 파악
- package/config/route/API/DB/deploy/test 파일 확인
- project-brief, architecture, context-map, design-system, feature-contracts 채우기
- release-checklist와 testing-strategy를 실제 프로젝트 기준으로 작성
- session-handoff에 다음 정확한 작업 기록


## 세션 종료 인수인계와 게으른 작업 방지

Leerness는 의미 있는 작업 세션이 끝날 때 AI가 다음 항목을 반드시 정리하도록 지시합니다.

```bash
leerness route session-close
leerness session close
```

세션 종료 보고에는 다음이 포함되어야 합니다.

- 이번 세션에서 완료한 작업
- 사용자가 요청한 작업 중 아직 진행 중인 작업
- 사용자가 요청했지만 아직 미완료 또는 미시작인 작업
- 실행한 검증과 결과
- 변경한 파일과 갱신한 하네스 메모리
- 리스크, 가정, 블로커
- 추가로 진행하면 좋은 추천 방향
- 다음 세션에서 바로 수행할 단 하나의 정확한 작업

관련 파일:

```text
.harness/session-close-policy.md
.harness/progress-tracker.md
.harness/anti-lazy-work-policy.md
.harness/templates/end-of-session-report.md
```

이 정책은 AI가 “대충 완료”라고 말하거나, 검증하지 않은 작업을 완료로 표시하거나, 미완료 요청을 숨기는 것을 막기 위한 장치입니다.

## 스킬 라이브러리

스킬은 한글명, 가능한 작업, 최종 업데이트일, AI 검증 상태를 표시합니다.

```bash
leerness skill list
leerness skill info ai-verified-skill-publisher
```

검증된 스킬 업로드는 AI 검증 메타데이터가 있어야 하며, 실제 npm/git 업로드에는 토큰 게이트가 적용됩니다.

## 민감정보 원칙

Leerness 파일에는 실제 토큰, 비밀번호, 쿠키, private key, 고객 개인정보를 저장하지 않습니다. 환경변수 이름과 secret manager key 이름만 기록합니다.

## 라이선스

MIT
