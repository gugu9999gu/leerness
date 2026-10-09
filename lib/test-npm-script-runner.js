'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { resolveNpmCliPath } = require('./npm-process');
const { INPUT_SCHEMA: PROBE_SCHEMA, probeNpmScripts } = require('./test-npm-script-probe');
const { stopTestProcessTree } = require('./test-process-tree');

const INPUT_SCHEMA = 'leerness.test-npm-script-runner-input/v1';
const OUTPUT_SCHEMA = 'leerness.test-npm-script-runner/v1';
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_TIMEOUT_MS = 300000;

class TestNpmScriptRunnerInputError extends Error {
  constructor(code, field) {
    super(`${code} at ${field}`);
    this.name = 'TestNpmScriptRunnerInputError';
    this.code = `test_npm_script_runner_${code}`;
    this.field = field;
  }
}
function fail(code, field) { throw new TestNpmScriptRunnerInputError(code, field); }
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative));
}
function record(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('object_required', field);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => !keys.includes(key))) fail('fields_invalid', field);
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !desc.enumerable || !Object.hasOwn(desc, 'value')) fail('data_field_required', `${field}.${key}`);
  }
}
function validate(input, root) {
  record(input, ['schema', 'execute', 'check', 'commandDigest', 'packageDigest', 'scriptDigest'], '$');
  if (input.schema !== INPUT_SCHEMA) fail('schema_unsupported', '$.schema');
  if (input.execute !== true) fail('explicit_execution_required', '$.execute');
  for (const field of ['commandDigest', 'packageDigest', 'scriptDigest']) {
    if (typeof input[field] !== 'string' || !DIGEST.test(input[field])) fail('digest_invalid', `$.${field}`);
  }
  if (!input.check || !Number.isSafeInteger(input.check.timeoutMs)
    || input.check.timeoutMs < 100 || input.check.timeoutMs > MAX_TIMEOUT_MS) {
    fail('timeout_invalid', '$.check.timeoutMs');
  }
  const probe = probeNpmScripts({ schema: PROBE_SCHEMA, checks: [input.check] }, root);
  return { current: probe.results[0], check: input.check };
}
function runNpm(cliPath, argv, cwd, timeoutMs) {
  return new Promise(resolve => {
    const started = performance.now();
    let child;
    try {
      child = cp.spawn(process.execPath, [cliPath, ...argv.slice(1)], {
        cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32',
        stdio: ['ignore', 'ignore', 'ignore'],
      });
    } catch { resolve({ started: false, reason: 'spawn-error', exitCode: null, elapsedMs: 0 }); return; }
    let reason = null;
    const timer = setTimeout(() => { reason = reason || 'timeout'; stopTestProcessTree(child); }, timeoutMs);
    child.on('error', () => { reason = reason || 'spawn-error'; });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ started: Boolean(child.pid), reason, exitCode: code,
        elapsedMs: Math.round(performance.now() - started) });
    });
  });
}
async function runNamedNpmScript(input, projectRoot = process.cwd(), options = {}) {
  const root = fs.realpathSync(projectRoot);
  const { current, check } = validate(input, root);
  const base = { schema: OUTPUT_SCHEMA, checkId: current.checkId, failedTestId: current.failedTestId,
    scope: 'one-named-npm-script-entry', executed: false, scriptExitZeroObserved: false,
    runnerSelectorVerified: false, testPassVerified: false, coverageVerified: false,
    serviceReadyVerified: false, finalGatePassed: false, evidenceReusable: false };
  if (current.status !== 'named-script-present') return { ...base, executionStatus: 'script-missing' };
  if (current.commandDigest !== input.commandDigest || current.packageDigest !== input.packageDigest
    || current.scriptDigest !== input.scriptDigest) return { ...base, executionStatus: 'preflight-changed' };
  if (current.lifecycleHooksPresent) return { ...base, executionStatus: 'lifecycle-hooks-present' };

  const cwd = fs.realpathSync(path.resolve(root, check.cwd));
  if (!inside(root, cwd)) return { ...base, executionStatus: 'project-path-changed' };
  const packageDir = fs.realpathSync(path.resolve(root, current.packageDir));
  if (!inside(root, packageDir)) return { ...base, executionStatus: 'project-path-changed' };
  const argv = [...check.argv];
  if (argv[1] === '--prefix') argv[2] = packageDir;
  const hasExplicitCli = Object.hasOwn(options, 'npmCliPath');
  const cliPath = hasExplicitCli ? options.npmCliPath : resolveNpmCliPath({ cwd });
  if (!cliPath || !fs.existsSync(cliPath)) return { ...base, executionStatus: 'npm-unavailable' };
  const run = await runNpm(cliPath, argv, cwd, check.timeoutMs);
  if (!run.started) return { ...base, executionStatus: run.reason || 'spawn-error',
    exitCode: run.exitCode, elapsedMs: run.elapsedMs };

  let packageStable = false;
  try {
    const after = probeNpmScripts({ schema: PROBE_SCHEMA, checks: [check] }, root).results[0];
    packageStable = after.packageDigest === input.packageDigest && after.scriptDigest === input.scriptDigest
      && !after.lifecycleHooksPresent;
  } catch { /* a changed or unreadable package cannot support a stable result */ }
  const executionStatus = !packageStable ? 'package-changed' : run.reason ||
    (run.exitCode === 0 ? 'exit-zero' : 'script-failed');
  return { ...base, executed: true, executionStatus, exitCode: run.exitCode,
    elapsedMs: run.elapsedMs, packageStable,
    scriptExitZeroObserved: packageStable && !run.reason && run.exitCode === 0 };
}

module.exports = { INPUT_SCHEMA, OUTPUT_SCHEMA, TestNpmScriptRunnerInputError, runNamedNpmScript };
