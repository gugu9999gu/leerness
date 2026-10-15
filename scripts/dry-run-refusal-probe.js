'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
// T-0339: commands whose edits need a state lock refuse --dry-run with the dry-run refusal. Under --dry-run the CLI
// takes no state lock (it would leave lock metadata), so lib/managed-text.js refused every edit with "Managed text
// requires its existing state lock" (E_TEXT_LOCK) before its first write could meet the dry-run guard (task add, drop
// and sync, plan add and remove, memory restore plan, register-pending, feature add), and `state start|record|verify|
// handoff` called itself through the lock wrapper until the stack ran out. Now the managed-text check refuses as the
// guard does (E_DRY_RUN_WRITE, which the CLI reports as dry_run_unsupported) and state runs as the lock wrapper does
// under --dry-run. Every case runs on its own copy of a prepared project and checks that no file changed; controls run
// the same commands without --dry-run.
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), crypto = require('crypto');
const { removeTree } = require('./temp-cleanup');
const CLI = path.resolve(__dirname, '../bin/leerness.js');

const directAt = process.argv.indexOf('--direct');
if (directAt >= 0) {
  // managed-text's lock check with and without the dry-run guard, outside the CLI.
  const dir = process.argv[directAt + 1], io = require('../lib/io'), mt = require('../lib/managed-text');
  const file = path.join(dir, 'managed.md');
  fs.writeFileSync(file, 'text\n');
  const observe = fn => { try { fn(); return null; } catch (e) { return { code: e.code, message: e.message }; } };
  const out = { unguarded: observe(() => mt.captureTextEdit(file)) };
  io.setDryRunGuard(true);
  out.guarded = observe(() => mt.captureTextEdit(file));
  io.setDryRunGuard(false);
  out.file = file;
  out.unchanged = fs.readFileSync(file, 'utf8') === 'text\n' && fs.readdirSync(dir).length === 1;
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

const filter = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] : '';
if (process.argv.includes('--match') && !filter) { console.error('--match needs a test name substring'); process.exit(1); }
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-dry-run-refusal-'));
const env = { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
  LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_BANNER: '1', LEERNESS_HOOK: '', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_SKILL_HISTORY: '1' };
for (const key of ['LEERNESS_LANG', 'LEERNESS_OLLAMA_BASE_URL', 'LEERNESS_ENFORCE_POLICY']) delete env[key];
for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) { env[key] = path.join(arena, 'env-' + key.toLowerCase()); fs.mkdirSync(env[key]); }
let passed = 0, failed = 0, ran = 0;
const test = (name, fn) => { if (filter && !name.includes(filter)) return; ran++; try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e && e.stack || e)); } };
const show = r => `exit ${r.status}\n${String(r.stdout || '').slice(-1200)}${String(r.stderr || '').slice(0, 600)}`;
const run = (args, cwd = arena) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 300000, windowsHide: true, env });
const succeed = (args, label) => { const r = run(args); assert.strictEqual(r.status, 0, (label || args.join(' ')) + ': ' + show(r)); return r; };

const REFUSAL = {
  en: f => `This command does not implement --dry-run — it stopped before writing ${f}. Nothing was changed (run it without --dry-run).`,
  ko: f => `이 명령은 --dry-run 을 구현하지 않았습니다 — ${f} 을(를) 쓰려다 멈췄습니다. 변경된 것은 없습니다(--dry-run 을 빼고 실행하세요).`,
};
const GUARD = { en: f => `--dry-run was given, but a write was attempted: ${f}`, ko: f => `--dry-run 인데 쓰려고 했습니다: ${f}` };

