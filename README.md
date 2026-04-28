# Leerness

**Leerness는 AI 에이전트가 대규모 프로젝트에서도 맥락, 규율, 디자인/기능 일관성, 검증된 스킬 라이브러리를 유지하도록 돕는 AX 최적화 개발 하네스입니다.**

Leerness는 단순한 프롬프트 모음이 아닙니다. 프로젝트 안에 장기 기억, 작업 규칙, 금지사항, 디자인 기준, 기능 계약, 검증된 스킬 데이터를 설치해서 AI 에이전트가 매번 처음부터 추측하지 않고 같은 기준으로 개발하도록 만듭니다.

## 왜 필요한가

AI 코딩 에이전트는 빠르지만, 프로젝트가 커질수록 아래 문제가 생깁니다.

- 이전 결정과 현재 방향을 잊는다.
- 기존 구조와 다른 방식으로 새 코드를 만든다.
- 성공했던 구현 패턴을 반복 활용하지 못한다.
- 민감정보 처리 규칙을 일관되게 지키지 못한다.
- UI, API, 상태, 오류 처리 방식이 화면마다 달라진다.
- 다음 세션에서 어디까지 작업했는지 다시 설명해야 한다.

Leerness는 이 문제를 `.harness/` 지식 저장소와 검증된 스킬 라이브러리로 해결합니다.

## 핵심 개념

```text
Agent = Model + Leerness Harness
```

모델은 추론하고, Leerness는 프로젝트의 기억과 작업 규율을 제공합니다.

| 영역 | 역할 |
|---|---|
| 프로젝트 메모리 | 목적, 현재 상태, 아키텍처, 결정 로그, 다음 작업 유지 |
| Guardrails | 민감정보, 보안, 리팩토링, API/DB 변경 금지 규칙 정의 |
| Design System | UI/UX, 컴포넌트, 간격, 상태 표현 기준 유지 |
| Feature Contracts | 기능별 입력, 출력, 상태, 오류, 검증 기준 기록 |
| Skill Libraries | 성공한 구현 방식을 재사용 가능한 스킬로 축적 |
| AX Guide | AI가 읽고 실행하기 쉬운 업로드/업데이트/병합/마이그레이션 절차 제공 |

## 설치

```bash
npx leerness init
```

추천 스킬 포함 설치:

```bash
npx leerness init --skills recommended
```

필요한 스킬만 선택 설치:

```bash
npx leerness init --skills office,commerce-api,crawling
```

특정 경로에 설치:

```bash
npx leerness init ./my-project
```

## 주요 명령어

```bash
leerness init [path] [--skills recommended|all|office,commerce-api]
leerness status [path]
leerness verify [path]

leerness skill list
leerness skill add <name>
leerness skill remove <name>
leerness skill update <name>
leerness skill learn <name> --from <validated-skill-path>

leerness library guide [path]
leerness library status <path>
leerness library validate <path> [--strict-ai]
leerness library verify <path> --ai --reviewer leerness-ai
leerness library build <path> [--out ./dist] [--package leerness-skill-name]
leerness library update <path> --from <validated-new-skill-path> [--version 1.1.0]
leerness library merge <source-library> --path <project>
leerness library migrate <path> [--version 1.0.0]
leerness library publish <built-library> --target npm|git [--execute]
```

## 생성 구조

```text
your-project/
├── AGENTS.md
├── CLAUDE.md
├── .cursor/rules/leerness.mdc
├── .github/copilot-instructions.md
└── .harness/
    ├── HARNESS_VERSION
    ├── manifest.json
    ├── project-brief.md
    ├── current-state.md
    ├── architecture.md
    ├── context-map.md
    ├── decisions.md
    ├── task-log.md
    ├── constraints.md
    ├── guardrails.md
    ├── design-system.md
    ├── feature-contracts.md
    ├── testing-strategy.md
    ├── review-checklist.md
    ├── release-checklist.md
    ├── session-handoff.md
    ├── AX_SKILL_LIBRARY_GUIDE.md
    ├── skills/
    ├── library/
    └── archive/
```

## AX 최적화 가이드

설치하면 AI 에이전트가 바로 읽을 수 있는 가이드가 생성됩니다.

```text
.harness/AX_SKILL_LIBRARY_GUIDE.md
```

이 문서는 다음 작업을 AI가 안전하게 수행하도록 안내합니다.

- 검증된 스킬 학습
- 스킬 데이터 정규화
- 민감정보 스캔
- AI 검증 메타데이터 기록
- 라이브러리 빌드
- npm/git 업로드 dry-run
- 실제 업로드 승인 흐름
- 업데이트 시 재검증 강제
- 스킬 병합과 마이그레이션

## AI 검증 게이트

스킬 라이브러리는 AI 검증 메타데이터가 있어야 업로드할 수 있습니다.

```bash
leerness library verify ./my-skill --ai --reviewer leerness-ai
leerness library validate ./my-skill --strict-ai
leerness library build ./my-skill
leerness library publish ./my-skill/dist/my-skill --target npm --execute
```

`library publish`는 기본값이 dry-run입니다. 실제 업로드는 `--execute`가 있을 때만 실행됩니다.

## 스킬 메타데이터

각 스킬에는 최종 업데이트 날짜와 검증 상태가 표시됩니다.

```json
{
  "name": "commerce-api-coupang",
  "version": "1.0.0",
  "lastUpdated": "2026-04-28",
  "lastUpdatedAt": "2026-04-28T00:00:00.000Z",
  "verification": {
    "status": "passed",
    "method": "ai-assisted-review",
    "verifiedBy": "leerness-ai",
    "verifiedAt": "2026-04-28T00:00:00.000Z"
  }
}
```

## 민감정보 원칙

스킬에는 실제 민감정보를 저장하지 않습니다.

허용:

```text
COUPANG_ACCESS_KEY
NAVER_AD_CUSTOMER_ID
GOOGLE_APPLICATION_CREDENTIALS
```

금지:

```text
실제 access token
실제 cookie
실제 password
고객 개인정보 export
운영 API 응답 원문
```

실제 값은 `.env.local`, GitHub Actions Secrets, Vercel/Firebase/Cloud Run 환경변수처럼 프로젝트 외부의 안전한 저장소에 둡니다.

## 권장 작업 루틴

AI 에이전트에게 작업이 끝날 때 이렇게 요청하세요.

```text
이번 작업 내용을 .harness/current-state.md, .harness/task-log.md, .harness/session-handoff.md에 반영해줘.
중요한 설계 결정이 있었다면 .harness/decisions.md에도 기록해줘.
UI나 기능 계약이 바뀌었다면 design-system.md 또는 feature-contracts.md도 갱신해줘.
성공한 구현 패턴은 스킬 후보로 정리해줘.
```

## 라이선스

MIT
