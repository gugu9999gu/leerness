// scripts/e2e-lived-in-harness.js — T-0341: a project harness made through the product, with the state a project
// gathers in use, for e2e checks that need "a cwd with a real harness".
//
// The selftest --json contract check used to copy this repository's own .leerness, AGENTS.md and CLAUDE.md. The
// public export has none of them, so there the check ran in a folder holding only package.json and no longer
// covered the paths that read the cwd's harness (selftest's own process reads the cwd's manifest and skills; the
// processes it starts touch the cwd's .leerness and write its usage counter). This builds the same kind of state
// in a temp folder with ordinary commands, the same on every tree, and checks each piece exactly: an in-progress
// and a planned milestone, an in-progress and a done task (the ones it added, by the ids `task add` returned), a
// dated decision, a lesson, an active rule, an open user request, a closed session (a handoff naming the
// in-progress task, the current state, a pre-wake report), the manifest, the installed skills and the usage counter.
'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

// `{dir}` is the project folder; `{task1}` and `{task2}` are the ids the two `task add --json` steps return. init
// adds its own default task and a milestone added as in-progress gets one too, so fixed ids would hit those rows.
const STEPS = [
  { args: ['init', '{dir}', '--yes', '--language', 'ko', '--skills', 'recommended'] },
  { args: ['plan', 'add', '마일스톤 A', '--status', 'in-progress', '--path', '{dir}'] },
  { args: ['plan', 'add', '마일스톤 B', '--status', 'planned', '--path', '{dir}'] },
  { args: ['task', 'add', '로그인 화면 문구 정리', '--status', 'requested', '--path', '{dir}', '--json'], capture: 'task1' },
  { args: ['task', 'add', '설정 화면 문구 정리', '--status', 'requested', '--path', '{dir}', '--json'], capture: 'task2' },
  { args: ['task', 'update', '{task1}', '--status', 'in-progress', '--next', '화면 검토', '--path', '{dir}'] },
  { args: ['task', 'update', '{task2}', '--status', 'done', '--evidence', 'review-evidence:lived-in fixture', '--path', '{dir}'] },
  { args: ['decision', 'add', 'UI 문구는 존댓말로 쓴다', '--reason', '화면 전체의 어조를 맞춘다', '--path', '{dir}'] },
  { args: ['lesson', 'save', '화면 문구는 저장 전에 미리보기로 확인한다', '--path', '{dir}'] },
  { args: ['rule', 'add', '매 라운드 테스트 실행', '--trigger', 'every-round', '--path', '{dir}'] },
  { args: ['requests', 'add', '다크 모드 지원', '--path', '{dir}'] },
  { args: ['session', 'close', '{dir}'] },
];

const ws = (dir, rel) => path.join(dir, '.leerness', rel);
const text = (dir, rel) => fs.readFileSync(ws(dir, rel), 'utf8');
const json = (dir, rel) => JSON.parse(text(dir, rel));
// Tracker rows as cells: [id, status, request, evidence, next action, updated].
const trackerRows = dir => text(dir, 'progress-tracker.md').split(/\r?\n/).filter(l => /^\| T-\d+ \|/.test(l))
  .map(l => l.split('|').slice(1, -1).map(c => c.trim()));
const rowFor = (dir, request) => trackerRows(dir).find(c => c[2] === request);
// The plan.md block of a milestone: from its "### M-n. <title>" heading to the next heading of that level.
const milestoneStatus = (dir, title) => {
  const lines = text(dir, 'plan.md').split(/\r?\n/);
  const at = lines.findIndex(l => new RegExp(`^### M-\\d+\\. ${title}$`).test(l));
  if (at < 0) return null;
  for (let i = at + 1; i < lines.length && !/^#{1,3} /.test(lines[i]); i++) {
    const m = /^Status: (\S+)$/.exec(lines[i]);
    if (m) return m[1];
  }
  return null;
};

