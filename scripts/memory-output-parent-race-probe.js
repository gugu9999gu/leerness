#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

// T-0193: focused low-level evidence for parent/ancestor pathname replacement.
// This probe does not claim that Node path APIs provide openat-style ancestor fencing.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { captureMemoryOutput, assertMemoryOutputCurrent, publishMemoryOutput } = require('../lib/memory-output');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-memory-parent-race-'));
const results = [];
let seq = 0;
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.error(`FAIL ${name}: ${error.stack || error.message}`); }
}
function fixture() {
  const caseRoot = path.join(root, `case-${++seq}`);
  const anchor = path.join(caseRoot, 'anchor');
  const parent = path.join(anchor, 'memory');
  fs.mkdirSync(parent, { recursive: true });
  return { caseRoot, anchor, parent, target: path.join(parent, 'target.txt') };
}
function moveAnchor(f) {
  const displaced = path.join(f.caseRoot, 'anchor-displaced');
  fs.renameSync(f.anchor, displaced);
  fs.mkdirSync(f.parent, { recursive: true });
  return { displaced, displacedParent: path.join(displaced, 'memory') };
}
function linkDirectory(target, link) {
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}
function moveAnchorToAlias(f) {
  const displaced = path.join(f.caseRoot, 'anchor-displaced');
  fs.renameSync(f.anchor, displaced);
  linkDirectory(displaced, f.anchor);
  return { displaced, displacedParent: path.join(displaced, 'memory') };
}
function stableAliasFixture() {
  const caseRoot = path.join(root, `case-${++seq}`);
  const realAnchor = path.join(caseRoot, 'real-anchor');
  const anchor = path.join(caseRoot, 'anchor');
  fs.mkdirSync(path.join(realAnchor, 'memory'), { recursive: true });
  linkDirectory(realAnchor, anchor);
  const parent = path.join(anchor, 'memory');
  return { caseRoot, anchor, parent, target: path.join(parent, 'target.txt'), realAnchor };
}
function expectChanged(fn) {
  let error = null;
  try { fn(); } catch (e) { error = e; }
  assert(error, 'expected E_OUTPUT_CHANGED');
  assert.strictEqual(error.code, 'E_OUTPUT_CHANGED', error.stack || error.message);
  return error;
}

