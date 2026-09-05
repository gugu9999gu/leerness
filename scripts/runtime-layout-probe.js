#!/usr/bin/env node
'use strict';

// P-0021 compatibility reader: disposable local fixtures, no activation or
// provider/network calls. Product files and fixture data remain byte-preserved.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const G = require('../lib/git');
const SG = require('../lib/state-git');
const R = require('../lib/runtime-layout');
const CLI = path.resolve(__dirname, '../bin/leerness.js');

const tempDirectory = fs.realpathSync.native(os.tmpdir());
const arena = fs.mkdtempSync(path.join(tempDirectory, 'leerness-runtime-layout-'));
const environmentBefore = { ...process.env };
const sourceFiles = [path.resolve(__dirname, '../lib/runtime-layout.js'), CLI, __filename];
const signature = file => ({
  hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  mtime: fs.statSync(file, { bigint: true }).mtimeNs.toString(),
});
const sourceBefore = sourceFiles.map(signature);
const sentinel = 'private-runtime-task-approver-content-must-not-escape';
const linkKind = process.platform === 'win32' ? 'junction' : 'dir';
const standaloneOutputDirectories = [
  'previews', 'api-skills', 'skills', 'personas', 'skills-export', 'reviews',
  'incidents', 'skills-publish', 'skills-publish-tarball',
];
// Literal top-level stores of existing init-free CLI producers. Classification
// recognizes only each exact filename and regular-file kind, never its body.
const standaloneOutputFiles = [
  'user-requests.json', 'shell-failures.json', 'platform-constraints.json',
  'wakeup-history.json', 'agent-slash-commands.json', 'environment.json',
  'agent-permissions.json', 'credentials.local.json', 'llm-bench-history.md',
  'glossary.md', 'glossary.json', 'reuse-map.md', 'design-system.md',
  'skill-suggestions.md', 'skill-auto-cache.json', 'provider-probe-cache.json',
  'orchestrate-log.md', 'feature-graph.md', 'enforce.json', 'agent-reminders.md',
];
let total = 0;
let failed = 0;
let fixture = 0;

