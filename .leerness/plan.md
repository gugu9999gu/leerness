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

## Current Priority — 2026-09-03
1. `UR-0095 / T-0165`의 남은 범위 중 **역할·에이전트·라우팅/폴백 정책**을 먼저 설계하고 기존 구현과의 차이를 닫는다.
2. 그 구조를 읽기 전용으로 한 화면에 모으는 **통합 시각화**를 만든다.
3. 실행/배정 UI는 스키마와 검증 규칙이 안정된 뒤 별도 승인 단계로 진행한다.
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
- [x] T-0166 구현 및 43/43 전용 probe 통과
- [x] lock 대기 후 file identity 재관측
- [x] lock 진입 시점부터 TTL 계산
- [x] corrupt store/alias/hard-link/limit/fail-closed 회귀

### M-0010. Role / Agent / Routing schema v2와 무손실 호환 설계
Status: in-progress
Progress: 30%
Done-When: 역할·모델·Agent·Task가 분리된 versioned schema, legacy migration, 권한/예산/독립성 불변식이 CLI/MCP 계약과 negative fixtures로 고정된다.

Tasks:
- [x] 사용자 지정 대화의 역할 구조·토큰 비용·Router 원칙을 현재 구현과 대조
- [x] 기존 구현 확인: 7-role catalog, `agent-roles.json`, provider registry, hard-coded tier routing, explicit dispatch
- [x] `docs/role-agent-routing-v2.md`에 현재 계약·gap·schema 후보·fallback·lease·검증 매트릭스 초안 작성
- [ ] 현재 `commander/coder/dispatcher` 호환을 유지하는 role taxonomy v2 확정
- [ ] Role Registry / Agent Registry / Routing Policy schema와 저장 파일명 확정
- [ ] `.leerness/agent-roles.json` 무손실 migration/projection 설계
- [ ] 복수 Worker/Tester Agent 인스턴스, permissions, concurrency, context/token budget 모델 설계
- [ ] corrupt/unknown field/version mismatch/legacy round-trip negative fixtures 작성

### M-0011. Router pipeline와 역할별 fallback/검증 정책 구현
Status: planned
Progress: 0%
Done-When: simple/normal/high-risk/review-only route가 결정적이고 감사 가능하며, fallback이 관측된 사유·권한·독립성·사람 승인·lease 조건을 보존한다.

Tasks:
- [ ] Light Router와 Orchestrator를 분리하고 제안 단계 외부 실행 0 보장
- [ ] normal/high-risk pipeline에 Tester를 독립 단계로 추가
- [ ] 조건부 Security/Release/Observer gate 배선
- [ ] provider fallback chain과 reviewer independence fail-closed 구현
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

## Immediate Next Action
`M-0010`의 첫 구현 작업으로, 현재 `ROLE_CATALOG`, `.leerness/agent-roles.json`, `EXTERNAL_AGENTS`, `TIER_ROLES`, `agents dispatch`의 실제 입출력 계약을 표로 고정한 뒤 schema v2 초안과 legacy round-trip probe를 작성한다. 이 단계에서는 아직 외부 모델 호출, UI write, 자동 fallback을 추가하지 않는다.
