#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

// T-0304: per-command runtime cost. The checks count child processes instead of timing them,
// so they stay deterministic on slow CI machines.
//   - commands that never read skills do not run skillpack discovery (`npm root -g`)
//   - skillpack discovery reuses a machine cache keyed by its inputs, and --dry-run writes none
//   - runtime environment collection runs once per process; tool versions only on request
//   - default handoff reuses the tool inventory per project until PATH executables, a probed
//     executable or a version file change, while explicit capture (--writeback) always probes
//   - machine cache entries stay bounded and keep the newest even within one millisecond
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cli = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-runtime-cost-'));
const project = path.join(root, 'project');
const pathDir = path.join(root, 'path-dir');
const preload = path.join(root, 'census.js');
const TOOL_NAMES = new Set(['npm', 'pnpm', 'yarn', 'git', 'python', 'python3', 'pip', 'docker', 'gh', 'java',
  'go', 'rustc', 'cargo', 'deno', 'bun', 'tsc', 'next', 'vite']);

// Every node process started with this preload appends one JSON argv line per child process.
// The descriptor is opened before the CLI runs and written with writeSync: --dry-run later wraps
// the path-based fs mutators (appendFileSync itself calls the wrapped writeFileSync), and the
// census must keep recording under it.
fs.writeFileSync(preload, `'use strict';
const file = process.env.LEERNESS_PROBE_CENSUS;
if (file) {
  const cp = require('child_process');
  const fs = require('fs');
  const fd = fs.openSync(file, 'a');
  const writeSync = fs.writeSync.bind(fs);
  for (const name of ['spawnSync', 'spawn', 'execFileSync', 'execSync']) {
    const original = cp[name];
    cp[name] = function (command, args) {
      try { writeSync(fd, JSON.stringify([String(command), ...(Array.isArray(args) ? args.map(String) : [])]) + '\\n'); } catch {}
      return original.apply(this, arguments);
    };
  }
}
`);

function envWith(overrides) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(NODE_OPTIONS|LEERNESS_SKILLPACK_PATH|LEERNESS_CACHE_DIR|LEERNESS_NO_ENV_DETECT|LEERNESS_PROBE_CENSUS)$/i.test(key)) delete env[key];
  }
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'PATH';
  env[pathKey] = pathDir + path.delimiter + (env[pathKey] || '');
  return Object.assign(env, {
    LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_AUTO_ROADMAP: '1',
    LEERNESS_NO_STALE_CHECK: '1',
  }, overrides);
}

