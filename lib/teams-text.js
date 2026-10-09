'use strict';
const path = require('path');
const { captureTextEdit, assertTextEditCurrent, publishTextEdit, validateText } = require('./managed-text');
const { withStateLock } = require('./state-lock');
const { assertWriteAllowed } = require('./io');
const { _renderTeamsMd } = require('./pure-utils');
const invalid = () => Object.assign(new Error('Invalid teams.json; preserve the original and repair its JSON array/team IDs before retrying.'), { code: 'store_invalid' });
function normalizeTeams(parsed) {
  if (!Array.isArray(parsed) || parsed.some(t => !t || typeof t !== 'object' || typeof t.id !== 'string')) throw invalid();
  const array = value => Array.isArray(value) ? value : value == null ? [] : [String(value)];
  return parsed.map(t => ({ ...t, members: array(t.members), personas: array(t.personas) }));
}
function parseTeams(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw invalid(); }
  return normalizeTeams(parsed);
}
function validateData(value, file) {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'string') validateText(item, file);
    else if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) { validateText(key, file);pending.push(child); }
  }
}
const eolOf = text => (text.match(/\r?\n/) || ['\n'])[0];
const normalizeEol = text => text.replace(/\r\n/g, '\n');
const withEol = (text, source) => normalizeEol(text).replace(/\n/g, eolOf(source));
function createStore(root) {
  const canonical = path.resolve(root, '.leerness/teams.json'), projection = path.resolve(root, '.leerness/teams.md');
  let input, phase = 'canonical-lock', file = canonical;
  const completedFiles = [];
  function annotate(error) {
    const release = error.lockReleaseError || /LOCK_RELEASE/.test(error.code || '');
    error.teamStorage = { file: release && error.lockPath ? error.lockPath.replace(/\.lock$/, '') : file,
      phase: release ? 'lock-release' : phase, completedFiles: [...completedFiles] };
    return error;
  }
  return {
    lock(target, action) {
      if (path.resolve(target) !== canonical) throw new Error('Team storage requires its canonical lock.');
      try {
        return withStateLock(canonical, () => { const result = action();phase = 'lock-release';file = canonical;return result; });
      } catch (error) { throw annotate(error); }
    },
    read() {
      phase = 'canonical-read';file = canonical;
      input = captureTextEdit(canonical);
      const teams = input.exists ? parseTeams(input.text) : [];
      validateData(teams, canonical);
      return { teams, invalid: false };
    },
    save(teams) {
      if (!input) throw new Error('Capture teams under the canonical lock before saving.');
      phase = 'candidate';file = canonical;
      const normalized = normalizeTeams(teams);validateData(normalized, canonical);
      const json = withEol(JSON.stringify(normalized, null, 2) + '\n', input.text);
      phase = 'projection-permission';file = projection;assertWriteAllowed(projection);
      phase = 'projection-lock';
      return withStateLock(projection, () => {
        phase = 'projection-read';const output = captureTextEdit(projection);
        const previous = input.exists ? parseTeams(input.text) : [];
        if (output.exists && normalizeEol(output.text) !== normalizeEol(_renderTeamsMd(previous))) {
          throw Object.assign(new Error('teams.md differs from the generated view. Preserve both files and reconcile authored notes with teams.json before retrying.'), { code: 'E_TEAM_PROJECTION_EDITED' });
        }
        phase = 'candidate';const markdown = withEol(_renderTeamsMd(normalized), output.text);
        phase = 'preflight';file = canonical;assertTextEditCurrent(input, canonical, json);
        file = projection;assertTextEditCurrent(output, projection, markdown);
        phase = 'publication';file = canonical;
        if (publishTextEdit(input, canonical, json).published) completedFiles.push(canonical);
        file = projection;
        if (publishTextEdit(output, projection, markdown).published) completedFiles.push(projection);
        phase = 'lock-release';return { completedFiles: [...completedFiles] };
      });
    }
  };
}
module.exports = { createStore, parseTeams };
