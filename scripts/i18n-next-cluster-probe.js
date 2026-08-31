'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const HANGUL = /[가-힣ㄱ-ㆎ]/;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-i18n-next-'));
const project = path.join(tmp, 'project');

const baseEnv = {
  ...process.env,
  TMPDIR: tmp,
  TEMP: tmp,
  TMP: tmp,
  LEERNESS_INTERNAL: '1',
  LEERNESS_NO_BANNER: '1',
  LEERNESS_NO_STALE_CHECK: '1',
  LEERNESS_OFFLINE: '1',
};
delete baseEnv.LEERNESS_LANG;

function run(args, env = baseEnv) {
  return cp.spawnSync(process.execPath, [CLI, ...args], {
    cwd: project,
    env,
    encoding: 'utf8',
    timeout: 300000,
  });
}

function git(args, extraEnv = {}, input) {
  return cp.spawnSync('git', args, {
    cwd: project,
    env: { ...baseEnv, ...extraEnv },
    encoding: 'utf8',
    timeout: 30000,
    input,
  });
}

function outputOf(result) {
  return String(result.stdout || '') + String(result.stderr || '');
}

function requireSuccess(label, result) {
  const output = outputOf(result);
  if (result.status !== 0 || !output.trim()) {
    throw new Error(`${label} probe command failed or was silent (exit ${result.status}): ${output.slice(0, 500)}`);
  }
  return output;
}

