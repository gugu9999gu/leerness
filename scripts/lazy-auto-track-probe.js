'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
// T-0345: `lazy detect --auto-track` registers a task for each new TODO whose file no tracker row references, and
// only those. A batch that mixed such files with a file a task already referenced registered every new TODO, so the
// TODOs in the referenced file got tasks of their own as well. known-todos.json gains exactly the registered TODOs.
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const ENV = { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_LOCK_WARN: '1', LEERNESS_NO_AUTOCHCP: '1' };
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lazy-auto-track-'));
let passed = 0, failed = 0, seq = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error && error.stack || error)); }
}
const run = (d, args) => {
  const r = cp.spawnSync(process.execPath, [CLI, ...args], { cwd: d, env: ENV, encoding: 'utf8', timeout: 120000, windowsHide: true });
  assert.strictEqual(r.error, undefined, r.error && r.error.message);
  return r;
};
// A project with the given source files and, for each entry of `referenced`, a task whose text names that file.
function project(files, referenced = []) {
  const d = path.join(arena, 'p' + (++seq));
  fs.mkdirSync(d);
  assert.strictEqual(run(d, ['init', d, '--yes', '--minimal']).status, 0, 'init');
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, name)), { recursive: true });
    fs.writeFileSync(path.join(d, name), text);
  }
  for (const name of referenced) assert.strictEqual(run(d, ['task', 'add', `Clean up ${name}`, '--path', d]).status, 0, 'task add');
  return d;
}
const tasks = d => {
  const r = run(d, ['task', 'list', '--path', d, '--json']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const parsed = JSON.parse(r.stdout);
  return (parsed.tasks || parsed).map(t => t.request);
};
const autoTracked = d => tasks(d).filter(request => /^TODO /.test(request)).sort();
const known = d => {
  const file = path.join(d, '.leerness', 'known-todos.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).map(t => `${t.file}:${t.line}`).sort() : null;
};
const autoTrack = d => {
  const r = run(d, ['lazy', 'detect', d, '--auto-track']);
  assert.ok(r.status === 0 || r.status === 1, 'lazy detect exit ' + r.status + '\n' + r.stdout + r.stderr);
  return r;
};
const SOURCES = {
  'src/covered.js': '// TODO: first covered note\nfunction a() {}\n// FIXME: second covered note\n',
  'src/fresh.js': 'function b() {}\n// TODO: fresh note\n',
};
try {
  test('a mixed batch registers only the TODO in the file no task references', () => {
    const d = project(SOURCES, ['src/covered.js']);
    autoTrack(d);
    assert.deepStrictEqual(autoTracked(d), ['TODO src/fresh.js:2']);
    assert.deepStrictEqual(known(d), ['src/fresh.js:2']);
    assert.strictEqual(tasks(d).filter(request => request === 'Clean up src/covered.js').length, 1, 'the referencing task is kept as it was');
  });
  test('running it again registers nothing more', () => {
    const d = project(SOURCES, ['src/covered.js']);
    autoTrack(d);
    autoTrack(d);
    assert.deepStrictEqual(autoTracked(d), ['TODO src/fresh.js:2']);
    assert.deepStrictEqual(known(d), ['src/fresh.js:2']);
  });
  test('control: with no file referenced, every new TODO is registered', () => {
    const d = project(SOURCES);
    autoTrack(d);
    assert.deepStrictEqual(autoTracked(d), ['TODO src/covered.js:1', 'TODO src/covered.js:3', 'TODO src/fresh.js:2']);
    assert.deepStrictEqual(known(d), ['src/covered.js:1', 'src/covered.js:3', 'src/fresh.js:2']);
  });
  test('control: with every file referenced, nothing is registered and known-todos.json is not written', () => {
    const d = project(SOURCES, ['src/covered.js', 'src/fresh.js']);
    autoTrack(d);
    assert.deepStrictEqual(autoTracked(d), []);
    assert.strictEqual(known(d), null);
  });
} finally {
  fs.rmSync(arena, { recursive: true, force: true });
}
console.log(`lazy auto-track probe: ${passed}/${passed + failed} passed (${process.platform})`);
process.exitCode = failed ? 1 : 0;
