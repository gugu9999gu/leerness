'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { createHash } = require('node:crypto');
const { captureCheckedFileInput, captureMemoryInput } = require('../lib/memory-input');
const { captureMemoryOutput, publishMemoryOutput } = require('../lib/memory-output');
const { createSnapshot } = require('../lib/stored-read-snapshot');
const { withErrorLanguage } = require('../lib/error-language');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const VERSION = require('../package.json').version;

function fixture(fn) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-gap-read-'));
  const ws = path.join(root, '.leerness');
  fs.mkdirSync(ws);
  const put = (name, bytes) => { const file = path.join(ws, name); fs.writeFileSync(file, bytes); return file; };
  put('HARNESS_VERSION', VERSION + '\n');
  put('manifest.json', JSON.stringify({ language: 'en', mode: 'standard' }));
  put('LANGUAGE', 'en\n');
  put('progress-tracker.md', '# Tasks\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n| T-0001 | in-progress | Preserve authored task | not_run | next | 2026-11-03 |\n');
  put('plan.md', '# Plan\n<!-- leerness:owner-priorities:start -->\n1. T-0001\n<!-- leerness:owner-priorities:end -->\n');
  put('rules.md', '# Rules\n');
  put('current-state.md', '# State\nUnverified remains unknown.\n');
  put('session-handoff.md', '# Handoff\nAuthored context.\n');
  put('decisions.json', '[{"title":"original decision"}]\n');
  put('lessons.json', '[]\n');
  const gap = name => {
    const file = path.join(ws, name);
    const scratch = fs.mkdtempSync(path.join(ws, `.${name}.publish-cas-`));
    fs.writeFileSync(path.join(scratch, 'next'), 'planned replacement\n');
    fs.renameSync(file, path.join(scratch, 'before'));
    return { file, scratch };
  };
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:LEERNESS_|_LEERNESS_|GIT_|NODE_OPTIONS$)/i.test(key)) delete env[key];
  Object.assign(env, { LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_BANNER: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', NO_COLOR: '1' });
  const run = (args, input) => {
    const result = cp.spawnSync(process.execPath, [CLI, ...args, '--path', root], {
      cwd: root, env, input, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null);
    return result;
  };
  try { return fn({ root, ws, put, gap, run }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function snapshot(root) {
  const result = [];
  const visit = dir => {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name), stat = fs.lstatSync(file, { bigint: true });
      result.push([path.relative(root, file), String(stat.ino), String(stat.mode), String(stat.mtimeNs),
        stat.isSymbolicLink() ? fs.readlinkSync(file) : stat.isFile() ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null]);
      if (stat.isDirectory()) visit(file);
    }
  };
  visit(root);
  return result;
}
function patch(name, replacement, fn) {
  const original = fs[name];
  fs[name] = replacement(original);
  try { return fn(); } finally { fs[name] = original; }
}
const changed = fn => assert.throws(fn, { code: 'E_STORE_CHANGED' });

for (const name of ['progress-tracker.md', 'plan.md', 'rules.md', 'current-state.md', 'decisions.json', '한글.[원문].md']) {
  test(`real POSIX publication gap never becomes an absent snapshot: ${name}`, { skip: process.platform === 'win32' }, () => fixture(f => {
    const file = f.put(name, 'original bytes\r\n');
    const output = captureMemoryOutput(file);
    let observed = false, refusal = null, result = null, readOnly = false;
    patch('renameSync', original => function(from, to, ...args) {
      const value = original.call(this, from, to, ...args);
      if (from === file && path.basename(to) === 'before') {
        observed = true;
        const before = snapshot(f.root);
        try { result = captureCheckedFileInput(file); } catch (error) { refusal = error; }
        readOnly = JSON.stringify(snapshot(f.root)) === JSON.stringify(before);
      }
      return value;
    }, () => publishMemoryOutput(output, file, 'replacement bytes\r\n'));
    assert(observed, 'the real publisher did not expose its rename-away interval');
    assert.equal(refusal?.code, 'E_STORE_CHANGED', JSON.stringify(result));
    assert(readOnly, 'the read changed publication or recovery bytes');
    assert.equal(captureCheckedFileInput(file).bytes.toString(), 'replacement bytes\r\n');
  }));
}

test('interrupted canonical publication never falls back to stale legacy data', () => fixture(f => {
  f.put('decisions.md', '# Original legacy text\n');
  const { file } = f.gap('decisions.json'), before = snapshot(f.root);
  let parses = 0;
  changed(() => captureMemoryInput(file, path.join(f.ws, 'decisions.md'), () => { parses++; return [{ title: 'stale fallback' }]; }));
  assert.equal(parses, 0);
  assert.deepEqual(snapshot(f.root), before);
}));

test('interrupted legacy-only publication never becomes empty memory', () => fixture(f => {
  f.put('legacy.md', 'original legacy\n');
  const { file } = f.gap('legacy.md'), before = snapshot(f.root);
  let parses = 0;
  changed(() => captureMemoryInput(path.join(f.ws, 'missing.json'), file, () => { parses++; return []; }));
  assert.equal(parses, 0);
  assert.deepEqual(snapshot(f.root), before);
}));

test('a genuinely absent canonical and legacy pair remains empty', () => fixture(f => {
  const before = snapshot(f.root);
  const input = captureMemoryInput(path.join(f.ws, 'missing.json'), path.join(f.ws, 'missing.md'), () => { throw Error('unexpected parser'); });
  assert.equal(input.source, 'empty'); assert.deepEqual(input.entries, []);
  assert.deepEqual(snapshot(f.root), before);
}));

test('other targets and non-publication names do not block genuine absence', () => fixture(f => {
  for (const name of ['.other.md.publish-cas-Ab1234', '.missing.md.publish-cas-', '.missing.md.publish-cas-not.a.token', '.missing.md.publish-cas-Ab1234.txt']) fs.mkdirSync(path.join(f.ws, name));
  assert.equal(captureCheckedFileInput(path.join(f.ws, 'missing.md')).exists, false);
}));

test('an ambiguous empty publication marker is preserved, never automatically removed', () => fixture(f => {
  fs.mkdirSync(path.join(f.ws, '.missing.md.publish-cas-Ab1234'));
  const before = snapshot(f.root);
  changed(() => captureCheckedFileInput(path.join(f.ws, 'missing.md')));
  assert.deepEqual(snapshot(f.root), before);
}));

test('a matching marker that is a file still prevents an unsupported absence claim', () => fixture(f => {
  f.put('.missing.md.publish-cas-Ab1234', 'user-owned marker-shaped bytes');
  const before = snapshot(f.root);
  changed(() => captureCheckedFileInput(path.join(f.ws, 'missing.md')));
  assert.deepEqual(snapshot(f.root), before);
}));

test('matching marker links are not followed or opened', () => fixture(f => {
  const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'before'), 'outside original');
  const marker = path.join(f.ws, '.missing.md.publish-cas-Ab1234');
  fs.symlinkSync(outside, marker, process.platform === 'win32' ? 'junction' : 'dir');
  const before = snapshot(f.root);
  patch('lstatSync', original => function(file, ...args) {
    assert(!String(file).startsWith(marker + path.sep), 'followed a marker link');
    return original.call(this, file, ...args);
  }, () => changed(() => captureCheckedFileInput(path.join(f.ws, 'missing.md'))));
  assert.deepEqual(snapshot(f.root), before);
}));

test('existing valid files retain the fast path even beside old markers', () => fixture(f => {
  const file = f.put('existing.md', '\ufeffauthored\r\n');
  fs.mkdirSync(path.join(f.ws, '.existing.md.publish-cas-Ab1234'));
  patch('readdirSync', () => () => { throw Error('existing read enumerated publication markers'); }, () => {
    assert.equal(captureCheckedFileInput(file).bytes.toString(), '\ufeffauthored\r\n');
  });
}));

test('publication finishing before the marker scan is detected by the second leaf check', () => fixture(f => {
  const { file, scratch } = f.gap('current-state.md');
  let fired = false;
  patch('readdirSync', original => function(dir, ...args) {
    if (!fired && dir === f.ws) {
      fired = true;
      fs.renameSync(path.join(scratch, 'next'), file);
      fs.unlinkSync(path.join(scratch, 'before'));
      fs.rmdirSync(scratch);
    }
    return original.call(this, dir, ...args);
  }, () => changed(() => captureCheckedFileInput(file)));
  assert(fired); assert.equal(fs.readFileSync(file, 'utf8'), 'planned replacement\n');
}));

test('parent replacement during the absence check is refused', () => fixture(f => {
  const file = path.join(f.ws, 'missing.md'); let fired = false;
  patch('readdirSync', original => function(dir, ...args) {
    const names = original.call(this, dir, ...args);
    if (!fired && dir === f.ws) { fired = true; fs.renameSync(f.ws, f.ws + '-old'); fs.mkdirSync(f.ws); }
    return names;
  }, () => changed(() => captureCheckedFileInput(file)));
  assert(fired);
}));

test('unreadable parent enumeration is not positive absence', () => fixture(f => {
  patch('readdirSync', original => function(dir, ...args) {
    if (dir === f.ws) throw Object.assign(Error('fixture EACCES'), { code: 'EACCES' });
    return original.call(this, dir, ...args);
  }, () => assert.throws(() => captureCheckedFileInput(path.join(f.ws, 'missing.md')), { code: 'E_STORE_UNREADABLE' }));
}));

test('shared stored-read snapshots refuse the missing tracker', () => fixture(f => {
  const { file } = f.gap('progress-tracker.md');
  changed(() => createSnapshot(f.root).capture(file));
}));

for (const [name, args] of [['task list', ['task', 'list', '--json']], ['handoff', ['handoff', '--json', '--compact']]]) {
  test(`CLI ${name} reports a read error, not an empty successful result`, () => fixture(f => {
    f.gap('progress-tracker.md'); const before = snapshot(f.root);
    const result = f.run(args);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.ok, false); assert.equal(data.code, 'error');
    assert.match(data.error, /publication|save/i);
    assert.deepEqual(snapshot(f.root), before);
  }));
}

