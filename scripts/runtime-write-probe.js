'use strict';

// 실제 지원 writer 경계 검증. 모든 descriptor와 데이터는 이 probe의 임시 root에만 둔다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const assert = require('assert');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const pkg = require('../package.json');
const tempParent = fs.realpathSync(os.tmpdir());
const fixturePrefix = 'leerness-runtime-writes-';
const directory = fs.mkdtempSync(path.join(tempParent, fixturePrefix));
const blocked = path.join(directory, 'blocked');
const healthy = path.join(directory, 'healthy');
const FUTURE = { schema: 'leerness.runtime-layout/v1', schemaVersion: 1, scope: 'project-local', generation: 1, layout: 'legacy', requiredWriterProtocol: 2 };
const layout = root => path.join(root, '.leerness/cache/state-layout.json');
const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const descriptor = (root, data = FUTURE) => write(layout(root), JSON.stringify(data));
const env = { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_BANNER: '1', LEERNESS_SKILLPACK_PATH: path.join(directory, 'missing-skillpack') };
for (const name of Object.keys(env)) if (/^LEERNESS_(INTERNAL|WORKSPACE_DIR|NO_AUTO_WORKSPACE_MIGRATION|SESSION_ID|MCP_)/i.test(name) || /^GIT_/i.test(name)) delete env[name];
Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(directory, 'missing-gitconfig'),
  LOCALAPPDATA: path.join(directory, 'local-data'), XDG_STATE_HOME: path.join(directory, 'local-data'),
  npm_config_cache: path.join(directory, 'npm-cache'), npm_config_logs_max: '0' });
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}
function snapshot(root = directory) {
  const result = {};
  const visit = current => {
    const stat = fs.lstatSync(current, { bigint: true });
    const relative = path.relative(root, current) || '.';
    result[relative] = [stat.isDirectory() ? 'dir' : 'file', String(stat.mtimeNs), String(stat.size)];
    if (stat.isDirectory()) for (const name of fs.readdirSync(current).sort()) visit(path.join(current, name));
    else if (stat.isFile()) result[relative].push(crypto.createHash('sha256').update(fs.readFileSync(current)).digest('hex'));
  };
  visit(root);
  return result;
}
function run(args, cwd = healthy, extra = {}) {
  return cp.spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024, ...extra });
}
function deny(args, cwd = healthy) {
  const before = snapshot();
  const result = run(args, cwd);
  assert.strictEqual(result.status, 1, result.stdout + result.stderr);
  assert(/runtime_layout_incompatible|Runtime layout is incompatible/.test(result.stdout + result.stderr), result.stdout + result.stderr);
  assert(!/private-fixture-text/.test(result.stdout + result.stderr));
  assert.deepStrictEqual(snapshot(), before);
}
function throwsBlocked(fn) {
  assert.throws(fn, error => error.code === 'E_RUNTIME_LAYOUT_INCOMPATIBLE');
}
function git(root, args) {
  const result = cp.spawnSync('git', ['-C', root, '-c', 'commit.gpgsign=false', '-c',
    `core.hooksPath=${path.join(directory, 'missing-hooks')}`, ...args], {
    env, encoding: 'utf8', timeout: 15000, maxBuffer: 64 * 1024, windowsHide: true,
  });
  assert.strictEqual(result.status, 0, String(result.error || result.stderr || result.stdout));
  return result.stdout.trim();
}
function gitWriterCases() {
  const roots = ['git-main', 'git-linked-one', 'git-linked-two'].map(name => path.join(directory, name));
  fs.mkdirSync(roots[0]);
  git(roots[0], ['init', '-b', 'main']);
  git(roots[0], ['-c', 'user.name=Runtime Write Probe', '-c', 'user.email=runtime-write@example.invalid',
    'commit', '--allow-empty', '-qm', 'runtime writer fixture']);
  for (const root of roots.slice(1)) git(roots[0], ['worktree', 'add', '--detach', root, 'HEAD']);
  const gitDirectories = roots.map(root => git(root, ['rev-parse', '--absolute-git-dir']));
  assert.strictEqual(new Set(gitDirectories).size, 3, 'fixture must have three distinct Git directories');
  for (const [index, root] of roots.entries()) {
    write(path.join(root, '.leerness/HARNESS_VERSION'), pkg.version);
    write(path.join(root, '.leerness/state.json'), '{"private":"private-fixture-text"}\n');
    write(path.join(gitDirectories[index], 'leerness/layout.json'), JSON.stringify({ ...FUTURE, scope: 'worktree' }));
    test(`real Git ${path.basename(root)} CLI writer: bytes/mtime zero mutation`, () => {
      deny(['state', 'start', '--goal', 'git guard', '--json'], root);
    });
  }
}

