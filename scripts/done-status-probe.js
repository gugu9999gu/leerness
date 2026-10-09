'use strict';
// T-0332: which tracker statuses read as done. verify-claim (one task, and --all, which gate --claims runs), the claims
// baseline, lazy detection and past-fix advice share one exact predicate: done, completed, verified or 완료, in any
// case, with the cell's spaces trimmed, also inside one pair of brackets (the older tracker form, like [진행]).
// Before, verify-claim matched substrings, so unverified, not-done, uncompleted and 미완료 rows were checked as done
// claims and listed by --all, the claims baseline took a different set again, and --all picked verified rows that the
// per-task check then did not check as done claims. Rows are made through the product; only the status cell is edited,
// as older trackers and `task update --force` can hold words `task update` does not write. Every test works on its
// own copy of an initialized seed project.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
const { _isDoneStatus } = require('../lib/pure-utils');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
// A filter must name something: a missing value or one that selects no test is a failure, not "0/0 passed".
// Checked before any temporary folder exists, so this exit leaves nothing behind.
if (process.argv.includes('--match') && !filter) { console.error('--match needs a test name substring'); process.exit(1); }
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-done-status-'));
const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
  LEERNESS_NO_AUTOCHCP: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_SKILL_HISTORY: '1' };
for (const key of ['LEERNESS_LANG', 'LEERNESS_OLLAMA_BASE_URL', 'LEERNESS_ENFORCE_POLICY']) delete env[key];
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) { env[key] = path.join(arena, 'env-' + key.toLowerCase()); fs.mkdirSync(env[key]); }
let passed = 0, failed = 0, ran = 0;
const test = (name, fn) => { if (filter && !name.includes(filter)) return; ran++; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };

let seedDir = null;
const seed = () => {
  if (seedDir) return seedDir;
  const dir = path.join(arena, 'seed');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"proj","version":"0.1.0"}\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'init', dir, '--yes', '--language', 'en', '--no-mcp'], { cwd: dir, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
  assert.strictEqual(r.status, 0, 'init exit ' + r.status + '\n' + r.stdout + r.stderr);
  return (seedDir = dir);
};
let copies = 0;
const fresh = () => { const dir = path.join(arena, 'p' + (++copies)); fs.cpSync(seed(), dir, { recursive: true }); return dir; };
const runIn = (cwd, args) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
const show = r => `exit ${r.status}\n${String(r.stdout || '').slice(0, 1200)}${String(r.stderr || '').slice(0, 600)}`;
const json = (r, label) => { const out = String(r.stdout || ''); try { return JSON.parse(out.slice(out.indexOf('{'))); } catch { throw new Error(label + ': not JSON — ' + show(r)); } };
const addTask = (dir, title) => { const r = runIn(dir, ['task', 'add', title, '--path', dir, '--json']); const j = json(r, 'task add'); assert.ok(j.ok && j.id, show(r)); return j.id; };
const setStatus = (dir, id, status, evidence) => { const r = runIn(dir, ['task', 'update', id, '--status', status, '--evidence', evidence, '--path', dir]); assert.strictEqual(r.status, 0, 'task update ' + show(r)); };
const setStatusCell = (dir, id, from, to) => {
  const tracker = path.join(dir, '.leerness', 'progress-tracker.md');
  const md = fs.readFileSync(tracker, 'utf8');
  assert.strictEqual(md.split(`| ${id} | ${from} |`).length, 2, `one ${from} row for ${id}`);
  fs.writeFileSync(tracker, md.replace(`| ${id} | ${from} |`, `| ${id} | ${to} |`));
};
// One task per status word, made done through the product with this evidence, then given that word in its cell.
const rowsWith = (dir, words, evidence) => words.map(word => {
  const id = addTask(dir, 'row for ' + word);
  setStatus(dir, id, 'done', evidence);
  if (word !== 'done') setStatusCell(dir, id, 'done', word);
  return { id, word, done: DONE.includes(word) };
});
const ids = rows => rows.map(r => r.id).sort();

// Status words as a tracker cell holds them (readProgressRows trims the cell).
const DONE = ['done', 'completed', 'verified', '완료', 'Done', 'VERIFIED', '[완료]', '[done]'];
const NOT_DONE = ['unverified', 'not-done', 'uncompleted', 'undone', '미완료', '[미완료]', 'done ✓', 'in-progress', '[진행]'];
const ADVISORY = new Set(['progress_empty', 'handoff_never_generated', 'handoff_empty', 'no_test_run']);

