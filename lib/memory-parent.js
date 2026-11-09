'use strict';

const fs = require('fs');
const path = require('path');

 
 
function resolveMemoryParent(parentPath) {
  const native = fs.realpathSync.native;
  const input = native && process.platform === 'win32' && typeof parentPath === 'string'
    && path.resolve(parentPath).length >= 260 ? path.toNamespacedPath(parentPath) : parentPath;
  return path.normalize((native || fs.realpathSync)(input));
}
function sameResolvedParent(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

module.exports = { resolveMemoryParent, sameResolvedParent };
