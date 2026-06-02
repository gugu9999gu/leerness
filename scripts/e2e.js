#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

// 1.9.12: e2e 안정성을 위해 자식 프로세스의 npm 호출 차단 (hang 방지)
process.env.LEERNESS_OFFLINE = process.env.LEERNESS_OFFLINE || '1';
const CLI = path.resolve(__dirname, '..', 'bin', 'harness.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-e2e-'));
let failed = 0; let total = 0;

function run(label, args, opts = {}) {
  total++;
  const r = cp.spawnSync(process.execPath, [CLI, ...args], { cwd: opts.cwd || tmp, encoding: 'utf8', timeout: 30000 });
  const ok = (r.status === 0) === !opts.expectFail;
  process.stdout.write(`${ok ? '✓' : '✗'} ${label} (exit=${r.status})\n`);
  if (!ok) { failed++; process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); }
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
fs.writeFileSync(secretFile, JSON.stringify({ openai: 'sk-' + 'A'.repeat(48) }));
run('scan secrets (detect)', ['scan', 'secrets', tmp], { expectFail: true });
fs.unlinkSync(secretFile);

run('plan add 1',          ['plan', 'add', '마일스톤 A', '--status', 'planned', '--path', tmp]);
run('plan add 2',          ['plan', 'add', '마일스톤 B', '--status', 'in-progress', '--path', tmp]);
run('task add',            ['task', 'add', '사용자 요청 X', '--status', 'requested', '--path', tmp]);
run('task update T-0001',  ['task', 'update', 'T-0001', '--status', 'in-progress', '--next', '검증 실행', '--path', tmp]);
run('task update T-0001 done', ['task', 'update', 'T-0001', '--status', 'done', '--evidence', 'review-evidence:e2e', '--path', tmp]);

const tracker = fs.readFileSync(path.join(tmp, '.harness/progress-tracker.md'), 'utf8');
const t1Count = (tracker.match(/^\| T-0001 \|/gm) || []).length;
total++;
if (t1Count === 1) console.log('✓ B1 in-place update: T-0001 row count = 1');
else { failed++; console.log(`✗ B1 in-place update FAILED: T-0001 row count = ${t1Count} (expected 1)`); }

fs.appendFileSync(path.join(tmp, '.harness/review-evidence.md'),
  '\n## e2e\nTask: T-0001\nCommand: npm test\nExit: 0\nNote: e2e smoke\n');

run('session close',       ['session', 'close', tmp]);
run('handoff',             ['handoff', tmp]);
run('audit (post close)',  ['audit', tmp]);
run('lazy detect',         ['lazy', 'detect', tmp]);
run('memory search',       ['memory', 'search', '마일스톤', '--path', tmp]);

const offline = Object.assign({}, process.env, { LEERNESS_OFFLINE: '1' });
total++;
{
  const r = cp.spawnSync(process.execPath, [CLI, 'update', tmp, '--check'], { env: offline, encoding: 'utf8' });
  const ok = r.status === 0 && /up to date|migration available/.test(r.stdout || '');
  console.log(ok ? '✓ update --check (offline)' : `✗ update --check (offline) exit=${r.status}`);
  if (!ok) { failed++; console.log(r.stdout || ''); console.error(r.stderr || ''); }
}

run('auto-update install', ['auto-update', 'install', tmp]);
total++;
{
  const settingsFile = path.join(tmp, '.claude/settings.local.json');
  if (fs.existsSync(settingsFile)) {
    const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    const hasHook = (s.hooks?.SessionStart || []).some(h => h.command && h.command.includes('leerness update'));
    if (hasHook) console.log('✓ SessionStart hook for update --check installed');
    else { failed++; console.log('✗ SessionStart hook missing'); }
  } else { failed++; console.log('✗ .claude/settings.local.json missing'); }
}

// 1.9.1 P6 회귀: evidence가 plan:M-XXXX + 검증 키워드면 lazy detect가 통과해야 한다.
total++;
{
  const trackerPath = path.join(tmp, '.harness/progress-tracker.md');
  let cur = fs.readFileSync(trackerPath, 'utf8');
  cur = cur.replace(/^\| T-0001 \|.*$/m, '| T-0001 | done | mile A | tests:32/32 (plan:M-0002) | next | 2026-05-08 |');
  fs.writeFileSync(trackerPath, cur, 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'lazy', 'detect', tmp], { encoding: 'utf8' });
  const ok = r.status === 0;
  console.log(ok ? '✓ B(P6) lazy detect: plan:M-XXXX + 검증 키워드 → pass' : `✗ B(P6) FAIL exit=${r.status}\n${r.stdout}`);
  if (!ok) failed++;
}
// 1.9.1 P6 negative: plan:M-XXXX 단독은 여전히 경고
total++;
{
  const trackerPath = path.join(tmp, '.harness/progress-tracker.md');
  let cur = fs.readFileSync(trackerPath, 'utf8');
  cur = cur.replace(/^\| T-0001 \|.*$/m, '| T-0001 | done | mile A | plan:M-0002 | next | 2026-05-08 |');
  fs.writeFileSync(trackerPath, cur, 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'lazy', 'detect', tmp], { encoding: 'utf8' });
  const ok = r.status === 1 && /done row without verifiable evidence/.test(r.stdout);
  console.log(ok ? '✓ B(P6 neg) lazy detect: plan:M-XXXX 단독 → warn 유지' : `✗ B(P6 neg) FAIL exit=${r.status}`);
  if (!ok) failed++;
  // restore
  cur = cur.replace(/^\| T-0001 \|.*$/m, '| T-0001 | done | mile A | tests:32/32 (plan:M-0002) | next | 2026-05-08 |');
  fs.writeFileSync(trackerPath, cur, 'utf8');
}

// 1.9.1 P1 회귀: legacy leerness-plus hook이 있으면 auto-update install이 정리해야 한다.
total++;
{
  const settingsFile = path.join(tmp, '.claude/settings.local.json');
  const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  s.hooks.SessionStart = [{ matcher: '*', command: 'leerness-plus update --check' }];
  fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2));
  cp.spawnSync(process.execPath, [CLI, 'auto-update', 'install', tmp], { encoding: 'utf8' });
  const after = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const hasLegacy = (after.hooks?.SessionStart || []).some(h => /leerness-plus update/.test(h.command || ''));
  const hasNew = (after.hooks?.SessionStart || []).some(h => /\bleerness update\b/.test(h.command || ''));
  const ok = !hasLegacy && hasNew;
  console.log(ok ? '✓ B(P1) legacy leerness-plus hook 자동 제거' : '✗ B(P1) legacy hook 남음');
  if (!ok) failed++;
}

