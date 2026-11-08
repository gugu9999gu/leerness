'use strict';
require('./temp-cleanup').trackTemp(module);
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const cleanup=require('./temp-cleanup'),{create}=require('./e2e-env-tools'),cli=path.resolve(__dirname,'../bin/leerness.js');
function fixture(fn){const owned=cleanup.ownTree(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'leerness-e2e-env-')));
 try{const root=path.join(owned.dir,'project'),ws=path.join(root,'.leerness'),cache=path.join(owned.dir,'cache');fs.mkdirSync(ws,{recursive:true});fs.mkdirSync(cache);
  fs.writeFileSync(path.join(ws,'HARNESS_VERSION'),require('../package.json').version+'\n');fs.writeFileSync(path.join(ws,'manifest.json'),'{"language":"en","mode":"standard"}');fs.writeFileSync(path.join(root,'package.json'),'{"name":"env-fixture"}');
  const tools=create(owned.dir),env={...tools.env,LEERNESS_CACHE_DIR:cache,LEERNESS_OFFLINE:'1',LEERNESS_NO_PROMPT:'1',LEERNESS_NO_AUTOCHCP:'1'};
  const run=(args,input)=>cp.spawnSync(process.execPath,[cli,...args],{cwd:root,env,encoding:'utf8',timeout:15000,maxBuffer:1024*1024,input});
  return fn({root,ws,cache,tools,run});
 }finally{cleanup.removeOwnedTree(owned);}}
function normal(r){assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,r.stdout+r.stderr);return JSON.parse(r.stdout);}
test('isolated real tools retain the parent environment and cannot select a cwd shadow',()=>fixture(f=>{
 const base={...process.env},copy={...base},extra=path.join(f.root,'extra');fs.mkdirSync(extra);create(extra,base);assert.deepEqual(base,copy);
 const shadow=path.join(f.root,'shadow-ran');
 fs.writeFileSync(path.join(f.root,'python.cmd'),'@ECHO off\r\n"%dp0%\\shadow.js" %*\r\n');
 fs.writeFileSync(path.join(f.root,'shadow.js'),`require('fs').writeFileSync(${JSON.stringify(shadow)},'bad');console.log('fixture-python-1.0.0');\n`);
 if(process.platform!=='win32'){const file=path.join(f.root,'python');fs.writeFileSync(file,`#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(shadow)},'bad');\n`);fs.chmodSync(file,0o755);}
 const data=normal(f.run(['env','detect',f.root,'--json']));assert.equal(data.persisted,true);assert(f.tools.verify(data));assert(fs.existsSync(path.join(f.ws,'environment.json')));assert(!fs.existsSync(shadow));
}));
test('the success guard requires new real observations after a checkpoint',()=>fixture(f=>{
 const data=normal(f.run(['env','detect',f.root,'--json']));assert(f.tools.verify(data));const checkpoint=f.tools.checkpoint();assert(!f.tools.verify(data,checkpoint));
 const refreshed=normal(f.run(['env','detect',f.root,'--json']));assert(f.tools.verify(refreshed,checkpoint));
}));
test('MCP normal discovery is successful and leaves the snapshot absent',()=>fixture(f=>{
 const r=f.run(['mcp','serve'],JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'leerness_env_detect',arguments:{path:f.root}}})+'\n');
 assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);const message=JSON.parse(r.stdout.trim().split('\n')[0]);assert.notEqual(message.result.isError,true);
 const data=JSON.parse(message.result.content[0].text);assert.equal(data.persisted,false);assert(f.tools.verify(data));assert(!fs.existsSync(path.join(f.ws,'environment.json')));
}));
test('handoff writeback observes real fixture tools while retaining Korean and English environment output',()=>fixture(f=>{
 const root=path.join(f.root,'handoff'),snapshot=path.join(root,'.leerness','environment.json');
 const init=f.run(['init',root,'--yes','--language','ko']);assert.equal(init.error,undefined);assert.equal(init.status,0,init.stdout+init.stderr);
 const first=f.run(['handoff',root,'--writeback']);assert.equal(first.status,0,first.stdout+first.stderr);
 for(const [language,pattern]of[['en',/Runtime environment/],['ko',/실행 환경/]]){
  const data=JSON.parse(fs.readFileSync(snapshot,'utf8'));data.node.version='v0.0.0-fixture';fs.writeFileSync(snapshot,JSON.stringify(data));const checkpoint=f.tools.checkpoint();
  const r=f.run(['handoff',root,'--writeback','--language',language]);assert.equal(r.error,undefined);assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,pattern);
  assert(f.tools.verify({snapshot:JSON.parse(fs.readFileSync(snapshot,'utf8'))},checkpoint));
 }
}));
for(const [name,source,code,reason]of[
 ['timeout','setInterval(()=>{},1000);','E_ENV_PROBE_TIMEOUT','ETIMEDOUT'],
 ['overflow','console.log("fixture-python-1.0.0");process.stdout.write("x".repeat(70*1024));','E_ENV_PROBE_INCOMPLETE','ENOBUFS'],
 ['nonzero','console.log("fixture-python-1.0.0");process.exit(42);','E_ENV_PROBE_INCOMPLETE','E_TOOL_PROBE_FAILED']
])test('isolated '+name+' retains failure, budgets and original snapshot/cache bytes',()=>fixture(f=>{
 fs.writeFileSync(path.join(f.tools.bin,'python.js'),source);
 if(process.platform!=='win32'){const file=path.join(f.tools.bin,'python');fs.writeFileSync(file,`#!/usr/bin/env node\n${source}\n`);fs.chmodSync(file,0o755);}
 const snapshot=path.join(f.ws,'environment.json'),cache=path.join(f.cache,'env-tools.json'),a='{"capturedAt":"2020-01-01T00:00:00.000Z","tools":{},"note":"원문"}\r\n',b='{"entries":{},"note":"retain"}\n';fs.writeFileSync(snapshot,a);fs.writeFileSync(cache,b);
 const r=f.run(['env','detect',f.root,'--json']);assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,1,r.stdout+r.stderr);
 const data=JSON.parse(r.stdout);assert.equal(data.code,code);assert.equal(data.inspection.status,'unknown');assert.equal(data.inspection.complete,false);assert.equal(data.inspection.budgetMs,5000);assert.equal(data.inspection.perToolMs,2000);assert.equal(data.inspection.reason,reason);
 assert.equal(fs.readFileSync(snapshot,'utf8'),a);assert.equal(fs.readFileSync(cache,'utf8'),b);
}));
