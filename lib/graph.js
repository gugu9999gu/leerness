// lib/graph.js — leerness ontology graph (interactive HTML) generator.
// 1.34.3 (T-0077): `leerness graph --html` 분기 → 프로젝트 루트에 자기완결 leerness.html 생성.
//   Obsidian graph-view 스타일 force-directed 캔버스로 5 메모리 표면(task/plan/decision/lesson/rule)
//   + skills + feature-graph 를 노드/엣지로 렌더, 노드 클릭 → 내용 패널.
//   - 데이터: deps 주입(_roadmapData · _loadDecisions · _loadLessons) — 자식 프로세스 셸링 없이 in-process.
//   - I/O: ./io(absRoot · exists · read · writeUtf8 · log).  0 런타임 의존 · 자기완결 vanilla JS(차트 라이브러리 X).
//   - XSS/주입: 임베드 직전 모든 '<' 를 < 로 치환(</script>·<!-- 무력화) + function 치환기로 $-특수문자 회피.
'use strict';
const path = require('path');
const { absRoot, exists, read, writeUtf8, log } = require('./io');

// 검증된 프로토타입 템플릿(Claude Preview 렌더+클릭조회 확인). `/*__DATA__*/null` 자리표시자에 JSON 주입.
// String.raw 필수: 내부 JS 의 `\'` 같은 escape 가 원문 그대로 출력돼 브라우저 JS 엔진이 해석하도록 보존.
const TEMPLATE = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>leerness — ontology</title>
<style>
:root{--bg:#0a0d12;--panel:#0f141a;--line:#222a33;--txt:#e6edf3;--mut:#8b949e;--brand:#39d353;--mono:ui-monospace,'SF Mono',Menlo,monospace}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--txt);font-family:var(--mono);font-size:13px;overflow:hidden}
#bar{position:fixed;top:0;left:0;right:0;height:46px;display:flex;align-items:center;gap:14px;padding:0 16px;background:rgba(10,13,18,.85);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);z-index:10}
#bar .ttl{font-weight:700;color:#fff;display:flex;align-items:center;gap:8px}
#bar .dot{width:9px;height:9px;border-radius:50%;background:var(--brand);box-shadow:0 0 10px var(--brand)}
#bar .stat{color:var(--mut);font-size:11px}
#search{background:#0b0f14;border:1px solid var(--line);color:var(--txt);border-radius:7px;padding:6px 10px;font:inherit;width:200px;outline:none}
#search:focus{border-color:var(--brand)}
#chips{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.chip{display:flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:100px;padding:3px 10px;cursor:pointer;font-size:11px;user-select:none}
.chip .sw{width:9px;height:9px;border-radius:50%}
.chip.off{opacity:.35}
canvas{position:fixed;inset:0;top:46px}
#panel{position:fixed;top:60px;right:14px;width:340px;max-height:calc(100% - 80px);overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:0 24px 60px -20px #000;display:none;z-index:9}
#panel.show{display:block}
#panel .pt{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
#panel .pt .sw{width:10px;height:10px;border-radius:50%}
#panel h2{margin:0 0 12px;font-size:15px;line-height:1.4;color:#fff;word-break:break-word}
#panel .row{margin:0 0 10px;border-top:1px solid var(--line);padding-top:10px}
#panel .k{color:var(--mut);font-size:10px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px}
#panel .v{white-space:pre-wrap;word-break:break-word;line-height:1.55}
#panel .nbrs a{color:#58a6ff;cursor:pointer;display:block;padding:2px 0}
#panel .x{position:absolute;top:12px;right:14px;color:var(--mut);cursor:pointer;font-size:16px}
#hint{position:fixed;bottom:12px;left:16px;color:var(--mut);font-size:11px;opacity:.7}
#empty{position:fixed;inset:0;display:none;place-items:center;color:var(--mut);text-align:center}
</style></head><body>
<div id="bar">
  <div class="ttl"><span class="dot"></span><span id="proj">leerness</span><span style="color:var(--mut);font-weight:400">/ ontology</span></div>
  <span class="stat" id="stat"></span>
  <input id="search" placeholder="search nodes…" autocomplete="off">
  <div id="chips"></div>
</div>
<canvas id="c"></canvas>
<div id="panel"><span class="x" onclick="closePanel()">✕</span><div id="pbody"></div></div>
<div id="empty">No nodes — run <b>leerness handoff .</b> to populate the harness, then regenerate.</div>
<div id="hint">drag node · scroll zoom · drag bg pan · click node → details · search+Enter jump · f / dblclick fit · p export PNG · Esc close</div>
<script>
var DATA = /*__DATA__*/null;
var COLORS={task:'#58a6ff',plan:'#d29922',decision:'#39d0d8',lesson:'#e3b341',rule:'#bc8cff',skill:'#2dd4bf',feature:'#6e7681'};
var STATUSCOL={done:'#3fb950',verified:'#3fb950','in-progress':'#58a6ff',in_progress:'#58a6ff',blocked:'#f85149',waiting:'#d29922',planned:'#8b949e',requested:'#8b949e'};
var EKIND={milestone:'rgba(210,153,34,.22)',ref:'rgba(88,166,255,.20)',link:'rgba(57,211,83,.20)',feature:'rgba(110,118,129,.26)'};
function nodeColor(n){ if(n.type==='task'&&STATUSCOL[n.status])return STATUSCOL[n.status]; return COLORS[n.type]||'#8b949e'; }
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

var cv=document.getElementById('c'),ctx=cv.getContext('2d'),DPR=Math.min(2,window.devicePixelRatio||1);
var W,H; function resize(){W=cv.clientWidth=window.innerWidth;H=cv.clientHeight=window.innerHeight-46;cv.width=W*DPR;cv.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0);} window.addEventListener('resize',resize);resize();

