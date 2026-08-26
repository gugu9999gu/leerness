'use strict';

function _entries(env, name) {
  return Object.entries(env || {}).filter(([key]) => key.toLowerCase() === name.toLowerCase());
}

function warningSuppressionReasons(env) {
  const reasons = [];
  for (const [, value] of _entries(env, 'NODE_NO_WARNINGS')) {
    if (value !== undefined && value !== null && !/^(?:0|false)?$/i.test(String(value).trim())) {
      reasons.push('NODE_NO_WARNINGS');
    }
  }
  for (const [, value] of _entries(env, 'NODE_OPTIONS')) {
    const options = String(value || '');
    if (/(?:^|[\s"'])--no-(?:deprecation|warnings)(?=$|[\s"'])/i.test(options)) {
      reasons.push('NODE_OPTIONS warning suppression');
    }
    // Fail closed for every disable-warning value. A future/runtime alias must not
    // silently disable DEP0190 while the gate claims it observed all warnings.
    if (/(?:^|[\s"'])--disable-warning(?:=|\s)/i.test(options)) {
      reasons.push('NODE_OPTIONS --disable-warning');
    }
  }
  return Array.from(new Set(reasons));
}

function _stripNodeWarningOptions(value) {
  return String(value || '')
    .replace(/--no-(?:deprecation|warnings)\b/gi, '')
    .replace(/--disable-warning(?:=(?:"[^"]*"|'[^']*'|[^\s]+)|\s+(?:"[^"]*"|'[^']*'|[^\s]+))/gi, '')
    .replace(/--redirect-warnings(?:=(?:"[^"]*"|'[^']*'|[^\s]+)|\s+(?:"[^"]*"|'[^']*'|[^\s]+))/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeWarningEnv(env) {
  const out = { ...(env || {}) };
  let nodeOptions = '';
  for (const key of Object.keys(out)) {
    const lower = key.toLowerCase();
    if (lower === 'node_options') { nodeOptions = out[key]; delete out[key]; }
    if (lower === 'node_no_warnings') delete out[key];
  }
  const sanitized = _stripNodeWarningOptions(nodeOptions);
  if (sanitized) out.NODE_OPTIONS = sanitized;
  return out;
}

function withRedirectWarnings(env, warningFile) {
  const reasons = warningSuppressionReasons(env);
  const out = sanitizeWarningEnv(env);
  const file = String(warningFile).replace(/\\/g, '/').replace(/"/g, '\\"');
  const redirect = `--redirect-warnings="${file}"`;
  out.NODE_OPTIONS = [out.NODE_OPTIONS, redirect].filter(Boolean).join(' ');
  return { env: out, reasons };
}

module.exports = { warningSuppressionReasons, sanitizeWarningEnv, withRedirectWarnings };
