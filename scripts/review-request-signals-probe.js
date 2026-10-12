'use strict';
// T-0322: review-request read brainstorm fields that brainstorm never emits. Failure lessons ({ title, line }) were read
// as text/preview and printed as a blank "[lesson]" line; task-log failures ({ title, line }) printed a blank
// "[task-log-failure]" line; in-progress task rows (which carry request, not title) printed only their id; milestones
// carried no status, so an overlapping in-progress milestone was never reported. The reuse-map scan also returned the
// table header row as a candidate whenever a request word was part of it ("use" in "Reuse Method").
// The owner chose to fix what is shown and keep the verdict (2026-09-30): failure lessons stay past context and an
// in-progress milestone is reported but not counted, so proceed is decided by the same conflicts as before.
// The cross-model review (gpt-6.1-sol) added four reproduced cases: done milestones listed first hid an active one, a
// delimiter row without outer pipes, a "| - | - |" body row that made the row above it look like a header, and an
// empty evidence heading printed as "undefined". The same sweep found the feature graph read from a file nobody writes
// (feature_graph.md, "### " blocks), so no feature overlap was ever reported. The second review added three: the new
// milestone status field could push brainstorm's JSON past the 1 MiB spawn buffer (silently losing every signal), a pipe
// in the line above a table or a body row without pipes confused the table boundary, and the feature scan exposed the
// shared heading pattern's quadratic time on a long run of spaces.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
const CLI = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-review-request-signals-'));
const controlled = { LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
  LEERNESS_NO_AUTOCHCP: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1' };
const env = { ...process.env };
const ignored = Object.keys(env).filter(k => /^LEERNESS_/i.test(k) && !(k in controlled));
for (const k of ignored) delete env[k];
Object.assign(env, controlled);
if (ignored.length) console.log('ignoring ambient ' + ignored.join(', '));
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) { env[key] = path.join(arena, 'env-' + key.toLowerCase()); fs.mkdirSync(env[key]); }
let seq = 0, passed = 0, failed = 0;
const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
const test = (name, fn) => { if (filter && !name.includes(filter)) return; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };
const run = (dir, args) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
const must = (r, label) => { assert.ifError(r.error); assert.strictEqual(r.status, 0, label + ' exit ' + r.status + '\n' + r.stdout + r.stderr); return r.stdout; };
// --json must print one JSON object and nothing else.
const json = (r, label) => { const out = must(r, label); try { return JSON.parse(out); } catch (e) { throw new Error(label + ': stdout is not one JSON object\n' + out.slice(0, 800)); } };
// init takes most of the run time, so it runs once; each test works on its own copy of that project. The installed
// skills are removed: they come from whichever skill catalog the host resolves and would add reuse candidates.
let template = null;
const project = () => {
  if (!template) {
    template = path.join(arena, 'template'); fs.mkdirSync(template);
    fs.writeFileSync(path.join(template, 'package.json'), '{"name":"proj","version":"0.1.0"}\n');
    must(run(template, ['init', template, '--yes', '--language', 'ko', '--no-setup-agents', '--no-mcp']), 'init');
    fs.rmSync(path.join(template, '.leerness', 'skills'), { recursive: true, force: true });
    fs.mkdirSync(path.join(template, '.leerness', 'skills'));
  }
  const dir = path.join(arena, 'p' + (++seq));
  require('../lib/copy-tree').copyTreeSync(template, dir);
  return dir;
};
const store = (dir, name) => path.join(dir, '.leerness', name);
const review = (dir, request, ...flags) => run(dir, ['review-request', request, ...flags, '--path', dir]);
const planAdd = (dir, title, status) => { const m = must(run(dir, ['plan', 'add', title, '--status', status, '--path', dir]), 'plan add ' + title).match(/M-\d{4,}/); assert.ok(m, 'no milestone id'); return m[0]; };
const lines = text => String(text).split(/\r?\n/).map(l => l.trimEnd());
// The lines of one "## <icon> ..." section, up to the blank line that closes it.
const section = (text, icon) => {
  const all = lines(text), start = all.findIndex(l => l.startsWith('## ' + icon));
  assert.ok(start >= 0, 'section ' + icon + ' missing\n' + text);
  const out = [];
  for (const l of all.slice(start + 1)) { if (!l) break; out.push(l); }
  return out;
};
const SAFE = '안전 — 충돌 신호 < 3', CRITICAL = '⚠ 충돌 critical — 사용자 확인 후 진행';
const FAIL_LINE = '✗ sketchpad export fail on Windows (retry after the lock fix)';

