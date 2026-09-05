#!/usr/bin/env node
'use strict';

// Provider-capacity observation must never turn installation, enablement, or generic
// authentication into a model-entitlement or remaining-quota claim. All provider
// executables here are local fakes. They record every invocation and whether a secret
// loaded from the project .env reached the child environment.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-provider-capacity-'));
let failed = 0;
let total = 0;

const BUILTINS = [
  ['claude', 'claude', 'LEERNESS_ENABLE_CLAUDE'],
  ['codex', 'codex', 'LEERNESS_ENABLE_CODEX'],
  ['agy', 'agy', 'LEERNESS_ENABLE_AGY'],
  ['grok', 'grok', 'LEERNESS_ENABLE_GROK'],
  ['opencode', 'opencode', 'LEERNESS_ENABLE_OPENCODE'],
  ['qwen', 'qwen', 'LEERNESS_ENABLE_QWEN'],
  ['aider', 'aider', 'LEERNESS_ENABLE_AIDER'],
  ['goose', 'goose', 'LEERNESS_ENABLE_GOOSE'],
  ['copilot', 'gh', 'LEERNESS_ENABLE_COPILOT'],
  ['ollama', 'ollama', 'LEERNESS_ENABLE_OLLAMA'],
];
const SECRET_SENTINEL = 'secret-never-reaches-provider-9e12ac74';
const PRIVATE_ACCOUNT = 'private-account@example.invalid';
const PRIVATE_DISPLAY_NAME = 'Jane Q Public';
const PRIVATE_ORGANIZATION = 'Secret Research Lab';
const CREDENTIAL_ENV_KEYS = ['OPENAI_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_PROFILE', 'LEERNESS_NPM_OTP'];
const DISGUISED_CREDENTIAL_ENV_KEYS = [
  'LEERNESS_\uff34\uff2f\uff2b\uff25\uff2e',
  'LEERNESS_TO\u200bKEN',
  'NPM_CONFIG_\uff21\uff30\uff29\uff3f\uff2b\uff25\uff39',
];
const PROBE_CREDENTIAL_ENV_KEYS = [...CREDENTIAL_ENV_KEYS, ...DISGUISED_CREDENTIAL_ENV_KEYS];
const OUTPUT_SECRET = 'sk-provider-output-secret-9e12ac74';
const FULLWIDTH_OUTPUT_SECRET = 'sk-fullwidth-output-secret-9e12ac74';

function check(label, condition, detail = '') {
  total++;
  const ok = !!condition;
  process.stdout.write(`${ok ? '✓' : '✗'} ${label}${!ok && detail ? `\n    ${detail}` : ''}\n`);
  if (!ok) failed++;
}

function appendSource(file, text) {
  return `fs.appendFileSync(${JSON.stringify(file)}, ${JSON.stringify(text)});`;
}

function writeWindowsNodeShim(dir, name, source) {
  const entry = `${name}.js`;
  fs.writeFileSync(path.join(dir, entry), source, 'utf8');
  // Narrow npm-style shim accepted by portable-process without cmd.exe execution.
  fs.writeFileSync(path.join(dir, `${name}.cmd`), [
    '@ECHO off',
    `"%_prog%" "%dp0%\\${entry}" %*`,
    '',
  ].join('\r\n'), 'utf8');
}

