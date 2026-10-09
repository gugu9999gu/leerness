'use strict';
const path = require('path');
const { captureTextEdit, publishTextEdit, validateText } = require('./managed-text');
const { withStateLock } = require('./state-lock');
const { assertWriteAllowed } = require('./io');
const invalid = file => Object.assign(new Error(`Invalid legacy handoff history: ${file}. Preserve the original and check its JSON object, last timestamp and history date strings before retrying.`), { code: 'E_HANDOFF_HISTORY_INVALID' });
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
function parseHistory(text, file) {
  let value;
  try { value = JSON.parse(text); } catch { throw invalid(file); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ('last' in value && !timestamp(value.last))
    || ('history' in value && (!Array.isArray(value.history) || value.history.some(item => !timestamp(item))))) throw invalid(file);
  // Unknown metadata stays intact. Refuse values that would silently change on
  // serialization, rather than repairing them or discarding unknown fields.
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'string') validateText(item, file);
    else if (typeof item === 'number' && !Number.isFinite(item)) throw invalid(file);
    else if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) { validateText(key, file);pending.push(child); }
  }
  return value;
}
function recordLegacyHandoff(root) {
  const file = path.resolve(root, '.leerness/last-handoff.json');
  let phase = 'permission', published = false;
  try {
    assertWriteAllowed(file);phase = 'lock';
    return withStateLock(file, () => {
      phase = 'read';const input = captureTextEdit(file);
      phase = 'parse';const previous = input.exists ? parseHistory(input.text, file) : {};
      const now = new Date().toISOString(), history = [...(previous.history || []), now].slice(-10);
      const eol = (input.text.match(/\r?\n/) || ['\n'])[0];
      phase = 'candidate';const candidate = (JSON.stringify({ ...previous, last: now, history }, null, 2) + '\n').replace(/\n/g, eol);
      phase = 'publication';published = publishTextEdit(input, file, candidate).published;
      phase = 'lock-release';return true;
    });
  } catch (error) {
    error.handoffHistoryStorage = { file, phase: error.lockReleaseError || /LOCK_RELEASE/.test(error.code || '') ? 'lock-release' : phase };
    if (published) error.outputPublished = true;
    throw error;
  }
}
module.exports = { recordLegacyHandoff };
