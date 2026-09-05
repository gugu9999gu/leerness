#!/usr/bin/env node
'use strict';

// T-0095 regression probe: read/status commands must state what they actually
// measured. A CLI version is not a project version, an invalid memory verb is
// not an unknown top-level command, and a damaged preview store is not empty.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { gitSpawn } = require('../lib/git');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
// Fixtures deliberately cover both canonical and legacy workspace layouts.
// A supported parent-shell override must not silently rewrite that fixture
// contract (Windows environment keys are case-insensitive, so normalize).
const fixtureGitConfigRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-false-claim-git-config-'));
function isolateFixtureGitConfig(baseEnv, dir, label = 'fixture') {
  const out = { ...baseEnv };
  for (const key of Object.keys(out)) {
    if (key.toUpperCase() === 'GIT_CONFIG_GLOBAL' || key.toUpperCase() === 'GIT_CONFIG_SYSTEM') delete out[key];
  }
  fs.mkdirSync(dir, { recursive: true });
  out.GIT_CONFIG_GLOBAL = path.join(dir, `${label}-global.gitconfig`);
  out.GIT_CONFIG_SYSTEM = path.join(dir, `${label}-system.gitconfig`);
  fs.writeFileSync(out.GIT_CONFIG_GLOBAL, '', 'utf8');
  fs.writeFileSync(out.GIT_CONFIG_SYSTEM, '', 'utf8');
  return out;
}
// Product Git calls preserve persistent config by design. Fixtures instead use
// empty temp configs so a caller's core.hooksPath cannot execute foreign hooks.
const env = isolateFixtureGitConfig(process.env, fixtureGitConfigRoot);
for (const key of Object.keys(env)) {
  if (key.toUpperCase() === 'LEERNESS_WORKSPACE_DIR' || key.toUpperCase() === 'LEERNESS_INTERNAL') delete env[key];
}
Object.assign(env, {
  LEERNESS_OFFLINE: '1',
  LEERNESS_NO_PROMPT: '1',
  LEERNESS_NO_AUTOCHCP: '1',
  LEERNESS_NO_BANNER: '1',
  LEERNESS_NO_WORKFLOW_GUIDE: '1',
  LEERNESS_NO_AUTO_ROADMAP: '1',
  LEERNESS_NO_STALE_CHECK: '1',
});

function mergedEnv(overrides = {}) {
  const out = { ...env };
  for (const key of Object.keys(overrides)) {
    for (const inherited of Object.keys(out)) {
      if (inherited.toUpperCase() === key.toUpperCase()) delete out[inherited];
    }
    out[key] = overrides[key];
  }
  return out;
}

function fixtureGit(root, args, envOverride = {}) {
  return gitSpawn(args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    env: mergedEnv(envOverride),
  });
}

function run(root, args, timeout = 60000, addPath = true, envOverride = {}) {
  return cp.spawnSync(process.execPath, [CLI, ...args, ...(addPath ? ['--path', root] : [])], {
    cwd: root,
    encoding: 'utf8',
    timeout,
    env: mergedEnv(envOverride),
  });
}

function mcpCall(serverRoot, name, args, envOverride = {}) {
  const request = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  }) + '\n';
  const processResult = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], {
    cwd: serverRoot,
    input: request,
    encoding: 'utf8',
    timeout: 120000,
    env: mergedEnv(envOverride),
  });
  let message = null;
  try {
    const line = String(processResult.stdout || '').split(/\r?\n/).find(Boolean);
    if (line) message = JSON.parse(line);
  } catch {}
  return { processResult, message };
}

function json(result) {
  try { return JSON.parse(result.stdout || ''); } catch { return null; }
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function treeDigest(root) {
  const hash = crypto.createHash('sha256');
  function visit(dir, rel = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const nextRel = rel ? path.join(rel, entry.name) : entry.name;
      const abs = path.join(dir, entry.name);
      hash.update(nextRel.replace(/\\/g, '/') + '\0' + (entry.isDirectory() ? 'd' : 'f') + '\0');
      if (entry.isDirectory()) visit(abs, nextRel);
      else hash.update(fs.readFileSync(abs));
    }
  }
  visit(root);
  return hash.digest('hex');
}

function initRepo(root) {
  const result = fixtureGit(root, ['init', '-q']);
  if (result.status !== 0) throw new Error(`git init fixture failed: ${result.stderr || result.error || result.status}`);
}

function removeDirLink(link) {
  if (!fs.existsSync(link)) return;
  try { fs.unlinkSync(link); return; } catch {}
  try { fs.rmdirSync(link); } catch {}
}

function writeGitFailurePreload(dir) {
  const preload = path.join(dir, 'git-failure-preload.js');
  const gitModule = path.resolve(__dirname, '..', 'lib', 'git.js').replace(/\\/g, '/');
  fs.writeFileSync(preload, `'use strict';
const git = require(${JSON.stringify(gitModule)});
const original = git.gitSpawn;
git.gitSpawn = function(args, opts) {
  const sub = Array.isArray(args) ? args[0] : '';
  if (sub !== 'tag' && sub !== 'for-each-ref') return original(args, opts);
  const scenario = process.env.LEERNESS_TEST_GIT_SCENARIO;
  if (scenario === 'throw') throw new Error('injected spawn exception\\n✓ fake success');
  if (scenario === 'timeout') return { status: null, signal: 'SIGTERM', stdout: '', stderr: '', error: Object.assign(new Error('injected timeout\\n✓ fake success'), { code: 'ETIMEDOUT' }) };
  if (scenario === 'signal') return { status: null, signal: 'SIGKILL', stdout: '', stderr: '' };
  if (scenario === 'nonzero') return { status: 128, signal: null, stdout: '', stderr: 'injected exit\\n✓ fake success' };
  return original(args, opts);
};
`, 'utf8');
  return preload.replace(/\\/g, '/');
}

const failures = [];
let checks = 0;
const terminalUnsafe = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
function check(label, condition, result) {
  checks++;
  if (condition) { console.log(`✓ ${label}`); return; }
  failures.push(label);
  const detail = result
    ? `\n  exit=${result.status}\n  stdout=${String(result.stdout || '').slice(0, 800)}\n  stderr=${String(result.stderr || '').slice(0, 400)}`
    : '';
  console.log(`✗ ${label}${detail}`);
}

