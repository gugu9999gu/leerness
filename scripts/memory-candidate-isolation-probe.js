'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const pure=require('../lib/pure-utils');
const names=['memory-candidate-budget','memory-json-size','memory-items','memory-migration-budget'];
const sources=Object.fromEntries(names.map(name=>[name,fs.readFileSync(path.join(__dirname,'../lib/'+name+'.js'),'utf8')]));
const base={maxInputBytes:1000000,maxItems:1000,maxItemBytes:1000000,maxCanonicalBytes:4000000,maxProjectionBytes:4000000,maxDepth:64,maxNodes:10000};
let count=0,failed=0;
function test(name,fn){count++;try{fn();console.log('PASS '+name)}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack)}}
function isolated(options={}){
  const calls={parse:0,preamble:0,normalizedFields:0,forbidden:0};
  const forbid=()=>{calls.forbidden++;throw new Error('Forbidden capability')};
  const sandbox={Object,Buffer,JSON:{parse(text){calls.parse++;if(calls.parse>1&&options.noSourceParse)forbid();return JSON.parse(text)},stringify:forbid}};
  for(const name of ['process','fetch','Date','setTimeout','setInterval','performance','console'])Object.defineProperty(sandbox,name,{get:forbid});
  const ctx=vm.createContext(sandbox),cache={};
  const renders=name=>rows=>{assert.equal(rows.length,0,'full candidate rendering is forbidden');calls.preamble++;return pure[name](rows)};
  const load=request=>{
    if(request==='./pure-utils')return {_lineSafe(value){calls.normalizedFields++;if(options.noProjection)forbid();return pure._lineSafe(value)},_renderDecisionsMd:renders('_renderDecisionsMd'),_renderLessonsMd:renders('_renderLessonsMd')};
    const name=request.replace(/^\.\//,'');if(!Object.hasOwn(sources,name))return forbid();
    if(cache[name])return cache[name].exports;
    const module={exports:{}};cache[name]=module;
    vm.runInContext('(function(require,module,exports){\n'+sources[name]+'\n})',ctx,{timeout:1000})(load,module,module.exports);
    return module.exports;
  };
  const api=load('./memory-candidate-budget');
  return {calls,run:(surface,text,patch={})=>api.assessMemoryCandidateBudget(surface,text,JSON.stringify({...base,...patch}))};
}
for(const surface of ['decisions','lessons']){
  test(surface+' successful assessment has no ambient I/O or whole output serialization',()=>{
    const x=isolated(),r=x.run(surface,'[{"extra":{"nested":[null,1,"a"]}}]');assert.equal(r.disposition,'within-declared-budget');assert.equal(x.calls.forbidden,0);assert.equal(x.calls.parse,2);assert.equal(x.calls.preamble,1);
  });
  test(surface+' over-input rejection never parses source',()=>{const x=isolated({noSourceParse:true});assert.equal(x.run(surface,'x'.repeat(100),{maxInputBytes:1}).reasonCodes[0],'input_bytes_exceeded');assert.equal(x.calls.parse,1);assert.equal(x.calls.forbidden,0)});
  test(surface+' over-depth rejection never parses source',()=>{const x=isolated({noSourceParse:true});assert.equal(x.run(surface,'[{"x":[[]]}]',{maxDepth:2}).reasonCodes[0],'depth_exceeded');assert.equal(x.calls.parse,1);assert.equal(x.calls.forbidden,0)});
  for(const [patch,reason] of [[{maxItems:0},'items_exceeded'],[{maxNodes:1},'nodes_exceeded'],[{maxItemBytes:1},'item_bytes_exceeded'],[{maxCanonicalBytes:2},'canonical_bytes_exceeded']]){
    test(surface+' '+reason+' precedes projection normalization',()=>{const x=isolated({noProjection:true});assert.equal(x.run(surface,'[{"title":"title","text":"text"}]',patch).reasonCodes[0],reason);assert.equal(x.calls.preamble,0);assert.equal(x.calls.forbidden,0)});
  }
  test(surface+' malformed known field precedes projection',()=>{const x=isolated({noProjection:true}),key=surface==='decisions'?'reason':'tag';assert.equal(x.run(surface,JSON.stringify([{[key]:{value:'private'}}])).reasonCodes[0],'item_unsupported');assert.equal(x.calls.preamble,0);assert.equal(x.calls.forbidden,0)});
  test(surface+' preamble-only output limit skips all fields',()=>{const x=isolated({noProjection:true});assert.equal(x.run(surface,'[{}]',{maxProjectionBytes:0}).reasonCodes[0],'projection_bytes_exceeded');assert.equal(x.calls.normalizedFields,0);assert.equal(x.calls.forbidden,0)});
}
console.log(`memory candidate isolation: ${count-failed}/${count} passed`);
if(failed)process.exitCode=1;
