# OpenAI UI review submission and response locator

This server-side, opt-in API binds one approved request to an existing UI review run and retains the response ID observed from its POST. It uses the existing control owner and durable attempt fence. It is not wired to automatic agent dispatch, CLI commands, final approval or RunRecord recovery.

```js
const {
  prepareOpenAiUiReviewDispatch,
  dispatchOpenAiUiReviewRun,
  readOpenAiUiReviewDispatch,
  retrieveOpenAiUiReviewDispatch,
} = require('leerness/lib/openai-ui-review-dispatch');

// All values come from an explicitly configured trusted host. No ambient key,
// default account/model or automatic spending approval is selected by Leerness.
const preview = prepareOpenAiUiReviewDispatch(
  root, runInputJson, observationRequestJson, currentInputJson, configJson,
);
// Present the preview and selected materials to the authorized operator first.
const result = await dispatchOpenAiUiReviewRun(preview, approvedRequestDigest, apiKey);

// A later process uses the ORIGINAL run input and the same declared profile.
const history = readOpenAiUiReviewDispatch(root, batchId, runId);
const observation = await retrieveOpenAiUiReviewDispatch(root, runInputJson, profileJson, apiKey);
```

The config JSON has exactly `provider: "openai"`, `profile`, `model`, `maxOutputTokens`, `timeoutMs`, and `store`. The profile has exactly `profileId`, `profileRevision`, `projectId`, `organizationId` (explicit `null` means omitted organization). Profile fields use 1–128 ASCII letters/digits/underscore/hyphen. Model is 1–256 ASCII letters/digits/`._:/-`; output cap is an integer 1–32768; the whole HTTP deadline is an integer 100–15000 ms. `store` must be an explicit boolean. No monetary price ceiling is inferred from the token cap; the host must enforce its own budget and authorization before calling dispatch.

Preparation is read-only and returns a frozen opaque handle with the request/body digests, byte size, configuration, packet and material metadata. A JSON copy is not a handle. It captures one task's actual source/spec/diff/render bytes using the existing checked file reader. Text must be UTF-8; render must have a PNG/JPEG signature and is embedded as a data URL. Signature detection does not decode/validate the entire image or authenticate its origin. Each material remains limited to 1 MiB; the encoded request is limited to 4 MiB. The exact captured body is sent with a fixed review instruction, `background: true`, the explicit storage/output settings and no tools. Caller material remains untrusted data.

The trusted host passes the exact preview `requestDigest` only after obtaining authorization. This local digest check does not authenticate a human approval or account identity. Files and current control are rechecked before the existing execution fence. The handle is consumed before asynchronous execution. There is exactly one fixed-host HTTPS POST to `/v1/responses`, with no redirect, retry, automatic polling, cancellation, remote image fetching or tool execution. HTTP responses use the same bounded TLS/UTF-8/strict JSON reader as [stored response retrieval](openai-response-retrieval.md). A rejected POST response or missing ID remains unresolved; it does not authorize another POST.

The official [create API](https://developers.openai.com/api/reference/resources/responses/methods/create) returns a Response whose ID can be retrieved later. Background responses may use explicit `store: false` with temporary polling retention; durable availability depends on storage and account policy. Leerness does not promise an expiry duration or ZDR compatibility from a local fixture. See the [background guide](https://developers.openai.com/api/docs/guides/background) for the provider's current retention rules.

| Durable state | Meaning and allowed continuation |
| --- | --- |
| No dispatch intent | No local POST evidence. A separately existing attempt may still prohibit execution. |
| Reserved attempt + intent | The exact approved request/config is retained, parented to the reserved attempt. An identical reservation can reach the execution fence; a changed request cannot replace it. |
| Execution unknown, no locator | The fence was consumed. Execution may or may not have reached the provider. Do not repeat POST or invent another run/response ID to bypass uncertainty. |
| Response located | The actual adapter accepted a bounded provider response and stored its ID/status/model/time, parented to the original unknown attempt and referencing the exact intent. This is historical local evidence. |
| Lookup observation | One GET using the retained response ID/project/organization. Original current owner, profile revision, control and journal heads must still match before and after the GET. Output is a candidate, not a validated review receipt. |

Intent refs are `refs/leerness/review-dispatches/v1/<projectKey>/<run-hash>`; locator refs are `refs/leerness/review-locators/v1/<projectKey>/<run-hash>`. They use canonical bounded Git records and create-only transactions. No separate mutable database is created. By default, only request metadata and digests are retained; raw credentials, material bytes and response output are not journaled. An explicit sixth recovery-policy argument opts into [original material and ledger baseline recovery](ui-review-recovery.md), retaining material blobs under a v2 intent through an additional parent bundle. Credentials and response output remain excluded. Ref publication errors are uncertain even when publication actually happened; a new read validates ancestry and bindings. A late acceptance after owner reclaim may be saved as history, but lookup under the old owner is denied. Linked worktrees share historical refs but cannot impersonate the original owner.

There is no exported locator writer accepting caller-supplied response JSON. The internal submission operation validates the stored intent and exact body, consumes its reserved attempt, performs its own POST and privately publishes the observed locator. Calling it with an already consumed attempt cannot issue another POST. This boundary does not sandbox trusted host code that can monkey-patch modules or directly modify Git.

Profile identity/revision is a trusted-host declaration, not provider-authenticated actor identity. A rotated key may be supplied only under the host's unchanged declared scope; changing profile revision/account selection requires a separately authorized workflow. No key hash is treated as a universal principal. Provider-requested scope and returned model/status do not certify independence. All approval, semantic/actor identity, retry, cleanup and execution-authentication flags remain false.

`retrieveOpenAiUiReviewDispatch` accepts no response ID or alternate scope override. It is read-only; missing/expired/denied/timed-out retrieval stays unresolved. It does not append ledger events, reconstruct vanished capture handles, turn output into a review receipt, or retain a RunRecord. The separate opt-in recovery API restores material and ledger comparison evidence. Receipt validation, original callback/reviewer-event linkage, accepted-policy and final exact-target gates remain separate work.

Validation: `node scripts/openai-ui-review-dispatch-probe.js` uses real temporary Git repositories, child-process interruption/races and loopback TLS with a test-local request bridge. `--smoke` selects a bounded installed/compatibility subset. No production endpoint or credentials are used by these probes.

## Optional typed receipt observation

An explicit seventh receipt-policy argument requests a bound UI receipt and enables read-only receipt validation during an actual GET. See [provider receipt observation](openai-ui-review-receipt.md) for policy admission, exact model matching, legacy compatibility and incomplete-review outcomes. Existing default requests remain unchanged.

An optional eighth policy binds local retention of validated bound GET observations to a v4 intent. Its explicit observe/recover APIs preserve a stable record across process exit. See [durable observations](openai-ui-review-observation.md). Existing GET APIs remain read-only.
