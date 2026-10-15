'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
// T-0330: past fixes at completion. `bugfix receipt --areas` declares the files or folders a fix is about;
// verify-claim then lists the bugfix receipts whose declared areas hold a file the task's evidence names: finished
// ones (their task is done, also in retained history) as past fixes with the root cause and the probe to re-run,
// the others apart as unfinished. It is advice: verify-claim's ok, reasons and exit stay as they were, and the probes
// are shown, not run. Areas are declared, never inferred (inferred hotspots were rejected in P-0005), so without a
// declared area nothing is printed. Every test works on its own copy of an initialized seed project.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), crypto = require('crypto');
const { removeTree } = require('./temp-cleanup');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
// A filter must name something: a missing value or one that selects no test is a failure, not "0/0 passed".
// Checked before any temporary folder exists, so this exit leaves nothing behind.
if (process.argv.includes('--match') && !filter) { console.error('--match needs a test name substring'); process.exit(1); }
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-bugfix-areas-'));
const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
  LEERNESS_NO_AUTOCHCP: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_SKILL_HISTORY: '1' };
for (const key of ['LEERNESS_LANG', 'LEERNESS_OLLAMA_BASE_URL', 'LEERNESS_ENFORCE_POLICY']) delete env[key];
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) { env[key] = path.join(arena, 'env-' + key.toLowerCase()); fs.mkdirSync(env[key]); }
// Normal CLI settings: what a user's shell runs (usage bookkeeping on).
const normalEnv = { ...env }; delete normalEnv.LEERNESS_INTERNAL;
let passed = 0, failed = 0;
const test =(name, fn) => { if (filter && !name.includes(filter)) return; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };

