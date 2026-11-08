'use strict';
require('./temp-cleanup').trackTemp(module);
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process'),crypto=require('crypto');
const guidance=require('../lib/context-reading-guidance'),core=require('../bin/leerness');
const cursor='.cursor/rules/leerness.mdc',records=[],executions=[],inputs={};
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const generated=core.coreFiles(process.cwd(),'en',[])[cursor];
const count=(text,needle)=>text.split(needle).length-1;
function check(name,fn){try{fn();records.push({name,passed:true});console.log('PASS '+name);}catch(error){records.push({name,passed:false,error:error.stack});console.error('FAIL '+name+'\n'+error.stack);}}
const customHeader='---\r\ndescription: "Owner policy: source and tests --- only"\r\nglobs:\r\n  - "src/**/*.ts"\r\n  - "tests/**/*.ts"\r\nalwaysApply: true\r\nownerSetting:\r\n  exceptions: ["generated/**", "fixtures/**"]\r\n---\r\n';
const payload='## Owner exceptions\r\n\r\n> Apply the explicit owner exceptions before generated advice.\r\n\r\n```text\r\nEXAMPLE ONLY: do not execute\r\nRemove all backups\r\nRemove all backups\r\n\r\n```\r\n';
const guard=(file,next,previous,alternate)=>guidance.preserveCursorRulePolicy(file,next,previous,alternate);
if(!process.argv.includes('--cli-only')){
  check('pure: other provider paths remain outside Cursor policy guard',()=>assert.equal(guard('AGENTS.md',generated,customHeader),false));
  check('pure: empty optional Cursor file permits current generation',()=>assert.equal(guard(cursor,generated,''),false));
  check('pure: exact current generated rule remains refreshable',()=>assert.equal(guard(cursor,generated,generated),false));
  check('pure: exact current prefix with authored tail keeps existing canonical path',()=>assert.equal(guard(cursor,generated,generated+'\nKeep authored suffix.\n'),false));
  const alternate=core.coreFiles(process.cwd(),'ko',[])[cursor];
  check('pure: exact complete alternate generated prefix remains refreshable',()=>assert.equal(guard(cursor,generated,alternate+'\nAuthored suffix.\n',alternate),false));
  for(const [name,previous] of [
    ['custom leading YAML and CRLF',customHeader+payload],
    ['unknown headerless policy','# Owner-only rule\nKeep original applicability.\n'],
    ['manual true override',generated.replace('alwaysApply: false','alwaysApply: true')],
    ['custom glob condition',generated.replace('alwaysApply: false','globs: "src/**/*.ts"\nalwaysApply: false')],
    ['current header with edited generated-looking body',generated.replace('Follow AGENTS.md','Owner-approved exception: follow approved rules')],
    ['same-line prefix collision',generated.trimEnd()+' OWNER TEXT'],
    ['unknown malformed YAML','---\nalwaysApply: [not a boolean\n---\nKeep source; do not repair automatically.\n'],
    ['marker-like text does not prove ownership','<!-- leerness:managed -->\n'+customHeader+payload]
  ])check('pure: retain '+name,()=>assert.equal(guard(cursor,generated,previous),true));
  check('pure: Windows relative spelling identifies only the owned Cursor target',()=>assert.equal(guard('.cursor\\rules\\leerness.mdc',generated,customHeader+payload),true));
  const legacy=require('./fixtures/legacy-guidance-1.36.289.json');
  for(const [key,files] of Object.entries(legacy.files))check('pure: complete known generated legacy ownership '+key,()=>assert.equal(guard(cursor,generated,files[cursor]+'\n<!-- leerness:migration-preserved -->\n## Preserved owner text\n'),false));
}
if(process.argv.includes('--cli')||process.argv.includes('--cli-only')){
  const arena=fs.mkdtempSync(path.join(os.tmpdir(),'lr-policy-')),entry=path.resolve(__dirname,'../bin/leerness.js');
  const env={...process.env,LEERNESS_OFFLINE:'1',LEERNESS_NO_AUTOCHCP:'1'};
  for(const key of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP']){env[key]=path.join(arena,key.toLowerCase());fs.mkdirSync(env[key]);}
  const install=verb=>[verb,'.','--yes','--no-setup-agents','--no-mcp','--no-auto-roadmap','--no-official-skills','--no-banner','--language','en'];
  function call(root,args){const t=performance.now(),r=cp.spawnSync(process.execPath,[entry,...args],{cwd:root,env,encoding:'utf8',timeout:300000,windowsHide:true,maxBuffer:4*1024*1024});executions.push({root,args,status:r.status,error:r.error?.code||null,signal:r.signal,ms:performance.now()-t,stdout:r.stdout,stderr:r.stderr});assert.equal(r.error,undefined);assert.equal(r.signal,null);return r;}
  function project(name){const root=path.join(arena,name);fs.mkdirSync(root);fs.writeFileSync(path.join(root,'package.json'),'{"name":"isolated-owner-policy","version":"1.0.0"}\n');const r=call(root,install('init'));assert.equal(r.status,0,r.stdout+r.stderr);return root;}
  function snapshot(root,names){return Object.fromEntries(names.map(name=>[name,hash(fs.readFileSync(path.join(root,name)))]));}
  function backups(root,file,original){const archive=path.join(root,'.leerness/archive');return fs.readdirSync(archive).map(name=>path.join(archive,name,'files',file)).filter(file=>fs.existsSync(file)&&fs.lstatSync(file).isFile()&&fs.readFileSync(file).equals(original)).map(file=>({path:file,sha256:hash(fs.readFileSync(file))}));}
  const protectedNames=['.leerness/rules.md','.leerness/progress-tracker.md','.leerness/session-handoff.md'];
  check('CLI: owner Cursor header stays first and byte exact across migration and repeat',()=>{
    const root=project('custom-header'),target=path.join(root,cursor);
    const body=generated.slice(generated.indexOf('\n---\n')+5).replace(/\r?\n/g,'\r\n');
    const original=Buffer.from('\uFEFF'+customHeader+body+'\r\n'+payload,'utf8');fs.writeFileSync(target,original);
    const extra='.cursor/rules/owner-only.mdc',extraBytes=Buffer.from('---\ndescription: Separate owner file\nglobs: "private/**"\nalwaysApply: false\n---\nNever alter this independent rule.\n');fs.writeFileSync(path.join(root,extra),extraBytes);
    for(const name of ['AGENTS.md','CLAUDE.md','.github/copilot-instructions.md'])fs.appendFileSync(path.join(root,name),'\n## Owner mixed-policy fixture\n\n'+payload.replace(/\r\n/g,'\n'));
    fs.appendFileSync(path.join(root,'.leerness/rules.md'),'\n## Explicit owner exception\nPreserve customer source and scoped policy.\n');
    const state=snapshot(root,protectedNames);fs.writeFileSync(path.join(root,'.leerness/HARNESS_VERSION'),'1.36.289\n');
    inputs.header={root,originalSha256:hash(original),originalHeaderSha256:hash(customHeader),separateRuleSha256:hash(extraBytes),protectedBefore:state};
    let r=call(root,install('migrate'));assert.equal(r.status,0,r.stdout+r.stderr);
    inputs.header.backups=backups(root,cursor,original);assert(inputs.header.backups.length,'exact original Cursor backup missing');
    const after=fs.readFileSync(target);inputs.header.afterSha256=hash(after);assert.deepEqual(after,original,'active first frontmatter or owner body changed');
    assert.deepEqual(fs.readFileSync(path.join(root,extra)),extraBytes);assert.deepEqual(snapshot(root,protectedNames),state);
    for(const name of ['AGENTS.md','CLAUDE.md','.github/copilot-instructions.md'])assert.equal(count(fs.readFileSync(path.join(root,name),'utf8'),payload.replace(/\r\n/g,'\n')),1);
    r=call(root,install('migrate'));assert.equal(r.status,0,r.stdout+r.stderr);assert.deepEqual(fs.readFileSync(target),original);assert.deepEqual(snapshot(root,protectedNames),state);
    inputs.header.repeatSha256=hash(fs.readFileSync(target));
  });
  check('CLI: unknown headerless owner Cursor policy is preserved instead of receiving new scope',()=>{
    const root=project('unknown-owner'),target=path.join(root,cursor),original=Buffer.from('# Owner-created rule\n\nUse only after explicit project approval.\n\n'+payload.replace(/\r\n/g,'\n'));fs.writeFileSync(target,original);fs.writeFileSync(path.join(root,'.leerness/HARNESS_VERSION'),'1.36.289\n');inputs.unknown={root,originalSha256:hash(original)};
    let r=call(root,install('migrate'));assert.equal(r.status,0,r.stdout+r.stderr);inputs.unknown.backups=backups(root,cursor,original);assert(inputs.unknown.backups.length);assert.deepEqual(fs.readFileSync(target),original);
    r=call(root,install('migrate'));assert.equal(r.status,0,r.stdout+r.stderr);assert.deepEqual(fs.readFileSync(target),original);
  });
  check('CLI: known generated legacy Cursor rule still refreshes with authored tail retained',()=>{
    const root=project('known-canonical'),target=path.join(root,cursor),legacy=require('./fixtures/legacy-guidance-1.36.289.json').files['ko-standard'][cursor];
    const original=Buffer.from(legacy+'\n<!-- leerness:migration-preserved -->\n## Preserved owner text\nOwner suffix remains exact.\n');fs.writeFileSync(target,original);fs.writeFileSync(path.join(root,'.leerness/HARNESS_VERSION'),'1.36.289\n');inputs.canonical={root,originalSha256:hash(original)};
    let r=call(root,install('migrate'));assert.equal(r.status,0,r.stdout+r.stderr);const after=fs.readFileSync(target,'utf8');assert(after.startsWith(generated.trimEnd()),'known generated current prefix was not refreshed');assert(after.includes('Owner suffix remains exact.'));inputs.canonical.backups=backups(root,cursor,original);assert(inputs.canonical.backups.length);inputs.canonical.afterSha256=hash(after);
    r=call(root,install('migrate'));assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(fs.readFileSync(target,'utf8'),after);
  });
  check('CLI: partial failure preserves owner policy, independent rule and malformed source backup',()=>{
    const root=project('partial'),target=path.join(root,cursor),original=Buffer.from(customHeader+payload),readme=path.join(root,'README.md'),invalid=Buffer.from([0xff]);fs.writeFileSync(target,original);fs.writeFileSync(readme,invalid);fs.writeFileSync(path.join(root,'.leerness/HARNESS_VERSION'),'1.36.289\n');const before=snapshot(root,protectedNames);inputs.partial={root,originalSha256:hash(original),readmeSha256:hash(invalid),protectedBefore:before};
    const r=call(root,install('migrate'));assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/README.md[\s\S]*not rolled back/);assert.deepEqual(fs.readFileSync(readme),invalid);inputs.partial.backups=backups(root,cursor,original);assert(inputs.partial.backups.length);assert.deepEqual(fs.readFileSync(target),original);assert.deepEqual(snapshot(root,protectedNames),before);
  });
  fs.writeFileSync(path.join(arena,'execution.json'),JSON.stringify({node:process.version,platform:process.platform,arenaRetained:arena,inputs,executions,records,externalCursorRuntime:'not_run'},null,2)+'\n');console.log('CLI retained evidence: '+arena);
}
const passed=records.filter(row=>row.passed).length;console.log('cursor-policy: '+passed+'/'+records.length+' passed');if(passed!==records.length)process.exitCode=1;
