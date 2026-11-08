'use strict';
require('./temp-cleanup').trackTemp(module);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { childDiagnostics, childExitMatches } = require('./e2e-child-diagnostics');
const { e2eCases } = require('./ci-shard');
const { withRedirectWarnings } = require('./runtime-warning-gate');
const { spawnNpmSync } = require('../lib/npm-process');
const { spawnPortableSync } = require('../lib/portable-process');
const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'leerness.js');
const VERSION = require('../package.json').version;
const arena = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-installed-handoff-'));
const out = process.env.LEERNESS_ACCEPTANCE_OUT ? path.resolve(process.env.LEERNESS_ACCEPTANCE_OUT) : path.join(arena, 'results');
fs.mkdirSync(out, { recursive: true });
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const report = { schema: 'leerness.installed-handoff-acceptance/v1', version: VERSION, node: process.version,
  platform: process.platform, release: os.release(), checks: [], commands: [], timings: [], passed: false,
  limits: ['isolated local package install, not an existing user installation', 'same-source parity, not a historical speedup comparison',
    'three fresh-project observations per variant, not a population latency estimate', 'no full npm/E2E, public release or independent review',
    'default and recent-migration handoff; explicit environment refresh and saturated-host behavior not measured',
    'four original B(1.9.41) blocks per source/install variant, not the complete E2E fixture or historical runner load'] };
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (/^(?:path|pathext|systemroot|systemdrive|windir|comspec|ld_library_path|dyld_library_path)$/i.test(key)) env[key] = value;
}
for (const name of ['home', 'appdata', 'localappdata', 'cache', 'tmp', 'pack', 'install']) fs.mkdirSync(path.join(arena, name));
Object.assign(env, { HOME: path.join(arena, 'home'), USERPROFILE: path.join(arena, 'home'),
  APPDATA: path.join(arena, 'appdata'), LOCALAPPDATA: path.join(arena, 'localappdata'),
  XDG_CACHE_HOME: path.join(arena, 'cache'), XDG_CONFIG_HOME: path.join(arena, 'home'),
  TEMP: path.join(arena, 'tmp'), TMP: path.join(arena, 'tmp'), TMPDIR: path.join(arena, 'tmp'),
  LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_LOCK_WARN: '1',
  LEERNESS_NO_AUTO_ROADMAP: '1', NO_COLOR: '1', LANGUAGE: 'ko', LC_ALL: '', LC_CTYPE: '', LANG: '',
  GIT_CONFIG_GLOBAL: path.join(arena, 'global.gitconfig'), GIT_CONFIG_SYSTEM: path.join(arena, 'system.gitconfig'),
  npm_config_userconfig: path.join(arena, 'user.npmrc'), npm_config_globalconfig: path.join(arena, 'global.npmrc'),
  npm_config_cache: path.join(arena, 'cache'), npm_config_offline: 'true', npm_config_ignore_scripts: 'true',
  npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' });
for (const key of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'npm_config_userconfig', 'npm_config_globalconfig']) fs.writeFileSync(env[key], '');
let sequence = 0;
function run(label, args, { entry = CLI, cwd = arena, input, npm = false, shim = false, timeout = 90000, env: runEnv = env } = {}) {
  const options = { cwd, env: runEnv, input, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true };
  const start = process.hrtime.bigint();
  const result = npm ? spawnNpmSync(args, options) : shim ? spawnPortableSync(entry, args, options)
    : cp.spawnSync(process.execPath, [entry, ...args], options);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const log = String(++sequence).padStart(2, '0') + '-' + label.replace(/[^a-z0-9-]/gi, '-') + '.log';
  const bytes = Buffer.from(JSON.stringify({ args, status: result.status, signal: result.signal,
    error: result.error?.code || null, stdout: result.stdout || '', stderr: result.stderr || '' }, null, 2) + '\n');
  fs.writeFileSync(path.join(out, log), bytes);
  report.commands.push({ label, status: result.status, signal: result.signal, error: result.error?.code || null,
    milliseconds: Math.round(ms * 1000) / 1000, log, sha256: hash(bytes) }); save();
  assert.equal(result.error, undefined, `${label}: ${result.error?.message}`);
  assert.equal(result.signal, null, label);
  assert.equal(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
  return { ...result, milliseconds: ms };
}
function check(label, fn) {
  try { const value = fn(); report.checks.push({ label, passed: true }); save(); console.log('PASS ' + label); return value; }
  catch (error) { report.checks.push({ label, passed: false, error: error.message }); save(); throw error; }
}
function snapshot(root) {
  const result = {};
  const walk = file => {
    const stat = fs.lstatSync(file, { bigint: true }), relative = path.relative(root, file).split(path.sep).join('/');
    assert(!stat.isSymbolicLink(), `unexpected link in fixture: ${relative}`);
    result[relative] = [stat.isDirectory() ? 'dir' : hash(fs.readFileSync(file)), String(stat.mtimeNs)];
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) walk(path.join(file, name));
  };
  walk(root); return result;
}
function runtimeHashes(root) {
  const result = {};
  const walk = relative => {
    const file = path.join(root, relative), stat = fs.lstatSync(file);
    assert(!stat.isSymbolicLink(), `unexpected runtime link: ${relative}`);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) walk(path.join(relative, name));
    else result[relative.split(path.sep).join('/')] = hash(fs.readFileSync(file));
  };
  for (const relative of ['bin', 'lib', 'package.json']) walk(relative);
  return result;
}
const normalize = (text, project) => text.split(project).join('<PROJECT>').split(project.split(path.sep).join('/')).join('<PROJECT>');

