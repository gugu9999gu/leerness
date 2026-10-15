'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-generation-text-'));
  try {
    const env = { ...process.env, GENERATION_PROBE_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 300000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-generation-text-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.GENERATION_PROBE_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const sample = '한글 English 日本語 中文 🐝 e\u0301 \uFFFD', authored = '# Custom instructions\r\n\r\nKeep ' + sample + '\r\n';
let sequence = 0, passed = 0, failed = 0;
const at = process.argv.indexOf('--match'), filter = at < 0 ? '' : process.argv[at + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
function state(file) { if (!fs.existsSync(file)) return null;const s = fs.statSync(file, { bigint: true });return { sha: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(s.mtimeNs) }; }
function fixture(value = authored) {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'HARNESS_VERSION'), require('../package.json').version);fs.writeFileSync(path.join(ws, 'LANGUAGE'), 'en');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'generation-test', version: '1.0.0' }));
  const file = path.join(dir, 'AGENTS.md');if (value !== null) fs.writeFileSync(file, value);
  return { dir, ws, file };
}
const hook = path.join(arena, 'boundary-hook.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),cp=require('child_process'),path=require('path'),base=process.env.GEN_LIB,target=process.env.GEN_TARGET,mode=process.env.GEN_MODE;
const write=fs.writeFileSync.bind(fs),bytes=Buffer.from(process.env.GEN_WINNER,'base64');let fired=false;
if(process.env.GEN_STARTED)write(process.env.GEN_STARTED,'started');
const inject=p=>{if(!fired&&p===target){fired=true;write(p,bytes);}};
const io=require(path.join(base,'io')),read=io.read;
io.read=function(p){const result=read(p);if(mode==='after-capture')inject(p);return result;};
const mod=require(path.join(base,'managed-text')),capture=mod.captureTextEdit;
mod.captureTextEdit=function(p){const result=capture(p);if(mode==='after-capture')inject(p);if(mode==='hold'&&p===target){write(process.env.GEN_READY,'ready');const end=Date.now()+12000;while(!fs.existsSync(process.env.GEN_GO)){if(Date.now()>end)throw Error('holder deadline');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}}return result;};
const captureBefore=mod.captureTextEdit;mod.captureTextEdit=function(p){if(mode==='before-capture')inject(p);return captureBefore(p);};
const pure=require(path.join(base,'pure-utils')),merge=pure._managedMerge;
pure._managedMerge=function(...args){const result=merge(...args);return mode==='surrogate'?result+'\uD800':mode==='oversize'?'a'.repeat(4*1024*1024+1):mode==='bad-type'?42:result+(process.env.GEN_APPEND?'\n'+process.env.GEN_APPEND+'\n':'');};
const rename=fs.renameSync.bind(fs);fs.renameSync=function(a,b){if(mode==='publication'&&a===target)inject(a);return rename(a,b);};
const open=fs.openSync.bind(fs);fs.openSync=function(p,flags,...rest){if(mode==='publication'&&p===target&&flags==='wx')inject(p);return open(p,flags,...rest);};
const spawn=cp.spawnSync.bind(cp);cp.spawnSync=function(a,b,o){if(o?.env?.LEERNESS_REPLACE_TO===target){if(mode==='publication')inject(target);const r=spawn(a,b,o);if(mode==='after-publication'&&r.status===0)inject(target);return r;}return spawn(a,b,o);};
const link=fs.linkSync.bind(fs);fs.linkSync=function(a,b){if(mode==='publication')inject(b);const r=link(a,b);if(mode==='after-publication')inject(b);return r;};
`);
// T-0337: the partial-save notes and the memory input and output errors follow the project language of the commands'
// own text. These fixtures carry .leerness/LANGUAGE=en without a manifest, which that rule reads as Korean, so the
// English expectations run with LEERNESS_LANG=en.
function call(f, args = ['adapter', 'codex'], opts = {}) {
  const r = cp.spawnSync(process.execPath, [...(opts.mode ? ['--require', hook] : []), cli, ...args, '--path', f.dir, ...(opts.human ? [] : ['--json'])], {
    cwd: f.dir, encoding: 'utf8', timeout: 90000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1', LEERNESS_LANG: 'en',
      GEN_LIB: path.resolve(__dirname, '../lib'), GEN_MODE: opts.mode || '', GEN_TARGET: opts.target || f.file, GEN_WINNER: Buffer.from(opts.winner || 'competing ' + sample).toString('base64') } });
  assert.ifError(r.error);return r;
}
const text = file => fs.readFileSync(file, 'utf8'), success = r => assert.strictEqual(r.status, 0, r.stdout + r.stderr);
function failure(r) { assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);assert.ok(!/"ok"\s*:\s*true/.test(r.stdout));return r; }
function rejectUnchanged(f, args, opts) { const before = state(f.file), r = failure(call(f, args, opts));assert.deepStrictEqual(state(f.file), before);return r; }
test('adapter rejects malformed managed text without replacing its bytes', () => { rejectUnchanged(fixture(Buffer.concat([Buffer.from(authored), Buffer.from([0xff])]))); });
test('managed merge preserves the existing UTF-8 signature and authored Unicode', () => { const f = fixture('\uFEFF' + authored);success(call(f));assert.ok(text(f.file).startsWith('\uFEFF'));assert.ok(text(f.file).includes(sample)); });
test('adapter refuses a stale read and preserves the competing instruction', () => { const f = fixture();failure(call(f, undefined, { mode: 'after-capture' }));assert.strictEqual(text(f.file), 'competing ' + sample); });
test('invalid generated merge Unicode is refused before publication', () => { rejectUnchanged(fixture(), undefined, { mode: 'surrogate' }); });
test('new adapter instructions retain selected language and have no added signature', () => { const f = fixture(null);success(call(f));assert.ok(text(f.file).includes('Required behavior'));assert.ok(!text(f.file).startsWith('\uFEFF')); });
test('repeated unchanged adapter calls preserve bytes and modification time', () => { const f = fixture(null);success(call(f));const before = state(f.file);success(call(f));assert.deepStrictEqual(state(f.file), before); });
test('repeated merged instructions retain authored text once and stop rewriting', () => { const f = fixture();success(call(f));const before = state(f.file);success(call(f));assert.deepStrictEqual(state(f.file), before);assert.strictEqual(text(f.file).split(sample).length, 2); });
test('force still merges managed custom instructions', () => { const f = fixture();success(call(f, ['adapter', 'codex', '--force']));assert.ok(text(f.file).includes(sample)); });
test('human output and force cannot bypass malformed text rejection', () => { rejectUnchanged(fixture(Buffer.from([0xff])), ['adapter', 'codex', '--force'], { human: true }); });
test('truncated UTF-8 and UTF-16 sources remain unchanged on refusal', () => { for (const bytes of [[0xe3, 0x81], [0xff, 0xfe, 0x61, 0]]) rejectUnchanged(fixture(Buffer.from(bytes))); });
test('oversized source is rejected before merge can reduce it', () => { rejectUnchanged(fixture('a'.repeat(4 * 1024 * 1024 + 1))); });
test('oversized or non-text merge candidates do not replace the source', () => { for (const mode of ['oversize', 'bad-type']) rejectUnchanged(fixture(), undefined, { mode }); });
test('existing hard links and their aliases remain unchanged on refusal', () => { const f = fixture(), alias = path.join(f.dir, 'alias');fs.linkSync(f.file, alias);const before = state(alias);rejectUnchanged(f);assert.deepStrictEqual(state(alias), before); });
test('directory instruction targets are refused without removing their contents', () => { const f = fixture(null);fs.mkdirSync(f.file);const child = path.join(f.file, 'keep.txt');fs.writeFileSync(child, sample);const before = state(child);failure(call(f));assert.deepStrictEqual(state(child), before); });
test('fresh content appearing before capture is included in the merge', () => { const f = fixture();success(call(f, undefined, { mode: 'before-capture' }));assert.ok(text(f.file).includes('competing ' + sample)); });
test('an otherwise unchanged candidate still rejects a stale snapshot', () => { const f = fixture(null);success(call(f));failure(call(f, undefined, { mode: 'after-capture' }));assert.strictEqual(text(f.file), 'competing ' + sample); });
function retained(dir, bytes) { return fs.readdirSync(dir, { withFileTypes: true }).some(e => { const p = path.join(dir, e.name);return e.isDirectory() ? retained(p, bytes) : e.isFile() && fs.readFileSync(p).equals(bytes); }); }
test('existing and newly created files reject final publication conflicts', () => { for (const original of [authored, null]) { const f = fixture(original);failure(call(f, undefined, { mode: 'publication' }));assert.ok(retained(f.dir, Buffer.from('competing ' + sample))); } });
test('late publication conflict preserves competing content and reports failure', () => { const f = fixture();failure(call(f, undefined, { mode: 'after-publication' }));assert.ok(retained(f.dir, Buffer.from('competing ' + sample))); });
test('non-managed adapter payloads are preserved even when their text is invalid', () => {
  const f = fixture(), target = path.join(f.dir, '.claude', 'commands', 'handoff.md');fs.mkdirSync(path.dirname(target), { recursive: true });fs.writeFileSync(target, Buffer.from([0xff]));const before = state(target);
  success(call(f, ['adapter', 'claude']));assert.deepStrictEqual(state(target), before);assert.ok(text(path.join(f.dir, 'CLAUDE.md')).includes('leerness handoff'));
});
test('a later adapter failure identifies already completed file steps', () => {
  const f = fixture(), target = path.join(f.dir, '.claude', 'commands', 'handoff.md');fs.mkdirSync(path.dirname(target), { recursive: true });
  const r = failure(call(f, ['adapter', 'claude'], { mode: 'publication', target }));
  assert.match(r.stdout + r.stderr, /earlier file steps completed.*not rolled back/);assert.ok(text(path.join(f.dir, 'CLAUDE.md')).includes('leerness handoff'));assert.strictEqual(text(target), 'competing ' + sample);
});
test('non-managed content created before capture keeps preserve-by-default behavior', () => {
  const f = fixture(), target = path.join(f.dir, '.claude', 'commands', 'handoff.md');success(call(f, ['adapter', 'claude'], { mode: 'before-capture', target }));assert.strictEqual(text(target), 'competing ' + sample);
});
const init = f => ['init', f.dir, '--yes', '--minimal', '--no-setup-agents', '--no-mcp', '--no-auto-roadmap', '--no-official-skills', '--no-banner'];
test('fresh minimal init creates usable managed instructions', () => { const f = fixture(null);success(call(f, [...init(f), '--language', 'en']));assert.ok(text(f.file).includes('leerness handoff'));assert.ok(fs.existsSync(path.join(f.ws, 'plan.md'))); });
test('init refuses invalid Unicode generated from project metadata', () => { const f = fixture(null);fs.writeFileSync(path.join(f.dir, 'package.json'), JSON.stringify({ name: '\uD800' }));const r = failure(call(f, [...init(f).filter(x => x !== '--minimal'), '--no-env']));assert.match(r.stdout + r.stderr, /unpaired surrogate/); });
test('force init does not replace malformed generated metadata', () => {
  const f = fixture(), target = path.join(f.ws, 'LANGUAGE');fs.writeFileSync(target, Buffer.from([0xff]));const before = state(target);failure(call(f, [...init(f), '--force', '--language', 'en']));assert.deepStrictEqual(state(target), before);
});
test('init preserves a malformed first instruction and keeps its original backup', () => {
  const bytes = Buffer.concat([Buffer.from(authored), Buffer.from([0xff])]), f = fixture(bytes), r = rejectUnchanged(f, init(f));assert.match(r.stdout + r.stderr, /File generation stopped at AGENTS.md.*not rolled back/);assert.ok(retained(path.join(f.ws, 'archive'), bytes));
});
test('later init failure keeps earlier generated instructions and identifies partial progress', () => {
  const f = fixture(), later = path.join(f.dir, 'CLAUDE.md');fs.writeFileSync(later, Buffer.from([0xff]));const before = state(later), r = failure(call(f, init(f)));
  assert.match(r.stdout + r.stderr, /stopped at CLAUDE.md; 1 earlier file steps completed/);assert.deepStrictEqual(state(later), before);assert.ok(text(f.file).includes('leerness handoff') && text(f.file).includes(sample));
});
test('force init retains user state and managed custom instructions', () => {
  const f = fixture(), userFile = path.join(f.ws, 'plan.md');fs.writeFileSync(userFile, Buffer.from([0xff]));const before = state(userFile);success(call(f, [...init(f), '--force']));assert.deepStrictEqual(state(userFile), before);assert.ok(text(f.file).includes(sample));
});
test('migration refuses damaged instructions before replacing their source bytes', () => { const f = fixture(Buffer.from([0xff]));rejectUnchanged(f, ['migrate', f.dir, '--yes', '--no-setup-agents', '--no-auto-roadmap', '--no-mcp']); });
test('language switch retains custom Unicode while replacing managed language text', () => {
  const f = fixture();success(call(f, [...init(f), '--language', 'en']));assert.ok(text(f.file).includes(sample));success(call(f, [...init(f), '--language', 'ko']));assert.ok(text(f.file).includes(sample));assert.strictEqual(text(path.join(f.ws, 'LANGUAGE')).trim(), 'ko');
});
test('generated update command refuses malformed existing instructions', () => {
  const f = fixture(), target = path.join(f.dir, '.claude', 'commands', 'update.md');fs.mkdirSync(path.dirname(target), { recursive: true });fs.writeFileSync(target, Buffer.from([0xff]));const before = state(target);failure(call(f, ['auto-update', 'install', f.dir]));assert.deepStrictEqual(state(target), before);
});
test('cooperating adapter merges retain both newly authored fragments', () => {
  const f = fixture(), runner = path.join(arena, 'cooperators.cjs');
  fs.writeFileSync(runner, String.raw`
const cp=require('child_process'),fs=require('fs'),path=require('path');
const [cli,hook,dir,lib]=process.argv.slice(2),ready=dir+'-ready',go=dir+'-go',started=dir+'-started';const children=[];
const wait=async file=>{const end=Date.now()+12000;while(!fs.existsSync(file)){if(Date.now()>end)throw Error('coordinator deadline');await new Promise(r=>setTimeout(r,10));}};
const launch=(mode,note)=>{const c=cp.spawn(process.execPath,['--require',hook,cli,'adapter','codex','--path',dir,'--json'],{windowsHide:true,env:{...process.env,LEERNESS_INTERNAL:'1',LEERNESS_OFFLINE:'1',LEERNESS_NO_AUTOCHCP:'1',LEERNESS_NO_STALE_CHECK:'1',GEN_LIB:lib,GEN_MODE:mode,GEN_TARGET:path.join(dir,'AGENTS.md'),GEN_WINNER:'',GEN_APPEND:note,GEN_READY:ready,GEN_GO:go,GEN_STARTED:mode==='peer'?started:''}});children.push(c);let output='';c.stdout.on('data',d=>output+=d);c.stderr.on('data',d=>output+=d);return new Promise((resolve,reject)=>{c.on('error',reject);c.on('close',code=>resolve({code,output}));});};
(async()=>{try{const first=launch('hold','FIRST_ADAPTER');await wait(ready);const second=launch('peer','SECOND_ADAPTER');await wait(started);fs.writeFileSync(go,'go');const results=await Promise.all([first,second]);if(results.some(r=>r.code!==0))throw Error(JSON.stringify(results));console.log('both adapter merges completed');}finally{fs.writeFileSync(go,'go');for(const c of children)if(c.exitCode===null)c.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
`);
  const r = cp.spawnSync(process.execPath, [runner, cli, hook, f.dir, path.resolve(__dirname, '../lib')], { encoding: 'utf8', timeout: 35000, windowsHide: true });assert.ifError(r.error);success(r);
  const current = text(f.file);assert.ok(current.includes('FIRST_ADAPTER') && current.includes('SECOND_ADAPTER') && current.includes(sample));
});
test('adapter and init dry runs keep the complete fixture tree unchanged', () => {
  const tree = dir => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(e => [e.name, e.isDirectory() ? tree(path.join(dir, e.name)) : state(path.join(dir, e.name))]);
  for (const kind of ['adapter', 'init']) { const f = fixture(Buffer.from([0xff])), before = tree(f.dir);success(call(f, [...(kind === 'init' ? init(f) : ['adapter', 'codex']), '--dry-run']));assert.deepStrictEqual(tree(f.dir), before); }
});
console.log(`Tests: ${passed}/${passed + failed} passed`);process.exitCode = failed ? 1 : 0;
