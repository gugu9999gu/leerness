# AX Migration Guide for AI Agents

구버전 하네스, 자체 AGENTS/CLAUDE 지침, 오래된 `.harness/` 파일을 Leerness 최신 구조로 옮기기 위한 AI 전용 가이드입니다.

## 목표

기존 지식을 잃지 않고, 새 구조에서 AI가 어떤 파일을 읽고 어떤 파일을 갱신해야 하는지 명확하게 만듭니다.

## 절차

1. `leerness migrate --dry-run`으로 감지 목록을 확인합니다.
2. 기존 파일을 `.harness/archive/legacy-migration-*`에 백업합니다.
3. legacy 내용을 새 목적지로 분류합니다.
4. `context-routing.md`, `writeback-policy.md`, `task-type-map.md`를 생성합니다.
5. `AGENTS.md`가 새 라우팅 파일들을 보도록 갱신합니다.
6. 민감정보 값은 제거하고 변수명만 남깁니다.
7. `leerness verify`를 실행합니다.
8. `session-handoff.md`에 마이그레이션 결과와 다음 작업을 기록합니다.

## Legacy mapping

| Legacy content | New destination |
|---|---|
| 프로젝트 목적/방향 | project-brief.md |
| 현재 상태/작업 이력 | current-state.md, task-log.md |
| 구조/모듈/데이터 흐름 | architecture.md, context-map.md |
| 기존 AI 규칙 | AGENTS.md, guardrails.md, context-routing.md |
| 배포 이슈 | release-checklist.md |
| 성공한 반복 작업 | skill candidate 또는 .harness/skills/ |
