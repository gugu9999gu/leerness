'use strict';

const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');
const MAX_BYTES = 1024 * 1024;
const NAMES = new Set(['decisions.json', 'lessons.json', 'agent-roles.json', 'decisions.md', 'lessons.md']);
const identity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
const snapshot = (a, b) => identity(a, b) && a.size === b.size
  && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink;
const regular = stat => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n;

// 고정된 최상위 파일만 읽는다. 반환 text는 내부용이며 공개 보고서에 복사하지 않는다.
const readStoreFile = (workspace, name) => {
  let fd = null;
  let bytesRead = 0;
  const fail = (status, reasonCode) => ({ status, reasonCode, bytesRead });
  if (!NAMES.has(name)) return fail('unsupported', 'store_not_supported');
  const file = path.join(workspace, name);
  try {
    let parent;
    try { parent = fs.lstatSync(workspace, { bigint: true }); }
    catch (error) { return fail(error.code === 'ENOENT' ? 'missing' : 'unreadable', 'workspace_unavailable'); }
    if (parent.isSymbolicLink() || !parent.isDirectory()) return fail('unsupported', 'workspace_type');
    const parentStable = () => {
      const now = fs.lstatSync(workspace, { bigint: true });
      return now.isDirectory() && !now.isSymbolicLink() && identity(parent, now);
    };
    let before;
    try { before = fs.lstatSync(file, { bigint: true }); }
    catch (error) {
      if (!parentStable()) return fail('unknown', 'workspace_changed');
      return fail(error.code === 'ENOENT' ? 'missing' : 'unreadable', error.code === 'ENOENT' ? 'file_missing' : 'stat_failed');
    }
    if (!regular(before)) return fail('unsupported', 'file_type_or_links');
    if (before.size > BigInt(MAX_BYTES)) return fail('unsupported', 'size_limit');
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
    fd = fs.openSync(file, flags);
    const opened = fs.fstatSync(fd, { bigint: true });
    const current = fs.lstatSync(file, { bigint: true });
    if (!parentStable() || !regular(opened) || !regular(current)
      || !snapshot(before, opened) || !snapshot(opened, current)) return fail('unknown', 'changed_before_read');
    // 크기 검사와 별개로 실제 I/O를 limit+1 바이트에서 중단한다.
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    while (bytesRead < buffer.length) {
      const n = fs.readSync(fd, buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (n === 0) break;
      bytesRead += n;
    }
    if (bytesRead > MAX_BYTES) return fail('unsupported', 'size_limit');
    const after = fs.fstatSync(fd, { bigint: true });
    const afterPath = fs.lstatSync(file, { bigint: true });
    if (!parentStable() || !regular(afterPath) || !snapshot(opened, after)
      || !snapshot(after, afterPath) || BigInt(bytesRead) !== after.size) return fail('unknown', 'changed_during_read');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)); }
    catch { return fail('unsupported', 'invalid_utf8'); }
    return { status: 'valid', reasonCode: 'read_ok', bytesRead, text };
  } catch {
    return fail('unreadable', 'read_failed');
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
};

module.exports = { readStoreFile, MAX_BYTES };