function originalMigrationCases(entry, variant) {
  const sourceFile = path.join(ROOT, 'scripts', 'e2e.js');
  const bytes = fs.readFileSync(sourceFile), source = bytes.toString('utf8').replace(/\r\n/g, '\n');
  const plan = e2eCases(source);
  assert.deepEqual(plan.problems, []);
  const keys = ['B(1.9.41)', 'B(1.9.41) #2', 'B(1.9.41) #3', 'B(1.9.41) #4'];
  assert.deepEqual(plan.keys.filter(key => /^B\(1\.9\.41\)(?: #\d+)?$/.test(key)), keys);
  const directory = path.join(arena, `migration 한글 é ${variant}`);
  fs.mkdirSync(directory);
  const warningFile = path.join(out, `migration-${variant}-warnings.log`);
  const guarded = withRedirectWarnings(env, warningFile);
  assert.deepEqual(guarded.reasons, []);
  report.migrationCases ||= [];
  for (const [index, key] of keys.entries()) check(`${variant} original ${key}: real CLI and original timeout`, () => {
    assert(!plan.usesShared.has(key), 'case acquired shared E2E fixture dependencies');
    const marker = `if (e2eShard.take('${key}')) {`;
    const start = source.indexOf(marker), end = source.indexOf('\n}', start);
    assert(start >= 0 && end > start && source.indexOf(marker, start + marker.length) === -1);
    const code = source.slice(start, end + 2), lines = [], calls = [];
    const context = { fs, path, os: { ...os, tmpdir: () => directory },
      process: { execPath: process.execPath }, CLI: entry, performance, childDiagnostics, childExitMatches,
      total: 0, failed: 0, e2eShard: { take: name => name === key },
      console: { log: (...args) => { const line = args.join(' '); lines.push(line); console.log(line); } },
      cp: { spawnSync: (file, args, options) => {
        assert.equal(file, process.execPath); assert.equal(args[0], entry);
        assert(['whats-new', 'migrate', 'handoff'].includes(args[1]));
        const project = args[1] === 'handoff' ? args[2] : args[1] === 'whats-new' ? directory : null;
        const before = project ? snapshot(project) : null;
        const started = performance.now();
        const result = cp.spawnSync(file, args, { ...options, cwd: directory, env: guarded.env });
        const diagnostic = childDiagnostics(result, performance.now() - started, options.timeout);
        const log = String(++sequence).padStart(2, '0') + `-migration-${variant}-${index}-${args[1]}.log`;
        const logBytes = Buffer.from(JSON.stringify({ args, ...diagnostic, stdout: result.stdout, stderr: result.stderr }, null, 2) + '\n');
        fs.writeFileSync(path.join(out, log), logBytes);
        const record = { variant, case: key, command: args[1], ...diagnostic, log, sha256: hash(logBytes) };
        calls.push(record); report.commands.push(record); save();
        assert(!/DEP0190|DeprecationWarning:[^\r\n]*shell option true/i.test(result.stderr || ''), 'child runtime warning');
        if (project) assert.deepEqual(snapshot(project), before, `${args[1]} must not change fixture bytes/listing/mtime`);
        return result;
      } },
    };
    vm.runInNewContext(code, context, { filename: `${sourceFile}:${key}` });
    const row = { variant, case: key, sourceSha256: hash(bytes), blockSha256: hash(code),
      total: context.total, failed: context.failed, commands: calls, output: lines };
    report.migrationCases.push(row); save();
    assert.equal(context.total, 1); assert.equal(context.failed, 0, lines.join('\n'));
    assert.deepEqual(calls.map(call => call.command), index === 0 ? ['whats-new'] : index === 3 ? ['migrate', 'handoff'] : ['migrate']);
    assert.deepEqual(calls.map(call => call.timeoutMs), index === 0 ? [20000] : index === 3 ? [60000, 15000] : [60000]);
    assert(calls.every(call => call.status === 0 && !call.signal && !call.errorCode));
    const warnings = fs.existsSync(warningFile) ? fs.readFileSync(warningFile, 'utf8') : '';
    assert(!/DEP0190|DeprecationWarning:[^\r\n]*shell option true/i.test(warnings + calls.map(call => call.stderrTail || '').join('\n')));
  });
}

try {
  const sourceBefore = runtimeHashes(ROOT);
  const workspaceBefore = snapshot(path.join(ROOT, '.leerness'));
  const packageBefore = fs.readFileSync(path.join(ROOT, 'package.json'));
  const packed = check('pack is offline with lifecycle scripts disabled', () => {
    const result = run('pack', ['pack', ROOT, '--ignore-scripts', '--offline', '--json', '--pack-destination', path.join(arena, 'pack')], { npm: true });
    const entries = JSON.parse(result.stdout); assert.equal(entries.length, 1);
    assert(entries[0].files.every(item => !/^(?:\.leerness|\.delivery|\.github)\//.test(item.path)));
    const archive = path.join(arena, 'pack', entries[0].filename);
    assert.equal(path.dirname(archive), path.join(arena, 'pack'));
    report.archive = { sha256: hash(fs.readFileSync(archive)), integrity: entries[0].integrity, files: entries[0].files.length };
    return archive;
  });
  const prefix = path.join(arena, 'install');
  check('install is local, offline and lifecycle-free', () => run('install', ['install', packed, '--prefix', prefix,
    '--ignore-scripts', '--offline', '--no-audit', '--no-fund', '--no-package-lock'], { npm: true, cwd: prefix }));
  const installedRoot = path.join(prefix, 'node_modules', 'leerness'), installedCLI = path.join(installedRoot, 'bin', 'leerness.js');
  check('installed bin/lib/package bytes exactly match the source', () => {
    assert.deepEqual(runtimeHashes(installedRoot), sourceBefore); report.runtimeFiles = Object.keys(sourceBefore).length;
    report.runtimeDigest = hash(JSON.stringify(sourceBefore));
  });
  check('package-byte comparison detects a deliberately altered module', () => {
    const file = path.join(installedRoot, 'lib', 'publication-absence.js'), original = fs.readFileSync(file);
    try { fs.appendFileSync(file, '\n'); assert.notDeepEqual(runtimeHashes(installedRoot), sourceBefore); }
    finally { fs.writeFileSync(file, original); }
    assert.deepEqual(runtimeHashes(installedRoot), sourceBefore);
  });
  check('installed entrypoint and generated npm shim report the source version', () => {
    assert(run('installed-version', ['--version'], { entry: installedCLI }).stdout.includes(VERSION));
    const shim = path.join(prefix, 'node_modules', '.bin', process.platform === 'win32' ? 'leerness.cmd' : 'leerness');
    assert(run('installed-shim-version', ['--version'], { entry: shim, shim: true }).stdout.includes(VERSION));
  });
  const seed = path.join(arena, 'fixture'); fs.mkdirSync(seed);
  fs.writeFileSync(path.join(seed, 'package.json'), JSON.stringify({ name: 'installed-handoff-fixture', version: '1.0.0' }) + '\n');
  check('post-session-close fixture preserves the original smoke task sequence', () => {
    run('fixture-init', ['init', seed, '--yes', '--language', 'ko', '--skills', 'recommended'], { cwd: seed });
    for (const [name, args] of [
      ['plan-a', ['plan', 'add', '마일스톤 A', '--status', 'planned']],
      ['plan-b', ['plan', 'add', '마일스톤 B', '--status', 'in-progress']],
      ['task-add', ['task', 'add', '사용자 요청 X', '--status', 'requested']],
      ['task-start', ['task', 'update', 'T-0001', '--status', 'in-progress', '--next', '검증 실행']],
      ['task-done', ['task', 'update', 'T-0001', '--status', 'done', '--evidence', 'review-evidence:e2e']],
    ]) run(name, [...args, '--path', seed], { cwd: seed });
    fs.appendFileSync(path.join(seed, '.leerness', 'review-evidence.md'), '\n## e2e\nTask: T-0001\nCommand: fixture-only\nExit: 0\nNote: synthetic acceptance fixture, not a test claim\n');
    run('session-close', ['session', 'close', seed], { cwd: seed });
  });
  const copyFixture = (from, to) => {
    const stat = fs.lstatSync(from);
    assert(!stat.isSymbolicLink(), 'fixture copy refuses links');
    if (stat.isDirectory()) {
      fs.mkdirSync(to);
      for (const name of fs.readdirSync(from).sort()) copyFixture(path.join(from, name), path.join(to, name));
    } else {
      assert(stat.isFile(), 'fixture copy expects a regular file');
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      assert.equal(hash(fs.readFileSync(to)), hash(fs.readFileSync(from)));
    }
    fs.utimesSync(to, stat.atime, stat.mtime);
  };
  const fresh = label => { const root = path.join(arena, `project 한글 é ${label}`); copyFixture(seed, root); return root; };
  const outputs = new Map();
  for (let round = 0; round < 3; round++) {
    for (const variant of round % 2 ? ['installed', 'source'] : ['source', 'installed']) {
      check(`${variant} default handoff ${round + 1}: fresh Unicode path, no writes, 30s timeout`, () => {
        const project = fresh(`${variant}-${round}`), before = snapshot(project);
        const result = run(`${variant}-handoff-${round}`, ['handoff', project], { entry: variant === 'source' ? CLI : installedCLI, cwd: project, timeout: 30000 });
        assert.deepEqual(snapshot(project), before); assert.match(result.stdout, /T-0001/);
        assert.match(result.stdout, /not_inspected/);
        outputs.set(`${variant}-${round}`, normalize(result.stdout, project));
        report.timings.push({ variant, round: round + 1, milliseconds: Math.round(result.milliseconds * 1000) / 1000, freshProject: true });
      });
    }
    check(`source and installed text are identical in round ${round + 1}`, () => assert.equal(outputs.get(`source-${round}`), outputs.get(`installed-${round}`)));
  }
  for (const language of ['ko', 'en']) {
    check(`source/installed JSON parity and zero writes (${language})`, () => {
      const results = [];
      for (const variant of ['source', 'installed']) {
        const project = fresh(`${variant}-json-${language}`), before = snapshot(project);
        const result = run(`${variant}-json-${language}`, ['handoff', project, '--json', '--language', language],
          { entry: variant === 'source' ? CLI : installedCLI, cwd: project, timeout: 30000 });
        const data = JSON.parse(result.stdout); assert.equal(data.inspection.status, 'not_inspected');
        assert.deepEqual(snapshot(project), before); results.push(JSON.parse(normalize(result.stdout, project)));
      }
      assert.deepEqual(results[0], results[1]);
    });
  }
  check('installed default MCP handoff equals compact CLI without fixture writes', () => {
    const project = fresh('mcp'), before = snapshot(project);
    const cli = run('mcp-cli-control', ['handoff', project, '--compact'], { entry: installedCLI, cwd: project, env: { ...env, LEERNESS_INTERNAL: '1' } });
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_handoff', arguments: { path: project } } };
    const response = run('installed-mcp', ['mcp', 'serve', '--profile', 'full'], { entry: installedCLI, cwd: project, input: JSON.stringify(request) + '\n' });
    const messages = response.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line)); assert.equal(messages.length, 1);
    assert.equal(messages[0].result.isError, false); assert.equal(messages[0].result.content[0].text, cli.stdout);
    assert.deepEqual(snapshot(project), before);
  });
  originalMigrationCases(CLI, 'source');
  originalMigrationCases(installedCLI, 'installed');
  check('original migration cases leave the source workspace unchanged', () => {
    assert.deepEqual(snapshot(path.join(ROOT, '.leerness')), workspaceBefore);
  });
  check('packing and acceptance did not change source runtime bytes or package.json', () => {
    assert.deepEqual(runtimeHashes(ROOT), sourceBefore); assert.deepEqual(fs.readFileSync(path.join(ROOT, 'package.json')), packageBefore);
  });
  report.summary = Object.fromEntries(['source', 'installed'].map(variant => {
    const ordered = report.timings.filter(row => row.variant === variant).map(row => row.milliseconds).sort((a, b) => a - b);
    return [variant, { samples: ordered.length, medianMs: ordered[1], minMs: ordered[0], maxMs: ordered[ordered.length - 1] }];
  }));
  report.passed = true; save();
  console.log(`installed handoff: ${report.checks.length}/${report.checks.length}; ${JSON.stringify(report.summary)}`);
} catch (error) { report.error = error.stack; save(); console.error(error.stack); process.exitCode = 1; }
console.log(`Evidence: ${out}`);
