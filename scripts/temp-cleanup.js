'use strict';

// Remove a probe's temporary tree while another process or thread may still hold a handle in it for
// a moment (a child that is exiting, antivirus, a worker thread). Node 26.3 fs.rmSync does not retry
// EPERM even with maxRetries: a directory held as a child's cwd, or a file held open without sharing,
// fails after 0-1 ms on Windows. So the wait is explicit and bounded, on the codes Node documents
// for maxRetries. rm options pass through unchanged; callers keep their own path-safety checks.
const fs = require('fs');

const RETRY_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']);

function removeTree(target, rmOptions = {}, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { return fs.rmSync(target, rmOptions); }
    catch (error) {
      if (!RETRY_CODES.has(error && error.code) || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, intervalMs);
    }
  }
}

module.exports = { removeTree, RETRY_CODES };
