'use strict';
require('./temp-cleanup').trackTemp(module);
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module'),cp=require('node:child_process'),crypto=require('node:crypto');
const source=path.resolve(process.env.LEERNESS_LEGACY_TEST_SOURCE||path.join(__dirname,'..')),cli=path.join(source,'bin/leerness.js'),io=require(path.join(source,'lib/io'));
const m=new Module(cli,module);m.filename=cli;m.paths=Module._nodeModulePaths(path.dirname(cli));m._compile(fs.readFileSync(cli,'utf8')+'\nconst originalPolicySave=_savePolicy;module.exports.legacyReadProbe={ruleVerifyCmd,taskExportCmd,memoryStatusCmd,contextCmd,_loadPolicy,_savePolicy,_policyEnforce,policyCmd,beforeSave:fn=>{_savePolicy=fn?(...args)=>{fn();return originalPolicySave(...args);}:originalPolicySave;}};',cli);const api=m.exports.legacyReadProbe;
const arena=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'t344l-'));let sequence=0;
function fixture(){const root=path.join(arena,'p'+sequence++),ws=path.join(root,'.leerness'),file=n=>path.join(ws,n),put=(n,bytes)=>{fs.mkdirSync(path.dirname(file(n)),{recursive:true});fs.writeFileSync(file(n),bytes);};put('HARNESS_VERSION',require(path.join(source,'package.json')).version+'\n');put('manifest.json',JSON.stringify({language:'en',mode:'standard'}));put('progress-tracker.md','# Tasks\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n| T-0001 | in-progress | Authored source | evidence | Keep next | 2026-11-06 |\n');for(const n of ['plan','rules','current-state','session-handoff','task-log','review-evidence','decisions','lessons','project-brief'])put(n+'.md','# '+n+'\n');return{root,ws,file,put};}
function gap(file,body='Authored source\n'){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);const dir=fs.mkdtempSync(path.join(path.dirname(file),'.'+path.basename(file)+'.publish-cas-'));fs.renameSync(file,path.join(dir,'before'));fs.writeFileSync(path.join(dir,'next'),'Candidate\n');return dir;}
function digest(root){const list=[];function visit(dir){for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),s=fs.lstatSync(file,{bigint:true});list.push([path.relative(root,file),String(s.ino),String(s.mtimeNs),s.isFile()?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null]);if(s.isDirectory())visit(file);}}visit(root);return list;}
function run(f,args,preload=''){const env={...process.env};for(const k of Object.keys(env))if(/^(?:LEERNESS_|_LEERNESS_|GIT_|NODE_OPTIONS$|CODEX_THREAD_ID$|CLAUDE_CODE_)/i.test(k))delete env[k];Object.assign(env,{LEERNESS_OFFLINE:'1',LEERNESS_INTERNAL:'1',LEERNESS_NO_AUTO_ROADMAP:'1',LEERNESS_NO_ENV_DETECT:'1',LEERNESS_NO_AUTOCHCP:'1'});const prefix=[];if(preload){const file=path.join(arena,'preload-'+sequence+++'.cjs');fs.writeFileSync(file,preload);prefix.push('--require',file);}const r=cp.spawnSync(process.execPath,[...prefix,cli,...args,'--path',f.root],{cwd:f.root,env,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4*1024*1024});assert.equal(r.error,undefined);assert.equal(r.signal,null);return r;}
function quiet(fn,args=[]){const argv=process.argv,write=process.stdout.write;process.argv=['node',cli,...args];process.stdout.write=()=>true;try{return fn();}finally{process.argv=argv;process.stdout.write=write;api.beforeSave(null);}}
const { CANONICAL_WORKSPACE_DIR, LEGACY_WORKSPACE_DIR } = require(path.join(source, 'lib/workspace-dir'));
for(const directory of [CANONICAL_WORKSPACE_DIR,LEGACY_WORKSPACE_DIR])for(const method of ['exists','read'])for(const name of ['plan.md','cache/next-action.json','한글.[원문].md'])test('shared '+method+' refuses '+directory+'/'+name+' publication absence',()=>{const f=fixture(),file=path.join(f.root,directory,name);gap(file);const before=digest(f.root);assert.throws(()=>io[method](file),{code:'E_STORE_CHANGED'});assert.deepEqual(digest(f.root),before);});
test('shared true absence and missing parent retain old contracts',()=>{const f=fixture();for(const file of [f.file('missing.md'),f.file('missing-parent/file.md')]){assert.equal(io.exists(file),false);assert.throws(()=>io.read(file),{code:'ENOENT'});}});
test('unmanaged absence is not promoted to managed publication state',()=>{const f=fixture(),file=path.join(f.root,'outside.md');gap(file);assert.equal(io.exists(file),false);assert.throws(()=>io.read(file),{code:'ENOENT'});});
test('present fast path and UTF8 BOM contract remain unchanged',()=>{const f=fixture();f.put('bom.md','\ufeffOwner 한글\r\n');const original=fs.readdirSync;let reads=0;fs.readdirSync=function(...args){reads++;return original.apply(this,args);};try{for(let i=0;i<100;i++)assert(io.exists(f.file('bom.md')));assert.equal(io.read(f.file('bom.md')),'Owner 한글\r\n');assert.equal(reads,0);}finally{fs.readdirSync=original;}});
test('unavailable publication enumeration refuses rather than proving absence',()=>{const f=fixture(),original=fs.readdirSync;fs.readdirSync=function(file,...args){if(path.resolve(String(file))===f.ws)throw Object.assign(new Error('fixture'),{code:'EACCES'});return original.call(this,file,...args);};try{assert.throws(()=>io.exists(f.file('missing.md')),{code:'E_STORE_UNREADABLE'});}finally{fs.readdirSync=original;}});
for(const name of ['plan.md','decisions.archive.md','lessons.archive.md','plan.archive.md'])test('memory status refuses unavailable '+name,()=>{const f=fixture();gap(f.file(name));const before=digest(f.root),r=run(f,['memory','status','--json']);assert.equal(r.status,1,r.stdout+r.stderr);assert.equal(JSON.parse(r.stdout).ok,false);assert.deepEqual(digest(f.root),before);});
test('context refuses unavailable brief instead of empty intent',()=>{const f=fixture();gap(f.file('project-brief.md'));const before=digest(f.root),r=run(f,['context','--json']);assert.equal(r.status,1,r.stdout+r.stderr);assert.equal(JSON.parse(r.stdout).ok,false);assert.deepEqual(digest(f.root),before);});
for(const name of ['plan.md','policy.json'])test('shared miss-to-read interval is checked for '+name,()=>{const f=fixture();f.put(name,name==='policy.json'?JSON.stringify({allowedTier:'read-only',enforce:true}):'# Authored');const original=fs.readFileSync;let reached=false,displaced;fs.readFileSync=function(file,...args){if(!reached&&file===f.file(name)){reached=true;displaced=gap(f.file(name),name==='policy.json'?JSON.stringify({allowedTier:'read-only',enforce:true}):'# Authored');}return original.call(this,file,...args);};try{assert.throws(()=>io.read(f.file(name)),{code:'E_STORE_CHANGED'});assert(reached);assert(fs.existsSync(path.join(displaced,'before')));}finally{fs.readFileSync=original;}});
test('bare-root policy first save enforces denial and preserves owner source',()=>{
  const root=fs.mkdtempSync(path.join(arena,'bare-policy-')),f={root},owner=path.join(root,'owner-data.txt');
  fs.writeFileSync(owner,'Owner source remains exact.\n');const original=fs.readFileSync(owner),stat=fs.statSync(owner,{bigint:true}),before=digest(root);
  const show=run(f,['policy','show','--json']);assert.equal(show.status,0,show.stdout+show.stderr);assert.deepEqual(digest(root),before);
  assert.equal(fs.existsSync(path.join(root,CANONICAL_WORKSPACE_DIR)),false);
  const first=run(f,['policy','set','read-only','--enforce']);assert.equal(first.status,0,first.stdout+first.stderr);
  const doc=JSON.parse(fs.readFileSync(path.join(root,CANONICAL_WORKSPACE_DIR,'policy.json'),'utf8'));assert.equal(doc.allowedTier,'read-only');assert.equal(doc.enforce,true);
  const denied=run(f,['policy','check','release publish','--json']);assert.equal(denied.status,1,denied.stdout+denied.stderr);assert.equal(JSON.parse(denied.stdout).allowed,false);
  const allowed=run(f,['policy','check','handoff','--json']);assert.equal(allowed.status,0,allowed.stdout+allowed.stderr);assert.equal(JSON.parse(allowed.stdout).allowed,true);
  assert(fs.readFileSync(owner).equals(original));const after=fs.statSync(owner,{bigint:true});for(const key of ['ino','mtimeNs','size'])assert.equal(after[key],stat[key]);
});
for(const kind of ['foreign-legacy','conflicting-workspaces','linked-canonical'])test('raw policy set refuses '+kind+' before writes',()=>{
  const root=fs.mkdtempSync(path.join(arena,'policy-admission-')),canonical=path.join(root,CANONICAL_WORKSPACE_DIR),legacy=path.join(root,LEGACY_WORKSPACE_DIR);let outside=null;
  if(kind==='foreign-legacy'){fs.mkdirSync(legacy);fs.writeFileSync(path.join(legacy,'private-notes'),'Owner foreign source\n');}
  else if(kind==='conflicting-workspaces'){for(const dir of [canonical,legacy]){fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'HARNESS_VERSION'),require(path.join(source,'package.json')).version+'\n');}}
  else{outside=fs.mkdtempSync(path.join(arena,'policy-outside-'));fs.writeFileSync(path.join(outside,'private-notes'),'Linked original\n');fs.symlinkSync(outside,canonical,process.platform==='win32'?'junction':'dir');}
  const before=digest(root),outsideBefore=outside&&digest(outside);
  assert.throws(()=>quiet(()=>api.policyCmd(root,'set','read-only')), {code:'E_RUNTIME_LAYOUT_INCOMPATIBLE'});
  assert.deepEqual(digest(root),before);if(outside)assert.deepEqual(digest(outside),outsideBefore);
});
test('raw bare policy dry-run guard makes no directory or source changes',()=>{
  const root=fs.mkdtempSync(path.join(arena,'policy-dry-'));fs.writeFileSync(path.join(root,'owner-data.txt'),'Dry-run owner source\n');const before=digest(root);
  io.setDryRunGuard(true);try{assert.throws(()=>quiet(()=>api.policyCmd(root,'set','read-only')), {code:'E_DRY_RUN_WRITE'});}finally{io.setDryRunGuard(false);}
  assert.deepEqual(digest(root),before);
});
test('bare rule verification creates no workspace or files',()=>{
  const root=fs.mkdtempSync(path.join(arena,'bare-rules-'));fs.writeFileSync(path.join(root,'owner.txt'),'Authored source\n');const before=digest(root);
  quiet(()=>api.ruleVerifyCmd(root),['rule','verify']);assert.deepEqual(digest(root),before);assert.equal(fs.existsSync(path.join(root,CANONICAL_WORKSPACE_DIR)),false);
});
test('initialized absent rules keep canonical and cache absent',()=>{
  const f=fixture();fs.unlinkSync(f.file('rules.md'));const before=digest(f.root).filter(row=>row[3]!==null),names=fs.readdirSync(f.ws).sort();
  quiet(()=>api.ruleVerifyCmd(f.root),['rule','verify']);assert.deepEqual(digest(f.root).filter(row=>row[3]!==null),before);assert.deepEqual(fs.readdirSync(f.ws).sort(),names);assert.equal(fs.existsSync(f.file('rules.md')),false);assert.equal(fs.existsSync(f.file('cache/rule-state.json')),false);
});
test('human task export uses no state lock and preserves sources',()=>{
  const f=fixture(),before=digest(f.root),locks=require(path.join(source,'lib/state-lock')),original=locks.withStateLock;let calls=0;
  locks.withStateLock=function(...args){calls++;return original.apply(this,args);};
  try{quiet(()=>api.taskExportCmd(f.root),['task','export']);}finally{locks.withStateLock=original;}
  assert.equal(calls,0);assert.deepEqual(digest(f.root),before);assert.equal(fs.existsSync(f.file('cache/task-export-baseline.json')),false);
});
test('raw task export dry-run refuses output and preserves sources',()=>{
  const f=fixture(),output=path.join(f.root,'todos.json');fs.writeFileSync(output,'Owner output\n');const before=digest(f.root);
  io.setDryRunGuard(true);try{assert.throws(()=>quiet(()=>api.taskExportCmd(f.root),['task','export','--to',output,'--dry-run']),{code:'E_DRY_RUN_WRITE'});}finally{io.setDryRunGuard(false);}
  assert.deepEqual(digest(f.root),before);assert.equal(fs.existsSync(f.file('cache/task-export-baseline.json')),false);
});
test('bare task export retains original writer refusal and partial-output boundary',()=>{
  for(const mode of ['json','to']){
    const root=fs.mkdtempSync(path.join(arena,'bare-export-')),owner=path.join(root,'owner.txt'),output=path.join(root,'todos.json');
    fs.writeFileSync(owner,'Owner source\n');const bytes=fs.readFileSync(owner),stat=fs.statSync(owner,{bigint:true});
    const r=run({root},['task','export',...(mode==='json'?['--json']:['--to',output])]);assert.equal(r.status,1,r.stdout+r.stderr);assert.equal(r.stderr,'');
    if(mode==='json'){const data=JSON.parse(r.stdout);assert.equal(data.ok,false);assert.equal(data.code,'store_changed');assert.equal(fs.existsSync(output),false);}
    else{assert(r.stdout.includes('Task export output was written; the baseline was not updated. Inspect the output before retrying.'));assert.deepEqual(JSON.parse(fs.readFileSync(output,'utf8')),[]);}
    const ws=path.join(root,CANONICAL_WORKSPACE_DIR);assert.equal(fs.existsSync(path.join(ws,'HARNESS_VERSION')),false);assert.equal(fs.existsSync(path.join(ws,'manifest.json')),false);assert.equal(fs.existsSync(path.join(ws,'cache/task-export-baseline.json')),false);assert.deepEqual(fs.readdirSync(path.join(ws,'cache')),[]);
    assert(fs.readFileSync(owner).equals(bytes));const after=fs.statSync(owner,{bigint:true});for(const key of ['ino','mtimeNs','size'])assert.equal(after[key],stat[key]);
  }
});
test('missing policy keeps established default',()=>{const f=fixture();assert.deepEqual(api._loadPolicy(f.root),{schemaVersion:1,allowedTier:'project-write',enforce:false});});
for(const [label,bytes,code]of [['publication',null,'E_STORE_CHANGED'],['json','{owner','E_STORE_CORRUPT'],['shape','[]','E_STORE_INVALID'],['tier','{"allowedTier":"publish-everything","enforce":true}','E_STORE_INVALID'],['enforce','{"allowedTier":"read-only","enforce":"false"}','E_STORE_INVALID'],['utf8',Buffer.from([0xff]),'E_STORE_CORRUPT']])test('policy does not infer permission from '+label+' input',()=>{const f=fixture();if(bytes===null)gap(f.file('policy.json'));else f.put('policy.json',bytes);const before=digest(f.root);assert.throws(()=>api._policyEnforce(f.root,'task add'),{code});assert.deepEqual(digest(f.root),before);});
test('policy set binds its pre-lock decision and preserves independent fields',()=>{const f=fixture();f.put('policy.json',JSON.stringify({schemaVersion:1,allowedTier:'project-write',enforce:false,extension:'before'}));const independent=JSON.stringify({schemaVersion:1,allowedTier:'read-only',enforce:true,extension:'independent'});api.beforeSave(()=>f.put('policy.json',independent));assert.throws(()=>quiet(()=>api.policyCmd(f.root,'set','safe-write')), {code:'E_STORE_CHANGED'});assert.equal(fs.readFileSync(f.file('policy.json'),'utf8'),independent);});
test('policy publication preserves a late independent edit',()=>{const f=fixture();f.put('policy.json',JSON.stringify({allowedTier:'project-write',enforce:false}));const independent=JSON.stringify({allowedTier:'read-only',enforce:true,extension:'independent'});let reached=false;const change={get allowedTier(){reached=true;f.put('policy.json',independent);return'safe-write';},enforce:false};assert.throws(()=>api._savePolicy(f.root,change));assert(reached);assert.equal(fs.readFileSync(f.file('policy.json'),'utf8'),independent);});
test('valid policy update preserves extensions and strict denial',()=>{const f=fixture();f.put('policy.json',JSON.stringify({schemaVersion:1,allowedTier:'project-write',enforce:false,extension:{authored:true}}));const r=run(f,['policy','set','safe-write','--enforce','--json']);assert.equal(r.status,0,r.stdout+r.stderr);const doc=JSON.parse(fs.readFileSync(f.file('policy.json')));assert.deepEqual(doc.extension,{authored:true});assert.equal(doc.allowedTier,'safe-write');assert.equal(doc.enforce,true);assert.equal(api._policyEnforce(f.root,'release publish').allowed,false);});
test('normal memory/context retain task identity and no writes',()=>{const f=fixture(),before=digest(f.root);const status=run(f,['memory','status','--json']),context=run(f,['context','--json']);assert.equal(status.status,0,status.stdout+status.stderr);assert.equal(context.status,0,context.stdout+context.stderr);assert.equal(JSON.parse(status.stdout).tasks.inProgress,1);assert.equal(JSON.parse(context.stdout).currentTask.id,'T-0001');assert.deepEqual(digest(f.root),before);});
