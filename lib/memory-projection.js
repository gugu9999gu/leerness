'use strict';

// T-0193: canonical JSON 또는 lossless legacy 입력의 projection은 generated
// prefix + opaque appended suffix로 취급한다. Generated prefix 내부의 외부 편집은
// 재해석하지 않고 fail-closed하며, suffix는 byte-equivalent UTF-8 text로 보존한다.
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
  // BOM도 원문 바이트다. Decoder가 자동 제거하면 prefix 검사가 유실을 숨긴다.
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(snapshot.bytes); }
  catch { throw projectionError('E_PROJECTION_CORRUPT', file, 'has malformed UTF-8'); }
}

function prepareMemoryProjection(surface, input, file, nextEntries, readOptions = {}, language = 'ko') {
  const nextGenerated = render(surface, nextEntries, language);
  // Legacy 파서의 반환 배열만으로 원문 보존을 인증할 수 없다. 같은 prefix/suffix
  // 검사를 첫 canonical 생성에도 적용하며, source 재검사는 호출측이 유지한다.
  if (!input || input.source === 'empty') return Object.freeze({ text: nextGenerated, snapshot: null, suffixLength: 0 });

  const snapshot = input.source === 'legacy' ? getLegacyMemoryInput(input, file) : captureCheckedFileInput(file,readOptions);
  if (!snapshot.exists) return Object.freeze({ text: nextGenerated, snapshot, suffixLength: 0 });

  const current = decodeSnapshot(snapshot, file);
  // T-0318: the generated prefix may carry any known header variant (an older version, or the project before a
  // language change, wrote it). Only that tool-written header is replaced; records and suffix still match exactly.
  let suffix = null;
  for (const lang of _memoryPreambleLanguages(language)) {
    const expectedGenerated = render(surface, input.entries, lang);
    if (current.startsWith(expectedGenerated)) { suffix = current.slice(expectedGenerated.length); break; }
  }
  if (suffix === null) {
    if (input.source !== 'legacy' || input.entries.length !== 0) {
      throw projectionError('E_PROJECTION_DIVERGED', file, input.source === 'legacy'
        ? 'legacy records cannot be rewritten without losing original text'
        : 'generated prefix was edited or reordered');
    }
    // 신규 init의 언어별 template/frontmatter나 parser가 읽지 않는 메모만 있으면
    // 제거할 record가 없다. 원문 전체를 기존 opaque suffix 영역에 정확히 보존한다.
    suffix = current;
  }
  return Object.freeze({ text: nextGenerated + suffix, snapshot, suffixLength: Buffer.byteLength(suffix, 'utf8') });
}

function assertMemoryProjectionCurrent(prepared, file) {
  if (prepared && prepared.snapshot) assertCheckedFileCurrent(prepared.snapshot, file);
}

module.exports = { prepareMemoryProjection, assertMemoryProjectionCurrent };
