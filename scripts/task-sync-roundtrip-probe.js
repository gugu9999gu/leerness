'use strict';
// T-0334: `task export` then `task sync --from` the same file must change nothing. Sync mapped every TodoWrite status
// back to one tracker status and rewrote any row that differed, so a round trip turned dropped into planned
// (resurrecting the task), requested and on-hold into planned, and blocked and incomplete into in-progress. Export
// and sync now share one mapping, and export (--to, --json) records each row's ID and status as a baseline: sync
// applies only what TodoWrite changed against it (cancelled now maps back to dropped), reports rows both sides changed
// differently and request texts it cannot match to one row, writes neither, and keeps the baseline current (also for a
// change both sides made alike). A row renamed in the tracker is found by its recorded ID instead of coming back as a
// new row; an item that may be more than one row (a reused text, two texts for one row) is not written; a row the
// baseline did not hold joins it when synced; a baseline from another folder is not read. A failed export leaves the
// baseline as it was. Without a baseline it
// compares with what the row's current status exports to. The bugfix done gate still holds a completion. Rows are
// made through the product; legacy words only by editing their cell.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
// A filter must name something: a missing value or one that selects no test is a failure, not "0/0 passed".
// Checked before any temporary folder exists, so this exit leaves nothing behind.
if (process.argv.includes('--match') && !filter) { console.error('--match needs a test name substring'); process.exit(1); }
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-task-sync-roundtrip-'));
const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
  LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_BANNER: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_SKILL_HISTORY: '1' };
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
const fresh = () => { const dir = path.join(arena, 'p' + (++copies)); require('../lib/copy-tree').copyTreeSync(seed(), dir); return dir; };
const runIn = (cwd, args) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
const show = r => `exit ${r.status}\n${String(r.stdout || '').slice(0, 1500)}${String(r.stderr || '').slice(0, 600)}`;
const jsonOf = (r, label) => { const out = String(r.stdout || ''); try { return JSON.parse(out.slice(out.indexOf('{'))); } catch { throw new Error(label + ': no JSON — ' + show(r)); } };
const tracker = dir => path.join(dir, '.leerness', 'progress-tracker.md');
const statusOf = (dir, id) => { const m = fs.readFileSync(tracker(dir), 'utf8').match(new RegExp('^\\| ' + id + ' \\| ([^|]*?) \\|', 'm')); return m ? m[1] : null; };
const addTask = (dir, title) => { const r = runIn(dir, ['task', 'add', title, '--path', dir, '--json']); const j = jsonOf(r, 'task add'); assert.ok(j.ok && j.id, show(r)); return j.id; };
const setStatus = (dir, id, status) => { const r = runIn(dir, ['task', 'update', id, '--status', status, '--evidence', 'checked', '--path', dir]); assert.strictEqual(r.status, 0, 'task update ' + status + ' ' + show(r)); };
const setCell = (dir, id, from, to) => {
  const md = fs.readFileSync(tracker(dir), 'utf8');
  assert.strictEqual(md.split(`| ${id} | ${from} |`).length, 2, `one ${from} row for ${id}`);
  fs.writeFileSync(tracker(dir), md.replace(`| ${id} | ${from} |`, `| ${id} | ${to} |`));
};
// One row per status: the ones task update writes, and three older or hand-written words (two read as done).
const STATUSES = ['requested', 'planned', 'in-progress', 'waiting', 'on-hold', 'blocked', 'incomplete', 'done', 'dropped'];
const LEGACY = ['완료', 'verified', '[진행]'];
const everyStatus = dir => {
  const ids = {};
  for (const s of STATUSES) { const id = addTask(dir, 'row ' + s); if (s !== 'requested') setStatus(dir, id, s); ids[s] = id; }
  for (const w of LEGACY) { const id = addTask(dir, 'row ' + w); setStatus(dir, id, 'done'); setCell(dir, id, 'done', w); ids[w] = id; }
  return ids;
};
const exportTo = dir => { const file = path.join(dir, 'todo.json'); const r = runIn(dir, ['task', 'export', '--to', file, '--path', dir]); assert.strictEqual(r.status, 0, 'export ' + show(r)); return file; };
const sync = (dir, file) => runIn(dir, ['task', 'sync', '--from', file, '--path', dir, '--json']);

