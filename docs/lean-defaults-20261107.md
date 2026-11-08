# Lean defaults and original-source preservation

Leerness-generated guidance favors the host agent's planning, worktrees, code
review, and test tools. It does not require a new approval pipeline for every
message or task. Project-specific rules and explicit owner instructions remain
authoritative.

## Generated guidance and existing projects

Only recognized generated instructions may be refreshed automatically. Unknown
or user-authored text, preserved blocks, settings, and backups must remain.
Existing custom Cursor frontmatter is policy, not disposable decoration; its
description, globs, and applicability must not silently move below another
frontmatter header. Check the actual editor separately after migration.

New generated defaults favor relevant source reads and actual focused tests.
They do not silently disable existing security, permissions, data-integrity,
review-independence, or deployment requirements. Optional task assessment and
review packets do not authorize a release.

## Read-only defaults

Ordinary context reads do not create a session receipt or perform every optional
diagnostic. Request `--record`, `--inspect`, or `--writeback` only for their
documented purpose. MCP recording also requires the existing explicit session
identity and write permissions. A missing diagnostic or `healthy: null` is not a
passing functional test. See [consumer compatibility](lean-readonly-compatibility.md).

## Data migration

Establish which data is authoritative before migrating it. List actual writers,
readers, schedules, external effects, and owner authorization. A file inventory
alone does not establish a safe authority change.

Preserve source bytes, identifiers, values, and recovery evidence. Temporary
compatibility copies need an explicit reason and a reviewed retirement plan;
they must not be removed merely because a newer schema exists. Test controlled
read/write cutover, permissions, idempotence, interruption, and rollback.

If files disagree and authority cannot be established, stop. Do not guess a
canonical file or merge the contents automatically. Supported explicit recovery
procedures still require the original matching operation artifacts.

## Backups and validation

Backups may contain untracked user files that Git cannot reconstruct. Inspect
their paths, links, identities, sizes, and restore behavior without deleting
them. Any cleanup is a separate explicitly authorized operation.

Keep executed tests, source revisions, exit codes, failures, and untested scope
separate. A diagnostic result is not release approval, and one environment does
not establish all supported OS or Node combinations. For installation and
rollback, see [the release guide](release-candidate-guide.md).
