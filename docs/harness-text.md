# Plain harness text and encoding

New Korean and English harness instructions use plain headings and concise text.
Generated AGENTS.md, CLAUDE.md and session-workflow.md omit decorative icons.
AGENTS.md and language-policy.md tell agents to avoid adding decorative emoji to
headings, lists and reports. Minimal-mode AGENTS.md carries the same guidance.
The human/compact handoff renderer omits decorative labels while keeping warning
and status signals that carry information.

This is an authoring convention, not an output sanitizer. User text, quotations,
project names, identifiers, meaningful notation and Unicode test fixtures remain
exact. A relation arrow can convey meaning even if Unicode classifies it as
pictographic. Do not strip all non-ASCII characters or all emoji from documents,
JSON, model output, filenames or evidence.

Normal init/migrate applies the current managed templates. Existing custom content
and historical migration sections follow the existing preservation behavior, so
old decorations may remain there. This change does not automatically rewrite every
installed project or historical record. Other command renderers remain outside
this first cleanup; do not claim the whole CLI is emoji-free.

Omitting decoration avoids sending those characters repeatedly. Token counts
depend on the tokenizer and surrounding text, so byte counts or icon counts are
not token counts. New safety guidance can increase total document size even when
decoration decreases. No fixed token/cost reduction percentage is claimed.

The generated encoding policy also separates file encoding, native stdin and
stdout decoding, and describes the PowerShell 5.1 script exception to the usual
BOM-free UTF-8 document convention. This follows [Microsoft's encoding guidance](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding?view=powershell-7.5).
It warns that a successful byte check does not establish readable text, and that
encoding declarations cannot reconstruct characters lost earlier. Diagnostic
implementation, sibling stream collectors and optional English authoring remain
separate work.

Run `npm run test:harness-text` for actual ko/en generation, handoff, migration,
minimal-mode and exact Unicode-preservation cases. The tests use local processes
without external model calls.
