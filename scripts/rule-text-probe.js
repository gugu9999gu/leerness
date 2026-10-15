'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rule-text-'));
  try {
    const env = { ...process.env, RULE_TEXT_PROBE_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 600000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-rule-text-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.RULE_TEXT_PROBE_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const sample = '한글 English 日本語 中文 e\u0301 🐝 \uFFFD';
const row = '| R-0001 | every-session | Keep ' + sample + ' | 2026-01-01 | active | - |\n';
const original = '# Custom preface ' + sample + '\n\n<!-- leerness:managed -->\n# User Rules\n\n## Active Rules\n\n| ID | Trigger | Rule | Added | Status | Last Verified |\n|---|---|---|---|---|---|\n' + row + '\n## Authored notes\nKeep notes ' + sample + '\n';
const archive = '# Rules archive\n\n| ID | Trigger | Rule | Added | Status | Removed |\n|---|---|---|---|---|---|\n| R-0009 | every-session | Old ' + sample + ' | 2025-01-01 | removed | 2026-01-01 |\n';
let sequence = 0, passed = 0, failed = 0;
const at = process.argv.indexOf('--match'), filter = at < 0 ? '' : process.argv[at + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
function fixture(value = original, oldArchive = archive) {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  const f = { dir, ws, file: path.join(ws, 'rules.md'), archive: path.join(ws, 'rules.archive.md') };
  fs.writeFileSync(path.join(ws, 'HARNESS_VERSION'), require('../package.json').version);fs.writeFileSync(path.join(ws, 'LANGUAGE'), 'en');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"rule-text-test","version":"1.0.0"}\n');
  if (value !== null) fs.writeFileSync(f.file, value);if (oldArchive !== null) fs.writeFileSync(f.archive, oldArchive);
  return f;
}
function state(file) { if (!fs.existsSync(file)) return null;const s = fs.statSync(file, { bigint: true });return { sha: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(s.mtimeNs) }; }
const text = p => fs.readFileSync(p, 'utf8'), snapshot = f => [state(f.file), state(f.archive)];
const hook = path.join(arena, 'boundary-hook.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),cp=require('child_process'),path=require('path'),base=process.env.RULE_TEXT_LIB,target=process.env.RULE_TEXT_TARGET,mode=process.env.RULE_TEXT_MODE;
const write=fs.writeFileSync.bind(fs),bytes=Buffer.from(process.env.RULE_TEXT_WINNER,'base64');let fired=false;
if(process.env.RULE_TEXT_STARTED)write(process.env.RULE_TEXT_STARTED,'started');
const inject=p=>{if(!fired&&p===target){fired=true;write(p,bytes);}};
const locks=require(path.join(base,'state-lock'));
const io=require(path.join(base,'io')),read=io.read;io.read=function(p){const result=read(p);if(mode==='after-capture'&&locks.isStateLockHeld(p))inject(p);return result;};
const mod=require(path.join(base,'managed-text')),capture=mod.captureTextEdit,publish=mod.publishTextEdit;
mod.captureTextEdit=function(p){
  if(mode==='before-capture')inject(p);
  const result=capture(p);if(mode==='after-capture')inject(p);
  if(mode==='hold'&&p===target){write(process.env.RULE_TEXT_READY,'ready');const end=Date.now()+15000;while(!fs.existsSync(process.env.RULE_TEXT_GO)){if(Date.now()>end)throw Error('holder deadline');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}}
  if(mode==='lock-order'&&p===process.env.RULE_TEXT_OTHER&&!locks.isStateLockHeld(target))throw Error('rules lock must precede archive');
  return result;
};
mod.publishTextEdit=function(s,p,t){const result=publish(s,p,t);if(mode==='between'&&p===process.env.RULE_TEXT_OTHER)inject(target);return result;};
const pure=require(path.join(base,'pure-utils')),cell=pure._cellSafe;let outputInjected=false;
pure._cellSafe=function(v){const s=cell(v);if(!outputInjected&&locks.isStateLockHeld(target)&&((mode==='surrogate')||(mode==='oversize')||(mode==='bad-active'&&v==='R-0002'))){outputInjected=true;return s+(mode==='oversize'?'a'.repeat(4*1024*1024+1):'\uD800');}return s;};
const rename=fs.renameSync.bind(fs);fs.renameSync=function(a,b){if(mode==='publication'&&a===target)inject(a);return rename(a,b);};
const open=fs.openSync.bind(fs);fs.openSync=function(p,flags,...args){if(mode==='publication'&&p===target&&flags==='wx')inject(p);return open(p,flags,...args);};
const spawn=cp.spawnSync.bind(cp);cp.spawnSync=function(a,b,o){if(o?.env?.LEERNESS_REPLACE_TO===target){if(mode==='publication')inject(target);const r=spawn(a,b,o);if(mode==='after-publication'&&r.status===0)inject(target);return r;}return spawn(a,b,o);};
const link=fs.linkSync.bind(fs);fs.linkSync=function(a,b){if(mode==='publication')inject(b);const r=link(a,b);if(mode==='after-publication')inject(b);return r;};
`);
// T-0336: managed-text errors follow the project language of the commands' own text. These fixtures carry
// .leerness/LANGUAGE=en without a manifest, which that rule reads as Korean, so the English expectations run with
// LEERNESS_LANG=en.
function call(f, args = ['rule', 'add', 'new rule'], opts = {}) {
  const r = cp.spawnSync(process.execPath, [...(opts.mode ? ['--require', hook] : []), cli, ...args, '--path', f.dir, ...(opts.human ? [] : ['--json'])], {
    cwd: f.dir, encoding: 'utf8', timeout: 45000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1', LEERNESS_LANG: 'en',
      RULE_TEXT_LIB: path.resolve(__dirname, '../lib'), RULE_TEXT_MODE: opts.mode || '', RULE_TEXT_TARGET: opts.target || f.file, RULE_TEXT_WINNER: Buffer.from(opts.winner || 'competing ' + sample).toString('base64'), RULE_TEXT_OTHER: opts.other || '' } });
  assert.ifError(r.error);return r;
}
function success(r) { assert.strictEqual(r.status, 0, r.stdout + r.stderr);return r; }
function failure(r) { assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);assert.ok(!/"ok"\s*:\s*true/.test(r.stdout));return r; }
function rejectUnchanged(f, args, opts) {
  const before = snapshot(f), r = call(f, args, opts), after = snapshot(f);
  if (r.status === 0) console.log('Observation: ' + JSON.stringify({ action: args, exit: r.status, rulesChanged: JSON.stringify(before[0]) !== JSON.stringify(after[0]), archiveChanged: JSON.stringify(before[1]) !== JSON.stringify(after[1]) }));
  failure(r);assert.deepStrictEqual(after, before);return r;
}
const mutations = [['add', 'new rule'], ['pause', 'R-0001'], ['resume', 'R-0001'], ['stop'], ['resume-all'], ['remove', 'R-0001']];
for (const action of mutations) test('repro malformed rules refused: ' + action[0], () => {
  const r = rejectUnchanged(fixture(Buffer.concat([Buffer.from(original), Buffer.from([0xff])])), ['rule', ...action]);assert.match(r.stdout + r.stderr, /invalid UTF-8/);
});
test('repro malformed archive refuses removal before either document changes', () => {
  const r = rejectUnchanged(fixture(original, Buffer.concat([Buffer.from(archive), Buffer.from([0xff])])), ['rule', 'remove', 'R-0001']);assert.match(r.stdout + r.stderr, /invalid UTF-8/);
});
test('repro stale rules read is refused and the competing edit survives', () => {
  const f = fixture();failure(call(f, undefined, { mode: 'after-capture' }));assert.strictEqual(text(f.file), 'competing ' + sample);
});
test('new rules file is created with usable IDs without an archive file', () => {
  const f = fixture(null, null), r = JSON.parse(success(call(f)).stdout);assert.strictEqual(r.id, 'R-0001');assert.ok(text(f.file).includes('new rule'));assert.ok(!fs.existsSync(f.archive));
});
test('valid multilingual rule text and authored notes retain the UTF-8 signature', () => {
  const f = fixture('\uFEFF' + original.replace(/\n/g, '\r\n'));
  const r = JSON.parse(success(call(f, ['rule', 'add', 'new ' + sample])).stdout);assert.strictEqual(r.id, 'R-0010');
  const s = text(f.file);assert.ok(s.startsWith('\uFEFF'));assert.ok(s.includes('new ' + sample));assert.ok(s.includes('Keep notes ' + sample));assert.ok(s.includes('# Custom preface ' + sample));assert.ok(s.includes(row.trim()));
});
test('removal preserves archive signature, old entries and user notes', () => {
  const f = fixture(original, '\uFEFF' + archive);success(call(f, ['rule', 'remove', 'R-0001']));
  assert.ok(!text(f.file).includes('| R-0001 |'));assert.ok(text(f.file).includes('Keep notes ' + sample));
  const a = text(f.archive);assert.ok(a.startsWith('\uFEFF'));assert.ok(a.includes(archive.trim()));assert.ok(a.includes('| R-0001 | every-session | Keep ' + sample));
});
test('all status mutations preserve rule identity and original prose', () => {
  const f = fixture();
  for (const [cmd, expected] of [[['pause', 'R-0001'], 'paused'], [['resume', 'R-0001'], 'active'], [['stop'], 'paused'], [['resume-all'], 'active']]) {
    success(call(f, ['rule', ...cmd]));const rows = JSON.parse(success(call(f, ['rule', 'list'])).stdout).rules;
    assert.strictEqual(rows.length, 1);assert.strictEqual(rows[0].id, 'R-0001');assert.strictEqual(rows[0].rule, 'Keep ' + sample);assert.strictEqual(rows[0].status, expected);assert.strictEqual(rows[0].lastVerified, '-');assert.ok(text(f.file).includes('Keep notes ' + sample));
  }
});
test('ID allocation includes unparsable active rows and old archive IDs', () => {
  const f = fixture(original.replace(row, row + '| R-0019 | broken |\n'));
  const r = JSON.parse(success(call(f)).stdout);assert.strictEqual(r.id, 'R-0020');assert.ok(text(f.file).includes('| R-0019 | broken |'));
});
test('duplicate add preserves both source bytes and modification times', () => {
  const f = fixture(), before = snapshot(f);const r = JSON.parse(success(call(f, ['rule', 'add', 'Keep ' + sample])).stdout);
  assert.strictEqual(r.skipped, true);assert.deepStrictEqual(snapshot(f), before);
});
test('an otherwise skipped duplicate still rejects a changed captured source', () => {
  const f = fixture();failure(call(f, ['rule', 'add', 'Keep ' + sample], { mode: 'after-capture' }));assert.strictEqual(text(f.file), 'competing ' + sample);
});
test('repeated unchanged status mutation preserves bytes and modification times', () => {
  const f = fixture();success(call(f, ['rule', 'pause', 'R-0001']));const before = snapshot(f);success(call(f, ['rule', 'pause', 'R-0001']));assert.deepStrictEqual(snapshot(f), before);
});
test('unknown removal keeps both documents untouched', () => { rejectUnchanged(fixture(), ['rule', 'remove', 'R-9999']); });
test('invalid trigger cannot create an empty rule file as a side effect', () => {
  const f = fixture(null, null);rejectUnchanged(f, ['rule', 'add', 'new', '--trigger', 'invalid-trigger']);
});
test('malformed archive cannot supply a new rule identifier', () => {
  const f = fixture(original, Buffer.from([0xff]));const r = rejectUnchanged(f);assert.match(r.stdout + r.stderr, /invalid UTF-8/);
});
test('stale archive ID input prevents publication of a new active rule', () => {
  const f = fixture(), before = state(f.file);failure(call(f, undefined, { mode: 'after-capture', target: f.archive }));assert.deepStrictEqual(state(f.file), before);assert.strictEqual(text(f.archive), 'competing ' + sample);
});
test('malformed rules are also refused with force and human output', () => {
  const r = rejectUnchanged(fixture(Buffer.from([0xff])), ['rule', 'add', 'new', '--force'], { human: true });assert.match(r.stderr + r.stdout, /invalid UTF-8/);
});
test('truncated UTF-8 and UTF-16 input are refused without replacement', () => {
  for (const bytes of [[0xe3, 0x81], [0xff, 0xfe, 0x61, 0]]) { const r = rejectUnchanged(fixture(Buffer.from(bytes)));assert.match(r.stdout + r.stderr, /invalid UTF-8/); }
});
test('oversized active or archive input stops the operation without rewriting', () => {
  for (const target of ['file', 'archive']) { const f = fixture();fs.writeFileSync(f[target], Buffer.alloc(4 * 1024 * 1024 + 1, 32));const r = rejectUnchanged(f);assert.match(r.stdout + r.stderr, /exceeds/); }
});
test('invalid or oversized generated rule text is refused before publication', () => {
  for (const mode of ['surrogate', 'oversize']) { const r = rejectUnchanged(fixture(), undefined, { mode });assert.match(r.stdout + r.stderr, /surrogate|exceeds/); }
});
test('invalid active candidate prevents the earlier archive append', () => {
  const second = '| R-0002 | every-session | second | 2026-01-01 | active | - |\n', f = fixture(original.replace(row, row + second));
  const r = rejectUnchanged(f, ['rule', 'remove', 'R-0001'], { mode: 'bad-active' });assert.match(r.stdout + r.stderr, /surrogate/);
});
test('invalid archive candidate prevents both parts of removal', () => {
  const r = rejectUnchanged(fixture(), ['rule', 'remove', 'R-0001'], { mode: 'surrogate' });assert.match(r.stdout + r.stderr, /surrogate/);
});
test('hard-linked rule or archive sources and their aliases are preserved', () => {
  for (const target of ['file', 'archive']) { const f = fixture(), alias = path.join(f.dir, 'alias');fs.linkSync(f[target], alias);const before = state(alias);rejectUnchanged(f);assert.deepStrictEqual(state(alias), before); }
});
test('directory rule targets and their children are preserved', () => {
  const f = fixture(null);fs.mkdirSync(f.file);const child = path.join(f.file, 'keep.txt');fs.writeFileSync(child, sample);const before = state(child);failure(call(f));assert.deepStrictEqual(state(child), before);
});
test('fresh source appearing before capture is preserved when adding a rule', () => {
  const f = fixture();success(call(f, undefined, { mode: 'before-capture' }));assert.ok(text(f.file).includes('competing ' + sample));assert.ok(text(f.file).includes('new rule'));
});
function retained(dir, bytes) { return fs.readdirSync(dir, { withFileTypes: true }).some(e => { const p = path.join(dir, e.name);return e.isDirectory() ? retained(p, bytes) : e.isFile() && fs.readFileSync(p).equals(bytes); }); }
test('existing and absent rule targets refuse final publication conflicts', () => {
  for (const value of [original, null]) { const f = fixture(value);failure(call(f, undefined, { mode: 'publication' }));assert.ok(retained(f.dir, Buffer.from('competing ' + sample))); }
});
test('archive publication conflict leaves active rules in place', () => {
  const f = fixture(), before = state(f.file), r = failure(call(f, ['rule', 'remove', 'R-0001'], { mode: 'publication', target: f.archive }));
  assert.deepStrictEqual(state(f.file), before);assert.ok(retained(f.dir, Buffer.from('competing ' + sample)));assert.match(r.stdout + r.stderr, /active rules were not saved/);
});
test('intervening active edit after archive save reports partial progress', () => {
  const f = fixture(), r = failure(call(f, ['rule', 'remove', 'R-0001'], { mode: 'between', other: f.archive }));
  assert.strictEqual(text(f.file), 'competing ' + sample);assert.ok(text(f.archive).includes('| R-0001 |'));assert.match(r.stdout + r.stderr, /Rule archive saved.*not rolled back/);
});
test('late active publication conflict reports the saved archive', () => {
  const f = fixture(), r = failure(call(f, ['rule', 'remove', 'R-0001'], { mode: 'after-publication' }));
  assert.ok(retained(f.dir, Buffer.from('competing ' + sample)));assert.ok(text(f.archive).includes('| R-0001 |'));assert.match(r.stdout + r.stderr, /Rule archive saved/);
});
test('late archive publication conflict keeps active rules available', () => {
  const f = fixture(), before = state(f.file), r = failure(call(f, ['rule', 'remove', 'R-0001'], { mode: 'after-publication', target: f.archive }));
  assert.deepStrictEqual(state(f.file), before);assert.ok(retained(f.dir, Buffer.from('competing ' + sample)));assert.match(r.stdout + r.stderr, /active rules were not saved/);
});
test('add and remove acquire the rules lock before the archive lock', () => {
  for (const action of [['add', 'new'], ['remove', 'R-0001']]) { const f = fixture();success(call(f, ['rule', ...action], { mode: 'lock-order', other: f.archive })); }
});
test('dry-run leaves the entire project tree untouched', () => {
  const tree = dir => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(e => [e.name, e.isDirectory() ? tree(path.join(dir, e.name)) : state(path.join(dir, e.name))]);
  for (const action of [['add', 'new'], ['remove', 'R-0001'], ['pause', 'R-0001']]) { const f = fixture(), before = tree(f.dir);failure(call(f, ['rule', ...action, '--dry-run']));assert.deepStrictEqual(tree(f.dir), before); }
});
test('cooperating rule adds retain both additions with distinct IDs', () => {
  const f = fixture(), runner = path.join(arena, 'cooperators.cjs');
  fs.writeFileSync(runner, String.raw`
const cp=require('child_process'),fs=require('fs'),path=require('path');
const [cli,hook,dir,lib]=process.argv.slice(2),ready=dir+'-ready',go=dir+'-go',started=dir+'-started';const children=[];
const wait=async file=>{const end=Date.now()+15000;while(!fs.existsSync(file)){if(Date.now()>end)throw Error('coordinator deadline');await new Promise(r=>setTimeout(r,10));}};
const launch=(mode,note)=>{const c=cp.spawn(process.execPath,['--require',hook,cli,'rule','add',note,'--path',dir,'--json'],{windowsHide:true,env:{...process.env,LEERNESS_INTERNAL:'1',LEERNESS_OFFLINE:'1',LEERNESS_NO_AUTOCHCP:'1',LEERNESS_NO_STALE_CHECK:'1',RULE_TEXT_LIB:lib,RULE_TEXT_MODE:mode,RULE_TEXT_TARGET:path.join(dir,'.leerness','rules.md'),RULE_TEXT_WINNER:'',RULE_TEXT_READY:ready,RULE_TEXT_GO:go,RULE_TEXT_STARTED:mode==='peer'?started:''}});children.push(c);let output='';c.stdout.on('data',d=>output+=d);c.stderr.on('data',d=>output+=d);return new Promise((resolve,reject)=>{c.on('error',reject);c.on('close',code=>resolve({code,output}));});};
(async()=>{try{const first=launch('hold','FIRST_RULE');await wait(ready);const second=launch('peer','SECOND_RULE');await wait(started);fs.writeFileSync(go,'go');const results=await Promise.all([first,second]);if(results.some(r=>r.code!==0))throw Error(JSON.stringify(results));console.log('both mutations completed');}finally{fs.writeFileSync(go,'go');for(const c of children)if(c.exitCode===null)c.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
`);
  const r = cp.spawnSync(process.execPath, [runner, cli, hook, f.dir, path.resolve(__dirname, '../lib')], { encoding: 'utf8', timeout: 40000, windowsHide: true });assert.ifError(r.error);success(r);
  const rules = JSON.parse(success(call(f, ['rule', 'list'])).stdout).rules;assert.strictEqual(rules.length, 3);assert.strictEqual(new Set(rules.map(r => r.id)).size, 3);assert.ok(rules.some(r => r.rule === 'FIRST_RULE'));assert.ok(rules.some(r => r.rule === 'SECOND_RULE'));assert.ok(text(f.file).includes('Keep notes ' + sample));
});
console.log(`Tests: ${passed}/${passed + failed} passed`);process.exitCode = failed ? 1 : 0;
