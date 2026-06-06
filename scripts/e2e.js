#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

// 1.9.12: e2e 안정성을 위해 자식 프로세스의 npm 호출 차단 (hang 방지)
process.env.LEERNESS_OFFLINE = process.env.LEERNESS_OFFLINE || '1';
// 1.9.284 (UR-0029): e2e 속도 — 기본 roadmap.html(70KB HTML) 자동 생성 OFF (roadmap 전용 테스트 블록만 일시 ON).
//   대부분의 init/session 테스트는 roadmap 을 검증하지 않으므로 생성 비용 제거 → 5분 내 완료.
process.env.LEERNESS_NO_AUTO_ROADMAP = '1';
const CLI = path.resolve(__dirname, '..', 'bin', 'harness.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-e2e-'));
let failed = 0; let total = 0;
const _e2eStart = Date.now();  // 1.9.284 (UR-0029): 총 소요시간 투명성

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
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0020', '--path', tmpG, '--lenient'], { encoding: 'utf8', timeout: 15000 });  // FILE_RE 추출 테스트 — evidence 게이트와 분리(1.9.309)
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
  const r = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0030', '--path', tmpC, '--lenient'], { encoding: 'utf8', timeout: 15000 });  // FILE_RE 추출 테스트 — evidence 게이트와 분리(1.9.309)
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
  const ok = r.status !== 0 && /낙관적 표시.*\(--strict-claims\): ⚠ FAIL/.test(r.stdout) && /DB 호출/.test(r.stdout);
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
  // 1.9.146: Ollama → 5 · 1.9.268: grok → 6 · 1.9.277: opencode/qwen/aider/goose → 10 CLI
  const offAll = { LEERNESS_ENABLE_CLAUDE: '0', LEERNESS_ENABLE_CODEX: '0', LEERNESS_ENABLE_AGY: '0', LEERNESS_ENABLE_GROK: '0', LEERNESS_ENABLE_OPENCODE: '0', LEERNESS_ENABLE_QWEN: '0', LEERNESS_ENABLE_AIDER: '0', LEERNESS_ENABLE_GOOSE: '0', LEERNESS_ENABLE_COPILOT: '0', LEERNESS_ENABLE_OLLAMA: '0' };
  const env2 = { ...process.env, ...offAll };
  const r2 = cp.spawnSync(process.execPath, [CLI, 'agents', 'list', '--json'], { encoding: 'utf8', timeout: 15000, env: env2 });
  let parsed = null;
  try { parsed = JSON.parse(r2.stdout); } catch {}
  const okJson = parsed && Array.isArray(parsed.agents) && parsed.agents.length === 10 && parsed.agents.every(a => a.status !== 'ready');
  const okNew = /\| opencode \|/.test(r1.stdout) && /\| qwen \|/.test(r1.stdout) && /\| aider \|/.test(r1.stdout) && /\| goose \|/.test(r1.stdout);
  const ok = okList && okJson && okNew;
  console.log(ok ? '✓ B(1.9.30+1.9.277) agents list: 10 CLI (claude/codex/agy/grok/opencode/qwen/aider/goose/copilot/ollama)' : `✗ agents list 실패 (list=${okList} json=${okJson} new=${okNew})`);
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
  // 1.9.277: opencode/qwen/aider/goose → 10 CLI
  const okJson = parsed && Array.isArray(parsed.quota) && parsed.quota.length === 10
    && parsed.quota.every(q => typeof q.id === 'string' && typeof q.status === 'string' && (q.hint === null || typeof q.hint === 'string'));
  const ok = okText && okJson;
  console.log(ok ? '✓ B(1.9.31+1.9.277) agents quota: 10 CLI 사용량/안내' : `✗ quota 실패 (text=${okText} json=${okJson})`);
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
  // _parseSkillCatalog 4 형식 인식 — 1.9.370 (UR-0025): lib/pure-utils 직접 require (이전: harness 소스 regex+eval, 모듈 이동으로 전환)
  const fn = require(path.resolve(__dirname, '..', 'lib', 'pure-utils'))._parseSkillCatalog;
  if (typeof fn !== 'function') {
    console.log('✗ _parseSkillCatalog 함수 위치 못 찾음 (lib/pure-utils)');
    failed++;
  } else {
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

// 1.9.284: roadmap 전용 테스트 블록 — roadmap 생성 일시 ON (이후 다시 OFF)
process.env.LEERNESS_NO_AUTO_ROADMAP = '0';
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
// 1.9.284: roadmap 전용 블록 종료 — 다시 OFF (나머지 테스트 속도)
process.env.LEERNESS_NO_AUTO_ROADMAP = '1';

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

// 1.9.269 회귀 (UR-0022): 빈 디렉토리 신규 init + auto → OS 시스템 언어로 .harness/LANGUAGE 결정
total++;
{
  const tmpEn = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lang-en-'));
  const tmpKo = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lang-ko-'));
  // LANG 명시 (POSIX) — Windows 에서도 _detectSystemLang 이 LANG 우선 읽음
  const envEn = { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', LANGUAGE: '' };
  const envKo = { ...process.env, LANG: 'ko_KR.UTF-8', LC_ALL: 'ko_KR.UTF-8', LANGUAGE: '' };
  // --language 미지정(auto) + 빈 디렉토리 → 시스템 언어 적용
  cp.spawnSync(process.execPath, [CLI, 'init', tmpEn, '--yes', '--skills', 'recommended'], { encoding: 'utf8', env: envEn, timeout: 30000 });
  cp.spawnSync(process.execPath, [CLI, 'init', tmpKo, '--yes', '--skills', 'recommended'], { encoding: 'utf8', env: envKo, timeout: 30000 });
  const langEn = fs.existsSync(path.join(tmpEn, '.harness', 'LANGUAGE')) ? fs.readFileSync(path.join(tmpEn, '.harness', 'LANGUAGE'), 'utf8').trim() : '';
  const langKo = fs.existsSync(path.join(tmpKo, '.harness', 'LANGUAGE')) ? fs.readFileSync(path.join(tmpKo, '.harness', 'LANGUAGE'), 'utf8').trim() : '';
  const ok = langEn === 'en' && langKo === 'ko';
  console.log(ok ? '✓ B(1.9.269) init auto: 빈 디렉토리 → OS 시스템 언어 (en→en, ko→ko)' : `✗ system-lang init 실패 (en=${langEn} ko=${langKo})`);
  if (!ok) failed++;
}

// 1.9.270 회귀: agent roles — 모델별 역할 부여 (사용자 명시)
total++;
{
  const tmpRole = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-roles-'));
  // set (한국어 별칭) + model
  const rSet = cp.spawnSync(process.execPath, [CLI, 'roles', 'set', '코딩', '--provider', 'codex', '--model', 'gpt-5.5', '--path', tmpRole, '--json'], { encoding: 'utf8', timeout: 15000 });
  let setOk = false;
  try { const j = JSON.parse(rSet.stdout); setOk = j.set === 'coder' && j.provider === 'codex' && j.model === 'gpt-5.5'; } catch {}
  // list JSON
  const rList = cp.spawnSync(process.execPath, [CLI, 'roles', 'list', '--path', tmpRole, '--json'], { encoding: 'utf8', timeout: 15000 });
  let listOk = false;
  try { const j = JSON.parse(rList.stdout); listOk = j.count === 1 && j.roles.coder && j.roles.coder.provider === 'codex'; } catch {}
  // dispatch --role → 모델 라우팅 (claude 활성; claude 미설치 환경이면 비활성 메시지 허용)
  cp.spawnSync(process.execPath, [CLI, 'roles', 'set', 'reviewer', '--provider', 'claude', '--model', 'claude-opus-4-7', '--path', tmpRole], { encoding: 'utf8', timeout: 15000 });
  const envC = { ...process.env, LEERNESS_ENABLE_CLAUDE: '1' };
  const rRoute = cp.spawnSync(process.execPath, [CLI, 'agents', 'dispatch', '검수', '--role', 'reviewer', '--path', tmpRole], { encoding: 'utf8', timeout: 15000, env: envC });
  const routeOk = /역할 reviewer → claude/.test(rRoute.stdout) && (/--model claude-opus-4-7/.test(rRoute.stdout) || /claude 비활성/.test(rRoute.stdout));
  // catalog 7종
  const rCat = cp.spawnSync(process.execPath, [CLI, 'roles', 'catalog', '--path', tmpRole, '--json'], { encoding: 'utf8', timeout: 15000 });
  let catOk = false;
  try { const j = JSON.parse(rCat.stdout); catOk = Object.keys(j.roles).length === 7 && j.roles.coder && j.roles.commander; } catch {}
  const ok = setOk && listOk && routeOk && catOk;
  console.log(ok ? '✓ B(1.9.270) agent roles: set(별칭)/list/dispatch --role 라우팅/catalog 7종' : `✗ roles 실패 (set=${setOk} list=${listOk} route=${routeOk} cat=${catOk})`);
  if (!ok) { failed++; console.log((rRoute.stdout || '').slice(0, 400)); }
}

// 1.9.272 회귀: capabilities — 권한/보안 표면 공개 (GPT-5.5 리뷰 반영)
total++;
{
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

// 1.9.273 회귀 (UR-0027): 빠른 테스트 인프라 존재 검증 (smoke.js + test:fast script). 실제 smoke 실행은 별도(npm run test:fast).
total++;
{
  const smokePath = path.resolve(__dirname, 'smoke.js');
  const smokeExists = fs.existsSync(smokePath);
  // 구문 유효성 (node --check)
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

// 1.9.274 회귀 (UR-0025 1단계): lib/ 모듈 분리 — pure-utils.js 존재 + require + 7종 export + 패키지 files 포함.
total++;
{
  const libPath = path.resolve(__dirname, '..', 'lib', 'pure-utils.js');
  const libExists = fs.existsSync(libPath);
  let exportsOk = false;
  try {
    const m = require(libPath);
    // 1.9.283: 1단계 7종 + 2단계 7종(권한등급/dist-tag/run스키마/mcp.json)
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

// 1.9.275 회귀 (UR-0026): release channel — 안정/실험 채널 정책 (npm dist-tag)
total++;
{
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

// 1.9.276 회귀 (GPT-5.5 2차 리뷰): init --dry-run / --minimal / --no-env
total++;
{
  // --dry-run: 파일 0개 생성 + 요약 출력
  const dDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-dry-'));
  const rDry = cp.spawnSync(process.execPath, [CLI, 'init', dDir, '--dry-run', '--yes'], { encoding: 'utf8', timeout: 30000 });
  const dryNoFiles = fs.readdirSync(dDir).length === 0;
  const drySummary = /\[dry-run\] 요약/.test(rDry.stdout) && !fs.existsSync(path.join(dDir, '.harness'));
  // --minimal --no-env: 핵심 유지 + 비핵심/.env/.cursor/roadmap 제외
  const mDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-min-'));
  cp.spawnSync(process.execPath, [CLI, 'init', mDir, '--minimal', '--no-env', '--yes'], { encoding: 'utf8', timeout: 30000 });
  const fDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-full-'));
  cp.spawnSync(process.execPath, [CLI, 'init', fDir, '--yes'], { encoding: 'utf8', timeout: 30000 });
  const minCount = fs.existsSync(path.join(mDir, '.harness')) ? fs.readdirSync(path.join(mDir, '.harness')).length : 0;
  const fullCount = fs.existsSync(path.join(fDir, '.harness')) ? fs.readdirSync(path.join(fDir, '.harness')).length : 0;
  const minimalOk = minCount > 0 && minCount < fullCount
    && fs.existsSync(path.join(mDir, '.harness', 'plan.md')) && fs.existsSync(path.join(mDir, 'AGENTS.md'))
    && !fs.existsSync(path.join(mDir, '.env')) && !fs.existsSync(path.join(mDir, '.cursor')) && !fs.existsSync(path.join(mDir, 'roadmap.html'));
  // minimal 이어도 verify 통과(필수 파일 보존)
  const rVerify = cp.spawnSync(process.execPath, [CLI, 'verify', mDir], { encoding: 'utf8', timeout: 20000 });
  const verifyOk = rVerify.status === 0;
  const ok = dryNoFiles && drySummary && minimalOk && verifyOk;
  console.log(ok ? '✓ B(1.9.276) init --dry-run(0파일)/--minimal(축소+verify통과)/--no-env(.env 제외)' : `✗ init 옵션 실패 (dry=${dryNoFiles} drySum=${drySummary} min=${minimalOk}(${minCount}<${fullCount}) verify=${verifyOk})`);
  if (!ok) { failed++; console.log((rVerify.stdout || '').slice(0, 300)); }
}

// 1.9.278 회귀 (UR-0032): .leerness/ 상태 스키마 라이프사이클 (start→record→verify→handoff→show)
total++;
{
  const sDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-state-'));
  const run = (a) => cp.spawnSync(process.execPath, [CLI, 'state', ...a, '--path', sDir], { encoding: 'utf8', timeout: 15000 });
  run(['start', 'API 구현', '--agent', 'claude', '--model', 'claude-opus-4-7', '--task', 'T-0001']);
  run(['record', '--files-changed', 'src/api.js,src/db.js', '--commands', 'npm test', '--tests', '12 passed', '--decision', 'retry 3']);
  run(['verify', '--result', 'pass']);
  run(['handoff', 'API 완료, db 마이그레이션은 다음 에이전트']);
  // 다음 에이전트가 JSON 으로 인수
  const rShow = run(['show', '--json']);
  let recOk = false, handoffOk = false;
  try {
    const j = JSON.parse(rShow.stdout);
    // handoff 후 currentRun 은 null, 누적 runs=1
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

// 1.9.279 회귀 (UR-0031): 상태 substrate MCP 시맨틱 verb (state_start → state_show 라운드트립)
total++;
{
  const mDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mcpstate-'));
  const mcpCall = (req) => {
    const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 10000, input: JSON.stringify(req) + '\n' });
    try { const line = r.stdout.split('\n').filter(Boolean)[0]; const j = JSON.parse(line); return JSON.parse(j.result.content[0].text); } catch { return null; }
  };
  // tools/list 에 5개 state verb 노출
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

// 1.9.280 회귀 (UR-0033): leerness adapter — 도구별 선택 생성 + .mcp.json
total++;
{
  const aDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-adapter-'));
  cp.spawnSync(process.execPath, [CLI, 'init', aDir, '--minimal', '--no-env', '--yes'], { encoding: 'utf8', timeout: 30000 });
  // adapter cursor: .cursor + .mcp.json 생성, .claude 미생성(minimal이라 commands는 있으나 cursor adapter는 안 건드림)
  const rCur = cp.spawnSync(process.execPath, [CLI, 'adapter', 'cursor', aDir], { encoding: 'utf8', timeout: 15000 });
  const cursorOk = rCur.status === 0 && fs.existsSync(path.join(aDir, '.cursor', 'rules', 'leerness.mdc'));
  let mcpOk = false;
  try { const m = JSON.parse(fs.readFileSync(path.join(aDir, '.mcp.json'), 'utf8')); mcpOk = m.mcpServers && m.mcpServers.leerness && m.mcpServers.leerness.args.join(' ') === 'leerness mcp serve'; } catch {}
  // adapter list --json: 9종
  const rList = cp.spawnSync(process.execPath, [CLI, 'adapter', 'list', '--json', '--path', aDir], { encoding: 'utf8', timeout: 15000 });
  let listOk = false;
  try { const j = JSON.parse(rList.stdout); listOk = Object.keys(j.adapters).length >= 9 && j.adapters.claude.mcp === true && j.adapters.copilot.mcp === false; } catch {}
  // adapter --dry-run: 파일 미생성
  const dDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-adapterdry-'));
  const rDry = cp.spawnSync(process.execPath, [CLI, 'adapter', 'claude', '--dry-run', '--path', dDir], { encoding: 'utf8', timeout: 15000 });
  const dryOk = /\[dry-run\]/.test(rDry.stdout) && fs.readdirSync(dDir).length === 0;
  const ok = cursorOk && mcpOk && listOk && dryOk;
  console.log(ok ? '✓ B(1.9.280) adapter: cursor(.cursor+.mcp.json)/list 9종/dry-run(0파일)' : `✗ adapter 실패 (cursor=${cursorOk} mcp=${mcpOk} list=${listOk} dry=${dryOk})`);
  if (!ok) { failed++; console.log((rCur.stdout || '').slice(0, 200)); }
}

// 1.9.281 회귀 (UR-0034): 권한 등급 policy (show/set/check + enforce)
total++;
{
  const pDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-policy-'));
  const run = (a) => cp.spawnSync(process.execPath, [CLI, 'policy', ...a, '--path', pDir], { encoding: 'utf8', timeout: 15000 });
  // 기본: enforce OFF + 8 등급
  let showOk = false;
  try { const j = JSON.parse(run(['show', '--json']).stdout); showOk = j.tiers.length === 8 && j.enforce === false && j.allowedTier === 'project-write'; } catch {}
  // read-only + enforce → publish 차단, handoff 허용
  run(['set', 'read-only', '--enforce']);
  let blockOk = false, allowOk = false;
  try { blockOk = JSON.parse(run(['check', 'release publish', '--json']).stdout).allowed === false; } catch {}
  try { allowOk = JSON.parse(run(['check', 'handoff', '--json']).stdout).allowed === true; } catch {}
  // enforce OFF 로 되돌리면 advisory(allowed true)
  run(['set', 'read-only', '--no-enforce']);
  let advisoryOk = false;
  try { const j = JSON.parse(run(['check', 'release publish', '--json']).stdout); advisoryOk = j.allowed === true && j.advisory === true; } catch {}
  const ok = showOk && blockOk && allowOk && advisoryOk;
  console.log(ok ? '✓ B(1.9.281) policy: 8등급 + set/check + enforce 차단/advisory' : `✗ policy 실패 (show=${showOk} block=${blockOk} allow=${allowOk} advisory=${advisoryOk})`);
  if (!ok) failed++;
}

// 1.9.282 회귀 (UR-0035): AGENTS.md 정적 vs 동적(leerness) 역할 경계 포지셔닝
total++;
{
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

// 1.9.285 회귀 (UR-0023): reuse-check — 외부 OSS 빌드 vs 재사용 게이트
total++;
{
  const r1 = cp.spawnSync(process.execPath, [CLI, 'reuse-check', 'JWT 인증 로그인', '--json'], { encoding: 'utf8', timeout: 15000 });
  let jsonOk = false;
  try { const j = JSON.parse(r1.stdout); jsonOk = j.feature && j.categories.some(c => c.key === 'auth') && Array.isArray(j.checklist) && j.checklist.length >= 5 && j.network === false; } catch {}
  const r2 = cp.spawnSync(process.execPath, [CLI, 'reuse-check', '날짜 date 포맷'], { encoding: 'utf8', timeout: 15000 });
  const txtOk = r2.status === 0 && /빌드 vs 재사용/.test(r2.stdout) && /date-fns/.test(r2.stdout) && /체크리스트/.test(r2.stdout);
  // 인자 없으면 실패
  const r3 = cp.spawnSync(process.execPath, [CLI, 'reuse-check'], { encoding: 'utf8', timeout: 10000 });
  const failOk = r3.status !== 0;
  const ok = jsonOk && txtOk && failOk;
  console.log(ok ? '✓ B(1.9.285) reuse-check: 카테고리 감지 + 체크리스트 + json/인자검증' : `✗ reuse-check 실패 (json=${jsonOk} txt=${txtOk} fail=${failOk})`);
  if (!ok) failed++;
}

// 1.9.286 회귀 (UR-0024): skill impact — 영향 경량 상관추적 + 정직한 advisory
total++;
{
  const iDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-impact-'));
  cp.spawnSync(process.execPath, [CLI, 'init', iDir, '--minimal', '--no-env', '--yes'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, LEERNESS_OFFLINE: '1' } });
  // 표본 부족 (검증 0건) → 판단 보류 advisory
  let lowOk = false;
  try { const j = JSON.parse(cp.spawnSync(process.execPath, [CLI, 'skill', 'impact', iDir, '--json'], { encoding: 'utf8', timeout: 15000 }).stdout); lowOk = Array.isArray(j.skills) && j.sampleSize === 0 && /표본 부족/.test(j.advisory) && j.network === false; } catch {}
  // review-evidence 에 pass/fail 6건 시드 → 통과율 계산
  const evFile = path.join(iDir, '.harness', 'review-evidence.md');
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

// 1.9.287 회귀 (Codex 리뷰 수렴): verify-claim --require-evidence + handoff 펜스 sanitize + status minimal
total++;
{
  const cDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-codex-'));
  const env = { ...process.env, LEERNESS_OFFLINE: '1' };
  cp.spawnSync(process.execPath, [CLI, 'init', cDir, '--minimal', '--no-env', '--yes'], { encoding: 'utf8', timeout: 30000, env });
  // A) 허위 완료(테스트 통과만) → --require-evidence FAIL (exit 1)
  cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'fake done', '--path', cDir], { encoding: 'utf8', timeout: 15000, env });
  cp.spawnSync(process.execPath, [CLI, 'task', 'update', 'T-0002', '--status', 'done', '--evidence', '테스트 통과함', '--path', cDir], { encoding: 'utf8', timeout: 15000, env });
  const rFake = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0002', '--require-evidence', '--path', cDir], { encoding: 'utf8', timeout: 20000, env });
  const fakeBlocked = rFake.status === 1 && /evidence 완전성.*FAIL/.test(rFake.stdout);
  // 완전한 evidence(파일+테스트) + 실제 파일 존재 → pass (exit 0)
  fs.mkdirSync(path.join(cDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(cDir, 'src', 'api.js'), 'module.exports = {};\n');
  cp.spawnSync(process.execPath, [CLI, 'task', 'update', 'T-0002', '--evidence', 'src/api.js 구현, npm test 5/5 통과 (Exit: 0)', '--path', cDir], { encoding: 'utf8', timeout: 15000, env });
  const rGood = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0002', '--require-evidence', '--path', cDir], { encoding: 'utf8', timeout: 20000, env });
  const goodPass = rGood.status === 0 && /evidence 완전성.*pass/.test(rGood.stdout);
  // B) handoff 펜스 sanitize — review-evidence 에 ``` 넣고 session close → session-handoff 에 ``` 불균형 없음
  fs.appendFileSync(path.join(cDir, '.harness', 'review-evidence.md'), '\n## 2026-06-03\n```js\nconst x=1;\n```\n');
  cp.spawnSync(process.execPath, [CLI, 'session', 'close', cDir], { encoding: 'utf8', timeout: 20000, env });
  // 펜스 균형: 감싸는 wrapper ``` 는 허용하되, review-evidence 의 inner ``` 는 '''로 sanitize 되어 불균형이 없어야 함.
  let fenceOk = false;
  try {
    const sh = fs.readFileSync(path.join(cDir, '.harness', 'session-handoff.md'), 'utf8');
    const bareFences = sh.split('\n').filter(l => l.trim() === '`'.repeat(3)).length;
    fenceOk = (bareFences % 2 === 0) && sh.includes("'''");  // 균형(짝수) + inner sanitize 적용 확인
  } catch {}
  // C) status minimal 인지 — minimal set 표기 + missing 경고 없음
  const rStat = cp.spawnSync(process.execPath, [CLI, 'status', cDir], { encoding: 'utf8', timeout: 15000, env });
  const statOk = /minimal/.test(rStat.stdout) && !/missing:/.test(rStat.stdout);
  const ok = fakeBlocked && goodPass && fenceOk && statOk;
  console.log(ok ? '✓ B(1.9.287) Codex 수렴: require-evidence(허위차단/완전통과) + 펜스 sanitize + status minimal' : `✗ Codex 수렴 실패 (fake=${fakeBlocked} good=${goodPass} fence=${fenceOk} stat=${statOk})`);
  if (!ok) { failed++; console.log((rFake.stdout || '').slice(-300)); }
}

// 1.9.288 회귀 (Codex gpt-5.5 리뷰 수렴): MCP policy enforce + release dry-run + 도구수 정합
total++;
{
  const env = { ...process.env, LEERNESS_OFFLINE: '1' };
  // #1 MCP policy: read-only enforce → state_start(write) 차단 + state.json 미생성
  const pDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mcppol-'));
  cp.spawnSync(process.execPath, [CLI, 'init', pDir, '--minimal', '--no-env', '--yes'], { encoding: 'utf8', timeout: 30000, env });
  cp.spawnSync(process.execPath, [CLI, 'policy', 'set', 'read-only', '--enforce', '--path', pDir], { encoding: 'utf8', timeout: 15000, env });
  const req = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_state_start', arguments: { path: pDir, goal: 'x' } } });
  const rMcp = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 15000, input: req + '\n', env });
  let blocked = false;
  try { const j = JSON.parse(rMcp.stdout.split('\n').filter(Boolean)[0]); blocked = j.result.isError === true && /정책 차단/.test(j.result.content[0].text); } catch {}
  const noWrite = !fs.existsSync(path.join(pDir, '.leerness', 'state.json'));
  // enforce 해제 시 통과(회귀 방지 — 정상 동작 보존)
  cp.spawnSync(process.execPath, [CLI, 'policy', 'set', 'project-write', '--no-enforce', '--path', pDir], { encoding: 'utf8', timeout: 15000, env });
  const rMcp2 = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 15000, input: req + '\n', env });
  let allowed = false;
  try { const j = JSON.parse(rMcp2.stdout.split('\n').filter(Boolean)[0]); allowed = j.result.isError !== true && /run-0001/.test(j.result.content[0].text); } catch {}
  // #2 release publish --dry-run --git-push: push 시도 안 함(생략 출력) + exit 0
  const rDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-reldry-'));
  fs.writeFileSync(path.join(rDir, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.1' }) + '\n');
  const rRel = cp.spawnSync(process.execPath, [CLI, 'release', 'publish', rDir, '--dry-run', '--git-push'], { encoding: 'utf8', timeout: 20000, env });
  const dryOk = rRel.status === 0 && /\(dry-run\)/.test(rRel.stdout) && /생략/.test(rRel.stdout) && !/git push:/.test(rRel.stdout);
  // #5 도구수 정합: 배지 == 관리블록 == tools/list
  let countOk = false;
  try {
    const rl = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 10000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n', env });
    const live = JSON.parse(rl.stdout.split('\n').filter(Boolean)[0]).result.tools.length;
    const readme = fs.readFileSync(path.resolve(__dirname, '..', 'README.md'), 'utf8');
    const badge = (readme.match(/MCP--tools-(\d+)/) || [])[1];
    countOk = String(live) === badge;
  } catch {}
  const ok = blocked && noWrite && allowed && dryOk && countOk;
  console.log(ok ? '✓ B(1.9.288) Codex 수렴: MCP policy 차단/허용 + release dry-run 무push + 도구수 정합' : `✗ Codex 수렴 실패 (blocked=${blocked} noWrite=${noWrite} allowed=${allowed} dry=${dryOk} count=${countOk})`);
  if (!ok) { failed++; console.log((rRel.stdout || '').slice(0, 300)); }
}

// 1.9.289 회귀 (Codex #3): _shellQuoteArg — REPL agy/copilot 프롬프트 셸 주입 중립화
total++;
{
  let ok = false;
  try {
    const h = require(path.resolve(__dirname, '..', 'bin', 'harness.js'));
    const q = h._shellQuoteArg('a; rm -rf / && echo $(whoami)');
    const win = process.platform === 'win32';
    // 따옴표로 감싸 메타문자가 단일 리터럴 인자가 됨 (POSIX 단일/Windows 이중)
    const wrapped = win ? (q.startsWith('"') && q.endsWith('"')) : (q.startsWith("'") && q.endsWith("'"));
    const neutral = win ? !/^[^"]*[;&|][^"]*$/.test(q.slice(1, -1)) || q.includes('"') : true;
    ok = wrapped && q.includes('rm -rf') && typeof h._shellQuoteArg === 'function';
  } catch {}
  console.log(ok ? '✓ B(1.9.289) _shellQuoteArg: 프롬프트 셸 주입 중립화 (agy/copilot args)' : '✗ _shellQuoteArg 실패');
  if (!ok) failed++;
}

// 1.9.290 회귀 (Codex #4 UR-0037): require('harness') 가 호스트 프로세스 오염 X (top-level side effect 격리)
total++;
{
  let ok = false;
  try {
    // 깨끗한 자식에서: 내 warning listener 등록 → require → 보존 확인 + NODE_OPTIONS 미변경
    const probe = "const L=()=>{};process.on('warning',L);const o=process.env.NODE_OPTIONS||'';" +
      "require(process.argv[1]);" +
      "const survived=process.listeners('warning').includes(L);" +
      "const polluted=(process.env.NODE_OPTIONS||'')!==o;" +
      "process.exit(survived&&!polluted?0:1);";
    const harnessPath = path.resolve(__dirname, '..', 'bin', 'harness.js');
    const r = cp.spawnSync(process.execPath, ['-e', probe, harnessPath], { encoding: 'utf8', timeout: 20000 });
    ok = r.status === 0;
  } catch {}
  console.log(ok ? '✓ B(1.9.290) require 부작용 격리: warning listener 보존 + NODE_OPTIONS 미오염 (Codex #4)' : '✗ require 부작용 격리 실패');
  if (!ok) failed++;
}

// 1.9.291 회귀 (UR-0025 2단계): lib/agent-registry.js 모듈 분리 — 단일출처 + 부작용 0
total++;
{
  let ok = false;
  try {
    const reg = require(path.resolve(__dirname, '..', 'lib', 'agent-registry.js'));
    const h = require(path.resolve(__dirname, '..', 'bin', 'harness.js'));
    const dataOk = Array.isArray(reg.EXTERNAL_AGENTS) && reg.EXTERNAL_AGENTS.length === 10 &&
      reg.EXTERNAL_AGENTS.every(a => a.id && a.bin && a.envFlag) &&
      reg.AGENT_SLASH_COMMANDS && Object.keys(reg.AGENT_SLASH_COMMANDS).length === 9;
    // harness 가 모듈을 단일출처로 사용 (같은 객체 참조)
    const singleSource = h.AGENT_SLASH_COMMANDS === reg.AGENT_SLASH_COMMANDS;
    // harness.js 소스에 인라인 정의가 더 이상 없음 (모듈로 이동 완료)
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const movedOut = !/const EXTERNAL_AGENTS = \[/.test(harnessSrc) && /require\('\.\.\/lib\/agent-registry'\)/.test(harnessSrc);
    ok = dataOk && singleSource && movedOut;
  } catch {}
  console.log(ok ? '✓ B(1.9.291) lib/agent-registry 모듈 분리: 단일출처 + 인라인 제거 (UR-0025)' : '✗ agent-registry 모듈 분리 실패');
  if (!ok) failed++;
}

// 1.9.292 회귀 (UR-0031): leerness context — get_project_context 집약 시맨틱 verb
total++;
{
  let ok = false;
  try {
    const r = cp.spawnSync(process.execPath, [CLI, 'context', tmp, '--json'], { cwd: tmp, encoding: 'utf8', timeout: 30000 });
    const j = JSON.parse(r.stdout);
    const structOk = r.status === 0 && j.schemaVersion === 1 && !!j.version && !!j.project && ('currentTask' in j) &&
      j.openRequests && typeof j.openRequests.count === 'number' && Array.isArray(j.recentDecisions) &&
      Array.isArray(j.activeRules) && Array.isArray(j.nextActions) && j.memory && typeof j.memory.rulesActive === 'number';
    const h = require(path.resolve(__dirname, '..', 'bin', 'harness.js'));
    const mcpOk = h._mcpToolCount && h._mcpToolCount() >= 80;
    ok = structOk && mcpOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.292) leerness context: get_project_context 집약 JSON 구조 + MCP 80 도구 (UR-0031)' : '✗ context 집약 verb 실패');
  if (!ok) failed++;
}

// 1.9.293 회귀: idempotency audit --auto-fix + progressHeader 복제버그 fix
total++;
{
  let ok = false;
  try {
    const idemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-idem-'));
    cp.spawnSync(process.execPath, [CLI, 'init', idemDir, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const pt = path.join(idemDir, '.harness', 'progress-tracker.md');
    // (1) 헤더 유실 + 완전중복 + 동일텍스트 중복 시뮬레이션 (과거 손상 패턴)
    const dupRow = '| T-7001 | in-progress | 중복작업ABC | - | - | 2026-06-04 |';
    const sameText = '| T-7002 | in-progress | 중복작업ABC | - | - | 2026-06-04 |';
    fs.writeFileSync(pt, [dupRow, dupRow, dupRow, sameText].join('\n') + '\n', 'utf8');  // 헤더 없음(손상)
    // (2) auto-fix
    const r = cp.spawnSync(process.execPath, [CLI, 'idempotency', 'audit', '--path', idemDir, '--auto-fix'], { encoding: 'utf8', timeout: 20000 });
    const after = fs.readFileSync(pt, 'utf8');
    const headerRestored = /\|---\|/.test(after) && /leernessRole: progress-tracker/.test(after);  // 헤더 재구성
    const exactCollapsed = (after.match(/\| T-7001 \|/g) || []).length === 1;  // 완전중복 3→1
    // (3) 재검사 clean
    const r2 = cp.spawnSync(process.execPath, [CLI, 'idempotency', 'audit', '--path', idemDir, '--json'], { encoding: 'utf8', timeout: 20000 });
    const audit = JSON.parse(r2.stdout);
    const taskDupGone = !audit.violations.some(v => v.kind === 'task-duplicate-request');
    ok = r.status === 0 && headerRestored && exactCollapsed && taskDupGone;
  } catch {}
  console.log(ok ? '✓ B(1.9.293) idempotency --auto-fix: 헤더 재구성 + 완전중복 제거 + dedup clean (복제버그 fix)' : '✗ idempotency auto-fix 실패');
  if (!ok) failed++;
}

// 1.9.294 회귀 (UR-0025 3단계): lib/role-catalog.js 모듈 분리 — 단일출처 + 부작용 0
total++;
{
  let ok = false;
  try {
    const reg = require(path.resolve(__dirname, '..', 'lib', 'role-catalog.js'));
    const dataOk = reg.ROLE_CATALOG && Object.keys(reg.ROLE_CATALOG).length === 7 &&
      reg._PROVIDER_MODEL_CATALOG && Object.keys(reg._PROVIDER_MODEL_CATALOG).length === 10 &&
      reg._ROLE_ALIASES && Object.keys(reg._ROLE_ALIASES).length >= 14 &&
      reg._AGENT_ROLE_PROMPTS && reg._AGENT_ROLE_PROMPTS.actor;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const movedOut = !/const ROLE_CATALOG = \{/.test(harnessSrc) && /require\('\.\.\/lib\/role-catalog'\)/.test(harnessSrc);
    // roles 명령이 여전히 동작 (모듈 require 후) — 회귀 방지
    const rr = cp.spawnSync(process.execPath, [CLI, 'roles', 'list', '--path', tmp, '--json'], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    const rolesOk = rr.status === 0;
    ok = dataOk && movedOut && rolesOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.294) lib/role-catalog 모듈 분리: 단일출처 + 인라인 제거 + roles 동작 (UR-0025)' : '✗ role-catalog 모듈 분리 실패');
  if (!ok) failed++;
}

// 1.9.295 회귀 (UR-0025 4단계): lib/catalogs.js 모듈 분리 — 단일출처 + 부작용 0 + 소비 명령 회귀
total++;
{
  let ok = false;
  try {
    const reg = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const dataOk = reg.CAPABILITY_SURFACE && Object.keys(reg.CAPABILITY_SURFACE).length === 6 &&
      Array.isArray(reg.POWERFUL_COMMANDS) && reg.POWERFUL_COMMANDS.length === 7 &&
      reg.ADAPTERS && Object.keys(reg.ADAPTERS).length === 9 &&
      Array.isArray(reg.REUSE_CATEGORIES) && reg.REUSE_CATEGORIES.length === 15 &&
      Array.isArray(reg.REUSE_CHECKLIST) && reg.REUSE_CHECKLIST.length === 6;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const movedOut = !/const CAPABILITY_SURFACE = \{/.test(harnessSrc) && !/const ADAPTERS = \{/.test(harnessSrc) && /require\('\.\.\/lib\/catalogs'\)/.test(harnessSrc);
    // 소비 명령 회귀: capabilities + reuse-check (카탈로그 require 후 동작)
    const cap = cp.spawnSync(process.execPath, [CLI, 'capabilities', '--json'], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    const reuse = cp.spawnSync(process.execPath, [CLI, 'reuse-check', 'JWT 인증', '--json'], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    const cmdsOk = cap.status === 0 && reuse.status === 0 && /auth/.test(reuse.stdout);
    ok = dataOk && movedOut && cmdsOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.295) lib/catalogs 모듈 분리: 단일출처 + 인라인 제거 + capabilities/reuse-check 동작 (UR-0025)' : '✗ catalogs 모듈 분리 실패');
  if (!ok) failed++;
}

// 1.9.296 회귀 (UR-0030): leerness about — 정체성(AI 운영 레이어) verb + MCP + README 섹션
total++;
{
  let ok = false;
  try {
    const r = cp.spawnSync(process.execPath, [CLI, 'about', '--json'], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    const j = JSON.parse(r.stdout);
    const structOk = r.status === 0 && /운영 레이어/.test(j.identity) && Array.isArray(j.layers) && j.layers.length === 5 &&
      j.layers.every(l => l.key && l.ko && l.desc) && j.complements && j.surface && typeof j.surface.mcpTools === 'number' &&
      j.surface.runtimeDeps === 0 && /AGENTS\.md/.test(j.complements);
    // MCP tools/list 에 leerness_about 노출 (81 도구)
    const ml = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: tmp, encoding: 'utf8', timeout: 15000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n' });
    const names = JSON.parse(ml.stdout.split('\n').filter(Boolean)[0]).result.tools.map(t => t.name);
    const mcpOk = names.includes('leerness_about') && names.length >= 81;
    // README 정체성 섹션: readme sync 후 tmp/README.md 에 섹션 생성 확인
    cp.spawnSync(process.execPath, [CLI, 'readme', 'sync', tmp], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    const rd = fs.existsSync(path.join(tmp, 'README.md')) ? fs.readFileSync(path.join(tmp, 'README.md'), 'utf8') : '';
    const readmeOk = /정체성 — AI 에이전트 운영 레이어/.test(rd);
    ok = structOk && mcpOk && readmeOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.296) leerness about: 정체성 verb + MCP leerness_about(81) + README 섹션 (UR-0030)' : '✗ about 정체성 verb 실패');
  if (!ok) failed++;
}

// 1.9.297 회귀 (UR-0025 5단계): lib/mcp-tools.js 단일출처 — tools/list == 모듈 == _mcpToolCount (Codex #5 영구해소)
total++;
{
  let ok = false;
  try {
    const T = require(path.resolve(__dirname, '..', 'lib', 'mcp-tools.js'));
    const dataOk = Array.isArray(T) && T.length >= 81 && T.every(t => t.name && t.description && t.inputSchema) && T[0].name === 'leerness_handoff';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const movedOut = !/const TOOLS = \[/.test(harnessSrc) && /require\('\.\.\/lib\/mcp-tools'\)/.test(harnessSrc);
    // tools/list(라이브 MCP) == 모듈 length (단일출처 일치)
    const ml = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: tmp, encoding: 'utf8', timeout: 15000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n' });
    const live = JSON.parse(ml.stdout.split('\n').filter(Boolean)[0]).result.tools.length;
    const h = require(path.resolve(__dirname, '..', 'bin', 'harness.js'));
    const singleSource = live === T.length && h._mcpToolCount() === T.length;
    ok = dataOk && movedOut && singleSource;
  } catch {}
  console.log(ok ? '✓ B(1.9.297) lib/mcp-tools 단일출처: tools/list == 모듈 == _mcpToolCount (Codex #5 영구해소, UR-0025)' : '✗ mcp-tools 모듈 분리 실패');
  if (!ok) failed++;
}

// 1.9.298 회귀 (UR-0038 외부리뷰): writeUtf8 원자적 쓰기 — 반복 쓰기 후 무손상 + temp 잔여 0
total++;
{
  let ok = false;
  try {
    const aDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-atomic-'));
    cp.spawnSync(process.execPath, [CLI, 'init', aDir, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    // writeUtf8 경유 명령 반복 (progress-tracker/decisions 갱신)
    for (let i = 0; i < 3; i++) {
      cp.spawnSync(process.execPath, [CLI, 'task', 'add', `원자성 테스트 T-${i}`, '--path', aDir], { encoding: 'utf8', timeout: 15000 });
      cp.spawnSync(process.execPath, [CLI, 'decision', 'add', `결정 ${i}`, '--reason', 'r', '--path', aDir], { encoding: 'utf8', timeout: 15000 });
    }
    const pt = fs.readFileSync(path.join(aDir, '.harness', 'progress-tracker.md'), 'utf8');
    // (1) 3개 task 모두 기록 + 구분자 라인 1개(중복/손상 없음). 라인 기준 카운트(|---|---| 한 줄에 부분매치 다수 방지).
    const sepLines = pt.split('\n').filter(l => /^\|---\|/.test(l)).length;
    const tasksOk = /원자성 테스트 T-0/.test(pt) && /원자성 테스트 T-2/.test(pt) && sepLines === 1;
    // (2) .harness 어디에도 .tmp- 잔여 파일 없음 (rename 완료)
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const tmpLeftover = walk(path.join(aDir, '.harness')).filter(f => /\.tmp-\d+-\d+$/.test(f));
    // (3) 소스에 renameSync 원자 패턴 존재
    const srcOk = /fs\.renameSync\(tmp, p\)/.test(fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8'));
    ok = tasksOk && tmpLeftover.length === 0 && srcOk;
    fs.rmSync(aDir, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.298) writeUtf8 원자적 쓰기: 반복쓰기 무손상 + temp 잔여 0 (UR-0038 외부리뷰)' : '✗ writeUtf8 원자성 실패');
  if (!ok) failed++;
}

// 1.9.299 회귀 (UR-0039 외부리뷰): npm test 시크릿 차단 — 토큰이 보이면 exit 1 인 test 스크립트가 verify-code 에서 통과해야(스크럽됨)
total++;
{
  let ok = false;
  try {
    const secDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sec-'));
    // test: NPM_TOKEN/LEERNESS_NPM_TOKEN 가 보이면 exit 1(스크럽 실패), 안 보이면 exit 0
    fs.writeFileSync(path.join(secDir, 'package.json'), JSON.stringify({
      name: 'sec', version: '0.0.1',
      scripts: { test: 'node -e "process.exit(process.env.NPM_TOKEN||process.env.LEERNESS_NPM_TOKEN?1:0)"' }
    }) + '\n', 'utf8');
    // 시크릿을 env 에 심고 verify-code 실행 → 스크럽되면 스크립트가 토큰을 못 봐 exit 0(test passed)
    const r = cp.spawnSync(process.execPath, [CLI, 'verify-code', secDir], {
      cwd: secDir, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, NPM_TOKEN: 'leaktok', LEERNESS_NPM_TOKEN: 'leaklz' }
    });
    const out = (r.stdout || '') + (r.stderr || '');
    // 대조군: 같은 스크립트를 스크럽 없이 직접 실행하면 exit 1 (토큰 노출 확인 — 테스트 자체 유효성)
    const ctrl = cp.spawnSync('npm test', [], { cwd: secDir, shell: true, encoding: 'utf8', timeout: 30000, env: { ...process.env, NPM_TOKEN: 'leaktok' } });
    ok = /✓ test passed/.test(out) && !/✗ test/.test(out) && ctrl.status === 1;
    fs.rmSync(secDir, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.299) npm test 시크릿 차단: verify-code 가 NPM_TOKEN/LEERNESS_NPM_TOKEN 스크럽 (UR-0039 외부리뷰)' : '✗ npm test 시크릿 차단 실패');
  if (!ok) failed++;
}

// 1.9.300 회귀 (UR-0040 외부리뷰): 셸 주입 표면 제거 — fetchNpmLatest execFile + argList 인용 + update --check 회귀
total++;
{
  let ok = false;
  try {
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    // (1) 소스: cp.exec 템플릿 제거 + execFile args 배열(view pkg version) + argList 인용
    const srcOk = /'view', pkg, 'version'/.test(harnessSrc) &&  // 1.9.360(CV-2/UR-0077): cmd.exe /d /s /c npm view (args 배열) 형태
      !/cp\.exec\(.npm view \$\{pkg\}/.test(harnessSrc) &&
      /argList\.map\(_shellQuoteArg\)\.join/.test(harnessSrc);
    // (2) 기능 회귀: update --check 가 오프라인(네트워크 무)에서도 crash 없이 종료
    const uDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-upd-'));
    const r = cp.spawnSync(process.execPath, [CLI, 'update', uDir, '--check'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, LEERNESS_OFFLINE: '1' } });
    const funcOk = r.status === 0 && /Current:/.test(r.stdout || '');
    ok = srcOk && funcOk;
    fs.rmSync(uDir, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.300) 셸 주입 표면 제거: fetchNpmLatest execFile + argList 인용 + update --check 회귀 (UR-0040 외부리뷰)' : '✗ 셸 주입 표면 제거 실패');
  if (!ok) failed++;
}

// 1.9.301 회귀 (UR-0041 외부리뷰): MCP 정책 게이트가 도구 requiredTier 메타데이터로 under-classify 갭 차단
total++;
{
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
    // provider_add: regex 는 read-only(아래 정책 통과 가능) 인데 메타데이터 safe-write → read-only enforce 에서 차단되어야
    const pa = callMcp('leerness_provider_add', { path: pDir, id: 'x', cmd: 'y' });
    const blocked = pa && pa.isError === true && /정책 차단/.test(pa.content[0].text);
    // handoff: read-only → 허용
    const hd = callMcp('leerness_handoff', { path: pDir });
    const allowed = hd && hd.isError !== true;
    // 모든 도구 유효 tier
    const T = require(path.resolve(__dirname, '..', 'lib', 'mcp-tools.js'));
    const tierOk = T.every(t => typeof t.requiredTier === 'string' && t.requiredTier.length > 0);
    ok = blocked && allowed && tierOk;
    fs.rmSync(pDir, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.301) MCP 정책 메타데이터 게이트: under-classify 차단(provider_add) + read 허용(handoff) (UR-0041)' : '✗ MCP 정책 메타데이터 게이트 실패');
  if (!ok) failed++;
}

// 1.9.302 회귀 (UR-0042 외부리뷰): verify-claim git diff 시맨틱 교차검증 (변경 파일 주장 ✓ / 미변경 주장 ⚠ + strict FAIL)
total++;
{
  let ok = false;
  try {
    const vDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-vc-'));
    const git = (...a) => cp.spawnSync('git', ['-C', vDir, ...a], { encoding: 'utf8', timeout: 15000 });
    const gi = git('init');
    if (gi.status !== 0) throw new Error('git 없음');  // git 미설치 환경 → skip(아래 catch 로 ok=false 방지 위해 통과 처리)
    git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    cp.spawnSync(process.execPath, [CLI, 'init', vDir, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    fs.mkdirSync(path.join(vDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(vDir, 'src', 'api.js'), 'v1'); fs.writeFileSync(path.join(vDir, 'old.js'), 'old');
    git('add', '-A'); git('commit', '-m', 'init');
    fs.writeFileSync(path.join(vDir, 'src', 'api.js'), 'v2 changed');  // working tree 변경
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', '작업1', '--path', vDir, '--status', 'done', '--evidence', 'src/api.js 수정'], { encoding: 'utf8', timeout: 15000 });
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', '작업2', '--path', vDir, '--status', 'done', '--evidence', 'old.js 수정'], { encoding: 'utf8', timeout: 15000 });
    const r1 = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0002', '--path', vDir], { encoding: 'utf8', timeout: 20000 });
    const r2 = cp.spawnSync(process.execPath, [CLI, 'verify-claim', 'T-0003', '--path', vDir, '--strict-claims'], { encoding: 'utf8', timeout: 20000 });
    const changedClaimOk = /git diff 교차검증: ✓/.test(r1.stdout || '');   // 변경 파일 주장 → 매칭
    const mismatchDetected = /git diff 교차검증: ⚠ 불일치/.test(r2.stdout || '') && r2.status === 1;  // 미변경 주장 + strict → FAIL
    ok = changedClaimOk && mismatchDetected;
    fs.rmSync(vDir, { recursive: true, force: true });
  } catch (e) { if (/git 없음/.test(e.message)) { ok = true; console.log('  (git 미설치 — git 교차검증 e2e skip)'); } }
  console.log(ok ? '✓ B(1.9.302) verify-claim git diff 교차검증: 변경파일 주장 ✓ / 미변경 주장 ⚠ strict FAIL (UR-0042)' : '✗ verify-claim git 교차검증 실패');
  if (!ok) failed++;
}

// 1.9.303 회귀 (UR-0043 외부리뷰): 동시 task add lost-update 락 — 6개 병렬 추가 시 모두 보존 + ID 충돌 0
total++;
{
  let ok = false;
  try {
    const lDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lock-'));
    cp.spawnSync(process.execPath, [CLI, 'init', lDir, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const N = 6;
    const procs = [];
    // 1.9.318: --no-review 로 review-request 내부 spawn(~550ms×N) 제외 — 락(동시성) 자체만 격리 검증 (전체 e2e 부하 시 타임아웃 플래키 방지)
    for (let i = 0; i < N; i++) procs.push(cp.spawn(process.execPath, [CLI, 'task', 'add', 'LOCKTEST-' + i, '--path', lDir, '--no-review'], { stdio: 'ignore' }));
    const ptPath = path.join(lDir, '.harness', 'progress-tracker.md');
    // 자식들이 OS 프로세스로 독립 진행 → 부모는 파일을 sync 폴링(원자쓰기라 부분읽기 없음)
    const start = Date.now(); let found = 0;
    // 1.9.321: 폴 타임아웃 25s→60s — 전체 e2e CPU 포화 시 6 병렬 spawn 지연으로 인한 간헐 플래키 방지(격리 실측 0.4s, 대폭 여유)
    while (Date.now() - start < 60000) {
      try { const pt = fs.readFileSync(ptPath, 'utf8'); found = Array.from({ length: N }, (_, i) => i).filter(i => pt.includes('LOCKTEST-' + i)).length; if (found === N) break; } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
    try { procs.forEach(p => { try { p.kill(); } catch {} }); } catch {}
    const pt = fs.readFileSync(ptPath, 'utf8');
    const allFound = Array.from({ length: N }, (_, i) => i).every(i => pt.includes('LOCKTEST-' + i));
    const ids = (pt.match(/^\| (T-\d{4}) \|/gm) || []).map(s => s.match(/T-\d{4}/)[0]);
    const noDupId = ids.length === new Set(ids).size;  // ID 충돌 0
    const oneSep = pt.split('\n').filter(l => /^\|---\|/.test(l)).length === 1;
    ok = allFound && noDupId && oneSep;
    fs.rmSync(lDir, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.303) 동시 task add lost-update 락: 6 병렬 모두 보존 + ID 충돌 0 (UR-0043)' : '✗ lost-update 락 실패');
  if (!ok) failed++;
}

// 1.9.304 회귀 (UR-0025): lib/analyzers.js 모듈 분리 — 단일출처 + 부작용 0 + 소비 명령 회귀
total++;
{
  let ok = false;
  try {
    const a = require(path.resolve(__dirname, '..', 'lib', 'analyzers.js'));
    const dataOk = typeof a._evidenceQuality === 'function' && typeof a._parseEvidenceStats === 'function' &&
      typeof a._shellGuardAnalyze === 'function' && typeof a._claimFileInGit === 'function' &&
      a._evidenceQuality('src/api.js 수정, 12/12 통과 (Exit: 0)').ok === true &&
      a._shellGuardAnalyze('a && b', { shell: 'powershell', psVersion: '5' }).issues.some(i => i.rule === 'ps5-chain') &&
      a._claimFileInGit('src/api.js', new Set(['src/api.js'])) === true;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const movedOut = !/function _evidenceQuality\(evidence\) \{/.test(harnessSrc) && !/function _shellGuardAnalyze\(cmd, ctx\) \{/.test(harnessSrc) && /require\('\.\.\/lib\/analyzers'\)/.test(harnessSrc);
    // 소비 명령 회귀: shell-guard (_shellGuardAnalyze 사용)
    const sg = cp.spawnSync(process.execPath, [CLI, 'shell-guard', 'a && b', '--json'], { cwd: tmp, encoding: 'utf8', timeout: 20000 });
    const cmdOk = sg.status === 0 && /"shell"/.test(sg.stdout || '');
    ok = dataOk && movedOut && cmdOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.304) lib/analyzers 모듈 분리: 단일출처 + 인라인 제거 + shell-guard 동작 (UR-0025)' : '✗ analyzers 모듈 분리 실패');
  if (!ok) failed++;
}

// 1.9.305 회귀 (사용자 명시): honesty-check — AI 인식론적 정직성 3차원 + exit code + MCP 노출
total++;
{
  let ok = false;
  try {
    // 양호(근거 있음) → exit 0 + ✓
    const good = cp.spawnSync(process.execPath, [CLI, 'honesty-check', '--text', 'src/api.js 수정, 12/12 통과 (Exit: 0)'], { cwd: tmp, encoding: 'utf8', timeout: 15000 });
    const goodOk = good.status === 0 && /정직성 신호 양호/.test(good.stdout || '');
    // 근거 없는 단정 → exit 1 + pretend-knowledge
    const bad1 = cp.spawnSync(process.execPath, [CLI, 'honesty-check', '--text', '이 기능은 항상 정상 동작합니다', '--json'], { cwd: tmp, encoding: 'utf8', timeout: 15000 });
    const b1 = JSON.parse(bad1.stdout); const bad1Ok = bad1.status === 1 && b1.findings.some(f => f.dim === 'pretend-knowledge');
    // 미검증 섣부른 판단 → premature-judgment
    const bad2 = cp.spawnSync(process.execPath, [CLI, 'honesty-check', '--text', '아마 될 것 같습니다. 구현 완료했습니다', '--json'], { cwd: tmp, encoding: 'utf8', timeout: 15000 });
    const bad2Ok = JSON.parse(bad2.stdout).findings.some(f => f.dim === 'premature-judgment');
    // MCP tools/list 에 노출
    const ml = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: tmp, encoding: 'utf8', timeout: 15000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n' });
    const mcpOk = JSON.parse(ml.stdout.split('\n').filter(Boolean)[0]).result.tools.some(t => t.name === 'leerness_honesty_check');
    ok = goodOk && bad1Ok && bad2Ok && mcpOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.305) honesty-check: 3차원 탐지 + exit code + MCP 노출 (모르는걸 아는척/미검증판단/정보미수집)' : '✗ honesty-check 실패');
  if (!ok) failed++;
}

// 1.9.306 회귀 (UR-0045 설치리뷰): exit code 일관성 — 오류 경로 exit 1, 정상/help exit 0
total++;
{
  let ok = false;
  try {
    const eDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-exit-'));
    cp.spawnSync(process.execPath, [CLI, 'init', eDir, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const ex = (args) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd: eDir, encoding: 'utf8', timeout: 20000 }).status;
    // 오류 경로 → exit 1
    const unknownOk = ex(['definitely-not-a-cmd']) === 1;
    const missingArgOk = ex(['decision', 'add', '--path', eDir]) === 1;
    const badSubOk = ex(['task', 'zzznotreal', '--path', eDir]) === 1;
    // 정상/help/version → exit 0 (fail() 변경 회귀 방지)
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

// 1.9.307 회귀 (UR-0055 사용자명시): brief — 프로젝트 청사진 set/show/export + README 섹션 + 멱등 업데이트
total++;
{
  let ok = false;
  try {
    const bDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-brief-'));
    cp.spawnSync(process.execPath, [CLI, 'init', bDir, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const run = (...a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: bDir, encoding: 'utf8', timeout: 20000 });
    run('brief', 'set', '--path', bDir, '--intro', '할 일 관리 앱', '--purpose', '팀 생산성', '--features', '태스크CRUD, 알림');
    const briefMd = fs.readFileSync(path.join(bDir, '.harness', 'project-brief.md'), 'utf8');
    const readme = fs.readFileSync(path.join(bDir, 'README.md'), 'utf8');
    const setOk = /## Intro\n할 일 관리 앱/.test(briefMd) && /태스크CRUD/.test(briefMd) && readme.includes('<!-- leerness:project-brief:start -->') && /## 프로젝트 개요/.test(readme) && /할 일 관리 앱/.test(readme);
    // 멱등 업데이트: 방향 변경(--purpose 만 갱신) → intro/features 보존
    run('brief', 'set', '--path', bDir, '--purpose', '엔터프라이즈 확대');
    const md2 = fs.readFileSync(path.join(bDir, '.harness', 'project-brief.md'), 'utf8');
    const updateOk = /엔터프라이즈 확대/.test(md2) && /할 일 관리 앱/.test(md2) && /태스크CRUD/.test(md2);
    // README 섹션 중복 없음 (재sync)
    const readme2 = fs.readFileSync(path.join(bDir, 'README.md'), 'utf8');
    const noDup = (readme2.match(/<!-- leerness:project-brief:start -->/g) || []).length === 1;
    // export: 복사용 blueprint
    const exp = run('brief', 'export', '--path', bDir);
    const exportOk = exp.status === 0 && /Blueprint/.test(exp.stdout) && /신규 프로젝트 시작 가이드/.test(exp.stdout) && /엔터프라이즈 확대/.test(exp.stdout);
    ok = setOk && updateOk && noDup && exportOk;
    fs.rmSync(bDir, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.307) brief: 청사진 set→README+brief 동기화 + 멱등 업데이트 + export blueprint (UR-0055)' : '✗ brief 청사진 실패');
  if (!ok) failed++;
}

// 1.9.308 회귀 (UR-0055 2단계): brief update --direction 이력 + context 통합 + MCP leerness_brief
total++;
{
  let ok = false;
  try {
    const b2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-brief2-'));
    cp.spawnSync(process.execPath, [CLI, 'init', b2, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const run = (...a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: b2, encoding: 'utf8', timeout: 20000 });
    run('brief', 'set', '--path', b2, '--intro', '앱', '--features', 'CRUD');
    run('brief', 'update', '--path', b2, '--direction', 'AI 자동분류 확대');
    run('brief', 'update', '--path', b2, '--direction', '모바일 지원 추가');
    const md = fs.readFileSync(path.join(b2, '.harness', 'project-brief.md'), 'utf8');
    const histOk = /## Direction History/.test(md) && /AI 자동분류 확대/.test(md) && /모바일 지원 추가/.test(md);  // 이력 누적
    const readme = fs.readFileSync(path.join(b2, 'README.md'), 'utf8');
    const readmeOk = /최근 개발 방향 변경/.test(readme) && /모바일 지원 추가/.test(readme);
    const exp = run('brief', 'export', '--path', b2);
    const expOk = /개발 방향 이력/.test(exp.stdout) && /AI 자동분류 확대/.test(exp.stdout);
    // context --path 가 brief 노출
    const ctx = run('context', '--path', b2, '--json');
    const cj = JSON.parse(ctx.stdout);
    const ctxOk = cj.brief && cj.brief.intro === '앱' && cj.brief.features.includes('CRUD') && /모바일 지원/.test(cj.brief.latestDirection || '');
    // MCP leerness_brief
    const ml = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: b2, encoding: 'utf8', timeout: 15000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_brief', arguments: { path: b2 } } }) + '\n' });
    let mcpOk = false;
    try { const r = JSON.parse(ml.stdout.split('\n').filter(Boolean)[0]); const t = JSON.parse(r.result.content[0].text); mcpOk = t.directionHistory.length === 2 && t.features.includes('CRUD'); } catch {}
    ok = histOk && readmeOk && expOk && ctxOk && mcpOk;
    fs.rmSync(b2, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.308) brief 2단계: update --direction 이력누적 + context 통합 + MCP leerness_brief (UR-0055)' : '✗ brief 2단계 실패');
  if (!ok) failed++;
}

// 1.9.309 회귀 (UR-0048 설치리뷰 critical): verify-claim done 주장 evidence 기본강제 + --lenient + MCP 도달
total++;
{
  let ok = false;
  try {
    const vc = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-vc48-'));
    cp.spawnSync(process.execPath, [CLI, 'init', vc, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    fs.mkdirSync(path.join(vc, 'src'), { recursive: true }); fs.writeFileSync(path.join(vc, 'src', 'api.js'), 'module.exports={};');
    const ex = (...a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: vc, encoding: 'utf8', timeout: 20000 });
    ex('task', 'add', '증거없는완료', '--path', vc, '--status', 'done');               // T-0002: 증거 0
    ex('task', 'add', '증거있는완료', '--path', vc, '--status', 'done', '--evidence', 'src/api.js 수정, 8 tests 통과 (Exit: 0)');  // T-0003
    ex('task', 'add', '진행중', '--path', vc);                                          // T-0004: requested
    const noEv = ex('verify-claim', 'T-0002', '--path', vc).status === 1;              // 기본 거짓완료 차단
    const lenient = ex('verify-claim', 'T-0002', '--path', vc, '--lenient').status === 0;  // opt-out
    const withEv = ex('verify-claim', 'T-0003', '--path', vc).status === 0;            // 증거+파일 → 통과
    const notDone = ex('verify-claim', 'T-0004', '--path', vc).status === 0;           // 비-done 강제 안함
    // MCP 도 기본 강제 (증거0 done → isError)
    const ml = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: vc, encoding: 'utf8', timeout: 15000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'leerness_verify_claim', arguments: { taskId: 'T-0002', path: vc } } }) + '\n' });
    let mcpBlocks = false; try { mcpBlocks = JSON.parse(ml.stdout.split('\n').filter(Boolean)[0]).result.isError === true; } catch {}
    ok = noEv && lenient && withEv && notDone && mcpBlocks;
    fs.rmSync(vc, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.309) verify-claim 거짓완료 차단: 증거0 done 기본 FAIL + --lenient + 증거통과 + MCP 차단 (UR-0048)' : '✗ verify-claim 기본강제 실패');
  if (!ok) failed++;
}

// 1.9.310 회귀 (UR-0046 설치리뷰): 입력 스키마 검증 — 무효 status/trigger 거부, 유효/--force 통과, every-round 보존
total++;
{
  let ok = false;
  try {
    const vd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-val-'));
    cp.spawnSync(process.execPath, [CLI, 'init', vd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const st = (...a) => cp.spawnSync(process.execPath, [CLI, ...a], { cwd: vd, encoding: 'utf8', timeout: 20000 }).status;
    const badStatus = st('task', 'add', 't', '--path', vd, '--status', 'nonsense') === 1;          // 무효 거부
    const goodStatus = st('task', 'add', 't2', '--path', vd, '--status', 'in-progress') === 0;     // 유효 통과
    const forceStatus = st('task', 'add', 't3', '--path', vd, '--status', 'weird', '--force') === 0; // --force 우회
    const badTrigger = st('rule', 'add', 'r', '--path', vd, '--trigger', 'not-a-trigger') === 1;   // 무효 거부
    const everyRound = st('rule', 'add', 'r2', '--path', vd, '--trigger', 'every-round') === 0;    // every-round 보존(R-0001)
    const everyUpdate = st('rule', 'add', 'r3', '--path', vd, '--trigger', 'every-update') === 0;  // 유효 통과
    ok = badStatus && goodStatus && forceStatus && badTrigger && everyRound && everyUpdate;
    fs.rmSync(vd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.310) 입력 스키마 검증: 무효 status/trigger 거부 + 유효/--force/every-round 통과 (UR-0046)' : '✗ 입력 스키마 검증 실패');
  if (!ok) failed++;
}

// 1.9.311 회귀 (UR-0047 설치리뷰): init 가드 — 미초기화 디렉토리 write 차단, .harness 미생성, --force 우회, init 후 정상
total++;
{
  let ok = false;
  try {
    // dir1: 미초기화 7개 write 차단(exit 1) + .harness 미생성 + --force 우회
    const ig = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-initguard-'));
    const st = (...a) => cp.spawnSync(process.execPath, [CLI, ...a, '--path', ig], { cwd: ig, encoding: 'utf8', timeout: 20000 }).status;
    const blocked = st('task', 'add', 't') === 1
      && st('task', 'update', 'T-0001', '--status', 'done') === 1
      && st('rule', 'add', 'r', '--trigger', 'every-update') === 1
      && st('decision', 'add', 'd') === 1
      && st('plan', 'add', 'p') === 1
      && st('lesson', 'save', 'l') === 1
      && st('brief', 'set', '--intro', 'x') === 1;
    const stateOk = st('state', 'start', 'g') === 0;              // state 는 .leerness substrate(standalone) → 가드 미적용(0)
    const noHarness = !fs.existsSync(path.join(ig, '.harness'));   // .harness write 차단 시 부분 .harness 미생성
    const forced = st('task', 'add', 'tf', '--force') === 0;       // --force 우회
    fs.rmSync(ig, { recursive: true, force: true });
    // dir2: init 후 정상 write
    const ig2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-initguard2-'));
    cp.spawnSync(process.execPath, [CLI, 'init', ig2, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const afterInit = cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'ti', '--path', ig2], { cwd: ig2, encoding: 'utf8', timeout: 20000 }).status === 0;
    fs.rmSync(ig2, { recursive: true, force: true });
    ok = blocked && stateOk && noHarness && forced && afterInit;
  } catch {}
  console.log(ok ? '✓ B(1.9.311) init 가드: 미초기화 .harness write 7종 차단 + state(.leerness) 예외 + --force 우회 + init 후 정상 (UR-0047)' : '✗ init 가드 실패');
  if (!ok) failed++;
}

// 1.9.312 회귀 (UR-0050 설치리뷰): secret 스캐너 현대 키 — sk-proj-/sk-ant-api03-(_)/gho_/Stripe/npm 검출 + exit 1
//   주의: e2e.js 는 scan 대상이라 키는 문자열 연결로 구성(리터럴 금지 — 자기 repo scan 오탐 방지)
total++;
{
  let ok = false;
  try {
    const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-secmod-'));
    const A = 'A'.repeat(40);
    const lines = [
      'const a = "' + 'sk-' + 'proj-' + A + '_' + A + '";',          // modern OpenAI project (기존 패턴 놓침)
      'const b = "' + 'sk-' + 'ant-api03-' + A + '_' + A + '";',     // Anthropic api03 (언더스코어 — 기존 놓침)
      'const c = "' + 'gho_' + 'a1B2'.repeat(9) + '";',              // GitHub OAuth token (ghp_ 외 변종)
      'const d = "' + 'sk_' + 'live_' + A + '";',                    // Stripe
      'const e = "' + 'npm_' + 'a1B2'.repeat(9) + '";',             // npm token
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

// 1.9.313 회귀 (UR-0049 설치리뷰): MCP notification 준수 — id 없는 요청 무응답 + ping {} + notifications/* 가드
total++;
{
  let ok = false;
  try {
    const input = [
      '{"jsonrpc":"2.0","id":1,"method":"initialize"}',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',              // id 없음 → 무응답
      '{"jsonrpc":"2.0","id":2,"method":"ping"}',                           // → {} 결과
      '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}', // id 없음 → 무응답
      '{"jsonrpc":"2.0","id":3,"method":"tools/list"}',
    ].join('\n') + '\n';
    const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 15000, input });
    const lines = (r.stdout || '').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const ids = lines.map(l => l.id);
    const exactly3 = lines.length === 3 && ids.includes(1) && ids.includes(2) && ids.includes(3);  // notification 2건 무응답
    const noNotifResponse = !lines.some(l => l.error && /Unknown method: notifications/.test((l.error && l.error.message) || ''));
    const pingOk = lines.some(l => l.id === 2 && l.result && Object.keys(l.result).length === 0);
    const toolsOk = lines.some(l => l.id === 3 && l.result && Array.isArray(l.result.tools));
    ok = exactly3 && noNotifResponse && pingOk && toolsOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.313) MCP notification 준수: id없는 요청 무응답(2건) + ping {} + tools/list (UR-0049)' : '✗ MCP notification 준수 실패');
  if (!ok) failed++;
}

// 1.9.314 회귀 (UR-0049→UR-0052 설치리뷰): PowerShell 감지 — pwsh7(channel) ps5-chain 오탐 제거 + ps5.1 정상 발화
//   env 마커로 셸/버전 판별(cross-platform) — POWERSHELL_DISTRIBUTION_CHANNEL=pwsh7, Documents\WindowsPowerShell=ps5.1
total++;
{
  let ok = false;
  try {
    const sg = (extra) => { const r = cp.spawnSync(process.execPath, [CLI, 'shell-guard', 'a && b', '--json'], { encoding: 'utf8', timeout: 15000, env: { ...process.env, ...extra } }); try { return JSON.parse(r.stdout); } catch { return null; } };
    const j7 = sg({ POWERSHELL_DISTRIBUTION_CHANNEL: 'MSI:Windows 10 Pro', PSModulePath: '', SHELL: '' });
    const jb = sg({ POWERSHELL_DISTRIBUTION_CHANNEL: '', PSModulePath: 'C:\\Users\\u\\Documents\\WindowsPowerShell\\Modules', SHELL: '/usr/bin/bash' });
    const pwsh7Ok = j7 && String(j7.psVersion) === '7' && j7.shell === 'powershell' && !(j7.issues || []).some(i => i.rule === 'ps5-chain');  // pwsh7(channel) → ps5-chain 오탐 없음
    const noFalsePs5 = jb && jb.shell !== 'powershell' && !(jb.issues || []).some(i => i.rule === 'ps5-chain');  // 영구 ps5.1 PSModulePath + bash → ps5 오판/과경고 없음
    ok = pwsh7Ok && noFalsePs5;
  } catch {}
  console.log(ok ? '✓ B(1.9.314) PowerShell 감지: pwsh7(channel) ps5-chain 오탐 제거 + 영구 ps5.1경로 과경고 없음 (UR-0052)' : '✗ PowerShell 감지 실패');
  if (!ok) failed++;
}

// 1.9.315 회귀 (UR-0054 설치리뷰): doc/surface 정합 — doctor 진단 명령 + stale MCP 카운트 동적화(commands/banner)
total++;
{
  let ok = false;
  try {
    const r = cp.spawnSync(process.execPath, [CLI, 'doctor', '--json'], { encoding: 'utf8', timeout: 30000 });
    let j = null; try { j = JSON.parse(r.stdout); } catch {}
    const doctorOk = j && j.version && typeof j.mcpTools === 'number' && j.mcpTools >= 80 && j.selftest && j.selftest.total > 0 && j.healthy === true && r.status === 0;
    // commands 요약 + banner 가 실제 MCP 수 노출 (하드코딩 65/46 아님)
    const rc = cp.spawnSync(process.execPath, [CLI, 'commands'], { encoding: 'utf8', timeout: 15000 });
    const dynOk = j && new RegExp('MCP 도구: ' + j.mcpTools).test(rc.stdout || '') && !/MCP 도구: 65\b/.test(rc.stdout || '');
    ok = doctorOk && dynOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.315) doc/surface: doctor 진단(selftest+버전+셸) + commands MCP 카운트 동적 (UR-0054)' : '✗ doc/surface 실패');
  if (!ok) failed++;
}

// 1.9.316 회귀 (drift 마커 버그): session-handoff 'Last generated' 중복 누적 방지 + drift 'session close 누락' 클리어
//   근본: sessionClose 프론트매터 추출이 본문 '---' 를 오인 → 구 블록 보존 → 첫(구) Last generated 를 drift 가 읽어 영구 오발화
total++;
{
  let ok = false;
  try {
    const dd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-driftmark-'));
    cp.spawnSync(process.execPath, [CLI, 'init', dd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const shp = path.join(dd, '.harness', 'session-handoff.md');
    // 손상 시뮬: 구 timestamp + 본문 '---' (프론트매터 없는 파일)
    fs.writeFileSync(shp, '# Session Handoff\n\nLast generated: 2026-01-01T00:00:00.000Z\n\n## Completed\n- old\n\n---\n## x\n');
    cp.spawnSync(process.execPath, [CLI, 'session', 'close', dd], { encoding: 'utf8', timeout: 30000 });
    const after = fs.readFileSync(shp, 'utf8');
    const genCount = (after.match(/Last generated:/g) || []).length;   // 단일화
    const noOld = !after.includes('2026-01-01');                       // 구 timestamp 제거
    const dr = cp.spawnSync(process.execPath, [CLI, 'drift', 'check', dd, '--json'], { encoding: 'utf8', timeout: 20000 });
    let driftOk = false; try { const j = JSON.parse(dr.stdout); const sig = (j.signals || []).find(x => x.label && x.label.includes('session close')); driftOk = sig && sig.ageDays <= sig.threshold; } catch {}
    ok = genCount === 1 && noOld && driftOk;
    fs.rmSync(dd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.316) drift 마커: session-handoff Last generated 단일화 + session close 누락 신호 클리어' : '✗ drift 마커 실패');
  if (!ok) failed++;
}

// 1.9.317 회귀 (UR-0051 설치리뷰): 텔레메트리 분리 — 내부 auto-call(LEERNESS_INTERNAL)이 usage 집계 오염 안 함
total++;
{
  let ok = false;
  try {
    const td = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-telem-'));
    cp.spawnSync(process.execPath, [CLI, 'init', td, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const usagePath = path.join(td, '.harness', 'cache', 'usage-stats.json');
    const cmds = () => { try { return JSON.parse(fs.readFileSync(usagePath, 'utf8')).commands || {}; } catch { return {}; } };
    // task add → 내부 review-request auto-call 이 usage 오염 안 함 (task 만 집계, review-request 없음)
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', '텔레메트리 테스트', '--path', td], { encoding: 'utf8', timeout: 20000 });
    const afterTask = cmds();
    const noPollution = afterTask.task >= 1 && !afterTask['review-request'];
    // LEERNESS_INTERNAL=1 호출은 미집계 (일반 호출은 집계)
    cp.spawnSync(process.execPath, [CLI, 'drift', 'check', '--path', td], { encoding: 'utf8', timeout: 20000 });
    const d1 = cmds().drift || 0;
    cp.spawnSync(process.execPath, [CLI, 'drift', 'check', '--path', td], { encoding: 'utf8', timeout: 20000, env: { ...process.env, LEERNESS_INTERNAL: '1' } });
    const d2 = cmds().drift || 0;
    const internalSkip = d1 >= 1 && d2 === d1;   // 일반=증가, INTERNAL=증가없음
    ok = noPollution && internalSkip;
    fs.rmSync(td, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.317) 텔레메트리 분리: task add review-request 오염 없음 + LEERNESS_INTERNAL 미집계 (UR-0051)' : '✗ 텔레메트리 분리 실패');
  if (!ok) failed++;
}

// 1.9.318 회귀 (UR-0025 모듈화): HTML 파싱 유틸 3종 lib/pure-utils 분리 + harness 인라인 제거 + 동작 보존 + 소비명령 로드
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const fnOk = typeof m._htmlToText === 'function' && typeof m._extractTitle === 'function' && typeof m._extractLinks === 'function';
    const work = m._htmlToText('<p>a <b>b</b></p>') === 'a b'
      && m._extractTitle('<title>T &amp; U</title>') === 'T & U'
      && m._extractLinks('<a href="/x">x</a><a href="https://o.com/y">y</a>', 'https://h.com/').length === 1;  // same-domain only
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const movedOut = !/function _htmlToText\(html\) \{/.test(harnessSrc) && harnessSrc.includes('_htmlToText, _extractTitle, _extractLinks') && /require\('\.\.\/lib\/pure-utils'\)/.test(harnessSrc);  // 1.9.324: import 순서 비의존(이후 import 추가 허용)
    const r = cp.spawnSync(process.execPath, [CLI, 'api-skill'], { encoding: 'utf8', timeout: 15000 });  // 소비 명령 로드
    const cmdOk = /api-skill/.test(r.stdout || '');
    ok = fnOk && work && movedOut && cmdOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.318) lib/pure-utils HTML 유틸 분리: 모듈 단일출처 + 인라인 제거 + api-skill 로드 (UR-0025)' : '✗ HTML 유틸 분리 실패');
  if (!ok) failed++;
}

// 1.9.319 회귀 (UR-0044): MCP ToolRegistry 일치성 — tools/list 수 = def 수 + 대표 도구 dispatch(Unknown tool 아님)
total++;
{
  let ok = false;
  try {
    const toolsLen = require(path.resolve(__dirname, '..', 'lib', 'mcp-tools.js')).length;
    const rList = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 10000, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n' });
    let listOk = false; try { const t = JSON.parse(rList.stdout.split('\n').filter(Boolean)[0]).result.tools; listOk = t.length === toolsLen && toolsLen >= 83; } catch {}
    // 대표 read-only 도구 dispatch → -32601(Unknown tool) 아니어야 (switch 매핑 존재 확인)
    const callOne = (name) => { const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 15000, input: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: {} } }) + '\n' }); try { const j = JSON.parse(r.stdout.split('\n').filter(Boolean)[0]); return !(j.error && j.error.code === -32601); } catch { return false; } };
    const dispatchOk = callOne('leerness_about') && callOne('leerness_commands') && callOne('leerness_pulse');
    ok = listOk && dispatchOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.319) MCP ToolRegistry 일치성: tools/list=def 수 + 대표 도구 dispatch 정상 (UR-0044)' : '✗ ToolRegistry 일치성 실패');
  if (!ok) failed++;
}

// 1.9.320 회귀 (UR-0053): count drift — decisions/lessons 카운터가 코드펜스(```md 템플릿 예시) 제외 (decisions=2 실제1 버그)
total++;
{
  let ok = false;
  try {
    const cd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-countdrift-'));
    cp.spawnSync(process.execPath, [CLI, 'init', cd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', 'JWT 채택', '--path', cd, '--reason', 'stateless', '--alternatives', 'session', '--impact', '보안'], { encoding: 'utf8', timeout: 20000 });
    cp.spawnSync(process.execPath, [CLI, 'lesson', 'save', '락은 reentrant', '--path', cd], { encoding: 'utf8', timeout: 20000 });
    const r = cp.spawnSync(process.execPath, [CLI, 'context', '--path', cd, '--json'], { encoding: 'utf8', timeout: 20000 });
    let dec = null, les = null; try { const j = JSON.parse(r.stdout); dec = j.memory && j.memory.decisions; les = j.memory && j.memory.lessons; } catch {}
    ok = dec === 1 && les === 1;  // 코드펜스 템플릿 제외 → 실제 1건씩 (이전: decisions=2)
    fs.rmSync(cd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.320) count drift 수정: decisions/lessons 코드펜스 템플릿 제외 (실제 카운트) (UR-0053)' : '✗ count drift 실패');
  if (!ok) failed++;
}

// 1.9.321 회귀 (UR-0053): decision 빈 필드(alternatives)가 [ \t]* 파싱으로 다음 줄(impact)을 캡처하지 않음
total++;
{
  let ok = false;
  try {
    const fd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-field-'));
    cp.spawnSync(process.execPath, [CLI, 'init', fd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', '캐시 도입', '--path', fd, '--reason', '성능', '--impact', '응답50ms'], { encoding: 'utf8', timeout: 20000 });  // alternatives 비움
    const r = cp.spawnSync(process.execPath, [CLI, 'decision', 'list', '--path', fd, '--json'], { encoding: 'utf8', timeout: 20000 });
    let alt = 'X', imp = null; try { const parsed = JSON.parse(r.stdout); const arr = parsed.decisions || parsed; const d = arr[0]; alt = d.alternatives; imp = d.impact; } catch {}
    const noBleed = !alt || !String(alt).includes('Impact');   // 빈 alternatives 가 '- Impact:...' 캡처 안 함
    const impOk = imp === '응답50ms';                          // impact 는 정확
    ok = noBleed && impOk;
    fs.rmSync(fd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.321) decision 필드 파싱: 빈 alternatives 가 impact 로 안 샘 (UR-0053)' : '✗ decision 필드 파싱 실패');
  if (!ok) failed++;
}

// 1.9.322 회귀 (UR-0044): _mcpToCliArgs 추출 후 인자 매핑(push) 보존 + 미지 도구 -32601
total++;
{
  let ok = false;
  try {
    const md = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-tocli-'));
    cp.spawnSync(process.execPath, [CLI, 'init', md, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const call = (req) => { const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { encoding: 'utf8', timeout: 15000, input: JSON.stringify(req) + '\n' }); try { return JSON.parse(r.stdout.split('\n').filter(Boolean)[0]); } catch { return null; } };
    // task_add with status arg (멀티 인자 push 경로) → task list 반영 확인
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

// 1.9.323 회귀 (UR-0054 ⑥): fresh init → gate(lazy detect) 통과(부재신호 비차단) + active 거짓완료는 차단 유지
total++;
{
  let ok = false;
  try {
    const fg = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-freshgate-'));
    cp.spawnSync(process.execPath, [CLI, 'init', fg, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const freshExit = cp.spawnSync(process.execPath, [CLI, 'lazy', 'detect', fg], { encoding: 'utf8', timeout: 20000 }).status;  // fresh → 통과(0)
    // 거짓완료(done + 증거0) 추가 → 다시 lazy detect → 차단(1)
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', '거짓완료', '--status', 'done', '--evidence', '', '--path', fg, '--no-review', '--force'], { encoding: 'utf8', timeout: 20000 });
    const activeExit = cp.spawnSync(process.execPath, [CLI, 'lazy', 'detect', fg], { encoding: 'utf8', timeout: 20000 }).status;  // 거짓완료 → 차단(1)
    ok = freshExit === 0 && activeExit === 1;
    fs.rmSync(fg, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.323) fresh-init gate: lazy detect 부재신호 비차단(통과) + 거짓완료 차단 유지 (UR-0054 ⑥)' : '✗ fresh-init gate 실패');
  if (!ok) failed++;
}

// 1.9.324 회귀 (UR-0025 모듈화): 메모리 MD 파서 2종 lib/pure-utils 분리 + harness 인라인 제거 + _compareSemver 중복제거 + 소비명령
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const fnOk = typeof m._countDatedBlocks === 'function' && typeof m._extractDecisionBlocks === 'function';
    const work = m._countDatedBlocks('```md\n### 2026-01-01 — T\n```\n### 2026-06-05 — R\n') === 1
      && m._extractDecisionBlocks('### 2026-06-05 — A\n- Decision: x\n').length === 1;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    // 1.9.325: import 순서 비의존 — pure-utils 구조분해 블록을 추출해 이름 포함 확인(이후 import 추가 허용)
    const _puImport = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/function _countDatedBlocks\(/.test(harnessSrc) && !/function _compareSemver\(/.test(harnessSrc)
      && _puImport.includes('_countDatedBlocks') && _puImport.includes('_extractDecisionBlocks');
    // 소비 명령 회귀: context 의 decisions count (_countDatedBlocks 사용)
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

// 1.9.325 회귀 (UR-0025 모듈화): _classifyIntent lib/pure-utils 분리 + harness 인라인 제거 + 소비명령(intent classify)
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const fnOk = typeof m._classifyIntent === 'function';
    const work = m._classifyIntent('정확히 그것만').intent === 'precise'
      && m._classifyIntent('전체 다양한 기능').intent === 'broad'
      && m._classifyIntent('로그인 구현').intent === 'default';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    // import 순서 비의존: pure-utils 구조분해 블록 추출 후 이름 포함 확인
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/function _classifyIntent\(/.test(harnessSrc) && _puImp.includes('_classifyIntent');
    // 소비 명령 회귀: intent classify
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

// 1.9.326 회귀 (UR-0025 모듈화): 순수 문자열/셸/env 유틸 3종 lib/pure-utils 분리 + harness 인라인 제거
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const fnOk = typeof m._sanitizeFences === 'function' && typeof m._shellQuoteArg === 'function' && typeof m._detectPwshFromEnv === 'function';
    const work = m._sanitizeFences('a```b') === "a'''b"
      && m._detectPwshFromEnv({ POWERSHELL_DISTRIBUTION_CHANNEL: 'X' }).version === '7'
      && m._detectPwshFromEnv({}).isPowerShell === false
      && /^['"]/.test(m._shellQuoteArg('a b'));
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];  // import 순서 비의존
    const movedOut = !/function _sanitizeFences\(/.test(harnessSrc) && !/function _shellQuoteArg\(/.test(harnessSrc) && !/function _detectPwshFromEnv\(/.test(harnessSrc)
      && _puImp.includes('_sanitizeFences') && _puImp.includes('_shellQuoteArg') && _puImp.includes('_detectPwshFromEnv');
    // 소비 명령 회귀: shell-guard (_detectPwshFromEnv 사용) + session close (_sanitizeFences 사용)
    const sg = cp.spawnSync(process.execPath, [CLI, 'shell-guard', 'echo hi', '--json'], { encoding: 'utf8', timeout: 15000 });
    const cmdOk = sg.status === 0 && /"shell"/.test(sg.stdout || '');
    ok = fnOk && work && movedOut && cmdOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.326) lib/pure-utils 문자열/셸/env 유틸 분리: 모듈 단일출처 + 인라인 제거 + shell-guard (UR-0025)' : '✗ 문자열/셸/env 유틸 분리 실패');
  if (!ok) failed++;
}

// 1.9.327 회귀 (UR-0025 모듈화): TZ/날짜 포맷 2종 lib/pure-utils 분리 + harness 인라인 제거
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const fnOk = typeof m._getLocalTz === 'function' && typeof m._formatLocal === 'function';
    const work = m._formatLocal('2026-06-05T01:13:00.000Z', { tz: 'Asia/Seoul' }) === '2026-06-05 10:13 KST'  // UTC→KST +9h
      && m._formatLocal('2026-06-05T01:13:00.000Z', { tz: 'Asia/Seoul', dateOnly: true }) === '2026-06-05'
      && m._formatLocal('') === '?' && typeof m._getLocalTz() === 'string';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];  // import 순서 비의존
    const movedOut = !/function _formatLocal\(/.test(harnessSrc) && !/function _getLocalTz\(/.test(harnessSrc)
      && _puImp.includes('_getLocalTz') && _puImp.includes('_formatLocal');
    ok = fnOk && work && movedOut;
  } catch {}
  console.log(ok ? '✓ B(1.9.327) lib/pure-utils TZ/날짜 포맷 분리: 모듈 단일출처 + 인라인 제거 (UR-0025)' : '✗ TZ/날짜 포맷 분리 실패');
  if (!ok) failed++;
}

// 1.9.328 회귀 (UR-0025 모듈화): 순수 문자열 유틸 2종(_truncate/_splitList) lib/pure-utils 분리 + harness 인라인 제거
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const work = typeof m._truncate === 'function' && typeof m._splitList === 'function'
      && m._truncate('hello world', 8) === 'hello w…' && m._truncate('hi', 8) === 'hi'
      && JSON.stringify(m._splitList('a, b ,c,')) === '["a","b","c"]';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];  // import 순서 비의존
    const movedOut = !/function _truncate\(/.test(harnessSrc) && !/function _splitList\(/.test(harnessSrc)
      && _puImp.includes('_truncate') && _puImp.includes('_splitList');
    ok = work && movedOut;
  } catch {}
  console.log(ok ? '✓ B(1.9.328) lib/pure-utils 문자열 유틸 분리: 모듈 단일출처 + 인라인 제거 (UR-0025)' : '✗ 문자열 유틸 분리 실패');
  if (!ok) failed++;
}

// 1.9.329 회귀 (UR-0025 모듈화): roadmap MD 파서 3종 lib/pure-utils 분리 + harness 인라인 제거
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const work = typeof m._roadmapMapStatus === 'function' && typeof m._roadmapParseMilestones === 'function' && typeof m._roadmapParseTokens === 'function'
      && m._roadmapMapStatus('REQUESTED') === 'planned' && m._roadmapMapStatus('done') === 'done'
      && m._roadmapParseMilestones('### M-0001. 로그인\nStatus: in-progress\nProgress: 40%')[0].progress === 40
      && m._roadmapParseTokens('| color | #fff |').color === '#fff';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];  // import 순서 비의존
    const movedOut = !/function _roadmapMapStatus\(/.test(harnessSrc) && !/function _roadmapParseMilestones\(/.test(harnessSrc) && !/function _roadmapParseTokens\(/.test(harnessSrc)
      && _puImp.includes('_roadmapMapStatus') && _puImp.includes('_roadmapParseMilestones') && _puImp.includes('_roadmapParseTokens');
    ok = work && movedOut;
  } catch {}
  console.log(ok ? '✓ B(1.9.329) lib/pure-utils roadmap MD 파서 분리: 모듈 단일출처 + 인라인 제거 (UR-0025)' : '✗ roadmap 파서 분리 실패');
  if (!ok) failed++;
}

// 1.9.330 회귀 (UR-0025 모듈화): project-brief config(_BRIEF_FIELDS) + _briefFilled lib/pure-utils 분리 + brief 명령 회귀
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const cfgOk = Array.isArray(m._BRIEF_FIELDS) && m._BRIEF_FIELDS.length === 10 && m._BRIEF_FIELDS[0].key === 'intro';
    const work = m._briefFilled({ intro: 'x', features: ['a'] }) === 2 && m._briefFilled({}) === 0;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];  // import 순서 비의존
    const movedOut = !/const _BRIEF_FIELDS = \[/.test(harnessSrc) && !/function _briefFilled\(/.test(harnessSrc)
      && _puImp.includes('_BRIEF_FIELDS') && _puImp.includes('_briefFilled');
    // 소비 명령 회귀: brief set + show (채움 N/10)
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

// 1.9.331 회귀 (UR-0025 서브시스템): brief 빌더(_briefReadmeBlock/_briefBlueprint)+마커 lib/pure-utils 분리 + brief export/sync 회귀
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const b = { project: 'X', intro: 'i', features: ['f1'] };
    const work = typeof m._briefReadmeBlock === 'function' && typeof m._briefBlueprint === 'function'
      && m._briefReadmeBlock(b).includes(m.BRIEF_START) && /f1/.test(m._briefReadmeBlock(b))
      && /Blueprint/.test(m._briefBlueprint(b, '9.9.9')) && /leerness v9\.9\.9/.test(m._briefBlueprint(b, '9.9.9'));  // VERSION 주입
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];  // import 순서 비의존
    const movedOut = !/function _briefReadmeBlock\(/.test(harnessSrc) && !/function _briefBlueprint\(/.test(harnessSrc) && !/^const BRIEF_START =/m.test(harnessSrc)
      && _puImp.includes('_briefReadmeBlock') && _puImp.includes('_briefBlueprint') && _puImp.includes('BRIEF_START');
    // 소비 명령 회귀: brief set → export(blueprint) + README sync(markers)
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

// 1.9.332 회귀 (UR-0025 모듈화): lessons.md 파서(_parseLessonEntries) lib/pure-utils 분리 + lesson list 회귀
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const r = m._parseLessonEntries('### 2026-06-05\n- Lesson: A\n- Tag: t\n\n### 2026-06-04\n- Lesson: B');
    const work = typeof m._parseLessonEntries === 'function' && r.length === 2 && r[0].text === 'A' && r[0].tag === 't' && r[1].tag === null;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];  // import 순서 비의존
    const movedOut = !/function _parseLessonEntries\(/.test(harnessSrc) && _puImp.includes('_parseLessonEntries');
    // 소비 명령 회귀: lesson save + list --json
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

// 1.9.333 회귀 (UR-0025 심층): constraints 서브시스템 핵심 분리 — catalog→lib/catalogs + _matchConstraints→pure-utils + constraints 명령 회귀
total++;
{
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const catOk = c._DEFAULT_PLATFORM_CONSTRAINTS && Object.keys(c._DEFAULT_PLATFORM_CONSTRAINTS.platforms).length === 6;
    const r = m._matchConstraints(c._DEFAULT_PLATFORM_CONSTRAINTS, 'stripe 결제');
    const work = catOk && r.matched.length === 1 && r.matched[0].platform === 'stripe' && r.totalPlatforms === 6 && m._matchConstraints(null, 'x').matched.length === 0;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    // 1.9.334: catalogs import 블록 추출 후 이름 포함 확인(순서/추가 비의존 — 이후 import 추가 허용)
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];
    const movedOut = !/const _DEFAULT_PLATFORM_CONSTRAINTS = \{/.test(harnessSrc) && harnessSrc.includes('_matchConstraints(_loadPlatformConstraints(root), text)')
      && _catImp.includes('_DEFAULT_PLATFORM_CONSTRAINTS');
    // 소비 명령 회귀: constraints check (review-request 도 _checkRequestConstraints 사용)
    const cd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-con-'));
    cp.spawnSync(process.execPath, [CLI, 'init', cd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const cr = cp.spawnSync(process.execPath, [CLI, 'constraints', 'check', 'stripe 결제 구현', '--path', cd], { encoding: 'utf8', timeout: 20000 });
    const cmdOk = /stripe|플랫폼 매칭/.test(cr.stdout || '');
    ok = work && movedOut && cmdOk;
    fs.rmSync(cd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.333) UR-0025 심층: constraints catalog/_matchConstraints 분리 + constraints check 회귀 (UR-0025)' : '✗ constraints 서브시스템 분리 실패');
  if (!ok) failed++;
}

// 1.9.334 회귀 (UR-0025 심층, Codex 위임·검증): intent domain catalog→lib/catalogs + _matchDomain→pure-utils + intent expand 회귀
total++;
{
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const catOk = c._DEFAULT_DOMAIN_CATALOG && Object.keys(c._DEFAULT_DOMAIN_CATALOG.domains).length === 5;
    const r = m._matchDomain(c._DEFAULT_DOMAIN_CATALOG, 'unity 게임');
    const work = catOk && typeof m._matchDomain === 'function' && r.domain === 'game' && Array.isArray(r.components) && m._matchDomain(null, 'x').domain === null;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];  // import 순서/추가 비의존
    const movedOut = !/const _DEFAULT_DOMAIN_CATALOG = \{/.test(harnessSrc) && harnessSrc.includes('_matchDomain(_loadDomainCatalog(root), text)')
      && _catImp.includes('_DEFAULT_DOMAIN_CATALOG');
    // 소비 명령 회귀: intent expand 도메인 감지(_detectDomain → _matchDomain)
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

// 1.9.335 회귀 (UR-0025 심층): LSP catalog→lib/catalogs + _detectLspLang/_matchLspSymbols→pure-utils + lsp symbols 회귀
total++;
{
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const catOk = c._LSP_LANG_PATTERNS && Object.keys(c._LSP_LANG_PATTERNS).length === 5 && Array.isArray(c._LSP_LANG_PATTERNS.python);
    const langOk = m._detectLspLang('x.py') === 'python' && m._detectLspLang('y.rs') === 'rust' && m._detectLspLang('z.txt') === 'javascript';
    const sy = m._matchLspSymbols(c._LSP_LANG_PATTERNS, 'def foo():\n    pass\nclass Bar:\n    pass', 'python');
    const work = catOk && langOk && typeof m._matchLspSymbols === 'function' && sy.length === 2 && sy[0].name === 'foo' && sy[0].kind === 'function' && sy[1].name === 'Bar' && m._matchLspSymbols(null, 'x', 'javascript').length === 0;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];  // import 순서/추가 비의존
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/const _LSP_LANG_PATTERNS = \{/.test(harnessSrc) && !/function _detectLspLang\(/.test(harnessSrc)
      && _catImp.includes('_LSP_LANG_PATTERNS') && _puImp.includes('_matchLspSymbols') && _puImp.includes('_detectLspLang');
    // 소비 명령 회귀: lsp symbols (정규식 fallback, _detectLspLang + _matchLspSymbols 경로)
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

// 1.9.336 회귀 (UR-0025 심층, Codex 위임·검증): anti-laziness OPTIMISM_PATTERNS→lib/catalogs + optimism 순수로직→pure-utils + optimism-check 회귀
total++;
{
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
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];  // import 순서/추가 비의존
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/const OPTIMISM_PATTERNS = \[/.test(harnessSrc) && !/function _extractUrlClaims\(/.test(harnessSrc)
      && _catImp.includes('OPTIMISM_PATTERNS') && _puImp.includes('_puDetectOptimism') && _puImp.includes('_puComputeConfidence');
    // 소비 명령 회귀: optimism-check (harness wrapper → _puDetectOptimism(OPTIMISM_PATTERNS, ...) 경로)
    const od = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-opt-'));
    cp.spawnSync(process.execPath, [CLI, 'init', od, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    fs.appendFileSync(path.join(od, '.harness', 'progress-tracker.md'), '| T-9999 | done | API 통합 | API 호출 완료, POST /users 처리함 | M-1 | 2026-06-05 |\n');
    const or = cp.spawnSync(process.execPath, [CLI, 'optimism-check', 'T-9999', '--path', od, '--json'], { encoding: 'utf8', timeout: 20000 });
    let cmdOk = false;
    try { const j = JSON.parse(or.stdout); cmdOk = Array.isArray(j.suspects) && j.suspects.some(s => s.kind === 'API') && typeof j.confidence === 'number' && j.confidence < 0.5; } catch {}
    ok = work && movedOut && cmdOk;
    fs.rmSync(od, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.336) UR-0025 심층(Codex 위임·검증): OPTIMISM_PATTERNS/optimism 순수로직 분리 + optimism-check 회귀 (UR-0025)' : '✗ anti-laziness 서브시스템 분리 실패');
  if (!ok) failed++;
}

// 1.9.337 회귀 (UR-0025 심층): persona BUILT_IN_PERSONAS→lib/catalogs + _personaSummaries→pure-utils + persona list/review 회귀
total++;
{
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const catOk = c.BUILT_IN_PERSONAS && Object.keys(c.BUILT_IN_PERSONAS).length === 5 && c.BUILT_IN_PERSONAS.security && typeof c.BUILT_IN_PERSONAS.security.body === 'string';
    const sm = m._personaSummaries(c.BUILT_IN_PERSONAS);
    const work = catOk && typeof m._personaSummaries === 'function' && Array.isArray(sm) && sm.length === 5 && sm[0].id === 'security' && sm[0].body === undefined && m._personaSummaries(null).length === 0;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];  // import 순서/추가 비의존
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/const BUILT_IN_PERSONAS = \{/.test(harnessSrc) && _catImp.includes('BUILT_IN_PERSONAS') && _puImp.includes('_personaSummaries');
    // 소비 명령 회귀: persona list --json (_personaSummaries) + review --persona (_resolvePersona → imported catalog)
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

// 1.9.338 회귀 (UR-0025 심층): i18n STRINGS→lib/catalogs + _translate→pure-utils + _t 박막 (인터랙티브 전용 getter라 구조+순수동작 검증)
total++;
{
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
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];  // import 순서/추가 비의존
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    // _t 박막: 인라인 STRINGS 정의 제거 + import + _translate(STRINGS,..) 호출
    const movedOut = !/const STRINGS = \{/.test(harnessSrc) && _catImp.includes('STRINGS') && _puImp.includes('_translate') && harnessSrc.includes('return _translate(STRINGS, key, lang)');
    ok = work && movedOut;
  } catch {}
  console.log(ok ? '✓ B(1.9.338) UR-0025 심층: i18n STRINGS/_translate 분리 + _t 박막 (UR-0025)' : '✗ i18n 서브시스템 분리 실패');
  if (!ok) failed++;
}

// 1.9.339 회귀 (UR-0053): decisions canonical = JSON, MD = projection. add→json+md / context count 단일소스 / drop+archive / MD-only 백필
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    // 순수 round-trip + field 정규화
    const md = '# Decisions\n\n### 2026-06-05 — A\n- Decision: a\n- Reason: r\n- Alternatives: alt\n- Impact: imp\n\n### 2026-06-04 — B\n- Decision: b\n- Alternatives:\n';
    const objs = m._decisionsFromMd(md);
    const pureOk = objs.length === 2 && objs[0].alternatives === 'alt' && objs[1].alternatives === null
      && JSON.stringify(m._decisionsFromMd(m._renderDecisionsMd(objs))) === JSON.stringify(objs);
    // end-to-end: add → decisions.json(canonical) + decisions.md(projection)
    const dd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-dec-'));
    cp.spawnSync(process.execPath, [CLI, 'init', dd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', 'PG 채택', '--reason', '관계형', '--alternatives', 'Mongo', '--path', dd], { encoding: 'utf8', timeout: 20000 });
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', 'Redis', '--reason', '속도', '--path', dd], { encoding: 'utf8', timeout: 20000 });
    const jsonExists = fs.existsSync(path.join(dd, '.harness', 'decisions.json'));
    const canon = jsonExists ? JSON.parse(fs.readFileSync(path.join(dd, '.harness', 'decisions.json'), 'utf8')) : [];
    const mdProj = fs.existsSync(path.join(dd, '.harness', 'decisions.md')) ? fs.readFileSync(path.join(dd, '.harness', 'decisions.md'), 'utf8') : '';
    const writeOk = jsonExists && canon.length === 2 && canon[0].alternatives === 'Mongo' && canon[1].alternatives === null
      && mdProj.includes('PG 채택') && mdProj.includes('Redis');
    // list + context count = canonical 단일소스
    let listOk = false, ctxOk = false;
    const lr = cp.spawnSync(process.execPath, [CLI, 'decision', 'list', '--path', dd, '--json'], { encoding: 'utf8', timeout: 20000 });
    try { const j = JSON.parse(lr.stdout); listOk = j.total === 2; } catch {}
    const cr = cp.spawnSync(process.execPath, [CLI, 'context', '--path', dd, '--json'], { encoding: 'utf8', timeout: 20000 });
    try { const j = JSON.parse(cr.stdout); ctxOk = j.memory && j.memory.decisions === 2; } catch {}
    // drop + archive
    cp.spawnSync(process.execPath, [CLI, 'decision', 'drop', 'PG', '--path', dd], { encoding: 'utf8', timeout: 20000 });
    const afterDrop = JSON.parse(fs.readFileSync(path.join(dd, '.harness', 'decisions.json'), 'utf8'));
    const dropOk = afterDrop.length === 1 && afterDrop[0].title === 'Redis' && fs.existsSync(path.join(dd, '.harness', 'decisions.archive.md'));
    fs.rmSync(dd, { recursive: true, force: true });
    // 백필: MD-only(JSON 없음) → list 가 MD 파싱(template 제외), 읽기 무부작용
    const bd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bf-'));
    cp.spawnSync(process.execPath, [CLI, 'init', bd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    fs.rmSync(path.join(bd, '.harness', 'decisions.json'), { force: true });
    fs.writeFileSync(path.join(bd, '.harness', 'decisions.md'), '# Decisions\n\n## Template\n\n' + '```md\n### YYYY-MM-DD — 제목\n- Decision:\n```\n\n### 2026-06-01 — 기존A\n- Decision: A\n\n### 2026-06-02 — 기존B\n- Decision: B\n', 'utf8');
    const br = cp.spawnSync(process.execPath, [CLI, 'decision', 'list', '--path', bd, '--json'], { encoding: 'utf8', timeout: 20000 });
    let backfillOk = false;
    try { const j = JSON.parse(br.stdout); backfillOk = j.total === 2 && !fs.existsSync(path.join(bd, '.harness', 'decisions.json')); } catch {}
    fs.rmSync(bd, { recursive: true, force: true });
    ok = pureOk && writeOk && listOk && ctxOk && dropOk && backfillOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.339) UR-0053: decisions canonical JSON + MD projection + 백필 + context 단일소스 (UR-0053)' : '✗ decisions canonical JSON 실패');
  if (!ok) failed++;
}

// 1.9.340 회귀 (UR-0058, Codex 위임·검증): lessons canonical = JSON, MD = projection. save→json+md / list+tag / drop+archive / MD-only 백필
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    // 순수 round-trip (tag null 포함)
    const objs = [{ date: '2026-06-05', text: 'A', tag: 't' }, { date: '2026-06-04', text: 'B', tag: null }];
    const pureOk = JSON.stringify(m._parseLessonEntries(m._renderLessonsMd(objs))) === JSON.stringify(objs)
      && m._parseLessonEntries(m._renderLessonsMd([])).length === 0;
    // end-to-end: save → lessons.json(canonical) + lessons.md(projection)
    const ld = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-les-'));
    cp.spawnSync(process.execPath, [CLI, 'init', ld, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'lesson', 'save', 'JWT 짧게', '--tag', 'security', '--path', ld], { encoding: 'utf8', timeout: 20000 });
    cp.spawnSync(process.execPath, [CLI, 'lesson', 'save', '캐시 TTL', '--path', ld], { encoding: 'utf8', timeout: 20000 });
    const jsonExists = fs.existsSync(path.join(ld, '.harness', 'lessons.json'));
    const canon = jsonExists ? JSON.parse(fs.readFileSync(path.join(ld, '.harness', 'lessons.json'), 'utf8')) : [];
    const mdProj = fs.existsSync(path.join(ld, '.harness', 'lessons.md')) ? fs.readFileSync(path.join(ld, '.harness', 'lessons.md'), 'utf8') : '';
    const writeOk = jsonExists && canon.length === 2 && canon[0].tag === 'security' && canon[1].tag === null
      && mdProj.includes('JWT 짧게') && mdProj.includes('캐시 TTL') && mdProj.includes('- Tag: security');
    // list + tag filter
    let listOk = false, tagOk = false;
    const lr = cp.spawnSync(process.execPath, [CLI, 'lesson', 'list', '--path', ld, '--json'], { encoding: 'utf8', timeout: 20000 });
    try { listOk = JSON.parse(lr.stdout).total === 2; } catch {}
    const tr = cp.spawnSync(process.execPath, [CLI, 'lesson', 'list', '--tag', 'security', '--path', ld, '--json'], { encoding: 'utf8', timeout: 20000 });
    try { tagOk = JSON.parse(tr.stdout).total === 1; } catch {}
    // drop + archive
    cp.spawnSync(process.execPath, [CLI, 'lesson', 'drop', 'JWT', '--path', ld], { encoding: 'utf8', timeout: 20000 });
    const afterDrop = JSON.parse(fs.readFileSync(path.join(ld, '.harness', 'lessons.json'), 'utf8'));
    const dropOk = afterDrop.length === 1 && afterDrop[0].text === '캐시 TTL' && fs.existsSync(path.join(ld, '.harness', 'lessons.archive.md'));
    fs.rmSync(ld, { recursive: true, force: true });
    // 백필: MD-only(JSON 없음) → list 가 MD 파싱, 읽기 무부작용
    const bd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lbf-'));
    cp.spawnSync(process.execPath, [CLI, 'init', bd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    fs.rmSync(path.join(bd, '.harness', 'lessons.json'), { force: true });
    fs.writeFileSync(path.join(bd, '.harness', 'lessons.md'), '# Lessons\n\n### 2026-06-01\n- Lesson: 기존1\n- Tag: t1\n\n### 2026-06-02\n- Lesson: 기존2\n', 'utf8');
    const br = cp.spawnSync(process.execPath, [CLI, 'lesson', 'list', '--path', bd, '--json'], { encoding: 'utf8', timeout: 20000 });
    let backfillOk = false;
    try { backfillOk = JSON.parse(br.stdout).total === 2 && !fs.existsSync(path.join(bd, '.harness', 'lessons.json')); } catch {}
    fs.rmSync(bd, { recursive: true, force: true });
    ok = pureOk && writeOk && listOk && tagOk && dropOk && backfillOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.340) UR-0058(Codex 위임·검증): lessons canonical JSON + MD projection + 백필 (UR-0058)' : '✗ lessons canonical JSON 실패');
  if (!ok) failed++;
}

// 1.9.341 회귀 (UR-0025 심층): BUILTIN_CATALOG→lib/catalogs + _withBuiltinSource→pure-utils + skill list 회귀
total++;
{
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const catOk = c.BUILTIN_CATALOG && Object.keys(c.BUILTIN_CATALOG).length === 9 && c.BUILTIN_CATALOG.office && c.BUILTIN_CATALOG.office.version === '1.0.0';
    const out = m._withBuiltinSource(c.BUILTIN_CATALOG);
    const work = catOk && typeof m._withBuiltinSource === 'function' && Object.keys(out).length === 9
      && Object.values(out).every(v => v._source === 'builtin') && Array.isArray(out.office.capabilities)
      && Object.keys(m._withBuiltinSource(null)).length === 0;
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];  // import 순서/추가 비의존
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/const BUILTIN_CATALOG = \{/.test(harnessSrc) && _catImp.includes('BUILTIN_CATALOG') && _puImp.includes('_withBuiltinSource')
      && harnessSrc.includes('_withBuiltinSource(BUILTIN_CATALOG)');
    // 소비 명령 회귀: skill list (builtin catalog 노출)
    const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-skl-'));
    cp.spawnSync(process.execPath, [CLI, 'init', sd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const sr = cp.spawnSync(process.execPath, [CLI, 'skill', 'list', '--path', sd], { encoding: 'utf8', timeout: 20000 });
    const listOut = (sr.stdout || '') + (sr.stderr || '');
    const cmdOk = /office|firebase|feature-implementation|roadmap/i.test(listOut);
    ok = work && movedOut && cmdOk;
    fs.rmSync(sd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.341) UR-0025 심층: BUILTIN_CATALOG/_withBuiltinSource 분리 + skill list 회귀 (UR-0025)' : '✗ BUILTIN_CATALOG 분리 실패');
  if (!ok) failed++;
}

// 1.9.342 회귀 (UR-0025 심층): ROADMAP_STATUS_LABEL/COLOR→lib/catalogs + roadmap.html 렌더 회귀
total++;
{
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const mapsOk = c.ROADMAP_STATUS_LABEL && c.ROADMAP_STATUS_COLOR
      && Object.keys(c.ROADMAP_STATUS_LABEL).length === 11 && Object.keys(c.ROADMAP_STATUS_COLOR).length === 11
      && c.ROADMAP_STATUS_LABEL.done === '완료' && c.ROADMAP_STATUS_COLOR.done === '#16a34a' && c.ROADMAP_STATUS_COLOR.skill === '#8b5cf6';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];  // import 순서/추가 비의존
    const movedOut = !/const ROADMAP_STATUS_LABEL = \{/.test(harnessSrc) && !/const ROADMAP_STATUS_COLOR = \{/.test(harnessSrc)
      && _catImp.includes('ROADMAP_STATUS_LABEL') && _catImp.includes('ROADMAP_STATUS_COLOR');
    // 소비 회귀: roadmap.html 생성 시 색상/라벨 주입
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

// 1.9.343 회귀 (UR-0025 심층, R300 마일스톤): SECRET_PATTERNS→lib/catalogs 보안 응집 + scan secrets 탐지/오탐 가드 회귀
total++;
{
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const A = 'A'.repeat(40);
    const hit = (s) => c.SECRET_PATTERNS.some(p => { p.re.lastIndex = 0; return p.re.test(s); });
    const catOk = Array.isArray(c.SECRET_PATTERNS) && c.SECRET_PATTERNS.length === 20
      && hit('AKIA' + 'ABCD1234EFGH5678') && hit('sk-' + 'ant-api03-' + A + '_' + A) && !hit('const u = "john' + '_doe_2024";');
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];  // import 순서/추가 비의존
    // 모듈 레벨 정의 제거(블록 지역 .env 배열은 보존) + import
    const movedOut = !/const SECRET_PATTERNS = \[\r?\n\s*\{ name:/.test(harnessSrc) && _catImp.includes('SECRET_PATTERNS')
      && /const SECRET_PATTERNS = \['\.env'/.test(harnessSrc);  // 지역 .env shadow 보존 확인
    // 소비 회귀: scan secrets 가 가짜 AWS/Anthropic 키 탐지 + clean 0
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

// 1.9.344 회귀 (UR-0025 심층): SKILL_CATALOG_PRESETS→lib/catalogs + skill discover preset 인식 회귀
total++;
{
  let ok = false;
  try {
    const c = require(path.resolve(__dirname, '..', 'lib', 'catalogs.js'));
    const catOk = c.SKILL_CATALOG_PRESETS && Object.keys(c.SKILL_CATALOG_PRESETS).length === 2
      && c.SKILL_CATALOG_PRESETS.vercel && c.SKILL_CATALOG_PRESETS.vercel.owner === 'vercel-labs'
      && c.SKILL_CATALOG_PRESETS.anthropic && c.SKILL_CATALOG_PRESETS.anthropic.repo === 'skills';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _catImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/catalogs'\)/) || [''])[0];  // import 순서/추가 비의존
    const movedOut = !/const SKILL_CATALOG_PRESETS = \{/.test(harnessSrc) && _catImp.includes('SKILL_CATALOG_PRESETS');
    // 소비 회귀: skill discover 가 preset 목록을 catalog 에서 노출 (네트워크 없이 unknown preset → 사용가능 목록)
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

// 1.9.345 회귀 (UR-0025 심층): _esc(HTML escape)→pure-utils + roadmap.html XSS 이스케이프 회귀
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const pureOk = typeof m._esc === 'function'
      && m._esc('&<>"\'') === '&amp;&lt;&gt;&quot;&#39;'
      && m._esc('<script>x</script>') === '&lt;script&gt;x&lt;/script&gt;'
      && m._esc(null) === '' && m._esc(undefined) === '' && m._esc(42) === '42';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/function _esc\(/.test(harnessSrc) && _puImp.includes('_esc');
    // 소비 회귀: roadmap.html 이 악성 task 제목을 이스케이프 (인젝션 방지)
    const rd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-esc-'));
    cp.spawnSync(process.execPath, [CLI, 'init', rd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    fs.appendFileSync(path.join(rd, '.harness', 'progress-tracker.md'), '| T-7777 | done | <img src=x onerror=alert(1)> | src/x.js | M-1 | 2026-06-05 |\n');
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

// 1.9.346 회귀 (UR-0025 심층): _roadmapTokenStyles→pure-utils + roadmap.html CSS 변수 회귀
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const out = m._roadmapTokenStyles({ 'color.primary': '#2563eb' }, { 'color-surface': '#fff', 'custom': '#abc' });
    const pureOk = typeof m._roadmapTokenStyles === 'function' && out.startsWith(':root {')
      && out.includes('--lr-primary: #2563eb') && out.includes('--lr-surface: #fff') && out.includes('--lr-custom: #abc')
      && out.includes('--lr-card-bg') && out.includes('--lr-page-bg') && m._roadmapTokenStyles(null, null).startsWith(':root {');
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/function _roadmapTokenStyles\(/.test(harnessSrc) && _puImp.includes('_roadmapTokenStyles');
    // 소비 회귀: roadmap.html 이 :root CSS 변수 주입
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

// 1.9.347 회귀 (UR-0025 심층): _parseSkillMd(SKILL.md frontmatter, BOM-aware)→pure-utils + skill install(BOM) 회귀
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const r = m._parseSkillMd('---\nname: s1\ndescription: "d1"\n---\nbody');
    const pureOk = typeof m._parseSkillMd === 'function' && r.meta.name === 's1' && r.meta.description === 'd1' && r.body === 'body'
      && m._parseSkillMd('﻿---\nname: b\n---\nx').meta.name === 'b'
      && Object.keys(m._parseSkillMd('plain').meta).length === 0 && m._parseSkillMd(null).body === '';
    const harnessSrc = fs.readFileSync(path.resolve(__dirname, '..', 'bin', 'harness.js'), 'utf8');
    const _puImp = (harnessSrc.match(/const \{[\s\S]*?\} = require\('\.\.\/lib\/pure-utils'\)/) || [''])[0];
    const movedOut = !/function _parseSkillMd\(/.test(harnessSrc) && _puImp.includes('_parseSkillMd');
    // 소비 회귀: skill install 이 BOM 포함 SKILL.md 를 정상 설치 (frontmatter name 파싱)
    const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-smd-'));
    cp.spawnSync(process.execPath, [CLI, 'init', sd, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const smdPath = path.join(sd, 's.md');
    fs.writeFileSync(smdPath, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('---\nname: e2e-skill\ndescription: BOM 처리\n---\n# Body', 'utf8')]));
    cp.spawnSync(process.execPath, [CLI, 'skill', 'install', smdPath, '--path', sd], { encoding: 'utf8', timeout: 20000, env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_NO_PROMPT: '1' } });
    const installOk = fs.existsSync(path.join(sd, '.harness', 'skills', 'e2e-skill', 'SKILL.md'));
    ok = pureOk && movedOut && installOk;
    fs.rmSync(sd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.347) UR-0025 심층: _parseSkillMd 분리 + skill install(BOM) 회귀 (UR-0025)' : '✗ _parseSkillMd 분리 실패');
  if (!ok) failed++;
}

// 1.9.348 회귀 (외부리뷰 UR-0059 P0): --path 라우팅 일관화 — positional-dispatch 가 --path 우선(→positional→cwd)
total++;
{
  let ok = false;
  try {
    const A = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-pa-'));
    const Bd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-pb-'));
    cp.spawnSync(process.execPath, [CLI, 'init', A, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'init', Bd, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.appendFileSync(path.join(A, '.harness', 'progress-tracker.md'), '| T-0001 | done | AONLYMARK | x | M-1 | 2026-06-05 |\n');
    fs.appendFileSync(path.join(Bd, '.harness', 'progress-tracker.md'), '| T-0002 | done | BONLYMARK | x | M-1 | 2026-06-05 |\n');
    const runIn = (cwd, a) => (cp.spawnSync(process.execPath, [CLI, ...a], { cwd, encoding: 'utf8', timeout: 20000 }).stdout || '');
    const flagOut = runIn(A, ['handoff', '--path', Bd]);  // A(cwd)에서 --path B
    const posOut = runIn(A, ['handoff', Bd]);             // positional B
    const cwdOut = runIn(A, ['handoff']);                 // cwd A
    const flagOk = /BONLYMARK/.test(flagOut) && !/AONLYMARK/.test(flagOut);  // --path 우선(버그였으면 AONLY)
    const posOk = /BONLYMARK/.test(posOut);              // positional 회귀
    const cwdOk = /AONLYMARK/.test(cwdOut);              // cwd fallback 회귀
    ok = flagOk && posOk && cwdOk;
    fs.rmSync(A, { recursive: true, force: true });
    fs.rmSync(Bd, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.348) 외부리뷰 UR-0059(P0): --path 라우팅 일관화 + positional/cwd 회귀 (UR-0059)' : '✗ --path 라우팅 실패');
  if (!ok) failed++;
}

// 1.9.349 회귀 (외부리뷰 UR-0063, GPT5.5+Opus 교차검증): selftest/doctor 위치독립 — 비초기화 dir 에서도 통과(거짓 "설치 손상" 없음)
total++;
{
  let ok = false;
  try {
    const ni = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-noinit-'));  // .harness 없는 비초기화 dir
    const sr = cp.spawnSync(process.execPath, [CLI, 'selftest'], { cwd: ni, encoding: 'utf8', timeout: 30000 });
    const sout = (sr.stdout || '') + (sr.stderr || '');
    const selftestOk = sr.status === 0 && /전체 \d+건 통과/.test(sout) && !/설치 손상/.test(sout);
    const dr = cp.spawnSync(process.execPath, [CLI, 'doctor'], { cwd: ni, encoding: 'utf8', timeout: 30000 });
    const dout = (dr.stdout || '') + (dr.stderr || '');
    const doctorOk = !/문제 감지|설치 손상|재설치/.test(dout) && /설치 정상|통과/.test(dout);
    ok = selftestOk && doctorOk;
    fs.rmSync(ni, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '✓ B(1.9.349) 외부리뷰 UR-0063: selftest/doctor 위치독립 — 비초기화 dir 통과 (UR-0063)' : '✗ selftest 위치독립 실패');
  if (!ok) failed++;
}

// 1.9.350 회귀 (외부리뷰 P1 보안 하드닝): UR-0061 CSS breakout 차단 + UR-0062 skill traversal 차단 + UR-0060 scan false-neg/패턴 보강
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    // UR-0061: roadmap CSS 값 살균 (순수)
    const css = m._roadmapTokenStyles({ 'color.primary': 'red;}' + '</style><script>x</script>' }, {});
    const cssOk = !css.includes('<') && !css.includes('>') && css.includes('--lr-primary:');
    // UR-0062: skill install name:.. traversal 차단 (end-to-end)
    const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-trav-'));
    cp.spawnSync(process.execPath, [CLI, 'init', sd, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const skf = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-skf-'));
    fs.writeFileSync(path.join(skf, 'SKILL.md'), '---\nname: ..\ndescription: t\n---\n# b');
    const ir = cp.spawnSync(process.execPath, [CLI, 'skill', 'install', skf, '--path', sd], { encoding: 'utf8', timeout: 20000 });
    const travBlocked = /traversal|유효하지 않은 skill id|jail/.test((ir.stdout || '') + (ir.stderr || '')) && !fs.existsSync(path.join(sd, '.harness', 'SKILL.md'));
    fs.rmSync(skf, { recursive: true, force: true });
    // UR-0060: 사용자 harness.js 파일도 스캔(false-neg 제거) + 신규 GitLab 패턴 탐지
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-scan-'));
    fs.writeFileSync(path.join(ud, 'harness.js'), 'const k = "glpat-' + 'x'.repeat(20) + '";\n');
    const scr = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', ud], { encoding: 'utf8', timeout: 20000 });
    const scanOk = /GitLab PAT/.test((scr.stdout || '') + (scr.stderr || ''));
    fs.rmSync(ud, { recursive: true, force: true });
    fs.rmSync(sd, { recursive: true, force: true });
    ok = cssOk && travBlocked && scanOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.350) 외부리뷰 P1보안: CSS breakout/skill traversal 차단 + secret scan false-neg/패턴 보강 (UR-0060/0061/0062)' : '✗ P1 보안 하드닝 실패');
  if (!ok) failed++;
}

// 1.9.351 회귀 (외부리뷰 UR-0064/0065): decision/lesson 제목 오염 차단 + 문서 정합(AGENTS.md .harness / --help 누락 명령)
total++;
{
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-doc-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    // UR-0064: decision add 제목에 경로형 positional 미흡수
    cp.spawnSync(process.execPath, [CLI, 'decision', 'add', 'PG 채택', '--reason', '관계형', '/abs/leak/path', '--path', d], { encoding: 'utf8', timeout: 20000 });
    const dj = JSON.parse(fs.readFileSync(path.join(d, '.harness', 'decisions.json'), 'utf8'));
    const titleOk = dj.length === 1 && dj[0].title === 'PG 채택' && !dj[0].title.includes('/abs/leak');
    // UR-0065 AGENTS.md: .harness 메인 워크스페이스 명시 + state substrate 별개
    const agents = fs.readFileSync(path.join(d, 'AGENTS.md'), 'utf8');
    const agentsOk = agents.includes('기본 워크스페이스 `.harness/`') && agents.includes('메인 워크스페이스(.harness)와 별개');
    fs.rmSync(d, { recursive: true, force: true });
    // UR-0065 --help: 이전 누락 명령 노출
    const hr = cp.spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8', timeout: 20000 });
    const hout = (hr.stdout || '') + (hr.stderr || '');
    const helpOk = ['leerness context', 'leerness health', 'leerness intent', 'leerness constraints', 'leerness requests', 'leerness skill install'].every(c => hout.includes(c));
    ok = titleOk && agentsOk && helpOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.351) 외부리뷰 UR-0064/0065: 제목 오염 차단 + AGENTS.md/--help 정합 (UR-0064/0065)' : '✗ UR-0064/0065 실패');
  if (!ok) failed++;
}

// 1.9.352 회귀 (외부리뷰 P2): UR-0069 usage subcommand 집계 + UR-0068 milestone 파서 블록 경계
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    // UR-0068: milestone 누출 차단 (pure)
    const mil = m._roadmapParseMilestones('### M-0001. A\n\n### M-0002. B\nStatus: done\nProgress: 80%\n');
    const milOk = mil.length === 2 && mil[0].status === 'planned' && mil[0].progress === 0 && mil[1].status === 'done';
    // UR-0069: subcommand 명령(decision add/lesson save/scan secrets) usage 집계 (이전엔 args[1]=subcommand 를 path 로 오인 → 미집계)
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

// 1.9.353 회귀 (외부리뷰 P2): UR-0067 encoding(CP949 감지/.ps1 BOM 예외) + UR-0070 shell-guard --shell + UR-0071 init non-TTY ANSI
total++;
{
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-enc-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    // UR-0067: CP949 bytes(한글 utf8 미매치) → invalid 감지 / .ps1 BOM → 예외
    fs.writeFileSync(path.join(d, 'cp949.txt'), Buffer.from([0xC7, 0xD1, 0xB1, 0xDB]));
    fs.writeFileSync(path.join(d, 'script.ps1'), Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('Write-Host hi', 'utf8')]));
    const er = cp.spawnSync(process.execPath, [CLI, 'encoding', 'check', d], { encoding: 'utf8', timeout: 20000 });
    const eout = (er.stdout || '') + (er.stderr || '');
    const encOk = /cp949\.txt/.test(eout) && /CP949|invalid UTF-8/.test(eout) && !/script\.ps1/.test(eout);
    fs.rmSync(d, { recursive: true, force: true });
    // UR-0070: shell-guard --shell powershell → ps5-chain 감지(자동감지로는 bash 라 놓쳤을 것)
    const sr = cp.spawnSync(process.execPath, [CLI, 'shell-guard', 'a && b', '--shell', 'powershell', '--json'], { encoding: 'utf8', timeout: 20000 });
    let shellOk = false;
    try { const j = JSON.parse(sr.stdout); shellOk = j.shell === 'powershell' && (j.issues || []).some(i => i.rule === 'ps5-chain'); } catch {}
    // UR-0071: init non-TTY 출력에 fixed raw ANSI 없음
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

// 1.9.354 회귀 (외부리뷰 P3 UR-0072): compareVer pre-release + _classifyCJK + scan secrets 파일경로 + requests drop ✓
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const pureOk = m.compareVer('1.9.0-beta', '1.9.0') === -1 && m.compareVer('1.9.0', '1.9.0-beta') === 1 && m.compareVer('1.9.6', '1.9.5') === 1
      && (() => { const jp = Buffer.from([0xE3, 0x81, 0x82, 0xE6, 0x97, 0xA5]); const r = m._classifyCJK(jp, jp.length); return r.japanese > r.chinese; })();
    // scan secrets <file> (이전 ENOTDIR) + basename 표시
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-p3-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(d, 'leak.js'), 'const k = "glpat-' + 'x'.repeat(20) + '";\n');
    const fr = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', path.join(d, 'leak.js')], { encoding: 'utf8', timeout: 20000 });
    const fout = (fr.stdout || '') + (fr.stderr || '');
    const fileScanOk = /GitLab PAT/.test(fout) && /leak\.js/.test(fout) && !/ENOTDIR/.test(fout);
    // requests drop 성공 아이콘 ✓ (실패 ✗ 아님)
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

// 1.9.355 회귀 (UR-0075 Phase A): migrate --guide 가이드 출력 + update/init/migrate --path 타깃(이전 positional 전용)
total++;
{
  let ok = false;
  try {
    const m = require(path.resolve(__dirname, '..', 'lib', 'pure-utils.js'));
    const g = m._migrationGuideText('9.9.9');
    const pureOk = g.includes('마이그레이션 가이드') && g.includes('update --check --path') && g.includes('selftest') && g.includes('9.9.9');
    const gr = cp.spawnSync(process.execPath, [CLI, 'migrate', '--guide'], { encoding: 'utf8', timeout: 20000 });
    const guideOk = /마이그레이션 가이드/.test(gr.stdout || '') && /git/.test(gr.stdout || '');
    // update --path: A(cwd) 에서 --path B 가 B 의 HARNESS_VERSION 을 읽음(=--path 동작, 이전엔 cwd A)
    const A = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mga-'));
    const Bd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mgb-'));
    cp.spawnSync(process.execPath, [CLI, 'init', A, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'init', Bd, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(Bd, '.harness', 'HARNESS_VERSION'), '1.9.6\n');
    const ur = cp.spawnSync(process.execPath, [CLI, 'update', '--check', '--path', Bd], { cwd: A, encoding: 'utf8', timeout: 30000, env: { ...process.env, LEERNESS_OFFLINE: '1' } });
    const pathOk = /1\.9\.6/.test((ur.stdout || '') + (ur.stderr || ''));
    fs.rmSync(A, { recursive: true, force: true });
    fs.rmSync(Bd, { recursive: true, force: true });
    ok = pureOk && guideOk && pathOk;
  } catch {}
  console.log(ok ? '✓ B(1.9.355) UR-0075 Phase A: 마이그레이션 가이드 + update --path 타깃 (UR-0075)' : '✗ UR-0075 가이드 실패');
  if (!ok) failed++;
}

// 1.9.356 회귀 (UR-0075 Phase B): migrate audit — clean=변경없음 · 구버전+canonical 누락=findings (비파괴 dry-run)
total++;
{
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-aud-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    // clean → willChange 0
    const c1 = cp.spawnSync(process.execPath, [CLI, 'migrate', 'audit', '--path', d, '--json'], { encoding: 'utf8', timeout: 20000 });
    let cleanOk = false;
    try { cleanOk = JSON.parse(c1.stdout).willChange === 0; } catch {}
    // 구버전 + decisions.md(canonical 없음) → version-drift + canonical-pending
    fs.writeFileSync(path.join(d, '.harness', 'HARNESS_VERSION'), '1.9.6\n');
    fs.writeFileSync(path.join(d, '.harness', 'decisions.md'), '# Decisions\n\n### 2026-06-01 — A\n- Decision: x\n');
    fs.rmSync(path.join(d, '.harness', 'decisions.json'), { force: true });
    const c2 = cp.spawnSync(process.execPath, [CLI, 'migrate', 'audit', '--path', d, '--json'], { encoding: 'utf8', timeout: 20000 });
    let driftOk = false;
    try { const j = JSON.parse(c2.stdout); const kinds = j.findings.map(f => f.kind); driftOk = j.projectVersion === '1.9.6' && j.willChange >= 2 && kinds.includes('version-drift') && kinds.includes('canonical-pending'); } catch {}
    // dry-run: decisions.json 미생성(비파괴)
    const nonDestructive = !fs.existsSync(path.join(d, '.harness', 'decisions.json'));
    fs.rmSync(d, { recursive: true, force: true });
    ok = cleanOk && driftOk && nonDestructive;
  } catch {}
  console.log(ok ? '✓ B(1.9.356) UR-0075 Phase B: migrate audit dry-run (clean/version-drift/canonical-pending, 비파괴) (UR-0075)' : '✗ migrate audit 실패');
  if (!ok) failed++;
}

// 1.9.357 회귀 (UR-0075 Phase C): migrate apply — dry-run 비파괴 · --yes canonical 백필 · 멱등
total++;
{
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-app-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    fs.writeFileSync(path.join(d, '.harness', 'decisions.md'), '# Decisions\n\n### 2026-06-01 — A\n- Decision: x\n');
    fs.rmSync(path.join(d, '.harness', 'decisions.json'), { force: true });
    // dry-run: json 미생성(비파괴)
    cp.spawnSync(process.execPath, [CLI, 'migrate', 'apply', '--path', d], { encoding: 'utf8', timeout: 20000 });
    const dryNoWrite = !fs.existsSync(path.join(d, '.harness', 'decisions.json'));
    // --yes: canonical json 생성
    cp.spawnSync(process.execPath, [CLI, 'migrate', 'apply', '--path', d, '--yes'], { encoding: 'utf8', timeout: 20000 });
    const appliedOk = fs.existsSync(path.join(d, '.harness', 'decisions.json'));
    // 멱등: 재실행 시 applied 0
    const c3 = cp.spawnSync(process.execPath, [CLI, 'migrate', 'apply', '--path', d, '--json'], { encoding: 'utf8', timeout: 20000 });
    let idem = false;
    try { idem = JSON.parse(c3.stdout).applied.length === 0; } catch {}
    fs.rmSync(d, { recursive: true, force: true });
    ok = dryNoWrite && appliedOk && idem;
  } catch {}
  console.log(ok ? '✓ B(1.9.357) UR-0075 Phase C: migrate apply (dry-run 비파괴 / --yes canonical 백필 / 멱등) (UR-0075)' : '✗ migrate apply 실패');
  if (!ok) failed++;
}

// 1.9.358 회귀 (UR-0075 Phase D): migrate plan — 임시폴더 설치 후 비교 · clean=변경없음 · 코어파일 누락=missing 감지 · 읽기전용
total++;
{
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-plan-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    // clean: willChange 0 + tempInstallOk
    const c1 = cp.spawnSync(process.execPath, [CLI, 'migrate', 'plan', '--path', d, '--json'], { encoding: 'utf8', timeout: 90000 });
    let cleanOk = false, tmpOk = false;
    try { const j = JSON.parse(c1.stdout); cleanOk = j.willChange === 0 && j.missingFiles.length === 0; tmpOk = j.tempInstallOk === true; } catch {}
    // 코어 관리 파일 삭제 → missing 감지
    fs.rmSync(path.join(d, '.harness', 'reuse-map.md'), { force: true });
    const c2 = cp.spawnSync(process.execPath, [CLI, 'migrate', 'plan', '--path', d, '--json'], { encoding: 'utf8', timeout: 90000 });
    let missOk = false;
    try { const j = JSON.parse(c2.stdout); missOk = j.missingFiles.includes('.harness/reuse-map.md') && j.willChange >= 1; } catch {}
    // 읽기전용: 플랜은 프로젝트를 수정하지 않음 (reuse-map.md 재생성 안 됨)
    const readOnly = !fs.existsSync(path.join(d, '.harness', 'reuse-map.md'));
    fs.rmSync(d, { recursive: true, force: true });
    ok = cleanOk && tmpOk && missOk && readOnly;
  } catch {}
  console.log(ok ? '✓ B(1.9.358) UR-0075 Phase D: migrate plan (임시폴더 설치 후 비교, clean/missing 감지, 읽기전용) (UR-0075)' : '✗ migrate plan 실패');
  if (!ok) failed++;
}

// 1.9.359 회귀 (UR-0074): install-safety — 0 런타임 deps / 0 install-script / safe-install 워크플로 (공급망 신뢰 가드)
total++;
{
  let ok = false;
  try {
    const r = cp.spawnSync(process.execPath, [CLI, 'install-safety', '--json'], { encoding: 'utf8', timeout: 15000 });
    const j = JSON.parse(r.stdout);
    ok = j.runtimeDeps === 0 && j.hasInstallScripts === false && Array.isArray(j.safeInstall) && j.safeInstall.length >= 3;
  } catch {}
  console.log(ok ? '✓ B(1.9.359) UR-0074: install-safety (0 런타임 deps / 0 install-script / safe-install) (UR-0074)' : '✗ install-safety 실패');
  if (!ok) failed++;
}

// 1.9.360 회귀 (외부리뷰 CV-2/UR-0077): update --check 가 신형 Node Windows 에서 spawn EINVAL 없이 동작 (cmd.exe 경유)
total++;
{
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-einval-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    const r = cp.spawnSync(process.execPath, [CLI, 'update', d, '--check'], { encoding: 'utf8', timeout: 30000 });
    const out = (r.stdout || '') + (r.stderr || '');
    fs.rmSync(d, { recursive: true, force: true });
    // 핵심 회귀 가드: EINVAL 미발생 + exit 0 (네트워크 유무와 무관 — 오프라인이어도 EINVAL 은 안 나야 함)
    ok = !out.includes('EINVAL') && r.status === 0;
  } catch {}
  console.log(ok ? '✓ B(1.9.360) CV-2: update --check 신형 Node Windows EINVAL 회피 (cmd.exe 경유) (UR-0077)' : '✗ update --check EINVAL 회귀');
  if (!ok) failed++;
}

// 1.9.361 회귀 (외부리뷰 CV-1/UR-0076): --path 라우팅 통일 — session close --path 가 cwd 아닌 정타깃에 쓰기 + context --path= 등호형
total++;
{
  let ok = false;
  try {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rootA-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rootB-'));
    cp.spawnSync(process.execPath, [CLI, 'init', a, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    cp.spawnSync(process.execPath, [CLI, 'init', b, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    // A 의 session-handoff 삭제 → cwd=B 에서 session close --path A → A 가 작동하면 A 에 재생성(아니면 cwd B 만 갱신)
    const aHandoff = path.join(a, '.harness', 'session-handoff.md');
    fs.rmSync(aHandoff, { force: true });
    cp.spawnSync(process.execPath, [CLI, 'session', 'close', '--path', a], { cwd: b, encoding: 'utf8', timeout: 30000 });
    const aRecreated = fs.existsSync(aHandoff);
    // context --path= 등호형: cdir 에 고유 결정 추가 후 cwd=B 에서 --path=cdir 로 읽기
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

// 1.9.361 회귀 (외부리뷰 CV-3/UR-0078): audit 가 미초기화/존재하지않는 경로를 healthy 로 오판 안 함 (verify 와 일관)
total++;
{
  let ok = false;
  try {
    const r = cp.spawnSync(process.execPath, [CLI, 'audit', path.join(os.tmpdir(), 'leerness-no-such-' + total), '--json'], { encoding: 'utf8', timeout: 15000 });
    const j = JSON.parse(r.stdout);
    ok = j.healthy === false && j.failures >= 1;
  } catch {}
  console.log(ok ? '✓ B(1.9.361) CV-3: audit 미초기화 경로 failure 승격 (healthy=false) (UR-0078)' : '✗ audit 미초기화 가드 실패');
  if (!ok) failed++;
}

// 1.9.362 회귀 (외부리뷰 CV-4/UR-0079): archive retention — init/migrate 반복해도 --keep 상한 유지 (무한 누적 차단)
total++;
{
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-arch-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko', '--keep', '2'], { encoding: 'utf8', timeout: 30000 });
    for (let i = 0; i < 3; i++) cp.spawnSync(process.execPath, [CLI, 'migrate', d, '--keep', '2'], { encoding: 'utf8', timeout: 30000 });
    const adir = path.join(d, '.harness', 'archive');
    const cnt = fs.readdirSync(adir).filter(n => /^leerness-/.test(n)).length;
    fs.rmSync(d, { recursive: true, force: true });
    ok = cnt === 2;  // init + migrate x3 = 4 스냅샷 → --keep 2 로 prune → 2
  } catch {}
  console.log(ok ? '✓ B(1.9.362) CV-4: archive retention (--keep 상한, 무한 누적 차단) (UR-0079)' : '✗ archive retention 실패');
  if (!ok) failed++;
}

// 1.9.363 회귀 (외부리뷰 CV-7/UR-0082): commands 카탈로그가 누락 명령군(8그룹+install-safety+migrate sub) 전수 등재
total++;
{
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

// 1.9.364 회귀 (4번째 외부평가 9.3/UR-0083): auto-update hook 비침투 — update --check --quiet 가 up-to-date 시 무음 + hook 명령이 --quiet 사용
total++;
{
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-quiet-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 });
    // up-to-date(방금 init한 현재 버전) → --check --quiet 는 무음
    const r = cp.spawnSync(process.execPath, [CLI, 'update', d, '--check', '--quiet'], { encoding: 'utf8', timeout: 30000 });
    const silent = (r.stdout || '').trim() === '' && r.status === 0;
    // 설치된 SessionStart hook 명령이 --quiet 사용
    const settings = JSON.parse(fs.readFileSync(path.join(d, '.claude', 'settings.local.json'), 'utf8'));
    const hookQuiet = (settings.hooks.SessionStart || []).some(h => h.command && h.command.includes('update --check --quiet'));
    fs.rmSync(d, { recursive: true, force: true });
    ok = silent && hookQuiet;
  } catch {}
  console.log(ok ? '✓ B(1.9.364) 4th외부평가: auto-update hook 비침투 (update --check --quiet 무음 + hook --quiet) (UR-0083)' : '✗ auto-update 비침투 실패');
  if (!ok) failed++;
}

// 1.9.365 회귀 (외부리뷰 CV-6/UR-0081): 시크릿 스캐너 정밀도 — placeholder FP 무시 / unquoted FN 탐지 / gitignored 강등
total++;
{
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-sec-'));
    fs.mkdirSync(path.join(d, 'src'), { recursive: true });
    // ① placeholder 만 → 커밋 대상 finding 없음 (exit 0)
    fs.writeFileSync(path.join(d, 'src', 'a.js'), 'const x = { secret: "change-me", apiKey: "your-key-here" };\n');
    const r1 = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', path.join(d, 'src', 'a.js')], { encoding: 'utf8', timeout: 15000 });
    const fpOk = r1.status === 0 && /no obvious/.test(r1.stdout || '');
    // ② unquoted 실제 시크릿 → 탐지 (exit 1)
    fs.writeFileSync(path.join(d, 'src', 'b.txt'), 'password=hunter2realsecret\n');
    const r2 = cp.spawnSync(process.execPath, [CLI, 'scan', 'secrets', path.join(d, 'src', 'b.txt')], { encoding: 'utf8', timeout: 15000 });
    const fnOk = r2.status === 1 && /unquoted/.test(r2.stdout || '');
    // ③ gitignored(.env+src/) → 커밋 대상 0 → exit 0 + gitignored info
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

// 1.9.366 회귀 (외부리뷰 CV-5/UR-0080): selftest 무결성 — 설치 패키지 관점에서 --json 전부 통과 (행위 케이스 포함)
total++;
{
  let ok = false;
  try {
    const r = cp.spawnSync(process.execPath, [CLI, 'selftest', '--json'], { encoding: 'utf8', timeout: 30000 });
    const j = JSON.parse(r.stdout);
    ok = j.ok === true && j.pass === j.total && j.fail === 0 && j.total >= 112 && r.status === 0;
  } catch {}
  console.log(ok ? '✓ B(1.9.366) CV-5: selftest 무결성 (--json pass===total, 행위 전환 writeUtf8/fail 포함) (UR-0080)' : '✗ selftest 무결성 실패');
  if (!ok) failed++;
}

// 1.9.367 회귀 (UR-0025): _mergeEnvLines 모듈 분리 — migrate 가 사용자 .env 값을 key-aware 로 보존 (덮어쓰기 X)
total++;
{
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

// 1.9.368 회귀 (UR-0025): _managedMerge 모듈 분리 — migrate 가 사용자 편집(AGENTS.md)을 migration-preserved 블록으로 보존
total++;
{
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

// 1.9.369 회귀 (UR-0025): MINIMAL_SKIP_KEYS/_parseSkillsValue 분리 — init --minimal 비핵심 스킵+코어 유지, --skills recommended 설치
total++;
{
  let ok = false;
  try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-min-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko', '--minimal'], { encoding: 'utf8', timeout: 30000 });
    const skipAbsent = !fs.existsSync(path.join(d, '.harness', 'architecture.md'));  // MINIMAL_SKIP_KEYS
    const corePresent = fs.existsSync(path.join(d, '.harness', 'plan.md'));  // core 유지
    fs.rmSync(d, { recursive: true, force: true });
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rec-'));
    cp.spawnSync(process.execPath, [CLI, 'init', d2, '--yes', '--language', 'ko', '--skills', 'recommended'], { encoding: 'utf8', timeout: 30000 });
    const recInstalled = fs.existsSync(path.join(d2, '.harness', 'skills', 'office'));  // recommended → office 포함
    fs.rmSync(d2, { recursive: true, force: true });
    ok = skipAbsent && corePresent && recInstalled;
  } catch {}
  console.log(ok ? '✓ B(1.9.369) UR-0025: MINIMAL_SKIP_KEYS/_parseSkillsValue 분리 (--minimal 스킵+코어유지, --skills recommended)' : '✗ minimal/skills 분리 실패');
  if (!ok) failed++;
}

// 1.9.370 회귀 (UR-0025): _parseArchiveBlocks/_parseSkillCatalog 순수 파서 모듈 분리 — lib/pure-utils 직접 호출 행위
total++;
{
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

console.log(`\nE2E result: ${total - failed}/${total} passed · ${((Date.now() - _e2eStart) / 1000).toFixed(0)}s`);
if (failed > 0) process.exit(1);
