#!/usr/bin/env node
'use strict';

// P-0020: exercise real Git layouts and controlled discovery failures without
// enabling runtime writers, migration, providers, or any remote operation.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const gateway = require('../lib/git');
const W = require('../lib/workspace-dir');
const I = require('../lib/state-inspect');
const SG = require('../lib/state-git');

const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-state-scopes-'));
const originalCwd = process.cwd();
const sourceFiles = ['state-git.js', 'state-paths.js', 'state-inventory.js', 'state-inspect.js']
  .map(name => path.resolve(__dirname, '..', 'lib', name));
const fileSignature = file => ({
  sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  mtimeNs: fs.statSync(file, { bigint: true }).mtimeNs.toString(),
});
const sourceBefore = sourceFiles.map(fileSignature);
const canonical = W.CANONICAL_WORKSPACE_DIR;
const legacy = W.LEGACY_WORKSPACE_DIR;
const sentinel = 'state-scopes-private-content-not-for-inspection';
const emptyConfig = path.join(arena, 'empty-gitconfig');
fs.writeFileSync(emptyConfig, '', 'utf8');
const env = { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_SYSTEM: emptyConfig,
  GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_DEFAULT_HASH: 'sha1',
  GIT_CEILING_DIRECTORIES: arena, LC_ALL: 'C', LANGUAGE: 'C', LANG: 'C' };
for (const key of Object.keys(env)) {
  if (gateway._shouldDrop(key) || key.toUpperCase() === 'LEERNESS_WORKSPACE_DIR'
    || key.toUpperCase() === 'GIT_DISCOVERY_ACROSS_FILESYSTEM') delete env[key];
}
let total = 0;
let failed = 0;
let fixtureNumber = 0;

const check = (label, fn) => {
  total += 1;
  try { fn(); process.stdout.write(`ok - ${label}\n`); }
  catch (error) {
    failed += 1;
    process.stderr.write(`not ok - ${label}: ${error.stack || error.message}\n`);
  }
};

const directory = label => {
  const root = path.join(arena, `${++fixtureNumber}-${label}`);
  fs.mkdirSync(root);
  return root;
};

const write = (root, relative, body) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
};

const git = (root, args) => {
  const result = cp.spawnSync('git', ['-C', root, ...args], {
    env, encoding: 'utf8', timeout: 30000, windowsHide: true, shell: false,
  });
  assert.strictEqual(result.status, 0, `fixture git ${args.join(' ')}: ${result.stderr || result.error || result.stdout}`);
  return String(result.stdout || '').trim();
};

const seed = root => {
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'State Scope Probe']);
  git(root, ['config', 'user.email', 'state-scope@example.invalid']);
  write(root, 'source.txt', 'fixture source\n');
  write(root, `${canonical}/HARNESS_VERSION`, '1.36.185\n');
  write(root, `${canonical}/manifest.json`, '{}\n');
  write(root, `${canonical}/state.json`, `{broken ${sentinel}`);
  write(root, `${canonical}/decisions.json`, `${sentinel}\n`);
  write(root, `${canonical}/cache/sessions/private.json`, sentinel);
  write(root, `${canonical}/runs/nested/run.json`, sentinel);
  for (const name of ['alpha', 'beta']) write(root, `packages/${name}/${canonical}/HARNESS_VERSION`, '1\n');
  git(root, ['add', '.']);
  git(root, ['-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${path.join(arena, 'disabled-hooks')}`,
    'commit', '-qm', 'state scopes fixture']);
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

const noWrites = fn => {
  // The arena includes an unrelated cwd, every project target, and every Git
  // common/private/external metadata directory. Links are recorded, not followed.
  const before = snapshot(arena);
  try { return fn(); }
  finally { assert.strictEqual(snapshot(arena), before, 'inspection changed arena bytes or mtimes'); }
};

const inspect = (root, options = {}) => noWrites(() => I.inspectState(root, { env, ...options }));
const errorCode = (fn, code) => assert.throws(fn, error => {
  assert.strictEqual(error.code, code);
  assert(!String(error.message).includes(sentinel), 'diagnostic disclosed state contents');
  assert(String(error.message).length < 1024, 'diagnostic is not bounded');
  return true;
});