test('an export and a sync of the same file change nothing', () => {
  const P = fresh();
  const ids = everyStatus(P);
  const file = exportTo(P);
  const todos = JSON.parse(fs.readFileSync(file, 'utf8'));
  const exported = Object.fromEntries(Object.keys(ids).map(w => [w, todos.find(t => t.content === 'row ' + w).status]));
  assert.deepStrictEqual(exported, { requested: 'pending', planned: 'pending', 'in-progress': 'in_progress', waiting: 'pending', 'on-hold': 'pending',
    blocked: 'in_progress', incomplete: 'in_progress', done: 'completed', dropped: 'cancelled', '완료': 'completed', verified: 'completed', '[진행]': 'pending' });
  const before = fs.readFileSync(tracker(P), 'utf8');
  const r = sync(P, file);
  const j = jsonOf(r, 'sync');
  assert.deepStrictEqual([r.status, j.imported, j.updated], [0, 0, 0], show(r));
  assert.strictEqual(fs.readFileSync(tracker(P), 'utf8'), before, 'the round trip changed the tracker');
});

test('what TodoWrite changed is applied, and nothing else', () => {
  const P = fresh();
  const ids = everyStatus(P);
  const file = exportTo(P);
  const todos = JSON.parse(fs.readFileSync(file, 'utf8'));
  const change = { planned: 'in_progress', requested: 'completed', dropped: 'pending', 'on-hold': 'cancelled', 'in-progress': 'pending' };
  for (const t of todos) { const w = t.content.slice(4); if (change[w]) t.status = change[w]; }
  fs.writeFileSync(file, JSON.stringify(todos, null, 2) + '\n');
  const r = sync(P, file);
  const j = jsonOf(r, 'sync');
  assert.deepStrictEqual([r.status, j.imported, j.updated], [0, 0, 5], show(r));
  const got = Object.fromEntries(Object.keys(ids).map(w => [w, statusOf(P, ids[w])]));
  assert.deepStrictEqual(got, { requested: 'done', planned: 'in-progress', 'in-progress': 'planned', waiting: 'waiting', 'on-hold': 'dropped',
    blocked: 'blocked', incomplete: 'incomplete', done: 'done', dropped: 'planned', '완료': '완료', verified: 'verified', '[진행]': '[진행]' });
});

test('new items are imported with the status they hold', () => {
  const P = fresh();
  const file = path.join(P, 'new.json');
  const items = [['new completed', 'completed', 'done'], ['new in progress', 'in_progress', 'in-progress'], ['new pending', 'pending', 'planned'],
    ['new cancelled', 'cancelled', 'dropped'], ['new unknown', 'someday', 'planned']];
  fs.writeFileSync(file, JSON.stringify(items.map(([content, status]) => ({ content, status, activeForm: content })), null, 2) + '\n');
  const r = sync(P, file);
  const j = jsonOf(r, 'sync');
  assert.deepStrictEqual([r.status, j.imported, j.updated], [0, 5, 0], show(r));
  const md = fs.readFileSync(tracker(P), 'utf8');
  const got = items.map(([content]) => { const m = md.match(new RegExp('^\\| T-\\d+ \\| ([^|]*?) \\| ' + content + ' \\|', 'm')); return [content, m && m[1]]; });
  assert.deepStrictEqual(got, items.map(([content, , want]) => [content, want]));
});

test('the bugfix done gate still holds a completion sync applies, and a round trip does not reach it', () => {
  const P = fresh();
  assert.strictEqual(runIn(P, ['toggle', 'set', 'bugfix-receipt', 'on', '--path', P]).status, 0, 'toggle set');
  fs.mkdirSync(path.join(P, 'src'), { recursive: true });
  fs.writeFileSync(path.join(P, 'src', 'app.js'), 'console.log("BUG_HERE"); process.exit(3);\n');
  const id = addTask(P, 'fix order status');
  const s = runIn(P, ['bugfix', 'start', id, '--repro', 'node src/app.js', '--expect-bad', 'BUG_HERE', '--path', P, '--json']);
  assert.strictEqual(jsonOf(s, 'bugfix start').ok, true, show(s));
  const file = exportTo(P);
  const before = fs.readFileSync(tracker(P), 'utf8');
  const round = sync(P, file);
  assert.deepStrictEqual([round.status, jsonOf(round, 'sync').updated], [0, 0], show(round));
  const todos = JSON.parse(fs.readFileSync(file, 'utf8'));
  todos.find(t => t.content === 'fix order status').status = 'completed';
  fs.writeFileSync(file, JSON.stringify(todos, null, 2) + '\n');
  const done = sync(P, file);
  assert.deepStrictEqual([done.status, jsonOf(done, 'sync').code], [1, 'bugfix_blocked'], show(done));
  assert.strictEqual(fs.readFileSync(tracker(P), 'utf8'), before, 'a held completion changed the tracker');
  // Held again on the next sync: a held completion does not move the baseline.
  const again = sync(P, file);
  assert.deepStrictEqual([again.status, jsonOf(again, 'sync').code], [1, 'bugfix_blocked'], show(again));
});

