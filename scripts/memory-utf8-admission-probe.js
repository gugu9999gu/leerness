#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

// Real CLI regression: invalid UTF-8 must not pass a memory mutation guard.
// Scope is canonical decisions/lessons; Markdown retention and checked snapshots
// are separate contracts. All test data and captured output belong to this probe.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const { _renderDecisionsMd, _renderLessonsMd, _decisionsFromMd, _parseLessonEntries } = require('../lib/pure-utils');
const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin/leerness.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-memory-utf8-'));
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
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileState = file => {
  const stat = fs.statSync(file, { bigint: true });
  return { sha256: sha(fs.readFileSync(file)), size: String(stat.size), mtimeNs: String(stat.mtimeNs) };
};
const sourceState = () => Object.fromEntries(['bin/leerness.js', 'lib/io.js', 'lib/pure-utils.js',
  'package.json'].map(file => [file, fileState(path.join(root, file))]));
const sourceBefore = sourceState();
let sequence = 0;
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
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
function fixture(surface, payload, bom = false) {
  const project = path.join(temp, `case-${++sequence}`);
  require('../lib/copy-tree').copyTreeSync(seed, project);
  const dir = path.join(project, '.leerness');
  const file = ext => path.join(dir, `${surface}.${ext}`);
  const item = identity => surface === 'decisions'
    ? { date: '2026-01-01', title: identity, decision: identity, reason: null, alternatives: null, impact: null }
    : { date: '2026-01-01', text: identity, tag: null };
  const survivor = { ...item('survivor'), extension: { value: 'BYTE_MARKER', nested: [true, null, 7] } };
  const original = JSON.stringify([survivor, item('selected')]);
  const split = original.split('BYTE_MARKER');
  assert.strictEqual(split.length, 2);
  const bytes = Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0),
    Buffer.from(split[0]), payload, Buffer.from(split[1])]);
  fs.writeFileSync(file('json'), bytes);
  const block = identity => surface === 'decisions'
    ? `### 2026-01-01 — ${identity}\n- Decision: ${identity}\n- Reason: legacy\n`
    : `### 2026-01-01\n- Lesson: ${identity}\n- Tag: legacy\n`;
  const legacyMd = `# ${surface}\n\n${block('legacy')}`;
  let projection = legacyMd;
  try {
    const parsed = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    projection = surface === 'decisions' ? _renderDecisionsMd(parsed) : _renderLessonsMd(parsed);
  } catch {}
  fs.writeFileSync(file('md'), projection);
  fs.writeFileSync(file('archive.md'), `# Archive\n\n## 제거 2026-01-02 (target: "restore-me")\n\n${block('archived')}`);
  const domain = () => Object.fromEntries(fs.readdirSync(dir).filter(name => name.startsWith(`${surface}.`))
    .sort().map(name => [name, fileState(path.join(dir, name))]));
  const load = () => JSON.parse(fs.readFileSync(file('json'), 'utf8').replace(/^\uFEFF/, ''));
  const identity = value => value[surface === 'decisions' ? 'title' : 'text'];
  return { project, file, domain, load, identity, legacyMd };
}
function operations(surface) {
  const singular = surface === 'decisions' ? 'decision' : 'lesson';
  const add = surface === 'decisions' ? 'add' : 'save';
  return [
    { name: 'add/save', args: [singular, add, 'fresh'], expected: ['survivor', 'selected', 'fresh'] },
    { name: 'duplicate no-op', args: [singular, add, 'survivor'], expected: ['survivor', 'selected'], noOp: true },
    { name: 'forced duplicate', args: [singular, add, 'survivor', '--force'], expected: ['survivor', 'selected', 'survivor'] },
    { name: 'drop', args: [singular, 'drop', 'selected'], expected: ['survivor'] },
    { name: 'restore', args: ['memory', 'restore', surface, 'restore-me'], expected: ['survivor', 'selected', 'archived'] },
    { name: 'forced restore', args: ['memory', 'restore', surface, 'restore-me', '--force'], expected: ['survivor', 'selected', 'archived'] },
  ];
}
try {
  fs.mkdirSync(seed);
  success(run(seed, ['init', seed, '--yes', '--language', 'en', '--no-stale-check']));
  const invalid = [
    ['invalid continuation', Buffer.from([0xc3, 0x28])],
    ['lone continuation', Buffer.from([0x80])],
    ['encoded surrogate', Buffer.from([0xed, 0xa0, 0x80])],
  ];
  const valid = [
    ['literal replacement character', '\ufffd', false],
    ['UTF-8 BOM', 'BOM-compatible', true],
    ['Unicode and multiline extension', '보존 🌱\nnext', false],
  ];
  for (const surface of ['decisions', 'lessons']) {
    for (const [encoding, payload] of invalid) {
      for (const operation of operations(surface)) {
        check(`${surface}: ${encoding} rejects ${operation.name} without domain writes`, () => {
          const f = fixture(surface, payload);
          const before = f.domain();
          const result = run(f.project, operation.args);
          // Check preservation even when the old CLI incorrectly reports success.
          const after = f.domain();
          assert(result.status > 0, `invalid UTF-8 accepted (exit ${result.status}); unchanged=${JSON.stringify(before) === JSON.stringify(after)}`);
          assert.strictEqual(JSON.parse(result.stdout).code, 'store_corrupt');
          assert.deepStrictEqual(after, before, 'memory-domain file set, bytes or mtimes changed');
        });
      }
    }
    for (const [encoding, value, bom] of valid) {
      for (const operation of operations(surface)) {
        check(`${surface}: ${encoding} permits ${operation.name} and preserves survivors`, () => {
          // JSON string content, not literal unescaped newlines.
          const payload = Buffer.from(JSON.stringify(value).slice(1, -1));
          const f = fixture(surface, payload, bom);
          const before = f.domain(), survivor = f.load()[0];
          success(run(f.project, operation.args));
          assert.deepStrictEqual(f.load().map(f.identity), operation.expected);
          assert.deepStrictEqual(f.load()[0], survivor);
          if (operation.noOp) assert.deepStrictEqual(f.domain(), before);
        });
      }
    }
    check(`${surface}: absent canonical retains lossless legacy Markdown fallback`, () => {
      const f = fixture(surface, Buffer.from('valid'));
      fs.unlinkSync(f.file('json'));
      const parsed = surface === 'decisions' ? _decisionsFromMd(f.legacyMd) : _parseLessonEntries(f.legacyMd);
      assert.strictEqual(parsed.length, 1);
      fs.writeFileSync(f.file('md'), surface === 'decisions' ? _renderDecisionsMd(parsed) : _renderLessonsMd(parsed));
      success(run(f.project, operations(surface)[0].args));
      assert.deepStrictEqual(f.load().map(f.identity), ['legacy', 'fresh']);
    });
    check(`${surface}: valid UTF-8 does not waive lossy legacy preservation`, () => {
      const f = fixture(surface, Buffer.from('valid'));
      fs.unlinkSync(f.file('json')); fs.writeFileSync(f.file('md'), f.legacyMd);
      const before = f.domain(), result = run(f.project, operations(surface)[0].args);
      assert.strictEqual(result.status, 1);
      assert.strictEqual(JSON.parse(result.stdout).code, 'projection_diverged');
      assert.deepStrictEqual(f.domain(), before);
    });
    check(`${surface}: absent canonical and Markdown permit empty initialization`, () => {
      const f = fixture(surface, Buffer.from('valid'));
      fs.unlinkSync(f.file('json')); fs.unlinkSync(f.file('md'));
      success(run(f.project, operations(surface)[0].args));
      assert.deepStrictEqual(f.load().map(f.identity), ['fresh']);
    });
    check(`${surface}: read-only legacy behavior remains unchanged`, () => {
      const f = fixture(surface, Buffer.from([0xc3, 0x28]));
      const before = f.domain();
      success(run(f.project, [surface === 'decisions' ? 'decision' : 'lesson', 'list']));
      assert.deepStrictEqual(f.domain(), before);
    });
  }
} catch (error) { results.push({ name: 'setup', ok: false, error: error.message }); }
check('source bytes and mtimes unchanged during probe', () => assert.deepStrictEqual(sourceState(), sourceBefore));
const passed = results.filter(result => result.ok).length;
const report = { node: process.version, platform: process.platform, temp, passed, total: results.length,
  cliCalls: executions.length, sourceBefore, sourceAfter: sourceState(), results, executions };
fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`memory UTF-8 admission: ${passed}/${results.length} passed; CLI calls: ${executions.length}; Evidence: ${temp}`);
if (passed !== results.length || results.length !== 81) process.exitCode = 1;
