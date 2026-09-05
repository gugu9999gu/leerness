'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'leerness.js');
const roleStore = require('../lib/role-store');
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-role-store-'));
let total = 0;
let failed = 0;

function check(name, condition, detail = '') {
  total++;
  if (condition) process.stdout.write(`✓ ${name}\n`);
  else {
    failed++;
    process.stderr.write(`✗ ${name}${detail ? ` — ${detail}` : ''}\n`);
  }
}

function hasOwn(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

function makeProject(name) {
  const root = path.join(TEMP, name);
  fs.mkdirSync(path.join(root, '.leerness'), { recursive: true });
  return root;
}

function storePath(root) {
  return path.join(root, '.leerness', 'agent-roles.json');
}

function writeStore(root, value) {
  fs.writeFileSync(storePath(root), Buffer.isBuffer(value) ? value : String(value));
}

function readStore(root) {
  return fs.readFileSync(storePath(root));
}

function sha(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function snapshot(root) {
  const rows = [];
  function walk(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) rows.push([rel, 'link', fs.readlinkSync(full)]);
      else if (entry.isDirectory()) { rows.push([rel, 'dir']); walk(full, rel); }
      else rows.push([rel, 'file', stat.size, sha(fs.readFileSync(full))]);
    }
  }
  walk(root, '');
  return JSON.stringify(rows);
}

function baseEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^LEERNESS_ENABLE_/i.test(key)) delete env[key];
  }
  for (const key of [
    'LEERNESS_INTERNAL', 'LEERNESS_SESSION_ID', 'LEERNESS_MCP_CONNECTION_ID', 'CODEX_THREAD_ID', 'CLAUDE_SESSION_ID',
    'CURSOR_SESSION_ID', 'LEERNESS_PARENT_AGENT', 'LEERNESS_CHILD_AGENT',
  ]) delete env[key];
  Object.assign(env, {
    LEERNESS_NO_BANNER: '1',
    LEERNESS_NO_STALE_CHECK: '1',
    LEERNESS_NO_AUTO_WORKSPACE_MIGRATION: '1',
    NO_COLOR: '1',
  }, extra);
  return env;
}

function run(root, args, envExtra = {}, timeout = 60000) {
  return cp.spawnSync(process.execPath, [CLI, ...args, '--path', root], {
    cwd: root,
    encoding: 'utf8',
    timeout,
    env: baseEnv(envExtra),
  });
}

function jsonOf(result) {
  try { return JSON.parse(result.stdout); }
  catch { return null; }
}

function writePortableCliShim(dir, name, source) {
  const body = `'use strict';\n${source}\n`;
  if (process.platform === 'win32') {
    const entry = path.join(dir, `${name}-shim-entry.js`);
    const shim = path.join(dir, `${name}.cmd`);
    fs.writeFileSync(entry, body);
    fs.writeFileSync(shim, [
      '@ECHO off',
      'SET "_prog=node"',
      `"%_prog%" "%dp0%\\${path.basename(entry)}" %*`,
    ].join('\r\n') + '\r\n');
    return shim;
  }
  const shim = path.join(dir, name);
  fs.writeFileSync(shim, `#!/usr/bin/env node\n${source}\n`);
  fs.chmodSync(shim, 0o755);
  return shim;
}

function providerFixture(root) {
  const bin = path.join(root, 'fake-bin');
  const marker = path.join(root, 'provider-runs.log');
  fs.mkdirSync(bin, { recursive: true });
  writePortableCliShim(bin, 'codex', [
    "const fs = require('fs');",
    `fs.appendFileSync(${JSON.stringify(marker)}, 'run\\n');`,
    "console.log('codex-probe 1.0.0');",
  ].join('\n'));
  return {
    marker,
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      LEERNESS_ENABLE_CODEX: '1',
    },
  };
}

function assertMachineFailure(result, code, state) {
  const parsed = jsonOf(result);
  return result.status === 1
    && parsed && parsed.ok === false
    && parsed.code === code
    && parsed.state === state
    && parsed.file === '.leerness/agent-roles.json'
    && parsed.originalPreserved === true
    && parsed.providerCommandsExecuted === false
    && Array.isArray(parsed.problems)
    && !/RoleStoreError|at .*leerness\.js/i.test(String(result.stderr || ''));
}

