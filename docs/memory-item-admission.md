# Memory writer item admission

Local development behavior, introduced in unreleased 1.36.195.
Decision add/drop, lesson save/drop, and decision/lesson restore validate every
active item before duplicate checks, selection, rendering or domain publication.
The two shared save functions also validate candidate arrays before serialization.
Existing checked input, root/UTF-8 validation, locks and publication remain in use.

Each item must be a JSON object. Null, scalar and array items are unsupported.
Fields consumed by selection or rendering must be a string, null or absent:

| Surface | Fields checked |
| --- | --- |
| decisions | date, title, decision, reason, alternatives, impact |
| lessons | date, text, tag |

There is no new required ID, date format or nonempty-field requirement. Empty and
multiline strings, nulls, missing fields, ordering and unknown JSON extension
values remain accepted. Nothing is filtered, truncated or converted to a string
by this validator. Invalid internal candidate arrays are refused rather than
converted into an empty store. Read-only loaders and migration inspection are
unchanged. This is a writer precondition, not a general-purpose JSON schema.

In CLI JSON mode, an unsupported item exits 1 with `ok: false`,
`code: "store_item_unsupported"`, a fixed `error` message, `surface`, zero-based
`index`, and `field`. `field` is null for a non-object item; internal non-array
candidates have a null index. These diagnostics contain no item values. A malformed
JSON root or UTF-8 still receives its existing error before item validation.
The entire operation is refused, including duplicates, a drop with no matching
target, and `--force`. Canonical, projection and archive files remain unchanged
on item rejection. CLI startup, locks and normal runtime metadata are outside
that domain-file guarantee. Existing MCP adapters retain their transport behavior;
this change does not promise structured error parity across transports.

## Existing operation rules

Decision add compares the parsed CLI title against either canonical title or
decision text. Its CLI title parsing trims surrounding whitespace. Lesson save
compares the literal lesson text and retains surrounding whitespace. Force can
append a valid duplicate; it cannot bypass invalid-item rejection.

Drop retains date equality or title/text substring matching and its separate
lossless-archive guard. Restore retains projection-normalized, trimmed title/text
conflict rules, force behavior and the historical handling of duplicates within
the same selected archive batch. Unknown extensions on surviving items are
preserved; a destructive drop that cannot preserve them still fails under the
existing archive contract.

Since T-0328 the drop archive also carries entries whose known fields hold a
string (or null) that the plain Markdown lines cannot give back exactly:
surrounding or only whitespace, several lines, tabs and other control characters,
an empty string, a date in another form, a lone surrogate. Such an entry gets one
more line right after its heading, `- Exact JSON: {...}`, holding all its known
fields as JSON (DEL, C1 controls and the line and paragraph separators escaped
too). Its plain lines follow as before for other readers. Whether an entry needs
the line, and whether the archive then carries it exactly, is checked on what a
restore reads: the archive as stored in UTF-8 (a lone surrogate would become
U+FFFD) and the selected block trimmed. Restore reads such an entry from its exact
line, and only when the whole section is what the writer wrote for that entry
(compared as a restore reads it, ignoring line endings and trailing spaces or
tabs, and allowed to be cut short); then it comes back exactly. A cut that removes
the line also removes the plain lines after it. A heading is `###` followed by a
space, a line end or the end of the block, so an empty date or title whose
trailing space an editor stripped still starts its own entry.

A selection is refused as `archive_entry_invalid`, without writes, when any
heading section in it gives no entry: a line starting with the marker that is not
one JSON object holding exactly the known fields, each a string or null (including
a payload or colon cut off), an exact section that differs from what the writer
wrote (an edited heading or plain line, or the next entry's lines after its
heading was removed), a plain section holding two entries, an entry that lost its
lines, an exact line before the first heading, or a section that is not an entry.
Two of these change older archives. A `### Notes` section added by hand inside a
drop block used to be skipped while the whole block was removed, and a note line
starting with `- Exact JSON` used to be ignored; now the restore stops and names
the repair (move the notes out of the drop block, rename the line, then restore
again). A plain decision block headed "Template" is still skipped, as the
decisions Markdown skips it. A cut that removes whole entries, headings included,
or falls inside a heading line cannot be noticed: the archive does not record how
many entries a drop removed. More generally, for blocks without an integrity
record (below), hand-edited or cut archives are protected only in the tested cases;
known gaps are a cut right after a decision's heading (a heading-only decision is
restored) and an exact line indented by an edit (read as a plain line).

Since T-0331 each drop block also starts, right after its header line, with an
integrity record: `- Archive check: N entries, sha256 <hex>`, the number of entries
the drop removed and a hash of the entry text it wrote after the record. CRLF line
endings, trailing spaces or tabs and the block's ends are outside the hash (a lone
CR is not: the readers do not take it as a line ending), and the text is hashed as
UTF-8 the way it is stored. The drop header line and the archive's title are not
hashed. A restore refuses a selected block with `archive_changed`, without writes
and `--force` included, when its entry text no longer matches the record; when the
first line after the header is not an exact record and a line in the block carries
the record's content (the words "archive check" followed by an entry count, or with
a 64-hex hash after them, ignoring spaces, invisible format characters such as a
byte order mark, and case); or when the header line after the target, or the
archive's title, carries it. With an exact record first, the rest of the block is
covered by the hash and not scanned. A line that only mentions an archive check is
text, so older archives with such notes restore as before; one that carries a count
or a hash where it is scanned is taken as a damaged record and refused until it is
edited (for example, reword "Archive check: 3 entries completed" as "Checked the
archive: 3 entries"). With a matching record the reader must find exactly
N entries (`archive_entry_invalid` otherwise). So the edits and cuts the gaps above
describe are caught in recorded blocks. Blocks without a record (drops before
T-0331) are read with the structural checks as before. To restore a block edited
on purpose, delete its record line: the block is then read like one without a
record. Moving the record into another block opts its own block out the same way;
the record detects accidental edits and cuts, not every combination (a record
whose words were changed, not only spaced or cased, or that an editor wrapped onto
two lines, reads as no record, so an edit to the entries next to it is not
detected), it is not authentication, and
whoever can edit the archive can delete or rewrite it. It counts toward a write
policy's archive input limit like the rest of the drop.

Conflict checks read the entries the restore will write, rendered like the active
side, so the trimmed-text rule holds even when only the exact line survived; for
decisions they keep titles that start with "Template", which the decisions
Markdown skips (an undated "Template x" decision drops through its exact line). The
drop header's target is read up to the last `")` of its line, the same way for
restore, `memory archive list`, `memory status`, health, session close and
brainstorm, so a target containing quotes stays selectable, listed and counted.
Unknown fields and values that are neither strings nor null are still refused
(`archive_lossy` at the archive, `store_item_unsupported` earlier for a field
admission rejects).

## Remaining work

Raw JSON formatting, duplicate property keys and unsafe numeric literals are not
made lossless by validating parsed values. JavaScript JSON parsing/serialization
semantics still apply. Markdown projection normalization and multi-file I/O failure
recovery retain their existing limits.

No default byte, item-count, per-item or retained-storage limit is introduced.
Resource measurement and independent corpus evidence remain the next ML-04 stage.
The current repository's duplicated worktree samples are insufficient to choose
general limits. Run `npm run test:memory-items` for the pure validator and actual
CLI behavior/rejection checks; this does not certify resource bounds or other OSes.
