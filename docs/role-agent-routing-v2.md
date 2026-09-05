# Role / Agent / Routing v2 — compatibility design draft

Status: schema foundation implemented and tested; no runtime migration, public v2 CLI, automatic dispatch, or v2 store write is enabled yet.

Reviewed inputs:
- Current implementation in `lib/role-catalog.js`, `lib/agent-registry.js`, `lib/routing.js`, `lib/agents.js` and `.leerness/agent-roles.json` handling.
- Provider observation and exact-file lease work from `T-0165` and `T-0166`.
- User-supplied ChatGPT project conversation “추가 개발 직위 추천”, reviewed 2026-09-03.

## 1. Design model

Leerness should represent four different concepts explicitly:

```text
Model  = provider/model capability and observed availability
Role   = responsibilities, permissions, required inputs and outputs
Agent  = one role-bearing execution instance with a model and session identity
Task   = bounded work assigned to an Agent with scope and evidence
```

The user-facing workflow should default to `Auto`, but `Auto` means a small Router proposes a pipeline. It does not mean Leerness silently invokes paid models or grants write permissions.

## 2. Existing implementation inventory

| Area | Current state | Useful foundation | Missing for v2 |
|---|---|---|---|
| Role catalog | Seven built-ins: commander, reviewer, coder, architect, designer, debugger, dispatcher | Model-independent role IDs and aliases already exist | No tester/security/release/observer/router; responsibility and permission contracts are mostly descriptive strings |
| Role assignment | `.leerness/agent-roles.json` maps one role to one provider/model | Existing CLI and persisted user mappings must be preserved | Cannot represent multiple workers, agent identity, concurrency, budget or fallback |
| Provider registry | Ten built-ins plus project overrides | Installation/enablement/auth observation and provider metadata | Provider is still treated as the dispatch target rather than one component of an Agent instance |
| Routing | `tiny`, `normal`, `high-risk` classification and hard-coded role sets | Deterministic rules, explicit confirmation, human approval and reviewer independence already exist | No project routing policy document, review-only route, tester stage, fallback chain, budget or lease preflight |
| Dispatch | `agents dispatch --role` resolves role to provider/model | Explicit execution path and role-based targeting | No Agent-instance selector, no task envelope, no multi-worker allocation |
| Session state | session presence and session-scoped evidence | Stable session identity and evidence attribution | Agent registry is not linked to sessions as a first-class contract |
| Coordination | exact-file TTL lease CLI/MCP | Synchronous conflict evidence and fail-closed path handling | Not yet a dispatch precondition for mutating Agents |
| Verification | tester-like command execution, reviewer personas, verify-claim and gate | Strong completion and evidence primitives | Tester and Reviewer are not explicit lifecycle roles with separate state transitions |

## 3. Compatibility strategy

### 3.1 Preserve current identifiers

The first v2 implementation must not invalidate existing projects.

| Existing ID | v2 semantic label | Compatibility rule |
|---|---|---|
| `commander` | orchestrator | Keep as accepted persisted ID and CLI alias |
| `coder` | implementer / worker | Keep as accepted persisted ID and CLI alias |
| `dispatcher` | assignment dispatcher | Do not silently reinterpret as the request-classification Router |
| `reviewer` | reviewer | Preserve |
| `architect` | architect | Preserve |
| `designer` | designer | Preserve as optional specialist |
| `debugger` | debugger | Preserve as optional specialist |

New IDs should initially be additive: `router`, `tester`, `security`, `release`, `observer`, and optionally `director`.

### 3.2 Preserve `.leerness/agent-roles.json`

The current file is a one-role-to-one-model assignment store. It should remain readable and writable during migration.

