---
leernessRole: plan
readWhen:
  - 작업 시작 전
  - 새 요청 접수
  - 범위 변경
  - 신규 프로젝트 감지
updateWhen:
  - 계획 추가/수정/드랍
  - milestone 변경
  - 목표 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Plan

## Goal
- AI 코딩 세션이 **증거 없이 "완료"라고 말하지 못하게** 하는 하네스를 만든다. 컨텍스트 적재(handoff), 주장 검증(verify-claim), 마감(session close)을 매 세션의 고정 절차로 만들고, 그 절차가 실제로 결함을 잡는지 적대적 검수와 게이트로 증명한다.
- Leerness는 모델을 대신해 코딩하는 실행기가 아니라, 여러 AI의 **기억·정책·역할·인수인계·검증·감사·충돌 조정**을 담당하는 운영/통제 계층으로 유지한다.
- 배포 형태는 의존성 0, 설치 스크립트 없음, 오프라인 우선, Windows 우선의 npm CLI + MCP 서버다.

## Scope
- 포함: CLI/MCP 표면, 세션 하네스 문서 생성·마이그레이션, 프로젝트 위생 감사, 자기 검증, 역할/에이전트/라우팅 정책, 명시적 세션 협업 원시 기능, 통합 상태 시각화, 릴리스 파이프라인.
- 제외: Leerness가 임의로 유료 모델을 호출하거나 사용자의 외부 편집기를 강제로 잠그는 기능. 다른 프로젝트는 읽기 전용 증거원으로만 쓴다.

## Current Priority — 2026-09-05
1. `UR-0097 / T-0173`의 구조 감사 결과를 적용하고 **State scope와 저장 수명주기**를 `M-0014..M-0018`로 먼저 정식화한다. 상세 계약은 `docs/state-scopes.md`다.
2. `P-0020 / M-0014 / T-0174`의 additive 경로 resolver와 읽기 전용 `state inspect`는 사용자 승인 뒤 v1.36.186으로 출하·검증했다. 기존 파일 이동·삭제·runtime 전환은 없다. 다음 `M-0015`의 명시적 migration은 별도 미리보기 승인 전 코드를 작성하지 않는다.
3. `M-0010` Role v2 migration은 이 scope 계약을 공유한다. 기존 validator와 legacy projection은 유지하고, runtime activation은 `M-0015` 호환 및 `M-0016` control 계약을 충족한 뒤 판정한다. 이후 `M-0011` routing → `M-0012` 읽기 전용 시각화 → `M-0013` 승인형 UI로 진행한다.
4. `T-0092` i18n 잔여와 `T-0159` 실제 페이지/기능 시안 워크플로는 독립 백로그로 유지하며 이번 역할 아키텍처에 섞지 않는다.

참고 근거: 사용자가 지정한 ChatGPT 프로젝트 대화 **“추가 개발 직위 추천”**의 역할 분리, 토큰 비용, Router/Orchestrator, `Role ≠ Model ≠ Agent ≠ Task` 원칙을 2026-09-03에 검토해 아래 계획으로 정규화했다.

## Target Operating Model

### Default request path

```text
USER
  ↓
LIGHT ROUTER (작고 저렴한 분류·제안, 기본은 실행 없음)
  ├─ low-risk/simple → IMPLEMENTER → TESTER/기존 테스트 → REVIEWER(필요 시)
  ├─ normal          → ORCHESTRATOR → IMPLEMENTER(S) → TESTER → REVIEWER
  ├─ high-risk       → ARCHITECT → ORCHESTRATOR → IMPLEMENTER(S) → TESTER → REVIEWER → VERIFY/GATE
  └─ review-only     → REVIEWER
```

- 사용자는 기본적으로 `Auto` 또는 Orchestrator 진입점 하나만 사용한다.
- Router는 전체 프로젝트를 읽는 지휘자가 아니다. 요청의 위험도·복잡도·변경 범위를 결정적 규칙으로 분류하고 추천 경로만 제시한다.
- 고위험 작업은 Architect 선행, 독립 Reviewer, 사람 승인, Leerness verify/gate를 요구한다.
- Security, Release, Observer는 모든 작업에 상시 붙이지 않고 위험/배포 조건에 따라 추가한다.
- Director/Product Owner는 의견 충돌 또는 제품 우선순위 결정이 필요한 대형 흐름의 선택 역할로 남기며 MVP 필수 역할에는 넣지 않는다.

