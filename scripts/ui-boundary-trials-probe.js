'use strict';
const assert=require('node:assert/strict');
const {summarizeUiBoundaryTrials:measure,UiBoundaryTrialError,INPUT_SCHEMA}=require('../lib/ui-boundary-trials');
const {POLICY_VERSION,TAXONOMY}=require('../lib/ui-boundary');
const sha='sha256:'+'a'.repeat(64),sha2='sha256:'+'b'.repeat(64);
const obs=(findings=0,state='observed')=>({state,findings:['stale','failed'].includes(state)?null:findings,digest:['stale','failed'].includes(state)?null:sha});
const trial=(id='sample',expected='leakage',findings=1)=>({id,expected,subtype:expected==='leakage'?TAXONOMY.debug_metadata:null,before:obs(findings),after:null,repair:null});
const packet=(trials=[trial()])=>({schema:INPUT_SCHEMA,policyVersion:POLICY_VERSION,fixtureDigest:sha,trials});
const run=value=>measure(JSON.stringify(value));
const tests=[];const test=(name,fn)=>tests.push({name,fn});
const repaired=(t,after=obs(),elapsedMs=10)=>({...t,after:{...after,digest:after.digest?sha2:null},repair:{kind:'fixture-repair',attempts:1,elapsedMs}});
test('duplicate observations are one scenario detection',()=>{const r=run(packet([trial('a','leakage',20)]));assert.equal(r.matrix.tp,1);assert.equal(r.trialCount,1);});
test('confusion matrix and explicit denominators',()=>{
 const r=run(packet([trial('a','leakage',2),trial('b','leakage',0),trial('c','allowed',1),trial('d','allowed',0)]));
 assert.deepEqual(r.matrix,{tp:1,fp:1,tn:1,fn:1,unscored:0});assert.deepEqual(r.rates,{precision:.5,recall:.5,falsePositiveRate:.5});
});
for(const state of ['partial','stale','failed'])test(state+' excluded not treated as a negative',()=>{
 const t=trial();t.before=obs(0,state);const r=run(packet([t]));assert.equal(r.matrix.unscored,1);assert.equal(r.matrix.fn,0);
 assert.deepEqual(r.rates,{precision:null,recall:null,falsePositiveRate:null});
});
test('empty denominator stays unknown',()=>{const r=run(packet([trial('allowed','allowed',0)]));assert.equal(r.rates.recall,null);assert.equal(r.repairs.candidateRemovalRate,null);});
test('five subtype grouping',()=>{
 const r=run(packet(Object.values(TAXONOMY).map((subtype,i)=>({...trial('type-'+i),subtype}))));
 assert.equal(Object.keys(r.bySubtype).length,5);assert.ok(Object.values(r.bySubtype).every(x=>x.detected===1));
});
test('missed leak not counted as candidate removal',()=>{const r=run(packet([repaired(trial('miss','leakage',0))]));assert.equal(r.matrix.fn,1);assert.equal(r.repairs.trials,1);assert.equal(r.repairs.eligibleDetectedTrials,0);assert.equal(r.repairs.candidateRemovalRate,null);});
test('detected candidate cleared',()=>{const r=run(packet([repaired(trial())]));assert.equal(r.repairs.candidateRemovalRate,1);assert.equal(r.repairs.candidatesCleared,1);});
test('candidate still present after repair',()=>{const r=run(packet([repaired(trial(),obs(2))]));assert.equal(r.repairs.candidateRemovalRate,0);assert.equal(r.repairs.stillCandidates,1);});
test('partial after excluded from repair rate',()=>{const r=run(packet([repaired(trial(),obs(0,'partial'))]));assert.equal(r.repairs.unscoredAfter,1);assert.equal(r.repairs.candidateRemovalRate,null);});
test('unknown timing not fabricated zero',()=>{
 const r=run(packet([repaired(trial('a'),obs(),null),repaired(trial('b'),obs(),10)]));
 assert.equal(r.repairs.elapsedMs,10);assert.equal(r.repairs.unknownTimingTrials,1);assert.equal(r.repairs.knownTimingTrials,1);
});
test('multiple repair attempts measured separately',()=>{const t=repaired(trial());t.repair.attempts=3;assert.equal(run(packet([t])).repairs.attempts,3);});
test('no evidence or approval promotion',()=>{
 const r=run(packet());assert.equal(r.verification.labelsVerified,false);assert.equal(r.verification.observationProvenanceVerified,false);
 assert.equal(r.verification.semanticFixVerified,false);assert.equal(r.verification.independentReview,'not-run');
 assert.ok(Object.values(r.effects).every(v=>v===false));assert.equal(r.basis,'host-labelled-fixture-trials');
});
for(const [name,mutate] of [
 ['wrong schema',p=>p.schema='wrong'],['wrong policy',p=>p.policyVersion='wrong'],['extra field',p=>p.extra='PRIVATE_ERROR'],
 ['digest object',p=>p.fixtureDigest=[sha]],['empty trials',p=>p.trials=[]],['too many trials',p=>p.trials=Array(129).fill(trial())],
 ['duplicate id',p=>p.trials.push(trial())],['bad id',p=>p.trials[0].id='../PRIVATE_ERROR'],
 ['missing subtype',p=>p.trials[0].subtype=null],['wrong subtype',p=>p.trials[0].subtype='wrong'],
 ['allowed with subtype',p=>p.trials[0].expected='allowed'],['negative count',p=>p.trials[0].before.findings=-1],
 ['fraction count',p=>p.trials[0].before.findings=.5],['too large count',p=>p.trials[0].before.findings=4097],
 ['observed missing digest',p=>p.trials[0].before.digest=null],['observed array digest',p=>p.trials[0].before.digest=[sha]],
 ['stale fake count',p=>p.trials[0].before.state='stale'],['bad state',p=>p.trials[0].before.state='clean'],
 ['after without repair',p=>p.trials[0].after=obs()],['repair without after',p=>p.trials[0].repair={kind:'fixture-repair',attempts:1,elapsedMs:1}],
 ['real product fix claim',p=>{p.trials[0]=repaired(trial());p.trials[0].repair.kind='product-fix';}],
 ['negative timing',p=>{p.trials[0]=repaired(trial());p.trials[0].repair.elapsedMs=-1;}],
 ['fraction timing',p=>{p.trials[0]=repaired(trial());p.trials[0].repair.elapsedMs=.5;}],
 ['no attempts',p=>{p.trials[0]=repaired(trial());p.trials[0].repair.attempts=0;}],
 ['allowed repair',p=>{p.trials[0]=repaired(trial('a','allowed',0));}],
]) test('reject '+name,()=>{const p=packet();mutate(p);assert.throws(()=>run(p),e=>e instanceof UiBoundaryTrialError&&!String(e).includes('PRIVATE_ERROR'));});
test('strict JSON duplicate keys',()=>assert.throws(()=>measure(JSON.stringify(packet()).replace('"schema":','"schema":0,"schema":')),UiBoundaryTrialError));
test('reject nonserialized input',()=>assert.throws(()=>measure(packet()),UiBoundaryTrialError));
let passed=0;
for(const {name,fn} of tests){try{fn();passed++;console.log('PASS '+name);}catch(e){console.error('FAIL '+name+': '+e.stack);}}
console.log(`ui-boundary trials: ${passed}/${tests.length} passed`);
if(passed!==tests.length)process.exitCode=1;
