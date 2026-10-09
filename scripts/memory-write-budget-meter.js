'use strict';
// Test-only meter adapted from the ML-04D experiment. Requires an owned fixture;
// records path lengths at actual filesystem/replacement boundaries, not allocation.
const fs=require('fs'), path=require('path'), cp=require('child_process');
const cfg=JSON.parse(process.env.LEERNESS_WRITE_BUDGET_METER);
const root=fs.realpathSync(cfg.root), workspace=path.join(root,'.leerness');
if(!fs.existsSync(path.join(root,'.write-budget-owned'))||!['decisions','lessons'].includes(cfg.surface))throw Error('Invalid meter fixture');
const names=[cfg.surface+'.json',cfg.surface+'.md',cfg.surface+'.archive.md'];
const raw=Object.fromEntries(['readdirSync','lstatSync','writeFileSync'].map(k=>[k,fs[k].bind(fs)]));
let busy=false,error=null,initial=null,final=null,peak=0,observations=0;
function observe(){
  if(busy||error)return;busy=true;
  try{
    let bytes=0,entries=0;
    function visit(dir,relative='',depth=0){
      if(depth>16)throw Error('depth exceeded');
      for(const name of raw.readdirSync(dir)){
        if(++entries>10000)throw Error('entries exceeded');
        const file=path.join(dir,name),rel=relative?relative+'/'+name:name;
        let stat;try{stat=raw.lstatSync(file);}catch(e){if(e.code==='ENOENT')continue;throw e;}
        if(stat.isSymbolicLink())throw Error('unexpected link');
        if(stat.isDirectory())visit(file,rel,depth+1);
        else if(names.includes(rel)||rel.startsWith('archive/mutation-recovery/')||rel.startsWith('.'+cfg.surface+'.'))bytes+=stat.size;
      }
    }
    visit(workspace);if(initial===null)initial=bytes;final=bytes;peak=Math.max(peak,bytes);observations++;
  }catch(e){error=e.code||e.message;}finally{busy=false;}
}
for(const key of ['writeFileSync','appendFileSync','mkdirSync','mkdtempSync','renameSync','linkSync','unlinkSync','rmdirSync','rmSync','closeSync']){
  const original=fs[key];fs[key]=function(...args){const result=original.apply(fs,args);observe();return result;};
}
const spawn=cp.spawnSync;
cp.spawnSync=function(command,args,options){
  const replacement=options&&options.env&&options.env.LEERNESS_REPLACE_TO;
  if(replacement)observe();const result=spawn.call(cp,command,args,options);if(replacement)observe();return result;
};
observe();
process.on('exit',()=>{observe();raw.writeFileSync(cfg.receipt,JSON.stringify({initial,final,peak,observations,error})+'\n');});