### Entity separation

| Entity | Meaning | Core fields |
|---|---|---|
| Model | 실제 공급자/모델 능력 | provider, model, observed capability, availability |
| Role | 모델과 독립적인 책임·권한 계약 | responsibilities, permissions, context policy, approval rules |
| Agent | Role을 수행하는 실행 인스턴스 | id, role, provider/model, session key, concurrency, fallback chain |
| Task | Agent에 할당되는 검증 가능한 작업 | id, scope/files, inputs, done-when, evidence, state |

필수 불변식:
- 모델 이름을 역할 정의에 하드코딩하지 않는다.
- 같은 모델로 여러 Agent 인스턴스를 만들 수 있다.
- 같은 Agent가 구현·테스트·검수·완료 승인을 모두 독점하지 못하게 한다.
- 고위험 작업에서 Implementer와 Reviewer가 같은 provider면 기본적으로 독립 검수로 인정하지 않는다.

### Role taxonomy

MVP 핵심 역할:
- `router`: 저비용 분류·추천. 코드 작성/승인 금지.
- `orchestrator`: 작업 분해, 의존성, 배정, 재시도, 결과 종합. 직접 코드 작성은 기본 금지.
- `architect`: 아키텍처, 데이터 모델, API/모듈 경계, 실패 처리 계약. 직접 구현 금지.
- `implementer`: 제한된 파일 범위의 코드/테스트 작성.
- `tester`: 실행·재현·회귀·엣지케이스 검증. 구현 승인 권한 없음.
- `reviewer`: 요구사항·설계·diff·테스트 증거 검수, 승인/거절.

조건부 역할:
- `security`: 인증·인가·시크릿·취약점·RLS/권한 검수.
- `release`: migration, CI/CD, 배포, 롤백.
- `observer`: 로그·성능·운영 이상 관측.
- `director`: Architect/Reviewer/Orchestrator 판단 충돌의 최종 결정.

기존 호환 ID:
- `commander`는 Orchestrator 의미의 호환 alias로 유지한다.
- `coder`는 Implementer/Worker 의미의 호환 alias로 유지한다.
- `dispatcher`는 Agent 배정 실행자이며, 요청 분류 전용 Router와 구분한다.

## Three Logical Configuration Layers

사용자 대화에서 제안된 `roles + agents + routing` 3계층을 채택한다. 단, Leerness의 **0 runtime dependencies** 원칙 때문에 최초 저장 형식은 JSON으로 구현하고 YAML은 추후 import/export 후보로 둔다.

### 1. Role Registry
- 역할별 책임, 금지 행위, 권한 tier, 입력 컨텍스트, 필수 출력, 승인 가능 상태를 정의한다.
- built-in role과 project override를 분리한다.
- role definition에는 특정 vendor/model을 넣지 않는다.

### 2. Agent Registry
- `role + provider + model + permissions + session + concurrency + token/context budget`를 한 Agent 인스턴스로 묶는다.
- 동일 role에 복수 Agent를 허용한다. 예: frontend-worker-01, backend-worker-01, test-worker-01.
- 기존 `.leerness/agent-roles.json`은 schema v2 마이그레이션 전까지 호환 projection으로 보존한다.

### 3. Routing Policy
- 입력 요청을 `simple / normal / high-risk / review-only` 파이프라인으로 매핑한다.
- 역할별 fallback chain, 사람 승인, reviewer independence, exact-file lease 요구, 동시성 상한을 정의한다.
- 제안 단계는 외부 CLI/모델을 호출하지 않는다. 실제 dispatch는 명시적 확인과 정책 통과 후에만 가능하다.

정확한 파일명과 schemaVersion은 `M-0010`에서 현재 `agent-roles.json`, provider registry, `lib/routing.js`와의 무손실 호환성을 검증한 뒤 고정한다.

