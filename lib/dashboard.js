 
//
 
 
//
 
 
 
 
 
 
 
 
 
 
 
//
 
 
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { absRoot, exists, read, log, ok, warn, failJson, now } = require('./io');

const LEERNESS_DASHBOARD_PORT = 5338;    

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _readJson(root, name) {
  const f = path.join(absRoot(root), '.leerness', name);
  if (!exists(f)) return { ok: true, missing: true, data: null };
  try {
    const st = fs.statSync(f);
    if (st.size > 4 * 1024 * 1024) return { ok: false, reason: `파일이 큼(${Math.round(st.size / 1048576)}MB)`, data: null };
    return { ok: true, data: JSON.parse(read(f)) };
  } catch (e) { return { ok: false, reason: 'JSON 파싱 실패', data: null }; }
}

 
 
 
function _asList(res, label, notes) {
  if (!res.ok) { notes.push(`${label}: ${res.reason}`); return []; }
  if (res.missing || res.data == null) return [];
  if (!Array.isArray(res.data)) { notes.push(`${label}: 배열이 아닙니다 — 표시하지 않습니다`); return []; }
  const items = res.data.filter(x => x && typeof x === 'object' && !Array.isArray(x));
  if (items.length !== res.data.length) notes.push(`${label}: 형상이 다른 항목 ${res.data.length - items.length}건 제외`);
  return items;
}

 
 
 
 
const _redact = require('./pure-utils').redactSecrets;

 
 
