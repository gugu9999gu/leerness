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

function stripAllowedEchoes(output, extra = []) {
  let text = String(output);
  const forms = new Set();
  for (const value of [tmp, ...extra]) {
    if (typeof value !== 'string' || !value) continue;
    forms.add(value);
    forms.add(value.replace(/\\/g, '/'));
    forms.add(JSON.stringify(value).slice(1, -1));
  }
  for (const value of [...forms].sort((a, b) => b.length - a.length)) {
    text = text.split(value).join('<user-path>');
  }
  return text;
}

function hangulLines(output, allowedEchoes = []) {
  return stripAllowedEchoes(output, allowedEchoes).split(/\r?\n/).filter(line => HANGUL.test(line));
}

function requireNoHangul(label, result) {
  const output = requireSuccess(label, result);
  const lines = hangulLines(output);
  if (lines.length) {
    throw new Error(`${label} leaked ${lines.length} Hangul line(s): ${lines.slice(0, 4).join(' | ')}`);
  }
  return output;
}

function requireFailureNoHangul(label, result) {
  const output = outputOf(result);
  if (result.status !== 1 || result.error || result.signal || !output.trim()) {
    throw new Error(`${label} did not exit 1 with visible output (exit ${result.status}, signal ${result.signal || 'none'}, spawn ${result.error && result.error.code || 'ok'}): ${output.slice(0, 500)}`);
  }
  const lines = hangulLines(output);
  if (lines.length) {
    throw new Error(`${label} leaked ${lines.length} Hangul line(s): ${lines.slice(0, 4).join(' | ')}`);
  }
  return output;
}

