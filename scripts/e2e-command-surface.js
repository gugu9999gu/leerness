#!/usr/bin/env node
'use strict';

// T-0099 / UR-0076: historically uncovered command families.
// Local state commands execute end-to-end in a disposable fixture. Commands that
// can touch external systems or the desktop are exercised through permission
// denial or --dry-run, with an explicit proof that no marker was created.

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const TEST_TOKEN_NAME = 'LEERNESS_COMMAND_SURFACE_TOKEN';
const TEST_TOKEN_VALUE = 'surface-fixture-value-never-persist';
let total = 0;
let failed = 0;
const startedAt = Date.now();
const roots = [];
const children = new Set();

const baseEnv = { ...process.env,
  LEERNESS_OFFLINE: '1',
  LEERNESS_NO_PROMPT: '1',
  LEERNESS_NO_AUTOCHCP: '1',
  LEERNESS_SESSION_ID: 'command-surface-audit',
  [TEST_TOKEN_NAME]: TEST_TOKEN_VALUE,
};
delete baseEnv.CODEX_THREAD_ID;
delete baseEnv.CLAUDE_CODE_SESSION_ID;
delete baseEnv.LEERNESS_FIXED_INTERVAL;

function check(label, condition, detail = '') {
  total++;
  const ok = !!condition;
  process.stdout.write(`${ok ? '✓' : '✗'} ${label}${!ok && detail ? `\n    ${detail}` : ''}\n`);
  if (!ok) failed++;
  return ok;
}

function run(root, args, opts = {}) {
  const argv = [CLI, ...args];
  if (root && !opts.noPath) argv.push('--path', root);
  return cp.spawnSync(process.execPath, argv, {
    cwd: opts.cwd || root || process.cwd(),
    encoding: 'utf8',
    timeout: opts.timeout || 60000,
    env: { ...baseEnv, ...(opts.env || {}) },
  });
}

function parseJson(result) {
  try { return JSON.parse(result.stdout || ''); } catch { return null; }
}

function fresh(prefix = 'leerness-command-surface-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function git(root, args) {
  const config = path.join(root, '.surface-empty-gitconfig');
  if (!fs.existsSync(config)) fs.writeFileSync(config, '', 'utf8');
  const env = { ...baseEnv, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_SYSTEM: config, GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS']) delete env[key];
  return cp.spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30000, env });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && address.port;
      server.close(err => err ? reject(err) : resolve(port));
    });
  });
}

function request(port, method, pathname, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port, method, path: pathname,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.once('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('HTTP timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

function waitForOutput(child, pattern, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => finish(new Error(`timeout waiting for ${pattern}: ${output.slice(-500)}`)), timeoutMs);
    const onData = chunk => {
      output += chunk.toString();
      if (pattern.test(output)) finish(null, output);
    };
    const onExit = code => finish(new Error(`process exited ${code}: ${output.slice(-500)}`));
    function finish(error, value) {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
      if (error) reject(error); else resolve(value);
    }
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', onExit);
  });
}

function stopChild(child) {
  return new Promise(resolve => {
    if (!child || child.exitCode != null) { resolve(); return; }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve();
    }, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    try { child.kill('SIGTERM'); } catch { clearTimeout(timer); resolve(); }
  });
}

