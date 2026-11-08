'use strict';
require('./temp-cleanup').trackTemp(module);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const { createHash } = require('crypto');
const { inspectStorePairs } = require('../lib/store-pair-inspect');
const { _renderDecisionsMd, _renderLessonsMd, _renderTeamsMd } = require('../lib/pure-utils');
const { REQUIRED_WORKSPACE_FILES } = require('../lib/catalogs');
const { ownTree, removeOwnedTree } = require('./temp-cleanup');
const cli = path.resolve(__dirname, '../bin/leerness.js');
const entries = {
  decisions: [{ date: '2026-11-03', title: 'Exact decision', decision: 'SYNTHETIC_PRIVATE_VALUE', reason: '한글 e\u0301' }],
  lessons: [{ date: '2026-11-03', text: 'SYNTHETIC_PRIVATE_VALUE', tag: '한글 e\u0301' }],
  teams: [{ id: 'example', name: 'SYNTHETIC_PRIVATE_VALUE', members: [], personas: [] }],
};
const render = (name, data = entries[name], language = 'en') => name === 'decisions' ? _renderDecisionsMd(data, language) : name === 'lessons' ? _renderLessonsMd(data, language) : _renderTeamsMd(data);
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-pair-probe-'));
  const owned = ownTree(root);
  fs.mkdirSync(path.join(root, '.leerness'));
  const file = name => path.join(root, '.leerness', name);
  const write = (name, value) => fs.writeFileSync(file(name), value);
  const seed = (name, language = 'en') => { write(name + '.json', JSON.stringify(entries[name]));write(name + '.md', render(name, entries[name], language)); };
  const snapshot = () => fs.readdirSync(file('')).sort().map(name => {
    const p = file(name), st = fs.lstatSync(p, { bigint: true });
    return [name, String(st.mtimeNs), String(st.ino), st.isFile() ? createHash('sha256').update(fs.readFileSync(p)).digest('hex') : null];
  });
  try { fn({ root, file, write, seed, snapshot }); }
  finally { removeOwnedTree(owned); }
}
const row = (root, name) => inspectStorePairs(root).stores.find(value => value.name === name);

