#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

// Real CLI tests for canonical-value preservation during legacy archive restore.
// Raw JSON bytes, manual Markdown, and already-lossy archived fields are separate contracts.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const { _renderDecisionsMd, _renderLessonsMd } = require('../lib/pure-utils');
const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin/leerness.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-restore-canonical-'));
const seed = path.join(temp, 'seed');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC)$/i.test(key)));
for (const key of ['TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
  env[key] = path.join(temp, key.toLowerCase());
  fs.mkdirSync(env[key], { recursive: true });
}
Object.assign(env, { LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_BANNER: '1',
  LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1' });
const results = [], executions = [];
let sequence = 0;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fileState = file => {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file, { bigint: true });
  return { sha256: sha(fs.readFileSync(file)), size: String(stat.size), mtimeNs: String(stat.mtimeNs) };
};
const sourceFiles = ['bin/leerness.js', 'lib/pure-utils.js', 'package.json'];
const sourceState = () => Object.fromEntries(sourceFiles.map(f => [f, fileState(path.join(root, f))]));
const sourceBefore = sourceState();
function run(project, args) {
  const started = Date.now();
  const result = cp.spawnSync(process.execPath, [cli, ...args, '--path', project, '--json'], {
    cwd: project, env, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024,
  });
  executions.push({ project, args, status: result.status, signal: result.signal,
    error: result.error?.code || null, durationMs: Date.now() - started,
    stdout: String(result.stdout || '').slice(0, 2000), stderr: String(result.stderr || '').slice(0, 1000) });
  assert.strictEqual(result.error, undefined, `child error: ${result.error?.code}`);
  assert.strictEqual(result.signal, null);
  return result;
}
function success(result) {
  assert.strictEqual(result.status, 0, String(result.stdout || result.stderr || '').slice(-700));
}
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
function fixture(surface) {
  const project = path.join(temp, `case-${++sequence}`);
  require('../lib/copy-tree').copyTreeSync(seed, project);
  const file = ext => path.join(project, '.leerness', `${surface}.${ext}`);
  const identity = surface === 'decisions' ? 'title' : 'text';
  const item = (value, extra = {}) => surface === 'decisions'
    ? { date: '2026-01-01', title: value, decision: 'decision\nretained', reason: 'reason\nretained', alternatives: null, impact: null, ...extra }
    : { date: '2026-01-01', text: value, tag: 'tag\nretained', ...extra };
  const body = value => surface === 'decisions'
    ? `### 2026-01-02 — ${value}\n- Decision: restored\n- Reason: archived\n`
    : `### 2026-01-02\n- Lesson: ${value}\n- Tag: archived\n`;
  const render = entries => surface === 'decisions' ? _renderDecisionsMd(entries) : _renderLessonsMd(entries);
  const block = (value, target = 'selected') => `## 제거 2026-01-03 (target: "${target}")\n\n${body(value)}`;
  const write = (ext, value) => fs.writeFileSync(file(ext), value);
  write('archive.md', `# Archive\n\n${block('archived')}`);
  const initial = [item('survivor', { extension: { nested: [1, null, { text: 'private\nfield' }] } })];
  write('json', JSON.stringify(initial));
  write('md', render(initial));
  const domain = () => Object.fromEntries(['json', 'md', 'archive.md'].map(ext => [ext, fileState(file(ext))]));
  const load = () => JSON.parse(fs.readFileSync(file('json'), 'utf8'));
  const restore = (...flags) => run(project, ['memory', 'restore', surface, 'selected', ...flags]);
  const reject = (args = ['memory', 'restore', surface, 'selected'], code = null) => {
    const before = domain();
    const result = run(project, args);
    assert(result.status > 0, `expected rejection: ${result.status}`);
    if (code) assert.strictEqual(JSON.parse(result.stdout).code, code);
    assert.deepStrictEqual(domain(), before, 'rejection changed a memory domain file');
  };
  return { project, file, identity, item, body, render, block, write, domain, load, restore, reject };
}
try {
  fs.mkdirSync(seed);
  success(run(seed, ['init', seed, '--yes', '--language', 'en', '--no-stale-check']));
  for (const surface of ['decisions', 'lessons']) {
    const test = (name, fn) => check(`${surface}: ${name}`, () => fn(fixture(surface)));
    test('survivor unknown fields, multiline values and order are unchanged', f => {
      const before = [...f.load(), f.item('second\nline', { extra: [false, { keep: true }] })];
      f.write('json', JSON.stringify(before));
      f.write('md', f.render(before));
      success(f.restore());
      assert.deepStrictEqual(f.load().slice(0, before.length), before);
      assert.strictEqual(f.load().length, before.length + 1);
      assert.strictEqual(f.load().at(-1)[f.identity], 'archived');
    });
    test('canonical survives missing Markdown projection', f => {
      const before = f.load();
      fs.unlinkSync(f.file('md'));
      success(f.restore());
      assert.deepStrictEqual(f.load().slice(0, before.length), before);
      assert.strictEqual(f.load().length, 2);
    });
    test('stale Markdown projection is rejected instead of overwriting canonical survivors', f => {
      f.write('md', '# Stale\n\n' + f.body('phantom'));
      f.reject(undefined, 'projection_diverged');
    });
    test('authoritative empty array restores archive with synchronized empty projection', f => {
      f.write('json', '[]');
      f.write('md', f.render([]));
      success(f.restore());
      assert.deepStrictEqual(f.load().map(i => i[f.identity]), ['archived']);
    });
    test('stale projection duplicate is rejected without domain writes', f => {
      f.write('md', '# Stale\n\n' + f.body('archived'));
      f.reject(undefined, 'projection_diverged');
    });
    test('canonical duplicate hidden by stale projection is rejected', f => {
      f.write('json', JSON.stringify([f.item('archived')]));
      f.reject(undefined, 'restore_conflict');
    });
    test('canonical duplicate with no projection is rejected', f => {
      f.write('json', JSON.stringify([f.item('archived')]));
      fs.unlinkSync(f.file('md'));
      f.reject(undefined, 'restore_conflict');
    });
    test('duplicate normalization follows the existing projection identity', f => {
      f.write('json', JSON.stringify([f.item('archived\nvalue')]));
      f.write('archive.md', '# Archive\n\n' + f.block('archived value'));
      f.reject(undefined, 'restore_conflict');
    });
    test('force preserves existing payload and permits an explicit duplicate', f => {
      const before = [f.item('archived', { extension: { retained: true } })];
      f.write('json', JSON.stringify(before));
      f.write('md', f.render(before));
      success(f.restore('--force'));
      assert.deepStrictEqual(f.load()[0], before[0]);
      assert.strictEqual(f.load().length, 2);
    });
    test('positive canonical absence retains legacy fallback', f => {
      fs.unlinkSync(f.file('json'));
      success(f.restore());
      assert.deepStrictEqual(f.load().map(i => i[f.identity]), ['survivor', 'archived']);
    });
    test('both absent active files initialize from selected archive', f => {
      fs.unlinkSync(f.file('json')); fs.unlinkSync(f.file('md'));
      success(f.restore());
      assert.deepStrictEqual(f.load().map(i => i[f.identity]), ['archived']);
    });
    test('legacy duplicate remains rejected', f => {
      fs.unlinkSync(f.file('json')); f.write('md', '# Legacy\n\n' + f.body('archived'));
      f.reject(undefined, 'restore_conflict');
    });
    test('corrupt canonical refuses force without writes', f => {
      f.write('json', '{'); f.reject(['memory', 'restore', surface, 'selected', '--force'], 'store_corrupt');
    });
    test('non-array canonical refuses force without writes', f => {
      f.write('json', '{"retained":true}'); f.reject(['memory', 'restore', surface, 'selected', '--force'], 'store_invalid');
    });
    test('unmatched selection leaves all memory files unchanged', f => {
      f.reject(['memory', 'restore', surface, 'not-found']);
    });
    test('invalid UTF-8 archive is rejected unchanged', f => {
      f.write('archive.md', Buffer.from([0xc3, 0x28])); f.reject(undefined, 'archive_corrupt');
    });
    test('valid replacement character is not an encoding error', f => {
      f.write('archive.md', '# Archive\n\n' + f.block('legitimate \ufffd value'));
      success(f.restore()); assert.strictEqual(f.load().at(-1)[f.identity], 'legitimate \ufffd value');
    });
    test('unrenderable survivor refuses restore before any domain write', f => {
      const survivor = f.item('survivor');
      survivor[surface === 'decisions' ? 'reason' : 'tag'] = { toString: null, valueOf: null };
      f.write('json', JSON.stringify([survivor])); f.reject();
    });
    test('null survivor refuses force before any domain write', f => {
      f.write('json', '[null]'); f.reject(['memory', 'restore', surface, 'selected', '--force']);
    });
    test('unparseable selected archive block is not consumed as success', f => {
      f.write('archive.md', '# Archive\n\n## 제거 2026-01-03 (target: "selected")\n\nnot a record\n');
      f.reject(undefined, 'archive_entry_invalid');
    });
    test('mixed selected valid and invalid blocks reject before writes', f => {
      f.write('archive.md', '# Archive\n\n' + f.block('archived') + '\n## 제거 2026-01-03 (target: "selected")\n\nnot a record\n');
      f.reject(undefined, 'archive_entry_invalid');
    });
    test('empty selected archive is rejected unchanged', f => {
      f.write('archive.md', '# Archive\n\n## 제거 2026-01-03 (target: "selected")\n\n \t\n');
      f.reject(undefined, 'archive_entry_invalid');
    });
    test('empty selection before a valid block rejects the whole restore', f => {
      f.write('archive.md', '# Archive\n\n## 제거 2026-01-03 (target: "selected")\n\n \t\n\n' + f.block('archived'));
      f.reject(undefined, 'archive_entry_invalid');
    });
    test('empty selection after a valid block rejects the whole restore', f => {
      f.write('archive.md', '# Archive\n\n' + f.block('archived') + '\n## 제거 2026-01-03 (target: "selected")\n\n \t\n');
      f.reject(undefined, 'archive_entry_invalid');
    });
    test('force never permits consuming an empty selected block', f => {
      f.write('archive.md', '# Archive\n\n' + f.block('archived') + '\n## 제거 2026-01-03 (target: "selected")\n\n \t\n');
      f.reject(['memory', 'restore', surface, 'selected', '--force'], 'archive_entry_invalid');
    });
    test('date selection also rejects a selected empty block', f => {
      f.write('archive.md', '# Archive\n\n' + f.block('archived') + '\n## 제거 2026-01-03 (target: "different-target")\n\n \t\n');
      f.reject(['memory', 'restore', surface, '2026-01-03'], 'archive_entry_invalid');
    });
    test('an unselected empty archive block remains byte-identical', f => {
      const kept = '## 제거 2026-01-04 (target: "other-target")\n\n \t\n';
      f.write('archive.md', '# Archive\n\n' + f.block('archived') + '\n' + kept);
      success(f.restore());
      assert.strictEqual(f.load().at(-1)[f.identity], 'archived');
      assert(fs.readFileSync(f.file('archive.md'), 'utf8').includes(kept));
    });
    // Integration controls: canonical admission and selected-archive validation
    // retain their order and preservation guarantees when both apply.
    for (const forced of [false, true]) {
      const mode = forced ? 'forced' : 'normal';
      const restoreArgs = ['memory', 'restore', surface, 'selected', ...(forced ? ['--force'] : [])];
      const mixedArchive = f => ['# Archive', '', f.block('archived'),
        '## 제거 2026-01-03 (target: "selected")', '', ' ', ''].join(String.fromCharCode(10));
      test(`${mode} mixed empty archive with BOM canonical is rejected unchanged`, f => {
        f.write('json', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(f.load()))]));
        f.write('archive.md', mixedArchive(f));
        f.reject(restoreArgs, 'archive_entry_invalid');
      });
      test(`${mode} malformed canonical takes precedence over mixed empty archive`, f => {
        const bytes = Buffer.from(JSON.stringify(f.load()));
        const marker = Buffer.from('survivor');
        const at = bytes.indexOf(marker);
        assert(at >= 0);
        f.write('json', Buffer.concat([bytes.subarray(0, at), Buffer.from([0xc3, 0x28]), bytes.subarray(at + marker.length)]));
        f.write('archive.md', mixedArchive(f));
        f.reject(restoreArgs, 'store_corrupt');
      });
    }
    test('same-batch duplicate behavior is unchanged', f => {
      f.write('archive.md', '# Archive\n\n' + f.block('archived') + '\n' + f.block('archived'));
      success(f.restore());
      assert.strictEqual(f.load().filter(i => i[f.identity] === 'archived').length, 2);
    });
    test('unselected archive block stays available', f => {
      const kept = f.block('later', 'other-target');
      f.write('archive.md', '# Archive\n\n' + f.block('archived') + '\n' + kept);
      success(f.restore());
      const remaining = fs.readFileSync(f.file('archive.md'), 'utf8');
      assert(remaining.includes(kept)); assert(!remaining.includes('target: "selected"'));
    });
    test('singular alias reaches the same preserving restore', f => {
      const before = f.load();
      success(run(f.project, ['memory', 'restore', surface === 'decisions' ? 'decision' : 'lesson', 'selected']));
      assert.deepStrictEqual(f.load()[0], before[0]);
    });
  }
} catch (error) { results.push({ name: 'setup', ok: false, error: error.message }); }
check('product source bytes and mtimes unchanged during probe', () => assert.deepStrictEqual(sourceState(), sourceBefore));
const passed = results.filter(r => r.ok).length;
const report = { node: process.version, platform: process.platform, temp, passed, total: results.length,
  cliCalls: executions.length, sourceBefore, sourceAfter: sourceState(), results, executions };
fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`memory restore canonical: ${passed}/${results.length} passed; CLI calls: ${executions.length}; Evidence: ${temp}`);
if (passed !== results.length || results.length !== 69) process.exitCode = 1;