async function main() {
  console.log('# leerness command-surface E2E — formerly uncovered command families');
  const root = fresh();
  const init = run(null, ['init', root, '--yes', '--language', 'ko', '--no-stale-check'], { noPath: true, cwd: root, timeout: 90000 });
  check('fixture init succeeds', init.status === 0, init.stderr || init.stdout);

  // creds list/register/check/refresh: values stay in env and are never persisted.
  const deployScript = path.join(root, 'surface-deploy-command.js');
  const deployMarker = path.join(root, 'surface-deploy-ran.txt');
  fs.writeFileSync(deployScript, "require('fs').writeFileSync('surface-deploy-ran.txt', 'ran\\n');\n", 'utf8');
  let r = run(root, ['creds', 'register', 'surface', '--env-var', TEST_TOKEN_NAME, '--deploy', 'node surface-deploy-command.js']);
  check('creds register stores an env reference', r.status === 0, r.stderr || r.stdout);
  r = run(root, ['creds', 'list', '--json']);
  const credsList = parseJson(r);
  check('creds list returns the registered service', r.status === 0 && credsList?.services?.surface?.envVars?.includes(TEST_TOKEN_NAME), r.stdout || r.stderr);
  const credentialsText = fs.readFileSync(path.join(root, '.harness', 'credentials.local.json'), 'utf8');
  check('creds registry never persists the credential value', !credentialsText.includes(TEST_TOKEN_VALUE));
  r = run(root, ['creds', 'check', 'surface', '--json']);
  const credsCheck = parseJson(r);
  check('creds check confirms the injected env value', r.status === 0 && credsCheck?.ok === true && credsCheck?.services?.surface?.envSet === true, r.stdout || r.stderr);
  r = run(root, ['creds', 'refresh', 'surface']);
  const refreshed = JSON.parse(fs.readFileSync(path.join(root, '.harness', 'credentials.local.json'), 'utf8'));
  check('creds refresh records a valid timestamp', r.status === 0 && !Number.isNaN(Date.parse(refreshed.services.surface.lastRefreshed)), r.stderr || r.stdout);

  // env check/sync/detect: keys synchronize, values do not leak.
  fs.writeFileSync(path.join(root, '.env'), 'SURFACE_PUBLIC=visible\nSURFACE_PRIVATE=do-not-copy\n', 'utf8');
  fs.writeFileSync(path.join(root, '.env.example'), 'SURFACE_PUBLIC=\n', 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'surface-fixture', version: '1.0.0', dependencies: { react: '1.0.0', 'surface-unknown-dep': '1.0.0' } }, null, 2) + '\n');
  r = run(root, ['env', 'check', '--json']);
  const envBefore = parseJson(r);
  check('env check reports keys missing from .env.example', r.status === 1 && envBefore?.inEnvOnly?.includes('SURFACE_PRIVATE'), `status=${r.status}\n${r.stdout || r.stderr}`);
  r = run(root, ['env', 'sync']);
  const exampleText = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  check('env sync adds the key with an empty value only', r.status === 0 && /SURFACE_PRIVATE=\r?\n/.test(exampleText) && !exampleText.includes('do-not-copy'), r.stderr || r.stdout);
  r = run(root, ['env', 'check', '--json']);
  const envAfter = parseJson(r);
  check('env check is clean after sync', r.status === 0 && envAfter?.inEnvOnly?.length === 0, r.stdout || r.stderr);
  r = run(root, ['env', 'detect', '--json'], { timeout: 90000 });
  const detected = parseJson(r);
  check('env detect persists a machine-readable snapshot', r.status === 0 && detected?.persisted === true && fs.existsSync(path.join(root, '.harness', 'environment.json')), r.stdout || r.stderr);

  // Adaptive wakeup interval state round-trip.
  r = run(root, ['wakeup-interval', 'set', '600', '--json']);
  check('wakeup-interval set stores an override', r.status === 0 && parseJson(r)?.override === 600, r.stdout || r.stderr);
  r = run(root, ['wakeup-interval', 'get', '--json']);
  const wakeGet = parseJson(r);
  check('wakeup-interval get returns the fixed override', r.status === 0 && wakeGet?.interval === 600 && wakeGet?.adaptive === false, r.stdout || r.stderr);
  r = run(root, ['wakeup-interval', 'record', 'user-trigger', '--json']);
  check('wakeup-interval record accepts user-trigger', r.status === 0 && parseJson(r)?.recorded === 'user-trigger', r.stdout || r.stderr);
  r = run(root, ['wakeup-interval', 'history', '--json']);
  const wakeHistory = parseJson(r);
  check('wakeup-interval history retains the fire', r.status === 0 && wakeHistory?.fires?.some(f => f.kind === 'user-trigger'), r.stdout || r.stderr);
  r = run(root, ['wakeup-interval', 'auto', '--json']);
  check('wakeup-interval auto clears the override', r.status === 0 && parseJson(r)?.override === null, r.stdout || r.stderr);

  // Workspace directory, feature toggles, glossary, and policy.
  r = run(root, ['workspace-dir', 'get', '--json']);
  check('workspace-dir get reports .harness as the active store', r.status === 0 && parseJson(r)?.current === '.harness', r.stdout || r.stderr);
  r = run(root, ['workspace-dir', 'guide']);
  check('workspace-dir guide explains the canonical directory', r.status === 0 && r.stdout.includes('.harness'), r.stderr || r.stdout);
  r = run(root, ['toggle', 'set', 'workflow-distribute', 'off', '--json']);
  check('toggle set persists an explicit OFF value', r.status === 0 && parseJson(r)?.value === false, r.stdout || r.stderr);
  r = run(root, ['toggle', 'list', '--json']);
  check('toggle list returns the persisted value', r.status === 0 && parseJson(r)?.toggles?.['workflow-distribute'] === false, r.stdout || r.stderr);
  r = run(root, ['glossary', 'build', '--json']);
  const glossaryBuild = parseJson(r);
  check('glossary build writes both rendered and JSON artifacts', r.status === 0 && glossaryBuild?.ok === true && fs.existsSync(path.join(root, '.harness', 'glossary.md')) && fs.existsSync(path.join(root, '.harness', 'glossary.json')), r.stdout || r.stderr);
  r = run(root, ['glossary', 'show', '--json']);
  const glossaryShow = parseJson(r);
  check('glossary show exposes defined entries and unresolved gaps', r.status === 0 && glossaryShow?.entries?.some(e => e.term === 'react') && glossaryShow?.gaps?.some(e => e.term === 'surface-unknown-dep'), r.stdout || r.stderr);
  r = run(root, ['policy', 'set', 'read-only', '--enforce', '--json']);
  check('policy set enables enforcement at read-only', r.status === 0 && parseJson(r)?.set === 'read-only' && parseJson(r)?.enforce === true, r.stdout || r.stderr);
  r = run(root, ['policy', 'show', '--json']);
  check('policy show returns the saved tier', r.status === 0 && parseJson(r)?.allowedTier === 'read-only' && parseJson(r)?.enforce === true, r.stdout || r.stderr);
  r = run(root, ['policy', 'check', 'release publish', '--json']);
  const policyCheck = parseJson(r);
  check('policy check blocks publish and signals exit 1', r.status === 1 && policyCheck?.allowed === false, r.stdout || r.stderr);

  // PATH is diagnostic-only unless --apply is explicit.
  r = run(root, ['path-setup', '--json'], { timeout: 30000 });
  const pathSetup = parseJson(r);
  check('path-setup default is read-only (applied=null)', r.status === 0 && pathSetup && pathSetup.applied === null, r.stdout || r.stderr);

  // Browser/desktop bridges: inspect availability, then prove basic mode rejects actions before loading/using them.
  r = run(root, ['web', 'check', '--json'], { timeout: 30000 });
  check('web check returns structured capability state', r.status === 0 && typeof parseJson(r)?.installed === 'boolean', r.stdout || r.stderr);
  const webOut = path.join(root, 'must-not-exist.png');
  r = run(root, ['web', 'screenshot', 'https://example.invalid', '--out', webOut, '--json']);
  check('web screenshot is permission-denied without network/output', r.status === 1 && parseJson(r)?.ok === false && !fs.existsSync(webOut), r.stdout || r.stderr);
  r = run(root, ['web', 'extract', 'https://example.invalid', '--selector', 'body', '--json']);
  check('web extract is permission-denied without network', r.status === 1 && parseJson(r)?.ok === false, r.stdout || r.stderr);
  r = run(root, ['pc', 'check', '--json'], { timeout: 30000 });
  check('pc check returns structured capability state', r.status === 0 && typeof parseJson(r)?.installed === 'boolean', r.stdout || r.stderr);
  r = run(root, ['pc', 'click', '1', '1', '--json']);
  check('pc click is permission-denied before desktop input', r.status === 1 && parseJson(r)?.ok === false, r.stdout || r.stderr);
  r = run(root, ['pc', 'type', 'must-not-type', '--json']);
  check('pc type is permission-denied before keyboard input', r.status === 1 && parseJson(r)?.ok === false, r.stdout || r.stderr);
  const pcOut = path.join(root, 'must-not-exist-pc.png');
  r = run(root, ['pc', 'screenshot', '--out', pcOut, '--json']);
  check('pc screenshot is permission-denied without output', r.status === 1 && parseJson(r)?.ok === false && !fs.existsSync(pcOut), r.stdout || r.stderr);

  // LSP bridge executes locally through TypeScript API or the built-in regex fallback.
  const sample = path.join(root, 'surface-sample.js');
  fs.writeFileSync(sample, 'function surfaceFn() { return 1; }\nmodule.exports = { surfaceFn };\n', 'utf8');
  r = run(root, ['lsp', 'check', '--json'], { timeout: 30000 });
  check('lsp check returns structured native/fallback state', r.status === 0 && parseJson(r)?.fallback === 'regex (always available)', r.stdout || r.stderr);
  r = run(root, ['lsp', 'symbols', sample, '--json'], { timeout: 30000 });
  const symbols = parseJson(r);
  check('lsp symbols finds a local function', r.status === 0 && symbols?.symbols?.some(s => s.name === 'surfaceFn'), r.stdout || r.stderr);
  r = run(root, ['lsp', 'references', 'surfaceFn', '--in', root, '--json'], { timeout: 30000 });
  check('lsp references finds local usages', r.status === 0 && parseJson(r)?.count >= 2, r.stdout || r.stderr);

  // Webhook listener is safe to exercise fully on localhost.
  const port = await freePort();
  const webhook = cp.spawn(process.execPath, [CLI, 'webhook', 'serve', '--port', String(port), '--path', root], {
    cwd: root, env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  children.add(webhook);
  try {
    await waitForOutput(webhook, /listening on port/);
    const health = await request(port, 'GET', '/health');
    const healthJson = JSON.parse(health.body);
    check('webhook serve answers localhost health', health.status === 200 && healthJson.ok === true && healthJson.port === port, health.body);
    const accepted = await request(port, 'POST', '/incident', { error: 'surface fixture incident' });
    const acceptedJson = JSON.parse(accepted.body);
    check('webhook serve accepts and persists a local incident', accepted.status === 202 && /^inc-/.test(acceptedJson.incident || '') && fs.existsSync(path.join(root, '.harness', 'incidents')), accepted.body);
  } finally {
    await stopChild(webhook);
    children.delete(webhook);
  }

  // Deploy auto reaches its dry-run gate but must never execute the stored command.
  r = run(root, ['permissions', 'set', 'extended']);
  check('permissions extended enables allowlisted shell diagnostics', r.status === 0, r.stderr || r.stdout);
  r = run(root, ['deploy', 'auto', 'surface', '--dry-run']);
  check('deploy auto --dry-run skips the registered command', r.status === 0 && r.stdout.includes('dry-run') && !fs.existsSync(deployMarker), r.stderr || r.stdout);

  // release sync-main: a local two-branch repository, no remote, and dry-run must preserve branch + HEAD.
  const repo = fresh('leerness-sync-main-');
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'surface@example.invalid']);
  git(repo, ['config', 'user.name', 'Leerness Surface Test']);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n', 'utf8');
  git(repo, ['add', 'base.txt']);
  git(repo, ['commit', '-m', 'base']);
  git(repo, ['branch', '-M', 'main']);
  git(repo, ['checkout', '-b', 'release/surface']);
  fs.writeFileSync(path.join(repo, 'release.txt'), 'release\n', 'utf8');
  git(repo, ['add', 'release.txt']);
  git(repo, ['commit', '-m', 'release']);
  const branchBefore = (git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout || '').trim();
  const headBefore = (git(repo, ['rev-parse', 'HEAD']).stdout || '').trim();
  r = run(repo, ['release', 'sync-main', '--dry-run', '--no-npm']);
  const branchAfter = (git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout || '').trim();
  const headAfter = (git(repo, ['rev-parse', 'HEAD']).stdout || '').trim();
  check('release sync-main --dry-run preserves branch and HEAD without a remote', r.status === 0 && /dry-run/.test(r.stdout) && branchBefore === 'release/surface' && branchAfter === branchBefore && headAfter === headBefore, r.stderr || r.stdout);
}

main().catch(error => {
  check('command-surface runner completed without exception', false, error && error.stack ? error.stack : String(error));
}).finally(async () => {
  for (const child of children) await stopChild(child);
  for (const root of roots) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n${total - failed}/${total} passed · ${elapsed}s`);
  process.exitCode = failed ? 1 : 0;
});
