# Shared stored-read adapters

The legacy tracker remains task authority. This change moves ordinary `handoff`, `task list` and `state show` results into shared synchronous library services. Their CLI handlers and corresponding MCP tools consume the same renderers; ordinary MCP reads no longer launch another Leerness CLI process.

## Compatibility and authority

The existing JSON fields, text formats, task filters/limits/order, retained-task references, session run selection, other-session address masking and MCP character pagination remain. Legacy handoff JSON retains its existing per-document character truncation and is **not** an 8KiB packet. Use `context packet` for that separately defined UTF-8 byte-bounded domain response. Plain/JSON/compact handoff keep the selected owner priority and `not_inspected` observation, not a fabricated diagnostic pass.

Ordinary MCP handoff is a read. Supplying `sessionKey` still explicitly requests the existing recording lifecycle and follows the prior validation/write permission path. `handoff --record`, `--inspect`, `--writeback`, `--auto-recover`, workspace/pulse workflows, state mutations and session close are not silently converted into reads. `--no-record` and hook suppression retain their existing precedence. Those explicit stateful paths may still use CLI children. No existing write permission, owner proof, task/run lock, recovery procedure or publication authority is removed.

The MCP policy/schema/path checks run before direct dispatch. Its prior `safe-write` minimum tier for the handoff tool is retained even for its default read variant; this refactor does not redefine that public permission contract. An empty path is not replaced with the server directory. Invalid session keys remain JSON-RPC parameter errors. Uninitialized task listing remains an error rather than a successful empty list; uninitialized handoff retains its initialization notice. Existing `--quiet` output behavior is preserved, not opportunistically redesigned.

## Request-local session and language

Each MCP request gets a copied environment projection with the existing MCP identity normalization. It never replaces `process.env` or `process.argv`. A session key from one RPC cannot select another RPC's run. Explicit state reads select that session's run, redact other full addresses and do not steal an occupied global run. Existing `currentRunId` and `runsBySession` field meanings are unchanged.

Checked-file error language uses `AsyncLocalStorage.run` for the duration of the direct request. The parent language is restored on return or exception; concurrent asynchronous scopes do not share a language choice. Ordinary CLI language resolution is retained. Reference: https://nodejs.org/download/release/v18.17.0/docs/api/async_context.html#asynclocalstoragerunstore-callback-args . This is request-local language context, not a new task scheduler or background agent.

## Checked selected reads

The shared snapshot reuses the existing checked file reader and runtime resolver. Selected task/plan/rule/document bytes, state/run records and run-directory inventory are captured and revalidated before a buffered response is emitted. Retained task reads observe the existing journal/index/receipt/source inputs; an absent history directory is observed too. Canonical project aliases are supported, and retargeting an alias or replacing a captured directory invalidates that snapshot. No state is rewritten during a read.

Handoff session records in `--json` and `--compact`, preview-store contents, reporting policy/toggles and language inputs join the checked read path. Plain text applies the same link and file checks to session records but does not revalidate them, so another session recording cannot fail the read. `hook session-start` reads them without those checks. Existing unknown/unreadable preview and session observations remain distinct from healthy empty state. Preview mockup validation retains its existing filesystem check; it is not a transaction or permission to read arbitrary mockup contents. Reminder-prefix and migration age checks retain metadata observation rather than claiming an exact digest of an unlimited reminder body. The existing 64KiB reminder prefix cap is not removed.

`agent-reminders.md` is the one section of a plain read that stays on invalid UTF-8 and says so. An automatic reminder is always valid UTF-8, so a file with bad bytes was edited outside leerness and may hold a person's note; that note does not reach the agent through a plain read. The read still loads, and the section says the file is not shown, that it was left unchanged and to save it as UTF-8. The plain read prints no replacement characters. In minimal mode or with `full-reread` off, document bodies are omitted, so the section is not printed. The file's bytes stay in the snapshot and are revalidated like any other selected file, and link and file-type refusals still apply to it. `package.json`, `HARNESS_VERSION` and `migration-report.md` do not stop the read either, but they are skipped with no note. Invalid UTF-8 in the other six sections, `rules.md` or `manifest.json` still fails the read.

`--inspect` and `--record` keep their older reader and still print the file with replacement characters. `--json` reads the reminder through that reader for `agentReminders.head`, the first six cleaned lines, so a bad byte shows only if it falls in them. None of these stops on it. Plain `handoff --writeback` does stop: it exits 1 with no context until the file is valid UTF-8, because it may rewrite or remove the reminder. With `--json`, `--pulse` or `--no-drift-check` it does not.

These snapshots coordinate one selected read, not an atomic filesystem transaction against arbitrary external writers. They do not lock every input, freeze time-dependent session activity, provide OS directory-handle fencing, or turn synchronous filesystem calls into cancellable operations. Removing the CLI subprocess also removes that subprocess timeout from these direct read calls; no hard end-to-end deadline for local filesystem I/O is claimed. Existing runtime admission, provider/environment budgets and explicit execution timeouts are unchanged.

An internal selected-source digest is available to library callers without changing legacy CLI/MCP schemas. It is not a new task-control revision, an activated runtime layout, a durable result reference, an exact revision of every environmental observation or proof that all sources are immutable. Missing-parent, source-change and captured-directory changes fail instead of mixing authoritative records.

## Preserved legacy limitations

This is not a silent data repair. Existing run-store schema behavior is preserved, including its initial-state fallback for an invalid state shape when there are no run records. Corrupt JSON, a lower counter than existing runs and a mismatched run ID retain their refusal behavior. The broader old corruption task is not closed by extraction of the same loader.

Legacy handoff memory counters retain their legacy parser/fallback semantics and inspect the existing flat archive count files when that output requests them. They are not the stricter canonical-memory interpretation or history-body isolation of `context packet`. The new packet/source contracts remain separate and unchanged. No total I/O reduction, latency improvement percentage, token saving, whole-suite success or completed migration follows from eliminating a CLI child.

## Evidence and remaining sequence

`node --test scripts/stored-read-adapters-probe.js` exercises filters/retained results, cross-session reads, JSON/text errors, target-language isolation, pagination, checked-source changes, aliases, unknown previews, initialization notices, legacy quiet behavior and OFFLINE-unset network/child-process instrumentation. It is added to the existing lean-readonly test tier, not a mandatory validation engine in ordinary product reads. A deliberate blocked HTTP request is the positive instrumentation control; it is not an OS-wide network sandbox.

The source-pinned predecessor comparison additionally checks old/new CLI and MCP responses on the same fixture root. Relevant lifecycle, history, memory, language and mutation consumers must be observed separately. Record actual source boundaries and execution results separately.

General task ownership/generation fencing, worktree-private runtime activation, immutable result publication/finalize and interruption recovery remain LEAN-03/04B. Unknown external installed consumers and broader LEAN-01 acceptance remain separate release conditions. No main merge, owner installation change, runtime activation, live-project archive/restore, paid model call or public release is authorized by this read refactor.
