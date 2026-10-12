#!/usr/bin/env node
'use strict';
// Actual CLI processes, with bounded filesystem fault injection only in owned fixtures.
const fs = require('fs'), path = require('path'), os = require('os');
const cp = require('child_process'), assert = require('assert/strict'), crypto = require('crypto');
const { _renderDecisionsMd, _renderLessonsMd } = require('../lib/pure-utils');
const root = path.resolve(__dirname, '..'), cli = path.join(root, 'bin/leerness.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-checked-input-'));
const seed = path.join(temp, 'seed'), results = [], executions = [];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const state = file => {
  try { const s = fs.lstatSync(file, { bigint: true }); return { size: String(s.size), mtime: String(s.mtimeNs), sha256: s.isFile() ? sha(fs.readFileSync(file)) : null }; }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};
const source = () => Object.fromEntries(['bin/leerness.js','lib/memory-input.js','lib/migrate.js','package.json'].map(f => [f, state(path.join(root,f))]));
const sourceBefore = source();
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC)$/i.test(k)));
for (const k of ['TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA']) { env[k] = path.join(temp,k); fs.mkdirSync(env[k],{recursive:true}); }
Object.assign(env,{LEERNESS_INTERNAL:'1',LEERNESS_OFFLINE:'1',LEERNESS_NO_BANNER:'1',LEERNESS_NO_PROMPT:'1',LEERNESS_NO_AUTOCHCP:'1'});
function check(name, fn) { try { fn(); results.push({name,ok:true}); console.log('PASS '+name); } catch(e) { results.push({name,ok:false,error:e.message}); console.error('FAIL '+name+': '+e.message); } }
function faultHook() {
  const fs = require('fs'), path = require('path'), crypto = require('crypto');
  const config = JSON.parse(process.env.LEERNESS_CHECKED_FIXTURE);
  const stringify = JSON.stringify, orig = {};
  for (const n of ['existsSync','lstatSync','readFileSync','writeFileSync','openSync','closeSync']) orig[n] = fs[n].bind(fs);
  const normalize = p => typeof p === 'string' ? path.resolve(p).toLowerCase() : null;
  const target = normalize(config.target), descriptors = new Map(), trace = {hits:0,reads:0};
  const active = () => orig.existsSync(config.canonical+'.lock');
  const matches = p => normalize(p) === target || (typeof p === 'number' && descriptors.get(p) === target);
  const domain = () => Object.fromEntries(config.files.map(f => {
    try { const s=orig.lstatSync(f,{bigint:true}); return [path.basename(f),{size:String(s.size),mtime:String(s.mtimeNs),sha256:crypto.createHash('sha256').update(orig.readFileSync(f)).digest('hex')}]; }
    catch(e) { if(e.code==='ENOENT')return [path.basename(f),null]; throw e; }
  }));
  const error = code => Object.assign(new Error('owned fixture I/O fault'),{code});
  const replace = () => { orig.writeFileSync(config.target,config.replacement); trace.hits++; trace.afterExternalChange=domain(); };
  fs.existsSync = function(p) { if(active() && matches(p) && ['stat-error','hidden-exists'].includes(config.mode)) { trace.hits++; return false; } return orig.existsSync(p); };
  fs.lstatSync = function(p,...args) { if(active() && matches(p) && config.mode==='stat-error') { trace.hits++; throw error('EACCES'); } return orig.lstatSync(p,...args); };
  fs.openSync = function(p,...args) {
    if(active() && matches(p) && config.mode==='read-error') { trace.hits++; throw error('EIO'); }
    const fd=orig.openSync(p,...args); descriptors.set(fd,normalize(p)); return fd;
  };
  fs.closeSync = function(fd) { try{return orig.closeSync(fd);}finally{descriptors.delete(fd);} };
  fs.readFileSync = function(p,...args) {
    const selected=active() && matches(p);
    if(selected && config.mode==='read-error') { trace.hits++; throw error('EIO'); }
    const out=orig.readFileSync(p,...args);
    if(selected) { trace.reads++; if(config.mode==='change-during-read' && trace.hits===0)replace(); }
    return out;
  };
  JSON.stringify = function(value,...args) {
    if(active() && config.mode==='change-before-publication' && trace.hits===0 && Array.isArray(value) && value.some(v => v && (v.title==='fresh' || v.text==='fresh')))replace();
    return stringify(value,...args);
  };
  process.on('exit',()=>orig.writeFileSync(config.trace,stringify(trace)));
}
const hook = path.join(temp,'fault-hook.cjs');
fs.writeFileSync(hook,`(${faultHook.toString()})();\n`);
function run(project,args,config) {
  const start=Date.now();
  const r=cp.spawnSync(process.execPath,[...(config?['--require',hook]:[]),cli,...args,'--path',project,'--json'],{cwd:project,env:{...env,...(config?{LEERNESS_CHECKED_FIXTURE:JSON.stringify(config)}:{})},encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});
  executions.push({args,status:r.status,signal:r.signal,error:r.error?.code||null,ms:Date.now()-start,stdout:String(r.stdout||'').slice(0,1200),stderr:String(r.stderr||'').slice(0,600)});
  assert.equal(r.error,undefined); assert.equal(r.signal,null); return r;
}
let serial=0;
function fixture(surface,legacy=false) {
  const project=path.join(temp,'case-'+(++serial)); require('../lib/copy-tree').copyTreeSync(seed,project);
  const p=ext=>path.join(project,'.leerness',surface+'.'+ext);
  const item=value=>surface==='decisions'?{date:'2026-01-01',title:value,decision:value,reason:null,alternatives:null,impact:null,extension:{keep:'line1\nline2'}}:{date:'2026-01-01',text:value,tag:null,extension:{keep:'line1\nline2'}};
  const body=value=>surface==='decisions'?`### 2026-01-01 — ${value}\n- Decision: ${value}\n`:`### 2026-01-01\n- Lesson: ${value}\n`;
  const render=entries=>surface==='decisions'?_renderDecisionsMd(entries):_renderLessonsMd(entries);
  const initial=[item('survivor'),item('selected')];
  fs.writeFileSync(p('json'),JSON.stringify(initial));
  fs.writeFileSync(p('md'),render(initial));
  fs.writeFileSync(p('archive.md'),'# Archive\n\n## 제거 2026-01-02 (target: "restore-me")\n\n'+body('archived'));
  if(legacy)fs.unlinkSync(p('json'));
  const files=['json','md','archive.md'].map(p);
  const domain=()=>Object.fromEntries(files.map(f=>[path.basename(f),state(f)]));
  const args=[surface==='decisions'?'decision':'lesson',surface==='decisions'?'add':'save'];
  const config=(mode,target=p('json'))=>({mode,target,canonical:p('json'),files,trace:path.join(project,'trace.json'),replacement:target===p('json')?JSON.stringify([item('external-new')]):'# Memory\n\n'+body('external-new')});
  const load=()=>JSON.parse(fs.readFileSync(p('json'),'utf8').replace(/^\uFEFF/,''));
  return {project,p,item,body,args,files,domain,config,load};
}
async function main() {
try {
  fs.mkdirSync(seed); assert.equal(run(seed,['init',seed,'--yes','--language','en','--no-stale-check']).status,0);
  for(const surface of ['decisions','lessons']) {
    const op=f=>[
      ['add',[...f.args,'fresh']],['duplicate',[...f.args,'survivor']],['force',[...f.args,'survivor','--force']],
      ['drop',[surface==='decisions'?'decision':'lesson','drop','selected']],
      ['restore',['memory','restore',surface,'restore-me']],['restore-force',['memory','restore',surface,'restore-me','--force']]
    ];
    for(const legacy of [false,true]) {
      for(const mode of ['stat-error','read-error','change-during-read']) {
        for(const index of [0,1,2,3,4,5])check(`${surface} ${legacy?'legacy':'canonical'} ${mode} ${index}`,()=>{
          const f=fixture(surface,legacy),config=f.config(mode,legacy?f.p('md'):f.p('json')),before=f.domain();
          const r=run(f.project,op(f)[index][1],config),trace=JSON.parse(fs.readFileSync(config.trace));
          assert(trace.hits>0,'fault not exercised'); assert(r.status>0,'uncertain source accepted');
          assert.equal(JSON.parse(r.stdout).code,mode==='change-during-read'?'store_changed':'store_unreadable');
          assert.deepEqual(f.domain(),trace.afterExternalChange||before,'domain writes after failed admission');
        });
      }
      check(`${surface} ${legacy?'legacy':'canonical'} change before publication`,()=>{
        const f=fixture(surface,legacy),config=f.config('change-before-publication',legacy?f.p('md'):f.p('json'));
        const r=run(f.project,[...f.args,'fresh'],config),trace=JSON.parse(fs.readFileSync(config.trace));
        assert.equal(trace.hits,1); assert(r.status>0); assert.equal(JSON.parse(r.stdout).code,'store_changed');
        assert.deepEqual(f.domain(),trace.afterExternalChange);
      });
    }
    check(`${surface} ignored existence boolean never substitutes legacy data`,()=>{
      const f=fixture(surface),before=f.load(); fs.appendFileSync(f.p('md'),'\n# stale-legacy-only\n'+f.body('stale-legacy'));
      const r=run(f.project,[...f.args,'fresh'],f.config('hidden-exists')); assert.equal(r.status,0);
      assert.deepEqual(f.load().slice(0,2),before); assert.equal(f.load().length,3);
    });
    check(`${surface} malformed legacy UTF-8 refuses initialization`,()=>{
      const f=fixture(surface,true); fs.writeFileSync(f.p('md'),Buffer.concat([Buffer.from(f.body('survivor')),Buffer.from([0xc3,0x28])]));
      const before=f.domain(),r=run(f.project,[...f.args,'fresh']); assert(r.status>0);assert.equal(JSON.parse(r.stdout).code,'store_corrupt');assert.deepEqual(f.domain(),before);
    });
    check(`${surface} positive absence retains legacy values`,()=>{
      const f=fixture(surface,true);assert.equal(run(f.project,[...f.args,'fresh']).status,0);
      assert.deepEqual(f.load().map(v=>v.title||v.text),['survivor','selected','fresh']);
    });
    check(`${surface} both absent initialize`,()=>{
      const f=fixture(surface,true);fs.unlinkSync(f.p('md'));assert.equal(run(f.project,[...f.args,'fresh']).status,0);assert.equal(f.load().length,1);
    });
    check(`${surface} valid BOM and extensions preserved`,()=>{
      const f=fixture(surface),before=f.load();fs.writeFileSync(f.p('json'),Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(JSON.stringify(before))]));
      assert.equal(run(f.project,[...f.args,'fresh']).status,0);assert.deepEqual(f.load().slice(0,2),before);
    });
    check(`${surface} read-only malformed-canonical fallback is unchanged`,()=>{
      const f=fixture(surface);fs.writeFileSync(f.p('json'),'{');const before=f.domain();assert.equal(run(f.project,[surface==='decisions'?'decision':'lesson','list']).status,0);assert.deepEqual(f.domain(),before);
    });
    for(const mode of ['stat-error','read-error','change-during-read'])check(`${surface} backfill ${mode}`,()=>{
      const f=fixture(surface,true),config=f.config(mode,f.p('md')),before=f.domain();
      const r=run(f.project,['migrate','apply','--yes'],config),trace=JSON.parse(fs.readFileSync(config.trace));
      assert(trace.hits>0);assert(r.status>0);assert.equal(JSON.parse(r.stdout).code,mode==='change-during-read'?'store_changed':'store_unreadable');
      assert.deepEqual(f.domain(),trace.afterExternalChange||before);
    });
    check(`${surface} checked legacy backfill succeeds`,()=>{
      const f=fixture(surface,true);assert.equal(run(f.project,['migrate','apply','--yes']).status,0);
      assert.deepEqual(f.load().map(v=>v.title||v.text),['survivor','selected']);
    });
    const f=fixture(surface),survivor=f.load()[0];
    // T-0193 archive-retention guard: concurrency itself is the subject here, so
    // make the drop target exactly representable by the legacy Markdown archive.
    // The survivor keeps its extension field, preserving the canonical-value control.
    const concurrentSeed=f.load(); delete concurrentSeed[1].extension;
    fs.writeFileSync(f.p('json'),JSON.stringify(concurrentSeed));
    const parallelArgs=[0,1,2,3].map(i=>[...f.args,'parallel-'+i]);
    parallelArgs.push([surface==='decisions'?'decision':'lesson','drop','selected'],['memory','restore',surface,'restore-me']);
    const replies=await Promise.all(parallelArgs.map(args=>new Promise(resolve=>{
      const started=Date.now();cp.execFile(process.execPath,[cli,...args,'--path',f.project,'--json'],{cwd:f.project,env,encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024},(error,stdout,stderr)=>{
        const result={args,error:error?String(error.code):null,signal:error?.signal||null,ms:Date.now()-started,stdout:String(stdout||'').slice(0,1200),stderr:String(stderr||'').slice(0,600)};
        executions.push(result);resolve(result);
      });
    })));
    check(`${surface} six real concurrent add/drop/restore writers preserve all results`,()=>{
      assert(replies.every(r=>!r.error&&!r.signal),JSON.stringify(replies));
      const values=f.load();assert.deepEqual(values.map(v=>v.title||v.text).sort(),['survivor','archived','parallel-0','parallel-1','parallel-2','parallel-3'].sort());
      assert.deepEqual(values.find(v=>(v.title||v.text)==='survivor'),survivor);
      assert(fs.readFileSync(f.p('archive.md'),'utf8').includes('target: "selected"'));
    });
  }
} catch(e) { results.push({name:'setup',ok:false,error:e.message}); }
check('source bytes and mtimes unchanged',()=>assert.deepEqual(source(),sourceBefore));
const passed=results.filter(r=>r.ok).length,total=results.length;
fs.writeFileSync(path.join(temp,'results.json'),JSON.stringify({node:process.version,platform:process.platform,passed,total,results,executions,sourceBefore,sourceAfter:source()},null,2));
console.log(`memory checked input: ${passed}/${total} passed; CLI calls: ${executions.length}; Evidence: ${temp}`);
if(passed!==total||total!==99)process.exitCode=1;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
