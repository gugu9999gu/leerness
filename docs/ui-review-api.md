# UI review material and receipt contract

The login-free [CLI](ui-review-cli.md) exposes packet preparation and original/current assessment through `ui review packet|assess --stdin`. It preserves the unverified declaration boundary described below.

UIB-04A adds a read-only CommonJS API for preparing a UI review packet and
evaluating a declared review against its original and current material bindings.
It reuses the [review snapshot](review-snapshot-api.md), [checkpoint](review-checkpoint-api.md),
[UI review finding contract](ui-boundary-contracts.md) and existing role independence policy.
It does not collect materials, run a semantic reviewer, authenticate receipts,
persist results, or authorize review reuse. UIB-04's trusted evidence and semantic
execution integration remains separate work.

```js
const {
  createUiReviewPacket, assessUiReview,
} = require('leerness/lib/ui-review');

// Each argument is serialized JSON, never a path or an executable object.
const packet = createUiReviewPacket(originalInputJson);
const missing = assessUiReview(originalInputJson, currentInputJson);
// missing.state is not-reviewed, stale or not-applicable, depending on inputs.
const assessment = assessUiReview(originalInputJson, currentInputJson, receiptJson);
// All effects and verification grants remain false, even for review-candidate.
```

## Material input

Exact root fields: `schema: leerness.ui-review-input/v1`,
`policyVersion: leerness.ui-boundary/v1`, `snapshot`, `uiMaterials`, `contributors`.
`snapshot` is the complete existing `leerness.review-snapshot-input/v1` object,
including a checkpoint and all RB-02 material digests. A source snapshot is required.

Every task whose optional UI contract declares `ui` or `unknown` requires one
`uiMaterials` row; tasks with an absent or non-UI contract require none. Maximum
UI task count is 32. Unknown applicability remains a preparation gap.

| UI material field | Meaning |
| --- | --- |
| `taskId` | Exact checkpoint task ID |
| `sourceDigest` | Digest of the relevant fixed source material |
| `specDigest` | Digest of actual specification and copy intent |
| `diffDigest` | Digest of the exact reviewed change |
| `renderDigest` | Digest of relevant render/DOM/accessibility evidence |

All fields are required. Digests use `sha256:<64 lowercase hexadecimal characters>`;
use `null` for unknown material. Null creates a visible gap; omitting membership or
using an unknown task is an input error. Do not substitute an invented digest for
unknown evidence. The function verifies syntax only, not digest contents or origin.

`contributors` contains 0..32 distinct implementation attempts, each with exactly
`attemptId`, nonempty unique `taskIds` (up to 100 in-batch IDs), and `executor`.
Every UI task needs a declared contributor to prepare a packet. All listed
contributors participate in independence comparison, including shared work and
non-UI contributions. This membership is supplied by the caller; the API cannot
discover omitted attempts or prove its completeness.

An executor/reviewer is `null` or exactly `{ provider, model, sessionId }`, with
each field nullable. Provider IDs must already be canonical under the existing
role provider normalizer, models must satisfy its inert model identifier syntax,
and sessions use the checkpoint's ASCII ID syntax. Identity-source labels,
family overrides, verified flags and raw transcripts are not accepted.

## Packet identity and scope

Packet schema is `leerness.ui-review-packet/v1`. `packetId` binds:

- the existing RB-02 snapshot ID, including source, policy, criteria, evidence,
  task declarations and dependencies;
- UI material digests and exact task membership, sorted by task ID;
- implementation attempt membership and identity declarations, sorted by attempt ID.

Canonical row arrays have fixed field order. Material rows are
`[taskId, sourceDigest, specDigest, diffDigest, renderDigest]`. Contributor rows are
`[attemptId, sortedTaskIds, executor === null ? null : [provider, model, sessionId]]`.
Their SHA-256 bindings hash the UTF-8 JSON arrays `[packetSchema, 'ui-materials', rows]`
and `[packetSchema, 'contributors', rows]`. The packet ID hashes
`[packetSchema, policyVersion, { snapshot, uiMaterials, contributors }]`, where
those object fields are the binding digests in the shown order. This is a local
versioned format, not a signature or a general canonical-JSON standard.

RB-02's object/set order normalization and conservative source changes are
preserved. Advisory checkpoint context, capacity limits and metrics are excluded
from material identity, but RB-01 readiness is always reevaluated for the current
input. An unchanged packet ID cannot bypass failed tests, incomplete purposes,
disconnected task groups, missing evidence or exceeded capacity.

