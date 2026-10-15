'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
// T-0324 (follow-up of T-0321): titles and targets reach leerness intact through MCP and after `--`.
// The MCP title and target tools put the text before their flags without "--", so the child CLI read a title
// that begins with "-" as an option and dropped it (a markdown bullet as a task title answered empty_title).
// On the CLI, the title parser (_parseAddTitle and the lesson/decision loops), the agents text parser
// (lib/agents.js) and the positional-root finder (_taskPositionalPath) did not know where "--" was: after it, text
// that begins with "-" or "--" was dropped or ended the title, and a path-like title ("/api/users 수정") was taken as
// the project root. nonFlagArgs() now records where "--" was and these read it. Before "--" nothing changes, and
// commands without a title still read a path after "--" as their project.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
const U = require('../lib/pure-utils');
const { _parseAgentPositional, _findAgentAction } = require('../lib/agents');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-title-args-'));
// Removed on every exit, including a setup failure below: a failing init used to leave the arena behind.
process.on('exit', () => { try { removeTree(arena, { recursive: true, force: true }); } catch {} });
const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
  LEERNESS_NO_AUTOCHCP: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_SKILL_HISTORY: '1' };
// State runs are keyed by the calling session; keep this probe out of whatever session runs it.
for (const key of ['LEERNESS_LANG', 'LEERNESS_ENFORCE_POLICY', 'LEERNESS_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_HOST_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION', 'CODEX_THREAD_ID']) delete env[key];
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) { env[key] = path.join(arena, 'env-' + key.toLowerCase()); fs.mkdirSync(env[key]); }
let passed = 0, failed = 0;
const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
const test = (name, fn) => { if (filter && !name.includes(filter)) return; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };
// Checks every case before failing, so one run names all the cases that lose the text.
const each = (items, fn) => {
  const misses = [];
  for (const item of items) { try { fn(item); } catch (e) { misses.push(String(e && e.message || e).split('\n')[0]); } }
  if (misses.length) throw new Error(`${misses.length}/${items.length} failed:\n  ${misses.join('\n  ')}`);
};

const runIn = (cwd, args) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
const project = name => {
  const dir = path.join(arena, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"proj","version":"0.1.0"}\n');
  const r = runIn(dir, ['init', dir, '--yes', '--language', 'ko', '--no-mcp']);
  assert.strictEqual(r.status, 0, 'init ' + name + ' exit ' + r.status + '\n' + r.stdout + r.stderr);
  return dir;
};
const P = project('proj');
const run = args => runIn(P, args);
const show = r => `exit ${r.status} ${String(r.stdout || '').replace(/\s+/g, ' ').slice(0, 300)}${String(r.stderr || '').replace(/\s+/g, ' ').slice(0, 200)}`;
const json = (r, label) => { const out = String(r.stdout || ''); try { return JSON.parse(out.slice(out.indexOf('{'))); } catch { throw new Error(label + ': not JSON — ' + show(r)); } };
const list = (cmd, key, root = P) => json(runIn(root, [...cmd, '--path', root, '--json']), cmd.join(' '))[key];
let seq = 0;
const unique = text => `${text} [${++seq}]`;
const SHAPES = { dash: '- 로그인 버튼 고치기', ddash: '--force 옵션 추가', pathy: '/api/users 엔드포인트 수정' };
// agents resolve/fallback need a configured role; `roles set` only writes the project's role file (no provider is called).
let roleReady = false;
const ensureRole = () => { if (roleReady) return; const r = run(['roles', 'set', 'coder', '--provider', 'claude', '--path', P, '--json']); assert.strictEqual(r.status, 0, 'roles set ' + show(r)); roleReady = true; };

