#!/usr/bin/env node
'use strict';

// T-0136: default handoff is a tracked-workspace read boundary while ignored,
// per-session presence records retain concurrent agent identity and freshness.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const LOCK_PROBE = path.resolve(__dirname, 'lock-probe.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-handoff-readonly-'));
const baseEnv = {
  ...process.env,
  CI: '',
  GITHUB_ACTIONS: '',
  LEERNESS_HOOK: '',
  LEERNESS_INTERNAL: '',
  CLAUDE_CODE_CHILD_SESSION: '',
  LEERNESS_OFFLINE: '1',
  LEERNESS_NO_PROMPT: '1',
  LEERNESS_NO_LOCK_WARN: '1',
  LEERNESS_SESSION_ID: 'probe-session-0001'
};
const checks = [];

function run(bin, args, opts = {}) {
  return cp.spawnSync(bin, args, {
    cwd: root,
    env: opts.env || baseEnv,
    input: opts.input,
    encoding: 'utf8',
    timeout: opts.timeout || 90000
  });
}

function must(label, result) {
  if (result.status === 0) return result;
  throw new Error(`${label} failed (exit ${result.status})\n${result.stdout || ''}\n${result.stderr || ''}`);
}

function assert(label, condition, detail) {
  checks.push({ label, ok: !!condition, detail: condition ? undefined : detail });
}

function git(args) {
  const result = run('git', args);
  must(`git ${args.join(' ')}`, result);
  return result.stdout || '';
}

function handoffEnv(sessionId) {
  return { ...baseEnv, LEERNESS_SESSION_ID: sessionId };
}

function addresslessEnv() {
  const env = { ...baseEnv };
  for (const key of ['LEERNESS_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID']) delete env[key];
  return env;
}

function spawnHandoff(sessionId) {
  return new Promise(resolve => {
    const child = cp.spawn(process.execPath, [CLI, 'handoff', root, '--quiet', '--no-drift-check'], {
      cwd: root,
      env: handoffEnv(sessionId),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ sessionId, status, stdout, stderr }));
  });
}

