# Review snapshot CLI and MCP transport

This is an unpublished development interface over the [pure snapshot binding contract](review-snapshot-api.md). It computes caller-supplied binding identities and differences. It does not inspect source files, persist records, verify evidence or actors, invoke models, change gates, or approve work.

## CLI

```sh
leerness review-snapshot candidate --stdin --json < snapshot-input.json
leerness review-snapshot compare --stdin --json < comparison-input.json
leerness review-snapshot --help
```

`candidate` accepts one `leerness.review-snapshot-input/v1` JSON document, as specified in the pure API guide. `compare` accepts exactly two properties containing complete inputs, not previously returned candidates:

```json
{
  "previous": { "schema": "leerness.review-snapshot-input/v1", "checkpoint": {}, "batch": {}, "materials": {} },
  "current": { "schema": "leerness.review-snapshot-input/v1", "checkpoint": {}, "batch": {}, "materials": {} }
}
```

The empty nested objects above illustrate the envelope only and are not valid domain inputs. Supply the complete checkpoint, batch and material fields defined in the pure API guide. Both sides are revalidated and recomputed; a supplied snapshot ID is not trusted as a prior receipt.

`--stdin` is required. `--json` is optional because successful evaluations and rejected input already produce one JSON document. Additional flags, repeated flags, positional file paths, `--path`, `--apply` and an approval operation are not supported. Help consumes no stdin.

Input must be piped UTF-8 without a byte-order mark. The limit is **65,536 bytes for the whole input**, including whitespace and both sides of a comparison, not 65,536 bytes per side. Malformed UTF-8, malformed JSON and duplicate keys (including escaped-equivalent keys) are rejected. Input has a total five-second read deadline, with bounded structural depth, node and array limits inherited from the checkpoint transport. The JSON response has a 65,536-byte limit.

Exit status 0 means evaluation completed, not that the source or work passed review. Rejected arguments/input return status 2 and a structured error. A broken output stream also returns status 2; a complete response cannot be guaranteed when the destination cannot accept it.

## Result and error contract

A successful response has `schema: leerness.review-snapshot-response/v1`, `ok: true`, `advisoryOnly: true`, `operation`, and `result`. The nested result is the existing candidate or comparison contract without a second assessment algorithm.

Even when `bindingState` is `unchanged`, `approvalReusable` is false, `sourceTrust` is `caller-supplied`, and `durability` is `not-persisted`. A comparison keeps `reviewValidity: unverified`. The material-change categories include batch, source, manifest, acceptance, policy, tasks, evidence, implementation attempts and dependencies. These are comparisons of supplied bindings, not proof that a digest matches real bytes.

Rejected input returns `ok: false`, `advisoryOnly: true`, and `error: { code, field, message }`. Codes distinguish invalid operations/arguments, comparison envelopes, JSON/UTF-8/BOM errors, duplicate keys, size/structure limits, stdin failures and domain validation. Errors do not echo arbitrary input keys/values or parser stack traces. Input errors must not be interpreted as an unchanged comparison.

## MCP

The full profile exposes `leerness_review_snapshot` with `requiredTier: read-only`:

```json
{
  "operation": "candidate",
  "inputJson": "<serialized complete snapshot input>"
}
```

For comparison use `operation: compare` and serialize the complete previous/current envelope into `inputJson`. Exactly these two string arguments are accepted; `path`, `sessionKey`, pagination cursors and approval fields are not part of this tool. The same UTF-8 byte and structural limits apply after JSON-RPC decoding. The JSON Schema character limit does not replace runtime byte validation.

The server evaluates this bounded input natively, after its existing tool/profile/permission checks, rather than passing it as a large subprocess argument. MCP returns one complete JSON text content item with `isError` set for rejected evaluation. It does not paginate or split the JSON. The core profile does not expose this tool.

## Verification

`npm run test:review-snapshot` runs the pure contract and transport probes. `npm run test:review-snapshot-transport` runs the transport independently. The latter covers actual CLI/MCP candidate and comparison calls in current, legacy and empty workspaces, strict errors, raw byte limits, descriptor validation, negative-control file snapshots, and file/process/network write tripwires. Existing checkpoint parsing and transport tests remain separate regression gates.

These tests do not establish independent model review, cross-host durability, finalization, supported CI success or release readiness. The future persistence/control/finalize and approval phases remain separate work.
