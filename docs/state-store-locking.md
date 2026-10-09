# Shared state-store locking

The CLI and library use `lib/state-lock.js` for the same owner-token directory
lock. A module import does not dispatch CLI commands or start a coding agent.
The existing heartbeat, exclusive creation, bounded wait, no stale-owner
takeover, and token-specific release behavior are preserved.

The heartbeat is a worker thread that refreshes the owner file's timestamp about
once a second while a lock is held, including while the main thread is blocked.
The timestamp is a diagnostic liveness signal, never a takeover basis. Each touch
re-checks the runtime-write admission of the operation that holds the lock and
stops once that admission blocks (for example an incompatible descriptor, or a
repository created around the operation). It starts no Git process: before 1.36.288 it made
a new admission per touch, which ran `git rev-parse` in the project once per lock
and once per second.

`withStateLock(targetPath, fn, options)` runs a synchronous callback or holds
the lock until its returned Promise/thenable settles. A synchronous result
stays synchronous. `isStateLockHeld(targetPath)` reports ownership by the
current async context; it is a diagnostic, not a fencing token. Lock keys
normalize relative paths and Windows casing. Filesystem aliases such as
junctions are not resolved into a new general locking namespace.

Nested work in the same async operation can reuse its current owner token.
An unrelated caller in the same process receives `E_LOCK_BUSY` immediately:
synchronously waiting would prevent the original Promise from releasing.
After that operation finishes, the caller may explicitly try again. There is
no implicit queue or retry of application writes. Different processes retain
the existing bounded wait and `E_LOCK_TIMEOUT` behavior. The default wait is
35 seconds; callers of the low-level lock can set `maxWaitMs` explicitly.

Detached descendants cannot borrow a later operation's owner token. Nested
work also checks the stored token before entry. Work inside an admitted
callback must manage and await its own child operations; the lock is not a
scheduler for parallel branches deliberately started inside that callback.
External file edits and an owner forcibly removed by another actor are not
fenced. Do not interpret lock ownership as an atomic Git/filesystem commit.

The library respects the existing I/O dry-run guard before creating metadata.
The CLI retains its dry-run read path. No public mutable ownership map or test
override is exported. `stateLockDiagnostics()` returns copies of diagnostics.

Execution-ledger appends now take this lock by default. The legacy injected
`withLock` callback runs inside the real lock, rather than being the only
source of serialization. Its return value is not proof of a stored event.
`withExecutionLedgerLock(root, fn)` validates the ledger parent before lock
metadata creation and again after acquisition, and keeps one lock around
read/validate/append/read operations. Nested appends reuse that owner. Runtime,
file identity, malformed-history and file-synchronization checks still apply.

This change does not deduplicate terminal events, connect saved provider
observations to result records, grant reviewer independence, or approve a
review. Recovery after process termination preserves owner records and
uncertain ledger bytes; an aged owner is not automatically removed.

Run `node scripts/shared-state-lock-probe.js` for async-scope, CLI/library and
multi-process regressions. `--filter <substring>` selects focused cases and
zero matches fail. Existing selftest, runtime, workspace lock ordering,
ledger identity, storage and correlation suites remain relevant.
