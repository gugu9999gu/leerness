# Explicit task history retention

`context history` previews selected terminal task rows, retains their original bytes,
and restores an unchanged retained operation. It does not infer that old prose,
rules, review criteria or evidence can be deleted. Automatic retention and actual
project rollout remain separate work.

Use `--path PROJECT` to choose a project. The default is the current directory.

```
leerness context history preview --tasks T-0002,T-0003 --json
leerness context history apply --tasks T-0002,T-0003 --expect PREVIEW_DIGEST --json
leerness context history preview-restore --operation OPERATION_ID --json
leerness context history restore --operation OPERATION_ID --expect PREVIEW_DIGEST --json
leerness context history status --json
leerness context history preview-recover --operation OPERATION_ID --json
leerness context history recover --operation OPERATION_ID --expect PREVIEW_DIGEST --json
```

Preview is read-only. Apply requires the exact preview digest; changing the task
selection, reason, source bytes, file identity or index invalidates that digest.
Only explicitly selected `done`/`dropped` rows in one canonical managed progress
table are eligible. Unsupported rows, ambiguous table boundaries, selected IDs in
surrounding prose, and references from open task rows stop the operation. Other
references continue to resolve through the verified retained-history index; this
is not an exhaustive dependency-graph analysis.

The progress tracker lock is shared with existing task writers. Original and
prepared files plus an immutable manifest are retained under
`.leerness/archive/history/<operation-id>/`. A small
`.leerness/history-operation.json` journal fences normal history reads and new
task-ID allocation throughout multi-file publication. The index is published
before active rows are removed. Separate file replacements are not one atomic
transaction, and no power-loss or hostile-writer protection is claimed beyond
the existing checked file publisher and cooperative locks.

After completion, ordinary history reads also require the latest operation's
manifest, completion receipt and expected index digest. If any of these is
missing or changed, status reports incomplete history and task-ID allocation
stops. A missing archive directory cannot be mistaken for a new empty project.
The tracker is checked again before a task list is printed so a concurrent
restore cannot silently omit previously retained tasks.

An interrupted operation remains explicit. Recovery preview accepts only the
recorded before/after file states and verified recovery artifacts; recovery
finishes the original action. It never guesses a different operation or silently
rolls back new work. If preparation stopped before the artifacts were complete,
the unchanged original files can reconstruct them. Unknown states, malformed
records and missing required originals produce a conflict with a recovery path.

An abrupt process termination can also retain the shared progress lock. The lock
stays only while the history journal is pending: a kill with no journal, or with a
complete one, is reclaimed by the next writer once its owner is proven dead (see
[state-store-locking](state-store-locking.md)). With a pending journal, status
reports the blocker and recovery refuses to remove the lock itself. Stop all
writers, including writers on other computers, and independently establish that
the recorded owner has ended. Preserve the pending journal, original manifest and
artifacts, and the exact lock owner record. An old timestamp or PID alone is not
proof; unknown ownership, links or changed recovery material require a stop.

For an explicitly approved recovery, retain the whole confirmed-ended
`.leerness/progress-tracker.md.lock` directory by moving it to a unique, previously
absent location on the same filesystem. Verify both absolute paths, refuse an
existing destination, and compare the retained owner bytes and filesystem identity.
Do not delete the lock or recovery evidence. Request a fresh `preview-recover` for
the original operation ID, then run `recover` with that exact digest. The existing
checks refuse unknown current states and changes since the preview rather than
overwriting later work. Keep writers stopped throughout: the observations and
manual move are not atomic. This feature does not add a lock takeover API.

The same kill can leave a retained file, such as `history-operation.json`, with a
second name, because a publish links the new file into place before it removes its
temporary name. The reader refuses a file with two hard links. When a name
`.<name>.publish-<pid>-<24 hex>` beside it is the same file, `status` and
`preview-recover` say so and name it: deleting that name is safe and the bytes stay
under the other one. Both commands only read, and neither removes it. Reclaim does
this itself for a lock it clears; the message is for the case where a person
deleted the lock first.

Restoration requires the operation's unchanged post-image. New work is preserved
by refusing an overlapping restore; automatic merging is not implemented. The
original tracker bytes, including line endings, BOM, Korean text, escaped pipes
and user symbols, are restored exactly. A formerly absent index becomes a valid
empty index so retained recovery files cannot look like missing history. Restore
keeps originals and receipts; neither operation permanently deletes anything.

Replaying the same completed operation returns its recorded completion without
creating another archive. That receipt is historical evidence, not a claim that
all later files still have the same content. Exact archived-task lookup continues
to validate source and row hashes.
