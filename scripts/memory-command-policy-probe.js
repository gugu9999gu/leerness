'use strict';
const S = require('./memory-write-budget-support');
const { assert, fs, path, cp, arena, entry, finish, fixture, row, options, snapshot } = S;
const { renderLosslessArchiveEntries } = require('../lib/memory-archive');
const test = (name,fn) => { if (!process.env.MEMORY_COMMAND_CASE || name.includes(process.env.MEMORY_COMMAND_CASE)) S.test(name,fn); };
const policy = over => ({ limits: options(over), mode: 'within-target',
  targets: { items: 100, canonicalBytes: 65536, projectionBytes: 65536, archiveBytes: 65536, totalPathBytes: 200000 } });
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC)$/i.test(k)));
for (const key of ['TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA']) { env[key] = path.join(arena,key.toLowerCase()); fs.mkdirSync(env[key]); }
Object.assign(env,{ LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1' });
const hook = path.join(arena,'command-policy-hook.cjs');
fs.writeFileSync(hook,`'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),c=JSON.parse(process.env.MEMORY_COMMAND_FIXTURE);
const api=require(c.module),capture=api.captureMemoryWriteAdmission,prepare=api.prepareAdmittedMemoryWrite,publish=api.publishAdmittedMemoryWrite;
const trace={captures:0,prepares:0,publishes:0,locked:false,unboundedReads:0,canonicalOpens:0,candidateStringifies:0,readStacks:[]};let phase='startup';
const read=fs.readFileSync,open=fs.openSync,stringify=JSON.stringify;
const domain=f=>typeof f==='string'&&['.json','.md','.archive.md'].some(suffix=>path.resolve(f)===path.join(c.root,'.leerness',c.surface+suffix));
fs.readFileSync=function(f,...rest){if(domain(f)&&phase!=='publish'){trace.unboundedReads++;trace.readStacks.push({file:f,phase,stack:new Error().stack});}return read.call(this,f,...rest)};
fs.openSync=function(f,...rest){if(f===path.join(c.root,'.leerness',c.surface+'.json')&&phase!=='publish')trace.canonicalOpens++;return open.call(this,f,...rest)};
JSON.stringify=function(v,...rest){if(phase==='candidate'&&Array.isArray(v))trace.candidateStringifies++;return stringify.call(this,v,...rest)};
api.captureMemoryWriteAdmission=function(...args){trace.captures++;trace.locked=fs.existsSync(path.join(c.root,'.leerness',c.surface+'.json.lock'));if(!process.argv.includes('--dry-run'))assert(trace.locked);phase='capture';const h=capture(...args);phase='candidate';
 if(c.race==='source')fs.appendFileSync(path.join(c.root,'.leerness',c.surface+'.json'),' ');
 if(c.race==='recovery'){const d=path.join(c.root,'.leerness','archive','mutation-recovery');fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'race.raw'),'race');}
 return h;};
api.prepareAdmittedMemoryWrite=function(...args){trace.prepares++;phase='admit';return prepare(...args)};
api.publishAdmittedMemoryWrite=function(...args){trace.publishes++;phase='publish';return publish(...args)};
process.on('exit',()=>process.stderr.write('MEMORY_COMMAND_TRACE '+stringify(trace)+'\\n'));
`);
let sequence = 0;
function argsFor(s,kind,value='base') {
  const noun = s === 'decisions' ? 'decision' : 'lesson';
  return kind === 'restore' ? ['memory','restore',s,value] : [noun,kind === 'drop' ? 'drop' : s === 'decisions' ? 'add' : 'save',value];
}
function make(s,rows=[row(s,'base')]) {
  return fixture(s,rows,'\nPRIVATE suffix\r\n',{ [s+'.archive.md']: '# Archive\n\n## 제거 2026-09-01 (target: "recover")\n'+renderLosslessArchiveEntries(s,[row(s,'revive')])+'\n' });
}
function run(p,s,args,pol=policy(),extra={}) {
  const traceFile=path.join(arena,'trace-'+sequence+++'.json');
  const flags=Array.isArray(pol)?pol:pol===null?[]:['--write-policy-json',JSON.stringify(pol)];
  const result=cp.spawnSync(process.execPath,['--require',hook,entry,...args,...flags,'--path',p,'--json'],{
    cwd:p,env:{...env,MEMORY_COMMAND_FIXTURE:JSON.stringify({root:p,surface:s,trace:traceFile,module:path.resolve(__dirname,'../lib/memory-write-admission'),...extra})},
    encoding:'utf8',timeout:45000,maxBuffer:1048576,windowsHide:true });
  assert(!result.error&&!result.signal,result.error?.message);
  const line=result.stderr.split(/\r?\n/).find(line=>line.startsWith('MEMORY_COMMAND_TRACE '));
  assert(line,result.stdout+result.stderr);result.trace=JSON.parse(line.slice('MEMORY_COMMAND_TRACE '.length));return result;
}
function files(p) { return Object.fromEntries(Object.entries(snapshot(p)).filter(([,v])=>v.hash!==null)); }
function rejected(result,reason,phase) {
  assert.notEqual(result.status,0,result.stdout+result.stderr);
  const data=JSON.parse(result.stdout); assert.equal(data.code,'memory_policy',result.stdout);
  if(reason)assert.equal(data.reasonCode,reason,result.stdout);if(phase)assert.equal(data.phase,phase,result.stdout);
  assert(!result.stdout.includes('PRIVATE')&&!result.stdout.includes(arena));
  assert.equal(result.trace.publishes,0);
}
for(const s of ['decisions','lessons']) {
  for(const kind of ['update','drop','restore','duplicate','force']) test(s+': real command '+kind+' preserves lock, suffix, selection and archive',()=>{
    const p=make(s),before=files(p),a=argsFor(s,kind==='drop'||kind==='restore'?kind:'update',kind==='restore'?'recover':kind==='update'?'fresh':'base');
    if(kind==='force')a.push('--force');const r=run(p,s,a);assert.equal(r.status,0,r.stdout+r.stderr);
    assert(r.trace.locked);assert.equal(r.trace.unboundedReads,0,JSON.stringify(r.trace.readStacks));
    if(kind==='duplicate'){assert.equal(JSON.parse(r.stdout).skipped,true);assert.equal(r.trace.prepares,0);assert.deepEqual(files(p),before);return;}
    assert.equal(r.trace.publishes,1);const rows=JSON.parse(fs.readFileSync(path.join(p,'.leerness',s+'.json')));
    assert.equal(rows.length,kind==='drop'?0:2);assert(fs.readFileSync(path.join(p,'.leerness',s+'.md'),'utf8').endsWith('\nPRIVATE suffix\r\n'));
    if(kind==='restore')assert.equal(fs.readFileSync(path.join(p,'.leerness',s+'.archive.md'),'utf8'),'# Archive\n\n');
    else if(kind==='drop')assert(fs.readFileSync(path.join(p,'.leerness',s+'.archive.md'),'utf8').includes('base'));
    else assert.equal(files(p)['./.leerness/'+s+'.archive.md'].hash,before['./.leerness/'+s+'.archive.md'].hash);
  });
  for(const kind of ['update','drop','restore'])test(s+': '+kind+' source limit rejects before canonical open',()=>{
    const p=make(s),before=files(p),r=run(p,s,argsFor(s,kind,kind==='restore'?'recover':'base'),policy({source:{maxInputBytes:1}}));
    rejected(r,'E_STORE_LIMIT','source');assert.equal(r.trace.canonicalOpens,0,JSON.stringify(r.trace.readStacks));assert.equal(r.trace.unboundedReads,0);assert.deepEqual(files(p),before);
  });
  for(const [axis,value,reason] of [['maxItems',1,'items_exceeded'],['maxInputBytes',2,'input_bytes_exceeded'],['maxItemBytes',1,'item_bytes_exceeded'],
    ['maxCanonicalBytes',2,'canonical_bytes_exceeded'],['maxProjectionBytes',1,'projection_bytes_exceeded'],['maxDepth',1,'depth_exceeded'],['maxNodes',1,'nodes_exceeded']])test(s+': '+axis+' stops before candidate stringify',()=>{
    const p=make(s),before=files(p),r=run(p,s,argsFor(s,'update','fresh'),policy({candidate:{[axis]:value}}));
    rejected(r,reason,'candidate');assert.equal(r.trace.candidateStringifies,0);assert.equal(r.trace.prepares,0);assert.deepEqual(files(p),before);
  });
  for(const kind of ['drop','restore'])test(s+': '+kind+' archive envelope limit preserves files',()=>{
    const p=make(s),before=files(p),r=run(p,s,argsFor(s,kind,kind==='restore'?'recover':'base'),policy({operation:{maxArchiveInputBytes:1}}));
    rejected(r,'archive_input_bytes_exceeded','operation');assert.equal(r.trace.prepares,0);assert.deepEqual(files(p),before);
  });
  test(s+': reduction permits shrinking excess but force cannot bypass processing limits',()=>{
    const p=make(s,[row(s,'base'),row(s,'keep')]),pol=policy();pol.mode='reduce-existing';pol.targets.items=0;
    const r=run(p,s,argsFor(s,'drop','base'),pol);assert.equal(r.status,0,r.stdout+r.stderr);
    const before=files(p);pol.limits.candidate.maxItems=0;const denied=run(p,s,[...argsFor(s,'update','keep'),'--force'],pol);
    rejected(denied,'items_exceeded','candidate');assert.deepEqual(files(p),before);
  });
  test(s+': target excess denies publication',()=>{
    const p=make(s),pol=policy();pol.targets.items=1;const before=files(p),r=run(p,s,argsFor(s,'update','fresh'),pol);
    rejected(r,'target_exceeded','targets');assert.deepEqual(files(p),before);
  });
  test(s+': unknown nested canonical fields survive actual add unchanged',()=>{
    const original={...row(s,'base'),extension:{nested:[1,null,{text:'한🙂\\"\n'}]}},p=make(s,[original]);
    const r=run(p,s,argsFor(s,'update','fresh'));assert.equal(r.status,0,r.stdout+r.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(p,'.leerness',s+'.json')))[0],original);
  });
  test(s+': restore candidate count stops before candidate stringify',()=>{
    const p=make(s),before=files(p),r=run(p,s,argsFor(s,'restore','recover'),policy({candidate:{maxItems:1}}));
    rejected(r,'items_exceeded','candidate');assert.equal(r.trace.candidateStringifies,0);assert.equal(r.trace.prepares,0);assert.deepEqual(files(p),before);
  });
  test(s+': lossy drop remains denied under force',()=>{
    const p=make(s,[{...row(s,'base'),extension:{keep:true}}]),before=files(p),r=run(p,s,[...argsFor(s,'drop'),'--force']);
    assert.notEqual(r.status,0);assert.equal(JSON.parse(r.stdout).code,'archive_lossy');assert.equal(r.trace.publishes,0);assert.deepEqual(files(p),before);
  });
  test(s+': restore conflict remains denied and force explicitly restores',()=>{
    const p=make(s,[row(s,'revive')]),before=files(p),r=run(p,s,argsFor(s,'restore','recover'));
    assert.notEqual(r.status,0);assert.equal(JSON.parse(r.stdout).code,'restore_conflict');assert.deepEqual(files(p),before);
    const forced=run(p,s,[...argsFor(s,'restore','recover'),'--force']);assert.equal(forced.status,0,forced.stdout+forced.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(p,'.leerness',s+'.json'))).length,2);
  });
  test(s+': legacy requires explicit migration while default still works',()=>{
    const p=make(s),file=path.join(p,'.leerness',s+'.json');fs.unlinkSync(file);const before=files(p);
    rejected(run(p,s,argsFor(s,'update','fresh')),'legacy_migration_required','source');assert.deepEqual(files(p),before);
    const r=run(p,s,argsFor(s,'update','fresh'),null);assert.equal(r.status,0,r.stdout+r.stderr);assert(r.trace.unboundedReads>0,'positive read meter control');
  });
  test(s+': empty store accepted',()=>{
    const p=S.project({HARNESS_VERSION:require('../package.json').version}),r=run(p,s,argsFor(s,'update','fresh'));
    assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(JSON.parse(fs.readFileSync(path.join(p,'.leerness',s+'.json'))).length,1);
  });
  for(const race of ['source','recovery'])test(s+': changed '+race+' rejects before publication',()=>{
    const p=make(s),before=files(p),r=run(p,s,argsFor(s,'update','fresh'),policy(),{race});
    assert.notEqual(r.status,0);assert.equal(r.trace.publishes,0);const after=files(p);
    for(const suffix of ['.md','.archive.md'])assert.deepEqual(after['./.leerness/'+s+suffix],before['./.leerness/'+s+suffix]);
  });
  for(const kind of ['update','drop','restore'])test(s+': policy '+kind+' respects dry-run',()=>{
    const p=make(s),before=files(p),r=run(p,s,[...argsFor(s,kind,kind==='restore'?'recover':'base'),'--force','--dry-run']);
    assert.notEqual(r.status,0);assert.equal(JSON.parse(r.stdout).code,'dry_run_unsupported',r.stdout+r.stderr);assert.equal(r.trace.publishes,1);assert.deepEqual(files(p),before);
  });
}
for(const flags of [['--write-policy-json'],['--write-policy-json='],['--write-policy-json','{}'],['--write-policy-json','{}','--write-policy-json','{}']])test('invalid CLI option '+flags.join(' ')+' never captures',()=>{
  const p=make('decisions'),before=files(p),r=run(p,'decisions',argsFor('decisions','update','fresh'),flags);
  if(flags.length===1){assert.notEqual(r.status,0);assert.equal(JSON.parse(r.stdout).code,'missing_flag_value');}
  else rejected(r);assert.equal(r.trace.captures,0);assert.deepEqual(files(p),before);
});
for(const args of [['decision','list'],['memory','restore','plan','base']])test('policy cannot be ignored by '+args.join(' '),()=>{
  const p=make('decisions'),before=files(p),r=run(p,'decisions',args);rejected(r,'command_unsupported','policy');assert.deepEqual(files(p),before);
});
test('equals-form policy is applied without becoming title text',()=>{
  const p=make('decisions'),r=run(p,'decisions',argsFor('decisions','update','fresh'),['--write-policy-json='+JSON.stringify(policy())]);
  assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(JSON.parse(fs.readFileSync(path.join(p,'.leerness','decisions.json')))[1].title,'fresh');
});
finish('memory command policy');
