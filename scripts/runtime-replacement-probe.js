'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

// Final Windows mutation boundary: prepared files are allowed before the
// descriptor changes, but the replacement attempt and retry must then stop.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const runtime = require('../lib/runtime-writes');
const io = require('../lib/io');
const original = { read: fs.readFileSync, spawn: cp.spawnSync };
const sources = [require.resolve('../lib/io'), __filename];
const signature = file => ({
  sha256: crypto.createHash('sha256').update(original.read(file)).digest('hex'),
  mtime: fs.statSync(file, { bigint: true }).mtimeNs.toString(),
});
const sourceBefore = sources.map(signature);
const parent = fs.realpathSync(os.tmpdir());
const arena = fs.mkdtempSync(path.join(parent, 'leerness-runtime-replace-'));
let passed = 0, failed = 0;
function fixture(name) {
  const root = path.join(arena, name);
  fs.mkdirSync(path.join(root, '.leerness/cache'), { recursive: true });
  fs.writeFileSync(path.join(root, '.leerness/HARNESS_VERSION'), 'fixture\n');
  fs.writeFileSync(path.join(root, 'target.txt'), 'original');
  return root;
}
function changeLayout(root) {
  // Use an actual other process: Node 18's captured writeFileSync still calls
  // the parent's guarded public writeSync after creating an empty descriptor.
  const descriptor = JSON.stringify({
    schema: 'leerness.runtime-layout/v1', schemaVersion: 1, scope: 'project-local',
    generation: 1, layout: 'legacy', requiredWriterProtocol: 2,
  });
  const result = original.spawn(process.execPath, ['-e',
    'require("fs").writeFileSync(process.argv[1], process.argv[2]);',
    path.join(root, '.leerness/cache/state-layout.json'), descriptor], {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 5000,
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  assert(!result.error && result.status === 0, 'independent descriptor writer must finish: '
    + String(result.error?.code || result.stderr || result.status).slice(0, 1000));
}
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); }
  finally { fs.readFileSync = original.read; cp.spawnSync = original.spawn; }
}
try {
  if (process.platform === 'win32') {
    for (const phase of ['prepared', 'retry']) test('replacement rejects incompatible layout at ' + phase, () => {
      const root = fixture(phase);
      const target = path.join(root, 'target.txt');
      const before = fs.statSync(target, { bigint: true });
      let targetReads = 0, attempts = 0, changed = false;
      fs.readFileSync = function (file, ...args) {
        const result = original.read.call(this, file, ...args);
        if (phase === 'prepared' && file === target && ++targetReads === 2) {
          changeLayout(root); changed = true;
        }
        return result;
      };
      cp.spawnSync = function (command, args, options) {
        if (!options?.env?.LEERNESS_REPLACE_FROM) return original.spawn.call(this, command, args, options);
        attempts++;
        if (phase === 'retry' && attempts === 1) {
          changeLayout(root); changed = true;
          return { status: 1, stderr: 'LEERNESS_REPLACE_ERROR:32:controlled sharing violation' };
        }
        return { status: 1, stderr: 'LEERNESS_REPLACE_ERROR:5:unexpected replacement attempt' };
      };
      assert.throws(() => runtime.withRuntimeWrites(root, () =>
        io.writeBufferIfUnchanged(target, Buffer.from('original'), Buffer.from('planned'))),
      error => error.code === 'E_RUNTIME_LAYOUT_INCOMPATIBLE' && error.reasonCode === 'layout_unsupported');
      assert(changed, 'interleaving must run');
      assert.strictEqual(attempts, phase === 'retry' ? 1 : 0);
      assert.strictEqual(original.read(target, 'utf8'), 'original');
      assert.strictEqual(fs.statSync(target, { bigint: true }).mtimeNs, before.mtimeNs);
    });
    test('real compatible Windows replacement retains original recovery bytes', () => {
      const root = fixture('control'), target = path.join(root, 'target.txt');
      const result = runtime.withRuntimeWrites(root, () =>
        io.writeBufferIfUnchanged(target, Buffer.from('original'), Buffer.from('planned')));
      assert.strictEqual(fs.readFileSync(target, 'utf8'), 'planned');
      assert.strictEqual(fs.readFileSync(result.backupFile, 'utf8'), 'original');
    });
    // T-0343: a cmdlet in this command cost 21.5-52 s per launch on a GitHub Windows runner when the environment had no
    // PSModulePath (Windows PowerShell analyzed every module on the machine path to find New-Object). This machine
    // does not show that cost, so the command is checked for command invocations and run once without those variables.
    // PowerShell's own parser counts CommandAst nodes: cmdlets, aliases (echo, %), functions and programs, and not
    // text inside string literals. The parse itself is a .NET call and invokes no command.
    const commandInvocations = text => {
      const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const parse = "$e = $null; $a = [System.Management.Automation.Language.Parser]::ParseInput($env:T0343_COMMAND, [ref]$null, [ref]$e); "
        + "[Console]::Out.Write(('{0}|{1}' -f @($a.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)).Count, @($e).Count))";
      const r = original.spawn.call(cp, ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', parse],
        { encoding: 'utf8', windowsHide: true, timeout: 60000, env: { ...process.env, T0343_COMMAND: text } });
      assert.strictEqual(r.status, 0, 'PowerShell parse failed: ' + (r.error ? r.error.code : r.stderr));
      return r.stdout.trim();
    };
    test('the command-invocation check sees cmdlets and aliases but not string text', () => {
      assert.deepStrictEqual(['New-Object System.Text.UTF8Encoding($false); exit 0', 'echo warmup; exit 0', '1 | % { $_ }; exit 0',
        "[Console]::Out.Write('New-Object'); exit 0"].map(commandInvocations), ['1|0', '1|0', '1|0', '0|0']);
    });
    test('actual Windows replacement runs no cmdlet and works without PSModulePath', () => {
      const root = fixture('no-module-path'), target = path.join(root, 'target.txt');
      const commands = []; let env = null;
      cp.spawnSync = function (command, args, options) {
        if (options?.env?.LEERNESS_REPLACE_TO !== target) return original.spawn.call(this, command, args, options);
        commands.push(args[args.indexOf('-Command') + 1]);
        env = { ...options.env };
        for (const key of Object.keys(env)) if (/^PSModule(Path|AnalysisCachePath)$/i.test(key)) delete env[key];
        return original.spawn.call(this, command, args, { ...options, env });
      };
      const result = runtime.withRuntimeWrites(root, () =>
        io.writeBufferIfUnchanged(target, Buffer.from('original'), Buffer.from('planned')));
      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commandInvocations(commands[0]), '0|0', 'command invocations or parse errors in the replacement command');
      assert(!Object.keys(env).some(key => /^PSModulePath$/i.test(key)), 'the child must have run without PSModulePath');
      assert.strictEqual(original.read(target, 'utf8'), 'planned');
      assert.strictEqual(original.read(result.backupFile, 'utf8'), 'original');
    });
    test('actual Windows replacement tolerates a controlled 16-second launch delay', () => {
      const root = fixture('delayed-control'), target = path.join(root, 'target.txt');
      let attempts = 0, observation;
      cp.spawnSync = function (command, args, options) {
        if (options?.env?.LEERNESS_REPLACE_TO !== target) return original.spawn.call(this, command, args, options);
        attempts++;
        const delayed = args.slice();
        const index = delayed.indexOf('-Command');
        assert(index >= 0 && typeof delayed[index + 1] === 'string');
        // Delay only this fixture's actual child, then execute the exact
        // product command. This models delay, not the unobserved CI phase.
        delayed[index + 1] = 'Start-Sleep -Milliseconds 16000; ' + delayed[index + 1];
        const started = process.hrtime.bigint();
        const result = original.spawn.call(this, command, delayed, options);
        observation = { timeoutMs: options.timeout, elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
          code: result.error?.code || null, status: result.status };
        return result;
      };
      let result, failure;
      try {
        result = runtime.withRuntimeWrites(root, () =>
          io.writeBufferIfUnchanged(target, Buffer.from('original'), Buffer.from('planned')));
      } catch (error) { failure = error; }
      assert.strictEqual(attempts, 1);
      console.log('delayed replacement observation: ' + JSON.stringify(observation));
      if (failure) {
        assert.strictEqual(original.read(target, 'utf8'), 'original');
        throw new Error('delayed actual replacement failed: ' + failure.code);
      }
      assert(observation.elapsedMs >= 16000, 'the real delay must have run');
      assert.strictEqual(original.read(target, 'utf8'), 'planned');
      assert.strictEqual(original.read(result.backupFile, 'utf8'), 'original');
    });
    for (const phase of ['before', 'partial-progress', 'committed']) test('replacement timeout is not retried at ' + phase, () => {
      const root = fixture('timeout-' + phase), target = path.join(root, 'target.txt');
      const before = fs.statSync(target, { bigint: true });
      let attempts = 0, paths;
      cp.spawnSync = function (command, args, options) {
        if (options?.env?.LEERNESS_REPLACE_TO !== target) return original.spawn.call(this, command, args, options);
        attempts++;
        paths = { source: options.env.LEERNESS_REPLACE_FROM, backup: options.env.LEERNESS_REPLACE_BACKUP };
        if (phase === 'partial-progress') {
          // Model an interrupted ReplaceFile step: the original has moved,
          // while the planned source has not yet become the live target.
          fs.renameSync(target, paths.backup);
        } else if (phase === 'committed') {
          const result = original.spawn.call(this, command, args, options);
          assert(!result.error && result.status === 0, 'the real replacement must complete before the reported timeout');
        }
        // Timeout does not prove whether replacement ran. In the committed
        // case this transport result deliberately withholds a real success.
        return { status: null, signal: 'SIGTERM', stdout: '', stderr: '',
          error: Object.assign(new Error('controlled replacement timeout'), { code: 'ETIMEDOUT' }) };
      };
      let failure;
      try {
        runtime.withRuntimeWrites(root, () =>
          io.writeBufferIfUnchanged(target, Buffer.from('original'), Buffer.from('planned')));
      } catch (error) { failure = error; }
      assert(failure, 'an uncertain timeout must not become a successful result');
      assert.strictEqual(failure.code, 'ETIMEDOUT');
      assert.strictEqual(failure.attempts, 1);
      assert.strictEqual(attempts, 1, 'a timeout must not launch a second replacement');
      const artifacts = new Map(failure.recoveryArtifacts.map(item => [item.role, item]));
      const retainedOriginal = phase === 'before' ? target : paths.backup;
      assert.strictEqual(original.read(retainedOriginal, 'utf8'), 'original');
      const retained = fs.statSync(retainedOriginal, { bigint: true });
      assert.strictEqual(retained.dev, before.dev);
      assert.strictEqual(retained.ino, before.ino);
      assert.strictEqual(retained.mtimeNs, before.mtimeNs);
      assert.strictEqual(retained.nlink, 1n);
      assert.strictEqual(artifacts.get(phase === 'before' ? 'live-target' : 'displaced-original').content, 'expected-original');
      if (phase === 'before') assert.strictEqual(fs.existsSync(paths.backup), false);
      if (phase === 'partial-progress') assert.strictEqual(fs.existsSync(target), false);
      if (phase === 'committed') {
        assert.strictEqual(fs.existsSync(paths.source), false);
        assert.strictEqual(original.read(target, 'utf8'), 'planned');
        assert.strictEqual(artifacts.get('live-target').content, 'planned-replacement');
      } else {
        assert.strictEqual(original.read(paths.source, 'utf8'), 'planned');
        assert.strictEqual(artifacts.get('planned-source').content, 'planned-replacement');
      }
    });
  } else {
    test('non-Windows replacement remains explicitly unsupported', () => {
      const root = fixture('unsupported'), target = path.join(root, 'target.txt');
      assert.throws(() => runtime.withRuntimeWrites(root, () =>
        io.writeBufferIfUnchanged(target, Buffer.from('original'), Buffer.from('planned'))),
      error => error.code === 'E_METADATA_PRESERVATION_UNAVAILABLE');
      assert.strictEqual(fs.readFileSync(target, 'utf8'), 'original');
    });
  }
} finally {
  fs.readFileSync = original.read; cp.spawnSync = original.spawn;
  assert.deepStrictEqual(sources.map(signature), sourceBefore, 'probe changed product or probe source bytes/mtime');
  assert.strictEqual(fs.realpathSync(arena), arena);
  assert.strictEqual(path.dirname(arena), parent);
  assert(path.basename(arena).startsWith('leerness-runtime-replace-'));
  fs.rmSync(arena, { recursive: true, force: true });
}
console.log('runtime replacement probe: ' + passed + '/' + (passed + failed) + ' PASS');
process.exitCode = failed ? 1 : 0;
