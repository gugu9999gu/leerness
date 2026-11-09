# Resume-state storage errors

`resume` reads `auto-resume-plan.json`. The existing wakeup diagnostics and
status-update paths read `active-wakeups.json`. These are local records; reading
or writing them does not create an external scheduler or execute a model.

Malformed JSON/UTF-8 is reported as `store_corrupt`. Unsupported schema versions,
invalid known fields, oversized or unsafe input is `store_invalid`. Unreadable
input and changed sources remain errors. Keep the original file before repairing
it. Do not delete, force-reset or replace a damaged store with an empty one just
to make the command succeed. There is no automatic repair in this change.

Each write uses the existing per-file lock and compares the source before
publishing. It preserves valid BOM, line endings and extension metadata. Another
writer's changed bytes are not overwritten. Wakeup updates use the latest state
under the lock and retain the existing deduplication and last-20 behavior.

`session-resume` reports unavailable state as a diagnostic signal. With
`--auto-fix`, an attempted write failure appears separately in `autoFixErrors`,
not as a successful repair, and the process exits nonzero. The normal diagnostic
read can exit zero while reporting findings: inspect its signals rather than
interpreting exit zero alone as a clean state.

If a release reports that publication already succeeded but saving resume state
failed, do not infer the package was rolled back or automatically publish again.
Check the actual publication status before deciding on a retry. These two local
files are not committed as one multi-file transaction. A partial update is possible;
original-file preservation is not an exactly-once scheduling guarantee.
