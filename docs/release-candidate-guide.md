# Install, update, and roll back Leerness

Use the exact version and artifact integrity from an approved release. A version
in a source checkout or a local package is not proof that npm has published it.
Check the registry before choosing a version:

```sh
node --version
npm view leerness version
npm view leerness@<approved-version> dist.integrity
```

Leerness requires Node.js 18 or newer. Use a Node version covered by the release
verification record. A successful command on one OS or Node version does not
establish every supported combination.

## Before an update

1. Stop agents and other writers using the project.
2. Keep the current package version and its original installation artifact.
3. Make a separate copy of the entire project, including hidden and untracked
   files, `.leerness`, older workspace directories, settings, and backups.
4. Verify that this copy is readable and retains the original file hashes.
5. Test the update on another copy. Keep the original project and its copy.

Do not use `git clean`, a forced reset, or deletion of `.leerness` or a lock as an
update or recovery step. Git does not necessarily contain untracked user data.

## Install and verify

For a published release:

```sh
npm install -g leerness@<approved-version>
leerness --version
leerness which --json
leerness doctor --json
```

For an explicitly approved local candidate, install its exact `.tgz` into an
isolated npm prefix first. Check its digest against the supplied manifest before
installation. Do not substitute an unverified archive with the same filename.

`which` identifies the running installation. `doctor` reports observations and
may return `healthy: null`; that is not a passing test suite. If requested, run
`leerness selftest --json` separately and verify its complete results and exit
status. Keep failures and temporary recovery evidence.

## Upgrade a project

Installing another package version does not by itself migrate or restore all
project data. On the isolated project copy, use the installed version's explicit
migration command:

```sh
leerness migrate --path <project-copy>
```

Compare user-authored `AGENTS.md`, `CLAUDE.md`, Cursor rules, Copilot instructions,
settings, canonical memory, and existing backups before accepting the result.
Run the migration again only to verify the documented idempotence contract; an
unchanged result must not remove existing backups. Retained file contents alone
do not prove that an external editor applies a rule to the intended files.

The major read-only transition changes default recording and diagnostic
behavior. See [the consumer transition guide](lean-readonly-compatibility.md).
`--record`, `--inspect`, `--writeback`, and an MCP `sessionKey` have different
effects and are not interchangeable.

## Roll back without discarding newer data

Keep the upgraded project intact. Restore the previous package version in an
isolated prefix first, then verify it against a separate copy of the project
snapshot taken before the upgrade. Do not point an older writer at newer data
merely because installing the older package succeeded.

After a successful rehearsal, an owner can explicitly choose the previous
published version:

```sh
npm install -g leerness@<previous-version>
leerness --version
```

Package rollback is not automatic project-data rollback. If the old version
refuses the current metadata, retain both copies and stop. Never change a
version marker or combine canonical and projection files to force admission.
Data created after the snapshot needs its own reviewed recovery decision.

## Interrupted operations

Stop other writers and retain the exact original files, operation receipt,
manifest, and lock evidence. Establish the original owner is dead before any
explicit lock-handling step. If that cannot be established, stop.

Use the operation's existing preview and explicit recovery commands with the
matching immutable authority artifacts. Follow [memory migration recovery](memory-migration-write.md)
or [history recovery](history-retention.md) for that operation. These procedures
do not authorize guessed repair of an unrelated divergent store pair, and they
do not make the whole multi-file operation atomic.
