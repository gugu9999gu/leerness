'use strict';
require('./temp-cleanup').trackTemp(module);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { childDiagnostics, childExitMatches } = require('./e2e-child-diagnostics');
const { e2eCases } = require('./ci-shard');
const { withRedirectWarnings } = require('./runtime-warning-gate');
const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 1 && args[0] === '--real'),
  'Usage: node scripts/e2e-migration-handoff-probe.js [--real]');
const root = path.resolve(__dirname, '..');
const CLI = path.join(root, 'bin', 'leerness.js');
const source = fs.readFileSync(path.join(__dirname, 'e2e.js'), 'utf8').replace(/\r\n/g, '\n');
const key = 'B(1.9.41) #4';
const marker = `if (e2eShard.take('${key}')) {`;
const start = source.indexOf(marker);
assert(start >= 0 && source.indexOf(marker, start + marker.length) === -1, 'ambiguous original case');
const end = source.indexOf('\n}', start);
assert(end > start, 'original case closing boundary missing');
const block = source.slice(start, end + 2);
const parsed = e2eCases(source);
assert.deepEqual(parsed.problems, []);
assert(parsed.keys.includes(key) && !parsed.usesShared.has(key), 'case must remain independent of shared E2E fixtures');
assert.equal((block.match(/total\+\+;/g) || []).length, 1);
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const arena = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-migration-handoff-'));
const checks = [], observations = [];
function check(name, body) {
  try { body(); checks.push({ name, passed: true }); console.log('PASS ' + name); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); }
}
function snapshot(file) {
  const result = {};
  const walk = (current, relative) => {
    const st = fs.lstatSync(current, { bigint: true });
    assert(!st.isSymbolicLink(), 'unexpected link: ' + relative);
    result[relative] = [String(st.mode), String(st.ino), String(st.mtimeNs), st.isDirectory() ? 'dir' : hash(fs.readFileSync(current))];
    if (st.isDirectory()) for (const name of fs.readdirSync(current).sort()) walk(path.join(current, name), relative + '/' + name);
  };
  walk(file, '.'); return result;
}
const watched = ['bin', 'lib', 'package.json', '.leerness', 'scripts/e2e.js', 'scripts/e2e-child-diagnostics.js'];
const before = watched.map(file => snapshot(path.join(root, file)));
function execute(spawn, temp = arena) {
  const lines = [], calls = [];
  const context = {
    fs, path, os: { ...os, tmpdir: () => temp }, performance, childDiagnostics, childExitMatches, CLI,
    process: { execPath: process.execPath }, total: 0, failed: 0,
    e2eShard: { take: name => { assert.equal(name, key); return true; } },
    console: { log: (...items) => lines.push(items.join(' ')) },
    cp: { spawnSync: (executable, argv, options) => {
      assert.equal(executable, process.execPath); assert.equal(argv[0], CLI);
      calls.push({ argv: Array.from(argv), options });
      return spawn(executable, Array.from(argv), options);
    } },
  };
  vm.runInNewContext(block, context, { filename: 'original-migration-handoff-case.js', timeout: 80000 });
  assert.equal(context.total, 1);
  assert(calls.length === 1 || calls.length === 2);
  const project = calls[0].argv[2];
  assert.deepEqual(calls[0].argv, [CLI, 'migrate', project, '--yes', '--no-banner', '--no-stale-check']);
  assert.equal(calls[0].options.timeout, 60000);
  assert.equal(calls[0].options.stdio, 'ignore');
  if (calls.length === 2) {
    assert.deepEqual(calls[1].argv, [CLI, 'handoff', project, '--no-drift-check']);
    assert.equal(calls[1].options.timeout, 15000);
    assert.equal(calls[1].options.encoding, 'utf8');
  }
  return { failed: context.failed, lines, calls };
}
const notice = 'AI must re-read';
const success = { status: 0, signal: null, stdout: notice, stderr: '' };
const verdict = (migration, handoff) => {
  const result = execute((executable, argv) => argv[1] === 'migrate' ? migration : handoff);
  const setupSucceeded = migration.status === 0 && !migration.error && !migration.signal;
  assert.equal(result.calls.length, setupSucceeded ? 2 : 1, 'failed migration must leave handoff unexecuted');
  return result;
};
const timeout = cp.spawnSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { encoding: 'utf8', timeout: 300, cwd: arena });
const missing = cp.spawnSync(path.join(arena, 'missing-executable'), [], { encoding: 'utf8', cwd: arena });
const nonzero = cp.spawnSync(process.execPath, ['-e', 'process.exitCode = 7'], { encoding: 'utf8', timeout: 5000, cwd: arena });
assert.equal(timeout.error?.code, 'ETIMEDOUT'); assert.equal(missing.error?.code, 'ENOENT'); assert.equal(nonzero.status, 7);
check('original healthy migration and handoff preserve arguments, order and budgets', () => assert.equal(verdict(success, success).failed, 0));
const failures = [
  ['nonzero exit', nonzero], ['native timeout', timeout], ['native spawn error', missing],
  ['error with status zero', { status: 0, error: { code: 'ETIMEDOUT' } }],
  ['buffer error', { status: 1, error: { code: 'ENOBUFS' } }],
  ['signal with status zero', { status: 0, signal: 'SIGTERM' }],
  ['missing status', {}], ['negative status', { status: -1 }],
  ['fractional status', { status: 0.5 }], ['null status', { status: null }],
];
for (const stage of ['migrate', 'handoff']) for (const [label, receipt] of failures) {
  check(stage + ': ' + label + ' cannot pass despite a matching notice', () => {
    const bad = { ...receipt, stdout: notice, stderr: 'controlled receipt' };
    const r = stage === 'migrate' ? verdict(bad, success) : verdict(success, bad);
    assert.equal(r.failed, 1); assert(r.lines.some(line => line.startsWith('✗')));
  });
}
check('normal exits without the migration notice remain failure', () => assert.equal(verdict(success, { ...success, stdout: 'ordinary handoff' }).failed, 1));
check('missing handoff output remains failure', () => assert.equal(verdict(success, { ...success, stdout: null }).failed, 1));
check('both child failures count as one original scenario failure', () => assert.equal(verdict(timeout, missing).failed, 1));
check('failed setup is not_run and each executed failure retains bounded diagnostics', () => {
  const bad = { ...timeout, stdout: 's'.repeat(900), stderr: 'e'.repeat(900) };
  for (const stage of ['migrate', 'handoff']) {
    const r = stage === 'migrate' ? verdict(bad, success) : verdict(success, bad);
    const diagnostics = r.lines.map(line => { try { return JSON.parse(line); } catch { return null; } }).find(row => row?.migrate && row?.handoff);
    assert(diagnostics);
    const d = diagnostics[stage];
    assert.equal(d.timeoutMs, stage === 'migrate' ? 60000 : 15000); assert.equal(d.errorCode, 'ETIMEDOUT');
    assert.equal(d.stdoutBytes, 900); assert.equal(d.stdoutTail.length, 256); assert.equal(d.stderrTail.length, 256);
    assert(Number.isFinite(d.elapsedMs) && d.elapsedMs >= 0);
    if (stage === 'migrate') {
      assert.equal(diagnostics.handoff.status, 'not_run');
      assert.equal(diagnostics.handoff.reason, 'migration_failed');
      assert.equal(diagnostics.handoff.timeoutMs, 15000);
    }
  }
});
check('successful original scenario reports both elapsed times', () => {
  const r = verdict(success, success);
  assert(r.lines.some(line => /migrateElapsedMs=\d+, handoffElapsedMs=\d+/.test(line)));
});
if (args[0] === '--real') {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(?:path|pathext|systemroot|systemdrive|windir|comspec|ld_library_path|dyld_library_path)$/i.test(name)) env[name] = value;
  }
  for (const name of ['home', 'appdata', 'localappdata', 'cache', 'tmp']) fs.mkdirSync(path.join(arena, name));
  Object.assign(env, {
    HOME: path.join(arena, 'home'), USERPROFILE: path.join(arena, 'home'), APPDATA: path.join(arena, 'appdata'),
    LOCALAPPDATA: path.join(arena, 'localappdata'), XDG_CACHE_HOME: path.join(arena, 'cache'), XDG_CONFIG_HOME: path.join(arena, 'home'),
    TEMP: path.join(arena, 'tmp'), TMP: path.join(arena, 'tmp'), TMPDIR: path.join(arena, 'tmp'),
    LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_LOCK_WARN: '1',
    LEERNESS_NO_AUTO_ROADMAP: '1', NO_COLOR: '1', LANGUAGE: 'ko', LC_ALL: '', LC_CTYPE: '', LANG: '',
    GIT_CONFIG_GLOBAL: path.join(arena, 'gitconfig'), GIT_CONFIG_SYSTEM: path.join(arena, 'gitconfig-system'),
  });
  fs.writeFileSync(env.GIT_CONFIG_GLOBAL, ''); fs.writeFileSync(env.GIT_CONFIG_SYSTEM, '');
  const warningFile = path.join(arena, 'runtime-warnings.log');
  const guarded = withRedirectWarnings(env, warningFile);
  assert.deepEqual(guarded.reasons, []);
  for (let round = 1; round <= 3; round++) check('real original case ' + round + ': fresh Unicode path, 15s limit and read-only handoff', () => {
    const temp = path.join(arena, 'project 한글 é ' + round); fs.mkdirSync(temp);
    const row = { round, children: [], fixtureUnchanged: false }; observations.push(row);
    const r = execute((executable, argv, options) => {
      const prior = argv[1] === 'handoff' ? snapshot(argv[2]) : null;
      const started = performance.now();
      const result = cp.spawnSync(executable, argv, { ...options, cwd: path.join(arena, 'home'), env: guarded.env, windowsHide: true });
      row.children.push({ command: argv[1], ...childDiagnostics(result, performance.now() - started, options.timeout) });
      if (prior) { assert.deepEqual(snapshot(argv[2]), prior); row.fixtureUnchanged = true; }
      return result;
    }, temp);
    row.lines = r.lines; row.failed = r.failed;
    console.log('OBSERVATION ' + JSON.stringify(row));
    assert.equal(r.failed, 0, r.lines.join('\n'));
    assert(row.children.every(child => child.status === 0 && child.errorCode === null && child.signal === null));
  });
  check('real original children emit no DEP0190 runtime warning', () => {
    const text = fs.existsSync(warningFile) ? fs.readFileSync(warningFile, 'utf8') : '';
    assert(!/DEP0190|DeprecationWarning:[^\r\n]*shell option true/i.test(text));
  });
}
check('source runtime, checker and repository state remain unchanged', () => {
  assert.deepEqual(watched.map(file => snapshot(path.join(root, file))), before);
});
const failed = checks.filter(row => !row.passed).length;
console.log('RESULT ' + JSON.stringify({ schema: 'leerness.migration-handoff-observation/v1', node: process.version,
  platform: process.platform, sourceSha256: hash(source), caseSha256: hash(block),
  passed: checks.length - failed, total: checks.length, failed, checks, observations, arena,
  limits: ['extracted original case, not full E2E or smoke prefix', 'controls are not real-product coverage',
    'three fresh-project observations only when --real is explicit', 'not an existing-user installation or historical speedup',
    'no original-load, all-platform or release claim'] }));
console.log(`Migration handoff: ${checks.length - failed}/${checks.length} passed; full E2E not run; fixtures retained: ${arena}`);
process.exitCode = failed ? 1 : 0;
