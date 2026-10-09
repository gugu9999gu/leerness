# Test execution plan and local prerequisite probes (TEST-01)

`leerness test-plan assess --stdin --json` builds a read-only plan from explicitly declared checks. It selects the check containing each failed test, checks mapped as related to the selected focused checks, then every declared final check. It does not run commands, inspect service health, verify script contents, reuse results, or mark any test passed. The caller remains responsible for running the selected commands and saving actual exit results.

Send one UTF-8 JSON document (maximum 65,536 bytes) to standard input. A minimal example:

```json
{
  "schema": "leerness.test-execution-input/v1",
  "checks": [
    { "id": "auth-unit", "stage": "focused", "argv": ["npm", "run", "test:auth-unit"], "cwd": ".", "timeoutMs": 120000, "testIds": ["expired-login"], "relatedTo": [], "coverageIds": [], "prerequisites": [] },
    { "id": "auth-related", "stage": "related", "argv": ["npm", "run", "test:auth"], "cwd": ".", "timeoutMs": 300000, "testIds": [], "relatedTo": ["auth-unit"], "coverageIds": ["auth"], "prerequisites": [] },
    { "id": "required-ci", "stage": "final", "argv": ["npm", "test"], "cwd": ".", "timeoutMs": 7200000, "testIds": [], "relatedTo": [], "coverageIds": ["auth", "api"], "prerequisites": ["emulator"] }
  ],
  "failedTestIds": ["expired-login"],
  "requiredCoverage": ["auth", "api"],
  "readiness": [{ "id": "emulator", "status": "unknown" }]
}
```

This example selects all three checks, but reports `declared-prerequisite-blocked` because emulator readiness is unknown. The status is based only on the supplied declaration; even `"ready"` does not prove that the service responded. `unrunCheckIds` always lists the selected checks. `finalGatePassed`, `readinessVerified`, `coverageVerified`, `commandVerified`, and `evidenceReusable` are always false in this first stage.

Each focused check declares the exact failed test IDs it can cover. If a failed ID matches zero or multiple focused checks, the command rejects the input instead of guessing. Related checks point to focused check IDs through `relatedTo`. If none is selected, `needsRelatedReview` remains true. Every final check is selected, and `requiredCoverage` not declared by those final checks appears in `uncoveredRequiredCoverage` with an incomplete status. These coverage names are declarations, not verified CI wiring.

`argv`, project-relative `cwd`, and `timeoutMs` record the intended command without shell-string parsing. The response includes only a command digest and check IDs, so input command text is not copied to output. Do not place secrets in the input. The planner does not create files or delete stale artifacts.

`leerness test-plan probe --stdin --json` checks whether explicitly named local TCP ports accept a connection. For example, pipe this JSON document into the command:

```json
{
  "schema": "leerness.test-prerequisite-probe-input/v1",
  "endpoints": [
    { "id": "emulator", "host": "127.0.0.1", "port": 8080, "timeoutMs": 500 }
  ]
}
```

Only `127.0.0.1` and `::1` are accepted; DNS names and external hosts are rejected. A request has at most 16 endpoints, each with a 1–2,000 ms deadline. Endpoints run concurrently, with no application data sent. Results distinguish `tcp-open`, `connection-refused`, `timeout` and `connection-error`. `tcpReachable` means only that a TCP connection opened: it does not prove that Firestore, a database, or an HTTP service is healthy. `serviceReadyVerified`, `finalGatePassed` and `evidenceReusable` stay false. The command does not start a service, run a test, or write project files. A short connection check can avoid repeatedly waiting for an obviously absent local emulator, but cannot replace an application-specific health check.

Exit code 0 means the probe request was valid and completed, even if every endpoint refused the connection. Inspect each result and do not use the CLI exit code as a service-health gate.

`leerness test-plan http-probe --stdin --json` makes one bounded HTTP GET request to each declared loopback endpoint. It compares the response with the expected status and, if supplied, an ASCII body marker. For example:

```json
{
  "schema": "leerness.test-http-probe-input/v1",
  "endpoints": [
    { "id": "local-api", "host": "127.0.0.1", "port": 8080, "path": "/health", "expectedStatus": 200, "bodyIncludes": "ready", "timeoutMs": 500 }
  ]
}
```

Use `"bodyIncludes": null` for a status-only endpoint, such as a deliberate empty `204` response. The path is an ASCII absolute path (at most 128 characters) without a query, fragment, scheme, doubled slash or `..` segment. Hosts are limited to `127.0.0.1` and `::1`; the command sends no credentials, follows no redirects, accepts at most 16 endpoints and reads at most 16 KiB of each response. Each request has a 1–2,000 ms deadline. Do not put a secret in the path or body marker.

