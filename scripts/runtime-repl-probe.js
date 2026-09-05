'use strict';

// Real readline events and product REPL implementation; provider replies and
// incidental startup context/catalog are local stubs. No provider is launched.
const assert = require('assert');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const PREFIX = 'leerness-runtime-repl-';
const tempParent = fs.realpathSync(os.tmpdir());
const REPLY = 'LOCAL_REPL_FIXTURE_REPLY';
const MESSAGE = 'local fixture conversation';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const descriptorPath = root => path.join(root, '.leerness/cache/state-layout.json');
const signature = file => ({
  mtime: fs.statSync(file, { bigint: true }).mtimeNs.toString(),
  hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
});

function snapshot(root) {
  const rows = {};
  const visit = file => {
    const stat = fs.lstatSync(file, { bigint: true });
    const key = path.relative(root, file) || '.';
    rows[key] = [stat.mode.toString(), stat.size.toString(), stat.mtimeNs.toString()];
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name));
    else if (stat.isFile()) rows[key].push(signature(file).hash);
    else assert.fail('unexpected fixture link or special file');
  };
  visit(root);
  return rows;
}
function assertArena(arena) {
  assert.strictEqual(fs.realpathSync(arena), arena);
  assert.strictEqual(path.dirname(arena), tempParent);
  assert(new RegExp(`^${PREFIX}[A-Za-z0-9]{6}$`).test(path.basename(arena)));
}
function makeFixture(arena, label) {
  const root = path.join(arena, label);
  fs.mkdirSync(path.join(root, '.leerness/cache'), { recursive: true });
  fs.writeFileSync(path.join(root, '.leerness/HARNESS_VERSION'), require('../package.json').version);
  return root;
}
function makeIncompatible(root) {
  fs.writeFileSync(descriptorPath(root), JSON.stringify({
    schema: 'leerness.runtime-layout/v1', schemaVersion: 1, scope: 'project-local',
    generation: 1, layout: 'legacy', requiredWriterProtocol: 2,
  }));
}

