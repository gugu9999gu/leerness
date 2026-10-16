'use strict';

const cp = require('node:child_process');
const fs = require('node:fs');
const { removeSync } = require('./safe-remove');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { TextDecoder } = require('node:util');
const { performance } = require('node:perf_hooks');
const { stopTestProcessTree } = require('./test-process-tree');

const INPUT_SCHEMA = 'leerness.test-node-runner-input/v1';
const OUTPUT_SCHEMA = 'leerness.test-node-runner/v1';
const MAX_OUTPUT_BYTES = 65536;
const MAX_TEST_MS = 300000;
const FILE_PATTERN = /\.test\.(?:js|cjs|mjs)$/;
const REPORTER_URL = pathToFileURL(path.join(__dirname, 'test-node-selection-reporter.mjs')).href;
const FIXTURE_SOURCE = "const test = require('node:test');\ntest('alpha', () => {});\ntest('beta', () => {});\ntest('gamma', () => {});\n";

class TestNodeRunnerInputError extends Error {
  constructor(code, field) {
    super(`${code} at ${field}`);
    this.name = 'TestNodeRunnerInputError';
    this.code = `test_node_runner_${code}`;
    this.field = field;
  }
}
function fail(code, field) { throw new TestNodeRunnerInputError(code, field); }
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
function relative(value, field) {
  if (value === '.') return;
  if (typeof value !== 'string' || value.length < 1 || value.length > 240 || !wellFormed(value)
    || /[\u0000-\u001f\u007f\\:*?"<>|]/u.test(value) || value.startsWith('/')
    || value.split('/').some(part => !part || part === '.' || part === '..'
      || part.endsWith(' ') || part.endsWith('.'))) fail('path_invalid', field);
}
function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
function wellFormed(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function validate(input, projectRoot) {
  record(input, ['schema', 'execute', 'cwd', 'testFile', 'testName', 'timeoutMs'], '$');
  if (input.schema !== INPUT_SCHEMA) fail('schema_unsupported', '$.schema');
  if (input.execute !== true) fail('explicit_execution_required', '$.execute');
  relative(input.cwd, '$.cwd');
  relative(input.testFile, '$.testFile');
  if (!FILE_PATTERN.test(input.testFile)) fail('test_file_unsupported', '$.testFile');
  if (typeof input.testName !== 'string' || input.testName.length < 1 || input.testName.length > 120
    || !input.testName.trim() || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(input.testName)
    || !wellFormed(input.testName)) fail('test_name_invalid', '$.testName');
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > MAX_TEST_MS) {
    fail('timeout_invalid', '$.timeoutMs');
  }
  let root;
  let cwd;
  let testFile;
  try {
    root = fs.realpathSync(projectRoot);
    cwd = fs.realpathSync(path.resolve(root, input.cwd));
    testFile = fs.realpathSync(path.resolve(cwd, input.testFile));
    if (!inside(root, cwd) || !inside(cwd, testFile)) fail('path_outside_project', '$.testFile');
    if (!fs.statSync(cwd).isDirectory() || !fs.statSync(testFile).isFile()) fail('test_file_unavailable', '$.testFile');
  } catch (error) {
    if (error instanceof TestNodeRunnerInputError) throw error;
    fail('test_file_unavailable', '$.testFile');
  }
  return { cwd, testFile, testName: input.testName, timeoutMs: input.timeoutMs };
}
function exactPattern(name) { return `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`; }
function singleProcessTestFlag() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major >= 24 || (major === 23 && minor >= 6)) return '--test-isolation=none';
  if ((major === 22 && minor >= 8) || major === 23) return '--experimental-test-isolation=none';
  return null;
}
function runNode(testFile, pattern, cwd, timeoutMs) {
  return new Promise(resolve => {
    const started = performance.now();
    const isolation = singleProcessTestFlag();
    const args = ['--test', ...(isolation ? [isolation] : []),
      `--test-reporter=${REPORTER_URL}`, `--test-name-pattern=${pattern}`, testFile];
    const env = { ...process.env, FORCE_COLOR: '0' };
    delete env.NODE_OPTIONS;
    let child;
    try {
      child = cp.spawn(process.execPath, args, { cwd, env, shell: false, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { resolve({ reason: 'spawn-error', elapsedMs: 0, exitCode: null, events: null }); return; }
    const chunks = [];
    let outputBytes = 0;
    let reason = null;
    const stop = why => {
      if (reason) return;
      reason = why;
      // With one-file, single-process isolation there is no Node test worker to
      // wait for. taskkill can take seconds on Windows, after a timed-out test
      // has already resumed, so stop the directly owned process immediately.
      if (process.platform === 'win32' && isolation) child.kill('SIGKILL');
      else stopTestProcessTree(child);
    };
    child.stdout.on('data', chunk => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) stop('output-limit');
      else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) stop('output-limit');
    });
    child.on('error', () => { reason = reason || 'spawn-error'; });
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      let events = null;
      if (!reason) {
        try {
          const output = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
          const lines = output.trim();
          events = (lines ? lines.split('\n') : []).map(line => {
            const event = JSON.parse(line);
            if (!['test:start', 'test:pass', 'test:fail'].includes(event.type)
              || typeof event.name !== 'string' || typeof event.skipped !== 'boolean'
              || typeof event.todo !== 'boolean') throw new Error('invalid report event');
            return event;
          });
        } catch { reason = 'report-invalid'; }
      }
      resolve({ reason, elapsedMs: Math.round(performance.now() - started), exitCode: code, events });
    });
  });
}
function classify(run, testName, testFile) {
  if (run.reason) return { selectionStatus: 'unverified', executionStatus: run.reason, selectedCount: null };
  const starts = run.events.filter(event => event.type === 'test:start');
  const terminals = run.events.filter(event => event.type !== 'test:start');
  const startedNames = new Map();
  for (const event of starts) startedNames.set(event.name, (startedNames.get(event.name) || 0) + 1);
  for (const event of terminals) startedNames.set(event.name, (startedNames.get(event.name) || 0) - 1);
  if (starts.length !== terminals.length || [...startedNames.values()].some(count => count !== 0)) return {
    selectionStatus: 'unverified', executionStatus: 'report-incomplete', selectedCount: null,
  };
  // Node 18 reports nonmatching names as skipped lifecycle events. Newer Node
  // versions omit them and can emit a synthetic file-level pass for zero matches.
  const active = terminals.filter(event => !event.skipped && !event.todo && event.name !== testFile);
  const targetIgnored = terminals.find(event => event.name === testName && (event.skipped || event.todo));
  if (!active.length) return { selectionStatus: targetIgnored ? 'not-executed' : 'zero-selected',
    executionStatus: targetIgnored ? targetIgnored.todo ? 'todo' : 'skipped' : 'not-passed', selectedCount: 0 };
  if (active.length > 1) return {
    selectionStatus: 'multiple-selected', executionStatus: 'not-passed', selectedCount: active.length,
  };
  const terminal = active[0];
  if (terminal.name !== testName) return { selectionStatus: 'unexpected-selection',
    executionStatus: 'not-passed', selectedCount: 1 };
  if (terminal.type === 'test:fail') return { selectionStatus: 'exactly-one',
    executionStatus: 'failed', selectedCount: 1 };
  return { selectionStatus: 'exactly-one', executionStatus: run.exitCode === 0 ? 'passed' : 'runner-failed', selectedCount: 1 };
}
async function verifyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-node-selector-'));
  try {
    const file = path.join(dir, 'fixture.test.cjs');
    fs.writeFileSync(file, FIXTURE_SOURCE, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    for (const [pattern, name, expected] of [
      ['^missing$', 'missing', 'zero-selected'],
      ['^beta$', 'beta', 'exactly-one'],
      ['^(?:alpha|beta)$', 'beta', 'multiple-selected'],
    ]) {
      const run = await runNode(file, pattern, dir, 5000);
      const result = classify(run, name, file);
      if (run.exitCode !== 0 || result.selectionStatus !== expected
        || (expected === 'exactly-one' && result.executionStatus !== 'passed')) return false;
    }
    return true;
  } finally {
    const actual = fs.realpathSync(dir);
    const temp = fs.realpathSync(os.tmpdir());
    if (path.dirname(actual) !== temp || !path.basename(actual).startsWith('leerness-node-selector-')) {
      throw new Error('fixture cleanup path invalid');
    }
    // The last child test process can still be exiting. Windows then refuses the delete, and Node 26
    // rmSync does not retry EPERM even with maxRetries, so wait here, bounded.
    for (const deadline = Date.now() + 5000; ;) {
      try { removeSync(actual, { recursive: true, force: true }); break; }
      catch (error) {
        if (!['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM'].includes(error && error.code) || Date.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }
}
async function runNodeSelection(input, projectRoot = process.cwd()) {
  const request = validate(input, projectRoot);
  const base = { schema: OUTPUT_SCHEMA, adapter: 'node:test-direct-file', advisoryOnly: true,
    nodeVersion: process.version,
    fixtureSelectionVerified: false, executed: false, directNodeSelectionObserved: false,
    selectedTestPassed: false,
    projectScriptSelectorVerified: false, coverageVerified: false, serviceReadyVerified: false,
    finalGatePassed: false, evidenceReusable: false };
  let fixtureOk = false;
  try { fixtureOk = await verifyFixture(); } catch { /* fail closed before project execution */ }
  if (!fixtureOk) return { ...base,
    selectionStatus: 'unverified', executionStatus: 'runtime-selector-unavailable', selectedCount: null };
  const run = await runNode(request.testFile, exactPattern(request.testName), request.cwd, request.timeoutMs);
  const result = classify(run, request.testName, request.testFile);
  return { ...base, fixtureSelectionVerified: true, executed: true,
    ...result, exitCode: run.exitCode, elapsedMs: run.elapsedMs,
    directNodeSelectionObserved: result.selectionStatus === 'exactly-one',
    selectedTestPassed: result.selectionStatus === 'exactly-one' && result.executionStatus === 'passed' };
}

module.exports = { INPUT_SCHEMA, OUTPUT_SCHEMA, TestNodeRunnerInputError, runNodeSelection };
