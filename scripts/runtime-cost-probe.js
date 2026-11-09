#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module);  

 
 
 
 
 
 
 
 
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
let fixtureGit;

 
 
 
 
fs.writeFileSync(preload, String.raw`'use strict';
const file = process.env.LEERNESS_PROBE_CENSUS;
if (file) {
  const cp = require('child_process');
  const fs = require('fs');
  const fd = fs.openSync(file, 'a');
  const writeSync = fs.writeSync.bind(fs);
  const path = require('path');
  const tools = new Set(${JSON.stringify([...TOOL_NAMES])});
  const fixtureDir = process.env.LEERNESS_RUNTIME_COST_FIXTURE_DIR;
  const toolName = value => {
    const name = path.basename(String(value)).replace(/\.(exe|cmd|bat|cjs|mjs|js)$/i, '');
    return name === 'npm-cli' ? 'npm' : name;
  };
  const located = tool => {
    const candidate = tool === 'git' ? process.env.LEERNESS_RUNTIME_COST_GIT
      : tool === 'npm' ? path.join(path.dirname(process.execPath), process.platform === 'win32' ? 'npm.cmd' : 'npm')
      : path.join(fixtureDir, tool + (process.platform === 'win32' ? '.cmd' : ''));
    return candidate && fs.existsSync(candidate) ? candidate : null;
  };
  for (const name of ['spawnSync', 'spawn', 'execFileSync', 'execSync']) {
    const original = cp[name];
    cp[name] = function (command, args) {
      try { writeSync(fd, JSON.stringify([String(command), ...(Array.isArray(args) ? args.map(String) : [])]) + '\n'); } catch {}
      if (name === 'spawnSync' && fixtureDir && Array.isArray(args)) {
        const locator = /^(where(?:\.exe)?|which)$/i.test(path.basename(String(command)));
        const requested = args.length === 1 ? String(args[0]) : '';
        if (locator && (tools.has(requested) || requested === 'leerness-probe-missing-tool')) {
          const found = tools.has(requested) ? located(requested) : null;
          return { status: found ? 0 : 1, signal: null, stdout: found ? found + '\n' : '', stderr: '' };
        }
        if (['--version', '-version', 'version'].includes(args[args.length - 1])) {
          const tool = [command, ...args.slice(0, -1)].map(toolName).find(value => tools.has(value));
          if (tool && !located(tool)) return { status: null, signal: null, stdout: '', stderr: '',
            error: Object.assign(new Error('controlled executable is absent'), { code: 'ENOENT' }) };
          if (tool) return process.env.LEERNESS_RUNTIME_COST_FIXTURE_MODE === 'incomplete' && tool === 'npm'
            ? { status: 42, signal: null, stdout: '', stderr: 'controlled unavailable version' }
            : { status: 0, signal: null, stdout: tool + '-fixture-version\n', stderr: '' };
        }
      }
      return original.apply(this, arguments);
    };
  }
}
`);

