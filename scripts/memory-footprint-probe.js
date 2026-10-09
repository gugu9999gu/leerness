'use strict';
const {assert,fs,path,test,project,snapshot,finish}=require('./memory-migration-test-support');
const {inspectMemoryFootprint}=require('../lib/memory-footprint');
const version=require('../package.json').version;
const limits={maxFileBytes:1024,maxTotalFileBytes:3072,maxRecoveryEntries:100,maxRecoveryDepth:8,maxRecoveryBytes:10000};
const inspect=(p,s='decisions',over={})=>inspectMemoryFootprint(p,s,JSON.stringify({...limits,...over}));
const fixture=(files={})=>project({'HARNESS_VERSION':version,...files});
const recovery=p=>path.join(p,'.leerness/archive/mutation-recovery');
const put=(p,name,bytes)=>{const f=path.join(recovery(p),name);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,bytes);return f;};
function metadata(result){const text=JSON.stringify(result);assert(text.length<2048);assert(!text.includes('PRIVATE')&&!text.includes('.leerness')&&!text.includes('project-'));assert.equal(result.writesPerformed,false);assert.equal(result.approvalGranted,false);assert.equal(result.atomicObservation,false);assert.equal(result.contentValidated,false);assert.equal(result.physicalBytes,null);assert.equal(result.reservationGranted,false);}
function failed(result,code){metadata(result);assert.equal(result.ok,false);assert.equal(result.error.code,code);assert.equal(result.measurement,null);assert.equal(result.filesRechecked,false);assert.equal(result.recoveryMetadataRechecked,false);}
for(const surface of ['decisions','lessons']) {
  test(surface+': absent domain below existing workspace is observed zero',()=>{
    const p=fixture(),before=snapshot(p),r=inspect(p,surface);metadata(r);assert(r.ok);assert.deepEqual(snapshot(p),before);assert.equal(r.measurement.totalPathBytes,0);assert.equal(r.measurement.files.canonical.state,'absent');assert.equal(r.measurement.recovery.exists,false);
  });
  test(surface+': all three raw files plus unmanifested shared recovery, no writes',()=>{
    const data={[surface+'.json']:'["PRIVATE🙂"]',[surface+'.md']:'메모\r\n',[surface+'.archive.md']:'PRIVATE archive'};
    const p=fixture(data);put(p,'unmanifested.bin',Buffer.alloc(21));put(p,'nested/receipt.json','not json');put(p,'nested/other-surface.bin',Buffer.alloc(13));
    const before=snapshot(p),r=inspect(p,surface);metadata(r);assert(r.ok);assert.deepEqual(snapshot(p),before);
    const b=Object.values(data).reduce((n,v)=>n+Buffer.byteLength(v),0);assert.equal(r.measurement.fileBytes,b);assert.equal(r.measurement.recovery.bytes,42);assert.equal(r.measurement.totalPathBytes,b+42);assert.equal(r.measurement.recovery.fileCount,3);assert.equal(r.measurement.recovery.directoryCount,2);assert.equal(r.measurement.recovery.entryCount,4);assert.equal(r.measurement.recovery.scope,'shared-workspace');assert.equal(r.measurement.recovery.contentRead,false);
  });
  test(surface+': invalid UTF-8 and invalid JSON are sized without content validation',()=>{
    const p=fixture({[surface+'.json']:Buffer.from([0xff,0,0x80]),[surface+'.md']:'\ufeffPRIVATE'}),r=inspect(p,surface);assert(r.ok);assert.equal(r.measurement.files.canonical.bytes,3);assert.equal(r.contentValidated,false);
  });
  for(const delta of [-1,0,1])test(surface+': file byte boundary '+delta,()=>{
    const p=fixture({[surface+'.json']:'한🙂'}),r=inspect(p,surface,{maxFileBytes:7+delta});if(delta<0)failed(r,'input_bytes_exceeded');else assert(r.ok);
  });
  for(const delta of [-1,0,1])test(surface+': total input boundary '+delta,()=>{
    const p=fixture({[surface+'.json']:'123',[surface+'.md']:'4567',[surface+'.archive.md']:'89'}),r=inspect(p,surface,{maxTotalFileBytes:9+delta});if(delta<0)failed(r,'input_bytes_exceeded');else assert(r.ok);
  });
  for(const delta of [-1,0,1])test(surface+': recovery entries boundary '+delta,()=>{
    const p=fixture();put(p,'nested/one',Buffer.alloc(2));const r=inspect(p,surface,{maxRecoveryEntries:2+delta});if(delta<0)failed(r,'recovery_entries_exceeded');else assert(r.ok);
  });
  for(const delta of [-1,0,1])test(surface+': recovery depth boundary '+delta,()=>{
    const p=fixture();put(p,'nested/one',Buffer.alloc(2));const r=inspect(p,surface,{maxRecoveryDepth:1+delta});if(delta<0)failed(r,'recovery_depth_exceeded');else assert(r.ok);
  });
  for(const delta of [-1,0,1])test(surface+': recovery bytes boundary '+delta,()=>{
    const p=fixture();put(p,'one',Buffer.alloc(5));put(p,'two',Buffer.alloc(2));const r=inspect(p,surface,{maxRecoveryBytes:7+delta});if(delta<0)failed(r,'recovery_bytes_exceeded');else assert(r.ok);
  });
  test(surface+': empty existing files and directory fit all zero limits',()=>{
    const p=fixture({[surface+'.json']:'',[surface+'.md']:'',[surface+'.archive.md']:''});fs.mkdirSync(recovery(p),{recursive:true});const r=inspect(p,surface,Object.fromEntries(Object.keys(limits).map(k=>[k,0])));assert(r.ok);assert.equal(r.measurement.files.canonical.state,'present');assert(r.measurement.recovery.exists);assert.equal(r.measurement.recovery.directoryCount,1);
  });
  test(surface+': input hard link is unsupported',()=>{const p=fixture({[surface+'.json']:'[]'});fs.linkSync(path.join(p,'.leerness',surface+'.json'),path.join(p,'linked'));failed(inspect(p,surface),'input_unsupported');});
  test(surface+': recovery hard link is unsupported',()=>{const p=fixture(),f=put(p,'one','x');fs.linkSync(f,path.join(p,'linked'));failed(inspect(p,surface),'recovery_unsupported');});
  for(const where of ['archive','recovery','nested'])test(surface+': '+where+' directory junction is refused',()=>{
    const p=fixture(),outside=fixture({'PRIVATE':'outside'}),target=where==='archive'?path.join(p,'.leerness/archive'):where==='recovery'?recovery(p):path.join(recovery(p),'nested');fs.mkdirSync(path.dirname(target),{recursive:true});fs.symlinkSync(outside,target,process.platform==='win32'?'junction':'dir');const before=snapshot(outside);failed(inspect(p,surface),'recovery_unsupported');assert.deepEqual(snapshot(outside),before);
  });
}
for(const value of [undefined,null,{},'{}','[]','null','bad',JSON.stringify({...limits,extra:1}),' '.repeat(2049)])test('invalid limits '+String(value).slice(0,40),()=>{failed(inspectMemoryFootprint('nonexistent','decisions',value),'limits_invalid');});
for(const key of Object.keys(limits))test('required limit '+key,()=>{const v={...limits};delete v[key];failed(inspectMemoryFootprint('nonexistent','decisions',JSON.stringify(v)),'limits_invalid');});
for(const value of [-1,1.5,Number.MAX_SAFE_INTEGER+1])test('invalid limit value '+value,()=>failed(inspectMemoryFootprint('nonexistent','decisions',JSON.stringify({...limits,maxRecoveryBytes:value})),'limits_invalid'));
for(const [key,value]of Object.entries({maxFileBytes:4194305,maxTotalFileBytes:12582913,maxRecoveryEntries:10001,maxRecoveryDepth:65}))test('implementation envelope '+key,()=>failed(inspectMemoryFootprint('nonexistent','decisions',JSON.stringify({...limits,[key]:value})),'limits_invalid'));
test('invalid objects are refused without coercion',()=>{let hit=false;const bad={toString(){hit=true;throw new Error('PRIVATE');}};failed(inspectMemoryFootprint(bad,'decisions','{}'),'invalid_arguments');failed(inspectMemoryFootprint('.',bad,'{}'),'invalid_arguments');assert(!hit);});
test('missing or foreign workspace does not become zero',()=>{const p=project({});failed(inspect(p),'workspace_unavailable');});
finish('memory footprint');