// Run real lock/worker lifecycles in an isolated process. The coordinator writes
// the fixture descriptor outside the held operation's AsyncLocalStorage scope.
async function lockLifecycle() {
  const [cliPath, root, mode, futureText] = process.argv.slice(1);
  const { _withLock } = require(cliPath);
  const target = path.join(root, '.leerness/locked.json');
  const descriptorPath = path.join(root, '.leerness/cache/state-layout.json');
  const originalDescriptor = fs.readFileSync(descriptorPath);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (predicate, label, timeout = 5000) => {
    const end = Date.now() + timeout;
    while (!predicate()) {
      assert(Date.now() < end, `timed out: ${label}`);
      await pause(20);
    }
  };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const held = _withLock(target, () => gate);
  const ownerPath = path.join(target + '.lock', fs.readdirSync(target + '.lock')[0]);
  const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
  assert.strictEqual(owner.lease, 'worker-v1', 'real heartbeat worker must be available');
  let waiter;
  try {
    if (mode === 'heartbeat') {
      const createdMtime = fs.statSync(ownerPath, { bigint: true }).mtimeNs;
      await until(() => fs.statSync(ownerPath, { bigint: true }).mtimeNs !== createdMtime, 'healthy heartbeat');
      fs.writeFileSync(descriptorPath, futureText);
      const before = snapshot(root);
      await pause(2300); // Observe more than two normal 1000ms worker ticks.
      assert.deepStrictEqual(snapshot(root), before, 'incompatible layout did not stop heartbeat writes');
    } else {
      const messages = [];
      const source = `
        const { _withLock } = require(process.argv[1]);
        const fs = require('fs');
        process.send({ stage: 'waiting' });
        try {
          _withLock(process.argv[2], () => {
            process.send({ stage: 'entered' });
            fs.appendFileSync(process.argv[2], 'unexpected callback write');
          }, { maxWaitMs: 7000 });
          process.send({ stage: 'result', success: true });
        } catch (error) {
          process.send({ stage: 'result', code: error.code, message: error.message });
        }
        process.disconnect();
      `;
      waiter = cp.spawn(process.execPath, ['-e', source, cliPath, target], {
        cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
      });
      let output = '';
      waiter.stdout.on('data', value => { output += value; });
      waiter.stderr.on('data', value => { output += value; });
      waiter.on('message', message => messages.push(message));
      waiter.on('error', error => messages.push({ stage: 'spawn-error', message: error.message }));
      await until(() => messages.some(message => message.stage === 'waiting'), 'waiter start');
      await pause(300);
      assert.strictEqual(waiter.exitCode, null, `waiter did not remain contended: ${output}`);
      assert(!messages.some(message => message.stage === 'entered'), 'callback entered while another process held lock');
      fs.writeFileSync(descriptorPath, futureText);
      const before = snapshot(root);
      await until(() => waiter.exitCode !== null, 'waiter observes descriptor change', 10000);
      const result = messages.find(message => message.stage === 'result');
      assert(result, output);
      assert(!messages.some(message => message.stage === 'entered'), 'incompatible waiter entered callback');
      assert.deepStrictEqual(snapshot(root), before, 'incompatible waiter changed fixture bytes or mtimes');
      assert.strictEqual(result.code, 'E_RUNTIME_LAYOUT_INCOMPATIBLE', JSON.stringify(result));
    }
  } finally {
    if (waiter && waiter.exitCode === null) {
      waiter.kill();
      await until(() => waiter.exitCode !== null || waiter.signalCode !== null, 'waiter cleanup');
    }
    fs.writeFileSync(descriptorPath, originalDescriptor);
    release();
    await held;
  }
  assert(!fs.existsSync(target + '.lock'), 'healthy owner cleanup left its lock behind');
  console.log(`LIFECYCLE ${mode} PASS`);
}
function lifecycle(mode) {
  const root = path.join(directory, `lifecycle-${mode}`);
  write(path.join(root, '.leerness/HARNESS_VERSION'), pkg.version);
  write(path.join(root, '.leerness/locked.json'), '{"before":true}\n');
  descriptor(root, { ...FUTURE, requiredWriterProtocol: 1 });
  const source = `const fs = require('fs'), path = require('path'), crypto = require('crypto'),
    assert = require('assert'), cp = require('child_process');
    const snapshot = ${snapshot.toString()};
    (${lockLifecycle.toString()})().catch(error => { console.error(error.stack); process.exitCode = 1; });`;
  const result = cp.spawnSync(process.execPath, ['-e', source, CLI, root, mode, JSON.stringify(FUTURE)], {
    cwd: root, env, encoding: 'utf8', timeout: 20000, maxBuffer: 128 * 1024, windowsHide: true,
  });
  assert.strictEqual(result.status, 0, String(result.error || result.stdout + result.stderr));
  assert(result.stdout.includes(`LIFECYCLE ${mode} PASS`), result.stdout + result.stderr);
}
function retainedFdCase() {
  const runtime = require('../lib/runtime-writes');
  const roots = ['fd-owner', 'fd-consumer'].map(name => path.join(directory, name));
  for (const root of roots) {
    write(path.join(root, '.leerness/HARNESS_VERSION'), pkg.version);
    descriptor(root, { ...FUTURE, requiredWriterProtocol: 1 });
  }
  const file = path.join(roots[0], '.leerness/cache/retained.jsonl');
  write(file, '{"before":true}\n');
  const fd = runtime.withRuntimeWrites(roots[0], () => fs.openSync(file, 'a'));
  descriptor(roots[0]); // External fixture change after operation A has returned.
  const before = snapshot();
  let caughtCode;
  let outerError;
  let result;
  try {
    result = runtime.withRuntimeWrites(roots[1], () => {
      try { fs.writeSync(fd, 'not written'); } catch (error) { caughtCode = error.code; }
      return 'operation-B-success';
    });
  } catch (error) { outerError = error; }
  finally { fs.closeSync(fd); }
  assert.strictEqual(caughtCode, 'E_RUNTIME_LAYOUT_INCOMPATIBLE');
  assert.deepStrictEqual(snapshot(), before, 'retained FD rejection changed bytes or mtimes');
  assert.strictEqual(outerError && outerError.code, 'E_RUNTIME_LAYOUT_INCOMPATIBLE', `operation B returned ${result}`);
  assert.strictEqual(result, undefined, 'consumer operation reported success after a caught FD rejection');
}
function mcpTelemetryCase() {
  const cli = require('../bin/leerness');
  const compatibility = require('../lib/runtime-layout');
  const root = path.join(directory, 'mcp-telemetry');
  const usagePath = path.join(root, '.leerness/cache/usage-stats.json');
  write(path.join(root, '.leerness/HARNESS_VERSION'), pkg.version);
  write(usagePath, '{"commands":{},"since":"2026-01-01"}\n');
  descriptor(root, { ...FUTURE, requiredWriterProtocol: 1 });
  assert.strictEqual(compatibility.inspectRuntimeCompatibility(root).writeDisposition, 'allowed');
  const before = snapshot(usagePath);
  const originalRead = fs.readFileSync;
  let flipped = false;
  let rejection;
  // A single deterministic scheduling seam: change only the owned descriptor
  // after the real usage read, without replacing admission or mutation methods.
  fs.readFileSync = function (file, ...args) {
    const value = originalRead.call(this, file, ...args);
    if (file === usagePath && !flipped) { flipped = true; descriptor(root); }
    return value;
  };
  try { cli._bumpMcpUsage(root, 'leerness_state_start'); }
  catch (error) { rejection = error; }
  finally {
    fs.readFileSync = originalRead;
    descriptor(root, { ...FUTURE, requiredWriterProtocol: 1 });
  }
  assert(flipped, 'telemetry did not execute its real usage read');
  assert.deepStrictEqual(snapshot(usagePath), before, 'rejected MCP telemetry changed usage bytes or mtime');
  assert.strictEqual(compatibility.inspectRuntimeCompatibility(root).writeDisposition, 'allowed');
  assert.strictEqual(rejection && rejection.code, 'E_RUNTIME_LAYOUT_INCOMPATIBLE', 'telemetry swallowed a layout rejection');
}
function snapshotOutside(target) {
  const relative = path.relative(directory, target);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  return Object.fromEntries(Object.entries(snapshot()).filter(([name]) => name !== relative && !name.startsWith(relative + path.sep)));
}
function allowTarget(args, target, expectedStatus = 0) {
  const before = snapshotOutside(target);
  const result = run(args, blocked);
  assert.strictEqual(result.status, expectedStatus, result.stdout + result.stderr);
  assert(!/runtime_layout_incompatible|Runtime layout is incompatible/.test(result.stdout + result.stderr));
  assert.deepStrictEqual(snapshotOutside(target), before, 'CLI changed data outside the selected healthy target');
  return result;
}
function targetSelectionCases() {
  const cases = [
    ['bare plan', ['plan'], 0], ['bare decision', ['decision'], 1],
    ['ci init', ['ci', 'init'], 0], ['bare memory', ['memory'], 1], ['bare ui', ['ui'], 1],
  ];
  for (const [name, args, status] of cases) {
    const target = path.join(blocked, `nested-${args[0]}`);
    write(path.join(target, '.leerness/HARNESS_VERSION'), pkg.version);
    write(path.join(target, '.leerness/plan.md'), '# Healthy nested plan target\n');
    test(`${name}: healthy nested --path target ignores incompatible cwd`, () => {
      const result = allowTarget([...args, '--path', target, '--json'], target, status);
      if (args[0] === 'plan') assert(JSON.parse(result.stdout).raw.includes('Healthy nested plan target'));
      if (args[0] === 'ci') assert(fs.existsSync(path.join(target, '.github/workflows/leerness-gate.yml')));
    });
    test(`${name}: incompatible --path target rejects from healthy cwd without mutation`, () => {
      deny([...args, '--path', blocked, '--json']);
    });
  }
  const ciTarget = path.join(blocked, 'nested-ci');
  test('ci init: --path overrides incompatible positional target', () => {
    allowTarget(['ci', 'init', blocked, '--path', ciTarget, '--json'], ciTarget);
  });
  test('ci init: incompatible --path overrides healthy positional target', () => {
    deny(['ci', 'init', ciTarget, '--path', blocked, '--json']);
  });
  const envTarget = path.join(blocked, 'nested-env');
  write(path.join(envTarget, '.leerness/HARNESS_VERSION'), pkg.version);
  for (const root of [envTarget, blocked]) {
    write(path.join(root, '.env'), 'RUNTIME_PROBE_FLAG=fixture\n');
    write(path.join(root, '.env.example'), '# Runtime writer fixture\n');
  }
  for (const [name, args] of [
    ['explicit --path', ['env', 'sync', '--path', envTarget]],
    ['positional before incompatible --path', ['env', 'sync', envTarget, '--path', blocked]],
  ]) test(`env sync: healthy ${name} ignores incompatible cwd`, () => {
    write(path.join(envTarget, '.env.example'), '# Runtime writer fixture\n');
    allowTarget([...args, '--json'], envTarget);
    assert(/^RUNTIME_PROBE_FLAG=$/m.test(fs.readFileSync(path.join(envTarget, '.env.example'), 'utf8')));
  });
  test('env sync: incompatible explicit --path rejects from healthy cwd without mutation', () => {
    deny(['env', 'sync', '--path', blocked, '--json']);
  });
  test('env sync: incompatible positional overrides healthy --path without mutation', () => {
    deny(['env', 'sync', blocked, '--path', envTarget, '--json']);
  });
}
function positionalTargetCases() {
  const nestedBlocked = path.join(healthy, 'nested-incompatible');
  write(path.join(nestedBlocked, '.leerness/HARNESS_VERSION'), pkg.version);
  write(path.join(nestedBlocked, '.env'), 'RUNTIME_PROBE_FLAG=fixture\n');
  write(path.join(nestedBlocked, '.env.example'), '# Runtime writer fixture\n');
  descriptor(nestedBlocked);
  for (const args of [['plan', 'list'], ['decision', 'list'], ['ci', 'init'], ['memory', 'status'], ['ui', 'consistency']]) {
    const target = path.join(blocked, `nested-${args[0]}`);
    test(`${args.join(' ')}: bare positional healthy child ignores incompatible cwd`, () => {
      allowTarget([...args, path.relative(blocked, target), '--json'], target);
    });
    test(`${args.join(' ')}: bare positional incompatible child rejects without mutation`, () => {
      deny([...args, path.relative(healthy, nestedBlocked), '--json']);
    });
  }
  test('env sync: bare incompatible child overrides --path . without mutation', () => {
    deny(['env', 'sync', path.relative(healthy, nestedBlocked), '--path', '.', '--json']);
  });
}