## Context and Token Budget Policy
- Router는 요청 텍스트와 최소 메타데이터만 읽는다.
- Orchestrator는 원문 전체 코드 대신 `status + changed files + summary + tests + issues + commit/diff reference`를 기본 입력으로 받는다.
- Architect는 전체 구조가 필요한 경우에만 호출하고 구현 코드는 생성하지 않는다.
- Implementer는 할당 파일, 관련 계약, 금지 파일만 받는다.
- Tester는 대상 기능·테스트·실행 로그를 중심으로 읽는다.
- Reviewer는 spec/architecture/diff/test evidence를 읽고 전체 저장소는 필요 시에만 추가 조회한다.
- 역할별 입력·출력·총 예산과 재시도 상한을 정책으로 기록하되, 공급자가 공식 수치를 제공하지 않으면 잔여 quota를 추정하지 않는다.

표준 Worker 보고 형식:

```json
{
  "task": "T-XXXX",
  "status": "completed|blocked|failed",
  "changedFiles": [],
  "summary": "",
  "tests": { "passed": 0, "failed": 0 },
  "issues": [],
  "evidence": [],
  "commit": null
}
```

## Fallback Policy
- fallback은 `not-installed`, `disabled`, 확인된 `not-authenticated`, 실행 오류, 공식 adapter가 확인한 capacity 부족처럼 **관측된 사유**에만 반응한다.
- `unknown`을 임의로 불가/가능으로 추정하지 않는다.
- fallback으로 역할 권한이나 독립성 조건을 조용히 약화하지 않는다.
- 고위험 Reviewer fallback이 Implementer와 같은 provider로 수렴하면 자동 승인하지 않고 `non-independent`로 거부하거나 사람 override를 요구한다.
- 자동 fallback은 사전에 허용된 chain 안에서만 동작하며, 유료 호출 또는 write 권한 상승은 다시 확인한다.
- 모든 route/fallback 결정은 사유 코드와 함께 감사 로그에 남긴다.

## Session Coordination Integration
- 소스 변경 Agent는 작업 시작 전에 자신의 exact file 목록에 짧은 TTL lease를 명시적으로 취득한다.
- 읽기 전용 Router/Architect/Reviewer는 파일을 변경하지 않는 한 lease가 필요 없다.
- lease 충돌은 해당 Agent dispatch를 동기식으로 거부하고 Orchestrator에 구조화된 충돌 증거를 반환한다.
- directory-wide/ambient scope 추론과 자동 경고는 도입하지 않는다. 폐기된 `T-0109` 고잡음 범위 경고를 되살리지 않는다.
- lease는 advisory coordination primitive이며 외부 편집기를 강제로 잠그지 않는다는 한계를 UI/CLI/MCP에 유지한다.
- 현재 lease는 checkout별 물리 파일 identity를 다룬다. repository 전체의 task claim과 분리하며, `.git` common으로 store 경로만 바꾸지 않는다.

## State Scope and Lifecycle Architecture — UR-0097
- 채택: Git tracked 영속 지식/정책/완료 기록, Git private runtime, Git common control의 3계층과 Project/Worktree/Common-Control/Immutable-Record/Generated-View의 5개 scope.
- 기존 사실: progress-tracker는 현재 task 원본이고 decisions/lessons는 이미 JSON 원본 + Markdown 표시본이다. 목표인 event/record 기반 원본과 혼동하지 않는다.
- Worktree private 내부도 session별로 구분하고 main의 gitDir=gitCommonDir 경우 runtime/control namespace를 분리한다. monorepo projectKey, non-Git, 별도 clone/host, Windows alias를 명시한다.
- single consolidator는 역할 이름뿐 아니라 owner generation/revision 검증으로 강제한다. 기존 local mutex를 TTL로 강제 탈취하거나 heartbeat를 프로세스 생존 증명으로 보지 않는다.
- 결정/교훈은 충돌 회피 ID의 immutable record와 supersedes, 실행/검수는 exact commit/diff digest와 actual model/fallback provenance를 보존한다.
- finalize는 기록 생성뿐 아니라 retained Git revision에서의 durability를 확인해야 cleanup-eligible이다. 외부 직접 worktree 삭제를 완전히 차단한다고 주장하지 않는다.
- 기존 사용자 원문/legacy ID/증거는 보존한다. migration은 inventory/preview/confirm/quiescence/staging/atomic activation/복구를 갖추고 두 writable source of truth를 만들지 않는다.
- YAML/SQLite 의존성을 즉시 추가하지 않는다. Node >=18·0 runtime deps를 유지하고 파일 기반 backend의 범위/한계를 테스트한다.
- 운영 상태가 Git에 남는다는 현재 프로젝트 설명도 단계적 전환 대상으로 기록한다. 모든 `.leerness`를 ignore하거나 기존 문서를 일괄 삭제하지 않는다.

