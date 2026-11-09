'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const cli = path.resolve(__dirname, '../bin/leerness.js');
const source = path.dirname(path.dirname(cli));
const arena = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-registry-'));
const version = require('../package.json').version;
let sequence = 0;
const provider = { id: 'fixture', bin: 'node', desc: '한글 설정', extension: { retained: true } };
const slash = { agents: { fixture: { label: '한글 도구', commands: [{ cmd: '/keep', desc: '보존', extension: 7 }], extension: 'kept' } }, extension: { retained: true } };
function fixture(file, bytes) {
  const root = path.join(arena, '한글 project ' + sequence++);
  fs.mkdirSync(path.join(root, '.leerness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.leerness/HARNESS_VERSION'), version + '\n');
  fs.writeFileSync(path.join(root, '.leerness/LANGUAGE'), 'en\n');
  const target = path.join(root, '.leerness', file);
  if (bytes !== undefined) fs.writeFileSync(target, bytes);
  return { root, target };
}
function run(f, args, preload = '') {
  let prefix = [];
  if (preload) {
    const file = path.join(arena, 'preload-' + sequence++ + '.cjs');
    fs.writeFileSync(file, preload);
    prefix = ['--require', file];
  }
  const env = { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_LOCK_WARN: '1' };
  delete env.NODE_OPTIONS;
  const result = cp.spawnSync(process.execPath, [...prefix, cli, ...args, '--path', f.root, '--json'], {
    cwd: f.root, env, encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}
function rejected(f, args, code, preload = '') {
  const before = fs.readFileSync(f.target), stat = fs.statSync(f.target, { bigint: true });
  const result = run(f, args, preload);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.code, code, result.stdout + result.stderr);
  assert.deepEqual(fs.readFileSync(f.target), before);
  assert.equal(fs.statSync(f.target, { bigint: true }).mtimeNs, stat.mtimeNs);
  assert.equal(fs.readdirSync(path.dirname(f.target)).some(n => n.includes('.corrupt-')), false);
}
for (const [file, args, valid, field] of [
  ['providers.json', ['provider', 'add', 'newfixture', '--bin', 'node'], { providers: [provider] }, 'providers'],
  ['agent-slash-commands.json', ['slash-commands', '--record'], slash, 'agents'],
]) {
  for (const [name, value, code] of [
    ['invalid JSON', '{"private_marker":"do-not-echo",', 'store_corrupt'],
    ['invalid UTF-8', Buffer.from([0x7b, 0xff, 0x7d]), 'store_corrupt'],
    ['null root', 'null', 'store_invalid'],
    ['array root', '[]', 'store_invalid'],
    ['missing collection', '{}', 'store_invalid'],
    ['wrong collection', JSON.stringify({ [field]: field === 'providers' ? {} : [] }), 'store_invalid'],
    ['future version', JSON.stringify({ ...valid, schemaVersion: 99 }), 'store_invalid'],
    ['invalid member', JSON.stringify({ [field]: field === 'providers' ? [null] : { fixture: null } }), 'store_invalid'],
  ]) test(file + ' refuses ' + name, () => rejected(fixture(file, value), args, code));
  test(file + ' reports corruption on explicit read', () => rejected(fixture(file, '{bad'),
    field === 'providers' ? ['provider', 'list'] : ['slash-commands'], 'store_corrupt'));
  test(file + ' refuses injected read failure without echoing contents', () => {
    const f = fixture(file, JSON.stringify(valid));
    const preload = `const fs=require('fs'),open=fs.openSync;fs.openSync=function(p,...a){if(String(p)===${JSON.stringify(f.target)})throw Object.assign(new Error('controlled'),{code:'EACCES'});return open.call(this,p,...a);};`;
    rejected(f, args, 'store_unreadable', preload);
  });
  test(file + ' refuses hard links', () => {
    const f = fixture(file, JSON.stringify(valid));
    fs.linkSync(f.target, path.join(arena, 'link-' + sequence++));
    rejected(f, args, 'store_invalid');
  });
  test(file + ' rechecks corruption after acquiring its lock', () => {
    const f = fixture(file, JSON.stringify(valid));
    const preload = `const fs=require('fs'),locks=require(${JSON.stringify(path.join(source, 'lib/state-lock'))}),original=locks.withStateLock;let armed=true;locks.withStateLock=function(file,fn,opts){return original(file,()=>{if(armed&&file===${JSON.stringify(f.target)}){armed=false;fs.writeFileSync(file,'{changed-under-lock');}return fn();},opts);};`;
    const result = run(f, args, preload);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).code, 'store_corrupt');
    assert.equal(fs.readFileSync(f.target, 'utf8'), '{changed-under-lock');
  });
  test(file + ' preserves a modification between capture and publication', () => {
    const f = fixture(file, JSON.stringify(valid));
    const preload = `const fs=require('fs'),text=require(${JSON.stringify(path.join(source, 'lib/managed-text'))}),original=text.publishTextEdit;text.publishTextEdit=function(edit,file,value){if(file===${JSON.stringify(f.target)})fs.writeFileSync(file,'{external-writer');return original(edit,file,value);};`;
    const result = run(f, args, preload);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).code, 'store_changed');
    assert.equal(fs.readFileSync(f.target, 'utf8'), '{external-writer');
  });
  test(file + ' leaves malformed store private in JSON and text errors', () => {
    const f = fixture(file, '{"private_marker":"do-not-echo",');
    const result = run(f, args);
    assert.equal(result.status, 1);
    assert(!result.stdout.includes('do-not-echo'));
    assert(!result.stderr.includes('do-not-echo'));
  });
}
test('provider add/remove preserve unknown metadata and unrelated providers', () => {
  const f = fixture('providers.json', JSON.stringify({ schemaVersion: 1, extension: { retain: '정확히' }, providers: [provider] }));
  assert.equal(run(f, ['provider', 'add', 'newfixture', '--bin', 'node']).status, 0);
  let saved = JSON.parse(fs.readFileSync(f.target));
  assert.deepEqual(saved.extension, { retain: '정확히' });
  assert.deepEqual(saved.providers[0], provider);
  assert.equal(run(f, ['provider', 'remove', 'newfixture']).status, 0);
  saved = JSON.parse(fs.readFileSync(f.target));
  assert.deepEqual(saved.providers, [provider]);
  assert.deepEqual(saved.extension, { retain: '정확히' });
});
test('provider replace preserves extension properties on the target', () => {
  const f = fixture('providers.json', JSON.stringify({ providers: [provider] }));
  assert.equal(run(f, ['provider', 'add', 'fixture', '--bin', 'node']).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.target)).providers[0].extension, provider.extension);
});
test('provider remove refuses corrupt input even for a built-in id', () => rejected(fixture('providers.json', '{bad'), ['provider', 'remove', 'codex'], 'store_corrupt'));
test('slash --force does not authorize overwriting corruption', () => rejected(fixture('agent-slash-commands.json', '{bad'), ['slash-commands', '--record', '--force'], 'store_corrupt'));
test('slash refresh refuses corrupt input before probing external tools', () => rejected(fixture('agent-slash-commands.json', '{bad'), ['slash-commands', '--refresh'], 'store_corrupt'));
test('slash record retains unknown metadata and command properties', () => {
  const f = fixture('agent-slash-commands.json', JSON.stringify(slash));
  assert.equal(run(f, ['slash-commands', '--record']).status, 0);
  const saved = JSON.parse(fs.readFileSync(f.target));
  assert.deepEqual(saved.extension, slash.extension);
  assert.equal(saved.agents.fixture.extension, 'kept');
  assert.deepEqual(saved.agents.fixture.commands, slash.agents.fixture.commands);
});
test('slash force still resets a valid registry explicitly', () => {
  const f = fixture('agent-slash-commands.json', JSON.stringify(slash));
  assert.equal(run(f, ['slash-commands', '--record', '--force']).status, 0);
  assert(!Object.hasOwn(JSON.parse(fs.readFileSync(f.target)).agents, 'fixture'));
});
for (const [file,args] of [['providers.json',['provider','add','fixture','--bin','node']],['agent-slash-commands.json',['slash-commands','--record']]]) {
  test(file + ' creates a genuinely absent store', () => {
    const f = fixture(file);
    assert.equal(run(f,args).status,0);
    assert.equal(JSON.parse(fs.readFileSync(f.target)).schemaVersion,1);
  });
  test(file + ' accepts a UTF-8 BOM and preserves it on write', () => {
    const f=fixture(file,'\uFEFF'+JSON.stringify(file==='providers.json'?{providers:[provider]}:slash));
    assert.equal(run(f,args).status,0);
    assert.deepEqual([...fs.readFileSync(f.target).subarray(0,3)],[239,187,191]);
  });
}
test('roles already refuses corrupt input without source changes', () => rejected(fixture('agent-roles.json','{bad'), ['roles','set','coder','--provider','codex'], 'store_corrupt'));