test('the predicate: the exact words in any case, trimmed, also in one pair of brackets; nothing else', () => {
  for (const s of [...DONE, ' done ', '[ 완료 ]', 'Completed', '[Verified]']) assert.strictEqual(_isDoneStatus(s), true, JSON.stringify(s));
  for (const s of [...NOT_DONE, '', null, undefined, 'dropped', '[done', 'done]', '[[done]]', 'done done', 'done.', '완료됨']) assert.strictEqual(_isDoneStatus(s), false, JSON.stringify(s));
});

test('verify-claim checks exactly the done statuses as done claims', () => {
  const P = fresh();
  const rows = rowsWith(P, [...DONE, ...NOT_DONE.filter(w => w !== 'in-progress' && w !== '[진행]')], 'fixed it');
  const got = rows.map(({ id, word }) => {
    const r = runIn(P, ['verify-claim', id, '--path', P, '--json']);
    const j = json(r, 'verify-claim ' + id);
    return [word, r.status, j.ok, j.evidence && j.evidence.required, j.claims !== null];
  });
  // A done claim with evidence that names nothing fails; any other status is not checked as a claim.
  assert.deepStrictEqual(got, rows.map(({ word, done }) => done ? [word, 1, false, true, true] : [word, 0, true, false, false]));
});

test('verify-claim --all and its claims baseline take exactly the done statuses', () => {
  const P = fresh();
  const rows = rowsWith(P, [...DONE, ...NOT_DONE.filter(w => w !== 'in-progress' && w !== '[진행]')], 'fixed it');
  const done = rows.filter(r => r.done);
  const all = () => { const r = runIn(P, ['verify-claim', '--all', '--path', P, '--json']); return { r, j: json(r, 'verify-claim --all') }; };
  const before = all();
  assert.deepStrictEqual([before.r.status, before.j.total, before.j.results.map(x => x.id).sort(), before.j.results.every(x => x.ok === false)], [1, done.length, ids(done), true], show(before.r));
  // The baseline takes the failures before the boundary among the same rows, verified included.
  const B = addTask(P, 'boundary');
  const created = runIn(P, ['verify-claim', 'baseline', 'create', '--before', B, '--yes', '--path', P, '--json']);
  const c = json(created, 'baseline create');
  assert.deepStrictEqual([created.status, c.evaluatedBefore, c.baselined], [0, done.length, done.length], show(created));
  const doc = JSON.parse(fs.readFileSync(path.join(P, '.leerness', 'claims-baseline.json'), 'utf8'));
  assert.deepStrictEqual(doc.entries.map(e => e.id).sort(), ids(done));
  const after = all();
  assert.deepStrictEqual([after.r.status, after.j.ok, after.j.failed, after.j.baselined], [0, true, 0, done.length], show(after.r));
});

test('lazy detect reads the same statuses as done work', () => {
  const P = fresh();
  const rows = rowsWith(P, [...DONE, ...NOT_DONE.filter(w => w !== 'in-progress' && w !== '[진행]')], 'n/a');
  const r = runIn(P, ['lazy', 'detect', P, '--json']);
  const j = json(r, 'lazy detect');
  assert.deepStrictEqual(j.findings.filter(f => f.kind === 'evidence_missing').map(f => f.taskId).sort(), ids(rows.filter(x => x.done)), show(r));
  // A project whose only finished task is marked [완료] has done work: its absence signals block, as for done.
  for (const [word, hasDoneWork] of [['[완료]', true], ['완료', true], ['미완료', false], ['not-done', false]]) {
    const Q = fresh();
    rowsWith(Q, [word], 'src/index.js changed, tests 3/3 passed');
    const k = json(runIn(Q, ['lazy', 'detect', Q, '--json']), 'lazy detect ' + word);
    const advisory = k.findings.filter(f => ADVISORY.has(f.kind)).length;
    assert.ok(advisory > 0, word + ': no absence signal to tell the cases apart: ' + JSON.stringify(k.findings));
    assert.strictEqual(k.blockingIssues, hasDoneWork ? k.issues : k.issues - advisory, word + ': ' + JSON.stringify(k));
  }
});

