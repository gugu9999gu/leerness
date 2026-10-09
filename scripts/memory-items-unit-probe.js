'use strict';
const {assertMemoryItems}=require('../lib/memory-items');
const assert=require('assert/strict');
const results=[];
function test(name,fn){try{fn();results.push(true);console.log('PASS '+name)}catch(e){results.push(false);console.error('FAIL '+name+'\n'+e.stack)}}
function rejects(surface,rows,index,field){assert.throws(()=>assertMemoryItems(surface,rows),e=>
  e.code==='E_STORE_ITEM_UNSUPPORTED'&&e.index===index&&e.field===field&&!e.message.includes('PRIVATE_VALUE'))}
const fields={decisions:['date','title','decision','reason','alternatives','impact'],lessons:['date','text','tag']};
for(const surface of Object.keys(fields)){
  for(const value of [null,0,false,'PRIVATE_VALUE',[]])test(surface+' rejects non-record '+JSON.stringify(value),()=>rejects(surface,[value],0,null));
  for(const field of fields[surface])for(const value of [0,false,[],{private:'PRIVATE_VALUE'},undefined]){
    test(surface+' rejects '+field+' as '+typeof value,()=>rejects(surface,[{}, {[field]:value}],1,field));
  }
  test(surface+' preserves missing/null/string fields and extension JSON values',()=>{
    const rows=[{},...['',null,'  whitespace\n한글  '].map(value=>Object.fromEntries(fields[surface].map(f=>[f,value]))),
      {extra:{items:[{},[],null,3,true,'private']}}];
    const before=JSON.stringify(rows);assert.equal(assertMemoryItems(surface,rows),rows);assert.equal(JSON.stringify(rows),before);
  });
  test(surface+' rejects accessors without evaluating them',()=>{
    let touched=false;const row={};Object.defineProperty(row,fields[surface][0],{get(){touched=true;return 'PRIVATE_VALUE'}});
    rejects(surface,[row],0,fields[surface][0]);assert.equal(touched,false);
  });
  test(surface+' rejects foreign prototypes and sparse items',()=>{
    rejects(surface,[Object.create({})],0,null);rejects(surface,Array(1),0,null);
    const row=Object.create(null);row.extra=[1];assert.equal(assertMemoryItems(surface,[row])[0],row);
  });
}
test('rejects unsupported surface without invoking conversions',()=>{
  let touched=false;const surface={toString(){touched=true;return 'decisions'}};
  rejects(surface,[],null,null);assert.equal(touched,false);
});
test('rejects non-array candidates without silently clearing the store',()=>{
  for(const value of [null,undefined,{},0,false,''])rejects('decisions',value,null,null);
});
console.log(`memory items unit: ${results.filter(Boolean).length}/${results.length} passed`);
if(results.some(ok=>!ok))process.exitCode=1;
