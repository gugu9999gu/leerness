'use strict';
const { assert, fs, path, cp, arena, entry, test, snapshot, finish, fixture, row, options } = require('./memory-write-budget-support');
const { renderLosslessArchiveEntries } = require('../lib/memory-archive');
const preparation=path.resolve(__dirname,'../lib/memory-write-preparation.js'),hook=path.join(arena,'prepared-hook.cjs');
fs.writeFileSync(hook,`'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const config=JSON.parse(process.env.LEERNESS_PREPARED_FIXTURE),api=require(config.module),prepare=api.prepareMemoryWrite;
const trace={calls:0,locked:false,result:null,operation:null};
api.prepareMemoryWrite=function(root,surface,entries,input,archive){
  trace.calls++;assert(fs.existsSync(path.join(root,'.leerness',surface+'.json.lock')));trace.locked=true;
  const handle=prepare(root,surface,entries,input,archive);trace.operation=handle.operation;
  trace.result=api.assessPreparedMemoryWrite(handle,JSON.stringify(config.limits));assert(trace.result.ok);
  entries.push(surface==='decisions'?{title:'late-mutation'}:{text:'late-mutation'});
  input.entries.length=0;if(archive)archive.text='late archive mutation';
  return handle;
};
process.on('exit',()=>fs.writeFileSync(config.trace,JSON.stringify(trace)+'\\n'));
`);
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC)$/i.test(k)));
for(const key of ['TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA']){env[key]=path.join(arena,key.toLowerCase());fs.mkdirSync(env[key]);}
Object.assign(env,{LEERNESS_INTERNAL:'1',LEERNESS_OFFLINE:'1',LEERNESS_NO_BANNER:'1',LEERNESS_NO_PROMPT:'1',LEERNESS_NO_AUTOCHCP:'1'});
let sequence=0;
for(const s of ['decisions','lessons'])for(const kind of ['update','drop','restore','duplicate','force'])test(s+': actual '+kind+' uses preparation under canonical lock',()=>{
  const archived=row(s,'revive'),p=fixture(s,[row(s,'base')],'\nPRIVATE suffix\n',{[s+'.archive.md']:'# Archive\n\n## 제거 2026-09-01 (target: "recover")\n'+renderLosslessArchiveEntries(s,[archived])+'\n'});
  const noun=s==='decisions'?'decision':'lesson';
  const args=kind==='drop'?[noun,'drop','base']:kind==='restore'?['memory','restore',s,'recover']:[noun,s==='decisions'?'add':'save',kind==='update'?'fresh':'base',...(kind==='force'?['--force']:[])];
  const traceFile=path.join(arena,'trace-'+sequence+++'.json'),before=snapshot(p);
  const result=cp.spawnSync(process.execPath,['--require',hook,entry,...args,'--path',p,'--json'],{
    cwd:p,env:{...env,LEERNESS_PREPARED_FIXTURE:JSON.stringify({module:preparation,trace:traceFile,limits:options()})},encoding:'utf8',timeout:45000,maxBuffer:1048576,windowsHide:true});
  assert(!result.error&&!result.signal,result.error?.message);assert.equal(result.status,0,result.stdout+result.stderr);
  const trace=JSON.parse(fs.readFileSync(traceFile));
  if(kind==='duplicate'){
    assert.equal(trace.calls,0);const after=snapshot(p);
    // The canonical lock can change directory mtime during a duplicate no-op;
    // persistent domain bytes and file metadata must still remain unchanged.
    for(const suffix of ['.json','.md','.archive.md']){const file='./.leerness/'+s+suffix;assert.deepEqual(after[file],before[file]);}
    return;
  }
  assert.equal(trace.calls,1);assert(trace.locked&&trace.result.preparedBytesUsed&&trace.result.originalInputsRechecked);
  assert.equal(trace.operation,['drop','restore'].includes(kind)?kind:'update');
  for(const [role,suffix]of [['canonical','.json'],['projection','.md'],['archive','.archive.md']]){
    const bytes=fs.readFileSync(path.join(p,'.leerness',s+suffix));assert.equal(bytes.length,trace.result.measurement.next[role]);assert(!bytes.toString().includes('late-mutation')&&!bytes.toString().includes('late archive mutation'));
  }
  const rows=JSON.parse(fs.readFileSync(path.join(p,'.leerness',s+'.json')));assert.equal(rows.length,kind==='drop'?0:2);
});
finish('memory write preparation CLI');
