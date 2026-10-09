# Handoff reminder storage

The existing `handoff --writeback` reminder branch now shares the reminder path's canonical lock for both generation and cleanup. Default handoff, JSON, pulse, hooks and disabled drift checks keep their existing no-reminder-write behavior. This does not change drift thresholds, runtime history or other handoff writes.

An absent reminder can be generated. Existing content is refreshed or removed only when its complete first line is the known generated marker and the remaining body's existing 16-character SHA-256 prefix matches. Edited headers, appended notes, old markers without hashes, similar markers and ordinary user text are preserved with a notice. This detects accidental edits; the marker is not an authenticated ownership or approval token. No automatic merge, repair or reconstruction of user text is attempted.

Refresh uses the shared strict captured reader and checked publisher. It preserves UTF-8 signatures and the first LF/CRLF style, computes the marker from the actual rendered body, and rejects invalid Unicode, oversized input/output and detected source changes. New reminders use plain headings without decorative emoji; meaningful symbols in user text are retained. Both refresh and cleanup limit source input to 4 MiB and refuse ambiguous file types/links. Cleanup strictly decodes its captured source and rechecks its bytes, identity and parent just before unlink.

Node does not offer conditional unlink. Cooperating writers share the lock, but a non-cooperating external writer can still change a file between the final check and deletion. This is not a filesystem transaction, secure authentication or a claim that every external race is prevented. No deletion rollback or durable recovery receipt is introduced.

Explicit reminder storage failures stop that handoff before its success message and produce a nonzero exit. Details include file, action, phase and available publication/recovery flags. Cleanup distinguishes an attempted removal from a confirmed successful unlink; an exception after unlink may leave the file absent without confirmed completion. Lock-release failures retain confirmed publication/removal state. Earlier unrelated handoff work is not rolled back. Normal preservation of authored content is not an error.

`npm run test:reminder-text` runs actual CLI and library behavior in temporary projects with isolated homes, including ownership, Unicode, read-only modes, failure injection and concurrent refresh/cleanup. It does not invoke coding agents or modify real installations.
