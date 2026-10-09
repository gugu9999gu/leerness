# Review control: local Git storage and revision CAS

RB-02D implements an opt-in library for a review batch's owner generation and
snapshot bindings. It reuses the state-path resolver, runtime writer admission,
Git gateway and existing review-snapshot validator. It does not activate a new
runtime layout, dispatch a provider, approve a review or authorize cleanup.

## API

```js
const {
  INPUT_SCHEMA, createReviewControlToken, readReviewControl, writeReviewControl
} = require('leerness/lib/review-control');

const root = '/absolute/existing/project';
const batchId = 'RB-ui';
const owner = { sessionId: 'session-1', token: createReviewControlToken() };
// Keep the token privately so the same operation can be retried after a crash.
const request = {
  schema: INPUT_SCHEMA, operation: 'claim', batchId, operationId: 'claim-1',
  expectedHead: null, generation: 0, owner, snapshot: null
};
const claimed = writeReviewControl(root, JSON.stringify(request));
const observed = readReviewControl(root, batchId);
// publish: expectedHead=observed.head, generation=observed.generation,
// a new operationId and snapshot=<complete review-snapshot-input/v1>.
```

Input is exact, serialized JSON of at most 64 KiB. Unknown/duplicate fields, BOM,
invalid identifiers, tokens, generations and snapshot envelopes fail before I/O.
Root must be absolute. Batch/operation/session identifiers are 1–80 ASCII characters
from the existing snapshot identifier grammar. Token is 32 random bytes in lowercase
hex; only its digest is retained. Never place a real token in logs or shared records.

Every command requires `schema`, `operation`, `batchId`, `operationId`,
`expectedHead` (null or full SHA-1/SHA-256 Git object ID), `generation`, `owner`
and `snapshot`. The owner has exactly `sessionId` and `token`.

| Operation | Preconditions | Change |
| --- | --- | --- |
| claim | Unowned batch, exact head and current generation; absent means null/0 | Advance owner generation and record session/token/worktree digests |
| publish | Matching owner, current generation and head; snapshot batch ID matches | Retain snapshot ID, nine binding digests, batch revision and publishing generation |
| release | Matching owner, generation and head | Clear active owner; preserve snapshot and history |
| reclaim | Batch is owned, exact head and generation; explicitly requested by trusted host | Replace owner and advance generation; former owner cannot publish or release |

`snapshot` is null except for publish. A subsequent snapshot must advance the
previous published batch revision; a new claim does not reset it. Policy/task/source
bindings come from the existing candidate validator. The full normalized snapshot
input, including metrics excluded from candidate identity, contributes to the
operation digest. Raw source/spec/render bytes and criterion text are not stored.

There is no TTL or automatic takeover. Reclaim is a privileged host operation,
not provider authentication or a claim that the previous process has stopped.
It fences subsequent **store writes** only; it cannot cancel an already running
external request. The caller is responsible for authorizing reclaim and retaining
its private token. Session/model names never grant authority.

## Publication, replay and recovery

The Common-Control backend uses one ref per project/batch:
`refs/leerness/review-control/v1/<projectKey>/<batch-id-sha256>`.
The existing project key groups the same relative project across linked worktrees
and separates monorepo subprojects. This is an explicit Git-ref backend for that
scope; it does not also write the proposed directory-based JSON control store.
There is no second task database or legacy task-state conversion.

Each operation writes a bounded JSON blob, a tree containing only `record.json`,
and a commit with the previous control commit as parent. It then publishes through
`git update-ref --no-deref <ref> <new> <expected-old>`. Only the winner of that CAS
can become current. Symbolic control refs and malformed records are refused.
Git plumbing passes the existing dry-run and fresh runtime-write checks, including
the actual ref update. Object and reference fsync are requested per invocation;
the repository's persistent settings, source branch, index and files are unchanged.

Same operation ID and same normalized request replay without writing, even after
later revisions. A different request under the same ID is `idempotency_conflict`.
Replay returns the current state plus the original `operationRevision`, not a new
approval or a restoration of the old owner. The current record retains all operation
digests, bounded at 128 operations per batch. At that limit new writes fail with
`history_limit`; there is no silent eviction or implemented rollover.