const withGitResult = (resultOrFn, fn) => {
  const paths = ['../lib/state-git', '../lib/state-paths', '../lib/state-inspect'].map(require.resolve);
  const cache = paths.map(file => require.cache[file]);
  const original = gateway.gitSpawn;
  gateway.gitSpawn = typeof resultOrFn === 'function' ? resultOrFn : () => resultOrFn;
  for (const file of paths) delete require.cache[file];
  try { return fn(require('../lib/state-inspect')); }
  finally {
    gateway.gitSpawn = original;
    for (let i = 0; i < paths.length; i++) {
      delete require.cache[paths[i]];
      if (cache[i]) require.cache[paths[i]] = cache[i];
    }
  }
};

const expectedScopes = ['project', 'worktree', 'commonControl', 'immutableRecord', 'generatedView'];
const assertContract = report => {
  assert.strictEqual(report.schema, 'leerness.state-inspection/v1');
  assert.strictEqual(report.schemaVersion, 1);
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.activeLayout, 'legacy');
  assert.strictEqual(report.runtimeActivated, false);
  assert.strictEqual(report.migrationAvailable, false);
  assert.deepStrictEqual(Object.keys(report.scopes), expectedScopes);
  assert(/^project-[a-f0-9]{64}$/.test(report.projectKey));
  assert(report.inventory.length > 15 && report.inventory.length < 100);
  assert(report.inventory.every(row => row.migrationAvailable === false));
  assert(!JSON.stringify(report).includes(sentinel));
  assert(JSON.stringify(report).length < 65536, 'inspection report exceeds bounded fixture budget');
};

