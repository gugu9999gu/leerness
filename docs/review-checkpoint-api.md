# Review checkpoint advisory (RB-01)

Status: experimental API on a local development branch; not published or automatically enabled in a review workflow. The additive [CLI/MCP read-only adapter](review-checkpoint-transport.md) exposes this exact assessor without persistence, dispatch, or approval. Existing review, independence, release, and verification rules are unchanged.

## API and trust boundary

```js
const {
  assessReviewCheckpoint,
  validateReviewCheckpointInput,
  ReviewCheckpointInputError,
} = require('leerness/lib/review-checkpoint');
```

`assessReviewCheckpoint(input)` synchronously evaluates inert JSON-compatible data. It does not load a repository, run Git, read evidence, contact a model, create a batch, change a task, approve a review, or relax a gate. The output always retains `sourceTrust: "caller-supplied"`, `snapshotVerified: false`, `evidenceVerified: false`, `independentReview: "not-run"`, and `approvalGranted: false`.

A `packet-candidate` means only that the supplied metadata has no preparation gaps under this narrow contract. It is not an authorized dispatch request, semantic verification, independent approval, or production permission. Matching purpose/criterion IDs are caller assertions: the function cannot establish that their real-world meaning is coherent, nor detect unrelated work falsely labeled with the same IDs. A future trusted snapshot adapter must verify actual scope, policy, model identity, evidence, and permissions.

## Complete one-task example

```js
const input = {
  schema: 'leerness.review-checkpoint-input/v1',
  objective: { id: 'order-create', criteria: ['order-create-works'] },
  tasks: [{
    id: 'order-api', objectiveId: 'order-create',
    criteria: ['order-create-works'], dependsOn: [],
    implementation: 'implemented', verification: 'passed',
    evidenceRefs: ['evidence:order-api'],
    risk: 'normal', riskTags: [], aspects: ['code', 'tests'],
  }],
  context: { event: 'task-report', purposeComplete: true, executionMode: 'direct' },
  // Shape-valid example hashes, not real commits verified by this module.
  snapshot: { kind: 'git', baseCommit: 'a'.repeat(40), headCommit: 'b'.repeat(40) },
  limits: { maxTasks: 5, maxFiles: 10, maxChangedLines: 400, maxWaitingHours: 24 },
  metrics: { fileCount: 2, changedLines: 80, waitingHours: 1 },
};
const result = assessReviewCheckpoint(input);
// grouping.state: eligible; checkpoint.state: due;
// preparation.state: packet-candidate; effects.approvalGranted: false.
```

The limit values are explicitly supplied pilot examples, not measured optima or installed default policy. There is no minimum task-count quota: one completed purpose can trigger review. A common objective is necessary but not sufficient: the tasks must also be connected through declared dependencies or shared acceptance criteria. Different objective IDs or disconnected scope require a split. At a size limit the capacity checkpoint is due; exceeding it requires a split. Waiting time triggers a checkpoint, not approval or an automatic paid request.

## Input contract

Unknown fields and duplicate identifiers/list entries are rejected. Input schema v1 is strict; future fields require a separately versioned compatibility decision.

| Field | Contract |
| --- | --- |
| `schema` | Exactly `leerness.review-checkpoint-input/v1` |
| `objective` | `id` plus 1..100 unique `criteria` IDs |
| `tasks` | 1..100 tasks. Every field in the example task is required. |
| task identifiers | `id` unique; `objectiveId`; 1..100 criterion IDs from the objective; 0..100 dependencies and evidence reference IDs |
| `implementation` | `planned`, `implementing`, `implemented`, `blocked` |
| `verification` | `not-run`, `passed`, `failed`, `partial`, `inconclusive`; these remain unverified assertions |
| `risk` | `low`, `normal`, `high`, `critical`, `unknown` |
| `riskTags` | Unique subset of `authentication`, `authorization`, `payment`, `destructive-migration`, `sensitive-data`, `irreversible-change` |
| `aspects` | Nonempty unique subset of `code`, `security`, `data`, `compatibility`, `performance`, `ux`, `tests` |
| `context` | Required `event`, boolean `purposeComplete`, `executionMode` |
| `event` | `task-report`, `handoff`, `manual-review`, `integration`, `release`, `risk-apply` |
| `executionMode` | `direct`, `delegated`, `parallel`. This is separate from model selection `manual/pinned/auto`. No mode creates an agent. Non-direct modes require a separate delegation assessment. |
| `snapshot` | Required, nullable. Git: `kind`, `baseCommit`, `headCommit` (both lowercase full 40-character or both 64-character hashes). Non-Git: `kind: content`, `digest: sha256:<64 lowercase hex>`. |
| `limits` | Positive integer `maxTasks` <=100, `maxFiles` <=1,000,000, `maxChangedLines` <=10,000,000. Optional finite `maxWaitingHours` in [0.001, 87600]. |
| `metrics` | Required nullable `fileCount`, `changedLines`, `waitingHours`; known values finite, nonnegative, <=100,000,000. File/line counts integer. Unknown is null, never inferred as zero. |
| `externalDependencies` | Optional array, 0..100, never null/false/string. Each entry has unique `id`, `state: satisfied/pending/unknown`, nullable `revision`. Satisfied requires a revision ID. Must be referenced by a task and cannot collide with an in-batch task ID. |