test('_parseAddTitle and _taskPositionalPath read tokens after -- as text and keep the old rules before it', () => {
  const at = (arr, n) => Object.defineProperty(arr, 'terminatorAt', { value: n });
  // Without a terminator nothing changes (the selftest's own cases).
  assert.strictEqual(U._parseAddTitle(['add', '제목', '/x/y'], 1), '제목');
  assert.strictEqual(U._parseAddTitle(['add', 'my', 'title', '--note', 'v'], 1), 'my title');
  assert.strictEqual(U._parseAddTitle(['add', '/only'], 1), '');
  assert.strictEqual(U._taskPositionalPath(['task', 'add', '제목', './proj'], 2), './proj');
  // After --: text of any shape, and never a path.
  for (const t of Object.values(SHAPES)) {
    assert.strictEqual(U._parseAddTitle(at(['task', 'add', t], 2), 2), t, t);
    assert.strictEqual(U._taskPositionalPath(at(['task', 'add', t], 2), 2), null, t);
  }
  // Before -- the old rules still apply, and the text after -- follows.
  assert.strictEqual(U._parseAddTitle(at(['task', 'add', '제목', '- 더'], 3), 2), '제목 - 더');
  assert.strictEqual(U._parseAddTitle(at(['task', 'add', './proj', '- 제목'], 3), 2), '- 제목');
  assert.strictEqual(U._taskPositionalPath(at(['task', 'add', './proj', '/api/x'], 3), 2), './proj');
  // Only the commands that read text after -- skip it for the project path (the exact list, so a dropout or an
  // addition shows); elsewhere a path after -- is still the project operand.
  for (const pair of ['task add', 'decision add', 'decision drop', 'lesson save', 'lesson drop', 'requests add', 'rule add', 'feature add'])
    assert.strictEqual(U._taskPositionalPath(at([...pair.split(' '), '/x'], 2), 2), null, pair);
  for (const pair of ['task list', 'task update', 'decision list', 'lesson list', 'requests list', 'requests drop', 'rule list', 'feature list', 'feature show'])
    assert.strictEqual(U._taskPositionalPath(at([...pair.split(' '), '/x'], 2), 2), '/x', pair);
  // `requests -- add "…"`: a terminator before the title start still reads from the start.
  assert.strictEqual(U._parseAddTitle(at(['requests', 'add', '- 요청'], 1), 2), '- 요청');
  // lib/agents.js reads the same terminator: the summary after it is literal, the old flag rules apply before it,
  // and the action is still found after it (the CLI has always accepted `agents record -- started …`).
  for (const t of Object.values(SHAPES)) assert.strictEqual(_parseAgentPositional(at(['started', t], 1), 1), t, 'agents ' + t);
  assert.strictEqual(_parseAgentPositional(['started', '- 요약'], 1), '');
  assert.strictEqual(_parseAgentPositional(at(['started', '요약', '--to', 'codex', '- 더'], 4), 1), '요약 - 더');
  assert.deepStrictEqual(_findAgentAction(at(['started', '요약'], 0), new Set(['started'])), { action: 'started', index: 0 });
});

test('CLI titles after -- are stored verbatim when they begin with - or -- or look like a path', () => {
  const cases = [];
  for (const [shape, base] of Object.entries(SHAPES)) {
    const c = (label, argv, read) => cases.push({ label: `${label} ${shape}`, text: unique(base), argv, read });
    c('task add', ['task', 'add'], r => json(r, 'task add').request);
    c('decision add', ['decision', 'add'], r => json(r, 'decision add').title);
    c('rule add', ['rule', 'add', '--trigger', 'every-session'], r => json(r, 'rule add').rule);
    c('lesson save', ['lesson', 'save'], r => json(r, 'lesson save').text);
    c('requests add', ['requests', 'add'], r => json(r, 'requests add').text);
    c('plan add', ['plan', 'add'], r => json(r, 'plan add').text);
    c('preview add', ['preview', 'add'], r => json(r, 'preview add').title);
    c('feature add', ['feature', 'add'], (r, text) => (list(['feature', 'list'], 'features').find(f => f.title === text) || {}).title);
  }
  each(cases, c => {
    const r = run([...c.argv, '--path', P, '--json', '--', c.text]);
    const got = c.read(r, c.text);
    assert.strictEqual(got, c.text, `${c.label}: stored ${JSON.stringify(got)} instead of ${JSON.stringify(c.text)} — ${show(r)}`);
  });
  // With no --path, each command that reads text after -- keeps a path-like text as text and works on the cwd
  // project. The relative shape keeps a regression inside the arena ("/api/…" would resolve to the drive root).
  const REL = './초안 엔드포인트 정리';
  each([
    ['task add', ['task', 'add'], text => list(['task', 'list'], 'tasks').some(x => x.request === text)],
    ['decision add', ['decision', 'add'], text => list(['decision', 'list'], 'decisions').some(x => x.title === text)],
    ['lesson save', ['lesson', 'save'], text => list(['lesson', 'list'], 'lessons').some(x => x.text === text)],
    ['requests add', ['requests', 'add'], text => list(['requests', 'list'], 'requests').some(x => x.text === text)],
    ['rule add', ['rule', 'add', '--trigger', 'every-session'], text => list(['rule', 'list'], 'rules').some(x => x.rule === text)],
    ['feature add', ['feature', 'add'], text => list(['feature', 'list'], 'features').some(x => x.title === text)],
  ], ([label, argv, found]) => {
    const text = unique(REL);
    const r = run([...argv, '--json', '--', text]);
    assert.ok(r.status === 0 && found(text), `${label} without --path: ${show(r)}`);
  });
  each([['lesson', 'save'], ['decision', 'add']], ([surface, add]) => {
    const text = unique(REL);
    assert.strictEqual(run([surface, add, '--path', P, '--json', '--', text]).status, 0, `${surface} ${add}`);
    const r = run([surface, 'drop', '--json', '--', text]);
    assert.strictEqual(json(r, `${surface} drop`).removedCount, 1, `${surface} drop without --path: ${show(r)}`);
  });
});