`taskCoverage` requests all five UI leakage subtypes for each UI/unknown task,
retaining criterion membership and RB-01 requested aspects. `questions` provides
fixed semantic review prompts for specification copy, implementation narration,
developer notes, acceptance criteria and internal metadata. Each asks the reviewer to
read every visible string and accessible name, not only scanner candidates (the
scanner cannot see requirement, criterion or narration wording), gives concrete cues,
and names the legitimate case that is not a finding. These questions are
not executed. `scope: ui-boundary-only` excludes approval of other requested
aspects such as security, performance or general correctness.

## Declared receipt

The optional third argument is a serialized object with exactly:

| Field | Contract |
| --- | --- |
| `schema` | `leerness.ui-review-receipt/v1` |
| `policyVersion` | `leerness.ui-boundary/v1` |
| `packetId` | Digest of the original packet the reviewer claims to have inspected |
| `attemptId` | Review attempt ID; null only for not-run |
| `execution` | `not-run`, `completed`, `failed`, `partial` |
| `reviewer` | Nullable executor identity, same shape as above |
| `coverage` | Up to 160 distinct task/subtype cells |
| `review` | Existing optional UI review contract, with evidenceVerified false |

Each coverage cell is exactly `{ taskId, subtype, outcome, findingIndexes }`.
`subtype` is one of the five UI taxonomy codes. `outcome` is `no-finding`,
`finding` or `inconclusive`. Finding outcomes must reference one or more indices
in `review.findings`; other outcomes must have no indices. Each finding must be
assigned exactly once to a cell with its matching non-null subtype. Unsupported
or untyped security findings must first receive a scoped classification from the
reviewer; this API does not invent one. At most 32 findings are accepted through
the existing review validator.

Receipt task membership is validated against the original packet, so adding or
removing tasks in the current packet produces stale/missing coverage instead of
silently transferring an old task's result. Review task kind must match original
packet applicability. A not-run receipt must have null attempt/reviewer and no
coverage/findings. Omit the third argument for a missing receipt; serialized null
is not a receipt. Shape-valid failed/partial results can carry partial findings.

The [scanner](ui-boundary-scanner.md) projection can populate typed findings, but
it cannot fill semantic no-finding coverage or establish a completed review.
Do not fabricate executed receipts or five passing cells from a scan with no hits.

## Assessment and independence

`leerness.ui-review-assessment/v1` reports material `changedBindings`, receipt
binding, all current task/subtype cells, finding count, execution declaration,
independence diagnostics and reason codes. A changed original/current packet or
receipt bound to a different original packet is stale. Unchanged bindings remain
unverified. A removed last UI task is not-applicable with changes still visible;
it does not make the old receipt reusable.

Primary state priority is: not-applicable, stale, not-reviewed, needs-context,
incomplete, findings, self-review/not-independent, identity-unverified, review-candidate.
All reasons remain visible even when another condition has higher priority.
`declaredCoverage` describes claims, not verified semantic work; failed execution
never becomes successful because individual cells say no-finding.

The existing `assessReviewerIndependence` policy compares the reviewer against
every declared contributor. The same attempt or session is self-review. Same
provider/model/model family is not-independent; missing or opaque identity stays
unverified. Different provider and recognizable different family yields only
`compatible-declarations`, never authenticated independence. A second contributor
can invalidate compatibility even when the primary contributor differs.

Every result retains source/evidence/render/execution/actor/semantic verification
false and `independentReview: not-verified`. Assessments retain
`reviewValidity: unverified`, `trust: caller-declarations`. File/network/model/
approval/reuse/enforcement/removal effects are false. No run receipt, actor
attestation, accepted source or actual UI was verified by this contract.

## Input safety and validation

Each of the three strings is separately limited to 65,536 UTF-8 bytes. The shared
checkpoint parser rejects duplicate keys (including escaped equivalents), BOM,
invalid JSON, excessive depth (>16), visited values (>10,000), and arrays (>1,000)
before domain-specific limits. Missing/unknown fields reject; inputs are never
coerced from executable objects. Output metadata can include caller task IDs and
criterion labels, so those identifiers must not contain secrets. Raw material,
paths, transcripts and identity values are not copied into the assessment.

Errors are `UiReviewInputError` with fixed `ui_review_*` codes and schema paths.
`node scripts/ui-review-probe.js` or `npm run test:ui-boundary` exercises the
contract with synthetic declarations. Tests do not constitute actual independent
review or measured semantic accuracy. No CLI/MCP command or persistent store is
added, and legacy checkpoint/snapshot/role schemas are unchanged.

## Checked byte observations

[UI review observations](ui-review-observation-api.md) provide selected-file digest
verification and a single host callback with source rechecks. This additive layer
preserves this API's declaration trust and does not authenticate independent review.