## Consolidated Visualization Contract
첫 단계는 읽기 전용 단일 화면이다. 다음 정보를 동일 snapshot 시점과 provenance로 묶는다.
- Provider: 설치, 활성화, 인증 관측, 로컬 라우팅 가능성, 모델 호출 관측, quota 관측.
- Roles: 역할 정의, 권한, 입력/출력 계약.
- Agents: role→provider/model 배치, Agent 인스턴스, fallback chain, 동시성/예산.
- Routing: 현재 요청의 분류 근거, 추천 pipeline, 승인/차단 사유.
- Sessions: 세션 presence, 열린 run, evidence 귀속.
- Coordination: exact-file lease, 충돌, TTL.
- Delivery: task/plan, verify-claim, reviewer verdict, gate 상태.

UI 원칙:
- 기본 화면은 `Auto` 입력과 현재 팀 구성을 보여주되 사용자가 매번 역할을 선택할 필요는 없다.
- 고급 설정에서 role별 provider/model/인스턴스 수/fallback/budget을 변경한다.
- 저장 전 schema validation과 변경 preview를 거친다.
- 초기 버전은 read-only snapshot만 제공하고, 배정 변경·dispatch·배포 버튼은 별도 승인 milestone에서 연다.

## Safety and Compatibility Gates
- 0 runtime deps, Node 18+, Windows 경로/인코딩 계약 유지.
- JSON 손상·unknown field·schema mismatch는 fail-closed; 원본 byte 보존.
- 기존 `roles set/list/suggest/verify`, `agents route/dispatch`, provider registry와 backward compatibility 유지.
- CLI와 MCP의 role/agent/routing schema와 permission tier가 일치해야 한다.
- read-only 조회는 workspace migration, telemetry, lease store 생성 등 어떤 쓰기도 하지 않는다.
- mutation은 공용 lock + exact-file lease preflight를 통과한 뒤 실행한다.
- 외부 CLI를 실행하지 않은 경로는 실행했다고 표시하지 않는다.
- 전체 코드/대화 원문을 Orchestrator에 중복 전달하지 않는지 token/context regression probe로 측정한다.

## Out of Scope / Dropped
| ID | Item | Reason | Date |
|---|---|---|---|
| T-0109 | ambient session range/scope advisory | 최소 설계도 실측 경고율 63.1%로 사전 중단 기준 40% 초과 | 2026-08-29 |
| ROLE-YAML-MVP | YAML을 최초 canonical store로 사용 | 0-dependency 원칙과 안전한 parser 필요성 때문에 JSON schema부터 고정 | 2026-09-03 |
| AUTO-PAID-DISPATCH | 사용자 확인 없는 모델 호출/비용 발생 | Leerness 운영 계층·명시적 승인 원칙과 충돌 | 2026-09-03 |

## Milestones

### M-0001. 프로젝트 계획 정리
Status: completed
Progress: 100%
Done-When: project-brief와 context-map이 실제 프로젝트 목적·구조를 반영한다.

Tasks:
- [x] project-brief.md를 실제 프로젝트 목적에 맞게 작성
- [x] context-map.md를 실제 파일 구조에 맞게 작성

### M-0002. v1.36.18 masking / compact handoff / 10k ID 적대 검수
Status: completed
Progress: 100%
Done-When: 실제 false-fail/경로 문제를 재현 또는 반박하고 채택 결함을 회귀로 고정한다.

Tasks:
- [x] P2-6 masking, P3-8 compact handoff, P1-2 ID widening 검수

