'use strict';

 
 
 
 
 
 
 
 
 
 
 
 
const { isDeepStrictEqual } = require('util');
const crypto = require('crypto');
const { _lineSafe, _decisionsFromMd, _parseLessonEntries, _stripDecisionFences } = require('./pure-utils');

const FIELDS = { decisions: ['date', 'title', 'decision', 'reason', 'alternatives', 'impact'], lessons: ['date', 'text', 'tag'] };
const EXACT_PREFIX = '- Exact JSON: ';
 
 
const EXACT_LINE = /^- Exact JSON(.*)$/gm;
const HAS_EXACT_LINE = /^- Exact JSON/m;
 
 
 
 
const HEADING_SPLIT = /\n(?=###(?: |\r?\n|$))/;
const HEADING_START = /^###(?: |\r?\n|$)/;
const BARE_HEADING = /^###(?=\r?\n|$)/;
 
const TEMPLATE_HEADING = /^### (Template|템플릿)\b/;
 
 
const PRIMARY_LINE = { decisions: /^- Decision:/gm, lessons: /^- Lesson:/gm };
 
 
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

 
 
 
function asRestoreReads(text) { return Buffer.from(String(text), 'utf8').toString('utf8').trim(); }

 
 
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

 
 
function* archiveEntryParts(surface, entry) {
  const plain = [...plainParts(surface, entry)].join('');
  const fields = exactFields(surface, entry);
  if (!Object.keys(fields).length) { yield plain; return; }
  const afterHeading = plain.indexOf('\n', 1) + 1;
  yield plain.slice(0, afterHeading); yield EXACT_PREFIX; yield exactJson(fields); yield '\n'; yield plain.slice(afterHeading);
}

function renderArchiveEntry(surface, entry) { return [...archiveEntryParts(surface,entry)].join(''); }

 
 
 
 
 
 
 
 
function readArchiveEntries(surface, text) {
  if (surface !== 'decisions' && surface !== 'lessons') return { entries: [], damaged: 0 };
   
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
 
 
 
function trimEnd(text, chars) {
  let end = text.length;
  while (end > 0 && chars.includes(text[end - 1])) end--;
  return end === text.length ? text : text.slice(0, end);
}
 
function normLines(text) { return String(text).replace(/\r\n?/g, '\n').split('\n').map(line => trimEnd(line, ' \t')); }
 
 
 
function writtenAs(surface, entry, part) {
  const got = normLines(part);
  while (got.length && got[got.length - 1] === '') got.pop();
   
   
   
   
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

 
 
 
 
 
 
 
const CHECK_LINE = /^- Archive check: (\d+) (entry|entries), sha256 ([0-9a-f]{64})$/;
 
 
 
 
 
 
 
 
function looksLikeRecord(line) {
  const key = String(line).replace(/[\s\p{Cf}]+/gu, '').toLowerCase();
  const at = key.indexOf('archivecheck');
   
   
  return at >= 0 && (/archivecheck:?\d+entr/.test(key) || /[0-9a-f]{64}/.test(key.slice(at + 12)));
}
const hasLookAlike = text => String(text || '').split('\n').some(looksLikeRecord);
 
 
function checkDigest(text) {
  const norm = String(text).replace(/\r\n/g, '\n').split('\n').map(line => trimEnd(line, ' \t')).join('\n').trim();
  return crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
}
 
function hasArchiveCheckMark(text) { return hasLookAlike(text); }
function archiveCheckLine(count, entryText) {
  return `- Archive check: ${count} ${count === 1 ? 'entry' : 'entries'}, sha256 ${checkDigest(entryText)}\n`;
}
 
 
 
 
 
 
 
function readArchiveCheck(block) {
  const text = String(block || '');
  const nl = text.indexOf('\n');
  const header = nl < 0 ? text : text.slice(0, nl);
  const targetEnd = header.lastIndexOf('")');
  if (looksLikeRecord(targetEnd < 0 ? header : header.slice(targetEnd + 2))) return { state: 'malformed' };
   
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
 
 
 
function withoutArchiveCheck(block) {
  const text = String(block || '');
  const m = /^([^\n]*\n(?:[ \t]*\r?\n)*)([^\n]*)(?:\n|$)/.exec(text);
  if (!m || !CHECK_LINE.test(trimEnd(m[2], ' \t\r'))) return text;
  return m[1] + text.slice(m[0].length);
}

module.exports = { renderArchiveEntry, inspectArchiveEntry, renderLosslessArchiveEntries, parseArchiveEntries, readArchiveEntries,
  archiveCheckLine, readArchiveCheck, hasArchiveCheckMark, withoutArchiveCheck };
