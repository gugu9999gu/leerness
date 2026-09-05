#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { gitSpawn, _shouldDrop } = require('../lib/git');
const { LEGACY_WORKSPACE_DIR, CANONICAL_WORKSPACE_DIR } = require('../lib/workspace-dir');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-state-inspect-cli-'));
let passed = 0;

function check(label, run) {
  run(); passed++; console.log(`PASS ${label}`);
}

function snapshot(root) {
  const result = {};
  function visit(file, relative) {
    const stat = fs.lstatSync(file);
    const row = { mtimeMs: stat.mtimeMs, kind: stat.isDirectory() ? 'dir' : 'file' };
    if (stat.isFile()) row.hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (stat.isSymbolicLink()) row.link = fs.readlinkSync(file);
    result[relative] = row;
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name), `${relative}/${name}`);
  }
  visit(root, '.');
  return result;
}

const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(LEERNESS_|GIT_CONFIG_|GIT_CEILING_DIRECTORIES|GIT_DISCOVERY_ACROSS_FILESYSTEM|NODE_OPTIONS)/i.test(key) || _shouldDrop(key)) delete env[key];
}
const config = path.join(fixture, 'empty.gitconfig');
fs.writeFileSync(config, '');
Object.assign(env, { GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: config,
  LEERNESS_LANG: 'en', LEERNESS_SESSION_ID: 'inspect-fixture-session' });

function project(name, workspaceName = CANONICAL_WORKSPACE_DIR) {
  const root = path.join(fixture, name);
  const workspace = path.join(root, workspaceName);
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'HARNESS_VERSION'), '1.0.0\n');
  fs.writeFileSync(path.join(workspace, 'current-state.md'), 'User context must be retained.\n');
  fs.writeFileSync(path.join(workspace, 'manifest.json'), '{"language":"ko"}\n');
  return root;
}

const cwd = project('unrelated cwd', LEGACY_WORKSPACE_DIR);
const target = project('target 한글');
const legacy = project('legacy target', LEGACY_WORKSPACE_DIR);
function run(args, options = {}) {
  return cp.spawnSync(process.execPath, [...(options.nodeArgs || []), CLI, ...args], {
    cwd: options.cwd || cwd, env: { ...env, ...options.env }, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
  });
}
function successful(args, options) {
  const result = run(args, options);
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  assert.strictEqual(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.runtimeActivated, false);
  assert.strictEqual(report.migrationAvailable, false);
  return report;
}

