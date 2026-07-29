// lib/preview-serve.js — 라이브 미리보기 (1.36.80, 사용자 요청 UR-0067).
//   문제: 시안(preview mockup)이 "파일로만" 존재해 사용자가 직접 열어야 했다. 요청: 임시 워크스페이스에 프로젝트에 맞춰
//   생성하고 로컬 서버로 띄워 확인한 뒤, 확인이 끝나면 임시 워크스페이스를 정리.
//   모드(사용자 지시): A=self(기본) 자립형 HTML 을 0-deps node http 로 제공 — 어떤 스택에서도 즉시 동작.
//                     B=project(옵트인) 프로젝트의 정적 디렉토리에 시안을 배치해 **프로젝트 자신의 dev 서버**로 확인.
//   미설정이면 강제하지 않고 A 로 진행하되 선택 질문을 출력한다(false-PASS 편향 — 흐름을 막지 않는다).
//   leerness 는 사용자의 dev 서버를 임의로 실행하지 않는다(사용자 코드 실행은 명시 옵트인 영역).
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { absRoot, exists, read, writeUtf8, mkdirp, log, ok, warn, failJson, now } = require('./io');

function _cfgPath(root) { return path.join(absRoot(root), '.harness', 'preview-config.json'); }

function loadPreviewConfig(root) {
  const f = _cfgPath(root);
  if (!exists(f)) return { mode: null, devUrl: '', staticDir: '' };
  try {
    const j = JSON.parse(read(f));
    const mode = (j && (j.mode === 'self' || j.mode === 'project')) ? j.mode : null;
    return { mode, devUrl: (j && typeof j.devUrl === 'string') ? j.devUrl : '', staticDir: (j && typeof j.staticDir === 'string') ? j.staticDir : '' };
  } catch { return { mode: null, devUrl: '', staticDir: '', corrupt: true }; }
}

function savePreviewConfig(root, cfg, json) {
  const f = _cfgPath(root);
  if (exists(f)) { try { JSON.parse(read(f)); } catch { failJson(json, 'store_corrupt', `preview-config.json 손상 — 덮어쓰기 거부: ${f}`); return false; } }
  mkdirp(path.dirname(f));
  writeUtf8(f, JSON.stringify({ ...cfg, updatedAt: now() }, null, 2) + '\n');
  return true;
}

// 모드 미설정 시 사용자에게 물을 질문 — 강제하지 않고 기본(A)로 진행하며 선택지를 제시한다.
function modeQuestionLines(root) {
  return [
    '  ❓ 미리보기 모드가 아직 정해지지 않았습니다 — 기본값 A(자립형)로 진행합니다. 사용자에게 확인하세요:',
    '     (A) self    — 자립형 HTML 을 leerness 로컬 서버로 확인 (0 의존성 · 어떤 스택이든 즉시 · 오프라인)',
    '     (B) project — 프로젝트 정적 디렉토리에 배치해 프로젝트 자신의 dev 서버로 확인 (스택 정합 ↑ · dev 서버는 사용자가 실행)',
    '     → 설정: leerness preview mode self   |   leerness preview mode project --static-dir public --dev-url http://localhost:5173',
  ];
}

// 임시 워크스페이스 — 확인이 끝나면(승인/수정요구) 정리된다. 시안 원본(.harness/previews/<id>-mockup.html)은 건드리지 않는다.
function serveDir(root, id) { return path.join(absRoot(root), '.harness', 'previews', `.serve-${id}`); }

function cleanupServeDir(root, id) {
  let cleaned = false;
  const d = serveDir(root, id);
  try { if (exists(d)) { fs.rmSync(d, { recursive: true, force: true }); cleaned = true; } } catch {}
  // (검수 #8) project 모드로 프로젝트 정적 디렉토리에 배치한 사본도 함께 정리 — "확인 끝나면 정리한다"는 안내와 실제를 일치시킨다.
  try {
    const cfgF = _cfgPath(root);
    if (exists(cfgF)) {
      const j = JSON.parse(read(cfgF));
      const placed = (j && j.placed && j.placed[id]) ? j.placed[id] : null;
      if (placed) {
        const abs = path.resolve(absRoot(root), placed);
        const rel = path.relative(absRoot(root), abs);
        if (!rel.startsWith('..') && !path.isAbsolute(rel) && exists(abs)) { fs.rmSync(abs, { force: true }); cleaned = true; }
        delete j.placed[id];
        writeUtf8(cfgF, JSON.stringify(j, null, 2) + '\n');
      }
    }
  } catch {}
  return cleaned;
}

