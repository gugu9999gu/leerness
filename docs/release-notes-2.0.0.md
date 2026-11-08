# Leerness 2.0.0 — UNRELEASED candidate

The public npm/GitHub release observed on 2026-11-08 was **1.36.305**.
This document describes the **2.0.0 candidate**. A source version, local tarball
or successful private validation does not establish publication or release
approval. Existing 1.36.305 users do not need to install this candidate.
The historical 1.36.306 development notes are not a public patch release.

## Intentional compatibility changes from 1.36.305

These are observable command and consumer changes, which require a major
transition. They are distinct from the correctness fixes listed below.

| Surface | 1.36.305 | 2.0.0 candidate and required consumer action |
| --- | --- | --- |
| Ordinary handoff, including `--compact` and `--json` | Normal handoff writes session/freshness receipts unless suppressed with `--no-record` or hook mode. Tracked projection updates already require `--writeback`. | Reads stored context without recording or diagnostic inventories. Use `--record` when a session/freshness receipt is required. A read-only session is invisible to others. |
| First read without Leerness caches | Handoff can enter diagnostic and recording paths. | The ordinary stored read stays free of session, environment-cache and usage writes and does not automatically migrate `.harness`. Cold-read behavior is not a latency guarantee or a flushed OS-cache measurement. |
| Handoff diagnostics and JSON | The ordinary path collects legacy diagnostics and can include fields such as `envInfo`. | Default JSON retains stored `files` and `memorySurface`, adds `nextTask`, and reports `inspection.status: "not_inspected"`; diagnostic fields may be absent. Request `--inspect` and handle partial/unknown observations. `--inspect --compact` is rejected. |
| `doctor --json` | Runs selftest and reports boolean `healthy` from its outcome. | Environment-only by default: `selftest.status: "not_run"`, pass/total `0`, `selftest.ok: null`, `healthy: null`. Handle true/false/null; exit 0 with no tests is not a pass. |
| Generated project guidance | Templates require recurring handoff, checks and session-close steps. | Newly generated canonical guidance uses relevant Leerness tools optionally and reuses host planning/testing. Explicit owner and project policies still apply. This does not silently rewrite installed custom instructions. |

Ordinary reads do not run environment/provider inventories or require network
access. Git location discovery and Windows console setup are separate platform
operations. Compact output is a context summary; it is not evidence of rule
compliance, test execution or completion. Reuse current rule text or retrieve
missing instructions before acting.

Choose effects explicitly:

```sh
leerness handoff . --compact       # stored context
leerness handoff . --record        # session and freshness receipt
leerness handoff . --inspect       # diagnostic view
leerness handoff . --writeback     # legacy diagnostics and state updates
leerness doctor --json             # environment observation; selftest not run
leerness selftest --json           # explicit integrity tests
```

These commands are alternatives for the needed outcome, not a required chain.
`--no-record` suppresses recording even when it was requested. `--inspect`
does not itself request a session receipt; `--writeback` also records unless
suppressed and can refresh tracked projections. Doctor's existing explicit
opt-in is the environment variable `LEERNESS_DOCTOR_SELFTEST=1`; there is no
`doctor --selftest` flag.

MCP handoff remains read-only without its explicit `sessionKey`. Supplying that
identity requests recording under the existing validation and write permissions;
it grants no new authority. Existing freshness hooks need an explicit receipt
from the intended session. Reinstall generated hooks only after reviewing their
changes on a project copy. See [the consumer transition matrix](lean-readonly-compatibility.md)
and [exact read/flag effects](lean-readonly.md).

## Correctness fixes and limits

Stored-input reads and state writes more consistently reject changed,
unreadable, malformed, conflicting or unsafe inputs instead of reporting a
normal empty state or overwriting originals. Bounded Windows long-path
publication and external-recovery containment failures were corrected.
Owner, identity, lock and compare-before-write checks remain applicable.
This is not a claim of atomicity across every file or recovery from arbitrary
divergent stores.

