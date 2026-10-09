'use strict';

const assert = require('node:assert/strict');
const { scanUiBoundaryBrowser: scan, UiBoundaryBrowserError, INPUT_SCHEMA, OUTPUT_SCHEMA,
  MAX_RESPONSE_BYTES, MAX_SURFACES } = require('../lib/ui-boundary-browser');
const { POLICY_VERSION } = require('../lib/ui-boundary');
const { validateUiBoundaryReview } = require('../lib/ui-boundary-contracts');
const cases = [];
const test = (name, run) => cases.push({ name, run });
const request = taskKind => JSON.stringify({ schema: INPUT_SCHEMA, policyVersion: POLICY_VERSION, taskKind: taskKind || 'ui' });
const key = 'gh' + 'p_' + 'a1B2c3D4'.repeat(5);
const findings = r => r.batches.flatMap(b => b.scan.findings);
function checks(r) {
  assert.equal(r.schema, OUTPUT_SCHEMA);
  assert.equal(r.verification.browserIdentityVerified, false);
  assert.equal(r.verification.visualCompletenessVerified, false);
  assert.equal(r.verification.semanticVerified, false);
  assert.equal(r.verification.independentReview, 'not-run');
  assert.ok(Object.values(r.effects).every(v => v === false));
  for (const b of r.batches) {
    assert.deepEqual(validateUiBoundaryReview(b.scan.review), b.scan.review);
    assert.equal(b.surfaceIndexes.length, b.scan.scannedSurfaces);
    for (const f of b.scan.findings) assert.ok(r.sources[b.surfaceIndexes[f.surfaceIndex]]);
  }
  const text = JSON.stringify(r);
  for (const raw of [key, 'PRIVATE_VALUE', 'PRIVATE_ERROR', 'TODO: wire', 'private.example']) assert.ok(!text.includes(raw));
}
function fixture(texts = ['TODO: wire']) {
  const strings = [], str = value => { let i = strings.indexOf(value); if (i < 0) { i = strings.length; strings.push(value); } return i; };
  const n = { nodeType: [9, 1], parentIndex: [-1, 0], nodeName: [str('#document'), str('BODY')],
    backendNodeId: [1, 2], attributes: [[], []] };
  const l = { nodeIndex: [0, 1], styles: [[], ['block','visible','1'].map(str)], bounds: [[0,0,800,600],[0,0,800,600]], text: [-1,-1] };
  const ax = { nodes: [{nodeId:'1', ignored:false, role:{value:'RootWebArea'}, backendDOMNodeId:1, name:{value:''}}] };
  for (const text of texts) {
    const p = n.nodeType.length;
    n.nodeType.push(1,3); n.parentIndex.push(1,p); n.nodeName.push(str('P'),str('#text'));
    n.backendNodeId.push(p+1,p+2); n.attributes.push([],[]);
    l.nodeIndex.push(p,p+1); l.styles.push(['block','visible','1'].map(str),['block','visible','1'].map(str));
    l.bounds.push([0,0,200,20],[0,0,200,20]); l.text.push(-1,str(text));
  }
  const dom = {strings,documents:[{frameId:str('fixture-frame'), nodes:n,layout:l}]};
  return {dom,ax,str};
}
function transport(f, alter) {
  const calls = [];
  return { calls, async send(method, params) {
    calls.push({method,params});
    if (alter) await alter(method, calls.length, f);
    assert.ok(['DOMSnapshot.captureSnapshot','Accessibility.getFullAXTree'].includes(method));
    return method.startsWith('DOMSnapshot') ? f.dom : f.ax;
  } };
}
async function rejects(fn, code) {
  await assert.rejects(fn, e => e instanceof UiBoundaryBrowserError && e.code === 'ui_boundary_browser_' + code
    && !String(e).includes('PRIVATE_ERROR'));
}
test('non UI never accesses session', async () => {
  const r = await scan(null, request('non-ui')); assert.equal(r.status,'not-applicable'); checks(r);
});
for (const value of [null, '{}', 'null', '[]', '{"schema":', request().replace('ui"','wrong"'),
  request().replace('"taskKind"','"extra":0,"taskKind"'), request().replace('"schema":','"schema":0,"schema":')]) {
  test('invalid input rejected before session use', () => rejects(() => scan(null,value),'input_invalid'));
}
test('missing session', () => rejects(() => scan(null,request()),'session_required'));
test('session accessor error is redacted', () => rejects(() => scan({get send(){throw new Error('PRIVATE_ERROR');}},request()),'session_required'));
test('transport failure is redacted', () => rejects(() => scan({send(){throw new Error('PRIVATE_ERROR');}},request()),'capture_failed'));
test('non JSON response', () => rejects(() => scan({send(){return undefined;}},request()),'response_invalid'));
test('response cap', () => rejects(() => scan({send(){return {padding:'a'.repeat(MAX_RESPONSE_BYTES)};}},request()),'response_limit'));
test('collect and scan four read commands', async () => {
  const s = transport(fixture()), r = await scan(s,request()); checks(r);
  assert.equal(r.status,'observed'); assert.equal(findings(r).length,1);
  assert.deepEqual(s.calls.map(c=>c.method), ['DOMSnapshot.captureSnapshot','Accessibility.getFullAXTree','DOMSnapshot.captureSnapshot','Accessibility.getFullAXTree']);
  assert.deepEqual(s.calls[0].params,{computedStyles:['display','visibility','opacity']});
});
test('stable observation digest', async () => {
  const a=await scan(transport(fixture()),request()), b=await scan(transport(fixture()),request());
  assert.equal(a.observationDigest,b.observationDigest);
});
test('unknown task keeps unknown applicability', async () => {
  const r=await scan(transport(fixture()),request('unknown')); assert.equal(r.batches[0].scan.applicability,'unknown');
});
test('normal technical copy', async () => {
  const r=await scan(transport(fixture(['React OpenAI Claude Node.js model: reviewer status: running'])),request());
  assert.equal(r.scanStatus,'no-pattern-match'); checks(r);
});
test('security uses existing catalog', async () => {
  const r=await scan(transport(fixture([key])),request()); assert.equal(findings(r)[0].category,'security'); checks(r);
});
test('more than 32 observations batched', async () => {
  const r=await scan(transport(fixture(Array(65).fill('DEBUG: candidate'))),request());
  assert.deepEqual(r.batches.map(b=>b.scan.scannedSurfaces),[32,32,1]); assert.equal(findings(r).length,65); checks(r);
});
test('escaped packet byte limit also splits batches', async () => {
  const r=await scan(transport(fixture(Array(32).fill('\u0001'.repeat(4000)))),request());
  assert.ok(r.batches.length>1); assert.equal(r.sources.length,32); checks(r);
});
test('oversized copy is partial not clean', async () => {
  const r=await scan(transport(fixture(['a'.repeat(4097)])),request());
  assert.equal(r.status,'partial'); assert.equal(r.omissions.textLimit,1); assert.equal(r.scanStatus,'no-surfaces');
});
test('unicode omission explicit', async () => {
  const r=await scan(transport(fixture(['\ud800'])),request()); assert.equal(r.status,'partial'); assert.equal(r.omissions.invalidUnicode,1);
});
test('surface count omission explicit', async () => {
  const r=await scan(transport(fixture(Array(MAX_SURFACES+1).fill('copy'))),request());
  assert.equal(r.status,'partial'); assert.equal(r.sources.length,MAX_SURFACES); assert.equal(r.omissions.surfaceLimit,1);
});
test('explicit bounded surface budget covers a larger document', async () => {
  const json=JSON.stringify({...JSON.parse(request()),maxSurfaces:900});
  const r=await scan(transport(fixture(Array(900).fill('copy'))),json);
  assert.equal(r.status,'observed');assert.equal(r.sources.length,900);assert.equal(r.omissions.surfaceLimit,0);checks(r);
});
test('explicit smaller budget remains partial', async () => {
  const r=await scan(transport(fixture(['a','b'])),JSON.stringify({...JSON.parse(request()),maxSurfaces:1}));
  assert.equal(r.status,'partial');assert.equal(r.sources.length,1);assert.equal(r.omissions.surfaceLimit,1);
});
test('maximum explicit budget is accepted',async()=>{
  const r=await scan(transport(fixture()),JSON.stringify({...JSON.parse(request()),maxSurfaces:4096}));
  assert.equal(r.status,'observed');assert.equal(r.sources.length,1);
});
for(const maxSurfaces of [0,4097,-1,1.5,true,null,'900']) test('invalid explicit budget',()=>
  rejects(()=>scan(null,JSON.stringify({...JSON.parse(request()),maxSurfaces})),'input_invalid'));
