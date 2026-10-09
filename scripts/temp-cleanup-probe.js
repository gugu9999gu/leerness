'use strict';

// removeTree waits out a short hold that fs.rmSync's maxRetries does not, keeps rm semantics, and stays bounded.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const { removeTree } = require('./temp-cleanup');

const tempParent = fs.realpathSync(os.tmpdir());
const arena = fs.mkdtempSync(path.join(tempParent, 'leerness-temp-cleanup-'));
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}
// A child process whose working directory is inside the tree holds it (on Windows) until it exits.
function heldTree(name, holdMs) {
  const root = path.join(arena, name);
  const inner = path.join(root, 'inner');
  fs.mkdirSync(inner, { recursive: true });
  fs.writeFileSync(path.join(inner, 'file.txt'), 'x');
  const child = cp.spawn(process.execPath, ['-e', `setTimeout(() => {}, ${holdMs})`], { cwd: inner, stdio: 'ignore', windowsHide: true });
  sleep(300);
  return { root, child };
}

try {
  test('a tree held by an exiting child is removed once the hold ends', () => {
    const { root, child } = heldTree('held', 1200);
    try {
      // What the probes used before: on Windows this fails at once despite maxRetries (reported, not asserted).
      let before = 'removed';
      try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (error) { before = error.code; }
      console.log(`  rmSync with maxRetries on a held tree (${process.platform}, ${process.version}): ${before}`);
      if (fs.existsSync(root)) {
        const started = Date.now();
        removeTree(root, { recursive: true, force: true });
        console.log(`  removeTree waited ${Date.now() - started} ms`);
      }
      assert.strictEqual(fs.existsSync(root), false);
    } finally { child.kill(); }
  });
  test('rm options pass through: a missing path throws without force and is ignored with it', () => {
    const missing = path.join(arena, 'missing');
    assert.throws(() => removeTree(missing, { recursive: true }), error => error.code === 'ENOENT');
    removeTree(missing, { recursive: true, force: true });
  });
  test('an error outside the retry codes is thrown at once', () => {
    const file = path.join(arena, 'plain-file');
    fs.writeFileSync(file, 'x');
    const started = Date.now();
    assert.throws(() => removeTree(path.join(file, 'child'), { recursive: true }), error => !['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'].includes(error.code));
    assert.ok(Date.now() - started < 1000, 'non-retryable error waited');
  });
  test('a hold longer than the bound still fails, after the bound', () => {
    if (process.platform !== 'win32') return;   // a held cwd does not block removal elsewhere
    const { root, child } = heldTree('long-hold', 4000);
    try {
      const started = Date.now();
      assert.throws(() => removeTree(root, { recursive: true, force: true }, { timeoutMs: 600 }), error => error.code === 'EPERM');
      const waited = Date.now() - started;
      assert.ok(waited >= 600 && waited < 2500, `waited ${waited} ms`);
    } finally { child.kill(); }
  });
} finally {
  sleep(300);
  removeTree(arena, { recursive: true, force: true });
}
console.log(`temp cleanup: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