try {
  test('ancestor replacement before recheck is rejected', () => {
    const f = fixture();
    fs.writeFileSync(f.target, 'before\n');
    const snap = captureMemoryOutput(f.target);
    const moved = moveAnchor(f);
    fs.writeFileSync(f.target, 'replacement\n');
    expectChanged(() => assertMemoryOutputCurrent(snap, f.target));
    assert.strictEqual(fs.readFileSync(f.target, 'utf8'), 'replacement\n');
    assert.strictEqual(fs.readFileSync(path.join(moved.displacedParent, 'target.txt'), 'utf8'), 'before\n');
  });

  test('stable pre-existing ancestor alias remains usable', () => {
    const f = stableAliasFixture();
    fs.writeFileSync(f.target, 'before\n');
    const snap = captureMemoryOutput(f.target);
    assertMemoryOutputCurrent(snap, f.target);
    assert.strictEqual(fs.readFileSync(path.join(f.realAnchor, 'memory', 'target.txt'), 'utf8'), 'before\n');
  });

  test('ancestor alias rebound to the same underlying parent is rejected', () => {
    const f = fixture();
    fs.writeFileSync(f.target, 'before\n');
    const snap = captureMemoryOutput(f.target);
    const moved = moveAnchorToAlias(f);
    expectChanged(() => assertMemoryOutputCurrent(snap, f.target));
    assert.strictEqual(fs.readFileSync(f.target, 'utf8'), 'before\n');
    assert.strictEqual(fs.readFileSync(path.join(moved.displacedParent, 'target.txt'), 'utf8'), 'before\n');
  });

  test('absent snapshot detects ancestor alias rebound', () => {
    const f = fixture();
    const snap = captureMemoryOutput(f.target);
    moveAnchorToAlias(f);
    expectChanged(() => assertMemoryOutputCurrent(snap, f.target));
    assert.strictEqual(fs.existsSync(f.target), false);
  });

  test('final-window ancestor alias rebound is not reported as successful publication', () => {
    const f = fixture();
    const snap = captureMemoryOutput(f.target);
    const originalLink = fs.linkSync;
    let moved = null;
    let fired = false;
    fs.linkSync = function (from, to) {
      if (!fired && path.resolve(to) === path.resolve(f.target) && path.basename(String(from)).startsWith('.target.txt.publish-')) {
        fired = true;
        moved = moveAnchorToAlias(f);
      }
      return originalLink.apply(this, arguments);
    };
    let error = null;
    try { publishMemoryOutput(snap, f.target, 'ours\n'); }
    catch (e) { error = e; }
    finally { fs.linkSync = originalLink; }
    assert(error, 'expected post-publication ancestor resolution failure');
    assert.strictEqual(error.code, 'E_OUTPUT_CHANGED');
    assert.strictEqual(error.outputMutationStarted, true);
    assert.strictEqual(fs.readFileSync(f.target, 'utf8'), 'ours\n');
    assert.strictEqual(fs.readFileSync(path.join(moved.displacedParent, 'target.txt'), 'utf8'), 'ours\n');
  });

  test('absent publication ancestor swap never overwrites replacement target', () => {
    const f = fixture();
    const snap = captureMemoryOutput(f.target);
    const originalLink = fs.linkSync;
    let moved = null;
    let fired = false;
    fs.linkSync = function (from, to) {
      if (!fired && path.resolve(to) === path.resolve(f.target) && path.basename(String(from)).startsWith('.target.txt.publish-')) {
        fired = true;
        moved = moveAnchor(f);
        fs.writeFileSync(f.target, 'external-winner\n');
      }
      return originalLink.apply(this, arguments);
    };
    let error;
    try { publishMemoryOutput(snap, f.target, 'ours\n'); }
    catch (e) { error = e; }
    finally { fs.linkSync = originalLink; }
    assert(error, 'expected publication failure');
    assert.strictEqual(error.code, 'E_OUTPUT_CHANGED');
    assert.strictEqual(fs.readFileSync(f.target, 'utf8'), 'external-winner\n');
    const leftovers = fs.readdirSync(moved.displacedParent).filter(name => name.startsWith('.target.txt.publish-'));
    assert.strictEqual(leftovers.length, 1, `expected displaced prepared file, got ${leftovers.join(',')}`);
    const orphan = path.join(moved.displacedParent, leftovers[0]);
    if (process.platform === 'win32') {
      assert.strictEqual(fs.readFileSync(orphan, 'utf8'), 'ours\n', 'Windows limitation evidence changed');
      assert.notStrictEqual(error.preparedBytesScrubbed, true);
    } else {
      assert.strictEqual(fs.statSync(orphan).size, 0, 'POSIX orphaned prepared bytes were not scrubbed');
      assert.strictEqual(error.preparedBytesScrubbed, true);
    }
  });

  test('absent publication ancestor swap without winner still cannot publish through stale path', () => {
    const f = fixture();
    const snap = captureMemoryOutput(f.target);
    const originalLink = fs.linkSync;
    let moved = null;
    let fired = false;
    fs.linkSync = function (from, to) {
      if (!fired && path.resolve(to) === path.resolve(f.target) && path.basename(String(from)).startsWith('.target.txt.publish-')) {
        fired = true;
        moved = moveAnchor(f);
      }
      return originalLink.apply(this, arguments);
    };
    let error;
    try { publishMemoryOutput(snap, f.target, 'ours\n'); }
    catch (e) { error = e; }
    finally { fs.linkSync = originalLink; }
    assert(error, 'expected publication failure');
    assert.strictEqual(error.code, 'E_OUTPUT_CHANGED');
    assert.strictEqual(fs.existsSync(f.target), false, 'new ancestor unexpectedly received target');
    const leftovers = fs.readdirSync(moved.displacedParent).filter(name => name.startsWith('.target.txt.publish-'));
    assert.strictEqual(leftovers.length, 1);
    const orphan = path.join(moved.displacedParent, leftovers[0]);
    if (process.platform === 'win32') {
      assert.strictEqual(fs.readFileSync(orphan, 'utf8'), 'ours\n', 'Windows limitation evidence changed');
      assert.notStrictEqual(error.preparedBytesScrubbed, true);
    } else {
      assert.strictEqual(fs.statSync(orphan).size, 0, 'POSIX orphaned prepared bytes were not scrubbed');
      assert.strictEqual(error.preparedBytesScrubbed, true);
    }
  });
} catch (error) {
  results.push({ name: 'setup', ok: false, error: error.message });
  console.error(error.stack || error.message);
}

const passed = results.filter(result => result.ok).length;
fs.writeFileSync(path.join(root, 'results.json'), JSON.stringify({
  node: process.version,
  platform: process.platform,
  root,
  passed,
  total: results.length,
  results,
}, null, 2) + '\n');
console.log(`memory output parent race: ${passed}/${results.length}; Evidence: ${root}`);
if (passed !== results.length || results.length !== 7) process.exitCode = 1;
