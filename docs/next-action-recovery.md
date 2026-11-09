# Next-action queue recovery

`next-action take [index]` creates or reuses a task; the stored suggested command
is data, never executed. The queue lock covers fresh selection, the bounded task
child process and final removal. Non-integer, negative, excess and out-of-range
indices are refused. Leading non-letter decoration is removed from the task title;
the existing 100-character limit now counts Unicode code points.

`--json` on take returns `ok`, `taskId`, `existing`, `index` and the selected action.
Task add also returns a JSON receipt when it reuses an existing active task.
Add and clear return JSON instead of mixing text into JSON output.

Malformed JSON/UTF-8 is `store_corrupt`; invalid shape, unsupported schema and
oversized state is `store_invalid`. Read errors are not absence. Queue reads do not
initialize a workspace. Valid updates retain unknown metadata, BOM and line ending
style. Default handoff still reads only. No migration or automatic repair is added.

## Failure recovery

- `task_add_failed`: task creation was not confirmed; this command did not remove
  the queued action. A killed or timed-out child can have already written a task.
  Inspect `task list --json` before retrying; do not assume no task exists.
- `task_created_queue_pending`: `taskId` identifies a confirmed task, but final
  queue removal was not confirmed. Inspect both the tracker and queue, retaining
  any original or concurrent bytes. Do not delete the created task automatically.
- A retry reuses an active matching task through the existing task-add deduplication.
  That is not exactly-once processing. A completed, renamed, blocked or removed task,
  a manually edited queue, different long titles with the same truncated prefix,
  or a process crash can require manual reconciliation. No multi-file transaction
  or stable action identity was added.

Existing security/path/lock/CAS and dry-run refusal remain in force. A corrupt file
must be repaired from verified original bytes, not replaced with an empty default.
