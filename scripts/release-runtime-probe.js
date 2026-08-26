#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const root = path.resolve(__dirname, '..');
const cliPath = path.join(root, 'bin', 'leerness.js');
const npmProcessPath = path.join(root, 'lib', 'npm-process.js');
const portableProcessPath = path.join(root, 'lib', 'portable-process.js');
const gitProcessPath = path.join(root, 'lib', 'git.js');
const agentsModulePath = path.join(root, 'lib', 'agents.js');
const agentRegistryPath = path.join(root, 'lib', 'agent-registry.js');
const ioModulePath = path.join(root, 'lib', 'io.js');
const runtimeWarningGatePath = path.join(root, 'scripts', 'runtime-warning-gate.js');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-release-runtime-'));
const marker = path.join(sandbox, 'shell-injection-marker');
const fakeNpmDir = path.join(sandbox, 'fake-npm');
const fakeNpmCli = path.join(fakeNpmDir, 'npm-cli.js');
const fakeNpmLog = path.join(sandbox, 'fake-npm-calls.jsonl');
const fakeAgentDir = path.join(sandbox, 'fake-agent-bin');
const fakeAgentPrefix = 'LEERNESS_AGENT_PROBE:';
const fakeAgentEntry = path.join(fakeAgentDir, 'portable-agent.js');
const fakeAgentCmd = path.join(fakeAgentDir, 'leerness-agent-probe.cmd');
const fakeClaudeCmd = path.join(fakeAgentDir, 'claude.cmd');
const fakeAgentMarker = path.join(sandbox, 'unsafe-cmd-executed');
const fakeExpansionMarker = path.join(sandbox, 'unsafe-env-expansion-executed');
const fakeNativeEntry = path.join(fakeAgentDir, 'portable-native.exe');
const fakeNativeCmd = path.join(fakeAgentDir, 'claude-native-probe.cmd');
const fakeNativeMarker = path.join(sandbox, 'unsafe-native-cmd-executed');
const fakePsCmd = path.join(fakeAgentDir, 'powershell-fallback-probe.cmd');
const fakePsScript = path.join(fakeAgentDir, 'powershell-fallback-probe.ps1');
const fakePsMarker = path.join(sandbox, 'unsafe-powershell-cmd-executed');
const unsupportedCmd = path.join(fakeAgentDir, 'unsupported-cmd-probe.cmd');
const unsupportedMarker = path.join(sandbox, 'unsafe-unsupported-cmd-executed');
const cwdShadowGit = path.join(sandbox, 'git.exe');
const cwdOnlyPortable = path.join(sandbox, 'leerness-cwd-only-probe.exe');
const cwdShadowWhere = path.join(sandbox, 'where.exe');
const cwdShadowNpm = path.join(sandbox, 'npm.cmd');
const cwdShadowNpmMarker = path.join(sandbox, 'unsafe-startup-npm-executed');
const cwdShadowChcp = path.join(sandbox, 'chcp.com');
const cwdShadowChcpMarker = path.join(sandbox, 'unsafe-startup-chcp-executed');
const startupPreload = path.join(sandbox, 'startup-shadow-preload.js');
const missingScriptTool = 'leerness-shadow-missing-tool';
const failures = [];
const { warningSuppressionReasons, withRedirectWarnings } = require(runtimeWarningGatePath);
const inheritedWarningSuppressions = warningSuppressionReasons(process.env);
if (inheritedWarningSuppressions.length) {
  failures.push(`caller warning suppression rejected: ${inheritedWarningSuppressions.join(', ')}`);
}

function readFakeCalls() {
  try {
    return fs.readFileSync(fakeNpmLog, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  } catch { return []; }
}

function runCli(args, env = process.env) {
  return cp.spawnSync(process.execPath, [cliPath, ...args], {
    cwd: sandbox,
    env,
    encoding: 'utf8',
    timeout: 60000,
  });
}

function overrideEnvCaseInsensitive(base, overrides) {
  const env = { ...base };
  for (const [name, value] of Object.entries(overrides)) {
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === name.toLowerCase()) delete env[key];
    }
    env[name] = value;
  }
  return env;
}

function parseAgentProbeOutput(value) {
  const text = String(value || '');
  const offset = text.lastIndexOf(fakeAgentPrefix);
  if (offset < 0) return null;
  const line = text.slice(offset + fakeAgentPrefix.length).split(/\r?\n/)[0];
  try { return JSON.parse(line); } catch { return null; }
}

