'use strict';
const { assert, fs, path, test, snapshot, finish, fixture, inspect, failed, limits, inspectMemoryWriteBudget } = require('./memory-write-budget-support');
const file = (p,role) => path.join(p,'.leerness','decisions'+({canonical:'.json',projection:'.md',archive:'.archive.md'}[role]));
const recovery = p => path.join(p,'.leerness/archive/mutation-recovery');
function seed(p) { const f=path.join(recovery(p),'unmanifested.bin'); fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'PRIVATE');return f; }
function patch(object,key,make,fn) { const raw=object[key];object[key]=make(raw);try{return fn();}finally{object[key]=raw;} }
// Fire during cost assembly, after checked source capture and before final recheck.
function duringCosts(p,mutate,expected) {
  let calls=0,fired=false;
  patch(Buffer,'byteLength',raw=>function(value,...args){
    if(value==='TRIGGER_PRIVATE'&&++calls===2){mutate();fired=true;}
    return raw.call(Buffer,value,...args);
  },()=>failed(inspect(p,'decisions',[],{kind:'drop',archiveText:'TRIGGER_PRIVATE'}),expected));
  assert(fired,'cost-boundary injection did not execute');
}
for(const role of ['canonical','projection','archive']) {
  test(role+' byte change during cost computation invalidates result',()=>{
    const p=fixture();duringCosts(p,()=>fs.appendFileSync(file(p,role),'x'),'source_changed');
  });
  test(role+' disappearance during cost computation invalidates result',()=>{
    const p=fixture();duringCosts(p,()=>fs.renameSync(file(p,role),file(p,role)+'.saved'),'source_changed');
  });
  test(role+' hard-link input refused without writing',()=>{
    const p=fixture();fs.linkSync(file(p,role),file(p,role)+'.alias');const before=snapshot(p);
    failed(inspect(p),'input_unsupported');assert.deepEqual(snapshot(p),before);
  });
}
test('absent archive creation during costs is not accepted as original',()=>{
  const p=fixture();fs.unlinkSync(file(p,'archive'));duringCosts(p,()=>fs.writeFileSync(file(p,'archive'),'PRIVATE'),'source_changed');
});
test('recovery file growth during costs invalidates result',()=>{
  const p=fixture(),f=seed(p);duringCosts(p,()=>fs.appendFileSync(f,'x'),'recovery_changed');
});
test('recovery directory gains an unmanifested file during costs',()=>{
  const p=fixture();seed(p);duringCosts(p,()=>fs.writeFileSync(path.join(recovery(p),'new.bin'),'PRIVATE'),'recovery_changed');
});
test('absent recovery directory created during costs invalidates result',()=>{
  const p=fixture();duringCosts(p,()=>seed(p),'recovery_changed');
});
test('runtime layout change during costs invalidates result',()=>{
  const p=fixture();duringCosts(p,()=>{const f=path.join(p,'.leerness/cache/state-layout.json');fs.mkdirSync(path.dirname(f));fs.writeFileSync(f,'{}');},'runtime_changed');
});
test('workspace rename during costs invalidates result',()=>{
  const p=fixture();duringCosts(p,()=>fs.renameSync(path.join(p,'.leerness'),path.join(p,'saved-workspace')),'source_changed');
});
test('oversized source is refused before opening data',()=>{
  const p=fixture();let opens=0;
  patch(fs,'openSync',raw=>function(f,...args){if(f===file(p,'canonical'))opens++;return raw.call(fs,f,...args);},()=>failed(inspect(p,'decisions',[],undefined,{observation:{maxFileBytes:1}}),'input_bytes_exceeded'));
  assert.equal(opens,0);
});
test('invalid explicit candidate and malformed config cause no filesystem access',()=>{
  patch(fs,'lstatSync',()=>()=>{throw Error('PRIVATE unexpected IO');},()=>{
    failed(inspect('unused','decisions','[null]'),'item_unsupported','candidate');
    failed(inspectMemoryWriteBudget('unused','decisions','[]','{}','{}'),'limits_invalid','limits');
  });
});
test('canonical read error cannot become empty source',()=>{
  const p=fixture();patch(fs,'openSync',raw=>function(f,...args){if(f===file(p,'canonical'))throw Object.assign(Error('PRIVATE'),{code:'EACCES'});return raw.call(fs,f,...args);},()=>failed(inspect(p),'input_unreadable'));
});
test('recovery contents are never opened by operation preflight',()=>{
  const p=fixture();seed(p);const before=snapshot(p);
  patch(fs,'openSync',raw=>function(f,...args){if(typeof f==='string'&&f.startsWith(recovery(p)))throw Error('PRIVATE content read');return raw.call(fs,f,...args);},()=>assert(inspect(p).ok));
  assert.deepEqual(snapshot(p),before);
});
test('source plus recovery exact-integer overflow fails closed',()=>{
  const p=fixture(),target=seed(p);
  patch(fs,'lstatSync',raw=>function(f,...args){const v=raw.call(fs,f,...args);if(f===target)v.size=BigInt(Number.MAX_SAFE_INTEGER);return v;},()=>failed(inspect(p,'decisions',[],undefined,{observation:{maxRecoveryBytes:Number.MAX_SAFE_INTEGER}}),'size_unrepresentable'));
});
for(const code of ['__proto__','PRIVATE_CODE',null])test('unexpected filesystem exception stays fixed metadata '+code,()=>{
  const p=fixture();seed(p);patch(fs,'opendirSync',()=>()=>{throw code===null?null:Object.assign(Error('PRIVATE'),{code});},()=>failed(inspect(p),'observation_failed'));
});
test('directory close error discards completed partial measurement',()=>{
  const p=fixture();seed(p);patch(fs,'opendirSync',raw=>function(...args){const h=raw.apply(fs,args);return{readSync:()=>h.readSync(),closeSync(){h.closeSync();throw Error('PRIVATE');}};},()=>failed(inspect(p),'observation_failed'));
});
test('public footprint metadata is not accepted as an operation capture token',()=>{
  const p=fixture(), r=require('../lib/memory-footprint').inspectMemoryFootprint(p,'decisions',JSON.stringify(limits.observation));assert(r.ok);
  failed(inspectMemoryWriteBudget(p,'decisions','[]',r,JSON.stringify(limits)),'serialized_json_required');
});
finish('memory write budget races');
