# AX Skill Library Guide

AI가 검증된 스킬을 학습, 라이브러리화, 병합, 마이그레이션, 업로드할 때 따르는 기준입니다.

## 기본 원칙

- 스킬에는 실제 민감정보를 저장하지 않습니다.
- 환경변수 이름, secret manager key 이름, redacted 예시만 허용합니다.
- 스킬은 `displayNameKo`, `capabilities`, `lastUpdated`, `lastUpdatedAt`, `verification` 메타데이터를 가져야 합니다.
- `library publish`는 기본 dry-run이며, 실제 업로드는 `--execute`가 필요합니다.
- AI 검증 메타데이터가 없는 스킬은 업로드하지 않습니다.

## 표준 흐름

```bash
leerness skill learn my-skill --from ./validated-workflow
leerness library verify ./my-skill --ai --reviewer leerness-ai
leerness library validate ./my-skill --strict-ai
leerness library build ./my-skill
leerness library publish ./my-skill/dist/my-skill --target npm
leerness library publish ./my-skill/dist/my-skill --target npm --execute
```

## 업데이트 시

- 변경 이유를 README 또는 changelog에 남깁니다.
- `lastUpdated`와 `lastUpdatedAt`을 갱신합니다.
- AI 검증을 다시 수행합니다.
- 민감정보 스캔을 통과해야 합니다.
