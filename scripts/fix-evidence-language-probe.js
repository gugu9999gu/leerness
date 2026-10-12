'use strict';
// T-0333: `task fix-evidence` speaks the project's language. It printed Korean everywhere: in an English project the
// header, the guidance, the per-row lines, the suggested evidence and the results of `--set` and of an empty list were
// Korean. English projects now get English; Korean output stays byte for byte (every expected line below is the text
// the command printed before). The language is chosen as for other commands (`--language`, LEERNESS_LANG, then the
// project's manifest). Rows are made through the product. Every test works on its own copy of an initialized seed.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
// A filter must name something: a missing value or one that selects no test is a failure, not "0/0 passed".
// Checked before any temporary folder exists, so this exit leaves nothing behind.
if (process.argv.includes('--match') && !filter) { console.error('--match needs a test name substring'); process.exit(1); }
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-fix-evidence-language-'));
const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
  LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_BANNER: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_SKILL_HISTORY: '1' };
for (const key of ['LEERNESS_LANG', 'LEERNESS_OLLAMA_BASE_URL', 'LEERNESS_ENFORCE_POLICY']) delete env[key];
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) { env[key] = path.join(arena, 'env-' + key.toLowerCase()); fs.mkdirSync(env[key]); }
let passed = 0, failed = 0, ran = 0;
const test = (name, fn) => { if (filter && !name.includes(filter)) return; ran++; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };

const HANGUL = /\p{Script=Hangul}/u;
const seeds = {};
const seed = lang => {
  if (seeds[lang]) return seeds[lang];
  const dir = path.join(arena, 'seed-' + lang);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"proj","version":"0.1.0"}\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'init', dir, '--yes', '--language', lang, '--no-mcp'], { cwd: dir, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
  assert.strictEqual(r.status, 0, 'init ' + lang + ' exit ' + r.status + '\n' + r.stdout + r.stderr);
  return (seeds[lang] = dir);
};
let copies = 0;
const fresh = lang => { const dir = path.join(arena, 'p' + (++copies)); require('../lib/copy-tree').copyTreeSync(seed(lang), dir); return dir; };
const runIn = (cwd, args, extraEnv = {}) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 300000, windowsHide: true, env: { ...env, ...extraEnv } });
const show = r => `exit ${r.status}\n${String(r.stdout || '').slice(0, 1500)}${String(r.stderr || '').slice(0, 600)}`;
const addDone = (dir, title, evidence) => {
  const a = runIn(dir, ['task', 'add', title, '--path', dir, '--json']);
  const id = JSON.parse(a.stdout.slice(a.stdout.indexOf('{'))).id;
  assert.ok(id, show(a));
  const u = runIn(dir, ['task', 'update', id, '--status', 'done', '--evidence', evidence, '--path', dir]);
  assert.strictEqual(u.status, 0, show(u));
  return id;
};
// Two placeholder rows (one a bare plan link), one done row with real evidence and one open row: only the first two
// are candidates.
const project = lang => {
  const P = fresh(lang);
  const A = addDone(P, 'row a', 'user-request'), B = addDone(P, 'row b', 'plan:M-0002');
  addDone(P, 'row c', 'npm test passed, 3/3');
  runIn(P, ['task', 'add', 'row d', '--path', P]);
  return { P, A, B };
};
const lines = out => String(out || '').replace(/\r\n/g, '\n').split('\n');
const TEXT = {
  en: {
    header: n => `# task fix-evidence — ${n} candidate(s)`,
    // Review round 1: the English names the rows the filter takes (the Korean says "no verification keyword") and
    // counts the plan links --set appended (a link already in the new text is kept but not counted).
    intro: ['These done rows have empty or placeholder evidence (user-request, -, or only a plan link).', 'Update each with the command below, or all at once with --set "<common text>".', ''],
    row: (id, request, evidence) => [`leerness task update ${id} --evidence "verification result (e.g., npm test passed)"`, `  Request: ${request}`, `  Current evidence: "${evidence}"`, ''],
    none: '✓ No candidates to update (no done row has empty or placeholder evidence)',
    set: (n, kept) => `✓ Updated the evidence of ${n} row(s)` + (kept == null ? '' : ` (plan links appended: ${kept})`),
  },
  ko: {
    header: n => `# task fix-evidence — ${n}개 후보`,
    intro: ['아래 row들은 evidence가 검증 키워드(테스트/명령/결과)를 포함하지 않습니다.', '각각 다음 명령으로 갱신하거나, --set "<공통 텍스트>"로 일괄 갱신하세요.', ''],
    row: (id, request, evidence) => [`leerness task update ${id} --evidence "검증 결과 (e.g., npm test 통과)"`, `  요청: ${request}`, `  현재 evidence: "${evidence}"`, ''],
    none: '✓ 갱신 후보 없음 (모든 done row가 검증 키워드 보유)',
    set: (n, kept) => `✓ ${n}개 row의 evidence를 일괄 갱신` + (kept == null ? '' : ` (link 보존: ${kept}건)`),
  },
};
const listing = (lang, P, A, B) => [TEXT[lang].header(2), ...TEXT[lang].intro, ...TEXT[lang].row(A, 'row a', 'user-request'), ...TEXT[lang].row(B, 'row b', 'plan:M-0002'), ''];

