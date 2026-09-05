#!/usr/bin/env node
'use strict';

// T-0090: run the three real selftest bodies that leaked native Windows EPERM
// cleanup failures. Healthy runs use the actual writers, heartbeat, and rmSync.
// Fault controls model an exhausted cleanup error, not a successful no-op delete.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CLI = require.resolve('../bin/leerness.js');
const sources = [__filename, CLI, ...['runtime-layout', 'runtime-writes', 'workspace-dir']
  .map(name => require.resolve(`../lib/${name}.js`))];
const signature = file => [crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  fs.statSync(file, { bigint: true }).mtimeNs.toString()];
const sourceBefore = sources.map(signature);
const tempParent = fs.realpathSync.native(os.tmpdir());
const arena = fs.mkdtempSync(path.join(tempParent, 'leerness-selftest-cleanup-'));
const fixtures = path.join(arena, 'fixtures');
const environment = { ...process.env };
const originalTmpdir = os.tmpdir;
const cleanupOptions = { recursive: true, force: true };
const waitCell = new Int32Array(new SharedArrayBuffer(4));
let total = 0;
let failed = 0;

const specifications = [
  { label: 'anchors-redraft', prefix: '__leerness_anchor_redraft_', match: name => name.startsWith('anchors draft (') },
  { label: 'next-action', prefix: '__leerness_next_action_', match: name => name.startsWith('next-action 자동 제안 실행 가능성 (') },
  { label: 'add-json', prefix: '__leerness_addjson_', match: name => name.includes('(UR-0101): action 명령') },
];

function check(name, fn) {
  total++;
  try { fn(); process.stdout.write(`ok - ${name}\n`); }
  catch (error) { failed++; process.stderr.write(`not ok - ${name}: ${error.stack || error}\n`); }
}

function emptyFixtures() {
  assert.deepStrictEqual(fs.readdirSync(fixtures), [], 'selftest left temporary fixtures behind');
}

function ownedFixture(root, prefix) {
  assert.strictEqual(path.dirname(root), fixtures, 'cleanup target escaped the fixture parent');
  assert(path.basename(root).startsWith(prefix), 'unexpected selftest fixture prefix');
  assert.strictEqual(fs.realpathSync.native(root), root, 'cleanup target is not canonical');
}

// Harness teardown only: verdicts inspect leftovers before this runs. Do not
// rely on native retry options, which differ between supported Node versions.
function removeOwned(root) {
  const deadline = Date.now() + 5000;
  for (;;) {
    try { return fs.rmSync(root, cleanupOptions); }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code) || Date.now() >= deadline) throw error;
      Atomics.wait(waitCell, 0, 0, 25);
    }
  }
}

function persistentCleanupDenial(specification, testCase) {
  emptyFixtures();
  const originalMkdtemp = fs.mkdtempSync;
  const originalRm = fs.rmSync;
  const originalWait = Atomics.wait;
  const fault = Object.assign(new Error('Persistent owned-fixture cleanup denial'), { code: 'EPERM', syscall: 'rm' });
  let target;
  let attempts = 0;
  const attemptTimes = [];
  const waits = [];
  let caught;
  fs.mkdtempSync = function (prefix, ...args) {
    const result = originalMkdtemp.call(this, prefix, ...args);
    if (path.dirname(result) === fixtures && path.basename(result).startsWith(specification.prefix)) {
      assert.strictEqual(target, undefined, 'selftest created multiple matching fixtures');
      ownedFixture(result, specification.prefix);
      target = result;
    }
    return result;
  };
  fs.rmSync = function (file, options) {
    if (target && path.resolve(String(file)) === target) {
      attempts++;
      attemptTimes.push(performance.now());
      assert.strictEqual(options.recursive, true, 'owned cleanup must remain recursive');
      assert.strictEqual(options.force, true, 'owned cleanup must retain force semantics');
      assert(fs.readdirSync(target).length > 0, 'fault did not reach a populated real fixture');
      fault.path = target;
      throw fault; // every attempt remains denied; never silently delete it
    }
    return originalRm.apply(this, arguments);
  };
  Atomics.wait = function (buffer, index, expected, timeout) {
    const result = originalWait.apply(this, arguments);
    if (attempts > 0) waits.push({ timeout, result });
    return result;
  };
  try {
    try { testCase.run(); } catch (error) { caught = error; }
    assert.strictEqual(caught, fault, 'selftest swallowed an exhausted cleanup failure');
    assert(attempts >= 2 && attempts <= 100, 'persistent cleanup did not retry within a bounded attempt count');
    assert(attemptTimes.at(-1) - attemptTimes[0] >= 100, 'cleanup retries did not actually wait');
    assert(waits.length > 0 && waits.every(wait => wait.timeout > 0 && wait.result === 'timed-out'),
      'cleanup did not perform real bounded Atomics waits after the injected denial');
    assert(target && fs.existsSync(target), 'fault control did not retain a real owned fixture');
  } finally {
    fs.mkdtempSync = originalMkdtemp;
    fs.rmSync = originalRm;
    Atomics.wait = originalWait;
    if (target && fs.existsSync(target)) {
      ownedFixture(target, specification.prefix);
      removeOwned(target);
    }
  }
  emptyFixtures();
}

