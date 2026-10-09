# Rule applicability advisory (P-0023 A)

`leerness rule assess --input '<JSON>' --json` evaluates explicit caller assertions.
The input is a JSON literal, not a filename. Do not include credentials or personal
data: command arguments can be visible to local process observers and shell history.
MCP clients can call `leerness_rule_assess` with `{ "input": <object> }`.

```json
{
  "schema": "leerness.rule-assessment-input/v1",
  "task": { "id": "migration-1", "operation": "data-copy" },
  "rules": [{
    "id": "effective-iam-audit",
    "text": "Run a recursive effective IAM audit.",
    "source": { "kind": "runbook", "ref": "runbook.md#audit" },
    "appliesWhen": { "operation": "permission-redesign" },
    "concerns": ["quota-exceeded"]
  }]
}
```

The example yields `not-applicable` to the **supplied condition**, and
`review-suggested`. It does not prove that a real migration can skip IAM checks.
No source file is opened, rule paused, approval applied or gate executed.

## Contract

- assessRuleApplicability(input): exported pure evaluator; typed invalid-input errors.

- JSON input maximum 16 KiB (UTF-8) at CLI/MCP boundaries; at most 50 rules.
- Task: required `id`; optional `taskType`, `event`, `environment`, `operation`.
- Rule: required unique `id`, `text`, `source`; optional `appliesWhen`, `concerns`.
- `source.kind`: `rule`, `runbook`, `gate`, `instruction`; `ref` is only a label.
- `appliesWhen`: any of the four task dimensions, combined with AND.
- All known conditions equal: `applicable`. Any known mismatch:
  `not-applicable`. No conditions or missing context without mismatch: `unknown`.
- Concerns: `quota-exceeded`, `scope-too-broad`, `possible-duplicate`,
  `superseded-claim`. They request review, never establish non-applicability alone.
- Identifiers: 1–80 characters, no whitespace/control characters; text: 1–4000;
  source ref: 1–300. Text/ref also reject control characters. Unknown keys,
  duplicate IDs/concerns and malformed input are rejected.

Every result retains `sourceTrust: caller-supplied`, `exception: none`,
`verification: not-run`, `enforceChanged: false`. A text SHA256 identifies supplied
text, **not the contents or authority of the referenced file**. Questions invite
the rule owner to review scope/evidence while preserving the existing gate.

This first slice is on-demand only. Automatic handoff discovery, trusted approval
capture, scoped exceptions and enforcement adapters remain separate planned work.
An advisory response must never be used as a deployment pass or permission grant.
