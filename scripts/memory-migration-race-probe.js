'use strict';
const S = require('./memory-migration-test-support');
const { assert, fs, path, test, project, privateMetadata, legacy } = S;
const domain = require('../lib/memory-migration-plan');
const observerPath = require.resolve('../lib/memory-migration-observe');
const checked = require('../lib/memory-input');
const { readMemoryInputBytes } = require('../lib/memory-input-bytes');
function duringAssessment(root, change) {
  const original = domain.assessLegacyMemoryMigration;
  let called = 0;
  domain.assessLegacyMemoryMigration = text => { const result = original(text); change(); called++; return result; };
  delete require.cache[observerPath];
  try {
    const result = require(observerPath).inspectMemoryMigration(root, 'decisions');
    assert.equal(called, 1); privateMetadata(result); assert.equal(result.ok, false);
    assert.equal(result.sourceRechecked, false); assert.equal(result.assessment, null);
    return result;
  } finally { domain.assessLegacyMemoryMigration = original; delete require.cache[observerPath]; }
}
for (const [label, change] of [
  ['canonical appears', (dir) => fs.writeFileSync(path.join(dir, 'decisions.json'), '[]')],
  ['legacy edits', (dir) => fs.appendFileSync(path.join(dir, 'decisions.md'), '\nexternal')],
  ['legacy disappears', (dir) => fs.unlinkSync(path.join(dir, 'decisions.md'))],
  ['same bytes replacement', (dir) => {
    const file = path.join(dir, 'decisions.md'), bytes = fs.readFileSync(file);
    fs.renameSync(file, file + '.old'); fs.writeFileSync(file, bytes);
  }],
  ['hardlink added', (dir) => fs.linkSync(path.join(dir, 'decisions.md'), path.join(path.dirname(dir), 'link'))],
  ['runtime changes', (dir) => { fs.mkdirSync(path.join(dir, 'cache')); fs.writeFileSync(path.join(dir, 'cache/state-layout.json'), '{}'); }],
  ['ownership changes', (dir) => fs.writeFileSync(path.join(dir, 'foreign-owned-file'), 'foreign')],
  ['workspace replaced by junction to same original', (dir) => { fs.renameSync(dir, dir + '-moved'); fs.symlinkSync(dir + '-moved', dir, 'junction'); }],
]) test('reject ' + label + ' after assessment', () => {
  const root = project({ 'decisions.md': legacy('decisions') });
  duringAssessment(root, () => change(path.join(root, '.leerness')));
});
test('absent legacy appears after assessment', () => {
  const root = project(); duringAssessment(root, () => fs.writeFileSync(path.join(root, '.leerness/decisions.md'), legacy('decisions')));
});
test('canonical valid bytes change after assessment', () => {
  const root = project({ 'decisions.json': '[]' });
  duringAssessment(root, () => fs.writeFileSync(path.join(root, '.leerness/decisions.json'), '[{}]'));
});
test('source change during final runtime check is rechecked afterward', () => {
  const runtime = require('../lib/runtime-layout'), original = runtime.createRuntimeCompatibilityReader;
  const root = project({ 'decisions.md': legacy('decisions') });
  let creates = 0;
  runtime.createRuntimeCompatibilityReader = (...args) => {
    const reader = original(...args);
    if (++creates === 2) fs.appendFileSync(path.join(root, '.leerness/decisions.md'), '\nexternal');
    return reader;
  };
  delete require.cache[observerPath];
  try {
    const result = require(observerPath).inspectMemoryMigration(root, 'decisions');
    assert.equal(creates, 2); assert.equal(result.ok, false); assert.equal(result.error.code, 'source_recheck_failed');
  } finally { runtime.createRuntimeCompatibilityReader = original; delete require.cache[observerPath]; }
});
test('lexical ancestor rebound is rejected by shared checked input', () => {
  const root = project({ 'decisions.md': 'same bytes' }), file = path.join(root, '.leerness/decisions.md');
  const input = checked.captureCheckedFileInput(file, { maxBytes: 100 });
  fs.renameSync(root, root + '-moved'); fs.symlinkSync(root + '-moved', root, 'junction');
  assert.throws(() => checked.assertCheckedFileCurrent(input, file), { code: 'E_STORE_CHANGED' });
});
test('stable pre-existing lexical alias remains usable', () => {
  const root = project({ 'decisions.md': legacy('decisions') }), alias = root + '-alias';
  fs.symlinkSync(root, alias, 'junction');
  const result = require(observerPath).inspectMemoryMigration(alias, 'decisions');
  privateMetadata(result); assert.equal(result.ok, true); assert.equal(result.sourceRechecked, true);
});
test('continuous descriptor read stops at budget plus one', () => {
  const original = fs.readSync; let requested = 0;
  fs.readSync = (fd, buffer, offset, length) => { requested += length; buffer.fill(32, offset, offset + length); return length; };
  try { assert.throws(() => readMemoryInputBytes(123, 20, 'fixture', 1n), { code: 'E_STORE_LIMIT', bytesRead: 21 }); }
  finally { fs.readSync = original; }
  assert.equal(requested, 21);
});
for (const operation of ['openSync', 'readSync', 'closeSync']) test(operation + ' error remains unreadable', () => {
  const root = project({ 'decisions.md': legacy('decisions') }), original = fs[operation];
  fs[operation] = (...args) => {
    if (operation === 'closeSync') original(...args);
    throw Object.assign(new Error(S.PRIVATE), { code: 'EACCES' });
  };
  try { assert.throws(() => checked.captureCheckedFileInput(path.join(root, '.leerness/decisions.md'), { maxBytes: 1024 }), { code: 'E_STORE_UNREADABLE' }); }
  finally { fs[operation] = original; }
});
S.finish('memory migration races');