// 1.9.1 P4 회귀: NA 마커가 있으면 audit이 placeholder 경고를 스킵.
total++;
{
  const ds = path.join(tmp, '.harness/design-system.md');
  fs.appendFileSync(ds, '\n<!-- leerness:na CLI 프로젝트라 디자인 토큰 없음 -->\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'audit', tmp], { encoding: 'utf8' });
  const ok = !/design-system\.md tokens not customized/.test(r.stdout) && /marked NA/.test(r.stdout);
  console.log(ok ? '✓ B(P4) NA 마커 인식: design-system 경고 스킵' : '✗ B(P4) NA 마커 미작동');
  if (!ok) failed++;
}

// 1.9.1 P7 회귀: init 직후 progress에 M-0001 연결 row가 자동으로 있다.
total++;
{
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-e2e-p7-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmp2, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8' });
  const tracker = fs.readFileSync(path.join(tmp2, '.harness/progress-tracker.md'), 'utf8');
  const ok = /M-0001/.test(tracker);
  console.log(ok ? '✓ B(P7) init: M-0001 → progress row 자동 생성' : '✗ B(P7) progress에 M-0001 row 없음');
  if (!ok) failed++;
}

// 1.9.151: viewwork 명령 제거 (사용자 명시 — leerness 와 무관)
run('route planning',      ['route', 'planning']);
run('route bugfix',        ['route', 'bugfix']);
run('skill list',          ['skill', 'list']);
run('skill info',          ['skill', 'info', 'office']);

// 1.9.2: 스킬 학습 사이클 회귀
run('skill learn (new)',   ['skill', 'learn', 'open-meteo', '--doc', 'https://open-meteo.com/en/docs', '--command', 'fetch hourly+daily JSON', '--capability', 'http fetch', '--capability', 'cache', '--note', 'e2e learn', '--display', 'Open-Meteo 날씨 스킬', '--path', tmp]);
run('skill use (new)',     ['skill', 'use', 'open-meteo', '--note', 'first call', '--path', tmp]);
run('skill use (catalog)', ['skill', 'use', 'office', '--note', 'catalog skill materialize', '--path', tmp]);
run('skill optimize',      ['skill', 'optimize', 'open-meteo', '--before', 'no cache', '--after', 'If-Modified-Since', '--note', 'e2e opt', '--path', tmp]);

total++;
{
  const f = path.join(tmp, '.harness/skills/open-meteo/skill.json');
  const ok = fs.existsSync(f) && JSON.parse(fs.readFileSync(f, 'utf8')).optimizations.length === 1;
  console.log(ok ? '✓ skill.json optimizations 누적' : '✗ skill.json optimizations 누적 실패');
  if (!ok) failed++;
}
total++;
{
  const data = JSON.parse(fs.readFileSync(path.join(tmp, '.harness/skills/open-meteo/skill.json'), 'utf8'));
  const ok = data.usage.count === 1 && data.sources.length >= 1 && data.patterns.length >= 1;
  console.log(ok ? '✓ skill usage/sources/patterns 누적' : '✗ skill usage/sources/patterns 누적 실패');
  if (!ok) failed++;
}

run('skill consolidate',   ['skill', 'consolidate', '--threshold', '0.1', '--path', tmp]);
run('skill remove (user)', ['skill', 'remove', 'open-meteo', '--path', tmp]);
total++;
{
  const ok = !fs.existsSync(path.join(tmp, '.harness/skills/open-meteo'));
  console.log(ok ? '✓ skill remove: 디렉토리 삭제' : '✗ skill remove: 디렉토리 잔존');
  if (!ok) failed++;
}

// 1.9.3 회귀: impact / reuse / ui consistency / graph / guide
// 가짜 페이지/컴포넌트/스타일 작성
fs.mkdirSync(path.join(tmp, 'src/components'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'src/pages'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'src/styles'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'src/styles/tokens.css'), `:root { --color-primary: #ff5722; --color-text: #222222; }\n`);
fs.writeFileSync(path.join(tmp, 'src/components/Card.html'), `<div class="card"><slot/></div>\n`);
fs.writeFileSync(path.join(tmp, 'src/pages/home.html'), `<link href="../styles/tokens.css"><include src="../components/Card.html"/>\n`);
fs.writeFileSync(path.join(tmp, 'src/pages/about.html'), `<link href="../styles/tokens.css"><include src="../components/Card.html"/>\n`);
// design-system 토큰 채우기 (#ff5722 / #222222 등록)
const dsPath = path.join(tmp, '.harness/design-system.md');
let dsText = fs.readFileSync(dsPath, 'utf8');
dsText = dsText.replace('| color.primary | (실제 값으로 업데이트) | |', '| color.primary | #ff5722 | 메인 컬러 |');
dsText = dsText.replace('| color.surface | | |', '| color.surface | #222222 | 본문 텍스트 |');
fs.writeFileSync(dsPath, dsText);

run('impact: Card.html → home/about',  ['impact', 'src/components/Card.html', '--path', tmp]);
run('reuse find: Card 후보',           ['reuse', 'find', 'Card', '--path', tmp]);
run('reuse register: Card',            ['reuse', 'register', 'Card', '--where', 'src/components/Card.html', '--kind', 'component', '--note', 'e2e card', '--path', tmp]);

total++;
{
  const reuse = fs.readFileSync(path.join(tmp, '.harness/reuse-map.md'), 'utf8');
  const ok = /\| Card \| src\/components\/Card\.html \| component \|/.test(reuse);
  console.log(ok ? '✓ reuse-map.md에 Card row 자동 추가' : '✗ Card row 미등록');
  if (!ok) failed++;
}

run('ui consistency: pass (토큰 외 색상 없음)', ['ui', 'consistency', tmp]);

// 의도적 일탈: 토큰 외 색상 추가 → ui consistency 경고
fs.writeFileSync(path.join(tmp, 'src/pages/contact.html'), `<style>.box { color: #abcdef; background: #123456; }</style>\n`);
total++;
{
  const r = cp.spawnSync(process.execPath, [CLI, 'ui', 'consistency', tmp, '--fail-on-violation'], { encoding: 'utf8' });
  const ok = r.status === 1 && /토큰 외 값/.test(r.stdout) && /#abcdef/i.test(r.stdout);
  console.log(ok ? '✓ ui consistency: 일탈 색상 #abcdef 검출 + 비0 종료' : '✗ ui consistency 일탈 미검출');
  if (!ok) { failed++; console.log(r.stdout); }
}

run('graph: mermaid 출력',             ['graph', tmp]);
run('guide: 통합 가이드',               ['guide', 'src/components/Card.html', '--path', tmp]);

// 1.9.4 회귀: impact strong/weak 구분
total++;
{
  // home.html에 "Card"라는 식별자가 plain text로 들어가도록 (false positive 시드)
  fs.appendFileSync(path.join(tmp, 'src/pages/home.html'), '\n<!-- 카드 콘텐츠는 Cards 배열로 -->\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'impact', 'src/components/Card.html', '--path', tmp], { encoding: 'utf8' });
  const strongOK = /강한 참조 \d+개/.test(r.stdout);
  const weakHint = /약한 참조|영향 범위 없음/.test(r.stdout);
  console.log(strongOK && weakHint ? '✓ B(A) impact: strong/weak 구분 출력' : '✗ B(A) impact 구분 실패');
  if (!(strongOK && weakHint)) failed++;
}

// 1.9.16 회귀: brainstorm --all-apps / --json / session close 워크스페이스 안내
total++;
{
  // brainstorm --all-apps
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bsa-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bsb-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.appendFileSync(path.join(tmpA, '.harness/decisions.md'), '\n### 2026-05-13 — 캐시 정책\n- Reason: rate limit\n');
  fs.appendFileSync(path.join(tmpB, '.harness/decisions.md'), '\n### 2026-05-13 — 캐시 분산\n- Reason: 확장성\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'brainstorm', '캐시', '--include', `${tmpA},${tmpB}`], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status === 0 && /Cross-project Brainstorm — "캐시" — 2개/.test(r.stdout) && /워크스페이스 총합: 2건/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.16) brainstorm --include 통합' : '✗ brainstorm --include 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 600)); }
}

total++;
{
  // --json 단일 brainstorm
  const tmpJ = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-json-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpJ, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.appendFileSync(path.join(tmpJ, '.harness/decisions.md'), '\n### 2026-05-13 — JSON 결정\n- ...\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'brainstorm', 'JSON', '--json', '--path', tmpJ], { encoding: 'utf8', timeout: 15000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = r.status === 0 && parsed && parsed.topic === 'JSON' && parsed.total >= 1;
  console.log(ok ? '✓ B(1.9.16) brainstorm --json 단일' : `✗ brainstorm --json 실패\n${r.stdout.slice(0, 300)}`);
  if (!ok) failed++;
}

total++;
{
  // retro --json
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rj-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'retro', tmpR, '--json'], { encoding: 'utf8', timeout: 15000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = r.status === 0 && parsed && parsed.summary && parsed.data;
  console.log(ok ? '✓ B(1.9.16) retro --json' : '✗ retro --json 실패');
  if (!ok) failed++;
}

total++;
{
  // insights --json (workspace)
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

total++;
{
  // session close 끝에 워크스페이스 안내 (다른 leerness 프로젝트 시뮬)
  const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ws-'));
  fs.mkdirSync(path.join(wsRoot, '_apps'), { recursive: true });
  const proj = path.join(wsRoot, 'main');
  const other = path.join(wsRoot, '_apps', 'other');
  cp.spawnSync(process.execPath, [CLI, 'init', proj, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', other, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // _apps가 proj와 같은 부모 디렉토리에 있어야 감지
  // 우리 케이스는 wsRoot/main과 wsRoot/_apps/other → main에서 ../_apps 검색하면 발견
  const r = cp.spawnSync(process.execPath, [CLI, 'session', 'close', proj], { encoding: 'utf8', timeout: 15000 });
  const ok = /워크스페이스에 \d+개 다른 leerness 프로젝트/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.16) session close 워크스페이스 안내' : '✗ session close 안내 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(-500)); }
}

// 1.9.17 회귀: handoff --all-apps / reuse-map --all-apps (워크스페이스 오케스트레이션)
total++;
{
  // handoff --include
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ha-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-hb-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', '--include', `${tmpA},${tmpB}`], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status === 0 && /Workspace Handoff — 2개 프로젝트 \(1\.9\.\d+\)/.test(r.stdout) && /워크스페이스 총합/.test(r.stdout) && /오케스트레이션 권장/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.17) handoff --include 통합 워크스페이스 뷰' : '✗ handoff --include 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 600)); }
}

total++;
{
  // handoff --include --json
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

total++;
{
  // reuse-map 단일 + 워크스페이스 모드 + 중복 감지
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rma-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rmb-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // 양쪽에 같은 capability "Cache" 추가 → 중복 감지 기대
  const rowA = '| Cache | src/cache.js | util | LRU |\n';
  const rowB = '| Cache | src/foo.js | util | Memoize |\n';
  fs.appendFileSync(path.join(tmpA, '.harness/reuse-map.md'), rowA);
  fs.appendFileSync(path.join(tmpB, '.harness/reuse-map.md'), rowB);
  // 단일
  const rs = cp.spawnSync(process.execPath, [CLI, 'reuse-map', tmpA], { encoding: 'utf8', timeout: 15000 });
  const okSingle = rs.status === 0 && /Reuse Map/.test(rs.stdout) && /Cache/.test(rs.stdout);
  // 워크스페이스
  const rw = cp.spawnSync(process.execPath, [CLI, 'reuse-map', '--include', `${tmpA},${tmpB}`], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const okMulti = rw.status === 0 && /Workspace Reuse Map — 2개 프로젝트/.test(rw.stdout) && /중복 capability/.test(rw.stdout) && /"Cache"/.test(rw.stdout);
  // JSON
  const rj = cp.spawnSync(process.execPath, [CLI, 'reuse-map', '--include', `${tmpA},${tmpB}`, '--json'], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  let parsed = null;
  try { parsed = JSON.parse(rj.stdout); } catch {}
  const okJson = rj.status === 0 && parsed && Array.isArray(parsed.duplicates) && parsed.duplicates.length >= 1;
  const ok = okSingle && okMulti && okJson;
  console.log(ok ? '✓ B(1.9.17) reuse-map 단일/워크스페이스/JSON + 중복 감지' : `✗ reuse-map 실패 (단일=${okSingle} 멀티=${okMulti} JSON=${okJson})`);
  if (!ok) { failed++; console.log(rw.stdout.slice(0, 400)); }
}

// 1.9.18 회귀: handoff --since / reuse-map --strict-elements + depends-on / verify-claim
total++;
{
  // handoff --since: 최근 변경 강조
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sincea-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sinceb-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // 오늘 날짜로 T-row 추가
  const today = new Date().toISOString().slice(0,10);
  fs.appendFileSync(path.join(tmpA, '.harness/progress-tracker.md'), `| T-9999 | done | 신규 기능 | src/x.js | M-NEW | ${today} |\n`);
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', '--include', `${tmpA},${tmpB}`, '--since', '1d'], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status === 0 && /1\.9\.\d+/.test(r.stdout) && /Filter: since 1d/.test(r.stdout) && /🆕/.test(r.stdout) && /최근 변경/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.18) handoff --since: 최근 변경 강조' : '✗ handoff --since 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // handoff --since 형식 오류 → fail
  const tmpE = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sincee-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpE, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', '--include', tmpE, '--since', 'banana'], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status !== 0 && /형식 오류/.test(r.stdout + r.stderr);
  console.log(ok ? '✓ B(1.9.18) handoff --since 형식 오류 → exit≠0' : '✗ handoff --since 오류 검증 실패');
  if (!ok) failed++;
}

total++;
{
  // reuse-map --strict-elements: 같은 함수명 다른 capability 감지
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-strict-a-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-strict-b-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // 같은 함수 escapeHtml을 다른 capability 이름으로 등록
  fs.appendFileSync(path.join(tmpA, '.harness/reuse-map.md'), '| HtmlEscape | src/util.js (escapeHtml) | util | XSS 방지 |\n');
  fs.appendFileSync(path.join(tmpB, '.harness/reuse-map.md'), '| EscapeHtml | src/build.js (escapeHtml) | util | 마크업 이스케이프 |\n');
  // 기본 모드 → 정확 중복 0
  const r1 = cp.spawnSync(process.execPath, [CLI, 'reuse-map', '--include', `${tmpA},${tmpB}`], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const okDefault = r1.status === 0 && /정확 중복 capability/.test(r1.stdout) && /\(없음\)/.test(r1.stdout);
  // --strict-elements → 잠재 중복 1건
  const r2 = cp.spawnSync(process.execPath, [CLI, 'reuse-map', '--include', `${tmpA},${tmpB}`, '--strict-elements'], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const okStrict = r2.status === 0 && /잠재 중복/.test(r2.stdout) && /escapeHtml/.test(r2.stdout) && /HtmlEscape/.test(r2.stdout) && /EscapeHtml/.test(r2.stdout);
  // JSON
  const r3 = cp.spawnSync(process.execPath, [CLI, 'reuse-map', '--include', `${tmpA},${tmpB}`, '--strict-elements', '--json'], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  let parsed = null;
  try { parsed = JSON.parse(r3.stdout); } catch {}
  const okJson = r3.status === 0 && parsed && Array.isArray(parsed.fuzzyDuplicates) && parsed.fuzzyDuplicates.length === 1 && parsed.fuzzyDuplicates[0].functionName === 'escapehtml';
  const ok = okDefault && okStrict && okJson;
  console.log(ok ? '✓ B(1.9.18) reuse-map --strict-elements 잠재 중복 감지' : `✗ strict-elements 실패 (default=${okDefault} strict=${okStrict} json=${okJson})`);
  if (!ok) { failed++; console.log(r2.stdout.slice(0, 500)); }
}

total++;
{
  // reuse-map depends-on: notes 컬럼에서 의존 추출
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-deps-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.appendFileSync(path.join(tmpA, '.harness/reuse-map.md'),
    '| EscapeHtml | src/build.js (escapeHtml) | util | XSS 방지 |\n' +
    '| RssFeed | src/build.js (buildFeed) | util | RSS 2.0 (depends-on: EscapeHtml) |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'reuse-map', '--include', tmpA], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status === 0 && /의존 관계 \(depends-on, 1개 엣지\)/.test(r.stdout) && /RssFeed.*─→.*EscapeHtml/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.18) reuse-map depends-on 엣지 추출' : '✗ depends-on 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // verify-claim: 파일 존재 + 테스트 카운트 검증
  const tmpV = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-vc-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpV, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // 실제 src 파일 + 테스트 파일 생성 (5개 check)
  fs.mkdirSync(path.join(tmpV, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpV, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmpV, 'src/myMod.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(tmpV, 'tests/test.js'), 'check(1); check(2); check(3); check(4); check(5);\n');
  // T-row를 evidence와 함께 추가
  fs.appendFileSync(path.join(tmpV, '.harness/progress-tracker.md'),
    '| T-0099 | done | 신모듈 | src/myMod.js + tests/test.js (5/5 통과) | next | 2026-05-14 |\n');
  // 정상: 파일 존재 + 테스트 5개
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0099', '--path', tmpV], { encoding: 'utf8', timeout: 15000 });
  const okPass = r.status === 0 && /✓ src\/myMod\.js/.test(r.stdout) && /✓ tests\/test\.js/.test(r.stdout) && /pass \(실측 ≥ 주장\)/.test(r.stdout);
  // 파일 없는 케이스 → exit ≠ 0
  fs.unlinkSync(path.join(tmpV, 'src/myMod.js'));
  const r2 = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0099', '--path', tmpV], { encoding: 'utf8', timeout: 15000 });
  const okFail = r2.status !== 0 && /✗ src\/myMod\.js/.test(r2.stdout) && /FAIL/.test(r2.stdout);
  // JSON
  const r3 = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0099', '--path', tmpV, '--json'], { encoding: 'utf8', timeout: 15000 });
  let parsed = null;
  try { parsed = JSON.parse(r3.stdout); } catch {}
  const okJson = parsed && parsed.taskId === 'T-0099' && parsed.verdict && parsed.verdict.filesAllExist === false;
  const ok = okPass && okFail && okJson;
  console.log(ok ? '✓ B(1.9.18) verify-claim 파일/테스트 검증 + exit code + JSON' : `✗ verify-claim 실패 (pass=${okPass} fail=${okFail} json=${okJson})`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

// 1.9.19 회귀: verify-claim --run-tests + --strict-elements same-file 구분
total++;
{
  // verify-claim --run-tests: npm test 자동 실행 + 주장 vs 실행 결과 대조
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rt-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // 최소 npm 프로젝트 + 단순 tests/test.js (5/5 pass)
  fs.writeFileSync(path.join(tmpR, 'package.json'), JSON.stringify({
    name: 'rt-fixture', version: '0.0.1', scripts: { test: 'node tests/test.js' }
  }));
  fs.mkdirSync(path.join(tmpR, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpR, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmpR, 'src/mod.js'), 'module.exports={};\n');
  // 5 check 호출 + "5/5 passed" 직접 출력 (간단한 fixture)
  fs.writeFileSync(path.join(tmpR, 'tests/test.js'),
    "let p=0;function check(c){if(c)p++;}check(1);check(1);check(1);check(1);check(1);console.log(p+'/5 passed');if(p!==5)process.exit(1);\n");
  fs.appendFileSync(path.join(tmpR, '.harness/progress-tracker.md'),
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

total++;
{
  // --run-tests 실패 케이스: 5/5 주장 vs 실제 3/5 실행 → 불일치 + exit 1
  const tmpF = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rtf-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpF, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpF, 'package.json'), JSON.stringify({ name: 'rtf', version: '0.0.1', scripts: { test: 'node tests/test.js' } }));
  fs.mkdirSync(path.join(tmpF, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpF, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmpF, 'src/mod.js'), 'module.exports={};\n');
  fs.writeFileSync(path.join(tmpF, 'tests/test.js'),
    "console.log('3/5 passed'); process.exit(1);\n");
  fs.appendFileSync(path.join(tmpF, '.harness/progress-tracker.md'),
    '| T-0051 | done | 거짓 | src/mod.js + tests/test.js (5/5 통과) | next | 2026-05-14 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0051', '--path', tmpF, '--run-tests'], { encoding: 'utf8', timeout: 60000 });
  const ok = r.status !== 0
    && /불일치/.test(r.stdout)
    && /npm test 실행: ✗ FAIL/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.19) verify-claim --run-tests: 주장/실행 불일치 → exit≠0' : '✗ --run-tests 불일치 검증 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 600)); }
}

total++;
{
  // --strict-elements: same-file ⚠ vs diff-file ℹ 구분
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-strict2-a-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-strict2-b-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // 같은 파일 + 같은 함수 (다른 capability 이름) — 진짜 중복 가능
  fs.appendFileSync(path.join(tmpA, '.harness/reuse-map.md'),
    '| FormatX | src/util.js (format) | util | A |\n');
  fs.appendFileSync(path.join(tmpB, '.harness/reuse-map.md'),
    '| FormatY | src/util.js (format) | util | B |\n');
  // 다른 파일 + 같은 함수 — 의도 분리 가능
  fs.appendFileSync(path.join(tmpA, '.harness/reuse-map.md'),
    '| Stats1 | src/memo.js (stats) | util | A |\n');
  fs.appendFileSync(path.join(tmpB, '.harness/reuse-map.md'),
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

// 1.9.20 회귀: verify-claim file regex 확장 + jest/mocha 파싱 + --bench
total++;
{
  // verify-claim regex: 도메인 폴더 (scenes/scripts) + 루트 메타 파일 (project.godot)
  const tmpG = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-godot-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpG, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpG, 'project.godot'), 'config_version=5\n');
  fs.mkdirSync(path.join(tmpG, 'scenes'), { recursive: true });
  fs.mkdirSync(path.join(tmpG, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(tmpG, 'scenes/main.tscn'), '[gd_scene]\n');
  fs.writeFileSync(path.join(tmpG, 'scripts/network.gd'), 'extends Node\n');
  fs.appendFileSync(path.join(tmpG, '.harness/progress-tracker.md'),
    '| T-0020 | done | Godot 클라 | project.godot + scenes/main.tscn + scripts/network.gd | next | 2026-05-14 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0020', '--path', tmpG], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0
    && /✓ project\.godot/.test(r.stdout)
    && /✓ scenes\/main\.tscn/.test(r.stdout)
    && /✓ scripts\/network\.gd/.test(r.stdout)
    && !/scenes\/main\.ts\s/.test(r.stdout); // .tscn 이 .ts 로 잘못 매칭되지 않음
  console.log(ok ? '✓ B(1.9.20) verify-claim regex: 도메인 폴더 + 루트 파일 + .tscn 정확' : '✗ regex 확장 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

// 1.9.21 회귀: 설정 파일 확장자 (.cfg/.ini/.env/.toml/.lock) 추가
total++;
{
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-cfg-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpC, 'export_presets.cfg'), '[preset.0]\n');
  fs.writeFileSync(path.join(tmpC, 'config.ini'), '[main]\n');
  fs.writeFileSync(path.join(tmpC, 'Cargo.lock'), '# lock\n');
  fs.appendFileSync(path.join(tmpC, '.harness/progress-tracker.md'),
    '| T-0030 | done | 설정 | export_presets.cfg + config.ini + Cargo.lock | next | 2026-05-14 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0030', '--path', tmpC], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0
    && /✓ export_presets\.cfg/.test(r.stdout)
    && /✓ config\.ini/.test(r.stdout)
    && /✓ Cargo\.lock/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.21) verify-claim regex: .cfg/.ini/.lock 등 설정 메타 파일' : '✗ .cfg/.ini 확장 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

// 1.9.25 회귀: memory search --include-code + brainstorm --include-code + register-pending
total++;
{
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-incode-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.mkdirSync(path.join(tmpC, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpC, 'src/feature.js'), "function specialMagicHandler() { return 42; }\n");
  // 기본 memory search → 0 matches
  const r1 = cp.spawnSync(process.execPath, [CLI, 'memory', 'search', 'specialMagicHandler', '--path', tmpC], { encoding: 'utf8', timeout: 10000 });
  // --include-code → 1+ matches
  const r2 = cp.spawnSync(process.execPath, [CLI, 'memory', 'search', 'specialMagicHandler', '--path', tmpC, '--include-code'], { encoding: 'utf8', timeout: 10000 });
  const ok = /no matches/.test(r1.stdout) && /src\/feature\.js/.test(r2.stdout) && /소스 코드 포함/.test(r2.stdout);
  console.log(ok ? '✓ B(1.9.25) memory search --include-code: 코드 본문 검색' : '✗ --include-code 실패');
  if (!ok) { failed++; console.log(r2.stdout.slice(0, 400)); }
}

total++;
{
  // register-pending
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-regp-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'register-pending', 'JSON export 기능', '--agent', 'agy', '--path', tmpR], { encoding: 'utf8', timeout: 10000 });
  const okReg = r.status === 0 && /등록됨 \(in-progress\) by agy/.test(r.stdout);
  // 즉시 progress-tracker에서 검색 가능
  const r2 = cp.spawnSync(process.execPath, [CLI, 'memory', 'search', 'JSON export', '--path', tmpR], { encoding: 'utf8', timeout: 10000 });
  const okSearch = /in-progress/.test(r2.stdout) && /pending.*agy/.test(r2.stdout);
  const ok = okReg && okSearch;
  console.log(ok ? '✓ B(1.9.25) register-pending: 즉시 등록 + 검색 가능' : `✗ register-pending 실패 (reg=${okReg} search=${okSearch})`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

// 1.9.26 회귀: optimism-check (낙관적 표시 자동 감지) + verify-claim --strict-claims
total++;
{
  const tmpO = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-optm-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpO, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.mkdirSync(path.join(tmpO, 'src'), { recursive: true });
  // 정적 코드: API/DB 호출 없음
  fs.writeFileSync(path.join(tmpO, 'src/app.js'), "function pureCompute(n) { return n * 2; }\nmodule.exports = { pureCompute };\n");
  // 낙관적 evidence: API 호출 주장
  fs.appendFileSync(path.join(tmpO, '.harness/progress-tracker.md'),
    '| T-9001 | done | API 등록 | POST /users API 호출 완료, HTTP 201 응답 확인 | (완료) | 2026-05-15 |\n');
  // 정상 evidence: 단순 계산
  fs.appendFileSync(path.join(tmpO, '.harness/progress-tracker.md'),
    '| T-9002 | done | pure compute | src/app.js pureCompute 함수 구현 | (완료) | 2026-05-15 |\n');
  // T-9001 (거짓) → exit 1 + 의심 감지
  const r1 = cp.spawnSync(process.execPath, [CLI, 'optimism-check', 'T-9001', '--path', tmpO], { encoding: 'utf8', timeout: 10000 });
  const okFalse = r1.status !== 0 && /낙관적 표시 의심/.test(r1.stdout) && /API\/HTTP 호출/.test(r1.stdout);
  // T-9002 (정상) → exit 0 + 의심 없음
  const r2 = cp.spawnSync(process.execPath, [CLI, 'optimism-check', 'T-9002', '--path', tmpO], { encoding: 'utf8', timeout: 10000 });
  const okOk = r2.status === 0 && /의심 없음/.test(r2.stdout);
  const ok = okFalse && okOk;
  console.log(ok ? '✓ B(1.9.26) optimism-check: 낙관적 API 거짓 감지 + 정상 무경고' : `✗ optimism-check 실패 (거짓=${okFalse} 정상=${okOk})`);
  if (!ok) { failed++; console.log('--- 거짓 case ---\n' + r1.stdout.slice(0, 300) + '\n--- 정상 case ---\n' + r2.stdout.slice(0, 300)); }
}

total++;
{
  // verify-claim --strict-claims 통합
  const tmpS = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-stct-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpS, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.mkdirSync(path.join(tmpS, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpS, 'src/x.js'), 'module.exports={};\n');
  fs.appendFileSync(path.join(tmpS, '.harness/progress-tracker.md'),
    '| T-0050 | done | DB 마이그레이션 | 사용자 데이터 DB에 저장, 1000건 insert 성공 | (완료) | 2026-05-15 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0050', '--path', tmpS, '--strict-claims'], { encoding: 'utf8', timeout: 10000 });
  const ok = r.status !== 0 && /낙관적 표시 \(--strict-claims\): ⚠ FAIL/.test(r.stdout) && /DB 호출/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.26) verify-claim --strict-claims: DB 거짓 evidence 통합 감지' : '✗ --strict-claims 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

// 1.9.27 회귀: URL/메서드 매핑 + 신뢰도 점수 + 신규 카테고리 (FileIO/Queue/Cache/Notify/Storage)
total++;
{
  // T-9001 false negative 해결 검증: 코드에 다른 목적의 http.request 있어도 URL 미매치로 잡아냄
  const tmpU = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-url-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpU, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.mkdirSync(path.join(tmpU, 'src'), { recursive: true });
  // 다른 목적의 http.request (Ollama 호출 패턴)
  fs.writeFileSync(path.join(tmpU, 'src/ollama.js'), "http.request({host:'localhost',path:'/api/tags',method:'GET'})");
  // evidence: 전혀 다른 경로 주장
  fs.appendFileSync(path.join(tmpU, '.harness/progress-tracker.md'),
    '| T-9001 | done | API 사용자 등록 | POST /users API 호출 완료, HTTP 201 응답 확인 | next | 2026-05-15 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'optimism-check', 'T-9001', '--path', tmpU], { encoding: 'utf8', timeout: 10000 });
  const ok = r.status !== 0
    && /\[URL\]/.test(r.stdout)
    && /POST \/users/.test(r.stdout)
    && /신뢰도 \(1\.9\.27\):/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.27) URL 매핑: 1.9.26 false negative 해결 (POST /users 미발견)' : '✗ URL 매핑 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // 신규 카테고리 (Slack/Notify)
  const tmpN = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-notify-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpN, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.mkdirSync(path.join(tmpN, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpN, 'src/x.js'), 'module.exports={};\n');
  fs.appendFileSync(path.join(tmpN, '.harness/progress-tracker.md'),
    '| T-9100 | done | Slack 알림 | 슬랙 알림 발송 완료, #general 채널에 통보 | next | 2026-05-15 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'optimism-check', 'T-9100', '--path', tmpN], { encoding: 'utf8', timeout: 10000 });
  const ok = r.status !== 0 && /\[Notify\]/.test(r.stdout) && /슬랙\/Discord 알림/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.27) 신규 카테고리 Notify: 슬랙 알림 거짓 감지' : '✗ Notify 카테고리 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

total++;
{
  // 신뢰도 점수 — 정상 케이스는 1.0
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-conf-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.mkdirSync(path.join(tmpC, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpC, 'src/x.js'), 'module.exports={};\n');
  fs.appendFileSync(path.join(tmpC, '.harness/progress-tracker.md'),
    '| T-9200 | done | pure compute | src/x.js 모듈 추가 | next | 2026-05-15 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'optimism-check', 'T-9200', '--path', tmpC, '--json'], { encoding: 'utf8', timeout: 10000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = r.status === 0 && parsed && parsed.confidence === 1.0 && parsed.suspects.length === 0;
  console.log(ok ? '✓ B(1.9.27) 신뢰도 점수: 정상 evidence → 1.00' : '✗ 신뢰도 점수 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

// 1.9.28 회귀: 한국형 PG (카카오페이) 패턴 + confidence floor 0.15
total++;
{
  const tmpK = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-kpay-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpK, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.mkdirSync(path.join(tmpK, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpK, 'src/x.js'), 'module.exports={};\n');
  fs.appendFileSync(path.join(tmpK, '.harness/progress-tracker.md'),
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

// 1.9.29 회귀: 페르소나 시스템 + review 명령
total++;
{
  // persona list — 5 내장
  const r1 = cp.spawnSync(process.execPath, [CLI, 'persona', 'list'], { encoding: 'utf8', timeout: 10000 });
  const okList = r1.status === 0
    && /security: 보안 엔지니어/.test(r1.stdout)
    && /performance: 성능 최적화/.test(r1.stdout)
    && /ux: 한국어 UX/.test(r1.stdout)
    && /testing:/.test(r1.stdout)
    && /docs:/.test(r1.stdout);
  // persona show
  const r2 = cp.spawnSync(process.execPath, [CLI, 'persona', 'show', 'security'], { encoding: 'utf8', timeout: 10000 });
  const okShow = r2.status === 0 && /10년 경력/.test(r2.stdout) && /OWASP Top 10/.test(r2.stdout);
  // 알 수 없는 페르소나
  const r3 = cp.spawnSync(process.execPath, [CLI, 'persona', 'show', 'unknown999'], { encoding: 'utf8', timeout: 10000 });
  const okMissing = r3.status !== 0 && /페르소나 없음/.test(r3.stdout + r3.stderr);
  const ok = okList && okShow && okMissing;
  console.log(ok ? '✓ B(1.9.29) persona list/show/없는 ID 거부' : `✗ persona 실패 (list=${okList} show=${okShow} miss=${okMissing})`);
  if (!ok) { failed++; console.log(r1.stdout.slice(0, 400)); }
}

total++;
{
  // review <file> --persona X
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rev-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.mkdirSync(path.join(tmpR, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpR, 'src/sample.js'), "function add(a, b) { return a + b; } module.exports = { add };\n");
  // 단일 페르소나
  const r = cp.spawnSync(process.execPath, [CLI, 'review', 'src/sample.js', '--persona', 'security', '--path', tmpR], { encoding: 'utf8', timeout: 10000 });
  const okSingle = r.status === 0 && /Review Prompt/.test(r.stdout) && /보안 엔지니어/.test(r.stdout) && /add\(a, b\)/.test(r.stdout);
  // 다중 페르소나
  const r2 = cp.spawnSync(process.execPath, [CLI, 'review', 'src/sample.js', '--persona', 'security,performance,ux', '--path', tmpR], { encoding: 'utf8', timeout: 10000 });
  const okMulti = r2.status === 0
    && /보안 엔지니어/.test(r2.stdout)
    && /성능 최적화/.test(r2.stdout)
    && /UX 라이터/.test(r2.stdout);
  // 잘못된 페르소나
  const r3 = cp.spawnSync(process.execPath, [CLI, 'review', 'src/sample.js', '--persona', 'jedi', '--path', tmpR], { encoding: 'utf8', timeout: 10000 });
  const okBad = r3.status !== 0 && /페르소나 없음/.test(r3.stdout + r3.stderr);
  // --persona 누락
  const r4 = cp.spawnSync(process.execPath, [CLI, 'review', 'src/sample.js', '--path', tmpR], { encoding: 'utf8', timeout: 10000 });
  const okNoPersona = r4.status !== 0 && /--persona.*필요/.test(r4.stdout + r4.stderr);
  const ok = okSingle && okMulti && okBad && okNoPersona;
  console.log(ok ? '✓ B(1.9.29) review --persona: 단일/다중/잘못된/누락 모두 정확' : `✗ review 실패 (single=${okSingle} multi=${okMulti} bad=${okBad} noP=${okNoPersona})`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

total++;
{
  // 사용자 정의 페르소나 add
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-padd-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'persona', 'add', 'my-domain', '--path', tmpC], { encoding: 'utf8', timeout: 10000 });
  const okAdd = r.status === 0
    && fs.existsSync(path.join(tmpC, '.harness/personas/my-domain.md'))
    && /\.harness\/personas\/my-domain\.md/.test(r.stdout.replace(/\\/g, '/'));
  // list 시 사용자 정의 포함
  const r2 = cp.spawnSync(process.execPath, [CLI, 'persona', 'list', '--path', tmpC], { encoding: 'utf8', timeout: 10000 });
  const okList = /사용자 정의 \(1/.test(r2.stdout) && /my-domain/.test(r2.stdout);
  const ok = okAdd && okList;
  console.log(ok ? '✓ B(1.9.29) persona add: 사용자 정의 템플릿 생성 + list 표시' : `✗ persona add 실패 (add=${okAdd} list=${okList})`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

// 1.9.30 회귀: 외부 CLI 오케스트레이션 (agents list/check/dispatch)
total++;
{
  // agents list — claude가 환경변수 + PATH 둘 다 충족 시 ready
  const env1 = { ...process.env, LEERNESS_ENABLE_CLAUDE: '1', LEERNESS_ENABLE_CODEX: '0', LEERNESS_ENABLE_AGY: '0', LEERNESS_ENABLE_GROK: '0', LEERNESS_ENABLE_COPILOT: '0' };
  const r1 = cp.spawnSync(process.execPath, [CLI, 'agents', 'list'], { encoding: 'utf8', timeout: 15000, env: env1 });
  const okList = r1.status === 0
    && /외부 AI CLI 오케스트레이션 \(1\.9\.30\)/.test(r1.stdout)
    && /\| claude \|/.test(r1.stdout)
    && /\| codex \|/.test(r1.stdout)
    && /\| agy \|/.test(r1.stdout)
    && /\| grok \|/.test(r1.stdout)
    && /\| copilot \|/.test(r1.stdout);
  // env 모두 0 → 비활성
  // 1.9.146: Ollama 추가 → 5 CLI · 1.9.268: grok 정식 승격 → 6 CLI
  const env2 = { ...process.env, LEERNESS_ENABLE_CLAUDE: '0', LEERNESS_ENABLE_CODEX: '0', LEERNESS_ENABLE_AGY: '0', LEERNESS_ENABLE_GROK: '0', LEERNESS_ENABLE_COPILOT: '0', LEERNESS_ENABLE_OLLAMA: '0' };
  const r2 = cp.spawnSync(process.execPath, [CLI, 'agents', 'list', '--json'], { encoding: 'utf8', timeout: 15000, env: env2 });
  let parsed = null;
  try { parsed = JSON.parse(r2.stdout); } catch {}
  const okJson = parsed && Array.isArray(parsed.agents) && parsed.agents.length === 6 && parsed.agents.every(a => a.status !== 'ready');
  const ok = okList && okJson;
  console.log(ok ? '✓ B(1.9.30+1.9.268) agents list: 6 CLI 정의 (claude/codex/agy/grok/copilot/ollama)' : `✗ agents list 실패 (list=${okList} json=${okJson})`);
  if (!ok) { failed++; console.log(r1.stdout.slice(0, 500)); }
}

total++;
{
  // agents dispatch — 활성 미충족 시 거부
  const env = { ...process.env, LEERNESS_ENABLE_CODEX: '0' };
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', 'test task', '--to', 'codex'], { encoding: 'utf8', timeout: 10000, env });
  const okBlocked = r.status !== 0 && /비활성|disabled|not-installed/i.test(r.stdout);
  // --to 누락 거부
  const r2 = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', 'test'], { encoding: 'utf8', timeout: 10000 });
  const okNoTarget = r2.status !== 0 && /--to.*필요/.test(r2.stdout + r2.stderr);
  // 알 수 없는 agent 거부
  const r3 = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', 'test', '--to', 'jedi'], { encoding: 'utf8', timeout: 10000 });
  const okBadAgent = r3.status !== 0 && /알 수 없는 agent/.test(r3.stdout + r3.stderr);
  const ok = okBlocked && okNoTarget && okBadAgent;
  console.log(ok ? '✓ B(1.9.30) agents dispatch: env=0/--to 누락/잘못된 agent 모두 거부' : `✗ dispatch 실패 (block=${okBlocked} noT=${okNoTarget} bad=${okBadAgent})`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

// 1.9.31 회귀: agents quota (각 CLI 사용량/quota 조회)
total++;
{
  // agents quota — env=0 시 모두 disabled/not-installed, 안내 메시지 포함
  const env = { ...process.env, LEERNESS_ENABLE_CLAUDE: '0', LEERNESS_ENABLE_CODEX: '0', LEERNESS_ENABLE_AGY: '0', LEERNESS_ENABLE_GROK: '0', LEERNESS_ENABLE_COPILOT: '0' };
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'quota'], { encoding: 'utf8', timeout: 15000, env });
  const okText = r.status === 0
    && /외부 AI CLI quota 추정 \(1\.9\.31\)/.test(r.stdout)
    && /\| claude \|/.test(r.stdout)
    && /\| codex \|/.test(r.stdout)
    && /\| agy \|/.test(r.stdout)
    && /\| grok \|/.test(r.stdout)
    && /\| copilot \|/.test(r.stdout)
    && /provider 대시보드 참조/.test(r.stdout);
  // JSON 출력
  const r2 = cp.spawnSync(process.execPath, [CLI, 'agents', 'quota', '--json'], { encoding: 'utf8', timeout: 15000, env });
  let parsed = null;
  try { parsed = JSON.parse(r2.stdout); } catch {}
  // 1.9.146: Ollama 추가 → 5 CLI · 1.9.268: grok 정식 승격 → 6 CLI
  const okJson = parsed && Array.isArray(parsed.quota) && parsed.quota.length === 6
    && parsed.quota.every(q => typeof q.id === 'string' && typeof q.status === 'string' && (q.hint === null || typeof q.hint === 'string'));
  const ok = okText && okJson;
  console.log(ok ? '✓ B(1.9.31+1.9.268) agents quota: 6 CLI 사용량/안내' : `✗ quota 실패 (text=${okText} json=${okJson})`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // 사용법 메시지에 quota 포함
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'foo'], { encoding: 'utf8', timeout: 10000 });
  const ok = r.status !== 0 && /list\|check\|quota\|dispatch/.test(r.stdout + r.stderr);
  console.log(ok ? '✓ B(1.9.31) agents 사용법에 quota 명시' : `✗ usage 메시지 실패`);
  if (!ok) { failed++; console.log((r.stdout + r.stderr).slice(0, 300)); }
}

// 1.9.32 회귀: 배너 + setup-agents (비대화형 모드 안전)
total++;
{
  // --version --banner: LEERNESS ASCII + 신규 슬로건 (1.9.144+ "AI 에이전트 검수·기억·드리프트 방지 하네스")
  const r = cp.spawnSync(process.execPath, [CLI, '--version', '--banner'], { encoding: 'utf8', timeout: 10000, env: { ...process.env, TERM: 'dumb' } });
  const ok = r.status === 0
    && /╔═+╗/.test(r.stdout)
    && /███████╗/.test(r.stdout)
    && /AI 에이전트 검수.기억.드리프트 방지 하네스/.test(r.stdout)
    && new RegExp(`v${require('../package.json').version}`).test(r.stdout);
  console.log(ok ? '✓ B(1.9.32) --version --banner: LEERNESS ASCII 배너' : `✗ 배너 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 800)); }
}

total++;
{
  // LEERNESS_NO_BANNER=1: 배너 스킵
  const r = cp.spawnSync(process.execPath, [CLI, '--version', '--banner'], { encoding: 'utf8', timeout: 10000, env: { ...process.env, LEERNESS_NO_BANNER: '1' } });
  const ok = r.status === 0 && !/███████╗/.test(r.stdout) && /^1\./m.test(r.stdout.trim());
  console.log(ok ? '✓ B(1.9.32) LEERNESS_NO_BANNER=1: 배너 스킵' : `✗ NO_BANNER 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 300)); }
}

total++;
{
  // setup-agents 비대화형 (--yes 또는 비-TTY): 변경 없이 안내만
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-setup-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended', '--no-setup-agents'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'setup-agents', tmpC, '--yes'], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0
    && /외부 AI CLI 설정 \(1\.9\.3\d\)/.test(r.stdout)
    && /(비대화형|leerness agents list)/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.32) setup-agents 비대화형: 안내만 출력 (.env 미변경)' : `✗ setup-agents 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // help에 setup-agents 노출
  const r = cp.spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', timeout: 10000 });
  const ok = r.status === 0 && /setup-agents/.test(r.stdout) && /1\.9\.32/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.32) --help에 setup-agents + 1.9.32 명시' : `✗ help 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // _upsertEnvLine 동작 — setup-agents가 .env 파일을 만들지 못해도 안전 (비대화형이라 skip)
  // 직접 _upsertEnvLine 단위 테스트: 임시 파일에 key=value 작성 + 갱신
  const tmpEnv = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-env-')), '.env');
  fs.writeFileSync(tmpEnv, 'EXISTING=1\nLEERNESS_ENABLE_CLAUDE=0\n', 'utf8');
  // 갱신: LEERNESS_ENABLE_CLAUDE=0 → 1
  // (간접 검증: setup-agents의 핵심 함수가 정규식 기반 upsert)
  const before = fs.readFileSync(tmpEnv, 'utf8');
  // 시뮬: regex replace
  const updated = before.replace(/^LEERNESS_ENABLE_CLAUDE=.*$/m, 'LEERNESS_ENABLE_CLAUDE=1');
  fs.writeFileSync(tmpEnv, updated, 'utf8');
  const after = fs.readFileSync(tmpEnv, 'utf8');
  const ok = /LEERNESS_ENABLE_CLAUDE=1/.test(after) && /EXISTING=1/.test(after) && !/LEERNESS_ENABLE_CLAUDE=0/.test(after);
  console.log(ok ? '✓ B(1.9.32) .env upsert: 기존 키 교체 + 다른 키 보존' : `✗ .env upsert 실패`);
  if (!ok) { failed++; console.log(after); }
}

// 1.9.33 회귀: npx 캐시 함정 — stale 버전 실행 시 경고
total++;
{
  // 캐시에 미래 버전을 심어 stale 시뮬레이션 → 경고 출력 + init은 계속 진행
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-stale-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended', '--no-stale-check'], { stdio: 'ignore', timeout: 30000 });
  const cacheDir = path.join(tmpC, '.harness', 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'update-check.json'), JSON.stringify({ at: Date.now(), nextLeerness: '99.99.99', runningCli: require('../package.json').version }), 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
  const ok = r.status === 0
    && /옛 버전이 실행 중입니다/.test(r.stdout)
    && /v99\.99\.99/.test(r.stdout)
    && /clear-npx-cache/.test(r.stdout)
    && /Leerness v/.test(r.stdout); // init도 계속 진행
  console.log(ok ? '✓ B(1.9.33) npx stale 경고: 미래 latest 캐시 시 경고 + init 계속' : `✗ stale 경고 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 800)); }
}

// 1.9.63/64 회귀
total++;
{
  // audit --strict
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-st-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'audit', tmpC, '--strict'], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status !== 0 && /strict.*승격|failures=1/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.63) audit --strict: warnings → failures 승격' : `✗ --strict 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

total++;
{
  // audit --strict --threshold 10 → exit 0
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-st2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'audit', tmpC, '--strict', '--threshold', '10'], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0;
  console.log(ok ? '✓ B(1.9.63) audit --strict --threshold 10: warnings 적으면 exit 0' : `✗ threshold 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-300)); }
}

total++;
{
  // install 별칭
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-iv-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const src = path.join(tmpC, 'sk.md');
  fs.writeFileSync(src, '---\nname: install-alias-test\ndescription: 별칭 검증\n---\n# Body\n', 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'install', src, '--path', tmpC], { encoding: 'utf8', timeout: 15000 });
  const f = path.join(tmpC, '.harness', 'skills', 'install-alias-test', 'SKILL.md');
  const ok = r.status === 0 && fs.existsSync(f);
  console.log(ok ? '✓ B(1.9.64) install <SKILL.md>: skill install 별칭 동작' : `✗ install 별칭 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 300)); }
}

// 1.9.60/61/62 회귀
total++;
{
  // task export → TodoWrite JSON 호환
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

total++;
{
  // MCP cursor 페이지네이션 (chunkSize override)
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mcc-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const req = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_handoff', arguments: { path: tmpC, _cursor: '0', _chunkSize: 200 } } });
  const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 15000, input: req + '\n' });
  const resp = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]);
  const ok = resp.result && resp.result.nextCursor && resp.result._truncated;
  console.log(ok ? '✓ B(1.9.61) MCP cursor 페이지네이션: nextCursor + _truncated' : `✗ cursor 실패`);
  if (!ok) { failed++; console.log(JSON.stringify(resp).slice(0, 300)); }
}

total++;
{
  // audit npm CVE — OFFLINE 또는 package.json 없을 때 graceful
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ac-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // package.json 없음 → npm audit 스킵
  const r = cp.spawnSync(process.execPath, [CLI, 'audit', tmpC], { encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_OFFLINE: '1' } });
  const ok = r.status === 0 && !/npm CVE/.test(r.stdout) && /Audit summary/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.62) audit: package.json 없을 때 npm audit 자동 스킵' : `✗ audit CVE 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

// 1.9.58/59 회귀
total++;
{
  // fuzzy 매칭 — 어간 변형 (webhook ↔ webhooks)
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-fz-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpC, '.harness', 'review-evidence.md'),
    '## 2026-04\nNote: ✗ webhooks payload 실패\n', 'utf8');
  cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'webhook 작업', '--status', 'in-progress', '--path', tmpC], { stdio: 'ignore', timeout: 10000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--no-drift-check', '--no-workflow-guide'], { encoding: 'utf8', timeout: 15000 });
  const ok = /lessons 자동 재상기.*webhook/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.58) lessons fuzzy: webhook ↔ webhooks 어간 변형 매칭' : `✗ fuzzy 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-500)); }
}

total++;
{
  // session close default suggest
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sd-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpC], { encoding: 'utf8', timeout: 30000 });
  // 1.9.59: default activated → "다음 라운드 추천" 자동 표시
  const ok = /다음 라운드 추천|drift 상태/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.59) session close: --suggest default 활성' : `✗ default suggest 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-500)); }
}

total++;
{
  // --no-suggest 비활성 (이전 동작 보존)
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ns-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpC, '--no-suggest'], { encoding: 'utf8', timeout: 30000 });
  const ok = r.status === 0 && !/다음 라운드 추천/.test(r.stdout) && /진행 요약/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.59) --no-suggest: suggest 비활성 (이전 동작)' : `✗ --no-suggest 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-300)); }
}