var nodes=DATA?DATA.nodes:[],edges=DATA?DATA.edges:[];
var idx={}; nodes.forEach(function(n,i){idx[n.id]=n; n.x=W/2+Math.cos(i)*Math.min(W,H)*0.32*Math.random()+ (Math.random()-0.5)*80; n.y=H/2+Math.sin(i)*Math.min(W,H)*0.32*Math.random()+(Math.random()-0.5)*80; n.vx=0;n.vy=0; n.deg=0;});
edges=edges.filter(function(e){return idx[e.source]&&idx[e.target];});
edges.forEach(function(e){idx[e.source].deg++;idx[e.target].deg++;});
var off={}; // hidden types
document.getElementById('proj').textContent=(DATA&&DATA.project)||'leerness';
document.getElementById('stat').textContent=nodes.length+' nodes · '+edges.length+' links';
if(!nodes.length){document.getElementById('empty').style.display='grid';}

// chips
var types=Array.from(new Set(nodes.map(function(n){return n.type;})));
var chipsEl=document.getElementById('chips');
types.forEach(function(t){var c=DATA.counts&&DATA.counts[t]; var el=document.createElement('div');el.className='chip';el.innerHTML='<span class="sw" style="background:'+(COLORS[t]||'#888')+'"></span>'+t+(c!=null?' '+c:'');el.onclick=function(){off[t]=!off[t];el.classList.toggle('off',!!off[t]);};chipsEl.appendChild(el);});

// view transform
var view={x:0,y:0,k:1};
var sel=null,hover=null,nbr={};
var cam={cx:W/2,cy:H/2};
var _fit=false;

