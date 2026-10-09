'use strict';
const { assert, fs, path, test, project, snapshot, finish, row, render, fixture, inspect,
  metadata, failed, limits, options, inspectMemoryWriteBudget } = require('./memory-write-budget-support');
const { measurePublicationCost } = require('../lib/memory-write-budget-plan');
const emptyProject = () => project({ HARNESS_VERSION: require('../package.json').version });
const put = (p,s,suffix,data) => fs.writeFileSync(path.join(p,'.leerness',s+suffix),data);
for (const s of ['decisions','lessons']) {
  test(s + ': source, suffix, candidate, archive and shared recovery; read only', () => {
    const source = [row(s)], candidate = [...source,{ ...row(s,'new'), extension: { z: [1,null,'🙂'], missing: -0 } }];
    const suffix = '\r\nPRIVATE 한🙂\0\ufeff\n', p = fixture(s,source,suffix);
    const recovery = path.join(p,'.leerness/archive/mutation-recovery/unmanifested.bin');
    fs.mkdirSync(path.dirname(recovery),{ recursive: true }); fs.writeFileSync(recovery,'1234567');
    const before = snapshot(p), r = inspect(p,s,candidate); metadata(r); assert(r.ok,JSON.stringify(r));
    assert.deepEqual(snapshot(p),before); const m = r.measurement;
    assert.equal(m.suffixBytes,Buffer.byteLength(suffix)); assert.equal(m.observed.recovery.bytes,7);
    assert.equal(m.next.canonical,Buffer.byteLength(JSON.stringify(candidate,null,2)+'\n'));
    assert.equal(m.next.projection,Buffer.byteLength(render(s,candidate)+suffix));
    assert.equal(m.next.archive,m.observed.files.archive.bytes);
    assert.equal(m.finalPathBytes,m.next.canonical+m.next.projection+m.next.archive+7);
    const a = m.observed.totalPathBytes;
    const b = a - m.observed.files.canonical.bytes + m.next.canonical;
    const aliases = process.platform === 'win32' ? 1 : 2;
    assert.equal(m.normalPeakPathBytes,Math.max(a,a+aliases*m.next.canonical,b+aliases*m.next.projection));
    assert(r.filesRechecked && r.sourceContentValidated && r.recoveryMetadataRechecked);
  });
  test(s + ': absent targets count temporary alias twice; empty existing targets once', () => {
    const p = emptyProject(), r = inspect(p,s,[]); assert(r.ok); const m = r.measurement;
    assert.equal(m.stages[0].peakPathBytes,6);
    assert.equal(m.stages[1].peakPathBytes,3+2*Buffer.byteLength(render(s,[])));
    const q = fixture(s,[],'',{ [s+'.md']: '' }); failed(inspect(q,s,[]),'projection_diverged');
  });
  for (const kind of ['drop','restore']) test(s + ': ' + kind + ' explicit archive costs and order', () => {
    const p = fixture(s), op = { kind, archiveText: '한🙂\r\n' }, r = inspect(p,s,[],op); assert(r.ok);
    const m = r.measurement;
    assert.equal(m.next.archive,Buffer.byteLength(op.archiveText)+(kind==='drop'?m.observed.files.archive.bytes:0));
    assert.deepEqual(m.stages.map(x=>x.role),kind==='drop'?['archive','canonical','projection']:['canonical','projection','archive']);
    assert.equal(m.finalPathBytes,Object.values(m.next).reduce((a,b)=>a+b,0));
  });
  test(s + ': drop to absent archive includes prepared alias, empty archive is present', () => {
    const p = fixture(s), f = path.join(p,'.leerness',s+'.archive.md'); fs.unlinkSync(f);
    const op = {kind:'drop',archiveText:'hello'}, a = inspect(p,s,[],op).measurement;
    assert.equal(a.stages[0].peakPathBytes,a.observed.totalPathBytes+10);
    fs.writeFileSync(f,''); const b = inspect(p,s,[],op).measurement;
    assert.equal(b.stages[0].peakPathBytes,b.observed.totalPathBytes+(process.platform==='win32'?5:10));
  });
  for (const [name,mutate,code,phase] of [
    ['invalid UTF8',p=>put(p,s,'.json',Buffer.from([0xff])),'utf8_invalid','source'],
    ['invalid JSON',p=>put(p,s,'.json','['),'json_invalid','source'],
    ['nonarray',p=>put(p,s,'.json','{}'),'array_required','source'],
    ['bad item',p=>put(p,s,'.json','[null]'),'item_unsupported','source'],
    ['edited prefix',p=>put(p,s,'.md','PRIVATE'),'projection_diverged','projection'],
    ['projection BOM',p=>put(p,s,'.md','\ufeff'+render(s,[row(s)])),'projection_diverged','projection'],
    ['invalid projection UTF8',p=>put(p,s,'.md',Buffer.from([0xff])),'utf8_invalid','projection'],
    ['legacy only',p=>fs.unlinkSync(path.join(p,'.leerness',s+'.json')),'legacy_migration_required','source']
  ]) test(s + ': refuses ' + name, () => { const p=fixture(s); mutate(p); const before=snapshot(p); failed(inspect(p,s),code,phase); assert.deepEqual(snapshot(p),before); });
  test(s + ': canonical BOM uses existing JSON decoder semantics; missing projection allowed', () => {
    const p=fixture(s); put(p,s,'.json','\ufeff'+JSON.stringify([row(s)])); assert(inspect(p,s).ok);
    fs.unlinkSync(path.join(p,'.leerness',s+'.md')); const r=inspect(p,s); assert(r.ok); assert.equal(r.measurement.suffixBytes,0);
  });
  test(s + ': restore requires present decodable archive; raw append preserves invalid bytes', () => {
    const p=fixture(s), op={kind:'restore',archiveText:''}; put(p,s,'.archive.md',Buffer.from([0xff]));
    failed(inspect(p,s,[],op),'utf8_invalid','archive'); assert(inspect(p,s,[],{kind:'drop',archiveText:'x'}).ok);
    assert(inspect(p,s).ok); fs.unlinkSync(path.join(p,'.leerness',s+'.archive.md')); failed(inspect(p,s,[],op),'archive_absent');
  });
  for (const [key,select] of [['maxProjectionBytes',m=>m.next.projection],['maxArchiveBytes',m=>m.next.archive],
    ['maxFinalPathBytes',m=>m.finalPathBytes],['maxNormalPeakPathBytes',m=>m.normalPeakPathBytes]]) {
    for (const delta of [-1,0,1]) test(s + ': ' + key + ' boundary ' + delta, () => {
      const p=fixture(s), m=inspect(p,s).measurement, r=inspect(p,s,[],undefined,{operation:{[key]:select(m)+delta}});
      if(delta<0){ failed(r); assert.equal(r.disposition,'exceeded'); } else assert(r.ok,JSON.stringify(r));
    });
  }
  for (const group of ['source','candidate']) test(s + ': ' + group + ' budget has distinct phase', () => {
    const p=fixture(s), r=inspect(p,s,[row(s)],undefined,{[group]:{maxItems:0}}); failed(r,'items_exceeded',group);
  });
  test(s + ': archive input counts UTF8 and not UTF16 units', () => {
    const p=fixture(s), op={kind:'drop',archiveText:'한🙂'};
    failed(inspect(p,s,[],op,{operation:{maxArchiveInputBytes:6}}),'archive_input_bytes_exceeded');
    assert(inspect(p,s,[],op,{operation:{maxArchiveInputBytes:7}}).ok);
  });
  test(s + ': no-op/semantic relation is not inferred from supplied candidate', () => {
    const p=fixture(s), r=inspect(p,s,[row(s)]); assert(r.ok); assert.equal(r.measurement.stages.length,2);
    const arbitrary=inspect(p,s,[],{kind:'restore',archiveText:'caller replacement'}); assert(arbitrary.ok); metadata(arbitrary);
  });
}
for (const [label,mutate] of [
  ['missing group',x=>delete x.source],['extra group',x=>x.extra=0],['array group',x=>x.source=[]],
  ['missing limit',x=>delete x.operation.maxArchiveBytes],['negative',x=>x.candidate.maxItems=-1],
  ['fraction',x=>x.source.maxDepth=1.5],['over cap',x=>x.source.maxDepth=65],
  ['unsafe',x=>x.operation.maxFinalPathBytes=Number.MAX_SAFE_INTEGER+1],['unknown key',x=>x.observation.extra=0]
]) test('limits refuse '+label,()=>{const x=options();mutate(x);failed(inspectMemoryWriteBudget('absent','decisions','[]','{}',JSON.stringify(x)),'limits_invalid','limits');});
for(const op of [{kind:'update',archiveText:''},{kind:'drop',archiveText:null},{kind:'restore'},
  {kind:'__proto__',archiveText:null},{kind:'update',archiveText:null,extra:0},null,[]]) test('operation exact schema '+JSON.stringify(op),()=>{
  failed(inspectMemoryWriteBudget('absent','decisions','[]',JSON.stringify(op),JSON.stringify(limits)),'operation_invalid');
});
test('no object coercion or getter execution',()=>{
  let touched=0;const value={toString(){touched++;throw Error('PRIVATE');},get source(){touched++;throw Error('PRIVATE');}};
  const args=['absent','decisions','[]',JSON.stringify({kind:'update',archiveText:null}),JSON.stringify(limits)];
  for(let i=0;i<args.length;i++){const a=[...args];a[i]=value;failed(inspectMemoryWriteBudget(...a));}assert.equal(touched,0);
});
test('metadata sums refuse an exact-integer overflow',()=>{
  const observed={totalPathBytes:Number.MAX_SAFE_INTEGER,files:{canonical:{state:'absent',bytes:0},projection:{state:'absent',bytes:0},archive:{state:'absent',bytes:0}}};
  assert.throws(()=>measurePublicationCost(observed,{measurements:{canonicalBytes:3,projectionBytes:4}},0,{kind:'update',archiveText:null},limits.operation,'windows-replace'),e=>e.code==='size_unrepresentable');
});
for(const backend of ['windows-replace','posix-link'])test(backend+' accounts for its replacement publication aliases',()=>{
  const observed={totalPathBytes:30,files:{canonical:{state:'present',bytes:10},projection:{state:'present',bytes:20},archive:{state:'absent',bytes:0}}};
  const m=measurePublicationCost(observed,{measurements:{canonicalBytes:40,projectionBytes:50}},0,{kind:'update',archiveText:null},limits.operation,backend);
  assert.equal(m.normalPeakPathBytes,backend==='windows-replace'?110:160);assert.equal(m.finalPathBytes,90);
});
finish('memory write budget');
