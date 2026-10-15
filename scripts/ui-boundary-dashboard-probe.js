'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const dashboard=require('../lib/dashboard');
const browserApi=require('../lib/ui-boundary-browser');
const {summarizeUiBoundaryTrials,INPUT_SCHEMA:TRIAL_SCHEMA}=require('../lib/ui-boundary-trials');
const {POLICY_VERSION,TAXONOMY}=require('../lib/ui-boundary');
const {SCANNER_VERSION}=require('../lib/ui-boundary-scanner');
const {version}=require('../package.json');
const hash=value=>'sha256:'+crypto.createHash('sha256').update(value).digest('hex');
const key='gh'+'p_'+'a1B2c3D4'.repeat(5);
const cases=[
 {id:'normal-dashboard',expected:'allowed',subtype:null,text:null},
 {id:'technical-product-copy',expected:'allowed',subtype:null,text:'React OpenAI Claude Node.js · model: reviewer · status: running'},
 {id:'comment-explanation',expected:'allowed',subtype:null,text:'Learn about TODO: comments'},
 // An intentionally allowed quotation still matches the syntax scanner. This
 // records its false positive; it does not install a global copy allowlist.
 {id:'allowed-debug-quotation',expected:'allowed',subtype:null,text:'DEBUG: example of a diagnostic line'},
 {id:'spec-in-copy',expected:'leakage',subtype:TAXONOMY.specification,text:'화면 명세: 왼쪽에는 작업 목록을 배치한다.'},
 {id:'implementation-in-copy',expected:'leakage',subtype:TAXONOMY.implementation_instruction,text:'다음 단계에서 useEffect를 사용해 데이터를 연결하세요.'},
 {id:'criterion-in-copy',expected:'leakage',subtype:TAXONOMY.acceptance_criterion,text:'검수 조건: 모든 버튼은 상태별로 동작해야 한다.'},
 {id:'developer-note-in-copy',expected:'leakage',subtype:TAXONOMY.developer_note,text:'TODO: wire the production action'},
 {id:'debug-in-copy',expected:'leakage',subtype:TAXONOMY.debug_metadata,text:'DEBUG: internal event received'},
 {id:'security-in-copy',expected:'leakage',subtype:TAXONOMY.debug_metadata,text:key},
];
const candidateCount=r=>r.batches.reduce((sum,b)=>sum+b.scan.findings.length,0);
function record(r) {
 if(['observed','partial'].includes(r.status))return {state:r.status,findings:candidateCount(r),digest:r.observationDigest};
 return {state:r.status==='stale'?'stale':'failed',findings:null,digest:null};
}
function safeSummary(r) {
 return {status:r.status,scanStatus:r.scanStatus,observationDigest:r.observationDigest||null,
  surfaces:r.sources.length,coverage:r.coverage||null,omissions:r.omissions||null,
  findingObservations:candidateCount(r),findingTypes:r.batches.flatMap(b=>b.scan.findings).map(f=>({category:f.category,subtype:f.subtype}))};
}
const input=(maxSurfaces=2048)=>JSON.stringify({schema:browserApi.INPUT_SCHEMA,policyVersion:POLICY_VERSION,taskKind:'ui',maxSurfaces});