// physics
var alpha=1;
function tick(){
  if(alpha<0.006) return;
  if(alpha>0.005) alpha*=0.992;
  var REP=2600,SPR=0.012,LEN=70,CEN=0.012;
  for(var i=0;i<nodes.length;i++){var a=nodes[i]; if(off[a.type])continue;
    for(var j=i+1;j<nodes.length;j++){var b=nodes[j]; if(off[b.type])continue;
      var dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy+0.01; if(d2>360000)continue; var d=Math.sqrt(d2);var f=REP/d2; var ux=dx/d,uy=dy/d; a.vx+=ux*f;a.vy+=uy*f;b.vx-=ux*f;b.vy-=uy*f;}
    a.vx+=(cam.cx-a.x)*CEN; a.vy+=(cam.cy-a.y)*CEN;
  }
  edges.forEach(function(e){var a=idx[e.source],b=idx[e.target]; if(off[a.type]||off[b.type])return; var dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)+0.01;var f=(d-LEN)*SPR;var ux=dx/d,uy=dy/d; a.vx+=ux*f;a.vy+=uy*f;b.vx-=ux*f;b.vy-=uy*f;});
  nodes.forEach(function(n){ if(n.fixed)return; n.vx*=0.86;n.vy*=0.86; n.x+=n.vx*alpha*2.2;n.y+=n.vy*alpha*2.2;});
}
function toScreen(n){return{x:(n.x-cam.cx)*view.k+W/2+view.x,y:(n.y-cam.cy)*view.k+H/2+view.y};}
function fromScreen(sx,sy){return{x:(sx-W/2-view.x)/view.k+cam.cx,y:(sy-H/2-view.y)/view.k+cam.cy};}
function fitView(){var minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9,c=0; nodes.forEach(function(n){if(off[n.type])return;c++;if(n.x<minx)minx=n.x;if(n.x>maxx)maxx=n.x;if(n.y<miny)miny=n.y;if(n.y>maxy)maxy=n.y;}); if(c<1)return; var gw=Math.max(1,maxx-minx),gh=Math.max(1,maxy-miny); view.k=Math.min(2.2,Math.max(0.2,0.82*Math.min(W/gw,H/gh))); cam.cx=(minx+maxx)/2; cam.cy=(miny+maxy)/2; view.x=0;view.y=0;}

function draw(){
  ctx.clearRect(0,0,W,H);
  // edges
  ctx.lineWidth=1;
  edges.forEach(function(e){var a=idx[e.source],b=idx[e.target]; if(off[a.type]||off[b.type])return; var p=toScreen(a),q=toScreen(b); var on=sel&&(e.source===sel.id||e.target===sel.id); ctx.strokeStyle=on?'rgba(57,211,83,.55)':(EKIND[e.kind]||'rgba(120,130,145,.16)'); ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();});
  // nodes
  nodes.forEach(function(n){ if(off[n.type])return; var p=toScreen(n); var r=(3+Math.min(7,n.deg*0.7))*Math.max(.6,view.k*.9); var dim=sel&&!nbr[n.id]&&n.id!==sel.id; var srch=window._q&&(n.label||'').toLowerCase().indexOf(window._q)<0&&n.id.toLowerCase().indexOf(window._q)<0;
    ctx.globalAlpha=(dim||srch)?0.18:1; ctx.fillStyle=nodeColor(n); ctx.beginPath();ctx.arc(p.x,p.y,r,0,6.2832);ctx.fill();
    if(n===sel||n===hover){ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();}
    if(view.k>1.35||n===sel||n===hover||(window._q&&!srch)){ ctx.globalAlpha=(dim)?0.3:0.92; ctx.fillStyle='#cdd9e5';ctx.font='10px ui-monospace';ctx.fillText((n.label||n.id).slice(0,42),p.x+r+3,p.y+3.5);}
    ctx.globalAlpha=1;
  });
}
function loop(){tick(); if(!_fit&&nodes.length&&alpha<0.08){_fit=true;fitView();} draw();requestAnimationFrame(loop);} loop();