const BS = String.fromCharCode(92), TAB = String.fromCharCode(9);
const HANGUL = new RegExp('[' + String.fromCharCode(0xAC00) + '-' + String.fromCharCode(0xD7A3) + ']');
const REPRO = 'node -e "console.log(\'BADSIG\');process.exit(1)"';
const SOURCES = ['src/orders.js', 'src/sync/a.js', 'src/syncer.js', 'lib/other.js', 'docs/notes.md'];
const seeds = {};
const seed = lang => {
  if (seeds[lang]) return seeds[lang];
  const dir = path.join(arena, 'seed-' + lang);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"proj","version":"0.1.0"}\n');
  const r = cp.spawnSync(process.execPath, [CLI, 'init', dir, '--yes', '--language', lang, '--no-mcp'], { cwd: dir, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
  assert.strictEqual(r.status, 0, 'init ' + lang + ' exit ' + r.status + '\n' + r.stdout + r.stderr);
  for (const rel of SOURCES) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), rel.endsWith('.md') ? '# notes\n' : 'module.exports = function work(x) { return x + 1; };\n');
  }
  return (seeds[lang] = dir);
};
let copies = 0;
const fresh = (lang = 'ko') => { const dir = path.join(arena, 'p' + (++copies)); require('../lib/copy-tree').copyTreeSync(seed(lang), dir); return dir; };
const runIn = (cwd, args, runEnv = env) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 300000, windowsHide: true, env: runEnv });
const show = r => `exit ${r.status}\n${String(r.stdout || '').slice(0, 1200)}${String(r.stderr || '').slice(0, 600)}`;
const json = (r, label) => { const out = String(r.stdout || ''); try { return JSON.parse(out.slice(out.indexOf('{'))); } catch { throw new Error(label + ': not JSON — ' + show(r)); } };
const storeFile = dir => path.join(dir, '.leerness', 'bugfix-receipts.json');
const storeBytes = dir => { try { return fs.readFileSync(storeFile(dir), 'utf8'); } catch { return null; } };
const entry = (dir, id) => JSON.parse(storeBytes(dir)).find(e => e.id === id);
const addTask = (dir, title) => { const r = runIn(dir, ['task', 'add', title, '--path', dir, '--json']); const j = json(r, 'task add'); assert.ok(j.ok && j.id, show(r)); return j.id; };
const startFix = (dir, id) => { const r = runIn(dir, ['bugfix', 'start', id, '--repro', REPRO, '--expect-bad', 'BADSIG', '--path', dir, '--json']); assert.strictEqual(json(r, 'bugfix start').ok, true, 'bugfix start ' + show(r)); return r; };
const receipt = (dir, id, ...flags) => runIn(dir, ['bugfix', 'receipt', id, ...flags, '--path', dir]);
const okReceipt = (dir, id, ...flags) => { const r = receipt(dir, id, ...flags, '--json'); assert.strictEqual(json(r, 'receipt').ok, true, show(r)); return json(r, 'receipt'); };
// A fix with a receipt; areas only when given.
const fix = (dir, title, rootCause, areas) => { const id = addTask(dir, title); startFix(dir, id); okReceipt(dir, id, '--root-cause', rootCause, '--siblings-na', 'one site', ...(areas ? ['--areas', areas] : [])); return id; };
const setStatus = (dir, id, status, evidence) => { const r = runIn(dir, ['task', 'update', id, '--status', status, ...(evidence ? ['--evidence', evidence] : []), '--path', dir]); assert.strictEqual(r.status, 0, 'task update ' + show(r)); };
const claimJson = (dir, id) => { const r = runIn(dir, ['verify-claim', id, '--path', dir, '--json']); return { r, j: json(r, 'verify-claim ' + id) }; };
const claimText = (dir, id) => runIn(dir, ['verify-claim', id, '--path', dir]);
const verdict = (dir, id) => { const { r, j } = claimJson(dir, id); return { exit: r.status, ok: j.ok, reasons: j.reasons, verdict: j.verdict, textExit: claimText(dir, id).status }; };
// The lines of an advice block, from its header to its last indented line (empty when there is no block).
const block = (out, header) => { const ls = String(out || '').split(/\r?\n/); const i = ls.findIndex(l => l.includes(header)); if (i < 0) return []; const e = ls.findIndex((l, k) => k > i && !/^ {5}/.test(l)); return ls.slice(i, e < 0 ? ls.length : e); };
const KO_PAST = '📚 지난 수정에서 배운 것', EN_PAST = '📚 Learned from past fixes', KO_OPEN = '🔧 done 이 확인되지 않은 bugfix', EN_OPEN = '🔧 Bugfixes not known to be done';
// Made through the product, then only the status cell of that row edited: older trackers and `--force` updates can
// hold words `task update` no longer writes.
const setStatusCell = (dir, id, from, to) => {
  const tracker = path.join(dir, '.leerness', 'progress-tracker.md');
  const md = fs.readFileSync(tracker, 'utf8');
  assert.strictEqual(md.split(`| ${id} | ${from} |`).length, 2, `one ${from} row for ${id}`);
  fs.writeFileSync(tracker, md.replace(`| ${id} | ${from} |`, `| ${id} | ${to} |`));
};
const files = dir => { const out = {}; const walk = rel => { for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) { const r = rel ? rel + '/' + d.name : d.name; if (d.isDirectory()) walk(r); else out[r] = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, r))).digest('hex'); } }; walk(''); return out; };

const bugfix = require('../lib/bugfix');

test('an area is a repository-relative file or folder, written one way', () => {
  const norm = s => bugfix._normalizeArea(s);
  for (const [raw, area] of [['src/orders.js', 'src/orders.js'], ['./src/sync/', 'src/sync'], ['.' + BS + 'src' + BS + 'orders.js', 'src/orders.js'], ['  lib  ', 'lib'], ['src/sync//', 'src/sync']]) {
    assert.deepStrictEqual(norm(raw), { area, problem: null }, JSON.stringify(raw));
  }
  for (const [raw, problem] of [['', 'empty'], ['.', 'empty'], ['./', 'empty'], ['/etc/x', 'absolute'], ['C:' + BS + 'x', 'absolute'], ['c:x', 'absolute'], [BS + BS + 'srv' + BS + 'x', 'absolute'],
    ['../x', 'not-normal'], ['src/../x', 'not-normal'], ['src/./x', 'not-normal'], ['a//b', 'not-normal'], ['..', 'not-normal'], ['src/a' + TAB + 'b', 'control'], ['src/a' + String.fromCharCode(0x85) + 'b', 'control']]) {
    assert.strictEqual(norm(raw).problem, problem, JSON.stringify(raw) + ' -> ' + JSON.stringify(norm(raw)));
  }
});

