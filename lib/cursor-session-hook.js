'use strict';

// Cursor project hook wiring for per-conversation leerness session addresses.
// Pure helpers only: adapter IO and conflict handling stay in bin/leerness.js.

const CURSOR_HOOK_CONFIG = '.cursor/hooks.json';
const CURSOR_HOOK_SCRIPT = '.cursor/hooks/leerness-session.cjs';
const CURSOR_HOOK_COMMAND = 'node .cursor/hooks/leerness-session.cjs';
const CURSOR_HOOK_MARK = '// leerness:managed cursor-session-address';

function cursorSessionHookScript() {
  return `'use strict';
${CURSOR_HOOK_MARK}

const crypto = require('crypto');
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}');
    const source = String(input.session_id || input.conversation_id || '').trim();
    if (!source) return;
    const sessionKey = /^[A-Za-z0-9_-]{8,64}$/.test(source)
      ? source
      : 'cursor-' + crypto.createHash('sha256').update(source).digest('hex').slice(0, 32);
    process.stdout.write(JSON.stringify({
      env: { LEERNESS_SESSION_ID: sessionKey },
      additional_context: '[leerness] This Cursor conversation now has a unique session address. Run leerness handoff . before editing; it loads shared context without changing tracked project files.'
    }) + '\\n');
  } catch {}
});
`;
}

function validateCursorHooksConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Cursor hooks config root must be an object');
  }
  if (Object.prototype.hasOwnProperty.call(config, 'hooks')) {
    if (!config.hooks || typeof config.hooks !== 'object' || Array.isArray(config.hooks)) {
      throw new TypeError('Cursor hooks config hooks must be an object');
    }
    if (Object.prototype.hasOwnProperty.call(config.hooks, 'sessionStart')
      && !Array.isArray(config.hooks.sessionStart)) {
      throw new TypeError('Cursor hooks config sessionStart must be an array');
    }
  }
  return config;
}

function mergeCursorHooksConfig(config) {
  validateCursorHooksConfig(config);
  const next = JSON.parse(JSON.stringify(config));
  if (!Object.prototype.hasOwnProperty.call(next, 'version')) next.version = 1;
  if (!next.hooks) next.hooks = {};
  if (!next.hooks.sessionStart) next.hooks.sessionStart = [];
  const already = next.hooks.sessionStart.some(entry => entry && entry.command === CURSOR_HOOK_COMMAND);
  if (!already) next.hooks.sessionStart.push({ command: CURSOR_HOOK_COMMAND });
  return { config: next, changed: !already };
}

function isManagedCursorHookScript(content) {
  return String(content || '').includes(CURSOR_HOOK_MARK);
}

module.exports = {
  CURSOR_HOOK_CONFIG,
  CURSOR_HOOK_SCRIPT,
  CURSOR_HOOK_COMMAND,
  CURSOR_HOOK_MARK,
  cursorSessionHookScript,
  validateCursorHooksConfig,
  mergeCursorHooksConfig,
  isManagedCursorHookScript,
};
