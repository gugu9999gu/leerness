# UI Boundary Role / Task / Review contracts

UIB-02 adds optional, versioned metadata to existing role definitions, review
checkpoint tasks and execution ledger review records. Missing fields preserve
the old contracts. This does not enable agent dispatch or UI enforcement.

## Surfaces

| Existing surface | Optional field | Extension schema |
| --- | --- | --- |
| Role definitions v2 `roles.<id>` | `uiBoundary` | `leerness.ui-boundary-role/v1` |
| Review checkpoint v1 `tasks[]` | `uiBoundary` | `leerness.ui-boundary-task/v1` |
| Execution ledger v1 `review` | `uiBoundary` | `leerness.ui-boundary-review/v1` |

Each extension requires `policyVersion: "leerness.ui-boundary/v1"`. The outer
schema versions remain unchanged. Older strict readers can reject an opted-in
extension; this is backward readability of existing payloads in the new reader,
not a claim that old binaries understand new fields. No stored project role
configuration is rewritten automatically. Legacy assignment extension fields
remain governed by their existing roundtrip rules.

## Role responsibility

```json
{
  "schema": "leerness.ui-boundary-role/v1",
  "policyVersion": "leerness.ui-boundary/v1",
  "responsibility": "implementer"
}
```

Built-in `designer`, `coder`, `tester`, `reviewer`, `security` map respectively to
`designer`, `implementer`, `tester`, `reviewer`, `security`. A conflicting mapping
for these IDs is rejected. Other/custom roles can explicitly select a duty;
the extension never grants write/approve/release permissions or modifies role
inheritance. The existing permission ceilings still apply.

`createUiBoundaryRole(responsibility)` creates the small extension.
`uiBoundaryRoleInstructions(roleExtension, taskExtension)` returns the shared
rule and duty-specific responsibilities for a UI/unknown task. A missing task
extension or declared non-UI task returns null. This is an explicit assembly API;
global legacy role prompts are not changed or injected into every task.

| Responsibility | Required attention |
| --- | --- |
| Designer | Establish the actual user need and intended product copy |
| Implementer | Keep instructions/criteria/internal context out of copy; create clearly required copy |
| Tester | Compare actual render/DOM/accessibility surfaces against all five subtypes |
| Reviewer | Compare spec/diff/render evidence; distinguish self-review and independent review |
| Security | Route sensitive exposures through security policy and preserve provenance |

The instruction contract includes the common default-deny rule, permits explicit
or clearly required user-facing copy, rejects context rendering by default and
does not require a central string allowlist. It never changes provider/model
selection, runtime permissions or execution policy.

## Task policy

```json
{
  "schema": "leerness.ui-boundary-task/v1",
  "policyVersion": "leerness.ui-boundary/v1",
  "taskKind": "ui"
}
```

`taskKind` is `ui`, `non-ui` or `unknown`. The review checkpoint validates the
optional field and adds an unreviewed UI domain to that task's coverage for UI
or unknown kind. Missing/non-UI fields do not request extra UI review. Existing
checkpoint readiness, risk and authority gates are unchanged. Its input digest
includes the field; existing review snapshot task binding also includes it, so
adding/removing/changing the task declaration changes the snapshot candidate.
No current semantic approval is inferred from snapshot equality.

## Review provenance

```json
{
  "schema": "leerness.ui-boundary-review/v1",
  "policyVersion": "leerness.ui-boundary/v1",
  "taskKind": "ui",
  "findings": [{
    "category": "instruction_to_ui_leakage",
    "subtype": "CRITERIA_TO_COPY",
    "sourceKind": "acceptance_criterion",
    "severity": "advisory",
    "disposition": "review-remediation",
    "evidenceDigest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  }],
  "evidenceVerified": false
}
```

At most 32 findings are accepted. Each finding has exactly the six fields shown.
Evidence digests are caller-supplied SHA256 references, not fetched or verified.
Source kinds and subtypes reuse UIB-01's taxonomy. UI findings require a mapped
subtype, advisory severity and `exclude-from-copy` or `review-remediation`.
Sensitive findings use category `security`, severity `delegated`, and
`withhold-pending-review` or `review-remediation`; any UI subtype is supporting
context. A security finding may have a null subtype for product-copy/unknown
origin. Declared non-UI reviews require no findings. `evidenceVerified` must be
false; empty findings are not evidence of a leak-free UI.

`createUiBoundaryReview(assessmentInputJson, evidenceDigest)` calls the UIB-01
assessor and projects its finding candidates into this contract. It cannot infer
meaning from text. The reader accepts manually assembled declarations under the
same rules; structural validity does not certify their accuracy or independence.

The execution ledger validates the extension before append and on read. Only
this validated, bounded metadata is preserved across generic log sanitization;
other keys keep existing redaction behavior. Invalid extension data cannot be
silently truncated into an apparently valid receipt. Raw copy, prompts, location
paths, secrets and extra keys are rejected from this extension. Parent attempt,
execution and evidence requirements on the enclosing review event remain intact.
UI metadata does not turn a self-review into independent review or an execution
result into an approval. No new CLI/MCP write or migration is introduced.

## Input safety and limits

Extension validators accept inert JSON data objects, check own data properties,
reject accessors/hidden/symbol/unknown properties, and emit fixed error codes and
schema paths without input values. Proxies and hostile modified JS intrinsics
are outside this contract, as with the existing object-based schema APIs. Flat
role/task objects and the 32-row fixed review shape are bounded before traversal.
Serialized assessment input retains UIB-01's 4096-byte limit.

UIB-03 scanning/security deduplication, UIB-04 source/spec/render verification and
independence, and UIB-05 actual render/accessibility validation are separate work.

## Pattern scan projection

The [UI boundary scanner](ui-boundary-scanner.md) returns a validated optional review projection from bounded caller-supplied UI surfaces. These pattern-inferred candidates remain unverified; parent ledger execution and independence requirements still apply.

## UI semantic review declaration contract

The [UI review API](ui-review-api.md) binds task-specific source/spec/diff/render digests to this snapshot and evaluates declared coverage, freshness and reviewer identity compatibility. It grants no authenticated review, approval reuse, or execution authority.
