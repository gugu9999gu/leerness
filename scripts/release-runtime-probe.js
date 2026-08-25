#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const root = path.resolve(__dirname, '..');
const cliPath = path.join(root, 'bin', 'leerness.js');
const npmProcessPath = path.join(root, 'lib', 'npm-process.js');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-release-runtime-'));
const marker = path.join(sandbox, 'shell-injection-marker');
const fakeNpmDir = path.join(sandbox, 'fake-npm');
const fakeNpmCli = path.join(fakeNpmDir, 'npm-cli.js');
const fakeNpmLog = path.join(sandbox, 'fake-npm-calls.jsonl');
const failures = [];

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

try {
  fs.mkdirSync(fakeNpmDir, { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'package.json'), JSON.stringify({ name: 'release-runtime-probe', version: '9.9.9' }) + '\n');
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

process.stdout.write('release runtime probe passed: Node 24 actions + shell-free npm argv\n');