try {
  const missing = makeProject('missing');
  const beforeMissing = snapshot(missing);
  const missingValidate = run(missing, ['roles', 'validate', '--json']);
  const missingJson = jsonOf(missingValidate);
  const afterMissing = snapshot(missing);
  check('roles validate treats an absent legacy store as an explicit empty configuration',
    missingValidate.status === 0 && missingJson && missingJson.ok === true
      && missingJson.state === 'missing' && missingJson.fileExists === false
      && missingJson.legacy.roleCount === 0 && missingJson.readOnly === true
      && missingJson.writesPerformed === false && missingJson.providerCommandsExecuted === false);
  check('roles validate is byte-for-byte observation-only and does not create the store',
    beforeMissing === afterMissing && !fs.existsSync(storePath(missing)));
  const missingList = run(missing, ['roles', 'list', '--json']);
  const missingListJson = jsonOf(missingList);
  check('legacy roles list compatibility remains an empty object when the store is absent',
    missingList.status === 0 && missingListJson && missingListJson.count === 0
      && JSON.stringify(missingListJson.roles) === '{}');

  const valid = makeProject('valid');
  const validDocument = {
    schemaVersion: 1,
    updatedAt: '2026-09-03T00:00:00.000Z',
    futureTopLevel: { keep: true },
    roles: {
      coder: {
        provider: 'codex',
        model: 'old-model',
        persona: 'old persona',
        primary: { provider: 'codex', model: 'old-model', modelFamily: null, extension: 'keep-primary' },
        candidates: [{ provider: 'codex', model: 'fallback-model', modelFamily: null, extension: 'keep-candidate' }],
        futureRoleField: { keep: true },
      },
    },
  };
  writeStore(valid, JSON.stringify(validDocument, null, 2) + '\n');
  const validBefore = readStore(valid);
  const validValidate = run(valid, ['roles', 'validate', '--json']);
  const validJson = jsonOf(validValidate);
  check('valid stores expose a versioned read-only preview projection without runtime or provider readiness claims',
    validValidate.status === 0 && validJson
      && validJson.schemaVersion === 1 && validJson.observation === 'role-store-validation'
      && validJson.state === 'valid'
      && validJson.legacy.roleCount === 1 && validJson.legacy.unknownFieldCount === 4
      && validJson.projection.agentCount === 1
      && validJson.projection.readinessScope === 'configured-enabled-agent-assignments-only'
      && validJson.projection.providerReadinessChecked === false
      && validJson.projection.previewOnly === true
      && validJson.projection.runtimeWiringApplied === false
      && validJson.nativeV2Validation.performed === false
      && validJson.nativeV2Validation.reason === 'legacy-projection-preview-only'
      && validJson.nativeV2Validation.files.length === 3
      && validJson.migrationApplied === false);
  check('valid validation preserves the exact legacy bytes', readStore(valid).equals(validBefore));
  const englishValidate = run(valid, ['roles', 'validate', '--language', 'en']);
  const koreanValidate = run(valid, ['roles', 'validate', '--language', 'ko']);
  check('roles validate human output is localized without adding English-mode Hangul',
    englishValidate.status === 0
      && /v2 preview projection/.test(englishValidate.stdout)
      && /did not migrate files or enable v2 runtime routing/.test(englishValidate.stdout)
      && /Native role-definitions\/agent-instances\/routing-policy files were not read/.test(englishValidate.stdout)
      && !/[가-힣]/.test(englishValidate.stdout)
      && koreanValidate.status === 0
      && /v2 미리보기 projection/.test(koreanValidate.stdout)
      && /마이그레이션하거나/.test(koreanValidate.stdout)
      && /native role-definitions\/agent-instances\/routing-policy 파일은 읽지 않았으며/.test(koreanValidate.stdout));
  const englishAliasValidate = run(valid, ['role', 'validate', '--language', 'en', '--json']);
  check('singular role validate alias preserves the canonical JSON projection contract',
    englishAliasValidate.status === 0
      && JSON.stringify(jsonOf(englishAliasValidate)) === JSON.stringify(validJson));
  const validList = run(valid, ['roles', 'list', '--json']);
  const validListJson = jsonOf(validList);
  check('valid roles list preserves the existing JSON contract',
    validList.status === 0 && validListJson && validListJson.count === 1
      && validListJson.roles.coder.provider === 'codex'
      && validListJson.roles.coder.futureRoleField.keep === true);

  const previousRelease = makeProject('previous-release-schema-v2');
  writeStore(previousRelease, JSON.stringify({
    schemaVersion: 2,
    roles: {
      coder: { provider: 'OpenAI', model: 'gpt-5', persona: 'compatibility fixture' },
    },
  }, null, 2) + '\n');
  const previousReleaseValidate = run(previousRelease, ['roles', 'validate', '--json']);
  const previousReleaseJson = jsonOf(previousReleaseValidate);
  const previousReleaseList = run(previousRelease, ['roles', 'list', '--json']);
  const previousReleaseListJson = jsonOf(previousReleaseList);
  check('the loader accepts schema v2 stores emitted by the previous release',
    previousReleaseValidate.status === 0 && previousReleaseJson
      && previousReleaseJson.state === 'valid'
      && previousReleaseJson.legacy.schemaVersion === 2
      && previousReleaseJson.legacy.roleCount === 1);
  check('registered provider names remain case-preserving through the actual CLI loader',
    previousReleaseList.status === 0 && previousReleaseListJson
      && previousReleaseListJson.roles.coder.provider === 'OpenAI'
      && previousReleaseListJson.roles.coder.model === 'gpt-5');

  const setResult = run(valid, [
    'roles', 'set', 'coder', '--provider', 'codex', '--model', 'new-model',
    '--persona', 'new persona', '--json',
  ]);
  const afterSet = JSON.parse(readStore(valid).toString('utf8'));
  check('roles set remains functional for a valid store',
    setResult.status === 0 && afterSet.roles.coder.provider === 'codex'
      && afterSet.roles.coder.model === 'new-model'
      && afterSet.roles.coder.persona === 'new persona');
  check('roles set preserves unknown top-level and per-role fields',
    afterSet.futureTopLevel.keep === true && afterSet.roles.coder.futureRoleField.keep === true);
  check('roles set preserves accepted unknown fields inside primary and matching candidates',
    afterSet.roles.coder.primary.extension === 'keep-primary'
      && afterSet.roles.coder.candidates[0].extension === 'keep-candidate');

  const suggestFixture = providerFixture(valid);
  const suggestResult = run(valid, ['roles', 'suggest', '--apply', '--json'], suggestFixture.env);
  const afterSuggest = JSON.parse(readStore(valid).toString('utf8'));
  check('roles suggest --apply preserves accepted unknown fields inside primary',
    suggestResult.status === 0
      && afterSuggest.roles.coder.primary.extension === 'keep-primary',
    suggestResult.stderr || suggestResult.stdout);

  const protoSet = run(valid, [
    'roles', 'set', '__proto__', '--provider', 'codex', '--model', 'proto-model',
    '--persona', 'proto persona', '--force', '--json',
  ]);
  const afterProto = JSON.parse(readStore(valid).toString('utf8'));
  check('forced __proto__ role keys remain own JSON data without prototype pollution',
    protoSet.status === 0
      && hasOwn(afterProto.roles, '__proto__')
      && afterProto.roles.__proto__.provider === 'codex'
      && ({}).provider === undefined);
  const protoHuman = run(valid, [
    'roles', 'set', '__proto__', '--provider', 'codex', '--model', 'proto-human',
    '--persona', 'proto human', '--force',
  ]);
  check('human forced custom-role output stays explicit and prototype-safe',
    protoHuman.status === 0
      && /custom/.test(protoHuman.stdout)
      && !/undefined/.test(protoHuman.stdout)
      && ({}).provider === undefined);

  const invalidBase = makeProject('invalid-base-direct');
  let invalidBaseError = null;
  try {
    roleStore.saveRoles(
      invalidBase,
      { coder: { provider: 'codex', model: null, persona: '' } },
      { schemaVersion: 99, roles: {} },
    );
  } catch (error) { invalidBaseError = error; }
  check('direct save rejects an invalid supplied base document before creating a file',
    invalidBaseError instanceof roleStore.RoleStoreError
      && invalidBaseError.code === 'store_invalid'
      && invalidBaseError.roleStoreState.state === 'validated-state-required'
      && !fs.existsSync(storePath(invalidBase)));

  const rawWriterCorrupt = makeProject('raw-writer-corrupt');
  writeStore(rawWriterCorrupt, '{ broken source\n');
  const rawWriterBefore = readStore(rawWriterCorrupt);
  let rawWriterError = null;
  try {
    roleStore.saveRoles(rawWriterCorrupt, { coder: { provider: 'codex' } });
  } catch (error) { rawWriterError = error; }
  check('exported role writer cannot bypass the fail-closed loader or replace corrupt bytes',
    rawWriterError instanceof roleStore.RoleStoreError
      && rawWriterError.roleStoreState.state === 'validated-state-required'
      && readStore(rawWriterCorrupt).equals(rawWriterBefore));

  const strictFlags = makeProject('strict-validate-flags');
  const strictBefore = snapshot(strictFlags);
  const validateApply = run(strictFlags, ['roles', 'validate', '--apply', '--json']);
  const validateProvider = run(strictFlags, ['role', 'validate', '--provider', 'codex', '--json']);
  const validateApplyJson = jsonOf(validateApply);
  const validateProviderJson = jsonOf(validateProvider);
  check('roles validate rejects foreign mutation and provider flags before any write',
    validateApply.status === 1 && validateProvider.status === 1
      && validateApplyJson && validateApplyJson.ok === false && validateApplyJson.code === 'unknown_flag'
      && validateProviderJson && validateProviderJson.ok === false && validateProviderJson.code === 'unknown_flag'
      && snapshot(strictFlags) === strictBefore
      && !fs.existsSync(storePath(strictFlags)));

  const unsetResult = run(valid, ['roles', 'unset', 'coder', '--json']);
  const afterUnset = JSON.parse(readStore(valid).toString('utf8'));
  check('roles unset remains functional and preserves unrelated data',
    unsetResult.status === 0 && !hasOwn(afterUnset.roles, 'coder')
      && hasOwn(afterUnset.roles, '__proto__') && afterUnset.futureTopLevel.keep === true);

  const fake = providerFixture(TEMP);
  const validDispatch = makeProject('valid-dispatch');
  writeStore(validDispatch, JSON.stringify({ schemaVersion: 1, roles: { coder: { provider: 'codex', model: null, persona: '' } } }, null, 2) + '\n');
  const dispatchResult = run(validDispatch, ['agents', 'dispatch', '--task', 'inspect one file', '--role', 'coder', '--json'], fake.env);
  check('valid role-based dispatch still reaches provider readiness checking',
    dispatchResult.status === 0 && fs.existsSync(fake.marker) && fs.readFileSync(fake.marker, 'utf8').includes('run'));
  fs.rmSync(fake.marker, { force: true });
  const unsafeBuiltinTasks = [
    'close"; Write-Output injected; #',
    `SAFE${String.fromCodePoint(0x201d)}; Write-Output injected; #`,
  ];
  const unsafeBuiltinResults = unsafeBuiltinTasks.map(task => run(
    validDispatch,
    ['agents', 'dispatch', task, '--to', 'codex', '--raw', '--json'],
    fake.env,
  ));
  check('built-in dispatch also refuses ASCII and PowerShell smart-quote command-boundary escapes',
    unsafeBuiltinResults.every(result => result.status === 1
      && jsonOf(result)?.code === 'provider_dispatch_task_unsafe'
      && !jsonOf(result)?.command),
    unsafeBuiltinResults.map(result => `${result.status}:${result.stdout}:${result.stderr}`).join(' | '));

  const legacyLongProvider = `p${'a'.repeat(129)}`;
  const legacyLongRoot = makeProject('legacy-long-provider');
  const legacyLongBin = path.join(legacyLongRoot, 'fake-bin');
  fs.mkdirSync(legacyLongBin);
  writePortableCliShim(legacyLongBin, 'legacy-provider-cli', "console.log('legacy-provider 1.0.0');");
  fs.writeFileSync(path.join(legacyLongRoot, '.leerness', 'providers.json'), JSON.stringify({
    schemaVersion: 1,
    providers: [{
      id: legacyLongProvider,
      bin: 'legacy-provider-cli',
      envFlag: 'LEERNESS_ENABLE_LEGACY_LONG',
      versionArgs: ['--version'],
      desc: 'previous-release long provider',
    }],
  }, null, 2) + '\n');
  writeStore(legacyLongRoot, JSON.stringify({
    schemaVersion: 1,
    roles: { coder: { provider: legacyLongProvider, model: null, persona: '' } },
  }, null, 2) + '\n');
  const legacyLongList = run(legacyLongRoot, ['roles', 'list', '--json']);
  const legacyLongJson = jsonOf(legacyLongList);
  const legacyLongResolve = run(legacyLongRoot, ['agents', 'resolve', 'inspect', '--role', 'coder', '--json'], {
    PATH: `${legacyLongBin}${path.delimiter}${process.env.PATH || ''}`,
    LEERNESS_ENABLE_LEGACY_LONG: '1',
  });
  const legacyLongResolved = jsonOf(legacyLongResolve);
  const legacyLongDispatch = run(legacyLongRoot, ['agents', 'dispatch', 'inspect one file', '--role', 'coder', '--json'], {
    PATH: `${legacyLongBin}${path.delimiter}${process.env.PATH || ''}`,
    LEERNESS_ENABLE_LEGACY_LONG: '1',
  });
  const legacyLongDispatched = jsonOf(legacyLongDispatch);
  const legacyLongHistory = run(legacyLongRoot, ['agents', 'history', '--limit', '20', '--json']);
  const legacyLongEvents = jsonOf(legacyLongHistory)?.events || [];
  const legacyLongPrepared = legacyLongEvents.find(event => event.eventId === legacyLongDispatched?.auditEventId);
  check('previous-release long provider IDs remain configured, registered, dispatchable, and lossless in provenance',
    legacyLongList.status === 0
      && legacyLongJson?.configurations?.[0]?.provider === legacyLongProvider
      && legacyLongResolve.status === 0
      && legacyLongResolved?.resolution?.primary?.provider === legacyLongProvider
      && legacyLongResolved?.resolution?.primary?.availability?.eligible === true
      && legacyLongResolved?.resolution?.decision?.primaryReady === true
      && legacyLongDispatch.status === 0
      && legacyLongDispatched?.action === 'dispatch-prepared'
      && legacyLongDispatched?.target === legacyLongProvider
      && /^legacy-provider-cli\s/.test(legacyLongDispatched?.command || '')
      && legacyLongPrepared?.actualExecutor?.provider === legacyLongProvider
      && legacyLongPrepared?.requestedExecutor?.provider === legacyLongProvider,
    `list=${legacyLongList.stdout} resolve=${legacyLongResolve.stdout} dispatch=${legacyLongDispatch.stdout} history=${legacyLongHistory.stdout} stderr=${legacyLongDispatch.stderr}`);

  const injectionMarker = path.join(legacyLongRoot, 'generic-dispatch-injection-marker.txt');
  const unsafeGenericTasks = [
    `$(Set-Content -LiteralPath ${injectionMarker} -Value injected)`,
    '`Set-Content generic-dispatch-injection-marker.txt injected`',
    'close"; Set-Content generic-dispatch-injection-marker.txt injected; #',
    `SAFE${String.fromCodePoint(0x201c)}; Set-Content generic-dispatch-injection-marker.txt injected; #`,
    `SAFE${String.fromCodePoint(0x201d)}; Set-Content generic-dispatch-injection-marker.txt injected; #`,
    `SAFE${String.fromCodePoint(0xff02)}; Set-Content generic-dispatch-injection-marker.txt injected; #`,
    `SAFE${String.fromCodePoint(0xff04)}(Set-Content generic-dispatch-injection-marker.txt injected)`,
  ];
  const unsafeGenericResults = unsafeGenericTasks.map(task => run(
    legacyLongRoot,
    ['agents', 'dispatch', task, '--to', legacyLongProvider, '--raw', '--json'],
    {
      PATH: `${legacyLongBin}${path.delimiter}${process.env.PATH || ''}`,
      LEERNESS_ENABLE_LEGACY_LONG: '1',
    },
  ));
  check('registry-only dispatch fails closed for shell metacharacters instead of emitting an executable-looking command',
    unsafeGenericResults.every(result => result.status === 1
      && jsonOf(result)?.code === 'provider_dispatch_task_unsafe'
      && !jsonOf(result)?.command)
      && !fs.existsSync(injectionMarker),
    unsafeGenericResults.map(result => `${result.status}:${result.stdout}:${result.stderr}`).join(' | '));

  const singleSnapshotRoot = makeProject('single-snapshot-list');
  writeStore(singleSnapshotRoot, JSON.stringify({
    schemaVersion: 1,
    roles: {
      coder: { provider: 'codex', model: 'gpt-5' },
      reviewer: { provider: 'codex', model: 'gpt-5-review' },
    },
  }, null, 2) + '\n');
  const harness = require('../bin/leerness');
  const originalReadRoleStore = roleStore.readRoleStore;
  const originalArgv = process.argv;
  const originalConsoleLog = console.log;
  let roleStoreReads = 0;
  try {
    roleStore.readRoleStore = (...args) => { roleStoreReads++; return originalReadRoleStore(...args); };
    process.argv = [process.execPath, CLI, 'roles', 'list', '--path', singleSnapshotRoot, '--json'];
    console.log = () => {};
    harness.rolesCmd(singleSnapshotRoot, 'list');
  } finally {
    roleStore.readRoleStore = originalReadRoleStore;
    process.argv = originalArgv;
    console.log = originalConsoleLog;
  }
  check('roles list resolves every role from one validated store snapshot', roleStoreReads === 1,
    `readRoleStore calls=${roleStoreReads}`);

  const invalidCases = [
    {
      name: 'corrupt-json',
      raw: '{ "roles": { "coder": { "provider": "codex", "marker": "DO_NOT_ECHO_VALUE" }',
      code: 'store_corrupt', state: 'invalid-json', problem: 'invalid-json',
    },
    { name: 'empty', raw: '', code: 'store_invalid', state: 'empty-document', problem: 'empty-document' },
    { name: 'bom-only', raw: Buffer.from([0xef, 0xbb, 0xbf]), code: 'store_invalid', state: 'empty-document', problem: 'empty-document' },
    { name: 'invalid-utf8', raw: Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0x80, 0x22, 0x7d]), code: 'store_invalid', state: 'invalid-utf8', problem: 'invalid-utf8' },
    { name: 'future-schema', raw: JSON.stringify({ schemaVersion: 99, roles: {} }), code: 'store_invalid', state: 'invalid', problem: 'unsupported-schema-version' },
    { name: 'missing-roles', raw: JSON.stringify({ schemaVersion: 1 }), code: 'store_invalid', state: 'invalid', problem: 'roles-missing' },
    { name: 'roles-array', raw: JSON.stringify({ schemaVersion: 1, roles: [] }), code: 'store_invalid', state: 'invalid', problem: 'roles-not-object' },
    { name: 'bad-provider', raw: JSON.stringify({ schemaVersion: 1, roles: { coder: { provider: 'bad provider' } } }), code: 'store_invalid', state: 'invalid', problem: 'invalid-legacy-provider' },
  ];

  const guardedCommands = [
    ['roles', 'validate', '--json'],
    ['roles', 'list', '--json'],
    ['roles', 'set', 'coder', '--provider', 'codex', '--model', 'x', '--json'],
    ['roles', 'unset', 'coder', '--json'],
    ['roles', 'verify', '--json'],
    ['roles', 'suggest', '--apply', '--json'],
    ['agents', 'dispatch', '--task', 'inspect', '--role', 'coder', '--json'],
    ['agents', 'route', 'small typo', '--json'],
  ];

  for (const item of invalidCases) {
    const root = makeProject(`invalid-${item.name}`);
    writeStore(root, item.raw);
    const original = readStore(root);
    let allFailedClosed = true;
    let allCodes = true;
    for (const command of guardedCommands) {
      fs.rmSync(fake.marker, { force: true });
      const result = run(root, command, fake.env);
      const parsed = jsonOf(result);
      allFailedClosed = allFailedClosed && assertMachineFailure(result, item.code, item.state);
      allCodes = allCodes && parsed && parsed.problems.some(problem => problem.code === item.problem);
      allFailedClosed = allFailedClosed && readStore(root).equals(original) && !fs.existsSync(fake.marker);
    }
    check(`${item.name}: every role read/write/dispatch/route path fails closed before provider execution`, allFailedClosed);
    check(`${item.name}: machine diagnostics preserve the specific structural reason`, allCodes);
    check(`${item.name}: the original store remains byte-exact with no rescue overwrite`,
      readStore(root).equals(original)
        && !fs.readdirSync(path.join(root, '.leerness')).some(name => name.startsWith('agent-roles.json.corrupt-')));
    if (item.name === 'corrupt-json') {
      const output = guardedCommands.map(command => run(root, command, fake.env).stdout).join('\n');
      check('corrupt JSON diagnostics do not echo malformed source values', !output.includes('DO_NOT_ECHO_VALUE'));
    }
  }

  const oversized = makeProject('oversized');
  writeStore(oversized, JSON.stringify({ schemaVersion: 1, padding: 'x'.repeat(1024 * 1024), roles: {} }));
  const oversizedBefore = readStore(oversized);
  const oversizedResult = run(oversized, ['roles', 'validate', '--json']);
  const oversizedJson = jsonOf(oversizedResult);
  check('oversized stores fail before parsing with a bounded versioned machine reason',
    assertMachineFailure(oversizedResult, 'store_invalid', 'too-large')
      && oversizedJson.schemaVersion === 1
      && oversizedJson.observation === 'role-store-validation'
      && oversizedJson.problems.some(problem => problem.code === 'store-too-large'));
  check('oversized store bytes remain exact', readStore(oversized).equals(oversizedBefore));

  const nearLimit = makeProject('near-limit-write');
  const nearLimitDocument = {
    schemaVersion: 1,
    roles: { coder: { provider: 'codex', model: null, persona: '' } },
    futurePadding: '',
  };
  const nearLimitShell = JSON.stringify(nearLimitDocument) + '\n';
  nearLimitDocument.futurePadding = 'x'.repeat(
    roleStore.MAX_STORE_BYTES - 1 - Buffer.byteLength(nearLimitShell, 'utf8'),
  );
  const nearLimitBytes = Buffer.from(JSON.stringify(nearLimitDocument) + '\n');
  writeStore(nearLimit, nearLimitBytes);
  const nearLimitStateBefore = roleStore.readRoleStore(nearLimit);
  let nearLimitError = null;
  try {
    roleStore.updateRoles(nearLimit, () => undefined, (_target, fn) => fn());
  } catch (error) { nearLimitError = error; }
  const nearLimitStateAfter = roleStore.readRoleStore(nearLimit);
  check('role writes reject serialized output beyond the byte limit before replacing the valid source',
    nearLimitBytes.length === roleStore.MAX_STORE_BYTES - 1
      && nearLimitStateBefore.ok === true
      && nearLimitError instanceof roleStore.RoleStoreError
      && nearLimitError.code === 'store_invalid'
      && nearLimitError.roleStoreState.state === 'write-too-large'
      && nearLimitError.roleStoreState.bytes > roleStore.MAX_STORE_BYTES
      && nearLimitError.roleStoreState.maxBytes === roleStore.MAX_STORE_BYTES
      && readStore(nearLimit).equals(nearLimitBytes)
      && nearLimitStateAfter.ok === true,
    JSON.stringify({ nearLimitStateBefore, nearLimitError, nearLimitStateAfter }, Object.getOwnPropertyNames(nearLimitError || {})));

  const longProviderRoot = makeProject('long-legacy-provider');
  const longProvider = `provider-${'x'.repeat(121)}`;
  writeStore(longProviderRoot, JSON.stringify({
    schemaVersion: 1,
    roles: { coder: { provider: longProvider, model: null, persona: 'legacy compatibility' } },
  }, null, 2) + '\n');
  const longProviderState = roleStore.readRoleStore(longProviderRoot);
  check('legacy provider IDs beyond native v2 limits remain readable instead of bricking the store',
    longProviderState.ok === true && longProviderState.roles.coder.provider === longProvider,
    JSON.stringify(longProviderState));

  const createCleanupRoot = makeProject('create-alias-cleanup-failure');
  const createCleanupState = roleStore.readRoleStore(createCleanupRoot);
  const originalCreateUnlink = fs.unlinkSync;
  const originalCreateRm = fs.rmSync;
  let createCleanupInjected = false;
  let createCleanupError = null;
  const isCreateAlias = target => path.dirname(String(target)) === path.join(createCleanupRoot, '.leerness')
    && path.basename(String(target)).startsWith('.agent-roles-create-')
    && !String(target).includes('.detach-');
  try {
    fs.unlinkSync = function blockedCreateAliasUnlink(target, ...args) {
      if (isCreateAlias(target)) {
        createCleanupInjected = true;
        throw Object.assign(new Error('injected create-alias unlink failure'), { code: 'EACCES' });
      }
      return originalCreateUnlink.call(fs, target, ...args);
    };
    fs.rmSync = function blockedCreateAliasRm(target, ...args) {
      if (process.platform !== 'win32' && isCreateAlias(target)) {
        throw Object.assign(new Error('injected create-alias rm failure'), { code: 'EACCES' });
      }
      return originalCreateRm.call(fs, target, ...args);
    };
    roleStore.saveRoles(createCleanupRoot, { coder: { provider: 'codex' } }, createCleanupState);
  } catch (error) { createCleanupError = error; }
  finally {
    fs.unlinkSync = originalCreateUnlink;
    fs.rmSync = originalCreateRm;
  }
  const createCleanupRead = roleStore.readRoleStore(createCleanupRoot);
  check('new role-store installation survives prepared-alias cleanup failure without poisoning the live inode',
    createCleanupInjected && !createCleanupError && createCleanupRead.ok === true
      && createCleanupRead.roles.coder.provider === 'codex'
      && Number(fs.lstatSync(storePath(createCleanupRoot)).nlink) === 1,
    JSON.stringify({ createCleanupInjected, createCleanupError: createCleanupError && createCleanupError.message, createCleanupRead }));

  const createRollbackRoot = makeProject('create-alias-detach-total-failure');
  const createRollbackState = roleStore.readRoleStore(createRollbackRoot);
  const originalRollbackUnlink = fs.unlinkSync;
  const originalRollbackRm = fs.rmSync;
  const originalRollbackRename = fs.renameSync;
  let createRollbackInjected = false;
  let createRollbackError = null;
  const isRollbackAlias = target => path.dirname(String(target)) === path.join(createRollbackRoot, '.leerness')
    && path.basename(String(target)).startsWith('.agent-roles-create-')
    && !String(target).includes('.detach-');
  try {
    fs.unlinkSync = function blockedRollbackAliasUnlink(target, ...args) {
      if (isRollbackAlias(target)) throw Object.assign(new Error('injected create rollback unlink failure'), { code: 'EACCES' });
      return originalRollbackUnlink.call(fs, target, ...args);
    };
    fs.rmSync = function blockedRollbackAliasRm(target, ...args) {
      if (isRollbackAlias(target)) throw Object.assign(new Error('injected create rollback rm failure'), { code: 'EACCES' });
      return originalRollbackRm.call(fs, target, ...args);
    };
    fs.renameSync = function blockedRollbackAliasRename(from, to, ...args) {
      if (String(from).includes('.detach-') && isRollbackAlias(to)) {
        createRollbackInjected = true;
        throw Object.assign(new Error('injected create rollback rename failure'), { code: 'EACCES' });
      }
      return originalRollbackRename.call(fs, from, to, ...args);
    };
    roleStore.saveRoles(createRollbackRoot, { coder: { provider: 'codex' } }, createRollbackState);
  } catch (error) { createRollbackError = error; }
  finally {
    fs.unlinkSync = originalRollbackUnlink;
    fs.rmSync = originalRollbackRm;
    fs.renameSync = originalRollbackRename;
  }
  const createRollbackArtifacts = fs.readdirSync(path.join(createRollbackRoot, '.leerness'))
    .map(name => path.join(createRollbackRoot, '.leerness', name))
    .filter(file => fs.lstatSync(file).isFile());
  check('new role-store install rolls back the canonical path when every alias detach method fails',
    createRollbackInjected
      && createRollbackError instanceof roleStore.RoleStoreError
      && !fs.existsSync(storePath(createRollbackRoot))
      && createRollbackArtifacts.every(file => Number(fs.lstatSync(file).nlink) === 1),
    JSON.stringify({ createRollbackInjected, error: createRollbackError && createRollbackError.roleStoreState, artifacts: createRollbackArtifacts }));

  let posixCleanupVerified = process.platform === 'win32';
  let posixCleanupDetail = 'not applicable on win32';
  if (process.platform !== 'win32') {
    const posixCleanupRoot = makeProject('posix-cas-alias-cleanup-failure');
    writeStore(posixCleanupRoot, JSON.stringify({ schemaVersion: 1, roles: { coder: { provider: 'codex' } } }) + '\n');
    const posixCleanupState = roleStore.readRoleStore(posixCleanupRoot);
    const originalPosixUnlink = fs.unlinkSync;
    const originalPosixRm = fs.rmSync;
    let posixCleanupInjected = false;
    let posixCleanupError = null;
    const isPosixNextAlias = target => path.basename(String(target)) === 'next'
      && path.basename(path.dirname(String(target))).startsWith('.agent-roles-cas-');
    try {
      fs.unlinkSync = function blockedPosixAliasUnlink(target, ...args) {
        if (isPosixNextAlias(target)) {
          posixCleanupInjected = true;
          throw Object.assign(new Error('injected POSIX alias unlink failure'), { code: 'EACCES' });
        }
        return originalPosixUnlink.call(fs, target, ...args);
      };
      fs.rmSync = function blockedPosixAliasRm(target, ...args) {
        if (isPosixNextAlias(target)) throw Object.assign(new Error('injected POSIX alias rm failure'), { code: 'EACCES' });
        return originalPosixRm.call(fs, target, ...args);
      };
      roleStore.saveRoles(posixCleanupRoot, { coder: { provider: 'new-provider' } }, posixCleanupState);
    } catch (error) { posixCleanupError = error; }
    finally {
      fs.unlinkSync = originalPosixUnlink;
      fs.rmSync = originalPosixRm;
    }
    const posixCleanupRead = roleStore.readRoleStore(posixCleanupRoot);
    posixCleanupVerified = posixCleanupInjected && !posixCleanupError && posixCleanupRead.ok === true
      && posixCleanupRead.roles.coder.provider === 'new-provider'
      && Number(fs.lstatSync(storePath(posixCleanupRoot)).nlink) === 1;
    posixCleanupDetail = JSON.stringify({ posixCleanupInjected, posixCleanupError: posixCleanupError && posixCleanupError.message, posixCleanupRead });
  }
  check('POSIX role-store replacement survives both alias cleanup calls failing after commit',
    posixCleanupVerified, posixCleanupDetail);

  let posixRollbackVerified = process.platform === 'win32';
  let posixRollbackDetail = 'not applicable on win32';
  if (process.platform !== 'win32') {
    const posixRollbackRoot = makeProject('posix-cas-alias-detach-total-failure');
    writeStore(posixRollbackRoot, JSON.stringify({ schemaVersion: 1, roles: { coder: { provider: 'codex' } } }) + '\n');
    const posixRollbackState = roleStore.readRoleStore(posixRollbackRoot);
    const originalUnlink = fs.unlinkSync;
    const originalRm = fs.rmSync;
    const originalRename = fs.renameSync;
    let renameFailureInjected = false;
    let rollbackError = null;
    const isNextAlias = target => path.basename(String(target)) === 'next'
      && path.basename(path.dirname(String(target))).startsWith('.agent-roles-cas-');
    try {
      fs.unlinkSync = function blockedNextUnlink(target, ...args) {
        if (isNextAlias(target)) throw Object.assign(new Error('injected next unlink failure'), { code: 'EACCES' });
        return originalUnlink.call(fs, target, ...args);
      };
      fs.rmSync = function blockedNextRm(target, ...args) {
        if (isNextAlias(target)) throw Object.assign(new Error('injected next rm failure'), { code: 'EACCES' });
        return originalRm.call(fs, target, ...args);
      };
      fs.renameSync = function blockedNextDetachRename(from, to, ...args) {
        if (String(from).includes('.detach-') && isNextAlias(to)) {
          renameFailureInjected = true;
          throw Object.assign(new Error('injected next detach rename failure'), { code: 'EACCES' });
        }
        return originalRename.call(fs, from, to, ...args);
      };
      roleStore.saveRoles(posixRollbackRoot, { coder: { provider: 'new-provider' } }, posixRollbackState);
    } catch (error) { rollbackError = error; }
    finally {
      fs.unlinkSync = originalUnlink;
      fs.rmSync = originalRm;
      fs.renameSync = originalRename;
    }
    const restored = roleStore.readRoleStore(posixRollbackRoot);
    posixRollbackVerified = renameFailureInjected
      && rollbackError instanceof roleStore.RoleStoreError
      && restored.ok === true
      && restored.roles.coder.provider === 'codex'
      && Number(fs.lstatSync(storePath(posixRollbackRoot)).nlink) === 1;
    posixRollbackDetail = JSON.stringify({ renameFailureInjected, error: rollbackError && rollbackError.roleStoreState, restored });
  }
  check('POSIX role-store replacement restores the predecessor when every alias detach method fails',
    posixRollbackVerified, posixRollbackDetail);

  const readSwapRoot = makeProject('read-swap-hardlink');
  const readSwapFile = storePath(readSwapRoot);
  const readSwapPeer = path.join(readSwapRoot, 'peer.json');
  writeStore(readSwapRoot, JSON.stringify({ schemaVersion: 1, roles: { coder: { provider: 'codex' } } }) + '\n');
  fs.writeFileSync(readSwapPeer, JSON.stringify({ schemaVersion: 1, roles: { coder: { provider: 'external-provider' } } }) + '\n');
  const originalOpenSync = fs.openSync;
  let readSwapInjected = false;
  try {
    fs.openSync = function patchedOpen(target, ...rest) {
      if (!readSwapInjected && target === readSwapFile) {
        readSwapInjected = true;
        fs.unlinkSync(readSwapFile);
        fs.linkSync(readSwapPeer, readSwapFile);
      }
      return originalOpenSync.call(fs, target, ...rest);
    };
    const swapped = roleStore.readRoleStore(readSwapRoot);
    check('role-store reads bind type and identity checks to the opened file handle',
      swapped.ok === false && swapped.code === 'store_invalid'
        && swapped.problems.some(problem => problem.code === 'store-file-identity-changed'),
      JSON.stringify(swapped));
  } finally {
    fs.openSync = originalOpenSync;
  }

  const casRoot = makeProject('cas-external-write');
  const casFile = storePath(casRoot);
  const casInitial = Buffer.from(JSON.stringify({ schemaVersion: 1, roles: { coder: { provider: 'codex' } } }, null, 2) + '\n');
  const casExternal = Buffer.from(JSON.stringify({ schemaVersion: 1, roles: { coder: { provider: 'external-provider' } } }, null, 2) + '\n');
  writeStore(casRoot, casInitial);
  const casState = roleStore.readRoleStore(casRoot);
  const originalReadFileSync = fs.readFileSync;
  let casInjected = false;
  let casError = null;
  try {
    fs.readFileSync = function patchedRead(target, ...rest) {
      const value = originalReadFileSync.call(fs, target, ...rest);
      if (process.platform === 'win32' && !casInjected && target === casFile) {
        casInjected = true;
        fs.writeFileSync(casFile, casExternal);
      }
      return value;
    };
    if (process.platform !== 'win32') {
      const originalRenameSync = fs.renameSync;
      fs.renameSync = function patchedRename(from, to) {
        if (!casInjected && from === casFile) {
          casInjected = true;
          fs.writeFileSync(casFile, casExternal);
        }
        return originalRenameSync.call(fs, from, to);
      };
      try { roleStore.saveRoles(casRoot, { coder: { provider: 'new-provider' } }, casState); }
      catch (error) { casError = error; }
      finally { fs.renameSync = originalRenameSync; }
    } else {
      try { roleStore.saveRoles(casRoot, { coder: { provider: 'new-provider' } }, casState); }
      catch (error) { casError = error; }
    }
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
  check('identity-bound role-store CAS preserves a valid external edit in the final write window',
    casInjected && casError instanceof roleStore.RoleStoreError && readStore(casRoot).equals(casExternal)
      && roleStore.readRoleStore(casRoot).ok === true
      && Number(fs.lstatSync(casFile).nlink) === 1,
    JSON.stringify({ injected: casInjected, error: casError && casError.roleStoreState }));

  const parentSwapReadRoot = makeProject('parent-swap-read');
  const parentSwapOutside = path.join(TEMP, 'parent-swap-read-outside');
  const parentSwapMoved = path.join(TEMP, 'parent-swap-read-moved');
  fs.mkdirSync(parentSwapOutside);
  writeStore(parentSwapReadRoot, JSON.stringify({ schemaVersion: 1, roles: { coder: { provider: 'codex' } } }) + '\n');
  fs.writeFileSync(path.join(parentSwapOutside, 'agent-roles.json'), JSON.stringify({ schemaVersion: 1, roles: { coder: { provider: 'outside' } } }) + '\n');
  const originalOpenSyncForParentSwap = fs.openSync;
  let parentReadSwapped = false;
  let parentSwapReadState = null;
  try {
    fs.openSync = function patchedParentOpen(target, ...rest) {
      if (!parentReadSwapped && target === storePath(parentSwapReadRoot)) {
        parentReadSwapped = true;
        fs.renameSync(path.join(parentSwapReadRoot, '.leerness'), parentSwapMoved);
        fs.symlinkSync(parentSwapOutside, path.join(parentSwapReadRoot, '.leerness'), process.platform === 'win32' ? 'junction' : 'dir');
      }
      return originalOpenSyncForParentSwap.call(fs, target, ...rest);
    };
    parentSwapReadState = roleStore.readRoleStore(parentSwapReadRoot);
  } finally { fs.openSync = originalOpenSyncForParentSwap; }
  check('role-store read rejects a parent swap between containment validation and file open',
    !parentReadSwapped || (parentSwapReadState?.ok === false
      && parentSwapReadState?.problems?.some(problem => problem.code === 'store-parent-identity-changed')),
    JSON.stringify(parentSwapReadState));

  const directoryStore = makeProject('directory-store');
  fs.mkdirSync(storePath(directoryStore));
  const directoryResult = run(directoryStore, ['roles', 'validate', '--json']);
  check('non-regular role-store paths fail closed',
    assertMachineFailure(directoryResult, 'store_invalid', 'invalid-file-type'));

  const linkedStore = makeProject('linked-store');
  const linkedTarget = path.join(TEMP, 'linked-target');
  fs.mkdirSync(linkedTarget);
  let linkedCreated = false;
  try {
    fs.symlinkSync(linkedTarget, storePath(linkedStore), process.platform === 'win32' ? 'junction' : 'dir');
    linkedCreated = true;
  } catch {}
  const linkedResult = linkedCreated ? run(linkedStore, ['roles', 'validate', '--json']) : null;
  check('linked role-store paths are rejected when the platform permits the fixture',
    !linkedCreated || assertMachineFailure(linkedResult, 'store_invalid', 'invalid-file-type'));

  const linkedParentRoot = path.join(TEMP, 'linked-parent-root');
  const linkedParentTarget = path.join(TEMP, 'linked-parent-target');
  fs.mkdirSync(linkedParentRoot);
  fs.mkdirSync(linkedParentTarget);
  const linkedParentBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, roles: { coder: { provider: 'codex' } } }) + '\n');
  fs.writeFileSync(path.join(linkedParentTarget, 'agent-roles.json'), linkedParentBytes);
  let linkedParentCreated = false;
  try {
    fs.symlinkSync(linkedParentTarget, path.join(linkedParentRoot, '.leerness'), process.platform === 'win32' ? 'junction' : 'dir');
    linkedParentCreated = true;
  } catch {}
  const linkedParentRead = linkedParentCreated ? run(linkedParentRoot, ['roles', 'validate', '--json']) : null;
  const linkedParentWrite = linkedParentCreated
    ? run(linkedParentRoot, ['roles', 'set', 'coder', '--provider', 'codex', '--json'])
    : null;
  const linkedParentDirect = linkedParentCreated ? roleStore.readRoleStore(linkedParentRoot) : null;
  const linkedParentReadJson = linkedParentCreated ? jsonOf(linkedParentRead) : null;
  const linkedParentWriteJson = linkedParentCreated ? jsonOf(linkedParentWrite) : null;
  check('a linked .leerness parent is rejected for both reads and writes without touching its target',
    !linkedParentCreated
      || (linkedParentDirect.ok === false && linkedParentDirect.state === 'linked-parent'
        && linkedParentRead.status === 1
        && ['workspace_dir_symlink', 'store_invalid'].includes(linkedParentReadJson.code)
        && linkedParentWrite.status === 1
        && ['workspace_dir_symlink', 'store_invalid'].includes(linkedParentWriteJson.code)
        && fs.readFileSync(path.join(linkedParentTarget, 'agent-roles.json')).equals(linkedParentBytes)),
    linkedParentCreated ? JSON.stringify({
      direct: linkedParentDirect,
      readStatus: linkedParentRead.status,
      read: linkedParentReadJson,
      writeStatus: linkedParentWrite.status,
      write: linkedParentWriteJson,
    }) : 'junction creation unavailable');

  const commandsResult = run(missing, ['commands', '--json']);
  const commandsJson = jsonOf(commandsResult);
  check('command catalog advertises the new read-only roles validate surface',
    commandsResult.status === 0 && commandsJson
      && JSON.stringify(commandsJson).includes('roles list|set|unset|catalog|suggest|verify|validate'));

  process.stdout.write(`Role store loader probe: ${total - failed}/${total} passed\n`);
  if (failed) process.exitCode = 1;
} finally {
  try { fs.rmSync(TEMP, { recursive: true, force: true }); } catch {}
}
