# AI 검증 스킬 업로드 스킬 라이브러리

영문명: AI Verified Skill Publisher Skill Library

## 설명

검증된 스킬을 라이브러리화하고 npm/git에 안전하게 업로드하기 위한 스킬입니다.

## 가능한 작업

- 검증된 작업 흐름을 스킬 후보로 정규화
- 민감정보 스캔 후 업로드 차단
- AI 검증 메타데이터 기록
- npm/git dry-run 후 --execute 배포

## 민감정보 규칙

- 실제 토큰, 비밀번호, 쿠키, private key를 기록하지 않습니다.
- 필요한 값은 환경변수 이름만 기록합니다.
- 작업 후 current-state.md, task-log.md, session-handoff.md를 갱신합니다.

## 최종 업데이트

2026-04-29
