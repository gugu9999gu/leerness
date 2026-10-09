'use strict';
const S = require('./memory-migration-test-support');
const { inspectMemoryWriteBudget } = require('../lib/memory-write-budget');
const { _renderDecisionsMd, _renderLessonsMd } = require('../lib/pure-utils');
const arrayLimits = { maxInputBytes: 32768, maxItems: 100, maxItemBytes: 16384,
  maxCanonicalBytes: 32768, maxProjectionBytes: 32768, maxDepth: 16, maxNodes: 10000 };
const limits = { observation: { maxFileBytes: 32768, maxTotalFileBytes: 98304,
  maxRecoveryEntries: 100, maxRecoveryDepth: 8, maxRecoveryBytes: 10000 },
source: { ...arrayLimits }, candidate: { ...arrayLimits }, operation: { maxArchiveInputBytes: 32768,
  maxArchiveBytes: 65536, maxProjectionBytes: 65536, maxFinalPathBytes: 200000, maxNormalPeakPathBytes: 300000 } };
const render = (s, rows) => s === 'decisions' ? _renderDecisionsMd(rows) : _renderLessonsMd(rows);
const row = (s, value = S.PRIVATE) => s === 'decisions'
  ? { date: '2026-09-01', title: value, decision: value, reason: null, alternatives: null, impact: null }
  : { date: '2026-09-01', text: value, tag: null };
const fixture = (s = 'decisions', rows = [row(s)], suffix = '\nPRIVATE 한🙂\r\n', extra = {}) => S.project({
  HARNESS_VERSION: require('../package.json').version, [s + '.json']: JSON.stringify(rows,null,2) + '\n',
  [s + '.md']: render(s,rows) + suffix, [s + '.archive.md']: 'PRIVATE archive\r\n', ...extra });
const options = (over = {}) => Object.fromEntries(Object.entries(limits).map(([key, value]) => [key,{ ...value,...over[key] }]));
const inspect = (p, s = 'decisions', rows = [], operation = { kind: 'update', archiveText: null }, over = {}) =>
  inspectMemoryWriteBudget(p,s,typeof rows === 'string' ? rows : JSON.stringify(rows),JSON.stringify(operation),JSON.stringify(options(over)));
function metadata(result) {
  const text = JSON.stringify(result);
  S.assert(!text.includes('PRIVATE') && !text.includes(S.arena) && !text.includes('.leerness'));
  S.assert(text.length < 6500);
  for (const key of ['candidateRelationVerified','archiveRecordsValidated','atomicObservation','approvalGranted','writesPerformed','reservationGranted']) S.assert.equal(result[key],false,key);
  S.assert.equal(result.recoveryPeakBytes,null); S.assert.equal(result.physicalBytes,null);
}
function failed(result, code, phase) {
  metadata(result); S.assert.equal(result.ok,false);
  S.assert.equal(result.measurement,null); S.assert.equal(result.filesRechecked,false);
  S.assert.equal(result.sourceContentValidated,false); S.assert.equal(result.recoveryMetadataRechecked,false);
  if (code) S.assert.equal(result.error.code,code);
  if (phase) S.assert.equal(result.error.phase,phase);
}
module.exports = { ...S, limits, options, render, row, fixture, inspect, metadata, failed, inspectMemoryWriteBudget };
