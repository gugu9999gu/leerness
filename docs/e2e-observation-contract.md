# E2E observation contract

T-0182 and T-0183 correct test observation, not production runtime admission.
The original full E2E assertions and supported OS/Node matrix remain required.

## Diagnostic helper

- childDiagnostics(result, elapsedMs, timeoutMs, parsedReport): summarize an actual child result without executing, retrying, mutating or accepting it.

## Fields

- status: the native exit status; null remains null.
- signal: the native termination signal or null.
- errorCode: the native spawn error code, bounded to80 characters, or null.
- errno: the native numeric errno or a bounded string, or null.
- errorMessage: at most160 characters, or null.
- elapsedMs: nonnegative monotonic duration captured immediately after the child returns.
- timeoutMs: the actual child deadline.
- stdoutBytes: captured byte count; null means the stream was not captured.
- stderrBytes: captured byte count; null means the stream was not captured.
- stdoutTail: at most256 characters, or null for an uncaptured stream.
- stderrTail: at most256 characters, or null for an uncaptured stream.
- version: at most64 characters from a parsed doctor report, or null.
- mcpTools: the parsed finite numeric count, or null.
- healthy: the parsed boolean, or null.
- selftest: bounded pass/total/ok/failure count and at most five failure names of120 characters each, or null.

## Preserved behavior

The fresh-migration handoff, doctor/commands and JSON121 blocks retain their
actual child invocation, fixture environment, success predicates and runtime
warning gate. Diagnostics are printed only on failure, including the setup
migrate/init result. An uncaptured stream is not described as empty output.

Only JSON121's doctor deadline changes:990000ms covers its nested900000ms
selftest deadline plus90000ms for environment probes and startup/teardown.
The other14 queries retain180000ms, init300000ms, the separate doc/surface
doctor300000ms, commands15000ms and fresh handoff/migrate15000/60000ms.
This is deadline consistency, not a measured speed improvement or a claim that
the historical CI handoff/doc-surface failures were caused by timeouts.

The134 leftover counter reads the same `sb` used for child TMPDIR/TEMP/TMP.
A foreign parent marker must not affect it; a real child-sb marker must fail.
Observation preserves fixture bytes/mtime and never deletes unrelated files.

## Verification limits

The small probes execute the original assertion blocks with controlled fixtures
and actual short-lived child failure results. They prove observation behavior,
not a full product run. Separate real original-block executions and final
same-SHA CI are required. Static function/field matching is not semantic proof.
