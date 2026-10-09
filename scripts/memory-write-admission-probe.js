'use strict';
const S = require('./memory-write-budget-support');
const { assert, fs, path, test, finish, fixture, row, render, options, snapshot } = S;
const preparation = require('../lib/memory-write-preparation');
const originalPrepare = preparation.prepareMemoryWrite;
let prepareCalls = 0;
preparation.prepareMemoryWrite = function(...args) { prepareCalls++; return originalPrepare(...args); };
const { captureMemoryWriteAdmission: capture, prepareAdmittedMemoryWrite: prepare, publishAdmittedMemoryWrite: publish } = require('../lib/memory-write-admission');
const { captureMemoryInput, assertMemoryInputCurrent } = require('../lib/memory-input');
const { captureMemoryOutput, assertMemoryOutputCurrent } = require('../lib/memory-output');
const policy = (targets = {}, mode = 'within-target', limits = {}) => JSON.stringify({ limits: options(limits),
  targets: { items: 100, canonicalBytes: 65536, projectionBytes: 65536, archiveBytes: 65536, totalPathBytes: 200000, ...targets }, mode });
const operation = (kind = 'update', archiveText = null) => JSON.stringify({ kind, archiveText });
const files = (p,s) => Object.fromEntries([['canonical','.json'],['projection','.md'],['archive','.archive.md']].map(([r,x])=>[r,path.join(p,'.leerness',s+x)]));
const code = value => e => e.code === value;
function meter(paths, run) {
  const saved = Object.fromEntries(['openSync','closeSync','readSync','readFileSync'].map(k=>[k,fs[k]]));
  const descriptors = new Map(), counts = { opens: 0, unboundedReads: 0, bytesRead: 0 };
  const tracked = file => typeof file === 'string' && paths.includes(path.resolve(file));
  fs.openSync = function(file,...args) { const fd = saved.openSync.call(fs,file,...args); if (tracked(file)) { descriptors.set(fd,path.resolve(file)); counts.opens++; } return fd; };
  fs.closeSync = function(fd) { descriptors.delete(fd); return saved.closeSync.call(fs,fd); };
  fs.readFileSync = function(file,...args) { if (descriptors.has(file) || tracked(file)) counts.unboundedReads++; return saved.readFileSync.call(fs,file,...args); };
  fs.readSync = function(fd,...args) { const n = saved.readSync.call(fs,fd,...args); if (descriptors.has(fd)) counts.bytesRead += n; return n; };
  try { run(counts); } finally { Object.assign(fs,saved); }
  return counts;
}
function denied(p, h, candidate, op, expected) {
  const before = snapshot(p), calls = prepareCalls;
  assert.throws(()=>prepare(h,candidate,op),code(expected));
  assert.equal(prepareCalls,calls,'full output preparation must not start');
  assert.deepEqual(snapshot(p),before);
  assert.throws(()=>prepare(h,candidate,op),code('E_MEMORY_ADMISSION_USED'));
}
for (const s of ['decisions','lessons']) {
  for (const kind of ['update','drop','restore']) test(s+': explicit '+kind+' uses bounded preparation and the real publisher',()=>{
    const rows=[row(s,'old'),row(s,'kept')], p=fixture(s,rows), f=files(p,s);
    const selected = kind==='drop' ? rows.slice(1) : [...rows,row(s,'new')];
    const candidate=JSON.stringify(selected), archive=kind==='update'?null:'selected archive🙂\r\n';
    const domainBefore=snapshot(p);let h,ready;
    const counts=meter(Object.values(f),()=>{
      h=capture(p,s,policy());
      h.entries.length=0;h.archiveBytes.fill(0);
      ready=prepare(h,candidate,operation(kind,archive));
    });
    assert.equal(counts.unboundedReads,0);assert(counts.bytesRead>0);assert.deepEqual(snapshot(p),domainBefore);
    assert.equal(ready.disposition,'within-target');assert.equal(ready.approvalGranted,false);assert.equal(ready.reservationGranted,false);
    assert(!JSON.stringify(ready).includes('PRIVATE'));assert(Object.isFrozen(ready));
    publish(ready);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.canonical)),selected);
    assert.equal(fs.readFileSync(f.projection,'utf8'),render(s,selected)+'\nPRIVATE 한🙂\r\n');
    for (const role of ['canonical','projection','archive']) assert.equal(fs.statSync(f[role]).size,ready.measurement.next[role]);
    assert.throws(()=>publish(ready),code('E_MEMORY_ADMISSION_USED'));
  });
  for (const delta of [-1,0,1]) test(s+': initial source byte limit '+delta,()=>{
    const p=fixture(s),f=files(p,s),length=fs.statSync(f.canonical).size;
    const counts=meter([f.canonical],()=>{
      const run=()=>capture(p,s,policy({},'within-target',{source:{maxInputBytes:length+delta}}));
      if (delta<0) assert.throws(run,e=>e.code==='E_STORE_LIMIT'&&e.bytesRead===0);else assert(run());
    });
    assert.equal(counts.unboundedReads,0);if(delta<0)assert.equal(counts.opens,0);
  });
  test(s+': source nesting rejected before its first JSON.parse',()=>{
    const rows=[{...row(s),extension:{nested:[1]}}],p=fixture(s,rows),f=files(p,s),raw=fs.readFileSync(f.canonical,'utf8');
    const parse=JSON.parse;let calls=0;JSON.parse=function(text,...args){if(text===raw)calls++;return parse.call(JSON,text,...args);};
    try { assert.throws(()=>capture(p,s,policy({},'within-target',{source:{maxDepth:3}})),e=>e.code==='E_STORE_LIMIT'&&e.limitKind==='depth'); }
    finally {JSON.parse=parse;}
    assert.equal(calls,0);assert(capture(p,s,policy({},'within-target',{source:{maxDepth:4}})));
  });
  for (const [name,over,expected] of [
    ['input',{maxInputBytes:1},'input_bytes_exceeded'],['depth',{maxDepth:1},'depth_exceeded'],
    ['items',{maxItems:0},'items_exceeded'],['item bytes',{maxItemBytes:1},'item_bytes_exceeded'],
    ['canonical bytes',{maxCanonicalBytes:1},'canonical_bytes_exceeded'],['projection bytes',{maxProjectionBytes:1},'projection_bytes_exceeded'],
    ['nodes',{maxNodes:1},'nodes_exceeded'],
  ]) test(s+': candidate '+name+' denied before output construction',()=>{
    const p=fixture(s),h=capture(p,s,policy({},'within-target',{candidate:over}));
    denied(p,h,JSON.stringify([row(s,'candidate')]),operation(),expected);
  });
  test(s+': processing limits cannot be bypassed by reduction mode',()=>{
    const rows=[row(s,'one'),row(s,'two'),row(s,'three')],p=fixture(s,rows);
    denied(p,capture(p,s,policy({items:0},'reduce-existing',{candidate:{maxItems:1}})),JSON.stringify(rows.slice(1)),operation(),'items_exceeded');
  });
  test(s+': oversized source can shrink below its declared target',()=>{
    const rows=[row(s,'one'),row(s,'two'),row(s,'three')],p=fixture(s,rows);
    const ready=prepare(capture(p,s,policy({items:1})),JSON.stringify(rows.slice(0,1)),operation());
    assert.equal(ready.disposition,'within-target');publish(ready);
    assert.equal(JSON.parse(fs.readFileSync(files(p,s).canonical)).length,1);
  });
  test(s+': explicit stepwise reduction permits a still-oversized result',()=>{
    const rows=[row(s,'one'),row(s,'two'),row(s,'three')],p=fixture(s,rows);
    const ready=prepare(capture(p,s,policy({items:1},'reduce-existing')),JSON.stringify(rows.slice(1)),operation());
    assert.equal(ready.disposition,'reduces-existing-excess');publish(ready);
    assert.equal(JSON.parse(fs.readFileSync(files(p,s).canonical)).length,2);
  });
  for (const [label,mode,next,expected] of [
    ['normal mode','within-target',2,'target_exceeded'],['stagnant','reduce-existing',3,'target_not_reduced'],
    ['increased','reduce-existing',4,'target_increased'],
  ]) test(s+': '+label+' excess is denied',()=>{
    const rows=[row(s,'one'),row(s,'two'),row(s,'three')],p=fixture(s,rows),candidate=[...rows,row(s,'four')].slice(0,next);
    denied(p,capture(p,s,policy({items:1},mode)),JSON.stringify(candidate),operation(),expected);
  });
  test(s+': reducing items cannot introduce archive excess',()=>{
    const rows=[row(s,'one'),row(s,'two'),row(s,'three')],p=fixture(s,rows),size=fs.statSync(files(p,s).archive).size;
    denied(p,capture(p,s,policy({items:1,archiveBytes:size},'reduce-existing')),JSON.stringify(rows.slice(1)),operation('drop','more'),'target_increased');
  });
  test(s+': retained recovery participates in total path target',()=>{
    const p=fixture(s),dir=path.join(p,'.leerness','archive','mutation-recovery');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'orphan.raw'),'R'.repeat(100));
    const ready=prepare(capture(p,s,policy()),'[]',operation());
    const domainTotal=Object.values(ready.measurement.next).reduce((a,b)=>a+b,0);
    assert.equal(ready.measurement.after.totalPathBytes,domainTotal+100);
    denied(p,capture(p,s,policy({totalPathBytes:domainTotal})),'[]',operation(),'target_exceeded');
    assert(prepare(capture(p,s,policy({totalPathBytes:domainTotal+100})),'[]',operation()));
  });
  test(s+': recovery growth after capture invalidates the original observation',()=>{
    const p=fixture(s),dir=path.join(p,'.leerness','archive','mutation-recovery');fs.mkdirSync(dir,{recursive:true});
    const h=capture(p,s,policy());fs.writeFileSync(path.join(dir,'orphan.raw'),'external');
    denied(p,h,'[]',operation(),'recovery_changed');
  });
  test(s+': file growth during bounded read stops at limit plus one before parsing',()=>{
    const p=fixture(s),f=files(p,s),raw=fs.readFileSync(f.canonical,'utf8'),limit=Buffer.byteLength(raw);
    const read=fs.readSync,parse=JSON.parse;let fired=false,parses=0;
    fs.readSync=function(fd,buffer,...args){const n=read.call(fs,fd,buffer,...args);if(!fired&&buffer.length===limit+1){fired=true;fs.appendFileSync(f.canonical,'X'.repeat(100));}return n;};
    JSON.parse=function(text,...args){if(text===raw)parses++;return parse.call(JSON,text,...args);};
    try {assert.throws(()=>capture(p,s,policy({},'within-target',{source:{maxInputBytes:limit}})),e=>e.code==='E_STORE_LIMIT'&&e.bytesRead===limit+1);}
    finally {fs.readSync=read;JSON.parse=parse;}
    assert(fired);assert.equal(parses,0);assert.equal(fs.statSync(f.canonical).size,limit+100);
  });
  test(s+': serialized candidate depth guard precedes candidate parsing',()=>{
    const p=fixture(s),candidate=JSON.stringify([{...row(s),extension:{nested:[1]}}]);
    const h=capture(p,s,policy({},'within-target',{candidate:{maxDepth:3}})),parse=JSON.parse;let calls=0;
    JSON.parse=function(text,...args){if(text===candidate)calls++;return parse.call(JSON,text,...args);};
    try {denied(p,h,candidate,operation(),'depth_exceeded');}finally{JSON.parse=parse;}
    assert.equal(calls,0);
  });
  test(s+': final projection suffix and archive allocation are checked before construction',()=>{
    const p=fixture(s);denied(p,capture(p,s,policy({},'within-target',{operation:{maxProjectionBytes:1}})),JSON.stringify([]),operation(),'projection_bytes_exceeded');
    denied(p,capture(p,s,policy({},'within-target',{operation:{maxArchiveBytes:1}})),JSON.stringify([]),operation('drop','append'),'archive_bytes_exceeded');
  });
  test(s+': source growth after capture is bounded and leaves the external bytes',()=>{
    const p=fixture(s),f=files(p,s),h=capture(p,s,policy());fs.writeFileSync(f.canonical,'X'.repeat(40000));
    denied(p,h,JSON.stringify([]),operation(),'E_STORE_LIMIT');
  });
  test(s+': source change after preparation consumes the publication attempt',()=>{
    const p=fixture(s),f=files(p,s),ready=prepare(capture(p,s,policy()),JSON.stringify([]),operation());
    fs.appendFileSync(f.archive,'external');const before=snapshot(p);
    assert.throws(()=>publish(ready),code('E_STORE_CHANGED'));assert.deepEqual(snapshot(p),before);
    assert.throws(()=>publish(ready),code('E_MEMORY_ADMISSION_USED'));
  });
  test(s+': copied handles and modified metadata cannot authorize another output',()=>{
    const p=fixture(s),h=capture(p,s,policy()),before=snapshot(p);
    assert.throws(()=>prepare({...h},'[]',operation()),code('E_MEMORY_ADMISSION_INVALID'));
    const ready=prepare(h,'[]',operation());assert.throws(()=>publish({...ready}),code('E_MEMORY_ADMISSION_INVALID'));
    ready.measurement.next.canonical=999999;publish(ready);assert.equal(fs.readFileSync(files(p,s).canonical,'utf8'),'[]\n');
    assert.notDeepEqual(snapshot(p),before);
  });
  test(s+': legacy requires migration while genuine empty initialization is admitted',()=>{
    const p=fixture(s),f=files(p,s);fs.unlinkSync(f.canonical);const before=snapshot(p);
    assert.throws(()=>capture(p,s,policy()),code('legacy_migration_required'));assert.deepEqual(snapshot(p),before);
    fs.unlinkSync(f.projection);const ready=prepare(capture(p,s,policy()),JSON.stringify([row(s,'first')]),operation());publish(ready);
    assert.equal(JSON.parse(fs.readFileSync(f.canonical)).length,1);
  });
  test(s+': explicit checked input and output rechecks keep their byte ceilings',()=>{
    const p=fixture(s),f=files(p,s),input=captureMemoryInput(f.canonical,f.projection,()=>[],{maxBytes:1000,maxDepth:8}),output=captureMemoryOutput(f.canonical,{maxBytes:1000});
    fs.writeFileSync(f.canonical,'X'.repeat(1001));const counts=meter([f.canonical],()=>{
      assert.throws(()=>assertMemoryInputCurrent(input,f.canonical,f.projection),code('E_STORE_LIMIT'));
      assert.throws(()=>assertMemoryOutputCurrent(output,f.canonical),code('E_OUTPUT_LIMIT'));
    });assert.equal(counts.opens,0);assert.equal(counts.bytesRead,0);
  });
}
test('invalid policy is rejected before touching the filesystem',()=>{
  for (const value of [null,'{}','x'.repeat(8193),policy({},'force'),JSON.stringify({...JSON.parse(policy()),extra:true}),policy({items:-1})]) {
    assert.throws(()=>capture('absent-project','decisions',value),code('policy_invalid'));
  }
});
preparation.prepareMemoryWrite=originalPrepare;
finish('memory write admission');
