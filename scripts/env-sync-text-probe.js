'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-env-sync-'));
  try {
    const env = { ...process.env, ENV_SYNC_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 240000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if (r.error) process.stderr.write(r.error.message + '\n');process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-env-sync-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.ENV_SYNC_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const sample = '한글 日本語 e\u0301 🐝 \uFFFD', privateValue = 'invented-value-remains-private';
const original = '\uFEFF# User notes ' + sample + '\r\nEXISTING=example\r\n';
let sequence = 0, passed = 0, failed = 0;
const at = process.argv.indexOf('--match'), filter = at < 0 ? '' : process.argv[at + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
const state = file => [fs.readFileSync(file), fs.statSync(file, { bigint: true }).mtimeNs];
function fixture(text = original, source = 'EXISTING=' + privateValue + '\nADDED=' + privateValue + '\n') {
  const dir = path.join(arena, (++sequence) + '-한글 example');fs.mkdirSync(dir);
  const file = path.join(dir, '.env.example'), env = path.join(dir, '.env');
  if (text !== null) fs.writeFileSync(file, text);if (source !== null) fs.writeFileSync(env, source);
  return { dir, file, env };
}
const hook = path.join(arena, 'env-hook.cjs');
fs.writeFileSync(hook, `const fs=require('fs'),p=require(${JSON.stringify(path.resolve(__dirname, '../lib/pure-utils'))}),io=require(${JSON.stringify(path.resolve(__dirname, '../lib/io'))});
const mode=process.env.ENV_SYNC_MODE,target=process.env.ENV_SYNC_TARGET,source=process.env.ENV_SYNC_SOURCE,winner=Buffer.from(process.env.ENV_SYNC_WINNER,'base64');
let parses=0;const parse=p._parseEnvKeys;p._parseEnvKeys=function(text){const out=parse(text);parses++;
if(parses===1&&mode==='source-after-parse')fs.writeFileSync(source,'REPLACED=private-fixture\\n');
if(parses===1&&mode==='source-deleted')fs.unlinkSync(source);
if(parses===1&&mode==='bad-output')out.add(String.fromCharCode(0xd800));
if(parses===2&&mode==='target-after-parse')fs.writeFileSync(target,winner);
return out;};
const write=io.writeUtf8;io.writeUtf8=function(file,text){if(file===target&&mode==='before-publication')fs.writeFileSync(file,winner);return write(file,text);};
const input=require(${JSON.stringify(path.resolve(__dirname, '../lib/memory-input'))}),capture=input.captureCheckedFileInput;let captured=false;
input.captureCheckedFileInput=function(file,opts){if(file===target&&!captured){captured=true;if(mode==='before-capture')fs.writeFileSync(file,winner);if(mode==='delete-before-capture')fs.unlinkSync(file);}return capture(file,opts);};
const locks=require(${JSON.stringify(path.resolve(__dirname, '../lib/state-lock'))}),lock=locks.withStateLock;
locks.withStateLock=function(file,fn,opts){const result=lock(file,fn,opts);if(file===target&&mode==='release-error')throw Object.assign(Error('Injected release failure'),{code:'E_SYNC_LOCK_RELEASE'});return result;};
const o=require(${JSON.stringify(path.resolve(__dirname, '../lib/memory-output'))}),publish=o.publishMemoryOutput;
o.publishMemoryOutput=function(snapshot,file,bytes){if(file===target){
if(mode==='before-publication')fs.writeFileSync(file,winner);
if(mode==='publish-error')throw Object.assign(Error('Injected publication failure'),{code:'E_SYNC_TEST'});
if(mode==='after-publication-error'){const before=fs.readFileSync(file);publish(snapshot,file,bytes);const backupFile=file+'.recovery';fs.writeFileSync(backupFile,before);throw Object.assign(Error('Injected failure after save'),{code:'E_SYNC_AFTER_SAVE',outputMutationStarted:true,outputPublished:true,backupFile,recoveryArtifacts:[{role:'displaced-original',path:backupFile}]});}
}return publish(snapshot,file,bytes);};
const managed=require(${JSON.stringify(path.resolve(__dirname, '../lib/managed-text'))}),take=managed.captureTextEdit,preflight=managed.assertTextEditCurrent;
managed.captureTextEdit=function(file,opts){if(file===target&&mode==='lock-check')require('assert').ok(locks.isStateLockHeld(file));return take(file,opts);};
let checks=0;managed.assertTextEditCurrent=function(edit,file,text){const result=preflight(edit,file,text);if(file===target&&++checks===2&&mode==='source-after-preflight')fs.writeFileSync(source,'REPLACED=private-fixture\\n');return result;};
`);
function call(f, { mode = '', winner = '# Competing notes ' + sample + '\n', args = [], json = false } = {}) {
  const r = cp.spawnSync(process.execPath, [...(mode ? ['--require', hook] : []), cli, 'env', 'sync', f.dir, ...args, ...(json ? ['--json'] : [])], {
    cwd: f.dir, encoding: 'utf8', timeout: 45000, windowsHide: true, env: { ...process.env,
      LEERNESS_INTERNAL: '1', LEERNESS_HOOK: '', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
      ENV_SYNC_MODE: mode, ENV_SYNC_TARGET: f.file, ENV_SYNC_SOURCE: f.env, ENV_SYNC_WINNER: Buffer.from(winner).toString('base64') }
  });assert.ifError(r.error);assert.ok(!(r.stdout + r.stderr).includes(privateValue), 'private values in output');return r;
}
function success(r) { assert.strictEqual(r.status, 0, r.stdout + r.stderr); }
function reject(r) { assert.notStrictEqual(r.status, 0, 'unexpected success: ' + r.stdout + r.stderr);assert.ok(!/건 추가됨/.test(r.stdout + r.stderr)); }
for (const target of ['file', 'env']) test('repro malformed ' + target + ' is not rewritten or copied', () => {
  const f = fixture();fs.appendFileSync(f[target], Buffer.from([0xff]));const before = state(f.file), source = state(f.env);
  reject(call(f));assert.deepStrictEqual(state(f.file), before);assert.deepStrictEqual(state(f.env), source);
});
test('repro appended lines retain the existing CRLF format', () => {
  const f = fixture();success(call(f));const saved = fs.readFileSync(f.file, 'utf8');assert.ok(saved.startsWith(original));
  assert.ok(!saved.replace(/\r\n/g, '').includes('\n'));assert.ok(saved.endsWith('ADDED=\r\n'));
});
test('repro private source change after parsing rejects stale keys', () => {
  const f = fixture(), before = state(f.file);reject(call(f, { mode: 'source-after-parse' }));assert.deepStrictEqual(state(f.file), before);
  assert.strictEqual(fs.readFileSync(f.env, 'utf8'), 'REPLACED=private-fixture\n');
});
test('repro competing target at publication is preserved', () => {
  const f = fixture(), winner = '# A different author ' + sample + '\n';reject(call(f, { mode: 'before-publication', winner }));
  assert.strictEqual(fs.readFileSync(f.file, 'utf8'), winner);
});
for (const eol of ['\n', '\r\n']) for (const bom of ['', '\uFEFF']) test('preserve Unicode, notes, signature and newline ' + JSON.stringify([eol, bom]), () => {
  const text = bom + '# ' + sample + eol + 'EXISTING=example' + eol, f = fixture(text), source = state(f.env);
  success(call(f, { mode: 'lock-check' }));const saved = fs.readFileSync(f.file, 'utf8');assert.ok(saved.startsWith(text));
  assert.ok(saved.endsWith('ADDED=' + eol));if (eol === '\r\n') assert.ok(!saved.replace(/\r\n/g, '').includes('\n'));
  assert.deepStrictEqual(state(f.env), source);assert.ok(!saved.includes(privateValue));assert.ok(!fs.existsSync(f.file + '.lock'));
});
test('append separates a final unterminated comment', () => {
  const f = fixture('# Last note ' + sample);success(call(f));const saved = fs.readFileSync(f.file, 'utf8');
  assert.ok(saved.startsWith('# Last note ' + sample + '\n\n'));assert.ok(/^EXISTING=$/m.test(saved));assert.ok(/^ADDED=$/m.test(saved));
});
test('existing grammar, case, order and duplicate behavior stay unchanged', () => {
  const source = '# NOTE=value\nEXISTING=' + privateValue + '\nADDED=one\nADDED=two\nlower=three\nLower=four\nexport EXPORTED=ignored\n1INVALID=ignored\n';
  const f = fixture('EXISTING=example\nlower=example\n', source);success(call(f));const saved = fs.readFileSync(f.file, 'utf8');
  assert.ok(saved.endsWith('ADDED=\nLower=\n'));assert.strictEqual((saved.match(/^ADDED=/gm) || []).length, 1);assert.ok(!/EXPORTED|INVALID/.test(saved));
});
for (const source of [null, '', 'EXISTING=' + privateValue + '\n']) test('no-op preserves target bytes and time for source ' + (source === null ? 'absent' : source === '' ? 'empty' : 'covered'), () => {
  const f = fixture(original, source), before = state(f.file);success(call(f));assert.deepStrictEqual(state(f.file), before);assert.ok(!fs.existsSync(f.file + '.lock'));
});
test('second sync is a no-op', () => { const f = fixture();success(call(f));const before = state(f.file);success(call(f));assert.deepStrictEqual(state(f.file), before); });
test('missing example is not created even with force', () => { const f = fixture(null), source = state(f.env);reject(call(f, { args: ['--force'] }));assert.ok(!fs.existsSync(f.file));assert.deepStrictEqual(state(f.env), source);assert.deepStrictEqual(fs.readdirSync(f.dir), ['.env']); });
test('missing project directory is not created', () => { const f = { dir: path.join(arena, 'never-created'), file: path.join(arena, 'never-created', '.env.example'), env: path.join(arena, 'never-created', '.env') };fs.mkdirSync(f.dir);fs.rmdirSync(f.dir);const r = cp.spawnSync(process.execPath, [cli, 'env', 'sync', f.dir, '--json'], { cwd: arena, encoding: 'utf8', env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_NO_AUTOCHCP: '1' } });assert.ifError(r.error);reject(r);assert.ok(!fs.existsSync(f.dir)); });
for (const source of ['EXISTING=value\n', 'ADDED=value\n']) test('dry-run has no project mutation: ' + (source.startsWith('EXISTING') ? 'no-op' : 'change'), () => {
  const f = fixture(original, source), before = state(f.file), listing = fs.readdirSync(f.dir), r = call(f, { args: ['--dry-run'] });
  if (source.startsWith('EXISTING')) success(r);else reject(r);
  assert.deepStrictEqual(state(f.file), before);assert.deepStrictEqual(fs.readdirSync(f.dir), listing);
});
for (const target of ['file', 'env']) for (const [name, bytes] of [['truncated UTF-8', Buffer.from([0xe3, 0x81])], ['UTF-16', Buffer.from([0xff, 0xfe, 65, 0])], ['over limit', Buffer.alloc(4 * 1024 * 1024 + 1, 32)]]) test('reject ' + name + ' in ' + target, () => {
  const f = fixture();fs.writeFileSync(f[target], bytes);const before = state(f.file), source = state(f.env);reject(call(f));assert.deepStrictEqual(state(f.file), before);assert.deepStrictEqual(state(f.env), source);
});
test('oversized candidate including signature is rejected', () => {
  const f = fixture();fs.writeFileSync(f.file, original + '#'.repeat(4 * 1024 * 1024 - Buffer.byteLength(original)));const before = state(f.file);
  const r = call(f, { json: true });reject(r);assert.strictEqual(JSON.parse(r.stdout).code, 'E_TEXT_LIMIT');assert.deepStrictEqual(state(f.file), before);
});
for (const mode of ['bad-output', 'source-deleted', 'source-after-preflight', 'publish-error']) test('pre-save failure preserves target: ' + mode, () => {
  const f = fixture(), before = state(f.file), r = call(f, { mode, json: true });reject(r);assert.deepStrictEqual(state(f.file), before);
  const data = JSON.parse(r.stdout);assert.strictEqual(data.ok, false);assert.ok(data.file && data.stage);assert.notStrictEqual(data.outputPublished, true);
});
test('competing target after parsing is preserved', () => { const f = fixture(), winner = '# New notes ' + sample + '\n';reject(call(f, { mode: 'target-after-parse', winner }));assert.strictEqual(fs.readFileSync(f.file, 'utf8'), winner); });
test('resolved target at capture stays untouched', () => { const f = fixture(), winner = original + 'ADDED=\r\n';success(call(f, { mode: 'before-capture', winner }));assert.strictEqual(fs.readFileSync(f.file, 'utf8'), winner); });
test('target deleted before capture stays absent', () => { const f = fixture();reject(call(f, { mode: 'delete-before-capture' }));assert.ok(!fs.existsSync(f.file)); });
test('hard-linked output is refused without touching its alias', () => { const f = fixture(), alias = path.join(f.dir, 'example-alias');fs.linkSync(f.file, alias);const before = state(f.file);reject(call(f));assert.deepStrictEqual(state(f.file), before);assert.deepStrictEqual(state(alias), before); });
for (const json of [false, true]) test('failure after save reports publication and recovery in ' + (json ? 'JSON' : 'human output'), () => {
  const f = fixture(), before = fs.readFileSync(f.file), r = call(f, { mode: 'after-publication-error', json });reject(r);
  assert.ok(fs.readFileSync(f.file, 'utf8').endsWith('ADDED=\r\n'));assert.deepStrictEqual(fs.readFileSync(f.file + '.recovery'), before);
  const out = json ? JSON.parse(r.stdout) : JSON.parse(r.stdout.split('Environment sync failure details: ')[1]);
  assert.strictEqual(out.outputPublished, true);assert.strictEqual(out.outputMutationStarted, true);assert.strictEqual(out.backupFile, f.file + '.recovery');assert.strictEqual(out.recoveryArtifacts[0].path, out.backupFile);assert.notStrictEqual(out.outputRolledBack, true);
});
test('lock-release failure retains completed-save state', () => { const f = fixture(), r = call(f, { mode: 'release-error', json: true });reject(r);const out = JSON.parse(r.stdout);assert.strictEqual(out.outputPublished, true);assert.strictEqual(out.stage, 'lock-release');assert.ok(fs.readFileSync(f.file, 'utf8').endsWith('ADDED=\r\n')); });
test('no-op lock-release failure reports release without claiming a save', () => { const f = fixture(original, 'EXISTING=value\n'), before = state(f.file), r = call(f, { mode: 'release-error', json: true });reject(r);const out = JSON.parse(r.stdout);assert.strictEqual(out.stage, 'lock-release');assert.notStrictEqual(out.outputPublished, true);assert.deepStrictEqual(state(f.file), before); });
test('runtime-incompatible target is not changed', () => {
  const f = fixture(), ws = path.join(f.dir, '.leerness/cache');fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'state-layout.json'), JSON.stringify({ schema: 'leerness.runtime-layout/v1', schemaVersion: 1, scope: 'project-local', generation: 1, layout: 'legacy', requiredWriterProtocol: 2 }));
  const before = state(f.file);reject(call(f));assert.deepStrictEqual(state(f.file), before);assert.ok(!fs.existsSync(f.file + '.lock'));
});
test('concurrent sync calls append each missing key once', () => {
  const f = fixture(), script = `const cp=require('child_process');Promise.all([0,1].map(()=>new Promise((resolve,reject)=>{const p=cp.spawn(process.execPath,[process.argv[1],'env','sync',process.argv[2]],{windowsHide:true});let out='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>out+=x);p.on('error',reject);p.on('close',code=>code?reject(Error(out)):resolve());}))).catch(e=>{console.error(e.message);process.exitCode=1;});`;
  const r = cp.spawnSync(process.execPath, ['-e', script, cli, f.dir], { cwd: f.dir, encoding: 'utf8', timeout: 60000, windowsHide: true, env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1' } });
  assert.ifError(r.error);success(r);assert.strictEqual((fs.readFileSync(f.file, 'utf8').match(/^ADDED=/gm) || []).length, 1);
});
console.log('env-sync-text-probe: ' + passed + '/' + (passed + failed) + ' passed');
if (!passed && !failed) throw Error('No selected tests');
process.exitCode = failed ? 1 : 0;