Candidate migration behavior:
1. Load v2 stores if present and valid.
2. If v2 is absent, load `agent-roles.json` and project each mapping into one deterministic Agent instance.
3. Do not rewrite the legacy store on read.
4. An explicit migration command writes v2 stores atomically and records source provenance.
5. During a compatibility window, `roles set/unset` updates both the v2 assignment projection and legacy file under one lock.
6. Unknown fields, schema mismatch, an existing empty file, or corruption fail closed and preserve original bytes.
7. Only the original seven v1 persisted IDs map directly to built-in roles. A legacy custom key such as `implementer`, `worker`, `tester`, or `orchestrator` remains a deterministic custom role; new v2 aliases never silently reinterpret old user data.
8. A disabled v2 Agent cannot be projected as a primary legacy assignment because v1 has no disabled-state field; projection fails closed instead of silently re-enabling it.

## 4. Three logical configuration layers

The linked conversation proposed `roles.yaml`, `agents.yaml`, and `routing.yaml`. The separation is accepted, but canonical storage should initially remain JSON because Leerness guarantees zero runtime dependencies and already has strict JSON corruption handling.

The schema foundation freezes the following canonical filenames. No command writes them yet.

### 4.1 Role Registry — `.leerness/role-definitions.json`

```json
{
  "schemaVersion": 2,
  "kind": "role-definitions",
  "roles": {
    "coder": {
      "label": { "ko": "작업자", "en": "Implementer" },
      "responsibilities": ["implement bounded changes", "write relevant tests"],
      "requiredTier": "project-write",
      "codeWrite": true,
      "approve": false,
      "release": false,
      "forbidden": ["approve-own-work", "merge", "release"],
      "requiredInputs": ["task", "allowedFiles", "doneWhen"],
      "requiredOutputs": ["changedFiles", "summary", "tests", "issues", "evidence"],
      "contextPolicy": "assigned-files-and-contract",
      "defaultBudget": { "inputTokens": null, "outputTokens": null, "retries": 1 }
    }
  },
  "source": { "kind": "project-config", "file": "role-definitions.json" }
}
```

Rules:
- No provider or model IDs in Role definitions.
- `requiredTier` and explicit write/approve/release booleans use existing Leerness policy semantics instead of a parallel permission vocabulary.
- `responsibilities`, `forbidden`, required inputs/outputs, and budgets are machine-validated contracts, not documentation-only prose.
- Project overrides may narrow permissions but may not silently widen a built-in role without explicit confirmation.

### 4.2 Agent Registry — `.leerness/agent-instances.json`

```json
{
  "schemaVersion": 2,
  "kind": "agent-instances",
  "agents": [
    {
      "id": "backend-worker-01",
      "role": "coder",
      "provider": "qwen",
      "model": "project-selected-model",
      "enabled": true,
      "maxConcurrency": 1,
      "sessionKeyPolicy": "required-for-write",
      "budget": { "inputTokens": null, "outputTokens": null, "retries": 1 },
      "fallback": ["backend-worker-02"],
      "tags": ["backend", "typescript"]
    }
  ],
  "source": { "kind": "project-config", "file": "agent-instances.json" }
}
```

Rules:
- Multiple Agents may use the same Role and Model.
- Agent IDs are stable project identifiers, not process IDs.
- A mutating Agent needs a stable session key and exact-file scope before dispatch.
- `budget` values may be unknown; unknown must not be represented as zero or unlimited.
- Fallback references Agent IDs, not raw model names, so permissions and role remain stable.

### 4.3 Routing Policy — `.leerness/routing-policy.json`

```json
{
  "schemaVersion": 2,
  "kind": "routing-policy",
  "defaultMode": "suggest",
  "pipelines": {
    "tiny": ["coder", "tester"],
    "normal": ["commander", "coder", "tester", "reviewer"],
    "high-risk": ["architect", "commander", "coder", "tester", "reviewer"],
    "review-only": ["reviewer"]
  },
  "requirements": {
    "tiny": {
      "humanApproval": false,
      "independentReviewer": false,
      "verifyClaim": true,
      "gate": false,
      "leaseForWrites": true
    },
    "normal": {
      "humanApproval": false,
      "independentReviewer": true,
      "verifyClaim": true,
      "gate": true,
      "leaseForWrites": true
    },
    "high-risk": {
      "humanApproval": true,
      "independentReviewer": true,
      "verifyClaim": true,
      "gate": true,
      "leaseForWrites": true
    },
    "review-only": {
      "humanApproval": false,
      "independentReviewer": false,
      "verifyClaim": false,
      "gate": false,
      "leaseForWrites": false
    }
  },
  "source": { "kind": "project-config", "file": "routing-policy.json" }
}
```