function failureJson(label, result) {
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  if (result.status !== 1 || result.error || result.signal || !stdout.trim() || stderr.trim()) {
    throw new Error(`${label} did not exit 1 with a clean failing JSON document (exit ${result.status}, signal ${result.signal || 'none'}, spawn ${result.error && result.error.code || 'ok'}): ${(stdout + stderr).slice(0, 500)}`);
  }
  let parsed;
  try { parsed = JSON.parse(stdout); } catch (error) {
    throw new Error(`${label} did not return one failing JSON document: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.ok !== false) {
    throw new Error(`${label} JSON did not assert ok:false`);
  }
  return { stdout, parsed };
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
  ['mode', ['mode', '--path', project]],
];

try {
  // User-supplied paths may contain Hangul and are diagnostic evidence, not
  // tool-authored UI. Keep the exclusion narrow and prove it does not hide
  // adjacent product prose.
  const syntheticUserPath = path.join(tmp, '사용자-경로');
  if (hangulLines(`path: ${syntheticUserPath}`, [syntheticUserPath]).length !== 0
      || hangulLines(`path: ${syntheticUserPath}\ntool text 한글`, [syntheticUserPath]).length !== 1) {
    throw new Error('Hangul echo filter either counted user paths or hid tool-authored prose');
  }
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
  const storedMode = storedEnglish.get('mode');
  for (const anchor of [
    '# leerness mode — standard',
    'minimal   loads only the core three (handoff · verify-claim · session close)',
    'standard  current default — all instruction/state documents',
    'Change: leerness mode set <minimal|standard>  ·  Load: leerness context budget',
  ]) {
    if (!storedMode.includes(anchor)) throw new Error(`mode English output lost anchor: ${anchor}`);
  }
  const staleCacheFile = path.join(project, '.leerness', 'cache', 'update-check.json');
  fs.mkdirSync(path.dirname(staleCacheFile), { recursive: true });
  fs.writeFileSync(staleCacheFile, JSON.stringify({ at: Date.now(), nextLeerness: '99.0.0' }, null, 2) + '\n');
  const staleEnv = { ...baseEnv };
  delete staleEnv.LEERNESS_NO_STALE_CHECK;
  const staleModeEn = requireNoHangul('mode stale-version English notice', run(
    ['mode', '--path', project, '--language', 'en'], staleEnv
  ));
  if (!staleModeEn.includes('leerness v') || !staleModeEn.includes('v99.0.0 available')
      || !staleModeEn.includes('recommended (set LEERNESS_NO_STALE_CHECK=1 to disable)')) {
    throw new Error('mode stale-version English notice lost its localized guidance');
  }
  const staleModeKo = requireSuccess('mode stale-version Korean control', run(
    ['mode', '--path', project, '--language', 'ko'], staleEnv
  ));
  if (!staleModeKo.includes('v99.0.0 사용 가능') || !staleModeKo.includes('권장 (LEERNESS_NO_STALE_CHECK=1 로 끄기)')) {
    throw new Error('mode stale-version Korean notice changed');
  }
  const staleJson = [];
  for (const lang of ['en', 'ko']) {
    const result = run(['mode', '--path', project, '--language', lang, '--json'], staleEnv);
    if (result.status !== 0 || String(result.stderr || '').trim()) {
      throw new Error(`mode stale-version ${lang} JSON was contaminated by diagnostics: ${outputOf(result).slice(0, 500)}`);
    }
    JSON.parse(String(result.stdout || ''));
    staleJson.push(String(result.stdout));
  }
  if (staleJson[0] !== staleJson[1]) {
    throw new Error('mode stale-version JSON changed with UI language');
  }
  // `get`/`set` occupy args[1], so the shared stale checker must use the same
  // positional-root parser as the mode handler instead of treating the child
  // command itself as a directory.
  const staleModePositional = requireNoHangul('mode stale-version positional root', run(
    ['mode', 'get', project], staleEnv, tmp
  ));
  if (!staleModePositional.includes('v99.0.0 available')
      || !staleModePositional.includes('recommended (set LEERNESS_NO_STALE_CHECK=1 to disable)')) {
    throw new Error('mode positional root did not supply the stale-version cache or locale');
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
  const modePathPrecedence = requireNoHangul('mode --path precedence', run(
    ['mode', '--path', project], baseEnv, koreanPositionalProject
  ));
  const modePositionalPathPrecedence = requireNoHangul('mode positional/--path precedence', run(
    ['mode', koreanPositionalProject, '--path', project], baseEnv, tmp
  ));
  if (modePathPrecedence !== storedMode || modePositionalPathPrecedence !== storedMode) {
    throw new Error('mode --path did not outrank a conflicting cwd or positional project root');
  }
  const modeTargetLocaleError = requireFailureNoHangul('mode pre-dispatch target stored locale', run(
    ['mode', '--path', project, '--not-a-mode-flag'], baseEnv, koreanPositionalProject
  ));
  if (!modeTargetLocaleError.includes('Unknown flag: --not-a-mode-flag')) {
    throw new Error('mode pre-dispatch human error ignored the --path target stored locale');
  }

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
    if ((label === 'skill list' || label === 'mode')
        && (envEnglish !== storedEnglish.get(label) || explicitEnglish !== storedEnglish.get(label))) {
      throw new Error(`${label} English output differs across stored, environment, or explicit locale routes`);
    }
  }
  manifest.language = 'en';
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');

  // `mode` has read, mutation, and fail-closed branches. The aggregate ratchet
  // sees only the healthy read path, so exercise the sibling human renderers
  // here while keeping successful JSON locale-independent through `surfaces`.
  const modeSetEnProject = path.join(tmp, 'mode-set-en');
  cloneProjectState(modeSetEnProject);
  const modeSetEn = requireNoHangul('mode set English', run(
    ['mode', 'set', 'minimal', '--path', modeSetEnProject, '--language', 'en'], baseEnv, tmp
  ));
  if (!modeSetEn.includes('Operating mode: standard → minimal (2 instruction files regenerated)')
      || !modeSetEn.includes('Check load: leerness context budget')) {
    throw new Error('mode set English output lost its success or follow-up anchor');
  }
  const modeSetKoProject = path.join(tmp, 'mode-set-ko');
  cloneProjectState(modeSetKoProject);
  const modeSetKo = requireSuccess('mode set Korean control', run(
    ['mode', 'set', 'minimal', '--path', modeSetKoProject, '--language', 'ko'], baseEnv, tmp
  ));
  if (!modeSetKo.includes('운영 등급: standard → minimal (지침 2개 재생성)')
      || !modeSetKo.includes('적재량 확인: leerness context budget')) {
    throw new Error('mode set Korean control lost its established anchors');
  }
  const modeSetJson = [];
  for (const lang of ['en', 'ko']) {
    const target = path.join(tmp, `mode-set-json-${lang}`);
    cloneProjectState(target);
    const payload = normalizedJson(`mode set ${lang} JSON`, run(
      ['mode', 'set', 'minimal', '--path', target, '--language', lang, '--json'], baseEnv, tmp
    ));
    const manifestAfter = JSON.parse(fs.readFileSync(path.join(target, '.leerness', 'manifest.json'), 'utf8'));
    payload.root = '<root>';
    modeSetJson.push({ payload, manifestAfter });
  }
  const canonicalModeSetKeys = ['mode', 'ok', 'previous', 'regenerated', 'root'];
  if (JSON.stringify(modeSetJson[0]) !== JSON.stringify(modeSetJson[1])
      || JSON.stringify(Object.keys(modeSetJson[0].payload).sort()) !== JSON.stringify(canonicalModeSetKeys)
      || modeSetJson[0].payload.ok !== true || modeSetJson[0].payload.mode !== 'minimal'
      || modeSetJson[0].payload.previous !== 'standard' || modeSetJson[0].payload.regenerated !== 2
      || modeSetJson[0].manifestAfter.mode !== 'minimal') {
    throw new Error('mode set JSON or manifest state changed with UI language');
  }

  // The first manifest read is outside the lock. Corrupt it while mode waits
  // for that lock, then release the lock: the locked reread must reject the
  // mutation, preserve both generated documents, and report a real failure.
  const modeMidflightCorruptProject = path.join(tmp, 'mode-midflight-corrupt');
  cloneProjectState(modeMidflightCorruptProject);
  const midflightManifest = path.join(modeMidflightCorruptProject, '.leerness', 'manifest.json');
  const midflightLock = midflightManifest + '.lock';
  const midflightDocs = new Map(['AGENTS.md', 'CLAUDE.md'].map(name => {
    const file = path.join(modeMidflightCorruptProject, name);
    return [name, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null];
  }));
  fs.mkdirSync(midflightLock);
  const lockHandshake = path.join(tmp, 'mode-lock-handshake.js');
  const lockMarker = path.join(tmp, 'mode-lock-contention-observed');
  const lockTrace = path.join(tmp, 'mode-lock-trace.jsonl');
  fs.writeFileSync(lockHandshake, [
    "'use strict';",
    "const fs = require('fs');",
    "const path = require('path');",
    "const originalMkdir = fs.mkdirSync;",
    "const originalReadFile = fs.readFileSync;",
    "const lock = path.resolve(process.env.LEERNESS_TEST_MODE_LOCK);",
    "const manifest = path.resolve(process.env.LEERNESS_TEST_MODE_MANIFEST);",
    "const marker = path.resolve(process.env.LEERNESS_TEST_MODE_LOCK_MARKER);",
    "const trace = path.resolve(process.env.LEERNESS_TEST_MODE_LOCK_TRACE);",
    "const mutation = process.env.LEERNESS_TEST_MODE_MUTATION || 'corrupt';",
    "let injected = false;",
    "function record(event, detail = {}) { fs.appendFileSync(trace, JSON.stringify({ event, ...detail }) + '\\n'); }",
    "function manifestKind(value) {",
    "  try {",
    "    const parsed = JSON.parse(String(value));",
    "    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? 'valid-object' : 'invalid-value';",
    "  } catch { return 'corrupt'; }",
    "}",
    "function ownerHeld() {",
    "  try { return fs.readdirSync(lock).some(name => /^owner-[a-f0-9]{32}\\.json$/.test(name)); }",
    "  catch { return false; }",
    "}",
    "fs.readFileSync = function(target, ...args) {",
    "  const value = originalReadFile.call(fs, target, ...args);",
    "  if (path.resolve(String(target)) === manifest) {",
    "    record('manifest-read', { phase: injected ? 'after-injection' : 'before-contention', kind: manifestKind(value), ownerHeld: ownerHeld() });",
    "  }",
    "  return value;",
    "};",
    "fs.mkdirSync = function(target, ...args) {",
    "  const resolved = path.resolve(String(target));",
    "  if (!injected && resolved === lock) {",
    "    try { return originalMkdir.call(fs, target, ...args); }",
    "    catch (error) {",
    "      if (!error || error.code !== 'EEXIST') throw error;",
    "      injected = true;",
    "      record('contention-observed');",
    "      fs.writeFileSync(marker, 'contention-observed\\n');",
    "      if (mutation === 'object') {",
    "        const data = JSON.parse(String(originalReadFile.call(fs, manifest, 'utf8')));",
    "        data.mode = { toString: null };",
    "        fs.writeFileSync(manifest, JSON.stringify(data, null, 2) + '\\n');",
    "      } else fs.writeFileSync(manifest, '{ broken during lock wait\\n');",
    "      fs.rmdirSync(lock);",
    "      throw error;",
    "    }",
    "  }",
    "  return originalMkdir.call(fs, target, ...args);",
    "};",
  ].join('\n') + '\n');
  const handshakeRequire = `--require=\"${lockHandshake.replace(/\\/g, '/').replace(/\"/g, '\\\"')}\"`;
  const handshakeEnv = {
    ...baseEnv,
    NODE_OPTIONS: [String(baseEnv.NODE_OPTIONS || '').trim(), handshakeRequire].filter(Boolean).join(' '),
    LEERNESS_TEST_MODE_LOCK: midflightLock,
    LEERNESS_TEST_MODE_MANIFEST: midflightManifest,
    LEERNESS_TEST_MODE_LOCK_MARKER: lockMarker,
    LEERNESS_TEST_MODE_LOCK_TRACE: lockTrace,
    LEERNESS_TEST_MODE_MUTATION: 'corrupt',
  };
  const lockTraceShows = (traceFile, postKind) => {
    const events = fs.existsSync(traceFile)
      ? fs.readFileSync(traceFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
      : [];
    const contentionIndex = events.findIndex(event => event.event === 'contention-observed');
    const validPreLockIndex = events.findIndex((event, index) => index < contentionIndex
      && event.event === 'manifest-read' && event.phase === 'before-contention'
      && event.kind === 'valid-object' && event.ownerHeld === false);
    const lockedRereadIndex = events.findIndex((event, index) => index > contentionIndex
      && event.event === 'manifest-read' && event.phase === 'after-injection'
      && event.kind === postKind && event.ownerHeld === true);
    return validPreLockIndex >= 0 && contentionIndex > validPreLockIndex && lockedRereadIndex > contentionIndex;
  };
  const modeMidflightFailure = failureJson('mode lock-time manifest corruption', run(
    ['mode', 'set', 'minimal', '--path', modeMidflightCorruptProject, '--language', 'en', '--json'], handshakeEnv, tmp
  ));
  const midflightRaw = fs.readFileSync(midflightManifest, 'utf8');
  if (!fs.existsSync(lockMarker)
      || fs.readFileSync(lockMarker, 'utf8') !== 'contention-observed\n'
      || !lockTraceShows(lockTrace, 'corrupt')
      || modeMidflightFailure.parsed.code !== 'manifest_corrupt'
      || midflightRaw !== '{ broken during lock wait\n'
      || [...midflightDocs].some(([name, before]) => {
        const file = path.join(modeMidflightCorruptProject, name);
        return before === null ? fs.existsSync(file) : fs.readFileSync(file, 'utf8') !== before;
      })) {
    throw new Error('mode lock-time corruption was overwritten, regenerated documents, or reported the wrong failure');
  }

  // A concurrent writer can leave valid JSON whose mode value is not safely
  // coercible. Compute the previous mode before writing: a post-write coercion
  // throw would otherwise commit the manifest while skipping both documents.
  const modeMidflightObjectProject = path.join(tmp, 'mode-midflight-object');
  cloneProjectState(modeMidflightObjectProject);
  const objectManifest = path.join(modeMidflightObjectProject, '.leerness', 'manifest.json');
  const objectLock = objectManifest + '.lock';
  const objectMarker = path.join(tmp, 'mode-object-contention-observed');
  const objectTrace = path.join(tmp, 'mode-object-trace.jsonl');
  const objectDocs = new Map(['AGENTS.md', 'CLAUDE.md'].map(name => {
    const file = path.join(modeMidflightObjectProject, name);
    return [name, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null];
  }));
  fs.mkdirSync(objectLock);
  const objectPayload = normalizedJson('mode lock-time object mode normalization', run(
    ['mode', 'set', 'minimal', '--path', modeMidflightObjectProject, '--language', 'en', '--json'],
    {
      ...handshakeEnv,
      LEERNESS_TEST_MODE_LOCK: objectLock,
      LEERNESS_TEST_MODE_MANIFEST: objectManifest,
      LEERNESS_TEST_MODE_LOCK_MARKER: objectMarker,
      LEERNESS_TEST_MODE_LOCK_TRACE: objectTrace,
      LEERNESS_TEST_MODE_MUTATION: 'object',
    },
    tmp
  ));
  const objectAfter = JSON.parse(fs.readFileSync(objectManifest, 'utf8'));
  if (!fs.existsSync(objectMarker)
      || fs.readFileSync(objectMarker, 'utf8') !== 'contention-observed\n'
      || !lockTraceShows(objectTrace, 'valid-object')
      || objectPayload.ok !== true || objectPayload.previous !== 'standard'
      || objectPayload.mode !== 'minimal' || objectPayload.regenerated !== 2
      || objectAfter.mode !== 'minimal'
      || [...objectDocs].some(([name, before]) => {
        const file = path.join(modeMidflightObjectProject, name);
        return before === null ? !fs.existsSync(file) : fs.readFileSync(file, 'utf8') === before;
      })) {
    throw new Error('mode lock-time object value caused a partial manifest-only commit or lost default-mode normalization');
  }

  const modeCorruptProject = path.join(tmp, 'mode-corrupt');
  cloneProjectState(modeCorruptProject);
  fs.writeFileSync(path.join(modeCorruptProject, '.leerness', 'manifest.json'), '{ broken manifest\n');
  const modeCorruptEn = requireNoHangul('mode corrupt-manifest English read', run(
    ['mode', '--path', modeCorruptProject, '--language', 'en'], baseEnv, tmp
  ));
  if (!modeCorruptEn.includes('manifest.json is corrupt (JSON parse failed)')
      || !modeCorruptEn.includes('the value above is the default, not the stored value')) {
    throw new Error('mode corrupt-manifest English warning lost provenance');
  }
  const modeCorruptKo = requireSuccess('mode corrupt-manifest Korean control', run(
    ['mode', '--path', modeCorruptProject, '--language', 'ko'], baseEnv, tmp
  ));
  if (!modeCorruptKo.includes('manifest.json 손상(JSON 파싱 실패)')
      || !modeCorruptKo.includes('위 값은 **저장값이 아니라 기본값**입니다')) {
    throw new Error('mode corrupt-manifest Korean warning changed');
  }
  const modeCorruptGetEn = failureJson('mode corrupt-manifest English get JSON', run(
    ['mode', '--path', modeCorruptProject, '--language', 'en', '--json'], baseEnv, tmp
  ));
  const modeCorruptGetKo = failureJson('mode corrupt-manifest Korean get JSON', run(
    ['mode', '--path', modeCorruptProject, '--language', 'ko', '--json'], baseEnv, tmp
  ));
  const corruptGetKeys = ['corrupt', 'corruptReason', 'mode', 'modes', 'ok', 'root'];
  if (modeCorruptGetEn.stdout !== modeCorruptGetKo.stdout
      || JSON.stringify(Object.keys(modeCorruptGetEn.parsed).sort()) !== JSON.stringify(corruptGetKeys)
      || modeCorruptGetEn.parsed.ok !== false || modeCorruptGetEn.parsed.corrupt !== true
      || modeCorruptGetEn.parsed.corruptReason !== 'JSON 파싱 실패'
      || modeCorruptGetEn.parsed.mode !== 'standard'
      || JSON.stringify(modeCorruptGetEn.parsed.modes) !== JSON.stringify(['minimal', 'standard'])) {
    throw new Error('mode corrupt-manifest get JSON changed with UI language or lost its canonical shape');
  }
  const modeCorruptSetEn = requireFailureNoHangul('mode corrupt-manifest English set', run(
    ['mode', 'set', 'minimal', '--path', modeCorruptProject, '--language', 'en'], baseEnv, tmp
  ));
  if (!modeCorruptSetEn.includes('refusing to overwrite')) {
    throw new Error('mode corrupt-manifest English set lost its fail-closed anchor');
  }

  // The manifest reader exposes stable reason codes. Pin every human English
  // mapping so a future reason cannot silently reintroduce Korean prose.
  const modeNotObjectProject = path.join(tmp, 'mode-not-object');
  cloneProjectState(modeNotObjectProject);
  fs.writeFileSync(path.join(modeNotObjectProject, '.leerness', 'manifest.json'), '"not an object"\n');
  const modeNotObjectEn = requireNoHangul('mode non-object manifest English read', run(
    ['mode', '--path', modeNotObjectProject, '--language', 'en'], baseEnv, tmp
  ));
  if (!modeNotObjectEn.includes('manifest.json is corrupt (top level is not an object)')) {
    throw new Error('mode non-object manifest English reason lost its stable mapping');
  }

  const modeUnreadableProject = path.join(tmp, 'mode-unreadable');
  cloneProjectState(modeUnreadableProject);
  const unreadableManifest = path.join(modeUnreadableProject, '.leerness', 'manifest.json');
  fs.rmSync(unreadableManifest);
  fs.mkdirSync(unreadableManifest);
  const modeUnreadableEn = requireNoHangul('mode unreadable manifest English read', run(
    ['mode', '--path', modeUnreadableProject, '--language', 'en'], baseEnv, tmp
  ));
  if (!modeUnreadableEn.includes('manifest.json is corrupt (read failed)')) {
    throw new Error('mode unreadable manifest English reason lost its stable mapping');
  }

  // Shared guards can reject a mode invocation before the mode dispatcher.
  // Their machine errors still belong to the mode JSON byte contract.
  const modeMissingPath = path.join(tmp, 'mode-path-does-not-exist');
  const modeFilePath = path.join(tmp, 'mode-file-root.txt');
  fs.writeFileSync(modeFilePath, 'not a directory\n');
  for (const [label, args, code, canonicalError, languageFirst = false] of [
    ['missing path', ['mode', '--path', modeMissingPath, '--json'], 'path_not_found', `경로 없음: ${modeMissingPath} — 디렉토리를 새로 만들지 않았습니다`],
    ['file path', ['mode', '--path', modeFilePath, '--json'], 'path_not_a_directory', `--path 가 디렉토리가 아닙니다: ${modeFilePath}`],
    ['missing path value', ['mode', '--path', '--json'], 'missing_flag_value', '잘못된 플래그 형식: --path 에 값이 없습니다 (명령 사용법 확인)'],
    ['unregistered flag', ['mode', '--not-a-mode-flag', '--json'], 'unknown_flag', '등록되지 않은 옵션: --not-a-mode-flag — 값이 본문이나 경로 인자에 섞이기 전에 거부했습니다'],
    ['unregistered flag with leading global', ['mode', '--not-a-mode-flag', '--json'], 'unknown_flag', '등록되지 않은 옵션: --not-a-mode-flag — 값이 본문이나 경로 인자에 섞이기 전에 거부했습니다', true],
  ]) {
    const localizedArgs = lang => languageFirst ? ['--language', lang, ...args] : [...args, '--language', lang];
    const en = failureJson(`mode pre-dispatch ${label} English JSON`, run(localizedArgs('en'), baseEnv, tmp));
    const ko = failureJson(`mode pre-dispatch ${label} Korean JSON`, run(localizedArgs('ko'), baseEnv, tmp));
    if (en.stdout !== ko.stdout || en.parsed.code !== code || ko.parsed.code !== code
        || en.parsed.error !== canonicalError || ko.parsed.error !== canonicalError) {
      throw new Error(`mode pre-dispatch ${label} JSON changed with UI language or lost code ${code}`);
    }
  }

  const modeMissingProject = path.join(tmp, 'mode-missing');
  fs.mkdirSync(modeMissingProject, { recursive: true });
  const modeMissingEn = requireFailureNoHangul('mode missing-harness English', run(
    ['mode', '--path', modeMissingProject, '--language', 'en'], baseEnv, tmp
  ));
  if (!modeMissingEn.includes('leerness is not installed:')) {
    throw new Error('mode missing-harness English error lost its anchor');
  }
  const modeInvalidEn = requireFailureNoHangul('mode invalid-value English', run(
    ['mode', 'set', 'banana', '--path', project, '--language', 'en'], baseEnv, tmp
  ));
  if (!modeInvalidEn.includes('mode must be one of minimal|standard')) {
    throw new Error('mode invalid-value English error lost its anchor');
  }
  const modeUnknownEn = requireFailureNoHangul('mode unknown-subcommand English', run(
    ['mode', 'inspect', '--path', project, '--language', 'en'], baseEnv, tmp
  ));
  if (!modeUnknownEn.includes('Unknown mode subcommand: inspect (valid: get, set)')) {
    throw new Error('mode unknown-subcommand English error lost its anchor');
  }
  for (const [label, args, code, canonicalError] of [
    ['missing harness', ['mode', '--path', modeMissingProject, '--json'], 'harness_missing', `leerness 미설치: ${modeMissingProject} — 먼저 leerness init`],
    ['invalid value', ['mode', 'set', 'banana', '--path', project, '--json'], 'invalid_mode', 'mode 는 minimal|standard 중 하나입니다'],
    ['unknown subcommand', ['mode', 'inspect', '--path', project, '--json'], 'unknown_subcommand', '알 수 없는 mode 하위명령: inspect (가능: get, set)'],
    ['corrupt manifest set', ['mode', 'set', 'minimal', '--path', modeCorruptProject, '--json'], 'manifest_corrupt', `manifest.json 손상(JSON 파싱 실패) — 덮어쓰기 거부: ${path.join(modeCorruptProject, '.leerness', 'manifest.json')}\n  복구 후 재시도하세요(지금 쓰면 project/language 등 남은 필드가 사라집니다)`],
  ]) {
    const en = failureJson(`mode ${label} English JSON`, run([...args, '--language', 'en'], baseEnv, tmp));
    const ko = failureJson(`mode ${label} Korean JSON`, run([...args, '--language', 'ko'], baseEnv, tmp));
    if (en.stdout !== ko.stdout || en.parsed.code !== code || ko.parsed.code !== code
        || en.parsed.error !== canonicalError || ko.parsed.error !== canonicalError) {
      throw new Error(`mode ${label} error JSON changed with UI language or lost code ${code}`);
    }
  }

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
  const modeJson = normalizedJson('mode canonical JSON shape', run(['mode', '--path', project, '--json']));
  const canonicalModeKeys = ['corrupt', 'corruptReason', 'mode', 'modes', 'ok', 'root'];
  if (!modeJson || JSON.stringify(Object.keys(modeJson).sort()) !== JSON.stringify(canonicalModeKeys)
      || modeJson.ok !== true || modeJson.mode !== 'standard'
      || JSON.stringify(modeJson.modes) !== JSON.stringify(['minimal', 'standard'])
      || modeJson.corrupt !== false || modeJson.corruptReason !== null
      || path.resolve(modeJson.root) !== path.resolve(project)) {
    throw new Error('mode healthy JSON no longer exposes the canonical locale-independent shape');
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
    ['mode', ['# leerness mode — standard', 'minimal   핵심 3종만 읽힌다', 'standard  현재 기본 — 전체 지침/상태 문서', '변경: leerness mode set <minimal|standard>', '적재량: leerness context budget']],
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

  console.log('✓ Seven next-cluster English surfaces contain no Hangul across locale paths and edge states; 7/7 Korean controls and JSON contracts remain intact');
} catch (error) {
  console.error(`✗ ${error && error.message ? error.message : error}`);
  process.exitCode = 1;
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