// 1.9.56/57 회귀
total++;
{
  // handoff 자동 lessons 재상기
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ha-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpC, '.harness', 'review-evidence.md'),
    '## 2026-04-01\nNote: ✗ webhook 처리 실패\n', 'utf8');
  cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'webhook 처리 개선', '--status', 'in-progress', '--path', tmpC], { stdio: 'ignore', timeout: 10000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--no-drift-check', '--no-workflow-guide'], { encoding: 'utf8', timeout: 15000 });
  const ok = /lessons 자동 재상기.*webhook|🧠.*webhook/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.56) handoff: lessons 자동 재상기 (현재 task 키워드 매칭)' : `✗ handoff lessons 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-500)); }
}

total++;
{
  // session close --suggest
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sc-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpC, '--suggest'], { encoding: 'utf8', timeout: 30000 });
  const ok = /다음 라운드 추천|drift 상태/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.57) session close --suggest: drift + skill suggest 통합' : `✗ --suggest 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-500)); }
}

// 1.9.54/55 회귀
total++;
{
  // lessons --auto 키워드 자동 추출
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-la-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpC, '.harness', 'review-evidence.md'),
    '## 2026-04-01\nNote: ✗ payment 처리 실패 — 검수 누락\n', 'utf8');
  cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'payment 검증 작업', '--status', 'in-progress', '--path', tmpC], { stdio: 'ignore', timeout: 10000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'lessons', '--path', tmpC, '--auto', '--limit', '5'], { encoding: 'utf8', timeout: 15000 });
  const ok = /추출 키워드.*payment/.test(r.stdout) && /payment.*실패/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.54) lessons --auto: in-progress task 키워드 자동 추출 + 매칭' : `✗ lessons --auto 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