for (const [label,mutate] of [
  ['node parent cycle',f=>{f.dom.documents[0].nodes.parentIndex[2]=2;}],
  ['invalid layout index',f=>{f.dom.documents[0].layout.nodeIndex[2]=99;}],
  ['malformed layout style',f=>{f.dom.documents[0].layout.styles[2]=[];}],
  ['invalid string index',f=>{f.dom.documents[0].layout.text[3]=999;}],
  ['array mismatch',f=>{f.dom.documents[0].nodes.attributes.pop();}],
  ['wrong AX document',f=>{f.ax.nodes[0].backendDOMNodeId=123;}],
  ['duplicate AX id',f=>{f.ax.nodes.push(f.ax.nodes[0]);}],
  ['bad AX name',f=>{f.ax.nodes[0].name.value={value:'bad'};}],
]) test(label, async()=>{const f=fixture();mutate(f);await rejects(()=>scan(transport(f),request()),'response_invalid');});
test('several LayoutObjects for one DOM node',async()=>{
  const f=fixture(['T']),l=f.dom.documents[0].layout;
  l.nodeIndex.push(3);l.styles.push(l.styles[3]);l.bounds.push(l.bounds[3]);l.text.push(f.str('ODO: wire'));
  const r=await scan(transport(f),request());assert.equal(findings(r).length,1);checks(r);
});
test('DOM changed between samples', async () => {
  const r=await scan(transport(fixture(),(m,i,f)=>{if(i===3)f.dom.strings[f.dom.documents[0].layout.text[3]]='new copy';}),request());
  assert.equal(r.status,'stale'); assert.equal(r.batches.length,0); checks(r);
});
test('AX changed between samples', async () => {
  const r=await scan(transport(fixture(),(m,i,f)=>{if(i===4)f.ax.nodes[0].name.value='new name';}),request());
  assert.equal(r.status,'stale'); checks(r);
});
test('unmapped accessible node explicit', async () => {
  const f=fixture(); f.ax.nodes.push({nodeId:'missing',ignored:false,backendDOMNodeId:999,name:{value:'DEBUG: missed'}});
  const r=await scan(transport(f),request()); assert.equal(r.status,'partial'); assert.equal(r.coverage.unmappedAxNodes,1);
});
test('raw response metadata and input values absent', async () => {
  const f=fixture(['저장']); f.dom.documents[0].url='https://private.example/path';
  f.dom.documents[0].nodes.inputValue={value:['PRIVATE_VALUE']}; f.ax.nodes[0].value={value:'PRIVATE_VALUE'};
  const r=await scan(transport(f),request()); checks(r); assert.equal(r.scanStatus,'no-pattern-match');
});
// A form control under BODY with [name, value] attributes, its own layout row (style null: not laid
// out) and an optional AX node carrying the browser's accessible name for it.
function control(f, tag, attrs, { style = ['inline-block','visible','1'], bounds = [0,40,200,20], axName } = {}) {
  const n=f.dom.documents[0].nodes, l=f.dom.documents[0].layout, i=n.nodeType.length, id=100+i;
  n.nodeType.push(1); n.parentIndex.push(1); n.nodeName.push(f.str(tag)); n.backendNodeId.push(id);
  n.attributes.push(attrs.flatMap(([k,v])=>[f.str(k),f.str(v)]));
  if (style) { l.nodeIndex.push(i); l.styles.push(style.map(f.str)); l.bounds.push(bounds); l.text.push(-1); }
  if (axName!==undefined) f.ax.nodes.push({nodeId:'c'+i, ignored:false, role:{value:'textbox'}, backendDOMNodeId:id, name:{value:axName}});
  return f;
}
const channelOf = r => f => r.sources[r.batches.flatMap(b=>b.scan.findings.includes(f)?[b.surfaceIndexes[f.surfaceIndex]]:[])[0]].channel;
for (const tag of ['INPUT','TEXTAREA']) test(`labelled ${tag} placeholder is collected on its own channel`, async () => {
  const r=await scan(transport(control(fixture(['저장']),tag,[['aria-label','Email'],['placeholder','TODO: wire']],{axName:'Email'})),request());
  checks(r); assert.equal(findings(r).length,1); assert.equal(channelOf(r)(findings(r)[0]),'dom-placeholder');
  assert.ok(findings(r)[0].signals.some(s=>s.code==='developer-marker'));
  // Scanned as the placeholder attribute, not as visible text: the evidence digest binds kind and name.
  const { SCANNER_VERSION } = require('../lib/ui-boundary-scanner'), found = findings(r)[0];
  assert.equal(found.evidenceDigest, 'sha256:' + require('node:crypto').createHash('sha256').update(JSON.stringify(
    [SCANNER_VERSION, POLICY_VERSION, 'ui', found.surfaceIndex, 'attribute', 'rendered', 'placeholder', 'TODO: wire'])).digest('hex'));
});
test('placeholder already used as the accessible name is not collected twice', async () => {
  const r=await scan(transport(control(fixture(['저장']),'INPUT',[['placeholder','TODO: wire']],{axName:'TODO: wire'})),request());
  checks(r); assert.equal(findings(r).length,1); assert.ok(!r.sources.some(s=>s.channel==='dom-placeholder'));
});
test('a filled field keeps its value unread while its authored placeholder is collected', async () => {
  const f=control(fixture(['저장']),'INPUT',[['aria-label','Name'],['value','PRIVATE_VALUE'],['placeholder','Your name']],{axName:'Name'});
  f.dom.documents[0].nodes.inputValue={index:[f.dom.documents[0].nodes.nodeType.length-1],value:[f.str('PRIVATE_VALUE')]};
  const r=await scan(transport(f),request()); checks(r);
  assert.equal(r.sources.filter(s=>s.channel==='dom-placeholder').length,1); assert.equal(r.scanStatus,'no-pattern-match');
});
for (const [label,tag,attrs,options] of [
  ['visibility hidden','INPUT',[],{style:['inline-block','hidden','1']}],
  ['transparent','INPUT',[],{style:['inline-block','visible','0']}],
  ['not laid out','INPUT',[],{style:null}],
  ['zero size','INPUT',[],{bounds:[0,40,0,0]}],
  ['checkbox','INPUT',[['type','checkbox']],{}],
  ['hidden input','INPUT',[['type','hidden']],{}],
  ['select','SELECT',[],{}],
]) test(`no placeholder surface from a ${label} control`, async () => {
  const r=await scan(transport(control(fixture(['저장']),tag,[['aria-label','Field'],...attrs,['placeholder','TODO: wire']],{...options,axName:'Field'})),request());
  checks(r); assert.ok(!r.sources.some(s=>s.channel==='dom-placeholder')); assert.equal(findings(r).length,0);
});
test('an unknown input type is a text field and shows its placeholder', async () => {
  const r=await scan(transport(control(fixture(['저장']),'INPUT',[['type','fancy'],['aria-label','Field'],['placeholder','TODO: wire']],{axName:'Field'})),request());
  checks(r); assert.equal(findings(r).length,1); assert.equal(channelOf(r)(findings(r)[0]),'dom-placeholder');
});