const httpFixture = entries => `process.env.LEERNESS_OFFLINE='0';const E=require('events');require('http').get=(url,options,callback)=>{const request=new E();request.destroy=()=>{};setImmediate(()=>{const response=new E();response.statusCode=200;response.headers={'content-type':'application/json'};callback(response);response.emit('data',${JSON.stringify(JSON.stringify(entries))});response.emit('end');});return request;};`;
for (const corrupt of [false, true]) test('provider sync rechecks under its lock: ' + (corrupt ? 'corruption' : 'unrelated edit'), () => {
  const f = fixture('providers.json', JSON.stringify({ providers: [provider], extension: 'root-kept' }));
  const changed = { ...provider, desc: 'concurrent editor', extension: { retained: 'concurrent' } };
  const content = corrupt ? '{changed-under-lock' : JSON.stringify({ providers: [changed], extension: 'latest-root' });
  const preload = httpFixture([{ id: 'incoming', bin: 'node', desc: 'from fixture' }])
    + `const fs=require('fs'),locks=require(${JSON.stringify(path.join(source, 'lib/state-lock'))}),original=locks.withStateLock;let armed=true;locks.withStateLock=function(file,fn,options){return original(file,()=>{if(armed&&file===${JSON.stringify(f.target)}){armed=false;fs.writeFileSync(file,${JSON.stringify(content)});}return fn();},options);};`;
  const result = run(f, ['provider', 'sync', 'http://127.0.0.1:1/fixture'], preload);
  if (corrupt) {
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /"code": "store_corrupt"/);
    assert.equal(fs.readFileSync(f.target, 'utf8'), content);
    assert(!result.stdout.includes('sync 완료'));
  } else {
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const saved = JSON.parse(fs.readFileSync(f.target));
    assert.deepEqual(saved.providers.find(p => p.id === 'fixture'), changed);
    assert.equal(saved.providers.find(p => p.id === 'incoming').bin, 'node');
    assert.equal(saved.extension, 'latest-root');
  }
});
const slashProbe = `const portable=require(${JSON.stringify(path.join(source, 'lib/portable-process'))}),spawn=portable.spawnPortableSync;portable.spawnPortableSync=(bin,args,...rest)=>bin==='claude'&&args.includes('--help')?{status:0,stdout:'/new  fixture command\\n',stderr:''}:spawn(bin,args,...rest);`;
for (const corrupt of [false, true]) test('slash refresh rechecks under its lock: ' + (corrupt ? 'corruption' : 'unrelated edit'), () => {
  const f = fixture('agent-slash-commands.json', JSON.stringify(slash));
  const content = corrupt ? '{changed-under-lock' : JSON.stringify({ ...slash, extension: 'latest-root' });
  const preload = slashProbe
    + `const fs=require('fs'),locks=require(${JSON.stringify(path.join(source, 'lib/state-lock'))}),original=locks.withStateLock;let armed=true;locks.withStateLock=function(file,fn,options){return original(file,()=>{if(armed&&file===${JSON.stringify(f.target)}){armed=false;fs.writeFileSync(file,${JSON.stringify(content)});}return fn();},options);};`;
  const result = run(f, ['slash-commands', 'claude', '--refresh'], preload);
  if (corrupt) {
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).code, 'store_corrupt');
    assert.equal(fs.readFileSync(f.target, 'utf8'), content);
  } else {
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).refreshed, true);
    const saved = JSON.parse(fs.readFileSync(f.target));
    assert.equal(saved.extension, 'latest-root');
    assert.equal(saved.agents.fixture.extension, 'kept');
    assert(saved.agents.claude.commands.some(c => c.cmd === '/new'));
  }
});
for (const [file,args,valid] of [['providers.json',['provider','add','newfixture','--bin','node'],{providers:[provider]}],['agent-slash-commands.json',['slash-commands','--record'],slash]]) {
  test(file + ' refuses an oversized existing store', () => rejected(fixture(file, ' '.repeat(4 * 1024 * 1024 + 1)), args, 'store_invalid'));
  test(file + ' refuses an invalid nested value', () => rejected(fixture(file, JSON.stringify(file === 'providers.json'
    ? {providers:[{id:'fixture',versionArgs:[{}]}]} : {agents:{fixture:{commands:[{cmd:'/keep',desc:{}}]}}})), args, 'store_invalid'));
  test(file + ' dry-run preserves the original', () => {
    const f = fixture(file, JSON.stringify(valid)), before = fs.readFileSync(f.target);
    const r = run(f, [...args, '--dry-run']);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).code, 'dry_run_unsupported');
    assert.deepEqual(fs.readFileSync(f.target), before);
  });
  test(file + ' rejects symlinks without touching the target', t => {
    const target = path.join(arena, 'outside-' + sequence++ + '.json');
    fs.writeFileSync(target, JSON.stringify(valid));
    const f = fixture(file);
    try { fs.symlinkSync(target, f.target, 'file'); }
    catch (error) { if (error.code === 'EPERM') { t.skip('file symlink permission unavailable'); return; } throw error; }
    const before = fs.readFileSync(target), r = run(f, args);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).code, 'store_invalid');
    assert(fs.lstatSync(f.target).isSymbolicLink());
    assert.deepEqual(fs.readFileSync(target), before);
  });
}
test('slash record treats __proto__ as data, not object inheritance', () => {
  const f = fixture('agent-slash-commands.json', '{"agents":{"__proto__":{"commands":[{"cmd":"/keep"}],"extension":"own-data"}}}');
  assert.equal(run(f,['slash-commands','--record']).status,0);
  const saved=JSON.parse(fs.readFileSync(f.target));
  assert(Object.hasOwn(saved.agents,'__proto__'));
  assert.equal(saved.agents.__proto__.extension,'own-data');
  assert.equal({}.extension,undefined);
});
test.after(() => console.log('Registry evidence fixtures retained: ' + arena));

