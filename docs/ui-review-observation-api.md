# UI review byte observations

`lib/ui-review-observation.js` implements UIB-04B: it checks selected local bytes
against a [UI review packet](ui-review-api.md), supplies private copies to one
host callback, rechecks the originals, and validates the returned review receipt.
The callback may be asynchronous. This is an operation-local library API with no
CLI/MCP endpoint, provider dispatch, persistent receipt, or approval authority.

## Capture

`captureUiReview(absoluteRoot, requestJson)` returns an immutable, process-local
handle. The serialized request uses the shared strict JSON parser (64 KiB,
duplicate keys rejected):

```js
{
  schema: 'leerness.ui-review-observation-input/v1',
  input: completeUiReviewInput,
  files: [
    { taskId: 'T-ui', kind: 'source', path: 'evidence/source.bin' },
    { taskId: 'T-ui', kind: 'spec', path: 'evidence/spec.bin' },
    { taskId: 'T-ui', kind: 'diff', path: 'evidence/diff.bin' },
    { taskId: 'T-ui', kind: 'render', path: 'evidence/render.bin' }
  ]
}
```

Every UI task must have exactly one file for each of the four kinds and a
non-null declared digest. The packet must be ready (`packet-candidate`). Each
digest is `sha256:` plus the lowercase SHA-256 of the exact file bytes, including
BOMs, newlines, and non-UTF-8 data. A mismatch is rejected; the collector does not
replace the declaration to make it match. Multiple roles may explicitly select
the same path. Role assignment and completeness of the selected corpus remain
the host's responsibility.

Paths are relative, slash-separated, portable ASCII segments containing letters,
digits, underscore, hyphen or dot. Empty segments, `.`/`..`, trailing dots,
Windows device aliases, absolute paths, backslashes, spaces, colons and control
characters are rejected. Limits: 100 characters per segment, 32 segments, 1024
characters per path, 128 files, 1 MiB per file, and 8 MiB total captured bytes.
This initial path contract does not support arbitrary Unicode project filenames;
an authorized host can explicitly export evidence to portable filenames.

The collector validates membership before I/O, checks directories from the
explicit root through every selected parent, and reuses `memory-input` checked
reads. It rejects symlink/junction parents, non-regular or hard-linked files,
missing files, descriptor identity failures, read/close failures and observed
replacement. The existing bigint Windows device confirmation is preserved.
Each read stops at its assigned byte budget plus one sentinel byte; capture
and rechecks are separate bounded read passes. An unchanged pass contains at
most 8 MiB. A changed file fails its recheck before later files are read.

The handle exposes the packet, total byte count, task/kind/digest/length metadata
and a selection digest. It exposes no raw bytes or filesystem paths. The
selection digest hashes UTF-8 JSON of `[INPUT_SCHEMA, 'selection', resolvedRoot,
sortedSelections]`, where a selection is `[taskId, kind, relativePath, digest]`,
sorted by ASCII `taskId + '/' + kind`. It distinguishes roots and path choices
without changing the existing declaration-based packet ID. It is not a secret
or proof of repository identity. Original bytes and checked observations remain
in a WeakMap keyed by the exact handle; copying its JSON cannot recreate it.

## Observe one callback

```js
const handle = captureUiReview(absoluteRoot, JSON.stringify(request));
const result = await runUiReviewObservation(
  handle,
  JSON.stringify(currentUiReviewInput),
  async ({ packet, materials }) => {
    // Trusted host code: inspect the supplied bytes against packet.questions.
    // Each material has taskId, kind, digest, bytes (a private Buffer copy).
    return JSON.stringify(await hostReview(packet, materials));
  }
);
```

The callback is trusted host code, not an input string, sandbox, or installed
model adapter. It runs with the host process's authority; this library cannot
attest to its network, model or filesystem effects. The host controls provider
permissions, cancellation, timeouts, cost and retention. No automatic retry,
external call, subprocess, model selection, or default timeout is introduced.
The host may retain callback bytes; the collector neither persists them nor
guarantees erasure from process memory.

After validating the callback type the handle is consumed before any await. A
concurrent or later call needs a fresh capture. Current packet changes stop the
callback as `stale`; unchanged identity with failed current preparation stops it
as `needs-context`. Files and directories are checked again before and after
the callback. Replacement, changed metadata, missing files or unavailable reads
prevent receipt acceptance. Modification of any supplied Buffer also invalidates
the result. In all cases the original private bytes remain untouched.

The callback must return a serialized UIB-04A receipt. Existing five-subtype
coverage, task membership, execution declarations, findings and independence
rules are reused. In addition, each finding's `evidenceDigest` must equal a
captured file digest for the same task referenced by its coverage cell. An
arbitrary SHA-256 or another task's evidence is rejected. Scanner surface digests
are a different domain; a host must explicitly associate the surface with its
containing captured artifact before constructing a file-based receipt.

## Result and trust

Results use `leerness.ui-review-observation/v1` and include packet ID, selection
digest, random observation ID, material byte observations, host callback outcome
(`not-run`, `returned`, `threw`) and the existing assessment. `receiptValidated`
means schema and same-task evidence binding passed. `observed-review` means a
receipt was observed and validated, even if its assessment says `findings`,
`incomplete`, `self-review`, `stale`, or `not-reviewed`. Always inspect the
assessment. Callback return is not proof that semantic review actually occurred.

The collector's `materialBytes.captured/current` fields refer only to selected
bytes at the observation boundaries. The nested assessment retains its
`caller-declarations` trust and false verification fields. Source Git commits,
RB-02 manifest/policy/other aggregate digests, render origin, actual provider or
model identity, execution attempt ownership, semantic correctness and independent
review are **not authenticated**. Finding citation proves association with the
supplied bytes, not that the finding is correct. Missing real contributors cannot
be discovered from declarations.

The reads are check/recheck observations, not atomic directory-handle snapshots,
locks or a defense against arbitrary hostile code in the same process. Files
can change after the final check. Reports are ordinary immutable data, not
durable authorization receipts. Every approval/enforcement/auto-removal field
remains false. M-0019 durable/CAS/finalize and trusted dispatch/provenance adapters
remain separate prerequisites for independent semantic approval.

Errors use `UiReviewObservationError` and fixed `ui_observation_*` codes. Foreign
reader/parser/callback error messages and raw material paths/text are not copied
into reports. Caller-controlled task and criterion identifiers in the existing
packet should themselves contain no secrets.

## Verification

`node scripts/ui-review-observation-probe.js` exercises real isolated filesystem
reads, binary and size boundaries, path rejection, replacement and mutation,
async callback observation, stale input, same-task finding binding, redaction,
single-use handles, self-review and unchanged approval boundaries. Its callbacks
and identities are deterministic fixtures, not independent model reviews.

## Existing ledger correlation

[UI review ledger correlation](ui-review-ledger-api.md) checks single-task
implementation and review records against these byte observations and the exact
returned receipt. It preserves declaration trust and grants no approval.
