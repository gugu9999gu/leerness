'use strict';
const S=require('./memory-write-budget-support');
const {assert,fs,path,test,finish,fixture,arena}=S;
const {createRecoverySink}=require('../lib/memory-recovery-sink');
const {createRecoveryTransfer}=require('../lib/memory-recovery-transfer');
const {attachMemoryRecovery}=require('../lib/memory-recovery');
require('../lib/runtime-writes'); // Module loading is outside the recovery-data read meter.
const code=value=>error=>error.code===value;
function sinkFixture(options={}){
  const p=fixture(),dir=path.join(p,'recovery');fs.mkdirSync(dir);
  return {p,dir,sink:createRecoverySink(fs,dir,{maxChunkBytes:8,...options})};
}
for(const maxChunkBytes of [0,-1,1.5,65537,'8'])test('transfer rejects invalid chunk '+maxChunkBytes,()=>assert.throws(()=>createRecoveryTransfer(maxChunkBytes),code('E_RECOVERY_CHUNK_INVALID')));
for(const name of ['../escape','..','.','a/b','a\\b','ads:stream','\0bad'])test('sink rejects unsafe name '+JSON.stringify(name),()=>{
  const {dir,sink}=sinkFixture();let produced=false;assert.throws(()=>sink.write(name,()=>{produced=true;}),code('E_RECOVERY_BUNDLE_INVALID'));assert.equal(produced,false);assert.deepEqual(fs.readdirSync(dir),[]);
});
test('sink writes exact chunks and never exceeds its total allowance',()=>{
  const {dir,sink}=sinkFixture({maxBytes:11});sink.write('before.bin',put=>{put(Buffer.from('12345678'));put(Buffer.from('901'));});
  assert.throws(()=>sink.write('next.bin',put=>put(Buffer.from('x'))),code('E_RECOVERY_BUNDLE_TOO_LARGE'));
  assert.equal(sink.snapshot().bytesWritten,11);assert.equal(fs.readFileSync(path.join(dir,'before.bin'),'utf8'),'12345678901');
  assert(fs.existsSync(path.join(dir,'next.bin')));assert.equal(sink.snapshot().files[1].complete,false);
});
test('sink rejects an oversized chunk before writing its bytes',()=>{
  const {dir,sink}=sinkFixture();assert.throws(()=>sink.write('copy.bin',put=>put(Buffer.alloc(9))),code('E_RECOVERY_CHUNK_INVALID'));
  assert.equal(fs.statSync(path.join(dir,'copy.bin')).size,0);assert.equal(sink.snapshot().bytesWritten,0);
});
test('file limit stops before invoking another producer',()=>{
  const {sink}=sinkFixture({maxFiles:1});sink.write('a',()=>{});let called=false;
  assert.throws(()=>sink.write('b',()=>{called=true;}),code('E_RECOVERY_BUNDLE_INVALID'));assert.equal(called,false);
});
test('retained chunk callbacks and closed sink cannot write later',()=>{
  const {sink,dir}=sinkFixture();let retained;sink.write('a',put=>{retained=put;put(Buffer.from('a'));});
  assert.throws(()=>retained(Buffer.from('b')),code('E_RECOVERY_SINK_CLOSED'));sink.close();assert.throws(()=>sink.write('b',()=>{}),code('E_RECOVERY_SINK_CLOSED'));assert.equal(fs.readFileSync(path.join(dir,'a'),'utf8'),'a');
});
test('short writes are counted and retried without duplicating bytes',()=>{
  const {dir}=sinkFixture(),io={...fs,writeSync:(fd,bytes,offset,length,pos)=>fs.writeSync(fd,bytes,offset,Math.min(2,length),pos)};
  const sink=createRecoverySink(io,dir,{maxChunkBytes:8});sink.write('short',put=>put(Buffer.from('12345678')));
  assert.equal(fs.readFileSync(path.join(dir,'short'),'utf8'),'12345678');assert.equal(sink.snapshot().bytesWritten,8);
});
test('stalled writes retain the created artifact and report failure',()=>{
  const {dir}=sinkFixture(),sink=createRecoverySink({...fs,writeSync:()=>0},dir,{maxChunkBytes:8});
  assert.throws(()=>sink.write('stalled',put=>put(Buffer.from('x'))),code('E_RECOVERY_WRITE_STALLED'));assert(fs.existsSync(path.join(dir,'stalled')));assert.equal(sink.snapshot().files[0].complete,false);
});
test('write and close errors retain the first failure and both diagnostics',()=>{
  const {dir}=sinkFixture(),sink=createRecoverySink({...fs,writeSync:()=>{throw Object.assign(new Error('write'),{code:'EIO'});},closeSync:fd=>{fs.closeSync(fd);throw Object.assign(new Error('close'),{code:'EBADF'});}},dir,{maxChunkBytes:8});
  assert.throws(()=>sink.write('failed',put=>put(Buffer.from('x'))),code('EIO'));assert.equal(sink.snapshot().files[0].closeError,'EBADF');
});
function copyFixture(bytes,chunk=8){
  const f=sinkFixture({maxChunkBytes:chunk});const source=path.join(f.p,'source');fs.writeFileSync(source,bytes);
  const state=createRecoveryTransfer(chunk),transfer=state.start(f.sink,'project','recovery');return {...f,source,state,transfer};
}
function noWholeFileReads(fn){const saved=fs.readFileSync;let count=0;fs.readFileSync=function(){count++;throw new Error('unexpected whole-file recovery read');};try{fn();}finally{fs.readFileSync=saved;}assert.equal(count,0);}
for(const size of [0,1,7,8,9,262144])test('copy byte extent '+size+' preserves bytes and hash with one small buffer',()=>{
  const bytes=Buffer.alloc(size,65),f=copyFixture(bytes);let result;noWholeFileReads(()=>{result=f.transfer.copy(f.source,'copy.bin');});
  assert.equal(result.stable,true);assert.equal(result.size,size);assert.deepEqual(fs.readFileSync(path.join(f.dir,result.artifact)),bytes);
  assert.equal(result.sha256,require('crypto').createHash('sha256').update(bytes).digest('hex'));assert.equal(f.state.snapshot().sourceBytesRead,size);
});
test('read requests never exceed the declared transfer chunk',()=>{
  const f=copyFixture(Buffer.alloc(100),7),read=fs.readSync,requests=[];
  fs.readSync=function(fd,bytes,offset,length,...args){requests.push(length);return read.call(fs,fd,bytes,offset,length,...args);};
  try{f.transfer.copy(f.source,'copy.bin');}finally{fs.readSync=read;}assert(requests.length>1);assert(requests.every(n=>n<=7));
});
test('source growth is finite and marked unstable while original and copied extent remain',()=>{
  const f=copyFixture(Buffer.from('12345678')),read=fs.readSync;let fired=false,result;
  fs.readSync=function(...args){const n=read.apply(fs,args);if(!fired){fired=true;fs.appendFileSync(f.source,'larger-external-change');}return n;};
  try{result=f.transfer.copy(f.source,'copy.bin');}finally{fs.readSync=read;}
  assert.equal(result.stable,false);assert.equal(result.size,8);assert.equal(result.error,'E_RECOVERY_SOURCE_CHANGED');assert(fs.statSync(f.source).size>8);assert.equal(fs.readFileSync(path.join(f.dir,'copy.bin'),'utf8'),'12345678');
});
test('source read failure retains the copied prefix and reports incomplete source evidence',()=>{
  const f=copyFixture(Buffer.from('1234567890'),4),read=fs.readSync;let calls=0,result;
  fs.readSync=function(...args){if(++calls===2)throw Object.assign(new Error('read failed'),{code:'EIO'});return read.apply(fs,args);};
  try{result=f.transfer.copy(f.source,'copy.bin');}finally{fs.readSync=read;}
  assert.equal(result.stable,false);assert.equal(result.error,'EIO');assert.equal(result.size,4);assert.equal(fs.readFileSync(path.join(f.dir,'copy.bin'),'utf8'),'1234');assert.equal(fs.statSync(f.source).size,10);
  assert.equal(f.state.snapshot().attempts[0].allObservedSourcesStable,false);
  assert.equal(f.state.snapshot().attempts[0].sources[0].error,'EIO');
});
test('path replacement during copy retains bytes from the opened original and marks the observation changed',()=>{
  const original=Buffer.from('original byte stream'),f=copyFixture(original,4),read=fs.readSync,moved=f.source+'.moved';let fired=false,result;
  fs.readSync=function(...args){const n=read.apply(fs,args);if(!fired){fired=true;fs.renameSync(f.source,moved);fs.writeFileSync(f.source,'replacement');}return n;};
  try{result=f.transfer.copy(f.source,'copy.bin');}finally{fs.readSync=read;}
  assert.equal(result.stable,false);assert.deepEqual(fs.readFileSync(path.join(f.dir,'copy.bin')),original);assert.deepEqual(fs.readFileSync(moved),original);assert.equal(fs.readFileSync(f.source,'utf8'),'replacement');
});
test('missing and directory sources are described without opening a copy',()=>{
  const f=copyFixture('original');const missing=f.transfer.copy(path.join(f.p,'missing'),'missing.bin'),directory=f.transfer.copy(f.p,'directory.bin');
  assert.equal(missing.kind,'missing');assert.equal(missing.exists,false);assert.equal(directory.kind,'directory');assert.deepEqual(fs.readdirSync(f.dir),[]);
});
function recover(mode='normal',bounded=true){
  const p=fixture(),source=path.join(p,'source'),cause=path.join(p,'cause');fs.writeFileSync(source,Buffer.alloc(65539,70));fs.writeFileSync(cause,Buffer.alloc(32771,67));
  const error=Object.assign(new Error('injected publication failure'),{code:'EIO',backupFile:cause});
  const before=[{role:'canonical',file:source,exists:true,kind:'file',bytes:Buffer.from('before')}];
  const open=fs.openSync;let sourceOpens=0;
  fs.openSync=function(file,...args){if(file===source)sourceOpens++;if(mode==='receipt'&&path.basename(String(file))==='receipt.json')throw Object.assign(new Error('receipt'),{code:'EIO'});return open.call(fs,file,...args);};
  try{attachMemoryRecovery(error,p,{surface:'decisions',operation:'update',stage:'projection-write',completed:['canonical-write']},before,bounded?{maxChunkBytes:1024}:null);}
  finally{fs.openSync=open;}
  return {p,source,cause,error,sourceOpens};
}
test('bounded recovery preserves all before/live/cause bytes without whole-file reads',()=>{
  let f;noWholeFileReads(()=>{f=recover();});const receiptFile=path.resolve(f.p,f.error.memoryRecoveryReceipt),receipt=JSON.parse(fs.readFileSync(receiptFile));
  assert.equal(receipt.live[0].size,65539);assert.equal(receipt.live[0].stable,true);assert.equal(receipt.causeArtifacts[0].size,32771);
  assert.equal(f.error.memoryRecoveryCosts.sourceBytesRead,65539+32771);assert.equal(f.error.memoryRecoveryCosts.artifactBytesWritten,6+65539+32771+fs.statSync(receiptFile).size);
  assert.equal(receipt.recoveryCosts.snapshotBeforeReceipt,true);assert.equal(receipt.recoveryCosts.artifactBytesWritten,6+65539+32771);
});
test('receipt failure does not reread sources for an unauthorized fallback and retains raw artifacts',()=>{
  let f;noWholeFileReads(()=>{f=recover('receipt');});assert(!f.error.memoryRecoveryReceipt);assert.equal(f.error.memoryRecoveryError,'E_RECOVERY_BYPASS_NOT_LATCHED');assert.equal(f.sourceOpens,process.platform==='win32'&&fs.lstatSync(f.source,{bigint:true}).dev===0n?2:1);
  const cost=f.error.memoryRecoveryCosts;assert.equal(cost.sourceBytesRead,65539+32771);assert.equal(cost.attempts.length,1);
  const attempt=cost.attempts[0];assert.equal(attempt.files.find(x=>x.name==='receipt.json').created,false);
  for(const item of attempt.files.filter(x=>x.created))assert.equal(fs.statSync(path.resolve(f.p,attempt.directory,item.name)).size,item.bytesWritten);
});
test('omitted recovery policy retains a positive whole-file read control',()=>{
  const saved=fs.readFileSync;let reads=0;fs.readFileSync=function(...args){reads++;return saved.apply(fs,args);};let f;
  try{f=recover('normal',false);}finally{fs.readFileSync=saved;}
  assert(reads>0);assert(f.error.memoryRecoveryReceipt);assert.equal(f.error.memoryRecoveryCosts,undefined);
});
finish('memory recovery transfer');