test('CLI state goals, handoff summaries, agent records and agent tasks after -- keep text that begins with - or --', () => {
  ensureRole();
  each([SHAPES.dash, SHAPES.ddash, SHAPES.pathy], base => {
    const g = unique(base), s = unique(base), e = unique(base), k = unique(base), f = unique(base);
    const st = run(['state', 'start', '--path', P, '--json', '--', g]);
    assert.strictEqual((json(st, 'state start').run || {}).goal, g, 'state start ' + show(st));
    const ho = run(['state', 'handoff', '--path', P, '--json', '--', s]);
    assert.strictEqual((json(ho, 'state handoff').run || {}).handoff_summary, s, 'state handoff ' + show(ho));
    const ar = run(['agents', 'record', 'started', '--path', P, '--json', '--', e]);
    assert.strictEqual(((json(ar, 'agents record').event || {}).result || {}).summary, e, 'agents record ' + show(ar));
    const rs = run(['agents', 'resolve', '--role', 'coder', '--path', P, '--json', '--', k]);
    assert.strictEqual(json(rs, 'agents resolve').task, k, 'agents resolve ' + show(rs));
    // hold only records the pause; it prepares no command and calls no provider.
    const fb = run(['agents', 'fallback', 'hold', '--role', 'coder', '--path', P, '--json', '--', f]);
    assert.strictEqual((json(fb, 'agents fallback').contract || {}).task, f, 'agents fallback ' + show(fb));
  });
  // The event name may still follow `--`, as before.
  const late = unique('요약');
  const lr = run(['agents', 'record', '--path', P, '--json', '--', 'started', late]);
  assert.strictEqual(((json(lr, 'agents record -- started').event || {}).result || {}).summary, late, 'agents record -- started ' + show(lr));
});

test('CLI drop, remove and restore targets after -- match text that begins with - or --', () => {
  each([SHAPES.dash, SHAPES.ddash], base => {
    const l = unique(base), d = unique(base), m = unique(base);
    assert.strictEqual(run(['lesson', 'save', '--path', P, '--json', '--', l]).status, 0, 'lesson save');
    const ld = run(['lesson', 'drop', '--path', P, '--json', '--', l]);
    assert.strictEqual(json(ld, 'lesson drop').removedCount, 1, 'lesson drop ' + show(ld));
    assert.strictEqual(run(['decision', 'add', '--path', P, '--json', '--', d]).status, 0, 'decision add');
    const dd = run(['decision', 'drop', '--path', P, '--json', '--', d]);
    assert.strictEqual(json(dd, 'decision drop').removedCount, 1, 'decision drop ' + show(dd));
    const mr = run(['memory', 'restore', '--path', P, '--', 'decisions', d]);
    assert.ok(mr.status === 0 && list(['decision', 'list'], 'decisions').some(x => x.title === d), 'memory restore ' + show(mr));
    assert.strictEqual(run(['plan', 'add', '--path', P, '--json', '--', m]).status, 0, 'plan add');
    const pr = run(['plan', 'remove', '--path', P, '--json', '--', m]);
    assert.strictEqual(json(pr, 'plan remove').removedCount, 1, 'plan remove ' + show(pr));
  });
});

test('before -- nothing changes: a trailing path is still the project root, flags stay flags, a dash token is an option', () => {
  const Q = project('other');
  const t = unique('제목');
  const r = runIn(arena, ['task', 'add', t, Q, '--json']);
  assert.ok(json(r, 'positional root').request === t && list(['task', 'list'], 'tasks', Q).some(x => x.request === t), 'positional root ' + show(r));
  const s = unique('상태 있는 제목');
  const r2 = run(['task', 'add', s, '--status', 'planned', '--path', P, '--json']);
  assert.ok(json(r2, 'status flag').request === s && json(r2, 'status flag').status === 'planned', 'status flag ' + show(r2));
  const d = run(['task', 'add', '- 대시 제목', '--path', P, '--json']);
  assert.ok(d.status === 1 && json(d, 'dash before --').code === 'empty_title', 'dash before -- ' + show(d));
});

