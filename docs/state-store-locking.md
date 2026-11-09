# Shared state-store locking

The CLI and library use `lib/state-lock.js` for the same owner-token directory
lock. A module import does not dispatch CLI commands or start a coding agent.
The existing heartbeat, exclusive creation, bounded wait, and token-specific
release behavior are preserved. Age alone never reclaims a lock that has an owner
record; an empty folder has no owner and is removed after 30 s. A lock whose owner
is proven dead is reclaimed on that proof, never on its age (see "Dead-owner
reclaim" below).

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
uncertain ledger bytes. Reclaim removes the dead owner's lock record and folder,
and a leftover second name of a published file (see "Dead-owner reclaim"); it
never removes ledger bytes.

## Dead-owner reclaim

A process killed while it holds a lock leaves its owner record. A waiter that has
waited 250 ms looks at the lock, and takes it over only when every condition holds.
Any other result means do not reclaim:

1. The lock is a real folder, not a link or junction, with exactly one
   `owner-<token>.json` that is a regular file of at most 4,096 bytes.
2. That file was last touched 5 s ago or more. The heartbeat touches a live
   holder's file every second, so a waiter behind a working holder stops here and
   never opens the file. The time only blocks a reclaim; it never allows one.
3. The record parses, its token equals the file name, it is version 2 with host
   and PID-scope identities, this process has the same two identities, and the
   host name is the same.
4. `process.kill(pid, 0)` fails with `ESRCH`. Success, `EPERM` or any other error
   means live or unknown.
5. Nothing is kept for recovery. The owner record has no `keepOnCrash` field
   (memory-migration apply and rollback set it, because a prepared bundle looks
   the same whether or not apply started), and for `progress-tracker.md` the
   history journal is neither pending nor unreadable.
6. No file was moved aside by an unfinished save. In the target's folder no
   `.<name>.publish-cas-*` or `.agent-roles-cas-*` folder holds `before` while
   its file is missing, and no `.leerness-write-<owner pid>-*` folder (in the
   mutation-recovery folder or the target's folder) holds both `next` and `before`.

Reclaim first finishes the dead writer's last step. A publish links the new file
into place and then removes its temporary name; a kill between the two leaves a
complete file with two names, which every checked read refuses. If a temporary name
of the dead process is the same file as its live name, that name is removed and no
bytes change. A `next` file inside a scratch folder `.<name>.publish-cas-*` counts
only when the scratch path is a real folder, never a link, because through a link
it could name a file outside the store's folder. That name carries no PID, so it
can belong to a live publish of another store in the folder; that publish's detach
tolerates the name being gone. The worst case is therefore one
extra name of a file that the store's own folder holds, never a name elsewhere and
never bytes. A name that is not provably the same file (same device, non-zero
inode) stays. Then reclaim deletes only the dead owner's record, removes the
folder (which succeeds only when empty), and takes the lock through the normal
path. A lock left by a kill clears about 5 s after the kill for a waiter that was
already waiting, and after about 250 ms for a writer that arrives once the 5 s have
passed. Callers with a shorter `maxWaitMs` fail as before, with the dead-owner text.

The waiter whose `rmdir` removed the folder prints a notice on stderr with the PID,
unless `LEERNESS_NO_LOCK_WARN=1`; a reclaim that met a new owner's file prints
nothing. The notice is not promised to appear exactly once. On Windows more than one
process can unlink the same file at the same moment (measured with a bare
`fs.unlinkSync` from four processes, Node 18, 20, 22, 24 and 26), so more than one
waiter can get past the unlink, and each one whose `rmdir` removes a folder prints.
One of them can remove the empty folder a new holder has just made. If the folder
has simply gone, that holder goes round again instead of failing, and it does not
remove whatever folder is at the path afterwards, because that folder is no longer
its own. If another process has already made a new folder there, the creation check
fails that one write cleanly and a retry succeeds (limit L12). No check by the
second waiter can tell the two folders apart. What holds in every case is that
there is never a second holder. The notice appears at least once for a reclaim that
cleared the folder. The owner record is not preserved; the notice carries the PID.

A lock is created by writing the owner record complete under
`<store>.tmp-<pid>-<n>` beside the lock folder (a name `lib/runtime-layout.js`
already admits for a store file) and renaming it into the folder. A kill in the
creation window therefore leaves an empty folder, which clears by itself after 30 s,
or a complete owner record, never a zero-byte or partial one. A kill between the
open and the rename leaves the temporary file, which blocks nothing and is safe to
delete. If a step fails without a kill, the attempt removes its temporary file.

A failed acquisition now names the lock path and the next step, and sets
`err.lockState` to the reason (`dead-owner`, `live-owner`, `empty`,
`kept-for-recovery`, `displaced-target`, `malformed-owner`, `legacy-owner`,
`legacy-file`, `unexpected-entries`, `other-host`, `unknown-identity`, `link`,
`unreadable` or `gone`). `leerness verify` and `leerness init` report remaining
locks through the same classifier without changing them. A lock in the stuck group
below cannot clear by itself and fails verify with its next step; `--json` adds a
`locks` object.

What the scan counts:

- The workspace folder is walked first, to depth 8 and skipping its archive
  folder, with an entry budget of 20,000 of its own. Then the project folder and
  its other top-level dot folders are walked to depth 3 with a second budget of
  20,000, so a large project folder cannot hide a lock in the workspace. A budget
  that runs out sets `locks.truncated` and prints a line; that is advisory and does
  not fail verify. The scan skips the folders the secret scan skips and nested
  repositories, and it does not follow links.
- A `*.lock` folder counts inside the workspace. Outside it, it counts only if it
  holds a file named exactly `owner-<32 hex>.json`, so `.foo/a.lock/owner-x` does
  not.
- A `*.lock` file or link counts only inside the workspace, with the store it
  guards (the same path without `.lock`) beside it, at any size. A file named just
  `.lock` never counts. Outside the workspace a lock file or link never counts, so
  `Gemfile.lock`, `Pipfile.lock`, `Podfile.lock`, `Cargo.lock`, a tool's `.venv/.lock`
  and a root `.lock` are ignored, empty or not. A lock file in the workspace with
  no store beside it is not reported either.
- On Windows and macOS the `.lock` suffix is compared without regard to case,
  because the file system folds it: `x.json.LOCK` blocks a writer there.
- A release leftover `*.lock.release-<token>` is listed as "safe to delete" only
  when it is a real folder (not a link) that is empty or holds only its own token's
  owner file. Anything else is skipped without that wording.
- An empty folder younger than 5 s is in use (a process between its `mkdir` and its
  owner record); an older one is clearing. A lock on a store whose writers pass the
  `failOpen` option goes on after a short wait, so it is never stuck: it is listed
  as in use or clearing. Today that is the usage counter,
  `.leerness/cache/usage-stats.json`, and a probe fails if another caller passes the
  option without being added to the scan's list. An owner or folder time more than
  5 s ahead of this clock never runs out, since the 5 s rule and the age of an empty
  folder compare against it: such a lock is stuck and its next step says to check
  the clock and delete it.
- Stuck means: a lock kept for recovery, a displaced target or a link at once; a
  malformed owner or unexpected entries once 5 s old; any other reason except an
  empty folder or a dead owner once 5 minutes old; and any lock dated more than 5 s
  ahead of this clock, except on a fail-open store.

The sentence "delete that lock" is addressed to a person; an AI agent still follows
`.leerness/protected-files.md` and asks first. The managed `.gitignore` lists
`.leerness/**/*.lock/` and `.leerness/**/*.tmp-*`, so `git add -A` does not stage an
owner record under `.leerness`, which names the host and the process, in a lock
folder or under the temporary name a kill can leave. A release leftover folder is
not covered by these lines, nor are the locks `mode set` takes on `AGENTS.md` and
`CLAUDE.md`, which sit in the project root.

Limits:

- L1. Cloned machines. On Windows and macOS the host identity comes from a
  per-user seed. Two clones that keep the seed and the host name and share one
  project folder look like one machine. The 5 s rule protects a holder whose
  heartbeat is running; a clone whose holder has a stopped heartbeat, or a clock
  more than 5 s ahead of the holder's, is not protected.
- L2. A kill between the canonical and projection files of a store that writes
  both (lessons, decisions, teams) can leave them split. The next write fails
  closed with `E_PROJECTION_DIVERGED` or `E_TEAM_PROJECTION_EDITED`. `verify` now
  reports the mismatch and a preservation-first next step. Stop active writers,
  preserve both files and recovery artifacts, and reconcile authored notes before
  any manual restoration. No automatic deletion or recovery is performed.
- L3. A kill in the creation window no longer leaves a zero-byte or partial owner
  record: the record is written under a temporary name and renamed in, so the kill
  leaves an empty folder that clears by itself after 30 s (plus a temporary file
  that blocks nothing and is safe to delete). A zero-byte or partial record left by
  an older version, and a folder with two or three owner files, still stay protected
  and need a person. The second needs a new holder's folder removed and then two
  kills. A stall longer than the stale age can cause the removal, and so can the
  double unlink on Windows, with no stall at all.
- L4. During a mixed-version window an older writer whose folder is removed by a
  waiter fails that one write cleanly, because only this version goes round again.
  Older versions never reclaim.
- L5. A memory migration killed by an older version has no marker and is
  reclaimable.
- L6. Reclaim does not fire after a Linux reboot, `wsl --shutdown`, a container
  restart, a changed host name, or between two OS users on one Windows or macOS PC.
  These read as another host and stay protected; the message says so. A Windows or
  macOS reboot keeps the identity, so a dead owner is reclaimed there. On Linux two
  users share the host identity: a live owner stays protected through `EPERM`, and a
  dead one is reclaimed where folder permissions allow.
- L7. A reused PID, or a zombie on Linux, reads as live until that process goes.
- L8. If a person deletes a lock by hand, reclaim never runs, so a second file
  name of an interrupted publish stays and reads of that file fail closed on the
  single-link rule. When that name is `.<name>.publish-<pid>-<24 hex>` and is the
  same file (same device and inode), the refusal now names it and says that
  deleting that name is safe (`history status`, `preview-recover` and the commands
  that read memory stores show it). The commands under `memory-migration` report
  codes only, so they do not carry the name; run a command that reads the file.
  Reading and previewing never remove the name.
- L9. On Windows the message cannot name the displaced file.
- L10. A Windows junction to a volume GUID path (`\\?\Volume{...}\`) passes the
  `lstat` link check, so a lock folder that is such a junction is followed rather
  than refused. Making one takes code running on the machine; at worst reclaim
  removes the one `owner-<32 hex>.json` file of the folder it points to, and that
  folder must still satisfy every condition above.
- L11. A lock kept for recovery (a memory migration apply or rollback, a pending
  history journal, a file moved aside by an unfinished save) is never removed by
  leerness. A person resolves the state first and then deletes the lock, and
  `verify` fails until then. A split pair (L2) is also reported by `verify`; inspection does not repair it.
- L12. When a waiter removes a new holder's empty folder and a third process makes
  a new one before the holder's owner record arrives, the record lands in the third
  process's folder and the creation check fails that one write with `E_LOCK_TIMEOUT`
  (`E_LOCK_OWNERSHIP`). No two holders exist, and a retry succeeds.

Run `node scripts/shared-state-lock-probe.js` for async-scope, CLI/library and
multi-process regressions. `--filter <substring>` selects focused cases and
zero matches fail. Existing selftest, runtime, workspace lock ordering,
ledger identity, storage and correlation suites remain relevant.

## Store-pair observation (T-0379)

`verify --json` adds `storePairs` for decisions, lessons and teams. A split,
corrupt, unreadable or concurrently changing pair makes verify non-healthy and
nonzero. It reports stable error codes and relative document names, not memory
contents. Each checked source is bounded to 4 MiB. Healthy prefixes with authored
suffix notes retain the existing memory writer comparison; teams use their own
existing comparison. Readable legacy Markdown without canonical JSON is identified
as legacy, not misclassified as an interrupted canonical save. Missing optional
stores remain optional; a missing regenerable view is identified as rebuildable.

The inspection itself does not write, migrate, repair, or claim atomic multi-file
observation. Concurrent publication can make a read fail conservatively: stop
writers and recheck. The surrounding verify command retains its existing runtime
record policy. This diagnostic does not fix the multi-file publication gap,
Windows long-path failure T-0381, interrupted init T-0377, or partial-write recovery.
