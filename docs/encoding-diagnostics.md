# Encoding diagnostics and their limits

Run `leerness encoding check <project> --json` for a read-only report. The command
does not require a writable or compatible harness and does not initialize one.
It preserves the existing text-extension and configured skip-directory policies;
it does not follow symbolic links or directory junctions.

The legacy `version`, `root`, `ok`, `count` and `findings` fields remain. Byte/policy
findings retain their `file` and `issue`, with additive `code` and `category`.
`count` counts byte/policy findings, not files or advisory prose locations.

| Field | Meaning |
| --- | --- |
| `byteValidity` | UTF-8 assumption, valid/invalid file counts, and `invalid`, `incomplete`, `valid-in-scope` or `not-checked` status |
| `coverage` | Checked file/byte counts, empty files, skipped and excluded counts, bounded locations, limits and selected-scope completeness |
| `textIntegrity` | `suspected` or `unverified` meaning, inspected prose count, bounded advisory locations, excluded examples and scope notice |

`ok:true` means the selected byte/policy check completed without findings. It never
certifies sentence meaning or whole-project health. An empty scope reports
`not-checked`. Physical UTF-8 validity is separate from the existing BOM, NUL and
batch-prefix policies: valid bytes can still have a policy finding. The legacy
invalid-UTF-8 issue string mentions possible code pages for compatibility; the
scanner does not establish which code page produced the bytes.

Exit 1 is returned for byte/policy findings **or an incomplete selected scan**.
An unreadable, changed, non-regular, linked, oversized (>5 MiB) or depth-limited
entry makes coverage incomplete; count can therefore be zero while ok is false.
Unsupported extensions and configured directory exclusions are outside the
selected scope, counted explicitly, and do not alone make that scope incomplete.
An excluded directory's descendants are not enumerated, so its count is an entry
count, not a claim about how many files it contains. Traversal permits depth 12.

Per-file I/O is bounded at its observed size plus one sentinel byte, no more than
5 MiB plus one. File identity, timestamps and size are observed around reading.
On affected Windows Node versions a second descriptor confirms a missing path
volume identifier. Nonzero mismatches are not waived. These observations are not
a locked snapshot, complete race prevention, or a content authenticity proof.

Prose signals apply only to .md/.txt under .leerness or .harness, including nested
projects, and root AGENTS.md/CLAUDE.md. Ordinary source files and other Markdown
are byte-checked but excluded from prose heuristics. The heuristics look for at
least two C1 controls, replacement characters, characteristic reinterpretation
signatures, or question-mark gaps inside words on a line. One advisory per
affected line avoids repeated reports of the same symptom.

Fenced and indented code, block quotes and inline code spans are excluded with
counts using a small line-based recognizer, not a full Markdown parser. A single
example replacement character, normal CJK text, emoji, combining marks or ordinary
questions alone are not corruption. Some legitimate examples may still raise
advisories; some damaged text, including byte-valid CJK reinterpretations, has no
recognizable signal. **No signals means unverified, not semantically healthy.**

Advisories do not change byte-policy exit status and never authorize repair.
Details contain relative paths, one-based line/Unicode-code-point columns and
reason codes, not original text. Advisory, omission and exclusion details each
retain at most 40 locations; total counts and truncation flags remain available.
Legacy byte/policy findings remain fully available in JSON. Human output shows
at most 40 findings and eight advisory/omission locations with a JSON pointer.

No file is transcoded, normalized, deleted or rewritten. Already lost characters
need a verified original or a separately authorized rerun. English harness writing
and stricter managed storage remain separate ENC-01 stages. `env encoding` and its
explicit repair command retain their existing shell-compatibility contract.

`npm run test:encoding-diagnostics` exercises real CLI read-only snapshots,
supported runtime differences, bounded file reads, failure injection, Unicode
controls and false-positive examples without calling a model or external provider.
