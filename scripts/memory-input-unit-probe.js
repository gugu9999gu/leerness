#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const {captureMemoryInput,assertMemoryInputCurrent,getLegacyMemoryInput,assertCheckedFileCurrent}=require('../lib/memory-input');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'leerness-memory-input-unit-'));
const results=[];let serial=0;
function test(name,fn){try{fn();results.push({name,ok:true});console.log('PASS '+name);}catch(e){results.push({name,ok:false,error:e.message});console.error('FAIL '+name+': '+e.message);}}
function fixture(){const dir=path.join(temp,String(++serial));fs.mkdirSync(dir);return {dir,json:path.join(dir,'decisions.json'),md:path.join(dir,'decisions.md')};}
const legacy=text=>[{title:text}];
const capture=f=>captureMemoryInput(f.json,f.md,legacy);
const current=(f,input)=>assertMemoryInputCurrent(input,f.json,f.md);
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code);
function fault(name,fn,body){const original=fs[name];fs[name]=fn(original);try{body();}finally{fs[name]=original;}}
test('canonical values and extensions survive; parser not used',()=>{const f=fixture(),values=[{title:'a',extension:{text:'한글\n\ufffd',n:null}}];fs.writeFileSync(f.json,JSON.stringify(values));const input=captureMemoryInput(f.json,f.md,()=>{throw Error('legacy used');});assert.deepEqual(input.entries,values);assert.equal(input.source,'canonical');current(f,input);});
test('empty canonical is authoritative over legacy',()=>{const f=fixture();fs.writeFileSync(f.json,'[]');fs.writeFileSync(f.md,'legacy');const input=capture(f);assert.deepEqual(input.entries,[]);assert.equal(input.source,'canonical');current(f,input);});
test('both positively absent yields empty input',()=>{const f=fixture(),input=capture(f);assert.equal(input.source,'empty');current(f,input);assert.deepEqual(fs.readdirSync(f.dir),[]);});
test('missing parent is not positive leaf absence',()=>{const f=fixture();fs.rmdirSync(f.dir);rejects(()=>capture(f),'E_STORE_UNREADABLE');assert(!fs.existsSync(f.dir));});
test('legacy parser uses one checked text buffer',()=>{const f=fixture();fs.writeFileSync(f.md,'raw legacy');let calls=0;const input=captureMemoryInput(f.json,f.md,t=>{calls++;return legacy(t);});current(f,input);current(f,input);assert.equal(calls,1);assert.equal(input.entries[0].title,'raw legacy');});
test('legacy projection reuses captured bytes after a pathname change',()=>{const f=fixture();fs.writeFileSync(f.md,'\uFEFForiginal');const input=capture(f);fs.writeFileSync(f.md,'external');const snapshot=getLegacyMemoryInput(input,f.md);assert.equal(snapshot.bytes.toString(),'\uFEFForiginal');rejects(()=>assertCheckedFileCurrent(snapshot,f.md),'E_STORE_CHANGED');});
test('legacy projection snapshot bytes cannot mutate the private baseline',()=>{const f=fixture();fs.writeFileSync(f.md,'original');const input=capture(f),snapshot=getLegacyMemoryInput(input,f.md);snapshot.bytes.fill(0);assert.equal(getLegacyMemoryInput(input,f.md).bytes.toString(),'original');assertCheckedFileCurrent(snapshot,f.md);current(f,input);});
test('legacy projection snapshots reject foreign, forged and nonlegacy inputs',()=>{const f=fixture(),other=fixture();fs.writeFileSync(f.md,'original');const input=capture(f);rejects(()=>getLegacyMemoryInput(input,other.md),'E_STORE_INVALID');rejects(()=>getLegacyMemoryInput({source:'legacy'},f.md),'E_STORE_INVALID');rejects(()=>getLegacyMemoryInput(capture(other),other.md),'E_STORE_INVALID');fs.writeFileSync(f.json,'[]');rejects(()=>getLegacyMemoryInput(capture(f),f.md),'E_STORE_INVALID');});
test('legitimate BOM is accepted',()=>{const f=fixture();fs.writeFileSync(f.json,'\uFEFF[{"title":"a"}]');current(f,capture(f));});
test('invalid canonical UTF8 refused',()=>{const f=fixture();fs.writeFileSync(f.json,Buffer.from([0xc3,0x28]));rejects(()=>capture(f),'E_STORE_CORRUPT');});
test('invalid JSON refused even with valid legacy',()=>{const f=fixture();fs.writeFileSync(f.json,'{');fs.writeFileSync(f.md,'legacy');rejects(()=>capture(f),'E_STORE_CORRUPT');});
for(const value of ['null','false','0','""','{}'])test('nonarray root rejected: '+value,()=>{const f=fixture();fs.writeFileSync(f.json,value);rejects(()=>capture(f),'E_STORE_INVALID');});
test('invalid legacy UTF8 refused',()=>{const f=fixture();fs.writeFileSync(f.md,Buffer.from([0x80]));rejects(()=>capture(f),'E_STORE_CORRUPT');});
test('legacy parser cannot silently return nonarray',()=>{const f=fixture();fs.writeFileSync(f.md,'raw');rejects(()=>captureMemoryInput(f.json,f.md,()=>null),'E_STORE_INVALID');});
test('directory is not a canonical array',()=>{const f=fixture();fs.mkdirSync(f.json);rejects(()=>capture(f),'E_STORE_INVALID');});
test('directory is not a legacy file',()=>{const f=fixture();fs.mkdirSync(f.md);rejects(()=>capture(f),'E_STORE_INVALID');});
test('hardlinked input rejected; both links preserved',()=>{const f=fixture(),other=path.join(f.dir,'other');fs.writeFileSync(other,'[]');fs.linkSync(other,f.json);rejects(()=>capture(f),'E_STORE_INVALID');assert.equal(fs.readFileSync(other,'utf8'),'[]');assert.equal(fs.lstatSync(f.json).nlink,2);});
test('local working-array changes do not mutate comparison baseline',()=>{const f=fixture();fs.writeFileSync(f.json,'[]');const input=capture(f);input.entries.push({title:'new'});current(f,input);assert.equal(fs.readFileSync(f.json,'utf8'),'[]');});
test('new canonical invalidates absent snapshot',()=>{const f=fixture(),input=capture(f);fs.writeFileSync(f.json,'[]');rejects(()=>current(f,input),'E_STORE_CHANGED');});
test('new legacy invalidates empty snapshot',()=>{const f=fixture(),input=capture(f);fs.writeFileSync(f.md,'new');rejects(()=>current(f,input),'E_STORE_CHANGED');});
test('deleted canonical invalidates snapshot',()=>{const f=fixture();fs.writeFileSync(f.json,'[]');const input=capture(f);fs.unlinkSync(f.json);rejects(()=>current(f,input),'E_STORE_CHANGED');});
test('modified canonical invalidates snapshot',()=>{const f=fixture();fs.writeFileSync(f.json,'[]');const input=capture(f);fs.writeFileSync(f.json,'[1]');rejects(()=>current(f,input),'E_STORE_CHANGED');});
test('modified legacy invalidates snapshot',()=>{const f=fixture();fs.writeFileSync(f.md,'old');const input=capture(f);fs.writeFileSync(f.md,'new');rejects(()=>current(f,input),'E_STORE_CHANGED');});
test('same-byte replacement has different identity',()=>{const f=fixture();fs.writeFileSync(f.json,'[]');const input=capture(f);fs.renameSync(f.json,f.json+'.old');fs.writeFileSync(f.json,'[]');rejects(()=>current(f,input),'E_STORE_CHANGED');});
test('parent replacement invalidates even absent snapshot',()=>{const f=fixture(),input=capture(f);fs.renameSync(f.dir,f.dir+'.old');fs.mkdirSync(f.dir);rejects(()=>current(f,input),'E_STORE_CHANGED');});
test('forged snapshot rejected',()=>{const f=fixture();rejects(()=>current(f,{entries:[],source:'empty'}),'E_STORE_INVALID');});
test('snapshot is bound to store paths',()=>{const f=fixture(),other=fixture();rejects(()=>current(other,capture(f)),'E_STORE_INVALID');});
test('stat EACCES is unreadable, not missing',()=>{const f=fixture();fault('lstatSync',orig=>function(p,...args){if(p===f.json)throw Object.assign(Error('fixture'),{code:'EACCES'});return orig.call(fs,p,...args);},()=>rejects(()=>capture(f),'E_STORE_UNREADABLE'));});
test('ENOTDIR is unreadable, not missing',()=>{const f=fixture();fault('lstatSync',orig=>function(p,...args){if(p===f.json)throw Object.assign(Error('fixture'),{code:'ENOTDIR'});return orig.call(fs,p,...args);},()=>rejects(()=>capture(f),'E_STORE_UNREADABLE'));});
test('open ENOENT after observed file is change',()=>{const f=fixture();fs.writeFileSync(f.json,'[]');fault('openSync',orig=>function(p,...args){if(p===f.json)throw Object.assign(Error('fixture'),{code:'ENOENT'});return orig.call(fs,p,...args);},()=>rejects(()=>capture(f),'E_STORE_CHANGED'));});
test('descriptor read error closes descriptor and stays unreadable',()=>{const f=fixture();fs.writeFileSync(f.json,'[]');let closed=0;fault('closeSync',orig=>function(fd){closed++;return orig.call(fs,fd);},()=>fault('readFileSync',orig=>function(p,...args){if(typeof p==='number')throw Object.assign(Error('fixture'),{code:'EIO'});return orig.call(fs,p,...args);},()=>rejects(()=>capture(f),'E_STORE_UNREADABLE')));assert.equal(closed,1);});
test('diagnostic 1MiB cap is not imposed on writer input',()=>{const f=fixture(),value='x'.repeat(1024*1024+1);fs.writeFileSync(f.json,JSON.stringify([{title:value}]));const input=capture(f);assert.equal(input.entries[0].title.length,value.length);current(f,input);});
if (process.platform === 'win32') {
  const zeroDevice=(f,body)=>fault('lstatSync',orig=>function(p,...args){const s=orig.call(fs,p,...args);if(p===f.json)s.dev=0n;return s;},body);
  test('Windows unknown path device uses a second descriptor confirmation',()=>{const f=fixture();fs.writeFileSync(f.json,'[]');let opens=0,closes=0;fault('openSync',orig=>function(p,...args){if(p===f.json)opens++;return orig.call(fs,p,...args);},()=>fault('closeSync',orig=>function(fd){closes++;return orig.call(fs,fd);},()=>zeroDevice(f,()=>current(f,capture(f)))));assert.equal(opens,4);assert.equal(closes,4);});
  test('Windows known path device mismatch still fails closed',()=>{const f=fixture();fs.writeFileSync(f.json,'[]');fault('lstatSync',orig=>function(p,...args){const s=orig.call(fs,p,...args);if(p===f.json)s.dev=1n;return s;},()=>rejects(()=>capture(f),'E_STORE_CHANGED'));});
  test('Windows re-opened descriptor cannot change device',()=>{const f=fixture();fs.writeFileSync(f.json,'[]');let n=0;zeroDevice(f,()=>fault('fstatSync',orig=>function(fd,...args){const s=orig.call(fs,fd,...args);if(++n===3)s.dev+=1n;return s;},()=>rejects(()=>capture(f),'E_STORE_CHANGED')));assert.equal(n,3);});
  test('Windows unknown path inode is not silently accepted',()=>{const f=fixture();fs.writeFileSync(f.json,'[]');fault('lstatSync',orig=>function(p,...args){const s=orig.call(fs,p,...args);if(p===f.json){s.dev=0n;s.ino=0n;}return s;},()=>rejects(()=>capture(f),'E_STORE_CHANGED'));});
  test('Windows descriptor confirmation retains metadata checks',()=>{const f=fixture();fs.writeFileSync(f.json,'[]');let n=0;zeroDevice(f,()=>fault('fstatSync',orig=>function(fd,...args){const s=orig.call(fs,fd,...args);if(++n===3)s.mtimeNs+=1n;return s;},()=>rejects(()=>capture(f),'E_STORE_CHANGED')));assert.equal(n,3);});
  test('Windows missing descriptor device identity is rejected',()=>{const f=fixture();fs.writeFileSync(f.json,'[]');fault('fstatSync',orig=>function(fd,...args){const s=orig.call(fs,fd,...args);s.dev=0n;return s;},()=>rejects(()=>capture(f),'E_STORE_INVALID'));});
}
const passed=results.filter(r=>r.ok).length,total=results.length;fs.writeFileSync(path.join(temp,'results.json'),JSON.stringify({node:process.version,platform:process.platform,passed,total,results},null,2));
console.log(`memory input unit: ${passed}/${total} passed; Evidence: ${temp}`);if(passed!==total||total!==(process.platform==='win32'?42:36))process.exitCode=1;
