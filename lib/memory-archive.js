'use strict';

// T-0193: legacy Markdown archives are a compatibility surface, not a lossless
// canonical store. Destructive mutations may use them only when the exact
// canonical entry round-trips through the existing archive representation.
// T-0328: the plain lines cannot carry every text value: they are one line each
// with control characters made spaces, and the reader trims them. When a known
// field holds a string (or null) that the plain lines do not give back exactly
// (surrounding or only whitespace, several lines, tabs, an empty string, another
// date form, a lone surrogate), the entry gets one more line right after its
// heading, "- Exact JSON: {...}", holding all its known fields. Its plain lines
// follow as before for readers that do not know the line; this module's reader
// takes the exact values. Unknown fields and values that are neither strings nor
// null still cannot be carried, so an entry holding them is still refused.
const { isDeepStrictEqual } = require('util');
const crypto = require('crypto');
const { _lineSafe, _decisionsFromMd, _parseLessonEntries, _stripDecisionFences } = require('./pure-utils');

const FIELDS = { decisions: ['date', 'title', 'decision', 'reason', 'alternatives', 'impact'], lessons: ['date', 'text', 'tag'] };
const EXACT_PREFIX = '- Exact JSON: ';
// Any line starting with the reserved marker is an exact line, whatever follows it (a payload cut off, a lost colon or
// space): its payload must then be one JSON object of known fields, or the block counts as damaged (review round 1).
const EXACT_LINE = /^- Exact JSON(.*)$/gm;
const HAS_EXACT_LINE = /^- Exact JSON/m;
// A heading is `###` followed by a space, a line end or the end of the text. The writer always puts a space after it,
// but for an empty date or title an editor that strips trailing spaces leaves a bare `###`, and so does the trim of a
// selected block cut right after such a heading (review round 2). Either must still start a block: otherwise the entry
// joins the one before it and is left out without a trace.
const HEADING_SPLIT = /\n(?=###(?: |\r?\n|$))/;
const HEADING_START = /^###(?: |\r?\n|$)/;
const BARE_HEADING = /^###(?=\r?\n|$)/;
// The decisions Markdown skips its template block; plain archive blocks keep that rule, so older archives read as before.
const TEMPLATE_HEADING = /^### (Template|템플릿)\b/;
// One heading holds one entry, so two of these lines in a plain block mean a heading between them was lost (review
// round 3); the plain parsers would read the first and drop the second.
const PRIMARY_LINE = { decisions: /^- Decision:/gm, lessons: /^- Lesson:/gm };
// JSON.stringify already escapes C0 controls, quotes and backslashes; DEL, the C1 controls (NEL among them) and the
// line and paragraph separators stay raw, and those can end or forge a line in viewers and terminals.
const UNSAFE = new RegExp('[' + String.fromCharCode(0x7f) + '-' + String.fromCharCode(0x9f) + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
const BACKSLASH = String.fromCharCode(92);

function* plainParts(surface, entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    const e = new Error(`Archive entry is not an object: ${surface}`);
    e.code = 'E_ARCHIVE_LOSSY';
    throw e;
  }
  if (surface === 'decisions') {
    yield '\n### ';
    if (entry.date) { yield _lineSafe(entry.date); yield ' — '; }
    yield _lineSafe(entry.title);
    for (const [name,key] of [['Decision','decision'],['Reason','reason'],['Alternatives','alternatives'],['Impact','impact']]) {
      yield `\n- ${name}: `; yield _lineSafe(entry[key] || '');
    }
    yield '\n'; return;
  }
  if (surface === 'lessons') {
    yield '\n### '; yield _lineSafe(entry.date); yield '\n- Lesson: '; yield _lineSafe(entry.text); yield '\n';
    if (entry.tag) { yield '- Tag: '; yield _lineSafe(entry.tag); yield '\n'; }
    return;
  }
  const e = new Error(`Unsupported memory archive surface: ${surface}`);
  e.code = 'E_ARCHIVE_SURFACE';
  throw e;
}

function plainParse(surface, text) { return surface === 'decisions' ? _decisionsFromMd(text) : _parseLessonEntries(text); }

// What a restore reads back: the archive as stored (UTF-8, so a lone surrogate becomes U+FFFD) and as selected (the
// drop block is trimmed, so its last entry loses trailing whitespace). Checks run on this, not on the string written
// (review round 1).
function asRestoreReads(text) { return Buffer.from(String(text), 'utf8').toString('utf8').trim(); }

// Nothing when the plain lines give every known field holding a string or null back as it is; otherwise all of those
// fields, so that the exact line alone restores the entry even when the plain lines after it were cut off.
function exactFields(surface, entry) {
  const parsed = plainParse(surface, asRestoreReads([...plainParts(surface, entry)].join('')));
  const plain = parsed.length === 1 ? parsed[0] : null;
  const known = FIELDS[surface].filter(key => Object.hasOwn(entry, key) && (entry[key] === null || typeof entry[key] === 'string'));
  if (plain && known.every(key => plain[key] === entry[key])) return {};
  return Object.fromEntries(known.map(key => [key, entry[key]]));
}

function exactJson(fields) {
  return JSON.stringify(fields).replace(UNSAFE, ch => BACKSLASH + 'u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

// The exact line goes right after the heading: a cut that removes it removes the plain lines too, so the entry cannot
// be read and the restore refuses; a cut after it leaves the exact line, which holds every field.
function* archiveEntryParts(surface, entry) {
  const plain = [...plainParts(surface, entry)].join('');
  const fields = exactFields(surface, entry);
  if (!Object.keys(fields).length) { yield plain; return; }
  const afterHeading = plain.indexOf('\n', 1) + 1;
  yield plain.slice(0, afterHeading); yield EXACT_PREFIX; yield exactJson(fields); yield '\n'; yield plain.slice(afterHeading);
}

function renderArchiveEntry(surface, entry) { return [...archiveEntryParts(surface,entry)].join(''); }

// One entry per archive block. A block with an exact line is read from that line alone, which must be one JSON object
// holding exactly the known fields, each a string or null (the writer puts all of them there); this holds whatever its
// heading says, so a decision block renamed to "Template ..." is not skipped (review round 2). A block without one
// reads as the old parsers read it, the decisions template still skipped. A block that gives no entry counts as
// damaged: its exact line is anything else, the entry lost its lines, or the heading starts a section that is not an
// entry (a hand-added "### Notes"). An exact line before the first heading lost its heading and counts as damaged too.
// A restore then refuses the whole selection instead of bringing back normalized text or silently leaving an entry out
// while removing its archive block.
function readArchiveEntries(surface, text) {
  if (surface !== 'decisions' && surface !== 'lessons') return { entries: [], damaged: 0 };
  // Fenced code is not data in the decisions Markdown; the same here (fences never come from the writer).
  const parts = (surface === 'decisions' ? _stripDecisionFences(text) : String(text || '')).split(HEADING_SPLIT);
  const entries = [];
  let damaged = 0;
  if (!HEADING_START.test(parts[0]) && HAS_EXACT_LINE.test(parts.shift())) damaged++;
  for (const part of parts) {
    const lines = [...part.matchAll(EXACT_LINE)];
    if (lines.length) {
      const read = exactEntry(surface, lines);
      if (read && writtenAs(surface, read, part)) entries.push(read); else damaged++;
      continue;
    }
    const block = part.replace(BARE_HEADING, '### ');
    if (surface === 'decisions' && TEMPLATE_HEADING.test(block.trim())) continue;
    if ((block.match(PRIMARY_LINE[surface]) || []).length > 1) { damaged++; continue; }
    const read = plainParse(surface, block)[0];
    if (read) entries.push(read); else damaged++;
  }
  return { entries, damaged };
}
// The given characters removed from the end, scanning back. The regular expression [ \t]+$ gives the same result but
// tries again from every position of a long run that does not reach the end, which is quadratic: 64,000 spaces before
// a letter took 1.5 seconds (T-0331 review round 4). Every trailing trim on the restore's reading path uses this.
function trimEnd(text, chars) {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1])) end--;
  return end === text.length ? text : text.slice(0, end);
}
// Line endings and trailing spaces or tabs do not count: git can turn LF into CRLF and editors strip trailing spaces.
function normLines(text) { return String(text).replace(/\r\n?/g, '\n').split('\n').map(line => trimEnd(line, ' \t')); }
// A section with an exact line must be what the writer wrote for the entry that line holds, or that cut short (the last
// line may be cut too). Otherwise the exact line would win over what is around it: a heading removed by an edit merges
// the next entry's lines into this section, and an edited heading or plain line would be ignored (review round 3).
function writtenAs(surface, entry, part) {
  const got = normLines(part);
  while (got.length && got[got.length - 1] === '') got.pop();
  // The writer's text as a restore reads it: stored in UTF-8, so a lone surrogate in a plain line is U+FFFD. Not trimmed:
  // only the end of the selected block is trimmed, and a cut-short last line is allowed below. Trimming here dropped a
  // trailing NBSP (or other Unicode space) that a section before the last one keeps, so untouched drops of several
  // entries were refused (review round 4).
  const want = normLines(Buffer.from(renderArchiveEntry(surface, entry), 'utf8').toString('utf8').replace(/^\n/, ''));
  if (!got.length || got.length > want.length) return false;
  const last = got.length - 1;
  return got.every((line, i) => (i < last ? line === want[i] : want[i].startsWith(line)));
}
function exactEntry(surface, lines) {
  if (lines.length !== 1) return null;
  const payload = /^:[ \t]*(.*)$/.exec(lines[0][1]);
  if (!payload) return null;
  let fields;
  try { fields = JSON.parse(payload[1]); } catch { return null; }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const keys = Object.keys(fields), known = FIELDS[surface];
  if (keys.length !== known.length || known.some(key => !Object.hasOwn(fields, key) || (fields[key] !== null && typeof fields[key] !== 'string'))) return null;
  return Object.fromEntries(known.map(key => [key, fields[key]]));
}
function parseArchiveEntries(surface, text) { return readArchiveEntries(surface, text).entries; }