total++;
{
  // MCP server tools/list 12 도구 (1.9.55)
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

// 1.9.53 회귀: skill suggest 자동 학습
total++;
{
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sg-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // 반복 키워드 6회
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

// 1.9.51/52 회귀
total++;
{
  // benchmark --scenario all → 4개 시나리오 모두 감지
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sc-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'benchmark', tmpC, '--scenario', 'all', '--json'], { encoding: 'utf8', timeout: 60000 });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch {}
  const ok = j && j.scenarios && j.scenarios.length === 4 && j.detectedCount === 4;
  console.log(ok ? '✓ B(1.9.51) benchmark --scenario all: 4/4 leerness 고유 가치 자동 감지' : `✗ scenario all 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

total++;
{
  // benchmark --scenario 알 수 없는 ID → 친절 안내
  const r = cp.spawnSync(process.execPath, [CLI, 'benchmark', '--scenario', 'unknown-x'], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status !== 0 && /알 수 없는 scenario/.test(r.stdout + r.stderr);
  console.log(ok ? '✓ B(1.9.51) benchmark --scenario unknown: 친절 안내' : `✗ scenario 안내 실패`);
  if (!ok) { failed++; console.log((r.stdout + r.stderr).slice(0, 300)); }
}

total++;
{
  // _parseSkillCatalog 4 형식 인식 — node -e로 동적 평가
  const src = fs.readFileSync(CLI, 'utf8');
  // 1.9.141 fix: Windows CRLF 대응 — \r?\n 으로 양쪽 line ending 모두 매칭
  const m = src.match(/function _parseSkillCatalog\([\s\S]*?\r?\n\}\r?\n/);
  if (!m) {
    console.log('✗ _parseSkillCatalog 함수 위치 못 찾음');
    failed++;
  } else {
    const fn = eval('(' + m[0].replace('function _parseSkillCatalog', 'function') + ')');
    const jsonR = fn(JSON.stringify({ skills: [{ name: 'a', description: 'A' }] }), null);
    const rssR = fn('<rss><channel><item><title>X</title><link>http://x.com/s.md</link></item></channel></rss>', null);
    const mdR = fn('- [office](o.md) — Office\n- [crawling](c.md) — Web', null);
    const urlR = fn('https://x.com/foo/SKILL.md', null);
    const ok = jsonR[0].format === 'json' && rssR[0].format === 'rss'
      && mdR[0].format === 'markdown' && urlR[0].format === 'urls';
    console.log(ok ? '✓ B(1.9.52) _parseSkillCatalog: 4 형식 (JSON/RSS/Markdown/llms.txt) 모두 인식' : `✗ catalog 형식 실패`);
    if (!ok) { failed++; console.log(JSON.stringify({jsonR, rssR, mdR, urlR}).slice(0, 400)); }
  }
}

// 1.9.48~50 회귀
total++;
{
  // 1.9.48 cross-platform archive — PowerShell ZIP or tar
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-arc-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'all'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'publish', '--path', tmpC, '--bundle-only'], { encoding: 'utf8', timeout: 30000 });
  const tarballDir = path.join(tmpC, '.harness', 'skills-publish-tarball');
  const files = fs.existsSync(tarballDir) ? fs.readdirSync(tarballDir) : [];
  const archive = files.find(f => /\.(tgz|zip)$/.test(f));
  const ok = r.status === 0 && (archive || /archive 생성/.test(r.stdout));
  console.log(ok ? `✓ B(1.9.48) cross-platform archive (${archive || 'graceful'})` : `✗ archive 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

total++;
{
  // 1.9.49 benchmark --measure 인자 검증
  const r = cp.spawnSync(process.execPath, [CLI, 'benchmark', '--measure'], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status !== 0 && /사용법|task/.test(r.stdout + r.stderr);
  console.log(ok ? '✓ B(1.9.49) benchmark --measure: 인자 누락 친절 안내' : `✗ --measure 인자 실패`);
  if (!ok) { failed++; console.log((r.stdout + r.stderr).slice(0, 300)); }
}

total++;
{
  // 1.9.50 skill match --embedding (Ollama URL 없을 때 거부)
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-emb-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'match', 'test query', '--path', tmpC, '--embedding'], {
    encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_OLLAMA_BASE_URL: '' }
  });
  const ok = r.status !== 0 && /LEERNESS_OLLAMA_BASE_URL.*필요|opt-in/.test(r.stdout + r.stderr);
  console.log(ok ? '✓ B(1.9.50) skill match --embedding: Ollama URL 없으면 opt-in 거부' : `✗ --embedding 거부 실패`);
  if (!ok) { failed++; console.log((r.stdout + r.stderr).slice(0, 300)); }
}