try {
  const init = gitSpawn(['init', target], { env, encoding: 'utf8', timeout: 15000 });
  assert.strictEqual(init.status, 0, init.stderr);
  const before = snapshot(fixture);
  check('default execution enables ordinary bookkeeping but inspect writes no bytes or mtimes', () => {
    assert(!Object.keys(env).some(key => /LEERNESS_(INTERNAL|NO_AUTO_WORKSPACE_MIGRATION|NO_STALE_CHECK)/i.test(key)));
    const report = successful(['state', 'inspect', target, '--json']);
    assert.strictEqual(report.schema, 'leerness.state-inspection/v1');
    assert.strictEqual(report.projectRoot, fs.realpathSync.native(target));
    assert.strictEqual(report.git.linkedWorktree, false);
    assert.deepStrictEqual(snapshot(fixture), before);
  });
  check('explicit --path takes precedence over positional target', () => {
    const report = successful(['state', 'inspect', cwd, `--path=${target}`, '--json']);
    assert.strictEqual(report.projectRoot, fs.realpathSync.native(target));
  });
  check('flags may precede command; omitted target uses cwd', () => {
    const report = successful(['--json', 'state', 'inspect'], { cwd: target });
    assert.strictEqual(report.projectRoot, fs.realpathSync.native(target));
  });
  check('legacy target does not migrate and has explicit non-Git fallback', () => {
    const report = successful(['state', 'inspect', legacy, '--json']);
    assert.strictEqual(report.workspace.selectedName, LEGACY_WORKSPACE_DIR);
    assert.strictEqual(report.git, null);
    assert.strictEqual(report.scopes.commonControl.available, false);
    assert.strictEqual(report.scopes.commonControl.proposedPath, null);
    assert(report.warnings.includes('legacy_workspace_not_migrated'));
    assert.deepStrictEqual(snapshot(fixture), before);
  });

  for (const args of [
    ['state', 'inspect', target, 'extra'],
    ['state', 'inspect', target, '--path', target, '--path', legacy],
    ['state', 'inspect', target, '--path'],
    ['state', 'inspect', '--path='],
    ['state', 'inspect', '--path', '   '],
    ['state', 'inspect', '--path', path.join(fixture, 'missing')],
    ['state', 'inspect', '--path', config],
    ['state', 'inspect', target, '--apply'],
    ['state', 'inspect', target, '--force'],
    ['state', 'inspect', target, '--output=ignored'],
    ['state', 'inspect', target, '--json=false'],
  ]) {
    check(`invalid invocation fails without writes: ${args.slice(2).join(' ')}`, () => {
      const result = run([...args, '--json']);
      assert.strictEqual(result.status, 1, result.stdout);
      assert.strictEqual(JSON.parse(result.stdout).ok, false);
      assert.strictEqual(result.stderr, '');
      assert.deepStrictEqual(snapshot(fixture), before);
    });
  }
  check('English and Korean text explain proposed-only state', () => {
    const english = run(['state', 'inspect', target, '--language', 'en']);
    const korean = run(['state', 'inspect', target, '--language', 'ko']);
    assert.strictEqual(english.status, 0, english.stderr);
    assert.strictEqual(korean.status, 0, korean.stderr);
    assert.match(english.stdout, /runtime NOT activated/);
    assert.match(korean.stdout, /runtime 활성화 안 됨/);
    assert.match(english.stdout, /Common-Control/);
    assert.deepStrictEqual(snapshot(fixture), before);
  });
  check('catalog and both help locales advertise inspection', () => {
    const catalog = run(['commands', '--json']);
    const rows = Object.values(JSON.parse(catalog.stdout).categories).flat();
    assert(rows.some(row => /^state inspect\b/.test(row.cmd)));
    for (const lang of ['en', 'ko']) assert.match(run(['--help', '--language', lang]).stdout, /state inspect \[path\]/);
  });
  check('mutation and permission classifiers do not reinterpret path content', () => {
    const { _cliMutationClass, _requiredTier } = require('../bin/leerness.js');
    assert.strictEqual(_cliMutationClass(['state', 'inspect', 'publish'], 'state'), 'observation-only');
    assert.strictEqual(_cliMutationClass(['state', 'show'], 'state'), 'stateful');
    assert.strictEqual(_cliMutationClass(['state', 'start'], 'state'), 'stateful');
    for (const prefix of ['', 'leerness ', 'npx -y leerness@1.0.0 ']) {
      assert.strictEqual(_requiredTier(`${prefix}state inspect ./release publish/web`), 'read-only');
      assert.strictEqual(_requiredTier(`${prefix}state inspect "C:\\work\\release (draft)\\publish"`), 'read-only');
      assert.strictEqual(_requiredTier(`${prefix}state inspect "\\\\server\\c$\\R&D\\web"`), 'read-only');
      assert.strictEqual(_requiredTier(`${prefix}state inspect '/work/R&D/publish'`), 'read-only');
      // Pure classification only: these strings are never executed as commands.
      assert.strictEqual(_requiredTier(`${prefix}state inspect . && git push`), 'git-write');
      assert.strictEqual(_requiredTier(`${prefix}state inspect .; npm publish`), 'publish');
      assert.strictEqual(_requiredTier(`${prefix}state inspect "C:\\work\\R&D" && git push`), 'git-write');
    }
  });

  // Instrument the real entry point, not a test-only --internal fast path.
  const preload = path.join(fixture, 'observe.cjs');
  fs.writeFileSync(preload, `
    const fs = require('fs'), cp = require('child_process'), path = require('path');
    const metrics = { gitCalls: 0, locatorCalls: 0, otherCalls: 0, projectReads: 0, writes: 0 };
    const spawn = cp.spawnSync;
    cp.spawnSync = function(command, args, options) {
      if (/(?:^|[\\\\/])git(?:\\.exe)?$/i.test(command)) metrics.gitCalls++;
      else if (/(?:^|[\\\\/])where\\.exe$/i.test(command) && args.length === 1 && args[0] === 'git') metrics.locatorCalls++;
      else if (!/(?:^|[\\\\/])chcp(?:\\.com)?$/i.test(command)) metrics.otherCalls++;
      return spawn.apply(this, arguments);
    };
    const read = fs.readFileSync;
    fs.readFileSync = function(file) {
      if (String(file).startsWith(${JSON.stringify(fixture)})) metrics.projectReads++;
      return read.apply(this, arguments);
    };
    for (const name of ['writeFileSync','appendFileSync','mkdirSync','renameSync','unlinkSync','rmSync','utimesSync']) {
      fs[name] = function() { metrics.writes++; throw new Error('inspect attempted a write: ' + name); };
    }
    process.on('exit', () => process.stderr.write(JSON.stringify(metrics)));
  `);
  check('real CLI performs one Git query, zero other execution, project content reads, and writes', () => {
    const snapshotBefore = snapshot(fixture);
    const result = run(['state', 'inspect', target, '--json'], { nodeArgs: ['--require', preload] });
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).ok, true);
    assert.deepStrictEqual(JSON.parse(result.stderr), { gitCalls: 1, locatorCalls: process.platform === 'win32' ? 1 : 0,
      otherCalls: 0, projectReads: 0, writes: 0 });
    assert.deepStrictEqual(snapshot(fixture), snapshotBefore);
  });
  check('invalid inspection diagnostics use no project content for error language', () => {
    const localeCwd = project('error locale cwd');
    const snapshotBefore = snapshot(fixture);
    for (const args of [
      ['state', 'inspect', target, '--apply', '--json'],
      ['state', 'inspect', target, '--unknown-inspect-flag', '--json'],
      ['state', 'inspect', target, '--json=false', '--json'],
      ['state', 'inspect', target, '--path', '--json'],
    ]) {
      const result = run(args, { cwd: localeCwd, env: { LEERNESS_LANG: '' }, nodeArgs: ['--require', preload] });
      assert.strictEqual(result.status, 1, result.stdout + result.stderr);
      assert.strictEqual(JSON.parse(result.stdout).ok, false);
      assert.deepStrictEqual(JSON.parse(result.stderr), { gitCalls: 0, locatorCalls: 0,
        otherCalls: 0, projectReads: 0, writes: 0 });
      assert.deepStrictEqual(snapshot(fixture), snapshotBefore);
    }
  });
  console.log(`state-inspect CLI probe: ${passed}/${passed} PASS`);
} finally {
  // Only this probe's freshly allocated fixture is eligible for cleanup.
  fs.rmSync(fixture, { recursive: true, force: true });
}
