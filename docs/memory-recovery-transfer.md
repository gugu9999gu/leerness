# Memory recovery transfer and failure costs

An explicit [memory write policy](memory-command-policy.md) also selects streaming
recovery for a partially applied publication. No additional policy field is
required. The private comparison ceiling determines a reusable source-copy buffer:
`min(65536, validationReadMaxBytes)` bytes. Before snapshots already admitted by the
writer are written in chunks; live and cause files are opened and copied
sequentially without whole-file `readFileSync` or a source-sized allocation.

Each source copy observes its size from the opened descriptor and reads only that
finite extent. Descriptor and pathname identities, metadata and size are checked
again. A growing, replaced, shortened or unreadable source is marked `stable: false`;
the original and any copied prefix remain available. A receipt can therefore exist
without containing a complete stable copy of every source. Missing sources and
nonregular objects are described without following them into a copy.

This bounds the scratch buffer and each transfer request, not total source bytes,
the existing before snapshots, receipt serialization, cumulative I/O, process RSS,
CPU, elapsed time or retained disk space. Concurrent writers can create evidence
larger than the admitted input. Recovery never truncates or deletes that evidence
to fit a normal publication estimate. The existing publication field
`recoveryReadsBounded: false` still means no total/per-source recovery byte allowance;
the new `readChunkMaxBytes` reports the narrower transfer bound.

## Receipt and error metadata

Receipt version 1 adds `recoveryCosts`. The same information reaches explicit
CLI/MCP partial-write errors, including when receipt creation fails. No raw source
content is emitted in these fields.

| Field | Meaning |
| --- | --- |
| `readChunkMaxBytes` | Maximum source read request and copy chunk in bytes. One scratch buffer is reused across sources and attempts. |
| `sourceBytesRead` | Bytes returned by source reads, including a chunk whose subsequent write failed and repeated reads during an authorized fallback. Before snapshots, descriptor checks and module loading are excluded. |
| `artifactBytesWritten` | Sum of bytes returned by artifact write calls across all attempts. This is logical write accounting, not physical allocation or a durability proof. |
| `attempts` | Storage type, directory, write count, per-file creation/completion/errors, and observed source results for each begun sink. A directory creation failure before a sink begins does not add an attempt. |
| `attempts[].sources` | Observed kind, stability and available copied-prefix size/hash or error. A write failure may leave only the named sink file's partial byte count. |
| `attempts[].allObservedSourcesStable` | All observed sources were stable or missing. It does not certify sources never reached after an earlier failure. |
| `snapshotBeforeReceipt` | Present and true in the receipt: its cost snapshot precedes serialization and writing of that receipt. The final error snapshot includes any receipt bytes written. |
| `totalSourceBytesBounded`, `retentionBounded`, `physicalReservation` | All false. |

A sink file's `complete` means its producer and write/fsync/close finished; a
producer can stop after a source read failure. Check source `stable` separately
before using an artifact as a complete recovery copy. The partial-write error
remains a failure; no automatic rollback is introduced.

## External fallback

The existing runtime operation must already have latched
`E_RUNTIME_LAYOUT_INCOMPATIBLE`, and the temporary destination must be outside the
project. Both the default and explicit paths check this before preparing a fallback
or rereading sources. Other receipt/write errors do not authorize the bypass.

Streaming fallback uses a random external directory and a synchronous named-file
sink. The producer receives no raw privileged filesystem methods or descriptors.
The existing limits of 128 files and 128 MiB of total writes include receipt bytes;
the next disallowed file/chunk is rejected before its producer/write. Short writes
are accounted and retried; stalled writes fail. File creation uses exclusive `wx`
and mode 0600; directory mode 0700 is requested where supported.

A failed streaming fallback preserves its directory and partial artifacts, reported
as `failedExternalRecoveryDirectory` in CLI/MCP recovery details. It never clears
the runtime failure latch or permits further project writes. When a primary attempt
and fallback both read a source, costs count both attempts; there is no snapshot
reuse guarantee. The default no-policy collector keeps its previous whole-file
and failed-bundle behavior, with the earlier authorization check.

## Validation scope

The transfer and external probes cover chunk/total/file boundaries, exact bytes and
hashes, growth/replacement/read/write/close failures, retained callbacks, receipt
failure and the actual runtime latch. Actual CLI/MCP tests cover both memory
surfaces, partial/receipt failures and Windows publication growth. The 128 MiB
arithmetic boundary uses a counting write primitive; it does not allocate or write
128 MiB on disk. Small-file limit and preservation cases use actual filesystem I/O.
Independent operating data, calibrated defaults and a total retention/reservation
policy remain unspecified.
