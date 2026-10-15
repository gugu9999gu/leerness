'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

// Real files with narrow stat/failure seams. No runtime authority is mocked.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const R = require('../lib/runtime-layout');
const arena = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-descriptor-identity-'));
const CLI = path.resolve(__dirname, '../bin/leerness.js');
let total = 0, failed = 0;
const descriptor = overrides => JSON.stringify({ schema: 'leerness.runtime-layout/v1', schemaVersion: 1,
  scope: 'project-local', generation: 1, layout: 'legacy', requiredWriterProtocol: 1, ...overrides });
function fixture(body = descriptor()) {
  const root = fs.mkdtempSync(path.join(arena, 'case-'));
  const file = path.join(root, '.leerness', 'cache', 'state-layout.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(path.join(root, '.leerness', 'HARNESS_VERSION'), '1\n');
  fs.writeFileSync(file, body);
  return { root, file };
}
function test(label, fn) {
  total++;
  try { fn(); console.log('PASS '+label); }
  catch (error) { failed++; console.error('FAIL '+label+'\n'+error.stack); }
}
const clone = (stat, values) => Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, values);
function fingerprint(file) {
  const stat = fs.statSync(file, { bigint: true });
  return [stat.size, stat.mtimeNs, stat.ctimeNs, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')];
}
function observed(f, hooks = {}, zeroPath = true) {
  const saved = Object.fromEntries(['lstatSync','fstatSync','openSync','readSync','closeSync'].map(k => [k,fs[k]]));
  const handles = new Map(), meter = { opens: 0, closed: 0, readBytes: 0, requests: [], pathStats: 0 };
  fs.lstatSync = function(file, ...args) {
    let stat = saved.lstatSync.call(fs,file,...args);
    if (String(file) === path.dirname(f.file) && hooks.parentStat) stat = hooks.parentStat(stat,meter);
    if (String(file) === f.file) {
      meter.pathStats++;
      if (zeroPath) stat = clone(stat,{dev:0n});
      if (hooks.pathStat) stat = hooks.pathStat(stat,meter);
    }
    return stat;
  };
  fs.openSync = function(file, ...args) {
    const target = String(file) === f.file;
    if (target) { meter.opens++; if(hooks.open) hooks.open(meter.opens); }
    const fd = saved.openSync.call(fs,file,...args);
    if (target) handles.set(fd,meter.opens);
    return fd;
  };
  fs.fstatSync = function(fd, ...args) {
    const stat = saved.fstatSync.call(fs,fd,...args);
    return handles.has(fd) && hooks.handleStat ? hooks.handleStat(stat,handles.get(fd)) : stat;
  };
  fs.readSync = function(fd, buffer, offset, length, position) {
    if(handles.has(fd) && hooks.beforeRead) hooks.beforeRead();
    const n = saved.readSync.call(fs,fd,buffer,offset,length,position);
    if(handles.has(fd)) { meter.readBytes+=n; meter.requests.push(length); if(hooks.read) hooks.read(n); }
    return n;
  };
  fs.closeSync = function(fd) {
    const index = handles.get(fd);
    const result = saved.closeSync.call(fs,fd);
    if(index) { handles.delete(fd);meter.closed++;if(hooks.close) hooks.close(index); }
    return result;
  };
  let report;
  try { report = R.inspectRuntimeCompatibility(f.root); }
  finally { Object.assign(fs,saved); }
  assert.strictEqual(handles.size,0,'every successfully opened descriptor must be closed');
  return { report, meter };
}
function allowed(report) {
  assert.strictEqual(report.reasonCode,'legacy_supported','RD_DESCRIPTOR_COMPATIBILITY');
  assert.strictEqual(report.writeDisposition,'allowed');
}
function blocked(report, reason) {
  assert.strictEqual(report.writeDisposition,'blocked');
  if(reason) assert.strictEqual(report.reasonCode,reason);
}
const ioError = () => { throw Object.assign(new Error('private fixture error must not escape'), {code:'EIO'}); };

test('native valid descriptor is accepted without changing source bytes or metadata', () => {
  const f=fixture(), before=fingerprint(f.file);
  allowed(R.inspectRuntimeCompatibility(f.root));
  assert.deepStrictEqual(fingerprint(f.file),before);
});
test('actual CLI accepts a supported descriptor and preserves it', () => {
  const f=fixture(), before=fingerprint(f.file);
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP)$/i.test(k)));
  const result=cp.spawnSync(process.execPath,[CLI,'state','compatibility',f.root,'--json'],
    {cwd:arena,env,encoding:'utf8',timeout:30000,windowsHide:true});
  assert.strictEqual(result.status,0,result.stderr||result.stdout);
  allowed(JSON.parse(result.stdout));
  assert.deepStrictEqual(fingerprint(f.file),before);
});
if(process.platform==='win32') {
  test('zero path device requires a second matching handle, without a second content read', () => {
    const f=fixture(), before=fingerprint(f.file), {report,meter}=observed(f);
    allowed(report);assert.strictEqual(meter.opens,2);assert.strictEqual(meter.closed,2);
    assert.strictEqual(meter.readBytes,Number(before[0]));assert.deepStrictEqual(fingerprint(f.file),before);
  });
  test('nonzero path device keeps the single-handle fast path', () => {
    const f=fixture(), fd=fs.openSync(f.file,'r'),dev=fs.fstatSync(fd,{bigint:true}).dev;fs.closeSync(fd);
    const {report,meter}=observed(f,{pathStat:stat=>clone(stat,{dev})});allowed(report);assert.strictEqual(meter.opens,1);
  });
  for(const field of ['dev','ino','mode','nlink','size','mtimeNs','ctimeNs']) {
    test('confirmation rejects changed handle '+field, () => {
      const f=fixture();const {report}=observed(f,{handleStat:(stat,index)=>index===2?clone(stat,{[field]:stat[field]+1n}):stat});
      blocked(report);
    });
  }
  for(const field of ['dev','ino']) test('unavailable initial handle '+field+' is refused before reading', () => {
    const {report,meter}=observed(fixture(),{handleStat:stat=>clone(stat,{[field]:0n})});
    blocked(report,'layout_changed');assert.strictEqual(meter.readBytes,0);
  });
  test('different nonzero pathname device is refused before reading', () => {
    const {report,meter}=observed(fixture(),{pathStat:stat=>clone(stat,{dev:999999999999n})});
    blocked(report,'layout_changed');assert.strictEqual(meter.readBytes,0);
  });
  for(const stage of ['open','fstat','close']) test('confirmation '+stage+' failure closes both available handles and blocks', () => {
    const hooks=stage==='open'?{open:i=>{if(i===2)ioError();}}:
      stage==='fstat'?{handleStat:(s,i)=>{if(i===2)ioError();return s;}}:{close:i=>{if(i===2)ioError();}};
    const {report,meter}=observed(fixture(),hooks);blocked(report,'layout_unreadable');
    assert.strictEqual(meter.closed,stage==='open'?1:2);assert(!JSON.stringify(report).includes('private fixture'));
  });
  test('replacement immediately before confirmation preserves both files and is refused', () => {
    const f=fixture(), retained=f.file+'.retained',original=fs.readFileSync(f.file);
    const {report}=observed(f,{open:i=>{if(i===2){fs.renameSync(f.file,retained);fs.writeFileSync(f.file,descriptor({generation:2}));}}});
    blocked(report,'layout_changed');assert.deepStrictEqual(fs.readFileSync(retained),original);
    assert.strictEqual(JSON.parse(fs.readFileSync(f.file)).generation,2);
  });
  test('a pathname reported linked after confirmation is refused', () => {
    const {report}=observed(fixture(),{pathStat:(stat,m)=>m.opens===2?clone(stat,{isSymbolicLink:()=>true}):stat});
    blocked(report,'layout_changed');
  });
  test('parent replacement before confirmation is refused and retained original stays intact', () => {
    const f=fixture(),dir=path.dirname(f.file),retained=path.join(f.root,'retained-descriptor'),original=fs.readFileSync(f.file);
    // Windows cannot rename a directory containing an open file. Preserve that
    // file outside the directory first, then perform the actual parent swap.
    const {report}=observed(f,{open:i=>{if(i===2){fs.renameSync(f.file,retained);fs.renameSync(dir,dir+'.retained');fs.mkdirSync(dir);fs.writeFileSync(f.file,descriptor());}}});
    blocked(report);assert.deepStrictEqual(fs.readFileSync(retained),original);
  });
  test('parent identity is rechecked after a matching confirmation handle', () => {
    const {report,meter}=observed(fixture(),{parentStat:(stat,m)=>m.opens===2?clone(stat,{ino:stat.ino+1n}):stat});
    blocked(report,'layout_changed');assert.strictEqual(meter.opens,2);
  });
  test('both close attempts run and retain the original identity error', () => {
    const {report,meter}=observed(fixture(),{handleStat:(stat,i)=>i===2?clone(stat,{dev:stat.dev+1n}):stat,close:ioError});
    blocked(report,'layout_changed');assert.strictEqual(meter.closed,2);
  });
  test('source growth during read is refused within the descriptor byte ceiling', () => {
    const f=fixture();let changed=false;
    const {report,meter}=observed(f,{read:()=>{if(!changed){changed=true;fs.appendFileSync(f.file,Buffer.alloc(32768,32));}}});
    blocked(report);assert(meter.readBytes<=R.MAX_DESCRIPTOR_BYTES+1);assert(fs.statSync(f.file).size>R.MAX_DESCRIPTOR_BYTES);
  });
  test('source read failure preserves the source and closes its handle', () => {
    const f=fixture(),before=fingerprint(f.file),{report,meter}=observed(f,{beforeRead:ioError});
    blocked(report,'layout_unreadable');assert.strictEqual(meter.closed,1);assert.deepStrictEqual(fingerprint(f.file),before);
  });
  test('exact 16 KiB remains accepted and 16 KiB plus one is rejected before opening', () => {
    const good=observed(fixture(descriptor().padEnd(R.MAX_DESCRIPTOR_BYTES,' ')));allowed(good.report);
    const bad=observed(fixture(Buffer.alloc(R.MAX_DESCRIPTOR_BYTES+1,32)));blocked(bad.report,'descriptor_too_large');assert.strictEqual(bad.meter.opens,0);
  });
  for(const [body,reason] of [[descriptor({requiredWriterProtocol:2}),'layout_unsupported'],
    [descriptor().replace(/}$/,',"generation":2}'),'descriptor_duplicate_key'],[Buffer.from([0xff]),'descriptor_invalid_utf8']]) {
    test('zero path device preserves semantic rejection '+reason,()=>blocked(observed(fixture(body)).report,reason));
  }
} else {
  test('zero path device does not activate a Windows exception on another platform',()=>blocked(observed(fixture()).report,'layout_changed'));
}
console.log(`runtime descriptor identity: ${total-failed}/${total} passed; fixtures: ${arena}`);
if(failed) process.exitCode=1;