// Review round 1: the baseline, not the row's current status, says what TodoWrite last saw.
const baselineFile = dir => path.join(dir, '.leerness', 'cache', 'task-export-baseline.json');
const setTodo = (file, content, status) => { const todos = JSON.parse(fs.readFileSync(file, 'utf8')); const t = todos.find(x => x.content === content); assert.ok(t, content); t.status = status; fs.writeFileSync(file, JSON.stringify(todos, null, 2) + '\n'); };

test('a tracker edit after the export is kept, and a change on both sides is reported, not applied', () => {
  const P = fresh();
  const ids = everyStatus(P);
  const file = exportTo(P);
  assert.ok(fs.existsSync(baselineFile(P)), 'export left no baseline');
  setStatus(P, ids.planned, 'blocked');        // tracker only: TodoWrite still says pending
  setStatus(P, ids.requested, 'on-hold');      // both: TodoWrite changes it as well
  setTodo(file, 'row requested', 'in_progress');
  const r = sync(P, file);
  const j = jsonOf(r, 'sync');
  assert.deepStrictEqual([r.status, j.ok, j.updated, j.conflicts], [1, false, 0,
    [{ id: ids.requested, request: 'row requested', trackerWas: 'requested', trackerNow: 'on-hold', todoWas: 'pending', todoNow: 'in_progress' }]], show(r));
  assert.deepStrictEqual([statusOf(P, ids.planned), statusOf(P, ids.requested)], ['blocked', 'on-hold']);
  // The text output names the conflict (an English project).
  const t = runIn(P, ['task', 'sync', '--from', file, '--path', P]);
  assert.ok(t.status === 1 && t.stdout.includes(ids.requested + ' row requested — tracker requested → on-hold · TodoWrite pending → in_progress'), show(t));
});

test('a change both sides made alike is not a conflict: nothing is written and the baseline moves', () => {
  const P = fresh();
  const ids = everyStatus(P);
  const file = exportTo(P);
  setStatus(P, ids.planned, 'done');               // the same change on both sides
  setTodo(file, 'row planned', 'completed');
  setStatus(P, ids.requested, 'blocked');          // blocked exports as in_progress: TodoWrite holds what the tracker says
  setTodo(file, 'row requested', 'in_progress');
  const before = fs.readFileSync(tracker(P), 'utf8');
  const r = sync(P, file);
  const j = jsonOf(r, 'sync');
  assert.deepStrictEqual([r.status, j.ok, j.updated, j.conflicts], [0, true, 0, []], show(r));
  assert.strictEqual(fs.readFileSync(tracker(P), 'utf8'), before, 'an agreeing change was written');
  const items = JSON.parse(fs.readFileSync(baselineFile(P), 'utf8')).items;
  assert.deepStrictEqual([ids.planned, ids.requested].map(id => { const b = items.find(x => x.id === id); return b && [b.status, b.todo]; }), [['done', 'completed'], ['blocked', 'in_progress']]);
  // From the moved baseline, TodoWrite's next change applies (an unmoved one would read pending as unchanged).
  setTodo(file, 'row requested', 'pending');
  const next = sync(P, file);
  assert.deepStrictEqual([next.status, jsonOf(next, 'sync').updated, statusOf(P, ids.requested)], [0, 1, 'planned'], show(next));
});

