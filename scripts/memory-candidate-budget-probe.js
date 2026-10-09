'use strict';
const assert = require('assert');
const { assessMemoryCandidateBudget: assess, MemoryBudgetInputError } = require('../lib/memory-candidate-budget');
const { _renderDecisionsMd, _renderLessonsMd } = require('../lib/pure-utils');
const base = { maxInputBytes:1000000,maxItems:10000,maxItemBytes:1000000,maxCanonicalBytes:4000000,maxProjectionBytes:4000000,maxDepth:64,maxNodes:100000 };
const limits = patch => JSON.stringify({...base,...patch});
const render = (s,rows) => s==='decisions'?_renderDecisionsMd(rows):_renderLessonsMd(rows);
const row = s => s==='decisions'?{date:'2026-09-13',title:'title',decision:'decision',reason:null,alternatives:null,impact:null}:{date:'2026-09-13',text:'lesson',tag:null};
let count=0,failed=0;
function test(name,fn) {count++;try{fn();console.log('PASS '+name)}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack)}}
function measured(surface,text,patch={}) {
  const r=assess(surface,text,limits(patch));assert.equal(r.disposition,'within-declared-budget',JSON.stringify(r));
  const rows=JSON.parse(text),m=r.measurements;
  assert.equal(m.canonicalBytes,Buffer.byteLength(JSON.stringify(rows,null,2)+'\n'));
  assert.equal(m.projectionBytes,Buffer.byteLength(render(surface,rows)));
  assert.equal(m.maxItemBytes,rows.length?Math.max(...rows.map(v=>Buffer.byteLength(JSON.stringify(v)))):0);
  assert.equal(r.inputBytes,Buffer.byteLength(text));assert.equal(r.itemCount,rows.length);
  assert.equal(r.sourceVerified,false);assert.equal(r.approvalGranted,false);assert.equal(r.writesPerformed,false);assert.equal(r.retentionBytes,null);
  return r;
}
function reject(surface,text,patch,code) {const r=assess(surface,text,limits(patch));assert.equal(r.reasonCodes[0],code,JSON.stringify(r));assert.equal(r.measurements,null);return r;}
for(const surface of ['decisions','lessons']) {
  for(const [name,rows] of [['empty',[]],['empty record',[{}]],['normal',[row(surface)]],['null and missing',[{},Object.fromEntries(Object.keys(row(surface)).map(k=>[k,null]))]],
    ['extensions',[{...row(surface),extension:{array:[{},[],null,true,false,1,-0,1e-7,1e21,{nested:'가🙂'}]}}]],
    ['dangerous key names',[JSON.parse('{"__proto__":{"polluted":true},"constructor":0,"toJSON":null}')]]]) {
    test(surface+' exact '+name,()=>measured(surface,JSON.stringify(rows)));
  }
  test(surface+' all control escapes and surrogates',()=>{
    const value=Array.from({length:160},(_,i)=>String.fromCharCode(i)).join('')+'\r\n"\\🙂\ud800x\udfff\u2028\u2029';
    const r=row(surface);for(const field of Object.keys(r))r[field]=value;measured(surface,JSON.stringify([r]));
  });
  test(surface+' raw numeric normalization matches writer semantics',()=>measured(surface,'[{"extension":[-0,1e999,-1e999,9007199254740993,1.234567890123456789]}]'));
  test(surface+' UTF8 whitespace and pretty source input size',()=>measured(surface,' \r\n'+JSON.stringify([row(surface)],null,4)+'\t'));
  test(surface+' shared logical duplicates keep their count and order',()=>{const r=row(surface);measured(surface,JSON.stringify([r,r,r]));});
  const text=JSON.stringify([{...row(surface),extension:{key:['a','b',{more:null}]}}]);
  const exact=measured(surface,text),m=exact.measurements;
  for(const [key,value,code] of [['maxInputBytes',exact.inputBytes,'input_bytes_exceeded'],['maxItems',exact.itemCount,'items_exceeded'],
    ['maxItemBytes',m.maxItemBytes,'item_bytes_exceeded'],['maxCanonicalBytes',m.canonicalBytes,'canonical_bytes_exceeded'],
    ['maxProjectionBytes',m.projectionBytes,'projection_bytes_exceeded'],['maxDepth',m.depth,'depth_exceeded'],['maxNodes',m.nodeCount,'nodes_exceeded']]) {
    test(surface+' '+key+' limit-1/equal/+1',()=>{
      reject(surface,text,{[key]:value-1},code);measured(surface,text,{[key]:value});measured(surface,text,{[key]:value+1});
    });
  }
  test(surface+' huge string input uses the cheap pre-parse rejection',()=>{const r=reject(surface,'x'.repeat(10000),{maxInputBytes:10},'input_bytes_exceeded');assert.equal(r.inputBytes,null)});
  test(surface+' multibyte input exceeds bytes without exceeding code units',()=>{const text='[{"extra":"가"}]';const r=reject(surface,text,{maxInputBytes:text.length},'input_bytes_exceeded');assert.equal(r.inputBytes,Buffer.byteLength(text))});
  test(surface+' large per-item string over limit is refused',()=>reject(surface,JSON.stringify([{extra:'a'.repeat(100000)}]),{maxItemBytes:100},'item_bytes_exceeded'));
  test(surface+' deep raw input is rejected before native recursive output',()=>reject(surface,'[{"extra":'+'['.repeat(20000)+'0'+']'.repeat(20000)+'}]',{},'depth_exceeded'));
  test(surface+' deep allowed input is counted without recursive stringify',()=>{
    const r=assess(surface,'[{"extra":'+'['.repeat(5000)+'0'+']'.repeat(5000)+'}]',limits({maxDepth:5002,maxNodes:5003,maxItemBytes:20000,maxCanonicalBytes:60000000}));
    assert.equal(r.disposition,'within-declared-budget');assert.equal(r.measurements.depth,5002);assert.equal(r.measurements.nodeCount,5003);
  });
  test(surface+' quoted delimiters and escaped quote do not add nesting',()=>measured(surface,'[{"extra":"[{}]\\\"\\\\["}]',{maxDepth:2}));
  for(const [name,text,code] of [['malformed','[{','json_invalid'],['BOM','\ufeff[]','json_invalid'],['scalar','null','array_required'],['object','{}','array_required']]) {
    test(surface+' '+name+' input unsupported',()=>reject(surface,text,{},code));
  }
  for(const value of [null,7,true,'private',[]])test(surface+' item '+JSON.stringify(value)+' unsupported',()=>reject(surface,JSON.stringify([value]),{},'item_unsupported'));
  test(surface+' bad known field returns only fixed metadata',()=>{
    const field=surface==='decisions'?'reason':'tag',text=JSON.stringify([{...row(surface),[field]:{value:'PRIVATE_CONTENT_MARKER'}}]);
    const r=reject(surface,text,{},'item_unsupported');assert.equal(r.index,0);assert.equal(r.field,field);assert(!JSON.stringify(r).includes('PRIVATE_CONTENT_MARKER'));
  });
  test(surface+' prototype names do not change global prototypes',()=>{measured(surface,'[{"__proto__":{"polluted":true}}]');assert.equal({}.polluted,undefined)});
}
for(const key of Object.keys(base))test('budget '+key+' is required finite integer',()=>{
  for(const value of [-1,0.5,null,'10',true,{},[],1e99])assert.throws(()=>assess('lessons','[]',limits({[key]:value})),e=>e instanceof MemoryBudgetInputError&&e.code==='limits_invalid');
  const missing={...base};delete missing[key];assert.throws(()=>assess('lessons','[]',JSON.stringify(missing)),/limits_invalid/);
});
test('unknown budget field is rejected',()=>assert.throws(()=>assess('lessons','[]',limits({extra:1})),/limits_invalid/));
test('no implicit budget defaults',()=>assert.throws(()=>assess('lessons','[]'),/serialized_limits_required/));
test('object arguments never invoke getters or toString',()=>{let called=0;const x={get extra(){called++;throw new Error('no')},toString(){called++;throw new Error('no')}};assert.throws(()=>assess(x,'[]',limits()),/surface_unsupported/);assert.throws(()=>assess('lessons',x,limits()),/serialized_json_required/);assert.throws(()=>assess('lessons','[]',x),/serialized_limits_required/);assert.equal(called,0)});
test('limits envelope size has a fixed small guard',()=>assert.throws(()=>assess('lessons','[]',' '.repeat(2049)),/limits_envelope_too_large/));
test('malformed and nonobject limits are rejected',()=>{for(const s of ['{','null','[]','3'])assert.throws(()=>assess('lessons','[]',s),/limits_invalid/)});
test('caller JSON stays unchanged and report is metadata only',()=>{const text=JSON.stringify([{text:'PRIVATE_CONTENT_MARKER'}]),before=text;const r=measured('lessons',text);assert.equal(text,before);assert(!JSON.stringify(r).includes('PRIVATE_CONTENT_MARKER'));assert.equal(r.projectionScope,'generated-only')});
test('node and depth metrics have an independent small oracle',()=>{const r=measured('lessons','[{"x":[true,false,{"y":null}]}]');assert.equal(r.measurements.nodeCount,7);assert.equal(r.measurements.depth,4)});
let seed=321;
const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
function generated(depth) {
  const choice=random(depth?7:5);
  if(choice===0)return null;if(choice===1)return !!random(2);if(choice===2)return (random(20000)-10000)/7;
  if(choice===3)return '';if(choice===4)return ['가🙂','"\\\n\r\n','\ud800\u0000','brackets[{}]'][random(4)].repeat(random(10));
  if(choice===5)return Array.from({length:random(5)},()=>generated(depth-1));
  const obj={};for(let i=0;i<random(5);i++)obj['key'+i+'"가']=generated(depth-1);return obj;
}
for(const surface of ['decisions','lessons'])test(surface+' seeded 200-shape output oracle corpus',()=>{
  for(let i=0;i<200;i++)measured(surface,JSON.stringify(Array.from({length:random(6)},()=>({...row(surface),extra:generated(5)}))));
});
console.log(`memory candidate budget: ${count-failed}/${count} passed`);
if(failed)process.exitCode=1;