function spawnCli(args, env, nodeArgs = []) {
  return new Promise(resolve => {
    const child = cp.spawn(process.execPath, [...nodeArgs, CLI, ...args], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

async function waitForJson(file, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for probe observation: ${file}`);
}

(async () => {
  must('leerness init', run(process.execPath, [CLI, 'init', root, '--yes', '--minimal', '--language', 'ko']));
  git(['init']);
  git(['config', 'user.email', 'handoff-probe@example.invalid']);
  git(['config', 'user.name', 'leerness handoff probe']);
  git(['add', '-A']);
  git(['commit', '-m', 'fixture']);

  must('default handoff', run(process.execPath, [CLI, 'handoff', root, '--no-drift-check']));
  const initialStatus = git(['status', '--porcelain=v1', '--untracked-files=all']).trim();
  assert('default handoff leaves tracked workspace clean', initialStatus === '', initialStatus);
  for (const file of ['environment.json', 'last-handoff.json', 'tech-profile.json']) {
    assert(`default handoff does not create .harness/${file}`,
      !fs.existsSync(path.join(root, '.harness', file)), file);
  }
  const sessionDir = path.join(root, '.harness', 'cache', 'sessions');
  const firstRecord = JSON.parse(fs.readFileSync(path.join(sessionDir, 'probe-session-0001.json'), 'utf8'));
  assert('session freshness is stored in ignored per-session record',
    firstRecord.sessionKey === 'probe-session-0001' && firstRecord.handoffCount === 1
      && Array.isArray(firstRecord.handoffHistory) && firstRecord.handoffHistory.length === 1,
    firstRecord);
  const addressedChildId = 'addressed-child-0001';
  must('child handoff with inherited explicit id', run(process.execPath,
    [CLI, 'handoff', root, '--quiet', '--no-drift-check'],
    { env: { ...handoffEnv(addressedChildId), CLAUDE_CODE_CHILD_SESSION: '1' } }));
  assert('child does not merge inherited explicit id into parent presence',
    !fs.existsSync(path.join(sessionDir, `${addressedChildId}.json`)), addressedChildId);
  const freshnessDir = path.join(root, '.harness', 'cache', 'handoffs');
  const proveAddressedEnforcement = (label, beforeEnv, expectedKey, handoffRunEnv = beforeEnv, afterEnv = beforeEnv) => {
    const before = run(process.execPath,
      [CLI, 'enforce', 'check', '--path', root, '--json'], { env: beforeEnv });
    assert(`${label}: enforce check blocks before this session handoff`, before.status !== 0,
      { status: before.status, stdout: before.stdout, stderr: before.stderr });
    const fixtureName = `session-${label.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()}.txt`;
    fs.writeFileSync(path.join(root, fixtureName), `${label}\n`, 'utf8');
    must(`${label}: stage`, run('git', ['add', '-A'], { env: beforeEnv }));
    const blocked = run('git', ['commit', '-m', `${label} waits for own handoff`], { env: beforeEnv });
    assert(`${label}: git hook blocks before this session handoff`, blocked.status !== 0,
      { status: blocked.status, stdout: blocked.stdout, stderr: blocked.stderr });
    must(`${label}: handoff`, run(process.execPath,
      [CLI, 'handoff', root, '--quiet', '--no-drift-check'], { env: handoffRunEnv }));
    assert(`${label}: handoff writes the expected normalized marker`,
      fs.existsSync(path.join(freshnessDir, `${expectedKey}.json`)), expectedKey);
    const after = must(`${label}: enforce check after handoff`, run(process.execPath,
      [CLI, 'enforce', 'check', '--path', root, '--json'], { env: afterEnv }));
    assert(`${label}: enforce check accepts only after this session handoff`,
      JSON.parse(after.stdout).ok === true, after.stdout);
    const committed = run('git', ['commit', '-m', `${label} own handoff passes`], { env: afterEnv });
    assert(`${label}: git hook accepts only after this session handoff`, committed.status === 0,
      { status: committed.status, stdout: committed.stdout, stderr: committed.stderr });
  };
  const firstFreshness = JSON.parse(fs.readFileSync(path.join(freshnessDir, 'probe-session-0001.json'), 'utf8'));
  assert('handoff-only freshness marker is separate from presence lifecycle',
    firstFreshness.sessionKey === 'probe-session-0001' && Number.isFinite(Date.parse(firstFreshness.last || '')),
    firstFreshness);

  const noAddress = addresslessEnv();
  must('addressless default handoff', run(process.execPath,
    [CLI, 'handoff', root, '--quiet', '--no-drift-check'], { env: noAddress }));
  const anonymousMarker = path.join(freshnessDir, 'unaddressed.json');
  assert('addressless handoff records ignored enforcement freshness', fs.existsSync(anonymousMarker), anonymousMarker);
  const afterAddressless = git(['status', '--porcelain=v1', '--untracked-files=all']).trim();
  assert('addressless handoff keeps tracked workspace clean', afterAddressless === '', afterAddressless);

  // 설치 probe가 marker를 실제로 쓰고 lock을 쥔 바로 그 순간에 실제 handoff를 겹친다. 종료 뒤만 보면
  // 고정 키 회귀나 lock 제거가 cleanup에 가려질 수 있으므로, preload 계측이 rename 직전 상태를 알려 준다.
  const syntheticMarker = path.join(freshnessDir, 'leerness-enforce-probe.json');
  const syntheticBefore = JSON.stringify({ schemaVersion: 1, sessionKey: 'leerness-enforce-probe', last: '2001-01-01T00:00:00.000Z', history: [] }, null, 2) + '\n';
  fs.writeFileSync(syntheticMarker, syntheticBefore, 'utf8');
  const syntheticTime = new Date('2001-01-01T00:00:00.000Z');
  fs.utimesSync(syntheticMarker, syntheticTime, syntheticTime);
  const readyFile = path.join(os.tmpdir(), `leerness-enforce-observe-${process.pid}-${Date.now()}.json`);
  const observedEnv = {
    ...noAddress,
    LOCKPROBE_STALL_PREFIX: 'cache/handoffs/',
    LOCKPROBE_STALL_MS: '3000',
    LOCKPROBE_READY_FILE: readyFile
  };
  const installPromise = spawnCli(['enforce', 'install', '--path', root, '--json'], observedEnv,
    ['--require', LOCK_PROBE]);
  const during = await waitForJson(readyFile);
  const duringSyntheticStat = fs.statSync(syntheticMarker);
  assert('enforce verification uses a reserved per-invocation marker while installation is still running',
    /^cache\/handoffs\/leerness-internal-probe-[a-f0-9]{24}\.json$/.test(during.target || ''), during);
  assert('enforce verification holds the exact marker lock at the observed write',
    during.locked === true && Array.isArray(during.heldOn) && during.heldOn.includes(`${during.target}.lock`), during);
  assert('running enforce verification has not touched the user-addressable marker bytes',
    fs.readFileSync(syntheticMarker, 'utf8') === syntheticBefore, syntheticMarker);
  assert('running enforce verification has not touched the user-addressable marker mtime',
    Math.abs(duringSyntheticStat.mtimeMs - syntheticTime.getTime()) < 1000,
    { expected: syntheticTime.toISOString(), actual: duringSyntheticStat.mtime.toISOString() });
  const concurrentHandoffPromise = spawnHandoff('leerness-enforce-probe');
  const [installRun, concurrentHandoff] = await Promise.all([installPromise, concurrentHandoffPromise]);
  must('enforce install', installRun);
  must('real handoff overlapping enforce verification', concurrentHandoff);
  const install = JSON.parse(installRun.stdout);
  assert('enforce hook installation is behaviorally verified', install.ok === true && install.verified === 'fired', install);
  const syntheticAfterStat = fs.statSync(syntheticMarker);
  const syntheticAfter = JSON.parse(fs.readFileSync(syntheticMarker, 'utf8'));
  assert('overlapping real handoff survives enforce verification cleanup',
    syntheticAfter.sessionKey === 'leerness-enforce-probe'
      && Date.now() - syntheticAfterStat.mtimeMs < 60000,
    { record: syntheticAfter, mtime: syntheticAfterStat.mtime.toISOString() });
  assert('enforce installation cleans every internal probe marker',
    fs.readdirSync(freshnessDir).every(name => !name.startsWith('leerness-internal-probe-')),
    fs.readdirSync(freshnessDir));
  try { fs.unlinkSync(readyFile); } catch {}
  fs.unlinkSync(syntheticMarker);
  const reinstallRun = must('enforce reinstall without prior synthetic marker', run(process.execPath,
    [CLI, 'enforce', 'install', '--path', root, '--json'], { env: noAddress }));
  assert('enforce reinstallation is behaviorally verified', JSON.parse(reinstallRun.stdout).verified === 'fired', reinstallRun.stdout);
  assert('enforce reinstallation leaves no internal probe marker',
    fs.readdirSync(freshnessDir).every(name => !name.startsWith('leerness-internal-probe-')),
    fs.readdirSync(freshnessDir));
  const anonymousCheck = must('addressless enforce check', run(process.execPath,
    [CLI, 'enforce', 'check', '--path', root, '--json'], { env: noAddress }));
  const anonymousCheckJson = JSON.parse(anonymousCheck.stdout);
  assert('enforce check accepts a real addressless handoff', anonymousCheckJson.ok === true, anonymousCheckJson);
  fs.writeFileSync(path.join(root, 'addressless-commit.txt'), 'addressless handoff\n', 'utf8');
  must('stage addressless commit', run('git', ['add', '-A'], { env: noAddress }));
  const addresslessCommit = run('git', ['commit', '-m', 'addressless handoff passes hook'], { env: noAddress });
  assert('git hook accepts a real addressless handoff', addresslessCommit.status === 0,
    { status: addresslessCommit.status, stdout: addresslessCommit.stdout, stderr: addresslessCommit.stderr });

  // 구버전 global 파일이 방금 갱신됐어도 주소가 있는 세션은 자기 marker 없이는 통과하면 안 된다.
  const legacyPath = path.join(root, '.harness', 'last-handoff.json');
  const legacyNow = new Date().toISOString();
  fs.writeFileSync(legacyPath, JSON.stringify({ last: legacyNow, history: [legacyNow] }, null, 2) + '\n', 'utf8');
  proveAddressedEnforcement('legacy-isolation', handoffEnv('legacy-isolation-session'), 'legacy-isolation-session');

  // 내부 anonymous 슬롯명은 사용자 주소로 쓸 수 없다. 대소문자 변형도 예약어로 거부하고
  // 다음 유효 source를 선택해야 하며, 이미 신선한 anonymous marker를 빌려서는 안 된다.
  const reservedFallbackId = 'reserved-fallback-0001';
  const reservedFallbackEnv = {
    ...noAddress,
    LEERNESS_SESSION_ID: 'UNADDRESSED',
    CODEX_THREAD_ID: reservedFallbackId
  };
  proveAddressedEnforcement('reserved-anonymous-key', reservedFallbackEnv, reservedFallbackId);

  const reservedProbeFallbackId = 'reserved-probe-fallback-0001';
  const reservedProbeFallbackEnv = {
    ...noAddress,
    LEERNESS_SESSION_ID: 'LEERNESS-INTERNAL-PROBE-0001',
    CODEX_THREAD_ID: reservedProbeFallbackId
  };
  proveAddressedEnforcement('reserved-probe-prefix', reservedProbeFallbackEnv, reservedProbeFallbackId);

  // 잘못된 명시 주소가 있어도 JS와 shell hook 모두 다음 유효 source(CODEX_THREAD_ID)를 선택해야 한다.
  // fallback 세션에는 아직 marker가 없지만 다른 세션 marker는 여러 개 있으므로, wildcard 오수용도 함께 검증된다.
  const fallbackId = 'fallback-session-0002';
  const malformedFallbackEnv = {
    ...noAddress,
    LEERNESS_SESSION_ID: 'bad!',
    CODEX_THREAD_ID: fallbackId
  };
  const fallbackCheckBefore = run(process.execPath,
    [CLI, 'enforce', 'check', '--path', root, '--json'], { env: malformedFallbackEnv });
  assert('invalid explicit key cannot borrow another session marker in enforce check', fallbackCheckBefore.status !== 0,
    { status: fallbackCheckBefore.status, stdout: fallbackCheckBefore.stdout, stderr: fallbackCheckBefore.stderr });
  fs.writeFileSync(path.join(root, 'fallback-address.txt'), 'fallback session\n', 'utf8');
  must('stage fallback-address commit', run('git', ['add', '-A'], { env: malformedFallbackEnv }));
  const fallbackCommitBefore = run('git', ['commit', '-m', 'must wait for fallback handoff'], { env: malformedFallbackEnv });
  assert('invalid explicit key cannot make git hook wildcard-match another session', fallbackCommitBefore.status !== 0,
    { status: fallbackCommitBefore.status, stdout: fallbackCommitBefore.stdout, stderr: fallbackCommitBefore.stderr });
  must('fallback-address handoff', run(process.execPath,
    [CLI, 'handoff', root, '--quiet', '--no-drift-check'], { env: malformedFallbackEnv }));
  assert('handoff records the valid fallback session key',
    fs.existsSync(path.join(freshnessDir, `${fallbackId}.json`)), fallbackId);
  const fallbackCheckAfter = must('fallback-address enforce check', run(process.execPath,
    [CLI, 'enforce', 'check', '--path', root, '--json'], { env: malformedFallbackEnv }));
  assert('enforce check accepts the same valid fallback after its own handoff',
    JSON.parse(fallbackCheckAfter.stdout).ok === true, fallbackCheckAfter.stdout);
  const fallbackCommitAfter = run('git', ['commit', '-m', 'fallback handoff passes hook'], { env: malformedFallbackEnv });
  assert('git hook accepts the same valid fallback after its own handoff', fallbackCommitAfter.status === 0,
    { status: fallbackCommitAfter.status, stdout: fallbackCommitAfter.stdout, stderr: fallbackCommitAfter.stderr });

  // JS와 shell이 같은 case-fold 규칙 및 KEY_RE 경계(8/64자)를 실제 check+commit 양쪽에서 사용한다.
  const caseBeforeEnv = handoffEnv('CaseFoldSession01');
  const caseAfterEnv = handoffEnv('CASEFOLDSESSION01');
  proveAddressedEnforcement('case-fold', caseBeforeEnv, 'casefoldsession01', caseBeforeEnv, caseAfterEnv);
  proveAddressedEnforcement('key-boundary-8', handoffEnv('edge0001'), 'edge0001');
  const maxKey = 'B'.repeat(64);
  proveAddressedEnforcement('key-boundary-64', handoffEnv(maxKey), maxKey.toLowerCase());

  // 추론 주소는 child 세션에서 억제된다. 후보 세션 marker가 신선해도 anonymous marker/legacy가
  // 없거나 오래됐으면 차단하고, child가 직접 handoff해 anonymous marker를 만든 뒤에만 통과한다.
  const childCandidate = 'child-candidate-0001';
  const childParentEnv = { ...noAddress, CODEX_THREAD_ID: childCandidate };
  must('seed child candidate marker', run(process.execPath,
    [CLI, 'handoff', root, '--quiet', '--no-drift-check'], { env: childParentEnv }));
  if (fs.existsSync(anonymousMarker)) fs.unlinkSync(anonymousMarker);
  const legacyOld = new Date(Date.now() - 72 * 3600000);
  fs.utimesSync(legacyPath, legacyOld, legacyOld);
  const childEnv = { ...childParentEnv, CLAUDE_CODE_CHILD_SESSION: '1' };
  const childBefore = run(process.execPath,
    [CLI, 'enforce', 'check', '--path', root, '--json'], { env: childEnv });
  assert('child suppression: enforce check does not borrow inferred parent marker or stale legacy', childBefore.status !== 0,
    { status: childBefore.status, stdout: childBefore.stdout, stderr: childBefore.stderr });
  fs.writeFileSync(path.join(root, 'child-suppression.txt'), 'child suppression\n', 'utf8');
  must('stage child suppression', run('git', ['add', '-A'], { env: childEnv }));
  const childCommitBefore = run('git', ['commit', '-m', 'child waits for anonymous handoff'], { env: childEnv });
  assert('child suppression: git hook does not borrow inferred parent marker or stale legacy', childCommitBefore.status !== 0,
    { status: childCommitBefore.status, stdout: childCommitBefore.stdout, stderr: childCommitBefore.stderr });
  must('child addressless handoff', run(process.execPath,
    [CLI, 'handoff', root, '--quiet', '--no-drift-check'], { env: childEnv }));
  assert('child suppression: handoff uses anonymous marker', fs.existsSync(anonymousMarker), anonymousMarker);
  const childAfter = must('child enforce check after anonymous handoff', run(process.execPath,
    [CLI, 'enforce', 'check', '--path', root, '--json'], { env: childEnv }));
  assert('child suppression: enforce check accepts its anonymous handoff', JSON.parse(childAfter.stdout).ok === true, childAfter.stdout);
  const childCommitAfter = run('git', ['commit', '-m', 'child anonymous handoff passes'], { env: childEnv });
  assert('child suppression: git hook accepts its anonymous handoff', childCommitAfter.status === 0,
    { status: childCommitAfter.status, stdout: childCommitAfter.stdout, stderr: childCommitAfter.stderr });

  const closeOnlyId = 'close-only-session';
  const closeOnlyEnv = handoffEnv(closeOnlyId);
  must('close-only session', run(process.execPath,
    [CLI, 'session', 'close', root, '--json'], { env: closeOnlyEnv, timeout: 180000 }));
  const closeOnlyRecord = JSON.parse(fs.readFileSync(path.join(sessionDir, `${closeOnlyId}.json`), 'utf8'));
  assert('session close does not invent a handoff timestamp',
    closeOnlyRecord.handoffCount === 0 && closeOnlyRecord.lastHandoffAt === null,
    closeOnlyRecord);
  assert('session close does not create a handoff-only marker',
    !fs.existsSync(path.join(freshnessDir, `${closeOnlyId}.json`)), closeOnlyId);
  const closeOnlyCheck = run(process.execPath,
    [CLI, 'enforce', 'check', '--path', root, '--json'], { env: closeOnlyEnv });
  assert('session close alone cannot satisfy enforce check', closeOnlyCheck.status !== 0,
    { status: closeOnlyCheck.status, stdout: closeOnlyCheck.stdout, stderr: closeOnlyCheck.stderr });
  must('stage close-only changes', run('git', ['add', '-A'], { env: closeOnlyEnv }));
  const closeOnlyCommit = run('git', ['commit', '-m', 'close alone must not pass hook'], { env: closeOnlyEnv });
  assert('session close alone cannot satisfy git hook', closeOnlyCommit.status !== 0,
    { status: closeOnlyCommit.status, stdout: closeOnlyCommit.stdout, stderr: closeOnlyCommit.stderr });
  must('commit close-only fixture with prior real handoff', run('git',
    ['commit', '-m', 'record close-only fixture'], { env: baseEnv }));

  const parallelIds = Array.from({ length: 8 }, (_, index) => `parallel-session-${String(index + 1).padStart(2, '0')}`);
  const parallel = await Promise.all(parallelIds.map(spawnHandoff));
  assert('parallel handoff processes all exit successfully', parallel.every(item => item.status === 0), parallel);
  const missing = parallelIds.filter(id => !fs.existsSync(path.join(sessionDir, `${id}.json`)));
  assert('parallel handoffs retain every unique session record', missing.length === 0, missing);
  const wrongCounts = parallelIds.filter(id => {
    const record = JSON.parse(fs.readFileSync(path.join(sessionDir, `${id}.json`), 'utf8'));
    return record.sessionKey !== id || record.handoffCount !== 1 || record.handoffHistory.length !== 1;
  });
  assert('parallel handoffs do not merge or overwrite another session', wrongCounts.length === 0, wrongCounts);
  const afterParallel = git(['status', '--porcelain=v1', '--untracked-files=all']).trim();
  assert('parallel handoffs keep git status clean', afterParallel === '', afterParallel);

  fs.writeFileSync(path.join(root, '.harness', 'HARNESS_VERSION'), '9.9.9\n', 'utf8');
  git(['add', '.harness/HARNESS_VERSION']);
  git(['commit', '-m', 'version skew fixture']);
  const skewText = must('version skew text handoff', run(process.execPath,
    [CLI, 'handoff', root, '--compact', '--no-drift-check'], { env: handoffEnv('version-skew-text') }));
  assert('human handoff warns when CLI is older than project harness',
    /버전 불일치/.test(skewText.stdout) && /9\.9\.9/.test(skewText.stdout), skewText.stdout);
  const skewJsonRun = must('version skew json handoff', run(process.execPath,
    [CLI, 'handoff', root, '--json', '--no-drift-check'], { env: handoffEnv('version-skew-json') }));
  const skewJson = JSON.parse(skewJsonRun.stdout);
  assert('JSON handoff exposes machine-readable version skew',
    skewJson.versionSkew && skewJson.versionSkew.kind === 'cli-older'
      && skewJson.versionSkew.harnessVersion === '9.9.9', skewJson.versionSkew);
  const afterSkew = git(['status', '--porcelain=v1', '--untracked-files=all']).trim();
  assert('version skew warning path remains tracked-workspace clean', afterSkew === '', afterSkew);

  const cursorDir = path.join(root, '.cursor');
  fs.mkdirSync(cursorDir, { recursive: true });
  fs.writeFileSync(path.join(cursorDir, 'hooks.json'), JSON.stringify({
    version: 1,
    hooks: {
      afterFileEdit: [{ command: 'node custom-after-edit.js' }],
      sessionStart: [{ command: 'node custom-session-start.js' }]
    }
  }, null, 2) + '\n');
  must('cursor adapter', run(process.execPath, [CLI, 'adapter', 'cursor', '--path', root]));
  const hooksPath = path.join(cursorDir, 'hooks.json');
  const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  const starts = hooks.hooks.sessionStart.map(item => item.command);
  assert('cursor adapter preserves existing hooks',
    hooks.hooks.afterFileEdit[0].command === 'node custom-after-edit.js'
      && starts.includes('node custom-session-start.js'), hooks);
  assert('cursor adapter adds exactly one leerness sessionStart hook',
    starts.filter(command => command === 'node .cursor/hooks/leerness-session.cjs').length === 1, starts);
  const hookScript = path.join(cursorDir, 'hooks', 'leerness-session.cjs');
  const hookRun = must('cursor sessionStart hook', run(process.execPath, [hookScript], {
    input: JSON.stringify({ hook_event_name: 'sessionStart', session_id: 'cursor-conversation-0001' })
  }));
  const hookOutput = JSON.parse(hookRun.stdout);
  assert('cursor sessionStart maps conversation id to LEERNESS_SESSION_ID',
    hookOutput.env && hookOutput.env.LEERNESS_SESSION_ID === 'cursor-conversation-0001', hookOutput);
  const beforeSecondAdapter = fs.readFileSync(hooksPath, 'utf8');
  must('cursor adapter idempotence', run(process.execPath, [CLI, 'adapter', 'cursor', '--path', root]));
  const afterSecondAdapter = fs.readFileSync(hooksPath, 'utf8');
  assert('cursor adapter hook merge is idempotent', beforeSecondAdapter === afterSecondAdapter, starts);

  const failed = checks.filter(check => !check.ok);
  process.stdout.write(JSON.stringify({ ok: failed.length === 0, checks: checks.length, failed, parallel: parallel.length }) + '\n');
  if (failed.length) process.exitCode = 1;
})().catch(error => {
  process.stderr.write(`${error && error.stack || error}\n`);
  process.exitCode = 1;
}).finally(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
});
