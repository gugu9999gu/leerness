 
 
 
 
 
 
 
'use strict';
const fs = require('fs');
const { removeSync } = require('./safe-remove');
const http = require('http');
const path = require('path');
const { absRoot, exists, read, writeUtf8, mkdirp, log, ok, warn, failJson, now } = require('./io');
const { _lineSafe } = require('./pure-utils');
const { _previewMockupPathCheck, _previewOutputPathCheck } = require('./clarify');

function _cfgPath(root) { return path.join(absRoot(root), '.leerness', 'preview-config.json'); }

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
  if (exists(f)) { try { JSON.parse(read(f)); } catch { failJson(json, 'store_corrupt', _lineSafe(`preview-config.json 손상 — 덮어쓰기 거부: ${f}`)); return false; } }
  mkdirp(path.dirname(f));
  writeUtf8(f, JSON.stringify({ ...cfg, updatedAt: now() }, null, 2) + '\n');
  return true;
}

 
function modeQuestionLines(root) {
  return [
    '  ❓ 미리보기 모드가 아직 정해지지 않았습니다 — 기본값 A(자립형)로 진행합니다. 사용자에게 확인하세요:',
    '     (A) self    — 자립형 HTML 을 leerness 로컬 서버로 확인 (0 의존성 · 어떤 스택이든 즉시 · 오프라인)',
    '     (B) project — 프로젝트 정적 디렉토리에 배치해 프로젝트 자신의 dev 서버로 확인 (스택 정합 ↑ · dev 서버는 사용자가 실행)',
    '     → 설정: leerness preview mode self   |   leerness preview mode project --static-dir public --dev-url http://localhost:5173',
  ];
}

 
function serveDir(root, id) { return path.join(absRoot(root), '.leerness', 'previews', `.serve-${id}`); }

function cleanupServeDir(root, id) {
  let cleaned = false;
  const d = serveDir(root, id);
  try {
    const dRel = path.relative(absRoot(root), d).replace(/\\/g, '/');
    const checked = _previewOutputPathCheck(root, dRel, { requireDirectory: exists(d) });
     
     
    if (checked.ok && exists(d)) { removeSync(d, { recursive: true, force: true }); cleaned = true; }
  } catch {}
   
  try {
    const cfgF = _cfgPath(root);
    if (exists(cfgF)) {
      const j = JSON.parse(read(cfgF));
      const placed = (j && j.placed && j.placed[id]) ? j.placed[id] : null;
      if (placed) {
        const abs = path.resolve(absRoot(root), placed);
        const rel = path.relative(absRoot(root), abs).replace(/\\/g, '/');
        const checked = _previewOutputPathCheck(root, rel, { requireFile: exists(abs) });
        if (checked.ok && exists(abs)) { removeSync(abs, { force: true }); cleaned = true; }
        delete j.placed[id];
        writeUtf8(cfgF, JSON.stringify(j, null, 2) + '\n');
      }
    }
  } catch {}
  return cleaned;
}

 
 
const _TOKEN_CANDIDATES = ['.leerness/design-system.md', 'src/styles/tokens.css', 'src/styles/variables.css', 'styles/tokens.css', 'src/index.css', 'src/app.css', 'app/globals.css'];
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
  root = absRoot(root);
  if (!p || !/^P-\d{4,}$/.test(String(p.id || ''))) return { ok: false, code: 'invalid_id', error: 'preview id 형식 무효' };
  const srcRel = p.mockupPath || path.join('.leerness', 'previews', `${p.id}-mockup.html`);
  const checkedPath = _previewMockupPathCheck(root, srcRel, { requireFile: true });
  if (!checkedPath.ok) return { ok: false, code: checkedPath.code || 'mockup_path_invalid', error: `시안 경로가 프로젝트를 벗어나거나 형상이 무효입니다: ${_lineSafe(srcRel)}` };
  const src = checkedPath.resolvedPath;
   
  if (!exists(src)) return { ok: false, error: `시안 파일 없음: ${srcRel} — 먼저 leerness preview mockup ${p.id}` };
  const dir = serveDir(root, p.id);
  const dirRel = path.relative(root, dir).replace(/\\/g, '/');
  const checkedDir = _previewOutputPathCheck(root, dirRel, { requireDirectory: exists(dir) });
  if (!checkedDir.ok) return { ok: false, code: checkedDir.code, error: `preview 임시 출력 경로에 링크 또는 무효 조상이 있습니다: ${dirRel}` };
  mkdirp(dir);
  let html = read(src);
  const tokens = _collectTokens(root);
  if (tokens.length) {
     
     
    const css = tokens.filter(t => /\.css$/.test(t.rel)).map(t => `/* from ${t.rel} */\n${t.text}`).join('\n');
    const noteRels = tokens.map(t => t.rel).join(', ');
    let inject = '';
    if (css) {
      const cssRel = path.relative(root, path.join(dir, 'project-tokens.css')).replace(/\\/g, '/');
      const checkedCss = _previewOutputPathCheck(root, cssRel);
      if (!checkedCss.ok) return { ok: false, code: checkedCss.code, error: `preview CSS 출력 경로가 안전하지 않습니다: ${cssRel}` };
      writeUtf8(checkedCss.abs, css);
      inject += `<link rel="stylesheet" href="project-tokens.css">\n`;
    }
    inject += `<!-- leerness: project design context — ${_escComment(noteRels)} -->\n`;
    html = html.replace('</head>', inject + '</head>');
  }
  const indexRel = path.relative(root, path.join(dir, 'index.html')).replace(/\\/g, '/');
  const checkedIndex = _previewOutputPathCheck(root, indexRel);
  if (!checkedIndex.ok) return { ok: false, code: checkedIndex.code, error: `preview HTML 출력 경로가 안전하지 않습니다: ${indexRel}` };
  writeUtf8(checkedIndex.abs, html);
  return { ok: true, dir, tokens: tokens.map(t => t.rel) };
}
function _escComment(s) { return String(s).replace(/--+/g, '-').replace(/[<>]/g, ''); }