// The state the steps must leave: [description, file under .leerness, check]. A check that throws counts as false.
const EXPECT = [
  ['in-progress task', 'progress-tracker.md', dir => (rowFor(dir, '로그인 화면 문구 정리') || [])[1] === 'in-progress'],
  ['done task', 'progress-tracker.md', dir => (rowFor(dir, '설정 화면 문구 정리') || [])[1] === 'done'],
  ['active milestone', 'plan.md', dir => milestoneStatus(dir, '마일스톤 A') === 'in-progress'],
  ['planned milestone', 'plan.md', dir => milestoneStatus(dir, '마일스톤 B') === 'planned'],
  // The rule row's own Trigger, Rule and Status cells, read by the header of the table the row is in (the same
  //   English header in a Korean and an English project), so "active" in another cell (Last Verified) or a header
  //   of another table does not count.
  ['active rule', 'rules.md', dir => {
    const tables = [];
    let cur = null;
    for (const l of text(dir, 'rules.md').split(/\r?\n/)) {
      if (!l.startsWith('|')) { cur = null; continue; }
      if (!cur) tables.push(cur = []);
      cur.push(l.split('|').slice(1, -1).map(s => s.trim()));
    }
    return tables.some(rows => {
      const head = rows[0];
      const [iT, iR, iS] = ['Trigger', 'Rule', 'Status'].map(h => head.indexOf(h));
      return head[0] === 'ID' && iT > 0 && iR > 0 && iS > 0
        && rows.slice(1).some(c => /^R-\d+$/.test(c[0]) && c[iT] === 'every-round' && c[iR] === '매 라운드 테스트 실행' && c[iS] === 'active');
    });
  }],
  ['decision', 'decisions.md', dir => /^### \d{4}-\d{2}-\d{2} — UI 문구는 존댓말로 쓴다$/m.test(text(dir, 'decisions.md'))],
  ['lesson', 'lessons.md', dir => text(dir, 'lessons.md').split(/\r?\n/).includes('- Lesson: 화면 문구는 저장 전에 미리보기로 확인한다')],
  ['open user request', 'user-requests.json', dir => json(dir, 'user-requests.json').requests.some(r => r.text === '다크 모드 지원' && r.status === 'open')],
  // The whole id: T-0003 is not named by "T-00030" or "T-0003x", and it is by "__T-0003__" (Markdown emphasis).
  ['session handoff', 'session-handoff.md', dir => {
    const id = (rowFor(dir, '로그인 화면 문구 정리') || [])[0];
    return /^T-\d+$/.test(id || '') && new RegExp(`(?<![A-Za-z0-9-])${id}(?![A-Za-z0-9])`).test(text(dir, 'session-handoff.md'));
  }],
  ['current state', 'current-state.md', dir => text(dir, 'current-state.md').trim().length > 0],
  ['pre-wake report', 'pre-wake-report.json', dir => { const r = json(dir, 'pre-wake-report.json').reports; return Array.isArray(r) && r.length > 0; }],
  ['manifest', 'manifest.json', dir => { const m = json(dir, 'manifest.json'); return typeof m.leernessVersion === 'string' && m.language === 'ko'; }],
  ['installed skills', 'skills', dir => fs.readdirSync(ws(dir, 'skills')).length > 0],
  ['usage counter', 'cache/usage-stats.json', dir => { const c = json(dir, 'cache/usage-stats.json').commands; return c.task >= 4 && c.session >= 1; }],
];

// The EXPECT entries that `dir` does not satisfy, as "description (.leerness/file)".
function livedInMissing(dir) {
  const missing = [];
  for (const [what, rel, check] of EXPECT) {
    let ok = false;
    try { ok = check(dir) === true; } catch {}
    if (!ok) missing.push(`${what} (.leerness/${rel})`);
  }
  return missing;
}

// Builds the harness in `dir` (created if missing). Returns { ok, steps, missing }: each step's exit status and
// error (a `task add` whose output has no task id, or a step that needed that id), and the expected state that is
// not there. `ok` is true only when every step exited 0 without an error and nothing is missing.
function buildLivedInHarness(dir, cli, { env = process.env, timeout = 180000 } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"lived-in-harness","version":"0.1.0","private":true}\n');
  const ids = {};
  const steps = [];
  for (const step of STEPS) {
    const command = step.args.filter(a => a !== '{dir}').slice(0, step.args[0] === 'init' ? 1 : 3).join(' ');
    const unresolved = step.args.filter(a => /^\{task\d\}$/.test(a) && !ids[a.slice(1, -1)]);
    if (unresolved.length) { steps.push({ command, status: null, error: 'needs ' + unresolved.join(', '), stderr: '' }); continue; }
    const args = step.args.map(a => a === '{dir}' ? dir : /^\{task\d\}$/.test(a) ? ids[a.slice(1, -1)] : a);
    const r = cp.spawnSync(process.execPath, [cli, ...args], { cwd: dir, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
    let error = r.error ? r.error.code || String(r.error.message) : null;
    if (step.capture) {
      const m = /"id"\s*:\s*"(T-\d+)"/.exec(r.stdout || '');
      if (m) ids[step.capture] = m[1]; else error = error || 'no task id in the output';
    }
    steps.push({ command, status: r.status, error, stderr: (r.stderr || '').slice(0, 300) });
  }
  const missing = livedInMissing(dir);
  return { ok: steps.every(s => s.status === 0 && !s.error) && missing.length === 0, steps, missing, ids };
}

// `selftest --json` in `cwd`: stdout must be one JSON document reporting every case passed, stderr must be empty
// (0 bytes) and the exit status 0. Returns each part, so a failure says which one broke.
function selftestJsonContract(cli, cwd, { env = process.env, timeout = 900000 } = {}) {
  const r = cp.spawnSync(process.execPath, [cli, 'selftest', '--json'], { cwd, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  let j = null;
  try { j = JSON.parse(r.stdout); } catch {}
  const pureStdout = typeof r.stdout === 'string' && r.stdout.trimStart().startsWith('{');
  const payloadOk = !!j && j.ok === true && j.pass === j.total && j.fail === 0 && j.total > 0;
  const stderr = r.stderr || '';
  return { ok: pureStdout && payloadOk && stderr.length === 0 && r.status === 0, pureStdout, payloadOk,
    stderrBytes: stderr.length, stderrHead: stderr.slice(0, 300), status: r.status, error: r.error ? r.error.code || String(r.error.message) : null,
    total: j && j.total, fail: j && j.fail };
}

module.exports = { STEPS, EXPECT, buildLivedInHarness, livedInMissing, selftestJsonContract };

// Run directly to check that both helpers discriminate. The contract judgment runs against a stand-in CLI (no real
// selftest, so this stays fast): clean output passes, and each broken part fails on that part. The fixture is built
// once with the real CLI (about 20 s); then each piece of state, changed alone in a copy, is the one reported
// missing, and a stand-in CLI shows that failing steps, steps that leave nothing, and a missing task id each fail it.
if (require.main === module) {
  const os = require('os');
  const assert = require('assert');
  const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
  const env = { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTO_ROADMAP: '1' };
  let passed = 0;
  const failed = [];
  const t = (name, fn) => {
    try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed.push(name); console.log('FAIL ' + name + ': ' + (e && e.message || e)); }
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lived-in-selftest-'));
  try {
    const fake = path.join(root, 'stand-in-cli.js');
    fs.writeFileSync(fake, [
      'const m = process.env.STAND_IN_MODE, nl = String.fromCharCode(10);',
      "const body = m === 'failfield' ? { ok: true, total: 3, pass: 3, fail: 1 } : m === 'nofail' ? { ok: true, total: 3, pass: 3 }",
      "  : { ok: m !== 'notok', total: 3, pass: m === 'fail' ? 2 : 3, fail: m === 'fail' ? 1 : 0 };",
      "if (m !== 'noid') body.id = 'T-0009';",
      'const j = JSON.stringify(body);',
      "if (m === 'prefix') process.stdout.write('note' + nl);",
      'process.stdout.write(j + nl);',
      "if (m === 'stderr') process.stderr.write('x');",
      "if (m === 'newline') process.stderr.write(nl);",
      "if (m === 'exit') process.exitCode = 1;",
      "if (m === 'allfail') process.exitCode = 2;",
    ].join('\n') + '\n');
    const contract = mode => selftestJsonContract(fake, root, { env: { ...env, STAND_IN_MODE: mode }, timeout: 60000 });
    const standIn = (dir, mode) => buildLivedInHarness(dir, fake, { env: { ...env, STAND_IN_MODE: mode }, timeout: 60000 });
    t('contract: clean output passes', () => {
      const c = contract('clean');
      assert.deepStrictEqual([c.ok, c.pureStdout, c.payloadOk, c.stderrBytes, c.status], [true, true, true, 0, 0]);
    });
    for (const [mode, check] of [
      ['prefix', c => !c.pureStdout], ['stderr', c => c.stderrBytes === 1], ['newline', c => c.stderrBytes === 1],
      ['exit', c => c.status === 1 && c.payloadOk], ['fail', c => !c.payloadOk && c.fail === 1], ['notok', c => !c.payloadOk],
      // A payload that counts every case passed but still reports a failure, or leaves the fail count out.
      ['failfield', c => !c.payloadOk && c.fail === 1], ['nofail', c => !c.payloadOk],
    ]) t(`contract: ${mode} fails on its own part`, () => { const c = contract(mode); assert.strictEqual(c.ok, false); assert.ok(check(c), JSON.stringify(c)); });

    const dir = path.join(root, 'lived');
    const built = buildLivedInHarness(dir, CLI, { env });
    t('fixture: every step exits 0, the added tasks got their own ids, and the state is there', () => {
      assert.ok(built.ok, JSON.stringify({ steps: built.steps.filter(s => s.status !== 0 || s.error), missing: built.missing }));
      assert.strictEqual(built.steps.length, STEPS.length);
      assert.deepStrictEqual(built.missing, []);
      // init's default task and the in-progress milestone's task come first, so the added tasks are not T-0001/T-0002.
      assert.ok(built.ids.task1 && built.ids.task2 && built.ids.task1 !== built.ids.task2 && !['T-0001', 'T-0002'].includes(built.ids.task1), JSON.stringify(built.ids));
    });
    // Each piece of state changed alone, in a copy: exactly that piece is reported missing.
    const edit = (d, rel, from, to) => { const f = ws(d, rel), s = fs.readFileSync(f, 'utf8'); if (!s.includes(from)) throw new Error(`${rel}: no "${from}"`); fs.writeFileSync(f, s.split(from).join(to)); };
    let n = 0;
    const covered = [];
    for (const [what, change] of [
      ['in-progress task', d => edit(d, 'progress-tracker.md', `| ${built.ids.task1} | in-progress |`, `| ${built.ids.task1} | planned |`)],
      ['done task', d => edit(d, 'progress-tracker.md', `| ${built.ids.task2} | done |`, `| ${built.ids.task2} | requested |`)],
      ['active milestone', d => edit(d, 'plan.md', '마일스톤 A\nStatus: in-progress', '마일스톤 A\nStatus: planned')],
      ['planned milestone', d => fs.writeFileSync(ws(d, 'plan.md'), text(d, 'plan.md').replace(/(### M-\d+\. 마일스톤 B\r?\n)Status: planned/, '$1Status: done'))],
      ['active rule', d => edit(d, 'rules.md', '| active |', '| paused |')],
      // Paused, with "active" in its Last Verified cell instead.
      ['active rule', d => fs.writeFileSync(ws(d, 'rules.md'), text(d, 'rules.md').replace(/^(\| R-\d+ \|.*)\| active \| - \|$/m, '$1| paused | active |'))],
      // The same, under an earlier table whose header has Status and Last Verified swapped.
      ['active rule', d => fs.writeFileSync(ws(d, 'rules.md'), '| ID | Trigger | Rule | Added | Last Verified | Status |\n|---|---|---|---|---|---|\n\n'
        + text(d, 'rules.md').replace(/^(\| R-\d+ \|.*)\| active \| - \|$/m, '$1| paused | active |'))],
      ['decision', d => edit(d, 'decisions.md', '— UI 문구는 존댓말로 쓴다', '— UI 문구는 반말로 쓴다')],
      ['lesson', d => edit(d, 'lessons.md', '- Lesson: 화면 문구는', '- Lesson: 화면 글자는')],
      ['open user request', d => edit(d, 'user-requests.json', '"status": "open"', '"status": "done"')],
      // A handoff that is still there but no longer names the in-progress task.
      ['session handoff', d => edit(d, 'session-handoff.md', built.ids.task1, 'T-9999')],
      // Only a longer id that starts with it: T-0003 named as "T-00030" or "T-0003x".
      ['session handoff', d => edit(d, 'session-handoff.md', built.ids.task1, built.ids.task1 + '0')],
      ['session handoff', d => edit(d, 'session-handoff.md', built.ids.task1, built.ids.task1 + 'x')],
      ['current state', d => fs.writeFileSync(ws(d, 'current-state.md'), '\n')],
      ['pre-wake report', d => fs.writeFileSync(ws(d, 'pre-wake-report.json'), '{"reports":[]}')],
      ['manifest', d => edit(d, 'manifest.json', '"language": "ko"', '"language": "en"')],
      ['installed skills', d => { fs.rmSync(ws(d, 'skills'), { recursive: true }); fs.mkdirSync(ws(d, 'skills')); }],
      // Still valid JSON, but with fewer commands counted than the build ran.
      ['usage counter', d => fs.writeFileSync(ws(d, 'cache/usage-stats.json'), '{"commands":{"task":1,"session":1}}\n')],
    ]) {
      const copy = path.join(root, 'copy-' + (++n));
      covered.push(what);
      require('../lib/copy-tree').copyTreeSync(dir, copy);
      t(`fixture: ${what} changed alone is the one reported missing (#${n})`, () => {
        change(copy);
        assert.deepStrictEqual(livedInMissing(copy).map(m => m.split(' (')[0]), [what]);
      });
    }
    t('fixture: every EXPECT entry has a change above', () => assert.deepStrictEqual([...new Set(covered)].sort(), EXPECT.map(e => e[0]).sort()));
    // Control for the whole-id match: the id in Markdown emphasis still names the task.
    t('fixture: a handoff naming the task as __id__ still counts', () => {
      const copy = path.join(root, 'copy-emphasis');
      require('../lib/copy-tree').copyTreeSync(dir, copy);
      edit(copy, 'session-handoff.md', built.ids.task1, '__' + built.ids.task1 + '__');
      assert.deepStrictEqual(livedInMissing(copy), []);
    });
    t('fixture: failing steps fail the build even when the state is already there', () => {
      const again = standIn(dir, 'allfail');
      assert.deepStrictEqual([again.ok, again.missing.length, again.steps.filter(s => s.status === 2).length], [false, 0, STEPS.length]);
    });
    t('fixture: a task add whose output has no task id fails the build, and the steps that need it do not run', () => {
      const b = standIn(dir, 'noid');
      assert.deepStrictEqual([b.ok, b.missing.length], [false, 0]);
      assert.deepStrictEqual(b.steps.filter(s => s.error).map(s => s.status === null ? 'skipped' : s.error), ['no task id in the output', 'no task id in the output', 'skipped', 'skipped']);
    });
    t('fixture: steps that exit 0 but leave no state fail the build', () => {
      const b = standIn(path.join(root, 'hollow'), 'clean');
      assert.deepStrictEqual([b.ok, b.steps.every(s => s.status === 0 && !s.error), b.missing.length], [false, true, EXPECT.length]);
    });
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
  console.log(`lived-in harness helpers: ${passed}/${passed + failed.length} passed`);
  if (failed.length) process.exitCode = 1;
}