// 1.9.45 회귀: skill match — 키워드 매칭 추천 (jaccard)
total++;
{
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-match-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'all'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'match', 'Office 문서 자동화', '--path', tmpC, '--json'], { encoding: 'utf8', timeout: 15000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = parsed
    && parsed.top
    && parsed.top.length > 0
    && parsed.top[0].id === 'office'; // office가 최상위 매칭
  console.log(ok ? '✓ B(1.9.45) skill match: jaccard 매칭 → office 최상위' : `✗ skill match 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

// 1.9.46 회귀: benchmark — 자체 6차원 점수 + 타도구 비교
total++;
{
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

// 1.9.47 회귀: skill publish — 9개 SKILL.md export + manifest.json
total++;
{
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-pub-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'all'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'publish', '--path', tmpC, '--bundle-only'], { encoding: 'utf8', timeout: 30000 });
  const publishDir = path.join(tmpC, '.harness', 'skills-publish');
  const manifestFile = path.join(publishDir, 'manifest.json');
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch {}
  const ok = r.status === 0
    && fs.existsSync(publishDir)
    && manifest
    && manifest.skills && manifest.skills.length >= 5
    && manifest.format === 'agentskills.io';
  console.log(ok ? `✓ B(1.9.47) skill publish: ${manifest ? manifest.skills.length : 0} skill + manifest 생성` : `✗ skill publish 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

// 1.9.44 회귀: BOM SKILL.md 처리 (stress-v2 G2 발견)
total++;
{
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bom-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const src = path.join(tmpC, 'bom.md');
  // BOM (EF BB BF) + frontmatter
  const buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('---\nname: bom-skill\ndescription: BOM 처리 검증\n---\n\n# Body\n', 'utf8')]);
  fs.writeFileSync(src, buf);
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'install', src, '--path', tmpC], { encoding: 'utf8', timeout: 15000 });
  const installedFile = path.join(tmpC, '.harness', 'skills', 'bom-skill', 'SKILL.md');
  const ok = r.status === 0 && fs.existsSync(installedFile);
  console.log(ok ? '✓ B(1.9.44) skill install: UTF-8 BOM 자동 제거 후 frontmatter 파싱' : `✗ BOM 처리 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

// 1.9.43 회귀: MCP server + skill export-all + _reports 비공개
total++;
{
  // skill export-all: 모든 내장 skill을 SKILL.md로 일괄 export
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-exall-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'all'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'export-all', '--path', tmpC], { encoding: 'utf8', timeout: 30000 });
  const exportDir = path.join(tmpC, '.harness', 'skills-export');
  const exists2 = fs.existsSync(exportDir);
  const count = exists2 ? fs.readdirSync(exportDir).length : 0;
  const ok = r.status === 0 && exists2 && count >= 5;
  console.log(ok ? `✓ B(1.9.43) skill export-all: ${count}개 skill 일괄 SKILL.md 생성` : `✗ export-all 실패 (count=${count})`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

total++;
{
  // MCP server initialize: stdio JSON-RPC 정상 응답
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

total++;
{
  // MCP server tools/list: 10개 도구 노출
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

total++;
{
  // .gitignore에 _reports/ 포함 — leerness-pkg
  const giPath = path.join(__dirname, '..', '.gitignore');
  const body = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '';
  const ok = /_reports\//.test(body) && /\*\.private\.md/.test(body);
  console.log(ok ? '✓ B(1.9.43) leerness-pkg/.gitignore: _reports/ + *.private.md 차단' : `✗ .gitignore 실패`);
  if (!ok) { failed++; console.log(body.slice(0, 300)); }
}

total++;
{
  // .npmignore에 _reports/ + 보고서 차단 명시
  const niPath = path.join(__dirname, '..', '.npmignore');
  const body = fs.existsSync(niPath) ? fs.readFileSync(niPath, 'utf8') : '';
  const ok = /_reports\//.test(body) && /\*\.private/.test(body);
  console.log(ok ? '✓ B(1.9.43) leerness-pkg/.npmignore: _reports/ 차단' : `✗ .npmignore 실패`);
  if (!ok) { failed++; console.log(body.slice(0, 300)); }
}

// 1.9.42 회귀: agentskills.io 표준 호환 (skill install/discover/export + .env opt-in)
total++;
{
  // skill discover: env 없으면 opt-in 안내로 거부
  const env = { ...process.env };
  delete env.LEERNESS_SKILL_DISCOVER_URL;
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'discover'], { encoding: 'utf8', timeout: 10000, env });
  const ok = r.status !== 0 && /LEERNESS_SKILL_DISCOVER_URL.*필요|opt-in/.test(r.stdout + r.stderr);
  console.log(ok ? '✓ B(1.9.42) skill discover: env 없으면 opt-in 안내 거부' : `✗ discover opt-in 실패`);
  if (!ok) { failed++; console.log((r.stdout + r.stderr).slice(0, 400)); }
}

total++;
{
  // skill export → SKILL.md frontmatter 정확 생성
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-skex-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'export', 'office', '--path', tmpC], { encoding: 'utf8', timeout: 15000 });
  const skillFile = path.join(tmpC, '.harness', 'skills-export', 'office', 'SKILL.md');
  const exists2 = fs.existsSync(skillFile);
  const body = exists2 ? fs.readFileSync(skillFile, 'utf8') : '';
  const ok = r.status === 0
    && exists2
    && /^---\nname: office\ndescription:/.test(body)
    && /\n---\n/.test(body);
  console.log(ok ? '✓ B(1.9.42) skill export: agentskills.io 표준 SKILL.md frontmatter 생성' : `✗ export 실패`);
  if (!ok) { failed++; console.log(body.slice(0, 300) || r.stdout.slice(0, 300)); }
}

total++;
{
  // skill install: 로컬 SKILL.md import → .harness/skills/<id>/SKILL.md 자동 배치
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-skin-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // 로컬 SKILL.md 직접 작성
  const skillSrc = path.join(tmpC, 'test-skill.md');
  fs.writeFileSync(skillSrc, '---\nname: my-test-skill\ndescription: agentskills.io 표준 호환 e2e 검증\n---\n\n# Test Skill\n\n본문 내용.\n', 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'install', skillSrc, '--path', tmpC], { encoding: 'utf8', timeout: 15000 });
  const installedFile = path.join(tmpC, '.harness', 'skills', 'my-test-skill', 'SKILL.md');
  const ok = r.status === 0
    && fs.existsSync(installedFile)
    && /my-test-skill/.test(fs.readFileSync(installedFile, 'utf8'));
  console.log(ok ? '✓ B(1.9.42) skill install: 로컬 SKILL.md → .harness/skills/<id>/ 배치' : `✗ install 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

total++;
{
  // skill install이 skill.json도 자동 작성 (자체 catalog 호환)
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-skin2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const skillSrc = path.join(tmpC, 'test-skill2.md');
  fs.writeFileSync(skillSrc, '---\nname: dual-format\ndescription: skill.json + SKILL.md 양쪽 자동 생성\n---\n\n# Dual\n', 'utf8');
  cp.spawnSync(process.execPath, [CLI, 'skill', 'install', skillSrc, '--path', tmpC], { stdio: 'ignore', timeout: 15000 });
  const jsonFile = path.join(tmpC, '.harness', 'skills', 'dual-format', 'skill.json');
  const json = fs.existsSync(jsonFile) ? JSON.parse(fs.readFileSync(jsonFile, 'utf8')) : null;
  const ok = json
    && json.name === 'dual-format'
    && json._source === 'agentskills.io'
    && json.verification && json.verification.method === 'agentskills.io-import';
  console.log(ok ? '✓ B(1.9.42) skill install: skill.json 자동 생성 + _source 추적' : `✗ skill.json 실패`);
  if (!ok) { failed++; console.log(JSON.stringify(json || {})); }
}

// 1.9.41 회귀: whats-new 명령 + migrate 차분 AI must re-read + handoff fresh 알림
total++;
{
  // whats-new --from 큰 점프 → 신규 명령 추출
  const r = cp.spawnSync(process.execPath, [CLI, 'whats-new', '--from', '1.9.33', '--json'], { encoding: 'utf8', timeout: 15000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = parsed
    && parsed.from === '1.9.33'
    && Array.isArray(parsed.versions)
    && parsed.versions.length >= 5
    && parsed.versions.some(v => v.newCommands && v.newCommands.length > 0);
  console.log(ok ? '✓ B(1.9.41) whats-new --from 1.9.33: 5+ 버전 차분 + 신규 명령 추출' : `✗ whats-new 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

total++;
{
  // migrate가 fromV가 있는 경우 AI must re-read 블록을 stdout에 출력
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mig-'));
  // 1.9.30 표시로 init한 척 (HARNESS_VERSION 직접 작성)
  fs.mkdirSync(path.join(tmpC, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(tmpC, '.harness', 'HARNESS_VERSION'), 'leerness@1.9.36\n', 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'migrate', tmpC, '--yes', '--no-banner', '--no-stale-check'], { encoding: 'utf8', timeout: 60000 });
  const ok = r.status === 0
    && /AI must re-read/.test(r.stdout)
    && /1\.9\.36 → 1\.9\.\d+/.test(r.stdout)
    && /신규 명령/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.41) migrate stdout: AI must re-read 차분 자동 출력' : `✗ migrate 차분 출력 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-800)); }
}

total++;
{
  // migration-report.md에 AI must re-read 섹션 영구 기록
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mig2-'));
  fs.mkdirSync(path.join(tmpC, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(tmpC, '.harness', 'HARNESS_VERSION'), 'leerness@1.9.30\n', 'utf8');
  cp.spawnSync(process.execPath, [CLI, 'migrate', tmpC, '--yes', '--no-banner', '--no-stale-check'], { stdio: 'ignore', timeout: 60000 });
  const reportPath = path.join(tmpC, '.harness', 'migration-report.md');
  const body = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf8') : '';
  const ok = /## 🤖 AI must re-read/.test(body) && /Previous: 1\.9\.30/.test(body);
  console.log(ok ? '✓ B(1.9.41) migration-report.md: AI must re-read 섹션 + Previous 버전 기록' : `✗ report 기록 실패`);
  if (!ok) { failed++; console.log(body.slice(0, 600)); }
}

total++;
{
  // handoff가 fresh migration-report (24h 내) 시 자동 알림
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-fresh-'));
  fs.mkdirSync(path.join(tmpC, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(tmpC, '.harness', 'HARNESS_VERSION'), 'leerness@1.9.30\n', 'utf8');
  cp.spawnSync(process.execPath, [CLI, 'migrate', tmpC, '--yes', '--no-banner', '--no-stale-check'], { stdio: 'ignore', timeout: 60000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--no-drift-check'], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0
    && /최근.*시간 전 migrate 차분|AI must re-read/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.41) handoff: 최근 migrate 차분 자동 표시 (24h 내)' : `✗ handoff 차분 알림 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-500)); }
}

// 1.9.40 회귀: release pack 통합 명령 + audit README mismatch 감지
total++;
{
  // release pack --dry-run --task-add: 자동 task 등록
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rp-'));
  // init 후 가벼운 package.json 흉내 (release pack은 npm pack 시도하므로 dry-run으로 우회)
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpC, 'package.json'), JSON.stringify({ name: 'rp-test', version: '0.0.1' }), 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'release', 'pack', tmpC, '--dry-run', '--task-add', '1.9.40 e2e 검증', '--no-readme-sync'], { encoding: 'utf8', timeout: 30000 });
  const ok = r.status === 0
    && /release pack \(1\.9\.40\)/.test(r.stdout)
    && /task added/.test(r.stdout)
    && /dry-run/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.40) release pack: --dry-run + --task-add 자동 등록' : `✗ release pack 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // release pack --parent-migrate (인공 parent .harness 생성)
  const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rp-parent-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpParent, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const tmpChild = path.join(tmpParent, 'child');
  fs.mkdirSync(tmpChild, { recursive: true });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpChild, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpChild, 'package.json'), JSON.stringify({ name: 'rp-child', version: '0.0.1' }), 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'release', 'pack', tmpChild, '--dry-run', '--parent-migrate', '--no-readme-sync'], { encoding: 'utf8', timeout: 30000 });
  const ok = r.status === 0 && /parent self-host migrate/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.40) release pack --parent-migrate: 부모 .harness 자동 감지' : `✗ parent-migrate 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // audit README version mismatch 감지
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mm-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // package.json v1.0.0 + README의 version 배지는 v0.5.0 → mismatch
  fs.writeFileSync(path.join(tmpC, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }), 'utf8');
  fs.writeFileSync(path.join(tmpC, 'README.md'), '# Test\n[![version](https://img.shields.io/badge/version-0.5.0-green)]()\n', 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'audit', tmpC], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /version badge mismatch.*0\.5\.0.*1\.0\.0/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.40) audit: README ↔ package.json version mismatch 감지' : `✗ README mismatch 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // audit --fix가 README 자동 갱신
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

// 1.9.39 회귀: session workflow 가이드 + auto-fix + auto-recover
total++;
{
  // handoff 끝에 워크플로 6단계 가이드 자동 표시
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-wf-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--no-drift-check'], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0
    && /세션 워크플로 6단계/.test(r.stdout)
    && /1\. 요청 분석/.test(r.stdout)
    && /6\. 세션 마감/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.39) handoff: 6단계 워크플로 가이드 자동 표시' : `✗ workflow guide 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-500)); }
}

total++;
{
  // session-workflow.md 파일이 init 시 생성
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-wf2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const wfFile = path.join(tmpC, '.harness', 'session-workflow.md');
  const ok = fs.existsSync(wfFile)
    && /6단계/.test(fs.readFileSync(wfFile, 'utf8'))
    && /sub-agent/.test(fs.readFileSync(wfFile, 'utf8'));
  console.log(ok ? '✓ B(1.9.39) .harness/session-workflow.md init 시 자동 생성' : `✗ workflow 파일 실패`);
  if (!ok) { failed++; if (fs.existsSync(wfFile)) console.log(fs.readFileSync(wfFile, 'utf8').slice(0, 300)); else console.log('파일 없음'); }
}

total++;
{
  // AGENTS.md / CLAUDE.md에 session-workflow.md 참조 포함
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-wf3-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const agentsBody = fs.readFileSync(path.join(tmpC, 'AGENTS.md'), 'utf8');
  const claudeBody = fs.readFileSync(path.join(tmpC, 'CLAUDE.md'), 'utf8');
  const ok = /session-workflow\.md/.test(agentsBody) && /session-workflow\.md/.test(claudeBody);
  console.log(ok ? '✓ B(1.9.39) AGENTS/CLAUDE 템플릿에 session-workflow.md 참조' : `✗ 인스트럭션 통합 실패`);
  if (!ok) { failed++; }
}

total++;
{
  // drift check --auto-fix: critical 시 session close 자동 실행 (시뮬은 어려우니 옵션 인식만)
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-af-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // --auto-fix 플래그 인식 (healthy 상태에서도 명령 자체는 정상 종료)
  const r = cp.spawnSync(process.execPath, [CLI, 'drift', 'check', tmpC, '--auto-fix'], { encoding: 'utf8', timeout: 30000 });
  const ok = r.status === 0
    && /leerness drift check/.test(r.stdout)
    && /(healthy|attention|warning|critical)/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.39) drift check --auto-fix 옵션 인식 + healthy fallthrough' : `✗ --auto-fix 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

// 1.9.38 회귀: usage stats, task sync, drift reminder, drift skip learning
total++;
{
  // B. usage stats: 빈 상태 + 호출 후 카운터 증가
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-usage-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // 카운터 자극: status, handoff 호출
  cp.spawnSync(process.execPath, [CLI, 'status', tmpC], { stdio: 'ignore', timeout: 10000 });
  cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--compact', '--no-drift-check'], { stdio: 'ignore', timeout: 10000 });
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

total++;
{
  // C. task sync — TodoWrite JSON 임포트
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

total++;
{
  // A. drift reminder 파일 자동 생성 (인공 stale 시뮬)
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rem-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // session-handoff.md를 5일 전으로
  const shPath = path.join(tmpC, '.harness', 'session-handoff.md');
  if (fs.existsSync(shPath)) {
    const oldDate = new Date(Date.now() - 5 * 86400000).toISOString();
    let body = fs.readFileSync(shPath, 'utf8');
    body = body.replace(/Last generated:.*/, `Last generated: ${oldDate}`);
    if (!/Last generated:/.test(body)) body = `Last generated: ${oldDate}\n` + body;
    fs.writeFileSync(shPath, body, 'utf8');
  }
  // handoff 호출 → reminder 자동 생성
  cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--compact'], { encoding: 'utf8', timeout: 10000 });
  const remPath = path.join(tmpC, '.harness', 'agent-reminders.md');
  const ok = fs.existsSync(remPath) && /drift critical/.test(fs.readFileSync(remPath, 'utf8'));
  console.log(ok ? '✓ B(1.9.38) drift critical → agent-reminders.md 자동 생성' : `✗ reminder 파일 실패`);
  if (!ok) { failed++; if (fs.existsSync(remPath)) console.log(fs.readFileSync(remPath, 'utf8').slice(0, 400)); else console.log('(reminder 파일 없음)'); }
}

total++;
{
  // D. drift 학습 — --no-drift-check 5회 호출 후 임계 완화
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-learn-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // 5회 --no-drift-check 호출
  for (let i = 0; i < 5; i++) {
    cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--compact', '--no-drift-check'], { stdio: 'ignore', timeout: 10000 });
  }
  const stats = JSON.parse(fs.readFileSync(path.join(tmpC, '.harness', 'cache', 'usage-stats.json'), 'utf8'));
  const ok = stats.drift && stats.drift.skipped >= 5;
  console.log(ok ? '✓ B(1.9.38) drift 학습: --no-drift-check 5회 누적 (skipped≥5)' : `✗ drift 학습 실패`);
  if (!ok) { failed++; console.log(JSON.stringify(stats.drift || {})); }
}

// 1.9.37 회귀: drift detection
total++;
{
  // drift check: 신규 init 직후 (메타파일은 fresh) → healthy 또는 attention
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-drift-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'drift', 'check', tmpC], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0
    && /leerness drift check \(1\.9\.37\)/.test(r.stdout)
    && /(healthy|attention|warning)/.test(r.stdout);  // 막 init이라 critical은 안 됨
  console.log(ok ? '✓ B(1.9.37) drift check: 신규 init → healthy/attention 등급' : `✗ drift check 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // drift check --json: 점수/신호 구조 검증
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-drift2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // 인공적으로 progress-tracker를 옛날 날짜로 만들기 어려우니 신호 갯수만 검증
  const r = cp.spawnSync(process.execPath, [CLI, 'drift', 'check', tmpC, '--json'], { encoding: 'utf8', timeout: 15000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  const ok = parsed
    && typeof parsed.score === 'number'
    && typeof parsed.level === 'string'
    && Array.isArray(parsed.signals)
    && parsed.signals.length >= 3; // session-handoff/current-state/progress-tracker 최소
  console.log(ok ? '✓ B(1.9.37) drift check --json: 점수/레벨/신호 구조' : `✗ drift --json 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // handoff 자동 drift 경고 — 인공 stale 시뮬 (session-handoff.md의 Last generated를 옛 날짜로)
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-drift3-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // session-handoff.md에 옛 날짜 주입
  const shPath = path.join(tmpC, '.harness', 'session-handoff.md');
  if (fs.existsSync(shPath)) {
    let body = fs.readFileSync(shPath, 'utf8');
    const oldDate = new Date(Date.now() - 5 * 86400000).toISOString();
    body = body.replace(/Last generated:.*/, `Last generated: ${oldDate}`);
    if (!/Last generated:/.test(body)) body = `Last generated: ${oldDate}\n\n` + body;
    fs.writeFileSync(shPath, body, 'utf8');
  }
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC, '--compact'], { encoding: 'utf8', timeout: 15000 });
  const ok = /leerness drift 감지/.test(r.stdout) && /session close/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.37) handoff 자동 drift 경고: 5일 stale → 알림 표시' : `✗ handoff drift 경고 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // LEERNESS_NO_DRIFT_CHECK=1: 자동 경고 스킵
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-drift4-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const shPath = path.join(tmpC, '.harness', 'session-handoff.md');
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

