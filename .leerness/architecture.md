---
leernessRole: architecture
readWhen:
  - 기능 구현
  - 리팩토링
  - 마이그레이션
updateWhen:
  - 구조 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Architecture

## Overview
- 현재 배포 기준은 v1.36.186. Node >=18 CommonJS CLI(`bin/leerness.js`)와 MCP(`lib/mcp-tools.js`)가 운영·기억·검증 명령을 제공한다. 런타임 의존성은 0이다.
- CLI에는 인자 분배와 state/task/memory writer가 남아 있으며, session-close·provider 실행·role schema/store/fallback·workspace migration 등은 `lib/` 도메인 모듈로 분리되어 있다.
- `lib/workspace-dir.js`는 Project workspace `.leerness`를 판별하고 `.harness` 호환 migration을 담당한다. Git runtime 경로를 분리하는 StateManager는 아직 없다.
- UR-0097 구조 감사와 목표 설계는 `docs/state-scopes.md`를 따른다. 목표 구조를 이미 구현된 것처럼 표시하지 않는다.

## Data Flow
- CLI/MCP → 명령 handler → 도메인 로더/검증기 → `lib/io.js`의 보존형 쓰기와 기존 lock gateway. Git 실행은 `lib/git.js`를 통해 위치 환경변수를 격리한다.
- `progress-tracker.md`가 현재 task 원본이다. `session close`는 그 행에서 handoff와 current-state의 auto 표식 줄을 생성한다. 문서별 lock은 같은 checkout의 경합만 직렬화하며 브랜치 간 merge를 해결하지 않는다.
- 유효한 `decisions.json`/`lessons.json` 배열은 원본이고 `.md`는 표시본이다. 현재 reader는 JSON 손상/non-array에서 Markdown으로 fallback하므로 migration은 해당 loader 결과를 그대로 신뢰하지 않고 invalid에서 중단해야 한다. 저장은 두 파일을 갱신하므로 별도 worktree의 독립 추가도 같은 파일을 변경한다.
- `state start/record/verify/handoff`는 `.leerness/state.json`, `runs/`, `handoff/`를 갱신한다. session ownership은 존재하지만 run 번호는 checkout-local이다.
- `.leerness/cache/` 안에서 presence는 `sessions/`, handoff freshness는 `handoffs/`, REPL 대화는 `agent-sessions/`, 관측 run은 `agent-runs/`, file lease는 `file-leases.json`으로 구분된다. execution ledger는 `.leerness/execution-ledger.jsonl`에 있다. 이 checkout에서는 cache와 ledger가 ignored이며 durable result record와 다르다.
- Role v2 순수 validator/projection과 fail-closed legacy role-store는 구현되어 있다. 명시적 migration 전 legacy schema v1이 runtime 쓰기의 기준이다.

## External Dependencies
- Node 표준 모듈만 필수. Git은 Git 기능의 선택적 전제이며, provider CLI는 명시적 실행 경로에서만 사용한다.
- Git의 private/common metadata는 linked worktree를 구분하지만 다른 clone/host를 연결하지 않는다. 외부 편집기나 임의의 worktree 삭제를 Leerness가 강제 제어한다고 주장하지 않는다.

## Recorded Direction vs Pending Implementation
- 개발 방향: Project / Worktree / Common-Control / Immutable-Record / Generated-View의 5개 scope, 세션별 runtime owner, 공용 task claim, 불변 기억·결과 기록, 단일 consolidator의 재생성 뷰.
- 구현·출하 완료: P-0020 / M-0014의 additive scope resolver와 읽기 전용 `state inspect` 및 I/O 최적화(v1.36.186). 기존 데이터 자동 이동·삭제·runtime 전환은 포함하지 않는다.
- 승인 후 구현·통합검증 중: P-0021 / T-0180 / M-0015-A의 `lib/runtime-layout.js`는 고정 descriptor를 엄격히 읽고 `lib/runtime-writes.js`는 CLI startup·모듈·MCP·REPL·lock/FD 쓰기 경계에 관측 기반 거부를 적용한다. `state compatibility`는 무쓰기 진단이다. `docs/runtime-compatibility-api.md`와 `docs/worktree-runtime-migration.md`의 계약을 따른다. 구버전/외부 writer를 소급 fencing하지 않는다.
- 실제 데이터 migration은 별도 preview/승인, 참여 client 업그레이드·정지 및 admission 계약 검증 후 진행한다. presence, freshness+hook, structured state는 각각 결합된 이전 단위로 취급하고 mixed 사용자 문서는 보존한다.
- 구현된 호환 guard는 path-derived projectKey와 분리한 고정 worktree anchor를 사용한다. non-Git은 canonical anchor를 쓰며 alternate/unknown backend 전환을 거부한다. Git topology와 workspace 소유 판별은 operation 시작에 한 번 수행하고, 각 쓰기는 descriptor·고정 indicator·경로 identity를 새로 검사한다. 독립 CLI/MCP/REPL 호출은 새 admission을 수행한다. 관측 로그 안의 사용자 요청·승인 정보도 보존 대상이며 상세 계약은 위 migration 문서를 따른다.
- 이후 M-0015..M-0018에서 명시적 migration, control fencing, finalize durability, views/CLI/MCP/cleanup 계약을 단계별 검증한다.
- `workspacePath()`는 Project scope용으로 보존한다. 기존 exact-file lease를 공용 task claim으로 간주하거나 저장 위치만 교체하지 않는다.
