# Durable bound GET observations

The explicit observation journal preserves a validated [provider receipt](openai-ui-review-receipt.md) across process exit. It is a library API, with no automatic CLI polling or UI change.

Declare local observation retention as the optional **eighth** dispatch-preparation argument:

```js
const observationPolicyJson = JSON.stringify({
  schema: 'leerness.openai-ui-review-observation-policy/v1',
  retention: 'local-git-until-explicit-removal'
});
const preview = api.prepareOpenAiUiReviewDispatch(
  root, originalRunJson, observationRequestJson, currentInputJson,
  configJson, recoveryPolicyJson, receiptPolicyJson, observationPolicyJson
);
```

This requires the existing material-recovery and receipt policies, including `store: true`. The resulting v4 intent and approval digest bind the additional retention policy. Its HTTP request body is identical to the equivalent v3 receipt request. Existing v1/v2/v3 intents retain their contracts; local observation retention cannot be added to a dispatched request retroactively.

After approving and dispatching that exact preview, explicitly observe:

```js
const saved = await api.observeOpenAiUiReviewReceipt(
  root, originalRunJson, currentInputJson, originalProfileJson, apiKey
);
// In a new process, without credentials or a network request:
const recovered = api.recoverOpenAiUiReviewReceipt(
  root, originalRunJson, currentInputJson, originalProfileJson
);
```

| Situation | Behavior |
|---|---|
| No observation exists | `observe` makes one bound GET and validates the receipt against the original request, locator, owner, profile, materials and ledger. |
| Valid receipt | A canonical Git record is created with one UUID, the projected response and the observed ledger summary. Incomplete coverage remains incomplete. |
| Unresolved response | The safe unresolved observation is returned without writing a journal record. |
| Record already exists | `observe` and `recover` return the same UUID, record head, response/receipt digests and assessment without GET or POST. `observe` still requires writer admission; `recover` is read-only. |
| No record on recovery | `recover` returns `null`, after checking the original binding. |
| Invalid binding or record | The call fails. It does not fall back to a new request or silently ignore corrupt history. |

The existing `retrieveOpenAiUiReviewReceipt` remains read-only and always performs its explicit GET, including for v4 requests. It does not implicitly store an observation. For `observe`, Git dry-run, file dry-run and runtime compatibility are checked before GET. The API key is needed only when a new GET is necessary; it is never stored.

The journal ref is `refs/leerness/provider-observations/v1/<projectKey>/<sha256(runId)>`. Its commit has exactly one parent, the original response locator. Publication uses a create-only Git ref transaction that also verifies original control, intent, locator and attempt heads, and absence of a competing result or RunRecord. Owner, original material identities and ledger prefixes are checked around object creation and publication. Existing records can be read as history after subsequent result publication if the original owner and inputs still pass validation.

The complete canonical record is bounded to64KiB before object writes. A valid HTTP response close to its own64KiB limit can exceed the journal limit after metadata is added and is rejected as `observation_record_limit`. The projected response is stored once; receipt text and assessment are derived from it during recovery using the supplied, original current-input binding. Raw provider error bodies and unresolved output are not stored. Output can contain supplied project information: the explicit retention policy keeps it in local Git until an intentional removal operation. No expiry, automatic pruning or removal command is added here. Git object retention and garbage collection must be considered separately when removing refs.

Both the pre-dispatch ledger prefix and the entire prefix seen after GET remain binding evidence. A normal later append is permitted. Rewriting an event added between dispatch and GET is rejected even when the older pre-dispatch prefix is intact. Ledger/material file replacement also fails. Returning an old observation does not replace its original ledger summary with a new baseline.

An interruption before ref publication may leave unreachable Git objects and no observation; recovery returns `null`. After publication, a fresh process can recover the existing record. CAS races, lost acknowledgement or failed post-publication checks report `publication_uncertain`; they do not imply rollback. Explicit recovery inspects the ref. A subsequent `observe` returns a valid stored record without a new GET, or performs a new GET if none was published; it never repeats POST. Concurrent observers can each perform GET, but only one can create the journal ref. The loser must reconcile by reading the winner. Do not treat the absence of a journal as proof that no HTTP request occurred.

This is local Git history, not a signed provider attestation or a backup independent of the original intent, locator, attempt, material bundle and current files. A local actor able to rewrite all Git objects and source declarations is outside this validation boundary. Original owner/current-input/profile checks remain mandatory even for read-only recovery.

`ledgerLinked`, `runRecordRestored`, `actorIdentityVerified`, `semanticVerified`, `executionBindingVerified`, `approvalGranted` and `retryAllowed` remain false. The journal does not write a reviewer terminal event, publish an assessed result, retain a RunRecord, or grant final acceptance. Those are subsequent explicit operations. Its UUID identifies the observation, not an authenticated reviewer execution.

Verification:

```text
node scripts/openai-ui-review-observation-record-probe.js
node scripts/openai-ui-review-observation-probe.js
```

The complete journal envelope also has to pass the shared JSON parser's depth/node limits before object writes. A response may fit the HTTP parser yet exceed those limits when wrapped in the journal; this fails as `observation_record_invalid` without creating an unreadable record.

To connect a stored observation to its terminal event and existing RunRecord,
use [explicit result publication](openai-ui-review-publication.md). Observation
storage by itself still does not append a reviewer event or grant approval.

The first checks the pure canonical contract. The second uses actual temporary Git repositories, local TLS, fresh processes, process interruption, CAS races and acknowledgement loss. `--smoke` selects four integration cases; `--claim` executes the persistence/fresh-recovery case, and `--depth` isolates the journal-envelope depth boundary. No test calls a live provider or evaluates model review quality.