try {
  fs.mkdirSync(env.npm_config_cache);
  for (const root of [blocked, healthy]) {
    write(path.join(root, '.leerness/HARNESS_VERSION'), pkg.version);
    write(path.join(root, '.leerness/progress-tracker.md'), '# Progress\n\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n');
  }
  descriptor(blocked);
  write(path.join(blocked, '.leerness/cache/agent-runs/private.jsonl'), '{"task":"private-fixture-text"}\n');
  test('retained FD rejection latches its unrelated consuming operation', retainedFdCase);
  test('MCP telemetry cannot swallow a layout change during its real usage read', mcpTelemetryCase);
  gitWriterCases();
  test('real lock waiter rejects a descriptor changed before callback admission', () => lifecycle('wait'));
  test('real heartbeat worker stops touching after incompatible descriptor appears', () => lifecycle('heartbeat'));

  test('compatibility diagnosis is bounded, structured, zero-write', () => {
    const before = snapshot();
    const result = run(['state', 'compatibility', blocked, '--json']);
    const report = JSON.parse(result.stdout);
    assert.strictEqual(result.status, 1);
    assert.strictEqual(report.writeDisposition, 'blocked');
    assert.strictEqual(report.activationSupported, false);
    assert(!JSON.stringify(report).includes(directory));
    assert.deepStrictEqual(snapshot(), before);
  });
  for (const args of [
    ['state', 'start', '--goal', 'guard'], ['handoff', '--compact'], ['session', 'close'],
    ['task', 'add', 'guard', '--no-review'], ['decision', 'add', 'guard'], ['lesson', 'save', 'guard'],
    ['init', '--no-env', '--no-enforce', '--no-official-skills'], ['update', '--yes'],
    ['migrate-workspace-dir'], ['enforce', 'install'], ['enforce', 'remove'],
    ['lease', 'acquire', 'file.js', '--session', 'guard-session'], ['provider', 'add', 'guard'],
    ['roles', 'set', 'coder', '--provider', 'codex'], ['agents', 'record', 'completed', 'guard'],
    ['agent', 'guard', '--no-repl'], ['hook', 'session-start'], ['audit', '--fix'],
  ]) test(`CLI before startup/locks: ${args.slice(0, 2).join(' ')}`, () => deny([...args, '--path', blocked, '--json']));
  test('positional target is checked, unrelated cwd untouched', () => deny(['handoff', blocked, '--compact', '--json']));
  test('healthy positional target ignores incompatible cwd', () => {
    const before = snapshot(blocked);
    const result = run(['handoff', healthy, '--compact'], blocked);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.deepStrictEqual(snapshot(blocked), before);
  });
  test('healthy explicit target preserves legacy structured state writes', () => {
    const before = snapshot(blocked);
    const result = run(['state', 'start', '--path', healthy, '--goal', 'legacy preserved', '--json'], blocked);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert(fs.existsSync(path.join(healthy, '.leerness/state.json')));
    assert(!fs.existsSync(layout(healthy)));
    assert.deepStrictEqual(snapshot(blocked), before);
  });
  for (const args of [['--version'], ['--help'], ['about', '--json'], ['mcp', 'desktop', '--json']]) {
    test(`global command in incompatible cwd: ${args[0]}`, () => {
      const before = snapshot();
      const result = run(args, blocked);
      assert.strictEqual(result.status, 0, result.stdout + result.stderr);
      assert.deepStrictEqual(snapshot(), before);
    });
  }
  test('state inspect still observes metadata without enforcing writer compatibility', () => {
    const before = snapshot();
    const result = run(['state', 'inspect', blocked, '--json']);
    assert.strictEqual(result.status, 0, result.stdout + result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).schema, 'leerness.state-inspection/v1');
    assert.deepStrictEqual(snapshot(), before);
  });
  targetSelectionCases();
  positionalTargetCases();

  const io = require('../lib/io');
  const runtime = require('../lib/runtime-writes');
  const cli = require('../bin/leerness');
  const moduleCalls = [
    ['io write including corrupt JSON rescue', () => io.writeUtf8(path.join(blocked, '.leerness/corrupt.json'), '{}')],
    ['io mkdir including lock directories', () => io.mkdirpRaw(path.join(blocked, '.leerness/missing.lock'))],
    ['io append', () => io.append(path.join(blocked, '.leerness/cache/log.jsonl'), '{}\n')],
    ['io FD admission', () => io.assertWriteAllowed(path.join(blocked, '.leerness/ledger.jsonl'))],
    ['direct structured state handler', () => cli.stateCmd(blocked, 'start')],
    ['direct run logger best-effort catch', () => cli._recordRun(blocked, { task: 'private-fixture-text' })],
    ['direct shell failure best-effort catch', () => cli._recordShellFailure(blocked, { command: 'private-fixture-text' })],
    ['direct session-close module admission', () => require('../lib/session-close').sessionClose(blocked)],
    ['direct lock preflight', () => cli._withLock(path.join(blocked, '.leerness/new.json'), () => assert.fail('entered'))],
    ['direct workspace migration', () => require('../lib/workspace-dir').migrateLegacyWorkspace(blocked)],
    ['direct physical lease', () => require('../lib/file-leases').acquire(blocked, 'file.js', 'guard')],
    ['direct role writer', () => require('../lib/role-store').updateRoles(blocked, () => ({}))],
    ['direct execution ledger', () => require('../lib/role-fallback').appendExecutionEvent(blocked, {})],
    ['direct availability ledger', () => require('../lib/role-fallback').appendAvailabilityObservation(blocked, {})],
  ];
  write(path.join(blocked, '.leerness/corrupt.json'), '{');
  for (const [name, fn] of moduleCalls) test(name, () => {
    const before = snapshot();
    throwsBlocked(fn);
    assert.deepStrictEqual(snapshot(), before);
  });
  test('caught runtime error cannot become operation success', () => {
    throwsBlocked(() => runtime.withRuntimeWrites(healthy, () => {
      descriptor(healthy);
      try { io.append(path.join(healthy, '.leerness/no.jsonl'), 'not written'); } catch {}
      return 'success';
    }));
    assert(!fs.existsSync(path.join(healthy, '.leerness/no.jsonl')));
    fs.unlinkSync(layout(healthy));
  });
  test('open FD append is checked again after descriptor changes', () => {
    const file = path.join(healthy, '.leerness/cache/fd.jsonl');
    let fd;
    runtime.withRuntimeWrites(healthy, () => { fd = fs.openSync(file, 'a'); });
    const bytes = fs.readFileSync(file);
    descriptor(healthy);
    try { throwsBlocked(() => fs.writeSync(fd, 'not written')); }
    finally { fs.closeSync(fd); }
    assert(fs.readFileSync(file).equals(bytes));
    fs.unlinkSync(layout(healthy));
  });
  test('invalid flags on diagnostic remain zero-write', () => {
    const before = snapshot();
    const result = run(['state', 'compatibility', blocked, '--apply', '--json']);
    assert.strictEqual(result.status, 1);
    assert(JSON.parse(result.stdout).code);
    assert.deepStrictEqual(snapshot(), before);
  });
  test('real MCP mutating tool fails without server/target bookkeeping', () => {
    const before = snapshot();
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'leerness_state_start', arguments: { path: blocked, goal: 'guard' } } },
    ].map(value => JSON.stringify(value)).join('\n') + '\n';
    const result = run(['mcp', 'serve'], healthy, { input });
    const replies = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
    const reply = replies.find(value => value.id === 2);
    assert(reply && (reply.error || reply.result && reply.result.isError), result.stdout + result.stderr);
    assert(/incompatible|runtime_layout/.test(JSON.stringify(reply)), JSON.stringify(reply));
    assert.deepStrictEqual(snapshot(), before);
  });
} finally {
  // only this probe's canonical, newly-created temp tree is removed.
  const real = fs.realpathSync(directory);
  assert.strictEqual(real, directory);
  assert.strictEqual(path.dirname(real), tempParent);
  assert(new RegExp(`^${fixturePrefix}[A-Za-z0-9]{6}$`).test(path.basename(real)));
  fs.rmSync(real, { recursive: true, force: true });
}
console.log(`RUNTIME_WRITE_PROBE ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
