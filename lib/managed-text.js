'use strict';
// Selected managed prose edits compose the existing checked reader/publisher.
// This module is not a new writer, transaction or semantic repair mechanism.
const path = require('path');
const { TextDecoder } = require('util');
const { captureCheckedFileInput, assertCheckedFileCurrent } = require('./memory-input');
const { captureMemoryOutput, publishMemoryOutput } = require('./memory-output');
const { isStateLockHeld } = require('./state-lock');
const { assertNotDryRun } = require('./io');
const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const edits = new WeakMap();
// T-0336: a message is in the language a resolver registered with setErrorLanguage answers (the CLI registers the
// project language of the command's target), asked when the error is built. Only an answer of 'ko' gives Korean:
// nothing registered, something that is not a function or a resolver that throws keeps the English text. The code
// does not change with the language. T-0337: the resolver lives in lib/error-language.js, shared with the other
// write-path modules; setErrorLanguage stays exported here for existing callers.
const { setErrorLanguage, errorLanguage } = require('./error-language');
const korean = () => errorLanguage() === 'ko';
const error = (code, file, reason, reasonKo) => Object.assign(new Error(korean()
  ? `${reasonKo}: ${file}. 원본을 보존하고 확인한 뒤 다시 시도하세요.`
  : `Managed text ${reason}: ${file}. Preserve the original and retry after checking it.`
), { code, file });
function requireLock(file) {
  if (isStateLockHeld(file)) return;
  // T-0339: under --dry-run the CLI takes no state lock (it would leave lock metadata), so every edit reached this
  // refusal before its first write met the dry-run guard. An edit is a write: refuse it as the guard does.
  assertNotDryRun(file);
  throw error('E_TEXT_LOCK', file, 'requires its existing state lock', '관리 문서는 해당 상태 잠금을 잡은 상태에서만 편집할 수 있습니다');
}
function decodeText(bytes, file) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw error('E_TEXT_ENCODING', file, 'has invalid UTF-8; no replacement was attempted', '관리 문서에 UTF-8 로 읽을 수 없는 바이트가 있어 대체 문자로 바꾸지 않았습니다'); }
}
function validateText(text, file) {
  if (typeof text !== 'string') throw error('E_TEXT_TYPE', file, 'replacement must be a string', '관리 문서의 새 내용은 문자열이어야 합니다');
  // Unicode mode matches unpaired surrogates only; valid pairs and user symbols
  // remain exact. A literal replacement character is not proof of lost input.
  if (/[\uD800-\uDFFF]/u.test(text)) throw error('E_TEXT_ENCODING', file, 'replacement contains an unpaired surrogate',
    '관리 문서의 새 내용에 짝이 없는 서로게이트 문자가 있습니다');
}
function captureTextEdit(file, { maxBytes = MAX_TEXT_BYTES } = {}) {
  file = path.resolve(file);requireLock(file);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_TEXT_BYTES) {
    throw error('E_TEXT_LIMIT', file, 'requires a byte limit within the 4 MiB boundary', '관리 문서의 바이트 한도는 4 MiB 이내여야 합니다');
  }
  const input = captureCheckedFileInput(file, { maxBytes });
  const bytes = input.bytes || Buffer.alloc(0);
  const text = decodeText(bytes, file);
  const bom = bytes.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF]));
  const output = captureMemoryOutput(file, { maxBytes });
  assertCheckedFileCurrent(input, file);
  if (input.exists !== output.exists || (input.exists && !bytes.equals(output.bytes))) {
    throw error('E_TEXT_CHANGED', file, 'changed while preparing the edit', '관리 문서가 편집을 준비하는 동안 바뀌었습니다');
  }
  const edit = Object.freeze({ text, exists: input.exists });
  edits.set(edit, { file, input, output, bom, maxBytes, used: false });
  return edit;
}
function prepareTextEdit(edit, file, text) {
  const record = edits.get(edit);file = path.resolve(file);
  if (!record || record.used || record.file !== file) throw error('E_TEXT_SNAPSHOT', file, 'requires an unused snapshot for this exact path',
    '관리 문서 편집에는 이 경로에서 읽고 아직 쓰지 않은 스냅숏이 필요합니다');
  requireLock(file);
  validateText(text, file);
  const length = Buffer.byteLength(text, 'utf8') + (record.bom ? 3 : 0);
  if (length > record.maxBytes) throw error('E_TEXT_LIMIT', file,
    record.maxBytes === MAX_TEXT_BYTES ? 'replacement exceeds the 4 MiB boundary' : `replacement exceeds the ${record.maxBytes} byte boundary`,
    record.maxBytes === MAX_TEXT_BYTES ? '관리 문서의 새 내용이 4 MiB 한도를 넘습니다' : `관리 문서의 새 내용이 ${record.maxBytes} 바이트 한도를 넘습니다`);
  const bytes = Buffer.from((record.bom ? '\uFEFF' : '') + text, 'utf8');
  assertCheckedFileCurrent(record.input, file);
  return { record, bytes, file };
}
// Paired writers can reject deterministic errors in both candidates before the
// first publication. This assertion does not reserve files or consume the edit.
function assertTextEditCurrent(edit, file, text) { prepareTextEdit(edit, file, text); }
function publishTextEdit(edit, file, text) {
  const prepared = prepareTextEdit(edit, file, text);
  // Once publication is attempted its result may be partial. Never reuse the
  // snapshot after an uncertain failure; preserve the publisher's recovery data.
  prepared.record.used = true;
  return publishMemoryOutput(prepared.record.output, prepared.file, prepared.bytes);
}
module.exports = { captureTextEdit, assertTextEditCurrent, publishTextEdit, decodeText, validateText, setErrorLanguage, MAX_TEXT_BYTES };
