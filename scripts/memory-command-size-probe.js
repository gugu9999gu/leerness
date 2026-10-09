'use strict';
const { assert, test, finish, options, row } = require('./memory-write-budget-support');
const { measureParsedMemoryJson } = require('../lib/memory-json-size');
const { renderLosslessArchiveEntries } = require('../lib/memory-archive');
for(const s of ['decisions','lessons']) {
  for(const extra of [null,[],{},'"\\\n\t한🙂\ud800',1e100,{ nested: [true,false,null,{ '\u0000': 'x' }] },{ '__proto__': 'text', number: -0 }]) {
    const entries=JSON.parse(JSON.stringify([{...row(s,'base'),extension:extra}]));
    const compact=Buffer.byteLength(JSON.stringify(entries)),pretty=Buffer.byteLength(JSON.stringify(entries,null,2)+'\n');
    test(s+': pre-stringify exact compact/pretty boundary '+JSON.stringify(extra),()=>{
      const limits={...options().candidate,maxInputBytes:compact,maxCanonicalBytes:pretty};
      assert.equal(measureParsedMemoryJson(entries,limits,true).canonicalBytes,pretty);
      assert.throws(()=>measureParsedMemoryJson(entries,{...limits,maxInputBytes:compact-1},true),e=>e.code==='input_bytes_exceeded');
      assert.throws(()=>measureParsedMemoryJson(entries,{...limits,maxCanonicalBytes:pretty-1},true),e=>e.code==='canonical_bytes_exceeded');
    });
  }
  test(s+': empty array and nested container depth boundaries',()=>{
    const limits=options().candidate;
    measureParsedMemoryJson([],{...limits,maxDepth:1,maxInputBytes:2,maxCanonicalBytes:3},true);
    assert.throws(()=>measureParsedMemoryJson([],{...limits,maxDepth:0},true),e=>e.code==='depth_exceeded');
    const entries=[{...row(s),extension:{nested:[]}}];
    measureParsedMemoryJson(entries,{...limits,maxDepth:4},true);
    assert.throws(()=>measureParsedMemoryJson(entries,{...limits,maxDepth:3},true),e=>e.code==='depth_exceeded');
  });
  test(s+': lossless archive exact byte boundary and unchanged format',()=>{
    const entries=[row(s,'one'),row(s,'two한🙂')],text=renderLosslessArchiveEntries(s,entries),bytes=Buffer.byteLength(text);
    assert.equal(renderLosslessArchiveEntries(s,entries,bytes),text);
    assert.throws(()=>renderLosslessArchiveEntries(s,entries,bytes-1),e=>e.code==='archive_input_bytes_exceeded');
  });
}
finish('memory command size');
