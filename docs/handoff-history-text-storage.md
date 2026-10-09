# Explicit legacy handoff history

The legacy `.leerness/last-handoff.json` compatibility stamp is updated only by the existing explicit `handoff --writeback` recording gate. Default handoff, `--no-record`, hook calls and pulse keep their previous behavior. The record remains a compatibility observation, not an authenticated session identity or reviewed completion receipt.

The writer captures the file under its existing canonical lock and uses the shared checked text publisher. Invalid UTF-8, malformed JSON, non-object roots, incompatible `last`/`history` fields, unpaired Unicode and non-finite metadata numbers are refused without resetting the file. `last`, when present, must be a parseable date string; `history`, when present, must contain date strings. Empty or older partial objects may be initialized. Inputs and outputs are limited to 4 MiB, including any UTF-8 signature.

A successful record appends the current timestamp and retains the latest ten entries, as before. Unknown metadata, valid Unicode, the existing UTF-8 signature and first LF/CRLF style are retained. JSON uses the existing two-space serialization; arbitrary JSON whitespace, numeric spelling and precision beyond JavaScript's number representation are not preserved. No historical corruption is automatically repaired.

The explicit caller reports history storage errors with a nonzero exit before its successful handoff result. JSON and text errors name the file and phase and retain available publication/recovery flags. Failure during publication may leave saved data or recovery artifacts; a lock-release failure may follow a confirmed save. Inspect those flags and preserved files before retrying. There is no whole-handoff rollback, durable multi-file receipt or exclusion of every external writer.

Per-session freshness and presence records may already have been written before the legacy save fails. Their current recording order, best-effort policy and freshness readers are unchanged. Environment snapshots and other handoff effects remain separate. This change does not certify the integrity of those writers, migrate runtime storage or update real installations.

`npm run test:handoff-history-text` runs temporary projects and isolated homes through actual CLI behavior, including metadata and style preservation, rolling retention, malformed/stale inputs, partial publication, existing gates and concurrent records. It does not call coding agents or deploy anything.