test('in-progress tasks and task-log failures are shown with their text, and three conflicts still stop proceed', () => {
  const dir = project();
  const added = must(run(dir, ['task', 'add', 'sketchpad pipeline rewrite', '--status', 'in-progress', '--no-review', '--path', dir]), 'task add');
  const id = (added.match(/T-\d{4,}/) || [])[0];
  assert.ok(id, added);
  fs.appendFileSync(store(dir, 'task-log.md'), '\n- ' + FAIL_LINE + '\n');
  const j = json(review(dir, 'sketchpad', '--json'), 'sketchpad --json');
  assert.deepStrictEqual(j.conflicts.map(c => [c.kind, c.id || '', c.title || '', c.preview || '']),
    [['task-in-progress', id, 'sketchpad pipeline rewrite', ''], ['task-log-failure', '', '', FAIL_LINE]]);
  assert.deepStrictEqual([j.proceed, j.proceedReason], [true, SAFE]);
  const text = must(review(dir, 'sketchpad'), 'sketchpad text');
  assert.deepStrictEqual(section(text, '⚠'), ['  - [task-in-progress] ' + id + ' sketchpad pipeline rewrite', '  - [task-log-failure] ' + FAIL_LINE]);
  // The rule itself is unchanged: a third conflict still asks the user to confirm.
  fs.appendFileSync(store(dir, 'task-log.md'), '\n- ✗ sketchpad preview fail again\n');
  const three = json(review(dir, 'sketchpad', '--json'), 'three --json');
  assert.deepStrictEqual([three.conflicts.length, three.proceed, three.proceedReason], [3, false, CRITICAL]);
});

test('failure lessons are listed as past context under their title and are not counted', () => {
  const dir = project();
  // The first block has an empty heading: it has no title to show, and must not print "undefined".
  fs.appendFileSync(store(dir, 'review-evidence.md'), '\n## \n- ✗ sketchpad export failed without a heading\n');
  for (const n of [1, 2, 3]) fs.appendFileSync(store(dir, 'review-evidence.md'), `\n## 2026-09-30 — sketchpad export check ${n}\n- ✗ sketchpad export failed on Windows (${n})\n`);
  const j = json(review(dir, 'sketchpad', '--json'), 'sketchpad --json');
  const titles = [1, 2, 3].map(n => '2026-09-30 — sketchpad export check ' + n);
  assert.deepStrictEqual(j.lessonsRecall.map(l => [l.kind, l.title]), ['', ...titles].map(t => ['lesson', t]));
  // Four failure lessons would have stopped proceed if they counted as conflicts; the owner kept them as context.
  assert.deepStrictEqual([j.conflicts.length, j.proceed], [0, true]);
  const text = must(review(dir, 'sketchpad'), 'sketchpad text');
  assert.deepStrictEqual(section(text, '🧠'), ['  - [lesson]', ...titles.slice(0, 2).map(t => '  - [lesson] ' + t)]);
  assert.ok(!text.includes('undefined'), text);
});

test('an overlapping in-progress milestone is reported but does not decide proceed', () => {
  const dir = project();
  const active = planAdd(dir, 'sketchpad milestone', 'in-progress');
  planAdd(dir, 'sketchpad milestone archive', 'done');
  const j = json(review(dir, 'sketchpad milestone', '--json'), 'milestone --json');
  assert.deepStrictEqual(j.planConflicts.map(m => [m.kind, m.id, m.title]), [['milestone-in-progress', active, 'sketchpad milestone']]);
  // plan add also opens an in-progress task for the milestone: one conflict, so proceed stays true.
  assert.deepStrictEqual([j.conflicts.length, j.proceed, j.proceedReason], [1, true, SAFE]);
  const text = must(review(dir, 'sketchpad milestone'), 'milestone text');
  assert.deepStrictEqual(section(text, '📋'), ['  - [milestone] ' + active + ': sketchpad milestone']);
  assert.ok(section(text, '💡').some(l => l.includes('📋 진행 중 milestone 1건과 영역 겹침 가능')), text);
});

test('done milestones listed first do not hide an in-progress one', () => {
  const dir = project();
  for (const n of [1, 2, 3]) planAdd(dir, 'atlas done ' + n, 'done');
  const active = planAdd(dir, 'atlas active', 'in-progress');
  // Only the milestones are asserted: which tasks count as conflicts is part of the unchanged verdict.
  const j = json(review(dir, 'atlas', '--json'), 'atlas --json');
  assert.deepStrictEqual(j.planConflicts.map(m => [m.id, m.title]), [[active, 'atlas active']]);
});

