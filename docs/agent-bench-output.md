# Agent benchmark output

`leerness agents bench "task" --timeout 60 --json` compares enabled providers.
`--timeout` accepts a whole number from 1 to 3600 seconds (default 60), validated
before provider discovery or execution-ledger writes.

## Unicode and bounded collection

Each stdout/stderr stream is decoded independently as strict UTF-8, preserving
characters split across process-output chunks. A final decoder flush rejects an
unfinished character. Invalid bytes fail the provider result; Leerness does not
guess another encoding, insert replacement characters, or reconstruct lost text.
The combined stdout/stderr limit is 1 MiB. Exceeding it fails the result instead of
publishing a silently truncated response. Already-decoded streams are rejected
because their original byte integrity cannot be checked.

Previously, each chunk was converted separately, which could corrupt Korean or
emoji crossing a chunk boundary. The displayed final three lines also supplied
the reported response length. Collection now measures the full accepted output
and keeps a separate, bounded display tail.

| Field | Meaning |
| --- | --- |
| `stdout` | Trimmed final three lines from at most 4096 UTF-16 code units; empty on collection failure |
| `stdoutChars` / `stderrLen` | Decoded UTF-16 code units, including whitespace; an emoji may count as two |
| `stdoutBytes` / `stderrBytes` | Raw bytes observed, separate for each stream |
| `stdoutTruncated` | Display text omits some decoded stdout, including trimmed whitespace |
| `outputComplete` | Both streams closed and decoding/collection completed without error |
| `stdoutSha256` / `stderrSha256` | Digests of complete raw streams, or null when collection is incomplete |
| `errorCode` / `errorStream` | Fixed failure reason and affected stream when known |
| `timedOut` | The collection deadline expired |
| `terminationRequested` / `terminationConfirmed` | A stop was requested / the direct child's exit or close was observed |

Counts are partial observations when `outputComplete` is false. On a size-limit
failure, observed byte counts include the offending chunk; it is not decoded or
included in a digest. A digest establishes local byte identity, not model identity,
meaning, or a claim that the answer is correct. Raw stderr is not displayed or
written into the execution ledger; fixed error messages and counts are used.

## Failures and completion

`ok` requires successful collection, exit code zero, and non-whitespace stdout.
Stderr-only responses fail as `empty_stdout`. Exit-zero banners are not semantic
answers merely because they satisfy this transport check. A nonzero exit can have
complete output and digests while still failing as `process_exit`.

Collection errors include `output_encoding_invalid`, `output_limit`,
`output_chunk_invalid`, `output_stream_error`, `process_error`, and `timeout`.
Each provider contributes exactly one terminal ledger event. Successful peers are
retained if another provider fails; any provider or audit-write failure gives the
bench command exit code 1. `provenance.complete` describes ledger writes only.

Timeout covers process execution and output-pipe closure. Leerness requests that
the direct child stop and waits at most another 250 ms before settling the result
and releasing its pipes. An unconfirmed termination stays explicit; this is not a
guarantee that every descendant process stopped. Ledger/file operations outside
the collector are not covered by this output deadline.

This fix covers `agents bench`. Other streaming paths, byte-valid garbled text,
generated project encoding guidance, and optional English authoring have separate
follow-up work. It does not repair previously damaged documents or identify the
historical cause of a project's garbled text.

Run the deterministic regression cases with `npm run test:agent-bench-output`.
They use synthetic providers and local Node children, without paid model calls.
