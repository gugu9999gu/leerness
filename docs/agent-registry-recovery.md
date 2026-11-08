# Provider and slash-command registry errors

The project settings files `.leerness/providers.json` and
`.leerness/agent-slash-commands.json` are not treated as empty when they exist
but cannot be safely read. A missing file can still be created explicitly.

`store_corrupt` means invalid JSON or UTF-8. `store_invalid` means an unsupported
schema/shape, a file larger than 4 MiB, or an unsafe file/link. `store_unreadable`
means the checked file could not be read. `store_changed` means its contents or
identity changed while the operation was being prepared. Publication errors
may have a distinct `output_*` code. No automatic rewrite is a recovery step.

Keep the original bytes and any previous backup. Check the reported file,
permissions and intended schema. Restore a known-good copy or make an explicit
reviewed repair, then retry the original command. Do not fix an invalid file by
silently replacing it with an empty object or by removing its lock. Unknown
future schema versions are refused, not migrated automatically.

Provider documents require a `providers` array of objects with nonempty string
`id` values. Optional text fields must be strings or null; `versionArgs`, when
present, must be an array of strings. Slash documents require an `agents`
object whose definitions contain a `commands` array; each command requires a
nonempty string `cmd` and optional string/null `desc`. Omitted schemaVersion or
schemaVersion 1 is supported. Additional metadata is retained by normal edits.
Existing provider identity and executable argument safety checks still apply.

`slash-commands --record --force` explicitly resets a valid slash registry to
built-ins. It does not override corrupt/unreadable input protection. A normal
record, provider edit, sync or refresh retains unrelated extension metadata.
Concurrent changes are read again under the existing lock; if a later input
change is detected, publication is refused. This is not a multi-file transaction
or a guarantee against arbitrary malicious filesystem races or power loss.

Optional regression command: `node --test scripts/agent-registry-store-probe.js`.
It uses isolated temporary fixtures and mocked provider responses. It does not
need a paid provider account, modify the user's installation or run by default.
