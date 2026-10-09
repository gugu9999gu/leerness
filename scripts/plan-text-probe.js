'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-plan-text-'));
  try {
    const env = { ...process.env, PLAN_PROBE_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) {
      env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]);
    }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker'], { encoding: 'utf8', timeout: 210000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');
    if (r.error) process.stderr.write(r.error.message + '\n');
    if (r.status !== 0) process.stderr.write(`Worker exit: ${r.status}; signal: ${r.signal || 'none'}\n`);
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-plan-text-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const storage = require('../lib/managed-text'), { withStateLock } = require('../lib/state-lock');
const arena = process.env.PLAN_PROBE_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const sample = '한글 English 日本語 中文 🐝 e\u0301 \uFFFD';
const plan = '# Plan\n\n## Goal\n사용자가 작성한 목표\n\n### M-0001. ' + sample + '\nStatus: planned\nProgress: 0%\nTasks:\n- [ ] ' + sample + '\n\n## Notes\n원본 메모: ' + sample + '\n';
const archive = '# Plan archive\n\n## 제거 2026-09-21 (target: "restore")\n### M-0009. 복원 ' + sample + '\nStatus: planned\n\n## 제거 2026-09-21 (target: "keep")\n### M-0010. 보관 ' + sample + '\nStatus: planned\n';
const tracker = '# Progress\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n';
const dropped = '\n## Out of Scope / Dropped\n| ID | Item | Reason | Date |\n|---|---|---|---|\n| D-0001 | old | keep | 2026-09-21 |\n';
let sequence = 0, passed = 0, failed = 0;
function test(name, fn) { try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
function state(file) { if (!fs.existsSync(file)) return null;const s = fs.statSync(file, { bigint: true });return { sha: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(s.mtimeNs) }; }
function fixture(p = plan, a = archive) {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  for (const [name, value] of Object.entries({ HARNESS_VERSION: require('../package.json').version, LANGUAGE: 'en', 'plan.md': p, 'plan.archive.md': a, 'progress-tracker.md': tracker, 'project-brief.md': '# Brief\n\n## Purpose\n이미 작성된 설명입니다.\n' })) {
    if (value !== null) fs.writeFileSync(path.join(ws, name), value);
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'plan-test', version: '1.0.0', description: 'Useful Korean ' + sample }));
  return { dir, ws, file: path.join(ws, 'plan.md'), archive: path.join(ws, 'plan.archive.md'), progress: path.join(ws, 'progress-tracker.md') };
}
const snapshot = f => [f.file, f.archive, f.progress].map(state);
const text = p => fs.readFileSync(p, 'utf8');
const hook = path.join(arena, 'boundary-hook.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),cp=require('child_process'),target=process.env.PLAN_TARGET,mode=process.env.PLAN_MODE,other=process.env.PLAN_OTHER;
const bytes=Buffer.from(process.env.PLAN_WINNER,'base64'),write=fs.writeFileSync.bind(fs);let fired=false;
const inject=p=>{if(!fired&&p===target){fired=true;write(p,bytes);}};
if(mode==='surrogate') { const index=process.argv.indexOf(process.env.PLAN_FLAG);if(index<0)throw Error('fixture flag missing');process.argv[index+1]='\uD800'; }
const mod=require(process.env.PLAN_MODULE),capture=mod.captureTextEdit,publish=mod.publishTextEdit;
mod.captureTextEdit=function(p){const e=capture(p);if(mode==='after-capture')inject(p);return e;};
mod.publishTextEdit=function(e,p,s){const result=publish(e,p,s);if(mode==='between'&&p===other)inject(target);return result;};
const rename=fs.renameSync.bind(fs);fs.renameSync=function(a,b){if(mode==='publication'&&a===target)inject(a);return rename(a,b);};
const open=fs.openSync.bind(fs);fs.openSync=function(p,flags,...args){if(mode==='publication'&&p===target&&flags==='wx')inject(p);return open(p,flags,...args);};
const spawn=cp.spawnSync.bind(cp);cp.spawnSync=function(a,b,o){if(o?.env?.LEERNESS_REPLACE_TO===target){if(mode==='publication')inject(target);const r=spawn(a,b,o);if(mode==='after-publication'&&r.status===0)inject(target);return r;}return spawn(a,b,o);};
const link=fs.linkSync.bind(fs);fs.linkSync=function(a,b){if(mode==='publication')inject(b);const r=link(a,b);if(mode==='after-publication')inject(b);return r;};
`);
// T-0337: the partial-save notes and the memory input and output errors follow the project language of the commands'
// own text. These fixtures carry .leerness/LANGUAGE=en without a manifest, which that rule reads as Korean, so the
// English expectations run with LEERNESS_LANG=en.
function call(f, args, opts = {}) {
  const r = cp.spawnSync(process.execPath, [...(opts.mode ? ['--require', hook] : []), cli, ...args, '--path', f.dir, '--json'], {
    cwd: f.dir, encoding: 'utf8', timeout: 45000, windowsHide: true, env: { ...process.env,
      LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_LANG: 'en',
      PLAN_TARGET: opts.target || f.file, PLAN_OTHER: opts.other || '', PLAN_MODE: opts.mode || '', PLAN_FLAG: opts.flag || '',
      PLAN_WINNER: Buffer.from(opts.winner || 'competing ' + sample).toString('base64'), PLAN_MODULE: path.resolve(__dirname, '../lib/managed-text.js') },
  });assert.ifError(r.error);return r;
}
const success = r => assert.strictEqual(r.status, 0, r.stdout + r.stderr);
const failure = r => { assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);assert.ok(!/"ok"\s*:\s*true/.test(r.stdout));return r; };
function rejectUnchanged(f, args, opts) { const before = snapshot(f), r = failure(call(f, args, opts));assert.deepStrictEqual(snapshot(f), before);return r; }
function retained(dir, bytes) { return fs.readdirSync(dir, { withFileTypes: true }).some(e => { const p = path.join(dir, e.name);return e.isDirectory() ? retained(p, bytes) : e.isFile() && fs.readFileSync(p).equals(bytes); }); }
const add = ['plan', 'add', '새 계획 ' + sample, '--done-when', sample, '--next', sample];
const remove = ['plan', 'remove', 'M-0001'], restore = ['memory', 'restore', 'plan', 'restore'];

test('paired preflight is read-only and does not consume a valid snapshot', () => {
  const f = fixture(), before = state(f.file);withStateLock(f.file, () => { const e = storage.captureTextEdit(f.file);storage.assertTextEditCurrent(e, f.file, e.text + sample);assert.deepStrictEqual(state(f.file), before);storage.publishTextEdit(e, f.file, e.text + sample); });assert.strictEqual(text(f.file), plan + sample);
});
test('paired preflight rejects invalid candidates and stale snapshots before publication', () => {
  const f = fixture();withStateLock(f.file, () => { const e = storage.captureTextEdit(f.file), before = state(f.file);assert.throws(() => storage.assertTextEditCurrent(e, f.file, '\uD800'), { code: 'E_TEXT_ENCODING' });assert.throws(() => storage.assertTextEditCurrent(e, f.file, 'a'.repeat(storage.MAX_TEXT_BYTES + 1)), { code: 'E_TEXT_LIMIT' });assert.deepStrictEqual(state(f.file), before);fs.writeFileSync(f.file, 'winner');assert.throws(() => storage.assertTextEditCurrent(e, f.file, 'new'), { code: 'E_STORE_CHANGED' }); });assert.strictEqual(text(f.file), 'winner');
});
test('init appends an exact multilingual goal without rewriting existing text', () => {
  const f = fixture();success(call(f, ['plan', 'init', '--goal', sample]));assert.strictEqual(text(f.file), plan + '\n## User Goal\n- ' + sample + '\n');
});
test('add preserves Unicode and links the new milestone to a task', () => {
  const f = fixture();success(call(f, add));assert.ok(text(f.file).startsWith(plan));assert.ok(text(f.file).includes('### M-0002. 새 계획 ' + sample));assert.ok(text(f.progress).includes('plan:M-0002'));assert.ok(text(f.progress).includes(sample));
});
test('append preserves an existing BOM and existing CRLF bytes', () => {
  const original = '\uFEFF' + plan.replace(/\n/g, '\r\n'), f = fixture(original);success(call(f, add));assert.ok(fs.readFileSync(f.file).subarray(0, Buffer.byteLength(original)).equals(Buffer.from(original)));
});
test('drop creates the scope table while retaining the rest of the plan', () => {
  const f = fixture();success(call(f, ['plan', 'drop', sample, '--reason', sample]));assert.ok(text(f.file).startsWith(plan));assert.ok(text(f.file).includes('| D-0001 | ' + sample));assert.strictEqual(text(f.progress), tracker);
});
test('drop updates LF and CRLF tables without reporting a no-op success', () => {
  for (const eol of ['\n', '\r\n']) { const original = ('\uFEFF' + plan + dropped).replace(/\n/g, eol), f = fixture(original);success(call(f, ['plan', 'drop', 'new', '--reason', sample]));assert.ok(text(f.file).includes('| D-0002 | new | ' + sample));assert.ok(text(f.file).includes('| D-0001 | old | keep |'));assert.ok(text(f.file).startsWith('\uFEFF')); }
});
test('malformed existing dropped table is rejected unchanged', () => {
  rejectUnchanged(fixture(plan + '\n## Out of Scope / Dropped\nbroken table\n'), ['plan', 'drop', 'new']);
});
test('remove preserves the selected Unicode in archive and leaves notes active', () => {
  const f = fixture(plan, null);success(call(f, remove));assert.ok(!text(f.file).includes('### M-0001.'));assert.ok(text(f.file).includes('## Notes\n원본 메모: ' + sample));assert.ok(text(f.archive).includes('### M-0001. ' + sample));assert.strictEqual(text(f.progress), tracker);
});
test('remove batches multiple matching blocks while protecting template and headings', () => {
  const f = fixture(plan + '\n### M-0002. 한글 추가\nBody\n\n### Template 한글\nPreserve\n\n## Risks\n한글 위험\n');success(call(f, ['plan', 'remove', '한글']));const p = text(f.file), a = text(f.archive);assert.ok(!p.includes('### M-0001.') && !p.includes('### M-0002.'));assert.ok(p.includes('### Template 한글') && p.includes('## Risks'));assert.ok(a.includes('### M-0001.') && a.includes('### M-0002.'));
});
test('remove keeps existing signatures and unselected archive bytes', () => {
  const f = fixture('\uFEFF' + plan, '\uFEFF' + archive);success(call(f, remove));assert.ok(text(f.file).startsWith('\uFEFF'));assert.ok(text(f.archive).startsWith('\uFEFF' + archive));
});
test('no-match remove does not touch an unrelated damaged archive', () => {
  const f = fixture(plan, Buffer.from([0xff]));const r = rejectUnchanged(f, ['plan', 'remove', 'M-9999']);assert.ok(r.stdout.includes('milestone_not_found'));
});
test('restore preserves valid Unicode and trims only selected archive blocks', () => {
  const f = fixture();success(call(f, restore));assert.ok(text(f.file).startsWith(plan) && text(f.file).includes('### M-0009. 복원 ' + sample));assert.ok(!text(f.archive).includes('target: "restore"'));assert.ok(text(f.archive).includes('target: "keep"') && text(f.archive).includes(sample));
});
test('restore creates a missing plan and preserves archive BOM', () => {
  const f = fixture(null, '\uFEFF' + archive);success(call(f, restore));assert.ok(text(f.file).includes('### M-0009.'));assert.ok(!text(f.file).startsWith('\uFEFF'));assert.ok(text(f.archive).startsWith('\uFEFF'));
});
test('restore conflict and no-match remain read-only; force retains its meaning', () => {
  const f = fixture(plan + '\n### M-0009. 복원 ' + sample + '\n');const r = rejectUnchanged(f, restore);assert.ok(r.stdout.includes('restore_conflict'));success(call(f, [...restore, '--force']));assert.strictEqual((text(f.file).match(/### M-0009\./g) || []).length, 2);rejectUnchanged(f, ['memory', 'restore', 'plan', 'not-present']);
});
test('anchors applies a checked plan draft and preserves authored material', () => {
  const f = fixture('# Plan\n\n## Goal\n\n## Notes\n' + sample + '\n'), brief = state(path.join(f.ws, 'project-brief.md'));success(call(f, ['anchors', 'draft', '--apply']));assert.ok(text(f.file).includes('draft: leerness anchors'));assert.ok(text(f.file).includes('## Notes\n' + sample));assert.deepStrictEqual(state(path.join(f.ws, 'project-brief.md')), brief);
});
test('all selected direct plan commands reject malformed source bytes unchanged', () => {
  for (const args of [['plan', 'init', '--goal', 'new'], add, ['plan', 'drop', 'new'], remove, restore]) { rejectUnchanged(fixture(Buffer.concat([Buffer.from(plan), Buffer.from([0xff])])), args); }
});
test('truncated UTF-8 and UTF-16 inputs are refused instead of transcoded', () => {
  for (const bad of [Buffer.from([0xe3, 0x81]), Buffer.from([0xff, 0xfe, 0x61, 0])]) rejectUnchanged(fixture(Buffer.concat([Buffer.from(plan), bad])), add);
});
test('anchors refuses invalid plan bytes without recording successful application', () => {
  const f = fixture(Buffer.concat([Buffer.from('# Plan\n\n## Goal\n\n## Notes\n'), Buffer.from([0xff])]));rejectUnchanged(f, ['anchors', 'draft', '--apply']);
});
test('anchors rejects a generated lone surrogate before saving the plan', () => {
  const f = fixture('# Plan\n\n## Goal\n\n## Notes\n' + sample + '\n');fs.writeFileSync(path.join(f.dir, 'package.json'), JSON.stringify({ name: 'plan-test', version: '1.0.0', description: 'A useful \uD800 description' }));rejectUnchanged(f, ['anchors', 'draft', '--apply']);
});
test('remove and restore reject malformed archives without mutating either file', () => {
  for (const args of [remove, restore]) { const r = rejectUnchanged(fixture(plan, Buffer.concat([Buffer.from(archive), Buffer.from([0xff])])), args);if (args === restore) assert.ok(r.stdout.includes('archive_corrupt')); }
});
test('oversized plan and archive inputs are rejected without truncation', () => {
  const huge = 'a'.repeat(storage.MAX_TEXT_BYTES + 1);rejectUnchanged(fixture(huge), ['plan', 'init', '--goal', 'new']);rejectUnchanged(fixture(plan, huge), remove);
});
test('both removal and restoration candidates are bounded before first write', () => {
  rejectUnchanged(fixture(plan, 'a'.repeat(storage.MAX_TEXT_BYTES - 20)), remove);rejectUnchanged(fixture('a'.repeat(storage.MAX_TEXT_BYTES - 20)), restore);
});
test('surrogate-bearing goals, scope reasons and paired task fields are refused', () => {
  for (const [args, flag] of [[['plan', 'init', '--goal', 'new'], '--goal'], [['plan', 'drop', 'new', '--reason', 'x'], '--reason'], [add, '--next'], [add, '--done-when']]) rejectUnchanged(fixture(), args, { mode: 'surrogate', flag });
});
test('a hard-linked plan or archive is not used as a mutable owned file', () => {
  for (const target of ['file', 'archive']) { const f = fixture();fs.linkSync(f[target], f[target] + '.alias');rejectUnchanged(f, target === 'file' ? add : remove); }
});
test('a plan changed after capture is preserved without creating a task', () => {
  const f = fixture(), progress = state(f.progress);failure(call(f, add, { mode: 'after-capture' }));assert.strictEqual(text(f.file), 'competing ' + sample);assert.deepStrictEqual(state(f.progress), progress);
});
test('a final plan publication race retains competing bytes without success', () => {
  const f = fixture();failure(call(f, ['plan', 'drop', 'outside'], { mode: 'publication' }));assert.ok(retained(f.dir, Buffer.from('competing ' + sample)));
});
test('post-publication target tampering does not produce plan success', () => {
  const f = fixture();failure(call(f, ['plan', 'init', '--goal', 'new'], { mode: 'after-publication' }));assert.ok(retained(f.dir, Buffer.from('competing ' + sample)));
});
test('changed archive preflight keeps the active plan unchanged', () => {
  const f = fixture(), before = state(f.file);failure(call(f, remove, { mode: 'after-capture', target: f.archive }));assert.deepStrictEqual(state(f.file), before);assert.strictEqual(text(f.archive), 'competing ' + sample);
});
test('a competing archive creation cannot authorize active removal', () => {
  const f = fixture(plan, null), before = state(f.file);failure(call(f, remove, { mode: 'publication', target: f.archive }));assert.deepStrictEqual(state(f.file), before);assert.ok(retained(f.dir, Buffer.from('competing ' + sample)));
});
test('a final existing-archive race retains competing bytes and the active plan', () => {
  const f = fixture(), before = state(f.file);failure(call(f, remove, { mode: 'publication', target: f.archive }));assert.deepStrictEqual(state(f.file), before);assert.ok(retained(f.dir, Buffer.from('competing ' + sample)));
});
test('remove reports partial publication and keeps the archived original', () => {
  const f = fixture(), r = failure(call(f, remove, { mode: 'between', target: f.file, other: f.archive }));assert.ok((r.stdout + r.stderr).includes('Plan archive was saved'));assert.strictEqual(text(f.file), 'competing ' + sample);assert.ok(text(f.archive).includes('### M-0001. ' + sample));
});
test('restore reports partial publication without losing restored or competing content', () => {
  const f = fixture(), r = failure(call(f, restore, { mode: 'between', target: f.archive, other: f.file }));assert.ok((r.stdout + r.stderr).includes('Active plan was restored'));assert.ok(text(f.file).includes('### M-0009. 복원 ' + sample));assert.strictEqual(text(f.archive), 'competing ' + sample);
});
console.log(`Tests: ${passed}/${passed + failed} passed`);if (failed) process.exitCode = 1;
