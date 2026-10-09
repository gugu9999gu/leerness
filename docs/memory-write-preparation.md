# Prepared memory writes

The decisions/lessons CLI writers now prepare their outputs once and publish those
same bytes. Existing canonical locks, active-record validation, duplicate/force
handling, selection, lossless drop archives and restore-conflict checks remain in
the command handlers. This does not enable default size limits or a new command.

`lib/memory-write-preparation.js` is an internal writer module with three functions:

| Function | Contract |
| --- | --- |
| `prepareMemoryWrite(root, surface, entries, input, archive)` | Requires the existing checked input and caller's canonical lock. Serializes the candidate, validates the serialized array, prepares its projection and optional archive, captures targets and rechecks the original inputs. Returns an opaque in-process handle. |
| `assessPreparedMemoryWrite(handle, limitsJson)` | Passes the prepared canonical JSON and archive operation to the read-only cost assessor and rechecks the original prepared inputs before and after. Returns cost metadata with `preparedBytesUsed` and `originalInputsRechecked`. |
| `publishPreparedMemoryWrite(handle)` | Consumes the handle, rechecks inputs/targets and publishes the prepared bytes using the existing checked publication backend. A handle cannot be reused after a publication attempt, including a failed attempt. |

The handle exposes only frozen `surface` and `operation` metadata. Its source
captures and output buffers live in a private WeakMap. A JSON copy, another object
with the same fields, or a public diagnostic result is not a valid handle. This
is an implementation integrity check, not a user authorization system. The module
does not acquire or prove ownership of a lock; callers must keep the canonical
operation lock through preparation, assessment and publication.

`archive` is null for update. A drop supplies `{path, text}` or explicitly sets
`mode: 'append'`. A restore supplies `{path, text, mode: 'replace', input}` where
`input` is the checked capture of the present archive used for selection. `path`
must name that surface's archive under the existing writer workspace. The module
does not independently select records or prove that arbitrary caller entries and
archive text preserve the intended semantics.

Canonical JSON is serialized once. The projection is generated from the parsed
serialized candidate, so a later change to the caller's array, unknown extensions
or archive options cannot change the prepared outputs. The existing generated
prefix and opaque-suffix preservation rules still apply. Record validation also
applies to the serialized array. Original JSON number/serialization behavior is
retained; this is not a raw JSON fidelity guarantee.

All output targets are captured before the final preparation checks. Recovery
`before` bytes are copied from these admitted snapshots; a later raw read cannot
relabel another writer's bytes as the original. Partial failures still use the
existing recovery receipts with before/live/cause artifacts. Update publishes
canonical then projection; drop publishes archive then canonical then projection;
restore publishes canonical and projection before rewriting archive. Existing
`restore-active` and later `restore` receipt stages and completed markers remain
distinct. There is no automatic multi-file rollback guarantee. Plan/milestone
Markdown restoration continues through its existing separate path.

All targets pass the existing write-permission check before publication begins.
A dry-run refusal keeps its original error code instead of being classified as
an output race. Duplicate commands that never prepare a write keep their no-op
behavior. Publication attempts still consume their handles when rejected.

The optional assessment is **advisory**. An exceeded/unsupported cost result does
not consume the handle or silently activate a writer policy. The caller must decide
how to use it. The returned cost result still has `candidateRelationVerified: false`
and `approvalGranted: false`. The new flags identify which prepared data was used
and which original inputs were rechecked, not semantic approval or disk reservation.

The writer's existing reads, serialization, parsed candidate copy and original
snapshot rechecks remain unbounded by a new operating policy. In particular, this
wrapper does not turn the diagnostic ceilings in
[the cost API](memory-write-budget.md) into a bound on the entire preparation or
assessment call: original writer checks also perform their existing reads. Legacy
opaque notes can remain writable under the old preservation rules even when the
cost observer returns `legacy_migration_required`.

Limits before initial parsing/allocation, admission for shrinking an oversized
store, failure/cleanup recovery costs and environment-specific budgets remain
separate work. Original checks and filesystem metadata are not an atomic snapshot,
containment fence or protection against every external change after the final check.

An explicit internal [write admission path](memory-write-admission.md) now supplies
processing budgets before initial parsing and complete output preparation, with a
separate target/reduction policy. The default command path described above retains
its existing behavior. Backend/failure resource bounds remain separate.