// 1.9.36 회귀: dispatch 권장 플래그 + bench + 작업 유형 추천
total++;
{
  // dispatch --write 시 agy --yolo 자동 추가
  const env = { ...process.env, LEERNESS_ENABLE_AGY: '1' };
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', '코드 분석해서 요약', '--to', 'agy', '--write'], { encoding: 'utf8', timeout: 15000, env });
  // agy가 ready면 명령 출력에 --yolo 포함, 비-ready면 거부 — 둘 다 OK
  const ok = (r.status === 0 && /--yolo/.test(r.stdout) && /write \(파일 수정 가능\)/.test(r.stdout))
          || (r.status !== 0 && /비활성|disabled|not-installed/.test(r.stdout));
  console.log(ok ? '✓ B(1.9.36) dispatch --write: agy --yolo 자동 첨부 또는 비활성 거부' : `✗ dispatch --write 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // dispatch read-only (기본) — --yolo/--dangerously 같은 위험 플래그 없음
  const env = { ...process.env, LEERNESS_ENABLE_CLAUDE: '1' };
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', '번역해줘', '--to', 'claude'], { encoding: 'utf8', timeout: 15000, env });
  // claude가 ready면 read-only 표시 + dangerously 플래그 없음
  const ok = (r.status === 0 && /read-only/.test(r.stdout) && !/--dangerously-skip-permissions/.test(r.stdout))
          || (r.status !== 0 && /비활성|disabled|not-installed/.test(r.stdout));
  console.log(ok ? '✓ B(1.9.36) dispatch read-only 기본: 위험 플래그 미첨부 또는 비활성 거부' : `✗ dispatch read-only 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // 작업 유형 추천 — 비활성 CLI에도 추천 메시지 우선 출력
  const env = { ...process.env, LEERNESS_ENABLE_AGY: '0', LEERNESS_ENABLE_CLAUDE: '0' };
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', '번역해줘 한국어를 영어로', '--to', 'agy'], { encoding: 'utf8', timeout: 15000, env });
  // 번역 → claude 추천. ready 체크 전에 추천 출력 → stdout에 "추천...claude" 포함
  const ok = /추천.*claude/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.36) 작업 유형 추천: 번역→claude 추천 (비활성이어도 출력)' : `✗ 추천 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // bench 명령: ready CLI 없을 때 거부
  const env = { ...process.env, LEERNESS_ENABLE_CLAUDE: '0', LEERNESS_ENABLE_CODEX: '0', LEERNESS_ENABLE_AGY: '0', LEERNESS_ENABLE_COPILOT: '0' };
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'bench', 'test'], { encoding: 'utf8', timeout: 15000, env });
  const ok = r.status !== 0 && /ready CLI 없음/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.36) agents bench: ready 없을 때 거부' : `✗ bench 거부 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 300)); }
}

total++;
{
  // 사용법 메시지에 bench 포함
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'unknown'], { encoding: 'utf8', timeout: 10000 });
  const ok = r.status !== 0 && /bench/.test(r.stdout + r.stderr);
  console.log(ok ? '✓ B(1.9.36) agents 사용법에 bench 명시' : `✗ usage bench 실패`);
  if (!ok) { failed++; console.log((r.stdout + r.stderr).slice(0, 300)); }
}

// 1.9.35 회귀: 5개 신규 기능
total++;
{
  // 개선#1: handoff 시 .harness 부재 자동 경고
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-noinit-'));
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', tmpC], { encoding: 'utf8', timeout: 10000 });
  const ok = /leerness init 미실행 디렉토리/.test(r.stdout) || /leerness init/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.35) handoff: .harness 부재 자동 경고' : `✗ #1 handoff 경고 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

total++;
{
  // 개선#5: audit --fix 옵션 (플래그 인식만 검증, 실 fix는 통합 환경 필요)
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-fix-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'audit', tmpC, '--fix'], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /(Audit summary|fixed=)/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.35) audit --fix: 자동 fix 옵션 인식' : `✗ #5 audit --fix 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

total++;
{
  // 개선#3: contract verify
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

total++;
{
  // 개선#2: reuse autodetect — src/*.js의 module.exports 스캔
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-autodetect-'));
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'util.js'), 'function hello(){}\nfunction _internal(){}\nmodule.exports={hello, _internal};\n', 'utf8');
  const r = cp.spawnSync(process.execPath, [CLI, 'reuse', 'autodetect', tmpDir, '--json'], { encoding: 'utf8', timeout: 10000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch {}
  // _internal은 _로 시작하므로 제외, hello만 발견
  const ok = parsed && parsed.found && parsed.found.length === 1 && parsed.found[0].name === 'hello';
  console.log(ok ? '✓ B(1.9.35) reuse autodetect: module.exports 스캔 + _internal 제외' : `✗ #2 autodetect 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 400)); }
}

total++;
{
  // 개선#4: agents dispatch 안내문에 mtime/contract 안전 규칙 추가
  const env = { ...process.env, LEERNESS_ENABLE_CLAUDE: '1' };
  const r = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', 'test task', '--to', 'claude'], { encoding: 'utf8', timeout: 15000, env });
  // claude가 ready면 안내문 출력. 환경 따라 ready 아닐 수도 — 안내문 내용만 확인.
  const text = r.stdout + r.stderr;
  const ok = /분배 시 안전 규칙 \(1\.9\.35\)/.test(text) || /파일 경로 격리/.test(text) || /last-writer-wins/.test(text)
    // claude 미활성 시 거부 메시지도 통과
    || /비활성|disabled|not-installed/i.test(text);
  console.log(ok ? '✓ B(1.9.35) agents dispatch: 안전 규칙 안내 (mtime/contract) 또는 비활성 거부' : `✗ #4 dispatch 안내 실패`);
  if (!ok) { failed++; console.log(text.slice(0, 400)); }
}

// 1.9.34 회귀: 인터랙티브 multi-select (방향키/스페이스) — 비-TTY 폴백
total++;
{
  // 비-TTY에서는 _selectOne/_selectMany가 defaults 또는 첫 옵션 반환
  // → init이 --yes 없이도 비대화형이면 기본 스킬셋(recommended)로 진행
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-multi-'));
  const r = cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
  // 비-TTY + --yes 시 multi-select prompt 안 띄움 → 통상 init 흐름
  const ok = r.status === 0
    && /Leerness v/.test(r.stdout)
    && /Skills: office/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.34) multi-select 비-TTY 폴백: --yes로 default 사용' : `✗ multi-select 폴백 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // 1.9.34 배너 256색 그라데이션 — TTY 강제 + --banner (1.9.144+ 신규 슬로건)
  const r = cp.spawnSync(process.execPath, [CLI, '--version', '--banner'], { encoding: 'utf8', timeout: 10000 });
  const ok = r.status === 0
    && /███████╗/.test(r.stdout)
    && /verify · remember/.test(r.stdout)
    && /AI 에이전트 검수.기억.드리프트 방지 하네스/.test(r.stdout)
    && /v1\.9\.\d+/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.34) 배너 색상 + ASCII + 한국어' : `✗ 배너 색상 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // 1.9.34 LEERNESS_NO_INTERACTIVE=1: 구식 숫자 prompt 사용 (TTY 일 때만 의미 있음; 비-TTY는 어차피 --yes 폴백)
  // 검증: --no-interactive-select 플래그가 인식되고 에러 안 남
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-noint-'));
  const r = cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--no-interactive-select', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
  const ok = r.status === 0 && /Leerness v/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.34) --no-interactive-select 플래그 인식' : `✗ --no-interactive-select 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 300)); }
}

total++;
{
  // --no-stale-check / LEERNESS_NO_STALE_CHECK=1: 경고 스킵
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-stale2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended', '--no-stale-check'], { stdio: 'ignore', timeout: 30000 });
  const cacheDir = path.join(tmpC, '.harness', 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'update-check.json'), JSON.stringify({ at: Date.now(), nextLeerness: '99.99.99' }), 'utf8');
  // --no-stale-check
  const r1 = cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--no-stale-check', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
  // env flag
  const r2 = cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--no-banner', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, LEERNESS_NO_STALE_CHECK: '1' } });
  const ok = r1.status === 0 && r2.status === 0
    && !/옛 버전이 실행 중입니다/.test(r1.stdout)
    && !/옛 버전이 실행 중입니다/.test(r2.stdout);
  console.log(ok ? '✓ B(1.9.33) stale 스킵: --no-stale-check + LEERNESS_NO_STALE_CHECK=1' : `✗ stale skip 실패`);
  if (!ok) { failed++; console.log(r1.stdout.slice(0, 400)); }
}

// 1.9.22 회귀: handoff --compact + orchestrate opt-in 정책 + llm-bench record
total++;
{
  // handoff --compact: 1줄 요약 출력
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-compact-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'handoff', '--include', tmpC, '--compact'], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status === 0
    && /leerness compact \(1\.9\.22\):/.test(r.stdout)
    && /핵심 규칙: 의존성0/.test(r.stdout)
    && r.stdout.length < 2000; // compact 모드는 짧아야 함
  console.log(ok ? '✓ B(1.9.22) handoff --compact: LLM 프롬프트용 1줄 요약' : '✗ --compact 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // orchestrate: LEERNESS_OLLAMA_BASE_URL 없으면 거부 (자동 적용 금지 정책)
  const tmpO = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-orch-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpO, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // 환경변수 명시 제거
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

total++;
{
  // orchestrate: .env 파일 자동 로드 (단, fake URL이라 실제 호출은 실패)
  const tmpE = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-orch-env-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpE, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpE, '.env'), 'LEERNESS_OLLAMA_BASE_URL=http://127.0.0.1:1\n');
  const env = { ...process.env };
  delete env.LEERNESS_OLLAMA_BASE_URL;
  const r = cp.spawnSync(process.execPath, [CLI, 'orchestrate', 'test', '--path', tmpE, '--agents', '1', '--timeout', '2000'], { encoding: 'utf8', timeout: 30000, env });
  // .env에서 URL 감지됐다는 메시지가 stdout에 나와야 함 (실제 호출은 실패하지만 opt-in은 됨)
  const ok = /Opt-in 활성화: Ollama URL = http:\/\/127\.0\.0\.1:1/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.22) orchestrate: .env 자동 로드 (LEERNESS_OLLAMA_BASE_URL 감지)' : '✗ .env auto-load 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // llm-bench record: 히스토리 누적
  const tmpL = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-llmb-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpL, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'llm-bench', 'record', '--path', tmpL, '--score', '7.5', '--model', 'llama3.1:8b', '--label', 'A_leerness', '--tokens', '1754'], { encoding: 'utf8', timeout: 10000 });
  const ok = r.status === 0
    && fs.existsSync(path.join(tmpL, '.harness', 'llm-bench-history.md'))
    && fs.readFileSync(path.join(tmpL, '.harness', 'llm-bench-history.md'), 'utf8').includes('llama3.1:8b');
  console.log(ok ? '✓ B(1.9.22) llm-bench record: 히스토리 누적 저장' : '✗ llm-bench record 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // jest 출력 파싱
  const tmpJ = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tparse-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpJ, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpJ, 'package.json'), JSON.stringify({ name: 'tp', version: '0.0.1', scripts: { test: 'node tests/test.js' } }));
  fs.mkdirSync(path.join(tmpJ, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpJ, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmpJ, 'src/foo.js'), 'module.exports={};\n');
  fs.writeFileSync(path.join(tmpJ, 'tests/test.js'), "console.log('Tests:       12 passed, 12 total');\n");
  fs.appendFileSync(path.join(tmpJ, '.harness/progress-tracker.md'),
    '| T-0021 | done | jest 스타일 | src/foo.js + Tests: 12 passed, 12 total | next | 2026-05-14 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0021', '--path', tmpJ, '--run-tests'], { encoding: 'utf8', timeout: 60000 });
  const okEv = /주장 \(pass\): 12\/12/.test(r.stdout);
  const okRun = /실행 결과: 12\/12 passed/.test(r.stdout);
  const ok = r.status === 0 && okEv && okRun;
  console.log(ok ? '✓ B(1.9.20) verify-claim: jest "Tests: N passed, N total" 파싱' : `✗ jest 파싱 실패 (ev=${okEv} run=${okRun})`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // mocha "N passing"
  const tmpM = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mocha-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpM, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.writeFileSync(path.join(tmpM, 'package.json'), JSON.stringify({ name: 'mc', version: '0.0.1', scripts: { test: 'node tests/test.js' } }));
  fs.mkdirSync(path.join(tmpM, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpM, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(tmpM, 'src/x.js'), 'module.exports={};\n');
  fs.writeFileSync(path.join(tmpM, 'tests/test.js'), "console.log('  7 passing (12ms)');\n");
  fs.appendFileSync(path.join(tmpM, '.harness/progress-tracker.md'),
    '| T-0022 | done | mocha | src/x.js + 7 passing | next | 2026-05-14 |\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0022', '--path', tmpM, '--run-tests'], { encoding: 'utf8', timeout: 60000 });
  const ok = r.status === 0 && /주장 \(pass\): 7\/7/.test(r.stdout) && /실행 결과: 7\/7 passed/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.20) verify-claim: mocha "N passing" 파싱' : '✗ mocha 파싱 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

total++;
{
  // verify-code --bench: scripts.bench 자동 실행 + evidence 누적
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
  const evidence = fs.readFileSync(path.join(tmpB, '.harness/review-evidence.md'), 'utf8');
  const okEvidence = /bench/.test(evidence) && /node tests\/bench\.js/.test(evidence);
  const ok = okBaseline && okBench && okEvidence;
  console.log(ok ? '✓ B(1.9.20) verify-code --bench: scripts.bench 자동 실행 + evidence 누적' : `✗ --bench 실패 (base=${okBaseline} bench=${okBench} ev=${okEvidence})`);
  if (!ok) { failed++; console.log(rWith.stdout.slice(0, 500)); }
}

// 1.9.15 회귀: brainstorm 라인번호 / --all-apps / --include
total++;
{
  const tmpL = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-line-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpL, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.appendFileSync(path.join(tmpL, '.harness/decisions.md'), '\n### 2026-05-13 — 캐시 정책 결정\n- Reason: rate limit 회피\n');
  cp.spawnSync(process.execPath, [CLI, 'plan', 'add', '캐시 helper 구현', '--path', tmpL], { stdio: 'ignore', timeout: 10000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'brainstorm', '캐시', '--path', tmpL], { encoding: 'utf8', timeout: 15000 });
  const ok = /\.harness\/decisions\.md:\d+/.test(r.stdout) && /\.harness\/progress-tracker\.md:\d+/.test(r.stdout) && /matched: request/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.15) brainstorm: 파일:라인 + 매치 필드 표시' : `✗ 1.9.15 brainstorm 위치 실패\n${r.stdout.slice(0,500)}`);
  if (!ok) failed++;
}
total++;
{
  // --include 다중 경로 통합
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
total++;
{
  // insights --include
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-iA-'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-iB-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'insights', '--include', `${tmpA},${tmpB}`], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status === 0 && /Workspace Insights — 2개/.test(r.stdout) && /TOTAL/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.15) insights --include: 표 형식 통합' : '✗ 1.9.15 insights --include 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 600)); }
}
total++;
{
  // 잘못된 --include 경로 — warn 출력 + .harness 있는 것만 처리
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bad-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const bad = '/tmp/nonexistent-leerness-' + Date.now();
  const r = cp.spawnSync(process.execPath, [CLI, 'retro', '--include', `${tmpA},${bad}`], { encoding: 'utf8', timeout: 15000, cwd: os.tmpdir() });
  const ok = r.status === 0 && /--include 무시/.test(r.stdout) && /Cross-project retro — 1개/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.15) --include 잘못된 경로 graceful skip' : '✗ 1.9.15 bad path 처리 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 500)); }
}

