'use strict';
const S = require('./memory-write-budget-support');
const { assert, fs, path, cp, test, finish, fixture, row, options, arena } = S;
const { readPublicationBytes: read } = require('../lib/memory-publication-read');
const { captureMemoryOutput: captureOutput, publishMemoryOutput: publishOutput } = require('../lib/memory-output');
const { captureMemoryWriteAdmission: capture, prepareAdmittedMemoryWrite: prepare, publishAdmittedMemoryWrite: publish } = require('../lib/memory-write-admission');
const policy = () => JSON.stringify({ limits: options(), mode: 'within-target', targets: {
  items: 100, canonicalBytes: 65536, projectionBytes: 65536, archiveBytes: 65536, totalPathBytes: 200000 } });
const code = value => error => error.code === value;
function meter(root, fn) {
  const saved = Object.fromEntries(['openSync','closeSync','readSync','readFileSync'].map(key=>[key,fs[key]]));
  const fds = new Map(), counts = { opens: 0, unbounded: 0, bytes: 0, maxRequest: 0 };
  const matches = file => typeof file === 'string' && path.resolve(file).startsWith(root+path.sep);
  fs.openSync = function(file,...args) { const fd=saved.openSync.call(fs,file,...args);if(matches(file)){ fds.set(fd,file);counts.opens++; }return fd; };
  fs.closeSync = function(fd) { fds.delete(fd);return saved.closeSync.call(fs,fd); };
  fs.readFileSync = function(file,...args) { if(matches(file)||fds.has(file))counts.unbounded++;return saved.readFileSync.call(fs,file,...args); };
  fs.readSync = function(fd,...args) { const n=saved.readSync.call(fs,fd,...args);if(fds.has(fd)){ counts.bytes+=n;counts.maxRequest=Math.max(counts.maxRequest,args[2]); }return n; };
  try { fn(counts); } finally { Object.assign(fs,saved); }
  return counts;
}
function file(bytes) { const p=fixture();const target=path.join(p,'plain');fs.writeFileSync(target,bytes);return {p,target}; }
for(const bound of [-1,NaN,Infinity,0.5,4194305,'10']) test('invalid publication limit '+String(bound)+' rejects before open',()=>{
  const {p,target}=file('data'),counts=meter(p,()=>assert.throws(()=>read(target,bound),code('E_OUTPUT_INVALID')));
  assert.equal(counts.opens,0);assert.equal(counts.unbounded,0);
});
for(const bytes of [Buffer.alloc(0),Buffer.from('한🙂\r\n'),Buffer.alloc(128,65)]) test('exact publication boundary '+bytes.length,()=>{
  const {p,target}=file(bytes),counts=meter(p,()=>assert.deepEqual(read(target,bytes.length),bytes));
  assert.equal(counts.unbounded,0);assert.equal(counts.bytes,bytes.length);
});
test('oversized stat rejects before opening the file',()=>{
  const {p,target}=file(Buffer.alloc(4096)),counts=meter(p,()=>assert.throws(()=>read(target,64),e=>e.code==='E_OUTPUT_LIMIT'&&e.bytesRead===0));
  assert.equal(counts.opens,0);assert.equal(counts.bytes,0);
});
test('growth after fstat reads at most limit plus overflow byte',()=>{
  const {target}=file('small'),original=fs.readSync;let fired=false,error;
  fs.readSync=function(...args){ if(!fired){fired=true;fs.writeFileSync(target,Buffer.alloc(1024));}return original.apply(fs,args); };
  try { assert.throws(()=>read(target,32),e=>{error=e;return e.code==='E_OUTPUT_LIMIT';}); }
  finally { fs.readSync=original; }
  assert.equal(error.bytesRead,33);assert.equal(fs.statSync(target).size,1024);
});
test('hard-link comparison accepts the exact bytes without changing either name',()=>{
  const {p,target}=file('alias bytes'),alias=path.join(p,'alias');fs.linkSync(target,alias);
  assert.equal(read(alias,32).toString(),'alias bytes');assert.equal(fs.statSync(target).nlink,2);
});
test('directory input is rejected before opening',()=>{
  const p=fixture(),counts=meter(p,()=>assert.throws(()=>read(path.join(p,'.leerness'),32),code('E_OUTPUT_CHANGED')));
  assert.equal(counts.opens,0);
});
test('omitted backend policy remains a positive unbounded-read control',()=>{
  const {p,target}=file('default'),counts=meter(p,()=>assert.equal(read(target).toString(),'default'));
  assert.equal(counts.unbounded,1);
});
for(const kind of ['create','replace','unchanged']) test('real backend '+kind+' uses bounded comparisons throughout',()=>{
  const {p,target}=file('old');if(kind==='create')fs.unlinkSync(target);
  const token=captureOutput(target,{maxBytes:64});let result;
  const counts=meter(p,()=>{result=publishOutput(token,target,kind==='unchanged'?'old':'next');});
  assert.equal(counts.unbounded,0);assert.equal(result.published,kind!=='unchanged');assert.equal(fs.readFileSync(target,'utf8'),kind==='unchanged'?'old':'next');
});
test('oversized prepared output rejects before creating a file',()=>{
  const p=fixture(),target=path.join(p,'absent'),token=captureOutput(target,{maxBytes:4});
  assert.throws(()=>publishOutput(token,target,'12345'),code('E_OUTPUT_LIMIT'));assert(!fs.existsSync(target));
});
test('growth before the final no-op comparison is bounded',()=>{
  const {p,target}=file('old'),token=captureOutput(target,{maxBytes:64});fs.writeFileSync(target,Buffer.alloc(1024));
  const counts=meter(p,()=>assert.throws(()=>publishOutput(token,target,'old'),code('E_OUTPUT_LIMIT')));
  assert.equal(counts.opens,0);assert.equal(counts.unbounded,0);assert.equal(fs.statSync(target).size,1024);
});
test('growth immediately after hard-link install rejects without an unbounded validation read',()=>{
  const p=fixture(),target=path.join(p,'absent'),token=captureOutput(target,{maxBytes:64}),original=fs.linkSync;
  fs.linkSync=function(from,to){const r=original.apply(fs,arguments);if(path.resolve(to)===target)fs.writeFileSync(target,Buffer.alloc(4096,67));return r;};
  let error,counts;
  try { counts=meter(p,()=>assert.throws(()=>publishOutput(token,target,'next'),e=>{error=e;return e.code==='E_OUTPUT_LIMIT';})); }
  finally {fs.linkSync=original;}
  assert.equal(counts.unbounded,0);assert(error.outputMutationStarted);assert.equal(fs.statSync(target).size,4096);
});
test('absent target introduced while the prepared source is written is bounded',()=>{
  const p=fixture(),target=path.join(p,'absent'),token=captureOutput(target,{maxBytes:64}),original=fs.writeFileSync;
  let fired=false;fs.writeFileSync=function(file,...args){const out=original.call(fs,file,...args);if(!fired&&(typeof file==='number'||String(file).includes('.publish-'))){fired=true;original(target,Buffer.alloc(4096));}return out;};
  try {const counts=meter(p,()=>assert.throws(()=>publishOutput(token,target,'next'),code('E_OUTPUT_LIMIT')));assert.equal(counts.unbounded,0);}
  finally {fs.writeFileSync=original;}
  assert(fired);
});
if(process.platform==='win32') test('ReplaceFileW final-window growth retains the large displaced original with bounded validation',()=>{
  const {p,target}=file('old'),token=captureOutput(target,{maxBytes:64}),original=cp.spawnSync,competitor=Buffer.alloc(262144,69);
  let fired=false,error;
  cp.spawnSync=function(command,args,opts){if(opts?.env?.LEERNESS_REPLACE_TO===target){fired=true;fs.writeFileSync(target,competitor);}return original.apply(cp,arguments);};
  let counts;try {counts=meter(p,()=>assert.throws(()=>publishOutput(token,target,'next'),e=>{error=e;return e.code==='E_OUTPUT_LIMIT';}));}
  finally {cp.spawnSync=original;}
  assert(fired);assert.equal(counts.unbounded,0);assert(error.outputMutationStarted);assert(error.backupFile);
  assert.deepEqual(fs.readFileSync(error.backupFile),competitor);assert.equal(fs.readFileSync(target,'utf8'),'next');
  assert(error.recoveryArtifacts.some(a=>a.readError==='E_OUTPUT_LIMIT'));
});
else console.log('SKIP real ReplaceFileW tests: non-Windows host');
if(process.platform==='win32') test('a limit failure after the backend returns success still reports mutation started',()=>{
  const {p,target}=file('old'),token=captureOutput(target,{maxBytes:64}),io=require('../lib/io'),original=io.writeBufferIfUnchanged;
  io.writeBufferIfUnchanged=function(...args){const result=original(...args);fs.writeFileSync(target,Buffer.alloc(4096));return result;};
  let error,counts;
  try {counts=meter(p,()=>assert.throws(()=>publishOutput(token,target,'next'),e=>{error=e;return e.code==='E_OUTPUT_LIMIT';}));}
  finally{io.writeBufferIfUnchanged=original;}
  assert.equal(counts.unbounded,0);assert(error.outputMutationStarted);assert(error.outputPublished);assert.equal(fs.statSync(target).size,4096);
});
test('failed hard-link detach uses bounded rollback comparisons and preserves the changed inode',()=>{
  const {p,target}=file('before'),alias=path.join(p,'alias'),io=require('../lib/io');fs.linkSync(target,alias);
  fs.writeFileSync(target,Buffer.alloc(4096));
  const saved={unlinkSync:fs.unlinkSync,rmSync:fs.rmSync,renameSync:fs.renameSync};
  const denied=()=>{throw Object.assign(new Error('injected detach denial'),{code:'EACCES'});};
  fs.unlinkSync=function(file){if(file===alias)return denied();return saved.unlinkSync.apply(fs,arguments);};
  fs.rmSync=function(file){if(file===alias)return denied();return saved.rmSync.apply(fs,arguments);};
  fs.renameSync=function(from,to){if(to===alias)return denied();return saved.renameSync.apply(fs,arguments);};
  let counts,error;
  try {counts=meter(p,()=>assert.throws(()=>io.detachCommittedHardLink(alias,target,Buffer.from('before'),{maxReadBytes:64}),e=>{error=e;return e.code==='E_HARDLINK_DETACH_FAILED';}));}
  finally{Object.assign(fs,saved);}
  assert.equal(counts.unbounded,0);assert.equal(error.canonicalRolledBack,false);
  assert.equal(fs.statSync(target).size,4096);assert.equal(fs.statSync(alias).size,4096);
});
function ready(s,kind='update') {
  const rows=[row(s,'base')],p=fixture(s,rows),next=kind==='drop'?[]:[...rows,row(s,'fresh')];
  const handle=prepare(capture(p,s,policy()),JSON.stringify(next),JSON.stringify({kind,archiveText:kind==='update'?null:'retained archive\n'}));
  return {p,handle,next,canonical:path.join(p,'.leerness',s+'.json'),projection:path.join(p,'.leerness',s+'.md')};
}
function cleanMetadata(result) {
  assert.equal(result.validationReadMaxBytes,32768);assert.equal(result.recoveryReadsBounded,false);
  assert.equal(result.failureRetentionBounded,false);assert.equal(result.physicalReservation,false);
  assert(!JSON.stringify(result).includes(arena));assert(!JSON.stringify(result).includes('PRIVATE'));
}
for(const s of ['decisions','lessons']) {
  test(s+' pre-publication denial reports failed scratch cleanup without claiming a partial write',()=>{
    const p=S.project({HARNESS_VERSION:require('../package.json').version}),canonical=path.join(p,'.leerness',s+'.json');
    const handle=prepare(capture(p,s,policy()),JSON.stringify([row(s,'fresh')]),JSON.stringify({kind:'update',archiveText:null}));
    const originalWrite=fs.writeFileSync,originalUnlink=fs.unlinkSync;let fired=false,error;
    fs.writeFileSync=function(file,...args){const out=originalWrite.call(fs,file,...args);if(!fired&&(typeof file==='number'||String(file).includes('.publish-'))){fired=true;originalWrite(canonical,Buffer.alloc(65536));}return out;};
    fs.unlinkSync=function(file){if(String(file).includes('.publish-'))throw Object.assign(new Error('injected scratch cleanup denial'),{code:'EACCES'});return originalUnlink.apply(fs,arguments);};
    try {assert.throws(()=>publish(handle),e=>{error=e;return e.code==='E_OUTPUT_LIMIT';});}
    finally {fs.writeFileSync=originalWrite;fs.unlinkSync=originalUnlink;}
    assert(fired);assert(!error.memoryRecoveryReceipt);assert.equal(error.outputMutationStarted,false);
    assert(error.memoryPublication.cleanupPending);assert(error.memoryPublication.retainedPaths.length>0);
    assert.equal(fs.statSync(canonical).size,65536);
  });
  for(const kind of ['update','drop','restore']) test(s+' '+kind+' admitted publication returns honest cleanup metadata',()=>{
    const {p,handle,next,canonical}=ready(s,kind);let result;
    const counts=meter(p,()=>{result=publish(handle);});cleanMetadata(result);
    assert.equal(counts.unbounded,0);assert(counts.bytes>0);assert.equal(result.cleanupPending,false);assert.deepEqual(result.retainedPaths,[]);
    assert.equal(result.normalCleanupConfirmed,true);assert.deepEqual(JSON.parse(fs.readFileSync(canonical)),next);
  });
  test(s+' successful publication reports exact retained backup bytes when cleanup fails',()=>{
    const {p,handle,canonical}=ready(s),original=fs.unlinkSync,before=fs.readFileSync(canonical);
    fs.unlinkSync=function(file){if(path.basename(String(file))==='before')throw Object.assign(new Error('injected cleanup denial'),{code:'EACCES'});return original.apply(fs,arguments);};
    let result;try {result=publish(handle);}finally{fs.unlinkSync=original;}
    cleanMetadata(result);assert(result.cleanupPending);assert.equal(result.normalCleanupConfirmed,false);
    assert.equal(result.retainedInventoryComplete,false,'scratch directories are not recursively inventoried');
    assert(result.knownRetainedFileBytes>=before.length);
    const backup=result.retainedPaths.find(a=>a.kind==='file'&&a.bytes===before.length);
    assert(backup);assert.deepEqual(fs.readFileSync(path.resolve(p,backup.path)),before);
  });
  for(const receiptFail of [false,true]) test(s+' partial failure preserves earlier cleanup artifacts '+(receiptFail?'even without a receipt':'in the receipt'),()=>{
    const {p,handle,canonical}=ready(s),originalUnlink=fs.unlinkSync,originalWrite=fs.writeFileSync,originalOpen=fs.openSync,before=fs.readFileSync(canonical);
    fs.unlinkSync=function(file){if(path.basename(String(file))==='before')throw Object.assign(new Error('injected cleanup denial'),{code:'EACCES'});return originalUnlink.apply(fs,arguments);};
    let fired=false;
    fs.openSync=function(file,...args){
      if(receiptFail&&typeof file==='string'&&path.basename(file)==='receipt.json')throw Object.assign(new Error('injected receipt failure'),{code:'EIO'});
      if(!fired&&typeof file==='string'&&path.basename(file)==='next'&&fs.readFileSync(canonical,'utf8').includes('fresh')){
        fired=true;throw Object.assign(new Error('injected later publication failure'),{code:'EIO'});
      }
      return originalOpen.call(fs,file,...args);
    };
    fs.writeFileSync=function(file,...args){
      if(receiptFail&&typeof file==='string'&&path.basename(file)==='receipt.json')throw Object.assign(new Error('injected receipt failure'),{code:'EIO'});
      return originalWrite.call(fs,file,...args);
    };
    let error;try {assert.throws(()=>publish(handle),e=>{error=e;return e.code==='E_MEMORY_PARTIAL_WRITE';});}
    finally {fs.unlinkSync=originalUnlink;fs.writeFileSync=originalWrite;fs.openSync=originalOpen;}
    assert(fired);cleanMetadata(error.memoryPublication);assert(error.memoryPublication.cleanupPending);
    const retained=error.memoryPublication.retainedPaths.find(a=>a.kind==='file'&&a.bytes===before.length);assert(retained);
    assert.deepEqual(fs.readFileSync(path.resolve(p,retained.path)),before);
    if(receiptFail){assert(!error.memoryRecoveryReceipt);assert.equal(error.memoryRecoveryPrimaryError,'EIO');}
    else {
      const receiptFile=path.resolve(p,error.memoryRecoveryReceipt),receipt=JSON.parse(fs.readFileSync(receiptFile));
      assert.deepEqual(receipt.memoryPublication,error.memoryPublication);
      assert(receipt.causeArtifacts.some(a=>fs.readFileSync(path.join(path.dirname(receiptFile),a.artifact)).equals(before)));
    }
  });
}
finish('memory publication policy');
