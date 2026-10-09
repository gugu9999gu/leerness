'use strict';

// The state-lock heartbeat worker re-checks the admission of the operation that holds the lock.
// It used to make a new admission on every touch, which ran `git rev-parse` with the project as its
// working directory: once per lock and once per second while a lock was held (measured on Windows:
// a project directory could not be deleted for a few hundred ms after the locked call returned).
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const CLI = path.resolve(__dirname, '../bin/leerness.js');

if (process.argv[2] === '--child') { child().catch(error => { console.log(JSON.stringify({ error: String(error && error.stack) })); process.exitCode = 1; }); return; }

const pkg = require('../package.json');
const tempParent = fs.realpathSync(os.tmpdir());
const directory = fs.mkdtempSync(path.join(tempParent, 'leerness-heartbeat-'));
const env = { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_BANNER: '1' };
for (const name of Object.keys(env)) if (/^LEERNESS_(INTERNAL|WORKSPACE_DIR|NO_AUTO_WORKSPACE_MIGRATION|SESSION_ID|MCP_)/i.test(name) || /^GIT_/i.test(name)) delete env[name];
Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(directory, 'missing-gitconfig'),
  LOCALAPPDATA: path.join(directory, 'local-data'), XDG_STATE_HOME: path.join(directory, 'local-data') });
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
}
function git(root, args) {
  const result = cp.spawnSync('git', ['-C', root, ...args], { env, encoding: 'utf8', windowsHide: true });
  assert.strictEqual(result.status, 0, result.stderr);
}
function project(name, withGit) {
  const root = path.join(directory, name);
  fs.mkdirSync(path.join(root, '.leerness'), { recursive: true });
  if (withGit) git(root, ['init', '-q']);
  fs.writeFileSync(path.join(root, '.leerness/HARNESS_VERSION'), pkg.version);
  fs.writeFileSync(path.join(root, '.leerness/progress-tracker.md'), '# Progress\n\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n');
  return root;
}
// Each lock lifecycle runs in its own process: GIT_TRACE must be set before the heartbeat worker starts.
function lifecycle(mode, root) {
  const trace = path.join(directory, `trace-${mode}-${path.basename(root)}.log`);
  const result = cp.spawnSync(process.execPath, [__filename, '--child', mode, root, trace],
    { env: { ...env, GIT_TRACE: trace }, encoding: 'utf8', timeout: 60000, windowsHide: true });
  const line = String(result.stdout || '').trim().split('\n').pop();
  let report;
  try { report = JSON.parse(line); } catch { throw new Error(`no report (exit ${result.status}): ${result.stdout}${result.stderr}`); }
  assert.ok(!report.error, report.error);
  return report;
}

async function child() {
  const [mode, root, trace] = process.argv.slice(3);
  const { _withLock } = require(CLI);
  const target = path.join(root, '.leerness/locked.json');
  const count = () => { try { return (fs.readFileSync(trace, 'utf8').match(/built-in: git rev-parse/g) || []).length; } catch { return 0; } };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const mtime = file => fs.statSync(file, { bigint: true }).mtimeNs;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const report = {};
  const held = _withLock(target, () => gate);
  const ownerPath = path.join(target + '.lock', fs.readdirSync(target + '.lock')[0]);
  const created = mtime(ownerPath);
  const atAcquire = count();   // the holding operation's own admission is already counted
  const until = async (predicate, timeout) => { const end = Date.now() + timeout; while (!predicate() && Date.now() < end) await pause(20); return predicate(); };
  report.heartbeatHealthy = await until(() => mtime(ownerPath) !== created, 5000);
  if (mode === 'hold') {
    await pause(2500);   // more than two 1000 ms heartbeat ticks
    report.gitCallsWhileHeld = count() - atAcquire;
    report.heartbeatAdvanced = mtime(ownerPath) !== created;
  } else if (mode === 'topology') {
    // A repository created around the running operation invalidates that operation's admission;
    // the heartbeat follows the same admission and must stop touching.
    const init = cp.spawnSync('git', ['-C', root, 'init', '-q'], { env: { ...process.env, GIT_TRACE: '' }, windowsHide: true });
    report.gitInit = init.status;
    await pause(300);
    const before = mtime(ownerPath);
    await pause(2300);
    report.touchedAfterTopologyChange = mtime(ownerPath) !== before;
  }
  release();
  try { await held; } catch (error) { report.releaseCode = error && error.code; }
  console.log(JSON.stringify(report));
}

(async () => {
  try {
    const plain = project('plain', false);
    const repo = project('repo', true);
    await test('snapshot admission survives the structured clone into the worker and malformed input blocks', () => {
      const RL = require('../lib/runtime-layout');
      for (const root of [plain, repo]) {
        const reader = RL.createRuntimeCompatibilityReader(root);
        assert.ok(reader.snapshot, 'admission reader exposes its snapshot');
        const original = reader();
        assert.strictEqual(original.writeDisposition, 'allowed', JSON.stringify(original));
        assert.deepStrictEqual(RL.createRuntimeSnapshotReader(structuredClone(reader.snapshot))(), original);
      }
      for (const bad of [null, undefined, {}, { root: 1 }, 'x']) {
        assert.strictEqual(RL.createRuntimeSnapshotReader(bad)().writeDisposition, 'blocked');
      }
    });
    for (const [label, root] of [['plain project', plain], ['git worktree project', repo]]) {
      await test(`held lock: heartbeat touches the owner and starts no git process (${label})`, () => {
        const report = lifecycle('hold', root);
        assert.strictEqual(report.heartbeatHealthy, true, 'heartbeat never touched the owner file');
        assert.strictEqual(report.heartbeatAdvanced, true);
        assert.strictEqual(report.gitCallsWhileHeld, 0, `heartbeat ran git ${report.gitCallsWhileHeld} times`);
      });
    }
    await test('a repository created under a held lock stops the heartbeat with the holding admission', () => {
      const root = project('grows-repo', false);
      const report = lifecycle('topology', root);
      assert.strictEqual(report.heartbeatHealthy, true, 'heartbeat never touched the owner file');
      assert.strictEqual(report.gitInit, 0);
      assert.strictEqual(report.touchedAfterTopologyChange, false, 'heartbeat kept touching after the topology changed');
    });
  } finally {
    const deadline = Date.now() + 5000;
    for (;;) {
      try { fs.rmSync(directory, { recursive: true, force: true }); break; }
      catch (error) {
        if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code) || Date.now() > deadline) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      }
    }
  }
  console.log(`lock heartbeat: ${passed}/${passed + failed} passed`);
  if (failed) process.exitCode = 1;
})();
