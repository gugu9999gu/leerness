# Lightweight doctor and explicit selftest

## Scope

Routine `leerness doctor` collects installation/environment information without
implicitly executing the entire internal regression suite. The standalone
`leerness selftest` command, CI release checks, state-integrity checks, security
checks, and project completion gates are not removed or weakened by this change.

The previous diagnostics implementation always invoked the isolated selftest
runner. If it threw or returned malformed data, doctor then enumerated and ran the
suite again inside the parent process. An empty or unavailable inline suite could
also produce a misleading 0/0 healthy result. This change removes that implicit
work and the fallback retry. This is a code-path finding, not a measured claim
about end-user latency or overall Leerness performance.

## Commands

```sh
# Routine environment diagnosis: no complete selftest.
leerness doctor --json

# Explicit full verification, unchanged.
leerness selftest

# POSIX: opt into the full isolated suite within doctor itself.
LEERNESS_DOCTOR_SELFTEST=1 leerness doctor --json
```

On PowerShell, set `$env:LEERNESS_DOCTOR_SELFTEST = '1'` before invoking doctor and
restore its previous value afterward. Only the exact value `1` enables this
behavior. Library callers can pass `doctorCmd({ selftest: true }, deps)`;
`selftest: false` takes precedence over an ambient environment opt-in.

No new CLI flag is introduced: the existing command parser/help surface is not
silently extended.

## Result contract and migration

| Mode | `selftest.status` | `selftest.ok` / `healthy` | Exit behavior |
| --- | --- | --- | --- |
| Environment only | `not_run` | `null` | Does not set a failure exit code |
| Explicit suite passes | `passed` | `true` | Does not set a failure exit code |
| Explicit suite has failed cases | `failed` | `false` | Sets exit code 1 |
| Runner errors, empty/invalid report, or unavailable runner | `error` | `false` | Sets exit code 1 |

The `version`, `node`, `platform`, `runningFrom`, `mcpTools`, `shell`, `psVersion`,
and `tmpLeftover` fields remain. `diagnosisScope` is `environment` or
`environment+selftest`. A `not_run` result includes `command: "leerness selftest"`.
Zero pass/total counts in `not_run` or `error` are not evidence of success.

**Compatibility change:** `healthy` and `selftest.ok` can now be `null`. A consumer
requiring verified health must require `healthy === true` and explicitly request
tests, or run `leerness selftest`. A collector only checking for a detected failure
can use `healthy === false`; it must not relabel null as verified health. Existing
monolithic selftest/E2E assertions that assume doctor always runs the suite need
review before this default change is merged. Do not suppress those assertions or
replace release gates with the lightweight doctor command.

If an isolated runner is supplied, it is invoked at most once. Exceptions and
invalid results are errors, never reasons to rerun the suite inline. The small
synchronous dependency-injection seam remains available only for explicitly
requested verification with no isolated runner. Its environment restoration is
attempted on errors; a restore failure cannot become a passing result.

## Verification and limits

Run the focused unit and module-integration tests:

```sh
node --test scripts/doctor-selftest-probe.js
node --check lib/diagnostics.js
node --check lib/doctor-selftest.js
node --check scripts/doctor-selftest-probe.js
node --check scripts/doctor-cli-probe.js
```

These tests exercise the actual diagnostics function with unrelated I/O stubbed.
They assert call counts, invalid/empty report handling, no retries, environment
restoration, JSON/text output in Korean and English, and exit-code behavior.
They are not the complete CLI or product E2E suite.

A separate real-entrypoint smoke needs a complete checkout:

```sh
node scripts/doctor-cli-probe.js
```

The path-scoped diagnostics workflow runs both probes on Ubuntu/Node 18 and
Windows/Node 24, with read-only repository permissions, a job timeout, and stale
run cancellation. It neither publishes a package nor modifies the repository.
Existing release/CI workflows are unchanged.

Before merge, inspect existing doctor consumers and run the repository's normal
selftest/core gates in a complete development checkout. No production latency,
CPU, memory, or full-suite speedup is asserted by this patch. Other potential
hotspots such as repeated health/state reads and the long serial npm test chain
remain outside this change; removing integrity checks without measurements is not
part of this optimization.
