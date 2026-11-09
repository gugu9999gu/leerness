'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { performance } = require('node:perf_hooks');
const portable = require('../lib/portable-process');

function fixture(fn, label = 'é-한글') {
  const arena = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-locator-unicode-'));
  const bin = path.join(arena, label), cwd = path.join(arena, 'caller');
  fs.mkdirSync(bin); fs.mkdirSync(cwd);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(path|pathext)$/i.test(key)) delete env[key];
  env.Path = bin;
  env.PATHEXT = '.cmd;.exe;.com;.bat';
  if (process.platform !== 'win32') {
    env.SystemRoot = path.join(arena, 'system');
    fs.mkdirSync(path.join(env.SystemRoot, 'System32'), { recursive: true });
    fs.writeFileSync(path.join(env.SystemRoot, 'System32', 'where.exe'), 'locator fixture');
  }
  const shim = (dir, name = 'leerness-locator-fixture', text = 'fixture result') => {
    fs.writeFileSync(path.join(dir, name + '.js'), 'console.log(' + JSON.stringify(text) + ');\n');
    const file = path.join(dir, name + '.cmd');
    fs.writeFileSync(file, '@ECHO off\r\n"%_prog%" "%dp0%\\' + name + '.js" %*\r\n');
    return file;
  };
  try { return fn({ arena, bin, cwd, env, shim, options: { cwd, env, platform: 'win32' } }); }
  finally { fs.rmSync(arena, { recursive: true, force: true }); }
}
function locatorResponse(result, fn) {
  const original = cp.spawnSync;
  const calls = [];
  cp.spawnSync = (file, args, options) => {
    assert.match(file, /System32[\\/]where\.exe$/i);
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    calls.push({ file, args });
    return result;
  };
  try { return fn(calls); } finally { cp.spawnSync = original; }
}
const lost = { status: 0, stdout: 'unrecoverable-??-\ufffd\\leerness-locator-fixture.cmd\r\n' };
for (const label of ['accent-é', 'korean-한글', 'emoji-🐝', 'combining-e\u0301']) {
  test('Unicode PATH uses actual filesystem spelling despite lossy locator output: ' + label, () => fixture(f => {
    const source = f.shim(f.bin);
    locatorResponse(lost, calls => {
      const result = portable.resolvePortableLaunch('leerness-locator-fixture', f.options);
      assert.equal(result.kind, 'npm-node-shim'); assert.equal(result.source, source);
      assert.equal(result.argsPrefix[0], path.join(f.bin, 'leerness-locator-fixture.js'));
      assert.equal(calls.length, 1);
    });
  }, label));
}
test('Unicode command name is resolved literally', () => fixture(f => {
  const source = f.shim(f.bin, '도구');
  locatorResponse(lost, () => assert.equal(portable.resolvePortableLaunch('도구', f.options).source, source));
}, 'ascii'));
test('cwd-only executable stays excluded even when the locator reports it', () => fixture(f => {
  const shadow = path.join(f.cwd, 'leerness-locator-fixture.exe'); fs.writeFileSync(shadow, 'MZ');
  locatorResponse({ status: 0, stdout: shadow }, () => assert.equal(portable.resolvePortableLaunch('leerness-locator-fixture', f.options).kind, 'unresolved'));
}));
test('PATH precedence and explicit allowed cwd precedence remain deterministic', () => fixture(f => {
  const second = path.join(f.arena, 'later'); fs.mkdirSync(second);
  const first = f.shim(f.bin), later = f.shim(second);
  f.env.Path = [f.bin, second].join(path.delimiter);
  locatorResponse(lost, () => {
    assert.equal(portable.resolvePortableLaunch('leerness-locator-fixture', f.options).source, first);
    assert.equal(portable.resolvePortableLaunch('leerness-locator-fixture', { ...f.options, cwd: second }).source, later);
  });
}));
test('PATHEXT controls candidates and rejects path traversal extensions', () => fixture(f => {
  fs.writeFileSync(path.join(f.bin, 'leerness-locator-fixture.exe'), 'MZ'); f.shim(f.bin);
  locatorResponse(lost, () => {
    f.env.PATHEXT = '.exe;.cmd';
    assert.equal(portable.resolvePortableLaunch('leerness-locator-fixture', f.options).kind, 'native');
    f.env.PATHEXT = '.com';
    assert.equal(portable.resolvePortableLaunch('leerness-locator-fixture', f.options).kind, 'unresolved');
    f.env.PATHEXT = '.cmd/../leerness-locator-fixture.exe';
    assert.equal(portable.resolvePortableLaunch('leerness-locator-fixture', f.options).kind, 'unresolved');
  });
}));
test('unsupported shell script is not executed by the Unicode resolver', () => fixture(f => {
  fs.writeFileSync(path.join(f.bin, 'leerness-locator-fixture.cmd'), '@echo off\r\necho do not execute\r\n');
  locatorResponse(lost, () => assert.equal(portable.resolvePortableLaunch('leerness-locator-fixture', f.options).kind, 'unsupported-shell-script'));
}));
test('untrusted locator stdout cannot introduce a candidate outside Unicode PATH', () => fixture(f => {
  const outside = path.join(f.cwd, 'foreign.exe'); fs.writeFileSync(outside, 'MZ');
  locatorResponse({ status: 0, stdout: outside }, () => assert.deepEqual(portable.windowsPathCandidates('foreign', f.options), []));
}));
test('locator timeout stays unknown and does not fall back to filesystem success', () => fixture(f => {
  f.shim(f.bin);
  locatorResponse({ status: null, error: Object.assign(new Error('synthetic timeout'), { code: 'ETIMEDOUT' }) }, () => {
    assert.throws(() => portable.resolvePortableLaunch('leerness-locator-fixture', { ...f.options, deadlineAt: performance.now() + 500 }), { code: 'ETIMEDOUT' });
  });
}));
test('locator missing result does not become an invented successful observation', () => fixture(f => {
  f.shim(f.bin);
  locatorResponse({ status: 1, stdout: '' }, () => assert.equal(portable.resolvePortableLaunch('leerness-locator-fixture', f.options).kind, 'unresolved'));
}));
test('literal wildcard command is never expanded to an executable', () => fixture(f => {
  f.shim(f.bin);
  locatorResponse(lost, () => assert.equal(portable.resolvePortableLaunch('leerness-*', f.options).kind, 'unresolved'));
}));
for (const label of ['accent-é', 'korean-한글', 'emoji-🐝', 'combining-e\u0301']) {
  test('real Windows named and absolute execution agree: ' + label, { skip: process.platform !== 'win32' }, () => fixture(f => {
    const source = f.shim(f.bin);
    const named = portable.spawnPortableSync('leerness-locator-fixture', [], { ...f.options, encoding: 'utf8', timeout: 5000 });
    const absolute = portable.spawnPortableSync(source, [], { ...f.options, encoding: 'utf8', timeout: 5000 });
    assert.equal(named.status, 0, named.stderr); assert.equal(absolute.status, 0, absolute.stderr);
    assert.equal(named.stdout, absolute.stdout); assert.equal(named.stdout.trim(), 'fixture result');
  }, label));
}