function check(label, fn) {
  total += 1;
  try { fn(); process.stdout.write(`ok - ${label}\n`); }
  catch (error) {
    failed += 1;
    process.stderr.write(`not ok - ${label}: ${error.stack || error.message}\n`);
  }
}
function directory(label) {
  const root = path.join(arena, `${++fixture}-${label}`);
  fs.mkdirSync(root);
  return root;
}
function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}
function descriptor(scope = 'project-local', overrides = {}) {
  return { schema: 'leerness.runtime-layout/v1', schemaVersion: 1, scope,
    generation: 1, layout: 'legacy', requiredWriterProtocol: 1, ...overrides };
}
const localDescriptor = root => path.join(root, '.leerness', 'cache', 'state-layout.json');
const gitDescriptor = root => path.join(SG.resolveGitTopology(root).gitDir, 'leerness', 'layout.json');
function store(file, scope, overrides) { write(file, JSON.stringify(descriptor(scope, overrides))); }
function git(root, args) {
  const result = G.gitSpawn(['-C', root, ...args], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024, windowsHide: true,
  });
  assert.strictEqual(result.status, 0, `fixture Git failed: ${result.stderr || result.error || result.stdout}`);
  return String(result.stdout || '').trim();
}
function seed(root) {
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Runtime Layout Probe']);
  git(root, ['config', 'user.email', 'runtime-layout@example.invalid']);
  write(path.join(root, 'source.txt'), 'fixture source\n');
  for (const project of ['', 'packages/alpha', 'packages/beta']) {
    write(path.join(root, project, '.leerness', 'HARNESS_VERSION'), '1\n');
  }
  git(root, ['add', '.']);
  git(root, ['-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${path.join(arena, 'disabled-hooks')}`,
    'commit', '-qm', 'runtime layout fixture']);
}
function snapshot(root) {
  const rows = [];
  function visit(file, relative) {
    const stat = fs.lstatSync(file, { bigint: true });
    const row = [relative, stat.mode.toString(), stat.size.toString(), stat.mtimeNs.toString()];
    if (stat.isSymbolicLink()) rows.push([...row, 'link', fs.readlinkSync(file)]);
    else if (stat.isDirectory()) {
      rows.push([...row, 'directory']);
      for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name), `${relative}/${name}`);
    } else rows.push([...row, 'file', signature(file).hash]);
  }
  visit(root, '.');
  return JSON.stringify(rows);
}
function noWrites(fn) {
  const before = snapshot(arena);
  try { return fn(); }
  finally { assert.strictEqual(snapshot(arena), before, 'diagnosis changed fixture bytes or mtimes'); }
}
function contract(report) {
  assert.strictEqual(report.schema, 'leerness.runtime-compatibility/v1');
  assert.strictEqual(report.activationSupported, false);
  assert.strictEqual(report.supportedWriterProtocol, 1);
  assert.strictEqual(report.workspaceAdmission, 'operation-start');
  assert(['allowed', 'blocked'].includes(report.writeDisposition));
  assert.strictEqual(report.ok, report.compatible);
  assert.strictEqual(report.compatible, report.writeDisposition === 'allowed');
  assert(['legacy', 'unknown', 'unsupported'].includes(report.observedLayout));
  assert(['worktree', 'project-local', 'unknown'].includes(report.scope));
  assert(/^[a-z][a-z0-9_]{1,80}$/.test(report.reasonCode));
  const output = JSON.stringify(report);
  assert(output.length < 1024, 'report is not bounded');
  assert(!output.includes(arena) && !output.includes(sentinel), 'report disclosed a path or private content');
  return report;
}
function expect(root, reason, scope) {
  const report = contract(R.inspectRuntimeCompatibility(root));
  assert.strictEqual(report.reasonCode, reason);
  if (scope) assert.strictEqual(report.scope, scope);
  return report;
}
function blocked(root, reason) {
  const report = contract(R.inspectRuntimeCompatibility(root));
  assert.strictEqual(report.writeDisposition, 'blocked');
  if (reason) assert.strictEqual(report.reasonCode, reason);
  return report;
}
function withEnv(values, fn) {
  const saved = { ...process.env };
  try {
    for (const [name, value] of Object.entries(values)) {
      for (const key of Object.keys(process.env)) if (key.toUpperCase() === name.toUpperCase()) delete process.env[key];
      if (value !== undefined) process.env[name] = value;
    }
    return fn();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}
function withMethod(object, method, implementation, fn) {
  const original = object[method];
  object[method] = implementation(original);
  try { return fn(); } finally { object[method] = original; }
}
function nodeProbe(program, args = []) {
  const result = cp.spawnSync(process.execPath, ['-e', program, ...args], {
    cwd: arena, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024, windowsHide: true,
    env: { ...process.env, LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1',
      LEERNESS_NO_DRIFT_CHECK: '1', LEERNESS_NO_STALE_CHECK: '1' },
  });
  assert.strictEqual(result.status, 0, String(result.stderr || result.stdout || result.error).slice(-8192));
}
function standaloneCli(root, args, env = {}) {
  const result = cp.spawnSync(process.execPath, [CLI, ...args, '--path', root], {
    cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024, windowsHide: true,
    env: { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1',
      LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_AUTO_ROADMAP: '1', ...env },
  });
  assert.strictEqual(result.error, undefined);
  assert.strictEqual(result.signal, null);
  assert.strictEqual(result.status, 0, String(result.stdout || result.stderr).slice(-2048));
  assert.strictEqual(require('../lib/workspace-dir').inspectWorkspace(root).canonical.live, false,
    'the standalone CLI fixture must not acquire an initialized workspace marker');
  return result.stdout;
}

try {
  for (const key of Object.keys(process.env)) {
    if (G._shouldDrop(key) || ['LEERNESS_WORKSPACE_DIR', 'GIT_CEILING_DIRECTORIES',
      'GIT_DISCOVERY_ACROSS_FILESYSTEM'].includes(key.toUpperCase())) delete process.env[key];
  }
  const emptyConfig = path.join(arena, 'empty-gitconfig');
  write(emptyConfig, '');
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_SYSTEM: emptyConfig,
    GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_DEFAULT_HASH: 'sha1', LC_ALL: 'C', LANGUAGE: 'C' });
  const main = directory('main');
  seed(main);
  const linkedA = path.join(arena, 'linked-a');
  const linkedB = path.join(arena, 'linked-b-detached');
  git(main, ['worktree', 'add', '-b', 'linked-a', linkedA, 'HEAD']);
  git(main, ['worktree', 'add', '--detach', linkedB, 'HEAD']);
  const local = directory('non-git');
  const layout = localDescriptor(local);

  check('main, two linked worktrees, detached HEAD, and non-Git legacy controls', () => noWrites(() => {
    for (const root of [main, linkedA, linkedB]) expect(root, 'legacy_absent', 'worktree');
    expect(local, 'legacy_absent', 'project-local');
  }));
  check('canonical project aliases share one admission authority', () => {
    const alias = path.join(arena, 'alias space Ω');
    fs.symlinkSync(linkedA, alias, linkKind);
    noWrites(() => assert.deepStrictEqual(R.inspectRuntimeCompatibility(alias), R.inspectRuntimeCompatibility(linkedA)));
  });
  if (process.platform === 'win32') check('Windows case aliases share one admission authority', () => noWrites(() => {
    assert.deepStrictEqual(R.inspectRuntimeCompatibility(linkedA.toUpperCase()), R.inspectRuntimeCompatibility(linkedA));
  }));
  check('strict valid legacy descriptor is accepted without touching private records', () => {
    store(layout, 'project-local');
    for (const relative of ['cache/agent-runs/private.json', 'pre-wake-report.json', 'routing-log.json']) {
      write(path.join(local, '.leerness', relative), sentinel);
    }
    write(path.join(local, '.leerness', 'HARNESS_VERSION'), '1\n');
    noWrites(() => expect(local, 'legacy_supported', 'project-local'));
  });

  const malformed = [
    ['empty', '', 'descriptor_invalid_json'],
    ['truncated', '{"schema":', 'descriptor_invalid_json'],
    ['array', '[]', 'descriptor_invalid'],
    ['null', 'null', 'descriptor_invalid'],
    ['scalar', '1', 'descriptor_invalid'],
    ['unknown field', JSON.stringify({ ...descriptor(), extra: sentinel }), 'descriptor_invalid'],
    ['missing field', JSON.stringify({ ...descriptor(), generation: undefined }), 'descriptor_invalid'],
    ['wrong type', JSON.stringify(descriptor('project-local', { schemaVersion: '1' })), 'descriptor_invalid'],
    ['zero generation', JSON.stringify(descriptor('project-local', { generation: 0 })), 'descriptor_invalid'],
    ['fractional generation', JSON.stringify(descriptor('project-local', { generation: 1.5 })), 'descriptor_invalid'],
    ['unsafe generation', JSON.stringify(descriptor('project-local', { generation: Number.MAX_SAFE_INTEGER + 1 })), 'descriptor_invalid'],
    ['future schema', JSON.stringify(descriptor('project-local', { schema: 'leerness.runtime-layout/v2' })), 'layout_unsupported'],
    ['future version', JSON.stringify(descriptor('project-local', { schemaVersion: 2 })), 'layout_unsupported'],
    ['future protocol', JSON.stringify(descriptor('project-local', { requiredWriterProtocol: 2 })), 'layout_unsupported'],
    ['future layout', JSON.stringify(descriptor('project-local', { layout: sentinel })), 'layout_unsupported'],
    ['mismatched scope', JSON.stringify(descriptor('worktree')), 'descriptor_scope_mismatch'],
    ['invalid UTF-8', Buffer.from([0x7b, 0xff, 0x7d]), 'descriptor_invalid_utf8'],
    ['UTF-8 BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(descriptor()))]), 'descriptor_invalid_json'],
    ['duplicate key', JSON.stringify(descriptor()).replace(/}$/, ',"generation":2}'), 'descriptor_duplicate_key'],
    ['escaped duplicate key', JSON.stringify(descriptor()).replace(/}$/, ',"generat\\u0069on":2}'), 'descriptor_duplicate_key'],
  ];
  for (const [label, body, reason] of malformed) check(`${label} descriptor is bounded and preserves its bytes`, () => {
    write(layout, body);
    noWrites(() => blocked(local, reason));
  });
  check('exactly 16 KiB is allowed; larger descriptor is refused before opening', () => {
    write(layout, JSON.stringify(descriptor()).padEnd(R.MAX_DESCRIPTOR_BYTES, ' '));
    noWrites(() => expect(local, 'legacy_supported'));
    write(layout, Buffer.alloc(R.MAX_DESCRIPTOR_BYTES + 1, 0x20));
    let opened = 0;
    withMethod(fs, 'openSync', original => function (file, ...args) {
      if (String(file) === layout) opened += 1;
      return original.call(this, file, ...args);
    }, () => blocked(local, 'descriptor_too_large'));
    assert.strictEqual(opened, 0);
  });
  check('unreadable descriptor is refused without exposing the filesystem error', () => {
    store(layout, 'project-local');
    withMethod(fs, 'openSync', original => function (file, ...args) {
      if (String(file) === layout) throw Object.assign(new Error(sentinel), { code: 'EACCES' });
      return original.call(this, file, ...args);
    }, () => blocked(local, 'layout_unreadable'));
  });
  check('hard-linked descriptor is refused and both existing names are preserved', () => {
    const root = directory('hard-link');
    const original = path.join(root, 'retained-source');
    store(original, 'project-local');
    fs.mkdirSync(path.dirname(localDescriptor(root)), { recursive: true });
    fs.linkSync(original, localDescriptor(root));
    noWrites(() => blocked(root, 'descriptor_hard_linked'));
  });
  check('non-regular descriptor is refused', () => {
    const root = directory('directory-descriptor');
    fs.mkdirSync(localDescriptor(root), { recursive: true });
    noWrites(() => blocked(root, 'descriptor_not_regular'));
  });
  for (const target of ['.leerness', '.leerness/cache', '.leerness/cache/state-layout.json']) {
    check(`linked ${target} is refused without following private content`, () => {
      const root = directory('linked-parent');
      const outside = directory('outside-private');
      write(path.join(outside, 'retained-private'), sentinel);
      const link = path.join(root, target);
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(outside, link, linkKind);
      noWrites(() => blocked(root));
    });
  }
  check('descriptor changes during bounded read are refused', () => {
    store(layout, 'project-local');
    let changed = false;
    withMethod(fs, 'readSync', original => function (fd, ...args) {
      const count = original.call(this, fd, ...args);
      if (!changed) { changed = true; store(layout, 'project-local', { generation: 22 }); }
      return count;
    }, () => blocked(local, 'layout_changed'));
  });

  for (const name of ['state-layout.json', 'state-runtime']) check(`alternate .harness ${name} blocks all workspace selections`, () => { // workspace-dir-legacy-fixture
    const root = directory('alternate');
    store(localDescriptor(root), 'project-local');
    write(path.join(root, '.harness', 'HARNESS_VERSION'), '1\n'); // workspace-dir-legacy-fixture
    const alternate = path.join(root, '.harness', 'cache', name); // workspace-dir-legacy-fixture
    if (name.endsWith('.json')) store(alternate, 'project-local');
    else fs.mkdirSync(alternate, { recursive: true });
    noWrites(() => {
      for (const selection of [undefined, '.leerness', '.harness']) withEnv({ LEERNESS_WORKSPACE_DIR: selection }, // workspace-dir-legacy-fixture
        () => blocked(root, 'alternate_layout_present'));
    });
  });
  check('canonical non-Git runtime blocks missing and legacy descriptors', () => {
    const root = directory('non-git-runtime');
    fs.mkdirSync(path.join(root, '.leerness', 'cache', 'state-runtime'), { recursive: true });
    noWrites(() => blocked(root, 'runtime_without_compatible_layout'));
    store(localDescriptor(root), 'project-local');
    noWrites(() => blocked(root, 'runtime_without_compatible_layout'));
  });
  for (const location of ['canonical', 'legacy', 'conflict']) check(`${location} foreign or conflicting workspace blocks admission`, () => {
    const root = directory('foreign');
    if (location === 'conflict') {
      write(path.join(root, '.leerness', 'HARNESS_VERSION'), '1\n');
      write(path.join(root, '.harness', 'HARNESS_VERSION'), '1\n'); // workspace-dir-legacy-fixture
    } else write(path.join(root, location === 'canonical' ? '.leerness' : '.harness', 'private-notes'), sentinel); // workspace-dir-legacy-fixture
    noWrites(() => blocked(root, location === 'conflict' ? 'workspace_dir_conflict' : 'workspace_ambiguous'));
  });
  check('workspace inspection permission failure is not treated as an empty store', () => {
    withMethod(fs, 'readdirSync', original => function (file, ...args) {
      if (String(file) === path.join(local, '.leerness')) throw Object.assign(new Error(sentinel), { code: 'EACCES' });
      return original.call(this, file, ...args);
    }, () => blocked(local, 'workspace_unreadable'));
  });
  for (const files of [['agent-roles.json'], ['execution-ledger.jsonl'], ['decisions.json', 'decisions.md'],
    ['providers.json', 'agent-roles.json'], ['lessons.json', 'lessons.md', 'task-log.md'],
    ['bugfix-receipts.json', 'claims-baseline.json', 'toggles.json'],
    ['decisions.archive.md'], ['lessons.archive.md'], ['plan.archive.md'], ['rules.archive.md']]) {
    check(`known standalone store shape is admitted: ${files.join(', ')}`, () => {
      const root = directory('standalone');
      for (const name of files) write(path.join(root, '.leerness', name), sentinel);
      noWrites(() => expect(root, 'legacy_absent', 'project-local'));
    });
  }
  check('a known standalone name does not authorize an additional foreign file', () => {
    const root = directory('mixed-standalone');
    write(path.join(root, '.leerness', 'agent-roles.json'), '{}\n');
    write(path.join(root, '.leerness', 'unrelated-private-notes'), sentinel);
    noWrites(() => blocked(root, 'workspace_ambiguous'));
  });
  for (const name of standaloneOutputFiles) {
    check(`exact standalone ${name} file is admitted without reading its contents`, () => {
      const root = directory('producer-file');
      const output = path.join(root, '.leerness', name);
      write(output, sentinel); // Deliberately not a valid domain document.
      let reads = 0;
      const forbidBody = original => function (file, ...args) {
        if (String(file) === output) { reads++; throw new Error('Producer contents must not be read'); }
        return original.call(this, file, ...args);
      };
      noWrites(() => withMethod(fs, 'readFileSync', forbidBody,
        () => withMethod(fs, 'openSync', forbidBody,
          () => assert.strictEqual(expect(root, 'legacy_absent', 'project-local').writeDisposition, 'allowed'))));
      assert.strictEqual(reads, 0, 'admission must not swallow a store content-read failure');
    });
    for (const variant of ['wrong-kind', 'linked', 'lookalike', 'foreign-sibling']) {
      check(`standalone ${name} file does not admit ${variant}`, () => {
        const root = directory('producer-file-invalid');
        const output = path.join(root, '.leerness', name);
        fs.mkdirSync(path.dirname(output));
        if (variant === 'wrong-kind') write(path.join(output, 'private-file'), sentinel);
        else if (variant === 'lookalike') write(output + '-private', sentinel);
        else if (variant === 'foreign-sibling') {
          write(output, sentinel);
          write(path.join(root, '.leerness', 'private-note'), sentinel);
        } else {
          // The same unprivileged junction/POSIX symlink fixture as directory
          // negatives: a reserved filename must never authorize following it.
          const outside = directory('producer-file-link-target');
          write(path.join(outside, 'private-file'), sentinel);
          fs.symlinkSync(outside, output, linkKind);
          assert(fs.lstatSync(output).isSymbolicLink());
        }
        noWrites(() => blocked(root, 'workspace_ambiguous'));
      });
    }
  }
  for (const name of standaloneOutputDirectories) check(`exact standalone ${name} directory is admitted without reading its contents`, () => {
    const root = directory('producer-directory');
    const output = path.join(root, '.leerness', name);
    write(path.join(output, 'private-output.md'), sentinel);
    noWrites(() => withMethod(fs, 'readdirSync', original => function (file, ...args) {
      if (String(file) === output) throw new Error('Producer contents must not be enumerated');
      return original.call(this, file, ...args);
    }, () => withMethod(fs, 'readFileSync', original => function (file, ...args) {
      if (String(file).startsWith(output + path.sep)) throw new Error('Producer contents must not be read');
      return original.call(this, file, ...args);
    }, () => expect(root, 'legacy_absent'))));
  });
  check('standalone API skill collision, corrupt listing, and JSON error contracts remain intact', () => {
    const root = directory('api-skill-round-trip');
    const run = (args, status = 0) => {
      const result = cp.spawnSync(process.execPath, [CLI, 'api-skill', ...args, '--path', root, '--json'], {
        cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true,
        env: { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1',
          LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_AUTO_ROADMAP: '1' },
      });
      assert.strictEqual(result.error, undefined);
      assert.strictEqual(result.signal, null);
      assert.strictEqual(result.status, status, String(result.stdout || result.stderr).slice(-2048));
      return JSON.parse(result.stdout);
    };
    const ids = [];
    // Unsupported FTP is rejected before any request; --skeleton exercises the real writer offline.
    for (const direction of ['alpha', 'beta']) {
      const result = run(['add', `ftp://example.test/docs?${direction}`, '--skeleton', '--no-crawl',
        '--direction', `${direction}-direction`]);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.skeleton, true);
      ids.push(result.id);
    }
    assert.notStrictEqual(ids[0], ids[1]);
    const output = path.join(root, '.leerness', 'api-skills');
    for (const [index, direction] of ['alpha', 'beta'].entries()) {
      assert(fs.readFileSync(path.join(output, ids[index] + '.md'), 'utf8').includes(`${direction}-direction`));
      assert(fs.readFileSync(path.join(output, ids[index] + '.md'), 'utf8').includes(`ftp://example.test/docs?${direction}`));
    }
    write(path.join(output, 'bad.md'), '---\nid: intended\nname: X\n# no closing');
    const listing = run(['list']);
    assert.strictEqual(listing.skills.length, 3);
    assert.strictEqual(listing.corruptCount, 1);
    assert.strictEqual(listing.skills.find(skill => skill.id === 'bad').corrupt, true);
    const error = run(['add', 'not-a-url'], 1);
    assert.strictEqual(error.ok, false);
    assert.strictEqual(error.code, 'fetch_failed');
    noWrites(() => expect(root, 'legacy_absent'));
    store(localDescriptor(root), 'project-local', { layout: 'worktree-private' });
    noWrites(() => {
      const blockedAdd = run(['add', 'ftp://example.test/docs?denied', '--skeleton', '--no-crawl'], 1);
      assert.strictEqual(blockedAdd.code, 'runtime_layout_incompatible');
      assert(/\(layout_unsupported\)/.test(blockedAdd.error));
      blocked(root, 'layout_unsupported');
    });
  });
  check('standalone preview add, mockup, and subsequent revise remain writable', () => {
    const root = directory('preview-round-trip');
    fs.mkdirSync(path.join(root, '.leerness'));
    for (const args of [['preview', 'add', 'fixture'], ['preview', 'mockup', 'P-0001'],
      ['preview', 'revise', 'P-0001', '--note', 'fixture revision']]) {
      const result = cp.spawnSync(process.execPath, [CLI, ...args, '--json', '--path', root], {
        cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true,
        env: { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1',
          LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_AUTO_ROADMAP: '1' },
      });
      assert.strictEqual(result.status, 0, String(result.stdout || result.stderr).slice(-2048));
      assert.strictEqual(JSON.parse(result.stdout).ok, true);
    }
    assert(fs.existsSync(path.join(root, '.leerness/previews/P-0001-mockup.html')));
    noWrites(() => expect(root, 'legacy_absent'));
  });
  check('direct standalone preview build and cleanup work without a preview store', () => {
    const root = directory('preview-direct');
    const preview = require('../lib/preview-serve');
    write(path.join(root, 'mock.html'), '<!doctype html><head></head><body>fixture</body>');
    const built = preview.buildServeWorkspace(root, { id: 'P-0001', mockupPath: 'mock.html' });
    assert.strictEqual(built.ok, true);
    assert(fs.existsSync(path.join(built.dir, 'index.html')));
    assert.strictEqual(preview.cleanupServeDir(root, 'P-0001'), true);
    assert(!fs.existsSync(built.dir));
    noWrites(() => expect(root, 'legacy_absent'));
  });
  check('standalone skill learn remains writable and preserves the first skill', () => {
    const root = directory('skill-learn-round-trip');
    standaloneCli(root, ['skill', 'learn', 'compat-first', '--capability', 'first-capability']);
    const first = path.join(root, '.leerness', 'skills', 'compat-first');
    const before = snapshot(first);
    standaloneCli(root, ['skill', 'learn', 'compat-second', '--capability', 'second-capability']);
    assert.strictEqual(snapshot(first), before);
    for (const name of ['first', 'second']) {
      const output = path.join(root, '.leerness', 'skills', `compat-${name}`);
      const data = JSON.parse(fs.readFileSync(path.join(output, 'skill.json'), 'utf8'));
      assert.strictEqual(data.name, `compat-${name}`);
      assert.deepStrictEqual(data.capabilities, [`${name}-capability`]);
      assert(fs.readFileSync(path.join(output, 'README.md'), 'utf8').includes(`- ${name}-capability`));
    }
    noWrites(() => expect(root, 'legacy_absent'));
  });
  check('standalone persona add remains writable and preserves the first persona', () => {
    const root = directory('persona-round-trip');
    standaloneCli(root, ['persona', 'add', 'compat-first']);
    const first = path.join(root, '.leerness', 'personas', 'compat-first.md');
    assert(fs.readFileSync(first, 'utf8').startsWith('# compat-first\n'));
    const before = signature(first);
    standaloneCli(root, ['persona', 'add', 'compat-second']);
    assert.deepStrictEqual(signature(first), before);
    assert(fs.readFileSync(path.join(root, '.leerness', 'personas', 'compat-second.md'), 'utf8')
      .startsWith('# compat-second\n'));
    noWrites(() => expect(root, 'legacy_absent'));
  });
  check('standalone skill export-all can repeat without losing existing output content', () => {
    const root = directory('skill-export-round-trip');
    const catalog = path.join(root, 'catalog.json');
    write(catalog, JSON.stringify({ skills: [{ id: 'compat-export', displayNameKo: 'Compatibility export',
      capabilities: ['export-capability'], version: '1.0.0', verification: 'unverified' }] }));
    const env = { LEERNESS_SKILLPACK_PATH: catalog };
    standaloneCli(root, ['skill', 'export-all'], env);
    const output = path.join(root, '.leerness', 'skills-export');
    const skill = path.join(output, 'compat-export', 'SKILL.md');
    const before = fs.readFileSync(skill, 'utf8');
    assert(before.startsWith('---\nname: compat-export\n') && before.includes('- export-capability\n'));
    const retained = path.join(output, 'retained.md');
    write(retained, sentinel);
    const retainedBefore = signature(retained);
    standaloneCli(root, ['skill', 'export-all'], env);
    assert.strictEqual(fs.readFileSync(skill, 'utf8'), before);
    assert.deepStrictEqual(signature(retained), retainedBefore);
    assert.deepStrictEqual(fs.readdirSync(output).sort(), ['compat-export', 'retained.md']);
    noWrites(() => expect(root, 'legacy_absent'));
  });
  check('standalone review md can repeat without changing source or retained reviews', () => {
    const root = directory('review-round-trip');
    const source = path.join(root, 'local.js');
    write(source, 'module.exports = 17;\n');
    const sourceBefore = signature(source);
    const args = ['review', 'local.js', '--persona', 'security', '--emit', 'md'];
    assert(standaloneCli(root, args).includes('module.exports = 17;'));
    const output = path.join(root, '.leerness', 'reviews');
    assert(fs.statSync(output).isDirectory());
    const retained = path.join(output, 'retained.md');
    write(retained, sentinel);
    const retainedBefore = signature(retained);
    assert(standaloneCli(root, args).includes('module.exports = 17;'));
    assert.deepStrictEqual(signature(source), sourceBefore);
    assert.deepStrictEqual(signature(retained), retainedBefore);
    noWrites(() => expect(root, 'legacy_absent'));
  });
  // Real fresh-process admissions, not cached readers or no-op controls. These
  // six local commands never invoke providers, fetch endpoints, or credentials.
  check('standalone requests add preserves the first request on a second admission', () => {
    const root = directory('requests-round-trip');
    const file = path.join(root, '.leerness', 'user-requests.json');
    standaloneCli(root, ['requests', 'add', 'compat-first', '--json']);
    const first = JSON.parse(fs.readFileSync(file, 'utf8')).requests;
    assert.strictEqual(first.length, 1);
    assert.strictEqual(first[0].id, 'UR-0001');
    assert.strictEqual(first[0].text, 'compat-first');
    assert.strictEqual(first[0].status, 'open');
    standaloneCli(root, ['requests', 'add', 'compat-second', '--json']);
    const after = JSON.parse(fs.readFileSync(file, 'utf8')).requests;
    assert.strictEqual(after.length, 2);
    assert.deepStrictEqual(after[0], first[0]);
    assert.strictEqual(after[1].id, 'UR-0002');
    assert.strictEqual(after[1].text, 'compat-second');
    assert.strictEqual(after[1].status, 'open');
    noWrites(() => expect(root, 'legacy_absent'));
  });
  check('standalone shell failure recording preserves the first entry on a second admission', () => {
    const root = directory('shell-failures-round-trip');
    const file = path.join(root, '.leerness', 'shell-failures.json');
    // --record stores command text; it does not execute that command.
    standaloneCli(root, ['shell-guard', '--record', '--cmd', 'echo compat-first', '--shell', 'bash', '--exit', '1', '--json']);
    const first = JSON.parse(fs.readFileSync(file, 'utf8')).failures;
    assert.strictEqual(first.length, 1);
    assert.strictEqual(first[0].cmd, 'echo compat-first');
    assert.strictEqual(first[0].exitCode, 1);
    assert.strictEqual(first[0].shell, 'bash');
    standaloneCli(root, ['shell-guard', '--record', '--cmd', 'echo compat-second', '--shell', 'bash', '--exit', '2', '--json']);
    const after = JSON.parse(fs.readFileSync(file, 'utf8')).failures;
    assert.strictEqual(after.length, 2);
    assert.deepStrictEqual(after[0], first[0]);
    assert.strictEqual(after[1].cmd, 'echo compat-second');
    assert.strictEqual(after[1].exitCode, 2);
    assert.strictEqual(after[1].shell, 'bash');
    noWrites(() => expect(root, 'legacy_absent'));
  });
  check('standalone wakeup interval updates the persisted override on a second admission', () => {
    const root = directory('wakeup-interval-round-trip');
    const file = path.join(root, '.leerness', 'wakeup-history.json');
    standaloneCli(root, ['wakeup-interval', 'set', '120', '--json']);
    const first = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(first.override, 120);
    assert.deepStrictEqual(first.fires, []);
    standaloneCli(root, ['wakeup-interval', 'set', '240', '--json']);
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(after.override, 240);
    assert.deepStrictEqual(after.fires, first.fires);
    noWrites(() => expect(root, 'legacy_absent'));
  });
  check('standalone permissions set persists the requested preset on a second admission', () => {
    const root = directory('permissions-round-trip');
    const file = path.join(root, '.leerness', 'agent-permissions.json');
    standaloneCli(root, ['permissions', 'set', 'basic']);
    const first = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(first.mode, 'basic');
    assert.strictEqual(first.shell.exec, false);
    assert.strictEqual(first.network.fetch, false);
    assert.strictEqual(first.filesystem.delete, false);
    standaloneCli(root, ['permissions', 'set', 'extended']);
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(after.mode, 'extended');
    assert.strictEqual(after.shell.exec, true);
    assert(after.shell.allowList.includes('node'));
    assert.deepStrictEqual(after.filesystem.restrictTo, ['./']);
    assert.strictEqual(after.filesystem.delete, false);
    assert.strictEqual(after.admin, false);
    noWrites(() => expect(root, 'legacy_absent'));
  });
  check('standalone manual benchmark recording appends without losing the first row', () => {
    const root = directory('llm-bench-round-trip');
    const file = path.join(root, '.leerness', 'llm-bench-history.md');
    standaloneCli(root, ['llm-bench', 'record', '--model', 'local-record-only', '--label', 'compat-first', '--score', '1', '--tokens', '11']);
    const first = fs.readFileSync(file, 'utf8');
    assert(first.startsWith('# LLM Bench History\n'));
    assert(first.includes('| local-record-only | compat-first | 1 | 11 |\n'));
    standaloneCli(root, ['llm-bench', 'record', '--model', 'local-record-only', '--label', 'compat-second', '--score', '2', '--tokens', '22']);
    const after = fs.readFileSync(file, 'utf8');
    assert(after.startsWith(first));
    assert(after.slice(first.length).includes('| local-record-only | compat-second | 2 | 22 |\n'));
    assert.strictEqual(after.split('\n').filter(line => line.includes('| local-record-only |')).length, 2);
    noWrites(() => expect(root, 'legacy_absent'));
  });
  check('standalone glossary rebuild preserves manual content and the first dependency', () => {
    const root = directory('glossary-round-trip');
    const pkg = path.join(root, 'package.json');
    const markdown = path.join(root, '.leerness', 'glossary.md');
    const json = path.join(root, '.leerness', 'glossary.json');
    const description = 'Local fixture dependency description';
    write(pkg, JSON.stringify({ name: 'compat-glossary', version: '1.0.0', dependencies: { 'compat-first': '1.0.0' } }));
    write(path.join(root, 'node_modules', 'compat-first', 'package.json'), JSON.stringify({ name: 'compat-first', description }));
    standaloneCli(root, ['glossary', 'build', '--json']);
    const first = JSON.parse(fs.readFileSync(json, 'utf8'));
    assert.strictEqual(first.total, 1);
    assert.strictEqual(first.defined, 1);
    assert.strictEqual(first.entries[0].term, 'compat-first');
    assert.strictEqual(first.entries[0].plainEn, description);
    assert.strictEqual(first.entries[0].source, 'package-description');
    const prefix = 'Manual glossary preface\n', suffix = '\nManual glossary appendix\n';
    write(markdown, prefix + fs.readFileSync(markdown, 'utf8') + suffix);
    write(pkg, JSON.stringify({ name: 'compat-glossary', version: '1.0.0',
      dependencies: { 'compat-first': '1.0.0', 'compat-second': '1.0.0' } }));
    write(path.join(root, 'node_modules', 'compat-second', 'package.json'), JSON.stringify({ name: 'compat-second', description: 'Second local fixture dependency' }));
    standaloneCli(root, ['glossary', 'build', '--json']);
    const after = JSON.parse(fs.readFileSync(json, 'utf8'));
    assert.strictEqual(after.total, 2);
    assert.strictEqual(after.defined, 2);
    assert.strictEqual(after.entries.length, 2);
    assert.deepStrictEqual(after.entries.find(entry => entry.term === 'compat-first'), first.entries[0]);
    assert.strictEqual(after.entries.find(entry => entry.term === 'compat-second').plainEn, 'Second local fixture dependency');
    const text = fs.readFileSync(markdown, 'utf8');
    assert(text.startsWith(prefix) && text.endsWith(suffix));
    assert(text.includes('compat-first') && text.includes('compat-second'));
    noWrites(() => expect(root, 'legacy_absent'));
  });
  for (const name of standaloneOutputDirectories) for (const variant of ['wrong-kind', 'lookalike', 'foreign-sibling', 'linked']) {
    check(`standalone ${name} directory does not admit ${variant}`, () => {
      const root = directory('producer-invalid');
      const previews = path.join(root, '.leerness', name);
      fs.mkdirSync(path.dirname(previews));
      if (variant === 'wrong-kind') write(previews, sentinel);
      else if (variant === 'lookalike') fs.mkdirSync(previews + '-private');
      else if (variant === 'foreign-sibling') {
        fs.mkdirSync(previews);
        write(path.join(root, '.leerness/private-note'), sentinel);
      } else {
        const outside = directory('preview-target');
        write(path.join(outside, 'private.html'), sentinel);
        fs.symlinkSync(outside, previews, linkKind);
      }
      noWrites(() => blocked(root, 'workspace_ambiguous'));
    });
  }
  check('standalone canonical authority beside a live legacy store is still refused', () => {
    const root = directory('standalone-dual');
    write(path.join(root, '.leerness', 'agent-roles.json'), '{}\n');
    write(path.join(root, '.harness', 'HARNESS_VERSION'), '1\n'); // workspace-dir-legacy-fixture
    noWrites(() => blocked(root, 'workspace_ambiguous'));
  });
  check('known store names that are directories do not authorize foreign contents', () => {
    const root = directory('standalone-directory');
    write(path.join(root, '.leerness', 'agent-roles.json', 'private-file'), sentinel);
    noWrites(() => blocked(root, 'workspace_ambiguous'));
  });
  const auxiliaries = [
    ['execution-ledger.jsonl.lock', 'directory'],
    ['execution-ledger.jsonl.lock.release-0123456789abcdef0123456789abcdef', 'directory'],
    ['decisions.json.tmp-123-1', 'file'],
    ['decisions.json.corrupt-1700000000000-123-2', 'file'],
    ['.agent-roles-create-123-0123456789abcdef01234567', 'file'],
    ['.execution-ledger-create-123-0123456789abcdef01234567', 'file'],
    ['.agent-roles-create-123-0123456789abcdef01234567.detach-123-0123456789abcdef', 'file'],
    ['.execution-ledger-create-123-0123456789abcdef01234567.detach-123-0123456789abcdef', 'file'],
  ];
  for (const [name, kind] of auxiliaries) {
    check(`known producer auxiliary is admitted without a live sibling: ${name}`, () => {
      const root = directory('store-auxiliary');
      const file = path.join(root, '.leerness', name);
      if (kind === 'directory') write(path.join(file, 'private-owner'), sentinel);
      else write(file, sentinel);
      noWrites(() => {
        withMethod(fs, kind === 'directory' ? 'readdirSync' : 'readFileSync', original => function (target, ...args) {
          if (String(target) === file) throw new Error('Auxiliary contents must not be read');
          return original.call(this, target, ...args);
        }, () => expect(root, 'legacy_absent', 'project-local'));
      });
    });
    check(`wrong-kind producer auxiliary remains foreign: ${name}`, () => {
      const root = directory('wrong-auxiliary-kind');
      const file = path.join(root, '.leerness', name);
      if (kind === 'directory') write(file, sentinel);
      else write(path.join(file, 'private-file'), sentinel);
      noWrites(() => blocked(root, 'workspace_ambiguous'));
    });
    check(`linked producer auxiliary is refused: ${name}`, () => {
      const root = directory('linked-auxiliary');
      const outside = directory('auxiliary-outside');
      write(path.join(outside, 'private-file'), sentinel);
      fs.mkdirSync(path.join(root, '.leerness'));
      fs.symlinkSync(outside, path.join(root, '.leerness', name), linkKind);
      noWrites(() => blocked(root, 'workspace_ambiguous'));
    });
  }
  for (const name of ['private.json.lock', 'private.json.tmp-123-1', 'private.json.corrupt-1700000000000-123-2',
    'private.json.lock.release-0123456789abcdef0123456789abcdef', 'execution-ledger.jsonl.lock.release-0123',
    'decisions.json.tmp-123-1-extra', 'decisions.json.tmp-0-1', 'decisions.json.tmp-123-x',
    'decisions.json.corrupt-1700000000000-123', 'execution-ledger.jsonl.corrupt-1700000000000-123-2',
    'decisions.md.corrupt-1700000000000-123-2', '.private-create-123-0123456789abcdef01234567',
    '.execution-ledger-create-123-0123456789abcdef01234567-extra', '.agent-roles-create-123-not-a-token',
    '.private-create-123-0123456789abcdef01234567.detach-123-0123456789abcdef',
    'execution-ledger.jsonl.detach-123-0123456789abcdef',
    '.agent-roles-create-123-0123456789abcdef01234567.detach-123-0123456789abcde',
    '.execution-ledger-create-123-0123456789abcdef01234567.detach-123-0123456789abcdef0',
    '.agent-roles-create-123-0123456789abcdef01234567.detach-0-0123456789abcdef',
    '.execution-ledger-create-123-0123456789abcdef01234567.detach-123-0123456789ABCDEF',
    '.agent-roles-create-123-0123456789abcdef01234567.detach-123-0123456789abcdef-extra',
    '.execution-ledger-create-123-0123456789abcdef01234567.detach-123-0123456789abcdef.detach-123-0123456789abcdef']) {
    check(`foreign producer-like name is refused: ${name}`, () => {
      const root = directory('foreign-auxiliary');
      write(path.join(root, '.leerness', 'decisions.json'), '{}\n');
      write(path.join(root, '.leerness', name), sentinel);
      noWrites(() => blocked(root, 'workspace_ambiguous'));
    });
  }
  for (const known of [true, false]) check(`${known ? 'known' : 'foreign'} auxiliary disappearing after enumeration retains admission policy`, () => {
    const root = directory('disappearing-auxiliary');
    const workspace = path.join(root, '.leerness');
    const lock = path.join(workspace, `${known ? 'execution-ledger.jsonl' : 'private.json'}.lock`);
    fs.mkdirSync(lock, { recursive: true });
    withMethod(fs, 'readdirSync', original => function (file, ...args) {
      const names = original.call(this, file, ...args);
      if (String(file) === workspace && fs.existsSync(lock)) fs.rmdirSync(lock);
      return names;
    }, () => known ? expect(root, 'legacy_absent') : blocked(root, 'workspace_ambiguous'));
  });
  check('actual lock producer admits a second reader while held and during release', () => {
    const root = directory('real-standalone-lock');
    nodeProbe(`
      const assert = require('assert');
      const fs = require('fs');
      const path = require('path');
      const R = require(${JSON.stringify(path.resolve(__dirname, '../lib/runtime-layout.js'))});
      const { _withLock } = require(${JSON.stringify(CLI)});
      const root = process.argv[1];
      const file = path.join(root, '.leerness', 'execution-ledger.jsonl');
      const rename = fs.renameSync;
      const released = [];
      fs.renameSync = function (from, to, ...args) {
        const result = rename.call(this, from, to, ...args);
        if (from === file + '.lock') {
          assert(fs.lstatSync(to).isDirectory());
          released.push(R.inspectRuntimeCompatibility(root));
        }
        return result;
      };
      _withLock(file, () => {
        assert(fs.lstatSync(file + '.lock').isDirectory());
        assert(!fs.existsSync(file));
        const report = R.inspectRuntimeCompatibility(root);
        assert.strictEqual(report.writeDisposition, 'allowed', report.reasonCode);
      });
      assert(!fs.existsSync(file + '.lock'));
      assert.strictEqual(released.length, 1);
      assert.strictEqual(released[0].writeDisposition, 'allowed', released[0].reasonCode);
    `, [root]);
  });
  check('actual exclusive role and ledger installers admit their temporary files', () => {
    const roleStore = require('../lib/role-store');
    const fallback = require('../lib/role-fallback');
    const root = directory('real-exclusive-install');
    const observed = [];
    withMethod(fs, 'linkSync', original => function (from, to, ...args) {
      const local = path.dirname(String(to)) === path.join(root, '.leerness');
      if (local) {
        assert(!fs.existsSync(to));
        noWrites(() => expect(root, 'legacy_absent'));
        observed.push(path.basename(to));
      }
      const result = original.call(this, from, to, ...args);
      if (local) noWrites(() => expect(root, 'legacy_absent'));
      return result;
    }, () => {
      roleStore.saveRoles(root, { coder: { provider: 'codex', model: 'synthetic-model' } }, roleStore.readRoleStore(root));
      fallback.appendExecutionEvent(root, { event: 'dispatch.prepared', taskId: 'T-INSTALL', executed: false });
    });
    assert.deepStrictEqual(observed, ['agent-roles.json', 'execution-ledger.jsonl']);
    assert.strictEqual(roleStore.readRoleStore(root).ok, true);
    assert.strictEqual(fallback.readExecutionEvents(root).ok, true);
  });
  for (const producer of ['agent-roles', 'execution-ledger']) check(`actual ${producer} cleanup recovery admits its detacher file`, () => {
    const roleStore = require('../lib/role-store');
    const fallback = require('../lib/role-fallback');
    const root = directory('real-create-detacher');
    const workspace = path.join(root, '.leerness');
    const aliasPattern = new RegExp(`^\\.${producer}-create-[1-9][0-9]*-[a-f0-9]{24}$`);
    const detacherPattern = new RegExp(`^\\.${producer}-create-[1-9][0-9]*-[a-f0-9]{24}\\.detach-[1-9][0-9]*-[a-f0-9]{16}$`);
    const isAlias = target => path.dirname(String(target)) === workspace && aliasPattern.test(path.basename(String(target)));
    let unlinkFailures = 0;
    let rmFailures = 0;
    const observed = [];
    withMethod(fs, 'unlinkSync', original => function (target, ...args) {
      if (isAlias(target)) {
        unlinkFailures += 1;
        throw Object.assign(new Error('injected prepared-alias unlink failure'), { code: 'EACCES' });
      }
      return original.call(this, target, ...args);
    }, () => withMethod(fs, 'rmSync', original => function (target, ...args) {
      if (isAlias(target)) {
        rmFailures += 1;
        throw Object.assign(new Error('injected prepared-alias rm failure'), { code: 'EACCES' });
      }
      return original.call(this, target, ...args);
    }, () => withMethod(fs, 'writeFileSync', original => function (target, ...args) {
      const result = original.call(this, target, ...args);
      if (path.dirname(String(target)) === workspace && detacherPattern.test(path.basename(String(target)))) {
        observed.push({ name: path.basename(target), regular: fs.lstatSync(target).isFile(),
          report: noWrites(() => R.inspectRuntimeCompatibility(root)) });
      }
      return result;
    }, () => {
      if (producer === 'agent-roles') {
        roleStore.saveRoles(root, { coder: { provider: 'codex', model: 'synthetic-model' } }, roleStore.readRoleStore(root));
      } else fallback.appendExecutionEvent(root, { event: 'dispatch.prepared', taskId: 'T-DETACH', executed: false });
    })));
    const file = path.join(workspace, producer === 'agent-roles' ? 'agent-roles.json' : 'execution-ledger.jsonl');
    assert(unlinkFailures > 0 && rmFailures > 0, 'both real alias cleanup paths must fail before recovery');
    assert.strictEqual(Number(fs.lstatSync(file).nlink), 1, 'the installer must detach the committed inode');
    assert.strictEqual(producer === 'agent-roles' ? roleStore.readRoleStore(root).ok : fallback.readExecutionEvents(root).ok, true);
    assert.strictEqual(observed.length, 1, 'the real installer must create exactly one detacher');
    assert.strictEqual(observed[0].regular, true);
    contract(observed[0].report);
    assert.strictEqual(observed[0].report.writeDisposition, 'allowed', `${observed[0].name}: ${observed[0].report.reasonCode}`);
    noWrites(() => expect(root, 'legacy_absent'));
  });
  check('actual atomic JSON producer admits first-install temp and retained corruption shapes', () => {
    const io = require('../lib/io');
    const root = directory('real-standalone-write');
    const file = path.join(root, '.leerness', 'decisions.json');
    let temporary = 0;
    let recovery;
    withMethod(fs, 'renameSync', original => function (from, to, ...args) {
      if (String(to) === file && path.basename(String(from)).startsWith('decisions.json.tmp-')) {
        temporary += 1;
        noWrites(() => expect(root, 'legacy_absent'));
      }
      const result = original.call(this, from, to, ...args);
      if (String(from) === file && path.basename(String(to)).startsWith('decisions.json.corrupt-')) {
        recovery = String(to);
        assert(!fs.existsSync(file));
        noWrites(() => expect(root, 'legacy_absent'));
      }
      return result;
    }, () => {
      io.writeUtf8(file, '{}\n');
      write(file, sentinel);
      io.writeUtf8(file, '{"restored":true}\n');
    });
    assert.strictEqual(temporary, 2);
    assert(recovery);
    assert.strictEqual(fs.readFileSync(recovery, 'utf8'), sentinel);
    noWrites(() => expect(root, 'legacy_absent'));
  });
  check('actual concurrent standalone CLI provenance writers retain every attempt', () => {
    const fallback = require('../lib/role-fallback');
    const root = directory('concurrent-standalone-ledger');
    for (let i = 0; i < 8; i++) fallback.appendExecutionEvent(root, {
      event: 'execution.started', taskId: 'T-CONCURRENT', attemptId: `selection-${i}`, requestedRole: 'coder',
      actualExecutor: { provider: 'live', identitySource: 'synthetic-test' },
      result: { summary: 'synthetic role execution parent' }, executed: true,
    });
    nodeProbe(`
      const { spawn } = require('child_process');
      const jobs = Array.from({ length: 8 }, (_, i) => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [${JSON.stringify(CLI)}, 'agents', 'record', 'completed', 'concurrent-' + i,
          '--task', 'T-CONCURRENT', '--id', 'attempt-' + i, '--role', 'coder', '--to', 'live',
          '--target', 'selection-' + i, '--evidence', 'exit-0-' + i, '--path', process.argv[1], '--json'],
          { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, timeout: 45000, windowsHide: true });
        let output = '';
        for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-4096); });
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error('child ' + i + ' exit ' + code + ': ' + output)));
      }));
      Promise.allSettled(jobs).then(results => {
        const failures = results.filter(result => result.status === 'rejected');
        for (const result of failures) console.error(result.reason.message);
        process.exitCode = failures.length ? 1 : 0;
      });
    `, [root]);
    const history = fallback.readExecutionEvents(root, 100, { preserveAll: true });
    assert.strictEqual(history.ok, true, history.error);
    const completed = history.events.filter(event => event.taskId === 'T-CONCURRENT' && event.event === 'execution.completed');
    assert.strictEqual(completed.length, 8);
    assert.strictEqual(new Set(completed.map(event => event.attemptId)).size, 8);
    noWrites(() => expect(root, 'legacy_absent'));
  });
  check('exact role-store recovery directory is recognized without reading its contents', () => {
    const root = directory('role-recovery');
    write(path.join(root, '.leerness', 'agent-roles.json'), '{}\n');
    const recovery = path.join(root, '.leerness', '.agent-roles-cas-aB12Cd');
    write(path.join(recovery, 'before'), sentinel);
    noWrites(() => {
      withMethod(fs, 'readdirSync', original => function (file, ...args) {
        if (String(file) === recovery) throw new Error('Recovery contents must not be enumerated');
        return original.call(this, file, ...args);
      }, () => expect(root, 'legacy_absent'));
    });
  });
  for (const name of ['.agent-roles-cas-other-aB12Cd', '.agent-roles-cas-aB12Cd-extra', '.agent-roles-cas-aB12C']) {
    check(`unrelated recovery name is still foreign: ${name}`, () => {
      const root = directory('unrelated-recovery');
      write(path.join(root, '.leerness', 'agent-roles.json'), '{}\n');
      fs.mkdirSync(path.join(root, '.leerness', name));
      noWrites(() => blocked(root, 'workspace_ambiguous'));
    });
  }
  check('role recovery directory without a regular role-store sibling is refused', () => {
    const root = directory('orphan-recovery');
    fs.mkdirSync(path.join(root, '.leerness', '.agent-roles-cas-aB12Cd'), { recursive: true });
    noWrites(() => blocked(root, 'workspace_ambiguous'));
    fs.mkdirSync(path.join(root, '.leerness', 'agent-roles.json'));
    noWrites(() => blocked(root, 'workspace_ambiguous'));
  });
  check('linked role recovery directory is refused and its private target is preserved', () => {
    const root = directory('linked-recovery');
    const outside = directory('recovery-outside');
    write(path.join(root, '.leerness', 'agent-roles.json'), '{}\n');
    write(path.join(outside, 'before'), sentinel);
    fs.symlinkSync(outside, path.join(root, '.leerness', '.agent-roles-cas-aB12Cd'), linkKind);
    noWrites(() => blocked(root, 'workspace_ambiguous'));
  });
  if (process.platform !== 'win32') check('actual POSIX role-store updates remain usable with retained CAS recovery', () => {
    const roleStore = require('../lib/role-store');
    const root = directory('posix-role-cas');
    write(path.join(root, '.leerness', 'agent-roles.json'), JSON.stringify({ schemaVersion: 1,
      roles: { coder: { provider: 'codex', model: 'initial-model' } } }) + '\n');
    roleStore.saveRoles(root, { coder: { provider: 'codex', model: 'first-model' } }, roleStore.readRoleStore(root));
    const recovery = fs.readdirSync(path.join(root, '.leerness')).filter(name => /^\.agent-roles-cas-[A-Za-z0-9]{6}$/.test(name));
    assert.strictEqual(recovery.length, 1);
    const retained = path.join(root, '.leerness', recovery[0], 'before');
    const retainedBefore = signature(retained);
    noWrites(() => expect(root, 'legacy_absent'));
    roleStore.saveRoles(root, { coder: { provider: 'codex', model: 'second-model' } }, roleStore.readRoleStore(root));
    assert.strictEqual(roleStore.readRoleStore(root).roles.coder.model, 'second-model');
    assert.deepStrictEqual(signature(retained), retainedBefore);
    noWrites(() => expect(root, 'legacy_absent'));
  });
  check('an operation can create its init temporary file without reclassifying its contents', () => {
    const root = directory('init-temporary');
    const reader = R.createRuntimeCompatibilityReader(root);
    const temporary = path.join(root, '.leerness', `HARNESS_VERSION.tmp-${process.pid}-1`);
    write(temporary, '1\n');
    assert.strictEqual(reader().writeDisposition, 'allowed');
    noWrites(() => blocked(root, 'workspace_ambiguous'));
    fs.renameSync(temporary, path.join(root, '.leerness', 'HARNESS_VERSION'));
    noWrites(() => expect(root, 'legacy_absent'));
  });
  check('admitted legacy copy can be temporarily dual-live while new inspections still refuse it', () => {
    const root = directory('migration-admission');
    write(path.join(root, '.harness', 'HARNESS_VERSION'), '1\n'); // workspace-dir-legacy-fixture
    const reader = R.createRuntimeCompatibilityReader(root);
    write(path.join(root, '.leerness', 'HARNESS_VERSION'), '1\n');
    assert.strictEqual(reader().writeDisposition, 'allowed');
    noWrites(() => blocked(root, 'workspace_dir_conflict'));
    store(localDescriptor(root), 'project-local', { requiredWriterProtocol: 2 });
    assert.strictEqual(reader().reasonCode, 'layout_unsupported');
  });
  check('workspace ownership enumeration occurs once per operation', () => {
    const root = directory('enumeration-boundary');
    write(path.join(root, '.leerness', 'HARNESS_VERSION'), '1\n');
    let enumerations = 0;
    withMethod(fs, 'readdirSync', original => function (file, ...args) {
      if (String(file) === path.join(root, '.leerness')) enumerations += 1;
      return original.call(this, file, ...args);
    }, () => {
      const reader = R.createRuntimeCompatibilityReader(root);
      for (let i = 0; i < 8; i++) assert.strictEqual(reader().writeDisposition, 'allowed');
    });
    assert.strictEqual(enumerations, 1);
  });
  for (const name of ['.leerness', '.harness']) check(`new ${name} parent links are checked after admission`, () => { // workspace-dir-legacy-fixture
    const root = directory('new-workspace-link');
    const outside = directory('new-workspace-outside');
    const reader = R.createRuntimeCompatibilityReader(root);
    fs.symlinkSync(outside, path.join(root, name), linkKind);
    assert.strictEqual(reader().reasonCode, 'layout_linked');
  });
  check('missing forced workspace selection still refuses initial admission', () => {
    const root = directory('forced-missing');
    withEnv({ LEERNESS_WORKSPACE_DIR: '.harness' }, () => noWrites(() => blocked(root, 'workspace_dir_missing'))); // workspace-dir-legacy-fixture
  });

  const mainLayout = gitDescriptor(main);
  check('fixed descriptor blocks every monorepo subproject and isolates linked worktrees', () => {
    store(mainLayout, 'worktree', { requiredWriterProtocol: 2 });
    noWrites(() => {
      for (const root of [main, path.join(main, 'packages/alpha'), path.join(main, 'packages/beta')]) blocked(root, 'layout_unsupported');
      for (const root of [linkedA, linkedB]) expect(root, 'legacy_absent', 'worktree');
    });
  });
  check('empty Git projects directory blocks missing/legacy descriptors and new project names', () => {
    const projects = path.join(path.dirname(mainLayout), 'projects');
    fs.mkdirSync(projects, { recursive: true });
    fs.unlinkSync(mainLayout);
    fs.mkdirSync(path.join(main, 'packages/renamed'));
    noWrites(() => blocked(path.join(main, 'packages/renamed'), 'runtime_without_compatible_layout'));
    store(mainLayout, 'worktree');
    noWrites(() => blocked(main, 'runtime_without_compatible_layout'));
  });
  for (const name of ['state-layout.json', 'state-runtime']) check(`introducing Git preserves and refuses existing local ${name}`, () => {
    const root = directory('backend-transition');
    const indicator = path.join(root, '.leerness', 'cache', name);
    if (name.endsWith('.json')) store(indicator, 'project-local');
    else fs.mkdirSync(indicator, { recursive: true });
    git(root, ['init']);
    noWrites(() => blocked(root, 'backend_transition_unresolved'));
  });
  check('Git descriptor parent junction is refused', () => {
    const root = directory('git-parent-link');
    git(root, ['init']);
    const outside = directory('git-outside');
    store(path.join(outside, 'layout.json'), 'worktree');
    fs.symlinkSync(outside, path.join(root, '.git', 'leerness'), linkKind);
    noWrites(() => blocked(root, 'layout_linked'));
  });
  check('actual Git gateway scrubs target-changing environment overrides', () => {
    withEnv({ GIT_DIR: path.join(main, '.git'), GIT_WORK_TREE: main,
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.worktree', GIT_CONFIG_VALUE_0: main },
    () => noWrites(() => expect(linkedA, 'legacy_absent', 'worktree')));
  });
  for (const [name, value] of [['GIT_CEILING_DIRECTORIES', main], ['GIT_DISCOVERY_ACROSS_FILESYSTEM', 'true']]) {
    check(`${name} cannot change the admission authority`, () => withEnv({ [name]: value },
      () => noWrites(() => blocked(linkedA, 'discovery_override_unsupported'))));
  }
  check('default false discovery setting remains usable', () => withEnv({ GIT_DISCOVERY_ACROSS_FILESYSTEM: 'false' },
    () => noWrites(() => expect(linkedA, 'legacy_absent'))));
  check('public injected env/authority options cannot bypass process environment', () => {
    withEnv({ GIT_CEILING_DIRECTORIES: main }, () => {
      const report = R.inspectRuntimeCompatibility(linkedA, { env: {}, git: null, scope: 'project-local' });
      assert.strictEqual(report.reasonCode, 'discovery_override_unsupported');
    });
  });
  check('missing init target uses existing ancestor topology without creating directories', () => noWrites(() => {
    expect(path.join(linkedA, 'missing/new-project'), 'legacy_absent', 'worktree');
    expect(path.join(arena, 'missing/non-git-project'), 'legacy_absent', 'project-local');
    assert(!fs.existsSync(path.join(linkedA, 'missing')));
  }));
  check('existing file and invalid root cannot become init directories', () => {
    const file = path.join(arena, 'ordinary-file');
    write(file, sentinel);
    noWrites(() => {
      blocked(file, 'path_not_directory');
      for (const input of ['', '  ', `${local}\n`]) blocked(input, 'path_invalid');
    });
  });
  check('damaged gitfiles fail closed without selecting local state', () => {
    for (const body of ['gitdir: absent-metadata\n', 'invalid gitfile\n']) {
      const root = directory('bad-gitfile');
      write(path.join(root, '.git'), body);
      noWrites(() => blocked(root, 'git_repository_unavailable'));
    }
  });
  const bare = directory('bare');
  git(bare, ['init', '--bare']);
  check('bare repositories and Git metadata targets are refused', () => noWrites(() => {
    blocked(bare, 'git_bare_unsupported');
    blocked(path.join(main, '.git'), 'git_metadata_path');
  }));
  check('real missing Git permits only genuinely non-Git directories', () => {
    const emptyBin = directory('empty-bin');
    const empty = directory('no-git-empty');
    withEnv({ PATH: emptyBin }, () => noWrites(() => {
      expect(empty, 'legacy_absent', 'project-local');
      blocked(linkedA, 'git_missing');
      blocked(bare, 'git_missing');
    }));
  });
  check('bare-like damaged metadata cannot fall back even without a Git executable', () => {
    const root = directory('bare-like');
    write(path.join(root, 'HEAD'), 'damaged\n');
    fs.mkdirSync(path.join(root, 'objects'));
    fs.mkdirSync(path.join(root, 'refs'));
    noWrites(() => blocked(root));
    withEnv({ PATH: directory('bare-empty-bin') }, () => noWrites(() => blocked(root, 'git_missing')));
  });
  for (const code of ['git_timeout', 'git_output_limit', 'git_unreadable', 'git_failed']) {
    check(`discovery ${code} remains a blocked report rather than non-Git fallback`, () => {
      withMethod(SG, 'resolveGitTopology', () => () => { throw new SG.StatePathError(code, sentinel); },
        () => noWrites(() => blocked(local, code)));
    });
  }
  check('missing-Git marker scan errors do not become a permissive fallback', () => {
    withMethod(SG, 'resolveGitTopology', () => () => { throw new SG.StatePathError('git_missing', sentinel); }, () => {
      withMethod(fs, 'lstatSync', original => function (file, ...args) {
        if (String(file) === path.join(local, '.git')) throw Object.assign(new Error(sentinel), { code: 'EACCES' });
        return original.call(this, file, ...args);
      }, () => blocked(local, 'layout_unreadable'));
    });
  });

  check('one reader reuses topology while reading every descriptor change freshly', () => {
    const root = directory('fresh-reader');
    let calls = 0;
    withMethod(SG, 'resolveGitTopology', original => function (...args) { calls += 1; return original.apply(this, args); }, () => {
      const reader = R.createRuntimeCompatibilityReader(root);
      assert.strictEqual(reader().reasonCode, 'legacy_absent');
      store(localDescriptor(root), 'project-local');
      assert.strictEqual(reader().reasonCode, 'legacy_supported');
      store(localDescriptor(root), 'project-local', { requiredWriterProtocol: 2 });
      assert.strictEqual(reader().reasonCode, 'layout_unsupported');
      fs.unlinkSync(localDescriptor(root));
      fs.mkdirSync(path.join(root, '.leerness', 'cache', 'state-runtime'));
      assert.strictEqual(reader().writeDisposition, 'blocked');
      assert.strictEqual(calls, 1);
    });
  });
  check('a non-Git reader refuses Git introduced after reader construction', () => {
    const root = directory('new-git');
    const reader = R.createRuntimeCompatibilityReader(root);
    assert.strictEqual(reader().writeDisposition, 'allowed');
    git(root, ['init']);
    assert.strictEqual(reader().reasonCode, 'topology_changed');
  });
  check('a Git reader refuses a newly introduced nested repository', () => {
    const root = path.join(linkedA, 'packages/alpha');
    const reader = R.createRuntimeCompatibilityReader(root);
    assert.strictEqual(reader().writeDisposition, 'allowed');
    git(root, ['init']);
    assert.strictEqual(reader().reasonCode, 'topology_changed');
  });
  check('a missing-target reader refuses a later junction to a foreign project', () => {
    const parent = directory('init-parent');
    const target = path.join(parent, 'new-project');
    const reader = R.createRuntimeCompatibilityReader(target);
    assert.strictEqual(reader().writeDisposition, 'allowed');
    fs.symlinkSync(local, target, linkKind);
    assert.strictEqual(reader().reasonCode, 'layout_changed');
  });
  check('discovery overrides remain fresh while workspace admission lasts one operation', () => {
    const root = directory('fresh-workspace');
    const reader = R.createRuntimeCompatibilityReader(root);
    assert.strictEqual(reader().writeDisposition, 'allowed');
    withEnv({ GIT_CEILING_DIRECTORIES: arena }, () => assert.strictEqual(reader().reasonCode, 'discovery_override_unsupported'));
    write(path.join(root, '.leerness', 'HARNESS_VERSION'), '1\n');
    write(path.join(root, '.harness', 'HARNESS_VERSION'), '1\n'); // workspace-dir-legacy-fixture
    assert.strictEqual(reader().writeDisposition, 'allowed');
    noWrites(() => blocked(root, 'workspace_dir_conflict'));
  });
  check('assertion API returns allowed reports and throws bounded incompatibility errors', () => {
    const root = directory('assertion');
    assert.strictEqual(R.assertRuntimeWriteAllowed(root).writeDisposition, 'allowed');
    store(localDescriptor(root), 'project-local', { layout: sentinel });
    assert.throws(() => R.assertRuntimeWriteAllowed(root), error => {
      assert.strictEqual(error.code, 'E_RUNTIME_LAYOUT_INCOMPATIBLE');
      assert.strictEqual(error.reasonCode, 'layout_unsupported');
      assert(!String(error.message).includes(sentinel) && !String(error.message).includes(arena));
      return true;
    });
  });
  check('diagnosis launches only bounded shell-free Git discovery', () => {
    const calls = [];
    withMethod(cp, 'spawnSync', original => function (file, args, options) {
      calls.push({ file: String(file), args, options });
      return original.call(this, file, args, options);
    }, () => noWrites(() => expect(linkedB, 'legacy_absent')));
    const actualGit = calls.filter(call => /^(git|git\.exe)$/i.test(path.basename(call.file)));
    assert.strictEqual(actualGit.length, 1);
    assert(calls.every(call => /^(git|git\.exe|where\.exe)$/i.test(path.basename(call.file))));
    assert.strictEqual(actualGit[0].options.shell, false);
    assert.strictEqual(actualGit[0].options.timeout, 5000);
    assert.strictEqual(actualGit[0].options.maxBuffer, 65536);
    assert(actualGit[0].args.includes('--no-optional-locks'));
    assert(!Object.keys(actualGit[0].options.env).some(G._shouldDrop));
  });
} catch (error) {
  check('fixture setup and probe runner complete', () => { throw error; });
} finally {
  for (const key of Object.keys(process.env)) if (!(key in environmentBefore)) delete process.env[key];
  Object.assign(process.env, environmentBefore);
  check('probe preserves product and script source bytes and mtimes', () => {
    assert.deepStrictEqual(sourceFiles.map(signature), sourceBefore);
  });
  const resolvedArena = path.resolve(arena);
  if (path.dirname(resolvedArena) !== tempDirectory || !path.basename(resolvedArena).startsWith('leerness-runtime-layout-')) {
    throw new Error('Refusing cleanup outside the validated runtime-layout probe arena.');
  }
  fs.rmSync(resolvedArena, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
process.stdout.write(`RUNTIME_LAYOUT_PROBE ${total - failed}/${total} passed\n`);
process.exitCode = failed ? 1 : 0;
