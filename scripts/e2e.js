#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'harness.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-e2e-'));
let failed = 0; let total = 0;

function run(label, args, opts = {}) {
  total++;
  const r = cp.spawnSync(process.execPath, [CLI, ...args], { cwd: opts.cwd || tmp, encoding: 'utf8' });
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

run('viewwork install',    ['viewwork', 'install', tmp]);
run('viewwork emit',       ['viewwork', 'emit', tmp, '--action', 'note', '--note', 'e2e ping']);
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