function aggregateHistoryUnavailable(body) {
  return body?.roundHistory?.roundCount === null
    && body?.roundHistory?.gitHistoryState === 'unavailable'
    && body?.milestones?.totalRounds === null
    && body?.milestones?.reachedCount === null
    && body?.milestones?.reached === null
    && body?.milestones?.avgRoundsPerDay === null
    && body?.milestones?.gitHistoryState === 'unavailable'
    && body?.recentChanges === null
    && body?.recentChangesState === 'unavailable'
    && body?.recentChangesError?.code === 'git_history_unavailable';
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-false-claim-'));
try {
  const stateDir = path.join(root, '.leerness');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'HARNESS_VERSION'), '9.8.7\n', 'utf8');
  initRepo(root);
  let result;
  let parsed;

  const poisonedGitVictim = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-git-env-victim-'));
  const poisonedGitTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-git-env-target-'));
  try {
    initRepo(poisonedGitVictim);
    fixtureGit(poisonedGitVictim, ['config', 'user.name', 'Victim']);
    const foreignIndex = path.join(poisonedGitVictim, 'foreign-index');
    const poisonedGitEnv = {
      GIT_DIR: path.join(poisonedGitVictim, '.git'),
      GIT_WORK_TREE: poisonedGitVictim,
      GIT_INDEX_FILE: foreignIndex,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'user.email',
      GIT_CONFIG_VALUE_0: 'poisoned@example.invalid',
    };
    const targetInit = fixtureGit(poisonedGitTarget, ['init', '-q'], poisonedGitEnv);
    const targetNameSet = fixtureGit(poisonedGitTarget, ['config', 'user.name', 'Target'], poisonedGitEnv);
    const targetName = fixtureGit(poisonedGitTarget, ['config', '--local', '--get', 'user.name']);
    const victimName = fixtureGit(poisonedGitVictim, ['config', '--local', '--get', 'user.name']);
    const targetEmail = fixtureGit(poisonedGitTarget, ['config', '--local', '--get', 'user.email']);
    check('test Git fixture helper strips foreign repository/index/config injection from inherited environments',
      targetInit.status === 0
        && targetNameSet.status === 0
        && fs.existsSync(path.join(poisonedGitTarget, '.git'))
        && String(targetName.stdout || '').trim() === 'Target'
        && String(victimName.stdout || '').trim() === 'Victim'
        && targetEmail.status !== 0
        && !fs.existsSync(foreignIndex),
      targetInit);

    const foreignHooks = path.join(poisonedGitVictim, 'foreign-hooks');
    const foreignHookMarker = path.join(poisonedGitVictim, 'foreign-hook-fired.txt');
    fs.mkdirSync(foreignHooks, { recursive: true });
    const foreignHook = path.join(foreignHooks, 'post-commit');
    fs.writeFileSync(foreignHook,
      `#!/bin/sh\nprintf fired > ${JSON.stringify(foreignHookMarker.replace(/\\/g, '/'))}\n`, 'utf8');
    fs.chmodSync(foreignHook, 0o755);
    const poisonedPersistentConfig = path.join(poisonedGitVictim, 'poisoned-global.gitconfig');
    fs.writeFileSync(poisonedPersistentConfig,
      `[core]\n\thooksPath = ${foreignHooks.replace(/\\/g, '/')}\n`, 'utf8');
    const simulatedParentEnv = { ...process.env, GIT_CONFIG_GLOBAL: poisonedPersistentConfig };
    const isolatedPersistentEnv = isolateFixtureGitConfig(
      simulatedParentEnv, path.join(fixtureGitConfigRoot, 'persistent-parent'), 'persistent-parent');
    const poisonedConfigVisible = gitSpawn(['config', '--global', '--get', 'core.hooksPath'], {
      cwd: poisonedGitTarget, encoding: 'utf8', timeout: 60000, env: simulatedParentEnv,
    });
    const isolatedOverrides = {
      GIT_CONFIG_GLOBAL: isolatedPersistentEnv.GIT_CONFIG_GLOBAL,
      GIT_CONFIG_SYSTEM: isolatedPersistentEnv.GIT_CONFIG_SYSTEM,
    };
    fixtureGit(poisonedGitTarget, ['config', 'user.email', 'target@example.invalid'], isolatedOverrides);
    fs.writeFileSync(path.join(poisonedGitTarget, 'persistent-config.txt'), 'isolated\n', 'utf8');
    fixtureGit(poisonedGitTarget, ['add', 'persistent-config.txt'], isolatedOverrides);
    const isolatedCommit = fixtureGit(poisonedGitTarget, ['commit', '-qm', 'persistent config isolation'], isolatedOverrides);
    check('test Git fixture helper replaces inherited persistent global/system config before fixture commits',
      poisonedConfigVisible.status === 0
        && String(poisonedConfigVisible.stdout || '').trim().replace(/\\/g, '/') === foreignHooks.replace(/\\/g, '/')
        && isolatedCommit.status === 0
        && !fs.existsSync(foreignHookMarker),
      isolatedCommit);
  } finally {
    fs.rmSync(poisonedGitTarget, { recursive: true, force: true });
    fs.rmSync(poisonedGitVictim, { recursive: true, force: true });
  }

  const missingRoot = path.join(root, 'definitely-missing');
  result = run(root, ['release', 'cadence', missingRoot, '--json'], 60000, false);
  parsed = json(result);
  check('release cadence rejects an explicit nonexistent project path',
    result.status === 1
      && parsed?.code === 'path_not_found'
      && /definitely-missing/.test(parsed?.error || ''),
    result);

  result = run(root, ['release', 'cadence', '--json']);
  parsed = json(result);
  check('release cadence reports that a repository without a tag interval has insufficient data',
    result.status === 0
      && parsed?.level === 'insufficient-data'
      && parsed?.dataSufficient === false
      && !/healthy/i.test(parsed?.recommendation || ''),
    result);

  const noGitPath = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-no-git-path-'));
  try {
    for (const args of [
      ['round-history', '--json'],
      ['release', 'cadence', '--json'],
      ['milestones', '--json'],
    ]) {
      result = run(root, args, 60000, true, { PATH: noGitPath });
      parsed = json(result);
      check(`${args[0]} fails closed when Git history cannot be measured`,
        result.status === 1
          && parsed?.code === 'git_history_unavailable'
          && /git/i.test(parsed?.error || ''),
        result);
    }

    result = run(root, ['pulse', '--json'], 60000, true, { PATH: noGitPath });
    parsed = json(result);
    check('pulse preserves an unavailable Git-history state instead of reporting R0',
      result.status === 0
        && parsed?.roundCount === null
        && parsed?.gitHistoryState === 'unavailable'
        && parsed?.roundHistoryError?.code === 'git_history_unavailable',
      result);

    for (const aggregate of [
      { label: 'health', args: ['health', '--json'], timeout: 180000 },
      { label: 'handoff', args: ['handoff', '--json', '--no-record', '--no-drift-check', '--no-headline'], timeout: 180000 },
      { label: 'session close', args: ['session', 'close', '--json'], timeout: 300000 },
    ]) {
      result = run(root, aggregate.args, aggregate.timeout, true, { PATH: noGitPath });
      parsed = json(result);
      check(`${aggregate.label} preserves null/error provenance when Git is unavailable`,
        result.status === 0 && aggregateHistoryUnavailable(parsed), result);
    }
  } finally {
    fs.rmSync(noGitPath, { recursive: true, force: true });
  }

  const preloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-git-failure-preload-'));
  try {
    const preload = writeGitFailurePreload(preloadDir);
    const expectedReason = { throw: 'spawn_exception', timeout: 'timeout', signal: 'signal', nonzero: 'exit_128' };
    for (const scenario of Object.keys(expectedReason)) {
      const injectedEnv = { NODE_OPTIONS: `--require=${preload}`, LEERNESS_TEST_GIT_SCENARIO: scenario };
      for (const direct of [
        { label: 'round-history', args: ['round-history', '--json'] },
        { label: 'milestones', args: ['milestones', '--json'] },
        { label: 'release cadence', args: ['release', 'cadence', '--json'] },
      ]) {
        result = run(root, direct.args, 60000, true, injectedEnv);
        parsed = json(result);
        check(`${direct.label} exposes injected Git ${scenario} failure`,
          result.status === 1
            && parsed?.code === 'git_history_unavailable'
            && !/[\r\n\u2028\u2029]/.test(parsed?.error || ''),
          result);
      }

      result = run(root, ['pulse', '--json'], 60000, true, injectedEnv);
      parsed = json(result);
      check(`pulse preserves null/error provenance for injected Git ${scenario} failure`,
        result.status === 0
          && parsed?.roundCount === null
          && parsed?.gitHistoryState === 'unavailable'
          && parsed?.gitHistoryError?.reason === expectedReason[scenario],
        result);

      for (const aggregate of [
        { label: 'health', args: ['health', '--json'], timeout: 180000 },
        { label: 'handoff', args: ['handoff', '--json', '--no-record', '--no-drift-check', '--no-headline'], timeout: 180000 },
        { label: 'session close', args: ['session', 'close', '--json'], timeout: 300000 },
      ]) {
        result = run(root, aggregate.args, aggregate.timeout, true, injectedEnv);
        parsed = json(result);
        check(`${aggregate.label} preserves nulls for injected Git ${scenario} failure`,
          result.status === 0
            && aggregateHistoryUnavailable(parsed)
            && parsed?.roundHistory?.gitHistoryError?.reason === expectedReason[scenario]
            && parsed?.recentChangesError?.reason === expectedReason[scenario],
          result);
      }
    }
  } finally {
    fs.rmSync(preloadDir, { recursive: true, force: true });
  }

  const successfulAggregateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-recent-changes-compat-'));
  try {
    const aggregateState = path.join(successfulAggregateRoot, '.leerness');
    fs.mkdirSync(aggregateState, { recursive: true });
    fs.writeFileSync(path.join(aggregateState, 'HARNESS_VERSION'), '9.8.7\n', 'utf8');
    initRepo(successfulAggregateRoot);
    fixtureGit(successfulAggregateRoot, ['config', 'user.email', 'false-claim@example.invalid']);
    fixtureGit(successfulAggregateRoot, ['config', 'user.name', 'False Claim Probe']);
    fs.writeFileSync(path.join(successfulAggregateRoot, 'tracked.txt'), 'tagged\n', 'utf8');
    fixtureGit(successfulAggregateRoot, ['add', 'tracked.txt']);
    fixtureGit(successfulAggregateRoot, ['commit', '-qm', '1.2.3 — aggregate compatibility']);
    fixtureGit(successfulAggregateRoot, ['tag', 'v1.2.3']);
    result = run(successfulAggregateRoot, ['round-history', '--json']);
    parsed = json(result);
    const latestTag = parsed?.latestTags?.find(item => item?.version === '1.2.3');
    check('round-history preserves the established full latestTags date and adds a separate dateOnly projection',
      result.status === 0
        && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}$/.test(latestTag?.date || '')
        && latestTag?.dateOnly === latestTag?.date.slice(0, 10),
      result);
    for (const aggregate of [
      { label: 'health', args: ['health', '--json'], timeout: 180000 },
      { label: 'handoff', args: ['handoff', '--json', '--no-record', '--no-drift-check', '--no-headline'], timeout: 180000 },
      { label: 'session close', args: ['session', 'close', '--json'], timeout: 300000 },
    ]) {
      result = run(successfulAggregateRoot, aggregate.args, aggregate.timeout);
      parsed = json(result);
      check(`${aggregate.label} preserves the successful recentChanges array contract and adds sibling provenance`,
        result.status === 0
          && Array.isArray(parsed?.recentChanges)
          && parsed.recentChanges.some(item => item?.version === '1.2.3')
          && parsed?.recentChangesState === 'available'
          && parsed?.recentChangesError === null,
        result);
    }
  } finally {
    fs.rmSync(successfulAggregateRoot, { recursive: true, force: true });
  }

  const usagePath = path.join(stateDir, 'cache', 'usage-stats.json');
  const telemetryEnvIsHermetic = !Object.keys(env).some(key => key.toUpperCase() === 'LEERNESS_INTERNAL');
  const usageBeforeReadOnly = fs.existsSync(usagePath) ? fs.readFileSync(usagePath, 'utf8') : null;
  const { _cliMutationClass } = require('../bin/leerness.js');
  check('central CLI mutation classifier covers every reviewed observation-only route', [
    ['auto-update', ['auto-update', 'status']],
    ['dashboard', ['dashboard']],
    ['security-surface', ['security-surface']],
    ['preview', ['preview']],
    ['preview', ['preview', 'list']],
    ['preview', ['preview', 'show', 'P-0001']],
    ['state', ['state', 'inspect']],
  ].every(([cmd, argv]) => _cliMutationClass(argv, cmd) === 'observation-only'));
  let readOnlyStatusesOk = true;
  for (const args of [
    ['about', '--json'],
    ['identity', '--json'],
    ['status', '--json'],
    ['commands', '--json'],
    ['install-safety', '--json'],
    ['capabilities', '--json'],
    ['round-history', '--json'],
    ['milestones', '--json'],
    ['pulse', '--json'],
    ['release', 'cadence', '--json'],
    ['auto-update', 'status', '--json'],
    ['dashboard', '--json'],
    ['security-surface', '--json'],
    ['preview', '--json'],
    ['preview', 'list', '--json'],
    ['state', 'inspect', '--json'],
  ]) {
    const readOnlyResult = run(root, args);
    if (readOnlyResult.status !== 0) readOnlyStatusesOk = false;
  }
  const usageAfterReadOnly = fs.existsSync(usagePath) ? fs.readFileSync(usagePath, 'utf8') : null;
  check('direct read-only CLI commands exercise real telemetry policy without LEERNESS_INTERNAL and write no usage',
    telemetryEnvIsHermetic && readOnlyStatusesOk && usageAfterReadOnly === usageBeforeReadOnly, null);

  const legacyObservationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-observation-only-legacy-'));
  try {
    const legacyObservationState = path.join(legacyObservationRoot, '.harness'); // workspace-dir-legacy-fixture
    fs.mkdirSync(legacyObservationState, { recursive: true });
    fs.writeFileSync(path.join(legacyObservationState, 'HARNESS_VERSION'), '7.6.5\n', 'utf8');
    const legacyObservationBefore = treeDigest(legacyObservationRoot);
    let observationOnlyOk = true;
    for (const fixture of [
      { args: ['about', '--json'], status: 0 },
      { args: ['identity', '--json'], status: 0 },
      { args: ['status', '--json'], status: 0 },
      { args: ['auto-update', 'status', '--json'], status: 0 },
      { args: ['state', 'inspect', '--json'], status: 0 },
      // These surfaces currently require the canonical workspace to render;
      // on legacy input they may fail read-only, but must never migrate it.
      { args: ['dashboard', '--json'], status: 1 },
      { args: ['security-surface', '--json'], status: 0 },
      { args: ['preview', '--json'], status: 1 },
      { args: ['preview', 'list', '--json'], status: 1 },
      { args: ['preview', 'show', 'P-0001', '--json'], status: 1 },
    ]) {
      const observationResult = run(legacyObservationRoot, fixture.args);
      if (observationResult.status !== fixture.status) observationOnlyOk = false;
    }
    check('observation-only CLI routes do not auto-migrate or otherwise mutate a legacy workspace',
      observationOnlyOk
        && treeDigest(legacyObservationRoot) === legacyObservationBefore
        && fs.existsSync(legacyObservationState)
        && !fs.existsSync(path.join(legacyObservationRoot, '.leerness')),
      null);
  } finally {
    fs.rmSync(legacyObservationRoot, { recursive: true, force: true });
  }

  const conflictRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-false-claim-conflict-'));
  try {
    for (const dir of ['.harness', '.leerness']) { // workspace-dir-legacy-fixture
      fs.mkdirSync(path.join(conflictRoot, dir), { recursive: true });
      fs.writeFileSync(path.join(conflictRoot, dir, 'HARNESS_VERSION'), dir === '.harness' ? '1.0.0\n' : '2.0.0\n', 'utf8'); // workspace-dir-legacy-fixture
    }
    initRepo(conflictRoot);
    fixtureGit(conflictRoot, ['config', 'user.email', 'false-claim@example.invalid']);
    fixtureGit(conflictRoot, ['config', 'user.name', 'False Claim Probe']);
    fs.writeFileSync(path.join(conflictRoot, 'tracked.txt'), 'one\n', 'utf8');
    fixtureGit(conflictRoot, ['add', 'tracked.txt']);
    fixtureGit(conflictRoot, ['commit', '-qm', 'fixture']);
    fixtureGit(conflictRoot, ['tag', 'v1.0.0']);
    for (const args of [
      ['status', conflictRoot, '--json'],
      ['round-history', conflictRoot, '--json'],
      ['release', 'cadence', conflictRoot, '--json'],
    ]) {
      result = run(root, args, 60000, false);
      parsed = json(result);
      check(`${args[0]} rejects split-brain legacy/canonical workspaces instead of reporting unreadable`,
        result.status === 1
          && parsed?.ok === false
          && parsed?.code === 'workspace_dir_conflict'
          && /both \.harness and \.leerness/.test(parsed?.error || ''), // workspace-dir-legacy-fixture
        result);
    }

    result = run(root, ['pulse', conflictRoot, '--json'], 60000, false);
    parsed = json(result);
    check('pulse preserves Git round counts and exposes provenance failure when workspace selection conflicts',
      result.status === 0
        && parsed?.roundCount === 1
        && parsed?.roundHistoryError?.code === 'workspace_dir_conflict',
      result);

    const conflictBefore = treeDigest(conflictRoot);
    const mcpConflict = mcpCall(root, 'leerness_round_history', { path: conflictRoot });
    const mcpConflictText = mcpConflict.message?.result?.content?.[0]?.text || '';
    let mcpConflictBody = null;
    try { mcpConflictBody = JSON.parse(mcpConflictText); } catch {}
    check('read-only MCP round-history preserves split-brain bytes and exact machine error codes',
      mcpConflict.processResult.status === 0
        && mcpConflict.message?.result?.isError === true
        && mcpConflictBody?.code === 'workspace_dir_conflict'
        && treeDigest(conflictRoot) === conflictBefore,
      mcpConflict.processResult);
  } finally {
    fs.rmSync(conflictRoot, { recursive: true, force: true });
  }

  result = run(root, ['round-history', '--json'], 60000, true, { LEERNESS_WORKSPACE_DIR: '.custom' });
  parsed = json(result);
  check('round-history rejects an invalid workspace override instead of reporting unreadable',
    result.status === 1
      && parsed?.ok === false
      && parsed?.code === 'workspace_dir_invalid',
    result);

  for (const spoofWorkspace of ['bad\n✓ fake success', 'bad\u2028✓ fake success', 'bad\u2029✓ fake success']) {
    result = run(root, ['round-history'], 60000, true, { LEERNESS_WORKSPACE_DIR: spoofWorkspace });
    check('workspace resolver diagnostics cannot inject a fake success line in human output',
      result.status === 1
        && !`${result.stdout || ''}${result.stderr || ''}`.split(/[\r\n\u2028\u2029]+/).some((line) => /^✓ fake success\b/.test(line)),
      result);

    result = run(root, ['round-history', '--json'], 60000, true, { LEERNESS_WORKSPACE_DIR: spoofWorkspace });
    parsed = json(result);
    check('workspace resolver JSON diagnostics normalize line separators',
      result.status === 1
        && parsed?.code === 'workspace_dir_invalid'
        && !/[\r\n\u2028\u2029]/.test(parsed?.error || ''),
      result);
  }

  result = run(root, ['round-history', '--json']);
  parsed = json(result);
  check('round-history JSON identifies the CLI-version scope and project harness separately',
    result.status === 0
      && parsed?.currentVersionScope === 'leerness_cli'
      && parsed?.cliVersion === parsed?.currentVersion
      && parsed?.harnessVersion === '9.8.7',
    result);

  result = run(root, ['round-history']);
  check('round-history human output never labels the Leerness CLI as a generic current version',
    result.status === 0
      && /leerness CLI/i.test(result.stdout || '')
      && /프로젝트 하네스/.test(result.stdout || '')
      && !/현재 버전/.test(result.stdout || ''),
    result);

  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-false-claim-legacy-'));
  try {
    const legacyStateDir = path.join(legacyRoot, '.harness'); // workspace-dir-legacy-fixture
    fs.mkdirSync(legacyStateDir, { recursive: true });
    fs.writeFileSync(path.join(legacyStateDir, 'HARNESS_VERSION'), '7.6.5\n', 'utf8');
    initRepo(legacyRoot);
    const legacyStatusBefore = treeDigest(legacyRoot);
    for (const statusArgs of [
      ['status', legacyRoot, '--json'],
      ['status', '--json', '--path', legacyRoot],
    ]) {
      result = run(root, statusArgs, 60000, false);
      parsed = json(result);
      check(`status ${statusArgs.includes('--path') ? '--path' : 'positional'} reports the selected legacy workspace in place`,
        result.status === 0
          && parsed?.version === '7.6.5'
          && parsed?.versionState === 'valid'
          && parsed?.workspaceDir === '.harness' // workspace-dir-legacy-fixture
          && Array.isArray(parsed?.missing)
          && parsed.missing.every(f => !String(f).startsWith('.leerness/'))
          && treeDigest(legacyRoot) === legacyStatusBefore,
        result);
    }
    result = run(root, ['round-history', legacyRoot, '--json'], 60000, false);
    parsed = json(result);
    check('round-history reads the selected legacy workspace without mutating it',
      result.status === 0
        && parsed?.harnessVersion === '7.6.5'
        && parsed?.harnessVersionState === 'valid'
        && fs.existsSync(legacyStateDir)
        && !fs.existsSync(path.join(legacyRoot, '.leerness')),
      result);
    result = run(root, ['release', 'cadence', legacyRoot, '--json'], 60000, false);
    parsed = json(result);
    check('release cadence preserves legacy harness provenance on positional read-only use',
      result.status === 0
        && parsed?.harnessVersion === '7.6.5'
        && parsed?.harnessVersionState === 'valid'
        && fs.existsSync(legacyStateDir)
        && !fs.existsSync(path.join(legacyRoot, '.leerness')),
      result);


    const legacyBefore = treeDigest(legacyRoot);
    result = run(root, ['round-history', '--path', legacyRoot, '--json'], 60000, false);
    parsed = json(result);
    check('round-history --path remains byte-for-byte read-only on a legacy workspace',
      result.status === 0
        && parsed?.harnessVersion === '7.6.5'
        && fs.existsSync(legacyStateDir)
        && !fs.existsSync(path.join(legacyRoot, '.leerness'))
        && treeDigest(legacyRoot) === legacyBefore,
      result);

    result = run(legacyRoot, ['round-history', '--json'], 60000, false);
    parsed = json(result);
    check('round-history from a legacy cwd remains byte-for-byte read-only',
      result.status === 0
        && parsed?.harnessVersion === '7.6.5'
        && fs.existsSync(legacyStateDir)
        && !fs.existsSync(path.join(legacyRoot, '.leerness'))
        && treeDigest(legacyRoot) === legacyBefore,
      result);
  } finally {
    fs.rmSync(legacyRoot, { recursive: true, force: true });
  }

  const mcpServerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-false-claim-mcp-server-'));
  const mcpTargetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-false-claim-mcp-target-'));
  try {
    for (const fixture of [mcpServerRoot, mcpTargetRoot]) {
      fs.mkdirSync(path.join(fixture, '.harness'), { recursive: true }); // workspace-dir-legacy-fixture
      fs.writeFileSync(path.join(fixture, '.harness', 'HARNESS_VERSION'), '6.5.4\n', 'utf8'); // workspace-dir-legacy-fixture
      initRepo(fixture);
    }
    const serverBefore = treeDigest(mcpServerRoot);
    const targetBefore = treeDigest(mcpTargetRoot);
    const mcp = mcpCall(mcpServerRoot, 'leerness_round_history', { path: mcpTargetRoot });
    const text = mcp.message?.result?.content?.[0]?.text || '';
    let body = null;
    try { body = JSON.parse(text); } catch {}
    check('read-only MCP round-history does not migrate either its server cwd or explicit target',
      mcp.processResult.status === 0
        && mcp.message?.result?.isError === false
        && body?.harnessVersion === '6.5.4'
        && treeDigest(mcpServerRoot) === serverBefore
        && treeDigest(mcpTargetRoot) === targetBefore
        && !fs.existsSync(path.join(mcpServerRoot, '.leerness'))
        && !fs.existsSync(path.join(mcpTargetRoot, '.leerness')),
      mcp.processResult);
  } finally {
    fs.rmSync(mcpServerRoot, { recursive: true, force: true });
    fs.rmSync(mcpTargetRoot, { recursive: true, force: true });
  }

  const canonicalMcpServer = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-false-claim-mcp-canonical-server-'));
  const canonicalMcpTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-false-claim-mcp-canonical-target-'));
  try {
    for (const fixture of [canonicalMcpServer, canonicalMcpTarget]) {
      fs.mkdirSync(path.join(fixture, '.leerness'), { recursive: true });
      fs.writeFileSync(path.join(fixture, '.leerness', 'HARNESS_VERSION'), '6.5.4\n', 'utf8');
      initRepo(fixture);
    }
    const serverBefore = treeDigest(canonicalMcpServer);
    const targetBefore = treeDigest(canonicalMcpTarget);
    for (const tool of ['leerness_round_history', 'leerness_milestones', 'leerness_pulse']) {
      const call = mcpCall(canonicalMcpServer, tool, { path: canonicalMcpTarget });
      check(`read-only MCP ${tool} leaves canonical server and target byte-for-byte unchanged`,
        call.processResult.status === 0
          && call.message?.result?.isError === false
          && treeDigest(canonicalMcpServer) === serverBefore
          && treeDigest(canonicalMcpTarget) === targetBefore,
        call.processResult);
    }

    const writable = mcpCall(canonicalMcpServer, 'leerness_task_add', { path: canonicalMcpTarget, text: 'telemetry attribution probe' });
    let usage = null;
    try { usage = JSON.parse(fs.readFileSync(path.join(canonicalMcpTarget, '.leerness', 'cache', 'usage-stats.json'), 'utf8')); } catch {}
    check('writable MCP calls remain attributable to the canonical target, not the incidental server cwd',
      writable.processResult.status === 0
        && writable.message?.result?.isError === false
        && usage?.mcp?.tools?.leerness_task_add === 1
        && !fs.existsSync(path.join(canonicalMcpServer, '.leerness', 'cache', 'usage-stats.json')),
      writable.processResult);
  } finally {
    fs.rmSync(canonicalMcpServer, { recursive: true, force: true });
    fs.rmSync(canonicalMcpTarget, { recursive: true, force: true });
  }

  for (const malformedVersion of [
    'not-a-version',
    'garbage leerness@1.2.3 trailing',
    'plus@9.8.7 junk',
    'leerness@1.2.3.4',
  ]) {
    fs.writeFileSync(path.join(stateDir, 'HARNESS_VERSION'), malformedVersion + '\n', 'utf8');
    result = run(root, ['release', 'cadence', '--json']);
    parsed = json(result);
    check(`release cadence rejects malformed harness provenance: ${malformedVersion}`,
      result.status === 0
        && parsed?.harnessVersion === null
        && parsed?.harnessVersionState === 'invalid'
        && parsed?.currentVersionScope === 'leerness_cli'
        && Object.prototype.hasOwnProperty.call(parsed || {}, 'latestTagVersion'),
      result);
  }
  fs.writeFileSync(path.join(stateDir, 'HARNESS_VERSION'), 'leerness@1.8.0+plus@1.0.1\n', 'utf8');
  result = run(root, ['round-history', '--json']);
  parsed = json(result);
  check('legacy plus-version provenance reports the installed Leerness base version, not the compatibility suffix',
    result.status === 0
      && parsed?.harnessVersion === '1.8.0'
      && parsed?.harnessVersionState === 'valid',
    result);

  result = run(root, ['status', '--json']);
  parsed = json(result);
  check('status reports the installed Leerness base version for a legacy plus marker',
    result.status === 0
      && parsed?.version === '1.8.0'
      && parsed?.versionState === 'valid',
    result);

  result = run(root, ['handoff', '--json', '--no-record', '--no-drift-check', '--no-headline'], 180000);
  parsed = json(result);
  check('handoff version-skew reports the installed Leerness base version for a legacy plus marker',
    result.status === 0
      && parsed?.versionSkew?.harnessVersion === '1.8.0'
      && parsed?.versionSkew?.kind === 'harness-older',
    result);

  const unsafeVersion = 'leerness@1.8.0+plus@1.0.1\u001b[2J\u000b\u007f\u0085\u2028\u2029✓ fake success';
  fs.writeFileSync(path.join(stateDir, 'HARNESS_VERSION'), unsafeVersion + '\n', 'utf8');
  result = run(root, ['handoff', '--no-record', '--no-drift-check', '--no-headline'], 180000);
  check('handoff neutralizes controls in an invalid HARNESS_VERSION marker',
    result.status === 0
      && !terminalUnsafe.test(`${result.stdout || ''}${result.stderr || ''}`.replace(/[\r\n]/g, ''))
      && !String(result.stdout || '').split(/[\r\n\u2028\u2029]+/).some(line => /^✓ fake success\b/.test(line)),
    result);

  result = run(root, ['handoff', '--json', '--no-record', '--no-drift-check', '--no-headline'], 180000);
  parsed = json(result);
  check('handoff JSON returns only a line-safe invalid HARNESS_VERSION diagnostic',
    result.status === 0
      && parsed?.versionSkew?.kind === 'invalid-harness-version'
      && !terminalUnsafe.test(parsed?.versionSkew?.harnessVersion || ''),
    result);
  fs.writeFileSync(path.join(stateDir, 'HARNESS_VERSION'), '9.8.7\n', 'utf8');

  const missingHarnessRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-false-claim-missing-harness-'));
  try {
    initRepo(missingHarnessRoot);
    result = run(root, ['round-history', missingHarnessRoot], 60000, false);
    check('round-history human output explicitly labels missing project-harness provenance',
      result.status === 0
        && /project harness|프로젝트 하네스/i.test(result.stdout || '')
        && /missing|없음|미설치/i.test(result.stdout || ''),
      result);
  } finally {
    fs.rmSync(missingHarnessRoot, { recursive: true, force: true });
  }

  const literalCadencePath = path.join(root, 'cadence');
  result = run(root, ['release', 'cadence', 'cadence', '--json'], 60000, false);
  parsed = json(result);
  check('release cadence validates a positional path even when its literal name equals the subcommand',
    !fs.existsSync(literalCadencePath)
      && result.status === 1
      && parsed?.code === 'path_not_found',
    result);

  result = run(root, ['release', 'cadence', missingRoot, '--path', root, '--json'], 60000, false);
  parsed = json(result);
  check('release cadence applies --path precedence consistently in validation and execution',
    result.status === 0
      && parsed?.harnessVersion === '9.8.7'
      && parsed?.harnessVersionState === 'valid',
    result);

  for (const spoofPath of ['missing\u2028✓ fake success', 'missing\u2029✓ fake success']) {
    result = run(root, ['release', 'cadence', spoofPath], 60000, false);
    check('release cadence path diagnostics cannot inject a fake success line in human output',
      result.status === 1
        && !`${result.stdout || ''}${result.stderr || ''}`.split(/[\r\n\u2028\u2029]+/).some((line) => /^✓ fake success\b/.test(line)),
      result);
    result = run(root, ['release', 'cadence', spoofPath, '--json'], 60000, false);
    parsed = json(result);
    check('release cadence JSON path diagnostics normalize Unicode line separators',
      result.status === 1
        && parsed?.code === 'path_not_found'
        && !/[\r\n\u2028\u2029]/.test(parsed?.error || ''),
      result);

    result = run(root, ['memory', 'bogus', '--path', spoofPath], 60000, false);
    check('generic --path diagnostics cannot inject a fake success line in human output',
      result.status === 1
        && !`${result.stdout || ''}${result.stderr || ''}`.split(/[\r\n\u2028\u2029]+/).some((line) => /^✓ fake success\b/.test(line)),
      result);
    result = run(root, ['memory', 'bogus', '--path', spoofPath, '--json'], 60000, false);
    parsed = json(result);
    check('generic --path JSON diagnostics normalize Unicode line separators',
      result.status === 1
        && parsed?.code === 'path_not_found'
        && !/[\r\n\u2028\u2029]/.test(parsed?.error || ''),
      result);

    result = run(root, ['preview', 'list', '--path', spoofPath], 60000, false);
    check('preview generic path diagnostics cannot inject a fake success line in human output',
      result.status === 1
        && !`${result.stdout || ''}${result.stderr || ''}`.split(/[\r\n\u2028\u2029]+/).some((line) => /^✓ fake success\b/.test(line)),
      result);
    result = run(root, ['preview', 'list', '--path', spoofPath, '--json'], 60000, false);
    parsed = json(result);
    check('preview generic path JSON diagnostics normalize Unicode line separators',
      result.status === 1
        && parsed?.code === 'path_not_found'
        && !/[\r\n\u2028\u2029]/.test(parsed?.error || ''),
      result);
  }

  const harness = require('../bin/leerness');
  const parsedTags = typeof harness._parseRoundTagOutput === 'function'
    ? harness._parseRoundTagOutput([
      'refs/tags/v1.0.0\0' + '2026-08-27 10:00:00 +0900',
      'refs/tags/v1.0.1\0' + '2026-02-31 10:00:00 +0900',
      'refs/tags/v1.0.2\0' + '2026-08-28 25:00:00 +0900',
      'refs/tags/v1.0.3\0' + '2026-08-28 10:00:00 +2460',
      'refs/tags/v1.0.4\0' + '2026-08-28 10:00:00 +1500',
      'refs/tags/v1.0.5\0' + '2026-08-28 10:00:00 +1430',
      'v1.0.6\0' + '2026-08-28 10:00:00 +0900',
      'refs/tags/v1.2.3|bad\u2028✓ fake success\0' + '2026-08-28 10:00:00 +0900',
      'refs/tags/v1.2.4\u2029bad\0' + '2026-08-28 10:00:00 +0900',
      'refs/tags/v1.2.5\0' + 'bad\u2028✓ fake success',
    ].join('\n'))
    : null;
  check('round-history parser accepts only complete semantic-version refs with a valid unambiguous date field',
    Array.isArray(parsedTags)
      && parsedTags.length === 1
      && parsedTags[0].name === 'v1.0.0'
      && parsedTags[0].version === '1.0.0'
      && parsedTags[0].date === '2026-08-27 10:00:00 +0900'
      && !/[\r\n\u2028\u2029]/.test(JSON.stringify(parsedTags)),
    null);

  const parsedRecent = typeof harness._parseRecentChangeOutput === 'function'
    ? harness._parseRecentChangeOutput([
      'refs/tags/v1.2.3-rc1\0' + '2026-08-28 10:00:00 +0900\0\0lookalike',
      'v1.2.4\0' + '2026-08-28 10:00:00 +0900\0\0short-ref',
      'refs/tags/v1.2.5\0' + '2026-02-31 10:00:00 +0900\0\0bad-date',
      'refs/tags/v1.2.6\0' + '2026-08-28 10:00:00 +0900\0peeled\u001b[2J\u0085\u2028subject\0tag-subject',
    ].join('\n'), 5)
    : null;
  check('recent-changes parser accepts only full exact refs and sanitizes every terminal control class',
    Array.isArray(parsedRecent)
      && parsedRecent.length === 1
      && parsedRecent[0].version === '1.2.6'
      && parsedRecent[0].subject.includes('peeled')
      && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(JSON.stringify(parsedRecent)),
    null);

  const safeLine = require('../lib/pure-utils')._lineSafe(
    `left\u000b\u000c\u001b[2J\u0085\u2028\u2029right`,
  );
  check('line-safe projection removes C0/C1, ESC/CSI, DEL, and Unicode separators',
    !terminalUnsafe.test(safeLine) && safeLine.includes('left') && safeLine.includes('right'),
    null);

  result = run(root, ['memory', `bogus\u001b[2J\u000b\u0085✓ fake success`, '--json']);
  parsed = json(result);
  check('machine diagnostics remove terminal-control sequences from invalid subcommands',
    result.status === 1
      && parsed?.code === 'unknown_subcommand'
      && !terminalUnsafe.test(parsed?.error || ''),
    result);

  result = run(root, ['memory', 'bogus', '--json']);
  parsed = json(result);
  check('memory rejects an invalid child verb as an unknown subcommand with valid choices',
    result.status === 1
      && parsed?.code === 'unknown_subcommand'
      && /bogus/.test(parsed?.error || '')
      && /memory/.test(parsed?.error || '')
      && /status/.test(parsed?.error || '')
      && /archive/.test(parsed?.error || '')
      && /restore/.test(parsed?.error || ''),
    result);

  result = run(root, ['memory', '--json']);
  parsed = json(result);
  check('memory without a child verb retains the parent subcommand-required contract',
    result.status === 1
      && parsed?.code === 'subcommand_required'
      && /memory/.test(parsed?.error || '')
      && /subcommand|하위명령/i.test(parsed?.error || ''),
    result);

  check('bare memory usage names the executable archive list command',
    /memory archive list/.test(parsed?.error || '')
      && !/memory archive(?: \||$)/.test(parsed?.error || ''),
    result);

  result = run(root, ['memory', 'bogus', '--language', 'en', '--json']);
  parsed = json(result);
  check('memory invalid-child diagnostics honor English mode',
    result.status === 1
      && parsed?.code === 'unknown_subcommand'
      && /^Unknown memory subcommand: bogus/.test(parsed?.error || ''),
    result);

  result = run(root, ['memory', 'archive', '--json']);
  parsed = json(result);
  check('memory archive without a child retains a nested subcommand-required contract',
    result.status === 1
      && parsed?.code === 'subcommand_required'
      && /archive/.test(parsed?.error || '')
      && /list/.test(parsed?.error || ''),
    result);

  result = run(root, ['memory', 'archive', 'bogus', '--language', 'en', '--json']);
  parsed = json(result);
  check('memory archive identifies the actual invalid nested child',
    result.status === 1
      && parsed?.code === 'unknown_subcommand'
      && /^Unknown memory archive subcommand: bogus/.test(parsed?.error || '')
      && /list/.test(parsed?.error || ''),
    result);

  for (const spoofChild of ['bogus\n✓ fake success', 'bogus\u2028✓ fake success', 'bogus\u2029✓ fake success']) {
    for (const fixture of [
      { label: 'memory', args: ['memory', spoofChild] },
      { label: 'memory archive', args: ['memory', 'archive', spoofChild] },
    ]) {
      result = run(root, fixture.args);
      const outputLines = `${result.stdout || ''}${result.stderr || ''}`.split(/[\r\n\u2028\u2029]+/);
      check(`${fixture.label} invalid-child diagnostics cannot inject a fake success line`,
        result.status === 1 && !outputLines.some((line) => /^✓ fake success\b/.test(line)),
        result);
      result = run(root, [...fixture.args, '--json']);
      parsed = json(result);
      check(`${fixture.label} JSON invalid-child diagnostics normalize line separators`,
        result.status === 1
          && parsed?.code === 'unknown_subcommand'
          && !/[\r\n\u2028\u2029]/.test(parsed?.error || ''),
        result);
    }
  }

  const previews = path.join(stateDir, 'previews.json');

  for (const sep of ['\u2028', '\u2029']) {
    const previewRoot = path.join(os.tmpdir(), `leerness-preview-path-${process.pid}-${Date.now()}${sep}✓ fake success`);
    try {
      const previewState = path.join(previewRoot, '.leerness');
      fs.mkdirSync(previewState, { recursive: true });
      fs.writeFileSync(path.join(previewState, 'previews.json'), '{"broken":', 'utf8');
      result = run(root, ['preview', 'list', '--path', previewRoot], 60000, false);
      check('preview-store diagnostics cannot inject a fake success line from an existing project path',
        result.status === 1
          && !`${result.stdout || ''}${result.stderr || ''}`.split(/[\r\n\u2028\u2029]+/).some((line) => /^✓ fake success\b/.test(line)),
        result);
      result = run(root, ['preview', 'list', '--path', previewRoot, '--json'], 60000, false);
      parsed = json(result);
      check('preview-store JSON diagnostics normalize Unicode separators in an existing project path',
        result.status === 1
          && parsed?.code === 'store_corrupt'
          && !/[\r\n\u2028\u2029]/.test(parsed?.error || ''),
        result);
    } finally {
      fs.rmSync(previewRoot, { recursive: true, force: true });
    }
  }

  for (const fixture of [
    { name: 'parse corruption', body: '{"private":', code: 'store_corrupt' },
    { name: 'schema corruption', body: '{"private":"keep"}', code: 'store_invalid' },
  ]) {
    fs.writeFileSync(previews, fixture.body, 'utf8');
    const before = digest(previews);
    for (const args of [
      ['preview', 'list', '--json'],
      ['preview', 'show', 'P-0001', '--json'],
      ['preview', 'serve', 'P-0001', '--json'],
    ]) {
      result = run(root, args);
      parsed = json(result);
      check(`preview ${args[1]} exposes ${fixture.name} instead of reporting an empty/missing preview`,
        result.status === 1 && parsed?.code === fixture.code && digest(previews) === before,
        result);
    }
  }

  fs.rmSync(previews, { force: true });
  fs.mkdirSync(previews);
  result = run(root, ['preview', 'list', '--json']);
  parsed = json(result);
  check('an unreadable preview store is distinguished from JSON corruption and remains untouched',
    result.status === 1
      && parsed?.code === 'store_unreadable'
      && fs.statSync(previews).isDirectory(),
    result);
  fs.rmSync(previews, { recursive: true, force: true });

  fs.writeFileSync(previews, '[]\n', 'utf8');
  result = run(root, ['preview', 'list', '--json']);
  parsed = json(result);
  check('a valid empty preview store remains a successful empty list',
    result.status === 0 && parsed?.ok === true && parsed?.total === 0,
    result);

  fs.writeFileSync(previews, JSON.stringify([{ id: 'P-0001', title: 'valid', status: 'proposed', history: [] }]), 'utf8');
  result = run(root, ['preview', 'show', 'P-0001', '--json']);
  parsed = json(result);
  check('a valid preview remains readable',
    result.status === 0 && parsed?.ok === true && parsed?.id === 'P-0001',
    result);

  const malformedPreviewMockup = path.join(stateDir, 'previews', 'P-0001-mockup.html');
  for (const fixture of [
    { name: 'object history', records: [{ id: 'P-0001', title: 'bad history', status: 'proposed', history: {} }] },
    { name: 'scalar features', records: [{ id: 'P-0001', title: 'bad features', status: 'proposed', features: 'one', history: [] }] },
    { name: 'unknown status', records: [{ id: 'P-0001', title: 'bad status', status: 'done', history: [] }] },
    { name: 'missing status', records: [{ id: 'P-0001', title: 'missing status', history: [] }] },
    { name: 'reserved output key', records: [{ id: 'P-0001', title: 'reserved', status: 'proposed', history: [], ok: true }] },
    { name: 'malformed contract', records: [{ id: 'P-0001', title: 'bad contract', status: 'proposed', history: [], contract: { at: 'now', classes: [], tokens: [], tags: [], drawnChars: '12', untouched: false } }] },
    { name: 'duplicate ids', records: [{ id: 'P-0001', title: 'first', status: 'proposed', history: [] }, { id: 'P-0001', title: 'second', status: 'proposed', history: [] }] },
  ]) {
    fs.writeFileSync(previews, JSON.stringify(fixture.records), 'utf8');
    const malformedBefore = digest(previews);
    result = run(root, ['preview', 'mockup', 'P-0001', '--json']);
    parsed = json(result);
    check(`preview mockup rejects ${fixture.name} schema before any file or store write`,
      result.status === 1
        && parsed?.code === 'store_invalid'
        && digest(previews) === malformedBefore
        && !fs.existsSync(malformedPreviewMockup),
      result);
  }

  // Put both projects under a real `_apps` workspace so the same contract can
  // be enforced through explicit --include and discovery-based --all-apps.
  const previewWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-preview-workspace-'));
  const previewConsumerRoot = path.join(previewWorkspaceRoot, '_apps', 'consumer');
  const previewConsumerPeerRoot = path.join(previewWorkspaceRoot, '_apps', 'peer');
  fs.mkdirSync(previewConsumerRoot, { recursive: true });
  fs.mkdirSync(previewConsumerPeerRoot, { recursive: true });
  try {
    const initialized = run(previewConsumerRoot,
      ['init', previewConsumerRoot, '--yes', '--minimal', '--no-env', '--no-mcp', '--json'], 180000, false);
    check('preview approval consumer fixture initializes successfully', initialized.status === 0, initialized);
    const peerInitialized = run(previewConsumerPeerRoot,
      ['init', previewConsumerPeerRoot, '--yes', '--minimal', '--no-env', '--no-mcp', '--json'], 180000, false);
    check('multi-project preview approval peer fixture initializes successfully', peerInitialized.status === 0, peerInitialized);
    const consumerStore = path.join(previewConsumerRoot, '.leerness', 'previews.json');
    const multiInclude = `${previewConsumerRoot},${previewConsumerPeerRoot}`;
    const multiModes = [
      { label: '--include', args: ['--include', multiInclude] },
      { label: '--all-apps', args: ['--all-apps'] },
    ];
    function humanApprovalScopes(output, surface) {
      const lines = String(output || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (surface === 'compact') {
        const workspace = lines.find(line => line.startsWith('leerness compact ')) || '';
        const projectLine = lines.find(line => line.startsWith('projects:')) || '';
        const projects = projectLine.replace(/^projects:\s*/, '').split('|').map(part => part.trim());
        return {
          workspace,
          consumer: projects.find(part => part.startsWith('consumer ')) || '',
          peer: projects.find(part => part.startsWith('peer ')) || '',
        };
      }
      return {
        workspace: lines.find(line => line.startsWith('- 미리보기 승인:')) || '',
        consumer: lines.find(line => line.startsWith('consumer:')) || '',
        peer: lines.find(line => line.startsWith('peer:')) || '',
      };
    }
    for (const fixture of [
      { name: 'missing status', record: { id: 'P-0001', title: 'missing status', history: [] } },
      { name: 'unknown status', record: { id: 'P-0001', title: 'unknown status', status: 'done', history: [] } },
    ]) {
      fs.writeFileSync(consumerStore, JSON.stringify([fixture.record]), 'utf8');
      const before = digest(consumerStore);

      const handoffResult = run(previewConsumerRoot,
        ['handoff', '--json', '--no-record', '--no-drift-check'], 180000);
      const handoffJson = json(handoffResult);
      check(`handoff reports ${fixture.name} as an unknown approval state instead of zero pending`,
        handoffResult.status === 0
          && handoffJson?.previewApproval?.known === false
          && handoffJson.previewApproval.pendingCount === null
          && handoffJson.previewApproval.code === 'store_invalid'
          && digest(consumerStore) === before,
        handoffResult);

      const compactResult = run(previewConsumerRoot,
        ['handoff', '--compact', '--no-record', '--no-drift-check'], 180000);
      const compactText = `${compactResult.stdout || ''}${compactResult.stderr || ''}`;
      check(`compact handoff reports ${fixture.name} with explicit unknown/null/code provenance`,
        compactResult.status === 0
          && /previewApproval known=false count=null code=store_invalid/.test(compactText)
          && digest(consumerStore) === before,
        compactResult);

      const mcpHandoff = mcpCall(previewConsumerRoot, 'leerness_handoff', { path: previewConsumerRoot });
      const mcpHandoffText = mcpHandoff.message?.result?.content?.[0]?.text || '';
      check(`MCP handoff preserves compact ${fixture.name} approval provenance`,
        mcpHandoff.processResult.status === 0
          && mcpHandoff.message?.result?.isError === false
          && /previewApproval known=false count=null code=store_invalid/.test(mcpHandoffText)
          && digest(consumerStore) === before,
        mcpHandoff.processResult);

      for (const mode of multiModes) {
        const multiJsonResult = run(previewWorkspaceRoot,
          ['handoff', ...mode.args, '--json', '--no-record', '--no-drift-check'], 180000);
        const multiJson = json(multiJsonResult);
        const invalidProject = multiJson?.projects?.find(project => path.resolve(project.path) === path.resolve(previewConsumerRoot));
        const healthyProject = multiJson?.projects?.find(project => path.resolve(project.path) === path.resolve(previewConsumerPeerRoot));
        check(`${mode.label} JSON handoff reports ${fixture.name} at workspace and every project scope`,
          multiJsonResult.status === 0
            && multiJson?.projects?.length === 2
            && multiJson?.previewApproval?.known === false
            && multiJson.previewApproval.pendingCount === null
            && multiJson.previewApproval.code === 'store_invalid'
            && invalidProject?.previewApproval?.known === false
            && invalidProject.previewApproval.pendingCount === null
            && invalidProject.previewApproval.code === 'store_invalid'
            && healthyProject?.previewApproval?.known === true
            && healthyProject.previewApproval.pendingCount === 0
            && healthyProject.previewApproval.code === null
            && digest(consumerStore) === before,
          multiJsonResult);

        for (const surface of [
          { label: 'compact', args: ['--compact'] },
          { label: 'full', args: [] },
        ]) {
          const multiHuman = run(previewWorkspaceRoot,
            ['handoff', ...mode.args, ...surface.args, '--no-record', '--no-drift-check'], 180000);
          const multiHumanText = `${multiHuman.stdout || ''}${multiHuman.stderr || ''}`;
          const approvalScopes = humanApprovalScopes(multiHumanText, surface.label);
          check(`${mode.label} ${surface.label} handoff reports ${fixture.name} at workspace and every project scope`,
            multiHuman.status === 0
              && approvalScopes.workspace.endsWith('previewApproval known=false count=null code=store_invalid')
              && approvalScopes.consumer.endsWith('previewApproval known=false count=null code=store_invalid')
              && approvalScopes.peer.endsWith('previewApproval known=true count=0 code=null')
              && digest(consumerStore) === before,
            multiHuman);
        }
      }

      const closeResult = run(previewConsumerRoot,
        ['session', 'close', '--json', '--no-suggest'], 240000);
      const closeJson = json(closeResult);
      check(`session close reports ${fixture.name} as an unknown approval state instead of zero pending`,
        closeResult.status === 0
          && closeJson?.pendingPreviews?.known === false
          && closeJson.pendingPreviews.count === null
          && closeJson.pendingPreviews.code === 'store_invalid'
          && digest(consumerStore) === before,
        closeResult);

      const dashboardResult = run(previewConsumerRoot, ['dashboard', '--json'], 120000);
      const dashboardJson = json(dashboardResult);
      const dashboardHtml = dashboardJson ? require('../lib/dashboard').renderHtml(dashboardJson) : '';
      check(`dashboard validates ${fixture.name} and exposes an invalid-store note without rendering it`,
        dashboardResult.status === 0
          && dashboardJson?.previewApproval?.known === false
          && dashboardJson.previewApproval.pendingCount === null
          && dashboardJson.previewApproval.code === 'store_invalid'
          && Array.isArray(dashboardJson.previews) && dashboardJson.previews.length === 0
          && (dashboardJson.notes || []).some(note => /previews\.json/.test(note) && /store_invalid/.test(note))
          && /승인 상태 확인 불가 \(store_invalid\)/.test(dashboardHtml)
          && !/미리보기 없음/.test(dashboardHtml)
          && digest(consumerStore) === before,
        dashboardResult);
    }

    fs.writeFileSync(consumerStore,
      JSON.stringify([{ id: 'P-0001', title: 'pending preview', status: 'proposed', history: [] }]), 'utf8');
    const pendingBefore = digest(consumerStore);
    const pendingCompact = run(previewConsumerRoot,
      ['handoff', '--compact', '--no-record', '--no-drift-check'], 180000);
    check('compact handoff reports a valid pending preview with known=true and the exact count',
      pendingCompact.status === 0
        && /previewApproval known=true count=1 code=null/.test(`${pendingCompact.stdout || ''}${pendingCompact.stderr || ''}`)
        && digest(consumerStore) === pendingBefore,
      pendingCompact);

    const pendingMcp = mcpCall(previewConsumerRoot, 'leerness_handoff', { path: previewConsumerRoot });
    const pendingMcpText = pendingMcp.message?.result?.content?.[0]?.text || '';
    check('MCP handoff reports a valid pending preview with known=true and the exact count',
      pendingMcp.processResult.status === 0
        && pendingMcp.message?.result?.isError === false
        && /previewApproval known=true count=1 code=null/.test(pendingMcpText)
        && digest(consumerStore) === pendingBefore,
      pendingMcp.processResult);

    for (const mode of multiModes) {
      const pendingMultiJsonResult = run(previewWorkspaceRoot,
        ['handoff', ...mode.args, '--json', '--no-record', '--no-drift-check'], 180000);
      const pendingMultiJson = json(pendingMultiJsonResult);
      const pendingProject = pendingMultiJson?.projects?.find(project => path.resolve(project.path) === path.resolve(previewConsumerRoot));
      const emptyProject = pendingMultiJson?.projects?.find(project => path.resolve(project.path) === path.resolve(previewConsumerPeerRoot));
      check(`${mode.label} JSON handoff aggregates valid pending previews at workspace and every project scope`,
        pendingMultiJsonResult.status === 0
          && pendingMultiJson?.projects?.length === 2
          && pendingMultiJson?.previewApproval?.known === true
          && pendingMultiJson.previewApproval.pendingCount === 1
          && pendingMultiJson.previewApproval.code === null
          && pendingProject?.previewApproval?.known === true
          && pendingProject.previewApproval.pendingCount === 1
          && pendingProject.previewApproval.code === null
          && emptyProject?.previewApproval?.known === true
          && emptyProject.previewApproval.pendingCount === 0
          && emptyProject.previewApproval.code === null
          && digest(consumerStore) === pendingBefore,
        pendingMultiJsonResult);

      for (const surface of [
        { label: 'compact', args: ['--compact'] },
        { label: 'full', args: [] },
      ]) {
        const pendingMultiHuman = run(previewWorkspaceRoot,
          ['handoff', ...mode.args, ...surface.args, '--no-record', '--no-drift-check'], 180000);
        const pendingMultiHumanText = `${pendingMultiHuman.stdout || ''}${pendingMultiHuman.stderr || ''}`;
        const approvalScopes = humanApprovalScopes(pendingMultiHumanText, surface.label);
        check(`${mode.label} ${surface.label} handoff aggregates valid pending previews at workspace and every project scope`,
          pendingMultiHuman.status === 0
            && approvalScopes.workspace.endsWith('previewApproval known=true count=1 code=null')
            && approvalScopes.consumer.endsWith('previewApproval known=true count=1 code=null')
            && approvalScopes.peer.endsWith('previewApproval known=true count=0 code=null')
            && digest(consumerStore) === pendingBefore,
          pendingMultiHuman);
      }
    }
  } finally {
    fs.rmSync(previewWorkspaceRoot, { recursive: true, force: true });
  }

  fs.writeFileSync(previews, JSON.stringify([{ id: 'P-0001', title: 'valid', status: 'proposed', history: [] }]), 'utf8');

  const previewSpoof = 'bogus\n✓ fake success\u000b\u001b[2J\u007f\u0085\u2028\u2029tail';
  for (const fixture of [
    { label: 'unknown subcommand', args: ['preview', previewSpoof], code: 'unknown_subcommand' },
    { label: 'missing id', args: ['preview', 'show', previewSpoof], code: 'not_found' },
    { label: 'serve missing id', args: ['preview', 'serve', previewSpoof], code: 'not_found' },
    { label: 'invalid mode', args: ['preview', 'mode', previewSpoof], code: 'invalid_mode' },
  ]) {
    result = run(root, fixture.args);
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    check(`preview ${fixture.label} human diagnostics neutralize LF/C0/ESC/DEL/C1/U+2028/U+2029`,
      result.status === 1
        && !terminalUnsafe.test(output.replace(/[\r\n]/g, ''))
        && !output.split(/[\r\n\u2028\u2029]+/).some(line => /^✓ fake success\b/.test(line)),
      result);

    result = run(root, [...fixture.args, '--json']);
    parsed = json(result);
    check(`preview ${fixture.label} JSON diagnostics contain no terminal or line controls`,
      result.status === 1
      && parsed?.code === fixture.code
          && !terminalUnsafe.test(parsed?.error || ''),
      result);
  }

  fs.writeFileSync(previews, JSON.stringify([{
    id: 'P-0001',
    title: previewSpoof,
    design: previewSpoof,
    features: [previewSpoof],
    status: 'proposed',
    history: [{ at: previewSpoof, event: previewSpoof, note: previewSpoof }],
  }]), 'utf8');
  for (const args of [
    ['preview', 'list'],
    ['preview', 'show', 'P-0001'],
  ]) {
    result = run(root, args);
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    check(`preview ${args[1]} neutralizes controls in valid stored preview data`,
      result.status === 0
        && !terminalUnsafe.test(output.replace(/[\r\n]/g, ''))
        && !output.split(/[\r\n\u2028\u2029]+/).some(line => /^✓ fake success\b/.test(line)),
      result);
  }

  const dotDotNamedMockup = path.join(root, '..mockup.html');
  fs.writeFileSync(dotDotNamedMockup, '<!doctype html><title>valid dot-dot name</title>\n', 'utf8');
  const dotDotNamedBefore = digest(dotDotNamedMockup);
  fs.writeFileSync(previews, '[]\n', 'utf8');
  result = run(root, ['preview', 'add', 'dot-dot filename', '--mockup', '..mockup.html', '--json']);
  parsed = json(result);
  check('preview add accepts an in-root filename that begins with two dots without treating it as traversal',
    result.status === 0
      && parsed?.mockupPath === '..mockup.html'
      && digest(dotDotNamedMockup) === dotDotNamedBefore,
    result);

  const absoluteInputMockup = path.join(root, 'absolute-input-mockup.html');
  fs.writeFileSync(absoluteInputMockup, '<!doctype html><title>absolute input</title>\n', 'utf8');
  fs.writeFileSync(previews, '[]\n', 'utf8');
  result = run(root, ['preview', 'add', 'absolute input', '--mockup', absoluteInputMockup, '--json']);
  parsed = json(result);
  check('preview add accepts an absolute in-root input but stores a portable relative mockupPath',
    result.status === 0 && parsed?.mockupPath === 'absolute-input-mockup.html', result);

  fs.writeFileSync(previews, JSON.stringify([{ id: 'P-0001', title: 'absolute record', status: 'proposed', history: [], mockupPath: absoluteInputMockup }]), 'utf8');
  let guardedStoreBefore = digest(previews);
  const absoluteInputBefore = digest(absoluteInputMockup);
  result = run(root, ['preview', 'list', '--json']);
  parsed = json(result);
  check('preview store rejects an absolute mockupPath record even when it points inside the project',
    result.status === 1
      && parsed?.code === 'store_invalid'
      && digest(previews) === guardedStoreBefore
      && digest(absoluteInputMockup) === absoluteInputBefore,
    result);

  const outsideLinkTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-preview-outside-link-'));
  const outsideLinkedMockup = path.join(outsideLinkTarget, 'mock.html');
  const inwardTargetDir = path.join(root, 'preview-inward-target');
  const inwardLinkedMockup = path.join(inwardTargetDir, 'mock.html');
  const outwardLink = path.join(root, 'preview-outward-link');
  const inwardLink = path.join(root, 'preview-inward-link');
  fs.writeFileSync(outsideLinkedMockup, '<!doctype html><title>outside link secret</title>\n', 'utf8');
  fs.mkdirSync(inwardTargetDir, { recursive: true });
  fs.writeFileSync(inwardLinkedMockup, '<!doctype html><head></head><body>inside link</body>\n', 'utf8');
  try {
    fs.symlinkSync(outsideLinkTarget, outwardLink, process.platform === 'win32' ? 'junction' : 'dir');
    fs.symlinkSync(inwardTargetDir, inwardLink, process.platform === 'win32' ? 'junction' : 'dir');
    const outsideLinkRel = path.relative(root, path.join(outwardLink, 'mock.html')).replace(/\\/g, '/');
    const inwardLinkRel = path.relative(root, path.join(inwardLink, 'mock.html')).replace(/\\/g, '/');

    fs.writeFileSync(previews, '[]\n', 'utf8');
    guardedStoreBefore = digest(previews);
    const outsideLinkedBefore = digest(outsideLinkedMockup);
    result = run(root, ['preview', 'add', 'outward link', '--mockup', outsideLinkRel, '--json']);
    parsed = json(result);
    check('preview add rejects an outward junction/symlink before creating a self-rejected store',
      result.status === 1
        && parsed?.code === 'mockup_outside_root'
        && digest(previews) === guardedStoreBefore
        && digest(outsideLinkedMockup) === outsideLinkedBefore,
      result);

    fs.writeFileSync(previews, JSON.stringify([{ id: 'P-0001', title: 'outward record', status: 'proposed', history: [], mockupPath: outsideLinkRel }]), 'utf8');
    guardedStoreBefore = digest(previews);
    for (const args of [
      ['preview', 'list', '--json'],
      ['preview', 'approve', 'P-0001', '--json'],
      ['preview', 'serve', 'P-0001', '--timeout', '5', '--json'],
    ]) {
      result = run(root, args);
      parsed = json(result);
      check(`preview ${args[1]} rejects an outward junction/symlink record and preserves both files`,
        result.status === 1
          && parsed?.code === 'store_invalid'
          && digest(previews) === guardedStoreBefore
          && digest(outsideLinkedMockup) === outsideLinkedBefore,
        result);
    }

    fs.writeFileSync(previews, '[]\n', 'utf8');
    const inwardBefore = digest(inwardLinkedMockup);
    result = run(root, ['preview', 'add', 'inward link', '--mockup', inwardLinkRel, '--json']);
    parsed = json(result);
    const inwardId = parsed?.id;
    const inwardAdded = result.status === 0 && parsed?.mockupPath === inwardLinkRel;
    result = run(root, ['preview', 'show', inwardId || 'P-0001', '--json']);
    parsed = json(result);
    check('preview accepts an inward junction/symlink whose real target remains inside the project',
      inwardAdded
        && result.status === 0
        && parsed?.mockupPath === inwardLinkRel
        && digest(inwardLinkedMockup) === inwardBefore,
      result);

    fs.writeFileSync(previews, '[]\n', 'utf8');
    guardedStoreBefore = digest(previews);
    result = run(root, ['preview', 'add', 'missing mockup', '--mockup', 'missing/mock.html', '--json']);
    parsed = json(result);
    check('preview add rejects a missing in-root mockup without changing the store',
      result.status === 1 && parsed?.code === 'mockup_not_found' && digest(previews) === guardedStoreBefore,
      result);

    fs.writeFileSync(previews, JSON.stringify([{ id: 'P-0001', title: 'missing record', status: 'proposed', history: [], mockupPath: 'missing/mock.html' }]), 'utf8');
    guardedStoreBefore = digest(previews);
    result = run(root, ['preview', 'list', '--json']);
    parsed = json(result);
    check('preview store rejects a missing in-root mockup and preserves the record bytes',
      result.status === 1 && parsed?.code === 'store_invalid' && digest(previews) === guardedStoreBefore,
      result);

    const clarify = require('../lib/clarify');
    const previewServe = require('../lib/preview-serve');
    const directAbsolute = clarify._previewMockupPathCheck(root, absoluteInputMockup, { requireFile: true });
    const directOutward = clarify._previewMockupPathCheck(root, outsideLinkRel, { requireFile: true });
    const directInward = clarify._previewMockupPathCheck(root, inwardLinkRel, { requireFile: true });
    const directMissing = clarify._previewMockupPathCheck(root, 'missing/mock.html', { requireFile: true });
    check('the shared mockup guard directly distinguishes absolute records, outward links, inward links, and missing files',
      directAbsolute.ok === false && directAbsolute.code === 'mockup_path_invalid'
        && directOutward.ok === false && directOutward.code === 'mockup_outside_root'
        && directInward.ok === true && digest(directInward.resolvedPath) === inwardBefore
        && directMissing.ok === false && directMissing.code === 'mockup_missing'
        && digest(previews) === guardedStoreBefore
        && digest(outsideLinkedMockup) === outsideLinkedBefore);

    const outwardServeDir = previewServe.serveDir(root, 'P-9001');
    const missingServeDir = previewServe.serveDir(root, 'P-9002');
    const directOutwardBuild = previewServe.buildServeWorkspace(root, { id: 'P-9001', mockupPath: outsideLinkRel });
    const directMissingBuild = previewServe.buildServeWorkspace(root, { id: 'P-9002', mockupPath: 'missing/mock.html' });
    const directInwardBuild = previewServe.buildServeWorkspace(root, { id: 'P-9003', mockupPath: inwardLinkRel });
    check('buildServeWorkspace directly rejects outward/missing paths before writes and accepts an inward link',
      directOutwardBuild.ok === false && directOutwardBuild.code === 'mockup_outside_root'
        && directMissingBuild.ok === false && directMissingBuild.code === 'mockup_missing'
        && !fs.existsSync(outwardServeDir) && !fs.existsSync(missingServeDir)
        && directInwardBuild.ok === true && fs.existsSync(path.join(directInwardBuild.dir, 'index.html'))
        && digest(previews) === guardedStoreBefore
        && digest(outsideLinkedMockup) === outsideLinkedBefore
        && digest(inwardLinkedMockup) === inwardBefore);
    previewServe.cleanupServeDir(root, 'P-9003');
  } finally {
    removeDirLink(outwardLink);
    removeDirLink(inwardLink);
    fs.rmSync(outsideLinkTarget, { recursive: true, force: true });
  }

  const linkedOutputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-preview-linked-output-'));
  const linkedOutputTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-preview-linked-target-'));
  const linkedPreviewsDir = path.join(linkedOutputRoot, '.leerness', 'previews');
  try {
    fs.mkdirSync(path.join(linkedOutputRoot, '.leerness'), { recursive: true });
    fs.writeFileSync(path.join(linkedOutputRoot, 'mock.html'), '<!doctype html><head></head><body>safe source</body>\n', 'utf8');
    fs.symlinkSync(linkedOutputTarget, linkedPreviewsDir, process.platform === 'win32' ? 'junction' : 'dir');
    const linkedStore = path.join(linkedOutputRoot, '.leerness', 'previews.json');
    fs.writeFileSync(linkedStore, JSON.stringify([{ id: 'P-0001', title: 'linked output', status: 'proposed', features: [], history: [] }]), 'utf8');
    const linkedStoreBefore = digest(linkedStore);

    result = run(linkedOutputRoot, ['preview', 'mockup', 'P-0001', '--json']);
    parsed = json(result);
    check('preview mockup rejects an outward linked output directory before writing outside the project',
      result.status === 1
        && parsed?.code === 'preview_output_linked'
        && digest(linkedStore) === linkedStoreBefore
        && !fs.existsSync(path.join(linkedOutputTarget, 'P-0001-mockup.html')),
      result);

    const previewServe = require('../lib/preview-serve');
    const linkedBuild = previewServe.buildServeWorkspace(linkedOutputRoot, { id: 'P-0001', mockupPath: 'mock.html' });
    check('buildServeWorkspace rejects an outward linked output directory before writing its temporary HTML',
      linkedBuild.ok === false
        && linkedBuild.code === 'preview_output_linked'
        && !fs.existsSync(path.join(linkedOutputTarget, '.serve-P-0001', 'index.html'))
        && digest(linkedStore) === linkedStoreBefore);

    const linkedServeOutside = path.join(linkedOutputTarget, '.serve-P-0001');
    fs.mkdirSync(linkedServeOutside, { recursive: true });
    const linkedKeep = path.join(linkedServeOutside, 'keep.txt');
    fs.writeFileSync(linkedKeep, 'must survive unsafe cleanup\n', 'utf8');
    const cleanupResult = previewServe.cleanupServeDir(linkedOutputRoot, 'P-0001');
    check('cleanupServeDir leaves an outward linked temporary directory untouched',
      cleanupResult === false && fs.existsSync(linkedKeep) && digest(linkedStore) === linkedStoreBefore);
  } finally {
    removeDirLink(linkedPreviewsDir);
    fs.rmSync(linkedOutputRoot, { recursive: true, force: true });
    fs.rmSync(linkedOutputTarget, { recursive: true, force: true });
  }

  const outsideMockup = path.join(path.dirname(root), `${path.basename(root)}-outside-preview.html`);
  fs.writeFileSync(outsideMockup, '<!doctype html><title>outside secret</title>\n', 'utf8');
  const outsideRel = path.relative(root, outsideMockup).replace(/\\/g, '/');
  fs.writeFileSync(previews, JSON.stringify([{ id: 'P-0001', title: 'valid', status: 'proposed', history: [], mockupPath: outsideRel }]), 'utf8');
  const outsideStoreBefore = digest(previews);
  const outsideFileBefore = digest(outsideMockup);
  for (const args of [
    ['preview', 'list', '--json'],
    ['preview', 'show', 'P-0001', '--json'],
    ['preview', 'approve', 'P-0001', '--json'],
    ['preview', 'serve', 'P-0001', '--timeout', '5', '--json'],
  ]) {
    result = run(root, args);
    parsed = json(result);
    check(`preview ${args[1]} rejects a canonical record whose mockupPath escapes the project`,
      result.status === 1
        && parsed?.code === 'store_invalid'
        && digest(previews) === outsideStoreBefore
        && digest(outsideMockup) === outsideFileBefore,
      result);
  }
  fs.rmSync(outsideMockup, { force: true });

  fs.writeFileSync(previews, JSON.stringify([{ id: 'P-0001/../../escape', title: 'invalid', status: 'proposed' }]), 'utf8');
  const invalidIdBefore = digest(previews);
  result = run(root, ['preview', 'serve', 'P-0001/../../escape', '--json']);
  parsed = json(result);
  check('preview store rejects non-canonical IDs before serve path construction and preserves the source bytes',
    result.status === 1
      && parsed?.code === 'store_invalid'
      && digest(previews) === invalidIdBefore,
    result);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(fixtureGitConfigRoot, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`false-claim probe failed: ${failures.length}/${checks} checks`);
  process.exit(1);
}
console.log(`false-claim probe passed: ${checks}/${checks} checks`);
