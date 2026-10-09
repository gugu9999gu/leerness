# Interactive CLI stream integrity

Leerness's interactive CLI response path (`_cliChatStream`) shares the strict
UTF-8 collector with `agents bench`. Korean, Japanese, Chinese, emoji and
decomposed characters remain intact when their bytes arrive in separate chunks.
No Unicode normalization, code-page guessing or automatic text repair is applied.

Each stdout/stderr stream has its own fatal decoder, flushed at process close.
Invalid or unfinished UTF-8 in either stream fails the turn. Input to the existing
Claude/Codex stdin paths uses explicit UTF-8 bytes; unpaired prompt surrogates are
rejected before spawn. The agy/copilot argument contracts and portable launcher
are retained. This is not a new provider adapter or a model-specific integration
certification.

The existing optional Claude JSON mode consumes the final frame even without a
newline, accepts LF/CRLF framing, and validates text fields before rendering.
Malformed frames, invalid Unicode text and explicit error events fail the turn.
Unknown event types are ignored; they cannot fabricate an assistant answer. A
JSON run without recognized non-whitespace assistant text fails. Supported event
shapes are the existing content-block delta/message-start/thinking/tool labels;
other vendor protocol versions are not inferred or silently treated as plain text.
Plain text remains the default. Exit-zero plain text is transport success, not
proof of semantic correctness, compliance or model identity.

Combined stdout/stderr is capped at 1 MiB. The default 120-second deadline includes
waiting for pipe closure. On error or timeout, termination is requested for the
direct child and collection settles within another 250 ms even if close never
arrives. Descendant termination is not guaranteed. `terminationConfirmed` reports
an observed direct-child exit/close. Partial bytes are never returned as a
successful response. An already displayed prefix cannot be retracted.

After an admitted spawn attempt there is one terminal run record, even if an
error is followed by a late close. Preflight rejection never spawns a process.
Run metadata includes outcome, error code, duration, byte counts and intended
stdin SHA-256 (null for argument-only paths). Output digests are available only
after complete valid collection, including on a nonzero exit. They measure local
bytes; stdin metadata does not establish that a provider consumed them.
`outputComplete` means byte collection completed, not that the response succeeded.
No prompt, response, raw error or stderr body is stored in this run record.
Existing direct terminal display of stderr is retained.

Only successful responses are returned to the existing REPL assistant-history
branch. Its existing leading/trailing `trim()` behavior is preserved. Terminal
display and byte digests retain those original bytes, including a leading BOM;
interior Unicode and whitespace are unchanged. The compatibility `model` label is
the configured provider name, not independently attested model identity.

Verification: `npm run test:agent-chat-stream` executes the actual CLI wrapper
with deterministic fake children plus real Node byte-echo children. It makes no
provider/model calls. `npm run test:agent-bench-output` covers the shared collector's
existing benchmark behavior. The offline probe is also wired into the PC workflow.

Scope: batch/synchronous provider calls, externally launched tools, authored-file
encoding diagnosis and storage boundaries remain separate ENC-01 work. This change
cannot recover text already damaged before it reaches the collector, and does not
change existing projects' language or install/update them automatically.
