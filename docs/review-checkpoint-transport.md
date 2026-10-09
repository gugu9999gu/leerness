# Review checkpoint CLI and MCP adapter (RB-01)

Status: local development feature. This is an adapter over the existing `lib/review-checkpoint.js` assessor, not a second assessor and not a review/approval service. It has not been published to npm or enabled as an automatic gate. See [the input and assessment contract](review-checkpoint-api.md).

## CLI

```text
leerness review-checkpoint assess --stdin [--json]
leerness review-checkpoint --help
```

The command accepts one complete UTF-8 JSON document on standard input. The first positional token must be `review-checkpoint`. Paths, file arguments, `--apply`, extra flags, duplicate flags and automatic dispatch are not accepted. Output is JSON even without `--json`. The command requires a pipe/non-interactive stdin; it never prompts. Input must finish within 5 seconds of reading starting (a total deadline, not an idle timer). Limit: 65,536 input bytes, including whitespace. Invalid UTF-8, BOMs, malformed JSON and duplicate object keys (including escaped-equivalent keys) are rejected.

From this checkout, in POSIX shells or Windows cmd.exe (not PowerShell redirection syntax):

```sh
node bin/leerness.js review-checkpoint assess --stdin < docs/review-checkpoint-example.json
```

The example uses synthetic commit-shaped hashes. They are never verified against Git and are not evidence of real work.

For cross-platform programmatic use, avoid shell redirection and pass bytes directly:

```js
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [
  'bin/leerness.js', 'review-checkpoint', 'assess', '--stdin', '--json',
], {
  input: fs.readFileSync('docs/review-checkpoint-example.json'),
  encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024,
});
if (result.error) throw result.error;
if (result.signal) throw new Error('Assessment process was interrupted');
const response = JSON.parse(result.stdout);
console.log({ exitCode: result.status, response });
```

Exit 0 means the advisory was computed successfully, including an advisory saying `needs-evidence` or `split-required`. It never means review approval. Exit 2 indicates invalid input/arguments, input timeout or a transport/assessment failure. Broken stdout also produces exit 2 but cannot guarantee a JSON response on a broken pipe. Help exits 0.

## MCP

The normal `full` profile advertises `leerness_review_checkpoint`, declared `read-only`. Its exact arguments are:

```js
{
  inputJson: JSON.stringify(reviewCheckpointInput)
}
```

`reviewCheckpointInput` must satisfy `leerness.review-checkpoint-input/v1`. There is no `path`, `sessionKey`, `_cursor`, `_chunkSize`, `approve` or model parameter. A serialized string is deliberate: CLI and MCP share the same byte-bound and duplicate-key checks inside the domain document. The existing MCP server first parses its outer JSON-RPC envelope; this adapter does not replace or impose a size limit on that legacy outer framing. Duplicate-key checks here concern the inner `inputJson`, not the already-parsed outer envelope.

The server uses its existing read-only tool classification, profile restriction and policy check. A tool hidden by `--profile core` cannot be invoked; this change does not enlarge CORE. The assessment runs in the server process, so the JSON is never passed through a shell, temporary input file or Windows command-line length limit. It is not sent to a model.

A valid invocation returns `content[0].text` containing the complete response below and `isError: false`. Invalid domain input is a tool result with `isError: true`, not a falsely successful assessment. Unsupported outer argument types can retain existing JSON-RPC invalid-parameter errors. Notifications still receive no reply. Error responses never copy raw input values or unknown input field names.

## Versioned response and limits

```js
{
  schema: 'leerness.review-checkpoint-response/v1',
  ok: true,
  advisoryOnly: true,
  assessment: {
    // Exact existing leerness.review-checkpoint-assessment/v1 result.
    // grouping, checkpoint, preparation, taskCoverage, verification, effects...
  }
}
```

Failures have `ok: false`, `advisoryOnly: true`, and `error: { code, field, message }` instead of `assessment`. Transport error codes include `input_json_required`, `input_too_large`, `invalid_json`, `duplicate_json_key`, `input_structure_limit`, `utf8_bom_not_allowed`, `invalid_utf8`, `invalid_cli_arguments`, `stdin_pipe_required`, `stdin_timeout`, `stdin_closed_early`, `stdin_read_failed`, `stdin_binary_required`, `input_json_only`, `invalid_arguments`, `output_too_large` and `assessment_failed`. Domain errors preserve the assessor's bounded code/field contract.

Response JSON is limited to 65,536 UTF-8 bytes, excluding the CLI newline or MCP wrapper escaping. An oversized assessment returns an explicit error, not a truncated success. There is no pagination or repeated evaluation to obtain chunks. Raw parsing also caps depth at 16, visited values at 10,000 and array length at 1,000; the assessor adds its narrower domain limits.

## Side-effect and trust boundaries

The CLI enters before ordinary bootstrap, workspace lookup, migration, usage counters, presence or provider loading. It reads supplied stdin bytes, not a project or referenced evidence. Module loading still reads installed code. MCP still starts the existing server and can read its local policy/configuration; the new read-only call does not append telemetry or invoke a child process. Neither interface mutates project files, migrates `.harness`, resolves actual commits, authenticates evidence or records a review.

The assessment always preserves `sourceTrust: caller-supplied`, unverified snapshot/evidence, `independentReview: not-run` and `effects.approvalGranted: false`. The effect flags describe the assessor's domain effects; they are not a claim that the hosting Node process performs no module/configuration reads. A `packet-candidate` only describes caller-supplied preparation metadata. Existing R-0001/R-0002, independent-review requirements and release gates are not relaxed.

The byte/format checks are not a JavaScript sandbox. The text APIs are intended for serialized JSON, not attacker-controlled Proxy objects or executable callbacks.

## Verification

```sh
node scripts/review-checkpoint-probe.js
node scripts/review-checkpoint-transport-probe.js
npm run test:review-checkpoint
```

The transport probe exercises the real CLI and stdio MCP server, compares positive results to the one existing assessor, checks raw duplicate keys/UTF-8/input boundaries, rejects unsupported arguments, tests unapproved failure/partial/risk states, and compares file hashes/mode/mtime before and after success/failure calls in current, legacy and empty fixtures. A same-size mutation negative control demonstrates the snapshot checker can actually detect a change. A preload tripwire rejects filesystem writes and child processes on the exact CLI path.

These fixtures are local deterministic tests, not independent model review, live provider integration or proof against every operating-system/environment configuration. Whole-suite/CI results must be recorded separately from these focused tests. Persistence/fencing/finalize (RB-02), authority enforcement/dispatch (RB-03), actual state migration and public release remain separate work.
