# 커머스 API 연동 스킬 라이브러리

영문명: Commerce API Integration Skill Library

## 설명

쿠팡·롯데온·스마트스토어 등 커머스 API 연동 패턴을 위한 스킬입니다.

## 가능한 작업

- API 인증 구조 설계
- 상품/주문/매출 동기화 플로우 구현
- 환경변수 기반 민감정보 분리
- 오류·재시도·레이트리밋 대응

## 민감정보 규칙

- 실제 토큰, 비밀번호, 쿠키, private key를 기록하지 않습니다.
- 필요한 값은 환경변수 이름만 기록합니다.
- 작업 후 current-state.md, task-log.md, session-handoff.md를 갱신합니다.

## 최종 업데이트

2026-04-29
