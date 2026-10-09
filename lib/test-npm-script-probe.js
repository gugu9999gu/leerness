'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');
const { assertUniqueKeys } = require('./review-checkpoint-transport');

const INPUT_SCHEMA = 'leerness.test-npm-script-probe-input/v1';
const OUTPUT_SCHEMA = 'leerness.test-npm-script-probe/v1';
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const RELATIVE_PATTERN = /^[A-Za-z0-9._/-]{1,160}$/;
const MAX_PACKAGE_BYTES = 262144;

class TestScriptInputError extends Error {
  constructor(code, field) {
    super(`${code} at ${field}`);
    this.name = 'TestScriptInputError';
    this.code = `test_script_${code}`;
    this.field = field;
  }
}
function fail(code, field) { throw new TestScriptInputError(code, field); }
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
  if (typeof value !== 'string' || !RELATIVE_PATTERN.test(value) || value.startsWith('/')
    || value.split('/').some(part => part === '' || part === '.' || part === '..')) fail('path_invalid', field);
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
function parseCheck(check, index) {
  const field = `$.checks[${index}]`;
  record(check, ['id', 'failedTestId', 'argv', 'cwd', 'timeoutMs'], field);
  if (typeof check.id !== 'string' || !ID_PATTERN.test(check.id)) fail('id_invalid', `${field}.id`);
  if (typeof check.failedTestId !== 'string' || !ID_PATTERN.test(check.failedTestId)) {
    fail('test_id_invalid', `${field}.failedTestId`);
  }
  relative(check.cwd, `${field}.cwd`);
  if (!Number.isSafeInteger(check.timeoutMs) || check.timeoutMs < 1 || check.timeoutMs > 14400000) {
    fail('timeout_invalid', `${field}.timeoutMs`);
  }
  if (!Array.isArray(check.argv) || check.argv.length < 3 || check.argv.length > 8
    || check.argv.some(item => typeof item !== 'string' || !item || item.length > 256
      || /[\u0000-\u001f\u007f]/.test(item))) fail('argv_invalid', `${field}.argv`);
  const argv = check.argv;
  if (!['npm', 'npm.cmd'].includes(argv[0])) fail('runner_unsupported', `${field}.argv`);
  let cursor = 1;
  let prefix = '.';
  if (argv[cursor] === '--prefix') {
    prefix = argv[cursor + 1];
    relative(prefix, `${field}.argv[${cursor + 1}]`);
    cursor += 2;
  }
  if (argv[cursor++] !== 'run') fail('runner_unsupported', `${field}.argv`);
  if (argv[cursor] === '--silent') cursor++;
  const scriptName = `test:${check.failedTestId}`;
  if (argv[cursor] !== scriptName) fail('script_name_mismatch', `${field}.argv`);
  if (argv.length !== cursor + 1) fail('selector_unsupported', `${field}.argv`);
  return { ...check, scriptName, packageDir: path.join(check.cwd, prefix),
    commandDigest: hash(JSON.stringify([check.argv, check.cwd, check.timeoutMs])) };
}
function readPackage(root, relativeDir, field) {
  let packageFile;
  try {
    const dir = fs.realpathSync(path.resolve(root, relativeDir));
    if (!inside(root, dir)) fail('path_outside_project', field);
    packageFile = fs.realpathSync(path.join(dir, 'package.json'));
    if (!inside(root, packageFile) || !fs.statSync(packageFile).isFile()) fail('path_outside_project', field);
  } catch (error) {
    if (error instanceof TestScriptInputError) throw error;
    fail('package_unavailable', field);
  }
  let bytes;
  let fd;
  try {
    fd = fs.openSync(packageFile, 'r');
    if (!fs.fstatSync(fd).isFile()) fail('package_unavailable', field);
    const buffer = Buffer.alloc(MAX_PACKAGE_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (read === 0) break;
      size += read;
    }
    if (size > MAX_PACKAGE_BYTES) fail('package_too_large', field);
    bytes = buffer.subarray(0, size);
  } catch (error) {
    if (error instanceof TestScriptInputError) throw error;
    fail('package_unavailable', field);
  } finally { if (fd !== undefined) fs.closeSync(fd); }
  let pkg;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    pkg = JSON.parse(text);
    assertUniqueKeys(text);
  } catch { fail('package_invalid', field); }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)
    || (pkg.scripts !== undefined && (!pkg.scripts || typeof pkg.scripts !== 'object' || Array.isArray(pkg.scripts)))) {
    fail('package_invalid', field);
  }
  return { scripts: pkg.scripts || {}, packageDigest: hash(bytes) };
}
function probeNpmScripts(input, projectRoot = process.cwd()) {
  record(input, ['schema', 'checks'], '$');
  if (input.schema !== INPUT_SCHEMA) fail('schema_unsupported', '$.schema');
  if (!Array.isArray(input.checks) || input.checks.length < 1 || input.checks.length > 32) {
    fail('checks_invalid', '$.checks');
  }
  let root;
  try { root = fs.realpathSync(projectRoot); } catch { fail('project_unavailable', '$'); }
  const seen = new Set();
  const packages = new Map();
  const results = input.checks.map((check, index) => {
    const parsed = parseCheck(check, index);
    if (seen.has(parsed.id)) fail('id_duplicate', `$.checks[${index}].id`);
    seen.add(parsed.id);
    const dir = parsed.packageDir;
    if (!packages.has(dir)) packages.set(dir, readPackage(root, dir, `$.checks[${index}].cwd`));
    const pkg = packages.get(dir);
    const present = Object.hasOwn(pkg.scripts, parsed.scriptName);
    const script = present ? pkg.scripts[parsed.scriptName] : null;
    if (present && (typeof script !== 'string' || !script.trim())) fail('script_invalid', `$.checks[${index}].argv`);
    const lifecycleHooksPresent = present && [`pre${parsed.scriptName}`, `post${parsed.scriptName}`]
      .some(name => Object.hasOwn(pkg.scripts, name));
    return { checkId: parsed.id, failedTestId: parsed.failedTestId,
      packageDir: dir === '.' ? '.' : dir.replaceAll('\\', '/'), scriptName: parsed.scriptName,
      commandDigest: parsed.commandDigest, packageDigest: pkg.packageDigest,
      scriptDigest: present ? hash(script) : null,
      lifecycleHooksPresent,
      status: present ? 'named-script-present' : 'script-missing', executionStatus: 'not-run' };
  });
  return { schema: OUTPUT_SCHEMA, advisoryOnly: true, executed: false,
    allNamedScriptsPresent: results.every(result => result.status === 'named-script-present'),
    runnerSelectorVerified: false, coverageVerified: false, finalGatePassed: false, evidenceReusable: false,
    results };
}

module.exports = { INPUT_SCHEMA, OUTPUT_SCHEMA, TestScriptInputError, probeNpmScripts };
