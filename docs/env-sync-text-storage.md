# Environment example sync storage

`env sync` appends missing names with empty values to an existing `.env.example`. The private `.env` is a read-only reference: its values are neither copied nor included in results. The shared key parser retains its existing case, ordering and grammar; this change does not add a full dotenv parser or create a missing example file.

The mutation captures the example under its canonical file lock and strictly reads both inputs as UTF-8 with a 4 MiB limit per file. It preserves the example's existing bytes, Unicode, signature, comments and values. Added lines use the first existing LF/CRLF format, or LF if none exists. Captured inputs are rechecked before publishing through the existing managed-text writer. Malformed, oversized or detected stale inputs fail without claiming success.

An absent private source or already covered names remain no-ops. Dry-run performs checked observations without creating lock metadata: a no-op succeeds; a required write fails without saving. Normal mutations retain runtime write restrictions. Concurrent cooperating sync/audit writers share the example-file lock.

Failures identify the file and stage. Available publication flags and recovery paths are retained in human and JSON error reports, including a lock-release failure after a completed save. A partial publication error must not be interpreted as rollback. Successful output retains the existing names-only report; this does not introduce a new JSON success schema or MCP sync tool.

The checks do not reserve the private source against every possible external change, repair existing damage, detect every secret, change read-only `env check`, or protect every Leerness writer. The checked inputs and publisher provide the documented boundaries, not a two-file transaction. See [shared storage behavior](managed-text-storage.md).

Run `npm run test:env-sync-text` for actual CLI checks in isolated homes and temporary projects. All values are synthetic. The suite covers preservation, invalid input/output, stale source/target, creation and dry-run contracts, runtime restrictions, no-op behavior, concurrent sync and partial-save reports.