test('an export whose file cannot be written leaves the baseline as it was', () => {
  const P = fresh();
  const ids = everyStatus(P);
  exportTo(P);
  const before = fs.readFileSync(baselineFile(P));
  setStatus(P, ids.planned, 'done');
  // package.json is a file, so no folder can be made under it.
  const r = runIn(P, ['task', 'export', '--to', path.join(P, 'package.json', 'todo.json'), '--path', P]);
  assert.notStrictEqual(r.status, 0, show(r));
  assert.ok(fs.readFileSync(baselineFile(P)).equals(before), 'a failed export moved the baseline');
});

test('a second sync of the same changed file changes nothing and reports nothing', () => {
  const P = fresh();
  const ids = everyStatus(P);
  const file = exportTo(P);
  setTodo(file, 'row planned', 'in_progress');
  setTodo(file, 'row dropped', 'pending');
  const first = sync(P, file);
  assert.deepStrictEqual([first.status, jsonOf(first, 'sync').updated], [0, 2], show(first));
  const before = fs.readFileSync(tracker(P), 'utf8');
  const second = sync(P, file);
  const j = jsonOf(second, 'sync');
  assert.deepStrictEqual([second.status, j.ok, j.updated, j.conflicts, j.ambiguous], [0, true, 0, [], []], show(second));
  assert.strictEqual(fs.readFileSync(tracker(P), 'utf8'), before);
  assert.deepStrictEqual([statusOf(P, ids.planned), statusOf(P, ids.dropped)], ['in-progress', 'planned']);
});

test('request texts that match more than one row or item: unchanged ones stay quiet, changed ones are reported and not applied', () => {
  const P = fresh();
  const A = addTask(P, 'same text'); setStatus(P, A, 'dropped');
  const B = addTask(P, 'same text');
  const file = exportTo(P);
  const before = fs.readFileSync(tracker(P), 'utf8');
  const quiet = sync(P, file);
  assert.deepStrictEqual([quiet.status, jsonOf(quiet, 'sync').ambiguous, jsonOf(quiet, 'sync').updated], [0, [], 0], show(quiet));
  const todos = JSON.parse(fs.readFileSync(file, 'utf8'));
  todos.filter(x => x.content === 'same text')[1].status = 'completed';
  fs.writeFileSync(file, JSON.stringify(todos, null, 2) + '\n');
  const r = sync(P, file);
  const j = jsonOf(r, 'sync');
  assert.deepStrictEqual([r.status, j.ok, j.updated, j.ambiguous], [1, false, 0, [{ request: 'same text', ids: [A, B], items: 2 }]], show(r));
  assert.strictEqual(fs.readFileSync(tracker(P), 'utf8'), before, 'an ambiguous change was written');
  // One row, the same text twice in the file with different statuses: also not applied.
  const Q = fresh();
  const C = addTask(Q, 'one row');
  const two = path.join(Q, 'two.json');
  fs.writeFileSync(two, JSON.stringify([{ content: 'one row', status: 'completed', activeForm: 'x' }, { content: 'one row', status: 'pending', activeForm: 'x' }]) + '\n');
  const q = sync(Q, two);
  assert.deepStrictEqual([q.status, jsonOf(q, 'sync').ambiguous, statusOf(Q, C)], [1, [{ request: 'one row', ids: [C], items: 2 }], 'requested'], show(q));
  // A new text twice in the file: nothing is imported.
  const fresh2 = path.join(Q, 'fresh2.json');
  fs.writeFileSync(fresh2, JSON.stringify([{ content: 'twice new', status: 'pending', activeForm: 'x' }, { content: 'twice new', status: 'pending', activeForm: 'x' }]) + '\n');
  const w = sync(Q, fresh2);
  assert.deepStrictEqual([w.status, jsonOf(w, 'sync').imported, jsonOf(w, 'sync').ambiguous], [1, 0, [{ request: 'twice new', ids: [], items: 2 }]], show(w));
});

