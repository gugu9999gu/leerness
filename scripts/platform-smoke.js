#!/usr/bin/env node
'use strict';

// Windows/Linux 플랫폼 경계의 빠른 회귀:
// 1) selftest가 Windows 8.3(`RUNNER~1`) 실행 경로를 허용하는지,
// 2) 공유 hooksPath의 같은 pre-commit이 현재 sibling worktree의 handoff를 보는지.
// 전체 e2e의 같은 검증은 Windows에서 80분가량 걸리므로 CI fast 단계에서 먼저 실행한다.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-platform-smoke-'));
const env = Object.assign({}, process.env, {
  TMPDIR: sandbox,
  TEMP: sandbox,
  TMP: sandbox,
  LEERNESS_OFFLINE: '1',
  LEERNESS_NO_PROMPT: '1',
  LEERNESS_NO_STALE_CHECK: '1',
  // 일부 POSIX 셸은 CDPATH를 사용한 cd 성공 경로를 stdout에 출력한다. 훅의 명령 치환이
  // 그 출력에 오염되지 않는지 실제로 검증하도록 일부러 비어 있지 않게 둔다.
  CDPATH: '.',
});
for (const key of [
  'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
  'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'LEERNESS_SESSION_ID', 'CODEX_THREAD_ID',
  'CI', 'GITHUB_ACTIONS', 'CLAUDECODE', 'CURSOR_AGENT', 'CODEX_MANAGED_BY_NPM',
  'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG', 'LEERNESS_ENFORCE_BYPASS',
  'GIT_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_NOSYSTEM',
]) delete env[key];
env.GIT_CONFIG_GLOBAL = path.join(sandbox, 'gitconfig-global');
env.GIT_CONFIG_SYSTEM = path.join(sandbox, 'gitconfig-system');
fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
fs.writeFileSync(env.GIT_CONFIG_SYSTEM, '');

const run = (cmd, args, cwd, timeout = 120000) => cp.spawnSync(cmd, args, {
  cwd,
  env,
  encoding: 'utf8',
  timeout,
  maxBuffer: 32 * 1024 * 1024,
});
const git = (cwd, args) => run('git', args, cwd, 60000);
const leerness = (cwd, args, timeout = 120000) => run(process.execPath, [CLI, ...args], cwd, timeout);
const parseJson = (r) => {
  try { return JSON.parse(String(r.stdout || '')); } catch { return null; }
};
const output = (r) => ({
  status: r && r.status,
  signal: r && r.signal,
  stdout: String((r && r.stdout) || '').slice(0, 500),
  stderr: String((r && r.stderr) || '').slice(0, 500),
  error: r && r.error ? String(r.error.code || r.error.message) : null,
});
const hookPath = (cwd) => {
  const r = git(cwd, ['rev-parse', '--git-path', 'hooks/pre-commit']);
  const raw = String(r.stdout || '').trim();
  return path.isAbsolute(raw) ? raw : path.join(cwd, raw);
};

