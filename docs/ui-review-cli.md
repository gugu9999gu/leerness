# UI checks without a login

These commands make the existing UI scanner and review contract available from the CLI. No GitHub app, login, API key, installed project harness or Git repository is required. They consume the supplied JSON and do not change project files, run a reviewer or approve a change.

| Command | What it checks |
| --- | --- |
| `leerness ui scan --stdin` | Development/debug syntax and possible sensitive information in supplied screen text |
| `leerness ui information --stdin` | Possible repeated facts from declared metric, lineage, question, scope and display context; [input contract](ui-information-quality.md) |
| `leerness ui review packet --stdin` | Required UI review questions and missing material declarations |
| `leerness ui review assess --stdin` | Whether a supplied review still matches the current inputs, including coverage and self-review declarations |

The default output is a short English summary. Add `--json` for the full result in `leerness.ui-review-response/v1`: `{schema, ok, advisoryOnly, operation, result}`. Errors use `ok:false` and a fixed `error.code`/`field`. `--help` works on each route and on `ui review --help`. `ui consistency` keeps its existing behavior.

## Check screen text

Have the agent supply actual selected screen text in this format. Example input for `ui-surfaces.json`:

```json
{
  "schema": "leerness.ui-boundary-scan-input/v1",
  "policyVersion": "leerness.ui-boundary/v1",
  "taskKind": "ui",
  "surfaces": [
    {"kind": "text", "exposure": "rendered", "text": "Continue", "attribute": null},
    {"kind": "text", "exposure": "rendered", "text": "TODO: connect action", "attribute": null}
  ]
}
```

In bash or cmd.exe:

```sh
leerness ui scan --stdin < ui-surfaces.json
```

In PowerShell, preserve UTF-8 through the pipe:

```powershell
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-Content -LiteralPath ./ui-surfaces.json -Raw -Encoding UTF8 | leerness ui scan --stdin
```

The second surface is reported as a candidate for review, without repeating its raw text. A credential and a development marker on the same surface remain one finding. Surface numbers in the human summary are one-based; `surfaceIndex` in JSON is zero-based. The scanner does not automatically delete text. A no-match result means only that no configured pattern matched; an empty list means nothing was scanned.

The [scanner contract](ui-boundary-scanner.md) defines the 32-surface and 4096-byte per-text limits. This CLI additionally uses a **64 KiB total input and output limit**, stricter than the direct scanner library's 128 KiB input limit. It rejects duplicate JSON keys, invalid UTF-8, BOMs, excessive structure, unknown options and ambiguous envelopes. It waits at most five seconds for stdin to close. No partial scan is presented as a complete one.

This command does not open a browser or verify that caller-supplied text was actually rendered. Hosts that already have an authorized Chromium session can use the existing [browser collector](ui-boundary-browser-api.md). Do not invent surface text or material digests to make checks pass.

## Prepare and compare review records

`ui review packet` accepts the existing [UI review input](ui-review-api.md): a fixed snapshot declaration, `uiMaterials` and `contributors`. Its structured result contains review questions, task/subtype coverage, missing materials and a packet ID. Preparing questions does not run them.

`ui review assess` accepts exactly this envelope:

```json
{
  "original": {"...": "the original complete UI review input"},
  "current": {"...": "the current complete UI review input"},
  "receipt": {"...": "the complete declared review receipt, when available"}
}
```

The abbreviated values illustrate the envelope only. Use actual complete inputs from the linked contract. Omit `receipt` when none exists; `null` is not a receipt. Each command reads one JSON document. Paths, URLs, executable callbacks and credential parameters are not accepted.

The result distinguishes not-reviewed, stale material, incomplete coverage, findings, self-review, incompatible reviewer declarations and compatible but unverified review declarations. A consistent declaration is not proof that a reviewer ran, inspected the real page, was independent or approved it. All existing source/render/execution/identity/semantic verification and approval flags retain their unverified states. Separate GitHub login is not a prerequisite for these local checks; it also does not turn a self-review into an independent review.

Exit `0` means the scan or comparison ran, including cases with findings, stale data or missing review. Exit `2` means invalid input/options, a stream failure or a size/time limit. Automation must inspect `result.status`, `result.state` and verification fields; it must not use exit `0` as deployment or cleanup permission.

Input screen text is not copied into output. Packet/assessment metadata includes validated caller identifiers and digests, so callers must keep sensitive information out of metadata too. There is no telemetry, auto-migration, project discovery, subprocess, network request or local write on these CLI routes, including help and invalid invocations. The parent shell may read an explicitly supplied input file. MCP tools, install hooks, automatic browser capture and semantic reviewer execution are not added by these commands.