function snapshot(root, deps = {}) {
  root = absRoot(root);
  const { VERSION, _roadmapData, _loadToggles, _toggleRegistry, _loadDecisions, _loadLessons } = deps;
  const notes = [];

  const rd = (typeof _roadmapData === 'function' ? _roadmapData(root) : {}) || {};
  const tasks = Array.isArray(rd.tasks) ? rd.tasks : [];
  const milestones = Array.isArray(rd.milestones) ? rd.milestones : [];

  const toggleState = (typeof _loadToggles === 'function' ? _loadToggles(root) : {}) || {};
  const registry = _toggleRegistry || {};
  const toggles = Object.keys(registry).map(id => ({
    id, on: toggleState[id] === true,
    defaultOff: !!(registry[id] || {}).defaultOff,
    desc: (registry[id] || {}).desc || '',
    affects: (registry[id] || {}).affects || '',
  }));

   
   
   
  let previewChecked;
  try {
    previewChecked = typeof deps._loadPreviewsChecked === 'function'
      ? deps._loadPreviewsChecked(root)
      : require('./clarify')._loadPreviewsChecked(root);
  } catch {
    previewChecked = { list: [], invalid: true, code: 'store_unreadable' };
  }
  const previewList = previewChecked.invalid ? [] : previewChecked.list;
  if (previewChecked.invalid) {
    notes.push(`previews.json: 승인 상태를 확인할 수 없음 (${previewChecked.code || 'store_invalid'}) — 표시하지 않습니다`);
  }
  const routingList = _asList(_readJson(root, 'routing-log.json'), 'routing-log.json', notes);
  const bugfixList = _asList(_readJson(root, 'bugfix-receipts.json'), 'bugfix-receipts.json', notes);
   
  let _sibOk;
  try { _sibOk = require('./bugfix')._siblingScopeOk; } catch { _sibOk = null; }
  if (typeof _sibOk !== 'function') _sibOk = (sc) => !!sc && ((Array.isArray(sc.checked) && sc.checked.length > 0) || (typeof sc.notApplicable === 'string' && !!sc.notApplicable.trim()));

  const statusCount = {};
  tasks.forEach(t => { const s = String(t.status || '?'); statusCount[s] = (statusCount[s] || 0) + 1; });

  const handoffPath = path.join(root, '.leerness', 'session-handoff.md');
  const handoff = exists(handoffPath)
    ? { exists: true, updated: (() => { try { return fs.statSync(handoffPath).mtime.toISOString(); } catch { return null; } })(),
        ageDays: (() => { try { return Math.floor((Date.now() - fs.statSync(handoffPath).mtimeMs) / 86400000); } catch { return null; } })() }
    : { exists: false, updated: null, ageDays: null };

  const decisions = (typeof _loadDecisions === 'function' ? _loadDecisions(root) : []) || [];
  const lessons = (typeof _loadLessons === 'function' ? _loadLessons(root) : []) || [];

  return {
    ok: true,
    version: VERSION || null,
    root,
    generatedAt: now(),
    readOnly: true,
    gateNote: '게이트는 CLI 가 판정합니다 — 이 대시보드는 읽기만 하며 게이트를 실행하거나 통과시키지 않습니다(leerness gate).',
    staticNote: '정적 단일 파일 뷰는 그대로 있습니다 — leerness graph --html (leerness.html, 프로세스 없이 열림).',
    tasks: {
      total: tasks.length, byStatus: statusCount,
      recent: tasks.slice(-12).reverse().map(t => ({ id: _redact(t.id, 24), status: _redact(t.status, 24), request: _redact(t.request, 90), updated: t.updated || null })),
    },
    milestones: {
      total: milestones.length,
      list: milestones.slice(0, 12).map(m => ({ id: _redact(m.id, 24), title: _redact(m.title, 90), status: _redact(m.status, 24), progress: m.progress == null ? null : m.progress })),
    },
    toggles,
    handoff,
    memory: { decisions: decisions.length, lessons: lessons.length },
    previewApproval: {
      known: !previewChecked.invalid,
      pendingCount: previewChecked.invalid ? null : previewList.filter(p => p.status === 'proposed' || p.status === 'revision-requested').length,
      code: previewChecked.invalid ? (previewChecked.code || 'store_invalid') : null,
    },
    previews: previewList.slice(-12).reverse().map(p => ({ id: _redact(p.id, 24), title: _redact(p.title, 80), status: _redact(p.status, 24) })),
    routing: routingList.slice(-8).reverse().map(r => ({
      at: typeof r.at === 'string' ? r.at.slice(0, 32) : null,
      tier: _redact(r.tier, 16), confidence: _redact(r.confidence, 16),
      state: r.executed ? '실행' : r.confirmed ? '확정' : (r.requested === 'confirm' || r.requested === 'dispatch') ? '거부' : '제안',
      task: _redact(r.task, 60),
    })),
     
    bugfix: bugfixList.slice(-20).map(b => ({
      id: _redact(b.id, 24), repro: _redact(b.repro, 60),
      rootCause: typeof b.rootCause === 'string' && !!b.rootCause.trim(),
      siblingScope: _sibOk(b.siblingScope),
    })),
    bugfixTotal: bugfixList.length,
    notes,
  };
}

 
const _LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0:0:0:0:0:0:0:1']);
function _hostAllowed(raw) {
  const h = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!h) return false;                                    
  let name;
  if (h.startsWith('[')) { const end = h.indexOf(']'); if (end < 0) return false; name = h.slice(0, end + 1); }
  else name = h.split(':')[0];
  return _LOCAL_HOSTS.has(name);
}