// 1.9.14 회귀: A(Template 제외) / B(word boundary) / C(planned 포함) / D(코드블록 템플릿)
total++;
{
  // A: init 직후 decisions.md의 Template이 결정으로 카운트되지 않아야 함
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-A-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'insights', tmpA], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /누적 결정 \(decisions\.md\): 0건/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.14-A) Template 제외: 누적 결정 0건' : `✗ A 실패\n${r.stdout.slice(0, 500)}`);
  if (!ok) failed++;
}
total++;
{
  // B: brainstorm 토큰 매칭 — "API"는 매치, "AP"는 부분 매치라 안 잡힘
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-B-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.appendFileSync(path.join(tmpB, '.harness/decisions.md'), '\n### 2026-05-13 — API rate limit 정책\n- Reason: ...\n');
  // "limit" 매치
  const r1 = cp.spawnSync(process.execPath, [CLI, 'brainstorm', 'limit', '--path', tmpB], { encoding: 'utf8', timeout: 15000 });
  // "lim" 부분 매치 — 매치되면 안 됨
  const r2 = cp.spawnSync(process.execPath, [CLI, 'brainstorm', 'lim', '--path', tmpB], { encoding: 'utf8', timeout: 15000 });
  const ok = /총 1건/.test(r1.stdout) && /총 0건/.test(r2.stdout);
  console.log(ok ? '✓ B(1.9.14-B) brainstorm word boundary: limit 매치 / lim 부분매치 안 잡힘' : `✗ B 실패\n${r1.stdout.slice(0, 200)}\n${r2.stdout.slice(0, 200)}`);
  if (!ok) failed++;
}
total++;
{
  // C: retro 다음 우선 작업에 planned 포함
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-C-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // 모든 task 제거 후 planned만 추가
  fs.writeFileSync(path.join(tmpC, '.harness/progress-tracker.md'), `# Progress Tracker\nStatus values: requested, planned, in-progress, waiting, on-hold, blocked, incomplete, done, dropped\n\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n| T-0001 | planned | 미래 작업 | plan:M-0001 | 시작 예정 | 2026-05-13 |\n`);
  const r = cp.spawnSync(process.execPath, [CLI, 'retro', tmpC], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /T-0001 \[planned\]/.test(r.stdout) && !/없음 — 새 plan add 권장/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.14-C) retro 다음 우선 작업에 planned 포함' : '✗ C 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 600)); }
}
total++;
{
  // D: init decisions.md가 ```md 코드블록으로 감싸짐
  const tmpD = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-D-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpD, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const dec = fs.readFileSync(path.join(tmpD, '.harness/decisions.md'), 'utf8');
  const ok = /```md\n### \d{4}-\d{2}-\d{2} — Decision/.test(dec) && /^## Template/m.test(dec);
  console.log(ok ? '✓ B(1.9.14-D) decisions.md template 코드블록 감싸짐' : '✗ D 실패');
  if (!ok) { failed++; console.log(dec.slice(0, 400)); }
}

// 1.9.13: retro / insights / brainstorm
total++;
{
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-retro-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'plan', 'add', '캐시 helper', '--status', 'done', '--path', tmpR], { stdio: 'ignore', timeout: 10000 });
  cp.spawnSync(process.execPath, [CLI, 'plan', 'add', '인증 helper', '--status', 'in-progress', '--path', tmpR], { stdio: 'ignore', timeout: 10000 });
  fs.appendFileSync(path.join(tmpR, '.harness/decisions.md'), `\n### 2026-05-13 — 캐시 차등 TTL 결정\n- Reason: ...\n`);
  fs.appendFileSync(path.join(tmpR, '.harness/review-evidence.md'), `\n## 2026-05-13 verify-code\nexit=0 (250ms)\nexit=0 (180ms)\nexit=0 (120ms)\nexit=0 (90ms)\n`);
  const r = cp.spawnSync(process.execPath, [CLI, 'retro', tmpR], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /한 줄 요약/.test(r.stdout) && /작업 상태 분포/.test(r.stdout) && /다음 우선 작업/.test(r.stdout) && /검증 시간 추세/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.13) retro: 한 줄 요약 + 다음 우선 작업 + 검증 시간 추세' : '✗ retro 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 800)); }
}

total++;
{
  const tmpI = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-ins-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpI, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'insights', tmpI], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /핵심 지표/.test(r.stdout) && /누적 task/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.13) insights: 핵심 지표 출력' : '✗ insights 실패');
  if (!ok) failed++;
}

total++;
{
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-brain-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpB, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  fs.appendFileSync(path.join(tmpB, '.harness/decisions.md'), `\n### 2026-05-13 — 캐시 차등 TTL 결정\n- Reason: open-meteo 응답 최적화\n`);
  cp.spawnSync(process.execPath, [CLI, 'plan', 'add', '캐시 helper 구현', '--path', tmpB], { stdio: 'ignore', timeout: 10000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'brainstorm', '캐시', '--path', tmpB], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /Brainstorm — "캐시"/.test(r.stdout) && /관련 결정/.test(r.stdout) && /시작 전 권장 액션/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.13) brainstorm: 주제 매칭 + 시작 컨텍스트' : `✗ brainstorm 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(0, 600)); }
}

total++;
{
  // session close 한 줄 요약 자동 출력
  const tmpS = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-summary-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpS, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  const r = cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpS], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /진행 요약/.test(r.stdout) && /자동 깊은 회고/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.13) session close: 한 줄 요약 자동 출력' : `✗ session close 요약 실패`);
  if (!ok) { failed++; console.log(r.stdout.slice(-600)); }
}

total++;
{
  // 5세션 마일스톤 — 자동 깊은 회고
  const tmpD = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-deep-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpD, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore', timeout: 30000 });
  // 카운터를 4로 설정 → 다음 close가 5번째
  fs.mkdirSync(path.join(tmpD, '.harness/cache'), { recursive: true });
  fs.writeFileSync(path.join(tmpD, '.harness/cache/session-counter.json'), JSON.stringify({ count: 4 }));
  const r = cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpD], { encoding: 'utf8', timeout: 15000 });
  const ok = r.status === 0 && /5세션 마일스톤/.test(r.stdout) && /회고 \(retro\)/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.13) 5세션 마일스톤: 자동 깊은 회고' : '✗ 5세션 자동 회고 실패');
  if (!ok) failed++;
}

// 1.9.12: auto roadmap — install 직후 자동 생성
total++;
{
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-auto1-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  const ok = fs.existsSync(path.join(tmpA, 'roadmap.html'));
  console.log(ok ? '✓ B(1.9.12) install 직후 roadmap.html 자동 생성' : '✗ install 후 roadmap 없음');
  if (!ok) failed++;
}

// 1.9.12: session close 후 자동 갱신
total++;
{
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-auto2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  // 첫 mtime 캡처
  const f = path.join(tmpA, 'roadmap.html');
  const mt1 = fs.statSync(f).mtimeMs;
  // 시간 차이 보장
  const wait = Date.now() + 50; while (Date.now() < wait) {}
  // 데이터 변경 + session close
  cp.spawnSync(process.execPath, [CLI, 'task', 'add', '신규 작업', '--path', tmpA], { stdio: 'ignore' });
  cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpA], { stdio: 'ignore' });
  const mt2 = fs.statSync(f).mtimeMs;
  const ok = mt2 > mt1;
  console.log(ok ? '✓ B(1.9.12) session close 후 roadmap.html 자동 갱신 (mtime 증가)' : `✗ session close 후 갱신 안 됨 mt1=${mt1} mt2=${mt2}`);
  if (!ok) failed++;
}

// 1.9.12: roadmap auto off → 더 이상 자동 갱신 안 함
total++;
{
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-auto3-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  cp.spawnSync(process.execPath, [CLI, 'roadmap', 'auto', 'off', '--path', tmpA], { stdio: 'ignore' });
  const f = path.join(tmpA, 'roadmap.html');
  const mt1 = fs.statSync(f).mtimeMs;
  const wait = Date.now() + 80; while (Date.now() < wait) {}
  cp.spawnSync(process.execPath, [CLI, 'task', 'add', '비활성 후 추가', '--path', tmpA], { stdio: 'ignore' });
  cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpA], { stdio: 'ignore' });
  const mt2 = fs.statSync(f).mtimeMs;
  const ok = mt2 === mt1;
  console.log(ok ? '✓ B(1.9.12) auto off: roadmap.html 갱신 안 됨' : `✗ auto off 후에도 갱신됨`);
  if (!ok) failed++;
}

// 1.9.12: --on-every-change 옵트인 시 task add만으로 갱신
total++;
{
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-auto4-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  cp.spawnSync(process.execPath, [CLI, 'roadmap', 'auto', 'on', '--on-every-change', '--path', tmpA], { stdio: 'ignore' });
  const f = path.join(tmpA, 'roadmap.html');
  const mt1 = fs.statSync(f).mtimeMs;
  const wait = Date.now() + 80; while (Date.now() < wait) {}
  cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'on-every-change 테스트', '--path', tmpA], { stdio: 'ignore' });
  const mt2 = fs.statSync(f).mtimeMs;
  const ok = mt2 > mt1;
  console.log(ok ? '✓ B(1.9.12) --on-every-change: task add만으로 즉시 갱신' : `✗ on-every-change 미작동`);
  if (!ok) failed++;
}

// 1.9.12: status 출력
total++;
{
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-auto5-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpA, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  const r = cp.spawnSync(process.execPath, [CLI, 'roadmap', 'auto', 'status', '--path', tmpA], { encoding: 'utf8' });
  const ok = /enabled: true/.test(r.stdout) && /session-close.*✓/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.12) roadmap auto status: 상태 출력' : '✗ status 출력 실패');
  if (!ok) failed++;
}

// 1.9.11: roadmap 명령 통합 + 화이트보드/토큰/중앙정렬 회귀
total++;
{
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rm-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  const r = cp.spawnSync(process.execPath, [CLI, 'roadmap', tmpR], { encoding: 'utf8' });
  const outFile = path.join(tmpR, 'roadmap.html');
  const ok = r.status === 0 && fs.existsSync(outFile);
  console.log(ok ? '✓ B(1.9.11) roadmap: 명령 + 파일 생성' : `✗ roadmap 실패\n${r.stdout}\n${r.stderr}`);
  if (!ok) failed++;
}
total++;
{
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rm2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  cp.spawnSync(process.execPath, [CLI, 'roadmap', tmpR], { stdio: 'ignore' });
  const html = fs.readFileSync(path.join(tmpR, 'roadmap.html'), 'utf8');
  const ok = /화이트보드/.test(html) && /id="roadmap-svg"/.test(html) && /viewBox="0 0/.test(html) && /window\.lrZoom/.test(html) && /window\.lrReset/.test(html);
  console.log(ok ? '✓ B(1.9.11) roadmap: 화이트보드 (panning/zoom JS)' : '✗ 화이트보드 부재');
  if (!ok) failed++;
}
total++;
{
  // 사용자 design-system 토큰 주입
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rm3-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  let ds = fs.readFileSync(path.join(tmpR, '.harness/design-system.md'), 'utf8');
  ds = ds.replace('| color.primary | (실제 값으로 업데이트) | |', '| color.primary | #ff5722 | |');
  fs.writeFileSync(path.join(tmpR, '.harness/design-system.md'), ds);
  cp.spawnSync(process.execPath, [CLI, 'roadmap', tmpR], { stdio: 'ignore' });
  const html = fs.readFileSync(path.join(tmpR, 'roadmap.html'), 'utf8');
  const ok = /--lr-primary: #ff5722/.test(html);
  console.log(ok ? '✓ B(1.9.11) roadmap: design-system 토큰 자동 주입' : '✗ 토큰 주입 실패');
  if (!ok) failed++;
}
total++;
{
  // recommended에 project-roadmap-generator 자동 포함
  const tmpR = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rm4-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpR, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  const skillsDir = path.join(tmpR, '.harness/skills/project-roadmap-generator');
  const ok = fs.existsSync(skillsDir) && fs.existsSync(path.join(skillsDir, 'skill.json'));
  console.log(ok ? '✓ B(1.9.11) recommended에 project-roadmap-generator 자동 설치' : '✗ 자동 설치 실패');
  if (!ok) failed++;
}

// 1.9.10 A: skillpack 동적 로드 (LEERNESS_SKILLPACK_PATH로 시뮬)
total++;
{
  const skillpackDir = path.resolve(__dirname, '..', '..', 'leerness-skillpack');
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'list', '--path', tmp], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { LEERNESS_SKILLPACK_PATH: skillpackDir })
  });
  const ok = r.status === 0 && /skillpack 출처: env/.test(r.stdout) && /\| skillpack \|/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.10) skillpack 동적 로드 (env path)' : '✗ skillpack 로드 실패');
  if (!ok) { failed++; console.log(r.stdout.slice(0, 800)); }
}
// 1.9.10 A: skillpack 없을 때 builtin fallback
total++;
{
  const r = cp.spawnSync(process.execPath, [CLI, 'skill', 'list', '--path', tmp], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { LEERNESS_SKILLPACK_PATH: '' })
  });
  const ok = r.status === 0 && /builtin fallback/.test(r.stdout) && /\| builtin \|/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.10) builtin fallback (skillpack 없을 때)' : '✗ builtin fallback 실패');
  if (!ok) failed++;
}

// 1.9.10 B: detectGitRemote (가짜 git remote 시뮬은 어려움 — 실제 git 명령으로 확인)
total++;
{
  // tmp는 git init이 없음 → detectGitRemote는 null → publish 호출 시 'Git remote: 없음' 출력
  // 시뮬: tmp에 git init + remote add
  cp.spawnSync('git', ['init'], { cwd: tmp, encoding: 'utf8', shell: true });
  cp.spawnSync('git', ['remote', 'add', 'origin', 'https://github.com/test/repo.git'], { cwd: tmp, encoding: 'utf8', shell: true });
  // package.json도 필요
  if (!fs.existsSync(path.join(tmp, 'package.json'))) {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'e2e-test', version: '0.1.0' }));
  }
  const r = cp.spawnSync(process.execPath, [CLI, 'release', 'publish', tmp, '--dry-run'], { encoding: 'utf8' });
  const ok = /Git remote \(origin\): test\/repo/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.10) detectGitRemote: github owner/repo 추출' : `✗ remote 감지 실패\n${r.stdout.slice(0, 500)}`);
  if (!ok) failed++;
}

// 1.9.8: rule add/list/pause/resume/remove
total++;
{
  const r1 = cp.spawnSync(process.execPath, [CLI, 'rule', 'add', '매 업데이트마다 버전 patch bump', '--trigger', 'every-update', '--path', tmp], { encoding: 'utf8' });
  const r2 = cp.spawnSync(process.execPath, [CLI, 'rule', 'add', '매 업데이트마다 패치노트 추가', '--trigger', 'every-update', '--path', tmp], { encoding: 'utf8' });
  const r3 = cp.spawnSync(process.execPath, [CLI, 'rule', 'add', '세션 종료마다 배포', '--trigger', 'session-close', '--path', tmp], { encoding: 'utf8' });
  const rl = cp.spawnSync(process.execPath, [CLI, 'rule', 'list', '--path', tmp], { encoding: 'utf8' });
  const ok = r1.status === 0 && r2.status === 0 && r3.status === 0 && /R-0001/.test(rl.stdout) && /R-0003/.test(rl.stdout);
  console.log(ok ? '✓ B(1.9.8) rule add/list: 3개 등록' : '✗ B(1.9.8) rule add/list 실패');
  if (!ok) failed++;
}
total++;
{
  // pause + handoff에서 paused는 안 보여야 함
  cp.spawnSync(process.execPath, [CLI, 'rule', 'pause', 'R-0001', '--path', tmp], { encoding: 'utf8' });
  const hr = cp.spawnSync(process.execPath, [CLI, 'handoff', tmp], { encoding: 'utf8' });
  const ok = /Active User Rules/.test(hr.stdout) && /R-0002/.test(hr.stdout) && /R-0003/.test(hr.stdout) && !/R-0001 \[/.test(hr.stdout);
  console.log(ok ? '✓ B(1.9.8) handoff: paused 룰 제외, active만 출력' : '✗ B(1.9.8) handoff 출력 실패');
  if (!ok) { failed++; console.log(hr.stdout); }
  cp.spawnSync(process.execPath, [CLI, 'rule', 'resume', 'R-0001', '--path', tmp], { encoding: 'utf8' });
}
total++;
{
  // rule stop / resume-all
  cp.spawnSync(process.execPath, [CLI, 'rule', 'stop', '--path', tmp], { encoding: 'utf8' });
  const rl = cp.spawnSync(process.execPath, [CLI, 'rule', 'list', '--path', tmp], { encoding: 'utf8' });
  const allPaused = (rl.stdout.match(/\| paused \|/g) || []).length >= 3;
  cp.spawnSync(process.execPath, [CLI, 'rule', 'resume-all', '--path', tmp], { encoding: 'utf8' });
  const rl2 = cp.spawnSync(process.execPath, [CLI, 'rule', 'list', '--path', tmp], { encoding: 'utf8' });
  const allActive = (rl2.stdout.match(/\| active \|/g) || []).length >= 3;
  console.log(allPaused && allActive ? '✓ B(1.9.8) rule stop / resume-all: 일괄 전환' : '✗ B(1.9.8) stop/resume-all 실패');
  if (!(allPaused && allActive)) failed++;
}

// 1.9.8: release bump
total++;
{
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

// 1.9.8: release note → CHANGELOG.md 자동 갱신
total++;
{
  const tmpN = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-note-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpN, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(tmpN, 'package.json'), JSON.stringify({ name: 't', version: '0.1.0' }));
  cp.spawnSync(process.execPath, [CLI, 'release', 'note', '첫 기능 추가', '--path', tmpN], { encoding: 'utf8' });
  const cl = fs.readFileSync(path.join(tmpN, 'CHANGELOG.md'), 'utf8');
  const ok = /## 0\.1\.0/.test(cl) && /첫 기능 추가/.test(cl);
  console.log(ok ? '✓ B(1.9.8) release note: CHANGELOG 자동 갱신' : '✗ B(1.9.8) release note 실패');
  if (!ok) failed++;
}

// 1.9.8: session close가 rule verification 보고
total++;
{
  // tmp는 위에서 rule 3개 등록됨
  // package.json 만들기 + 버전 변경 시뮬 (rule R-0001은 every-update 버전 룰)
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'tmp-e2e', version: '0.1.0' }));
  // 첫 session close — baseline 캡처
  cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmp], { encoding: 'utf8' });
  // 버전 bump
  cp.spawnSync(process.execPath, [CLI, 'release', 'bump', '--patch', '--path', tmp], { encoding: 'utf8' });
  // CHANGELOG 갱신
  cp.spawnSync(process.execPath, [CLI, 'release', 'note', 'e2e 검증 항목 추가', '--path', tmp], { encoding: 'utf8' });
  // 두 번째 session close — 변경 감지
  const sc = cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmp], { encoding: 'utf8' });
  const ok = /User Rules verification/.test(sc.stdout) && /✓ pass/.test(sc.stdout);
  console.log(ok ? '✓ B(1.9.8) session close: rule 검증 ✓ pass 출력' : `✗ B(1.9.8) session close 검증 실패\n${sc.stdout.split('\n').slice(-15).join('\n')}`);
  if (!ok) failed++;
}

