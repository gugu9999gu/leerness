#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { captureMemoryOutput, assertMemoryOutputCurrent, publishMemoryOutput } = require('../lib/memory-output');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-memory-output-unit-'));
const hd = path.join(temp, 'files');
fs.mkdirSync(hd, { recursive: true });
const results = [];
let seq = 0;
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
function file(name = 'target') { return path.join(hd, `${++seq}-${name}.txt`); }
function expectCode(fn, code) {
  let got = null;
  try { fn(); } catch (error) { got = error; }
  assert(got, `expected ${code}`);
  assert.strictEqual(got.code, code, got.stack || got.message);
  return got;
}
function recoveryEntries() {
  return fs.readdirSync(hd).filter(name => /(?:\.leerness-write-|\.publish-|publish-cas-)/.test(name));
}

try {
  test('absent snapshot accepts unchanged absence', () => {
    const p = file();
    const snap = captureMemoryOutput(p);
    assert.strictEqual(snap.exists, false);
    assertMemoryOutputCurrent(snap, p);
  });

  test('absent snapshot detects a newly-created target', () => {
    const p = file();
    const snap = captureMemoryOutput(p);
    fs.writeFileSync(p, 'external\n');
    expectCode(() => assertMemoryOutputCurrent(snap, p), 'E_OUTPUT_CHANGED');
    assert.strictEqual(fs.readFileSync(p, 'utf8'), 'external\n');
  });

  test('existing snapshot accepts identical live object', () => {
    const p = file();
    fs.writeFileSync(p, 'before\n');
    const snap = captureMemoryOutput(p);
    assert.strictEqual(snap.exists, true);
    assertMemoryOutputCurrent(snap, p);
  });

  test('existing snapshot detects byte change', () => {
    const p = file();
    fs.writeFileSync(p, 'before\n');
    const snap = captureMemoryOutput(p);
    fs.writeFileSync(p, 'after\n');
    expectCode(() => assertMemoryOutputCurrent(snap, p), 'E_OUTPUT_CHANGED');
    assert.strictEqual(fs.readFileSync(p, 'utf8'), 'after\n');
  });

  test('same-byte pathname replacement is still a change', () => {
    const p = file();
    const replacement = `${p}.replacement`;
    fs.writeFileSync(p, 'same\n');
    const snap = captureMemoryOutput(p);
    fs.writeFileSync(replacement, 'same\n');
    fs.renameSync(replacement, p);
    expectCode(() => assertMemoryOutputCurrent(snap, p), 'E_OUTPUT_CHANGED');
    assert.strictEqual(fs.readFileSync(p, 'utf8'), 'same\n');
  });

  test('hard-linked output target is rejected fail-closed', () => {
    const p = file();
    const alias = `${p}.alias`;
    fs.writeFileSync(p, 'linked\n');
    fs.linkSync(p, alias);
    expectCode(() => captureMemoryOutput(p), 'E_OUTPUT_CHANGED');
    assert.strictEqual(fs.readFileSync(alias, 'utf8'), 'linked\n');
  });

  test('snapshot token is bound to its exact target', () => {
    const a = file('a');
    const b = file('b');
    fs.writeFileSync(a, 'a\n');
    fs.writeFileSync(b, 'b\n');
    const snap = captureMemoryOutput(a);
    expectCode(() => assertMemoryOutputCurrent(snap, b), 'E_OUTPUT_CHANGED');
  });

  test('absent publication creates exact bytes without overwriting', () => {
    const p = file();
    const snap = captureMemoryOutput(p);
    const result = publishMemoryOutput(snap, p, Buffer.from('created\n'));
    assert.strictEqual(result.created, true);
    assert.strictEqual(fs.readFileSync(p, 'utf8'), 'created\n');
  });

  test('existing publication replaces expected bytes and cleans success scratch', () => {
    const p = file();
    fs.writeFileSync(p, 'before\n');
    const snap = captureMemoryOutput(p);
    const beforeRecovery = recoveryEntries();
    const result = publishMemoryOutput(snap, p, 'after\n');
    assert.strictEqual(result.published, true);
    assert.strictEqual(fs.readFileSync(p, 'utf8'), 'after\n');
    assert.deepStrictEqual(recoveryEntries(), beforeRecovery);
  });

  test('identical publication is a checked no-op', () => {
    const p = file();
    fs.writeFileSync(p, 'same\n');
    const snap = captureMemoryOutput(p);
    const statBefore = fs.statSync(p);
    const result = publishMemoryOutput(snap, p, 'same\n');
    const statAfter = fs.statSync(p);
    assert.strictEqual(result.unchanged, true);
    assert.strictEqual(statAfter.mtimeMs, statBefore.mtimeMs);
  });
  if (process.platform === 'win32') {
    function observations(changePath, changeHandle, body) {
      const lstat = fs.lstatSync, fstat = fs.fstatSync;
      fs.lstatSync = (...args) => { const st = lstat(...args); return changePath(st); };
      fs.fstatSync = (...args) => { const st = fstat(...args); return changeHandle(st); };
      try { body(); } finally { fs.lstatSync = lstat; fs.fstatSync = fstat; }
    }
    const zeroPathDevice = st => { if (st.isFile()) st.dev = 0; return st; };
    test('Windows unknown path device requires successful descriptor confirmation', () => {
      const p = file(); fs.writeFileSync(p, 'same'); let handles = 0;
      observations(zeroPathDevice, st => { handles++; return st; }, () => captureMemoryOutput(p));
      assert.strictEqual(handles, 3);
    });
    test('Windows known path device mismatch remains rejected', () => {
      const p = file(); fs.writeFileSync(p, 'same');
      observations(st => { if (st.isFile()) st.dev = 1; return st; }, st => st,
        () => expectCode(() => captureMemoryOutput(p), 'E_OUTPUT_CHANGED'));
    });
    test('Windows missing descriptor identity cannot certify unknown path device', () => {
      const p = file(); fs.writeFileSync(p, 'same');
      observations(zeroPathDevice, st => { st.dev = 0; return st; },
        () => expectCode(() => captureMemoryOutput(p), 'E_OUTPUT_CHANGED'));
    });
    test('Windows confirmation must retain descriptor metadata equality', () => {
      const p = file(); fs.writeFileSync(p, 'same'); let handles = 0;
      observations(zeroPathDevice, st => { if (++handles === 3) st.mtimeMs += 1; return st; },
        () => expectCode(() => captureMemoryOutput(p), 'E_OUTPUT_CHANGED'));
      assert.strictEqual(handles, 3);
    });
  }
} catch (error) {
  results.push({ name: 'setup', ok: false, error: error.message });
  console.error(error.stack || error.message);
}

const passed = results.filter(result => result.ok).length;
fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify({
  node: process.version, platform: process.platform, temp, passed, total: results.length, results,
}, null, 2) + '\n');
console.log(`memory output unit: ${passed}/${results.length}; Evidence: ${temp}`);
if (passed !== results.length || results.length !== (process.platform === 'win32' ? 14 : 10)) process.exitCode = 1;
