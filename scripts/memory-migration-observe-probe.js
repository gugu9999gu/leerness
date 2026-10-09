'use strict';
const S = require('./memory-migration-test-support');
const { assert, fs, path, test, project, snapshot, privateMetadata, legacy } = S;
const { inspectMemoryMigration: inspect } = require('../lib/memory-migration-observe');
const checked = require('../lib/memory-input');
const { MAX_BYTES } = require('../lib/store-diagnostic-read');
const { _renderDecisionsMd, _renderLessonsMd } = require('../lib/pure-utils');
function observe(root, surface) {
  const before = snapshot(root), result = inspect(root, surface);
  assert.deepEqual(snapshot(root), before); privateMetadata(result); return result;
}
for (const surface of ['decisions', 'lessons']) {
  for (const [label, content, disposition, ok] of [
    ['absent', null, 'not-applicable', true], ['empty', '', 'not-needed', true],
    ['opaque', S.PRIVATE, 'not-needed', true], ['candidate', legacy(surface), 'candidate-requires-raw-retention', true],
    ['BOM candidate', '\ufeff' + legacy(surface), 'candidate-requires-raw-retention', true],
    ['CRLF', legacy(surface).replace(/\n/g, '\r\n'), 'candidate-requires-raw-retention', true],
    ['invalid UTF8', Buffer.from([0xc3, 0x28]), 'incomplete', false],
    ['at limit', 'x'.repeat(MAX_BYTES), 'not-needed', true],
    ['over limit', 'x'.repeat(MAX_BYTES + 1), 'incomplete', false],
  ]) test(surface + ' ' + label, () => {
    const result = observe(project(content === null ? {} : { [surface + '.md']: content }), surface);
    assert.equal(result.ok, ok); assert.equal(result.assessment.disposition, disposition);
    assert.equal(result.sourceRechecked, label !== 'over limit');
    if (label === 'BOM candidate') assert.equal(result.assessment.inputBytes, Buffer.byteLength(content));
  });
  test(surface + ' generated suffix reused', () => {
    const render = surface === 'decisions' ? _renderDecisionsMd : _renderLessonsMd;
    const result = observe(project({ [surface + '.md']: render([]) + S.PRIVATE }), surface);
    assert.equal(result.assessment.disposition, 'not-needed');
  });
  for (const [label, canonical, state, disposition] of [
    ['array', '[]', 'present', 'not-applicable'], ['unchecked items', '[null,42,{}]', 'present', 'not-applicable'],
    ['BOM array', '\ufeff[]', 'present', 'not-applicable'], ['bad JSON', '{' + S.PRIVATE, 'corrupt', 'blocked'],
    ['object', '{}', 'corrupt', 'blocked'], ['empty JSON', '', 'corrupt', 'blocked'],
    ['bad UTF8', Buffer.from([0xff]), 'corrupt', 'blocked'],
    ['oversize', ' '.repeat(MAX_BYTES + 1), 'unsupported', 'blocked'],
  ]) test(surface + ' canonical ' + label + ' never falls back', () => {
    const result = observe(project({ [surface + '.json']: canonical, [surface + '.md']: legacy(surface) }), surface);
    assert.equal(result.canonical.state, state); assert.equal(result.assessment.disposition, disposition);
    assert.equal(result.legacy.reasonCode, 'not_observed');
  });
  test(surface + ' hardlink rejected', () => {
    const root = project({ [surface + '.md']: legacy(surface) });
    fs.linkSync(path.join(root, '.leerness', surface + '.md'), path.join(root, 'second-link'));
    const result = observe(root, surface); assert.equal(result.ok, false); assert.equal(result.legacy.state, 'unsupported');
  });
  test(surface + ' directory rejected', () => {
    const root = project(); fs.mkdirSync(path.join(root, '.leerness', surface + '.md'));
    const result = observe(root, surface); assert.equal(result.ok, false);
  });
}
test('missing workspace is not positive file absence', () => {
  const root = project(); fs.rmdirSync(path.join(root, '.leerness'));
  const result = observe(root, 'decisions'); assert.equal(result.ok, false);
  assert.equal(result.canonical.state, 'unreadable');
});
test('unsupported runtime does not inspect memory', () => {
  const root = project({ 'decisions.md': legacy('decisions') });
  fs.mkdirSync(path.join(root, '.leerness/cache'));
  fs.writeFileSync(path.join(root, '.leerness/cache/state-layout.json'), '{');
  const result = observe(root, 'decisions'); assert.equal(result.error.code, 'runtime_incompatible');
});
test('invalid input returns static metadata', () => {
  for (const args of [[null, 'decisions'], ['', 'lessons'], [S.arena, '../decisions'], [S.arena, {}]]) {
    const result = inspect(...args); privateMetadata(result); assert.equal(result.ok, false);
  }
});
test('bounded checked snapshot remains private and recheck retains its budget', () => {
  const root = project({ 'decisions.md': 'abc' }), file = path.join(root, '.leerness/decisions.md');
  const input = checked.captureCheckedFileInput(file, { maxBytes: 3 }); input.bytes.fill(0);
  checked.assertCheckedFileCurrent(input, file);
  fs.appendFileSync(file, 'd'); assert.throws(() => checked.assertCheckedFileCurrent(input, file), { code: 'E_STORE_LIMIT' });
});
test('diagnostic limit refuses before open; writer remains compatible', () => {
  const root = project({ 'decisions.md': 'x'.repeat(MAX_BYTES + 1) }), file = path.join(root, '.leerness/decisions.md');
  const open = fs.openSync; let opens = 0;
  fs.openSync = (...args) => { opens++; return open(...args); };
  try { assert.throws(() => checked.captureCheckedFileInput(file, { maxBytes: MAX_BYTES }), { code: 'E_STORE_LIMIT' }); }
  finally { fs.openSync = open; }
  assert.equal(opens, 0); assert.equal(checked.captureCheckedFileInput(file).bytes.length, MAX_BYTES + 1);
});
S.finish('memory migration observation');