### M-0003. `_maskCommentsStrings` 집중 재검수
Status: completed
Progress: 100%
Done-When: nested template, regex ambiguity, contract false-fail을 재현 또는 반박한다.

Tasks:
- [x] 집중 적대 재검수

### M-0004. `_REGEX_KW` concrete false-missing probe
Status: completed
Progress: 100%
Done-When: 현실적인 false-missing 경로를 직접 실행으로 판정한다.

Tasks:
- [x] focused probe

### M-0005. contract-verify masking convergence
Status: completed
Progress: 100%
Done-When: 현실적인 false-fail 클래스와 caller integration을 최종 판정한다.

Tasks:
- [x] convergence review

### M-0007. Final line-leading-only `_maskComments` adversarial review
Status: completed
Progress: 100%
Done-When: valid-JavaScript false-blank, missed-comment, caller-integration, termination probes를 판정한다.

Tasks:
- [x] Final adversarial review

### M-0008. `release bump --patch`와 버전 표면 동기화
Status: completed
Progress: 100%
Done-When: --patch를 경고 없이 수용하고 package/bin/README 버전을 동기화하며 일반 패키지 계약을 유지한다.

Tasks:
- [x] T-0122 회귀 보강

### M-0009. Explicit exact-file session lease MVP
Status: completed
Progress: 100%
Done-When: exact-file acquire/check/list/release가 CLI+MCP에서 동작하고 충돌·경로·스토어·TTL·동시성 안전 계약을 전용 probe로 증명한다.

Tasks:
- [x] T-0166 구현 및 57/57 전용 probe 통과
- [x] lock 대기 후 file identity 재관측
- [x] lock 진입 시점부터 TTL 계산
- [x] corrupt store/alias/hard-link/limit/fail-closed 회귀

### M-0010. Role / Agent / Routing schema v2와 무손실 호환 설계
Status: in-progress
Progress: 85%
Done-When: 역할·모델·Agent·Task가 분리된 versioned schema, legacy migration, 권한/예산/독립성 불변식이 CLI/MCP 계약과 negative fixtures로 고정된다.

Tasks:
- [x] 사용자 지정 대화의 역할 구조·토큰 비용·Router 원칙을 현재 구현과 대조
- [x] 기존 구현 확인: 7-role catalog, `agent-roles.json`, provider registry, hard-coded tier routing, explicit dispatch
- [x] `docs/role-agent-routing-v2.md`에 현재 계약·gap·schema·fallback·lease·검증 매트릭스 작성
- [x] 호환 ID taxonomy 확정: commander/coder/dispatcher 유지, orchestrator/implementer는 입력 alias, 신규 역할 additive
- [x] canonical 저장 파일명 확정: role-definitions.json / agent-instances.json / routing-policy.json, legacy agent-roles.json 유지
- [x] Role은 provider/model과 분리하고, fallback은 동일 Role의 Agent ID만 참조하도록 계약 고정
- [x] `lib/role-agent-schema.js` 순수 validator + legacy 양방향 projection 구현
- [x] custom legacy role, unknown field, corrupt/future schema, alias collision, null budget, 복수 Worker, fallback/상속 cycle, high-risk 약화 회귀 고정
- [x] `scripts/role-agent-schema-probe.js` 88/88 및 기존 `roles list --json` legacy byte-preserving 대조군
- [x] 기존 `_loadRoles`를 bounded fail-closed loader와 `roles validate` 진단으로 교체하고 valid roles/dispatch·unknown-field·legacy schema v1 동작 무회귀 보장
- [ ] preview/confirm/lock/rollback을 갖춘 explicit v2 migration command 구현
- [ ] compatibility window의 legacy+v2 동시 갱신 규칙과 read-only CLI/MCP validate/projection 표면 고정
- [ ] installed/full/multi-runtime/독립 검수 후 runtime activation 여부 판정

### M-0011. Router pipeline와 역할별 fallback/검증 정책 구현
Status: in-progress
Progress: 20%
Done-When: simple/normal/high-risk/review-only route가 결정적이고 감사 가능하며, fallback이 관측된 사유·권한·독립성·사람 승인·lease 조건을 보존한다.