test('after --, commands without a title still take a path operand as their project (no switch to the cwd project)', () => {
  // The fixed title rule must not spread: `task list -- <dir>` read <dir> before this change, and the start-up
  // bookkeeping (_runtimeProjectRoot) still reads it for `decision list`, so the handler has to agree.
  const R = project('fourth');
  const t = unique('다른 프로젝트 작업'), d = unique('다른 프로젝트 결정');
  assert.strictEqual(runIn(arena, ['task', 'add', t, '--path', R, '--json']).status, 0, 'task add in R');
  assert.strictEqual(runIn(arena, ['decision', 'add', d, '--path', R, '--json']).status, 0, 'decision add in R');
  const tl = runIn(arena, ['task', 'list', '--json', '--', R]);
  assert.ok(tl.status === 0 && (json(tl, 'task list -- R').tasks || []).some(x => x.request === t), 'task list -- R ' + show(tl));
  const dl = runIn(arena, ['decision', 'list', '--json', '--', R]);
  assert.ok(dl.status === 0 && (json(dl, 'decision list -- R').decisions || []).some(x => x.title === d), 'decision list -- R ' + show(dl));
});

test('shell-guard and pc receive values after -- that begin with -', () => {
  // With a command the output lints it (an issues list); without one it only reports the shell.
  const sg = run(['shell-guard', '--path', P, '--json', '--', '-x && echo ok']);
  assert.ok(Array.isArray(json(sg, 'shell-guard').issues), 'shell-guard ' + show(sg));
  // The coordinates and text parse; the default permission then refuses before anything moves or types.
  const click = run(['pc', 'click', '--path', P, '--json', '--', '-100', '200']);
  assert.ok(/permissions\.mouse/.test(json(click, 'pc click').error || ''), 'pc click ' + show(click));
  const type = run(['pc', 'type', '--path', P, '--json', '--', '- 글자']);
  assert.ok(/permissions\.keyboard/.test(json(type, 'pc type').error || ''), 'pc type ' + show(type));
});