function comparableFsPath(value) {
  let resolved;
  try { resolved = fs.realpathSync.native(String(value)); }
  catch { resolved = path.resolve(String(value)); }
  const normalized = path.normalize(resolved);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function sameFsPath(left, right) {
  return comparableFsPath(left) === comparableFsPath(right);
}

try {
  const warningSuppressions = [
    { NODE_OPTIONS: '--no-deprecation' },
    { NODE_OPTIONS: '--no-warnings' },
    { NODE_OPTIONS: '--disable-warning=DEP0190' },
    { NODE_NO_WARNINGS: '1' },
  ];
  for (let i = 0; i < warningSuppressions.length; i++) {
    const warningFile = path.join(sandbox, `suppression-probe-${i}.log`);
    const hostileWarningEnv = overrideEnvCaseInsensitive(process.env, warningSuppressions[i]);
    const guarded = withRedirectWarnings(hostileWarningEnv, warningFile);
    const warningChild = cp.spawnSync(process.execPath, ['-e', "process.emitWarning('shell option true', { type: 'DeprecationWarning', code: 'DEP0190' })"], {
      env: guarded.env, cwd: sandbox, encoding: 'utf8', timeout: 30000,
    });
    const warningText = fs.existsSync(warningFile) ? fs.readFileSync(warningFile, 'utf8') : '';
    if (guarded.reasons.length === 0 || warningChild.status !== 0 || !/DEP0190|shell option true/i.test(warningText)) {
      failures.push(`warning suppression ${i}가 fail-closed/redirect되지 않음: ${JSON.stringify({ input: warningSuppressions[i], reasons: guarded.reasons, status: warningChild.status, warningText: warningText.slice(0, 300), stderr: String(warningChild.stderr || '').slice(0, 200) })}`);
    }
  }

  const portableWarningFile = path.join(sandbox, 'portable-caller-warning.log');
  const npmWarningFile = path.join(sandbox, 'npm-caller-warning.log');
  const npmWarningCli = path.join(sandbox, 'npm-warning-cli.js');
  fs.writeFileSync(npmWarningCli, "process.emitWarning('npm caller redirect', { type: 'DeprecationWarning', code: 'DEP0190' });\n");
  const portableWarningEnv = overrideEnvCaseInsensitive(process.env, {
    NODE_OPTIONS: `--redirect-warnings=${portableWarningFile.replace(/\\/g, '/')}`,
    NODE_NO_WARNINGS: '',
  });
  const npmWarningEnv = overrideEnvCaseInsensitive(process.env, {
    NODE_OPTIONS: `--redirect-warnings=${npmWarningFile.replace(/\\/g, '/')}`,
    NODE_NO_WARNINGS: '',
  });
  const portableWarningChild = require(portableProcessPath).spawnPortableSync('node', [
    '-e', "process.emitWarning('portable caller redirect', { type: 'DeprecationWarning', code: 'DEP0190' })",
  ], { cwd: sandbox, env: portableWarningEnv, encoding: 'utf8', timeout: 30000 });
  const npmWarningChild = require(npmProcessPath).spawnNpmSync([], {
    npmCliPath: npmWarningCli, cwd: sandbox, env: npmWarningEnv, encoding: 'utf8', timeout: 30000,
  });
  const portableWarningText = fs.existsSync(portableWarningFile) ? fs.readFileSync(portableWarningFile, 'utf8') : '';
  const npmWarningText = fs.existsSync(npmWarningFile) ? fs.readFileSync(npmWarningFile, 'utf8') : '';
  if (portableWarningChild.status !== 0 || npmWarningChild.status !== 0
      || !/DEP0190|portable caller redirect/.test(portableWarningText)
      || !/DEP0190|npm caller redirect/.test(npmWarningText)) {
    failures.push(`caller-authored warning redirect가 portable/npm 자식에서 끊김: ${JSON.stringify({ portable: { status: portableWarningChild.status, file: portableWarningText.slice(0, 250), stderr: String(portableWarningChild.stderr || '').slice(0, 200) }, npm: { status: npmWarningChild.status, file: npmWarningText.slice(0, 250), stderr: String(npmWarningChild.stderr || '').slice(0, 200) } })}`);
  }

  fs.mkdirSync(fakeNpmDir, { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({
    name: 'release-runtime-probe',
    version: '9.9.9',
    scripts: { 'path-shadow-probe': `${missingScriptTool} --version` },
  }) + '\n');
  fs.writeFileSync(fakeNpmCli, [
    "'use strict';",
    "const fs = require('fs');",
    'const args = process.argv.slice(2);',
    "if (process.env.LEERNESS_NPM_PROBE_LOG) fs.appendFileSync(process.env.LEERNESS_NPM_PROBE_LOG, JSON.stringify(args) + '\\n');",
    "if (args[0] === '--version') process.stdout.write('99.0.0\\n');",
    "else if (args[0] === 'view' && args.includes('dist-tags')) process.stdout.write(JSON.stringify({ latest: '9.9.9', next: '10.0.0-next.1' }) + '\\n');",
    "else if (args[0] === 'view') process.stdout.write('9.9.9\\n');",
    "else if (args[0] === 'pack') process.stdout.write('release-runtime-probe-9.9.9.tgz\\n');",
    "else if (args[0] === 'publish') process.stdout.write('+ release-runtime-probe@9.9.9\\n');",
    'const exitCode = Number(process.env.LEERNESS_NPM_PROBE_EXIT || 0);',
    'if (Number.isFinite(exitCode) && exitCode !== 0) process.exit(exitCode);',
  ].join('\n') + '\n');

  fs.mkdirSync(fakeAgentDir, { recursive: true });
  fs.writeFileSync(fakeAgentEntry, [
    "'use strict';",
    "let stdin = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => { stdin += chunk; });",
    `process.stdin.on('end', () => process.stdout.write(${JSON.stringify(fakeAgentPrefix)} + JSON.stringify({ argv: process.argv.slice(2), stdin })));`,
  ].join('\n') + '\n');
  // 실제 npm Windows shim 형태. 이 파일이 실행되면 marker를 남기므로 portable runner가
  // cmd.exe로 폴백했는지(= %ENV% 확장/BatBadBut 표면이 다시 열렸는지) 함께 검출한다.
  fs.writeFileSync(fakeAgentCmd, [
    '@ECHO off',
    `echo unsafe>"${fakeAgentMarker}"`,
    'SET "_prog=node"',
    `"%_prog%" "%dp0%\\${path.basename(fakeAgentEntry)}" %*`,
  ].join('\r\n') + '\r\n');
  fs.copyFileSync(fakeAgentCmd, fakeClaudeCmd);
  const fakeCodexCmd = path.join(fakeAgentDir, process.platform === 'win32' ? 'codex.cmd' : 'codex');
  if (process.platform === 'win32') {
    fs.copyFileSync(fakeAgentCmd, fakeCodexCmd);
  } else {
    fs.writeFileSync(fakeCodexCmd, `#!/usr/bin/env node\n${fs.readFileSync(fakeAgentEntry, 'utf8')}`);
    fs.chmodSync(fakeCodexCmd, 0o755);
  }
  if (process.platform === 'win32') {
    const system32 = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32');
    const whereExe = path.join(system32, 'where.exe');
    const mountvolExe = path.join(system32, 'mountvol.exe');
    try { fs.linkSync(whereExe, fakeNativeEntry); }
    catch { fs.copyFileSync(whereExe, fakeNativeEntry); }
    try { fs.linkSync(whereExe, cwdShadowGit); }
    catch { fs.copyFileSync(whereExe, cwdShadowGit); }
    try { fs.linkSync(process.execPath, cwdOnlyPortable); }
    catch { fs.copyFileSync(process.execPath, cwdOnlyPortable); }
    // mountvol with an arbitrary token exits 0, so the old bare `where` locator
    // falsely reported a deliberately missing package-script dependency as present.
    try { fs.linkSync(mountvolExe, cwdShadowWhere); }
    catch { fs.copyFileSync(mountvolExe, cwdShadowWhere); }
    try { fs.linkSync(process.execPath, cwdShadowChcp); }
    catch { fs.copyFileSync(process.execPath, cwdShadowChcp); }
    fs.writeFileSync(startupPreload, [
      "'use strict';",
      "const fs = require('fs'); const path = require('path');",
      `if (path.basename(process.execPath).toLowerCase() === 'chcp.com') fs.writeFileSync(${JSON.stringify(cwdShadowChcpMarker)}, 'unsafe');`,
    ].join('\n') + '\n');
    fs.writeFileSync(cwdShadowNpm, [
      '@ECHO off',
      `echo unsafe>"${cwdShadowNpmMarker}"`,
      'echo C:\\definitely-missing-leerness-global-root',
    ].join('\r\n') + '\r\n');
    // Claude Code의 실제 npm shim처럼 Node가 아니라 PE .exe를 가리키는 변형.
    fs.writeFileSync(fakeNativeCmd, [
      '@ECHO off',
      `echo unsafe>"${fakeNativeMarker}"`,
      'SET "_prog=node"',
      `"%_prog%" "%dp0%\\${path.basename(fakeNativeEntry)}" %*`,
    ].join('\r\n') + '\r\n');
    fs.writeFileSync(fakePsCmd, ['@ECHO off', `echo unsafe>"${fakePsMarker}"`, 'exit /b 9'].join('\r\n') + '\r\n');
    fs.writeFileSync(fakePsScript, [
      `& $env:LEERNESS_PORTABLE_NODE "$PSScriptRoot\\${path.basename(fakeAgentEntry)}" @args`,
      'exit $LASTEXITCODE',
    ].join('\r\n') + '\r\n');
    fs.writeFileSync(unsupportedCmd, ['@ECHO off', `echo unsafe>"${unsupportedMarker}"`, 'exit /b 0'].join('\r\n') + '\r\n');

    const nativeNpmDir = path.join(sandbox, 'native-npm-bin');
    const nativeNpmCwd = path.join(sandbox, 'native-npm-cwd');
    const unsupportedNpmDir = path.join(sandbox, 'unsupported-npm-bin');
    const nativeNpmRunner = path.join(sandbox, 'native-npm-runner.js');
    const nativeNpmEntry = path.join(sandbox, 'native-npm-entry.js');
    const nativeNpmLog = path.join(sandbox, 'native-npm-log.json');
    fs.mkdirSync(nativeNpmDir, { recursive: true });
    fs.mkdirSync(nativeNpmCwd, { recursive: true });
    fs.mkdirSync(unsupportedNpmDir, { recursive: true });
    for (const destination of [
      path.join(nativeNpmDir, 'node.exe'),
      path.join(nativeNpmDir, 'npm.exe'),
      path.join(nativeNpmCwd, 'npm.exe'),
      path.join(unsupportedNpmDir, 'node.exe'),
    ]) {
      try { fs.linkSync(process.execPath, destination); }
      catch { fs.copyFileSync(process.execPath, destination); }
    }
    fs.writeFileSync(nativeNpmEntry, [
      "'use strict';",
      "const fs = require('fs');",
      `fs.writeFileSync(${JSON.stringify(nativeNpmLog)}, JSON.stringify({ execPath: process.execPath, argv: process.argv.slice(2) }));`,
    ].join('\n') + '\n');
    fs.writeFileSync(nativeNpmRunner, [
      "'use strict';",
      `const { spawnNpmSync } = require(${JSON.stringify(npmProcessPath)});`,
      `const result = spawnNpmSync([${JSON.stringify(nativeNpmEntry)}, 'space value', 'amp&pipe|', '%NO_EXPAND%'], {`,
      `  cwd: ${JSON.stringify(nativeNpmCwd)}, env: process.env, encoding: 'utf8', timeout: 30000,`,
      '});',
      "process.stdout.write(JSON.stringify({ status: result.status, stderr: String(result.stderr || ''), error: result.error && String(result.error.code || result.error.message) }));",
    ].join('\n') + '\n');
    const nativeNpmEnv = overrideEnvCaseInsensitive(process.env, {
      PATH: nativeNpmDir,
      npm_execpath: '',
    });
    const nativeNpmChild = cp.spawnSync(path.join(nativeNpmDir, 'node.exe'), [nativeNpmRunner], {
      cwd: nativeNpmCwd, env: nativeNpmEnv, encoding: 'utf8', timeout: 60000,
    });
    let nativeNpmResult = null;
    let nativeNpmCall = null;
    try { nativeNpmResult = JSON.parse(String(nativeNpmChild.stdout || '')); } catch {}
    try { nativeNpmCall = JSON.parse(fs.readFileSync(nativeNpmLog, 'utf8')); } catch {}
    if (nativeNpmChild.status !== 0 || !nativeNpmResult || nativeNpmResult.status !== 0
        || !nativeNpmCall || !sameFsPath(nativeNpmCall.execPath, path.join(nativeNpmDir, 'npm.exe'))
        || JSON.stringify(nativeNpmCall.argv) !== JSON.stringify(['space value', 'amp&pipe|', '%NO_EXPAND%'])) {
      failures.push(`Windows native npm.exe PATH fallback/cwd-shadow 방어 실패: ${JSON.stringify({ child: nativeNpmChild.status, result: nativeNpmResult, call: nativeNpmCall, stderr: String(nativeNpmChild.stderr || '').slice(0, 300) })}`);
    }

    fs.writeFileSync(path.join(unsupportedNpmDir, 'npm.cmd'), '@ECHO off\r\nexit /b 0\r\n');
    const unsupportedNpmEnv = overrideEnvCaseInsensitive(process.env, {
      PATH: unsupportedNpmDir,
      npm_execpath: '',
    });
    const unsupportedNpmChild = cp.spawnSync(path.join(unsupportedNpmDir, 'node.exe'), ['-e', [
      `const { spawnNpmSync } = require(${JSON.stringify(npmProcessPath)});`,
      "const r = spawnNpmSync(['--version'], { env: process.env, encoding: 'utf8', timeout: 30000 });",
      "process.stdout.write(JSON.stringify({ status: r.status, stderr: String(r.stderr || ''), error: r.error && String(r.error.code || r.error.message) }));",
    ].join('\n')], {
      cwd: nativeNpmCwd, env: unsupportedNpmEnv, encoding: 'utf8', timeout: 60000,
    });
    let unsupportedNpmResult = null;
    try { unsupportedNpmResult = JSON.parse(String(unsupportedNpmChild.stdout || '')); } catch {}
    if (unsupportedNpmChild.status !== 0 || !unsupportedNpmResult || unsupportedNpmResult.status !== 126) {
      failures.push(`Windows unsupported npm.cmd가 fail-closed 126이 아님: ${JSON.stringify({ child: unsupportedNpmChild.status, result: unsupportedNpmResult, stderr: String(unsupportedNpmChild.stderr || '').slice(0, 300) })}`);
    }
  }

  const childScript = [
    `const { spawnNpmSync } = require(${JSON.stringify(npmProcessPath)});`,
    'const warnings = [];',
    "process.on('warning', warning => warnings.push({ code: warning.code, message: warning.message }));",
    "const result = spawnNpmSync(['--version'], { encoding: 'utf8', timeout: 30000 });",
    'setImmediate(() => {',
    '  process.stdout.write(JSON.stringify({',
    '    status: result.status,',
    "    stdout: String(result.stdout || '').trim(),",
    "    stderr: String(result.stderr || ''),",
    '    error: result.error ? String(result.error.code || result.error.message) : null,',
    '    warnings,',
    '  }));',
    '});',
  ].join('\n');
  const child = cp.spawnSync(process.execPath, ['--trace-deprecation', '-e', childScript], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  });
  let result = null;
  try { result = JSON.parse(String(child.stdout || '')); } catch {}
  if (child.status !== 0 || !result || result.status !== 0 || !/^\d+\.\d+\.\d+/.test(result.stdout || '')) {
    failures.push(`shell 없는 npm --version 실행 실패: ${String(child.stderr || child.stdout || '').slice(0, 300)}`);
  }
  const warningText = `${String(child.stderr || '')} ${JSON.stringify(result && result.warnings || [])}`;
  if (/DEP0190|shell option true/i.test(warningText)) failures.push('npm 실행에서 DEP0190 경고가 발생함');

  const agentChildScript = [
    `const cli = require(${JSON.stringify(cliPath)});`,
    'const warnings = [];',
    "process.on('warning', warning => warnings.push({ code: warning.code, message: warning.message, stack: warning.stack }));",
    "const result = cli._checkAgent({ id: 'probe', bin: 'node', envFlag: 'LEERNESS_NO_SUCH_FLAG', versionArgs: ['--version'], desc: 'probe' });",
    'setImmediate(() => process.stdout.write(JSON.stringify({ installed: result.installed, warnings })));',
  ].join('\n');
  const agentChild = cp.spawnSync(process.execPath, ['--trace-deprecation', '-e', agentChildScript], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  });
  let agentProbe = null;
  try { agentProbe = JSON.parse(String(agentChild.stdout || '')); } catch {}
  const agentWarningText = `${String(agentChild.stderr || '')} ${JSON.stringify(agentProbe && agentProbe.warnings || [])}`;
  if (agentChild.status !== 0 || !agentProbe || agentProbe.installed !== true) {
    failures.push(`에이전트 CLI 실행 프로브 실패: ${String(agentChild.stderr || agentChild.stdout || '').slice(0, 300)}`);
  }
  if (/DEP0190|shell option true/i.test(agentWarningText)) failures.push('에이전트 설치/버전 확인에서 DEP0190 경고가 발생함');

  const dotenvTrustRoot = path.join(sandbox, 'dotenv-trust-root');
  const dotenvPreload = path.join(sandbox, 'dotenv-preload.js');
  const dotenvPreloadMarker = path.join(sandbox, 'dotenv-preload-marker');
  const dotenvNpmCli = path.join(sandbox, 'dotenv-malicious-npm-cli.js');
  const dotenvNpmMarker = path.join(sandbox, 'dotenv-npm-marker');
  fs.mkdirSync(dotenvTrustRoot, { recursive: true });
  fs.writeFileSync(dotenvPreload, `require('fs').writeFileSync(${JSON.stringify(dotenvPreloadMarker)}, 'unsafe');\n`);
  fs.writeFileSync(dotenvNpmCli, `require('fs').writeFileSync(${JSON.stringify(dotenvNpmMarker)}, 'unsafe'); process.stdout.write('99.0.0\\n');\n`);
  const cleanDotenvEnv = { ...process.env };
  for (const key of Object.keys(cleanDotenvEnv)) {
    if (['NODE_OPTIONS', 'NODE_NO_WARNINGS', 'NODE_REDIRECT_WARNINGS', 'NODE_PATH', 'NPM_EXECPATH'].includes(key.toUpperCase())) delete cleanDotenvEnv[key];
  }
  Object.assign(cleanDotenvEnv, {
    PATH: `${fakeAgentDir}${path.delimiter}${process.env.PATH || ''}`,
    LEERNESS_NO_BANNER: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1',
  });
  const dotenvInit = runCli(['init', dotenvTrustRoot, '--yes', '--minimal', '--language', 'en'], cleanDotenvEnv);
  fs.writeFileSync(path.join(dotenvTrustRoot, '.env'), [
    `NODE_OPTIONS=--require=${dotenvPreload.replace(/\\/g, '/')}`,
    'NODE_NO_WARNINGS=1',
    `NODE_REDIRECT_WARNINGS=${path.join(sandbox, 'suppressed-warnings.log').replace(/\\/g, '/')}`,
    `NODE_PATH=${path.join(sandbox, 'untrusted-node-modules').replace(/\\/g, '/')}`,
    `NPM_EXECPATH=${dotenvNpmCli.replace(/\\/g, '/')}`,
    'LEERNESS_ENABLE_CODEX=1',
    'ANTHROPIC_API_KEY=example',
  ].join('\n') + '\n');
  const dotenvAgents = runCli(['agents', 'list', '--path', dotenvTrustRoot, '--json'], cleanDotenvEnv);
  const dotenvHandoff = runCli(['handoff', dotenvTrustRoot, '--json', '--no-record', '--no-env-detect', '--no-drift-check'], cleanDotenvEnv);
  const dotenvLoaderScript = [
    `const cli = require(${JSON.stringify(cliPath)});`,
    `const { spawnNpmSync } = require(${JSON.stringify(npmProcessPath)});`,
    `cli._loadEnvFile(${JSON.stringify(dotenvTrustRoot)});`,
    "const blocked = ['NODE_OPTIONS','NODE_NO_WARNINGS','NODE_REDIRECT_WARNINGS','NODE_PATH','NPM_EXECPATH'].filter(key => process.env[key]);",
    "const npm = spawnNpmSync(['--version'], { cwd: process.cwd(), env: process.env, encoding: 'utf8', timeout: 30000 });",
    "process.stdout.write(JSON.stringify({ blocked, leerness: process.env.LEERNESS_ENABLE_CODEX, providerKey: process.env.ANTHROPIC_API_KEY, npmStatus: npm.status, npmOut: String(npm.stdout || '').trim(), npmErr: String(npm.stderr || '') }));",
  ].join('\n');
  const dotenvLoaderChild = cp.spawnSync(process.execPath, ['--trace-deprecation', '-e', dotenvLoaderScript], {
    cwd: dotenvTrustRoot, env: cleanDotenvEnv, encoding: 'utf8', timeout: 60000,
  });
  let dotenvLoader = null;
  try { dotenvLoader = JSON.parse(String(dotenvLoaderChild.stdout || '')); } catch {}
  if (dotenvInit.status !== 0 || dotenvAgents.status !== 0 || dotenvHandoff.status !== 0
      || dotenvLoaderChild.status !== 0 || !dotenvLoader || dotenvLoader.blocked.length
      || dotenvLoader.leerness !== '1' || dotenvLoader.providerKey !== 'example'
      || dotenvLoader.npmStatus !== 0 || !/^\d+\.\d+\.\d+/.test(dotenvLoader.npmOut)
      || fs.existsSync(dotenvPreloadMarker) || fs.existsSync(dotenvNpmMarker)) {
    failures.push(`project .env 프로세스 제어 trust boundary 실패: ${JSON.stringify({ init: dotenvInit.status, agents: dotenvAgents.status, handoff: dotenvHandoff.status, loaderChild: dotenvLoaderChild.status, loader: dotenvLoader, preloadMarker: fs.existsSync(dotenvPreloadMarker), npmMarker: fs.existsSync(dotenvNpmMarker), agentsErr: String(dotenvAgents.stderr || '').slice(0, 300), handoffErr: String(dotenvHandoff.stderr || '').slice(0, 300), childErr: String(dotenvLoaderChild.stderr || '').slice(0, 300) })}`);
  }

  const { _benchLaunchSpec } = require(agentsModulePath);
  const { EXTERNAL_AGENTS } = require(agentRegistryPath);
  const benchTask = 'bench task %NO_EXPAND% & pipe|';
  const expectedBenchSpecs = {
    claude: { file: 'claude', args: ['--print', benchTask] },
    codex: { file: 'codex', args: ['exec', '--skip-git-repo-check', benchTask] },
    agy: { file: 'agy', args: ['-p', benchTask] },
    grok: { file: 'grok', args: [benchTask] },
    opencode: { file: 'opencode', args: ['run', benchTask] },
    qwen: { file: 'qwen', args: ['-p', benchTask] },
    aider: { file: 'aider', args: ['--message', benchTask, '--no-auto-commits'] },
    goose: { file: 'goose', args: ['run', '-t', benchTask] },
    copilot: { file: 'gh', args: ['copilot', 'suggest', benchTask] },
  };
  for (const agent of EXTERNAL_AGENTS) {
    const spec = _benchLaunchSpec(agent, benchTask, false);
    if (agent.id === 'ollama') {
      if (!spec.unsupported || !/explicit model/.test(spec.unsupported)) failures.push('ollama bench 제한이 명시적 unsupported 결과가 아님');
      continue;
    }
    const expected = expectedBenchSpecs[agent.id];
    if (!expected || spec.file !== expected.file || spec.stdin !== 'ignore'
        || JSON.stringify(spec.args) !== JSON.stringify(expected.args)) {
      failures.push(`agents bench ${agent.id} argv spec 불일치: ${JSON.stringify(spec)}`);
    }
  }

  const benchMatrixChildScript = [
    "'use strict';",
    "const { EventEmitter } = require('events');",
    "const { PassThrough } = require('stream');",
    `const { agentsCmd } = require(${JSON.stringify(agentsModulePath)});`,
    `const { EXTERNAL_AGENTS } = require(${JSON.stringify(agentRegistryPath)});`,
    `require(${JSON.stringify(ioModulePath)}).setQuiet(true);`,
    '(async () => {',
    '  const rows = [];',
    '  for (const target of EXTERNAL_AGENTS) {',
    '    const calls = [];',
    '    const fakeSpawn = (file, args, options) => {',
    '      calls.push({ file, args, stdin: options && options.stdio && options.stdio[0] });',
    '      const child = new EventEmitter();',
    '      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};',
    "      process.nextTick(() => { child.stdout.end('ok'); child.stderr.end(); child.emit('close', 0); });",
    '      return child;',
    '    };',
    "    const arg = (_name, fallback) => fallback; const has = () => false;",
    "    const results = await agentsCmd(process.cwd(), 'bench', ['matrix task'], {",
    "      has, arg, _loadEnvFile: () => {}, _checkAgent: agent => ({ status: agent.id === target.id ? 'ready' : 'disabled' }),",
    '      _spawnPortable: fakeSpawn,',
    '    });',
    '    rows.push({ id: target.id, calls, results });',
    '  }',
    '  process.stdout.write(JSON.stringify(rows));',
    '})().catch(error => { process.stderr.write(error.stack || error.message); process.exit(1); });',
  ].join('\n');
  const benchMatrixChild = cp.spawnSync(process.execPath, ['--trace-deprecation', '-e', benchMatrixChildScript], {
    cwd: root, encoding: 'utf8', timeout: 60000,
  });
  let benchMatrix = null;
  try { benchMatrix = JSON.parse(String(benchMatrixChild.stdout || '')); } catch {}
  if (benchMatrixChild.status !== 0 || !Array.isArray(benchMatrix) || benchMatrix.length !== EXTERNAL_AGENTS.length) {
    failures.push(`agents bench 10-provider settled matrix 실행 실패: ${String(benchMatrixChild.stderr || benchMatrixChild.stdout || '').slice(0, 500)}`);
  } else {
    for (const row of benchMatrix) {
      const supported = row.id !== 'ollama';
      if (!Array.isArray(row.results) || row.results.length !== 1
          || row.results[0].id !== row.id
          || (supported && (row.calls.length !== 1 || row.calls[0].stdin !== 'ignore' || row.results[0].ok !== true))
          || (!supported && (row.calls.length !== 0 || !/explicit model/.test(String(row.results[0].error || ''))))) {
        failures.push(`agents bench ${row.id} 단독-ready settled 결과 오류: ${JSON.stringify(row)}`);
      }
    }
  }

  if (process.platform === 'win32') {
    const { resolvePortableLaunch, spawnPortableSync } = require(portableProcessPath);
    const startupEnv = overrideEnvCaseInsensitive(process.env, {
      NODE_OPTIONS: `--require="${startupPreload.replace(/\\/g, '/')}"`,
      LEERNESS_NO_AUTOCHCP: '0',
      _LEERNESS_CHCP_DONE: '0',
      LEERNESS_NO_BANNER: '1',
      LEERNESS_OFFLINE: '1',
    });
    const startupVersion = runCli(['--version'], startupEnv);
    if (startupVersion.status !== 0 || String(startupVersion.stdout || '').trim() !== require(path.join(root, 'package.json')).version
        || fs.existsSync(cwdShadowChcpMarker) || fs.existsSync(cwdShadowNpmMarker)) {
      failures.push(`CLI startup이 cwd chcp/npm shadow를 실행함: ${JSON.stringify({ status: startupVersion.status, stdout: String(startupVersion.stdout || '').trim(), chcp: fs.existsSync(cwdShadowChcpMarker), npm: fs.existsSync(cwdShadowNpmMarker), stderr: String(startupVersion.stderr || '').slice(0, 300) })}`);
    }

    const envDetect = runCli(['env', 'detect', '--path', sandbox, '--json', '--no-write'], startupEnv);
    let envReport = null;
    try { envReport = JSON.parse(String(envDetect.stdout || '')); } catch {}
    const missingDep = envReport && envReport.snapshot && envReport.snapshot.scriptDependencies
      && envReport.snapshot.scriptDependencies.find(dep => dep.command === missingScriptTool);
    if (envDetect.status !== 1 || !missingDep || missingDep.foundInPath !== false
        || !envReport.snapshot.tools.npm || !/^\d+\.\d+\.\d+/.test(envReport.snapshot.tools.npm.version)
        || fs.existsSync(cwdShadowChcpMarker) || fs.existsSync(cwdShadowNpmMarker)) {
      failures.push(`handoff/env detect PATH-only locator 또는 npm tool 감지 실패: ${JSON.stringify({ status: envDetect.status, missingDep, npm: envReport && envReport.snapshot && envReport.snapshot.tools.npm, chcp: fs.existsSync(cwdShadowChcpMarker), startupNpm: fs.existsSync(cwdShadowNpmMarker), stderr: String(envDetect.stderr || '').slice(0, 300) })}`);
    }

    const hostilePathValue = "C:\\safe $(Write-Output LEERNESS_PS_INJECTED) `tick 'quote; tail\\";
    const pathScript = require(cliPath)._winPathPsScript(hostilePathValue);
    const pathValueProbe = spawnPortableSync('powershell.exe', [
      '-NoProfile', '-Command', '$b = $env:LEERNESS_PATH_BIN; [Console]::Out.Write($b)',
    ], {
      env: { ...process.env, LEERNESS_PATH_BIN: hostilePathValue },
      cwd: sandbox, encoding: 'utf8', timeout: 30000,
    });
    if (!pathScript.includes('$env:LEERNESS_PATH_BIN') || pathScript.includes(hostilePathValue)
        || pathValueProbe.status !== 0 || String(pathValueProbe.stdout || '') !== hostilePathValue) {
      failures.push(`path-setup PowerShell 데이터 채널 보존 실패: ${JSON.stringify({ status: pathValueProbe.status, stdout: String(pathValueProbe.stdout || ''), script: pathScript.slice(0, 180), stderr: String(pathValueProbe.stderr || '').slice(0, 200) })}`);
    }

    const portableEnv = overrideEnvCaseInsensitive(process.env, {
      PATH: `${fakeAgentDir}${path.delimiter}${process.env.PATH || ''}`,
      LEERNESS_TEST_EVIL: `" & echo HACKED>"${fakeExpansionMarker}" & rem "`,
      LEERNESS_PORTABLE_NODE: process.execPath,
    });
    const hostileArgv = [
      '%LEERNESS_TEST_EVIL%',
      'quote"inside',
      'tail\\',
      'tail\\\\',
      'amp&pipe|caret^',
      'bang!',
      'line1\nline2',
      '',
      '한글 공백',
    ];
    const launch = resolvePortableLaunch('leerness-agent-probe', { env: portableEnv, cwd: sandbox });
    const portableResult = spawnPortableSync('leerness-agent-probe', hostileArgv, {
      env: portableEnv, cwd: sandbox, encoding: 'utf8', timeout: 30000,
    });
    const portableProbe = parseAgentProbeOutput(portableResult.stdout);
    if (launch.kind !== 'npm-node-shim' || portableResult.status !== 0
        || !portableProbe || portableProbe.stdin !== ''
        || JSON.stringify(portableProbe.argv) !== JSON.stringify(hostileArgv)) {
      failures.push(`Windows npm .cmd shell-free argv 보존 실패: ${JSON.stringify({ launch, status: portableResult.status, probe: portableProbe, stderr: String(portableResult.stderr || '').slice(0, 200) })}`);
    }
    if (fs.existsSync(fakeAgentMarker) || fs.existsSync(fakeExpansionMarker)) {
      failures.push('Windows npm .cmd가 cmd.exe로 실행되거나 %ENV% 인자가 명령으로 확장됨');
    }

    const psLaunch = resolvePortableLaunch('powershell-fallback-probe', { env: portableEnv, cwd: sandbox });
    const psResult = spawnPortableSync('powershell-fallback-probe', hostileArgv, {
      env: portableEnv, cwd: sandbox, encoding: 'utf8', timeout: 30000,
    });
    const psProbe = parseAgentProbeOutput(psResult.stdout);
    if (psLaunch.kind !== 'npm-ps1-node-shim' || psResult.status !== 0
        || !psProbe || psProbe.stdin !== ''
        || JSON.stringify(psProbe.argv) !== JSON.stringify(hostileArgv)) {
      failures.push(`Windows .ps1 fallback argv 보존 실패: ${JSON.stringify({ launch: psLaunch, status: psResult.status, probe: psProbe, stderr: String(psResult.stderr || '').slice(0, 200) })}`);
    }
    if (fs.existsSync(fakePsMarker) || fs.existsSync(fakeExpansionMarker)) {
      failures.push('Windows .ps1 fallback 대신 unsafe .cmd/%ENV% 경로가 실행됨');
    }

    const unsupportedLaunch = resolvePortableLaunch('unsupported-cmd-probe', { env: portableEnv, cwd: sandbox });
    const unsupportedResult = spawnPortableSync('unsupported-cmd-probe', hostileArgv, {
      env: portableEnv, cwd: sandbox, encoding: 'utf8', timeout: 30000,
    });
    const unsupportedStderr = String(unsupportedResult.stderr || '');
    if (unsupportedLaunch.kind !== 'unsupported-shell-script' || unsupportedResult.status !== 126
        || !sameFsPath(unsupportedLaunch.source, unsupportedCmd)
        || !unsupportedStderr.includes('unsupported Windows command shim')
        || !unsupportedStderr.toLowerCase().includes(path.basename(unsupportedCmd).toLowerCase())
        || fs.existsSync(unsupportedMarker)) {
      failures.push(`해석 불가 .cmd가 fail-closed하지 않음: ${JSON.stringify({ launch: unsupportedLaunch, status: unsupportedResult.status, error: unsupportedResult.error && unsupportedResult.error.code })}`);
    }

    const optionDenialDir = path.join(sandbox, 'node-option-denial');
    fs.mkdirSync(optionDenialDir, { recursive: true });
    const inspectDenial = spawnPortableSync('--inspect', [], {
      env: portableEnv, cwd: optionDenialDir, encoding: 'utf8', timeout: 30000,
    });
    const cpuProfileDenial = spawnPortableSync('--cpu-prof', [], {
      env: portableEnv, cwd: optionDenialDir, encoding: 'utf8', timeout: 30000,
    });
    const optionArtifactsAfterSync = fs.readdirSync(optionDenialDir).filter(name => /\.cpuprofile$/i.test(name));
    if (inspectDenial.status !== 127 || cpuProfileDenial.status !== 127
        || !String(inspectDenial.stderr || '').includes('--inspect')
        || !String(cpuProfileDenial.stderr || '').includes('--cpu-prof')
        || /Debugger listening/i.test(String(inspectDenial.stderr || ''))
        || optionArtifactsAfterSync.length) {
      failures.push(`fail-closed 진단 source가 Node 옵션으로 재해석됨(sync): ${JSON.stringify({ inspect: { status: inspectDenial.status, stderr: String(inspectDenial.stderr || '').slice(0, 250) }, cpu: { status: cpuProfileDenial.status, stderr: String(cpuProfileDenial.stderr || '').slice(0, 250) }, artifacts: optionArtifactsAfterSync })}`);
    }

    const asyncOptionScript = [
      `const { spawnPortable } = require(${JSON.stringify(portableProcessPath)});`,
      "function run(file) { return new Promise(resolve => {",
      "  const child = spawnPortable(file, [], { env: process.env, cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });",
      "  let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });",
      "  child.on('error', error => resolve({ file, error: error.code || error.message, stdout, stderr }));",
      "  child.on('close', status => resolve({ file, status, stdout, stderr }));",
      '}); }',
      "(async () => process.stdout.write(JSON.stringify(await Promise.all([run('--inspect'), run('--cpu-prof')]))))().catch(error => { process.stderr.write(error.stack || error.message); process.exit(1); });",
    ].join('\n');
    const asyncOptionChild = cp.spawnSync(process.execPath, ['--trace-deprecation', '-e', asyncOptionScript], {
      cwd: optionDenialDir, env: portableEnv, encoding: 'utf8', timeout: 30000,
    });
    let asyncOptionResults = null;
    try { asyncOptionResults = JSON.parse(String(asyncOptionChild.stdout || '')); } catch {}
    const optionArtifactsAfterAsync = fs.readdirSync(optionDenialDir).filter(name => /\.cpuprofile$/i.test(name));
    if (asyncOptionChild.status !== 0 || !Array.isArray(asyncOptionResults) || asyncOptionResults.length !== 2
        || asyncOptionResults.some(item => item.status !== 127 || !String(item.stderr || '').includes(item.file) || /Debugger listening/i.test(String(item.stderr || '')))
        || optionArtifactsAfterAsync.length) {
      failures.push(`fail-closed 진단 source가 Node 옵션으로 재해석됨(async): ${JSON.stringify({ child: asyncOptionChild.status, results: asyncOptionResults, artifacts: optionArtifactsAfterAsync, stderr: String(asyncOptionChild.stderr || '').slice(0, 300) })}`);
    }

    const cwdOnlyLaunch = resolvePortableLaunch('leerness-cwd-only-probe', { env: portableEnv, cwd: sandbox });
    const cwdOnlyResult = spawnPortableSync('leerness-cwd-only-probe', [], {
      env: portableEnv, cwd: sandbox, encoding: 'utf8', timeout: 30000,
    });
    if (cwdOnlyLaunch.kind !== 'unresolved' || cwdOnlyResult.status !== 127) {
      failures.push(`PATH 밖 cwd-only executable이 fail-closed하지 않음: ${JSON.stringify({ launch: cwdOnlyLaunch, status: cwdOnlyResult.status, stderr: String(cwdOnlyResult.stderr || '').slice(0, 200) })}`);
    }

    const gitLaunch = resolvePortableLaunch('git', { env: portableEnv, cwd: sandbox });
    const pathOnlyGit = spawnPortableSync('git', ['--version'], {
      env: portableEnv, cwd: sandbox, encoding: 'utf8', timeout: 30000,
    });
    if (path.resolve(gitLaunch.source || '') === path.resolve(cwdShadowGit)
        || pathOnlyGit.status !== 0 || !/^git version /i.test(String(pathOnlyGit.stdout || '').trim())) {
      failures.push(`Windows bare command가 PATH 밖 untrusted cwd executable을 선택함: ${JSON.stringify({ launch: gitLaunch, status: pathOnlyGit.status, stdout: String(pathOnlyGit.stdout || '').slice(0, 100) })}`);
    }
    const gitChokepoint = require(gitProcessPath).gitSpawn(['--version'], {
      env: portableEnv, cwd: sandbox, encoding: 'utf8', timeout: 30000,
    });
    if (gitChokepoint.status !== 0 || !/^git version /i.test(String(gitChokepoint.stdout || '').trim())) {
      failures.push(`lib/git chokepoint가 cwd git.exe shadow를 실행함: ${JSON.stringify({ status: gitChokepoint.status, stdout: String(gitChokepoint.stdout || '').slice(0, 100), stderr: String(gitChokepoint.stderr || '').slice(0, 200) })}`);
    }

    const asyncPortableScript = [
      `const { spawnPortable } = require(${JSON.stringify(portableProcessPath)});`,
      `const expected = ${JSON.stringify(hostileArgv)};`,
      "const child = spawnPortable('leerness-agent-probe', expected, { env: process.env, cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });",
      "let stdout = '', stderr = '';",
      "child.stdout.on('data', chunk => { stdout += chunk; });",
      "child.stderr.on('data', chunk => { stderr += chunk; });",
      "child.on('error', error => process.stdout.write(JSON.stringify({ error: error.code || error.message, stdout, stderr })));",
      "child.on('close', status => process.stdout.write(JSON.stringify({ status, stdout, stderr })));",
    ].join('\n');
    const asyncPortable = cp.spawnSync(process.execPath, ['--trace-deprecation', '-e', asyncPortableScript], {
      cwd: sandbox, env: portableEnv, encoding: 'utf8', timeout: 30000,
    });
    let asyncProbe = null;
    try { asyncProbe = JSON.parse(String(asyncPortable.stdout || '')); } catch {}
    const asyncAgentProbe = parseAgentProbeOutput(asyncProbe && asyncProbe.stdout);
    if (asyncPortable.status !== 0 || !asyncProbe || asyncProbe.status !== 0
        || !asyncAgentProbe || asyncAgentProbe.stdin !== ''
        || JSON.stringify(asyncAgentProbe.argv) !== JSON.stringify(hostileArgv)
        || /DEP0190|shell option true/i.test(String(asyncPortable.stderr || '') + String(asyncProbe && asyncProbe.stderr || ''))) {
      failures.push(`Windows async portable argv/DEP0190 프로브 실패: ${String(asyncPortable.stderr || asyncPortable.stdout || '').slice(0, 400)}`);
    }
    if (fs.existsSync(fakeAgentMarker) || fs.existsSync(fakeExpansionMarker)) {
      failures.push('Windows async npm .cmd가 cmd.exe로 실행되거나 %ENV% 인자가 명령으로 확장됨');
    }

    const nativeLaunch = resolvePortableLaunch('claude-native-probe', { env: portableEnv, cwd: sandbox });
    const nativeResult = spawnPortableSync('claude-native-probe', ['/?'], {
      env: portableEnv, cwd: sandbox, encoding: 'utf8', timeout: 30000,
    });
    if (nativeLaunch.kind !== 'npm-native-shim' || !sameFsPath(nativeLaunch.file, fakeNativeEntry) || nativeResult.status !== 0) {
      failures.push(`Claude형 .exe npm shim 해석 실패: ${JSON.stringify({ launch: nativeLaunch, status: nativeResult.status, stderr: String(nativeResult.stderr || '').slice(0, 200) })}`);
    }
    if (fs.existsSync(fakeNativeMarker)) failures.push('Claude형 .exe npm shim이 cmd.exe로 실행됨');

    // public one-shot agent 경로는 runCommandSafe가 scrubbed env를 사용한다. PATHEXT가 빠지면
    // where.exe가 npm .cmd를 찾지 못해 _checkAgent만 성공하고 실제 프롬프트 호출은 ENOENT가 된다.
    const agentProject = path.join(sandbox, 'agent-one-shot-project');
    const agentEnv = overrideEnvCaseInsensitive(portableEnv, {
      LEERNESS_ENABLE_CLAUDE: '1',
      LEERNESS_ENABLE_CODEX: '0', LEERNESS_ENABLE_AGY: '0', LEERNESS_ENABLE_GROK: '0',
      LEERNESS_ENABLE_OPENCODE: '0', LEERNESS_ENABLE_QWEN: '0', LEERNESS_ENABLE_AIDER: '0',
      LEERNESS_ENABLE_GOOSE: '0', LEERNESS_ENABLE_COPILOT: '0', LEERNESS_ENABLE_OLLAMA: '0',
      LEERNESS_OFFLINE: '1',
      LEERNESS_NO_AUTO_ROADMAP: '1',
      LEERNESS_NO_PROMPT: '1',
    });
    const agentInit = runCli(['init', agentProject, '--yes', '--minimal', '--language', 'en'], agentEnv);
    const oneShotTask = 'probe %LEERNESS_TEST_EVIL% quote"inside tail\\ amp&pipe| bang!\n한글 다음 줄';
    const oneShot = runCli(['agent', oneShotTask, '--provider', 'claude', '--path', agentProject], agentEnv);
    const oneShotProbe = parseAgentProbeOutput(oneShot.stdout);
    const actorPrompt = require(path.join(root, 'lib', 'role-catalog.js'))._AGENT_ROLE_PROMPTS.actor;
    const expectedOneShotStdin = `${actorPrompt}\n\nTask: ${oneShotTask}`;
    if (agentInit.status !== 0 || oneShot.status !== 0
        || !oneShotProbe || JSON.stringify(oneShotProbe.argv) !== JSON.stringify(['--print'])
        || oneShotProbe.stdin !== expectedOneShotStdin
        || /ENOENT|spawn failed|spawn 실패/i.test(String(oneShot.stdout || '') + String(oneShot.stderr || ''))) {
      failures.push(`scrubbed-env public agent one-shot argv/stdin 실행 실패: ${JSON.stringify({ init: agentInit.status, status: oneShot.status, probe: oneShotProbe, expectedStdin: expectedOneShotStdin, stdout: String(oneShot.stdout || '').slice(0, 1200), stderr: String(oneShot.stderr || '').slice(0, 600) })}`);
    }
    if (fs.existsSync(fakeAgentMarker) || fs.existsSync(fakeExpansionMarker)) {
      failures.push('public agent one-shot이 npm .cmd 또는 %ENV% 셸 확장을 실행함');
    }

    const benchmarkTask = 'bench %LEERNESS_TEST_EVIL% quote"inside tail\\ amp&pipe| bang!\n한글 다음 줄';
    const benchmark = runCli(['benchmark', '--measure', benchmarkTask, '--path', agentProject, '--json'], agentEnv);
    let benchmarkReport = null;
    try { benchmarkReport = JSON.parse(String(benchmark.stdout || '')); } catch {}
    const claudeBench = benchmarkReport && Array.isArray(benchmarkReport.results)
      ? benchmarkReport.results.find(item => item.cli === 'claude') : null;
    if (benchmark.status !== 0 || !claudeBench || claudeBench.exit !== 0
        || fs.existsSync(fakeAgentMarker) || fs.existsSync(fakeExpansionMarker)) {
      failures.push(`benchmark --measure portable hostile-task 실행 실패: ${JSON.stringify({ status: benchmark.status, report: benchmarkReport, stdout: String(benchmark.stdout || '').slice(0, 1000), stderr: String(benchmark.stderr || '').slice(0, 500) })}`);
    }

    const hostileArchiveRoot = path.join(sandbox, 'archive$(New-Item injected.txt)');
    const archiveMarker = path.join(hostileArchiveRoot, 'injected.txt');
    const archiveInit = runCli(['init', hostileArchiveRoot, '--yes', '--minimal', '--language', 'en'], startupEnv);
    const powershellDir = path.join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0');
    const archiveEnv = overrideEnvCaseInsensitive(startupEnv, {
      PATH: powershellDir,
      LEERNESS_OFFLINE: '1',
      LEERNESS_NO_PROMPT: '1',
    });
    const archivePublish = cp.spawnSync(process.execPath, [cliPath, 'skill', 'publish', '--path', hostileArchiveRoot, '--bundle-only', '--no-security-check'], {
      cwd: hostileArchiveRoot, env: archiveEnv, encoding: 'utf8', timeout: 120000,
    });
    const expectedArchive = path.join(hostileArchiveRoot, '.leerness', 'skills-publish-tarball', `leerness-skills-${require(path.join(root, 'package.json')).version}.zip`);
    if (archiveInit.status !== 0 || archivePublish.status !== 0 || fs.existsSync(archiveMarker) || !fs.existsSync(expectedArchive)) {
      failures.push(`skill archive PowerShell 경로 주입/ZIP fallback 실패: ${JSON.stringify({ init: archiveInit.status, publish: archivePublish.status, marker: fs.existsSync(archiveMarker), archive: fs.existsSync(expectedArchive), stdout: String(archivePublish.stdout || '').slice(0, 1000), stderr: String(archivePublish.stderr || '').slice(0, 500) })}`);
    }
  }

  const { resolveNpmCliPath, spawnNpmSync } = require(npmProcessPath);
  const fakeEnv = overrideEnvCaseInsensitive(process.env, {
    // test:fast deliberately runs the product offline. These cases exercise the
    // real npm-backed release paths with a local fake CLI, so keep that parent
    // policy from short-circuiting the behavior under test.
    LEERNESS_OFFLINE: '0',
    npm_execpath: fakeNpmCli,
    LEERNESS_NPM_PROBE_LOG: fakeNpmLog,
  });
  const casingProbe = overrideEnvCaseInsensitive(
    { NPM_EXECPATH: path.join(sandbox, 'inherited-wrong-npm-cli.js') },
    { npm_execpath: fakeNpmCli },
  );
  const casingKeys = Object.keys(casingProbe).filter(key => key.toLowerCase() === 'npm_execpath');
  if (casingKeys.length !== 1 || casingKeys[0] !== 'npm_execpath' || casingProbe.npm_execpath !== fakeNpmCli) {
    failures.push(`Windows npm_execpath 대소문자 alias 정규화 실패: ${JSON.stringify(casingKeys)}`);
  }
  const resolved = resolveNpmCliPath({ env: fakeEnv });
  if (resolved !== fakeNpmCli) {
    failures.push(`자식 env의 npm_execpath를 사용하지 않음: ${resolved || '(없음)'}`);
  }
  fs.writeFileSync(fakeNpmLog, '');
  const argvResult = spawnNpmSync([
    '--version',
    '&&',
    process.execPath,
    '-e',
    `require('fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe')`,
  ], { cwd: sandbox, env: fakeEnv, encoding: 'utf8', timeout: 30000 });
  const argvCalls = readFakeCalls();
  const expectedArgv = ['--version', '&&', process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe')`];
  if (argvResult.status !== 0 || argvCalls.length !== 1 || JSON.stringify(argvCalls[0]) !== JSON.stringify(expectedArgv)) {
    failures.push(`npm argv 보존 실패: ${JSON.stringify(argvCalls)}`);
  }
  if (fs.existsSync(marker)) failures.push('npm 인자의 셸 메타문자가 별도 명령으로 실행됨');

  const gitMarker = path.join(sandbox, 'git-shell-injection-marker');
  const gitChildScript = [
    `const { gitSpawn } = require(${JSON.stringify(gitProcessPath)});`,
    'const warnings = [];',
    "process.on('warning', warning => warnings.push({ code: warning.code, message: warning.message }));",
    `const result = gitSpawn(['--version', '&', ${JSON.stringify(process.execPath)}, '-e', ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(gitMarker)}, 'unsafe')`)}], { encoding: 'utf8', timeout: 30000, shell: true });`,
    'setImmediate(() => process.stdout.write(JSON.stringify({ status: result.status, stderr: String(result.stderr || ""), warnings })));',
  ].join('\n');
  const gitChild = cp.spawnSync(process.execPath, ['--trace-deprecation', '-e', gitChildScript], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
  });
  let gitProbe = null;
  try { gitProbe = JSON.parse(String(gitChild.stdout || '')); } catch {}
  const gitWarningText = `${String(gitChild.stderr || '')} ${JSON.stringify(gitProbe && gitProbe.warnings || [])}`;
  if (gitChild.status !== 0 || !gitProbe) failures.push(`shell 없는 git argv 프로브 실패: ${String(gitChild.stderr || gitChild.stdout || '').slice(0, 300)}`);
  if (/DEP0190|shell option true/i.test(gitWarningText)) failures.push('git 실행에서 DEP0190 경고가 발생함');
  if (fs.existsSync(gitMarker)) failures.push('git argv의 셸 메타문자가 별도 명령으로 실행됨');

  const missing = spawnNpmSync(['--version'], {
    npmCliPath: path.join(sandbox, 'missing', 'npm-cli.js'),
    cwd: sandbox,
    encoding: 'utf8',
  });
  if (missing.status !== null || !missing.error || missing.error.code !== 'ENOENT') {
    failures.push(`npm CLI 누락 결과가 spawn 호환 ENOENT가 아님: ${JSON.stringify({ status: missing.status, code: missing.error && missing.error.code })}`);
  }

  fs.writeFileSync(fakeNpmLog, '');
  const channel = runCli(['release', 'channel', sandbox, '--json'], fakeEnv);
  let channelJson = null;
  try { channelJson = JSON.parse(String(channel.stdout || '')); } catch {}
  const channelCalls = readFakeCalls();
  if (channel.status !== 0 || !channelJson || !channelJson.distTags || channelJson.distTags.latest !== '9.9.9'
      || !channelCalls.some(call => JSON.stringify(call) === JSON.stringify(['view', 'leerness', 'dist-tags', '--json']))) {
    failures.push(`release channel 실제 npm view 경로 실패: exit=${channel.status} calls=${JSON.stringify(channelCalls)}`);
  }

  const failingEnv = { ...fakeEnv, LEERNESS_NPM_PROBE_EXIT: '7' };
  const channelFailure = runCli(['release', 'channel', sandbox, '--json'], failingEnv);
  let channelFailureJson = null;
  try { channelFailureJson = JSON.parse(String(channelFailure.stdout || '')); } catch {}
  if (channelFailure.status !== 0 || !channelFailureJson || channelFailureJson.distTags !== null) {
    failures.push(`release channel npm view 실패 폴백 오류: exit=${channelFailure.status}`);
  }
  const packFailure = runCli(['release', 'pack', sandbox, '--no-readme-sync'], failingEnv);
  if (packFailure.status !== 1 || !/npm pack 실패/.test(String(packFailure.stdout || ''))) {
    failures.push(`release pack npm 실패 전파 오류: exit=${packFailure.status}`);
  }
  const publishFailure = runCli(['release', 'publish', sandbox, '--dry-run', '--npm-publish'], failingEnv);
  if (publishFailure.status !== 1 || !/npm publish 실패/.test(String(publishFailure.stdout || ''))) {
    failures.push(`release publish npm 실패 전파 오류: exit=${publishFailure.status}`);
  }

  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const refs = Array.from(workflow.matchAll(/uses:\s*actions\/(checkout|setup-node)@(v\d+)/g), match => `${match[1]}@${match[2]}`);
  if (refs.length < 6 || refs.some(ref => !/@v7$/.test(ref))) {
    failures.push(`CI 액션 런타임 major 불일치: ${refs.join(', ') || '(없음)'}`);
  }
  if (!/release-runtime:\s*[\s\S]*node:\s*\[24, 26\]/.test(workflow)
      || !/name:\s*release runtime \(shell-free npm\)/.test(workflow)) {
    failures.push('CI가 전체 게이트와 Node 24/26 매트릭스에서 릴리스 런타임 프로브를 실행하지 않음');
  }
  const fullTestStart = workflow.indexOf('\n  test:');
  const fullTestEnd = workflow.indexOf('\n  release-runtime:', fullTestStart);
  const fullTestJob = fullTestStart >= 0 && fullTestEnd > fullTestStart
    ? workflow.slice(fullTestStart, fullTestEnd) : '';
  if (!/include:\s*[\s\S]*-\s+os:\s*windows-latest\s*[\r\n]+\s*node:\s*24/.test(fullTestJob)
      || !/-\s+name:\s*e2e\s*[\s\S]*run:\s*node \.\/scripts\/e2e\.js/.test(fullTestJob)) {
    failures.push('Windows Node 24 전체 E2E가 CI test 매트릭스에서 실행되지 않음');
  }

  const ciFixture = path.join(sandbox, 'ci-init-fixture');
  fs.mkdirSync(ciFixture, { recursive: true });
  const ciInit = runCli(['ci', 'init', ciFixture, '--force', '--json'], { ...process.env, LEERNESS_OFFLINE: '1' });
  const generatedWorkflowPath = path.join(ciFixture, '.github', 'workflows', 'leerness-gate.yml');
  const generatedWorkflow = fs.existsSync(generatedWorkflowPath) ? fs.readFileSync(generatedWorkflowPath, 'utf8') : '';
  if (ciInit.status !== 0 || !/actions\/checkout@v7/.test(generatedWorkflow)
      || !/actions\/setup-node@v7/.test(generatedWorkflow)
      || !/node-version:\s*'24'/.test(generatedWorkflow)
      || !/package-manager-cache:\s*false/.test(generatedWorkflow)
      || /actions\/(?:checkout|setup-node)@v4/.test(generatedWorkflow)) {
    failures.push(`ci init 생성 워크플로 Node 24 런타임 전환 실패: exit=${ciInit.status}`);
  }

  const cliSource = fs.readFileSync(path.join(root, 'bin', 'leerness.js'), 'utf8');
  const agentsSource = fs.readFileSync(path.join(root, 'lib', 'agents.js'), 'utf8');
  const portableSource = fs.readFileSync(portableProcessPath, 'utf8');
  const npmSource = fs.readFileSync(npmProcessPath, 'utf8');
  const gitSource = fs.readFileSync(gitProcessPath, 'utf8');
  const diagnosticsSource = fs.readFileSync(path.join(root, 'lib', 'diagnostics.js'), 'utf8');
  const runtimeWarningGateSource = fs.readFileSync(runtimeWarningGatePath, 'utf8');
  const historicalE2eSource = fs.readFileSync(path.join(root, 'scripts', 'e2e.js'), 'utf8');
  const deprecatedFixtureSpawns = historicalE2eSource.split(/\r?\n/).filter(line =>
    /cp\.spawnSync\([^,]+,\s*\[[^\]]*\],\s*\{[^}]*shell:\s*true/.test(line));
  if (deprecatedFixtureSpawns.length) {
    failures.push(`역사적 E2E 픽스처에 DEP0190 형태가 남음: ${deprecatedFixtureSpawns.length}곳`);
  }
  if (!historicalE2eSource.includes("spawnNpmSync(['test']")) {
    failures.push('역사적 E2E npm 대조군이 shell-free npm 실행기를 사용하지 않음');
  }
  const deprecatedAgentShapes = [
    'cp.spawnSync(agent.bin,',
    'cp.spawnSync(t.bin,',
    'cp.spawn(cmd, cmdArgs,',
    'cp.spawnSync(extDef.bin,',
    'cp.spawnSync(a.bin,',
    'cp.spawnSync(cmd, versionArgs,',
    "cp.spawnSync('npm',",
    "cp.spawnSync('npx',",
  ].filter(shape => cliSource.includes(shape) || agentsSource.includes(shape));
  if (deprecatedAgentShapes.length) {
    failures.push(`비릴리스 CLI 경로에 shell+argv 후보가 남음: ${deprecatedAgentShapes.join(', ')}`);
  }
  if (!cliSource.includes('spawnPortableSync(bin, finalArgs, spawnOpts)')
      || !agentsSource.includes('_spawnPortable(spec.file, spec.args')
      || /_spawnShellArgv|spawnShellArgv/.test(cliSource + agentsSource)) {
    failures.push('AI CLI의 비스트리밍/bench/stream 실행 경로가 공용 portable argv runner로 수렴하지 않음');
  }
  const benchmarkStart = cliSource.indexOf('async function _benchmarkMeasure');
  const benchmarkEnd = cliSource.indexOf('\nfunction benchmarkCmd', benchmarkStart);
  const benchmarkBlock = benchmarkStart >= 0 && benchmarkEnd > benchmarkStart
    ? cliSource.slice(benchmarkStart, benchmarkEnd) : '';
  if (!benchmarkBlock.includes('runCommandSafe(cmd, cliArgs') || /allowShell\s*:\s*true/.test(benchmarkBlock)) {
    failures.push('benchmark --measure가 portable argv 실행 경로로 수렴하지 않음');
  }
  const executableShellTrue = portableSource.split(/\r?\n/).filter(line =>
    !line.trim().startsWith('//') && /shell\s*:\s*true/.test(line));
  if (executableShellTrue.length || !portableSource.includes('_candidateComesFromPath(candidate, allowedDirs)')
      || !portableSource.includes("launch.kind === 'unresolved'")
      || /:\s*'where\.exe'/.test(portableSource)) {
    failures.push('portable runner가 shell:true 또는 PATH-only cwd-shadow 가드를 잃음');
  }
  if (!gitSource.includes("spawnPortableSync('git'") || /cp\.spawnSync\(['"]git['"]/.test(gitSource)) {
    failures.push('공용 git chokepoint가 portable PATH-only resolver를 우회함');
  }
  if (!npmSource.includes("windowsPathCandidates('npm.cmd'")
      || !npmSource.includes("spawnPortableSync('npm'")
      || /spawnSync\(['"]where(?:\.exe)?['"]/.test(npmSource)) {
    failures.push('공용 npm resolver가 bare where 또는 동적 cmd wrapper로 후퇴함');
  }
  if (!diagnosticsSource.includes("windowsPathCandidates('leerness'") || /spawnSync\(tool,/.test(diagnosticsSource)) {
    failures.push('which 진단이 Windows bare where를 다시 실행함');
  }
  if (cliSource.includes("cp.execSync('npm root -g'") || cliSource.includes("cp.spawnSync('chcp.com'")
      || cliSource.includes("cp.spawnSync('powershell'") || cliSource.includes("cp.spawnSync('powershell.exe'")) {
    failures.push('startup/handoff/release 경로에 cwd-shadow 가능한 bare Windows executable이 남음');
  }
  if (!historicalE2eSource.includes('e2eSpawnSyncWithRuntimeWarningGate')
      || !historicalE2eSource.includes('e2eSpawnWithRuntimeWarningGate')
      || !historicalE2eSource.includes('_injectRuntimeWarningEnv')
      || !historicalE2eSource.includes('withRedirectWarnings')
      || !historicalE2eSource.includes('redirected child warnings')
      || !runtimeWarningGateSource.includes('--redirect-warnings=')
      || !runtimeWarningGateSource.includes('NODE_NO_WARNINGS')
      || !runtimeWarningGateSource.includes('--disable-warning')) {
    failures.push('전체 E2E AP 게이트가 pipe/ignore/async 자식의 DEP0190을 공용 파일로 집계하지 않음');
  }
  if (/removeAllListeners\(['"]warning['"]\)/.test(cliSource)
      || /NODE_OPTIONS\s*=\s*[^\n]*--no-deprecation/.test(cliSource)) {
    failures.push('CLI가 DEP0190를 고치는 대신 런타임 경고를 전역 억제함');
  }
  const pathScriptStart = cliSource.indexOf('function _winPathPsScript');
  const pathScriptEnd = cliSource.indexOf('\nfunction _unixPathBlock', pathScriptStart);
  const pathScriptBlock = pathScriptStart >= 0 && pathScriptEnd > pathScriptStart
    ? cliSource.slice(pathScriptStart, pathScriptEnd) : '';
  if (!pathScriptBlock.includes('$env:LEERNESS_PATH_BIN')
      || /JSON\.stringify\(|`[^`]*\$\{bin\}/.test(pathScriptBlock)) {
    failures.push('Windows PATH 등록 스크립트가 경로 값을 PowerShell 소스에 삽입함');
  }
  const archiveStart = cliSource.indexOf('function _createArchive');
  const archiveEnd = cliSource.indexOf('\nfunction skillPublishCmd', archiveStart);
  const archiveBlock = archiveStart >= 0 && archiveEnd > archiveStart
    ? cliSource.slice(archiveStart, archiveEnd) : '';
  if (!archiveBlock.includes('LEERNESS_ARCHIVE_SOURCE')
      || !archiveBlock.includes('LEERNESS_ARCHIVE_DEST')
      || /Compress-Archive[^\n]*\$\{/.test(archiveBlock)) {
    failures.push('아카이브 PowerShell fallback이 경로 값을 환경 데이터 채널로 전달하지 않음');
  }
  const publishStart = cliSource.indexOf('function _publishToNpm');
  const publishEnd = cliSource.indexOf('\nasync function releasePackCmd', publishStart);
  const publishBlock = publishStart >= 0 && publishEnd > publishStart
    ? cliSource.slice(publishStart, publishEnd) : '';
  if (!publishBlock.includes('spawnNpmSync') || /cp\.spawnSync\(['"]npm['"]|shell:\s*true/.test(publishBlock)) {
    failures.push('_publishToNpm이 shell 없는 공용 npm 실행 경로를 사용하지 않음');
  }
  const releaseStart = cliSource.indexOf('function releasePackCmd');
  const releaseEnd = cliSource.indexOf('// ===== 1.9.7 A:', releaseStart);
  const releaseBlock = releaseStart >= 0 && releaseEnd > releaseStart
    ? cliSource.slice(releaseStart, releaseEnd) : '';
  if (/cp\.spawnSync\(['"]npm['"]/.test(releaseBlock)) {
    failures.push('release pack/publish 경로에 직접 npm spawn이 남아 있음');
  }
} catch (error) {
  failures.push(String(error && (error.stack || error.message) || error));
} finally {
  try { fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch {}
}

if (failures.length) {
  process.stderr.write(`release runtime probe failed:\n- ${failures.join('\n- ')}\n`);
  process.exit(1);
}

process.stdout.write('release runtime probe passed: Node 24 actions + shell-free npm/git + DEP0190-free agent argv\n');
