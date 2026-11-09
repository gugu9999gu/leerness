'use strict';
const path = require('path');
const { captureMemoryInput, assertMemoryInputCurrent, captureCheckedFileInput, assertCheckedFileCurrent } = require('./memory-input');
const { prepareMemoryProjection, assertMemoryProjectionCurrent } = require('./memory-projection');
const { assertMemoryItems } = require('./memory-items');
const { decodeText, MAX_TEXT_BYTES } = require('./managed-text');
const { parseTeams } = require('./teams-text');
const { _decisionsFromMd, _parseLessonEntries, _renderTeamsMd } = require('./pure-utils');
const options = { maxBytes: MAX_TEXT_BYTES };
const invalidCodes = new Set(['E_STORE_CORRUPT', 'E_STORE_INVALID', 'E_STORE_ITEM_UNSUPPORTED', 'E_PROJECTION_CORRUPT', 'E_TEXT_ENCODING', 'store_invalid']);
const divergentCodes = new Set(['E_PROJECTION_DIVERGED', 'E_TEAM_PROJECTION_EDITED']);

function inspectMemory(name, canonical, projection) {
  const parser = name === 'decisions' ? _decisionsFromMd : _parseLessonEntries;
  const input = captureMemoryInput(canonical, projection, parser, options);
  assertMemoryItems(name, input.entries);
  if (input.source === 'legacy') {
    assertMemoryInputCurrent(input, canonical, projection);
    return { source: 'legacy', status: 'legacy' };
  }
  const prepared = prepareMemoryProjection(name, input, projection, input.entries, options);
  assertMemoryInputCurrent(input, canonical, projection);
  assertMemoryProjectionCurrent(prepared, projection);
  return { source: input.source, status: input.source === 'empty' ? 'missing'
    : input.source === 'legacy' ? 'legacy' : prepared.snapshot && !prepared.snapshot.exists ? 'rebuildable' : 'consistent' };
}
function inspectTeams(canonical, projection) {
  const input = captureCheckedFileInput(canonical, options);
  const output = captureCheckedFileInput(projection, options);
  const teams = input.exists ? parseTeams(decodeText(input.bytes, canonical)) : [];
  const divergent = output.exists && decodeText(output.bytes, projection).replace(/\r\n/g, '\n') !== _renderTeamsMd(teams).replace(/\r\n/g, '\n');
  assertCheckedFileCurrent(input, canonical);
  assertCheckedFileCurrent(output, projection);
  if (divergent) throw Object.assign(new Error('Team projection differs from its canonical store.'), { code: 'E_TEAM_PROJECTION_EDITED' });
  return { source: input.exists ? 'canonical' : 'empty', status: input.exists ? output.exists ? 'consistent' : 'rebuildable' : output.exists ? 'consistent' : 'missing' };
}
function inspectStorePairs(root, language = 'en') {
  const rows = ['decisions', 'lessons', 'teams'].map(name => {
    const canonical = path.resolve(root, '.leerness', name + '.json');
    const projection = path.resolve(root, '.leerness', name + '.md');
    const row = { name, canonical: '.leerness/' + name + '.json', projection: '.leerness/' + name + '.md', ok: false, status: 'unknown', source: 'unknown', code: null, nextStep: null };
    try {
      Object.assign(row, name === 'teams' ? inspectTeams(canonical, projection) : inspectMemory(name, canonical, projection), { ok: true });
    } catch (error) {
      row.code = typeof error.code === 'string' && /^[A-Za-z0-9_]+$/.test(error.code) ? error.code : 'E_STORE_PAIR_UNAVAILABLE';
      row.status = divergentCodes.has(row.code) ? 'diverged' : invalidCodes.has(row.code) ? 'invalid' : 'unknown';
      row.nextStep = language === 'ko'
        ? '진행 중인 쓰기가 끝난 뒤 다시 확인하세요. 문제가 지속되면 두 파일과 archive/mutation-recovery 원본을 별도로 보존하고 JSON과 작성 메모를 대조하세요. 자동 삭제·덮어쓰기는 하지 않습니다.'
        : 'Recheck after active writers stop. If this persists, preserve both files and archive/mutation-recovery separately, then reconcile the JSON and authored notes. No automatic deletion or overwrite is performed.';
    }
    return row;
  });
  return { schema: 'leerness.store-pairs/v1', ok: rows.every(row => row.ok), readOnly: true, writesPerformed: false,
    atomicObservation: false, maxBytesPerFile: MAX_TEXT_BYTES, stores: rows };
}
module.exports = { inspectStorePairs };
