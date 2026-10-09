# Audit ignore and environment example storage

`audit --fix` appends missing ignore patterns to `.gitignore` and missing key
names with empty values to an existing `.env.example`. These selected saves use
the existing audit text helper, canonical target lock and managed-text publisher.
No additional setting, dependency or storage engine is required.

## Source preservation

The target is captured under its lock, then missing entries are recalculated
from that captured text. Invalid or truncated UTF-8, unsafe file identity,
detected concurrent changes and inputs/candidates above 4 MiB are refused.
The limit includes any UTF-8 BOM. Valid Unicode, user symbols, existing values,
comments and original line endings remain intact. New lines use the first
observed LF/CRLF style, defaulting to LF for a file without a newline. Generated
comments use plain English. Identical output does not rewrite the target or
count a saved fix. `--force` cannot bypass checks; dry-run rejects the edit
before creating lock metadata.

An absent `.gitignore` can still be created, including when removed before
capture. An absent `.env.example` is still skipped, including disappearance
before capture. Disappearance after capture is a conflict for either target.
Creation rechecks observed absence and refuses a detected competing creation.

Ignore repair only observes `.env` presence; it does not decode private values.
Its existing exact/trailing-star and optional leading-slash coverage policy is
unchanged. It is not a complete implementation of Git's ignore/negation rules.

Example repair captures `.env` as a checked read-only source under the target
lock, decodes strict UTF-8 within 4 MiB and checks the same source again before
publication. A missing source skips the repair. Only recognized key names are
appended, with empty values. Source contents are never copied into diagnostics
or receipts. Original key grammar is shared with `env check`: case-preserving
ASCII identifiers followed by `=`, unique names in first-seen order; comments,
invalid names and `export NAME=` remain outside the existing parser's grammar.
The private source is not modified and does not require a new source lock.

## Honest results

Only confirmed publications increment `fixed`. Warnings still describe the
initial observation, and strict warning promotion keeps its existing meaning.
`fixApplied` continues to mean that `--fix` was requested.

A save error stops subsequent audit work with a nonzero exit, `healthy:false`
and `incomplete:true`. The finding is `gitignore_fix_failed` or `env_fix_failed`
and includes the target, phase, cause code, source path when relevant, confirmed
earlier timestamp/README/environment saves, and available recovery details.
JSON mode remains one JSON document without human stderr. Human output identifies
the failed target and warns that publication may already have changed it.

Earlier saves remain in place; these files are not one transaction. A late
failure does not imply an unchanged target. Preserve any reported recovery
artifacts and inspect the target before retrying. Existing timestamp and README
failure shapes remain compatible.

## Limits and tests

Checks cannot exclude every external race, writes after the final observation,
changes through displaced descriptors or power loss. General observation reads
remain separate and are not covered by the selected 4 MiB save boundary. Files
with no eligible fix are not certified as valid text. Generic `env sync`,
historical text recovery and remaining E3 writers have separate scope.

`npm run test:audit-env-text` exercises the real CLI and direct library fallback
in temporary projects and isolated homes, using invented environment values.
It covers malformed/valid text, source changes, absence/creation, conflicts,
partial failures, key-only output, repeat/no-op behavior and existing options.
