# Review snapshot binding candidates (RB-02 prerequisite)

`lib/review-snapshot.js` is a pure CommonJS API over bounded serialized JSON. It fingerprints caller-supplied review material bindings and compares two inputs. It does not collect source files, verify evidence, persist a record, accept a review, or authorize dispatch or release. This is not completion or activation of RB-02 storage/concurrency.

## API

```js
const {
  createReviewSnapshotCandidate,
  compareReviewSnapshotInputs,
  ReviewSnapshotInputError
} = require('./lib/review-snapshot');

// Both parameters are JSON strings supplied by the caller, not file paths.
const candidate = createReviewSnapshotCandidate(previousInputJson);
const comparison = compareReviewSnapshotInputs(previousInputJson, currentInputJson);
```

Objects and Buffers are rejected without coercion. JSON input is limited to 65,536 UTF-8 bytes. All envelope, batch and material fields are required; unknown fields are rejected. `checkpoint` reuses the existing [RB-01 input contract](review-checkpoint-api.md), including its bounded schema, task/criterion/dependency validation and Git/content reference rules. A null source snapshot or mixed objective is rejected. Valid incomplete or failed-verification task metadata remains representable: recording a failure must not turn it into a pass.

```json
{
  "schema": "leerness.review-snapshot-input/v1",
  "batch": {
    "id": "RB-orders",
    "revision": 1,
    "objectiveRevision": "acceptance-1",
    "policyRevision": "policy-1"
  },
  "checkpoint": "REPLACE WITH A COMPLETE RB-01 INPUT OBJECT, NOT THIS STRING",
  "materials": {
    "schema": "leerness.review-snapshot-materials/v1",
    "manifestDigest": "sha256:<64 lowercase hexadecimal characters>",
    "acceptanceDigest": "sha256:<64 lowercase hexadecimal characters>",
    "policyDigest": "sha256:<64 lowercase hexadecimal characters>",
    "evidenceDigest": "sha256:<64 lowercase hexadecimal characters>",
    "implementationDigest": "sha256:<64 lowercase hexadecimal characters>",
    "dependenciesDigest": "sha256:<64 lowercase hexadecimal characters>"
  }
}
```

The above is a shape illustration with explicit placeholders, not an executable fixture. The complete synthetic fixture is in `scripts/review-snapshot-probe.js`. Batch and revision labels use the RB-01 identifier syntax; `batch.revision` must be a positive safe integer. Every material digest is mandatory, even for an empty dependency/evidence collection. Unknown digests must not be replaced with an invented zero hash to obtain a candidate. This API can validate the syntax, not the truth, of the supplied digests.

## Bound material and stable identity

| Binding | Material included | Change reason |
| --- | --- | --- |
| Batch | batch ID and positive revision | `batch-changed` |
| Source | exact supplied Git base/head or non-Git content digest | `source-changed` |
| Manifest | versioned caller digest of exact change membership | `manifest-changed` |
| Objective | objective ID, criterion IDs, objective revision, acceptance-material digest | `acceptance-changed` |
| Policy | policy revision and policy-material digest | `policy-changed` |
| Tasks | every validated task field, including implementation/verification state, criteria, dependencies, risk, aspects and evidence references | `tasks-changed` |
| Evidence | caller digest of evidence collection and outcomes | `evidence-changed` |
| Implementations | caller digest of contributing implementation-attempt material | `implementation-attempts-changed` |
| Dependencies | external dependency IDs/status/revisions plus dependency-material digest | `dependencies-changed` |

Canonicalization sorts object keys, tasks/external dependencies by ID, and explicitly set-valued task lists. It does not sort arbitrary user documents or manifests. Each category's digest is domain-separated by schema and binding name; the candidate ID fingerprints those category digests. The format is a versioned local contract, not a claim to implement a general canonical-JSON standard.

Checkpoint `context`, `metrics` and `limits` are validated but excluded from **material identity**. Merely asking for review, accumulating waiting time or changing an advisory capacity limit does not alter the code or evidence already described. These properties still affect the separate RB-01 readiness assessment. Effective review/approval policy belongs in `policyDigest`/`policyRevision`; required task aspects are also bound. An event changing from task-report to release never authorizes reuse at that release target.

Source references are intentionally conservative. A changed Git head is reported even when the caller describes it as a record-only commit or the manifest digest is unchanged. Future verified source/record separation and final-tree/merge/rebase evaluation are outside this API. No change is silently treated as an approved delta.

