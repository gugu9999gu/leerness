'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { captureCheckedFileInput } = require('./memory-input');
const text = require('./managed-text');
const { withStateLock } = require('./state-lock');
const { errorLanguage } = require('./error-language');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const timestamp = value => typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value));
const optional = (value, fields, check) => fields.every(field => value[field] == null || check(value[field]));
const string = value => typeof value === 'string';
function failure(file, code, en, ko) {
  return Object.assign(new Error(errorLanguage() === 'ko'
    ? `${path.basename(file)}: ${ko}. 원본을 보존하고 복구한 뒤 다시 시도하세요.`
    : `${path.basename(file)}: ${en}. Preserve the original and repair it before retrying.`), { code, file, resumeStore: true });
}
function tagged(error) {
  if (error.code === 'E_TEXT_ENCODING') error.code = 'E_STORE_CORRUPT';
  if (error.code === 'E_TEXT_LIMIT' || error.code === 'E_STORE_LIMIT') error.code = 'E_STORE_INVALID';
  if (error.code === 'E_TEXT_CHANGED') error.code = 'E_STORE_CHANGED';
  if (error.code !== 'E_DRY_RUN_WRITE') error.resumeStore = true;
  return error;
}
function valid(value, kind) {
  if (!object(value) || (Object.hasOwn(value, 'schemaVersion') && value.schemaVersion !== 1)) return false;
  if (kind === 'queue') return Array.isArray(value.queue) && optional(value, ['at'], timestamp)
    && value.queue.every(item => object(item) && typeof item.title === 'string' && item.title.trim() !== ''
      && optional(item, ['icon', 'command', 'actionKey', 'addedAt'], string));
  if (kind === 'wakeups') return Array.isArray(value.wakeups) && value.wakeups.every(item => object(item)
    && timestamp(item.expectedFireAt) && optional(item, ['registeredAt'], timestamp)
    && optional(item, ['status', 'source', 'fromVersion'], string));
  if (kind === 'history') return Array.isArray(value.fires) && value.fires.every(item => object(item)
    && timestamp(item.at) && optional(item, ['kind'], string))
    && (value.override == null || (typeof value.override === 'number' && Number.isFinite(value.override) && value.override >= 60));
  return timestamp(value.savedAt) && optional(value, ['expectedFireAt'], timestamp)
    && optional(value, ['focus', 'nextRoundVersion', 'note'], string)
    && (value.nextActions === undefined || (Array.isArray(value.nextActions) && value.nextActions.every(item => object(item)
      && typeof item.title === 'string' && optional(item, ['icon', 'command'], string))));
}
function emptyState(kind) {
  return kind === 'wakeups' ? { wakeups: [] } : kind === 'queue' ? { queue: [], at: null }
    : kind === 'history' ? { fires: [], override: null } : null;
}
function readState(file, kind, edit = false) {
  try {
    if (!edit) {
      try { fs.lstatSync(path.dirname(file)); }
      catch (error) {
        if (error.code === 'ENOENT') return { document: emptyState(kind), edit: null };
        throw failure(file, 'E_STORE_UNREADABLE', 'parent could not be read', '상위 폴더를 읽지 못했습니다');
      }
    }
    const input = edit ? text.captureTextEdit(file) : captureCheckedFileInput(file, { maxBytes: text.MAX_TEXT_BYTES });
    let document = emptyState(kind);
    if (input.exists) {
      const raw = edit ? input.text : text.decodeText(input.bytes, file);
      try { document = JSON.parse(raw); }
      catch { throw failure(file, 'E_STORE_CORRUPT', 'invalid JSON', 'JSON이 올바르지 않습니다'); }
      if (!valid(document, kind)) throw failure(file, 'E_STORE_INVALID', 'invalid state shape or schema version', '상태 구조 또는 스키마 버전이 올바르지 않습니다');
    }
    return { document, edit: edit ? input : null };
  } catch (error) { throw tagged(error); }
}
function publish(file, kind, state, document) {
  if (!valid(document, kind)) throw failure(file, 'E_STORE_INVALID', 'invalid replacement state', '저장할 상태가 올바르지 않습니다');
  const newline = state.edit.text.includes('\r\n') ? '\r\n' : '\n';
  const encoded = (JSON.stringify(document, null, 2) + '\n').replace(/\n/g, newline);
  return text.publishTextEdit(state.edit, file, encoded);
}
function updateWakeups(file, change) {
  try {
    return withStateLock(file, () => {
      const state = readState(file, 'wakeups', true), before = JSON.stringify(state.document.wakeups);
      const result = change(state.document.wakeups);
      if (before !== JSON.stringify(state.document.wakeups)) {
        state.document.updatedAt = new Date().toISOString();
        publish(file, 'wakeups', state, state.document);
      }
      return result;
    });
  } catch (error) { throw tagged(error); }
}
function updateQueue(file, change) {
  try {
    return withStateLock(file, () => {
      const state = readState(file, 'queue', true), before = JSON.stringify(state.document.queue);
      const result = change(state.document);
      if (before !== JSON.stringify(state.document.queue)) {
        state.document.at = new Date().toISOString();
        publish(file, 'queue', state, state.document);
      }
      return result;
    });
  } catch (error) { throw tagged(error); }
}
function savePlan(file, plan) {
  try {
    return withStateLock(file, () => {
      const state = readState(file, 'plan', true);
      publish(file, 'plan', state, { ...state.document, savedAt: new Date().toISOString(), ...plan });
      return true;
    });
  } catch (error) { throw tagged(error); }
}
function updateHistory(file, change) {
  try {
    return withStateLock(file, () => {
      const state = readState(file, 'history', true);
      state.document = { override: null, ...state.document };
      const result = change(state.document);
      state.document.updatedAt = new Date().toISOString();
      publish(file, 'history', state, state.document);
      return result;
    });
  } catch (error) { throw tagged(error); }
}
module.exports = {
  readWakeups: file => readState(file, 'wakeups').document,
  readPlan: file => readState(file, 'plan').document,
  readQueue: file => readState(file, 'queue').document,
  readHistory: file => ({ override: null, ...readState(file, 'history').document }),
  updateQueue, updateWakeups, savePlan, updateHistory,
};