function requireGitSuccess(label, result) {
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status}): ${outputOf(result).slice(0, 500)}`);
  }
}

function hangulLines(output) {
  return String(output).split(/\r?\n/).filter(line => HANGUL.test(line));
}

function requireNoHangul(label, result) {
  const output = requireSuccess(label, result);
  const lines = hangulLines(output);
  if (lines.length) {
    throw new Error(`${label} leaked ${lines.length} Hangul line(s): ${lines.slice(0, 4).join(' | ')}`);
  }
  return output;
}

function normalizedJson(label, result) {
  const output = requireSuccess(label, result);
  let parsed;
  try { parsed = JSON.parse(output); } catch (error) {
    throw new Error(`${label} did not return one JSON document: ${error.message}`);
  }
  if (parsed && typeof parsed === 'object') delete parsed.auditedAt;
  // Milestone ETA is intentionally based on the wall clock. English and Korean
  // probes run in separate processes, so they can legitimately straddle UTC
  // midnight. Validate the public date shape, then remove only that volatility
  // before comparing the locale-independent payloads.
  if (parsed && parsed.next && Object.prototype.hasOwnProperty.call(parsed.next, 'etaDate')) {
    const etaDate = parsed.next.etaDate;
    if (etaDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(etaDate))) {
      throw new Error(`${label} returned an invalid milestone etaDate: ${etaDate}`);
    }
    if (etaDate !== null) parsed.next.etaDate = '<clock-derived-date>';
  }
  return parsed;
}

function cloneProjectState(target) {
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(path.join(project, 'package.json'), path.join(target, 'package.json'));
  fs.cpSync(path.join(project, '.leerness'), path.join(target, '.leerness'), { recursive: true });
}

const surfaces = [
  ['release cadence', ['release', 'cadence', '--path', project]],
  ['idempotency audit', ['idempotency', 'audit', '--path', project]],
  ['plan list', ['plan', 'list', '--path', project]],
  ['round-history', ['round-history', '--path', project]],
  ['milestones', ['milestones', '--path', project]],
];

try {
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"i18n-next-probe","version":"0.1.0"}\n');
  requireSuccess('init', run(['init', project, '--yes', '--language', 'en']));
  requireGitSuccess('git init', git(['init', '-q']));
  requireGitSuccess('git user name', git(['config', 'user.name', 'Leerness Probe']));
  requireGitSuccess('git user email', git(['config', 'user.email', 'probe@example.invalid']));

  requireSuccess('task add', run(['task', 'add', 'Implement the parser', '--path', project]));
  requireSuccess('decision add', run(['decision', 'add', 'Use JSON storage', '--reason', 'simplest', '--path', project]));
  requireSuccess('plan add', run(['plan', 'add', 'Ship the parser', '--path', project]));

  // Stored project language, environment override, and explicit flag must all
  // reach the same English renderer. Flip the stored language to Korean before
  // checking overrides so a disconnected env/flag path cannot pass by falling
  // back to the already-English manifest.
  for (const [label, args] of surfaces) {
    requireNoHangul(`${label} (stored language)`, run(args));
  }
  const manifestFile = path.join(project, '.leerness', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  manifest.language = 'ko';
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  for (const [label, args] of surfaces) {
    requireNoHangul(`${label} (environment language)`, run(args, { ...baseEnv, LEERNESS_LANG: 'en' }));
    requireNoHangul(`${label} (explicit language)`, run([...args, '--language', 'en'], { ...baseEnv, LEERNESS_LANG: 'ko' }));
  }
  manifest.language = 'en';
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

  // Missing and milestone-free plans have separate human branches.
  const planFile = path.join(project, '.leerness', 'plan.md');
  const originalPlan = fs.readFileSync(planFile, 'utf8');
  fs.rmSync(planFile);
  requireNoHangul('plan list missing file', run(['plan', 'list', '--path', project]));
  fs.writeFileSync(planFile, '# Plan\n\n## Milestones\n');
  requireNoHangul('plan list without milestones', run(['plan', 'list', '--path', project]));
  const legacyPlan = originalPlan.replace('Done-When: (unset)', 'Done-When: (미정)');
  if (legacyPlan === originalPlan) throw new Error('plan fixture did not contain the English unset sentinel');
  fs.writeFileSync(planFile, legacyPlan);
  const legacyPlanOutput = requireNoHangul('plan list legacy Korean sentinel', run(['plan', 'list', '--path', project]));
  if (!legacyPlanOutput.includes('Done-When: (unset)')) {
    throw new Error('plan list did not translate the legacy (미정) sentinel to (unset)');
  }
  fs.writeFileSync(planFile, originalPlan);

  // Public add commands normally deduplicate; --force deliberately creates
  // realistic duplicate rows so the violation renderer and auto-fix summary
  // cannot remain Korean while the empty-state probe passes.
  requireSuccess('duplicate rule A', run(['rule', 'add', 'Run tests', '--trigger', 'every-session', '--force', '--path', project]));
  requireSuccess('duplicate rule B', run(['rule', 'add', 'Run tests', '--trigger', 'every-session', '--force', '--path', project]));
  requireSuccess('duplicate task A', run(['task', 'add', 'Resolve duplicate work', '--status', 'in-progress', '--force', '--path', project]));
  requireSuccess('duplicate task B', run(['task', 'add', 'Resolve duplicate work', '--status', 'in-progress', '--force', '--path', project]));
  requireSuccess('duplicate user request seed', run(['requests', 'add', 'Resolve duplicate request', '--path', project]));
  const requestFile = path.join(project, '.leerness', 'user-requests.json');
  const requestState = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
  const requestSeed = requestState.requests[requestState.requests.length - 1];
  requestState.requests.push({ ...requestSeed, id: 'UR-9000', recordedAt: '2026-08-30T00:00:00.000Z' });
  fs.writeFileSync(requestFile, JSON.stringify(requestState, null, 2) + '\n');
  requireNoHangul('idempotency violation report', run(['idempotency', 'audit', '--path', project]));

  // --auto-fix mutates its target, so compare two byte-identical fresh clones.
  // This catches locale-dependent JSON fields as well as locale-dependent state
  // writes that a post-fix clean audit would miss.
  const autoFixEnProject = path.join(tmp, 'autofix-en');
  const autoFixKoProject = path.join(tmp, 'autofix-ko');
  cloneProjectState(autoFixEnProject);
  cloneProjectState(autoFixKoProject);
  const autoFixEn = normalizedJson('idempotency auto-fix English JSON', run(
    ['idempotency', 'audit', '--auto-fix', '--json', '--path', autoFixEnProject],
    { ...baseEnv, LEERNESS_LANG: 'en' }
  ));
  const autoFixKo = normalizedJson('idempotency auto-fix Korean JSON', run(
    ['idempotency', 'audit', '--auto-fix', '--json', '--path', autoFixKoProject],
    { ...baseEnv, LEERNESS_LANG: 'ko' }
  ));
  if (JSON.stringify(autoFixEn) !== JSON.stringify(autoFixKo)) {
    throw new Error('idempotency auto-fix JSON contract changed with UI language');
  }
  const enProgress = fs.readFileSync(path.join(autoFixEnProject, '.leerness', 'progress-tracker.md'));
  const koProgress = fs.readFileSync(path.join(autoFixKoProject, '.leerness', 'progress-tracker.md'));
  if (!enProgress.equals(koProgress)) throw new Error('idempotency auto-fix wrote locale-dependent progress-tracker.md');
  const enRequests = JSON.parse(fs.readFileSync(path.join(autoFixEnProject, '.leerness', 'user-requests.json'), 'utf8'));
  const koRequests = JSON.parse(fs.readFileSync(path.join(autoFixKoProject, '.leerness', 'user-requests.json'), 'utf8'));
  delete enRequests.updatedAt;
  delete koRequests.updatedAt;
  if (JSON.stringify(enRequests) !== JSON.stringify(koRequests)) {
    throw new Error('idempotency auto-fix wrote locale-dependent user-requests.json');
  }
  requireNoHangul('idempotency auto-fix report', run(['idempotency', 'audit', '--auto-fix', '--path', project]));

  // Two annotated tags with distinct creation times exercise measured cadence
  // and non-empty round history rather than only the insufficient-data branch.
  requireGitSuccess('git add first snapshot', git(['add', '-A']));
  const firstDate = '2026-08-28T00:00:00+09:00';
  requireGitSuccess('git commit first snapshot', git(['commit', '-qm', 'first'], {
    GIT_AUTHOR_DATE: firstDate,
    GIT_COMMITTER_DATE: firstDate,
  }));
  requireGitSuccess('git tag first snapshot', git(['tag', '-a', 'v1.0.0', '-m', 'v1.0.0'], {
    GIT_COMMITTER_DATE: firstDate,
  }));
  fs.writeFileSync(path.join(project, 'history.txt'), 'second\n');
  requireGitSuccess('git add second snapshot', git(['add', 'history.txt']));
  const secondDate = '2026-08-29T00:00:00+09:00';
  requireGitSuccess('git commit second snapshot', git(['commit', '-qm', 'second'], {
    GIT_AUTHOR_DATE: secondDate,
    GIT_COMMITTER_DATE: secondDate,
  }));
  requireGitSuccess('git tag second snapshot', git(['tag', '-a', 'v1.0.1', '-m', 'v1.0.1'], {
    GIT_COMMITTER_DATE: secondDate,
  }));
  // Reach R25 without manufacturing another 23 commits. Annotated tags have
  // independent creation times, which is exactly the evidence milestones
  // consumes, and exercise reached/next/ETA rendering in one small fixture.
  for (let i = 2; i < 25; i++) {
    const version = `v1.0.${i}`;
    const tagDate = `2026-08-29T00:${String(i).padStart(2, '0')}:00+09:00`;
    requireGitSuccess(`git tag ${version}`, git(['tag', '-a', version, '-m', version], {
      GIT_COMMITTER_DATE: tagDate,
    }));
  }
  requireNoHangul('release cadence with measured history', run(['release', 'cadence', '--path', project]));
  requireNoHangul('round-history with tags', run(['round-history', '--path', project]));
  requireNoHangul('milestones with reached history', run(['milestones', '--path', project]));

  // Machine payloads remain the canonical, locale-independent contract. The
  // idempotency timestamp is intentionally volatile and is normalized only
  // for this equality assertion.
  for (const [label, args] of surfaces) {
    const en = normalizedJson(`${label} English JSON`, run([...args, '--json']));
    const ko = normalizedJson(`${label} Korean JSON`, run([...args, '--json'], { ...baseEnv, LEERNESS_LANG: 'ko' }));
    if (JSON.stringify(en) !== JSON.stringify(ko)) {
      throw new Error(`${label} JSON contract changed with UI language`);
    }
  }

  const koEnv = { ...baseEnv, LEERNESS_LANG: 'ko' };
  const koreanAnchors = new Map([
    ['release cadence', ['릴리스 빈도 진단', '누적 릴리스', '권장:']],
    ['idempotency audit', ['위반 발견', '중복 룰']],
    ['plan list', ['완료기준(Done-When)', 'Tasks:', '완료)']],
    ['round-history', ['자율 라운드 통계', '누적 라운드', '최근 10 tags']],
    ['milestones', ['도달 마일스톤', '총 라운드', '다음 마일스톤', '라운드 남음']],
  ]);
  for (const [label, args] of surfaces) {
    const output = requireSuccess(`${label} Korean control`, run(args, koEnv));
    const missing = koreanAnchors.get(label).filter(anchor => !output.includes(anchor));
    if (missing.length) throw new Error(`${label} Korean control lost anchors: ${missing.join(', ')}`);
  }

  // Exercise the terminal 500+ renderer without spawning another 475 `git tag`
  // processes. Lightweight semver refs are valid release tags and one atomic
  // update-ref process gives the real CLI a 500-tag history.
  const headResult = git(['rev-parse', 'HEAD']);
  requireGitSuccess('git resolve terminal milestone fixture', headResult);
  const head = String(headResult.stdout || '').trim();
  const refs = [];
  for (let i = 25; i < 500; i++) refs.push(`create refs/tags/v1.0.${i} ${head}`);
  requireGitSuccess('git create terminal milestone fixture', git(['update-ref', '--stdin'], {}, refs.join('\n') + '\n'));
  const terminalEn = requireNoHangul('milestones all reached (English)', run(['milestones', '--path', project, '--language', 'en']));
  if (!terminalEn.includes('all milestones reached (500+)')) {
    throw new Error('milestones English terminal branch lost its 500+ completion marker');
  }
  const terminalKo = requireSuccess('milestones all reached (Korean)', run(['milestones', '--path', project], koEnv));
  if (!terminalKo.includes('모든 마일스톤 달성 (500+)')) {
    throw new Error('milestones Korean terminal branch lost its 500+ completion marker');
  }
  const terminalJson = normalizedJson('milestones terminal JSON', run(['milestones', '--path', project, '--json']));
  if (terminalJson.totalRounds !== 500 || terminalJson.next !== null
      || !Array.isArray(terminalJson.reached) || terminalJson.reached.at(-1)?.milestone !== 500) {
    throw new Error('milestones terminal JSON did not preserve the 500-round contract');
  }

  console.log('✓ Five next-cluster English surfaces contain no Hangul across locale paths and edge states; 5/5 Korean controls and JSON contracts remain intact');
} catch (error) {
  console.error(`✗ ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
