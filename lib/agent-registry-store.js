'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { captureCheckedFileInput } = require('./memory-input');
const text = require('./managed-text');
const { errorLanguage } = require('./error-language');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const optionalText = (value, names) => names.every(name => value[name] == null || typeof value[name] === 'string');
function invalid(file, code, reason, reasonKo) {
  return Object.assign(new Error(errorLanguage() === 'ko'
    ? `${path.basename(file)}: ${reasonKo}. 원본을 보존하고 복구한 뒤 다시 시도하세요.`
    : `${path.basename(file)}: ${reason}. Preserve the original and repair it before retrying.`),
  { code, file, registryStore: true });
}
function tag(error) {
  if (error.code === 'E_TEXT_ENCODING') error.code = 'E_STORE_CORRUPT';
  if (error.code === 'E_TEXT_LIMIT' || error.code === 'E_STORE_LIMIT') error.code = 'E_STORE_INVALID';
  if (error.code === 'E_TEXT_CHANGED') error.code = 'E_STORE_CHANGED';
  if (error.code !== 'E_DRY_RUN_WRITE') error.registryStore = true;
  return error;
}
function validate(document, kind) {
  if (!object(document) || (Object.hasOwn(document, 'schemaVersion') && document.schemaVersion !== 1)) return false;
  if (kind === 'providers') return Array.isArray(document.providers) && document.providers.every(item =>
    object(item) && typeof item.id === 'string' && item.id.trim().length > 0
    && optionalText(item, ['bin', 'envFlag', 'desc', 'installHint', 'installCmd'])
    && (item.versionArgs === undefined || (Array.isArray(item.versionArgs) && item.versionArgs.every(arg => typeof arg === 'string'))));
  return object(document.agents) && Object.values(document.agents).every(item => object(item)
    && optionalText(item, ['label', 'asOf', 'invoke', 'note']) && Array.isArray(item.commands)
    && item.commands.every(command => object(command) && typeof command.cmd === 'string' && command.cmd.trim().length > 0
      && optionalText(command, ['desc'])));
}
function readRegistry(file, kind, { edit = false } = {}) {
  if (kind !== 'providers' && kind !== 'slash') throw invalid(file, 'E_STORE_INVALID', 'unknown registry kind', '알 수 없는 설정 종류입니다');
  const empty = () => kind === 'providers' ? { providers: [] } : { agents: {} };
  try {
    if (!edit) {
      try { fs.lstatSync(path.dirname(file)); }
      catch (error) {
        if (error.code === 'ENOENT') return { document: empty(), file, kind, edit: null };
        throw invalid(file, 'E_STORE_UNREADABLE', 'parent could not be read', '상위 폴더를 읽지 못했습니다');
      }
    }
    const snapshot = edit ? text.captureTextEdit(file) : captureCheckedFileInput(file, { maxBytes: text.MAX_TEXT_BYTES });
    let document = empty();
    if (snapshot.exists) {
      const source = edit ? snapshot.text : text.decodeText(snapshot.bytes, file);
      try { document = JSON.parse(source); }
      catch { throw invalid(file, 'E_STORE_CORRUPT', 'invalid JSON', 'JSON이 올바르지 않습니다'); }
      if (!validate(document, kind)) throw invalid(file, 'E_STORE_INVALID', 'invalid registry shape or schema version', '설정 구조 또는 스키마 버전이 올바르지 않습니다');
    }
    return { document, file, kind, edit: edit ? snapshot : null };
  } catch (error) { throw tag(error); }
}
function publishRegistry(state, document) {
  if (!state?.edit || !validate(document, state.kind)) throw invalid(state?.file || 'registry', 'E_STORE_INVALID', 'invalid registry edit', '설정 변경이 올바르지 않습니다');
  try { return text.publishTextEdit(state.edit, state.file, JSON.stringify(document, null, 2) + '\n'); }
  catch (error) { throw tag(error); }
}
module.exports = { readRegistry, publishRegistry };