function _row(cells) { return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`; }

function renderHtml(s) {
  const t = (x) => _esc(x);
  const toggleRows = s.toggles.map(g => _row([
    `<span class="${g.on ? 'on' : 'off'}">${g.on ? 'ON' : 'OFF'}</span>`,
    `<code>${t(g.id)}</code>${g.defaultOff ? ' <span class="tag">기본 OFF</span>' : ''}`,
    t(g.desc), `<code>${t(g.affects)}</code>`,
  ])).join('');
  const taskRows = s.tasks.recent.map(x => _row([`<code>${t(x.id)}</code>`, t(x.status), t(x.request), t(x.updated || '')])).join('');
  const msRows = s.milestones.list.map(m => _row([`<code>${t(m.id)}</code>`, t(m.title), t(m.status || ''), m.progress == null ? '' : t(m.progress + '%')])).join('');
  const pvRows = s.previews.map(p => _row([`<code>${t(p.id)}</code>`, t(p.title), t(p.status)])).join('');
  const previewEmpty = s.previewApproval && s.previewApproval.known === false
    ? `승인 상태 확인 불가 (${t(s.previewApproval.code || 'approval_state_unavailable')}) — 빈 목록으로 간주하지 않음`
    : '미리보기 없음';
  const rtRows = s.routing.map(r => _row([t(String(r.at).slice(0, 16)), t(r.tier), t(r.confidence), t(r.state), t(r.task)])).join('');
  const bfRows = s.bugfix.map(b => _row([`<code>${t(b.id)}</code>`, `<code>${t(b.repro)}</code>`, b.rootCause ? '기록됨' : '미기록', b.siblingScope ? '기록됨' : '미기록'])).join('');
  const statusLine = Object.entries(s.tasks.byStatus).map(([k, v]) => `${t(k)} ${v}`).join(' · ');
  const sec = (title, head, rows, empty) => rows
    ? `<section><h2>${title}</h2><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></section>`
    : `<section><h2>${title}</h2><p class="empty">${empty}</p></section>`;

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>leerness 대시보드 — ${t(path.basename(s.root))}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark}
body{font:14px/1.6 -apple-system,"Segoe UI",system-ui,sans-serif;margin:0;padding:24px;max-width:1100px}
h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:28px 0 8px;border-bottom:1px solid #8884;padding-bottom:4px}
.meta{opacity:.7;font-size:12px} .note{background:#8881;border-left:3px solid #888;padding:8px 12px;margin:12px 0;font-size:13px}
table{border-collapse:collapse;width:100%;font-size:13px} th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #8883;vertical-align:top}
th{font-weight:600;opacity:.75;font-size:12px} code{font-family:ui-monospace,Consolas,monospace;font-size:12px}
.on{color:#1a7f37;font-weight:700} .off{opacity:.55;font-weight:700} .tag{font-size:11px;opacity:.6;border:1px solid #8886;border-radius:3px;padding:0 4px}
.empty{opacity:.55} .cnt{display:inline-block;margin-right:16px}
</style></head><body>
<h1>leerness 대시보드</h1>
<div class="meta">v${t(s.version)} · ${t(s.root)} · ${t(s.generatedAt)} · <strong>읽기 전용</strong></div>
<div class="note">${t(s.gateNote)}</div>
<div class="note">${t(s.staticNote)}</div>
${s.notes.length ? `<div class="note">⚠ ${s.notes.map(t).join(' · ')}</div>` : ''}
<section><h2>요약</h2>
<p><span class="cnt">task ${s.tasks.total} (${statusLine || '없음'})</span>
<span class="cnt">마일스톤 ${s.milestones.total}</span>
<span class="cnt">결정 ${s.memory.decisions}</span>
<span class="cnt">교훈 ${s.memory.lessons}</span>
<span class="cnt">핸드오프 ${s.handoff.exists ? t(s.handoff.ageDays) + '일 전' : '없음'}</span></p></section>
${sec('기능 토글', ['상태', 'id', '설명', '영향'], toggleRows, '토글 없음')}
${sec('최근 task', ['id', '상태', '내용', '갱신'], taskRows, 'task 없음')}
${sec('마일스톤', ['id', '제목', '상태', '진행'], msRows, '마일스톤 없음')}
${sec('기능 미리보기(승인 워크플로)', ['id', '제목', '상태'], pvRows, previewEmpty)}
${sec('라우팅 기록', ['시각', '난이도', '신뢰도', '결과', '작업'], rtRows, '라우팅 기록 없음')}
${sec('bugfix probe', ['task', 'probe', '근본원인', '형제범위'], bfRows, '등록된 probe 없음')}
<section><h2>이 화면이 하지 않는 일</h2><ul>
<li>설정을 바꾸지 않습니다 — 변경은 CLI(<code>leerness toggle set …</code>)로 합니다.</li>
<li>외부로 아무것도 보내지 않습니다 — 127.0.0.1 에만 바인딩되고 네트워크 요청을 하지 않습니다.</li>
<li>상태를 바꾸는 CLI 명령은 로컬 사용량 카운터(<code>.leerness/cache/usage-stats.json</code>)를 갱신할 수 있습니다. 이 대시보드와 명시된 읽기 전용 명령은 사용량 카운터도 갱신하지 않으며, 하네스 상태(토글·task·플랜·기록)를 건드리지 않습니다.</li>
</ul></section>
</body></html>`;
}

 
function dashboardCmd(root, deps = {}) {
  const { has, arg } = deps;
  root = absRoot(root);
  const json = !!(has && has('--json'));
  if (!exists(path.join(root, '.leerness'))) { failJson(json, 'harness_missing', `leerness 미설치: ${root} — 먼저 leerness init`); return; }

   
  if (json) { log(JSON.stringify(snapshot(root, deps), null, 2)); return; }

   
   
  const _portArg = (arg ? arg('--port', '') : '');
  let port = LEERNESS_DASHBOARD_PORT;
  if (_portArg && _portArg !== true) {
    const n = parseInt(_portArg, 10);
    if (!Number.isFinite(n) || n < 0 || n > 65535) { failJson(false, 'invalid_port', `--port 는 0~65535 (받음: ${_portArg}) — 0 은 OS 가 빈 포트를 고릅니다`); return; }
    port = n;
  }
  const _toArg = (arg ? arg('--timeout', '') : '');
  const _TIMEOUT_MAX = 86400;    
  let timeoutSec = 1800;
  if (_toArg && _toArg !== true) {
    const n = parseInt(_toArg, 10);
    if (!Number.isFinite(n) || n < 5 || n > _TIMEOUT_MAX) { failJson(false, 'invalid_timeout', `--timeout 은 5~${_TIMEOUT_MAX}초 (받음: ${_toArg})`); return; }
    timeoutSec = n;
  }

  const server = http.createServer((req, res) => {
    const send = (code, type, body) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
      res.end(body);
    };
     
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(405, 'text/plain; charset=utf-8', 'method not allowed'); return; }
     
     
     
    if (!_hostAllowed(req.headers.host)) { send(403, 'text/plain; charset=utf-8', 'forbidden host'); return; }
    let p;
    try { p = decodeURIComponent(String(req.url || '/').split('?')[0]); }
    catch { send(400, 'text/plain; charset=utf-8', 'bad request'); return; }
     
    if (p === '/' || p === '/index.html') { send(200, 'text/html; charset=utf-8', renderHtml(snapshot(root, deps))); return; }
    if (p === '/api/state') { send(200, 'application/json; charset=utf-8', JSON.stringify(snapshot(root, deps), null, 2)); return; }
    send(404, 'text/plain; charset=utf-8', 'not found');
  });

  const _pv = require('./preview-serve');
  _pv._listenWithFallback(server, port, '127.0.0.1', (actual, moved) => {
    const url = `http://127.0.0.1:${actual}/`;
    ok(`leerness 대시보드 실행 중 — ${url}`);
    if (moved) warn(`  ⓘ 기본 포트 ${port} 사용 중 → 비어 있는 ${actual} 로 자동 전환`);
    log(`  읽기 전용입니다 — 설정 변경과 게이트 판정은 CLI 가 합니다.`);
    log(`  JSON: ${url}api/state  ·  서버 없이: leerness dashboard --json`);
    log(`  ⓘ ${timeoutSec}초 후 자동 종료(Ctrl+C 로 즉시 종료).`);
    const stop = (why) => { try { server.close(); } catch {} log(`  ⏹ 대시보드 종료(${why})`); process.exit(0); };
    const t = setTimeout(() => stop('timeout'), timeoutSec * 1000);
    if (t.unref) t.unref();
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));
  }, (e, tried) => { failJson(false, 'serve_failed', `대시보드 서버 시작 실패: ${e && e.message} (마지막 시도 포트 ${tried})`); });
}

module.exports = { dashboardCmd, snapshot, renderHtml, _esc, LEERNESS_DASHBOARD_PORT };