const _MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json; charset=utf-8' };

 
 
const LEERNESS_PREVIEW_PORT = 5337;
function _listenWithFallback(server, preferred, host, onReady, onFail) {
  const tries = [];
  for (let i = 0; i < 20; i++) tries.push(preferred + i);
  tries.push(0);    
  let idx = 0;
  const attempt = () => {
    const port = tries[idx];
    const onErr = (e) => {
      server.removeListener('error', onErr);
      if ((e && (e.code === 'EADDRINUSE' || e.code === 'EACCES')) && idx < tries.length - 1) { idx++; setImmediate(attempt); return; }
      onFail(e, port);
    };
    server.once('error', onErr);
     
     
    server.listen(port, host, () => { server.removeListener('error', onErr); const a = server.address().port; onReady(a, preferred > 0 && a !== preferred); });
  };
  attempt();
}

 
function previewServeCmd(root, id, deps = {}) {
  const { has, arg, previews } = deps;
  root = absRoot(root);
  const json = !!(has && has('--json'));
  const p = (previews || []).find(x => x.id === id);
  if (!p) { failJson(json, 'not_found', _lineSafe(`preview 없음: ${id}`)); return; }
  if (!/^P-\d{4,}$/.test(p.id)) { failJson(json, 'invalid_id', _lineSafe(`preview id 형식 무효: ${p.id}`)); return; }
  const cfg = loadPreviewConfig(root);
  const mode = cfg.mode || 'self';

  if (mode === 'project') {
     
    const staticDir = (arg ? arg('--static-dir', '') : '') || cfg.staticDir || 'public';
    const destDir = path.resolve(root, staticDir);
    const rel = path.relative(root, destDir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) { failJson(json, 'static_dir_outside_root', _lineSafe(`--static-dir 은 프로젝트 안이어야 합니다: ${destDir}`)); return; }
     
    try {
      const _rootReal2 = fs.realpathSync(root);
      let probe = destDir;
      while (!exists(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);    
      const realProbe = fs.realpathSync(probe);
      const relReal2 = path.relative(_rootReal2, realProbe);
      if (relReal2.startsWith('..') || path.isAbsolute(relReal2)) { failJson(json, 'static_dir_outside_root', _lineSafe(`--static-dir 이 링크를 통해 프로젝트 밖을 가리킵니다: ${destDir} → ${realProbe}`)); return; }
    } catch {}
    const built = buildServeWorkspace(root, p);
    if (!built.ok) { failJson(json, built.code || 'mockup_missing', _lineSafe(built.error)); return; }
    mkdirp(destDir);
    const destFile = path.join(destDir, `leerness-preview-${p.id}.html`);
    writeUtf8(destFile, read(path.join(built.dir, 'index.html')));
     
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

   
  const built = buildServeWorkspace(root, p);
  if (!built.ok) { failJson(json, built.code || 'mockup_missing', _lineSafe(built.error)); return; }
  const _portArg = (arg ? arg('--port', '') : '');
  const port = (_portArg && _portArg !== true) ? Math.max(0, parseInt(_portArg, 10) || 0) : LEERNESS_PREVIEW_PORT;
  const timeoutSec = Math.max(5, parseInt((arg ? arg('--timeout', '') : '') || '600', 10) || 600);
  const _rootReal = (() => { try { return fs.realpathSync(built.dir); } catch { return path.resolve(built.dir); } })();
  const server = http.createServer((req, res) => {
     
     
     
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
    fs.readFile(realFp, (err, buf) => {    
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
      log(`  시안: ${_lineSafe(p.id)} 「${_lineSafe(p.title)}」`);
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
  }, (e, tried) => { failJson(json, 'serve_failed', _lineSafe(`로컬 서버 시작 실패: ${e && e.message} (마지막 시도 포트 ${tried})`)); });
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
  if (val !== 'self' && val !== 'project') { failJson(json, 'invalid_mode', _lineSafe(`preview mode <self|project> — 받은 값: ${val}`)); return; }
  const next = { mode: val, devUrl: (arg ? (arg('--dev-url', '') || cfg.devUrl) : cfg.devUrl) || '', staticDir: (arg ? (arg('--static-dir', '') || cfg.staticDir) : cfg.staticDir) || '' };
  if (next.devUrl === true) next.devUrl = ''; if (next.staticDir === true) next.staticDir = '';
  if (!savePreviewConfig(root, next, json)) return;
  if (json) { log(JSON.stringify({ ok: true, ...next }, null, 2)); return; }
  ok(`preview mode = ${val}`);
  if (val === 'project') log(`  static-dir: ${next.staticDir || 'public'} · dev-url: ${next.devUrl || 'http://localhost:3000'} (dev 서버는 사용자가 실행)`);
}

 
const { projectWriter } = require('./runtime-writes');
module.exports = { LEERNESS_PREVIEW_PORT, previewServeCmd: projectWriter(previewServeCmd),
  previewModeCmd, loadPreviewConfig, savePreviewConfig: projectWriter(savePreviewConfig),
  cleanupServeDir: projectWriter(cleanupServeDir), serveDir, modeQuestionLines,
  buildServeWorkspace: projectWriter(buildServeWorkspace), _listenWithFallback };
