# Memory write cost preflight

`lib/memory-write-budget.js` exports
`inspectMemoryWriteBudget(root, surface, candidateJson, operationJson, limitsJson)`.
This synchronous, read-only developer API combines checked source observations with
explicit candidate costs in one call. It does not activate a CLI/MCP command or a
writer policy. A passing result is neither permission nor a reusable write token.

All arguments are primitive strings. `surface` is `decisions` or `lessons`.
`candidateJson` is the complete proposed canonical array, using the
[candidate budget contract](memory-candidate-budget.md). `operationJson` has exactly
`kind` and `archiveText`:

| kind | archiveText | Publication order assumed for costing |
| --- | --- | --- |
| update | null | canonical, projection |
| drop | String to append to existing raw archive bytes, including a header when needed | archive, canonical, projection |
| restore | Complete replacement archive text | canonical, projection, archive |

The caller supplies these already prepared outputs. The API does not select dropped
or restored records, decide duplicates/force, validate archive round trips, or prove
that the candidate follows from the source. Even an unrelated replacement can pass
the cost checks. `candidateRelationVerified` and `archiveRecordsValidated` remain
false. Existing writer admission is still required.

`limitsJson` requires exactly four groups; every listed limit is mandatory and a
nonnegative safe integer. There are no operational defaults.

| Group | Required keys and diagnostic ceilings |
| --- | --- |
| observation | `maxFileBytes` ≤ 4 MiB; `maxTotalFileBytes` ≤ 12 MiB; `maxRecoveryEntries` ≤ 10000; `maxRecoveryDepth` ≤ 64; `maxRecoveryBytes` ≤ MAX_SAFE_INTEGER |
| source, candidate (each) | `maxInputBytes`, `maxItemBytes`, `maxCanonicalBytes`, `maxProjectionBytes` ≤ 4 MiB; `maxItems` ≤ 10000; `maxDepth` ≤ 64; `maxNodes` ≤ 100000 |
| operation | `maxArchiveInputBytes` ≤ 4 MiB; `maxArchiveBytes`, `maxProjectionBytes`, `maxFinalPathBytes`, `maxNormalPeakPathBytes` ≤ MAX_SAFE_INTEGER |

Limits metadata has a 4096 UTF-8 byte envelope. Operation JSON has an envelope of
`min(4 MiB, 6 * maxArchiveInputBytes + 128)` bytes, followed by the decoded archive
text byte check. Escaping can make an otherwise small archive exceed that envelope.
Observation budgets follow [the footprint contract](memory-footprint.md), including
the per-pass read limit, growth sentinel and shared recovery scope. Array limits
bound parsing/counting separately; they are not measurements of total RSS or CPU.
The source JSON byte budget applies to decoded JSON text after the existing UTF-8
decoder's leading-BOM handling; observation still counts the original BOM bytes.

The API captures fixed canonical/projection/archive files and shared
`archive/mutation-recovery` metadata, including files without receipts. It validates
canonical UTF-8, JSON, records and source budgets, then compares the projection's
generated prefix using the existing renderer's parts. The appended suffix stays
opaque and its exact UTF-8 byte length is included in the next projection. A missing
projection contributes no suffix. A projection without canonical JSON requires
explicit legacy migration, including empty or unparsed legacy Markdown. Invalid
canonical input never falls back to Markdown.

Update leaves the archive size unchanged; drop counts old raw bytes plus the
supplied append text. Restore requires a present, valid UTF-8 archive and counts the
supplied replacement. Archive record semantics remain unchecked. The next full
projection, archive, final sum and normal publication peak must fit operation limits.
An oversized existing store may fail source checks even for a shrinking candidate;
this API is not yet the writer admission policy for recovery or shrink operations.

`measurement.observed` contains the checked footprint. `source` and `candidate`
contain separate array assessments; `suffixBytes`, `next`, and `stages` describe the
costs. After computation, the API rechecks source bytes, root/workspace/runtime and
recovery metadata before returning a successful result. It returns no content,
paths, hashes, descriptors or capture token. Failed/exceeded inputs return a fixed
`error.code` and `error.phase`, `measurement: null`, and false validation/recheck
flags; no partial sum is presented as a complete measurement.

The normal peak is a **conditional path-byte bound assuming every listed stage
publishes and cleans up normally**. If the current sum is S and next file size is N,
Windows replacement of an existing file contributes peak S+N. Absent-file creation
and POSIX link publication contribute S+2N because two paths briefly name the new
object; POSIX replacement also retains the displaced old file during that step.
The state becomes S-old+N before the next step. The bound includes the initial sum
and observed shared recovery once. `publicationBackend` records the runtime's
backend. Identical-byte outputs may skip publication and actual peaks can be lower;
this API does not infer command-level duplicate no-ops.

`normalCleanupRequired` and `unchangedOutputsMaySkipPublication` are explicit.
The bound excludes external changes, failed cleanup, new failure recovery,
preexisting loose publication artifacts, external temporary directories, other
surfaces, CLI/control files, filesystem allocation, streams/journals and open
unlinked bytes. It is not a free-space check. `recoveryPeakBytes` and `physicalBytes`
are null; `reservationGranted`, `atomicObservation`, `approvalGranted` and
`writesPerformed` are false. Checked reads and metadata comparisons are not an
atomic snapshot or containment fence, and the result can become stale after return.

The current tests exercise Windows Node 18/24/26 source and installed Node 18/26,
including real CLI add/drop/restore file lengths and observed publication peaks.
The POSIX arithmetic branch has deterministic coverage; this validation does not
claim execution of the new observer on a POSIX host.
