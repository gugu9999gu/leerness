# Execution ledger storage boundary

`appendExecutionEvent` writes the complete JSONL event and synchronizes that
file descriptor with `fs.fsyncSync` before returning success. New ledgers use
an exclusive temporary file, synchronize it, close it, then publish through
the existing exclusive hard-link path. Existing ledgers synchronize the same
append descriptor before the final file and parent identity checks.

A synchronization failure throws `ledger_sync_failed`. A write or close error
also prevents a successful return. The first write/synchronization error is
preserved if closing the descriptor subsequently fails. No synchronization
retry, truncation, or rollback of appended history is performed.

The outcome after an append error can be uncertain: the bytes may already be
complete, or an earlier write failure can leave an incomplete line. Preserve
the ledger and inspect it before recovery. Do not blindly call append again.
The existing reader and append admission reject malformed history; they do
not repair it. A complete event recovered after a process dies is evidence
of its stored bytes, not proof that the original caller received success.

This is a file synchronization boundary, not a power-loss guarantee. It does
not synchronize directory metadata, provide hardware guarantees, make Git
refs and JSONL writes one transaction. Appends now take the [shared state
lock](state-store-locking.md) by default; `withExecutionLedgerLock` holds that
same lock across multiple operations. `appendExecutionEvent` does not
deduplicate event IDs or grant reviewer independence/approval.

`node scripts/execution-ledger-sync-probe.js` checks real file writes,
synthetic write/sync/close failures, short writes, retained incomplete lines,
and fresh-process reads after writer termination. `--filter <substring>`
selects a smaller set; an empty selection or unsupported arguments fail.
Process termination tests do not test physical power loss. Required related
checks include role-file identity, role fallback, runtime write admission and
UI review ledger correlation. They supplement the final CI gate.
