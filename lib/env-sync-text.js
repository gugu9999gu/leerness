'use strict';
const fs = require('fs'), path = require('path');
const { captureCheckedFileInput, assertCheckedFileCurrent } = require('./memory-input');
const { captureTextEdit, assertTextEditCurrent, publishTextEdit, decodeText, MAX_TEXT_BYTES } = require('./managed-text');
const { withStateLock } = require('./state-lock');
const { assertWriteAllowed } = require('./io');
const { _parseEnvKeys } = require('./pure-utils');

function syncEnvironmentExample(root, { dryRun = false } = {}) {
  const file = path.resolve(root, '.env.example'), sourceFile = path.resolve(root, '.env');
  let stage = 'target-read', activeFile = file, saved = false;
  const missingExample = () => Object.assign(new Error('.env.example 없음 — leerness init . 먼저 실행'), { code: 'E_ENV_EXAMPLE_MISSING' });
  const readSource = source => {
    const input = captureCheckedFileInput(source, { maxBytes: MAX_TEXT_BYTES });
    return { input, exists: input.exists, text: decodeText(input.bytes || Buffer.alloc(0), source) };
  };
  const edit = () => {
    stage = 'target-read';activeFile = file;
    // Dry-run observations require no lock metadata and cannot publish.
    const target = dryRun ? readSource(file) : captureTextEdit(file);
    if (!target.exists) throw missingExample();
    stage = 'source-read';activeFile = sourceFile;
    const source = readSource(sourceFile);
    const keys = _parseEnvKeys(source.text), existing = _parseEnvKeys(target.text);
    const added = [...keys].filter(key => !existing.has(key));
    stage = 'source-check';assertCheckedFileCurrent(source.input, sourceFile);
    stage = 'target-check';activeFile = file;
    if (dryRun) assertCheckedFileCurrent(target.input, file);
    else assertTextEditCurrent(target, file, target.text);
    if (!added.length) { stage = 'lock-release';return { file, added }; }
    stage = 'permission';assertWriteAllowed(file);
    if (dryRun) throw Object.assign(new Error('Environment sync dry-run cannot save changes.'), { code: 'E_DRY_RUN_UNSUPPORTED' });
    const eol = (target.text.match(/\r?\n/) || ['\n'])[0];
    const candidate = target.text + (target.text.endsWith('\n') ? '' : eol) + eol +
      '# 1.9.71 sync: .env에서 발견된 누락 키 (값은 빈 문자열 — 보안 정책)' + eol + added.map(key => key + '=').join(eol) + eol;
    stage = 'preflight';assertTextEditCurrent(target, file, candidate);
    stage = 'source-check';activeFile = sourceFile;assertCheckedFileCurrent(source.input, sourceFile);
    stage = 'publication';activeFile = file;publishTextEdit(target, file, candidate);saved = true;
    stage = 'lock-release';return { file, added };
  };
  try {
    // Preserve the existing requirement without creating a missing project directory.
    if (!fs.existsSync(file)) throw missingExample();
    if (dryRun) return edit();
    stage = 'lock';return withStateLock(file, edit);
  } catch (error) {
    error.envSyncStage = stage;error.envSyncFile = activeFile;
    if (saved) error.outputPublished = true;
    throw error;
  }
}
module.exports = { syncEnvironmentExample };
