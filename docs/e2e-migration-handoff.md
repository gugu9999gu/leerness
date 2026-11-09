# Original migration and handoff acceptance

Run `node scripts/installed-handoff-probe.js` explicitly. Its existing offline,
lifecycle-disabled package installation now also executes the four original
`B(1.9.41)` blocks from `scripts/e2e.js` against both source and installed CLI.
The existing shard parser validates their identities and rejects shared-fixture
dependencies. The blocks, command flags, old-version-marker fixtures and original
20-second whats-new, 60-second migrate and 15-second handoff deadlines are reused.
No full E2E or original CI-load equivalence is implied.

Cases cover version differences, migration stdout, the retained migration report,
and the fresh-migration notice in handoff. Every child must exit normally with
status zero, no error and no signal. Migration failure leaves handoff `not_run`.
Complete output and an existing report are not evidence of process success.
Successful cases print elapsed time; failures retain bounded diagnostics.

The installed probe retains source/block hashes and per-child logs/digests in its
JSON evidence. HOME, npm configuration and temporary projects remain isolated;
installation is local/offline with lifecycle scripts disabled. The default and
recent-migration read paths must preserve fixture bytes, listings and mtimes.
Source workspace and bin/lib/package bytes must remain unchanged. Runtime-warning
checks cover stderr and redirected warnings. No user/global installation changes.

`node scripts/e2e-child-diagnostics-probe.js` includes positive and negative
receipt controls for the original predicates. A native timeout supplies timeout
fields; complete output/retained-report controls are deliberately simulated.
These control cases are not actual-product migration acceptance. The installed
probe supplies the real CLI cases separately.

The fixtures seed historical HARNESS_VERSION markers, not complete historical
package installations. Passing them does not prove migration of every existing
user workspace, rollback, full E2E/npm coverage, performance under the original
runner load or public-release readiness. This is optional targeted acceptance,
not a new mandatory gate or validation framework.
