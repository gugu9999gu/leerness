// lib/dashboard.js — 하네스 대시보드 (1.36.90, P-0006 · 사용자 승인 범위 = **대시보드만**).
//
// 사용자 요청: "leerness.html 을 없애고 .harness 내용·설정을 코드로 두고, 루트 실행기로 서버를 띄워
//   게이트 활성화·디자인 미리보기·플랜/핸드오프/이력을 서버에서 보고 싶다."
//
// 검토(codex 27차 + 자체)에서 **넘지 않기로 한 경계** — 승인 시 preview 스토어에 기록했다:
//   · `.harness` 에 실행 코드를 두지 않는다. npm 패키지가 코드를 소유하고 `.harness` 는 데이터만 갖는다.
//     복사본을 두면 패키지가 올라가도 각 저장소의 사본은 얼어붙어, 업그레이드 1회가 저장소 N곳의
//     코드 마이그레이션 N회가 된다(스키마 드리프트 · 보안 수정 미반영 · 사용자 저장소의 검토 부담).
//   · 루트에 실행기 파일을 **기본 생성하지 않는다**. 의존성으로 설치된 도구가 사용자 저장소에 추적 파일을
//     심지 않는다. 실행기는 이미 있다 — `leerness` CLI 다.
//   · **게이트를 서버가 판정하지 않는다.** 게이트의 가치는 CI 에서 exit code 로 판정된다는 데 있다.
//     서버가 살아있는 것과 게이트가 통과한 것이 혼동되면 안 되고, 서버가 꺼져 있을 때 조용히 통과해서도 안 된다.
//     여기서는 **읽기만** 한다.
//   · `leerness.html`(정적 단일 파일)은 존속한다 — 프로세스 없이 더블클릭, 오프라인, 단일 파일 공유,
//     프로세스 실행이 제한된 환경, 보는 동안 변하지 않는 스냅샷은 서버가 대체하지 못한다.
//
// 보안: 127.0.0.1 에만 바인딩 · GET 외 거부 · URL→파일 매핑 없음(경로 탐색 표면 자체가 없다) ·
//   Host 헤더 검사(DNS rebinding) · 모든 삽입값 HTML 이스케이프 · 쓰기 엔드포인트 없음.
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { absRoot, exists, read, log, ok, warn, failJson, now } = require('./io');

const LEERNESS_DASHBOARD_PORT = 5338;   // preview serve(5337) 바로 옆 — 동시 사용 가능

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _readJson(root, name) {
  const f = path.join(absRoot(root), '.harness', name);
  if (!exists(f)) return { ok: true, missing: true, data: null };
  try {
    const st = fs.statSync(f);
    if (st.size > 4 * 1024 * 1024) return { ok: false, reason: `파일이 큼(${Math.round(st.size / 1048576)}MB)`, data: null };
    return { ok: true, data: JSON.parse(read(f)) };
  } catch (e) { return { ok: false, reason: 'JSON 파싱 실패', data: null }; }
}

// 1.36.90 (codex 29차 #1): JSON 문법만 보고 **형상**을 안 봐서, `[null]` 이 `p.id` 에서 던져
//   서버 프로세스를 죽였고 `{}`(배열 아님)는 경고 없이 "비어 있음"으로 보였다.
//   배열이 아니면 그 사실을 notes 에 남기고, 원소는 객체만 통과시킨다.
function _asList(res, label, notes) {
  if (!res.ok) { notes.push(`${label}: ${res.reason}`); return []; }
  if (res.missing || res.data == null) return [];
  if (!Array.isArray(res.data)) { notes.push(`${label}: 배열이 아닙니다 — 표시하지 않습니다`); return []; }
  const items = res.data.filter(x => x && typeof x === 'object' && !Array.isArray(x));
  if (items.length !== res.data.length) notes.push(`${label}: 형상이 다른 항목 ${res.data.length - items.length}건 제외`);
  return items;
}

// 시크릿 마스킹 — probe 명령·작업 제목 같은 자유 텍스트에 토큰이 섞여 들어올 수 있다.
//   화면과 /api/state 는 사람이 보는 표면이므로, 값 자체를 내보내지 않는다(키 이름은 남겨 맥락 유지).
const _SECRET_ASSIGN = /\b([A-Za-z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH)[A-Za-z0-9_]*)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi;
const _SECRET_SHAPE = /\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{16,}|gho_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g;
function _redact(s, max) {
  let out = String(s == null ? '' : s).replace(_SECRET_ASSIGN, (m, k) => `${k}=***`).replace(_SECRET_SHAPE, '***');
  if (max && out.length > max) out = out.slice(0, max) + '…';
  return out;
}