test('receipt --areas stores each area once, normalized, echoes it, and bugfix list shows it', () => {
  const P = fresh();
  const A = fix(P, 'order status fix', 'status map missing');
  const j = okReceipt(P, A, '--areas', '.' + BS + 'src' + BS + 'orders.js, src/sync/ ,src/orders.js');
  assert.deepStrictEqual([j.areas, j.missingAreas], [['src/orders.js', 'src/sync'], []]);
  assert.deepStrictEqual(entry(P, A).areas, ['src/orders.js', 'src/sync']);
  assert.strictEqual(entry(P, A).rootCause, 'status map missing', 'earlier receipt fields stay');
  const D = addTask(P, 'second fix'); startFix(P, D);
  assert.deepStrictEqual(okReceipt(P, D, '--root-cause', 'folder level cause', '--siblings-na', 'one caller', '--areas=src').areas, ['src'], '--areas=value form');
  const list = json(runIn(P, ['bugfix', 'list', '--path', P, '--json']), 'list');
  assert.deepStrictEqual(list.receipts.map(x => [x.id, x.areas]).sort(), [[A, ['src/orders.js', 'src/sync']], [D, ['src']]]);
  // The Korean list line keeps its earlier bytes, with the areas column appended.
  const text = runIn(P, ['bugfix', 'list', '--path', P]).stdout.split(/\r?\n/);
  assert.ok(text.includes(`  ${A}  probe=${REPRO.slice(0, 50)}  근본원인=기록됨  형제범위=기록됨  영역=src/orders.js,src/sync`), text.join('\n'));
  assert.ok(text.includes(`  ${D}  probe=${REPRO.slice(0, 50)}  근본원인=기록됨  형제범위=기록됨  영역=src`), text.join('\n'));
});

test('blank or unusable areas are refused and the receipt is left as it was, other fields included', () => {
  const P = fresh();
  const A = fix(P, 'order status fix', 'status map missing', 'src/orders.js');
  const was = storeBytes(P);
  for (const [value, code] of [[' ', 'empty_areas'], ['', 'empty_areas'], [',', 'empty_areas'], [' , ', 'empty_areas'], ['/abs/x', 'invalid_area'], ['C:' + BS + 'x', 'invalid_area'], ['../x', 'invalid_area'],
    ['src/../x', 'invalid_area'], ['.', 'invalid_area'], ['a//b', 'invalid_area'], ['src/a' + TAB + 'b', 'invalid_area'], ['src/orders.js,../x', 'invalid_area']]) {
    const r = receipt(P, A, '--root-cause', 'changed cause', '--areas', value, '--json');
    assert.ok(r.status === 1 && json(r, JSON.stringify(value)).code === code, JSON.stringify(value) + ' ' + show(r));
    assert.strictEqual(storeBytes(P), was, JSON.stringify(value) + ' changed the receipt');
  }
  const human = receipt(P, A, '--areas', '../x');
  assert.ok(human.status === 1 && /\.\.\/x/.test(human.stdout + human.stderr), show(human));
});

test('whitespace around an area, tabs and line breaks included, is trimmed before the checks', () => {
  // Control characters inside a path are refused (above); around it they are input whitespace, as for other values.
  const P = fresh();
  const T = addTask(P, 'trim area'); startFix(P, T);
  assert.deepStrictEqual(okReceipt(P, T, '--areas', TAB + 'src/orders.js' + String.fromCharCode(10) + ', ' + TAB + 'lib' + TAB).areas, ['src/orders.js', 'lib']);
});

test('with normal CLI settings a refused receipt changes nothing outside .leerness/cache, where the usage counter moves', () => {
  const P = fresh();
  const A = fix(P, 'order status fix', 'status map missing');
  const before = files(P);
  const r = runIn(P, ['bugfix', 'receipt', A, '--root-cause', 'changed cause', '--areas', '../x', '--path', P, '--json'], normalEnv);
  assert.ok(r.status === 1 && json(r, 'normal settings').code === 'invalid_area', show(r));
  const after = files(P);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(f => before[f] !== after[f]).sort();
  assert.deepStrictEqual(changed.filter(f => !f.startsWith('.leerness/cache/')), [], 'files outside the runtime cache changed');
  assert.ok(changed.includes('.leerness/cache/usage-stats.json'), 'control: normal settings bump the usage counter, so this ran as a user runs it; changed: ' + changed.join(', '));
});

