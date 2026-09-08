# Installed handoff test lifecycle

This test-harness followup is separate from the frozen 1.36.189 candidate. It
does not change product CLI commands, session storage or runtime migration.

The four parallel handoffs in `scripts/installed-cleanroom-probe.js` use Node's
built-in `execFile`: shell-free argv, isolated session environment, a 180-second
direct-child timeout with SIGKILL, and a 1 MiB limit per captured output stream.
No new dependency or process-tree manager is introduced. A deadline observation
is latched before the native timeout, so a late successful callback cannot pass.
Synchronous launch errors also resolve to failure packets: `Promise.all` can
collect the other handoffs instead of rejecting early and deleting their project.

The caller requires status zero, no error/signal/deadline flag, and all four valid
session records. On failure it stops this cleanroom run and preserves the owned
temporary project with bounded child diagnostics and a printed evidence path.
Only a successful handoff gate allows the existing cleanup path to resume.

This is not a guarantee of descendant termination or a hard real-time bound:
the event loop, OS termination failures, inherited descriptors and unrelated
processes are outside this narrow helper's control. `execFile` can report launch
failure before `close`; a process that never obtained a PID is not a live child.
Failed handoff evidence remains retained even when termination is uncertain.
Other synchronous suite timeouts and `handoff-readonly-probe.js` are unchanged.

## Verification

`npm run test:installed-lifecycle` extracts the actual helper and caller block.
It runs real owned Node children for success, exit failure, launch failure,
deadline/SIGTERM-ignoring behavior, output overflow and parallel completion;
controlled launch throws and delayed callbacks cover otherwise timing-sensitive
paths. Five controlled caller packets check the error/signal/deadline predicates
and preservation flag. One source assertion checks cleanup wiring. The observer
shortens 180 seconds to 750 ms and 1 MiB to 4096 bytes, while separately checking
the real configured values. Its deadline is an independent failure guard, not
the implementation's completion mechanism. All actual child handles are closed
before the probe returns. A nested mutant run leaves one parallel packet pending
and must exit1 with a final verdict, not silently exit0 or hang. Fixtures and
results.json remain under the printed paths.

`npm run test:installed` runs this regression before the full real pack/install
cleanroom. An optional probe source-file argument supports frozen-baseline replay;
it is not a product CLI option. Counts mix actual-child and controlled checks and
must not be presented as independent real user sessions or performance gains.

The native timeout, callback and output-limit behavior follows the
[Node.js child-process contract](https://nodejs.org/download/release/v18.18.2/docs/api/child_process.html#child_processexecfilefile-args-options-callback).