function compileRepl(root, observations) {
  const runtime = require('../lib/runtime-writes');
  const compiled = new Module(CLI, module);
  compiled.filename = CLI;
  compiled.paths = Module._nodeModulePaths(path.dirname(CLI));
  const requireProduct = compiled.require.bind(compiled);
  compiled.require = name => {
    if (name === 'leerness-skillpack/catalog.json') return { name: 'fixture', version: '0', skills: [] };
    if (name !== '../lib/runtime-writes') return requireProduct(name);
    return { ...runtime, withRuntimeWrites: (target, fn, options) => {
      observations.admissions.push({ fresh: options?.fresh === true, ownRoot: target === root });
      return runtime.withRuntimeWrites(target, fn, options);
    } };
  };
  // Append only test access and provider dependency injection. The REPL body,
  // readline, session writer, and admission implementation remain unchanged.
  compiled._compile(fs.readFileSync(CLI, 'utf8') + `
    module.exports.__replProbe = {
      run: _agentRepl,
      provider: fn => { _cliChat = fn; _cliChatStream = fn; _ollamaChat = fn; }
    };`, CLI);
  compiled.exports.__replProbe.provider(async () => {
    observations.providerStubs++;
    return { ok: true, response: REPLY };
  });
  return compiled.exports.__replProbe.run;
}
async function childMain(root) {
  assertArena(path.dirname(root));
  assert.strictEqual(fs.realpathSync(root), root);
  assert(/^(healthy|blocked-save|blocked-close|blocked-unsaved-save)$/.test(path.basename(root)));
  const environmentBefore = { ...process.env };
  const observations = { admissions: [], providerStubs: 0, startupContextStubs: 0, gitQueries: 0, forbiddenProcesses: 0 };
  const spawnSync = cp.spawnSync;
  const topologyArgs = ['--no-optional-locks', '-C', root, 'rev-parse', '--path-format=absolute',
    '--is-bare-repository', '--is-inside-git-dir', '--show-toplevel', '--git-dir', '--git-common-dir'];
  const rejectProcess = () => { observations.forbiddenProcesses++; throw new Error('external process disabled in REPL probe'); };
  for (const method of ['spawn', 'exec', 'execFile', 'execSync', 'execFileSync']) cp[method] = rejectProcess;
  cp.spawnSync = (command, args, options) => {
    if (command === process.execPath && args[0] === CLI && args[1] === 'handoff') {
      observations.startupContextStubs++;
      return { status: 0, stdout: '', stderr: '' };
    }
    const executable = path.basename(command).toLowerCase();
    if (['git', 'git.exe'].includes(executable) && JSON.stringify(args) === JSON.stringify(topologyArgs)) {
      observations.gitQueries++;
      return spawnSync(command, args, options);
    }
    const where = path.join(process.env.SystemRoot || process.env.WINDIR || '', 'System32/where.exe');
    if (process.platform === 'win32' && command.toLowerCase() === where.toLowerCase()
      && args.length === 1 && args[0] === 'git') return spawnSync(command, args, options);
    return rejectProcess();
  };
  const repl = compileRepl(root, observations);
  const runtime = require('../lib/runtime-writes');
  // Match the long-lived outer operation used by the real CLI entry point.
  const session = runtime.withRuntimeWrites(root, () => repl(root, {
    provider: 'codex', model: 'fixture-model', stream: false, autoFallback: false,
  }));
  process.send({ phase: 'ready' });
  await session;
  const environmentUnchanged = Object.keys(process.env).length === Object.keys(environmentBefore).length
    && Object.entries(environmentBefore).every(([key, value]) => process.env[key] === value);
  assert(environmentUnchanged, 'REPL changed the inherited environment'); // Never print credential values on failure.
  process.send({ phase: 'done', exitCode: process.exitCode || 0, observations });
  process.stdin.destroy(); // The direct export has no CLI main() exit wrapper.
  process.disconnect();
}

function launch(root) {
  const child = cp.spawn(process.execPath, [__filename, '--child', root], {
    cwd: root, stdio: ['pipe', 'pipe', 'pipe', 'ipc'], windowsHide: true,
  });
  const state = { child, stdout: '', stderr: '', messages: [], exited: false, code: null, error: null };
  child.stdout.on('data', data => { state.stdout += data; });
  child.stderr.on('data', data => { state.stderr += data; });
  child.stdin.on('error', error => { state.error = error; });
  child.on('message', message => state.messages.push(message));
  child.on('error', error => { state.error = error; });
  child.on('exit', code => { state.exited = true; state.code = code; });
  return state;
}
async function until(state, predicate, label, timeout = 7000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    assert(!state.error, String(state.error));
    assert(!state.exited, `REPL exited before ${label}: ${state.stderr || state.stdout.slice(-1800)}`);
    assert(Date.now() < end, `timed out at ${label}: ${state.stderr || state.stdout.slice(-1800)}`);
    await delay(20);
  }
}
const prompts = state => (state.stdout.match(/agent> /g) || []).length;
async function sendLine(state, line) {
  const before = prompts(state);
  state.child.stdin.write(line + '\n');
  await until(state, () => prompts(state) > before, line);
}
function sessionFile(root) {
  const directory = path.join(root, '.leerness/cache/agent-sessions');
  const names = fs.readdirSync(directory);
  assert.strictEqual(names.length, 1, 'expected one actual session file');
  assert(/^sess-.+\.jsonl$/.test(names[0]));
  return path.join(directory, names[0]);
}
function assertConversation(file) {
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepStrictEqual(rows.map(({ role, content }) => ({ role, content })), [
    { role: 'user', content: MESSAGE }, { role: 'assistant', content: REPLY },
  ]);
  assert(rows.every(row => typeof row.at === 'string' && !Number.isNaN(Date.parse(row.at))));
}
async function stop(state) {
  if (state.exited) return;
  state.child.kill();
  await until(state, () => state.exited, 'owned child termination', 3000);
}

