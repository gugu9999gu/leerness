'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const rootSource = path.resolve(__dirname, '..');
const cliFile = path.join(rootSource, 'bin/leerness.js');
const version = require('../package.json').version;
const arena = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-next-take-'));
const home = path.join(arena, 'home'); fs.mkdirSync(home);
const env = { ...process.env, HOME: home, USERPROFILE: home, XDG_CACHE_HOME: home,
  XDG_CONFIG_HOME: home, APPDATA: home, LOCALAPPDATA: home,
  LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1',
  LEERNESS_NO_LOCK_WARN: '1', LEERNESS_NO_AUTO_ROADMAP: '1', LEERNESS_NO_AUTO_REVIEW: '1' };
delete env.NODE_OPTIONS;
let sequence = 0;
function fixture(document = { queue: [{ title: 'fixture task', command: null }], at: null }, initialized = true) {
  const root = path.join(arena, '한글 project ' + sequence++), dir = path.join(root, '.leerness');
  fs.mkdirSync(dir, { recursive: true });
  if (initialized) fs.writeFileSync(path.join(dir, 'HARNESS_VERSION'), version + '\n');
  fs.writeFileSync(path.join(dir, 'LANGUAGE'), 'en\n');
  const file = path.join(dir, 'next-action-queue.json');
  if (document !== undefined) fs.writeFileSync(file, typeof document === 'string' || Buffer.isBuffer(document) ? document : JSON.stringify(document));
  return { root, dir, file };
}
function preload(code) {
  const file = path.join(arena, 'preload-' + sequence++ + '.cjs');
  fs.writeFileSync(file, code); return file;
}
function run(f, args, load) {
  const result = cp.spawnSync(process.execPath, [...(load ? ['--require', load] : []), cliFile, ...args, '--path', f.root, '--json'],
    { cwd: arena, env, encoding: 'utf8', timeout: 20000, windowsHide: true });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  return result;
}
function json(result) { return JSON.parse(result.stdout); }
function queue(f) { return JSON.parse(fs.readFileSync(f.file, 'utf8').replace(/^\uFEFF/, '')).queue; }
function rows(f) {
  const file = path.join(f.dir, 'progress-tracker.md');
  return fs.existsSync(file) ? require('../lib/progress-rows').parseProgressRows(fs.readFileSync(file, 'utf8')) : [];
}
function taskStub(body) {
  return preload(`const cp=require('node:child_process'); const spawn=cp.spawnSync;
cp.spawnSync=function(file,args,options){if(Array.isArray(args)&&args[1]==='task'&&args[2]==='add'){${body}}return spawn.apply(this,arguments);};`);
}
for (const [label, bytes, expected] of [
  ['broken JSON', '{"private_marker":"do-not-echo",', 'store_corrupt'],
  ['broken UTF8', Buffer.from([0x7b, 0xff, 0x7d]), 'store_corrupt'],
  ['null root', 'null', 'store_invalid'],
  ['non-array queue', '{"queue":{}}', 'store_invalid'],
  ['invalid item', '{"queue":[null]}', 'store_invalid'],
  ['missing title', '{"queue":[{}]}', 'store_invalid'],
  ['future version', '{"schemaVersion":99,"queue":[]}', 'store_invalid'],
]) {
  for (const args of [['next-action','list'], ['next-action','add','new'], ['next-action','take','0'], ['next-action','clear']]) {
    test(label + ' refused by ' + args[1], () => {
      const f = fixture(bytes), before = fs.readFileSync(f.file), r = run(f,args);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.equal(json(r).code, expected);
      assert(!r.stdout.includes('do-not-echo'));
      assert.deepEqual(fs.readFileSync(f.file), before);
      assert.equal(rows(f).length, 0);
    });
  }
}
test('successful take creates a task before consuming its action and returns JSON', () => {
  const f=fixture(), r=run(f,['next-action','take','0']);
  assert.equal(r.status,0,r.stdout+r.stderr); assert.equal(json(r).ok,true);
  assert.match(json(r).taskId,/^T-\d{4,}$/); assert.equal(queue(f).length,0);
  assert.equal(rows(f)[0].id,json(r).taskId); assert.equal(rows(f)[0].request,'fixture task');
});
test('uninitialized workspace refusal leaves the queue unchanged', () => {
  const f=fixture(undefined,false), before=fs.readFileSync(f.file), r=run(f,['next-action','take','0']);
  assert.equal(r.status,1,r.stdout+r.stderr); assert.equal(json(r).code,'runtime_layout_incompatible');
  assert.deepEqual(fs.readFileSync(f.file),before); assert.equal(rows(f).length,0);
});
for (const [label, body] of [
  ['nonzero exit', "return {status:3,signal:null,stdout:'',stderr:'private-child-text'};"],
  ['timeout', "return {status:null,signal:'SIGTERM',error:Object.assign(new Error('timeout'),{code:'ETIMEDOUT'}),stdout:'',stderr:''};"],
  ['spawn exception', "throw Object.assign(new Error('private-child-text'),{code:'EIO'});"],
  ['unconfirmed success', "return {status:0,signal:null,stdout:'not a task receipt',stderr:''};"],
]) test(label+' does not consume the action or claim success',()=>{
  const f=fixture(), before=fs.readFileSync(f.file), r=run(f,['next-action','take','0'],taskStub(body));
  assert.equal(r.status,1,r.stdout+r.stderr); assert.equal(json(r).code,'task_add_failed');
  assert.equal(json(r).queuePreserved,true); assert(!r.stdout.includes('private-child-text'));
  assert.deepEqual(fs.readFileSync(f.file),before); assert.equal(rows(f).length,0);
});
for (const index of ['0.5','-1','NaN','Infinity','99']) test('invalid index '+index+' preserves queue',()=>{
  const f=fixture(), before=fs.readFileSync(f.file), r=run(f,['next-action','take',index]);
  assert.equal(r.status,1); assert.equal(json(r).code,'invalid_index'); assert.equal(rows(f).length,0);
  assert.deepEqual(fs.readFileSync(f.file),before);
});
test('task tracker write rejection leaves the action queued',()=>{
  const f=fixture(), before=fs.readFileSync(f.file);
  fs.writeFileSync(path.join(f.dir,'progress-tracker.md'),'| T-0001 | broken |\n');
  const r=run(f,['next-action','take','0']); assert.equal(r.status,1);
  assert.equal(json(r).code,'task_add_failed'); assert.deepEqual(fs.readFileSync(f.file),before);
});
test('queue commit failure reports the created task without deleting or retrying it',()=>{
  const f=fixture({queue:[{title:'pipe | 한글\nnext',command:null}],at:null}), before=fs.readFileSync(f.file);
  const hook=preload(`const text=require(${JSON.stringify(path.join(rootSource,'lib/managed-text.js'))});const publish=text.publishTextEdit;
text.publishTextEdit=function(edit,file,value){if(file.endsWith('next-action-queue.json'))throw Object.assign(new Error('fixture refusal'),{code:'E_OUTPUT_CHANGED'});return publish.apply(this,arguments);};`);
  const r=run(f,['next-action','take','0'],hook);
  assert.equal(r.status,1); assert.equal(json(r).code,'task_created_queue_pending');
  assert.match(json(r).taskId,/^T-\d{4,}$/); assert.equal(rows(f).length,1);
  assert.deepEqual(fs.readFileSync(f.file),before);
  const retry=run(f,['next-action','take','0']); assert.equal(retry.status,0,retry.stdout+retry.stderr);
  assert.equal(json(retry).taskId,json(r).taskId); assert.equal(rows(f).length,1); assert.equal(queue(f).length,0);
});
test('normal add preserves BOM CRLF and root/entry metadata',()=>{
  const doc={queue:[{title:'old',extension:42}],extension:{kept:'한글'},at:null};
  const f=fixture('\uFEFF'+JSON.stringify(doc,null,2).replace(/\n/g,'\r\n')+'\r\n');
  const r=run(f,['next-action','add','new']); assert.equal(r.status,0,r.stdout+r.stderr);
  const raw=fs.readFileSync(f.file,'utf8'); assert.equal(raw.charCodeAt(0),0xfeff);
  assert.equal(/(?<!\r)\n/.test(raw),false);
  const saved=JSON.parse(raw.slice(1)); assert.deepEqual(saved.extension,doc.extension); assert.equal(saved.queue[0].extension,42);
});
test('hardlinked queue is refused without mutating the linked file',()=>{
  const f=fixture(), target=path.join(arena,'outside-'+sequence++), before=fs.readFileSync(f.file);
  fs.linkSync(f.file,target); const r=run(f,['next-action','take','0']);
  assert.equal(r.status,1); assert.deepEqual(fs.readFileSync(target),before); assert.equal(rows(f).length,0);
});
test('read of a missing queue does not create a workspace',()=>{
  const root=path.join(arena,'empty-'+sequence++); fs.mkdirSync(root);
  const r=run({root},['next-action','list']); assert.equal(r.status,0);
  assert.deepEqual(json(r).queue,[]); assert.deepEqual(fs.readdirSync(root),[]);
});
test('dry-run take is refused before any task or queue mutation',()=>{
  const f=fixture(), before=fs.readFileSync(f.file), r=run(f,['next-action','take','0','--dry-run']);
  assert.equal(r.status,1); assert.equal(rows(f).length,0); assert.deepEqual(fs.readFileSync(f.file),before);
});
async function spawned(f,args,hook) {
  const child=cp.spawn(process.execPath,[...(hook?['--require',hook]:[]),cliFile,...args,'--path',f.root,'--json'],{cwd:arena,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('child timeout'));},20000);
    child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',status=>{clearTimeout(timer);resolve({status,stdout,stderr});});});
}
test('concurrent consumers create two tasks from two distinct actions without loss',async()=>{
  const f=fixture({queue:[{title:'first'},{title:'second'}],at:null});
  const slow=taskStub("Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,350);");
  const results=await Promise.all([spawned(f,['next-action','take','0'],slow),spawned(f,['next-action','take','0'])]);
  for(const r of results)assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(queue(f).length,0);assert.deepEqual(rows(f).map(r=>r.request).sort(),['first','second']);
});
test('one-item concurrent take permits one consumer and preserves one task',async()=>{
  const f=fixture(), results=await Promise.all([spawned(f,['next-action','take','0']),spawned(f,['next-action','take','0'])]);
  assert.deepEqual(results.map(r=>r.status).sort(),[0,1]);assert.equal(rows(f).length,1);assert.equal(queue(f).length,0);
});
test('foreign queue update after task creation is retained and reported as partial',()=>{
  const f=fixture(), concurrent={queue:[{title:'foreign latest'}],at:null,extension:'keep'};
  const hook=taskStub(`const result=spawn.apply(this,arguments);require('node:fs').writeFileSync(${JSON.stringify(f.file)},${JSON.stringify(JSON.stringify(concurrent))});return result;`);
  const r=run(f,['next-action','take','0'],hook);
  assert.equal(r.status,1);assert.equal(json(r).code,'task_created_queue_pending');
  assert.equal(rows(f).length,1);assert.deepEqual(JSON.parse(fs.readFileSync(f.file,'utf8')),concurrent);
});
test('task created before a timeout remains an unknown outcome with queued recovery',()=>{
  const f=fixture(), before=fs.readFileSync(f.file);
  const hook=taskStub("spawn.apply(this,arguments);return {status:null,signal:'SIGTERM',error:Object.assign(new Error('timeout'),{code:'ETIMEDOUT'}),stdout:'',stderr:''};");
  const r=run(f,['next-action','take','0'],hook);
  assert.equal(r.status,1);assert.equal(json(r).taskOutcome,'unknown');assert.equal(rows(f).length,1);
  assert.deepEqual(fs.readFileSync(f.file),before);
  const retry=run(f,['next-action','take','0']);assert.equal(retry.status,0,retry.stdout+retry.stderr);
  assert.equal(rows(f).length,1);assert.equal(json(retry).existing,true);
});
test('suggested command is returned as data and is never executed',()=>{
  const marker=path.join(arena,'should-not-exist-'+sequence++);
  const command=JSON.stringify(process.execPath)+' -e '+JSON.stringify('require("fs").writeFileSync('+JSON.stringify(marker)+',"bad")');
  const f=fixture({queue:[{title:'inspect command',command}],at:null});
  const r=run(f,['next-action','take','0']);assert.equal(r.status,0,r.stdout+r.stderr);
  assert.equal(json(r).action.command,command);assert.equal(fs.existsSync(marker),false);
});
test('Unicode task title survives take without removing its first letters',()=>{
  const title='é中文 한글 task',f=fixture({queue:[{title}],at:null}),r=run(f,['next-action','take','0']);
  assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(rows(f)[0].request,title);
});
test('punctuation-only title is refused without task or queue writes',()=>{
  const f=fixture({queue:[{title:'🔥 !!!'}],at:null}), before=fs.readFileSync(f.file),r=run(f,['next-action','take','0']);
  assert.equal(r.status,1);assert.equal(json(r).code,'invalid_title');assert.equal(rows(f).length,0);
  assert.deepEqual(fs.readFileSync(f.file),before);
});
test('extra take arguments are refused rather than silently ignored',()=>{
  const f=fixture(),before=fs.readFileSync(f.file),r=run(f,['next-action','take','0','1']);
  assert.equal(r.status,1);assert.equal(json(r).code,'invalid_index');assert.deepEqual(fs.readFileSync(f.file),before);
});
test('repeated task add with pipe and newline returns one confirmed task ID',()=>{
  const f=fixture(),title='task | name\nwith row',a=run(f,['task','add',title]),b=run(f,['task','add',title]);
  assert.equal(a.status,0);assert.equal(b.status,0);assert.equal(json(a).id,json(b).id);
  assert.equal(json(b).existing,true);assert.equal(rows(f).length,1);
});
test('invalid UTF8 tracker is preserved and cannot consume an action',()=>{
  const f=fixture(),tracker=path.join(f.dir,'progress-tracker.md'),bytes=Buffer.from([0xff,0xfe,0x7c]);
  fs.writeFileSync(tracker,bytes);const before=fs.readFileSync(f.file),r=run(f,['next-action','take','0']);
  assert.equal(r.status,1);assert.equal(json(r).code,'task_add_failed');
  assert.deepEqual(fs.readFileSync(tracker),bytes);assert.deepEqual(fs.readFileSync(f.file),before);
});