Tasks:
- [ ] Light Router와 Orchestrator를 분리하고 제안 단계 외부 실행 0 보장
- [ ] normal/high-risk pipeline에 Tester를 독립 단계로 추가
- [ ] 조건부 Security/Release/Observer gate 배선
- [x] legacy role candidate fallback chain, observed availability, revision-bound 선택 commit, 고위험 reviewer independence fail-closed 구현
- [ ] mutating Agent dispatch에 exact-file lease preflight 연결
- [ ] Worker 요약/evidence envelope와 Orchestrator context budget 회귀 측정

### M-0012. Provider·Role·Agent·Session·Lease·Gate 통합 시각화
Status: planned
Progress: 0%
Done-When: 한 read-only snapshot에서 각 상태와 provenance를 일관되게 표시하고 조회가 byte-for-byte 무쓰기임을 검증한다.

Tasks:
- [ ] 통합 snapshot JSON 계약
- [ ] CLI/MCP read-only surface
- [ ] 기존 `leerness.html` 또는 별도 dashboard 탭에 읽기 전용 렌더
- [ ] provider/role/agent/routing/session/lease/task/gate 상태 연결
- [ ] 시크릿·계정식별자·대화 원문 비노출 검증

### M-0013. Role configuration UI와 실행 adapter 승인 단계
Status: planned
Progress: 0%
Done-When: 사용자가 role별 model/인스턴스/fallback/budget을 preview 후 저장할 수 있고, 실제 dispatch는 별도 명시 승인·정책·검증을 통과한다.

Tasks:
- [ ] `Auto / Orchestrator / Architect / Implementer / Reviewer / Tester` target UI
- [ ] schema validation + diff preview + rollback
- [ ] 실행 adapter 경계와 permission elevation 재확인
- [ ] 비용·실행·검수 독립성 표시
- [ ] 실제 페이지/기능 시안 승인 워크플로(`T-0159`)와 통합 여부 별도 결정

### M-0014. State scopes와 읽기 전용 저장 구조 진단
Status: completed
Progress: 100%
Done-When: P-0020 승인 뒤 5-scope resolver와 state inspect가 main/linked/non-Git/monorepo에서 무쓰기 및 기존 동작 보존 검증 통과

Tasks:
- [x] T-0174 / P-0020 승인 뒤 additive state-paths resolver 구현 (기존 Project resolver 보존)
- [x] 현재/목표 경로를 분리한 state inspect JSON과 오류 taxonomy
- [x] main/linked/non-Git/monorepo/Windows 경로·무쓰기 전용 회귀 104개 (selector26 + scope58 + CLI20); Node18 scope58/CLI20 재검증
- [x] 독립 Codex P2 3건 재현·수정 및 재검수 CLEAN; 전체 E2E467/467, 고정 SHA CI33959679140 13/13; GitHub/npm/site v1.36.186와 공개 설치본 selftest355/355 검증

### M-0015. Worktree runtime 분리와 명시적 호환 마이그레이션
Status: in-progress
Progress: 10%
Done-When: 동일 worktree 다중 session 격리, 원본 보존, preview/confirm과 중단 복구, 지원 client의 fail-closed 및 구버전 참여 client 정지 확인 또는 전환 보류가 증명됨

Tasks:
- [x] T-0179 초기 reader/writer·field 분류: docs/worktree-runtime-migration.md의 알려진 22개 표면과 전수 감사 한계, session ownership 및 coupled migration unit 명시 (설계만)
- [x] P-0021 / T-0180 승인 후 M-0015-A strict layout reader·read-only compatibility 진단·관측 기반 write guard 구현; legacy 저장 유지, activation 없음 (전체 검증·출하는 다음 항목에서 추적)
- [ ] 모든 지원 writer/startup/MCP/REPL/FD/cache/hook 경로의 guard coverage와 구버전 negative control 검증 및 호환 릴리스
- [ ] 별도 B preview/승인: 참여 client 정지·업그레이드, admission 계약, 원본 snapshot, staged copy 및 단일 authority activation
- [ ] presence 단위부터 별도 검증; freshness+enforce hook과 state.json+runs+handoff는 각각 결합 단위로 전환
- [ ] interruption/rollback/post-activation reconciliation, unknown ownership, metadata 보존과 old client compatibility 회귀