// A seed per language: one task row, one milestone, one archived milestone and a state run, made through the product.
const seeds = {};
const seed = lang => {
  if (seeds[lang]) return seeds[lang];
  const P = path.join(arena, 'seed-' + lang);
  fs.mkdirSync(P);
  fs.writeFileSync(path.join(P, 'package.json'), '{"name":"proj","version":"0.1.0"}\n');
  succeed(['init', P, '--yes', '--language', lang, '--no-mcp'], 'init ' + lang);
  for (const args of [['task', 'add', 'Probe task'], ['plan', 'add', 'Probe milestone'], ['plan', 'add', 'Archived milestone'],
    ['plan', 'remove', 'Archived milestone'], ['state', 'start', 'Probe goal']]) succeed([...args, '--path', P]);
  return (seeds[lang] = P);
};
let copies = 0;
// T-0343: the fixture folders have Korean names, and Node 22.23.3's fs.cpSync crashes on non-ASCII paths on Windows.
const { copyTreeSync } = require('../lib/copy-tree');
const fresh = lang => { const P = path.join(arena, 'p' + (++copies) + ' 한글'); copyTreeSync(seed(lang), P); return P; };
// Review round 1: the project's files with their modification times, its directory entries, and the redirected home,
// app data and temp folders the CLI could write to outside the project.
const snapshot = P => {
  const h = {};
  const walk = (root, d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name), key = path.relative(arena, p);
    if (e.isDirectory()) { h[key + '/'] = 'dir'; walk(root, p); } else h[key] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') + ' ' + fs.statSync(p).mtimeMs; } };
  walk(P, P);
  for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'TMPDIR']) walk(env[key], env[key]);
  return h;
};
const tracker = P => path.join(P, '.leerness', 'progress-tracker.md');
const taskId = P => { const r = succeed(['task', 'list', '--all', '--path', P, '--json']); return JSON.parse(r.stdout).tasks.find(t => t.request === 'Probe task').id; };
// [label, args after the project is made, the file the refusal names]
const CASES = P => [
  ['task add', ['task', 'add', 'Dry task'], tracker(P)],
  ['task drop', ['task', 'drop', taskId(P)], tracker(P)],
  ['task sync --from', ['task', 'sync', '--from', path.join(P, 'todo.json')], tracker(P)],
  ['plan add', ['plan', 'add', 'Dry milestone'], tracker(P)],
  ['plan remove', ['plan', 'remove', 'Probe milestone'], tracker(P)],
  ['memory restore plan', ['memory', 'restore', 'plan', 'Archived milestone'], path.join(P, '.leerness', 'plan.md')],
  ['register-pending', ['register-pending', 'Dry pending'], tracker(P)],
  ['state start', ['state', 'start', 'Dry goal'], path.join(P, '.leerness', 'runs', '_')],
  ['state record', ['state', 'record', '--files-changed', 'dry-file.js'], path.join(P, '.leerness', 'runs', '_')],
  ['state verify', ['state', 'verify', '--result', 'pass'], path.join(P, '.leerness', 'runs', '_')],
  ['state handoff', ['state', 'handoff', 'dry handoff'], path.join(P, '.leerness', 'runs', '_')],
];
const refused = (label, P, args, want) => {
  const before = snapshot(P), r = run([...args, '--path', P, '--dry-run', '--json']);
  let doc = null;
  try { doc = JSON.parse(r.stdout); } catch {}
  assert.deepStrictEqual([r.status, doc], [1, want], `${label}: ${show(r)}`);
  assert.deepStrictEqual(snapshot(P), before, `${label}: a file changed under --dry-run`);
};

test('direct: managed text refuses an unlocked edit as the dry-run guard does under --dry-run, and with E_TEXT_LOCK otherwise', () => {
  const dir = fs.mkdtempSync(path.join(arena, 'direct-'));
  const r = cp.spawnSync(process.execPath, [__filename, '--direct', dir], { cwd: arena, encoding: 'utf8', timeout: 120000, windowsHide: true, env });
  assert.strictEqual(r.status, 0, show(r));
  const got = JSON.parse(r.stdout);
  // No language is registered outside the CLI, so the guard keeps its original (Korean) text.
  assert.deepStrictEqual(got, { unguarded: { code: 'E_TEXT_LOCK', message: `Managed text requires its existing state lock: ${got.file}. Preserve the original and retry after checking it.` },
    guarded: { code: 'E_DRY_RUN_WRITE', message: GUARD.ko(got.file) }, file: got.file, unchanged: true });
});

test('every command in the class refuses --dry-run with dry_run_unsupported, names the file it would write and changes nothing', () => {
  const labels = CASES(seed('en')).map(c => c[0]);
  assert.strictEqual(labels.length, 11);
  for (const label of labels) {
    const P = fresh('en');
    fs.writeFileSync(path.join(P, 'todo.json'), JSON.stringify([{ content: 'Synced item', status: 'pending' }]));
    const [, args, file] = CASES(P).find(c => c[0] === label);
    refused(label, P, args, { ok: false, error: REFUSAL.en(file), code: 'dry_run_unsupported' });
  }
});

