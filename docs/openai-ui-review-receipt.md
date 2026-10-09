# Bound provider receipt observation

This explicit library path requests the existing UI receipt format and validates a receipt obtained by an actual stored-response GET. It builds on [dispatch](openai-ui-review-dispatch.md) and [original-input recovery](ui-review-recovery.md). It does not write a reviewer event, publish a result journal, restore a RunRecord, or grant approval.

Pass this optional **seventh** argument to `prepareOpenAiUiReviewDispatch`:

```js
const receiptPolicy = JSON.stringify({
  schema: 'leerness.openai-ui-review-receipt-policy/v1',
  modelMatch: 'exact'
});
const preview = api.prepareOpenAiUiReviewDispatch(
  root, originalRunJson, observationRequestJson, currentInputJson,
  configJson, recoveryPolicyJson, receiptPolicy
);
```

The sixth argument must declare original-material recovery. Configuration must explicitly set `store: true`; the reviewer attempt must fit the existing receipt's 1–80 character identifier. Existing v2 recovery still accepts its previous 1–128 character range. No identifier is truncated or renamed. Use a model identifier supported by the existing UI identity contract. The request model, POST response model, GET response model and receipt model must match exactly. Alias expansion or model-version normalization is not provided.

The resulting v3 intent includes `receiptPolicy` in the approval digest. Its body instructs the provider to return one `leerness.ui-review-receipt/v1` document, with the original packet and reviewer attempt, all five UI-boundary questions, and task/subtype coverage. The declared reviewer is `{provider: "openai", model: <request model>, sessionId: null}`: no provider session identity is invented. The body uses ordinary instructions; it does not enable a provider structured-output feature or certify that any model will follow them. The original material-retention policy and its privacy consequences still apply.

After approval and dispatch, explicitly retrieve:

```js
const observation = await api.retrieveOpenAiUiReviewReceipt(
  root, originalRunJson, currentInputJson, originalProfileJson, apiKey
);
```

This performs at most one GET, with no automatic polling or POST retry. It validates the original run/owner/profile, intent/locator/attempt heads, current input digest, original material identities and original ledger prefix before and after the GET. Normal append-only ledger growth is allowed; the old prefix remains the baseline. Replacement, truncation and changed original bytes fail. A changed local boundary throws a bounded control error and returns no receipt. The original v1/v2 generic retrieval API remains available, but old requests cannot be upgraded to this receipt contract after dispatch.

Only one completed assistant `message` containing one `output_text` is supported. Tool or reasoning items, multiple messages/text parts, empty output and refusal are not silently concatenated or treated as a receipt. The complete HTTP response remains bounded to64KiB by the existing transport; receipt JSON additionally uses the shared16-level/10,000-node/1,000-array-item parser limits, duplicate-key detection and64KiB input bound. UI coverage/finding counts use the existing domain limits (single task, five subtypes, maximum32 findings).

| Outcome | Meaning |
|---|---|
| `receipt-observed` | A structurally valid receipt matches the original packet, reviewer attempt, declared model/provider, and cited task-material digests. Check `assessment` separately. |
| `assessment.state: incomplete` | Coverage is missing/inconclusive, or declared review execution is partial/failed. Receipt observation does not imply full review. |
| `assessment.state: findings` | The receipt contains valid bound findings requiring review. |
| `unresolved` | Non-completed response, refusal, unsupported output shape, response binding mismatch, invalid receipt or transport failure. `receiptJson` and `receiptDigest` are null. |

The response includes original request/packet/selection identifiers, intent/locator/attempt heads, original ledger summary, receipt text and its exact UTF-8 digest when validated. `responseDigest` hashes the stable **projected response** returned by the transport, not the raw HTTP body. `provenance: bound-get-in-current-process` records this process's observation path; serializing or copying it does not create a reusable authority capability. Invalid output text, raw provider errors and credentials are not copied into failure results.

`ledgerLinked`, `runRecordRestored`, `actorIdentityVerified`, `semanticVerified`, `executionBindingVerified`, `approvalGranted` and `retryAllowed` remain false. The independent-review field remains `not-verified`. Ledger declarations and model strings are not identity authentication. This read-only result is an observation in memory. New v4 requests can explicitly opt into [durable observation retention](openai-ui-review-observation.md) and use its separate observe/recover APIs. Reviewer-event correlation/writing, result-journal publication, explicit RunRecord retention and final acceptance remain separate work.

Verification commands:

```text
node scripts/ui-review-provider-receipt-probe.js
node scripts/openai-ui-review-receipt-probe.js
```

The first is a pure contract test. The second uses actual temporary Git repositories, a fresh process and local TLS with the existing fixed-host transport assertion. It makes no live provider call and is not a measurement of model review quality.