function writeNodeExecutable(dir, name, source) {
  if (process.platform === 'win32') {
    writeWindowsNodeShim(dir, name, source);
    return;
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/usr/bin/env node\n${source}`, 'utf8');
  fs.chmodSync(file, 0o755);
}

function genericSource(name, commandMarker, secretMarker) {
  const versionOutput = name === 'agy'
    ? `\u001b[31mOPENAI_API_KEY=${OUTPUT_SECRET} \uff26\uff35\uff2c\uff2c\uff37\uff29\uff24\uff34\uff28\uff3f\uff21\uff30\uff29\uff3f\uff2b\uff25\uff39=${FULLWIDTH_OUTPUT_SECRET}\u001b[0m\n`
    : name === 'probeai'
      ? `probeai-cli 1.0.0 organization=${PRIVATE_ORGANIZATION}\n`
    : `${name}-cli 1.0.0\n`;
  return [
    "'use strict';",
    "const fs = require('fs');",
    appendSource(commandMarker, `${name}:`),
    `fs.appendFileSync(${JSON.stringify(commandMarker)}, process.argv.slice(2).join(' ') + '\\n');`,
    `if (${JSON.stringify(PROBE_CREDENTIAL_ENV_KEYS)}.some(key => process.env[key])) ${appendSource(secretMarker, `${name}:credential-env-seen\n`)}`,
    `process.stdout.write(${JSON.stringify(versionOutput)});`,
    '',
  ].join('\n');
}

function codexSource(commandMarker, authMarker, secretMarker) {
  return [
    "'use strict';",
    "const fs = require('fs');",
    "const args = process.argv.slice(2);",
    appendSource(commandMarker, 'codex:'),
    `fs.appendFileSync(${JSON.stringify(commandMarker)}, args.join(' ') + '\\n');`,
    `if (${JSON.stringify(PROBE_CREDENTIAL_ENV_KEYS)}.some(key => process.env[key])) ${appendSource(secretMarker, 'codex:credential-env-seen\n')}`,
    "if (args[0] === 'login' && args[1] === 'status') {",
    `  ${appendSource(authMarker, 'auth-check\n')}`,
    `  process.stdout.write(${JSON.stringify(`Logged in as ${PRIVATE_DISPLAY_NAME} (${PRIVATE_ACCOUNT})\n`)});`,
    '  process.exit(0);',
    '}',
    "process.stdout.write('codex-cli 1.0.0\\n');",
    '',
  ].join('\n');
}

function envFile(enabledIds) {
  const enabled = new Set(enabledIds);
  return [
    ...BUILTINS.map(([id, , flag]) => `${flag}=${enabled.has(id) ? '1' : '0'}`),
    `LEERNESS_ENABLE_PROBEAI=${enabled.has('probeai') ? '1' : '0'}`,
    `OPENAI_API_KEY=${SECRET_SENTINEL}-openai`,
    `AWS_ACCESS_KEY_ID=${SECRET_SENTINEL}-aws-id`,
    `AWS_PROFILE=${SECRET_SENTINEL}-profile`,
    `LEERNESS_NPM_OTP=${SECRET_SENTINEL}-otp`,
    '',
  ].join('\n');
}

function isolatedEnv(binDir) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^LEERNESS_ENABLE_/i.test(key) || key.toLowerCase() === 'path'
        || CREDENTIAL_ENV_KEYS.some(name => name.toLowerCase() === key.toLowerCase())) delete env[key];
  }
  const runtime = path.dirname(process.execPath);
  if (process.platform === 'win32') {
    const systemRoot = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
    env.Path = [binDir, runtime, path.join(systemRoot, 'System32')].join(path.delimiter);
    env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
  } else {
    env.PATH = [binDir, runtime, '/usr/bin', '/bin'].join(path.delimiter);
  }
  env.LEERNESS_OFFLINE = '1';
  env.LEERNESS_NO_PROMPT = '1';
  env.LEERNESS_NO_AUTOCHCP = '1';
  for (const key of DISGUISED_CREDENTIAL_ENV_KEYS) env[key] = `${SECRET_SENTINEL}-${key.length}`;
  return env;
}

function runCapacity(env, extraArgs = []) {
  return cp.spawnSync(process.execPath,
    [CLI, 'agents', 'quota', '--path', root, '--json', ...extraArgs], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    });
}

function runCli(env, args) {
  return cp.spawnSync(process.execPath, [CLI, ...args, '--path', root, '--json'], {
    cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
}

function parse(result) {
  try { return JSON.parse(result.stdout); } catch { return null; }
}

function lines(file) {
  try { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean); }
  catch { return []; }
}

function countPrefix(file, prefix) {
  return lines(file).filter(line => line.startsWith(prefix)).length;
}

try {
  const binDir = path.join(root, 'bin');
  const stateDir = path.join(root, '.leerness');
  const commandMarker = path.join(root, 'provider-commands.log');
  const authMarker = path.join(root, 'auth-checks.log');
  const secretMarker = path.join(root, 'secret-seen.log');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  for (const [, bin] of BUILTINS) {
    if (bin !== 'codex') writeNodeExecutable(binDir, bin, genericSource(bin, commandMarker, secretMarker));
  }
  writeNodeExecutable(binDir, 'codex', codexSource(commandMarker, authMarker, secretMarker));
  writeNodeExecutable(binDir, 'probeai', genericSource('probeai', commandMarker, secretMarker));

  fs.writeFileSync(path.join(stateDir, 'providers.json'), JSON.stringify({
    schemaVersion: 1,
    providers: [{
      id: 'ProbeAI',
      bin: 'probeai',
      envFlag: 'LEERNESS_ENABLE_PROBEAI',
      versionArgs: ['--version'],
      desc: 'Probe provider',
    }],
  }, null, 2) + '\n', 'utf8');

  const allIds = [...BUILTINS.map(([id]) => id), 'probeai'];
  fs.writeFileSync(path.join(root, '.env'), envFile(allIds), 'utf8');
  const env = isolatedEnv(binDir);
  const resultKo = runCapacity(env);
  const resultEn = runCapacity(env, ['--language', 'en']);
  const dataKo = parse(resultKo);
  const dataEn = parse(resultEn);

  check('capacity command exits successfully in both locales',
    resultKo.status === 0 && resultEn.status === 0,
    `ko=${resultKo.status} en=${resultEn.status} stderr=${String(resultKo.stderr || resultEn.stderr || '').slice(0, 500)}`);
  check('capacity command returns versioned observation JSON',
    !!(dataKo && dataKo.schemaVersion === 2 && dataKo.observation === 'provider-capacity'),
    String(resultKo.stdout || '').slice(0, 500));
  check('canonical JSON is locale-independent',
    !!(dataKo && dataEn && JSON.stringify(dataKo) === JSON.stringify(dataEn)),
    `ko=${String(resultKo.stdout || '').slice(0, 500)} en=${String(resultEn.stdout || '').slice(0, 500)}`);

  const rows = dataKo && Array.isArray(dataKo.quota) ? dataKo.quota : [];
  const agy = rows.find(row => row.id === 'agy');
  const codex = rows.find(row => row.id === 'codex');
  const custom = rows.find(row => row.id === 'probeai');
  check('all configured providers are represented', rows.length === allIds.length && !!custom,
    `ids=${JSON.stringify(rows.map(row => row.id))}`);
  check('installed and enabled remain separate observable facts',
    !!(agy && agy.installed === true && agy.enabled === true && agy.status === 'ready'
      && agy.versionCheckAttempted === true && agy.versionCheckState === 'ok'
      && agy.presenceCheckOnly === false),
    JSON.stringify(agy));
  check('safe auth status is recorded without account identity',
    !!(codex && codex.auth === 'ok' && codex.authCheckAttempted === true
      && codex.authEvidencePresent === true && codex.authSource === 'codex login status'
      && !Object.prototype.hasOwnProperty.call(codex, 'authEvidence')),
    JSON.stringify(codex));
  check('confirmed authentication permits local routing without proving model callability',
    !!(codex && codex.routingEligibility === 'eligible'
      && codex.routingReason === 'local_prerequisites_met'
      && codex.modelCallability === 'not-observed'
      && codex.callability === 'unknown'
      && codex.callabilityReason === 'live_model_call_not_performed'),
    JSON.stringify(codex));
  check('unknown authentication is explicitly unverified, not eligible',
    !!(agy && agy.auth === 'unknown' && agy.authCheckAttempted === false
      && agy.routingEligibility === 'unverified'
      && agy.routingReason === 'authentication_not_observed'
      && agy.modelCallability === 'not-observed'),
    JSON.stringify(agy));
  check('remaining capacity stays unobserved even after authentication',
    !!(codex && codex.quota === 'unknown' && codex.quotaState === 'not-observed'
      && codex.remaining === null && codex.unit === null && codex.resetAt === null
      && codex.quotaSource === null),
    JSON.stringify(codex));
  check('custom provider carries its registry source', custom && custom.source === 'user', JSON.stringify(custom));
  check('case-preserving legacy provider IDs collapse to one canonical provider identity',
    custom && custom.id === 'probeai' && rows.filter(row => row.id === 'probeai').length === 1,
    JSON.stringify(rows.map(row => ({ id: row.id, source: row.source }))));

  const serialized = JSON.stringify(dataKo || {});
  check('credential values and account identifiers are absent from output',
    !serialized.includes(SECRET_SENTINEL) && !serialized.includes(PRIVATE_ACCOUNT)
      && !serialized.includes(PRIVATE_DISPLAY_NAME) && !serialized.includes(PRIVATE_ORGANIZATION)
      && !serialized.includes(OUTPUT_SECRET) && !serialized.includes(FULLWIDTH_OUTPUT_SECRET),
    serialized.slice(0, 1000));
  check('provider version output removes terminal escapes and redacts normalized credential labels',
    !serialized.includes('\\u001b') && !serialized.includes('\u001b')
      && agy && !String(agy.version || '').includes(OUTPUT_SECRET)
      && !String(agy.version || '').includes(FULLWIDTH_OUTPUT_SECRET),
    JSON.stringify(agy));
  check('project credential values are not passed to provider subprocesses', lines(secretMarker).length === 0,
    JSON.stringify(lines(secretMarker)));
  check('observation policy describes actual credential and execution boundaries',
    !!(dataKo && dataKo.policy
      && dataKo.policy.projectEnvironmentMayBeLoaded === true
      && dataKo.policy.credentialValuesIncludedInOutput === false
      && dataKo.policy.credentialValuesPersistedByCommand === false
      && dataKo.policy.credentialValuesInspectedForCapacity === false
      && dataKo.policy.credentialValuesPassedToProbeCommands === false
      && dataKo.policy.providerCredentialStoresReadDirectly === false
      && dataKo.policy.providerCliMayReadOwnCredentialStore === true
      && dataKo.policy.providerCliMayReadEnvironmentCredentials === false
      && dataKo.policy.disabledProviderCommandsExecuted === false
      && JSON.stringify(dataKo.policy.registeredSafeAuthChecksAttempted) === JSON.stringify(['codex'])
      && dataKo.policy.versionChecksAttempted.length === allIds.length
      && dataKo.policy.presenceOnlyChecks.length === 0
      && dataKo.policy.browserSessionReuse === false
      && dataKo.policy.guiScraping === false
      && dataKo.policy.liveModelCalls === false
      && dataKo.policy.capacityValuesRequireOfficialContract === true
      && dataKo.policy.speculativeCapacityClaims === false),
    JSON.stringify(dataKo && dataKo.policy));
  check('limitations are stable machine-readable codes',
    !!(dataKo && Array.isArray(dataKo.limitations)
      && dataKo.limitations.join(',') === [
        'local_prerequisites_only',
        'authentication_is_not_model_entitlement',
        'exact_capacity_requires_verified_official_adapter',
        'recorded_availability_is_not_official_capacity',
        'disabled_providers_presence_only',
        'credential_values_not_passed_to_probe_commands',
      ].join(',')),
    JSON.stringify(dataKo && dataKo.limitations));

  let observationWrite = runCli(env, ['agents', 'availability', 'mark', 'codex', '--quota-state', 'exhausted', '--rate-limited', '--reason', 'quota-exhausted', '--ttl-min', '60']);
  let observedCapacity = parse(runCapacity(env));
  let observedCodex = observedCapacity && observedCapacity.quota.find(row => row.id === 'codex');
  check('effective exhausted/rate-limited observations block capacity routing and preserve legacy aliases',
    observationWrite.status === 0 && observedCodex
      && observedCodex.routingEligibility === 'blocked'
      && ['quota_exhausted', 'rate_limited'].includes(observedCodex.routingReason)
      && observedCodex.quotaState === 'observed-exhausted'
      && observedCodex.quota === 'observed-exhausted'
      && typeof observedCodex.hint === 'string' && observedCodex.hint.length > 0,
    JSON.stringify(observedCodex));
  observationWrite = runCli(env, ['agents', 'availability', 'mark', 'codex', '--quota-state', 'available', '--not-rate-limited', '--reason', 'capacity-restored', '--ttl-min', '60']);
  observedCapacity = parse(runCapacity(env));
  observedCodex = observedCapacity && observedCapacity.quota.find(row => row.id === 'codex');
  check('newest same-scope availability axes supersede stale quota and rate-limit values',
    observationWrite.status === 0 && observedCodex
      && observedCodex.routingEligibility === 'eligible'
      && observedCodex.quotaState === 'observed-available'
      && observedCodex.quota === 'observed-available',
    JSON.stringify(observedCodex));
  runCli(env, ['agents', 'availability', 'clear', 'codex']);
  check('enabled runs execute only the expected fake authentication adapter',
    lines(authMarker).length === 4 && lines(authMarker).every(line => line === 'auth-check'),
    `auth=${JSON.stringify(lines(authMarker))}`);

  // Disable only Codex: neither its version command nor auth command may execute.
  fs.writeFileSync(path.join(root, '.env'), envFile(allIds.filter(id => id !== 'codex')), 'utf8');
  const codexCommandsBefore = countPrefix(commandMarker, 'codex:');
  const authBefore = lines(authMarker).length;
  const disabledResult = runCapacity(isolatedEnv(binDir));
  const disabledData = parse(disabledResult);
  const disabledCodex = disabledData && disabledData.quota.find(row => row.id === 'codex');
  check('disabled provider is presence-checked without executing version or auth commands',
    disabledResult.status === 0
      && countPrefix(commandMarker, 'codex:') === codexCommandsBefore
      && lines(authMarker).length === authBefore
      && disabledCodex && disabledCodex.installed === true
      && disabledCodex.version === null
      && disabledCodex.versionCheckAttempted === false
      && disabledCodex.versionCheckState === 'not-attempted'
      && disabledCodex.presenceCheckOnly === true
      && disabledCodex.authCheckAttempted === false
      && disabledCodex.auth === 'unknown'
      && disabledCodex.routingEligibility === 'blocked'
      && disabledCodex.routingReason === 'provider_disabled'
      && disabledData.policy.providerCliMayReadOwnCredentialStore === true
      && disabledData.policy.disabledProviderCommandsExecuted === false
      && disabledData.policy.registeredSafeAuthChecksAttempted.length === 0
      && disabledData.policy.presenceOnlyChecks.includes('codex'),
    `commands=${JSON.stringify(lines(commandMarker))} row=${JSON.stringify(disabledCodex)} policy=${JSON.stringify(disabledData && disabledData.policy)}`);

  // A path merely ending in a built-in filename is a different executable
  // authority. It may be version-probed when explicitly enabled, but must not
  // inherit the built-in's privileged authentication subcommand.
  const spoofDir = path.join(root, 'tools');
  fs.mkdirSync(spoofDir, { recursive: true });
  writeNodeExecutable(spoofDir, 'codex', codexSource(commandMarker, authMarker, secretMarker));
  const spoofBin = process.platform === 'win32' ? 'tools\\codex.cmd' : 'tools/codex';
  fs.writeFileSync(path.join(stateDir, 'providers.json'), JSON.stringify({
    schemaVersion: 1,
    providers: [{ id: 'codex', bin: spoofBin, envFlag: 'LEERNESS_ENABLE_CODEX', versionArgs: ['--version'], desc: 'path spoof' }],
  }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(root, '.env'), envFile(['codex']), 'utf8');
  const spoofAuthBefore = lines(authMarker).length;
  const spoofResult = runCapacity(isolatedEnv(binDir));
  const spoofData = parse(spoofResult);
  const spoofCodex = spoofData && spoofData.quota.find(row => row.id === 'codex');
  check('a workspace path ending in a built-in name cannot inherit that built-in authentication check',
    spoofResult.status === 0
      && spoofCodex && spoofCodex.versionCheckAttempted === true
      && spoofCodex.authCheckAttempted === false && spoofCodex.auth === 'unknown'
      && lines(authMarker).length === spoofAuthBefore
      && !spoofData.policy.registeredSafeAuthChecksAttempted.includes('codex'),
    `row=${JSON.stringify(spoofCodex)} policy=${JSON.stringify(spoofData && spoofData.policy)} auth=${JSON.stringify(lines(authMarker))}`);

  fs.writeFileSync(path.join(stateDir, 'providers.json'), JSON.stringify({
    schemaVersion: 1,
    providers: [{
      id: 'ProbeAI', bin: 'probeai', envFlag: 'LEERNESS_ENABLE_PROBEAI', versionArgs: ['--version'], desc: 'Probe provider',
    }],
  }, null, 2) + '\n', 'utf8');

  // Disable every provider: the entire command must be observation-only with no provider process spawn.
  fs.writeFileSync(path.join(root, '.env'), envFile([]), 'utf8');
  const commandCountBeforeAllDisabled = lines(commandMarker).length;
  const allDisabledResult = runCapacity(isolatedEnv(binDir));
  const allDisabledData = parse(allDisabledResult);
  check('all-disabled run executes zero provider commands and reports presence-only checks',
    allDisabledResult.status === 0
      && lines(commandMarker).length === commandCountBeforeAllDisabled
      && allDisabledData.policy.versionChecksAttempted.length === 0
      && allDisabledData.policy.providerCliMayReadOwnCredentialStore === false
      && allDisabledData.policy.presenceOnlyChecks.length === allIds.length
      && allDisabledData.quota.every(row => row.enabled === false
        && row.versionCheckAttempted === false && row.versionCheckState === 'not-attempted'
        && row.presenceCheckOnly === true),
    `before=${commandCountBeforeAllDisabled} after=${lines(commandMarker).length} policy=${JSON.stringify(allDisabledData && allDisabledData.policy)}`);

  const speculative = /60 req\/min|1000 req\/day|unlimited|무제한|"quota":"rate-limited"|"quota":"subscription"/i
    .test(JSON.stringify(dataKo || {}));
  check('no speculative quota claim is present', !speculative,
    speculative ? 'speculative quota claim present' : '');

  const { canonicalProviderIdentity } = require('../lib/role-fallback');
  const nativeMaxProvider = `p${'a'.repeat(63)}`;
  const overNativeProvider = `p${'a'.repeat(64)}`;
  const registryBeforeOverlongAdd = fs.readFileSync(path.join(stateDir, 'providers.json'), 'utf8');
  const overlongAdd = runCli(isolatedEnv(binDir), ['provider', 'add', overNativeProvider, '--bin', 'probeai']);
  check('new provider IDs obey the native-v2 64-character ceiling in canonicalization and provider add',
    canonicalProviderIdentity(nativeMaxProvider) === nativeMaxProvider
      && canonicalProviderIdentity(overNativeProvider) === null
      && overlongAdd.status === 1
      && fs.readFileSync(path.join(stateDir, 'providers.json'), 'utf8') === registryBeforeOverlongAdd,
    `exit=${overlongAdd.status} stdout=${overlongAdd.stdout} stderr=${overlongAdd.stderr}`);
} catch (error) {
  check('probe completed without exception', false, error && error.stack ? error.stack : String(error));
} finally {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
}

process.stdout.write(`Provider capacity probe: ${total - failed}/${total} passed\n`);
process.exitCode = failed ? 1 : 0;
