'use strict';
const {assert,fs,path,test,project,snapshot,finish}=require('./memory-migration-test-support');
const {inspectMemoryFootprint}=require('../lib/memory-footprint');
const version=require('../package.json').version;
const limits={maxFileBytes:128,maxTotalFileBytes:384,maxRecoveryEntries:100,maxRecoveryDepth:8,maxRecoveryBytes:1000};
const inspect=(p,over={})=>inspectMemoryFootprint(p,'decisions',JSON.stringify({...limits,...over}));
const fixture=()=>project({'HARNESS_VERSION':version,'decisions.json':'[]','decisions.md':'PRIVATE','decisions.archive.md':'archive'});
const directory=p=>path.join(p,'.leerness/archive/mutation-recovery');
function seed(p){const dir=directory(p);fs.mkdirSync(dir,{recursive:true});const f=path.join(dir,'unmanifested.bin');fs.writeFileSync(f,'PRIVATE');return f;}
function patch(key,make,fn){const original=fs[key];fs[key]=make(original);try{return fn();}finally{fs[key]=original;}}
function fail(r,code){assert.equal(r.ok,false);if(code)assert.equal(r.error.code,code);assert.equal(r.measurement,null);assert(!JSON.stringify(r).includes('PRIVATE'));}
test('oversized file refused before data open',()=>{
  const p=fixture(),target=path.join(p,'.leerness/decisions.json');let opens=0;
  patch('openSync',raw=>function(file,...args){if(file===target)opens++;return raw.call(fs,file,...args);},()=>fail(inspect(p,{maxFileBytes:1}),'input_bytes_exceeded'));assert.equal(opens,0);
});
test('recovery content is never opened or parsed',()=>{
  const p=fixture();seed(p);const before=snapshot(p);patch('openSync',raw=>function(file,...args){if(typeof file==='string'&&file.startsWith(directory(p)))throw new Error('PRIVATE recovery read');return raw.call(fs,file,...args);},()=>assert(inspect(p).ok));assert.deepEqual(snapshot(p),before);
});
test('wide recovery stops at one surplus entry and closes handle',()=>{
  const p=fixture(),f=seed(p);for(let i=0;i<20;i++)fs.writeFileSync(f+i,'x');let reads=0,closes=0;
  patch('opendirSync',raw=>function(file,...args){const h=raw.call(fs,file,...args);if(file!==directory(p))return h;return {readSync(){reads++;return h.readSync();},closeSync(){closes++;return h.closeSync();}};},()=>fail(inspect(p,{maxRecoveryEntries:2}),'recovery_entries_exceeded'));assert.equal(reads,3);assert.equal(closes,1);
});
test('directory read failure is incomplete and handle is closed',()=>{
  const p=fixture();seed(p);let closed=false;
  patch('opendirSync',raw=>function(file,...args){const h=raw.call(fs,file,...args);return {readSync(){throw Object.assign(new Error('PRIVATE'),{code:'EACCES'});},closeSync(){closed=true;h.closeSync();}};},()=>fail(inspect(p),'observation_failed'));assert(closed);
});
for(const change of ['canonical','projection','archive','recovery-file','add-file','remove-file'])test('late '+change+' change invalidates complete measurement',()=>{
  const p=fixture(),f=seed(p);let fired=false;
  patch('opendirSync',raw=>function(file,...args){const h=raw.call(fs,file,...args);return {readSync:()=>h.readSync(),closeSync(){h.closeSync();if(fired)return;fired=true;if(change==='remove-file')fs.unlinkSync(f);else if(change==='add-file')fs.writeFileSync(f+'new','new');else if(change==='recovery-file')fs.writeFileSync(f,'CHANGED');else fs.writeFileSync(path.join(p,'.leerness',change==='canonical'?'decisions.json':change==='projection'?'decisions.md':'decisions.archive.md'),'CHANGED');}};},()=>fail(inspect(p),change.includes('file')?'recovery_changed':'source_changed'));assert(fired);
});
test('new recovery directory after absence observation is detected',()=>{
  const p=fixture();fs.mkdirSync(path.join(p,'.leerness/archive'));let absent=false,fired=false;const target=path.join(p,'.leerness/decisions.json');
  patch('lstatSync',raw=>function(file,...args){try{return raw.call(fs,file,...args);}catch(e){if(file===directory(p)&&e.code==='ENOENT')absent=true;throw e;}},()=>
    patch('openSync',raw=>function(file,...args){if(file===target&&absent&&!fired){seed(p);fired=true;}return raw.call(fs,file,...args);},()=>fail(inspect(p),'recovery_changed')));assert(fired);
});
test('runtime transition during scan discards result',()=>{
  const p=fixture();seed(p);let fired=false;
  patch('opendirSync',raw=>function(file,...args){const h=raw.call(fs,file,...args);return {readSync:()=>h.readSync(),closeSync(){h.closeSync();if(!fired){fired=true;fs.mkdirSync(path.join(p,'.leerness/cache'));fs.writeFileSync(path.join(p,'.leerness/cache/state-layout.json'),'{}');}}};},()=>fail(inspect(p),'runtime_changed'));assert(fired);
});
test('metadata-only recovery sum cannot overflow exact integers',()=>{
  const p=fixture(),target=seed(p);patch('lstatSync',raw=>function(file,...args){const s=raw.call(fs,file,...args);if(file===target)s.size=BigInt(Number.MAX_SAFE_INTEGER);return s;},()=>fail(inspect(p,{maxRecoveryBytes:Number.MAX_SAFE_INTEGER}),'size_unrepresentable'));
});
test('directory close error invalidates result',()=>{
  const p=fixture();seed(p);patch('opendirSync',raw=>function(file,...args){const h=raw.call(fs,file,...args);return {readSync:()=>h.readSync(),closeSync(){h.closeSync();throw new Error('PRIVATE');}};},()=>fail(inspect(p),'observation_failed'));
});
test('directory replaced by junction before open is rejected before enumeration',()=>{
  const p=fixture();seed(p);const outside=fixture(),dir=directory(p);let opened=false;
  patch('opendirSync',raw=>function(file,...args){if(file===dir){fs.renameSync(dir,dir+'-saved');fs.symlinkSync(outside,dir,process.platform==='win32'?'junction':'dir');opened=true;}return raw.call(fs,file,...args);},()=>fail(inspect(p),'recovery_changed'));assert(opened);
});
for(const code of ['__proto__','PRIVATE_ERROR'])test('unexpected failure code remains fixed '+code,()=>{
  const p=fixture();seed(p);patch('opendirSync',()=>()=>{throw Object.assign(new Error('PRIVATE'),{code});},()=>fail(inspect(p),'observation_failed'));
});
test('unreadable file is not represented as absent',()=>{
  const p=fixture(),target=path.join(p,'.leerness/decisions.md');patch('openSync',raw=>function(file,...args){if(file===target)throw Object.assign(new Error('PRIVATE'),{code:'EACCES'});return raw.call(fs,file,...args);},()=>fail(inspect(p),'input_unreadable'));
});
test('input growth beyond limit is rejected with bounded sentinel read',()=>{
  const p=fixture(),target=path.join(p,'.leerness/decisions.json');let selected=null,total=0,fired=false;
  patch('openSync',raw=>function(file,...args){const fd=raw.call(fs,file,...args);if(file===target)selected=fd;return fd;},()=>patch('readSync',raw=>function(fd,...args){if(fd===selected){if(!fired){fired=true;fs.writeFileSync(target,'x'.repeat(100));}const n=raw.call(fs,fd,...args);total+=n;return n;}return raw.call(fs,fd,...args);},()=>fail(inspect(p,{maxFileBytes:10}),'input_bytes_exceeded')));assert(fired);assert.equal(total,11);
});
finish('memory footprint races');