let failed = null;
let cleanupError = null;
const debug = {};
try {
  // Windows Node 20 runner에서 enforce의 실제 sh 발화 검증까지 포함한 전체 selftest가
  // 120초를 근소하게 넘는다. 전체 E2E보다 먼저 실패를 잡는 fast gate 목적은 유지하되
  // 프로세스를 중간에 잘라 거짓 실패로 만들지 않도록 이 단계만 240초를 허용한다.
  const selftest = leerness(sandbox, ['selftest', '--json'], 240000);
  const selfJson = parseJson(selftest);
  const pathCase = selfJson && Array.isArray(selfJson.results)
    ? selfJson.results.find(row => /Windows 8\.3 tilde/.test(row.name || ''))
    : null;
  const selfFailures = selfJson && Array.isArray(selfJson.results)
    ? selfJson.results.filter(row => row.ok !== true).slice(0, 10)
    : [];
  debug.shortPath = { command: output(selftest), case: pathCase || null, selfFailures };
  if (selftest.error && selftest.error.code === 'ETIMEDOUT') {
    failed = 'platform smoke 선행 selftest가 240초 안에 끝나지 않음';
  } else if (!pathCase || pathCase.ok !== true) {
    failed = 'Windows 8.3 실행 경로 selftest가 통과하지 않음';
  } else if (selftest.status !== 0) {
    failed = `platform smoke 선행 selftest 실패: ${selfFailures.map(row => row.name).join(', ') || '원인 미확인'}`;
  }

  const main = path.join(sandbox, 'main');
  const sibling = path.join(sandbox, 'sibling');
  fs.mkdirSync(main, { recursive: true });
  const setup = [
    git(main, ['init', '-q', '-b', 'main', '.']),
    git(main, ['config', 'user.email', 'platform-smoke@example.invalid']),
    git(main, ['config', 'user.name', 'platform-smoke']),
  ];
  fs.writeFileSync(path.join(main, 'package.json'), '{"name":"platform-smoke","version":"0.0.0"}\n');
  fs.writeFileSync(path.join(main, 'seed.txt'), 'seed\n');
  setup.push(git(main, ['add', '-A']), git(main, ['commit', '-qm', 'seed']));
  const initMain = leerness(main, ['init', main, '--yes', '--minimal', '--no-enforce', '--no-stale-check']);
  const mainHandoff = leerness(main, ['handoff', main]);
  const addWorktree = git(main, ['worktree', 'add', '-qb', 'sibling', sibling]);
  const initSibling = leerness(sibling, ['init', sibling, '--yes', '--minimal', '--no-enforce', '--no-stale-check']);
  for (const marker of [path.join(sibling, '.leerness', 'last-handoff.json'), path.join(sibling, '.leerness', 'cache', 'handoffs')]) {
    try { fs.rmSync(marker, { recursive: true, force: true }); } catch {}
  }
  debug.fixture = {
    setup: setup.map(output), initMain: output(initMain), mainHandoff: output(mainHandoff),
    addWorktree: output(addWorktree), initSibling: output(initSibling),
  };
  if (!failed && (setup.some(r => r.status !== 0) || initMain.status !== 0 || mainHandoff.status !== 0
      || addWorktree.status !== 0 || initSibling.status !== 0)) {
    failed = '공유 훅 worktree 픽스처 생성 실패';
  }

  const actual = path.join(main, '.git', 'shared-hooks');
  const alias = path.join(main, '.git', 'link-hooks');
  fs.mkdirSync(actual, { recursive: true });
  fs.symlinkSync(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const configs = [
    git(main, ['config', 'extensions.worktreeConfig', 'true']),
    git(main, ['config', '--worktree', 'core.hooksPath', alias]),
    git(sibling, ['config', '--worktree', 'core.hooksPath', actual]),
  ];
  const before = parseJson(leerness(main, ['enforce', 'status', '--path', main, '--json']));
  const installResult = leerness(main, ['enforce', 'install', '--path', main, '--json', '--skip-verify']);
  const installed = parseJson(installResult);
  const mainHook = hookPath(main);
  const siblingHook = hookPath(sibling);
  const installedHookBody = fs.existsSync(mainHook) ? fs.readFileSync(mainHook, 'utf8') : '';
  debug.hooks = {
    configs: configs.map(output), before, installed, install: output(installResult),
    mainHook, siblingHook,
    mainHookExists: fs.existsSync(mainHook), siblingHookExists: fs.existsSync(siblingHook),
    sameTarget: fs.existsSync(mainHook) && fs.existsSync(siblingHook)
      ? fs.realpathSync(mainHook) === fs.realpathSync(siblingHook) : false,
    dynamicWorktreeRoot: installedHookBody.includes('LRN_REL=')
      && installedHookBody.includes('git rev-parse --show-toplevel')
      && installedHookBody.includes('CDPATH= cd "$LRN_TOP"'),
  };
  if (!failed && (configs.some(r => r.status !== 0) || !before || before.worktrees !== 2
      || installResult.status !== 0 || !installed || installed.worktrees !== 2
      || !debug.hooks.sameTarget || !debug.hooks.dynamicWorktreeRoot)) {
    failed = '공유 hooksPath를 두 worktree가 함께 본다는 설치 계약 실패';
  }

  // main에는 fresh handoff가 있지만 sibling에는 없다. 공유 훅이 설치한 main 상태를 빌려보지 않고
  // 현재 commit 대상의 toplevel을 계산해야 두 호출 모두 sibling에서 차단된다.
  const directBefore = git(sibling, ['hook', 'run', 'pre-commit']);
  fs.writeFileSync(path.join(sibling, 'platform-probe.txt'), 'probe\n');
  const staged = git(sibling, ['add', '-A']);
  const commitBefore = git(sibling, ['commit', '-m', 'must-block-before-sibling-handoff']);
  const siblingHandoff = leerness(sibling, ['handoff', sibling]);
  const directAfter = git(sibling, ['hook', 'run', 'pre-commit']);
  const commitAfter = git(sibling, ['commit', '-m', 'passes-after-sibling-handoff']);
  debug.lifecycle = {
    directBefore: output(directBefore), staged: output(staged), commitBefore: output(commitBefore),
    siblingHandoff: output(siblingHandoff), directAfter: output(directAfter), commitAfter: output(commitAfter),
  };
  if (!failed && (directBefore.status === 0 || staged.status !== 0 || commitBefore.status === 0
      || siblingHandoff.status !== 0 || directAfter.status !== 0 || commitAfter.status !== 0)) {
    failed = '공유 훅이 sibling handoff 전 차단/후 통과 수명주기를 지키지 않음';
  }
} catch (e) {
  failed = `platform smoke 예외: ${String(e && (e.stack || e.message) || e).slice(0, 800)}`;
} finally {
  try {
    fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 });
    if (fs.existsSync(sandbox)) cleanupError = 'rmSync 뒤에도 sandbox가 남음';
  } catch (e) {
    let remaining = [];
    try { remaining = fs.readdirSync(sandbox).slice(0, 20); } catch {}
    cleanupError = `${String(e && (e.code || e.message) || e).slice(0, 200)}; remaining=${JSON.stringify(remaining)}`;
  }
}

if (cleanupError) {
  debug.cleanup = cleanupError;
  failed = failed ? `${failed}; cleanup 실패: ${cleanupError}` : `sandbox cleanup 실패: ${cleanupError}`;
}

if (failed) {
  process.stderr.write(`platform smoke failed: ${failed}\n${JSON.stringify(debug, null, 2)}\n`);
  process.exit(1);
}
process.stdout.write('platform smoke passed: Windows 8.3 paths + shared-hook sibling handoff lifecycle\n');