test('an area that does not exist is saved as written, with a warning', () => {
  const P = fresh();
  const T = addTask(P, 'typo area'); startFix(P, T);
  const j = okReceipt(P, T, '--areas', 'src/ordrs.js,src');
  assert.deepStrictEqual([j.areas, j.missingAreas], [['src/ordrs.js', 'src'], ['src/ordrs.js']]);
  const text = receipt(P, T, '--areas', 'src/ordrs.js');
  assert.ok(text.status === 0 && /src\/ordrs\.js/.test(text.stdout + text.stderr) && /지금 없는 경로/.test(text.stdout + text.stderr), show(text));
});

test('verify-claim shows finished fixes as past fixes and unfinished ones apart, newest first, by path segment', () => {
  const P = fresh();
  const A = fix(P, 'order status fix', 'status map missing', 'src/orders.js,src/sync');
  const D = fix(P, 'second fix in src', 'folder level cause', 'src');
  const O = fix(P, 'open fix in sync', 'open cause', 'src/sync');
  setStatus(P, A, 'done', 'fixed src/orders.js'); setStatus(P, D, 'done', 'fixed src/orders.js'); setStatus(P, O, 'in-progress');
  setStatusCell(P, D, 'done', 'verified');   // an older row; done too
  const B = addTask(P, 'later sync change'); setStatus(P, B, 'in-progress', 'changed src/sync/a.js and src/syncer.js and lib/other.js');
  const { j } = claimJson(P, B);
  assert.strictEqual(j.pastFixes.advisory, true);
  assert.deepStrictEqual(j.pastFixes.fixes.map(f => [f.id, f.files, f.taskStatus, f.status, f.rootCause, f.repro]), [
    [O, ['src/sync/a.js'], 'open', 'in-progress', 'open cause', REPRO],
    [D, ['src/sync/a.js', 'src/syncer.js'], 'done', 'verified', 'folder level cause', REPRO],
    [A, ['src/sync/a.js'], 'done', 'done', 'status map missing', REPRO],   // src/syncer.js is not inside src/sync
  ]);
  const out = claimText(P, B).stdout;
  const past = block(out, KO_PAST).join('\n'), open = block(out, KO_OPEN).join('\n');
  assert.ok(past.includes('권고, 게이트 아님') && past.includes('exit 0'), past);
  // Done is a tracker status, not proof that the probe passes: the line says so (round 2) and claims no fix.
  assert.ok(past.includes('task 가 done — exit 0 인지 확인') && !past.includes('고쳐진'), past);
  for (const s of [A, D, 'status map missing', 'folder level cause', REPRO, 'src/sync/a.js']) assert.ok(past.includes(s), s + ' missing:\n' + past);
  assert.ok(past.indexOf(D) < past.indexOf(A), 'newest first:\n' + past);
  assert.ok(!past.includes(O) && !past.includes('open cause'), 'an unfinished fix is not a past fix:\n' + past);
  assert.ok(open.includes(O) && open.includes('open cause') && open.includes('in-progress') && !open.includes('exit 0'), open);
});

test('a finished fix kept in retained history still counts, and a receipt whose task is gone is unfinished', () => {
  const P = fresh();
  const A = fix(P, 'order status fix', 'status map missing', 'src/orders.js');
  setStatus(P, A, 'done', 'fixed src/orders.js');
  const pv = json(runIn(P, ['context', 'history', 'preview', '--tasks', A, '--path', P, '--json']), 'history preview');
  assert.ok(pv.ok && pv.expected, JSON.stringify(pv));
  assert.strictEqual(json(runIn(P, ['context', 'history', 'apply', '--tasks', A, '--expect', pv.expected, '--path', P, '--json']), 'history apply').ok, true);
  assert.ok(!fs.readFileSync(path.join(P, '.leerness', 'progress-tracker.md'), 'utf8').includes('| ' + A + ' |'), 'the row left the active tracker');
  const list = JSON.parse(storeBytes(P));
  fs.writeFileSync(storeFile(P), JSON.stringify([...list, { ...list[0], id: 'T-9999', rootCause: 'orphan cause' }], null, 2) + '\n');
  const B = addTask(P, 'later order change'); setStatus(P, B, 'in-progress', 'changed src/orders.js');
  assert.deepStrictEqual(claimJson(P, B).j.pastFixes.fixes.map(f => [f.id, f.taskStatus, f.status]), [['T-9999', 'unknown', null], [A, 'done', 'done']]);
  const out = claimText(P, B).stdout;
  assert.ok(block(out, KO_PAST).join('\n').includes(A), out);
  const open = block(out, KO_OPEN).join('\n');
  assert.ok(open.includes('T-9999') && open.includes('tracker 에 task 없음'), out);
});

