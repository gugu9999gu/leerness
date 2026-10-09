# Publish a saved review result

This explicit library operation connects a stored bound GET observation to one
review terminal event and the existing result journal. It makes no HTTP requests
and never uses caller JSON or a callback as the stored observation.

```js
const publication = require('leerness/lib/openai-ui-review-publication');
const runs = require('leerness/lib/ui-review-run');
const preview = publication.prepareOpenAiUiReviewPublication(
  root, originalRunJson, originalCurrentInputJson, originalProfileJson,
  JSON.stringify({
    schema: publication.POLICY,
    observationHead: savedObservation.recordHead,
    reviewOfAttemptId: 'the-explicit-original-contributor-attempt',
    retention: 'local-git-until-explicit-removal'
  })
);
// Present the exact preview and obtain authorization for its publicationDigest.
const published = publication.publishOpenAiUiReviewResult(preview, approvedDigest);
// Retention is a separate explicit operation, using the existing run API.
const retained = runs.retainUiReviewRun(published.runHandle);
```

Preparation is read-only. The opaque preview binds the original run, observation
head/digest, intent, locator, attempt, receipt, explicit implementation parent and
retention policy. A copied JSON preview is not a valid publication handle. This
is a separate local-record approval after observation; it does not alter existing
v1–v4 dispatch policies or retrospectively authorize another provider request.
The parent must be a member of the original contributor set, even when there is
only one contributor. No first-contributor default is selected.

Publication checks file/Git dry-run and runtime compatibility before writes. It
re-reads the original journal, owner, materials, pre-dispatch baseline and GET-time
prefix. Under the shared execution-ledger lock it checks for conflicts, appends
one `review.completed` event, verifies the stored event and creates the result
ref. Result CAS additionally verifies the original control, observation, intent
and locator refs. The existing result API's default late-outcome behavior remains
unchanged for other callers.

The event ID is `review-observation-<stored observation UUID>`. The original
review attempt, declared provider/model/session, exact receipt digest, material
digests, packet/selection, implementation event refs, observation record digest
and publication digest must match. Only `execution: completed` receipts can be
linked. Findings and inconclusive coverage remain in the receipt and assessment;
linking is not a clean review or approval. Identity labels remain declarations,
with all identity, independence, semantic and acceptance authority flags false.

The first append records the local write time. Repeated publication validates and
reuses that same event and timestamp. Another terminal, changed parent, changed
content, reused event ID or conflicting result fails. The stored event is
resynchronized through its checked file descriptor before a retry can report
publication success; retries do not append the event again. Capacity is checked
against the correlator's 1 MiB/2000-event limits before a new event is written.

RunRecord bytes use the prefix ending at the terminal event's newline. Later
unrelated appends therefore do not change the result digest. The original stored
observation UUID is retained. A fresh process can use `recoverUiReviewRun` and
explicit `retainUiReviewRun`, or prepare/publish again to reconcile existing
storage. Publication itself does not create the retained RunRecord ref; the
returned `runRecordRetained` reports existing retention observed during the call.

Git and JSONL are separate storage boundaries. Append or ref acknowledgement can
be lost after writing. Errors do not imply rollback. Re-read the actual journal
and ledger before an explicit retry; never resend POST, delete uncertain bytes
or silently overwrite a conflict. A process killed while holding the ledger lock
leaves an owner record: the shared lock refuses automatic takeover. Operator
recovery requires establishing the previous owner has ended. No lock-recovery
command, directory durability guarantee or physical power-loss guarantee is added.
External filesystem edits and actors able to rewrite all local Git history are
outside fencing guarantees. Owner, original input/profile and material checks
still apply; old history is not permission to write after ownership changes.

Verification uses real temporary Git stores, loopback TLS, fresh processes,
concurrent publication, interruption and injected I/O/CAS failures:

```text
node scripts/ui-review-publication-probe.js
node scripts/ui-review-publication-probe.js --smoke
node scripts/ui-review-publication-probe.js --filter "lost append"
```

Zero matching tests and invalid flags fail. No test calls a live provider or
measures the quality or independence of a model's review.
