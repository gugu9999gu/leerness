'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mode-text-'));
  try {
    const env = { ...process.env, MODE_TEXT_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 600000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-mode-text-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.MODE_TEXT_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
delete process.env.LEERNESS_LANG;
const sample = '한글 English 日本語 中文 e\u0301 🐝 \uFFFD', authored = '# Custom notes\r\n\r\nKeep ' + sample + '\r\n';
let sequence = 0, passed = 0, failed = 0;
const at = process.argv.indexOf('--match'), filter = at < 0 ? '' : process.argv[at + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
function fixture() {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  const f = { dir, ws, manifest: path.join(ws, 'manifest.json'), agents: path.join(dir, 'AGENTS.md'), claude: path.join(dir, 'CLAUDE.md') };
  fs.writeFileSync(path.join(ws, 'HARNESS_VERSION'), require('../package.json').version);fs.writeFileSync(path.join(ws, 'LANGUAGE'), 'en');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"mode-text-test","version":"1.0.0"}\n');
  fs.writeFileSync(f.manifest, JSON.stringify({ language: 'en', mode: 'standard', project: sample, installedAt: '2026-01-01', custom: { note: sample } }));
  fs.writeFileSync(f.agents, authored);fs.writeFileSync(f.claude, authored);return f;
}
function state(file) { if (!fs.existsSync(file)) return null;const s = fs.statSync(file, { bigint: true });return { sha: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(s.mtimeNs) }; }
const text = p => fs.readFileSync(p, 'utf8'), snapshot = f => [state(f.manifest), state(f.agents), state(f.claude)];
const hook = path.join(arena, 'boundary-hook.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),cp=require('child_process'),path=require('path'),base=process.env.MODE_TEXT_LIB,target=process.env.MODE_TEXT_TARGET,mode=process.env.MODE_TEXT_MODE;
const write=fs.writeFileSync.bind(fs),bytes=Buffer.from(process.env.MODE_TEXT_WINNER,'base64');let fired=false;
if(process.env.MODE_TEXT_STARTED)write(process.env.MODE_TEXT_STARTED,'started');
const inject=p=>{if(!fired&&p===target){fired=true;write(p,bytes);}};
const locks=require(path.join(base,'state-lock')),io=require(path.join(base,'io')),read=io.read,oldWrite=io.writeUtf8;
io.read=function(p){const result=read(p);if(mode==='after-capture'&&(path.basename(p)!=='manifest.json'||locks.isStateLockHeld(p)))inject(p);return result;};
io.writeUtf8=function(p,...a){if(mode==='write-failure'&&p===target)throw Error('injected save failure');return oldWrite(p,...a);};
const mod=require(path.join(base,'managed-text')),capture=mod.captureTextEdit,publish=mod.publishTextEdit;
mod.captureTextEdit=function(p,...a){
  if(mode==='before-capture')inject(p);const result=capture(p,...a);if(mode==='after-capture')inject(p);
  if(mode==='hold'&&p===target){write(process.env.MODE_TEXT_READY,'ready');const end=Date.now()+15000;while(!fs.existsSync(process.env.MODE_TEXT_GO)){if(Date.now()>end)throw Error('holder deadline');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}}
  if(mode==='lock-order'){const root=process.env.MODE_TEXT_PROJECT;for(const f of [path.join(root,'.leerness','manifest.json'),path.join(root,'AGENTS.md'),path.join(root,'CLAUDE.md')])if(!locks.isStateLockHeld(f))throw Error('all mode locks must be held before capture');}
  return result;
};
mod.publishTextEdit=function(s,p,t){if(mode==='write-failure'&&p===target)throw Error('injected save failure');const r=publish(s,p,t);if(mode==='between'&&p===process.env.MODE_TEXT_OTHER)inject(target);return r;};
const pure=require(path.join(base,'pure-utils')),merge=pure._managedMerge;
pure._managedMerge=function(...a){const r=merge(...a);if(a[0]!==path.basename(target))return r;if(mode==='bad-merge')return r+'\uD800';if(mode==='large-merge')return 'a'.repeat(4*1024*1024+1);if(mode==='merge-failure')throw Error('injected merge failure');return r;};
const stringify=JSON.stringify;JSON.stringify=function(v,...a){const r=stringify(v,...a);if(locks.isStateLockHeld(target)&&v&&v.mode==='minimal'&&v.custom){if(mode==='bad-json-output')return r+'\uD800';if(mode==='large-json-output')return r+' '.repeat(64*1024);}return r;};
const rename=fs.renameSync.bind(fs);fs.renameSync=function(a,b){if(mode==='publication'&&a===target)inject(a);return rename(a,b);};
const open=fs.openSync.bind(fs);fs.openSync=function(p,flags,...args){if(mode==='publication'&&p===target&&flags==='wx')inject(p);return open(p,flags,...args);};
const spawn=cp.spawnSync.bind(cp);cp.spawnSync=function(a,b,o){if(o?.env?.LEERNESS_REPLACE_TO===target){if(mode==='publication')inject(target);const r=spawn(a,b,o);if(mode==='after-publication'&&r.status===0)inject(target);return r;}return spawn(a,b,o);};
const link=fs.linkSync.bind(fs);fs.linkSync=function(a,b){if(mode==='publication')inject(b);const r=link(a,b);if(mode==='after-publication')inject(b);return r;};
`);
function call(f, opts = {}) {
  const r = cp.spawnSync(process.execPath, [...(opts.mode ? ['--require', hook] : []), cli, 'mode', ...(opts.args || ['set', 'minimal']), '--path', f.dir, ...(opts.human ? [] : ['--json'])], {
    cwd: f.dir, encoding: 'utf8', timeout: 45000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
      MODE_TEXT_LIB: path.resolve(__dirname, '../lib'), MODE_TEXT_MODE: opts.mode || '', MODE_TEXT_TARGET: opts.target || f.manifest, MODE_TEXT_WINNER: Buffer.from(opts.winner || 'competing ' + sample).toString('base64'), MODE_TEXT_PROJECT: f.dir, MODE_TEXT_OTHER: opts.other || '', ...(opts.env || {}) } });
  assert.ifError(r.error);return r;
}
function success(r) { assert.strictEqual(r.status, 0, r.stdout + r.stderr);return r; }
function failure(r) { assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);assert.ok(!/"ok"\s*:\s*true/.test(r.stdout));return r; }
function rejectUnchanged(f, opts) {
  const before = snapshot(f), r = call(f, opts), after = snapshot(f);
  if (r.status === 0) console.log('Observation: ' + JSON.stringify({ exit: r.status, changed: before.map((v, i) => JSON.stringify(v) !== JSON.stringify(after[i])), output: r.stdout.trim() }));
  failure(r);assert.deepStrictEqual(after, before);return r;
}
for (const key of ['manifest', 'agents', 'claude']) test('repro malformed source refused before any save: ' + key, () => {
  const f = fixture();
  fs.writeFileSync(f[key], key === 'manifest' ? Buffer.concat([Buffer.from('{"language":"en","project":"'), Buffer.from([0xff]), Buffer.from('"}')]) : Buffer.concat([Buffer.from(authored), Buffer.from([0xff])]));
  const r = rejectUnchanged(f);assert.match(r.stdout + r.stderr, /invalid UTF-8/);
});
for (const key of ['manifest', 'agents']) test('repro stale captured source is rejected: ' + key, () => {
  const f = fixture(), r = call(f, { mode: 'after-capture', target: f[key] });
  if (r.status === 0) console.log('Observation: stale ' + key + ' returned success; winner retained=' + (text(f[key]) === 'competing ' + sample));
  failure(r);assert.strictEqual(text(f[key]), 'competing ' + sample);
});
test('repro invalid second instruction target is rejected before saving the mode', () => {
  const f = fixture(), before = [state(f.manifest), state(f.agents)];fs.unlinkSync(f.claude);fs.mkdirSync(f.claude);const child = path.join(f.claude, 'keep');fs.writeFileSync(child, sample);
  const r = call(f);if (r.status === 0) console.log('Observation: directory instruction target returned success');failure(r);assert.deepStrictEqual([state(f.manifest), state(f.agents)], before);assert.strictEqual(text(child), sample);
});
test('repro invalid authoring policy is rejected before the manifest changes', () => {
  const f = fixture(), m = JSON.parse(text(f.manifest));m.authoringLanguage = 'invalid-policy';fs.writeFileSync(f.manifest, JSON.stringify(m));rejectUnchanged(f);
});
test('repro late instruction save failure is not reported as success', () => {
  const f = fixture(), before = state(f.claude), r = call(f, { mode: 'write-failure', target: f.claude });
  if (r.status === 0) console.log('Observation: injected save failure returned success');failure(r);assert.match(r.stdout + r.stderr, /injected save failure/);assert.deepStrictEqual(state(f.claude), before);
});
const parse = p => JSON.parse(text(p).replace(/^\uFEFF/, ''));
const files = ['.leerness/manifest.json', 'AGENTS.md', 'CLAUDE.md'];
test('valid multilingual metadata, signatures and authored notes survive both modes', () => {
  const f = fixture(), original = parse(f.manifest);original.__proto__ = undefined;
  // Define an own key without invoking Object.prototype's setter.
  Object.defineProperty(original, '__proto__', { value: { note: sample }, enumerable: true });
  for (const key of ['manifest', 'agents', 'claude']) fs.writeFileSync(f[key], '\uFEFF' + (key === 'manifest' ? JSON.stringify(original) : authored));
  for (const mode of ['minimal', 'standard']) {
    const r = JSON.parse(success(call(f, { args: ['set', mode] })).stdout);assert.strictEqual(r.mode, mode);assert.strictEqual(r.regenerated, 2);
    assert.deepStrictEqual(parse(f.manifest), { ...original, mode });
    for (const key of ['manifest', 'agents', 'claude']) assert.ok(text(f[key]).startsWith('\uFEFF'));
    for (const key of ['agents', 'claude']) {
      assert.ok(text(f[key]).includes('Keep ' + sample));
      const commands = mode === 'minimal' || key === 'claude' ? ['leerness handoff', 'verify-claim', 'session close'] : ['leerness handoff', 'session close'];
      for (const command of commands) assert.ok(text(f[key]).includes(command), mode + '/' + key + ': ' + command);
      assert.strictEqual(text(f[key]).includes('Instructions (minimal)'), mode === 'minimal' && key === 'agents');
    }
  }
});
test('authoring selection and user language remain separate during regeneration', () => {
  const f = fixture(), m = parse(f.manifest);m.language = 'ko';m.authoringLanguage = 'en';fs.writeFileSync(f.manifest, JSON.stringify(m));
  const r = success(call(f, { human: true }));assert.match(r.stdout, /운영 등급/);
  for (const key of ['agents', 'claude']) { assert.match(text(f[key]), /Write new harness instructions, work notes and delegated artifacts in English/);assert.match(text(f[key]), /otherwise Korean/); }
  assert.strictEqual(parse(f.manifest).language, 'ko');assert.strictEqual(parse(f.manifest).authoringLanguage, 'en');
});
test('language override guides output without rewriting the saved language', () => {
  const f = fixture();success(call(f, { args: ['set', 'minimal', '--language', 'ko'] }));assert.strictEqual(parse(f.manifest).language, 'en');assert.match(text(f.agents), /최소 등급/);
});
test('fresh captured metadata drives policy and is retained', () => {
  const f = fixture(), m = parse(f.manifest);m.authoringLanguage = 'ko';m.custom.note = 'fresh ' + sample;
  success(call(f, { mode: 'before-capture', winner: JSON.stringify(m) }));assert.deepStrictEqual(parse(f.manifest), { ...m, mode: 'minimal' });assert.match(text(f.agents), /artifacts in Korean/);
});
test('new instruction files are generated without an added signature', () => {
  const f = fixture();for (const key of ['agents', 'claude']) fs.unlinkSync(f[key]);success(call(f));for (const key of ['agents', 'claude']) { assert.ok(text(f[key]).includes('leerness handoff'));assert.ok(!text(f[key]).startsWith('\uFEFF')); }
});
test('a missing manifest retains the previous default-mode behavior', () => {
  const f = fixture();fs.unlinkSync(f.manifest);const r = JSON.parse(success(call(f)).stdout);assert.strictEqual(r.previous, 'standard');assert.deepStrictEqual(parse(f.manifest), { mode: 'minimal' });
});
test('repeated unchanged mode keeps all three modification times and bytes', () => {
  const f = fixture();success(call(f));const before = snapshot(f);success(call(f));assert.deepStrictEqual(snapshot(f), before);
});
test('an existing specific backup pointer is retained without inventing a backup', () => {
  const f = fixture(), backup = path.join(f.ws, 'archive', 'original');fs.mkdirSync(backup, { recursive: true });
  fs.writeFileSync(f.agents, authored + '\n<!-- leerness:migration-preserved -->\n## Preserved previous content\n\n> Full original backup: `.leerness/archive/original`\n\nSaved ' + sample + '\n');
  success(call(f));assert.ok(text(f.agents).includes('`.leerness/archive/original`'));assert.deepStrictEqual(fs.readdirSync(backup), []);
});
test('corrupt JSON and non-object manifests retain the established error contract', () => {
  for (const data of ['{broken', '[]', 'null', '42']) { const f = fixture();fs.writeFileSync(f.manifest, data);const r = rejectUnchanged(f);assert.strictEqual(JSON.parse(r.stdout).code, 'manifest_corrupt'); }
});
test('invalid mode and force cannot bypass preflight', () => {
  const f = fixture();assert.strictEqual(JSON.parse(rejectUnchanged(f, { args: ['set', 'unknown'] }).stdout).code, 'invalid_mode');
  fs.writeFileSync(f.agents, Buffer.from([0xff]));assert.match(rejectUnchanged(f, { args: ['set', 'minimal', '--force'] }).stdout, /invalid UTF-8/);
});
test('truncated UTF-8 and UTF-16 are rejected without conversion', () => {
  for (const bytes of [[0xe3, 0x81], [0xff, 0xfe, 0x61, 0]]) { const f = fixture();fs.writeFileSync(f.claude, Buffer.from(bytes));assert.match(rejectUnchanged(f).stdout, /invalid UTF-8/); }
});
test('manifest input and output both honor the smaller 64 KiB bound', () => {
  const f = fixture();fs.writeFileSync(f.manifest, ' '.repeat(64 * 1024 + 1));rejectUnchanged(f);
  const g = fixture();assert.match(rejectUnchanged(g, { mode: 'large-json-output' }).stdout, /65536 byte boundary/);
});
test('manifest byte bound includes an existing signature exactly', () => {
  for (const bom of ['', '\uFEFF']) {
    const f = fixture(), m = { mode: 'minimal', language: 'en', padding: '' };
    const fixed = JSON.stringify(m, null, 2) + '\n';m.padding = 'a'.repeat(64 * 1024 - Buffer.byteLength(bom + fixed));
    fs.writeFileSync(f.manifest, bom + JSON.stringify(m, null, 2) + '\n');assert.strictEqual(fs.statSync(f.manifest).size, 64 * 1024);success(call(f));assert.strictEqual(fs.statSync(f.manifest).size, 64 * 1024);
  }
});
test('a smaller managed-text bound remains attached to the captured snapshot', () => {
  const f = fixture(), p = path.join(f.dir, 'bounded.txt'), storage = require('../lib/managed-text'), locks = require('../lib/state-lock');
  fs.writeFileSync(p, '\uFEFF한');const before = state(p), options = { maxBytes: 6 };
  locks.withStateLock(p, () => {
    const captured = storage.captureTextEdit(p, options);options.maxBytes = 100;
    assert.throws(() => storage.publishTextEdit(captured, p, '한글'), /6 byte boundary/);assert.deepStrictEqual(state(p), before);
    storage.publishTextEdit(captured, p, '한');assert.deepStrictEqual(state(p), before);
    for (const maxBytes of [-1, null, Infinity, 1.5, 4 * 1024 * 1024 + 1]) assert.throws(() => storage.captureTextEdit(p, { maxBytes }), /requires a byte limit/);
  });
});
test('oversized prose input is rejected before any save', () => {
  const f = fixture();fs.writeFileSync(f.claude, 'a'.repeat(4 * 1024 * 1024 + 1));rejectUnchanged(f);
});
for (const mode of ['bad-json-output', 'bad-merge', 'large-merge', 'merge-failure']) test('generated candidate failure prevents every save: ' + mode, () => {
  const f = fixture(), r = rejectUnchanged(f, { mode, target: mode === 'bad-json-output' ? f.manifest : f.claude }), j = JSON.parse(r.stdout);
  assert.strictEqual(j.phase, 'preflight');assert.deepStrictEqual(j.completedFiles, []);assert.strictEqual(j.publicationAttempted, false);assert.match(j.error, /surrogate|exceeds|injected merge failure/);
});
test('hard-linked sources and their aliases are not rewritten', () => {
  for (const key of ['manifest', 'agents', 'claude']) { const f = fixture(), alias = path.join(f.dir, 'alias');fs.linkSync(f[key], alias);const before = state(alias);rejectUnchanged(f);assert.deepStrictEqual(state(alias), before); }
});
function retained(dir, bytes) { return fs.readdirSync(dir, { withFileTypes: true }).some(e => { const p = path.join(dir, e.name);return e.isDirectory() ? retained(p, bytes) : e.isFile() && fs.readFileSync(p).equals(bytes); }); }
for (const mode of ['publication', 'after-publication']) test('detected final conflicts retain recoverable competing content: ' + mode, () => {
  for (const [i, key] of ['manifest', 'agents', 'claude'].entries()) {
    const f = fixture(), r = failure(call(f, { mode, target: f[key] })), j = JSON.parse(r.stdout);
    assert.strictEqual(j.phase, 'publication');assert.strictEqual(j.publicationAttempted, true);assert.deepStrictEqual(j.completedFiles, files.slice(0, i));assert.strictEqual(j.failedFile, files[i]);assert.ok(retained(f.dir, Buffer.from('competing ' + sample)));
  }
});
test('exclusive creation refuses an instruction file created during publication', () => {
  const f = fixture();fs.unlinkSync(f.agents);const r = failure(call(f, { mode: 'publication', target: f.agents }));assert.strictEqual(JSON.parse(r.stdout).failedFile, 'AGENTS.md');assert.ok(retained(f.dir, Buffer.from('competing ' + sample)));
});
test('an intervening instruction edit is retained after manifest publication', () => {
  const f = fixture(), r = failure(call(f, { mode: 'between', target: f.agents, other: f.manifest })), j = JSON.parse(r.stdout);
  assert.strictEqual(parse(f.manifest).mode, 'minimal');assert.strictEqual(text(f.agents), 'competing ' + sample);assert.strictEqual(text(f.claude), authored);assert.deepStrictEqual(j.completedFiles, [files[0]]);
});
test('save failures identify confirmed earlier steps without claiming rollback', () => {
  for (const [i, key] of ['manifest', 'agents', 'claude'].entries()) {
    const f = fixture(), before = snapshot(f), r = failure(call(f, { mode: 'write-failure', target: f[key] })), j = JSON.parse(r.stdout);
    assert.strictEqual(j.failedFile, files[i]);assert.deepStrictEqual(j.completedFiles, files.slice(0, i));assert.strictEqual(j.rolledBack, false);assert.strictEqual(j.requestedMode, 'minimal');assert.ok(!Object.hasOwn(j, 'mode'));
    assert.deepStrictEqual(snapshot(f).slice(i), before.slice(i));
  }
});
test('human failures explain partial progress in the requested language', () => {
  const f = fixture(), r = failure(call(f, { mode: 'write-failure', target: f.claude, human: true }));assert.match(r.stdout, /Completed save steps: .leerness\/manifest.json, AGENTS.md/);assert.match(r.stdout, /not rolled back/);assert.doesNotMatch(r.stdout, /Operating mode:/);
});
test('all three canonical locks are held during source preparation', () => {
  const f = fixture();success(call(f, { mode: 'lock-order' }));
});
test('dry-run leaves the project tree untouched', () => {
  const tree = dir => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(e => [e.name, e.isDirectory() ? tree(path.join(dir, e.name)) : state(path.join(dir, e.name))]);
  const f = fixture(), before = tree(f.dir);failure(call(f, { args: ['set', 'minimal', '--dry-run'] }));assert.deepStrictEqual(tree(f.dir), before);
});
test('get remains read-only for valid state', () => {
  const f = fixture(), before = snapshot(f), r = JSON.parse(success(call(f, { args: ['get'] })).stdout);assert.strictEqual(r.mode, 'standard');assert.deepStrictEqual(snapshot(f), before);
});
test('cooperating mode changes serialize without mixed modes or lost custom notes', () => {
  const f = fixture(), runner = path.join(arena, 'cooperators.cjs');
  fs.writeFileSync(runner, String.raw`
const cp=require('child_process'),fs=require('fs'),path=require('path');
const [cli,hook,dir,lib]=process.argv.slice(2),ready=dir+'-ready',go=dir+'-go',started=dir+'-started',children=[];
const wait=async file=>{const end=Date.now()+15000;while(!fs.existsSync(file)){if(Date.now()>end)throw Error('coordinator deadline');await new Promise(r=>setTimeout(r,10));}};
const launch=(mode,want)=>{const c=cp.spawn(process.execPath,['--require',hook,cli,'mode','set',want,'--path',dir,'--json'],{windowsHide:true,env:{...process.env,LEERNESS_INTERNAL:'1',LEERNESS_OFFLINE:'1',LEERNESS_NO_AUTOCHCP:'1',LEERNESS_NO_STALE_CHECK:'1',MODE_TEXT_LIB:lib,MODE_TEXT_MODE:mode,MODE_TEXT_TARGET:path.join(dir,'.leerness','manifest.json'),MODE_TEXT_WINNER:'',MODE_TEXT_READY:ready,MODE_TEXT_GO:go,MODE_TEXT_STARTED:mode==='peer'?started:''}});children.push(c);let output='',err='';c.stdout.on('data',d=>output+=d);c.stderr.on('data',d=>err+=d);return new Promise((resolve,reject)=>{c.on('error',reject);c.on('close',code=>resolve({code,output,err}));});};
(async()=>{try{const first=launch('hold','minimal');await wait(ready);const second=launch('peer','standard');await wait(started);fs.writeFileSync(go,'go');const results=await Promise.all([first,second]);if(results.some(r=>r.code!==0))throw Error(JSON.stringify(results));console.log(JSON.stringify(results.map(r=>JSON.parse(r.output))));}finally{fs.writeFileSync(go,'go');for(const c of children)if(c.exitCode===null)c.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
`);
  const r = cp.spawnSync(process.execPath, [runner, cli, hook, f.dir, path.resolve(__dirname, '../lib')], { encoding: 'utf8', timeout: 40000, windowsHide: true });assert.ifError(r.error);success(r);
  const result = JSON.parse(r.stdout);assert.deepStrictEqual(result.map(x => [x.previous, x.mode]), [['standard', 'minimal'], ['minimal', 'standard']]);
  assert.strictEqual(parse(f.manifest).mode, 'standard');assert.ok(!text(f.agents).includes('Instructions (minimal)'));
  for (const key of ['agents', 'claude']) assert.strictEqual(text(f[key]).split('Keep ' + sample).length - 1, 1);
});
console.log(`Tests: ${passed}/${passed + failed} passed`);process.exitCode = failed ? 1 : 0;
