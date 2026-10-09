'use strict';
// T-0317: English handoff output carries no Korean-only tool text. An English project on Korean Windows saw the
// terminal-encoding notice, skill suggestions, the official-skill cache note, next-step suggestions and the compact
// "다음:" line in Korean. Every line the tool writes on the handoff paths now goes through a language helper whose
// first argument is the unchanged Korean text. Document bodies and user data are shown as stored, so the checks
// ignore lines that appear verbatim in the project's documents.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const HANGUL = /\p{Script=Hangul}/u;

// ---- static guard: Korean string literals on the handoff paths must be the Korean argument of a language helper
const HELPERS = new Set(['_ht', 't', '_t', '_bt']);
const FUNCTIONS = ['handoff', 'handoffCmd', '_handoffWorkspace', 'hookSessionStartCmd', 'pulseCmd', '_emitHandoffVersionSkew',
  '_suggestNextActions', '_detectAbnormalShutdown', '_sessionSignalFlags', '_sessionSignal'];
// Persisted file content outside this surface: the drift reminder body is written to .leerness/agent-reminders.md,
// and the headline label is pinned by a selftest source check in its original ternary form.
const ALLOWED = ['`# 메인 에이전트용 자동 reminder', "'헤드라인 (1.9.81/93/113/152/162/192/197/204/207/209/215/220/223/226)'"];
// Literals are [start, end, expressionSpans]; a template's ${ } code is not literal text.
function lexLiterals(src) {
  const lits = [], masks = []; let i = 0, last = '';
  const str = q => { const s = i; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; lits.push([s, i, []]); last = 'str'; };
  const tpl = () => {
    const s = i, exprs = []; i++;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { const es = i; i += 2; let d = 1; while (i < src.length && d) { if (src[i] === '}') { d--; i++; } else if (src[i] === '{') { d++; i++; } else step(true); } exprs.push([es + 2, i - 1]); continue; }
      i++;
    }
    i++; lits.push([s, i, exprs]); last = 'str';
  };
  function step(inner) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const s = i; while (i < src.length && src[i] !== '\n') i++; masks.push([s, i]); return; }
    if (c === '/' && src[i + 1] === '*') { const s = i, e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; masks.push([s, i]); return; }
    if (c === "'" || c === '"') return str(c);
    if (c === '`') return tpl();
    if (inner && (c === '}' || c === '{')) return;
    if (c === '/' && (/[(,=:[!&|?{};+\-*%<>~^]$/.test(last) || last === '' || last === 'return' || last === 'typeof')) {
      const s = i; i++; let cls = false;
      while (i < src.length) { const d = src[i]; if (d === '\\') { i += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; else if (d === '\n') break; i++; }
      i++; while (/[a-z]/i.test(src[i] || '')) i++; masks.push([s, i]); last = 'regex'; return;
    }
    if (/\s/.test(c)) { i++; return; }
    if (/[A-Za-z_$0-9]/.test(c)) { const s = i; while (/[A-Za-z_$0-9]/.test(src[i] || '')) i++; last = src.slice(s, i); return; }
    last = c; i++;
  }
  while (i < src.length) step(false);
  return { lits, masks };
}
// Returns the Korean literals that are neither a helper's first argument nor inside one, nor allow-listed.
function unlocalizedKorean(src, ranges) {
  const { lits, masks } = lexLiterals(src);
  const inExpr = (exprs, k) => exprs.some(([a, b]) => k >= a && k < b);
  // Blank literal text and comments/regexes; keep ${ } code so helper calls inside a template stay visible.
  const chars = src.split('');
  for (const [s, e, exprs = []] of [...lits, ...masks]) for (let k = s; k < e; k++) if (chars[k] !== '\n' && !inExpr(exprs, k)) chars[k] = ' ';
  const masked = chars.join('');
  const textOf = ([s, e, exprs]) => src.slice(s, e).split('').filter((_, k) => !inExpr(exprs, s + k)).join('');
  const inRange = p => ranges.some(([a, b]) => p >= a && p < b);
  const firstArgOfHelper = s => {
    let depth = 0;
    for (let k = s - 1; k >= 0; k--) {
      const c = masked[k];
      if (c === ')' || c === ']' || c === '}') depth++;
      else if (c === '(' || c === '[' || c === '{') {
        if (depth) { depth--; continue; }
        if (c !== '(') return false;
        const name = (masked.slice(Math.max(0, k - 40), k).match(/([A-Za-z_$][\w$]*)\s*$/) || [])[1];
        return HELPERS.has(name);
      } else if (c === ',' && !depth) return false;
    }
    return false;
  };
  // A helper's Korean argument covers everything inside it, including nested literals; so does an allow-listed literal.
  const ok = lits.filter(([s]) => firstArgOfHelper(s) || ALLOWED.some(a => src.startsWith(a, s)));
  return lits.filter(l => inRange(l[0]) && HANGUL.test(textOf(l)) && !ok.some(([s2, e2]) => l[0] >= s2 && l[1] <= e2))
    .map(([s, e]) => ({ line: src.slice(0, s).split('\n').length, text: src.slice(s, Math.min(e, s + 90)) }));
}
function functionRanges(src, names) {
  return names.map(name => {
    const m = new RegExp(`^(?:async )?function ${name.replace(/\$/g, '\\$')}\\(`, 'm').exec(src);
    assert.ok(m, 'function not found: ' + name);
    const end = src.indexOf('\n}\n', m.index);
    assert.ok(end > m.index, 'function end not found: ' + name);
    return [m.index, end + 2];
  });
}

// ---- runtime fixtures
function main() {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-handoff-i18n-'));
  const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
    LEERNESS_NO_AUTOCHCP: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1' };
  for (const key of ['LEERNESS_LANG', 'LEERNESS_SESSION_ID', 'LEERNESS_WORKSPACE_DIR', 'LEERNESS_NO_SKILL_SUGGEST', 'LEERNESS_NO_NEXT_ACTIONS']) delete env[key];
  for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) { env[key] = path.join(arena, 'env-' + key.toLowerCase()); fs.mkdirSync(env[key]); }
  let seq = 0, passed = 0, failed = 0;
  const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
  const test = (name, fn) => { if (filter && !name.includes(filter)) return; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };
  const run = (dir, args, extra = {}, pre) => cp.spawnSync(process.execPath, [...(pre ? ['--require', pre] : []), CLI, ...args],
    { cwd: dir, encoding: 'utf8', timeout: 300000, windowsHide: true, env: { ...env, ...extra } });
  const must = (r, label) => { assert.ifError(r.error); assert.strictEqual(r.status, 0, label + ' exit ' + r.status + '\n' + r.stdout + r.stderr); return String(r.stdout || '') + String(r.stderr || ''); };
  const git = (dir, args) => { const r = cp.spawnSync('git', ['-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', timeout: 60000, windowsHide: true }); assert.strictEqual(r.status, 0, 'git ' + args.join(' ') + ': ' + r.stderr); };
  const project = (lang, mode = 'standard') => {
    const dir = path.join(arena, (++seq) + '-' + lang + '-' + mode); fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"proj","version":"0.1.0"}\n');
    must(run(dir, ['init', dir, '--yes', '--language', lang, '--no-setup-agents', '--no-mcp', ...(mode === 'minimal' ? ['--mode', 'minimal'] : [])], { LEERNESS_LANG: lang }), 'init');
    return dir;
  };
  // Lines copied from the project's documents are data; so is the text a fixture wrote itself.
  const docLines = dir => {
    const set = new Set();
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!['cache', 'archive'].includes(e.name)) walk(p); } else if (/\.(md|json)$/.test(e.name)) for (const l of fs.readFileSync(p, 'utf8').split(/\r?\n/)) if (l.trim()) set.add(l.trim()); } };
    walk(path.join(dir, '.leerness'));
    return set;
  };
  const koreanLines = (out, dir) => { const data = docLines(dir); return String(out).split(/\r?\n/).filter(l => HANGUL.test(l) && !data.has(l.trim())); };
  const jsonKorean = out => { const j = JSON.parse(out); delete j.files; const hits = []; JSON.stringify(j, (k, v) => { if (typeof v === 'string' && HANGUL.test(v)) hits.push(k + ': ' + v.slice(0, 80)); return v; }); return hits; };
  const handoff = (dir, lang, args = [], pre) => must(run(dir, ['handoff', dir, '--no-record', ...args], { LEERNESS_LANG: lang }, pre), 'handoff ' + args.join(' '));

  test('static guard: every Korean literal on the handoff paths is the Korean argument of a language helper', () => {
    const src = fs.readFileSync(CLI, 'utf8');
    const bad = unlocalizedKorean(src, functionRanges(src, FUNCTIONS));
    assert.deepStrictEqual(bad, [], bad.map(b => `${b.line}: ${b.text}`).join('\n'));
    // Control: the guard sees a bare Korean literal, a Korean second argument and a bare Korean literal inside a
    // template expression; it accepts a helper call nested in a template, and ignores comments and regexes.
    const sample = "function handoff(root) {\n  log(`세션 ${x}`);\n  log(_ht(`세션 ${x}`, `session ${x}`));\n  log(_ht('en first', '한국어'));\n"
      + "  log(`a ${y ? '가' : 'b'}`);\n  log(`n ${t('회', 'x')}`);\n  // 주석 한글\n  const r = /[가-힣]+/;\n}\n";
    const found = unlocalizedKorean(sample, functionRanges(sample, ['handoff'])).map(b => b.line);
    assert.deepStrictEqual(found, [2, 4, 5], JSON.stringify(found));
  });

  test('fresh English projects: handoff, compact, pulse, JSON and the session-start hook carry no Korean', () => {
    for (const mode of ['standard', 'minimal']) {
      const dir = project('en', mode);
      must(run(dir, ['task', 'add', 'Organize the parser module', '--status', 'in-progress', '--path', dir], { LEERNESS_LANG: 'en' }), 'task add');
      must(run(dir, ['rule', 'add', 'Run the tests before each commit', '--trigger', 'every-commit', '--path', dir], { LEERNESS_LANG: 'en' }), 'rule add');
      for (const args of [[], ['--compact'], ['--pulse']]) {
        const out = handoff(dir, 'en', args);
        assert.deepStrictEqual(koreanLines(out, dir), [], mode + ' ' + args.join(' ') + '\n' + out);
      }
      assert.deepStrictEqual(jsonKorean(must(run(dir, ['handoff', dir, '--json', '--no-record'], { LEERNESS_LANG: 'en' }), 'json')), [], mode + ' --json');
      const hook = must(run(dir, ['hook', 'session-start', dir], { LEERNESS_LANG: 'en' }), 'hook');
      assert.deepStrictEqual(koreanLines(JSON.parse(hook).hookSpecificOutput.additionalContext, dir), [], mode + ' hook');
      assert.match(JSON.parse(hook).hookSpecificOutput.additionalContext, /^Next: T-\d+ \[in-progress\]/m);
      const full = handoff(dir, 'en');
      assert.match(full, /## Skills matching the current task — keyword "organize"/);
      assert.match(full, /Use when the user asks for a visual roadmap\./);
      assert.match(full, /## Suggested next steps — keyword "organize"/);
      assert.match(full, /check plan\.md milestone M-0001 — related to "organize"/);
      assert.match(full, /## ⚡ Active User Rules \(shown every session until the user explicitly pauses or removes them\)/);
      assert.match(full, /no official skill catalog cache/);
      assert.match(handoff(dir, 'en', ['--compact']), /^Next: T-\d+ \[in-progress\]/m);
    }
    // Short session flags (compact and hook) follow the project language too; an invalid explicit key raises one.
    const dir = project('en', 'minimal'), bad = { LEERNESS_LANG: 'en', LEERNESS_SESSION_ID: 'bad key!' };
    const compact = must(run(dir, ['handoff', dir, '--no-record', '--compact'], bad), 'compact flags');
    const hook = JSON.parse(must(run(dir, ['hook', 'session-start', dir], bad), 'hook flags')).hookSpecificOutput.additionalContext;
    for (const out of [compact, hook]) {
      assert.match(out, /⚠ LEERNESS_SESSION_ID invalid \("bad key!"\) — ignored/, out);
      assert.deepStrictEqual(koreanLines(out, dir), [], out);
    }
    assert.match(must(run(dir, ['handoff', dir, '--no-record', '--compact'], { ...bad, LEERNESS_LANG: 'ko' }), 'compact ko'), /LEERNESS_SESSION_ID 형식 오류\("bad key!"\) — 무시됨/);
  });

  // One project that raises most conditional sections at once. Fixture text is English data.
  const kitchenSink = lang => {
    const dir = project(lang);
    const L = { LEERNESS_LANG: lang };
    git(dir, ['init', '-q', '-b', 'main']); git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', 'init']);
    for (let n = 0; n <= 50; n++) git(dir, ['branch', `release/1.0.${n}`]);
    must(run(dir, ['task', 'add', 'Organize the parser module', '--status', 'in-progress', '--path', dir], L), 'task add');
    must(run(dir, ['rule', 'add', 'Run the tests before each commit', '--trigger', 'every-commit', '--path', dir], L), 'rule add');
    must(run(dir, ['decision', 'add', 'Organize parser rollback after a failed release', '--reason', 'the first attempt failed', '--path', dir], L), 'decision add');
    must(run(dir, ['feature', 'add', 'Organize parser', '--path', dir], L), 'feature add');
    const lp = path.join(dir, '.leerness');
    const now = Date.now(), iso = ms => new Date(ms).toISOString(), today = iso(now).slice(0, 10);
    fs.appendFileSync(path.join(lp, 'lessons.md'), '\n### 2026-07-01 — Organize parser lesson\n- Lesson: keep parser changes small\n\n'
      + '### 2026-07-02 multi-agent consensus — best=codex (1.9.193)\n- task: Organize the parser module\n- best agent: codex, score=0.812\n');
    fs.writeFileSync(path.join(lp, 'skill-suggestions.md'), '# Skill suggestions\n\n## 2026-09-29 10:00:00 — query "organize parser"\n- [0.50] project-roadmap-generator\n');
    fs.writeFileSync(path.join(lp, 'skill-auto-cache.json'), JSON.stringify({ at: iso(now), presets: ['anthropics'],
      entries: [{ name: 'organize-helper', description: 'Organize project files', preset: 'anthropics', source: 'anthropics' }] }));
    fs.writeFileSync(path.join(lp, 'pre-wake-report.json'), JSON.stringify({ reports: [{ auditedAt: iso(now - 10 * 60000), auditVersion: '0',
      summary: { criticalCount: 1, warningCount: 1 }, findings: { critical: [{ kind: 'missing-user-requests', detail: 'one request is unmatched' }],
        warning: [{ kind: 'stale-progress', detail: 'progress is stale' }], info: [] } }] }));
    fs.writeFileSync(path.join(lp, 'active-wakeups.json'), JSON.stringify({ wakeups: [{ expectedFireAt: iso(now - 60 * 60000),
      registeredAt: iso(now - 90 * 60000), intervalMin: 25, source: 'probe', status: 'pending' }] }));
    fs.writeFileSync(path.join(lp, 'auto-resume-plan.json'), JSON.stringify({ savedAt: iso(now - 30 * 60000), expectedFireAt: iso(now - 20 * 60000),
      focus: 'parser', nextRoundVersion: '0.1.1', nextActions: [{ actionKey: 'probe:parser', title: 'check the parser', command: 'leerness task list --path .' }] }));
    fs.writeFileSync(path.join(lp, 'user-requests.json'), JSON.stringify({ requests: [{ id: 'UR-0001', text: 'Round 0.1.0 implemented the parser', status: 'open', recordedAt: iso(now) }] }));
    fs.mkdirSync(path.join(lp, 'api-skills'));
    fs.writeFileSync(path.join(lp, 'api-skills', 'parser-api.md'), '---\nid: parser-api\nname: Parser API\ndirection: "organize the parser"\ncaptured_at: 2026-09-30\nurls:\n  - https://example.com/parser\n---\nbody\n');
    fs.writeFileSync(path.join(lp, 'decisions.archive.md'), `# Decisions archive\n\n## 제거 ${today} (target: "old")\n### 2026-09-01 — old decision\n- Decision: x\n`);
    fs.writeFileSync(path.join(lp, 'migration-report.md'), '# Migration report\n\n## 🤖 AI must re-read\n- use the new tools\n\n## Details\n- none\n');
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.writeFileSync(path.join(dir, 'scripts', 'run.ps1'), 'Write-Host "café"\n');
    const old = new Date(now - 8 * 24 * 3600 * 1000);
    fs.utimesSync(path.join(lp, 'progress-tracker.md'), old, old);
    return dir;
  };
  const SECTIONS = [
    ['## ⚡ Active User Rules (shown every session', '## ⚡ Active User Rules (사용자가 명시 중지/제거 요청 전까지 매 세션 자동 노출)'],
    ['## Pre-wake audit before the last sleep (', '## 직전 sleep pre-wake-audit (1.9.209,'],
    ['Abnormal shutdown detected (severity: high)', '비정상 종료 감지 (1.9.220, severity: high)'],
    ['in-progress task(s), progress-tracker not updated for', '건 in-progress task, progress-tracker'],
    ['→ resume guide: leerness session-resume', '→ 재개 가이드: leerness session-resume'],
    ['## ⚠ Shell script encoding risk in 1 file(s) (UR-0014)', '## ⚠ 셸 스크립트 인코딩 위험 1건 (1.9.241, UR-0014)'],
    ['non-ASCII Windows shell script — BOM-less UTF-8 may be misread', 'Windows 비-ASCII 셸 스크립트 — BOM 없는 UTF-8'],
    ['## 1 related API skill(s) found (UR-0015)', '## 관련 API skill 1건 발견 (1.9.245, UR-0015)'],
    ['## 51 merged release/* branches (50+)', '## release/* branches 누적 51개 (50+)'],
    ['## User requests that can be auto-completed (1)', '## 사용자 요청 자동 완료 가능 (1.9.224, 1건)'],
    ['## Past lessons recalled — keyword "organize"', '## 과거 lessons 자동 재상기 (1.9.56) — 키워드 "organize"'],
    ['## Skills matching the current task — keyword "organize"', '## 현재 task와 매칭되는 skill 자동 추천 (1.9.67) — 키워드 "organize"'],
    ['## Earlier skill match history — keyword "organize"', '## 이전 skill match 이력 (1.9.69) — 키워드 "organize" 관련'],
    ['## Brainstorm hits — keyword "organize"', '## brainstorm 자동 hits (1.9.88) — 키워드 "organize"'],
    ['## Official organization skills matched — keyword "organize"', '## 공식 organization 스킬 자동 매칭 (1.9.192/193) — 키워드 "organize"'],
    ['## Suggested next steps — keyword "organize"', '## 다음 단계 자동 제안 (1.9.194 E축 — 게으름 방지) — 키워드 "organize"'],
    ['## ⚠ No progress detected — progress-tracker last changed', '## ⚠ 진척 정체 감지 (1.9.194 E축)'],
    ['stalled for 7+ days', '7일+ 장기 정체'],
    ['## Best agent for this task — keyword "organize"', '## task 매칭 best agent (1.9.198 B축) — 키워드 "organize"'],
    ['## Long-term lessons — ', '## 장기 lessons 회고 (1.9.196 D축)'],
    ['## ⏰ ScheduleWakeup missed — scheduled fire was', '## ⏰ ScheduleWakeup miss 확정 (1.9.205)'],
    ['## auto-resume-plan loaded — saved', '## auto-resume-plan 로드 (1.9.203)'],
    ['archived in the last 24h: D1', '최근 24h archive (1.9.129): D1'],
    ['h ago — AI agents should try the new tools first', '시간 전 migrate 차분 — AI 에이전트는 신규 도구 우선 시도'],
  ];
  const koSink = kitchenSink('ko'), enSink = kitchenSink('en');
  test('conditional sections render in English with no Korean, and in Korean unchanged', () => {
    const en = handoff(enSink, 'en'), ko = handoff(koSink, 'ko');
    const missingEn = SECTIONS.filter(([e]) => !en.includes(e)).map(([e]) => e);
    const missingKo = SECTIONS.filter(([, k]) => !ko.includes(k)).map(([, k]) => k);
    assert.deepStrictEqual(missingEn, [], 'English sections missing (fixture or render failure):\n' + en);
    assert.deepStrictEqual(missingKo, [], 'Korean sections missing:\n' + ko);
    assert.deepStrictEqual(koreanLines(en, enSink), [], en);
    assert.deepStrictEqual(jsonKorean(must(run(enSink, ['handoff', enSink, '--json', '--no-record'], { LEERNESS_LANG: 'en' }), 'json')), []);
    const koJson = JSON.parse(must(run(koSink, ['handoff', koSink, '--json', '--no-record'], { LEERNESS_LANG: 'ko' }), 'json ko'));
    assert.ok(koJson.abnormalShutdown.resumeGuide.includes('1. leerness handoff . — 현재 상태 종합 확인'), JSON.stringify(koJson.abnormalShutdown));
  });

  test('terminal encoding notice is English in English projects and unchanged in Korean ones', () => {
    let pre = null, extra = {};
    if (process.platform === 'win32') {
      pre = path.join(arena, 'fake-chcp.cjs');
      fs.writeFileSync(pre, "const cp = require('child_process'), path = require('path'); const orig = cp.spawnSync;\n"
        + "cp.spawnSync = function (file, args, opts) { if (/^chcp(\\.com)?$/i.test(path.basename(String(file)))) { const out = 'Active code page: 949'; const enc = opts && opts.encoding;"
        + " return { pid: 0, status: 0, signal: null, stdout: enc ? out : Buffer.from(out), stderr: enc ? '' : Buffer.alloc(0), output: [null, out, ''] }; } return orig.apply(this, arguments); };\n");
    } else extra = { LANG: 'C', LC_ALL: '', LC_CTYPE: '' };
    const dirEn = project('en', 'minimal'), dirKo = project('ko', 'minimal');
    const en = must(run(dirEn, ['handoff', dirEn, '--no-record'], { LEERNESS_LANG: 'en', ...extra }, pre), 'handoff en');
    const ko = must(run(dirKo, ['handoff', dirKo, '--no-record'], { LEERNESS_LANG: 'ko', ...extra }, pre), 'handoff ko');
    if (process.platform === 'win32') {
      assert.match(en, /## ⚠ Terminal encoding — Korean Windows \+ CP949 \(UR-0018\)/);
      assert.match(ko, /## ⚠ 터미널 인코딩 — 한국어 Windows \+ CP949 \(1\.9\.249, UR-0018\)/);
    } else {
      assert.match(en, /## ⚠ Terminal encoding — POSIX(?: \(WSL\))? locale has no UTF-8 \(UR-0018\)/);
      assert.match(ko, /## ⚠ 터미널 인코딩 — POSIX/);
    }
    assert.deepStrictEqual(koreanLines(en, dirEn), [], en);
  });

  test('workspace handoff, uninitialized directory, missing path and version skew are English in English mode', () => {
    const a = project('en'), b = project('en');
    const base = path.join(arena, 'workspace'); fs.mkdirSync(base);
    const plain = path.join(arena, 'plain-dir'); fs.mkdirSync(plain);
    const ignored = must(run(base, ['handoff', base, '--include', `${a},${plain}`], { LEERNESS_LANG: 'en' }), 'workspace ignored');
    assert.match(ignored, /Ignoring --include: .*\(no \.leerness directory\)/); assert.ok(!ignored.split(/\r?\n/).some(l => HANGUL.test(l)), ignored);
    for (const args of [['--include', `${a},${b}`], ['--include', `${a},${b}`, '--compact'], ['--include', `${a},${b}`, '--since', '24h']]) {
      const out = must(run(base, ['handoff', base, ...args], { LEERNESS_LANG: 'en' }), 'workspace ' + args.join(' '));
      assert.deepStrictEqual(out.split(/\r?\n/).filter(l => HANGUL.test(l)), [], out);
    }
    assert.match(must(run(base, ['handoff', base, '--include', `${a},${b}`], { LEERNESS_LANG: 'en' }), 'ws'), /## 📊 Workspace totals/);
    assert.match(must(run(base, ['handoff', base, '--include', `${a},${b}`], { LEERNESS_LANG: 'ko' }), 'ws ko'), /## 📊 워크스페이스 총합/);
    const bare = path.join(arena, 'bare'); fs.mkdirSync(bare);
    const u = must(run(bare, ['handoff', bare, '--no-record'], { LEERNESS_LANG: 'en' }), 'uninitialized');
    assert.match(u, /leerness is not initialized in this directory/); assert.match(u, /--yes --language en/);
    assert.ok(!u.split(/\r?\n/).some(l => HANGUL.test(l)), u);
    const uk = must(run(bare, ['handoff', bare, '--no-record'], { LEERNESS_LANG: 'ko' }), 'uninitialized ko');
    assert.match(uk, /leerness init 미실행 디렉토리/); assert.match(uk, /--yes --language ko/);
    const missing = run(arena, ['handoff', path.join(arena, 'nope'), '--json'], { LEERNESS_LANG: 'en' });
    assert.notStrictEqual(missing.status, 0); assert.match(missing.stdout + missing.stderr, /path not found or not a directory/);
    fs.writeFileSync(path.join(a, '.leerness', 'HARNESS_VERSION'), '9.9.9\n');
    const skew = handoff(a, 'en', ['--compact']);
    assert.match(skew, /version mismatch: CLI v[\d.]+ < project harness v9\.9\.9/); assert.ok(!skew.split(/\r?\n/).some(l => HANGUL.test(l)), skew);
  });

  console.log(`Tests: ${passed}/${passed + failed} passed`);
  try { removeTree(arena, { recursive: true, force: true }); } catch {}
  process.exitCode = failed ? 1 : 0;
}
if (require.main === module) main();
module.exports = { unlocalizedKorean, functionRanges };
