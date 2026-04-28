# Leerness AX Skill Library Guide

AX는 AI eXperience의 약자입니다. 이 문서는 AI 에이전트가 검증된 스킬 데이터를 안전하게 학습, 검증, 빌드, 업로드, 업데이트, 병합, 마이그레이션할 수 있도록 만든 실행 가이드입니다.

## 목표

- 성공한 구현 방식을 재사용 가능한 스킬로 축적한다.
- 민감정보는 절대 스킬에 저장하지 않는다.
- 스킬 업로드는 AI 검증 게이트를 통과한 경우에만 허용한다.
- 각 스킬의 최종 업데이트 날짜, 버전, 검증 상태를 명확히 표시한다.
- downstream 프로젝트에 병합할 때 `.harness/skills-lock.json`에 출처와 상태를 기록한다.

## 전체 흐름

```text
검증된 프로젝트 작업
  -> leerness skill learn
  -> leerness library validate
  -> leerness library verify --ai
  -> leerness library build
  -> leerness library publish --target npm|git --execute
  -> 다른 프로젝트에서 library merge/update/migrate
```

## 스킬에 들어갈 수 있는 데이터

허용:

```text
반복 가능한 절차
성공한 구현 순서
검증 방법
실패 대응법
환경변수 이름
파일 구조
의사코드와 템플릿
```

금지:

```text
실제 토큰
실제 쿠키
비밀번호
운영 고객 데이터
개인정보가 포함된 API 응답 원문
비공개 인증 헤더
```

## 필수 메타데이터

```json
{
  "name": "commerce-api-coupang",
  "version": "1.0.0",
  "title": "Coupang Commerce API Skill",
  "category": "commerce-api",
  "description": "쿠팡 커머스 API 연동을 위한 재사용 가능한 구현 가이드",
  "lastUpdated": "2026-04-28",
  "lastUpdatedAt": "2026-04-28T00:00:00.000Z",
  "requiresEnv": [
    "COUPANG_ACCESS_KEY",
    "COUPANG_SECRET_KEY"
  ],
  "sensitiveDataPolicy": "env-reference-only",
  "verification": {
    "status": "passed",
    "method": "ai-assisted-review",
    "verifiedBy": "leerness-ai",
    "verifiedAt": "2026-04-28T00:00:00.000Z",
    "checks": [
      "structure",
      "secret-scan",
      "env-reference-only",
      "reusability",
      "migration-readiness"
    ]
  }
}
```

## 업로드 규칙

업로드 전:

```bash
leerness library validate ./my-skill --strict-ai
leerness library verify ./my-skill --ai --reviewer leerness-ai
leerness library build ./my-skill
```

npm 업로드:

```bash
leerness library publish ./my-skill/dist/my-skill --target npm --execute
```

git 업로드:

```bash
leerness library publish ./my-skill/dist/my-skill --target git --repo https://github.com/USER/leerness-skill-name.git --execute
```

`--execute`가 없으면 dry-run입니다. AI 검증 메타데이터가 없거나 `needs-review` 상태이면 업로드가 차단됩니다.

## 업데이트 규칙

```bash
leerness library update ./my-skill --from ./validated-new-skill --version 1.1.0
```

업데이트 후에는 검증 상태가 `needs-review`로 돌아갑니다. 다시 AI 검증을 통과해야 업로드할 수 있습니다.

## 병합 규칙

```bash
leerness library merge ./dist/my-skill --path ./target-project
```

병합 결과는 아래에 기록됩니다.

```text
.harness/skills-lock.json
```

기록 항목:

```json
{
  "name": "commerce-api-coupang",
  "version": "1.0.0",
  "source": "local-or-package",
  "lastUpdated": "2026-04-28",
  "verificationStatus": "passed"
}
```

## 마이그레이션 규칙

```bash
leerness library migrate ./old-skill-folder --version 1.0.0
```

마이그레이션은 기존 스킬 폴더를 표준 메타데이터 구조로 정규화합니다. 마이그레이션된 스킬은 자동으로 `needs-review`가 되며, 업로드 전 다시 검증해야 합니다.

## AI 에이전트용 체크리스트

- [ ] 스킬 목적과 사용 조건이 명확한가
- [ ] 구현 절차가 재현 가능한가
- [ ] 실제 비밀값이 없는가
- [ ] 환경변수 이름만 기록했는가
- [ ] lastUpdated, lastUpdatedAt이 있는가
- [ ] verification.status가 passed인가
- [ ] 업데이트 후 재검증이 필요한 상태를 표시했는가
- [ ] 병합 시 skills-lock에 기록되는가
- [ ] 업로드는 dry-run 후 --execute로만 수행되는가