// Review round 2: rows the baseline did not hold, request texts reused after a rename, and a baseline from elsewhere.
test('a row the baseline did not hold joins it when synced, so a later tracker edit is kept', () => {
  const P = fresh();
  const ids = everyStatus(P);
  const file = exportTo(P);
  const B = addTask(P, 'added after the export');
  const rename = (id, text) => { const r = runIn(P, ['task', 'update', id, '--note', text, '--path', P]); assert.strictEqual(r.status, 0, 'rename ' + show(r)); };
  // TodoWrite follows two renames: the items carry the rows' new texts and new statuses. The planned row was also
  // changed in the tracker since the export, so its item is a conflict, found through the row's recorded ID.
  rename(ids.planned, 'row planned, renamed');
  rename(ids['in-progress'], 'row in-progress, renamed');
  setStatus(P, ids.planned, 'on-hold');
  const todos = JSON.parse(fs.readFileSync(file, 'utf8'));
  todos.push({ content: 'added after the export', status: 'in_progress', activeForm: 'x' });
  Object.assign(todos.find(t => t.content === 'row planned'), { content: 'row planned, renamed', status: 'in_progress' });
  Object.assign(todos.find(t => t.content === 'row in-progress'), { content: 'row in-progress, renamed', status: 'pending' });
  fs.writeFileSync(file, JSON.stringify(todos, null, 2) + '\n');
  const first = sync(P, file);
  const j1 = jsonOf(first, 'sync');
  assert.deepStrictEqual([first.status, j1.updated, j1.conflicts.map(c => c.id), statusOf(P, B), statusOf(P, ids.planned), statusOf(P, ids['in-progress'])],
    [1, 2, [ids.planned], 'in-progress', 'on-hold', 'planned'], show(first));
  // Tracker edits after that sync, to statuses that export differently from the file; the same file again keeps them.
  setStatus(P, B, 'on-hold');
  setStatus(P, ids['in-progress'], 'blocked');
  const again = sync(P, file);
  const j = jsonOf(again, 'sync');
  assert.deepStrictEqual([j.updated, j.conflicts.map(c => c.id), statusOf(P, B), statusOf(P, ids['in-progress'])], [0, [ids.planned], 'on-hold', 'blocked'], show(again));
});

test('a request text reused after a rename is not given to the new row', () => {
  const P = fresh();
  const A = addTask(P, 'old text');
  const file = exportTo(P);
  const rn = runIn(P, ['task', 'update', A, '--note', 'old text, renamed', '--path', P]);
  assert.strictEqual(rn.status, 0, 'rename ' + show(rn));
  const B = addTask(P, 'old text');
  setStatus(P, B, 'blocked');
  const before = fs.readFileSync(tracker(P), 'utf8');
  // The untouched export: quiet, and neither row changes.
  const quiet = sync(P, file);
  assert.deepStrictEqual([quiet.status, jsonOf(quiet, 'sync').updated, jsonOf(quiet, 'sync').ambiguous], [0, 0, []], show(quiet));
  assert.strictEqual(fs.readFileSync(tracker(P), 'utf8'), before);
  // A change under the reused text: which row it means is unknown, so it is reported and nothing is written.
  setTodo(file, 'old text', 'completed');
  const r = sync(P, file);
  assert.deepStrictEqual([r.status, jsonOf(r, 'sync').updated, jsonOf(r, 'sync').ambiguous], [1, 0, [{ request: 'old text', ids: [A, B], items: 1 }]], show(r));
  assert.strictEqual(fs.readFileSync(tracker(P), 'utf8'), before, 'a change under a reused text was written');
});

test('a baseline copied from another project is not read', () => {
  const P1 = fresh(), P2 = fresh();
  const foreign = addTask(P1, 'foreign request');
  exportTo(P1);
  const local = addTask(P2, 'local task');
  assert.strictEqual(foreign, local, 'the two first tasks should share an ID for this test');
  fs.mkdirSync(path.dirname(baselineFile(P2)), { recursive: true });
  fs.copyFileSync(baselineFile(P1), baselineFile(P2));
  const copied = fs.readFileSync(baselineFile(P2));
  const file = path.join(P2, 'todo.json');
  fs.writeFileSync(file, JSON.stringify([{ content: 'foreign request', status: 'completed', activeForm: 'x' }]) + '\n');
  const r = sync(P2, file);
  // Without a baseline the item is new here (imported, as before T-0334); the local task with the same ID is untouched.
  assert.deepStrictEqual([r.status, jsonOf(r, 'sync').updated, jsonOf(r, 'sync').imported, statusOf(P2, local)], [0, 0, 1, 'requested'], show(r));
  assert.ok(fs.readFileSync(baselineFile(P2)).equals(copied), 'sync rewrote a baseline it did not read');
});