try {
  fs.mkdirSync(fixtures);
  // Match the relevant e2e environment without importing/running the e2e suite.
  Object.assign(process.env, { LEERNESS_OFFLINE: '1', LC_ALL: '', LC_CTYPE: '', LANG: '',
    LANGUAGE: 'ko', LEERNESS_NO_AUTO_ROADMAP: '1', TMPDIR: fixtures, TEMP: fixtures, TMP: fixtures,
    // Node 26's own compile cache is not a selftest fixture. Route it separately
    // inside our arena, keeping the fixture-directory emptiness check exact.
    NODE_COMPILE_CACHE: path.join(arena, 'node-compile-cache') });
  for (const name of Object.keys(process.env)) {
    if (/^GIT_CONFIG_(GLOBAL|SYSTEM)$/i.test(name)) delete process.env[name];
  }
  for (const kind of ['GLOBAL', 'SYSTEM']) {
    const file = path.join(arena, `empty-${kind.toLowerCase()}.gitconfig`);
    fs.writeFileSync(file, '');
    process.env[`GIT_CONFIG_${kind}`] = file;
  }
  os.tmpdir = () => fixtures;
  const available = require(CLI)._selfTestCases();
  const selected = specifications.map(specification => {
    const matches = available.filter(testCase => specification.match(testCase.name));
    assert.strictEqual(matches.length, 1, `ambiguous selftest selection: ${specification.label}`);
    return { specification, testCase: matches[0] };
  });
  for (let round = 1; round <= 2; round++) {
    for (const { specification, testCase } of selected) {
      check(`real ${specification.label} cleanup, round ${round}`, () => {
        emptyFixtures();
        assert.strictEqual(testCase.run(), true, 'actual selftest body failed');
        emptyFixtures();
      });
    }
  }
  for (const { specification, testCase } of selected) {
    check(`persistent ${specification.label} cleanup failure propagates`, () => persistentCleanupDenial(specification, testCase));
  }
} finally {
  os.tmpdir = originalTmpdir;
  for (const name of Object.keys(process.env)) if (!(name in environment)) delete process.env[name];
  Object.assign(process.env, environment);
  assert.strictEqual(path.dirname(arena), tempParent, 'unsafe arena cleanup parent');
  assert(path.basename(arena).startsWith('leerness-selftest-cleanup-'), 'unsafe arena cleanup prefix');
  assert.strictEqual(fs.realpathSync.native(arena), arena, 'unsafe arena cleanup target');
  try { removeOwned(arena); }
  finally { assert.deepStrictEqual(sources.map(signature), sourceBefore, 'source bytes or mtimes changed during probe'); }
}

process.stdout.write(`SELFTEST_CLEANUP ${total - failed}/${total} ${failed ? 'FAIL' : 'PASS'}\n`);
if (failed) process.exitCode = 1;