test('missing stores are optional and observation performs no persistent writes', () => fixture(({ root, snapshot }) => {
  const before = snapshot(), report = inspectStorePairs(root);
  assert(report.ok);assert(report.readOnly);assert.equal(report.writesPerformed, false);assert.equal(report.atomicObservation, false);
  assert(report.stores.every(item => item.status === 'missing'));
  assert.deepEqual(snapshot(), before);
}));
for (const language of ['ko', 'en']) test('healthy pairs preserve all source bytes: ' + language, () => fixture(({ root, seed, snapshot }) => {
  for (const name of Object.keys(entries)) seed(name, language);
  const before = snapshot(), report = inspectStorePairs(root, language);
  assert(report.ok);assert(report.stores.every(item => item.status === 'consistent'));
  assert(!JSON.stringify(report).includes('SYNTHETIC_PRIVATE_VALUE'));
  assert(!JSON.stringify(report).includes(root));assert.deepEqual(snapshot(), before);
}));
for (const name of Object.keys(entries)) test(name + ': a split pair is not healthy and gets a preservation-first next step', () => fixture(({ root, seed, write, snapshot }) => {
  seed(name);write(name + '.md', render(name, []));
  const before = snapshot(), observed = row(root, name);
  assert.equal(observed.ok, false);assert.equal(observed.status, 'diverged');
  assert.equal(observed.code, name === 'teams' ? 'E_TEAM_PROJECTION_EDITED' : 'E_PROJECTION_DIVERGED');
  assert.match(observed.nextStep, /preserve both files/);assert.deepEqual(snapshot(), before);
}));
test('memory suffix notes are accepted and never rewritten', () => fixture(({ root, seed, file, snapshot }) => {
  for (const name of ['decisions', 'lessons']) { seed(name);fs.appendFileSync(file(name + '.md'), '\n## Authored notes\nKeep these exact bytes.\n'); }
  const before = snapshot();assert(inspectStorePairs(root).ok);assert.deepEqual(snapshot(), before);
}));
test('legacy empty prose and missing regenerable projections are distinguished', () => fixture(({ root, write }) => {
  write('decisions.md', '# Personal source\nNo parseable entries yet.\n');
  write('lessons.json', JSON.stringify(entries.lessons));
  assert.equal(row(root, 'decisions').status, 'legacy');
  assert.equal(row(root, 'lessons').status, 'rebuildable');
}));
test('readable authored legacy entries are not treated as a split canonical pair', () => fixture(({ root, write, snapshot }) => {
  write('decisions.md', '# Personal decisions\n### 2026-11-03 — Preserve source\n- Decision: authored choice\n- Reason: legacy prose\n');
  write('lessons.md', '# Personal lessons\n### 2026-11-03\n- Lesson: authored observation\n- Tag: legacy\n');
  const before = snapshot(), report = inspectStorePairs(root);
  assert(report.ok);assert.equal(row(root, 'decisions').status, 'legacy');assert.equal(row(root, 'lessons').status, 'legacy');
  assert.deepEqual(snapshot(), before);
}));
test('team BOM and CRLF follow the existing writer comparison', () => fixture(({ root, seed, file, write }) => {
  seed('teams');
  for (const name of ['teams.json', 'teams.md']) write(name, '\uFEFF' + fs.readFileSync(file(name), 'utf8').replace(/\n/g, '\r\n'));
  assert.equal(row(root, 'teams').status, 'consistent');
}));
test('corrupt canonical JSON is not rescued by apparently valid Markdown', () => fixture(({ root, seed, write }) => {
  seed('decisions');write('decisions.json', '{broken');
  const result = row(root, 'decisions');assert.equal(result.ok, false);assert.equal(result.status, 'invalid');
}));
test('unsupported memory items and malformed team shapes are not healthy', () => fixture(({ root, seed, write }) => {
  seed('lessons');write('lessons.json', '[{"text":42}]');write('teams.json', '{}');
  assert.equal(row(root, 'lessons').code, 'E_STORE_ITEM_UNSUPPORTED');
  assert.equal(row(root, 'teams').code, 'store_invalid');
}));
test('invalid UTF-8 is reported without replacement or mutation', () => fixture(({ root, seed, write, snapshot }) => {
  seed('decisions');write('decisions.md', Buffer.from([0xff]));
  const before = snapshot();assert.equal(row(root, 'decisions').ok, false);assert.deepEqual(snapshot(), before);
}));
test('oversized sources fail bounded inspection instead of parsing partial data', () => fixture(({ root, write }) => {
  write('lessons.json', ' '.repeat(4 * 1024 * 1024 + 1));
  const result = row(root, 'lessons');assert.equal(result.ok, false);assert.equal(result.status, 'unknown');assert.equal(result.code, 'E_STORE_LIMIT');
}));
test('hard-linked source files are refused', () => fixture(({ root, seed, file }) => {
  seed('decisions');fs.linkSync(file('decisions.json'), file('alias.json'));
  assert.equal(row(root, 'decisions').ok, false);
}));
test('a canonical change during observation reports unknown rather than consistency', () => fixture(({ root, seed, file, write }) => {
  seed('decisions');const target = file('decisions.json'), original = fs.lstatSync;let calls = 0;
  fs.lstatSync = function(p, ...args) {
    if (p === target && ++calls === 2) write('decisions.json', '[{"title":"changed while reading"}]');
    return original.call(fs, p, ...args);
  };
  try { const result = row(root, 'decisions');assert.equal(result.ok, false);assert.equal(result.status, 'unknown');assert.equal(result.code, 'E_STORE_CHANGED'); }
  finally { fs.lstatSync = original; }
}));
for (const name of Object.keys(entries)) test('real verify CLI rejects a split ' + name + ' pair and preserves original files', () => fixture(({ root, seed, write, file }) => {
  for (const item of REQUIRED_WORKSPACE_FILES) fs.writeFileSync(path.join(root, item), 'plan.md progress-tracker.md protected-files.md anti-lazy-work-policy.md\n');
  write('HARNESS_VERSION', require('../package.json').version);write('LANGUAGE', 'en');
  seed(name);write(name + '.md', render(name, []));
  const before = [name + '.json', name + '.md'].map(x => fs.readFileSync(file(x)));
  const env = { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_INTERNAL: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_LANG: 'en' };
  const result = cp.spawnSync(process.execPath, [cli, 'verify', root, '--json', '--language', 'en'], { encoding: 'utf8', env, timeout: 30000, windowsHide: true });
  assert.ifError(result.error);assert.equal(result.status, 1, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);assert.equal(report.ok, false);assert.equal(report.healthy, false);
  assert.equal(report.storePairs.stores.find(x => x.name === name).status, 'diverged');
  assert.match(report.failures.join('\n'), /preserve both files/);
  assert(!result.stdout.includes('SYNTHETIC_PRIVATE_VALUE'));
  [name + '.json', name + '.md'].forEach((x, i) => assert(fs.readFileSync(file(x)).equals(before[i])));
}));
