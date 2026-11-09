'use strict';
require('./temp-cleanup').trackTemp(module);  
const S=require('./memory-write-budget-support');
const {assert,fs,path,cp,test,finish,fixture,arena}=S;
const os=require('os'),runtime=require('../lib/runtime-writes'),{attachMemoryRecovery}=require('../lib/memory-recovery');
 
 
 
const rawOpen=fs.openSync.bind(fs),rawWriteSync=fs.writeSync.bind(fs),rawClose=fs.closeSync.bind(fs),rawRename=fs.renameSync.bind(fs);
const rawSymlink=fs.symlinkSync.bind(fs),rawUnlink=fs.unlinkSync.bind(fs),rawRmdir=fs.rmdirSync.bind(fs);
const rawUnlinkLink=link=>{try{rawUnlink(link);}catch{rawRmdir(link);}};
function rawWrite(file,text){const fd=rawOpen(file,'w');try{rawWriteSync(fd,Buffer.from(text));}finally{rawClose(fd);}}
const descriptor={schema:'leerness.runtime-layout/v1',schemaVersion:1,scope:'project-local',generation:1,layout:'legacy',requiredWriterProtocol:1};
 
 
function project(){const p=fixture();fs.mkdirSync(path.join(p,'.leerness','cache'));return p;}
function latch(p,fn){
  let observed=false,innerError,outer;
  try{runtime.withRuntimeWrites(p,()=>{
    rawWrite(path.join(p,'.leerness','cache','state-layout.json'),JSON.stringify({...descriptor,requiredWriterProtocol:2}));
    assert.throws(()=>runtime.assertCurrentRuntimeWrite(path.join(p,'.leerness','state.json')),e=>e.code==='E_RUNTIME_LAYOUT_INCOMPATIBLE');
    try{fn();}catch(error){innerError=error;}observed=true;
  });}catch(error){outer=error;}
  if(innerError)throw innerError;assert(observed);assert.equal(outer.originalOutputCode||outer.code,'E_RUNTIME_LAYOUT_INCOMPATIBLE');
}
const external=[];
test('external stream refuses before producer invocation without a latch',()=>{
  const p=project();let called=false;assert.throws(()=>runtime.writeExternalRecoveryStream(p,()=>{called=true;},8),e=>e.code==='E_RECOVERY_BYPASS_NOT_LATCHED');assert.equal(called,false);
});
test('healthy runtime scope does not grant the recovery bypass',()=>{
  const p=project();runtime.withRuntimeWrites(p,()=>{assert.throws(()=>runtime.writeExternalRecoveryStream(p,()=>{},8),e=>e.code==='E_RECOVERY_BYPASS_NOT_LATCHED');});
});
test('latched recovery writes bytes outside the project and leaves the latch in force',()=>{
  const p=project();let dir;latch(p,()=>{dir=runtime.writeExternalRecoveryStream(p,sink=>sink.write('before.bin',put=>put(Buffer.from('before'))),8);});
  external.push(dir);assert(!path.relative(p,dir).startsWith('.leerness'));assert.equal(fs.readFileSync(path.join(dir,'before.bin'),'utf8'),'before');
});
test('a temp directory inside the project is rejected before producer work',()=>{
  const p=project(),original=os.tmpdir;let called=false;latch(p,()=>{
    os.tmpdir=()=>p;try{assert.throws(()=>runtime.writeExternalRecoveryStream(p,()=>{called=true;},8),e=>e.code==='E_RECOVERY_TEMP_UNSAFE');}finally{os.tmpdir=original;}
  });assert.equal(called,false);
});
 
 
function shortName(p){const r=cp.spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c',`"for %I in ("${p}") do @echo %~sI"`],{encoding:'utf8',windowsHide:true,windowsVerbatimArguments:true});const out=String(r.stdout||'').trim();return r.status===0&&out&&!out.includes('"')&&out.toLowerCase()!==p.toLowerCase()?out:null;}
const insideSpellings=[['a link outside the project',(p,inside)=>{const link=p+'-temp-link';fs.symlinkSync(inside,link,process.platform==='win32'?'junction':'dir');return link;}],
  ...(process.platform==='win32'?[['its 8.3 short name',(p,inside)=>shortName(inside)]]:[])];
for(const [name,spell] of insideSpellings){
  const p=project(),inside=path.join(p,'temp-folder-with-a-long-name');fs.mkdirSync(inside);const spelled=spell(p,inside);
  if(!spelled){console.log('SKIP a temp folder inside the project named by '+name+' (no such spelling here)');continue;}
  test('a temp folder inside the project named by '+name+' is rejected before producer work',()=>{
    assert(path.relative(p,spelled).startsWith('..'),'the spelling must look outside the project: '+spelled);
    const original=os.tmpdir;let called=false;latch(p,()=>{
      os.tmpdir=()=>spelled;try{assert.throws(()=>runtime.writeExternalRecoveryStream(p,()=>{called=true;},8),e=>e.code==='E_RECOVERY_TEMP_UNSAFE');}finally{os.tmpdir=original;}
    });assert.equal(called,false);assert.deepEqual(fs.readdirSync(inside),[]);
  });
}
 
 
test('a project renamed away during the operation still gets its recovery outside it',()=>{
  const p=project(),moved=p+'-moved';let dir;latch(p,()=>{
    rawRename(p,moved);try{dir=runtime.writeExternalRecoveryStream(p,sink=>sink.write('before.bin',put=>put(Buffer.from('before'))),8);}finally{rawRename(moved,p);}
  });
  external.push(dir);assert(path.relative(p,dir).startsWith('..'));assert.equal(fs.readFileSync(path.join(dir,'before.bin'),'utf8'),'before');
});
 
 
for(const [name,spell] of [['directly',(p,inside)=>inside],['through a link outside the project',(p,inside)=>{const link=p+'-dots-link';fs.symlinkSync(inside,link,process.platform==='win32'?'junction':'dir');return link;}]]){
  test('a temp folder inside the project whose name starts with two dots, named '+name+', is rejected before producer work',()=>{
    const p=project(),inside=path.join(p,'..temp');fs.mkdirSync(inside);const spelled=spell(p,inside),original=os.tmpdir;let called=false;latch(p,()=>{
      os.tmpdir=()=>spelled;try{assert.throws(()=>runtime.writeExternalRecoveryStream(p,()=>{called=true;},8),e=>e.code==='E_RECOVERY_TEMP_UNSAFE');}finally{os.tmpdir=original;}
    });assert.equal(called,false);assert.deepEqual(fs.readdirSync(inside),[]);
  });
}
test('a project path that fails to resolve for a reason other than absence is refused',()=>{
  const p=project(),original=fs.realpathSync.native;let called=false;latch(p,()=>{
    fs.realpathSync.native=function(q,...rest){if(path.resolve(String(q))===path.resolve(p))throw Object.assign(new Error('EIO: simulated'),{code:'EIO'});return original.call(this,q,...rest);};
    try{assert.throws(()=>runtime.writeExternalRecoveryStream(p,()=>{called=true;},8),e=>e.code==='E_RECOVERY_TEMP_UNSAFE');}finally{fs.realpathSync.native=original;}
  });assert.equal(called,false);
});
 
 
test('a temp link retargeted into the project after the check still gets the recovery outside the project',()=>{
  const p=project(),inside=path.join(p,'temp-after-retarget');fs.mkdirSync(inside);
  const safe=fs.mkdtempSync(path.join(path.dirname(p),'safe-temp-')),link=p+'-temp-retarget-link',type=process.platform==='win32'?'junction':'dir';
  rawSymlink(safe,link,type);
  const originalTmp=os.tmpdir,originalReal=fs.realpathSync.native;let dir,retargeted=false;
  latch(p,()=>{
    os.tmpdir=()=>link;
    fs.realpathSync.native=function(q,...rest){if(!retargeted&&path.resolve(String(q))===path.resolve(p)){retargeted=true;rawUnlinkLink(link);rawSymlink(inside,link,type);}return originalReal.call(this,q,...rest);};
    try{dir=runtime.writeExternalRecoveryStream(p,sink=>sink.write('before.bin',put=>put(Buffer.from('before'))),8);}finally{os.tmpdir=originalTmp;fs.realpathSync.native=originalReal;}
  });
  external.push(dir);assert(retargeted,'the link must have been retargeted during the check');
  assert.deepEqual(fs.readdirSync(inside),[]);assert.equal(fs.readFileSync(path.join(dir,'before.bin'),'utf8'),'before');
  assert(path.relative(fs.realpathSync.native(p),fs.realpathSync.native(dir)).split(path.sep)[0]==='..','the recovery must be outside the project: '+dir);
});
for(const [label,write] of [['stream',p=>runtime.writeExternalRecoveryStream(p,()=>{throw new Error('producer must not run');},8)],['bundle',p=>runtime.writeExternalRecoveryBundle(p,[{name:'receipt.json',bytes:Buffer.from('{}')}])]])test('T-0356 '+label+': the checked real temp folder swapped for a link into the project before mkdtemp is refused and leaves nothing inside',()=>{
  const p=project(),inside=path.join(p,'temp-swapped-in');fs.mkdirSync(inside);
  const realTemp=fs.mkdtempSync(path.join(path.dirname(p),'real-temp-')),moved=realTemp+'-moved',type=process.platform==='win32'?'junction':'dir';
  const originalTmp=os.tmpdir,originalReal=fs.realpathSync.native;let swapped=false;
  try{
    latch(p,()=>{
      os.tmpdir=()=>realTemp;
      fs.realpathSync.native=function(q,...rest){const r=originalReal.call(this,q,...rest);if(!swapped&&path.resolve(String(q))===path.resolve(p)){swapped=true;rawRename(realTemp,moved);rawSymlink(inside,realTemp,type);}return r;};
      try{assert.throws(()=>write(p),e=>e.code==='E_RECOVERY_TEMP_UNSAFE');}finally{os.tmpdir=originalTmp;fs.realpathSync.native=originalReal;}
    });
    assert(swapped,'the folder must have been swapped during the check');assert.deepEqual(fs.readdirSync(inside),[]);
  }finally{if(swapped){rawUnlinkLink(realTemp);rawRename(moved,realTemp);}}
});
test('a missing temp folder is refused when the project path is gone too',()=>{
  const p=project(),moved=p+'-moved-too',original=os.tmpdir;let called=false;latch(p,()=>{
    rawRename(p,moved);os.tmpdir=()=>path.join(path.dirname(p),'missing-temp-folder');
    try{assert.throws(()=>runtime.writeExternalRecoveryStream(p,()=>{called=true;},8),e=>e.code==='E_RECOVERY_TEMP_UNSAFE');}finally{os.tmpdir=original;rawRename(moved,p);}
  });assert.equal(called,false);
});
test('a temp folder that does not resolve is refused before producer work',()=>{
  const p=project(),original=os.tmpdir;let called=false;latch(p,()=>{
    os.tmpdir=()=>path.join(path.dirname(p),'missing-temp-folder');try{assert.throws(()=>runtime.writeExternalRecoveryStream(p,()=>{called=true;},8),e=>e.code==='E_RECOVERY_TEMP_UNSAFE');}finally{os.tmpdir=original;}
  });assert.equal(called,false);
});
test('invalid chunk admission occurs before creating an external namespace',()=>{
  const p=project();latch(p,()=>{for(const value of [0,-1,65537,1.5,'8'])assert.throws(()=>runtime.writeExternalRecoveryStream(p,()=>{},value),e=>e.code==='E_RECOVERY_BUNDLE_INVALID');});
});
test('external producer failure retains its exact prefix and reports the directory',()=>{
  const p=project();let error;latch(p,()=>{assert.throws(()=>runtime.writeExternalRecoveryStream(p,sink=>sink.write('prefix.bin',put=>{put(Buffer.from('prefix'));throw Object.assign(new Error('producer failed'),{code:'EIO'});}),8),e=>{error=e;return e.code==='EIO';});});
  external.push(error.recoveryBundleDirectory);assert.equal(fs.readFileSync(path.join(error.recoveryBundleDirectory,'prefix.bin'),'utf8'),'prefix');assert.equal(error.recoveryBundleProgress.bytesWritten,6);assert.equal(error.recoveryBundleProgress.files[0].complete,false);
});
test('external stream enforces 128 files before the 129th producer',()=>{
  const p=project();let error,called=false;latch(p,()=>{assert.throws(()=>runtime.writeExternalRecoveryStream(p,sink=>{
    for(let i=0;i<128;i++)sink.write('part-'+i,put=>put(Buffer.from('x')));
    sink.write('overflow',()=>{called=true;});
  },8),e=>{error=e;return e.code==='E_RECOVERY_BUNDLE_INVALID';});});
  external.push(error.recoveryBundleDirectory);assert.equal(called,false);assert.equal(fs.readdirSync(error.recoveryBundleDirectory).length,128);assert.equal(error.recoveryBundleProgress.bytesWritten,128);
});
test('closed external sink cannot outlive its authorized callback',()=>{
  const p=project();let retained,dir;latch(p,()=>{dir=runtime.writeExternalRecoveryStream(p,sink=>{retained=sink;sink.write('a',()=>{});},8);});
  external.push(dir);assert.throws(()=>retained.write('b',()=>{}),e=>e.code==='E_RECOVERY_SINK_CLOSED');assert.deepEqual(fs.readdirSync(dir),['a']);
});
test('layout failure after a primary copy preserves both attempts and charges repeated source reads',()=>{
  const p=project(),source=path.join(p,'source');fs.writeFileSync(source,Buffer.alloc(100,70));
  const error=Object.assign(new Error('publication'),{code:'EIO'}),before=[{role:'canonical',file:source,exists:true,kind:'file',bytes:Buffer.from('before')}];
  const read=fs.readSync,sourceInode=fs.statSync(source,{bigint:true}).ino;let injected=false,innerError,observed=false;
  try{runtime.withRuntimeWrites(p,()=>{
    fs.readSync=function(...args){const n=read.apply(fs,args);if(!injected&&fs.fstatSync(args[0],{bigint:true}).ino===sourceInode){injected=true;rawWrite(path.join(p,'.leerness','cache','state-layout.json'),JSON.stringify({...descriptor,requiredWriterProtocol:2}));}return n;};
    try{attachMemoryRecovery(error,p,{surface:'decisions',operation:'update'},before,{maxChunkBytes:8});observed=true;}catch(e){innerError=e;}
    finally{fs.readSync=read;}
  });}catch{}
  if(innerError)throw innerError;assert(observed);assert(injected);assert(error.memoryRecoveryExternal);
  const costs=error.memoryRecoveryCosts;assert.equal(costs.attempts.length,2);assert.equal(costs.sourceBytesRead,108);assert.equal(costs.attempts[0].allObservedSourcesStable,false);assert.equal(costs.attempts[1].allObservedSourcesStable,true);
  const primary=path.resolve(p,costs.attempts[0].directory);assert.equal(fs.readFileSync(path.join(primary,'before-canonical.bin'),'utf8'),'before');assert.equal(fs.statSync(path.join(primary,'live-canonical.bin')).size,0);
  external.push(costs.attempts[1].directory);assert.equal(fs.statSync(path.join(costs.attempts[1].directory,'live-canonical.bin')).size,100);assert.equal(fs.statSync(source).size,100);
});
for(const failReceipt of [false,true])test('streaming full recovery after layout latch '+(failReceipt?'retains failed external receipt':'preserves before/live/cause and costs'),()=>{
  const p=project(),source=path.join(p,'source'),cause=path.join(p,'cause');fs.writeFileSync(source,Buffer.alloc(65539,70));fs.writeFileSync(cause,Buffer.from('cause'));
  const error=Object.assign(new Error('publication'),{code:'EIO',backupFile:cause});
   
   
  const stringify=JSON.stringify;let rawReads=0;const read=fs.readFileSync;
  latch(p,()=>{
    fs.readFileSync=function(file,...args){if(file===source||file===cause)rawReads++;return read.call(fs,file,...args);};
    if(failReceipt)JSON.stringify=function(value,...args){if(value&&value.storage==='external-temp'&&value.before&&value.live)throw Object.assign(new Error('receipt serialization'),{code:'EIO'});return stringify.call(JSON,value,...args);};
    try{attachMemoryRecovery(error,p,{surface:'decisions',operation:'update',stage:'projection-write'},[{role:'canonical',file:source,exists:true,kind:'file',bytes:Buffer.from('before')}],{maxChunkBytes:1024});}
    finally{fs.readFileSync=read;JSON.stringify=stringify;}
  });
  assert.equal(rawReads,0);assert.equal(error.code,'E_MEMORY_PARTIAL_WRITE');assert.equal(error.memoryRecoveryPrimaryError,'E_RUNTIME_LAYOUT_INCOMPATIBLE');
  const costs=error.memoryRecoveryCosts;assert.equal(costs.attempts.length,1);assert.equal(costs.sourceBytesRead,65544);assert.equal(costs.attempts[0].storage,'external-temp');
  const dir=costs.attempts[0].directory;external.push(dir);assert.equal(fs.statSync(path.join(dir,'live-canonical.bin')).size,65539);
  assert.equal(fs.readFileSync(path.join(dir,'before-canonical.bin'),'utf8'),'before');assert.equal(fs.readFileSync(source).length,65539);
  if(failReceipt){assert(!error.memoryRecoveryReceipt);assert.equal(error.memoryRecoveryError,'EIO');assert.equal(error.memoryRecoveryFailedExternalDirectory,dir);}
  else{assert(error.memoryRecoveryExternal);const receipt=JSON.parse(fs.readFileSync(error.memoryRecoveryReceipt));assert.equal(receipt.live[0].stable,true);assert.equal(receipt.recoveryCosts.snapshotBeforeReceipt,true);}
});
test('128 MiB accounting ceiling uses a counting write primitive without allocating or writing 128 MiB',()=>{
  const p=project(),modulePath=path.resolve(__dirname,'../lib/runtime-writes.js');
  function child(){
    const fs=require('fs'),path=require('path'),assert=require('assert');const p=process.argv[1],runtimePath=process.argv[2];
    const open=fs.openSync.bind(fs),writeSync=fs.writeSync.bind(fs),close=fs.closeSync.bind(fs),fds=new Set();let counted=0;
    function write(file,text){const fd=open(file,'w');try{writeSync(fd,Buffer.from(text));}finally{close(fd);}}
    fs.openSync=function(file,...args){const fd=open(file,...args);if(String(file).includes('leerness-memory-recovery-'))fds.add(fd);return fd;};
    fs.writeSync=function(fd,bytes,offset,length,position){if(fds.has(fd)){counted+=length;return length;}return writeSync(fd,bytes,offset,length,position);};
    fs.closeSync=function(fd){fds.delete(fd);return close(fd);};
    const runtime=require(runtimePath);let captured,inner;
    try{runtime.withRuntimeWrites(p,()=>{
      const layout=path.join(p,'.leerness','cache','state-layout.json');write(layout,JSON.stringify({schema:'leerness.runtime-layout/v1',schemaVersion:1,scope:'project-local',generation:1,layout:'legacy',requiredWriterProtocol:2}));
      try{runtime.assertCurrentRuntimeWrite(layout);}catch{}
      try{runtime.writeExternalRecoveryStream(p,sink=>sink.write('limited.bin',put=>{const chunk=Buffer.alloc(65536);for(let i=0;i<2049;i++)put(chunk);}),65536);}catch(e){captured=e;}
      try{assert.equal(captured.code,'E_RECOVERY_BUNDLE_TOO_LARGE');assert.equal(counted,128*1024*1024);assert.equal(captured.recoveryBundleProgress.bytesWritten,counted);assert(fs.existsSync(captured.recoveryBundleDirectory));}catch(e){inner=e;}
    });}catch{}
    if(inner)throw inner;assert(captured);process.stdout.write('COUNTING_CAP_PASS');
  }
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP)$/i.test(k)));
  const result=cp.spawnSync(process.execPath,['-e','('+child.toString()+')()',p,modulePath],{cwd:arena,env,encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(result.status,0,result.stderr);assert(result.stdout.includes('COUNTING_CAP_PASS'));
});
{
  const crypto=require('crypto'),observations=[];
  function inventory(root){
    const rows={};
    function visit(file){
      const s=fs.lstatSync(file,{bigint:true});
      const row=Object.fromEntries(['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'].map(k=>[k,String(s[k])]));
      if(s.isSymbolicLink())row.link=fs.readlinkSync(file);
      else if(s.isFile())row.sha256=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      rows[path.relative(root,file)]=row;
      if(s.isDirectory()&&!s.isSymbolicLink())for(const name of fs.readdirSync(file).sort())visit(path.join(file,name));
    }
    visit(root);return rows;
  }
  function outcome(fn){try{return{returned:fn()};}catch(e){return{code:e.code,message:e.message};}}
  function save(row){observations.push(row);fs.writeFileSync(path.join(arena,'recovery-guard-observations.json'),JSON.stringify(observations,null,2));}
  function alias(p,name,long){
    let parent=path.join(arena,name);
    if(long){while(parent.length+62<260)parent=path.join(parent,'x'.repeat(60));}
    fs.mkdirSync(parent,{recursive:true});
    const link=path.join(parent,long?'j'.repeat(270-parent.length-1):'alias');
    if(long)assert.equal(link.length,270);
    rawSymlink(p,link,process.platform==='win32'?'junction':'dir');return link;
  }
  function geometry(p,link){
    const real=fs.realpathSync.native(path.toNamespacedPath(link));
    const canonicalProject=fs.realpathSync.native(p);
    const identity=file=>{const s=fs.statSync(file,{bigint:true});return[s.dev,s.ino,s.mode,s.nlink].map(String);};
    assert.equal(real,canonicalProject);assert.deepEqual(identity(real),identity(link));
    return{project:p,alias:link,aliasLength:link.length,rawAlias:outcome(()=>fs.realpathSync.native(link)),canonical:real,identity:identity(real)};
  }
  if(process.platform==='win32'){
  test('Windows long project alias cannot admit temp inside its physical project',()=>{
    const p=project(),inside=path.join(p,'inside-temp');fs.mkdirSync(inside);
    const link=alias(p,'initial-long-alias',true),row=geometry(p,link),tmp=os.tmpdir;
    try{latch(link,()=>{
      row.before={project:inventory(p),aliasParent:inventory(path.dirname(link))};os.tmpdir=()=>inside;
      try{row.shortControl=outcome(()=>runtime.assertExternalRecoveryAllowed(p));row.longAlias=outcome(()=>runtime.assertExternalRecoveryAllowed(link));}
      finally{os.tmpdir=tmp;}
      row.after={project:inventory(p),aliasParent:inventory(path.dirname(link))};
      assert.deepEqual(row.after,row.before);
    });}finally{save(row);}
    assert.equal(row.shortControl.code,'E_RECOVERY_TEMP_UNSAFE');assert.equal(row.longAlias.code,'E_RECOVERY_TEMP_UNSAFE');
  });
  test('Windows retargeted long project alias is refused by the post-mkdtemp guard before producer work',()=>{
    const a=project(),b=project(),inside=path.join(b,'inside-temp');fs.mkdirSync(inside);
    const link=alias(a,'post-long-alias',true),row=geometry(a,link),tmp=os.tmpdir,native=fs.realpathSync.native;
    let called=false,retargeted=false;row.calls=[];
    try{latch(link,()=>{
      row.before={a:inventory(path.join(a,'.leerness')),b:inventory(path.join(b,'.leerness'))};os.tmpdir=()=>inside;
      fs.realpathSync.native=function(q,...args){
        const match=[link,path.toNamespacedPath(link)].includes(String(q));let value,error;
        try{value=native.call(this,q,...args);return value;}catch(e){error=e;throw e;}
        finally{if(match){row.calls.push({input:String(q),returned:value,code:error&&error.code});if(!retargeted){retargeted=true;rawRename(link,link+'-retained');rawSymlink(b,link,'junction');}}}
      };
      try{row.result=outcome(()=>runtime.writeExternalRecoveryStream(link,()=>{called=true;},8));}
      finally{os.tmpdir=tmp;fs.realpathSync.native=native;}
      row.after={a:inventory(path.join(a,'.leerness')),b:inventory(path.join(b,'.leerness'))};row.insideEntries=fs.readdirSync(inside);row.producerCalled=called;
      assert.deepEqual(row.after,row.before);
    });}finally{row.retargeted=retargeted;save(row);}
    assert(retargeted);assert.equal(row.calls.length,2);assert.equal(row.result.code,'E_RECOVERY_TEMP_UNSAFE');assert.equal(called,false);assert.deepEqual(row.insideEntries,[]);
  });
  test('Windows genuinely external long temp base admits a bounded recovery stream',()=>{
    const p=project(),tmp=os.tmpdir,row={kind:'long-external-temp-positive',project:p};
    let base=path.join(arena,'positive-long-temp');
    while(base.length+62<270)base=path.join(base,'x'.repeat(60));
    base=path.join(base,'t'.repeat(270-base.length-1));fs.mkdirSync(base,{recursive:true});assert.equal(base.length,270);
    row.tempBase=base;
    try{latch(p,()=>{
      row.before=inventory(p);os.tmpdir=()=>base;
      try{
      row.directory=runtime.writeExternalRecoveryStream(p,sink=>sink.write('tiny.bin',put=>put(Buffer.from('safe'))),8);
      external.push(row.directory);assert(row.directory.length>=300);
      row.realBase=fs.realpathSync.native(path.toNamespacedPath(base));
      row.realDirectory=fs.realpathSync.native(path.toNamespacedPath(row.directory));
      assert.equal(path.dirname(row.realDirectory),row.realBase);
      const relative=path.relative(fs.realpathSync.native(p),row.realDirectory);
      assert(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative));
      const bytes=fs.readFileSync(path.join(row.directory,'tiny.bin'));assert.deepEqual(bytes,Buffer.from('safe'));row.bytes=bytes.length;
      row.bundleDirectory=runtime.writeExternalRecoveryBundle(p,[{name:'tiny.bin',bytes:Buffer.from('safe')}]);
      external.push(row.bundleDirectory);assert(row.bundleDirectory.length>=300);
      row.realBundleDirectory=fs.realpathSync.native(path.toNamespacedPath(row.bundleDirectory));
      assert.equal(path.dirname(row.realBundleDirectory),row.realBase);
      const bundleRelative=path.relative(fs.realpathSync.native(p),row.realBundleDirectory);
      assert(bundleRelative==='..'||bundleRelative.startsWith('..'+path.sep)||path.isAbsolute(bundleRelative));
      const bundleBytes=fs.readFileSync(path.join(row.bundleDirectory,'tiny.bin'));assert.deepEqual(bundleBytes,Buffer.from('safe'));row.bundleBytes=bundleBytes.length;
      row.after=inventory(p);assert.deepEqual(row.after,row.before);
      }finally{os.tmpdir=tmp;}
    });}finally{save(row);}
  });
  }
  for(const code of ['EACCES','EPERM','EIO'])test('post-mkdtemp project '+code+' is refused before producer work',()=>{
    const a=project(),b=project(),inside=path.join(b,'inside-temp');fs.mkdirSync(inside);
    const link=alias(a,'post-unknown-'+code,false),row=geometry(a,link),tmp=os.tmpdir,native=fs.realpathSync.native;
    let calls=0,called=false;
    try{latch(link,()=>{
      row.before={a:inventory(path.join(a,'.leerness')),b:inventory(path.join(b,'.leerness'))};os.tmpdir=()=>inside;
      fs.realpathSync.native=function(q,...args){if([link,path.toNamespacedPath(link)].includes(String(q))&&++calls===2)throw Object.assign(new Error('owned post-guard failure'),{code});return native.call(this,q,...args);};
      try{row.result=outcome(()=>runtime.writeExternalRecoveryStream(link,()=>{called=true;},8));}
      finally{os.tmpdir=tmp;fs.realpathSync.native=native;}
      row.after={a:inventory(path.join(a,'.leerness')),b:inventory(path.join(b,'.leerness'))};row.insideEntries=fs.readdirSync(inside);row.producerCalled=called;row.projectResolutionCalls=calls;
      assert.deepEqual(row.after,row.before);
    });}finally{save(row);}
    assert.equal(calls,2);assert.equal(row.result.code,'E_RECOVERY_TEMP_UNSAFE');assert.equal(called,false);assert.deepEqual(row.insideEntries,[]);
  });
}
fs.writeFileSync(path.join(arena,'external-directories.json'),JSON.stringify(external,null,2));
finish('memory recovery external');
