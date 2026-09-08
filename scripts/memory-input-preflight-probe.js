#!/usr/bin/env node
'use strict';

// Actual CLI regression coverage for canonical array-root admission and preparation
// before domain writes. Not a full item schema, UTF-8/size gate, transaction, or
// lossless archive/restore contract. Fixtures and evidence are retained in owned Temp.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const crypto = require('crypto');

const sourceRoot = path.resolve(__dirname, '..');
const cli = path.join(sourceRoot, 'bin', 'leerness.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-memory-input-preflight-'));
const seed = path.join(temp, 'seed');
const expectedChecks = 91;
const timeoutMs = 120000;
const maxBuffer = 2 * 1024 * 1024;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC)$/i.test(key)));
for (const [key, dir] of Object.entries({ TEMP: 'tmp', TMP: 'tmp', USERPROFILE: 'profile', APPDATA: 'appdata', LOCALAPPDATA: 'localappdata' })) {
  env[key] = path.join(temp, dir);
  fs.mkdirSync(env[key], { recursive: true });
}
Object.assign(env, { LEERNESS_INTERNAL: '1', LEERNESS_NO_BANNER: '1',
  LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_OFFLINE: '1' });
const results = [];
const executions = [];
const startedAt = new Date().toISOString();
const domainNames = ['decisions.json', 'decisions.md', 'decisions.archive.md',
  'lessons.json', 'lessons.md', 'lessons.archive.md', 'task-log.md', 'review-evidence.md',
  'progress-tracker.md', 'current-state.md', 'session-handoff.md'];
const sourceNames = ['bin/leerness.js', 'lib/pure-utils.js', 'lib/migrate.js',
  'package.json', 'scripts/memory-guard-order-probe.js'];
function fileSnapshot(file) {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file, { bigint: true });
  return { hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    size: String(stat.size), mtimeNs: String(stat.mtimeNs) };
}
const sourceSnapshot = () => Object.fromEntries(sourceNames.map(name => [name, fileSnapshot(path.join(sourceRoot, name))]));
const sourceBefore = sourceSnapshot();
const snapshot = root => Object.fromEntries(domainNames.map(name => [name, fileSnapshot(path.join(root, '.leerness', name))]));
const canonical = (root, surface) => path.join(root, '.leerness', `${surface}.json`);
const items = (root, surface) => JSON.parse(fs.readFileSync(canonical(root, surface), 'utf8'));
let sequence = 0;
function fixture() {
  const root = path.join(temp, `case-${String(++sequence).padStart(3, '0')}`);
  fs.cpSync(seed, root, { recursive: true });
  return root;
}
function run(root, args) {
  const start = Date.now();
  const result = cp.spawnSync(process.execPath, [cli, ...args, '--path', root, '--json'], {
    cwd: root, env, encoding: 'utf8', timeout: timeoutMs, maxBuffer,
  });
  executions.push({ root, args, pid: result.pid, status: result.status, signal: result.signal,
    errorCode: result.error?.code || null, durationMs: Date.now() - start,
    stdout: String(result.stdout || '').slice(0, 12000), stderr: String(result.stderr || '').slice(0, 4000) });
  return result;
}
function requireFinished(result) {
  assert.strictEqual(result.error, undefined, `child error=${result.error?.code}`);
  assert.strictEqual(result.signal, null, `child signal=${result.signal}`);
  assert(Number.isInteger(result.status), `child exit=${result.status}`);
}
function requireSuccess(result) {
  requireFinished(result);
  assert.strictEqual(result.status, 0, `exit=${result.status}: ${(result.stderr || result.stdout || '').slice(-700)}`);
}
function check(name, fn) {
  const entry = { name, ok: false };
  try { fn(entry); entry.ok = true; process.stdout.write(`PASS ${name}\n`); }
  catch (error) { entry.error = error.message; process.stderr.write(`FAIL ${name}: ${error.message}\n`); }
  results.push(entry);
}
function rejectWithoutWrites(entry, root, args, expectedCode, expectedMessage) {
  const before = snapshot(root);
  const result = run(root, args);
  const after = snapshot(root);
  entry.root = root;
  entry.executionIndex = executions.length - 1;
  entry.before = before;
  entry.after = after;
  entry.changedFiles = domainNames.filter(name => JSON.stringify(before[name]) !== JSON.stringify(after[name]));
  requireFinished(result);
  assert(result.status > 0, `expected rejection, exit=${result.status}`);
  const payload = JSON.parse(result.stdout);
  assert.strictEqual(payload.ok, false);
  if (expectedCode) assert.strictEqual(payload.code, expectedCode);
  if (expectedMessage) assert(expectedMessage.test(String(payload.error || '')), `wrong error: ${payload.error}`);
  // Existing unwrapped renderer errors may also print their message to stderr;
  // this probe does not introduce a new renderer error-output contract.
  if (expectedCode) assert.strictEqual(result.stderr, '');
  assert.deepStrictEqual(after, before, `domain changed: ${entry.changedFiles.join(', ')}`);
}
function decoratedEntries(surface) {
  const make = (name, n) => surface === 'decisions'
    ? { date: '2026-01-01', title: name, decision: name, reason: `reason ${n}\nsecond line`, alternatives: null, impact: null,
      extension: { position: n, raw: `unknown ${n}\nkept`, values: [n, null, { keep: true }] } }
    : { date: '2026-01-01', text: `${name}\nsecond line`, tag: `tag ${n}\nsecond line`,
      extension: { position: n, raw: `unknown ${n}\nkept`, values: [n, null, { keep: true }] } };
  return [make('survivor-first', 1), make('survivor-second', 2)];
}

