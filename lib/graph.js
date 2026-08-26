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
// 1.36.96 (P-0010): 📄 문서 탭의 시크릿 마스킹은 dashboard 와 **같은 술어**를 쓴다.
//   표면마다 다시 구현하면 한쪽만 고쳐지는 불일치가 생긴다(1.36.88→1.36.90 에서 이미 겪은 클래스).
const _redact = require('./pure-utils').redactSecrets;
//   1.36.96: 마스킹이 **완벽해야 하는 구조를 버렸다** — 자격증명 표지가 있는 문서는 본문을 싣지 않는다.
const _hasCred = require('./pure-utils').hasCredentialMarker;

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
#tabs{display:flex;gap:2px;border:1px solid var(--line);border-radius:8px;padding:2px}
.tab{padding:4px 12px;border-radius:6px;cursor:pointer;font-size:11px;color:var(--mut);user-select:none}
.tab.on{background:#1a2230;color:#fff}
.view{position:fixed;inset:0;top:46px;overflow:auto;background:var(--bg);display:none;padding:22px 26px;z-index:5}
.view.on{display:block}
.ms{border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 12px;background:var(--panel)}
.ms h3{margin:0 0 8px;font-size:13px;color:#fff}
.bar{height:7px;border-radius:5px;background:#1a2230;overflow:hidden;margin:6px 0}
.bar i{display:block;height:100%;background:var(--brand)}
.tk{display:flex;gap:8px;align-items:baseline;padding:3px 0;font-size:12px}
.tk .st{width:86px;flex:none;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
.sec{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.07em;margin:20px 0 8px}
.tgrow{display:flex;align-items:center;gap:14px;border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 10px;background:var(--panel)}
.sw2{position:relative;width:40px;height:22px;flex:none;border-radius:100px;background:#30363d;cursor:pointer;transition:background .15s}
.sw2.on{background:var(--brand)}
.sw2 i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s}
.sw2.on i{left:21px}
.tgname{font-weight:700;color:#fff;width:150px;flex:none}
.tgdesc{color:var(--mut);font-size:11px;flex:1}
.cmd{display:none;margin-top:8px;background:#0b0f14;border:1px solid var(--line);border-radius:7px;padding:8px 10px;font-size:11px;color:#7ee787}
.cmd.show{display:flex;align-items:center;gap:10px}
.cmd button{background:#1a2230;border:1px solid var(--line);color:var(--txt);border-radius:5px;padding:3px 9px;cursor:pointer;font:inherit;font-size:10px}
.note{color:var(--mut);font-size:11px;margin:14px 0 18px;line-height:1.6}
/* 📄 문서 탭 (1.36.96, P-0010) */
.dwrap{display:flex;gap:16px;align-items:flex-start}
.dnav{flex:0 0 190px;position:sticky;top:70px}
.dnav div{padding:7px 10px;border-radius:7px;cursor:pointer;font-size:12px;color:var(--mut);user-select:none}
.dnav div.on{background:#1a2230;color:#fff}
.dbody{flex:1;min-width:0;border:1px solid var(--line);border-radius:10px;padding:16px 22px;background:var(--panel)}
.md h1,.md h2,.md h3,.md h4,.md h5,.md h6{color:#fff;line-height:1.35;margin:18px 0 10px}
.md h1{font-size:20px}.md h2{font-size:17px}.md h3{font-size:15px}.md h4,.md h5,.md h6{font-size:13px}
.md p{margin:0 0 10px;line-height:1.7;word-break:break-word}
.md ul,.md ol{margin:0 0 10px;padding-left:22px}
.md li{margin:3px 0;line-height:1.65}
.md pre{background:#0b0f14;border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow:auto;margin:0 0 12px}
.md code{font-family:var(--mono);font-size:12px;color:#7ee787}
.md pre code{color:#c9d1d9}
.md table{border-collapse:collapse;margin:0 0 12px;display:block;overflow-x:auto}
.md th,.md td{border:1px solid var(--line);padding:6px 10px;font-size:12px;text-align:left}
.md th{background:#141b23;color:#fff}
.md a{color:#58a6ff}
/*   좁은 화면에서 190px 고정 내비가 자리를 다 먹어 본문이 한 글자씩 세로로 흘렀다(실제 브라우저에서 확인).
     테스트로는 안 보이는 종류라 눈으로 봐야 잡힌다. 좁아지면 내비를 가로 칩으로 접는다. */
@media (max-width:760px){
  .dwrap{flex-direction:column}
  .dnav{position:static;flex:0 0 auto;display:flex;flex-wrap:wrap;gap:4px;width:100%}
  .dnav div{border:1px solid var(--line)}
  .dbody{width:100%;padding:14px 16px}
}
</style></head><body>
<div id="bar">
  <div class="ttl"><span class="dot"></span><span id="proj">leerness</span><span style="color:var(--mut);font-weight:400">/ ontology</span></div>
  <div id="tabs"><span class="tab on" data-v="graph">그래프</span><span class="tab" data-v="roadmap">로드맵</span><span class="tab" data-v="tech">🛠 기술</span><span class="tab" data-v="docs">📄 문서</span></div>
  <span class="stat" id="stat"></span>
  <input id="search" placeholder="search nodes…" autocomplete="off">
  <div id="chips"></div>
</div>
<canvas id="c"></canvas>
<div id="panel"><span class="x" onclick="closePanel()">✕</span><div id="pbody"></div></div>
<div id="empty">No nodes — run <b>leerness handoff .</b> to populate the harness, then regenerate.</div>
<div id="hint">drag node · scroll zoom · drag bg pan · click node → details · search+Enter jump · f / dblclick fit · p export PNG · Esc close</div>
<div id="vroadmap" class="view"></div>
<div id="vtech" class="view"></div>
<div id="vdocs" class="view"></div>
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

// ── 탭 (1.36.53, UR-0062): 그래프 | 로드맵 | 🛠 기술 (토글 스위치 UI 제거 → CLI 가이드로 대체) ──
var _views={roadmap:document.getElementById('vroadmap'),tech:document.getElementById('vtech'),docs:document.getElementById('vdocs')};
document.querySelectorAll('.tab').forEach(function(t){t.onclick=function(){
  document.querySelectorAll('.tab').forEach(function(x){x.classList.toggle('on',x===t);});
  var v=t.getAttribute('data-v');
  Object.keys(_views).forEach(function(k){_views[k].classList.toggle('on',k===v);});
  document.getElementById('hint').style.display=(v==='graph')?'':'none';
  if(v!=='graph')closePanel();
};});

// 로드맵 뷰 — DATA.roadmap (roadmap.html 기능 통합)
(function(){
  var rd=(DATA&&DATA.roadmap)||{};var el=_views.roadmap;var h='';
  var ms=rd.milestones||[],tk=rd.tasks||[];
  h+='<div class="sec">Milestones ('+ms.length+')</div>';
  if(!ms.length)h+='<div class="note">milestone 없음 — leerness plan add "제목" 으로 추가</div>';
  ms.forEach(function(m){var pg=parseInt(m.progress,10)||0;
    h+='<div class="ms"><h3>'+esc(m.id)+' · '+esc(m.title)+' <span style="color:var(--mut);font-weight:400">'+esc(m.status||'')+' '+pg+'%</span></h3>'
      +'<div class="bar"><i style="width:'+Math.min(100,pg)+'%"></i></div>'
      +(m.nextAction?'<div style="color:var(--mut);font-size:11px">next: '+esc(m.nextAction)+'</div>':'')+'</div>';});
  var byS={};tk.forEach(function(t){(byS[t.status||'requested']=byS[t.status||'requested']||[]).push(t);});
  h+='<div class="sec">Tasks ('+tk.length+')</div>';
  ['in-progress','blocked','waiting','planned','requested','done','verified'].forEach(function(s){var arr=byS[s];if(!arr||!arr.length)return;
    h+='<div class="ms"><h3 style="color:'+(STATUSCOL[s]||'#8b949e')+'">'+s+' ('+arr.length+')</h3>';
    arr.slice(0,40).forEach(function(t){h+='<div class="tk"><span class="st" style="color:'+(STATUSCOL[s]||'#8b949e')+'">'+esc(t.id)+'</span><span>'+esc(t.request)+'</span></div>';});
    if(arr.length>40)h+='<div class="note">… +'+(arr.length-40)+'</div>';h+='</div>';});
  if(rd.skills&&rd.skills.length){h+='<div class="sec">Skills ('+rd.skills.length+')</div><div class="ms">'+rd.skills.map(function(s){return '<div class="tk"><span>'+esc(s.name||s.id||s)+'</span></div>';}).join('')+'</div>';}
  if(rd.rules&&rd.rules.length){h+='<div class="sec">Active Rules</div><div class="ms">'+rd.rules.filter(function(r){return r.status==='active';}).map(function(r){return '<div class="tk"><span>'+esc(r.rule||r.text||'')+'</span></div>';}).join('')+'</div>';}
  el.innerHTML=h;
})();

// 🛠 기술 뷰 (1.36.53, UR-0062) — DATA.tech: 개발 언어 + 연결 서비스 + 변경 이력(마이그레이션/언어 전환).
//   토글은 스위치 UI 대신 상태 표 + CLI 사용 가이드 (실제 적용은 항상 CLI — 정적 HTML 은 상태를 바꿀 수 없다).
(function(){
  var el=_views.tech;var h='';
  var tp=(DATA&&DATA.tech)||{};var cur=tp.current||{languages:[],services:[]};var hist=tp.history||[];
  h+='<div class="sec">개발 언어 ('+cur.languages.length+')</div><div class="ms">';
  if(!cur.languages.length)h+='<div class="note">감지된 언어 없음 — 소스/매니페스트가 생기면 자동 감지</div>';
  cur.languages.forEach(function(l){h+='<div class="tk"><span class="st">'+esc(l.id)+'</span><span style="color:var(--mut)">'+esc(l.evidence||'')+'</span></div>';});
  h+='</div><div class="sec">연결 서비스 ('+cur.services.length+')</div><div class="ms">';
  if(!cur.services.length)h+='<div class="note">감지된 서비스 없음 — 의존성/.env 키/설정파일에서 자동 감지</div>';
  cur.services.forEach(function(s){h+='<div class="tk"><span class="st">'+esc(s.id)+'</span><span style="color:var(--mut)">'+esc(s.evidence||'')+'</span></div>';});
  h+='</div><div class="sec">변경 이력 ('+hist.length+') — 서비스 마이그레이션·언어 전환 자동 추적</div><div class="ms">';
  if(!hist.length)h+='<div class="note">변경 이력 없음 — 언어/서비스가 바뀌면 leerness tech·handoff 가 자동 기록</div>';
  hist.slice(-12).reverse().forEach(function(d){var ps=[];
    (d.addedLanguages||[]).length&&ps.push('+언어 '+d.addedLanguages.join(','));
    (d.removedLanguages||[]).length&&ps.push('-언어 '+d.removedLanguages.join(','));
    (d.addedServices||[]).length&&ps.push('+서비스 '+d.addedServices.join(','));
    (d.removedServices||[]).length&&ps.push('-서비스 '+d.removedServices.join(','));
    h+='<div class="tk"><span class="st">'+esc(String(d.at||'').slice(0,16))+'</span><span>'+esc(ps.join(' · '))+'</span></div>';});
  h+='</div>';
  // 토글: 상태 표 + CLI 가이드 (1.36.53: 스위치 UI 제거 — 사용자 요청)
  var tg=(DATA&&DATA.toggles)||{};var reg=(DATA&&DATA.toggleRegistry)||{};
  h+='<div class="sec">기능 토글 상태 (변경은 CLI)</div><div class="ms">';
  Object.keys(reg).forEach(function(id){var on=tg[id]!==false;var m=reg[id]||{};
    h+='<div class="tk"><span class="st" style="color:'+(on?'#3fb950':'#8b949e')+'">'+(on?'ON ':'OFF')+'</span><span><b>'+esc(id)+'</b> — '+esc(m.desc||'')+'</span></div>';});
  h+='</div><div class="sec">사용 가이드</div><div class="ms"><div class="note" style="line-height:1.8">'
    +'· 토글 목록/상태: <b>leerness toggle list</b><br>'
    +'· 켜기/끄기: <b>leerness toggle set &lt;gate|lens|auto-graph|delegation-brief&gt; on|off</b><br>'
    +'· 기술 프로필 갱신: <b>leerness tech</b> (handoff 실행 시 자동 갱신·변경 이력 기록)<br>'
    +'· 이 파일은 정적 HTML — 상태 변경은 터미널(또는 AI)에게 위 명령을 실행시키세요. AI 는 토글 상태를 자동 준수합니다.</div></div>';
  el.innerHTML=h;
})();

// ── 📄 문서 탭 (1.36.96, P-0010) — .leerness 핵심 문서 7종을 이 파일 안에서 그대로 읽는다.
//   렌더러는 **최소 부분집합**만 해석한다: 제목 · 목록 · 코드펜스 · 표 · 링크 · 강조.
//   그 밖의 모든 것(원시 HTML 포함)은 이스케이프된 평문으로 남는다 — 파서를 넓힐수록 XSS 면이 넓어진다.
//   이 템플릿은 String.raw 라 리터럴 백틱을 쓸 수 없다(템플릿이 끊긴다) → 정규식/문자열에서 \x60 을 쓴다.
function mdEsc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
// URL 허용: http(s) · mailto · 페이지앵커 · 상대경로. 그 외 **스킴이 붙은 것은 전부 거부**(javascript:, data:, vbscript: …).
//   브라우저 URL 파서는 탭/개행/CR 을 **제거한 뒤** 스킴을 읽는다 — 실측으로 확인했다(java + 탭 + script:
//   를 href 에 넣으면 protocol 이 javascript: 로 나온다). 지금은 링크 토크나이저가 공백류를 배제해 그런
//   입력이 애초에 링크가 되지 않지만 그건 **우연한 안전**이다. 토크나이저를 나중에 넓히면 되살아난다.
//   (이 주석에 백틱을 쓰면 String.raw 템플릿이 거기서 끊긴다 — 바로 위에 적어 놓고 한 번 어겼다.)
//   판정 전에 브라우저와 같은 문자를 제거해, 우리가 보는 것과 브라우저가 보는 것을 일치시킨다.
//   탭·개행뿐 아니라 **C0 제어문자와 DEL 전부**를 제거한다 — 검수 실측에서 \x03·\x01·\x00·\x1F·\x7F 를
//   앞이나 중간에 끼우면 스킴 판정을 빠져나갔다. 브라우저는 그런 문자를 URL 에서 무시하거나 제거한다.
function mdUrl(u){var t=String(u||'').replace(/[\x00-\x1F\x7F]/g,'').trim();
  //   브라우저는 역슬래시를 슬래시처럼 읽는다 — 역슬래시 2개로 시작하는 값은 프로토콜 상대 URL 로 해석된다
  //   (검수 실측: file://host/share, HTTPS 페이지에서는 https://host/share). 종전엔 슬래시 2개만 막았다.
  if(/^[\\/]{2}/.test(t))return null;
  if(/^(https?:\/\/|mailto:|#)/i.test(t))return t;
  if(/^[a-z][a-z0-9+.\-]*:/i.test(t))return null;
  return t;}
function mdInline(s){
  // 코드스팬을 **먼저** 뽑아 자리표시자로 치환한다 — 안쪽의 * 나 [](…) 가 강조/링크로 해석되면 안 된다.
  //   자리표시자는 U+0001 로 감싼다(이스케이프된 본문에 절대 나타나지 않는 문자). 감싸는 문자를 빠뜨리면
  //   복원 정규식이 본문의 **모든 숫자**를 삼킨다 — 초안에서 실제로 그랬다.
  //   문서에 U+0001 이 실제로 들어 있으면 자리표시자와 충돌한다 — 먼저 지운다(표시용 텍스트라 무해).
  var out=mdEsc(s).replace(/[\x01\x02]/g,''),codes=[],links=[];
  out=out.replace(/\x60([^\x60]+)\x60/g,function(m,c){codes.push(c);return '\x01'+(codes.length-1)+'\x01';});
  //   수량자를 **유계**로 둔다. 종전 [^\]]* 는 닫히지 않은 대괄호마다 남은 문자열 전체를 다시 훑어 O(n²) 였다
  //   (실측: 64KB 입력 1,825ms · 최악 2,730ms — 그만큼 브라우저 메인 스레드가 멈춘다).
  //   상한을 넘는 링크는 링크가 되지 않고 글자로 남는다(계약상 안전한 쪽으로 실패한다).
  //   URL 상한은 **이스케이프 후** 길이에 걸린다 — 원문 796자짜리 정상 쿼리 URL 이 & → &amp; 팽창으로
  //   1,192자가 되어 거부됐다(검수 실측). 실측 비교로 라벨 300 / URL 4000 을 골랐다:
  //   최악 115ms(무계는 1,747ms)이고 그 URL 은 링크된다.
  out=out.replace(/\[([^\]\n]{0,300})\]\(([^)\s]{1,4000})\)/g,function(m,t,u){var v=mdUrl(u);
    if(v===null)return m;
    //   완성된 <a> 도 자리표시자로 빼 둔다 — 뒤따르는 강조 정규식이 href 안까지 다시 해석해
    //   href="https://a/<b>b</b>/c" 처럼 URL 을 훼손했다(검수 실측).
    links.push('<a href="'+v+'" target="_blank" rel="noopener noreferrer">'+t+'</a>');
    return '\x02'+(links.length-1)+'\x02';});
  out=out.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
  out=out.replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<i>$2</i>');
  out=out.replace(/\x02(\d+)\x02/g,function(m,i){return links[i];});
  out=out.replace(/\x01(\d+)\x01/g,function(m,i){return '<code>'+codes[i]+'</code>';});
  return out;}
function mdRender(src){
  var ls=String(src||'').split(/\r?\n/),h='',i=0,list=null,olNext=0;
  function endList(){if(list){h+='</'+list+'>';list=null;}}
  function cells(r){return r.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|').map(function(c){return c.trim();});}
  while(i<ls.length){
    var l=ls[i];
    if(/^\s*\x60{3,}/.test(l)){                       // 코드펜스 — 안쪽은 어떤 규칙도 적용하지 않는다
      endList();var buf=[];i++;
      while(i<ls.length&&!/^\s*\x60{3,}\s*$/.test(ls[i])){buf.push(ls[i]);i++;}
      i++;h+='<pre><code>'+mdEsc(buf.join('\n'))+'</code></pre>';continue;}
    var hd=l.match(/^(#{1,6})\s+(.*)$/);
    if(hd){endList();var n=hd[1].length;h+='<h'+n+'>'+mdInline(hd[2])+'</h'+n+'>';i++;continue;}
    if(l.indexOf('|')>=0&&i+1<ls.length&&ls[i+1].indexOf('|')>=0&&/^[\s:|\-]*-[\s:|\-]*$/.test(ls[i+1])){
      endList();
      //   구분행의 콜론을 문법으로는 받으면서 정렬을 버리면 사용자가 지정한 의미가 조용히 사라진다(검수 실측).
      //   받은 이상 반영한다 — 왼쪽/가운데/오른쪽. (이 템플릿 안 주석에는 백틱을 쓸 수 없다.)
      var al=cells(ls[i+1]).map(function(c){
        var lft=c.charAt(0)===':',rgt=c.charAt(c.length-1)===':';
        return lft&&rgt?' style="text-align:center"':(rgt?' style="text-align:right"':(lft?' style="text-align:left"':''));});
      var A=function(k){return al[k]||'';};
      h+='<table><thead><tr>'+cells(l).map(function(c,k){return '<th'+A(k)+'>'+mdInline(c)+'</th>';}).join('')+'</tr></thead><tbody>';
      i+=2;
      while(i<ls.length&&ls[i].indexOf('|')>=0&&ls[i].trim()!==''){
        h+='<tr>'+cells(ls[i]).map(function(c,k){return '<td'+A(k)+'>'+mdInline(c)+'</td>';}).join('')+'</tr>';i++;}
      h+='</tbody></table>';continue;}
    var ul=l.match(/^\s*[-*+]\s+(.*)$/),ol=l.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if(ul||ol){var want=ul?'ul':'ol';
      //   원문 번호를 지키지 않으면 "2. two" 가 브라우저에서 "1. two" 로, 1·3 이 1·2 로 표시된다
      //   — 문서의 의미가 조용히 바뀐다(검수 실측). 시작값은 ol start, 건너뛴 번호는 li value 로 보존한다.
      if(list!==want){endList();h+=want==='ol'?('<ol start="'+ol[1]+'">'):'<ul>';list=want;olNext=ol?parseInt(ol[1],10):0;}
      if(ul){h+='<li>'+mdInline(ul[1])+'</li>';}
      else{var num=parseInt(ol[1],10);h+=(num===olNext?'<li>':'<li value="'+num+'">')+mdInline(ol[2])+'</li>';olNext=num+1;}
      i++;continue;}
    if(!l.trim()){endList();i++;continue;}
    endList();h+='<p>'+mdInline(l)+'</p>';i++;}
  endList();return h;}

(function(){
  var dd=(DATA&&DATA.docs)||{files:[]},el=_views.docs,fl=dd.files||[];
  if(!fl.length){el.innerHTML='<div class="note">문서 없음 — leerness handoff . 로 .leerness 를 채우고 재생성하세요.</div>';return;}
  var kb=function(n){return Math.round((n||0)/1024)+'KB';};
  el.innerHTML='<div class="note">스냅샷 '+esc(String(dd.at||'').slice(0,19).replace('T',' '))+' UTC · 이 파일은 <b>정적 사본</b>입니다 — 최신 내용은 <b>leerness graph --html</b> 로 재생성하세요. 시크릿 값은 가려집니다(문서당 '+kb(dd.perCap)+' · 전체 '+kb(dd.totalCap)+' 상한).</div>'
    +'<div class="dwrap"><div class="dnav">'
    +fl.map(function(f,i){return '<div data-i="'+i+'"'+(i===0?' class="on"':'')+'>'+esc(f.title)+(f.missing?' <span style="color:var(--mut)">(없음)</span>':(f.guarded?' <span style="color:var(--mut)">🔒</span>':(f.truncated?' <span style="color:var(--mut)">✂</span>':'')))+'</div>';}).join('')
    +'</div><div class="dbody md" id="dbody"></div></div>';
  var body=document.getElementById('dbody');
  function show(i){
    var f=fl[i]||{},h='<div class="sec" style="margin-top:0">'+esc(f.title||'')+' <span style="color:var(--mut);font-weight:400;font-size:11px">'+esc(f.rel||'')+'</span></div>';
    if(f.missing){h+='<div class="note">아직 없는 파일입니다 — <b>leerness handoff .</b> 실행 시 생성됩니다.</div>';}
    //   자격증명 표지가 있는 문서는 **본문을 싣지 않는다** — 부분 마스킹의 빈틈으로 새는 것을 구조적으로 막는다.
    else if(f.guarded){h+='<div class="note">🔒 이 문서에는 <b>자격증명으로 보이는 내용</b>이 있어 본문을 싣지 않았습니다('+(f.charsTotal||0)+'자). 파일을 직접 여세요: '+esc(f.rel||'')+'<br>이 파일은 공유될 수 있으므로, 부분적으로 가리는 대신 통째로 제외합니다.</div>';}
    else if(f.unreadable){h+='<div class="note">읽지 못했습니다(권한/인코딩). 원본 파일은 그대로입니다 — 직접 여세요.</div>';}
    else if(f.skipped){h+='<div class="note">⚠ 전체 상한('+kb(dd.totalCap)+')에 도달해 <b>담기지 않았습니다</b> — 원본 '+(f.charsTotal||0)+'자. '+esc(f.rel||'')+' 를 직접 여세요.</div>';}
    else{
      //   "자" 는 코드포인트다 — String.length 를 쓰면 이모지 문서에서 두 배로 표시된다(검수 실측).
      if(f.truncated)h+='<div class="note">⚠ 상한으로 잘렸습니다 — '+(f.chars||0)+'/'+(f.charsTotal||0)+'자('+(f.tail?'뒷부분':'앞부분')+'만). 전체는 '+esc(f.rel||'')+' 를 여세요.</div>';
      h+=(f.lang==='json')?('<pre><code>'+mdEsc(f.text||'')+'</code></pre>'):mdRender(f.text||'');}
    body.innerHTML=h;}
  el.querySelectorAll('.dnav div').forEach(function(n){n.onclick=function(){
    el.querySelectorAll('.dnav div').forEach(function(x){x.classList.toggle('on',x===n);});
    show(parseInt(n.getAttribute('data-i'),10));};});
  show(0);
})();
</script></body></html>`;

const _txt = v => (v == null ? '' : String(v));
// 1.36.96 (검수 P1): 문서 탭만 가드했는데 **같은 내용이 nodes·roadmap 으로도 임베드**된다 —
//   `decision add "Authorization: Bearer <토큰>"` 이 DATA.nodes[].label / detail 로 원문 그대로 실렸다(실측).
//   그래프 쪽에는 마스킹조차 없었다. 임베드되는 **모든 사용자 텍스트**를 같은 술어로 통과시킨다.
//   자격증명 표지가 있으면 그 항목 텍스트를 통째로 대체하고, 아니면 2차 마스킹만 적용한다.
const _GUARD_TXT = '🔒 자격증명 표지 — 생략됨';
const _safe = (v) => { const t = _txt(v); return t && _hasCred(t) ? _GUARD_TXT : _redact(t); };
function _trunc(s, n) { s = _safe(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ── 📄 문서 탭 데이터 (1.36.96, P-0010) ──────────────────────────────────────────
//   사용자 요청은 "exe 실행기로 .leerness 마크다운을 띄우기"였다. 실행기는 런타임 의존성 0 · install script 0
//   경계를 깨므로 만들지 않는다(1.36.90 에서 같은 경계를 테스트로 못박았다). 같은 목적을 정적 단일 파일로 이룬다.
//   `tail: true` 는 **누적 로그**다 — 앞을 남기면 가장 오래된 것만 보인다(1.36.95 handoff 에서 겪은 그 방향 오류).
const DOC_FILES = [
  { key: 'plan', title: '플랜 · 로드맵', rel: '.leerness/plan.md' },
  { key: 'skills', title: '스킬', rel: '.leerness/skill-index.md' },
  { key: 'tech', title: '기술 프로필', rel: '.leerness/tech-profile.json', lang: 'json' },
  { key: 'handoff', title: '세션 핸드오프', rel: '.leerness/session-handoff.md' },
  { key: 'state', title: '현재 상태', rel: '.leerness/current-state.md' },
  { key: 'progress', title: '진행 추적', rel: '.leerness/progress-tracker.md', tail: true },
  { key: 'decisions', title: '결정 기록', rel: '.leerness/decisions.md', tail: true },
];
const DOC_PER_CAP = 64 * 1024;
const DOC_TOTAL_CAP = 512 * 1024;
//   ⚠ 오늘의 목록(7종 × 64KB = 448KB)으로는 전체 상한 512KB 에 **도달할 수 없다** — 목록이 8종 이상으로
//   늘 때를 위한 backstop 이다. 그래서 caps 를 주입 가능하게 뒀다: 도달 불가능한 분기는 "있다"고만 적으면
//   공허한 가드가 된다(그 함정을 이 저장소에서 반복해서 밟았다). 테스트가 작은 상한으로 실제로 발화시킨다.

// 줄 경계에서 자르고, 한 줄이 상한보다 길면 **코드포인트** 경계에서 자른다(서로게이트 쌍 분할 금지).
//   1.36.96 (검수 P2): 상한 단위를 **UTF-8 바이트**로 바꿨다. 종전엔 UTF-16 코드 단위를 세면서 "64KB"라고
//   적었고, 한글 문서에서는 문서당 실제 192KB · 합계 1.38MB 까지 실려 주장이 사실과 달랐다(실측: 1,152KB).
const _blen = (x) => Buffer.byteLength(x, 'utf8');
function _capDoc(s, cap, tail) {
  s = _txt(s);
  if (_blen(s) <= cap) return { text: s, truncated: false };
  const ls = s.split('\n');
  let acc = 0, keep = 0;
  if (tail) {
    for (let i = ls.length - 1; i >= 0; i--) { const add = (keep ? 1 : 0) + _blen(ls[i]); if (acc + add > cap) break; acc += add; keep++; }
  } else {
    for (let i = 0; i < ls.length; i++) { const add = (keep ? 1 : 0) + _blen(ls[i]); if (acc + add > cap) break; acc += add; keep++; }
  }
  //   **"무엇을 내용으로 셀지"를 판정하지 않는다.** 이 자리에서 데이터 소실이 세 번 재발했다:
  //     ① `keep > 0` → 경계에 빈 줄 하나면 70,000자가 0자      ② `acc > 0` → 빈 줄 두 개면 1자
  //     ③ 내용 바이트(content) → CRLF 의 `\r` 과 공백/탭이 내용으로 세어져 다시 1~3자
  //   매번 셈을 조금씩 틀렸으므로 셈을 없앤다. 온전한 줄로 채운 뒤, **남은 예산만큼 경계 줄을 코드포인트로
  //   잘라 이어 붙인다**. 어떤 공백 조합에도 예산이 채워지고, 순서가 유지되므로 "앞부분/뒷부분" 고지가 참이 된다.
  //   (한때 둘 중 긴 쪽만 골랐는데, 경계 줄이 길면 **문서의 제목·푸터가 통째로 사라졌다** — 검수 실측.)
  let packed = tail ? ls.slice(ls.length - keep).join('\n') : ls.slice(0, keep).join('\n');
  //   `\n` 으로만 나누므로 CRLF 문서에서는 각 줄 끝에 `\r` 이 남는다. head 방향에서 다음 줄이 안 들어가면
  //   재조립 때 개행이 붙지 않아 **고립된 CR** 이 꼬리에 남는다(검수 실측: "A\r"). 표시 데이터에 제어문자를
  //   남기지 않도록 잘라낸다 — tail 방향은 앞에 개행이 붙으므로 해당 없음.
  if (!tail) packed = packed.replace(/\r$/, '');
  const line = (tail ? ls[ls.length - 1 - keep] : ls[keep]) || '';
  //   경계 줄을 **항상** 잘라 붙이면 평범한 문서까지 줄 중간에서 잘린다("줄 경계 절단" 속성이 깨진다).
  //   혼자서도 상한을 넘는 줄, 즉 **어떤 예산으로도 통째로는 담길 수 없는 줄**일 때만 잘라 붙인다.
  const mustCut = _blen(line) > cap;
  const room = mustCut ? cap - acc - (keep && line ? 1 : 0) : 0;   // 이어 붙일 개행 몫까지 뺀다
  const cps = Array.from(line);
  let n = 0, len = 0;
  if (room > 0) {
    if (tail) { for (let i = cps.length - 1; i >= 0 && len + _blen(cps[i]) <= room; i--) { len += _blen(cps[i]); n++; } }
    else { for (let i = 0; i < cps.length && len + _blen(cps[i]) <= room; i++) { len += _blen(cps[i]); n++; } }
  }
  const part = n ? (tail ? cps.slice(cps.length - n).join('') : cps.slice(0, n).join('')) : '';
  const text = !part ? packed : (!keep ? part : (tail ? part + '\n' + packed : packed + '\n' + part));
  return { text, truncated: true };
}

function buildDocsData(root, nowIso, caps) {
  const perCap = (caps && caps.perCap) || DOC_PER_CAP;
  const totalCap = (caps && caps.totalCap) || DOC_TOTAL_CAP;
  const minSlice = Math.max(256, Math.min(2048, Math.floor(totalCap / 8)));
  const files = [];
  let spent = 0;
  for (const d of DOC_FILES) {
    const base = { key: d.key, title: d.title, rel: d.rel, lang: d.lang || 'md', tail: !!d.tail };
    const p = path.join(root, d.rel);
    if (!exists(p)) { files.push(Object.assign({}, base, { missing: true, text: '', totalChars: 0, truncated: false })); continue; }
    let raw;
    try { raw = read(p); } catch { files.push(Object.assign({}, base, { unreadable: true, text: '', totalChars: 0, truncated: false })); continue; }
    //   **자격증명 표지가 있으면 본문을 싣지 않는다.** 값 단위 마스킹은 다섯 라운드 동안 계속 새어서
    //   안전의 전제에서 뺐다(마스킹은 아래에서 두 번째 방어층으로만 남는다). 실측 비용 0.6%.
    if (_hasCred(raw)) {
      files.push(Object.assign({}, base, {
        guarded: true, text: '', truncated: false,
        totalChars: raw.length, charsTotal: Array.from(raw).length, totalBytes: _blen(raw), bytes: 0, chars: 0,
      }));
      continue;
    }
    const red = _redact(raw);                       // dashboard 와 같은 술어(두 번째 방어층)
    const remain = totalCap - spent;
    // 잔여 예산이 의미 없는 크기면 **조각을 싣지 않고 건너뛴다**. 종전엔 remain<=0 일 때만 건너뛰어
    //   159자짜리 쓸모없는 조각이 "잘림"으로 표시됐다(측정으로 확인). 조각보다 "안 담았다"가 정확하다.
    if (remain < minSlice) { files.push(Object.assign({}, base, { skipped: true, text: '', totalChars: red.length, totalBytes: _blen(red), bytes: 0, truncated: true, chars: 0, charsTotal: Array.from(red).length })); continue; }
    const c = _capDoc(red, Math.min(perCap, remain), !!d.tail);
    spent += _blen(c.text);                                   // 예산도 바이트로 센다(상한과 같은 단위)
    //   화면 고지의 "자" 는 **코드포인트**여야 한다. String.length(UTF-16 코드 단위)를 쓰면 이모지 문서에서
    //   32,767/60,001자 로 나오지만 실제로는 16,384/30,001자다(검수 실측). 세어서 함께 싣는다.
    files.push(Object.assign({}, base, {
      text: c.text, totalChars: red.length, totalBytes: _blen(red), bytes: _blen(c.text), truncated: c.truncated,
      chars: Array.from(c.text).length, charsTotal: Array.from(red).length,
    }));
  }
  return { at: nowIso, perCap, totalCap, spent, files };
}

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
  const fg = path.join(root, '.leerness', 'feature-graph.md');
  if (exists(fg)) {
    try {
      const fgText = read(fg);
      for (const line of fgText.split(/\r?\n/)) {
        const m = line.match(/([\w./-]+)\s*(?:->|→|depends on|uses)\s*([\w./-]+)/i);
        if (m) { const a = 'feat:' + m[1], b = 'feat:' + m[2]; add({ id: a, type: 'feature', status: '', label: _trunc(m[1], 40), detail: { feature: m[1] } }); add({ id: b, type: 'feature', status: '', label: _trunc(m[2], 40), detail: { feature: m[2] } }); linkIds(a, b, 'feature'); }
      }
      // 1.36.30 (codex 미검토표면 #9): CLI 가 생성하는 canonical 형식(## F-XXXX 블록 + depends-on/affects 필드)도 인식.
      //   종전엔 ad-hoc "A -> B" 라인만 파싱해 leerness feature add/link 로 만든 그래프가 HTML 에 0 노드였다.
      if (typeof deps._parseFeatureGraph === 'function') {
        const pf = deps._parseFeatureGraph(fgText) || [];
        for (const f of pf) {
          add({ id: f.id, type: 'feature', status: f.status || '', label: _trunc(f.title || f.id, 48), detail: { title: _txt(f.title), status: _txt(f.status), files: (f.files || []).join(', '), errorModes: (f.errorModes || []).join(', ') } });
        }
        for (const f of pf) {
          for (const d of f.dependsOn || []) linkIds(f.id, d, 'feature');
          for (const a of f.affects || []) linkIds(f.id, a, 'feature');
          for (const c of f.coChangesWith || []) linkIds(f.id, c, 'feature');
        }
      }
    } catch {}
  }

  for (const n of nodes) delete n._ms;  // 내부 보조 필드 임베드 제외
  const counts = {};
  for (const n of nodes) counts[n.type] = (counts[n.type] || 0) + 1;
  // 1.36.30: 로드맵 탭 데이터(roadmap.html 기능 통합) + 토글 상태(⚙ 탭) 임베드.
  const roadmap = {
    milestones: (rd.milestones || []).map(m => ({ id: m.id, title: _trunc(m.title, 90), status: m.status, progress: m.progress, nextAction: _trunc(m.nextAction, 120) })),
    tasks: (rd.tasks || []).map(t => ({ id: t.id, request: _trunc(t.request, 110), status: t.status })),
    skills: (rd.skills || []).map(s => ({ name: _trunc(s.name || s.id || s, 60) })),
    rules: (rd.rules || []).map(r => ({ rule: _trunc(r.rule || r.text || '', 110), status: r.status })),
  };
  const toggles = (typeof deps._loadToggles === 'function' ? deps._loadToggles(root) : {}) || {};
  // 1.36.53 (UR-0062): 기술 프로필 임베드 — 🛠 기술 탭 데이터
  const tech = (typeof deps._loadTechProfile === 'function' ? (deps._loadTechProfile(root) || null) : null) || { current: { languages: [], services: [] }, history: [] };
  const toggleRegistry = deps._toggleRegistry || {};
  //   필드마다 손으로 감싸면 반드시 빠뜨린다(문서 탭만 가드했다가 nodes·roadmap 으로 샜다).
  //   **임베드 직전 한 곳**에서 모든 문자열을 통과시킨다 — 지금 있는 표면도, 나중에 추가될 표면도 함께 덮인다.
  //   id·type 같은 자체 생성 값은 표지에 걸리지 않으므로 무해하다.
  //   **깊이 제한을 두면 그 너머가 통째로 우회한다.** 순환을 막으려 12단계 상한을 뒀더니, 12단계보다 깊은
  //   객체는 그대로 반환돼 그 아래 문자열에 정규화가 아예 걸리지 않았다(검수 실측: tech-profile.json 은
  //   임의 JSON 이라 실 CLI 로 도달 가능). 상한 대신 **방문 집합**으로 순환만 끊는다 — 깊이는 제한하지 않는다.
  //   방문 집합을 **재귀 스택처럼** 써야 한다. 전역 집합으로 두면 같은 객체를 두 필드가 공유할 때
  //   두 번째가 순환이 아닌데도 잘려 나간다(검수 실측: `{first:X, second:X}` 의 second 가 null 이 됐다).
  //   들어갈 때 넣고 **나올 때 뺀다** — 진짜 순환(조상에 자신이 있는 경우)만 끊긴다.
  //   재귀 깊이도 제한하지 않되, 스택이 터지면 그 가지만 표지 문자열로 대체한다(생성 자체가 실패하면 안 된다).
  //   깊이 상한 자체가 문제가 아니라 **상한을 넘겼을 때 원본을 그대로 통과시킨 것**이 문제였다(그게 우회였다).
  //   상한을 넘으면 **자리표시자 문자열로 대체**한다 — 아무것도 새지 않고, 뒤이은 JSON.stringify 도 안전하다
  //   (직렬화 자체가 약 4천 단계에서 스택을 터뜨린다 — 24KB 짜리 유효 JSON 하나로 생성이 실패했다).
  const MAXD = 200;                                // 정상 데이터는 이 근처에도 오지 않는다
  const _deepSafe = (v, path, depth) => {
    if (typeof v === 'string') return _safe(v);
    if (!v || typeof v !== 'object') return v;
    const dep = depth || 0;
    if (dep > MAXD) return _GUARD_TXT;             // fail-safe: 원본이 아니라 표시 문자열로 대체
    const p = path || new Set();
    if (p.has(v)) return null;                     // 조상에 자신이 있다 = 순환 → 잘라낸다
    p.add(v);
    try {
      if (Array.isArray(v)) return v.map(x => _deepSafe(x, p, dep + 1));
      const o = {};
      for (const k of Object.keys(v)) o[k] = _deepSafe(v[k], p, dep + 1);
      return o;
    } finally {
      p.delete(v);                                 // 형제 노드가 공유 참조를 다시 쓸 수 있게 되돌린다
    }
  };
  // 1.36.96 (P-0010): 📄 문서 탭 — .leerness 핵심 문서 7종 스냅샷(마스킹 + 상한 + 잘림 고지).
  const docs = buildDocsData(root, deps.nowIso || new Date().toISOString());
  //   `docs` 는 buildDocsData 에서 **이미 같은 술어를 통과했고 회계(spent/bytes)도 거기서 확정**됐다.
  //   여기서 다시 변환하면 텍스트가 미세하게 바뀌어 "보고한 spent = 실제 임베드 바이트" 불변식이 깨진다
  //   (검수 실측: 1바이트 차이). 두 번 처리하지 않는다.
  const safe = _deepSafe({ project: rd.project || path.basename(root), version: rd.version || '', root, counts, nodes, edges, roadmap, toggles, toggleRegistry, tech });
  safe.docs = docs;
  return safe;
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

module.exports = { graphHtmlCmd, buildGraphData, buildDocsData, _capDoc, DOC_FILES, DOC_PER_CAP, DOC_TOTAL_CAP };