test('brainstorm output over 1 MiB is still read, so three conflicts still stop proceed', () => {
  // 8,000 done milestones make brainstorm's JSON about 1.4 MB. With spawnSync's default 1 MiB buffer the output was cut,
  // JSON.parse failed silently, every signal was lost and proceed read true (second cross-model review, reproduced).
  const dir = project();
  for (const n of [1, 2, 3]) must(run(dir, ['task', 'add', 'atlas pipeline ' + n, '--status', 'in-progress', '--no-review', '--path', dir]), 'task add');
  let blocks = '';
  for (let i = 1; i <= 8000; i++) blocks += '\n### M-' + (10000 + i) + '. atlas\nStatus: done\n';
  fs.appendFileSync(store(dir, 'plan.md'), blocks);
  const j = json(review(dir, 'atlas', '--json'), 'atlas --json');
  assert.deepStrictEqual([j.conflicts.map(c => c.kind), j.proceed], [['task-in-progress', 'task-in-progress', 'task-in-progress'], false]);
});

test('a feature-graph heading with a long run of spaces does not stall review-request', () => {
  // The shared heading pattern is quadratic on a long whitespace run followed by text (1.5 s at 40,000 spaces); review-request
  // collapses such runs before parsing. Without that, this request took about 45 s at 200,000 spaces on the development machine.
  const dir = project();
  fs.appendFileSync(store(dir, 'feature-graph.md'), '\n## F-0001 atlas' + ' '.repeat(300000) + 'exporter\n- files: lib/atlas.js\n');
  const t0 = Date.now();
  const j = json(review(dir, 'atlas', '--json'), 'atlas --json');
  const ms = Date.now() - t0;
  assert.deepStrictEqual(j.featureConflicts.map(f => [f.id, f.title]), [['F-0001', 'atlas exporter']]);
  assert.ok(ms < 40000, 'review-request took ' + ms + ' ms');
});

test('a feature-graph node that shares a request word is reported and does not decide proceed', () => {
  // review-request read .leerness/feature_graph.md split on "### "; feature add writes feature-graph.md with "## F-XXXX".
  const dir = project();
  const out = must(run(dir, ['feature', 'add', 'Sketchpad exporter', '--path', dir]), 'feature add');
  const id = (out.match(/F-\d{4,}/) || [])[0];
  assert.ok(id, out);
  const j = json(review(dir, 'sketchpad exporter', '--json'), 'feature --json');
  assert.deepStrictEqual(j.featureConflicts.map(f => [f.kind, f.id, f.title]), [['feature', id, 'Sketchpad exporter']]);
  assert.deepStrictEqual([j.conflicts.length, j.proceed], [0, true]);
  const text = must(review(dir, 'sketchpad exporter'), 'feature text');
  assert.deepStrictEqual(section(text, '📋'), ['  - [feature] ' + id + ': Sketchpad exporter']);
  assert.ok(section(text, '💡').some(l => l.includes('Feature Graph 1건 영역 겹침')), text);
});

test('reuse-map table header rows are not candidates, whatever their language or pipes', () => {
  const dir = project();
  must(run(dir, ['reuse', 'register', 'Sketchpad exporter', '--where', 'lib/sketchpad.js', '--kind', 'helper', '--path', dir]), 'reuse register');
  // Each table starts after a blank line, as GFM requires (a row right under a table is a body row of that table).
  fs.appendFileSync(store(dir, 'reuse-map.md'), [
    '', '', '| 재사용 기능 | 위치 |', '| --- | --- |', '| 스케치패드 미리보기 | lib/preview.js |',            // Korean header, spaced delimiter
    '', '| Atlas header | Where |', '--- | ---', '| Atlas exporter | lib/atlas.js |', '| - | - |',   // delimiter without outer pipes; placeholder body row
    '', '| Beacon header | Where |', '|---|---', '| Beacon relay | lib/beacon.js |', '',              // delimiter without a trailing pipe
    '# Comet | Inventory', '| Comet header | Where |', '| --- | --- |', '| Comet exporter | lib/comet.js |', '',  // a heading with a pipe right above
    '| Delta header | Where |', '| --- | --- |', 'placeholder', '| Delta exporter | lib/delta.js |', '| - | - |', '', // a body row without pipes
  ].join('\n'));
  const caps = request => json(review(dir, request, '--json'), request + ' --json').reuseCandidates.map(r => r.capability);
  // "use" is part of the English template header ("Reuse Method"), "재사용" of the Korean one.
  assert.deepStrictEqual(caps('use sketchpad'), ['Sketchpad exporter']);
  assert.deepStrictEqual(caps('재사용 스케치패드'), ['스케치패드 미리보기']);
  // The row above "| - | - |" is data, not a header.
  assert.deepStrictEqual(caps('atlas'), ['Atlas exporter']);
  assert.deepStrictEqual(caps('beacon'), ['Beacon relay']);
  // The line above a header may contain a pipe, and a body row may have none (second cross-model review, reproduced).
  assert.deepStrictEqual(caps('comet'), ['Comet exporter']);
  assert.deepStrictEqual(caps('delta'), ['Delta exporter']);
});

console.log(`Tests: ${passed}/${passed + failed} passed`);
try { removeTree(arena, { recursive: true, force: true }); } catch {}
process.exitCode = failed ? 1 : 0;