// 스냅샷 — **읽기 전용**. 원본 파일을 그대로 뿌리지 않고 표시할 필드만 골라 담는다
//   (원문 덤프는 시크릿·개인정보가 섞여 나갈 수 있는 표면을 만든다).
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

  const previewList = _asList(_readJson(root, 'previews.json'), 'previews.json', notes);
  const routingList = _asList(_readJson(root, 'routing-log.json'), 'routing-log.json', notes);
  const bugfixList = _asList(_readJson(root, 'bugfix-receipts.json'), 'bugfix-receipts.json', notes);
  // 형제범위 판정은 게이트와 **같은 술어**를 쓴다 — 표면마다 다시 구현하면 불일치가 되살아난다(codex 29차 #3).
  let _sibOk;
  try { _sibOk = require('./bugfix')._siblingScopeOk; } catch { _sibOk = null; }
  if (typeof _sibOk !== 'function') _sibOk = (sc) => !!sc && ((Array.isArray(sc.checked) && sc.checked.length > 0) || (typeof sc.notApplicable === 'string' && !!sc.notApplicable.trim()));

  const statusCount = {};
  tasks.forEach(t => { const s = String(t.status || '?'); statusCount[s] = (statusCount[s] || 0) + 1; });

  const handoffPath = path.join(root, '.harness', 'session-handoff.md');
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
    previews: previewList.slice(-12).reverse().map(p => ({ id: _redact(p.id, 24), title: _redact(p.title, 80), status: _redact(p.status, 24) })),
    routing: routingList.slice(-8).reverse().map(r => ({
      at: typeof r.at === 'string' ? r.at.slice(0, 32) : null,
      tier: _redact(r.tier, 16), confidence: _redact(r.confidence, 16),
      state: r.executed ? '실행' : r.confirmed ? '확정' : (r.requested === 'confirm' || r.requested === 'dispatch') ? '거부' : '제안',
      task: _redact(r.task, 60),
    })),
    // 목록 상한을 건다 — 수천 건이 쌓인 스토어가 HTML 을 폭증시키지 않게(codex 29차 #2).
    bugfix: bugfixList.slice(-20).map(b => ({
      id: _redact(b.id, 24), repro: _redact(b.repro, 60),
      rootCause: typeof b.rootCause === 'string' && !!b.rootCause.trim(),
      siblingScope: _sibOk(b.siblingScope),
    })),
    bugfixTotal: bugfixList.length,
    notes,
  };
}

// Host 허용 판정 — 부재는 거부(fail-closed), IPv6 대괄호를 먼저 벗긴 뒤 포트를 자른다.
const _LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0:0:0:0:0:0:0:1']);
function _hostAllowed(raw) {
  const h = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!h) return false;                                   // Host 없는 요청은 받지 않는다
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
${sec('기능 미리보기(승인 워크플로)', ['id', '제목', '상태'], pvRows, '미리보기 없음')}
${sec('라우팅 기록', ['시각', '난이도', '신뢰도', '결과', '작업'], rtRows, '라우팅 기록 없음')}
${sec('bugfix probe', ['task', 'probe', '근본원인', '형제범위'], bfRows, '등록된 probe 없음')}
<section><h2>이 화면이 하지 않는 일</h2><ul>
<li>설정을 바꾸지 않습니다 — 변경은 CLI(<code>leerness toggle set …</code>)로 합니다.</li>
<li>게이트를 실행하거나 통과시키지 않습니다 — <code>leerness gate</code> 의 exit code 가 판정입니다.</li>
<li>외부로 아무것도 보내지 않습니다 — 127.0.0.1 에만 바인딩되고 네트워크 요청을 하지 않습니다.</li>
<li>다만 <strong>완전한 무기록은 아닙니다</strong>: leerness CLI 는 모든 명령에서 로컬 사용량 카운터(<code>.harness/cache/usage-stats.json</code>)를 갱신합니다. 하네스 상태(토글·task·플랜·기록)는 이 화면이 건드리지 않습니다.</li>
</ul></section>
</body></html>`;
}

// `leerness dashboard [--port N] [--timeout SEC] [--json]`
function dashboardCmd(root, deps = {}) {
  const { has, arg } = deps;
  root = absRoot(root);
  const json = !!(has && has('--json'));
  if (!exists(path.join(root, '.harness'))) { failJson(json, 'harness_missing', `leerness 미설치: ${root} — 먼저 leerness init`); return; }

  // --json 은 서버를 띄우지 않고 스냅샷만 낸다 — CI·스크립트·테스트가 서버 없이 같은 데이터를 쓴다.
  if (json) { log(JSON.stringify(snapshot(root, deps), null, 2)); return; }

  // 1.36.90 (codex 29차 #6): 범위를 안 보면 `--port 99999` 가 listen() 에서 RangeError 로 죽고,
  //   `--timeout 2147484` 는 setTimeout 상한(약 24.8일)을 넘겨 **즉시** 발화한다(안내한 시간과 정반대).
  const _portArg = (arg ? arg('--port', '') : '');
  let port = LEERNESS_DASHBOARD_PORT;
  if (_portArg && _portArg !== true) {
    const n = parseInt(_portArg, 10);
    if (!Number.isFinite(n) || n < 0 || n > 65535) { failJson(false, 'invalid_port', `--port 는 0~65535 (받음: ${_portArg}) — 0 은 OS 가 빈 포트를 고릅니다`); return; }
    port = n;
  }
  const _toArg = (arg ? arg('--timeout', '') : '');
  const _TIMEOUT_MAX = 86400;   // 하루 — setTimeout 상한(2^31-1 ms) 훨씬 아래로 잡아 오버플로 자체를 없앤다
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
    // 쓰기 메서드는 아예 받지 않는다 — 이 서버에는 상태를 바꾸는 경로가 없다.
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(405, 'text/plain; charset=utf-8', 'method not allowed'); return; }
    // DNS rebinding 방어: 로컬 바인딩이어도 외부 도메인이 127.0.0.1 을 가리키면 브라우저가 요청을 보낼 수 있다.
    //   1.36.90 (codex 29차 #5): 종전엔 (a) Host 부재를 **통과**시켰고(fail-open) (b) `:` 로 잘라
    //   `[::1]:5338` 이 `[` 가 되어 허용 목록에 있는데도 거부됐다. 부재는 거부하고, IPv6 대괄호를 먼저 처리한다.
    if (!_hostAllowed(req.headers.host)) { send(403, 'text/plain; charset=utf-8', 'forbidden host'); return; }
    let p;
    try { p = decodeURIComponent(String(req.url || '/').split('?')[0]); }
    catch { send(400, 'text/plain; charset=utf-8', 'bad request'); return; }
    // URL → 파일 매핑이 없다. 경로 목록이 고정이라 경로 탐색 표면 자체가 존재하지 않는다.
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