test('status words are read exactly: unverified, not-done, 미완료 and [미완료] are not done; completed, 완료 and [완료] are', () => {
  const P = fresh();
  // T-0332: one predicate with verify-claim, which reads the older bracketed form too.
  const rows = [['unverified', 'open'], ['not-done', 'open'], ['미완료', 'open'], ['[미완료]', 'open'], ['completed', 'done'], ['완료', 'done'], ['[완료]', 'done']].map(([word, expected], i) => {
    const id = fix(P, 'fix ' + i, 'cause ' + i, 'src/orders.js');
    setStatus(P, id, 'done', 'fixed src/orders.js');
    setStatusCell(P, id, 'done', word);
    return [id, word, expected];
  });
  const B = addTask(P, 'later order change'); setStatus(P, B, 'in-progress', 'changed src/orders.js');
  const got = claimJson(P, B).j.pastFixes.fixes.map(f => [f.id, f.status, f.taskStatus]).sort();
  assert.deepStrictEqual(got, rows.map(([id, word, expected]) => [id, word, expected]).sort());
  const out = claimText(P, B).stdout;
  const past = block(out, KO_PAST).join('\n'), open = block(out, KO_OPEN).join('\n');
  for (const [id, , expected] of rows) assert.ok((expected === 'done' ? past : open).includes(id) && !(expected === 'done' ? open : past).includes(id), id + ' in the wrong block:\n' + out);
});

test('a retained fix whose history cannot be read is shown as status unknown, not as missing from the tracker', () => {
  const P = fresh();
  const A = fix(P, 'order status fix', 'status map missing', 'src/orders.js');
  setStatus(P, A, 'done', 'fixed src/orders.js');
  const pv = json(runIn(P, ['context', 'history', 'preview', '--tasks', A, '--path', P, '--json']), 'history preview');
  const ap = json(runIn(P, ['context', 'history', 'apply', '--tasks', A, '--expect', pv.expected, '--path', P, '--json']), 'history apply');
  assert.ok(ap.ok && ap.operationId, JSON.stringify(ap));
  const B = addTask(P, 'later order change'); setStatus(P, B, 'in-progress', 'changed src/orders.js');
  assert.deepStrictEqual(claimJson(P, B).j.pastFixes.fixes.map(f => [f.id, f.taskStatus]), [[A, 'done']], 'control: readable history');
  fs.appendFileSync(path.join(P, '.leerness', 'archive', 'history', ap.operationId, 'progress-before.md'), '\n');   // the retained source changed
  const { r, j } = claimJson(P, B);
  assert.strictEqual(r.status, 0, 'verify-claim of another task still runs');
  assert.deepStrictEqual(j.pastFixes.fixes.map(f => [f.id, f.taskStatus, f.statusNote, f.statusError]), [[A, 'unknown', 'history-unreadable', 'history_source_changed']]);
  const open = block(claimText(P, B).stdout, KO_OPEN).join('\n');
  assert.ok(open.includes(A) && open.includes('보관 이력을 읽지 못함') && !open.includes('tracker 에 task 없음'), open);
});

test('the advice never changes the verdict, the reasons or the exit code, passing or failing', () => {
  const P = fresh();
  const F = fix(P, 'order status fix', 'status map missing');
  setStatus(P, F, 'done', 'fixed src/orders.js');
  const pass = addTask(P, 'passing claim'); setStatus(P, pass, 'in-progress', 'changed src/orders.js');
  const fail = addTask(P, 'failing claim'); setStatus(P, fail, 'in-progress', 'changed src/orders.js and src/missing.js');
  const before = { pass: verdict(P, pass), fail: verdict(P, fail) };
  assert.ok(before.pass.exit === 0 && before.pass.textExit === 0 && before.pass.ok === true && before.pass.reasons.length === 0, 'control: the passing claim passes ' + JSON.stringify(before.pass));
  assert.ok(before.fail.exit === 1 && before.fail.ok === false, 'control: the failing claim fails ' + JSON.stringify(before.fail));
  for (const id of [pass, fail]) assert.deepStrictEqual(claimJson(P, id).j.pastFixes.fixes, [], 'no advice before the areas');
  okReceipt(P, F, '--areas', 'src');
  for (const id of [pass, fail]) assert.deepStrictEqual(claimJson(P, id).j.pastFixes.fixes.map(f => f.id), [F], 'advice after the areas');
  assert.deepStrictEqual({ pass: verdict(P, pass), fail: verdict(P, fail) }, before);
});