// Review round 3: a row changed while sync waits on a completion probe, and a text acknowledged after a rename.
test('a row changed while sync waits on a completion probe is not overwritten', () => {
  const P = fresh();
  assert.strictEqual(runIn(P, ['toggle', 'set', 'bugfix-receipt', 'on', '--path', P]).status, 0, 'toggle set');
  const A = addTask(P, 'fix A'), B = addTask(P, 'task B'), C = addTask(P, 'fix C'), E = addTask(P, 'task E');
  // Each probe prints BUG_HERE while a "buggy" marker exists; armed, it makes its edits once, while sync waits on it
  // (the gate runs outside the tracker lock): A's probe changes B (on-hold) and E (in-progress, what E's item says),
  // C's and D's probes change their own rows.
  const probe = (name, edits) => {
    const file = path.join(P, name + '.js');
    fs.writeFileSync(file, [
      "const fs = require('fs'), cp = require('child_process'), path = require('path');",
      "if (fs.existsSync(path.join(__dirname, 'buggy'))) { console.log('BUG_HERE'); process.exit(3); }",
      "const armed = path.join(__dirname, " + JSON.stringify(name + '.armed') + ");",
      "if (fs.existsSync(armed)) { fs.unlinkSync(armed); for (const [id, status] of " + JSON.stringify(edits) + ") cp.spawnSync(process.execPath, [" + JSON.stringify(CLI) + ", 'task', 'update', id, '--status', status, '--evidence', 'edited during sync', '--path', __dirname], { stdio: 'ignore', env: process.env }); }",
      "console.log('fine');",
    ].join('\n'));
    return 'node ' + name + '.js';
  };
  const file = exportTo(P);
  // D comes after the export, so the baseline does not hold it (the round-1 rule decides, and the same check applies).
  const D = addTask(P, 'fix D');
  fs.writeFileSync(path.join(P, 'buggy'), '');
  for (const [id, cmd] of [[A, probe('probe-a', [[B, 'on-hold'], [E, 'in-progress']])], [C, probe('probe-c', [[C, 'on-hold']])], [D, probe('probe-d', [[D, 'on-hold']])]]) {
    const s = runIn(P, ['bugfix', 'start', id, '--repro', cmd, '--expect-bad', 'BUG_HERE', '--path', P, '--json']);
    assert.strictEqual(jsonOf(s, 'bugfix start').ok, true, show(s));
  }
  fs.unlinkSync(path.join(P, 'buggy'));
  for (const id of [A, C, D]) { const r = runIn(P, ['bugfix', 'receipt', id, '--root-cause', 'missing mapping', '--siblings', 'none', '--path', P, '--json']); assert.strictEqual(r.status, 0, 'receipt ' + show(r)); }
  const todos = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [content, status] of [['fix A', 'completed'], ['task B', 'in_progress'], ['fix C', 'completed'], ['task E', 'in_progress']]) todos.find(t => t.content === content).status = status;
  todos.push({ content: 'fix D', status: 'completed', activeForm: 'x' });
  fs.writeFileSync(file, JSON.stringify(todos, null, 2) + '\n');
  for (const name of ['probe-a', 'probe-c', 'probe-d']) fs.writeFileSync(path.join(P, name + '.armed'), '');
  const r = sync(P, file);
  const j = jsonOf(r, 'sync');
  assert.ok(['probe-a', 'probe-c', 'probe-d'].every(name => !fs.existsSync(path.join(P, name + '.armed'))), 'a probe did not run during sync');
  // A completes. B and E, changed during A's probe, are read again: B is kept and reported, E already holds what its
  // item says (no conflict, nothing written). C and D, each changed during its own probe, are checked under the
  // tracker lock and kept.
  assert.deepStrictEqual([r.status, j.updated, j.conflicts.map(c => [c.id, c.trackerNow]), statusOf(P, A), statusOf(P, B), statusOf(P, C), statusOf(P, D), statusOf(P, E)],
    [1, 1, [[B, 'on-hold'], [C, 'on-hold'], [D, 'on-hold']], 'done', 'on-hold', 'on-hold', 'on-hold', 'in-progress'], show(r));
});