Before CAS, process interruption may leave unreachable Git objects but no published
state. After CAS, a lost response can be reconciled by replaying the exact request.
`publication_uncertain` means the caller must read/replay that request before doing
anything else. It is not a rollback receipt. The implementation does not delete
Git lock files, prune orphan objects or retry an external invocation.

Git's CAS and hardening behavior are described in the official
[update-ref documentation](https://git-scm.com/docs/git-update-ref) and
[core.fsync documentation](https://git-scm.com/docs/git-config#Documentation/git-config.txt-corefsync).
Configured Git hooks remain host-controlled; the library is not a hook sandbox.

## Evidence and limits

Output schema is `leerness.review-control/v1`. It includes `head`, `revision`,
`generation`, active owner session/worktree digest, optional snapshot, `applied`,
`operationRevision` and `retention: local-git-ref | absent`. Token and token digest
are omitted from the public projection. A read returns one observed immutable
revision; another writer can advance it immediately afterward.

`local-git-ref` means actual locally retained Git objects reachable through this
ref. Parent history survives normal Git GC while the ref is retained and can be
explicitly transferred with that ref. It is not an accepted source revision,
remote backup, audited RunRecord finalize receipt or proof against power loss.
Ordinary branch clone/push does not promise to include this custom ref. No transfer
or remote command is performed by this API. Losing/deleting/resetting the control
ref outside this API can defeat its history and fencing; Git write access is a
trusted-host boundary, not a hostile-writer security boundary.

Source/evidence/policy correctness, actual actors and semantic review remain
unverified. `actorIdentityVerified`, `approvalGranted`, `runtimeActivated` and
`cleanupAllowed` are false. Persisting a digest is not execution authorization.
This is a batch-control slice; repository-wide task claims, accepted policy
activation, general ControlStore migration, immutable RunRecord finalization and
RB-03 authorized dispatch remain separate unfinished work.

Only Git-backed local filesystems are in scope. Non-Git fails `git_required`
without creating an alternate backend. Unsupported/damaged Git and unrecognized
workspaces fail closed. SHA-1 and SHA-256 object IDs are supported. Aliases resolve
through the existing canonical topology reader; cloned repositories/other hosts
have independent control. Path rechecks are cooperative observations and do not
provide directory-handle fencing against hostile filesystem replacement.

On Windows a path has at most 259 characters unless Git's `core.longpaths` is on.
Control refs (`refs/leerness/<family>/v1/<projectKey>/<64 hex>`) have up to 176
characters, so in a deep project folder Git without it can neither lock a ref whose
lock file path reaches 260 characters nor read one whose file path does. Before such a
call, the user's own Git is asked to read a ref name of the same path length that
Leerness never creates (`git symbolic-ref -q`, which writes nothing); if it cannot,
the call fails
`git_long_paths_required` before Git runs and writes no ref. Because Git answers
itself, this follows how it combines configuration levels, the reftable format and the
path spelling it uses. Turning `core.longpaths` on (`git config core.longpaths true`,
with Git for Windows; in Git for Windows 2.54.0 a global `false` wins over the
repository's `true`) makes those calls work. Git calls add no long-path option of their
own: a ref written that way would be one the user's own Git cannot read, and
`git log --all`, `git fsck` and `git gc` would fail in that repository. Refs of
different families differ in length, so in a narrow range of folder depths a flow can
stop partway: its earlier refs fit and a later, longer one does not.

Errors are fixed `ReviewControlError` codes without input values, raw paths or Git
stderr: `input_invalid`, `root_invalid`, `git_required`, `workspace_unrecognized`,
`git_long_paths_required`, `store_unavailable`, `git_failed`, `git_output_invalid`, `ref_invalid`,
`record_invalid`, `record_limit`, `topology_changed`, `idempotency_conflict`,
`history_limit`, `stale_generation`, `owner_mismatch`, `claim_state_conflict`,
`snapshot_not_advanced`, `revision_conflict`, `publication_uncertain`,
`E_DRY_RUN_WRITE` and `E_RUNTIME_LAYOUT_INCOMPATIBLE`.

Run `npm run test:review-control` for real local repositories, linked worktrees,
competing processes, killed processes before/after CAS, recovery, stale owners,
dry-run and late runtime rejection, corrupt/symbolic records, SHA-256 and local
GC/transfer controls. Synthetic actors are not live independent model reviews.
