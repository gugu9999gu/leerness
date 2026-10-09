# Read-only memory footprint observation

Unreleased 1.36.197 adds the internal development API
`inspectMemoryFootprint(root, surface, limitsJson)` in `lib/memory-footprint.js`.
There is no new CLI/MCP command or default writer limit. The surface is
`decisions` or `lessons`. `root` and `limitsJson` must be primitive strings.

Supply all five limits as JSON, without extra keys. They are nonnegative safe
integers. These are diagnostic budgets, not recommended operating limits.

| Limit | Meaning | Implementation ceiling |
| --- | --- | --- |
| maxFileBytes | Bytes of each canonical, projection and archive file | 4 MiB |
| maxTotalFileBytes | Combined bytes of those three files per pass | 12 MiB |
| maxRecoveryEntries | Files and subdirectories visited below the recovery root; root excluded | 10,000 |
| maxRecoveryDepth | Subdirectory depth; recovery root is depth 0 | 64 |
| maxRecoveryBytes | Sum of single-link recovery file lengths | Number.MAX_SAFE_INTEGER |

The limits envelope is at most 2,048 UTF-8 bytes. Values at a supplied limit fit.
An empty existing directory fits zero entry/depth/byte budgets. Its directory
count is one, while its entry count is zero. A missing file and an empty file
both contribute zero bytes but have different states.

The observer selects the existing project workspace and checks runtime
compatibility. A missing/unrecognized/foreign workspace is not reported as an
empty memory store. It reads these three fixed files using the existing checked
reader, with size checks before allocation/open and a bounded growth sentinel:

- `<surface>.json`
- `<surface>.md`
- `<surface>.archive.md`

The three byte snapshots are private and rechecked before success. The total
budget applies separately to initial capture and recheck. Successful data reads
are at most twice maxTotalFileBytes; an over-budget growth rejection can read
one additional sentinel byte. These counts cover the three domain files only;
the existing workspace/Git/runtime resolution has its own metadata reads.
Byte counts do not assert valid JSON, UTF-8, memory items or projection prefixes.
Invalid bytes can be measured without being accepted by a writer.

Recovery observation covers the shared workspace directory
`archive/mutation-recovery`, including unknown names, loose scratch files and
files without a receipt. It does not open or parse recovery file contents.
Do not add the recovery totals from decisions and lessons as if they were
separate directories. External-temp recovery, relocated directories, temporary
publication aliases outside this directory, and other CLI/control files are
outside this observation.

Each fixed ancestor is checked before its descendant. Directory iteration uses
one-entry buffering and stops after the first entry exceeding the declared
limit. Handles are closed on success and failure. Symlinks/junctions, nonregular
files and multi-link files are unsupported. All observed file metadata,
directory identities/resolutions and observed absences are rechecked. A byte,
entry or depth failure discards the complete measurement instead of returning a
partial subtotal as a total. Unexpected read/close errors also return failure.

A successful result contains `measurement.files`, `fileBytes`,
`recovery` (existence, byte/file/directory/entry counts) and `totalPathBytes`.
It sets `filesRechecked` and `recoveryMetadataRechecked` to true. No paths, file
names, raw contents, hashes, parser messages or reusable snapshot handles are exported.
On failure, `measurement` is null and both recheck flags are false; `error.code`
is a fixed diagnostic code. API/configuration errors are result states too.

Every result states `readOnly: true`, `writesPerformed: false`,
`approvalGranted: false`, `atomicObservation: false`, `contentValidated: false`,
`physicalBytes: null` and `reservationGranted: false`.

Recovery rechecking covers metadata, not file contents. Multiple path operations
are not an atomic filesystem snapshot or an openat/dirfd containment fence.
Concurrent changes can occur after the final check, and transient path swaps
are not generally excluded. Observation does not certify exact physical space,
RSS/CPU time, a disk reservation, complete recovery, or permission to write.
Missing receipts never imply zero retained data. Receipt validity and recovery
execution are outside this API.

Run `npm run test:memory-footprint` for byte/count/depth boundaries, read-only
fixtures, links, growth, namespace changes, close failures and runtime changes.
Writer integration, operation output/suffix validation, independent operating
samples, environment defaults and already-oversized-store recovery remain
separate work.