function envWith(overrides) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(NODE_OPTIONS|LEERNESS_SKILLPACK_PATH|LEERNESS_CACHE_DIR|LEERNESS_NO_ENV_DETECT|LEERNESS_PROBE_CENSUS|LEERNESS_RUNTIME_COST_FIXTURE_\w+|LEERNESS_RUNTIME_COST_GIT)$/i.test(key)) delete env[key];
  }
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'PATH';
  const systemDirs = process.platform === 'win32'
    ? [path.join(process.env.SystemRoot || process.env.WINDIR, 'System32')]
    : ['/usr/bin', '/bin'];
  env[pathKey] = [pathDir, path.dirname(process.execPath), path.dirname(fixtureGit), ...systemDirs].join(path.delimiter);
  return Object.assign(env, {
    LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_AUTO_ROADMAP: '1',
    LEERNESS_NO_STALE_CHECK: '1',
    LEERNESS_RUNTIME_COST_FIXTURE_DIR: pathDir, LEERNESS_RUNTIME_COST_GIT: fixtureGit,
    LEERNESS_RUNTIME_COST_FIXTURE_MODE: 'complete',
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
  const gitLocation = cp.spawnSync(process.platform === 'win32'
    ? path.join(process.env.SystemRoot || process.env.WINDIR, 'System32', 'where.exe') : 'which', ['git'],
  { encoding: 'utf8', timeout: 2000, maxBuffer: 64 * 1024 });
  assert.strictEqual(gitLocation.status, 0, 'controlled fixture requires the real Git used by non-version commands');
  fixtureGit = String(gitLocation.stdout).split(/\r?\n/).find(file => path.isAbsolute(file) && fs.statSync(file).isFile());
  assert(fixtureGit, 'controlled fixture requires an ordinary real Git executable');
  for (const tool of TOOL_NAMES) {
    if (['npm', 'git', 'deno'].includes(tool)) continue;
    if (process.platform === 'win32') {
      const entry = path.join(pathDir, 'node_modules', 'runtime-cost-fixture', tool + '.js');
      fs.mkdirSync(path.dirname(entry), { recursive: true });
      fs.writeFileSync(entry, `console.log(${JSON.stringify(tool + '-fixture-version')});\n`);
      fs.writeFileSync(path.join(pathDir, tool + '.cmd'), '@"%_prog%" "%dp0%\\node_modules\\runtime-cost-fixture\\' + tool + '.js" %*\r\n');
    } else fs.writeFileSync(path.join(pathDir, tool), '#!/bin/sh\necho ' + tool + '-fixture-version\n', { mode: 0o755 });
  }
  fs.writeFileSync(path.join(project, 'package.json'),
    JSON.stringify({ name: 'runtime-cost-probe', version: '0.0.0', scripts: { lint: 'leerness-probe-missing-tool .' } }) + '\n');
  run(['init', project, '--yes'], path.join(root, 'cache-init'));

   
  const skillCache = path.join(root, 'cache-skill');
  for (const args of [['--version'], ['task', 'list', '--json']]) {
    assert.strictEqual(npmRootCalls(run(args, skillCache)), 0, `${args.join(' ')} must not run npm root -g`);
  }
  console.log('PASS: --version and task list run no skillpack discovery');

   
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

   
  const envCache = path.join(root, 'cache-env');
  const first = run(['handoff', project, '--inspect'], envCache);
  assert(toolProbes(first) > 0, 'a cold cache must probe tools');
  assert(!/환경 조회: 미확인|Environment inspection: unknown/.test(first.stdout), 'cold inspection must complete before testing warm reuse');
  const inventoryFile = path.join(envCache, 'env-tools.json');
  const inventoryEntries = JSON.parse(fs.readFileSync(inventoryFile, 'utf8')).entries;
  assert.strictEqual(Object.keys(inventoryEntries).length, 1, 'cold inspection must publish one inventory');
  const inventoryKey = Object.keys(inventoryEntries)[0], inventory = inventoryEntries[inventoryKey].value;
  assert(inventory && inventory.tools && inventory.commands && Array.isArray(inventory.files) && inventory.files.length > 0
    && Number.isFinite(inventory.probedAt), 'published inventory must be complete and usable');
  assert.strictEqual(inventory.commands['leerness-probe-missing-tool'], false);
  for (const [file, size, mtime] of inventory.files) {
    const stat = fs.statSync(file);
    assert.strictEqual(stat.size, size); assert.strictEqual(stat.mtimeMs, mtime);
  }
  const inventoryCache = require('../lib/machine-cache'), previousInventoryDir = process.env.LEERNESS_CACHE_DIR;
  process.env.LEERNESS_CACHE_DIR = envCache;
  try { assert.deepStrictEqual(inventoryCache.readCache('env-tools', inventoryKey, 24 * 60 * 60 * 1000), inventory); }
  finally { if (previousInventoryDir === undefined) delete process.env.LEERNESS_CACHE_DIR; else process.env.LEERNESS_CACHE_DIR = previousInventoryDir; }
  const second = run(['handoff', project, '--inspect'], envCache);
  assert.strictEqual(toolProbes(second), 0, 'a warm cache must not probe tools');
  assert.deepStrictEqual(envLines(second.stdout), envLines(first.stdout), 'cached inventory must not change handoff output');
  assert(envLines(second.stdout).some(line => line.includes('leerness-probe-missing-tool')),
    'the missing script command must still be reported from the cache');
   
   
  const transient = path.join(pathDir, 'daemon.lock');
  fs.writeFileSync(transient, 'x');
  fs.rmSync(transient);
  assert.strictEqual(toolProbes(run(['handoff', project, '--inspect'], envCache)), 0, 'directory activity without new executables keeps the cache');
   
   
   
  const win = process.platform === 'win32';
  const fakeEntry = win ? path.join(pathDir, 'node_modules', 'fake-deno', 'deno.js') : path.join(pathDir, 'deno');
  const writeFakeTool = version => fs.writeFileSync(fakeEntry,
    win ? `console.log('deno ${version}');\n` : `#!/bin/sh\necho deno ${version}\n`, { mode: 0o755 });
  if (win) {
    fs.mkdirSync(path.dirname(fakeEntry), { recursive: true });
    fs.writeFileSync(path.join(pathDir, 'deno.cmd'), '@"%_prog%" "%dp0%\\node_modules\\fake-deno\\deno.js" %*\r\n');
  }
  writeFakeTool('0.0.0');
  assert(toolProbes(run(['handoff', project, '--inspect'], envCache)) > 0, 'a new executable on PATH must invalidate the cache');
  assert(toolProbes(run(['handoff', project, '--inspect', '--writeback'], envCache)) > 0, 'explicit capture must always probe');
  assert.strictEqual(toolProbes(run(['handoff', project, '--inspect'], envCache)), 0, 'the refreshed inventory is reused');
   
  writeFakeTool('0.0.1-upgraded');
  assert(toolProbes(run(['handoff', project, '--inspect'], envCache)) > 0, 'an executable upgraded in place must invalidate the cache');
   
   
  fs.writeFileSync(path.join(project, '.tool-versions'), 'nodejs 0.0.0\n');
  assert(toolProbes(run(['handoff', project, '--inspect'], envCache)) > 0, 'a changed version file must invalidate the cache');
  const other = path.join(root, 'other-project');
  fs.mkdirSync(other);
  run(['init', other, '--yes'], path.join(root, 'cache-init'));
   
   
  const stamp = new Date(Math.floor(Date.now() / 1000) * 1000);
  for (const name of ['package.json', '.tool-versions']) {
    fs.copyFileSync(path.join(project, name), path.join(other, name));
    for (const dir of [project, other]) fs.utimesSync(path.join(dir, name), stamp, stamp);
    const [a, b] = [project, other].map(dir => fs.statSync(path.join(dir, name)));
    assert(a.size === b.size && a.mtimeMs === b.mtimeMs, `setup: ${name} must be identical in both projects`);
  }
  run(['handoff', project, '--inspect'], envCache);
  assert(toolProbes(run(['handoff', other, '--inspect'], envCache)) > 0, 'another project must not reuse this inventory');
   
  assert.strictEqual(toolProbes(run(['handoff', project, '--inspect'], envCache)), 0, 'setup: this project is cached');
  assert(toolProbes(run(['handoff', project, '--inspect'], envCache, { PYENV_VERSION: 'probe-0.0' })) > 0,
    'a version-manager variable must invalidate the cache');
  console.log('PASS: explicit handoff inspection reuses tool detection per project until PATH executables, a probed executable, version files or version-manager variables change; --writeback always probes');

  const unknownProject = path.join(root, 'unknown-project'); fs.mkdirSync(unknownProject);
  run(['init', unknownProject, '--yes'], path.join(root, 'cache-init'));
  const originalSnapshot = Buffer.from('{\r\n  "capturedAt":"2020-01-01T00:00:00.000Z","note":"보존 원문","tools":{"prior":{"version":"retained"}}\r\n}\r\n');
  const unknownSnapshot = path.join(unknownProject, '.leerness', 'environment.json');
  fs.writeFileSync(unknownSnapshot, originalSnapshot);
  const unknownCache = path.join(root, 'cache-unknown'), unknownFile = path.join(unknownCache, 'env-tools.json');
  const unavailable = run(['handoff', unknownProject, '--inspect'], unknownCache, { LEERNESS_RUNTIME_COST_FIXTURE_MODE: 'incomplete' });
  assert(toolProbes(unavailable) > 0, 'unknown control must actually attempt tool observation');
  assert(/환경 조회: 미확인|Environment inspection: unknown/.test(unavailable.stdout), 'an incomplete inspection must remain unknown');
  assert(!fs.existsSync(unknownFile), 'an incomplete inspection must not create an inventory cache');
  assert.deepStrictEqual(fs.readFileSync(unknownSnapshot), originalSnapshot, 'unknown inspection must preserve the original snapshot');
  fs.mkdirSync(unknownCache, { recursive: true });
  const originalCache = Buffer.from('{"entries":{},"note":"보존 cache"}\r\n'); fs.writeFileSync(unknownFile, originalCache);
  const unavailableAgain = run(['handoff', unknownProject, '--inspect'], unknownCache, { LEERNESS_RUNTIME_COST_FIXTURE_MODE: 'incomplete' });
  assert(toolProbes(unavailableAgain) > 0, 'unknown without a usable inventory must observe again');
  assert(/환경 조회: 미확인|Environment inspection: unknown/.test(unavailableAgain.stdout));
  assert.deepStrictEqual(fs.readFileSync(unknownFile), originalCache, 'unknown inspection must preserve the previous cache');
  assert.deepStrictEqual(fs.readFileSync(unknownSnapshot), originalSnapshot);
  console.log('PASS: incomplete inspection remains unknown without publishing a cache or overwriting original snapshot/cache bytes');

   
   
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