try {
  fs.mkdirSync(seed);
  requireSuccess(run(seed, ['init', seed, '--yes', '--language', 'en', '--no-stale-check']));
  requireSuccess(run(seed, ['decision', 'add', 'active']));
  requireSuccess(run(seed, ['lesson', 'save', 'active']));
  // Both surfaces are completely seeded before any case is copied.
  for (const surface of ['decisions', 'lessons']) {
    const body = surface === 'decisions'
      ? '### 2026-01-01 — archived\n- Decision: archived\n- Reason: retained\n'
      : '### 2026-01-01\n- Lesson: archived\n- Tag: retained\n';
    fs.writeFileSync(path.join(seed, '.leerness', `${surface}.archive.md`),
      `# Archive\n\n## 제거 2026-01-02 (target: "archived")\n\n${body}`);
  }
  for (const surface of ['decisions', 'lessons']) {
    const singular = surface === 'decisions' ? 'decision' : 'lesson';
    const add = surface === 'decisions' ? 'add' : 'save';
    const identity = surface === 'decisions' ? 'title' : 'text';
    const variants = [['new', [singular, add, 'new']], ['duplicate', [singular, add, 'active']],
      ['force', [singular, add, 'active', '--force']], ['drop', [singular, 'drop', 'active']],
      ['restore', ['memory', 'restore', surface, 'archived']]];
    const nonArrays = [['object', { retained: 'not-an-array' }], ['null', null], ['string', 'retained'],
      ['false', false], ['zero', 0], ['empty-string', '']];
    for (const [shape, value] of nonArrays) for (const [name, args] of variants) {
      check(`${surface} root-${shape} ${name}: store_invalid and no domain writes`, entry => {
        const root = fixture();
        fs.writeFileSync(canonical(root, surface), JSON.stringify(value));
        rejectWithoutWrites(entry, root, args, 'store_invalid');
      });
    }
    for (const [name, args] of variants) {
      check(`${surface} syntax-corrupt ${name}: retains store_corrupt`, entry => {
        const root = fixture();
        fs.writeFileSync(canonical(root, surface), '{');
        rejectWithoutWrites(entry, root, args, 'store_corrupt');
      });
    }
    check(`${surface} null item ${add}: renderer failure before canonical write`, entry => {
      const root = fixture();
      fs.writeFileSync(canonical(root, surface), '[null]');
      rejectWithoutWrites(entry, root, [singular, add, 'new'], null, /Cannot read properties of null/i);
    });
    check(`${surface} survivor render failure: no archive or canonical write`, entry => {
      const root = fixture();
      const current = items(root, surface);
      const survivor = decoratedEntries(surface)[0];
      // Selector fields stay normal; only the later projection renderer fails.
      survivor[surface === 'decisions' ? 'reason' : 'tag'] = { toString: null, valueOf: null };
      fs.writeFileSync(canonical(root, surface), JSON.stringify([...current, survivor]));
      rejectWithoutWrites(entry, root, [singular, 'drop', 'active'], null, /Cannot convert object to primitive value/i);
    });
    check(`${surface} valid add retains unknown fields, order and multiline canonical data`, () => {
      const root = fixture();
      const original = [...items(root, surface), ...decoratedEntries(surface)];
      fs.writeFileSync(canonical(root, surface), JSON.stringify(original));
      requireSuccess(run(root, [singular, add, 'new']));
      const after = items(root, surface);
      assert.strictEqual(after.length, original.length + 1);
      assert.deepStrictEqual(after.slice(0, original.length), original);
      assert.strictEqual(after.at(-1)[identity], 'new');
    });
    check(`${surface} valid duplicate keeps domain snapshot`, () => {
      const root = fixture();
      const before = snapshot(root);
      const result = run(root, [singular, add, 'active']);
      requireSuccess(result);
      assert.strictEqual(JSON.parse(result.stdout).skipped, true);
      assert.deepStrictEqual(snapshot(root), before);
    });
    check(`${surface} valid force retains duplicate behavior`, () => {
      const root = fixture();
      requireSuccess(run(root, [singular, add, 'active', '--force']));
      assert.strictEqual(items(root, surface).length, 2);
      assert(items(root, surface).every(item => item[identity] === 'active'));
    });
    check(`${surface} valid drop retains unknown fields, order and multiline survivors`, () => {
      const root = fixture();
      const survivors = decoratedEntries(surface);
      fs.writeFileSync(canonical(root, surface), JSON.stringify([...items(root, surface), ...survivors]));
      requireSuccess(run(root, [singular, 'drop', 'active']));
      assert.deepStrictEqual(items(root, surface), survivors);
      assert(fs.readFileSync(path.join(root, '.leerness', `${surface}.archive.md`), 'utf8').includes('target: "active"'));
    });
    check(`${surface} valid simple drop and restore`, () => {
      const root = fixture();
      requireSuccess(run(root, [singular, 'drop', 'active']));
      assert.strictEqual(items(root, surface).length, 0);
      requireSuccess(run(root, ['memory', 'restore', surface, 'active']));
      assert.strictEqual(items(root, surface).length, 1);
      assert.strictEqual(items(root, surface)[0][identity], 'active');
      assert(!fs.readFileSync(path.join(root, '.leerness', `${surface}.archive.md`), 'utf8').includes('target: "active"'));
    });
    check(`${surface} missing canonical retains legacy fallback`, () => {
      const root = fixture();
      fs.unlinkSync(canonical(root, surface)); // Single file in this probe's owned fixture.
      requireSuccess(run(root, [singular, add, 'new']));
      assert.deepStrictEqual(items(root, surface).map(item => item[identity]), ['active', 'new']);
    });
    check(`${surface} migrate apply backfills missing canonical`, () => {
      const root = fixture();
      const expected = items(root, surface)[0][identity];
      fs.unlinkSync(canonical(root, surface)); // Single file in this probe's owned fixture.
      const result = run(root, ['migrate', 'apply', '--yes']);
      requireSuccess(result);
      assert.strictEqual(JSON.parse(result.stdout).appliedCount, 1);
      assert.deepStrictEqual(items(root, surface).map(item => item[identity]), [expected]);
    });
    check(`${surface} read-only non-array fallback stays available`, () => {
      const root = fixture();
      fs.writeFileSync(canonical(root, surface), '{"retained":"not-an-array"}');
      const before = snapshot(root);
      const result = run(root, [singular, 'list']);
      requireSuccess(result);
      assert.strictEqual(JSON.parse(result.stdout).total, 1);
      assert.deepStrictEqual(snapshot(root), before);
    });
  }
} catch (error) {
  results.push({ name: 'setup', ok: false, error: error.message });
  process.stderr.write(`FAIL setup: ${error.message}\n`);
}
const sourceAfter = sourceSnapshot();
check('product source hash/mtime unchanged during probe', () => assert.deepStrictEqual(sourceAfter, sourceBefore));
const passed = results.filter(result => result.ok).length;
const report = { temp, node: process.version, startedAt, completedAt: new Date().toISOString(),
  timeoutMs, maxBuffer, expectedChecks, passed, total: results.length, cliCalls: executions.length,
  sourceBefore, sourceAfter, results, executions };
fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(`memory input preflight: ${passed}/${results.length} passed\nCLI calls: ${executions.length}\nEvidence: ${temp}\n`);
if (passed !== results.length || results.length !== expectedChecks) process.exitCode = 1;
