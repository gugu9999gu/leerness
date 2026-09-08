#!/usr/bin/env node
'use strict';

// Functional contract checks using only disposable, locally owned fixtures.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const vm = require('vm');
const { inspectStores } = require('../lib/store-diagnostics');
const { _shouldDrop } = require('../lib/git');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const tempRoot = fs.realpathSync.native(os.tmpdir());
const fixture = fs.mkdtempSync(path.join(tempRoot, 'leerness-store-diagnostic-'));
const fixtureIdentity = fs.realpathSync.native(fixture);
const LIMIT = 1024 * 1024;
const PRIVATE = 'synthetic-private-fixture-content';
let passed = 0;

function check(label, action) {
  action();
  passed++;
  console.log(`PASS ${label}`);
}

function project(name, files = {}) {
  const root = path.join(fixture, name);
  fs.mkdirSync(path.join(root, '.leerness'), { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, '.leerness', file), content);
  }
  return root;
}

function snapshot(root) {
  const rows = {};
  function visit(file, relative) {
    const stat = fs.lstatSync(file);
    const row = { mtimeMs: stat.mtimeMs, kind: stat.isDirectory() ? 'dir' : 'file' };
    if (stat.isFile()) row.sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    rows[relative] = row;
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name), `${relative}/${name}`);
  }
  visit(root, '.');
  return rows;
}

function inspect(root) {
  const before = snapshot(fixture);
  const result = inspectStores(root);
  assert.strictEqual(result.schema, 'leerness.store-diagnostics/v1');
  assert.strictEqual(result.readOnly, true);
  assert.strictEqual(result.writesPerformed, false);
  assert.strictEqual(typeof result.ok, 'boolean');
  assert.deepStrictEqual(result.stores.map(row => row.name).sort(), ['decisions', 'lessons', 'roles']);
  assert.deepStrictEqual(snapshot(fixture), before, 'inspection must preserve file set, hashes and mtimes');
  assert(!JSON.stringify(result).includes(PRIVATE), 'raw fixture content must not appear in diagnostics');
  return result;
}

function row(report, name) { return report.stores.find(store => store.name === name); }
const legacy = {
  'decisions.md': `# Decisions\n\n### 2026-09-08 — Fixture\n- Decision: ${PRIVATE}\n- Reason: test\n`,
  'lessons.md': `# Lessons\n\n### 2026-09-08\n- Lesson: ${PRIVATE}\n- Tag: fixture\n`,
};

