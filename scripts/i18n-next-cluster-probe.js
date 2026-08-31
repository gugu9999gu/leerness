'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const HANGUL = /\p{Script=Hangul}/u;
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
delete baseEnv.LEERNESS_SKILLPACK_PATH;

function run(args, env = baseEnv, cwd = project) {
  return cp.spawnSync(process.execPath, [CLI, ...args], {
    cwd,
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
  ['skill list', ['skill', 'list', '--path', project]],
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

  // A user skill may predate English catalog fields or contain malformed
  // legacy usage metadata. English mode must not fall back to Korean-only
  // presentation fields, leak a non-numeric count, or call string methods on
  // a numeric timestamp. JSON keeps those canonical source values unchanged.
  const koreanOnlySkillDir = path.join(project, '.leerness', 'skills', 'korean-only');
  fs.mkdirSync(koreanOnlySkillDir, { recursive: true });
  fs.writeFileSync(path.join(koreanOnlySkillDir, 'skill.json'), JSON.stringify({
    name: 'korean-only',
    displayNameKo: '한국어 전용 사용자 스킬',
    displayNameEn: 'ㄴ invalid English label',
    version: '1.0.0',
    lastUpdated: '마지막',
    verification: 'unverified',
    capabilities: ['한국어 기능 설명'],
    capabilitiesEn: ['ㄷ invalid English capability'],
    usage: { count: '한국어 횟수', lastUsed: 1725062400000 },
  }, null, 2) + '\n');
  const unsafeCellsSkillDir = path.join(project, '.leerness', 'skills', 'unsafe-cells');
  fs.mkdirSync(unsafeCellsSkillDir, { recursive: true });
  fs.writeFileSync(path.join(unsafeCellsSkillDir, 'skill.json'), JSON.stringify({
    name: 'unsafe-cells',
    displayNameKo: '안전하지 않은 셀',
    displayNameEn: 'Safe name\n| forged-name |',
    lastUpdated: '2026-01-01\n| forged-last |',
    capabilities: ['한국어 기능 설명'],
    capabilitiesEn: ['safe | capability\ncontinued'],
    usage: { count: '', lastUsed: 0 },
  }, null, 2) + '\n');
  const falsyJsonSkillDir = path.join(project, '.leerness', 'skills', 'falsy-json');
  fs.mkdirSync(falsyJsonSkillDir, { recursive: true });
  fs.writeFileSync(path.join(falsyJsonSkillDir, 'skill.json'), JSON.stringify({
    name: 'falsy-json',
    displayNameKo: '',
    lastUpdated: false,
    capabilities: false,
    usage: { count: null, lastUsed: false },
  }, null, 2) + '\n');
  const hostileObjectSkillDir = path.join(project, '.leerness', 'skills', 'hostile-object');
  fs.mkdirSync(hostileObjectSkillDir, { recursive: true });
  fs.writeFileSync(path.join(hostileObjectSkillDir, 'skill.json'), JSON.stringify({
    name: 'hostile-object',
    displayNameKo: { toString: null },
    lastUpdated: { toString: null },
    capabilities: [{ toString: null }],
    usage: { count: { toString: null }, lastUsed: { toString: null } },
  }, null, 2) + '\n');
  const hangulIdSkillDir = path.join(project, '.leerness', 'skills', '옛스킬');
  fs.mkdirSync(hangulIdSkillDir, { recursive: true });
  fs.writeFileSync(path.join(hangulIdSkillDir, 'skill.json'), JSON.stringify({
    name: '옛스킬',
    displayNameKo: '옛 사용자 스킬',
    lastUpdated: '마지막',
    capabilities: ['한국어 기능 설명'],
    usage: { count: 0, lastUsed: null },
  }, null, 2) + '\n');

  const manifestFile = path.join(project, '.leerness', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

  // Stored project language, environment override, and explicit flag must all
  // reach the same English renderer. Flip the stored language to Korean before
  // checking overrides so a disconnected env/flag path cannot pass by falling
  // back to the already-English manifest.
  const storedEnglish = new Map();
  for (const [label, args] of surfaces) {
    storedEnglish.set(label, requireNoHangul(`${label} (stored language)`, run(args)));
  }
  const storedSkillList = storedEnglish.get('skill list');
  const skillEnglishAnchors = [
    '# skillpack not installed — using builtin fallback (catalog bundled with leerness)',
    '| ID | Name | Source | Capabilities (summary) | Uses | Last |',
    '| feature-implementation | Feature implementation standard skill | catalog+local | feature contract authoring / reuse-first checks / test evidence collection … |',
    '| project-roadmap-generator | Project roadmap generator skill | catalog+local | Parse integrated .leerness/* state (plan/progress/skills/rules/decisions/handoff/current-state) / Left-to-right SVG tree with vertical centering / Seven status colors (done/in progress/on hold/review/planned/incomplete/error) … |',
    '| korean-only | korean-only | user | - | 0 | - |',
    '| unsafe-cells | Safe name &#124; forged-name &#124; | user | safe &#124; capability continued | 0 | 2026-01-01 &#124; forged-last &#124; |',
    '| falsy-json | falsy-json | user | - | 0 | - |',
    '| hostile-object | hostile-object | user | - | 0 | - |',
    '| \\uC61B\\uC2A4\\uD0AC | \\uC61B\\uC2A4\\uD0AC | user | - | 0 | - |',
  ];
  for (const anchor of skillEnglishAnchors) {
    if (!storedSkillList.includes(anchor)) throw new Error(`skill list English output lost anchor: ${anchor}`);
  }
  if (storedSkillList.split(/\r?\n/).some(line => /^\|\s*forged-/.test(line))) {
    throw new Error('skill list English metadata forged a physical Markdown row');
  }
  // A real stored-Korean route prevents a default-English implementation from
  // passing the stored-locale test accidentally. Run outside the target cwd so
  // the locale must come from --path rather than cwd.
  manifest.language = 'ko';
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  const storedKoreanSkillList = requireSuccess('skill list stored Korean control', run(
    ['skill', 'list', '--path', project], baseEnv, tmp
  ));
  if (!storedKoreanSkillList.includes('| ID | 한글명 | 출처 | 능력(요약) | 사용횟수 | 최종 |')) {
    throw new Error('skill list ignored the stored Korean locale selected through --path');
  }
  manifest.language = 'en';
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  // --path must outrank a conflicting positional root when resolving the
  // stored locale. The pre-fix dispatcher passed args[2] straight through.
  const koreanPositionalProject = path.join(tmp, 'korean-positional-project');
  fs.mkdirSync(koreanPositionalProject, { recursive: true });
  fs.writeFileSync(path.join(koreanPositionalProject, 'package.json'), '{"name":"korean-positional","version":"0.1.0"}\n');
  requireSuccess('init Korean positional project', run(['init', koreanPositionalProject, '--yes', '--language', 'ko']));
  requireNoHangul('skill list --path precedence', run(
    ['skill', 'list', koreanPositionalProject, '--path', project], baseEnv, tmp
  ));

  // A separately loaded skillpack exercises the loader projection, including
  // explicit English fields, legacy English fields, non-Latin text, complete
  // Hangul-script coverage, and Markdown control-character sanitation.
  const ambientSkillpackDir = path.join(project, 'node_modules', 'leerness-skillpack');
  fs.mkdirSync(ambientSkillpackDir, { recursive: true });
  fs.writeFileSync(path.join(ambientSkillpackDir, 'catalog.json'), JSON.stringify({
    name: 'Ambient pack', version: '0.0.0', skills: [{ id: 'ambient-pack', displayNameEn: 'Ambient pack' }],
  }, null, 2) + '\n');
  const skillpackDir = path.join(tmp, 'skillpack');
  fs.mkdirSync(skillpackDir, { recursive: true });
  const nfdHangul = '한글'.normalize('NFD');
  const literalEscapeId = String.raw`\uC61B`;
  fs.writeFileSync(path.join(skillpackDir, 'catalog.json'), JSON.stringify({
    name: 'External pack\n| forged-pack |',
    version: { toString: null },
    skills: [
      { id: 'translated-pack', displayNameKo: '번역 스킬', displayNameEn: 'Translated pack skill', capabilities: ['한국어 기능'], capabilitiesEn: ['English capability'] },
      { id: 'legacy-pack', displayNameKo: '레거시 스킬', displayName: 'Legacy pack name', capabilities: ['Legacy capability'] },
      { id: 'legacy-name-pack', displayNameKo: '레거시 이름 스킬', name: 'Legacy name pack', capabilities: ['Legacy name capability'] },
      { id: 'japanese-pack', displayNameKo: '日本語名', capabilities: ['日本語機能'] },
      { id: 'jamo-pack', displayNameKo: '자모 스킬', displayNameEn: 'ㄴ invalid label', capabilities: ['한국어 기능'], capabilitiesEn: ['ㄷ invalid capability'] },
      { id: nfdHangul, displayNameKo: '분해 자모 스킬', displayNameEn: nfdHangul, capabilities: ['한국어 기능'], capabilitiesEn: [nfdHangul] },
      { id: 'a|b', displayNameEn: 'Pipe ID' },
      { id: 'a&#124;b', displayNameEn: 'Literal entity ID' },
      { id: 'a b', displayNameEn: 'Single-space ID' },
      { id: 'a  b', displayNameEn: 'Double-space ID' },
      { id: ' ', displayNameEn: 'Space-only ID' },
      { id: '-', displayNameEn: 'Dash ID' },
      { id: literalEscapeId, displayNameEn: 'Literal escape ID' },
      { id: '옛', displayNameEn: 'Hangul ID' },
      null,
      { id: { toString: null }, displayNameEn: 'Malformed ID' },
    ],
  }, null, 2) + '\n');
  const skillpackOutput = requireNoHangul('skill list external skillpack', run(
    ['skill', 'list', '--path', project],
    { ...baseEnv, LEERNESS_LANG: 'en', LEERNESS_SKILLPACK_PATH: skillpackDir }
  ));
  for (const anchor of [
    '# skillpack source: env (External pack &#124; forged-pack &#124;)',
    '| translated-pack | Translated pack skill | skillpack | English capability |',
    '| legacy-pack | Legacy pack name | skillpack | Legacy capability |',
    '| legacy-name-pack | Legacy name pack | skillpack | Legacy name capability |',
    '| japanese-pack | japanese-pack | skillpack | - |',
    '| jamo-pack | jamo-pack | skillpack | - |',
    '| \\u1112\\u1161\\u11AB\\u1100\\u1173\\u11AF | \\u1112\\u1161\\u11AB\\u1100\\u1173\\u11AF | skillpack | - |',
    '| a\\u007Cb | Pipe ID | skillpack | - |',
    '| a&#124;b | Literal entity ID | skillpack | - |',
    '| a\\u0020b | Single-space ID | skillpack | - |',
    '| a\\u0020\\u0020b | Double-space ID | skillpack | - |',
    '| \\u0020 | Space-only ID | skillpack | - |',
    '| - | Dash ID | skillpack | - |',
    '| \\\\uC61B | Literal escape ID | skillpack | - |',
    '| \\uC61B | Hangul ID | skillpack | - |',
  ]) {
    if (!skillpackOutput.includes(anchor)) throw new Error(`skill list external skillpack lost anchor: ${anchor}`);
  }
  if (skillpackOutput.includes('日本語') || skillpackOutput.split(/\r?\n/).some(line => /^\|\s*forged-/.test(line))) {
    throw new Error('skill list external metadata bypassed English fallback or forged a Markdown row');
  }
  const skillpackJsonEnv = normalizedJson('skill list external skillpack environment JSON', run(
    ['skill', 'list', '--path', project, '--json'],
    { ...baseEnv, LEERNESS_LANG: 'en', LEERNESS_SKILLPACK_PATH: skillpackDir }, tmp
  ));
  const skillpackJsonExplicit = normalizedJson('skill list external skillpack explicit JSON', run(
    ['skill', 'list', '--path', project, '--json', '--language', 'en'],
    { ...baseEnv, LEERNESS_LANG: 'ko', LEERNESS_SKILLPACK_PATH: skillpackDir }, tmp
  ));
  const skillpackJsonKorean = normalizedJson('skill list external skillpack Korean JSON', run(
    ['skill', 'list', '--path', project, '--json'],
    { ...baseEnv, LEERNESS_LANG: 'ko', LEERNESS_SKILLPACK_PATH: skillpackDir }, tmp
  ));
  const canonicalSkillKeys = ['capabilities', 'displayNameKo', 'id', 'lastUpdated', 'lastUsed', 'source', 'usageCount'];
  const externalTranslatedJson = skillpackJsonEnv.items && skillpackJsonEnv.items.find(item => item.id === 'translated-pack');
  if (JSON.stringify(skillpackJsonEnv) !== JSON.stringify(skillpackJsonExplicit)
      || JSON.stringify(skillpackJsonEnv) !== JSON.stringify(skillpackJsonKorean)
      || skillpackJsonEnv.skillpack !== 'env'
      || !skillpackJsonEnv.items.every(item => JSON.stringify(Object.keys(item).sort()) === JSON.stringify(canonicalSkillKeys))
      || skillpackJsonEnv.items.some(item => item.id === 'ambient-pack' || typeof item.id !== 'string')
      || !skillpackJsonEnv.items.some(item => item.id === 'a|b')
      || !skillpackJsonEnv.items.some(item => item.id === 'a b')
      || !skillpackJsonEnv.items.some(item => item.id === 'a  b')
      || !skillpackJsonEnv.items.some(item => item.id === ' ')
      || !skillpackJsonEnv.items.some(item => item.id === '-')
      || !skillpackJsonEnv.items.some(item => item.id === literalEscapeId)
      || !externalTranslatedJson || externalTranslatedJson.displayNameKo !== '번역 스킬'
      || externalTranslatedJson.capabilities[0] !== '한국어 기능') {
    throw new Error('skill list external skillpack JSON changed across locale routes or exposed presentation-only fields');
  }
  // Valid Korean free text is a compatibility surface: unlike the English
  // Markdown-safe projection it must retain repeated spaces byte-for-byte.
  // Keep an ambient pack present so this also exercises explicit env priority.
  const koreanBytePackDir = path.join(tmp, 'korean-byte-pack');
  fs.mkdirSync(koreanBytePackDir, { recursive: true });
  fs.writeFileSync(path.join(koreanBytePackDir, 'catalog.json'), JSON.stringify({
    name: '외부  팩',
    version: '1  2',
    skills: [{
      id: 'ko-space-pack',
      displayNameKo: '가  나',
      capabilities: ['첫  기능'],
      lastUpdated: '2026  08',
    }],
  }, null, 2) + '\n');
  const koreanByteOutput = requireSuccess('skill list external skillpack Korean byte preservation', run(
    ['skill', 'list', '--path', project],
    { ...baseEnv, LEERNESS_LANG: 'ko', LEERNESS_SKILLPACK_PATH: koreanBytePackDir }, tmp
  ));
  for (const anchor of [
    '# skillpack 출처: env (외부  팩 v1  2)',
    '| ko-space-pack | 가  나 | skillpack | 첫  기능 | 0 | 2026  08 |',
  ]) {
    if (!koreanByteOutput.includes(anchor)) throw new Error(`skill list Korean valid metadata changed bytes: ${anchor}`);
  }
  fs.rmSync(path.join(project, 'node_modules'), { recursive: true, force: true });
  manifest.language = 'ko';
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  for (const [label, args] of surfaces) {
    const envEnglish = requireNoHangul(`${label} (environment language)`, run(args, { ...baseEnv, LEERNESS_LANG: 'en' }));
    const explicitEnglish = requireNoHangul(`${label} (explicit language)`, run([...args, '--language', 'en'], { ...baseEnv, LEERNESS_LANG: 'ko' }));
    if (label === 'skill list' && (envEnglish !== storedSkillList || explicitEnglish !== storedSkillList)) {
      throw new Error('skill list English output differs across stored, environment, or explicit locale routes');
    }
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
  const skillJson = normalizedJson('skill list canonical JSON shape', run(['skill', 'list', '--path', project, '--json']));
  const koreanOnlyJson = skillJson.items && skillJson.items.find(item => item.id === 'korean-only');
  const unsafeCellsJson = skillJson.items && skillJson.items.find(item => item.id === 'unsafe-cells');
  const falsyJson = skillJson.items && skillJson.items.find(item => item.id === 'falsy-json');
  const hostileObjectJson = skillJson.items && skillJson.items.find(item => item.id === 'hostile-object');
  const featureJson = skillJson.items && skillJson.items.find(item => item.id === 'feature-implementation');
  const roadmapJson = skillJson.items && skillJson.items.find(item => item.id === 'project-roadmap-generator');
  if (!skillJson || skillJson.skillpack !== 'builtin' || skillJson.total !== skillJson.items.length
      || !koreanOnlyJson || koreanOnlyJson.displayNameKo !== '한국어 전용 사용자 스킬'
      || koreanOnlyJson.capabilities[0] !== '한국어 기능 설명' || koreanOnlyJson.lastUpdated !== '마지막'
      || koreanOnlyJson.usageCount !== '한국어 횟수' || koreanOnlyJson.lastUsed !== 1725062400000
      || !unsafeCellsJson || unsafeCellsJson.usageCount !== '' || unsafeCellsJson.lastUsed !== 0
      || !falsyJson || falsyJson.displayNameKo !== '' || falsyJson.capabilities !== false
      || falsyJson.usageCount !== null || falsyJson.lastUsed !== false || falsyJson.lastUpdated !== false
      || !hostileObjectJson || hostileObjectJson.usageCount.toString !== null
      || hostileObjectJson.lastUsed.toString !== null || hostileObjectJson.lastUpdated.toString !== null
      || !featureJson || featureJson.displayNameKo !== '기능 구현 표준 스킬' || featureJson.capabilities[0] !== 'feature-contracts 작성'
      || !roadmapJson || roadmapJson.displayNameKo !== '프로젝트 로드맵 자동 생성 스킬' || !roadmapJson.capabilities[1].includes('좌→우 수평 트리')
      || !skillJson.items.every(item => JSON.stringify(Object.keys(item).sort()) === JSON.stringify(canonicalSkillKeys))) {
    throw new Error('skill list JSON no longer exposes the canonical locale-independent shape');
  }

  const koEnv = { ...baseEnv, LEERNESS_LANG: 'ko' };
  const koreanAnchors = new Map([
    ['release cadence', ['릴리스 빈도 진단', '누적 릴리스', '권장:']],
    ['idempotency audit', ['위반 발견', '중복 룰']],
    ['plan list', ['완료기준(Done-When)', 'Tasks:', '완료)']],
    ['round-history', ['자율 라운드 통계', '누적 라운드', '최근 10 tags']],
    ['milestones', ['도달 마일스톤', '총 라운드', '다음 마일스톤', '라운드 남음']],
    ['skill list', ['skillpack 미설치', '| ID | 한글명 | 출처 | 능력(요약) | 사용횟수 | 최종 |', '| feature-implementation | 기능 구현 표준 스킬 | catalog+local | feature-contracts 작성 / 재사용 우선 검사 / 테스트 증거 수집 … |', '| project-roadmap-generator | 프로젝트 로드맵 자동 생성 스킬 | catalog+local | leerness .leerness/* 통합 파싱 (plan/progress/skills/rules/decisions/handoff/current-state) / 좌→우 수평 트리 + 상하 중앙정렬 SVG / 7개 상태 색상 (완료/진행/보류/검토/예정/미완료/오류) … |', '한국어 전용 사용자 스킬', '옛 사용자 스킬', '| hostile-object | hostile-object | user |  | 0 | - |']],
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

  console.log('✓ Six next-cluster English surfaces contain no Hangul across locale paths and edge states; 6/6 Korean controls and JSON contracts remain intact');
} catch (error) {
  console.error(`✗ ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
