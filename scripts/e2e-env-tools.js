'use strict';
const fs=require('node:fs'),path=require('node:path');
function create(root,base=process.env){
 const bin=path.join(fs.realpathSync.native(root),'fixture-tools');fs.mkdirSync(bin);
 const marker=path.join(bin,'observed.txt'),versions={npm:'fixture-npm-1.0.0',python:'fixture-python-1.0.0'};
 const body=name=>`require('fs').appendFileSync(${JSON.stringify(marker)},${JSON.stringify(name+'\n')});console.log(${JSON.stringify(versions[name])});\n`;
 const executable=(name,source)=>{const file=path.join(bin,name);fs.writeFileSync(file,`#!/usr/bin/env node\n${source}`);fs.chmodSync(file,0o755);};
 fs.writeFileSync(path.join(bin,'npm-cli.js'),body('npm'));fs.writeFileSync(path.join(bin,'python.js'),body('python'));
 if(process.platform==='win32')fs.writeFileSync(path.join(bin,'python.cmd'),'@ECHO off\r\n"%dp0%\\python.js" %*\r\n');
 else{
  fs.symlinkSync(process.execPath,path.join(bin,'node'));
  executable('npm',body('npm'));executable('python',body('python'));
  executable('which',`const n=process.argv[2];if(!['npm','python'].includes(n))process.exit(1);console.log(require('path').join(__dirname,n));\n`);
 }
 const env={};for(const [key,value]of Object.entries(base))if(!/^(path|pathext|npm_.*)$/i.test(key))env[key]=value;
 Object.assign(env,{PATH:bin,PATHEXT:'.EXE;.CMD',npm_execpath:path.join(bin,'npm-cli.js')});
 const seen=()=>fs.existsSync(marker)?fs.readFileSync(marker,'utf8').trim().split('\n'):[];
 return {env,bin,marker,versions,checkpoint:()=>seen().length,verify(data,since=0){const tools=data?.snapshot?.tools,events=seen().slice(since);return data?.snapshot?.node?.version===process.version&&Object.keys(tools||{}).sort().join(',')==='npm,python'&&Object.keys(versions).every(name=>tools[name]?.version===versions[name]&&events.includes(name));}};
}
module.exports={create};