for (const lang of ['en', 'ko']) {
  test(`${lang}: the candidate list, its guidance and per-row lines`, () => {
    const { P, A, B } = project(lang);
    const r = runIn(P, ['task', 'fix-evidence', '--path', P]);
    assert.strictEqual(r.status, 0, show(r));
    assert.deepStrictEqual(lines(r.stdout), listing(lang, P, A, B));
    if (lang === 'en') assert.ok(!HANGUL.test(r.stdout + r.stderr), 'Hangul in an English project:\n' + r.stdout + r.stderr);
    // --fail-on-candidates prints the same list and exits 1.
    const f = runIn(P, ['task', 'fix-evidence', '--path', P, '--fail-on-candidates']);
    assert.deepStrictEqual([f.status, lines(f.stdout)], [1, listing(lang, P, A, B)], show(f));
  });

  test(`${lang}: --set results, with and without plan links kept, and the empty list`, () => {
    const { P, A, B } = project(lang);
    const tracker = path.join(P, '.leerness', 'progress-tracker.md');
    const s = runIn(P, ['task', 'fix-evidence', '--set', 'checked by hand', '--path', P]);
    assert.deepStrictEqual([s.status, lines(s.stdout)], [0, [TEXT[lang].set(2, 1), '']], show(s));
    const md = fs.readFileSync(tracker, 'utf8');
    assert.ok(md.includes(`| ${A} | done | row a | checked by hand |`) && md.includes(`| ${B} | done | row b | checked by hand (plan:M-0002) |`), md);
    // Nothing left to update.
    const e = runIn(P, ['task', 'fix-evidence', '--path', P]);
    assert.deepStrictEqual([e.status, lines(e.stdout)], [0, [TEXT[lang].none, '']], show(e));
    if (lang === 'en') assert.ok(!HANGUL.test(s.stdout + s.stderr + e.stdout + e.stderr), 'Hangul in an English project:\n' + s.stdout + e.stdout);
    const Q = project(lang);
    const n = runIn(Q.P, ['task', 'fix-evidence', '--set', 'checked by hand', '--no-preserve-link', '--path', Q.P]);
    assert.deepStrictEqual([n.status, lines(n.stdout)], [0, [TEXT[lang].set(2, null), '']], show(n));
    // Review round 1: what --no-preserve-link writes, not only what it prints: the plan link is not carried over.
    const qmd = fs.readFileSync(path.join(Q.P, '.leerness', 'progress-tracker.md'), 'utf8');
    assert.ok(qmd.includes(`| ${Q.A} | done | row a | checked by hand |`) && qmd.includes(`| ${Q.B} | done | row b | checked by hand |`) && !qmd.includes('M-0002'), qmd);
  });
}

test('the language is chosen as for other commands: --language, then LEERNESS_LANG, then the manifest', () => {
  // Review round 1: each override against the other source, in both directions, with the exit status.
  const ko = project('ko'), en = project('en');
  const cases = [
    ['a Korean project, LEERNESS_LANG=en', ko, [], { LEERNESS_LANG: 'en' }, 'en'],
    ['an English project, LEERNESS_LANG=ko', en, [], { LEERNESS_LANG: 'ko' }, 'ko'],
    ['--language ko over LEERNESS_LANG=en', en, ['--language', 'ko'], { LEERNESS_LANG: 'en' }, 'ko'],
    ['--language en over LEERNESS_LANG=ko', ko, ['--language', 'en'], { LEERNESS_LANG: 'ko' }, 'en'],
  ];
  for (const [label, p, flags, extra, want] of cases) {
    const r = runIn(p.P, ['task', 'fix-evidence', '--path', p.P, ...flags], extra);
    assert.deepStrictEqual([r.status, lines(r.stdout)], [0, listing(want, p.P, p.A, p.B)], label + ': ' + show(r));
  }
});

console.log(`fix-evidence language: ${passed}/${passed + failed}`);
if (filter && !ran) console.error(`--match ${JSON.stringify(filter)} selected no test`);
try { removeTree(arena, { recursive: true, force: true }); } catch {}
if (failed || (filter ? ran === 0 : ran !== 5)) process.exitCode = 1;