(async()=>{
 assert.ok(process.env.LEERNESS_TEST_PLAYWRIGHT,'LEERNESS_TEST_PLAYWRIGHT required');
 assert.ok(process.env.LEERNESS_TEST_BROWSER,'LEERNESS_TEST_BROWSER required');
 const {chromium}=require(process.env.LEERNESS_TEST_PLAYWRIGHT);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'leerness-uib05b-'));
 let browser;
 let passed=0,total=0;
 const test=async(name,fn)=>{total++;try{await fn();passed++;console.log('PASS '+name);}catch(e){console.error('FAIL '+name+': '+e.stack);}};
 try {
  fs.mkdirSync(path.join(temp,'.leerness'));
  const deps={VERSION:version,_roadmapData:()=>({tasks:[{id:'T-0001',status:'in-progress',request:'React 프로젝트 작업',updated:'2000-01-01'}],milestones:[]}),
   _loadToggles:()=>({}),_toggleRegistry:{'evidence-gate':{desc:'작업 증거 확인',affects:'task',defaultOff:true}}};
  const state=dashboard.snapshot(temp,deps);
  // Make only the synthetic fixture's environmental metadata reproducible.
  state.root='/fixture/leerness';state.generatedAt='2000-01-01T00:00:00.000Z';
  const html=dashboard.renderHtml(state);
  const fixtureDigest=hash(JSON.stringify(['leerness.dashboard-ui-trials/v1',POLICY_VERSION,SCANNER_VERSION,
   browserApi.OUTPUT_SCHEMA,2048,['dashboard','ui-boundary-scanner','ui-boundary-browser','ui-boundary-trials']
    .map(name=>hash(fs.readFileSync(require.resolve('../lib/'+name)))),html,cases]));
  browser=await chromium.launch({headless:true,executablePath:process.env.LEERNESS_TEST_BROWSER});
  const page=await browser.newPage();await page.route('**/*',r=>r.abort());
  const session=await page.context().newCDPSession(page);
  const scan=()=>browserApi.scanUiBoundaryBrowser(session,input());
  const trials=[];
  for(const c of cases)await test('dashboard scenario '+c.id,async()=>{
   await page.setContent(html);
   if(c.text!==null)await page.locator('h1').evaluate((node,text)=>{node.textContent=text;},c.text);
   const before=await scan();assert.equal(before.status,'observed');
   let after=null,repair=null;
   if(c.expected==='leakage') {
    const start=performance.now();
    await page.locator('h1').evaluate(node=>{node.textContent='leerness 대시보드';});
    after=record(await scan());repair={kind:'fixture-repair',attempts:1,elapsedMs:Math.ceil(performance.now()-start)};
    assert.equal(after.state,'observed');assert.equal(after.findings,0);
   }
   trials.push({id:c.id,expected:c.expected,subtype:c.subtype,before:record(before),after,repair});
  });
  await test('finite corpus exposes false positives and semantic misses',async()=>{
   assert.equal(trials.length,cases.length);
   const metrics=summarizeUiBoundaryTrials(JSON.stringify({schema:TRIAL_SCHEMA,policyVersion:POLICY_VERSION,fixtureDigest,trials}));
   assert.deepEqual(metrics.matrix,{tp:3,fp:1,tn:3,fn:3,unscored:0});
   assert.equal(metrics.rates.recall,.5);assert.equal(metrics.rates.precision,.75);assert.equal(metrics.rates.falsePositiveRate,.25);
   assert.equal(metrics.repairs.trials,6);assert.equal(metrics.repairs.eligibleDetectedTrials,3);assert.equal(metrics.repairs.candidatesCleared,3);
   assert.equal(metrics.repairs.candidateRemovalRate,1);assert.equal(metrics.repairs.knownTimingTrials,6);
   console.log(JSON.stringify({benchmark:'leerness.dashboard-ui-trials/v1',browserVersion:browser.version(),
    scannerVersion:SCANNER_VERSION,collectorSchema:browserApi.OUTPUT_SCHEMA,captureBudget:2048,fixtureDigest,metrics}));
  });
  await test('dashboard masks task secrets before render',async()=>{
   const s=dashboard.snapshot(temp,{...deps,_roadmapData:()=>({tasks:[{id:'T-0002',status:'requested',request:key}],milestones:[]})});
   const text=dashboard.renderHtml(s);assert.ok(!text.includes(key));await page.setContent(text);
   const r=await scan();assert.equal(r.status,'observed');assert.ok(!r.batches.some(b=>b.scan.findings.some(f=>f.category==='security')));
  });
  await test('dense dashboard requires explicit larger budget',async()=>{
   const s={...state,toggles:Array.from({length:72},(_,i)=>({id:'feature-'+i,on:false,defaultOff:false,desc:'기능 설정',affects:'task'}))};
   await page.setContent(dashboard.renderHtml(s));
   const narrow=await browserApi.scanUiBoundaryBrowser(session,input(512));
   const wide=await scan();assert.equal(narrow.status,'partial');assert.ok(narrow.omissions.surfaceLimit>0);
   assert.equal(wide.status,'observed');assert.equal(wide.omissions.surfaceLimit,0);assert.ok(wide.sources.length>512);
   assert.equal(narrow.observationDigest,wide.observationDigest);
   console.log(JSON.stringify({denseDashboard:{defaultBudget:safeSummary(narrow),explicitBudget:safeSummary(wide)}}));
  });
  await test('partial dashboard omitted from quality denominator',async()=>{
   const partial=await browserApi.scanUiBoundaryBrowser(session,input(1));assert.equal(partial.status,'partial');
   const r=summarizeUiBoundaryTrials(JSON.stringify({schema:TRIAL_SCHEMA,policyVersion:POLICY_VERSION,fixtureDigest,
    trials:[{id:'partial',expected:'allowed',subtype:null,before:record(partial),after:null,repair:null}]}));
   assert.equal(r.matrix.unscored,1);assert.equal(r.rates.falsePositiveRate,null);
  });
  await test('read-only fixture store preserved',async()=>{
   assert.deepEqual(fs.readdirSync(temp),['.leerness']);assert.deepEqual(fs.readdirSync(path.join(temp,'.leerness')),[]);
  });
  const targetAt=process.argv.indexOf('--root');
  if(targetAt>=0)await test('explicit actual project dashboard capture',async()=>{
   const target=process.argv[targetAt+1];assert.ok(target&&path.isAbsolute(target),'absolute --root required');
   let live;
   try{live=JSON.parse(cp.execFileSync(process.execPath,[path.resolve(__dirname,'../bin/leerness.js'),'dashboard',target,'--json'],
    {cwd:target,encoding:'utf8',maxBuffer:8*1024*1024,timeout:30000,windowsHide:true}));}
   catch{throw new Error('dashboard_cli_failed');}
   assert.equal(live.readOnly,true);await page.setContent(dashboard.renderHtml(live));
   const r=await scan();assert.equal(r.status,'observed');assert.equal(r.omissions.surfaceLimit,0);
   // Real project text has no independent ground truth in this test. Do not
   // silently add it as a true negative to the labelled fixture corpus.
   console.log(JSON.stringify({actualDashboard:{...safeSummary(r),labels:'unadjudicated',includedInQualityRates:false}}));
  });
  console.log(`ui-boundary dashboard: ${passed}/${total} passed`);if(passed!==total)process.exitCode=1;
 } finally {
  if(browser)await browser.close();
  const resolved=path.resolve(temp),parent=path.resolve(os.tmpdir());
  assert.equal(path.dirname(resolved),parent);assert.ok(path.basename(resolved).startsWith('leerness-uib05b-'));
  fs.rmSync(resolved,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
