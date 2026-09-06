'use strict';

// Observation only: never spawn, retry, change the native result or decide success.
function childDiagnostics(result, elapsedMs, timeoutMs, parsedReport) {
  const r = result || {};
  const small = (value, limit) => value == null ? null : String(value).slice(0, limit);
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const stdout = r.stdout == null ? null : String(r.stdout);
  const stderr = r.stderr == null ? null : String(r.stderr);
  const report = parsedReport || {};
  const selftest = report.selftest;
  const failed = selftest && Array.isArray(selftest.failed) ? selftest.failed : [];
  return {
    status: number(r.status), signal: small(r.signal, 80),
    errorCode: small(r.error && r.error.code, 80),
    errno: r.error ? (number(r.error.errno) ?? small(r.error.errno, 80)) : null,
    errorMessage: small(r.error && r.error.message, 160),
    elapsedMs: Math.max(0, Math.round(number(elapsedMs) || 0)), timeoutMs: number(timeoutMs),
    stdoutBytes: stdout === null ? null : Buffer.byteLength(stdout),
    stderrBytes: stderr === null ? null : Buffer.byteLength(stderr),
    stdoutTail: stdout === null ? null : stdout.slice(-256),
    stderrTail: stderr === null ? null : stderr.slice(-256),
    version: small(report.version, 64), mcpTools: number(report.mcpTools),
    healthy: typeof report.healthy === 'boolean' ? report.healthy : null,
    selftest: selftest ? {
      pass: number(selftest.pass), total: number(selftest.total),
      ok: typeof selftest.ok === 'boolean' ? selftest.ok : null,
      failedCount: failed.length, failed: failed.slice(0, 5).map(name => String(name).slice(0, 120)),
    } : null,
  };
}

module.exports = { childDiagnostics };