구현 최적화: 한 operation 안에서 Git topology와 workspace ownership snapshot을 공유한다. compatibility 결과는 캐시하지 않고 descriptor·고정 indicator·경로 identity를 다시 읽는다. 정상 동시 writer의 정확한 lock/release/temp/create 이름만 admission에서 허용하며 unknown/link/wrong-kind는 거부한다. 중앙 CLI root 분배와 `lib/git.js`의 read/write 분류는 실제 handler/인자 우선순위 회귀를 유지한다. 일반 StateManager 추상화·DB·자동 migration은 이 단계에 추가하지 않는다.

기존 standalone producer 보존: `init` 없이 성공한 정식 명령의 산출물이 다음 operation을 막지 않아야 한다. 정확한 저장 파일/디렉터리 이름·종류와 producer 근거를 함께 관리하고, 첫 생성→후속 실행·기존 내용 보존·wrong-kind/link/foreign sibling 거부를 빠른 runtime probe에서 검증한다. 내용을 읽어 소유권을 추측하거나 모든 폴더를 허용하지 않는다. 새 producer 추가 때 admission 분류와 회귀를 같이 갱신하여 장시간 full E2E에서만 발견되는 피드백 지연을 줄인다.

### M-0016. Common ControlStore와 task claim 및 consolidator fencing
Status: planned
Progress: 0%
Done-When: worktree 공통 task claim, revision CAS, stale owner 차단과 crash recovery를 실제 다중 프로세스 테스트로 검증

Tasks:
- [ ] T-0176 task claim과 physical file lease 분리, project/worktree/session identity
- [ ] bounded transaction, revision CAS, owner generation/fencing 및 policy revision 검증
- [ ] 실제 다중 프로세스 경쟁·중단·clock movement·stale writer 회귀

### M-0017. Immutable MemoryStore와 RunRecord finalize
Status: planned
Progress: 0%
Done-When: 결정 supersedes, 독립 review commit binding, 멱등 finalize, ID 충돌 차단 및 Git durability receipt 검증 통과

Tasks:
- [ ] T-0177 strict legacy import, 고유 record ID, supersedes와 payload 충돌 차단
- [ ] actual model/fallback 및 reviewed commit/diff에 바인딩한 독립 result/review record
- [ ] 멱등 finalize와 retained Git durability receipt, 실패/거절 결과와 완료 주장 분리

### M-0018. Generated view 전환과 공통 State API adapter 통합
Status: planned
Progress: 0%
Done-When: 사용자 원문을 보존한 재생성, single consolidator, CLI MCP 동일 계약, cleanup 전 finalize gate와 버전 호환 검증 통과

Tasks:
- [ ] T-0178 사용자 원문 보존·accepted input digest 기반 결정적 재생성·single consolidator
- [ ] CLI/MCP, integrity/claims, role migration, read-only snapshot 소비자 연결
- [ ] Leerness adapter cleanup 전 finalize 검증, 외부 직접 삭제 강제 차단 한계 명시

## Immediate Next Action
`P-0020` / `T-0174` / `M-0014`는 v1.36.186으로 검수·출하 검증까지 완료했다. `P-0021 / T-0180`은 사용자 승인 후 UR-0100으로 구현 중이다. 기존 데이터 무이동·legacy 저장 유지 조건으로 M-0015-A만 적용한다. 진행 순서: strict reader → 실제 CLI/startup/module/FD/MCP/REPL guard → 기존 init/migration/role/lease 회귀 → 독립 Codex 검수 → supported CI/공개 배포 검증. T-0181은 원 CI 실패와 별도로 확인된 selftest 진단 폐기·exitCode 누출을 수정하고, 원인 미확정 상태를 보존한다. 실제 migration B는 client 정지·admission·원본 보존·복구 계약을 별도 승인받는다. `M-0010` 역할 migration도 이 계약을 공유한다. M-0015 전체와 M-0016..M-0018은 미완료다.
