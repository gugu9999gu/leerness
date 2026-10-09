# Efficient test execution

Use the repository's real scripts and required gates. Test counts or wall time
alone do not tell whether a run is wasteful.

1. Reproduce the failure with the smallest relevant test. Save its command,
   source revision, runtime, exit status, duration, and complete log.
2. Fix and rerun that test. Then run related tests and checks affected by the
   change. Inspect script bodies: a `fast` name is not a guarantee of a short run.
3. Freeze the candidate and run the required complete CI once. A failed gate
   returns to focused diagnosis. Run the final gate again only after a relevant
   source/environment change or a documented transient-failure hypothesis.
4. Report skipped/unrun gates explicitly. A focused pass never certifies a full
   suite, and a previous commit's result does not certify changed source.

Before integration tests, check the configured emulator/database/server endpoint,
startup result, readiness response, and build inputs. Use bounded connection and
readiness waits. `ECONNREFUSED` or `fetch failed` can indicate a missing service;
do not spend every test's retry budget discovering the same missing prerequisite.
Distinguish a failed prerequisite from a product assertion and retain both logs.
Do not automatically start services, use production credentials, retry paid APIs,
or change timeouts to obtain a green result.

For stale generated artifacts, establish the source/output mapping and configured
build directory first. Use an isolated clean output directory where possible.
Remove only verified, reproducible generated outputs within the intended project,
under its existing cleanup policy. Never delete paths copied from a failure log
or wipe the workspace to make a test pass.

Share a running final gate instead of launching the same suite locally and on the
same PC runner at once. Record an evidence identity containing the source/diff,
command/selection, runtime, dependency lock, and environment configuration. Reuse
evidence only when these inputs match; changed tests, config, lockfiles, build
output or external service state can invalidate it. "Final once" does not mean
ignore later changes.

Leerness already supports an explicit command with
`verify-claim <T-ID> --run-tests --test-cmd "<focused command>"`. This records the
selected command's result, not full-CI coverage. The CLI currently allows five
minutes for that command. Run long final CI outside it and retain the actual
revision-linked CI receipt; do not disguise a timed-out/partial suite as passing.

The generated `.leerness/testing-strategy.md` supplies this staged workflow as
agent guidance. The read-only [`test-plan assess`](test-execution-plan.md) command
selects from an explicit check/test map and reports unrun, blocked and uncovered
items. The companion `test-plan probe` checks loopback TCP reachability, while
`test-plan http-probe` compares a bounded local HTTP response with a declared
status and optional body marker. These commands do not discover dependencies,
authenticate service identity, start services, run tests, clean artifacts,
reuse results or skip CI.

For an npm project, `test-plan script-probe` checks that an exact named focused
script exists and rejects unverified forwarded filters. It does not infer that
the script runs only one test; inspect the script and runner before using the
result as a focused execution plan.

For a trusted project using `node:test` directly, the separate `test-run node`
command explicitly executes one named case in one declared file and rejects
zero or multiple selected cases. It runs project code and does not verify an
npm wrapper, the related checks, or final CI. Keep its result separate from the
read-only planning observations and run the required final suite later.

In Leerness's own test scripts, the fast platform smoke runs only its Windows
8.3 path selftest case and the generic smoke checks CLI workflows without
repeating the complete selftest. `test:core` and `npm test` each retain an
explicit full selftest step. A selected fast check is not a full selftest pass.
