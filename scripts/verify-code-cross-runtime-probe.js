#!/usr/bin/env node
'use strict';

// T-0143: verify-code must execute its own fixed Python/Go/Rust runners under
// fresh basic permissions, and a failed run must not become green gate evidence.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-cross-runtime-'));
const fakeBin = path.join(tempRoot, 'fake-bin');
const baseEnv = {
  ...process.env,
  LEERNESS_OFFLINE: '1',
  LEERNESS_NO_BANNER: '1',
  LEERNESS_NO_PROMPT: '1',
  LEERNESS_NO_DRIFT_CHECK: '1',
};

function run(args, cwd, env = baseEnv) {
  return cp.spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 120000,
  });
}

function output(result) {
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim();
}

function check(condition, message, result) {
  if (condition) return;
  const detail = result ? `\n${output(result).slice(0, 1600)}` : '';
  throw new Error(`${message}${detail}`);
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function writeRunner(name, stdout, exitCode) {
  fs.mkdirSync(fakeBin, { recursive: true });
  if (process.platform === 'win32') {
    write(path.join(fakeBin, `${name}.cmd`), `@echo off\r\necho ${stdout}\r\nexit /b ${exitCode}\r\n`);
    return;
  }
  const file = path.join(fakeBin, name);
  write(file, `#!/bin/sh\nprintf '%s\\n' '${stdout.replace(/'/g, "'\\''")}'\nexit ${exitCode}\n`);
  fs.chmodSync(file, 0o755);
}

function runnerEnv() {
  return { ...baseEnv, PATH: `${fakeBin}${path.delimiter}${baseEnv.PATH || ''}` };
}

function initProject(name) {
  const root = path.join(tempRoot, name);
  fs.mkdirSync(root, { recursive: true });
  const result = run(['init', root, '--yes', '--language', 'en', '--no-stale-check'], tempRoot);
  check(result.status === 0, `init failed for ${name} (exit ${result.status})`, result);
  return root;
}

function addDoneWork(root) {
  let result = run(['task', 'add', 'cross-runtime verification', '--path', root], root);
  check(result.status === 0, `task add failed (exit ${result.status})`, result);
  const tracker = fs.readFileSync(path.join(root, '.leerness', 'progress-tracker.md'), 'utf8');
  const ids = Array.from(tracker.matchAll(/\|\s*(T-\d{4,})\s*\|/g), match => match[1]);
  const id = ids[ids.length - 1];
  check(!!id, 'task id not found after task add');
  result = run(['task', 'update', id, '--status', 'done', '--evidence', 'cross-runtime fixture implemented', '--path', root], root);
  check(result.status === 0, `task update failed (exit ${result.status})`, result);
  result = run(['session', 'close', '--path', root], root);
  check(result.status === 0, `session close failed (exit ${result.status})`, result);
}

function parseJson(result, label) {
  try { return JSON.parse(result.stdout || '{}'); }
  catch { throw new Error(`${label} returned invalid JSON\n${output(result).slice(0, 1600)}`); }
}

try {
  writeRunner('pytest', '- child: exit=1', 0);
  writeRunner('go', 'ok example.test/module 0.01s', 0);
  writeRunner('cargo', 'test result: ok. 2 passed; 0 failed', 0);

  const passRoot = initProject('pass');
  write(path.join(passRoot, 'pyproject.toml'), '[project]\nname = "probe"\nversion = "0.0.0"\n');
  write(path.join(passRoot, 'go.mod'), 'module example.test/module\n\ngo 1.22\n');
  write(path.join(passRoot, 'Cargo.toml'), '[package]\nname = "probe"\nversion = "0.0.0"\nedition = "2021"\n');
  const passed = run(['verify-code', '--path', passRoot], passRoot, runnerEnv());
  check(
    passed.status === 0
      && /test:python passed/.test(passed.stdout || '')
      && /test:go passed/.test(passed.stdout || '')
      && /test:rust passed/.test(passed.stdout || ''),
    `cross-runtime verify blocked/failed under basic permissions (exit ${passed.status})`,
    passed,
  );
  const passLazy = run(['lazy', 'detect', '--path', passRoot, '--json'], passRoot, runnerEnv());
  const passLazyJson = parseJson(passLazy, 'passing lazy detect');
  check(
    Array.isArray(passLazyJson.findings) && !passLazyJson.findings.some(f => f.kind === 'no_test_run'),
    'successful verify Tail text was mistaken for a failed exit',
    passLazy,
  );

  writeRunner('pytest', '1 failed in 0.01s', 1);
  const failRoot = initProject('fail');
  write(path.join(failRoot, 'pyproject.toml'), '[project]\nname = "probe-fail"\nversion = "0.0.0"\n');
  addDoneWork(failRoot);
  const failedVerify = run(['verify-code', '--path', failRoot], failRoot, runnerEnv());
  check(failedVerify.status === 1, `failing pytest was not propagated (exit ${failedVerify.status})`, failedVerify);

  const lazy = run(['lazy', 'detect', '--path', failRoot, '--json'], failRoot, runnerEnv());
  const lazyJson = parseJson(lazy, 'lazy detect');
  check(
    lazy.status === 1 && Array.isArray(lazyJson.findings) && lazyJson.findings.some(f => f.kind === 'no_test_run'),
    `failed verify evidence accepted by lazy detect (exit ${lazy.status})`,
    lazy,
  );

  const gate = run(['gate', '--path', failRoot, '--json'], failRoot, runnerEnv());
  const gateJson = parseJson(gate, 'gate');
  const lazyStep = Array.isArray(gateJson.checks) && gateJson.checks.find(item => item.name === 'lazy detect');
  check(gate.status === 1 && gateJson.ok === false && lazyStep && lazyStep.ok === false, `failed verify evidence accepted by gate (exit ${gate.status})`, gate);

  writeRunner('npm', 'node suite passed', 0);
  const hybridRoot = initProject('hybrid');
  write(path.join(hybridRoot, 'package.json'), JSON.stringify({ name: 'hybrid-probe', version: '0.0.0', scripts: { test: 'node -e "process.exit(0)"' } }, null, 2) + '\n');
  write(path.join(hybridRoot, 'pyproject.toml'), '[project]\nname = "hybrid-probe"\nversion = "0.0.0"\n');
  const hybrid = run(['verify-code', '--path', hybridRoot], hybridRoot, runnerEnv());
  check(
    hybrid.status === 1 && /test passed/.test(hybrid.stdout || '') && /test:python failed/.test(hybrid.stdout || ''),
    `passing Node test hid failing Python tests (exit ${hybrid.status})`,
    hybrid,
  );

  writeRunner('pytest', '4 passed in 0.01s', 0);
  const recoveredVerify = run(['verify-code', '--path', failRoot], failRoot, runnerEnv());
  check(recoveredVerify.status === 0, `fixed pytest did not recover verify-code (exit ${recoveredVerify.status})`, recoveredVerify);
  const recoveredLazy = run(['lazy', 'detect', '--path', failRoot, '--json'], failRoot, runnerEnv());
  const recoveredLazyJson = parseJson(recoveredLazy, 'recovered lazy detect');
  check(
    recoveredLazy.status === 0 && Array.isArray(recoveredLazyJson.findings) && !recoveredLazyJson.findings.some(f => f.kind === 'no_test_run'),
    `latest successful verify did not recover lazy detect (exit ${recoveredLazy.status})`,
    recoveredLazy,
  );
  const recoveredGate = run(['gate', '--path', failRoot, '--json'], failRoot, runnerEnv());
  const recoveredGateJson = parseJson(recoveredGate, 'recovered gate');
  check(recoveredGate.status === 0 && recoveredGateJson.ok === true, `latest successful verify did not recover gate (exit ${recoveredGate.status})`, recoveredGate);

  const placeholderRoot = initProject('placeholder');
  write(path.join(placeholderRoot, 'package.json'), JSON.stringify({ name: 'placeholder-probe', version: '0.0.0', scripts: { test: 'echo "Error: no test specified" && exit 1' } }, null, 2) + '\n');
  write(path.join(placeholderRoot, 'pyproject.toml'), '[project]\nname = "placeholder-probe"\nversion = "0.0.0"\n');
  const placeholder = run(['verify-code', '--path', placeholderRoot], placeholderRoot, runnerEnv());
  check(
    placeholder.status === 0 && /verify-code \(1개\)/.test(placeholder.stdout || '') && /test:python passed/.test(placeholder.stdout || '') && !/^## test: npm test/m.test(placeholder.stdout || ''),
    `npm placeholder masked Python verification (exit ${placeholder.status})`,
    placeholder,
  );

  const jsOnlyRoot = initProject('js-only-tests-dir');
  write(path.join(jsOnlyRoot, 'package.json'), JSON.stringify({ name: 'js-only-probe', version: '0.0.0' }, null, 2) + '\n');
  write(path.join(jsOnlyRoot, 'tests', 'math.test.js'), 'test("math", () => {});\n');
  const jsOnly = run(['verify-code', '--path', jsOnlyRoot], jsOnlyRoot, runnerEnv());
  check(jsOnly.status === 0 && !/pytest -q/.test(jsOnly.stdout || ''), `JavaScript-only tests directory was misdetected as Python (exit ${jsOnly.status})`, jsOnly);

  process.stdout.write('PASS verify-code cross-runtime permissions and failed-evidence gate probe\n');
} catch (error) {
  process.stderr.write(`FAIL verify-code cross-runtime probe: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
