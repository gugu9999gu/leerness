# Memory input and output preflight

This bounded correction builds on the syntax-guard ordering fix in 1.36.189.
It is not the full memory-admission or runtime-migration design.

## Input boundary

Decision add/drop, lesson save/drop and decision/lesson restore check an existing
canonical JSON root under their existing canonical operation lock. An existing
non-array JSON value fails with `store_invalid` in CLI JSON mode; invalid JSON
syntax continues to fail with `store_corrupt`. Null, false, zero and empty-string
roots are not missing files. A missing canonical file retains the existing legacy
Markdown fallback. Read-only loaders are unchanged.

The two canonical save functions apply the same guard as defense in depth.
Their existing migration-backfill callers still support absent canonical files.
This is root-array validation, not item-schema validation. It introduces no new
ID/date requirements, UTF-8 rules, file size limit or coercion of individual items.
It does not turn the existing file-existence/read checks into a filesystem snapshot
or guarantee protection against external writers between observations.

## Output boundary

The save functions serialize canonical JSON and render Markdown before writing
either file. Drop also prepares its archive content and the survivors' outputs
before the first domain write, then keeps the existing archive → JSON → Markdown
write order. The same prepared output is used for writing; it is not re-rendered
after archive append. A serializer/renderer error cannot leave an archive entry or
canonical update from these add/save/drop preparation paths.

Existing file I/O and locking remain in place. A later I/O failure can still cause
a partial update: several writes are not a transaction. Restore still has its
historical active-Markdown append/reparse behavior; save pre-rendering does not
retroactively make the whole restore operation write-free on every error.

## Verification and limits

The CLI regression probe covers invalid roots with normal/duplicate/forced adds,
drop and restore; failed add/save rendering; failed survivor rendering during
drop; normal changes; canonical survivor values/order/extension fields; legacy
fallback/backfill; and the original syntax-error code. Rejected cases compare a
declared set of domain files by presence, bytes and mtime. That set is not a claim
that every CLI startup/cache/presence/lock file remains unchanged.

Run `npm run test:memory-input`. Installed-package verification also executes the
packaged probe. Each actual subprocess has bounded timeout/output and must exit
without a launch error or signal; a missing or empty final verdict is a failure.

Still pending: lossless raw JSON/Markdown preservation, removed/restored extension
fields, canonical-authority restore, Markdown-only producer reconciliation, MCP
structured error-code parity, item/encoding/size policies, multi-file recovery,
worktree-private runtime, repository-common control and durable finalize. Passing
this probe does not certify those contracts or real provider-to-provider sessions.
