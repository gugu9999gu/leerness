# Explicit memory write admission

`lib/memory-write-admission.js` adds an internal path for callers that supply a
complete resource policy. [Memory commands](memory-command-policy.md) can now opt
in explicitly; omitted policies retain the default behavior. It does not select
operating limits on behalf of users. Callers retain the canonical lock
and existing selection, duplicate, force and lossless archive checks throughout.

| Function | Behavior |
| --- | --- |
| `captureMemoryWriteAdmission(root, surface, policyJson)` | Checks explicit source byte/depth limits before the first canonical parse, captures the bounded files and recovery inventory, validates the source/projection, and rechecks them. Returns a capture with mutable selection copies in `entries` and `archiveBytes`; private source snapshots and policy are separate. |
| `prepareAdmittedMemoryWrite(capture, candidateJson, operationJson)` | Consumes the capture, checks the serialized candidate and operation, hard processing limits, normal publication costs and target policy before constructing complete outputs. Returns a private-backed prepared write with cost metadata. A failed preparation also consumes its capture. |
| `publishAdmittedMemoryWrite(write)` | Consumes the write, rechecks the original files and recovery inventory and invokes the prepared publisher with bounded backend comparisons. Returns publication/cleanup metadata. A failed publication attempt cannot reuse the write. |

Surfaces are `decisions` and `lessons`. Candidate and operation must be serialized
JSON strings; their creation by the caller is outside the admission boundary.
Operations use the existing `{kind, archiveText}` contract: update/null, drop/append
text, or restore/replacement text. Restore requires a present valid UTF-8 archive.
Canonical or genuinely empty stores are supported. A present legacy projection
without canonical JSON requires migration for this path; the default writer still
retains its existing legacy behavior.

The serialized policy has exactly three fields:

```text
limits: the complete observation/source/candidate/operation limits from the cost API
targets: {items, canonicalBytes, projectionBytes, archiveBytes, totalPathBytes}
mode: "within-target" or "reduce-existing"
```

Every target is an explicit nonnegative safe integer. Source and candidate
processing limits are independent, so an oversized source can be processed with
a larger declared source allowance and reduced to a smaller target. This path
inherits the [cost API limits](memory-write-budget.md) and additionally caps the
declared operation projection/archive byte ceilings at 4 MiB. These implementation
ceilings are not implicit operating targets. Invalid or omitted policy fields fail
before filesystem access.

Hard processing limits always apply, including in reduction mode. Target policy
is evaluated over source item count and actual canonical/projection/archive path
lengths; total path bytes also include shared recovery inventory. Candidate values
include retained projection suffix and archive append/replacement costs.

- If every result dimension is within its target, either mode permits preparation.
- `within-target` rejects any remaining target excess.
- `reduce-existing` permits a still-oversized result only if no excess increases
  or is newly introduced, and at least one previously excessive dimension shrinks.
  An unchanged excessive dimension may remain while another improves. Changes to
  dimensions that remain within target are permitted.

Removing an item does not automatically qualify as resource recovery: its archive
can grow, and total retained bytes can grow. Likewise, the word `restore` grants
no exception. A no-op that leaves an excessive store unchanged is rejected by
`reduce-existing`. Policy rejection occurs before any domain output construction
or publication, with no truncation, automatic cleanup or force bypass.

Initial canonical reads reject an oversized stat before opening the file. Bounded
descriptor reads use at most the declared limit plus one overflow-detection byte.
Depth is checked lexically before JSON parsing; array/item/node and generated-output
checks use the existing candidate estimator after bounded parsing. Projection and
archive reads and preparation rechecks also carry explicit byte ceilings. Full
canonical serialization, projection rendering and archive concatenation happen only
after their measured sizes pass. Each capture/read still requires storage for its
buffers and copies; the limits are not a process RSS, CPU or wall-clock guarantee.
`maxTotalFileBytes` counts canonical/projection/archive path bytes in a footprint;
it does not cap cumulative I/O across the initial read, capture and rechecks.

The prepared handle does not expose the underlying publisher handle. Copying its
fields or editing cost metadata cannot alter or authorize a write. The capture's
selection copies contain domain data and must not be exposed as public diagnostic
metadata. Neither the handle nor its disposition proves user authorization, lock
ownership, candidate selection semantics, archive record validity, an atomic
snapshot or physical disk reservation.

Backend comparisons now carry the private byte ceiling through external races,
displaced-file checks and hard-link cleanup validation. Known cleanup retention is
reported with the [publication contract](memory-publication-policy.md). Full failure
recovery collection has a separate [chunk transfer contract](memory-recovery-transfer.md)
and retains partial evidence with observed costs/stability. Its total reads remain
outside the comparison byte allowance. Normal path costs do not bound failure
artifacts or cleanup retention.
Independent operating corpus, default operating policy and full recovery resource
admission remain separate work.