function inspectArchiveEntry(surface, entry) {
  const text = renderArchiveEntry(surface, entry);
  const parsed = parseArchiveEntries(surface, asRestoreReads(text));
  return { text, restored: parsed.length === 1 ? parsed[0] : null,
    lossless: parsed.length === 1 && isDeepStrictEqual(parsed[0], entry) };
}

function renderLosslessArchiveEntries(surface, entries, maxBytes = null) {
  if (maxBytes !== null) {
    let bytes = 0;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw Object.assign(new Error('archive_input_bytes_exceeded'), { code: 'archive_input_bytes_exceeded', phase: 'operation' });
    for (const entry of entries) for (const part of archiveEntryParts(surface,entry)) {
      bytes += Buffer.byteLength(part);
      if (bytes > maxBytes) throw Object.assign(new Error('archive_input_bytes_exceeded'), { code: 'archive_input_bytes_exceeded', phase: 'operation' });
    }
  }
  const blocks = [];
  for (let index = 0; index < entries.length; index++) {
    const inspected = inspectArchiveEntry(surface, entries[index]);
    if (!inspected.lossless) {
      const e = new Error(`Legacy ${surface} archive cannot preserve canonical entry ${index + 1} exactly`);
      e.code = 'E_ARCHIVE_LOSSY';
      e.surface = surface;
      e.index = index;
      throw e;
    }
    blocks.push(inspected.text);
  }
  return blocks.join('');
}

