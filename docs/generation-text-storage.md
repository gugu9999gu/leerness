# Generated instruction storage

The shared `writeIfSafe` boundary used by core install/migration files,
project adapters and the generated update command checks text before replacing
it. Invalid UTF-8 input and invalid Unicode output fail without silently
substituting replacement characters. Existing valid multilingual text and its
UTF-8 signature are retained through the existing publisher.

## File policy and publication

- A canonical per-file lock covers the preserve/merge/create decision, capture,
  merge and publication. It coordinates cooperating writers. Captured text is
  the input to the existing managed merge; no second tolerant read supplies it.
- Existing non-managed files remain preserved unless force permits replacement.
  Such retained files are not inspected or certified valid. A file found after
  the initial existence check also follows preserve-by-default. A competing
  file created after capture causes publication to fail.
- Managed files still merge even when force is requested. Existing template,
  language-switch, user customization and archive-pointer policies remain.
  Protected user state remains excluded from force in the installer. This does
  not change the meaning of managed merge or add a Markdown parser.
- Selected read and candidate output limits are 4 MiB, including a retained
  signature. Unsafe, changed or oversized targets and invalid candidates are
  rejected. Literal replacement characters, Korean, other languages, symbols
  and combining characters are valid. Existing formatting rules may normalize
  CRLF/whitespace within regenerated text; exact whole-file formatting is not
  promised. Byte-identical results keep the existing modification time.
- Core install/migration and adapter generation failures identify the failed
  file and the number of earlier completed file steps. A completed step may
  have preserved a file or produced identical output; it is not a count of
  actual byte changes. Earlier changes and backups are not rolled back.

## Scope and recovery

An install or adapter command is not a multi-file transaction. Backups, runtime
records and earlier file steps may exist when a later file fails. Shared
publication may retain competing content in a recovery artifact rather than
at the original pathname. Inspect the error and named recovery paths before
retrying. The checks do not prevent every external race or guarantee survival
of power loss.

The installer's existing no-op decision and observation-only paths are not
general encoding audits. Dry-run adapter/install calls retain their existing
read-only planning behavior. Other install stages, global adapter installation
and generic text writers remain separate boundaries. README/line/environment merges,
configuration migration and report storage have their own
[installer text checks](install-text-storage.md). This change does not repair
historical mojibake, certify sentence meaning, automatically choose English or change the archive retention
policy.

The implementation reuses `managed-text`, `memory-input`, `memory-output`,
state locks and existing merge logic. No replacement engine or dependency is
added. Run `npm run test:generation-text` for isolated real CLI regressions;
`node scripts/generation-text-probe.js --match adapter` selects adapter cases.
See [shared text checks](managed-text-storage.md) for publication details.

The separate [mode-change path](mode-text-storage.md) now prepares the manifest,
`AGENTS.md` and `CLAUDE.md` together, retaining the existing template subtraction
and merge behavior while reporting preflight and partial-publication failures.
