#!/usr/bin/env node
'use strict';

// T-0140: prove the packed artifact, rather than the source checkout, works in a
// separate consumer project. The probe also runs the exhaustive command-surface
// suite from the installed package so missing `files` entries cannot hide.

const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sourceRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-installed-cleanroom-'));
const packDir = path.join(tempRoot, 'packs');
const consumer = path.join(tempRoot, 'consumer');
const project = path.join(tempRoot, 'project');
const legacy = path.join(tempRoot, 'legacy-project');
const expectedVersion = require(path.join(sourceRoot, 'package.json')).version;
let failed = 0;
let total = 0;

function check(label, condition, detail = '') {
  total += 1;
  const ok = Boolean(condition);
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail ? `: ${detail}` : ''}\n`);
  if (!ok) failed += 1;
  return ok;
}

function runNode(script, args = [], options = {}) {
  return cp.spawnSync(process.execPath, [script, ...args], {
    cwd: options.cwd || consumer,
    encoding: 'utf8',
    timeout: options.timeout || 180000,
    env: {
      ...process.env,
      LEERNESS_OFFLINE: '1',
      LEERNESS_NO_PROMPT: '1',
      LEERNESS_NO_AUTOCHCP: '1',
      LEERNESS_NO_DRIFT_CHECK: '1',
      ...options.env,
    },
  });
}

function npmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  try { candidates.push(require.resolve('npm/bin/npm-cli.js')); } catch {}
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`npm CLI not found; checked: ${candidates.join(', ')}`);
  return found;
}

function runNpm(args, cwd = tempRoot, timeout = 300000) {
  return runNode(npmCliPath(), args, { cwd, timeout, env: { npm_config_update_notifier: 'false' } });
}

function parseJson(text) {
  try { return JSON.parse(String(text || '').trim()); } catch { return null; }
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, 'utf8');
}

const PRESENCE_CONTROL_ENV = new Set([
  'CI', 'GITHUB_ACTIONS', 'LEERNESS_NO_SESSION_PRESENCE', 'LEERNESS_HOOK', 'LEERNESS_INTERNAL',
  'CLAUDE_CODE_CHILD_SESSION', 'LEERNESS_MCP_ADDRESS_EXPLICIT', 'LEERNESS_SESSION_ID',
  'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CODEX_THREAD_ID',
].map((key) => key.toLowerCase()));

function isolatedHandoffEnv(sessionId) {
  // This assertion measures explicit session-address persistence. Ambient CI/hook/internal
  // markers deliberately suppress product presence, so inheriting the runner's environment
  // would test the host rather than the packed artifact. Scrub case-insensitively because
  // Windows environment keys are case-insensitive even after object spreading.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (PRESENCE_CONTROL_ENV.has(key.toLowerCase())) delete env[key];
  }
  return {
    ...env,
    LEERNESS_OFFLINE: '1',
    LEERNESS_NO_PROMPT: '1',
    LEERNESS_NO_AUTOCHCP: '1',
    LEERNESS_SESSION_ID: sessionId,
  };
}

function spawnHandoff(cli, sessionId) {
  return new Promise((resolve) => {
    const child = cp.spawn(process.execPath,
      [cli, 'handoff', project, '--quiet', '--no-drift-check'], {
        cwd: project,
        env: isolatedHandoffEnv(sessionId),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ sessionId, status, stdout, stderr }));
  });
}

async function main() {
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(consumer, { recursive: true });
  write(path.join(consumer, 'package.json'), JSON.stringify({
    name: 'leerness-cleanroom-consumer',
    private: true,
    version: '0.0.0',
  }, null, 2) + '\n');

  const packed = runNpm(['pack', sourceRoot, '--ignore-scripts', '--json', '--pack-destination', packDir]);
  const packJson = parseJson(packed.stdout);
  const tarName = Array.isArray(packJson) && packJson[0] && packJson[0].filename;
  const tarball = tarName ? path.join(packDir, tarName) : '';
  check('npm pack creates a parseable tarball', packed.status === 0 && tarball && fs.existsSync(tarball),
    `exit=${packed.status} ${packed.stderr || packed.stdout}`);
  if (!tarball || !fs.existsSync(tarball)) return;

  const installed = runNpm([
    'install', tarball, '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false',
  ], consumer);
  check('packed artifact installs into a separate consumer', installed.status === 0,
    `exit=${installed.status} ${installed.stderr || installed.stdout}`);
  if (installed.status !== 0) return;

  const installedRoot = path.join(consumer, 'node_modules', 'leerness');
  const cli = path.join(installedRoot, 'bin', 'leerness.js');
  const commandSurface = path.join(installedRoot, 'scripts', 'e2e-command-surface.js');
  const installedPackage = JSON.parse(fs.readFileSync(path.join(installedRoot, 'package.json'), 'utf8'));
  check('installed package and CLI match the release version',
    installedPackage.version === expectedVersion && fs.existsSync(cli),
    `expected=${expectedVersion} actual=${installedPackage.version}`);

  const version = runNode(cli, ['--version']);
  check('installed CLI reports the release version',
    version.status === 0 && version.stdout.trim() === expectedVersion,
    `exit=${version.status} stdout=${version.stdout.trim()} stderr=${version.stderr.trim()}`);

  const selftest = runNode(cli, ['selftest', '--json'], { timeout: 300000 });
  const selftestJson = parseJson(selftest.stdout);
  check('installed selftest passes', selftest.status === 0 && selftestJson && selftestJson.ok === true,
    `exit=${selftest.status} ${(selftest.stderr || selftest.stdout).slice(-600)}`);

  fs.mkdirSync(project, { recursive: true });
  const init = runNode(cli, [
    'init', project, '--yes', '--minimal', '--language', 'en', '--no-stale-check', '--json',
  ], { cwd: project });
  check('fresh installed init creates only .leerness',
    init.status === 0
      && fs.existsSync(path.join(project, '.leerness', 'HARNESS_VERSION'))
      && !fs.existsSync(path.join(project, '.harness')),
    `exit=${init.status} ${(init.stderr || init.stdout).slice(-600)}`);

  const workspace = runNode(cli, ['workspace-dir', 'get', '--path', project, '--json'], { cwd: project });
  const workspaceJson = parseJson(workspace.stdout);
  check('installed resolver reports the canonical directory',
    workspace.status === 0 && workspaceJson && workspaceJson.current === '.leerness',
    workspace.stdout || workspace.stderr);

  const sessionIds = ['cleanroom-codex-01', 'cleanroom-claude-01', 'cleanroom-cursor-01', 'cleanroom-agent-04'];
  const handoffs = await Promise.all(sessionIds.map((id) => spawnHandoff(cli, id)));
  const sessionsDir = path.join(project, '.leerness', 'cache', 'sessions');
  const observedSessions = Object.fromEntries(sessionIds.map((id) => {
    const file = path.join(sessionsDir, `${id}.json`);
    if (!fs.existsSync(file)) return [id, null];
    try { return [id, JSON.parse(fs.readFileSync(file, 'utf8'))]; }
    catch (error) { return [id, { readError: String(error && error.message || error) }]; }
  }));
  const isolated = sessionIds.every((id) => {
    const record = observedSessions[id];
    return record && record.sessionKey === id && record.handoffCount === 1
      && Array.isArray(record.handoffHistory) && record.handoffHistory.length === 1;
  });
  check('parallel installed handoffs keep four independent session records',
    handoffs.every((item) => item.status === 0) && isolated,
    JSON.stringify({
      inheritedSuppressionEnv: Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => PRESENCE_CONTROL_ENV.has(key.toLowerCase()))),
      handoffs: handoffs.map(({ sessionId, status, stderr }) => ({ sessionId, status, stderr })),
      observedSessions,
    }));

  write(path.join(legacy, '.harness', 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(legacy, '.harness', 'progress-tracker.md'), '# legacy authoritative state\n');
  write(path.join(legacy, '.harness', 'runs', 'codex.jsonl'), '{"agent":"codex"}\n');
  write(path.join(legacy, '.leerness', 'state.json'), JSON.stringify({
    schemaVersion: 1,
    project: 'legacy-cleanroom',
    currentRunId: null,
    runCounter: 0,
    updatedAt: null,
  }, null, 2) + '\n');
  const migrate = runNode(cli, ['migrate-workspace-dir', legacy, '--json'], { cwd: legacy });
  const migrated = parseJson(migrate.stdout);
  check('installed migration preserves canonical substrate and remaps legacy runs',
    migrate.status === 0 && migrated && migrated.migrated === true
      && !fs.existsSync(path.join(legacy, '.harness'))
      && fs.existsSync(path.join(legacy, '.leerness', 'state.json'))
      && fs.existsSync(path.join(legacy, '.leerness', 'cache', 'agent-runs', 'codex.jsonl'))
      && fs.readFileSync(path.join(legacy, '.leerness', 'progress-tracker.md'), 'utf8').includes('legacy authoritative'),
    `exit=${migrate.status} ${(migrate.stderr || migrate.stdout).slice(-600)}`);

  const surface = runNode(commandSurface, [], { cwd: consumer, timeout: 900000 });
  check('installed exhaustive command-surface suite passes', surface.status === 0,
    `exit=${surface.status}\n${(surface.stderr || surface.stdout).slice(-1600)}`);
}

(async () => {
  try {
    await main();
  } catch (error) {
    check('installed cleanroom probe does not throw', false, error && error.stack ? error.stack : String(error));
  } finally {
    const resolved = path.resolve(tempRoot);
    const temp = path.resolve(os.tmpdir());
    if (path.dirname(resolved) !== temp || !resolved.startsWith(temp + path.sep)) {
      throw new Error(`unsafe cleanup target: ${resolved}`);
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  if (failed) {
    process.stderr.write(`INSTALLED_CLEANROOM_FAILED ${failed}/${total}\n`);
    process.exit(1);
  }
  process.stdout.write(`INSTALLED_CLEANROOM_OK ${total}/${total}\n`);
})();
