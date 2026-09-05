#!/usr/bin/env node
'use strict';

// Snapshot selection must preserve the resolver's decisions and diagnostics
// while adding no filesystem calls, writes, or ambient environment dependency.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('../lib/workspace-dir');

const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-workspace-selection-'));
const canonical = W.CANONICAL_WORKSPACE_DIR;
const legacy = W.LEGACY_WORKSPACE_DIR;
let total = 0;
let failed = 0;
let fixtureCount = 0;

const check = (label, fn) => {
  total += 1;
  try {
    fn();
    process.stdout.write(`ok - ${label}\n`);
  } catch (error) {
    failed += 1;
    process.stderr.write(`not ok - ${label}: ${error.stack || error.message}\n`);
  }
};

const fixture = (entries = {}) => {
  const root = path.join(arena, `project-${++fixtureCount}`);
  fs.mkdirSync(root);
  for (const [relative, content] of Object.entries(entries)) {
    const file = path.join(root, relative);
    if (content === null) fs.mkdirSync(file, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf8');
    }
  }
  return root;
};

const snapshot = root => {
  const rows = [];
  const visit = (file, relative) => {
    const stat = fs.lstatSync(file, { bigint: true });
    const meta = [relative, stat.mode.toString(), stat.size.toString(), stat.mtimeNs.toString()];
    if (stat.isSymbolicLink()) rows.push([...meta, 'link', fs.readlinkSync(file)]);
    else if (stat.isDirectory()) {
      rows.push([...meta, 'directory']);
      for (const child of fs.readdirSync(file).sort()) visit(path.join(file, child), `${relative}/${child}`);
    } else rows.push([...meta, 'file', crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
  };
  visit(root, '.');
  return JSON.stringify(rows);
};

const outcome = fn => {
  try { return { selected: fn() }; }
  catch (error) {
    return { name: error.name, code: error.code, message: error.message,
      ...Object.fromEntries(['root', 'file', 'legacy', 'canonical', 'value']
        .filter(key => Object.prototype.hasOwnProperty.call(error, key)).map(key => [key, error[key]])) };
  }
};

const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

const sameSelection = (root, envValue, expected) => {
  const before = snapshot(root);
  const state = freeze(W.inspectWorkspace(root));
  const selected = outcome(() => W.selectWorkspaceDirName(state, envValue));
  const resolved = outcome(() => W.resolveWorkspaceDirName(root, { envValue }));
  assert.deepStrictEqual(selected, expected);
  assert.deepStrictEqual(resolved, expected);
  assert.strictEqual(snapshot(root), before, 'inspection changed bytes or metadata');
  return state;
};

const directoryError = (root, name, symlink = false) => ({
  name: 'WorkspaceDirectoryError',
  code: symlink ? 'E_WORKSPACE_DIR_SYMLINK' : 'E_WORKSPACE_DIR_INVALID',
  message: symlink
    ? `workspace directory must not be a symbolic link or junction: ${path.join(root, name)}`
    : `workspace path is not a directory: ${path.join(root, name)}`,
  root: path.resolve(root), file: path.join(root, name),
});

const conflictError = root => ({
  name: 'WorkspaceDirectoryError', code: 'E_WORKSPACE_DIR_CONFLICT',
  message: `both ${legacy} and ${canonical} contain live workspace files`,
  root: path.resolve(root), legacy: path.join(root, legacy), canonical: path.join(root, canonical),
});

const withEnv = (value, fn) => {
  const previous = process.env.LEERNESS_WORKSPACE_DIR;
  if (value == null) delete process.env.LEERNESS_WORKSPACE_DIR;
  else process.env.LEERNESS_WORKSPACE_DIR = value;
  try { return fn(); }
  finally {
    if (previous === undefined) delete process.env.LEERNESS_WORKSPACE_DIR;
    else process.env.LEERNESS_WORKSPACE_DIR = previous;
  }
};

try {
  const scenarios = [
    ['canonical marker', { [`${canonical}/HARNESS_VERSION`]: '1.36.185\n' }, canonical],
    ['legacy marker', { [`${legacy}/HARNESS_VERSION`]: '1.36.161\n' }, legacy],
    ['empty project', {}, canonical],
    ['two empty directories prefer canonical', { [canonical]: null, [legacy]: null }, canonical],
    ['empty legacy directory', { [legacy]: null }, legacy],
    ['foreign canonical retains default fallback', { [`${canonical}/unrelated.txt`]: 'keep\n' }, canonical],
    ['foreign canonical yields to empty legacy', { [`${canonical}/unrelated.txt`]: 'keep\n', [legacy]: null }, legacy],
    ['canonical substrate yields to live legacy', { [`${canonical}/state.json`]: '{}\n', [`${legacy}/guideline.md`]: '# Keep\n' }, legacy],
    ['canonical marker wins over empty legacy', { [`${canonical}/manifest.json`]: '{}\n', [legacy]: null }, canonical],
    ['corrupt marker content is not parsed by topology inspection', { [`${canonical}/manifest.json`]: '{broken' }, canonical],
  ];
  for (const [label, entries, selected] of scenarios) {
    check(`${label}: resolver and snapshot selector agree without writes`, () => {
      sameSelection(fixture(entries), null, { selected });
    });
  }

  const conflictRoot = fixture({ [`${canonical}/HARNESS_VERSION`]: '1\n', [`${legacy}/HARNESS_VERSION`]: '2\n' });
  check('dual-live state preserves the exact conflict error', () => sameSelection(conflictRoot, null, conflictError(conflictRoot)));
  check('forced selection cannot bypass a dual-live conflict', () => sameSelection(conflictRoot, canonical, conflictError(conflictRoot)));
  check('migration markers do not turn conflicting state into an authoritative copy', () => {
    const root = fixture({ [`${canonical}/HARNESS_VERSION`]: '1\n', [`${canonical}/MIGRATED_FROM_HARNESS`]: 'previous migration\n', [`${legacy}/HARNESS_VERSION`]: '2\n' });
    sameSelection(root, null, conflictError(root));
  });
  check('invalid override retains its priority over workspace conflict', () => {
    sameSelection(conflictRoot, 'other', { name: 'WorkspaceDirectoryError', code: 'E_WORKSPACE_DIR_INVALID',
      message: `LEERNESS_WORKSPACE_DIR must be ${canonical} or ${legacy}; got: other`, value: 'other' });
  });

  for (const selected of [canonical, legacy]) {
    check(`existing ${selected} can be selected explicitly`, () => {
      const other = selected === canonical ? legacy : canonical;
      const root = fixture({ [selected]: null, [`${other}/HARNESS_VERSION`]: '1\n' });
      sameSelection(root, selected, { selected });
      sameSelection(root, ` ${selected} `, { selected });
    });
    check(`missing forced ${selected} preserves its error fields`, () => {
      const root = fixture();
      sameSelection(root, selected, { name: 'WorkspaceDirectoryError', code: 'E_WORKSPACE_DIR_MISSING',
        message: `configured workspace directory does not exist: ${path.join(root, selected)}`,
        root, value: selected });
    });
    check(`a file at ${selected} is not accepted as a workspace`, () => {
      const root = fixture({ [selected]: 'not a directory\n' });
      sameSelection(root, null, directoryError(root, selected));
    });
    check(`a link at ${selected} is rejected without following its target`, () => {
      const root = fixture();
      const target = fixture({ 'keep.txt': 'outside workspace\n' });
      fs.symlinkSync(target, path.join(root, selected), process.platform === 'win32' ? 'junction' : 'dir');
      const beforeTarget = snapshot(target);
      sameSelection(root, null, directoryError(root, selected, true));
      assert.strictEqual(snapshot(target), beforeTarget);
    });
  }

  const envRoot = fixture({ [canonical]: null, [legacy]: null });
  check('public resolver preserves explicit-option precedence over ambient environment', () => {
    withEnv(legacy, () => {
      assert.strictEqual(W.resolveWorkspaceDirName(envRoot), legacy);
      assert.strictEqual(W.resolveWorkspaceDirName(envRoot, { envValue: undefined }), legacy);
      assert.strictEqual(W.resolveWorkspaceDirName(envRoot, { envValue: canonical }), canonical);
      assert.strictEqual(W.resolveWorkspaceDirName(envRoot, { envValue: null }), canonical);
      assert.strictEqual(W.resolveWorkspaceDirName(envRoot, { envValue: '' }), canonical);
    });
  });
  check('pure selector does not read ambient environment', () => {
    const state = freeze(W.inspectWorkspace(envRoot));
    withEnv('invalid-ambient-override', () => {
      assert.strictEqual(W.selectWorkspaceDirName(state), canonical);
      assert.strictEqual(W.selectWorkspaceDirName(state, legacy), legacy);
    });
  });
  check('frozen snapshot selection adds zero filesystem calls', () => {
    const state = freeze(W.inspectWorkspace(envRoot));
    const original = new Map();
    const calls = [];
    // Intercept every sync fs primitive, including reads and writes, after
    // acquiring the snapshot. Restore before assertions or fixture cleanup.
    for (const key of Object.keys(fs).filter(key => /Sync$/.test(key) && typeof fs[key] === 'function')) {
      original.set(key, fs[key]);
      fs[key] = (...args) => { calls.push(key); throw new Error(`unexpected fs.${key}`); };
    }
    let selected;
    try { selected = W.selectWorkspaceDirName(state, null); }
    finally { for (const [key, value] of original) fs[key] = value; }
    assert.strictEqual(selected, canonical);
    assert.deepStrictEqual(calls, []);
  });
  check('public resolver inspects each workspace directory exactly once', () => {
    const originalLstat = fs.lstatSync;
    const originalReadDir = fs.readdirSync;
    const lstatCalls = [];
    const readDirCalls = [];
    fs.lstatSync = function (...args) { lstatCalls.push(path.resolve(String(args[0]))); return originalLstat.apply(this, args); };
    fs.readdirSync = function (...args) { readDirCalls.push(path.resolve(String(args[0]))); return originalReadDir.apply(this, args); };
    let selected;
    try { selected = W.resolveWorkspaceDirName(envRoot, { envValue: null }); }
    finally { fs.lstatSync = originalLstat; fs.readdirSync = originalReadDir; }
    assert.strictEqual(selected, canonical);
    const expected = [path.join(envRoot, legacy), path.join(envRoot, canonical)];
    assert.deepStrictEqual(lstatCalls, expected);
    assert.deepStrictEqual(readDirCalls, expected);
  });
} finally {
  const cleanupRoot = path.resolve(arena);
  const temporaryRoot = path.resolve(os.tmpdir());
  if (path.dirname(cleanupRoot) !== temporaryRoot || !path.basename(cleanupRoot).startsWith('leerness-workspace-selection-')) {
    throw new Error(`refusing cleanup outside the probe arena: ${cleanupRoot}`);
  }
  fs.rmSync(cleanupRoot, { recursive: true, force: true });
}

process.stdout.write(`WORKSPACE_SELECTION_PROBE ${total - failed}/${total} passed\n`);
process.exitCode = failed ? 1 : 0;