test('a text acknowledged after a rename stays that row\'s, so a later row reusing it does not get its item', () => {
  const P = fresh();
  const A = addTask(P, 'old');
  setStatus(P, A, 'planned');
  const file = exportTo(P);
  const rename = text => { const r = runIn(P, ['task', 'update', A, '--note', text, '--path', P]); assert.strictEqual(r.status, 0, 'rename ' + show(r)); };
  rename('middle');
  const todos = JSON.parse(fs.readFileSync(file, 'utf8'));
  todos.find(t => t.content === 'old').content = 'middle';      // TodoWrite follows the rename, status unchanged
  fs.writeFileSync(file, JSON.stringify(todos, null, 2) + '\n');
  const ack = sync(P, file);
  assert.deepStrictEqual([ack.status, jsonOf(ack, 'sync').updated], [0, 0], show(ack));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(baselineFile(P), 'utf8')).items.find(x => x.id === A).aliases, ['middle']);
  rename('latest');
  const B = addTask(P, 'middle');
  setStatus(P, B, 'blocked');
  const before = fs.readFileSync(tracker(P), 'utf8');
  const quiet = sync(P, file);
  assert.deepStrictEqual([quiet.status, jsonOf(quiet, 'sync').updated, jsonOf(quiet, 'sync').ambiguous], [0, 0, []], show(quiet));
  assert.strictEqual(fs.readFileSync(tracker(P), 'utf8'), before, 'the reused text went to the new row');
  setTodo(file, 'middle', 'completed');
  const r = sync(P, file);
  assert.deepStrictEqual([r.status, jsonOf(r, 'sync').updated, jsonOf(r, 'sync').ambiguous], [1, 0, [{ request: 'middle', ids: [A, B], items: 1 }]], show(r));
  assert.strictEqual(fs.readFileSync(tracker(P), 'utf8'), before);
});

test('without a baseline the current status decides, as in the first rule', () => {
  const P = fresh();
  const ids = everyStatus(P);
  const file = exportTo(P);
  fs.rmSync(baselineFile(P));
  const before = fs.readFileSync(tracker(P), 'utf8');
  const round = sync(P, file);
  assert.deepStrictEqual([round.status, jsonOf(round, 'sync').updated], [0, 0], show(round));
  assert.strictEqual(fs.readFileSync(tracker(P), 'utf8'), before);
  assert.ok(!fs.existsSync(baselineFile(P)), 'sync made a baseline');
  setTodo(file, 'row on-hold', 'cancelled');
  const r = sync(P, file);
  assert.deepStrictEqual([r.status, jsonOf(r, 'sync').updated, statusOf(P, ids['on-hold'])], [0, 1, 'dropped'], show(r));
});

test('a damaged baseline is ignored, and the current status decides', () => {
  const P = fresh();
  const ids = everyStatus(P);
  const file = exportTo(P);
  const before = fs.readFileSync(tracker(P), 'utf8');
  // Each one is wrong in one way only: it carries this project's root, which export recorded. The last item, if it were
  // read, would say TodoWrite last saw in_progress, and sync would report a conflict.
  const root = JSON.parse(fs.readFileSync(baselineFile(P), 'utf8')).root;
  assert.ok(typeof root === 'string' && root.length > 0, 'export recorded no root');
  for (const damaged of ['{ not json', JSON.stringify({ schema: 2, root, items: [] }), JSON.stringify({ schema: 1, root, items: [{ id: ids.planned, request: 'row planned', status: 7, todo: 'in_progress' }] }),
    JSON.stringify({ schema: 1, root, items: [{ id: ids.planned, request: 'row planned', status: 'planned', todo: 'in_progress', aliases: 'row planned' }] })]) {
    fs.writeFileSync(baselineFile(P), damaged);
    const r = sync(P, file);
    assert.deepStrictEqual([r.status, jsonOf(r, 'sync').updated, jsonOf(r, 'sync').conflicts], [0, 0, []], damaged + ': ' + show(r));
    assert.strictEqual(fs.readFileSync(tracker(P), 'utf8'), before, damaged);
    assert.strictEqual(fs.readFileSync(baselineFile(P), 'utf8'), damaged, 'sync rewrote a damaged baseline');
  }
});