New canonical Cursor rules put frontmatter at the start of the `.mdc` file and
use `alwaysApply: false` with a relevance description. Retained owner-authored
rules keep their applicability. File preservation and generated-text tests do
not prove that a particular installed Cursor, Claude, Codex or Copilot version
applies the instructions to the intended work. Check the actual target tool.

Leerness declares Node.js 18 or newer. Local suites and isolated
1.36.305-to-candidate installation/rollback checks are bounded to the exact
artifact and tested environments. Hosted support-matrix and macOS acceptance
remains incomplete for this candidate. A changed package needs fresh artifact
digests and relevant installation checks; results for an earlier tarball do not
automatically transfer. No universal speedup or full support-matrix pass is
claimed.

## Upgrade with originals preserved

Wait for an approved published release and its exact artifact integrity before
updating a real project. Check the registry version rather than inferring it
from this checkout:

```sh
npm view leerness version
npm view leerness@<approved-version> dist.integrity
```

1. Stop the project's Leerness CLI/MCP/agent writers. Do not terminate unrelated
   applications or every Node process.
2. Retain the old package version and original installation artifact. Make a
   complete separate project snapshot, including hidden and untracked files.
   Preserve `.leerness`, legacy `.harness`, `.leerness-backup`, archives,
   operation receipts, locks, settings, `AGENTS.md`, `CLAUDE.md`,
   `.cursor/rules/leerness.mdc`, `.github/copilot-instructions.md`, and any
   other custom instruction files. Git clone alone may omit these originals.
3. Verify the snapshot is readable and its original file hashes match. Keep it
   unchanged; rehearse with another copy and an isolated installation prefix.
4. On that copy, preview the project update with
   `leerness migrate --path <project-copy> --dry-run`. For a legacy workspace,
   inspect `leerness migrate-workspace-dir <project-copy> --dry-run` separately.
   Apply only the chosen migration after reviewing its changes. Package install
   alone does not regenerate every project instruction or migrate all data.
5. Compare user-authored instructions, Cursor frontmatter/settings, canonical
   memory and backups before accepting the update. Check CLI/MCP behavior,
   explicit receipt hooks, JSON consumers and the actual editor's applicability.
   Repeated migration must not erase originals or existing backups. Apply the
   same approved version to the real project only after the rehearsal succeeds.

Only known canonical generated guidance is softened. Custom text and
migration-preserved originals remain intact; softened global guidance does not
disable an owner rule. Keep any preserved older requirement
until the owner explicitly resolves a conflict.

See the [installation guide](release-candidate-guide.md) for pinned install and
verification commands. Do not use a forced reset, `git clean`, or backup/lock
deletion as an update step.

## Roll back package and data separately

If an upgrade fails, stop writers and preserve the failed/new state and logs
first. Keep newly created user data intact. Install the retained previous
package into an isolated prefix, then run it against a separate copy of the
**pre-upgrade snapshot**. A successful package downgrade does not prove that the
older writer understands newer data.

After a successful rehearsal, an owner may choose to reinstall the previous
published package, for example `leerness@1.36.305`. Restoring project data is a
separate explicit operation using the verified snapshot and any reviewed later
changes. Never automatically overlay the old snapshot on newer user data,
change version markers to force admission, or combine canonical/projection
files from different states. If authority or compatibility is uncertain,
retain both copies and stop.

## Interrupted operations and retained backups

Preserve the entire lock ownership record, operation receipt, immutable source
archive and recovery evidence after an interrupted memory/history write. Do
not delete a recovery-held lock to force a retry. Establish that the original
owner is dead, stop other writers, and use the matching operation's explicit
[memory recovery](memory-migration-write.md) or [history recovery](history-retention.md)
procedure. Unknown ownership, conflicting later edits or an unproven canonical
source require a stop. These procedures do not guess the correct source or
make the complete multi-file operation atomic.

Automatic test-directory cleanup remains disabled. Retained temporary files
can consume space, but neither an update nor rollback authorizes deleting old
data, originals or backups. See [cleanup safety](memory-cleanup-safety.md).
