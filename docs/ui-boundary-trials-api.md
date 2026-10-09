# UI boundary fixture measurement

`summarizeUiBoundaryTrials(inputJson)` in `lib/ui-boundary-trials.js` summarizes
host-labelled, fixed fixture trials. It performs no browser I/O, source inspection,
label authentication, semantic review, or approval. A test suite passing means the
observed outcomes match its assertions; it does not mean every leak was detected.

```js
const { summarizeUiBoundaryTrials, INPUT_SCHEMA } = require('leerness/lib/ui-boundary-trials');
const { POLICY_VERSION } = require('leerness/lib/ui-boundary');
const result = summarizeUiBoundaryTrials(JSON.stringify({
  schema: INPUT_SCHEMA,
  policyVersion: POLICY_VERSION,
  fixtureDigest, // sha256 of the host's fixed fixture and collection conditions
  trials: [{
    id: 'developer-note', expected: 'leakage', subtype: 'DEVELOPER_NOTE',
    before: { state: 'observed', findings: 2, digest: observationDigest },
    after: null, repair: null,
  }],
}));
```

The exact top-level schema is `leerness.ui-boundary-trials/v1`, `policyVersion`,
`fixtureDigest`, `trials`. Shared strict JSON admission rejects duplicate/unknown
fields and payloads beyond 64 KiB. There must be 1–128 trials with unique IDs matching
`[a-z][a-z0-9-]{0,63}`. No raw copy, URLs, or prompt fields are accepted.

Each trial has exactly `id`, `expected`, `subtype`, `before`, `after`, `repair`.
Expected `leakage` requires one of the five UIB-01 subtypes; `allowed` requires null.
Every observation has exactly `state`, `findings`, `digest`. States `observed` and
`partial` require an integer finding count from 0 to 4,096 and a lowercase SHA-256
digest (`sha256:` plus 64 hex characters). `stale` and `failed` require null count
and digest. These values are host declarations, not authenticated capture receipts.

`after` and `repair` must both be null or both be supplied for a leakage trial.
Repair has exactly `kind: fixture-repair`, `attempts: 1..100`, and `elapsedMs`, which
is either null or an integer from 0 to 86,400,000. Product-fix claims are rejected.
After-state disappearance of scanner candidates alone does not verify a semantic
fix. Timing describes fixture automation and observation, not human development
effort or a model's engineering performance.

## Counting rules

An `observed` before-state contributes one scenario to TP/FP/TN/FN according to
its expected label and whether any candidate was found. Ten duplicate DOM/AX
observations in one scenario count as one detection. Partial, stale and failed
before-states are unscored, not false negatives or true negatives.

- Precision: TP / (TP + FP).
- Recall: TP / (TP + FN).
- False-positive rate: FP / (FP + TN).
- Zero denominators return null, never an invented perfect rate.

`bySubtype` groups positive scenarios by their host-assigned subtype and reports
detected/missed/unscored counts. It is a detection-presence measure, not a subtype
classification accuracy matrix or a count of unique production defects.

All repair attempts and known automation times are counted. Unknown timing has a
separate count. Candidate-removal rate only includes initially detected positives
whose after-state is fully observed. An initial semantic miss followed by zero
findings is not a successful candidate removal. Partial after-states are excluded.

Output schema is `leerness.ui-boundary-trial-summary/v1`; it contains matrix,
subtype counts, rates, repair counters and `{id,outcome}` rows. It carries
`basis: host-labelled-fixture-trials`, false verification flags and no approval or
automatic deletion effects. Invalid input throws a fixed `UiBoundaryTrialError`
with `code: ui_boundary_trials_invalid`, without echoing input.

## Dashboard benchmark

`scripts/ui-boundary-dashboard-probe.js` uses the real `dashboard.snapshot` and
`renderHtml` implementation on an isolated synthetic workspace and renders it in
a temporary headless Chromium instance. Network requests are blocked. The script
changes only fixture-page headings to introduce ten labelled controls, then restores
the product heading for six repair trials. It tests all five leakage subtypes,
security masking, dense-page admission and unscored partial captures.

Set `LEERNESS_TEST_PLAYWRIGHT` to an existing Playwright module and
`LEERNESS_TEST_BROWSER` to a Chromium executable. No dependency is installed
implicitly. Run `node scripts/ui-boundary-dashboard-probe.js`. Optional
`--root <absolute-project-path>` also reads the actual CLI dashboard snapshot and
renders it transiently. That project's text remains unadjudicated and is excluded
from labelled quality rates. It is not written into logs or screenshot artifacts.

The fixture digest binds benchmark/policy/scanner/collector versions, the explicit
2,048-surface budget, dashboard/scanner/collector/metrics source digests, normalized
synthetic dashboard HTML and labelled controls. Browser version is reported
separately. Compare only matching fixture/policy conditions and comparable engines.

This finite corpus deliberately exposes one allowed diagnostic quotation that the
scanner flags, and three semantic leaks it misses. Do not hide those outcomes,
turn them into a copy allowlist, or interpret the corpus's rates as production or
model quality. Real semantic review remains a separate workflow.
