'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { createHash } = require('node:crypto');
const { captureMemoryOutput, publishMemoryOutput } = require('../lib/memory-output');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const VERSION = require('../package.json').version;
const title = '한글 계획 English 日本語 🐝 e\u0301';
const plan = '\ufeff# Plan\r\n\r\n### M-0001. ' + title + '\r\nStatus: in-progress\r\nProgress: 25%\r\nDone-When: original acceptance\r\n\r\nTasks:\r\n- [ ] keep original\r\n';
const tracker = '\ufeff# Tasks\r\n| ID | Status | Request | Evidence | Next Action | Updated |\r\n|---|---|---|---|---|---|\r\n| T-0001 | done | first | observed | none | 2026-11-04 |\r\n| T-0002 | in-progress | ' + title + ' | not_run | next | 2026-11-04 |\r\n';
const variants = [
  { sub: 'show', file: 'plan.md', success: data => { assert.equal(data.exists, true); assert.equal(data.raw, plan.slice(1)); assert.deepEqual(data.milestones, ['M-0001. ' + title]); }, empty: data => { assert.equal(data.exists, false); assert.equal(data.raw, ''); } },
  { sub: 'list', file: 'plan.md', success: data => { assert.equal(data.total, 1); assert.equal(data.milestones[0].title, title); assert.equal(data.milestones[0].status, 'in-progress'); assert.deepEqual(data.milestones[0].tasks, [{ done: false, text: 'keep original' }]); }, empty: data => { assert.equal(data.total, 0); assert.deepEqual(data.milestones, []); } },
  { sub: 'progress', file: 'progress-tracker.md', success: data => { assert.equal(data.total, 2); assert.equal(data.done, 1); assert.equal(data.percent, 50); assert.equal(data.counts['in-progress'], 1); }, empty: data => { assert.equal(data.total, 0); assert.equal(data.done, 0); assert.equal(data.percent, 0); } },
];
function snapshot(root) {
  const result = [];
  const visit = dir => {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name), stat = fs.lstatSync(file, { bigint: true });
      result.push([path.relative(root, file), String(stat.ino), String(stat.mode), String(stat.mtimeNs),
        stat.isSymbolicLink() ? fs.readlinkSync(file) : stat.isFile() ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null]);
      if (stat.isDirectory() && !stat.isSymbolicLink()) visit(file);
    }
  };
  visit(root); return result;
}
function fixture(fn) {
  const arena = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-plan-read-'));
  const root = path.join(arena, '프로젝트 space'), home = path.join(arena, 'home'), ws = path.join(root, '.leerness');
  fs.mkdirSync(ws, { recursive: true }); fs.mkdirSync(home);
  const put = (name, bytes) => { const file = path.join(ws, name); fs.writeFileSync(file, bytes); return file; };
  put('HARNESS_VERSION', VERSION + '\n'); put('LANGUAGE', 'en\n');
  put('manifest.json', JSON.stringify({ language: 'en', mode: 'standard' }));
  put('plan.md', plan); put('progress-tracker.md', tracker);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:LEERNESS_|_LEERNESS_|GIT_|NODE_OPTIONS$)/i.test(key)) delete env[key];
  Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home,
    LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_BANNER: '1', LEERNESS_NO_AUTOCHCP: '1',
    LEERNESS_NO_STALE_CHECK: '1', NO_COLOR: '1' });
  const run = (args, input) => {
    const result = cp.spawnSync(process.execPath, [CLI, ...args, '--path', root], { cwd: root, env, input,
      encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.error, undefined, result.error?.message); assert.equal(result.signal, null);
    return result;
  };
  const gap = name => {
    const file = path.join(ws, name), scratch = fs.mkdtempSync(path.join(ws, `.${name}.publish-cas-`));
    fs.renameSync(file, path.join(scratch, 'before')); fs.writeFileSync(path.join(scratch, 'next'), 'unpublished replacement\n');
    return { file, scratch };
  };
  try { return fn({ arena, root, ws, put, gap, run }); }
  finally { fs.rmSync(arena, { recursive: true, force: true }); }
}
function successful(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}
function refused(result) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const data = JSON.parse(result.stdout); assert.equal(data.ok, false);
  assert.equal(typeof data.code, 'string'); assert(data.error); return data;
}
for (const v of variants) {
  test(`plan ${v.sub}: interrupted publication is not empty success and preserves all bytes`, () => fixture(f => {
    f.gap(v.file); const before = snapshot(f.arena);
    const data = refused(f.run(['plan', v.sub, '--json']));
    assert.match(data.error, /publication|save/i); assert.deepEqual(snapshot(f.arena), before);
  }));
  test(`plan ${v.sub}: valid Unicode/BOM/CRLF keeps the existing JSON contract without writes`, () => fixture(f => {
    const before = snapshot(f.arena); v.success(successful(f.run(['plan', v.sub, '--json'])));
    assert.deepEqual(snapshot(f.arena), before);
  }));
  test(`plan ${v.sub}: genuinely missing source keeps the original empty contract without writes`, () => fixture(f => {
    fs.unlinkSync(path.join(f.ws, v.file)); const before = snapshot(f.arena);
    v.empty(successful(f.run(['plan', v.sub, '--json']))); assert.deepEqual(snapshot(f.arena), before);
  }));
  test(`plan ${v.sub}: uninitialized workspace remains a read, not an installation`, () => fixture(f => {
    fs.rmSync(f.ws, { recursive: true }); const before = snapshot(f.arena);
    v.empty(successful(f.run(['plan', v.sub, '--json']))); assert.deepEqual(snapshot(f.arena), before);
  }));
  test(`plan ${v.sub}: invalid UTF-8 is refused instead of replacement-character success`, () => fixture(f => {
    f.put(v.file, Buffer.from([0xff, 0xfe, 0x0a])); const before = snapshot(f.arena);
    refused(f.run(['plan', v.sub, '--json'])); assert.deepEqual(snapshot(f.arena), before);
  }));
  test(`plan ${v.sub}: directory link is refused without opening the linked target`, () => fixture(f => {
    fs.unlinkSync(path.join(f.ws, v.file)); const outside = path.join(f.arena, 'outside'); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'original'), 'preserve outside');
    fs.symlinkSync(outside, path.join(f.ws, v.file), process.platform === 'win32' ? 'junction' : 'dir');
    const before = snapshot(f.arena); refused(f.run(['plan', v.sub, '--json'])); assert.deepEqual(snapshot(f.arena), before);
  }));
  test(`plan ${v.sub}: unrelated markers do not poison genuine absence`, () => fixture(f => {
    fs.unlinkSync(path.join(f.ws, v.file)); fs.mkdirSync(path.join(f.ws, '.unrelated.md.publish-cas-Ab1234'));
    fs.mkdirSync(path.join(f.ws, `.${v.file}.publish-cas-not.a.token`)); const before = snapshot(f.arena);
    v.empty(successful(f.run(['plan', v.sub, '--json']))); assert.deepEqual(snapshot(f.arena), before);
  }));
  test(`plan ${v.sub}: present source remains readable beside an old marker`, () => fixture(f => {
    fs.mkdirSync(path.join(f.ws, `.${v.file}.publish-cas-Ab1234`)); const before = snapshot(f.arena);
    v.success(successful(f.run(['plan', v.sub, '--json']))); assert.deepEqual(snapshot(f.arena), before);
  }));
  test(`plan ${v.sub}: non-JSON and dry-run reads keep the complete fixture unchanged`, () => fixture(f => {
    const before = snapshot(f.arena), result = f.run(['plan', v.sub, '--dry-run']);
    assert.equal(result.status, 0, result.stdout + result.stderr); assert(result.stdout.trim());
    assert.deepEqual(snapshot(f.arena), before);
  }));
}
for (const v of [variants[0], variants[2]]) {
  test(`plan ${v.sub}: actual POSIX publisher interval is refused without disturbing publication`, { skip: process.platform === 'win32' }, () => fixture(f => {
    f.put(v.file, v.file === 'plan.md' ? plan.replace('25%', '10%') : tracker.replace('| done |', '| requested |'));
    const file = path.join(f.ws, v.file), output = captureMemoryOutput(file), original = fs.renameSync;
    let reached = false, observed;
    fs.renameSync = function(from, to, ...rest) {
      const result = original.call(this, from, to, ...rest);
      if (from === file && path.basename(to) === 'before') {
        reached = true; const before = snapshot(f.arena);
        observed = f.run(['plan', v.sub, '--json']); assert.deepEqual(snapshot(f.arena), before);
      }
      return result;
    };
    try { publishMemoryOutput(output, file, v.file === 'plan.md' ? plan : tracker); }
    finally { fs.renameSync = original; }
    assert(reached); refused(observed); v.success(successful(f.run(['plan', v.sub, '--json'])));
  }));
}
test('bare plan uses the same read-only show path', () => fixture(f => {
  const before = snapshot(f.arena); variants[0].success(successful(f.run(['plan', '--json'])));
  assert.deepEqual(snapshot(f.arena), before);
}));
test('MCP plan list returns the same refused source and no fixture writes', () => fixture(f => {
  f.gap('plan.md'); const before = snapshot(f.arena), cli = f.run(['plan', 'list', '--json']); refused(cli);
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_plan_list', arguments: { path: f.root } } };
  const message = successful(f.run(['mcp', 'serve', '--profile', 'full'], JSON.stringify(request) + '\n'));
  assert.equal(message.result.isError, true); assert.equal(message.result.content[0].text, cli.stdout);
  assert.deepEqual(snapshot(f.arena), before);
}));
test('plan add still uses the existing write path and preserves authored content', () => fixture(f => {
  const result = successful(f.run(['plan', 'add', 'new milestone', '--json']));
  assert.equal(result.ok, true); assert.match(result.milestone, /^M-\d{4,}$/); assert.match(result.task, /^T-\d{4,}$/);
  const bytes = fs.readFileSync(path.join(f.ws, 'plan.md'), 'utf8'); assert(bytes.startsWith(plan));
  assert(bytes.includes('new milestone')); assert(fs.readFileSync(path.join(f.ws, 'progress-tracker.md'), 'utf8').includes('new milestone'));
}));
