'use strict';

 
 
 
const { TextDecoder } = require('util');
const { captureCheckedFileInput, assertCheckedFileCurrent, getLegacyMemoryInput } = require('./memory-input');
const { _renderDecisionsMd, _renderLessonsMd, _memoryPreambleLanguages } = require('./pure-utils');

function render(surface, entries, lang) {
  if (surface === 'decisions') return _renderDecisionsMd(entries, lang);
  if (surface === 'lessons') return _renderLessonsMd(entries, lang);
  const e = new Error(`Unsupported memory projection surface: ${surface}`);
  e.code = 'E_PROJECTION_SURFACE';
  throw e;
}

function projectionError(code, file, reason) {
  return Object.assign(new Error(`Memory projection ${reason}: ${file} — 원문을 보존한 채 상태를 확인한 뒤 재시도하세요`), { code, file });
}

function decodeSnapshot(snapshot, file) {
   
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(snapshot.bytes); }
  catch { throw projectionError('E_PROJECTION_CORRUPT', file, 'has malformed UTF-8'); }
}

function prepareMemoryProjection(surface, input, file, nextEntries, readOptions = {}, language = 'ko') {
  const nextGenerated = render(surface, nextEntries, language);
   
   
  if (!input || input.source === 'empty') return Object.freeze({ text: nextGenerated, snapshot: null, suffixLength: 0 });

  const snapshot = input.source === 'legacy' ? getLegacyMemoryInput(input, file) : captureCheckedFileInput(file,readOptions);
  if (!snapshot.exists) return Object.freeze({ text: nextGenerated, snapshot, suffixLength: 0 });

  const current = decodeSnapshot(snapshot, file);
   
   
  let suffix = null;
  for (const lang of _memoryPreambleLanguages(language)) {
    const expectedGenerated = render(surface, input.entries, lang);
    if (current.startsWith(expectedGenerated)) { suffix = current.slice(expectedGenerated.length); break; }
  }
  if (suffix === null) {
    if (input.source !== 'legacy' || input.entries.length !== 0) {
      throw projectionError('E_PROJECTION_DIVERGED', file, input.source === 'legacy'
        ? 'legacy records cannot be rewritten without losing original text'
        : 'generated prefix was edited, reordered, or left behind by an interrupted save (copy any notes below the generated part, move this file aside and retry; it is rebuilt from its .json store)');
    }
     
     
    suffix = current;
  }
  return Object.freeze({ text: nextGenerated + suffix, snapshot, suffixLength: Buffer.byteLength(suffix, 'utf8') });
}

function assertMemoryProjectionCurrent(prepared, file) {
  if (prepared && prepared.snapshot) assertCheckedFileCurrent(prepared.snapshot, file);
}

module.exports = { prepareMemoryProjection, assertMemoryProjectionCurrent };