async function scenario(arena, label) {
  const root = makeFixture(arena, label);
  const state = launch(root);
  try {
    await until(state, () => state.messages.some(message => message.phase === 'ready'), 'readline ready');
    await sendLine(state, MESSAGE);
    assert(state.stdout.includes(REPLY), 'local provider stub did not reply');
    const saved = label !== 'blocked-unsaved-save';
    if (saved) { await sendLine(state, '/save'); assertConversation(sessionFile(root)); }
    const outputStart = state.stdout.length;
    if (label === 'healthy') {
      const file = sessionFile(root);
      const before = signature(file);
      await delay(30);
      state.child.stdin.end(); // The actual readline close event must persist.
      await until(state, () => state.exited, 'healthy EOF close');
      assert.strictEqual(state.code, 0, state.stderr);
      assertConversation(file);
      assert.notDeepStrictEqual(signature(file), before, 'healthy close did not write the session');
    } else {
      makeIncompatible(root); // Different process from the real REPL writer.
      const before = snapshot(root);
      if (label === 'blocked-close') state.child.stdin.end();
      else state.child.stdin.write('/save\n');
      await until(state, () => state.exited, 'incompatible event rejection');
      assert.strictEqual(state.code, 1, state.stderr || state.stdout.slice(outputStart));
      assert(/Runtime layout (blocks writes|is incompatible)/.test(state.stdout.slice(outputStart) + state.stderr));
      assert(!/→.*agent-sessions|세션 저장:/.test(state.stdout.slice(outputStart)), 'rejected event claimed a save');
      assert.deepStrictEqual(snapshot(root), before, 'incompatible event changed fixture bytes or mtimes');
      if (!saved) assert(!fs.existsSync(path.join(root, '.leerness/cache/agent-sessions')));
    }
    const report = state.messages.find(message => message.phase === 'done');
    assert(report, state.stderr || 'missing completed lifecycle report');
    assert.strictEqual(report.exitCode, state.code);
    assert.strictEqual(report.observations.providerStubs, 1);
    assert.strictEqual(report.observations.startupContextStubs, 1);
    assert.strictEqual(report.observations.forbiddenProcesses, 0);
    assert(report.observations.gitQueries > 0, 'real compatibility discovery did not run');
    const expectedAdmissions = label === 'blocked-save' ? 4 : 3;
    assert.strictEqual(report.observations.admissions.length, expectedAdmissions);
    assert(report.observations.admissions.every(entry => entry.fresh && entry.ownRoot), 'each actual line/close event needs fresh admission');
  } finally { await stop(state); }
}
async function main() {
  const arena = fs.mkdtempSync(path.join(tempParent, PREFIX));
  const sources = [CLI, path.resolve(__dirname, '../lib/runtime-writes.js'), __filename];
  const before = sources.map(signature);
  let passed = 0;
  let failed = 0;
  try {
    for (const label of ['healthy', 'blocked-save', 'blocked-close', 'blocked-unsaved-save']) {
      try { await scenario(arena, label); passed++; console.log(`PASS REPL ${label}`); }
      catch (error) { failed++; console.error(`FAIL REPL ${label}: ${error.stack}`); }
    }
    assert.deepStrictEqual(sources.map(signature), before, 'source bytes or mtimes changed during probe');
  } finally {
    assertArena(arena);
    fs.rmSync(arena, { recursive: true, force: true });
  }
  console.log(`RUNTIME_REPL_PROBE ${passed}/${passed + failed} passed; skipped 0`);
  if (failed) process.exitCode = 1;
}

const task = process.argv[2] === '--child' ? childMain(process.argv[3]) : main();
task.catch(error => {
  console.error(error.stack);
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
