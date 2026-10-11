'use strict';

// Internal operation-local metadata inventory. No receipt parsing or file reads.
const fs = require('fs');
const path = require('path');
const { resolveMemoryParent, sameResolvedParent } = require('./memory-parent');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const same = (a, b) => a === null || b === null ? a === b
  : ['dev','ino','mode','size','nlink','mtimeNs','ctimeNs'].every(k => a[k] === b[k]);
const stat = file => {
  try { return fs.lstatSync(file, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
const directory = file => {
  const value = stat(file);
  if (value && (!value.isDirectory() || value.isSymbolicLink())) fail('recovery_unsupported');
  return { file, stat: value, resolved: value ? resolveMemoryParent(file) : null };
};
const current = record => {
  const now = stat(record.file);
  if (!same(record.stat, now)) fail('recovery_changed');
  if (record.resolved !== null && (!now.isDirectory() || now.isSymbolicLink()
    || !sameResolvedParent(record.resolved, resolveMemoryParent(record.file)))) fail('recovery_changed');
};
// T-0343: adding an entry within one timestamp tick leaves the directory's lstat as it was (measured
// over 2,000 adds: Linux, with 4 ms ticks, kept it 1,986-1,990 times; Windows 1,478 times). A recheck
// therefore also lists each scanned directory again and compares the names. As in the scan, the
// directory is checked again after it is opened and after it is listed, so a junction put in place
// before the listing is rejected instead of followed.
const listed = record => {
  const names = new Set(record.names);
  let handle, count = 0;
  try {
    handle = fs.opendirSync(record.file, { bufferSize: 1 });
    current(record);
    let entry;
    while ((entry = handle.readSync()) !== null) if (++count > names.size || !names.has(entry.name)) fail('recovery_changed');
  } finally { if (handle) handle.closeSync(); }
  current(record);
  if (count !== names.size) fail('recovery_changed');
};

function captureRecoveryInventory(workspace, limits) {
  const records = [], pending = [];
  let bytes = 0, entryCount = 0, fileCount = 0, directoryCount = 0;
  // Check each fixed ancestor before touching a descendant. Never follow an
  // archive/recovery junction in order to learn that it was a junction later.
  for (const file of [workspace, path.join(workspace,'archive'), path.join(workspace,'archive','mutation-recovery')]) {
    const record = directory(file); records.push(record);
    if (!record.stat) return inventory(false);
  }
  const base = records.at(-1); pending.push({ record: base, depth: 0 }); directoryCount = 1;
  while (pending.length) {
    const { record, depth } = pending.pop();
    current(record);
    let handle;
    try {
      handle = fs.opendirSync(record.file, { bufferSize: 1 });
      current(record);
      let entry;
      record.names = [];
      while ((entry = handle.readSync()) !== null) {
        if (++entryCount > limits.maxRecoveryEntries) fail('recovery_entries_exceeded');
        if (!entry.name || entry.name === '.' || entry.name === '..'
          || entry.name.includes('/') || entry.name.includes('\\') || entry.name.includes('\0')) fail('recovery_unsupported');
        record.names.push(entry.name);
        const file = path.join(record.file, entry.name), value = stat(file);
        if (!value) fail('recovery_changed');
        if (value.isSymbolicLink()) fail('recovery_unsupported');
        if (value.isDirectory()) {
          if (depth + 1 > limits.maxRecoveryDepth) fail('recovery_depth_exceeded');
          const child = { file, stat: value, resolved: resolveMemoryParent(file) };
          records.push(child); pending.push({ record: child, depth: depth + 1 }); directoryCount++;
        } else {
          if (!value.isFile() || value.nlink !== 1n || value.size < 0n) fail('recovery_unsupported');
          if (value.size > BigInt(limits.maxRecoveryBytes - bytes)) fail('recovery_bytes_exceeded');
          bytes += Number(value.size); fileCount++;
          records.push({ file, stat: value, resolved: null });
        }
      }
    } finally { if (handle) handle.closeSync(); }
    current(record);
  }
  return inventory(true);

  function inventory(exists) {
    return { metadata: { exists, bytes, fileCount, directoryCount, entryCount,
      scope: 'shared-workspace', contentRead: false },
    recheck() { for (const record of records) { current(record); if (record.names) listed(record); } } };
  }
}

module.exports = { captureRecoveryInventory };
