'use strict';
const { assert, fs, path, cp, arena, entry, test, snapshot, finish, row, render, fixture, inspect } = require('./memory-write-budget-support');
const { renderLosslessArchiveEntries, archiveCheckLine } = require('../lib/memory-archive');
const { today } = require('../lib/io');
const meter=path.join(__dirname,'memory-write-budget-meter.js');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC)$/i.test(k)));
for(const key of ['TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA']){env[key]=path.join(arena,key.toLowerCase());fs.mkdirSync(env[key]);}
Object.assign(env,{LEERNESS_INTERNAL:'1',LEERNESS_OFFLINE:'1',LEERNESS_NO_BANNER:'1',LEERNESS_NO_PROMPT:'1',LEERNESS_NO_AUTOCHCP:'1'});
let sequence=0;
function run(p,s,args,code=null){
  fs.writeFileSync(path.join(p,'.write-budget-owned'),'synthetic\n');const receipt=path.join(arena,'meter-'+sequence+++'.json');
  const child=cp.spawnSync(process.execPath,['--require',meter,...(code?['-e',code]:[entry,...args,'--path',p,'--json'])],{
    cwd:p,env:{...env,LEERNESS_WRITE_BUDGET_METER:JSON.stringify({root:p,surface:s,receipt})},encoding:'utf8',timeout:45000,maxBuffer:1048576,windowsHide:true});
  assert(!child.error&&!child.signal,child.error?.message);assert.equal(child.status,0,child.stdout+child.stderr);
  const trace=JSON.parse(fs.readFileSync(receipt));assert.equal(trace.error,null);assert(trace.observations>1);return trace;
}
test('meter positive control counts hard-link alias at real fs boundaries',()=>{
  const p=fixture('decisions',[],'',{'decisions.json':'','decisions.md':'','decisions.archive.md':''});
  const trace=run(p,'decisions',[],"const fs=require('fs'),p=require('path');const h=p.join(process.cwd(),'.leerness'),a=p.join(h,'.decisions.control'),b=p.join(h,'decisions.archive.md');fs.unlinkSync(b);fs.writeFileSync(a,Buffer.alloc(43));fs.linkSync(a,b);fs.unlinkSync(a);");
  assert.equal(trace.initial,0);assert.equal(trace.peak,86);assert.equal(trace.final,43);
});
for(const s of ['decisions','lessons'])for(const scenario of ['update','new','drop','new-archive','restore','restore-all'])test(s+': real CLI '+scenario+' matches preflight bytes and normal peak',()=>{
  const rows=[row(s,'keep'),row(s,'selected')],restored=[row(s,'archived')],suffix='\nPRIVATE 보존🙂\r\n';
  const header='# '+(s==='decisions'?'Decisions':'Lessons')+' archive\n\n';
  const block='## 제거 2026-09-02 (target: "restore-me")\n'+renderLosslessArchiveEntries(s,restored)+'\n';
  const kept='## 제거 2026-09-03 (target: "keep-archived")\n'+renderLosslessArchiveEntries(s,[row(s,'other')])+'\n';
  const archive=header+block+(scenario==='restore-all'?'':kept),p=fixture(s,rows,suffix,{[s+'.archive.md']:archive});
  if(scenario==='new')for(const extension of ['.json','.md'])fs.unlinkSync(path.join(p,'.leerness',s+extension));
  if(scenario==='new-archive')fs.unlinkSync(path.join(p,'.leerness',s+'.archive.md'));
  const retained=path.join(p,'.leerness/archive/mutation-recovery/prior.bin');fs.mkdirSync(path.dirname(retained),{recursive:true});fs.writeFileSync(retained,Buffer.alloc(17));
  const noun=s==='decisions'?'decision':'lesson';let candidate,operation,args;
  if(scenario==='drop'||scenario==='new-archive'){
    // T-0331: a drop writes its integrity record right after the header line.
    const gone=renderLosslessArchiveEntries(s,[rows[1]]);
    candidate=[rows[0]];operation={kind:'drop',archiveText:(scenario==='new-archive'?header:'')+'\n## 제거 '+today()+' (target: "selected")\n'+archiveCheckLine(1,gone)+gone+'\n'};args=[noun,'drop','selected'];
  }else if(scenario.startsWith('restore')){
    candidate=[...rows,...restored];operation={kind:'restore',archiveText:header+(scenario==='restore-all'?'':kept)};args=['memory','restore',s,'restore-me'];
  }else{
    candidate=[...(scenario==='new'?[]:rows),{...row(s,'new-entry'),date:today()}];operation={kind:'update',archiveText:null};args=[noun,s==='decisions'?'add':'save','new-entry'];
  }
  const before=snapshot(p),r=inspect(p,s,candidate,operation);assert(r.ok,JSON.stringify(r));assert.deepEqual(snapshot(p),before);
  const trace=run(p,s,args),m=r.measurement;
  const after=Object.fromEntries([['canonical','.json'],['projection','.md'],['archive','.archive.md']].map(([role,ext])=>[role,fs.readFileSync(path.join(p,'.leerness',s+ext))]));
  assert.deepEqual(JSON.parse(after.canonical),candidate);assert.equal(after.projection.toString(),render(s,candidate)+(scenario==='new'?'':suffix));
  for(const role of Object.keys(after))assert.equal(after[role].length,m.next[role],role);
  assert.equal(trace.initial,m.observed.totalPathBytes);assert.equal(trace.final,m.finalPathBytes);assert.equal(trace.peak,m.normalPeakPathBytes);
  assert.equal(fs.readFileSync(retained).length,17);
});
finish('memory write budget CLI');
