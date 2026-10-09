'use strict';

const cp = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { TextDecoder } = require('node:util');
const { assertUniqueKeys } = require('./review-checkpoint-transport');
const { stopTestProcessTree } = require('./test-process-tree');

const INPUT_SCHEMA = 'leerness.test-suite-list-input/v1';
const OUTPUT_SCHEMA = 'leerness.test-suite-list/v1';
const MAX_FILE_BYTES = 1048576;
const MAX_OUTPUT_BYTES = 65536;
const MAX_ENTRIES = 512;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const FILE = /\.(?:js|cjs|mjs)$/;

class TestSuiteListInputError extends Error {
  constructor(code, field) {
    super(`${code} at ${field}`);
    this.name = 'TestSuiteListInputError';
    this.code = `test_suite_list_${code}`;
    this.field = field;
  }
}
function fail(code, field) { throw new TestSuiteListInputError(code, field); }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative));
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
function relative(value, field) {
  if (value === '.') return;
  if (typeof value !== 'string' || value.length < 1 || value.length > 240 || !wellFormed(value)
    || /[\u0000-\u001f\u007f\\:*?"<>|]/u.test(value) || value.startsWith('/')
    || value.split('/').some(part => !part || part === '.' || part === '..'
      || part.endsWith(' ') || part.endsWith('.'))) fail('path_invalid', field);
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
function readWrapperDigest(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) fail('wrapper_unavailable', '$.wrapperFile');
  const bytes = fs.readFileSync(file);
  if (bytes.length > MAX_FILE_BYTES) fail('wrapper_unavailable', '$.wrapperFile');
  return hash(bytes);
}
function validate(input, projectRoot) {
  record(input, ['schema', 'execute', 'cwd', 'wrapperFile', 'failedTestId', 'timeoutMs'], '$');
  if (input.schema !== INPUT_SCHEMA) fail('schema_unsupported', '$.schema');
  if (input.execute !== true) fail('explicit_execution_required', '$.execute');
  relative(input.cwd, '$.cwd');
  relative(input.wrapperFile, '$.wrapperFile');
  if (!FILE.test(input.wrapperFile)) fail('wrapper_extension_unsupported', '$.wrapperFile');
  if (typeof input.failedTestId !== 'string' || !ID.test(input.failedTestId)) {
    fail('test_id_invalid', '$.failedTestId');
  }
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 300000) {
    fail('timeout_invalid', '$.timeoutMs');
  }
  let root; let cwd; let wrapper;
  try {
    root = fs.realpathSync(projectRoot);
    cwd = fs.realpathSync(path.resolve(root, input.cwd));
    wrapper = fs.realpathSync(path.resolve(cwd, input.wrapperFile));
    if (!inside(root, cwd) || !inside(cwd, wrapper)) fail('path_outside_project', '$.wrapperFile');
    if (!FILE.test(wrapper)) fail('wrapper_extension_unsupported', '$.wrapperFile');
    if (!fs.statSync(cwd).isDirectory()) fail('wrapper_unavailable', '$.cwd');
  } catch (error) {
    if (error instanceof TestSuiteListInputError) throw error;
    fail('wrapper_unavailable', '$.wrapperFile');
  }
  let wrapperDigest;
  try { wrapperDigest = readWrapperDigest(wrapper); }
  catch (error) {
    if (error instanceof TestSuiteListInputError) throw error;
    fail('wrapper_unavailable', '$.wrapperFile');
  }
  return { cwd, wrapper, wrapperDigest, target: `test:${input.failedTestId}`, timeoutMs: input.timeoutMs };
}
function observe(wrapper, cwd, timeoutMs) {
  return new Promise(resolve => {
    const started = performance.now();
    let child;
    try {
      child = cp.spawn(process.execPath, [wrapper, '--list'], {
        cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch { resolve({ started: false, reason: 'spawn-error', exitCode: null, elapsedMs: 0 }); return; }
    let reason = null;
    let outputBytes = 0;
    const chunks = [];
    const stop = why => { if (!reason) { reason = why; stopTestProcessTree(child); } };
    child.stdout.on('data', chunk => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) stop('output-limit');
      else chunks.push(chunk);
    });
    child.on('error', () => { reason = reason || 'spawn-error'; });
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ started: Boolean(child.pid), reason, exitCode: code,
        elapsedMs: Math.round(performance.now() - started),
        output: reason ? null : Buffer.concat(chunks) });
    });
  });
}
function classify(output, target) {
  let manifest;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(output);
    manifest = JSON.parse(text);
    assertUniqueKeys(text);
    record(manifest, ['selected', 'skipped'], '$.output');
    if (!Array.isArray(manifest.selected) || !Array.isArray(manifest.skipped)
      || manifest.selected.length + manifest.skipped.length > MAX_ENTRIES) throw new Error('entries invalid');
    const names = new Set();
    for (const name of manifest.selected) {
      if (typeof name !== 'string' || !SCRIPT_NAME.test(name) || names.has(name)) throw new Error('selected invalid');
      names.add(name);
    }
    for (const row of manifest.skipped) {
      if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== 'string'
        || !SCRIPT_NAME.test(row[0]) || names.has(row[0]) || typeof row[1] !== 'string'
        || !row[1].trim() || row[1].length > 512 || !wellFormed(row[1])) throw new Error('skipped invalid');
      names.add(row[0]);
    }
  } catch { return null; }
  const targetStatus = manifest.selected.includes(target) ? 'selected'
    : manifest.skipped.some(row => row[0] === target) ? 'skipped' : 'absent';
  return { targetStatus, selectedCount: manifest.selected.length, skippedCount: manifest.skipped.length,
    focusListed: targetStatus === 'selected' && manifest.selected.length === 1,
    outputDigest: hash(output) };
}
async function runSuiteList(input, projectRoot = process.cwd()) {
  const request = validate(input, projectRoot);
  const base = { schema: OUTPUT_SCHEMA, scope: 'wrapper-list-observation', executed: false,
    listObserved: false, focusListed: false, testsNotRunVerified: false,
    runnerSelectorVerified: false, testPassVerified: false, serviceReadyVerified: false,
    coverageVerified: false, finalGatePassed: false, evidenceReusable: false };
  const run = await observe(request.wrapper, request.cwd, request.timeoutMs);
  if (!run.started) return { ...base, executionStatus: run.reason || 'spawn-error',
    exitCode: run.exitCode, elapsedMs: run.elapsedMs };
  let wrapperStable = false;
  try { wrapperStable = readWrapperDigest(request.wrapper) === request.wrapperDigest; }
  catch { /* changed or unreadable wrapper cannot support a stable observation */ }
  const result = { ...base, executed: true, exitCode: run.exitCode, elapsedMs: run.elapsedMs,
    wrapperStable, wrapperDigest: request.wrapperDigest };
  if (!wrapperStable) return { ...result, executionStatus: 'wrapper-changed' };
  if (run.reason) return { ...result, executionStatus: run.reason };
  if (run.exitCode !== 0) return { ...result, executionStatus: 'wrapper-failed' };
  const listed = classify(run.output, request.target);
  return listed ? { ...result, ...listed, listObserved: true, executionStatus: 'list-observed' }
    : { ...result, executionStatus: 'manifest-invalid' };
}

module.exports = { INPUT_SCHEMA, OUTPUT_SCHEMA, TestSuiteListInputError, runSuiteList };
