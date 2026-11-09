'use strict';
const { performance } = require('node:perf_hooks');

function deadlineOptions(options = {}) {
  const { deadlineAt, ...childOptions } = options;
  if (deadlineAt === undefined) return childOptions;
  if (!Number.isFinite(deadlineAt)) throw new TypeError('Process deadline must be finite');
  const remaining = Math.floor(deadlineAt - performance.now());
  if (remaining < 1) throw Object.assign(new Error('Process observation deadline exceeded'), { code: 'ETIMEDOUT' });
  const timeout = Number.isFinite(childOptions.timeout) && childOptions.timeout > 0
    ? Math.min(childOptions.timeout, remaining) : remaining;
  return { ...childOptions, timeout, killSignal: 'SIGKILL' };
}

module.exports = { deadlineOptions };