// interaction
var drag=null,panning=null,moved=false;
cv.addEventListener('mousedown',function(ev){var m=hit(ev.offsetX,ev.offsetY);moved=false; if(m){drag=m;m.fixed=true;}else{_fit=true;panning={x:ev.offsetX,y:ev.offsetY,vx:view.x,vy:view.y};}});
window.addEventListener('mousemove',function(ev){var r=cv.getBoundingClientRect();var mx=ev.clientX-r.left,my=ev.clientY-r.top;
  if(drag){var w=fromScreen(mx,my);drag.x=w.x;drag.y=w.y;drag.vx=0;drag.vy=0;alpha=Math.max(alpha,.3);moved=true;}
  else if(panning){view.x=panning.vx+(mx-panning.x);view.y=panning.vy+(my-panning.y);moved=true;}
  else{hover=hit(mx,my);cv.style.cursor=hover?'pointer':'default';}
});
window.addEventListener('mouseup',function(ev){ if(drag){drag.fixed=false; if(!moved)select(drag); drag=null;} else if(panning){ if(!moved){closePanel();} panning=null;} });
cv.addEventListener('wheel',function(ev){ev.preventDefault();var f=ev.deltaY<0?1.12:0.89;var nk=Math.max(0.2,Math.min(6,view.k*f)); _fit=true; view.k=nk;},{passive:false});
function hit(sx,sy){var best=null,bd=18*18; nodes.forEach(function(n){if(off[n.type])return;var p=toScreen(n);var dx=p.x-sx,dy=p.y-sy,d=dx*dx+dy*dy; if(d<bd){bd=d;best=n;}});return best;}

