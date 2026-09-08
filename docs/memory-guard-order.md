# Memory JSON syntax guard ordering

Followup to 1.36.188; not part of that frozen release. This is a narrowly scoped
bug fix, not the complete memory admission or runtime migration design.

## Contract

`decision add/drop`, `lesson save/drop` and `memory restore decisions/lessons`
call the existing `_assertStoreParsable` inside their existing canonical operation
lock, before fallback loading, duplicate/target selection or archive/active
Markdown writes. The save-time guard remains as defense in depth.

When that guard detects an existing malformed or blank JSON file, the operation
fails before these handler-domain changes. Duplicate requests and `--force` do
not bypass it. CLI `--json` returns the existing `store_corrupt` error code for
all five handlers, using the same wrapper as add/save. Invalid input arguments
can still fail before the operation lock is entered.

Read-only list fallback, valid duplicate rules, plan restore and positively
missing canonical fallback retain their existing behavior. This patch does not
change the shared guard predicate or error-code vocabulary.

## Evidence and boundary

`scripts/memory-guard-order-probe.js` executes real CLI processes in owned fixture
directories. Its 44 checks cover both stores, malformed/blank JSON, new/duplicate/
forced writes, matched/unmatched drop/restore, restore aliases, valid mutations,
canonical unknown-field survival on add, and existing read/missing fallback.
Rejected cases compare bytes and mtimes of both stores' canonical, Markdown,
archive and selected task/evidence/handoff files. Fixtures/results are retained
under the printed temporary path for debugging.

Before the fix, 20/44 passed; afterward 44/44 passed on Windows Node26.3.0.
Independent baseline byte comparison confirmed that failed drops changed archive
files and failed restores changed active Markdown. Probe wiring joins full/core/
fast/command suites; these are entry points, not independent aggregate counts.

No claims are made about full schema validity, strict UTF-8, bounded reads,
uncertain existence checks, external-writer races, lossless legacy migration,
multi-file transactions, or later write failure rollback. Startup bookkeeping
and lock artifacts are outside the selected domain-file snapshot. Existing
canonical-to-Markdown restore and archive retention limitations remain open.

The multi-agent consensus writer in `lib/agents.js` still appends to lessons
Markdown separately; it is not covered by this canonical CRUD patch. MCP uses
these CLI handlers, but its own tool result formatting is a separate contract.
