'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-teams-text-'));
  try {
    const env = { ...process.env, TEAMS_TEXT_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 240000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if (r.error) process.stderr.write(r.error.message + '\n');process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-teams-text-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.TEAMS_TEXT_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const render = require('../lib/pure-utils')._renderTeamsMd;
const sample = '한글 日本語 e\u0301 🐝 \uFFFD';
const initial = [{ id: 'original', name: sample, members: ['worker'], personas: ['review'], schedule: 'manual', status: 'active', custom: { note: sample } }];
let sequence = 0, passed = 0, failed = 0;
const at = process.argv.indexOf('--match'), filter = at < 0 ? '' : process.argv[at + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
const state = file => fs.existsSync(file) ? [fs.readFileSync(file), fs.statSync(file, { bigint: true }).mtimeNs] : null;
function fixture(teams = initial) {
  const dir = path.join(arena, (++sequence) + '-한글 teams'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  const json = path.join(ws, 'teams.json'), md = path.join(ws, 'teams.md');
  if (teams !== null) { fs.writeFileSync(json, JSON.stringify(teams, null, 2) + '\n');fs.writeFileSync(md, render(teams)); }
  return { dir, ws, json, md };
}
const hook = path.join(arena, 'teams-hook.cjs');
fs.writeFileSync(hook, `const fs=require('fs'),mode=process.env.TEAMS_TEXT_MODE,target=process.env.TEAMS_TEXT_TARGET,md=process.env.TEAMS_TEXT_MD;
const winner=Buffer.from(process.env.TEAMS_TEXT_WINNER,'base64');
const p=require(${JSON.stringify(path.resolve(__dirname, '../lib/pure-utils'))}),render=p._renderTeamsMd;
p._renderTeamsMd=function(teams){const out=render(teams);return teams.some(t=>t.id==='new')?(mode==='bad-render'?out+String.fromCharCode(0xd800):mode==='large-render'?out+'x'.repeat(4*1024*1024):out):out;};
const io=require(${JSON.stringify(path.resolve(__dirname, '../lib/io'))}),write=io.writeUtf8;
io.writeUtf8=function(file,text){if(file===target&&mode==='canonical-race')fs.writeFileSync(file,winner);if(file===md&&mode==='projection-failure')throw Object.assign(Error('Injected projection save failure'),{code:'E_TEAMS_TEST'});return write(file,text);};
const o=require(${JSON.stringify(path.resolve(__dirname, '../lib/memory-output'))}),publish=o.publishMemoryOutput;
o.publishMemoryOutput=function(snapshot,file,bytes){
if(file===target&&mode==='canonical-race')fs.writeFileSync(file,winner);
if(file===target&&mode==='canonical-failure')throw Object.assign(Error('Injected canonical failure'),{code:'E_TEAMS_TEST'});
if(file===target&&mode==='projection-after-canonical')fs.writeFileSync(md,winner);
if(file===md&&mode==='projection-failure')throw Object.assign(Error('Injected projection save failure'),{code:'E_TEAMS_TEST'});
if(file===md&&mode==='projection-eperm'){fs.appendFileSync(md+'.attempts','1');throw Object.assign(Error('Injected EPERM'),{code:'EPERM'});}
if((file===target&&mode==='canonical-after-save')||(file===md&&mode==='projection-after-save')){const before=fs.readFileSync(file);publish(snapshot,file,bytes);const backupFile=file+'.recovery';fs.writeFileSync(backupFile,before);throw Object.assign(Error('Injected failure after save'),{code:'E_TEAMS_AFTER_SAVE',outputMutationStarted:true,outputPublished:true,backupFile,recoveryArtifacts:[{role:'displaced-original',path:backupFile}]});}
return publish(snapshot,file,bytes);};
const locks=require(${JSON.stringify(path.resolve(__dirname, '../lib/state-lock'))}),lock=locks.withStateLock;
locks.withStateLock=function(file,fn,opts){const result=lock(file,fn,opts);if(file===md&&mode==='release-error')throw Object.assign(Error('Injected release failure'),{code:'E_TEAM_LOCK_RELEASE',lockPath:md+'.lock'});return result;};
const managed=require(${JSON.stringify(path.resolve(__dirname, '../lib/managed-text'))}),take=managed.captureTextEdit;
managed.captureTextEdit=function(file,opts){if(file===target&&mode==='before-capture')fs.writeFileSync(file,winner);const result=take(file,opts);
if(mode==='lock-check'){require('assert').ok(locks.isStateLockHeld(target));if(file===md)require('assert').ok(locks.isStateLockHeld(md));}
if(file===target&&mode==='after-capture')fs.writeFileSync(file,winner);if(file===md&&mode==='projection-after-capture')fs.writeFileSync(md,winner);return result;};
`);
function call(f, args = ['add', 'new', '--name', sample], { mode = '', winner = JSON.stringify([{ id: 'competing', members: [], personas: [] }]), json = true } = {}) {
  const r = cp.spawnSync(process.execPath, [...(mode ? ['--require', hook] : []), cli, 'team', ...args, '--path', f.dir, ...(json ? ['--json'] : [])], {
    cwd: f.dir, encoding: 'utf8', timeout: 45000, windowsHide: true, env: { ...process.env,
      LEERNESS_INTERNAL: '1', LEERNESS_HOOK: '', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1',
      TEAMS_TEXT_MODE: mode, TEAMS_TEXT_TARGET: f.json, TEAMS_TEXT_MD: f.md, TEAMS_TEXT_WINNER: Buffer.from(winner).toString('base64') }
  });assert.ifError(r.error);return r;
}
function success(r) { assert.strictEqual(r.status, 0, r.stdout + r.stderr);return JSON.parse(r.stdout); }
function reject(r) { assert.notStrictEqual(r.status, 0, 'unexpected success: ' + r.stdout + r.stderr);assert.ok(!/"ok":\s*true|team 정의:|team 제거:/.test(r.stdout + r.stderr));return JSON.parse(r.stdout); }
const pair = f => [state(f.json), state(f.md)];
test('repro malformed canonical bytes cannot be decoded and saved', () => {
  const f = fixture(), bytes = fs.readFileSync(f.json);fs.writeFileSync(f.json, Buffer.concat([bytes.subarray(0, bytes.indexOf('한글')), Buffer.from([0xff]), bytes.subarray(bytes.indexOf('한글'))]));
  const before = pair(f);reject(call(f));assert.deepStrictEqual(pair(f), before);
});
test('repro malformed projection is preserved before canonical publication', () => { const f = fixture();fs.appendFileSync(f.md, Buffer.from([0xff]));const before = pair(f);reject(call(f));assert.deepStrictEqual(pair(f), before); });
test('repro custom projection notes are not discarded', () => { const f = fixture();fs.appendFileSync(f.md, '\nUser notes '+sample);const before = pair(f);reject(call(f));assert.deepStrictEqual(pair(f), before); });
test('repro invalid rendered output cannot partially save a new team', () => { const f = fixture(), before = pair(f);reject(call(f, undefined, { mode: 'bad-render' }));assert.deepStrictEqual(pair(f), before); });
test('repro competing canonical writer is preserved', () => { const f = fixture(), winner = JSON.stringify([{ id: 'winner', members: [], personas: [] }]), md = state(f.md);reject(call(f, undefined, { mode: 'canonical-race', winner }));assert.strictEqual(fs.readFileSync(f.json, 'utf8'), winner);assert.deepStrictEqual(state(f.md), md); });
test('repro projection failure reports already saved canonical state', () => { const f = fixture(), md = state(f.md), data = reject(call(f, undefined, { mode: 'projection-failure' }));assert.deepStrictEqual(data.completedFiles, [f.json]);assert.strictEqual(data.file, f.md);assert.strictEqual(data.phase, 'publication');assert.deepStrictEqual(state(f.md), md);assert.ok(JSON.parse(fs.readFileSync(f.json, 'utf8')).some(t=>t.id==='new')); });
test('repro canonical and projection signatures and CRLF are retained', () => { const f = fixture();for(const file of [f.json,f.md])fs.writeFileSync(file,'\uFEFF'+fs.readFileSync(file,'utf8').replace(/\n/g,'\r\n'));success(call(f));for(const file of [f.json,f.md]){const text=fs.readFileSync(file,'utf8');assert.ok(text.startsWith('\uFEFF'));assert.ok(!text.replace(/\r\n/g,'').includes('\n'));} });
test('add and remove preserve Unicode and unknown metadata', () => {
  const teams = JSON.parse(JSON.stringify(initial));teams[0].custom['한글'] = sample;Object.defineProperty(teams[0], '__proto__', { value: { note: sample }, enumerable: true });
  const f = fixture(teams);success(call(f, undefined, { mode: 'lock-check' }));let stored = JSON.parse(fs.readFileSync(f.json,'utf8'));assert.deepStrictEqual(stored[0], teams[0]);
  assert.deepStrictEqual(success(call(f,['show','original'])),teams[0]);success(call(f,['remove','new']));stored=JSON.parse(fs.readFileSync(f.json,'utf8'));assert.deepStrictEqual(stored,teams);assert.strictEqual(fs.readFileSync(f.md,'utf8'),render(teams));
});
test('legacy scalar lists are normalized without losing metadata', () => { const teams=[{id:'legacy',members:'worker',personas:null,custom:sample}], f=fixture(null);fs.writeFileSync(f.json,JSON.stringify(teams));fs.writeFileSync(f.md,render([{...teams[0],members:['worker'],personas:[]}]));success(call(f));const first=JSON.parse(fs.readFileSync(f.json,'utf8'))[0];assert.deepStrictEqual(first,{...teams[0],members:['worker'],personas:[]}); });
test('first creation works without an existing harness directory', () => { const f=fixture(null);fs.rmdirSync(f.ws);success(call(f));const teams=JSON.parse(fs.readFileSync(f.json,'utf8'));assert.strictEqual(teams.length,1);assert.strictEqual(fs.readFileSync(f.md,'utf8'),render(teams)); });
test('missing projection is generated from the canonical data', () => { const f=fixture();fs.unlinkSync(f.md);success(call(f));const teams=JSON.parse(fs.readFileSync(f.json,'utf8'));assert.strictEqual(fs.readFileSync(f.md,'utf8'),render(teams)); });
test('removing the last team writes an empty canonical registry', () => { const f=fixture();success(call(f,['remove','original']));assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.json,'utf8')),[]);assert.strictEqual(fs.readFileSync(f.md,'utf8'),render([])); });
for(const args of [['add','original'],['remove','missing']])test('rejected no-op does not change either file: '+args.join(' '),()=>{const f=fixture(),before=pair(f);reject(call(f,args));assert.deepStrictEqual(pair(f),before);});
for(const value of ['{}','null','[{"name":"missing id"}]','[null]','{broken'])test('invalid canonical shape is preserved: '+value,()=>{const f=fixture();fs.writeFileSync(f.json,value);const before=pair(f);assert.strictEqual(reject(call(f)).code,'store_invalid');assert.deepStrictEqual(pair(f),before);});
test('escaped invalid Unicode in metadata is rejected without repairing it',()=>{const f=fixture();fs.writeFileSync(f.json,'[{"id":"old","members":[],"personas":[],"custom":"\\ud800"}]');const before=pair(f);assert.strictEqual(reject(call(f)).code,'E_TEXT_ENCODING');assert.deepStrictEqual(pair(f),before);});
for(const which of ['json','md'])test('oversized '+which+' is rejected before either write',()=>{const f=fixture();if(which==='json')fs.writeFileSync(f.json,JSON.stringify([{...initial[0],custom:'x'.repeat(4*1024*1024)}]));else fs.appendFileSync(f.md,'x'.repeat(4*1024*1024));const before=pair(f);reject(call(f));assert.deepStrictEqual(pair(f),before);});
test('oversized rendered projection cannot commit canonical changes',()=>{const f=fixture(),before=pair(f);reject(call(f,undefined,{mode:'large-render'}));assert.deepStrictEqual(pair(f),before);});
test('oversized canonical candidate cannot commit either file',()=>{const f=fixture();const teams=[{...initial[0],custom:''}],base=JSON.stringify(teams,null,2)+'\n';teams[0].custom='x'.repeat(4*1024*1024-Buffer.byteLength(base)-20);fs.writeFileSync(f.json,JSON.stringify(teams,null,2)+'\n');fs.writeFileSync(f.md,render(teams));const before=pair(f);assert.strictEqual(reject(call(f)).code,'E_TEXT_LIMIT');assert.deepStrictEqual(pair(f),before);});
for(const args of [['add','new'],['remove','original']])test('dry-run leaves files and lock metadata unchanged: '+args[0],()=>{const f=fixture(),before=pair(f),listing=fs.readdirSync(f.ws);reject(call(f,[...args,'--dry-run']));assert.deepStrictEqual(pair(f),before);assert.deepStrictEqual(fs.readdirSync(f.ws),listing);});
test('force does not override authored projection notes',()=>{const f=fixture();fs.appendFileSync(f.md,'\nAuthored '+sample);const before=pair(f);assert.strictEqual(reject(call(f,['remove','original','--force'])).code,'E_TEAM_PROJECTION_EDITED');assert.deepStrictEqual(pair(f),before);});
test('captured canonical change is not overwritten',()=>{const f=fixture(),winner=JSON.stringify([{id:'winner',members:[],personas:[]}]),md=state(f.md);reject(call(f,undefined,{mode:'after-capture',winner}));assert.strictEqual(fs.readFileSync(f.json,'utf8'),winner);assert.deepStrictEqual(state(f.md),md);});
test('new duplicate at capture does not get added twice',()=>{const f=fixture(),winner=JSON.stringify([...initial,{id:'new',members:[],personas:[]}]);assert.strictEqual(reject(call(f,undefined,{mode:'before-capture',winner})).code,'already_exists');assert.strictEqual(fs.readFileSync(f.json,'utf8'),winner);});
test('projection change before preflight preserves both original canonical and winner',()=>{const f=fixture(),json=state(f.json),winner='# Authored '+sample;reject(call(f,undefined,{mode:'projection-after-capture',winner}));assert.deepStrictEqual(state(f.json),json);assert.strictEqual(fs.readFileSync(f.md,'utf8'),winner);});
test('projection race after canonical save reports partial progress',()=>{const f=fixture(),winner='# Late notes '+sample,data=reject(call(f,undefined,{mode:'projection-after-canonical',winner}));assert.deepStrictEqual(data.completedFiles,[f.json]);assert.strictEqual(fs.readFileSync(f.md,'utf8'),winner);assert.ok(JSON.parse(fs.readFileSync(f.json,'utf8')).some(t=>t.id==='new'));});
test('canonical publication failure leaves both inputs unchanged',()=>{const f=fixture(),before=pair(f),data=reject(call(f,undefined,{mode:'canonical-failure'}));assert.deepStrictEqual(data.completedFiles,[]);assert.strictEqual(data.file,f.json);assert.deepStrictEqual(pair(f),before);});
test('projection EPERM is not replayed as an uncertain pair',()=>{const f=fixture(),data=reject(call(f,undefined,{mode:'projection-eperm'}));assert.deepStrictEqual(data.completedFiles,[f.json]);assert.strictEqual(fs.readFileSync(f.md+'.attempts','utf8'),'1');});
for(const target of ['canonical','projection'])test('after-save failure retains recovery details: '+target,()=>{const f=fixture(),file=target==='canonical'?f.json:f.md,before=fs.readFileSync(file),data=reject(call(f,undefined,{mode:target+'-after-save'}));assert.strictEqual(data.outputPublished,true);assert.strictEqual(data.backupFile,file+'.recovery');assert.deepStrictEqual(fs.readFileSync(data.backupFile),before);assert.deepStrictEqual(data.completedFiles,target==='canonical'?[]:[f.json]);assert.notStrictEqual(data.outputRolledBack,true);});
test('human errors report partial canonical save',()=>{const f=fixture(),r=call(f,undefined,{mode:'projection-failure',json:false});assert.notStrictEqual(r.status,0);assert.ok(!r.stdout.includes('team 정의:'));const data=JSON.parse(r.stdout.split('Team storage failure details: ')[1]);assert.deepStrictEqual(data.completedFiles,[f.json]);});
test('lock-release failure reports both completed writes',()=>{const f=fixture(),data=reject(call(f,undefined,{mode:'release-error'}));assert.strictEqual(data.phase,'lock-release');assert.strictEqual(data.file,f.md);assert.deepStrictEqual(data.completedFiles,[f.json,f.md]);});
for(const which of ['json','md'])test('hard-linked '+which+' and its alias are preserved',()=>{const f=fixture(),alias=path.join(f.ws,'alias');fs.linkSync(f[which],alias);const before=pair(f),aliasBefore=state(alias);reject(call(f));assert.deepStrictEqual(pair(f),before);assert.deepStrictEqual(state(alias),aliasBefore);});
test('read-only list and preview retain their no-write behavior',()=>{const f=fixture();fs.appendFileSync(f.md,'\nAuthored notes');const before=pair(f);assert.strictEqual(success(call(f,['list'])).count,1);assert.strictEqual(success(call(f,['preview','original'])).dryRun,true);assert.deepStrictEqual(pair(f),before);});
test('partial save is not silently retried against a stale projection',()=>{const f=fixture();reject(call(f,undefined,{mode:'projection-failure'}));const before=pair(f);assert.strictEqual(reject(call(f,['remove','new'])).code,'E_TEAM_PROJECTION_EDITED');assert.deepStrictEqual(pair(f),before);});
test('multiline team values remain intact across successive edits',()=>{const teams=[{...initial[0],purpose:'첫 줄\r\n둘째 줄\nlast'}],f=fixture(teams);for(const file of [f.json,f.md])fs.writeFileSync(file,'\uFEFF'+fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n').replace(/\n/g,'\r\n'));success(call(f));success(call(f,['remove','new']));const stored=JSON.parse(fs.readFileSync(f.json,'utf8').replace(/^\uFEFF/,''));assert.deepStrictEqual(stored,teams);const md=fs.readFileSync(f.md,'utf8');assert.ok(!md.replace(/\r\n/g,'').includes('\r'));assert.strictEqual(md.slice(1).replace(/\r\n/g,'\n'),render(teams).replace(/\r\n/g,'\n'));});
test('runtime-incompatible canonical target is refused',()=>{const f=fixture();fs.mkdirSync(path.join(f.ws,'cache'));fs.writeFileSync(path.join(f.ws,'cache/state-layout.json'),JSON.stringify({schema:'leerness.runtime-layout/v1',schemaVersion:1,scope:'project-local',generation:1,layout:'legacy',requiredWriterProtocol:2}));const before=pair(f);reject(call(f));assert.deepStrictEqual(pair(f),before);});
test('concurrent add and remove retain both changes and matching projection',()=>{const f=fixture(),script=`const cp=require('child_process');Promise.all([['remove','original'],['add','survivor']].map(args=>new Promise((resolve,reject)=>{const p=cp.spawn(process.execPath,[process.argv[1],'team',...args,'--path',process.argv[2],'--json'],{windowsHide:true});let text='';p.stdout.on('data',x=>text+=x);p.stderr.on('data',x=>text+=x);p.on('error',reject);p.on('close',code=>code?reject(Error(text)):resolve());}))).catch(e=>{console.error(e.message);process.exitCode=1;});`;const r=cp.spawnSync(process.execPath,['-e',script,cli,f.dir],{cwd:f.dir,encoding:'utf8',timeout:60000,windowsHide:true,env:{...process.env,LEERNESS_INTERNAL:'1',LEERNESS_NO_AUTOCHCP:'1',LEERNESS_NO_STALE_CHECK:'1'}});assert.ifError(r.error);assert.strictEqual(r.status,0,r.stdout+r.stderr);const teams=JSON.parse(fs.readFileSync(f.json,'utf8'));assert.deepStrictEqual(teams.map(t=>t.id),['survivor']);assert.strictEqual(fs.readFileSync(f.md,'utf8'),render(teams));});
console.log('teams-text-probe: '+passed+'/'+(passed+failed)+' passed');
if (!passed && !failed) throw Error('No selected tests');
process.exitCode = failed ? 1 : 0;