Rules:
- Every pipeline has an explicit requirement block; missing safety requirements are invalid rather than defaulted.
- Named pipelines are non-empty and retain their minimum stages in safety order; an `independentReviewer` requirement without a Reviewer stage is invalid.
- Classification remains deterministic and explainable.
- `suggest` performs no provider command and no model call.
- `confirm` may validate configured providers but still does not imply the work executed.
- Actual execution is a separate dispatch action with explicit permission and cost boundary.
- Schema validity and execution readiness are separate facts. A structurally valid bundle may expose `assignmentGaps` when a pipeline role has no enabled Agent. `assignmentReady` means only that configured enabled Agent assignments cover the pipelines; provider authentication, model entitlement, capacity, and live callability are not checked and must not be presented as executable-ready.

## 5. Role lifecycle

### 5.1 Minimal normal pipeline

```text
requested
  → routed
  → decomposed by orchestrator
  → assigned to implementer
  → implementation-reported
  → tested by tester
  → reviewed by reviewer
  → evidence-verified
  → done
```

A task may move backwards on `test-failed`, `review-rejected`, `lease-conflict`, `provider-unavailable`, or `evidence-incomplete`.

### 5.2 Self-approval prohibition

The following must not be treated as independent verification:
- Same Agent instance implements and approves.
- Same run/session writes code and records the Reviewer verdict.
- High-risk Implementer and Reviewer resolve to the same provider. Provider separation and recognizable different concrete model families are both required; an override does not manufacture independence.
- Tester only repeats the Implementer’s asserted pass count without executing or reading evidence.

### 5.3 Conditional roles

- Security is inserted for auth, payment, PII, secrets, permissions, public API and deployment-risk signals.
- Release is inserted only when merge, migration, deployment or rollback is in scope.
- Observer is post-release/read-only and should not receive project-write permission.
- Director is invoked only when policy or reviewer/architect conclusions conflict; it is not in every pipeline.

## 6. Fallback policy

Fallback may react only to observed conditions:
- CLI not installed.
- Provider disabled by project policy.
- Authentication explicitly observed as unavailable.
- Non-interactive dispatch failed with a structured reason.
- A verified official adapter reports capacity unavailable.
- Agent is at its configured concurrency limit.

Fallback must not react to guesses about model intelligence, entitlement, account tier or remaining quota.

Fail-closed conditions:
- Candidate fallback has a different Role.
- Candidate requires a higher permission tier.
- High-risk Reviewer fallback loses provider independence.
- Agent config or routing store is corrupt.
- Required file scope is missing for a write task.
- Exact-file lease preflight conflicts.

Every fallback result should include:

```json
{
  "fromAgent": "backend-worker-01",
  "toAgent": "backend-worker-02",
  "reasonCode": "provider_disabled",
  "observed": true,
  "permissionsPreserved": true,
  "rolePreserved": true,
  "reviewerIndependencePreserved": null,
  "executed": false
}
```

## 7. Context and token control

The Orchestrator is potentially the most expensive role because it can repeatedly ingest every worker’s context. The default report path must therefore use a bounded envelope instead of full source files.

```json
{
  "task": "T-XXXX",
  "agent": "backend-worker-01",
  "status": "completed",
  "changedFiles": ["src/example.ts"],
  "summary": "bounded implementation summary",
  "tests": { "passed": 12, "failed": 0, "command": "npm test -- example" },
  "issues": [],
  "evidence": ["commit-or-diff-reference"],
  "contextTruncated": false
}
```

Role-specific context policy:
- Router: request text plus minimal project metadata.
- Architect: project boundaries, contracts and dependency graph; no implementation output by default.
- Orchestrator: task graph and bounded reports; source only on demand.
- Implementer: allowed files, relevant contract and done-when.
- Tester: target behavior, test entry points, logs and changed files.
- Reviewer: request, architecture, diff and executed-test evidence.
- Release: release checklist, migrations, gate status and rollback contract.

