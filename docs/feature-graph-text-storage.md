# Feature graph text storage

Failures report the file and stage. JSON and human output also retain available publication-state flags and recovery paths from the checked publisher. A failure after saving does not claim rollback or success.

`feature add` and `feature link` capture strict UTF-8 source under the existing graph lock, then publish only the requested edit through `managed-text`. A detected stale source, malformed input or invalid generated text fails without claiming a saved change. A missing graph is published as one complete candidate; no intermediate template is written before validation.

Adding a node appends the existing safe node rendering. Linking edits only the first matching relationship field in the selected node, following the existing parser; a missing field is inserted after its heading. Unrequested fields, custom prose, notes, header, UTF-8 signature and existing line endings remain intact. Changed lists retain their existing ID/deduplication semantics; new text uses the first observed line ending or LF. Parser node ranges are shared between observation and targeted edits, so ID/heading interpretation is not duplicated.

The mutation input and generated output limit is 4 MiB, including a retained signature. Oversized source is rejected, not truncated. Existing invalid bytes are not repaired or translated. Valid Unicode, including literal replacement characters and user symbols, is preserved. New node values retain the existing single-line formatting rules.

Duplicate titles and existing links remain no-ops. The initialization gate runs before lock-directory creation. Explicit `--force` and an existing AGENTS marker retain their previous creation behavior; dry-run and runtime write guards still apply. Existing MCP add/link tools use the same CLI storage path and keep their permissions.

General list/show/impact, handoff and audit observation reads retain their existing behavior; this is not a new graph schema validator. It does not validate that relationships name real nodes, reinterpret duplicate node IDs or repair malformed Markdown, and it does not protect every Leerness writer. Source checks and checked publication do not reserve files against every possible non-cooperating external change. If publication fails after a partial save, preserve its error/recovery evidence rather than assuming rollback or reporting success. See [the shared storage boundary](managed-text-storage.md).

`npm run test:feature-graph-text` covers actual CLI/MCP edits in temporary projects and isolated homes, preservation, malformed/oversized input, rejected output, competing source changes, no-op/dry-run behavior and concurrent additions. The tests do not call a coding agent or update a real installed project.
