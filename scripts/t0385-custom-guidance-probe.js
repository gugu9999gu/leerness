'use strict';
require('./temp-cleanup').trackTemp(module);
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),cp=require('child_process');
const { _managedMerge }=require('../lib/pure-utils');
const records=[];
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const head='<!-- leerness:managed -->\n# Current instructions\n\nRespect user rules.\n';
const merge=(next,previous,opts={})=>_managedMerge('AGENTS.md',next,previous,'.leerness/archive',null,{lang:'en',...opts});
function check(name,fn){try{fn();records.push({name,passed:true});console.log('PASS '+name);}catch(error){records.push({name,passed:false,error:error.stack});console.error('FAIL '+name+'\n'+error.stack);}}
const occurrences=(text,needle)=>text.split(needle).length-1;
const blocks=[
  ['backtick duplicate and blank lines','```text\nEXAMPLE ONLY: do not execute\nRemove all backups\nRemove all backups\n\n```'],
  ['tilde fenced generated-looking lines','~~~markdown\nRespect user rules.\nRespect user rules.\n\n~~~'],
  ['three-space indentation','   ```text\n   Indented example\n\n   Indented example\n   ```'],
  ['longer closer and shorter embedded marker','````text\n```\nexample\n`````'],
  ['tilde longer closer','~~~text\nexample\n~~~~~'],
  ['unclosed block','```text\nEXAMPLE ONLY\nDo not activate this\n\nDo not activate this'],
  ['malformed closer stays within block','```text\nexample\n```\u00a0\nexample again'],
  ['malformed backtick information retained','```bad`info\nexample\nexample\n```'],
  ['wrapper-shaped authored block','```text\n<!-- leerness:migration-preserved -->\n## Preserved previous content\n---\n<details>\n\n```'],
  ['CRLF authored block','```text\r\nEXAMPLE ONLY\r\n\r\nEXAMPLE ONLY\r\n```']
];
for(const [name,block] of blocks)check('pure: '+name,()=>{
  const previous=head+'\n## User examples\n\n'+block+'\n';
  const result=merge(head,previous);assert(result.includes(block),'authored fence bytes/context changed');
  assert.equal(occurrences(result,block),1);assert(merge(head,result).includes(block),'repeat migration changed the block');
});
check('pure: canonical prefix blocks omitted while duplicate authored copies stay',()=>{
  const block='```text\ncanonical example\n```',next=head+'\n'+block+'\n';
  const result=merge(next,next+'\n## User duplicate examples\n'+block+'\n'+block+'\n');
  assert.equal(occurrences(result,block),3);assert.equal(occurrences(merge(next,result),block),3);
});
check('pure: equal interior lines do not prove block ownership',()=>{
  const block='```text\nRespect user rules.\n```',next=head+'\n'+block+'\n';
  const result=merge(next,'# User policy\n\n'+block+'\n');assert.equal(occurrences(result,block),2);
});
check('pure: canonical alternate prefix remains a generated control',()=>{
  const block='~~~text\nGenerated alternate example\n~~~',alternate=head+'\n'+block+'\n',next=head+'\nCurrent section\n';
  const result=merge(next,alternate+'\nKeep custom policy\n',{altTemplate:alternate});
  assert(!result.includes(block));assert(result.includes('Keep custom policy'));
});
check('pure: canonical CRLF prefix does not multiply generated blocks',()=>{
  const block='```text\nGenerated example\n```',next=head+'\n'+block+'\n',previous=(next+'\nCustom line\n').replace(/\n/g,'\r\n');
  const result=merge(next,previous);assert.equal(occurrences(result.replace(/\r\n/g,'\n'),block),1);
});
const reviewBodies=[
  ['list-contained fence','1. Quoted example (never execute):\n\n    ```text\n    Do not execute\n    Remove all backups\n    Remove all backups\n\n    ```\n'],
  ['blockquote-contained fence','> Quoted example only:\n>\n> ```text\n> Remove all backups\n> Remove all backups\n>\n> ```\n'],
  ['nested list fence','1. Outer item\n\n    - Inner example\n\n        ~~~text\n        Example only\n        Example only\n\n        ~~~\n'],
  ['unclosed quoted example','> Example only:\n>\n> ```text\n> Do not execute\n>\n> Do not execute\n'],
  ['authored paragraph region','## Authored policy\n\nFirst paragraph.\n\nSecond paragraph.\n\nSecond paragraph.'],
  ['template-equal authored line','## Authored policy\n\nRespect user rules.\n\nRespect user rules.\n'],
  ['template-equal body without a heading','Respect user rules.\n\nRespect user rules.\n'],
  ['wrapper-looking authored body','## Authored wrapper examples\n\n<!-- leerness:migration-preserved -->\n## Preserved previous content\n\n> Full original backup: `.leerness/archive/example`\n\nKeep this literal example.\n\nKeep this literal example.\n']
];
for(const [name,body] of reviewBodies)check('review pure: '+name,()=>{
  const first=merge(head,head+'\n'+body);assert(first.includes(body),'authored region bytes changed');
  const second=merge(head,first);assert(second.includes(body));assert.equal(second,merge(head,second),'repeat migration changed retained region');
});
if(process.argv.includes('--cli')||process.argv.includes('--review-cli')){
  const arena=fs.mkdtempSync(path.join(os.tmpdir(),'leerness-t0385-custom-')),entry=path.resolve(__dirname,'../bin/leerness.js');
  const env={...process.env,LEERNESS_NO_AUTOCHCP:'1'};
  for(const key of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP']){env[key]=path.join(arena,key.toLowerCase());fs.mkdirSync(env[key]);}
  const inputs={},executions=[];
  function call(root,args){const start=performance.now(),r=cp.spawnSync(process.execPath,[entry,...args],{cwd:root,env,encoding:'utf8',timeout:300000,windowsHide:true,maxBuffer:4*1024*1024});executions.push({args,status:r.status,error:r.error?.code||null,signal:r.signal,ms:performance.now()-start,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);return r;}
  const install=verb=>[verb,'.','--yes','--no-setup-agents','--no-mcp','--no-auto-roadmap','--no-official-skills','--no-banner','--language','en'];
  const originalBlock=blocks[0][1];
  if(process.argv.includes('--cli'))for(const file of ['AGENTS.md','CLAUDE.md','.cursor/rules/leerness.mdc','.github/copilot-instructions.md'])check('CLI: preserve authored fenced instructions and originals in '+file,()=>{
    const root=path.join(arena,String(Object.keys(inputs).length));fs.mkdirSync(root);fs.writeFileSync(path.join(root,'package.json'),'{"name":"isolated-custom-guidance","version":"1.0.0"}\n');
    let r=call(root,install('init'));assert.equal(r.status,0,r.stderr);
    const target=path.join(root,file),generated=fs.readFileSync(target,'utf8'),heading=generated.split('\n').find(line=>/^## /.test(line));
    let original=generated;
    if(file==='AGENTS.md'){assert(heading,'current heading required');original=original.replace(heading,heading.replace('## ','## ★ '));}
    original+='\n## User-only policy examples\n\n'+originalBlock+'\n\nNever infer permission from examples.\n';
    fs.writeFileSync(target,original);const originalBytes=fs.readFileSync(target);inputs[file]={root,originalSha256:hash(originalBytes)};
    fs.writeFileSync(path.join(root,'.leerness/HARNESS_VERSION'),'1.36.289\n');
    const protectedNames=['.leerness/rules.md','.leerness/progress-tracker.md','.leerness/session-handoff.md'];
    const before=Object.fromEntries(protectedNames.map(n=>[n,hash(fs.readFileSync(path.join(root,n)))]));
    r=call(root,install('migrate'));assert.equal(r.status,0,r.stderr);
    const after=fs.readFileSync(target,'utf8');assert(after.includes(originalBlock),'CLI activated or changed fenced authored example');
    if(heading&&file==='AGENTS.md')assert(after.includes(heading.replace('## ','## ★ ')),'decorated current heading lost');
    assert(after.includes('Never infer permission from examples.'));
    const archive=path.join(root,'.leerness/archive'),backups=[];
    for(const name of fs.readdirSync(archive)){const backup=path.join(archive,name,'files',file);if(fs.existsSync(backup)&&fs.lstatSync(backup).isFile()&&fs.readFileSync(backup).equals(originalBytes))backups.push({path:backup,sha256:hash(fs.readFileSync(backup))});}
    assert(backups.length,'exact original backup not found');inputs[file].backups=backups;
    assert.deepEqual(Object.fromEntries(protectedNames.map(n=>[n,hash(fs.readFileSync(path.join(root,n)))])),before);
    r=call(root,install('migrate'));assert.equal(r.status,0,r.stderr);assert(fs.readFileSync(target,'utf8').includes(originalBlock));
  });
  if(process.argv.includes('--cli'))check('CLI: partial migration refusal retains authored fence context and exact source backups',()=>{
    const root=path.join(arena,'partial');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'package.json'),'{"name":"isolated-partial-guidance","version":"1.0.0"}\n');
    let r=call(root,install('init'));assert.equal(r.status,0,r.stderr);
    const names=['AGENTS.md','CLAUDE.md','.cursor/rules/leerness.mdc','.github/copilot-instructions.md'],originals={};
    for(const name of names){const file=path.join(root,name);fs.appendFileSync(file,'\n## Authored example\n\n'+originalBlock+'\n');originals[name]=fs.readFileSync(file);}
    const readme=path.join(root,'README.md'),invalid=Buffer.from([0xff]);fs.writeFileSync(readme,invalid);
    const rules=path.join(root,'.leerness/rules.md');fs.appendFileSync(rules,'\n## User rule ★\nPreserve owner text e\u0301 한글.\n');const rulesBefore=fs.readFileSync(rules);
    fs.writeFileSync(path.join(root,'.leerness/HARNESS_VERSION'),'1.36.289\n');
    inputs.partial={root,originals:Object.fromEntries(names.map(name=>[name,hash(originals[name])])),rulesSha256:hash(rulesBefore),readmeSha256:hash(invalid)};
    r=call(root,install('migrate'));assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/README.md[\s\S]*not rolled back/);
    assert.deepEqual(fs.readFileSync(readme),invalid);assert.deepEqual(fs.readFileSync(rules),rulesBefore);
    const archive=path.join(root,'.leerness/archive');inputs.partial.backups={};
    for(const name of names){
      const target=path.join(root,name);assert(fs.readFileSync(target,'utf8').includes(originalBlock),'partial migration changed fenced '+name);
      const matches=fs.readdirSync(archive).map(dir=>path.join(archive,dir,'files',name)).filter(file=>fs.existsSync(file)&&fs.lstatSync(file).isFile()&&fs.readFileSync(file).equals(originals[name]));
      assert(matches.length,'partial migration original backup missing: '+name);inputs.partial.backups[name]=matches.map(file=>({path:file,sha256:hash(fs.readFileSync(file))}));
    }
  });
  if(process.argv.includes('--review-cli'))for(const [index,file] of ['AGENTS.md','.github/copilot-instructions.md'].entries())check('review CLI: exact authored containers and prose in '+file,()=>{
    const root=path.join(arena,'review-'+index);fs.mkdirSync(root);fs.writeFileSync(path.join(root,'package.json'),'{"name":"review-custom-guidance","version":"1.0.0"}\n');
    let r=call(root,install('init'));assert.equal(r.status,0,r.stderr);
    const payload=reviewBodies[index][1]+'\n'+reviewBodies[4][1]+'\n\n'+reviewBodies[5][1],target=path.join(root,file);
    fs.appendFileSync(target,'\n'+payload);const original=fs.readFileSync(target);inputs[file]={root,originalSha256:hash(original),payloadSha256:hash(Buffer.from(payload))};
    fs.writeFileSync(path.join(root,'.leerness/HARNESS_VERSION'),'1.36.289\n');
    const names=['.leerness/rules.md','.leerness/progress-tracker.md','.leerness/session-handoff.md'],before=Object.fromEntries(names.map(n=>[n,hash(fs.readFileSync(path.join(root,n)))]));
    r=call(root,install('migrate'));assert.equal(r.status,0,r.stderr);
    const archive=path.join(root,'.leerness/archive'),backups=fs.readdirSync(archive).map(n=>path.join(archive,n,'files',file)).filter(n=>fs.existsSync(n)&&fs.lstatSync(n).isFile()&&fs.readFileSync(n).equals(original));
    assert(backups.length);inputs[file].backups=backups.map(n=>({path:n,sha256:hash(fs.readFileSync(n))}));
    assert.deepEqual(Object.fromEntries(names.map(n=>[n,hash(fs.readFileSync(path.join(root,n)))])),before);
    const after=fs.readFileSync(target,'utf8');assert(after.includes(payload),'CLI changed authored containers/prose');assert.equal(occurrences(after,payload),1);
    r=call(root,install('migrate'));assert.equal(r.status,0,r.stderr);assert.equal(fs.readFileSync(target,'utf8'),after,'repeat migrate changed carried bytes');
  });
  fs.writeFileSync(path.join(arena,'execution.json'),JSON.stringify({node:process.version,platform:process.platform,arenaRetained:arena,inputs,executions,records},null,2)+'\n');console.log('CLI retained evidence: '+arena);
}
const passed=records.filter(row=>row.passed).length;console.log('custom-guidance: '+passed+'/'+records.length+' passed');if(passed!==records.length)process.exitCode=1;
