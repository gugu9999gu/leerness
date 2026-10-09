'use strict';

// Restore absence by retaining the displaced object, never by unchecked unlink.
// A competing pathname winner is preserved. This is not an atomic CAS/delete.
const fs = require('fs');
const path = require('path');
const { captureCheckedFileInput, assertCheckedFileCurrent, describeCheckedFileInput } = require('./memory-input');
const { directory, assertDirectory } = require('./memory-migration-storage');
const { fail } = require('./memory-migration-material');
const { assertWriteAllowed, detachCommittedHardLink } = require('./io');

function withdrawCanonical(file, expectedBytes, storage) {
  const parent = directory(path.dirname(file));
  const input = captureCheckedFileInput(file, { maxBytes: 4 * 1024 * 1024 });
  if (!input.exists || !input.bytes.equals(expectedBytes)) fail('migration_canonical_changed');
  const before = describeCheckedFileInput(input, file).stat;
  assertWriteAllowed(file); assertDirectory(parent); storage.check();
  const quarantine = fs.mkdtempSync(path.join(storage.dir, 'withdraw-'));
  const retainedDirectory = directory(quarantine);
  const kept = path.join(quarantine, 'canonical.json');
  let moved = false;
  try {
    assertCheckedFileCurrent(input, file); assertDirectory(parent); storage.check(); assertDirectory(retainedDirectory);
    fs.renameSync(file, kept); moved = true;
    const captured = captureCheckedFileInput(kept, { maxBytes: 4 * 1024 * 1024 });
    const after = describeCheckedFileInput(captured, kept).stat;
    const identical = captured.exists && input.bytes.equals(captured.bytes)
      && ['dev', 'ino', 'mode', 'size', 'mtimeNs'].every(key => before[key] === after[key]);
    if (!identical) {
      // Return an external object only through exclusive creation. Never replace
      // a pathname another writer has already filled during our rename window.
      try { fs.linkSync(kept, file); detachCommittedHardLink(kept, file, captured.bytes); }
      catch { /* The captured object stays in quarantine when restoration conflicts. */ }
      fail('migration_canonical_changed');
    }
    assertDirectory(parent); storage.check(); assertDirectory(retainedDirectory);
    const absent = captureCheckedFileInput(file, { maxBytes: 4 * 1024 * 1024 });
    if (absent.exists) fail('migration_canonical_recreated');
    assertCheckedFileCurrent(absent, file);
    return { retainedCanonical: kept };
  } catch (error) {
    error.outputMutationStarted = moved;
    error.recoveryArtifacts = [{ role: 'withdrawn-canonical', path: kept }];
    throw error;
  }
}
module.exports = { withdrawCanonical };
