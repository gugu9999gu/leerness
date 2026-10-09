'use strict';
const S = require('./memory-write-budget-support');
const { assert, fs, path, cp, arena, entry, test, finish, fixture, row, options } = S;
const { renderLosslessArchiveEntries } = require('../lib/memory-archive');
const root=path.resolve(__dirname,'..'),hook=path.join(arena,'publication-hook.cjs');
const policy=JSON.stringify({limits:options(),mode:'within-target',targets:{items:100,canonicalBytes:65536,projectionBytes:65536,archiveBytes:65536,totalPathBytes:200000}});
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC)$/i.test(k)));
for(const key of ['TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA']){env[key]=path.join(arena,key.toLowerCase());fs.mkdirSync(env[key]);}
Object.assign(env,{LEERNESS_INTERNAL:'1',LEERNESS_OFFLINE:'1',LEERNESS_NO_BANNER:'1',LEERNESS_NO_PROMPT:'1',LEERNESS_NO_AUTOCHCP:'1'});
fs.writeFileSync(hook,String.raw`
'use strict';
const fs=require('fs'),path=require('path'),cfg=JSON.parse(process.env.LEERNESS_PUBLICATION_FIXTURE);
const canonical=path.join(cfg.project,'.leerness',cfg.surface+'.json');
const saved={openSync:fs.openSync,closeSync:fs.closeSync,readFileSync:fs.readFileSync,writeFileSync:fs.writeFileSync,unlinkSync:fs.unlinkSync};
const recovery=require(path.join(cfg.repo,'lib/memory-recovery'));
const originalRecovery=recovery.attachMemoryRecovery;let recovering=false,publishing=false;
recovery.attachMemoryRecovery=function(...args){recovering=true;return originalRecovery(...args);};
const preparation=require(path.join(cfg.repo,'lib/memory-write-preparation'));
const originalPublish=preparation.publishPreparedMemoryWrite;
preparation.publishPreparedMemoryWrite=function(...args){publishing=true;try{return originalPublish(...args);}finally{publishing=false;}};
let unboundedValidation=0,unboundedRecovery=0,fired=false;const descriptors=new Map();
const tracked=file=>typeof file==='string'&&(file===canonical||file===path.join(cfg.project,'.leerness',cfg.surface+'.md')||file===path.join(cfg.project,'.leerness',cfg.surface+'.archive.md')||String(file).includes('.leerness-write-')||String(file).includes('.publish-'));
fs.openSync=function(file,...args){
  if(cfg.mode==='receipt'&&typeof file==='string'&&path.basename(file)==='receipt.json')throw Object.assign(new Error('injected receipt failure'),{code:'EIO'});
  if(!fired&&['partial','receipt'].includes(cfg.mode)&&typeof file==='string'&&path.basename(file)==='next'&&saved.readFileSync(canonical,'utf8').includes('fresh')){
    fired=true;throw Object.assign(new Error('injected later write failure'),{code:'EIO'});
  }
  const fd=saved.openSync.call(fs,file,...args);if(tracked(file))descriptors.set(fd,file);return fd;
};
fs.closeSync=function(fd){descriptors.delete(fd);return saved.closeSync.call(fs,fd);};
fs.readFileSync=function(file,...args){if(publishing&&(tracked(file)||descriptors.has(file))){if(recovering)unboundedRecovery++;else unboundedValidation++;}return saved.readFileSync.call(fs,file,...args);};
fs.unlinkSync=function(file){if(cfg.mode!=='clean'&&cfg.mode!=='growth'&&path.basename(String(file))==='before')throw Object.assign(new Error('injected cleanup failure'),{code:'EACCES'});return saved.unlinkSync.apply(fs,arguments);};
fs.writeFileSync=function(file,...args){if(cfg.mode==='receipt'&&typeof file==='string'&&path.basename(file)==='receipt.json')throw Object.assign(new Error('injected receipt failure'),{code:'EIO'});return saved.writeFileSync.call(fs,file,...args);};
if(cfg.mode==='growth'){
  const io=require(path.join(cfg.repo,'lib/io')),original=io.writeBufferIfUnchanged;
  io.writeBufferIfUnchanged=function(file,...args){const result=original(file,...args);if(file===canonical){fired=true;saved.writeFileSync(file,Buffer.alloc(262144,69));}return result;};
}
process.on('exit',()=>process.stderr.write('MEMORY_PUBLICATION_TRACE '+JSON.stringify({unboundedValidation,unboundedRecovery,fired,recovering})+'\n'));
`);
function make(s){return fixture(s,[row(s,'base')],'\nPRIVATE suffix\n',{[s+'.archive.md']:'# Archive\n\n## 제거 2026-09-01 (target: "recover")\n'+renderLosslessArchiveEntries(s,[row(s,'revive')])+'\n'});}
function run(p,s,kind,mode='cleanup',transport='cli',json=true){
  const config={repo:root,project:p,surface:s,mode};
  const childEnv={...env,NODE_OPTIONS:'--require '+JSON.stringify(hook),LEERNESS_PUBLICATION_FIXTURE:JSON.stringify(config)};
  const args=kind==='restore'?['memory','restore',s,'recover']:kind==='drop'?[s==='decisions'?'decision':'lesson','drop','base']:[s==='decisions'?'decision':'lesson',s==='decisions'?'add':'save','fresh'];
  let input='';
  if(transport==='mcp'){
    const name=kind==='restore'?'leerness_memory_restore':'leerness_'+(s==='decisions'?'decision_':'lesson_')+(kind==='drop'?'drop':s==='decisions'?'add':'save');
    const fields=kind==='restore'?{surface:s,target:'recover'}:kind==='drop'?{target:'base'}:s==='decisions'?{title:'fresh'}:{text:'fresh'};
    input=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{...fields,path:p,writePolicyJson:policy}}})+'\n';
  }
  const argv=transport==='mcp'?[entry,'mcp','serve','--profile','full']:[entry,...args,'--path',p,'--write-policy-json',policy,...(json?['--json']:[])];
  const r=cp.spawnSync(process.execPath,argv,{cwd:p,env:childEnv,input,encoding:'utf8',timeout:90000,maxBuffer:2097152,windowsHide:true});
  assert(!r.error&&!r.signal,r.error?.message);
  const trace=r.stderr.match(/MEMORY_PUBLICATION_TRACE (\{[^\n]+\})/g)?.map(line=>JSON.parse(line.slice('MEMORY_PUBLICATION_TRACE '.length))).pop();
  if(transport==='mcp'){
    const rpc=JSON.parse(r.stdout);assert(rpc.result,JSON.stringify(rpc));
    return {r,result:JSON.parse(rpc.result.content[0].text),isError:rpc.result.isError,trace};
  }
  return {r,result:json?JSON.parse(r.stdout):null,trace};
}
function report(result,pending){
  const out=result.memoryPublication;assert(out,'missing publication result');assert.equal(out.validationReadMaxBytes,32768);
  assert.equal(out.cleanupPending,pending);assert.equal(out.recoveryReadsBounded,false);assert.equal(out.failureRetentionBounded,false);assert.equal(out.physicalReservation,false);
  assert(!JSON.stringify(out).includes(arena));assert(!JSON.stringify(out).includes('PRIVATE'));
  return out;
}
for(const s of ['decisions','lessons']){
  for(const kind of ['update','drop','restore'])for(const transport of ['cli','mcp'])test(s+' '+kind+' '+transport+' exposes cleanup retention after successful publication',()=>{
    const p=make(s),{r,result,isError,trace}=run(p,s,kind,'cleanup',transport);assert.equal(r.status,0,r.stderr);if(transport==='mcp')assert.equal(isError,false);
    const out=report(result,true);assert(out.retainedPaths.some(a=>a.kind==='file'&&a.bytes>0));
    assert.equal(out.normalCleanupConfirmed,false);assert.equal(out.retainedInventoryComplete,false);
    const rows=JSON.parse(fs.readFileSync(path.join(p,'.leerness',s+'.json')));assert.equal(rows.length,kind==='drop'?0:2);
    if(transport==='cli'){assert(trace);assert.equal(trace.unboundedValidation,0);}
  });
  test(s+' clean publication reports no known retention',()=>{
    const p=make(s),{r,result,trace}=run(p,s,'update','clean');assert.equal(r.status,0,r.stderr);
    const out=report(result,false);assert.equal(out.knownRetainedFileBytes,0);assert.equal(out.normalCleanupConfirmed,true);assert.equal(trace.unboundedValidation,0);
  });
  for(const mode of ['partial','receipt'])for(const transport of ['cli','mcp'])test(s+' '+mode+' failure keeps cleanup evidence in the '+transport+' error',()=>{
    const p=make(s),{r,result,trace,isError}=run(p,s,'update',mode,transport);if(transport==='cli')assert.notEqual(r.status,0);else assert.equal(isError,true);assert.equal(result.code,'memory_partial_write');
    report(result,true);if(transport==='cli'){assert(trace.fired);assert.equal(trace.unboundedValidation,0);assert.equal(trace.unboundedRecovery,0);}
    assert(result.recoveryCosts.sourceBytesRead>0);assert.equal(result.recoveryCosts.readChunkMaxBytes,32768);
    if(mode==='partial'){
      const receipt=JSON.parse(fs.readFileSync(path.resolve(p,result.recoveryReceipt)));assert.deepEqual(receipt.memoryPublication,result.memoryPublication);
    }else{assert.equal(result.recoveryReceipt,null);assert.equal(result.primaryRecoveryError,'EIO');}
  });
  test(s+' plain text success warns when cleanup remains',()=>{
    const p=make(s),{r}=run(p,s,'update','cleanup','cli',false);assert.equal(r.status,0,r.stderr);assert(r.stderr.includes('Memory publication cleanup pending:'));
  });
  if(process.platform==='win32')for(const transport of ['cli','mcp'])test(s+' '+transport+' post-replacement growth is partial failure with full recovery bytes',()=>{
    const p=make(s),{r,result,trace,isError}=run(p,s,'update','growth',transport);if(transport==='cli')assert.notEqual(r.status,0);else assert.equal(isError,true);assert.equal(result.code,'memory_partial_write');
    assert.equal(result.causeCode,'E_OUTPUT_LIMIT');report(result,false);assert.equal(result.memoryPublication.normalCleanupConfirmed,false);
    if(transport==='cli'){assert(trace.fired);assert.equal(trace.unboundedValidation,0);assert.equal(trace.unboundedRecovery,0);}assert(result.recoveryCosts.sourceBytesRead>=262144);
    const receiptFile=path.resolve(p,result.recoveryReceipt),receipt=JSON.parse(fs.readFileSync(receiptFile));
    const live=receipt.live.find(a=>a.role==='canonical');assert.equal(live.size,262144);assert.equal(fs.statSync(path.join(path.dirname(receiptFile),live.artifact)).size,262144);
  });
}
finish('memory publication CLI/MCP');