function select(n){sel=n;nbr={}; edges.forEach(function(e){if(e.source===n.id)nbr[e.target]=1;if(e.target===n.id)nbr[e.source]=1;}); showPanel(n);}
function closePanel(){sel=null;document.getElementById('panel').classList.remove('show');}
function showPanel(n){
  var nb=Object.keys(nbr).map(function(id){return idx[id];}).filter(Boolean);
  var h='<div class="pt"><span class="sw" style="background:'+nodeColor(n)+'"></span>'+esc(n.type)+(n.status?' · '+esc(n.status):'')+' · '+esc(n.id)+'</div>';
  h+='<h2>'+esc(n.label||n.id)+'</h2>';
  var d=n.detail||{};
  Object.keys(d).forEach(function(k){ if(!d[k]||k==='request'&&d[k]===n.label)return; if(String(d[k]).trim()==='')return; h+='<div class="row"><div class="k">'+esc(k)+'</div><div class="v">'+esc(d[k])+'</div></div>';});
  if(nb.length){h+='<div class="row"><div class="k">connected ('+nb.length+')</div><div class="nbrs">'+nb.slice(0,30).map(function(x){return '<a onclick="goto(\''+x.id.replace(/'/g,"")+'\')">'+esc(x.label||x.id)+'</a>';}).join('')+'</div></div>';}
  document.getElementById('pbody').innerHTML=h;
  document.getElementById('panel').classList.add('show');
}
window.goto=function(id){var n=idx[id];if(n){select(n);cam.cx=n.x;cam.cy=n.y;view.x=0;view.y=0;}};
document.getElementById('search').addEventListener('input',function(ev){window._q=ev.target.value.trim().toLowerCase()||null;});
document.getElementById('search').addEventListener('keydown',function(ev){ if(ev.key!=='Enter'||!window._q)return; var h=null; for(var i=0;i<nodes.length;i++){var n=nodes[i]; if(off[n.type])continue; if((n.label||'').toLowerCase().indexOf(window._q)>=0||n.id.toLowerCase().indexOf(window._q)>=0){h=n;break;}} if(h){_fit=true;goto(h.id);} });
function exportPng(){ try{ var t=document.createElement('canvas'); t.width=cv.width; t.height=cv.height; var tx=t.getContext('2d'); tx.fillStyle='#0a0d12'; tx.fillRect(0,0,t.width,t.height); tx.drawImage(cv,0,0); var a=document.createElement('a'); a.download='leerness-graph.png'; a.href=t.toDataURL('image/png'); a.click(); }catch(e){} }
window.addEventListener('keydown',function(ev){ if(ev.target&&ev.target.tagName==='INPUT')return; if(ev.key==='f'||ev.key==='F'){_fit=true;fitView();} else if(ev.key==='p'||ev.key==='P'){exportPng();} else if(ev.key==='Escape'){closePanel();} });
cv.addEventListener('dblclick',function(ev){ if(!hit(ev.offsetX,ev.offsetY)){_fit=true;fitView();} });
</script></body></html>`;

const _txt = v => (v == null ? '' : String(v));
function _trunc(s, n) { s = _txt(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// 하네스 표면 → {project, version, counts, nodes, edges}. deps 로 in-process 로더 주입(셸링 X).
function buildGraphData(root, deps = {}) {
  const { _roadmapData, _loadDecisions, _loadLessons } = deps;
  const rd = (typeof _roadmapData === 'function' ? _roadmapData(root) : {}) || {};
  const decisions = (typeof _loadDecisions === 'function' ? _loadDecisions(root) : []) || [];
  const lessons = (typeof _loadLessons === 'function' ? _loadLessons(root) : []) || [];

  const nodes = []; const byId = new Map(); const byLabel = new Map();
  function add(node) {
    if (byId.has(node.id)) return;
    nodes.push(node); byId.set(node.id, node);
    if (node.label) byLabel.set(_txt(node.label).trim().toLowerCase(), node.id);
  }
  // task (status 색상) — _roadmapData 가 evidence 의 M-#### 를 t.milestones 로 이미 추출.
  for (const t of (rd.tasks || [])) add({ id: t.id, type: 'task', status: t.status || 'requested', label: _trunc(t.request, 64), detail: { request: _txt(t.request), status: _txt(t.status), evidence: _txt(t.evidence), nextAction: _txt(t.nextAction), updated: _txt(t.updated) }, _ms: t.milestones || [] });
  // plan (milestone)
  for (const m of (rd.milestones || [])) add({ id: m.id, type: 'plan', status: m.status || 'planned', label: _trunc(m.title, 64), detail: { title: _txt(m.title), status: _txt(m.status), progress: _txt(m.progress), doneWhen: _txt(m.doneWhen), nextAction: _txt(m.nextAction) } });
  // decision — title 은 제네릭("Decision")일 수 있어 실내용(decision) 우선. id 없으면 합성.
  let di = 0; for (const d of decisions) { const id = d.id || ('D-' + (++di)); add({ id, type: 'decision', status: '', label: _trunc(d.decision || d.title || d.text, 64), detail: { decision: _txt(d.decision || d.title), reason: _txt(d.reason), impact: _txt(d.impact), date: _txt(d.date) } }); }
  // lesson — 내용은 text. id 없으면 합성.
  let li = 0; for (const l of lessons) { const id = l.id || ('L-' + (++li)); add({ id, type: 'lesson', status: '', label: _trunc(l.title || l.lesson || l.text, 64), detail: { lesson: _txt(l.title || l.lesson || l.text), tag: _txt(l.tag), date: _txt(l.date) } }); }
  // rule
  let ri = 0; for (const r of (rd.rules || [])) { const id = r.id || ('R-' + (++ri)); add({ id, type: 'rule', status: r.status || '', label: _trunc(r.rule || r.text || r.title, 64), detail: { rule: _txt(r.rule || r.text), trigger: _txt(r.trigger), status: _txt(r.status), lastVerified: _txt(r.lastVerified) } }); }
  // skill
  let si = 0; for (const s of (rd.skills || [])) { const id = s.id || s.name || ('S-' + (++si)); add({ id: 'skill:' + id, type: 'skill', status: '', label: _trunc(s.name || s.title || id, 52), detail: { name: _txt(s.name || id), description: _txt(s.description || s.summary), category: _txt(s.category) } }); }

  // edges — 같은 (source,target) 쌍 dedup: task→milestone 가 _ms 추출 + blob M-#### 정규식에서 이중 추가되는 것 방지(엣지수/degree 정확).
  const edges = [];
  const _seenEdge = new Set();
  function linkIds(a, b, kind) { if (!(a && b && byId.has(a) && byId.has(b) && a !== b)) return; const k = a + '\u0000' + b; if (_seenEdge.has(k)) return; _seenEdge.add(k); edges.push({ source: a, target: b, kind }); }
  for (const n of nodes) {
    if (n._ms) for (const mid of n._ms) linkIds(n.id, mid, 'milestone');
    const blob = Object.values(n.detail || {}).join(' ');
    for (const m of (blob.match(/\bM-\d{3,}\b/g) || [])) linkIds(n.id, m, 'milestone');
    for (const r of (blob.match(/\b[TURDL]-\d{3,}\b/g) || [])) linkIds(n.id, r, 'ref');
    for (const w of (blob.match(/\[\[([^\]]+)\]\]/g) || [])) { const raw = w.slice(2, -2).trim(); const tid = byLabel.get(raw.toLowerCase()) || (byId.has(raw) ? raw : null); if (tid) linkIds(n.id, tid, 'link'); }
  }
  // feature-graph.md (선택) — "A -> B" / "A uses B" 의존 라인 → feature 노드/엣지.
  const fg = path.join(root, '.harness', 'feature-graph.md');
  if (exists(fg)) {
    try {
      for (const line of read(fg).split(/\r?\n/)) {
        const m = line.match(/([\w./-]+)\s*(?:->|→|depends on|uses)\s*([\w./-]+)/i);
        if (m) { const a = 'feat:' + m[1], b = 'feat:' + m[2]; add({ id: a, type: 'feature', status: '', label: _trunc(m[1], 40), detail: { feature: m[1] } }); add({ id: b, type: 'feature', status: '', label: _trunc(m[2], 40), detail: { feature: m[2] } }); linkIds(a, b, 'feature'); }
      }
    } catch {}
  }

  for (const n of nodes) delete n._ms;  // 내부 보조 필드 임베드 제외
  const counts = {};
  for (const n of nodes) counts[n.type] = (counts[n.type] || 0) + 1;
  return { project: rd.project || path.basename(root), version: rd.version || '', root, counts, nodes, edges };
}

// `leerness graph --html [path] [--out file] [--json]` 핸들러.
function graphHtmlCmd(root, deps = {}, outFile) {
  root = absRoot(root);
  const { has, quiet } = deps;  // quiet: auto-gen(handoff) 시 사람용 3줄 로그 억제
  const data = buildGraphData(root, deps);
  const out = outFile || (has && has('--out') && deps.arg ? path.resolve(root, deps.arg('--out')) : path.join(root, 'leerness.html'));
  // 임베드 안전화: 모든 '<' → < 로 치환해 </script>·<!-- 차단(JSON 문자열 내부라 런타임엔 '<' 복원). function 치환기로 $-특수문자(예: $&) 회피.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = TEMPLATE.replace('/*__DATA__*/null', () => json);
  writeUtf8(out, html);
  const summary = { ok: true, file: out, nodes: data.nodes.length, edges: data.edges.length, counts: data.counts };
  if (has && has('--json')) { process.stdout.write(JSON.stringify(summary, null, 2) + '\n'); return summary; }
  if (!quiet) {
    log(`leerness.html → ${out}`);
    log(`  ${data.nodes.length} nodes · ${data.edges.length} links · ${Object.entries(data.counts).map(([k, v]) => k + ':' + v).join(' ')}`);
    log(`  open in a browser to explore the ontology graph (click a node → details).`);
  }
  return summary;
}

module.exports = { graphHtmlCmd, buildGraphData };
