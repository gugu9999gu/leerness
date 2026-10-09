'use strict';
const S = require('./memory-write-budget-support');
const { assert, fs, path, cp, arena, entry, test, finish, fixture, row, options, snapshot } = S;
const { renderLosslessArchiveEntries } = require('../lib/memory-archive');
const policy = () => ({ limits: options(), mode: 'within-target', targets: {
  items: 100, canonicalBytes: 65536, projectionBytes: 65536, archiveBytes: 65536, totalPathBytes: 200000 } });
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC)$/i.test(k)));
for (const key of ['TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA']) { env[key] = path.join(arena,key.toLowerCase()); fs.mkdirSync(env[key]); }
Object.assign(env,{ LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1' });
function rpc(p,requests) {
  const r=cp.spawnSync(process.execPath,[entry,'mcp','serve','--profile','full'],{ cwd:p,env,
    input:requests.map(r=>JSON.stringify(r)).join('\n')+'\n',encoding:'utf8',timeout:45000,maxBuffer:1048576,windowsHide:true });
  assert(!r.error&&!r.signal,r.error?.message);assert.equal(r.status,0,r.stderr);
  return r.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
}
const call = (name,args,id=1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
function domain(p,s) { return Object.fromEntries(Object.entries(snapshot(p)).filter(([k])=>['.json','.md','.archive.md'].some(suffix=>k==='./.leerness/'+s+suffix))); }
for (const s of ['decisions','lessons']) for (const kind of ['update','drop','restore']) {
  const name=kind==='restore'?'leerness_memory_restore':'leerness_'+(s==='decisions'?'decision_':'lesson_')+(kind==='drop'?'drop':s==='decisions'?'add':'save');
  const args=kind==='restore'?{surface:s,target:'recover'}:kind==='drop'?{target:'base'}:s==='decisions'?{title:'fresh'}:{text:'fresh'};
  for(const deny of [false,true])test('actual MCP '+s+' '+kind+' '+(deny?'rejection':'publication'),()=>{
    const p=fixture(s,[row(s,'base')],'\nPRIVATE suffix\n',{[s+'.archive.md']:'# Archive\n\n## 제거 2026-09-01 (target: "recover")\n'+renderLosslessArchiveEntries(s,[row(s,'revive')])+'\n'});
    const pol=policy();if(deny)pol.limits.source.maxInputBytes=1;const before=domain(p,s);
    const reply=rpc(p,[call(name,{...args,path:p,writePolicyJson:JSON.stringify(pol)})])[0];assert(reply.result,JSON.stringify(reply));
    assert.equal(reply.result.isError,deny,JSON.stringify(reply));
    if(deny){const result=JSON.parse(reply.result.content[0].text);assert.equal(result.code,'memory_policy');assert.equal(result.reasonCode,'E_STORE_LIMIT');assert.deepEqual(domain(p,s),before);}
    else {const rows=JSON.parse(fs.readFileSync(path.join(p,'.leerness',s+'.json')));assert.equal(rows.length,kind==='drop'?0:2);assert(fs.readFileSync(path.join(p,'.leerness',s+'.md'),'utf8').endsWith('\nPRIVATE suffix\n'));}
  });
}
test('MCP advertises policy only on the five supported writers',()=>{
  const p=fixture(),tools=rpc(p,[{jsonrpc:'2.0',id:1,method:'tools/list'}])[0].result.tools;
  const selected=tools.filter(t=>t.inputSchema.properties?.writePolicyJson);
  assert.equal(selected.length,5);for(const tool of selected){assert.equal(tool.requiredTier,'safe-write');assert.equal(tool.inputSchema.properties.writePolicyJson.type,'string');}
});
for(const value of [null,{},'', '{}','x'.repeat(8193)])test('MCP invalid policy '+(value===null?'null':typeof value==='object'?'object':'length '+value.length),()=>{
  const p=fixture(),before=domain(p,'decisions'),reply=rpc(p,[call('leerness_decision_add',{title:'fresh',path:p,writePolicyJson:value})])[0];
  assert(reply.error?.code===-32602||reply.result?.isError===true,JSON.stringify(reply));assert.deepEqual(domain(p,'decisions'),before);
});
test('MCP plan restore cannot silently ignore policy',()=>{
  const p=fixture(),reply=rpc(p,[call('leerness_memory_restore',{surface:'plan',target:'recover',path:p,writePolicyJson:JSON.stringify(policy())})])[0];
  assert(reply.result?.isError,JSON.stringify(reply));assert.equal(JSON.parse(reply.result.content[0].text).reasonCode,'command_unsupported');
});
finish('memory command policy MCP');