Tests should measure that adding more Worker output does not linearly inject full source into the Orchestrator prompt.

## 8. Exact-file lease integration

Before a mutating Agent is dispatched:
1. The task must name exact allowed files.
2. The Agent must have a stable session key.
3. Leerness checks and acquires short TTL leases for those files.
4. Any peer conflict rejects dispatch synchronously with owner/session/expiry evidence.
5. The Agent report lists the actually changed files.
6. Files changed outside the lease set become scope-creep evidence.
7. Leases are released after accepted report or expire automatically.

This remains advisory. Leerness does not claim it can prevent a user, IDE or unintegrated process from editing the file.

## 9. Proposed surfaces

These names are candidates, not yet public commitments.

CLI:
- `leerness role-definitions list|show|validate`
- `leerness agents instances list|show|validate`
- `leerness routing policy show|validate|plan`
- Existing `roles` commands remain compatibility assignment commands.
- Existing `agents route` remains suggestion/confirmation until v2 execution is separately approved.

MCP:
- Separate read-only schema/snapshot tools from safe-write assignment tools.
- `additionalProperties: false` on new input schemas.
- Permission tiers must match CLI mutation classification.

UI:
- First release is read-only.
- Show Provider, Role, Agent, Routing, Session, Lease, Task, Review and Gate on one snapshot.
- Later configuration writes require schema validation, diff preview and rollback.

## 10. Acceptance test matrix

### Schema and migration
- Valid v1 `agent-roles.json` produces deterministic v2 Agent projections.
- Migration is byte-preserving on refusal/failure.
- Repeated migration is idempotent.
- Corrupt v1/v2 stores fail closed and remain byte-exact.
- Unknown fields and unsupported versions are distinct machine errors.
- Original v1 canonical IDs round-trip; later alias-like legacy custom keys remain custom and round-trip without semantic rewriting.

### Agent and routing
- Multiple implementers on one model retain distinct IDs and sessions.
- Tiny (UI label: simple), normal, high-risk and review-only routes are deterministic.
- Suggestion executes zero provider processes.
- High-risk route rejects missing Architect/Tester/Reviewer assignments.
- High-risk route rejects non-independent Reviewer.
- Fallback preserves role and permissions.
- Unknown availability does not trigger speculative fallback.

### Coordination and evidence
- Mutating dispatch without exact files is rejected.
- Lease conflict blocks only the conflicting Agent, not read-only review.
- Changed files outside the lease set are surfaced.
- Tester execution and Reviewer verdict are stored separately.
- Done remains impossible without required evidence and gate policy.

### Read-only and privacy
- Schema/list/snapshot calls create no workspace/cache/telemetry files.
- Provider credentials, account identity, raw chat text and hidden model state are absent.
- English/Korean human output and canonical JSON remain consistent.

## 11. Non-goals for the first implementation

- YAML as canonical persistence.
- Silent automatic paid-model calls.
- Autonomous merge/deploy.
- Directory-wide inferred ownership or ambient collision warnings.
- Claiming exact quota without a verified official adapter.
- Replacing external agent CLIs with a new Leerness execution engine.

## 12. Decisions frozen for the schema foundation

1. Persisted compatibility IDs remain canonical: `commander`, `coder`, `dispatcher`, `reviewer`, `architect`, `designer`, and `debugger`. `orchestrator` and `implementer` are input/display aliases, not silent persisted rewrites. New role IDs are additive.
2. The v2 store filenames are `role-definitions.json`, `agent-instances.json`, and `routing-policy.json`. `agent-roles.json` remains the legacy compatibility assignment store.
3. Role definitions support built-ins plus strict, narrow project definitions/overrides. Provider and model IDs are forbidden from Role definitions.
4. Fallback chains reference Agent IDs only. Provider/model templates are rejected because they would bypass Role and permission contracts.
5. The first integrated visualization will extend the existing read-only dashboard snapshot rather than create another state authority.
6. Configuration UI is deferred until schema validation, migration, diff preview, rollback, and execution permission boundaries are stable.

