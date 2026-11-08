'use strict';
const { _lineSafe } = require('./pure-utils');
function formatError(error, { json = true, storeGuard = true } = {}) {
  const raw = String(error?.code || '');
  let code = 'error', message = String(error?.message || error || 'command failed');
  if (storeGuard && /^E_(?:STORE_(?:CORRUPT|INVALID|ITEM_UNSUPPORTED|UNREADABLE|CHANGED)|PROJECTION_(?:CORRUPT|DIVERGED)|OUTPUT_(?:CHANGED|CAS_UNAVAILABLE))$/.test(raw)) code = raw.slice(2).toLowerCase();
  else if (raw === 'invalid_owner_priorities' || /^history_[a-z0-9_]+$/.test(raw)) { code = raw; message = _lineSafe(message); }
  else if (raw === 'E_RUNTIME_LAYOUT_INCOMPATIBLE') code = /^workspace_dir_/.test(error.reasonCode || '') ? error.reasonCode : 'runtime_layout_incompatible';
  else if (/^E_WORKSPACE_DIR_/.test(raw) || raw === 'E_GIT_HISTORY_UNAVAILABLE') { code = raw.slice(2).toLowerCase(); message = _lineSafe(message); }
  return { code, message, text: json ? JSON.stringify({ ok: false, error: message, code }, null, 2) + '\n' : '✗ ' + message + '\n' };
}
module.exports = { formatError };
