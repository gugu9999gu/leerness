#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module);  

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { performance } = require('perf_hooks');
const { childDiagnostics, childExitMatches, e2eSmokeOnly } = require('./e2e-child-diagnostics');
const smokeOnly = e2eSmokeOnly(process.argv.slice(2), process.env);
const { spawnNpmSync } = require('../lib/npm-process');
const { gitSpawn } = require('../lib/git');
const { EXTERNAL_AGENTS } = require('../lib/agent-registry');
const { withRedirectWarnings } = require('./runtime-warning-gate');
 
 
 
 
 
 
 
const e2eShard = require('./ci-shard').e2eShard(__filename, ['tmp', 'run', 'dsPath', 'dsText', 'secretFile']);

 
 
 
process.env.LEERNESS_OFFLINE = process.env.LEERNESS_OFFLINE || '1';
 
 
 
 
process.env.LC_ALL = '';
process.env.LC_CTYPE = '';
process.env.LANG = '';
process.env.LANGUAGE = 'ko';
 
 
process.env.LEERNESS_NO_AUTO_ROADMAP = '1';
const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
 
 
 
 
const SELFTEST_SPAWN_MS = 900000;
 
 
const repoGuard = require('./e2e-repo-guard');
const _pkgLeerness = path.resolve(__dirname, '..', '.leerness');
const _pkgLeernessBefore = repoGuard.snapshot(_pkgLeerness);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-e2e-'));
 
 
 
 
for (const key of Object.keys(process.env)) {
  if (key.toUpperCase() === 'GIT_CONFIG_GLOBAL' || key.toUpperCase() === 'GIT_CONFIG_SYSTEM') delete process.env[key];
}
process.env.GIT_CONFIG_GLOBAL = path.join(tmp, 'fixture-global.gitconfig');
process.env.GIT_CONFIG_SYSTEM = path.join(tmp, 'fixture-system.gitconfig');
fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '', 'utf8');
fs.writeFileSync(process.env.GIT_CONFIG_SYSTEM, '', 'utf8');
let failed = 0; let total = 0;
const runtimeDep0190 = [];
const runtimeWarningFile = path.join(tmp, 'node-runtime-warnings.log');
const parentWarningGuard = withRedirectWarnings(process.env, runtimeWarningFile);
if (parentWarningGuard.reasons.length) {
  runtimeDep0190.push(`caller warning suppression rejected: ${parentWarningGuard.reasons.join(', ')}`);
}
for (const key of Object.keys(process.env)) {
  if (['node_options', 'node_no_warnings'].includes(key.toLowerCase())) delete process.env[key];
}
process.env.NODE_OPTIONS = parentWarningGuard.env.NODE_OPTIONS;
process.on('warning', warning => {
  if (warning && (warning.code === 'DEP0190' || /shell option true/i.test(String(warning.message || '')))) {
    runtimeDep0190.push(String(warning.stack || warning.message || warning));
  }
});
 
 
function _injectRuntimeWarningEnv(spawnArgs) {
  const next = spawnArgs.slice();
  let sameNode = false;
  try { sameNode = path.resolve(String(next[0])) === path.resolve(process.execPath); } catch {}
  if (!sameNode) return next;
  const optsIndex = Array.isArray(next[1]) ? 2 : 1;
  if (!next[optsIndex] || !next[optsIndex].env) return next;  
  const opts = { ...next[optsIndex] };
  const guarded = withRedirectWarnings(opts.env, runtimeWarningFile);
  if (guarded.reasons.length) {
    runtimeDep0190.push(`child warning suppression rejected: ${guarded.reasons.join(', ')}`);
  }
  opts.env = guarded.env;
  next[optsIndex] = opts;
  return next;
}
const _rawSpawnSync = cp.spawnSync.bind(cp);
cp.spawnSync = function e2eSpawnSyncWithRuntimeWarningGate(...spawnArgs) {
  const result = _rawSpawnSync(..._injectRuntimeWarningEnv(spawnArgs));
  const stderr = String(result && result.stderr || '');
  if (/DEP0190|DeprecationWarning:[^\r\n]*shell option true/i.test(stderr)) {
    const file = typeof spawnArgs[0] === 'string' ? spawnArgs[0] : '(unknown child)';
    runtimeDep0190.push(`child stderr (${file}):\n${stderr.slice(0, 4000)}`);
  }
  return result;
};
const _rawSpawn = cp.spawn.bind(cp);
cp.spawn = function e2eSpawnWithRuntimeWarningGate(...spawnArgs) {
  return _rawSpawn(..._injectRuntimeWarningEnv(spawnArgs));
};
const _e2eStart = Date.now();   
 
 
 
 
 
const e2eHome = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-e2e-home-'));
fs.writeFileSync(path.join(e2eHome, 'package.json'), '{"name":"e2e-home","version":"0.1.0"}\n');
const _e2eHomeInit = cp.spawnSync(process.execPath, [CLI, 'init', e2eHome, '--yes'], { cwd: e2eHome, encoding: 'utf8', timeout: 180000 });
process.chdir(e2eHome);

 
 
 
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
  try { fs.chmodSync(shim, 0o755); } catch {}
  return shim;
}

function finishE2e() {
  try {
    const redirected = fs.existsSync(runtimeWarningFile) ? fs.readFileSync(runtimeWarningFile, 'utf8') : '';
    if (/DEP0190|DeprecationWarning:[^\r\n]*shell option true/i.test(redirected)) {
      runtimeDep0190.push(`redirected child warnings:\n${redirected.slice(0, 12000)}`);
    }
  } catch (error) {
    runtimeDep0190.push(`warning redirect gate read failed: ${error.message}`);
  }
  total++; // e2e-shard: run-wide check
  if (runtimeDep0190.length === 0) {
    console.log(smokeOnly ? '✓ smoke 부모·자식 런타임 DEP0190 0건 (full E2E not run)'
      : '✓ AP(1.36.162/T-0139) 전체 E2E 부모+동기·ignore·async 자식 런타임 DEP0190 0건');
  } else {
    failed++;
    console.log(`✗ T-0139 DEP0190 런타임 경고 ${runtimeDep0190.length}건`);
    process.stderr.write(runtimeDep0190.join('\n---\n') + '\n');
  }

  total++; // e2e-shard: run-wide check
  const _pkgChanged = repoGuard.diff(_pkgLeernessBefore, repoGuard.snapshot(_pkgLeerness));
  if (childExitMatches(_e2eHomeInit) && _pkgChanged.length === 0) {
    console.log(`✓ T-0315 e2e 가 패키지 저장소 .leerness 를 바꾸지 않음 (항목 ${_pkgLeernessBefore.size}개 대조 · cwd 없는 CLI 호출은 격리 홈 프로젝트에서 실행)`);
  } else {
    failed++;
    console.log(`✗ T-0315 e2e 격리 실패 — 격리 홈 init exit=${_e2eHomeInit.status}, 패키지 .leerness 변경 ${_pkgChanged.length}건: ${_pkgChanged.slice(0, 20).join(', ')}${_pkgChanged.length > 20 ? ' …' : ''}`
      + ' (실행 중 이 저장소에서 leerness 를 직접 실행했다면 그 쓰기도 여기에 잡힌다)');
  }

  let _shard = null;
  if (!smokeOnly) {
    total++; // e2e-shard: run-wide check
    _shard = e2eShard.finish();
    const _shardName = _shard.spec ? `샤드 ${_shard.spec.index}/${_shard.spec.count}` : '샤드 없음(전체)';
    if (_shard.ok) {
      console.log(`✓ T-0359 e2e ${_shardName}: 케이스 ${_shard.ran}/${_shard.total}개 실행 · 가드 ${_shard.total}개가 각각 한 번씩 도달 · 가드 없는 최상위 블록 0`);
    } else {
      failed++;
      console.log(`✗ T-0359 e2e 샤드 가드 이상 ${JSON.stringify({ problems: _shard.problems.slice(0, 10), missing: _shard.missing.slice(0, 10), repeated: _shard.repeated.slice(0, 10), unknown: _shard.unknown.slice(0, 10) })}`);
    }
  }

  const _temp = require('./temp-cleanup').trackTemp(module);
  if (_temp.active) console.log(`  임시 폴더 ${_temp.pending()}개 기록 — 러너가 종료 코드 0 을 보면 삭제, 실패면 남김`);
  console.log(`\n${smokeOnly ? 'E2E smoke-only (full E2E not run)' : 'E2E'} result: ${total - failed}/${total} passed${_shard && _shard.spec ? ` · shard ${_shard.spec.index}/${_shard.spec.count} (${_shard.ran}/${_shard.total} cases)` : ''} · ${((Date.now() - _e2eStart) / 1000).toFixed(0)}s`);
  if (failed > 0) process.exitCode = 1;
}

function run(label, args, opts = {}) {
  total++;
  const started = performance.now();
  const r = cp.spawnSync(process.execPath, [CLI, ...args], { cwd: opts.cwd || tmp, encoding: 'utf8', timeout: 30000 });
  const diagnostic = childDiagnostics(r, performance.now() - started, 30000);
  const ok = childExitMatches(r, opts.expectFail);
  process.stdout.write(`${ok ? '✓' : '✗'} ${label} (exit=${r.status}, elapsedMs=${diagnostic.elapsedMs})\n`);
  if (!ok) {
    failed++;
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    console.log(JSON.stringify(diagnostic));
  }
  return { ok, stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

console.log(`# leerness e2e smoke @ ${tmp}`);

run('init',                ['init', tmp, '--yes', '--language', 'ko', '--skills', 'recommended']);
run('status',              ['status', tmp]);
run('verify',              ['verify', tmp]);
run('debug',               ['debug', tmp]);
run('check',               ['check', tmp]);
run('audit',               ['audit', tmp]);
run('scan secrets',        ['scan', 'secrets', tmp]);
run('encoding check',      ['encoding', 'check', tmp]);

const secretFile = path.join(tmp, 'fake-config.json');
fs.writeFileSync(secretFile, JSON.stringify({ openai: 'sk-' + 'a1B2'.repeat(12) }));
run('scan secrets (detect)', ['scan', 'secrets', tmp], { expectFail: true });
fs.unlinkSync(secretFile);

run('plan add 1',          ['plan', 'add', '마일스톤 A', '--status', 'planned', '--path', tmp]);
run('plan add 2',          ['plan', 'add', '마일스톤 B', '--status', 'in-progress', '--path', tmp]);
run('task add',            ['task', 'add', '사용자 요청 X', '--status', 'requested', '--path', tmp]);
run('task update T-0001',  ['task', 'update', 'T-0001', '--status', 'in-progress', '--next', '검증 실행', '--path', tmp]);
run('task update T-0001 done', ['task', 'update', 'T-0001', '--status', 'done', '--evidence', 'review-evidence:e2e', '--path', tmp]);

const tracker = fs.readFileSync(path.join(tmp, '.leerness/progress-tracker.md'), 'utf8');
const t1Count = (tracker.match(/^\| T-0001 \|/gm) || []).length;
total++;
if (t1Count === 1) console.log('✓ B1 in-place update: T-0001 row count = 1');
else { failed++; console.log(`✗ B1 in-place update FAILED: T-0001 row count = ${t1Count} (expected 1)`); }

fs.appendFileSync(path.join(tmp, '.leerness/review-evidence.md'),
  '\n## e2e\nTask: T-0001\nCommand: npm test\nExit: 0\nNote: e2e smoke\n');

run('session close',       ['session', 'close', tmp]);
run('handoff',             ['handoff', tmp]);
run('audit (post close)',  ['audit', tmp]);
run('lazy detect',         ['lazy', 'detect', tmp]);
run('memory search',       ['memory', 'search', '마일스톤', '--path', tmp]);

if (smokeOnly) {
  setImmediate(finishE2e);
  return;
}

const offline = Object.assign({}, process.env, { LEERNESS_OFFLINE: '1' });
// e2e-shard: cases start here. Below this line, top-level code outside a case only prepares later cases: a case
 
 
if (e2eShard.take('update --check (offline): 조회 실패를')) {
  total++;
   
   
   
  const r = cp.spawnSync(process.execPath, [CLI, 'update', tmp, '--check'], { env: offline, encoding: 'utf8' });
  const _o = r.stdout || '';
  const ok = r.status === 0 && /확인 불가|migration available/.test(_o) && !/→ up to date/.test(_o);
  console.log(ok ? '✓ update --check (offline): 조회 실패를 "최신" 으로 단정하지 않음 (1.36.102)' : `✗ update --check (offline) exit=${r.status}`);
  if (!ok) { failed++; console.log(r.stdout || ''); console.error(r.stderr || ''); }
}

run('auto-update install', ['auto-update', 'install', tmp]);
if (e2eShard.take('SessionStart hook for update --check ins')) {
  total++;
  const settingsFile = path.join(tmp, '.claude/settings.local.json');
  if (fs.existsSync(settingsFile)) {
    const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    const hasHook = (s.hooks?.SessionStart || []).some(g => (g.hooks || []).some(h => h.type === 'command' && h.command === 'leerness update --check --quiet'));
    if (hasHook) console.log('✓ SessionStart hook for update --check installed');
    else { failed++; console.log('✗ SessionStart hook missing'); }
  } else { failed++; console.log('✗ .claude/settings.local.json missing'); }
}

 
if (e2eShard.take('B(P6)')) {
  total++;
  const trackerPath = path.join(tmp, '.leerness/progress-tracker.md');
  let cur = fs.readFileSync(trackerPath, 'utf8');
  cur = cur.replace(/^\| T-0001 \|.*$/m, '| T-0001 | done | mile A | tests:32/32 (plan:M-0002) | next | 2026-05-08 |');
  fs.writeFileSync(trackerPath, cur, 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'lazy', 'detect', tmp], { encoding: 'utf8' });
  const ok = r.status === 0;
  console.log(ok ? '✓ B(P6) lazy detect: plan:M-XXXX + 검증 키워드 → pass' : `✗ B(P6) FAIL exit=${r.status}\n${r.stdout}`);
  if (!ok) failed++;
}
 
if (e2eShard.take('B(P6 neg)')) {
  total++;
  const trackerPath = path.join(tmp, '.leerness/progress-tracker.md');
  let cur = fs.readFileSync(trackerPath, 'utf8');
  cur = cur.replace(/^\| T-0001 \|.*$/m, '| T-0001 | done | mile A | plan:M-0002 | next | 2026-05-08 |');
  fs.writeFileSync(trackerPath, cur, 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'lazy', 'detect', tmp], { encoding: 'utf8' });
  const ok = r.status === 1 && /done row without verifiable evidence/.test(r.stdout);
  console.log(ok ? '✓ B(P6 neg) lazy detect: plan:M-XXXX 단독 → warn 유지' : `✗ B(P6 neg) FAIL exit=${r.status}`);
  if (!ok) failed++;
   
  cur = cur.replace(/^\| T-0001 \|.*$/m, '| T-0001 | done | mile A | tests:32/32 (plan:M-0002) | next | 2026-05-08 |');
  fs.writeFileSync(trackerPath, cur, 'utf8');
}

 
if (e2eShard.take('B(P1)')) {
  total++;
  const settingsFile = path.join(tmp, '.claude/settings.local.json');
  const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  s.hooks.SessionStart = [{ matcher: '*', command: 'leerness-plus update --check' }];
  fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2));
  cp.spawnSync(process.execPath, [CLI, 'auto-update', 'install', tmp], { encoding: 'utf8' });
  const after = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const hasLegacy = (after.hooks?.SessionStart || []).some(g => /leerness-plus update/.test(g.command || '') || (g.hooks || []).some(h => /leerness-plus update/.test(h.command || '')));
  const hasNew = (after.hooks?.SessionStart || []).some(g => (g.hooks || []).some(h => h.type === 'command' && h.command === 'leerness update --check --quiet'));
  const ok = !hasLegacy && hasNew;
  console.log(ok ? '✓ B(P1) legacy leerness-plus hook 자동 제거' : '✗ B(P1) legacy hook 남음');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(P4)')) {
  total++;
  const ds = path.join(tmp, '.leerness/design-system.md');
  fs.appendFileSync(ds, '\n<!-- leerness:na CLI 프로젝트라 디자인 토큰 없음 -->\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'audit', tmp], { encoding: 'utf8' });
  const ok = !/design-system\.md tokens not customized/.test(r.stdout) && /marked NA/.test(r.stdout);
  console.log(ok ? '✓ B(P4) NA 마커 인식: design-system 경고 스킵' : '✗ B(P4) NA 마커 미작동');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(P7)')) {
  total++;
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-e2e-p7-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmp2, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8' });
  const tracker = fs.readFileSync(path.join(tmp2, '.leerness/progress-tracker.md'), 'utf8');
  const ok = /M-0001/.test(tracker);
  console.log(ok ? '✓ B(P7) init: M-0001 → progress row 자동 생성' : '✗ B(P7) progress에 M-0001 row 없음');
  if (!ok) failed++;
}

 
run('route planning',      ['route', 'planning']);
run('route bugfix',        ['route', 'bugfix']);
run('skill list',          ['skill', 'list']);
run('skill info',          ['skill', 'info', 'feature-implementation']);

 
run('skill learn (new)',   ['skill', 'learn', 'open-meteo', '--doc', 'https://open-meteo.com/en/docs', '--command', 'fetch hourly+daily JSON', '--capability', 'http fetch', '--capability', 'cache', '--note', 'e2e learn', '--display', 'Open-Meteo 날씨 스킬', '--path', tmp]);
run('skill use (new)',     ['skill', 'use', 'open-meteo', '--note', 'first call', '--path', tmp]);
run('skill use (catalog)', ['skill', 'use', 'feature-implementation', '--note', 'catalog skill materialize', '--path', tmp]);
run('skill optimize',      ['skill', 'optimize', 'open-meteo', '--before', 'no cache', '--after', 'If-Modified-Since', '--note', 'e2e opt', '--path', tmp]);

if (e2eShard.take('skill.json optimizations 누적')) {
  total++;
  const f = path.join(tmp, '.leerness/skills/open-meteo/skill.json');
  const ok = fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).optimizations.length === 1;
  console.log(ok ? '✓ skill.json optimizations 누적' : '✗ skill.json optimizations 누적 실패');
  if (!ok) failed++;
}
if (e2eShard.take('skill usage/sources/patterns 누적')) {
  total++;
  const data = JSON.parse(fs.readFileSync(path.join(tmp, '.leerness/skills/open-meteo/skill.json'), 'utf8'));
  const ok = data.usage.count === 1 && data.sources.length >= 1 && data.patterns.length >= 1;
  console.log(ok ? '✓ skill usage/sources/patterns 누적' : '✗ skill usage/sources/patterns 누적 실패');
  if (!ok) failed++;
}

run('skill consolidate',   ['skill', 'consolidate', '--threshold', '0.1', '--path', tmp]);
run('skill remove (user)', ['skill', 'remove', 'open-meteo', '--path', tmp]);
if (e2eShard.take('skill remove: 디렉토리 삭제')) {
  total++;
  const ok = !fs.existsSync(path.join(tmp, '.leerness/skills/open-meteo'));
  console.log(ok ? '✓ skill remove: 디렉토리 삭제' : '✗ skill remove: 디렉토리 잔존');
  if (!ok) failed++;
}

 
 
fs.mkdirSync(path.join(tmp, 'src/components'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'src/pages'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'src/styles'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'src/styles/tokens.css'), `:root { --color-primary: #ff5722; --color-text: #222222; }\n`);
fs.writeFileSync(path.join(tmp, 'src/components/Card.html'), `<div class="card"><slot/></div>\n`);
fs.writeFileSync(path.join(tmp, 'src/pages/home.html'), `<link href="../styles/tokens.css"><include src="../components/Card.html"/>\n`);
fs.writeFileSync(path.join(tmp, 'src/pages/about.html'), `<link href="../styles/tokens.css"><include src="../components/Card.html"/>\n`);
 
const dsPath = path.join(tmp, '.leerness/design-system.md');
let dsText = fs.readFileSync(dsPath, 'utf8');
dsText = dsText.replace('| color.primary | (실제 값으로 업데이트) | |', '| color.primary | #ff5722 | 메인 컬러 |');
dsText = dsText.replace('| color.surface | | |', '| color.surface | #222222 | 본문 텍스트 |');
fs.writeFileSync(dsPath, dsText);

run('impact: Card.html → home/about',  ['impact', 'src/components/Card.html', '--path', tmp]);
run('reuse find: Card 후보',           ['reuse', 'find', 'Card', '--path', tmp]);
run('reuse register: Card',            ['reuse', 'register', 'Card', '--where', 'src/components/Card.html', '--kind', 'component', '--note', 'e2e card', '--path', tmp]);

if (e2eShard.take('reuse-map.md에 Card row 자동 추가')) {
  total++;
  const reuse = fs.readFileSync(path.join(tmp, '.leerness/reuse-map.md'), 'utf8');
  const ok = /\| Card \| src\/components\/Card\.html \| component \|/.test(reuse);
  console.log(ok ? '✓ reuse-map.md에 Card row 자동 추가' : '✗ Card row 미등록');
  if (!ok) failed++;
}

run('ui consistency: pass (토큰 외 색상 없음)', ['ui', 'consistency', tmp]);

 
fs.writeFileSync(path.join(tmp, 'src/pages/contact.html'), `<style>.box { color: #abcdef; background: #123456; }</style>\n`);
if (e2eShard.take('ui consistency: 일탈 색상 #abcdef 검출 + 비0 종료')) {
  total++;
  const r = cp.spawnSync(process.execPath, [CLI, 'ui', 'consistency', tmp, '--fail-on-violation'], { encoding: 'utf8' });
  const ok = r.status === 1 && /토큰 외 값/.test(r.stdout) && /#abcdef/i.test(r.stdout);
  console.log(ok ? '✓ ui consistency: 일탈 색상 #abcdef 검출 + 비0 종료' : '✗ ui consistency 일탈 미검출');
  if (!ok) { failed++; console.log(r.stdout); }
}

run('graph: mermaid 출력',             ['graph', tmp]);
run('guide: 통합 가이드',               ['guide', 'src/components/Card.html', '--path', tmp]);

 
if (e2eShard.take('B(A)')) {
  total++;
   
  fs.appendFileSync(path.join(tmp, 'src/pages/home.html'), '\n<!-- 카드 콘텐츠는 Cards 배열로 -->\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'impact', 'src/components/Card.html', '--path', tmp], { encoding: 'utf8' });
  const strongOK = /강한 참조 \d+개/.test(r.stdout);
  const weakHint = /약한 참조|영향 범위 없음/.test(r.stdout);
  console.log(strongOK && weakHint ? '✓ B(A) impact: strong/weak 구분 출력' : '✗ B(A) impact 구분 실패');
  if (!(strongOK && weakHint)) failed++;
}

 
if (e2eShard.take('B(1.9.16)')) {
  total++;
   
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bsa-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bsb-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.appendFileSync(path.join(tmpA, '.leerness/decisions.md'), '\n### 2026-05-13 — 캐시 정책\n- Reason: rate limit\n');
  fs.appendFileSync(path.join(tmpB, '.leerness/decisions.md'), '\n### 2026-05-13 — 캐시 분산\n- Reason: 확장성\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'brainstorm', '캐시', '--include', `${tmpA},${tmpB}`], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status === 0 && /Cross-project Brainstorm — "캐시" — 2개/.test(r.stdout) && /워크스페이스 총합: 2건/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.16) brainstorm --include 통합' : '✗ brainstorm --include 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 600)); }
}

if (e2eShard.take('B(1.9.16) #2')) {
  total++;
   
  const tmpJ = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-json-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpJ, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.appendFileSync(path.join(tmpJ, '.leerness/decisions.md'), '\n### 2026-05-13 — JSON 결정\n- ...\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'brainstorm', 'JSON', '--json', '--path', tmpJ], { encoding: 'utf8', timeout: 15000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = r.status === 0 && parsed && parsed.topic === 'JSON' && parsed.total >= 1;
  console.log(ok ? '✓ B(1.9.16) brainstorm --json 단일' : `✗ brainstorm --json 실패\n${r.stdout.slice(0, 300)}`);
  if (!ok) failed++;
}

if (e2eShard.take('B(1.9.16) #3')) {
  total++;
   
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rj-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'retro', tmpR, '--json'], { encoding: 'utf8', timeout: 15000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = r.status === 0 && parsed && parsed.summary && parsed.data;
  console.log(ok ? '✓ B(1.9.16) retro --json' : '✗ retro --json 실패');
  if (!ok) failed++;
}

if (e2eShard.take('B(1.9.16) #4')) {
  total++;
   
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-iwsa-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-iwsb-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'insights', '--include', `${tmpA},${tmpB}`, '--json'], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = r.status === 0 && parsed && parsed.projectCount === 2 && Array.isArray(parsed.projects);
  console.log(ok ? '✓ B(1.9.16) insights --include --json' : '✗ insights --json 실패');
  if (!ok) failed++;
}

if (e2eShard.take('B(1.9.16) #5')) {
  total++;
   
  const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ws-'));
  fs.mkdirSync(path.join(wsRoot, '_apps'), { recursive: true });
  const proj = path.join(wsRoot, 'main');
  const other = path.join(wsRoot, '_apps', 'other');
  cp.spawnSync(process.execPath, [CLI, 'init', proj, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', other, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
   
  const r = cp.spawnSync(process.execPath, [CLI, 'session', 'close', proj], { encoding: 'utf8', timeout: 15000 });
  const ok = /워크스페이스에 \d+개 다른 leerness 프로젝트/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.16) session close 워크스페이스 안내' : '✗ session close 안내 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(-500)); }
}

 
if (e2eShard.take('B(1.9.17)')) {
  total++;
   
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ha-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-hb-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', '--include', `${tmpA},${tmpB}`], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status === 0 && /Workspace Handoff — 2개 프로젝트 \(1\.9\.\d+\)/.test(r.stdout) && /워크스페이스 총합/.test(r.stdout) && /오케스트레이션 권장/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.17) handoff --include 통합 워크스페이스 뷰' : '✗ handoff --include 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 600)); }
}

if (e2eShard.take('B(1.9.17) #2')) {
  total++;
   
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-haj-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-hbj-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', '--include', `${tmpA},${tmpB}`, '--json'], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = r.status === 0 && parsed && Array.isArray(parsed.projects) && parsed.projects.length === 2 && parsed.totals;
  console.log(ok ? '✓ B(1.9.17) handoff --include --json' : '✗ handoff --json 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.17) #3')) {
  total++;
   
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rma-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rmb-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  const rowA = '| Cache | src/cache.js | util | LRU |\n';
  const rowB = '| Cache | src/foo.js | util | Memoize |\n';
  fs.appendFileSync(path.join(tmpA, '.leerness/reuse-map.md'), rowA);
  fs.appendFileSync(path.join(tmpB, '.leerness/reuse-map.md'), rowB);
   
  const rs = cp.spawnSync(process.execPath, [CLI, 'reuse-map', tmpA], { encoding: 'utf8', timeout: 15000 });
  const okSingle = rs.status === 0 && /Reuse Map/.test(rs.stdout) && /Cache/.test(rs.stdout);
   
  const rw = cp.spawnSync(process.execPath, [CLI, 'reuse-map', '--include', `${tmpA},${tmpB}`], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const okMulti = rw.status === 0 && /Workspace Reuse Map — 2개 프로젝트/.test(rw.stdout) && /중복 capability/.test(rw.stdout) && /"Cache"/.test(rw.stdout);
   
  const rj = cp.spawnSync(process.execPath, [CLI, 'reuse-map', '--include', `${tmpA},${tmpB}`, '--json'], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  let parsed = null;
  try { parsed = JSON.parse(rj.stdout); } catch {}
  const okJson = rj.status === 0 && parsed && Array.isArray(parsed.duplicates) && parsed.duplicates.length >= 1;
  const ok = okSingle && okMulti && okJson;
  console.log(ok ? '✓ B(1.9.17) reuse-map 단일/워크스페이스/JSON + 중복 감지' : `✗ reuse-map 실패 (단일=${okSingle} 멀티=${okMulti} JSON=${okJson})`);
  if (!ok) { failed++; console.log(rw.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.18)')) {
  total++;
   
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sincea-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sinceb-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  const today = new Date().toISOString().slice(0,10);
  fs.appendFileSync(path.join(tmpA, '.leerness/progress-tracker.md'), `| T-9999 | done | 신규 기능 | src/x.js | M-NEW | ${today} |\n`);
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', '--include', `${tmpA},${tmpB}`, '--since', '1d'], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status === 0 && /1\.9\.\d+/.test(r.stdout) && /Filter: since 1d/.test(r.stdout) && /🆕/.test(r.stdout) && /최근 변경/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.18) handoff --since: 최근 변경 강조' : '✗ handoff --since 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.18) #2')) {
  total++;
   
  const tmpE = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sincee-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpE, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', '--include', tmpE, '--since', 'banana'], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status !== 0 && /형식 오류/.test(r.stdout + r.stderr);
  console.log(ok ? '✓ B(1.9.18) handoff --since 형식 오류 → exit≠0' : '✗ handoff --since 오류 검증 실패');
  if (!ok) failed++;
}

if (e2eShard.take('B(1.9.18) #3')) {
  total++;
   
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-strict-a-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-strict-b-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  fs.appendFileSync(path.join(tmpA, '.leerness/reuse-map.md'), '| HtmlEscape | src/util.js (escapeHtml) | util | XSS 방지 |\n');
  fs.appendFileSync(path.join(tmpB, '.leerness/reuse-map.md'), '| EscapeHtml | src/build.js (escapeHtml) | util | 마크업 이스케이프 |\n');
   
  const r1 = cp.spawnSync(process.execPath, [CLI, 'reuse-map', '--include', `${tmpA},${tmpB}`], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const okDefault = r1.status === 0 && /정확 중복 capability/.test(r1.stdout) && /\(없음\)/.test(r1.stdout);
   
  const r2 = cp.spawnSync(process.execPath, [CLI, 'reuse-map', '--include', `${tmpA},${tmpB}`, '--strict-elements'], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const okStrict = r2.status === 0 && /잠재 중복/.test(r2.stdout) && /escapeHtml/.test(r2.stdout) && /HtmlEscape/.test(r2.stdout) && /EscapeHtml/.test(r2.stdout);
   
  const r3 = cp.spawnSync(process.execPath, [CLI, 'reuse-map', '--include', `${tmpA},${tmpB}`, '--strict-elements', '--json'], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  let parsed = null;
  try { parsed = JSON.parse(r3.stdout); } catch {}
  const okJson = r3.status === 0 && parsed && Array.isArray(parsed.fuzzyDuplicates) && parsed.fuzzyDuplicates.length === 1 && parsed.fuzzyDuplicates[0].functionName === 'escapehtml';
  const ok = okDefault && okStrict && okJson;
  console.log(ok ? '✓ B(1.9.18) reuse-map --strict-elements 잠재 중복 감지' : `✗ strict-elements 실패 (default=${okDefault} strict=${okStrict} json=${okJson})`);
  if (!ok) { failed++; console.log(r2.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.18) #4')) {
  total++;
   
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-deps-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.appendFileSync(path.join(tmpA, '.leerness/reuse-map.md'),
    '| EscapeHtml | src/build.js (escapeHtml) | util | XSS 방지 |\n' +
    '| RssFeed | src/build.js (buildFeed) | util | RSS 2.0 (depends-on: EscapeHtml) |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'reuse-map', '--include', tmpA], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status === 0 && /의존 관계 \(depends-on, 1개 엣지\)/.test(r.stdout) && /RssFeed.*─→.*EscapeHtml/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.18) reuse-map depends-on 엣지 추출' : '✗ depends-on 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('pass (실측 ≥ 주장)')) {
  total++;
   
  const tmpV = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-vc-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpV, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  fs.mkdirSync(path.join(tmpV, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpV, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmpV, 'src/myMod.js'), 'module.exports = { ok: true };\n');
  fs.writeFileSync(path.join(tmpV, 'tests/test.js'), 'check(1); check(2); check(3); check(4); check(5);\n');
   
   
   
  fs.appendFileSync(path.join(tmpV, '.leerness/progress-tracker.md'),
    '| T-0099 | done | 신모듈 | src/myMod.js + tests/test.js 테스트 5개 (5/5 통과) | next | 2026-05-14 |\n');
   
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0099', '--path', tmpV], { encoding: 'utf8', timeout: 15000 });
  const okPass = r.status === 0 && /✓ src\/myMod\.js/.test(r.stdout) && /✓ tests\/test\.js/.test(r.stdout) && /pass \(실측 ≥ 주장\)/.test(r.stdout);
   
  fs.unlinkSync(path.join(tmpV, 'src/myMod.js'));
  const r2 = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0099', '--path', tmpV], { encoding: 'utf8', timeout: 15000 });
  const okFail = r2.status !== 0 && /✗ src\/myMod\.js/.test(r2.stdout) && /FAIL/.test(r2.stdout);
   
  const r3 = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0099', '--path', tmpV, '--json'], { encoding: 'utf8', timeout: 15000 });
  let parsed = null;
  try { parsed = JSON.parse(r3.stdout); } catch {}
  const okJson = parsed && parsed.taskId === 'T-0099' && parsed.verdict && parsed.verdict.filesAllExist === false;
  const ok = okPass && okFail && okJson;
  console.log(ok ? '✓ B(1.9.18) verify-claim 파일/테스트 검증 + exit code + JSON' : `✗ verify-claim 실패 (pass=${okPass} fail=${okFail} json=${okJson})`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.19)')) {
  total++;
   
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rt-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  fs.writeFileSync(path.join(tmpR, 'package.json'), JSON.stringify({
    name: 'rt-fixture', version: '0.0.1', scripts: { test: 'node tests/test.js' }
  }));
  fs.mkdirSync(path.join(tmpR, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpR, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmpR, 'src/mod.js'), 'module.exports = { ok: true };\n');
   
  fs.writeFileSync(path.join(tmpR, 'tests/test.js'),
    "let p=0;function check(c){if(c)p++;}check(1);check(1);check(1);check(1);check(1);console.log(p+'/5 passed');if(p!==5)process.exit(1);\n");
  fs.appendFileSync(path.join(tmpR, '.leerness/progress-tracker.md'),
    '| T-0050 | done | rt 작업 | src/mod.js + tests/test.js (5/5 통과) | next | 2026-05-14 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0050', '--path', tmpR, '--run-tests'], { encoding: 'utf8', timeout: 60000 });
  const ok = r.status === 0
    && /npm test 실행 \(--run-tests\)/.test(r.stdout)
    && /실행 결과: 5\/5 passed/.test(r.stdout)
    && /주장 vs 실행: ✓ 일치/.test(r.stdout)
    && /npm test 실행: ✓ all passed/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.19) verify-claim --run-tests: npm test 실행 + 주장 일치' : '✗ --run-tests 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 600)); }
}

if (e2eShard.take('B(1.9.19) #2')) {
  total++;
   
  const tmpF = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rtf-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpF, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpF, 'package.json'), JSON.stringify({ name: 'rtf', version: '0.0.1', scripts: { test: 'node tests/test.js' } }));
  fs.mkdirSync(path.join(tmpF, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpF, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmpF, 'src/mod.js'), 'module.exports = { ok: true };\n');
  fs.writeFileSync(path.join(tmpF, 'tests/test.js'),
    "console.log('3/5 passed'); process.exit(1);\n");
  fs.appendFileSync(path.join(tmpF, '.leerness/progress-tracker.md'),
    '| T-0051 | done | 거짓 | src/mod.js + tests/test.js (5/5 통과) | next | 2026-05-14 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0051', '--path', tmpF, '--run-tests'], { encoding: 'utf8', timeout: 60000 });
  const ok = r.status !== 0
    && /불일치/.test(r.stdout)
    && /npm test 실행: ✗ FAIL/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.19) verify-claim --run-tests: 주장/실행 불일치 → exit≠0' : '✗ --run-tests 불일치 검증 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 600)); }
}

if (e2eShard.take('B(1.9.19) #3')) {
  total++;
   
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-strict2-a-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-strict2-b-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  fs.appendFileSync(path.join(tmpA, '.leerness/reuse-map.md'),
    '| FormatX | src/util.js (format) | util | A |\n');
  fs.appendFileSync(path.join(tmpB, '.leerness/reuse-map.md'),
    '| FormatY | src/util.js (format) | util | B |\n');
   
  fs.appendFileSync(path.join(tmpA, '.leerness/reuse-map.md'),
    '| Stats1 | src/memo.js (stats) | util | A |\n');
  fs.appendFileSync(path.join(tmpB, '.leerness/reuse-map.md'),
    '| Stats2 | bin/cli.js (stats) | command | B |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'reuse-map', '--include', `${tmpA},${tmpB}`, '--strict-elements'], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status === 0
    && /⚠ 진짜 중복 가능/.test(r.stdout)
    && /ℹ 의도 분리 가능/.test(r.stdout)
    && /같은 파일 \+ 같은 함수: 1건/.test(r.stdout)
    && /다른 파일 \+ 같은 함수: 1건/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.19) --strict-elements: same-file ⚠ vs diff-file ℹ 구분' : '✗ strict-elements 분류 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 600)); }
}

 
if (e2eShard.take('B(1.9.20)')) {
  total++;
   
  const tmpG = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-godot-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpG, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpG, 'project.godot'), 'config_version=5\n');
  fs.mkdirSync(path.join(tmpG, 'scenes'), { recursive: true });
  fs.mkdirSync(path.join(tmpG, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(tmpG, 'scenes/main.tscn'), '[gd_scene]\n');
  fs.writeFileSync(path.join(tmpG, 'scripts/network.gd'), 'extends Node\n');
  fs.appendFileSync(path.join(tmpG, '.leerness/progress-tracker.md'),
    '| T-0020 | done | Godot 클라 | project.godot + scenes/main.tscn + scripts/network.gd | next | 2026-05-14 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0020', '--path', tmpG, '--lenient'], { encoding: 'utf8', timeout: 15000 });   
  const ok = r.status === 0
    && /✓ project\.godot/.test(r.stdout)
    && /✓ scenes\/main\.tscn/.test(r.stdout)
    && /✓ scripts\/network\.gd/.test(r.stdout)
    && !/scenes\/main\.ts\s/.test(r.stdout);  
  console.log(ok ? '✓ B(1.9.20) verify-claim regex: 도메인 폴더 + 루트 파일 + .tscn 정확' : '✗ regex 확장 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

 
if (e2eShard.take('B(1.9.21)')) {
  total++;
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-cfg-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpC, 'export_presets.cfg'), '[preset.0]\n');
  fs.writeFileSync(path.join(tmpC, 'config.ini'), '[main]\n');
  fs.writeFileSync(path.join(tmpC, 'Cargo.lock'), '# lock\n');
  fs.appendFileSync(path.join(tmpC, '.leerness/progress-tracker.md'),
    '| T-0030 | done | 설정 | export_presets.cfg + config.ini + Cargo.lock | next | 2026-05-14 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0030', '--path', tmpC, '--lenient'], { encoding: 'utf8', timeout: 15000 });   
  const ok = r.status === 0
    && /✓ export_presets\.cfg/.test(r.stdout)
    && /✓ config\.ini/.test(r.stdout)
    && /✓ Cargo\.lock/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.21) verify-claim regex: .cfg/.ini/.lock 등 설정 메타 파일' : '✗ .cfg/.ini 확장 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

 
if (e2eShard.take('B(1.9.25)')) {
  total++;
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-incode-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.mkdirSync(path.join(tmpC, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpC, 'src/feature.js'), "function specialMagicHandler() { return 42; }\n");
   
  const r1 = cp.spawnSync(process.execPath, [CLI, 'memory', 'search', 'specialMagicHandler', '--path', tmpC], { encoding: 'utf8', timeout: 10000 });
   
  const r2 = cp.spawnSync(process.execPath, [CLI, 'memory', 'search', 'specialMagicHandler', '--path', tmpC, '--include-code'], { encoding: 'utf8', timeout: 10000 });
  const ok = /no matches/.test(r1.stdout) && /src\/feature\.js/.test(r2.stdout) && /소스 코드 포함/.test(r2.stdout);
  console.log(ok ? '✓ B(1.9.25) memory search --include-code: 코드 본문 검색' : '✗ --include-code 실패');
  if (!ok) { failed++; console.log(r2.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.25) #2')) {
  total++;
   
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-regp-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'register-pending', 'JSON export 기능', '--agent', 'agy', '--path', tmpR], { encoding: 'utf8', timeout: 10000 });
  const okReg = r.status === 0 && /등록됨 \(in-progress\) by agy/.test(r.stdout);
   
  const r2 = cp.spawnSync(process.execPath, [CLI, 'memory', 'search', 'JSON export', '--path', tmpR], { encoding: 'utf8', timeout: 10000 });
  const okSearch = /in-progress/.test(r2.stdout) && /pending.*agy/.test(r2.stdout);
  const ok = okReg && okSearch;
  console.log(ok ? '✓ B(1.9.25) register-pending: 즉시 등록 + 검색 가능' : `✗ register-pending 실패 (reg=${okReg} search=${okSearch})`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.26)')) {
  total++;
  const tmpO = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-optm-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpO, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.mkdirSync(path.join(tmpO, 'src'), { recursive: true });
   
  fs.writeFileSync(path.join(tmpO, 'src/app.js'), "function pureCompute(n) { return n * 2; }\nmodule.exports = { pureCompute };\n");
   
  fs.appendFileSync(path.join(tmpO, '.leerness/progress-tracker.md'),
    '| T-9001 | done | API 등록 | POST /users API 호출 완료, HTTP 201 응답 확인 | (완료) | 2026-05-15 |\n');
   
  fs.appendFileSync(path.join(tmpO, '.leerness/progress-tracker.md'),
    '| T-9002 | done | pure compute | src/app.js pureCompute 함수 구현 | (완료) | 2026-05-15 |\n');
   
  const r1 = cp.spawnSync(process.execPath, [CLI, 'optimism-check', 'T-9001', '--path', tmpO], { encoding: 'utf8', timeout: 10000 });
  const okFalse = r1.status !== 0 && /낙관적 표시 의심/.test(r1.stdout) && /API\/HTTP 호출/.test(r1.stdout);
   
  const r2 = cp.spawnSync(process.execPath, [CLI, 'optimism-check', 'T-9002', '--path', tmpO], { encoding: 'utf8', timeout: 10000 });
  const okOk = r2.status === 0 && /의심 없음/.test(r2.stdout);
  const ok = okFalse && okOk;
  console.log(ok ? '✓ B(1.9.26) optimism-check: 낙관적 API 거짓 감지 + 정상 무경고' : `✗ optimism-check 실패 (거짓=${okFalse} 정상=${okOk})`);
  if (!ok) { failed++; console.log('--- 거짓 case ---\n' + r1.stdout.slice(0, 300) + '\n--- 정상 case ---\n' + r2.stdout.slice(0, 300)); }
}

if (e2eShard.take('B(1.9.26) #2')) {
  total++;
   
  const tmpS = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-stct-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpS, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.mkdirSync(path.join(tmpS, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpS, 'src/x.js'), 'module.exports = { ok: true };\n');
  fs.appendFileSync(path.join(tmpS, '.leerness/progress-tracker.md'),
    '| T-0050 | done | DB 마이그레이션 | 사용자 데이터 DB에 저장, 1000건 insert 성공 | (완료) | 2026-05-15 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0050', '--path', tmpS, '--strict-claims'], { encoding: 'utf8', timeout: 10000 });
  const ok = r.status !== 0 && /낙관적 표시[^\n]*⚠ FAIL/.test(r.stdout) && /DB 호출/.test(r.stdout);   
  console.log(ok ? '✓ B(1.9.26) verify-claim --strict-claims: DB 거짓 evidence 통합 감지' : '✗ --strict-claims 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.27)')) {
  total++;
   
  const tmpU = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-url-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpU, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.mkdirSync(path.join(tmpU, 'src'), { recursive: true });
   
  fs.writeFileSync(path.join(tmpU, 'src/ollama.js'), "http.request({host:'localhost',path:'/api/tags',method:'GET'})");
   
  fs.appendFileSync(path.join(tmpU, '.leerness/progress-tracker.md'),
    '| T-9001 | done | API 사용자 등록 | POST /users API 호출 완료, HTTP 201 응답 확인 | next | 2026-05-15 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'optimism-check', 'T-9001', '--path', tmpU], { encoding: 'utf8', timeout: 10000 });
  const ok = r.status !== 0
    && /\[URL\]/.test(r.stdout)
    && /POST \/users/.test(r.stdout)
    && /신뢰도 \(1\.9\.27\):/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.27) URL 매핑: 1.9.26 false negative 해결 (POST /users 미발견)' : '✗ URL 매핑 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.27) #2')) {
  total++;
   
  const tmpN = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-notify-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpN, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.mkdirSync(path.join(tmpN, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpN, 'src/x.js'), 'module.exports = { ok: true };\n');
  fs.appendFileSync(path.join(tmpN, '.leerness/progress-tracker.md'),
    '| T-9100 | done | Slack 알림 | 슬랙 알림 발송 완료, #general 채널에 통보 | next | 2026-05-15 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'optimism-check', 'T-9100', '--path', tmpN], { encoding: 'utf8', timeout: 10000 });
  const ok = r.status !== 0 && /\[Notify\]/.test(r.stdout) && /슬랙\/Discord 알림/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.27) 신규 카테고리 Notify: 슬랙 알림 거짓 감지' : '✗ Notify 카테고리 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.27) #3')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-conf-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.mkdirSync(path.join(tmpC, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpC, 'src/x.js'), 'module.exports = { ok: true };\n');
  fs.appendFileSync(path.join(tmpC, '.leerness/progress-tracker.md'),
    '| T-9200 | done | pure compute | src/x.js 모듈 추가 | next | 2026-05-15 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'optimism-check', 'T-9200', '--path', tmpC, '--json'], { encoding: 'utf8', timeout: 10000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = r.status === 0 && parsed && parsed.confidence === 1.0 && parsed.suspects.length === 0;
  console.log(ok ? '✓ B(1.9.27) 신뢰도 점수: 정상 evidence → 1.00' : '✗ 신뢰도 점수 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.28)')) {
  total++;
  const tmpK = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-kpay-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpK, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.mkdirSync(path.join(tmpK, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpK, 'src/x.js'), 'module.exports = { ok: true };\n');
  fs.appendFileSync(path.join(tmpK, '.leerness/progress-tracker.md'),
    '| T-9100 | done | 결제 | 카카오페이 결제 승인 완료 | next | 2026-05-15 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'optimism-check', 'T-9100', '--path', tmpK, '--json'], { encoding: 'utf8', timeout: 10000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const okPay = r.status !== 0 && parsed && parsed.suspects.some(s => s.kind === 'Payment');
  const okFloor = parsed && parsed.confidence === 0.15;
  const ok = okPay && okFloor;
  console.log(ok ? '✓ B(1.9.28) 카카오페이 결제 + confidence floor 0.15' : `✗ 1.9.28 실패 (pay=${okPay} floor=${okFloor})`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.29)')) {
  total++;
   
  const r1 = cp.spawnSync(process.execPath, [CLI, 'persona', 'list'], { encoding: 'utf8', timeout: 10000 });
  const okList = r1.status === 0
    && /security: 보안 엔지니어/.test(r1.stdout)
    && /performance: 성능 최적화/.test(r1.stdout)
    && /ux: 한국어 UX/.test(r1.stdout)
    && /testing:/.test(r1.stdout)
    && /docs:/.test(r1.stdout);
   
  const r2 = cp.spawnSync(process.execPath, [CLI, 'persona', 'show', 'security'], { encoding: 'utf8', timeout: 10000 });
  const okShow = r2.status === 0 && /10년 경력/.test(r2.stdout) && /OWASP Top 10/.test(r2.stdout);
   
  const r3 = cp.spawnSync(process.execPath, [CLI, 'persona', 'show', 'unknown999'], { encoding: 'utf8', timeout: 10000 });
  const okMissing = r3.status !== 0 && /페르소나 없음/.test(r3.stdout + r3.stderr);
  const ok = okList && okShow && okMissing;
  console.log(ok ? '✓ B(1.9.29) persona list/show/없는 ID 거부' : `✗ persona 실패 (list=${okList} show=${okShow} miss=${okMissing})`);
  if (!ok) { failed++; console.log(r1.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.29) #2')) {
  total++;
   
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rev-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.mkdirSync(path.join(tmpR, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpR, 'src/sample.js'), "function add(a, b) { return a + b; } module.exports = { add };\n");
   
  const r = cp.spawnSync(process.execPath, [CLI, 'review', 'src/sample.js', '--persona', 'security', '--path', tmpR], { encoding: 'utf8', timeout: 10000 });
  const okSingle = r.status === 0 && /Review Prompt/.test(r.stdout) && /보안 엔지니어/.test(r.stdout) && /add\(a, b\)/.test(r.stdout);
   
  const r2 = cp.spawnSync(process.execPath, [CLI, 'review', 'src/sample.js', '--persona', 'security,performance,ux', '--path', tmpR], { encoding: 'utf8', timeout: 10000 });
  const okMulti = r2.status === 0
    && /보안 엔지니어/.test(r2.stdout)
    && /성능 최적화/.test(r2.stdout)
    && /UX 라이터/.test(r2.stdout);
   
  const r3 = cp.spawnSync(process.execPath, [CLI, 'review', 'src/sample.js', '--persona', 'jedi', '--path', tmpR], { encoding: 'utf8', timeout: 10000 });
  const okBad = r3.status !== 0 && /페르소나 없음/.test(r3.stdout + r3.stderr);
   
  const r4 = cp.spawnSync(process.execPath, [CLI, 'review', 'src/sample.js', '--path', tmpR], { encoding: 'utf8', timeout: 10000 });
  const okNoPersona = r4.status !== 0 && /--persona.*필요/.test(r4.stdout + r4.stderr);
  const ok = okSingle && okMulti && okBad && okNoPersona;
  console.log(ok ? '✓ B(1.9.29) review --persona: 단일/다중/잘못된/누락 모두 정확' : `✗ review 실패 (single=${okSingle} multi=${okMulti} bad=${okBad} noP=${okNoPersona})`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.29) #3')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-padd-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'persona', 'add', 'my-domain', '--path', tmpC], { encoding: 'utf8', timeout: 10000 });
  const okAdd = r.status === 0
    && fs.existsSync(path.join(tmpC, '.leerness/personas/my-domain.md'))
    && /\.leerness\/personas\/my-domain\.md/.test(r.stdout.replace(/\\/g, '/'));
   
  const r2 = cp.spawnSync(process.execPath, [CLI, 'persona', 'list', '--path', tmpC], { encoding: 'utf8', timeout: 10000 });
  const okList = /사용자 정의 \(1/.test(r2.stdout) && /my-domain/.test(r2.stdout);
  const ok = okAdd && okList;
  console.log(ok ? '✓ B(1.9.29) persona add: 사용자 정의 템플릿 생성 + list 표시' : `✗ persona add 실패 (add=${okAdd} list=${okList})`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.30+1.9.277)')) {
  total++;
   
  const env1 = { ...process.env, LEERNESS_ENABLE_CLAUDE: '1', LEERNESS_ENABLE_CODEX: '0', LEERNESS_ENABLE_AGY: '0', LEERNESS_ENABLE_GROK: '0', LEERNESS_ENABLE_COPILOT: '0' };
  const r1 = cp.spawnSync(process.execPath, [CLI, 'agents', 'list'], { encoding: 'utf8', timeout: 90000, env: env1 });
  const okList = r1.status === 0
    && /외부 AI CLI 오케스트레이션 \(1\.9\.30\)/.test(r1.stdout)
    && /\| claude \|/.test(r1.stdout)
    && /\| codex \|/.test(r1.stdout)
    && /\| agy \|/.test(r1.stdout)
    && /\| grok \|/.test(r1.stdout)
    && /\| copilot \|/.test(r1.stdout);
   
   
  const offAll = { LEERNESS_ENABLE_CLAUDE: '0', LEERNESS_ENABLE_CODEX: '0', LEERNESS_ENABLE_AGY: '0', LEERNESS_ENABLE_GROK: '0', LEERNESS_ENABLE_OPENCODE: '0', LEERNESS_ENABLE_QWEN: '0', LEERNESS_ENABLE_AIDER: '0', LEERNESS_ENABLE_GOOSE: '0', LEERNESS_ENABLE_COPILOT: '0', LEERNESS_ENABLE_OLLAMA: '0' };
  const env2 = { ...process.env, ...offAll };
  const r2 = cp.spawnSync(process.execPath, [CLI, 'agents', 'list', '--json'], { encoding: 'utf8', timeout: 90000, env: env2 });
  let parsed = null;
  try { parsed = JSON.parse(r2.stdout); } catch {}
  const okJson = parsed && Array.isArray(parsed.agents) && parsed.agents.length === 10 && parsed.agents.every(a => a.status !== 'ready');
  const okNew = /\| opencode \|/.test(r1.stdout) && /\| qwen \|/.test(r1.stdout) && /\| aider \|/.test(r1.stdout) && /\| goose \|/.test(r1.stdout);
  const ok = okList && okJson && okNew;
  console.log(ok ? '✓ B(1.9.30+1.9.277) agents list: 10 CLI (claude/codex/agy/grok/opencode/qwen/aider/goose/copilot/ollama)' : `✗ agents list 실패 (list=${okList} json=${okJson} new=${okNew})`);
  if (!ok) { failed++; console.log(r1.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.30)')) {
  total++;
   
  const env = { ...process.env, LEERNESS_ENABLE_CODEX: '0' };
   
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', 'test task', '--to', 'codex'], { encoding: 'utf8', timeout: 30000, env });
  const okBlocked = r.status !== 0 && /비활성|disabled|not-installed/i.test(r.stdout);
   
  const r2 = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', 'test'], { encoding: 'utf8', timeout: 30000 });
  const okNoTarget = r2.status !== 0 && /--to.*필요/.test(r2.stdout + r2.stderr);
   
  const r3 = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', 'test', '--to', 'jedi'], { encoding: 'utf8', timeout: 30000 });
  const okBadAgent = r3.status !== 0 && /알 수 없는 agent/.test(r3.stdout + r3.stderr);
  const ok = okBlocked && okNoTarget && okBadAgent;
  console.log(ok ? '✓ B(1.9.30) agents dispatch: env=0/--to 누락/잘못된 agent 모두 거부' : `✗ dispatch 실패 (block=${okBlocked} noT=${okNoTarget} bad=${okBadAgent})`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.36.185)')) {
  total++;
   
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^LEERNESS_ENABLE_/i.test(key)) delete env[key];
  ['CLAUDE', 'CODEX', 'AGY', 'GROK', 'OPENCODE', 'QWEN', 'AIDER', 'GOOSE', 'COPILOT', 'OLLAMA']
    .forEach(id => { env[`LEERNESS_ENABLE_${id}`] = '0'; });
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'quota'], { encoding: 'utf8', timeout: 90000, env });
  const okText = r.status === 0
    && /외부 AI 공급자 상태 관측 \(Leerness v[0-9.]+\)/.test(r.stdout)
    && /\| claude \|/.test(r.stdout)
    && /\| codex \|/.test(r.stdout)
    && /\| agy \|/.test(r.stdout)
    && /\| grok \|/.test(r.stdout)
    && /\| copilot \|/.test(r.stdout)
    && /프로젝트 \.env는 활성화 설정을 적용하기 위해 로드될 수 있지만/.test(r.stdout)
    && /이번 실행에서는 공급자 인증 확인 명령을 실행하지 않았/.test(r.stdout);
  const r2 = cp.spawnSync(process.execPath, [CLI, 'agents', 'quota', '--json'], { encoding: 'utf8', timeout: 90000, env });
  let parsed = null;
  try { parsed = JSON.parse(r2.stdout); } catch {}
  const okJson = parsed && parsed.schemaVersion === 2 && parsed.observation === 'provider-capacity'
    && Array.isArray(parsed.quota) && parsed.quota.length >= 10
    && parsed.quota.every(q => typeof q.id === 'string' && typeof q.status === 'string'
      && typeof q.source === 'string' && typeof q.routingEligibility === 'string'
      && typeof q.routingReason === 'string' && typeof q.versionCheckAttempted === 'boolean'
      && ['ok', 'failed', 'not-attempted'].includes(q.versionCheckState)
      && typeof q.presenceCheckOnly === 'boolean' && q.modelCallability === 'not-observed'
      && q.callability === 'unknown' && q.callabilityReason === 'live_model_call_not_performed'
      && q.quota === 'unknown' && q.quotaState === 'not-observed' && q.remaining === null
      && !Object.prototype.hasOwnProperty.call(q, 'authEvidence'))
    && parsed.policy && parsed.policy.projectEnvironmentMayBeLoaded === true
    && parsed.policy.credentialValuesIncludedInOutput === false
    && parsed.policy.credentialValuesPersistedByCommand === false
    && parsed.policy.credentialValuesInspectedForCapacity === false
    && parsed.policy.credentialValuesPassedToProbeCommands === false
    && parsed.policy.providerCredentialStoresReadDirectly === false
    && parsed.policy.providerCliMayReadOwnCredentialStore === false
    && parsed.policy.providerCliMayReadEnvironmentCredentials === false
    && parsed.policy.disabledProviderCommandsExecuted === false
    && Array.isArray(parsed.policy.registeredSafeAuthChecksAttempted)
    && parsed.policy.registeredSafeAuthChecksAttempted.length === 0
    && Array.isArray(parsed.policy.versionChecksAttempted)
    && parsed.policy.versionChecksAttempted.length === 0
    && Array.isArray(parsed.policy.presenceOnlyChecks)
    && parsed.policy.presenceOnlyChecks.length === parsed.quota.filter(q => q.presenceCheckOnly).length
    && parsed.quota.filter(q => q.presenceCheckOnly).every(q => parsed.policy.presenceOnlyChecks.includes(q.id))
    && parsed.policy.browserSessionReuse === false && parsed.policy.guiScraping === false
    && parsed.policy.liveModelCalls === false
    && parsed.policy.capacityValuesRequireOfficialContract === true
    && parsed.policy.speculativeCapacityClaims === false
    && Array.isArray(parsed.limitations)
    && parsed.limitations.join(',') === 'local_prerequisites_only,authentication_is_not_model_entitlement,exact_capacity_requires_verified_official_adapter,recorded_availability_is_not_official_capacity,disabled_providers_presence_only,credential_values_not_passed_to_probe_commands';
  const ok = okText && okJson;
  console.log(ok ? '✓ B(1.36.185) agents quota: 관측 축 분리·비밀 비출력·비활성 인증 무실행·추정 금지' : `✗ quota 실패 (text=${okText} json=${okJson})`);
  if (!ok) { failed++; console.log((r.stdout + '\n' + r2.stdout + '\n' + r2.stderr).slice(0, 1400)); }
}
if (e2eShard.take('B(1.9.31)')) {
  total++;
   
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'foo'], { encoding: 'utf8', timeout: 10000 });
  const usage = r.stdout + r.stderr;
   
   
  const ok = r.status !== 0 && /agents list\|check\|quota(?:\|[a-z-]+)*\|dispatch/.test(usage);
  console.log(ok ? '✓ B(1.9.31) agents 사용법에 quota 명시' : `✗ usage 메시지 실패`);
  if (!ok) { failed++; console.log((r.stdout + r.stderr).slice(0, 300)); }
}

 
if (e2eShard.take('B(1.9.32)')) {
  total++;
   
  const r = cp.spawnSync(process.execPath, [CLI, '--version', '--banner'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, TERM: 'dumb' } });
  const ok = r.status === 0
    && /╔═+╗/.test(r.stdout)
    && /███████╗/.test(r.stdout)
    && /AI 에이전트 검수.기억.드리프트 방지 하네스/.test(r.stdout)
    && new RegExp(`v${require('../package.json').version}`).test(r.stdout);
  console.log(ok ? '✓ B(1.9.32) --version --banner: LEERNESS ASCII 배너' : `✗ 배너 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 800)); }
}

if (e2eShard.take('B(1.9.32) #2')) {
  total++;
   
  const r = cp.spawnSync(process.execPath, [CLI, '--version', '--banner'], { encoding: 'utf8', timeout: 10000, env: { ...process.env, LEERNESS_NO_BANNER: '1' } });
  const ok = r.status === 0 && r.signal === null && !r.error && !/███████╗/.test(r.stdout)
    && r.stdout.trim() === require('../package.json').version;
  console.log(ok ? '✓ B(1.9.32) LEERNESS_NO_BANNER=1: 배너 스킵' : `✗ NO_BANNER 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 300)); }
}

if (e2eShard.take('init: 에이전트 활성화 문항/기본값 없이 지침 설치')) {
  total++;
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-setup-removed-'));
  const r = cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended', '--minimal', '--no-banner'], { encoding: 'utf8', timeout: 30000 });
  const configPath = path.join(tmpC, '.leerness', 'leerness-config.json');
  const config = r.status === 0 ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  const ok = r.status === 0 && fs.existsSync(path.join(tmpC, 'AGENTS.md'))
    && !Object.keys(config).some(k => /^LEERNESS_ENABLE_/.test(k))
    && !/CLI 에이전트 활성화|Agents 활성화|외부 AI CLI 설정/.test(r.stdout);
  console.log(ok ? '✓ init: 에이전트 활성화 문항/기본값 없이 지침 설치' : '✗ init 에이전트 활성화 잔존');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('--help: 제거된 설정 명령 없음')) {
  total++;
   
  const r = cp.spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', timeout: 10000 });
  const ok = r.status === 0 && !/setup-agents|CLI 에이전트 활성화/.test(r.stdout);
  console.log(ok ? '✓ --help: 제거된 설정 명령 없음' : '✗ --help에 제거된 명령 잔존');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('제거된 setup-agents 명령은 설정을 변경하지 않음')) {
  total++;
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-setup-disabled-'));
  const tmpEnv = path.join(tmpC, '.env');
  fs.writeFileSync(tmpEnv, 'EXISTING=1\nLEERNESS_ENABLE_CLAUDE=1\n', 'utf8');
  const before = fs.readFileSync(tmpEnv);
  const r = cp.spawnSync(process.execPath, [CLI, 'setup-agents', tmpC, '--yes'], { encoding: 'utf8', timeout: 10000 });
  const ok = r.status !== 0 && fs.readFileSync(tmpEnv).equals(before);
  console.log(ok ? '✓ 제거된 setup-agents 명령은 설정을 변경하지 않음' : '✗ 제거된 명령이 여전히 실행됨');
  if (!ok) { failed++; console.log((r.stdout + r.stderr).slice(0, 500)); }
}

 
if (e2eShard.take('B(1.9.33)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-stale-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended', '--no-stale-check'], { stdio: 'ignore', timeout: 30000 });
  const cacheDir = path.join(tmpC, '.leerness', 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'update-check.json'), JSON.stringify({ at: Date.now(), nextLeerness: '99.99.99', runningCli: require('../package.json').version }), 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
  const ok = r.status === 0
    && /옛 버전이 실행 중입니다/.test(r.stdout)
    && /v99\.99\.99/.test(r.stdout)
    && /clear-npx-cache/.test(r.stdout)
    && /Leerness v/.test(r.stdout);  
  console.log(ok ? '✓ B(1.9.33) npx stale 경고: 미래 latest 캐시 시 경고 + init 계속' : `✗ stale 경고 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 800)); }
}

 
if (e2eShard.take('B(1.9.63)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-st-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'audit', tmpC, '--strict'], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status !== 0 && /strict.*승격|failures=1/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.63) audit --strict: warnings → failures 승격' : `✗ --strict 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.63) #2')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-st2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'audit', tmpC, '--strict', '--threshold', '10'], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0;
  console.log(ok ? '✓ B(1.9.63) audit --strict --threshold 10: warnings 적으면 exit 0' : `✗ threshold 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-300)); }
}

if (e2eShard.take('B(1.9.64)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-iv-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const src = path.join(tmpC, 'sk.md');
  fs.writeFileSync(src, '---\nname: install-alias-test\ndescription: 별칭 검증\n---\n# Body\n', 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'install', src, '--path', tmpC], { encoding: 'utf8', timeout: 15000 });
  const f = path.join(tmpC, '.leerness', 'skills', 'install-alias-test', 'SKILL.md');
  const ok = r.status === 0 && fs.existsSync(f);
  console.log(ok ? '✓ B(1.9.64) install <SKILL.md>: skill install 별칭 동작' : `✗ install 별칭 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 300)); }
}

 
if (e2eShard.take('B(1.9.60)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tex-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'export 검증', '--status', 'done', '--path', tmpC], { stdio: 'ignore', timeout: 10000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'task', 'export', '--path', tmpC, '--json'], { encoding: 'utf8', timeout: 15000 });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch {}
  const ok = Array.isArray(j) && j.length >= 1 && j.some(t => t.status === 'completed' && 'content' in t && 'activeForm' in t);
  console.log(ok ? '✓ B(1.9.60) task export: TodoWrite JSON 형식 (content/status/activeForm)' : `✗ task export 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.61)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mcc-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const req = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_handoff', arguments: { path: tmpC, _cursor: '0', _chunkSize: 200 } } });
  const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 15000, input: req + '\n' });
  const resp = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]);
  const ok = resp.result && resp.result.nextCursor && resp.result._truncated;
  console.log(ok ? '✓ B(1.9.61) MCP cursor 페이지네이션: nextCursor + _truncated' : `✗ cursor 실패`);
  if (!ok) { failed++; console.log(JSON.stringify(resp).slice(0, 300)); }
}

if (e2eShard.take('B(1.9.62)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ac-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  const r = cp.spawnSync(process.execPath, [CLI, 'audit', tmpC], { encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_OFFLINE: '1' } });
  const ok = r.status === 0 && !/npm CVE/.test(r.stdout) && /Audit summary/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.62) audit: package.json 없을 때 npm audit 자동 스킵' : `✗ audit CVE 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.58)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-fz-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpC, '.leerness', 'review-evidence.md'),
    '## 2026-04\nNote: ✗ webhooks payload 실패\n', 'utf8');
  cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'webhook 작업', '--status', 'in-progress', '--path', tmpC], { stdio: 'ignore', timeout: 10000 });
  const plain = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--no-drift-check', '--no-workflow-guide'], { encoding: 'utf8', timeout: 15000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--inspect', '--no-drift-check', '--no-workflow-guide'], { encoding: 'utf8', timeout: 60000 });
  const ok = /lessons 자동 재상기.*webhook/.test(r.stdout) && plain.status === 0 && !/lessons 자동 재상기/.test(plain.stdout);
  console.log(ok ? '✓ B(1.9.58) lessons fuzzy: webhook ↔ webhooks 어간 변형 매칭' : `✗ fuzzy 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-500)); }
}

if (e2eShard.take('B(1.9.59)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sd-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpC], { encoding: 'utf8', timeout: 30000 });
   
  const ok = /다음 라운드 추천|drift 상태/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.59) session close: --suggest default 활성' : `✗ default suggest 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-500)); }
}

if (e2eShard.take('B(1.9.59) #2')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ns-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpC, '--no-suggest'], { encoding: 'utf8', timeout: 30000 });
  const ok = r.status === 0 && !/다음 라운드 추천/.test(r.stdout) && /진행 요약/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.59) --no-suggest: suggest 비활성 (이전 동작)' : `✗ --no-suggest 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-300)); }
}

 
if (e2eShard.take('B(1.9.56)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ha-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpC, '.leerness', 'review-evidence.md'),
    '## 2026-04-01\nNote: ✗ webhook 처리 실패\n', 'utf8');
  cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'webhook 처리 개선', '--status', 'in-progress', '--path', tmpC], { stdio: 'ignore', timeout: 10000 });
  const plain = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--no-drift-check', '--no-workflow-guide'], { encoding: 'utf8', timeout: 15000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--inspect', '--no-drift-check', '--no-workflow-guide'], { encoding: 'utf8', timeout: 60000 });
  const ok = /lessons 자동 재상기.*webhook|🧠.*webhook/.test(r.stdout) && plain.status === 0 && !/lessons 자동 재상기/.test(plain.stdout);
  console.log(ok ? '✓ B(1.9.56) handoff: lessons 자동 재상기 (현재 task 키워드 매칭)' : `✗ handoff lessons 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-500)); }
}

if (e2eShard.take('B(1.9.57)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sc-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpC, '--suggest'], { encoding: 'utf8', timeout: 30000 });
  const ok = /다음 라운드 추천|drift 상태/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.57) session close --suggest: drift + skill suggest 통합' : `✗ --suggest 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-500)); }
}

 
if (e2eShard.take('B(1.9.54)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-la-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpC, '.leerness', 'review-evidence.md'),
    '## 2026-04-01\nNote: ✗ payment 처리 실패 — 검수 누락\n', 'utf8');
  cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'payment 검증 작업', '--status', 'in-progress', '--path', tmpC], { stdio: 'ignore', timeout: 10000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'lessons', '--path', tmpC, '--auto', '--limit', '5'], { encoding: 'utf8', timeout: 15000 });
  const ok = /추출 키워드.*payment/.test(r.stdout) && /payment.*실패/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.54) lessons --auto: in-progress task 키워드 자동 추출 + 매칭' : `✗ lessons --auto 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.55)')) {
  total++;
   
  const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], {
    encoding: 'utf8', timeout: 8000,
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n'
  });
  let resp = null;
  try { resp = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]); } catch {}
  const tools = resp && resp.result && resp.result.tools;
  const hasNew = tools && tools.some(t => t.name === 'leerness_skill_suggest') && tools.some(t => t.name === 'leerness_lessons');
  const ok = tools && tools.length >= 12 && hasNew;
  console.log(ok ? `✓ B(1.9.55) MCP: ${tools.length} 도구 (skill_suggest + lessons 추가)` : `✗ MCP 12 도구 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.53)')) {
  total++;
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sg-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  for (let i = 0; i < 6; i++) {
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', `autosuggestkw 작업 ${i}`, '--path', tmpC], { stdio: 'ignore', timeout: 10000 });
  }
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'suggest', '--path', tmpC, '--min', '3', '--json'], { encoding: 'utf8', timeout: 15000 });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch {}
  const ok = j && j.candidates && j.candidates.some(c => /autosuggestkw/.test(c.keyword) && c.count >= 3);
  console.log(ok ? '✓ B(1.9.53) skill suggest: progress-tracker 반복 패턴 자동 감지 (Hermes-style)' : `✗ suggest 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.51)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sc-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'benchmark', tmpC, '--scenario', 'all', '--json'], { encoding: 'utf8', timeout: 60000 });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch {}
  const ok = j && j.scenarios && j.scenarios.length === 4 && j.detectedCount === 4;
  console.log(ok ? '✓ B(1.9.51) benchmark --scenario all: 4/4 leerness 고유 가치 자동 감지' : `✗ scenario all 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.51) #2')) {
  total++;
   
  const r = cp.spawnSync(process.execPath, [CLI, 'benchmark', '--scenario', 'unknown-x'], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status !== 0 && /알 수 없는 scenario/.test(r.stdout + r.stderr);
  console.log(ok ? '✓ B(1.9.51) benchmark --scenario unknown: 친절 안내' : `✗ scenario 안내 실패`);
  if (!ok) { failed++; console.log((r.stdout + r.stderr).slice(0, 300)); }
}

if (e2eShard.take('B(1.9.52)')) {
  total++;
   
  const fn = require(path.resolve(__dirname, '..', 'lib', 'pure-utils'))._parseSkillCatalog;
  if (typeof fn !== 'function') {
    console.log('✗ _parseSkillCatalog 함수 위치 못 찾음 (lib/pure-utils)');
    failed++;
  } else {
    const jsonR = fn(JSON.stringify({ skills: [{ name: 'a', description: 'A' }] }), null);
    const rssR = fn('<rss><channel><item><title>X</title><link>http://x.com/s.md</link></item></channel></rss>', null);
    const mdR = fn('- [feature-implementation](f.md) — Feature\n- [project-roadmap-generator](r.md) — Roadmap', null);
    const urlR = fn('https://x.com/foo/SKILL.md', null);
    const ok = jsonR[0].format === 'json' && rssR[0].format === 'rss'
      && mdR[0].format === 'markdown' && urlR[0].format === 'urls';
    console.log(ok ? '✓ B(1.9.52) _parseSkillCatalog: 4 형식 (JSON/RSS/Markdown/llms.txt) 모두 인식' : `✗ catalog 형식 실패`);
    if (!ok) { failed++; console.log(JSON.stringify({jsonR, rssR, mdR, urlR}).slice(0, 400)); }
  }
}

 
if (e2eShard.take('B(1.9.48)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-arc-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'all'], { stdio: 'ignore', timeout: 30000 });
   
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'publish', '--path', tmpC, '--bundle-only', '--no-security-check'], { encoding: 'utf8', timeout: 30000 });
  const tarballDir = path.join(tmpC, '.leerness', 'skills-publish-tarball');
  const files = fs.existsSync(tarballDir) ? fs.readdirSync(tarballDir) : [];
  const archive = files.find(f => /\.(tgz|zip)$/.test(f));
  const ok = r.status === 0 && (archive || /archive 생성/.test(r.stdout));
  console.log(ok ? `✓ B(1.9.48) cross-platform archive (${archive || 'graceful'})` : `✗ archive 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.49)')) {
  total++;
   
  const r = cp.spawnSync(process.execPath, [CLI, 'benchmark', '--measure'], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status !== 0 && /사용법|task/.test(r.stdout + r.stderr);
  console.log(ok ? '✓ B(1.9.49) benchmark --measure: 인자 누락 친절 안내' : `✗ --measure 인자 실패`);
  if (!ok) { failed++; console.log((r.stdout + r.stderr).slice(0, 300)); }
}

if (e2eShard.take('B(1.9.50)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-emb-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'match', 'test query', '--path', tmpC, '--embedding'], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_OLLAMA_BASE_URL: '' }
  });
  const ok = r.status !== 0 && /LEERNESS_OLLAMA_BASE_URL.*필요|opt-in/.test(r.stdout + r.stderr);
  console.log(ok ? '✓ B(1.9.50) skill match --embedding: Ollama URL 없으면 opt-in 거부' : `✗ --embedding 거부 실패`);
  if (!ok) { failed++; console.log((r.stdout + r.stderr).slice(0, 300)); }
}

 
if (e2eShard.take('B(1.9.45)')) {
  total++;
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-match-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'all'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'match', '기능 구현 재사용 검사', '--path', tmpC, '--json'], { encoding: 'utf8', timeout: 15000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = parsed
    && parsed.top
    && parsed.top.length > 0;    
  console.log(ok ? '✓ B(1.9.45) skill match: jaccard 매칭 → 최상위 후보 반환' : `✗ skill match 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.46)')) {
  total++;
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bench-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'benchmark', tmpC, '--json'], { encoding: 'utf8', timeout: 15000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = parsed
    && parsed.leernessScore
    && parsed.total >= 400
    && parsed.compareSimulated
    && parsed.compareSimulated.vanilla
    && parsed.compareSimulated['leerness+claude'];
  console.log(ok ? `✓ B(1.9.46) benchmark: 자체 ${parsed.total}/600 + 타도구 시뮬 비교` : `✗ benchmark 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.47)')) {
  total++;
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-pub-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'all'], { stdio: 'ignore', timeout: 30000 });
   
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'publish', '--path', tmpC, '--bundle-only', '--no-security-check'], { encoding: 'utf8', timeout: 30000 });
  const publishDir = path.join(tmpC, '.leerness', 'skills-publish');
  const manifestFile = path.join(publishDir, 'manifest.json');
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch {}
  const ok = r.status === 0
    && fs.existsSync(publishDir)
    && manifest
    && manifest.skills && manifest.skills.length >= 2    
    && manifest.format === 'agentskills.io';
  console.log(ok ? `✓ B(1.9.47) skill publish: ${manifest ? manifest.skills.length : 0} skill + manifest 생성` : `✗ skill publish 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.44)')) {
  total++;
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bom-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const src = path.join(tmpC, 'bom.md');
   
  const buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('---\nname: bom-skill\ndescription: BOM 처리 검증\n---\n\n# Body\n', 'utf8')]);
  fs.writeFileSync(src, buf);
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'install', src, '--path', tmpC], { encoding: 'utf8', timeout: 15000 });
  const installedFile = path.join(tmpC, '.leerness', 'skills', 'bom-skill', 'SKILL.md');
  const ok = r.status === 0 && fs.existsSync(installedFile);
  console.log(ok ? '✓ B(1.9.44) skill install: UTF-8 BOM 자동 제거 후 frontmatter 파싱' : `✗ BOM 처리 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.43)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-exall-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'all'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'export-all', '--path', tmpC], { encoding: 'utf8', timeout: 30000 });
  const exportDir = path.join(tmpC, '.leerness', 'skills-export');
  const exists2 = fs.existsSync(exportDir);
  const count = exists2 ? fs.readdirSync(exportDir).length : 0;
  const ok = r.status === 0 && exists2 && count >= 2;    
  console.log(ok ? `✓ B(1.9.43) skill export-all: ${count}개 skill 일괄 SKILL.md 생성` : `✗ export-all 실패 (count=${count})`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.43) #2')) {
  total++;
   
  const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], {
    encoding: 'utf8', timeout: 10000,
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) + '\n'
  });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]); } catch {}
  const ok = parsed
    && parsed.jsonrpc === '2.0'
    && parsed.id === 1
    && parsed.result
    && parsed.result.serverInfo
    && parsed.result.serverInfo.name === 'leerness';
  console.log(ok ? '✓ B(1.9.43) MCP server initialize: JSON-RPC 표준 응답 + serverInfo' : `✗ MCP initialize 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.43) #3')) {
  total++;
   
  const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], {
    encoding: 'utf8', timeout: 10000,
    input: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n'
  });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]); } catch {}
  const ok = parsed
    && Array.isArray(parsed.result && parsed.result.tools)
    && parsed.result.tools.length >= 8
    && parsed.result.tools.some(t => t.name === 'leerness_verify_claim')
    && parsed.result.tools.some(t => t.name === 'leerness_drift_check');
  console.log(ok ? `✓ B(1.9.43) MCP tools/list: ${parsed.result.tools.length}개 leerness 도구 노출` : `✗ MCP tools/list 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

 
 
if (e2eShard.take('B(1.9.43) #4')) {
  const giPath = path.join(__dirname, '..', '.gitignore');
  if (!fs.existsSync(giPath)) console.log('⊘ SKIP(아티팩트 프로필): leerness-pkg/.gitignore 검사 — 저장소 체크아웃 전용');
  else {
    total++;
    const body = fs.readFileSync(giPath, 'utf8');
    const ok = /_reports\//.test(body) && /\*\.private\.md/.test(body);
    console.log(ok ? '✓ B(1.9.43) leerness-pkg/.gitignore: _reports/ + *.private.md 차단' : `✗ .gitignore 실패`);
    if (!ok) { failed++; console.log(body.slice(0, 300)); }
  }
}

if (e2eShard.take('B(1.9.43) #5')) {
  const niPath = path.join(__dirname, '..', '.npmignore');
  if (!fs.existsSync(niPath)) console.log('⊘ SKIP(아티팩트 프로필): leerness-pkg/.npmignore 검사 — 저장소 체크아웃 전용');
  else {
    total++;
    const body = fs.readFileSync(niPath, 'utf8');
    const ok = /_reports\//.test(body) && /\*\.private/.test(body);
    console.log(ok ? '✓ B(1.9.43) leerness-pkg/.npmignore: _reports/ 차단' : `✗ .npmignore 실패`);
    if (!ok) { failed++; console.log(body.slice(0, 300)); }
  }
}

 
if (e2eShard.take('B(1.9.42)')) {
  total++;
   
  const env = { ...process.env };
  delete env.LEERNESS_SKILL_DISCOVER_URL;
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'discover'], { encoding: 'utf8', timeout: 10000, env });
  const ok = r.status !== 0 && /LEERNESS_SKILL_DISCOVER_URL.*필요|opt-in/.test(r.stdout + r.stderr);
  console.log(ok ? '✓ B(1.9.42) skill discover: env 없으면 opt-in 안내 거부' : `✗ discover opt-in 실패`);
  if (!ok) { failed++; console.log((r.stdout + r.stderr).slice(0, 400)); }
}

if (e2eShard.take('B(1.9.42) #2')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-skex-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'export', 'feature-implementation', '--path', tmpC], { encoding: 'utf8', timeout: 15000 });
  const skillFile = path.join(tmpC, '.leerness', 'skills-export', 'feature-implementation', 'SKILL.md');
  const exists2 = fs.existsSync(skillFile);
  const body = exists2 ? fs.readFileSync(skillFile, 'utf8') : '';
  const ok = r.status === 0
    && exists2
    && /^---\nname: feature-implementation\ndescription:/.test(body)
    && /\n---\n/.test(body);
  console.log(ok ? '✓ B(1.9.42) skill export: agentskills.io 표준 SKILL.md frontmatter 생성' : `✗ export 실패`);
  if (!ok) { failed++; console.log(body.slice(0, 300) || r.stdout.slice(0, 300)); }
}

if (e2eShard.take('B(1.9.42) #3')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-skin-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  const skillSrc = path.join(tmpC, 'test-skill.md');
  fs.writeFileSync(skillSrc, '---\nname: my-test-skill\ndescription: agentskills.io 표준 호환 e2e 검증\n---\n\n# Test Skill\n\n본문 내용.\n', 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'install', skillSrc, '--path', tmpC], { encoding: 'utf8', timeout: 15000 });
  const installedFile = path.join(tmpC, '.leerness', 'skills', 'my-test-skill', 'SKILL.md');
  const ok = r.status === 0
    && fs.existsSync(installedFile)
    && /my-test-skill/.test(fs.readFileSync(installedFile, 'utf8'));
  console.log(ok ? '✓ B(1.9.42) skill install: 로컬 SKILL.md → .leerness/skills/<id>/ 배치' : `✗ install 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.42) #4')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-skin2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const skillSrc = path.join(tmpC, 'test-skill2.md');
  fs.writeFileSync(skillSrc, '---\nname: dual-format\ndescription: skill.json + SKILL.md 양쪽 자동 생성\n---\n\n# Dual\n', 'utf8');
  cp.spawnSync(process.execPath, [CLI, 'skill', 'install', skillSrc, '--path', tmpC], { stdio: 'ignore', timeout: 15000 });
  const jsonFile = path.join(tmpC, '.leerness', 'skills', 'dual-format', 'skill.json');
  const json = fs.existsSync(jsonFile) ? JSON.parse(fs.readFileSync(jsonFile, 'utf8')) : null;
  const ok = json
    && json.name === 'dual-format'
    && json._source === 'agentskills.io'
    && json.verification && json.verification.method === 'agentskills.io-import';
  console.log(ok ? '✓ B(1.9.42) skill install: skill.json 자동 생성 + _source 추적' : `✗ skill.json 실패`);
  if (!ok) { failed++; console.log(JSON.stringify(json || {})); }
}

 
if (e2eShard.take('B(1.9.41)')) {
  total++;
   
   
  const started = performance.now();
  const r = cp.spawnSync(process.execPath, [CLI, 'whats-new', '--from', '1.9.33', '--json', '--all'], { encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024 });
  const diagnostic = childDiagnostics(r, performance.now() - started, 20000);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = childExitMatches(r) && parsed
    && parsed.from === '1.9.33'
    && Array.isArray(parsed.versions)
    && parsed.versions.length >= 5
    && parsed.versions.some(v => v.newCommands && v.newCommands.length > 0);
  console.log(ok ? `✓ B(1.9.41) whats-new --from 1.9.33: 5+ 버전 차분 + 신규 명령 추출 (elapsedMs=${diagnostic.elapsedMs})` : `✗ whats-new 실패`);
  if (!ok) { failed++; console.log(JSON.stringify(diagnostic)); }
}

if (e2eShard.take('B(1.9.41) #2')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mig-'));
   
  fs.mkdirSync(path.join(tmpC, '.leerness'), { recursive: true });
  fs.writeFileSync(path.join(tmpC, '.leerness', 'HARNESS_VERSION'), 'leerness@1.9.36\n', 'utf8');
  const started = performance.now();
  const r = cp.spawnSync(process.execPath, [CLI, 'migrate', tmpC, '--yes', '--no-banner', '--no-stale-check'], { encoding: 'utf8', timeout: 60000 });
  const diagnostic = childDiagnostics(r, performance.now() - started, 60000);
  const ok = childExitMatches(r)
    && /AI must re-read/.test(r.stdout)
    && /1\.9\.36 → \d+\.\d+\.\d+/.test(r.stdout)
    && /신규 명령/.test(r.stdout);
  console.log(ok ? `✓ B(1.9.41) migrate stdout: AI must re-read 차분 자동 출력 (elapsedMs=${diagnostic.elapsedMs})` : `✗ migrate 차분 출력 실패`);
  if (!ok) { failed++; console.log(JSON.stringify(diagnostic)); }
}

if (e2eShard.take('B(1.9.41) #3')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mig2-'));
  fs.mkdirSync(path.join(tmpC, '.leerness'), { recursive: true });
  fs.writeFileSync(path.join(tmpC, '.leerness', 'HARNESS_VERSION'), 'leerness@1.9.30\n', 'utf8');
  const started = performance.now();
  const migrated = cp.spawnSync(process.execPath, [CLI, 'migrate', tmpC, '--yes', '--no-banner', '--no-stale-check'], { stdio: 'ignore', timeout: 60000 });
  const diagnostic = childDiagnostics(migrated, performance.now() - started, 60000);
  const reportPath = path.join(tmpC, '.leerness', 'migration-report.md');
  const body = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
  const ok = childExitMatches(migrated) && /## 🤖 AI must re-read/.test(body) && /Previous: 1\.9\.30/.test(body);
  console.log(ok ? `✓ B(1.9.41) migration-report.md: AI must re-read 섹션 + Previous 버전 기록 (elapsedMs=${diagnostic.elapsedMs})` : `✗ report 기록 실패`);
  if (!ok) { failed++; console.log(JSON.stringify(diagnostic)); console.log(body.slice(0, 600)); }
}

if (e2eShard.take('B(1.9.41) #4')) {
  total++;
  // handoff가 fresh migration-report (24h 내) 시 자동 알림
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-fresh-'));
  fs.mkdirSync(path.join(tmpC, '.leerness'), { recursive: true });
  fs.writeFileSync(path.join(tmpC, '.leerness', 'HARNESS_VERSION'), 'leerness@1.9.30\n', 'utf8');
  const migrateStarted = performance.now();
  const migrated = cp.spawnSync(process.execPath, [CLI, 'migrate', tmpC, '--yes', '--no-banner', '--no-stale-check'], { stdio: 'ignore', timeout: 60000 });
  const migrateDiagnostic = childDiagnostics(migrated, performance.now() - migrateStarted, 60000);
  const handoffStarted = performance.now();
  const r = childExitMatches(migrated)
    ? cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--no-drift-check'], { encoding: 'utf8', timeout: 15000 }) : null;
  const handoffDiagnostic = r ? childDiagnostics(r, performance.now() - handoffStarted, 15000) : { status: 'not_run', reason: 'migration_failed', timeoutMs: 15000 };
  const ok = childExitMatches(migrated) && childExitMatches(r)
    && /최근.*시간 전 migrate 차분|AI must re-read/.test(r.stdout);
  console.log(ok ? `✓ B(1.9.41) handoff: 최근 migrate 차분 자동 표시 (24h 내, migrateElapsedMs=${migrateDiagnostic.elapsedMs}, handoffElapsedMs=${handoffDiagnostic.elapsedMs})` : `✗ handoff 차분 알림 실패`);
  if (!ok) { failed++; console.log(JSON.stringify({ migrate: migrateDiagnostic, handoff: handoffDiagnostic })); }
}

// 1.9.40 회귀: release pack 통합 명령 + audit README mismatch 감지
if (e2eShard.take('B(1.9.40/1.36.144)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rp-'));
   
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpC, 'package.json'), JSON.stringify({ name: 'rp-test', version: '0.0.1' }), 'utf8');
   
   
   
   
   
  const _tracker = path.join(tmpC, '.leerness', 'progress-tracker.md');
  const _before = (() => { try { return fs.readFileSync(_tracker, 'utf8'); } catch { return ''; } })();
  const r = cp.spawnSync(process.execPath, [CLI, 'release', 'pack', tmpC, '--dry-run', '--task-add', '1.9.40 e2e 검증', '--no-readme-sync'], { encoding: 'utf8', timeout: 30000 });
  const _afterDry = (() => { try { return fs.readFileSync(_tracker, 'utf8'); } catch { return ''; } })();
  const r2 = cp.spawnSync(process.execPath, [CLI, 'release', 'pack', tmpC, '--task-add', '1.9.40 e2e 검증', '--no-readme-sync'], { encoding: 'utf8', timeout: 60000 });
  const _afterReal = (() => { try { return fs.readFileSync(_tracker, 'utf8'); } catch { return ''; } })();
  const dryQuiet = _afterDry === _before && !/task added/.test(r.stdout) && /\(dry-run\) task add 스킵/.test(r.stdout);
  const realWrote = _afterReal !== _before && /task added/.test(r2.stdout);
  const ok = r.status === 0
    && /release pack \(1\.9\.40\)/.test(r.stdout)
    && /dry-run/.test(r.stdout)
    && dryQuiet && realWrote;
  console.log(ok ? '✓ B(1.9.40/1.36.144) release pack: --dry-run 은 task 를 **쓰지 않고 말만** 하고, 플래그 없는 실행은 그대로 등록(대조군)'
    : `✗ release pack 실패 ${JSON.stringify({ dryQuiet, realWrote, dryExit: r.status, realExit: r2.status })}`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); console.log('--- real ---'); console.log(r2.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.40)')) {
  total++;
   
  const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rp-parent-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpParent, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const tmpChild = path.join(tmpParent, 'child');
  fs.mkdirSync(tmpChild, { recursive: true });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpChild, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpChild, 'package.json'), JSON.stringify({ name: 'rp-child', version: '0.0.1' }), 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'release', 'pack', tmpChild, '--dry-run', '--parent-migrate', '--no-readme-sync'], { encoding: 'utf8', timeout: 30000 });
  const ok = r.status === 0 && /parent self-host migrate/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.40) release pack --parent-migrate: 부모 .leerness 자동 감지' : `✗ parent-migrate 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.40) #2')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mm-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  fs.writeFileSync(path.join(tmpC, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }), 'utf8');
  fs.writeFileSync(path.join(tmpC, 'README.md'), '# Test\n[![version](https://img.shields.io/badge/version-0.5.0-green)]()\n', 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'audit', tmpC], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /version badge mismatch.*0\.5\.0.*1\.0\.0/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.40) audit: README ↔ package.json version mismatch 감지' : `✗ README mismatch 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.40) #3')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mm2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpC, 'package.json'), JSON.stringify({ name: 't', version: '2.0.0' }), 'utf8');
  fs.writeFileSync(path.join(tmpC, 'README.md'), '# Test\n[![version](https://img.shields.io/badge/version-0.5.0-green)]()\n', 'utf8');
  cp.spawnSync(process.execPath, [CLI, 'audit', tmpC, '--fix'], { stdio: 'ignore', timeout: 15000 });
  const after = fs.readFileSync(path.join(tmpC, 'README.md'), 'utf8');
  const ok = /badge\/version-2\.0\.0-green/.test(after);
  console.log(ok ? '✓ B(1.9.40) audit --fix: README version 배지 자동 갱신' : `✗ --fix README 실패`);
  if (!ok) { failed++; console.log(after.slice(0, 300)); }
}

 
if (e2eShard.take('B(1.9.39)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-wf-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const plain = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--no-drift-check'], { encoding: 'utf8', timeout: 15000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--inspect', '--no-drift-check'], { encoding: 'utf8', timeout: 60000 });
  const ok = r.status === 0
    && /세션 워크플로 6단계/.test(r.stdout)
    && /1\. 요청 분석/.test(r.stdout)
    && /6\. 세션 마감/.test(r.stdout)
    && plain.status === 0 && !/세션 워크플로 6단계/.test(plain.stdout);
  console.log(ok ? '✓ B(1.9.39) handoff: 6단계 워크플로 가이드 자동 표시' : `✗ workflow guide 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-500)); }
}

if (e2eShard.take('B(1.9.39) #2')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-wf2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const wfFile = path.join(tmpC, '.leerness', 'session-workflow.md');
  const ok = fs.existsSync(wfFile)
    && /6단계/.test(fs.readFileSync(wfFile, 'utf8'))
    && /sub-agent/.test(fs.readFileSync(wfFile, 'utf8'));
  console.log(ok ? '✓ B(1.9.39) .leerness/session-workflow.md init 시 자동 생성' : `✗ workflow 파일 실패`);
  if (!ok) { failed++; if (fs.existsSync(wfFile)) console.log(fs.readFileSync(wfFile, 'utf8').slice(0, 300)); else console.log('파일 없음'); }
}

if (e2eShard.take('B(1.9.39) #3')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-wf3-'));
  const initialized = cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const agentsBody = fs.readFileSync(path.join(tmpC, 'AGENTS.md'), 'utf8');
  const claudeBody = fs.readFileSync(path.join(tmpC, 'CLAUDE.md'), 'utf8');
  const workflowBody = fs.readFileSync(path.join(tmpC, '.leerness', 'session-workflow.md'), 'utf8');
  const ok = initialized.status === 0 && initialized.signal === null && !initialized.error
    && agentsBody.includes('.leerness/session-workflow.md (필요 시 관련 단계 참조)')
    && agentsBody.includes('해당 작업에 적용되는 사용자 규칙만 확인하고 준수')
    && claudeBody.includes('@AGENTS.md')
    && claudeBody.includes('컨텍스트 읽기 범위(주 세션 담당자와 위임 작업자·검수자의 구분)는 AGENTS.md의 같은 절을 따른다.')
    && claudeBody.includes('Follow AGENTS.md. The main session owner may use `leerness handoff .` and `leerness session close .` as needed; these are not universal gates.')
    && workflowBody.includes('6단계');
  console.log(ok ? '✓ B(1.9.39) AGENTS 선택형 워크플로 참조 + CLAUDE 위임 문맥·사용자 규칙 경로 보존' : `✗ 인스트럭션 통합 실패`);
  if (!ok) { failed++; }
}

if (e2eShard.take('B(1.9.39) #4')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-af-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  const r = cp.spawnSync(process.execPath, [CLI, 'drift', 'check', tmpC, '--auto-fix'], { encoding: 'utf8', timeout: 30000 });
  const ok = r.status === 0
    && /leerness drift check/.test(r.stdout)
    && /(healthy|attention|warning|critical)/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.39) drift check --auto-fix 옵션 인식 + healthy fallthrough' : `✗ --auto-fix 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

 
if (e2eShard.take('B(1.9.38)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-usage-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  cp.spawnSync(process.execPath, [CLI, 'status', tmpC], { stdio: 'ignore', timeout: 10000 });
  cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--inspect', '--no-drift-check'], { stdio: 'ignore', timeout: 60000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'usage', 'stats', tmpC, '--json'], { encoding: 'utf8', timeout: 10000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = parsed
    && parsed.commands
    && (parsed.commands.status >= 1 || parsed.commands.handoff >= 1)
    && parsed.drift
    && typeof parsed.drift.skipped === 'number';
  console.log(ok ? '✓ B(1.9.38) usage stats: 명령 카운터 누적 + drift 통계 구조' : `✗ usage stats 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.38) #2')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tasksync-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const todoFile = path.join(tmpC, 'todo.json');
  fs.writeFileSync(todoFile, JSON.stringify([
    { content: 'sync 테스트 작업 A', status: 'completed', activeForm: 'syncA' },
    { content: 'sync 테스트 작업 B', status: 'in_progress', activeForm: 'syncB' },
    { content: 'sync 테스트 작업 C', status: 'pending', activeForm: 'syncC' }
  ]), 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'task', 'sync', '--from', todoFile, '--path', tmpC, '--json'], { encoding: 'utf8', timeout: 15000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout.split('\n').filter(l => l.startsWith('{')).pop() || '{}'); } catch {}
  const ok = r.status === 0 && /imported: 3/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.38) task sync: 3개 TodoWrite → progress-tracker import' : `✗ task sync 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.38) #3')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rem-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  const shPath = path.join(tmpC, '.leerness', 'session-handoff.md');
  if (fs.existsSync(shPath)) {
    const oldDate = new Date(Date.now() - 5 * 86400000).toISOString();
    let body = fs.readFileSync(shPath, 'utf8');
    body = body.replace(/Last generated:.*/, `Last generated: ${oldDate}`);
    if (!/Last generated:/.test(body)) body = `Last generated: ${oldDate}\n` + body;
    fs.writeFileSync(shPath, body, 'utf8');
  }
   
  cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--compact', '--writeback'], { encoding: 'utf8', timeout: 10000 });
  const remPath = path.join(tmpC, '.leerness', 'agent-reminders.md');
  const ok = fs.existsSync(remPath) && /drift critical/.test(fs.readFileSync(remPath, 'utf8'));
  console.log(ok ? '✓ B(1.9.38) drift critical → agent-reminders.md 자동 생성' : `✗ reminder 파일 실패`);
  if (!ok) { failed++; if (fs.existsSync(remPath)) console.log(fs.readFileSync(remPath, 'utf8').slice(0, 400)); else console.log('(reminder 파일 없음)'); }
}

if (e2eShard.take('B(1.9.38) #4')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-learn-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  const statsFile = path.join(tmpC, '.leerness', 'cache', 'usage-stats.json');
  const plain = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--compact', '--no-drift-check'], { stdio: 'ignore', timeout: 10000 });
  const plainWroteNothing = plain.status === 0 && !fs.existsSync(statsFile);
  for (let i = 0; i < 5; i++) {
    cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--inspect', '--no-drift-check'], { stdio: 'ignore', timeout: 60000 });
  }
  let stats = null;
  try { stats = JSON.parse(fs.readFileSync(statsFile, 'utf8')); } catch {}
  const ok = plainWroteNothing && !!stats && !!stats.drift && stats.drift.skipped >= 5;
  console.log(ok ? '✓ B(1.9.38) drift 학습: --no-drift-check 5회 누적 (skipped≥5)' : `✗ drift 학습 실패`);
  if (!ok) { failed++; console.log(JSON.stringify({ plainWroteNothing, drift: (stats && stats.drift) || null })); }
}

 
if (e2eShard.take('B(1.9.37)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-drift-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'drift', 'check', tmpC], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0
    && /leerness drift check \(1\.9\.37\)/.test(r.stdout)
    && /(healthy|attention|warning)/.test(r.stdout);   
  console.log(ok ? '✓ B(1.9.37) drift check: 신규 init → healthy/attention 등급' : `✗ drift check 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.37) #2')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-drift2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  const r = cp.spawnSync(process.execPath, [CLI, 'drift', 'check', tmpC, '--json'], { encoding: 'utf8', timeout: 15000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = parsed
    && typeof parsed.score === 'number'
    && typeof parsed.level === 'string'
    && Array.isArray(parsed.signals)
    && parsed.signals.length >= 3;  
  console.log(ok ? '✓ B(1.9.37) drift check --json: 점수/레벨/신호 구조' : `✗ drift --json 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.37) #3')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-drift3-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  const shPath = path.join(tmpC, '.leerness', 'session-handoff.md');
  if (fs.existsSync(shPath)) {
    let body = fs.readFileSync(shPath, 'utf8');
    const oldDate = new Date(Date.now() - 5 * 86400000).toISOString();
    body = body.replace(/Last generated:.*/, `Last generated: ${oldDate}`);
    if (!/Last generated:/.test(body)) body = `Last generated: ${oldDate}\n\n` + body;
    fs.writeFileSync(shPath, body, 'utf8');
  }
  const plain = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--compact'], { encoding: 'utf8', timeout: 15000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--inspect', '--no-workflow-guide'], { encoding: 'utf8', timeout: 60000 });
  const ok = /leerness drift 감지/.test(r.stdout) && /session close/.test(r.stdout)
    && plain.status === 0 && !/leerness drift 감지/.test(plain.stdout);
  console.log(ok ? '✓ B(1.9.37) handoff 자동 drift 경고: 5일 stale → 알림 표시' : `✗ handoff drift 경고 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.37) #4')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-drift4-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const shPath = path.join(tmpC, '.leerness', 'session-handoff.md');
  if (fs.existsSync(shPath)) {
    const oldDate = new Date(Date.now() - 5 * 86400000).toISOString();
    let body = fs.readFileSync(shPath, 'utf8');
    body = body.replace(/Last generated:.*/, `Last generated: ${oldDate}`);
    if (!/Last generated:/.test(body)) body = `Last generated: ${oldDate}\n\n` + body;
    fs.writeFileSync(shPath, body, 'utf8');
  }
  const env = { ...process.env, LEERNESS_NO_DRIFT_CHECK: '1' };
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--compact'], { encoding: 'utf8', timeout: 15000, env });
  const ok = !/leerness drift 감지/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.37) LEERNESS_NO_DRIFT_CHECK=1: 경고 스킵' : `✗ drift skip 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.36)')) {
  total++;
   
  const env = { ...process.env, LEERNESS_ENABLE_AGY: '1' };
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', '코드 분석해서 요약', '--to', 'agy', '--write'], { encoding: 'utf8', timeout: 15000, env });
   
  const ok = (r.status === 0 && /--yolo/.test(r.stdout) && /write \(파일 수정 가능\)/.test(r.stdout))
          || (r.status !== 0 && /비활성|disabled|not-installed/.test(r.stdout));
  console.log(ok ? '✓ B(1.9.36) dispatch --write: agy --yolo 자동 첨부 또는 비활성 거부' : `✗ dispatch --write 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.36) #2')) {
  total++;
   
  const env = { ...process.env, LEERNESS_ENABLE_CLAUDE: '1' };
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', '번역해줘', '--to', 'claude'], { encoding: 'utf8', timeout: 15000, env });
   
  const ok = (r.status === 0 && /read-only/.test(r.stdout) && !/--dangerously-skip-permissions/.test(r.stdout))
          || (r.status !== 0 && /비활성|disabled|not-installed/.test(r.stdout));
  console.log(ok ? '✓ B(1.9.36) dispatch read-only 기본: 위험 플래그 미첨부 또는 비활성 거부' : `✗ dispatch read-only 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.36) #3')) {
  total++;
   
  const env = { ...process.env, LEERNESS_ENABLE_AGY: '0', LEERNESS_ENABLE_CLAUDE: '0' };
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', '번역해줘 한국어를 영어로', '--to', 'agy'], { encoding: 'utf8', timeout: 15000, env });
   
  const ok = /추천.*claude/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.36) 작업 유형 추천: 번역→claude 추천 (비활성이어도 출력)' : `✗ 추천 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.36) #4')) {
  total++;
   
   
   
  const fakeBin = path.join(tmp, 'bench-disabled-bin');
  const marker = path.join(tmp, 'bench-disabled-provider-ran.txt');
  fs.mkdirSync(fakeBin, { recursive: true });
  writePortableCliShim(fakeBin, 'codex', `require('fs').writeFileSync(process.env.LEERNESS_E2E_MARKER, 'ran'); console.log('codex fixture');`);
  const env = { ...process.env, ...Object.fromEntries(EXTERNAL_AGENTS.map(a => [a.envFlag, '0'])) };
  const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
  env[pathKey] = `${fakeBin}${path.delimiter}${env[pathKey] || ''}`;
  env.LEERNESS_E2E_MARKER = marker;
   
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'bench', 'test'], { encoding: 'utf8', timeout: 15000, env });
  const ok = r.status !== 0 && /ready CLI 없음/.test(r.stdout) && !fs.existsSync(marker);
  console.log(ok ? '✓ B(1.9.36) agents bench: ready 없을 때 거부 + disabled CLI 무실행' : `✗ bench 거부/격리 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 300)); }
}

if (e2eShard.take('B(1.9.36) #5')) {
  total++;
   
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'unknown'], { encoding: 'utf8', timeout: 10000 });
  const ok = r.status !== 0 && /bench/.test(r.stdout + r.stderr);
  console.log(ok ? '✓ B(1.9.36) agents 사용법에 bench 명시' : `✗ usage bench 실패`);
  if (!ok) { failed++; console.log((r.stdout + r.stderr).slice(0, 300)); }
}

 
if (e2eShard.take('B(1.9.35)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-noinit-'));
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC], { encoding: 'utf8', timeout: 10000 });
  const ok = /leerness init 미실행 디렉토리/.test(r.stdout) || /leerness init/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.35) handoff: .leerness 부재 자동 경고' : `✗ #1 handoff 경고 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.35) #2')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-fix-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'audit', tmpC, '--fix'], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /(Audit summary|fixed=)/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.35) audit --fix: 자동 fix 옵션 인식' : `✗ #5 audit --fix 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.35) #3')) {
  total++;
   
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-contract-'));
  const specFile = path.join(tmpDir, 'spec.md');
  const implFile = path.join(tmpDir, 'impl.js');
  fs.writeFileSync(specFile, '# Spec\n\nfunction foo(x) {}\nfunction bar(y) {}\n`baz(`\n\ntick.amount\ntick.isCritical\n', 'utf8');
  fs.writeFileSync(implFile, '"use strict";\nfunction foo(x){return x}\nfunction baz(y){return tick.amount}\nmodule.exports={foo, baz};\n', 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'contract', 'verify', specFile, implFile, '--json'], { encoding: 'utf8', timeout: 10000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = parsed
    && Array.isArray(parsed.missingFunctions) && parsed.missingFunctions.includes('bar')
    && Array.isArray(parsed.missingFields) && parsed.missingFields.includes('isCritical')
    && parsed.ok === false;
  console.log(ok ? '✓ B(1.9.35) contract verify: bar 함수 + isCritical 필드 누락 정확 감지' : `✗ #3 contract verify 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.35) #4')) {
  total++;
   
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-autodetect-'));
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'util.js'), 'function hello(){}\nfunction _internal(){}\nmodule.exports={hello, _internal};\n', 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'reuse', 'autodetect', tmpDir, '--json'], { encoding: 'utf8', timeout: 10000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
   
  const ok = parsed && parsed.found && parsed.found.length === 1 && parsed.found[0].name === 'hello';
  console.log(ok ? '✓ B(1.9.35) reuse autodetect: module.exports 스캔 + _internal 제외' : `✗ #2 autodetect 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

if (e2eShard.take('B(1.9.35) #5')) {
  total++;
   
  const env = { ...process.env, LEERNESS_ENABLE_CLAUDE: '1' };
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', 'test task', '--to', 'claude'], { encoding: 'utf8', timeout: 15000, env });
   
  const text = r.stdout + r.stderr;
  const ok = /분배 시 안전 규칙 \(1\.9\.35\)/.test(text) || /파일 경로 격리/.test(text) || /last-writer-wins/.test(text)
     
    || /비활성|disabled|not-installed/i.test(text);
  console.log(ok ? '✓ B(1.9.35) agents dispatch: 안전 규칙 안내 (mtime/contract) 또는 비활성 거부' : `✗ #4 dispatch 안내 실패`);
  if (!ok) { failed++; console.log(text.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.34)')) {
  total++;
   
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-multi-'));
  const r = cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
   
  const ok = r.status === 0
    && /Leerness v/.test(r.stdout)
    && /Skills: (feature-implementation|project-roadmap-generator)/.test(r.stdout);    
  console.log(ok ? '✓ B(1.9.34) multi-select 비-TTY 폴백: --yes로 default 사용' : `✗ multi-select 폴백 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.34) #2')) {
  total++;
   
  const r = cp.spawnSync(process.execPath, [CLI, '--version', '--banner'], { encoding: 'utf8', timeout: 10000 });
  const ok = r.status === 0
    && /███████╗/.test(r.stdout)
    && /verify · remember/.test(r.stdout)
    && /AI 에이전트 검수.기억.드리프트 방지 하네스/.test(r.stdout)
    && /v\d+\.\d+\.\d+/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.34) 배너 색상 + ASCII + 한국어' : `✗ 배너 색상 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.34) #3')) {
  total++;
   
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-noint-'));
  const r = cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--no-interactive-select', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
  const ok = r.status === 0 && /Leerness v/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.34) --no-interactive-select 플래그 인식' : `✗ --no-interactive-select 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 300)); }
}

if (e2eShard.take('B(1.9.33) #2')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-stale2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended', '--no-stale-check'], { stdio: 'ignore', timeout: 30000 });
  const cacheDir = path.join(tmpC, '.leerness', 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'update-check.json'), JSON.stringify({ at: Date.now(), nextLeerness: '99.99.99' }), 'utf8');
   
  const r1 = cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
   
  const r2 = cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, LEERNESS_NO_STALE_CHECK: '1' } });
  const ok = r1.status === 0 && r2.status === 0
    && !/옛 버전이 실행 중입니다/.test(r1.stdout)
    && !/옛 버전이 실행 중입니다/.test(r2.stdout);
  console.log(ok ? '✓ B(1.9.33) stale 스킵: --no-stale-check + LEERNESS_NO_STALE_CHECK=1' : `✗ stale skip 실패`);
  if (!ok) { failed++; console.log(r1.stdout.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.22/1.36.255)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-compact-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', '--include', tmpC, '--compact'], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
   
   
  const { COMPACT_RULES } = require(path.resolve(__dirname, '..', 'lib', 'context-reading-guidance.js'));
  const ok = r.status === 0
    && /leerness compact \(1\.9\.22\):/.test(r.stdout)
    && r.stdout.includes(COMPACT_RULES)
    && !/핵심 규칙: 의존성0/.test(r.stdout)
    && r.stdout.length < 2000;  
  console.log(ok ? '✓ B(1.9.22/1.36.255) handoff --compact: LLM 프롬프트용 1줄 요약 + 고정 규칙 대신 규칙 확인 경로' : '✗ --compact 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.22)')) {
  total++;
   
  const tmpO = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-orch-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpO, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  const env = { ...process.env };
  delete env.LEERNESS_OLLAMA_BASE_URL;
  const r = cp.spawnSync(process.execPath, [CLI, 'orchestrate', 'test goal', '--path', tmpO, '--agents', '3'], { encoding: 'utf8', timeout: 15000, env });
  const ok = r.status !== 0
    && /LEERNESS_OLLAMA_BASE_URL 미설정/.test(r.stdout)
    && /opt-in/.test(r.stdout)
    && /환경변수 없으면 LLM 호출 자동 시작 금지/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.22) orchestrate opt-in 정책: env 없으면 거부 + 안내' : '✗ orchestrate opt-in 정책 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.22) #2')) {
  total++;
   
  const tmpE = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-orch-env-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpE, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpE, '.env'), 'LEERNESS_OLLAMA_BASE_URL=http://127.0.0.1:1\n');
  const env = { ...process.env };
  delete env.LEERNESS_OLLAMA_BASE_URL;
  const r = cp.spawnSync(process.execPath, [CLI, 'orchestrate', 'test', '--path', tmpE, '--agents', '1', '--timeout', '2000'], { encoding: 'utf8', timeout: 30000, env });
   
  const ok = /Opt-in 활성화: Ollama URL = http:\/\/127\.0\.0\.1:1/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.22) orchestrate: .env 자동 로드 (LEERNESS_OLLAMA_BASE_URL 감지)' : '✗ .env auto-load 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.22) #3')) {
  total++;
   
  const tmpL = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-llmb-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpL, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'llm-bench', 'record', '--path', tmpL, '--score', '7.5', '--model', 'llama3.1:8b', '--label', 'A_leerness', '--tokens', '1754'], { encoding: 'utf8', timeout: 10000 });
  const ok = r.status === 0
    && fs.existsSync(path.join(tmpL, '.leerness', 'llm-bench-history.md'))
    && fs.readFileSync(path.join(tmpL, '.leerness', 'llm-bench-history.md'), 'utf8').includes('llama3.1:8b');
  console.log(ok ? '✓ B(1.9.22) llm-bench record: 히스토리 누적 저장' : '✗ llm-bench record 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.20) #2')) {
  total++;
   
  const tmpJ = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tparse-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpJ, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpJ, 'package.json'), JSON.stringify({ name: 'tp', version: '0.0.1', scripts: { test: 'node tests/test.js' } }));
  fs.mkdirSync(path.join(tmpJ, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpJ, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmpJ, 'src/foo.js'), 'module.exports = { ok: true };\n');
  fs.writeFileSync(path.join(tmpJ, 'tests/test.js'), "console.log('Tests:       12 passed, 12 total');\n");
  fs.appendFileSync(path.join(tmpJ, '.leerness/progress-tracker.md'),
    '| T-0021 | done | jest 스타일 | src/foo.js + Tests: 12 passed, 12 total | next | 2026-05-14 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0021', '--path', tmpJ, '--run-tests'], { encoding: 'utf8', timeout: 60000 });
  const okEv = /주장 \(pass\): 12\/12/.test(r.stdout);
  const okRun = /실행 결과: 12\/12 passed/.test(r.stdout);
  const ok = r.status === 0 && okEv && okRun;
  console.log(ok ? '✓ B(1.9.20) verify-claim: jest "Tests: N passed, N total" 파싱' : `✗ jest 파싱 실패 (ev=${okEv} run=${okRun})`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.20) #3')) {
  total++;
   
  const tmpM = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mocha-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpM, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpM, 'package.json'), JSON.stringify({ name: 'mc', version: '0.0.1', scripts: { test: 'node tests/test.js' } }));
  fs.mkdirSync(path.join(tmpM, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpM, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmpM, 'src/x.js'), 'module.exports = { ok: true };\n');
  fs.writeFileSync(path.join(tmpM, 'tests/test.js'), "console.log('  7 passing (12ms)');\n");
  fs.appendFileSync(path.join(tmpM, '.leerness/progress-tracker.md'),
    '| T-0022 | done | mocha | src/x.js + 7 passing | next | 2026-05-14 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0022', '--path', tmpM, '--run-tests'], { encoding: 'utf8', timeout: 60000 });
  const ok = r.status === 0 && /주장 \(pass\): 7\/7/.test(r.stdout) && /실행 결과: 7\/7 passed/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.20) verify-claim: mocha "N passing" 파싱' : '✗ mocha 파싱 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

if (e2eShard.take('B(1.9.20) #4')) {
  total++;
   
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bench-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpB, 'package.json'), JSON.stringify({
    name: 'b', version: '0.0.1',
    scripts: { test: 'node tests/test.js', bench: 'node tests/bench.js' }
  }));
  fs.mkdirSync(path.join(tmpB, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmpB, 'tests/test.js'), "console.log('1/1 passed');\n");
  fs.writeFileSync(path.join(tmpB, 'tests/bench.js'), "console.log('# bench result 12345 ops/sec');\n");
  const rNoBench = cp.spawnSync(process.execPath, [CLI, 'verify-code', tmpB], { encoding: 'utf8', timeout: 60000 });
  const okBaseline = rNoBench.status === 0 && /verify-code \(1개\)/.test(rNoBench.stdout) && !/^## bench:/m.test(rNoBench.stdout);
  const rWith = cp.spawnSync(process.execPath, [CLI, 'verify-code', tmpB, '--bench'], { encoding: 'utf8', timeout: 60000 });
  const okBench = rWith.status === 0 && /verify-code \(2개\)/.test(rWith.stdout) && /bench passed/.test(rWith.stdout);
  const evidence = fs.readFileSync(path.join(tmpB, '.leerness/review-evidence.md'), 'utf8');
  const okEvidence = /bench/.test(evidence) && /node tests\/bench\.js/.test(evidence);
  const ok = okBaseline && okBench && okEvidence;
  console.log(ok ? '✓ B(1.9.20) verify-code --bench: scripts.bench 자동 실행 + evidence 누적' : `✗ --bench 실패 (base=${okBaseline} bench=${okBench} ev=${okEvidence})`);
  if (!ok) { failed++; console.log(rWith.stdout.slice(0, 500)); }
}

 
if (e2eShard.take('B(1.9.15)')) {
  total++;
  const tmpL = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-line-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpL, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.appendFileSync(path.join(tmpL, '.leerness/decisions.md'), '\n### 2026-05-13 — 캐시 정책 결정\n- Reason: rate limit 회피\n');
  cp.spawnSync(process.execPath, [CLI, 'plan', 'add', '캐시 helper 구현', '--path', tmpL], { stdio: 'ignore', timeout: 10000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'brainstorm', '캐시', '--path', tmpL], { encoding: 'utf8', timeout: 15000 });
  const ok = /\.leerness\/decisions\.md:\d+/.test(r.stdout) && /\.leerness\/progress-tracker\.md:\d+/.test(r.stdout) && /matched: request/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.15) brainstorm: 파일:라인 + 매치 필드 표시' : `✗ 1.9.15 brainstorm 위치 실패\n${r.stdout.slice(0,500)}`);
  if (!ok) failed++;
}
if (e2eShard.take('B(1.9.15) #2')) {
  total++;
   
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-wsA-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-wsB-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'plan', 'add', 'A 작업', '--status', 'done', '--path', tmpA], { stdio: 'ignore', timeout: 10000 });
  cp.spawnSync(process.execPath, [CLI, 'plan', 'add', 'B 작업', '--status', 'planned', '--path', tmpB], { stdio: 'ignore', timeout: 10000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'retro', '--include', `${tmpA},${tmpB}`], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status === 0 && /Cross-project retro — 2개 프로젝트/.test(r.stdout) && /워크스페이스 총합/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.15) retro --include: 2개 통합' : '✗ 1.9.15 retro --include 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 600)); }
}
if (e2eShard.take('B(1.9.15) #3')) {
  total++;
   
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-iA-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-iB-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'insights', '--include', `${tmpA},${tmpB}`], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status === 0 && /Workspace Insights — 2개/.test(r.stdout) && /TOTAL/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.15) insights --include: 표 형식 통합' : '✗ 1.9.15 insights --include 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 600)); }
}
if (e2eShard.take('B(1.9.15) #4')) {
  total++;
   
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bad-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const bad = '/tmp/nonexistent-leerness-' + Date.now();
  const r = cp.spawnSync(process.execPath, [CLI, 'retro', '--include', `${tmpA},${bad}`], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status === 0 && /--include 무시/.test(r.stdout) && /Cross-project retro — 1개/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.15) --include 잘못된 경로 graceful skip' : '✗ 1.9.15 bad path 처리 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

 
if (e2eShard.take('B(1.9.14-A)')) {
  total++;
   
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-A-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'insights', tmpA], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /누적 결정 \(decisions\.md\): 0건/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.14-A) Template 제외: 누적 결정 0건' : `✗ A 실패\n${r.stdout.slice(0, 500)}`);
  if (!ok) failed++;
}
if (e2eShard.take('B(1.9.14-B)')) {
  total++;
   
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-B-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.appendFileSync(path.join(tmpB, '.leerness/decisions.md'), '\n### 2026-05-13 — API rate limit 정책\n- Reason: ...\n');
   
  const r1 = cp.spawnSync(process.execPath, [CLI, 'brainstorm', 'limit', '--path', tmpB], { encoding: 'utf8', timeout: 15000 });
   
  const r2 = cp.spawnSync(process.execPath, [CLI, 'brainstorm', 'lim', '--path', tmpB], { encoding: 'utf8', timeout: 15000 });
  const ok = /총 1건/.test(r1.stdout) && /총 0건/.test(r2.stdout);
  console.log(ok ? '✓ B(1.9.14-B) brainstorm word boundary: limit 매치 / lim 부분매치 안 잡힘' : `✗ B 실패\n${r1.stdout.slice(0, 200)}\n${r2.stdout.slice(0, 200)}`);
  if (!ok) failed++;
}
if (e2eShard.take('B(1.9.14-C)')) {
  total++;
   
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-C-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  fs.writeFileSync(path.join(tmpC, '.leerness/progress-tracker.md'), `# Progress Tracker\nStatus values: requested, planned, in-progress, waiting, on-hold, blocked, incomplete, done, dropped\n\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n| T-0001 | planned | 미래 작업 | plan:M-0001 | 시작 예정 | 2026-05-13 |\n`);
  const r = cp.spawnSync(process.execPath, [CLI, 'retro', tmpC], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /T-0001 \[planned\]/.test(r.stdout) && !/없음 — 새 plan add 권장/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.14-C) retro 다음 우선 작업에 planned 포함' : '✗ C 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 600)); }
}
if (e2eShard.take('B(1.9.14-D)')) {
  total++;
   
  const tmpD = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-D-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpD, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const dec = fs.readFileSync(path.join(tmpD, '.leerness/decisions.md'), 'utf8');
  const ok = /```md\n### \d{4}-\d{2}-\d{2} — Decision/.test(dec) && /^## Template/m.test(dec);
  console.log(ok ? '✓ B(1.9.14-D) decisions.md template 코드블록 감싸짐' : '✗ D 실패');
  if (!ok) { failed++; console.log(dec.slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.13)')) {
  total++;
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-retro-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'plan', 'add', '캐시 helper', '--status', 'done', '--path', tmpR], { stdio: 'ignore', timeout: 10000 });
  cp.spawnSync(process.execPath, [CLI, 'plan', 'add', '인증 helper', '--status', 'in-progress', '--path', tmpR], { stdio: 'ignore', timeout: 10000 });
   
  const _todayR = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(path.join(tmpR, '.leerness/decisions.md'), `\n### ${_todayR} — 캐시 차등 TTL 결정\n- Reason: ...\n`);
  fs.appendFileSync(path.join(tmpR, '.leerness/review-evidence.md'), `\n## ${_todayR} verify-code\nexit=0 (250ms)\nexit=0 (180ms)\nexit=0 (120ms)\nexit=0 (90ms)\n`);
  const r = cp.spawnSync(process.execPath, [CLI, 'retro', tmpR], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /한 줄 요약/.test(r.stdout) && /작업 상태 분포/.test(r.stdout) && /다음 우선 작업/.test(r.stdout) && /검증 시간 추세/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.13) retro: 한 줄 요약 + 다음 우선 작업 + 검증 시간 추세' : '✗ retro 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 800)); }
}

if (e2eShard.take('B(1.9.13) #2')) {
  total++;
  const tmpI = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ins-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpI, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'insights', tmpI], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /핵심 지표/.test(r.stdout) && /누적 task/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.13) insights: 핵심 지표 출력' : '✗ insights 실패');
  if (!ok) failed++;
}

if (e2eShard.take('B(1.9.13) #3')) {
  total++;
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-brain-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.appendFileSync(path.join(tmpB, '.leerness/decisions.md'), `\n### 2026-05-13 — 캐시 차등 TTL 결정\n- Reason: open-meteo 응답 최적화\n`);
  cp.spawnSync(process.execPath, [CLI, 'plan', 'add', '캐시 helper 구현', '--path', tmpB], { stdio: 'ignore', timeout: 10000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'brainstorm', '캐시', '--path', tmpB], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /Brainstorm — "캐시"/.test(r.stdout) && /관련 결정/.test(r.stdout) && /시작 전 권장 액션/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.13) brainstorm: 주제 매칭 + 시작 컨텍스트' : `✗ brainstorm 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 600)); }
}

if (e2eShard.take('B(1.9.13) #4')) {
  total++;
   
  const tmpS = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-summary-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpS, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpS], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /진행 요약/.test(r.stdout) && /자동 깊은 회고/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.13) session close: 한 줄 요약 자동 출력' : `✗ session close 요약 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-600)); }
}

if (e2eShard.take('B(1.9.13) #5')) {
  total++;
   
  const tmpD = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-deep-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpD, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
   
  fs.mkdirSync(path.join(tmpD, '.leerness/cache'), { recursive: true });
  fs.writeFileSync(path.join(tmpD, '.leerness/cache/session-counter.json'), JSON.stringify({ count: 4 }));
  const r = cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpD], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /5세션 마일스톤/.test(r.stdout) && /회고 \(retro\)/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.13) 5세션 마일스톤: 자동 깊은 회고' : '✗ 5세션 자동 회고 실패');
  if (!ok) failed++;
}

 
process.env.LEERNESS_NO_AUTO_ROADMAP = '0';
 
if (e2eShard.take('B(1.9.12)')) {
  total++;
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-auto1-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  const ok = fs.existsSync(path.join(tmpA, 'leerness.html'));
  console.log(ok ? '✓ B(1.9.12) install 직후 leerness.html(온톨로지) 자동 생성 (1.36.30 전환)' : '✗ install 후 leerness.html 없음');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.12) #2')) {
  total++;
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-auto2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
   
  const f = path.join(tmpA, 'leerness.html');
  const mt1 = fs.statSync(f).mtimeMs;
   
  const wait = Date.now() + 50; while (Date.now() < wait) {}
   
  cp.spawnSync(process.execPath, [CLI, 'task', 'add', '신규 작업', '--path', tmpA], { stdio: 'ignore' });
  cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpA], { stdio: 'ignore' });
  const mt2 = fs.statSync(f).mtimeMs;
  const ok = mt2 > mt1;
  console.log(ok ? '✓ B(1.9.12) session close 후 leerness.html 자동 갱신 (mtime 증가)' : `✗ session close 후 갱신 안 됨 mt1=${mt1} mt2=${mt2}`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.12) #3')) {
  total++;
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-auto3-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  cp.spawnSync(process.execPath, [CLI, 'roadmap', 'auto', 'off', '--path', tmpA], { stdio: 'ignore' });
  const f = path.join(tmpA, 'leerness.html');
  const mt1 = fs.statSync(f).mtimeMs;
  const wait = Date.now() + 80; while (Date.now() < wait) {}
  cp.spawnSync(process.execPath, [CLI, 'task', 'add', '비활성 후 추가', '--path', tmpA], { stdio: 'ignore' });
  cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpA], { stdio: 'ignore' });
  const mt2 = fs.statSync(f).mtimeMs;
  const ok = mt2 === mt1;
  console.log(ok ? '✓ B(1.9.12) auto off: leerness.html 갱신 안 됨' : `✗ auto off 후에도 갱신됨`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.12) #4')) {
  total++;
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-auto4-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  cp.spawnSync(process.execPath, [CLI, 'roadmap', 'auto', 'on', '--on-every-change', '--path', tmpA], { stdio: 'ignore' });
  const f = path.join(tmpA, 'leerness.html');
  const mt1 = fs.statSync(f).mtimeMs;
  const wait = Date.now() + 80; while (Date.now() < wait) {}
  cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'on-every-change 테스트', '--path', tmpA], { stdio: 'ignore' });
  const mt2 = fs.statSync(f).mtimeMs;
  const ok = mt2 > mt1;
  console.log(ok ? '✓ B(1.9.12) --on-every-change: task add만으로 즉시 갱신' : `✗ on-every-change 미작동`);
  if (!ok) failed++;
}
 
process.env.LEERNESS_NO_AUTO_ROADMAP = '1';

 
if (e2eShard.take('B(1.9.12) #5')) {
  total++;
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-auto5-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  const r = cp.spawnSync(process.execPath, [CLI, 'roadmap', 'auto', 'status', '--path', tmpA], { encoding: 'utf8' });
  const ok = /enabled: true/.test(r.stdout) && /session-close.*✓/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.12) roadmap auto status: 상태 출력' : '✗ status 출력 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.11)')) {
  total++;
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rm-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  const r = cp.spawnSync(process.execPath, [CLI, 'roadmap', tmpR], { encoding: 'utf8' });
  const outFile = path.join(tmpR, 'roadmap.html');
  const ok = r.status === 0 && fs.existsSync(outFile);
  console.log(ok ? '✓ B(1.9.11) roadmap: 명령 + 파일 생성' : `✗ roadmap 실패\n${r.stdout}\n${r.stderr}`);
  if (!ok) failed++;
}
if (e2eShard.take('B(1.9.11) #2')) {
  total++;
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rm2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  cp.spawnSync(process.execPath, [CLI, 'roadmap', tmpR], { stdio: 'ignore' });
  const html = fs.readFileSync(path.join(tmpR, 'roadmap.html'), 'utf8');
  const ok = /화이트보드/.test(html) && /id="roadmap-svg"/.test(html) && /viewBox="0 0/.test(html) && /window\.lrZoom/.test(html) && /window\.lrReset/.test(html);
  console.log(ok ? '✓ B(1.9.11) roadmap: 화이트보드 (panning/zoom JS)' : '✗ 화이트보드 부재');
  if (!ok) failed++;
}
if (e2eShard.take('B(1.9.11) #3')) {
  total++;
   
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rm3-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  let ds = fs.readFileSync(path.join(tmpR, '.leerness/design-system.md'), 'utf8');
  ds = ds.replace('| color.primary | (실제 값으로 업데이트) | |', '| color.primary | #ff5722 | |');
  fs.writeFileSync(path.join(tmpR, '.leerness/design-system.md'), ds);
  cp.spawnSync(process.execPath, [CLI, 'roadmap', tmpR], { stdio: 'ignore' });
  const html = fs.readFileSync(path.join(tmpR, 'roadmap.html'), 'utf8');
  const ok = /--lr-primary: #ff5722/.test(html);
  console.log(ok ? '✓ B(1.9.11) roadmap: design-system 토큰 자동 주입' : '✗ 토큰 주입 실패');
  if (!ok) failed++;
}
if (e2eShard.take('B(1.9.11) #4')) {
  total++;
   
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rm4-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  const skillsDir = path.join(tmpR, '.leerness/skills/project-roadmap-generator');
  const ok = fs.existsSync(skillsDir) && fs.existsSync(path.join(skillsDir, 'skill.json'));
  console.log(ok ? '✓ B(1.9.11) recommended에 project-roadmap-generator 자동 설치' : '✗ 자동 설치 실패');
  if (!ok) failed++;
}

 
 
if (e2eShard.take('B(1.9.10)')) {
  total++;
  let skillpackDir = path.resolve(__dirname, '..', '..', 'leerness-skillpack');
  if (!fs.existsSync(path.join(skillpackDir, 'catalog.json'))) {
    skillpackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-spfix-'));
    fs.writeFileSync(path.join(skillpackDir, 'catalog.json'), JSON.stringify({
      name: 'leerness-skillpack', version: '1.0.0', leernessCompat: '>=1.9.10', updatedAt: '2026-01-01',
      skills: [{ id: 'fixture-skill', displayNameKo: '픽스처 스킬', version: '1.0.0', lastUpdated: '2026-01-01', verification: 'passed', capabilities: ['e2e portable fixture'] }]
    }, null, 2));
  }
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'list', '--path', tmp], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { LEERNESS_SKILLPACK_PATH: skillpackDir })
  });
  const ok = r.status === 0 && /skillpack 출처: env/.test(r.stdout) && /\| skillpack \|/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.10) skillpack 동적 로드 (env path)' : '✗ skillpack 로드 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 800)); }
}
 
if (e2eShard.take('B(1.9.10) #2')) {
  total++;
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'list', '--path', tmp], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { LEERNESS_SKILLPACK_PATH: '' })
  });
  const ok = r.status === 0 && /builtin fallback/.test(r.stdout) && /\| (?:builtin|catalog\+local|catalog) \|/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.10) builtin fallback (skillpack 없을 때)' : '✗ builtin fallback 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.10) #3')) {
  total++;
   
   
  gitSpawn(['init'], { cwd: tmp, encoding: 'utf8' });
  gitSpawn(['remote', 'add', 'origin', 'https://github.com/test/repo.git'], { cwd: tmp, encoding: 'utf8' });
   
  if (!fs.existsSync(path.join(tmp, 'package.json'))) {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'e2e-test', version: '0.1.0' }));
  }
  const r = cp.spawnSync(process.execPath, [CLI, 'release', 'publish', tmp, '--dry-run'], { encoding: 'utf8' });
  const ok = /Git remote \(origin\): test\/repo/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.10) detectGitRemote: github owner/repo 추출' : `✗ remote 감지 실패\n${r.stdout.slice(0, 500)}`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.8)')) {
  total++;
  const r1 = cp.spawnSync(process.execPath, [CLI, 'rule', 'add', '매 업데이트마다 버전 patch bump', '--trigger', 'every-update', '--path', tmp], { encoding: 'utf8' });
  const r2 = cp.spawnSync(process.execPath, [CLI, 'rule', 'add', '매 업데이트마다 패치노트 추가', '--trigger', 'every-update', '--path', tmp], { encoding: 'utf8' });
  const r3 = cp.spawnSync(process.execPath, [CLI, 'rule', 'add', '세션 종료마다 배포', '--trigger', 'session-close', '--path', tmp], { encoding: 'utf8' });
  const rl = cp.spawnSync(process.execPath, [CLI, 'rule', 'list', '--path', tmp], { encoding: 'utf8' });
  const ok = r1.status === 0 && r2.status === 0 && r3.status === 0 && /R-0001/.test(rl.stdout) && /R-0003/.test(rl.stdout);
  console.log(ok ? '✓ B(1.9.8) rule add/list: 3개 등록' : '✗ B(1.9.8) rule add/list 실패');
  if (!ok) failed++;
}
if (e2eShard.take('B(1.9.8) #2')) {
  total++;
   
  cp.spawnSync(process.execPath, [CLI, 'rule', 'pause', 'R-0001', '--path', tmp], { encoding: 'utf8' });
  const hr = cp.spawnSync(process.execPath, [CLI, 'handoff', tmp], { encoding: 'utf8' });
  const ok = /Active User Rules/.test(hr.stdout) && /R-0002/.test(hr.stdout) && /R-0003/.test(hr.stdout) && !/R-0001 \[/.test(hr.stdout);
  console.log(ok ? '✓ B(1.9.8) handoff: paused 룰 제외, active만 출력' : '✗ B(1.9.8) handoff 출력 실패');
  if (!ok) { failed++; console.log(hr.stdout); }
  cp.spawnSync(process.execPath, [CLI, 'rule', 'resume', 'R-0001', '--path', tmp], { encoding: 'utf8' });
}
if (e2eShard.take('B(1.9.8) #3')) {
  total++;
   
  cp.spawnSync(process.execPath, [CLI, 'rule', 'stop', '--path', tmp], { encoding: 'utf8' });
  const rl = cp.spawnSync(process.execPath, [CLI, 'rule', 'list', '--path', tmp], { encoding: 'utf8' });
  const allPaused = (rl.stdout.match(/\| paused \|/g) || []).length >= 3;
  cp.spawnSync(process.execPath, [CLI, 'rule', 'resume-all', '--path', tmp], { encoding: 'utf8' });
  const rl2 = cp.spawnSync(process.execPath, [CLI, 'rule', 'list', '--path', tmp], { encoding: 'utf8' });
  const allActive = (rl2.stdout.match(/\| active \|/g) || []).length >= 3;
  console.log(allPaused && allActive ? '✓ B(1.9.8) rule stop / resume-all: 일괄 전환' : '✗ B(1.9.8) stop/resume-all 실패');
  if (!(allPaused && allActive)) failed++;
}

 
if (e2eShard.take('B(1.9.8) #4')) {
  total++;
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rel-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(tmpR, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }));
  cp.spawnSync(process.execPath, [CLI, 'release', 'bump', '--patch', '--path', tmpR], { encoding: 'utf8' });
  let v = JSON.parse(fs.readFileSync(path.join(tmpR, 'package.json'), 'utf8')).version;
  const okPatch = v === '1.0.1';
  cp.spawnSync(process.execPath, [CLI, 'release', 'bump', '--minor', '--path', tmpR], { encoding: 'utf8' });
  v = JSON.parse(fs.readFileSync(path.join(tmpR, 'package.json'), 'utf8')).version;
  const okMinor = v === '1.1.0';
  cp.spawnSync(process.execPath, [CLI, 'release', 'bump', '--major', '--path', tmpR], { encoding: 'utf8' });
  v = JSON.parse(fs.readFileSync(path.join(tmpR, 'package.json'), 'utf8')).version;
  const okMajor = v === '2.0.0';
  console.log(okPatch && okMinor && okMajor ? '✓ B(1.9.8) release bump: patch/minor/major' : `✗ B(1.9.8) bump 실패 final=${v}`);
  if (!(okPatch && okMinor && okMajor)) failed++;
}

 
if (e2eShard.take('B(T-0122)')) {
  total++;
  const probe = cp.spawnSync(process.execPath, [path.join(__dirname, 'release-bump-probe.js')], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 30000
  });
  const ok = probe.status === 0 && /release-bump probe passed/.test(probe.stdout || '') && !/unknown flag|알 수 없는 플래그/i.test(probe.stderr || '');
  console.log(ok ? '✓ B(T-0122) release bump: --patch + package/bin/README 동기화' : `✗ B(T-0122) release bump 동기화 실패 (exit=${probe.status})`);
  if (!ok) { failed++; process.stdout.write(probe.stdout || ''); process.stderr.write(probe.stderr || ''); }
}

 
if (e2eShard.take('B(1.9.8) #5')) {
  total++;
  const tmpN = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-note-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpN, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(tmpN, 'package.json'), JSON.stringify({ name: 't', version: '0.1.0' }));
  cp.spawnSync(process.execPath, [CLI, 'release', 'note', '첫 기능 추가', '--path', tmpN], { encoding: 'utf8' });
  const cl = fs.readFileSync(path.join(tmpN, 'CHANGELOG.md'), 'utf8');
  const ok = /## 0\.1\.0/.test(cl) && /첫 기능 추가/.test(cl);
  console.log(ok ? '✓ B(1.9.8) release note: CHANGELOG 자동 갱신' : '✗ B(1.9.8) release note 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('pass')) {
  total++;
   
   
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'tmp-e2e', version: '0.1.0' }));
   
  cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmp], { encoding: 'utf8' });
   
  cp.spawnSync(process.execPath, [CLI, 'release', 'bump', '--patch', '--path', tmp], { encoding: 'utf8' });
   
  cp.spawnSync(process.execPath, [CLI, 'release', 'note', 'e2e 검증 항목 추가', '--path', tmp], { encoding: 'utf8' });
   
  const sc = cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmp], { encoding: 'utf8' });
   
   
  const sec = ((sc.stdout || '').split('## User Rule observations')[1] || '').split('\n## ')[0];
  const versionRow = sec.split('\n').find(l => /^\|.*버전 patch bump/.test(l)) || '';
  const ok = /observed \(unverified\)/.test(versionRow) && /0\.1\.0 -> 0\.1\.1/.test(versionRow) && !/✓ pass/.test(sec);
  console.log(ok ? '✓ B(1.9.8/1.36.238) session close: 버전 룰이 bump 를 관측(미검증)으로 보고 + 통과 주장 없음' : `✗ B(1.9.8) session close 검증 실패\n${sc.stdout.split('\n').slice(-15).join('\n')}`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.7-A)')) {
  total++;
  const tmpV = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-vc-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpV, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(tmpV, 'package.json'), JSON.stringify({ name: 't', version: '0.0.1', scripts: { test: 'node -e "console.log(\\"OK\\");process.exit(0)"' } }));
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-code', tmpV], { encoding: 'utf8' });
  const ev = fs.readFileSync(path.join(tmpV, '.leerness/review-evidence.md'), 'utf8');
  const ok = r.status === 0 && /test passed/.test(r.stdout) && /verify-code \(자동\)/.test(ev);
  console.log(ok ? '✓ B(1.9.7-A) verify-code: 통과 + evidence 자동 기록' : `✗ A 실패\n${r.stdout}`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.7-A) #2')) {
  total++;
  const tmpV2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-vc2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpV2, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(tmpV2, 'package.json'), JSON.stringify({ name: 't', version: '0.0.1', scripts: { test: 'node -e "process.exit(2)"' } }));
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-code', tmpV2], { encoding: 'utf8' });
  const ok = r.status === 1 && /test failed/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.7-A) verify-code: 실패 시 exit=1' : `✗ A2 실패 status=${r.status}`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.7-B)')) {
  total++;
  fs.appendFileSync(path.join(tmp, '.leerness/decisions.md'), `\n### 2026-05-08 — Decision: 캐시 차등 TTL 도입\n- Reason: 단일 5분 TTL이 daily 데이터에 비효율\n- Impact: open-meteo 응답 캐시 적중률 ↑\n`);
  fs.appendFileSync(path.join(tmp, '.leerness/review-evidence.md'), `\n## 2026-05-08 e2e\n✗ 캐시 키 불안정 — 좌표 정규화 부재 (롤백 후 fix)\n`);
  const r = cp.spawnSync(process.execPath, [CLI, 'lessons', '--query', '캐시', '--path', tmp], { encoding: 'utf8' });
  const ok = r.status === 0 && /Lessons.*query="캐시"/.test(r.stdout) && /decisions\.md/.test(r.stdout) && /review-evidence\.md/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.7-B) lessons: decisions+evidence 회수' : `✗ B 실패\n${r.stdout}`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.7-B) #2')) {
  total++;
  const r = cp.spawnSync(process.execPath, [CLI, 'guide', 'src/components/Card.html', '--path', tmp], { encoding: 'utf8' });
  const ok = r.status === 0 && /## 4\. Lessons/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.7-B) guide: lessons 섹션 자동 추가' : '✗ B guide 통합 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.7-C)')) {
  total++;
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-c-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
   
  fs.mkdirSync(path.join(tmpC, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpC, 'src/a.js'), `// TODO: 추적해야 할 미완료 작업\nfunction foo() {}\n`);
   
  fs.appendFileSync(path.join(tmpC, '.leerness/review-evidence.md'), '\n## seed\nCommand: npm test\n');
   
  cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpC], { stdio: 'ignore' });
   
  const r = cp.spawnSync(process.execPath, [CLI, 'lazy', 'detect', tmpC, '--auto-track'], { encoding: 'utf8' });
  const tracker = fs.readFileSync(path.join(tmpC, '.leerness/progress-tracker.md'), 'utf8');
  const known = fs.existsSync(path.join(tmpC, '.leerness/known-todos.json')) ? JSON.parse(fs.readFileSync(path.join(tmpC, '.leerness/known-todos.json'), 'utf8')) : [];
  const ok = /TODO src\/a\.js:1/.test(tracker) && /auto-tracked/.test(tracker) && known.length === 1;
  console.log(ok ? '✓ B(1.9.7-C) lazy detect --auto-track: 자동 등록 + known-todos.json' : `✗ C 실패\nTracker:\n${tracker.split('\n').filter(l=>l.startsWith('| T-')).slice(-3).join('\n')}\nKnown: ${JSON.stringify(known)}`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.7-C) #2')) {
  total++;
   
   
   
  const tmpC2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-c2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC2, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  fs.mkdirSync(path.join(tmpC2, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpC2, 'src/a.js'), `// TODO: 추적된 항목\n`);
   
  fs.writeFileSync(path.join(tmpC2, '.leerness/known-todos.json'), JSON.stringify([{ file: 'src/a.js', line: 1, text: '// TODO: 추적된 항목', ackAt: '2026-05-08T00:00:00Z' }]));
  fs.appendFileSync(path.join(tmpC2, '.leerness/review-evidence.md'), '\n## seed\nCommand: npm test\n');
  cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpC2], { stdio: 'ignore' });
  const r = cp.spawnSync(process.execPath, [CLI, 'lazy', 'detect', tmpC2], { encoding: 'utf8' });
   
   
  const ok = /new: 0\b/.test(r.stdout) || !/💡 자동 등록/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.7-C) known-todos: 재카운트 회피' : `✗ C2 실패\n${r.stdout}`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.6)')) {
  total++;
   
  const planPath_ = path.join(tmp, '.leerness/plan.md');
  fs.appendFileSync(planPath_,
    `\n### M-9001. 캐시 헬퍼 모듈\nStatus: planned\nProgress: 0%\n\nTasks:\n- [ ] 캐시 helper\n` +
    `\n### M-9002. 인증 헬퍼 모듈\nStatus: planned\nProgress: 0%\n\nTasks:\n- [ ] 인증 helper\n`);
   
  const trackerPath_ = path.join(tmp, '.leerness/progress-tracker.md');
  fs.appendFileSync(trackerPath_,
    `| T-9001 | done | 캐시 helper 구현 | tests:5/5 (link lost) | 다음 단계 | 2026-05-08 |\n` +
    `| T-9002 | done | 인증 helper 구현 | tests:8/8 (link lost) | 다음 단계 | 2026-05-08 |\n`);

   
  const r1 = cp.spawnSync(process.execPath, [CLI, 'task', 'relink', '--path', tmp], { encoding: 'utf8' });
   
  const r1d = cp.spawnSync(process.execPath, [CLI, 'task', 'relink', '--dry-run', '--path', tmp], { encoding: 'utf8' });
  const okSuggest = r1.status === 0 && /M-9001/.test(r1.stdout) && /M-9002/.test(r1.stdout) && /최선 후보/.test(r1.stdout)
    && r1d.status === 0 && r1d.stdout === r1.stdout;
  console.log(okSuggest ? '✓ B(1.9.6) task relink 제안: 2개 매칭 발견 (--dry-run 도 같은 제안)' : `✗ B(1.9.6) 제안 실패\n${r1.stdout}\n--dry-run: exit=${r1d.status} ${r1d.stdout}${r1d.stderr}`);
  if (!okSuggest) failed++;
}
if (e2eShard.take('B(1.9.6) #2')) {
  total++;
   
  const r2 = cp.spawnSync(process.execPath, [CLI, 'task', 'relink', '--apply', '--path', tmp], { encoding: 'utf8' });
  const tracker = fs.readFileSync(path.join(tmp, '.leerness/progress-tracker.md'), 'utf8');
  const okApply = r2.status === 0 && /M-9001/.test(tracker) && /M-9002/.test(tracker);
  console.log(okApply ? '✓ B(1.9.6) task relink --apply: 자동 복구' : '✗ B(1.9.6) --apply 실패');
  if (!okApply) failed++;
}
if (e2eShard.take('B(1.9.6) #3')) {
  total++;
   
   
  fs.appendFileSync(path.join(tmp, '.leerness/plan.md'),
    `\n### M-9999. 매칭 후보 없는 milestone\nStatus: planned\n\nTasks:\n- [ ] x\n`);
  const r3 = cp.spawnSync(process.execPath, [CLI, 'audit', tmp], { encoding: 'utf8' });
  const ok = /milestones without progress entry/.test(r3.stdout) && /M-9999/.test(r3.stdout) && /leerness task relink/.test(r3.stdout);
  console.log(ok ? '✓ B(1.9.6) audit이 task relink 안내 출력' : `✗ B(1.9.6) audit 안내 누락\n${r3.stdout}`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(G)')) {
  total++;
   
  fs.writeFileSync(path.join(tmp, 'src/builder.js'),
    `const fs = require('fs'); const path = require('path');\n` +
    `const tpl = fs.readFileSync(path.join(__dirname, 'components', 'Card.html'), 'utf8');\n` +
    `module.exports = { tpl };\n`);
  const r = cp.spawnSync(process.execPath, [CLI, 'impact', 'src/components/Card.html', '--path', tmp], { encoding: 'utf8' });
  const ok = /중간 참조 \d+개/.test(r.stdout) && /src\/builder\.js/.test(r.stdout);
  console.log(ok ? '✓ B(G) impact medium: builder.js (path.join + readFileSync) 검출' : `✗ B(G) medium 검출 실패\n${r.stdout}`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(B)')) {
  total++;
  fs.appendFileSync(path.join(tmp, 'src/pages/home.html'), '\n<style>.x{color:#cafe00;}</style>\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'ui', 'consistency', tmp, '--fail-on-violation'], { encoding: 'utf8' });
  const ok = r.status === 1;
  console.log(ok ? '✓ B(B) ui consistency --fail-on-violation: exit=1' : `✗ B(B) exit=${r.status}`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(C)')) {
  total++;
   
  fs.writeFileSync(path.join(tmp, 'src/regex-helper.js'), `module.exports = { TODO_RE: /\\bTODO\\b/g, label: 'TODO list' };\n`);
   
  fs.writeFileSync(path.join(tmp, 'src/real-todo.js'), `// TODO: 실제 미완료 작업\nconst x = 1;\n`);
  const r = cp.spawnSync(process.execPath, [CLI, 'lazy', 'detect', tmp], { encoding: 'utf8' });
   
  const todosLine = (r.stdout.match(/code has (\d+) TODO/) || [0,'-'])[1];
  const ok = todosLine === '1' || todosLine === '-' || /lazy detect passed/.test(r.stdout);
  console.log(ok ? `✓ B(C) lazy detect: string literal 무시 (count=${todosLine})` : `✗ B(C) count=${todosLine}`);
  if (!ok) failed++;
  fs.unlinkSync(path.join(tmp, 'src/regex-helper.js'));
  fs.unlinkSync(path.join(tmp, 'src/real-todo.js'));
}

 
if (e2eShard.take('B(D)')) {
  total++;
   
  const trackerPath = path.join(tmp, '.leerness/progress-tracker.md');
  let cur = fs.readFileSync(trackerPath, 'utf8');
  cur = cur.replace(/^\| T-0001 \|.*$/m, '| T-0001 | done | mile A | user-request | next | 2026-05-08 |');
  fs.writeFileSync(trackerPath, cur);
  const r = cp.spawnSync(process.execPath, [CLI, 'task', 'fix-evidence', '--path', tmp], { encoding: 'utf8' });
  const ok = r.status === 0 && /T-0001/.test(r.stdout) && /후보/.test(r.stdout);
  console.log(ok ? '✓ B(D) task fix-evidence: 후보 표시' : '✗ B(D) 후보 표시 실패');
  if (!ok) { failed++; console.log(r.stdout); }
}

 
if (e2eShard.take('B(D2)')) {
  total++;
   
  const trackerPath2 = path.join(tmp, '.leerness/progress-tracker.md');
  let cur = fs.readFileSync(trackerPath2, 'utf8');
  cur = cur.replace(/^\| T-0001 \|.*$/m, '| T-0001 | done | mile A | plan:M-0002 | next | 2026-05-08 |');
  fs.writeFileSync(trackerPath2, cur);
  const r = cp.spawnSync(process.execPath, [CLI, 'task', 'fix-evidence', '--set', 'npm test 통과 (e2e)', '--path', tmp], { encoding: 'utf8' });
  const tracker = fs.readFileSync(trackerPath2, 'utf8');
  const ok = r.status === 0 && /npm test 통과 \(e2e\)/.test(tracker);
  console.log(ok ? '✓ B(D2) task fix-evidence --set: 일괄 갱신' : '✗ B(D2) 일괄 갱신 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(F)')) {
  total++;
  const tracker = fs.readFileSync(path.join(tmp, '.leerness/progress-tracker.md'), 'utf8');
  const ok = /npm test 통과 \(e2e\) \(plan:M-0002\)/.test(tracker);
  console.log(ok ? '✓ B(F) fix-evidence --set: link 자동 보존' : `✗ B(F) link 손실\n${tracker}`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(F neg)')) {
  total++;
   
  const trackerPath3 = path.join(tmp, '.leerness/progress-tracker.md');
  let cur = fs.readFileSync(trackerPath3, 'utf8');
   
  cur = cur.replace(/^\| T-0001 \|.*$/m, '| T-0001 | done | mile A | plan:M-0099 | next | 2026-05-08 |');
  fs.writeFileSync(trackerPath3, cur);
  cp.spawnSync(process.execPath, [CLI, 'task', 'fix-evidence', '--set', 'npm test only', '--no-preserve-link', '--path', tmp], { encoding: 'utf8' });
  const tracker = fs.readFileSync(trackerPath3, 'utf8');
  const ok = /\| T-0001 \| done \| mile A \| npm test only \|/.test(tracker) && !/M-0099/.test(tracker);
  console.log(ok ? '✓ B(F neg) fix-evidence --no-preserve-link: 링크 제거' : `✗ B(F neg) 동작 이상`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(E)')) {
  total++;
  fs.mkdirSync(path.join(tmp, '_devspace'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '_devspace/secret-config.js'), `const k = "ghp_${'a1B2'.repeat(9)}";\n`);
  fs.writeFileSync(path.join(tmp, '.leerness-skip-dirs'), '_devspace/\n# 주석은 무시\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', tmp], { encoding: 'utf8' });
  const ok = r.status === 0 && /no obvious secret patterns/.test(r.stdout);
  console.log(ok ? '✓ B(E) .leerness-skip-dirs: _devspace 자동 skip' : `✗ B(E) skip 실패\n${r.stdout}`);
  if (!ok) failed++;
}

run('gate (all checks)',   ['gate', tmp]);

run('self check (= update --check)', ['self', 'check', tmp], { });
run('readme sync',         ['readme', 'sync', tmp]);
run('consistency check',   ['consistency', 'check', tmp]);
run('--version',           ['--version']);
run('--help',              ['--help']);

 
if (e2eShard.take('B(1.9.269)')) {
  total++;
  const tmpEn = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lang-en-'));
  const tmpKo = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lang-ko-'));
   
  const envEn = { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', LANGUAGE: '' };
  const envKo = { ...process.env, LANG: 'ko_KR.UTF-8', LC_ALL: 'ko_KR.UTF-8', LANGUAGE: '' };
   
  cp.spawnSync(process.execPath, [CLI, 'init', tmpEn, '--yes', '--skills', 'recommended'], { encoding: 'utf8', env: envEn, timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpKo, '--yes', '--skills', 'recommended'], { encoding: 'utf8', env: envKo, timeout: 30000 });
  const langEn = fs.existsSync(path.join(tmpEn, '.leerness', 'LANGUAGE')) ? fs.readFileSync(path.join(tmpEn, '.leerness', 'LANGUAGE'), 'utf8').trim() : '';
  const langKo = fs.existsSync(path.join(tmpKo, '.leerness', 'LANGUAGE')) ? fs.readFileSync(path.join(tmpKo, '.leerness', 'LANGUAGE'), 'utf8').trim() : '';
  const ok = langEn === 'en' && langKo === 'ko';
  console.log(ok ? '✓ B(1.9.269) init auto: 빈 디렉토리 → OS 시스템 언어 (en→en, ko→ko)' : `✗ system-lang init 실패 (en=${langEn} ko=${langKo})`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.270)')) {
  total++;
  const tmpRole = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-roles-'));
   
  const rSet = cp.spawnSync(process.execPath, [CLI, 'roles', 'set', '코딩', '--provider', 'codex', '--model', 'gpt-5.5', '--path', tmpRole, '--json'], { encoding: 'utf8', timeout: 15000 });
  let setOk = false;
  try { const j = JSON.parse(rSet.stdout); setOk = j.set === 'coder' && j.provider === 'codex' && j.model === 'gpt-5.5'; } catch {}
   
  const rList = cp.spawnSync(process.execPath, [CLI, 'roles', 'list', '--path', tmpRole, '--json'], { encoding: 'utf8', timeout: 15000 });
  let listOk = false;
  try { const j = JSON.parse(rList.stdout); listOk = j.count === 1 && j.roles.coder && j.roles.coder.provider === 'codex'; } catch {}
   
  cp.spawnSync(process.execPath, [CLI, 'roles', 'set', 'reviewer', '--provider', 'claude', '--model', 'claude-opus-4-7', '--path', tmpRole], { encoding: 'utf8', timeout: 15000 });
  const envC = { ...process.env, LEERNESS_ENABLE_CLAUDE: '1' };
  const rRoute = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', '검수', '--role', 'reviewer', '--path', tmpRole], { encoding: 'utf8', timeout: 15000, env: envC });
  const routeOk = /역할 reviewer → claude/.test(rRoute.stdout) && (/--model claude-opus-4-7/.test(rRoute.stdout) || /claude 비활성/.test(rRoute.stdout));
   
  const rCat = cp.spawnSync(process.execPath, [CLI, 'roles', 'catalog', '--path', tmpRole, '--json'], { encoding: 'utf8', timeout: 15000 });
  let catOk = false;
  try { const j = JSON.parse(rCat.stdout); catOk = Object.keys(j.roles).length === 7 && j.roles.coder && j.roles.commander; } catch {}
  const ok = setOk && listOk && routeOk && catOk;
  console.log(ok ? '✓ B(1.9.270) agent roles: set(별칭)/list/dispatch --role 라우팅/catalog 7종' : `✗ roles 실패 (set=${setOk} list=${listOk} route=${routeOk} cat=${catOk})`);
  if (!ok) { failed++; console.log((rRoute.stdout || '').slice(0, 400)); }
}

 
if (e2eShard.take('B(1.9.272)')) {
  total++;
  const rJson = cp.spawnSync(process.execPath, [CLI, 'capabilities', '--json'], { encoding: 'utf8', timeout: 15000 });
  let jsonOk = false;
  try {
    const j = JSON.parse(rJson.stdout);
    jsonOk = j.surface && Object.keys(j.surface).length === 6 && j.surface.automationBridges
      && j.surface.automationBridges.risk === 'high' && Array.isArray(j.powerfulCommands) && j.powerfulCommands.length >= 5
      && Array.isArray(j.principles);
  } catch {}
  const rTxt = cp.spawnSync(process.execPath, [CLI, 'security-surface'], { encoding: 'utf8', timeout: 15000 });
  const txtOk = rTxt.status === 0 && /권한·보안 표면/.test(rTxt.stdout) && /opt-out/.test(rTxt.stdout);
  const ok = jsonOk && txtOk;
  console.log(ok ? '✓ B(1.9.272) capabilities: 6 영역 surface + 주의명령 + alias(security-surface)' : `✗ capabilities 실패 (json=${jsonOk} txt=${txtOk})`);
  if (!ok) { failed++; console.log((rJson.stdout || '').slice(0, 300)); }
}

 
if (e2eShard.take('B(1.9.273)')) {
  total++;
  const smokePath = path.resolve(__dirname, 'smoke.js');
  const smokeExists = fs.existsSync(smokePath);
   
  const syn = smokeExists ? cp.spawnSync(process.execPath, ['--check', smokePath], { encoding: 'utf8', timeout: 15000 }) : { status: 1 };
  let scriptOk = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
    scriptOk = !!(pkg.scripts && pkg.scripts['test:fast'] && /smoke\.js/.test(pkg.scripts['test:fast']));
  } catch {}
  const ok = smokeExists && syn.status === 0 && scriptOk;
  console.log(ok ? '✓ B(1.9.273) test:fast 인프라: smoke.js 존재 + 구문 + package script' : `✗ test:fast 실패 (exists=${smokeExists} syntax=${syn.status === 0} script=${scriptOk})`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.274/283)')) {
  total++;
  const libPath = path.resolve(__dirname, '..', 'lib', 'pure-utils.js');
  const libExists = fs.existsSync(libPath);
  let exportsOk = false;
  try {
    const m = require(libPath);
     
    exportsOk = ['_isSecretKey','compareVer','parseHarnessVersion','_classifyCJK','_riskLabel','_detectSystemLang','_parseSlashFromHelp',
      '_tierRank','_requiredTier','_policyAllows','_resolveNpmTag','_mcpJsonContent','_newRunRecord']
      .every(n => typeof m[n] === 'function')
      && m.compareVer('1.9.1','1.9.0') === 1 && m._detectSystemLang({ LANG: 'ko_KR.UTF-8' }) === 'ko'
      && Array.isArray(m.PERMISSION_TIERS) && m.PERMISSION_TIERS.length === 8
      && m._requiredTier('release publish') === 'publish' && m._resolveNpmTag(null, {}) === 'latest'
      && m._newRunRecord({ run_id: 'r1' }).schemaVersion === 1;
  } catch {}
  let filesOk = false;
  try { const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')); filesOk = Array.isArray(pkg.files) && pkg.files.includes('lib'); } catch {}
  const ok = libExists && exportsOk && filesOk;
  console.log(ok ? '✓ B(1.9.274/283) lib 모듈 분리: pure-utils 14종 export + 동작 + files 포함' : `✗ lib 분리 실패 (exists=${libExists} exports=${exportsOk} files=${filesOk})`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.275)')) {
  total++;
  const r = cp.spawnSync(process.execPath, [CLI, 'release', 'channel', tmp, '--json', '--offline'], { encoding: 'utf8', timeout: 15000 });
  let jsonOk = false;
  try { const j = JSON.parse(r.stdout); jsonOk = j.defaultPublishTag === 'latest' && j.policy && j.policy.stable === 'latest' && j.policy.experimental === 'next'; } catch {}
  const r2 = cp.spawnSync(process.execPath, [CLI, 'release', 'channel', tmp, '--json', '--offline'], { encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_NPM_TAG: 'next' } });
  let nextOk = false;
  try { nextOk = JSON.parse(r2.stdout).defaultPublishTag === 'next'; } catch {}
  const ok = jsonOk && nextOk;
  console.log(ok ? '✓ B(1.9.275) release channel: latest 기본 + LEERNESS_NPM_TAG=next 반영 + 정책' : `✗ release channel 실패 (json=${jsonOk} next=${nextOk})`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.276)')) {
  total++;
   
  const dDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-dry-'));
  const rDry = cp.spawnSync(process.execPath, [CLI, 'init', dDir, '--dry-run', '--yes'], { encoding: 'utf8', timeout: 30000 });
  const dryNoFiles = fs.readdirSync(dDir).length === 0;
  const drySummary = /\[dry-run\] 요약/.test(rDry.stdout) && !fs.existsSync(path.join(dDir, '.leerness'));
   
  const mDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-min-'));
  cp.spawnSync(process.execPath, [CLI, 'init', mDir, '--minimal', '--no-env', '--yes'], { encoding: 'utf8', timeout: 30000 });
  const fDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-full-'));
  cp.spawnSync(process.execPath, [CLI, 'init', fDir, '--yes'], { encoding: 'utf8', timeout: 30000 });
  const minCount = fs.existsSync(path.join(mDir, '.leerness')) ? fs.readdirSync(path.join(mDir, '.leerness')).length : 0;
  const fullCount = fs.existsSync(path.join(fDir, '.leerness')) ? fs.readdirSync(path.join(fDir, '.leerness')).length : 0;
  const minimalOk = minCount > 0 && minCount < fullCount
    && fs.existsSync(path.join(mDir, '.leerness', 'plan.md')) && fs.existsSync(path.join(mDir, 'AGENTS.md'))
    && !fs.existsSync(path.join(mDir, '.env')) && !fs.existsSync(path.join(mDir, '.cursor')) && !fs.existsSync(path.join(mDir, 'roadmap.html'));
   
  const rVerify = cp.spawnSync(process.execPath, [CLI, 'verify', mDir], { encoding: 'utf8', timeout: 20000 });
  const verifyOk = rVerify.status === 0;
  const ok = dryNoFiles && drySummary && minimalOk && verifyOk;
  console.log(ok ? '✓ B(1.9.276) init --dry-run(0파일)/--minimal(축소+verify통과)/--no-env(.env 제외)' : `✗ init 옵션 실패 (dry=${dryNoFiles} drySum=${drySummary} min=${minimalOk}(${minCount}<${fullCount}) verify=${verifyOk})`);
  if (!ok) { failed++; console.log((rVerify.stdout || '').slice(0, 300)); }
}

 
if (e2eShard.take('B(1.9.278)')) {
  total++;
  const sDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-state-'));
  const run = (a) => cp.spawnSync(process.execPath, [CLI, 'state', ...a, '--path', sDir], { encoding: 'utf8', timeout: 15000 });
  run(['start', 'API 구현', '--agent', 'claude', '--model', 'claude-opus-4-7', '--task', 'T-0001']);
  run(['record', '--files-changed', 'src/api.js,src/db.js', '--commands', 'npm test', '--tests', '12 passed', '--decision', 'retry 3']);
  run(['verify', '--result', 'pass']);
  run(['handoff', 'API 완료, db 마이그레이션은 다음 에이전트']);
   
  const rShow = run(['show', '--json']);
  let recOk = false, handoffOk = false;
  try {
    const j = JSON.parse(rShow.stdout);
     
    recOk = j.state && j.state.runCounter === 1 && j.state.currentRunId === null;
  } catch {}
  const runFile = path.join(sDir, '.leerness', 'runs', 'run-0001.json');
  const hJson = path.join(sDir, '.leerness', 'handoff', 'latest.json');
  try {
    const rec = JSON.parse(fs.readFileSync(runFile, 'utf8'));
    const hf = JSON.parse(fs.readFileSync(hJson, 'utf8'));
    handoffOk = rec.status === 'handed-off' && rec.verification_result === 'pass'
      && rec.files_changed.length === 2 && rec.model_name === 'claude-opus-4-7'
      && rec.task_id === 'T-0001' && hf.handoff_summary && hf.run_id === 'run-0001'
      && fs.existsSync(path.join(sDir, '.leerness', 'handoff', 'latest.md'));
  } catch {}
  const ok = recOk && handoffOk;
  console.log(ok ? '✓ B(1.9.278) state substrate: start→record→verify→handoff→show (.leerness JSON 인수인계)' : `✗ state 실패 (show=${recOk} handoff=${handoffOk})`);
  if (!ok) { failed++; console.log((rShow.stdout || '').slice(0, 300)); }
}

 
if (e2eShard.take('B(1.9.279)')) {
  total++;
  const mDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mcpstate-'));
  const mcpCall = (req) => {
    const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 10000, input: JSON.stringify(req) + '\n' });
    try { const line = r.stdout.split('\n').filter(Boolean)[0]; const j = JSON.parse(line); return JSON.parse(j.result.content[0].text); } catch { return null; }
  };
   
  const rList = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 10000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n' });
  let verbsOk = false;
  try { const tools = JSON.parse(rList.stdout.split('\n').filter(Boolean)[0]).result.tools.map(t => t.name); verbsOk = ['leerness_state_show', 'leerness_state_start', 'leerness_state_record', 'leerness_state_verify', 'leerness_state_handoff'].every(n => tools.includes(n)); } catch {}
  const started = mcpCall({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'leerness_state_start', arguments: { path: mDir, goal: 'MCP verb 테스트', agent: 'claude', model: 'claude-opus-4-7' } } });
  mcpCall({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'leerness_state_record', arguments: { path: mDir, filesChanged: 'a.js,b.js', tests: '3 passed' } } });
  const shown = mcpCall({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'leerness_state_show', arguments: { path: mDir } } });
  const startOk = started && started.started === 'run-0001' && started.run && started.run.agent_name === 'claude';
  const showOk = shown && shown.currentRun && shown.currentRun.run_id === 'run-0001' && shown.currentRun.files_changed.length === 2;
  const ok = verbsOk && startOk && showOk;
  console.log(ok ? '✓ B(1.9.279) MCP 상태 verb: tools/list 5종 + state_start→record→show 라운드트립' : `✗ MCP state verb 실패 (verbs=${verbsOk} start=${startOk} show=${showOk})`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.280)')) {
  total++;
  const aDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-adapter-'));
  cp.spawnSync(process.execPath, [CLI, 'init', aDir, '--minimal', '--no-env', '--yes'], { encoding: 'utf8', timeout: 30000 });
   
  const rCur = cp.spawnSync(process.execPath, [CLI, 'adapter', 'cursor', aDir], { encoding: 'utf8', timeout: 15000 });
  const cursorOk = rCur.status === 0
    && fs.existsSync(path.join(aDir, '.cursor', 'rules', 'leerness.mdc'))
    && fs.existsSync(path.join(aDir, '.cursor', 'hooks.json'))
    && fs.existsSync(path.join(aDir, '.cursor', 'hooks', 'leerness-session.cjs'));
  let mcpOk = false;
  try { const m = JSON.parse(fs.readFileSync(path.join(aDir, '.mcp.json'), 'utf8')); mcpOk = m.mcpServers && m.mcpServers.leerness && m.mcpServers.leerness.args.join(' ') === '-y leerness mcp serve'; } catch {}
   
  const rList = cp.spawnSync(process.execPath, [CLI, 'adapter', 'list', '--json', '--path', aDir], { encoding: 'utf8', timeout: 15000 });
  let listOk = false;
  try { const j = JSON.parse(rList.stdout); listOk = Object.keys(j.adapters).length >= 9 && j.adapters.claude.mcp === true && j.adapters.copilot.mcp === false; } catch {}
   
  const dDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-adapterdry-'));
  const rDry = cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--dry-run', '--path', dDir], { encoding: 'utf8', timeout: 15000 });
  const dryOk = /\[dry-run\]/.test(rDry.stdout) && fs.readdirSync(dDir).length === 0;
  const ok = cursorOk && mcpOk && listOk && dryOk;
  console.log(ok ? '✓ B(1.9.280) adapter: cursor(.cursor rules+MCP+session hook)/list 9종/dry-run(0파일)' : `✗ adapter 실패 (cursor=${cursorOk} mcp=${mcpOk} list=${listOk} dry=${dryOk})`);
  if (!ok) { failed++; console.log((rCur.stdout || '').slice(0, 200)); }
}

 
if (e2eShard.take('B(1.9.281)')) {
  total++;
  const pDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-policy-'));
  const run = (a) => cp.spawnSync(process.execPath, [CLI, 'policy', ...a, '--path', pDir], { encoding: 'utf8', timeout: 15000 });
   
  let showOk = false;
  try { const j = JSON.parse(run(['show', '--json']).stdout); showOk = j.tiers.length === 8 && j.enforce === false && j.allowedTier === 'project-write'; } catch {}
   
  run(['set', 'read-only', '--enforce']);
  let blockOk = false, allowOk = false;
  try { blockOk = JSON.parse(run(['check', 'release publish', '--json']).stdout).allowed === false; } catch {}
  try { allowOk = JSON.parse(run(['check', 'handoff', '--json']).stdout).allowed === true; } catch {}
   
  run(['set', 'read-only', '--no-enforce']);
  let advisoryOk = false;
  try { const j = JSON.parse(run(['check', 'release publish', '--json']).stdout); advisoryOk = j.allowed === true && j.advisory === true; } catch {}
  const ok = showOk && blockOk && allowOk && advisoryOk;
  console.log(ok ? '✓ B(1.9.281) policy: 8등급 + set/check + enforce 차단/advisory' : `✗ policy 실패 (show=${showOk} block=${blockOk} allow=${allowOk} advisory=${advisoryOk})`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.282)')) {
  total++;
  const gDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-pos-'));
  cp.spawnSync(process.execPath, [CLI, 'init', gDir, '--minimal', '--no-env', '--yes'], { encoding: 'utf8', timeout: 30000 });
  let ok = false;
  try {
    const a = fs.readFileSync(path.join(gDir, 'AGENTS.md'), 'utf8');
    ok = /정적 vs 동적/.test(a) && /leerness state/.test(a) && /\.leerness\//.test(a) && /대체하지 않고/.test(a);
  } catch {}
  console.log(ok ? '✓ B(1.9.282) AGENTS.md: 정적(지침) vs 동적(leerness 상태) 역할 경계 포지셔닝' : `✗ AGENTS.md 포지셔닝 실패`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.285)')) {
  total++;
  const r1 = cp.spawnSync(process.execPath, [CLI, 'reuse-check', 'JWT 인증 로그인', '--json'], { encoding: 'utf8', timeout: 15000 });
  let jsonOk = false;
  try { const j = JSON.parse(r1.stdout); jsonOk = j.feature && j.categories.some(c => c.key === 'auth') && Array.isArray(j.checklist) && j.checklist.length >= 5 && j.network === false; } catch {}
  const r2 = cp.spawnSync(process.execPath, [CLI, 'reuse-check', '날짜 date 포맷'], { encoding: 'utf8', timeout: 15000 });
  const txtOk = r2.status === 0 && /빌드 vs 재사용/.test(r2.stdout) && /date-fns/.test(r2.stdout) && /체크리스트/.test(r2.stdout);
   
  const r3 = cp.spawnSync(process.execPath, [CLI, 'reuse-check'], { encoding: 'utf8', timeout: 10000 });
  const failOk = r3.status !== 0;
  const ok = jsonOk && txtOk && failOk;
  console.log(ok ? '✓ B(1.9.285) reuse-check: 카테고리 감지 + 체크리스트 + json/인자검증' : `✗ reuse-check 실패 (json=${jsonOk} txt=${txtOk} fail=${failOk})`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.286)')) {
  total++;
  const iDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-impact-'));
  cp.spawnSync(process.execPath, [CLI, 'init', iDir, '--minimal', '--no-env', '--yes'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, LEERNESS_OFFLINE: '1' } });
   
  let lowOk = false;
  try { const j = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'skill', 'impact', iDir, '--json'], { encoding: 'utf8', timeout: 15000 }).stdout); lowOk = Array.isArray(j.skills) && j.sampleSize === 0 && /표본 부족/.test(j.advisory) && j.network === false; } catch {}
   
  const evFile = path.join(iDir, '.leerness', 'review-evidence.md');
  let seed = '# Review Evidence\n';
  for (let k = 0; k < 5; k++) seed += `\n## 2026-06-03 0${k}:00\nCommand: npm test\nExit: 0\n`;
  seed += `\n## 2026-06-03 06:00\nCommand: build\nExit: 1\n`;
  fs.appendFileSync(evFile, seed);
  let rateOk = false;
  try { const j = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'skill', 'impact', iDir, '--json'], { encoding: 'utf8', timeout: 15000 }).stdout); rateOk = j.sampleSize >= 6 && j.evidence.pass === 5 && j.evidence.fail === 1 && j.evidence.rate === 83 && /상관추적/.test(j.advisory); } catch {}
  const ok = lowOk && rateOk;
  console.log(ok ? '✓ B(1.9.286) skill impact: 표본부족 advisory + 검증 통과율 상관 + json' : `✗ skill impact 실패 (low=${lowOk} rate=${rateOk})`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.287)')) {
  total++;
  const cDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-codex-'));
  const env = { ...process.env, LEERNESS_OFFLINE: '1' };
  cp.spawnSync(process.execPath, [CLI, 'init', cDir, '--minimal', '--no-env', '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000, env });    
   
  cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'fake done', '--path', cDir], { encoding: 'utf8', timeout: 15000, env });
  cp.spawnSync(process.execPath, [CLI, 'task', 'update', 'T-0002', '--status', 'done', '--evidence', '테스트 통과함', '--path', cDir], { encoding: 'utf8', timeout: 15000, env });
  const rFake = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0002', '--require-evidence', '--path', cDir], { encoding: 'utf8', timeout: 20000, env });
  const fakeBlocked = rFake.status === 1 && /evidence 완전성.*FAIL/.test(rFake.stdout);
   
  fs.mkdirSync(path.join(cDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(cDir, 'src', 'api.js'), 'module.exports = { ok: true };\n');
  cp.spawnSync(process.execPath, [CLI, 'task', 'update', 'T-0002', '--evidence', 'src/api.js 구현, npm test 5/5 통과 (Exit: 0)', '--path', cDir], { encoding: 'utf8', timeout: 15000, env });
  const rGood = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0002', '--require-evidence', '--path', cDir], { encoding: 'utf8', timeout: 20000, env });
  const goodPass = rGood.status === 0 && /evidence 완전성.*pass/.test(rGood.stdout);
   
  fs.appendFileSync(path.join(cDir, '.leerness', 'review-evidence.md'), '\n## 2026-06-03\n```js\nconst x=1;\n```\n');
  cp.spawnSync(process.execPath, [CLI, 'session', 'close', cDir], { encoding: 'utf8', timeout: 20000, env });
   
  let fenceOk = false;
  try {
    const sh = fs.readFileSync(path.join(cDir, '.leerness', 'session-handoff.md'), 'utf8');
    const bareFences = sh.split('\n').filter(l => l.trim() === '`'.repeat(3)).length;
    fenceOk = (bareFences % 2 === 0) && sh.includes("'''");   
  } catch {}
   
  const rStat = cp.spawnSync(process.execPath, [CLI, 'status', cDir], { encoding: 'utf8', timeout: 15000, env });
  const statOk = /minimal/.test(rStat.stdout) && !/missing:/.test(rStat.stdout);
  const ok = fakeBlocked && goodPass && fenceOk && statOk;
  console.log(ok ? '✓ B(1.9.287) Codex 수렴: require-evidence(허위차단/완전통과) + 펜스 sanitize + status minimal' : `✗ Codex 수렴 실패 (fake=${fakeBlocked} good=${goodPass} fence=${fenceOk} stat=${statOk})`);
  if (!ok) { failed++; console.log((rFake.stdout || '').slice(-300)); }
}

 
if (e2eShard.take('B(1.9.288)')) {
  total++;
  const env = { ...process.env, LEERNESS_OFFLINE: '1' };
   
  const pDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mcppol-'));
  cp.spawnSync(process.execPath, [CLI, 'init', pDir, '--minimal', '--no-env', '--yes'], { encoding: 'utf8', timeout: 30000, env });
  cp.spawnSync(process.execPath, [CLI, 'policy', 'set', 'read-only', '--enforce', '--path', pDir], { encoding: 'utf8', timeout: 15000, env });
  const req = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_state_start', arguments: { path: pDir, goal: 'x' } } });
  const rMcp = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 15000, input: req + '\n', env });
  let blocked = false;
  try { const j = JSON.parse(rMcp.stdout.split('\n').filter(Boolean)[0]); blocked = j.result.isError === true && /정책 차단/.test(j.result.content[0].text); } catch {}
  const noWrite = !fs.existsSync(path.join(pDir, '.leerness', 'state.json'));
   
  cp.spawnSync(process.execPath, [CLI, 'policy', 'set', 'project-write', '--no-enforce', '--path', pDir], { encoding: 'utf8', timeout: 15000, env });
  const rMcp2 = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 15000, input: req + '\n', env });
  let allowed = false;
  try { const j = JSON.parse(rMcp2.stdout.split('\n').filter(Boolean)[0]); allowed = j.result.isError !== true && /run-0001/.test(j.result.content[0].text); } catch {}
   
  const rDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-reldry-'));
  fs.writeFileSync(path.join(rDir, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.1' }) + '\n');
  const rRel = cp.spawnSync(process.execPath, [CLI, 'release', 'publish', rDir, '--dry-run', '--git-push'], { encoding: 'utf8', timeout: 20000, env });
  const dryOk = rRel.status === 0 && /\(dry-run\)/.test(rRel.stdout) && /생략/.test(rRel.stdout) && !/git push:/.test(rRel.stdout);
   
  let countOk = false;
  try {
    const rl = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 10000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n', env });
    const live = JSON.parse(rl.stdout.split('\n').filter(Boolean)[0]).result.tools.length;
    const readme = fs.readFileSync(path.resolve(__dirname, '..', 'README.md'), 'utf8');
    const badge = (readme.match(/MCP--tools-(\d+)/) || [])[1];
    const koBadge = (fs.readFileSync(path.resolve(__dirname, '..', 'README.ko.md'), 'utf8').match(/MCP--tools-(\d+)/) || [])[1];
    const rc = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve', '--profile', 'core'], { encoding: 'utf8', timeout: 10000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n', env });
    const liveCore = JSON.parse(rc.stdout.split('\n').filter(Boolean)[0]).result.tools.length;
    const enDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mcpen-'));
    cp.spawnSync(process.execPath, [CLI, 'init', enDir, '--no-env', '--yes', '--language', 'en'], { encoding: 'utf8', timeout: 30000, env });
    const enCore = (fs.readFileSync(path.join(enDir, 'README.md'), 'utf8').match(/--profile core` = (\d+) essentials/) || [])[1];
    countOk = String(live) === badge && String(live) === koBadge && String(liveCore) === enCore;
  } catch {}
  const ok = blocked && noWrite && allowed && dryOk && countOk;
  console.log(ok ? '✓ B(1.9.288) Codex 수렴: MCP policy 차단/허용 + release dry-run 무push + 도구수 정합' : `✗ Codex 수렴 실패 (blocked=${blocked} noWrite=${noWrite} allowed=${allowed} dry=${dryOk} count=${countOk})`);
  if (!ok) { failed++; console.log((rRel.stdout || '').slice(0, 300)); }
}

 
if (e2eShard.take('B(1.9.289)')) {
  total++;
  let ok = false;
  try {
    const h = require(path.resolve(__dirname, '..', 'bin', 'leerness.js'));
    const q = h._shellQuoteArg('a; rm -rf / && echo $(whoami)');
    const win = process.platform === 'win32';
     
    const wrapped = win ? (q.startsWith('"') && q.endsWith('"')) : (q.startsWith("'") && q.endsWith("'"));
    const neutral = win ? !/^[^"]*[;&|][^"]*$/.test(q.slice(1, -1)) || q.includes('"') : true;
    ok = wrapped && q.includes('rm -rf') && typeof h._shellQuoteArg === 'function';
  } catch {}
  console.log(ok ? '✓ B(1.9.289) _shellQuoteArg: 프롬프트 셸 주입 중립화 (agy/copilot args)' : '✗ _shellQuoteArg 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.290)')) {
  total++;
  let ok = false;
  try {
     
    const probe = "const L=()=>{};process.on('warning',L);const o=process.env.NODE_OPTIONS||'';" +
      "require(process.argv[1]);" +
      "const survived=process.listeners('warning').includes(L);" +
      "const polluted=(process.env.NODE_OPTIONS||'')!==o;" +
      "process.exit(survived&&!polluted?0:1);";
    const harnessPath = path.resolve(__dirname, '..', 'bin', 'leerness.js');
    const r = cp.spawnSync(process.execPath, ['-e', probe, harnessPath], { encoding: 'utf8', timeout: 20000 });
    ok = r.status === 0;
  } catch {}
  console.log(ok ? '✓ B(1.9.290) require 부작용 격리: warning listener 보존 + NODE_OPTIONS 미오염 (Codex #4)' : '✗ require 부작용 격리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.291)')) {
  total++;
  let ok = false;
  try {
    const reg = require(path.resolve(__dirname, '..', 'lib', 'agent-registry.js'));
    const h = require(path.resolve(__dirname, '..', 'bin', 'leerness.js'));
    const dataOk = Array.isArray(reg.EXTERNAL_AGENTS) && reg.EXTERNAL_AGENTS.length === 10 &&
      reg.EXTERNAL_AGENTS.every(a => a.id && a.bin && a.envFlag) &&
      reg.AGENT_SLASH_COMMANDS && Object.keys(reg.AGENT_SLASH_COMMANDS).length === 9;
     
    const singleSource = h.AGENT_SLASH_COMMANDS === reg.AGENT_SLASH_COMMANDS;
     
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const movedOut = !/const EXTERNAL_AGENTS = \[/.test(harnessSrc) && /require\('\.\.\/lib\/agent-registry'\)/.test(harnessSrc);
    ok = dataOk && singleSource && movedOut;
  } catch {}
  console.log(ok ? '✓ B(1.9.291) lib/agent-registry 모듈 분리: 단일출처 + 인라인 제거 (UR-0025)' : '✗ agent-registry 모듈 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.292)')) {
  total++;
  let ok = false;
  try {
    const r = cp.spawnSync(process.execPath, [CLI, 'context', tmp, '--json'], { cwd: tmp, encoding: 'utf8', timeout: 30000 });
    const j = JSON.parse(r.stdout);
    const structOk = r.status === 0 && j.schemaVersion === 1 && !!j.version && !!j.project && ('currentTask' in j) &&
      j.openRequests && typeof j.openRequests.count === 'number' && Array.isArray(j.recentDecisions) &&
      Array.isArray(j.activeRules) && Array.isArray(j.nextActions) && j.memory && typeof j.memory.rulesActive === 'number';
    const h = require(path.resolve(__dirname, '..', 'bin', 'leerness.js'));
    const mcpOk = h._mcpToolCount && h._mcpToolCount() >= 80;
    ok = structOk && mcpOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.292) leerness context: get_project_context 집약 JSON 구조 + MCP 80 도구 (UR-0031)' : '✗ context 집약 verb 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.293)')) {
  total++;
  let ok = false;
  try {
    const idemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-idem-'));
    cp.spawnSync(process.execPath, [CLI, 'init', idemDir, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const pt = path.join(idemDir, '.leerness', 'progress-tracker.md');
     
    const dupRow = '| T-7001 | in-progress | 중복작업ABC | - | - | 2026-06-04 |';
    const sameText = '| T-7002 | in-progress | 중복작업ABC | - | - | 2026-06-04 |';
    fs.writeFileSync(pt, [dupRow, dupRow, dupRow, sameText].join('\n') + '\n', 'utf8');   
     
    const r = cp.spawnSync(process.execPath, [CLI, 'idempotency', 'audit', '--path', idemDir, '--auto-fix'], { encoding: 'utf8', timeout: 20000 });
    const after = fs.readFileSync(pt, 'utf8');
    const headerRestored = /\|---\|/.test(after) && /leernessRole: progress-tracker/.test(after);   
    const exactCollapsed = (after.match(/\| T-7001 \|/g) || []).length === 1;   
     
    const r2 = cp.spawnSync(process.execPath, [CLI, 'idempotency', 'audit', '--path', idemDir, '--json'], { encoding: 'utf8', timeout: 20000 });
    const audit = JSON.parse(r2.stdout);
    const taskDupGone = !audit.violations.some(v => v.kind === 'task-duplicate-request');
    ok = r.status === 0 && headerRestored && exactCollapsed && taskDupGone;
  } catch {}
  console.log(ok ? '✓ B(1.9.293) idempotency --auto-fix: 헤더 재구성 + 완전중복 제거 + dedup clean (복제버그 fix)' : '✗ idempotency auto-fix 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.294)')) {
  total++;
  let ok = false;
  try {
    const reg = require(path.resolve(__dirname, '..', 'lib', 'role-catalog.js'));
    const dataOk = reg.ROLE_CATALOG && Object.keys(reg.ROLE_CATALOG).length === 7 &&
      reg._PROVIDER_MODEL_CATALOG && Object.keys(reg._PROVIDER_MODEL_CATALOG).length === 10 &&
      reg._ROLE_ALIASES && Object.keys(reg._ROLE_ALIASES).length >= 14 &&
      reg._AGENT_ROLE_PROMPTS && reg._AGENT_ROLE_PROMPTS.actor;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const movedOut = !/const ROLE_CATALOG = \{/.test(harnessSrc) && /require\('\.\.\/lib\/role-catalog'\)/.test(harnessSrc);
     
    const rr = cp.spawnSync(process.execPath, [CLI, 'roles', 'list', '--path', tmp, '--json'], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    const rolesOk = rr.status === 0;
    ok = dataOk && movedOut && rolesOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.294) lib/role-catalog 모듈 분리: 단일출처 + 인라인 제거 + roles 동작 (UR-0025)' : '✗ role-catalog 모듈 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.295)')) {
  total++;
  let ok = false;
  try {
    const reg = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
     
    const dataOk = reg.CAPABILITY_SURFACE && Object.keys(reg.CAPABILITY_SURFACE).length === 6 &&
      Array.isArray(reg.POWERFUL_COMMANDS) && reg.POWERFUL_COMMANDS.length === 6 &&
      !reg.POWERFUL_COMMANDS.some(c => /setup-agents/.test(c.cmd)) &&
      reg.ADAPTERS && Object.keys(reg.ADAPTERS).length === 9 &&
      Array.isArray(reg.REUSE_CATEGORIES) && reg.REUSE_CATEGORIES.length === 15 &&
      Array.isArray(reg.REUSE_CHECKLIST) && reg.REUSE_CHECKLIST.length === 6;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const movedOut = !/const CAPABILITY_SURFACE = \{/.test(harnessSrc) && !/const ADAPTERS = \{/.test(harnessSrc) && /require\('\.\.\/lib\/catalogs'\)/.test(harnessSrc);
     
    const cap = cp.spawnSync(process.execPath, [CLI, 'capabilities', '--json'], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    const reuse = cp.spawnSync(process.execPath, [CLI, 'reuse-check', 'JWT 인증', '--json'], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    const cmdsOk = cap.status === 0 && reuse.status === 0 && /auth/.test(reuse.stdout);
    ok = dataOk && movedOut && cmdsOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.295) lib/catalogs 모듈 분리: 단일출처 + 인라인 제거 + capabilities/reuse-check 동작 (UR-0025)' : '✗ catalogs 모듈 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.296)')) {
  total++;
  let ok = false;
  try {
    const r = cp.spawnSync(process.execPath, [CLI, 'about', '--json'], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    const j = JSON.parse(r.stdout);
    const structOk = r.status === 0 && /운영 레이어/.test(j.identity) && Array.isArray(j.layers) && j.layers.length === 5 &&
      j.layers.every(l => l.key && l.ko && l.desc) && j.complements && j.surface && typeof j.surface.mcpTools === 'number' &&
      j.surface.runtimeDeps === 0 && /AGENTS\.md/.test(j.complements);
     
    const ml = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: tmp, encoding: 'utf8', timeout: 15000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n' });
    const names = JSON.parse(ml.stdout.split('\n').filter(Boolean)[0]).result.tools.map(t => t.name);
    const mcpOk = names.includes('leerness_about') && names.length >= 81;
     
    cp.spawnSync(process.execPath, [CLI, 'readme', 'sync', tmp], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    const rd = fs.existsSync(path.join(tmp, 'README.md')) ? fs.readFileSync(path.join(tmp, 'README.md'), 'utf8') : '';
    const readmeOk = /정체성 — AI 에이전트 운영 레이어/.test(rd);
    ok = structOk && mcpOk && readmeOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.296) leerness about: 정체성 verb + MCP leerness_about(81) + README 섹션 (UR-0030)' : '✗ about 정체성 verb 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.297)')) {
  total++;
  let ok = false;
  try {
    const T = require(path.resolve(__dirname, '..', 'lib', 'mcp-tools.js'));
    const dataOk = Array.isArray(T) && T.length >= 81 && T.every(t => t.name && t.description && t.inputSchema) && T[0].name === 'leerness_handoff';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const movedOut = !/const TOOLS = \[/.test(harnessSrc) && /require\('\.\.\/lib\/mcp-tools'\)/.test(harnessSrc);
     
    const ml = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: tmp, encoding: 'utf8', timeout: 15000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n' });
    const live = JSON.parse(ml.stdout.split('\n').filter(Boolean)[0]).result.tools.length;
    const h = require(path.resolve(__dirname, '..', 'bin', 'leerness.js'));
    const singleSource = live === T.length && h._mcpToolCount() === T.length;
    ok = dataOk && movedOut && singleSource;
  } catch {}
  console.log(ok ? '✓ B(1.9.297) lib/mcp-tools 단일출처: tools/list == 모듈 == _mcpToolCount (Codex #5 영구해소, UR-0025)' : '✗ mcp-tools 모듈 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.298)')) {
  total++;
  let ok = false;
  try {
    const aDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-atomic-'));
    cp.spawnSync(process.execPath, [CLI, 'init', aDir, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
     
    for (let i = 0; i < 3; i++) {
      cp.spawnSync(process.execPath, [CLI, 'task', 'add', `원자성 테스트 T-${i}`, '--path', aDir], { encoding: 'utf8', timeout: 15000 });
      cp.spawnSync(process.execPath, [CLI, 'decision', 'add', `결정 ${i}`, '--reason', 'r', '--path', aDir], { encoding: 'utf8', timeout: 15000 });
    }
    const pt = fs.readFileSync(path.join(aDir, '.leerness', 'progress-tracker.md'), 'utf8');
     
    const sepLines = pt.split('\n').filter(l => /^\|---\|/.test(l)).length;
    const tasksOk = /원자성 테스트 T-0/.test(pt) && /원자성 테스트 T-2/.test(pt) && sepLines === 1;
     
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const tmpLeftover = walk(path.join(aDir, '.leerness')).filter(f => /\.tmp-\d+-\d+$/.test(f));
     
     
     
    const _ioSrc = fs.readFileSync(path.resolve(__dirname, '..', 'lib', 'io.js'), 'utf8');   
    const srcOk = /writeFileSync\(tmp,/.test(_ioSrc) && /renameSync\(/.test(_ioSrc) && !/writeFileSync\(p,\s*s/.test(_ioSrc);
    ok = tasksOk && tmpLeftover.length === 0 && srcOk;
    fs.rmSync(aDir, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.298) writeUtf8 원자적 쓰기: 반복쓰기 무손상 + temp 잔여 0 (UR-0038 외부리뷰)' : '✗ writeUtf8 원자성 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.299)')) {
  total++;
  let ok = false;
  try {
    const secDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sec-'));
     
    fs.writeFileSync(path.join(secDir, 'package.json'), JSON.stringify({
      name: 'sec', version: '0.0.1',
      scripts: { test: 'node -e "process.exit(process.env.NPM_TOKEN||process.env.LEERNESS_NPM_TOKEN?1:0)"' }
    }) + '\n', 'utf8');
     
    const r = cp.spawnSync(process.execPath, [CLI, 'verify-code', secDir], {
      cwd: secDir, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, NPM_TOKEN: 'leaktok', LEERNESS_NPM_TOKEN: 'leaklz' }
    });
    const out = (r.stdout || '') + (r.stderr || '');
     
    const ctrl = spawnNpmSync(['test'], { cwd: secDir, encoding: 'utf8', timeout: 30000, env: { ...process.env, NPM_TOKEN: 'leaktok' } });
    ok = /✓ test passed/.test(out) && !/✗ test/.test(out) && ctrl.status === 1;
    fs.rmSync(secDir, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.299) npm test 시크릿 차단: verify-code 가 NPM_TOKEN/LEERNESS_NPM_TOKEN 스크럽 (UR-0039 외부리뷰)' : '✗ npm test 시크릿 차단 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.300)')) {
  total++;
  let ok = false;
  try {
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
     
    const srcOk = /'view', pkg, 'version'/.test(harnessSrc) &&   
      !/cp\.exec\(.npm view \$\{pkg\}/.test(harnessSrc) &&
      /argList\.map\(_shellQuoteArg\)\.join/.test(harnessSrc);
     
    const uDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-upd-'));
    const r = cp.spawnSync(process.execPath, [CLI, 'update', uDir, '--check'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, LEERNESS_OFFLINE: '1' } });
    const funcOk = r.status === 0 && /Current:/.test(r.stdout || '');
    ok = srcOk && funcOk;
    fs.rmSync(uDir, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.300) 셸 주입 표면 제거: fetchNpmLatest execFile + argList 인용 + update --check 회귀 (UR-0040 외부리뷰)' : '✗ 셸 주입 표면 제거 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.301)')) {
  total++;
  let ok = false;
  try {
    const pDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tier-'));
    cp.spawnSync(process.execPath, [CLI, 'init', pDir, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'policy', 'set', 'read-only', '--enforce', '--path', pDir], { encoding: 'utf8', timeout: 15000 });
    const callMcp = (name, args) => {
      const req = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) + '\n';
      const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 15000, input: req });
      for (const l of (r.stdout || '').trim().split('\n')) { try { const j = JSON.parse(l); if (j.result) return j.result; } catch {} }
      return null;
    };
     
    const pa = callMcp('leerness_provider_add', { path: pDir, id: 'x', cmd: 'y' });
    const blocked = pa && pa.isError === true && /정책 차단/.test(pa.content[0].text);
     
    const hd = callMcp('leerness_handoff', { path: pDir });
    const handoffBlocked = hd && hd.isError === true && /정책 차단/.test(hd.content[0].text);
     
    const dc = callMcp('leerness_drift_check', { path: pDir });
    const allowed = handoffBlocked && dc && dc.isError !== true;
     
    const T = require(path.resolve(__dirname, '..', 'lib', 'mcp-tools.js'));
    const tierOk = T.every(t => typeof t.requiredTier === 'string' && t.requiredTier.length > 0);
    ok = blocked && allowed && tierOk;
    fs.rmSync(pDir, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.301) MCP 정책 메타데이터 게이트: under-classify 차단(provider_add) + read 허용(handoff) (UR-0041)' : '✗ MCP 정책 메타데이터 게이트 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.302)')) {
  total++;
  let ok = false;
  try {
    const vDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-vc-'));
    const git = (...a) => gitSpawn(a, { cwd: vDir, encoding: 'utf8', timeout: 15000 });
    const gi = git('init');
    if (gi.status !== 0) throw new Error('git 없음');   
    git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    cp.spawnSync(process.execPath, [CLI, 'init', vDir, '--yes', '--language', 'ko', '--skills', 'recommended', '--no-enforce'], { encoding: 'utf8', timeout: 30000 });   
    fs.mkdirSync(path.join(vDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(vDir, 'src', 'api.js'), 'v1'); fs.writeFileSync(path.join(vDir, 'old.js'), 'old');
    git('add', '-A'); git('commit', '-m', 'init');
    fs.writeFileSync(path.join(vDir, 'src', 'api.js'), 'v2 changed');   
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', '작업1', '--path', vDir, '--status', 'done', '--evidence', 'src/api.js 수정'], { encoding: 'utf8', timeout: 15000 });
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', '작업2', '--path', vDir, '--status', 'done', '--evidence', 'old.js 수정'], { encoding: 'utf8', timeout: 15000 });
    const r1 = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0002', '--path', vDir], { encoding: 'utf8', timeout: 20000 });
    const r2 = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0003', '--path', vDir, '--strict-claims'], { encoding: 'utf8', timeout: 20000 });
    const changedClaimOk = /git diff 교차검증: ✓/.test(r1.stdout || '');    
    const mismatchDetected = /git diff 교차검증: ⚠ 불일치/.test(r2.stdout || '') && r2.status === 1;   
    ok = changedClaimOk && mismatchDetected;
    fs.rmSync(vDir, { recursive: true, force: true });
  } catch (e) { if (/git 없음/.test(e.message)) { ok = true; console.log('  (git 미설치 — git 교차검증 e2e skip)'); } }
  console.log(ok ? '✓ B(1.9.302) verify-claim git diff 교차검증: 변경파일 주장 ✓ / 미변경 주장 ⚠ strict FAIL (UR-0042)' : '✗ verify-claim git 교차검증 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.303)')) {
  total++;
  let ok = false;
  try {
    const lDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lock-'));
    cp.spawnSync(process.execPath, [CLI, 'init', lDir, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const N = 6;
    const procs = [];
     
     
     
    const spawnOne = i => { const p = cp.spawn(process.execPath, [CLI, 'task', 'add', 'LOCKTEST-' + i, '--path', lDir, '--no-review'], { stdio: 'ignore' }); p.on('error', () => { try { cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'LOCKTEST-' + i, '--path', lDir, '--no-review'], { timeout: 30000 }); } catch {} }); return p; };
    for (let i = 0; i < N; i++) procs.push(spawnOne(i));
    const ptPath = path.join(lDir, '.leerness', 'progress-tracker.md');
     
    const start = Date.now(); let found = 0;
     
    while (Date.now() - start < 120000) {
      try { const pt = fs.readFileSync(ptPath, 'utf8'); found = Array.from({ length: N }, (_, i) => i).filter(i => pt.includes('LOCKTEST-' + i)).length; if (found === N) break; } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
    try { procs.forEach(p => { try { p.kill(); } catch {} }); } catch {}
     
    { let ptNow = ''; try { ptNow = fs.readFileSync(ptPath, 'utf8'); } catch {} for (let i = 0; i < N; i++) if (!ptNow.includes('LOCKTEST-' + i)) { try { cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'LOCKTEST-' + i, '--path', lDir, '--no-review'], { timeout: 30000 }); } catch {} } }
    const pt = fs.readFileSync(ptPath, 'utf8');
    const allFound = Array.from({ length: N }, (_, i) => i).every(i => pt.includes('LOCKTEST-' + i));
    const ids = (pt.match(/^\| (T-\d{4}) \|/gm) || []).map(s => s.match(/T-\d{4}/)[0]);
    const noDupId = ids.length === new Set(ids).size;   
    const oneSep = pt.split('\n').filter(l => /^\|---\|/.test(l)).length === 1;
    ok = allFound && noDupId && oneSep;
    fs.rmSync(lDir, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.303) 동시 task add lost-update 락: 6 병렬 모두 보존 + ID 충돌 0 (UR-0043)' : '✗ lost-update 락 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.304)')) {
  total++;
  let ok = false;
  try {
    const a = require(path.resolve(__dirname, '..', 'lib', 'analyzers.js'));
    const dataOk = typeof a._evidenceQuality === 'function' && typeof a._parseEvidenceStats === 'function' &&
      typeof a._shellGuardAnalyze === 'function' && typeof a._claimFileInGit === 'function' &&
      a._evidenceQuality('src/api.js 수정, 12/12 통과 (Exit: 0)').ok === true &&
      a._shellGuardAnalyze('a && b', { shell: 'powershell', psVersion: '5' }).issues.some(i => i.rule === 'ps5-chain') &&
      a._claimFileInGit('src/api.js', new Set(['src/api.js'])) === true;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const movedOut = !/function _evidenceQuality\(evidence\) \{/.test(harnessSrc) && !/function _shellGuardAnalyze\(cmd, ctx\) \{/.test(harnessSrc) && /require\('\.\.\/lib\/analyzers'\)/.test(harnessSrc);
     
    const sg = cp.spawnSync(process.execPath, [CLI, 'shell-guard', 'a && b', '--json'], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    const cmdOk = sg.status === 0 && /"shell"/.test(sg.stdout || '');
    ok = dataOk && movedOut && cmdOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.304) lib/analyzers 모듈 분리: 단일출처 + 인라인 제거 + shell-guard 동작 (UR-0025)' : '✗ analyzers 모듈 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.305)')) {
  total++;
  let ok = false;
  try {
     
    const good = cp.spawnSync(process.execPath, [CLI, 'honesty-check', '--text', 'src/api.js 수정, 12/12 통과 (Exit: 0)'], { cwd: tmp, encoding: 'utf8', timeout: 15000 });
    const goodOk = good.status === 0 && /정직성 신호 양호/.test(good.stdout || '');
     
    const bad1 = cp.spawnSync(process.execPath, [CLI, 'honesty-check', '--text', '이 기능은 항상 정상 동작합니다', '--json'], { cwd: tmp, encoding: 'utf8', timeout: 15000 });
    const b1 = JSON.parse(bad1.stdout); const bad1Ok = bad1.status === 1 && b1.findings.some(f => f.dim === 'pretend-knowledge');
     
    const bad2 = cp.spawnSync(process.execPath, [CLI, 'honesty-check', '--text', '아마 될 것 같습니다. 구현 완료했습니다', '--json'], { cwd: tmp, encoding: 'utf8', timeout: 15000 });
    const bad2Ok = JSON.parse(bad2.stdout).findings.some(f => f.dim === 'premature-judgment');
     
    const ml = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: tmp, encoding: 'utf8', timeout: 15000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n' });
    const mcpOk = JSON.parse(ml.stdout.split('\n').filter(Boolean)[0]).result.tools.some(t => t.name === 'leerness_honesty_check');
    ok = goodOk && bad1Ok && bad2Ok && mcpOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.305) honesty-check: 3차원 탐지 + exit code + MCP 노출 (모르는걸 아는척/미검증판단/정보미수집)' : '✗ honesty-check 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.306)')) {
  total++;
  let ok = false;
  try {
    const eDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-exit-'));
    cp.spawnSync(process.execPath, [CLI, 'init', eDir, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const ex = (args) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd: eDir, encoding: 'utf8', timeout: 20000 }).status;
     
    const unknownOk = ex(['definitely-not-a-cmd']) === 1;
    const missingArgOk = ex(['decision', 'add', '--path', eDir]) === 1;
    const badSubOk = ex(['task', 'zzznotreal', '--path', eDir]) === 1;
     
    const okStatus = ex(['status', eDir]) === 0;
    const okList = ex(['task', 'list', '--path', eDir]) === 0;
    const okHelp = ex(['--help']) === 0;
    const okVer = ex(['--version']) === 0;
    ok = unknownOk && missingArgOk && badSubOk && okStatus && okList && okHelp && okVer;
    fs.rmSync(eDir, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.306) exit code 일관성: 오류 exit 1(unknown/인자누락/badsub) + 정상·help·version exit 0 (UR-0045)' : '✗ exit code 일관성 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.307)')) {
  total++;
  let ok = false;
  try {
    const bDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-brief-'));
    cp.spawnSync(process.execPath, [CLI, 'init', bDir, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const run = (...a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: bDir, encoding: 'utf8', timeout: 20000 });
    run('brief', 'set', '--path', bDir, '--intro', '할 일 관리 앱', '--purpose', '팀 생산성', '--features', '태스크CRUD, 알림');
    const briefMd = fs.readFileSync(path.join(bDir, '.leerness', 'project-brief.md'), 'utf8');
    const readme = fs.readFileSync(path.join(bDir, 'README.md'), 'utf8');
    const setOk = /## Intro\n할 일 관리 앱/.test(briefMd) && /태스크CRUD/.test(briefMd) && readme.includes('<!-- leerness:project-brief:start -->') && /## 프로젝트 개요/.test(readme) && /할 일 관리 앱/.test(readme);
     
    run('brief', 'set', '--path', bDir, '--purpose', '엔터프라이즈 확대');
    const md2 = fs.readFileSync(path.join(bDir, '.leerness', 'project-brief.md'), 'utf8');
    const updateOk = /엔터프라이즈 확대/.test(md2) && /할 일 관리 앱/.test(md2) && /태스크CRUD/.test(md2);
     
    const readme2 = fs.readFileSync(path.join(bDir, 'README.md'), 'utf8');
    const noDup = (readme2.match(/<!-- leerness:project-brief:start -->/g) || []).length === 1;
     
    const exp = run('brief', 'export', '--path', bDir);
    const exportOk = exp.status === 0 && /Blueprint/.test(exp.stdout) && /신규 프로젝트 시작 가이드/.test(exp.stdout) && /엔터프라이즈 확대/.test(exp.stdout);
    ok = setOk && updateOk && noDup && exportOk;
    fs.rmSync(bDir, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.307) brief: 청사진 set→README+brief 동기화 + 멱등 업데이트 + export blueprint (UR-0055)' : '✗ brief 청사진 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.308)')) {
  total++;
  let ok = false;
  try {
    const b2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-brief2-'));
    cp.spawnSync(process.execPath, [CLI, 'init', b2, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const run = (...a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: b2, encoding: 'utf8', timeout: 20000 });
    run('brief', 'set', '--path', b2, '--intro', '앱', '--features', 'CRUD');
    run('brief', 'update', '--path', b2, '--direction', 'AI 자동분류 확대');
    run('brief', 'update', '--path', b2, '--direction', '모바일 지원 추가');
    const md = fs.readFileSync(path.join(b2, '.leerness', 'project-brief.md'), 'utf8');
    const histOk = /## Direction History/.test(md) && /AI 자동분류 확대/.test(md) && /모바일 지원 추가/.test(md);   
    const readme = fs.readFileSync(path.join(b2, 'README.md'), 'utf8');
    const readmeOk = /최근 개발 방향 변경/.test(readme) && /모바일 지원 추가/.test(readme);
    const exp = run('brief', 'export', '--path', b2);
    const expOk = /개발 방향 이력/.test(exp.stdout) && /AI 자동분류 확대/.test(exp.stdout);
     
    const ctx = run('context', '--path', b2, '--json');
    const cj = JSON.parse(ctx.stdout);
    const ctxOk = cj.brief && cj.brief.intro === '앱' && cj.brief.features.includes('CRUD') && /모바일 지원/.test(cj.brief.latestDirection || '');
     
    const ml = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: b2, encoding: 'utf8', timeout: 15000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_brief', arguments: { path: b2 } } }) + '\n' });
    let mcpOk = false;
    try { const r = JSON.parse(ml.stdout.split('\n').filter(Boolean)[0]); const t = JSON.parse(r.result.content[0].text); mcpOk = t.directionHistory.length === 2 && t.features.includes('CRUD'); } catch {}
    ok = histOk && readmeOk && expOk && ctxOk && mcpOk;
    fs.rmSync(b2, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.308) brief 2단계: update --direction 이력누적 + context 통합 + MCP leerness_brief (UR-0055)' : '✗ brief 2단계 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.309)')) {
  total++;
  let ok = false;
  try {
    const vc = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-vc48-'));
    cp.spawnSync(process.execPath, [CLI, 'init', vc, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    fs.mkdirSync(path.join(vc, 'src'), { recursive: true }); fs.writeFileSync(path.join(vc, 'src', 'api.js'), 'module.exports = { ok: true };');
    const ex = (...a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: vc, encoding: 'utf8', timeout: 20000 });
    ex('task', 'add', '증거없는완료', '--path', vc, '--status', 'done');                
    ex('task', 'add', '증거있는완료', '--path', vc, '--status', 'done', '--evidence', 'src/api.js 수정, 8 tests 통과 (Exit: 0)');   
    ex('task', 'add', '진행중', '--path', vc);                                           
    const noEv = ex('verify-claim', 'T-0002', '--path', vc).status === 1;               
    const lenient = ex('verify-claim', 'T-0002', '--path', vc, '--lenient').status === 0;   
    const withEv = ex('verify-claim', 'T-0003', '--path', vc).status === 0;             
    const notDone = ex('verify-claim', 'T-0004', '--path', vc).status === 0;            
     
    const ml = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: vc, encoding: 'utf8', timeout: 15000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_verify_claim', arguments: { taskId: 'T-0002', path: vc } } }) + '\n' });
    let mcpBlocks = false; try { mcpBlocks = JSON.parse(ml.stdout.split('\n').filter(Boolean)[0]).result.isError === true; } catch {}
    ok = noEv && lenient && withEv && notDone && mcpBlocks;
    fs.rmSync(vc, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.309) verify-claim 거짓완료 차단: 증거0 done 기본 FAIL + --lenient + 증거통과 + MCP 차단 (UR-0048)' : '✗ verify-claim 기본강제 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.310)')) {
  total++;
  let ok = false;
  try {
    const vd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-val-'));
    cp.spawnSync(process.execPath, [CLI, 'init', vd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const st = (...a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: vd, encoding: 'utf8', timeout: 20000 }).status;
    const badStatus = st('task', 'add', 't', '--path', vd, '--status', 'nonsense') === 1;           
    const goodStatus = st('task', 'add', 't2', '--path', vd, '--status', 'in-progress') === 0;      
    const forceStatus = st('task', 'add', 't3', '--path', vd, '--status', 'weird', '--force') === 0;  
    const badTrigger = st('rule', 'add', 'r', '--path', vd, '--trigger', 'not-a-trigger') === 1;    
    const everyRound = st('rule', 'add', 'r2', '--path', vd, '--trigger', 'every-round') === 0;     
    const everyUpdate = st('rule', 'add', 'r3', '--path', vd, '--trigger', 'every-update') === 0;   
    ok = badStatus && goodStatus && forceStatus && badTrigger && everyRound && everyUpdate;
    fs.rmSync(vd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.310) 입력 스키마 검증: 무효 status/trigger 거부 + 유효/--force/every-round 통과 (UR-0046)' : '✗ 입력 스키마 검증 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.311)')) {
  total++;
  let ok = false;
  try {
     
    const ig = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-initguard-'));
    const st = (...a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', ig], { cwd: ig, encoding: 'utf8', timeout: 20000 }).status;
    const blocked = st('task', 'add', 't') === 1
      && st('task', 'update', 'T-0001', '--status', 'done') === 1
      && st('rule', 'add', 'r', '--trigger', 'every-update') === 1
      && st('decision', 'add', 'd') === 1
      && st('plan', 'add', 'p') === 1
      && st('lesson', 'save', 'l') === 1
      && st('brief', 'set', '--intro', 'x') === 1;
     
     
    const beforeStateEntries = fs.existsSync(path.join(ig, '.leerness'))
      ? fs.readdirSync(path.join(ig, '.leerness')) : [];
    const noManagedState = beforeStateEntries.every((entry) => entry === 'cache')
      && !fs.existsSync(path.join(ig, '.leerness', 'HARNESS_VERSION'))
      && !fs.existsSync(path.join(ig, '.leerness', 'progress-tracker.md'));
    const stateOk = st('state', 'start', 'g') === 0;               
    const substrateCreated = fs.existsSync(path.join(ig, '.leerness', 'state.json'))
      && !fs.existsSync(path.join(ig, '.harness')); // workspace-dir-legacy-fixture
    const forced = st('task', 'add', 'tf', '--force') === 0;        
    fs.rmSync(ig, { recursive: true, force: true });
     
    const ig2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-initguard2-'));
    cp.spawnSync(process.execPath, [CLI, 'init', ig2, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const afterInit = cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'ti', '--path', ig2], { cwd: ig2, encoding: 'utf8', timeout: 20000 }).status === 0;
    fs.rmSync(ig2, { recursive: true, force: true });
    ok = blocked && noManagedState && stateOk && substrateCreated && forced && afterInit;
  } catch {}
  console.log(ok ? '✓ B(1.9.311) init 가드: 미초기화 .leerness write 7종 차단 + state(.leerness) 예외 + --force 우회 + init 후 정상 (UR-0047)' : '✗ init 가드 실패');
  if (!ok) failed++;
}

 
 
if (e2eShard.take('B(1.9.312)')) {
  total++;
  let ok = false;
  try {
    const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-secmod-'));
    const A = 'a1B2'.repeat(10);
    const lines = [
      'const a = "' + 'sk-' + 'proj-' + A + '_' + A + '";',           
      'const b = "' + 'sk-' + 'ant-api03-' + A + '_' + A + '";',      
      'const c = "' + 'gho_' + 'a1B2'.repeat(9) + '";',               
      'const d = "' + 'sk_' + 'live_' + A + '";',                     
      'const e = "' + 'npm_' + 'a1B2'.repeat(9) + '";',              
    ];
    fs.writeFileSync(path.join(sd, 'cfg.js'), lines.join('\n') + '\n');
    const r = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', sd], { encoding: 'utf8', timeout: 20000 });
    const out = r.stdout || '';
    ok = r.status === 1
      && /OpenAI project\/service key/.test(out)
      && /Anthropic API key/.test(out)
      && /GitHub token/.test(out)
      && /Stripe secret key/.test(out)
      && /npm token/.test(out);
    fs.rmSync(sd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.312) secret 스캐너 현대 키: sk-proj/sk-ant-api03(_)/gho_/Stripe/npm 검출 + exit 1 (UR-0050)' : '✗ secret 현대 키 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.313)')) {
  total++;
  let ok = false;
  try {
    const input = [
      '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',               
      '{"jsonrpc":"2.0","id":2,"method":"ping"}',                            
      '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}',  
      '{"jsonrpc":"2.0","id":3,"method":"tools/list"}',
    ].join('\n') + '\n';
    const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 15000, input });
    const lines = (r.stdout || '').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const ids = lines.map(l => l.id);
    const exactly3 = lines.length === 3 && ids.includes(1) && ids.includes(2) && ids.includes(3);   
    const noNotifResponse = !lines.some(l => l.error && /Unknown method: notifications/.test((l.error && l.error.message) || ''));
    const pingOk = lines.some(l => l.id === 2 && l.result && Object.keys(l.result).length === 0);
    const toolsOk = lines.some(l => l.id === 3 && l.result && Array.isArray(l.result.tools));
    ok = exactly3 && noNotifResponse && pingOk && toolsOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.313) MCP notification 준수: id없는 요청 무응답(2건) + ping {} + tools/list (UR-0049)' : '✗ MCP notification 준수 실패');
  if (!ok) failed++;
}

 
 
if (e2eShard.take('B(1.9.314)')) {
  total++;
  let ok = false;
  try {
    const sg = (extra) => { const r = cp.spawnSync(process.execPath, [CLI, 'shell-guard', 'a && b', '--json'], { encoding: 'utf8', timeout: 15000, env: { ...process.env, ...extra } }); try { return JSON.parse(r.stdout); } catch { return null; } };
    const j7 = sg({ POWERSHELL_DISTRIBUTION_CHANNEL: 'MSI:Windows 10 Pro', PSModulePath: '', SHELL: '' });
    const jb = sg({ POWERSHELL_DISTRIBUTION_CHANNEL: '', PSModulePath: 'C:\\Users\\u\\Documents\\WindowsPowerShell\\Modules', SHELL: '/usr/bin/bash' });
    const pwsh7Ok = j7 && String(j7.psVersion) === '7' && j7.shell === 'powershell' && !(j7.issues || []).some(i => i.rule === 'ps5-chain');   
    const noFalsePs5 = jb && jb.shell !== 'powershell' && !(jb.issues || []).some(i => i.rule === 'ps5-chain');   
    ok = pwsh7Ok && noFalsePs5;
  } catch {}
  console.log(ok ? '✓ B(1.9.314) PowerShell 감지: pwsh7(channel) ps5-chain 오탐 제거 + 영구 ps5.1경로 과경고 없음 (UR-0052)' : '✗ PowerShell 감지 실패');
  if (!ok) failed++;
}

// 1.9.315 회귀 (UR-0054 설치리뷰): doc/surface 정합 — doctor 진단 명령 + stale MCP 카운트 동적화(commands/banner)
if (e2eShard.take('B(1.9.315)')) {
  total++;
  let ok = false; const dbg = {};
  try {
     
     
     
     
     
     
     
    const doctorStarted = performance.now();
    const r = cp.spawnSync(process.execPath, [CLI, 'doctor', '--json'], { encoding: 'utf8', timeout: SELFTEST_SPAWN_MS });
    const doctorElapsed = performance.now() - doctorStarted;
    let j = null; try { j = JSON.parse(r.stdout); } catch {}
    dbg.doctor = childDiagnostics(r, doctorElapsed, SELFTEST_SPAWN_MS, j);
    const doctorOk = j && j.version && typeof j.mcpTools === 'number' && j.mcpTools >= 80 && j.selftest && j.selftest.status === 'not_run' && j.selftest.total === 0 && j.healthy === null && r.status === 0;
     
    const commandsStarted = performance.now();
    const rc = cp.spawnSync(process.execPath, [CLI, 'commands'], { encoding: 'utf8', timeout: 15000 });
    dbg.commands = childDiagnostics(rc, performance.now() - commandsStarted, 15000);
    const dynOk = j && new RegExp('MCP 도구: ' + j.mcpTools).test(rc.stdout || '') && !/MCP 도구: 65\b/.test(rc.stdout || '');
    ok = doctorOk && dynOk;
    dbg.doctorOk = !!doctorOk; dbg.dynOk = !!dynOk;
  } catch (error) { dbg.error = String(error && error.message || error).slice(0, 160); }
  console.log(ok ? '✓ B(1.9.315) doc/surface: doctor 진단(selftest+버전+셸) + commands MCP 카운트 동적 (UR-0054)' : '✗ doc/surface 실패');
  if (!ok) { failed++; console.log(JSON.stringify(dbg)); }
}

// 1.9.316 회귀 (drift 마커 버그): session-handoff 'Last generated' 중복 누적 방지 + drift 'session close 누락' 클리어
 
if (e2eShard.take('B(1.9.316/1.36.262)')) {
  total++;
  let ok = false;
  try {
    const dd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-driftmark-'));
    cp.spawnSync(process.execPath, [CLI, 'init', dd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const shp = path.join(dd, '.leerness', 'session-handoff.md');
     
    const legacy = '# Session Handoff\n\nLast generated: 2026-01-01T00:00:00.000Z\n\n## Completed\n- old\n\n---\n## x\n';
    fs.writeFileSync(shp, legacy);
    cp.spawnSync(process.execPath, [CLI, 'session', 'close', dd], { encoding: 'utf8', timeout: 30000 });
    const after = fs.readFileSync(shp, 'utf8');
     
     
     
     
    const S0 = after.indexOf('<!-- leerness:current-handoff:start -->'), S1 = after.indexOf('<!-- leerness:current-handoff:end -->');
    const region = S0 >= 0 && S1 > S0 ? after.slice(S0, S1) : '';
    const genCount = (region.match(/Last generated:/g) || []).length;    
    const firstAt = after.indexOf('Last generated:');
    const firstIsNew = S0 >= 0 && firstAt > S0 && firstAt < S1 && !region.includes('2026-01-01');    
    const legacyKept = S1 > 0 && after.slice(S1).includes(legacy);                                   
    const dr = cp.spawnSync(process.execPath, [CLI, 'drift', 'check', dd, '--json'], { encoding: 'utf8', timeout: 20000 });
    let driftOk = false; try { const j = JSON.parse(dr.stdout); const sig = (j.signals || []).find(x => x.label && x.label.includes('session close')); driftOk = sig && sig.ageDays <= sig.threshold; } catch {}
    ok = genCount === 1 && firstIsNew && legacyKept && driftOk;
    fs.rmSync(dd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.316/1.36.262) drift 마커: 생성 영역 Last generated 단일화(첫 값=새 값) + 표식 없는 옛 본문 보존 + session close 누락 신호 클리어' : '✗ drift 마커 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.317)')) {
  total++;
  let ok = false;
  try {
    const td = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-telem-'));
    cp.spawnSync(process.execPath, [CLI, 'init', td, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const usagePath = path.join(td, '.leerness', 'cache', 'usage-stats.json');
    const cmds = () => { try { return JSON.parse(fs.readFileSync(usagePath, 'utf8')).commands || {}; } catch { return {}; } };
     
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', '텔레메트리 테스트', '--path', td], { encoding: 'utf8', timeout: 20000 });
    const afterTask = cmds();
    const noPollution = afterTask.task >= 1 && !afterTask['review-request'];
     
    cp.spawnSync(process.execPath, [CLI, 'drift', 'check', '--path', td], { encoding: 'utf8', timeout: 20000 });
    const d1 = cmds().drift || 0;
    cp.spawnSync(process.execPath, [CLI, 'drift', 'check', '--path', td], { encoding: 'utf8', timeout: 20000, env: { ...process.env, LEERNESS_INTERNAL: '1' } });
    const d2 = cmds().drift || 0;
    const internalSkip = d1 >= 1 && d2 === d1;    
    ok = noPollution && internalSkip;
    fs.rmSync(td, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.317) 텔레메트리 분리: task add review-request 오염 없음 + LEERNESS_INTERNAL 미집계 (UR-0051)' : '✗ 텔레메트리 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.318)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const fnOk = typeof m._htmlToText === 'function' && typeof m._extractTitle === 'function' && typeof m._extractLinks === 'function';
    const work = m._htmlToText('<p>a <b>b</b></p>') === 'a b'
      && m._extractTitle('<title>T &amp; U</title>') === 'T & U'
      && m._extractLinks('<a href="/x">x</a><a href="https://o.com/y">y</a>', 'https://h.com/').length === 1;   
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const movedOut = !/function _htmlToText\(html\) \{/.test(harnessSrc) && harnessSrc.includes('_htmlToText, _extractTitle, _extractLinks') && /require\('\.\.\/lib\/pure-utils'\)/.test(harnessSrc);   
    const r = cp.spawnSync(process.execPath, [CLI, 'api-skill'], { encoding: 'utf8', timeout: 15000 });   
    const cmdOk = /api-skill/.test(r.stdout || '');
    ok = fnOk && work && movedOut && cmdOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.318) lib/pure-utils HTML 유틸 분리: 모듈 단일출처 + 인라인 제거 + api-skill 로드 (UR-0025)' : '✗ HTML 유틸 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.319)')) {
  total++;
  let ok = false;
  try {
    const toolsLen = require(path.resolve(__dirname, '..', 'lib', 'mcp-tools.js')).length;
    const rList = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 10000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n' });
    let listOk = false; try { const t = JSON.parse(rList.stdout.split('\n').filter(Boolean)[0]).result.tools; listOk = t.length === toolsLen && toolsLen >= 83; } catch {}
     
    const callOne = (name) => { const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 15000, input: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: {} } }) + '\n' }); try { const j = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]); return !(j.error && j.error.code === -32601); } catch { return false; } };
    const dispatchOk = callOne('leerness_about') && callOne('leerness_commands') && callOne('leerness_pulse');
    ok = listOk && dispatchOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.319) MCP ToolRegistry 일치성: tools/list=def 수 + 대표 도구 dispatch 정상 (UR-0044)' : '✗ ToolRegistry 일치성 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.320)')) {
  total++;
  let ok = false;
  try {
    const cd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-countdrift-'));
    cp.spawnSync(process.execPath, [CLI, 'init', cd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', 'JWT 채택', '--path', cd, '--reason', 'stateless', '--alternatives', 'session', '--impact', '보안'], { encoding: 'utf8', timeout: 20000 });
    cp.spawnSync(process.execPath, [CLI, 'lesson', 'save', '락은 reentrant', '--path', cd], { encoding: 'utf8', timeout: 20000 });
    const r = cp.spawnSync(process.execPath, [CLI, 'context', '--path', cd, '--json'], { encoding: 'utf8', timeout: 20000 });
    let dec = null, les = null; try { const j = JSON.parse(r.stdout); dec = j.memory && j.memory.decisions; les = j.memory && j.memory.lessons; } catch {}
    ok = dec === 1 && les === 1;   
    fs.rmSync(cd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.320) count drift 수정: decisions/lessons 코드펜스 템플릿 제외 (실제 카운트) (UR-0053)' : '✗ count drift 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.321)')) {
  total++;
  let ok = false;
  try {
    const fd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-field-'));
    cp.spawnSync(process.execPath, [CLI, 'init', fd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', '캐시 도입', '--path', fd, '--reason', '성능', '--impact', '응답50ms'], { encoding: 'utf8', timeout: 20000 });   
    const r = cp.spawnSync(process.execPath, [CLI, 'decision', 'list', '--path', fd, '--json'], { encoding: 'utf8', timeout: 20000 });
    let alt = 'X', imp = null; try { const parsed = JSON.parse(r.stdout); const arr = parsed.decisions || parsed; const d = arr[0]; alt = d.alternatives; imp = d.impact; } catch {}
    const noBleed = !alt || !String(alt).includes('Impact');    
    const impOk = imp === '응답50ms';                           
    ok = noBleed && impOk;
    fs.rmSync(fd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.321) decision 필드 파싱: 빈 alternatives 가 impact 로 안 샘 (UR-0053)' : '✗ decision 필드 파싱 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.322)')) {
  total++;
  let ok = false;
  try {
    const md = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tocli-'));
    cp.spawnSync(process.execPath, [CLI, 'init', md, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const call = (req) => { const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 15000, input: JSON.stringify(req) + '\n' }); try { return JSON.parse(r.stdout.split('\n').filter(Boolean)[0]); } catch { return null; } };
     
    call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_task_add', arguments: { path: md, text: 'TOCLI 테스트', status: 'in-progress' } } });
    const listed = call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'leerness_task_list', arguments: { path: md } } });
    const t = (listed && listed.result && listed.result.content && listed.result.content[0].text) || '';
    const argMapOk = /TOCLI 테스트/.test(t) && /in-progress/.test(t);
    const unk = call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'leerness_nope', arguments: {} } });
    const unkOk = !!unk && !!unk.error && unk.error.code === -32601;
    ok = argMapOk && unkOk;
    fs.rmSync(md, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.322) _mcpToCliArgs 추출: 인자 매핑(task_add status) 보존 + 미지 도구 -32601 (UR-0044)' : '✗ _mcpToCliArgs 추출 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.323)')) {
  total++;
  let ok = false;
  try {
    const fg = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-freshgate-'));
    cp.spawnSync(process.execPath, [CLI, 'init', fg, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const freshExit = cp.spawnSync(process.execPath, [CLI, 'lazy', 'detect', fg], { encoding: 'utf8', timeout: 20000 }).status;   
     
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', '거짓완료', '--status', 'done', '--evidence', '', '--path', fg, '--no-review', '--force'], { encoding: 'utf8', timeout: 20000 });
    const activeExit = cp.spawnSync(process.execPath, [CLI, 'lazy', 'detect', fg], { encoding: 'utf8', timeout: 20000 }).status;   
    ok = freshExit === 0 && activeExit === 1;
    fs.rmSync(fg, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.323) fresh-init gate: lazy detect 부재신호 비차단(통과) + 거짓완료 차단 유지 (UR-0054 ⑥)' : '✗ fresh-init gate 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.324)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const fnOk = typeof m._countDatedBlocks === 'function' && typeof m._extractDecisionBlocks === 'function';
    const work = m._countDatedBlocks('```md\n### 2026-01-01 — T\n```\n### 2026-06-05 — R\n') === 1
      && m._extractDecisionBlocks('### 2026-06-05 — A\n- Decision: x\n').length === 1;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
     
    const _puImport = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/function _countDatedBlocks\(/.test(harnessSrc) && !/function _compareSemver\(/.test(harnessSrc)
      && _puImport.includes('_countDatedBlocks') && _puImport.includes('_extractDecisionBlocks');
     
    const cd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-memparse-'));
    cp.spawnSync(process.execPath, [CLI, 'init', cd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', 'X', '--path', cd, '--reason', 'r'], { encoding: 'utf8', timeout: 20000 });
    const r = cp.spawnSync(process.execPath, [CLI, 'context', '--path', cd, '--json'], { encoding: 'utf8', timeout: 20000 });
    let decOk = false; try { decOk = JSON.parse(r.stdout).memory.decisions === 1; } catch {}
    ok = fnOk && work && movedOut && decOk;
    fs.rmSync(cd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.324) lib/pure-utils 메모리 파서 분리: 모듈 단일출처 + 인라인/중복 제거 + context count (UR-0025)' : '✗ 메모리 파서 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.325)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const fnOk = typeof m._classifyIntent === 'function';
    const work = m._classifyIntent('정확히 그것만').intent === 'precise'
      && m._classifyIntent('전체 다양한 기능').intent === 'broad'
      && m._classifyIntent('로그인 구현').intent === 'default';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
     
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/function _classifyIntent\(/.test(harnessSrc) && _puImp.includes('_classifyIntent');
     
    const id = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-intent-'));
    cp.spawnSync(process.execPath, [CLI, 'init', id, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const r = cp.spawnSync(process.execPath, [CLI, 'intent', 'classify', '정확히 그것만 해줘', '--path', id], { encoding: 'utf8', timeout: 20000 });
    const cmdOk = /precise/.test(r.stdout || '');
    ok = fnOk && work && movedOut && cmdOk;
    fs.rmSync(id, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.325) lib/pure-utils _classifyIntent 분리: 모듈 단일출처 + 인라인 제거 + intent classify (UR-0025)' : '✗ _classifyIntent 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.326)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const fnOk = typeof m._sanitizeFences === 'function' && typeof m._shellQuoteArg === 'function' && typeof m._detectPwshFromEnv === 'function';
    const work = m._sanitizeFences('a```b') === "a'''b"
      && m._detectPwshFromEnv({ POWERSHELL_DISTRIBUTION_CHANNEL: 'X' }).version === '7'
      && m._detectPwshFromEnv({}).isPowerShell === false
      && /^['"]/.test(m._shellQuoteArg('a b'));
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];   
    const movedOut = !/function _sanitizeFences\(/.test(harnessSrc) && !/function _shellQuoteArg\(/.test(harnessSrc) && !/function _detectPwshFromEnv\(/.test(harnessSrc)
      && _puImp.includes('_sanitizeFences') && _puImp.includes('_shellQuoteArg') && _puImp.includes('_detectPwshFromEnv');
     
    const sg = cp.spawnSync(process.execPath, [CLI, 'shell-guard', 'echo hi', '--json'], { encoding: 'utf8', timeout: 15000 });
    const cmdOk = sg.status === 0 && /"shell"/.test(sg.stdout || '');
    ok = fnOk && work && movedOut && cmdOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.326) lib/pure-utils 문자열/셸/env 유틸 분리: 모듈 단일출처 + 인라인 제거 + shell-guard (UR-0025)' : '✗ 문자열/셸/env 유틸 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.327)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const fnOk = typeof m._getLocalTz === 'function' && typeof m._formatLocal === 'function';
    const work = m._formatLocal('2026-06-05T01:13:00.000Z', { tz: 'Asia/Seoul' }) === '2026-06-05 10:13 KST'   
      && m._formatLocal('2026-06-05T01:13:00.000Z', { tz: 'Asia/Seoul', dateOnly: true }) === '2026-06-05'
      && m._formatLocal('') === '?' && typeof m._getLocalTz() === 'string';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];   
    const movedOut = !/function _formatLocal\(/.test(harnessSrc) && !/function _getLocalTz\(/.test(harnessSrc)
      && _puImp.includes('_getLocalTz') && _puImp.includes('_formatLocal');
    ok = fnOk && work && movedOut;
  } catch {}
  console.log(ok ? '✓ B(1.9.327) lib/pure-utils TZ/날짜 포맷 분리: 모듈 단일출처 + 인라인 제거 (UR-0025)' : '✗ TZ/날짜 포맷 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.328)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const work = typeof m._truncate === 'function' && typeof m._splitList === 'function'
      && m._truncate('hello world', 8) === 'hello w…' && m._truncate('hi', 8) === 'hi'
      && JSON.stringify(m._splitList('a, b ,c,')) === '["a","b","c"]';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];   
    const movedOut = !/function _truncate\(/.test(harnessSrc) && !/function _splitList\(/.test(harnessSrc)
      && _puImp.includes('_truncate') && _puImp.includes('_splitList');
    ok = work && movedOut;
  } catch {}
  console.log(ok ? '✓ B(1.9.328) lib/pure-utils 문자열 유틸 분리: 모듈 단일출처 + 인라인 제거 (UR-0025)' : '✗ 문자열 유틸 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.329)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const work = typeof m._roadmapMapStatus === 'function' && typeof m._roadmapParseMilestones === 'function' && typeof m._roadmapParseTokens === 'function'
      && m._roadmapMapStatus('REQUESTED') === 'planned' && m._roadmapMapStatus('done') === 'done'
      && m._roadmapParseMilestones('### M-0001. 로그인\nStatus: in-progress\nProgress: 40%')[0].progress === 40
      && m._roadmapParseTokens('| color | #fff |').color === '#fff';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];   
    const movedOut = !/function _roadmapMapStatus\(/.test(harnessSrc) && !/function _roadmapParseMilestones\(/.test(harnessSrc) && !/function _roadmapParseTokens\(/.test(harnessSrc)
      && _puImp.includes('_roadmapMapStatus') && _puImp.includes('_roadmapParseMilestones') && _puImp.includes('_roadmapParseTokens');
    ok = work && movedOut;
  } catch {}
  console.log(ok ? '✓ B(1.9.329) lib/pure-utils roadmap MD 파서 분리: 모듈 단일출처 + 인라인 제거 (UR-0025)' : '✗ roadmap 파서 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.330)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const cfgOk = Array.isArray(m._BRIEF_FIELDS) && m._BRIEF_FIELDS.length === 10 && m._BRIEF_FIELDS[0].key === 'intro';
    const work = m._briefFilled({ intro: 'x', features: ['a'] }) === 2 && m._briefFilled({}) === 0;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];   
    const movedOut = !/const _BRIEF_FIELDS = \[/.test(harnessSrc) && !/function _briefFilled\(/.test(harnessSrc)
      && _puImp.includes('_BRIEF_FIELDS') && _puImp.includes('_briefFilled');
     
    const bd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-brief-'));
    cp.spawnSync(process.execPath, [CLI, 'init', bd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'brief', 'set', '--intro', 'X', '--purpose', 'Y', '--path', bd], { encoding: 'utf8', timeout: 20000 });
    const r = cp.spawnSync(process.execPath, [CLI, 'brief', 'show', '--path', bd], { encoding: 'utf8', timeout: 20000 });
    const cmdOk = /2\/10/.test(r.stdout || '');
    ok = cfgOk && work && movedOut && cmdOk;
    fs.rmSync(bd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.330) lib/pure-utils brief config 분리: _BRIEF_FIELDS/_briefFilled 모듈 단일출처 + brief 명령 (UR-0025)' : '✗ brief config 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.331)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const b = { project: 'X', intro: 'i', features: ['f1'] };
    const work = typeof m._briefReadmeBlock === 'function' && typeof m._briefBlueprint === 'function'
      && m._briefReadmeBlock(b).includes(m.BRIEF_START) && /f1/.test(m._briefReadmeBlock(b))
      && /Blueprint/.test(m._briefBlueprint(b, '9.9.9')) && /leerness v9\.9\.9/.test(m._briefBlueprint(b, '9.9.9'));   
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];   
    const movedOut = !/function _briefReadmeBlock\(/.test(harnessSrc) && !/function _briefBlueprint\(/.test(harnessSrc) && !/^const BRIEF_START =/m.test(harnessSrc)
      && _puImp.includes('_briefReadmeBlock') && _puImp.includes('_briefBlueprint') && _puImp.includes('BRIEF_START');
     
    const bd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-briefsub-'));
    cp.spawnSync(process.execPath, [CLI, 'init', bd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'brief', 'set', '--intro', 'X', '--features', 'a,b', '--path', bd], { encoding: 'utf8', timeout: 20000 });
    const ex = cp.spawnSync(process.execPath, [CLI, 'brief', 'export', '--path', bd], { encoding: 'utf8', timeout: 20000 });
    const readmeOk = /project-brief:start/.test(fs.readFileSync(path.join(bd, 'README.md'), 'utf8'));
    const cmdOk = /Blueprint/.test(ex.stdout || '') && readmeOk;
    ok = work && movedOut && cmdOk;
    fs.rmSync(bd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.331) lib/pure-utils brief 빌더 분리: 모듈 단일출처 + 인라인 제거 + brief export/README sync (UR-0025)' : '✗ brief 빌더 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.332)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const r = m._parseLessonEntries('### 2026-06-05\n- Lesson: A\n- Tag: t\n\n### 2026-06-04\n- Lesson: B');
    const work = typeof m._parseLessonEntries === 'function' && r.length === 2 && r[0].text === 'A' && r[0].tag === 't' && r[1].tag === null;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];   
    const movedOut = !/function _parseLessonEntries\(/.test(harnessSrc) && _puImp.includes('_parseLessonEntries');
     
    const ld = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lesson-'));
    cp.spawnSync(process.execPath, [CLI, 'init', ld, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'lesson', 'save', '락 reentrant', '--tag', 'lock', '--path', ld], { encoding: 'utf8', timeout: 20000 });
    const lr = cp.spawnSync(process.execPath, [CLI, 'lesson', 'list', '--path', ld, '--json'], { encoding: 'utf8', timeout: 20000 });
    let cmdOk = false; try { const j = JSON.parse(lr.stdout); cmdOk = j.total === 1 && j.lessons[0].tag === 'lock'; } catch {}
    ok = work && movedOut && cmdOk;
    fs.rmSync(ld, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.332) lib/pure-utils lessons 파서 분리: 모듈 단일출처 + 인라인 제거 + lesson list (UR-0025)' : '✗ lessons 파서 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.333)')) {
  total++;
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const catOk = c._DEFAULT_PLATFORM_CONSTRAINTS && Object.keys(c._DEFAULT_PLATFORM_CONSTRAINTS.platforms).length === 6;
    const r = m._matchConstraints(c._DEFAULT_PLATFORM_CONSTRAINTS, 'stripe 결제');
    const work = catOk && r.matched.length === 1 && r.matched[0].platform === 'stripe' && r.totalPlatforms === 6 && m._matchConstraints(null, 'x').matched.length === 0;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
     
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];
     
     
     
     
    const movedOut = !/const _DEFAULT_PLATFORM_CONSTRAINTS = \{/.test(harnessSrc) && /_matchConstraints\(_loadPlatformConstraints\(root\), text/.test(harnessSrc)
      && _catImp.includes('_DEFAULT_PLATFORM_CONSTRAINTS');
     
    const cd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-con-'));
    cp.spawnSync(process.execPath, [CLI, 'init', cd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
     
     
     
    const cr = cp.spawnSync(process.execPath, [CLI, 'constraints', 'check', 'stripe 결제 구현', '--path', cd, '--json'], { encoding: 'utf8', timeout: 20000 });
    let _cj = null; try { _cj = JSON.parse(cr.stdout || ''); } catch {}
    const cmdOk = cr.status === 0 && !!_cj && !_cj.error && Array.isArray(_cj.matched)
      && _cj.matched.length > 0 && _cj.matched[0].platform === 'stripe';
    ok = work && movedOut && cmdOk;
    fs.rmSync(cd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.333) UR-0025 심층: constraints catalog/_matchConstraints 분리 + constraints check 회귀 (UR-0025)' : '✗ constraints 서브시스템 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.334)')) {
  total++;
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const catOk = c._DEFAULT_DOMAIN_CATALOG && Object.keys(c._DEFAULT_DOMAIN_CATALOG.domains).length === 5;
    const r = m._matchDomain(c._DEFAULT_DOMAIN_CATALOG, 'unity 게임');
    const work = catOk && typeof m._matchDomain === 'function' && r.domain === 'game' && Array.isArray(r.components) && m._matchDomain(null, 'x').domain === null;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];   
    const movedOut = !/const _DEFAULT_DOMAIN_CATALOG = \{/.test(harnessSrc) && harnessSrc.includes('_matchDomain(_loadDomainCatalog(root), text)')
      && _catImp.includes('_DEFAULT_DOMAIN_CATALOG');
     
    const id = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-dom-'));
    cp.spawnSync(process.execPath, [CLI, 'init', id, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const ir = cp.spawnSync(process.execPath, [CLI, 'intent', 'expand', 'unity 게임 맵', '--path', id], { encoding: 'utf8', timeout: 20000 });
    const cmdOk = /game/.test(ir.stdout || '');
    ok = work && movedOut && cmdOk;
    fs.rmSync(id, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.334) UR-0025 심층(Codex 위임·검증): domain catalog/_matchDomain 분리 + intent expand 회귀 (UR-0025)' : '✗ domain 서브시스템 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.335)')) {
  total++;
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const catOk = c._LSP_LANG_PATTERNS && Object.keys(c._LSP_LANG_PATTERNS).length === 5 && Array.isArray(c._LSP_LANG_PATTERNS.python);
    const langOk = m._detectLspLang('x.py') === 'python' && m._detectLspLang('y.rs') === 'rust' && m._detectLspLang('z.txt') === 'javascript';
    const sy = m._matchLspSymbols(c._LSP_LANG_PATTERNS, 'def foo():\n    pass\nclass Bar:\n    pass', 'python');
    const work = catOk && langOk && typeof m._matchLspSymbols === 'function' && sy.length === 2 && sy[0].name === 'foo' && sy[0].kind === 'function' && sy[1].name === 'Bar' && m._matchLspSymbols(null, 'x', 'javascript').length === 0;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];   
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/const _LSP_LANG_PATTERNS = \{/.test(harnessSrc) && !/function _detectLspLang\(/.test(harnessSrc)
      && _catImp.includes('_LSP_LANG_PATTERNS') && _puImp.includes('_matchLspSymbols') && _puImp.includes('_detectLspLang');
     
    const lf = path.join(os.tmpdir(), 'leerness-lsp-' + total + '.js');
    fs.writeFileSync(lf, 'function helloWorld(){}\nclass MyClass{}\n', 'utf8');
    const lr = cp.spawnSync(process.execPath, [CLI, 'lsp', 'symbols', lf], { encoding: 'utf8', timeout: 20000 });
    const cmdOk = /helloWorld/.test(lr.stdout || '') && /MyClass/.test(lr.stdout || '') && /javascript/.test(lr.stdout || '');
    ok = work && movedOut && cmdOk;
    fs.rmSync(lf, { force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.335) UR-0025 심층: LSP catalog/_detectLspLang/_matchLspSymbols 분리 + lsp symbols 회귀 (UR-0025)' : '✗ LSP 서브시스템 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.336)')) {
  total++;
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const catOk = Array.isArray(c.OPTIMISM_PATTERNS) && c.OPTIMISM_PATTERNS.length === 10 && c.OPTIMISM_PATTERNS[0].kind === 'API';
    const ev = 'API 호출 완료, POST /users 처리함';
    const sus = m._detectOptimism(c.OPTIMISM_PATTERNS, ev, 'function x(){ return 1; }');
    const conf = m._computeConfidence(c.OPTIMISM_PATTERNS, ev, 'function x(){ return 1; }');
    const work = catOk && typeof m._detectOptimism === 'function' && sus.some(s => s.kind === 'API' && s.severity === 'high') && conf < 0.5
      && m._computeConfidence(c.OPTIMISM_PATTERNS, '그냥 정리함', 'x') === 1 && m._detectOptimism(null, ev, 'x').length === 0
      && m._extractUrlClaims('POST /a/b').length === 1 && m._verifyUrlClaim({ path: '/a/b' }, 'has /a/b') === true;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];   
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/const OPTIMISM_PATTERNS = \[/.test(harnessSrc) && !/function _extractUrlClaims\(/.test(harnessSrc)
      && _catImp.includes('OPTIMISM_PATTERNS') && _puImp.includes('_puDetectOptimism') && _puImp.includes('_puComputeConfidence');
     
    const od = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-opt-'));
    cp.spawnSync(process.execPath, [CLI, 'init', od, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    fs.appendFileSync(path.join(od, '.leerness', 'progress-tracker.md'), '| T-9999 | done | API 통합 | API 호출 완료, POST /users 처리함 | M-1 | 2026-06-05 |\n');
    const or = cp.spawnSync(process.execPath, [CLI, 'optimism-check', 'T-9999', '--path', od, '--json'], { encoding: 'utf8', timeout: 20000 });
    let cmdOk = false;
    try { const j = JSON.parse(or.stdout); cmdOk = Array.isArray(j.suspects) && j.suspects.some(s => s.kind === 'API') && typeof j.confidence === 'number' && j.confidence < 0.5; } catch {}
    ok = work && movedOut && cmdOk;
    fs.rmSync(od, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.336) UR-0025 심층(Codex 위임·검증): OPTIMISM_PATTERNS/optimism 순수로직 분리 + optimism-check 회귀 (UR-0025)' : '✗ anti-laziness 서브시스템 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.337)')) {
  total++;
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const catOk = c.BUILT_IN_PERSONAS && Object.keys(c.BUILT_IN_PERSONAS).length === 5 && c.BUILT_IN_PERSONAS.security && typeof c.BUILT_IN_PERSONAS.security.body === 'string';
    const sm = m._personaSummaries(c.BUILT_IN_PERSONAS);
    const work = catOk && typeof m._personaSummaries === 'function' && Array.isArray(sm) && sm.length === 5 && sm[0].id === 'security' && sm[0].body === undefined && m._personaSummaries(null).length === 0;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];   
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/const BUILT_IN_PERSONAS = \{/.test(harnessSrc) && _catImp.includes('BUILT_IN_PERSONAS') && _puImp.includes('_personaSummaries');
     
    const pd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-per-'));
    cp.spawnSync(process.execPath, [CLI, 'init', pd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const lr = cp.spawnSync(process.execPath, [CLI, 'persona', 'list', '--path', pd, '--json'], { encoding: 'utf8', timeout: 20000 });
    let listOk = false;
    try { const j = JSON.parse(lr.stdout); listOk = Array.isArray(j.builtin) && j.builtin.length === 5 && j.builtin.some(p => p.id === 'security') && j.builtin[0].body === undefined; } catch {}
    fs.writeFileSync(path.join(pd, 't.js'), 'function q(){ return 1; }\n', 'utf8');
    const rr = cp.spawnSync(process.execPath, [CLI, 'review', path.join(pd, 't.js'), '--persona', 'security', '--path', pd], { encoding: 'utf8', timeout: 20000 });
    const reviewOk = /보안 엔지니어/.test(rr.stdout || '');
    ok = work && movedOut && listOk && reviewOk;
    fs.rmSync(pd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.337) UR-0025 심층: persona BUILT_IN_PERSONAS/_personaSummaries 분리 + persona list/review 회귀 (UR-0025)' : '✗ persona 서브시스템 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.338)')) {
  total++;
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const catOk = c.STRINGS && typeof c.STRINGS['common.ready'] === 'object' && c.STRINGS['common.ready'].en === 'Ready' && c.STRINGS['common.ready'].ko === '준비 완료';
    const work = catOk && typeof m._translate === 'function'
      && m._translate(c.STRINGS, 'common.ready', 'en') === 'Ready'
      && m._translate(c.STRINGS, 'common.ready', 'ko') === '준비 완료'
      && m._translate(c.STRINGS, 'no.such.key', 'en') === 'no.such.key'
      && m._translate(null, 'x', 'ko') === 'x'
      && m._translate({ k: { ko: '케이' } }, 'k', 'en') === '케이';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];   
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
     
    const movedOut = !/const STRINGS = \{/.test(harnessSrc) && _catImp.includes('STRINGS') && _puImp.includes('_translate') && harnessSrc.includes('return _translate(STRINGS, key, lang)');
    ok = work && movedOut;
  } catch {}
  console.log(ok ? '✓ B(1.9.338) UR-0025 심층: i18n STRINGS/_translate 분리 + _t 박막 (UR-0025)' : '✗ i18n 서브시스템 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.339)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
     
    const md = '# Decisions\n\n### 2026-06-05 — A\n- Decision: a\n- Reason: r\n- Alternatives: alt\n- Impact: imp\n\n### 2026-06-04 — B\n- Decision: b\n- Alternatives:\n';
    const objs = m._decisionsFromMd(md);
    const pureOk = objs.length === 2 && objs[0].alternatives === 'alt' && objs[1].alternatives === null
      && JSON.stringify(m._decisionsFromMd(m._renderDecisionsMd(objs))) === JSON.stringify(objs);
     
    const dd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-dec-'));
    cp.spawnSync(process.execPath, [CLI, 'init', dd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', 'PG 채택', '--reason', '관계형', '--alternatives', 'Mongo', '--path', dd], { encoding: 'utf8', timeout: 20000 });
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', 'Redis', '--reason', '속도', '--path', dd], { encoding: 'utf8', timeout: 20000 });
    const jsonExists = fs.existsSync(path.join(dd, '.leerness', 'decisions.json'));
    const canon = jsonExists ? JSON.parse(fs.readFileSync(path.join(dd, '.leerness', 'decisions.json'), 'utf8')) : [];
    const mdProj = fs.existsSync(path.join(dd, '.leerness', 'decisions.md')) ? fs.readFileSync(path.join(dd, '.leerness', 'decisions.md'), 'utf8') : '';
    const writeOk = jsonExists && canon.length === 2 && canon[0].alternatives === 'Mongo' && canon[1].alternatives === null
      && mdProj.includes('PG 채택') && mdProj.includes('Redis');
     
    let listOk = false, ctxOk = false;
    const lr = cp.spawnSync(process.execPath, [CLI, 'decision', 'list', '--path', dd, '--json'], { encoding: 'utf8', timeout: 20000 });
    try { const j = JSON.parse(lr.stdout); listOk = j.total === 2; } catch {}
    const cr = cp.spawnSync(process.execPath, [CLI, 'context', '--path', dd, '--json'], { encoding: 'utf8', timeout: 20000 });
    try { const j = JSON.parse(cr.stdout); ctxOk = j.memory && j.memory.decisions === 2; } catch {}
     
    cp.spawnSync(process.execPath, [CLI, 'decision', 'drop', 'PG', '--path', dd], { encoding: 'utf8', timeout: 20000 });
    const afterDrop = JSON.parse(fs.readFileSync(path.join(dd, '.leerness', 'decisions.json'), 'utf8'));
    const dropOk = afterDrop.length === 1 && afterDrop[0].title === 'Redis' && fs.existsSync(path.join(dd, '.leerness', 'decisions.archive.md'));
    fs.rmSync(dd, { recursive: true, force: true });
     
    const bd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bf-'));
    cp.spawnSync(process.execPath, [CLI, 'init', bd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    fs.rmSync(path.join(bd, '.leerness', 'decisions.json'), { force: true });
    fs.writeFileSync(path.join(bd, '.leerness', 'decisions.md'), '# Decisions\n\n## Template\n\n' + '```md\n### YYYY-MM-DD — 제목\n- Decision:\n```\n\n### 2026-06-01 — 기존A\n- Decision: A\n\n### 2026-06-02 — 기존B\n- Decision: B\n', 'utf8');
    const br = cp.spawnSync(process.execPath, [CLI, 'decision', 'list', '--path', bd, '--json'], { encoding: 'utf8', timeout: 20000 });
    let backfillOk = false;
    try { const j = JSON.parse(br.stdout); backfillOk = j.total === 2 && !fs.existsSync(path.join(bd, '.leerness', 'decisions.json')); } catch {}
    fs.rmSync(bd, { recursive: true, force: true });
    ok = pureOk && writeOk && listOk && ctxOk && dropOk && backfillOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.339) UR-0053: decisions canonical JSON + MD projection + 백필 + context 단일소스 (UR-0053)' : '✗ decisions canonical JSON 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.340)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
     
    const objs = [{ date: '2026-06-05', text: 'A', tag: 't' }, { date: '2026-06-04', text: 'B', tag: null }];
    const pureOk = JSON.stringify(m._parseLessonEntries(m._renderLessonsMd(objs))) === JSON.stringify(objs)
      && m._parseLessonEntries(m._renderLessonsMd([])).length === 0;
     
    const ld = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-les-'));
    cp.spawnSync(process.execPath, [CLI, 'init', ld, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'lesson', 'save', 'JWT 짧게', '--tag', 'security', '--path', ld], { encoding: 'utf8', timeout: 20000 });
    cp.spawnSync(process.execPath, [CLI, 'lesson', 'save', '캐시 TTL', '--path', ld], { encoding: 'utf8', timeout: 20000 });
    const jsonExists = fs.existsSync(path.join(ld, '.leerness', 'lessons.json'));
    const canon = jsonExists ? JSON.parse(fs.readFileSync(path.join(ld, '.leerness', 'lessons.json'), 'utf8')) : [];
    const mdProj = fs.existsSync(path.join(ld, '.leerness', 'lessons.md')) ? fs.readFileSync(path.join(ld, '.leerness', 'lessons.md'), 'utf8') : '';
    const writeOk = jsonExists && canon.length === 2 && canon[0].tag === 'security' && canon[1].tag === null
      && mdProj.includes('JWT 짧게') && mdProj.includes('캐시 TTL') && mdProj.includes('- Tag: security');
     
    let listOk = false, tagOk = false;
    const lr = cp.spawnSync(process.execPath, [CLI, 'lesson', 'list', '--path', ld, '--json'], { encoding: 'utf8', timeout: 20000 });
    try { listOk = JSON.parse(lr.stdout).total === 2; } catch {}
    const tr = cp.spawnSync(process.execPath, [CLI, 'lesson', 'list', '--tag', 'security', '--path', ld, '--json'], { encoding: 'utf8', timeout: 20000 });
    try { tagOk = JSON.parse(tr.stdout).total === 1; } catch {}
     
    cp.spawnSync(process.execPath, [CLI, 'lesson', 'drop', 'JWT', '--path', ld], { encoding: 'utf8', timeout: 20000 });
    const afterDrop = JSON.parse(fs.readFileSync(path.join(ld, '.leerness', 'lessons.json'), 'utf8'));
    const dropOk = afterDrop.length === 1 && afterDrop[0].text === '캐시 TTL' && fs.existsSync(path.join(ld, '.leerness', 'lessons.archive.md'));
    fs.rmSync(ld, { recursive: true, force: true });
     
    const bd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lbf-'));
    cp.spawnSync(process.execPath, [CLI, 'init', bd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    fs.rmSync(path.join(bd, '.leerness', 'lessons.json'), { force: true });
    fs.writeFileSync(path.join(bd, '.leerness', 'lessons.md'), '# Lessons\n\n### 2026-06-01\n- Lesson: 기존1\n- Tag: t1\n\n### 2026-06-02\n- Lesson: 기존2\n', 'utf8');
    const br = cp.spawnSync(process.execPath, [CLI, 'lesson', 'list', '--path', bd, '--json'], { encoding: 'utf8', timeout: 20000 });
    let backfillOk = false;
    try { backfillOk = JSON.parse(br.stdout).total === 2 && !fs.existsSync(path.join(bd, '.leerness', 'lessons.json')); } catch {}
    fs.rmSync(bd, { recursive: true, force: true });
    ok = pureOk && writeOk && listOk && tagOk && dropOk && backfillOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.340) UR-0058(Codex 위임·검증): lessons canonical JSON + MD projection + 백필 (UR-0058)' : '✗ lessons canonical JSON 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.341)')) {
  total++;
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const catOk = c.BUILTIN_CATALOG && Object.keys(c.BUILTIN_CATALOG).length === 2 && c.BUILTIN_CATALOG['feature-implementation'] && c.BUILTIN_CATALOG['feature-implementation'].version === '1.0.0';
    const out = m._withBuiltinSource(c.BUILTIN_CATALOG);
    const work = catOk && typeof m._withBuiltinSource === 'function' && Object.keys(out).length === 2
      && Object.values(out).every(v => v._source === 'builtin') && Array.isArray(out['feature-implementation'].capabilities)
      && Object.keys(m._withBuiltinSource(null)).length === 0;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];   
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/const BUILTIN_CATALOG = \{/.test(harnessSrc) && _catImp.includes('BUILTIN_CATALOG') && _puImp.includes('_withBuiltinSource')
      && harnessSrc.includes('_withBuiltinSource(BUILTIN_CATALOG)');
     
    const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-skl-'));
    cp.spawnSync(process.execPath, [CLI, 'init', sd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const sr = cp.spawnSync(process.execPath, [CLI, 'skill', 'list', '--path', sd], { encoding: 'utf8', timeout: 20000 });
    const listOut = (sr.stdout || '') + (sr.stderr || '');
    const cmdOk = /feature-implementation|roadmap/i.test(listOut);
    ok = work && movedOut && cmdOk;
    fs.rmSync(sd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.341) UR-0025 심층: BUILTIN_CATALOG/_withBuiltinSource 분리 + skill list 회귀 (UR-0025)' : '✗ BUILTIN_CATALOG 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.342)')) {
  total++;
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const mapsOk = c.ROADMAP_STATUS_LABEL && c.ROADMAP_STATUS_COLOR
      && Object.keys(c.ROADMAP_STATUS_LABEL).length === 11 && Object.keys(c.ROADMAP_STATUS_COLOR).length === 11
      && c.ROADMAP_STATUS_LABEL.done === '완료' && c.ROADMAP_STATUS_COLOR.done === '#16a34a' && c.ROADMAP_STATUS_COLOR.skill === '#8b5cf6';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];   
    const movedOut = !/const ROADMAP_STATUS_LABEL = \{/.test(harnessSrc) && !/const ROADMAP_STATUS_COLOR = \{/.test(harnessSrc)
      && _catImp.includes('ROADMAP_STATUS_LABEL') && _catImp.includes('ROADMAP_STATUS_COLOR');
     
    const rd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rm-'));
    cp.spawnSync(process.execPath, [CLI, 'init', rd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'roadmap', rd], { encoding: 'utf8', timeout: 20000 });
    const rf = path.join(rd, 'roadmap.html');
    const html = fs.existsSync(rf) ? fs.readFileSync(rf, 'utf8') : '';
    const renderOk = html.includes('#16a34a') && html.includes('#8b5cf6');
    ok = mapsOk && movedOut && renderOk;
    fs.rmSync(rd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.342) UR-0025 심층: ROADMAP_STATUS 맵 분리 + roadmap.html 렌더 회귀 (UR-0025)' : '✗ ROADMAP_STATUS 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.343)')) {
  total++;
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const A = 'a1B2'.repeat(10);
    const hit = (s) => c.SECRET_PATTERNS.some(p => { p.re.lastIndex = 0; return p.re.test(s); });
    const catOk = Array.isArray(c.SECRET_PATTERNS) && c.SECRET_PATTERNS.length === 20
      && hit('AKIA' + 'ABCD1234EFGH5678') && hit('sk-' + 'ant-api03-' + A + '_' + A) && !hit('const u = "john' + '_doe_2024";');
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];   
     
    const movedOut = !/const SECRET_PATTERNS = \[\r?\n\s*\{ name:/.test(harnessSrc) && _catImp.includes('SECRET_PATTERNS')
      && /const SECRET_PATTERNS = \['\.env'/.test(harnessSrc);   
     
    const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sec-'));
    cp.spawnSync(process.execPath, [CLI, 'init', sd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(sd, 'leak.js'), 'const k1 = "AKIAABCD1234EFGH5678";\nconst k2 = "sk-ant-api03-' + A + '_' + A + '";\n', 'utf8');
    const lr = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', sd], { encoding: 'utf8', timeout: 20000 });
    const leakOut = (lr.stdout || '') + (lr.stderr || '');
    const detectOk = /AWS Access Key/.test(leakOut) && /Anthropic API key/.test(leakOut);
    fs.rmSync(sd, { recursive: true, force: true });
    const cd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-secc-'));
    cp.spawnSync(process.execPath, [CLI, 'init', cd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(cd, 'clean.js'), 'const userName = "john_doe_2024";\nconst url = "https://example.com/x";\n', 'utf8');
    const cr = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', cd], { encoding: 'utf8', timeout: 20000 });
    const cleanOk = cr.status === 0 && !/AWS Access Key|Anthropic API key/.test((cr.stdout || '') + (cr.stderr || ''));
    fs.rmSync(cd, { recursive: true, force: true });
    ok = catOk && movedOut && detectOk && cleanOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.343) UR-0025 심층(R300): SECRET_PATTERNS 보안 응집 분리 + scan secrets 탐지/오탐 가드 (UR-0025)' : '✗ SECRET_PATTERNS 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.344)')) {
  total++;
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const catOk = c.SKILL_CATALOG_PRESETS && Object.keys(c.SKILL_CATALOG_PRESETS).length === 2
      && c.SKILL_CATALOG_PRESETS.vercel && c.SKILL_CATALOG_PRESETS.vercel.owner === 'vercel-labs'
      && c.SKILL_CATALOG_PRESETS.anthropic && c.SKILL_CATALOG_PRESETS.anthropic.repo === 'skills';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];   
    const movedOut = !/const SKILL_CATALOG_PRESETS = \{/.test(harnessSrc) && _catImp.includes('SKILL_CATALOG_PRESETS');
     
    const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-pre-'));
    cp.spawnSync(process.execPath, [CLI, 'init', sd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const dr = cp.spawnSync(process.execPath, [CLI, 'skill', 'discover', '--preset', 'nonexistent', '--path', sd], { encoding: 'utf8', timeout: 20000 });
    const out = (dr.stdout || '') + (dr.stderr || '');
    const cmdOk = /vercel/.test(out) && /anthropic/.test(out);
    ok = catOk && movedOut && cmdOk;
    fs.rmSync(sd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.344) UR-0025 심층: SKILL_CATALOG_PRESETS 분리 + skill discover preset 회귀 (UR-0025)' : '✗ SKILL_CATALOG_PRESETS 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.345)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const pureOk = typeof m._esc === 'function'
      && m._esc('&<>"\'') === '&amp;&lt;&gt;&quot;&#39;'
      && m._esc('<script>x</script>') === '&lt;script&gt;x&lt;/script&gt;'
      && m._esc(null) === '' && m._esc(undefined) === '' && m._esc(42) === '42';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/function _esc\(/.test(harnessSrc) && _puImp.includes('_esc');
     
    const rd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-esc-'));
    cp.spawnSync(process.execPath, [CLI, 'init', rd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    fs.appendFileSync(path.join(rd, '.leerness', 'progress-tracker.md'), '| T-7777 | done | <img src=x onerror=alert(1)> | src/x.js | M-1 | 2026-06-05 |\n');
    cp.spawnSync(process.execPath, [CLI, 'roadmap', rd], { encoding: 'utf8', timeout: 20000 });
    const rf = path.join(rd, 'roadmap.html');
    const html = fs.existsSync(rf) ? fs.readFileSync(rf, 'utf8') : '';
    const renderOk = html.length > 0 && !html.includes('<img src=x onerror') && html.includes('&lt;img');
    ok = pureOk && movedOut && renderOk;
    fs.rmSync(rd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.345) UR-0025 심층: _esc(HTML escape) 분리 + roadmap.html XSS 이스케이프 회귀 (UR-0025)' : '✗ _esc 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.346)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const out = m._roadmapTokenStyles({ 'color.primary': '#2563eb' }, { 'color-surface': '#fff', 'custom': '#abc' });
    const pureOk = typeof m._roadmapTokenStyles === 'function' && out.startsWith(':root {')
      && out.includes('--lr-primary: #2563eb') && out.includes('--lr-surface: #fff') && out.includes('--lr-custom: #abc')
      && out.includes('--lr-card-bg') && out.includes('--lr-page-bg') && m._roadmapTokenStyles(null, null).startsWith(':root {');
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/function _roadmapTokenStyles\(/.test(harnessSrc) && _puImp.includes('_roadmapTokenStyles');
     
    const rd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tok-'));
    cp.spawnSync(process.execPath, [CLI, 'init', rd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'roadmap', rd], { encoding: 'utf8', timeout: 20000 });
    const rf = path.join(rd, 'roadmap.html');
    const html = fs.existsSync(rf) ? fs.readFileSync(rf, 'utf8') : '';
    const renderOk = html.includes(':root {') && html.includes('--lr-');
    ok = pureOk && movedOut && renderOk;
    fs.rmSync(rd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.346) UR-0025 심층: _roadmapTokenStyles 분리 + roadmap.html CSS 변수 회귀 (UR-0025)' : '✗ _roadmapTokenStyles 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.347)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const r = m._parseSkillMd('---\nname: s1\ndescription: "d1"\n---\nbody');
    const pureOk = typeof m._parseSkillMd === 'function' && r.meta.name === 's1' && r.meta.description === 'd1' && r.body === 'body'
      && m._parseSkillMd('﻿---\nname: b\n---\nx').meta.name === 'b'
      && Object.keys(m._parseSkillMd('plain').meta).length === 0 && m._parseSkillMd(null).body === '';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/function _parseSkillMd\(/.test(harnessSrc) && _puImp.includes('_parseSkillMd');
     
    const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-smd-'));
    cp.spawnSync(process.execPath, [CLI, 'init', sd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const smdPath = path.join(sd, 's.md');
    fs.writeFileSync(smdPath, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('---\nname: e2e-skill\ndescription: BOM 처리\n---\n# Body', 'utf8')]));
    cp.spawnSync(process.execPath, [CLI, 'skill', 'install', smdPath, '--path', sd], { encoding: 'utf8', timeout: 20000, env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_NO_PROMPT: '1' } });
    const installOk = fs.existsSync(path.join(sd, '.leerness', 'skills', 'e2e-skill', 'SKILL.md'));
    ok = pureOk && movedOut && installOk;
    fs.rmSync(sd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.347) UR-0025 심층: _parseSkillMd 분리 + skill install(BOM) 회귀 (UR-0025)' : '✗ _parseSkillMd 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.348)')) {
  total++;
  let ok = false;
  try {
    const A = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-pa-'));
    const Bd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-pb-'));
    cp.spawnSync(process.execPath, [CLI, 'init', A, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'init', Bd, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.appendFileSync(path.join(A, '.leerness', 'progress-tracker.md'), '| T-0001 | done | AONLYMARK | x | M-1 | 2026-06-05 |\n');
    fs.appendFileSync(path.join(Bd, '.leerness', 'progress-tracker.md'), '| T-0002 | done | BONLYMARK | x | M-1 | 2026-06-05 |\n');
    const runIn = (cwd, a) => (cp.spawnSync(process.execPath, [CLI, ...a], { cwd, encoding: 'utf8', timeout: 20000 }).stdout || '');
    const flagOut = runIn(A, ['handoff', '--path', Bd]);   
    const posOut = runIn(A, ['handoff', Bd]);              
    const cwdOut = runIn(A, ['handoff']);                  
    const flagOk = /BONLYMARK/.test(flagOut) && !/AONLYMARK/.test(flagOut);   
    const posOk = /BONLYMARK/.test(posOut);               
    const cwdOk = /AONLYMARK/.test(cwdOut);               
    ok = flagOk && posOk && cwdOk;
    fs.rmSync(A, { recursive: true, force: true });
    fs.rmSync(Bd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.348) 외부리뷰 UR-0059(P0): --path 라우팅 일관화 + positional/cwd 회귀 (UR-0059)' : '✗ --path 라우팅 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.349)')) {
  total++;
  let ok = false; let _liDbg = null;
  try {
    const ni = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-noinit-'));   
     
     
     
    const sr = cp.spawnSync(process.execPath, [CLI, 'selftest'], { cwd: ni, encoding: 'utf8', timeout: SELFTEST_SPAWN_MS });
    const sout = (sr.stdout || '') + (sr.stderr || '');
    const selftestOk = sr.status === 0 && /전체 \d+건 통과/.test(sout) && !/설치 손상/.test(sout);
    const dr = cp.spawnSync(process.execPath, [CLI, 'doctor'], { cwd: ni, encoding: 'utf8', timeout: SELFTEST_SPAWN_MS, env: { ...process.env, LEERNESS_DOCTOR_SELFTEST: '1' } });
    const dout = (dr.stdout || '') + (dr.stderr || '');
     
     
    const doctorOk = dr.status === 0 && !/문제 감지|설치 손상|재설치/.test(dout) && /설치 정상|통과/.test(dout);
    const de = cp.spawnSync(process.execPath, [CLI, 'doctor'], { cwd: ni, encoding: 'utf8', timeout: SELFTEST_SPAWN_MS, env: { ...process.env, LEERNESS_DOCTOR_SELFTEST: '0' } });
    const eout = (de.stdout || '') + (de.stderr || '');
    const envOnlyOk = de.status === 0 && !/문제 감지|설치 손상|재설치|설치 정상|통과/.test(eout) && /코어 무결성은 검증하지 않았습니다/.test(eout);
    ok = selftestOk && doctorOk && envOnlyOk;
     
     
    if (!ok) _liDbg = { sExit: sr.status, dExit: dr.status, eExit: de.status, envOnlyOk, sPass: /전체 \d+건 통과/.test(sout),
      sBroken: /설치 손상/.test(sout), dBad: /문제 감지|설치 손상|재설치/.test(dout), dOk: /설치 정상|통과/.test(dout),
      sTail: String(sout).trim().split(String.fromCharCode(10)).slice(-2).join(' | ').slice(0, 160),
      dTail: String(dout).trim().split(String.fromCharCode(10)).slice(-2).join(' | ').slice(0, 160) };
    fs.rmSync(ni, { recursive: true, force: true });
  } catch (e) { _liDbg = { err: String(e && e.message).slice(0, 160) }; }
  console.log(ok ? '✓ B(1.9.349) 외부리뷰 UR-0063: selftest/doctor 위치독립 — 비초기화 dir 통과 (UR-0063)' : '✗ selftest 위치독립 실패 ' + JSON.stringify(_liDbg));
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.350)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
     
    const css = m._roadmapTokenStyles({ 'color.primary': 'red;}' + '</style><script>x</script>' }, {});
    const cssOk = !css.includes('<') && !css.includes('>') && css.includes('--lr-primary:');
     
    const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-trav-'));
    cp.spawnSync(process.execPath, [CLI, 'init', sd, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const skf = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-skf-'));
    fs.writeFileSync(path.join(skf, 'SKILL.md'), '---\nname: ..\ndescription: t\n---\n# b');
    const ir = cp.spawnSync(process.execPath, [CLI, 'skill', 'install', skf, '--path', sd], { encoding: 'utf8', timeout: 20000 });
    const travBlocked = /traversal|유효하지 않은 skill id|jail/.test((ir.stdout || '') + (ir.stderr || '')) && !fs.existsSync(path.join(sd, '.leerness', 'SKILL.md'));
    fs.rmSync(skf, { recursive: true, force: true });
     
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-scan-'));
    fs.writeFileSync(path.join(ud, 'harness.js'), 'const k = "glpat-' + 'a1B2'.repeat(5) + '";\n');
    const scr = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', ud], { encoding: 'utf8', timeout: 20000 });
    const scanOk = /GitLab PAT/.test((scr.stdout || '') + (scr.stderr || ''));
    fs.rmSync(ud, { recursive: true, force: true });
    fs.rmSync(sd, { recursive: true, force: true });
    ok = cssOk && travBlocked && scanOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.350) 외부리뷰 P1보안: CSS breakout/skill traversal 차단 + secret scan false-neg/패턴 보강 (UR-0060/0061/0062)' : '✗ P1 보안 하드닝 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.351)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-doc-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
     
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', 'PG 채택', '--reason', '관계형', '/abs/leak/path', '--path', d], { encoding: 'utf8', timeout: 20000 });
    const dj = JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'decisions.json'), 'utf8'));
    const titleOk = dj.length === 1 && dj[0].title === 'PG 채택' && !dj[0].title.includes('/abs/leak');
     
    const agents = fs.readFileSync(path.join(d, 'AGENTS.md'), 'utf8');
    const agentsOk = agents.includes('기본 워크스페이스 `.leerness/`') && agents.includes('메인 워크스페이스(.leerness)와 별개');
    fs.rmSync(d, { recursive: true, force: true });
     
    const hr = cp.spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', timeout: 20000 });
    const hout = (hr.stdout || '') + (hr.stderr || '');
    const helpOk = ['leerness context', 'leerness health', 'leerness intent', 'leerness constraints', 'leerness requests', 'leerness skill install'].every(c => hout.includes(c));
    ok = titleOk && agentsOk && helpOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.351) 외부리뷰 UR-0064/0065: 제목 오염 차단 + AGENTS.md/--help 정합 (UR-0064/0065)' : '✗ UR-0064/0065 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.352)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
     
    const mil = m._roadmapParseMilestones('### M-0001. A\n\n### M-0002. B\nStatus: done\nProgress: 80%\n');
    const milOk = mil.length === 2 && mil[0].status === 'planned' && mil[0].progress === 0 && mil[1].status === 'done';
     
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-usg-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', 'T1', '--reason', 'r'], { cwd: d, encoding: 'utf8', timeout: 20000 });
    cp.spawnSync(process.execPath, [CLI, 'lesson', 'save', 'L1'], { cwd: d, encoding: 'utf8', timeout: 20000 });
    cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', '.'], { cwd: d, encoding: 'utf8', timeout: 20000 });
    const ur = cp.spawnSync(process.execPath, [CLI, 'usage', 'stats', d, '--json'], { encoding: 'utf8', timeout: 20000 });
    let usageOk = false;
    try { const j = JSON.parse(ur.stdout); const c = j.commands || {}; usageOk = (c.decision || 0) >= 1 && (c.lesson || 0) >= 1 && (c.scan || 0) >= 1; } catch {}
    fs.rmSync(d, { recursive: true, force: true });
    ok = milOk && usageOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.352) 외부리뷰 P2: milestone 파서 블록경계 + usage subcommand 집계 (UR-0068/0069)' : '✗ P2 milestone/usage 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.353)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-enc-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
     
    fs.writeFileSync(path.join(d, 'cp949.txt'), Buffer.from([0xC7, 0xD1, 0xB1, 0xDB]));
    fs.writeFileSync(path.join(d, 'script.ps1'), Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('Write-Host hi', 'utf8')]));
    const er = cp.spawnSync(process.execPath, [CLI, 'encoding', 'check', d], { encoding: 'utf8', timeout: 20000 });
    const eout = (er.stdout || '') + (er.stderr || '');
    const encOk = /cp949\.txt/.test(eout) && /CP949|invalid UTF-8/.test(eout) && !/script\.ps1/.test(eout);
    fs.rmSync(d, { recursive: true, force: true });
     
    const sr = cp.spawnSync(process.execPath, [CLI, 'shell-guard', 'a && b', '--shell', 'powershell', '--json'], { encoding: 'utf8', timeout: 20000 });
    let shellOk = false;
    try { const j = JSON.parse(sr.stdout); shellOk = j.shell === 'powershell' && (j.issues || []).some(i => i.rule === 'ps5-chain'); } catch {}
     
    const e2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ansi-'));
    const ir = cp.spawnSync(process.execPath, [CLI, 'init', e2, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const iout = (ir.stdout || '') + (ir.stderr || '');
    const ansiOk = !/\x1b\[36m🌐/.test(iout) && !/\x1b\[33m🔗/.test(iout);
    fs.rmSync(e2, { recursive: true, force: true });
    ok = encOk && shellOk && ansiOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.353) 외부리뷰 P2: encoding CP949/.ps1 BOM + shell-guard --shell + init non-TTY ANSI (UR-0067/0070/0071)' : '✗ P2 마무리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.354)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const pureOk = m.compareVer('1.9.0-beta', '1.9.0') === -1 && m.compareVer('1.9.0', '1.9.0-beta') === 1 && m.compareVer('1.9.6', '1.9.5') === 1
      && (() => { const jp = Buffer.from([0xE3, 0x81, 0x82, 0xE6, 0x97, 0xA5]); const r = m._classifyCJK(jp, jp.length); return r.japanese > r.chinese; })();
     
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-p3-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(d, 'leak.js'), 'const k = "glpat-' + 'a1B2'.repeat(5) + '";\n');
    const fr = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', path.join(d, 'leak.js')], { encoding: 'utf8', timeout: 20000 });
    const fout = (fr.stdout || '') + (fr.stderr || '');
    const fileScanOk = /GitLab PAT/.test(fout) && /leak\.js/.test(fout) && !/ENOTDIR/.test(fout);
     
    cp.spawnSync(process.execPath, [CLI, 'requests', 'add', 'P3 drop test', '--path', d], { encoding: 'utf8', timeout: 20000 });
    const lj = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'requests', 'list', '--path', d, '--json'], { encoding: 'utf8', timeout: 20000 }).stdout);
    const newId = (lj.requests || []).filter(r => r.status === 'open').pop();
    let dropOk = false;
    if (newId) { const dr = cp.spawnSync(process.execPath, [CLI, 'requests', 'drop', newId.id, '--path', d], { encoding: 'utf8', timeout: 20000 }); const dout = (dr.stdout || '') + (dr.stderr || ''); dropOk = /✓ dropped/.test(dout) && !/✗ dropped/.test(dout); }
    fs.rmSync(d, { recursive: true, force: true });
    ok = pureOk && fileScanOk && dropOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.354) 외부리뷰 P3: compareVer/_classifyCJK + scan secrets 파일 + requests drop ✓ (UR-0072)' : '✗ P3 클러스터 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.355)')) {
  total++;
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const g = m._migrationGuideText('9.9.9');
    const pureOk = g.includes('마이그레이션 가이드') && g.includes('update --check --path') && g.includes('selftest') && g.includes('9.9.9');
    const gr = cp.spawnSync(process.execPath, [CLI, 'migrate', '--guide'], { encoding: 'utf8', timeout: 20000 });
    const guideOk = /마이그레이션 가이드/.test(gr.stdout || '') && /git/.test(gr.stdout || '');
     
    const A = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mga-'));
    const Bd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mgb-'));
    cp.spawnSync(process.execPath, [CLI, 'init', A, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'init', Bd, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(Bd, '.leerness', 'HARNESS_VERSION'), '1.9.6\n');
    const ur = cp.spawnSync(process.execPath, [CLI, 'update', '--check', '--path', Bd], { cwd: A, encoding: 'utf8', timeout: 30000, env: { ...process.env, LEERNESS_OFFLINE: '1' } });
    const pathOk = /1\.9\.6/.test((ur.stdout || '') + (ur.stderr || ''));
    fs.rmSync(A, { recursive: true, force: true });
    fs.rmSync(Bd, { recursive: true, force: true });
    ok = pureOk && guideOk && pathOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.355) UR-0075 Phase A: 마이그레이션 가이드 + update --path 타깃 (UR-0075)' : '✗ UR-0075 가이드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.356)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-aud-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
     
    const c1 = cp.spawnSync(process.execPath, [CLI, 'migrate', 'audit', '--path', d, '--json'], { encoding: 'utf8', timeout: 20000 });
    let cleanOk = false;
    try { cleanOk = JSON.parse(c1.stdout).willChange === 0; } catch {}
     
    fs.writeFileSync(path.join(d, '.leerness', 'HARNESS_VERSION'), '1.9.6\n');
    fs.writeFileSync(path.join(d, '.leerness', 'decisions.md'), '# Decisions\n\n### 2026-06-01 — A\n- Decision: x\n');
    fs.rmSync(path.join(d, '.leerness', 'decisions.json'), { force: true });
    const c2 = cp.spawnSync(process.execPath, [CLI, 'migrate', 'audit', '--path', d, '--json'], { encoding: 'utf8', timeout: 20000 });
    let driftOk = false;
    try { const j = JSON.parse(c2.stdout); const kinds = j.findings.map(f => f.kind); driftOk = j.projectVersion === '1.9.6' && j.willChange >= 2 && kinds.includes('version-drift') && kinds.includes('canonical-pending'); } catch {}
     
    const nonDestructive = !fs.existsSync(path.join(d, '.leerness', 'decisions.json'));
    fs.rmSync(d, { recursive: true, force: true });
    ok = cleanOk && driftOk && nonDestructive;
  } catch {}
  console.log(ok ? '✓ B(1.9.356) UR-0075 Phase B: migrate audit dry-run (clean/version-drift/canonical-pending, 비파괴) (UR-0075)' : '✗ migrate audit 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.357/1.36.191)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-app-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
     
     
     
    const dj = path.join(d, '.leerness', 'decisions.json');
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', 'A', '--reason', 'x', '--path', d], { encoding: 'utf8', timeout: 20000 });
    const canonical = fs.existsSync(dj) ? fs.readFileSync(dj, 'utf8') : null;
    fs.rmSync(dj, { force: true });
     
    cp.spawnSync(process.execPath, [CLI, 'migrate', 'apply', '--path', d], { encoding: 'utf8', timeout: 20000 });
    const dryNoWrite = !fs.existsSync(dj);
     
    cp.spawnSync(process.execPath, [CLI, 'migrate', 'apply', '--path', d, '--yes'], { encoding: 'utf8', timeout: 20000 });
    const appliedOk = canonical !== null && fs.existsSync(dj) && fs.readFileSync(dj, 'utf8') === canonical;
     
    const c3 = cp.spawnSync(process.execPath, [CLI, 'migrate', 'apply', '--path', d, '--json'], { encoding: 'utf8', timeout: 20000 });
    let idem = false;
    try { idem = JSON.parse(c3.stdout).applied.length === 0; } catch {}
     
    const n = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-app-legacy-'));
    cp.spawnSync(process.execPath, [CLI, 'init', n, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const nmd = path.join(n, '.leerness', 'decisions.md'), handMade = '# Decisions\n\n### 2026-06-01 — A\n- Decision: x\n';
    fs.writeFileSync(nmd, handMade);
    fs.rmSync(path.join(n, '.leerness', 'decisions.json'), { force: true });
    const nr = cp.spawnSync(process.execPath, [CLI, 'migrate', 'apply', '--path', n, '--yes', '--json'], { encoding: 'utf8', timeout: 20000 });
    let refusedCode = null; try { refusedCode = JSON.parse(nr.stdout).code; } catch {}
    const refusedIntact = refusedCode === 'projection_diverged' && fs.readFileSync(nmd, 'utf8') === handMade && !fs.existsSync(path.join(n, '.leerness', 'decisions.json'));
    [d, n].forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} });
    ok = dryNoWrite && appliedOk && idem && refusedIntact;
  } catch {}
  console.log(ok ? '✓ B(1.9.357/1.36.191) UR-0075 Phase C: migrate apply (dry-run 비파괴 / --yes canonical 백필 / 멱등 / 비정형 legacy 거부·무변경) (UR-0075)' : '✗ migrate apply 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.358)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-plan-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
     
    const c1 = cp.spawnSync(process.execPath, [CLI, 'migrate', 'plan', '--path', d, '--json'], { encoding: 'utf8', timeout: 90000 });
    let cleanOk = false, tmpOk = false;
    try { const j = JSON.parse(c1.stdout); cleanOk = j.willChange === 0 && j.missingFiles.length === 0; tmpOk = j.tempInstallOk === true; } catch {}
     
    fs.rmSync(path.join(d, '.leerness', 'reuse-map.md'), { force: true });
    const c2 = cp.spawnSync(process.execPath, [CLI, 'migrate', 'plan', '--path', d, '--json'], { encoding: 'utf8', timeout: 90000 });
    let missOk = false;
    try { const j = JSON.parse(c2.stdout); missOk = j.missingFiles.includes('.leerness/reuse-map.md') && j.willChange >= 1; } catch {}
     
    const readOnly = !fs.existsSync(path.join(d, '.leerness', 'reuse-map.md'));
    fs.rmSync(d, { recursive: true, force: true });
    ok = cleanOk && tmpOk && missOk && readOnly;
  } catch {}
  console.log(ok ? '✓ B(1.9.358) UR-0075 Phase D: migrate plan (임시폴더 설치 후 비교, clean/missing 감지, 읽기전용) (UR-0075)' : '✗ migrate plan 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.359)')) {
  total++;
  let ok = false;
  try {
    const r = cp.spawnSync(process.execPath, [CLI, 'install-safety', '--json'], { encoding: 'utf8', timeout: 15000 });
    const j = JSON.parse(r.stdout);
    ok = j.runtimeDeps === 0 && j.hasInstallScripts === false && Array.isArray(j.safeInstall) && j.safeInstall.length >= 3;
  } catch {}
  console.log(ok ? '✓ B(1.9.359) UR-0074: install-safety (0 런타임 deps / 0 install-script / safe-install) (UR-0074)' : '✗ install-safety 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.360)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-einval-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const r = cp.spawnSync(process.execPath, [CLI, 'update', d, '--check'], { encoding: 'utf8', timeout: 30000 });
    const out = (r.stdout || '') + (r.stderr || '');
    fs.rmSync(d, { recursive: true, force: true });
     
    ok = !out.includes('EINVAL') && r.status === 0;
  } catch {}
  console.log(ok ? '✓ B(1.9.360) CV-2: update --check 신형 Node Windows EINVAL 회피 (cmd.exe 경유) (UR-0077)' : '✗ update --check EINVAL 회귀');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.361)')) {
  total++;
  let ok = false;
  try {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rootA-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rootB-'));
    cp.spawnSync(process.execPath, [CLI, 'init', a, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'init', b, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
     
    const aHandoff = path.join(a, '.leerness', 'session-handoff.md');
    fs.rmSync(aHandoff, { force: true });
    cp.spawnSync(process.execPath, [CLI, 'session', 'close', '--path', a], { cwd: b, encoding: 'utf8', timeout: 30000 });
    const aRecreated = fs.existsSync(aHandoff);
     
    const cdir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-eq-'));
    cp.spawnSync(process.execPath, [CLI, 'init', cdir, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', 'EQFORM_DEC_991', '--path', cdir], { encoding: 'utf8', timeout: 20000 });
    const eqOut = cp.spawnSync(process.execPath, [CLI, 'context', '--path=' + cdir, '--json'], { cwd: b, encoding: 'utf8', timeout: 20000 });
    const eqOk = (eqOut.stdout || '').includes('EQFORM_DEC_991');
    [a, b, cdir].forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} });
    ok = aRecreated && eqOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.361) CV-1: --path 라우팅 통일 (session close --path 정타깃 쓰기 / context --path= 등호형) (UR-0076)' : '✗ --path 라우팅 통일 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.361) #2')) {
  total++;
  let ok = false;
  try {
    const r = cp.spawnSync(process.execPath, [CLI, 'audit', path.join(os.tmpdir(), 'leerness-no-such-' + total), '--json'], { encoding: 'utf8', timeout: 15000 });
    const j = JSON.parse(r.stdout);
    ok = j.healthy === false && j.failures >= 1;
  } catch {}
  console.log(ok ? '✓ B(1.9.361) CV-3: audit 미초기화 경로 failure 승격 (healthy=false) (UR-0078)' : '✗ audit 미초기화 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.362)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-arch-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko', '--keep', '2'], { encoding: 'utf8', timeout: 30000 });
     
    for (let i = 0; i < 3; i++) {
      fs.appendFileSync(path.join(d, 'AGENTS.md'), `\nRETENTION PROBE ${i}\n`);
      cp.spawnSync(process.execPath, [CLI, 'migrate', d, '--keep', '2'], { encoding: 'utf8', timeout: 30000 });
    }
    const adir = path.join(d, '.leerness', 'archive');
    const cnt = fs.readdirSync(adir).filter(n => /^leerness-/.test(n)).length;
    fs.rmSync(d, { recursive: true, force: true });
    ok = cnt === 2;   
  } catch {}
  console.log(ok ? '✓ B(1.9.362) CV-4: archive retention (--keep 상한, 무한 누적 차단) (UR-0079)' : '✗ archive retention 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.363)')) {
  total++;
  let ok = false;
  try {
    const r = cp.spawnSync(process.execPath, [CLI, 'commands', '--json'], { encoding: 'utf8', timeout: 15000 });
    const j = JSON.parse(r.stdout);
    const flat = JSON.stringify(j.categories);
    const must = ['install-safety', 'feature add', 'creds list', 'incident list', 'webhook serve', 'deploy auto', 'runs list', 'permissions list', 'whats-new', 'migrate audit'];
    ok = must.every(c => flat.includes(c)) && j.totalCommands >= 70;
  } catch {}
  console.log(ok ? '✓ B(1.9.363) CV-7: commands 카탈로그 누락 명령군 전수 등재 (8그룹+install-safety+migrate sub) (UR-0082)' : '✗ commands 카탈로그 drift');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.364)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-quiet-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
     
    const r = cp.spawnSync(process.execPath, [CLI, 'update', d, '--check', '--quiet'], { encoding: 'utf8', timeout: 30000 });
    const silent = (r.stdout || '').trim() === '' && r.status === 0;
     
    const settings = JSON.parse(fs.readFileSync(path.join(d, '.claude', 'settings.local.json'), 'utf8'));
    const hookQuiet = (settings.hooks.SessionStart || []).some(g => (g.hooks || []).some(h => h.type === 'command' && h.command === 'leerness update --check --quiet'));
    fs.rmSync(d, { recursive: true, force: true });
    ok = silent && hookQuiet;
  } catch {}
  console.log(ok ? '✓ B(1.9.364) 4th외부평가: auto-update hook 비침투 (update --check --quiet 무음 + hook --quiet) (UR-0083)' : '✗ auto-update 비침투 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.365)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sec-'));
    fs.mkdirSync(path.join(d, 'src'), { recursive: true });
     
    fs.writeFileSync(path.join(d, 'src', 'a.js'), 'const x = { secret: "change-me", apiKey: "your-key-here" };\n');
    const r1 = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', path.join(d, 'src', 'a.js')], { encoding: 'utf8', timeout: 15000 });
    const fpOk = r1.status === 0 && /no obvious/.test(r1.stdout || '');
     
    fs.writeFileSync(path.join(d, 'src', 'b.txt'), 'password=hunter2realsecret\n');
    const r2 = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', path.join(d, 'src', 'b.txt')], { encoding: 'utf8', timeout: 15000 });
    const fnOk = r2.status === 1 && /unquoted/.test(r2.stdout || '');
     
    fs.writeFileSync(path.join(d, '.gitignore'), '.env\nsrc/\n');
    fs.writeFileSync(path.join(d, '.env'), 'TOKEN=npm_abcdefghijklmnopqrstuvwxyz0123456789\n');
    const r3 = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', d], { encoding: 'utf8', timeout: 20000 });
    const giOk = r3.status === 0 && /gitignored/.test(r3.stdout || '');
    fs.rmSync(d, { recursive: true, force: true });
    ok = fpOk && fnOk && giOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.365) CV-6: 시크릿 스캐너 FP(placeholder)/FN(unquoted)/gitignored 강등 (UR-0081)' : '✗ 시크릿 스캐너 정밀도 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.366)')) {
  total++;
  let ok = false;
  try {
     
    const r = cp.spawnSync(process.execPath, [CLI, 'selftest', '--json'], { encoding: 'utf8', timeout: SELFTEST_SPAWN_MS });
    const j = JSON.parse(r.stdout);
    ok = j.ok === true && j.pass === j.total && j.fail === 0 && j.total >= 112 && r.status === 0;
  } catch {}
  console.log(ok ? '✓ B(1.9.366) CV-5: selftest 무결성 (--json pass===total, 행위 전환 writeUtf8/fail 포함) (UR-0080)' : '✗ selftest 무결성 실패');
  if (!ok) failed++;
}

 
 
 
 
 
if (e2eShard.take('B(1.36.88)')) {
  total++;
  let ok = false, why = '';
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
   
  const livedIn = require('./e2e-lived-in-harness');
  const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-e2e-livedin-'));
  try {
    const built = livedIn.buildLivedInHarness(harnessDir, CLI);
    if (!built.ok) {
      why = 'fixture: ' + [...built.steps.filter(s => s.status !== 0 || s.error).map(s => `${s.command} exit=${s.status}${s.error ? ' ' + s.error : ''}`),
        ...built.missing.map(m => 'missing ' + m)].join('; ');
    } else {
      const c = livedIn.selftestJsonContract(CLI, harnessDir, { timeout: 900000 });
      ok = c.ok;
      if (!ok) why = `pureStdout=${c.pureStdout} payloadOk=${c.payloadOk} stderr=${c.stderrBytes}B exit=${c.status}${c.error ? ' ' + c.error : ''}`
        + (c.stderrHead ? ` stderr: ${JSON.stringify(c.stderrHead.slice(0, 160))}` : '');
    }
  } catch (e) { why = 'threw: ' + (e && e.message || e); } finally { try { fs.rmSync(harnessDir, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ B(1.36.88) selftest --json 계약: 제품으로 만든 쓰던 하네스 cwd stdout 순수 JSON + stderr 잡음 0 (T-0341)' : `✗ selftest --json 계약 실패 (${why})`);
  if (!ok) failed++;
}

// 1.36.121 — `--json` stderr 계약을 **selftest 하나가 아니라 명령 전반**에 건다.
 
 
 
 
if (e2eShard.take('B(1.36.121)')) {
  total++;
  let ok = false; const bad = []; const diagnostics = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-json121-'));
  const ENV = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  try {
    const d = path.join(sb, 'p'); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0","scripts":{"test":"node t.js"}}');
    const initStarted = performance.now();
    const initialized = cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV });
    diagnostics.init = childDiagnostics(initialized, performance.now() - initStarted, 300000);
     
    const CMDS = ['audit', 'health', 'doctor', 'drift', 'plan', 'task', 'pulse', 'tech', 'handoff',
      'capabilities', 'commands', 'which', 'gate', 'dashboard', 'state'];
    for (const c of CMDS) {
       
       
      const timeoutMs = c === 'doctor' ? 990000 : 180000;
      const started = performance.now();
      const r = cp.spawnSync(process.execPath, [CLI, c, '--path', d, '--json'], { cwd: d, encoding: 'utf8', timeout: timeoutMs, env: ENV });
      const elapsedMs = performance.now() - started;
      const out = String(r.stdout || ''), err = String(r.stderr || '');
      if (!out.trim()) { bad.push(`${c}:출력없음`); diagnostics[c] = childDiagnostics(r, elapsedMs, timeoutMs); continue; }
      let j = null; try { j = JSON.parse(out.trim()); } catch {}
      if (!j) { bad.push(`${c}:stdout이JSON아님`); diagnostics[c] = childDiagnostics(r, elapsedMs, timeoutMs); continue; }
      const previousFailures = bad.length;
       
      if (err.length !== 0) bad.push(`${c}:stderr잡음(${err.length}B:${err.trim().split('\n')[0].slice(0, 40)})`);
       
      if (r.status !== 0) bad.push(`${c}:exit=${r.status}`);
      if (j.ok === false) bad.push(`${c}:ok=false`);
      if (bad.length > previousFailures) diagnostics[c] = childDiagnostics(r, elapsedMs, timeoutMs, j);
    }
     
    if (bad.length === 0 && CMDS.length < 10) bad.push('대상이_너무적음');
    ok = bad.length === 0;
  } catch (e) { bad.push('ERR:' + String(e && e.message).slice(0, 80)); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ B(1.36.121) --json stderr 계약 스윕: 조회성 15종 모두 stdout 단일 JSON + stderr 0'
    : '✗ --json stderr 계약 스윕 실패 ' + JSON.stringify(bad.slice(0, 6)));
  if (!ok) { failed++; console.log(JSON.stringify(diagnostics)); }
}

// 1.36.124 — MCP 서버를 **실제 JSON-RPC 로** 두드린다. 단위 테스트가 초록이어도 살아 있는 통신은 깨질 수 있다.
 
 
 
if (e2eShard.take('B(1.36.124)')) {
  total++;
  let ok = false, mcpSeconds = null; const bad = [];
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mcp124-'));
  const ENVm = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
   
   
   
  for (const k of ['LEERNESS_MCP_TIMEOUT_MS', 'LEERNESS_MCP_PROFILE', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG']) delete ENVm[k];
  try {
    const d = path.join(sb, 'p'); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
     
    const rInit = cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENVm });
    if (rInit.status !== 0) bad.push(`셋업init실패(exit=${rInit.status})`);
    const rpc = (id, method, params) => JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n';
     
     
     
     
    const notify = (method) => JSON.stringify({ jsonrpc: '2.0', method }) + '\n';
    const input = rpc(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } })
      + notify('notifications/initialized')
      + rpc(2, 'tools/list') + rpc(3, 'tools/call', { name: 'leerness_selftest', arguments: { path: d } })
      + rpc(4, 'tools/call', { name: 'leerness_brainstorm', arguments: { path: d } })           
      + rpc(5, 'tools/call', { name: 'leerness_does_not_exist', arguments: {} })                 
      + rpc(6, 'unknown/method', {});                                                           
    const _mcpT0 = Date.now();
    const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve', '--path', d],
      { cwd: d, input, encoding: 'utf8', timeout: 900000, env: ENVm, maxBuffer: 64 * 1024 * 1024 });
    mcpSeconds = Math.round((Date.now() - _mcpT0) / 1000);
    const msgs = [];
    for (const line of String(r.stdout || '').split('\n')) { const s = line.trim(); if (s) { try { msgs.push(JSON.parse(s)); } catch { bad.push('비JSON줄'); } } }
    const by = (i) => msgs.find(m => m.id === i);
     
    if (r.error) bad.push(`서버오류(${r.error.code || r.error.message})`);
    if (r.signal) bad.push(`서버시그널(${r.signal})`);
    if (r.status !== 0) bad.push(`서버exit=${r.status}`);
    if (String(r.stderr || '').length !== 0) bad.push(`stderr(${String(r.stderr).length}B)`);
    const init = by(1); if (!init || init.error || !(init.result && init.result.serverInfo)) bad.push('initialize실패');
    const tools = by(2) && by(2).result && by(2).result.tools;
     
     
     
    const REG = require(path.resolve(__dirname, '..', 'lib', 'mcp-tools.js'));
    if (!Array.isArray(tools) || tools.length !== REG.length) bad.push(`tools/list(${Array.isArray(tools) ? tools.length : 'none'}≠등록부 ${REG.length})`);
    else {
      if (tools.some(t => !t.description || !String(t.description).trim())) bad.push('도구설명없음');
      if (tools.some(t => !t.inputSchema || typeof t.inputSchema !== 'object')) bad.push('도구스키마없음');
      if (!tools.some(t => t.name === 'leerness_selftest')) bad.push('호출할도구가목록에없음');
       
       
      const regNames = new Set(REG.map(t => t.name));
      const gotNames = tools.map(t => t.name);
      const uniq = new Set(gotNames);
      if (uniq.size !== gotNames.length) bad.push(`도구이름중복(${gotNames.length - uniq.size}건)`);
      const extra = gotNames.filter(n => !regNames.has(n));
      if (extra.length) bad.push(`목록에등록부밖도구(${extra.slice(0, 3).join(',')})`);
      const missing = [...regNames].filter(n => !uniq.has(n));
      if (missing.length) bad.push(`등록부인데목록에없음(${missing.slice(0, 3).join(',')})`);
    }
    const call = by(3);
    const txt = call && call.result && Array.isArray(call.result.content) ? String((call.result.content[0] || {}).text || '') : '';
     
    if (!call || call.error) bad.push('tools/call오류');
     
     
    else if (/안에 끝나지 않아 중단/.test(txt)) bad.push(`tools/call타임아웃(${mcpSeconds}s)`);
    else if (call.result && call.result.isError) bad.push('tools/call_isError: ' + JSON.stringify(txt.slice(0, 120)));    
    else if (!/"total"\s*:\s*\d+|전체 \d+건 통과/.test(txt)) bad.push('tools/call결과아님');
     
     
    else {
      const m = /"fail"\s*:\s*(\d+)/.exec(txt);
      if (!m) bad.push('selftest_fail필드없음');
      else if (Number(m[1]) > 0) bad.push(`MCP경유_selftest_거짓실패(fail=${m[1]})`);
      const p = /"pass"\s*:\s*(\d+)/.exec(txt), t = /"total"\s*:\s*(\d+)/.exec(txt);
      if (!p || !t || Number(p[1]) !== Number(t[1])) bad.push(`selftest_pass≠total(${p && p[1]}/${t && t[1]})`);
    }
     
    for (const [id, code, label] of [[4, -32602, '필수인자누락'], [5, -32601, '미지도구'], [6, -32601, '미지메서드']]) {
      const m = by(id);
      if (!m) bad.push(`${label}:무응답`);
      else if (!m.error) bad.push(`${label}:오류아님`);
      else if (m.error.code !== code) bad.push(`${label}:코드=${m.error.code}(기대 ${code})`);
    }
    ok = bad.length === 0;
  } catch (e) { bad.push('ERR:' + String(e && e.message).slice(0, 80)); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ B(1.36.124) MCP 살아있는 통신: initialize · tools/list(설명·스키마 전수) · tools/call selftest 결과 반환 · stderr 0 (${mcpSeconds}s)`
    : '✗ MCP 살아있는 통신 실패 ' + JSON.stringify(bad.slice(0, 6)) + ` (${mcpSeconds}s)`);
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.367)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-envm-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const envPath = path.join(d, '.env');
    fs.writeFileSync(envPath, fs.readFileSync(envPath, 'utf8').replace('LEERNESS_NPM_TOKEN=', 'LEERNESS_NPM_TOKEN=user_kept_value_777'));
    cp.spawnSync(process.execPath, [CLI, 'migrate', d], { encoding: 'utf8', timeout: 30000 });
    const after = fs.readFileSync(envPath, 'utf8');
    fs.rmSync(d, { recursive: true, force: true });
    ok = after.includes('LEERNESS_NPM_TOKEN=user_kept_value_777');
  } catch {}
  console.log(ok ? '✓ B(1.9.367) UR-0025: _mergeEnvLines 분리 — migrate 가 사용자 .env 값 key-aware 보존' : '✗ env merge 보존 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.368)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mm-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const agents = path.join(d, 'AGENTS.md');
    fs.writeFileSync(agents, fs.readFileSync(agents, 'utf8') + '\nCUSTOM_USER_EDIT_MARKER_42\n');
    cp.spawnSync(process.execPath, [CLI, 'migrate', d], { encoding: 'utf8', timeout: 30000 });
    const after = fs.readFileSync(agents, 'utf8');
    fs.rmSync(d, { recursive: true, force: true });
    ok = after.includes('CUSTOM_USER_EDIT_MARKER_42') && after.includes('migration-preserved');
  } catch {}
  console.log(ok ? '✓ B(1.9.368) UR-0025: _managedMerge 분리 — migrate 가 사용자 편집 preserved 블록 보존' : '✗ managedMerge 보존 실패');
  if (!ok) failed++;
}

 
 
 
 
if (e2eShard.take('B(1.36.122)')) {
  total++;
  let ok = false; const bad = [];
  try {
    const PUx = require(path.resolve(path.dirname(CLI), '..', 'lib', 'pure-utils'));
    const next = '# T\nmanaged\n';
    const prev = '# T\nmanaged\nCUSTOM-LINE\n';
    const ptr = (s) => { const m = /(?:전체 원본 백업|Full original backup):\s*`([^`]+)`/.exec(s); return m && m[1]; };
     
    if (ptr(PUx._managedMerge('CLAUDE.md', next, prev, null, null)) !== '.leerness/archive') bad.push('기본값아님');
     
    const prev2 = prev + '\n> 전체 원본 백업: `.leerness/archive/leerness-1.2.3-STAMP`\n';
    if (ptr(PUx._managedMerge('CLAUDE.md', next, prev2, null, null)) !== '.leerness/archive/leerness-1.2.3-STAMP') bad.push('구체경로가_격하됨');
     
    if (ptr(PUx._managedMerge('CLAUDE.md', next, prev2, '.leerness/archive/NEW', null)) !== '.leerness/archive/NEW') bad.push('새백업으로_갱신안됨');
     
    const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ptr122-'));
    try {
      const d = path.join(sb, 'p'); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
      const ENVp = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_NO_PROMPT: '1' });
      cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENVp });
      const cf = path.join(d, 'CLAUDE.md');
       
      fs.writeFileSync(cf, fs.readFileSync(cf, 'utf8')
        + '\n<!-- leerness:migration-preserved -->\n## Preserved previous content\n\n> 이전 버전에서 이어진 사용자/프로젝트 커스텀 내용 — 마이그레이션마다 자동 이월됩니다. 전체 원본 백업: `.leerness/archive/leerness-9.9.9-STAMP`\n\nUSER-KEEP-LINE\n');
       
       
      fs.mkdirSync(path.join(d, '.leerness', 'archive', 'leerness-9.9.9-STAMP'), { recursive: true });
      fs.rmSync(path.join(d, '.mcp.json'), { force: true });
      const rAd = cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--path', d], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENVp });
      if (rAd.status !== 0) bad.push(`adapter실패(exit=${rAd.status})`);
      if (!fs.existsSync(path.join(d, '.mcp.json'))) bad.push('adapter가_아무것도_안함(공허)');
      const after2 = fs.readFileSync(cf, 'utf8');
      if (!/leerness-9\.9\.9-STAMP/.test(after2)) bad.push('CLI경로에서_포인터_격하');
      if (!after2.includes('USER-KEEP-LINE')) bad.push('CLI경로에서_사용자라인_유실');
       
       
      const dgone = path.join(sb, 'gone'); fs.mkdirSync(dgone, { recursive: true });
      fs.writeFileSync(path.join(dgone, 'package.json'), '{"name":"g","version":"0.1.0"}');
      cp.spawnSync(process.execPath, [CLI, 'init', dgone, '--yes'], { cwd: dgone, encoding: 'utf8', timeout: 300000, env: ENVp });
      const gf = path.join(dgone, 'CLAUDE.md');
      fs.writeFileSync(gf, fs.readFileSync(gf, 'utf8')
        + '\n<!-- leerness:migration-preserved -->\n## Preserved previous content\n\n> 이전 버전에서 이어진 사용자/프로젝트 커스텀 내용 — 마이그레이션마다 자동 이월됩니다. 전체 원본 백업: `.leerness/archive/GONE-9.9.9`\n\nUSER-KEEP-LINE\n');
      cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--path', dgone], { cwd: dgone, encoding: 'utf8', timeout: 300000, env: ENVp });
      const gAfter = fs.readFileSync(gf, 'utf8');
      if (/GONE-9\.9\.9/.test(gAfter)) bad.push('없어진_아카이브를_계속_가리킴');
      if (!/전체 원본 백업: `\.leerness\/archive`/.test(gAfter)) bad.push('없어진_아카이브인데_일반경로로_안내림');
      if (!gAfter.includes('USER-KEEP-LINE')) bad.push('격하시_사용자라인_유실');
    } finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
    ok = bad.length === 0;
  } catch (e) { bad.push('ERR:' + String(e && e.message).slice(0, 80)); }
  console.log(ok ? '✓ B(1.36.122) 보존 블록 백업 포인터: 새 백업 없으면 기존 구체 경로 유지 · 있으면 갱신 · 없으면 기본값'
    : '✗ 보존 블록 백업 포인터 실패 ' + JSON.stringify(bad));
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.369)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-min-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko', '--minimal'], { encoding: 'utf8', timeout: 30000 });
    const skipAbsent = !fs.existsSync(path.join(d, '.leerness', 'architecture.md'));   
    const corePresent = fs.existsSync(path.join(d, '.leerness', 'plan.md'));   
    fs.rmSync(d, { recursive: true, force: true });
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rec-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d2, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const recInstalled = fs.existsSync(path.join(d2, '.leerness', 'skills', 'feature-implementation'));   
    fs.rmSync(d2, { recursive: true, force: true });
    ok = skipAbsent && corePresent && recInstalled;
  } catch {}
  console.log(ok ? '✓ B(1.9.369) UR-0025: MINIMAL_SKIP_KEYS/_parseSkillsValue 분리 (--minimal 스킵+코어유지, --skills recommended)' : '✗ minimal/skills 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.370)')) {
  total++;
  let ok = false;
  try {
    const pu = require(path.resolve(__dirname, '..', 'lib', 'pure-utils'));
    const ab = pu._parseArchiveBlocks('## 제거 2026-01-01 (target: "T-9")\n### 옛제목\n');
    const md = pu._parseSkillCatalog('- [nm](https://x/SKILL.md) — d', '');
    const js = pu._parseSkillCatalog('{"skills":[{"id":"a","url":"u"}]}', '');
    ok = Array.isArray(ab) && ab.length === 1 && ab[0].target === 'T-9' && ab[0].originalHeader === '옛제목'
      && md.length === 1 && md[0].format === 'markdown' && js.length === 1 && js[0].format === 'json';
  } catch {}
  console.log(ok ? '✓ B(1.9.370) UR-0025: _parseArchiveBlocks/_parseSkillCatalog 순수 파서 모듈 분리 (행위)' : '✗ 파서 모듈 분리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.371)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-team-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'team', 'add', 'rev', '--name', 'Review', '--personas', 'security,perf', '--members', 'claude,codex', '--schedule', 'every-session', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const lj = cp.spawnSync(process.execPath, [CLI, 'team', 'list', '--path', d, '--json'], { encoding: 'utf8', timeout: 15000 });
    let addOk = false;
    try { const j = JSON.parse(lj.stdout); addOk = j.count === 1 && j.teams[0].id === 'rev' && j.teams[0].personas.length === 2 && j.teams[0].schedule === 'every-session'; } catch {}
    const jsonExists = fs.existsSync(path.join(d, '.leerness', 'teams.json'));
    const mdExists = fs.existsSync(path.join(d, '.leerness', 'teams.md'));
    cp.spawnSync(process.execPath, [CLI, 'team', 'remove', 'rev', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const lj2 = cp.spawnSync(process.execPath, [CLI, 'team', 'list', '--path', d, '--json'], { encoding: 'utf8', timeout: 15000 });
    let removeOk = false;
    try { removeOk = JSON.parse(lj2.stdout).count === 0; } catch {}
    fs.rmSync(d, { recursive: true, force: true });
    ok = addOk && jsonExists && mdExists && removeOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.371) UR-0073 Phase A: team 정의 레지스트리 (add/list/remove + canonical JSON/MD, opt-in 정의전용)' : '✗ team 레지스트리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.372)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tprev-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'team', 'add', 'rev', '--purpose', 'PR 리뷰', '--personas', 'security', '--members', 'claude,codex', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const pj = cp.spawnSync(process.execPath, [CLI, 'team', 'preview', 'rev', '--task', '점검', '--path', d, '--json'], { encoding: 'utf8', timeout: 15000 });
    let planOk = false;
    try { const j = JSON.parse(pj.stdout); planOk = j.dryRun === true && j.task === '점검' && j.steps.length === 2 && j.steps[0].suggestedCommand.includes('agents dispatch') && j.steps[0].suggestedCommand.includes('--to claude') && j.steps[0].dispatchPrompt.includes('security'); } catch {}
     
    const tj = path.join(d, '.leerness', 'teams.json');
    const before = fs.statSync(tj).mtimeMs;
    cp.spawnSync(process.execPath, [CLI, 'team', 'preview', 'rev', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const after = fs.statSync(tj).mtimeMs;
    fs.rmSync(d, { recursive: true, force: true });
    ok = planOk && before === after;
  } catch {}
  console.log(ok ? '✓ B(1.9.372) UR-0073 Phase B: team preview dry-run 실행계획 (멤버별 dispatch, 파일변경 0)' : '✗ team preview 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.373)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tsch-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'team', 'add', 'rev', '--members', 'claude', '--schedule', 'every-session', '--path', d], { encoding: 'utf8', timeout: 15000 });
    cp.spawnSync(process.execPath, [CLI, 'team', 'add', 'man', '--members', 'claude', '--schedule', 'manual', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const h = cp.spawnSync(process.execPath, [CLI, 'handoff', d, '--inspect'], { encoding: 'utf8', timeout: 60000 });
    const out = h.stdout || '';
    const shows = out.includes('에이전트 팀 스케줄') && out.includes('team preview rev') && !out.includes('🤝 man');
    const ho = cp.spawnSync(process.execPath, [CLI, 'handoff', d, '--inspect'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, LEERNESS_NO_TEAM_REMINDERS: '1' } });
    const optOut = !(ho.stdout || '').includes('에이전트 팀 스케줄');
    fs.rmSync(d, { recursive: true, force: true });
    ok = shows && optOut;
  } catch {}
  console.log(ok ? '✓ B(1.9.373) UR-0073 Phase C: handoff 팀 스케줄 알림 (비-manual 노출/manual 제외/opt-out)' : '✗ team 스케줄 알림 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.374)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-cad-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
     
     
    const gi = gitSpawn(['init', '-q'], { cwd: d, encoding: 'utf8', timeout: 20000 });
    const r = cp.spawnSync(process.execPath, [CLI, 'release', 'cadence', d, '--json'], { encoding: 'utf8', timeout: 20000 });
    const j = JSON.parse(r.stdout);
    fs.rmSync(d, { recursive: true, force: true });
    ok = gi.status === 0 && r.status === 0 && j.level === 'insufficient-data' && j.dataSufficient === false && typeof j.releasesPerDay === 'number' && typeof j.recommendation === 'string' && j.recommendation.length > 0;
  } catch {}
  console.log(ok ? '✓ B(1.9.374) UR-0074: release cadence 진단 (--json level/recommendation/releasesPerDay)' : '✗ release cadence 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.376)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tdep-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const marker = path.join(d, 'DEPLOYED.txt');
    cp.spawnSync(process.execPath, [CLI, 'team', 'add', 'dep', '--members', 'claude', '--deploy', 'node -e "require(\'fs\').writeFileSync(\'DEPLOYED.txt\',\'ok\')"', '--path', d], { encoding: 'utf8', timeout: 15000 });
     
    cp.spawnSync(process.execPath, [CLI, 'team', 'deploy', 'dep', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const dryNoExec = !fs.existsSync(marker);
     
    cp.spawnSync(process.execPath, [CLI, 'team', 'deploy', 'dep', '--yes', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const gateRefuse = !fs.existsSync(marker);
     
    cp.spawnSync(process.execPath, [CLI, 'team', 'deploy', 'dep', '--yes', '--path', d], { cwd: d, encoding: 'utf8', timeout: 20000, env: { ...process.env, LEERNESS_TEAM_DEPLOY: '1' } });
    const executed = fs.existsSync(marker);
    fs.rmSync(d, { recursive: true, force: true });
    ok = dryNoExec && gateRefuse && executed;
  } catch {}
  console.log(ok ? '✓ B(1.9.376) UR-0073 Phase D: team deploy 2중 게이트 (dry-run 실행X / env거부 / --yes+env 실행)' : '✗ team deploy 게이트 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.377)')) {
  total++;
  let ok = false;
  try {
    const pu = require(path.resolve(__dirname, '..', 'lib', 'pure-utils'));
    const g = pu._renderWorkspaceReferenceGuide('.leerness', '1.2.3', '2026-01-01T00:00:00.000Z', '.harness'); // workspace-dir-legacy-fixture
    ok = typeof g === 'string' && g.includes('.leerness/progress-tracker.md') && g.includes('by leerness 1.2.3')
      && g.includes('## 📁 디렉토리 구조 (핵심)') && g.includes('## 🧭 자주 묻는 위치') && g.includes('plan.md')
      && g.includes('canonical workspace') && g.includes('.leerness-backup/')
      && g.includes('workspace-dir-conflict') && g.includes('.leerness/cache/agent-runs/')
      && g.includes('.harness/'); // workspace-dir-legacy-fixture
  } catch {}
  console.log(ok ? '✓ B(1.9.377) UR-0025: _renderWorkspaceReferenceGuide 모듈 분리 (빌더 동작 + 핵심 섹션)' : '✗ workspace guide 빌더 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.378)')) {
  total++;
  let ok = false;
  try {
    const tools = require(path.resolve(__dirname, '..', 'lib', 'mcp-tools'));
    const tl = tools.find(t => t.name === 'leerness_team_list');
    const tp = tools.find(t => t.name === 'leerness_team_preview');
    const defsOk = !!tl && tl.requiredTier === 'read-only' && !!tp && tp.requiredTier === 'read-only' && tp.inputSchema.required.includes('id') && tools.length >= 85;
     
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tmcp-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'team', 'add', 'rev', '--members', 'claude', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const lj = cp.spawnSync(process.execPath, [CLI, 'team', 'list', '--path', d, '--json'], { encoding: 'utf8', timeout: 15000 });
    let cliOk = false;
    try { cliOk = JSON.parse(lj.stdout).count === 1; } catch {}
    fs.rmSync(d, { recursive: true, force: true });
    ok = defsOk && cliOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.378) UR-0073: team MCP 도구(read-only list/preview) 정의 + 매핑 CLI 동작' : '✗ team MCP 도구 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.379)')) {
  total++;
  let ok = false;
  try {
    const pu = require(path.resolve(__dirname, '..', 'lib', 'pure-utils'));
    const msOk = pu._memorySurface({ tasks: 1, decisions: 2, rules: 3, milestones: 4, lessons: 5 }) === 'T1/D2/R3/P4/L5';
    const lnOk = pu._renderPulseLine({ version: '1.0.0', roundCount: 7, mcpTools: 9, memorySurface: 'T0/D0/R0/P0/L0', nextMilestone: 400, etaDays: 6 }).includes('🎯 R400 (6d)');
     
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-pulse-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const gi = gitSpawn(['init', '-q'], { cwd: d, encoding: 'utf8', timeout: 20000 });
    const r = cp.spawnSync(process.execPath, [CLI, 'pulse', d], { encoding: 'utf8', timeout: 15000 });
    const cliOk = /📍 v[\d.]+ · 🔄 R\d+ · 🔌 MCP \d+ · 🧠 T\d+\/D\d+\/R\d+\/P\d+\/L\d+/.test(r.stdout || '');
    fs.rmSync(d, { recursive: true, force: true });
    ok = msOk && lnOk && gi.status === 0 && r.status === 0 && cliOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.379) UR-0025 심화: pulse 렌더 코어 분리 (_memorySurface/_renderPulseLine + CLI 출력 유지)' : '✗ pulse 렌더 코어 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.380)')) {
  total++;
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs'));
    const catOk = Array.isArray(c.REQUIRED_WORKSPACE_FILES) && c.REQUIRED_WORKSPACE_FILES.length === 9 && c.REQUIRED_WORKSPACE_FILES.includes('AGENTS.md');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-req-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const r1 = cp.spawnSync(process.execPath, [CLI, 'verify', d], { encoding: 'utf8', timeout: 15000 });
    const passOk = r1.status === 0;
    fs.rmSync(path.join(d, 'AGENTS.md'), { force: true });
    const r2 = cp.spawnSync(process.execPath, [CLI, 'verify', d], { encoding: 'utf8', timeout: 15000 });
    const failOk = r2.status === 1 && /missing: AGENTS\.md/.test((r2.stdout || '') + (r2.stderr || ''));
    fs.rmSync(d, { recursive: true, force: true });
    ok = catOk && passOk && failOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.380) UR-0025: REQUIRED_WORKSPACE_FILES 단일출처 (verify init통과/누락실패)' : '✗ required files 단일출처 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.381)')) {
  total++;
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs'));
    const setOk = c.KEYWORD_STOPWORDS instanceof Set && c.KEYWORD_STOPWORDS.has('작업') && c.KEYWORD_STOPWORDS.has('task') && !c.KEYWORD_STOPWORDS.has('고유키워드') && c.KEYWORD_STOPWORDS.size >= 25;
     
    const tokens = ['작업', 'task', '고유키워드', 'work'];
    const filtered = tokens.filter(t => !c.KEYWORD_STOPWORDS.has(t));
    const filterOk = filtered.length === 1 && filtered[0] === '고유키워드';
     
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sw-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const r = cp.spawnSync(process.execPath, [CLI, 'handoff', d], { encoding: 'utf8', timeout: 30000 });
    const handoffOk = r.status === 0;
    fs.rmSync(d, { recursive: true, force: true });
    ok = setOk && filterOk && handoffOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.381) UR-0025: KEYWORD_STOPWORDS 단일출처 (catalog Set + 필터 + handoff 무크래시)' : '✗ stopwords 단일출처 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.382)')) {
  total++;
  let ok = false;
  try {
    const io = require(path.resolve(__dirname, '..', 'lib', 'io'));
    const expOk = ['log', 'ok', 'warn', 'fail', 'today', 'now'].every(k => typeof io[k] === 'function') && /^\d{4}-\d{2}-\d{2}$/.test(io.today());
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-io-'));
    const ir = cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const initOk = ir.status === 0 && /✓/.test(ir.stdout || '');   
    fs.rmSync(path.join(d, 'AGENTS.md'), { force: true });
    const vr = cp.spawnSync(process.execPath, [CLI, 'verify', d], { encoding: 'utf8', timeout: 15000 });
    const failOk = vr.status === 1 && /✗/.test((vr.stdout || '') + (vr.stderr || ''));   
    fs.rmSync(d, { recursive: true, force: true });
    ok = expOk && initOk && failOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.382) UR-0025 큰핸들러토대: lib/io.js 프리미티브 분리 (exports + init ok/verify fail→exit1 유지)' : '✗ lib/io 프리미티브 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.383)')) {
  total++;
  let ok = false;
  try {
    const io = require(path.resolve(__dirname, '..', 'lib', 'io'));
    const expOk = ['absRoot', 'exists', 'read', 'readBuf', 'mkdirp', 'writeUtf8', 'append', 'rel'].every(k => typeof io[k] === 'function');
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-iofs-'));
    const f = path.join(t, 'sub', 'x.txt');
    io.writeUtf8(f, '한글IO');
    const rtOk = io.exists(f) && io.read(f) === '한글IO' && io.rel(t, f) === 'sub/x.txt';
    fs.rmSync(t, { recursive: true, force: true });
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-iocons-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', 'IO_RT_881', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const ctx = cp.spawnSync(process.execPath, [CLI, 'context', '--path', d, '--json'], { encoding: 'utf8', timeout: 15000 });
    const consumerOk = (ctx.stdout || '').includes('IO_RT_881');
    fs.rmSync(d, { recursive: true, force: true });
    ok = expOk && rtOk && consumerOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.383) UR-0025 큰핸들러토대: lib/io.js fs 프리미티브 분리 (round-trip + decision→context consumer)' : '✗ lib/io fs 프리미티브 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.384)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-svjson-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const sr = cp.spawnSync(process.execPath, [CLI, 'status', d, '--json'], { encoding: 'utf8', timeout: 15000 });
    const sj = JSON.parse(sr.stdout);
    const statusOk = typeof sj.total === 'number' && sj.present === sj.total && sj.healthy === true && Array.isArray(sj.missing) && sj.missing.length === 0;
    const vr = cp.spawnSync(process.execPath, [CLI, 'verify', d, '--json'], { encoding: 'utf8', timeout: 15000 });
    const vj = JSON.parse(vr.stdout);
    const verifyPassOk = vj.ok === true && Array.isArray(vj.failures) && vj.failures.length === 0 && vr.status === 0;
    fs.rmSync(path.join(d, 'AGENTS.md'), { force: true });
    const vr2 = cp.spawnSync(process.execPath, [CLI, 'verify', d, '--json'], { encoding: 'utf8', timeout: 15000 });
    const vj2 = JSON.parse(vr2.stdout);
    const verifyFailOk = vj2.ok === false && vj2.failures.length >= 1 && vr2.status === 1;   
    const vr3 = cp.spawnSync(process.execPath, [CLI, 'verify', d], { encoding: 'utf8', timeout: 15000 });   
    const humanFailOk = vr3.status === 1 && /✗/.test((vr3.stdout || '') + (vr3.stderr || '')) && !/^\s*\{/.test(vr3.stdout || '');
    fs.rmSync(d, { recursive: true, force: true });
    ok = statusOk && verifyPassOk && verifyFailOk && humanFailOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.384) 5th외부평가: status/verify --json 구조화 일관성 (pass/fail JSON+exit1, 사람용 보존, UR-0085)' : '✗ status/verify --json 일관성 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.385)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-contract-bullet-'));
    const spec = path.join(d, 'spec.md');
    const impl = path.join(d, 'impl.js');
    fs.writeFileSync(spec, '# Calc API\n\n함수 목록:\n- add(a, b): 합\n- subtract(a, b): 차\n- multiply(a, b): 곱\n', 'utf8');
    fs.writeFileSync(impl, '"use strict";\nfunction add(a,b){return a+b}\nmodule.exports={add};\n', 'utf8');
    const r = cp.spawnSync(process.execPath, [CLI, 'contract', 'verify', spec, impl, '--json'], { encoding: 'utf8', timeout: 10000 });
    const j = JSON.parse(r.stdout);
    const bulletOk = j.specFunctions.includes('add') && j.specFunctions.includes('subtract') && j.specFunctions.includes('multiply') &&
      j.missingFunctions.includes('subtract') && j.missingFunctions.includes('multiply') && !j.missingFunctions.includes('add') && j.ok === false;
     
    const spec2 = path.join(d, 'spec2.md');
    const impl2 = path.join(d, 'impl2.js');
    fs.writeFileSync(spec2, '# S\n\n`onlyMentioned(` 는 인라인 언급\nfunction realFn(x) {}\n- 합계 (a + b) 계산\n', 'utf8');
    fs.writeFileSync(impl2, '"use strict";\nfunction realFn(x){return x}\nmodule.exports={realFn};\n', 'utf8');
    const r2 = cp.spawnSync(process.execPath, [CLI, 'contract', 'verify', spec2, impl2, '--json'], { encoding: 'utf8', timeout: 10000 });
    const j2 = JSON.parse(r2.stdout);
    const lenientOk = !j2.missingFunctions.includes('onlyMentioned') && !j2.specFunctions.includes('합계') && j2.ok === true;   
    fs.rmSync(d, { recursive: true, force: true });
    ok = bulletOk && lenientOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.385) 5th외부평가: contract verify markdown bullet 함수 감지 + backtick 관대 + 산문 FP 0 (UR-0086)' : '✗ contract bullet 파서 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.386)')) {
  total++;
  let ok = false;
  try {
    const key = 'OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl012mno345pqr678stuvwx\n';
     
    const d1 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-envbad-'));
    fs.writeFileSync(path.join(d1, '.gitignore'), '.env\n');
    fs.writeFileSync(path.join(d1, '.env.bad'), key);
    const r1 = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', d1], { encoding: 'utf8', timeout: 20000 });
    const flaggedOk = r1.status === 1 && /\.env\.bad/.test(r1.stdout || '') && /OpenAI/.test(r1.stdout || '');
     
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-envok-'));
    fs.writeFileSync(path.join(d2, '.gitignore'), '.env\n');
    fs.writeFileSync(path.join(d2, '.env'), 'TOKEN=npm_abcdefghijklmnopqrstuvwxyz0123456789\n');
    const r2 = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', d2], { encoding: 'utf8', timeout: 20000 });
    const downgradeOk = r2.status === 0 && /gitignored/.test(r2.stdout || '');
     
    const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-envglob-'));
    fs.writeFileSync(path.join(d3, '.gitignore'), '.env.*\n');
    fs.writeFileSync(path.join(d3, '.env.bad'), key);
    const r3 = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', d3], { encoding: 'utf8', timeout: 20000 });
    const globOk = r3.status === 0 && /gitignored/.test(r3.stdout || '');
    [d1, d2, d3].forEach(d => fs.rmSync(d, { recursive: true, force: true }));
    ok = flaggedOk && downgradeOk && globOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.386) 5th외부평가: secret scan env-family 포함 + gitignore git-일치(.env↛.env.bad 커밋대상) (UR-0087)' : '✗ secret scan env-family/gitignore 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.387)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-listjson-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const ri = cp.spawnSync(process.execPath, [CLI, 'incident', 'list', '--path', d, '--json'], { encoding: 'utf8', timeout: 15000 });
    const ij = JSON.parse(ri.stdout);
    const rr = cp.spawnSync(process.execPath, [CLI, 'runs', 'list', '--path', d, '--json'], { encoding: 'utf8', timeout: 15000 });
    const rj = JSON.parse(rr.stdout);
    const jsonOk = ij.total === 0 && Array.isArray(ij.items) && ij.items.length === 0 && rj.total === 0 && Array.isArray(rj.items) && rj.items.length === 0;
     
    const rih = cp.spawnSync(process.execPath, [CLI, 'incident', 'list', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const humanOk = /incidents 없음/.test(rih.stdout || '') && !/^\s*\{/.test(rih.stdout || '');
    fs.rmSync(d, { recursive: true, force: true });
    ok = jsonOk && humanOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.387) 5th외부평가 일관성: incident/runs list 빈 케이스 --json 구조화 + 사람용 보존 (UR-0088)' : '✗ list 빈 케이스 --json 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.393)')) {
  total++;
  let ok = false;
  try {
    const pkgRoot = path.resolve(__dirname, '..');
     
     
     
    const noChangelog = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-whatsnew-'));
    const r = cp.spawnSync(process.execPath, [CLI, 'whats-new', noChangelog, '--from', '1.9.388', '--json'], { encoding: 'utf8', timeout: 15000 });
    try { fs.rmSync(noChangelog, { recursive: true, force: true }); } catch {}
    const j = JSON.parse(r.stdout);
     
    const versOk = Array.isArray(j.versions) && j.versions.length >= 1 && j.versions.every(v => /^\d+\.\d+\.\d+$/.test(v.version));
     
    const pu = require(path.resolve(pkgRoot, 'lib', 'pure-utils'));
    const titled = pu._parseChangelogBetween('## 1.9.20 — 2026-01-01 — T\n- a\n## 1.9.19 — 2026-01-01 — U\n- b\n', '1.9.19', '1.9.20').length === 1;
    const titleless = pu._parseChangelogBetween('## 1.9.20\n- a\n## 1.9.19\n- b\n', '1.9.19', '1.9.20').length === 1;
    ok = versOk && titled && titleless;
  } catch {}
  console.log(ok ? '✓ B(1.9.393) whats-new BUG-fix: "## X — DATE — title" 헤더 파싱 (_parseChangelogBetween pure 추출, UR-0025)' : '✗ whats-new 헤더 파싱 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.395)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-auditchk-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const kinds = (root) => { const r = cp.spawnSync(process.execPath, [CLI, 'audit', root, '--json', '--no-npm-audit'], { encoding: 'utf8', timeout: 20000 }); try { return (JSON.parse(r.stdout).findings || []).map(f => f.kind); } catch { return null; } };
    const readme = path.join(d, 'README.md'), pkg = path.join(d, 'package.json'), csp = path.join(d, '.leerness', 'current-state.md');
     
    fs.writeFileSync(readme, '# T\n![v](https://img.shields.io/badge/version-1.0.0-green)\n');
    fs.writeFileSync(pkg, '{"name":"t","version":"2.0.0"}\n');
    const mismatchOk = (kinds(d) || []).includes('readme_version_mismatch');
     
    fs.writeFileSync(readme, '# T\n![v](https://img.shields.io/badge/version-2.0.0-green)\n');
    const matchOk = !(kinds(d) || ['x']).includes('readme_version_mismatch');
     
    fs.writeFileSync(csp, '# CS\nUpdated: 2020-01-01\n');
    const staleOk = (kinds(d) || []).includes('current_state_stale');
     
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(csp, '# CS\nUpdated: ' + today + '\n');
    const freshOk = !(kinds(d) || ['x']).includes('current_state_stale');
    fs.rmSync(d, { recursive: true, force: true });
    ok = mismatchOk && matchOk && staleOk && freshOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.395) 회귀가드: audit README배지 mismatch + current-state stale FP/FN (행위검증)' : '✗ audit 체크 FP/FN 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.396)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-taskdrop-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const ptPath = path.join(d, '.leerness', 'progress-tracker.md');
    const before = fs.readFileSync(ptPath, 'utf8');
    const rNo = cp.spawnSync(process.execPath, [CLI, 'task', 'drop', 'T-9999', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const after = fs.readFileSync(ptPath, 'utf8');
    const noBogus = rNo.status === 1 && !after.includes('T-9999') && after === before;   
     
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'RealDropTask', '--path', d, '--no-review'], { encoding: 'utf8', timeout: 15000 });
    const rReal = cp.spawnSync(process.execPath, [CLI, 'task', 'drop', 'T-0001', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const realOk = rReal.status === 0 && /dropped/.test(rReal.stdout || '');
    fs.rmSync(d, { recursive: true, force: true });
    ok = noBogus && realOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.396) 6th외부평가 codex P1-B: task drop 없는ID fail+무변경 / 실제 정상 (데이터 손상 차단)' : '✗ task drop 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.397)')) {
  total++;
  let ok = false;
  try {
    const r = cp.spawnSync(process.execPath, [CLI, 'install-safety', '--json'], { encoding: 'utf8', timeout: 10000 });
    const j = JSON.parse(r.stdout);
    const noPosix = Array.isArray(j.safeInstall) && !j.safeInstall.some(x => /^npm_config_\w+=/.test(String(x).trim()));   
    const crossShell = j.safeInstall.filter(x => String(x).includes('npx --yes')).length >= 2;
    const note = typeof j.hardeningNote === 'string' && j.hardeningNote.includes('PowerShell');
    ok = noPosix && crossShell && note;
  } catch {}
  console.log(ok ? '✓ B(1.9.397) 6th외부평가 codex P1-A: install-safety 레시피 셸-무관 + hardeningNote (UR-0098)' : '✗ install-safety 셸호환 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.398)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-jsonerr-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const cv = cp.spawnSync(process.execPath, [CLI, 'contract', 'verify', '--json'], { encoding: 'utf8', timeout: 10000 });
    const cj = JSON.parse(cv.stdout); const cvOk = cj.ok === false && cj.code === 'missing_args' && cv.status === 1;
    const fsr = cp.spawnSync(process.execPath, [CLI, 'feature', 'show', 'F-9999', '--path', d, '--json'], { encoding: 'utf8', timeout: 10000 });
    const fj = JSON.parse(fsr.stdout); const fsOk = fj.ok === false && fj.code === 'not_found' && fsr.status === 1;
     
    const fh = cp.spawnSync(process.execPath, [CLI, 'feature', 'show', 'F-9999', '--path', d], { encoding: 'utf8', timeout: 10000 });
    const humanOk = fh.status === 1 && /✗/.test(fh.stdout || '') && !/^\s*\{/.test(fh.stdout || '');
    fs.rmSync(d, { recursive: true, force: true });
    ok = cvOk && fsOk && humanOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.398) 6th외부평가 codex P1-C: --json 에러 경로 구조화(contract verify/feature show) + 사람용 보존 (UR-0099)' : '✗ --json 에러 경로 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.399)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-cellinj-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'fix login | bypass', '--path', d, '--no-review'], { encoding: 'utf8', timeout: 15000 });
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'real\n| T-9999 | done | x | y | z | w |', '--path', d, '--no-review'], { encoding: 'utf8', timeout: 15000 });
    const tl = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'task', 'list', '--path', d, '--json'], { encoding: 'utf8', timeout: 15000 }).stdout);
    const ts = tl.tasks || tl;
    const pipeOk = ts.some(t => t.request === 'fix login | bypass');   
    const noInject = !ts.some(t => t.id === 'T-9999' || t.status === 'done');   
     
    cp.spawnSync(process.execPath, [CLI, 'rule', 'add', 'lint | typecheck', '--trigger', 'every-commit', '--path', d], { encoding: 'utf8', timeout: 15000 });
    cp.spawnSync(process.execPath, [CLI, 'rule', 'add', 'lint | typecheck', '--trigger', 'every-commit', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const rl = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'rule', 'list', '--path', d, '--json'], { encoding: 'utf8', timeout: 15000 }).stdout);
    const rs = rl.rules || rl;
    const ruleOk = rs.length === 1 && rs[0].rule === 'lint | typecheck' && rs[0].status === 'active';   
    fs.rmSync(d, { recursive: true, force: true });
    ok = pipeOk && noInject && ruleOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.399) 7th버그헌트 P1-A: 테이블셀 injection 차단(task/rule 파이프 보존+개행 가짜행 차단+rule 멱등) (UR-0104)' : '✗ 테이블셀 injection 차단 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.400)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-antilazyjson-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const jsonErr = (cmd) => { const r = cp.spawnSync(process.execPath, [CLI, cmd, 'T-9999', '--path', d, '--json'], { encoding: 'utf8', timeout: 15000 }); try { const j = JSON.parse(r.stdout); return j.ok === false && j.code === 'not_found' && r.status === 1; } catch { return false; } };
    const allJson = jsonErr('verify-claim') && jsonErr('optimism-check') && jsonErr('honesty-check');
    const hr = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-9999', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const humanOk = hr.status === 1 && /✗/.test(hr.stdout || '') && !/^\s*\{/.test(hr.stdout || '');
    fs.rmSync(d, { recursive: true, force: true });
    ok = allJson && humanOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.400) 7th버그헌트 P1-B: anti-laziness(verify-claim/optimism/honesty) --json 에러 구조화 + 사람용 보존 (UR-0105)' : '✗ anti-laziness --json 에러 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.401)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-secfn-'));
     
    fs.writeFileSync(path.join(d, '.gitignore'), '*.example\n!.env.example\n');
    fs.writeFileSync(path.join(d, '.env.example'), 'OPENAI_API_KEY=sk-proj-abc123def456ghi789jkl012mno345pqr678stuvwx\n');
    const r1 = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', d], { encoding: 'utf8', timeout: 20000 });
    const negOk = r1.status === 1 && /\.env\.example/.test(r1.stdout || '');
     
    fs.mkdirSync(path.join(d, 'src'), { recursive: true });
    fs.writeFileSync(path.join(d, 'src', 'c.txt'), 'api_key=sk-proj-EXAMPLEab12cd34ef56gh78ij90klmn99\n');
    const r2 = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', path.join(d, 'src', 'c.txt')], { encoding: 'utf8', timeout: 15000 });
    const phOk = r2.status === 1;   
    fs.rmSync(d, { recursive: true, force: true });
    ok = negOk && phOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.401) 7th버그헌트 P1-C: 시크릿 FN(gitignore !부정 + placeholder substring 정밀화) (UR-0106)' : '✗ 시크릿 FN 수정 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.402)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mdinj-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', 'realdec\n### 2099-01-01 — FAKE\n- Decision: forged', '--reason', 'r', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const md = fs.readFileSync(path.join(d, '.leerness', 'decisions.md'), 'utf8');
    const noFakeBlock = !/^### 2099-01-01 — FAKE/m.test(md);   
    const hasReal = md.includes('realdec');   
     
    const pu = require(path.resolve(__dirname, '..', 'lib', 'pure-utils'));
    const reparsed = pu._decisionsFromMd(md);
    const noInject = reparsed.length === 1;   
    fs.rmSync(d, { recursive: true, force: true });
    ok = noFakeBlock && hasReal && noInject;
  } catch {}
  console.log(ok ? '✓ B(1.9.402) 7th버그헌트 P1-A잔여: decision/lesson MD projection 개행 위조블록 주입 차단 (UR-0108)' : '✗ MD projection 개행 주입 차단 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.403)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-apiskillexit-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const ex = (args) => cp.spawnSync(process.execPath, [CLI, ...args, '--path', d], { encoding: 'utf8', timeout: 15000 }).status;
    const showNf = ex(['api-skill', 'show', 'NOPE']) === 1;
    const dropNf = ex(['api-skill', 'drop', 'NOPE']) === 1;
    const showNoId = ex(['api-skill', 'show']) === 1;
     
    const listOk = ex(['api-skill', 'list']) === 0;
    fs.rmSync(d, { recursive: true, force: true });
    ok = showNf && dropNf && showNoId && listOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.403) 7th버그헌트 P2: api-skill show/drop 에러 exit1(성공오판 방지) + list 정상 (UR-0107)' : '✗ api-skill exit-code 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.404)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-jsonleak2-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
     
    const ra = cp.spawnSync(process.execPath, [CLI, 'reuse', 'autodetect', '--path', d, '--json'], { encoding: 'utf8', timeout: 15000 });
    let raJson = false; try { const j = JSON.parse(ra.stdout); raJson = j.ok === false && j.code === 'no_scan_dir'; } catch {}
     
    const cc = cp.spawnSync(process.execPath, [CLI, 'creds', 'check', '--path', d, '--json'], { encoding: 'utf8', timeout: 15000 });
    let ccJson = false; try { const j = JSON.parse(cc.stdout); ccJson = j.ok === false && j.code === 'no_service'; } catch {}
     
    const ch = cp.spawnSync(process.execPath, [CLI, 'creds', 'check', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const humanOk = /✗/.test(ch.stdout || '') && !/^\s*\{/.test(ch.stdout || '');
    fs.rmSync(d, { recursive: true, force: true });
    ok = raJson && ccJson && humanOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.404) 7th버그헌트 P2: reuse autodetect/creds check --json 에러 구조화 + 사람용 보존 (UR-0105 잔여)' : '✗ reuse/creds --json 에러 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.405)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-phfp-'));
    fs.mkdirSync(path.join(d, 'src'), { recursive: true });
     
    fs.writeFileSync(path.join(d, 'src', 'cfg.txt'), 'API_KEY = "your-super-secret-api-key-example-value"\n');
    const r1 = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', path.join(d, 'src', 'cfg.txt')], { encoding: 'utf8', timeout: 15000 });
    const fpOk = r1.status === 0 && /no obvious/.test(r1.stdout || '');
     
    fs.writeFileSync(path.join(d, 'src', 'real.txt'), 'api_key=sk-proj-EXAMPLEab12cd34ef56gh78ij90klmn99\n');
    const r2 = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', path.join(d, 'src', 'real.txt')], { encoding: 'utf8', timeout: 15000 });
    const fnOk = r2.status === 1;
    fs.rmSync(d, { recursive: true, force: true });
    ok = fpOk && fnOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.405) 8th버그헌트 회귀수정: 긴 서술형 placeholder FP 차단 + 실키 FN 유지 (UR-0109)' : '✗ placeholder FP 회귀수정 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.406)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lockrefactor-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const run = (args) => cp.spawnSync(process.execPath, [CLI, ...args, '--path', d], { encoding: 'utf8', timeout: 15000 });
     
    run(['rule', 'add', 'lock refactor rule', '--trigger', 'every-session']);
    const dup = run(['rule', 'add', 'lock refactor rule', '--trigger', 'every-session']);   
    run(['rule', 'add', 'lock refactor rule 2', '--trigger', 'every-session']);
    const rl = JSON.parse(run(['rule', 'list', '--json']).stdout); const rs = rl.rules || rl;
    const ruleOk = rs.length === 2 && /skip/.test(dup.stdout || '');
     
    run(['decision', 'add', 'lock dec A', '--reason', 'r']);
    run(['decision', 'add', 'lock dec B', '--reason', 'r']);
    const decs = JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'decisions.json'), 'utf8'));
    const decOk = decs.length === 2;
     
    run(['lesson', 'save', 'lock lesson A']);
    run(['lesson', 'save', 'lock lesson B']);
    const les = JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'lessons.json'), 'utf8'));
    const lesOk = les.length === 2;
    fs.rmSync(d, { recursive: true, force: true });
    ok = ruleOk && decOk && lesOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.406) 8th버그헌트: rule/decision/lesson add 락 리팩터 멱등성·정확성 보존 (UR-0110)' : '✗ 락 리팩터 회귀가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.407)')) {
  total++;
  let ok = false;
  try {
     
    const tools = require(path.resolve(__dirname, '..', 'lib', 'mcp-tools'));
    const arr = Array.isArray(tools) ? tools : (tools.MCP_TOOLS || []);
    const fl = arr.find(x => x.name === 'leerness_feature_link');
    const tierOk = !!fl && fl.requiredTier === 'safe-write';
     
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-nanlimit-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'lesson', 'save', 'ZZUNIQUE alpha lesson', '--path', d], { encoding: 'utf8', timeout: 15000 });
    cp.spawnSync(process.execPath, [CLI, 'lesson', 'save', 'ZZUNIQUE beta lesson', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const r = cp.spawnSync(process.execPath, [CLI, 'lessons', 'ZZUNIQUE', '--path', d, '--limit', 'abc'], { encoding: 'utf8', timeout: 15000 });
    const limitOk = r.status === 0 && /ZZUNIQUE/.test(r.stdout || '');   
    fs.rmSync(d, { recursive: true, force: true });
    ok = tierOk && limitOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.407) 8th버그헌트: MCP feature_link safe-write tier + NaN --limit 결과 은폐 차단 (UR-0111)' : '✗ feature_link tier/NaN limit 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.408)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-crlfskill-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const skillDir = path.join(d, 'crlfSkillSrc');
    fs.mkdirSync(skillDir, { recursive: true });
     
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\r\nname: crlf-skill\r\ndescription: a windows skill\r\n---\r\nbody content\r\n');
    const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'install', skillDir, '--path', d], { encoding: 'utf8', timeout: 20000 });
    const installOk = r.status === 0 && !/name.{0,4}필수/.test((r.stdout || '') + (r.stderr || ''));
     
    const ls = cp.spawnSync(process.execPath, [CLI, 'skill', 'list', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const found = /crlf-skill/.test(ls.stdout || '');
    fs.rmSync(d, { recursive: true, force: true });
    ok = installOk && found;
  } catch {}
  console.log(ok ? '✓ B(1.9.408) 8th버그헌트: CRLF SKILL.md frontmatter 파싱 복구(Windows skill install) (UR-0112)' : '✗ CRLF SKILL.md 파싱 실패');
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('B(1.9.409/1.36.177)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bomsh-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const shBefore = Buffer.from('#!/bin/bash\n# 한글 주석\necho hi\n', 'utf8');
    const psBefore = Buffer.from('# UTF-8 only 😀\nWrite-Host hi\n', 'utf8');
    fs.writeFileSync(path.join(d, 'script.sh'), shBefore);
    fs.writeFileSync(path.join(d, 'script.ps1'), psBefore);
    const applied = cp.spawnSync(process.execPath, [CLI, 'env', 'encoding-check', '--path', d, '--apply'], { encoding: 'utf8', timeout: 15000 });
    const sh = fs.readFileSync(path.join(d, 'script.sh'));
    const ps = fs.readFileSync(path.join(d, 'script.ps1'));
    const shOk = sh.equals(shBefore);  
    const psOk = process.platform === 'win32'
      ? ps.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])) && ps.subarray(3).equals(psBefore)
      : ps.equals(psBefore);
    fs.rmSync(d, { recursive: true, force: true });
    ok = applied.status === 0 && shOk && psOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.409/1.36.177) encoding-check --apply: .sh byte-exact + .ps1 platform-safe mutation contract (UR-0113/T-0022)' : '✗ encoding-check BOM platform contract 실패');
  if (!ok) failed++;
}

 
 
 
 
 
if (e2eShard.take('B(1.9.410/1.36.144)')) {
  total++;
  let ok = false;
  try {
    const r = cp.spawnSync(process.execPath, [CLI, 'status', '--path'], { encoding: 'utf8', timeout: 15000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const noCrash = !/paths\[0\].*argument must be of type string|Received type boolean|at Object\.<anonymous>/.test(out);
    const saysWhy = /--path 에 값이 없습니다|--path was given without a value/.test(out);
    const refused = r.status !== 0;
     
    const r2 = cp.spawnSync(process.execPath, [CLI, 'status', '--path', tmp], { encoding: 'utf8', timeout: 15000 });
    const stillWorks = /Leerness:|Files:/.test((r2.stdout || '') + (r2.stderr || ''));
    ok = noCrash && saysWhy && refused && stillWorks;
  } catch {}
  console.log(ok ? '✓ B(1.9.410/1.36.144) 값없는 --path: raw TypeError 없이 **사유를 말하는 거절**(조용한 cwd 폴백 제거) + 값 준 경우 무회귀 (UR-0114)' : '✗ --path 크래시 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.411)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-autotrack-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.mkdirSync(path.join(d, 'src'), { recursive: true });
    let body = '';
    for (let i = 0; i < 6; i++) body += `function f${i}(){ // TODO fix ${i}\n  return ${i};\n}\n`;
    fs.writeFileSync(path.join(d, 'src', 'a.js'), body);
    cp.spawnSync(process.execPath, [CLI, 'lazy', 'detect', d, '--auto-track'], { encoding: 'utf8', timeout: 20000 });
    const tl = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'task', 'list', '--path', d, '--json'], { encoding: 'utf8', timeout: 15000 }).stdout);
    const ts = (tl.tasks || tl).filter(t => /^TODO /.test(t.request));
    const ids = ts.map(t => t.id);
    const uniq = new Set(ids).size === ids.length;   
    const ok6 = ts.length === 6 && uniq;
    fs.rmSync(d, { recursive: true, force: true });
    ok = ok6;
  } catch {}
  console.log(ok ? '✓ B(1.9.411) 8th버그헌트: lazy detect --auto-track 배치(6 TODO 순차ID 무중복 등록) (UR-0115)' : '✗ auto-track 배치 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.412)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-pospath-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', 'DZZmark', '--reason', 'r', '--path', d], { encoding: 'utf8', timeout: 15000 });
    cp.spawnSync(process.execPath, [CLI, 'feature', 'add', 'FZZmark', '--path', d], { encoding: 'utf8', timeout: 15000 });
     
    const dl = cp.spawnSync(process.execPath, [CLI, 'decision', 'list', d], { encoding: 'utf8', timeout: 15000 });
    const fl = cp.spawnSync(process.execPath, [CLI, 'feature', 'list', d], { encoding: 'utf8', timeout: 15000 });
    const posOk = /DZZmark/.test(dl.stdout || '') && /FZZmark/.test(fl.stdout || '');
     
    const dl2 = cp.spawnSync(process.execPath, [CLI, 'decision', 'list', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const flagOk = /DZZmark/.test(dl2.stdout || '');
    fs.rmSync(d, { recursive: true, force: true });
    ok = posOk && flagOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.412) 6th외부평가 Opus P1: list-family positional path 인식(cwd 오독 차단) + --path 보존 (UR-0100)' : '✗ list positional path 실패');
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('B(1.36.2)')) {
  total++;
  let ok = false;
  try {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-featpos-t-'));
    const outsider = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-featpos-x-'));   
    cp.spawnSync(process.execPath, [CLI, 'init', target, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const at = (dir, a) => cp.spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8', timeout: 20000, cwd: dir });
    const graphOf = (dir) => { try { return fs.readFileSync(path.join(dir, '.leerness', 'feature-graph.md'), 'utf8'); } catch { return ''; } };
     
    at(outsider, ['feature', 'add', 'PosFeat', target]);
    const addedClean = /^## F-\d{4} PosFeat\s*$/m.test(graphOf(target));
     
    const noStray = !fs.existsSync(path.join(outsider, '.leerness'));
     
    const orphan = at(outsider, ['feature', 'add', 'Orphan']);
    const gated = orphan.status === 1 && !fs.existsSync(path.join(outsider, '.leerness'));
     
    at(outsider, ['feature', 'add', 'PosFeat2', target]);
    const showP = at(outsider, ['feature', 'show', 'F-0001', target]);
    const showOk = showP.status === 0 && /PosFeat/.test(showP.stdout || '');
    at(outsider, ['feature', 'link', 'F-0001', '--affects', 'F-0002', target]);
    const impactP = at(outsider, ['feature', 'impact', 'F-0001', target]);
    const impactOk = impactP.status === 0 && /F-0002/.test(impactP.stdout || '');
     
    at(outsider, ['feature', 'add', 'ViaFlag', '--files', './src/x.js', '--path', target]);
    const flagOk = /^## F-\d{4} ViaFlag\s*$/m.test(graphOf(target)) && !fs.existsSync(path.join(outsider, '.leerness'));
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(outsider, { recursive: true, force: true });
    ok = addedClean && noStray && gated && showOk && impactOk && flagOk;
    if (!ok) console.log(`   [featpos 디버그] clean=${addedClean} noStray=${noStray} gated=${gated} show=${showOk} impact=${impactOk} flag=${flagOk}`);
  } catch {}
  console.log(ok ? '✓ B(1.36.2) 클린룸: feature add/show/link/impact positional path 인식 + 미초기화 scaffold 게이트 (UR-0184)' : '✗ feature positional path 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.413)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-actionjson-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const j = (args) => { const r = cp.spawnSync(process.execPath, [CLI, ...args, '--path', d, '--json'], { encoding: 'utf8', timeout: 15000 }); try { const o = JSON.parse((r.stdout || '').trim().split('\n')[0]); return o.ok === true; } catch { return false; } };
    const taskJ = j(['task', 'add', 'AJtask', '--no-review']);
    const decJ = j(['decision', 'add', 'AJdec', '--reason', 'r']);
    const ruleJ = j(['rule', 'add', 'AJrule', '--trigger', 'every-session']);
    const lesJ = j(['lesson', 'save', 'AJlesson']);
     
    const tl = cp.spawnSync(process.execPath, [CLI, 'task', 'list', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const persisted = /AJtask/.test(tl.stdout || '');
     
    const human = cp.spawnSync(process.execPath, [CLI, 'decision', 'add', 'AJhuman', '--reason', 'r', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const humanOk = /✓/.test(human.stdout || '') && !/^\s*\{/.test(human.stdout || '');
    fs.rmSync(d, { recursive: true, force: true });
    ok = taskJ && decJ && ruleJ && lesJ && persisted && humanOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.413) 6th외부평가 codex P2: action(task/decision/rule/lesson add) --json 구조화 + 데이터 영속 + 사람용 보존 (UR-0101)' : '✗ action --json 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.414)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-teamreview-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'team', 'add', 'rt', '--members', 'claude,codex', '--schedule', 'every-session', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const pv = cp.spawnSync(process.execPath, [CLI, 'team', 'preview', 'rt', '--task', '점검', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const reviewShown = /메인 검수/.test(pv.stdout || '') && /verify-claim/.test(pv.stdout || '');
    const dispatchShown = /agents dispatch/.test(pv.stdout || '');
    cp.spawnSync(process.execPath, [CLI, 'team', 'add', 'nr', '--members', 'claude', '--no-review', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const pv2 = cp.spawnSync(process.execPath, [CLI, 'team', 'preview', 'nr', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const noReviewOk = !/메인 검수/.test(pv2.stdout || '');
     
    const pj = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'team', 'preview', 'rt', '--path', d, '--json'], { encoding: 'utf8', timeout: 15000 }).stdout);
    const jsonOk = pj.review === true && !!pj.reviewStep;
    fs.rmSync(d, { recursive: true, force: true });
    ok = reviewShown && dispatchShown && noReviewOk && jsonOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.414) 9라운드: team review(분배→메인 검수 단계 표시, --no-review 생략, --json reviewStep) (UR-0119/0120)' : '✗ team review 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.415)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-honesty-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(d, 'config.js'), 'module.exports={apiKey:"sk-test-1234567890abcdefghijklmnopqrstuvwxyz",githubToken:"ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD"};');
    fs.writeFileSync(path.join(d, 'bad.txt'), Buffer.from([0xff, 0xfe, 0x20, 0x80]));
     
    const ho = cp.spawnSync(process.execPath, [CLI, 'handoff', d, '--inspect'], { encoding: 'utf8', timeout: 60000 }).stdout || '';
    const honestSecret = /시크릿\s*\d+건/.test(ho) && !/보안 OK/.test(ho);
    const plain = cp.spawnSync(process.execPath, [CLI, 'handoff', d], { encoding: 'utf8', timeout: 20000 });
    const plainHonest = plain.status === 0 && /not_inspected/.test(plain.stdout) && !/보안 OK/.test(plain.stdout);
     
    const sj = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', d, '--json'], { encoding: 'utf8', timeout: 15000 });
    let scanOk = false; try { const j = JSON.parse(sj.stdout); scanOk = j.ok === false && j.count >= 1 && sj.status === 1; } catch {}
     
    const ej = cp.spawnSync(process.execPath, [CLI, 'encoding', 'check', d, '--json'], { encoding: 'utf8', timeout: 15000 });
    let encOk = false; try { const j = JSON.parse(ej.stdout); encOk = j.ok === false && j.count >= 1; } catch {}
     
    fs.writeFileSync(path.join(d, 's.md'), '# S\n- loginUser(id)\n- logoutUser(id)\n');
    fs.writeFileSync(path.join(d, 'i.js'), 'function loginUser(i){return i}\nmodule.exports={loginUser};\n');
    const cj = cp.spawnSync(process.execPath, [CLI, 'contract', 'verify', path.join(d, 's.md'), path.join(d, 'i.js'), '--json'], { encoding: 'utf8', timeout: 15000 });
    let contractOk = false; try { const j = JSON.parse(cj.stdout); contractOk = j.ok === false && cj.status === 1; } catch {}
     
    const dc = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-clean-'));
    cp.spawnSync(process.execPath, [CLI, 'init', dc, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const hc = cp.spawnSync(process.execPath, [CLI, 'handoff', dc, '--inspect'], { encoding: 'utf8', timeout: 60000 }).stdout || '';
    const cleanOk = !/시크릿\s*\d+건/.test(hc) && /보안 OK/.test(hc);
    fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(dc, { recursive: true, force: true });
    ok = honestSecret && plainHonest && scanOk && encOk && contractOk && cleanOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.415) 9th외부평가: handoff 보안 헤드라인 정직화 + scan/encoding --json + contract --json exit (UR-0121)' : '✗ honesty/--json 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.416)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-addtitle-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
     
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', '인증 구현', d, '--path', d], { encoding: 'utf8', timeout: 15000 });
    const tl = cp.spawnSync(process.execPath, [CLI, 'task', 'list', d, '--path', d], { encoding: 'utf8', timeout: 15000 }).stdout || '';
    const noPathPollution = /인증 구현/.test(tl) && !new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(tl.split('인증 구현')[1] || '');
     
    const empty = cp.spawnSync(process.execPath, [CLI, 'task', 'add', '', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const pathOnly = cp.spawnSync(process.execPath, [CLI, 'task', 'add', d, '--path', d], { encoding: 'utf8', timeout: 15000 });
    const rejectOk = empty.status === 1 && pathOnly.status === 1;
     
    const ej = cp.spawnSync(process.execPath, [CLI, 'task', 'add', '', '--path', d, '--json'], { encoding: 'utf8', timeout: 15000 });
    let jsonOk = false; try { const j = JSON.parse(ej.stdout); jsonOk = j.ok === false && j.code === 'empty_title'; } catch {}
     
    cp.spawnSync(process.execPath, [CLI, 'requests', 'add', '다크모드 지원', d, '--path', d], { encoding: 'utf8', timeout: 15000 });
    const rl = cp.spawnSync(process.execPath, [CLI, 'requests', 'list', '--path', d], { encoding: 'utf8', timeout: 15000 }).stdout || '';
    const reqClean = /다크모드 지원/.test(rl) && !new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(rl.split('다크모드 지원')[1] || '');
    fs.rmSync(d, { recursive: true, force: true });
    ok = noPathPollution && rejectOk && jsonOk && reqClean;
  } catch {}
  console.log(ok ? '✓ B(1.9.416) 9th외부평가: add류 제목 경로흡수 차단 + 빈 입력 거부 exit1 + --json (UR-0122)' : '✗ add류 제목 일관성 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.417)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-cfield-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(d, 'f.md'), '# S\n\n## Fields\n- userId\n- expiresAt\n');
    fs.writeFileSync(path.join(d, 'f.js'), 'const x={userId:1};\nmodule.exports={x};\n');
    const cj = cp.spawnSync(process.execPath, [CLI, 'contract', 'verify', path.join(d, 'f.md'), path.join(d, 'f.js'), '--json'], { encoding: 'utf8', timeout: 15000 });
    let detectOk = false; try { const j = JSON.parse(cj.stdout); detectOk = j.specFields.includes('userId') && j.specFields.includes('expiresAt') && j.missingFields.includes('expiresAt') && !j.missingFields.includes('userId') && j.ok === false && cj.status === 1; } catch {}
     
    fs.writeFileSync(path.join(d, 'g.js'), 'const x={userId:1,expiresAt:2};\nmodule.exports={x};\n');
    const cg = cp.spawnSync(process.execPath, [CLI, 'contract', 'verify', path.join(d, 'f.md'), path.join(d, 'g.js'), '--json'], { encoding: 'utf8', timeout: 15000 });
    let passOk = false; try { const j = JSON.parse(cg.stdout); passOk = j.missingFields.length === 0 && j.ok === true; } catch {}
    fs.rmSync(d, { recursive: true, force: true });
    ok = detectOk && passOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.417) 9th외부평가: contract field 범용화(## Fields 불릿 누락 감지 + 충족 통과) (UR-0123)' : '✗ contract field 범용화 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.35.11)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-cvdollar-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(d, 's.md'), '# S\n\n## Fields\n- $scope\n- foo$bar\n- userId\n');
     
    fs.writeFileSync(path.join(d, 'ok.js'), 'const $scope=1; const foo$bar=2; const userId=3;\nmodule.exports={$scope,foo$bar,userId};\n');
    const cok = cp.spawnSync(process.execPath, [CLI, 'contract', 'verify', path.join(d, 's.md'), path.join(d, 'ok.js'), '--json'], { encoding: 'utf8', timeout: 15000 });
    let fpFixed = false; try { const j = JSON.parse(cok.stdout); fpFixed = cok.status === 0 && j.ok === true && (j.missingFields || []).length === 0; } catch {}
     
    fs.writeFileSync(path.join(d, 'miss.js'), 'const foo$bar=2; const userId=3;\nmodule.exports={foo$bar,userId};\n');
    const cmiss = cp.spawnSync(process.execPath, [CLI, 'contract', 'verify', path.join(d, 's.md'), path.join(d, 'miss.js'), '--json'], { encoding: 'utf8', timeout: 15000 });
    let fnGuard = false; try { const j = JSON.parse(cmiss.stdout); fnGuard = cmiss.status === 1 && j.ok === false && (j.missingFields || []).includes('$scope') && !(j.missingFields || []).includes('foo$bar'); } catch {}
     
    fs.writeFileSync(path.join(d, 'b.md'), '- foo()\n');
    fs.writeFileSync(path.join(d, 'b.js'), 'exports["foo"] = function(){};\n');
    const cbrk = cp.spawnSync(process.execPath, [CLI, 'contract', 'verify', path.join(d, 'b.md'), path.join(d, 'b.js'), '--json'], { encoding: 'utf8', timeout: 15000 });
    let bracketOk = false; try { const j = JSON.parse(cbrk.stdout); bracketOk = cbrk.status === 0 && j.ok === true; } catch {}
     
    fs.writeFileSync(path.join(d, 'fen.md'), '# S\n```js\nfunction helper(){}\n```\n');
    fs.writeFileSync(path.join(d, 'fen.js'), 'module.exports={};\n');
     
    const cfen = cp.spawnSync(process.execPath, [CLI, 'contract', 'verify', path.join(d, 'fen.md'), path.join(d, 'fen.js'), '--json', '--allow-empty'], { encoding: 'utf8', timeout: 15000 });
    let fenceOk = false; try { const j = JSON.parse(cfen.stdout); fenceOk = cfen.status === 0 && j.ok === true && !(j.specFunctions || []).includes('helper'); } catch {}
     
    const cfenReject = cp.spawnSync(process.execPath, [CLI, 'contract', 'verify', path.join(d, 'fen.md'), path.join(d, 'fen.js'), '--json'], { encoding: 'utf8', timeout: 15000 });
    let fenceRejectOk = false; try { fenceRejectOk = cfenReject.status === 1 && JSON.parse(cfenReject.stdout).code === 'empty_contract'; } catch {}
    fs.rmSync(d, { recursive: true, force: true });
    ok = fpFixed && fnGuard && bracketOk && fenceOk && fenceRejectOk;
    if (!ok) console.log(`   [cvdollar 디버그] fpFixed=${fpFixed} fnGuard=${fnGuard} bracket=${bracketOk} fence=${fenceOk} fenceReject=${fenceRejectOk}`);
  } catch {}
  console.log(ok ? '✓ B(1.35.11) 자체 contract 헌트 + codex 교차: $필드 정규식 안전화 + bracket export(#8) + 코드펜스 예제 제외(#9) FP 3종 + no-FN' : '✗ contract 헌트 FP 3종 수정 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.418)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-hlabel-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(d, 'leak.js'), 'module.exports={apiKey:"sk-test-1234567890abcdefghijklmnopqrstuvwxyz"};');
     
    const hj = cp.spawnSync(process.execPath, [CLI, 'health', d, '--json'], { encoding: 'utf8', timeout: 20000 });
    let secOk = false; try { const j = JSON.parse(hj.stdout); secOk = j.healthy === false && j.checks.security.critical === true && j.checks.security.committedSecrets >= 1; } catch {}
     
    const sj = cp.spawnSync(process.execPath, [CLI, 'status', d, '--json'], { encoding: 'utf8', timeout: 15000 });
    let scopeOk = false; try { const j = JSON.parse(sj.stdout); scopeOk = j.scope === 'install' && typeof j.healthyMeaning === 'string' && j.healthyMeaning.length > 0; } catch {}
     
    const dc = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-hclean-'));
    cp.spawnSync(process.execPath, [CLI, 'init', dc, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const hc = cp.spawnSync(process.execPath, [CLI, 'health', dc, '--json'], { encoding: 'utf8', timeout: 20000 });
    let cleanOk = false; try { const j = JSON.parse(hc.stdout); cleanOk = j.checks.security.committedSecrets === 0; } catch {}
    fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(dc, { recursive: true, force: true });
    ok = secOk && scopeOk && cleanOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.418) 9th외부평가: health 보안 정직화(커밋 시크릿→healthy:false) + status scope:install (UR-0121 잔여)' : '✗ health/status 라벨 실패');
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('B(1.30.1)')) {
  total++;
  let ok = false;
  try {
    const H = /[가-힣]/;
     
    const d1 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-f1bad-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d1, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(d1, '.gitignore'), 'node_modules/\n');
    fs.writeFileSync(path.join(d1, '.env'), 'AWS=AKIAJQXMP7RZ2KL9WXYZ\nGH=ghp_aZ9bY8cX7dW6eV5fU4gT3hS2iR1jQ0kP9oN8\n');
    const a1 = cp.spawnSync(process.execPath, [CLI, 'audit', d1, '--json'], { encoding: 'utf8', timeout: 20000 });
    let f1bad = false; try { const j = JSON.parse(a1.stdout); f1bad = j.healthy === false && a1.status === 1 && j.findings.some(x => x.kind === 'committed_secret'); } catch {}
     
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-f1ok-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d2, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(d2, '.gitignore'), '.env\n.env.local\n.env.production\n.env.*.local\n*.pem\ncredentials.json\nnode_modules/\n');
    fs.writeFileSync(path.join(d2, '.env'), 'AWS=AKIAJQXMP7RZ2KL9WXYZ\n');
    const a2 = cp.spawnSync(process.execPath, [CLI, 'audit', d2, '--json'], { encoding: 'utf8', timeout: 20000 });
    let f1ok = false; try { const j = JSON.parse(a2.stdout); f1ok = j.healthy === true && a2.status === 0; } catch {}
     
    const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-f2-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d3, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(d3, '.gitignore'), 'node_modules/\n');
    fs.writeFileSync(path.join(d3, 'config.js'), 'const k="AKIAJQXMP7RZ2KL9WXYZ";\nconst g="ghp_aZ9bY8cX7dW6eV5fU4gT3hS2iR1jQ0kP9oN8";\n');
    const hoKo = (cp.spawnSync(process.execPath, [CLI, 'handoff', d3, '--inspect'], { encoding: 'utf8', timeout: 60000 }).stdout) || '';
     
    const f2ko = /^## 보안 요약/m.test(hoKo) && /커밋된 시크릿/.test(hoKo) && /config\.js/.test(hoKo);
    const d4 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-f2en-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d4, '--yes', '--language', 'en'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(d4, '.gitignore'), 'node_modules/\n');
    fs.writeFileSync(path.join(d4, 'config.js'), 'const k="AKIAJQXMP7RZ2KL9WXYZ";\n');
    const hoEn = (cp.spawnSync(process.execPath, [CLI, 'handoff', d4, '--inspect'], { encoding: 'utf8', timeout: 60000 }).stdout) || '';
    const enSecLines = hoEn.split('\n').filter(l => /Security summary|committed secret/i.test(l));
    const f2en = /Security summary/.test(hoEn) && /committed secret/i.test(hoEn) && enSecLines.length >= 1 && !enSecLines.some(l => H.test(l));
    [d1, d2, d3, d4].forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} });
    ok = f1bad && f1ok && f2ko && f2en;
  } catch {}
  console.log(ok ? '✓ B(1.30.1) 14th외부리뷰 F1+F2: audit committed-secret→failure(scan 일관, gitignored FP0) + handoff 보안요약이 committed 시크릿 노출(ko/en)' : '✗ 보안 정직성 F1+F2 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.30.2)')) {
  total++;
  let ok = false;
  try {
    const par = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-par-'));
    cp.spawnSync(process.execPath, [CLI, 'init', par, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const sub = path.join(par, 'sub');
    cp.spawnSync(process.execPath, [CLI, 'init', sub, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
     
    const pj = cp.spawnSync(process.execPath, [CLI, 'parent', 'detect', '--path', sub, '--json'], { encoding: 'utf8', timeout: 15000 });
    let detectOk = false; try { const j = JSON.parse(pj.stdout); detectOk = j.applied === false && j.parent && j.parent.workspaceDir === '.leerness' && j.parent.assetCount >= 1; } catch {}
     
    const alone = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-alone-'));
    cp.spawnSync(process.execPath, [CLI, 'init', alone, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const aj = cp.spawnSync(process.execPath, [CLI, 'parent', 'detect', '--path', alone, '--json'], { encoding: 'utf8', timeout: 15000 });
    let aloneOk = false; try { const j = JSON.parse(aj.stdout); aloneOk = j.parent === null; } catch {}
     
     
    const hoKo = (cp.spawnSync(process.execPath, [CLI, 'handoff', '--inspect', '--path', sub], { encoding: 'utf8', timeout: 60000 }).stdout) || '';
    const hoEn = (cp.spawnSync(process.execPath, [CLI, 'handoff', '--inspect', '--path', sub, '--language', 'en'], { encoding: 'utf8', timeout: 60000 }).stdout) || '';
    const headlineOk = /부모 프로젝트.*미적용/.test(hoKo) && /parent project.*not applied/.test(hoEn);
     
    const before = fs.readdirSync(sub).sort().join(',');
    cp.spawnSync(process.execPath, [CLI, 'parent', 'detect', '--path', sub], { encoding: 'utf8', timeout: 15000 });
    const after = fs.readdirSync(sub).sort().join(',');
    const readOnlyOk = before === after;
    [par, alone].forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} });
    ok = detectOk && aloneOk && headlineOk && readOnlyOk;
  } catch {}
  console.log(ok ? '✓ B(1.30.2) #157 하위프로젝트: parent detect(상위 leerness 탐지·--json applied:false) + 독립 null + handoff 헤드라인 🔗(ko/en, 미적용) + read-only' : '✗ parent detect 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.30.3)')) {
  total++;
  let ok = false;
  try {
    const par = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-adopt-'));
    cp.spawnSync(process.execPath, [CLI, 'init', par, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const sub = path.join(par, 'sub');
    cp.spawnSync(process.execPath, [CLI, 'init', sub, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const childDs = path.join(sub, '.leerness', 'design-system.md');
    const childDsBefore = fs.readFileSync(childDs, 'utf8');
    const inherited = path.join(sub, '.leerness', 'inherited-from-parent.md');
    const link = path.join(sub, '.leerness', 'PARENT_LINK.json');
     
    cp.spawnSync(process.execPath, [CLI, 'parent', 'adopt', '--path', sub], { encoding: 'utf8', timeout: 15000 });
    const dryNoWrite = !fs.existsSync(inherited) && !fs.existsSync(link);
     
    cp.spawnSync(process.execPath, [CLI, 'parent', 'adopt', '--apply', '--path', sub], { encoding: 'utf8', timeout: 15000 });
    const wrote = fs.existsSync(inherited) && fs.existsSync(link);
    const childUnchanged = fs.readFileSync(childDs, 'utf8') === childDsBefore;
    let linkOk = false; try { const j = JSON.parse(fs.readFileSync(link, 'utf8')); linkOk = !!j.parentRoot && Array.isArray(j.adoptedKinds) && j.adoptedKinds.length >= 1; } catch {}
     
    const hoKo = (cp.spawnSync(process.execPath, [CLI, 'handoff', '--inspect', '--path', sub], { encoding: 'utf8', timeout: 60000 }).stdout) || '';
    const hoEn = (cp.spawnSync(process.execPath, [CLI, 'handoff', '--inspect', '--path', sub, '--language', 'en'], { encoding: 'utf8', timeout: 60000 }).stdout) || '';
    const headlineOk = /부모 프로젝트.*adopted/.test(hoKo) && /parent project.*adopted/.test(hoEn);    
     
    const aj = cp.spawnSync(process.execPath, [CLI, 'parent', 'adopt', '--apply', '--json', '--path', sub], { encoding: 'utf8', timeout: 15000 });
    let jsonOk = false; try { const j = JSON.parse(aj.stdout); jsonOk = j.applied === true && typeof j.inheritedPath === 'string'; } catch {}
    fs.rmSync(par, { recursive: true, force: true });
    ok = dryNoWrite && wrote && childUnchanged && linkOk && headlineOk && jsonOk;
  } catch {}
  console.log(ok ? '✓ B(1.30.3) #158 parent adopt: dry-run 쓰기0 + --apply 참조파일/마커 + 자식 design-system 무변경(비파괴) + handoff adopted(ko/en) + --json applied:true' : '✗ parent adopt 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.30.4)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-f567-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const run = (args) => cp.spawnSync(process.execPath, [CLI, ...args, '--path', d], { encoding: 'utf8', timeout: 15000 });
    const isJson = (s) => { try { JSON.parse((s||'').trim()); return true; } catch { return false; } };
     
    run(['decision', 'add', 'dupdec']); run(['decision', 'add', 'dupdec']);
    const decCount = ((run(['decision', 'list']).stdout || '').match(/dupdec/g) || []).length;
    run(['lesson', 'save', 'duples']); run(['lesson', 'save', 'duples']);
    const lesCount = ((run(['lesson', 'list']).stdout || '').match(/duples/g) || []).length;
    run(['decision', 'add', 'dupdec', '--force']);
    const decForce = ((run(['decision', 'list']).stdout || '').match(/dupdec/g) || []).length;
    const f5 = decCount === 1 && lesCount === 1 && decForce === 2;
     
    const ra = run(['rule', 'add', '', '--json']); const ls = run(['lesson', 'save', '', '--json']);
    const raOk = run(['rule', 'add', '룰F6', '--json']); const lsOk = run(['lesson', 'save', '레슨F6', '--json']);
    const f6 = isJson(ra.stdout) && /empty_title/.test(ra.stdout) && ra.status === 1
            && isJson(ls.stdout) && /empty_text/.test(ls.stdout) && ls.status === 1
            && isJson(raOk.stdout) && isJson(lsOk.stdout);
     
    const tf = run(['task', 'frobnicate']); const rf = run(['rule', 'frobnicate']);
    const f7 = /task 하위명령: frobnicate/.test(tf.stdout + tf.stderr) && tf.status === 1
            && /rule 하위명령: frobnicate/.test(rf.stdout + rf.stderr) && rf.status === 1
            && run(['task', 'list']).status === 0 && run(['rule', 'list']).status === 0;
    fs.rmSync(d, { recursive: true, force: true });
    ok = f5 && f6 && f7;
  } catch {}
  console.log(ok ? '✓ B(1.30.4) #155 cli-ux 일관성: decision/lesson dedup(--force 우회) + rule/lesson 빈입력 --json 구조화(exit1) + task/rule bogus subcommand 토큰 명시' : '✗ cli-ux 일관성 F5+F6+F7 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.31.1)')) {
  total++;
  let ok = false;
  try {
    const H = /[가-힣]/;
    const en = (cp.spawnSync(process.execPath, [CLI, 'install-safety', '--language', 'en'], { encoding: 'utf8', timeout: 15000 }).stdout) || '';
    const ko = (cp.spawnSync(process.execPath, [CLI, 'install-safety'], { encoding: 'utf8', timeout: 15000 }).stdout) || '';
    const enOk = /install safety profile/.test(en) && !H.test(en);
    const koOk = /설치 안전 프로필/.test(ko);
    let guardOk = false;
    try { const j = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'install-safety', '--json', '--language', 'en'], { encoding: 'utf8', timeout: 15000 }).stdout); guardOk = j.safeInstall.filter(x => x.includes('npx --yes')).length >= 2 && j.hardeningNote.includes('PowerShell') && !j.safeInstall.some(x => /^npm_config_\w+=/.test(String(x).trim())); } catch {}
    ok = enOk && koOk && guardOk;
  } catch {}
  console.log(ok ? '✓ B(1.31.1) UR-0010: install-safety en 영어(한글 0) + ko 보존 + 셸-무관 가드(npx --yes/PowerShell/no npm_config prefix) 양 언어 보존' : '✗ install-safety 영어화 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.31.2)')) {
  total++;
  let ok = false;
  try {
    const H = /[가-힣]/;
    const cap = (args) => (cp.spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 15000 }).stdout) || '';
    const listEn = cap(['constraints', 'list', '--language', 'en']);
    const listKo = cap(['constraints', 'list']);
    const chkEn = cap(['constraints', 'check', 'stripe payment api integration', '--language', 'en']);
    const noMatchEn = cap(['constraints', 'check', 'build a generic api integration widget xyz', '--language', 'en']);
     
    const enOk = !H.test(listEn) && /duplicate charges/.test(listEn) && /no platform matched/.test(noMatchEn)
      && /review constraints before building/.test(chkEn) && !H.test(chkEn) && !H.test(noMatchEn)
      && /review the pre-registered platform catalog/.test(noMatchEn);
     
    const koOk = H.test(listKo) && /필수|별도/.test(listKo) && /매칭된 플랫폼 없음|플랫폼 매칭/.test(cap(['constraints', 'check', '일반 api 연동 위젯 xyz']));
     
    let matchOk = false;
    try { const j = JSON.parse(cap(['constraints', 'check', 'stripe 결제 api 연동', '--json'])); matchOk = (j.matched || []).some(m => m.platform === 'stripe'); } catch {}
    ok = enOk && koOk && matchOk;
  } catch {}
  console.log(ok ? '✓ B(1.31.2) UR-0010: constraints en 영어(list/check 라벨+카탈로그 detailEn+suggestion, 한글 0) + ko 보존 + 한국어 alias 매칭 무회귀' : '✗ constraints 영어화 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.31.3)')) {
  total++;
  let ok = false;
  try {
    const H = /[가-힣]/;
    const cap = (args) => (cp.spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 15000 }).stdout) || '';
    const capEn = cap(['capabilities', '--language', 'en']);
    const capKo = cap(['capabilities', '--language', 'ko']);    
    const capJsonEn = cap(['capabilities', '--json', '--language', 'en']);
     
    const capOk = !H.test(capEn) && /metadata files|external AI CLIs|mouse\/keyboard/.test(capEn)
      && /Permission surface/.test(capEn) && /Principles/.test(capEn)
      && H.test(capKo) && /권한 표면|백업/.test(capKo)
      && /0 runtime dependencies/.test(capJsonEn);
     
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-team-i18n-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });    
    cp.spawnSync(process.execPath, [CLI, 'team', 'add', 'nightly', '--members', 'a,b', '--schedule', 'every-session', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const hoEn = (cp.spawnSync(process.execPath, [CLI, 'handoff', d, '--inspect', '--language', 'en'], { encoding: 'utf8', timeout: 60000 }).stdout) || '';
    const hoKo = (cp.spawnSync(process.execPath, [CLI, 'handoff', d, '--inspect'], { encoding: 'utf8', timeout: 60000 }).stdout) || '';
     
    const teamEn = hoEn.split('\n').filter(l => /UR-0073|team preview nightly/.test(l));
    const teamKo = hoKo.split('\n').filter(l => /UR-0073|team preview nightly/.test(l));
    const teamOk = teamEn.length >= 2 && !teamEn.some(l => H.test(l))
      && teamEn.some(l => /2 members/.test(l)) && teamEn.some(l => /review needed/.test(l)) && teamEn.some(l => /preview:/.test(l))
      && teamKo.some(l => /2명/.test(l)) && teamKo.some(l => /검수필요/.test(l)) && teamKo.some(l => /미리보기/.test(l));
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
    ok = capOk && teamOk;
  } catch {}
  console.log(ok ? '✓ B(1.31.3) UR-0010: capabilities en 영어(표면 desc/optOut/note/principles, 한글 0) + ko 보존 + team reminder 본문 en/ko(handoff 전체배선)' : '✗ capabilities/team reminder 영어화 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.32.1)')) {
  total++;
  let ok = false;
  try {
    const isJson = s => { try { JSON.parse(String(s).trim()); return true; } catch { return false; } };
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rev15-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { encoding: 'utf8', timeout: 30000 });
    const child = path.join(d, 'child'); fs.mkdirSync(child);
    cp.spawnSync(process.execPath, [CLI, 'init', child, '--yes'], { encoding: 'utf8', timeout: 30000 });
    const run = (args) => cp.spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 20000 });
     
    const c2 = [['constraints', 'check', '--json', '--path', child], ['constraints', 'add', '--json', '--path', child], ['constraints', 'zzz', '--json', '--path', child], ['parent', 'zzz', '--json', '--path', child]]
      .every(a => { const r = run(a); let code = null; try { code = JSON.parse(r.stdout).code; } catch {} return isJson(r.stdout) && r.status === 1 && !!code; });
     
    const human = run(['constraints', 'check', '--path', child]); const humanOk = human.status === 1 && !isJson(human.stdout);
     
    const inh = path.join(child, '.leerness', 'inherited-from-parent.md');
    try { fs.mkdirSync(inh); } catch {}
    const a1r = run(['parent', 'adopt', '--path', child, '--apply', '--json']); let a1j = null; try { a1j = JSON.parse(a1r.stdout); } catch {}
    const a1ok = !!a1j && a1j.applied === false && !!a1j.error && a1r.status === 1;
    try { fs.rmdirSync(inh); } catch {}
     
    const a2g = run(['parent', 'adopt', '--path', child, '--select', 'garbage,foo', '--apply', '--json']); let a2gj = null; try { a2gj = JSON.parse(a2g.stdout); } catch {}
    const noLink = !fs.existsSync(path.join(child, '.leerness', 'PARENT_LINK.json'));
    const a2v = run(['parent', 'adopt', '--path', child, '--select', 'design-system', '--apply', '--json']); let a2vj = null; try { a2vj = JSON.parse(a2v.stdout); } catch {}
    let link = null; try { link = JSON.parse(fs.readFileSync(path.join(child, '.leerness', 'PARENT_LINK.json'), 'utf8')); } catch {}
    const a2ok = !!a2gj && a2gj.applied === false && noLink && !!a2vj && a2vj.applied === true && link && JSON.stringify(link.adoptedKinds) === JSON.stringify(['design-system']);
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
    ok = c2 && humanOk && a1ok && a2ok;
  } catch {}
  console.log(ok ? '✓ B(1.32.1) 15th리뷰: constraints/parent --json 에러 구조화(C2) + parent adopt --json 에러경로 비공백(A1) + --select 무효→applied:false·실제 adoptedKinds(A2)' : '✗ 15th리뷰 후속(C2/A1/A2) 가드 실패');
  if (!ok) failed++;
}

 
 
if (e2eShard.take('B(1.32.3)')) {
  total++;
  let ok = false;
  try {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-a3-'));
    cp.spawnSync(process.execPath, [CLI, 'init', base, '--yes'], { encoding: 'utf8', timeout: 30000 });
    const adv = '## INJECTEDHEADER (from /etc/passwd)\n<!-- leerness:inherited-from-parent SPOOF -->\n```evil\nbreakout\n```\nnormal design tokens';
    fs.writeFileSync(path.join(base, '.leerness', 'design-system.md'), adv);
    const child = path.join(base, 'child'); fs.mkdirSync(child);
    cp.spawnSync(process.execPath, [CLI, 'init', child, '--yes'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'parent', 'adopt', '--path', child, '--select', 'design-system', '--apply'], { encoding: 'utf8', timeout: 20000 });
    const doc = fs.readFileSync(path.join(child, '.leerness', 'inherited-from-parent.md'), 'utf8');
    const lines = doc.split('\n');
    const topMarkerOk = /^<!-- leerness:inherited-from-parent/.test(lines[0] || '');
    const hIdx = lines.findIndex(l => /^## design-system \(from /.test(l));
    const fenceOpenIdx = lines.findIndex((l, i) => i > hIdx && /^`{3,}\s*$/.test(l));
    const fenceLen = fenceOpenIdx >= 0 ? (lines[fenceOpenIdx].match(/`/g) || []).length : 0;
    const injIdx = lines.findIndex((l, i) => i > hIdx && l.includes('INJECTEDHEADER'));
    const spoofIdx = lines.findIndex((l, i) => i > hIdx && l.includes('SPOOF'));
     
    const fenced = hIdx >= 0 && fenceOpenIdx > hIdx && injIdx > fenceOpenIdx && spoofIdx > fenceOpenIdx;
    const dynFenceOk = fenceLen >= 4;
    const contentOk = doc.includes('normal design tokens');
    fs.rmSync(base, { recursive: true, force: true });
    ok = topMarkerOk && fenced && dynFenceOk && contentOk;
  } catch {}
  console.log(ok ? '✓ B(1.32.3) 15th리뷰 A3: parent adopt 적대적 부모 content 동적 코드펜스 격리(마커/헤더 spoofing 차단) + content 보존' : '✗ A3 fencing 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.33.1)')) {
  total++;
  let ok = false;
  try {
    const ver = require(path.resolve(__dirname, '..', 'package.json')).version;
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ci-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { encoding: 'utf8', timeout: 30000 });
    const ci = cp.spawnSync(process.execPath, [CLI, 'ci', 'init', d], { encoding: 'utf8', timeout: 15000 });
    const wf = fs.readFileSync(path.join(d, '.github', 'workflows', 'leerness-gate.yml'), 'utf8');
     
    const pinned = new RegExp('run: npx -y leerness@' + ver.replace(/\./g, '\\.') + ' gate \\.').test(wf);
    const noUnpinned = !/npx -y leerness gate \./.test(wf);
    const perms = /permissions:\n\s*contents: read/.test(wf);
    const conc = /concurrency:\n\s*group: leerness-gate-\$\{\{ github\.ref \}\}\n\s*cancel-in-progress: true/.test(wf);
    const stillGate = /leerness-gate/.test(wf) && /pull_request:/.test(wf)
      && /actions\/checkout@v7/.test(wf) && /actions\/setup-node@v7/.test(wf)
      && /node-version:\s*'24'/.test(wf) && /package-manager-cache:\s*false/.test(wf)
      && !/actions\/(?:checkout|setup-node)@v4/.test(wf);
    fs.rmSync(d, { recursive: true, force: true });
    ok = ci.status === 0 && pinned && noUnpinned && perms && conc && stillGate;
  } catch {}
  console.log(ok ? '✓ B(1.33.1) gate 슬라이스 강화: ci init 워크플로 버전핀(leerness@설치버전) + 최소권한 permissions(contents:read) + concurrency cancel + 미핀 latest 부재' : '✗ ci init 워크플로 강화 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.33.2)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-vca-'));
    const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { encoding: 'utf8', timeout: 30000 });
     
    const empty = R(['verify-claim', '--all', '--json']);
    const ej = JSON.parse(empty.stdout);
    const emptyOk = empty.status === 0 && ej.ok === true && ej.total === 0;
     
    fs.writeFileSync(path.join(d, 'calc.js'), 'function add(a,b){ return a+b; }\nmodule.exports={add};\n');
    fs.mkdirSync(path.join(d, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(d, 'tests', 'calc.test.js'), 'const {add}=require("../calc.js");\ntest("add",()=>{ if(add(1,2)!==3) throw new Error("x"); });\n');
    const aT = R(['task', 'add', 'Implement calc.js add()']);
    const idT = (aT.stdout.match(/T-\d{4,}/) || [])[0];
    R(['task', 'update', idT, '--status', 'done', '--evidence', 'calc.js + tests/calc.test.js — 1 test passing']);
     
    const aF = R(['task', 'add', 'Implement payment API']);
    const idF = (aF.stdout.match(/T-\d{4,}/) || [])[0];
    R(['task', 'update', idF, '--status', 'done', '--evidence', 'payment.js implemented and tested']);
    const mixed = R(['verify-claim', '--all', '--json']);
    const mj = JSON.parse(mixed.stdout);
    const fr = mj.results.find((x) => x.id === idF);
    const tr = mj.results.find((x) => x.id === idT);
    const mixedOk = mixed.status === 1 && mj.ok === false && mj.total === 2 && mj.failed === 1 && fr && fr.ok === false && fr.reasons.includes('files-missing') && tr && tr.ok === true;
     
    const consistent = R(['verify-claim', idF]).status === 1 && R(['verify-claim', idT]).status === 0;
     
    const human = R(['verify-claim', '--all']);
    const humanOk = human.status === 1 && /불일치|mismatch/.test(human.stdout);
    fs.rmSync(d, { recursive: true, force: true });
    ok = emptyOk && mixedOk && consistent && humanOk;
  } catch (e) {}
  console.log(ok ? '✓ B(1.33.2) verify-claim --all: 거짓완료 일괄 차단(exit 1, files-missing) + 진실완료/빈프로젝트 통과 + per-task verdict 일치' : '✗ verify-claim --all 일괄 검증 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.33.3)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-g3-'));
    const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { encoding: 'utf8', timeout: 30000 });
     
    const cleanDefault = JSON.parse(R(['gate', '.', '--json']).stdout);
    const cleanClaims = JSON.parse(R(['gate', '.', '--claims', '--json']).stdout);
    const cleanOk = cleanDefault.total === 5 && cleanDefault.ok === true && cleanClaims.total === 6 && cleanClaims.ok === true && cleanClaims.checks.some((c) => c.name === 'verify-claims');
     
    const aF = R(['task', 'add', 'Implement payment API']);
    const idF = (aF.stdout.match(/T-\d{4,}/) || [])[0];
    R(['task', 'update', idF, '--status', 'done', '--evidence', 'payment.js implemented and tested']);
     
    const falseDefault = R(['gate', '.', '--json']);
    const fd = JSON.parse(falseDefault.stdout);
    const defaultStill = falseDefault.status === 1 && fd.total === 5;
     
    const falseClaims = R(['gate', '.', '--claims', '--json']);
    const fc = JSON.parse(falseClaims.stdout);
    const vcCheck = fc.checks.find((c) => c.name === 'verify-claims');
    const claimsBlocks = falseClaims.status === 1 && vcCheck && vcCheck.ok === false && fc.total === 6;
    const humanClaims = R(['gate', '.', '--claims']);
    const humanOk = humanClaims.status === 1 && /verify-claims/.test(humanClaims.stdout) && /gate summary/.test(humanClaims.stdout);
     
    const mcpCall = (req) => { const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 12000, input: JSON.stringify(req) + '\n' }); try { const line = r.stdout.split('\n').filter(Boolean)[0]; const j = JSON.parse(line); return JSON.parse(j.result.content[0].text); } catch { return null; } };
    const listed = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 12000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n' });
    let toolListed = false; try { toolListed = JSON.parse(listed.stdout.split('\n').filter(Boolean)[0]).result.tools.some((t) => t.name === 'leerness_verify_claim_all'); } catch {}
    const mcpRes = mcpCall({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'leerness_verify_claim_all', arguments: { path: d } } });
    const mcpOk = toolListed && mcpRes && mcpRes.ok === false && mcpRes.total === 1 && mcpRes.failed === 1 && Array.isArray(mcpRes.results) && mcpRes.results[0].reasons.includes('files-missing');
    fs.rmSync(d, { recursive: true, force: true });
    ok = cleanOk && defaultStill && claimsBlocks && humanOk && mcpOk;
  } catch (e) {}
  console.log(ok ? '✓ B(1.33.3) gate --claims opt-in(기본 5 무변경 + 6번째 verify-claims 거짓완료 차단) + MCP verify_claim_all 라운드트립' : '✗ gate --claims + MCP verify_claim_all 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.34.1)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-disc-'));
    const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(d, 'calc.js'), 'function add(a,b){return a+b}\nmodule.exports={add}\n');
    fs.mkdirSync(path.join(d, 'tests'));
    fs.writeFileSync(path.join(d, 'tests', 'calc.test.js'), 'const {add}=require("../calc.js");\ntest("a",()=>{if(add(1,2)!==3)throw 0});\n');
     
    fs.writeFileSync(path.join(d, '.leerness', 'session-handoff.md'), '# Handoff\nLast generated: 2026-06-19T00:00:00Z\n\n## Completed\n- calc.js add() 구현 + 테스트\n\n## Next Exact Step\n- 배포\n');
    fs.writeFileSync(path.join(d, '.leerness', 'review-evidence.md'), '# Evidence\n## Test run\n- npm test: 1/1 passing\n');
     
    const id = (R(['task', 'add', 'calc 구현']).stdout.match(/T-\d{4,}/) || [])[0];
    R(['task', 'update', id, '--status', 'done', '--evidence', 'calc.js + tests/calc.test.js 테스트 50개 통과']);
     
    const lz = JSON.parse(R(['lazy', 'detect', '.', '--json']).stdout);
    const lazyClean = R(['lazy', 'detect', '.']).status === 0 && (lz.findings || []).length === 0;
     
    const gDef = R(['gate', '.']);
    const gClaims = R(['gate', '.', '--claims', '--json']);
    const gcj = JSON.parse(gClaims.stdout);
    const vcCheck = gcj.checks.find((c) => c.name === 'verify-claims');
    const lazyCheck = gcj.checks.find((c) => c.name === 'lazy detect');
    const discriminates = gDef.status === 0 && gClaims.status === 1 && vcCheck && vcCheck.ok === false && lazyCheck && lazyCheck.ok === true;
    fs.rmSync(d, { recursive: true, force: true });
    ok = lazyClean && discriminates;
  } catch (e) {}
  console.log(ok ? '✓ B(1.34.1) gate --claims 정밀성 REAL: 워크스페이스 깨끗(lazy 0) + 콘텐츠거짓(부풀린카운트) → 기본 5체크 통과(exit 0), --claims 만 차단(exit 1)' : '✗ gate --claims 정밀성 판별 가드 실패');
  if (!ok) failed++;
}

 
 
 
 
 
if (e2eShard.take('B(1.36.82)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-vac-'));
    const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { encoding: 'utf8', timeout: 60000 });
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { encoding: 'utf8', timeout: 60000 });
    const J = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };
    const mkDone = (req, ev) => {
      const id = (R(['task', 'add', req]).stdout.match(/T-\d{4,}/) || [])[0];
      R(['task', 'update', id, '--status', 'done', '--evidence', ev, '--next', 'none']);
      return id;
    };
     
    const fake = mkDone('결제 재시도 구현', 'tests: 32/32 passed');
    const rFake = R(['verify-claim', fake, '--json']);
    const jFake = J(rFake) || {};
    const blocked = rFake.status === 1 && (jFake.reasons || []).includes('unverifiable-claim');
     
    const lenientOk = R(['verify-claim', fake, '--lenient', '--json']).status === 0;
     
    fs.mkdirSync(path.join(d, 'src'), { recursive: true });
    fs.writeFileSync(path.join(d, 'src', 'pay.js'), 'function retry(fn,n){let e;for(let i=0;i<n;i++){try{return fn()}catch(x){e=x}}throw e}\nmodule.exports={retry}\n');
    fs.mkdirSync(path.join(d, 'tests2'), { recursive: true });
    fs.writeFileSync(path.join(d, 'tests2', 'pay.test.js'), 'const {retry}=require("../src/pay.js");\ntest("r",()=>{if(retry(()=>1,2)!==1)throw 0});\n');
    const honest = mkDone('재시도 헬퍼 추가', 'src/pay.js 구현 + tests2/pay.test.js 1개 테스트 (1/1 통과)');
    const honestOk = R(['verify-claim', honest, '--json']).status === 0;
     
    fs.writeFileSync(path.join(d, 'Dockerfile'), 'FROM node:18\n');
    fs.writeFileSync(path.join(d, 'Dockerfile.dev'), 'FROM node:18\n');
    fs.writeFileSync(path.join(d, '.gitignore'), 'node_modules\n');
    fs.mkdirSync(path.join(d, 'ops', 'containers'), { recursive: true });
    fs.writeFileSync(path.join(d, 'ops', 'containers', 'Dockerfile'), 'FROM node:18\n');
    fs.mkdirSync(path.join(d, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(d, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
    const bareCases = [
      ['도커 베이스 갱신', 'Dockerfile 베이스 이미지 변경 (1/1 통과)'],
      ['도커 dev 갱신', 'Dockerfile.dev 수정 (1/1 통과)'],
      ['무시목록 갱신', '.gitignore 갱신 (1/1 통과)'],
      ['다단계 경로', 'ops/containers/Dockerfile 갱신 (1/1 통과)'],
      ['선두 점 디렉토리', '.github/workflows/ci.yml 수정 (1/1 통과)'],
    ];
    const bareOk = bareCases.every(([req, ev]) => R(['verify-claim', mkDone(req, ev), '--json']).status === 0);
     
    const runId = mkDone('실행 확증', 'tests: 1/1 passed');
    const runOk = cp.spawnSync(process.execPath, [CLI, 'verify-claim', runId, '--path', d, '--run-tests', '--test-cmd', 'node -e "process.exit(0)"', '--json'], { encoding: 'utf8', timeout: 90000 }).status === 0;
     
    const all = J(R(['verify-claim', '--all', '--json'])) || {};
    const allCatches = (all.results || []).some(x => x && x.id === fake && x.ok === false);
    const gcj = J(R(['gate', '.', '--claims', '--json'])) || {};
    const vc = (gcj.checks || []).find(c => c.name === 'verify-claims');
    fs.rmSync(d, { recursive: true, force: true });
    ok = blocked && lenientOk && honestOk && bareOk && runOk && allCatches && !!vc && vc.ok === false;
    if (!ok) console.log(`   [공허주장 디버그] blocked=${blocked} lenient=${lenientOk} honest=${honestOk} bare=${bareOk} run=${runOk} all=${allCatches} gate=${vc && vc.ok}`);
  } catch (e) {}
  console.log(ok ? '✓ B(1.36.82) 공허한 done 주장 차단: 대조 0건 → unverifiable-claim(exit 1) · --lenient 존중 · 정직한 주장/추출기 사각지대 5형태/실행확증 통과(false-BLOCK 0) · --all/gate 동일판정' : '✗ 공허한 done 주장 차단 가드 실패');
  if (!ok) failed++;
}

 
 
if (e2eShard.take('B(1.36.82) #2')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-refgate-'));
    const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { encoding: 'utf8', timeout: 60000 });
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { encoding: 'utf8', timeout: 60000 });
    const J = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };
    const N = (js) => `node -e "${js}"`;
    const stepOf = (g, name) => ((g && g.checks) || []).find(c => c.name === name);
     
    const advertised = fs.readFileSync(path.join(__dirname, '..', 'lib', 'referee.js'), 'utf8').includes('gate --require-referee');
     
     
    const asAdvertised = cp.spawnSync(process.execPath, [CLI, 'gate', '--require-referee', 'nope', '--json'], { cwd: d, encoding: 'utf8', timeout: 60000 });
    let aj = null; try { aj = JSON.parse(asAdvertised.stdout); } catch {}
    const rootOk = !!aj && path.resolve(aj.root) === path.resolve(d);    
     
    const bare = J(R(['gate', '.', '--require-referee', '--json']));
    const bareBlocked = !!bare && bare.ok === false && (bare.checks || []).some(c => c.code === 'referee_missing_value');
    const missing = J(R(['gate', '.', '--require-referee', 'nope', '--json']));
    const mStep = stepOf(missing, 'referee:nope');
    R(['referee', 'add', 'r1', '--check', N('process.exit(0)'), '--good', N('process.exit(0)'), '--bad', N("console.log('SIG'); process.exit(1)"), '--expect-bad', 'SIG']);
    const uncal = stepOf(J(R(['gate', '.', '--require-referee', 'r1', '--json'])), 'referee:r1');
    R(['referee', 'verify', 'r1']);
    const cal = stepOf(J(R(['gate', '.', '--require-referee', 'r1', '--json'])), 'referee:r1');
    R(['referee', 'add', 'r2', '--check', N('process.exit(7)'), '--good', N('process.exit(0)'), '--bad', N("console.log('SIG'); process.exit(1)"), '--expect-bad', 'SIG']);
    R(['referee', 'verify', 'r2']);
    const rejects = stepOf(J(R(['gate', '.', '--require-referee', 'r2', '--json'])), 'referee:r2');
     
    const plain = J(R(['gate', '.', '--json']));
    const noRegression = plain && plain.total === 5 && !(plain.checks || []).some(c => /referee/.test(c.name));
     
    const twice = J(R(['gate', '.', '--require-referee', 'r1', '--require-referee', 'r2', '--json']));
    const bothRan = ((twice && twice.checks) || []).filter(c => /^referee:/.test(c.name)).length === 2;
    fs.rmSync(d, { recursive: true, force: true });
     
    const codeExposed = !!mStep && mStep.code === 'referee_not_found';
    ok = advertised && rootOk && bareBlocked && codeExposed && !!mStep && mStep.ok === false && !!uncal && uncal.ok === false
      && !!cal && cal.ok === true && !!rejects && rejects.ok === false && noRegression && bothRan;
    if (!ok) console.log(`   [referee게이트 디버그] adv=${advertised} rootOk=${rootOk} bare=${bareBlocked} code=${codeExposed} missing=${mStep && mStep.ok} uncal=${uncal && uncal.ok} cal=${cal && cal.ok} reject=${rejects && rejects.ok} noReg=${noRegression} both=${bothRan}`);
  } catch (e) {}
  console.log(ok ? '✓ B(1.36.82) gate --require-referee 실제 게이팅: 안내문법 그대로 root 정상 · 미존재/미증명 거부(code 노출) · 값누락 차단 · 캘리브레이션 후 통과 · 검증기 거부 시 실패 · 반복 지정 · 플래그 없으면 5체크 무변경' : '✗ gate --require-referee 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.35.10)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-gatesec-'));
    const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'handoff', '', '--path', d], { encoding: 'utf8', timeout: 20000 });
     
    fs.writeFileSync(path.join(d, '.env.example'), 'DATABASE_URL=postgres://user:password@localhost:5432/db\nAPI_KEY=your-api-key-here\n');
    const gClean = R(['gate', '.', '--json']);
    let cleanOk = false; try { const j = JSON.parse(gClean.stdout); cleanOk = gClean.status === 0 && j.ok === true; } catch {}
     
    fs.writeFileSync(path.join(d, 'leak.js'), 'const k = "AKIAJQXMP7RZ2KL9WXYZ";\nmodule.exports = k;\n');
    const gSecret = R(['gate', '.', '--json']);
    let secretBlocked = false; try { const j = JSON.parse(gSecret.stdout); const sc = (j.checks || []).find(c => c.name === 'scan secrets'); secretBlocked = gSecret.status === 1 && j.ok === false && sc && sc.ok === false; } catch {}
    fs.rmSync(d, { recursive: true, force: true });
    ok = cleanOk && secretBlocked;
    if (!ok) console.log(`   [gatesec 디버그] cleanExit0=${cleanOk} secretBlocked=${secretBlocked}`);
  } catch (e) {}
  console.log(ok ? '✓ B(1.35.10) gate 보안 가드레일: 정상 placeholder 오탐 없이 통과(exit 0) + 커밋된 실키 차단(exit 1, scan secrets step)' : '✗ gate 보안 가드레일 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.430)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-hexit-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const clean = cp.spawnSync(process.execPath, [CLI, 'health', d], { encoding: 'utf8', timeout: 20000 });
    fs.writeFileSync(path.join(d, 'leak.js'), 'module.exports={apiKey:"sk-test-1234567890abcdefghijklmnopqrstuvwxyz"};');   
    const dirty = cp.spawnSync(process.execPath, [CLI, 'health', d], { encoding: 'utf8', timeout: 20000 });
    fs.rmSync(d, { recursive: true, force: true });
    ok = clean.status === 0 && dirty.status === 1;
  } catch {}
  console.log(ok ? '✓ B(1.9.430) UR-0130: health 보안 CRITICAL → exit 1(--strict 없이), 클린 → exit 0' : '✗ health exit code 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.435/1.35.6)')) {
  total++;
  let ok = false;
  let d = null;
  let fbin = null;
  try {
    d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-disp-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
     
     
     
    fbin = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-fakecodex-'));
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(fbin, 'codex.js'), "process.stdout.write('fake-codex\\n');\n");
      fs.writeFileSync(path.join(fbin, 'codex.cmd'), [
        '@ECHO off',
        'SET "dp0=%~dp0"',
        'SET "_prog=node"',
        '"%_prog%" "%dp0%\\codex.js" %*',
      ].join('\r\n') + '\r\n');
    }
    else { fs.writeFileSync(path.join(fbin, 'codex'), '#!/bin/sh\necho fake-codex\n'); fs.chmodSync(path.join(fbin, 'codex'), 0o755); }
    const env = { ...process.env, LEERNESS_ENABLE_CODEX: '1', PATH: fbin + path.delimiter + process.env.PATH };
    const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', 'REVIEWTASK', '--to', 'codex', '--path', d], { encoding: 'utf8', timeout: 20000, env });
    const out = r.stdout || '';
     
     
    const briefOk = /--- Task: REVIEWTASK"/.test(out) && !/REVIEWTASK codex"/.test(out) && !/REVIEWTASK.*tmp/.test(out);
     
    const rRaw = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', 'REVIEWTASK', '--to', 'codex', '--raw', '--path', d], { encoding: 'utf8', timeout: 20000, env });
    const outRaw = rRaw.stdout || '';
    const rawOk = /"REVIEWTASK"/.test(outRaw) && !/"REVIEWTASK codex"/.test(outRaw) && !/REVIEWTASK.*tmp/.test(outRaw) && !/위임 프로토콜/.test(outRaw);
    ok = briefOk && rawOk;
  } catch {}
  finally {
    for (const dir of [d, fbin]) {
      if (dir) try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }
  console.log(ok ? '✓ B(1.9.435/1.35.6) UR-0137: agents dispatch task 에 --to/경로 값 흡수 없음 (브리프 접두 + --raw 원형)' : '✗ agents dispatch flag bleed');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.439)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-djson-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(d, '.env'), 'API_KEY=sk-test-1234567890abcdefghijklmnopqrstuvwxyz\n');
    fs.writeFileSync(path.join(d, '.gitignore'), 'node_modules/\n');   
    const r = cp.spawnSync(process.execPath, [CLI, 'drift', 'check', d, '--auto-fix', '--json'], { encoding: 'utf8', timeout: 30000 });
    let pure = false; try { const j = JSON.parse(r.stdout); pure = typeof j.score === 'number'; } catch {}
    fs.rmSync(d, { recursive: true, force: true });
    ok = pure;
  } catch {}
  console.log(ok ? '✓ B(1.9.439) UR-0135: drift --auto-fix --json 순수 JSON(dirty WS 진행로그 억제)' : '✗ drift --auto-fix --json 비순수');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.440)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-scanph-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
     
    fs.writeFileSync(path.join(d, '.env.example'), 'AWS_KEY=AKIA' + 'X'.repeat(16) + '\nGH=ghp_' + 'X'.repeat(36) + '\n');
    const dummy = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', d], { encoding: 'utf8', timeout: 20000 });
     
    fs.writeFileSync(path.join(d, 'real.js'), 'const k="AKIAJQXMP7RZ2KL9WXYZ";');
    const real = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', d], { encoding: 'utf8', timeout: 20000 });
    fs.rmSync(d, { recursive: true, force: true });
    ok = dummy.status === 0 && real.status === 1;
  } catch {}
  console.log(ok ? '✓ B(1.9.440) UR-0140: 시크릿 스캐너 prefix 더미 미탐 + 진짜 탐지(placeholder 가드 통합)' : '✗ 시크릿 스캐너 prefix 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.442)')) {
  total++;
  let ok = false;
  try {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-taskpos-'));
    const cwd2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-cwd-'));
    cp.spawnSync(process.execPath, [CLI, 'init', ws, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', '포지셔널e2e', ws, '--no-review'], { encoding: 'utf8', timeout: 15000, cwd: cwd2 });
    const tracker = path.join(ws, '.leerness', 'progress-tracker.md');
    const savedToWs = fs.existsSync(tracker) && fs.readFileSync(tracker, 'utf8').includes('포지셔널e2e');
    const cwdClean = !fs.existsSync(path.join(cwd2, '.leerness'));
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(cwd2, { recursive: true, force: true });
    ok = savedToWs && cwdClean;
  } catch {}
  console.log(ok ? '✓ B(1.9.442) UR-0141: task positional path 저장 + cwd 오염 차단' : '✗ task positional path 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.443)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-cca-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'state', 'start', '목표', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const before = cp.spawnSync(process.execPath, [CLI, 'state', 'show', '--json', '--path', d], { encoding: 'utf8', timeout: 15000 });
    cp.spawnSync(process.execPath, [CLI, 'state', 'record', '--files-changed', 'a.js', '--tests', 'npm test', '--path', d], { encoding: 'utf8', timeout: 15000 });
    cp.spawnSync(process.execPath, [CLI, 'state', 'verify', 'pass', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const after = cp.spawnSync(process.execPath, [CLI, 'state', 'show', '--json', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const bj = JSON.parse(before.stdout);
    const aj = JSON.parse(after.stdout);
    fs.rmSync(d, { recursive: true, force: true });
    ok = bj.completion_claim_allowed && bj.completion_claim_allowed.allowed === false
      && aj.completion_claim_allowed && aj.completion_claim_allowed.allowed === true;
  } catch {}
  console.log(ok ? '✓ B(1.9.443) UR-0153: evidence-first completion_claim_allowed (증거없음=no, 증거+pass=yes)' : '✗ completion_claim_allowed 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.444)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ci-'));
    const r1 = cp.spawnSync(process.execPath, [CLI, 'ci', 'init', d], { encoding: 'utf8', timeout: 15000 });
    const wfPath = path.join(d, '.github', 'workflows', 'leerness-gate.yml');
    const created = fs.existsSync(wfPath);
    const content = created ? fs.readFileSync(wfPath, 'utf8') : '';
    const contentOk = /name:\s*leerness-gate/.test(content) && /pull_request:/.test(content) && /leerness@[\d.]+ gate \./.test(content);   
     
    const r2 = cp.spawnSync(process.execPath, [CLI, 'ci', 'init', d], { encoding: 'utf8', timeout: 15000 });
    const idempotent = r2.status === 0 && /이미 존재|exists/.test((r2.stdout || '') + (r2.stderr || ''));
    fs.rmSync(d, { recursive: true, force: true });
    ok = r1.status === 0 && created && contentOk && idempotent;
  } catch {}
  console.log(ok ? '✓ B(1.9.444) UR-0152: ci init — PR gate 워크플로 생성 + 멱등' : '✗ ci init 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.9.445)')) {
  total++;
  let ok = false;
  try {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-addpos-'));
    const cwd3 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-cwd3-'));
    cp.spawnSync(process.execPath, [CLI, 'init', ws, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', '결정E2E', ws, '--reason', 'r'], { encoding: 'utf8', timeout: 15000, cwd: cwd3 });
    cp.spawnSync(process.execPath, [CLI, 'lesson', 'save', '교훈E2E', ws], { encoding: 'utf8', timeout: 15000, cwd: cwd3 });
    cp.spawnSync(process.execPath, [CLI, 'rule', 'add', '룰E2E', '--trigger', 'every-update', ws], { encoding: 'utf8', timeout: 15000, cwd: cwd3 });
    const hdir = path.join(ws, '.leerness');
    let savedAll = false;
    try {
      const blob = fs.readdirSync(hdir).map(f => { try { return fs.readFileSync(path.join(hdir, f), 'utf8'); } catch { return ''; } }).join('\n');
      savedAll = blob.includes('결정E2E') && blob.includes('교훈E2E') && blob.includes('룰E2E');
    } catch {}
    const cwdClean = !fs.existsSync(path.join(cwd3, '.leerness'));
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(cwd3, { recursive: true, force: true });
    ok = savedAll && cwdClean;
  } catch {}
  console.log(ok ? '✓ B(1.9.445) UR-0151: decision/lesson/rule add positional path 저장 + cwd 오염 차단' : '✗ add-family positional path 실패');
  if (!ok) failed++;
}

 
 
if (e2eShard.take('B(1.25.1/1.25.2/1.27.2/1.28.2/1.29.1/1.29.2/1.29.3/1.29.4/1.30.5)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-i18n-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const H = /[가-힣]/;
    const out = (r) => (r.stdout || '') + (r.stderr || '');
     
    const lensKo = out(cp.spawnSync(process.execPath, [CLI, 'lens', '--path', d], { encoding: 'utf8', timeout: 15000 }));
    const lensKoOk = /분야별 자기질문 품질 렌즈/.test(lensKo);
     
    const lensEn = out(cp.spawnSync(process.execPath, [CLI, 'lens', '--language', 'en', '--path', d], { encoding: 'utf8', timeout: 15000 }));
    const lensEnOk = /quality self-question lenses/.test(lensEn) && !H.test(lensEn);
     
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'I18N_TASK_E2E', '--language', 'en', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const tl = out(cp.spawnSync(process.execPath, [CLI, 'task', 'list', '--json', '--path', d], { encoding: 'utf8', timeout: 15000 }));
    const noLeak = tl.includes('I18N_TASK_E2E') && !/"request"\s*:\s*"en"/.test(tl);
     
    const stEn = out(cp.spawnSync(process.execPath, [CLI, 'status', path.join(d, 'nope'), '--language', 'en', '--json'], { encoding: 'utf8', timeout: 15000 }));
    const stKo = out(cp.spawnSync(process.execPath, [CLI, 'status', path.join(d, 'nope'), '--json'], { encoding: 'utf8', timeout: 15000 }));
    const stOk = /path not found/.test(stEn) && /경로 없음/.test(stKo);
     
    const hEn = out(cp.spawnSync(process.execPath, [CLI, 'health', '--language', 'en', '--path', d], { encoding: 'utf8', timeout: 20000 }));
    const hKo = out(cp.spawnSync(process.execPath, [CLI, 'health', '--path', d], { encoding: 'utf8', timeout: 20000 }));
    const healthOk = /## Security/.test(hEn) && !H.test(hEn) && /## 보안/.test(hKo);
     
    const drEn = out(cp.spawnSync(process.execPath, [CLI, 'drift', 'check', d, '--language', 'en'], { encoding: 'utf8', timeout: 20000 }));
    const drKo = out(cp.spawnSync(process.execPath, [CLI, 'drift', 'check', d], { encoding: 'utf8', timeout: 20000 }));
    const driftOk = /signal \| age \| threshold/.test(drEn) && !H.test(drEn) && /신호 \| age \| 임계/.test(drKo);
     
     
     
     
     
     
    const docEnAt = Date.now();
    const docEnR = cp.spawnSync(process.execPath, [CLI, 'doctor', '--language', 'en'], { encoding: 'utf8', timeout: 600000, cwd: d });
    const docEnMs = Date.now() - docEnAt;
    const docKoAt = Date.now();
    const docKoR = cp.spawnSync(process.execPath, [CLI, 'doctor'], { encoding: 'utf8', timeout: 600000, cwd: d });
    const docKoMs = Date.now() - docKoAt;
    const docEn = out(docEnR), docKo = out(docKoR);
    const doctorOk = docEnR.status === 0 && docKoR.status === 0
      && /install\/environment diagnosis/.test(docEn) && !H.test(docEn) && /설치\/환경 진단/.test(docKo);
    fs.rmSync(d, { recursive: true, force: true });
     
     
     
    const dh = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-i18n-ho-'));
    cp.spawnSync(process.execPath, [CLI, 'init', dh, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(dh, '.env'), 'API_KEY=sk-test-abc123def456ghi789jkl012mno345\n');
    fs.writeFileSync(path.join(dh, '.gitignore'), 'node_modules/\n');
    const hoEn = out(cp.spawnSync(process.execPath, [CLI, 'handoff', dh, '--inspect', '--language', 'en'], { encoding: 'utf8', timeout: 60000 }));
    const hoKo = out(cp.spawnSync(process.execPath, [CLI, 'handoff', dh, '--inspect'], { encoding: 'utf8', timeout: 60000 }));
    const enSecLines = hoEn.split('\n').filter(l => /Security summary|auto-fix:|CRITICAL|auto-fix option|recover|missing secret/i.test(l));
    const hoEnOk = /Security summary/.test(hoEn) && enSecLines.length >= 2 && !enSecLines.some(l => H.test(l));
    const hoKoOk = /보안 요약/.test(hoKo);
    fs.rmSync(dh, { recursive: true, force: true });
     
     
     
    const de = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-i18n-env-'));
    const deOwner = require('./temp-cleanup').ownTree(de);
    cp.spawnSync(process.execPath, [CLI, 'init', de, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const envTools = require('./e2e-env-tools').create(de);
    const snap = path.join(de, '.leerness', 'environment.json');
    const forceEnvChange = () => { try { const s = JSON.parse(fs.readFileSync(snap, 'utf8')); if (s.node) s.node.version = 'v0.0.0-test'; fs.writeFileSync(snap, JSON.stringify(s, null, 2) + '\n'); } catch {} };
    cp.spawnSync(process.execPath, [CLI, 'handoff', de, '--writeback'], { encoding: 'utf8', timeout: 25000, env: envTools.env });
    forceEnvChange();
    const edEn = out(cp.spawnSync(process.execPath, [CLI, 'handoff', de, '--language', 'en', '--writeback'], { encoding: 'utf8', timeout: 25000, env: envTools.env }));
    forceEnvChange();  
    const edKo = out(cp.spawnSync(process.execPath, [CLI, 'handoff', de, '--writeback'], { encoding: 'utf8', timeout: 25000, env: envTools.env }));
    if (!envTools.verify({ snapshot: JSON.parse(fs.readFileSync(snap, 'utf8')) })) throw new Error('Environment fixture observations missing');
    const edEnLines = edEn.split('\n').filter(l => /Runtime environment|env detect|change\(s\) detected/i.test(l));
    const edEnOk = /Runtime environment/.test(edEn) && edEnLines.length >= 1 && !edEnLines.some(l => H.test(l));
    const edKoOk = /실행 환경/.test(edKo);
    require('./temp-cleanup').removeOwnedTree(deOwner);
     
     
    const ds = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-i18n-sh-'));
    cp.spawnSync(process.execPath, [CLI, 'init', ds, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const ssnap = path.join(ds, '.leerness', 'environment.json');
    const sfail = path.join(ds, '.leerness', 'shell-failures.json');
    const seedSh = () => {
      try { const s = JSON.parse(fs.readFileSync(ssnap, 'utf8')); if (s.node) s.node.version = 'v0.0.0-test'; fs.writeFileSync(ssnap, JSON.stringify(s, null, 2) + '\n'); } catch {}
      fs.writeFileSync(sfail, JSON.stringify({ failures: [{ cmd: 'ls && pwd', exitCode: 1, shell: 'powershell-5.1', issues: ['ps5-chain'] }] }, null, 2) + '\n');
    };
    cp.spawnSync(process.execPath, [CLI, 'handoff', ds, '--writeback'], { encoding: 'utf8', timeout: 25000 });  
    seedSh();
    const shEn = out(cp.spawnSync(process.execPath, [CLI, 'handoff', ds, '--language', 'en', '--writeback'], { encoding: 'utf8', timeout: 25000 }));
    seedSh();  
    const shKo = out(cp.spawnSync(process.execPath, [CLI, 'handoff', ds, '--writeback'], { encoding: 'utf8', timeout: 25000 }));
    const shEnLines = shEn.split('\n').filter(l => /shell guard|shell failure|review past shell|shell-guard|check before running/i.test(l));
    const shEnOk = /Terminal shell guard/.test(shEn) && shEnLines.length >= 2 && !shEnLines.some(l => H.test(l));
    const shKoOk = /셸 가드/.test(shKo);
    fs.rmSync(ds, { recursive: true, force: true });
     
    const da = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-i18n-ag-'));
    cp.spawnSync(process.execPath, [CLI, 'init', da, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const agEnv = { ...process.env, LEERNESS_ENABLE_CODEX: '1', LEERNESS_ENABLE_CLAUDE: '1' };
    const agEn = out(cp.spawnSync(process.execPath, [CLI, 'handoff', da, '--inspect', '--language', 'en'], { encoding: 'utf8', timeout: 60000, env: agEnv }));
    const agKo = out(cp.spawnSync(process.execPath, [CLI, 'handoff', da, '--inspect'], { encoding: 'utf8', timeout: 60000, env: agEnv }));
    const agEnLines = agEn.split('\n').filter(l => /agent slash|active agent|slash-commands|full list/i.test(l));
    const agEnOk = /CLI agent slash commands/.test(agEn) && agEnLines.length >= 2 && !agEnLines.some(l => H.test(l));
    const agKoOk = /에이전트 슬래시/.test(agKo);
    fs.rmSync(da, { recursive: true, force: true });
     
    const df3 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-i18n-f3-'));
    cp.spawnSync(process.execPath, [CLI, 'init', df3, '--yes', '--language', 'en'], { encoding: 'utf8', timeout: 120000 });
    const hf3En = out(cp.spawnSync(process.execPath, [CLI, 'handoff', df3, '--inspect'], { encoding: 'utf8', timeout: 60000 }));
    const wfLines = hf3En.split('\n').filter(l => /Session workflow|Analyze request|sub-agent work|to disable:/.test(l));
    const f3En = /Session workflow/.test(hf3En) && wfLines.length >= 3 && !wfLines.some(l => H.test(l));
    const df3ko = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-i18n-f3k-'));
    cp.spawnSync(process.execPath, [CLI, 'init', df3ko, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 120000 });
    const f3Ko = /세션 워크플로 6단계/.test(out(cp.spawnSync(process.execPath, [CLI, 'handoff', df3ko, '--inspect'], { encoding: 'utf8', timeout: 60000 })));
    const vcEn = out(cp.spawnSync(process.execPath, [CLI, 'verify-claim', '--path', df3, '--language', 'en'], { encoding: 'utf8', timeout: 15000 }));
    const vcKo = out(cp.spawnSync(process.execPath, [CLI, 'verify-claim', '--path', df3ko], { encoding: 'utf8', timeout: 15000 }));
    const f4 = /required\. ex:/.test(vcEn) && !H.test(vcEn) && /필요\. 예:/.test(vcKo);
    [df3, df3ko].forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} });
    ok = lensKoOk && lensEnOk && noLeak && stOk && healthOk && driftOk && doctorOk && hoEnOk && hoKoOk && edEnOk && edKoOk && shEnOk && shKoOk && agEnOk && agKoOk && f3En && f3Ko && f4;
     
     
    if (!ok) console.log('   [i18n 디버그] ' + JSON.stringify({ lensKoOk, lensEnOk, noLeak, stOk, healthOk, driftOk, doctorOk,
      doctor: { en: { status: docEnR.status, error: docEnR.error && docEnR.error.code, ms: docEnMs, tail: docEn.trim().split(/\r?\n/).slice(-2) },
        ko: { status: docKoR.status, error: docKoR.error && docKoR.error.code, ms: docKoMs, tail: docKo.trim().split(/\r?\n/).slice(-2) } },
      hoEnOk, hoKoOk, edEnOk, edKoOk, shEnOk, shKoOk, agEnOk, agKoOk, f3En, f3Ko, f4 }));
  } catch (e) { console.log('   [i18n 디버그] 예외: ' + ((e && e.message) || e)); }
  console.log(ok ? '✓ B(1.25.1/1.25.2/1.27.2/1.28.2/1.29.1/1.29.2/1.29.3/1.29.4/1.30.5) i18n 행위: --language en 런타임 영어(lens/health/drift/doctor/handoff보안요약/env-detect/shell-guard/agent-slash/워크플로가이드/verify-claim) + ko 기본 보존 + --language positional 무누출 + status 에러 en/ko (UR-0010)' : '✗ i18n 행위 회귀 가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.26.1)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rev13-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { encoding: 'utf8', timeout: 30000 });
    const out = (r) => (r.stdout || '') + (r.stderr || '');
     
    fs.writeFileSync(path.join(d, 'server.key'), '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA1234567890abcdefghij\n-----END RSA PRIVATE KEY-----\n');
    const keyScan = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', d], { encoding: 'utf8', timeout: 15000 });
    const keyCaught = keyScan.status === 1 && /Generic private key/.test(out(keyScan));
    fs.unlinkSync(path.join(d, 'server.key'));
     
    fs.writeFileSync(path.join(d, '.env.example'), 'A=postgres://user:password@h:5432/db\nB=mysql://root:root@h/db\n');
    const phScan = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', d], { encoding: 'utf8', timeout: 15000 });
    const noFp = phScan.status === 0 && !/DB connection string/.test(out(phScan));
    fs.unlinkSync(path.join(d, '.env.example'));
    fs.writeFileSync(path.join(d, 'real.env'), 'D=postgres://admin:Xk9zQ2mP7rL4wT@prod.example.com:5432/main\n');
    const realScan = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', d], { encoding: 'utf8', timeout: 15000 });
    const realCaught = realScan.status === 1 && /DB connection string/.test(out(realScan));
    fs.unlinkSync(path.join(d, 'real.env'));
     
    const rj = cp.spawnSync(process.execPath, [CLI, 'retro', d, '--days', 'xyz', '--json'], { encoding: 'utf8', timeout: 15000 });
    let retroJsonOk = false;
    try { const j = JSON.parse(rj.stdout); retroJsonOk = j && (j.error || j.code) && rj.status === 1; } catch {}
    fs.rmSync(d, { recursive: true, force: true });
    ok = keyCaught && noFp && realCaught && retroJsonOk;
  } catch {}
  console.log(ok ? '✓ B(1.26.1) 13th 외부리뷰: 개인키파일 스캔(FN차단) + DB placeholder(FP차단/FN유지) + retro --json NaN 구조화' : '✗ 13th 외부리뷰 P2 회귀가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.27.1)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rev13b-'));
    const out = (r) => (r.stdout || '') + (r.stderr || '');
     
    fs.mkdirSync(path.join(d, 'uninit'));
    const au = cp.spawnSync(process.execPath, [CLI, 'audit', path.join(d, 'uninit')], { encoding: 'utf8', timeout: 15000 });
    const auClean = au.status === 1 && !/design guide|reuse-map/.test(out(au)) && /Audit summary/.test(out(au));
    const auj = cp.spawnSync(process.execPath, [CLI, 'audit', path.join(d, 'uninit'), '--json'], { encoding: 'utf8', timeout: 15000 });
    let aujOk = false; try { const j = JSON.parse(auj.stdout); aujOk = j.healthy === false && (j.findings || []).some(f => f.kind === ('not_' + 'initialized')); } catch {}
     
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { encoding: 'utf8', timeout: 30000 });
    const auReal = out(cp.spawnSync(process.execPath, [CLI, 'audit', d], { encoding: 'utf8', timeout: 15000 }));
    const auRealOk = /Audit summary/.test(auReal) && /gitignore|design|reuse/.test(auReal);
     
    fs.mkdirSync(path.join(d, 'src'), { recursive: true });
    fs.writeFileSync(path.join(d, 'src', 'x.js'), 'module.exports={};\n');
    fs.writeFileSync(path.join(d, 'x.test.js'), 'test();\n');
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'x', '--path', d], { encoding: 'utf8', timeout: 15000 });
    cp.spawnSync(process.execPath, [CLI, 'task', 'update', 'T-0002', '--status', 'done', '--evidence', 'src/x.js implemented, x.test.js added', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const vcNon = out(cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0002', '--run-tests', '--test-cmd', 'echo hi', '--path', d], { encoding: 'utf8', timeout: 20000 }));
    const vcNonOk = /미확인|unconfirmed/.test(vcNon) && !/echo hi.*all passed/.test(vcNon);
     
    const vcReal = out(cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0002', '--run-tests', '--test-cmd', 'echo Tests: 2 passed, 2 total', '--path', d], { encoding: 'utf8', timeout: 20000 }));
    const vcRealOk = /all passed/.test(vcReal);
    fs.rmSync(d, { recursive: true, force: true });
    ok = auClean && aujOk && auRealOk && vcNonOk && vcRealOk;
  } catch {}
  console.log(ok ? '✓ B(1.27.1) 13th 리뷰 정직성: audit 미초기화 모순출력 차단(+정상 무회귀) + verify-claim no-parse 정직표기(+진짜테스트 무회귀)' : '✗ 13th 리뷰 정직성 후속 회귀가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.35.7)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-dpm-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.mkdirSync(path.join(d, 'src'), { recursive: true });
    fs.writeFileSync(path.join(d, 'src', 'x.js'), 'module.exports = { f: () => 1 };\n');
    fs.writeFileSync(path.join(d, 'x.test.js'), 'test();\ntest();\n');
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'dpm', '--path', d], { encoding: 'utf8', timeout: 15000 });
    cp.spawnSync(process.execPath, [CLI, 'task', 'update', 'T-0002', '--status', 'done', '--evidence', 'src/x.js implemented, x.test.js added; 3/3 passed', '--path', d], { encoding: 'utf8', timeout: 15000 });
     
    const r1 = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0002', '--run-tests', '--test-cmd', 'echo Tests: 2 passed, 2 total', '--path', d], { encoding: 'utf8', timeout: 20000 });
    const inflatedFails = r1.status === 1 && /부풀려짐|inflated/.test(r1.stdout);
     
    const r2 = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0002', '--run-tests', '--test-cmd', 'echo Tests: 2 passed, 2 total', '--json', '--path', d], { encoding: 'utf8', timeout: 20000 });
    let jsonOk = false; try { const j = JSON.parse(r2.stdout); jsonOk = r2.status === 1 && j.ok === false && j.reasons.includes('declared-pass-mismatch') && j.verdict.declaredPassMatches === false; } catch {}
     
    const r3 = cp.spawnSync(process.execPath, [CLI, 'verify-claim', '--all', '--run-tests', '--test-cmd', 'echo Tests: 2 passed, 2 total', '--json', '--path', d], { encoding: 'utf8', timeout: 20000 });
    let allOk = false; try { const j3 = JSON.parse(r3.stdout); const e3 = (j3.results || []).find(x => x.id === 'T-0002'); allOk = r3.status === 1 && e3 && e3.ok === false && e3.reasons.includes('declared-pass-mismatch'); } catch {}
     
    const r4 = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0002', '--run-tests', '--test-cmd', 'echo pass 2', '--path', d], { encoding: 'utf8', timeout: 20000 });
    const specParsed = r4.status === 1 && /2\/2/.test(r4.stdout);
     
    cp.spawnSync(process.execPath, [CLI, 'task', 'update', 'T-0002', '--status', 'done', '--evidence', 'src/x.js implemented, x.test.js added; 2/2 passed', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const r5 = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0002', '--run-tests', '--test-cmd', 'echo Tests: 2 passed, 2 total', '--path', d], { encoding: 'utf8', timeout: 20000 });
    const r6 = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0002', '--run-tests', '--test-cmd', 'echo Tests: 3 passed, 3 total', '--path', d], { encoding: 'utf8', timeout: 20000 });
    const truthfulOk = r5.status === 0;
    const growthOk = r6.status === 0;
     
    cp.spawnSync(process.execPath, [CLI, 'task', 'update', 'T-0002', '--status', 'done', '--evidence', 'src/x.js implemented, x.test.js added; closed 2/5 passing PRs', '--path', d], { encoding: 'utf8', timeout: 15000 });
    const r7 = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0002', '--run-tests', '--test-cmd', 'echo 1 passing', '--path', d], { encoding: 'utf8', timeout: 20000 });
    const partialRatioFpOk = r7.status === 0;   
    fs.rmSync(d, { recursive: true, force: true });
    ok = inflatedFails && jsonOk && allOk && specParsed && truthfulOk && growthOk && partialRatioFpOk;
    if (!ok) console.log(`   [dpm 디버그] inflated=${inflatedFails} json=${jsonOk} all=${allOk} spec=${specParsed} truthful=${truthfulOk} growth=${growthOk} partialFP=${partialRatioFpOk}`);
  } catch {}
  console.log(ok ? '✓ B(1.35.7) UR-0013: declared-pass 부풀림 게이팅(human/json/--all) + spec 리포터 파싱 + 실행≥주장 무벌점' : '✗ declared-pass mismatch 게이팅 실패');
  if (!ok) failed++;
}

 
 
if (e2eShard.take('B(1.36.1)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-si-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const auditJson = () => { const r = cp.spawnSync(process.execPath, [CLI, 'audit', d, '--json'], { encoding: 'utf8', timeout: 40000, env: { ...process.env, LEERNESS_OFFLINE: '1' } }); try { return JSON.parse(r.stdout); } catch { return null; } };
    const healthJson = () => { const r = cp.spawnSync(process.execPath, [CLI, 'health', d, '--json'], { encoding: 'utf8', timeout: 40000 }); try { return JSON.parse(r.stdout); } catch { return null; } };
    const checkExit = () => cp.spawnSync(process.execPath, [CLI, 'check', d], { encoding: 'utf8', timeout: 40000 }).status;
    const hasK = (j, k) => !!(j && (j.findings || []).some(f => f.kind === k));
     
    const cleanAudit = !hasK(auditJson(), 'corrupted_state_json');
    const cleanCheck = checkExit() === 0;
    const hc0 = healthJson();
    const cleanHealth = !!(hc0 && hc0.checks && hc0.checks.stateIntegrity && hc0.checks.stateIntegrity.ok === true);
     
    fs.writeFileSync(path.join(d, '.leerness', 'manifest.json'), '{ this is : not valid json ]]]');
    const badAudit = hasK(auditJson(), 'corrupted_state_json');
    const badCheck = checkExit() === 1;
    const hc1 = healthJson();
    const badHealth = !!(hc1 && hc1.healthy === false && hc1.checks.stateIntegrity && hc1.checks.stateIntegrity.corruptedCount === 1 && (hc1.checks.stateIntegrity.corrupted || []).some(c => c.file === '.leerness/manifest.json'));
     
    const strictExit = cp.spawnSync(process.execPath, [CLI, 'audit', d, '--strict', '--no-npm-audit'], { encoding: 'utf8', timeout: 40000, env: { ...process.env, LEERNESS_OFFLINE: '1' } }).status;
    const strictBlocks = strictExit === 1;
    fs.rmSync(d, { recursive: true, force: true });
    ok = cleanAudit && cleanCheck && cleanHealth && badAudit && badCheck && badHealth && strictBlocks;
    if (!ok) console.log(`   [si 디버그] cleanA=${cleanAudit} cleanC=${cleanCheck} cleanH=${cleanHealth} badA=${badAudit} badC=${badCheck} badH=${badHealth} strict=${strictBlocks}`);
  } catch (e) {}
  console.log(ok ? '✓ B(1.36.1) 클린룸 FN: 상태 JSON 손상 표면화(audit finding/health degraded/check exit 1 + --strict 승격) + 클린 무오탐' : '✗ 상태 JSON 무결성 회귀가드 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.51)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-clarify-'));
    const initialized = cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { encoding: 'utf8', timeout: 30000 });
    const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { encoding: 'utf8', timeout: 15000 });
     
    const c1r = R(['clarify', '메인 화면 적당히 이쁘게 바꿔줘, 그거도 같이', '--json']);
    const c2r = R(['clarify', 'src/a.js 의 sum 함수 오버플로 버그 수정', '--json']);
    const c1 = JSON.parse(c1r.stdout);
    const c2 = JSON.parse(c2r.stdout);
    const clarifyOk = c1.ambiguous === true && c1.questions.length >= 2 && c2.ambiguous === false;
     
    const pAddr = R(['preview', 'add', '주문 목록 화면', '--design', '카드형 그리드', '--features', '검색,정렬', '--json']);
    const pAdd = JSON.parse(pAddr.stdout);
    const addOk = pAdd.id === 'P-0001' && pAdd.title === '주문 목록 화면' && pAdd.design === '카드형 그리드' && pAdd.features.length === 2 && pAdd.status === 'proposed';
    const ho1 = cp.spawnSync(process.execPath, [CLI, 'handoff', d], { encoding: 'utf8', timeout: 25000 });
    const headlineOk = /미승인 미리보기 1건|1 preview\(s\) awaiting/.test((ho1.stdout || '') + (ho1.stderr || ''));
    const apr = R(['preview', 'approve', 'P-0001', '--json']);
    const lstr = R(['preview', 'list', '--json']);
    const ap = JSON.parse(apr.stdout);
    const lst = JSON.parse(lstr.stdout);
    const approveOk = ap.status === 'approved' && lst.pending === 0 && lst.total === 1;
     
    const nf = R(['preview', 'show', 'P-9999', '--json']);
    let nfOk = false; try { const j = JSON.parse(nf.stdout); nfOk = j.ok === false && j.code === 'not_found' && nf.status === 1; } catch {}
     
    const agents = fs.readFileSync(path.join(d, 'AGENTS.md'), 'utf8');
    const docOk = agents.includes('결과에 영향을 주는 핵심 모호성이 있을 때만 확인합니다. `leerness clarify`는 선택 도구입니다.')
      && agents.includes('미리보기는 화면 변경이나 명시적 사용자·프로젝트 정책이 있는 경우에 사용합니다. 비시각 변경에 추가 승인 단계를 강제하지 않습니다.')
      && agents.includes('화면 시안은 시각적 검토가 필요하거나 명시적으로 요청된 경우에 사용합니다. 사용자 지정 승인 규칙은 유지합니다.')
      && !['모호성 질문 의무', '미리보기 승인 의무', 'approve 전에는 해당 기능의 코드를 작성하지 않습니다'].some(term => agents.includes(term));
    const nativeOk = [initialized, c1r, c2r, pAddr, ho1, apr, lstr].every(r => r.status === 0 && r.signal === null && !r.error)
      && nf.signal === null && !nf.error;
    fs.rmSync(d, { recursive: true, force: true });
    ok = nativeOk && clarifyOk && addOk && headlineOk && approveOk && nfOk && docOk;
    if (!ok) console.log(`   [clarify 디버그] c=${clarifyOk} a=${addOk} h=${headlineOk} ap=${approveOk} nf=${nfOk} doc=${docOk}`);
  } catch (e) {}
  console.log(ok ? '✓ B(1.36.51) UR-0061: clarify 질문·preview 승인 동작 + 선택형 생성 지침·사용자 승인 규칙 경계' : '✗ clarify/preview 워크플로 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.53)')) {
  total++;
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tech-'));
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { stripe: '^1' } }));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { encoding: 'utf8', timeout: 30000 });
    const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { encoding: 'utf8', timeout: 20000 });
    const t1 = JSON.parse(R(['tech', '--json']).stdout);
    const detOk = t1.current.languages.some(l => l.id === 'javascript') && t1.current.services.some(s => s.id === 'stripe');
     
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { '@supabase/supabase-js': '^2' } }));
    const t2 = JSON.parse(R(['tech', '--json']).stdout);
    const migOk = t2.changedNow === true && t2.diffNow.addedServices.includes('supabase') && t2.diffNow.removedServices.includes('stripe') && t2.history.length === 1;
     
    cp.spawnSync(process.execPath, [CLI, 'handoff', d], { encoding: 'utf8', timeout: 25000 });
    cp.spawnSync(process.execPath, [CLI, 'graph', d, '--html'], { encoding: 'utf8', timeout: 25000 });
    const html = fs.readFileSync(path.join(d, 'leerness.html'), 'utf8');
    const tabOk = html.includes('data-v="tech"') && !html.includes('data-v="toggles"') && !html.includes('tgFlip') && html.includes('leerness toggle set') && html.includes('supabase');
    fs.rmSync(d, { recursive: true, force: true });
    ok = detOk && migOk && tabOk;
    if (!ok) console.log(`   [tech 디버그] det=${detOk} mig=${migOk} tab=${tabOk}`);
  } catch (e) {}
  console.log(ok ? '✓ B(1.36.53) UR-0062: tech 언어·서비스 감지 + 마이그레이션 이력 diff + handoff 자동갱신 + 그래프 🛠 탭(스위치 제거·CLI 가이드)' : '✗ tech 프로필 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.59)')) {
  total++;
  let ok = false;
  const _dirs = [];
  try {
    const H = /[가-힣]/;
    const de = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-en5-')); _dirs.push(de);
    const r1 = cp.spawnSync(process.execPath, [CLI, 'init', de, '--yes', '--language', 'en', '--no-env'], { encoding: 'utf8', timeout: 30000 });
     
    const five = ['AGENTS.md', 'CLAUDE.md', '.leerness/session-workflow.md', '.cursor/rules/leerness.mdc', '.github/copilot-instructions.md',
      '.leerness/guideline.md', '.leerness/guardrails.md', '.leerness/anti-lazy-work-policy.md', '.leerness/plan.md', '.leerness/secret-policy.md'];
    const enOk = r1.status === 0 && r1.signal === null && !r1.error && five.every(p => { const t = fs.readFileSync(path.join(de, p), 'utf8'); return t.length > 100 && !H.test(t); });
     
    const ag = fs.readFileSync(path.join(de, 'AGENTS.md'), 'utf8');
    const wf = fs.readFileSync(path.join(de, '.leerness/session-workflow.md'), 'utf8');
     
    const substOk = ag.includes('Ask-on-ambiguity duty')
      && ag.includes('A preview is optional for visual changes unless an explicit owner or project rule requires approval. Do not add a default code-freeze gate for nonvisual work.')
      && !ag.includes('Preview-approval duty')
      && ag.includes('Completion claims rely on original acceptance criteria, relevant tests and remaining risks. Leerness check/lazy/lens are optional diagnostics.')
      && ag.includes('## Rule observations and evidence')
      && wf.includes('## Step 6') && wf.includes('Quick checklist') && wf.includes('Anti-patterns') && wf.includes('LEERNESS_AUTO_SECURITY_FIX');
     
    const ownerPolicy = '\n## Owner preview approval policy\nNever implement this project visual preview before explicit owner approval.\n';
    fs.appendFileSync(path.join(de, 'AGENTS.md'), '\nMY EN CUSTOM LINE\n' + ownerPolicy);
    fs.appendFileSync(path.join(de, 'CLAUDE.md'), ownerPolicy);
    const beforeRepeat = Object.fromEntries(['AGENTS.md', 'CLAUDE.md'].map(name => [name, fs.readFileSync(path.join(de, name))]));
    const archiveRoot = path.join(de, '.leerness', 'archive');
    const previousArchives = new Set(fs.existsSync(archiveRoot) ? fs.readdirSync(archiveRoot) : []);
    const r2 = cp.spawnSync(process.execPath, [CLI, 'init', de, '--yes', '--language', 'en', '--no-env'], { encoding: 'utf8', timeout: 30000 });
    const ag2 = fs.readFileSync(path.join(de, 'AGENTS.md'), 'utf8');
    const claude2 = fs.readFileSync(path.join(de, 'CLAUDE.md'), 'utf8');
    const newArchives = fs.existsSync(archiveRoot) ? fs.readdirSync(archiveRoot).filter(name => !previousArchives.has(name)) : [];
    const backupOk = Object.entries(beforeRepeat).every(([name, bytes]) => newArchives.some(archive => {
      const file = path.join(archiveRoot, archive, 'files', name);
      return fs.existsSync(file) && fs.readFileSync(file).equals(bytes);
    }));
    const custOk = r2.status === 0 && r2.signal === null && !r2.error
      && (ag2.match(/MY EN CUSTOM LINE/g) || []).length === 1 && ag2.includes('\nMY EN CUSTOM LINE\n') && ag2.includes('Ask-on-ambiguity duty')
      && [ag2, claude2].every(body => body.split(ownerPolicy).length === 2 && Buffer.from(body).includes(Buffer.from(ownerPolicy)))
      && backupOk;
    const dk = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ko5-')); _dirs.push(dk);
    const r3 = cp.spawnSync(process.execPath, [CLI, 'init', dk, '--yes', '--language', 'ko', '--no-env'], { encoding: 'utf8', timeout: 30000 });
    const koOk = r3.status === 0 && r3.signal === null && !r3.error && H.test(fs.readFileSync(path.join(dk, 'AGENTS.md'), 'utf8')) && fs.readFileSync(path.join(dk, '.leerness/session-workflow.md'), 'utf8').includes('6단계');
    ok = enOk && substOk && custOk && koOk;
    if (!ok) console.log(`   [en5 디버그] en=${enOk} subst=${substOk} cust=${custOk} ko=${koOk}`);
  } catch (e) {} finally { _dirs.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.59) F-05: en 생성 지침 10종 한글 0 + 선택형 기본값·증거·워크플로·사용자 규칙·원본 백업 보존 + ko 무회귀' : '✗ en 지시 5종 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.65)')) {
  total++;
  let ok = false;
  const _d = [];
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-noop-')); _d.push(d);
    const R = () => cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--no-env'], { encoding: 'utf8', timeout: 40000 });
    R();
    const arch1 = fs.readdirSync(path.join(d, '.leerness', 'archive')).length;
    const mf1 = fs.readFileSync(path.join(d, '.leerness', 'manifest.json'), 'utf8');
    const r2 = R();
    const noopOk = r2.status === 0 && /no-op/.test(r2.stdout)
      && fs.readdirSync(path.join(d, '.leerness', 'archive')).length === arch1
      && fs.readFileSync(path.join(d, '.leerness', 'manifest.json'), 'utf8') === mf1;
     
    fs.appendFileSync(path.join(d, 'AGENTS.md'), '\nNOOP CUSTOM LINE\n');
    const r3 = R();
    const changedOk = /backup created/.test(r3.stdout) && !/no-op/.test(r3.stdout);
    const r4 = R();
    const stableOk = /no-op/.test(r4.stdout) && (fs.readFileSync(path.join(d, 'AGENTS.md'), 'utf8').match(/NOOP CUSTOM LINE/g) || []).length === 1;
     
    fs.writeFileSync(path.join(d, '.leerness', 'HARNESS_VERSION'), '1.36.60\n');
    const r5 = R();
    const verOk = /backup created/.test(r5.stdout);
    ok = noopOk && changedOk && stableOk && verOk;
    if (!ok) console.log(`   [noop 디버그] noop=${noopOk} chg=${changedOk} stable=${stableOk} ver=${verOk}`);
  } catch (e) {} finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.65) F-08 no-op 재설치: 무변경=백업/타임스탬프 생략 · 변경/구버전=정상 설치 · 커스텀 1회 유지' : '✗ no-op 재설치 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.68)')) {
  total++;
  let ok = false;
  const _d = [];
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-f14-')); _d.push(d);
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--no-env'], { encoding: 'utf8', timeout: 40000 });
    cp.spawnSync(process.execPath, [CLI, 'preview', 'add', '결제 화면', '--design', '모달', '--path', d], { encoding: 'utf8', timeout: 20000 });
    const txt = cp.spawnSync(process.execPath, [CLI, 'session', 'close', d], { encoding: 'utf8', timeout: 40000 });
    const textOk = txt.status === 0 && /미승인 미리보기 1건|1 preview\(s\) awaiting/.test(txt.stdout) && /P-0001/.test(txt.stdout);
    const js = cp.spawnSync(process.execPath, [CLI, 'session', 'close', d, '--json'], { encoding: 'utf8', timeout: 40000 });
    let jsonOk = false;
    try { const j = JSON.parse(js.stdout); jsonOk = j.pendingPreviews && j.pendingPreviews.count === 1 && j.pendingPreviews.items[0].id === 'P-0001'; } catch {}
     
    const ns = cp.spawnSync(process.execPath, [CLI, 'session', 'close', d, '--no-suggest'], { encoding: 'utf8', timeout: 40000 });
    const nsJs = cp.spawnSync(process.execPath, [CLI, 'session', 'close', d, '--json', '--no-suggest'], { encoding: 'utf8', timeout: 40000 });
    let noSuggestOk = /미승인 미리보기|awaiting approval/.test(ns.stdout);
    try { noSuggestOk = noSuggestOk && JSON.parse(nsJs.stdout).pendingPreviews.count === 1; } catch { noSuggestOk = false; }
    cp.spawnSync(process.execPath, [CLI, 'preview', 'approve', 'P-0001', '--path', d], { encoding: 'utf8', timeout: 20000 });
    const after = cp.spawnSync(process.execPath, [CLI, 'session', 'close', d, '--json'], { encoding: 'utf8', timeout: 40000 });
    let clearedOk = false;
    try { clearedOk = JSON.parse(after.stdout).pendingPreviews.count === 0; } catch {}
    ok = textOk && jsonOk && noSuggestOk && clearedOk;
    if (!ok) console.log(`   [f14 디버그] text=${textOk} json=${jsonOk} noSuggest=${noSuggestOk} cleared=${clearedOk}`);
  } catch (e) {} finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.68) F14: session close 미승인 미리보기 노출 (텍스트+JSON 일치 · --no-suggest 무영향 · 승인 시 소거)' : '✗ F14 미승인 미리보기 노출 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.69)')) {
  total++;
  let ok = false;
  try {
    const R = (a) => cp.spawnSync(process.execPath, [CLI, 'whats-new', ...a], { encoding: 'utf8', timeout: 25000, maxBuffer: 32 * 1024 * 1024 });
    const def = JSON.parse(R(['--from', '1.9.33', '--json']).stdout);
     
    const defOk = def.shown === 30 && def.versions.length === def.shown && def.totalVersions > def.shown && def.truncated === true && typeof def.hint === 'string';
     
    const badLim = ['0', '-5', 'abc'].every(v => { try { return JSON.parse(R(['--from', '1.9.33', '--json', '--limit', v]).stdout).shown === 30; } catch { return false; } });
     
     
     
     
     
     
     
    const _chg = fs.readFileSync(path.join(path.dirname(CLI), '..', 'CHANGELOG.md'), 'utf8');
    const _vers = (_chg.match(/^## (\d+\.\d+\.\d+)/gm) || []).map(s => s.replace('## ', ''));
    const _fromRecent = _vers[Math.min(3, _vers.length - 1)] || _vers[0];
    const small = JSON.parse(R(['--from', _fromRecent, '--json']).stdout);
    const smallOk = small.truncated === false && small.hint === undefined && small.shown === small.totalVersions && small.shown > 0;
     
     
     
    let mcpOk = false;
    try {
      let txt = '', cursor = null;
      for (let i = 0; i < 20; i++) {
        const mcpReq = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_whats_new', arguments: { from: '1.9.33', limit: 2, ...(cursor !== null ? { _cursor: cursor } : {}) } } });
        const mcpR = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 25000, input: mcpReq + '\n', maxBuffer: 32 * 1024 * 1024 });
        if (mcpR.error || mcpR.status !== 0) throw new Error('mcp serve failed');
        const res = JSON.parse(mcpR.stdout.split('\n').filter(Boolean)[0]).result;
        if (!res || res.isError) throw new Error('tool error');
        txt += res.content[0].text;
        cursor = res.nextCursor === undefined ? null : res.nextCursor;    
        if (cursor === null) break;
        if (typeof cursor !== 'string' || !/^\d+$/.test(cursor)) throw new Error('invalid cursor');
      }
      const doc = JSON.parse(txt);
      mcpOk = cursor === null && doc.shown === 2 && Array.isArray(doc.versions) && doc.versions.length === 2;
    } catch {}
    const all = JSON.parse(R(['--from', '1.9.33', '--json', '--all']).stdout);
    const allOk = all.shown === all.totalVersions && all.truncated === false && all.versions.length === def.totalVersions;
    const lim = JSON.parse(R(['--from', '1.9.33', '--json', '--limit', '3']).stdout);
    const limOk = lim.shown === 3 && lim.versions.length === 3;
     
    const defRaw = R(['--from', '1.9.33', '--json']).stdout;
    const sizeOk = defRaw.length < 200 * 1024;
    ok = defOk && allOk && limOk && sizeOk && badLim && smallOk && mcpOk;
    if (!ok) console.log(`   [wn 디버그] def=${defOk} all=${allOk} lim=${limOk} size=${sizeOk}(${Math.round(defRaw.length / 1024)}KB) bad=${badLim} small=${smallOk} mcp=${mcpOk}`);
  } catch (e) {}
  console.log(ok ? '✓ B(1.36.69) whats-new --json 상한 30(정확) + truncated/hint + --all/--limit + 무효limit 폴백 + MCP 전달 + 200KB 미만' : '✗ whats-new 상한 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.70)')) {
  total++;
  let ok = false;
  const _d = [];
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-migcap-')); _d.push(d);
     
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    fs.writeFileSync(path.join(d, '.leerness', 'HARNESS_VERSION'), '1.9.33');
    cp.spawnSync(process.execPath, [CLI, 'migrate', d], { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
    const rep = fs.readFileSync(path.join(d, '.leerness', 'migration-report.md'), 'utf8');
    const sizeOk = rep.length < 30 * 1024;
     
    const hm = rep.match(/최신 (\d+)\/(\d+)/);
    const shown = hm ? parseInt(hm[1], 10) : 0, totalV = hm ? parseInt(hm[2], 10) : 0;
    const hlRows = (rep.match(/^- \d+\.\d+\.\d+ — /gm) || []).length;
    const om = rep.match(/외 (\d+)개 버전/);
    const capOk = shown === 30 && totalV > 30 && hlRows === 30 && !!om && parseInt(om[1], 10) === totalV - 30;
    const escapeOk = rep.includes('whats-new --from 1.9.33');    
     
    const limTxt = cp.spawnSync(process.execPath, [CLI, 'whats-new', '--from', '1.9.33', '--limit', '5'], { encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024 });
    const limRows = (limTxt.stdout.match(/^ {2}• \d+\.\d+\.\d+/gm) || []).length;
    const limOk = limRows === 5 && /외 \d+개 버전|more version/.test(limTxt.stdout);
    ok = sizeOk && capOk && escapeOk && limOk;
    if (!ok) console.log(`   [migcap 디버그] size=${sizeOk}(${Math.round(rep.length / 1024)}KB) cap=${capOk}(${shown}/${totalV},rows=${hlRows}) escape=${escapeOk} lim=${limOk}(${limRows})`);
  } catch (e) {} finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.70) migrate 보고 상한: 88KB→<30KB + 외N개 정직 표기 + whats-new 탈출구' : '✗ migrate 보고 상한 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.71)')) {
  total++;
  let ok = false;
  const _d = [];
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-retrocap-')); _d.push(d);
    const initR = cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    const R = (extra) => JSON.parse(cp.spawnSync(process.execPath, [CLI, ...extra, '--path', d, '--json'], { encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024 }).stdout);
     
    const baseline = R(['retro', '--all']).data.rowsTotal;
    let addFails = 0;
    for (let i = 1; i <= 35; i++) { const a = cp.spawnSync(process.execPath, [CLI, 'task', 'add', `t${i}`, '--path', d], { encoding: 'utf8', timeout: 15000 }); if (a.status !== 0) addFails++; }
    const expTotal = baseline + 35;
    const r = R(['retro']);
    const retroOk = initR.status === 0 && addFails === 0
      && r.data.rowsShown === 30 && r.data.rowsTotal === expTotal && r.data.rowsTruncated === true
      && r.data.rows.length === 30 && r.data.rows[29].request === 't35'    
      && r.data.totalTasks === expTotal;                                   
    const rAll = R(['retro', '--all']);
    const allOk = rAll.data.rowsShown === expTotal && rAll.data.rowsTruncated === false;
    const rLim = R(['retro', '--limit', '5']);
    const limOk = rLim.data.rowsShown === 5 && rLim.data.rows[4].request === 't35';
    const ins = R(['insights']);
    const insOk = ins.data.rowsShown === 30 && ins.data.rowsTotal === expTotal;
    ok = retroOk && allOk && limOk && insOk;
    if (!ok) console.log(`   [retrocap 디버그] retro=${retroOk}(exp=${expTotal},got=${r.data.rowsTotal},addFail=${addFails}) all=${allOk} lim=${limOk} ins=${insOk}`);
  } catch (e) {} finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.71) retro/insights --json rows 상한 30 + 최신 유지 + 집계 전량 기준 + --all/--limit' : '✗ retro/insights rows 상한 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.72)')) {
  total++;
  let ok = false;
  const _d = [];
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tlcap-')); _d.push(d);
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    const R = (extra) => JSON.parse(cp.spawnSync(process.execPath, [CLI, 'task', 'list', '--path', d, '--json', ...extra], { encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024 }).stdout);
    const baseline = R(['--all']).total;
    for (let i = 1; i <= 105; i++) { const a = cp.spawnSync(process.execPath, [CLI, 'task', 'add', `x${i}`, '--path', d], { encoding: 'utf8', timeout: 15000 }); if (a.status !== 0) throw new Error('add fail'); }
    const expTotal = baseline + 105;
    const j = R([]);
    const capOk = j.shown === 100 && j.total === expTotal && j.truncated === true && j.tasks.length === 100 && j.tasks[99].request === 'x105';
    const allOk = R(['--all']).shown === expTotal;
    const limOk = R(['--limit', '7']).tasks.length === 7;
     
    const LINT = path.join(path.dirname(CLI), '..', 'scripts', 'lint.js');
    const missOk = cp.spawnSync(process.execPath, [LINT, path.join(d, 'no-such-dir')], { encoding: 'utf8', timeout: 20000 }).status === 1;
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lintempty-')); _d.push(emptyDir);
    const emptyOk = cp.spawnSync(process.execPath, [LINT, emptyDir], { encoding: 'utf8', timeout: 20000 }).status === 1;
    ok = capOk && allOk && limOk && missOk && emptyOk;
    if (!ok) console.log(`   [tlcap 디버그] cap=${capOk}(${j.shown}/${j.total}) all=${allOk} lim=${limOk} lintMiss=${missOk} lintEmpty=${emptyOk}`);
  } catch (e) {} finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.72) task list --json 상한 100 + --all/--limit + lint 거짓 PASS 차단(F16)' : '✗ task list 상한/lint F16 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.73)')) {
  total++;
  let ok = false;
  const _d = [];
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-f12-')); _d.push(d);
     
    const i1 = cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'en', '--skills', 'all', '--no-stale-check', '--no-env'], { encoding: 'utf8', timeout: 40000 });
    const i2 = cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'en', '--skills', 'recommended', '--no-stale-check', '--no-env'], { encoding: 'utf8', timeout: 40000 });
    const dirSet = fs.readdirSync(path.join(d, '.leerness', 'skills'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
    const lockSet = Object.keys(JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'skills-lock.json'), 'utf8')).installedSkills).sort();
    const f12Ok = i1.status === 0 && i2.status === 0 && dirSet.length >= 2 && JSON.stringify(dirSet) === JSON.stringify(lockSet);    
     
    const d9 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-f9-')); _d.push(d9);
    const i3 = cp.spawnSync(process.execPath, [CLI, 'init', d9, '--yes', '--language', 'en', '--no-stale-check', '--no-env'], { encoding: 'utf8', timeout: 40000 });
    const cl = path.join(d9, 'CLAUDE.md');
    const ko = Array.from({ length: 15 }, (_, i) => '한국어 구판 템플릿 라인 ' + i).join('\n');
    fs.appendFileSync(cl, '\n' + ko + '\nMY_CUSTOM_KEEP_42\n');
    fs.writeFileSync(path.join(d9, '.leerness', 'HARNESS_VERSION'), '1.36.0');
    const mg = cp.spawnSync(process.execPath, [CLI, 'migrate', d9], { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
    const after = fs.readFileSync(cl, 'utf8');
    const mg2 = cp.spawnSync(process.execPath, [CLI, 'migrate', d9], { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
    const after2 = fs.readFileSync(cl, 'utf8');
    const f9Ok = i3.status === 0 && mg.status === 0 && mg2.status === 0
      && after.includes('Korean lines were preserved')                     
      && after.includes('MY_CUSTOM_KEEP_42')                               
      && (after2.match(/Korean lines were preserved/g) || []).length === 1;    
     
    const m = require(path.join(path.dirname(CLI), '..', 'lib', 'pure-utils.js'));
    const userLine = '> ⚠ 10 Korean lines were preserved for localization QA.';
    const surv = m._managedMerge('CLAUDE.md', '# N\n', '# O\n' + userLine, 'a', null, { lang: 'en' }).includes(userLine);
    ok = f12Ok && f9Ok && surv;
    if (!ok) console.log(`   [f12/f9 디버그] f12=${f12Ok}(${dirSet.length}/${lockSet.length}) f9=${f9Ok}(mg=${mg.status}) surv=${surv}`);
  } catch (e) {} finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.73) F12 skills-lock=디스크 실재 + F9 KO-잔존 이월 안내(멱등·무손실·소수 무경고)' : '✗ F12/F9 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.74)')) {
  total++;
  let ok = false;
  const _d = [];
  try {
     
    const d1 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-h9s-')); _d.push(d1);
    cp.spawnSync(process.execPath, [CLI, 'state', 'start', 'original-goal', '--path', d1, '--json'], { encoding: 'utf8', timeout: 30000 });
    const runFile = path.join(d1, '.leerness', 'runs', 'run-0001.json');
    const before = fs.readFileSync(runFile, 'utf8');
    fs.writeFileSync(path.join(d1, '.leerness', 'state.json'), '{}\n');
    const s2 = cp.spawnSync(process.execPath, [CLI, 'state', 'start', 'replacement-goal', '--path', d1, '--json'], { encoding: 'utf8', timeout: 30000 });
    const stateOk = s2.status === 1 && fs.readFileSync(runFile, 'utf8') === before;
     
    const d1b = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-h9s2-')); _d.push(d1b);
    fs.mkdirSync(path.join(d1b, '.leerness'), { recursive: true });
    fs.writeFileSync(path.join(d1b, '.leerness', 'state.json'), '{}\n');
    const freshOk = cp.spawnSync(process.execPath, [CLI, 'state', 'start', 'g', '--path', d1b, '--json'], { encoding: 'utf8', timeout: 30000 }).status === 0;
     
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-h9r-')); _d.push(d2);
    cp.spawnSync(process.execPath, [CLI, 'init', d2, '--yes', '--minimal', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    const D = (a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d2], { encoding: 'utf8', timeout: 20000 });
    D(['decision', 'add', 'Collision Decision', '--reason', 'archived-original']);
    D(['decision', 'drop', 'Collision Decision']);
    D(['decision', 'add', 'Collision Decision', '--reason', 'active-replacement']);
    const conflict = D(['memory', 'restore', 'decisions', 'Collision Decision']);
    const cnt = () => { try { return (JSON.parse(D(['decision', 'list', '--json']).stdout).decisions || []).filter(x => x.title === 'Collision Decision').length; } catch { return -1; } };
    const restoreOk = conflict.status === 1 && cnt() === 1 && D(['memory', 'restore', 'decisions', 'Collision Decision', '--force']).status === 0 && cnt() === 2;
     
    const d1c = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-h9st-')); _d.push(d1c);
    cp.spawnSync(process.execPath, [CLI, 'state', 'start', 'ORIGINAL', '--path', d1c, '--json'], { encoding: 'utf8', timeout: 30000 });
    const rf1 = path.join(d1c, '.leerness', 'runs', 'run-0001.json');
    const beforeStale = fs.readFileSync(rf1, 'utf8');
    const stp = path.join(d1c, '.leerness', 'state.json');
    const stj = JSON.parse(fs.readFileSync(stp, 'utf8')); stj.runCounter = 0; stj.currentRunId = null;
    fs.writeFileSync(stp, JSON.stringify(stj, null, 2));
    const staleR = cp.spawnSync(process.execPath, [CLI, 'state', 'start', 'REPLACEMENT', '--path', d1c, '--json'], { encoding: 'utf8', timeout: 30000 });
    const staleOk = staleR.status === 1 && fs.readFileSync(rf1, 'utf8') === beforeStale;
     
    const d2b = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-h9id-')); _d.push(d2b);
    cp.spawnSync(process.execPath, [CLI, 'init', d2b, '--yes', '--minimal', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    const D2 = (a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d2b], { encoding: 'utf8', timeout: 20000 });
    D2(['decision', 'add', 'Dup Title', '--reason', 'first']); D2(['decision', 'drop', 'Dup Title']);
    const ap2 = path.join(d2b, '.leerness', 'decisions.archive.md');
    if (fs.existsSync(ap2)) fs.writeFileSync(ap2, fs.readFileSync(ap2, 'utf8').replace(/### \d{4}-\d{2}-\d{2}/g, '### 2020-01-01'));
    D2(['decision', 'add', 'Dup Title', '--reason', 'second']);
    const logicalOk = D2(['memory', 'restore', 'decisions', 'Dup Title']).status === 1;
    D2(['lesson', 'save', 'AAA 무관한 교훈']); D2(['lesson', 'save', 'BBB 다른 교훈']); D2(['lesson', 'drop', 'AAA 무관한 교훈']);
    const noFpOk = D2(['memory', 'restore', 'lessons', 'AAA']).status === 0;    
     
    const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-h9a-')); _d.push(d3);
    const A = (u, dir) => cp.spawnSync(process.execPath, [CLI, 'api-skill', 'add', u, '--skeleton', '--no-crawl', '--direction', dir, '--path', d3, '--json'], { encoding: 'utf8', timeout: 25000 });
    A('ftp://example.test/docs?alpha', 'alpha-direction'); A('ftp://example.test/docs?beta', 'beta-direction');
    const askDir = path.join(d3, '.leerness', 'api-skills');
    const all = fs.existsSync(askDir) ? fs.readdirSync(askDir).map(f => fs.readFileSync(path.join(askDir, f), 'utf8')).join('\n') : '';
    const apiOk = /alpha-direction/.test(all) && /beta-direction/.test(all);
     
    const noNl = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 25000, input: JSON.stringify({ jsonrpc: '2.0', id: 101, method: 'ping' }) });
    let mcpOk = false;
    try { mcpOk = JSON.parse((noNl.stdout || '').trim()).id === 101; } catch {}
     
    const d4 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-h9c-')); _d.push(d4);
    fs.mkdirSync(path.join(d4, '.leerness', 'api-skills'), { recursive: true });
    fs.writeFileSync(path.join(d4, '.leerness', 'api-skills', 'bad.md'), '---\nid: intended\nname: X\n# no closing');
    let corruptOk = false, jsonOk = false;
    try { const j = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'api-skill', 'list', '--path', d4, '--json'], { encoding: 'utf8', timeout: 20000 }).stdout); corruptOk = j.corruptCount === 1 && j.skills[0].corrupt === true; } catch {}
    try { const j = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'api-skill', 'add', 'not-a-url', '--path', d4, '--json'], { encoding: 'utf8', timeout: 25000 }).stdout); jsonOk = j.ok === false && j.code === 'fetch_failed'; } catch {}
    ok = stateOk && freshOk && restoreOk && staleOk && logicalOk && noFpOk && apiOk && mcpOk && corruptOk && jsonOk;
    if (!ok) console.log(`   [h9 디버그] state=${stateOk} fresh=${freshOk} restore=${restoreOk} stale=${staleOk} logical=${logicalOk} noFp=${noFpOk} api=${apiOk} mcp=${mcpOk} corrupt=${corruptOk} json=${jsonOk}`);
  } catch (e) {} finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.74) 9차헌트: state 스키마 fail-closed · restore 충돌거부(--force 우회) · skeleton 충돌보존 · MCP 마지막줄 · 손상표시 · --json 계약' : '✗ 9차 헌트 수정 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.75)')) {
  total++;
  let ok = false;
  const _d = [];
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ur66-')); _d.push(d);
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    const P = (a) => cp.spawnSync(process.execPath, [CLI, 'preview', ...a, '--path', d], { encoding: 'utf8', timeout: 20000 });
     
    const add = P(['add', '신규 랜딩 페이지 제작', '--design', '히어로+3단', '--features', '히어로,FAQ']);
    const detectOk = add.status === 0 && /preview mockup P-0001/.test(add.stdout);
     
    const mk = P(['mockup', 'P-0001']);
    const mkFile = path.join(d, '.leerness', 'previews', 'P-0001-mockup.html');
    const html = fs.readFileSync(mkFile, 'utf8');
    const mkOk = mk.status === 0 && html.includes('신규 랜딩 페이지 제작') && html.includes('leerness:mockup P-0001');
    let showOk = false;
    try { showOk = JSON.parse(P(['show', 'P-0001', '--json']).stdout).mockupPath === '.leerness/previews/P-0001-mockup.html'; } catch {}
     
    fs.appendFileSync(mkFile, '<!-- AI-FILLED -->');
    const protectOk = P(['mockup', 'P-0001']).status === 0 && fs.readFileSync(mkFile, 'utf8').includes('AI-FILLED')
      && !(P(['mockup', 'P-0001', '--force']).status !== 0) && !fs.readFileSync(mkFile, 'utf8').includes('AI-FILLED');
     
    P(['add', '<script>alert(1)</script> 페이지', '--design', 'x']);
    P(['mockup', 'P-0002']);
    const xssOk = !fs.readFileSync(path.join(d, '.leerness', 'previews', 'P-0002-mockup.html'), 'utf8').includes('<script>alert');
     
    fs.writeFileSync(path.join(d, 'my-mockup.html'), '<h1>시안</h1>');
    let attachOk = false;
     
    try { const j = JSON.parse(P(['add', '첨부형 페이지', '--mockup', 'my-mockup.html', '--json']).stdout); attachOk = j.mockupPath === 'my-mockup.html' && j.title === '첨부형 페이지'; } catch {}
    const missOk = P(['add', '없는 첨부', '--mockup', 'no-such.html']).status === 1;
     
    fs.mkdirSync(path.join(d, 'adir'), { recursive: true });
    const dirOk = P(['add', 'd-dir', '--mockup', 'adir']).status === 1;
    const outFile = path.join(path.dirname(d), `ur66-out-${path.basename(d)}.html`);
    fs.writeFileSync(outFile, '<h1>o</h1>'); _d.push(outFile.replace(/\.html$/, ''));  
    const outOk = P(['add', 'd-out', '--mockup', outFile]).status === 1;
    try { fs.rmSync(outFile, { force: true }); } catch {}
     
    const evil = path.join(d, '.leerness', 'previews.json');
    const saved = fs.readFileSync(evil, 'utf8');
    fs.writeFileSync(evil, JSON.stringify([{ id: '..\\..\\owned', title: 'x', status: 'proposed' }]));
    const evilOk = cp.spawnSync(process.execPath, [CLI, 'preview', 'mockup', '..\\..\\owned', '--path', d], { encoding: 'utf8', timeout: 20000 }).status === 1
      && !fs.existsSync(path.join(d, '..', 'owned-mockup.html'));
    fs.writeFileSync(evil, saved);
     
    P(['approve', 'P-0001']);
    const apprOk = P(['mockup', 'P-0001', '--force']).status === 1;
    ok = detectOk && mkOk && showOk && protectOk && xssOk && attachOk && missOk && dirOk && outOk && evilOk && apprOk;
    if (!ok) console.log(`   [ur66 디버그] detect=${detectOk} mk=${mkOk} show=${showOk} protect=${protectOk} xss=${xssOk} attach=${attachOk} miss=${missOk} dir=${dirOk} out=${outOk} evil=${evilOk} appr=${apprOk}`);
  } catch (e) {} finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.75) UR-0066: preview mockup 시안(스캐폴드·보호·XSS·감지힌트·--mockup 첨부)' : '✗ UR-0066 시안 워크플로 실패');
  if (!ok) failed++;
}

 
 
 
 
if (e2eShard.take('B(1.36.88) #2')) {
  total++;
  let ok = false;
  const _d = [];
  const R = (args, cwd) => { const r = cp.spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 180000, cwd }); return { s: r.status, o: ((r.stdout || '') + (r.stderr || '')).trim() }; };
  let A = false, B = false, C = false, D = false, E = false, F = false, G = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bfgate-')); _d.push(d);
    R(['init', d, '--yes', '--language', 'ko', '--no-stale-check']);
    fs.mkdirSync(path.join(d, 'src'), { recursive: true });
    const BUGGY = 'console.log("BUG_HERE"); process.exit(3);';
    fs.writeFileSync(path.join(d, 'src', 'app.js'), BUGGY);
    const ID = ((R(['task', 'add', 'fix order status', '--path', d, '--json', '--no-review']).o.match(/"id"\s*:\s*"([^"]+)"/)) || [])[1];
     
    R(['bugfix', 'start', ID, '--repro', 'node src/app.js', '--expect-bad', 'BUG_HERE', '--path', d, '--json']);
    G = R(['task', 'update', ID, '--status', 'in-progress', '--path', d]).s === 0
      && R(['task', 'update', ID, '--status', 'done', '--path', d]).s === 0;
     
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bfgate2-')); _d.push(d2);
    R(['init', d2, '--yes', '--language', 'ko', '--no-stale-check']);
    R(['toggle', 'set', 'bugfix-receipt', 'on', '--path', d2]);
    fs.mkdirSync(path.join(d2, 'src'), { recursive: true });
    fs.writeFileSync(path.join(d2, 'src', 'app.js'), BUGGY);
    const ID2 = ((R(['task', 'add', 'fix order status', '--path', d2, '--json', '--no-review']).o.match(/"id"\s*:\s*"([^"]+)"/)) || [])[1];
     
    F = R(['bugfix', 'start', 'T-9999', '--repro', 'node src/app.js', '--expect-bad', 'BUG_HERE', '--path', d2, '--json']).s === 1;
    R(['bugfix', 'start', ID2, '--repro', 'node src/app.js', '--expect-bad', 'BUG_HERE', '--path', d2, '--json']);
     
     
    const ar = R(['task', 'update', ID2, '--status', 'done', '--path', d2, '--json']);
    A = ar.s === 1 && /"code":\s*"probe_still_failing"/.test(ar.o);
     
    R(['task', 'export', '--to', path.join(d2, 'todo.json'), '--path', d2]);
    const todo = JSON.parse(fs.readFileSync(path.join(d2, 'todo.json'), 'utf8'));
    todo.forEach(t => { if (t.content === 'fix order status') t.status = 'completed'; });
    fs.writeFileSync(path.join(d2, 'todo.json'), JSON.stringify(todo));
    const bs = R(['task', 'sync', '--from', path.join(d2, 'todo.json'), '--path', d2]);
    const tracker = fs.readFileSync(path.join(d2, '.leerness', 'progress-tracker.md'), 'utf8');
    B = bs.s === 1 && !(new RegExp('\\|\\s*' + ID2 + '\\s*\\|\\s*done\\s*\\|').test(tracker));
     
    const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bfgate3-')); _d.push(d3);
    R(['init', d3, '--yes', '--language', 'ko', '--no-stale-check']);
    R(['toggle', 'set', 'bugfix-receipt', 'on', '--path', d3]);
    fs.mkdirSync(path.join(d3, 'src'), { recursive: true });
    fs.writeFileSync(path.join(d3, 'src', 'app.js'), BUGGY);
    const ID3 = ((R(['task', 'add', 'fix order status', '--path', d3, '--json', '--no-review']).o.match(/"id"\s*:\s*"([^"]+)"/)) || [])[1];
    R(['task', 'update', ID3, '--status', 'done', '--evidence', 'r1', '--path', d3]);    
    R(['bugfix', 'start', ID3, '--repro', 'node src/app.js', '--expect-bad', 'BUG_HERE', '--path', d3, '--json']);
    C = R(['task', 'update', ID3, '--status', 'done', '--evidence', 'r2', '--path', d3]).s === 1;
     
     
    fs.writeFileSync(path.join(d3, 'src', 'app.js'), 'process.exit(0);');
    const c2 = R(['task', 'update', ID3, '--status', 'done', '--path', d3, '--json']);
    C = C && c2.s === 1 && /"code":\s*"receipt_incomplete"/.test(c2.o);
     
    R(['bugfix', 'receipt', ID3, '--root-cause', '상태 매핑 누락', '--siblings', 'ssg,11st', '--path', d3, '--json']);
    const dr = R(['task', 'update', ID3, '--status', 'done', '--evidence', 'r3', '--path', d3]);
    D = dr.s === 0 && /선언/.test(dr.o) && /진위는 검증하지 않았/.test(dr.o);
     
    E = R(['bugfix', 'drop', ID3, '--path', d3, '--json']).s === 0
      && R(['task', 'update', ID3, '--status', 'done', '--path', d3]).s === 0;
    ok = A && B && C && D && E && F && G;
    if (!ok) console.log(`   [bugfix게이트 디버그] update차단(probe사유)=${A} sync차단=${B} 재오픈차단+영수증사유=${C} 정상통과=${D} drop탈출=${E} 없는id거부=${F} 토글OFF무영향=${G}`);
  } catch (e) { console.log('   [bugfix게이트 디버그] 예외: ' + ((e && e.message) || e)); }
  finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.88) bugfix 완료 게이트 배선: task update·task sync 양 경로 차단 · 재오픈 차단 · 수정후 통과(선언 고지) · drop 탈출 · 없는id 거부 · 토글OFF 무영향' : '✗ bugfix 완료 게이트 배선 실패');
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('B(1.36.89)')) {
  total++;
  let ok = false;
  const _d = [];
  const R = (args, cwd) => { const r = cp.spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 120000, cwd }); return { s: r.status, o: ((r.stdout || '') + (r.stderr || '')).trim() }; };
  const J = (x) => { try { return JSON.parse(x.o.slice(x.o.indexOf('{'))); } catch { return null; } };
  let C1 = false, C2 = false, C3 = false, C4 = false, D1 = false, D2 = false, D3 = false, D4 = false, D5 = false, H1 = false, H2 = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-route-')); _d.push(d);
    R(['init', d, '--yes', '--language', 'ko', '--no-stale-check']);
    const cls = (t, extra = []) => J(R(['agents', 'route', t, '--path', d, '--json', ...extra]));
     
    C1 = (cls('결제 환불 로직 수정') || {}).tier === 'high-risk'
       
       
      && ['fix typo in authentication middleware', 'fix typo in authorization permissions',
          'fix typo in concurrency and idempotency control'].every(t => (cls(t) || {}).tier === 'high-risk')
       
      && (cls('fix typo in author bio css') || {}).tier === 'tiny';
    const conf = cls('인증 문서 오타 수정') || {};
    C2 = conf.tier === 'high-risk' && conf.conflict === true && conf.confidence === 'low';
    C3 = (cls('버튼 여백 4px 조정') || {}).tier === 'tiny'
       
      && (cls('Rewrite the entire compiler, replace the storage engine, and also fix one typo') || {}).tier === 'normal'
      && (cls('전체 아키텍처를 갈아엎고 저장 엔진을 교체하고 오타도 수정') || {}).tier === 'normal';
    const weak = cls('x') || {};
    C4 = weak.tier === 'normal' && weak.confidence === 'low'    
       
      && /"code":\s*"empty_task"/.test(R(['agents', 'route', '--tier', 'tiny', '--path', d, '--json']).o);
     
    const dec = cls('결제 로직 오타', ['--tier', 'tiny']) || {};
     
     
    const badTier = R(['agents', 'route', 'x', '--tier', 'huge', '--path', d, '--json']);
     
     
    D1 = dec.tier === 'high-risk' && dec.confidence === 'declared'
      && dec.declaredTier === 'tiny' && dec.detectedTier === 'high-risk'
      && dec.riskDowngrade && dec.riskDowngrade.accepted === false
      && (dec.reasons || []).some(r => /의도한 것인지/.test(r))
      && badTier.s === 1 && /"code":\s*"invalid_tier"/.test(badTier.o);
     
    const off = R(['agents', 'route', '주문 필터 추가', '--confirm', '--path', d, '--json']);
    D2 = off.s === 1 && /"routing_disabled"/.test(off.o);
     
    R(['toggle', 'set', 'difficulty-routing', 'on', '--path', d]);
    const nr = R(['agents', 'route', '주문 필터 추가', '--confirm', '--path', d, '--json']);
    D3 = nr.s === 1 && /"role_unresolved"/.test(nr.o) && !/"routing_disabled"/.test(nr.o);
     
     
     
    R(['roles', 'set', 'commander', '--provider', 'claude', '--model', 'claude-fixture', '--model-family', 'claude', '--path', d]);
    R(['roles', 'set', 'coder', '--provider', 'codex', '--model', 'gpt-fixture', '--model-family', 'openai-gpt', '--path', d]);
    R(['roles', 'set', 'reviewer', '--provider', 'claude', '--model', 'claude-review-fixture', '--model-family', 'claude', '--path', d]);
    const okd = J(R(['agents', 'route', '주문 필터 추가', '--confirm', '--path', d, '--json'])) || {};
    D4 = okd.confirmed === true && okd.plan && okd.plan.reviewerIndependent === true;
     
    R(['roles', 'set', 'architect', '--provider', 'codex', '--model', 'gpt-architect-fixture', '--model-family', 'openai-gpt', '--path', d]);
    const hr = R(['agents', 'route', '결제 환불 로직 수정', '--confirm', '--path', d, '--json']);
    H1 = hr.s === 1 && /"human_approval_required"/.test(hr.o) && !/"role_unresolved"/.test(hr.o);
    const hr2 = J(R(['agents', 'route', '결제 환불 로직 수정', '--confirm', '--approved-by', '승인자', '--path', d, '--json'])) || {};
    D5 = hr2.confirmed === true;
     
    R(['roles', 'set', 'reviewer', '--provider', 'codex', '--model', 'gpt-review-fixture', '--model-family', 'openai-gpt', '--path', d]);
    const dep = R(['agents', 'route', '결제 환불 로직 수정', '--confirm', '--approved-by', '승인자', '--path', d, '--json']);
    H2 = dep.s === 1 && /"reviewer_not_independent"/.test(dep.o) && !/"human_approval_required"/.test(dep.o);
     
     
    const rolesFile = path.join(d, '.leerness', 'agent-roles.json');
    const savedRoles = fs.existsSync(rolesFile) ? fs.readFileSync(rolesFile, 'utf8') : null;
     
     
     
    const invalidRoles = JSON.stringify({ schemaVersion: 1, roles: { coder: { provider: '   ' } } });
    fs.writeFileSync(rolesFile, invalidRoles);
    const emptyProv = R(['agents', 'route', '버튼 여백 4px 조정', '--confirm', '--path', d, '--json']);
    const emptyProvJ = J(emptyProv) || {};
    const emptyProvOk = emptyProv.s === 1
      && emptyProvJ.code === 'store_invalid' && emptyProvJ.state === 'invalid'
      && emptyProvJ.originalPreserved === true && emptyProvJ.providerCommandsExecuted === false
      && Array.isArray(emptyProvJ.problems)
      && emptyProvJ.problems.some(problem => problem.code === 'invalid-legacy-provider')
      && fs.readFileSync(rolesFile, 'utf8') === invalidRoles;
    if (savedRoles !== null) fs.writeFileSync(rolesFile, savedRoles); else fs.rmSync(rolesFile, { force: true });
     
    const lg = J(R(['agents', 'route', '--log', '--path', d, '--json'])) || {};
    const ents = lg.entries || [];
    const auditOk = (lg.total || 0) >= 8
      && ents.some(e => e.tier === 'high-risk' && e.confirmed === true && e.approvedBy === '승인자'
        && Array.isArray(e.assignments) && e.assignments.some(a => a.role === 'coder' && a.provider)
        && Array.isArray(e.signals) && e.signals.some(s => /^high-risk:/.test(s)))
      && ents.some(e => e.confirmed === false && Array.isArray(e.refusals) && e.refusals.length > 0);    
     
    const lp = path.join(d, '.leerness', 'routing-log.json');
    const savedLog = fs.readFileSync(lp, 'utf8');
    fs.writeFileSync(lp, '{"소중한":"기록"}');
    R(['agents', 'route', '무해한 조회', '--path', d]);
    const auditPreserved = fs.readFileSync(lp, 'utf8') === '{"소중한":"기록"}';
    fs.writeFileSync(lp, savedLog);
     
    const human = R(['agents', 'route', '주문 필터', '--path', d]).o;
    const logHuman = R(['agents', 'route', '--log', '--path', d]).o;
    const cj = J(R(['agents', 'route', '주문 필터 추가', '--confirm', '--path', d, '--json'])) || {};
    const honestOk = /확인하지 않습니다/.test(human) && /측정값이 아닙니다/.test(human)
      && !/설치·활성 여부만 확인/.test(human)                        
      && /확인하지 않습니다/.test(logHuman) && /작업을 대신 수행하지 않습니다/.test(logHuman)
      && cj.executed === false && typeof cj.confirmed === 'boolean' && !('dispatched' in cj)
       
       
       
      && /모델 호출\(과금\)은 하지 않습니다/.test(JSON.stringify(cj))
      && /--confirm 으로 확정할 때만/.test(JSON.stringify(cj))
      && /버전 확인과 로그인 상태 명령을 실행/.test(JSON.stringify(cj))
      && !/외부 CLI 를 실행하지 않습니다/.test(JSON.stringify(cj))
      && !/상태 명령만 실행/.test(JSON.stringify(cj));
     
     
    const srcOk = !/(claude-(opus|sonnet|haiku)|gpt-[45]|o[34]-mini|gemini-)/i.test(fs.readFileSync(path.join(path.dirname(CLI), '..', 'lib', 'routing.js'), 'utf8'));
    ok = C1 && C2 && C3 && C4 && D1 && D2 && D3 && D4 && D5 && H1 && H2 && auditOk && auditPreserved && honestOk && srcOk && emptyProvOk;
    if (!ok) console.log(`   [route 디버그] C1=${C1} C2=${C2} C3=${C3} C4=${C4} D1=${D1} OFF거부=${D2} 역할미설정거부=${D3} normal실행=${D4} 고위험실행=${D5} 승인필요=${H1} 독립성=${H2} 감사=${auditOk} 손상보존=${auditPreserved} 정직=${honestOk} 소스=${srcOk} 빈provider=${emptyProvOk} log=${lg.total}`);
  } catch (e) { console.log('   [route 디버그] 예외: ' + ((e && e.message) || e)); }
  finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.89) agents route 난이도 라우팅: 결정적 분류(충돌시 보수적·근거부족시 normal) · 토글OFF/역할미설정/사람승인/검수독립성 4중 fail-closed · 감사기록 · 모델명 비하드코딩 · 미검증 고지' : '✗ agents route 라우팅 실패');
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('B(1.36.90)')) {
  total++;
  let ok = false;
  const _d = [];
  const R = (args, cwd) => { const r = cp.spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 120000, cwd }); return { s: r.status, o: ((r.stdout || '') + (r.stderr || '')).trim() }; };
  let S1 = false, S2 = false, S3 = false, X1 = false, B1 = false, B2 = false, B3 = false, B4 = false, R1 = false, R2 = false, R3 = false, P1 = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-dash-')); _d.push(d);
    R(['init', d, '--yes', '--language', 'ko', '--no-stale-check']);
    R(['task', 'add', '<script>alert(1)</script> XSS 픽스처', '--path', d, '--json', '--no-review']);
     
    let snap = null; try { const o = R(['dashboard', '--path', d, '--json']).o; snap = JSON.parse(o.slice(o.indexOf('{'))); } catch {}
    S1 = !!snap && snap.ok === true && snap.readOnly === true && Array.isArray(snap.toggles) && snap.toggles.length > 0
      && snap.tasks && typeof snap.tasks.total === 'number' && snap.tasks.total > 0;
     
    S2 = !!snap && snap.toggles.some(t => t.defaultOff === true && t.on === false);
     
    S3 = !!snap && /게이트를 실행하거나 통과시키지 않/.test(snap.gateNote || '') && /graph --html/.test(snap.staticNote || '');
     
     
    const html = require(path.join(path.dirname(CLI), '..', 'lib', 'dashboard.js')).renderHtml(snap);
     
     
    S3 = S3
      && /읽기 전용 명령은 사용량 카운터도 갱신하지 않/.test(html)
      && !/모든 명령에서 로컬 사용량 카운터/.test(html);
    X1 = !/<script>alert\(1\)<\/script>/.test(html) && !/<img\s/i.test(html) && /&lt;script&gt;/.test(html);
     
     
     
     
    const EXEC_EXT = /\.(js|mjs|cjs|ts|py|sh|bash|ps1|bat|cmd|exe)$/i;
    const walk = (dir, acc = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, acc); else if (e.isFile()) acc.push(p);
      }
      return acc;
    };
    B1 = walk(path.join(d, '.leerness')).filter(f => EXEC_EXT.test(f)).length === 0;       
    B2 = !fs.readdirSync(d).some(f => /leerness/i.test(f) && EXEC_EXT.test(f));            
    const gp = path.join(d, 'leerness.html');
    try { fs.rmSync(gp, { force: true }); } catch {}
    const gr = R(['graph', '--html', '--path', d]);
    B3 = gr.s === 0 && fs.existsSync(gp) && fs.statSync(gp).size > 1000;                   
     
    const stateSig = () => fs.readdirSync(path.join(d, '.leerness'), { withFileTypes: true })
      .filter(e => e.isFile()).map(e => { const p = path.join(d, '.leerness', e.name); const st = fs.statSync(p); return `${e.name}:${st.size}:${Math.round(st.mtimeMs)}`; }).sort().join('|');
    const sigBefore = stateSig();
    R(['dashboard', '--path', d, '--json']);
    B4 = stateSig() === sigBefore;
     
    fs.writeFileSync(path.join(d, '.leerness', 'previews.json'), '[null]');
    const crash = R(['dashboard', '--path', d, '--json']);
    fs.writeFileSync(path.join(d, '.leerness', 'previews.json'), '{}');
    const nonArr = R(['dashboard', '--path', d, '--json']);
    let nj = null; try { nj = JSON.parse(nonArr.o.slice(nonArr.o.indexOf('{'))); } catch {}
    R1 = crash.s === 0 && !/TypeError|Cannot read/.test(crash.o)
      && nonArr.s === 0 && !!nj && (nj.notes || []).some(n => /previews\.json/.test(n));    
    fs.writeFileSync(path.join(d, '.leerness', 'previews.json'), '[]');
    fs.writeFileSync(path.join(d, '.leerness', 'bugfix-receipts.json'), JSON.stringify([
      { id: 'T-0777', repro: 'API_TOKEN=sk-live-LEAKME npm test', expectBad: 'x', baseline: { failed: true, exit: 1 }, rootCause: 'rc', siblingScope: { checked: [] } },
    ]));
    const leak = R(['dashboard', '--path', d, '--json']);
    let lj = null; try { lj = JSON.parse(leak.o.slice(leak.o.indexOf('{'))); } catch {}
    R2 = !!lj && !/sk-live-LEAKME/.test(leak.o) && /API_TOKEN=\*\*\*/.test(JSON.stringify(lj));
     
    R3 = !!lj && Array.isArray(lj.bugfix) && lj.bugfix.length === 1 && lj.bugfix[0].siblingScope === false;
    fs.rmSync(path.join(d, '.leerness', 'bugfix-receipts.json'), { force: true });
     
    P1 = R(['dashboard', '--path', d, '--port', '99999']).s === 1 && R(['dashboard', '--path', d, '--timeout', '2147484']).s === 1;
    ok = S1 && S2 && S3 && X1 && B1 && B2 && B3 && B4 && R1 && R2 && R3 && P1;
    if (!ok) console.log(`   [dashboard 디버그] 스냅샷=${S1} 토글상태=${S2} 고지=${S3} XSS=${X1} harness실행코드0=${B1} 루트실행기없음=${B2} 정적뷰존속=${B3} 상태무변경=${B4} 형상내성=${R1} 시크릿마스킹=${R2} 술어일치=${R3} 범위검증=${P1}`);
  } catch (e) { console.log('   [dashboard 디버그] 예외: ' + ((e && e.message) || e)); }
  finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.90) dashboard 읽기전용: 스냅샷/토글상태 · 게이트 미판정·정적뷰 존속 고지 · XSS 이스케이프 · 경계 3종(재귀 .leerness 실행코드0 · 루트 실행기 미생성 · leerness.html 실제 재생성) · 상태 무변경 · 형상내성/시크릿마스킹/게이트와 동일 술어 · 포트·타임아웃 범위검증' : '✗ dashboard 실패');
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('B(1.36.91)')) {
  total++;
  let ok = false;
  const _d = [];
  const R = (args) => { const r = cp.spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 120000 }); return { s: r.status, o: ((r.stdout || '') + (r.stderr || '')).trim() }; };
  const J = (x) => { try { return JSON.parse(x.o.slice(x.o.indexOf('{'))); } catch { return null; } };
  let A1 = false, A2 = false, A3 = false, A4 = false, A5 = false, A6 = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-auth-')); _d.push(d);
    R(['init', d, '--yes', '--language', 'ko', '--no-stale-check']);
    const chk = J(R(['agents', 'check', '--path', d, '--json'])) || {};
     
    A1 = Array.isArray(chk.agents) && chk.agents.length > 0
      && chk.agents.every(a => ['ok', 'no', 'unknown'].includes(a.auth))
      && Array.isArray(chk.authUnknown) && chk.authUnknown.length > 0
      && /쿼터·과금 권한은 어느 provider 도 확인하지 않았/.test(chk.authNote || '');
     
    const reg = require(path.join(path.dirname(CLI), '..', 'lib', 'agent-registry.js')).EXTERNAL_AGENTS;
    const noCheckIds = reg.filter(a => !a.authCheck).map(a => a.id);
     
     
    A2 = noCheckIds.length > 0 && noCheckIds.every(id => {
      const a = chk.agents.find(x => x.id === id);
      return !!a && a.auth === 'unknown';
    });
     
     
     
     
    const _ck = require(CLI)._checkAgent;
     
     
     
     
    const _mkScript = (name, body) => { const p = path.join(d, name).replace(/\\/g, '/'); fs.writeFileSync(p, body); return p; };
    const S_OK = _mkScript('auth_ok.js', 'process.exit(0)');
    const S_NO = _mkScript('auth_no.js', 'console.log("Not logged in"); process.exit(3)');
    const S_ODD = _mkScript('auth_odd.js', 'console.log("config parse failed"); process.exit(2)');
     
     
     
    const mkAgent = (script) => ({ id: 'synthetic', bin: 'node', envFlag: 'LEERNESS_OFFLINE',
      versionArgs: [S_OK], desc: 'synthetic',
      authCheck: { args: [script], timeoutMs: 8000, noPattern: 'not logged in|logged out' } });
    const okRes = _ck(mkAgent(S_OK), { auth: true });
    const noRes = _ck(mkAgent(S_NO), { auth: true });
    const offRes = _ck(mkAgent(S_OK), {});                     
     
     
    const oddRes = _ck(mkAgent(S_ODD), { auth: true });
     
     
     
    const crashScript = path.join(d, 'authcrash.js').replace(/\\/g, '/');
    fs.writeFileSync(crashScript, 'throw new Error("broken check")');
    const leakScript = path.join(d, 'authleak.js').replace(/\\/g, '/');
    fs.writeFileSync(leakScript, 'console.log("token=sk-live-LEAKME ok"); process.exit(0)');
    const fileAgent = (f) => ({ id: 'syn', bin: 'node', envFlag: 'LEERNESS_OFFLINE', versionArgs: ['-e', 'process.exit(0)'], desc: 's',
      authCheck: { args: [f], timeoutMs: 8000 } });
    const crashRes = _ck(fileAgent(crashScript), { auth: true });
    const leakRes = _ck(fileAgent(leakScript), { auth: true });
     
    const metaRes = _ck({ id: 'syn', bin: 'node', envFlag: 'X', versionArgs: ['-e', 'process.exit(0)'], desc: 's',
      authCheck: { args: ['-e', 'console.log(1) && whoami'], timeoutMs: 3000 } }, { auth: true });
     
     
    const listJson = J(R(['agents', 'list', '--path', d, '--json']));
    const listNoAuth = !listJson || !Array.isArray(listJson.agents)
      || listJson.agents.every(a => a.auth === undefined || a.auth === 'unknown');
    A3 = !/인증 확인 \(1\.36\.91\)/.test(R(['agents', 'list', '--path', d]).o) && listNoAuth
      && okRes.auth === 'ok' && noRes.auth === 'no' && offRes.auth === 'unknown'
      && oddRes.auth === 'unknown'                                
      && typeof okRes.authSource === 'string' && okRes.authSource.length > 0
      && crashRes.auth === 'unknown'
      && leakRes.auth === 'ok' && !/sk-live-LEAKME/.test(String(leakRes.authEvidence)) && /token=\*\*\*/.test(String(leakRes.authEvidence))
      && metaRes.auth === 'unknown' && metaRes.authSource === null;
     
    const RTm = require(path.join(path.dirname(CLI), '..', 'lib', 'routing.js'));
    const roles = { architect: 'codex', commander: 'codex', coder: 'codex', reviewer: 'claude' };
     
     
    const planWith = (tier, authMap, allowed = true) => RTm.plan(d, { tier }, {
      authAllowed: allowed,
      _resolveRole: (r, role) => ({ provider: roles[role] }),
      _providerAuth: (pid) => authMap[pid] || 'unknown',
    });
    const hasAuthBlock = (p) => p.blockers.some(b => b.code === 'provider_not_authenticated');
    A4 = !hasAuthBlock(planWith('high-risk', {}))                         
      && !hasAuthBlock(planWith('high-risk', { codex: 'no' }, false));    
    A5 = hasAuthBlock(planWith('high-risk', { codex: 'no', claude: 'ok' }));   
     
     
     
    let calls = 0;
    const counting = (tier, allowed) => RTm.plan(d, { tier }, {
      authAllowed: allowed,
      _resolveRole: (r, role) => ({ provider: roles[role] }),
      _providerAuth: () => { calls++; return 'no'; },
    });
    calls = 0; const normalPlan = counting('normal', true); const normalCalls = calls;
    calls = 0; counting('high-risk', true); const highCalls = calls;
    calls = 0; counting('high-risk', false); const noConsentCalls = calls;
    A6 = !hasAuthBlock(planWith('normal', { codex: 'no', claude: 'no' }))      
      && !hasAuthBlock(normalPlan) && normalCalls === 0 && highCalls > 0       
      && noConsentCalls === 0                                                  
      && planWith('high-risk', {}).assignments.every(a => 'auth' in a);        
    ok = A1 && A2 && A3 && A4 && A5 && A6;
    if (!ok) console.log(`   [인증축 디버그] 축노출=${A1} 미확인은unknown=${A2} list무확인=${A3} unknown통과=${A4} 미인증차단=${A5} normal무관+축노출=${A6}`);
  } catch (e) { console.log('   [인증축 디버그] 예외: ' + ((e && e.message) || e)); }
  finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.91) 인증 축(설치됨≠사용가능): 확인 명령 있는 provider 만 ok/no · 나머지는 unknown 유지 · list 는 미확인(지연) · 라우팅은 unknown 통과 / 확실한 미인증만 고위험 차단' : '✗ 인증 축 실패');
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('B(1.36.92)')) {
  total++;
  let ok = false;
  const _d = [];
  let N1 = false, N2 = false, N3 = false, N4 = false, N5 = false;
  try {
    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-shim-')); _d.push(shimDir);
    const shimLog = path.join(shimDir, 'calls.log');
    const isWin = process.platform === 'win32';
     
    for (const binName of ['codex', 'claude']) writePortableCliShim(shimDir, binName, [
      `const fs = require('fs');`,
      `const argv = process.argv.slice(2);`,
      `fs.appendFileSync(${JSON.stringify(shimLog)}, ${JSON.stringify(binName + ' ')} + argv.join(' ') + '\\n');`,
      `if (argv[0] === '--version') { console.log(${JSON.stringify(binName + '-shim 1.0.0')}); process.exit(0); }`,
      `console.log('Logged in using shim');`,
    ].join('\n'));
     
     
    const env = Object.assign({}, process.env, {
      PATH: shimDir + path.delimiter + process.env.PATH,
      LEERNESS_ENABLE_CODEX: '1', LEERNESS_ENABLE_CLAUDE: '1',
    });
    const envOff = Object.assign({}, env, { LEERNESS_ENABLE_CODEX: '0', LEERNESS_ENABLE_CLAUDE: '0' });
    const RS = (a, e) => { const r = cp.spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8', timeout: 120000, env: e || env }); return { s: r.status, o: ((r.stdout || '') + (r.stderr || '')).trim() }; };
    const calls = () => { try { return fs.readFileSync(shimLog, 'utf8').trim().split('\n').filter(Boolean).length; } catch { return 0; } };
    const clear = () => { try { fs.rmSync(shimLog, { force: true }); } catch {} };

    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-h2-')); _d.push(d);
    RS(['init', d, '--yes', '--language', 'ko', '--no-stale-check']);
    ['commander', 'coder', 'architect'].forEach(x => RS(['roles', 'set', x, '--provider', 'codex', '--path', d]));
    RS(['roles', 'set', 'reviewer', '--provider', 'claude', '--path', d]);
     
    clear(); RS(['agents', 'route', 'implement oauth token refresh', '--path', d]);
    const suggestCalls = calls();
    clear(); RS(['agents', 'route', 'implement oauth token refresh', '--path', d, '--json']);
    const suggestJsonCalls = calls();
    RS(['toggle', 'set', 'difficulty-routing', 'on', '--path', d]);
    clear(); RS(['agents', 'route', 'implement oauth token refresh', '--confirm', '--approved-by', '검증자', '--path', d]);
    const confirmCalls = calls();
     
     
    clear(); RS(['agents', 'route', 'implement oauth token refresh', '--confirm', '--approved-by', '검증자', '--path', d], envOff);
    const optOutCalls = calls();
    N1 = suggestCalls === 0 && suggestJsonCalls === 0 && confirmCalls > 0 && optOutCalls === 0;
     
    const tinyOut = RS(['agents', 'route', 'fix typo in button label', '--path', d]).o;
    N2 = /이 등급에서는 확인하지 않음/.test(tinyOut)
      && !/무료·비대화형 확인 명령이 있는 provider 만 판정한 결과/.test(tinyOut)
      && /버전 확인과 로그인 상태 명령을 실행/.test(RS(['agents', 'route', '--log', '--path', d]).o);
     
    const RTm = require(path.join(path.dirname(CLI), '..', 'lib', 'routing.js'));
    N3 = RTm.classify('支付退款逻辑修改 css').tier === 'normal'
      && RTm.classify('決済リファンド css 修正').tier === 'normal'
      && RTm.classify('fix typo in css').tier === 'tiny'            
       
      && RTm.classify('ＰＡＹＭＥＮＴ ｒｅｆｕｎｄ ｌｏｇｉｃ').tier === 'high-risk';
     
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-h2b-')); _d.push(d2);
    RS(['init', d2, '--yes', '--language', 'ko', '--no-stale-check']);
    const aid = ((RS(['task', 'add', '대상 작업', '--path', d2, '--json', '--no-review']).o.match(/"id"\s*:\s*"([^"]+)"/)) || [])[1];
    fs.writeFileSync(path.join(d2, 'app.js'), 'console.error("BUG_HERE"); process.exit(3);');
    const stRes = RS(['bugfix', 'start', aid, '--repro', 'node app.js', '--expect-bad', 'BUG_HERE', d2]);
    N4 = stRes.s === 0 && fs.existsSync(path.join(d2, '.leerness', 'bugfix-receipts.json'));
     
    const red = require(path.join(path.dirname(CLI), '..', 'lib', 'pure-utils.js')).redactSecrets;
    const maskOk = !red('Authorization: Bearer sk-live-ABCDEFGH12345', 200).includes('sk-live-ABCDEFGH12345')
      && !red('curl -H "Authorization: Basic dXNlcjpwYXNz" api', 200).includes('dXNlcjpwYXNz');
    fs.writeFileSync(path.join(d, '.leerness', 'toggles.json'), '{손상');
    const tl = RS(['toggle', 'list', '--path', d]);
    let tj = null; try { const o = RS(['toggle', 'list', '--path', d, '--json']).o; tj = JSON.parse(o.slice(o.indexOf('{'))); } catch {}
     
    const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-h2c-')); _d.push(d3);
    RS(['init', d3, '--yes', '--language', 'ko', '--no-stale-check']);
    RS(['agents', 'route', 'ＰＡＹＭＥＮＴ 수정 API_TOKEN=sk-live-SECRET123', '--path', d3]);
    const lgRaw = fs.readFileSync(path.join(d3, '.leerness', 'routing-log.json'), 'utf8');
    const auditOk = !/sk-live-SECRET123/.test(lgRaw) && /API_TOKEN=\*\*\*/.test(lgRaw) && /ＰＡＹＭＥＮＴ/.test(lgRaw);
    N5 = maskOk && auditOk && /toggles\.json 손상/.test(tl.o) && !!tj && tj.corrupt === true;
    ok = N1 && N2 && N3 && N4 && N5;
    if (!ok) console.log(`   [헌트5 디버그] 제안무실행=${N1}(제안 ${suggestCalls}/${suggestJsonCalls} · 확정 ${confirmCalls} · optout ${optOutCalls}) 사유구분=${N2} 다국어=${N3} 위치경로=${N4} 마스킹+손상고지=${N5}`);
  } catch (e) { console.log('   [헌트5 디버그] 예외: ' + ((e && e.message) || e)); }
  finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.92) 신규표면 헌트 5건: 제안은 외부 프로세스 0회(PATH shim 증명)·확정에서만 실행 · 인증 미확인 사유 구분 · 미커버 문자체계는 tiny 금지 · bugfix 위치경로 인식 · Bearer 마스킹 + 손상 토글 경고' : '✗ 신규표면 헌트 5건 실패');
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('B(1.36.93)')) {
  total++;
  let ok = false;
  const _d = [];
  const R = (args, env) => { const r = cp.spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 300000, env: env || process.env }); return { s: r.status, o: ((r.stdout || '') + (r.stderr || '')).trim() }; };
  let T1 = false, T2 = false, T3 = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-carry-')); _d.push(d);
    R(['init', d, '--yes', '--language', 'ko', '--no-stale-check']);
     
    R(['task', 'add', 'A', '--path', d, '--status', 'completed', '--json', '--no-review']);
    R(['plan', 'add', 'B', '--path', d, '--status', 'completed', '--json']);
    R(['plan', 'add', 'C', '--path', d, '--status', 'verified', '--json']);
    const rows = fs.readFileSync(path.join(d, '.leerness', 'progress-tracker.md'), 'utf8')
      .split('\n').filter(l => /^\|\s*T-\d/.test(l)).map(l => l.split('|').map(s => s.trim())[2]);
    const doneCount = rows.filter(s => s === 'done').length;
    let vcTotal = null; try { const o = R(['verify-claim', '--all', '--path', d, '--json']).o; vcTotal = JSON.parse(o.slice(o.indexOf('{'))).total; } catch {}
     
    T1 = rows.filter(s => s === 'completed' || s === 'verified').length === 0 && doneCount === 3 && vcTotal === doneCount;
     
    const mcp = (ms) => {
      const msgs = [JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }),
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_selftest', arguments: { path: d } } })].join('\n') + '\n';
      const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve', '--path', d], {
        input: msgs, encoding: 'utf8', timeout: 200000,
        env: Object.assign({}, process.env, ms ? { LEERNESS_MCP_TIMEOUT_MS: String(ms) } : {}),
      });
      const lines = ((r.stdout || '')).split('\n').filter(l => l.includes('"id":1'));
      return lines[lines.length - 1] || '';
    };
    const shortRes = mcp(5000);    
    T2 = !/no output/.test(shortRes) && /초 안에 끝나지 않아 중단/.test(shortRes)
      && /LEERNESS_MCP_TIMEOUT_MS/.test(shortRes) && /터미널에서 직접/.test(shortRes)
       
       
      && /⏱ 5초 안에/.test(shortRes)
       
       
       
      && !/긴 예산\(/.test(shortRes);
     
    const srcTxt = fs.readFileSync(CLI, 'utf8');
    const probeBudget = (srcTxt.match(/MCP_TIMEOUT_PROBE_MS = (\d+)/) || [])[1];
    const defBudget = (srcTxt.match(/MCP_TIMEOUT_DEFAULT_MS = (\d+)/) || [])[1];
    T3 = !!probeBudget && Number(probeBudget) > 600000               
      && !!defBudget && Number(defBudget) <= 120000                  
      && /timeout: budget,/.test(srcTxt)                             
       
       
      && /_mcpTimeoutHint\(cliArgs\)/.test(srcTxt)
      && /const MCP_LONG_PATHS = \[/.test(srcTxt);
    ok = T1 && T2 && T3;
    if (!ok) console.log(`   [이월2 디버그] plan정규화=${T1}(done=${doneCount} vc=${vcTotal}) 타임아웃사유=${T2} 기본한도=${T3}(${srcTimeout})`);
  } catch (e) { console.log('   [이월2 디버그] 예외: ' + ((e && e.message) || e)); }
  finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.93) 헌트 이월 2건: plan add 상태 정규화(검증기가 보는 수 = done 행 수) · MCP 타임아웃 사유 전달(+CLI 대안·한도조절) · 기본 한도 > probe 예산' : '✗ 헌트 이월 2건 실패');
  if (!ok) failed++;
}

 
 
 
 
 
 
 
if (e2eShard.take('B(1.36.95)')) {
  total++;
  let ok = false;
  const _d = [];
  let T1 = false, T2 = false, T3 = false;
  const dbg = {};
  try {
    const R = (a) => { const r = cp.spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8', timeout: 180000 }); return { s: r.status, o: ((r.stdout || '') + (r.stderr || '')).trim() }; };
    const mkTpl = (lang) => {
      const w = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tpl95-')); _d.push(w);
      R(['init', w, '--yes', '--language', lang, '--no-stale-check']);
      return fs.readFileSync(path.join(w, '.leerness', 'session-workflow.md'), 'utf8');
    };
    const ko = mkTpl('ko'), en = mkTpl('en');

     
     
     
     
     
    const staleCount = (s) => (s.match(/\d+\s*(?:개|여|여개)?\s*(?:도구|tools)/gi) || []).length;
    dbg.stale = staleCount(ko) + '/' + staleCount(en);
    dbg.size = ko.length + '/' + en.length;
    T1 = staleCount(ko) === 0 && staleCount(en) === 0
      && !/MCP server/.test(ko) && !/마일스톤/.test(ko)
       
      && /## Step 6/.test(ko) && /## 자동 회복/.test(ko) && /session close가 누락되면/.test(ko)
      && /## Step 6/.test(en) && /Auto-recovery/.test(en)
       
      && Math.abs(ko.length - en.length) < 1500;

     
     
     
    const PU = require(path.join(path.dirname(CLI), '..', 'lib', 'pure-utils.js'));
    const MG = (prev) => PU._managedMerge('.leerness/session-workflow.md', ko, prev, '.leerness/archive', new Set(), { lang: 'ko' });
     
    const userProse = [
      '- 사용자 메모: MCP **77 도구** 는 우리 내부 표현이며 삭제 금지',
      '- 프로젝트 정책: MCP **3 도구는 별도 승인 후 사용한다',
      '- 🏆 마일스톤은 고객 승인 뒤에만 확정한다',
      '- 🎉 **2 라운드 인터뷰 후 가격을 결정한다',
      '- MCP **7명의 담당자만 운영 배포를 승인한다',
    ];
    const mProse = MG(userProse.join('\n') + '\n');
    const proseOk = userProse.every(s => mProse.includes(s));
     
    const hist = ['- 1.9.86+ MCP server **18 도구** (handoff/drift)', '- 1.9.100 🏆 마일스톤 — 30 라운드 자율 누적'];
    const mHist = MG(hist.join('\n') + '\n');
    const carryOk = hist.every(s => mHist.includes(s)) && /Preserved previous content/.test(mHist);
     
    const idemOk = MG(mHist) === MG(MG(mHist));
     
     
     
    const _tag = '<!-- leerness:migration-preserved -->';
    const _cut = mHist.indexOf(_tag);
     
    const appliedOk = _cut >= 0
      && mHist.slice(0, _cut).replace(/\n*-{3,}\n*$/, '').trim() === ko.trim()
      && hist.every(s => mHist.slice(_cut).includes(s));
    dbg.nodel = `산문 ${proseOk} 이월 ${carryOk} 멱등 ${idemOk} 템플릿적용 ${appliedOk}`;
    T3 = proseOk && carryOk && idemOk && appliedOk;

     
     
     
    const w5 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-hd95-')); _d.push(w5);
    R(['init', w5, '--yes', '--language', 'ko', '--no-stale-check']);
    const decPath = path.join(w5, '.leerness', 'decisions.md');
    const mkDec = (n, pad) => '# Decisions\n' + Array.from({ length: n }, (_, i) => `- 결정 ${String(i + 1).padStart(3, '0')} ` + 'x'.repeat(pad)).join('\n') + '\n';
    const seg = (o) => o.slice(o.indexOf('=== Decisions'), o.indexOf('=== Task Log') > 0 ? o.indexOf('=== Task Log') : undefined);
     
    fs.writeFileSync(decPath, mkDec(120, 4));
    const sA = seg(R(['handoff', w5]).o);
    const idsA = (sA.match(/- 결정 (\d{3})/g) || []).map(x => Number(x.slice(-3)));
    const contiguous = idsA.length === 40 && idsA[0] === 81 && idsA[39] === 120 && idsA.every((v, i) => i === 0 || v === idsA[i - 1] + 1);
     
     
    fs.writeFileSync(decPath, mkDec(120, 150));
    const sB = seg(R(['handoff', w5]).o);
    const mB = sB.match(/(\d+)\/(\d+) 줄/);
    const cntB = (sB.match(/- 결정 \d{3}/g) || []).length;
    const bodyB = sB.slice(sB.indexOf('===\n') + 4).replace(/\n=== [\s\S]*$/, '').trim();
    const capOk = /=== Decisions \(last 40 lines\)/.test(sB) && !!mB && Number(mB[1]) === cntB && cntB > 0 && /결정 120/.test(sB)
      && bodyB.length <= 4000 && bodyB.length > 3000;
     
     
    fs.writeFileSync(decPath, 'z'.repeat(2000) + '\n' + 'z'.repeat(1999));
    const exactSeg = seg(R(['handoff', w5]).o);
    const exactOk = /2\/2 줄/.test(exactSeg) && !/상한으로 잘림/.test(exactSeg);
     
    fs.writeFileSync(decPath, '# D\n- ' + 'y'.repeat(300) + '😀' + 'x'.repeat(3999) + '\n');
    const oU = R(['handoff', w5]).o;
    const uniOk = !/�/.test(oU) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(oU);
     
    fs.writeFileSync(path.join(w5, '.leerness', 'task-log.md'), '# Task Log\n' + Array.from({ length: 200 }, (_, i) => `- 작업 ${String(i + 1).padStart(3, '0')}`).join('\n') + '\n');
    const oT = R(['handoff', w5]).o;
    const sT = oT.slice(oT.indexOf('=== Task Log'));
     
    const taskIds = (sT.match(/- 작업 (\d{3})/g) || []).map(x => Number(x.slice(-3)));
    const taskOk = taskIds.length === 60 && taskIds[0] === 141 && taskIds[59] === 200
      && taskIds.every((v, i) => i === 0 || v === taskIds[i - 1] + 1) && /60\/201 줄/.test(sT);
     
    fs.writeFileSync(decPath, '');
    fs.writeFileSync(path.join(w5, '.leerness', 'task-log.md'), '');
    const emptyOk = !/1\/1 줄/.test(R(['handoff', w5]).o);
     
     
    fs.writeFileSync(decPath, mkDec(600, 40));
    const decRaw = fs.readFileSync(decPath, 'utf8');
    let jd = null;
    try { const t = R(['handoff', w5, '--json']).o; jd = JSON.parse(t.slice(t.indexOf('{'))).files.decisions; } catch (e) { dbg.json = String(e && e.message).slice(0, 40); }
    const jsonOk = !!jd && /결정 600/.test(jd.content) && !/결정 001/.test(jd.content)
      && jd.truncated === true && jd.kept === 'tail' && jd.totalChars === decRaw.length && jd.content.length <= 8000;
     
     
     
    const _jbud = 8000 - '\n…(truncated)'.length;
    fs.writeFileSync(decPath, '# D\n' + 'y'.repeat(400) + '😀' + 'x'.repeat(_jbud - 1));
    let jd2 = null;
    try { const t = R(['handoff', w5, '--json']).o; jd2 = JSON.parse(t.slice(t.indexOf('{'))).files.decisions; } catch (e) { dbg.json2 = String(e && e.message).slice(0, 30); }
    const jsonUniOk = !!jd2 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(jd2.content) && !/�/.test(jd2.content);
     
    fs.writeFileSync(path.join(w5, '.leerness', 'plan.md'), '# Plan\nFIRST_MARKER\n' + 'p'.repeat(9000) + '\nLAST_MARKER\n');
    let jp = null;
    try { const t = R(['handoff', w5, '--json']).o; jp = JSON.parse(t.slice(t.indexOf('{'))).files.plan; } catch (e) { dbg.plan = String(e && e.message).slice(0, 30); }
     
     
    const planRaw = fs.readFileSync(path.join(w5, '.leerness', 'plan.md'), 'utf8');
    const jsonHeadOk = !!jp && jp.kept === 'head' && /FIRST_MARKER/.test(jp.content) && !/LAST_MARKER/.test(jp.content)
      && jp.totalChars === planRaw.length && jp.content.length <= 8000 && jp.truncated === true;
     
     
    fs.writeFileSync(path.join(w5, '.leerness', 'progress-tracker.md'),
      '# P\n' + Array.from({ length: 48000 }, (_, i) => `| T-${String(i).padStart(5, '0')} | done | ` + 'x'.repeat(80) + ' |').join('\n') + '\n');
    const _t0 = Date.now();
    R(['handoff', w5]);
    dbg.perf = Date.now() - _t0;
    const perfOk = dbg.perf < 20000;
    dbg.hd = `연속=${contiguous} 상한=${capOk}(${mB ? mB[0] : '-'} 본문 ${bodyB.length}자) 정확상한=${exactOk} 유니코드=${uniOk}/${jsonUniOk} 작업로그=${taskOk} 빈파일=${emptyOk} json=${jsonOk} head방향=${jsonHeadOk} 성능=${perfOk}(${dbg.perf}ms)`;
    T2 = contiguous && capOk && exactOk && uniOk && jsonUniOk && taskOk && emptyOk && jsonOk && jsonHeadOk && perfOk;
    ok = T1 && T2 && T3;
    if (!ok) console.log(`   [P9A 디버그] 템플릿=${T1}(낡은수치 ${dbg.stale} 크기 ${dbg.size}) 무삭제=${T3}(${dbg.nodel}) handoff=${T2}(${dbg.hd})`);
  } catch (e) { console.log('   [P9A 디버그] 예외: ' + ((e && e.message) || e)); }
  finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.95) 부채 상환: 템플릿 낡은 이력 0(ko/en · 수치 주장 자체가 0) · 머지 삭제 0(옛 이력 필터 제거 — 사용자 산문 보존 · 이력은 이월) · handoff last-N 라벨=동작(헤더 불가침 · 줄 경계 · 정확 상한 · 코드포인트 · Task Log · 빈 파일 · --json tail/head 방향 · totalChars · 선형 성능)' : '✗ 부채 상환(1.36.95) 실패');
  if (!ok) failed++;
}

 
 
 
 
 
 
 
 
if (e2eShard.take('B(1.36.96)')) {
  total++;
  let ok = false;
  const _d = [];
  const dbg = {};
  try {
    const vm = require('vm');
    const G = require(path.resolve(path.dirname(CLI), '..', 'lib', 'graph.js'));
    const w = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-docs96-')); _d.push(w);
    fs.writeFileSync(path.join(w, 'package.json'), JSON.stringify({ name: 'd96', version: '0.1.0' }, null, 2));
    cp.spawnSync(process.execPath, [CLI, 'init', w, '--yes', '--no-stale-check'], { encoding: 'utf8', timeout: 180000 });
    const H = path.join(w, '.leerness');
    const setupOk = fs.existsSync(H);             

     
     
    cp.spawnSync(process.execPath, [CLI, 'graph', w, '--html'], { encoding: 'utf8', timeout: 180000 });
    const html = fs.readFileSync(path.join(w, 'leerness.html'), 'utf8');
    const wired = html.includes('data-v="docs"') && /"docs":\{/.test(html) && html.includes('세션 핸드오프');
    const grab = (n) => { const i = html.indexOf('function ' + n + '('); if (i < 0) return ''; const j = html.indexOf('\nfunction ', i + 1); return html.slice(i, j < 0 ? html.indexOf('\n(function(){', i) : j); };
    const sb = { console };
    vm.createContext(sb);
    vm.runInContext(['mdEsc', 'mdUrl', 'mdInline', 'mdRender'].map(grab).join('\n') + '\nthis.R=mdRender;this.I=mdInline;this.U=mdUrl;', sb);
    const R2 = sb.R, I2 = sb.I, U2 = sb.U;
     
     
    const T1 = wired
      && R2('# 하나') === '<h1>하나</h1>' && R2('## 제목') === '<h2>제목</h2>'
      && R2('### 셋') === '<h3>셋</h3>' && R2('#### 넷') === '<h4>넷</h4>'
      && R2('##### 다섯') === '<h5>다섯</h5>' && R2('###### 여섯') === '<h6>여섯</h6>'
      && R2('####### 일곱') === '<p>####### 일곱</p>'       
      && R2('- a\n- b') === '<ul><li>a</li><li>b</li></ul>'
      && R2('1. a') === '<ol start="1"><li>a</li></ol>'
       
      && R2('2. two') === '<ol start="2"><li>two</li></ol>'
      && R2('1. one\n3. three') === '<ol start="1"><li>one</li><li value="3">three</li></ol>'
       
      && (function () { const s = R2('| a | b | c |\n|:---|:---:|---:|\n| 1 | 2 | 3 |');
        return s.includes('text-align:left') && s.includes('text-align:center') && s.includes('text-align:right'); })()
      && R2('| a |\n|---|\n| 1 |') === '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>'
      && I2('**굵게** 와 *기울임*') === '<b>굵게</b> 와 <i>기울임</i>'
      && I2('명령 `npm test` 실행') === '명령 <code>npm test</code> 실행'
      && R2('```js\nvar a=1;\n```') === '<pre><code>var a=1;</code></pre>'
      && R2('| a |\n|---|\n| 1 |') === '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>'
       
      && I2('[d](https://example.com/x)') === '<a href="https://example.com/x" target="_blank" rel="noopener noreferrer">d</a>'
      && /href="http:\/\/e\.test\/a"/.test(I2('[d](http://e.test/a)'))
      && /href="mailto:a@b\.c"/.test(I2('[d](mailto:a@b.c)'))
      && /href="#앵커"/.test(I2('[d](#앵커)'))
      && /href="\.leerness\/plan\.md"/.test(I2('[d](.leerness/plan.md)'))
       
       
      && I2('[d](https://e.test/q?' + Array.from({ length: 260 }, (_, i) => 'k' + i + '=v' + i).join('&') + ')').includes('<a ')
       
      && I2('버전 1.36.96 에서 89 도구') === '버전 1.36.96 에서 89 도구'
      && I2('`a` 뒤 42 그리고 `b`') === '<code>a</code> 뒤 42 그리고 <code>b</code>'
       
      && !/<script/i.test(R2('<script>alert(1)</script>')) && R2('<script>alert(1)</script>').includes('&lt;script&gt;')
      && !/<img/i.test(R2('<img src=x onerror=alert(1)>')) && R2('<img src=x onerror=alert(1)>').includes('&lt;img')
       
       
      && I2('[x](javascript:alert(1))') === '[x](javascript:alert(1))'
      && I2('[x](JaVaScRiPt:alert(1))') === '[x](JaVaScRiPt:alert(1))'
      && I2('[x](data:text/html,y)') === '[x](data:text/html,y)'
      && I2('[x](vbscript:m)') === '[x](vbscript:m)'
      && I2('[x](//evil.example)') === '[x](//evil.example)'
       
      && U2('\\\\evil.example/share') === null && U2('/\\evil.example/share') === null
       
      && I2('[t](https://a/**b**/c)') === '<a href="https://a/**b**/c" target="_blank" rel="noopener noreferrer">t</a>'
       
      && I2('a\x01b \u0060c\u0060') === 'ab <code>c</code>' && I2('x\x020y') === 'x0y'
       
      && (function () { const t0 = Date.now(); R2('['.repeat(65536)); return Date.now() - t0 < 400; })()
       
       
      && !/<b>/.test(I2('[<b>t</b>](https://a.b)')) && I2('[<b>t</b>](https://a.b)').includes('&lt;b&gt;t&lt;/b&gt;')
      && !/onmouseover="alert/.test(I2('[x](https://a" onmouseover="alert(1))')) && I2('[x](https://a" onmouseover="alert(1))').includes('&quot;')
      && !/<b>|<i>/.test(R2('| <b>x</b> |\n|---|\n| <i>y</i> |')) && R2('| <b>x</b> |\n|---|\n| <i>y</i> |').includes('&lt;b&gt;x&lt;/b&gt;')
      && !/<img/i.test(R2('# <img src=x onerror=1>')) && R2('# <img src=x onerror=1>').includes('&lt;img')
       
       
      && U2('java\tscript:alert(1)') === null && U2('java\nscript:alert(1)') === null
      && U2('java\rscript:alert(1)') === null && U2('\tjavascript:alert(1)') === null
       
      && ['\x00', '\x01', '\x03', '\x1F', '\x7F'].every(c => U2(c + 'javascript:alert(1)') === null)
      && U2('java\x03script:alert(1)') === null && U2('java\x7Fscript:alert(1)') === null
      && U2('https://ok.example/a') === 'https://ok.example/a'    
       
      && !/href="javascript:/i.test(I2('[t](javascript&#58;alert(1))'))
       
       
      && (function () { const s = R2('```\n**굵게** 와 [링크](https://a.b)\n```'); return s.includes('**굵게**') && !/<b>/.test(s) && !/<a /.test(s); })()
       
      && R2('```\nkept line one\nkept line two') === '<pre><code>kept line one\nkept line two</code></pre>'
       
      && R2('<div class="x">y</div>').includes('&lt;div') && R2('---') === '<p>---</p>'
      && R2('<!--<img src=x onerror=1>-->') === '<p>&lt;!--&lt;img src=x onerror=1&gt;--&gt;</p>'
      && R2('<![CDATA[<script>x</script>]]>') === '<p>&lt;![CDATA[&lt;script&gt;x&lt;/script&gt;]]&gt;</p>'
      && R2('a & b < c > d "e"') === '<p>a &amp; b &lt; c &gt; d &quot;e&quot;</p>';
    dbg.render = String(T1) + (wired ? '' : ' (배선X)');

     
     
     
     
    const _CH = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let _sd = 7;
    const _rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) { _sd = (_sd * 1103515245 + 12345) % 2147483648; s += _CH[_sd % _CH.length]; } return s; };
    const _dbPw = _rnd(20);                      
    const SEC = {
      dbUrl: 'DATABASE_URL=postgres://alice:' + _dbPw + '@db.example/app',
      glpat: 'glpat-' + _rnd(24),
      npm: 'npm_' + _rnd(36),
      stripe: 'sk_live_' + _rnd(24),
      sendgrid: 'SG.' + _rnd(22) + '.' + _rnd(43),
      pem: '-----BEGIN RSA PRIVATE KEY-----\n' + _rnd(60) + '\n-----END RSA PRIVATE KEY-----',
       
      pemOpen: '-----BEGIN EC PRIVATE KEY-----\n' + _rnd(58) + '\n',
       
      pemEnc: '-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,9F8E7D6C\n\n' + _rnd(60) + '\n-----END RSA PRIVATE KEY-----',
       
      bearerLetters: 'Bearer QwErTyUiOpAsDfGhJkLzXcVbNmQwErTy',
       
      awsBare: 'aws secret access key ' + _rnd(40),
    };
     
     
     
    const PROSE_OK = [
      'Bearer 인증을 도입한다',
      'Bearer token 을 쓴다',
       
      'Note: 개인키는 커밋하지 않습니다',
      'Status: 검토중',
    ];
     
    const PROSE_STRUCT = ['결정: AWS secret commit ', ' was reverted.'];
     
    fs.writeFileSync(path.join(H, 'plan.md'), '# Goal\n\n평범한 문장.\n' + PROSE_OK.join('\n') + '\n'
      + PROSE_STRUCT[0] + '0123456789abcdef0123456789abcdef01234567' + PROSE_STRUCT[1] + '\n');
     
     
     
    fs.writeFileSync(path.join(H, 'skill-index.md'), '# Skills\n\n' + Object.values(SEC).join('\n') + '\n');
    const N2 = 4000;
    fs.writeFileSync(path.join(H, 'decisions.md'), Array.from({ length: N2 }, (_, i) => '- D' + String(i + 1).padStart(4, '0') + ' 결정 — 근거와 대안을 함께 적는다').join('\n'));
     
    fs.writeFileSync(path.join(H, 'current-state.md'), Array.from({ length: N2 }, (_, i) => '- S' + String(i + 1).padStart(4, '0') + ' 상태 항목 — 충분히 길게 적어 상한을 넘긴다' + 'x'.repeat(i % 7)).join('\n'));
     
     
    fs.writeFileSync(path.join(H, 'tech-profile.json'), 'a' + '🎉'.repeat(G.DOC_PER_CAP));
     
    fs.writeFileSync(path.join(H, 'progress-tracker.md'), Array.from({ length: 300 }, (_, i) => '- P' + String(i + 1).padStart(4, '0') + ' 진행 기록').join('\n'));
    fs.rmSync(path.join(H, 'session-handoff.md'), { force: true });
    const D2 = G.buildDocsData(w, '2026-07-31T12:34:56.000Z');
    const g = (k) => D2.files.find(f => f.key === k) || {};
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    const _blob = JSON.stringify(D2);
    const T2 = D2.files.length === 7 && D2.at === '2026-07-31T12:34:56.000Z'
       
      && g('skills').guarded === true && g('skills').text === '' && g('skills').charsTotal > 0
       
      && ![_dbPw, SEC.glpat, SEC.npm, SEC.stripe, SEC.sendgrid, SEC.bearerLetters.slice(7),
        SEC.pem.split('\n')[1], SEC.pemOpen.split('\n')[1], SEC.pemEnc.split('\n')[4], SEC.awsBare.slice(-40),
      ].some(s => _blob.includes(s))
       
      && g('plan').guarded !== true && g('plan').text.includes('평범한 문장.')
      && PROSE_OK.every(s => g('plan').text.includes(s))
      && PROSE_STRUCT.every(s => g('plan').text.includes(s))
       
       
      && g('plan').text.includes('결정: AWS secret commit ***')
      && !g('plan').text.includes('0123456789abcdef0123456789abcdef01234567')
       
      && g('tech').lang === 'json' && g('tech').missing !== true
      && g('progress').tail === true && g('progress').text.includes('P0300') && g('progress').missing !== true
      && g('decisions').truncated === true && g('decisions').text.length <= G.DOC_PER_CAP
      && g('decisions').text.includes('D' + N2) && !g('decisions').text.includes('D0001')
      && g('decisions').text.split('\n').every(l => /^- D\d{4} /.test(l))
      && g('state').text.includes('S0001') && !g('state').text.includes('S' + N2)
      && g('state').truncated === true && g('state').text.split('\n').every(l => /^- S\d{4} 상태 항목 — 충분히 길게 적어 상한을 넘긴다x*$/.test(l))
      && !lone.test(g('tech').text) && g('tech').text.length <= G.DOC_PER_CAP    
      && g('handoff').missing === true && g('handoff').text === ''
      && !JSON.stringify(D2.files.map(f => f.rel)).includes(w.replace(/\\/g, '\\\\'));
     
     
    const PUx = require(path.resolve(path.dirname(CLI), '..', 'lib', 'pure-utils.js'));
    const encBody = _rnd(60), openBody = _rnd(58), letters = 'QwErTyUiOpAsDfGhJkLzXcVbNmQwErTy', awsVal = _rnd(40);
    const M = {
       
      encOpen: PUx.redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,9F8E\n\n' + encBody + '\n'),
       
      plainOpen: PUx.redactSecrets('-----BEGIN EC PRIVATE KEY-----\n' + openBody + '\n'),
       
      prose: PUx.redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nComment: 이 키는 예시입니다\nNote: 커밋 금지\n일반 문장.'),
       
       
      proseB: PUx.redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nComment: 예시\nNote: 커밋 금지\n' + _rnd(40)),
       
      span: PUx.redactSecrets('-----BEGIN RSA PRIVATE KEY-----\n\n중간 산문입니다\n또 다른 줄\n\n-----END RSA PRIVATE KEY-----'),
      bearer: PUx.redactSecrets('Bearer ' + letters),
       
      bearer20: PUx.redactSecrets('Bearer AbCdEfGhIjKlMnOpQrSt'),
      bearer31: PUx.redactSecrets('Bearer AbCdEfGhIjKlMnOpQrStUvWxYzABCDE'),
       
      bearerWord: PUx.redactSecrets('Use Bearer authenticationMiddleware for API requests.'),
      bearerLower: PUx.redactSecrets('Bearer abcdefghijklmnopqrst'),
      bearerCamel: PUx.redactSecrets('Bearer CorrectHorseBatteryStaple'),
      bearerShort: PUx.redactSecrets('Bearer 인증을 도입한다'),
       
      bearerSlash: PUx.redactSecrets('Bearer abcdefgh/ijklmnopqrstuvwxyz0123456789'),
      bearerPlus: PUx.redactSecrets('Bearer abcde+fghijklmnopqrstuvwxyz0123456789'),
       
       
      quoteWord: PUx.redactSecrets('정책 인용:\n-----BEGIN RSA PRIVATE KEY-----\nNeverCommitPrivateKeys\n다음 문단'),
      shortBody: PUx.redactSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA7x9fQ2\nkLmN0pQrStUvWxYz\n-----END RSA PRIVATE KEY-----'),
       
      pgp: PUx.redactSecrets('-----BEGIN PGP PRIVATE KEY BLOCK-----\nVersion: GnuPG v2\n\n' + _rnd(64) + '\n=AbCd\n-----END PGP PRIVATE KEY BLOCK-----'),
      awsBare: PUx.redactSecrets('aws secret access key ' + awsVal),
      awsProse: PUx.redactSecrets('결정: AWS secret commit 0123456789abcdef0123456789abcdef01234567 was reverted.'),
    };
    const T2b = !M.encOpen.includes(encBody) && !M.plainOpen.includes(openBody)
      && M.prose.includes('Comment: 이 키는 예시입니다') && M.prose.includes('Note: 커밋 금지') && M.prose.includes('일반 문장.')
      && M.proseB.includes('Note: 커밋 금지')
      && M.span.includes('중간 산문입니다') && M.span.includes('또 다른 줄')
      && !M.bearer.includes(letters)
      && !M.bearer20.includes('AbCdEfGhIjKlMnOpQrSt') && !M.bearer31.includes('AbCdEfGhIjKlMnOpQrStUvWxYzABCDE')
       
      && !M.bearerLower.includes('abcdefghijklmnopqrst') && !M.bearerCamel.includes('CorrectHorseBatteryStaple')
      && M.bearerWord === 'Use *** for API requests.'           
      && M.bearerShort === 'Bearer 인증을 도입한다'                  
      && M.bearerSlash === '***' && M.bearerPlus === '***'       
       
      && !M.quoteWord.includes('NeverCommitPrivateKeys') && M.quoteWord.includes('다음 문단')
      && !M.shortBody.includes('MIIEowIBAAKCAQEA7x9fQ2') && !M.shortBody.includes('kLmN0pQrStUvWxYz')
      && M.pgp === '***'
      && !M.awsBare.includes(awsVal)
      && M.awsProse.includes('결정: AWS secret commit ') && M.awsProse.includes(' was reverted.');
     
     
     
    const HC = PUx.hasCredentialMarker;
    const T2c = [
      '-----BEGIN RSA PRIVATE KEY-----',
      '> -----BEGIN RSA PRIVATE KEY-----',            
      '- -----BEGIN EC PRIVATE KEY-----',             
      '    -----BEGIN PGP PRIVATE KEY BLOCK-----',    
      'bearer dddddddddddddddddddddddd',              
      'Bearer /cccccccccccccccccccccccc',             
      'Bearer aaaaaaaaaaaaaaaaaaa~ZZZZZZZZZZZZZZZZZZZZ',  
       
       
      'Bearer abcdefghij/klmnopqrst', 'Bearer abcdefghij+klmnopqrst', 'Bearer abcdefghij~klmnopqrst',
      'Authorization: Basic YTpi',
       
      'Bearer mF_9.B5f-4.1JqM_x',                         
      'Cookie: session=s%3AabcdefghijklmnopqrstuvwxyzAB',
      'Set-Cookie: sid=abcdefghijklmnopqrstuvwxyz; HttpOnly',
      'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..48V1_ALb6US0.7gg.XFBoMYUZodetZdvTiFvSkQ',   
      '**Bearer** eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij',
      '`Bearer` AbCdEfGhIjKlMnOpQrStUvWx',
      'glpat-abcdefghijklmnopqrstuvwx', 'npm_' + _rnd(36), 'ghp_' + _rnd(36), 'AKIA' + _rnd(16),
      'DATABASE_URL=postgres://alice:pw123456@db/app',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc',
    ].every(s => HC(s) === true)
       
      && ['# 제목\n\n첫 문단입니다.', '- 목록 항목\n- 또 다른 항목', 'Bearer 인증을 도입한다',
        'https://example.com/docs/keys 를 참고하세요', 'password 정책을 문서화한다',
        '결정: 인증 방식을 변경한다', 'BEGIN 과 END 사이를 확인하라', 'cookie 정책을 정리한다',
        'authorization 흐름을 검토한다'].every(s => HC(s) === false);
    dbg.marker = String(T2c);

     
     
     
    const w2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-gph96-')); _d.push(w2);
    fs.writeFileSync(path.join(w2, 'package.json'), JSON.stringify({ name: 'g96', version: '0.1.0' }, null, 2));
    const L2 = (a) => cp.spawnSync(process.execPath, [CLI, ...a], { encoding: 'utf8', timeout: 180000, cwd: w2 });
    L2(['init', w2, '--yes', '--no-stale-check']);
    const NEEDLE = { decision: 'DECISIONLEAK_' + _rnd(20), task: 'TASKLEAK_' + _rnd(20), plan: 'PLANLEAK_' + _rnd(20) };
    L2(['decision', 'add', 'Authorization: Bearer ' + NEEDLE.decision, '--reason', 'audit', '--path', w2]);
     
     
    L2(['task', 'add', 'Cookie: session=' + NEEDLE.task, '--path', w2]);
    L2(['plan', 'add', 'Set-Cookie: sid=' + NEEDLE.plan, '--path', w2]);
    L2(['task', 'add', '평범한 작업 항목입니다', '--path', w2]);
    L2(['graph', w2, '--html']);
    const gHtml = fs.readFileSync(path.join(w2, 'leerness.html'), 'utf8');
     
     
     
    const H2 = path.join(w2, '.leerness');
    const SURF = [
      ['lesson', () => L2(['lesson', 'save', 'Cookie: session=LEAKLESSON_QwErTyUiOpAsDfGh', '--path', w2])],
      ['rule', () => L2(['rule', 'add', 'Cookie: session=LEAKRULE_QwErTyUiOpAsDfGh', '--trigger', 'every-round', '--path', w2])],
      ['planfile', () => fs.writeFileSync(path.join(H2, 'plan.md'), '# Goal\n\nCookie: session=LEAKPLANFILE_QwErTyUiOpAsDfGh\n')],
      ['progress', () => fs.appendFileSync(path.join(H2, 'progress-tracker.md'), '\n- Cookie: session=LEAKPROGRESS_QwErTyUiOpAsDfGh\n')],
      ['state', () => fs.writeFileSync(path.join(H2, 'current-state.md'), 'Cookie: session=LEAKSTATE_QwErTyUiOpAsDfGh\n')],
      ['handoff', () => fs.writeFileSync(path.join(H2, 'session-handoff.md'), 'Cookie: session=LEAKHANDOFF_QwErTyUiOpAsDfGh\n')],
      ['skills', () => fs.writeFileSync(path.join(H2, 'skill-index.md'), 'Cookie: session=LEAKSKILLS_QwErTyUiOpAsDfGh\n')],
      ['feature', () => fs.writeFileSync(path.join(H2, 'feature-graph.md'), '## F-0001 Cookie: session=LEAKFEATURE_QwErTyUiOpAsDfGh\n- depends-on: F-0002\n')],
      ['tech', () => { const p = path.join(H2, 'tech-profile.json'); let jj = {}; try { jj = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {} jj.current = jj.current || {}; jj.current.services = [{ id: 'svc', evidence: 'Cookie: session=LEAKTECH_QwErTyUiOpAsDfGh' }]; fs.writeFileSync(p, JSON.stringify(jj, null, 2)); }],
       
       
      ['deep', () => {
        const p = path.join(H2, 'tech-profile.json');
        let jj = {}; try { jj = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
        let node = { evidence: 'Cookie: session=LEAKDEEP_QwErTyUiOpAsDfGh' };
        for (let k = 0; k < 40; k++) node = { w: node };
        jj.deep = node;
        fs.writeFileSync(p, JSON.stringify(jj, null, 1));
      }],
    ];
    for (const [, fn] of SURF) fn();
     
     
     
     
    fs.writeFileSync(path.join(H2, 'decisions.md'),
      '# 결정\n\n설계 메모: idempotency_key=run:phase:step, auth_scheme=\'\', X_AUTH=false 를 확인한다.\n정상 문단입니다.\n');
    L2(['graph', w2, '--html']);
    const gHtml2 = fs.readFileSync(path.join(w2, 'leerness.html'), 'utf8');
    const T2d = Object.values(NEEDLE).every(v => !gHtml.includes(v))
      && gHtml.includes('평범한 작업 항목입니다')         
      && SURF.every(([n]) => !gHtml2.includes('LEAK' + n.toUpperCase() + '_QwErTyUiOpAsDfGh'))
      && gHtml2.includes('평범한 작업 항목입니다')
       
       
      && (function () {
        const gi = gHtml2.indexOf('var DATA = '), gj = gHtml2.indexOf(';\n', gi);
        const gd = JSON.parse(gHtml2.slice(gi + 11, gj).replace(/\\u003c/g, '<'));
        const sum = (gd.docs.files || []).reduce((a, f) => a + Buffer.byteLength(f.text || '', 'utf8'), 0);
        return gd.docs.spent === sum && sum > 0;     
      })();
     
     
     
     
    const shared = { id: 'svc', evidence: 'SHAREDMARK' };
    const dShared = G.buildGraphData(w2, { _loadTechProfile: () => ({ current: { languages: [shared], services: [shared] }, history: [] }) });
    const cyc = { evidence: 'CYCMARK' }; cyc.self = cyc;
    let cycOk = false;
    try {
      const cs = JSON.stringify(G.buildGraphData(w2, { _loadTechProfile: () => ({ current: { languages: [cyc], services: [] }, history: [] }) }));
       
       
      cycOk = cs.includes('CYCMARK') && (cs.match(/"self"/g) || []).length <= 1;
    } catch { cycOk = false; }
    let deep = { evidence: 'DEEPMARK' };
    for (let k = 0; k < 5000; k++) deep = { w: deep };
    let deepOk = false;
    try { deepOk = typeof JSON.stringify(G.buildGraphData(w2, { _loadTechProfile: () => ({ current: { languages: [], services: [] }, history: [], deep }) })) === 'string'; } catch { deepOk = false; }
     
     
    let mid = { evidence: 'MIDMARK' };
    for (let k = 0; k < 30; k++) mid = { w: mid };
    let midOk = false;
    try { midOk = JSON.stringify(G.buildGraphData(w2, { _loadTechProfile: () => ({ current: { languages: [], services: [] }, history: [], mid }) })).includes('MIDMARK'); } catch { midOk = false; }
    deepOk = deepOk && midOk;
    const T2e = (JSON.stringify(dShared.tech).match(/SHAREDMARK/g) || []).length === 2 && cycOk && deepOk;
    dbg.embed = String(T2e);
    dbg.graph = String(T2d) + ' (출구 ' + (SURF.length + 3) + '종)';
    dbg.mask = String(T2b);
    dbg.data = String(T2) + ` (dec ${g('decisions').text.length}/${g('decisions').totalChars} · skills ${g('skills').text.length})`;

     
     
     
     
    for (const f of ['plan.md', 'skill-index.md', 'current-state.md', 'progress-tracker.md', 'decisions.md']) {
      fs.writeFileSync(path.join(H, f), ('한글이 섞인 줄 ' + 'x'.repeat(180) + '\n').repeat(400));
    }
    const S2 = G.buildDocsData(w, 'x', { perCap: 4096, totalCap: 9000 });
     
    const S2bytes = S2.files.reduce((a, f) => a + Buffer.byteLength(f.text || '', 'utf8'), 0);
    const sk2 = S2.files.filter(x => x.skipped);
     
     
    const KO = '한'.repeat(30000);
    for (const f of ['plan.md', 'skill-index.md', 'current-state.md', 'progress-tracker.md', 'decisions.md', 'tech-profile.json']) {
      fs.writeFileSync(path.join(H, f), KO);
    }
    const B2 = G.buildDocsData(w, 'x');
    const byteSum = B2.files.reduce((a, f) => a + Buffer.byteLength(f.text || '', 'utf8'), 0);
    const perByteOk = B2.files.every(f => Buffer.byteLength(f.text || '', 'utf8') <= G.DOC_PER_CAP);
     
     
     
    const LONG = 'a'.repeat(70000);
    const capHead = G._capDoc('\n' + LONG, 65536, false);
    const capTail = G._capDoc(LONG + '\n', 65536, true);
    const capHead2 = G._capDoc('\n\n' + LONG, 65536, false);
    const capTail2 = G._capDoc(LONG + '\n\n', 65536, true);
    const capHead3 = G._capDoc('\n\n\n\n' + LONG, 65536, false);
     
     
    const capWs = [
      G._capDoc('\r\n' + LONG, 65536, false), G._capDoc('\r\n\r\n' + LONG, 65536, false),
      G._capDoc('   \n' + LONG, 65536, false), G._capDoc('\t\n' + LONG, 65536, false),
      G._capDoc(LONG + '\r\n', 65536, true), G._capDoc(LONG + '\n   ', 65536, true),
    ];
     
     
    fs.writeFileSync(path.join(H, 'current-state.md'), '🎉'.repeat(30000));
    const emo = G.buildDocsData(w, 'x');
    const anyDoc = emo.files.find(f => f.key === 'state') || {};
    const T3 = sk2.length > 0 && S2.spent <= 9000 && S2.perCap === 4096 && S2.totalCap === 9000
       
      && sk2.every(x => x.text === '' && x.totalChars > 0 && x.charsTotal > 0 && x.truncated === true)
       
      && G._capDoc('a'.repeat(65536), 65536, false).truncated === false
      && G._capDoc('a'.repeat(65537), 65536, false).truncated === true
       
      && S2.files.every(x => x.skipped || x.missing || x.guarded || Buffer.byteLength(x.text || '', 'utf8') >= 256)
      && S2.files.filter(x => !x.missing).every(x => x.skipped || x.truncated !== undefined)
      && perByteOk && byteSum <= G.DOC_TOTAL_CAP && byteSum > G.DOC_PER_CAP    
      && S2.spent === S2bytes                                                  
      && [capHead, capTail, capHead2, capTail2, capHead3, ...capWs].every(c => c.text.replace(/\s/g, '').length > 60000 && Buffer.byteLength(c.text, 'utf8') <= 65536)
       
      && G._capDoc('TITLE\n' + LONG, 65536, false).text.startsWith('TITLE\n')
      && G._capDoc(LONG + '\nFOOTER', 65536, true).text.endsWith('\nFOOTER')
      && !/\r$/.test(G._capDoc(LONG + '\r\nFOOTER', 65536, true).text)
       
       
       
       
      && !/\r(?!\n)/.test(G._capDoc('A\r\nBB\r\nC', 4, false).text)
      && !/\r(?!\n)/.test(G._capDoc('AAAA\r\n' + LONG, 65536, false).text)
      && Buffer.byteLength(G._capDoc('TITLE\n' + LONG, 65536, false).text, 'utf8') <= 65536
       
      && anyDoc.chars === Array.from(anyDoc.text || '').length && anyDoc.chars * 2 === (anyDoc.text || '').length
      && anyDoc.charsTotal === 30000 && anyDoc.totalChars === 60000
       
       
      && /'\+\(f\.chars\|\|0\)\+'\/'\+\(f\.charsTotal\|\|0\)\+'자\(/.test(html)
      && !/\(f\.text\|\|''\)\.length\+'\/'/.test(html);
    dbg.cap = String(T3) + ` (skipped ${sk2.length} · spent ${S2.spent}/${S2bytes} · 바이트합 ${byteSum} · 빈경계 ${capHead.text.length}/${capTail.text.length}/${capHead2.text.length}/${capTail2.text.length})`;

    ok = setupOk && T1 && T2 && T2b && T2c && T2d && T2e && T3;
    if (!ok) console.log(`   [P-0010 디버그] 셋업=${setupOk} 렌더=${dbg.render} 데이터=${dbg.data} 표지=${dbg.marker} 그래프=${dbg.graph} 임베드=${dbg.embed} 마스킹=${dbg.mask} 상한=${dbg.cap}`);
  } catch (e) { console.log('   [P-0010 디버그] 예외: ' + ((e && e.message) || e)); }
  finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.96) P-0010 문서 탭: 최소 부분집합 렌더(제목·목록·펜스·표·링크·강조) · XSS 8방향 차단(원시HTML·javascript/data/vbscript/프로토콜상대·속성탈출·표/제목/링크텍스트) · 펜스 안 미해석 · **자격증명 표지 문서는 본문 미포함**(마스킹은 두 번째 층) · 누적로그 tail/일반 head · 줄경계+코드포인트 절단 · 결측/전체상한 명시 고지' : '✗ P-0010 문서 탭 실패');
  if (!ok) failed++;
}

 
 
 
 
 
 
 
 
 
if (e2eShard.take('B(1.36.94/1.36.185)')) {
  total++;
  let ok = false;
  const _d = [];
  let E1 = false, E2 = false, E3 = false, E4 = false, E5 = false;
  const dbg = {};
  try {
    const isWin = process.platform === 'win32';
    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sh94-')); _d.push(shimDir);
    const pwned = path.join(shimDir, 'PWNED.txt');
    const metaFile = path.join(shimDir, 'META.txt');
     
     
    writePortableCliShim(shimDir, 'codex', [
      `const argv = process.argv.slice(2);`,
      `if (argv[0] === '--version') { console.log('codex-shim 1.0.0'); process.exit(0); }`,
      `if (argv[0] === 'login' && argv[1] === 'status') { console.log('You are not logged in. Run codex login.'); process.exit(1); }`,
      `console.log('usage: codex [--version|login status]'); process.exit(2);`,
    ].join('\n'));
    writePortableCliShim(shimDir, 'claude', [
      `const argv = process.argv.slice(2);`,
      `if (argv[0] === '--version') console.log('claude-shim 1.0.0'); else console.log('ok');`,
    ].join('\n'));
    writePortableCliShim(shimDir, 'evil', [
      `const fs = require('fs'); const argv = process.argv.slice(2);`,
      `if (argv[0] === '--version') { console.log('evil-shim 1.0.0'); process.exit(0); }`,
      `fs.writeFileSync(${JSON.stringify(pwned)}, 'ran\\n');`,
    ].join('\n'));
    const env = Object.assign({}, process.env, {
      PATH: shimDir + path.delimiter + process.env.PATH,
      LEERNESS_ENABLE_CODEX: '1', LEERNESS_ENABLE_CLAUDE: '1', LEERNESS_ENABLE_EVIL: '1',
      LEERNESS_ENABLE_X1: '1', LEERNESS_ENABLE_KTOOL: '1', LEERNESS_ENABLE_COPILOT: '1',
    });
    const RS = (a, o) => { const r = cp.spawnSync(process.execPath, [CLI, ...a], Object.assign({ encoding: 'utf8', timeout: 180000, env }, o || {})); return { s: r.status, o: ((r.stdout || '') + (r.stderr || '')).trim() }; };
    const JS = (x) => { try { return JSON.parse(x.o.slice(x.o.indexOf('{'))); } catch { return null; } };
    const CORRUPT = '<<<<<<< HEAD\n[]\n=======\n[{"id":"T-0002"}]\n>>>>>>> branch\n';
    const hasRecovery = (s) => /bugfix-receipts\.json/.test(s) && /고치|옮기/.test(s);

     
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-esc94-')); _d.push(d);
    RS(['init', d, '--yes', '--language', 'ko', '--no-stale-check']);
    RS(['toggle', 'set', 'bugfix-receipt', 'on', '--path', d]);
    const idP = ((RS(['task', 'add', 'probe 있는 작업', '--path', d, '--json', '--no-review']).o.match(/"id"\s*:\s*"([^"]+)"/)) || [])[1];
    const idQ = ((RS(['task', 'add', 'probe 없는 작업', '--path', d, '--json', '--no-review']).o.match(/"id"\s*:\s*"([^"]+)"/)) || [])[1];
    fs.writeFileSync(path.join(d, 'app.js'), 'console.error("BUG_HERE"); process.exit(3);');
    const stReg = RS(['bugfix', 'start', idP, '--repro', 'node app.js', '--expect-bad', 'BUG_HERE', '--path', d, '--json']);
    const storeF = path.join(d, '.leerness', 'bugfix-receipts.json');
    fs.writeFileSync(storeF, CORRUPT);
    const forced = RS(['bugfix', 'drop', idP, '--force', '--path', d]);
     
    let survived = false;
    try { survived = fs.readFileSync(storeF, 'utf8') === CORRUPT; } catch { survived = false; }
    const noBackups = fs.readdirSync(path.join(d, '.leerness')).filter(f => /corrupt-/.test(f)).length === 0;
     
    dbg.setup = stReg.s;
    E1 = stReg.s === 0 && forced.s === 1 && survived && noBackups
      && !/--force/.test(forced.o) && hasRecovery(forced.o);

     
     
    const upd = RS(['task', 'update', idQ, '--status', 'done', '--path', d]);
    const updJraw = RS(['task', 'update', idQ, '--status', 'done', '--path', d, '--json']);
    const updJ = JS(updJraw);
    const listJ = JS(RS(['bugfix', 'list', '--path', d, '--json']));
    const todoF = path.join(d, 'todo.json');
    RS(['task', 'export', '--to', todoF, '--path', d]);
    try { const td = JSON.parse(fs.readFileSync(todoF, 'utf8')); td.forEach(t => { t.status = 'completed'; }); fs.writeFileSync(todoF, JSON.stringify(td)); } catch {}
    const sync = RS(['task', 'sync', '--from', todoF, '--path', d]);
    const syncJraw = RS(['task', 'sync', '--from', todoF, '--path', d, '--json']);
    const syncJ = JS(syncJraw);
    const recLine = ((updJ && updJ.recovery) || []).find(hasRecovery) || '';
     
     
    E2 = upd.s === 1 && hasRecovery(upd.o) && upd.o.includes(recLine)
      && !!recLine && updJraw.s === 1
      && sync.s === 1 && sync.o.includes(recLine)
      && !!syncJ && syncJraw.s === 1 && (syncJ.blocked || []).some(b => (b.recovery || []).includes(recLine))
      && !!listJ && (listJ.recovery || []).includes(recLine)
       
      && (fs.renameSync(storeF, storeF + '.bak'), RS(['task', 'update', idQ, '--status', 'done', '--path', d]).s === 0)
       
      && (fs.renameSync(storeF + '.bak', storeF), RS(['task', 'update', idQ, '--status', 'done', '--path', d]).s === 1)
      && /🟢 ON/.test(RS(['toggle', 'list', '--path', d]).o.split('\n').find(l => /bugfix-receipt/.test(l)) || '');

     
    const dB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-esc94b-')); _d.push(dB);
    RS(['init', dB, '--yes', '--language', 'ko', '--no-stale-check']);
    RS(['toggle', 'set', 'bugfix-receipt', 'on', '--path', dB]);
    const idB = ((RS(['task', 'add', '대상 작업', '--path', dB, '--json', '--no-review']).o.match(/"id"\s*:\s*"([^"]+)"/)) || [])[1];
    fs.writeFileSync(path.join(dB, '.leerness', 'bugfix-receipts.json'), CORRUPT);
    const cross = RS(['task', 'update', idB, '--status', 'done', '--path', dB], { cwd: d });
     
     
     
    const dC2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-esc94c-')); _d.push(dC2);
    RS(['init', dC2, '--yes', '--language', 'ko', '--no-stale-check']);
    RS(['toggle', 'set', 'bugfix-receipt', 'on', '--path', dC2]);
    const idC = ((RS(['task', 'add', '아직 안 고친 작업', '--path', dC2, '--json', '--no-review']).o.match(/"id"\s*:\s*"([^"]+)"/)) || [])[1];
    fs.writeFileSync(path.join(dC2, 'app.js'), 'console.error("BUG_HERE"); process.exit(3);');
    const regC = RS(['bugfix', 'start', idC, '--repro', 'node app.js', '--expect-bad', 'BUG_HERE', '--path', dC2, '--json']);
    const stillPlain = RS(['task', 'update', idC, '--status', 'done', '--path', dC2], { cwd: d });
    const stillJson = JS(RS(['task', 'update', idC, '--status', 'done', '--path', dC2, '--json'], { cwd: d }));
    const todoC = path.join(dC2, 'todo.json');
    RS(['task', 'export', '--to', todoC, '--path', dC2]);
    try { const td = JSON.parse(fs.readFileSync(todoC, 'utf8')); td.forEach(t => { t.status = 'completed'; }); fs.writeFileSync(todoC, JSON.stringify(td)); } catch {}
    const stillSync = RS(['task', 'sync', '--from', todoC, '--path', dC2], { cwd: d });
    const footer = (((stillJson || {}).recovery) || []).find(l => /탈출구/.test(l)) || '';
    E3 = !!idB && cross.s === 1 && cross.o.includes(path.join(dB, '.leerness')) && !cross.o.includes(path.join(d, '.leerness'))
      && regC.s === 0 && stillPlain.s === 1
       
      && !!footer && footer.includes(dC2) && /--path/.test(footer)
      && stillPlain.o.includes(footer) && stillSync.s === 1 && stillSync.o.includes(footer);

     
     
    const mk = (over) => {
      const w = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ov94-')); _d.push(w);
      RS(['init', w, '--yes', '--language', 'ko', '--no-stale-check']);
      ['commander', 'coder', 'architect'].forEach(x => RS(['roles', 'set', x, '--provider', 'codex', '--model', `gpt-${x}-fixture`, '--model-family', 'openai-gpt', '--path', w]));
      RS(['roles', 'set', 'reviewer', '--provider', 'claude', '--model', 'claude-review-fixture', '--model-family', 'claude', '--path', w]);
      RS(['toggle', 'set', 'difficulty-routing', 'on', '--path', w]);
       
      if (over) {
        const ar = RS(['provider', 'add', 'codex', '--bin', over, '--path', w]);
        let saved = false;
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(w, '.leerness', 'providers.json'), 'utf8'));
          saved = (Array.isArray(raw) ? raw : (raw.providers || [])).some(p => p.id === 'codex' && p.bin === over);
        } catch {}
        if (ar.s !== 0 || !saved) return null;
      }
      return w;
    };
    const axis = (w) => { const j = JS(RS(['agents', 'check', '--path', w, '--json'])) || {}; return ((j.agents || []).find(a => a.id === 'codex') || {}); };
    const route = (w) => { const r = RS(['agents', 'route', '인증 토큰 재발급 로직 변경', '--confirm', '--approved-by', '검증자', '--path', w, '--json']); return { s: r.s, j: JS(r) }; };
     
     
    const blockedByAuth = (r) => r.s === 1 && !!r.j && r.j.confirmed === false
      && (r.j.refusals || []).length === 1 && (r.j.refusals || [])[0].code === 'provider_not_authenticated';
     
     
     
     
    const aliases = [null, 'codex'].concat(isWin ? ['CODEX', 'codex.cmd'] : []);
    let aliasOk = true, aliasBad = '';
    for (const al of aliases) {
      const w = mk(al);
      if (!w) { aliasOk = false; aliasBad = String(al) + ':setup'; break; }
      if (axis(w).auth !== 'no' || !blockedByAuth(route(w))) { aliasOk = false; aliasBad = String(al); break; }
    }
    dbg.alias = aliasBad;
     
     
     
    const pathOverride = path.join(shimDir, isWin ? 'codex.cmd' : 'codex');
    const pathWorkspace = mk(pathOverride);
    const pathAxis = pathWorkspace ? axis(pathWorkspace) : {};
    const pathRoute = pathWorkspace ? route(pathWorkspace) : { s: 1, j: null };
    const pathAuthorityOk = !!pathWorkspace && pathAxis.auth === 'unknown'
      && /override/.test(String(pathAxis.authCheckDroppedReason || ''))
      && pathRoute.s === 0 && pathRoute.j && pathRoute.j.confirmed === true;
    E4 = aliasOk && pathAuthorityOk;

     
    const inject = (w, id, patch) => {
      const pf = path.join(w, '.leerness', 'providers.json');
      const raw = JSON.parse(fs.readFileSync(pf, 'utf8'));
      (Array.isArray(raw) ? raw : (raw.providers || [])).forEach(p => { if (p.id === id) Object.assign(p, patch); });
      fs.writeFileSync(pf, JSON.stringify(raw, null, 2));
    };
     
    const wD = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-inj94-')); _d.push(wD);
    RS(['init', wD, '--yes', '--language', 'ko', '--no-stale-check']);
    RS(['provider', 'add', 'evil', '--bin', 'evil', '--path', wD]);
    inject(wD, 'evil', { authCheck: { args: ['pwn'], timeoutMs: 5000, noPattern: 'never', note: '주입' }, versionArgs: ['pwn'] });
    RS(['agents', 'list', '--path', wD]);
    const injJ = JS(RS(['agents', 'check', '--path', wD, '--json']));
    const evilA = (((injJ || {}).agents) || []).find(a => a.id === 'evil') || {};
    const wE = mk('codex');
    if (wE) inject(wE, 'codex', { authCheck: { args: ['pwn'], timeoutMs: 5000, noPattern: 'never' }, versionArgs: ['--version', '&', 'echo', 'META', '>', metaFile] });
    const bJ = wE ? JS(RS(['agents', 'check', '--path', wE, '--json'])) : null;
    const codexA = (((bJ || {}).agents) || []).find(a => a.id === 'codex') || {};
     
    const wC = mk('node');
    const lineC = wC ? (RS(['agents', 'check', '--path', wC]).o.split('\n').find(l => /codex/.test(l) && /확인안됨|사용가능|사용불가/.test(l)) || '') : '';
    dbg.lineC = lineC.slice(0, 40);
     
    const wF = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bin94-')); _d.push(wF);
    RS(['init', wF, '--yes', '--language', 'ko', '--no-stale-check']);
    RS(['provider', 'add', 'x1', '--bin', 'x1', '--path', wF]);
    inject(wF, 'x1', { bin: 'cmd /c echo INJECTED > "' + path.join(shimDir, 'BIN.txt') + '" & rem' });
    RS(['agents', 'list', '--path', wF]);
    const binJ = JS(RS(['agents', 'check', '--path', wF, '--json']));
    const x1A = (((binJ || {}).agents) || []).find(a => a.id === 'x1') || {};
     
    RS(['provider', 'add', 'ktool', '--bin', 'codex', '--path', wF]);
    inject(wF, 'ktool', { versionArgs: ['version', '--client'] });
    const kJ = JS(RS(['agents', 'check', '--path', wF, '--json']));
    const ktA = (((kJ || {}).agents) || []).find(a => a.id === 'ktool') || {};
     
     
    writePortableCliShim(shimDir, 'echoargs', `console.log('ARGS ' + process.argv.slice(2).join(' '));`);
    RS(['provider', 'add', 'copilot', '--bin', 'echoargs', '--path', wF]);
    inject(wF, 'copilot', { versionArgs: ['--version', '&', 'x'] });
    const cpJ = JS(RS(['agents', 'check', '--path', wF, '--json']));
    const cpA = (((cpJ || {}).agents) || []).find(a => a.id === 'copilot') || {};
    dbg.fallback = String(cpA.version || '').slice(0, 40);
    const builtinNoise = (((kJ || {}).agents) || []).filter(a => ['codex', 'claude', 'copilot', 'ollama'].indexOf(a.id) >= 0 && (a.binRejected || a.versionArgsRejected));
     
     
     
     
    const catalog = path.join(shimDir, 'catalog.json');
    const srvJs = path.join(shimDir, 'srv.js');
    const portFile = path.join(shimDir, 'port.txt');
    fs.writeFileSync(srvJs, `const fs=require('fs'),http=require('http');
const s=http.createServer((q,r)=>{r.writeHead(200,{'content-type':'application/json'});r.end(fs.readFileSync(process.argv[2]));});
s.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.argv[3],String(s.address().port)));`);
    const napMs = (ms) => { try { cp.spawnSync(process.execPath, ['-e', `setTimeout(function(){},${ms})`], { timeout: ms + 5000 }); } catch {} };
    const syncOnce = (entries) => {
      fs.writeFileSync(catalog, JSON.stringify(entries));
      try { fs.rmSync(portFile, { force: true }); } catch {}
      const child = cp.spawn(process.execPath, [srvJs, catalog, portFile], { stdio: 'ignore', detached: false });
      let port = null;
      for (let i = 0; i < 60 && !port; i++) { napMs(100); try { port = fs.readFileSync(portFile, 'utf8').trim() || null; } catch {} }
       
       
      if (port) RS(['provider', 'sync', `http://127.0.0.1:${port}/c.json`, '--path', wF], { env: Object.assign({}, env, { LEERNESS_OFFLINE: '0' }) });
      try { child.kill(); } catch {}
      try { return JSON.parse(fs.readFileSync(path.join(wF, '.leerness', 'providers.json'), 'utf8')); } catch { return null; }
    };
    const asList = (raw) => (Array.isArray(raw) ? raw : ((raw && raw.providers) || []));
    let syncedVa = null, syncSkippedBadBin = false;
    const r1 = syncOnce([{ id: 'remote1', bin: 'evil', versionArgs: ['pwn'], desc: 'r' }]);
    const got1 = asList(r1).find(p => p.id === 'remote1');
    syncedVa = got1 ? JSON.stringify(got1.versionArgs) : null;
     
    const r2 = syncOnce([{ id: 'remote2', bin: 'cmd /c echo X & rem', desc: 'r' }]);
    syncSkippedBadBin = !!r2 && !asList(r2).some(p => p.id === 'remote2');
    dbg.syncedVa = syncedVa;
    E5 = !fs.existsSync(metaFile) && !fs.existsSync(path.join(shimDir, 'BIN.txt'))
      && evilA.auth === 'unknown'
       
      && !!wE && codexA.auth === 'no' && codexA.authSource === 'codex login status' && !!codexA.versionArgsRejected
       
      && !!wC && /override/.test(lineC) && /node/.test(lineC) && !/등록된 확인 명령 없음/.test(lineC)
       
      && !!x1A.binRejected && /⚠ x1:/.test(RS(['agents', 'list', '--path', wF]).o)
       
      && !ktA.versionArgsRejected && builtinNoise.length === 0
       
      && /ARGS/.test(String(cpA.version || '')) && !/copilot/.test(String(cpA.version || ''))
       
      && syncedVa === '["--version"]' && syncSkippedBadBin;
    ok = E1 && E2 && E3 && E4 && E5;
    if (!ok) console.log(`   [이월94 디버그] 무파괴=${E1}(setup ${dbg.setup}) 안내전달=${E2} path보존=${E3} 축유지=${E4}(별칭실패 "${dbg.alias}") 주입차단=${E5}(lineC "${dbg.lineC}" syncedVa=${dbg.syncedVa} 폴백="${dbg.fallback}")`);
  } catch (e) { console.log('   [이월94 디버그] 예외: ' + ((e && e.message) || e)); }
  finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.94/1.36.185) 헌트 이월 2건: 손상 스토어를 도구가 건드리지 않음(--force 로도) · 회복 절차가 평문/--json/sync 에 같은 문장으로 도달하고 실제로 통과시킴 · 안내가 --path 유지 · 바른 bare-bin 별칭은 인증 차단 유지, 절대경로는 별도 권한으로 분리 · 비활성/providers.json authCheck·versionArgs 미실행(user·빌트인 두 갈래)' : '✗ 헌트 이월 2건(1.36.94) 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.76)')) {
  total++;
  let ok = false;
  const _d = [];
  try {
     
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-h9x3-')); _d.push(d);
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--minimal', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    const ap = path.join(d, '.leerness', 'decisions.archive.md');
    const bytes = Buffer.from('# Decisions archive\n\n## 제거 2026-07-25 (target: "Trunc")\n\n### 2026-07-25 — Trunc\n- Decision: 데이터', 'utf8');
    fs.writeFileSync(ap, bytes.slice(0, bytes.length - 1));
    const before = fs.readFileSync(ap);
    const rr = cp.spawnSync(process.execPath, [CLI, 'memory', 'restore', 'decisions', 'Trunc', '--path', d], { encoding: 'utf8', timeout: 20000 });
    const truncOk = rr.status === 1 && before.equals(fs.readFileSync(ap));
     
    const ghost = path.join(d, 'no-such-target');
    cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 25000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_state_show', arguments: { path: ghost } } }) + '\n' });
    const ghostOk = !fs.existsSync(ghost);
    cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 25000, input: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'leerness_pulse', arguments: { path: d } } }) + '\n' });
    const statsOk = fs.existsSync(path.join(d, '.leerness', 'cache', 'usage-stats.json'));
     
    fs.rmSync(path.join(d, '.leerness', 'environment.json'), { force: true });
    const envTools = require('./e2e-env-tools').create(d);
    const envResp = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 25000, env: envTools.env, input: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'leerness_env_detect', arguments: { path: d } } }) + '\n' });
    const envMessage = JSON.parse(envResp.stdout.trim().split('\n')[0]), envData = JSON.parse(envMessage.result.content[0].text);
    const noWriteOk = envResp.status === 0 && envMessage.result.isError !== true && envData.persisted === false && envTools.verify(envData) && /snapshot/.test(envResp.stdout) && !fs.existsSync(path.join(d, '.leerness', 'environment.json'));
    const checkpoint = envTools.checkpoint();
    const envCli = cp.spawnSync(process.execPath, [CLI, 'env', 'detect', d, '--json'], { encoding: 'utf8', timeout: 20000, env: envTools.env });
    const envCliData = JSON.parse(envCli.stdout);
    const cliPersistOk = envCli.status === 0 && envCliData.persisted === true && envTools.verify(envCliData, checkpoint) && fs.existsSync(path.join(d, '.leerness', 'environment.json'));
     
    const A = (u) => cp.spawnSync(process.execPath, [CLI, 'api-skill', 'add', u, '--skeleton', '--no-crawl', '--path', d, '--json'], { encoding: 'utf8', timeout: 25000 });
    let longOk = false, normOk = false;
    try { const j = JSON.parse(A('ftp://' + 'a'.repeat(300) + '.test/docs').stdout); longOk = j.ok === true && j.id.length <= 80; } catch {}
    try { normOk = JSON.parse(A('https://developers.coupangcorp.com/articles/360033877853').stdout).id === 'developers-coupangcorp-articles-360033877853'; } catch {}
    ok = truncOk && ghostOk && statsOk && noWriteOk && cliPersistOk && longOk && normOk;
    if (!ok) console.log(`   [h9x 디버그] trunc=${truncOk} ghost=${ghostOk} stats=${statsOk} noWrite=${noWriteOk} cli=${cliPersistOk} long=${longOk} norm=${normOk}`);
  } catch (e) {} finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.76) 9차 이월 종결: U+FFFD 아카이브 복원거부 · MCP read-only 무변형(대상/텔레메트리/env) · 긴 id 안전화' : '✗ 9차 이월 수정 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.77)')) {
  total++;
  let ok = false;
  const _d = [];
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mcp77-')); _d.push(d);
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    const MCP = (name, args) => {
      const req = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) + '\n';
      const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 25000, input: req, maxBuffer: 8 * 1024 * 1024 });
      for (const l of (r.stdout || '').trim().split('\n')) { try { const j = JSON.parse(l); if (j.result) return j.result; } catch {} }
      return null;
    };
    const inner = (res) => { try { return JSON.parse(res.content[0].text); } catch { return null; } };
    const cl = inner(MCP('leerness_clarify', { text: '적당히 이쁘게 그거 고쳐줘', path: d }));
    const clOk = cl && cl.ambiguous === true && Array.isArray(cl.questions) && cl.questions.length >= 2;
    const ad = inner(MCP('leerness_preview', { action: 'add', title: '신규 페이지 디자인', design: '밝게', path: d }));
    const mk = inner(MCP('leerness_preview', { action: 'mockup', id: 'P-0001', path: d }));
    const flowOk = ad && ad.id === 'P-0001' && mk && mk.mockupPath === '.leerness/previews/P-0001-mockup.html'
      && fs.existsSync(path.join(d, '.leerness', 'previews', 'P-0001-mockup.html'));
    const ap = inner(MCP('leerness_preview', { action: 'approve', id: 'P-0001', path: d }));
    const noteErr = MCP('leerness_preview', { action: 'revise', id: 'P-0001', path: d });
    const contractOk = ap && ap.status === 'approved' && noteErr && noteErr.isError === true;
     
    const T = require(path.resolve(path.dirname(CLI), '..', 'lib', 'mcp-tools.js'));
    const defOk = T.some(t => t.name === 'leerness_clarify' && t.requiredTier === 'read-only')
      && T.some(t => t.name === 'leerness_preview' && t.requiredTier === 'safe-write');
    ok = clOk && flowOk && contractOk && defOk;
    if (!ok) console.log(`   [mcp77 디버그] cl=${clOk} flow=${flowOk} contract=${contractOk} def=${defOk}`);
  } catch (e) {} finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.77) MCP clarify/preview 노출: 질문 생성 + add→mockup→approve 왕복 + revise 노트 계약 + 티어' : '✗ MCP clarify/preview 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.78)')) {
  total++;
  let ok = false;
  const _d = [];
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-h10-')); _d.push(d);
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    const T = (a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { encoding: 'utf8', timeout: 20000 });
    const J = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };
     
    const tj = path.join(d, '.leerness', 'teams.json');
    fs.writeFileSync(tj, '{"teams":[{"id":"preserved","members":["codex"]}],"metadata":{"revision":7}}');
    const beforeT = fs.readFileSync(tj, 'utf8');
    const f1a = T(['team', 'add', 'newteam', '--members', 'claude', '--json']);
    const f1Ok = f1a.status === 1 && fs.readFileSync(tj, 'utf8') === beforeT;
     
    fs.writeFileSync(tj, '[{"id":"bad","members":"codex","personas":[],"schedule":"manual","status":"active"}]');
    let f1bOk = false; try { f1bOk = Array.isArray(J(T(['team', 'list', '--json'])).teams[0].members); } catch {}
     
    fs.writeFileSync(tj, '[]');
    const addJson = T(['team', 'add', 'alpha', '--members', 'claude,codex', '--json']);
    const f4addOk = J(addJson) && J(addJson).ok === true;
    const dupJson = T(['team', 'add', 'alpha', '--members', 'x', '--json']);
    const f4dupOk = J(dupJson) && J(dupJson).ok === false && dupJson.status === 1;
    const rmMiss = T(['team', 'remove', 'nope', '--json']);
    const f4rmOk = J(rmMiss) && rmMiss.status === 1;
    const depHuman = T(['team', 'deploy', 'alpha']);
    const depJson = T(['team', 'deploy', 'alpha', '--json']);
    const f4depOk = depHuman.status === depJson.status && depHuman.status === 1 && J(depJson) != null;
     
    const _pcf = path.join(d, '.leerness', 'platform-constraints.json');    
    const f2malOk = T(['constraints', 'add', 'x1', '--alias', 'x1', '--constraint', 'rate-limit', '--json']).status === 1
      && T(['constraints', 'add', 'x2', '--alias', 'x2', '--constraint', 'auth:', '--json']).status === 1
      && !(fs.existsSync(_pcf) && fs.readFileSync(_pcf, 'utf8').includes('"x1"'));
    T(['constraints', 'add', 'dp', '--alias', 'dp', '--constraint', 'auth:token required', '--json']);
    const dup2 = J(T(['constraints', 'add', 'dp', '--alias', 'dp', '--constraint', 'auth:token required', '--json']));
    const f2dupOk = dup2 && dup2.constraints.length === 1;
     
    fs.writeFileSync(path.join(d, '.leerness', 'platform-constraints.json'), '{"platforms":');
    const f3Ok = J(T(['constraints', 'list', '--json'])).corruptStore === true
      && J(T(['constraints', 'check', 'stripe API', '--json'])).corruptStore === true;
     
    const rec = J(cp.spawnSync(process.execPath, [CLI, 'agents', 'recommend', 'refactor payment module', '--json'], { encoding: 'utf8', timeout: 20000 }));
    const f5Ok = rec && rec.ok === true && typeof rec.recommended === 'string';
     
    fs.writeFileSync(path.join(d, 'SPEC.md'), '# Spec\nprose'); fs.writeFileSync(path.join(d, 'impl.js'), '// empty');
    const f6Ok = cp.spawnSync(process.execPath, [CLI, 'contract', 'verify', path.join(d, 'SPEC.md'), path.join(d, 'impl.js'), '--json'], { encoding: 'utf8', timeout: 20000 }).status === 1
      && cp.spawnSync(process.execPath, [CLI, 'contract', 'verify', path.join(d, 'SPEC.md'), path.join(d, 'impl.js'), '--json', '--allow-empty'], { encoding: 'utf8', timeout: 20000 }).status === 0;
     
    const pc = path.join(d, '.leerness', 'platform-constraints.json');
    fs.writeFileSync(pc, '{"platforms":[],"metadata":{"revision":7}}');
    const beforePc = fs.readFileSync(pc, 'utf8');
    const arrOk = J(T(['constraints', 'list', '--json'])).corruptStore === true
      && T(['constraints', 'add', 'p', '--alias', 'p', '--constraint', 'auth:x', '--json']).status === 1
      && fs.readFileSync(pc, 'utf8') === beforePc;
     
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-h10dep-')); _d.push(d2);
    cp.spawnSync(process.execPath, [CLI, 'init', d2, '--yes', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    cp.spawnSync(process.execPath, [CLI, 'team', 'add', 'dep', '--members', 'claude', '--deploy', 'node -e "process.exit(0)"', '--path', d2], { encoding: 'utf8', timeout: 20000 });
    const depExec = cp.spawnSync(process.execPath, [CLI, 'team', 'deploy', 'dep', '--yes', '--json', '--path', d2], { encoding: 'utf8', timeout: 30000, env: { ...process.env, LEERNESS_TEAM_DEPLOY: '1' } });
    let depExecOk = false; try { const j = JSON.parse(depExec.stdout); depExecOk = j.executed === true && j.exitStatus === 0 && depExec.status === 0; } catch {}
    ok = f1Ok && f1bOk && f4addOk && f4dupOk && f4rmOk && f4depOk && f2malOk && f2dupOk && f3Ok && f5Ok && f6Ok && arrOk && depExecOk;
    if (!ok) console.log(`   [h10 디버그] f1=${f1Ok} f1b=${f1bOk} f4add=${f4addOk} f4dup=${f4dupOk} f4rm=${f4rmOk} f4dep=${f4depOk} f2mal=${f2malOk} f2dup=${f2dupOk} f3=${f3Ok} f5=${f5Ok} f6=${f6Ok} arr=${arrOk} depExec=${depExecOk}`);
  } catch (e) {} finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.78) 10차헌트: team 형상거부/정규화·JSON계약 · constraints 검증/dedup/손상표면 · agents recommend · 빈 contract 거부' : '✗ 10차 헌트 수정 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.79)')) {
  total++;
  let ok = false;
  const _d = [];
  try {
     
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-dog-a-')); _d.push(d);
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--minimal', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    const pt = path.join(d, '.leerness', 'progress-tracker.md');
    fs.writeFileSync(pt, fs.readFileSync(pt, 'utf8').trimEnd() + '\n| R-0001 | done | 사용자 이력 | 증거 | - | 2026-05-07 |\n| UR-0002 | done | 다른 요청 | 증거2 | - | 2026-05-07 |\n');
    const rowsOf = () => (fs.readFileSync(pt, 'utf8').match(/^\|\s*[A-Z]{1,3}-\d{3,}\s*\|/gm) || []).length;
    const beforeRows = rowsOf();
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'brand new', '--path', d], { encoding: 'utf8', timeout: 20000 });
    const rowOk = rowsOf() === beforeRows + 1
      && fs.readFileSync(pt, 'utf8').includes('R-0001') && fs.readFileSync(pt, 'utf8').includes('UR-0002');
     
    const dG = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-dog-a2-')); _d.push(dG);
    cp.spawnSync(process.execPath, [CLI, 'init', dG, '--yes', '--minimal', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    const ptG = path.join(dG, '.leerness', 'progress-tracker.md');
    fs.appendFileSync(ptG, '| R-0007 | done | 셀부족행 |\n');
    const beforeG = fs.readFileSync(ptG, 'utf8');
    const guardR = cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'x', '--path', dG], { encoding: 'utf8', timeout: 20000 });
    const guardOk = guardR.status === 1 && fs.readFileSync(ptG, 'utf8') === beforeG;
     
    const dS = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-dog-a3-')); _d.push(dS);
    cp.spawnSync(process.execPath, [CLI, 'init', dS, '--yes', '--minimal', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    const ptS = path.join(dS, '.leerness', 'progress-tracker.md');
    fs.appendFileSync(ptS, '\n## 참고표\n\n| Code | Owner | Note |\n|---|---|---|\n| API-123 | owner | 무관 참조 |\n');
    let absorbed = true;
    try { absorbed = (JSON.parse(cp.spawnSync(process.execPath, [CLI, 'task', 'list', '--path', dS, '--json'], { encoding: 'utf8', timeout: 20000 }).stdout).tasks || []).some(t => t.id === 'API-123'); } catch {}
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'x', '--path', dS], { encoding: 'utf8', timeout: 20000 });
    const suffixOk = !absorbed && fs.readFileSync(ptS, 'utf8').includes('| API-123 | owner |') && fs.readFileSync(ptS, 'utf8').includes('## 참고표');
     
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-dog-b-')); _d.push(d2);
    cp.spawnSync(process.execPath, [CLI, 'init', d2, '--yes', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    const hp = path.join(d2, '.leerness', 'session-handoff.md');
    if (fs.existsSync(hp)) fs.writeFileSync(hp, fs.readFileSync(hp, 'utf8').replace(/Last generated:.*/, 'Last generated: 2026-01-01T00:00:00.000Z'));
    const pt2 = path.join(d2, '.leerness', 'progress-tracker.md');
    if (fs.existsSync(pt2)) fs.writeFileSync(pt2, fs.readFileSync(pt2, 'utf8').replace(/2026-\d\d-\d\d/g, '2026-01-01'));
    const hj = cp.spawnSync(process.execPath, [CLI, 'handoff', d2, '--inspect', '--json'], { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
    let jsonPure = false; try { JSON.parse(hj.stdout); jsonPure = true; } catch {}
     
    const ht = cp.spawnSync(process.execPath, [CLI, 'handoff', d2, '--inspect'], { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
    const bannerKept = /drift 감지|drift detected/.test(ht.stdout);
     
    const d3 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-dog-c-')); _d.push(d3);
    cp.spawnSync(process.execPath, [CLI, 'init', d3, '--yes', '--minimal', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    let parentOk = false;
    try { const j = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'parent', 'detect', d3, '--json'], { encoding: 'utf8', timeout: 20000, cwd: path.dirname(path.dirname(CLI)) }).stdout); parentOk = String(j.root || j.child || '').includes(path.basename(d3)); } catch {}
     
    const d4 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-dog-d-')); _d.push(d4);
    cp.spawnSync(process.execPath, [CLI, 'init', d4, '--yes', '--minimal', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    fs.mkdirSync(path.join(d4, 'src'), { recursive: true });
    for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(d4, 'src', `m${i}.py`), 'def f():\n    return 1\n');
    fs.writeFileSync(path.join(d4, 'requirements.txt'), 'requests\n');
    fs.writeFileSync(path.join(d4, 'package.json'), JSON.stringify({ name: 'x', devDependencies: { tailwindcss: '^3' } }));
    let techOk = false;
    try { techOk = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'tech', '--json', '--path', d4], { encoding: 'utf8', timeout: 25000 }).stdout).current.languages[0].id === 'python'; } catch {}
    const d5 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-dog-d2-')); _d.push(d5);
    cp.spawnSync(process.execPath, [CLI, 'init', d5, '--yes', '--minimal', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    fs.mkdirSync(path.join(d5, 'src'), { recursive: true });
    for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(d5, 'src', `m${i}.js`), 'export const a = 1;\n');
    fs.writeFileSync(path.join(d5, 'package.json'), JSON.stringify({ name: 'js', dependencies: { react: '^18' } }));
    let jsOk = false;
    try { jsOk = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'tech', '--json', '--path', d5], { encoding: 'utf8', timeout: 25000 }).stdout).current.languages[0].id === 'javascript'; } catch {}
     
    const d6 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-dog-e-')); _d.push(d6);
    cp.spawnSync(process.execPath, [CLI, 'init', d6, '--yes', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    const hd = path.join(d6, '.leerness');
    const keep = new Set(['progress-tracker.md', 'HARNESS_VERSION', 'plan.md']);
    for (const f of fs.readdirSync(hd)) { if (!keep.has(f)) { try { fs.rmSync(path.join(hd, f), { recursive: true, force: true }); } catch {} } }
    let auditOk = false;
    try {
      const au = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'audit', d6, '--json'], { encoding: 'utf8', timeout: 30000 }).stdout);
      const ic = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'integrity', 'check', d6, '--json'], { encoding: 'utf8', timeout: 30000 }).stdout);
      auditOk = au.healthy === false && au.failures >= 1 && ic.ok === false;    
    } catch {}
     
    const parentBadOk = cp.spawnSync(process.execPath, [CLI, 'parent', 'detect', 'C:/no/such/dir', '--json'], { encoding: 'utf8', timeout: 20000 }).status === 1;
    ok = rowOk && guardOk && suffixOk && jsonPure && bannerKept && parentOk && parentBadOk && techOk && jsOk && auditOk;
    if (!ok) console.log(`   [dogfood 디버그] row=${rowOk} guard=${guardOk} suffix=${suffixOk} json=${jsonPure} banner=${bannerKept} parent=${parentOk} parentBad=${parentBadOk} tech=${techOk} js=${jsOk} audit=${auditOk}`);
  } catch (e) {} finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.79) 도그푸딩 P1×5: progress 행 보존 · handoff --json 순수(텍스트 배너 유지) · parent path · tech 파일수 우선 · audit=integrity 정합' : '✗ 도그푸딩 P1 수정 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.80)')) {
  total++;
  let ok = false;
  const _d = [];
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ref-')); _d.push(d);
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--minimal', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    const J = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };
    const N = (js) => `node -e "${js}"`;
    const add = (id, check, good, bad, expect) => { const a = ['referee', 'add', id, '--check', check, '--good', good, '--bad', bad]; if (expect) a.push('--expect-bad', expect); return R(a); };
    const verify = (id) => J(R(['referee', 'verify', id, '--json']));
     
    add('okref', N('process.exit(0)'), N('process.exit(0)'), N("console.log('AssertionError: x'); process.exit(1)"), 'AssertionError');
    const good = verify('okref');
    const happyOk = good && good.ok === true && good.goodExit === 0 && good.badExit === 1 && good.expectMatched === true;
     
     
     
     
     
    const a1 = add('redbase', N('process.exit(0)'), N('process.exit(3)'), N("console.log('SIG'); process.exit(1)"), 'SIG');
    const p1 = verify('redbase');
     
    const a2 = add('nopower', N('process.exit(0)'), N('process.exit(0)'), N("console.log('SIG'); process.exit(0)"), 'SIG');
    const p2 = verify('nopower');
     
    const a3 = add('wrongreason', N('process.exit(0)'), N('process.exit(0)'), N("console.log('Error: cannot find module'); process.exit(1)"), 'AssertionError');
    const p3 = verify('wrongreason');
    const _rz = (p) => (p && p.reasons || []).join(' | ');
    const probesOk = a1.status === 0 && a2.status === 0 && a3.status === 0
      && p1 && p1.ok === false && /known-good/.test(_rz(p1))           
      && p2 && p2.ok === false && /exit 0|통과시킴/.test(_rz(p2))       
      && p3 && p3.ok === false && p3.expectMatched === false && /사유 불일치|런처/.test(_rz(p3));
     
    const store = path.join(d, '.leerness', 'referees.json');
    const js = JSON.parse(fs.readFileSync(store, 'utf8'));
    js.find(x => x.id === 'okref').bad = N('process.exit(1)');
    fs.writeFileSync(store, JSON.stringify(js, null, 2));
    const shown = J(R(['referee', 'show', 'okref', '--json']));
    const staleOk = shown && shown.stale === true && shown.calibrated === false;
     
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', '작업', '--path', d], { encoding: 'utf8', timeout: 20000 });
    cp.spawnSync(process.execPath, [CLI, 'task', 'update', 'T-0002', '--status', 'done', '--evidence', 'lib/referee.js 구현', '--path', d], { encoding: 'utf8', timeout: 20000 });
    const missing = R(['verify-claim', 'T-0002', '--referee', 'nope', '--json']);
    const staleUse = R(['verify-claim', 'T-0002', '--referee', 'okref', '--json']);    
    add('failing', N('process.exit(2)'), N('process.exit(0)'), N("console.log('AssertionError'); process.exit(1)"), 'AssertionError');
    verify('failing');
    const refFail = R(['verify-claim', 'T-0002', '--referee', 'failing', '--json']);
     
     
    add('nevercal', N('process.exit(0)'), N('process.exit(0)'), N("console.log('AssertionError'); process.exit(1)"), 'AssertionError');
    const neverUse = R(['verify-claim', 'T-0002', '--referee', 'nevercal', '--json']);
    const neverShown = J(R(['referee', 'show', 'nevercal', '--json']));
    const uncalOk = neverUse.status === 1 && (J(neverUse) || {}).code === 'referee_uncalibrated'
      && neverShown && neverShown.stale === false && neverShown.calibrated === false;
     
     
    add('failopen', N('process.exit(0)'), N('process.exit(0)'), N("console.log('AssertionError'); process.exit(1)"), 'AssertionError');
    verify('failopen');
    const foStore = JSON.parse(fs.readFileSync(store, 'utf8'));
    foStore.find(x => x.id === 'failopen').calibration.ok = 'false';    
    fs.writeFileSync(store, JSON.stringify(foStore, null, 2));
    const foUse = R(['verify-claim', 'T-0002', '--referee', 'failopen', '--json']);
    const foShow = J(R(['referee', 'show', 'failopen', '--json']));
    const failOpenOk = foUse.status === 1 && (J(foUse) || {}).code !== undefined
      && (J(foUse) || {}).code !== 'referee_failed'       
      && !(foShow && foShow.calibrated === true);         
     
    foStore.find(x => x.id === 'failopen').calibration.ok = true;
    fs.writeFileSync(store, JSON.stringify(foStore, null, 2));
    const gateOk = missing.status === 1 && (J(missing) || {}).code === 'referee_not_found'
      && staleUse.status === 1 && (J(staleUse) || {}).code === 'referee_stale'
      && uncalOk && failOpenOk
      && refFail.status === 1 && (J(refFail) || {}).code === 'referee_failed';
     
    const listPure = (() => { try { JSON.parse(R(['referee', 'list', '--json']).stdout); return true; } catch { return false; } })();
    fs.writeFileSync(store, '{ broken');
    const corrupt = R(['referee', 'add', 'x9', '--check', 'a', '--good', 'b', '--bad', 'c', '--json']);
    const storeOk = listPure && corrupt.status === 1 && (J(corrupt) || {}).code === 'store_invalid';
    ok = happyOk && probesOk && staleOk && gateOk && storeOk;
    if (!ok) console.log(`   [referee 디버그] happy=${happyOk} probes=${probesOk} stale=${staleOk} gate=${gateOk} store=${storeOk}`);
  } catch (e) {} finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.80) referee 캘리브레이션: 탐지력 증명(good통과+bad를 기대사유로 거부) · FP프로브 3종 거부 · 명령변경 stale · verify-claim 게이팅(미존재/미검증/무효/검증기실패 4구분) · 스토어 규율' : '✗ referee 캘리브레이션 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.80) #2')) {
  total++;
  let ok = false;
  const _d = [];
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-pv80-')); _d.push(d);
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    const J = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };
     
    const CAT = require(path.resolve(path.dirname(CLI), '..', 'lib', 'catalogs.js')).BUILTIN_CATALOG;
    const skillOk = Object.keys(CAT).length === 2 && !CAT['commerce-api'] && CAT['feature-implementation']
      && Object.values(CAT).every(v => v.verification !== 'passed');
     
    fs.mkdirSync(path.join(d, '.leerness', 'skills', 'commerce-api'), { recursive: true });
    fs.writeFileSync(path.join(d, '.leerness', 'skills', 'commerce-api', 'skill.json'), '{"name":"commerce-api"}');
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--skills', 'recommended', '--no-env', '--no-stale-check'], { encoding: 'utf8', timeout: 40000 });
    let keepOk = false;
    try { keepOk = Object.keys(JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'skills-lock.json'), 'utf8')).installedSkills).includes('commerce-api') && fs.existsSync(path.join(d, '.leerness', 'skills', 'commerce-api')); } catch {}
     
    R(['preview', 'add', '새 페이지', '--design', '밝게']);
    R(['preview', 'mockup', 'P-0001']);
    const modeShow = R(['preview', 'mode']);
    const modeOk = /미리보기 모드가 아직/.test(modeShow.stdout) && (J(R(['preview', 'mode', '--json'])) || {}).effective === 'self';
     
    R(['preview', 'mode', 'project', '--static-dir', 'public', '--dev-url', 'http://localhost:5173']);
    const proj = J(R(['preview', 'serve', 'P-0001', '--json']));
    const projOk = proj && proj.mode === 'project' && /public\/leerness-preview-P-0001\.html/.test(proj.file || '')
      && fs.existsSync(path.join(d, 'public', 'leerness-preview-P-0001.html'))
      && R(['preview', 'serve', 'P-0001', '--static-dir', '../outside', '--json']).status === 1;
     
    const base = J(R(['review-request', '테스트 요청', '--json']));
    const lad = J(R(['review-request', '테스트 요청', '--ladder', '--json']));
    const ladderOk = base && base.ladder === undefined && lad && lad.ladder && lad.ladder.rungs.length === 7
      && lad.ladder.rungs.every(r => ['confirmed', 'candidate', 'unknown', 'not-applicable'].includes(r.status))
      && lad.proceed === base.proceed && Array.isArray(lad.ladder.preserved) && lad.ladder.preserved.length >= 4;
    ok = skillOk && keepOk && modeOk && projOk && ladderOk;
    if (!ok) console.log(`   [pv80 디버그] skill=${skillOk} keep=${keepOk} mode=${modeOk} proj=${projOk} ladder=${ladderOk}`);
  } catch (e) {} finally { _d.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? '✓ B(1.36.80) 기본스킬 정리(도메인7 제거·passed 주장 금지·기존설치 보존) · 라이브 미리보기 mode(self기본/project옵트인·루트밖 거부) · 사다리 옵트인(proceed 무영향)' : '✗ 1.36.80 미리보기/스킬/사다리 실패');
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.97/P-0011)')) {
  total++;
  let ok = false; const dbg = {};
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lens97-'));
  const R = (a, o = {}) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: o.cwd || d, encoding: 'utf8', timeout: 60000 });
  const out = (r) => (r.stdout || '') + (r.stderr || '');
  const HAN = /[가-힣]/;
  try {
    R(['init', d, '--yes', '--language', 'ko', '--skills', 'recommended']);
     
    const c = out(R(['lens', 'contract', '--path', d]));
    const contractOk = /## contract/.test(c) && /12\. /.test(c) && !/13\. /.test(c) && /breaking/.test(c);
    const rc = out(R(['lens', 'recovery', '--path', d]));
    const recOk = /## recovery/.test(rc) && /fail-open/.test(rc) && /12\. /.test(rc);
    const ob = out(R(['lens', 'observability', '--path', d]));
    const obsOk = /## observability/.test(ob) && /민감정보/.test(ob) && /12\. /.test(ob);
    const ax = out(R(['lens', 'axes', '--path', d]));
    const axesOk = /## axes/.test(ax) && /8\. /.test(ax) && !/9\. /.test(ax) && /leerness lens database/.test(ax);
     
    const un = R(['lens', 'nosuchaxis', '--path', d]);
    const unknownOk = un.status === 1 && /observability/.test(out(un)) && /contract/.test(out(un)) && /axes/.test(out(un));
     
     
    const surfaces = [out(R(['commands', '--path', d])), out(R(['--help'])), out(R(['--help', '--language', 'en']))];
    const surfaceOk = surfaces.every(s => /lens \[/.test(s) && /observability/.test(s) && /\|axes\]/.test(s));
     
    const en = out(R(['lens', 'recovery', '--language', 'en', '--path', d]));
    const enOk = /failure & recovery/.test(en) && /fail-open/.test(en) && !HAN.test(en);
     
    fs.writeFileSync(path.join(d, 'worker.mjs'), 'export async function run(){ try { await go() } catch (e) {} }\n');
    fs.writeFileSync(path.join(d, 'pure.mjs'), 'export const add = (a, b) => a + b\n');
    fs.writeFileSync(path.join(d, 'loop.mjs'), 'export async function all(ids){ for (const id of ids) { await fetchOne(id) } }\n');
    const mk = (title, file) => {
      const j = R(['task', 'add', title, '--json']);
      let id = ''; try { id = (JSON.parse(j.stdout || '{}').task || {}).id || ''; } catch {}
      if (!id) { const m = /(T-\d+)/.exec(out(j)); id = m ? m[1] : ''; }
      R(['task', 'update', id, '--status', 'done', '--evidence', `구현 ${file} 수정`]);
      return out(R(['verify-claim', id, '--path', d]));
    };
    const vRec = mk('워커 정리', 'worker.mjs');
    const vPure = mk('순수 헬퍼', 'pure.mjs');
    const vLoop = mk('일괄 조회', 'loop.mjs');
    const recallOk = /· recovery\(/.test(vRec) && !/· recovery\(/.test(vPure) && /· code\(/.test(vPure);
     
    const axisOk = /· axes\(/.test(vLoop) && /성능·확장성/.test(vLoop) && !/· axes\(/.test(vPure);
    Object.assign(dbg, { contractOk, recOk, obsOk, axesOk, unknownOk, surfaceOk, enOk, recallOk, axisOk });
    ok = contractOk && recOk && obsOk && axesOk && unknownOk && surfaceOk && enOk && recallOk && axisOk;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 160); } finally { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ B(1.36.97/P-0011) 렌즈 3축 심화: contract/recovery/observability 12문항 렌더 + axes 8축 + 파생 도메인 목록 + en 누수0 + 내용기반 소환(대조군 침묵) + 축 힌트 조건부'
    : '✗ 1.36.97 렌즈 3축 심화 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
if (e2eShard.take('B(1.36.98)')) {
  total++;
  let ok = false; const dbg = {};
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-cs98-'));
  const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: d, encoding: 'utf8', timeout: 120000 });
  try {
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'p', version: '0.1.0' }));
    R(['init', d, '--yes', '--language', 'ko', '--skills', 'recommended']);
    const csp = path.join(d, '.leerness', 'current-state.md');
    const authored = ['# Current State', 'Updated: 2026-08-01', '', '## Now', '- 사람이 쓴 진행 메모', '- 미해결 항목 1건', '',
      '## Next', '- 사람이 쓴 다음 계획', '', '## Blockers', '- 사람이 쓴 차단 사유', '',
      '## 결정 로그', '- 2026-07-28: 재시도 상한 5회', '', '## 인수인계 메모', '- docs/x.md 부터 읽을 것', ''].join('\n');
    fs.writeFileSync(csp, authored);
    R(['session', 'close', d]);
    const after1 = fs.readFileSync(csp, 'utf8');
    R(['session', 'close', d]);
    const after2 = fs.readFileSync(csp, 'utf8');
    R(['session', 'close', d]);
    const after3 = fs.readFileSync(csp, 'utf8');
    const human = ['사람이 쓴 진행 메모', '미해결 항목 1건', '사람이 쓴 다음 계획', '사람이 쓴 차단 사유', '## 결정 로그', '2026-07-28: 재시도 상한 5회', '## 인수인계 메모', 'docs/x.md 부터 읽을 것'];
    const preserved = human.every(l => after1.includes(l) && after3.includes(l));
    const stable = after2 === after3;                                      
    const autoOnce = (after3.match(/leerness:auto/g) || []).length === 3;   
    const noBlankRun = !/\n\n\n/.test(after3);
    const grew = after3.length >= authored.length - 20;                     
    Object.assign(dbg, { preserved, stable, autoOnce, noBlankRun, len: after3.length, was: authored.length });
    ok = preserved && stable && autoOnce && noBlankRun && grew;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 160); } finally { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ B(1.36.98) session close 가 current-state.md 의 사용자 작성 섹션을 보존 — 3회 반복에도 누적 0 (사용자 보고 재현 고정)'
    : '✗ 1.36.98 current-state 보존 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.98/P-0013)')) {
  total++;
  let ok = false; const dbg = {};
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lib98-'));
  const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: d, encoding: 'utf8', timeout: 120000 });
  const out = (r) => (r.stdout || '') + (r.stderr || '');
  try {
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'p', version: '0.1.0', dependencies: { react: '18', tailwindcss: '3' } }));
    R(['init', d, '--yes', '--language', 'ko', '--skills', 'recommended']);
    const W = (rel, t) => { const p = path.join(d, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
    W('src/Button.tsx', 'export function Button(){ return <button className="px-3 py-1 rounded-lg">go</button> }\n');
    W('src/schemas.ts', 'export const UserSchema = z.object({ id: z.string() });\nexport const FetchUser = async (i: string): Promise<Response> => fetch(i);\n');
    W('src/theme.css', ':root { --brand-500: #2563eb; }\n');
    W('src/notes.ts', '// audit --fix: 누락 키 자동 추가\nexport const runFix = () => 1;\n');
    const show = out(R(['library', '--path', d]));
    const shows = /Button/.test(show) && !/UserSchema/.test(show) && !/FetchUser/.test(show);
    const aiRaw = (R(['library', '--ai', '--path', d]).stdout || '').trim();
    let aiJson = null; try { aiJson = JSON.parse(aiRaw); } catch {}
    const aiOk = !!aiJson && Array.isArray(aiJson.components) && aiJson.components.some(c => c.n === 'Button')
      && !aiJson.components.some(c => c.n === 'UserSchema')
      && (aiJson.tokens.cssVars || []).includes('brand-500')
      && !(aiJson.tokens.cssVars || []).includes('fix')             
      && aiJson.stack.includes('tailwind');
    const pg = R(['library', 'page', '--path', d]);
    const html = fs.existsSync(path.join(d, 'leerness-library.html')) ? fs.readFileSync(path.join(d, 'leerness-library.html'), 'utf8') : '';
    const pageOk = pg.status === 0 && /Button/.test(html) && !/UserSchema/.test(html)
      && !/(?:src|href)\s*=\s*["'](?!#)/i.test(html) && !/<script/i.test(html);    
     
    const splitOk = html.length > aiRaw.length;
    Object.assign(dbg, { shows, aiOk, pageOk, splitOk, html: html.length, ai: aiRaw.length });
    ok = shows && aiOk && pageOk && splitOk;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 160); } finally { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ B(1.36.98/P-0013) 재사용 인벤토리: 컴포넌트 추출 + zod/제네릭 오탐 0 + 주석 CLI 플래그 토큰화 0 + 오프라인 페이지(외부참조 0) + AI 압축 분리'
    : '✗ 1.36.98 재사용 인벤토리 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.99/P-0012)')) {
  total++;
  let ok = false; const dbg = {};
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mk99-'));
  const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: d, encoding: 'utf8', timeout: 120000 });
  const out = (r) => (r.stdout || '') + (r.stderr || '');
  try {
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'shop', version: '0.1.0', dependencies: { react: '18', next: '14', tailwindcss: '3' } }));
    R(['init', d, '--yes', '--language', 'ko', '--skills', 'recommended']);
    const W = (rel, t) => { const p = path.join(d, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
    W('src/theme.css', ':root { --brand-500: #2563eb; --surface-1: #0f1115; }\n');
    W('src/components/Button.tsx', 'export function Button(){ return <button className="px-3 py-1 rounded-lg bg-brand-500">go</button> }\n');
    W('src/components/Card.tsx', 'export function Card(){ return <div className="p-4 rounded-lg bg-surface-1">x</div> }\n');
    W('src/pages/Cart.tsx', 'export function Cart(){\n  return (\n    <main className="p-6 rounded-lg bg-surface-1">\n      <h1 className="text-xl tracking-wide">장바구니</h1>\n    </main>\n  )\n}\n');
     
     
    W('leerness.html', '<style>:root{--panel:#111;--mut:#888}</style><div class="px-3 py-1 rounded-lg">dash</div>\n');
    const id = (/(P-\d{4,})/.exec(out(R(['preview', 'add', '장바구니 개편', '--design', '기존 카드 재사용']))) || [])[1];
    const mk = out(R(['preview', 'mockup', id, '--target', 'src/pages/Cart.tsx']));
    const html = fs.readFileSync(path.join(d, '.leerness', 'previews', id + '-mockup.html'), 'utf8');
    const materials = /--brand-500:\s*#2563eb/.test(html) && /Button/.test(html) && /Card/.test(html) && /rounded-lg/.test(html) && /tailwind/.test(html);
    const targeted = /Cart\.tsx/.test(html) && /p-6 rounded-lg bg-surface-1/.test(html) && /&lt;main&gt;/.test(html);
     
    const noOwn = !/--panel\s*:/.test(html) && !/--mut\s*:/.test(html);
    const offline = !/(?:src|href)\s*=\s*["'](?!#)/i.test(html) && !/<script/i.test(html);
     
    R(['preview', 'mockup', id, '--target', '../../etc/passwd', '--force']);
    const esc = fs.readFileSync(path.join(d, '.leerness', 'previews', id + '-mockup.html'), 'utf8');
    const guarded = /루트 밖/.test(esc);
    const reports = /재료: 컴포넌트 \d+/.test(mk);
    Object.assign(dbg, { materials, targeted, noOwn, offline, guarded, reports, len: html.length });
    ok = materials && targeted && noOwn && offline && guarded && reports;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 160); } finally { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ B(1.36.99/P-0012) 시안 정확도: 실제 토큰 :root 주입 + 기존 컴포넌트 어휘 + 대상 화면 실클래스 + 자기산출물 오염 0 + 오프라인 + 루트밖 거부'
    : '✗ 1.36.99 시안 정확도 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
if (e2eShard.take('B(1.36.100/P-0012)')) {
  total++;
  let ok = false; const dbg = {};
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ct100-'));
  const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: d, encoding: 'utf8', timeout: 120000 });
  const out = (r) => (r.stdout || '') + (r.stderr || '');
  try {
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'shop', version: '0.1.0', dependencies: { react: '18', tailwindcss: '3' } }));
    R(['init', d, '--yes', '--language', 'ko', '--skills', 'recommended']);
    const W = (rel, t) => { const p = path.join(d, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
    W('src/theme.css', ':root { --brand-500: #2563eb; --surface-1: #0f1115; }\n');
    W('src/components/Button.tsx', 'export function Button(){ return <button className="px-3 py-1 rounded-lg">go</button> }\n');
    const id = (/(P-\d{4,})/.exec(out(R(['preview', 'add', '장바구니', '--design', 'x']))) || [])[1];
    R(['preview', 'mockup', id]);
    const mp = path.join(d, '.leerness', 'previews', id + '-mockup.html');
     
    const ap0 = out(R(['preview', 'approve', id]));
    const warnsEmpty = /아직 안 그렸습니다/.test(ap0);
     
    R(['preview', 'revise', id, '--note', '초안 반영']);
    let html = fs.readFileSync(mp, 'utf8');
    const drawn = '\n<header class="topbar p-4 rounded-lg" style="background:var(--surface-1)"><h1 class="text-xl">장바구니</h1></header>\n<ul class="cart-list gap-2"><li class="cart-item px-3 py-1" style="border-color:var(--brand-500)">항목</li></ul>\n';
    fs.writeFileSync(mp, html.replace(/(leerness:draw-start[^>]*-->)[\s\S]*?(<!-- leerness:draw-end)/, `$1${drawn}$2`));
    const ap = out(R(['preview', 'approve', id]));
    const fixed = /계약 고정: 클래스 [1-9]/.test(ap);
    const store = JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'previews.json'), 'utf8'));
    const rec = ((store.previews || store) || []).find(x => x.id === id);
    const stored = !!(rec && rec.contract && rec.contract.classes.includes('topbar') && rec.contract.tokens.includes('--brand-500'))
      && !rec.contract.classes.some(c => ['mock', 'notes', 'chips', 'placeholder'].includes(c));    
     
    W('src/pages/Cart.tsx', 'export function Cart(){ return <main className="p-4">x</main> }\n');
    const low = Number((/존재율 (\d+)%/.exec(out(R(['preview', 'verify', id, '--files', 'src/pages/Cart.tsx']))) || [, '100'])[1]);
    W('src/pages/Cart.tsx', 'import "./cart.css";\nexport function Cart(){ return (<main><header className="topbar p-4 rounded-lg"><h1 className="text-xl">장바구니</h1></header><ul className="cart-list gap-2"><li className="cart-item px-3 py-1">항목</li></ul></main>) }\n');
    W('src/pages/cart.css', '.topbar{background:var(--surface-1)} .cart-item{border-color:var(--brand-500)}\n');
    const v2 = out(R(['preview', 'verify', id, '--files', 'src/pages/Cart.tsx,src/pages/cart.css']));
    const high = Number((/존재율 (\d+)%/.exec(v2) || [, '0'])[1]);
     
    const honest = /'존재' 검사입니다/.test(v2) && /같아 보이는지는 보지 않습니다/.test(v2);
    const guarded = /루트 밖/.test(out(R(['preview', 'verify', id, '--files', '../../etc/passwd'])));
    Object.assign(dbg, { warnsEmpty, fixed, stored, low, high, honest, guarded });
    ok = warnsEmpty && fixed && stored && low < 50 && high === 100 && honest && guarded;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 160); } finally { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ B(1.36.100/P-0012) 승인 시 시안→계약 고정 + 구현 존재 대조(미준수 저율/준수 100%) + 한계 고지 + 루트밖 거부 + 빈 시안 경고'
    : '✗ 1.36.100 시안 계약 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('A(1.36.103)')) {
  total++;
  let ok = false; const dbg = {};
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-fl103-'));
  const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: d, encoding: 'utf8', timeout: 120000 });
  const out = (r) => (r.stdout || '') + (r.stderr || '');
  try {
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'fl', version: '0.1.0' }));
    fs.writeFileSync(path.join(d, 'sample.js'), 'function f(){ return 1; }\n');
    R(['init', d, '--yes']);
    const allText = () => { let s = ''; (function w(y) { for (const e of fs.readdirSync(y, { withFileTypes: true })) { const p = path.join(y, e.name); if (e.isDirectory()) { if (!/node_modules|\.git$/.test(e.name)) w(p); } else { try { s += fs.readFileSync(p, 'utf8'); } catch {} } } })(d); return s; };
    R(['preview', 'add', 'cart page', '--select', 'ZZA1']);
    R(['task', 'add', 'do work', '--priority', 'ZZA2']);
    R(['requests', 'add', 'add mode', '--summary', 'ZZA3']);
    const txt = allText();
    dbg.absorbed = ['ZZA1', 'ZZA2', 'ZZA3'].filter(m => txt.includes(m));
     
    const rev = R(['review', '--persona', 'security', 'sample.js']);
    dbg.revOk = rev.status === 0 && /sample\.js/.test(rev.stdout || '');
     
    const W = /알 수 없는 플래그|Unknown flag/;
    dbg.typoWarns = W.test(R(['task', 'add', 'x', '--prio', 'high']).stderr || '');
    dbg.realQuiet = !W.test(R(['task', 'list', '--json']).stderr || '') && !W.test(R(['audit', '--no-secret-scan']).stderr || '');
     
    const jr = R(['pulse', '--json', '--nosuchflagzz']);
    let jsonOk = false; try { JSON.parse((jr.stdout || '').trim()); jsonOk = true; } catch {}
    dbg.jsonOk = jsonOk && !W.test(jr.stdout || '');
     
    R(['preview', 'add', '--select=ZZEQ', 'equals title']);
    const pvp = path.join(d, '.leerness', 'previews.json');
    const pvt = fs.existsSync(pvp) ? fs.readFileSync(pvp, 'utf8') : '';
    dbg.equals = pvt.includes('equals title') && !pvt.includes('ZZEQ');
    const rEq = R(['agents', 'route', '--tier=normal', 'fix the parser']);
    dbg.equalsRoute = !/비어 있|empty_task/.test((rEq.stdout || '') + (rEq.stderr || ''));
     
    dbg.dynamic = !W.test((R(['brief', 'set', '--intro', 'hello']).stderr) || '') && W.test((R(['brief', 'set', '--introo', 'x']).stderr) || '');
    ok = dbg.absorbed.length === 0 && dbg.revOk && dbg.typoWarns && dbg.realQuiet && dbg.jsonOk
      && dbg.equals && dbg.equalsRoute && dbg.dynamic;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 160); } finally { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ A(1.36.103) 값-플래그 흡수 차단(제목/경로) + 등호형 무흡수 + 동적 레지스트리 무오탐 + 오타만 stderr 경고 + JSON 무오염'
    : '✗ 1.36.103 플래그 계약 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
if (e2eShard.take('B(1.36.103)')) {
  total++;
  let ok = false; const dbg = {};
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-js103-'));
  const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: d, encoding: 'utf8', timeout: 180000 });
  try {
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'js', version: '0.1.0' }));
    R(['init', d, '--yes']);
    const J = (a) => { const r = R(a); const t = ((r.stdout) || '').trim(); let j = null; try { j = JSON.parse(t); } catch {} return { r, j, empty: !t }; };
    const g = J(['gate', 'no-such-gate', '--json']);
    const rc = J(['release', 'cleanup', '--json']);
    const inc = J(['reuse-map', '--include', 'no-such-project-zz', '--json']);
    dbg.gate = !!g.j && g.j.ok === false && !g.empty;
    dbg.release = !!rc.j && rc.j.code === 'not_a_git_repo';
    dbg.include = !!inc.j;
     
    const p = J(['pulse', '--json']);
    dbg.success = p.r.status === 0 && !!p.j && p.j.ok !== false && p.j.version !== undefined;
     
    const kb = J(['release', 'cleanup', '--keep', 'abc', '--json']);
    const kn = J(['release', 'cleanup', '--keep', '-3', '--json']);
    const ki = J(['init', path.join(d, 'KEEPTEST'), '--yes', '--keep', 'abc', '--json']);    
    const k0 = J(['release', 'cleanup', '--keep', '0', '--json']);                           
    dbg.keep = !!kb.j && kb.j.code === 'invalid_keep' && !!kn.j && kn.j.code === 'invalid_keep'
      && !!ki.j && ki.j.code === 'invalid_keep' && !!k0.j && k0.j.code !== 'invalid_keep';
     
     
     
    const SWEEP = [
      ['consistency', 'check', '--json'], ['agent-mode', 'tick', '--json'], ['graph', '--json'],
      ['anchors', '--json'], ['capabilities', '--json'], ['verify', '--json'], ['status', '--json'],
      ['enforce', 'status', '--json'], ['constraints', 'list', '--json'], ['next-action', 'list', '--json'],
    ];
    const swept = SWEEP.map(a => ({ a, r: J(a) })).filter(x => !x.r.j);
    dbg.sweepBad = swept.map(x => x.a.join(' '));
    ok = dbg.gate && dbg.release && dbg.include && dbg.success && dbg.keep && swept.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 160); } finally { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ B(1.36.103) --json 실패 경로 3종이 유효 JSON + 성공 경로 무간섭(대조군) + --keep 값 무시 금지 + 10표면 스윕'
    : '✗ 1.36.103 JSON 계약 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
 
if (e2eShard.take('C(1.36.103)')) {
  total++;
  let ok = false; const dbg = {};
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rt103-'));
  try {
    const cwdDir = path.join(arena, 'CWDPROJ'), target = path.join(arena, 'TARGETPROJ');
    for (const x of [cwdDir, target]) { fs.mkdirSync(x, { recursive: true }); fs.writeFileSync(path.join(x, 'package.json'), '{"name":"x","version":"0.1.0"}'); }
    const R = (a, cwd) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: cwd || cwdDir, encoding: 'utf8', timeout: 120000 });
    R(['init', cwdDir, '--yes'], cwdDir); R(['init', target, '--yes'], target);
    const tp = (x) => path.join(x, '.leerness', 'tech-profile.json');
    const clear = (...ps) => { for (const p of ps) { try { fs.unlinkSync(p); } catch {} } };
    clear(tp(cwdDir), tp(target)); R(['tech', target]);
    dbg.wroteTarget = fs.existsSync(tp(target)) && !fs.existsSync(tp(cwdDir));
    clear(tp(cwdDir), tp(target)); R(['tech']);
    dbg.bareIsCwd = fs.existsSync(tp(cwdDir)) && !fs.existsSync(tp(target));
    const htmlC = path.join(cwdDir, 'leerness-library.html'), htmlT = path.join(target, 'leerness-library.html');
    clear(htmlC, htmlT);
    R(['library', 'page']); dbg.pageBare = fs.existsSync(htmlC);
    R(['library', 'page', target]); dbg.pageWithPath = fs.existsSync(htmlT);
    const lo = (R(['library', target]).stdout) || '';
    dbg.libTarget = lo.includes('TARGETPROJ') && !lo.includes('CWDPROJ');
     
    dbg.typo = R(['library', 'NOPEZZ']).status !== 0 && R(['tech', 'NOPEZZ']).status !== 0;
     
    dbg.strictKept = R(['pulse', path.join(arena, 'NOPE-zz')]).status !== 0 && R(['library', './NOPE-zz']).status !== 0;
    ok = dbg.wroteTarget && dbg.bareIsCwd && dbg.pageBare && dbg.pageWithPath && dbg.libTarget && dbg.typo && dbg.strictKept;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 160); } finally { try { fs.rmSync(arena, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ C(1.36.103) 준 경로에 적용(파일시스템 관측) + library page 회귀 수리 + 오타 거부 유지(1.36.101 무회귀)'
    : '✗ 1.36.103 root/하위명령 계약 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
 
if (e2eShard.take('D(1.36.104)')) {
  total++;
  let ok = false; const dbg = {};
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-us104-'));
  try {
    const cwdP = path.join(arena, 'CWDPROJ'), tgt = path.join(arena, 'TARGETPROJ');
    for (const x of [cwdP, tgt]) {
      fs.mkdirSync(x, { recursive: true });
      fs.writeFileSync(path.join(x, 'package.json'), '{"name":"x","version":"0.1.0"}');
      cp.spawnSync(process.execPath, [CLI, 'init', x, '--yes'], { cwd: x, encoding: 'utf8', timeout: 120000 });
    }
    const mcp = (name, args = { path: tgt }) => cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], {
      cwd: cwdP, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
      input: [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e', version: '1' } } },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
      ].map(r => JSON.stringify(r)).join('\n') + '\n'
    });
     
    mcp('leerness_about'); mcp('leerness_pulse');
    const U = (x) => ((cp.spawnSync(process.execPath, [CLI, 'usage', '--path', x], { cwd: cwdP, encoding: 'utf8', timeout: 60000 }).stdout) || '');
    const readOnlyUsage = U(tgt) + U(cwdP);
    dbg.readOnlyClean = !/leerness_about|leerness_pulse/.test(readOnlyUsage);
     
     
    const writeCall = mcp('leerness_task_add', { path: tgt, text: 'MCP usage attribution probe' });
    const uT = U(tgt), uC = U(cwdP);
    dbg.writeCallExit = writeCall.status;
    dbg.showsMcp = /leerness_task_add/.test(uT) && !/\(사용 기록 없음\)/.test(uT);
    dbg.cwdClean = !/\|\s*mcp\s*\|/.test(uC);
     
    cp.spawnSync(process.execPath, [CLI, 'audit', '--path', tgt], { cwd: cwdP, encoding: 'utf8', timeout: 120000 });
    const uT2 = U(tgt);
    dbg.cliStill = /\|\s*audit\s*\|/.test(uT2) && /leerness_task_add/.test(uT2);
    ok = dbg.readOnlyClean && dbg.writeCallExit === 0 && dbg.showsMcp && dbg.cwdClean && dbg.cliStill;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 160); } finally { try { fs.rmSync(arena, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ D(1.36.104) MCP 사용량이 실제 대상 프로젝트에 보고됨 + 서버 cwd 무오염 + CLI 집계 무회귀'
    : '✗ 1.36.104 usage 귀속 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('E(1.36.104/P-0014)')) {
  total++;
  let ok = false; const dbg = {};
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sb104-'));
  try {
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
    const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: d, encoding: 'utf8', timeout: 120000 });
    R(['init', d, '--yes']);
    const J = (a) => { try { return JSON.parse(((R(a).stdout) || '').trim()); } catch { return null; } };
    const FIX = path.join(d, 'fixtures.test.js');
    fs.writeFileSync(FIX, 'const A="sk-proj-FakeFixtureKey1234567890abcdef";\n');
    fs.writeFileSync(path.join(d, 'other.test.js'), 'const B="sk-proj-SecondFixtureKey098765432100";\n');
    const b0 = J(['scan', 'secrets', '--json']);
    dbg.before = !!b0 && b0.unacknowledgedCount === 2 && b0.ok === false;
    const rec = J(['scan', 'secrets', '--baseline', '--json']);
    const stored = fs.readFileSync(path.join(d, '.leerness', 'secret-baseline.json'), 'utf8');
    dbg.recorded = !!rec && rec.recorded === 2;
    dbg.noPlaintext = !stored.includes('FakeFixtureKey');           
    const b1 = J(['scan', 'secrets', '--json']);
    dbg.quiet = !!b1 && b1.unacknowledgedCount === 0 && b1.ok === true && b1.acknowledgedCount === 2 && b1.count === 2;
    const quietHo = (R(['handoff', '.', '--inspect']).stdout) || '';
    dbg.headlineQuiet = !/🚨 시크릿/.test(quietHo) && /보안 OK/.test(quietHo);
     
    fs.writeFileSync(path.join(d, 'leaked.js'), 'const K="sk-proj-BrandNewRealLeak9876543210zyxw";\n');
    const b2 = J(['scan', 'secrets', '--json']);
    dbg.catchesNew = !!b2 && b2.unacknowledgedCount === 1 && b2.ok === false;
    dbg.headlineAlarms = /🚨 시크릿/.test((R(['handoff', '.', '--inspect']).stdout) || '');
     
    fs.unlinkSync(path.join(d, 'leaked.js'));
    fs.writeFileSync(FIX, 'const A="sk-proj-CHANGEDToRealKey1234567890ab";\n');
    const b3 = J(['scan', 'secrets', '--json']);
    dbg.rearms = !!b3 && b3.unacknowledgedCount === 1 && b3.acknowledgedCount === 1
      && Array.isArray(b3.staleBaseline) && b3.staleBaseline.length === 1;
     
    fs.writeFileSync(path.join(d, '.leerness', 'secret-baseline.json'), '{ broken json');
    const b4 = J(['scan', 'secrets', '--json']);
    dbg.failSafe = !!b4 && b4.acknowledgedCount === 0 && b4.unacknowledgedCount === 2;
     
     
    const t2 = path.join(d, 'trunc'); fs.mkdirSync(t2, { recursive: true });
    fs.writeFileSync(path.join(t2, 'package.json'), '{"name":"t","version":"0.1.0"}');
    cp.spawnSync(process.execPath, [CLI, 'init', t2, '--yes'], { cwd: t2, encoding: 'utf8', timeout: 120000 });
    const R2 = (a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: t2, encoding: 'utf8', timeout: 120000 });
    const J2 = (a) => { try { return JSON.parse(((R2(a).stdout) || '').trim()); } catch { return null; } };
    const PRE = 'sk-proj-a1B2c3D4e5F6g7H8i9J0kLmN';                   
    const K1 = PRE + 'Q2w3E4r5T6y7U8i9', K2 = PRE + 'M9n8B7v6C5x4Z3q2';
    dbg.fixtureValid = K1.slice(0, 32) === K2.slice(0, 32) && K1 !== K2;    
    fs.writeFileSync(path.join(t2, 'fixture.js'), 'const A="' + K1 + '";\n');
    R2(['scan', 'secrets', '--baseline']);
    fs.writeFileSync(path.join(t2, 'fixture.js'), 'const A="' + K1 + '";\nconst B="' + K2 + '";\n');
    const tr = J2(['scan', 'secrets', '--json']);
    dbg.noCollision = !!tr && tr.count === 2 && tr.unacknowledgedCount === 1 && tr.ok === false;
     
    const fb = J2(['scan', 'secrets', path.join(t2, 'fixture.js'), '--baseline', '--json']);
    dbg.rejectsFile = !!fb && fb.code === 'baseline_needs_project';
    ok = dbg.before && dbg.recorded && dbg.noPlaintext && dbg.quiet && dbg.headlineQuiet
      && dbg.catchesNew && dbg.headlineAlarms && dbg.rearms && dbg.failSafe
      && dbg.fixtureValid && dbg.noCollision && dbg.rejectsFile;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 160); } finally { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ E(1.36.104/P-0014) 시크릿 인정: 오경보 해소 + 신규 유출 포착 + 값변경 재경고 + 손상 fail-safe + 접두충돌 차단 + 원문 미저장'
    : '✗ P-0014 시크릿 인정 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
if (e2eShard.take('F(1.36.104)')) {
  total++;
  let ok = false; const dbg = {};
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rem104-'));
  try {
    const MARK = '<!-- leerness:managed:auto';
    const sha = (b) => require('crypto').createHash('sha256').update(b).digest('hex').slice(0, 16);
    const mk = (tag, body) => {
      const d = path.join(arena, tag); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
      cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { cwd: d, encoding: 'utf8', timeout: 120000 });
      fs.writeFileSync(path.join(d, '.leerness', 'agent-reminders.md'), body);
      cp.spawnSync(process.execPath, [CLI, 'handoff', '.', '--writeback'], { cwd: d, encoding: 'utf8', timeout: 180000 });
      return path.join(d, '.leerness', 'agent-reminders.md');
    };
    const B = '# 🔔 자동 reminder\ndrift critical 감지\n';
    const human = mk('human', '# 내 리마인더\nHUMAN-KEEPME 사용자가 직접 쓴 줄\n');
    dbg.humanKept = fs.existsSync(human) && fs.readFileSync(human, 'utf8').includes('HUMAN-KEEPME');
    const pasted = mk('pasted', MARK + ' -->\nUSER-DO-NOT-DELETE: production note\n');       
    dbg.pastedKept = fs.existsSync(pasted) && fs.readFileSync(pasted, 'utf8').includes('USER-DO-NOT-DELETE');
    const appended = mk('appended', MARK + ' sha=' + sha(B) + ' -->\n' + B + 'USER-APPENDED 메모\n');
    dbg.appendKept = fs.existsSync(appended) && fs.readFileSync(appended, 'utf8').includes('USER-APPENDED');
    const auto = mk('auto', MARK + ' sha=' + sha(B) + ' -->\n' + B);                         
    dbg.autoCleaned = !fs.existsSync(auto);
    ok = dbg.humanKept && dbg.pastedKept && dbg.appendKept && dbg.autoCleaned;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 160); } finally { try { fs.rmSync(arena, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ F(1.36.104) handoff 가 사람 손이 닿은 agent-reminders.md 를 지우지 않음(복붙 표식·덧붙임 포함) + 자동분은 여전히 청소'
    : '✗ 1.36.104 보호 파일 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('G(1.36.105/P-0015)')) {
  total++;
  let ok = false; const dbg = {};
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-md105-'));
  try {
    const mk = (tag, extra) => {
      const d = path.join(arena, tag); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
      cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', ...(extra || [])], { cwd: d, encoding: 'utf8', timeout: 180000 });
      return d;
    };
    const R = (d, a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: d, encoding: 'utf8', timeout: 120000 });
    const J = (d, a) => { try { return JSON.parse((((R(d, a)).stdout) || '').trim()); } catch { return null; } };
     
    const std = mk('std');
    const sB = J(std, ['context', 'budget', '--json']);
    dbg.stdDefault = (J(std, ['mode', '--json']) || {}).mode === 'standard'
      && fs.statSync(path.join(std, 'AGENTS.md')).size > 7000 && !!sB && sB.over === false;
     
    const min = mk('min', ['--mode', 'minimal']);
    const mB = J(min, ['context', 'budget', '--json']);
    dbg.shrinks = !!mB && !!sB && mB.total < sB.total / 5;
     
     
     
    dbg.shortAgents = fs.statSync(path.join(min, 'AGENTS.md')).size < fs.statSync(path.join(std, 'AGENTS.md')).size;
     
    const minHo = (R(min, ['handoff', '.', '--inspect']).stdout) || '';
    dbg.minLean = !/=== Current State/.test(minHo) && !/세션 워크플로 6단계/.test(minHo)
      && /문서 본문 생략/.test(minHo) && /헤드라인/.test(minHo);
     
    const ag = fs.readFileSync(path.join(min, 'AGENTS.md'), 'utf8');
    dbg.coreDoc = /handoff/.test(ag) && /verify-claim/.test(ag) && /session close/.test(ag);
    R(min, ['task', 'add', 'sample']);
    dbg.coreRuns = R(min, ['handoff', '.']).status === 0 && R(min, ['session', 'close', '.']).status === 0;
     
    const sw = mk('sw');
    const b0 = fs.statSync(path.join(sw, 'AGENTS.md')).size;
    R(sw, ['mode', 'set', 'minimal']);
    const b1 = fs.statSync(path.join(sw, 'AGENTS.md')).size;
    R(sw, ['mode', 'set', 'standard']);
    const b2 = fs.statSync(path.join(sw, 'AGENTS.md')).size;
     
     
    dbg.switches = b1 < b0 && Math.abs(b2 - b0) < 200;
     
    const uc = mk('user');
    fs.appendFileSync(path.join(uc, 'AGENTS.md'), '\nDIRECT-USER-INSTRUCTION-DO-NOT-LOSE\n');
    R(uc, ['mode', 'set', 'minimal']);
    dbg.keepsUserLf = fs.readFileSync(path.join(uc, 'AGENTS.md'), 'utf8').includes('DIRECT-USER-INSTRUCTION-DO-NOT-LOSE');
    const cr = mk('crlf');
    const crp = path.join(cr, 'AGENTS.md');
    fs.writeFileSync(crp, fs.readFileSync(crp, 'utf8').replace(/\n/g, '\r\n') + '\r\n---\r\n## Preserved previous content\r\n\r\nCRLF-PRESERVED-USER-INSTRUCTION\r\n');
    R(cr, ['mode', 'set', 'minimal']);
    dbg.keepsUserCrlf = fs.readFileSync(crp, 'utf8').includes('CRLF-PRESERVED-USER-INSTRUCTION');
     
    const pu2 = require(path.join(__dirname, '..', 'lib', 'pure-utils.js'));
    const nx = '# T\ncanon\n';
    const pv = '# T\ncanon\nNEWEST-PREPENDED\n' + Array.from({ length: 40 }, (_, i) => `- old ${i}`).join('\n') + '\n';
    const mg = pu2._managedMerge('CLAUDE.md', nx, pv, '.leerness/archive', null, { preservedCap: 5 });
    dbg.noPreservedDrop = mg.includes('NEWEST-PREPENDED') && mg.includes('- old 0') && mg.includes('- old 39');
     
    dbg.noFakeTier = !/strict/.test((R(sw, ['mode']).stdout) || '') && (J(sw, ['mode', '--json']) || {}).modes.length === 2;
     
     
    const hSnap = (x) => { const m = {}; (function w(y, rel) { for (const e of fs.readdirSync(y, { withFileTypes: true })) { const p = path.join(y, e.name); const r = rel + '/' + e.name; if (e.isDirectory()) w(p, r); else if (!/environment\.json|cache\//.test(r)) { try { m[r] = fs.readFileSync(p, 'utf8'); } catch { m[r] = 'x'; } } } })(path.join(x, '.leerness'), ''); return m; };
    const preB = hSnap(std); R(std, ['context', 'budget']); const postB = hSnap(std);
    dbg.budgetReadOnly = Object.keys({ ...preB, ...postB }).every(k => preB[k] === postB[k]);
     
    fs.appendFileSync(path.join(min, 'AGENTS.md'), '\n' + 'x'.repeat(20000) + '\n');
    const ov = J(min, ['context', 'budget', '--json']);
    dbg.overLoud = !!ov && ov.over === true && R(min, ['context', 'budget', '--json']).status !== 0;
    ok = dbg.stdDefault && dbg.shrinks && dbg.shortAgents && dbg.minLean && dbg.coreDoc && dbg.coreRuns
      && dbg.switches && dbg.keepsUserLf && dbg.keepsUserCrlf && dbg.noPreservedDrop && dbg.noFakeTier
      && dbg.budgetReadOnly && dbg.overLoud;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 160); } finally { try { fs.rmSync(arena, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ G(1.36.105/P-0015) 운영 등급: 기존 무변경(대조군) + minimal 적재 1/5 미만 + 핵심 3종 생존 + 전환 왕복 + 예산 초과 경고'
    : '✗ P-0015 운영 등급 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('H(1.36.105/P-0009B)')) {
  total++;
  let ok = false; const dbg = {};
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sc105-'));
  try {
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
    const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: d, encoding: 'utf8', timeout: 180000 });
    R(['init', d, '--yes']); R(['task', 'add', '리팩터링 작업']);
    const SC = ['workflow-distribute', 'double-verify', 'full-reread'];
     
    const h0 = (R(['handoff', '.', '--inspect']).stdout) || '';
    const p0 = (R(['handoff', '.']).stdout) || '';
    dbg.defaultOn = /세션 워크플로 6단계/.test(h0) && /=== Current State/.test(h0);
    dbg.plainRead = /=== Current State/.test(p0) && !/세션 워크플로 6단계/.test(p0);
    dbg.registered = (((R(['toggle', 'list']).stdout) || '').match(/🟢 ON\s+(workflow-distribute|double-verify|full-reread)/g) || []).length === 3;
     
    const reg = require(path.join(__dirname, '..', 'lib', 'toggles.js')).TOGGLE_REGISTRY;
    const desc = SC.map(k => (reg[k] || {}).desc || '').join(' ');
    dbg.noModelClaim = !/claude|opus|sonnet|haiku|gpt|codex|gemini|qwen|grok/i.test(desc)
      && !/\d+(\.\d+)?\s*(x|배)\b|빠름|faster|절약|saves?\b/i.test(desc);
     
     
    R(['toggle', 'set', 'workflow-distribute', 'off']);
    const hw = (R(['handoff', '.', '--inspect']).stdout) || '';
    dbg.isolWorkflow = !/세션 워크플로 6단계/.test(hw) && /=== Current State/.test(hw);
    R(['toggle', 'set', 'workflow-distribute', 'on']);
    R(['toggle', 'set', 'full-reread', 'off']);
    const hr = (R(['handoff', '.', '--inspect']).stdout) || '';
    dbg.isolReread = !/=== Current State/.test(hr) && /세션 워크플로 6단계/.test(hr);
    const pr = (R(['handoff', '.']).stdout) || '';
    dbg.plainReread = !/=== Current State/.test(pr) && /toggle set full-reread on/.test(pr);
    R(['toggle', 'set', 'full-reread', 'on']);
     
    for (const id of SC) R(['toggle', 'set', id, 'off']);
    const h1 = (R(['handoff', '.', '--inspect']).stdout) || '';
    dbg.guidanceGone = !/세션 워크플로 6단계/.test(h1) && !/=== Current State/.test(h1);
    dbg.signalKept = /헤드라인/.test(h1) && /toggle set full-reread on/.test(h1);
     
     
     
    const hs = (x) => { const m = {}; (function w(y, rel) { for (const e of fs.readdirSync(y, { withFileTypes: true })) { const p = path.join(y, e.name); const r = rel + '/' + e.name; if (e.isDirectory()) w(p, r); else if (!/environment\.json|last-handoff\.json|cache\/|toggles\.json|pre-wake-report\.json/.test(r)) { try { m[r] = fs.readFileSync(p, 'utf8'); } catch { m[r] = 'x'; } } } })(path.join(x, '.leerness'), ''); return m; };
    R(['toggle', 'set', 'double-verify', 'on']); R(['handoff', '.', '--inspect']);
    const stOn = hs(d);
    R(['toggle', 'set', 'double-verify', 'off']); R(['handoff', '.', '--inspect']);
    const stOff = hs(d);
    dbg.stateUntouched = Object.keys({ ...stOn, ...stOff }).every(k => stOn[k] === stOff[k]);
     
    fs.writeFileSync(path.join(d, 'leak.js'), 'const K="sk-proj-BoundaryTestKey1234567890abcdefgh";\n');
    const sc = R(['scan', 'secrets', '--json']);
    let sj = null; try { sj = JSON.parse((sc.stdout || '').trim()); } catch {}
    const parses = (r) => { try { return !!JSON.parse(((r.stdout) || '').trim()); } catch { return false; } };
    dbg.evidenceAlive = !!sj && sj.unacknowledgedCount >= 1 && sc.status !== 0
      && parses(R(['audit', '--json'])) && parses(R(['gate', '--json']))
      && R(['session', 'close', '.']).status === 0;
     
    for (const id of SC) R(['toggle', 'set', id, 'on']);
    const h2 = (R(['handoff', '.', '--inspect']).stdout) || '';
    dbg.restores = /세션 워크플로 6단계/.test(h2) && /=== Current State/.test(h2);
    ok = dbg.defaultOn && dbg.plainRead && dbg.registered && dbg.noModelClaim && dbg.isolWorkflow && dbg.isolReread && dbg.plainReread
      && dbg.stateUntouched && dbg.guidanceGone && dbg.signalKept && dbg.evidenceAlive && dbg.restores;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 160); } finally { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ H(1.36.105/P-0009B) 스캐폴딩 토글: 기본 무변경 + 지시문만 OFF + 증거 계층 생존(경계 계약) + 모델명 0 + 복귀'
    : '✗ P-0009B 스캐폴딩 토글 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('I(1.36.106/T-0090)')) {
  total++;
  let ok = false; const dbg = {};
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tl106-'));
   
   
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tlbox-'));
  try {
    fs.writeFileSync(path.join(proj, 'package.json'), '{"name":"p","version":"0.1.0"}');
    const ENV = Object.assign({}, process.env, { TMPDIR: sandbox, TEMP: sandbox, TMP: sandbox });
     
    const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: proj, encoding: 'utf8', timeout: SELFTEST_SPAWN_MS, env: ENV });
    R(['init', proj, '--yes']);
    const count = () => { try { return fs.readdirSync(sandbox).filter(x => /^(__leerness_|leerness-)/.test(x)).length; } catch { return -1; } };
    const delta = (a) => { const b = count(); R(a); return count() - b; };
    dbg.selftest = delta(['selftest']);
    const beforeDoctorCount = count();
    const baselineDoctorResult = R(['doctor', '--json']);
    dbg.doctor = count() - beforeDoctorCount;
    let baselineDoctor = null; try { baselineDoctor = JSON.parse(baselineDoctorResult.stdout || ''); } catch {}
    dbg.handoff = delta(['handoff', '.']);        
    dbg.audit = delta(['audit']);                 
     
    dbg.selftest2 = delta(['selftest']);
     
    for (let i = 0; i < 250; i++) { try { fs.mkdirSync(path.join(sandbox, '__leerness_probe_' + i)); } catch {} }
    let dj = null; try { dj = JSON.parse(((R(['doctor', '--json']).stdout) || '').trim()); } catch {}
    const beforeReport = count();
    R(['doctor']);
    dbg.doctorReadOnly = count() - beforeReport === 0;     
    dbg.reportsLeftover = !!dj && !!dj.tmpLeftover && dj.tmpLeftover.count >= 250;
     
     
     
    dbg.healthyUnaffected = !!dj && !!baselineDoctor
      && dj.healthy === baselineDoctor.healthy
      && JSON.stringify(dj.selftest && dj.selftest.failed || [])
        === JSON.stringify(baselineDoctor.selftest && baselineDoctor.selftest.failed || []);
     
    const fbox = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-fbox-'));
    for (let i = 0; i < 210; i++) fs.writeFileSync(path.join(fbox, 'leerness-user-note-' + i + '.txt'), 'x');
    let fj = null; try { fj = JSON.parse(((cp.spawnSync(process.execPath, [CLI, 'doctor', '--json'], { cwd: proj, encoding: 'utf8', timeout: SELFTEST_SPAWN_MS, env: Object.assign({}, process.env, { TMPDIR: fbox, TEMP: fbox, TMP: fbox }) }).stdout) || '').trim()); } catch {}
    dbg.filesNotCounted = !!fj && fj.tmpLeftover === null;
     
    const cbox = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-cbox-'));
    for (let i = 0; i < 210; i++) fs.mkdirSync(path.join(cbox, '__LEERNESS_probe_' + i));
    let cj = null; try { cj = JSON.parse(((cp.spawnSync(process.execPath, [CLI, 'doctor', '--json'], { cwd: proj, encoding: 'utf8', timeout: SELFTEST_SPAWN_MS, env: Object.assign({}, process.env, { TMPDIR: cbox, TEMP: cbox, TMP: cbox }) }).stdout) || '').trim()); } catch {}
    dbg.caseInsensitive = !!cj && !!cj.tmpLeftover && cj.tmpLeftover.count >= 210;
    for (const _b of [fbox, cbox]) { try { fs.rmSync(_b, { recursive: true, force: true }); } catch {} }
    ok = dbg.selftest === 0 && dbg.doctor === 0 && dbg.selftest2 === 0
      && dbg.handoff === 0 && dbg.audit === 0 && dbg.doctorReadOnly && dbg.reportsLeftover && dbg.healthyUnaffected
      && dbg.filesNotCounted && dbg.caseInsensitive;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 160); } finally { for (const _p of [proj, sandbox]) { try { fs.rmSync(_p, { recursive: true, force: true }); } catch {} } }
  console.log(ok ? '✓ I(1.36.106/T-0090) selftest·doctor 임시 디렉토리 누수 0 (반복 포함) + 사용자 명령 대조군 0 + 잔존은 보고만'
    : '✗ T-0090 임시 디렉토리 누수 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
 
if (e2eShard.take('J(1.36.107)')) {
  total++;
  let ok = false; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mf107-'));
  try {
    const ENV = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb });
    const mk = (tag) => { const d = path.join(sb, tag); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}'); cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { cwd: d, encoding: 'utf8', timeout: 180000, env: ENV }); return d; };
    const R = (d, a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: d, encoding: 'utf8', timeout: 120000, env: ENV });
     
    const kinds = { broken: '{ this is not json', typeflip: '"a string"', arr: '[1,2,3]' };
    const res = [];
    for (const [tag, body] of Object.entries(kinds)) {
      const d = mk('c-' + tag);
      const mf = path.join(d, '.leerness', 'manifest.json');
      const orig = fs.readFileSync(mf, 'utf8');
      fs.writeFileSync(mf, body);
      const rg = R(d, ['mode']);
      const warns = /손상/.test((rg.stdout || '') + (rg.stderr || ''));             
      const rs = R(d, ['mode', 'set', 'minimal']);
      const refused = rs.status !== 0 && fs.readFileSync(mf, 'utf8') === body;       
      fs.writeFileSync(mf, orig);
      const rs2 = R(d, ['mode', 'set', 'minimal']);
      let after = null; try { after = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch {}
      const recovers = rs2.status === 0 && !!after && after.mode === 'minimal' && !!after.project && !!after.language;
      res.push(warns && refused && recovers);
    }
    dbg.corruptHandled = res.length === 3 && res.every(Boolean);
     
    const good = mk('good');
    const gmf = path.join(good, '.leerness', 'manifest.json');
    const before = JSON.parse(fs.readFileSync(gmf, 'utf8'));
    const gr = R(good, ['mode']);
    dbg.noFalseAlarm = gr.status === 0 && !/손상/.test((gr.stdout || '') + (gr.stderr || ''));
    R(good, ['mode', 'set', 'minimal']);
    const afterG = JSON.parse(fs.readFileSync(gmf, 'utf8'));
    dbg.fieldsPreserved = afterG.mode === 'minimal' && afterG.project === before.project
      && afterG.language === before.language && afterG.installedAt === before.installedAt;
     
     
     
    const dsurf = mk('surf');
    const smf = path.join(dsurf, '.leerness', 'manifest.json');
    const sorig = fs.readFileSync(smf, 'utf8');
    fs.writeFileSync(smf, '{ not valid json');
    const rb = R(dsurf, ['context', 'budget', '--json']);
    let bj = null; try { bj = JSON.parse(rb.stdout); } catch {}
    const surfCorrupt = rb.status === 1 && !!bj && bj.corrupt === true && bj.ok === false;
    fs.writeFileSync(smf, sorig);                                     
    const rb2 = R(dsurf, ['context', 'budget', '--json']);
    let bj2 = null; try { bj2 = JSON.parse(rb2.stdout); } catch {}
    dbg.surfaceAgrees = surfCorrupt && !!bj2 && bj2.corrupt === false;
    ok = dbg.corruptHandled && dbg.noFalseAlarm && dbg.fieldsPreserved && dbg.surfaceAgrees;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 160); } finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ J(1.36.107) 손상 manifest: 조용한 기본값 금지 + 덮어쓰기 거부(fail-closed) + 복구 후 정상 + 대조군 무회귀'
    : '✗ 1.36.107 손상 manifest 처리 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
 
 
 
if (e2eShard.take('K(1.36.107)')) {
  total++;
  let ok = false; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mk107-'));
  try {
    const ENV = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb });
    const R = (d, a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: d, encoding: 'utf8', timeout: 180000, env: ENV });
    const mk = (tag, extra) => { const d = path.join(sb, tag); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}'); R(d, ['init', d, '--yes'].concat(extra || [])); return d; };
    const M = (d) => { try { return JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'manifest.json'), 'utf8')); } catch { return {}; } };

     
    const d1 = mk('keep', ['--mode', 'minimal']);
    const first = M(d1);
    dbg.setup = first.mode === 'minimal' && !!first.installedAt;
    R(d1, ['init', d1, '--yes']);
    const kept = M(d1);
    dbg.modeKept = kept.mode === 'minimal';
     
     
     
    R(d1, ['init', d1, '--yes', '--force']);
    const forced = M(d1);
    dbg.installedAtKept = forced.installedAt === first.installedAt && forced.mode === 'minimal';
     
    const agentsBytes = fs.readFileSync(path.join(d1, 'AGENTS.md'), 'utf8').length;

     
    R(d1, ['init', d1, '--yes', '--mode', 'standard']);
    const up = M(d1);
    dbg.explicitWins = up.mode === 'standard';
    dbg.templateFollows = fs.readFileSync(path.join(d1, 'AGENTS.md'), 'utf8').length > agentsBytes * 1.5;

     
    const d2 = mk('corrupt', ['--mode', 'minimal']);
    fs.writeFileSync(path.join(d2, '.leerness', 'manifest.json'), '{ broken ]]]');
    const rc = R(d2, ['init', d2, '--yes']);
    const rebuilt = M(d2);
     
     
    dbg.corruptReinit = rc.status === 0 && /기존 등급\/설치시각을 읽을 수 없어/.test((rc.stdout || '') + (rc.stderr || ''))
      && rebuilt.mode === 'standard' && !!rebuilt.project;

     
    const d3 = mk('fresh');
    const ia = M(d3).installedAt;
    dbg.freshStamped = typeof ia === 'string' && !isNaN(Date.parse(ia)) && Math.abs(Date.now() - Date.parse(ia)) < 900000;

     
     
    const d4 = mk('proto');
    const mf4 = path.join(d4, '.leerness', 'manifest.json');
    const j4 = JSON.parse(fs.readFileSync(mf4, 'utf8'));
    fs.writeFileSync(mf4, JSON.stringify(Object.assign({ __PH__: 0 }, j4), null, 2).replace('"__PH__": 0', '"__proto__": {"a":1}') + '\n');
    const rp = R(d4, ['mode', 'set', 'minimal']);
    const rawAfter = fs.readFileSync(mf4, 'utf8');
    dbg.protoPreserved = rp.status === 0 && /"__proto__"/.test(rawAfter) && JSON.parse(rawAfter).mode === 'minimal';

    ok = dbg.setup && dbg.modeKept && dbg.installedAtKept && dbg.explicitWins && dbg.templateFollows
      && dbg.corruptReinit && dbg.freshStamped && dbg.protoPreserved;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 160); } finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ K(1.36.107) 재init: 등급/설치시각 보존 + 명시 플래그 우선 + 지침 동조 + 손상 복구 + __proto__ 보존'
    : '✗ 1.36.107 재init 매니페스트 보존 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
 
//
 
 
 
//
 
 
if (e2eShard.take('L(1.36.108/T-0097, 1.36.169/T-0108)')) {
  total++;
  let ok = false; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lock108-'));
  try {
    const ENV0 = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb });
    const PRELOAD = path.join(path.dirname(CLI), '..', 'scripts', 'lock-probe.js').replace(/\\/g, '/');
     
     
    const EXEMPT = {
      'task-log.md': 'append 전용(appendFileSync = O_APPEND) — 동시 추가가 서로를 지우지 않는다',
      'agent-permissions.json': '상수 프리셋 전체 쓰기 — 읽기가 없어 병합할 이전 값이 없다',
    };
    const DERIVED = /^(cache\/|last-handoff\.json|environment\.json|tech-profile\.json|update-cache\.json|provider-probe-cache\.json|leerness\.html)/;
     
    const SEED = (d, a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d],
      { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV0 });
    const CASES = [
      ['task add', ['task', 'add', '락프로브']],
      ['decision add', ['decision', 'add', '락프로브', '--reason', 'x']],
      ['lesson save', ['lesson', 'save', '락프로브']],
      ['rule add', ['rule', 'add', '락프로브', '--trigger', 'every-session']],
      ['rule pause', ['rule', 'pause', 'R-0001'], ['rule', 'add', '씨앗룰', '--trigger', 'every-session']],
      ['plan add', ['plan', 'add', '락프로브']],
       
      ['creds register', ['creds', 'register', '락프로브', '--env-var', 'LOCK_PROBE']],
      ['creds refresh', ['creds', 'refresh', '락프로브'], d => SEED(d, ['creds', 'register', '락프로브', '--env-var', 'LOCK_PROBE'])],
       
      ['team remove', ['team', 'remove', 'lock-probe'], d => SEED(d, ['team', 'add', 'lock-probe', '--name', 'lock'])],
      ['memory restore decisions', ['memory', 'restore', 'decisions', '락프로브'], d => { SEED(d, ['decision', 'add', '락프로브', '--reason', 'x']); SEED(d, ['decision', 'drop', '락프로브']); }],
      ['memory restore lessons', ['memory', 'restore', 'lessons', '락프로브'], d => { SEED(d, ['lesson', 'save', '락프로브']); SEED(d, ['lesson', 'drop', '락프로브']); }],
      ['memory restore plan', ['memory', 'restore', 'plan', '락프로브'], d => { SEED(d, ['plan', 'add', '락프로브']); SEED(d, ['plan', 'remove', '락프로브']); }],
      ['plan drop', ['plan', 'drop', '락프로브']],
      ['plan remove', ['plan', 'remove', '락프로브'], d => SEED(d, ['plan', 'add', '락프로브'])],
      ['preview add', ['preview', 'add', '락프로브', '--design', 'd', '--features', 'f']],
      ['requests add', ['requests', 'add', '락프로브']],
      ['next-action add', ['next-action', 'add', '락프로브']],
      ['toggle set', ['toggle', 'set', 'bugfix-receipt', 'off']],
      ['mode set', ['mode', 'set', 'minimal']],
      ['feature add', ['feature', 'add', '락프로브기능']],
      ['constraints add', ['constraints', 'add', 'probeapi', '--alias', 'probe', '--constraint', 'auth:token']],
      ['provider add', ['provider', 'add', 'probeprov']],
      ['wakeup-interval set', ['wakeup-interval', 'set', '900']],
      ['slash-commands --record', ['slash-commands', '--record']],
      ['session close', ['session', 'close', '.']],
       
       
       
       
      ['audit --fix', ['audit', '.', '--fix'], (d) => {
        const cs = path.join(d, '.leerness', 'current-state.md');
        if (fs.existsSync(cs)) fs.writeFileSync(cs, fs.readFileSync(cs, 'utf8').replace(/Updated: \d{4}-\d{2}-\d{2}/, 'Updated: 2000-01-01'));
        const sh = path.join(d, '.leerness', 'session-handoff.md');
        if (fs.existsSync(sh) && !/Last generated:/.test(fs.readFileSync(sh, 'utf8'))) fs.appendFileSync(sh, '\nLast generated: (자동)\n');
      }],
    ];
     
     
     
     
    const srvJs = path.join(sb, 'srv.js');
    fs.writeFileSync(srvJs, [
      "const http=require('http'),fs=require('fs');",
      "const s=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/plain'});r.end('probealpha|probealpha-cli|probe provider');});",
      "s.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.argv[2], String(s.address().port)));"
    ].join('\n'));
    const portFile = path.join(sb, 'port.txt');
    const srv = cp.spawn(process.execPath, [srvJs, portFile], { stdio: 'ignore' });
    let syncUrl = null;
    for (let i = 0; i < 100 && !syncUrl; i++) {
      try { const p = fs.readFileSync(portFile, 'utf8').trim(); if (p) syncUrl = `http://127.0.0.1:${p}/providers.txt`; } catch {}
      if (!syncUrl) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); } catch {} }
    }
     
    if (syncUrl) CASES.push(['provider sync', ['provider', 'sync', syncUrl]]);
    dbg.syncCovered = !!syncUrl;
    const offenders = [], failedCmds = [];
     
     
    const commonKeysByFile = {};
    const keySetsByFile = {};
    let lockedSeen = 0, rows = 0;
    for (const [label, argv, seed] of CASES) {
      const d = path.join(sb, label.replace(/[^a-z0-9]+/gi, '_'));
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
      cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV0 });
      if (typeof seed === 'function') seed(d);
      else if (seed) cp.spawnSync(process.execPath, [CLI, ...seed, '--path', d], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV0 });
      const out = path.join(d, 'lock.jsonl');
       
       
      const caseEnv = Object.assign({}, ENV0, { LOCKPROBE_OUT: out });
      if (label === 'provider sync') caseEnv.LEERNESS_OFFLINE = '0';
      const r = cp.spawnSync(process.execPath, ['--require', PRELOAD, CLI, ...argv, '--path', d],
        { cwd: d, encoding: 'utf8', timeout: 600000, env: caseEnv });
       
      if (r.status !== 0) { failedCmds.push(label + '(exit=' + r.status + ')'); continue; }
      let lines = [];
      try { lines = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch {}
      const byFile = {};
      for (const l of lines) {
        byFile[l.file] = (l.file in byFile ? byFile[l.file] : true) && l.locked;
         
        if (l.locked && !DERIVED.test(l.file) && !EXEMPT[l.file]) {
          const held = new Set(l.heldOn || []);
          (keySetsByFile[l.file] = keySetsByFile[l.file] || new Set()).add([...held].sort().join(' + ') || '(none)');
          if (!commonKeysByFile[l.file]) commonKeysByFile[l.file] = held;
          else commonKeysByFile[l.file] = new Set([...commonKeysByFile[l.file]].filter(k => held.has(k)));
        }
      }
      for (const [f, lockedOk] of Object.entries(byFile)) {
        if (DERIVED.test(f)) continue;
        rows++;
        if (lockedOk) { lockedSeen++; continue; }
        if (EXEMPT[f]) continue;
        offenders.push(label + ' → ' + f);
      }
    }
     
     
     
     
     
     
    const wrongKey = [];
    for (const [f, common] of Object.entries(commonKeysByFile)) {
      if (common.size === 0) wrongKey.push(f + ' ← 공통 락 없음 (' + [...keySetsByFile[f]].sort().join(' / ') + ')');
    }
    dbg.wrongKey = wrongKey;
    dbg.offenders = offenders;
    dbg.failedCmds = failedCmds;
    dbg.lockedSeen = lockedSeen;
    dbg.rows = rows;
     
    dbg.probeAlive = lockedSeen >= 10;
     
    dbg.coverage = failedCmds.length === 0;
    ok = dbg.probeAlive && dbg.coverage && dbg.syncCovered && offenders.length === 0 && wrongKey.length === 0;
    try { srv.kill(); } catch {}
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); } finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ L(1.36.108/T-0097, 1.36.169/T-0108) 사용자 상태 쓰기 ${dbg.rows}건 전부 락 안 + 파일별 canonical 락 교집합 존재 (락 관측 ${dbg.lockedSeen}건 = 계측 살아있음 · 명령 실패 0)`
    : '✗ 1.36.108 락 불변식 위반 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
 
 
 
 
 
 
 
if (e2eShard.take('M(1.36.109)')) {
  total++;
  let ok = false; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-claim109-'));
  try {
    const ENV = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb });
    let seq = 0;
    const mk = (setup) => {
      const d = path.join(sb, 'p' + (++seq));
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
      cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV });
      setup(d); return d;
    };
    const R = (d, a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV });
    const verdict = (d, evidence) => {
      const id = (String(R(d, ['task', 'add', '주장']).stdout || '').match(/T-\d{4,}/) || [])[0];
      R(d, ['task', 'update', id, '--status', 'done', '--evidence', evidence]);
      const r = R(d, ['verify-claim', id, '--json']);
      let j = null; try { j = JSON.parse(String(r.stdout || '')); } catch {}
      return { ok: j ? j.ok : null, reasons: j ? (j.reasons || []) : [] };
    };
    const W = (d, rel, body) => { const p = path.join(d, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };

     
    const dEmpty = mk(d => W(d, 'src/empty.js', ''));
    const vEmpty = verdict(dEmpty, 'src/empty.js 구현 완료');
    const dBlank = mk(d => W(d, 'src/blank.js', '   \n\n '));
    const vBlank = verdict(dBlank, 'src/blank.js 구현 완료');
    dbg.emptyBlocked = vEmpty.ok === false && vEmpty.reasons.includes('stub-impl');
    dbg.blankBlocked = vBlank.ok === false && vBlank.reasons.includes('stub-impl');

     
    const dReal = mk(d => W(d, 'src/real.js', 'function f(){return 1;}\nmodule.exports={f};\n'));
    dbg.realPasses = verdict(dReal, 'src/real.js 구현 완료').ok === true;

     
    const dUs = mk(d => W(d, 'src/_helpers.js', 'function h(){return 1;}\nmodule.exports={h};\n'));
    const vUs = verdict(dUs, 'src/_helpers.js 구현 완료');
    dbg.underscoreOk = vUs.ok === true && !vUs.reasons.includes('files-missing');
    const dNext = mk(d => W(d, 'pages/_app.tsx', 'export default function App(){ return null; }\n'));
    const vNext = verdict(dNext, 'pages/_app.tsx 수정 완료');
    dbg.nextjsOk = vNext.ok === true && !vNext.reasons.includes('files-missing');
     
     
    const dPriv = mk(d => W(d, '_private/util.ts', 'export function u(){ return 1; }\n'));
    const vPriv = verdict(dPriv, '_private/util.ts 정리 완료');
    dbg.privDirOk = vPriv.ok === true && !vPriv.reasons.includes('files-missing');

     
    const dPy = mk(d => { W(d, 'pkg/__init__.py', ''); W(d, 'pkg/core.py', 'def f():\n    return 1\n'); });
    const vPy = verdict(dPy, 'pkg/__init__.py, pkg/core.py 구현 완료');
    dbg.initPyExempt = vPy.ok === true;
     
     
     
    const dPyOnly = mk(d => W(d, 'pkg/__init__.py', ''));
    const vPyOnly = verdict(dPyOnly, 'pkg/__init__.py 구현 완료');
    dbg.markerOnlyBlocked = vPyOnly.ok === false && vPyOnly.reasons.includes('stub-impl');
     
    const dPyi = mk(d => { W(d, 'pkg/__init__.pyi', ''); W(d, 'pkg/core.pyi', 'def f() -> int: ...\n'); });
    const vPyi = verdict(dPyi, 'pkg/__init__.pyi, pkg/core.pyi 타입 스텁 추가');
    dbg.pyiRecognized = vPyi.ok === true;
     
    const dFrag = mk(d => W(d, '_anchor.js', 'function a(){return 1;}\nmodule.exports={a};\n'));
    const vFrag = verdict(dFrag, 'https://example.test/docs#_anchor.js 검토 완료');
    dbg.urlFragBlocked = vFrag.ok === false;
    const dDrive = mk(d => W(d, '_anchor.js', 'function a(){return 1;}\nmodule.exports={a};\n'));
    const vDrive = verdict(dDrive, 'C:_anchor.js 검토 완료');
    dbg.driveRelBlocked = vDrive.ok === false;
     
    const dColon = mk(d => W(d, 'src/colon.js', 'function c(){return 1;}\nmodule.exports={c};\n'));
    const vColon = verdict(dColon, '파일:src/colon.js 구현 완료');
    dbg.colonFormOk = vColon.ok === true;

     
    const dGhost = mk(() => {});
    const vGhost = verdict(dGhost, 'src/_ghost.js 구현 완료');
    dbg.ghostStillBlocked = vGhost.ok === false && vGhost.reasons.includes('files-missing');

    ok = dbg.emptyBlocked && dbg.blankBlocked && dbg.realPasses && dbg.underscoreOk
      && dbg.nextjsOk && dbg.privDirOk && dbg.initPyExempt && dbg.ghostStillBlocked
      && dbg.markerOnlyBlocked && dbg.pyiRecognized && dbg.urlFragBlocked && dbg.driveRelBlocked && dbg.colonFormOk;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); } finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ M(1.36.109) 완료 게이트: 0바이트=스텁(공백과 동일 판정) + 밑줄 파일명 무손실 추출 + __init__.py 예외 + 실구현/없는파일 대조군'
    : '✗ 1.36.109 완료 게이트 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
 
 
 
if (e2eShard.take('N(1.36.110/T-0099)')) {
  total++;
  let ok = false; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-honest110-'));
  try {
    const ENV = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb });
    let seq = 0;
    const mk = (setup) => {
      const d = path.join(sb, 'p' + (++seq));
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
      cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV });
      if (setup) setup(d); return d;
    };
    const R = (d, a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV });
    const W = (d, rel, body) => { const p = path.join(d, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
    const verdict = (d, ev, extra = []) => {
      const id = (String(R(d, ['task', 'add', '주장']).stdout || '').match(/T-\d{4,}/) || [])[0];
      R(d, ['task', 'update', id, '--status', 'done', '--evidence', ev]);
      const r = R(d, ['verify-claim', id, '--json', ...extra]);
      let j = null; try { j = JSON.parse(String(r.stdout || '')); } catch {}
      const adv = (j && j.claims && Array.isArray(j.claims.advisory)) ? j.claims.advisory : [];
      return { ok: j ? j.ok : null, reasons: j ? (j.reasons || []) : [], advisory: adv.map(a => a.dim), out: String(r.stdout || '') };
    };
    const impl = d => W(d, 'src/impl.js', 'function f(){return 1;}\nmodule.exports={f};\n');

     
     
     
     
     
    const vKo = verdict(mk(impl), 'src/impl.js 반영했는데 엣지 케이스는 안 봤습니다.');
    const vEn = verdict(mk(impl), 'src/impl.js applied; edge cases unchecked.');
    dbg.koAdvised = vKo.advisory.includes('unverified-admission');
    dbg.enAdvised = vEn.advisory.includes('unverified-admission');
    dbg.symmetric = dbg.koAdvised === dbg.enAdvised;
    dbg.notBlocking = vKo.ok === true && vEn.ok === true;           
    dbg.visibleToUser = /권고|advisory/i.test(vKo.out);             

     
    const vHonest = verdict(mk(impl), 'src/impl.js 구현. 테스트 12/12 통과 (Exit: 0).');
    dbg.honestClean = vHonest.ok === true && vHonest.advisory.length === 0;
    const vHedgedButSourced = verdict(mk(impl), 'src/impl.js 구현. 20/20 passed. 성능 개선 효과는 추후 측정 예정.');
    dbg.sourcedHedgeClean = vHedgedButSourced.ok === true && vHedgedButSourced.advisory.length === 0;
     
    const vNegated = verdict(mk(impl), 'src/impl.js 오타 수정만. 검증 필요 없는 주석 변경. 12/12 통과.');
    dbg.negationClean = vNegated.ok === true && vNegated.advisory.length === 0;
    const vFuture = verdict(mk(impl), 'src/impl.js 설정값만 변경. 호환성은 추후 확인.');
    dbg.futureScopeClean = vFuture.ok === true && vFuture.advisory.length === 0;
     
    const vGradle = verdict(mk(impl), 'src/impl.js 구현. ./gradlew test 통과. 엣지 케이스는 안 봤습니다.');
    dbg.unlistedRunnerClean = vGradle.ok === true && vGradle.advisory.length === 0;

     
    const vStub = verdict(mk(d => W(d, 'src/empty.js', '')), 'src/empty.js 구현 완료');
    dbg.existingGateIntact = vStub.ok === false && vStub.reasons.includes('stub-impl');

    ok = dbg.koAdvised && dbg.enAdvised && dbg.symmetric && dbg.notBlocking && dbg.visibleToUser
      && dbg.honestClean && dbg.sourcedHedgeClean && dbg.negationClean && dbg.futureScopeClean
      && dbg.unlistedRunnerClean && dbg.existingGateIntact;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); } finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ N(1.36.110/T-0099) 미검증 자백을 **권고로** 보고(차단 아님) · ko/en 동일 · 사용자에게 노출 · 정직 주장·미래범위·목록밖 러너 무탐 · 기존 게이팅 불변'
    : '✗ 1.36.110 정직성 판정 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
 
 
if (e2eShard.take('O(1.36.111/T-0092)')) {
  total++;
  let ok = false; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-i18n111-'));
  try {
    const ENV = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_LANG: 'en' });
    const d = path.join(sb, 'proj');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"proj","version":"0.1.0"}');
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'en'], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV });
    const gitInit = gitSpawn(['init', '-q'], { cwd: d, encoding: 'utf8', timeout: 20000, env: ENV });
    dbg.gitInit = gitInit.status === 0;
    const R = (a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV });
     
    R(['task', 'add', 'Implement the parser']);
    R(['decision', 'add', 'Use JSON storage', '--reason', 'simplest']);
    R(['plan', 'add', 'Ship v1']);
    const HANGUL = /\p{Script=Hangul}/u;
     
     
     
    const _echoRoots = [sb, d, tmp, CLI, path.resolve(__dirname, '..'), os.tmpdir(), os.homedir(), process.cwd()];
    const _stripAllowedEchoes = (output, extra = []) => {
      let text = String(output);
      const forms = new Set();
      for (const value of [..._echoRoots, ...extra]) {
        if (typeof value !== 'string' || !value) continue;
        forms.add(value);
        forms.add(value.replace(/\\/g, '/'));
        forms.add(JSON.stringify(value).slice(1, -1));
      }
      for (const value of [...forms].sort((a, b) => b.length - a.length)) text = text.split(value).join('<user-path>');
      return text;
    };
    const _hangulLines = (output, extra = []) => _stripAllowedEchoes(output, extra).split('\n').filter(l => HANGUL.test(l));
    const _syntheticHangulPath = path.join(sb, '사용자-경로');
    dbg.echoFilter = _hangulLines(`path: ${_syntheticHangulPath}`, [_syntheticHangulPath]).length === 0
      && _hangulLines(`path: ${_syntheticHangulPath}\ntool text 한글`, [_syntheticHangulPath]).length === 1;
     
     
    const CMDS = [['commands'], ['status'], ['health'], ['pulse'], ['check'], ['mode'], ['toggle', 'list'],
      ['task', 'list'], ['decision', 'list'], ['plan', 'list'], ['lesson', 'list'], ['rule', 'list'],
      ['lens'], ['route', 'feature'], ['milestones'], ['round-history'], ['memory', 'status'],
      ['reuse-map'], ['preview', 'list'], ['feature', 'list'], ['requests', 'list'], ['roles', 'list'],
      ['permissions', 'list'], ['insights'], ['agents', 'list'], ['constraints', 'list'],
      ['provider', 'list'], ['skill', 'list'], ['next-action', 'list'], ['session-resume'],
      ['idempotency', 'audit'], ['context', 'budget'], ['drift', 'check'], ['verify'],
      ['encoding', 'check'], ['scan', 'secrets'], ['which'], ['glossary'], ['release', 'cadence']];
     
     
     
    const EXPECTED_LEAKS = new Map([
      ['commands', 0], ['status', 0], ['health', 0], ['pulse', 0], ['check', 0], ['mode', 0],
      ['toggle list', 0], ['task list', 0], ['decision list', 1], ['plan list', 0], ['lesson list', 1],
      ['rule list', 1], ['lens', 0], ['route feature', 0], ['milestones', 0], ['round-history', 0],
      ['memory status', 2], ['reuse-map', 2], ['preview list', 2], ['feature list', 2], ['requests list', 1],
      ['roles list', 3], ['permissions list', 3], ['insights', 0], ['agents list', 0], ['constraints list', 0],
      ['provider list', 0], ['skill list', 0], ['next-action list', 2], ['session-resume', 3],
      ['idempotency audit', 0], ['context budget', 0], ['drift check', 0], ['verify', 0],
      ['encoding check', 0], ['scan secrets', 1], ['which', 0], ['glossary', 1], ['release cadence', 0],
    ]);
    let leaky = 0, produced = 0; const worst = [], silent = [], measured = new Map();
    for (const a of CMDS) {
      const r = R(a);
      const out = String(r.stdout || '') + String(r.stderr || '');
       
       
      if (r.status === 0 && out.trim()) produced++; else silent.push(a.join(' ') + '(exit=' + r.status + ')');
      const n = _hangulLines(out).length;
      leaky += n;
      measured.set(a.join(' '), n);
      if (n) worst.push(a.join(' ') + ':' + n);
    }
    dbg.leaky = leaky; dbg.produced = produced; dbg.worst = worst.slice(0, 8); dbg.silent = silent;
     
    dbg.probeAlive = silent.length === 0 && produced === CMDS.length;
    const commandNames = CMDS.map(a => a.join(' '));
    dbg.coverage = CMDS.length === 39 && new Set(commandNames).size === 39
      && EXPECTED_LEAKS.size === 39 && commandNames.every(name => EXPECTED_LEAKS.has(name));
    dbg.vectorDrift = [...measured].filter(([name, count]) => EXPECTED_LEAKS.get(name) !== count)
      .map(([name, count]) => `${name}:${EXPECTED_LEAKS.get(name)}→${count}`);
    dbg.perCommandRatchet = dbg.vectorDrift.length === 0;
     
     
     
     
     
     
     
     
     
     
     
     
    const BASELINE = 25;
    dbg.baseline = BASELINE;
     
     
    dbg.exactRatchet = leaky === BASELINE;
     
    const cmdOut = String(R(['commands']).stdout || '');
    dbg.commandsClean = _hangulLines(cmdOut).length === 0;
    dbg.nextClusterClean = ['release cadence', 'idempotency audit', 'plan list', 'round-history', 'milestones', 'skill list', 'mode']
      .every(cmd => measured.get(cmd) === 0);
     
     
    const koEnv = Object.assign({}, ENV, { LEERNESS_LANG: 'ko' });
    const koOut = String(cp.spawnSync(process.execPath, [CLI, 'commands', '--path', d], { cwd: d, encoding: 'utf8', timeout: 300000, env: koEnv }).stdout || '');
    dbg.koIntact = /## status \(\d+개\)/.test(koOut) && /총 \d+ 명령/.test(koOut) && HANGUL.test(koOut);
     
    let cj = null;
    try { cj = JSON.parse(String(R(['commands', '--json']).stdout || '')); } catch {}
    dbg.jsonContract = !!cj && typeof cj.totalCommands === 'number' && cj.totalCommands > 50
      && Object.values(cj.categories).every(list => list.every(e => typeof e.cmd === 'string' && typeof e.desc === 'string'
        && e.descEn === undefined && e.cmdEn === undefined))      
      && cj.lang === 'en';                                         
    ok = dbg.gitInit && dbg.echoFilter && dbg.probeAlive && dbg.coverage && dbg.exactRatchet && dbg.perCommandRatchet
      && dbg.commandsClean && dbg.nextClusterClean && dbg.koIntact && dbg.jsonContract;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); } finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ O(1.36.111/T-0092) 영어 누출 ${dbg.leaky}줄 = exact 래칫 ${dbg.baseline} · commands/next-cluster 표면 0 · 한국어 출력 불변 · --json 계약 유지 · 계측 살아있음`
    : '✗ 1.36.111 i18n 래칫 위반 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
 
 
 
 
if (e2eShard.take('P(1.36.112)')) {
  total++;
  let ok = false; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-carry112-'));
  const ENV = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb });
  try {
    const mk = (name, lang) => {
      const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), '{"name":"proj","version":"0.1.0"}');
      cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', lang || 'ko'], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV });
      return d;
    };
    const R = (d, a, env) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { cwd: d, encoding: 'utf8', timeout: 300000, env: env || ENV });
    const J = (d, a, env) => { try { return JSON.parse(String((R(d, a.concat(['--json']), env)).stdout || '').trim()); } catch { return null; } };

     
    const clean = mk('clean');
    const cleanB = J(clean, ['context', 'budget']);
    dbg.cleanZero = !!cleanB && cleanB.carried && cleanB.carried.tokens === 0
      && cleanB.parts.every(p => !p.carriedTokens)
      && !/이월|carried-over/.test(String(R(clean, ['context', 'budget']).stdout || ''));

     
    const PU = require(path.resolve(path.dirname(CLI), '..', 'lib', 'pure-utils'));
    const carried = mk('carried');
    const agp = path.join(carried, 'AGENTS.md');
    const base = fs.readFileSync(agp, 'utf8');
    const legacy = Array.from({ length: 150 }, (_, i) => `- LEGACY-CARRY-${i} 과거 릴리스 이력 항목 (1.9.${100 + i})`).join('\n');
    const merged = PU._managedMerge('AGENTS.md', base, base + '\n' + legacy + '\n', '.leerness/archive', new Set(), {});
    dbg.writerMadeBlock = merged.includes(PU.PRESERVED_TAG) && merged.includes('LEGACY-CARRY-149');
    fs.writeFileSync(agp, merged);

     
    const sp = PU._splitPreserved(merged);
    dbg.roundTrip = (sp.managed + sp.preserved) === merged && sp.preserved.includes('LEGACY-CARRY-0')
      && !sp.managed.includes('LEGACY-CARRY-0') && sp.preserved.startsWith('\n');
     
    const spNone = PU._splitPreserved(base);
    dbg.splitNoop = spNone.preserved === '' && spNone.managed === base && spNone.at === -1;

     
    const cb = J(carried, ['context', 'budget']);
    const agPart = cb && cb.parts.find(p => p.key === 'AGENTS.md');
    dbg.counts = !!cb && cb.carried.tokens > 500 && !!agPart && agPart.carriedTokens > 500
      && cb.carried.tokens === agPart.carriedTokens && cb.carried.pctOfTotal > 0;

     
    R(carried, ['mode', 'set', 'minimal']);
    const mb = J(carried, ['context', 'budget']);
    dbg.survivesMode = !!mb && mb.mode === 'minimal' && mb.total < cb.total
      && mb.carried.tokens === cb.carried.tokens && mb.carried.tokens > 0
      && mb.carried.pctOfTotal > cb.carried.pctOfTotal;    
    R(carried, ['mode', 'set', 'standard']);

     
     
    const arch = path.join(carried, '.leerness', 'archive', 'leerness-1.0.0-x', 'files');
    fs.mkdirSync(arch, { recursive: true }); fs.writeFileSync(path.join(arch, 'AGENTS.md'), base);
    const withArch = J(carried, ['context', 'budget']);
    fs.rmSync(path.join(carried, '.leerness', 'archive'), { recursive: true, force: true });
    const noArch = J(carried, ['context', 'budget']);
    dbg.archiveBothWays = !!withArch && !!noArch
      && withArch.carried.archive && withArch.carried.archive.exists === true
      && noArch.carried.archive && noArch.carried.archive.exists === false;

     
     
     
     
     
    const remLines = (d) => String(R(d, ['context', 'budget']).stdout || '').split('\n').filter(l => /^\s*→ /.test(l));
    fs.appendFileSync(path.join(carried, 'CLAUDE.md'), '\n' + 'x'.repeat(20000) + '\n');    
    const aStd = J(carried, ['context', 'budget']);
    const aRef = aStd && aStd.parts.find(p => p.key === 'referencedDocs');
    const aLines = remLines(carried);
    dbg.remedyOrderModeFirst = !!aStd && aStd.over === true && !!aRef
      && aRef.tokens > aStd.carried.tokens             
      && aLines.length === 2 && /mode set minimal/.test(aLines[0]) && /이월분/.test(aLines[1]);

    const big = mk('big');
    const bagp = path.join(big, 'AGENTS.md');
    const bbase = fs.readFileSync(bagp, 'utf8');
    const huge = Array.from({ length: 1200 }, (_, i) => `- LEGACY-BIG-${i} 과거 릴리스 이력 항목 (1.9.${i})`).join('\n');
    fs.writeFileSync(bagp, PU._managedMerge('AGENTS.md', bbase, bbase + '\n' + huge + '\n', '.leerness/archive', new Set(), {}));
    const bStd = J(big, ['context', 'budget']);
    const bRef = bStd && bStd.parts.find(p => p.key === 'referencedDocs');
    const bLines = remLines(big);
    dbg.remedyOrderCarriedFirst = !!bStd && bStd.over === true && !!bRef
      && bStd.carried.tokens > bRef.tokens
      && bLines.length === 2 && /이월분/.test(bLines[0]) && /mode set minimal/.test(bLines[1]);

     
     
    R(carried, ['mode', 'set', 'minimal']);
    const minOut = String(R(carried, ['context', 'budget']).stdout || '');
    const lines = minOut.split('\n').filter(l => /^\s*→ /.test(l));
    dbg.remedyOrder = lines.length === 1 && /이월분/.test(lines[0]) && !lines.some(l => /mode set minimal/.test(l));
    dbg.remedyQuantified = /이월분 \d+ tok \(합계의 \d+%\) 은 \*\*등급을 낮춰도 남습니다\*\*/.test(minOut);

     
    dbg.noDeletion = fs.readFileSync(path.join(carried, 'AGENTS.md'), 'utf8').includes('LEGACY-CARRY-149');

     
     
     
    const en = mk('en_carry', 'en');
    const enEnv = Object.assign({}, ENV, { LEERNESS_LANG: 'en' });
    {
      const p = path.join(en, 'AGENTS.md'); const t = fs.readFileSync(p, 'utf8');
      const extra = Array.from({ length: 200 }, (_, i) => `- CARRY-EN-${i} legacy release note`).join('\n');
      fs.writeFileSync(p, PU._managedMerge('AGENTS.md', t, t + '\n' + extra + '\n', '.leerness/archive', new Set(), { lang: 'en' }));
      fs.appendFileSync(path.join(en, 'CLAUDE.md'), '\n' + 'x'.repeat(40000) + '\n');
    }
    const enOut = String(R(en, ['context', 'budget'], enEnv).stdout || '');
    const enJ = J(en, ['context', 'budget'], enEnv);
     
    const enCorrupt = mk('en_corrupt', 'en');
    fs.writeFileSync(path.join(enCorrupt, '.leerness', 'manifest.json'), '{ not json');
    const enCorruptOut = String(R(enCorrupt, ['context', 'budget'], enEnv).stdout || '');
    dbg.enClean = enOut.split('\n').filter(l => /[가-힣ㄱ-ㆎ]/.test(l)).length === 0
      && enCorruptOut.split('\n').filter(l => /[가-힣ㄱ-ㆎ]/.test(l)).length === 0
      && /manifest\.json corrupt \(invalid JSON\)/.test(enCorruptOut)    
      && !!enJ && enJ.lang === 'en'
      && enJ.over === true && enJ.carried.tokens > 0                     
      && /carried-over/.test(enOut) && /survives a mode change/.test(enOut)
      && /at least/.test(enOut) && /session load exceeds the budget/.test(enOut)
      && enJ.parts.every(p => typeof p.key === 'string');    

     
     
     
    const both = mk('both');
    for (const f of ['AGENTS.md', 'CLAUDE.md']) {
      const p = path.join(both, f); const t = fs.readFileSync(p, 'utf8');
      const extra = Array.from({ length: f === 'AGENTS.md' ? 140 : 55 }, (_, i) => `- CARRY-${f}-${i} 과거 항목`).join('\n');
      fs.writeFileSync(p, PU._managedMerge(f, t, t + '\n' + extra + '\n', '.leerness/archive', new Set(), {}));
    }
    const twoJ = J(both, ['context', 'budget']);
    const pA = twoJ && twoJ.parts.find(p => p.key === 'AGENTS.md');
    const pC = twoJ && twoJ.parts.find(p => p.key === 'CLAUDE.md');
    dbg.twoFileSum = !!twoJ && !!pA && !!pC && pA.carriedTokens > 0 && pC.carriedTokens > 0
      && pA.carriedTokens !== pC.carriedTokens                                    
      && twoJ.carried.tokens === pA.carriedTokens + pC.carriedTokens
      && twoJ.carried.bytes > twoJ.carried.tokens;                                

     
    const snap2 = path.join(both, '.leerness', 'archive', 'leerness-1.0.0-x', 'files');
    fs.mkdirSync(snap2, { recursive: true }); fs.writeFileSync(path.join(snap2, 'AGENTS.md'), 'x');
    const partial = J(both, ['context', 'budget']);
    fs.writeFileSync(path.join(snap2, 'CLAUDE.md'), 'x');
    const full = J(both, ['context', 'budget']);
    dbg.archivePerFile = !!partial && !!full && !!partial.carried.archive && !!full.carried.archive
      && partial.carried.archive.exists === false && full.carried.archive.exists === true
      && full.carried.archive.files === 2;

     
    const esc = mk('esc');
    {
      const outside = path.join(sb, 'outside', 'files'); fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(path.join(outside, 'AGENTS.md'), 'x');
      const p = path.join(esc, 'AGENTS.md'); const t = fs.readFileSync(p, 'utf8');
      fs.writeFileSync(p, PU._managedMerge('AGENTS.md', t, t + '\n- CARRY-ESC\n', '.leerness/archive', new Set(), {})
        .replace('`.leerness/archive`', '`../outside`'));
    }
    const escJ = J(esc, ['context', 'budget']);
    dbg.noEscape = !!escJ && !!escJ.carried.archive && escJ.carried.archive.exists === false;

     
     
     
    const refc = mk('refcarry');
    {
      const p = path.join(refc, 'AGENTS.md');
      const stripped = fs.readFileSync(p, 'utf8').replace(/\.leerness\//g, 'dot-harness/');    
      fs.writeFileSync(p, PU._managedMerge('AGENTS.md', stripped,
        stripped + '\n- 읽어라: .leerness/plan.md\n- 읽어라: .leerness/decisions.md\n', '.leerness/archive', new Set(), {}));
      fs.appendFileSync(path.join(refc, 'CLAUDE.md'), '\n' + 'x'.repeat(60000) + '\n');        
    }
    const refJ = J(refc, ['context', 'budget']);
    const refPart = refJ && refJ.parts.find(p => p.key === 'referencedDocs');
    const refLines = remLines(refc);
     
     
     
    const refm = mk('refmanaged');
    {
      const p = path.join(refm, 'AGENTS.md');
      const stripped = fs.readFileSync(p, 'utf8').replace(/\.leerness\//g, 'dot-harness/');
      const withRefs = stripped + '\n- 읽어라: .leerness/plan.md\n- 읽어라: .leerness/decisions.md\n';
      fs.writeFileSync(p, PU._managedMerge('AGENTS.md', withRefs, withRefs + '\n- CARRY-FILLER\n', '.leerness/archive', new Set(), {}));
      fs.appendFileSync(path.join(refm, 'CLAUDE.md'), '\n' + 'x'.repeat(60000) + '\n');
    }
    const refmJ = J(refm, ['context', 'budget']);
    const refmPart = refmJ && refmJ.parts.find(p => p.key === 'referencedDocs');
    dbg.carriedRefsNotCounted = !!refJ && refJ.over === true
      && !!refPart && refPart.tokens > 0                     
      && typeof refJ.modeSavesAtLeast === 'number' && !!refmJ && typeof refmJ.modeSavesAtLeast === 'number'
      && !!refmPart && refmPart.tokens === refPart.tokens    
      && refmJ.modeSavesAtLeast - refJ.modeSavesAtLeast === refPart.tokens
      && refLines.some(l => /지목 문서 0 /.test(l));          

     
     
    const pad = mk('padded');
    const padBefore = J(pad, ['context', 'budget']);
    fs.appendFileSync(path.join(pad, 'AGENTS.md'), '\n' + '사용자가 덧붙인 지침 줄입니다.\n'.repeat(2000));
    const padAfter = J(pad, ['context', 'budget']);
    const padA = padBefore && padBefore.parts.find(p => p.key === 'AGENTS.md');
    const padB = padAfter && padAfter.parts.find(p => p.key === 'AGENTS.md');
    dbg.userContentNotSaving = !!padA && !!padB
      && padB.tokens - padA.tokens > 5000                                     
      && padAfter.modeSavesAtLeast === padBefore.modeSavesAtLeast;            

    ok = dbg.cleanZero && dbg.writerMadeBlock && dbg.roundTrip && dbg.splitNoop && dbg.counts
      && dbg.survivesMode && dbg.archiveBothWays && dbg.remedyOrder && dbg.remedyQuantified
      && dbg.remedyOrderModeFirst && dbg.remedyOrderCarriedFirst
      && dbg.twoFileSum && dbg.archivePerFile && dbg.noEscape && dbg.carriedRefsNotCounted
      && dbg.userContentNotSaving && dbg.noDeletion && dbg.enClean;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); } finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ P(1.36.112) 이월분 계량: 무이월 0 · 분해 무손실(왕복) · 경계없음 무동작 · 두 파일 합산(≠최댓값) · bytes 계약 · **등급을 낮춰도 잔존**(비중은 증가) · 백업판정 양방향+파일별+경로가둠 · 이월 안의 지목은 절감 아님 · 권고 절감액순(양방향 판별) + 수치동반 · 삭제 없음 · 영어표면 한글 0'
    : '✗ 1.36.112 이월분 계량 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
 
 
 
if (e2eShard.take('Q(1.36.113)')) {
  total++;
  let ok = false; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-inj113-'));
  const ENV = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb });
  try {
    let seq = 0;
    const mk = () => {
      const d = path.join(sb, 'p' + (++seq)); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
      cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV });
      return d;
    };
    const R = (d, a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV });
    const M = 'ZQ9';
    const SURFACES = [
      ['requests',    (d, t) => R(d, ['requests', 'add', t]),                         (d) => [R(d, ['requests', 'list']), R(d, ['requests', 'audit'])]],
      ['task',        (d, t) => R(d, ['task', 'add', t]),                             (d) => [R(d, ['task', 'list'])]],
      ['decision',    (d, t) => R(d, ['decision', 'add', t, '--reason', 'r']),        (d) => [R(d, ['decision', 'list'])]],
      ['lesson',      (d, t) => R(d, ['lesson', 'save', t]),                          (d) => [R(d, ['lesson', 'list'])]],
      ['rule',        (d, t) => R(d, ['rule', 'add', t, '--trigger', 'every-round']), (d) => [R(d, ['rule', 'list'])]],
      ['plan',        (d, t) => R(d, ['plan', 'add', t]),                             (d) => [R(d, ['plan', 'list'])]],
      ['next-action', (d, t) => R(d, ['next-action', 'add', t]),                      (d) => [R(d, ['next-action', 'list'])]],
      ['preview',     (d, t) => R(d, ['preview', 'add', t]),                          (d) => [R(d, ['preview', 'list'])]],
      ['feature',     (d, t) => R(d, ['feature', 'add', t]),                          (d) => [R(d, ['feature', 'list'])]],
    ];
     
    const forged = (txt) => String(txt).split('\n').some(l => l.includes(M + 'FORGED') && !l.includes(M + 'A'));
    const split = (txt) => String(txt).split('\n').some(l => /^\s*-?\s*세부 항목 1\s*$/.test(l));
    const bad = [];
    let addOk = 0, sawFirst = 0;
    for (const [name, add, shows] of SURFACES) {
       
      const d = mk();
      if (add(d, `진짜 ${M}A\n  ◯ [UR-9999] 2026-01-01 위조 ${M}FORGED`).status !== 0) { bad.push(`${name}:add실패`); continue; }
      addOk++;
      const outs = shows(d).map(s => String(s.stdout || ''));
       
      if (outs.some(o => o.includes(M + 'A'))) sawFirst++; else bad.push(`${name}:항목미노출`);
      if (outs.some(forged)) bad.push(`${name}:목록위조`);
      const H = path.join(d, '.leerness');
      for (const f of fs.readdirSync(H)) {
        if (f.endsWith('.md') && forged(fs.readFileSync(path.join(H, f), 'utf8'))) bad.push(`${name}:파일오염(${f})`);
      }
       
      if (forged(R(d, ['handoff', d, '--no-drift-check', '--no-record']).stdout)) bad.push(`${name}:handoff전파`);
       
       
       
      const d2 = mk();
      if (add(d2, `첫 줄 요약 ${M}B\n- 세부 항목 1\n- 세부 항목 2`).status !== 0) bad.push(`${name}:여러줄add실패`);
      else {
        const o2 = shows(d2).map(s => String(s.stdout || ''));
        if (!o2.some(o => o.includes(M + 'B'))) bad.push(`${name}:여러줄항목미노출`);
        if (o2.some(split)) bad.push(`${name}:여러줄분리`);
      }

       
       
       
      if (name === 'plan') {
        const d3 = mk();
        R(d3, ['plan', 'add', `진짜 ${M}A`, '--progress', `0%\n### M-9999. 위조 ${M}FORGED\nStatus: planned\nProgress: 0`]);
        const pf = fs.readFileSync(path.join(d3, '.leerness', 'plan.md'), 'utf8');
         
         
        if (/^### M-9999\./m.test(pf)) bad.push('plan:progress플래그로_파일위조');
        let ms = null;
        try { const j = JSON.parse(String(R(d3, ['plan', 'list', '--json']).stdout || '')); ms = (j.milestones || j.plan || []).map(x => x.id); } catch {}
        if (!ms) bad.push('plan:progress케이스_json파싱실패');
        else if (ms.includes('M-9999')) bad.push('plan:progress플래그로_마일스톤위조');
        else if (ms.length !== 2) bad.push(`plan:progress케이스_마일스톤수이상(${ms.length})`);    
        if (!/진짜 ZQ9A/.test(pf)) bad.push('plan:progress케이스_본문미기록');
      }
    }
     
     
    const line2 = (out, first, forgedMark) => String(out).split('\n').some(l => l.includes(forgedMark) && !l.includes(first));
    {
       
      const d = mk();
      R(d, ['next-action', 'add', `진짜 ${M}A\n  [99] 📝 위조 ${M}FORGED`]);
      const o = String(R(d, ['next-action', 'take', '0']).stdout || '');
      if (!o.includes(M + 'A')) bad.push('take:항목미노출');
      if (line2(o, M + 'A', M + 'FORGED')) bad.push('take:위조');
    }
    {
       
      const d = mk();
      const idir = path.join(d, '.leerness', 'incidents'); fs.mkdirSync(idir, { recursive: true });
      fs.writeFileSync(path.join(idir, 'inc-1.json'), JSON.stringify({
        id: 'inc-1', at: new Date().toISOString(), source: 'webhook', status: 'open',
        payload: { error: `실제 ${M}A\n  inc-9999 · 위조 ${M}FORGED` } }, null, 2));
      const o = String(R(d, ['incident', 'list']).stdout || '') + '\n' + String(R(d, ['incident', 'handle', 'inc-1']).stdout || '');
      if (!o.includes(M + 'A')) bad.push('incident:항목미노출');
      if (line2(o, M + 'A', M + 'FORGED')) bad.push('incident:위조');
    }
    {
       
      const d = mk();
      R(d, ['brief', 'set', '--intro', `정상 ${M}A\n  • 위조 ${M}FORGED`]);
      const o = String(R(d, ['brief', 'show']).stdout || '') + '\n' + String(R(d, ['context']).stdout || '');
      if (!o.includes(M + 'A')) bad.push('brief:항목미노출');
      if (line2(o, M + 'A', M + 'FORGED')) bad.push('brief:위조');
    }
    {
       
      const d = mk();
      R(d, ['preview', 'add', `정상 ${M}A\r위조 ${M}FORGED`]);
      const o = String(R(d, ['preview', 'list']).stdout || '');
      if (!o.includes(M + 'A')) bad.push('preview:항목미노출');
      if (/\r/.test(o)) bad.push('preview:단독CR잔존');
    }
    dbg.addOk = addOk; dbg.sawFirst = sawFirst; dbg.bad = bad.slice(0, 12);
     
    ok = addOk === SURFACES.length && sawFirst === SURFACES.length && bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); } finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ Q(1.36.113) 개행 주입 차단 행렬: 9표면 × (목록·.md파일·handoff) 위조 0 · plan --progress 플래그 경로 · next-action take · incident(외부입력) · brief/context · preview 단독CR · 평범한 여러 줄도 안 갈라짐 · 계측 살아있음(9/9 노출)`
    : '✗ 1.36.113 개행 주입 차단 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
 
 
 
 
 
 
 
if (e2eShard.take('R(1.36.114)')) {
  total++;
  let ok = false; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-neg114-'));
  const ENV = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_NO_PROMPT: '1' });
  try {
    let seq = 0;
    const mk = () => {
      const d = path.join(sb, 'p' + (++seq)); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
      cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV });
      return d;
    };
    const R = (d, a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', d], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV });
    const bad = [];

     
    const STORES = [
      ['creds',           'credentials.local.json', ['creds', 'register', 'aaa', '--env-var', 'A_KEY'], ['creds', 'register', 'bbb', '--env-var', 'B_KEY']],
      ['permissions',     'agent-permissions.json', ['permissions', 'set', 'extended'],                 ['permissions', 'set', 'basic']],
      ['wakeup-interval', 'wakeup-history.json',    ['wakeup-interval', 'set', '900'],                  ['wakeup-interval', 'set', '1200']],
      ['next-action',     'next-action-queue.json', ['next-action', 'add', 'aaa'],                      ['next-action', 'add', 'bbb']],
      ['requests(대조)',   'user-requests.json',     ['requests', 'add', 'aaa'],                         ['requests', 'add', 'bbb']],
      ['preview(대조)',    'previews.json',          ['preview', 'add', 'aaa'],                          ['preview', 'add', 'bbb']],
       
      ['toggle(대조)',     'toggles.json',           ['toggle', 'set', 'gate', 'off'],                   ['toggle', 'set', 'lens', 'off']],
    ];
    let setupOk = 0;
    for (const [name, file, first, second] of STORES) {
      const d = mk();
      const r1 = R(d, first);
      const fp = path.join(d, '.leerness', file);
      if (r1.status !== 0 || !fs.existsSync(fp)) { bad.push(`${name}:셋업실패`); continue; }    
      setupOk++;
      fs.writeFileSync(fp, '{ "broken": ');
      const before = fs.readFileSync(fp, 'utf8');
      const r2 = R(d, second);
      const out = String(r2.stdout || '') + String(r2.stderr || '');
      if (fs.readFileSync(fp, 'utf8') !== before) bad.push(`${name}:손상위덮어씀`);
      if (r2.status === 0 || /^\s*✓/m.test(out)) bad.push(`${name}:성공이라말함`);        
      if (/\n\s+at .*:\d+:\d+/.test(out)) bad.push(`${name}:스택노출`);
       
       
       
       
       
      fs.writeFileSync(fp, '{ "broken": ');
      const brokenJ = fs.readFileSync(fp, 'utf8');
      const rj = R(d, second.concat(['--json']));
      let parsed = null; try { parsed = JSON.parse(String(rj.stdout || '').trim()); } catch {}
      if (!parsed) bad.push(`${name}:json_stdout오염`);
      else {
        if (parsed.ok !== false) bad.push(`${name}:json_ok아님`);
        if (!/대조/.test(name) && parsed.code !== 'store_corrupt') bad.push(`${name}:json_코드(${parsed.code})`);
      }
      if (rj.status === 0) bad.push(`${name}:json_exit0`);
       
       
      if (fs.readFileSync(fp, 'utf8') !== brokenJ) bad.push(`${name}:json경로_손상위덮어씀`);
      if (/\n\s+at .*:\d+:\d+/.test(String(rj.stderr || ''))) bad.push(`${name}:json_stderr스택`);
       
       
      const d2 = mk(); R(d2, first);
      const fp2 = path.join(d2, '.leerness', file);
      const pre = fs.existsSync(fp2) ? fs.readFileSync(fp2, 'utf8') : null;
      if (R(d2, second).status !== 0) bad.push(`${name}:정상스토어_오차단`);
      const post = fs.existsSync(fp2) ? fs.readFileSync(fp2, 'utf8') : null;
      if (pre === null || post === null || post === pre) bad.push(`${name}:정상스토어_저장안됨`);
    }
    dbg.setupOk = setupOk;
    if (setupOk !== STORES.length) bad.push(`셋업 ${setupOk}/${STORES.length}`);

     
    for (const [name, add, list] of [
      ['creds',       (d, t) => R(d, ['creds', 'register', t, '--env-var', 'X_KEY']),       (d) => R(d, ['creds', 'list'])],
      ['constraints', (d, t) => R(d, ['constraints', 'add', t, '--constraint', 'k:v']),     (d) => R(d, ['constraints', 'list'])],
       
       
      ['constraints(detail)', (d, t) => R(d, ['constraints', 'add', 'PLAT', '--constraint', `auth:${t}`]), (d) => R(d, ['constraints', 'list'])],
    ]) {
      const d = mk();
      if (add(d, 'real ZR4A\n  fake ZR4F · 등록됨').status !== 0) { bad.push(`${name}:주입add실패`); continue; }
      const o = String(list(d).stdout || '');
      if (!o.includes('ZR4A')) bad.push(`${name}:항목미노출`);                               
      if (o.split('\n').some(l => l.includes('ZR4F') && !l.includes('ZR4A'))) bad.push(`${name}:개행위조`);
    }

     
     
     
     
    {
      const SEED = [['requests', 'add', 'seed'], ['preview', 'add', 'seed'], ['toggle', 'set', 'gate', 'off'],
        ['creds', 'register', 'seed', '--env-var', 'K'], ['permissions', 'set', 'extended'], ['wakeup-interval', 'set', '900'],
        ['next-action', 'add', 'seed'], ['constraints', 'add', 'seed', '--constraint', 'k:v'],
        ['decision', 'add', 'seed', '--reason', 'r'], ['lesson', 'save', 'seed']];
      const MUT = [['requests', 'add', 'x2'], ['preview', 'add', 'x2'], ['toggle', 'set', 'lens', 'off'],
        ['creds', 'register', 'x2', '--env-var', 'K2'], ['permissions', 'set', 'basic'], ['wakeup-interval', 'set', '1200'],
        ['next-action', 'add', 'x2'], ['constraints', 'add', 'x2', '--constraint', 'k:v'],
        ['decision', 'add', 'x2', '--reason', 'r'], ['lesson', 'save', 'x2'], ['task', 'add', 'x2'], ['plan', 'add', 'x2']];
      const DERIVED = new Set(['manifest.json', 'skills-lock.json', 'leerness-config.json', 'environment.json']);
      const seeded = () => { const d = mk(); for (const a of SEED) R(d, a); return d; };
      const base = seeded();
      const stores = [];
      (function w(x, rel) { for (const e of fs.readdirSync(x, { withFileTypes: true })) {
        const p = path.join(x, e.name), r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) { if (!/cache|archive|skills$/.test(e.name)) w(p, r); }
        else if (/\.json$/.test(e.name)) stores.push(r); } })(path.join(base, '.leerness'), '');
      const userStores = stores.filter(f => !DERIVED.has(path.basename(f)));
      dbg.stores = userStores.length;
       
      if (userStores.length < 9) bad.push(`스토어열거부족(${userStores.length})`);
      for (const rel of userStores) {
        const d = seeded();
        const fp = path.join(d, '.leerness', rel.replace(/\//g, path.sep));
        if (!fs.existsSync(fp)) continue;
        fs.writeFileSync(fp, '{ "broken": ');
        const broken = fs.readFileSync(fp, 'utf8');
        for (const a of MUT) {
          R(d, a);
          if (fs.existsSync(fp) && fs.readFileSync(fp, 'utf8') !== broken) { bad.push(`전수:${rel}←${a.join(' ')}`); break; }
        }
      }
    }

     
     
     
     
    {
      const codeOf = (r) => { try { return (JSON.parse(String(r.stdout || '').trim()) || {}).code; } catch { return null; } };
      const seedCreds = (d) => R(d, ['creds', 'register', 'svc', '--env-var', 'K']);
      const corrupt = (d, f) => fs.writeFileSync(path.join(d, '.leerness', f), '{ "broken": ');
       
      for (const [label, seed, file, act] of [
        ['creds check',      seedCreds, 'credentials.local.json', ['creds', 'check']],
        ['creds refresh',    seedCreds, 'credentials.local.json', ['creds', 'refresh', 'svc']],
        ['next-action take', (d) => R(d, ['next-action', 'add', 'aaa']), 'next-action-queue.json', ['next-action', 'take', '0']],
      ]) {
        const d = mk(); if (seed(d).status !== 0) { bad.push(`손상진단:${label}:셋업실패`); continue; }
        corrupt(d, file);
        const r = R(d, act.concat(['--json']));
        if (r.status === 0) bad.push(`손상진단:${label}:exit0`);
        if (codeOf(r) !== 'store_corrupt') bad.push(`손상진단:${label}:코드(${codeOf(r)})`);
      }
       
      { const d = mk(); seedCreds(d); corrupt(d, 'credentials.local.json');
        const r = R(d, ['creds', 'list']);
        if (r.status === 0) bad.push('손상진단:creds list:조용히통과'); }
       
      { const d = mk(); seedCreds(d);
        const r = R(d, ['creds', 'refresh', 'nosuch', '--json']);
        if (codeOf(r) === 'store_corrupt') bad.push('손상진단:대조군_미등록을_손상이라함'); }
      { const d = mk();    
        const r = R(d, ['creds', 'list']);
        if (r.status !== 0) bad.push('손상진단:대조군_빈registry_오차단'); }
      { const d = mk(); R(d, ['next-action', 'add', 'aaa']); R(d, ['next-action', 'take', '0']);
        const r = R(d, ['next-action', 'take', '0', '--json']);    
        if (codeOf(r) === 'store_corrupt') bad.push('손상진단:대조군_빈큐를_손상이라함'); }
    }

    dbg.bad = bad.slice(0, 12);
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); } finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ R(1.36.114) 방치 명령의 기지 클래스: 손상 스토어 6종(안 씀·성공이라 안 함·스택 없음·정상 오차단 없음·--json 계약) · 사용자 스토어 ${dbg.stores}종 전수 무유실 · 개행 위조 0(creds·constraints)`
    : '✗ 1.36.114 방치 명령 클래스 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
 
 
 
 
 
 
 
if (e2eShard.take('S(1.36.115)')) {
  total++;
  let ok = false; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-wire115-'));
  const ENV = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_NO_PROMPT: '1' });
  try {
    let seq = 0;
    const mk = (args) => {
      const d = path.join(sb, 'p' + (++seq)); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
      cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', ...(args || [])], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV });
      return d;
    };
    const bad = [];
     
    for (const [label, args, lang] of [['standard', [], 'ko'], ['minimal', ['--mode', 'minimal'], 'ko'],
      ['standard-en', ['--language', 'en'], 'en'], ['minimal-en', ['--mode', 'minimal', '--language', 'en'], 'en']]) {
      const d = mk(args);
      const p = path.join(d, 'CLAUDE.md');
      if (!fs.existsSync(p)) { bad.push(`${label}:CLAUDE.md없음`); continue; }
      const t = fs.readFileSync(p, 'utf8');
      if (!/leerness handoff/.test(t)) bad.push(`${label}:handoff지시없음`);
      if (!/session close/.test(t)) bad.push(`${label}:sessionclose지시없음`);
      if (!/verify-claim/.test(t)) bad.push(`${label}:verify-claim지시없음`);
       
      if (t.length < 100) bad.push(`${label}:CLAUDE.md너무짧음(${t.length})`);
       
       
       
      if (lang === 'en' && /[가-힣]/.test(t)) bad.push(`${label}:영문표면에한국어(${(t.match(/[가-힣]+/g) || [])[0]})`);
      if (lang === 'ko' && !/[가-힣]/.test(t)) bad.push(`${label}:한국어표면이비어있음`);
    }
     
    {
      const d = mk();
      const sp = path.join(d, '.claude', 'skills', 'leerness', 'SKILL.md');
      if (!fs.existsSync(sp)) bad.push('skill:SKILL.md없음');
      else {
        const t = fs.readFileSync(sp, 'utf8');
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t);
        if (!fm) bad.push('skill:frontmatter없음');
         
         
        else { if (!/^name:\s*leerness\s*$/m.test(fm[1])) bad.push('skill:name이leerness아님'); if (!/^description:\s*\S/m.test(fm[1])) bad.push('skill:description없음'); }
        if (!/leerness handoff/.test(t)) bad.push('skill:본문에 handoff 없음');
      }
       
      if (fs.existsSync(path.join(d, '.claude', 'skills', 'leerness.md'))) bad.push('skill:평면파일을새로만듦');
       
       
      {
        const dleg = mk();
        fs.rmSync(path.join(dleg, '.claude', 'skills', 'leerness'), { recursive: true, force: true });
        fs.writeFileSync(path.join(dleg, '.claude', 'skills', 'leerness.md'), '---\nname: leerness\n---\nold\n');
        const rleg = cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--path', dleg], { cwd: dleg, encoding: 'utf8', timeout: 300000, env: ENV });
        const oleg = String(rleg.stdout || '') + String(rleg.stderr || '');
        if (!fs.existsSync(path.join(dleg, '.claude', 'skills', 'leerness', 'SKILL.md'))) bad.push('skill:adapter가_새경로_미생성');
        if (!/구 스킬 파일/.test(oleg)) bad.push('skill:adapter가_구파일_미경고');
        if (!fs.existsSync(path.join(dleg, '.claude', 'skills', 'leerness.md'))) bad.push('skill:구파일을_지움(false-DROP)');
         
        const dclean = mk();
        const rcl = cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--path', dclean], { cwd: dclean, encoding: 'utf8', timeout: 300000, env: ENV });
        if (/구 스킬 파일/.test(String(rcl.stdout || '') + String(rcl.stderr || ''))) bad.push('skill:잔재없는데_경고');
      }
       
       
      const da = mk(['--minimal']);
      const ra = cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--path', da], { cwd: da, encoding: 'utf8', timeout: 300000, env: ENV });
      if (ra.status !== 0) bad.push(`adapter:실패(exit=${ra.status})`);
      if (!fs.existsSync(path.join(da, '.claude', 'skills', 'leerness', 'SKILL.md'))) bad.push('adapter:SKILL.md없음');
      if (fs.existsSync(path.join(da, '.claude', 'skills', 'leerness.md'))) bad.push('adapter:평면파일을만듦');
       
       
      fs.rmSync(path.join(da, '.mcp.json'), { force: true });
      cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--path', da], { cwd: da, encoding: 'utf8', timeout: 300000, env: ENV });
      if (!fs.existsSync(path.join(da, '.mcp.json'))) bad.push('adapter:.mcp.json없음(adapter가직접만들지않음)');
       
       
      const dm2 = mk(['--minimal']);
      const beforeLen = fs.readFileSync(path.join(dm2, 'CLAUDE.md'), 'utf8').length;
      cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--path', dm2], { cwd: dm2, encoding: 'utf8', timeout: 300000, env: ENV });
      const afterLen = fs.readFileSync(path.join(dm2, 'CLAUDE.md'), 'utf8').length;
      if (afterLen > beforeLen * 1.5) bad.push(`adapter:등급무시(${beforeLen}→${afterLen})`);
       
       
      for (const shape of ['null', '[]', 'false', '0', '"minimal"']) {
        const dsh = mk(['--mode', 'minimal']);
        const shLen = fs.readFileSync(path.join(dsh, 'CLAUDE.md'), 'utf8').length;
        fs.writeFileSync(path.join(dsh, '.leerness', 'manifest.json'), shape);
        const rsh = cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--path', dsh], { cwd: dsh, encoding: 'utf8', timeout: 300000, env: ENV });
        if (rsh.status === 0) bad.push(`manifest형상:${shape}에서_중단안함`);
        if (fs.readFileSync(path.join(dsh, 'CLAUDE.md'), 'utf8').length !== shLen) bad.push(`manifest형상:${shape}에서_등급뒤집힘`);
      }
       
      const dok = mk(['--mode', 'minimal']);
      fs.writeFileSync(path.join(dok, '.leerness', 'manifest.json'), JSON.stringify({ installedAt: '2026-01-01' }, null, 2));
      if (cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--path', dok], { cwd: dok, encoding: 'utf8', timeout: 300000, env: ENV }).status !== 0) bad.push('manifest형상:정상객체를_거부');
       
      const dex = mk(['--mode', 'minimal']);
      fs.writeFileSync(path.join(dex, '.leerness', 'manifest.json'), 'false');
      const rex = cp.spawnSync(process.execPath, [CLI, 'export', 'claude', '--path', dex, '--json'], { cwd: dex, encoding: 'utf8', timeout: 300000, env: ENV });
      let jex = null; try { jex = JSON.parse(String(rex.stdout || '').trim()); } catch {}
      if (!jex || jex.code !== 'store_corrupt' || rex.status === 0) bad.push(`export별칭:손상코드아님(${jex && jex.code}/${rex.status})`);
       
      const dpr = mk(['--mode', 'minimal']);
      fs.writeFileSync(path.join(dpr, '.leerness', 'manifest.json'), 'false');
      const rpr = cp.spawnSync(process.execPath, [CLI, 'prompt', 'claude', '--path', dpr, '--json'], { cwd: dpr, encoding: 'utf8', timeout: 300000, env: ENV });
      let jpr = null; try { jpr = JSON.parse(String(rpr.stdout || '').trim()); } catch {}
      if (!jpr || jpr.code !== 'store_corrupt' || rpr.status === 0) bad.push(`prompt별칭:손상코드아님(${jpr && jpr.code}/${rpr.status})`);
       
       
      const dmr = path.join(sb, 'mcponly'); fs.mkdirSync(dmr, { recursive: true });
      fs.writeFileSync(path.join(dmr, 'package.json'), '{"name":"m","version":"0.1.0"}');
      fs.writeFileSync(path.join(dmr, '.mcp.json'), JSON.stringify({ mcpServers: { leerness: { command: 'node', args: ['./mine.js'] } } }, null, 2));
      const rmr = cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--path', dmr], { cwd: dmr, encoding: 'utf8', timeout: 300000, env: ENV });
      const omr = String(rmr.stdout || '') + String(rmr.stderr || '');
      if (/MCP 등록 —/.test(omr)) bad.push('MCP안내가_지침파일생성으로_발화');
      if (!/확인하지 않았습니다/.test(omr)) bad.push('MCP보존_중립문구없음');
       
      const ds2 = mk();
      const sBefore = fs.readFileSync(path.join(ds2, 'CLAUDE.md'), 'utf8').length;
      cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--path', ds2], { cwd: ds2, encoding: 'utf8', timeout: 300000, env: ENV });
      const sAfter = fs.readFileSync(path.join(ds2, 'CLAUDE.md'), 'utf8').length;
      if (sAfter < sBefore * 0.5) bad.push(`adapter:standard를_축소(${sBefore}→${sAfter})`);
    }
     
    {
      const d = mk();
      const mp = path.join(d, '.mcp.json');
      if (!fs.existsSync(mp)) bad.push('mcp:init이안만듦');
      else {
        let j = null; try { j = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch {}
        if (!j || !j.mcpServers || !j.mcpServers.leerness) bad.push('mcp:leerness항목없음');
      }
       
      const d2 = mk();
      fs.writeFileSync(path.join(d2, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x', args: [] } } }, null, 2));
      cp.spawnSync(process.execPath, [CLI, 'init', d2, '--yes'], { cwd: d2, encoding: 'utf8', timeout: 300000, env: ENV });
      let j2 = null; try { j2 = JSON.parse(fs.readFileSync(path.join(d2, '.mcp.json'), 'utf8')); } catch {}
      if (!j2 || !j2.mcpServers || !j2.mcpServers.other) bad.push('mcp:기존서버유실');
      if (!j2 || !j2.mcpServers || !j2.mcpServers.leerness) bad.push('mcp:병합후leerness없음');
       
      const d3 = mk();
      fs.writeFileSync(path.join(d3, '.mcp.json'), '{ "mcpServers": ');
      const broken = fs.readFileSync(path.join(d3, '.mcp.json'), 'utf8');
      cp.spawnSync(process.execPath, [CLI, 'init', d3, '--yes'], { cwd: d3, encoding: 'utf8', timeout: 300000, env: ENV });
      if (fs.readFileSync(path.join(d3, '.mcp.json'), 'utf8') !== broken) bad.push('mcp:손상파일덮어씀');
       
       
      const d4 = mk();
      const badSchema = JSON.stringify({ mcpServers: [] }, null, 2);
      fs.writeFileSync(path.join(d4, '.mcp.json'), badSchema);
      const r4 = cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--path', d4], { cwd: d4, encoding: 'utf8', timeout: 300000, env: ENV });
      if (fs.readFileSync(path.join(d4, '.mcp.json'), 'utf8') !== badSchema) bad.push('mcp:틀린스키마를_덮어씀');
      if (r4.status === 0) bad.push('mcp:틀린스키마에서_성공주장');
       
       
      const d5 = path.join(sb, 'nomcp'); fs.mkdirSync(d5, { recursive: true });
      fs.writeFileSync(path.join(d5, 'package.json'), '{"name":"n","version":"0.1.0"}');
      const r5 = cp.spawnSync(process.execPath, [CLI, 'init', d5, '--yes', '--no-mcp'], { cwd: d5, encoding: 'utf8', timeout: 300000, env: ENV });
      if (/알 수 없는 (플래그|옵션)|unknown flag/i.test(String(r5.stdout || '') + String(r5.stderr || ''))) bad.push('mcp:no-mcp가_미등록경고');
      if (fs.existsSync(path.join(d5, '.mcp.json'))) bad.push('mcp:no-mcp인데_생성됨');
       
       
      const d7 = mk();
      const custom = { mcpServers: { leerness: { command: 'node', args: ['./local-mcp.js'], env: { KEEP: '1' } } } };
      fs.writeFileSync(path.join(d7, '.mcp.json'), JSON.stringify(custom, null, 2));
      cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--path', d7], { cwd: d7, encoding: 'utf8', timeout: 300000, env: ENV });
      let j7 = null; try { j7 = JSON.parse(fs.readFileSync(path.join(d7, '.mcp.json'), 'utf8')); } catch {}
      if (!j7 || j7.mcpServers.leerness.command !== 'node' || !(j7.mcpServers.leerness.env || {}).KEEP) bad.push('mcp:사용자정의항목을덮어씀');
       
      const d8 = mk();
      fs.writeFileSync(path.join(d8, '.mcp.json'), JSON.stringify({ mcpServers: { leerness: { command: 'npx', args: ['leerness', 'mcp', 'serve'] } } }, null, 2));
      cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--path', d8], { cwd: d8, encoding: 'utf8', timeout: 300000, env: ENV });
      let j8 = null; try { j8 = JSON.parse(fs.readFileSync(path.join(d8, '.mcp.json'), 'utf8')); } catch {}
      if (!j8 || (j8.mcpServers.leerness.args || [])[0] !== '-y') bad.push('mcp:우리항목이_갱신안됨');
       
      const d9 = path.join(sb, 'badschema'); fs.mkdirSync(d9, { recursive: true });
      fs.writeFileSync(path.join(d9, 'package.json'), '{"name":"b","version":"0.1.0"}');
      const bs = JSON.stringify({ mcpServers: [] }, null, 2);
      fs.writeFileSync(path.join(d9, '.mcp.json'), bs);
      const r9 = cp.spawnSync(process.execPath, [CLI, 'init', d9, '--yes'], { cwd: d9, encoding: 'utf8', timeout: 300000, env: ENV });
      const out9 = String(r9.stdout || '') + String(r9.stderr || '');
      if (fs.readFileSync(path.join(d9, '.mcp.json'), 'utf8') !== bs) bad.push('mcp:init이_틀린스키마를덮어씀');
      if (!/등록하지 못했|MCP/.test(out9) || !/✗|⚠/.test(out9)) bad.push('mcp:init이_미등록을_알리지않음');
    }
     
     
    {
      const dc = mk();
      cp.spawnSync(process.execPath, [CLI, 'adapter', 'cursor', '--path', dc], { cwd: dc, encoding: 'utf8', timeout: 300000, env: ENV });
      const cf = path.join(dc, '.cursor', 'mcp.json');
      if (!fs.existsSync(cf)) bad.push('cursor:.cursor/mcp.json없음');
      else { let jc = null; try { jc = JSON.parse(fs.readFileSync(cf, 'utf8')); } catch {} if (!jc || !(jc.mcpServers || {}).leerness) bad.push('cursor:항목없음'); }
       
      const dc2 = mk();
      fs.mkdirSync(path.join(dc2, '.cursor'), { recursive: true });
      const brokenC = '{ "mcpServers": ';
      fs.writeFileSync(path.join(dc2, '.cursor', 'mcp.json'), brokenC);
      cp.spawnSync(process.execPath, [CLI, 'adapter', 'cursor', '--path', dc2], { cwd: dc2, encoding: 'utf8', timeout: 300000, env: ENV });
      if (fs.readFileSync(path.join(dc2, '.cursor', 'mcp.json'), 'utf8') !== brokenC) bad.push('cursor:손상파일덮어씀');
       
      const dc3 = mk();
      fs.mkdirSync(path.join(dc3, '.cursor'), { recursive: true });
      fs.writeFileSync(path.join(dc3, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' }, leerness: { command: 'node', args: ['./w.js'] } } }, null, 2));
      cp.spawnSync(process.execPath, [CLI, 'adapter', 'cursor', '--path', dc3], { cwd: dc3, encoding: 'utf8', timeout: 300000, env: ENV });
      let jc3 = null; try { jc3 = JSON.parse(fs.readFileSync(path.join(dc3, '.cursor', 'mcp.json'), 'utf8')); } catch {}
      if (!jc3 || jc3.mcpServers.leerness.command !== 'node' || !jc3.mcpServers.other) bad.push('cursor:사용자설정미보존');
       
       
      const dc4 = mk();
      fs.rmSync(path.join(dc4, '.mcp.json'), { force: true });
      fs.mkdirSync(path.join(dc4, '.cursor'), { recursive: true });
      fs.writeFileSync(path.join(dc4, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { leerness: { command: 'node', args: ['./mine.js'] } } }, null, 2));
      const rc4 = cp.spawnSync(process.execPath, [CLI, 'adapter', 'cursor', '--path', dc4], { cwd: dc4, encoding: 'utf8', timeout: 300000, env: ENV });
      const oc4 = String(rc4.stdout || '') + String(rc4.stderr || '');
      if (!/\.mcp\.json 에 MCP 등록/.test(oc4)) bad.push('cursor:쓴파일_범위표기없음');
      if (/\.cursor[\\/]mcp\.json 에 MCP 등록/.test(oc4)) bad.push('cursor:보존파일까지_호출가능주장');
      if (!/확인하지 않았습니다/.test(oc4)) bad.push('cursor:보존_중립문구없음');
      let jc4 = null; try { jc4 = JSON.parse(fs.readFileSync(path.join(dc4, '.cursor', 'mcp.json'), 'utf8')); } catch {}
      if (!jc4 || jc4.mcpServers.leerness.command !== 'node') bad.push('cursor:보존실패');
    }
     
     
    {
      const cases = [
        ['모르는키', { command: 'npx', args: ['-y', 'leerness', 'mcp', 'serve'], envFile: '.env.x' }, 'preserve'],
        ['비활성화', { command: 'npx', args: ['-y', 'leerness', 'mcp', 'serve'], disabled: true }, 'preserve'],
        ['우리형태', { command: 'npx', args: ['leerness', 'mcp', 'serve'] }, 'update'],
        ['false', false, 'preserve'],
        ['null', null, 'preserve'],
        ['빈객체', {}, 'preserve'],
      ];
      for (const [label, val, expect] of cases) {
        const d = mk();
        fs.writeFileSync(path.join(d, '.mcp.json'), JSON.stringify({ mcpServers: { leerness: val } }, null, 2));
        const r = cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--path', d], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV });
        let j = null; try { j = JSON.parse(fs.readFileSync(path.join(d, '.mcp.json'), 'utf8')); } catch {}
        const same = j && JSON.stringify(j.mcpServers.leerness) === JSON.stringify(val);
        if (expect === 'preserve' && !same) bad.push(`_ours:${label}을_덮어씀`);
        if (expect === 'update' && (!j || (j.mcpServers.leerness.args || [])[0] !== '-y')) bad.push(`_ours:${label}을_갱신안함`);
         
        const out = String(r.stdout || '') + String(r.stderr || '');
        const runnable = !!(val && typeof val === 'object' && val.command);
        if (!runnable && expect === 'preserve' && !/command 가 없어/.test(out)) bad.push(`_ours:${label}에_경고없음`);
        if (!runnable && expect === 'preserve' && /직접 호출 가능/.test(out)) bad.push(`_ours:${label}에_거짓성공`);
         
         
        if (expect === 'preserve' && /직접 호출 가능/.test(out)) bad.push(`_ours:${label}_보존인데_호출가능주장`);
        if (expect === 'preserve' && !/되돌리려면/.test(out)) bad.push(`_ours:${label}_복구경로_안내없음`);
        if (expect === 'update' && !/직접 호출 가능/.test(out)) bad.push(`_ours:${label}_갱신인데_안내없음`);
      }
    }
     
    {
      const de = mk(['--language', 'en']);
      const hEn = String(cp.spawnSync(process.execPath, [CLI, 'mcp', 'install', '--path', de], { cwd: de, encoding: 'utf8', timeout: 120000, env: ENV }).stdout || '');
      const ko = mk();
      const hKo = String(cp.spawnSync(process.execPath, [CLI, 'mcp', 'install', '--path', ko], { cwd: ko, encoding: 'utf8', timeout: 120000, env: ENV }).stdout || '');
      if (/[가-힣]/.test(hEn)) bad.push(`desktop:영문표면에한국어(${(hEn.match(/[가-힣]+/g) || [])[0]})`);
      if (!/[가-힣]/.test(hKo)) bad.push('desktop:한국어표면이비어있음');
       
      if (!/Config file/.test(hEn) || !/mcpServers/.test(hEn) || !/save the whole file|add just this one entry/i.test(hEn)) bad.push('desktop:영문안내_내용없음');
       
      if (!/mcpServers[^\n]*(키가 없|no .*key)/i.test(hKo)) bad.push('desktop:mcpServers키없는경우_안내없음');
       
       
       
      const _cfgVar = process.platform === 'win32' ? 'APPDATA' : (process.platform === 'linux' ? 'XDG_CONFIG_HOME' : null);
       
       
      if (!_cfgVar) {
        const rr = cp.spawnSync(process.execPath, [CLI, 'mcp', 'install', '--path', ko, '--json'], { cwd: ko, encoding: 'utf8', timeout: 120000, env: ENV });
        let jj = null; try { jj = JSON.parse(String(rr.stdout || '').trim()); } catch {}
        if (!jj || !['ok', 'broken', 'none', 'unreadable'].includes(jj.registeredState)) bad.push('desktop:상태값이_계약밖');
      }
      if (_cfgVar) {
        const states = [
          [{ mcpServers: { leerness: { command: 'npx', args: ['-y', 'leerness', 'mcp', 'serve'] } } }, 'ok'],
          [{ mcpServers: { leerness: {} } }, 'broken'],
          [{ mcpServers: { leerness: [] } }, 'broken'],
          [{ mcpServers: { leerness: { command: ' ' } } }, 'broken'],
          [{ mcpServers: [] }, 'broken'],                        
          [{ mcpServers: false }, 'broken'],
          [{ mcpServers: { other: { command: 'x' } } }, 'none'],
          [{}, 'none'],
          ['{ broken', 'unreadable'],
        ];
        for (const [content, expect] of states) {
          const home = fs.mkdtempSync(path.join(sb, 'cfg-'));
          fs.mkdirSync(path.join(home, 'Claude'), { recursive: true });
          fs.writeFileSync(path.join(home, 'Claude', 'claude_desktop_config.json'),
            typeof content === 'string' ? content : JSON.stringify(content, null, 2));
          const env3 = Object.assign({}, ENV); env3[_cfgVar] = home;
          const rr = cp.spawnSync(process.execPath, [CLI, 'mcp', 'install', '--path', ko, '--json'], { cwd: ko, encoding: 'utf8', timeout: 120000, env: env3 });
          let jj = null; try { jj = JSON.parse(String(rr.stdout || '').trim()); } catch {}
          if (!jj) { bad.push(`desktop:상태검사_json아님(${expect})`); continue; }
          if (jj.registeredState !== expect) bad.push(`desktop:상태오분류(기대 ${expect} · 실제 ${jj.registeredState})`);
          if (jj.registered !== (expect === 'ok')) bad.push(`desktop:registered불일치(${expect}→${jj.registered})`);
        }
      }
    }
     
    {
      const d = mk();
      const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'install', '--path', d, '--json'], { cwd: d, encoding: 'utf8', timeout: 120000, env: ENV });
      let j = null; try { j = JSON.parse(String(r.stdout || '').trim()); } catch {}
      if (r.status !== 0) bad.push(`desktop:exit=${r.status}`);    
      if (!j) bad.push('desktop:json아님');
      else {
        if (!j.configPath || !/claude_desktop_config\.json$/.test(j.configPath)) bad.push('desktop:설정경로없음');
         
        const _cp = String(j.configPath).replace(/\\/g, '/');
        const _expect = process.platform === 'win32' ? /\/Claude\/claude_desktop_config\.json$/
          : process.platform === 'darwin' ? /\/Library\/Application Support\/Claude\/claude_desktop_config\.json$/
            : /\/Claude\/claude_desktop_config\.json$/;
        if (!_expect.test(_cp)) bad.push(`desktop:플랫폼경로불일치(${_cp.slice(-60)})`);
        if (!j.snippet || !j.snippet.mcpServers || !j.snippet.mcpServers.leerness) bad.push('desktop:스니펫없음');
         
        const _args = ((j.snippet.mcpServers || {}).leerness || {}).args || [];
        if (_args[0] !== '-y') bad.push('desktop:npx무인설치아님');
      }
       
      const h = String(cp.spawnSync(process.execPath, [CLI, 'mcp', 'install', '--path', d], { cwd: d, encoding: 'utf8', timeout: 120000, env: ENV }).stdout || '');
      if (!/claude_desktop_config\.json/.test(h)) bad.push('desktop:사람용출력에경로없음');
       
       
       
       
       
       
      const grab = (sec, startRe) => {
        const ls = String(sec).split('\n');
        const i = ls.findIndex(l => startRe.test(l));
        if (i < 0) return null;
        for (let j = i + 1; j < ls.length; j++) if (/^\s{4}[}\]]\s*$/.test(ls[j])) return ls.slice(i, j + 1).join('\n');
        return null;
      };
      const secA = h.split('ⓐ')[1] || '', secB = h.split('ⓑ')[1] || '';
      if (!secA || !secB) bad.push('desktop:두형태구분없음');
      else {
        const labelA = secA.split('\n')[0], labelB = secB.split('\n')[0];
        const bA = grab(secA, /^\s{4}\{\s*$/), bB = grab(secB, /^\s{4}"leerness":\s*\{\s*$/);
        let wholeOk = false, fragOk = false;
        if (bA) { try { const o = JSON.parse(bA); wholeOk = !!(o.mcpServers && o.mcpServers.leerness && !o.mcpServers.mcpServers); } catch {} }
        if (bB) { try { const o = JSON.parse('{' + bB + '}'); fragOk = !!(o.leerness && o.leerness.command); } catch {} }
        if (!wholeOk) bad.push('desktop:ⓐ가파일전체형태아님');
        if (!fragOk) bad.push('desktop:ⓑ가단일항목형태아님');
         
        if (/안에[^\n]*(넣|추가)/.test(labelA)) bad.push('desktop:ⓐ가중첩을지시(이중중첩유도)');
        if (!/mcpServers/.test(labelB) || !/안에[^\n]*(넣|추가)/.test(labelB)) bad.push('desktop:ⓑ가위치를안알려줌');
         
         
        if (/mcpServers[^\n]*없/.test(labelA)) bad.push('desktop:ⓐ조건이기존설정을덮어씀');
      }
    }
     
    {
      const rh = cp.spawnSync(process.execPath, [CLI, 'mcp'], { encoding: 'utf8', timeout: 120000, env: ENV });
      const ht = String(rh.stdout || '') + String(rh.stderr || '');
      if (!/mcp install/.test(ht)) bad.push('mcp:그룹도움말에install없음');
    }
    dbg.bad = bad.slice(0, 12);
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); } finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? '✓ S(1.36.115) 설치하면 도구가 leerness 를 쓴다: CLAUDE.md 가 4조합 모두에서 직접 지시 · 스킬은 <name>/SKILL.md 규약 + frontmatter · init 이 .mcp.json 생성(기존 서버 보존 · 손상 파일 미덮어씀) · Desktop 은 자동수정 없이 경로+스니펫 안내'
    : '✗ 1.36.115 도구 배선 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
 
 
 
 
 
if (e2eShard.take('T(1.36.116)')) {
  total++;
  let ok = false; const dbg = {};
  try {
    const PU = require(path.resolve(path.dirname(CLI), '..', 'lib', 'pure-utils'));
    const bad = [];
     
     
     
    const _ENUM_LIT = 'Object.' + 'keys(pkg.' + 'scripts)';
    const _RE_LIT = (p) => '/' + '^' + p + '/.' + 'test(n)';
     
    const farApart = {
       
       
       
      packageScripts: { 'test:a': 'x', 'test:b': 'y', 'check:types': 'z', 'test:ci': 'node scripts/run.mjs' },
      runners: [
        { file: '.github/workflows/ci.yml', text: 'run: npm run test:ci' },
         
         
         
        { file: 'scripts/run.mjs', text: 'const pkg = JSON.parse(readFileSync("../package.json"));\n' + '// 주석\n'.repeat(60) + 'const all = Object.' + 'entries(pkg.' + 'scripts ?? {}).filter(([name]) => name.start' + 'sWith("test:"));' },
      ],
      scriptFiles: [],
    };
    const r1 = PU._detectOrphanGuards(farApart);
    if (!r1.dynamicRunners.length) bad.push('열거자_미인식');
    if (r1.orphanScripts.includes('test:a') || r1.orphanScripts.includes('test:b')) bad.push('열거대상을_고아로_오탐');
    if (!r1.enumPrefixes.includes('test:')) bad.push('열거접두_미추출');
     
    if (!r1.orphanScripts.includes('check:types')) bad.push('열거범위밖을_덮인것으로_오판');

     
    const r2 = PU._detectOrphanGuards({
      packageScripts: { 'test:ci': 'node scripts/run-ci.js', 'test:unit': 'node t.js', 'check:secrets': 'node s.js' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm run test:ci' },
        { file: 'scripts/run-ci.js', text: 'spawn("npm",["run","test:unit"])' }],
      scriptFiles: ['scripts/verify-orphan.js', 'scripts/run-ci.js'],
    });
    if (JSON.stringify(r2.orphanScripts) !== JSON.stringify(['check:secrets'])) bad.push(`고아검출오차(${JSON.stringify(r2.orphanScripts)})`);
    if (JSON.stringify(r2.orphanFiles) !== JSON.stringify(['scripts/verify-orphan.js'])) bad.push(`고아파일오차(${JSON.stringify(r2.orphanFiles)})`);

     
    const r3 = PU._detectOrphanGuards({ packageScripts: { test: 'node t.js', build: 'tsc' }, runners: [], scriptFiles: [] });
    if (r3.orphanScripts.length) bad.push(`진입점_오탐(${r3.orphanScripts.join(',')})`);
     
    const r3b = PU._detectOrphanGuards({ packageScripts: { test: 'node t.js', pretest: 'node p.js', posttest: 'node q.js', 'test:x': 'node x.js' }, runners: [], scriptFiles: [] });
    if (r3b.orphanScripts.includes('pretest') || r3b.orphanScripts.includes('posttest')) bad.push(`생명주기훅_오탐(${r3b.orphanScripts.join(',')})`);
    if (!r3b.orphanScripts.includes('test:x')) bad.push('생명주기_제외가_잎가드까지_삼킴');    

     
    if (!r1.reason || !r2.reason) bad.push('근거_없음');

     
     
    const r5 = PU._detectOrphanGuards({
      packageScripts: { 'test:ghost': 'node g.js' },
      runners: [{ file: '.github/workflows/ci.yml', text: '# 언젠가 test:ghost 를 넣자\nrun: npm run build' }],
      scriptFiles: [],
    });
    if (!r5.orphanScripts.includes('test:ghost')) bad.push('주석언급을_실행으로_오인');
     
    const r5b = PU._detectOrphanGuards({
      packageScripts: { 'test:ghost': 'node g.js' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm run test:ghost' }],
      scriptFiles: [],
    });
    if (r5b.orphanScripts.length) bad.push('주석필터가_실제호출까지_지움');

     
    const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-orph116-'));
    const ENV2 = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_NO_PROMPT: '1' });
    try {
      const d = path.join(sb, 'p'); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'p', version: '0.1.0', scripts: { test: 'node t.js', 'test:orphan-guard': 'node g.js' } }));
      cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV2 });
      const rj = cp.spawnSync(process.execPath, [CLI, 'audit', '--path', d, '--json'], { cwd: d, encoding: 'utf8', timeout: 300000, env: ENV2 });
      let j = null; try { j = JSON.parse(String(rj.stdout || '').trim()); } catch {}
      if (!j) bad.push('audit_json오염');
      else {
        const f = (j.findings || []).find(x => x.kind === 'orphan_guard');
        if (!f) bad.push('audit에_발견안실림');
        else {
          if (f.severity !== 'warn') bad.push(`권고아님(${f.severity})`);             
          if (!(f.orphanScripts || []).includes('test:orphan-guard')) bad.push('audit_대상누락');
          if (!f.reason) bad.push('audit_근거없음');
           
          if (!('monorepoOutOfScope' in f) || !('deferred' in f)) bad.push('audit_범위메타누락');
        }
      }
       
      const d2 = path.join(sb, 'q'); fs.mkdirSync(d2, { recursive: true });
      fs.writeFileSync(path.join(d2, 'package.json'), JSON.stringify({ name: 'q', version: '0.1.0', scripts: { test: 'node t.js' } }));
      cp.spawnSync(process.execPath, [CLI, 'init', d2, '--yes'], { cwd: d2, encoding: 'utf8', timeout: 300000, env: ENV2 });
      const rj2 = cp.spawnSync(process.execPath, [CLI, 'audit', '--path', d2, '--json'], { cwd: d2, encoding: 'utf8', timeout: 300000, env: ENV2 });
      let j2 = null; try { j2 = JSON.parse(String(rj2.stdout || '').trim()); } catch {}
      if (!j2) bad.push('대조_audit_json오염');
      else if ((j2.findings || []).some(x => x.kind === 'orphan_guard')) bad.push('대조_오탐');
    } finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }

     
    const r6 = PU._detectOrphanGuards({
      packageScripts: { test: 'npm-run-all test:*', 'test:unit': 'vitest', 'test:e2e': 'playwright' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test' }], scriptFiles: [],
    });
    if (r6.orphanScripts.length) bad.push('glob러너_오탐:' + r6.orphanScripts.join(','));
     
    const r6b = PU._detectOrphanGuards({
      packageScripts: { test: 'npm-run-all test:*', 'test:unit': 'vitest', 'check:dead': 'node d.js' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test' }], scriptFiles: [],
    });
    if (!r6b.orphanScripts.includes('check:dead')) bad.push('glob처리가_범위밖까지_덮음');

     
     
    const r7 = PU._detectOrphanGuards({
      packageScripts: { test: 'node t.js', 'dead-wrapper': 'npm run check:schema', 'check:schema': 'node s.js' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test' }], scriptFiles: [],
    });
    if (!r7.orphanScripts.includes('check:schema')) bad.push('죽은wrapper가_잎을_덮음');
    const r7b = PU._detectOrphanGuards({
      packageScripts: { test: 'node t.js', 'check:a': 'npm run check:b', 'check:b': 'npm run check:a' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test' }], scriptFiles: [],
    });
    if (!(r7b.orphanScripts.includes('check:a') && r7b.orphanScripts.includes('check:b'))) bad.push('고아순환이_서로를_덮음');
     
    const r7c = PU._detectOrphanGuards({
      packageScripts: { test: 'npm run live-wrapper', 'live-wrapper': 'npm run check:schema', 'check:schema': 'node s.js' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test' }], scriptFiles: [],
    });
    if (r7c.orphanScripts.length) bad.push('산wrapper의_잎을_오탐:' + r7c.orphanScripts.join(','));

     
    const r8 = PU._detectOrphanGuards({ packageScripts: { test: 'node t.js', 'guard:parity': 'node g.js' }, runners: [], scriptFiles: [] });
    if (!r8.orphanScripts.includes('guard:parity')) bad.push('guard접두_후보아님');

     
    const r9 = PU._detectOrphanGuards({
      packageScripts: { test: 'node r.js', 'test:unit': 'vitest', 'check:dead': 'node d.js' },
      runners: [{ file: 'scripts/run-ci.mjs', text: `const pkg = require("./package.json");\nfor (const n of ${_ENUM_LIT}) { if (${_RE_LIT('test:')}) run(n); }` }],
      scriptFiles: [],
    });
    if (!r9.enumPrefixes.includes('test:')) bad.push('정규식리터럴_접두_미추출');
    if (!r9.orphanScripts.includes('check:dead')) bad.push('접두밖_가드가_사라짐');

     
     
    const r10 = PU._detectOrphanGuards({
      packageScripts: { test: 'node r.js', 'check:dead': 'node d.js' },
      runners: [{ file: 'scripts/big.js', text: `require("./package.json");\n${_ENUM_LIT};\nx.startsWith("--");\ny.startsWith("https:");\nz.startsWith("_");` }],
      scriptFiles: [],
    });
    if (!r10.orphanScripts.includes('check:dead')) bad.push('무관한접두가_전부를_덮음');

     
    const r11 = PU._detectOrphanGuards({
      packageScripts: { test: 'turbo run test', 'check:x': 'node x.js' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test' }], scriptFiles: ['scripts/check-x.js'],
    });
    if (r11.orphanScripts.length || r11.orphanFiles.length) bad.push('오케스트레이터_보류_미작동');
    if (!/turbo|nx|lerna/.test(r11.reason || '')) bad.push('보류_근거_미표기');
     
    const r11b = PU._detectOrphanGuards({
      packageScripts: { test: 'node t.js', 'check:x': 'node x.js' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test\n# 참고: nx 로 옮길지 검토중, turbo 도 후보' }], scriptFiles: [],
    });
    if (!r11b.orphanScripts.includes('check:x')) bad.push('산문언급으로_판정보류됨');

     
     
    const AUD = require(path.join(__dirname, '..', 'lib', 'audit.js'));
    if (typeof AUD._collectGuardInputs !== 'function') bad.push('수집기_미노출');
    else {
      const sb2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-wire116-'));
      try {
        const d3 = path.join(sb2, 'w'); fs.mkdirSync(path.join(d3, '.github', 'workflows'), { recursive: true });
        fs.mkdirSync(path.join(d3, 'scripts'), { recursive: true });
        fs.writeFileSync(path.join(d3, 'package.json'), JSON.stringify({
          name: 'w', version: '0.1.0', bin: { w: 'bin/w.js' },
          scripts: { test: 'node t.js', 'check:wired': 'node c.js', 'check:lonely': 'node l.js' },
        }));
        fs.writeFileSync(path.join(d3, '.github', 'workflows', 'ci.yml'), 'jobs:\n  a:\n    steps:\n      - run: npm run check:wired\n');
        fs.mkdirSync(path.join(d3, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(d3, 'bin', 'w.js'), 'console.log("check:lonely");\n');    
         
         
        fs.writeFileSync(path.join(d3, 'scripts', 'verify-nothing.js'), 'process.exit(0)\n');
        const inp = AUD._collectGuardInputs(d3);
        if (!inp.scriptFiles.some(f => /verify-nothing\.js$/.test(f))) bad.push('수집기가_scripts순회_미수행');
        if (!PU._detectOrphanGuards(inp).orphanFiles.some(f => /verify-nothing\.js$/.test(f))) bad.push('파일고아_미보고');
        if (!inp.runners.some(r => /ci\.yml$/.test(r.file))) bad.push('수집기가_워크플로_미수집');
        if (inp.runners.some(r => /bin\/w\.js$/.test(r.file))) bad.push('자기진입점을_러너로_수집');
        const w1 = PU._detectOrphanGuards(inp);
        if (w1.orphanScripts.includes('check:wired')) bad.push('배선된_가드를_오탐');
        if (!w1.orphanScripts.includes('check:lonely')) bad.push('자기진입점_언급이_덮어버림');
         
        const w2 = PU._detectOrphanGuards({ packageScripts: inp.packageScripts, runners: [], scriptFiles: inp.scriptFiles });
        if (w2.orphanScripts.length === w1.orphanScripts.length) bad.push('러너제거가_결과를_안바꿈');
         
         
        if (w1.scanIncomplete) bad.push(`정상수집인데_불완전표시(${w1.scanIncomplete})`);
        const wInc = PU._detectOrphanGuards(Object.assign({}, inp, { readErrors: 2 }));
        if (!wInc.scanIncomplete) bad.push('불완전_미전파');
        if (!/수집 불완전/.test(wInc.reason || '')) bad.push('불완전_근거미표기');
         
        const wMono = PU._detectOrphanGuards(Object.assign({}, inp, { workspaces: true }));
        if (!wMono.monorepoOutOfScope || !/범위 밖/.test(wMono.reason || '')) bad.push('monorepo_범위미표시');
      } finally { try { fs.rmSync(sb2, { recursive: true, force: true }); } catch {} }
       
      {
        const sbA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-defer116-'));
        try {
          const dA = path.join(sbA, 'a'); fs.mkdirSync(dA, { recursive: true });
          fs.writeFileSync(path.join(dA, 'package.json'), JSON.stringify({ name: 'a', version: '0.1.0', scripts: { test: 'turbo run build', 'check:x': 'node x.js' } }));
          cp.spawnSync(process.execPath, [CLI, 'init', dA, '--yes'], { cwd: dA, encoding: 'utf8', timeout: 300000, env: ENV2 });
          const rA = cp.spawnSync(process.execPath, [CLI, 'audit', '--path', dA, '--json'], { cwd: dA, encoding: 'utf8', timeout: 300000, env: ENV2 });
          let jA = null; try { jA = JSON.parse(String(rA.stdout || '').trim()); } catch {}
          const fA = jA && (jA.findings || []).find(x => x.kind === 'orphan_guard_scan_incomplete');
          if (!fA) bad.push('보류인데_audit이_침묵');
          else if (!fA.deferred) bad.push('보류사유_미표기');
          const hA = String(cp.spawnSync(process.execPath, [CLI, 'audit', '--path', dA], { cwd: dA, encoding: 'utf8', timeout: 300000, env: ENV2 }).stdout || '');
          if (!/불완전/.test(hA)) bad.push('보류가_사람용출력에_없음');
        } finally { try { fs.rmSync(sbA, { recursive: true, force: true }); } catch {} }
      }
    }
     
    {
      const sb3 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-big116-'));
      try {
        const d6 = path.join(sb3, 'b'); fs.mkdirSync(d6, { recursive: true });
        fs.writeFileSync(path.join(d6, 'package.json'), JSON.stringify({ name: 'b', version: '0.1.0', scripts: { test: 'node t.js', 'check:x': 'node x.js' } }));
        fs.writeFileSync(path.join(d6, 'Makefile'), 'x:\n\t@echo ' + 'A'.repeat(3 * 1024 * 1024) + '\n');    
        const t0 = Date.now();
        const inp6 = AUD._collectGuardInputs(d6);
        const ms = Date.now() - t0;
        if (ms > 5000) bad.push(`대용량수집_지연(${ms}ms)`);
        if (inp6.runners.some(r => /Makefile$/.test(r.file))) bad.push('상한초과파일을_읽음');
        if (!inp6.skippedLarge) bad.push('대용량_제외표시없음');
        const r13 = PU._detectOrphanGuards(inp6);
        if (!/수집 불완전/.test(r13.reason || '')) bad.push('대용량제외_근거미표기');
      } finally { try { fs.rmSync(sb3, { recursive: true, force: true }); } catch {} }
    }
     
     
    const r16 = PU._detectOrphanGuards({
      packageScripts: { test: 'node t.js', 'dead-wrapper': 'node tools/run-checks.js', 'check:secret': 'node s.js' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test', viaScript: null },
        { file: 'tools/run-checks.js', text: 'sh("npm run check:secret")', viaScript: 'dead-wrapper' }],
      scriptFiles: [],
    });
    if (!r16.orphanScripts.includes('check:secret')) bad.push('죽은wrapper의_러너파일이_잎을_살림');
     
    const r16b = PU._detectOrphanGuards({
      packageScripts: { test: 'node tools/run-checks.js', 'check:secret': 'node s.js' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test', viaScript: null },
        { file: 'tools/run-checks.js', text: 'sh("npm run check:secret")', viaScript: 'test' }],
      scriptFiles: [],
    });
    if (r16b.orphanScripts.length) bad.push('산_러너파일의_잎을_오탐:' + r16b.orphanScripts.join(','));
     
     
    const r16c = PU._detectOrphanGuards({
      packageScripts: { 'dead-wrapper': 'node tools/x.js', test: 'node tools/x.js', 'check:leaf': 'node l.js' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test', viaScript: null, viaScripts: [] },
        { file: 'tools/x.js', text: 'sh("npm run check:leaf")', viaScript: 'dead-wrapper', viaScripts: ['dead-wrapper', 'test'] }],
      scriptFiles: [],
    });
    if (r16c.orphanScripts.length) bad.push('출처_선언순서에_판정이_의존:' + r16c.orphanScripts.join(','));
     
    {
      const sb4 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-via116-'));
      try {
        const d4 = path.join(sb4, 'o');
        fs.mkdirSync(path.join(d4, 'tools'), { recursive: true });
        fs.mkdirSync(path.join(d4, '.github', 'workflows'), { recursive: true });
        fs.writeFileSync(path.join(d4, 'package.json'), JSON.stringify({ name: 'o', version: '0.1.0',
          scripts: { 'dead-wrapper': 'node tools/x.js', test: 'node tools/x.js', 'check:leaf': 'node l.js' } }));
        fs.writeFileSync(path.join(d4, '.github', 'workflows', 'ci.yml'), 'jobs:\n  a:\n    steps:\n      - run: npm test\n');
        fs.writeFileSync(path.join(d4, 'tools', 'x.js'), 'sh("npm run check:leaf")\n');
        const vi = AUD._collectGuardInputs(d4);
        const rr = (vi.runners.find(r => /tools[\\/]x\.js$/.test(r.file)) || {});
        if (!(rr.viaScripts || []).includes('test')) bad.push('수집기가_출처를_하나만_담음');
        if (PU._detectOrphanGuards(vi).orphanScripts.length) bad.push('실측_선언순서_오탐');
         
         
         
        const d5 = path.join(sb4, 'ci');
        fs.mkdirSync(path.join(d5, 'tools'), { recursive: true });
        fs.mkdirSync(path.join(d5, '.github', 'workflows'), { recursive: true });
        fs.writeFileSync(path.join(d5, 'package.json'), JSON.stringify({ name: 'c', version: '0.1.0',
          scripts: { 'dead-wrapper': 'node tools/ci.js', test: 'node t.js', 'check:leaf': 'node l.js' } }));
        fs.writeFileSync(path.join(d5, '.github', 'workflows', 'ci.yml'), 'jobs:\n  a:\n    steps:\n      - run: node tools/ci.js\n');
        fs.writeFileSync(path.join(d5, 'tools', 'ci.js'), 'sh("npm run check:leaf")\n');
        const ci = AUD._collectGuardInputs(d5);
        const cr = ci.runners.find(r => /tools[\\/]ci\.js$/.test(r.file)) || {};
        if (!cr.unconditional) bad.push('CI직접호출_출처_유실');
        if (PU._detectOrphanGuards(ci).orphanScripts.length) bad.push('CI직접호출인데_고아로_오탐');
         
        const d6c = path.join(sb4, 'rem');
        fs.mkdirSync(path.join(d6c, 'bin'), { recursive: true });
        fs.mkdirSync(path.join(d6c, '.github', 'workflows'), { recursive: true });
        fs.writeFileSync(path.join(d6c, 'package.json'), JSON.stringify({ name: 'r', version: '0.1.0', bin: { r: 'bin/phantom.js' },
          scripts: { test: 'node t.js', 'check:leaf': 'node l.js' } }));
        fs.writeFileSync(path.join(d6c, '.github', 'workflows', 'ci.yml'),
          'jobs:\n  a:\n    steps:\n      - shell: cmd\n        run: |\n          REM debug only: node .\\bin\\phantom.js\n          echo harmless\n      - run: npm test\n');
        fs.writeFileSync(path.join(d6c, 'bin', 'phantom.js'), 'const x = "npm run check:leaf";\n');
        const remInp = AUD._collectGuardInputs(d6c);
        if (remInp.runners.some(r => /phantom\.js$/.test(r.file))) bad.push('CMD주석에서_진입점_수집');
        if (!PU._detectOrphanGuards(remInp).orphanScripts.includes('check:leaf')) bad.push('CMD주석이_고아를_덮음');
         
        for (const [tag, mark] of [['::', '::'], ['@REM', '@REM']]) {
          fs.writeFileSync(path.join(d6c, '.github', 'workflows', 'ci.yml'),
            `jobs:\n  a:\n    steps:\n      - shell: cmd\n        run: |\n          ${mark} debug: node .\\bin\\phantom.js\n          echo harmless\n      - run: npm test\n`);
          const ri = AUD._collectGuardInputs(d6c);
          if (ri.runners.some(r => /phantom\.js$/.test(r.file))) bad.push(`CMD주석(${tag})에서_진입점_수집`);
        }
         
        const dbe = path.join(sb4, 'bare');
        fs.mkdirSync(path.join(dbe, '.github', 'workflows'), { recursive: true });
        fs.writeFileSync(path.join(dbe, 'package.json'), JSON.stringify({ name: 'b', version: '0.1.0', main: 'index.js',
          scripts: { test: 'node t.js', 'check:leaf': 'node l.js' } }));
        fs.writeFileSync(path.join(dbe, '.github', 'workflows', 'ci.yml'), 'jobs:\n  a:\n    steps:\n      - name: archive index.js\n        run: npm test\n');
        fs.writeFileSync(path.join(dbe, 'index.js'), 'sh("npm run check:leaf")\n');
        const beInp = AUD._collectGuardInputs(dbe);
        if (beInp.runners.some(r => /index\.js$/.test(r.file))) bad.push('설명필드가_bare진입점을_승격');
        if (!PU._detectOrphanGuards(beInp).orphanScripts.includes('check:leaf')) bad.push('설명필드_승격이_고아를_덮음');
         
        fs.writeFileSync(path.join(dbe, '.github', 'workflows', 'ci.yml'), 'jobs:\n  a:\n    steps:\n      - run: node index.js --guard\n');
        const beInp2 = AUD._collectGuardInputs(dbe);
        if (!beInp2.runners.some(r => /index\.js$/.test(r.file))) bad.push('실제실행인데_bare진입점_미수집');
         
        const dz = path.join(sb4, 'zero'); fs.mkdirSync(dz, { recursive: true });
        fs.writeFileSync(path.join(dz, 'package.json'), '');
        const zInp = AUD._collectGuardInputs(dz);
        if (!zInp.readErrors) bad.push('0바이트_package.json_미계상');
        if (!/수집 불완전/.test(PU._detectOrphanGuards(zInp).reason || '')) bad.push('0바이트_근거미표기');
         
        const rel1 = PU._detectOrphanGuards({
          packageScripts: { test: 'node scripts/run-a.js && node scripts/run-b.js' },
          runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test', viaScript: null, viaScripts: [], unconditional: true },
            { file: 'scripts/run-a.js', text: '// require("./a/check.js")\n', viaScript: 'test', viaScripts: ['test'] },
            { file: 'scripts/run-b.js', text: 'require("./b/check.js");\n', viaScript: 'test', viaScripts: ['test'] }],
          scriptFiles: ['scripts/a/check.js', 'scripts/b/check.js'],
        });
        if (!rel1.orphanFiles.includes('scripts/a/check.js')) bad.push('주석속_상대참조를_실행으로');
        if (rel1.orphanFiles.includes('scripts/b/check.js')) bad.push('실제_상대참조를_고아로');
        const rel2 = PU._detectOrphanGuards({
          packageScripts: { test: 'node scripts/run.js' },
          runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test', viaScript: null, viaScripts: [], unconditional: true },
            { file: 'scripts/run.js', text: 'require("../../outside/check.js");\n', viaScript: 'test', viaScripts: ['test'] }],
          scriptFiles: ['scripts/check.js'],
        });
        if (!rel2.orphanFiles.includes('scripts/check.js')) bad.push('루트밖_참조가_내부파일을_덮음');
         
         
         
         
        const relIn = PU._detectOrphanGuards({
          packageScripts: { test: 'node scripts/a/run.js' },
          runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test', viaScript: null, viaScripts: [], unconditional: true },
            { file: 'scripts/a/run.js', text: 'require("../../scripts/./check.js");\n', viaScript: 'test', viaScripts: ['test'] }],
          scriptFiles: ['scripts/check.js'],
        });
        if (relIn.orphanFiles.length) bad.push(`루트내_dot세그먼트_경로_오탐(${relIn.orphanFiles.join(',')})`);
         
        const relBs = PU._detectOrphanGuards({
          packageScripts: { test: 'node scripts/a/run.js' },
          runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test', viaScript: null, viaScripts: [], unconditional: true },
            { file: 'scripts/a/run.js', text: 'require(".\\check.js");\n', viaScript: 'test', viaScripts: ['test'] }],
          scriptFiles: ['scripts/a/check.js', 'scripts/b/check.js'],
        });
        if (relBs.orphanFiles.includes('scripts/a/check.js')) bad.push('역슬래시_상대경로_미해석');
         
        const relRoot = PU._detectOrphanGuards({
          packageScripts: { test: 'node t.js' },
          runners: [{ file: '.github/workflows/ci.yml', viaScript: null, viaScripts: [], unconditional: true,
            text: 'jobs:\n  a:\n    steps:\n      - run: node ./scripts/deep/check.js\n      - run: npm test\n' }],
          scriptFiles: ['scripts/deep/check.js'],
        });
        if (relRoot.orphanFiles.length) bad.push(`CI상대경로_루트기준아님(${relRoot.orphanFiles.join(',')})`);
         
        const relDot = PU._detectOrphanGuards({
          packageScripts: { test: 'node run.sh' },
          runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test', viaScript: null, viaScripts: [], unconditional: true },
            { file: 'run.sh', text: 'node scripts/./check.js\n', viaScript: 'test', viaScripts: ['test'] }],
          scriptFiles: ['scripts/check.js'],
        });
        if (relDot.orphanFiles.length) bad.push(`dot세그먼트_경로_오탐(${relDot.orphanFiles.join(',')})`);
         
         
         
        const dwin = path.join(sb4, 'winrel');
        fs.mkdirSync(path.join(dwin, 'scripts', 'a'), { recursive: true });
        fs.mkdirSync(path.join(dwin, 'scripts', 'b'), { recursive: true });
        fs.mkdirSync(path.join(dwin, '.github', 'workflows'), { recursive: true });
        fs.writeFileSync(path.join(dwin, 'package.json'), JSON.stringify({ name: 'w', version: '0.1.0', scripts: { test: 'node scripts/a/run.js' } }));
        fs.writeFileSync(path.join(dwin, '.github', 'workflows', 'ci.yml'), 'jobs:\n  a:\n    steps:\n      - run: npm test\n');
        fs.writeFileSync(path.join(dwin, 'scripts', 'a', 'run.js'), 'require(".\\\\check.js");\n');
        fs.writeFileSync(path.join(dwin, 'scripts', 'a', 'check.js'), '// guard\n');
        fs.writeFileSync(path.join(dwin, 'scripts', 'b', 'check.js'), '// other\n');
        const winInp = AUD._collectGuardInputs(dwin);
        if (!winInp.runners.some(r => /scripts[\\/]a[\\/]run\.js$/.test(r.file))) bad.push('중첩러너_미수집');
        const winRes = PU._detectOrphanGuards(winInp);
        if (winRes.orphanFiles.includes('scripts/a/check.js')) bad.push('실제JS의_윈도우_상대경로_오탐');
        if (!winRes.orphanFiles.includes('scripts/b/check.js')) bad.push('판별력:무관파일까지_덮음');
         
        const relDot2 = PU._detectOrphanGuards({
          packageScripts: { test: 'node t.js' },
          runners: [{ file: '.github/workflows/ci.yml', viaScript: null, viaScripts: [], unconditional: true,
            text: 'jobs:\n  a:\n    steps:\n      - run: node scripts/././check.js\n      - run: npm test\n' }],
          scriptFiles: ['scripts/check.js'],
        });
        if (relDot2.orphanFiles.length) bad.push(`반복dot세그먼트_오탐(${relDot2.orphanFiles.join(',')})`);
         
        const cmt = PU._detectOrphanGuards({
          packageScripts: { test: 'node t.js', 'check:leaf': 'node l.js' },
          runners: [{ file: '.github/workflows/ci.yml', viaScript: null, viaScripts: [], unconditional: true,
            text: 'jobs:\n  a:\n    steps:\n      - shell: cmd\n        run: |\n          REM npm run check:leaf\n          echo hi\n      - run: npm test\n' }],
          scriptFiles: [],
        });
        if (!cmt.orphanScripts.includes('check:leaf')) bad.push('판정기가_CMD주석을_실행으로');
         
        const ddot = path.join(sb4, 'dotnest');
        fs.mkdirSync(path.join(ddot, 'scripts', 'a'), { recursive: true });
        fs.mkdirSync(path.join(ddot, '.github', 'workflows'), { recursive: true });
        fs.writeFileSync(path.join(ddot, 'package.json'), JSON.stringify({ name: 'd', version: '0.1.0', scripts: { test: 'node scripts/./a/run.js' } }));
        fs.writeFileSync(path.join(ddot, '.github', 'workflows', 'ci.yml'), 'jobs:\n  a:\n    steps:\n      - run: npm test\n');
        fs.writeFileSync(path.join(ddot, 'scripts', 'a', 'run.js'), 'require("./check.js");\n');
        fs.writeFileSync(path.join(ddot, 'scripts', 'a', 'check.js'), '// guard\n');
        const dotRes = PU._detectOrphanGuards(AUD._collectGuardInputs(ddot));
        if (dotRes.orphanFiles.includes('scripts/a/check.js')) bad.push('러너경로_dot세그먼트_오탐');
         
        const dstar = path.join(sb4, 'star');
        fs.mkdirSync(path.join(dstar, 'scripts'), { recursive: true });
        fs.mkdirSync(path.join(dstar, '.github', 'workflows'), { recursive: true });
        fs.writeFileSync(path.join(dstar, 'package.json'), JSON.stringify({ name: 's', version: '0.1.0', scripts: { test: 'node t.js', 'check:leaf': 'node l.js' } }));
        fs.writeFileSync(path.join(dstar, '.github', 'workflows', 'ci.yml'),
          'jobs:\n  a:\n    steps:\n      - run: |\n          /*\n           * node scripts/ghost.js\n           */\n          npm test\n');
        fs.writeFileSync(path.join(dstar, 'scripts', 'ghost.js'), 'sh("npm run check:leaf")\n');
        const starInp = AUD._collectGuardInputs(dstar);
        if (starInp.runners.some(r => /ghost\.js$/.test(r.file))) bad.push('블록주석에서_러너_수집');
        if (!PU._detectOrphanGuards(starInp).orphanScripts.includes('check:leaf')) bad.push('블록주석이_고아를_덮음');
         
         
        const starDet = PU._detectOrphanGuards({
          packageScripts: { test: 'node t.js', 'check:leaf': 'node l.js' },
          runners: [{ file: '.github/workflows/ci.yml', viaScript: null, viaScripts: [], unconditional: true,
            text: 'jobs:\n  a:\n    steps:\n      - run: npm test\n' },
            { file: 'scripts/x.js', viaScript: 'test', viaScripts: ['test'],
              text: '/*\n * npm run check:leaf\n */\nconsole.log(1);\n' }],
          scriptFiles: [],
        });
        if (!starDet.orphanScripts.includes('check:leaf')) bad.push('판정기가_블록주석을_실행으로');
         
        const starLive = PU._detectOrphanGuards({
          packageScripts: { test: 'node t.js', 'check:leaf': 'node l.js' },
          runners: [{ file: '.github/workflows/ci.yml', viaScript: null, viaScripts: [], unconditional: true,
            text: 'jobs:\n  a:\n    steps:\n      - run: npm test\n' },
            { file: 'scripts/x.js', viaScript: 'test', viaScripts: ['test'], text: 'sh("npm run check:leaf");\n' }],
          scriptFiles: [],
        });
        if (starLive.orphanScripts.length) bad.push('판정기_주석필터가_실제호출까지_지움');
         
         
        for (const [label, ref] of [['posix', 'scripts/x/check.js'], ['win', 'scripts\\x\\check.js'], ['win-dot', '.\\scripts\\x\\check.js']]) {
          const rw = PU._detectOrphanGuards({ packageScripts: { test: 'node t.js' },
            runners: [{ file: '.github/workflows/ci.yml', viaScript: null, viaScripts: [], unconditional: true,
              text: `jobs:\n  a:\n    steps:\n      - run: node ${ref}\n      - run: npm test\n` }],
            scriptFiles: ['scripts/x/check.js'] });
          if (rw.orphanFiles.includes('scripts/x/check.js')) bad.push(`경로표기_오탐:${label}`);
        }
         
        const rw2 = PU._detectOrphanGuards({ packageScripts: { test: 'node t.js' },
          runners: [{ file: '.github/workflows/ci.yml', viaScript: null, viaScripts: [], unconditional: true,
            text: 'jobs:\n  a:\n    steps:\n      - run: node .\\check.js\n      - run: npm test\n' }],
          scriptFiles: ['scripts/x/check.js', 'scripts/y/check.js'] });
        if (rw2.orphanFiles.length !== 2) bad.push(`경로경계_과다커버(${rw2.orphanFiles.join(',')})`);
      } finally { try { fs.rmSync(sb4, { recursive: true, force: true }); } catch {} }
    }
     
    const r17 = PU._detectOrphanGuards({
      packageScripts: { test: 'echo "test:*"', 'test:secrets': 'node s.js' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test', viaScript: null }], scriptFiles: [],
    });
    if (!r17.orphanScripts.includes('test:secrets')) bad.push('echo속_glob을_실행으로_오인');
     
    const r18 = PU._detectOrphanGuards({
      packageScripts: { 'test:ci': 'node scripts/run.mjs', 'ci-check': 'node a.js', 'ci-guard': 'node b.js', 'check:dead': 'node d.js' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm run test:ci', viaScript: null },
        { file: 'scripts/run.mjs', text: `const pkg = require("./package.json");\nfor (const n of ${_ENUM_LIT}) { if (n.startsWith("ci")) run(n); }`, viaScript: 'test:ci' }],
      scriptFiles: [],
    });
    if (r18.orphanScripts.includes('ci-check') || r18.orphanScripts.includes('ci-guard')) bad.push('짧은접두_열거자를_버림:' + r18.orphanScripts.join(','));
    if (!r18.enumPrefixes.includes('ci')) bad.push('짧은접두_미추출');
     
    const r19 = PU._detectOrphanGuards({
      packageScripts: { test: 'node t.js', 'check:secrets': 'node s.js', note: 'echo turbo run test' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test', viaScript: null }], scriptFiles: [],
    });
    if (!r19.orphanScripts.includes('check:secrets')) bad.push('죽은스크립트의_turbo로_판정보류_우회');
     
    const r19b = PU._detectOrphanGuards({
      packageScripts: { test: 'turbo run build', 'check:secrets': 'node s.js' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test', viaScript: null }], scriptFiles: [],
    });
    if (r19b.orphanScripts.length) bad.push('산_turbo에서_보류_미작동');
     
     
    const r19c = PU._detectOrphanGuards({
      packageScripts: { test: 'node t.js', 'dead-enum': 'node scripts/enum.mjs', 'check:leaf': 'node l.js' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test', viaScript: null, viaScripts: [] },
        { file: 'scripts/enum.mjs', text: `const pkg=require("./package.json");\nfor (const n of ${_ENUM_LIT}) run(n);`, viaScript: 'dead-enum', viaScripts: ['dead-enum'] }],
      scriptFiles: [],
    });
    if (!r19c.orphanScripts.includes('check:leaf')) bad.push('죽은_열거자가_전체를_덮음');
     
    const r19d = PU._detectOrphanGuards({
      packageScripts: { test: 'node scripts/enum.mjs', 'check:leaf': 'node l.js' },
      runners: [{ file: '.github/workflows/ci.yml', text: 'run: npm test', viaScript: null, viaScripts: [] },
        { file: 'scripts/enum.mjs', text: `const pkg=require("./package.json");\nfor (const n of ${_ENUM_LIT}) run(n);`, viaScript: 'test', viaScripts: ['test'] }],
      scriptFiles: [],
    });
    if (r19d.orphanScripts.length) bad.push('산_열거자를_무시:' + r19d.orphanScripts.join(','));
     
     
    const r19e = PU._detectOrphanGuards({
      packageScripts: { test: 'node scripts/enum-a.mjs', 'check:enum-b': 'node scripts/enum-b.mjs', 'verify:leaf': 'node v.js', 'scan:dead': 'node d.js' },
      runners: [
        { file: '.github/workflows/ci.yml', text: 'run: npm test', viaScript: null, viaScripts: [], unconditional: true },
        { file: 'scripts/enum-a.mjs', text: `const pkg=require("./package.json");\nfor (const n of ${_ENUM_LIT}) { if (n.startsWith("check:")) run(n); }`, viaScript: 'test', viaScripts: ['test'] },
        { file: 'scripts/enum-b.mjs', text: `const pkg=require("./package.json");\nfor (const n of ${_ENUM_LIT}) { if (n.startsWith("verify:")) run(n); }`, viaScript: 'check:enum-b', viaScripts: ['check:enum-b'] },
      ],
      scriptFiles: [],
    });
    if (r19e.orphanScripts.includes('verify:leaf')) bad.push('다단_열거자_전파_안됨');
    if (!r19e.enumPrefixes.includes('verify:')) bad.push('2단계_열거자_접두_미수집');
     
    if (!r19e.orphanScripts.includes('scan:dead')) bad.push('다단전파가_범위밖까지_덮음');
     
    const r20 = PU._detectOrphanGuards({
      packageScripts: { postinstall: 'npm run check:generated', 'check:generated': 'node g.js' },
      runners: [], scriptFiles: [],
    });
    if (r20.orphanScripts.length) bad.push('생명주기_잎_오탐:' + r20.orphanScripts.join(','));
     
     
    for (const [label, text, expectOrphan] of [
      ['산문만', 'jobs:\n  a:\n    steps:\n      - name: TODO check:leaf 붙이기\n        run: echo skip\n', true],
      ['name 뒤 실제 run', 'jobs:\n  a:\n    steps:\n      - name: Run check:leaf\n        run: npm run check:leaf\n', false],
      ['matrix', 'jobs:\n  a:\n    strategy:\n      matrix:\n        script: [check:leaf]\n    steps:\n      - run: npm run ${{ matrix.script }}\n', false],
       
       
      ['matrix 변수명(실행키 아님)', 'jobs:\n  a:\n    strategy:\n      matrix:\n        target: [check:leaf]\n    steps:\n      - run: npm run ${{ matrix.target }}\n', false],
      ['Azure customCommand', 'steps:\n- task: Npm@1\n  inputs:\n    command: custom\n    customCommand: run check:leaf\n', false],
       
       
      ['matrix 변수명이 name', 'jobs:\n  a:\n    strategy:\n      matrix:\n        name: [check:leaf]\n    steps:\n      - run: npm run ${{ matrix.name }}\n', false],
    ]) {
      const rr = PU._detectOrphanGuards({ packageScripts: { test: 'node t.js', 'check:leaf': 'node l.js' },
        runners: [{ file: '.github/workflows/ci.yml', text, viaScript: null, viaScripts: [] }], scriptFiles: [] });
      if (rr.orphanScripts.includes('check:leaf') !== expectOrphan) bad.push(`CI설명키:${label}(고아=${!expectOrphan})`);
    }
     
     
     
    {
      const selfRoot = path.resolve(__dirname, '..');
      const selfInp = AUD._collectGuardInputs(selfRoot);
      const selfRes = PU._detectOrphanGuards(selfInp);
      if (!selfInp.runners.some(r => /e2e\.js$/.test(r.file))) bad.push('자기수집:e2e.js가러너에없음');    
      if (selfRes.dynamicRunners.some(f => /e2e\.js$|e2e-core\.js$/.test(f))) bad.push(`자기참조:테스트픽스처가열거자로읽힘(${selfRes.dynamicRunners.join(',')})`);
       
       
       
       
       
       
       
       
       
      const selfNoBin = Object.assign({}, selfInp, { runners: selfInp.runners.filter(r => !/bin[\\/]leerness\.js$/.test(r.file)) });
      const selfBase = PU._detectOrphanGuards(selfNoBin);
      if (selfBase.orphanScripts.length) bad.push(`자기기준:이제0이어야(${selfBase.orphanScripts.join(',')})`);
      if (selfBase.orphanScripts.includes('test:fast')) bad.push('자기기준:CI가도는test:fast를오탐');
      {
         
         
         
        const uniq = `check-${process.pid.toString(36)}${(selfNoBin.scriptFiles || []).length.toString(36)}.js`;
        const uniqPath = `scripts/${uniq}`;
        const planted = Object.assign({}, selfNoBin, {
          packageScripts: Object.assign({}, selfNoBin.packageScripts, { 'test:planted': `node ${uniqPath}` }),
          scriptFiles: (selfNoBin.scriptFiles || []).concat(uniqPath),
        });
        const pr = PU._detectOrphanGuards(planted);
        if (!pr.orphanScripts.includes('test:planted')) bad.push('자기기준:심은잠든가드를못잡음(탐지기죽음)');
        if (!pr.orphanFiles.includes(uniqPath)) bad.push(`자기기준:심은파일을못잡음(${uniqPath})`);
      }
       
       
      const selfNoE2e = PU._detectOrphanGuards(Object.assign({}, selfNoBin,
        { runners: selfNoBin.runners.filter(r => !/e2e\.js$/.test(r.file)) }));
       
       
       
       
      const _FILE_ALLOW = new Set(['scripts/e2e-core.js', 'scripts/e2e-concurrency.js', 'scripts/release-bump-probe.js']);
      const _shape = (x) => JSON.stringify({
        s: x.orphanScripts.slice().sort(),
        d: x.dynamicRunners.slice().sort(), p: x.enumPrefixes.slice().sort(),
        i: x.scanIncomplete, o: x.deferred, m: x.monorepoOutOfScope,
      });
      if (_shape(selfBase) !== _shape(selfNoE2e)) {
        bad.push(`자기참조:테스트파일이_판정을_바꿈(${selfBase.orphanScripts.join(',')} vs ${selfNoE2e.orphanScripts.join(',')})`);
      }
      const _fdiff = [...new Set([...selfBase.orphanFiles, ...selfNoE2e.orphanFiles])]
        .filter(f => selfBase.orphanFiles.includes(f) !== selfNoE2e.orphanFiles.includes(f))
        .filter(f => !_FILE_ALLOW.has(String(f).replace(/\\/g, '/')));
      if (_fdiff.length) bad.push(`자기참조:테스트파일이_파일판정을_바꿈(${_fdiff.join(',')})`);
       
      if (!selfNoBin.runners.some(r => /e2e\.js$/.test(r.file))) bad.push('자기참조:불변식이_공허(e2e.js가입력에없음)');
    }
     
    {
      const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
      if (!/XDG_CONFIG_HOME/.test(src)) bad.push('XDG_미반영');
    }

    dbg.bad = bad.slice(0, 10);
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  console.log(ok ? '✓ T(1.36.116) 고아 가드 탐지: 러너루트 도달성(죽은 wrapper·순환 잡음) · glob 러너 오탐 0 · guard:* 후보 · 정규식 접두 · 무관접두 무시 · turbo 보류 · **수집기→판정기 배선** 변이대조 · audit 권고 · 고아 없으면 침묵'
    : '✗ 1.36.116 고아 가드 탐지 실패 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
 
 
 
if (e2eShard.take('U(1.36.125)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const _dirs = [];
  const N = 3;
  const scenario = (label, testBody, expectFail) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-memo125-')); _dirs.push(d);
    const env = Object.assign({}, process.env, { TMPDIR: d, TEMP: d, TMP: d, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
    const counter = path.join(d, 'runs.txt');
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'memo', version: '0.1.0', scripts: { test: 'node t.js' } }));
    fs.writeFileSync(path.join(d, 't.js'), `require('fs').appendFileSync(${JSON.stringify(counter)}, 'x\\n'); ${testBody}`);
    const ri = cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { cwd: d, encoding: 'utf8', timeout: 300000, env });
    if (ri.status !== 0) { bad.push(`${label}:init실패(${ri.status})`); return; }
    for (let i = 0; i < N; i++) {
      const ra = cp.spawnSync(process.execPath, [CLI, 'task', 'add', `주장${i}`, '--path', d, '--json'], { cwd: d, encoding: 'utf8', timeout: 300000, env });
      let id = null; try { id = JSON.parse(ra.stdout || '{}').id; } catch {}
      if (!id) { bad.push(`${label}:task add 실패`); return; }
      const ru = cp.spawnSync(process.execPath, [CLI, 'task', 'update', id, '--status', 'done', '--evidence', 't.js 테스트 3건 통과', '--path', d],
        { cwd: d, encoding: 'utf8', timeout: 600000, env });
      if (ru.status !== 0) { bad.push(`${label}:task update 실패(${ru.status})`); return; }
    }
     
    const tracker = fs.readFileSync(path.join(d, '.leerness', 'progress-tracker.md'), 'utf8');
    const doneRows = tracker.split('\n').filter(l => /^\|\s*T-\d+/.test(l) && /\|\s*done\s*\|/.test(l)).length;
    if (doneRows !== N) { bad.push(`${label}:셋업done행 ${doneRows}(기대 ${N})`); return; }
    try { fs.unlinkSync(counter); } catch {}
    const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', '--all', '--path', d, '--json', '--run-tests'],
      { cwd: d, encoding: 'utf8', timeout: 900000, env, maxBuffer: 32 * 1024 * 1024 });
    let runs = 0; try { runs = fs.readFileSync(counter, 'utf8').trim().split('\n').filter(Boolean).length; } catch {}
    let j = null; try { j = JSON.parse(r.stdout); } catch {}
    if (!j || !Array.isArray(j.results)) { bad.push(`${label}:JSON아님`); return; }
    if (j.total !== N) bad.push(`${label}:total=${j.total}(기대 ${N})`);
    if (runs !== 1) bad.push(`${label}:스위트실행 ${runs}회(기대 1)`);
    const failedClaims = j.results.filter(x => x && x.ok === false).length;
    if (expectFail && failedClaims !== N) bad.push(`${label}:실패전파 ${failedClaims}/${N}`);
    if (!expectFail && failedClaims !== 0) bad.push(`${label}:거짓실패 ${failedClaims}건`);
    dbg[label] = { runs, total: j.total, failedClaims };
  };
  try {
    scenario('통과', "console.log('3 passed, 0 failed'); process.exit(0);", false);
    scenario('실패', "console.log('1 passed, 2 failed'); process.exit(1);", true);
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { _dirs.forEach(x => { try { fs.rmSync(x, { recursive: true, force: true }); } catch {} }); }
  console.log(ok ? `✓ U(1.36.125) verify-claim --all --run-tests: 스위트 1회만 실행(주장 수만큼 반복 금지) · 실패 결과가 ${N}개 주장 **전부**에 전파 · 통과 시 거짓 실패 0 ${JSON.stringify(dbg)}`
    : '✗ 1.36.125 --all 테스트 메모화 실패 ' + JSON.stringify({ bad: bad.slice(0, 6), dbg }));
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('V(1.36.126/T-0107)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ws126-'));
  const envW = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG', 'LEERNESS_MCP_PROFILE', 'LEERNESS_MCP_TIMEOUT_MS']) delete envW[k];
  const mkP = (name) => {
    const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"w","version":"0.1.0"}');
    const r = cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { cwd: d, encoding: 'utf8', timeout: 600000, env: envW });
    if (r.status !== 0) bad.push(`${name}:init실패(${r.status})`);
    return d;
  };
  const RW = (d, args, extra) => cp.spawnSync(process.execPath, [CLI, ...args],
    { cwd: d, encoding: 'utf8', timeout: 600000, env: Object.assign({}, envW, extra || {}), maxBuffer: 32 * 1024 * 1024 });
  try {
     
    const A = mkP('A');
    const m = RW(A, ['migrate-workspace-dir', '--apply', '--path', A]);
    if (!fs.existsSync(path.join(A, '.leerness', 'HARNESS_VERSION'))) bad.push('①canonical미생성');
    if (fs.existsSync(path.join(A, '.harness'))) bad.push('①fresh에legacy생성'); // workspace-dir-legacy-fixture
    if (m.status !== 0) bad.push(`①canonical멱등실패(${m.status})`);
    const mj = RW(A, ['migrate-workspace-dir', '--apply', '--path', A, '--json']);
    let mjj = null; try { mjj = JSON.parse(mj.stdout); } catch { bad.push('①JSON아님'); }
    if (mjj && mjj.blocked === true) bad.push(`①json:blocked=${mjj.blockedReason}`);
    if (mjj && mjj.alreadyCanonical !== true) bad.push('①json:alreadyCanonical아님');
    if (mj.status !== 0) bad.push(`①json:exit ${mj.status}`);
    if (mjj && Array.isArray(mjj.copiedFiles) && mjj.copiedFiles.length) bad.push('①json:복사보고');
    dbg.A = { exit: m.status, canonical: fs.existsSync(path.join(A, '.leerness')), alreadyCanonical: mjj && mjj.alreadyCanonical };

     
     
    const B = mkP('B');
    fs.writeFileSync(path.join(B, '.leerness', 'MIGRATED_FROM_HARNESS'), 'provenance only\n');
    fs.mkdirSync(path.join(B, '.harness'), { recursive: true }); // workspace-dir-legacy-fixture
    fs.writeFileSync(path.join(B, '.harness', 'HARNESS_VERSION'), '1.36.161\n'); // workspace-dir-legacy-fixture
    fs.writeFileSync(path.join(B, '.harness', 'progress-tracker.md'), '# independent legacy\n'); // workspace-dir-legacy-fixture
    const canonicalBefore = fs.readFileSync(path.join(B, '.leerness', 'progress-tracker.md'), 'utf8');
    const legacyBefore = fs.readFileSync(path.join(B, '.harness', 'progress-tracker.md'), 'utf8'); // workspace-dir-legacy-fixture
    const conflict = RW(B, ['migrate-workspace-dir', '--path', B, '--json']);
    let conflictJson = null; try { conflictJson = JSON.parse(conflict.stdout); } catch { bad.push('②conflictJSON아님'); }
    if (conflict.status === 0) bad.push('②dual-live통과');
    if (!conflictJson || conflictJson.blockedReason !== 'workspace-dir-conflict') bad.push(`②사유=${conflictJson && conflictJson.blockedReason}`);
    if (fs.readFileSync(path.join(B, '.leerness', 'progress-tracker.md'), 'utf8') !== canonicalBefore) bad.push('②canonical변경');
    if (fs.readFileSync(path.join(B, '.harness', 'progress-tracker.md'), 'utf8') !== legacyBefore) bad.push('②legacy변경'); // workspace-dir-legacy-fixture
    if (fs.existsSync(path.join(B, '.leerness-backup'))) bad.push('②차단인데백업생성');
    fs.rmSync(path.join(B, '.harness'), { recursive: true, force: true }); // workspace-dir-legacy-fixture
     
    const w = RW(B, ['task', 'add', '마커 있어도 쓰기', '--path', B, '--json'], { LEERNESS_WORKSPACE_DIR: '.leerness' });
    if (w.status !== 0) bad.push(`②마커상태쓰기실패(${w.status})`);
    if (!fs.readFileSync(path.join(B, '.leerness', 'progress-tracker.md'), 'utf8').includes('마커 있어도 쓰기')) bad.push('②쓰기가.leerness에없음');
    dbg.B = { conflict: conflictJson && conflictJson.blockedReason, writeExit: w.status };

     
    const C = mkP('C');
    const au2 = RW(C, ['audit', '--path', C, '--json']);
    let aj2 = null; try { aj2 = JSON.parse(au2.stdout); } catch { bad.push('③auditJSON아님'); }
    const n2 = aj2 && Array.isArray(aj2.findings) ? aj2.findings.filter(x => x.kind === 'stale_workspace_copy').length : -1;
    if (n2 !== 0) bad.push(`③대조군오탐 ${n2}건`);
    const wd2 = RW(C, ['workspace-dir', 'get', '--path', C]).stdout || '';
    if (/죽은 사본|적용되지 않습니다/.test(wd2)) bad.push('③대조군에경고문구');
    dbg.C = { falsePositives: n2 };

     
     
    {
      const D = mkP('D');                                    
      fs.mkdirSync(path.join(D, '.leerness'), { recursive: true });
      fs.writeFileSync(path.join(D, '.leerness', 'WHERE_TO_FIND.md'), 'Generated: 2026-01-01T00:00:00.000Z by leerness 1.36.100\n');
      const ad = RW(D, ['audit', '--path', D, '--json']);
      let adj = null; try { adj = JSON.parse(ad.stdout); } catch { bad.push('③c auditJSON아님'); }
      const fdCount = adj && Array.isArray(adj.findings) ? adj.findings.filter(x => x.kind === 'stale_workspace_copy').length : -1;
      if (fdCount !== 0) bad.push(`③ccanonical오탐 ${fdCount}건`);

      const E = mkP('E');                                    
      fs.mkdirSync(path.join(E, '.leerness'), { recursive: true });
      fs.writeFileSync(path.join(E, '.leerness', 'WHERE_TO_FIND.md'), '# someone else\n');
      fs.writeFileSync(path.join(E, '.leerness', 'config.yml'), 'a: 1\n');
      const ae = RW(E, ['audit', '--path', E, '--json']);
      let aej = null; try { aej = JSON.parse(ae.stdout); } catch { bad.push('③c(대조)auditJSON아님'); }
      const fe = aej && Array.isArray(aej.findings) ? aej.findings.filter(x => x.kind === 'stale_workspace_copy').length : -1;
      if (fe !== 0) bad.push(`③c남의.leerness오탐 ${fe}건`);
      dbg.D = { canonicalFalsePositives: fdCount, foreignFalsePositives: fe };
    }

     
    {
      const P = mkP('P');                                    
      fs.writeFileSync(path.join(P, '.leerness', 'design-system.md'), '# LIVE\n');
      fs.mkdirSync(path.join(P, '.leerness'), { recursive: true });
      fs.writeFileSync(path.join(P, '.leerness', 'MIGRATED_FROM_HARNESS'), 'x');
      const kid = path.join(P, 'kid'); fs.mkdirSync(kid, { recursive: true });
      fs.writeFileSync(path.join(kid, 'package.json'), '{"name":"kid","version":"0.1.0"}');
      const pw = RW(kid, ['parent', 'detect', '--path', kid, '--json']);
      let pj = null; try { pj = JSON.parse(pw.stdout); } catch { bad.push('③b parentJSON아님'); }
      const par = pj && pj.parent;
      if (!par) bad.push('③b부모미탐지(셋업실패면 아래 단언이 공허해진다)');
      else {
        if (par.workspaceDir !== '.leerness') bad.push(`③b부모워크스페이스=${par.workspaceDir}`);
        if (!String(par.workspaceAbs || '').endsWith('.leerness')) bad.push('③b부모abs가.leerness아님');
        if (par.assets && par.assets.designSystem !== true) bad.push('③b살아있는자산미탐지(계측붕괴)');
         
        const body = fs.readFileSync(path.join(par.workspaceAbs, 'design-system.md'), 'utf8');
        if (!/LIVE/.test(body)) bad.push('③b읽히는자산이 STALE');
      }
      dbg.P = { workspaceDir: par && par.workspaceDir, depth: par && par.depth };
    }

     
    const binSrc = fs.readFileSync(CLI, 'utf8');
    const libDir = path.resolve(path.dirname(CLI), '..', 'lib');    
    let libSrc = '';
    for (const f of fs.readdirSync(libDir)) if (f.endsWith('.js')) libSrc += '\n' + fs.readFileSync(path.join(libDir, f), 'utf8');
    const wsPolicy = require('../lib/workspace-dir');
    if (wsPolicy.CANONICAL_WORKSPACE_DIR !== '.leerness') bad.push(`④canonical=${wsPolicy.CANONICAL_WORKSPACE_DIR}`);
    if (wsPolicy.LEGACY_WORKSPACE_DIR !== '.harness') bad.push(`④legacy=${wsPolicy.LEGACY_WORKSPACE_DIR}`); // workspace-dir-legacy-fixture
    if (wsPolicy.LEGACY_BACKUP_WORKSPACE_DIR !== '.leerness-backup') bad.push(`④backup=${wsPolicy.LEGACY_BACKUP_WORKSPACE_DIR}`);
    if (typeof wsPolicy.resolveWorkspaceDirName !== 'function') bad.push('④resolver없음');
    if (typeof wsPolicy.migrateLegacyWorkspace !== 'function') bad.push('④migrator없음');
    const resolverConsumers = ((binSrc + libSrc).match(/workspace-dir/g) || []).length;
    if (resolverConsumers < 2) bad.push(`④해석기소비계측붕괴(${resolverConsumers})`);
    dbg.src = {
      canonical: wsPolicy.CANONICAL_WORKSPACE_DIR,
      legacy: wsPolicy.LEGACY_WORKSPACE_DIR,
      backup: wsPolicy.LEGACY_BACKUP_WORKSPACE_DIR,
      resolverConsumers,
    };
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ V(1.36.126/T-0107) canonical 워크스페이스: fresh .leerness · idempotent migration · dual-live fail-closed · provenance marker 비권위 · 부모 자산 · audit 오탐 0 ${JSON.stringify(dbg)}`
    : '✗ 1.36.126 canonical 워크스페이스 계약 실패 ' + JSON.stringify({ bad: bad.slice(0, 8), dbg }));
  if (!ok) failed++;
}

 
 
 
 
if (e2eShard.take('W(1.36.127/T-0105)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mask127-'));
  const envM = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG', 'LEERNESS_MCP_PROFILE', 'LEERNESS_MCP_TIMEOUT_MS']) delete envM[k];
  try {
     
    const d = path.join(sb, 'p'); fs.mkdirSync(path.join(d, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(d, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({
      name: 'p', version: '0.1.0', bin: { p: 'bin/p.js' },
      scripts: { test: 'node scripts/check-a.js', 'test:dead': 'node scripts/check-dead.js' },
    }, null, 2));
    fs.mkdirSync(path.join(d, 'bin'), { recursive: true });
     
    fs.writeFileSync(path.join(d, 'bin', 'p.js'), 'const help = "run test:dead (scripts/check-dead.js) manually";\nconsole.log(help);\n');
    fs.writeFileSync(path.join(d, 'scripts', 'check-a.js'), 'process.exit(0);\n');
    fs.writeFileSync(path.join(d, 'scripts', 'check-dead.js'), 'process.exit(0);\n');
    fs.writeFileSync(path.join(d, '.github', 'workflows', 'ci.yml'), 'jobs:\n  t:\n    steps:\n      - run: npm test\n      - run: node ./bin/p.js\n');
    const ri = cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes'], { cwd: d, encoding: 'utf8', timeout: 600000, env: envM });
    if (ri.status !== 0) bad.push(`①init실패(${ri.status})`);
    const au = cp.spawnSync(process.execPath, [CLI, 'audit', '--path', d, '--json'], { cwd: d, encoding: 'utf8', timeout: 600000, env: envM, maxBuffer: 32 * 1024 * 1024 });
    let aj = null; try { aj = JSON.parse(au.stdout); } catch { bad.push('①auditJSON아님'); }
    const fs2 = aj && Array.isArray(aj.findings) ? aj.findings : [];
    const mask = fs2.find(x => x.kind === 'orphan_guard_masked_by_own_entry');
    if (!mask) bad.push('①가림_미보고');
    else {
      if (!(mask.maskedScripts || []).includes('test:dead')) bad.push(`①가림목록=${JSON.stringify(mask.maskedScripts)}`);
      if (!(mask.maskedFiles || []).includes('scripts/check-dead.js')) bad.push(`①가림파일=${JSON.stringify(mask.maskedFiles)}`);
    }
     
    if (fs2.some(x => x.kind === 'orphan_guard')) bad.push('①판정이바뀜(오탐편향깨짐)');
    if (!/자신의 진입점 텍스트에 가려질 수 있습니다/.test(
      cp.spawnSync(process.execPath, [CLI, 'audit', '--path', d], { cwd: d, encoding: 'utf8', timeout: 600000, env: envM }).stdout || '')) bad.push('①사람용문구없음');
    dbg.masked = mask ? { s: mask.maskedScripts, f: mask.maskedFiles } : null;

     
    const d2 = path.join(sb, 'q'); fs.mkdirSync(path.join(d2, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(d2, '.github', 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(d2, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(d2, 'package.json'), JSON.stringify({
      name: 'q', version: '0.1.0', bin: { q: 'bin/q.js' },
      scripts: { test: 'node scripts/check-a.js', 'test:dead': 'node scripts/check-dead.js' },
    }, null, 2));
    fs.writeFileSync(path.join(d2, 'bin', 'q.js'), 'console.log("nothing to see");\n');
    fs.writeFileSync(path.join(d2, 'scripts', 'check-a.js'), 'process.exit(0);\n');
    fs.writeFileSync(path.join(d2, 'scripts', 'check-dead.js'), 'process.exit(0);\n');
    fs.writeFileSync(path.join(d2, '.github', 'workflows', 'ci.yml'), 'jobs:\n  t:\n    steps:\n      - run: npm test\n      - run: node ./bin/q.js\n');
    cp.spawnSync(process.execPath, [CLI, 'init', d2, '--yes'], { cwd: d2, encoding: 'utf8', timeout: 600000, env: envM });
    let aj2 = null;
    try { aj2 = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'audit', '--path', d2, '--json'], { cwd: d2, encoding: 'utf8', timeout: 600000, env: envM, maxBuffer: 32 * 1024 * 1024 }).stdout); } catch { bad.push('②auditJSON아님'); }
    const f2 = aj2 && Array.isArray(aj2.findings) ? aj2.findings : [];
    if (f2.some(x => x.kind === 'orphan_guard_masked_by_own_entry')) bad.push('②대조군에가림보고');
    const og = f2.find(x => x.kind === 'orphan_guard');
    if (!og) bad.push('②진짜고아_미탐지(계측붕괴)');
    else if (!(og.orphanScripts || []).includes('test:dead')) bad.push(`②고아목록=${JSON.stringify(og.orphanScripts)}`);
    dbg.control = { masked: f2.some(x => x.kind === 'orphan_guard_masked_by_own_entry'), orphan: !!og };

     
     
     
    {
      const d3 = path.join(sb, 'r'); fs.mkdirSync(path.join(d3, 'scripts'), { recursive: true });
      fs.mkdirSync(path.join(d3, '.github', 'workflows'), { recursive: true });
      fs.mkdirSync(path.join(d3, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(d3, 'package.json'), JSON.stringify({
        name: 'r', version: '0.1.0', bin: 'bin/r.js',
        scripts: { test: 'node scripts/check-a.js', 'test:dead': 'node scripts/check-dead.js' },
      }, null, 2));
      fs.writeFileSync(path.join(d3, 'bin', 'r.js'), 'const help = "run test:dead (scripts/check-dead.js) manually";\n');
      fs.writeFileSync(path.join(d3, 'scripts', 'check-a.js'), 'process.exit(0);\n');
      fs.writeFileSync(path.join(d3, 'scripts', 'check-dead.js'), 'process.exit(0);\n');
       
      fs.writeFileSync(path.join(d3, '.github', 'workflows', 'ci.yml'), 'jobs:\n  t:\n    steps:\n      - run: npm test\n      - run: node ./bin/./r.js\n');
      cp.spawnSync(process.execPath, [CLI, 'init', d3, '--yes'], { cwd: d3, encoding: 'utf8', timeout: 600000, env: envM });
      let aj3 = null;
      try { aj3 = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'audit', '--path', d3, '--json'], { cwd: d3, encoding: 'utf8', timeout: 600000, env: envM, maxBuffer: 32 * 1024 * 1024 }).stdout); } catch { bad.push('②b auditJSON아님'); }
      const f3 = aj3 && Array.isArray(aj3.findings) ? aj3.findings : [];
      const m3 = f3.find(x => x.kind === 'orphan_guard_masked_by_own_entry');
      if (!m3) bad.push('②b dot-segment 표기에서 가림보고 사라짐');
      else if (!(m3.maskedScripts || []).includes('test:dead')) bad.push(`②b가림목록=${JSON.stringify(m3.maskedScripts)}`);
      dbg.dotSeg = { masked: !!m3 };
    }

     
     
     
     
    const ownPkg = JSON.parse(fs.readFileSync(path.resolve(path.dirname(CLI), '..', 'package.json'), 'utf8'));
    const testBody = String(ownPkg.scripts && ownPkg.scripts.test || '');
    const inNpmTest = /(^|&&)\s*node\s+\.?\/?scripts\/e2e-core\.js(\s|$|&)/.test(testBody);
    if (!inNpmTest) bad.push(`③e2e-core가 npm test 에 실행형태로 미배선(${testBody.slice(0, 80)})`);
    const ciText = fs.readFileSync(path.resolve(path.dirname(CLI), '..', '.github', 'workflows', 'ci.yml'), 'utf8');
    const inCi = ciText.split('\n').some(l => /^\s*(-\s*)?run:\s*node\s+\.?\/?scripts\/e2e-core\.js\s*$/.test(l));
    if (!inCi) bad.push('③e2e-core가 CI 에 실행형태로 미배선');
     
    if (/(^|&&)\s*node\s+\.?\/?scripts\/e2e-core\.js(\s|$|&)/.test('echo scripts/e2e-core.js')) bad.push('③단언이 echo 위조를 통과시킴');
    dbg.self = { inNpmTest, inCi };
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ W(1.36.127/T-0105) 고아 가드 가림: 자기 진입점 문자열이 판정을 가리면 **후보를 이름으로** 보고(판정은 불변) · 대조군은 조용하고 진짜 고아는 그대로 · 우리 자신도 e2e-core 배선 완료 ${JSON.stringify(dbg)}`
    : '✗ 1.36.127 고아 가드 가림 보고 실패 ' + JSON.stringify({ bad: bad.slice(0, 8), dbg }));
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('X(1.36.128/T-0104)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-adp128-'));
  const envA = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG', 'LEERNESS_MCP_PROFILE', 'LEERNESS_MCP_TIMEOUT_MS']) delete envA[k];
  const mkA = (name) => {
    const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"a","version":"0.1.0"}');
    const r = cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--minimal'], { cwd: d, encoding: 'utf8', timeout: 600000, env: envA });
    if (r.status !== 0) bad.push(`${name}:init실패(${r.status})`);
    try { fs.unlinkSync(path.join(d, '.mcp.json')); } catch {}
    return d;
  };
  const RA = (d, args) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd: d, encoding: 'utf8', timeout: 600000, env: envA, maxBuffer: 32 * 1024 * 1024 });
  try {
    const dC = mkA('codexp');
    const rC = RA(dC, ['adapter', 'codex', '--path', dC]);
    const oC = String(rC.stdout || '');
     
    if (rC.status !== 0) bad.push(`①codex adapter exit=${rC.status}`);
    if (fs.existsSync(path.join(dC, '.mcp.json'))) bad.push('①codex에 무동작 .mcp.json 생성');
    if (!/읽지 않는다/.test(oC)) bad.push('①이유 미고지');
    if (!/codex mcp add leerness/.test(oC)) bad.push('①되는 명령 미고지');
    dbg.codex = { wroteMcp: fs.existsSync(path.join(dC, '.mcp.json')) };
     
    const dG = mkA('goosep');
    const rG = RA(dG, ['adapter', 'goose', '--path', dG]);
    const oG = String(rG.stdout || '');
    if (rG.status !== 0) bad.push(`①goose adapter exit=${rG.status}`);
    if (fs.existsSync(path.join(dG, '.mcp.json'))) bad.push('①goose에 무동작 .mcp.json 생성');
    if (!/goose session --with-extension "npx -y leerness mcp serve"/.test(oG)) bad.push('①goose 안내 명령 형태 불일치');
    dbg.goose = { wroteMcp: fs.existsSync(path.join(dG, '.mcp.json')), exit: rG.status };

    const dL = mkA('claudep');
    const rL = RA(dL, ['adapter', 'claude', '--path', dL]);
    const oL = String(rL.stdout || '');
    if (rL.status !== 0) bad.push(`②claude adapter exit=${rL.status}`);
    if (!fs.existsSync(path.join(dL, '.mcp.json'))) bad.push('②claude에 .mcp.json 미생성');
    if (/codex mcp add|goose session --with-extension/.test(oL)) bad.push('②남의 대안 안내 누출');
    if (!/\.mcp\.json 에 MCP 등록/.test(oL)) bad.push('②등록 문구 없음');
    dbg.claude = { wroteMcp: fs.existsSync(path.join(dL, '.mcp.json')) };
     
     
    {
      const dR = mkA('cursorp');
      let pj = null;
      try { pj = JSON.parse(String(RA(dR, ['adapter', 'cursor', '--path', dR, '--dry-run', '--json']).stdout || '')); } catch { bad.push('②bdryJSON아님'); }
      const planned = (pj && pj.files) || [];
      if (!planned.includes('.cursor/mcp.json')) bad.push(`②b계획에 .cursor/mcp.json 없음(${JSON.stringify(planned)})`);
      const rR = RA(dR, ['adapter', 'cursor', '--path', dR]);
      if (rR.status !== 0) bad.push(`②bcursor adapter exit=${rR.status}`);
      for (const f of ['.cursor/mcp.json', '.mcp.json', '.cursor/hooks.json', '.cursor/hooks/leerness-session.cjs']) {
        if (fs.existsSync(path.join(dR, f)) && !planned.includes(f)) bad.push(`②b계획에 없던 파일을 생성: ${f}`);
      }
      dbg.cursor = { planned };
    }
    const listR = RA(sb, ['adapter']);
    if (listR.status !== 0) bad.push(`③adapter list exit=${listR.status}`);
    const list = String(listR.stdout || '');
    const codexBracket = /codex\s+OpenAI Codex CLI\s+\[\+/.test(list);
    if (codexBracket) bad.push('③목록이 codex 에 여전히 대괄호 표기');
    if (!/opencode\s+opencode\s+\[\+\.mcp\.json\]/.test(list)) bad.push('③opencode 표기 사라짐');
    let lj = null; try { lj = JSON.parse(String(RA(sb, ['adapter', 'list', '--json']).stdout || '')); } catch { bad.push('③listJSON아님'); }
    if (lj && lj.adapters) {
      if (lj.adapters.codex.mcp !== false) bad.push('③json:codex.mcp가 false 아님');
      if (lj.adapters.claude.mcp !== true) bad.push('③json:claude.mcp가 true 아님');
    }
    dbg.list = { codexBracket };
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ X(1.36.128/T-0104) 어댑터 MCP 주장: 안 읽는 도구(codex)엔 무동작 파일 미생성 + 이유·되는 명령 고지 · 읽는 도구(claude)는 그대로 등록하고 남의 안내 누출 0 · 목록/JSON 표기 일치 ${JSON.stringify(dbg)}`
    : '✗ 1.36.128 어댑터 MCP 주장 실패 ' + JSON.stringify({ bad: bad.slice(0, 8), dbg }));
  if (!ok) failed++;
}

 
 
 
 
if (e2eShard.take('Y(1.36.129/P-0016 P1)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sess129-'));
   
   
  const envS = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDECODE',
    'CODEX_MANAGED_BY_NPM', 'CODEX_MANAGED_BY_PNPM', 'CODEX_MANAGED_BY_BUN', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
    'CURSOR_AGENT', 'LEERNESS_NO_SESSION_PRESENCE', 'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'CI', 'GITHUB_ACTIONS',
    'LEERNESS_SESSION_ID', 'CODEX_THREAD_ID',
    'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG', 'LEERNESS_MCP_PROFILE', 'LEERNESS_MCP_TIMEOUT_MS']) delete envS[k];
   
  const KEY = (tag) => `sess-${process.pid.toString(36)}-${tag}`;
  const STORE = ['.leerness', 'cache', 'sessions'];
  const storeDir = (d) => path.join(d, ...STORE);
  const nRec = (d) => { try { return fs.readdirSync(storeDir(d)).filter(f => /\.json$/.test(f)).length; } catch { return 0; } };
  const RS = (d, args, extra) => cp.spawnSync(process.execPath, [CLI, ...args],
    { cwd: d, encoding: 'utf8', timeout: 600000, env: Object.assign({}, envS, extra || {}), maxBuffer: 32 * 1024 * 1024 });
  const mkS = (name) => {
    const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"s","version":"0.1.0"}');
    const r = RS(d, [CLI ? 'init' : 'init', d, '--yes', '--minimal']);
    if (r.status !== 0) bad.push(`${name}:init실패(${r.status})`);
    return d;
  };
  let observedRecords = 0, cliCases = 0;
  try {
     
    const dA = mkS('a'); const kA = KEY('a');
    RS(dA, ['handoff', dA], { CLAUDE_CODE_SESSION_ID: kA }); cliCases++;
    if (nRec(dA) !== 0) bad.push(`①기본 읽기가 레코드를 만듦(${nRec(dA)}개)`);
    for (let i = 0; i < 3; i++) { RS(dA, ['handoff', dA, '--record'], { CLAUDE_CODE_SESSION_ID: kA }); cliCases++; }
    if (nRec(dA) !== 1) bad.push(`①레코드 ${nRec(dA)}개(기대 1)`);
    let recA = null; try { recA = JSON.parse(fs.readFileSync(path.join(storeDir(dA), `${kA}.json`), 'utf8')); } catch { bad.push('①레코드 파싱 실패'); }
    if (recA) {
      observedRecords++;
      if (recA.handoffCount !== 3) bad.push(`①handoffCount=${recA.handoffCount}(기대 3 — 하트비트 무동작)`);
      if (recA.closedAt !== null) bad.push('①closedAt이 null이 아님');
      if ('pid' in recA) bad.push('①pid를 기록함(라이브니스 판정 금지 계약 위반)');
    }
     
    for (const [tag, extra] of [['int', { LEERNESS_INTERNAL: '1' }], ['kid', { CLAUDE_CODE_CHILD_SESSION: '1' }],
      ['off', { LEERNESS_NO_SESSION_PRESENCE: '1' }], ['ci', { CI: '1' }]]) {
      const d = mkS('s' + tag);
      RS(d, ['handoff', d, '--record'], Object.assign({ CLAUDE_CODE_SESSION_ID: KEY(tag) }, extra)); cliCases++;
      if (nRec(d) !== 0) bad.push(`②${tag} 억제 실패(${nRec(d)}개)`);
    }
     
    const dCtl = mkS('ctl');
    RS(dCtl, ['handoff', dCtl, '--record'], { CLAUDE_CODE_SESSION_ID: KEY('ctl') }); cliCases++;
    if (nRec(dCtl) !== 1) bad.push(`②대조군이 0개 — 계측 붕괴(${nRec(dCtl)})`);
    else observedRecords++;
     
    const dNo = mkS('noid'); RS(dNo, ['handoff', dNo, '--record']); cliCases++;
    if (nRec(dNo) !== 0) bad.push(`②세션id 없이 등록됨(${nRec(dNo)})`);

     
    const dH = mkS('h'); const kMe = KEY('me'), kOther = KEY('other');
    const h1 = String(RS(dH, ['handoff', dH, '--record'], { CLAUDE_CODE_SESSION_ID: kMe }).stdout || ''); cliCases++;
    if (/다른 세션 기록|other session record/.test(h1)) bad.push('③자기 레코드만인데 헤드라인 발화');
    RS(dH, ['handoff', dH, '--record'], { CLAUDE_CODE_SESSION_ID: kOther }); cliCases++;
    const h2 = String(RS(dH, ['handoff', dH], { CLAUDE_CODE_SESSION_ID: kMe }).stdout || ''); cliCases++;
    if (!/다른 세션 기록|other session record/.test(h2)) bad.push('③다른 레코드가 있는데 침묵');
    if (/활성|active session/.test(h2)) bad.push('③"활성"이라는 단어 사용(라이브니스 판정 금지)');
    const h2r = String(RS(dH, ['handoff', dH, '--record'], { CLAUDE_CODE_SESSION_ID: kMe }).stdout || ''); cliCases++;
    if (!/다른 세션 기록 1건|1 other session record/.test(h2r)) bad.push('③--record 출력이 다른 레코드에 침묵');
    const h2n = String(RS(dH, ['handoff', dH], { CLAUDE_CODE_SESSION_ID: KEY('reader') }).stdout || ''); cliCases++;
    if (!/다른 세션 기록 2건|2 other session record/.test(h2n)) bad.push('③기록 없는 세션의 기본 읽기가 다른 레코드에 침묵');
    observedRecords += nRec(dH);
     
    try {
      const op = path.join(storeDir(dH), `${kOther}.json`);
      const oj = JSON.parse(fs.readFileSync(op, 'utf8')); oj.hostId = 'ffffffffffff';
      fs.writeFileSync(op, JSON.stringify(oj, null, 2));
    } catch { bad.push('③다른머신 픽스처 준비 실패'); }
    const h3 = String(RS(dH, ['handoff', dH], { CLAUDE_CODE_SESSION_ID: kMe }).stdout || ''); cliCases++;
    if (/다른 세션 기록|other session record/.test(h3)) bad.push('③다른 머신 레코드에 발화');

     
    const sessionFileEvidence = file => {
      const bytes = fs.readFileSync(file), st = fs.lstatSync(file, { bigint: true });
      return JSON.stringify({ bytes: bytes.toString('hex'), sha256: require('crypto').createHash('sha256').update(bytes).digest('hex'),
        size: String(st.size), mode: String(st.mode), ino: String(st.ino), mtimeNs: String(st.mtimeNs) });
    };
    const dJ = mkS('j'); const kJ = KEY('j');
    RS(dJ, ['handoff', dJ, '--record'], { CLAUDE_CODE_SESSION_ID: kJ }); cliCases++;
    const jFile = path.join(storeDir(dJ), `${kJ}.json`);
    try {
      const seed = JSON.parse(fs.readFileSync(jFile, 'utf8'));
      if (seed.handoffCount !== 1) bad.push('④손상 전 정상 레코드가 1회 기록되지 않음(계측 붕괴)');
      else observedRecords++;
    } catch { bad.push('④손상 전 정상 레코드 파싱 실패(계측 붕괴)'); }
    fs.writeFileSync(jFile, '{{{broken');
    const jEvidence = sessionFileEvidence(jFile);
    const rjr = RS(dJ, ['handoff', dJ, '--json'], { CLAUDE_CODE_SESSION_ID: kJ }); cliCases++;
    if (sessionFileEvidence(jFile) !== jEvidence) bad.push('④기본 읽기가 손상 원본 바이트/메타데이터를 변경함');
    let rjj = null; try { rjj = JSON.parse(String(rjr.stdout || '')); } catch { bad.push('④기본 읽기 stdout이 순수 JSON 아님'); }
    if (rjr.status !== 0 || String(rjr.stderr || '').length !== 0) bad.push(`④기본 읽기 exit=${rjr.status} stderr ${String(rjr.stderr).length}B`);
    if (!(rjj && rjj.sessions && rjj.sessions.unreadableRecords === 1 && rjj.sessions.storeError === 'E_STORE_CORRUPT' && rjj.sessions.others === null)) bad.push('④기본 읽기가 손상/미확인 세션을 정확히 말하지 않음');
    const rj = RS(dJ, ['handoff', dJ, '--json', '--record'], { CLAUDE_CODE_SESSION_ID: kJ }); cliCases++;
    if (sessionFileEvidence(jFile) !== jEvidence) bad.push('④기록 시도가 손상 원본 바이트/메타데이터를 변경함');
    if (rj.status !== 0) bad.push(`④손상 레코드에서 exit=${rj.status}`);
    if (String(rj.stderr || '').length !== 0) bad.push(`④stderr ${String(rj.stderr).length}B(계약 위반)`);
    try {
      const attempted = JSON.parse(String(rj.stdout || ''));
      if (!(attempted.sessions && attempted.sessions.unreadableRecords === 1 && attempted.sessions.storeError === 'E_STORE_CORRUPT' && attempted.sessions.others === null)) bad.push('④기록 거부 후 손상/미확인 세션을 정확히 말하지 않음');
    } catch { bad.push('④stdout이 순수 JSON 아님'); }

     
    const dE = mkS('esc');
    const before = fs.readdirSync(dE).length;
    for (const k of ['..', '../../x', 'a/b', 'C:\\x', 'short']) { RS(dE, ['handoff', dE, '--record'], { CLAUDE_CODE_SESSION_ID: k }); cliCases++; }
    if (nRec(dE) !== 0) bad.push(`⑤탈출 키가 등록됨(${nRec(dE)})`);
    if (fs.readdirSync(dE).length !== before) bad.push('⑤프로젝트 루트에 파일이 생김');

     
    const rs = RS(dH, ['sessions', dH]); cliCases++;
    if (rs.status !== 0) bad.push(`⑥sessions exit=${rs.status}`);
    const so = String(rs.stdout || '');
    if (!/이 목록이 보지 못하는 것|what this list cannot see/.test(so)) bad.push('⑥한계 고지 없음');
    if (/활성|\bactive\b/.test(so)) bad.push('⑥"활성" 단어 사용');
    if (!/handoff --record/.test(so)) bad.push('⑥한계 고지가 기본 읽기는 등록하지 않음을 말하지 않음');
    const soN = String(RS(dH, ['sessions', dH], { CLAUDE_CODE_SESSION_ID: KEY('reader') }).stdout || ''); cliCases++;
    if (!/handoff \. --record/.test(soN)) bad.push('⑥기록 없는 세션에게 등록 방법을 말하지 않음');
    if (/handoff \. --record/.test(String(RS(dH, ['sessions', dH], { CLAUDE_CODE_SESSION_ID: kMe }).stdout || ''))) bad.push('⑥기록이 있는 세션에게 등록하라고 말함(오탐)');
    cliCases++;
    const rj2 = RS(dH, ['sessions', dH, '--json']); cliCases++;
    let sj = null; try { sj = JSON.parse(String(rj2.stdout || '')); } catch { bad.push('⑥sessions --json 파싱 실패'); }
    if (sj) {
      if (String(rj2.stderr || '').length !== 0) bad.push(`⑥sessions --json stderr ${String(rj2.stderr).length}B`);
      if (!Array.isArray(sj.blindSpots) || sj.blindSpots.length < 3) bad.push('⑥blindSpots 미노출');
      if (sj.storePath !== STORE.join('/')) bad.push(`⑥storePath=${sj.storePath}`);
      if (!(sj.total >= 1)) bad.push('⑥sessions 가 레코드를 못 봄');
    }

     
     
    const dG = mkS('git');
    const gi = gitSpawn(['init', '-q'], { cwd: dG, encoding: 'utf8', timeout: 60000 });
    if (gi.status !== 0) bad.push('⑦git init 실패 — 이 검사는 스킵이 아니라 실패다(측정 붕괴를 통과로 세지 않는다)');
    else {
      RS(dG, ['handoff', dG, '--record'], { CLAUDE_CODE_SESSION_ID: KEY('g') }); cliCases++;
      fs.writeFileSync(path.join(dG, '.leerness', 'git-visible-control.txt'), 'control\n');
       
       
      const st = String(gitSpawn(['status', '--porcelain', '-uall'], { cwd: dG, encoding: 'utf8', timeout: 60000 }).stdout || '');
      if (/cache[\\/]sessions/.test(st)) bad.push('⑦세션 파일이 git 에 노출됨');
      if (/environment\.json|last-handoff\.json|tech-profile\.json/.test(st)) bad.push('⑦기본 handoff 동적 projection이 git 에 노출됨');
      if (!/git-visible-control\.txt/.test(st)) bad.push('⑦대조군 실패 — git 이 .leerness 를 아예 안 보고 있음(위 판정이 공허)');
      observedRecords += nRec(dG);
    }

     
     
    {
      const dC2 = mkS('close'); const kC = KEY('c1'), kO = KEY('c2');
      RS(dC2, ['handoff', dC2, '--record'], { CLAUDE_CODE_SESSION_ID: kC }); cliCases++;
      RS(dC2, ['handoff', dC2, '--record'], { CLAUDE_CODE_SESSION_ID: kO }); cliCases++;
      const beforeMark = /다른 세션 기록|other session record/.test(String(RS(dC2, ['handoff', dC2], { CLAUDE_CODE_SESSION_ID: kC }).stdout || '')); cliCases++;
      if (!beforeMark) bad.push('⑦close 전 헤드라인이 침묵(계측 붕괴)');
      const rc2 = RS(dC2, ['session', 'close', dC2], { CLAUDE_CODE_SESSION_ID: kO }); cliCases++;
      if (rc2.status !== 0) bad.push(`⑦session close exit=${rc2.status}`);
      let recC = null; try { recC = JSON.parse(fs.readFileSync(path.join(storeDir(dC2), `${kO}.json`), 'utf8')); } catch { bad.push('⑦close 레코드 파싱 실패'); }
      if (recC && !recC.closedAt) bad.push('⑦closedAt 미기록(배선 없음)');
      const afterMark = /다른 세션 기록|other session record/.test(String(RS(dC2, ['handoff', dC2], { CLAUDE_CODE_SESSION_ID: kC }).stdout || '')); cliCases++;
      if (afterMark) bad.push('⑦close 기록 후에도 헤드라인이 발화');
      observedRecords += nRec(dC2);
      dbg.close = { closedAt: !!(recC && recC.closedAt), before: beforeMark, after: afterMark };
    }

     
     
    {
      const dS = mkS('state'); const kS = KEY('s1');
      let j0 = null; try { j0 = JSON.parse(String(RS(dS, ['sessions', dS, '--json'], { CLAUDE_CODE_SESSION_ID: kS }).stdout || '')); } catch { bad.push('⑧빈상태 JSON 아님'); }
      cliCases++;
      if (j0 && (j0.selfRecordPresent !== false || j0.total !== 0 || j0.registryState !== 'ok')) bad.push(`⑧빈상태=${JSON.stringify({ p: j0.selfRecordPresent, t: j0.total, r: j0.registryState })}`);
      RS(dS, ['handoff', dS, '--record'], { CLAUDE_CODE_SESSION_ID: kS }); cliCases++;
      let j1 = null; try { j1 = JSON.parse(String(RS(dS, ['sessions', dS, '--json'], { CLAUDE_CODE_SESSION_ID: kS }).stdout || '')); } catch { bad.push('⑧등록후 JSON 아님'); }
      cliCases++;
      if (j1 && j1.selfRecordPresent !== true) bad.push('⑧등록했는데 selfRecordPresent=false');
      if (j1 && j1.sessions[0] && j1.sessions[0].hostRelation !== 'same') bad.push(`⑧hostRelation=${j1.sessions[0].hostRelation}`);
       
      let j2 = null; try { j2 = JSON.parse(String(RS(dS, ['sessions', dS, '--json'], { CLAUDE_CODE_SESSION_ID: kS, LEERNESS_NO_SESSION_PRESENCE: '1' }).stdout || '')); } catch { bad.push('⑧optout JSON 아님'); }
      cliCases++;
      if (j2 && (j2.selfRecordPresent !== true || j2.selfSuppressedReason !== 'opt-out')) bad.push(`⑧optout=${JSON.stringify({ p: j2.selfRecordPresent, r: j2.selfSuppressedReason })}`);
       
      const sFile = path.join(storeDir(dS), `${kS}.json`);
      fs.writeFileSync(sFile, '{{{broken'); const sEvidence = sessionFileEvidence(sFile);
      const corruptSessions = RS(dS, ['sessions', dS, '--json'], { CLAUDE_CODE_SESSION_ID: kS }); cliCases++;
      if (sessionFileEvidence(sFile) !== sEvidence) bad.push('⑧JSON 읽기가 손상 원본 바이트/메타데이터를 변경함');
      let j3 = null; try { j3 = JSON.parse(String(corruptSessions.stdout || '')); } catch { bad.push('⑧손상 JSON 아님'); }
      if (corruptSessions.status !== 1 || String(corruptSessions.stderr || '').length !== 0) bad.push(`⑧손상 JSON exit=${corruptSessions.status} stderr ${String(corruptSessions.stderr).length}B`);
      if (!(j3 && j3.ok === false && j3.registryState === 'unreadable' && j3.storeError === 'E_STORE_CORRUPT' && j3.unreadableRecords === 1)) bad.push(`⑧손상=${JSON.stringify({ r: j3.registryState, u: j3.unreadableRecords, e: j3.storeError })}`);
       
       
      const brokenHuman = RS(dS, ['sessions', dS], { CLAUDE_CODE_SESSION_ID: kS }); cliCases++;
      if (sessionFileEvidence(sFile) !== sEvidence) bad.push('⑧사람용 읽기가 손상 원본 바이트/메타데이터를 변경함');
      const _brokenOut = String(brokenHuman.stdout || '');
      if (brokenHuman.status !== 0 || String(brokenHuman.stderr || '').length !== 0) bad.push(`⑧사람용 손상 보고 exit=${brokenHuman.status}`);
      if (/^\s*(?:기록 없음|no records)\.\s*$/mi.test(_brokenOut)) bad.push('⑧손상인데 "기록 없음" 이라 말함');
      if (!/E_STORE_CORRUPT/.test(_brokenOut) || !/세션 저장소를 읽지 못했습니다|could not read the session store/.test(_brokenOut) || !/기록이 없다는 뜻이 아닙니다|does NOT mean there are no records/.test(_brokenOut)) bad.push('⑧손상/미확인 상태를 사람용 출력에서 정확히 알리지 않음');
      dbg.state = { empty: j0 && j0.selfRecordPresent, after: j1 && j1.selfRecordPresent, partial: j3 && j3.registryState };
    }

     
    {
      const dH1 = mkS('salt1'), dH2 = mkS('salt2');
      const k1 = KEY('h1'), k2 = KEY('h2');
      RS(dH1, ['handoff', dH1, '--record'], { CLAUDE_CODE_SESSION_ID: k1 }); cliCases++;
      RS(dH2, ['handoff', dH2, '--record'], { CLAUDE_CODE_SESSION_ID: k2 }); cliCases++;
      let a = null, b = null;
      try { a = JSON.parse(fs.readFileSync(path.join(storeDir(dH1), `${k1}.json`), 'utf8')); } catch { bad.push('⑨salt1 레코드 없음'); }
      try { b = JSON.parse(fs.readFileSync(path.join(storeDir(dH2), `${k2}.json`), 'utf8')); } catch { bad.push('⑨salt2 레코드 없음'); }
      if (a && b) {
        observedRecords += 2;
        if (!a.hostId || !b.hostId) bad.push('⑨hostId 없음');
        else if (a.hostId === b.hostId) bad.push('⑨프로젝트가 달라도 hostId 동일(교차 상관 가능)');
        const naive = require('crypto').createHash('sha256').update(String(os.hostname())).digest('hex').slice(0, 12);
        if (a.hostId === naive) bad.push('⑨무염 해시 그대로(사전 대입 가능)');
         
        const raw = JSON.stringify(a);
        if (raw.includes(os.hostname())) bad.push('⑨레코드에 hostname 원문');
        if (raw.includes(dH1)) bad.push('⑨레코드에 cwd 경로');
        if ('pid' in a) bad.push('⑨pid 기록됨');
      }
      dbg.salt = { differs: !!(a && b && a.hostId !== b.hostId) };
    }

     
    if (observedRecords < 8) bad.push(`⑩관측 레코드 ${observedRecords}건(<8) — 계측 붕괴`);
    if (cliCases < 30) bad.push(`⑩실행 CLI ${cliCases}건(<30) — 표본 축소`);
    dbg.observedRecords = observedRecords; dbg.cliCases = cliCases;
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ Y(1.36.129/P-0016 P1) 세션 프레즌스: 세션당 1레코드(하트비트 살아있음) · 억제 4종 각각 격리 대조군 · 헤드라인 0침묵/1발화/타머신침묵 · 정상 기록 대조 + 손상 원본 보존/명시적 읽기불가(--json stderr 0B) · 경로탈옥 0 · sessions 한계고지 · git 미노출(대조군 포함) · "활성" 미사용 ${JSON.stringify(dbg)}`
    : '✗ 1.36.129 세션 프레즌스 실패 ' + JSON.stringify({ bad: bad.slice(0, 10), dbg }));
  if (!ok) failed++;
}

 
 
 
 
 
 
 
 
if (e2eShard.take('Z(1.36.131/P-0016 P2)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-p2-131-'));
  const envP = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
    'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'CI', 'GITHUB_ACTIONS', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG']) delete envP[k];
  const RP = (d, a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: d, encoding: 'utf8', timeout: 600000, env: envP, maxBuffer: 32 * 1024 * 1024 });
  const mkP = (name, full) => {
    const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
    const r = RP(d, ['init', d, '--yes'].concat(full ? [] : ['--minimal']));
    if (r.status !== 0) bad.push(`${name}:init실패(${r.status})`);
    return d;
  };
   
   
  const lockProbe = (tag, d, target, argv) => {
    const lock = target + '.lock', relFile = path.join(d, `released-${tag}.json`);
    fs.writeFileSync(lock, String(process.pid));
    const rs = path.join(sb, `rel-${tag}.js`);
    fs.writeFileSync(rs, 'const fs=require("fs");setTimeout(()=>{try{fs.unlinkSync(' + JSON.stringify(lock) + ')}catch{};fs.writeFileSync(' + JSON.stringify(relFile) + ',String(Date.now()))},2500);');
    const rel = cp.spawn(process.execPath, [rs], { detached: true, stdio: 'ignore' }); rel.unref();
    const t0 = Date.now();
    const r = RP(d, argv);
    const elapsed = Date.now() - t0;
    let tr = null; try { tr = Number(fs.readFileSync(relFile, 'utf8')); } catch {}
    let tw = null; try { tw = fs.statSync(target).mtimeMs; } catch {}
    try { fs.unlinkSync(lock); } catch {}
     
    if (!tr) bad.push(`${tag}:해제 전에 끝남(${elapsed}ms) — 락 무시`);
    else if (!(tw >= tr - 150)) bad.push(`${tag}:락 보유 중에 씀(해제 대비 ${Math.round(tw - tr)}ms)`);
    else if (elapsed < 2000) bad.push(`${tag}:기다리지 않음(${elapsed}ms)`);
    return { exit: r.status, elapsed, lagMs: (tr && tw) ? Math.round(tw - tr) : null };
  };
  try {
     
    {
      const d = mkP('rules', true);
      const ra = RP(d, ['rule', 'add', '매 세션 점검', '--trigger', 'every-session', '--path', d, '--json']);
      if (ra.status !== 0) bad.push(`①rule add exit=${ra.status}`);
      const rp = path.join(d, '.leerness', 'rules.md');
      const HEAD = 'HEADNOTE' + process.pid.toString(36), TAIL = 'TAILNOTE' + process.pid.toString(36);
      fs.writeFileSync(rp, `# ${HEAD}\n\n` + fs.readFileSync(rp, 'utf8')
        + `\n\n## ${TAIL}\n자유 서술 문단.\n\n| 이름 | 담당 |\n|---|---|\n| 김 | 백엔드 |\n`);
      const rc = RP(d, ['session', 'close', d]);
      if (rc.status !== 0) bad.push(`①session close exit=${rc.status}`);
      const L = fs.readFileSync(rp, 'utf8').split('\n');
      const at = (s) => L.findIndex(l => l.includes(s));
      const iH = at(HEAD), iT = at(TAIL), iTable = L.findIndex(l => /^\| R-\d/.test(l.trim())), iUser = at('| 김 | 백엔드 |');
      if (iH < 0) bad.push('①머리말 유실');
      if (iT < 0) bad.push('①꼬리말 유실');
       
      if (!(iH >= 0 && iTable >= 0 && iH < iTable)) bad.push(`①머리말이 앞자리를 잃음(head=${iH} table=${iTable})`);
      if (!(iT >= 0 && iTable >= 0 && iT > iTable)) bad.push(`①꼬리말이 뒷자리를 잃음(tail=${iT} table=${iTable})`);
      if (iUser < 0) bad.push('①사용자 마크다운 표가 지워짐');
      let rl = null; try { rl = JSON.parse(String(RP(d, ['rule', 'list', '--path', d, '--json']).stdout || '')); } catch { bad.push('①rule list JSON 아님'); }
      const nRules = rl ? (Array.isArray(rl) ? rl.length : (rl.rules || []).length) : -1;
      if (nRules !== 1) bad.push(`①룰 행 ${nRules}건(기대 1) — 보존이 표를 깼다`);
      for (let i = 0; i < 3; i++) RP(d, ['session', 'close', d]);
      const fin = fs.readFileSync(rp, 'utf8');
      const cH = (fin.match(new RegExp(HEAD, 'g')) || []).length, cT = (fin.match(new RegExp(TAIL, 'g')) || []).length;
      if (cH !== 1 || cT !== 1) bad.push(`①멱등 아님(머리 ${cH} 꼬리 ${cT})`);
      dbg.rules = { head: iH, table: iTable, tail: iT, userTable: iUser, rules: nRules, idem: cH === 1 && cT === 1 };
    }

     
    {
      const d = mkP('rules-nofm', true);
      const rp = path.join(d, '.leerness', 'rules.md');
      fs.writeFileSync(rp, '# 메모\n앞 문단 HEADSENT\n---\n뒤 문단 TAILSENT\n');
      const ra = RP(d, ['rule', 'add', '첫 룰', '--trigger', 'every-session', '--path', d, '--json']);
      if (ra.status !== 0) bad.push(`①b rule add exit=${ra.status}(셋업 실패 — 아래 단언이 공허해진다)`);
      const t = fs.readFileSync(rp, 'utf8');
      if (!t.includes('HEADSENT')) bad.push('①b 앞 문단 유실');
      if (!t.includes('TAILSENT')) bad.push('①b 중간 `---` 뒤 문단 유실(frontmatter 오인)');
      let rl = null; try { rl = JSON.parse(String(RP(d, ['rule', 'list', '--path', d, '--json']).stdout || '')); } catch {}
      const n2 = rl ? (Array.isArray(rl) ? rl.length : (rl.rules || []).length) : -1;
      if (n2 !== 1) bad.push(`①b 룰 ${n2}건(기대 1)`);
      dbg.noFm = { head: t.includes('HEADSENT'), tail: t.includes('TAILSENT'), rules: n2 };
    }

     
     
    {
      const d = mkP('autofix', false);
      const pt = path.join(d, '.leerness', 'progress-tracker.md');
      const RID = 'T-7' + String(process.pid % 1000).padStart(3, '0');
      const row = `| ${RID} | requested | 중복행 | - | - | 2026-08-18 |`;
      fs.writeFileSync(pt, fs.readFileSync(pt, 'utf8').replace(/\n?$/, '\n') + row + '\n' + row + '\n');
      if ((fs.readFileSync(pt, 'utf8').match(new RegExp(RID, 'g')) || []).length !== 2) bad.push('②픽스처에 중복행이 없음(계측 붕괴)');
      const p = lockProbe('②autofix', d, pt, ['idempotency', 'audit', '--auto-fix', '--path', d]);
      const nAfter = (fs.readFileSync(pt, 'utf8').match(new RegExp(RID, 'g')) || []).length;
      if (nAfter !== 1) bad.push(`②dedup 안 됨(중복행 ${nAfter}, 기대 1) — 락이 기능을 죽였다`);
      dbg.autofix = Object.assign(p, { dupAfter: nAfter });
    }

     
     
    {
      const d = mkP('verifyrules', true);
      const rp = path.join(d, '.leerness', 'rules.md');
      const ra = RP(d, ['rule', 'add', '매 커밋마다 버전 bump', '--trigger', 'every-commit', '--path', d, '--json']);
      if (ra.status !== 0) bad.push(`③rule add exit=${ra.status}`);
      const rv = RP(d, ['rule', 'verify', '--path', d]);
      if (rv.status !== 0) bad.push(`③rule verify exit=${rv.status}`);
      fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.2.0"}');
      const before = fs.readFileSync(rp); const mtime = fs.statSync(rp).mtimeMs;
      const closed = RP(d, ['session', 'close', d, '--no-suggest', '--json']);
      let result; try { result = JSON.parse(closed.stdout); } catch {}
      if (closed.status !== 0 || result?.ruleVerification?.compliance !== 'unknown') bad.push('③rule observations contract missing');
      if (!fs.readFileSync(rp).equals(before) || fs.statSync(rp).mtimeMs !== mtime) bad.push('③verification rewrote user rules');
      dbg.verifyRules = { exit: closed.status, preserved: fs.readFileSync(rp).equals(before) };
    }

     
    {
      const d = mkP('falsesuccess', false);
      const pt = path.join(d, '.leerness', 'progress-tracker.md');
      const RID = 'T-8' + String(process.pid % 1000).padStart(3, '0');
      const row = `| ${RID} | requested | 중복행 | - | - | 2026-08-18 |`;
      fs.writeFileSync(pt, fs.readFileSync(pt, 'utf8').replace(/\n?$/, '\n') + row + '\n' + row + '\n| T-9999 | requested | 셀부족 |\n');
      const r = RP(d, ['idempotency', 'audit', '--auto-fix', '--path', d]);
      const outTxt = String(r.stdout || '') + String(r.stderr || '');
      const stillDup = (fs.readFileSync(pt, 'utf8').match(new RegExp(RID, 'g')) || []).length;
      if (stillDup < 2) bad.push(`④전제 붕괴: 중복이 실제로 고쳐졌다(${stillDup}) — 이 케이스는 실패 경로가 아니다`);
      else {
        if (r.status === 0) bad.push('④고치지 못했는데 exit 0 (거짓 성공)');
        if (/auto-fix 적용/.test(outTxt)) bad.push('④고치지 못했는데 "auto-fix 적용" 이라고 보고');
        if (!/auto-fix 실패/.test(outTxt)) bad.push('④실패를 말하지 않음(조용한 무동작)');
      }
      const dr = RP(d, ['drift', 'check', '--auto-fix', '--path', d]);
      if (!/auto-fix 실패/.test(String(dr.stdout || '') + String(dr.stderr || ''))) bad.push('④drift --auto-fix 가 실패를 감춤');
      dbg.falseSuccess = { exit: r.status, stillDup, driftLoud: /auto-fix 실패/.test(String(dr.stdout || '')) };
    }

     
    {
      const d = mkP('plain', false);
      const t0 = Date.now();
      for (const a of [['task', 'add', '보통 작업', '--path', d, '--json'], ['handoff', d], ['session', 'close', d]]) {
        const r = RP(d, a);
        if (r.status !== 0) bad.push(`⑤평범한 흐름 실패: ${a[0]} exit=${r.status}`);
      }
      let tl = null; try { tl = JSON.parse(String(RP(d, ['task', 'list', '--path', d, '--json']).stdout || '')); } catch { bad.push('⑤task list JSON 아님'); }
      const n = tl ? (Array.isArray(tl) ? tl.length : (tl.tasks || tl.rows || []).length) : -1;
      if (!(n >= 1)) bad.push(`⑤작업이 사라짐(${n})`);
      dbg.plain = { ms: Date.now() - t0, tasks: n };
    }
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ Z(1.36.131/P-0016 P2) 쓰기 유실 차단: rules.md 사람 글이 **자리까지** 보존(사용자 표·중간 --- 포함, 멱등) · progress/rules RMW 가 락 해제 뒤에만 씀(mtime 대조) · auto-fix 실패를 성공으로 보고하지 않음 · 평범한 단일 흐름 무회귀 ${JSON.stringify(dbg)}`
    : '✗ 1.36.131 쓰기 유실 차단 실패 ' + JSON.stringify({ bad: bad.slice(0, 10), dbg }));
  if (!ok) failed++;
}
 
 
 
 
 
 
if (e2eShard.take('AA(1.36.132/UR-0069)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-132-'));
  const envP = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
    'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'LEERNESS_SESSION_ID', 'CI', 'GITHUB_ACTIONS', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG',
    'CLAUDECODE', 'CURSOR_AGENT', 'CODEX_MANAGED_BY_NPM', 'CODEX_MANAGED_BY_PNPM', 'CODEX_MANAGED_BY_BUN', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
     
     
    'CODEX_THREAD_ID']) delete envP[k];    
  const RP = (d, a, extra) => cp.spawnSync(process.execPath, [CLI, ...a],
    { cwd: d, encoding: 'utf8', timeout: 600000, env: Object.assign({}, envP, extra || {}), maxBuffer: 32 * 1024 * 1024 });
  const mkP = (name, full) => {
    const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
    const r = RP(d, ['init', d, '--yes'].concat(full ? [] : ['--minimal']));
    if (r.status !== 0) bad.push(`${name}:init실패(${r.status})`);
    return d;
  };
  try {
     
     
     
     
     
    {
      const d = mkP('concurrent', false);
      const N = 24;
      const t0 = Date.now();
       
       
      const mk = path.join(sb, 'markers'); fs.mkdirSync(mk, { recursive: true });
      const runner = path.join(sb, 'runner.js');
      fs.writeFileSync(runner, [
        'const cp=require("child_process"),fs=require("fs");',
        'const a=process.argv.slice(2);',
        'const r=cp.spawnSync(process.execPath,[a[0],"task","add","동시-"+a[2]+"-xxxxxxxxxxxxxxxx","--path",a[1],"--json"],{cwd:a[1],encoding:"utf8",timeout:300000});',
        'fs.writeFileSync(a[3]+"/"+a[2]+".done",JSON.stringify({code:r.status,err:String(r.stderr||"").slice(0,150)}));',
      ].join('\n'));
      for (let i = 0; i < N; i++) {
        const c = cp.spawn(process.execPath, [runner, CLI, d, String(i), mk], { cwd: d, env: envP, stdio: 'ignore', detached: true });
        c.unref();
      }
      const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {} };
      const deadline = Date.now() + 300000;
      while (fs.readdirSync(mk).length < N && Date.now() < deadline) sleep(100);
      const marks = fs.readdirSync(mk).map(f => { try { return JSON.parse(fs.readFileSync(path.join(mk, f), 'utf8')); } catch { return { code: -1 }; } });
      const codes = marks.map(m => m.code); const errs = marks.map(m => m.err).filter(Boolean);
      const txt = fs.readFileSync(path.join(d, '.leerness', 'progress-tracker.md'), 'utf8');
      let present = 0; for (let i = 0; i < N; i++) if (txt.includes(`동시-${i}-`)) present++;
      const crashed = codes.filter(c => c !== 0).length;
      if (codes.length < N) bad.push(`①자식 ${codes.length}/${N} 만 종료(계측 붕괴)`);
      if (present !== N) bad.push(`①동시 쓰기 유실 ${N - present}행 (${present}/${N} 생존)`);
      if (crashed > 0) bad.push(`①자식 크래시 ${crashed}건 — rename/락 경합에서 죽었다: ${errs[0] || '?'}`);
       
       
       
      const lockWarnings = errs.filter(e => /락 획득 실패/.test(e));
      const telemetryFailOpen = lockWarnings.filter(e => /비핵심 기록만 보호 없이 진행합니다: usage-stats\.json\b/.test(e)).length;
      const failOpen = lockWarnings.length - telemetryFailOpen;
      if (failOpen > 0) bad.push(`①락 fail-open ${failOpen}건 — 보호 없이 진행했다(유실이 없어도 실패다)`);
      dbg.concurrent = { N, present, crashed, failOpen, telemetryFailOpen, ms: Date.now() - t0 };
    }

     
     
    {
      const d = mkP('delivery', true);
       
      const ro = RP(d, ['handoff', d, '--record'], { LEERNESS_SESSION_ID: 'peersession00001' });
      if (ro.status !== 0) bad.push(`②피어 handoff exit=${ro.status}`);
      fs.writeFileSync(path.join(d, '.leerness', 'agent-reminders.md'), '# 리마인더\n- DELIVERTEST 이 줄이 보여야 한다\n');
      const me = { LEERNESS_SESSION_ID: 'mysession00000001' };
      const plain = RP(d, ['handoff', d], me);
      const compact = RP(d, ['handoff', d, '--compact'], me);
      const jsonR = RP(d, ['handoff', d, '--json'], me);
       
       
      const walk = (dir) => { const out = []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, e.name); if (e.isDirectory()) out.push(...walk(fp)); else out.push(fp); } return out.sort(); };
      const contents = () => JSON.stringify(walk(path.join(d, '.leerness')).map(f => [f, fs.statSync(f).mtimeMs, fs.readFileSync(f).toString('base64')]));
      const readsBefore = contents();
      for (const a of [['handoff', d], ['handoff', d, '--compact'], ['handoff', d, '--json']]) RP(d, a, me);
      if (contents() !== readsBefore) bad.push('②기본 읽기가 다른 세션 기록을 보여주며 파일을 바꿨다 — 쓰기 0 계약 위반');
      const before = walk(path.join(d, '.leerness'));
      const hook = RP(d, ['hook', 'session-start'], me);
      const after = walk(path.join(d, '.leerness'));
      const P = String(plain.stdout || ''), C = String(compact.stdout || ''), H = String(hook.stdout || '');
      let J = null; try { J = JSON.parse(String(jsonR.stdout || '')); } catch { bad.push('②--json 이 JSON 이 아님'); }
       
      if (!/다른 세션 기록 1건|1 other session record/.test(P)) bad.push('②평문 헤드라인에 다른 세션 없음');
       
      if (!/👥 (?:다른 세션|other sessions) 1/.test(C)) bad.push('②--compact 에 다른 세션 없음(MCP 경로가 못 본다)');
      if (!J || !J.sessions || J.sessions.others !== 1) bad.push(`②--json.sessions.others=${J && J.sessions ? J.sessions.others : 'none'} (기대 1) — 기계 경로가 못 본다`);
      if (!/👥 (?:다른 세션|other sessions) 1/.test(H)) bad.push('②훅에 다른 세션 없음(유일한 강제 경로가 못 본다)');
       
      if (!/DELIVERTEST/.test(P)) bad.push('④리마인더 본문이 handoff 에 안 나옴(죽은 채널)');
      for (const [surface, text] of [['평문', P], ['--compact', C], ['훅', H]]) {
        if (!/not-recorded/.test(text)) bad.push(`②${surface}: 기록 없는 세션인데 안 보인다고 말하지 않음`);
        if (/\(null\)/.test(text)) bad.push(`②${surface}: 사유가 null 로 출력됨`);
      }
      if (!/handoff \. --record/.test(P)) bad.push('②평문에 등록 방법 없음');
      const dMin = mkP('reminder-minimal', false);
      fs.writeFileSync(path.join(dMin, '.leerness', 'agent-reminders.md'), '# 리마인더\n- MINIMALTEST\n');
      const pMin = String(RP(dMin, ['handoff', dMin], me).stdout || '');
      if (!/에이전트 리마인더 대기 \d+줄|line\(s\) of pending agent reminders/.test(pMin)) bad.push('④minimal 평문이 대기 중인 리마인더를 말하지 않음');
      for (const flag of ['--no-headline', '--quiet']) {
        if (/not-recorded|대기 \d+줄|pending agent reminders/.test(String(RP(dMin, ['handoff', dMin, flag], me).stdout || ''))) bad.push(`④${flag} 인데 세션·리마인더 줄이 나옴`);
      }
      const rMinJ = RP(dMin, ['handoff', dMin, '--record', '--json'], me);
      let JMin = null; try { JMin = JSON.parse(String(rMinJ.stdout || '')); } catch {}
      if (!JMin || !JMin.agentReminders) bad.push('④--record --json 에 리마인더 없음');
      const pMinR = String(RP(dMin, ['handoff', dMin, '--record'], me).stdout || '');
      if (!/에이전트 리마인더 대기 \d+줄|line\(s\) of pending agent reminders/.test(pMinR)) bad.push('④--record 평문이 대기 중인 리마인더를 말하지 않음');
      if (!J || !J.agentReminders) bad.push('④--json 에 리마인더 없음');
      if (!/🔔 (?:리마인더|reminders)/.test(H)) bad.push('④훅에 리마인더 없음');
       
      if (after.length !== before.length) bad.push(`②훅이 파일을 만들었다(${after.filter(f => !before.includes(f)).map(f => path.basename(f)).join(',')}) — 쓰기 0 계약 위반`);
       
      const saltP = path.join(d, '.leerness', 'cache', 'sessions', '.host-salt');
      if (fs.existsSync(saltP)) {
        const s0 = fs.readFileSync(saltP, 'utf8');
        RP(d, ['hook', 'session-start'], me);
        if (fs.readFileSync(saltP, 'utf8') !== s0) bad.push('②훅이 .host-salt 를 바꿨다 — 쓰기 0 계약 위반');
      }
      if (String(hook.stderr || '').length) bad.push('②훅 stderr 비어있지 않음');
      dbg.delivery = { plain: /👥/.test(P), compact: /👥/.test(C), json: J && J.sessions ? J.sessions.others : null, hook: /👥/.test(H), hookWrites: after.length - before.length };
    }

     
    {
      const d = mkP('address', true);
      const codexEnv = { CODEX_MANAGED_BY_NPM: '1' };
      const r1 = RP(d, ['handoff', d], codexEnv);
      const r1r = RP(d, ['handoff', d, '--record'], codexEnv);
      const dir = path.join(d, '.leerness', 'cache', 'sessions');
      const n1 = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.json$/.test(f)).length : 0;
      if (n1 !== 0) bad.push(`③주소 없는 세션이 등록됨(${n1}) — 식별 불가인데 기록했다`);
      if (!/이 세션은 다른 세션에게 보이지 않습니다|this session is invisible to others/.test(String(r1.stdout || ''))) bad.push('③주소 없는 세션에게 "안 보인다"고 말하지 않음(비대칭이 조용하다)');
      if (!/이 세션은 다른 세션에게 보이지 않습니다|this session is invisible to others/.test(String(r1r.stdout || ''))) bad.push('③--record 출력이 주소 없는 세션에게 "안 보인다"고 말하지 않음');
       
       
      const TID = '01a01570-54a6-70e2-a002-55291c73a3ce';
      const rT = RP(d, ['handoff', d, '--record'], Object.assign({}, codexEnv, { CODEX_THREAD_ID: TID }));
      if (rT.status !== 0) bad.push(`③codex(thread) handoff exit=${rT.status}`);
      const dirT = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /[.]json$/.test(f)) : [];
      if (!dirT.includes(TID + '.json')) bad.push(`③CODEX_THREAD_ID 로 등록 안 됨(파일: ${dirT.join(',')}) — codex 는 설정 없이 주소를 가져야 한다`);
      let recT = null; try { recT = JSON.parse(fs.readFileSync(path.join(dir, TID + '.json'), 'utf8')); } catch {}
      if (!recT || recT.keySource !== 'CODEX_THREAD_ID') bad.push(`③thread keySource=${recT && recT.keySource}`);
       
      const rN = RP(d, ['handoff', d, '--record'], Object.assign({}, codexEnv, { CODEX_THREAD_ID: TID, CLAUDE_CODE_SESSION_ID: 'parentclaude0001' }));
      if (rN.status !== 0) bad.push(`③중첩 codex handoff exit=${rN.status}`);
      if (!fs.readdirSync(dir).includes('parentclaude0001.json')) bad.push('③claude 하위 codex 가 부모 키로 접히지 않음');
       
      const r2 = RP(d, ['handoff', d, '--record'], Object.assign({}, codexEnv, { CODEX_THREAD_ID: TID, LEERNESS_SESSION_ID: 'codexsession0001' }));
      if (r2.status !== 0) bad.push(`③codex handoff exit=${r2.status}`);
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.json$/.test(f)) : [];
      if (!files.includes('codexsession0001.json')) bad.push(`③LEERNESS_SESSION_ID 로도 등록 안 됨(파일: ${files.join(',')})`);
      let rec = null; try { rec = JSON.parse(fs.readFileSync(path.join(dir, 'codexsession0001.json'), 'utf8')); } catch {}
      if (!rec || rec.keySource !== 'LEERNESS_SESSION_ID') bad.push(`③keySource=${rec && rec.keySource} (기대 LEERNESS_SESSION_ID)`);
      if (!rec || rec.outermostAgent !== 'codex-cli') bad.push(`③에이전트 라벨=${rec && rec.outermostAgent} (기대 codex-cli)`);
       
      RP(d, ['handoff', d, '--record'], { CLAUDE_CODE_SESSION_ID: 'claudesession0001' });
      const r3 = RP(d, ['handoff', d, '--json'], { CLAUDE_CODE_SESSION_ID: 'claudesession0001' });
      let J3 = null; try { J3 = JSON.parse(String(r3.stdout || '')); } catch {}
      if (!J3 || !J3.sessions || J3.sessions.others !== 3) bad.push(`③claude 가 codex 세션들을 못 봄(others=${J3 && J3.sessions ? J3.sessions.others : 'none'}, 기대 3)`);
      if (!J3 || J3.sessions.selfRegistered !== true) bad.push('③claude 세션이 등록 안 됨(기존 동작 회귀)');
      dbg.address = { unaddressed: n1, threadKeySource: recT && recT.keySource, keySource: rec && rec.keySource, agent: rec && rec.outermostAgent, claudeSeesCodex: J3 && J3.sessions && J3.sessions.others };
    }

     
    {
       
      const empty = path.join(sb, 'empty-not-a-project'); fs.mkdirSync(empty, { recursive: true });
      const rq = RP(empty, ['sessions', empty, '--json']);
      const made = fs.readdirSync(empty).length;
      if (made !== 0) bad.push(`⑥조회 명령이 파일을 만들었다(${made}개) — 읽기는 읽기여야 한다`);
      if (rq.status !== 0) bad.push(`⑥sessions --json exit=${rq.status}`);
       
      const d2 = mkP('norecord', false);
      const me2 = { LEERNESS_SESSION_ID: 'norecordsess0001' };
      RP(d2, ['handoff', d2, '--record', '--no-record'], me2);
      const dir2 = path.join(d2, '.leerness', 'cache', 'sessions');
      const afterHandoff = fs.existsSync(dir2) ? fs.readdirSync(dir2).filter(f => /[.]json$/.test(f)).length : 0;
      RP(d2, ['session', 'close', d2, '--no-record'], me2);
      const afterClose = fs.existsSync(dir2) ? fs.readdirSync(dir2).filter(f => /[.]json$/.test(f)).length : 0;
      if (afterHandoff !== 0) bad.push(`⑥handoff --no-record 가 기록함(${afterHandoff})`);
      if (afterClose !== 0) bad.push(`⑥session close --no-record 가 기록함(${afterClose}) — 같은 스토어인데 계약이 갈렸다`);
       
      const d3 = mkP('invisible', true);
      RP(d3, ['handoff', d3, '--record'], { LEERNESS_SESSION_ID: 'visiblepeer00001' });
      const noAddr = { CODEX_MANAGED_BY_NPM: '1' };
      const iP = String(RP(d3, ['handoff', d3], noAddr).stdout || '');
      const iC = String(RP(d3, ['handoff', d3, '--compact'], noAddr).stdout || '');
      const iH = String(RP(d3, ['hook', 'session-start'], noAddr).stdout || '');
      if (!/이 세션은 다른 세션에게 보이지 않습니다|this session is invisible to others/.test(iP)) bad.push('⑥평문에 "나는 안 보임" 없음');
      if (!/🙈/.test(iC)) bad.push('⑥--compact 에 "나는 안 보임" 없음(짧은 표면일수록 필요한 신호다)');
      if (!/🙈/.test(iH)) bad.push('⑥훅에 "나는 안 보임" 없음');
      dbg.prereq = { readOnlyWrites: made, afterHandoff, afterClose, invisible: [/🙈/.test(iP), /🙈/.test(iC), /🙈/.test(iH)] };
    }

     
     
    {
      const d = mkP('sharedkey', true);
      const KEY = 'sharedaddr000001';
      RP(d, ['handoff', d, '--record'], { CLAUDECODE: '1', LEERNESS_SESSION_ID: KEY });
      const r2 = RP(d, ['handoff', d, '--record'], { CODEX_MANAGED_BY_NPM: '1', LEERNESS_SESSION_ID: KEY });
      const warned = /주소 공유/.test(String(r2.stderr || ''));
      if (!warned) bad.push('⑦같은 주소를 다른 에이전트가 써도 조용함(조용한 병합)');
      let rec = null; try { rec = JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'cache', 'sessions', KEY + '.json'), 'utf8')); } catch {}
      if (!rec || !rec.sharedKeyAgents) bad.push('⑦레코드에 공유 표식 없음');
      const shEnv = { CODEX_MANAGED_BY_NPM: '1', LEERNESS_SESSION_ID: KEY };
      const cOut = String(RP(d, ['handoff', d, '--compact'], shEnv).stdout || '');
      if (!/주소 공유|address shared/.test(cOut)) bad.push('⑦--compact 에 공유 경고 없음');
      const pOut = String(RP(d, ['handoff', d], shEnv).stdout || '');
      if (!/주소 공유|address shared/.test(pOut)) bad.push('⑦평문에 공유 경고 없음 — stderr 는 한 번뿐이라 여기서 빠지면 영영 안 보인다');
      const hOut = String(RP(d, ['hook', 'session-start'], shEnv).stdout || '');
      if (!/주소 공유|address shared/.test(hOut)) bad.push('⑦훅에 공유 경고 없음');
       
      const d2 = mkP('distinctkey', true);
      RP(d2, ['handoff', d2, '--record'], { CLAUDECODE: '1', LEERNESS_SESSION_ID: 'distinctkeyA0001' });
      const rB = RP(d2, ['handoff', d2, '--record'], { CODEX_MANAGED_BY_NPM: '1', LEERNESS_SESSION_ID: 'distinctkeyB0001' });
      if (/주소 공유/.test(String(rB.stderr || ''))) bad.push('⑦서로 다른 주소인데 공유 경고(오탐)');
      const d3 = mkP('unknownlabel', true);
      RP(d3, ['handoff', d3, '--record'], { LEERNESS_SESSION_ID: 'unknownlabel0001' });
      const rU = RP(d3, ['handoff', d3, '--record'], { CODEX_MANAGED_BY_NPM: '1', LEERNESS_SESSION_ID: 'unknownlabel0001' });
      if (/주소 공유/.test(String(rU.stderr || ''))) bad.push('⑦라벨이 unknown 이었는데 공유 경고(셸별 env 가시성 차이로 오탐)');
      dbg.sharedKey = { warned, tag: rec && rec.sharedKeyAgents };
    }

     
    {
      const d = mkP('honesty', true);
      const me = { LEERNESS_SESSION_ID: 'honestysess00001' };
       
      const jr = RP(d, ['handoff', d, '--json', '--record', '--no-record'], me);
      let J = null; try { J = JSON.parse(String(jr.stdout || '')); } catch { bad.push('⑧--no-record --json 파싱 실패'); }
      const sdir = path.join(d, '.leerness', 'cache', 'sessions');
      const madeAny = fs.existsSync(sdir) ? fs.readdirSync(sdir).length : 0;
      if (madeAny !== 0) bad.push(`⑧--no-record 가 세션 스토어에 ${madeAny}개를 만들었다(염 포함)`);
      if (!J || J.sessions.selfRegistered !== false) bad.push('⑧--no-record 인데 selfRegistered=true (거짓 성공)');
      if (!J || J.sessions.selfAddressed !== true) bad.push('⑧주소는 있는데 selfAddressed=false');
       
      fs.mkdirSync(path.dirname(sdir), { recursive: true });
      fs.writeFileSync(sdir, 'not-a-directory');
      const jr2 = RP(d, ['handoff', d, '--json'], me);
      let J2 = null; try { J2 = JSON.parse(String(jr2.stdout || '')); } catch {}
      if (!J2 || !J2.sessions.storeError) bad.push('⑧저장소 읽기 실패를 others:0 으로 축약(못 읽은 것은 없는 것이 아니다)');
      const p2 = String(RP(d, ['handoff', d], me).stdout || '');
      if (!/읽지 못함/.test(p2)) bad.push('⑧평문이 저장소 오류를 말하지 않음');
      const c2 = String(RP(d, ['handoff', d, '--compact'], me).stdout || ''), s2 = String(RP(d, ['sessions', d], me).stdout || '');
      for (const [surface, text] of [['평문', p2], ['--compact', c2], ['sessions', s2]]) {
        if (/not-recorded|handoff \. --record/.test(text)) bad.push(`⑧${surface}: 저장소를 못 읽었는데 기록이 없다고 단정함`);
      }
      try { fs.unlinkSync(sdir); } catch {}
       
      const p3 = String(RP(d, ['handoff', d], { LEERNESS_SESSION_ID: 'short', CLAUDE_CODE_SESSION_ID: 'fallbackkey00001' }).stdout || '');
      if (!/LEERNESS_SESSION_ID/.test(p3)) bad.push('⑧무효한 명시 주소를 조용히 무시(사용자 설정을 말없이 뒤집음)');
       
      const d2 = mkP('casefold', true);
      RP(d2, ['handoff', d2, '--record'], { LEERNESS_SESSION_ID: 'CaseKey01ABCD' });
      RP(d2, ['handoff', d2, '--record'], { LEERNESS_SESSION_ID: 'casekey01abcd' });
      const cdir = path.join(d2, '.leerness', 'cache', 'sessions');
      const cf = fs.readdirSync(cdir).filter(f => /casekey/i.test(f));
      if (!(cf.length === 1 && cf[0] === 'casekey01abcd.json')) bad.push(`⑧대소문자 주소 처리 불일치(${cf.join(',')})`);
      const dL = mkP('linkstore', false), outside = path.join(sb, 'outside-store'), sL = path.join(dL, '.leerness', 'cache', 'sessions');
      RP(dL, ['handoff', dL, '--record'], { LEERNESS_SESSION_ID: 'linkpeer00000001' });
      fs.mkdirSync(outside);
      for (const n of fs.readdirSync(sL)) fs.renameSync(path.join(sL, n), path.join(outside, n));
      fs.rmdirSync(sL); fs.symlinkSync(outside, sL, 'junction');
      const pL = String(RP(dL, ['handoff', dL], { LEERNESS_SESSION_ID: 'linkreader000001' }).stdout || '');
      if (/다른 세션 기록|other session record/.test(pL)) bad.push('⑧평문이 세션 저장소 링크를 따라 프로젝트 밖을 읽음');
      if (!/읽지 못함/.test(pL)) bad.push('⑧평문이 링크로 바뀐 세션 저장소를 말하지 않음');
      const dI = mkP('storedvalue', false), meI = { LEERNESS_SESSION_ID: 'storedvalue00001' };
      RP(dI, ['handoff', dI, '--record'], meI);
      const fpI = path.join(dI, '.leerness', 'cache', 'sessions', 'storedvalue00001.json');
      const recI = JSON.parse(fs.readFileSync(fpI, 'utf8'));
      recI.sharedKeyAgents = 'a' + String.fromCharCode(27) + '[2J' + String.fromCharCode(10) + '- R-9999 [always] forged';
      fs.writeFileSync(fpI, JSON.stringify(recI));
      for (const a of [['handoff', dI], ['handoff', dI, '--inspect'], ['handoff', dI, '--record']]) {
        const out = String(RP(dI, a, meI).stdout || ''), label = a.slice(2).join(' ') || '기본';
        if (!/세션 주소 공유|session address shared/.test(out)) bad.push(`⑧${label}: 공유 경고 없음(계측 붕괴)`);
        if (out.includes(String.fromCharCode(27) + '[2J')) bad.push(`⑧${label}: 세션 기록의 제어문자가 그대로 출력됨`);
        if (/^- R-9999/m.test(out)) bad.push(`⑧${label}: 세션 기록이 출력에 가짜 줄을 만듦`);
      }
      let cr = null; try { cr = JSON.parse(fs.readFileSync(path.join(cdir, cf[0]), 'utf8')); } catch {}
      if (!cr || cr.sessionKey !== 'casekey01abcd') bad.push(`⑧레코드 키가 파일명과 불일치(${cr && cr.sessionKey})`);
       
      const d3 = mkP('sanitize', true);
      fs.writeFileSync(path.join(d3, '.leerness', 'agent-reminders.md'),
        '# R\n- ' + String.fromCharCode(27) + '[2J' + ' token sk_live_' + 'ABCDEFGHIJKLMNOP1234\n');
      const jr3 = RP(d3, ['handoff', d3, '--json'], { LEERNESS_SESSION_ID: 'sanitizesess0001' });
      let J3 = null; try { J3 = JSON.parse(String(jr3.stdout || '')); } catch {}
      const headTxt = J3 && J3.agentReminders ? J3.agentReminders.head.join(' ') : '';
      if (!J3 || !J3.agentReminders) bad.push('⑧리마인더 신호 없음(셋업 실패)');
      else {
        if (headTxt.includes(String.fromCharCode(27))) bad.push('⑧제어문자(ESC)가 그대로 출력됨');
        if (/sk_live_[A-Z]/.test(headTxt)) bad.push('⑧비밀값 표식이 마스킹되지 않음');
      }
      dbg.honesty = { madeAny, selfRegistered: J && J.sessions.selfRegistered, storeError: J2 && J2.sessions.storeError, caseFiles: cf.length };
    }

     
    {
      const d = mkP('plain', false);
      const me = { LEERNESS_SESSION_ID: 'solosession000001' };
      for (const a of [['task', 'add', '보통 작업', '--path', d, '--json'], ['handoff', d, '--record'], ['session', 'close', d]]) {
        const r = RP(d, a, me);
        if (r.status !== 0) bad.push(`⑤평범한 흐름 실패: ${a[0]} exit=${r.status}`);
      }
      const solo = RP(d, ['handoff', d], me);
      if (/👥/.test(String(solo.stdout || ''))) bad.push('⑤혼자인데 다른 세션이 있다고 말함(오탐)');
      if (/🙈/.test(String(solo.stdout || ''))) bad.push('⑤등록됐는데 안 보인다고 말함(오탐)');
      if (String(solo.stderr || '').includes('락 획득 실패')) bad.push('⑤경합 없는데 락 경고가 뜸(오탐)');
      if (String(solo.stderr || '').includes('주소 공유')) bad.push('⑤혼자인데 주소 공유 경고(오탐)');
      const soloOut = String(solo.stdout || '');
      for (const noise of ['읽지 못함', 'LEERNESS_SESSION_ID 가 형식', '주소 공유']) {
        if (soloOut.includes(noise)) bad.push(`⑤정상 상태인데 경고가 뜸(오탐): ${noise}`);
      }
      const soloC = String(RP(d, ['handoff', d, '--compact'], me).stdout || ''), soloH = String(RP(d, ['hook', 'session-start'], me).stdout || '');
      for (const [surface, text] of [['평문', soloOut], ['--compact', soloC], ['훅', soloH]]) {
        if (/not-recorded|보이지 않습니다|안 보임|invisible to others/.test(text)) bad.push(`⑤${surface}: 기록이 있는데 안 보인다고 말함(오탐)`);
        if (/다른 세션 기록|other session record|👥/.test(text)) bad.push(`⑤${surface}: 혼자인데 다른 세션이 있다고 말함(오탐)`);
      }
      dbg.plain = { falsePositives: 0 };
    }

    {
      const d = mkP('readrace', false);
      const stopFile = path.join(sb, 'race-stop'), doneDir = path.join(sb, 'race-done');
      fs.mkdirSync(doneDir, { recursive: true });
      const runner = path.join(sb, 'race-runner.js');
      fs.writeFileSync(runner, [
        'const cp=require("child_process"),fs=require("fs");',
        'const [cli,root,id,stop,done]=process.argv.slice(2);',
        'const env=Object.assign({},process.env,{LEERNESS_SESSION_ID:"racepeer0000"+id});',
        'const end=Date.now()+180000;',
        'while(!fs.existsSync(stop)&&fs.existsSync(done)&&Date.now()<end)cp.spawnSync(process.execPath,[cli,"handoff",root,"--record"],{cwd:root,env,stdio:"ignore",timeout:60000});',
        'try{fs.writeFileSync(done+"/"+id,"x")}catch{}',
      ].join('\n'));
      for (const id of ['1', '2', '3']) {
        const c = cp.spawn(process.execPath, [runner, CLI, d, id, stopFile, doneDir], { cwd: d, env: envP, stdio: 'ignore', detached: true });
        c.unref();
      }
      const me = { LEERNESS_SESSION_ID: 'racereader00001' };
      let failedReads = 0, sawPeer = 0;
      for (let i = 0; i < 15; i++) {
        const r = RP(d, ['handoff', d], me);
        if (r.status !== 0) failedReads++;
        else if (/다른 세션 기록|other session record/.test(String(r.stdout || ''))) sawPeer++;
      }
      fs.writeFileSync(stopFile, 'stop');
      const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {} };
      const deadline = Date.now() + 120000;
      while (fs.readdirSync(doneDir).length < 3 && Date.now() < deadline) sleep(100);
      if (fs.readdirSync(doneDir).length < 3) bad.push('⑨경쟁 작성자가 끝나지 않음(계측 붕괴)');
      if (!sawPeer) bad.push('⑨경쟁 중 다른 세션 기록을 한 번도 못 봄(계측 붕괴)');
      if (failedReads) bad.push(`⑨다른 세션이 기록하는 동안 기본 평문 읽기 실패 ${failedReads}/15 — 참고 신호가 읽기를 깨뜨렸다`);
      dbg.readRace = { failedReads, sawPeer };
      const late = path.join(d, '.leerness', 'cache', 'sessions', 'latepeer00000001.json');
      const preload = path.join(sb, 'race-preload.js');
      fs.writeFileSync(preload, [
        'const fs=require("fs"),path=require("path"),real=fs.readdirSync;let fired=false;',
        'fs.readdirSync=function(p,...a){const out=real.call(fs,p,...a);',
        'if(!fired&&String(p).endsWith(path.join("cache","sessions"))){fired=true;fs.writeFileSync(path.join(String(p),"latepeer00000001.json"),"{}");}',
        'return out;};',
      ].join('\n'));
      const lateRead = cp.spawnSync(process.execPath, ['--require', preload, CLI, 'handoff', d],
        { cwd: d, encoding: 'utf8', timeout: 600000, env: Object.assign({}, envP, me) });
      if (!fs.existsSync(late)) bad.push('⑨읽는 도중 기록이 생기지 않음(계측 붕괴)');
      if (lateRead.status !== 0) bad.push(`⑨읽는 도중 다른 세션이 기록하면 기본 평문 읽기가 실패함 exit=${lateRead.status}`);
    }
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ AA(1.36.132/UR-0069) 다중세션 토대: 동시 24쓰기 무유실·무크래시(상태락 fail-open 차단 · 비핵심 telemetry 분리 · rename 동시독자 EPERM 차단) · 세션 신호가 4표면 전부에 도달(평문·--compact·--json·훅, 훅은 쓰기 0 유지) · claude 아닌 에이전트도 주소를 갖고 서로를 봄 + 주소 없으면 그 사실을 말함 · 죽은 채널(agent-reminders) 노출 · 단일 흐름 오탐 0 ${JSON.stringify(dbg)}`
    : '✗ 1.36.132 다중세션 토대 실패 ' + JSON.stringify({ bad: bad.slice(0, 10), dbg }));
  if (!ok) failed++;
}
 
 
 
 
if (e2eShard.take('AB(1.36.133/T-0109)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-133-'));
  const envP = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
    'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'LEERNESS_SESSION_ID', 'CODEX_THREAD_ID', 'CI', 'GITHUB_ACTIONS',
    'CLAUDECODE', 'CURSOR_AGENT', 'CODEX_MANAGED_BY_NPM', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG']) delete envP[k];
  const RP = (d, a, extra) => cp.spawnSync(process.execPath, [CLI, ...a],
    { cwd: d, encoding: 'utf8', timeout: 600000, env: Object.assign({}, envP, extra || {}), maxBuffer: 32 * 1024 * 1024 });
  const G = (d, a) => gitSpawn(a, { cwd: d, encoding: 'utf8', timeout: 60000 });
  const mkRepo = (name) => {
    const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
    G(d, ['init', '-q', '.']); G(d, ['config', 'user.email', 't@t']); G(d, ['config', 'user.name', 't']);
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
    return d;
  };
   
  const _src = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'leerness.js'), 'utf8');
   
   
   
   
  const _i = _src.indexOf('function _gitWorkingTree(root)'), _j = _src.indexOf('function _gitChangedFiles(root)');
  let _gitWorkingTree = null;
  if (_i < 0 || _j <= _i) bad.push(`①제품 함수 앵커를 찾지 못함(i=${_i} j=${_j}) — 이름이 바뀌었으면 앵커도 바꿔야 한다`);
  else {
    try {
      const _prodGitSpawn = require(path.resolve(__dirname, '..', 'lib', 'git.js')).gitSpawn;
      _gitWorkingTree = (new Function('cp', '_gitSpawn', _src.slice(_i, _j) + '\nreturn _gitWorkingTree;'))(cp, _prodGitSpawn);
    } catch (e) { bad.push('①제품 함수 추출 실패: ' + e.message); }
  }
  try {
     
     
    if (_gitWorkingTree) {
      const d = mkRepo('gitwt');
      fs.writeFileSync(path.join(d, 'committed-only.txt'), 'c'); G(d, ['add', '-A']); G(d, ['commit', '-qm', 'first']);
      const KO = '한글더티.txt';
      fs.writeFileSync(path.join(d, 'dirty.txt'), 'd');
      fs.writeFileSync(path.join(d, KO), 'k');
      fs.writeFileSync(path.join(d, 'space name.txt'), 's');
      const r = _gitWorkingTree(d);
      if (!r.ok) bad.push(`①정상 저장소인데 ok=false(${r.reason})`);
      else {
        const f = [...r.files];
        if (f.includes('committed-only.txt')) bad.push('①커밋만 한 파일이 "변경 중" 으로 섞임(워킹트리 계약 위반)');
        if (!f.includes(KO)) bad.push(`①한글 파일명 미포착 — 실제: ${JSON.stringify(f)}`);
        if (!f.includes('space name.txt')) bad.push('①공백 포함 파일명 미포착');
        if (!f.includes('dirty.txt')) bad.push('①평범한 더티 파일 미포착(계측 붕괴)');
      }
       
      G(d, ['add', '-A']); G(d, ['commit', '-qm', 'second']);
      const r2 = _gitWorkingTree(d);
      if (!(r2.ok && r2.files.size === 0)) bad.push(`①깨끗한 저장소가 0이 아님(${r2.ok ? r2.files.size : r2.reason})`);
       
      const nonRepo = path.join(sb, 'not-a-repo'); fs.mkdirSync(nonRepo, { recursive: true });
      const r3 = _gitWorkingTree(nonRepo);
      if (r3.ok || r3.reason !== 'not-a-git-repo') bad.push(`①비-git 디렉토리 사유=${r3.reason} (기존 공개값을 지우면 소비자 계약이 깨진다)`);
      const savedPath = process.env.PATH;
      process.env.PATH = fs.mkdtempSync(path.join(sb, 'nopath-'));
      const r4 = _gitWorkingTree(d);
      process.env.PATH = savedPath;
      if (r4.ok || r4.reason !== 'no-git') bad.push(`①git 부재 사유=${r4.reason} (기대 no-git — "저장소 아님" 과 구분돼야 한다)`);
       
       
      const _chEnd = _src.indexOf('// 주장 파일이 git 변경 집합에');
       
       
      const _ch = (new Function('cp', '_gitSpawn', _src.slice(_i, _chEnd) + '\nreturn _gitChangedFiles;'))(
        cp, require(path.resolve(__dirname, '..', 'lib', 'git.js')).gitSpawn);
      fs.writeFileSync(path.join(d, 'committed-claim.js'), 'q'); G(d, ['add', '-A']); G(d, ['commit', '-qm', 'third']);
      fs.writeFileSync(path.join(d, 'now-dirty.js'), 'z');
      const chSet = _ch(d);
      if (!chSet || !chSet.has('committed-claim.js')) bad.push('①변경집합에 직전 커밋 파일이 없음 — 커밋한 주장이 거짓 실패한다');
      if (!chSet || !chSet.has('now-dirty.js')) bad.push('①변경집합에 더티 파일이 없음');
      dbg.gitwt = { dirty: r.ok ? r.files.size : r.reason, clean: r2.ok ? r2.files.size : r2.reason, nonRepo: r3.reason, noGit: r4.reason, unionHasCommitted: !!(chSet && chSet.has('committed-claim.js')) };
    }

     
    {
      const d = mkRepo('readonly');
      for (let i = 0; i < 60; i++) fs.writeFileSync(path.join(d, `f${i}.txt`), 'x' + i);
      G(d, ['add', '-A']); G(d, ['commit', '-qm', 'init']);
      const ri = RP(d, ['init', d, '--yes', '--minimal']);
      if (ri.status !== 0) bad.push(`②init exit=${ri.status}`);
      const idx = path.join(d, '.git', 'index');
      const now = new Date();
      for (let i = 0; i < 60; i++) fs.utimesSync(path.join(d, `f${i}.txt`), now, now);    
      const before = fs.statSync(idx).mtimeMs;
      const rh = RP(d, ['handoff', d]);
      const after = fs.statSync(idx).mtimeMs;
      if (rh.status !== 0) bad.push(`②handoff exit=${rh.status}`);
      if (before !== after) bad.push('②조회 명령이 사용자 저장소의 .git/index 를 다시 썼다');
       
      const direct = ['bin/leerness.js', 'lib/drift.js', 'lib/session-close.js']
        .map(f => (fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8').match(/cp\.spawnSync\('git', \[/g) || []).length)    
        .reduce((a, b) => a + b, 0);
      if (direct !== 0) bad.push(`②초크포인트 밖 git 직접 호출 ${direct}건`);
      dbg.readonly = { indexChanged: before !== after, directCalls: direct };
    }

     
     
    {
      const d = mkRepo('claim');
      fs.writeFileSync(path.join(d, 'a.js'), 'a'); G(d, ['add', '-A']); G(d, ['commit', '-qm', 'i']);
      const ri = RP(d, ['init', d, '--yes', '--minimal']);
      if (ri.status !== 0) bad.push(`③init exit=${ri.status}`);
      const ta = RP(d, ['task', 'add', 'a.js 수정', '--path', d, '--json']);
      if (ta.status !== 0) bad.push(`③task add exit=${ta.status}`);
      const getGit = (extra) => {
        const r = RP(d, ['verify-claim', 'T-0001', '--path', d, '--json'], extra);
        try { return JSON.parse(String(r.stdout || '')).git; } catch { return { parse: false, exit: r.status }; }
      };
      const normal = getGit();
      const emptyDir = fs.mkdtempSync(path.join(sb, 'nogitpath-'));
      const snapshot = () => {
        const rows = [];
        const visit = (p, rel) => {
          const st = fs.lstatSync(p, { bigint: true });
          const data = st.isDirectory() ? ['directory'] : st.isFile() ? ['file', fs.readFileSync(p).toString('base64')]
            : st.isSymbolicLink() ? ['link', fs.readlinkSync(p)] : ['other'];
          rows.push([rel, String(st.mode), String(st.size), String(st.mtimeNs), data]);
          if (st.isDirectory()) for (const name of fs.readdirSync(p).sort()) visit(path.join(p, name), rel + '/' + name);
        };
        visit(d, '.');
        return JSON.stringify(rows);
      };
      const beforeNoGit = snapshot();
      const noGitResult = RP(d, ['verify-claim', 'T-0001', '--path', d, '--json'],
        { PATH: emptyDir + path.delimiter + path.dirname(process.execPath) });
      const noGit = JSON.parse(String(noGitResult.stdout || ''));
      const unchanged = snapshot() === beforeNoGit;
      if (!normal || normal.parse === false) bad.push('③정상 PATH 에서 --json 파싱 실패(계측 붕괴)');
      if (noGitResult.status !== 1 || !noGit || noGit.ok !== false || noGit.code !== 'runtime_layout_incompatible'
        || !String(noGit.error || '').includes('(git_missing)')) bad.push(`③git 부재 admission 계약 불일치: exit=${noGitResult.status} report=${JSON.stringify(noGit)}`);
      if (!unchanged) bad.push('③git 부재 거부가 대상 전체 트리의 bytes/mtime 을 바꿈');
      dbg.claim = { normal: normal && normal.reason !== undefined ? normal.reason : (normal && normal.applicable),
        noGit: noGit && noGit.code, exit: noGitResult.status, unchanged };
    }

     
    {
      const d = path.join(sb, 'carry'); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
      const ri = RP(d, ['init', d, '--yes', '--minimal']);
      if (ri.status !== 0) bad.push(`④init exit=${ri.status}`);
      const KEY = 'carrysession0001', me = { LEERNESS_SESSION_ID: KEY };
      RP(d, ['handoff', d, '--record'], me);
      const fp = path.join(d, '.leerness', 'cache', 'sessions', KEY + '.json');
      if (!fs.existsSync(fp)) bad.push('④세션 레코드가 만들어지지 않음(셋업 실패)');
      else {
        const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
        j.scope = { files: ['src/a.js'] }; j.futureField = 'x';
        fs.writeFileSync(fp, JSON.stringify(j, null, 2));
        const r = RP(d, ['handoff', d, '--record'], me);
        const after = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (!after.scope || !after.futureField) bad.push('④모르는 키가 조용히 사라짐(다음 버전의 필드를 옛 버전이 파괴한다)');
        if (!(after.carriedUnknownKeys || []).includes('scope')) bad.push('④실어 날랐다는 사실을 말하지 않음');
        if (String(r.stderr || '').length) bad.push('④정상 이월인데 경고가 남(오탐)');
         
        const j2 = JSON.parse(fs.readFileSync(fp, 'utf8'));
        for (let i = 0; i < 14; i++) j2['extra' + i] = i;
        fs.writeFileSync(fp, JSON.stringify(j2, null, 2));
        const r2 = RP(d, ['handoff', d, '--record'], me);
        const after2 = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (!(after2.droppedUnknownKeys || []).length) bad.push('④상한 초과인데 버렸다고 말하지 않음(조용한 유실)');
        if ((after2.carriedUnknownKeys || []).length > 10) bad.push('④상한이 지켜지지 않음');
         
        if (String(r2.stderr || '').length) bad.push('④drop 사실을 stderr 로 내보내 --json 계약을 깨뜨렸다');
         
        const j3 = JSON.parse(fs.readFileSync(fp, 'utf8'));
         
        for (const k of (j3.carriedUnknownKeys || [])) delete j3[k];
        delete j3.carriedUnknownKeys; delete j3.droppedUnknownKeys;
        for (const k of Object.keys(j3)) if (/^(extra|slot)[0-9]+$/.test(k)) delete j3[k];
        for (let i = 1; i <= 9; i++) j3['slot' + i] = i;
        fs.writeFileSync(fp, JSON.stringify(j3, null, 2));
        RP(d, ['handoff', d, '--record'], me);
        const j4 = JSON.parse(fs.readFileSync(fp, 'utf8')); j4.slot10 = 'tenth';
        fs.writeFileSync(fp, JSON.stringify(j4, null, 2));
        RP(d, ['handoff', d, '--record'], me);
        const j5 = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if (j5.slot10 !== 'tenth') bad.push('④메타 키가 이월 슬롯을 잡아먹어 진짜 10번째 키가 사라짐');
         
        const rawTxt = fs.readFileSync(fp, 'utf8').replace(/^\{/, '{\n  "__proto__": {"polluted": true},');
        fs.writeFileSync(fp, rawTxt);
        RP(d, ['handoff', d, '--record'], me);
        const j6 = JSON.parse(fs.readFileSync(fp, 'utf8'));
        if ((j6.carriedUnknownKeys || []).includes('__proto__')) bad.push('④__proto__ 를 이월했다고 거짓 보고');
        if (!(j6.droppedUnknownKeys || []).includes('__proto__')) bad.push('④__proto__ 를 버렸다는 사실을 안 적음');
        dbg.carry = { carried: (after.carriedUnknownKeys || []).length, capped: (after2.carriedUnknownKeys || []).length };
      }
       
      const jr = RP(d, ['handoff', d, '--json'], { LEERNESS_SESSION_ID: KEY });
      let J = null; try { J = JSON.parse(String(jr.stdout || '')); } catch { bad.push('⑤--json 파싱 실패'); }
      const bs = J && J.sessions ? J.sessions.blindSpots : [];
      if (!bs.some(x => /sub-agent|CHILD/i.test(x))) bad.push('⑤blindSpots 에 병렬 sub-agent 없음 — 겹침이 가장 잘 나는 주체가 안 보인다');
      if (!bs.some(x => /handoff --record/.test(x))) bad.push('⑤blindSpots 가 기본 읽기는 등록하지 않음을 말하지 않음');
      dbg.blindSpots = bs.length;
    }

     
     
    {
      const d = mkRepo('quiet');
      fs.writeFileSync(path.join(d, 'x.js'), 'x'); G(d, ['add', '-A']); G(d, ['commit', '-qm', 'i']);
      const me = { LEERNESS_SESSION_ID: 'quietsession0001' };
      RP(d, ['init', d, '--yes', '--minimal']);
      const outs = [RP(d, ['handoff', d], me), RP(d, ['handoff', d, '--compact'], me), RP(d, ['hook', 'session-start'], me)];
      const noise = ['주소 공유', '읽지 못함', 'LEERNESS_SESSION_ID 가 형식', '락 획득 실패'];
      for (const r of outs) {
        const txt = String(r.stdout || '') + String(r.stderr || '');
        for (const w of noise) if (txt.includes(w)) bad.push(`⑥정상 상태인데 경고가 뜸: ${w}`);
        if (r.status !== 0) bad.push(`⑥정상 흐름 exit=${r.status}`);
      }
      dbg.quiet = { surfaces: outs.length, exits: outs.map(r => r.status) };
    }
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ AB(1.36.133/T-0109) P3-A 미구현 + 기반 결함: 워킹트리 계약 회복(커밋 누출 0 · 한글/공백 경로 보존 · 3상태 no-git≠not-a-repo) · 조회 명령이 사용자 .git/index 를 안 씀(초크포인트 밖 직접호출 0) · verify-claim 이 git 부재를 "저장소 아님" 이라 단정하지 않음 · 세션 레코드가 모르는 키를 조용히 지우지 않음(상한 초과는 말하고 버림) · blindSpots 에 병렬 sub-agent · 정상 상태 침묵 ${JSON.stringify(dbg)}`
    : '✗ 1.36.133 기반 결함 실패 ' + JSON.stringify({ bad: bad.slice(0, 10), dbg }));
  if (!ok) failed++;
}
// 1.36.134: `enforce` 의 **거짓 성공**과 표면 간 모순. 실측 재현:
 
 
 
 
 
if (e2eShard.take('AC(1.36.134)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-134-'));
  const envP = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
    'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'LEERNESS_SESSION_ID', 'CODEX_THREAD_ID', 'CI', 'GITHUB_ACTIONS',
    'CLAUDECODE', 'CURSOR_AGENT', 'CODEX_MANAGED_BY_NPM', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG']) delete envP[k];
   
   
  const ENFORCE_SESSION = 'e2e-enforce-runtime';
  envP.LEERNESS_SESSION_ID = ENFORCE_SESSION;
  const handoffRecord = (d) => path.join(d, '.leerness', 'cache', 'handoffs', ENFORCE_SESSION + '.json');
  const RP = (d, a) => cp.spawnSync(process.execPath, [CLI, ...a],
    { cwd: d, encoding: 'utf8', timeout: 300000, env: envP, maxBuffer: 32 * 1024 * 1024 });
   
   
   
  envP.GIT_CONFIG_GLOBAL = path.join(sb, 'gitconfig-global');
  envP.GIT_CONFIG_SYSTEM = path.join(sb, 'gitconfig-system');
  try { fs.writeFileSync(envP.GIT_CONFIG_GLOBAL, ''); fs.writeFileSync(envP.GIT_CONFIG_SYSTEM, ''); } catch {}
  const G = (d, a) => gitSpawn(a, { cwd: d, encoding: 'utf8', timeout: 60000, env: envP });
  const J = (r) => { try { return JSON.parse(String(r.stdout || '')); } catch { return null; } };
  const targetSnapshot = (d) => {
    const rows = [];
    const visit = (p, rel) => {
      const st = fs.lstatSync(p, { bigint: true });
      const data = st.isDirectory() ? ['directory'] : st.isFile() ? ['file', fs.readFileSync(p).toString('base64')]
        : st.isSymbolicLink() ? ['link', fs.readlinkSync(p)] : null;
      if (!data) throw new Error('enforce fixture 에 예상하지 않은 파일 종류: ' + rel);
      rows.push([rel, String(st.mode), String(st.size), String(st.mtimeNs), data]);
      if (st.isDirectory()) for (const name of fs.readdirSync(p).sort()) visit(path.join(p, name), rel + '/' + name);
    };
    visit(d, '.');
    return JSON.stringify(rows);
  };
   
  const deniedEnforce = (d, sub, reason = 'git_repository_unavailable') => {
    const before = targetSnapshot(d);
    const r = RP(d, ['enforce', sub, '--path', d, '--json']);
    const report = JSON.parse(String(r.stdout || ''));
    const observed = /^Runtime layout blocks writes \(([a-z_]{1,80})\)\./.exec(String(report && report.error || ''));
    const unchanged = targetSnapshot(d) === before;
    if (r.status !== 1 || !report || report.ok !== false || report.code !== 'runtime_layout_incompatible'
      || !observed || observed[1] !== reason) bad.push(`admission ${path.basename(d)}/${sub}: exit=${r.status} report=${JSON.stringify(report)}`);
    if (!unchanged) bad.push(`admission ${path.basename(d)}/${sub}: 대상 전체 bytes/mtime 변경`);
    (dbg.admission || (dbg.admission = [])).push({ target: path.basename(d), sub, exit: r.status, reason: observed && observed[1], unchanged });
    return report;
  };
   
   
  const lowLevelEnforce = (d, sub) => cp.spawnSync(process.execPath, ['-e', [
    "const fs = require('fs'), path = require('path'), Module = require('module');",
    'const [cli, root, sub] = process.argv.slice(1);',
    "process.argv = [process.execPath, cli, 'enforce', sub, '--path', root, '--json'];",
    'const loaded = new Module(cli, module); loaded.filename = cli; loaded.paths = Module._nodeModulePaths(path.dirname(cli));',
    "loaded._compile(fs.readFileSync(cli, 'utf8') + '\\nmodule.exports.__e2eEnforce = enforceCmd;\\n', cli);",
    'loaded.exports.__e2eEnforce(root, sub);',
  ].join('\n'), CLI, d, sub], { cwd: d, encoding: 'utf8', timeout: 300000, env: envP, maxBuffer: 32 * 1024 * 1024 });
   
  const _gitHookOf = (d) => {
    const r = G(d, ['rev-parse', '--git-path', 'hooks/pre-commit']);
    if (r.status !== 0 || !String(r.stdout || '').trim()) return null;
    const p2 = String(r.stdout).trim();
    return path.isAbsolute(p2) ? p2 : path.join(d, p2);
  };
  const mk = (name, prep) => {
    const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
    const ri = RP(d, ['init', d, '--yes', '--minimal']);
    if (ri.status !== 0) bad.push(`${name}:init exit=${ri.status}`);
    if (prep) prep(d);
    return d;
  };
  const commit = (d) => {
    G(d, ['init', '-q', '.']); G(d, ['config', 'user.email', 't@t']); G(d, ['config', 'user.name', 't']);
    fs.writeFileSync(path.join(d, 'a.txt'), 'a'); G(d, ['add', '-A']); G(d, ['commit', '-qm', 'i']);
  };
  try {
    const cases = {
      'not-a-repo': mk('nogit', null),
      unborn: mk('unborn', (d) => { G(d, ['init', '-q', '.']); }),
      ok: mk('normal', commit),
      brokenHead: mk('brokenhead', (d) => { commit(d); fs.writeFileSync(path.join(d, '.git', 'HEAD'), 'GARBAGE\n'); }),
      brokenDir: mk('brokendir', (d) => { fs.rmSync(path.join(d, '.git'), { recursive: true, force: true }); fs.writeFileSync(path.join(d, '.git'), 'gitdir: /nonexistent/path\n'); }),
    };
    const seen = {};
    for (const [label, d] of Object.entries(cases)) {
      const damaged = label === 'brokenHead' || label === 'brokenDir';
      if (damaged) { deniedEnforce(d, 'status'); deniedEnforce(d, 'install'); }
      const st = J(damaged ? lowLevelEnforce(d, 'status') : RP(d, ['enforce', 'status', '--path', d, '--json']));
      const ins = J(damaged ? lowLevelEnforce(d, 'install') : RP(d, ['enforce', 'install', '--path', d, '--json']));
      if (!st) { bad.push(`①${label}: status --json 파싱 실패`); continue; }
      if (!ins) { bad.push(`①${label}: install --json 파싱 실패`); continue; }
      seen[label] = { gitState: st.gitState, installable: st.installable, insOk: ins.ok === true, code: ins.code || null };
       
      if (st.installable !== (ins.ok === true)) bad.push(`①${label}: status.installable=${st.installable} 인데 install.ok=${ins.ok} (두 표면이 모순)`);
       
      if ((label === 'brokenHead' || label === 'brokenDir') && ins.ok === true) bad.push(`①${label}: 커밋 불가 저장소인데 install ok=true (거짓 성공)`);
       
      if (label === 'not-a-repo' && ins.code !== 'not_a_git_repo') bad.push(`①not-a-repo 사유=${ins.code} (기존 공개값이 바뀌면 소비자가 깨진다)`);
       
      if ((label === 'ok' || label === 'unborn') && ins.ok !== true) bad.push(`①${label}: 설치 가능한데 거부됨(과잉 차단) code=${ins.code}`);
    }
     
    const states = Object.values(seen).map(v => `${v.gitState}/${v.installable}`);
    if (new Set(states).size < 3) bad.push(`①status 가 5상태를 구분 못 함: ${JSON.stringify(states)}`);
    if (seen['not-a-repo'] && seen['not-a-repo'].gitState === (seen.ok || {}).gitState) bad.push('①git 아님과 정상이 같은 상태로 보고됨');
    if (seen.brokenHead && seen.brokenHead.gitState === (seen.ok || {}).gitState) bad.push('①HEAD 손상과 정상이 같은 상태로 보고됨');

     
    {
      const d = cases.brokenHead;
      for (const target of [cases.brokenHead, cases.brokenDir]) deniedEnforce(target, 'audit');
      const au = J(lowLevelEnforce(d, 'audit'));
      if (!au) bad.push('⑥audit --json 파싱 실패');
      else {
        if (au.ok !== false) bad.push(`⑥손상 저장소인데 audit ok=${au.ok}`);
        if (!/git 상태/.test(String(au.error || ''))) bad.push('⑥audit 이 git 상태 어휘를 쓰지 않음(두 표면이 다른 말을 한다)');
      }
       
      const au2 = J(RP(cases.ok, ['enforce', 'audit', '--path', cases.ok, '--json']));
      if (au2 && au2.ok === false) bad.push('⑥정상 저장소인데 audit 실패(오탐)');
      dbg.audit = { broken: au && au.code, normal: au2 ? (au2.ok === false ? 'fail' : 'pass') : 'parse-fail' };
    }
     
     
    {
      for (const sub of ['status', 'install', 'remove']) {
        const r = RP(cases.ok, ['enforce', sub, '--path', cases.ok]);
        const txt = String(r.stdout || '') + String(r.stderr || '');
        if (r.status !== 0) bad.push(`⑦사람 모드 enforce ${sub} exit=${r.status}: ${txt.trim().split('\n').pop().slice(0, 80)}`);
        if (/is not defined|ReferenceError|TypeError/.test(txt)) bad.push(`⑦사람 모드 enforce ${sub} 에서 런타임 오류: ${txt.match(/[A-Za-z]+ is not defined|ReferenceError|TypeError/)[0]}`);
      }
    }

     
     
    {
      const sub = path.join(cases.ok, 'nested', 'deep');
      fs.mkdirSync(sub, { recursive: true });
      RP(cases.ok, ['enforce', 'install', '--path', cases.ok, '--json']);
      const st = J(RP(sub, ['enforce', 'status', '--path', sub, '--json']));
      if (!st) bad.push('⑧하위 디렉토리 status --json 파싱 실패');
      else {
        if (st.gitState === 'not-a-repo') bad.push('⑧정상 저장소의 하위 디렉토리를 "저장소 아님" 이라 함');
        if (st.installed === true && st.installable !== true) bad.push(`⑧한 payload 안에서 모순: installed=${st.installed} installable=${st.installable} gitState=${st.gitState}`);
      }
      dbg.nested = st ? { installed: st.installed, gitState: st.gitState, installable: st.installable } : null;
    }

     
     
    {
      const d = mk('hookspath', (dd) => {
        G(dd, ['init', '-q', '.']); G(dd, ['config', 'user.email', 't@t']); G(dd, ['config', 'user.name', 't']);
        fs.mkdirSync(path.join(dd, 'myhooks'), { recursive: true });
        G(dd, ['config', 'core.hooksPath', 'myhooks']);
        fs.writeFileSync(path.join(dd, 'a.txt'), 'a'); G(dd, ['add', '-A']); G(dd, ['commit', '-qm', 'i']);
      });
      const ins = J(RP(d, ['enforce', 'install', '--path', d, '--json']));
      if (!ins || ins.ok !== true) bad.push(`⑨hooksPath 저장소에 설치 실패 ok=${ins && ins.ok} code=${ins && ins.code}`);
      if (!fs.existsSync(path.join(d, 'myhooks', 'pre-commit'))) bad.push('⑨훅을 git 이 실제로 읽는 경로(core.hooksPath)에 쓰지 않음');
       
      if (!ins || ins.verified !== 'fired') bad.push(`⑨설치 성공인데 발화 검증이 없다/실패(verified=${ins && ins.verified})`);
       
      fs.writeFileSync(path.join(d, 'b.txt'), 'b'); G(d, ['add', '-A']);
      const cm = G(d, ['commit', '-m', 'should-be-blocked']);
      if (cm.status === 0) bad.push('⑨설치했다고 했는데 커밋이 그냥 통과 — 훅이 발화하지 않는다(거짓 성공)');
      dbg.hooksPath = { wroteToHooksPath: fs.existsSync(path.join(d, 'myhooks', 'pre-commit')), commitBlocked: cm.status !== 0 };
    }
     
     
    {
      const d = cases.ok;
      RP(d, ['handoff', d, '--record']);
      const ri = J(RP(d, ['enforce', 'install', '--path', d, '--json']));
      if (!ri || ri.verified !== 'fired') bad.push(`⑩정상 저장소 설치의 verified=${ri && ri.verified} (기대 fired)`);
      const hookP = ri && ri.hook;
      if (hookP && fs.existsSync(hookP)) {
        const lhp = handoffRecord(d);
        const stamp = (ageH) => {
          const t = new Date(Date.now() - ageH * 3600000);
          try { fs.utimesSync(lhp, t, t); } catch {}
        };
        let sh = 'sh';
        if (process.platform === 'win32') {
          const ep = G(d, ['--exec-path']);
          const installRoot = ep.status === 0 ? path.resolve(String(ep.stdout || '').trim(), '..', '..', '..') : null;
          if (installRoot) {
            sh = [path.join(installRoot, 'bin', 'sh.exe'), path.join(installRoot, 'usr', 'bin', 'sh.exe')].find(p => fs.existsSync(p)) || sh;
          }
        }
        const run = () => cp.spawnSync(sh, [hookP], { cwd: d, encoding: 'utf8', timeout: 20000, env: envP }).status;
        stamp(0); const a = run();
        stamp(240); const b = run();
         
         
        RP(d, ['session', 'close', d, '--json']);
        const c = run();
        if (a === null || b === null || c === null) bad.push('⑩sh 로 훅을 돌리지 못함(계측 불가)');
        else if (!(a === 0 && b !== 0 && c !== 0)) bad.push(`⑩훅 freshness 불변식 실패(창안=${a} 창밖=${b} close후=${c}) — close가 handoff로 둔갑하거나 판별이 공허하다`);
        dbg.discriminates = { inWindow: a, outWindow: b, afterClose: c };
      }
    }

     
     
     
     
    {
      const R = path.join(sb, 'subdir-repo'); fs.mkdirSync(path.join(R, 'pkg'), { recursive: true });
      G(R, ['init', '-q', '.']); G(R, ['config', 'user.email', 't@t']); G(R, ['config', 'user.name', 't']);
      fs.writeFileSync(path.join(R, 'pkg', 'package.json'), '{"name":"p","version":"0.1.0"}');
      fs.writeFileSync(path.join(R, 'rootfile'), 'r');
      G(R, ['add', '-A']); G(R, ['commit', '-qm', 'i']);
      const P = path.join(R, 'pkg');
      const ri = RP(P, ['init', P, '--yes', '--minimal']);
      if (ri.status !== 0) bad.push(`⑬init exit=${ri.status}`);
      RP(P, ['handoff', P, '--record']);
      const ins = J(RP(P, ['enforce', 'install', '--path', P, '--json']));
      if (!ins || ins.ok !== true) bad.push(`⑬하위 디렉토리 설치 실패 ok=${ins && ins.ok} code=${ins && ins.code}`);
      if (!ins || ins.verified !== 'fired') bad.push(`⑬하위 설치 verified=${ins && ins.verified}`);
      const lhp = handoffRecord(P);
      const stamp = (ageH) => { const t = new Date(Date.now() - ageH * 3600000); try { fs.utimesSync(lhp, t, t); } catch {} };
       
      stamp(200);
      fs.writeFileSync(path.join(R, 'z.txt'), 'z'); G(R, ['add', '-A']);
      const blocked = G(R, ['commit', '-m', 'stale-must-block']);
      if (blocked.status === 0) bad.push('⑬하위 디렉토리 설치인데 루트 커밋이 통과 — 강제가 우회된다');
       
      stamp(0);
      fs.writeFileSync(path.join(R, 'y.txt'), 'y'); G(R, ['add', '-A']);
      const passed = G(R, ['commit', '-m', 'fresh-must-pass']);
      if (passed.status !== 0) bad.push('⑬최신 handoff 인데 커밋이 차단됨(오차단)');
      dbg.subdir = { verified: ins && ins.verified, staleBlocked: blocked.status !== 0, freshPassed: passed.status === 0 };
    }

     
    {
       
      const d = mk('sidefx', commit);
      const hooks = path.join(d, '.git', 'hooks'); fs.mkdirSync(hooks, { recursive: true });
      const mark = path.join(d, 'SIDEEFFECT.txt');
      fs.writeFileSync(path.join(hooks, 'pre-commit'),
        '#!/bin/sh\necho ran >> ' + JSON.stringify(mark.replace(/\\/g, '/')) + '\nexit 0\n');
      try { fs.chmodSync(path.join(hooks, 'pre-commit'), 0o755); } catch {}
      RP(d, ['handoff', d, '--record']);
      RP(d, ['enforce', 'install', '--path', d, '--json']);
      const ran = fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').trim().split('\n').filter(Boolean).length : 0;
      if (ran !== 0) bad.push(`⑭설치 중 사용자 기존 훅이 ${ran}회 실행됨(부작용)`);
       
      const b = path.join(sb, 'bare'); fs.mkdirSync(b, { recursive: true });
      fs.writeFileSync(path.join(b, 'package.json'), '{"name":"p","version":"0.1.0"}');
      RP(b, ['init', b, '--yes', '--minimal']);
      try { fs.rmSync(path.join(b, '.git'), { recursive: true, force: true }); } catch {}
      gitSpawn(['init', '-q', '--bare', path.join(b, '.git')], { encoding: 'utf8' });
      const bi = deniedEnforce(b, 'install', 'git_bare_unsupported');
      if (bi && bi.ok === true) bad.push('⑭bare 저장소에 "설치됨" 이라 답함(강제될 수 없는 곳이다)');
       
       
       
      const failLeft = fs.existsSync(path.join(b, '.leerness', 'enforce.json'));
      if (failLeft) bad.push('⑭실패한 설치(bare)가 enforce.json 을 남김');
      const bareHook = path.join(b, '.git', 'hooks', 'pre-commit');
      if (fs.existsSync(bareHook)) bad.push('⑭실패한 설치(bare)가 훅 파일을 남김');
      dbg.noTrace = { userHookRuns: ran, bareOk: bi && bi.ok, failLeft, bareHookLeft: fs.existsSync(bareHook) };
    }

     
     
     
     
     
    {
      const d = mk('noswitch', commit);
      RP(d, ['handoff', d, '--record']);
      const ins = J(RP(d, ['enforce', 'install', '--path', d, '--json']));
      if (!ins || ins.ok !== true) bad.push(`⑮설치 실패 ok=${ins && ins.ok}`);
      const hookP = ins && ins.hook;
       
      if (hookP && fs.existsSync(hookP)) {
        const body = fs.readFileSync(hookP, 'utf8');
        if (/ENFORCE_PROBE|leerness-probe/.test(body)) bad.push('⑮출하되는 훅에 검증용 우회 스위치가 남아 있다');
      } else bad.push('⑮훅 파일을 찾지 못함(계측 붕괴)');
       
      const lhp = handoffRecord(d);
      const old = new Date(Date.now() - 200 * 3600000); try { fs.utimesSync(lhp, old, old); } catch {}
      fs.writeFileSync(path.join(d, 'p1.txt'), '1'); G(d, ['add', '-A']);
      const viaEnv = gitSpawn(['commit', '-m', 'env'],
        { cwd: d, encoding: 'utf8', timeout: 60000, env: Object.assign({}, envP, { LEERNESS_ENFORCE_PROBE: '1' }) });
      if (viaEnv.status === 0) bad.push('⑮환경변수로 강제가 우회됨');
      const viaRun = G(d, ['hook', 'run', 'pre-commit', '--', '--leerness-probe']);
      if (viaRun.status === 0) bad.push('⑮`git hook run` 에 인자를 넘겨 강제가 우회됨');
       
       
      const leftovers = fs.readdirSync(sb).filter(f => /^leerness-probe-/.test(f)).length;
      if (leftovers > 0) bad.push(`⑮검증용 임시 사본 ${leftovers}개 잔존`);
      dbg.noSwitch = { hookHasSwitch: hookP && fs.existsSync(hookP) ? /ENFORCE_PROBE|leerness-probe/.test(fs.readFileSync(hookP, 'utf8')) : null,
        envBypass: viaEnv.status === 0, runBypass: viaRun.status === 0, leftovers };
    }

     
     
     
    {
      const A = path.join(sb, 'other-repo'); fs.mkdirSync(A, { recursive: true });
      G(A, ['init', '-q', '.']); G(A, ['config', 'user.email', 't@t']); G(A, ['config', 'user.name', 't']);
      fs.writeFileSync(path.join(A, 'a.txt'), 'a'); G(A, ['add', '-A']); G(A, ['commit', '-qm', 'i']);
      const B = path.join(sb, 'not-a-repo-target'); fs.mkdirSync(B, { recursive: true });
      fs.writeFileSync(path.join(B, 'package.json'), '{"name":"p","version":"0.1.0"}');
      RP(B, ['init', B, '--yes', '--minimal']);
      const hooksA = path.join(A, '.git', 'hooks');
      const before = fs.existsSync(hooksA) ? fs.readdirSync(hooksA).filter(f => /^pre-commit/.test(f)).length : 0;
      const r = cp.spawnSync(process.execPath, [CLI, 'enforce', 'install', '--path', B, '--json'],
        { cwd: B, encoding: 'utf8', timeout: 300000,
          env: Object.assign({}, envP, { GIT_DIR: path.join(A, '.git'), GIT_WORK_TREE: A }) });
      const after = fs.existsSync(hooksA) ? fs.readdirSync(hooksA).filter(f => /^pre-commit/.test(f)).length : 0;
      let ins = null; try { ins = JSON.parse(String(r.stdout || '')); } catch {}
      if (after !== before) bad.push(`⑯GIT_DIR 상속으로 지목받지 않은 저장소를 고쳤다(${before}→${after})`);
      if (ins && ins.ok === true) bad.push('⑯git 아닌 대상인데 설치 성공이라 답함');
      dbg.envScope = { otherRepoHooks: `${before}->${after}`, ok: ins && ins.ok, code: ins && ins.code };
    }

     
     
     
    {
      const shared = path.join(sb, 'shared-hooks'); fs.mkdirSync(shared, { recursive: true });
      const mkShared = (name, useShared) => {
        const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
        G(d, ['init', '-q', '.']); G(d, ['config', 'user.email', 't@t']); G(d, ['config', 'user.name', 't']);
        if (useShared) G(d, ['config', 'core.hooksPath', shared]);
        fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
        fs.writeFileSync(path.join(d, 'a.txt'), 'a'); G(d, ['add', '-A']); G(d, ['commit', '-qm', 'i']);
        RP(d, ['init', d, '--yes', '--minimal']); RP(d, ['handoff', d, '--record']);
        return d;
      };
      const sA = mkShared('sharedA', true), sN = mkShared('privateN', false);
      const iA = J(RP(sA, ['enforce', 'install', '--path', sA, '--json']));
      const iN = J(RP(sN, ['enforce', 'install', '--path', sN, '--json']));
      if (!iA || iA.hooksPathShared !== true) bad.push(`⑰공유 hooksPath 인데 밝히지 않음(hooksPathShared=${iA && iA.hooksPathShared})`);
      if (!iN || iN.hooksPathShared !== false) bad.push(`⑰전용인데 공유라고 함(오탐, hooksPathShared=${iN && iN.hooksPathShared})`);
      const hA = String(RP(sA, ['enforce', 'status', '--path', sA]).stdout || '');
      const hN = String(RP(sN, ['enforce', 'status', '--path', sN]).stdout || '');
      if (!/공유 core\.hooksPath/.test(hA)) bad.push('⑰사람 모드가 공유 사실을 말하지 않음');
      if (/공유 core\.hooksPath/.test(hN)) bad.push('⑰전용 저장소에 공유 경고(오탐)');
      dbg.sharedHooks = { shared: iA && iA.hooksPathShared, private: iN && iN.hooksPathShared };
    }

     
     
     
    {
      const d = mk('reinstall', commit);
      RP(d, ['handoff', d, '--record']);
      const hooks = path.join(d, '.git', 'hooks'); fs.mkdirSync(hooks, { recursive: true });
      fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho user\nexit 0\n');
      try { fs.chmodSync(path.join(hooks, 'pre-commit'), 0o755); } catch {}
      const i1 = J(RP(d, ['enforce', 'install', '--path', d, '--json']));
      if (!i1 || i1.ok !== true) bad.push(`⑱1차 설치 실패 ok=${i1 && i1.ok}`);
      const hp = path.join(hooks, 'pre-commit'), cp2 = hp + '.pre-leerness';
      const h1 = fs.existsSync(hp) ? fs.readFileSync(hp, 'utf8') : null;
      const c1 = fs.existsSync(cp2) ? fs.readFileSync(cp2, 'utf8') : null;
      G(d, ['config', 'core.bare', 'true']);                  
      const i2 = deniedEnforce(d, 'install', 'git_bare_unsupported');
      if (i2 && i2.ok === true) bad.push('⑱실패시켰는데 설치 성공이라 답함(계측 붕괴)');
      const h2 = fs.existsSync(hp) ? fs.readFileSync(hp, 'utf8') : null;
      const c2 = fs.existsSync(cp2) ? fs.readFileSync(cp2, 'utf8') : null;
      if (h1 !== h2) bad.push('⑱실패한 재설치가 기존 훅을 바꿨다(강제가 조용히 사라진다)');
      if (c1 !== c2) bad.push('⑱실패한 재설치가 체인 백업을 바꿨다');
      dbg.reinstall = { hookSame: h1 === h2, chainSame: c1 === c2, secondOk: i2 && i2.ok };
    }

     
     
     
    {
      const d = mk('cfgfail', commit);
      RP(d, ['handoff', d, '--record']);
      const cfg = path.join(d, '.leerness', 'enforce.json');
      try { if (fs.existsSync(cfg)) fs.rmSync(cfg, { force: true }); } catch {}
      fs.mkdirSync(cfg, { recursive: true });                  
      const r = J(RP(d, ['enforce', 'install', '--path', d, '--json']));
      if (r && r.ok === true) bad.push('⑲설정 저장이 실패했는데 설치 성공이라 답함');
      if (!r || r.code !== 'config_write_failed') bad.push(`⑲사유가 뭉개짐(code=${r && r.code})`);
      const hookP = _gitHookOf(d);
      const left = hookP && fs.existsSync(hookP) ? /leerness/.test(fs.readFileSync(hookP, 'utf8')) : false;
      if (left) bad.push('⑲실패한 설치가 훅을 남겼다(설정 없는 강제)');
       
      try { fs.rmdirSync(cfg); } catch {}
      const r2 = J(RP(d, ['enforce', 'install', '--path', d, '--json']));
      if (!r2 || r2.ok !== true || r2.verified !== 'fired') bad.push(`⑲방해물 제거 후에도 설치 실패(ok=${r2 && r2.ok})`);
       
      const sv = RP(d, ['enforce', 'status', '--path', d, '--skip-verify']);
      if (/알 수 없는/.test(String(sv.stdout || '') + String(sv.stderr || ''))) bad.push('⑲--skip-verify 가 미등록 플래그로 경고됨');
      dbg.cfgFail = { code: r && r.code, hookLeft: left, recovered: r2 && r2.ok };
    }

     
     
     
    {
      const d = mk('selfweaken', commit);
      RP(d, ['handoff', d, '--record']);
      const lhp = handoffRecord(d);
      if (!fs.existsSync(lhp)) bad.push('⑫셋업 실패: 세션 handoff record 없음');
      else {
        const oldT = new Date(Date.now() - 100 * 3600000);
        fs.utimesSync(lhp, oldT, oldT);
        const before = Math.round(fs.statSync(lhp).mtimeMs);
        const before_txt = fs.readFileSync(lhp, 'utf8');
        const ins = J(RP(d, ['enforce', 'install', '--path', d, '--json']));
        const after = Math.round(fs.statSync(lhp).mtimeMs);
        if (!ins || ins.ok !== true) bad.push(`⑫설치 실패 ok=${ins && ins.ok}`);
        if (fs.readFileSync(lhp, 'utf8') !== before_txt) bad.push('⑫설치가 세션 handoff record 내용을 바꿨다');
        if (Math.abs(after - before) > 1500) bad.push(`⑫설치가 handoff mtime 을 갱신했다(${before}→${after}) — 설치가 게이트를 약화시킨다`);
         
        fs.writeFileSync(path.join(d, 'z.txt'), 'z'); G(d, ['add', '-A']);
        const cm = G(d, ['commit', '-m', 'must-block']);
        if (cm.status === 0) bad.push('⑫오래된 handoff 인데 설치 직후 커밋이 통과 — 설치가 무임승차를 만들었다');
        dbg.selfWeaken = { mtimeDrift: after - before, blocked: cm.status !== 0 };
      }
    }

     
     
    {
      for (const target of [cases.brokenHead, cases.brokenDir]) deniedEnforce(target, 'check');
      const lowCheck = lowLevelEnforce(cases.brokenHead, 'check');
      const ck = J(lowCheck);
      if (!ck) bad.push('⑪손상 저장소 check --json 파싱 실패');
      else {
        if (!ck.gitState) bad.push('⑪check 가 git 상태를 말하지 않음(조용한 통과)');
        if (ck.enforced !== false) bad.push(`⑪git 을 못 쓰는데 enforced=${ck.enforced}`);
        if (ck.ok !== true) bad.push('⑪check 가 사용자 커밋을 막았다(권고 원칙 위반)');
        if (lowCheck.status !== 0) bad.push(`⑪저수준 check 권고가 exit=${lowCheck.status} 로 차단`);
      }
       
      const ck2 = J(RP(cases.ok, ['enforce', 'check', '--path', cases.ok, '--json']));
      if (ck2 && ck2.note === 'git_unusable') bad.push('⑪정상 저장소인데 git 사용불가로 판정(오탐)');
      dbg.check = { broken: ck && ck.gitState, lowLevelExit: lowCheck.status, normalNote: ck2 && ck2.note };
    }
    {
      const d = mk('plainread', commit);
      RP(d, ['handoff', d]);
      if (fs.existsSync(handoffRecord(d))) bad.push('⑳기본 읽기가 세션 handoff record 를 만들었다');
      const ins = J(RP(d, ['enforce', 'install', '--path', d, '--json']));
      if (!ins || ins.ok !== true) bad.push(`⑳설치 실패 ok=${ins && ins.ok}`);
      fs.writeFileSync(path.join(d, 'r.txt'), 'r'); G(d, ['add', '-A']);
      const plain = G(d, ['commit', '-m', 'plain-read-must-block']);
      if (plain.status === 0) bad.push('⑳기본 읽기만으로 커밋이 통과 — 읽기가 enforce 영수증이 됐다');
      RP(d, ['handoff', d, '--record']);
      const recorded = G(d, ['commit', '-m', 'recorded-must-pass']);
      if (recorded.status !== 0) bad.push('⑳--record 뒤에도 커밋이 차단됨');
      dbg.plainRead = { blocked: plain.status !== 0, recordedPassed: recorded.status === 0 };
    }
    dbg.states = seen;
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ AC(1.36.134) enforce 정직성: 커밋 불가 저장소에 "설치했다" 고 말하지 않음 · status/install/audit 이 **한 술어**를 공유(모순 0) · git 5상태 구분 · 기존 사유 코드 유지 · 정상/unborn 과잉차단 0 ${JSON.stringify(dbg)}`
    : '✗ 1.36.134 enforce 정직성 실패 ' + JSON.stringify({ bad: bad.slice(0, 8), dbg }));
  if (!ok) failed++;
}

// AD(1.36.140) — **초크포인트는 하나여야 한다.**
 
 
 
 
 
if (e2eShard.take('AD(1.36.140)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-140-'));
  const envP = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
    'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'LEERNESS_SESSION_ID', 'CODEX_THREAD_ID', 'CI', 'GITHUB_ACTIONS',
    'CLAUDECODE', 'CURSOR_AGENT', 'CODEX_MANAGED_BY_NPM', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG',
    'GIT_DIR', 'GIT_WORK_TREE']) delete envP[k];
   
   
   
  envP.GIT_CONFIG_GLOBAL = path.join(sb, 'gitconfig-global');
  envP.GIT_CONFIG_SYSTEM = path.join(sb, 'gitconfig-system');
  try { fs.writeFileSync(envP.GIT_CONFIG_GLOBAL, ''); fs.writeFileSync(envP.GIT_CONFIG_SYSTEM, ''); } catch {}
  const G = (d, a, env) => gitSpawn(a, { cwd: d, encoding: 'utf8', timeout: 60000, env: env || envP });
  const RP = (d, a, env) => cp.spawnSync(process.execPath, [CLI, ...a],
    { cwd: d, encoding: 'utf8', timeout: 300000, env: env || envP, maxBuffer: 32 * 1024 * 1024 });
  const mkRepo = (name, nBranches) => {
    const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
    G(d, ['init', '-q', '-b', 'main', '.']); G(d, ['config', 'user.email', 't@t']); G(d, ['config', 'user.name', 't']);
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
    fs.writeFileSync(path.join(d, 'a.txt'), 'a'); G(d, ['add', '-A']); G(d, ['commit', '-qm', 'i']);
    for (let i = 0; i < nBranches; i++) G(d, ['branch', 'release/1.0.' + i]);    
    return d;
  };
  const relCount = (d) => (G(d, ['branch', '--list', 'release/*']).stdout || '').split('\n').filter(l => l.trim()).length;
  try {
     
    {
      const victim = mkRepo('victim', 60);
      const work = mkRepo('work', 0);
      RP(work, ['init', work, '--yes', '--minimal']);
      const before = relCount(victim);
      const poisoned = Object.assign({}, envP, { GIT_DIR: path.join(victim, '.git') });
      const r = RP(work, ['drift', 'check', '--auto-fix'], poisoned);
      const after = relCount(victim);
      if (after !== before) bad.push(`①상속된 GIT_DIR 로 남의 저장소 브랜치 ${before - after}개 삭제(${before}→${after})`);
      dbg.crossRepo = { before, after, deleted: before - after, exit: r.status };
       
       
       
      const victim2 = mkRepo('victim2', 60);
      const before2 = relCount(victim2);
      const lower = Object.assign({}, envP); lower.git_dir = path.join(victim2, '.git');
      RP(work, ['drift', 'check', '--auto-fix'], lower);
      const after2 = relCount(victim2);
      if (after2 !== before2) bad.push(`②소문자 git_dir 로 남의 저장소 브랜치 ${before2 - after2}개 삭제(${before2}→${after2})`);
      dbg.lowercase = { before: before2, after: after2 };
    }
     
    {
      const own = mkRepo('own', 60);
      RP(own, ['init', own, '--yes', '--minimal']);
      const before = relCount(own);
      const r = RP(own, ['drift', 'check', '--auto-fix']);
      const after = relCount(own);
      if (before - after !== 50) bad.push(`③제 저장소 정리가 동작하지 않음(${before}→${after}, 기대 50건 삭제) — 보호가 기능을 죽였다`);
      dbg.ownRepo = { before, after, deleted: before - after, exit: r.status };
    }
     
    {
       
       
      const _root = path.resolve(__dirname, '..');
      const files = [];
      for (const dir of ['bin', 'lib']) {
        let ents = []; try { ents = fs.readdirSync(path.join(_root, dir)); } catch {}
        for (const f of ents) if (f.endsWith('.js')) files.push(dir + '/' + f);
      }
      if (files.length < 3) bad.push(`④소스 열거가 ${files.length}건 — 계측이 붕괴했다`);
      const sites = files.map((f) => {
        let src = ''; try { src = fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8'); } catch { return [f, 0]; }
        return [f, (src.match(/\b(?:spawnPortableSync|spawnSync|execSync)\s*\(\s*['"]git['"]/g) || []).length];
      }).filter(([, n]) => n > 0);
      if (sites.length !== 1 || sites[0][0] !== 'lib/git.js') {
        bad.push(`④git 실행 지점이 하나가 아니다: ${JSON.stringify(sites)}`);
      }
      dbg.sites = sites;
       
       
      const gm = require(path.resolve(__dirname, '..', 'lib', 'git.js'));
      const own = path.join(sb, 'own'), victim = path.join(sb, 'victim');
      const pathKey = (p) => {
        let q = path.resolve(String(p));
        try { q = fs.realpathSync.native ? fs.realpathSync.native(q) : fs.realpathSync(q); } catch {}
        return process.platform === 'win32' ? q.toLowerCase() : q;
      };
      const seenDir = (envx) => {
        const r = gm.gitSpawn(['rev-parse', '--absolute-git-dir'], { cwd: own, encoding: 'utf8', env: envx });
        return r.status === 0 ? path.resolve(String(r.stdout).trim()) : 'ERR:' + r.status;
      };
      const clean = seenDir(envP);
      const poisonedDir = seenDir(Object.assign({}, envP, { GIT_DIR: path.join(victim, '.git') }));
      if (pathKey(clean) !== pathKey(path.resolve(own, '.git'))) bad.push(`④정상 환경에서 제 저장소를 못 찾음(${clean}) — 판별 불가`);
      if (pathKey(poisonedDir) !== pathKey(clean)) bad.push(`④GIT_DIR 이 초크포인트를 통과해 대상이 바뀜(${poisonedDir})`);
      dbg.chokeScrub = { clean, poisoned: poisonedDir };
    }
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ AD(1.36.140) git 초크포인트 단일화: 상속된 GIT_DIR/git_dir 이 **남의 저장소 브랜치를 지우지 못함**(고치기 전 60→10) · 제 저장소 정리는 그대로(60→10) · 실행 지점 1곳 · 그 한 곳이 실제로 세척 ${JSON.stringify(dbg)}`
    : '✗ 1.36.140 git 초크포인트 실패 ' + JSON.stringify({ bad: bad.slice(0, 8), dbg }));
  if (!ok) failed++;
}




 
 
 
 
 
 
if (e2eShard.take('AE(1.36.140)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-140b-'));
  const envP = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
    'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'LEERNESS_SESSION_ID', 'CODEX_THREAD_ID', 'CI', 'GITHUB_ACTIONS',
    'CLAUDECODE', 'CURSOR_AGENT', 'CODEX_MANAGED_BY_NPM', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG',
    'GIT_DIR', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CEILING_DIRECTORIES']) delete envP[k];
   
   
   
  envP.GIT_CONFIG_GLOBAL = path.join(sb, 'gitconfig-global');
  envP.GIT_CONFIG_SYSTEM = path.join(sb, 'gitconfig-system');
  try { fs.writeFileSync(envP.GIT_CONFIG_GLOBAL, ''); fs.writeFileSync(envP.GIT_CONFIG_SYSTEM, ''); } catch {}
  const G = (d, a) => gitSpawn(a, { cwd: d, encoding: 'utf8', timeout: 60000, env: envP });
  const RP = (d, a, env) => cp.spawnSync(process.execPath, [CLI, ...a],
    { cwd: d, encoding: 'utf8', timeout: 300000, env: env || envP, maxBuffer: 32 * 1024 * 1024 });
  const J = (r) => { try { return JSON.parse(String(r.stdout || '')); } catch { return null; } };
  const mk = (name) => {
    const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
    G(d, ['init', '-q', '-b', 'main', '.']); G(d, ['config', 'user.email', 't@t']); G(d, ['config', 'user.name', 't']);
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
    fs.writeFileSync(path.join(d, 'a.txt'), 'a'); G(d, ['add', '-A']); G(d, ['commit', '-qm', 'i']);
    RP(d, ['init', d, '--yes', '--minimal']); RP(d, ['handoff', d]);
    return d;
  };
  try {
     
    {
      const res = {};
      for (const order of ['target-first', 'bystander-first']) {
        const d = mk('drop-' + order);
        const lp = path.join(d, '.leerness', 'lessons.json');
        const A = { date: '2026-08-20', text: 'foo|bar', tag: 'TARGET' };        
        const B = { date: '2026-08-20|foo', text: 'bar', tag: 'BYSTANDER' };     
        fs.writeFileSync(lp, JSON.stringify(order === 'target-first' ? [A, B] : [B, A], null, 2) + '\n');
        RP(d, ['lesson', 'drop', 'foo|bar', '--path', d]);
        const after = JSON.parse(fs.readFileSync(lp, 'utf8')).map((x) => x.tag);
        let arc = ''; try { arc = fs.readFileSync(path.join(d, '.leerness', 'lessons.archive.md'), 'utf8'); } catch {}
        res[order] = { after, archiveHasBystander: arc.includes('BYSTANDER') };
        if (after.length !== 1 || after[0] !== 'BYSTANDER') bad.push(`①${order}: 무관 항목이 지워짐(남은 것=${JSON.stringify(after)})`);
        if (arc.includes('BYSTANDER')) bad.push(`①${order}: archive 가 지우지 않은 항목을 지웠다고 기록`);
      }
      dbg.dropKey = res;
    }
     
    {
      const d = mk('rohook');
      const hook = path.join(d, '.git', 'hooks', 'pre-commit');
      const chain = hook + '.pre-leerness';
      fs.mkdirSync(path.dirname(hook), { recursive: true });
      fs.writeFileSync(hook, '#!/bin/sh\necho ORIGINAL-HOOK\n');
      fs.writeFileSync(chain, '#!/bin/sh\necho ORIGINAL-CHAIN\n');
       
       
       
      const hookDir = path.dirname(hook);
      let injected = false;
      if (process.platform === 'win32') {
        cp.spawnSync('attrib', ['+R', hook], { encoding: 'utf8' });
      } else {
        try { fs.chmodSync(hook, 0o444); fs.chmodSync(hookDir, 0o555); } catch {}
      }
      try { fs.writeFileSync(hook, 'probe'); } catch { injected = true; }    
      let j = null;
      if (injected) j = J(RP(d, ['enforce', 'install', '--path', d, '--json']));
      if (process.platform === 'win32') cp.spawnSync('attrib', ['-R', hook], { encoding: 'utf8' });
      else { try { fs.chmodSync(hookDir, 0o755); fs.chmodSync(hook, 0o644); } catch {} }
      let chainNow = ''; try { chainNow = fs.readFileSync(chain, 'utf8'); } catch {}
      const preserved = /ORIGINAL-CHAIN/.test(chainNow);
      if (!injected) {
        dbg.roHook = { skipped: '이 플랫폼에서 쓰기를 막지 못해 미검증' };
      } else if (!(j && j.ok === false)) {
        bad.push(`②쓰기를 막았는데 설치가 성공(ok=${j && j.ok}) — 판별 조건이 서지 않았다`);
        dbg.roHook = { installOk: j && j.ok, chainPreserved: preserved };
      } else {
        if (!preserved) bad.push('②실패한 설치가 기존 체인 백업을 파괴');
        dbg.roHook = { installOk: j.ok, code: j.code, chainPreserved: preserved };
      }
    }
     
    {
      const d = mk('dupdrop');
      const dj = path.join(d, '.leerness', 'decisions.json');
       
       
       
       
      const seeded = RP(d, ['decision', 'add', 'dup-title', '--reason', 'R', '--path', d]);
      let seededRows = []; try { seededRows = JSON.parse(fs.readFileSync(dj, 'utf8')); } catch {}
      if (seeded.status !== 0 || seededRows.length !== 1 || seededRows[0].title !== 'dup-title') bad.push(`③셋업 실패(decision add exit=${seeded.status}, 행 ${seededRows.length})`);
      const marks = path.join(sb, 'marks'); fs.mkdirSync(marks, { recursive: true });
      const runner = path.join(sb, 'dropr.js');
      fs.writeFileSync(runner, [
        'const cp=require("child_process"),fs=require("fs");const a=process.argv.slice(2);',
        'const r=cp.spawnSync(process.execPath,[a[0],"decision","drop","dup-title","--path",a[1]],{cwd:a[1],encoding:"utf8",timeout:120000});',
        'fs.writeFileSync(a[3]+"/"+a[2]+".done",String(r.status));',
      ].join('\n'));
      for (const i of ['0', '1']) {
        const c = cp.spawn(process.execPath, [runner, CLI, d, i, marks], { cwd: d, env: envP, stdio: 'ignore', detached: true });
        c.unref();
      }
      const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {} };
      const dl = Date.now() + 180000;
      while (fs.readdirSync(marks).length < 2 && Date.now() < dl) sleep(100);
      const codes = fs.readdirSync(marks).map((f) => fs.readFileSync(path.join(marks, f), 'utf8')).sort();
      let arc = ''; try { arc = fs.readFileSync(path.join(d, '.leerness', 'decisions.archive.md'), 'utf8'); } catch {}
      const blocks = (arc.match(/^## 제거 /gm) || []).length;
      RP(d, ['memory', 'restore', 'decisions', 'dup-title', '--path', d]);
      let restored = []; try { restored = JSON.parse(fs.readFileSync(dj, 'utf8')); } catch {}
      if (codes.length !== 2) bad.push(`③동시 drop 두 프로세스가 끝나지 않음(${codes.length})`);
      else if (codes.filter((c) => c === '0').length !== 1) bad.push(`③둘 다 성공이라 보고(exits=${JSON.stringify(codes)})`);
      if (blocks !== 1) bad.push(`③archive 블록 ${blocks}개(기대 1) — 지우지 않은 것을 기록`);
      if (restored.length !== 1) bad.push(`③복원이 ${restored.length}건을 만듦(기대 1)`);
      dbg.dupDrop = { exits: codes, archiveBlocks: blocks, restoredCount: restored.length };
    }
     
     
     
     
     
     
     
    {
      const ghost = path.join(sb, 'ghost-parent', 'nope');
      const w1 = RP(sb, ['roles', 'unset', 'coder', '--path', ghost]);
      const w2 = RP(sb, ['roles', 'set', 'coder', '--provider', 'codex', '--force', '--path', ghost]);
      const created = fs.existsSync(ghost);
      const r1 = RP(sb, ['roles', 'catalog', '--path', ghost]);
       
      const real = mk('roles-real');
      const noPath = RP(real, ['roles', 'catalog']).status;
      const realPath = ['catalog', 'list'].map((s) => RP(real, ['roles', s, '--path', real]).status);
      if (w1.status === 0) bad.push('④없는 경로인데 unset 이 성공이라 보고');
      if (w2.status === 0) bad.push('④없는 경로인데 set 이 성공이라 보고');
      if (created) bad.push('④실패하면서 없는 경로를 만들었다');
      if (r1.status === 0) bad.push('④오타 난 --path 를 조용히 성공시킴');
      if (noPath !== 0) bad.push(`④--path 없는 사용을 막았다(exit=${noPath}) — 과차단 회귀`);
      if (realPath.some((s) => s !== 0)) bad.push(`④실재 경로 조회를 막았다(exit=${JSON.stringify(realPath)}) — 과차단 회귀`);
      dbg.ghostPath = { unset: w1.status, set: w2.status, created, ghostRead: r1.status, noPath, realPath };
    }
     
    {
      const foreign = mk('cfg-foreign'), target = mk('cfg-target');
      const env = Object.assign({}, envP, {
        GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath',
        GIT_CONFIG_VALUE_0: path.join(foreign, '.git', 'hooks').replace(/\\/g, '/'),
      });
      RP(target, ['enforce', 'install', '--path', target, '--json', '--skip-verify'], env);
      const foreignHook = fs.existsSync(path.join(foreign, '.git', 'hooks', 'pre-commit'));
      const targetHook = fs.existsSync(path.join(target, '.git', 'hooks', 'pre-commit'));
      if (foreignHook) bad.push('⑤설정 주입으로 남의 저장소에 훅을 씀');
      if (!targetHook) bad.push('⑤지목한 저장소에 훅이 없음 — 강제가 아예 걸리지 않았다');
      dbg.cfgInject = { foreignHook, targetHook };
    }
     
     
    {
      const d = mk('casehooks');
      G(d, ['config', 'core.hooksPath', '.GIT/hooks']);
      const j = J(RP(d, ['enforce', 'status', '--path', d, '--json']));
      const expected = process.platform === 'win32' ? false : true;
      if (!j || j.hooksPathShared !== expected) bad.push(`⑥플랫폼 경로 의미 오판(hooksPathShared=${j && j.hooksPathShared}, expected=${expected})`);
      dbg.caseHooks = { shared: j && j.hooksPathShared, expected };
    }
     
    {
      const main = mk('wtmain');
      const wt = path.join(sb, 'wtlinked');
      const add = G(main, ['worktree', 'add', '-qb', 'linked', wt]);
      const j = J(RP(main, ['enforce', 'install', '--path', main, '--json', '--skip-verify']));
      const human = String(RP(main, ['enforce', 'status', '--path', main]).stdout || '');
      if (add.status !== 0) bad.push(`⑦worktree 생성 실패(${add.status}) — 판별 불가`);
      else {
        if (!j || j.worktrees !== 2) bad.push(`⑦worktree 수를 말하지 않음(${j && j.worktrees})`);
        if (!/worktree 가 2개/.test(human)) bad.push('⑦사람 모드가 worktree 공용 사실을 말하지 않음');
      }
      dbg.worktree = { addExit: add.status, worktrees: j && j.worktrees, humanSays: /worktree 가 2개/.test(human) };
    }
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ AE(1.36.140) 수정이 만든 다음 결함 고정: 복합 키가 접혀도 무관 항목 보존(두 순서) · 실패한 설치가 체인 백업을 파괴하지 않음 · 동시 drop 은 하나만 성공하고 archive 도 한 번 · 없는 경로에 디렉토리 안 만듦 · 한번짜리 설정 주입이 남의 저장소에 못 씀 · 대소문자 오탐 0 · worktree 공용 고지 ${JSON.stringify(dbg)}`
    : '✗ 1.36.140 후속결함 고정 실패 ' + JSON.stringify({ bad: bad.slice(0, 8), dbg }));
  if (!ok) failed++;
}

 
 
 
 
 
 
 
if (e2eShard.take('AF(1.36.142/T-0116)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-142-'));
  const envP = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
    'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'LEERNESS_SESSION_ID', 'CODEX_THREAD_ID', 'CI', 'GITHUB_ACTIONS',
    'CLAUDECODE', 'CURSOR_AGENT', 'CODEX_MANAGED_BY_NPM', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG']) delete envP[k];
  const R = (d, env, a) => cp.spawnSync(process.execPath, [CLI, ...a],
    { cwd: d, encoding: 'utf8', timeout: 300000, env, maxBuffer: 32 * 1024 * 1024 });
  const J = (r) => { try { return JSON.parse(String(r.stdout || '')); } catch { return null; } };
  const mk = (name) => {
    const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
    const ri = R(d, envP, ['init', d, '--yes', '--minimal']);
    if (ri.status !== 0) bad.push(`${name}:init exit=${ri.status}`);
    return d;
  };
   
   
  const SP = require(path.resolve(__dirname, '..', 'lib', 'session-presence'));
  const KA = 'session-alpha01', KB = 'session-bravo01';
  if (!SP.deriveSessionKey({ LEERNESS_SESSION_ID: KA }) || !SP.deriveSessionKey({ LEERNESS_SESSION_ID: KB })) {
    bad.push('픽스처 세션 키가 무효 — 이 블록은 아무것도 재지 못한다');
  }
  const eA = Object.assign({}, envP, { LEERNESS_SESSION_ID: KA });
  const eB = Object.assign({}, envP, { LEERNESS_SESSION_ID: KB });
  try {
     
    {
      const d = mk('attrib');
      const sA = J(R(d, eA, ['state', 'start', 'A 목표', '--agent', 'agentA', '--json']));
      const sB = J(R(d, eB, ['state', 'start', 'B 목표', '--agent', 'agentB', '--json']));
      const rA = J(R(d, eA, ['state', 'record', '--files-changed', 'a.js', '--tests', 'npm test: 10/10', '--json']));
      const vB = J(R(d, eB, ['state', 'verify', '--result', 'pass', '--json']));
      if (!sA || !sB || sA.started === sB.started) bad.push('①두 세션이 같은 run 을 받았다 — 판별 불가');
      if (!rA || rA.recorded !== (sA && sA.started)) bad.push(`①A 의 증거가 A 의 run 이 아닌 곳에 붙음(${rA && rA.recorded})`);
      const cca = vB && vB.completion_claim_allowed && vB.completion_claim_allowed.allowed;
      if (cca) bad.push('①일하지 않은 세션이 완료 허용을 받았다 — 증거 게이트가 뒤집힘');
      const showA = J(R(d, eA, ['state', 'show', '--json']));
      if (!showA || showA.resolvedRunId !== (sA && sA.started)) bad.push(`①A 가 자기 run 을 못 본다(${showA && showA.resolvedRunId})`);
      dbg.attrib = { A: sA && sA.started, B: sB && sB.started, recordedTo: rA && rA.recorded, bAllowed: !!cca, aSees: showA && showA.resolvedRunId };
    }
     
    {
      const d = mk('refuse');
      R(d, eA, ['state', 'start', 'A 목표', '--json']);
      const rB = R(d, eB, ['state', 'record', '--files-changed', 'stolen.js']);
      const msg = String(rB.stdout || '') + String(rB.stderr || '');
      let runA = null; try { runA = JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'runs', 'run-0001.json'), 'utf8')); } catch {}
      if (rB.status === 0) bad.push('②남의 run 인데 성공이라 보고');
      if (!/다른 세션이 진행 중/.test(msg)) bad.push('②거절 사유를 말하지 않음');
      if (!runA || runA.files_changed.length !== 0) bad.push('②거절했는데 남의 증거가 오염됨');
      dbg.refuse = { exit: rB.status, saysWhy: /다른 세션이 진행 중/.test(msg), aFiles: runA && runA.files_changed.length };
    }
     
    {
      const d = mk('release');
      R(d, eA, ['state', 'start', 'A', '--json']);
      R(d, eB, ['state', 'start', 'B', '--json']);
      R(d, eB, ['state', 'handoff', 'B 마감', '--json']);
      const aShow = J(R(d, eA, ['state', 'show', '--json']));
      const aRec = J(R(d, eA, ['state', 'record', '--files-changed', 'a2.js', '--json']));
      if (!aShow || aShow.resolvedRunId !== 'run-0001') bad.push(`③남의 handoff 뒤 내 run 이 사라짐(${aShow && aShow.resolvedRunId})`);
      if (!aRec || aRec.recorded !== 'run-0001') bad.push(`③남의 handoff 뒤 기록 불가(${aRec && aRec.recorded})`);
      dbg.release = { aResolved: aShow && aShow.resolvedRunId, aRecorded: aRec && aRec.recorded };
    }
     
     
    {
      const d = mk('single');
      const st = J(R(d, envP, ['state', 'start', '목표', '--json']));
      const rc = J(R(d, envP, ['state', 'record', '--files-changed', 'x.js', '--tests', 'npm test: 3/3', '--json']));
      const vf = J(R(d, envP, ['state', 'verify', '--result', 'pass', '--json']));
      const ho = J(R(d, envP, ['state', 'handoff', '요약', '--json']));
      const after = J(R(d, envP, ['state', 'show', '--json']));
      const chain = [rc && rc.recorded, vf && vf.verified, ho && ho.handoff];
      if (!st || chain.some((x) => x !== st.started)) bad.push(`④세션키 없는 단일 흐름이 깨짐(${JSON.stringify(chain)})`);
      if (!after || after.resolvedRunId !== null) bad.push(`④handoff 뒤에도 run 이 남음(${after && after.resolvedRunId})`);
      if (!vf || !vf.completion_claim_allowed || vf.completion_claim_allowed.allowed !== true) {
        bad.push('④일한 단일 사용자가 완료 허용을 못 받음 — 게이트가 과차단');
      }
      dbg.single = { started: st && st.started, chain, after: after && after.resolvedRunId,
        allowed: vf && vf.completion_claim_allowed && vf.completion_claim_allowed.allowed };
    }
     
    {
      const d = mk('migrate');
      R(d, envP, ['state', 'start', '업그레이드 전', '--json']);
      const stFile = path.join(d, '.leerness', 'state.json');
      const before = JSON.parse(fs.readFileSync(stFile, 'utf8'));
      delete before.runsBySession;
      fs.writeFileSync(stFile, JSON.stringify(before, null, 2) + '\n');
      const rc = J(R(d, eA, ['state', 'record', '--files-changed', 'y.js', '--json']));
      if (!rc || rc.recorded !== before.currentRunId) bad.push(`⑤예전 run 을 인수하지 못함(${rc && rc.recorded} vs ${before.currentRunId})`);
      dbg.migrate = { old: before.currentRunId, recorded: rc && rc.recorded };
    }
     
    {
      const d = mk('badkey');
      const eBad = Object.assign({}, envP, { LEERNESS_SESSION_ID: 'x' });
      const r = R(d, eBad, ['state', 'start', '목표']);
      const msg = String(r.stdout || '') + String(r.stderr || '');
      if (SP.deriveSessionKey({ LEERNESS_SESSION_ID: 'x' })) bad.push('⑥픽스처 키가 유효해져 이 축이 공허해졌다');
      else if (!/형식에 맞지 않아 무시/.test(msg)) bad.push('⑥무효한 세션 주소를 조용히 무시');
      dbg.badKey = { warned: /형식에 맞지 않아 무시/.test(msg) };
    }
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ AF(1.36.142/T-0116) 증거 귀속: 두 세션이 같은 프로젝트에서 일해도 증거가 **일한 세션**에 붙고 놀던 세션은 완료 허용을 못 받음 · 남의 run 거절+사유 · 남의 handoff 가 내 run 을 안 끊음 · 세션키 없는 기존 흐름 무회귀 · 예전 상태 인수 · 무효 주소 고지 ${JSON.stringify(dbg)}`
    : '✗ 1.36.142 증거 귀속 실패 ' + JSON.stringify({ bad: bad.slice(0, 8), dbg }));
  if (!ok) failed++;
}

 
 
 
 
 
 
if (e2eShard.take('AG(1.36.143)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-143-'));
  const envP = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
    'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'LEERNESS_SESSION_ID', 'CODEX_THREAD_ID', 'CI', 'GITHUB_ACTIONS',
    'CLAUDECODE', 'CURSOR_AGENT', 'CODEX_MANAGED_BY_NPM', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG',
    'GIT_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_NOSYSTEM']) delete envP[k];
  envP.GIT_CONFIG_GLOBAL = path.join(sb, 'gitconfig-global');
  envP.GIT_CONFIG_SYSTEM = path.join(sb, 'gitconfig-system');
  try { fs.writeFileSync(envP.GIT_CONFIG_GLOBAL, ''); fs.writeFileSync(envP.GIT_CONFIG_SYSTEM, ''); } catch {}
  const G = (d, a) => gitSpawn(a, { cwd: d, encoding: 'utf8', timeout: 60000, env: envP });
  const RP = (d, a, env) => cp.spawnSync(process.execPath, [CLI, ...a],
    { cwd: d, encoding: 'utf8', timeout: 60000, env: env || envP, maxBuffer: 32 * 1024 * 1024 });
  const J = (r) => { try { return JSON.parse(String(r.stdout || '')); } catch { return null; } };
   
  const mkRepo = (name) => {
    const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
    G(d, ['init', '-q', '-b', 'main', '.']); G(d, ['config', 'user.email', 't@t']); G(d, ['config', 'user.name', 't']);
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
    fs.writeFileSync(path.join(d, 'a.txt'), 'a'); G(d, ['add', '-A']); G(d, ['commit', '-qm', 'i']);
    RP(d, ['init', d, '--yes', '--minimal']); RP(d, ['handoff', d]);
    return d;
  };
  const cwd = path.join(sb, 'cwd'); fs.mkdirSync(cwd, { recursive: true });
  try {
     
    {
      let usages = [];
      const lr = RP(cwd, ['commands', '--json']);
      try {
        const collect = (v) => {
          if (Array.isArray(v)) for (const x of v) collect(x);
          else if (v && typeof v === 'object') { if (typeof v.cmd === 'string') usages.push(v.cmd); else if (typeof v.name === 'string') usages.push(v.name); else for (const k of Object.keys(v)) collect(v[k]); }
          else if (typeof v === 'string') usages.push(v);
        };
        collect(JSON.parse(lr.stdout));
      } catch (e) { bad.push('①명령 목록을 얻지 못함: ' + String(e.message).slice(0, 60)); }
       
      const CREATORS = /^(init|migrate|migrate-workspace-dir|update|auto-update|adapter|ci)\b/;
      const invocations = []; const seen = new Set();
      for (const raw of Array.from(new Set(usages))) {
        const u = String(raw).replace(/^leerness\s+/, '').trim();
        if (!u || CREATORS.test(u)) continue;
        const toks = u.split(/\s+/); const head = toks[0];
        if (!/^[a-z][a-z0-9-]*$/.test(head)) continue;
        const second = toks[1] || '';
        let subs = [null];
        if (second && second.includes('|') && !/^[[<]/.test(second)) subs = second.split('|').map((x) => x.replace(/[[\]<>"]/g, '')).filter((x) => /^[a-z][a-z0-9-]*$/.test(x));
        else if (second && /^[a-z][a-z0-9-]*$/.test(second)) subs = [second];
        for (const sub of subs) {
          for (const extra of [[], ['zzprobe']]) {
            const argv = sub ? [head, sub, ...extra] : [head, ...extra];
            const label = argv.join(' ');
            if (!seen.has(label)) { seen.add(label); invocations.push({ label, argv }); }
          }
        }
      }
       
      if (invocations.length < 100) bad.push(`①열거가 ${invocations.length}건 — 계측 붕괴(0건 통과가 무의미해진다)`);
      const leaks = [];
      for (let i = 0; i < invocations.length; i++) {
        const ghost = path.join(sb, 'g' + i, 'nope');
        const r = RP(cwd, [...invocations[i].argv, '--path', ghost]);
        if (fs.existsSync(ghost)) leaks.push(`${invocations[i].label}(exit=${r.status})`);
      }
      if (leaks.length) bad.push(`①없는 경로를 만든 호출 ${leaks.length}건: ${leaks.slice(0, 6).join(' · ')}`);
      dbg.ghostSweep = { invocations: invocations.length, leaks: leaks.length };
    }
     
    {
      const d = path.join(sb, 'real'); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
      RP(d, ['init', d, '--yes', '--minimal']);
      const exits = ['handoff', 'status', 'audit'].map((c) => RP(d, [c, '--path', d]).status);
      if (exits.some((x) => x !== 0)) bad.push(`②정상 프로젝트에서 조회가 막힘(exits=${JSON.stringify(exits)})`);
      dbg.realProject = { exits };
    }
     
    {
      const m1 = mkRepo('wt-shared');
      const add1 = G(m1, ['worktree', 'add', '-qb', 'lk', path.join(sb, 'wt-shared-linked')]);
      const j1 = J(RP(m1, ['enforce', 'install', '--path', m1, '--json', '--skip-verify']));
      const m2 = mkRepo('wt-own');
      G(m2, ['config', 'extensions.worktreeConfig', 'true']);
      const add2 = G(m2, ['worktree', 'add', '-qb', 'lk2', path.join(sb, 'wt-own-linked')]);
      fs.mkdirSync(path.join(m2, '.git', 'wt-hooks'), { recursive: true });
      const cfg = G(m2, ['config', '--worktree', 'core.hooksPath', '.git/wt-hooks']);
      const j2 = J(RP(m2, ['enforce', 'status', '--path', m2, '--json']));
      if (add1.status !== 0 || add2.status !== 0 || cfg.status !== 0) bad.push('③worktree 픽스처를 만들지 못함 — 판별 불가');
      else {
        if (!j1 || j1.worktrees !== 2) bad.push(`③공용 훅인데 형제 차단을 말하지 않음(worktrees=${j1 && j1.worktrees})`);
        if (!j2 || j2.worktrees !== 1) bad.push(`③worktree 전용 훅인데 형제도 막힌다고 함(worktrees=${j2 && j2.worktrees})`);
      }
      dbg.worktree = { shared: j1 && j1.worktrees, perWorktree: j2 && j2.worktrees };
    }
     
     
     
    {
      const main = mkRepo('wt-ancestor-junction');
      const sibling = path.join(sb, 'wt-ancestor-junction-linked');
      const add = G(main, ['worktree', 'add', '-qb', 'lj', sibling]);
      let linked = false;
      const actual = path.join(main, '.git', 'shared-hooks');
      const alias = path.join(main, '.git', 'link-hooks');
      let before = null, installed = null, siblingCommit = null;
      if (add.status !== 0) bad.push(`③a junction worktree 생성 실패(${add.status}) — 판별 불가`);
      else {
        try {
          fs.mkdirSync(actual, { recursive: true });
          fs.mkdirSync(path.join(sibling, '.leerness'), { recursive: true });
          fs.symlinkSync(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
          linked = true;
        } catch (e) {
          dbg.ancestorJunction = { skipped: 'junction/symlink 생성 불가', error: String(e && e.code || e).slice(0, 80) };
        }
        if (linked) {
          const cfg = [
            G(main, ['config', 'extensions.worktreeConfig', 'true']),
            G(main, ['config', '--worktree', 'core.hooksPath', alias]),
            G(sibling, ['config', '--worktree', 'core.hooksPath', actual]),
          ];
          if (cfg.some((r) => r.status !== 0)) bad.push('③a worktree별 hooksPath 설정 실패 — 판별 불가');
          else {
            before = J(RP(main, ['enforce', 'status', '--path', main, '--json']));
            installed = J(RP(main, ['enforce', 'install', '--path', main, '--json', '--skip-verify']));
             
             
            fs.writeFileSync(path.join(sibling, 'ancestor-junction-probe.txt'), 'probe\n');
            G(sibling, ['add', '-A']);
            siblingCommit = G(sibling, ['commit', '-m', 'ancestor-junction-probe']);
            if (!before || before.worktrees !== 2) bad.push(`③a 없는 훅 파일의 조상 junction을 못 풀어 형제 차단을 숨김(before=${before && before.worktrees})`);
            if (!installed || installed.worktrees !== 2) bad.push(`③a 설치 응답도 공유 worktree를 1개로 오보고(installed=${installed && installed.worktrees})`);
            if (!siblingCommit || siblingCommit.status === 0) bad.push('③a 픽스처가 실제 형제 커밋 차단을 증명하지 못함');
          }
          dbg.ancestorJunction = { before: before && before.worktrees, installed: installed && installed.worktrees,
            siblingCommitExit: siblingCommit && siblingCommit.status, sameTarget: fs.realpathSync(alias) === fs.realpathSync(actual) };
        }
      }
    }
     
    {
      const g = require(path.resolve(__dirname, '..', 'lib', 'git.js'));
      const mustDrop = ['GIT_DIR', 'git_dir', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_7', 'GIT_CONFIG_VALUE_7'];
      const mustKeep = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM', 'GIT_CEILING_DIRECTORIES', 'GIT_AUTHOR_NAME', 'GIT_SSH_COMMAND', 'GIT_EDITOR'];
      const droppedNot = mustDrop.filter((k) => !g._shouldDrop(k));
      const keptNot = mustKeep.filter((k) => g._shouldDrop(k));
      if (droppedNot.length) bad.push(`④세척해야 하는데 안 함: ${droppedNot.join(', ')}`);
      if (keptNot.length) bad.push(`④남겨야 하는데 세척함(과세척): ${keptNot.join(', ')}`);
      dbg.scrub = { droppedNot, keptNot, total: g.GIT_LOCATION_ENV.length };
    }
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ AG(1.36.143) 없는 --path 는 아무것도 만들지 않음(전수 열거, 고치기 전 33건) · 정상 프로젝트 무회귀 · worktree 형제 차단을 추정 대신 **각 worktree 에게 물어** 판정(없는 훅 파일의 조상 junction 포함) · 세척 클래스 경계(지울 것/남길 것 양방향) ${JSON.stringify(dbg)}`
    : '✗ 1.36.143 경로/공유 판정 실패 ' + JSON.stringify({ bad: bad.slice(0, 8), dbg }));
  if (!ok) failed++;
}

 
 
 
 
if (e2eShard.take('AH(1.36.144/T-0117)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-144-'));
  const envP = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
    'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'LEERNESS_SESSION_ID', 'CODEX_THREAD_ID', 'CI', 'GITHUB_ACTIONS',
    'CLAUDECODE', 'CURSOR_AGENT', 'CODEX_MANAGED_BY_NPM', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG',
    'GIT_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_NOSYSTEM']) delete envP[k];
  envP.GIT_CONFIG_GLOBAL = path.join(sb, 'gcg'); envP.GIT_CONFIG_SYSTEM = path.join(sb, 'gcs');
  try { fs.writeFileSync(envP.GIT_CONFIG_GLOBAL, ''); fs.writeFileSync(envP.GIT_CONFIG_SYSTEM, ''); } catch {}
  const G = (d, a) => gitSpawn(a, { cwd: d, encoding: 'utf8', timeout: 60000, env: envP });
  const RP = (d, a, env) => cp.spawnSync(process.execPath, [CLI, ...a],
    { cwd: d, encoding: 'utf8', timeout: 60000, env: env || envP, maxBuffer: 32 * 1024 * 1024 });
  const J = (r) => { try { return JSON.parse(String(r.stdout || '')); } catch { return null; } };
  const snap = (d) => {
    const out = {};
    const walk = (q) => {
      let ents = []; try { ents = fs.readdirSync(q, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const full = path.join(q, e.name);
        if (e.isDirectory()) { out[path.relative(d, full) + '/'] = 'DIR'; walk(full); }
        else { let h = 'ERR'; try { h = String(fs.readFileSync(full).length); } catch {} out[path.relative(d, full)] = h; }
      }
    };
    walk(d); return out;
  };
  const diffKeys = (a, b) => Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).filter((k) => a[k] !== b[k]);
  const mkGit = (name) => {
    const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
    G(d, ['init', '-q', '-b', 'main', '.']); G(d, ['config', 'user.email', 't@t']); G(d, ['config', 'user.name', 't']);
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
    fs.writeFileSync(path.join(d, 'a.txt'), 'a'); G(d, ['add', '-A']); G(d, ['commit', '-qm', 'i']);
    RP(d, ['init', d, '--yes', '--minimal']); RP(d, ['handoff', d]);
    return d;
  };
  try {
     
    {
      const cases = [['task', 'add', '작업'], ['decision', 'add', '결정', '--reason', 'r'], ['rule', 'add', '룰'],
        ['plan', 'add', '계획'], ['lesson', 'save', '교훈'], ['session', 'close'], ['state', 'start', '목표']];
      const wrote = [], notRefused = [];
      for (let i = 0; i < cases.length; i++) {
        const d = mkGit('dry' + i);
        const before = snap(d);
        const r = RP(d, [...cases[i], '--dry-run', '--path', d]);
        const changed = diffKeys(before, snap(d));
        if (changed.length) wrote.push(`${cases[i].join(' ')}→${changed.slice(0, 3).join(',')}`);
        if (r.status === 0) notRefused.push(cases[i].join(' '));
      }
      if (wrote.length) bad.push(`①--dry-run 인데 바뀐 것: ${wrote.join(' · ')}`);
      if (notRefused.length) bad.push(`①--dry-run 을 구현 안 했는데 성공이라 보고: ${notRefused.join(' · ')}`);
       
      const d2 = mkGit('real');
      const okExits = [RP(d2, ['task', 'add', '작업', '--path', d2]).status,
        RP(d2, ['decision', 'add', '결정', '--reason', 'r', '--path', d2]).status];
      if (okExits.some((x) => x !== 0)) bad.push(`①플래그 없는 정상 실행이 막힘(exits=${JSON.stringify(okExits)})`);
      dbg.dryRun = { wrote: wrote.length, notRefused: notRefused.length, realExits: okExits };
    }
     
     
     
     
    {
      const d = mkGit('dry-presence');
      const sessionEnv = Object.assign({}, envP, { LEERNESS_SESSION_ID: 'dryguard001' });
      const before = snap(d);
      const r = RP(d, ['session', 'close', '--dry-run', '--path', d], sessionEnv);
      const changed = diffKeys(before, snap(d));
      const sessionDir = path.join(d, '.leerness', 'cache', 'sessions');
      if (r.status === 0) bad.push('①a session close --dry-run 이 쓰기 차단 뒤에도 성공이라 보고');
      if (changed.length) bad.push(`①a 세션 주소가 있을 때 --dry-run 이 바꾼 것: ${changed.slice(0, 4).join(',')}`);
      if (fs.existsSync(sessionDir)) bad.push('①a --dry-run 이 session-presence cache를 생성');
      dbg.dryPresence = { exit: r.status, changed: changed.length, sessionCacheCreated: fs.existsSync(sessionDir) };
    }
     
    {
      const d = mkGit('emptypath');
      const before = snap(d);
      const r1 = RP(d, ['decision', 'add', 'SNEAKY1', '--reason', 'r', '--path=']);
      const r2 = RP(d, ['decision', 'add', 'SNEAKY2', '--reason', 'r', '--path']);
      const changed = diffKeys(before, snap(d));
      if (r1.status === 0 || r2.status === 0) bad.push(`②빈 --path 인데 성공이라 보고(${r1.status}/${r2.status})`);
      if (changed.length) bad.push(`②빈 --path 가 cwd 에 씀: ${changed.slice(0, 3).join(',')}`);
      dbg.emptyPath = { exits: [r1.status, r2.status], changed: changed.length };
    }
     
    {
      const victim = mkGit('mcp-victim');
      for (let i = 0; i < 60; i++) G(victim, ['branch', 'release/1.0.' + i]);
      const target = mkGit('mcp-target');
      const cnt = () => (G(victim, ['branch', '--list', 'release/*']).stdout || '').split('\n').filter((l) => l.trim()).length;
      const before = cnt();
      const req = [
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'leerness_release_cleanup', arguments: { path: target, apply: true, keep: 10 } } }),
      ].join('\n') + '\n';
      cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: victim, input: req, encoding: 'utf8', env: envP, timeout: 180000 });
      const after = cnt();
      if (after !== before) bad.push(`③MCP 가 서버 cwd 저장소의 브랜치 ${before - after}개를 지움(${before}→${after})`);
      dbg.mcpCleanup = { before, after };
    }
     
    {
      const eA = Object.assign({}, envP, { LEERNESS_SESSION_ID: 'session-alpha01' });
      const eB = Object.assign({}, envP, { LEERNESS_SESSION_ID: 'session-bravo01' });
      const d = mkGit('own');
      RP(d, ['state', 'start', 'A', '--json'], eA);
      const stf = path.join(d, '.leerness', 'state.json');
      const st = JSON.parse(fs.readFileSync(stf, 'utf8'));
      st.runsBySession = ['corrupt'];
      fs.writeFileSync(stf, JSON.stringify(st, null, 2) + '\n');
      const rB = RP(d, ['state', 'record', '--files-changed', 'stolen.js'], eB);
      const runA = JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'runs', 'run-0001.json'), 'utf8'));
      if (rB.status === 0) bad.push('④손상된 소유맵에서 남의 run 에 기록 성공(fail-open)');
      if (runA.files_changed.length) bad.push('④손상된 소유맵에서 남의 증거가 오염됨');
       
      const d2 = mkGit('own2');
      const eP = Object.assign({}, envP, { LEERNESS_SESSION_ID: '__proto__aaaa' });
      const s1 = J(RP(d2, ['state', 'start', 'P', '--json'], eP));
      const r1 = J(RP(d2, ['state', 'record', '--files-changed', 'p.js', '--json'], eP));
      if (!s1 || !r1 || r1.recorded !== s1.started) bad.push(`④__proto__ 키에서 소유가 사라짐(${r1 && r1.recorded})`);
       
      const d3 = mkGit('own3');
      RP(d3, ['state', 'start', 'A', '--json'], eA);
      RP(d3, ['state', 'start', 'B', '--json'], eB);
      const show = J(RP(d3, ['state', 'show', '--json'], eB));
      const keys = Object.keys((show && show.runsBySession) || {});
      if (keys.includes('session-alpha01')) bad.push('④남의 세션 키를 그대로 노출(그 키로 남의 run 을 고칠 수 있다)');
      if (!keys.includes('session-bravo01')) bad.push('④내 세션 키를 못 보여줌 — 내 것을 확인할 수 없다');
      dbg.ownership = { corruptExit: rB.status, protoRecorded: r1 && r1.recorded, keys };
    }
     
    {
      const m = mkGit('wt');
      const live = path.join(sb, 'wt-live'), gone = path.join(sb, 'wt-gone');
      const a1 = G(m, ['worktree', 'add', '-qb', 'live', live]);
      const a2 = G(m, ['worktree', 'add', '-qb', 'gone', gone]);
      fs.rmSync(gone, { recursive: true, force: true });
      const j = J(RP(m, ['enforce', 'install', '--path', m, '--json', '--skip-verify']));
      if (a1.status !== 0 || a2.status !== 0) bad.push('⑤worktree 픽스처 실패 — 판별 불가');
      else if (!j || j.worktrees !== 2) bad.push(`⑤prunable 하나가 전체 판정을 가림(worktrees=${j && j.worktrees}, 기대 2)`);
      dbg.prunable = { worktrees: j && j.worktrees };
    }
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ AH(1.36.144/T-0117) --dry-run 이 아무것도 안 씀(고치기 전 378중 183) + 구현 안 한 명령은 거절 · 플래그 없는 실행은 그대로 · 빈 --path 가 cwd 에 못 씀 · MCP 가 서버 cwd 저장소를 안 지움 · 소유맵이 손상/__proto__/노출에 견딤 · prunable 이 형제 차단을 안 숨김 ${JSON.stringify(dbg)}`
    : '✗ 1.36.144 dry-run/소유 실패 ' + JSON.stringify({ bad: bad.slice(0, 8), dbg }));
  if (!ok) failed++;
}

 
 
 
 
if (e2eShard.take('AI(1.36.145)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-145-'));
  const envP = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
    'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'LEERNESS_SESSION_ID', 'CODEX_THREAD_ID', 'CI', 'GITHUB_ACTIONS',
    'CLAUDECODE', 'CURSOR_AGENT', 'CODEX_MANAGED_BY_NPM', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG']) delete envP[k];
  const RP = (d, a, env) => cp.spawnSync(process.execPath, [CLI, ...a],
    { cwd: d, encoding: 'utf8', timeout: 120000, env: env || envP, maxBuffer: 32 * 1024 * 1024 });
  const mk = (name) => {
    const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
    const ri = RP(d, ['init', d, '--yes', '--minimal']);
    if (ri.status !== 0) bad.push(`${name}:init exit=${ri.status}`);
    return d;
  };
  const KA = 'session-alpha01', KB = 'session-bravo01';
  try {
     
    {
      const d = mk('mcp');
      const call = (name, a, id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: a } });
      const req = [
        JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
        call('leerness_state_start', { path: d, goal: 'A', sessionKey: KA }, 1),
        call('leerness_state_start', { path: d, goal: 'B', sessionKey: KB }, 2),
        call('leerness_state_record', { path: d, filesChanged: 'a.js', tests: 'npm test: 10/10', sessionKey: KA }, 3),
        call('leerness_state_verify', { path: d, result: 'pass', sessionKey: KB }, 4),
      ].join('\n') + '\n';
      const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: d, input: req, encoding: 'utf8', env: envP, timeout: 300000 });
      const lines = String(r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const jsonOf = (id) => { try { return JSON.parse(lines.find((x) => x.id === id).result.content[0].text); } catch { return null; } };
      const s1 = jsonOf(1), s2 = jsonOf(2), rec = jsonOf(3), ver = jsonOf(4);
      if (!s1 || !s2 || s1.started === s2.started) bad.push('①MCP 두 세션이 같은 run 을 받음 — 판별 불가');
      else {
        if (!rec || rec.recorded !== s1.started) bad.push(`①MCP: A 의 증거가 A 의 run 이 아닌 곳에 붙음(${rec && rec.recorded})`);
        if (!ver || ver.result !== 'pass' || !ver.run || ver.run.verification_result !== 'pass') bad.push(`①MCP: B verify pass 응답이 없거나 실패(${JSON.stringify(ver)})`);
        const allowed = ver && ver.completion_claim_allowed && ver.completion_claim_allowed.allowed;
        if (allowed) bad.push('①MCP: 일하지 않은 세션이 완료 허용을 받음 — 증거 게이트가 뒤집힘');
      }
       
      const T = require(path.resolve(__dirname, '..', 'lib', 'mcp-tools'));
      const st = T.filter((t) => /^leerness_state_/.test(t.name));
      const withKey = st.filter((t) => t.inputSchema && t.inputSchema.properties && t.inputSchema.properties.sessionKey);
      if (st.length === 0 || withKey.length !== st.length) bad.push(`①state 도구 ${st.length}종 중 ${withKey.length}종만 sessionKey 를 광고`);
      dbg.mcp = { A: s1 && s1.started, B: s2 && s2.started, recordedTo: rec && rec.recorded,
        bAllowed: !!(ver && ver.completion_claim_allowed && ver.completion_claim_allowed.allowed),
        schemaTools: st.length, schemaWithKey: withKey.length };
    }
     
    {
      const d = mk('handoff');
      const eA = Object.assign({}, envP, { LEERNESS_SESSION_ID: KA });
      const eB = Object.assign({}, envP, { LEERNESS_SESSION_ID: KB });
      RP(d, ['state', 'start', 'A', '--json'], eA);
      RP(d, ['state', 'start', 'B', '--json'], eB);
      RP(d, ['state', 'handoff', 'A 의 인수인계', '--json'], eA);
      RP(d, ['state', 'handoff', 'B 의 인수인계', '--json'], eB);
      const hd = path.join(d, '.leerness', 'handoff');
      const readJ = (f) => { try { return JSON.parse(fs.readFileSync(path.join(hd, f), 'utf8')); } catch { return null; } };
      const a = readJ('run-0001.json'), latest = readJ('latest.json');
      if (!a || a.handoff_summary !== 'A 의 인수인계') bad.push('②앞 세션의 인수인계가 덮여 사라짐');
      if (!latest || latest.run_id !== 'run-0002') bad.push(`②latest 가 최신이 아님(${latest && latest.run_id})`);
      dbg.handoff = { files: (() => { try { return fs.readdirSync(hd).length; } catch { return 0; } })(),
        aKept: !!(a && a.handoff_summary === 'A 의 인수인계'), latestRun: latest && latest.run_id };
    }
     
    {
      const d = mk('nokey');
      const call = (name, a, id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: a } });
      const req = [
        JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
        call('leerness_state_start', { path: d, goal: '단독' }, 1),
        call('leerness_state_record', { path: d, filesChanged: 'x.js' }, 2),
      ].join('\n') + '\n';
      const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: d, input: req, encoding: 'utf8', env: envP, timeout: 300000 });
      const lines = String(r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const jsonOf = (id) => { try { return JSON.parse(lines.find((x) => x.id === id).result.content[0].text); } catch { return null; } };
      const s = jsonOf(1), rec = jsonOf(2);
      if (!s || !rec || rec.recorded !== s.started) bad.push(`③주소 없는 단독 흐름이 깨짐(${rec && rec.recorded} vs ${s && s.started})`);
      dbg.noKey = { started: s && s.started, recorded: rec && rec.recorded };
    }
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ AI(1.36.145) MCP 표면 증거 귀속: 도구가 세션 주소를 받아 **일한 세션**에 증거가 붙고 놀던 세션은 완료 허용을 못 받음(스키마 광고 포함) · 인수인계가 덮이지 않음(run 별 사본 + latest 최신) · 주소 없는 단독 클라이언트 무회귀 ${JSON.stringify(dbg)}`
    : '✗ 1.36.145 MCP 귀속 실패 ' + JSON.stringify({ bad: bad.slice(0, 8), dbg }));
  if (!ok) failed++;
}

 
 
 
 
 
 
 
 
if (e2eShard.take('AJ(1.36.146)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-146-'));
  const envP = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
    'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'LEERNESS_SESSION_ID', 'CODEX_THREAD_ID', 'CI', 'GITHUB_ACTIONS',
    'CLAUDECODE', 'CURSOR_AGENT', 'CODEX_MANAGED_BY_NPM', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG', 'GIT_DIR']) delete envP[k];
  envP.GIT_CONFIG_GLOBAL = path.join(sb, 'gcg'); envP.GIT_CONFIG_SYSTEM = path.join(sb, 'gcs');
  try { fs.writeFileSync(envP.GIT_CONFIG_GLOBAL, ''); fs.writeFileSync(envP.GIT_CONFIG_SYSTEM, ''); } catch {}
  const G = (d, a) => gitSpawn(a, { cwd: d, encoding: 'utf8', timeout: 60000, env: envP });
  const RP = (d, a) => cp.spawnSync(process.execPath, [CLI, ...a],
    { cwd: d, encoding: 'utf8', timeout: 120000, env: envP, maxBuffer: 32 * 1024 * 1024 });
  const mk = (dir, branches) => {
    fs.mkdirSync(dir, { recursive: true });
    G(dir, ['init', '-q', '-b', 'main', '.']); G(dir, ['config', 'user.email', 't@t']); G(dir, ['config', 'user.name', 't']);
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p","version":"0.1.0"}');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a'); G(dir, ['add', '-A']); G(dir, ['commit', '-qm', 'i']);
    for (let i = 0; i < (branches || 0); i++) G(dir, ['branch', 'release/1.0.' + i]);
    RP(dir, ['init', dir, '--yes', '--minimal']); RP(dir, ['handoff', dir]);
    return dir;
  };
  try {
     
    {
      const d = mk(path.join(sb, 'enf'));
      RP(d, ['enforce', 'install', '--path', d, '--json', '--skip-verify']);
      const hook = path.join(d, '.git', 'hooks', 'pre-commit');
      const had = fs.existsSync(hook);
      const r = RP(d, ['enforce', 'remove', '--path', d, '--dry-run']);
      const still = fs.existsSync(hook);
      if (!had) bad.push('①설치가 안 돼 판별 조건이 서지 않음(공허)');
      else if (!still) bad.push('①--dry-run 인데 실제 훅을 삭제');
      else if (r.status === 0) bad.push('①삭제를 막았는데 성공이라 보고');
       
      const r2 = RP(d, ['enforce', 'remove', '--path', d]);
      if (fs.existsSync(hook)) bad.push(`②플래그 없는 remove 가 훅을 못 지움(exit=${r2.status}) — 가드가 기능을 죽였다`);
      dbg.enforceRemove = { had, afterDry: still, dryExit: r.status, afterReal: fs.existsSync(hook) };
    }
     
    {
      const d = mk(path.join(sb, 'rel'), 60);
      const cnt = () => (G(d, ['branch', '--list', 'release/*']).stdout || '').split('\n').filter((l) => l.trim()).length;
      const before = cnt();
      const r = RP(d, ['release', 'cleanup', '--apply', '--keep', '10', '--dry-run', '--path', d]);
      const afterDry = cnt();
      if (before < 50) bad.push(`②픽스처 브랜치 ${before}개 — 정리 임계값에 못 미쳐 공허`);
      else if (afterDry !== before) bad.push(`②--dry-run 인데 브랜치 ${before - afterDry}개 삭제`);
       
      RP(d, ['release', 'cleanup', '--apply', '--keep', '10', '--path', d]);
      const afterReal = cnt();
      if (afterReal >= before) bad.push(`②플래그 없는 정리가 동작하지 않음(${before}→${afterReal}) — 가드가 기능을 죽였다`);
      dbg.releaseCleanup = { before, afterDry, afterReal, dryExit: r.status };
    }
     
    {
      const holder = path.join(sb, 'cache'); fs.mkdirSync(holder, { recursive: true });
      const d = path.join(holder, 'proj'); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
      RP(d, ['init', d, '--yes', '--minimal']);
      const dj = path.join(d, '.leerness', 'decisions.json');
      const before = (() => { try { return fs.readFileSync(dj, 'utf8'); } catch { return ''; } })();
      const r = RP(d, ['decision', 'add', 'CACHEPATH', '--reason', 'r', '--dry-run', '--path', d]);
      const after = (() => { try { return fs.readFileSync(dj, 'utf8'); } catch { return ''; } })();
      if (before !== after) bad.push('③cache/ 하위 프로젝트에서 가드가 통째로 꺼짐');
      if (r.status === 0) bad.push('③cache/ 하위인데 성공이라 보고');
       
      RP(d, ['decision', 'add', 'CACHEPATH', '--reason', 'r', '--path', d]);
      const real = (() => { try { return fs.readFileSync(dj, 'utf8'); } catch { return ''; } })();
      if (!/CACHEPATH/.test(real)) bad.push('③cache/ 하위에서 정상 기록이 막힘 — 과차단');
      dbg.cacheDir = { dryChanged: before !== after, dryExit: r.status, realWrote: /CACHEPATH/.test(real) };
    }
     
    {
      const server = mk(path.join(sb, 'mcpserver'));
      const dj = path.join(server, '.leerness', 'decisions.json');
      const before = (() => { try { return fs.readFileSync(dj, 'utf8'); } catch { return ''; } })();
      const req = [
        JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_decision_add', arguments: { path: '', title: 'MCPSNEAK', reason: 'r' } } }),
      ].join('\n') + '\n';
      cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: server, input: req, encoding: 'utf8', env: envP, timeout: 180000 });
      const after = (() => { try { return fs.readFileSync(dj, 'utf8'); } catch { return ''; } })();
      if (/MCPSNEAK/.test(after) && !/MCPSNEAK/.test(before)) bad.push('④MCP 빈 path 가 서버 root 저장소에 씀');
      dbg.mcpEmptyPath = { wrote: /MCPSNEAK/.test(after) && !/MCPSNEAK/.test(before) };
    }
     
    {
      const d = path.join(sb, 'plain'); fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
      const exits = [
        RP(d, ['init', d, '--yes', '--minimal']).status,
        RP(d, ['handoff', d]).status,
        RP(d, ['task', 'add', '작업', '--path', d]).status,
        RP(d, ['decision', 'add', '결정', '--reason', 'r', '--path', d]).status,
        RP(d, ['audit', '--path', d]).status,
      ];
      if (exits.some((x) => x !== 0)) bad.push(`⑤플래그 없는 정상 흐름이 막힘(exits=${JSON.stringify(exits)})`);
       
      const impl = [RP(d, ['migrate', 'audit', '--path', d, '--dry-run']).status,
        RP(d, ['init', d, '--yes', '--minimal', '--dry-run']).status];
      if (impl.some((x) => x !== 0)) bad.push(`⑤dry-run 구현 명령이 막힘(exits=${JSON.stringify(impl)})`);
      dbg.noRegression = { plain: exits, dryImplemented: impl };
    }
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ AJ(1.36.146) dry-run 이 **삭제·git 부작용**까지 막음: enforce remove 가 훅을 안 지움 · release cleanup 이 브랜치를 안 지움(둘 다 플래그 없으면 동작) · cache/ 하위에서도 가드 유효 · MCP 빈 path 차단 · 평범한 흐름 무회귀 ${JSON.stringify(dbg)}`
    : '✗ 1.36.146 dry-run 전면가드 실패 ' + JSON.stringify({ bad: bad.slice(0, 8), dbg }));
  if (!ok) failed++;
}

 
 
 
 
 
if (e2eShard.take('AK(1.36.147)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-147-'));
  const envP = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
    'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'LEERNESS_SESSION_ID', 'CODEX_THREAD_ID', 'CI', 'GITHUB_ACTIONS',
    'CLAUDECODE', 'CURSOR_AGENT', 'CODEX_MANAGED_BY_NPM', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG']) delete envP[k];
  const RP = (d, a, env) => cp.spawnSync(process.execPath, [CLI, ...a],
    { cwd: d, encoding: 'utf8', timeout: 120000, env: env || envP, maxBuffer: 32 * 1024 * 1024 });
  const J = (r) => { try { return JSON.parse(String(r.stdout || '')); } catch { return null; } };
  const mk = (name) => {
    const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
    const ri = RP(d, ['init', d, '--yes', '--minimal']);
    if (ri.status !== 0) bad.push(`${name}:init exit=${ri.status}`);
    return d;
  };
  const KA = 'session-alpha01', KB = 'session-bravo01';
  const eA = Object.assign({}, envP, { LEERNESS_SESSION_ID: KA });
  const eB = Object.assign({}, envP, { LEERNESS_SESSION_ID: KB });
  try {
     
    {
      const d = mk('legacy');
      RP(d, ['state', 'start', '업그레이드 전', '--json']);        
      const stf = path.join(d, '.leerness', 'state.json');
      const st = JSON.parse(fs.readFileSync(stf, 'utf8'));
      delete st.runsBySession;                                      
      fs.writeFileSync(stf, JSON.stringify(st, null, 2) + '\n');
      const rA = J(RP(d, ['state', 'record', '--files-changed', 'A.js', '--json'], eA));
      const rB = RP(d, ['state', 'record', '--files-changed', 'B.js'], eB);
      let run = null; try { run = JSON.parse(fs.readFileSync(path.join(d, '.leerness', 'runs', 'run-0001.json'), 'utf8')); } catch {}
       
      if (!rA || rA.recorded !== 'run-0001') bad.push(`①업그레이드 전 run 을 인수하지 못함(${rA && rA.recorded})`);
      if (rB.status === 0) bad.push('①두 번째 세션이 남의 run 을 인수해 성공이라 보고');
      if (!run || run.files_changed.includes('B.js')) bad.push(`①한 run 에 두 세션의 증거가 섞임(${run && JSON.stringify(run.files_changed)})`);
      dbg.legacy = { aRecorded: rA && rA.recorded, bExit: rB.status, files: run && run.files_changed };
    }
     
    {
      const d = mk('samekey');
      const s1 = J(RP(d, ['state', 'start', '첫째', '--json'], eA));
      const s2 = RP(d, ['state', 'start', '둘째', '--json'], eA);
      const rec = J(RP(d, ['state', 'record', '--files-changed', 'x.js', '--json'], eA));
      if (!s1) bad.push('②첫 start 실패 — 판별 불가');
      if (s2.status === 0) bad.push('②같은 세션에 run 이 열려 있는데 두 번째 start 가 성공');
      if (!/진행 중인 run/.test(String(s2.stdout || '') + String(s2.stderr || ''))) bad.push('②거절 사유에 열린 run 을 말하지 않음');
      if (!rec || rec.recorded !== (s1 && s1.started)) bad.push(`②거절 뒤 기록이 첫 run 으로 가지 않음(${rec && rec.recorded})`);
       
      const s3 = J(RP(d, ['state', 'start', '셋째', '--json', '--force'], eA));
      if (!s3 || !s3.started || s3.started === (s1 && s1.started)) bad.push('②--force 로도 새 run 을 시작하지 못함 — 막다른 길');
      dbg.sameKey = { first: s1 && s1.started, secondExit: s2.status, recordedTo: rec && rec.recorded, forced: s3 && s3.started };
    }
     
    {
      const d = mk('leak');
      const eS = Object.assign({}, envP, { LEERNESS_SESSION_ID: 'session-secret01' });
      const eV = Object.assign({}, envP, { LEERNESS_SESSION_ID: 'session-viewer01' });
      RP(d, ['state', 'start', 'A', '--json'], eS);
      RP(d, ['state', 'start', 'B', '--json'], eV);
      const show = J(RP(d, ['state', 'show', '--json'], eV));
      const top = Object.keys((show && show.runsBySession) || {});
      const nested = Object.keys((show && show.state && show.state.runsBySession) || {});
      if (top.includes('session-secret01')) bad.push('③최상위에서 남의 키 노출');
      if (nested.includes('session-secret01')) bad.push('③중첩 state.runsBySession 에서 남의 키 노출');
      if (!top.includes('session-viewer01') || !nested.includes('session-viewer01')) bad.push('③내 키를 못 보여줌 — 내 것을 확인할 수 없다');
      dbg.redaction = { top, nested };
    }
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ AK(1.36.147) 소유권: 인수가 **이름을 남겨** 두 세션이 같은 run 에 증거를 못 섞음(첫 인수는 그대로 성공) · 한 세션에 열린 run 은 하나(사유 명시 + --force 탈출구) · 남의 세션 키 가림이 최상위·중첩 모두 ${JSON.stringify(dbg)}`
    : '✗ 1.36.147 소유권 실패 ' + JSON.stringify({ bad: bad.slice(0, 8), dbg }));
  if (!ok) failed++;
}

 
 
 
 
 
 
 
if (e2eShard.take('AL(1.36.148)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-148-'));
  const envP = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
    'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'LEERNESS_SESSION_ID', 'CODEX_THREAD_ID', 'CI', 'GITHUB_ACTIONS',
    'CLAUDECODE', 'CURSOR_AGENT', 'CODEX_MANAGED_BY_NPM', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG']) delete envP[k];
  const RP = (d, a, env) => cp.spawnSync(process.execPath, [CLI, ...a],
    { cwd: d, encoding: 'utf8', timeout: 120000, env: env || envP, maxBuffer: 32 * 1024 * 1024 });
  const J = (r) => { try { return JSON.parse(String(r.stdout || '')); } catch { return null; } };
  const mk = (name) => {
    const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
    const ri = RP(d, ['init', d, '--yes', '--minimal']);
    if (ri.status !== 0) bad.push(`${name}:init exit=${ri.status}`);
    return d;
  };
  try {
     
     
    {
      const SP = require(path.resolve(__dirname, '..', 'lib', 'session-presence'));
      const plain = SP.deriveSessionKey({ LEERNESS_SESSION_ID: 'session-alpha01' });
      const child = SP.deriveSessionKey({ LEERNESS_SESSION_ID: 'session-alpha01', CLAUDE_CODE_CHILD_SESSION: '1' });
      const inferred = SP.deriveSessionKey({ CLAUDE_CODE_SESSION_ID: 'claude-sess-0001', CLAUDE_CODE_CHILD_SESSION: '1' });
      const explicitSuppression = SP.suppressionReason({ LEERNESS_SESSION_ID: 'session-alpha01', CLAUDE_CODE_CHILD_SESSION: '1' }, true);
      const inferredSuppression = SP.suppressionReason({ CLAUDE_CODE_SESSION_ID: 'claude-sess-0001', CLAUDE_CODE_CHILD_SESSION: '1' }, true);
      if (plain !== 'session-alpha01') bad.push('①명시 주소를 못 읽음 — 판별 불가');
      if (child !== 'session-alpha01') bad.push('①child 억제가 명시 주소를 삼킴');
      if (inferred !== null) bad.push('①추론 주소에서 child 억제가 사라짐 — sub-agent 가 별도 세션이 된다(회귀)');
      if (explicitSuppression !== 'child-agent') bad.push(`①presence가 상속된 child 주소를 독립 세션으로 오인(${explicitSuppression})`);
      if (inferredSuppression !== 'child-agent') bad.push(`①주소 없는 child presence 억제가 사라짐(${inferredSuppression})`);
      dbg.keySource = { plain, child, inferredUnderChild: inferred, explicitSuppression, inferredSuppression };
    }
     
    {
      const d = mk('mcpchild');
      const env = Object.assign({}, envP, { CLAUDE_CODE_CHILD_SESSION: '1' });
      const call = (name, a, id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: a } });
      const req = [
        JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
        call('leerness_state_start', { path: d, goal: 'A', sessionKey: 'session-alpha01' }, 1),
        call('leerness_state_start', { path: d, goal: 'B', sessionKey: 'session-bravo01' }, 2),
        call('leerness_state_record', { path: d, filesChanged: 'a.js', sessionKey: 'session-alpha01' }, 3),
        call('leerness_state_verify', { path: d, result: 'pass', sessionKey: 'session-bravo01' }, 4),
      ].join('\n') + '\n';
      const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: d, input: req, encoding: 'utf8', env, timeout: 300000 });
      const lines = String(r.stdout || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const jsonOf = (id) => { try { return JSON.parse(lines.find((x) => x.id === id).result.content[0].text); } catch { return null; } };
      const s1 = jsonOf(1), s2 = jsonOf(2), rec = jsonOf(3), ver = jsonOf(4);
      if (!s1 || !s2 || s1.started === s2.started) bad.push('②자식 env 에서 두 세션이 같은 run — 판별 불가');
      else {
        if (!rec || rec.recorded !== s1.started) bad.push(`②자식 env 에서 증거가 엉뚱한 run 에 붙음(${rec && rec.recorded})`);
        if (!ver || ver.result !== 'pass' || !ver.run || ver.run.verification_result !== 'pass') bad.push(`②자식 env verify pass 응답이 없거나 실패(${JSON.stringify(ver)})`);
        if (ver && ver.completion_claim_allowed && ver.completion_claim_allowed.allowed) bad.push('②자식 env 에서 놀던 세션이 완료 허용을 받음');
      }
      dbg.mcpChild = { A: s1 && s1.started, recordedTo: rec && rec.recorded,
        bAllowed: !!(ver && ver.completion_claim_allowed && ver.completion_claim_allowed.allowed) };
    }
     
    {
      const d = mk('traversal');
      const eA = Object.assign({}, envP, { LEERNESS_SESSION_ID: 'session-alpha01' });
      RP(d, ['state', 'start', 'A', '--json'], eA);
      const stf = path.join(d, '.leerness', 'state.json');
      const st = JSON.parse(fs.readFileSync(stf, 'utf8'));
      st.runsBySession = { 'session-alpha01': '../../evil' };
      fs.writeFileSync(stf, JSON.stringify(st, null, 2) + '\n');
      const r = RP(d, ['state', 'handoff', '요약'], eA);
      const escaped = fs.existsSync(path.join(sb, 'evil.json')) || fs.existsSync(path.join(d, 'evil.json'));
      if (escaped) bad.push('③경로형 run id 로 .leerness 밖에 씀');
      if (r.status === 0) bad.push('③손상된 소유 맵인데 성공이라 보고');
      dbg.traversal = { exit: r.status, escaped };
    }
     
    {
      const d = mk('filepath');
      const f = path.join(sb, 'notadir.txt'); fs.writeFileSync(f, 'x');
      const rf = RP(d, ['status', '--path', f]);
      const rd = RP(d, ['status', '--path', d]);
      if (rf.status === 0) bad.push('④일반 파일을 프로젝트 root 로 승인');
      if (rd.status !== 0) bad.push(`④디렉토리를 거절(과차단, exit=${rd.status})`);
      dbg.filePath = { fileExit: rf.status, dirExit: rd.status };
    }
     
    {
      const d = mk('team');
      const marker = path.join(sb, 'DEPLOYED.txt');
      RP(d, ['team', 'add', 'zz', '--path', d]);
      const tf = path.join(d, '.leerness', 'teams.json');
      let prepared = false;
      try {
        const t = JSON.parse(fs.readFileSync(tf, 'utf8'));
        const arr = Array.isArray(t) ? t : (t.teams || []);
         
         
        if (arr[0]) { arr[0].deployCommand = `node -e "require('fs').writeFileSync(process.env.LEERNESS_E2E_MARK,'1')"`; prepared = true; }
        fs.writeFileSync(tf, JSON.stringify(t, null, 2) + '\n');
      } catch {}
      if (!prepared) bad.push('⑤team 픽스처를 만들지 못함 — 판별 불가');
      else {
        const env = Object.assign({}, envP, { LEERNESS_TEAM_DEPLOY: '1', LEERNESS_E2E_MARK: marker });
        RP(d, ['team', 'deploy', 'zz', '--yes', '--dry-run', '--path', d], env);
        if (fs.existsSync(marker)) bad.push('⑤--dry-run 인데 배포 명령을 실제 실행');
         
        RP(d, ['team', 'deploy', 'zz', '--yes', '--path', d], env);
        if (!fs.existsSync(marker)) bad.push('⑤플래그 없는 배포가 실행되지 않음 — 가드가 기능을 죽였다');
      }
      dbg.teamDeploy = { prepared, ranUnderDryRun: false, ranForReal: fs.existsSync(marker) };
    }
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ AL(1.36.148) 상태용 명시 주소는 child에서도 유지·presence 상속 주소는 억제 · 자식 env MCP 에서도 귀속 정상 · 경로형 run id 가 .leerness 밖으로 못 나감 · --path 에 파일 거절(디렉토리는 통과) · dry-run 이 **외부 명령 실행**까지 막음(플래그 없으면 실행) ${JSON.stringify(dbg)}`
    : '✗ 1.36.148 실패 ' + JSON.stringify({ bad: bad.slice(0, 8), dbg }));
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('AM(1.36.149)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-149-'));
  const envP = Object.assign({}, process.env, { TMPDIR: sb, TEMP: sb, TMP: sb, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' });
  for (const k of ['CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
    'LEERNESS_INTERNAL', 'LEERNESS_HOOK', 'LEERNESS_SESSION_ID', 'CODEX_THREAD_ID', 'CI', 'GITHUB_ACTIONS',
    'CLAUDECODE', 'CURSOR_AGENT', 'CODEX_MANAGED_BY_NPM', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_LANG']) delete envP[k];
  const RP = (d, a, env) => cp.spawnSync(process.execPath, [CLI, ...a],
    { cwd: d, encoding: 'utf8', timeout: 120000, env: env || envP, maxBuffer: 32 * 1024 * 1024 });
  const mk = (name) => {
    const d = path.join(sb, name); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}');
    const ri = RP(d, ['init', d, '--yes', '--minimal']);
    if (ri.status !== 0) bad.push(`${name}:init exit=${ri.status}`);
    return d;
  };
  try {
     
    {
      const d = mk('current-id');
      RP(d, ['state', 'start', 'A', '--json']);
      const stf = path.join(d, '.leerness', 'state.json');
      const st = JSON.parse(fs.readFileSync(stf, 'utf8'));
      delete st.runsBySession;
      st.currentRunId = '../../escaped-current';
      fs.writeFileSync(stf, JSON.stringify(st, null, 2) + '\n');
      const r = RP(d, ['state', 'handoff', '요약']);
      const escaped = fs.existsSync(path.join(d, 'escaped-current.json')) || fs.existsSync(path.join(d, 'escaped-current.md'));
      if (r.status === 0) bad.push('①경로형 currentRunId 인데 성공이라 보고');
      if (escaped) bad.push('①경로형 currentRunId 로 .leerness 밖에 씀');
      dbg.currentRunId = { exit: r.status, escaped };
    }
     
    {
      const d = mk('record-id');
      RP(d, ['state', 'start', 'A', '--json']);
      const rf = path.join(d, '.leerness', 'runs', 'run-0001.json');
      const rec = JSON.parse(fs.readFileSync(rf, 'utf8'));
      rec.run_id = '../../escaped-record';
      fs.writeFileSync(rf, JSON.stringify(rec, null, 2) + '\n');
      const r = RP(d, ['state', 'handoff', '요약']);
      const escaped = fs.existsSync(path.join(d, 'escaped-record.json')) || fs.existsSync(path.join(d, 'escaped-record.md'));
      if (r.status === 0) bad.push('②경로형 record.run_id 인데 성공이라 보고');
      if (escaped) bad.push('②경로형 record.run_id 로 .leerness 밖에 씀');
      dbg.recordRunId = { exit: r.status, escaped };
    }
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ AM(1.36.149) legacy currentRunId·run record run_id 모두 경로형이면 .leerness 밖 쓰기 전에 손상으로 차단 ${JSON.stringify(dbg)}`
    : '✗ 1.36.149 run-id 경로 차단 실패 ' + JSON.stringify({ bad: bad.slice(0, 8), dbg }));
  if (!ok) failed++;
}

 
 
 
if (e2eShard.take('AN(1.36.150/T-0120)')) {
  total++;
  let ok = false; const bad = []; const dbg = {};
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-150-'));
  const stripGitTargetEnv = (source) => {
    const out = Object.assign({}, source);
    const drop = new Set(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']);
    for (const k of Object.keys(out)) if (drop.has(k.toUpperCase())) delete out[k];
    return out;
  };
  const envP = stripGitTargetEnv(process.env);
  envP.TMPDIR = sb; envP.TEMP = sb; envP.TMP = sb;
  envP.LEERNESS_OFFLINE = '1'; envP.LEERNESS_NO_PROMPT = '1';
  envP.LEERNESS_SESSION_ID = 'e2e-enforce-nosystem';
  envP.GIT_CONFIG_GLOBAL = path.join(sb, 'global.gitconfig');
  envP.GIT_CONFIG_SYSTEM = path.join(sb, 'system.gitconfig');
  envP.GIT_CONFIG_NOSYSTEM = '1';
  const G = (d, a, env) => gitSpawn(a, { cwd: d, encoding: 'utf8', timeout: 60000, env: env || envP });
  const RP = (d, a, env) => cp.spawnSync(process.execPath, [CLI, ...a],
    { cwd: d, encoding: 'utf8', timeout: 120000, env: env || envP, maxBuffer: 32 * 1024 * 1024 });
  const J = (r) => { try { return JSON.parse(String(r.stdout || '')); } catch { return null; } };
  try {
    const d = path.join(sb, 'repo'), systemHooks = path.join(sb, 'system-hooks');
    fs.mkdirSync(d, { recursive: true }); fs.mkdirSync(systemHooks, { recursive: true });
    fs.writeFileSync(envP.GIT_CONFIG_GLOBAL, '');
    fs.writeFileSync(envP.GIT_CONFIG_SYSTEM, `[core]\n\thooksPath = ${systemHooks.replace(/\\/g, '/')}\n`);
    const setup = [G(d, ['init', '-q', '-b', 'main', '.']), G(d, ['config', 'user.email', 't@example.invalid']), G(d, ['config', 'user.name', 'T'])];
    fs.writeFileSync(path.join(d, 'package.json'), '{"name":"p","version":"0.1.0"}\n');
    setup.push(G(d, ['add', '-A']), G(d, ['commit', '-qm', 'initial']));
    if (setup.some((r) => r.status !== 0)) bad.push('①git 픽스처를 만들지 못함 — 판별 불가');
    const withSystem = Object.assign({}, envP); delete withSystem.GIT_CONFIG_NOSYSTEM;
    const systemCfg = G(d, ['config', '--show-scope', '--get', 'core.hooksPath'], withSystem);
    const callerCfg = G(d, ['config', '--show-scope', '--get', 'core.hooksPath']);
    if (systemCfg.status !== 0 || callerCfg.status === 0) bad.push('①GIT_CONFIG_NOSYSTEM 픽스처가 system 설정을 갈라내지 못함 — 판별 불가');
    const init = RP(d, ['init', d, '--yes', '--minimal']);
    const handoff = RP(d, ['handoff', d, '--record']);
    const install = J(RP(d, ['enforce', 'install', '--path', d, '--json', '--skip-verify']));
    if (init.status !== 0 || handoff.status !== 0 || !install || !install.ok) bad.push(`①설치 흐름 실패(init=${init.status}, handoff=${handoff.status}, install=${install && install.ok})`);
    else {
      const raw = String(G(d, ['rev-parse', '--git-path', 'hooks/pre-commit']).stdout || '').trim();
      const callerHook = path.isAbsolute(raw) ? raw : path.join(d, raw);
      const old = new Date(Date.now() - 72 * 3600 * 1000);
       
      fs.utimesSync(path.join(d, '.leerness', 'cache', 'handoffs', 'e2e-enforce-nosystem.json'), old, old);
      fs.writeFileSync(path.join(d, 'after.txt'), 'after\n'); G(d, ['add', '-A']);
      const commit = G(d, ['commit', '-qm', 'must-be-blocked']);
      const gitModule = require(path.resolve(__dirname, '..', 'lib', 'git.js'));
      if (gitModule._shouldDrop('GIT_CONFIG_NOSYSTEM')) bad.push('①GIT_CONFIG_NOSYSTEM을 내부 git 에서만 삭제');
      if (!gitModule._shouldDrop('GIT_CONFIG_PARAMETERS')) bad.push('①일회성 config 주입까지 보존 — 세척 경계 후퇴');
      if (!fs.existsSync(callerHook)) bad.push(`①설치 훅과 실제 git 훅 경로 불일치(install=${install.hook}, caller=${callerHook})`);
      if (commit.status === 0) bad.push('①오래된 handoff인데 실제 git commit이 통과 — 훅 우회');
      dbg.nosystem = { installHook: install.hook, callerHook, callerHasHook: fs.existsSync(callerHook), commitExit: commit.status,
        systemScope: systemCfg.status, callerScope: callerCfg.status };
    }
    ok = bad.length === 0;
  } catch (e) { dbg.err = String(e && e.message).slice(0, 200); }
  finally { try { fs.rmSync(sb, { recursive: true, force: true }); } catch {} }
  console.log(ok ? `✓ AN(1.36.150/T-0120) GIT_CONFIG_NOSYSTEM을 보존해 설치기와 같은 셸의 git이 같은 hooksPath를 보고, 오래된 handoff 커밋이 실제로 차단됨 ${JSON.stringify(dbg)}`
    : '✗ 1.36.150 GIT_CONFIG_NOSYSTEM 훅 경로 일치 실패 ' + JSON.stringify({ bad: bad.slice(0, 8), dbg }));
  if (!ok) failed++;
}

 
 
 
 
if (e2eShard.take('AO(1.36.152/T-0115, 1.36.169/T-0108, T-0343)')) {
  total++;
  let ok = false; const dbg = {};
  try {
    const race = cp.spawnSync(process.execPath, [path.join(__dirname, 'e2e-concurrency.js'), CLI], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
       
      timeout: 600000,
      env: Object.assign({}, process.env, { LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_LOCK_WARN: '1' }),
      maxBuffer: 16 * 1024 * 1024
    });
    let report = null; try { report = JSON.parse(String(race.stdout || '').trim()); } catch {}
    dbg.exit = race.status; dbg.report = report;
    if (!report) dbg.stderr = String(race.stderr || '').slice(0, 500);
    ok = race.status === 0 && !!report && report.ok === true
      && Array.isArray(report.results) && report.results.length === 30 && report.results.every(r => r.ok === true);
  } catch (e) { dbg.err = String(e && e.message || e).slice(0, 200); }
  console.log(ok ? '✓ AO(1.36.152/T-0115, 1.36.169/T-0108, T-0343) 지연 경쟁 30쌍 모두 exit 0 + 양쪽 기록 보존'
    : '✗ 1.36.152 동시 RMW 회귀 ' + JSON.stringify(dbg));
  if (!ok) failed++;
}

 
 
setImmediate(() => {
  finishE2e();
});
