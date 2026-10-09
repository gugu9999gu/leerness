# UI review ledger correlation

`lib/ui-review-ledger.js` adds a bounded, single-task correlation adapter over
[UI byte observations](ui-review-observation-api.md) and the existing execution
ledger. It reads real records and checks their relationships with selected bytes
and a newly returned receipt. Ledger actor fields remain declarations. No
provider authentication, independent approval, dispatch, or durable finalize is
implemented by this API.

```js
const { runUiReviewWithLedger } = require('leerness/lib/ui-review-ledger');
const result = await runUiReviewWithLedger(
  absoluteProjectRoot,
  JSON.stringify(observationRequest),
  JSON.stringify(currentUiReviewInput),
  async ({ packet, materials, selectionDigest, implementationEventIds }) => {
    // Host-controlled review lifecycle: inspect these exact Buffer copies and
    // record the resulting terminal event through its authorized ledger writer.
    // Return the exact serialized UIB-04A receipt used in that event's digest.
    return await hostReview({ packet, materials, selectionDigest, implementationEventIds });
  }
);
```

The first three arguments retain the observation API's schema, limits and current
packet checks. The callback must be a function, and remains trusted executable
host code with host-controlled effects, cancellation and costs. This adapter
does not append any event, launch any CLI, discover providers, or call a model.
If the host does not record a terminal event, the returned result is unlinked.

## Supported scope

This adapter currently accepts exactly one checkpoint task, one UI material row,
and one or more declared implementation attempts belonging to that same task.
The existing terminal ledger has a single task and parent attempt per event;
this adapter does not invent a batch-wide terminal identity. Multi-task input
returns `single_task_required`, without invoking the callback. Existing UIB-04A/B
multi-task APIs remain unchanged. M-0019 batch records and execution authority
are prerequisites for broader correlation and independent review.

## Before the callback

The adapter captures the selected UI files using UIB-04B, then checks
`.leerness/execution-ledger.jsonl` with the existing checked-input and ledger
readers. This narrower adapter reads at most **1 MiB** and **2000 records**. Each
nonblank line must fit the shared 64 KiB strict JSON parser; duplicate keys,
malformed UTF-8, incomplete final lines, malformed existing terminal schema,
duplicate/empty event IDs, truncated history and read failures refuse linkage.
The full file must be newline terminated. Byte and reader-revision comparisons
ensure that the parsed records describe the checked bytes. No invalid history
is skipped to produce a successful result.

Every contributor must have exactly one terminal event for its attempt ID across
the entire observed history. That event must be `execution.completed`, executed,
and belong to the declared task. Its actual executor provider/model/session must
match the UI input's declaration. Top-level and nested sessions cannot conflict;
a known top-level session cannot be hidden behind an unknown nested value.
Unknown model values remain unknown rather than becoming authenticated models.

Each implementation terminal must reference the selected source and diff file
digests in `evidenceRefs`. It must also reference a unique, earlier preparation
or start event (`routing.proposed`, `fallback.selected`, `dispatch.prepared`, or
`execution.started`) with the same task and compatible role/executor fields.
This establishes record relationships; a prepared command with `executed:false`
is not upgraded to observed execution. The completed event itself can still be a
user-reported declaration.

## After the callback

UIB-04B rechecks source files, Buffer integrity, receipt coverage, findings and
current packet binding. Only a valid receipt matching the reviewed packet can
proceed to ledger correlation. A second checked ledger read must preserve the
same file and parent identity and every byte of the original prefix. Appending
unrelated valid events is allowed; rewriting, truncating or replacing the old
ledger is not. These are bounded check/recheck observations, not an atomic
snapshot, lock or protection against hostile same-process code.

The callback receipt's attempt ID must be absent from the initial history and
have exactly one terminal event in the final history. That event must:

- Be an executed `review.completed` for the same task and receipt identity.
- Name one of the checked implementation attempts in both `parentAttemptId` and
  `reviewOfAttemptId`.
- Include the packet ID, selection digest, receipt digest and **every** checked
  implementation event ID in `evidenceRefs`.
- Include `review.uiBoundary` equal to the returned receipt's validated review.

The receipt digest is `sha256:` plus SHA-256 of the **exact UTF-8 serialized
receipt string** returned by the callback, including its whitespace. It is not
the hash of a reformatted object. The digest binds coverage and actor declarations
without persisting raw source bytes or adding a second review schema. A host
must retain its authorized complete receipt separately if durable reconstruction
is needed; this adapter does not implement such retention.

## Result and limitations

Results use `leerness.ui-review-ledger-observation/v1`. `state: 'ledger-linked'`
means these record and byte relationships matched. `unlinked` has a fixed
`reasonCode`; preflight failure leaves `observation:null` and does not call the
host. The result reports original/final ledger digests, correlated event IDs,
receipt digest, packet/selection identity, and the unchanged UIB-04B observation.
It copies no raw ledger summaries, material text, paths or foreign error messages.
Caller-supplied identifiers in the packet and ledger should contain no secrets.

`ledger-linked` is not acceptance. Its nested assessment may still contain
findings, incomplete coverage, self-review or incompatible identities. Trust is
always `local-ledger-declarations`; actor/semantic verification, independent
review, approval and approval reuse remain false or `not-verified`. An arbitrary
`identitySource: 'provider-attested'` or `reviewerIndependent:true` in the ledger
does not change that. Identical fabricated records and declarations cannot be
distinguished from genuine provider activity by reading a local file alone.

Source digest association does not verify the declared Git commit, specification
origin, actual render producer or the semantic correctness of a finding. The
existing M-0019 durable/CAS/finalize and authorized provider execution boundaries
remain required for independently authenticated review. This module adds no
CLI/MCP endpoint and changes no existing role, ledger writer or dispatch policy.

`node scripts/ui-review-ledger-probe.js` exercises real isolated ledger writes and
reads, observation callbacks, parent/attempt/identity conflicts, full-prefix
preservation, scope/digest binding, replay, limits and trust downgrade controls.
Provider names and terminal claims in these tests are synthetic fixtures, not
live provider reviews.