`http-expected` means only that the configured local response matched at the time of the probe. `http-status-mismatch`, `http-body-mismatch`, `http-response-too-large`, `connection-refused`, `timeout`, `connection-error` and `http-protocol-error` remain distinct results. The output does not copy response bodies, headers or the expected marker. This generic check does not authenticate service identity, validate a database or emulator protocol, run tests, or attest that the service will still be ready when tests start. `serviceReadyVerified`, `finalGatePassed` and `evidenceReusable` therefore remain false. As with the TCP probe, exit code 0 means the request was valid and completed, not that the expected response matched. Use a service-specific protocol assertion before treating a dependency as verified for test execution.

`leerness test-plan firestore-probe --stdin --json` requests the local Firestore emulator's fixed rule-coverage endpoint and checks its response shape. For example:

```json
{
  "schema": "leerness.test-firestore-probe-input/v1",
  "endpoints": [
    { "id": "firestore", "host": "127.0.0.1", "port": 8080, "hubPort": 4400, "projectId": "demo-leerness-probe", "timeoutMs": 500 }
  ]
}
```

The command accepts at most 16 numeric loopback endpoints and Firebase-style project IDs of 6–30 lowercase letters, digits or hyphens. It sends an unauthenticated GET to `/emulator/v1/projects/<projectId>:ruleCoverage`, follows no redirects, accepts at most 64 KiB of each JSON response and uses a 1–2,000 ms deadline. `firestore-protocol-shape` requires HTTP 200, a JSON content type, valid UTF-8 and a `rules.files` array. Status, content type, malformed JSON, oversized response, connection refusal and timeout remain separate outcomes. Raw response bodies and headers are not returned.

The optional `hubPort` adds a second bounded GET to the Firebase Emulator Hub's fixed `/emulators` path at the same numeric loopback host. The hub response is limited to 16 KiB and must list both the hub's own host/port and a Firestore entry at the requested host/port. `hub-firestore-mapped` means those advertised mappings matched at observation time; a missing hub, connection refusal, timeout, wrong HTTP/content type, invalid JSON, wrong hub entry or wrong Firestore host/port are separate `hubStatus` values. No response body or header is returned. Omitting `hubPort` preserves the earlier response fields and makes no hub request.

**Neither response establishes project identity.** An isolated local emulator returned the same Firestore shape and hub mapping for the requested project and an unrelated project ID. The hub advertisement is unauthenticated and can change after observation. Accordingly, `projectIdentityVerified`, `serviceReadyVerified`, `testPassVerified`, `finalGatePassed` and `evidenceReusable` are always false, even when both observations match. Exit 0 means the observation request was valid; inspect both per-endpoint results. The command does not start the emulator, run tests or write project files. Confirm actual service configuration and test execution separately.

`leerness test-plan script-probe --stdin --json` checks that each declared focused command names an existing npm script. It never runs the script or assumes an extra `--filter` or other forwarded option works. An example from a project root with `functions/package.json`:

```json
{
  "schema": "leerness.test-npm-script-probe-input/v1",
  "checks": [
    { "id": "secrets", "failedTestId": "integration-secrets-endpoint", "argv": ["npm", "--prefix", "functions", "run", "test:integration-secrets-endpoint"], "cwd": ".", "timeoutMs": 300000 }
  ]
}
```

The exact forms supported are `npm run test:<failedTestId>` and `npm --prefix <relative-dir> run test:<failedTestId>`, with optional `--silent` immediately after `run`; `npm.cmd` is also accepted. `cwd` and `--prefix` must stay inside the current project. The command reads at most 256 KiB of `package.json`, rejects invalid UTF-8, duplicate JSON keys and escaping paths, and returns only command, script and package digests rather than script bodies. `named-script-present` means the named script existed in the observed package file; `script-missing` remains explicit. `lifecycleHooksPresent` indicates direct `pre<name>` or `post<name>` scripts that npm may also run. Extra arguments are rejected as unsupported because a runner may ignore them and run its whole suite. A named script may itself run many tests, so `runnerSelectorVerified`, `coverageVerified`, `finalGatePassed` and `evidenceReusable` remain false, and every check stays `not-run`. Recheck the package digest and inspect or execute the project runner separately before asserting that one failed test was actually selected.

`leerness test-run npm-script --stdin --json` is an opt-in execution command for one trusted, named npm script. First run the read-only script probe above. Copy its single result's `commandDigest`, `packageDigest` and `scriptDigest` unchanged into this request, along with the same `check` object:

```json
{
  "schema": "leerness.test-npm-script-runner-input/v1",
  "execute": true,
  "check": { "id": "secrets", "failedTestId": "integration-secrets-endpoint", "argv": ["npm", "--prefix", "functions", "run", "test:integration-secrets-endpoint"], "cwd": ".", "timeoutMs": 300000 },
  "commandDigest": "<64 hex characters from script-probe>",
  "packageDigest": "<64 hex characters from script-probe>",
  "scriptDigest": "<64 hex characters from script-probe>"
}
```

