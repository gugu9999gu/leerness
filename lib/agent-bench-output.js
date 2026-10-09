'use strict';
// Compatibility boundary: bench and interactive CLI streams share one collector.
const { collectUtf8Process, MAX_OUTPUT_BYTES, TAIL_CHARS, STOP_GRACE_MS } = require('./process-output');
module.exports = { collectBenchProcess: collectUtf8Process, MAX_OUTPUT_BYTES, TAIL_CHARS, STOP_GRACE_MS };