let runs = 0;
function run(args, cacheDir, extraEnv = {}) {
  const census = path.join(root, `census-${++runs}.jsonl`);
  const env = envWith({
    ...extraEnv,
    LEERNESS_CACHE_DIR: cacheDir,
    LEERNESS_PROBE_CENSUS: census,
    NODE_OPTIONS: `--require "${preload.replace(/\\/g, '/')}"`,
  });
  const result = cp.spawnSync(process.execPath, [cli, ...args], {
    cwd: project, env, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024,
  });
  assert.strictEqual(result.status, 0, `${args.join(' ')} exited ${result.status}: ${String(result.stderr || result.stdout).slice(0, 600)}`);
  const spawned = fs.existsSync(census)
    ? fs.readFileSync(census, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  return { stdout: result.stdout, spawned };
}
const npmRootCalls = r => r.spawned.filter(argv => argv.some((arg, i) => arg === 'root' && argv[i + 1] === '-g')).length;
function toolProbes(r) {
  return r.spawned.filter(argv => {
    if (!['--version', '-version', 'version'].includes(argv[argv.length - 1])) return false;
    return argv.slice(0, -1).some(arg => {
      const name = path.basename(arg).replace(/\.(exe|cmd|bat|cjs|mjs|js)$/i, '');
      return TOOL_NAMES.has(name === 'npm-cli' ? 'npm' : name);
    });
  }).length;
}
const envLines = text => text.split(/\r?\n/).filter(line => /PATH|leerness-probe-missing-tool|Runtime environment|실행 환경/.test(line));

try {
  fs.mkdirSync(project);
  fs.mkdirSync(pathDir);
  fs.writeFileSync(path.join(project, 'package.json'),
    JSON.stringify({ name: 'runtime-cost-probe', version: '0.0.0', scripts: { lint: 'leerness-probe-missing-tool .' } }) + '\n');
  run(['init', project, '--yes'], path.join(root, 'cache-init'));

  // 1. Commands that never read skills pay no skillpack discovery.
  const skillCache = path.join(root, 'cache-skill');
  for (const args of [['--version'], ['task', 'list', '--json']]) {
    assert.strictEqual(npmRootCalls(run(args, skillCache)), 0, `${args.join(' ')} must not run npm root -g`);
  }
  console.log('PASS: --version and task list run no skillpack discovery');

  // 2. Discovery that does run is cached by its inputs; --dry-run leaves no cache behind.
  const dryCache = path.join(root, 'cache-dry');
  const dry = run(['skill', 'list', '--json', '--dry-run'], dryCache);
  assert(!fs.existsSync(dryCache), '--dry-run must not create a machine cache');
  const firstSkill = run(['skill', 'list', '--json'], skillCache);
  const source = JSON.parse(firstSkill.stdout).skillpack;
  if (source === 'builtin') {
    assert.strictEqual(npmRootCalls(dry), 1, 'the counter must observe discovery when it runs');
    assert.strictEqual(npmRootCalls(firstSkill), 1, 'a cold cache runs discovery once');
    const secondSkill = run(['skill', 'list', '--json'], skillCache);
    assert.strictEqual(npmRootCalls(secondSkill), 0, 'a warm cache runs no discovery');
    assert.strictEqual(secondSkill.stdout, firstSkill.stdout, 'cached discovery must not change skill list output');
    console.log('PASS: skillpack discovery runs once per cache and not under --dry-run');
  } else {
    console.log(`SKIP: a skillpack is resolvable here (${source}); discovery-cache counts need a builtin environment`);
  }

  // 3. Runtime environment: one collection per process, tool versions only on request, copies returned.
  const calls = [];
  const originalSpawnSync = cp.spawnSync;
  cp.spawnSync = function (command, args) {
    calls.push([String(command), ...(Array.isArray(args) ? args.map(String) : [])]);
    return originalSpawnSync.apply(this, arguments);
  };
  try {
    const mod = require(cli);
    calls.length = 0;
    const base = mod._collectRuntimeEnv({ tools: false });
    const baseCalls = calls.length;
    assert.strictEqual(toolProbes({ spawned: calls }), 0, 'base collection must not probe tool versions');
    base.locale.codepage = 'mutated-by-caller';
    const again = mod._collectRuntimeEnv({ tools: false });
    assert.strictEqual(calls.length, baseCalls, 'a second base collection must not start processes');
    assert.notStrictEqual(again.locale.codepage, 'mutated-by-caller', 'callers must receive copies');
    const full = mod._collectRuntimeEnv();
    const fullCalls = calls.length;
    assert(fullCalls > baseCalls, 'tool versions must be probed when requested');
    assert.deepStrictEqual(Object.keys(full.tools).sort(), ['git', 'npm', 'python', 'python3']);
    mod._collectRuntimeEnv();
    assert.strictEqual(calls.length, fullCalls, 'a second tool collection must not start processes');
  } finally {
    cp.spawnSync = originalSpawnSync;
  }
  console.log('PASS: runtime environment is collected once per process and tools only on request');

  // 4. Default handoff reuses the tool inventory; PATH changes and explicit capture probe again.
  const envCache = path.join(root, 'cache-env');
  const first = run(['handoff', project], envCache);
  assert(toolProbes(first) > 0, 'a cold cache must probe tools');
  const second = run(['handoff', project], envCache);
  assert.strictEqual(toolProbes(second), 0, 'a warm cache must not probe tools');
  assert.deepStrictEqual(envLines(second.stdout), envLines(first.stdout), 'cached inventory must not change handoff output');
  assert(envLines(second.stdout).some(line => line.includes('leerness-probe-missing-tool')),
    'the missing script command must still be reported from the cache');
  // Directory activity that leaves the executable names alone (a daemon rewriting a lock or log)
  // changes the directory time but must keep the cache; a new executable name must not.
  const transient = path.join(pathDir, 'daemon.lock');
  fs.writeFileSync(transient, 'x');
  fs.rmSync(transient);
  assert.strictEqual(toolProbes(run(['handoff', project], envCache)), 0, 'directory activity without new executables keeps the cache');
  // One of the probed tools (deno) now resolves to this directory, so its files are part of the inventory.
  // Windows runs only native executables and npm-style shims without a shell (a plain .cmd is refused
  // and never detected), so the fake tool there is an npm shim whose JavaScript entry prints the version.
  const win = process.platform === 'win32';
  const fakeEntry = win ? path.join(pathDir, 'node_modules', 'fake-deno', 'deno.js') : path.join(pathDir, 'deno');
  const writeFakeTool = version => fs.writeFileSync(fakeEntry,
    win ? `console.log('deno ${version}');\n` : `#!/bin/sh\necho deno ${version}\n`, { mode: 0o755 });
  if (win) {
    fs.mkdirSync(path.dirname(fakeEntry), { recursive: true });
    fs.writeFileSync(path.join(pathDir, 'deno.cmd'), '@"%_prog%" "%dp0%\\node_modules\\fake-deno\\deno.js" %*\r\n');
  }
  writeFakeTool('0.0.0');
  assert(toolProbes(run(['handoff', project], envCache)) > 0, 'a new executable on PATH must invalidate the cache');
  assert(toolProbes(run(['handoff', project, '--writeback'], envCache)) > 0, 'explicit capture must always probe');
  assert.strictEqual(toolProbes(run(['handoff', project], envCache)), 0, 'the refreshed inventory is reused');
  // An upgrade in place keeps every executable name; only the probed file's state reveals it.
  writeFakeTool('0.0.1-upgraded');
  assert(toolProbes(run(['handoff', project], envCache)) > 0, 'an executable upgraded in place must invalidate the cache');
  // Version managers pick tool versions from project files: a changed version file, or another
  // project, probes again instead of reusing this project's inventory.
  fs.writeFileSync(path.join(project, '.tool-versions'), 'nodejs 0.0.0\n');
  assert(toolProbes(run(['handoff', project], envCache)) > 0, 'a changed version file must invalidate the cache');
  const other = path.join(root, 'other-project');
  fs.mkdirSync(other);
  run(['init', other, '--yes'], path.join(root, 'cache-init'));
  // Same version files with the same size and time: only the project differs. A version file in a
  // parent directory, which the key does not read, can still select different tools there.
  const stamp = new Date(Math.floor(Date.now() / 1000) * 1000);
  for (const name of ['package.json', '.tool-versions']) {
    fs.copyFileSync(path.join(project, name), path.join(other, name));
    for (const dir of [project, other]) fs.utimesSync(path.join(dir, name), stamp, stamp);
    const [a, b] = [project, other].map(dir => fs.statSync(path.join(dir, name)));
    assert(a.size === b.size && a.mtimeMs === b.mtimeMs, `setup: ${name} must be identical in both projects`);
  }
  run(['handoff', project], envCache);   // cache the inventory for the stamped files
  assert(toolProbes(run(['handoff', other], envCache)) > 0, 'another project must not reuse this inventory');
  // Version managers also read environment variables (PYENV_VERSION, ASDF_*, MISE_*, VOLTA_* and similar).
  assert.strictEqual(toolProbes(run(['handoff', project], envCache)), 0, 'setup: this project is cached');
  assert(toolProbes(run(['handoff', project], envCache, { PYENV_VERSION: 'probe-0.0' })) > 0,
    'a version-manager variable must invalidate the cache');
  console.log('PASS: default handoff reuses tool detection per project until PATH executables, a probed executable, version files or version-manager variables change; --writeback always probes');

  // 5. Machine cache primitives: key/age bounds, corrupt files as misses, bounded entries,
  //    and no path into a project workspace.
  const MC = require('../lib/machine-cache');
  const RW = require('../lib/runtime-writes');
  const unitCache = path.join(root, 'cache-unit');
  const saved = process.env.LEERNESS_CACHE_DIR;
  process.env.LEERNESS_CACHE_DIR = unitCache;
  try {
    assert.strictEqual(MC.writeCache('probe', 'k1', { a: 1 }), true);
    assert.deepStrictEqual(MC.readCache('probe', 'k1', 60000), { a: 1 });
    assert.strictEqual(MC.readCache('probe', 'k2', 60000), null, 'a different key is a miss');
    assert.strictEqual(MC.readCache('probe', 'k1', -1), null, 'an expired entry is a miss');
    fs.writeFileSync(MC.cacheFile('probe'), '{not json');
    assert.strictEqual(MC.readCache('probe', 'k1', 60000), null, 'a corrupt cache file is a miss');
    // Every write in the same millisecond: recency must not depend on the clock.
    const realNow = Date.now;
    Date.now = () => 1700000000000;
    try {
      for (let i = 0; i < MC.MAX_ENTRIES + 4; i++) MC.writeCache('probe', `key-${i}`, i);
    } finally {
      Date.now = realNow;
    }
    const kept = Object.keys(JSON.parse(fs.readFileSync(MC.cacheFile('probe'), 'utf8')).entries);
    assert(kept.length === MC.MAX_ENTRIES && kept.includes(`key-${MC.MAX_ENTRIES + 3}`) && !kept.includes('key-0'),
      `entries must stay bounded, newest kept: ${kept.length}`);
  } finally {
    if (saved === undefined) delete process.env.LEERNESS_CACHE_DIR; else process.env.LEERNESS_CACHE_DIR = saved;
  }
  assert.throws(() => RW.outsideRuntimeWrites(path.join(project, '.leerness', 'cache', 'x.json'), () => {}),
    error => error.code === 'E_MACHINE_WRITE_IN_WORKSPACE');
  console.log('PASS: machine cache misses safely, stays bounded and refuses workspace paths');
} finally {
  const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(root));
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    'temporary cleanup target must remain inside the system temp directory');
  fs.rmSync(root, { recursive: true, force: true });
}