// 프로젝트의 디자인 토큰(있으면)을 임시 워크스페이스로 복사 — 시안이 프로젝트 톤과 어긋나지 않게.
//   빌드가 필요한 산출물은 복사하지 않는다(leerness 는 사용자 프로젝트를 빌드하지 않는다).
const _TOKEN_CANDIDATES = ['.harness/design-system.md', 'src/styles/tokens.css', 'src/styles/variables.css', 'styles/tokens.css', 'src/index.css', 'src/app.css', 'app/globals.css'];
function _collectTokens(root) {
  const found = [];
  for (const rel of _TOKEN_CANDIDATES) {
    const p = path.join(root, rel);
    try { if (exists(p) && fs.statSync(p).isFile() && fs.statSync(p).size <= 256 * 1024) found.push({ rel, text: read(p) }); } catch {}
    if (found.length >= 2) break;
  }
  return found;
}

function buildServeWorkspace(root, p) {
  const srcRel = p.mockupPath || path.join('.harness', 'previews', `${p.id}-mockup.html`);
  const src = path.isAbsolute(srcRel) ? srcRel : path.join(root, srcRel);
  // (검수 #12) 검증 실패 시 빈 .serve-* 디렉토리가 남던 것 — 검증을 먼저, 생성은 그 뒤에.
  if (!exists(src)) return { ok: false, error: `시안 파일 없음: ${srcRel} — 먼저 leerness preview mockup ${p.id}` };
  const dir = serveDir(root, p.id);
  mkdirp(dir);
  let html = read(src);
  const tokens = _collectTokens(root);
  if (tokens.length) {
    // (검수 #9) 프로젝트 CSS 를 <style> 안에 그대로 넣으면 CSS 안의 `</style><script>` 가 탈출해 스크립트가 실행됐다.
    //   → 별도 스타일시트 파일로 쓰고 <link> 로 연결(문자열 탈출 자체가 불가능). 외부 리소스 0 은 그대로 유지(같은 워크스페이스).
    const css = tokens.filter(t => /\.css$/.test(t.rel)).map(t => `/* from ${t.rel} */\n${t.text}`).join('\n');
    const noteRels = tokens.map(t => t.rel).join(', ');
    let inject = '';
    if (css) { writeUtf8(path.join(dir, 'project-tokens.css'), css); inject += `<link rel="stylesheet" href="project-tokens.css">\n`; }
    inject += `<!-- leerness: project design context — ${_escComment(noteRels)} -->\n`;
    html = html.replace('</head>', inject + '</head>');
  }
  writeUtf8(path.join(dir, 'index.html'), html);
  return { ok: true, dir, tokens: tokens.map(t => t.rel) };
}
function _escComment(s) { return String(s).replace(/--+/g, '-').replace(/[<>]/g, ''); }

const _MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8' };

// 1.36.80 (사용자 지시): leerness 시그니처 포트 — 전화 키패드의 "LEER"(5-3-3-7). ollama:11434 처럼 기억 가능한 고정값.
//   이미 사용 중이면 뒤로 순차 탐색(최대 20) → 그래도 없으면 OS 임의 빈 포트(0). 어떤 경우에도 "포트 충돌로 실패"하지 않는다.
const LEERNESS_PREVIEW_PORT = 5337;
function _listenWithFallback(server, preferred, host, onReady, onFail) {
  const tries = [];
  for (let i = 0; i < 20; i++) tries.push(preferred + i);
  tries.push(0);   // 마지막 수단: OS 가 비어 있는 포트를 준다
  let idx = 0;
  const attempt = () => {
    const port = tries[idx];
    const onErr = (e) => {
      server.removeListener('error', onErr);
      if ((e && (e.code === 'EADDRINUSE' || e.code === 'EACCES')) && idx < tries.length - 1) { idx++; setImmediate(attempt); return; }
      onFail(e, port);
    };
    server.once('error', onErr);
    // 성공 시 실제 바인딩된 포트로 판단한다 — `port !== preferred` 는 port 0(OS 할당) 경로에서도 어긋나고,
    //   무엇보다 "선호 포트가 막혀 옮겨갔다"는 사실은 실제 주소로만 정확히 알 수 있다(실측: 5338 인데 false 보고).
    server.listen(port, host, () => { server.removeListener('error', onErr); const a = server.address().port; onReady(a, preferred > 0 && a !== preferred); });
  };
  attempt();
}

