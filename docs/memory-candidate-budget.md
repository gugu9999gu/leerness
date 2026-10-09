# Explicit memory candidate budgets

Unreleased 1.36.196 introduces the internal pure API
`assessMemoryCandidateBudget(surface, candidateJson, limitsJson)` from
`lib/memory-candidate-budget.js`. Both JSON arguments must be strings. The surface
is `decisions` or `lessons`. This API assesses a caller-supplied candidate array;
ordinary CLI/MCP writers retain their existing defaults and behavior.

All seven limits must be supplied as nonnegative safe integers, with no extra
keys. There are no default writer limits in this API.

| Limit | Meaning |
| --- | --- |
| maxInputBytes | UTF-8 byte length of the supplied JavaScript JSON string |
| maxItems | Root array length |
| maxItemBytes | Compact JSON byte size of each parsed root item |
| maxCanonicalBytes | Entire parsed array as JSON with two-space indentation and a final newline |
| maxProjectionBytes | Generated Markdown only, including its fixed header |
| maxDepth | Maximum nested JSON container depth, counting the root array as 1 |
| maxNodes | Parsed JSON value visits, including arrays/objects/scalars; object keys are not nodes |

The limits JSON has a separate 2,048-byte envelope guard. It is metadata, not a
writer size limit. Values at a declared limit are accepted. Values over a limit
return an `exceeded` disposition. These numbers are declarations by the caller;
this API does not establish that they are suitable for any operating environment.

Input bytes and lexical container depth are checked before parsing the candidate.
The cheap string-length rejection can return `inputBytes: null` because the full
byte count was not performed. If malformed JSON already exceeds either guard,
the budget failure takes precedence over syntax validation. Otherwise malformed
JSON returns `unsupported/json_invalid`; a non-array root returns `array_required`.

The array length is checked next. An iterative traversal counts JSON output,
each item's compact size, and visited values. It then applies the existing memory
item validator and counts the existing projection format. Count/JSON budgets can
therefore take precedence over an unsupported item shape. This diagnostic error
ordering does not change the existing writer's error ordering.

No complete canonical output is stringified and no complete nonempty projection
is rendered. The existing projection generator normalizes one field at a time.
Parsing still allocates the entire permitted input; enumerating object keys and
normalizing a field can allocate memory. Depth/node/byte limits are logical checks,
not an exact RSS, CPU-time or physical-disk bound.

Results contain fixed metadata: `schemaVersion`, `surface`, `disposition`,
`reasonCodes`, `inputBytes`, `itemCount`, `measurements`, `index`, `field`,
`sourceVerified: false`, `approvalGranted: false`, `writesPerformed: false`,
`projectionScope: "generated-only"`, and `retentionBytes: null`.

A successful `within-declared-budget` result contains exact `canonicalBytes`,
`maxItemBytes`, `nodeCount`, `projectionBytes`, and `depth` for this parsed candidate.
An exceeded/unsupported result has `measurements: null`; incomplete counts are
not presented as a complete measurement. `index` is zero-based when attributable
to a root item, otherwise null. `field` contains a known field name only for an
unsupported memory item. No item values or parser exception text are returned.

Invalid API arguments or limit configuration throw `MemoryBudgetInputError` with
a fixed code. Exceeded budgets and unsupported candidate data are result states,
not exceptions. Unexpected internal errors are not converted into success.

The counter preserves existing parsed-value serialization semantics, including
unknown/nested JSON fields, missing/null fields and string escaping. Duplicate
JSON keys, numeric precision, negative zero and overflowing numeric literals
retain JavaScript parse/serialization behavior; raw JSON fidelity is not promised.
Objects supplied directly are refused without accessing their getters or coercion
methods. Internal parsed-value helpers are not APIs for arbitrary JavaScript objects.

This assessment does not read files, verify source identity, prepare an operation,
count retained Markdown suffixes/archives/recovery artifacts, reserve disk space,
grant permission, or certify that add/drop/restore will succeed. It must not be
used as a reusable write token. Filesystem admission, full operation costs, defaults
based on independent operating samples and the recovery of already oversized
stores remain separate work.

Run `npm run test:memory-budget` for renderer/serialization oracle cases, exact
budget boundaries and isolation checks. The test limits are fixture choices.
