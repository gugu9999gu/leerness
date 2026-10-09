'use strict';
const fs = require('fs');
const path = require('path');
const { CANONICAL_WORKSPACE_DIR, LEGACY_WORKSPACE_DIR } = require('./workspace-dir');
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_DEPTH = 12;
const DETAIL_LIMIT = 40;

function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.size === b.size
    && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink;
}
// Same observed Windows gap as memory-input/store-diagnostic-read: named stats
// may omit the volume serial. A second handle below must confirm it, never a
// generic wildcard. BigInt keeps inode and timestamp comparisons exact.
const pathMatchesHandle = (named, handle) => sameFile(named, handle)
  || (process.platform === 'win32' && named.dev === 0n && handle.dev !== 0n
    && sameFile({ ...named, dev: handle.dev }, handle));
const knownHandle = s => s.isFile() && (process.platform !== 'win32' || (s.dev !== 0n && s.ino !== 0n));

// Read through one descriptor, bounded even if the path grows after lstat.
// These observations detect changes; they are not a locked filesystem snapshot.
function readObservedFile(file, before, io) {
  let fd, confirmation;
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
  try {
    fd = io.openSync(file, flags);
    const opened = io.fstatSync(fd, { bigint: true });
    if (!knownHandle(opened) || !pathMatchesHandle(before, opened)) return { skipped: 'changed' };
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0, n;
    while (length < buffer.length && (n = io.readSync(fd, buffer, length, buffer.length - length, null)) > 0) length += n;
    const after = io.fstatSync(fd, { bigint: true }), atPath = io.lstatSync(file, { bigint: true });
    if (BigInt(length) !== before.size || atPath.isSymbolicLink() || !sameFile(opened, after) || !pathMatchesHandle(atPath, after)) return { skipped: 'changed' };
    if (process.platform === 'win32' && (before.dev === 0n || atPath.dev === 0n)) {
      confirmation = io.openSync(file, flags);
      const confirmed = io.fstatSync(confirmation, { bigint: true }), finalPath = io.lstatSync(file, { bigint: true });
      if (!knownHandle(confirmed) || !sameFile(after, confirmed) || finalPath.isSymbolicLink()
        || !pathMatchesHandle(finalPath, confirmed)) return { skipped: 'changed' };
    }
    return { buffer: buffer.subarray(0, length) };
  } finally {
    let closeFailed = false;
    for (const handle of [confirmation, fd]) if (handle !== undefined) {
      try { io.closeSync(handle); } catch { closeFailed = true; }
    }
    if (closeFailed) throw new Error('File close failed');
  }
}

function harnessProse(file) {
  const parts = file.toLowerCase().split('/');
  return (/\.(md|txt)$/i.test(file) && (parts.includes(CANONICAL_WORKSPACE_DIR) || parts.includes(LEGACY_WORKSPACE_DIR)))
    || (parts.length === 1 && ['agents.md', 'claude.md'].includes(parts[0]));
}

