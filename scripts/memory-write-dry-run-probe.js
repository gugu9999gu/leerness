'use strict';
const { assert, fs, path, cp, arena, entry, test, snapshot, finish, fixture, row } = require('./memory-write-budget-support');
const { renderLosslessArchiveEntries } = require('../lib/memory-archive');
const preparation=path.resolve(__dirname,'../lib/memory-write-preparation.js'),hook=path.join(arena,'dry-publication-hook.cjs');
fs.writeFileSync(hook,`'use strict';
const api=require(process.env.LEERNESS_DRY_PREPARATION),publish=api.publishPreparedMemoryWrite;
api.publishPreparedMemoryWrite=function(handle){process.stderr.write('PUBLICATION_ENTERED:'+handle.operation+'\\n');return publish(handle);};
`);
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC)$/i.test(k)));
for(const key of ['TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA']){env[key]=path.join(arena,key.toLowerCase());fs.mkdirSync(env[key]);}
Object.assign(env,{LEERNESS_INTERNAL:'1',LEERNESS_OFFLINE:'1',LEERNESS_NO_BANNER:'1',LEERNESS_NO_PROMPT:'1',LEERNESS_NO_AUTOCHCP:'1',LEERNESS_DRY_PREPARATION:preparation});
for(const s of ['decisions','lessons'])for(const kind of ['update','drop','restore','duplicate','force'])test(s+': '+kind+' dry-run classification and zero mutation',()=>{
  const p=fixture(s,[row(s,'base')],'\nPRIVATE suffix\n',{[s+'.archive.md']:'# Archive\n\n## 제거 2026-09-01 (target: "recover")\n'+renderLosslessArchiveEntries(s,[row(s,'revive')])+'\n'});
  const noun=s==='decisions'?'decision':'lesson';
  const args=kind==='drop'?[noun,'drop','base']:kind==='restore'?['memory','restore',s,'recover']:[noun,s==='decisions'?'add':'save',kind==='update'?'fresh':'base',...(kind==='force'?['--force']:[])];
  const before=snapshot(p),r=cp.spawnSync(process.execPath,['--require',hook,entry,...args,'--path',p,'--dry-run','--json'],{
    cwd:p,env,encoding:'utf8',timeout:45000,maxBuffer:1048576,windowsHide:true});
  assert(!r.error&&!r.signal,r.error?.message);
  assert.deepEqual(snapshot(p),before,'dry-run must preserve the whole fixture including metadata and file set');
  if(kind==='duplicate'){assert.equal(r.status,0,r.stdout+r.stderr);assert(!r.stderr.includes('PUBLICATION_ENTERED:'));return;}
  assert.equal(r.status,1,r.stdout+r.stderr);assert(r.stderr.includes('PUBLICATION_ENTERED:'),'must exercise the actual publisher');
  assert.equal(JSON.parse(r.stdout).code,'dry_run_unsupported');
});
finish('memory write dry-run');