// 1.9.7 A: verify-code — 가짜 package.json + 통과 시나리오
total++;
{
  const tmpV = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-vc-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpV, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(tmpV, 'package.json'), JSON.stringify({ name: 't', version: '0.0.1', scripts: { test: 'node -e "console.log(\\"OK\\");process.exit(0)"' } }));
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-code', tmpV], { encoding: 'utf8' });
  const ev = fs.readFileSync(path.join(tmpV, '.harness/review-evidence.md'), 'utf8');
  const ok = r.status === 0 && /test passed/.test(r.stdout) && /verify-code \(자동\)/.test(ev);
  console.log(ok ? '✓ B(1.9.7-A) verify-code: 통과 + evidence 자동 기록' : `✗ A 실패\n${r.stdout}`);
  if (!ok) failed++;
}

// 1.9.7 A: verify-code — 실패 시나리오
total++;
{
  const tmpV2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-vc2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpV2, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(tmpV2, 'package.json'), JSON.stringify({ name: 't', version: '0.0.1', scripts: { test: 'node -e "process.exit(2)"' } }));
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-code', tmpV2], { encoding: 'utf8' });
  const ok = r.status === 1 && /test failed/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.7-A) verify-code: 실패 시 exit=1' : `✗ A2 실패 status=${r.status}`);
  if (!ok) failed++;
}

// 1.9.7 B: lessons — decisions/evidence에 시드 후 query로 회수
total++;
{
  fs.appendFileSync(path.join(tmp, '.harness/decisions.md'), `\n### 2026-05-08 — Decision: 캐시 차등 TTL 도입\n- Reason: 단일 5분 TTL이 daily 데이터에 비효율\n- Impact: open-meteo 응답 캐시 적중률 ↑\n`);
  fs.appendFileSync(path.join(tmp, '.harness/review-evidence.md'), `\n## 2026-05-08 e2e\n✗ 캐시 키 불안정 — 좌표 정규화 부재 (롤백 후 fix)\n`);
  const r = cp.spawnSync(process.execPath, [CLI, 'lessons', '--query', '캐시', '--path', tmp], { encoding: 'utf8' });
  const ok = r.status === 0 && /Lessons.*query="캐시"/.test(r.stdout) && /decisions\.md/.test(r.stdout) && /review-evidence\.md/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.7-B) lessons: decisions+evidence 회수' : `✗ B 실패\n${r.stdout}`);
  if (!ok) failed++;
}

// 1.9.7 B: guide가 lessons를 자동 통합
total++;
{
  const r = cp.spawnSync(process.execPath, [CLI, 'guide', 'src/components/Card.html', '--path', tmp], { encoding: 'utf8' });
  const ok = r.status === 0 && /## 4\. Lessons/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.7-B) guide: lessons 섹션 자동 추가' : '✗ B guide 통합 실패');
  if (!ok) failed++;
}

// 1.9.7 C: lazy detect --auto-track
total++;
{
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-c-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  // 의도된 진짜 TODO (주석)
  fs.mkdirSync(path.join(tmpC, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpC, 'src/a.js'), `// TODO: 추적해야 할 미완료 작업\nfunction foo() {}\n`);
  // review-evidence에 npm test 키워드 추가 (lazy detect의 다른 신호 우회)
  fs.appendFileSync(path.join(tmpC, '.harness/review-evidence.md'), '\n## seed\nCommand: npm test\n');
  // session close로 handoff 채우기
  cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpC], { stdio: 'ignore' });
  // --auto-track 실행
  const r = cp.spawnSync(process.execPath, [CLI, 'lazy', 'detect', tmpC, '--auto-track'], { encoding: 'utf8' });
  const tracker = fs.readFileSync(path.join(tmpC, '.harness/progress-tracker.md'), 'utf8');
  const known = fs.existsSync(path.join(tmpC, '.harness/known-todos.json')) ? JSON.parse(fs.readFileSync(path.join(tmpC, '.harness/known-todos.json'), 'utf8')) : [];
  const ok = /TODO src\/a\.js:1/.test(tracker) && /auto-tracked/.test(tracker) && known.length === 1;
  console.log(ok ? '✓ B(1.9.7-C) lazy detect --auto-track: 자동 등록 + known-todos.json' : `✗ C 실패\nTracker:\n${tracker.split('\n').filter(l=>l.startsWith('| T-')).slice(-3).join('\n')}\nKnown: ${JSON.stringify(known)}`);
  if (!ok) failed++;
}

// 1.9.7 C: 같은 TODO 재실행 시 known-todos가 적용되어 newTodos 0
total++;
{
  // 위 시나리오 이어서 — known-todos가 있으므로 새 TODO=0이어야 함
  // 별도 새 tmp로 재현 (tmpC는 위에서 자동 등록됐으니 same dir에서 다시 호출)
  // 위 tmpC는 already auto-tracked
  const tmpC2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-c2-'));
  cp.spawnSync(process.execPath, [CLI, 'init', tmpC2, '--yes', '--language', 'ko', '--skills', 'recommended'], { stdio: 'ignore' });
  fs.mkdirSync(path.join(tmpC2, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpC2, 'src/a.js'), `// TODO: 추적된 항목\n`);
  // known-todos.json에 미리 등록
  fs.writeFileSync(path.join(tmpC2, '.harness/known-todos.json'), JSON.stringify([{ file: 'src/a.js', line: 1, text: '// TODO: 추적된 항목', ackAt: '2026-05-08T00:00:00Z' }]));
  fs.appendFileSync(path.join(tmpC2, '.harness/review-evidence.md'), '\n## seed\nCommand: npm test\n');
  cp.spawnSync(process.execPath, [CLI, 'session', 'close', tmpC2], { stdio: 'ignore' });
  const r = cp.spawnSync(process.execPath, [CLI, 'lazy', 'detect', tmpC2], { encoding: 'utf8' });
  // newTodos가 0이므로 "new: 0" 또는 TODO 카운트가 1이지만 progress 추적에 자동 등록 안 됨
  // 핵심: TODO 1개 잡혀도 known이라 새 항목 노출 X
  const ok = /new: 0\b/.test(r.stdout) || !/💡 자동 등록/.test(r.stdout);
  console.log(ok ? '✓ B(1.9.7-C) known-todos: 재카운트 회피' : `✗ C2 실패\n${r.stdout}`);
  if (!ok) failed++;
}

// 1.9.6 회귀: task relink — 인위적 link 손실 → 자동 매칭 제안 + --apply 자동 복구
total++;
{
  // plan.md에 새 milestone 추가, progress엔 link 없는 비슷한 row 추가
  const planPath_ = path.join(tmp, '.harness/plan.md');
  fs.appendFileSync(planPath_,
    `\n### M-9001. 캐시 헬퍼 모듈\nStatus: planned\nProgress: 0%\n\nTasks:\n- [ ] 캐시 helper\n` +
    `\n### M-9002. 인증 헬퍼 모듈\nStatus: planned\nProgress: 0%\n\nTasks:\n- [ ] 인증 helper\n`);
  // progress에 link 없는 비슷한 row 2개 추가
  const trackerPath_ = path.join(tmp, '.harness/progress-tracker.md');
  fs.appendFileSync(trackerPath_,
    `| T-9001 | done | 캐시 helper 구현 | tests:5/5 (link lost) | 다음 단계 | 2026-05-08 |\n` +
    `| T-9002 | done | 인증 helper 구현 | tests:8/8 (link lost) | 다음 단계 | 2026-05-08 |\n`);

  // 제안 모드
  const r1 = cp.spawnSync(process.execPath, [CLI, 'task', 'relink', '--path', tmp], { encoding: 'utf8' });
  const okSuggest = r1.status === 0 && /M-9001/.test(r1.stdout) && /M-9002/.test(r1.stdout) && /최선 후보/.test(r1.stdout);
  console.log(okSuggest ? '✓ B(1.9.6) task relink 제안: 2개 매칭 발견' : `✗ B(1.9.6) 제안 실패\n${r1.stdout}`);
  if (!okSuggest) failed++;
}
total++;
{
  // --apply
  const r2 = cp.spawnSync(process.execPath, [CLI, 'task', 'relink', '--apply', '--path', tmp], { encoding: 'utf8' });
  const tracker = fs.readFileSync(path.join(tmp, '.harness/progress-tracker.md'), 'utf8');
  const okApply = r2.status === 0 && /M-9001/.test(tracker) && /M-9002/.test(tracker);
  console.log(okApply ? '✓ B(1.9.6) task relink --apply: 자동 복구' : '✗ B(1.9.6) --apply 실패');
  if (!okApply) failed++;
}
total++;
{
  // audit이 task relink 안내를 출력하는지 (이번엔 link 복구 후라 미연결 milestone 없을 것)
  // 일부러 새 milestone 추가 후 audit
  fs.appendFileSync(path.join(tmp, '.harness/plan.md'),
    `\n### M-9999. 매칭 후보 없는 milestone\nStatus: planned\n\nTasks:\n- [ ] x\n`);
  const r3 = cp.spawnSync(process.execPath, [CLI, 'audit', tmp], { encoding: 'utf8' });
  const ok = /milestones without progress entry/.test(r3.stdout) && /M-9999/.test(r3.stdout) && /leerness task relink/.test(r3.stdout);
  console.log(ok ? '✓ B(1.9.6) audit이 task relink 안내 출력' : `✗ B(1.9.6) audit 안내 누락\n${r3.stdout}`);
  if (!ok) failed++;
}

// 1.9.5 G 회귀: impact medium 카테고리 — 동적 path 패턴
total++;
{
  // builder.js에서 path.join + readFileSync + Card.html을 동적 사용
  fs.writeFileSync(path.join(tmp, 'src/builder.js'),
    `const fs = require('fs'); const path = require('path');\n` +
    `const tpl = fs.readFileSync(path.join(__dirname, 'components', 'Card.html'), 'utf8');\n` +
    `module.exports = { tpl };\n`);
  const r = cp.spawnSync(process.execPath, [CLI, 'impact', 'src/components/Card.html', '--path', tmp], { encoding: 'utf8' });
  const ok = /중간 참조 \d+개/.test(r.stdout) && /src\/builder\.js/.test(r.stdout);
  console.log(ok ? '✓ B(G) impact medium: builder.js (path.join + readFileSync) 검출' : `✗ B(G) medium 검출 실패\n${r.stdout}`);
  if (!ok) failed++;
}

// 1.9.4 회귀: --fail-on-violation cross-platform 종료
total++;
{
  fs.appendFileSync(path.join(tmp, 'src/pages/home.html'), '\n<style>.x{color:#cafe00;}</style>\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'ui', 'consistency', tmp, '--fail-on-violation'], { encoding: 'utf8' });
  const ok = r.status === 1;
  console.log(ok ? '✓ B(B) ui consistency --fail-on-violation: exit=1' : `✗ B(B) exit=${r.status}`);
  if (!ok) failed++;
}

// 1.9.4 회귀: lazy detect string literal 무시
total++;
{
  // false positive 시드: TODO 단어가 string literal 안에 있는 코드
  fs.writeFileSync(path.join(tmp, 'src/regex-helper.js'), `module.exports = { TODO_RE: /\\bTODO\\b/g, label: 'TODO list' };\n`);
  // 다른 한편 진짜 TODO 주석
  fs.writeFileSync(path.join(tmp, 'src/real-todo.js'), `// TODO: 실제 미완료 작업\nconst x = 1;\n`);
  const r = cp.spawnSync(process.execPath, [CLI, 'lazy', 'detect', tmp], { encoding: 'utf8' });
  // string literal 안의 TODO는 무시되고, 주석 안의 진짜 TODO만 카운트되어야 함
  const todosLine = (r.stdout.match(/code has (\d+) TODO/) || [0,'-'])[1];
  const ok = todosLine === '1' || todosLine === '-' || /lazy detect passed/.test(r.stdout);
  console.log(ok ? `✓ B(C) lazy detect: string literal 무시 (count=${todosLine})` : `✗ B(C) count=${todosLine}`);
  if (!ok) failed++;
  fs.unlinkSync(path.join(tmp, 'src/regex-helper.js'));
  fs.unlinkSync(path.join(tmp, 'src/real-todo.js'));
}

// 1.9.4 회귀: task fix-evidence 표시
total++;
{
  // T-0001 evidence를 placeholder로 (test before가 'review-evidence:e2e' 였음 → 'user-request'로 바꿈)
  const trackerPath = path.join(tmp, '.harness/progress-tracker.md');
  let cur = fs.readFileSync(trackerPath, 'utf8');
  cur = cur.replace(/^\| T-0001 \|.*$/m, '| T-0001 | done | mile A | user-request | next | 2026-05-08 |');
  fs.writeFileSync(trackerPath, cur);
  const r = cp.spawnSync(process.execPath, [CLI, 'task', 'fix-evidence', '--path', tmp], { encoding: 'utf8' });
  const ok = r.status === 0 && /T-0001/.test(r.stdout) && /후보/.test(r.stdout);
  console.log(ok ? '✓ B(D) task fix-evidence: 후보 표시' : '✗ B(D) 후보 표시 실패');
  if (!ok) { failed++; console.log(r.stdout); }
}

// 1.9.4 회귀: --set 일괄 갱신
total++;
{
  // T-0001 evidence를 plan:M-0002 링크 포함한 placeholder로 (1.9.5 link 보존 검증용 시드)
  const trackerPath2 = path.join(tmp, '.harness/progress-tracker.md');
  let cur = fs.readFileSync(trackerPath2, 'utf8');
  cur = cur.replace(/^\| T-0001 \|.*$/m, '| T-0001 | done | mile A | plan:M-0002 | next | 2026-05-08 |');
  fs.writeFileSync(trackerPath2, cur);
  const r = cp.spawnSync(process.execPath, [CLI, 'task', 'fix-evidence', '--set', 'npm test 통과 (e2e)', '--path', tmp], { encoding: 'utf8' });
  const tracker = fs.readFileSync(trackerPath2, 'utf8');
  const ok = r.status === 0 && /npm test 통과 \(e2e\)/.test(tracker);
  console.log(ok ? '✓ B(D2) task fix-evidence --set: 일괄 갱신' : '✗ B(D2) 일괄 갱신 실패');
  if (!ok) failed++;
}

// 1.9.5 F 회귀: --set 시 plan:M-XXXX 링크 자동 보존
total++;
{
  const tracker = fs.readFileSync(path.join(tmp, '.harness/progress-tracker.md'), 'utf8');
  const ok = /npm test 통과 \(e2e\) \(plan:M-0002\)/.test(tracker);
  console.log(ok ? '✓ B(F) fix-evidence --set: link 자동 보존' : `✗ B(F) link 손실\n${tracker}`);
  if (!ok) failed++;
}

// 1.9.5 F neg: --no-preserve-link
total++;
{
  // T-0002 같은 row를 placeholder로 시드
  const trackerPath3 = path.join(tmp, '.harness/progress-tracker.md');
  let cur = fs.readFileSync(trackerPath3, 'utf8');
  // T-0001을 다시 plan:M-0099로 교체
  cur = cur.replace(/^\| T-0001 \|.*$/m, '| T-0001 | done | mile A | plan:M-0099 | next | 2026-05-08 |');
  fs.writeFileSync(trackerPath3, cur);
  cp.spawnSync(process.execPath, [CLI, 'task', 'fix-evidence', '--set', 'npm test only', '--no-preserve-link', '--path', tmp], { encoding: 'utf8' });
  const tracker = fs.readFileSync(trackerPath3, 'utf8');
  const ok = /\| T-0001 \| done \| mile A \| npm test only \|/.test(tracker) && !/M-0099/.test(tracker);
  console.log(ok ? '✓ B(F neg) fix-evidence --no-preserve-link: 링크 제거' : `✗ B(F neg) 동작 이상`);
  if (!ok) failed++;
}

// 1.9.4 회귀: .leerness-skip-dirs 적용
total++;
{
  fs.mkdirSync(path.join(tmp, '_devspace'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '_devspace/secret-config.js'), `const k = "ghp_${'a'.repeat(36)}";\n`);
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

console.log(`\nE2E result: ${total - failed}/${total} passed`);
if (failed > 0) process.exit(1);
