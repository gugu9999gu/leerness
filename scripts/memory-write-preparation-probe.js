'use strict';
const { assert, fs, path, cp, test, snapshot, finish, fixture, row, render, options } = require('./memory-write-budget-support');
const { captureMemoryInput, captureCheckedFileInput } = require('../lib/memory-input');
const { _decisionsFromMd, _parseLessonEntries } = require('../lib/pure-utils');
const { prepareMemoryWrite, assessPreparedMemoryWrite, publishPreparedMemoryWrite } = require('../lib/memory-write-preparation');
const paths=(p,s)=>Object.fromEntries([['canonical','.json'],['projection','.md'],['archive','.archive.md']].map(([role,suffix])=>[role,path.join(p,'.leerness',s+suffix)]));
const input=(p,s)=>{const f=paths(p,s);return captureMemoryInput(f.canonical,f.projection,s==='decisions'?_decisionsFromMd:_parseLessonEntries);};
const assess=(h,over)=>assessPreparedMemoryWrite(h,JSON.stringify(options(over)));
const isCode=code=>e=>e.code===code;
for(const s of ['decisions','lessons']){
  for(const kind of ['update','drop','restore'])test(s+': '+kind+' publishes the same prepared bytes after caller mutation',()=>{
    const initial=[row(s)],suffix='\nPRIVATE 유지🙂\r\n',p=fixture(s,initial,suffix),f=paths(p,s),source=input(p,s);
    const next=[...initial,{...row(s,'new'),extension:{nested:['한🙂']}}],expected=JSON.stringify(next,null,2)+'\n';
    const archive=kind==='update'?null:{path:f.archive,text:'prepared archive🙂',mode:kind==='restore'?'replace':'append',input:kind==='restore'?captureCheckedFileInput(f.archive):undefined};
    const before=snapshot(p),h=prepareMemoryWrite(p,s,next,source,archive),cost=assess(h);
    assert.deepEqual(snapshot(p),before);assert(cost.ok,JSON.stringify(cost));assert(cost.preparedBytesUsed&&cost.originalInputsRechecked);
    assert.equal(cost.approvalGranted,false);assert.equal(cost.candidateRelationVerified,false);assert.equal(cost.writesPerformed,false);
    assert.deepEqual(Object.keys(h),['surface','operation']);assert(Object.isFrozen(h));assert(!JSON.stringify(h).includes('PRIVATE'));
    next[1].extension.nested[0]='mutated';next.push(row(s,'late'));if(archive)archive.text='mutated';source.entries.length=0;
    publishPreparedMemoryWrite(h);
    assert.equal(fs.readFileSync(f.canonical,'utf8'),expected);
    assert.equal(fs.readFileSync(f.projection,'utf8'),render(s,JSON.parse(expected))+suffix);
    for(const role of ['canonical','projection','archive'])assert.equal(fs.readFileSync(f[role]).length,cost.measurement.next[role]);
    assert.throws(()=>publishPreparedMemoryWrite(h),isCode('E_MEMORY_PLAN_USED'));
    assert.throws(()=>assess(h),isCode('E_MEMORY_PLAN_USED'));
  });
  test(s+': projection uses the serialized candidate when serialization changes the caller object',()=>{
    const p=fixture(s),f=paths(p,s),candidate=row(s,'serialized');
    Object.defineProperty(candidate,'extension',{enumerable:true,get(){candidate[s==='decisions'?'title':'text']='changed-during-serialization';return true;}});
    const h=prepareMemoryWrite(p,s,[candidate],input(p,s));const cost=assess(h);assert(cost.ok);
    publishPreparedMemoryWrite(h);const saved=JSON.parse(fs.readFileSync(f.canonical));
    assert.equal(saved[0][s==='decisions'?'title':'text'],'serialized');assert(fs.readFileSync(f.projection,'utf8').startsWith(render(s,saved)));
    assert.equal(fs.readFileSync(f.projection).length,cost.measurement.next.projection);
  });
  test(s+': cloned, forged and unrelated handles cannot assess or publish',()=>{
    const p=fixture(s),h=prepareMemoryWrite(p,s,[],input(p,s)),before=snapshot(p);
    for(const fake of [{...h},JSON.parse(JSON.stringify(h)),{},null,17,'handle']){
      assert.throws(()=>publishPreparedMemoryWrite(fake),isCode('E_MEMORY_PLAN_INVALID'));assert.throws(()=>assess(fake),isCode('E_MEMORY_PLAN_INVALID'));
    }assert.deepEqual(snapshot(p),before);
  });
  for(const role of ['canonical','projection','archive'])test(s+': changed '+role+' invalidates original binding and consumes attempted publication',()=>{
    const p=fixture(s),f=paths(p,s),archive={path:f.archive,text:'append'};
    const h=prepareMemoryWrite(p,s,[],input(p,s),archive);fs.appendFileSync(f[role],'EXTERNAL');const before=snapshot(p);
    assert.throws(()=>assess(h),e=>['E_STORE_CHANGED','E_OUTPUT_CHANGED'].includes(e.code));assert.deepEqual(snapshot(p),before);
    assert.throws(()=>publishPreparedMemoryWrite(h),e=>['E_STORE_CHANGED','E_OUTPUT_CHANGED'].includes(e.code));assert.deepEqual(snapshot(p),before);
    assert.throws(()=>publishPreparedMemoryWrite(h),isCode('E_MEMORY_PLAN_USED'));
  });
  test(s+': capture from another store cannot be substituted',()=>{
    const p=fixture(s),q=fixture(s),before=snapshot(p);
    assert.throws(()=>prepareMemoryWrite(p,s,[],input(q,s)),isCode('E_STORE_INVALID'));assert.deepEqual(snapshot(p),before);
  });
  test(s+': restore requires the exact present archive capture',()=>{
    const p=fixture(s),q=fixture(s),f=paths(p,s),source=input(p,s),before=snapshot(p);
    assert.throws(()=>prepareMemoryWrite(p,s,[],source,{path:f.archive,text:'',mode:'replace',input:captureCheckedFileInput(paths(q,s).archive)}),isCode('E_STORE_INVALID'));
    assert.deepEqual(snapshot(p),before);fs.unlinkSync(f.archive);
    assert.throws(()=>prepareMemoryWrite(p,s,[],source,{path:f.archive,text:'',mode:'replace',input:captureCheckedFileInput(f.archive)}),isCode('E_MEMORY_PLAN_INVALID'));
  });
  test(s+': advisory budget result does not silently activate a writer policy',()=>{
    const p=fixture(s),h=prepareMemoryWrite(p,s,[row(s,'next')],input(p,s));
    const r=assess(h,{candidate:{maxItems:0}});assert.equal(r.ok,false);assert.equal(r.disposition,'exceeded');assert.equal(r.measurement,null);
    assert.equal(r.approvalGranted,false);publishPreparedMemoryWrite(h);assert.equal(JSON.parse(fs.readFileSync(paths(p,s).canonical)).length,1);
  });
  test(s+': legacy opaque notes remain writable while cost observer requires migration',()=>{
    const p=fixture(s,[],'',{[s+'.md']:'# personal notes\nPRIVATE'}),f=paths(p,s);fs.unlinkSync(f.canonical);
    const h=prepareMemoryWrite(p,s,[row(s,'new')],input(p,s));const r=assess(h);assert.equal(r.ok,false);assert.equal(r.error.code,'legacy_migration_required');
    publishPreparedMemoryWrite(h);assert(fs.readFileSync(f.projection,'utf8').endsWith('# personal notes\nPRIVATE'));
  });
  test(s+': source change during candidate serialization is rejected before publication',()=>{
    const p=fixture(s),f=paths(p,s),source=input(p,s),candidate=row(s,'next');
    Object.defineProperty(candidate,'extension',{enumerable:true,get(){fs.appendFileSync(f.canonical,' ');return true;}});
    const beforeProjection=fs.readFileSync(f.projection);assert.throws(()=>prepareMemoryWrite(p,s,[candidate],source),isCode('E_STORE_CHANGED'));
    assert(fs.readFileSync(f.projection).equals(beforeProjection));
  });
  if(process.platform==='win32')test(s+': recovery before bytes remain bound when projection changes during canonical publication',()=>{
    const p=fixture(s),f=paths(p,s),before={canonical:fs.readFileSync(f.canonical),projection:fs.readFileSync(f.projection)};
    const h=prepareMemoryWrite(p,s,[row(s,'next')],input(p,s)),spawn=cp.spawnSync;let fired=false,error;
    cp.spawnSync=function(command,args,opts){if(!fired&&opts?.env?.LEERNESS_REPLACE_TO===f.canonical){fired=true;fs.writeFileSync(f.projection,'EXTERNAL');}return spawn.call(cp,command,args,opts);};
    try{publishPreparedMemoryWrite(h);}catch(e){error=e;}finally{cp.spawnSync=spawn;}
    assert(fired);assert(error&&error.memoryRecoveryReceipt);const receiptFile=path.resolve(p,error.memoryRecoveryReceipt),receipt=JSON.parse(fs.readFileSync(receiptFile));
    for(const role of ['canonical','projection']){const item=receipt.before.find(x=>x.role===role);assert(fs.readFileSync(path.join(path.dirname(receiptFile),item.artifact)).equals(before[role]));}
    const live=receipt.live.find(x=>x.role==='projection');assert.equal(fs.readFileSync(path.join(path.dirname(receiptFile),live.artifact),'utf8'),'EXTERNAL');
    assert.equal(receipt.stage,'projection-check');assert.throws(()=>publishPreparedMemoryWrite(h),isCode('E_MEMORY_PLAN_USED'));
  });
}
finish('memory write preparation');
