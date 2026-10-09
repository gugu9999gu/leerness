# Memory publication reads and retained cleanup paths

The explicit [command policy](memory-command-policy.md) now reaches backend byte
comparisons, including displaced Windows replacement files, prepared hard-link
detach/rollback checks and post-publication validation. There are no new required
policy fields or implicit operating budgets. The private validation ceiling is
`max(observation.maxFileBytes, measured next canonical/projection/archive bytes)`;
admission already constrains each term to at most 4 MiB. The candidate output can
therefore be larger than the original-file observation allowance when separately
admitted candidate/operation limits permit it.

An oversized stat is rejected before opening a comparison file. Descriptor growth
is detected after reading at most that ceiling plus one overflow byte. Each read
checks regular-file metadata before/after reading; link aliases are allowed only
in the lower-level comparison helper because detach/rollback examines linked
files. The surrounding publisher retains its parent, identity, byte and link-count
checks. A repeated read may allocate another bounded buffer and copy: this is not
a cumulative I/O, process-memory, CPU or wall-clock limit. Omitting a policy keeps
the previous unbounded comparison path.

An over-limit file found before publication rejects the write. If replacement or
an earlier target already succeeded, a later limit failure is a partial write,
with the existing recovery receipt/error contract. It must not be reported as a
pre-write policy rejection. No automatic rollback, truncation or deletion of the
displaced original is introduced to meet a limit.

Successful explicit CLI/MCP writes add a `memoryPublication` object. Explicit
`memory restore --json` now returns `{ok, surface, restoredCount, memoryPublication}`;
the default restore output is unchanged. Plain-text successful commands warn on
stderr when cleanup remains. Duplicate skips do not publish or invent a result.
`publishAdmittedMemoryWrite()` also returns this object to internal callers.

| Field | Meaning |
| --- | --- |
| `validationReadMaxBytes` | The private derived ceiling actually passed to backend comparisons. |
| `cleanupPending` | A reported artifact still exists, its observation failed, or a backend cleanup operation failed. |
| `retainedPaths` | Deduplicated known backend paths, relative to the project, with role, observed kind and file byte count; unreadable entries include an error code. No file content is emitted. |
| `knownRetainedFileBytes` | Sum of observed regular-file sizes among those paths. This is not additional disk use or the total recovery footprint. Failure artifact lists may also name a live target. |
| `retainedInventoryComplete` | Every reported surviving path was an observed regular file. A directory or unreadable path makes this false: directory contents are not recursively inventoried. Even true applies only to this finite reported set. |
| `normalCleanupConfirmed` | No reported cleanup concern and no publication error. It does not certify the absence of unrelated or newly created files. |
| `recoveryReadsBounded`, `failureRetentionBounded`, `physicalReservation` | All remain `false`: no total/per-source recovery byte allowance, retained-space cap or physical reservation. The separate recovery contract bounds each copy chunk. |

This observation occurs after publication or at the failure boundary, before
receipt materialization. It excludes later before/live/cause copies and the new
receipt itself. Known retained backups from earlier successful targets are added
to a later failure's cause artifacts, so their exact bytes can be copied by the
existing recovery collector. The same `memoryPublication` metadata is attached to
the receipt and CLI error, including when receipt creation fails. A pre-write
failure with a cleanup artifact can report it without claiming that domain bytes
were partially published.

Explicit recovery now uses [chunked source copying](memory-recovery-transfer.md),
with per-attempt read/write costs and source stability in receipts/errors. The
default collector retains its whole-file reads. Either path may need primary and
authorized external fallback attempts. A
concurrent writer can create a much larger displaced or live file than the
admitted source. Normal final/peak path estimates and storage targets do not bound
such files, recovery copies, failed cleanup, filesystem metadata or physical disk
use. Success with `cleanupPending: true` means normal cleanup assumptions failed;
it does not recertify the storage target. Another policy capture will observe
shared recovery inventory under its existing explicit limits.

Chunked copying preserves originals and partial artifacts during receipt/fallback
failure, but does not cap total retained evidence. No independent operating corpus,
default policy or total recovery retention/reservation policy has been selected.