// T-0331: integrity record. Each decisions or lessons drop block starts, right after its header line, with one line
// recording how many entries the drop removed and a SHA-256 of the entry text the drop wrote. The text is hashed the
// way a restore may legitimately see it changed: as stored in UTF-8 (a lone surrogate becomes U+FFFD), with line
// endings made LF (git can convert them), trailing spaces or tabs removed (editors strip them) and the ends trimmed
// (restore trims the block). A restore refuses a block that no longer matches, so an edit or a cut anywhere in it is
// caught instead of being read by the structural checks above, which cannot see every one (T-0328's documented gaps).
// Deleting the line opts that block out on purpose: it is then read as blocks without a record are, as before.
const CHECK_LINE = /^- Archive check: (\d+) (entry|entries), sha256 ([0-9a-f]{64})$/;
// A line that carries the record's content, however its spacing or case changed: with every space, invisible format
// character (a BOM, a zero-width space) and case difference removed, "archivecheck" followed by an entry count, or
// with a 64-hex hash after it. Only an exact first line is the record; a look-alike elsewhere means it was indented,
// joined to the header line or moved, which would otherwise make the block read as one without a record (review
// rounds 1 and 2). A line that only mentions an archive check, with no count and no hash, is text as before T-0331
// (review round 2). A record whose words changed (not just their spacing or case) reads as no record, like a deleted
// one: the record catches accidental edits, and this takes two (one to the record, one to the entries). So does a
// record an editor wrapped onto two lines (each line is read alone).
function looksLikeRecord(line) {
  const key = String(line).replace(/[\s\p{Cf}]+/gu, '').toLowerCase();
  const at = key.indexOf('archivecheck');
  // A hash after any occurrence of the words is after the first one, so one search from there gives the same answer;
  // searching again from every occurrence took quadratic time on a line repeating them (review round 3).
  return at >= 0 && (/archivecheck:?\d+entr/.test(key) || /[0-9a-f]{64}/.test(key.slice(at + 12)));
}
const hasLookAlike = text => String(text || '').split('\n').some(looksLikeRecord);
// Hashed as UTF-8, which turns a lone surrogate into U+FFFD exactly as storing the archive does. Only CRLF counts as a
// line ending: the readers do not take a lone CR as one, so an LF changed to CR must change the hash (review round 1).
function checkDigest(text) {
  const norm = String(text).replace(/\r\n/g, '\n').split('\n').map(line => trimEnd(line, ' \t')).join('\n').trim();
  return crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
}
// The archive's title part (before the first drop block) holds no record; one there was moved out of its block.
function hasArchiveCheckMark(text) { return hasLookAlike(text); }
function archiveCheckLine(count, entryText) {
  return `- Archive check: ${count} ${count === 1 ? 'entry' : 'entries'}, sha256 ${checkDigest(entryText)}\n`;
}
// What a selected drop block holds; `block` is the whole block, its header line included:
//   { state: 'none' }                   no record (an older drop, or a record deleted on purpose): read as before;
//   { state: 'ok', count }               the record matches (the reader skips the line: it is before the first heading);
//   { state: 'changed' | 'malformed' }   the text no longer matches, or something that looks like the record is not the
//                                        exact first line after the header (edited, indented, joined to the header line
//                                        after the target, or moved further down, where the hash alone would not see it).
//   A second record line needs no own check: it is part of the hashed text, so it changes the hash.
function readArchiveCheck(block) {
  const text = String(block || '');
  const nl = text.indexOf('\n');
  const header = nl < 0 ? text : text.slice(0, nl);
  const targetEnd = header.lastIndexOf('")');
  if (looksLikeRecord(targetEnd < 0 ? header : header.slice(targetEnd + 2))) return { state: 'malformed' };
  // Blank lines after the header are skipped, as the restore skips them.
  const content = (nl < 0 ? '' : text.slice(nl + 1)).replace(/^(?:[ \t]*\r?\n)+/, '');
  const cnl = content.indexOf('\n');
  const first = trimEnd(cnl < 0 ? content : content.slice(0, cnl), ' \t\r');
  const rest = cnl < 0 ? '' : content.slice(cnl + 1);
  const m = CHECK_LINE.exec(first);
  if (!m) return hasLookAlike(content) ? { state: 'malformed' } : { state: 'none' };
  if ((m[2] === 'entry') !== (m[1] === '1')) return { state: 'malformed' };
  if (checkDigest(rest) !== m[3]) return { state: 'changed', count: Number(m[1]) };
  return { state: 'ok', count: Number(m[1]) };
}
// The block without its record line, for readers that show or search the text (brainstorm): only an exact record in
// the record position (the first non-blank line after the header) is left out. Anything else stays, so an older note
// line that starts the same way is still searchable text (review round 2).
function withoutArchiveCheck(block) {
  const text = String(block || '');
  const m = /^([^\n]*\n(?:[ \t]*\r?\n)*)([^\n]*)(?:\n|$)/.exec(text);
  if (!m || !CHECK_LINE.test(trimEnd(m[2], ' \t\r'))) return text;
  return m[1] + text.slice(m[0].length);
}

module.exports = { renderArchiveEntry, inspectArchiveEntry, renderLosslessArchiveEntries, parseArchiveEntries, readArchiveEntries,
  archiveCheckLine, readArchiveCheck, hasArchiveCheckMark, withoutArchiveCheck };
