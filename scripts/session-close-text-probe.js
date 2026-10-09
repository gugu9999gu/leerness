'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-close-text-'));
  try {
    const env = { ...process.env, CLOSE_PROBE_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 240000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');
    if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-close-text-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.CLOSE_PROBE_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const sample = '한글 English 日本語 中文 🐝 e\u0301 \uFFFD';
const tracker = '# Progress\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n| T-0001 | in-progress | ' + sample + ' | source | next ' + sample + ' | 2026-09-21 |\n';
const handoff = '---\nleernessRole: session-handoff\ncustom: ' + sample + '\n---\n<!-- leerness:managed -->\n# Session Handoff\nLast generated: 2026-01-01\n';
const current = '# Current State\nUpdated: 2026-01-01\n\n## Now\n- user ' + sample + '\n\n## Next\n- keep next\n\n## Blockers\n- keep blocker\n\n## Notes\n' + sample + '\n';
const names = ['session-handoff.md', 'current-state.md', 'task-log.md'];
let sequence = 0, passed = 0, failed = 0;
const filterAt = process.argv.indexOf('--match'), filter = filterAt < 0 ? '' : process.argv[filterAt + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
function state(file) { if (!fs.existsSync(file)) return null;const s = fs.statSync(file, { bigint: true });return { sha: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(s.mtimeNs) }; }
function fixture(values = {}) {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  const files = { HARNESS_VERSION: require('../package.json').version, LANGUAGE: 'en', 'progress-tracker.md': tracker, 'session-handoff.md': handoff, 'current-state.md': current, 'task-log.md': '# Task Log\n' + sample + '\n', 'review-evidence.md': '# Evidence\n' + sample + '\n', 'rules.md': '# User Rules\n', ...values };
  for (const [name, value] of Object.entries(files)) if (value !== null) fs.writeFileSync(path.join(ws, name), value);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'close-test', version: '1.0.0' }));
  return { dir, ws, file: name => path.join(ws, name) };
}
const snapshot = f => names.map(name => state(f.file(name)));
const text = p => fs.readFileSync(p, 'utf8');
const hook = path.join(arena, 'boundary-hook.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),cp=require('child_process'),path=require('path'),target=process.env.CLOSE_TARGET,mode=process.env.CLOSE_MODE,other=process.env.CLOSE_OTHER;
const bytes=Buffer.from(process.env.CLOSE_WINNER,'base64'),write=fs.writeFileSync.bind(fs);let fired=false;
const inject=p=>{if(!fired&&p===target){fired=true;write(p,bytes);}};
const base=process.env.CLOSE_LIB;
const input=require(path.join(base,'memory-input')),captureInput=input.captureCheckedFileInput;
input.captureCheckedFileInput=function(p,o){const result=captureInput(p,o);if(mode==='source-capture')inject(p);return result;};
const mod=require(path.join(base,'managed-text')),capture=mod.captureTextEdit,publish=mod.publishTextEdit;
mod.captureTextEdit=function(p){const result=capture(p);if(mode==='after-capture')inject(p);return result;};
mod.publishTextEdit=function(e,p,s){const result=publish(e,p,s);if(mode==='between'&&p===other)inject(target);return result;};
if(mode==='surrogate'){const u=require(path.join(base,'pure-utils'));u._sanitizeFences=()=> '\uD800';}
if(mode==='default-lock'){const close=require(path.join(base,'session-close')),run=close.sessionClose;close.sessionClose=(r,o,d)=>run(r,o,{...d,_withLock:undefined});}
const rename=fs.renameSync.bind(fs);fs.renameSync=function(a,b){if(mode==='publication'&&a===target)inject(a);return rename(a,b);};
const open=fs.openSync.bind(fs);fs.openSync=function(p,flags,...args){if(mode==='publication'&&p===target&&flags==='wx')inject(p);return open(p,flags,...args);};
const spawn=cp.spawnSync.bind(cp);cp.spawnSync=function(a,b,o){if(o?.env?.LEERNESS_REPLACE_TO===target){if(mode==='publication')inject(target);const r=spawn(a,b,o);if(mode==='after-publication'&&r.status===0)inject(target);return r;}return spawn(a,b,o);};
const link=fs.linkSync.bind(fs);fs.linkSync=function(a,b){if(mode==='publication')inject(b);const r=link(a,b);if(mode==='after-publication')inject(b);return r;};
`);
// T-0337: the partial-save notes and the memory input and output errors follow the project language of the commands'
// own text. These fixtures carry .leerness/LANGUAGE=en without a manifest, which that rule reads as Korean, so the
// English expectations run with LEERNESS_LANG=en.
function call(f, opts = {}) {
  const r = cp.spawnSync(process.execPath, [...(opts.mode ? ['--require', hook] : []), cli, 'session', 'close', '--path', f.dir, ...(opts.human ? [] : ['--json']), '--no-suggest', '--no-record', ...(opts.flags || [])], { cwd: f.dir, encoding: 'utf8', timeout: 45000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_LANG: 'en',
      CLOSE_LIB: path.resolve(__dirname, '../lib'), CLOSE_MODE: opts.mode || '', CLOSE_TARGET: opts.target || f.file(names[0]), CLOSE_OTHER: opts.other || '', CLOSE_WINNER: Buffer.from(opts.winner || 'competing ' + sample).toString('base64') } });
  assert.ifError(r.error);return r;
}
const success = r => assert.strictEqual(r.status, 0, r.stdout + r.stderr);
const failure = r => { assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);assert.ok(!/"ok"\s*:\s*true/.test(r.stdout));return r; };
test('owner priority wins over stale first in-progress row without changing authored rules', () => {
  const rows = tracker + '| T-0002 | in-progress | current owner work | evidence | current next | 2026-09-22 |\n';
  const plan = '# Plan\n<!-- leerness:owner-priorities:start -->\n1. Current work - T-0002\n2. Older work - T-0001\n<!-- leerness:owner-priorities:end -->\n';
  const rules = '# Rules\nOwner override: retain this exact paragraph.\n| R-0001 | every-round | keep owner rule | 2026-01-01 | active | - |\n';
  const f = fixture({ 'progress-tracker.md': rows, 'plan.md': plan, 'rules.md': rules });
  const before = state(f.file('rules.md'));
  const r = call(f);success(r);
  const result = JSON.parse(r.stdout);
  assert.strictEqual(result.nextTask.id, 'T-0002');
  assert.strictEqual(result.nextTask.source, 'owner-priorities');
  assert.strictEqual(result.nextExactStep, 'current next');
  assert.match(text(f.file('session-handoff.md')), /## Next Exact Step\n- current next\n/);
  assert.deepStrictEqual(state(f.file('rules.md')), before);
});
test('explicit close task wins over owner priority and invalid selection fails before writes', () => {
  const rows = tracker + '| T-0002 | in-progress | owner work | evidence | owner next | 2026-09-22 |\n';
  const plan = '<!-- leerness:owner-priorities:start -->\n1. Owner work - T-0002\n<!-- leerness:owner-priorities:end -->\n';
  const f = fixture({ 'progress-tracker.md': rows, 'plan.md': plan });
  const r = call(f, { flags: ['--task', 'T-0001'] });success(r);
  assert.deepStrictEqual(JSON.parse(r.stdout).nextTask, { id: 'T-0001', source: 'explicit-task' });
  const before = snapshot(f);
  const invalid = call(f, { flags: ['--task', 'T-9999'] });failure(invalid);
  assert.deepStrictEqual(snapshot(f), before);
});
test('newest active row is fallback when no explicit owner priority exists', () => {
  const rows = tracker + '| T-0002 | in-progress | newer work | evidence | newer next | 2026-09-22 |\n';
  const f = fixture({ 'progress-tracker.md': rows });
  const r = call(f);success(r);
  const result = JSON.parse(r.stdout);
  assert.deepStrictEqual(result.nextTask, { id: 'T-0002', source: 'recent-in-progress' });
  assert.strictEqual(result.nextExactStep, 'newer next');
});
function rejectUnchanged(f, opts) { const before = snapshot(f), r = failure(call(f, opts));assert.deepStrictEqual(snapshot(f), before);return r; }
function retained(dir, bytes) { return fs.readdirSync(dir, { withFileTypes: true }).some(e => { const p = path.join(dir, e.name);return e.isDirectory() ? retained(p, bytes) : e.isFile() && fs.readFileSync(p).equals(bytes); }); }
for (const name of [...names, 'progress-tracker.md', 'review-evidence.md']) {
  test('reject malformed ' + name + ' before document publication', () => { const f = fixture();fs.appendFileSync(f.file(name), Buffer.from([0xff]));rejectUnchanged(f); });
}
test('CRLF frontmatter survives generated handoff replacement', () => {
  const f = fixture({ 'session-handoff.md': handoff.replace(/\n/g, '\r\n') });success(call(f));assert.ok(text(f.file(names[0])).startsWith(handoff.split('<!--')[0].replace(/\n/g, '\r\n')));
});
test('valid Unicode and literal replacement characters survive all selected documents', () => {
  const f = fixture(), inputs = ['progress-tracker.md', 'review-evidence.md'].map(n => state(f.file(n)));success(call(f));
  for (const n of names) assert.ok(text(f.file(n)).includes(sample), n);
  assert.deepStrictEqual(['progress-tracker.md', 'review-evidence.md'].map(n => state(f.file(n))), inputs);
  assert.ok(text(f.file(names[0])).includes('next ' + sample));assert.ok(text(f.file(names[1])).includes('## Notes\n' + sample));
});
test('existing signatures and appended log bytes are retained', () => {
  const f = fixture();for (const n of [...names, 'progress-tracker.md', 'review-evidence.md']) fs.writeFileSync(f.file(n), '\uFEFF' + text(f.file(n)).replace(/\n/g, '\r\n'));
  const log = fs.readFileSync(f.file(names[2]));success(call(f));for (const n of names) assert.ok(text(f.file(n)).startsWith('\uFEFF'), n);
  assert.ok(fs.readFileSync(f.file(names[2])).subarray(0, log.length).equals(log));assert.ok(text(f.file(names[0])).includes('custom: ' + sample + '\r\n---\r\n'));
});
test('missing handoff and log are created without signatures; missing current state stays absent', () => {
  const f = fixture(Object.fromEntries(names.map(n => [n, null])));success(call(f));assert.ok(text(f.file(names[0])).startsWith('<!-- leerness:current-handoff:start -->\n# Session Handoff'));assert.ok(text(f.file(names[2])).startsWith('\n## '));assert.strictEqual(state(f.file(names[1])), null);
});
test('missing tracker and evidence remain optional', () => { const f = fixture({ 'progress-tracker.md': null, 'review-evidence.md': null });const r = call(f);success(r);assert.strictEqual(JSON.parse(r.stdout).taskCounts['in-progress'], 0);assert.ok(text(f.file(names[0])).includes('(no review-evidence.md)')); });
test('unclosed leading frontmatter fails instead of discarding metadata', () => { rejectUnchanged(fixture({ 'session-handoff.md': '---\ncustom: ' + sample + '\n' })); });
test('empty frontmatter is valid with either supported line ending', () => {
  for (const eol of ['\n', '\r\n']) { const head = '---' + eol + '---' + eol, f = fixture({ 'session-handoff.md': head + '# Old\n' });success(call(f));assert.ok(text(f.file(names[0])).startsWith(head)); }
});
test('frontmatter ending at EOF is preserved and body separators are not mistaken for metadata', () => {
  const f = fixture({ 'session-handoff.md': '---\ncustom: ' + sample + '\n---' });success(call(f));assert.ok(text(f.file(names[0])).startsWith('---\ncustom: ' + sample + '\n---\n'));
  const old = '# Old\n---\nLast generated: 2000-01-01\n';
  const g = fixture({ 'session-handoff.md': old });success(call(g));assert.ok(text(g.file(names[0])).includes('# Session Handoff'));assert.ok(text(g.file(names[0])).endsWith(old));
});
test('repeated close preserves authored state and replaces only automatic state lines', () => {
  const f = fixture();success(call(f));const before = text(f.file(names[1]));success(call(f));assert.strictEqual(text(f.file(names[1])), before);assert.strictEqual((text(f.file(names[0])).match(/current-handoff:start/g) || []).length, 1);assert.ok(text(f.file(names[0])).endsWith(handoff.slice(handoff.indexOf('<!--'))));assert.strictEqual((text(f.file(names[2])).match(/## .* session-close/g) || []).length, 2);
});
test('truncated UTF-8 and UTF-16 are rejected unchanged', () => { for (const bad of [Buffer.from([0xe3, 0x81]), Buffer.from([0xff, 0xfe, 0x61, 0])]) rejectUnchanged(fixture({ 'current-state.md': bad })); });
test('human output and force preserve the same rejection boundary', () => { rejectUnchanged(fixture({ 'task-log.md': Buffer.from([0xff]) }), { human: true, flags: ['--force'] }); });
test('invalid generated Unicode is rejected before any document changes', () => { rejectUnchanged(fixture(), { mode: 'surrogate' }); });
test('all five selected inputs enforce the byte limit without truncation', () => { for (const n of [...names, 'progress-tracker.md', 'review-evidence.md']) rejectUnchanged(fixture({ [n]: 'a'.repeat(4 * 1024 * 1024 + 1) })); });
test('generated handoff and appended log limits are preflighted before first publication', () => {
  for (const n of ['review-evidence.md', 'task-log.md']) rejectUnchanged(fixture({ [n]: 'a'.repeat(4 * 1024 * 1024) }));
});
test('unsafe linked targets and sources are rejected without changing either link', () => {
  for (const n of [...names, 'progress-tracker.md', 'review-evidence.md']) { const f = fixture(), alias = path.join(f.dir, 'linked');fs.linkSync(f.file(n), alias);const before = state(alias);rejectUnchanged(f);assert.deepStrictEqual(state(alias), before); }
});
test('non-file targets are rejected before publishing earlier documents', () => {
  const f = fixture({ 'task-log.md': null });fs.mkdirSync(f.file(names[2]));const before = names.slice(0, 2).map(n => state(f.file(n)));failure(call(f));assert.deepStrictEqual(names.slice(0, 2).map(n => state(f.file(n))), before);assert.ok(fs.statSync(f.file(names[2])).isDirectory());
});
test('every target rejects a stale captured input without overwriting the competitor', () => {
  for (const n of names) { const f = fixture(), target = f.file(n), before = snapshot(f);failure(call(f, { mode: 'after-capture', target }));assert.strictEqual(text(target), 'competing ' + sample);for (const [i, name] of names.entries()) if (name !== n) assert.deepStrictEqual(state(f.file(name)), before[i]); }
});
test('all three source snapshots are rechecked before document publication', () => {
  for (const n of ['progress-tracker.md', 'review-evidence.md', 'plan.md']) { const f = fixture({ 'plan.md': '# Plan\n' }), target = f.file(n);rejectUnchanged(f, { mode: 'source-capture', target });assert.strictEqual(text(target), 'competing ' + sample); }
});
test('ambiguous owner priority markers fail without replacing the handoff', () => {
  const f = fixture({ 'plan.md': '<!-- leerness:owner-priorities:start -->\n1. T-0001\n' });
  rejectUnchanged(f);
});
test('later target conflicts report earlier publication and keep the untouched log', () => {
  const f = fixture(), log = state(f.file(names[2]));const r = failure(call(f, { mode: 'between', target: f.file(names[1]), other: f.file(names[0]) }));
  assert.match(r.stdout + r.stderr, /after publishing session-handoff.md/);assert.strictEqual(text(f.file(names[1])), 'competing ' + sample);assert.deepStrictEqual(state(f.file(names[2])), log);assert.ok(text(f.file(names[0])).includes('Last generated:'));
});
test('log conflict reports both earlier documents as published', () => {
  const f = fixture();const r = failure(call(f, { mode: 'between', target: f.file(names[2]), other: f.file(names[1]) }));assert.match(r.stdout + r.stderr, /after publishing session-handoff.md, current-state.md/);assert.strictEqual(text(f.file(names[2])), 'competing ' + sample);
});
test('source changes between publications fail with explicit partial state', () => {
  const f = fixture(), before = snapshot(f);const r = failure(call(f, { mode: 'between', target: f.file('review-evidence.md'), other: f.file(names[0]) }));assert.match(r.stdout + r.stderr, /earlier writes were not rolled back/);assert.deepStrictEqual(snapshot(f).slice(1), before.slice(1));
});
test('final publication races fail and retain competing bytes in path or recovery', () => {
  const f = fixture(), before = snapshot(f);failure(call(f, { mode: 'publication' }));assert.ok(retained(f.ws, Buffer.from('competing ' + sample)));assert.deepStrictEqual(snapshot(f).slice(1), before.slice(1));
});
test('late publication races are not reported as successful close', () => {
  const f = fixture(), before = snapshot(f);failure(call(f, { mode: 'after-publication' }));assert.ok(retained(f.ws, Buffer.from('competing ' + sample)));assert.deepStrictEqual(snapshot(f).slice(1), before.slice(1));
});
test('new-file publication race retains the independently created handoff', () => {
  const f = fixture({ 'session-handoff.md': null }), before = snapshot(f);failure(call(f, { mode: 'publication' }));assert.ok(retained(f.ws, Buffer.from('competing ' + sample)));assert.deepStrictEqual(snapshot(f).slice(1), before.slice(1));
});
test('library fallback uses the same canonical state locks', () => { const f = fixture();success(call(f, { mode: 'default-lock' }));assert.ok(text(f.file(names[0])).includes(sample)); });
test('unsupported dry-run reports the existing error and leaves all fixture files unchanged', () => {
  const f = fixture();
  const tree = dir => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(e => [e.name, e.isDirectory() ? tree(path.join(dir, e.name)) : state(path.join(dir, e.name))]);
  const before = tree(f.dir), r = failure(call(f, { flags: ['--dry-run'] }));assert.strictEqual(JSON.parse(r.stdout).code, 'dry_run_unsupported');assert.deepStrictEqual(tree(f.dir), before);
});
console.log(`Session close text probe: ${passed}/${passed + failed} passed`);process.exitCode = failed ? 1 : 0;
