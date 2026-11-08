'use strict';
require('./temp-cleanup').trackTemp(module);
const cleanup = require('./temp-cleanup');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const { performance } = require('node:perf_hooks');
const portable = require('../lib/portable-process');
const npm = require('../lib/npm-process');
const { probeTool } = require('../lib/env-tool-probe');
const windows = (name, fn) => test(name, { skip: process.platform !== 'win32' }, fn);
function fixture(fn, toolsName = 'tools é 한글') {
  const owned = cleanup.ownTree(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-env-path-')));
  const tools = path.join(owned.dir, toolsName), cwd = path.join(owned.dir, 'caller');
  fs.mkdirSync(tools);fs.mkdirSync(cwd);
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!/^(path|pathext|node_options)$/i.test(key)) env[key] = value;
  Object.assign(env, { PATH: tools, PATHEXT: '.EXE;.CMD' });
  const options = extra => ({ env, cwd, literalPathLookup: true, deadlineAt: performance.now() + 2000,
    timeout: 2000, encoding: 'utf8', maxBuffer: 64 * 1024, ...extra });
  const native = (dir = tools, name = 'safe.exe') => fs.copyFileSync(process.execPath, path.join(dir, name));
  const shim = (text, name = 'safe.cmd') => {
    fs.writeFileSync(path.join(tools, name), '@echo off\r\n"%dp0%\\entry.js" %*\r\n');
    fs.writeFileSync(path.join(tools, 'entry.js'), text);
  };
  try { return fn({ tools, cwd, env, options, native, shim }); }
  finally { cleanup.removeOwnedTree(owned); }
}
windows('environment lookup preserves the trusted PATH result without a locator child', () => fixture(f => {
  f.native();const original = cp.spawnSync;let locators = 0;
  cp.spawnSync = function(file) { if (/where\.exe$/i.test(String(file))) locators++;return original.apply(this, arguments); };
  try {
    const expected = portable.resolvePortableLaunch('safe', f.options({ literalPathLookup: false }));
    assert.equal(locators, 1);locators = 0;
    assert.deepEqual(portable.resolvePortableLaunch('safe', f.options()), expected);
    const r = portable.spawnPortableSync('safe', ['-p', '"native-ok"'], f.options());
    assert.equal(r.status, 0);assert.equal(r.stdout.trim(), 'native-ok');assert.equal(locators, 0);
  } finally { cp.spawnSync = original; }
}));
windows('a working-directory executable outside PATH cannot shadow the allowed tool', () => fixture(f => {
  f.native();f.native(f.cwd);
  const launch = portable.resolvePortableLaunch('safe', f.options());assert.equal(launch.source.toLowerCase(), path.join(f.tools, 'safe.exe').toLowerCase());
  fs.unlinkSync(path.join(f.tools, 'safe.exe'));
  const r = portable.spawnPortableSync('safe', ['--version'], f.options());assert.equal(r.error.code, 'ENOENT');
}));
windows('PATH and PATHEXT ordering still select a supported shim before a native alternative', () => fixture(f => {
  f.native();f.shim('console.log("shim-first");\n');f.env.PATHEXT = '.CMD;.EXE';
  const r = portable.spawnPortableSync('safe', ['--version'], f.options());
  assert.equal(r.status, 0);assert.equal(r.stdout.trim(), 'shim-first');assert.equal(r.launch.source.toLowerCase(), path.join(f.tools, 'safe.cmd').toLowerCase());
}));
windows('mixed-case environment keys and Unicode PATH keep the same authority', () => fixture(f => {
  f.native();const env = {};
  for (const [key, value] of Object.entries(f.env)) env[/^path$/i.test(key) ? 'pAtH' : /^pathext$/i.test(key) ? 'pAtHeXt' : /^systemroot$/i.test(key) ? 'sYsTeMrOoT' : key] = value;
  assert.equal(portable.spawnPortableSync('safe', ['-p', '"mixed-ok"'], f.options({ env })).stdout.trim(), 'mixed-ok');
}));
windows('an unsupported shell shim and wildcard command remain refused', () => fixture(f => {
  fs.writeFileSync(path.join(f.tools, 'unsafe.cmd'), '@echo must-not-run\r\n');
  assert.equal(portable.spawnPortableSync('unsafe', ['--version'], f.options()).error.code, 'E_PORTABLE_SHELL_UNSUPPORTED');
  assert.equal(portable.spawnPortableSync('safe*', ['--version'], f.options()).error.code, 'ENOENT');
}));
windows('the trusted system locator availability check remains fail-closed', () => fixture(f => {
  f.native();const env = { ...f.env };
  for (const key of Object.keys(env)) if (/^(systemroot|windir)$/i.test(key)) delete env[key];
  env.SystemRoot = f.cwd;env.WINDIR = f.cwd;
  assert.throws(() => portable.resolvePortableLaunch('safe', f.options({ env })), { code: 'E_COMMAND_LOOKUP' });
}));
windows('PATH inspection errors are not changed into a missing tool', () => fixture(f => {
  const original = fs.statSync;
  fs.statSync = function(file) { if (String(file) === path.join(f.tools, 'safe.EXE')) throw Object.assign(new Error('denied'), { code: 'EACCES' });return original.apply(this, arguments); };
  try { assert.throws(() => portable.resolvePortableLaunch('safe', f.options()), { code: 'EACCES' }); }
  finally { fs.statSync = original; }
}));
windows('an expired deadline never starts a child', () => fixture(f => {
  f.native();const original = cp.spawnSync;let children = 0;
  cp.spawnSync = function() { children++;return original.apply(this, arguments); };
  try { assert.throws(() => portable.spawnPortableSync('safe', ['--version'], f.options({ deadlineAt: performance.now() - 1 })), { code: 'ETIMEDOUT' });assert.equal(children, 0); }
  finally { cp.spawnSync = original; }
}));
windows('a later inaccessible alias uses the trusted locator without hiding an uncertain absence', () => fixture(f => {
  f.native();const later = path.join(f.cwd, 'later');fs.mkdirSync(later);f.env.PATH += path.delimiter + later;
  const original = fs.statSync;
  fs.statSync = function(file) { if (String(file) === path.join(later, 'safe.EXE')) throw Object.assign(new Error('alias denied'), { code: 'EACCES' });return original.apply(this, arguments); };
  try {
    const r = portable.spawnPortableSync('safe', ['-p', '"confirmed"'], f.options());
    assert.equal(r.status, 0);assert.equal(r.stdout.trim(), 'confirmed');
  } finally { fs.statSync = original; }
}, 'tools'));
windows('tool output overflow and the existing per-tool deadline still fail', () => fixture(f => {
  f.native();const deps = { ...portable, ...npm };
  assert.throws(() => probeTool('safe', ['-e', 'process.stdout.write("x".repeat(70*1024))'],
    { cwd: f.cwd, deadlineAt: performance.now() + 2000 }, { ...deps,
      spawnPortableSync: (name, args, options) => portable.spawnPortableSync(name, args, { ...options, env: f.env }) }), { code: 'ENOBUFS' });
  const start = performance.now();
  const r = portable.spawnPortableSync('safe', ['-e', 'setInterval(()=>{},1000)'], f.options({ deadlineAt: start + 250 }));
  assert.equal(r.error.code, 'ETIMEDOUT');assert(performance.now() - start < 2000);
}));
windows('every observation resolves the current shim instead of a cached launch', () => fixture(f => {
  f.shim('console.log("first");\n');
  assert.equal(portable.spawnPortableSync('safe', ['--version'], f.options()).stdout.trim(), 'first');
  fs.writeFileSync(path.join(f.tools, 'entry.js'), 'console.log("second");\n');
  assert.equal(portable.spawnPortableSync('safe', ['--version'], f.options()).stdout.trim(), 'second');
}));
