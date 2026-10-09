# Explicit handoff date writeback

The full text form of `leerness handoff . --writeback` updates the first
`Updated: YYYY-MM-DD` match in an existing `.leerness/current-state.md`.
It now captures that document under its existing state lock and uses the
[managed text boundary](managed-text-storage.md) to check and publish the edit.

- Malformed UTF-8 and sources exceeding 4 MiB are rejected before this save.
- Normal Unicode, user symbols, existing UTF-8 BOM and line endings are preserved.
- Other dates and user notes remain unchanged. A missing date is not inserted.
- An absent document, including one removed before capture, is not recreated.
- Identical output retains the file bytes and modification time.
- A changed or removed captured source is rejected. Publication also checks the
  target and its parent using the existing publisher.
- `--force` does not bypass these checks. `--dry-run` still rejects a write
  attempt without publishing the document.

The lock coordinates Leerness writers that use the same lock. It does not lock
out every external editor. A failure during or after publication can leave a
changed target or recovery artifacts; inspect the error and preserved files
before retrying. A failed call exits nonzero and does not print the final
`handoff loaded` message. There is no rollback or whole-handoff transaction.

The final success message says only that context was loaded. It no longer claims
the state document was updated when no update occurred.

## Existing scope

Default handoff and hook calls do not update this date. The existing JSON,
compact and pulse forms also skip this date edit, even with `--writeback`.
This change does not broaden those paths. `--no-record` suppresses the session
recording gate; it does not cancel explicit date writeback.

Other handoff effects, including session presence, legacy handoff history,
environment snapshots, reminders and optional generated reports, remain
separate. Earlier effects are not undone if the date save fails. Their
validation and success reporting are not certified by this change.

The 4 MiB limit applies to the captured edit and its output, including a BOM.
Earlier context rendering and other observation readers have separate limits.
This is not whole-command memory bounding, sentence validation, automatic repair
of historical corruption or protection of every remaining writer.

Run the focused real-CLI regression with `npm run test:handoff-text`. It uses
temporary projects and homes, including malformed/stale input, valid Unicode,
size limits, no-op preservation, final publication conflicts and existing
no-date-write modes. It does not call an AI model.
