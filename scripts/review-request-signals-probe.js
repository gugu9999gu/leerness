'use strict';
require('./temp-cleanup').trackTemp(module);  
 
 
 
 
 
 
 
 
 
 
 
 
 
 
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
 
const json = (r, label) => { const out = must(r, label); try { return JSON.parse(out); } catch (e) { throw new Error(label + ': stdout is not one JSON object\n' + out.slice(0, 800)); } };
 
 
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
   
  fs.appendFileSync(store(dir, 'task-log.md'), '\n- ✗ sketchpad preview fail again\n');
  const three = json(review(dir, 'sketchpad', '--json'), 'three --json');
  assert.deepStrictEqual([three.conflicts.length, three.proceed, three.proceedReason], [3, false, CRITICAL]);
});

test('failure lessons are listed as past context under their title and are not counted', () => {
  const dir = project();
   
  fs.appendFileSync(store(dir, 'review-evidence.md'), '\n## \n- ✗ sketchpad export failed without a heading\n');
  for (const n of [1, 2, 3]) fs.appendFileSync(store(dir, 'review-evidence.md'), `\n## 2026-09-30 — sketchpad export check ${n}\n- ✗ sketchpad export failed on Windows (${n})\n`);
  const j = json(review(dir, 'sketchpad', '--json'), 'sketchpad --json');
  const titles = [1, 2, 3].map(n => '2026-09-30 — sketchpad export check ' + n);
  assert.deepStrictEqual(j.lessonsRecall.map(l => [l.kind, l.title]), ['', ...titles].map(t => ['lesson', t]));
   
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
   
  assert.deepStrictEqual([j.conflicts.length, j.proceed, j.proceedReason], [1, true, SAFE]);
  const text = must(review(dir, 'sketchpad milestone'), 'milestone text');
  assert.deepStrictEqual(section(text, '📋'), ['  - [milestone] ' + active + ': sketchpad milestone']);
  assert.ok(section(text, '💡').some(l => l.includes('📋 진행 중 milestone 1건과 영역 겹침 가능')), text);
});

test('done milestones listed first do not hide an in-progress one', () => {
  const dir = project();
  for (const n of [1, 2, 3]) planAdd(dir, 'atlas done ' + n, 'done');
  const active = planAdd(dir, 'atlas active', 'in-progress');
   
  const j = json(review(dir, 'atlas', '--json'), 'atlas --json');
  assert.deepStrictEqual(j.planConflicts.map(m => [m.id, m.title]), [[active, 'atlas active']]);
});

test('brainstorm output over 1 MiB is still read, so three conflicts still stop proceed', () => {
   
   
  const dir = project();
  for (const n of [1, 2, 3]) must(run(dir, ['task', 'add', 'atlas pipeline ' + n, '--status', 'in-progress', '--no-review', '--path', dir]), 'task add');
  let blocks = '';
  for (let i = 1; i <= 8000; i++) blocks += '\n### M-' + (10000 + i) + '. atlas\nStatus: done\n';
  fs.appendFileSync(store(dir, 'plan.md'), blocks);
  const j = json(review(dir, 'atlas', '--json'), 'atlas --json');
  assert.deepStrictEqual([j.conflicts.map(c => c.kind), j.proceed], [['task-in-progress', 'task-in-progress', 'task-in-progress'], false]);
});

test('a feature-graph heading with a long run of spaces does not stall review-request', () => {
   
   
  const dir = project();
  fs.appendFileSync(store(dir, 'feature-graph.md'), '\n## F-0001 atlas' + ' '.repeat(300000) + 'exporter\n- files: lib/atlas.js\n');
  const t0 = Date.now();
  const j = json(review(dir, 'atlas', '--json'), 'atlas --json');
  const ms = Date.now() - t0;
  assert.deepStrictEqual(j.featureConflicts.map(f => [f.id, f.title]), [['F-0001', 'atlas exporter']]);
  assert.ok(ms < 40000, 'review-request took ' + ms + ' ms');
});

test('a feature-graph node that shares a request word is reported and does not decide proceed', () => {
   
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
   
  fs.appendFileSync(store(dir, 'reuse-map.md'), [
    '', '', '| 재사용 기능 | 위치 |', '| --- | --- |', '| 스케치패드 미리보기 | lib/preview.js |',             
    '', '| Atlas header | Where |', '--- | ---', '| Atlas exporter | lib/atlas.js |', '| - | - |',    
    '', '| Beacon header | Where |', '|---|---', '| Beacon relay | lib/beacon.js |', '',               
    '# Comet | Inventory', '| Comet header | Where |', '| --- | --- |', '| Comet exporter | lib/comet.js |', '',   
    '| Delta header | Where |', '| --- | --- |', 'placeholder', '| Delta exporter | lib/delta.js |', '| - | - |', '',  
  ].join('\n'));
  const caps = request => json(review(dir, request, '--json'), request + ' --json').reuseCandidates.map(r => r.capability);
   
  assert.deepStrictEqual(caps('use sketchpad'), ['Sketchpad exporter']);
  assert.deepStrictEqual(caps('재사용 스케치패드'), ['스케치패드 미리보기']);
   
  assert.deepStrictEqual(caps('atlas'), ['Atlas exporter']);
  assert.deepStrictEqual(caps('beacon'), ['Beacon relay']);
   
  assert.deepStrictEqual(caps('comet'), ['Comet exporter']);
  assert.deepStrictEqual(caps('delta'), ['Delta exporter']);
});

console.log(`Tests: ${passed}/${passed + failed} passed`);
try { removeTree(arena, { recursive: true, force: true }); } catch {}
process.exitCode = failed ? 1 : 0;