try {
  function fakeRead(mode) {
    const workspace = path.join(fixture, 'in-memory-workspace');
    const regular = { dev: 1n, ino: 2n, mode: 1n, size: 2n, nlink: 1n,
      mtimeNs: 1n, ctimeNs: 1n, isFile: () => true, isSymbolicLink: () => false };
    const parent = { dev: 1n, ino: 1n, mode: 2n, isDirectory: () => true, isSymbolicLink: () => false };
    const metrics = { requested: 0, consumed: 0, closes: 0 };
    const fakeFs = {
      constants: fs.constants,
      lstatSync: file => file === workspace ? parent : regular,
      openSync: () => 9,
      fstatSync: () => regular,
      readSync(fd, buffer, offset, length) {
        assert.strictEqual(fd, 9);
        metrics.requested += length;
        assert(metrics.requested <= LIMIT + 1, 'actual I/O requests must remain bounded');
        if (mode === 'denied') throw Object.assign(new Error('synthetic read failure'), { code: 'EACCES' });
        buffer.fill(0x20, offset, offset + length);
        metrics.consumed += length;
        return length;
      },
      closeSync(fd) { assert.strictEqual(fd, 9); metrics.closes++; },
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../lib/store-diagnostic-read.js'), 'utf8'), {
      module, Buffer, require: name => name === 'fs' ? fakeFs : require(name),
    }, { filename: 'store-diagnostic-read.js', timeout: 2000 });
    assert.strictEqual(module.exports.MAX_BYTES, LIMIT);
    return { result: module.exports.readStoreFile(workspace, 'decisions.json'), metrics };
  }
  check('in-memory continuous reader stops at the actual byte limit despite small metadata', () => {
    const { result, metrics } = fakeRead('continuous');
    assert.strictEqual(result.status, 'unsupported');
    assert.strictEqual(result.reasonCode, 'size_limit');
    assert.strictEqual(result.bytesRead, LIMIT + 1);
    assert.strictEqual(metrics.requested, LIMIT + 1);
    assert.strictEqual(metrics.consumed, LIMIT + 1);
    assert.strictEqual(metrics.closes, 1);
  });
  check('in-memory read failure is unreadable and closes its descriptor once', () => {
    const { result, metrics } = fakeRead('denied');
    assert.strictEqual(result.status, 'unreadable');
    assert.strictEqual(result.reasonCode, 'read_failed');
    assert.strictEqual(result.bytesRead, 0);
    assert.strictEqual(metrics.consumed, 0);
    assert.strictEqual(metrics.closes, 1);
  });
  check('absent optional stores are missing, not invented empty canonical arrays', () => {
    const report = inspect(project('absent'));
    assert.strictEqual(report.ok, true);
    for (const store of report.stores) {
      assert.strictEqual(store.canonical.status, 'missing');
      assert.strictEqual(store.effectiveSource, 'none');
      assert.strictEqual(store.itemCount, null);
    }
  });
  const valid = project('valid target 한글', {
    'decisions.json': JSON.stringify([{ title: PRIVATE }]),
    'lessons.json': '[]',
    'agent-roles.json': JSON.stringify({ schemaVersion: 1, roles: { implementer: { provider: 'codex', model: 'fixture-model' } } }),
    ...legacy,
  });
  check('valid canonical stores take precedence without reading fallback', () => {
    const report = inspect(valid);
    assert.strictEqual(report.ok, true);
    for (const store of report.stores) {
      assert.strictEqual(store.canonical.status, 'valid');
      assert.strictEqual(store.canonical.syntaxValid, true);
      assert.strictEqual(store.canonical.shapeValid, true);
      assert.strictEqual(store.effectiveSource, 'canonical');
      assert.strictEqual(store.fallback.attempted, false);
      assert.strictEqual(store.fallback.used, false);
      assert(store.canonical.bytesRead > 0);
    }
    assert.strictEqual(row(report, 'decisions').itemCount, 1);
    assert.strictEqual(row(report, 'lessons').itemCount, 0);
    assert.strictEqual(row(report, 'roles').itemCount, 1);
    assert.strictEqual(row(report, 'decisions').canonical.itemsValid, null);
    assert.strictEqual(row(report, 'lessons').canonical.itemsValid, null);
    assert.strictEqual(row(report, 'roles').canonical.itemsValid, true);
  });
  check('memory array shape acceptance does not claim item validation', () => {
    const report = inspect(project('array shape only', { 'decisions.json': '[null,1,"fixture"]' }));
    assert.strictEqual(report.ok, true);
    assert.strictEqual(row(report, 'decisions').canonical.itemsValid, null);
    assert.strictEqual(row(report, 'decisions').itemCount, 3);
  });
  for (const [label, content, status, fallbackAllowed] of [
    ['invalid JSON', '{', 'invalid_json', true],
    ['object shape', '{}', 'invalid_shape', true],
    ['blank', '   \n', 'invalid_json', true],
    ['oversize', ' '.repeat(LIMIT + 100), 'unsupported', false],
    ['invalid UTF8', Buffer.from([0xc3, 0x28]), 'unsupported', false],
  ]) {
    check(`${label}: explicit canonical failure remains visible with legacy files present`, () => {
      const report = inspect(project(label, { 'decisions.json': content, 'lessons.json': content, ...legacy }));
      assert.strictEqual(report.ok, false);
      for (const name of ['decisions', 'lessons']) {
        const store = row(report, name);
        assert.strictEqual(store.canonical.status, status);
        assert.strictEqual(typeof store.canonical.reasonCode, 'string');
        assert(store.canonical.bytesRead <= LIMIT + 1);
        assert.strictEqual(store.fallback.attempted, fallbackAllowed);
        assert.strictEqual(store.fallback.used, fallbackAllowed);
        assert.strictEqual(store.effectiveSource, fallbackAllowed ? 'legacy_markdown' : 'none');
        assert.strictEqual(store.itemCount, fallbackAllowed ? 1 : null);
      }
    });
  }
  check('missing canonical files can report legacy counts without backfill', () => {
    const report = inspect(project('legacy only', legacy));
    assert.strictEqual(report.ok, true);
    for (const name of ['decisions', 'lessons']) {
      const store = row(report, name);
      assert.strictEqual(store.canonical.status, 'missing');
      assert.strictEqual(store.fallback.status, 'valid');
      assert.strictEqual(store.fallback.used, true);
      assert.strictEqual(store.itemCount, 1);
    }
  });
  check('invalid role definitions are not accepted as valid assignments', () => {
    const report = inspect(project('invalid roles', { 'agent-roles.json': JSON.stringify({ schemaVersion: 1, roles: { reviewer: { provider: 42 } } }) }));
    assert.strictEqual(report.ok, false);
    const store = row(report, 'roles');
    assert.strictEqual(store.canonical.status, 'invalid_shape');
    assert.strictEqual(store.canonical.syntaxValid, true);
    assert.strictEqual(store.fallback.attempted, false);
    assert.strictEqual(store.effectiveSource, 'none');
    assert.strictEqual(store.itemCount, null);
  });
  check('invalid role schema versions remain explicit failures', () => {
    const report = inspect(project('role schema', { 'agent-roles.json': '{"schemaVersion":999,"roles":{}}' }));
    assert.strictEqual(report.ok, false);
    assert.strictEqual(row(report, 'roles').canonical.status, 'invalid_shape');
  });

  const cwd = project('unrelated cwd', { 'current-state.md': 'Keep user state.\n', 'manifest.json': '{"language":"ko"}' });
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(LEERNESS_|GIT_CONFIG_|NODE_OPTIONS)/i.test(key) || _shouldDrop(key)) delete env[key];
  env.LEERNESS_LANG = 'en';
  function cli(target, extra = []) {
    return cp.spawnSync(process.execPath, [CLI, 'state', 'stores', target, ...extra, '--json'], { cwd, env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  }
  check('real CLI from unrelated cwd preserves target and cwd file sets, hashes and mtimes', () => {
    const before = snapshot(fixture);
    const result = cli(valid);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(result.stderr, '');
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.schema, 'leerness.store-diagnostics/v1');
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.readOnly, true);
    assert.strictEqual(report.writesPerformed, false);
    assert.strictEqual(row(report, 'decisions').itemCount, 1);
    assert(!result.stdout.includes(PRIVATE));
    assert.deepStrictEqual(snapshot(fixture), before);
  });
  check('real CLI failed diagnostic keeps canonical failure despite successful fallback and writes nothing', () => {
    const target = project('cli invalid', { 'decisions.json': '{', ...legacy });
    const before = snapshot(fixture);
    const result = cli(target);
    assert.strictEqual(result.status, 1, result.stderr || result.stdout);
    assert.strictEqual(result.stderr, '');
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.ok, false);
    assert.strictEqual(row(report, 'decisions').canonical.status, 'invalid_json');
    assert.strictEqual(row(report, 'decisions').fallback.used, true);
    assert(!result.stdout.includes(PRIVATE));
    assert.deepStrictEqual(snapshot(fixture), before);
  });
  for (const [label, args] of [
    ['mutation flag', ['--apply']],
    ['extra positional path', [cwd]],
    ['duplicate explicit path', ['--path', valid, '--path', cwd]],
  ]) {
    check(`real CLI rejects ${label} without writes`, () => {
      const before = snapshot(fixture);
      const result = cli(valid, args);
      assert.strictEqual(result.status, 1, result.stderr || result.stdout);
      assert.strictEqual(result.stderr, '');
      assert.strictEqual(JSON.parse(result.stdout).ok, false);
      assert.deepStrictEqual(snapshot(fixture), before);
    });
  }
  check('explicit --path overrides an unrelated positional root without writes', () => {
    const before = snapshot(fixture);
    const result = cli(cwd, ['--path', valid]);
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    assert.strictEqual(result.stderr, '');
    const report = JSON.parse(result.stdout);
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.projectRoot, fs.realpathSync.native(valid));
    assert.strictEqual(row(report, 'decisions').itemCount, 1);
    assert.deepStrictEqual(snapshot(fixture), before);
  });
  console.log(`store-diagnostic probe: ${passed}/${passed} PASS`);
} finally {
  // Resolve and check the exact allocated directory before recursive removal.
  const resolved = fs.realpathSync.native(fixture);
  assert.strictEqual(resolved, fixtureIdentity);
  assert.strictEqual(path.dirname(resolved), tempRoot);
  assert(path.basename(resolved).startsWith('leerness-store-diagnostic-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
