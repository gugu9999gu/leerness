# Leerness

**Leerness는 AI 에이전트가 프로젝트의 맥락, 작업 규율, 언어 정책, 스킬 라이브러리, 진행 작업 상태를 일관되게 읽고 기록하도록 돕는 AX 최적화 개발 하네스입니다.**

Leerness는 프로젝트 안에 `.harness/` 지식 저장소를 만들고, AI가 작업 유형별로 어떤 파일을 읽어야 하는지와 작업 후 어떤 파일을 갱신해야 하는지 명확히 지시합니다. 세션이 끝날 때는 완료/진행중/미완료/예정/보류/대기 작업과 검증 결과를 남기도록 강제합니다.

## 주요 기능

| 기능 | 설명 |
|---|---|
| 언어 정책 | 설치 시 언어를 자동 감지하거나 `ko/en`으로 선택해 하네스와 스킬 문서의 작성 언어를 통일합니다. |
| Context Routing | feature, ui, release, migration, debug 등 작업 유형별 참조 파일과 갱신 파일을 안내합니다. |
| Writeback Policy | 목적, 현재 상태, 아키텍처, 결정 로그, 릴리즈 체크리스트 등 정보를 어디에 기록할지 정의합니다. |
| 진행 작업 추적 | 사용자 요청별 작업을 requested/planned/in-progress/waiting/on-hold/blocked/incomplete/done/dropped 상태로 추적합니다. |
| 작업 드랍 | 사용자가 더 이상 원하지 않는 작업은 삭제하지 않고 `dropped`로 표시해 이력을 보존합니다. |
| 세션 종료 인수인계 | 매 세션 종료 시 완료/진행중/미완료/예정/보류/대기/드랍 작업과 추천 방향을 표기합니다. |
| 스킬 라이브러리 | 검증된 작업 패턴을 스킬팩으로 설치하고, 한글명/가능 작업/최종 업데이트일/AI 검증 상태를 표시합니다. |
| AI 검증 게이트 | 검증된 스킬만 npm/git 업로드가 가능하도록 검증 메타데이터와 토큰 게이트를 사용합니다. |
| 디버그 | `leerness debug`로 AGENTS 방향지시, 언어 정책, 라우팅, 세션 종료 정책, 진행 작업 추적이 정상인지 점검합니다. |

## 설치

```bash
npx leerness init
```

언어를 명시해서 설치:

```bash
npx leerness init --language ko
npx leerness init --language en
```

추천 스킬 포함:

```bash
npx leerness init --language ko --skills recommended
```

기존 프로젝트 또는 구버전 하네스 마이그레이션:

```bash
npx leerness migrate --dry-run
npx leerness migrate --language ko
```

## 주요 명령어

```bash
leerness init [path] [--language auto|ko|en] [--skills recommended|all|office,commerce-api]
leerness migrate [path] [--dry-run] [--language auto|ko|en]
leerness status [path]
leerness verify [path]
leerness debug [path]
leerness route <task-type>
```

작업 추적:

```bash
leerness task list
leerness task list --status planned,waiting,on-hold
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

스킬 라이브러리:

```bash
leerness library validate <path> --strict-ai
leerness library verify <path> --ai --reviewer leerness-ai
leerness library build <path>
leerness library publish <built-library> --target npm|git --execute
```

## 생성되는 핵심 파일

```text
.harness/
  LANGUAGE                       # ko 또는 en
  language-policy.md             # 문서/스킬 작성 언어 규칙
  project-brief.md               # 프로젝트 목적/사용자/성공 기준
  current-state.md               # 현재 상태/다음 작업/블로커
  architecture.md                # 구조/모듈/데이터 흐름
  context-map.md                 # 기능별 참조 파일 지도
  decisions.md                   # 결정 로그
  guardrails.md                  # 금지사항/보안/민감영역 규칙
  design-system.md               # UI/UX/컴포넌트 일관성
  feature-contracts.md           # 기능 입력/출력/상태/오류 계약
  testing-strategy.md            # 검증 전략
  release-checklist.md           # 배포/npm/git/환경변수/롤백 조건
  progress-tracker.md            # 사용자 요청별 진행/미완료/보류/대기 추적
  session-handoff.md             # 다음 세션 인수인계
  session-close-policy.md        # 세션 종료 보고 규칙
  anti-lazy-work-policy.md       # 게으른 작업 방지 규칙
  debug-guide.md                 # 하네스 작동 점검 기준
  context-routing.md             # 작업 유형별 읽기/갱신 라우팅
  writeback-policy.md            # 어떤 정보를 어디에 기록할지
  task-type-map.md               # 사용자 요청 → 작업 유형 매핑
  AX_MIGRATION_GUIDE.md          # AI용 구버전 마이그레이션 가이드
  AX_NEW_PROJECT_GUIDE.md        # AI용 신규 설치/프로젝트 반영 가이드
  AX_SKILL_LIBRARY_GUIDE.md      # AI용 스킬 라이브러리 가이드
```

## 언어 정책

설치 시 `--language auto`가 기본입니다. Leerness는 기존 README, AGENTS, 하네스 문서를 보고 한국어/영어를 추정합니다. 대화형 터미널에서는 사용자가 직접 선택할 수 있습니다.

언어 정책은 아래 파일에 저장됩니다.

```text
.harness/LANGUAGE
.harness/language-policy.md
```

AI는 하네스 문서, 스킬 문서, 세션 인수인계, 진행 작업 목록을 이 언어로 작성해야 합니다. 단, 코드 식별자, 파일명, 명령어, 환경변수명, API 필드명은 원문을 유지합니다.

## 진행 작업과 드랍 처리

`progress-tracker.md`는 사용자 요청을 세션 간 추적합니다.

상태값:

```text
requested
planned
in-progress
waiting
on-hold
blocked
incomplete
done
dropped
```

사용자가 어떤 작업을 중단하거나 범위에서 제외하면 삭제하지 않고 `dropped`로 표시합니다.

```bash
leerness task drop T-0004 --reason "사용자가 이번 범위에서 제외"
```

세션 종료 시 unresolved 상태인 작업은 자동으로 표기 대상입니다.

```text
requested, planned, in-progress, waiting, on-hold, blocked, incomplete
```

## 디버그

하네스가 제대로 작동하는지 확인합니다.

```bash
leerness debug
```

점검 항목:

- AGENTS.md가 language-policy, context-routing, writeback-policy, progress-tracker, anti-lazy policy를 참조하는지
- `.harness/language-policy.md`가 존재하고 언어가 manifest에 기록됐는지
- context-routing/writeback/task-type-map이 있는지
- progress-tracker가 작업 상태 표를 갖고 있는지
- session-close-policy가 미완료/예정/보류/대기 작업 목록화를 요구하는지
- 하네스 파일에 토큰/비밀번호/private key 의심 패턴이 없는지

## 세션 종료 보고 기준

AI는 의미 있는 세션이 끝날 때 아래를 정리해야 합니다.

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

## 라이선스

MIT
