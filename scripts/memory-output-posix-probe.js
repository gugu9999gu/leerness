#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

// POSIX-only race probe for T-0193 memory output publication. Windows has a
// separate ReplaceFileW probe. This script is intentionally skipped on win32 so
// a Windows-only CI run cannot be mistaken for POSIX evidence.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { captureMemoryOutput, publishMemoryOutput } = require('../lib/memory-output');

if (process.platform === 'win32') {
  console.log('SKIP memory output POSIX probe: win32 host');
  process.exit(0);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-memory-output-posix-'));
const results = [];
let seq = 0;
function file(name) { return path.join(temp, `${++seq}-${name}.txt`); }
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.stack || error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
function expectCode(fn, code) {
  let got = null;
  try { fn(); } catch (error) { got = error; }
  assert(got, `expected ${code}`);
  assert.strictEqual(got.code, code, got.stack || got.message);
  return got;
}

try {
  test('absent final-window competitor wins without overwrite', () => {
    const p = file('absent-race');
    const snap = captureMemoryOutput(p);
    const originalLink = fs.linkSync;
    let fired = false;
    fs.linkSync = function (from, to) {
      if (!fired && path.resolve(to) === path.resolve(p)) {
        fired = true;
        fs.writeFileSync(p, 'competitor\n');
      }
      return originalLink.apply(this, arguments);
    };
    try {
      const error = expectCode(() => publishMemoryOutput(snap, p, 'ours\n'), 'E_OUTPUT_CHANGED');
      assert.strictEqual(error.outputMutationStarted, false);
    } finally { fs.linkSync = originalLink; }
    assert.strictEqual(fs.readFileSync(p, 'utf8'), 'competitor\n');
  });

  test('existing final-window competitor is preserved and displaced original retained', () => {
    const p = file('existing-race');
    fs.writeFileSync(p, 'old\n');
    const snap = captureMemoryOutput(p);
    const originalRename = fs.renameSync;
    let fired = false;
    let sawMissing = false;
    fs.renameSync = function (from, to) {
      const result = originalRename.apply(this, arguments);
      if (!fired && path.resolve(from) === path.resolve(p) && path.basename(to) === 'before') {
        fired = true;
        sawMissing = !fs.existsSync(p);
        fs.writeFileSync(p, 'competitor\n');
      }
      return result;
    };
    let error;
    try { error = expectCode(() => publishMemoryOutput(snap, p, 'ours\n'), 'E_OUTPUT_CHANGED'); }
    finally { fs.renameSync = originalRename; }
    assert.strictEqual(sawMissing, true, 'rename-away missing-path window was not observed');
    assert.strictEqual(fs.readFileSync(p, 'utf8'), 'competitor\n');
    assert.strictEqual(error.outputMutationStarted, true);
    assert.strictEqual(error.outputPublished, false);
    assert.strictEqual(error.outputRolledBack, false);
    assert(error.backupFile && fs.existsSync(error.backupFile), 'displaced original backup missing');
    assert.strictEqual(fs.readFileSync(error.backupFile, 'utf8'), 'old\n');
  });

  test('install failure with no competitor restores captured inode', () => {
    const p = file('rollback');
    fs.writeFileSync(p, 'old\n');
    const before = fs.lstatSync(p);
    const snap = captureMemoryOutput(p);
    const originalLink = fs.linkSync;
    let fired = false;
    fs.linkSync = function (from, to) {
      if (!fired && path.resolve(to) === path.resolve(p)) {
        fired = true;
        const injected = new Error('owned fixture injected link failure');
        injected.code = 'EIO';
        throw injected;
      }
      return originalLink.apply(this, arguments);
    };
    let error;
    try { error = expectCode(() => publishMemoryOutput(snap, p, 'ours\n'), 'E_OUTPUT_CHANGED'); }
    finally { fs.linkSync = originalLink; }
    const after = fs.lstatSync(p);
    assert.strictEqual(String(after.dev), String(before.dev));
    assert.strictEqual(String(after.ino), String(before.ino));
    assert.strictEqual(fs.readFileSync(p, 'utf8'), 'old\n');
    assert.strictEqual(error.outputMutationStarted, true);
    assert.strictEqual(error.outputPublished, false);
    assert.strictEqual(error.outputRolledBack, true);
  });
} catch (error) {
  results.push({ name: 'setup', ok: false, error: error.stack || error.message });
  console.error(error.stack || error.message);
}

const passed = results.filter(result => result.ok).length;
fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify({
  node: process.version, platform: process.platform, temp, passed, total: results.length, results,
}, null, 2) + '\n');
console.log(`memory output POSIX: ${passed}/${results.length}; Evidence: ${temp}`);
if (passed !== results.length || results.length !== 3) process.exitCode = 1;