## 13. Implemented schema foundation

`lib/role-agent-schema.js` is a zero-dependency, side-effect-free CommonJS module. Requiring or calling its validation/projection functions does not read or write files, inspect environment credentials, spawn providers, call a clock, or dispatch work.

Implemented contracts:
- Strict v2 validation for Role definitions, Agent instances, Routing policy, and the cross-document bundle.
- Distinct errors for invalid JSON, invalid shape, unknown fields, unsupported schema versions, and alias collisions.
- Deterministic legacy projection with one stable Agent per legacy role assignment.
- Reverse projection into a supplied legacy document while preserving the original legacy role key and unknown top-level/per-role fields.
- Existing forced custom legacy role keys, including keys that are not valid v2 IDs, receive deterministic generated v2 IDs and conservative read-only Role definitions. No write authority is inferred.
- `null` token budgets remain unknown; they are not converted to zero or unlimited.
- Multiple Agents may share a Role/provider/model while retaining distinct Agent IDs.
- Cross-document rejection of missing fallback targets, different-Role fallback, self-fallback, fallback cycles, missing Role inheritance targets, Role inheritance cycles, unknown Agent/Pipeline roles, and weakened tiny/normal/high-risk minimum requirements.
- Tiny requires verify-claim and write leases; normal additionally requires independent review and gate; high-risk additionally requires Architect and human approval.
- Assignment coverage is reported as `assignmentReady`/`assignmentGaps` with `providerReadinessChecked: false`; provider readiness remains a separate observation surface.

`scripts/role-agent-schema-probe.js` exercises an adversarial matrix, including an existing-CLI compatibility fixture proving that `roles list --json` still reads a valid legacy file without executing a provider and without changing the legacy bytes.

The probe is wired into `test`, `test:core`, `test:fast`, and the dedicated `test:role-agent-schema` script.

## 14. Implemented legacy runtime compatibility guard

The v2 documents remain inactive, but the existing legacy runtime now has a bounded, fail-closed authority boundary:

- `.leerness/agent-roles.json` remains schema version 1. Compatible `primary`, `candidates`, `fallbackPolicy`, and `requirements` fields are retained as legacy extension fields; they do not turn this file into a fourth v2 store.
- `roles validate` observes missing/valid/invalid state and a read-only v2 projection without rewriting source bytes or checking provider readiness.
- Every role read/write/route/dispatch rejects corrupt, empty, invalid-UTF-8, unsupported-schema, malformed, oversized, linked, or non-regular legacy stores before provider execution.
- `agents resolve|fallback` and role-bound `dispatch` use explicit fallback choices. A choice is committed only if both the legacy store content revision and the semantic availability revision still match the resolution snapshot.
- Invalid fallback presets, invisible approvers, unapproved high-risk tier downgrades, stale policy snapshots, and unproven high-risk reviewer independence fail closed.
- Provider-wide and exact-model observations share ledger order; the newest applicable value wins for each axis, so a newer provider-wide denial overrides an older exact-model allow.
- Role-bound `multi --execute` and `bench` are rejected because provider-default fan-out cannot prove one selected model contract. No automatic fallback or paid model invocation was introduced.
- Terminal execution/review/validation records require attributable task, attempt, executor, evidence, and applicable parent links; duplicate terminal attempts are rejected under the ledger lock.

## 15. Remaining before v2 runtime migration

- Add an explicit, atomic migration command that writes the three v2 stores only after validation, lock acquisition, preview/confirmation, and rollback preparation.
- Define the compatibility-window write rule for updating legacy and v2 projections under one lock.
- Add dedicated read-only CLI/MCP validation surfaces for the three native v2 documents; the current `roles validate` projection covers only legacy input.
- Re-run installed-package, full regression, multi-runtime, and independent adversarial review before any public runtime activation.
- Keep automatic fallback, model invocation, configuration UI, and dashboard writes disabled until their later milestones.