async function playwrightDriver() {
  // Optional test dependency supplied by the host, never installed implicitly.
  assert.ok(process.env.LEERNESS_TEST_PLAYWRIGHT, 'LEERNESS_TEST_PLAYWRIGHT is required for --browser');
  assert.ok(process.env.LEERNESS_TEST_BROWSER, 'LEERNESS_TEST_BROWSER is required for --browser');
  const { chromium } = require(process.env.LEERNESS_TEST_PLAYWRIGHT);
  const browser=await chromium.launch({headless:true,executablePath:process.env.LEERNESS_TEST_BROWSER});
  try {
    const page=await browser.newPage(); await page.route('**/*',route=>route.abort());
    const session=await page.context().newCDPSession(page);
    return { name:'playwright', session, version:browser.version(), setContent:html=>page.setContent(html),
      evaluate:expression=>page.evaluate(expression), content:()=>page.content(), url:()=>page.url(), close:()=>browser.close() };
  } catch (error) { await browser.close(); throw error; }
}
async function cdpDriver() {
  // No browser package: the host names a Chromium executable and plain CDP runs over the global
  // WebSocket (Node 22+). Throwaway profile, every network request failed, as in the Playwright mode.
  assert.ok(process.env.LEERNESS_TEST_BROWSER, 'LEERNESS_TEST_BROWSER is required for --cdp');
  assert.equal(typeof WebSocket, 'function', 'a global WebSocket (Node 22+) is required for --cdp');
  const fs=require('node:fs'), os=require('node:os'), path=require('node:path'), cp=require('node:child_process');
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'leerness-cdp-'));
  const child=cp.spawn(process.env.LEERNESS_TEST_BROWSER,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,
    '--no-first-run','--no-default-browser-check','--disable-extensions','about:blank'],{stdio:'ignore',windowsHide:true});
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let ws;
  const close=async()=>{
    try{ws&&ws.close();}catch{}
    child.kill();
    for(let k=0;k<50;k++){try{fs.rmSync(profile,{recursive:true,force:true});break;}catch{await sleep(100);}}
  };
  try {
    let port=0;
    for(let i=0;i<150&&!port;i++){try{port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);}catch{await sleep(100);}}
    assert.ok(port>0,'the browser opened no DevTools port');
    const target=await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
    ws=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(new Error('CDP WebSocket failed'));});
    let seq=0; const pending=new Map();
    const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
    ws.onmessage=event=>{
      const m=JSON.parse(event.data);
      if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(new Error(m.error.message));else p.resolve(m.result);}
      else if(m.method==='Fetch.requestPaused')send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'BlockedByClient'}).catch(()=>{});
    };
    await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
    const {frameTree}=await send('Page.getFrameTree');
    const evaluate=async expression=>{
      const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
      if(r.exceptionDetails)throw new Error('page evaluation failed');
      return r.result.value;
    };
    const settle=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))');
    const {product}=await send('Browser.getVersion');
    return { name:'cdp', session:{send}, version:product,
      setContent:async html=>{await send('Page.setDocumentContent',{frameId:frameTree.frame.id,html});await settle();},
      evaluate:async expression=>{const value=await evaluate(expression);await settle();return value;},
      content:()=>evaluate('document.documentElement.outerHTML'), url:()=>evaluate('location.href'), close };
  } catch (error) { await close(); throw error; }
}
async function browserCases(driver) {
  const { session } = driver;
  const controls=[
    ['normal technology names','<p>React · OpenAI · Claude · Node.js</p><button>저장</button>',false],
    ['DOM developer marker','<p>TODO: wire</p>',true],
    ['decoded HTML entity','<p>T&#79;DO: wire</p>',true],
    ['inline fragmented marker','<p>T<span>ODO:</span> wire</p>',true],
    ['DOM security','<p>'+key+'</p>',true],
    ['AX name','<button aria-label="DEBUG: label">저장</button>',true],
    ['AX description','<button aria-description="DEBUG: description">저장</button>',true],
    ['hidden referenced label','<span id="label" hidden>TODO: wire</span><button aria-labelledby="label">Go</button>',true],
    ['hidden referenced description','<span id="label" hidden>TODO: wire</span><button aria-describedby="label">Go</button>',true],
    ['image accessible name','<img alt="TODO: wire">',true],
    ['hidden content excluded','<p hidden>TODO: wire</p><div style="display:none">'+key+'</div>',false],
    ['visibility hidden excluded','<p style="visibility:hidden">TODO: wire</p>',false],
    ['opacity zero AX still exposed','<p style="opacity:0">TODO: wire</p>',true],
    ['aria hidden visual copy included','<p aria-hidden="true">TODO: wire</p>',true],
    ['non copy data attributes excluded','<button data-debug="true" data-source-prompt="TODO: wire">저장</button>',false],
    ['input values excluded','<input value="TODO: wire"><textarea>TODO: wire</textarea><div contenteditable>TODO: wire</div>',false],
    ['control accessible label retained','<input value="PRIVATE_VALUE" aria-label="TODO: wire">',true],
    ['placeholder accessible name','<input placeholder="TODO: wire">',true],
    ['labelled field placeholder','<input aria-label="Email" placeholder="TODO: wire">',true],
    ['filled field placeholder, value unread','<input aria-label="Name" value="PRIVATE_VALUE" placeholder="TODO: wire">',true],
    ['labelled textarea placeholder','<label>Notes <textarea placeholder="TODO: wire"></textarea></label>',true],
    ['hidden field placeholder excluded','<input aria-label="Email" placeholder="TODO: wire" style="visibility:hidden">',false],
    ['checkbox placeholder excluded','<input type="checkbox" aria-label="Agree" placeholder="TODO: wire">',false],
    ['separate blocks not joined','<p>T</p><p>ODO: wire</p>',false],
    ['line break separates marker','<p>Title<br>TODO: wire</p>',true],
    ['offscreen content scope','<p style="position:absolute;top:5000px">TODO: wire</p>',true],
    ['CSS generated copy','<style>p::before {content:"TODO: wire"}</style><p></p>',true],
  ];
  for(const [name,html,expected] of controls) test('browser '+name,async()=>{
    await driver.setContent(html); const r=await scan(session,request()); checks(r);
    assert.notEqual(r.status,'stale'); assert.equal(findings(r).length>0,expected);
    if(name==='opacity zero AX still exposed') assert.ok(r.sources.every(s=>s.channel!=='dom-text'));
    if(name.startsWith('labelled field')||name.startsWith('filled field')||name.startsWith('labelled textarea'))
      assert.ok(r.sources.some(s=>s.channel==='dom-placeholder'));
  });
  test('browser open shadow DOM',async()=>{
    await driver.setContent('<div id="host"></div>');
    await driver.evaluate("document.getElementById('host').attachShadow({mode:'open'}).innerHTML='<button>TODO: wire</button>'");
    const r=await scan(session,request()); checks(r); assert.ok(findings(r).length>0);
  });
  test('browser frames explicitly excluded',async()=>{
    await driver.setContent('<p>저장</p><iframe srcdoc="<p>TODO: wire</p>"></iframe>');
    const r=await scan(session,request()); assert.equal(r.status,'partial'); assert.equal(r.coverage.childFramesExcluded,1);
  });
  test('browser changing page rejected',async()=>{
    await driver.setContent('<p>저장</p>'); let calls=0;
    const changing={async send(m,p){const v=await session.send(m,p);if(++calls===2)await driver.setContent('<p>TODO: wire</p>');return v;}};
    const r=await scan(changing,request());assert.equal(r.status,'stale');assert.equal(r.batches.length,0);
  });
  test('browser batch beyond scanner limit',async()=>{
    await driver.setContent('<p>DEBUG: fixture</p>'.repeat(40));
    const r=await scan(session,request());checks(r);assert.ok(r.sources.length>32);assert.ok(r.batches.length>1);
  });
  test('browser page unchanged by adapter',async()=>{
    await driver.setContent('<p>저장</p><input value="PRIVATE_VALUE" placeholder="Your name">');
    const before=await driver.content(), url=await driver.url(); await scan(session,request());
    assert.equal(await driver.content(),before);assert.equal(await driver.url(),url);
  });
  console.log(JSON.stringify({browserVersion:driver.version,driver:driver.name,fixtureControls:controls.length,network:'blocked',hostFixtureOnly:true}));
  return driver.close;
}
(async()=>{
  let close;
  let passed=0;
  try {
    if(process.argv.includes('--browser'))close=await browserCases(await playwrightDriver());
    else if(process.argv.includes('--cdp'))close=await browserCases(await cdpDriver());
    for(const {name,run} of cases) {
      try{await run();passed++;console.log('PASS '+name);}
      catch(error){console.error('FAIL '+name+': '+error.stack);}
    }
    console.log(JSON.stringify({suite:'ui-boundary-browser',passed,total:cases.length,failed:cases.length-passed}));
    if(passed!==cases.length)process.exitCode=1;
  } finally {if(close)await close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