function inspectProse(text, file, result) {
  result.checkedFiles++;
  let fence = null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const marker = raw.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      result.excluded.fencedLines++;
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) { fence = { char: marker[1][0], length: marker[1].length };result.excluded.fencedLines++;continue; }
    if (/^( {4}|\t)/.test(raw)) { result.excluded.indentedLines++;continue; }
    if (/^ {0,3}>/.test(raw)) { result.excluded.quotedLines++;continue; }
    const line = raw.replace(/(`+)(.*?)\1/g, match => { result.excluded.inlineCodeSpans++;return ' '.repeat(match.length); });
    if (!line.trim()) continue;
    // A single example character, ordinary CJK, emoji or punctuation is not proof.
    // One advisory per line avoids presenting the same symptom repeatedly.
    const patterns = [
      ['repeated-c1-controls', /[\u0080-\u009F]/gu],
      ['repeated-replacements', /\uFFFD/gu],
      ['repeated-reinterpretation-signatures', /(?:[ÃÂ][\u0080-\u00BF]|â[\u0080-\u00BF]{1,2}|â€[™œž“”]|ðŸ)/gu],
      ['multiple-in-word-question-gaps', /\p{L}\?{2,}(?=\p{L})/gu],
    ];
    for (const [code, pattern] of patterns) {
      const first = pattern.exec(line);
      if (!first || !pattern.exec(line)) continue;
      result.count++;
      if (result.advisories.length < DETAIL_LIMIT) result.advisories.push({ file, line: i + 1,
        column: Array.from(raw.slice(0, first.index)).length + 1, code, severity: 'advisory' });
      break;
    }
  }
}

function collectEncodingDiagnostics(root, { textExtensions, skipPath, io = fs } = {}) {
  const findings = [];
  const coverage = { complete: true, checkedFiles: 0, checkedBytes: 0, emptyFiles: 0,
    skipped: {}, excluded: { extensionFiles: 0, policyEntries: 0 }, omissions: [], exclusions: [],
    omissionCount: 0, exclusionCount: 0, maxFileBytes: MAX_FILE_BYTES, maxDepth: MAX_DEPTH, detailLimit: DETAIL_LIMIT };
  const byteValidity = { assumption: 'utf-8', validFiles: 0, invalidFiles: 0, status: 'not-checked' };
  const textIntegrity = { status: 'unverified', scope: 'harness-prose', checkedFiles: 0, outOfScopeFiles: 0,
    count: 0, advisories: [], excluded: { fencedLines: 0, indentedLines: 0, quotedLines: 0, inlineCodeSpans: 0 },
    notice: 'Advisories are signals, not proof. Valid UTF-8 and no signals do not establish sentence meaning. No repair was attempted.' };
  const relative = file => path.relative(root, file).replace(/\\/g, '/') || '.';
  function omit(file, reason) {
    coverage.complete = false;coverage.skipped[reason] = (coverage.skipped[reason] || 0) + 1;coverage.omissionCount++;
    if (coverage.omissions.length < DETAIL_LIMIT) coverage.omissions.push({ file: relative(file), reason });
  }
  function exclude(file, reason) {
    coverage.exclusionCount++;
    if (coverage.exclusions.length < DETAIL_LIMIT) coverage.exclusions.push({ file: relative(file), reason });
  }
  function inspect(file, ext, buffer) {
    const name = relative(file);
    coverage.checkedFiles++;coverage.checkedBytes += buffer.length;
    if (!buffer.length) coverage.emptyFiles++;
    const finding = (issue, code, category = 'text-policy') => findings.push({ file: name, issue, code, category });
    if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      if (!['.ps1', '.bat', '.cmd'].includes(ext)) finding('UTF-8 BOM', 'utf8_bom');
    } else if ((buffer[0] === 0xFF && buffer[1] === 0xFE) || (buffer[0] === 0xFE && buffer[1] === 0xFF)) finding('UTF-16 BOM', 'utf16_bom');
    if (buffer.includes(0)) finding('NUL byte (binary in text path)', 'nul_byte');
    if (ext === '.bat' || ext === '.cmd') {
      const prefix = buffer.subarray(0, 4096);
      if (prefix.some(byte => byte >= 0x80) && !/^@?chcp\s+65001/i.test(prefix.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0])) {
        finding(`${ext} missing chcp 65001`, 'batch_prefix');
      }
    }
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);byteValidity.validFiles++; }
    catch { byteValidity.invalidFiles++;finding('invalid UTF-8 roundtrip (CP949/mojibake 의심)', 'invalid_utf8', 'byte-validity');return; }
    if (harnessProse(name)) inspectProse(text, name, textIntegrity);
    else textIntegrity.outOfScopeFiles++;
  }
  function visit(dir, depth) {
    if (depth > MAX_DEPTH) { omit(dir, 'depth');return; }
    let before, entries;
    try {
      before = io.lstatSync(dir, { bigint: true });
      if (before.isSymbolicLink()) { omit(dir, 'link');return; }
      if (!before.isDirectory()) { omit(dir, 'not-directory');return; }
      entries = io.readdirSync(dir, { withFileTypes: true });
    } catch { omit(dir, 'directory-read');return; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name), name = relative(file);
      if (skipPath(name)) { coverage.excluded.policyEntries++;exclude(file, 'configured-policy');continue; }
      if (entry.isSymbolicLink()) { omit(file, 'link');continue; }
      if (entry.isDirectory()) { visit(file, depth + 1);continue; }
      const ext = path.extname(file).toLowerCase();
      if (!textExtensions.has(ext)) { coverage.excluded.extensionFiles++;exclude(file, 'extension');continue; }
      let stat;
      try { stat = io.lstatSync(file, { bigint: true }); } catch { omit(file, 'stat');continue; }
      if (stat.isSymbolicLink()) { omit(file, 'link');continue; }
      if (!stat.isFile()) { omit(file, 'not-regular');continue; }
      if (stat.size > MAX_FILE_BYTES) { omit(file, 'size');continue; }
      let read;
      try { read = readObservedFile(file, stat, io); } catch { omit(file, 'read');continue; }
      if (read.skipped) { omit(file, read.skipped);continue; }
      inspect(file, ext, read.buffer);
    }
    try {
      const after = io.lstatSync(dir, { bigint: true });
      if (after.isSymbolicLink() || !sameFile(before, after)) omit(dir, 'directory-changed');
    } catch { omit(dir, 'directory-changed'); }
  }
  visit(root, 0);
  coverage.omissionsTruncated = coverage.omissionCount > coverage.omissions.length;
  coverage.exclusionsTruncated = coverage.exclusionCount > coverage.exclusions.length;
  byteValidity.status = byteValidity.invalidFiles ? 'invalid' : !coverage.complete ? 'incomplete'
    : coverage.checkedFiles ? 'valid-in-scope' : 'not-checked';
  textIntegrity.status = textIntegrity.count ? 'suspected' : 'unverified';
  textIntegrity.advisoriesTruncated = textIntegrity.count > textIntegrity.advisories.length;
  return { ok: findings.length === 0 && coverage.complete, count: findings.length, findings, byteValidity, coverage, textIntegrity };
}

module.exports = { collectEncodingDiagnostics, MAX_FILE_BYTES, MAX_DEPTH, DETAIL_LIMIT };
