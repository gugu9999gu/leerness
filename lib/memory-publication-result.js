'use strict';

// Observe only the finite set of paths reported by this publication. This is
// neither a recovery-tree walk nor a promise about later external file growth.
const fs = require('fs');
const path = require('path');
function retainedCandidates(outputs) {
  const found = new Map();
  for (const output of outputs) {
    const candidates = [...(output.recoveryArtifacts || [])];
    for (const key of ['backupFile','cleanupArtifact','cleanupDirectory','rollbackArtifact']) {
      if (output[key]) candidates.push({ role: key, path: output[key] });
    }
    for (const item of candidates) if (item && item.path) {
      const file = path.resolve(item.path);
      if (!found.has(file)) found.set(file,{ ...item, role: item.role || output.role, path: file });
    }
  }
  return [...found.values()];
}
function publicationResult(root, maxBytes, outputs) {
  const retainedPaths = [];
  for (const item of retainedCandidates(outputs)) {
    const relative = path.relative(root,item.path).replace(/\\/g,'/');
    const entry = { role: item.role, path: relative };
    try {
      const stat = fs.lstatSync(item.path);
      if (stat.isFile() && !stat.isSymbolicLink()) Object.assign(entry,{ kind: 'file', bytes: stat.size });
      else Object.assign(entry,{ kind: stat.isDirectory() ? 'directory' : 'other', bytes: null });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      Object.assign(entry,{ kind: 'unreadable', bytes: null, error: error.code || 'read_failed' });
    }
    retainedPaths.push(entry);
  }
  const cleanupPending = retainedPaths.length > 0 || outputs.some(output => !!output.cleanupError);
  return { validationReadMaxBytes: maxBytes, cleanupPending, retainedPaths,
    knownRetainedFileBytes: retainedPaths.reduce((sum,item) => sum + (item.bytes || 0),0),
    retainedInventoryComplete: retainedPaths.every(item => item.kind === 'file'),
    normalCleanupConfirmed: !cleanupPending && !outputs.some(output => !!output.code), recoveryReadsBounded: false,
    failureRetentionBounded: false, physicalReservation: false };
}
module.exports = { publicationResult, retainedCandidates };