IDs are case-sensitive ASCII labels matching `[A-Za-z0-9][A-Za-z0-9._:-]{0,79}`. References are labels, not file paths or instructions to execute. Dependency cycles, missing/unused external references and unknown criteria are errors. Revision labels are not verified Git commits unless the future adapter establishes that separately.

The JSON serialization limit is 65,536 UTF-8 bytes, with defensive limits on depth (16), visited values (10,000), and generic array length (1,000) before domain limits. Cycles, non-finite numbers, sparse arrays, functions, accessors, symbols, hidden fields, and exotic prototypes are rejected. Inert plain/null-prototype objects and ordinary arrays are accepted. Do not pass Proxies: this is data validation, not a JavaScript sandbox. Raw JSON parsing and duplicate raw-key detection are not provided by this object API.

## Independent result axes

| Axis | Meaning |
| --- | --- |
| `grouping` | `eligible`, `needs-context`, `split-required`, with reason codes and missing criterion coverage |
| `checkpoint` | `due`, `not-due`, `needs-context`; trigger codes retained even when the packet needs a split/evidence |
| `preparation` | `packet-candidate`, `needs-evidence`, `split-required`; does not mean evidence was inspected |
| `taskCoverage` | Requested aspects per task/criterion, always `not-reviewed` and `unverified` |
| `execution` | Requested implementation mode and whether another delegation assessment is needed; never starts work |
| `verification` / `effects` | Explicit unverified/not-run/no-side-effect boundaries |

High/critical risk, any risk tag, or `risk-apply` triggers a risk checkpoint. High-risk/flagged tasks request security review; destructive migration also requests data and compatibility review. Incomplete work can therefore be `checkpoint: due` and `preparation: needs-evidence` at the same time. This asks for a narrow early-review packet; it does not wait until dangerous changes are applied. The v1 final-packet preparation check still requires the declared purpose, implementations, passing verification assertions, references, known size/risk, snapshot, and satisfied external dependencies. Failed or missing tests cannot become an approval.

`inputDigest` uses SHA-256 over v1 canonical JSON (sorted object keys, array order preserved). It identifies the exact supplied metadata, not filesystem content or authenticated authorship. Code/evidence/limit changes alter it. Actual stale-review handling, immutable records, commit ancestry, reviewer identity, public/private policy authorization and final gate evaluation remain later RB-02/RB-03 work. Non-Git content snapshots do not imply Git durability.

## Errors and verification

Invalid input throws `ReviewCheckpointInputError` with bounded `code` and `field`, without echoing input values or unknown property names. This module has no permissive fallback to approval.

Run `node scripts/review-checkpoint-probe.js` (or `npm run test:review-checkpoint`). The probe is also wired into `test`, `test:core`, and `test:fast`; existing assertions are not removed. Tests include positive/negative grouping controls, partial/unknown evidence, early risk, mode separation, dependency cycles, strict input limits, deterministic digests, frozen input, output isolation, and guards against runtime filesystem/network/process/time/random calls. Module loading itself necessarily uses the Node loader and is outside the assessment's no-I/O claim.

한국어: 이 API는 호출자가 제공한 메타데이터로 묶음·검수 시점·자료 부족을 설명하는 순수 판정기입니다. 테스트 통과 문자열이나 커밋 모양을 실제 증거로 인증하지 않으며, 모델 호출·상태 저장·검수 승인·기존 gate 변경은 하지 않습니다. 읽기 전용 CLI/MCP 어댑터는 별도 문서에 정의되어 있으며, 자동 검수·모델 호출·상태 저장·운영 gate 활성화는 아직 구현하지 않았습니다.


## Optional UI Boundary task contract

UIB-02 accepts a versioned `uiBoundary` field on each task. UI/unknown declarations
add unreviewed UI-domain coverage and the ux aspect; missing/non-UI declarations
retain the previous coverage. No approval, readiness or execution gate is bypassed.
The existing input digest and review-snapshot task binding include the declaration.
See [UI Boundary contracts](ui-boundary-contracts.md).
