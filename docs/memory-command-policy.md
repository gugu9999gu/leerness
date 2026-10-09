# Explicit policies on memory commands

`decision add/drop`, `lesson save/drop` and `memory restore decisions/lessons`
accept an optional `--write-policy-json <serialized-policy>` value. The equals
form is also supported. The corresponding five MCP tools accept `writePolicyJson`
as a string. This uses the complete [write admission policy](memory-write-admission.md):
`limits`, `targets` and `mode` are all required. There is no saved configuration,
environment fallback, implicit operating budget or implicit legacy memory conversion.

In PowerShell, after choosing every budget in a policy document:

```powershell
$memoryPolicy = Get-Content -LiteralPath ./memory-policy.json -Raw
leerness decision add "Use the selected cache" --write-policy-json $memoryPolicy --json
leerness lesson drop "obsolete lesson" --write-policy-json $memoryPolicy --json
leerness memory restore lessons "recover" --write-policy-json $memoryPolicy --json
```

The CLI receives the JSON text itself, not a filename. The shell/client's initial
argument allocation or file reading is outside the memory writer's resource
boundary. Operating numbers must be chosen for the actual environment; test
fixture values are not defaults or sizing recommendations.

The existing canonical lock encloses the bounded source/footprint capture,
selection and publication. Source bytes and depth are checked before the first
canonical parse. Projection/archive reads use the observation limits. Restore
selection uses the archive from that capture, then admission rechecks the original
canonical, projection, archive and shared recovery inventory before publication.

Candidate item count is checked before append and before adding each parsed
restore batch. An iterative counter checks compact serialized bytes, pretty JSON
bytes, per-item bytes, depth and nodes before candidate `JSON.stringify`. Generated
projection parts are counted before its full render. Source selection copies and
the existing per-block Markdown parser's intermediate arrays are bounded by the
declared source/archive input size, not by a preallocated candidate item quota.
They are not a process-wide allocation or CPU guarantee.

Drop checks retained candidates, measures archive parts before rendering the full
lossless archive, and counts the header/footer and the integrity record line
(T-0331) before joining. Restore counts the
retained archive parts before joining them. Escaped operation JSON is measured
before serialization. The existing admission then checks full retained suffix,
archive, normal publication cost and storage targets before preparing outputs.

Existing duplicate skip, selection, restore conflict and `--force` semantics
remain. A duplicate skip still rechecks the captured source and does not create a
candidate write. `--force` cannot bypass processing limits, resource targets,
source changes or lossless archive validation. Present legacy Markdown without a
canonical store requires migration when a policy is supplied. Omitting the option
retains the previous writer behavior. Plan restoration is outside this policy.

Policy failures return nonzero CLI status and, with `--json`, `code: memory_policy`
with `reasonCode`, `phase` and optional `dimension`. No policy or memory payload is
included in those diagnostics. Existing missing-value syntax errors use
`missing_flag_value`. Repeated/malformed policies and a policy on an unsupported
command are rejected. MCP rejects invalid parameter types/envelope length before
child invocation; child policy failures use the same structured diagnostic.
Successful explicit publications additionally return `memoryPublication` metadata;
explicit restore now honors `--json` with a structured success result. Known cleanup
artifacts also reach partial-write errors and receipts. See the
[publication contract](memory-publication-policy.md) for field definitions and
plain-text cleanup warnings. Existing store/conflict/dry-run errors and the five
MCP tools' `safe-write` tier retain their contracts.

This bounds command memory preparation, not all CLI/MCP activity. Existing lock
metadata, startup metadata, success output, optional graph generation, telemetry,
and failure recovery retain their own contracts. Publication backend comparisons
now carry the derived explicit byte ceiling. Explicit partial-write recovery uses
[chunked copying and failure cost reporting](memory-recovery-transfer.md), including
when the receipt fails; this is a per-chunk bound, not a total recovery allowance.
Normal publication estimates do not bound partial failure artifacts, external
races, cleanup retention or physical disk use. No atomic transaction, lock proof,
physical reservation or independent review is granted by the policy. Complete
failure-recovery bounds and independently calibrated operating defaults remain
separate work.