test('items sync imports join the baseline, so a second sync of the file changes nothing', () => {
  const P = fresh();
  addTask(P, 'existing row');
  const file = exportTo(P);
  const todos = JSON.parse(fs.readFileSync(file, 'utf8'));
  todos.push({ content: 'brand new', status: 'cancelled', activeForm: 'x' });
  fs.writeFileSync(file, JSON.stringify(todos, null, 2) + '\n');
  const first = sync(P, file);
  assert.deepStrictEqual([first.status, jsonOf(first, 'sync').imported], [0, 1], show(first));
  const base = JSON.parse(fs.readFileSync(baselineFile(P), 'utf8'));
  assert.ok(base.items.some(x => x.request === 'brand new' && x.status === 'dropped' && x.todo === 'cancelled'), JSON.stringify(base.items));
  const before = fs.readFileSync(tracker(P), 'utf8');
  const second = sync(P, file);
  assert.deepStrictEqual([second.status, jsonOf(second, 'sync').imported, jsonOf(second, 'sync').updated], [0, 0, 0], show(second));
  assert.strictEqual(fs.readFileSync(tracker(P), 'utf8'), before);
});

test('a row renamed in the tracker after the export is still that row, not a new one', () => {
  const P = fresh();
  const ids = everyStatus(P);
  const file = exportTo(P);
  const rename = (id, text) => { const r = runIn(P, ['task', 'update', id, '--note', text, '--path', P]); assert.strictEqual(r.status, 0, 'rename ' + show(r)); };
  rename(ids.done, 'row done, renamed');
  rename(ids.planned, 'row planned, renamed');
  const before = fs.readFileSync(tracker(P), 'utf8');
  const quiet = sync(P, file);
  const j = jsonOf(quiet, 'sync');
  assert.deepStrictEqual([quiet.status, j.imported, j.updated, j.conflicts, j.ambiguous], [0, 0, 0, [], []], show(quiet));
  assert.strictEqual(fs.readFileSync(tracker(P), 'utf8'), before, 'a renamed row came back as a new one');
  // TodoWrite's change under the old text lands on the renamed row.
  setTodo(file, 'row planned', 'in_progress');
  const moved = sync(P, file);
  assert.deepStrictEqual([moved.status, jsonOf(moved, 'sync').imported, jsonOf(moved, 'sync').updated, statusOf(P, ids.planned)], [0, 0, 1, 'in-progress'], show(moved));
  // The new text in the file too: quiet while the old item is unchanged, reported and not written once it changes.
  const todos = JSON.parse(fs.readFileSync(file, 'utf8'));
  todos.push({ content: 'row done, renamed', status: 'completed', activeForm: 'x' });
  fs.writeFileSync(file, JSON.stringify(todos, null, 2) + '\n');
  const both = sync(P, file);
  assert.deepStrictEqual([both.status, jsonOf(both, 'sync').imported, jsonOf(both, 'sync').ambiguous], [0, 0, []], show(both));
  setTodo(file, 'row done', 'pending');
  const after = fs.readFileSync(tracker(P), 'utf8');
  const r = sync(P, file);
  assert.deepStrictEqual([r.status, jsonOf(r, 'sync').ambiguous], [1, [{ request: 'row done', ids: [ids.done], items: 1 }]], show(r));
  assert.strictEqual(fs.readFileSync(tracker(P), 'utf8'), after, 'an item that may not be the row was written');
});

test('hand-written statuses named like object keys export as pending and survive a round trip', () => {
  // Review round 1: a plain object's inherited keys (constructor, toString, __proto__) were read as mappings.
  const P = fresh();
  const words = ['constructor', 'toString', '__proto__', 'hasOwnProperty'];
  const ids = words.map(w => { const id = addTask(P, 'odd ' + w); setStatus(P, id, 'done'); setCell(P, id, 'done', w); return id; });
  const file = exportTo(P);
  const todos = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(words.map(w => todos.find(t => t.content === 'odd ' + w).status), ['pending', 'pending', 'pending', 'pending']);
  const before = fs.readFileSync(tracker(P), 'utf8');
  const r = sync(P, file);
  assert.deepStrictEqual([r.status, jsonOf(r, 'sync').updated], [0, 0], show(r));
  assert.strictEqual(fs.readFileSync(tracker(P), 'utf8'), before);
  assert.deepStrictEqual(ids.map(id => statusOf(P, id)), words);
});

console.log(`task sync round trip: ${passed}/${passed + failed}`);
if (filter && !ran) console.error(`--match ${JSON.stringify(filter)} selected no test`);
try { removeTree(arena, { recursive: true, force: true }); } catch {}
if (failed || (filter ? ran === 0 : ran !== 19)) process.exitCode = 1;