test('the bugfix done gate holds a done word written with --force, as it holds done', () => {
  const P = fresh();
  assert.strictEqual(runIn(P, ['toggle', 'set', 'bugfix-receipt', 'on', '--path', P]).status, 0, 'toggle set');
  fs.mkdirSync(path.join(P, 'src'), { recursive: true });
  fs.writeFileSync(path.join(P, 'src', 'app.js'), 'console.log("BUG_HERE"); process.exit(3);\n');
  const id = addTask(P, 'fix order status');
  const s = runIn(P, ['bugfix', 'start', id, '--repro', 'node src/app.js', '--expect-bad', 'BUG_HERE', '--path', P, '--json']);
  assert.strictEqual(json(s, 'bugfix start').ok, true, show(s));
  const tracker = path.join(P, '.leerness', 'progress-tracker.md');
  const before = fs.readFileSync(tracker, 'utf8');
  const got = ['done', '완료', '[완료]', 'Done', 'not-done'].map(word => {
    const r = runIn(P, ['task', 'update', id, '--status', word, '--force', '--path', P, '--json']);
    const code = r.status === 0 ? null : json(r, 'task update ' + word).code;
    const changed = fs.readFileSync(tracker, 'utf8') !== before;
    if (changed) fs.writeFileSync(tracker, before);
    return [word, r.status, code, changed];
  });
  // A word not read as done is not a done transition: it is written (control), and the row is put back after it.
  assert.deepStrictEqual(got, [['done', 1, 'probe_still_failing', false], ['완료', 1, 'probe_still_failing', false], ['[완료]', 1, 'probe_still_failing', false],
    ['Done', 1, 'probe_still_failing', false], ['not-done', 0, null, true]]);
});

test('task fix-evidence reads a done status the same way (its placeholder list is its own)', () => {
  const P = fresh();
  const rows = rowsWith(P, ['done', '완료', '[완료]', 'not-done', '미완료'], 'user-request');
  const r = runIn(P, ['task', 'fix-evidence', '--path', P, '--fail-on-candidates']);
  const listed = rows.filter(x => String(r.stdout).includes('leerness task update ' + x.id + ' ')).map(x => x.word);
  assert.deepStrictEqual([r.status, listed], [1, ['done', '완료', '[완료]']], show(r));
});

test('session close checks completion honesty on the same done statuses', () => {
  // Review round 1: its two advisory checks took the report's done bucket, which counts finished and complete but not
  // 완료 or [완료]. The bucket itself (task counts, recent references) is unchanged.
  const P = fresh();
  const [A, B, , , E] = [['[완료]', 'user-request'], ['완료', 'API 호출 완료, POST /users'], ['finished', 'user-request'],
    ['not-done', 'API 호출 완료, POST /users'], ['done', 'docs wording updated']].map(([word, evidence]) => rowsWith(P, [word], evidence)[0].id);
  const r = runIn(P, ['session', 'close', P, '--json', '--no-suggest']);
  const j = json(r, 'session close');
  assert.deepStrictEqual([j.completionHonesty.doneTotal, j.completionHonesty.doneWithoutEvidence, j.completionHonesty.ids, j.completionHonesty.optimismUnresolved.map(x => x.id)],
    [3, 1, [A], [B]], JSON.stringify(j.completionHonesty));
  assert.deepStrictEqual([j.taskCounts.done, j.taskCounts.other], [2, 3], 'the report buckets stay as they were: ' + JSON.stringify(j.taskCounts) + ' ' + E);
});

test('a TodoWrite export and sync round trip keeps the done statuses', () => {
  // Review round 2: export wrote completed only for done, so 완료, [완료], verified and Done went out as pending and a
  // sync back made them planned, which also took them out of verify-claim --all.
  const P = fresh();
  const words = ['done', '완료', '[완료]', 'verified', 'Done', 'not-done', '미완료'];
  const rows = rowsWith(P, words, 'docs wording updated');
  const todo = path.join(P, 'todo.json');
  assert.strictEqual(runIn(P, ['task', 'export', '--to', todo, '--path', P]).status, 0, 'task export');
  const exported = JSON.parse(fs.readFileSync(todo, 'utf8'));
  assert.deepStrictEqual(rows.map(x => [x.word, exported.find(t => t.content === 'row for ' + x.word).status]),
    rows.map(x => [x.word, x.done ? 'completed' : 'pending']));
  const tracker = path.join(P, '.leerness', 'progress-tracker.md');
  const sync = runIn(P, ['task', 'sync', '--from', todo, '--path', P]);
  assert.strictEqual(sync.status, 0, show(sync));
  // A done row is left as it was written: completed is what it already says. (Other statuses take the sync's mapping.)
  const md = fs.readFileSync(tracker, 'utf8');
  const kept = rows.filter(x => x.done).map(x => [x.word, md.includes('| ' + x.id + ' | ' + x.word + ' |')]);
  assert.deepStrictEqual(kept, rows.filter(x => x.done).map(x => [x.word, true]), md.split('\n').filter(l => /^\| T-/.test(l)).join('\n'));
});

console.log(`done status: ${passed}/${passed + failed}`);
if (filter && !ran) console.error(`--match ${JSON.stringify(filter)} selected no test`);
try { removeTree(arena, { recursive: true, force: true }); } catch {}
if (failed || (filter ? ran === 0 : ran !== 8)) process.exitCode = 1;