test('no advice for the task\'s own fix, for files outside every area, or without declared areas', () => {
  const P = fresh();
  const A = fix(P, 'order status fix', 'status map missing');
  const D = fix(P, 'second fix in src', 'folder level cause');
  setStatus(P, A, 'done', 'fixed src/orders.js'); setStatus(P, D, 'done', 'fixed src/orders.js');
  const C = addTask(P, 'docs only change'); setStatus(P, C, 'in-progress', 'changed docs/notes.md');
  // Receipts without areas: silence.
  assert.deepStrictEqual(claimJson(P, A).j.pastFixes, { advisory: true, readable: true, fixes: [], skipped: [] });
  assert.deepStrictEqual(block(claimText(P, A).stdout, KO_PAST), []);
  okReceipt(P, A, '--areas', 'src/orders.js'); okReceipt(P, D, '--areas', 'src');
  assert.deepStrictEqual(claimJson(P, A).j.pastFixes.fixes.map(f => f.id), [D], 'A is left out; D (area src) holds src/orders.js');
  assert.deepStrictEqual(claimJson(P, C).j.pastFixes.fixes, []);
  const out = claimText(P, C).stdout;
  assert.deepStrictEqual([block(out, KO_PAST), block(out, KO_OPEN)], [[], []]);
});

test('a malformed area skips that receipt only: the store stays valid and the skip is reported', () => {
  const P = fresh();
  const A = fix(P, 'order status fix', 'status map missing', 'src/sync');
  const D = fix(P, 'second fix in src', 'folder level cause', 'src');
  const B = addTask(P, 'later sync change'); setStatus(P, B, 'in-progress', 'changed src/sync/a.js');
  const list = JSON.parse(storeBytes(P));
  list.find(e => e.id === D).areas = 'src';   // hand-edited into a string
  fs.writeFileSync(storeFile(P), JSON.stringify(list, null, 2) + '\n');
  assert.strictEqual(json(runIn(P, ['bugfix', 'list', '--path', P, '--json']), 'list').invalid, false, 'an advisory field must not invalidate the store (the done gate reads it)');
  assert.ok(runIn(P, ['bugfix', 'list', '--path', P]).stdout.includes('영역=(형식 오류)'));
  const { j } = claimJson(P, B);
  assert.deepStrictEqual([j.pastFixes.fixes.map(f => f.id), j.pastFixes.skipped], [[A], [D]]);
  const out = claimText(P, B).stdout;
  assert.ok(out.includes('영역 형식이 잘못된 bugfix 영수증 1건') && out.includes(D), out);
});

test('an unreadable store is reported only when the evidence names files, and changes nothing else', () => {
  const P = fresh();
  fix(P, 'order status fix', 'status map missing', 'src');
  const B = addTask(P, 'later change'); setStatus(P, B, 'in-progress', 'changed src/orders.js');
  const N = addTask(P, 'no files named'); setStatus(P, N, 'in-progress', 'talked it through, nothing changed');
  const was = verdict(P, B);
  fs.writeFileSync(storeFile(P), '<<<<<<< HEAD\n[]\n');
  const { r, j } = claimJson(P, B);
  assert.deepStrictEqual(j.pastFixes, { advisory: true, readable: false, fixes: [], skipped: [] });
  assert.deepStrictEqual({ exit: r.status, ok: j.ok, reasons: j.reasons }, { exit: was.exit, ok: was.ok, reasons: was.reasons });
  const t = claimText(P, B);
  assert.ok(t.stdout.includes('bugfix-receipts.json 형상 무효') && t.status === was.textExit, show(t));
  const none = claimText(P, N);
  assert.ok(!none.stdout.includes('bugfix-receipts.json'), show(none));
});