## Material producer obligations — not implemented here

The producer must retain an exact, versioned manifest representation: path and old path, task membership, operation kind, mode, binary/blob or symlink content identities, gitlink/submodule revisions, generated files and relevant intermediate effects. It must not treat an arbitrary base..head range as proven batch membership. This module receives only the digest and **does not inspect or certify any of those details**.

Acceptance material must contain actual criterion definitions, not only stable labels. Policy material must include the effective review/independence/exception requirements. Evidence must bind exact test outcomes and scope, not just an exit-code summary. Implementation material must cover every contributing attempt and distinguish requested/configured identity from observed identity. Dependency material must bind the relevant contract/content revisions and their evidence. A version label alone is not proof that its contents are unchanged.

The exact original payload and referenced materials must be retained separately before any durable-finalize or cleanup claim. A hash-only candidate cannot reconstruct source or evidence, prove actor identity, replace an immutable RunRecord, or serve as a retained Git receipt. Digest producers, verified material readers, CAS/fencing, cross-worktree claims, durable storage/finalize and dispatch remain deferred.

## Output and change comparison

Candidates are recursively frozen in-memory metadata. They contain `snapshotId`, `bindingDigests`, batch identity, source kind and explicit limitations. They do not echo input documents or material contents.

Comparison rebuilds both candidates from their full validated input strings; it does not trust a claimed previous snapshot ID or accept a candidate object as a prior input. `bindingState` is `unchanged` or `changed`; `changedBindings` and `reasonCodes` report every changed category in a deterministic order.

Every output keeps:

```json
{
  "sourceTrust": "caller-supplied",
  "durability": "not-persisted",
  "approvalReusable": false,
  "effects": {
    "filesRead": false,
    "filesWritten": false,
    "networkUsed": false,
    "modelInvoked": false,
    "approvalGranted": false,
    "enforceChanged": false
  }
}
```

Candidates additionally mark source/manifest/evidence/actor verification false and review status `not-evaluated`. Comparisons keep `reviewValidity: "unverified"`, including unchanged results. Changed bindings signal that old material cannot simply be reused as the same snapshot; unchanged bindings are **not** a current approval, coverage check, independence check or release permission. Actual historical review validity is not assessed.

`ReviewSnapshotInputError` exposes stable `code` and safe `field` properties. Parser error messages and original values are not echoed. Direct calls to this pure API use the platform JSON parser's last-member semantics for duplicate members; producers must emit unambiguous JSON, and consumers must not use raw serialized text as an alternative identity. The [CLI and MCP transport](review-snapshot-transport.md) applies the shared checkpoint parser before calling this API and rejects duplicate keys, including escaped-equivalent spellings. No signature/author authenticity is implied.

## Validation and deployment boundary

Run `node scripts/review-snapshot-probe.js` for the pure contract or `npm run test:review-snapshot` for both the pure contract and read-only transport probes. The pure probe covers stable normalization, material changes, conservative source identity, failures/unknowns, invalid schemas/digests/references, bounds, immutable outputs, and denial of filesystem/process/network/clock APIs during library invocation. The transport probe exercises actual CLI and MCP calls, strict input envelopes, duplicate-key and UTF-8 errors, output errors, bounded responses, and preservation of current, legacy and uninitialized project fixtures. These are focused contract suites, not full E2E, a real reviewer, a full OS/Node matrix, or proof that every possible future material producer is correct.

The integrated implementation exposes `leerness review-snapshot candidate|compare --stdin [--json]` and the full-profile MCP tool `leerness_review_snapshot`. See the [transport guide](review-snapshot-transport.md) for command examples, argument and response schemas, and limits. These adapters reuse this pure contract and the RB-01 input transport; they do not add generated task/handoff/dashboard integration, durable storage, source verification, approval reuse or dispatch. Existing runtime layouts, rules, model settings and publication behavior are not changed. Local packaging/install tests are not npm publication. Public release still requires the source-of-truth/confidentiality policy and the usual explicit review and release gates.

## UI semantic review declaration contract

The [UI review API](ui-review-api.md) binds task-specific source/spec/diff/render digests to this snapshot and evaluates declared coverage, freshness and reviewer identity compatibility. It grants no authenticated review, approval reuse, or execution authority.
