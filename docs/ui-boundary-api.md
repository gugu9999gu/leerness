# UI Boundary policy assessment

`lib/ui-boundary.js` implements the UIB-01 pure policy contract. It assesses one
caller's metadata declaration. It does not read text, scan a repository, render a
page, verify intent, call a model, approve a review or enable enforcement.

The rule is: **Only explicitly user-facing information may cross the UI boundary.
Everything else is non-renderable by default.** Natural language in a requirement
is not automatically product copy. Clearly required new copy is allowed without
a central string allowlist when its user-facing purpose is established.

```js
const { assessUiBoundary, INPUT_SCHEMA, POLICY_VERSION } = require('../lib/ui-boundary');
const result = assessUiBoundary(JSON.stringify({
  schema: INPUT_SCHEMA,
  policyVersion: POLICY_VERSION,
  taskKind: 'ui',
  candidate: {
    sourceKind: 'product_copy',
    intent: 'clearly-required',
    userNeed: 'act',
    use: 'product-copy',
    surface: 'proposed',
    sensitivity: 'none'
  }
}));
// result.recommendation === 'eligible-copy'; result.effects.approvalGranted === false
```

## Input v1

The sole argument is a serialized JSON string, at most 4096 UTF-8 bytes. This is
an envelope guard, not a product text length or runtime resource policy. Unknown
fields and unsupported versions are rejected. Objects, buffers and coercible
values are rejected without invoking getters or conversion methods. JSON uses
`JSON.parse` semantics, including its last-member behavior for duplicate keys;
this input is not a signed authorization envelope.

| Field | Values |
| --- | --- |
| `schema` | `leerness.ui-boundary-input/v1` |
| `policyVersion` | `leerness.ui-boundary/v1` |
| `taskKind` | `ui`, `non-ui`, `unknown` |
| `candidate` | Object below; exactly `null` for `non-ui` |
| `candidate.sourceKind` | `product_copy`, `specification`, `implementation_instruction`, `developer_note`, `acceptance_criterion`, `debug_metadata`, `unknown` |
| `candidate.intent` | `explicit`, `clearly-required`, `internal`, `unclear` |
| `candidate.userNeed` | `understand`, `decide`, `act`, `status`, `configure`, `none`, `unknown` |
| `candidate.use` | `product-copy`, `context`, `unknown` |
| `candidate.surface` | `proposed`, `rendered` |
| `candidate.sensitivity` | `none`, `suspected`, `confirmed`, `unknown` |

`sourceKind` describes origin; `use` describes how the candidate is being used.
For example, adapting a requirement into an intentional action label is
`product-copy`; inserting the requirement itself as a decorative subtitle is
`context`. A user-facing documentation quotation or an administration field can
be intentional product copy. A source category alone is not a prohibition.
`userNeed` concerns the actual user's understanding, decision, action, status or
configuration. These are caller assertions, not inferred or verified facts.

## Decision order

1. A valid non-UI envelope returns `not-applicable`, with no findings or requested
   review domains. Existing task payloads do not pass through this API implicitly.
2. Suspected or confirmed sensitivity routes one finding to `security`, carrying
   any UI subtype as context. Severity remains `delegated` to the existing
   security policy. No second UI finding or security approval is manufactured.
3. For a declared UI candidate, `eligible-copy` requires explicit/clearly required
   intent, a known user need and source, `product-copy` use and sensitivity `none`.
   Internal intent or `context` use takes precedence over an otherwise favorable
   declaration. An unknown task kind never grants copy eligibility.
4. Other proposed UI candidates are `withhold`; rendered candidates and unknown
   task kinds are `review-required`. Ambiguity is a reason for review, not proof
   of a leakage subtype. Existing copy is never automatically deleted.

| Source used as context | Finding subtype |
| --- | --- |
| Specification | `SPEC_TO_COPY` |
| Implementation instruction | `IMPLEMENTATION_NARRATION` |
| Developer note | `DEVELOPER_NOTE` |
| Acceptance criterion | `CRITERIA_TO_COPY` |
| Debug/metadata | `DEBUG_METADATA` |

Only an explicit context/internal declaration with a mapped source produces a UI
finding candidate. Sensitive content has security precedence regardless of its
source. `eligibleForCopy` is policy advice, never verified semantic correctness or
permission to bypass another security, review or rendering gate.

## Evidence and limitations

Output schema is `leerness.ui-boundary-assessment/v1`. The assessment records
fixed reason codes, finding categories and suggested review domains; no text,
prompt, file path, role, model identity or arbitrary caller metadata is accepted
or echoed. `UiBoundaryInputError` reports fixed `code` and `field`, without native
parse error text. Results are independent mutable values; the taxonomy is frozen.

Source/render/semantic verification are always false, independent review is
`not-run`, and all effects are false, including `autoRemove`. A caller can provide
inaccurate declarations; this module does not prove rendered text matches them.
The named policy version does not certify deployment or review completion.

`scripts/ui-boundary-probe.js` checks declared positive/negative controls. Sample
copy in those fixtures is explanatory test data and is not semantically read by
the assessor. Passing the fixtures is not a measured scanner precision/recall
result or actual DOM/accessibility validation. Optional Role/Task/Review adapters are documented in
[UI Boundary contracts](ui-boundary-contracts.md). Deterministic text scanning,
security deduplication across external scanners,
snapshot-bound independent review and rendered UI inspection are later stages.
Framework/provider names and administrative model/status fields have no keyword
ban. Existing runtime policy, global role prompts and UI remain unchanged. Missing
optional fields retain the original task/review behavior.

The [UI boundary scanner](ui-boundary-scanner.md) separately examines caller-supplied surface text. This metadata assessor does not scan copy or attest its meaning.