test('CLI state show does not invent initial state during publication', () => fixture(f => {
  f.put('state.json', JSON.stringify({ schemaVersion: 1, project: 'fixture', currentRunId: null, runCounter: 0, runsBySession: {}, updatedAt: null }));
  f.gap('state.json'); const before = snapshot(f.root);
  const result = f.run(['state', 'show', '--json']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).code, 'store_changed');
  assert.deepEqual(snapshot(f.root), before);
}));

test('MCP task list preserves the CLI error payload and performs no writes', () => fixture(f => {
  f.gap('progress-tracker.md'); const before = snapshot(f.root);
  const cli = f.run(['task', 'list', '--json']);
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_task_list', arguments: { path: f.root } } };
  const result = f.run(['mcp', 'serve', '--profile', 'full'], JSON.stringify(request) + '\n');
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const message = JSON.parse(result.stdout.trim());
  assert.equal(message.result.isError, true);
  assert.equal(message.result.content[0].text, cli.stdout);
  assert.deepEqual(snapshot(f.root), before);
}));

for (const language of ['en', 'ko']) test(`publication refusal retains ${language} error language`, () => fixture(f => {
  const { file } = f.gap('current-state.md');
  withErrorLanguage(language, () => {
    assert.throws(() => captureCheckedFileInput(file), error => error.code === 'E_STORE_CHANGED'
      && (language === 'en' ? /publication|save/i.test(error.message) : /저장/.test(error.message)));
  });
}));