test('lookup: segment match, numeric order, relative paths only, case on case-insensitive systems', () => {
  const P = fresh();
  const A = fix(P, 'order status fix', 'status map missing', 'src/sync');
  const a = entry(P, A);
  fs.writeFileSync(storeFile(P), JSON.stringify([{ ...a, id: 'T-999' }, { ...a, id: 'T-1000' }], null, 2) + '\n');
  const ids = list => bugfix.fixesForFiles(P, list, null).fixes.map(f => f.id);
  assert.deepStrictEqual(ids(['src/sync/a.js']), ['T-1000', 'T-999'], 'numeric, newest first');
  assert.deepStrictEqual(ids(['src/sync']), ['T-1000', 'T-999'], 'the area itself');
  assert.deepStrictEqual(ids(['src/syncer.js', 'src/sync.js', 'src']), [], 'no prefix match across a segment');
  assert.deepStrictEqual(ids(['.' + BS + 'src' + BS + 'sync' + BS + 'a.js']), ['T-1000', 'T-999'], 'backslashes and ./');
  assert.deepStrictEqual(ids([path.join(P, 'src', 'sync', 'a.js'), '../src/sync/a.js', '..']), [], 'absolute and outside paths are not compared');
  const folded = process.platform === 'win32' || process.platform === 'darwin';
  assert.deepStrictEqual(ids(['SRC/Sync/a.js']), folded ? ['T-1000', 'T-999'] : [], 'case');
  assert.deepStrictEqual(bugfix.fixesForFiles(P, ['src/sync/a.js'], 'T-1000').fixes.map(f => f.id), ['T-999'], 'excluded id');
  assert.deepStrictEqual(bugfix.fixesForFiles(P, [], null), { readable: true, fixes: [], skipped: [] });
});

test('bugfix start points to --areas', () => {
  const P = fresh();
  const T = addTask(P, 'hint check');
  const r = runIn(P, ['bugfix', 'start', T, '--repro', REPRO, '--expect-bad', 'BADSIG', '--path', P]);
  assert.ok(r.status === 0 && r.stdout.includes(`leerness bugfix receipt ${T}`) && r.stdout.includes('--areas'), show(r));
});

test('English projects get the advice and the receipt messages in English', () => {
  const E = fresh('en');
  const F = addTask(E, 'fix'); startFix(E, F);
  for (const value of ['../x', ',', ' ']) {
    const bad = receipt(E, F, '--areas', value, '--json');
    assert.ok(bad.status === 1 && !HANGUL.test(json(bad, 'en ' + JSON.stringify(value)).error || ''), show(bad));
  }
  const ok = receipt(E, F, '--root-cause', 'wrong mapping', '--siblings-na', 'one site', '--areas', 'src/nope.js,src');
  const okLines = (ok.stdout + ok.stderr).split(/\r?\n/).filter(l => l.trim());
  assert.ok(ok.status === 0 && okLines.length === 4 && okLines.every(l => !HANGUL.test(l)), show(ok));
  assert.ok(okLines[0].includes('bugfix receipt updated: ' + F) && okLines.some(l => l.includes('Paths that do not exist now: src/nope.js')), show(ok));
  const listed = runIn(E, ['bugfix', 'list', '--path', E]).stdout.split(/\r?\n/);
  assert.ok(listed.includes(`  ${F}  probe=${REPRO.slice(0, 50)}  root-cause=recorded  siblings=recorded  areas=src/nope.js,src`), listed.join('\n'));
  const O = addTask(E, 'open fix'); startFix(E, O); okReceipt(E, O, '--root-cause', 'open mapping', '--siblings-na', 'one site', '--areas', 'src');
  setStatus(E, F, 'done', 'fixed src/orders.js');
  const G = addTask(E, 'later'); setStatus(E, G, 'in-progress', 'changed src/orders.js');
  const out = claimText(E, G).stdout;
  const past = block(out, EN_PAST), open = block(out, EN_OPEN);
  assert.ok(past.length >= 4 && past.join('\n').includes('wrong mapping') && past.join('\n').includes('task marked done — check that it exits 0') && !past.join('\n').includes('fixed, so'), out);
  assert.ok(open.length >= 2 && open.join('\n').includes('open mapping'), out);
  assert.deepStrictEqual([...past, ...open].filter(l => HANGUL.test(l)), [], 'no Korean in the English blocks');
});

console.log(`Tests: ${passed}/${passed + failed} passed`);
if (filter && passed + failed === 0) console.error(`--match ${JSON.stringify(filter)} selected no test`);
try { removeTree(arena, { recursive: true, force: true }); } catch {}
process.exitCode = failed || passed + failed === 0 ? 1 : 0;
