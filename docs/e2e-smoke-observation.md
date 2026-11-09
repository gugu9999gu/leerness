# Original E2E smoke observation

Run `node scripts/e2e.js --smoke-only` to execute the original initialization,
checks, seeded secret scan, planning, task updates, session close, handoff,
post-close audit, lazy detection and memory search sequence. It uses the same
fixture and 30-second per-command limits as the default E2E prefix. It is not
an installed-package check and is not the full E2E suite.

No argument still runs the existing full/sharded E2E path. A smoke-only invocation
refuses shard/timing environment settings rather than misreporting shard coverage.
Unknown or duplicate arguments are rejected before creating any test fixture.
The existing runtime-warning and repository-mutation checks run in both modes.
Only full mode claims the complete shard-guard inventory.

Both smoke helpers require a real integer exit status with no spawn error or
termination signal. An expected failure means a normal nonzero exit, not an
ENOENT, timeout or output-buffer error. Success output includes elapsedMs; failed
commands retain existing output plus bounded status/signal/error/byte-count/tail
diagnostics. The helpers do not extend timeouts or retry a failing command.

Regression: `node scripts/e2e-smoke-observation-probe.js`. It drives the actual
helper source with native timeout/missing-command/nonzero controls and synthetic
inconsistent receipts, then checks full/smoke completion boundaries. Existing
`e2e-child-diagnostics-probe.js`, `e2e-temp-scope-probe.js` and `ci-shard-probe.js`
remain applicable. This optional command is not a new default npm gate.

A passing smoke-only run says nothing about later E2E cases, B(1.9.41), all
installed versions, production load, p95 or historical speedup. It does not
change Leerness runtime behavior or update the user's installation.

## Later migration-to-handoff scenario

The separate B(1.9.41) #4 case is not included in `--smoke-only`. Its verdict now
requires both migration and handoff to exit normally with status zero and no
spawn error or termination signal, as well as the existing migration notice.
It retains the original migration60s and handoff15s limits, order, command
arguments and ignored migration output. Successful cases report `migrateMs`
and `handoffMs`; existing bounded failure diagnostics remain. No retry is added.

Run `node scripts/e2e-migration-handoff-probe.js` for27 verdict/observation
controls. Add `--real` to run the actual source-extracted case three times on
fresh Unicode/space-path fixtures and check runtime warnings:31 reported checks.
These are27 controls, three observations of one product scenario and one warning
check, not31 independent product scenarios. The probe verifies exact arguments,
order and budgets, checks that the case has no shared-prefix fixture dependency,
and refuses ambiguous source boundaries. It is optional, not a new npm/CI gate.

Real CLI children use isolated home/cache/temp/git configuration and offline
settings, without updating a real user installation. Handoff must preserve
fixture contents, listings, inode/mode and modification times. Runtime, checked
source and repository-state snapshots must remain unchanged. Fixtures are kept
for diagnosis; existing runner-owned temp tracking may record them.

The structured `OBSERVATION`/`RESULT` child timing measures only the synchronous
child call. The original case's text timing also includes the probe's surrounding
fixture snapshots and can be slightly larger. Three local observations are not
p95, a historical speedup, original CI load, all-platform or full-E2E evidence.
The full and sharded E2E defaults are unchanged.