// `leerness preview serve <P-ID> [--port N] [--timeout SEC] [--keep]`
function previewServeCmd(root, id, deps = {}) {
  const { has, arg, previews } = deps;
  root = absRoot(root);
  const json = !!(has && has('--json'));
  const p = (previews || []).find(x => x.id === id);
  if (!p) { failJson(json, 'not_found', `preview 없음: ${id}`); return; }
  const cfg = loadPreviewConfig(root);
  const mode = cfg.mode || 'self';

  if (mode === 'project') {
    // B(옵트인): 프로젝트 정적 디렉토리에 배치 — dev 서버 실행은 사용자 몫(사용자 코드를 leerness 가 임의 실행하지 않음)
    const staticDir = (arg ? arg('--static-dir', '') : '') || cfg.staticDir || 'public';
    const destDir = path.resolve(root, staticDir);
    const rel = path.relative(root, destDir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) { failJson(json, 'static_dir_outside_root', `--static-dir 은 프로젝트 안이어야 합니다: ${destDir}`); return; }
    // (검수 #5) 렉시컬 검사만으론 정션/심볼릭 링크로 프로젝트 밖에 쓰는 것을 못 막는다 — 실제 경로로 재확인.
    try {
      const _rootReal2 = fs.realpathSync(root);
      let probe = destDir;
      while (!exists(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);   // 존재하는 최근접 조상
      const realProbe = fs.realpathSync(probe);
      const relReal2 = path.relative(_rootReal2, realProbe);
      if (relReal2.startsWith('..') || path.isAbsolute(relReal2)) { failJson(json, 'static_dir_outside_root', `--static-dir 이 링크를 통해 프로젝트 밖을 가리킵니다: ${destDir} → ${realProbe}`); return; }
    } catch {}
    const built = buildServeWorkspace(root, p);
    if (!built.ok) { failJson(json, 'mockup_missing', built.error); return; }
    mkdirp(destDir);
    const destFile = path.join(destDir, `leerness-preview-${p.id}.html`);
    writeUtf8(destFile, read(path.join(built.dir, 'index.html')));
    // (검수 #8) 배치 위치를 기록해 승인/수정 시 정확히 회수한다(추측 삭제 금지 — 기록된 경로만 지운다).
    try {
      const cur = exists(_cfgPath(root)) ? JSON.parse(read(_cfgPath(root))) : {};
      cur.placed = cur.placed && typeof cur.placed === 'object' ? cur.placed : {};
      cur.placed[p.id] = path.relative(root, destFile).replace(/\\/g, '/');
      writeUtf8(_cfgPath(root), JSON.stringify(cur, null, 2) + '\n');
    } catch {}
    const urlBase = (arg ? arg('--dev-url', '') : '') || cfg.devUrl || 'http://localhost:3000';
    const url = `${String(urlBase).replace(/\/$/, '')}/leerness-preview-${p.id}.html`;
    const relFile = path.relative(root, destFile).replace(/\\/g, '/');
    if (json) { log(JSON.stringify({ ok: true, mode: 'project', id: p.id, file: relFile, url, note: 'dev 서버는 사용자가 실행합니다' }, null, 2)); return; }
    ok(`시안 배치(project 모드): ${relFile}`);
    log(`  → 프로젝트 dev 서버를 실행한 뒤 열기: ${url}`);
    log(`  ⓘ leerness 는 사용자의 dev 서버를 자동 실행하지 않습니다. 확인이 끝나면: leerness preview approve ${p.id} (배치본도 함께 정리)`);
    return;
  }

  // A(기본): 자립형 HTML 을 0-deps 로컬 서버로
  const built = buildServeWorkspace(root, p);
  if (!built.ok) { failJson(json, 'mockup_missing', built.error); return; }
  const _portArg = (arg ? arg('--port', '') : '');
  const port = (_portArg && _portArg !== true) ? Math.max(0, parseInt(_portArg, 10) || 0) : LEERNESS_PREVIEW_PORT;
  const timeoutSec = Math.max(5, parseInt((arg ? arg('--timeout', '') : '') || '600', 10) || 600);
  const _rootReal = (() => { try { return fs.realpathSync(built.dir); } catch { return path.resolve(built.dir); } })();
  const server = http.createServer((req, res) => {
    // (검수 #4) ① 잘못된 인코딩(%E0%A4%A)이 URIError 로 서버를 죽였다 → 400. ② startsWith 는 형제 디렉토리
    //   (.serve-P-0001-secret)를 통과시켰다 → path.relative 로 정확 판정. ③ 정션/심볼릭 링크로 밖을 가리키면
    //   렉시컬 검사만으론 못 막는다 → realpath 로 실제 위치까지 확인.
    let rel;
    try { rel = decodeURIComponent(String(req.url || '/').split('?')[0]); }
    catch { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end('bad request'); return; }
    if (rel === '/' || rel === '') rel = '/index.html';
    const fp = path.resolve(built.dir, '.' + rel);
    const relCheck = path.relative(_rootReal, fp);
    if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) { res.writeHead(403); res.end('forbidden'); return; }
    let realFp = fp;
    try { realFp = fs.realpathSync(fp); } catch { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
    const relReal = path.relative(_rootReal, realFp);
    if (relReal.startsWith('..') || path.isAbsolute(relReal)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(realFp, (err, buf) => {   // 실검사를 통과한 실제 경로로 읽는다
      if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': _MIME[path.extname(realFp).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(buf);
    });
  });
  _listenWithFallback(server, port, '127.0.0.1', (actual, moved) => {
    const url = `http://127.0.0.1:${actual}/`;
    if (json) { log(JSON.stringify({ ok: true, mode: 'self', id: p.id, url, port: actual, preferredPort: port, portFallback: !!moved, timeoutSec, workspace: path.relative(root, built.dir).replace(/\\/g, '/'), tokens: built.tokens }, null, 2)); }
    else {
      ok(`라이브 미리보기 실행 중 — ${url}`);
      if (moved) warn(`  ⓘ 기본 포트 ${port} 사용 중 → 비어 있는 ${actual} 로 자동 전환`);
      log(`  시안: ${p.id} 「${p.title}」`);
      if (built.tokens.length) log(`  프로젝트 디자인 컨텍스트 반영: ${built.tokens.join(', ')}`);
      if (!cfg.mode) modeQuestionLines(root).forEach(l => log(l));
      log(`  → 사용자에게 이 주소를 열어 확인받고, 승인: leerness preview approve ${p.id} · 수정요구: leerness preview revise ${p.id} --note "..."`);
      log(`  ⓘ ${timeoutSec}초 후 자동 종료(Ctrl+C 로 즉시 종료). 확인이 끝나면 임시 워크스페이스는 승인/수정 시 자동 정리됩니다.`);
    }
    const stop = (why) => {
      try { server.close(); } catch {}
      if (!(has && has('--keep'))) cleanupServeDir(root, p.id);
      if (!json) log(`  ⏹ 미리보기 종료(${why})${(has && has('--keep')) ? ' — 임시 워크스페이스 보존(--keep)' : ' — 임시 워크스페이스 정리됨'}`);
      process.exit(0);
    };
    const t = setTimeout(() => stop('timeout'), timeoutSec * 1000);
    if (t.unref) t.unref();
    process.on('SIGINT', () => stop('SIGINT'));
    process.on('SIGTERM', () => stop('SIGTERM'));
  }, (e, tried) => { failJson(json, 'serve_failed', `로컬 서버 시작 실패: ${e && e.message} (마지막 시도 포트 ${tried})`); });
}

// `leerness preview mode [self|project] [--static-dir public] [--dev-url http://localhost:5173]`
function previewModeCmd(root, val, deps = {}) {
  const { has, arg } = deps;
  root = absRoot(root);
  const json = !!(has && has('--json'));
  const cfg = loadPreviewConfig(root);
  if (!val) {
    if (json) { log(JSON.stringify({ ok: true, mode: cfg.mode, effective: cfg.mode || 'self', devUrl: cfg.devUrl, staticDir: cfg.staticDir, corrupt: cfg.corrupt || undefined }, null, 2)); return; }
    log(`# leerness preview mode — ${cfg.mode ? cfg.mode : '(미설정 → 기본 self)'}`);
    if (cfg.staticDir) log(`  static-dir: ${cfg.staticDir}`);
    if (cfg.devUrl) log(`  dev-url: ${cfg.devUrl}`);
    if (!cfg.mode) modeQuestionLines(root).forEach(l => log(l));
    return;
  }
  if (val !== 'self' && val !== 'project') { failJson(json, 'invalid_mode', `preview mode <self|project> — 받은 값: ${val}`); return; }
  const next = { mode: val, devUrl: (arg ? (arg('--dev-url', '') || cfg.devUrl) : cfg.devUrl) || '', staticDir: (arg ? (arg('--static-dir', '') || cfg.staticDir) : cfg.staticDir) || '' };
  if (next.devUrl === true) next.devUrl = ''; if (next.staticDir === true) next.staticDir = '';
  if (!savePreviewConfig(root, next, json)) return;
  if (json) { log(JSON.stringify({ ok: true, ...next }, null, 2)); return; }
  ok(`preview mode = ${val}`);
  if (val === 'project') log(`  static-dir: ${next.staticDir || 'public'} · dev-url: ${next.devUrl || 'http://localhost:3000'} (dev 서버는 사용자가 실행)`);
}

// _listenWithFallback 공개(1.36.90): 대시보드가 **같은 런타임**을 쓴다 — 두 번째 서버 구현을 만들지 않는다.
module.exports = { LEERNESS_PREVIEW_PORT, previewServeCmd, previewModeCmd, loadPreviewConfig, savePreviewConfig, cleanupServeDir, serveDir, modeQuestionLines, buildServeWorkspace, _listenWithFallback };