try {
  const cwdRoot = directory('unrelated-cwd');
  write(cwdRoot, `${canonical}/HARNESS_VERSION`, 'unrelated\n');
  process.chdir(cwdRoot);
  const mainRoot = directory('main repo 한국어');
  seed(mainRoot);
  const linkedA = path.join(arena, 'linked A α');
  const linkedB = path.join(arena, 'linked B β');
  git(mainRoot, ['worktree', 'add', '-b', 'scope-a', linkedA]);
  git(mainRoot, ['worktree', 'add', '-b', 'scope-b', linkedB]);
  let mainReport, aReport, bReport;

  check('main and two real linked worktrees expose five honest, read-only scopes', () => {
    [mainReport, aReport, bReport] = [mainRoot, linkedA, linkedB].map(root => inspect(root));
    [mainReport, aReport, bReport].forEach(assertContract);
    assert.strictEqual(mainReport.projectRelativePath, '.');
    assert.strictEqual(mainReport.git.linkedWorktree, false);
    assert.strictEqual(aReport.git.linkedWorktree, true);
    assert.strictEqual(bReport.git.linkedWorktree, true);
    assert.strictEqual(new Set([mainReport, aReport, bReport].map(r => r.scopes.worktree.proposedPath)).size, 3);
    assert.strictEqual(new Set([mainReport, aReport, bReport].map(r => r.scopes.commonControl.proposedPath)).size, 1);
    assert.strictEqual(new Set([mainReport, aReport, bReport].map(r => r.projectKey)).size, 1);
    assert([mainReport, aReport, bReport].every(r => !fs.existsSync(r.scopes.worktree.proposedPath)));
    assert(!fs.existsSync(mainReport.scopes.commonControl.proposedPath));
  });

  check('proposed scope paths match Git topology without activating or moving legacy data', () => {
    const r = inspect(linkedA);
    const key = r.projectKey;
    assert.strictEqual(r.scopes.worktree.proposedPath, path.join(r.git.gitDir, 'leerness', 'projects', key, 'runtime'));
    assert.strictEqual(r.scopes.commonControl.proposedPath, path.join(r.git.gitCommonDir, 'leerness', 'control', 'projects', key));
    assert.strictEqual(r.scopes.project.currentPath, path.join(r.projectRoot, canonical));
    assert.strictEqual(r.scopes.immutableRecord.proposedPaths.runs, path.join(r.projectRoot, canonical, 'records', 'runs'));
    assert.strictEqual(r.scopes.generatedView.proposedPaths.worktree, path.join(r.scopes.worktree.proposedPath, 'views'));
    assert.strictEqual(r.inventory.find(row => row.relativePath === 'state.json').metadata.status, 'file');
  });

  check('monorepo namespaces agree across worktrees and isolate sibling projects', () => {
    const alpha = inspect(path.join(mainRoot, 'packages', 'alpha'));
    const alphaPeer = inspect(path.join(linkedA, 'packages', 'alpha'));
    const beta = inspect(path.join(mainRoot, 'packages', 'beta'));
    assert.strictEqual(alpha.projectRelativePath, 'packages/alpha');
    assert.strictEqual(alpha.projectKey, alphaPeer.projectKey);
    assert.strictEqual(alpha.scopes.commonControl.proposedPath, alphaPeer.scopes.commonControl.proposedPath);
    assert.notStrictEqual(alpha.scopes.worktree.proposedPath, alphaPeer.scopes.worktree.proposedPath);
    assert.notStrictEqual(alpha.projectKey, beta.projectKey);
    assert.notStrictEqual(alpha.projectKey, mainReport.projectKey);
    assert.notStrictEqual(alpha.scopes.commonControl.proposedPath, beta.scopes.commonControl.proposedPath);
  });

  check('detaching and changing branch preserves worktree runtime identity', () => {
    const before = inspect(linkedA);
    git(linkedA, ['checkout', '--detach']);
    const detached = inspect(linkedA);
    git(linkedA, ['checkout', 'scope-a']);
    const restored = inspect(linkedA);
    assert.deepStrictEqual(detached.scopes, before.scopes);
    assert.deepStrictEqual(restored.scopes, before.scopes);
    assert.strictEqual(detached.projectKey, before.projectKey);
  });

  check('moving a linked worktree preserves private/control identity while updating the project path', () => {
    const before = inspect(linkedA);
    const moved = path.join(arena, 'moved linked A');
    git(mainRoot, ['worktree', 'move', linkedA, moved]);
    try {
      const report = inspect(moved);
      assert.strictEqual(report.projectRoot, fs.realpathSync.native(moved));
      assert.strictEqual(report.projectKey, before.projectKey);
      assert.strictEqual(report.git.gitDir, before.git.gitDir);
      assert.strictEqual(report.scopes.worktree.proposedPath, before.scopes.worktree.proposedPath);
      assert.strictEqual(report.scopes.commonControl.proposedPath, before.scopes.commonControl.proposedPath);
      assert.notStrictEqual(report.scopes.project.proposedPath, before.scopes.project.proposedPath);
    } finally { git(mainRoot, ['worktree', 'move', moved, linkedA]); }
  });

  const clone = path.join(arena, 'separate clone');
  git(arena, ['clone', '--no-hardlinks', mainRoot, clone]);
  check('a separate clone never shares live control despite matching relative project IDs', () => {
    const report = inspect(clone);
    assert.strictEqual(report.projectKey, mainReport.projectKey);
    assert.notStrictEqual(report.git.gitCommonDir, mainReport.git.gitCommonDir);
    assert.notStrictEqual(report.scopes.commonControl.proposedPath, mainReport.scopes.commonControl.proposedPath);
  });

  const separate = directory('separate-gitdir-worktree');
  const externalMetadata = path.join(arena, 'external Git metadata');
  git(separate, ['init', '--separate-git-dir', externalMetadata]);
  write(separate, `${canonical}/HARNESS_VERSION`, '1\n');
  check('a gitfile with separate Git metadata uses reported paths rather than .git-directory assumptions', () => {
    const report = inspect(separate);
    assert.strictEqual(report.git.gitDir, fs.realpathSync.native(externalMetadata));
    assert.strictEqual(report.git.gitCommonDir, report.git.gitDir);
    assert.strictEqual(report.git.linkedWorktree, false);
    assert(report.scopes.worktree.proposedPath.startsWith(report.git.gitDir + path.sep));
  });

  const superproject = directory('superproject');
  seed(superproject);
  git(superproject, ['-c', 'protocol.file.allow=always', 'submodule', 'add', mainRoot, 'modules/child']);
  check('an actual submodule uses its own worktree and module Git metadata', () => {
    const child = path.join(superproject, 'modules', 'child');
    const parentReport = inspect(superproject);
    const report = inspect(child);
    assert.strictEqual(report.git.worktreeRoot, fs.realpathSync.native(child));
    assert.strictEqual(report.projectRelativePath, '.');
    assert.strictEqual(report.git.gitDir, fs.realpathSync.native(path.join(superproject, '.git', 'modules', 'modules', 'child')));
    assert.notStrictEqual(report.scopes.commonControl.proposedPath, parentReport.scopes.commonControl.proposedPath);
    assert.strictEqual(report.git.gitCommonDir, report.git.gitDir);
  });

  const mixedWorkspace = directory('legacy-with-canonical-substrate');
  write(mixedWorkspace, `${legacy}/HARNESS_VERSION`, '1\n');
  write(mixedWorkspace, `${canonical}/state.json`, '{}\n');
  write(mixedWorkspace, `${canonical}/cache/sessions/private.json`, sentinel);
  check('legacy selection cannot hide existing canonical substrate or runtime metadata', () => {
    const report = inspect(mixedWorkspace);
    assert.strictEqual(report.workspace.selectedName, legacy);
    const stateRow = report.inventory.find(row => row.currentPath === path.join(mixedWorkspace, canonical, 'state.json'));
    assert(stateRow, 'existing canonical state was omitted from the inventory');
    assert.strictEqual(stateRow.metadata.status, 'file');
    assert.strictEqual(stateRow.selectedWorkspace, false);
    assert(I.formatStateInspection(report, 'en').includes(`${canonical}/state.json: file`));
  });

  const residualLegacy = directory('canonical-with-residual-legacy');
  write(residualLegacy, `${canonical}/HARNESS_VERSION`, '1\n');
  write(residualLegacy, `${legacy}/runs/run-0001.json`, '{}\n');
  check('canonical selection retains visibility of unselected legacy evidence', () => {
    const report = inspect(residualLegacy);
    assert.strictEqual(report.workspace.selectedName, canonical);
    const row = report.inventory.find(item => item.currentPath === path.join(residualLegacy, legacy, 'runs'));
    assert(row, 'residual legacy evidence was omitted from the inventory');
    assert.strictEqual(row.metadata.status, 'directory');
    assert.strictEqual(row.selectedWorkspace, false);
  });

  const alias = path.join(arena, 'alias junction Ω');
  fs.symlinkSync(linkedB, alias, process.platform === 'win32' ? 'junction' : 'dir');
  check('space, Unicode, and junction/symlink aliases resolve to one project identity', () => {
    const report = inspect(alias);
    assert.strictEqual(report.projectRoot, bReport.projectRoot);
    assert.strictEqual(report.projectKey, bReport.projectKey);
    assert.deepStrictEqual(report.scopes, bReport.scopes);
  });
  if (process.platform === 'win32') check('Windows case aliases do not produce duplicate project identities', () => {
    assert.deepStrictEqual(inspect(linkedB.toUpperCase()).scopes, bReport.scopes);
  });

  check('inherited Git repository/config overrides are scrubbed without touching the foreign clone', () => {
    const poisoned = { ...env, GIT_DIR: path.join(clone, '.git'), git_common_dir: path.join(clone, '.git'),
      GIT_WORK_TREE: clone, GIT_INDEX_FILE: path.join(clone, '.git', 'foreign-index'),
      GIT_OBJECT_DIRECTORY: path.join(clone, '.git', 'objects'), GIT_NAMESPACE: 'foreign',
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.worktree', GIT_CONFIG_VALUE_0: clone };
    const calls = [];
    const originalSpawn = cp.spawnSync;
    cp.spawnSync = function (file, args, options) {
      calls.push({ file: String(file), args, options });
      return originalSpawn.call(this, file, args, options);
    };
    let report;
    try { report = inspect(linkedB, { env: poisoned }); }
    finally { cp.spawnSync = originalSpawn; }
    assert.deepStrictEqual(report.scopes, bReport.scopes);
    const actualGit = calls.filter(call => /^(git|git\.exe)$/i.test(path.basename(call.file)));
    assert.strictEqual(actualGit.length, 1, 'topology should use one Git process');
    assert(calls.every(call => /^(git|git\.exe|where\.exe)$/i.test(path.basename(call.file))), 'a non-Git/provider process was launched');
    const call = actualGit[0];
    assert.strictEqual(call.options.shell, false);
    assert.strictEqual(call.options.timeout, 5000);
    assert.strictEqual(call.options.maxBuffer, 65536);
    assert(call.args.includes('--no-optional-locks'));
    assert(!Object.keys(call.options.env).some(gateway._shouldDrop));
    assert.strictEqual(call.options.env.GIT_CONFIG_GLOBAL, emptyConfig);
    assert.strictEqual(call.options.env.LC_ALL, 'C');
  });

  check('inventory reads metadata only and never recursively enumerates runtime or run contents', () => {
    const stateDir = path.join(mainRoot, canonical);
    const originalRead = fs.readFileSync;
    const originalDir = fs.readdirSync;
    const originalLstat = fs.lstatSync;
    const contentReads = [], directoryReads = [], cacheStats = [];
    fs.readFileSync = function (file, ...args) {
      const absolute = typeof file === 'string' ? path.resolve(file) : '';
      if (absolute === stateDir || absolute.startsWith(stateDir + path.sep)) {
        contentReads.push(absolute); throw new Error('state content must not be read');
      }
      return originalRead.call(this, file, ...args);
    };
    fs.readdirSync = function (file, ...args) {
      const absolute = path.resolve(String(file));
      if (absolute.startsWith(stateDir + path.sep)) {
        directoryReads.push(absolute); throw new Error('nested state directories must not be traversed');
      }
      return originalDir.call(this, file, ...args);
    };
    fs.lstatSync = function (file, ...args) {
      if (path.resolve(String(file)) === path.join(stateDir, 'cache')) cacheStats.push(String(file));
      return originalLstat.call(this, file, ...args);
    };
    let report;
    try { report = I.inspectState(mainRoot, { env }); }
    finally { fs.readFileSync = originalRead; fs.readdirSync = originalDir; fs.lstatSync = originalLstat; }
    assertContract(report);
    assert.deepStrictEqual(contentReads, []);
    assert.deepStrictEqual(directoryReads, []);
    assert.strictEqual(cacheStats.length, 1, 'inventory should cache shared parent metadata');
  });

  const linkedState = directory('linked-state-parents');
  const outsideState = directory('outside-state-target');
  write(linkedState, `${canonical}/HARNESS_VERSION`, '1\n');
  write(outsideState, 'sessions/must-not-read.json', sentinel);
  fs.symlinkSync(outsideState, path.join(linkedState, canonical, 'cache'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(outsideState, path.join(linkedState, canonical, 'state.json'), process.platform === 'win32' ? 'junction' : 'dir');
  check('linked inventory parents are blocked and final links are described without following them', () => {
    const report = inspect(linkedState);
    assert(report.inventory.filter(row => row.relativePath.startsWith('cache/')).every(row => row.metadata.status === 'blocked' && row.metadata.parentStatus === 'link'));
    assert.strictEqual(report.inventory.find(row => row.relativePath === 'state.json').metadata.status, 'link');
  });

  const noGit = directory('empty-non-git');
  check('empty non-Git projects expose only an explicit local fallback and never initialize it', () => {
    const report = inspect(noGit);
    assertContract(report);
    assert.strictEqual(report.git, null);
    assert.strictEqual(report.workspace.status, 'absent');
    assert.strictEqual(report.scopes.worktree.backend, 'project-local-fallback');
    assert.strictEqual(report.scopes.commonControl.proposedPath, null);
    assert.strictEqual(report.scopes.commonControl.available, false);
    assert(report.warnings.includes('non_git_no_common_control'));
    assert.deepStrictEqual(fs.readdirSync(noGit), []);
  });

  check('legacy selection is reported honestly without migration or cache creation', () => {
    const root = directory('legacy-workspace');
    write(root, `${legacy}/HARNESS_VERSION`, '1.36.161\n');
    write(root, `${legacy}/decisions.json`, `{broken ${sentinel}`);
    const report = inspect(root);
    assert.strictEqual(report.workspace.selectedName, legacy);
    assert.strictEqual(report.scopes.project.currentPath, path.join(root, legacy));
    assert.strictEqual(report.scopes.project.proposedPath, path.join(root, canonical));
    assert(report.warnings.includes('legacy_workspace_not_migrated'));
    assert(!fs.existsSync(path.join(root, canonical)));
  });
  check('foreign canonical content is a warning, not an initialized runtime', () => {
    const root = directory('foreign-workspace');
    write(root, `${canonical}/user-notes.md`, sentinel);
    const report = inspect(root);
    assert.strictEqual(report.workspace.status, 'foreign');
    assert(report.warnings.includes('workspace_not_recognized'));
  });
  check('conflicting live stores fail with the existing workspace error instead of choosing a winner', () => {
    const root = directory('conflict');
    write(root, `${canonical}/HARNESS_VERSION`, '1\n');
    write(root, `${legacy}/HARNESS_VERSION`, '2\n');
    errorCode(() => inspect(root), 'E_WORKSPACE_DIR_CONFLICT');
  });
  check('workspace directory links remain rejected without writes', () => {
    const root = directory('linked-workspace');
    fs.symlinkSync(outsideState, path.join(root, canonical), process.platform === 'win32' ? 'junction' : 'dir');
    errorCode(() => inspect(root), 'E_WORKSPACE_DIR_SYMLINK');
  });
  check('explicit workspace override precedence is preserved by the new path API', () => {
    const root = directory('forced-workspace');
    fs.mkdirSync(path.join(root, canonical));
    fs.mkdirSync(path.join(root, legacy));
    const overridden = { ...env, LEERNESS_WORKSPACE_DIR: legacy };
    assert.strictEqual(inspect(root, { env: overridden }).workspace.selectedName, legacy);
    assert.strictEqual(inspect(root, { env: overridden, envValue: canonical }).workspace.selectedName, canonical);
    assert.strictEqual(inspect(root, { env: overridden, envValue: null }).workspace.selectedName, canonical);
  });
  check('human format explains proposal-only status and preserves machine fields', () => {
    const report = inspect(noGit);
    const before = JSON.stringify(report);
    const en = I.formatStateInspection(report, 'en');
    const ko = I.formatStateInspection(report, 'ko');
    assert(en.includes('runtime NOT activated') && en.includes('unavailable (non-Git)'));
    assert(ko.includes('읽기 전용') && ko.includes('마이그레이션 미구현'));
    assert.strictEqual(JSON.stringify(report), before);
  });

  const fileTarget = path.join(noGit, 'ordinary-file');
  fs.writeFileSync(fileTarget, 'not-directory');
  for (const [label, value, code] of [
    ['missing directory', path.join(arena, 'does-not-exist'), 'path_not_found'],
    ['file target', fileTarget, 'path_not_directory'],
    ['empty path', '', 'path_invalid'],
    ['whitespace path', '  ', 'path_invalid'],
    ['control-character path', `${noGit}\n`, 'path_invalid'],
  ]) check(`${label} fails without selecting or creating another backend`, () => errorCode(() => inspect(value), code));

  const bare = directory('bare');
  git(bare, ['init', '--bare']);
  check('bare repository inspection fails explicitly', () => errorCode(() => inspect(bare), 'git_bare_unsupported'));
  check('Git metadata directory is not mistaken for a worktree project', () => errorCode(() => inspect(mainReport.git.gitDir), 'git_metadata_path'));
  for (const content of ['gitdir: missing-metadata\n', 'malformed gitfile\n']) {
    check(`broken gitfile cannot fall back to project-local runtime: ${content.trim()}`, () => {
      const root = directory('broken-gitfile');
      write(root, '.git', content);
      errorCode(() => inspect(root), 'git_repository_unavailable');
    });
  }
  check('discovery ceiling is honored without reading the excluded parent repository', () => {
    const report = inspect(path.join(mainRoot, 'packages', 'alpha'), { env: { ...env, GIT_CEILING_DIRECTORIES: mainRoot } });
    assert.strictEqual(report.git, null);
    assert.strictEqual(report.scopes.commonControl.available, false);
  });
  check('nonexistent discovery ceiling entries retain Git semantics instead of becoming path errors', () => {
    const report = inspect(noGit, { env: { ...env, GIT_CEILING_DIRECTORIES: path.join(arena, 'missing-ceiling') } });
    assert.strictEqual(report.git, null);
  });

  check('actually missing Git on PATH has an explicit missing-tool error on this platform', () => {
    const missingEnv = { ...env };
    for (const key of Object.keys(missingEnv)) if (key.toUpperCase() === 'PATH') delete missingEnv[key];
    missingEnv.PATH = directory('empty-bin');
    errorCode(() => inspect(noGit, { env: missingEnv }), 'git_missing');
  });

  for (const [errno, expected] of [['ENOENT', 'git_missing'], ['ETIMEDOUT', 'git_timeout'],
    ['ENOBUFS', 'git_output_limit'], ['EACCES', 'git_unreadable'], ['EPERM', 'git_unreadable'], ['EIO', 'git_failed']]) {
    check(`gateway ${errno} failure remains explicit and does not select a fallback`, () => {
      withGitResult({ status: null, error: Object.assign(new Error('controlled failure'), { code: errno }), stdout: '', stderr: '' },
        module => noWrites(() => errorCode(() => module.inspectState(noGit, { env }), expected)));
    });
  }
  const gitDir = mainReport.git.gitDir;
  const topology = `false\nfalse\n${mainReport.git.worktreeRoot}\n${gitDir}\n${gitDir}\n`;
  for (const [label, result, expected] of [
    ['unsupported flag echo', { status: 0, stdout: `--path-format=absolute\n${topology}`, stderr: '' }, 'git_unsupported'],
    ['short topology', { status: 0, stdout: 'false\nfalse\n', stderr: '' }, 'git_output_invalid'],
    ['relative topology', { status: 0, stdout: 'false\nfalse\n.\n.git\n.git\n', stderr: '' }, 'git_output_invalid'],
    ['extra topology line', { status: 0, stdout: topology + 'unexpected\n', stderr: '' }, 'git_output_invalid'],
    ['generic discovery failure', { status: 128, stdout: '', stderr: sentinel }, 'git_repository_unavailable'],
    ['permission denial', { status: 128, stdout: '', stderr: 'fatal: Permission denied' }, 'git_unreadable'],
    ['portable missing-tool denial', { status: 127, stdout: '', stderr: 'leerness: command not found on PATH: git\n' }, 'git_missing'],
    ['portable unsupported-shim denial', { status: 126, stdout: '', stderr: 'leerness: unsupported Windows command shim: C:/probe/git.cmd\n' }, 'git_unsupported'],
  ]) check(`${label} is bounded, fail-closed, and never exposes raw output`, () => {
    withGitResult(result, module => noWrites(() => errorCode(() => module.inspectState(mainRoot, { env }), expected)));
  });
  check('a successful but foreign Git topology is rejected', () => {
    withGitResult({ status: 0, stdout: topology, stderr: '' }, module => noWrites(() => {
      errorCode(() => module.inspectState(noGit, { env }), 'git_repository_unavailable');
    }));
  });
  check('missing directories returned by Git use a repository error, not a target-path error', () => {
    const missingGit = path.join(arena, 'missing-returned-git-dir');
    withGitResult({ status: 0, stdout: `false\nfalse\n${mainRoot}\n${missingGit}\n${missingGit}\n`, stderr: '' },
      module => noWrites(() => errorCode(() => module.inspectState(mainRoot, { env }), 'git_repository_unavailable')));
  });
  check('inaccessible directories returned by Git use a bounded Git permission error', () => {
    noWrites(() => {
      const original = fs.realpathSync.native;
      fs.realpathSync.native = function (file, ...args) {
        if (path.resolve(String(file)) === gitDir) throw Object.assign(new Error(sentinel), { code: 'EACCES' });
        return original.call(this, file, ...args);
      };
      try {
        withGitResult({ status: 0, stdout: topology, stderr: '' },
          module => errorCode(() => module.inspectState(mainRoot, { env }), 'git_unreadable'));
      } finally { fs.realpathSync.native = original; }
    });
  });
  for (const statTarget of [noGit, arena]) {
    check(`marker discovery stat failure remains a bounded Git error: ${path.basename(statTarget)}`, () => {
      noWrites(() => {
        const original = fs.statSync;
        fs.statSync = function (file, ...args) {
          if (path.resolve(String(file)) === statTarget) throw Object.assign(new Error(sentinel), { code: 'EACCES' });
          return original.call(this, file, ...args);
        };
        try {
          withGitResult({ status: 128, stdout: '', stderr: 'fatal: not a git repository (or any of the parent directories): .git' }, () => {
            const module = require('../lib/state-git');
            errorCode(() => module.resolveGitTopology(noGit, { env: { ...env, GIT_CEILING_DIRECTORIES: '' } }), 'git_unreadable');
          });
        } finally { fs.statSync = original; }
      });
    });
  }
  check('path resolution permission failures produce bounded errors without filesystem changes', () => {
    const original = fs.realpathSync.native;
    fs.realpathSync.native = () => { throw Object.assign(new Error(sentinel), { code: 'EACCES' }); };
    try { errorCode(() => SG.canonicalDirectory(noGit), 'path_unreadable'); }
    finally { fs.realpathSync.native = original; }
  });
  for (const method of ['lstatSync', 'readdirSync']) {
    check(`${method} permission denial cannot turn a workspace into missing or empty state`, () => {
      noWrites(() => {
        const original = fs[method];
        fs[method] = function (file, ...args) {
          if (path.resolve(String(file)) === path.join(mainRoot, canonical)) {
            throw Object.assign(new Error(sentinel), { code: 'EACCES' });
          }
          return original.call(this, file, ...args);
        };
        try { errorCode(() => I.inspectState(mainRoot, { env }), 'workspace_unreadable'); }
        finally { fs[method] = original; }
      });
    });
  }
  check('an unreadable inventory file is described honestly rather than silently absent', () => {
    noWrites(() => {
      const original = fs.lstatSync;
      fs.lstatSync = function (file, ...args) {
        if (path.resolve(String(file)) === path.join(mainRoot, canonical, 'state.json')) {
          throw Object.assign(new Error(sentinel), { code: 'EACCES' });
        }
        return original.call(this, file, ...args);
      };
      let report;
      try { report = I.inspectState(mainRoot, { env }); }
      finally { fs.lstatSync = original; }
      const row = report.inventory.find(item => item.relativePath === 'state.json');
      assert.strictEqual(row.metadata.status, 'unreadable');
      assert.strictEqual(row.metadata.errorCode, 'EACCES');
      assert(!JSON.stringify(report).includes(sentinel));
    });
  });
} catch (error) {
  check('fixture setup and probe runner complete', () => { throw error; });
} finally {
  process.chdir(originalCwd);
  check('module probe does not edit any product source bytes or mtimes', () => {
    assert.deepStrictEqual(sourceFiles.map(fileSignature), sourceBefore);
  });
  const resolvedArena = path.resolve(arena);
  if (path.dirname(resolvedArena) !== path.resolve(os.tmpdir()) || !path.basename(resolvedArena).startsWith('leerness-state-scopes-')) {
    throw new Error(`refusing cleanup outside the probe arena: ${resolvedArena}`);
  }
  fs.rmSync(resolvedArena, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

process.stdout.write(`STATE_SCOPES_PROBE ${total - failed}/${total} passed\n`);
process.exitCode = failed ? 1 : 0;