test('MCP title and target tools deliver text that begins with - or -- and keep their flags before -- (22 calls)', () => {
  ensureRole();
  const mcp = calls => {
    const input = calls.map((c, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name: c[0], arguments: { ...c[1], path: P } } })).join('\n') + '\n';
    const r = cp.spawnSync(process.execPath, [CLI, 'mcp', 'serve'], { cwd: P, encoding: 'utf8', timeout: 900000, windowsHide: true, input, env, maxBuffer: 32 << 20 });
    const replies = new Map();
    for (const line of String(r.stdout || '').split('\n')) { try { const j = JSON.parse(line); if (j.id != null) replies.set(j.id, j); } catch {} }
    return calls.map((c, i) => { const rep = replies.get(i + 1); return { name: c[0], isError: rep && rep.result ? rep.result.isError : null, text: rep && rep.result ? rep.result.content[0].text : JSON.stringify(rep || r.stderr).slice(0, 300) }; });
  };
  const T = { task: unique(SHAPES.dash), task2: unique(SHAPES.ddash), task3: unique(SHAPES.pathy), dec: unique(SHAPES.dash), dec2: unique(SHAPES.ddash), rule: unique(SHAPES.ddash),
    plan: unique(SHAPES.dash), lesson: unique(SHAPES.ddash), feat: unique(SHAPES.dash), prev: unique(SHAPES.ddash), goal: unique(SHAPES.dash),
    summary: unique(SHAPES.ddash), rec: unique(SHAPES.dash), next: unique('다음 단계'), reason: unique('이유'), design: unique('디자인'),
    res: unique(SHAPES.dash), fb: unique(SHAPES.ddash) };
  const adds = mcp([
    ['leerness_task_add', { text: T.task, status: 'in-progress', nextAction: T.next }],
    ['leerness_task_add', { text: T.task2 }],
    ['leerness_task_add', { text: T.task3 }],
    ['leerness_decision_add', { title: T.dec }],
    ['leerness_decision_add', { title: T.dec2, reason: T.reason }],
    ['leerness_rule_add', { description: T.rule, trigger: 'every-session' }],
    ['leerness_plan_add', { text: T.plan }],
    ['leerness_lesson_save', { text: T.lesson, tag: '태그' }],
    ['leerness_feature_add', { title: T.feat, files: 'src/a.js' }],
    ['leerness_preview', { action: 'add', title: T.prev, design: T.design }],
    ['leerness_state_start', { goal: T.goal, task: 'T-0001' }],
    ['leerness_state_handoff', { summary: T.summary }],
    ['leerness_agents_record', { event: 'started', summary: T.rec }],
    ['leerness_agents_resolve', { task: T.res, role: 'coder' }],
    ['leerness_agents_fallback', { action: 'hold', task: T.fb, role: 'coder' }],
  ]);
  const later = mcp([
    ['leerness_lesson_drop', { target: T.lesson }],
    ['leerness_decision_drop', { target: T.dec }],
    ['leerness_memory_restore', { surface: 'decisions', target: T.dec }],
    ['leerness_plan_remove', { target: T.plan }],
    ['leerness_pc', { sub: 'click', x: -100, y: 200 }],
    ['leerness_pc', { sub: 'type', text: SHAPES.dash }],
    ['leerness_shell_guard', { command: '-x && echo ok' }],
  ]);
  const tasks = list(['task', 'list'], 'tasks'), decisions = list(['decision', 'list'], 'decisions'), rules = list(['rule', 'list'], 'rules');
  const lessons = list(['lesson', 'list'], 'lessons'), features = list(['feature', 'list'], 'features'), previews = list(['preview', 'list'], 'previews');
  const plans = list(['plan', 'list'], 'milestones');
  const inner = x => { try { return JSON.parse(x.text.slice(x.text.indexOf('{'))); } catch { return {}; } };
  // pc refuses by default (permissions), so those two errors are expected and left out of the report.
  const failedCalls = [...adds, ...later].filter(x => x.isError !== false && x.name !== 'leerness_pc').map(x => `${x.name}: ${String(x.text).replace(/\s+/g, ' ').slice(0, 90)}`);
  try { each([
    ['task_add (-) keeps status and next action as flags', () => { const row = tasks.find(x => x.request === T.task) || {}; return row.status === 'in-progress' && row.nextAction === T.next; }],
    ['task_add (--)', () => tasks.some(x => x.request === T.task2)],
    ['task_add (path-like)', () => tasks.some(x => x.request === T.task3)],
    ['decision_add (--) keeps its reason as a flag', () => (decisions.find(x => x.title === T.dec2) || {}).reason === T.reason],
    ['decision_add (-), drop and restore by the same title', () => !adds[3].isError && !later[1].isError && !later[2].isError && decisions.some(x => x.title === T.dec)],
    ['rule_add keeps its trigger', () => (rules.find(x => x.rule === T.rule) || {}).trigger === 'every-session'],
    ['plan_add then plan_remove by title', () => !adds[6].isError && !plans.some(x => x.title === T.plan) && !later[3].isError],
    ['lesson_save then lesson_drop by text', () => !adds[7].isError && !later[0].isError && !lessons.some(x => x.text === T.lesson)],
    ['feature_add keeps files', () => ((features.find(x => x.title === T.feat) || {}).files || []).includes('src/a.js')],
    ['preview add keeps design', () => (previews.find(x => x.title === T.prev) || {}).design === T.design],
    ['state_start keeps goal and task', () => { const run0 = inner(adds[10]).run || {}; return run0.goal === T.goal && run0.task_id === 'T-0001'; }],
    ['state_handoff', () => (inner(adds[11]).run || {}).handoff_summary === T.summary],
    ['agents_record', () => ((inner(adds[12]).event || {}).result || {}).summary === T.rec],
    ['agents_resolve', () => inner(adds[13]).task === T.res],
    ['agents_fallback keeps its action before --', () => { const o = inner(adds[14]); return o.action === 'hold' && (o.contract || {}).task === T.fb; }],
    ['pc click receives a negative coordinate', () => /permissions\.mouse/.test(later[4].text)],
    ['pc type receives "-" text', () => /permissions\.keyboard/.test(later[5].text)],
    ['shell_guard receives a command that begins with -', () => Array.isArray(inner(later[6]).issues)],
  ], ([label, ok]) => assert.ok(ok(), label)); }
  catch (e) { throw new Error(e.message + (failedCalls.length ? `\n  calls that failed:\n    ${failedCalls.join('\n    ')}` : '')); }
});

console.log(`Tests: ${passed}/${passed + failed} passed`);
process.exitCode = failed ? 1 : 0;
