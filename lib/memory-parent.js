'use strict';

const fs = require('fs');
const path = require('path');

// Shared lexical-parent resolution check for checked input and publication.
// This is a check/recheck boundary, not an atomic dirfd/openat fence.
function resolveMemoryParent(parentPath) {
  return path.normalize((fs.realpathSync.native || fs.realpathSync)(parentPath));
}
function sameResolvedParent(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

module.exports = { resolveMemoryParent, sameResolvedParent };