Replace the three placeholders with actual SHA-256 values; placeholders are not valid input. The runner rechecks all three before execution, refuses a missing or changed script and rejects direct npm pre/post hooks. It runs the npm CLI without forming a new shell command, suppresses test output and rechecks the package file afterward. The selected script may have normal project side effects and may launch child processes. A 100–300,000 ms timeout attempts to stop the process tree; Windows teardown may take longer and termination of independently detached descendants is not guaranteed. Use it only for a trusted script. Invalid input exits 2; a valid request that did not observe a stable zero exit returns 1; a stable zero exit returns 0.

`scriptExitZeroObserved` means exactly that the named npm entry returned zero while its package definition stayed unchanged. A script can run multiple cases, no assertions or nested scripts. Therefore `runnerSelectorVerified`, `testPassVerified`, `coverageVerified`, `serviceReadyVerified`, `finalGatePassed` and `evidenceReusable` remain false on every result. Do not count this as one-case success or final CI evidence.

`leerness test-run node --stdin --json` is a separate, explicit execution command for a trusted project that uses Node's built-in test runner directly. From the project root, send:

```json
{
  "schema": "leerness.test-node-runner-input/v1",
  "execute": true,
  "cwd": ".",
  "testFile": "test/session.test.cjs",
  "testName": "expired session",
  "timeoutMs": 30000
}
```

The file must be a regular `*.test.js`, `*.test.cjs` or `*.test.mjs` file inside the current project; paths use forward slashes. The command checks the current Node runtime against its own zero/one/two-test fixture before running the project file. On Node versions that support it, this one-file invocation disables the test runner's extra worker process so a Windows timeout can stop the directly owned test process immediately; older runtimes retain their existing process-tree attempt. It passes an escaped exact name pattern without a shell and counts only test lifecycle events matching that name. A zero-match run may emit a synthetic file pass or no events; both are reported as `zero-selected`, never a pass. Duplicate names, nested extra cases, skipped/todo or failed tests, timeout and reporter overflow also return a nonzero exit. The response reports status, count, exit and elapsed time without returning test output, assertions, environment values or a test body. Invalid input exits 2; a valid request with no exact passing case exits 1; one exact passing case exits 0.

This command **runs project code**, which may write files, use a network or start child processes. Run it only for a trusted, explicitly selected test file. Timeout termination is best effort for processes the project test starts itself. It does not run an npm script or prove that a Functions/Jest/Vitest wrapper selected one test. `projectScriptSelectorVerified`, `coverageVerified`, `serviceReadyVerified`, `finalGatePassed` and `evidenceReusable` remain false even if the direct case passes. The test file and its imports can change after the run, and no reusable source/environment-bound receipt is issued.

`leerness test-run suite-list --stdin --json` checks the list emitted by one trusted project wrapper. From the project root, send:

```json
{
  "schema": "leerness.test-suite-list-input/v1",
  "execute": true,
  "cwd": ".",
  "wrapperFile": "scripts/run-tests.mjs",
  "failedTestId": "expired-login",
  "timeoutMs": 5000
}
```

The command launches the named in-project Node file with only `--list` and accepts one JSON result shaped as `{ "selected": ["test:expired-login"], "skipped": [["test:obsolete", "retired"]] }`. The wrapper must explicitly support that flag. The input file is capped at 1 MiB; its canonical path must remain in the current project and end in `.js`, `.cjs` or `.mjs`. Standard output is capped at 64 KiB. Duplicate names, overlap between selected and skipped, malformed JSON, nonzero exit, timeout or a wrapper changed during the call invalidate the observation. Output contains counts, target status (`selected`, `skipped` or `absent`) and hashes; it omits the full manifest, skip reasons, stdout and stderr.

Exit 0 means the list was valid and `test:<failedTestId>` was its **only selected entry**. Exit 1 means the target was skipped/absent, other tests were also selected, or the list could not be trusted; inspect `executionStatus` and `targetStatus`. Invalid input exits 2. The reference project's suite listed 103 selected and 3 skipped entries; two individually named scripts previously considered as focused candidates were in the skipped set. This is why a script's presence alone is not a reliable recommendation for a suite rerun.

This command runs **project code** to obtain the list. A custom wrapper might ignore `--list`, perform side effects or select different tests in execution mode. Timeout termination of independently detached children is not guaranteed. The command does not verify that no test ran, that an execution-mode selector matches the list, or that any test passed. `runnerSelectorVerified`, `testPassVerified`, `serviceReadyVerified`, `coverageVerified`, `finalGatePassed` and `evidenceReusable` remain false. Use it only with a trusted wrapper and do not treat exit 0 as a test pass.

Use the existing [efficient testing guide](efficient-testing.md) for related and final execution. Execution-mode selector checks, service-specific readiness, cross-process sharing, freshness checks and final CI orchestration remain later TEST-01 stages.