for (const lang of ['en', 'ko']) {
  test(`${lang}: task add and plan add print the dry-run refusal in the project language (text and --json)`, () => {
    for (const args of [['task', 'add', 'Dry task'], ['plan', 'add', 'Dry milestone']]) {
      const P = fresh(lang), before = snapshot(P);
      const t = run([...args, '--path', P, '--dry-run']);
      assert.deepStrictEqual([t.status, t.stdout, t.stderr], [1, '✗ ' + REFUSAL[lang](tracker(P)) + '\n', ''], show(t));
      refused(args.join(' '), P, args, { ok: false, error: REFUSAL[lang](tracker(P)), code: 'dry_run_unsupported' });
      assert.deepStrictEqual(snapshot(P), before, 'a file changed under --dry-run');
    }
  });
}

test('feature add keeps its own error report: the dry-run guard\'s refusal (E_DRY_RUN_WRITE), not E_TEXT_LOCK', () => {
  const P = fresh('en'), before = snapshot(P), file = path.join(P, '.leerness', 'feature-graph.md');
  const r = run(['feature', 'add', 'Dry feature', '--path', P, '--dry-run', '--json']);
  let doc = null;
  try { doc = JSON.parse(r.stdout); } catch {}
  assert.deepStrictEqual([r.status, doc && doc.code, doc && doc.error], [1, 'E_DRY_RUN_WRITE', GUARD.en(file)], show(r));
  assert.deepStrictEqual(snapshot(P), before, 'a file changed under --dry-run');
});

// What each command stores when it runs without --dry-run (review round 1: an exit 0 alone could be a no-op).
const read = (P, name) => fs.readFileSync(path.join(P, '.leerness', name), 'utf8');
const runs = P => fs.readdirSync(path.join(P, '.leerness', 'runs')).filter(n => n.endsWith('.json')).map(n => JSON.parse(read(P, path.join('runs', n))));
const rows = P => read(P, 'progress-tracker.md').split(/\r?\n/);
const STORED = {
  'task add': P => rows(P).some(l => l.includes('| Dry task |')),
  'task drop': P => rows(P).some(l => l.includes('| Probe task |') && l.includes('| dropped |')),
  'task sync --from': P => rows(P).some(l => l.includes('| Synced item |')),
  'plan add': P => read(P, 'plan.md').includes('Dry milestone'),
  'plan remove': P => !read(P, 'plan.md').includes('Probe milestone') && read(P, 'plan.archive.md').includes('Probe milestone'),
  'memory restore plan': P => read(P, 'plan.md').includes('Archived milestone'),
  'register-pending': P => rows(P).some(l => l.includes('Dry pending')),
  // Review round 2: the run records' own fields, not text anywhere in them.
  'state start': P => runs(P).some(r => r.goal === 'Dry goal'),
  'state record': P => runs(P).some(r => Array.isArray(r.files_changed) && r.files_changed.includes('dry-file.js')),
  'state verify': P => runs(P).some(r => r.verification_result === 'pass'),
  'state handoff': P => runs(P).some(r => r.handoff_summary === 'dry handoff'),
};
test('controls: the same commands without --dry-run store their result', () => {
  const labels = CASES(seed('en')).map(c => c[0]);
  assert.deepStrictEqual(Object.keys(STORED).sort(), [...labels].sort());
  for (const label of labels) {
    const P = fresh('en');
    fs.writeFileSync(path.join(P, 'todo.json'), JSON.stringify([{ content: 'Synced item', status: 'pending' }]));
    const [, args] = CASES(P).find(c => c[0] === label);
    assert.ok(!STORED[label](P), `${label}: already stored before the run`);
    succeed([...args, '--path', P], label);
    assert.ok(STORED[label](P), `${label}: not stored`);
  }
  const P = fresh('en');
  succeed(['feature', 'add', 'Dry feature', '--path', P], 'feature add');
  assert.ok(read(P, 'feature-graph.md').includes('Dry feature'), 'feature add: not stored');
});

console.log(`dry-run refusal: ${passed}/${passed + failed}`);
if (filter && !ran) console.error(`--match ${JSON.stringify(filter)} selected no test`);
try { removeTree(arena, { recursive: true, force: true }); } catch {}
if (failed || (filter ? ran === 0 : ran !== 6)) process.exitCode = 1;
