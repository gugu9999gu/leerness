'use strict';
 
 
//
 
 
 
 
 
 
 
 
 
const path = require('path');
const fs = require('fs');
const { absRoot, exists } = require('./io');

 
const SKIP_DIR_RE = /^(?:node_modules|\.git|\.next|_next|dist|build|out|coverage|vendor|\.venv|venv|site-packages|__pycache__|\.cache|target|release\d*|win-unpacked|\.leerness|\.svelte-kit|\.nuxt|storybook-static)$/i;
 
const UI_EXT_RE = /\.(?:jsx|tsx|vue|svelte|astro|js|mjs|cjs|ts|html?|css|scss|less)$/i;
const TEST_RE = /(^|[\\/])(?:test_[^\\/]+\.[a-z]+|[^\\/]+[._-]test\.[a-z]+|[^\\/]+\.spec\.[a-z]+|[^\\/]+\.stories\.[a-z]+)$|(^|[\\/])(?:tests?|__tests__)[\\/]/i;
const MINIFIED_RE = /[.-]min\.[a-z]+$|\.bundle\.[a-z]+$|-[0-9a-f]{8,}\.[a-z]+$/i;
 
 
 
const OWN_ARTIFACT_RE = /(^|[\\/])(?:leerness|roadmap|leerness-library|leerness-preview[^\\/]*)\.html$/i;
const FILE_CAP = 1024 * 1024;          
const TOTAL_CAP = 48 * 1024 * 1024;    
const MAX_FILES = 6000;

 
 
const MARKUP_RE = /return\s*\(?\s*</;
const MARKUP_ARROW_RE = /=>\s*\(?\s*</;
const CREATE_EL_RE = /(?:React\.)?createElement\s*\(/;
 
 
 
 
 
 
const JSX_TAG_RE = /(?:^|[\s(={,;:?[])<(?:[A-Z][\w.]*(?:\s[^<>]{0,200})?\/?>|[a-z][\w-]*\s+[a-zA-Z-]+\s*=[^<>]{0,200}>)/m;
const DECL_RE = /export\s+(?:default\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g;
 
 
 
 
 
const BOUNDARY_RE = /\n(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+[A-Za-z_$][\w$]*/g;
const ALL_CAPS_RE = /^[A-Z0-9_]+$/;

function _hasMarkup(win) {
  return MARKUP_RE.test(win) || MARKUP_ARROW_RE.test(win) || CREATE_EL_RE.test(win) || JSX_TAG_RE.test(win);
}
 
function _hasMarkupNear(text, from) {
  BOUNDARY_RE.lastIndex = from + 1;
  const m = BOUNDARY_RE.exec(text);
  return _hasMarkup(text.slice(from, m ? m.index : text.length));
}

 
function _walk(root, opts) {
  const cap = (opts && opts.totalCap) || TOTAL_CAP;
  const fileCap = (opts && opts.fileCap) || FILE_CAP;
  const maxFiles = (opts && opts.maxFiles) || MAX_FILES;
  const out = []; const stats = { scanned: 0, skippedLarge: 0, skippedGenerated: 0, budgetExhausted: false };
  let budget = cap;
  const rec = (dir, depth) => {
    if (depth > 10 || out.length >= maxFiles) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (out.length >= maxFiles) return;
      if (e.name.startsWith('.') && e.name !== '.') { if (SKIP_DIR_RE.test(e.name)) continue; }
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;                        
      if (e.isDirectory()) { if (!SKIP_DIR_RE.test(e.name)) rec(p, depth + 1); continue; }
      if (!e.isFile() || !UI_EXT_RE.test(e.name)) continue;
      if (TEST_RE.test(p) || MINIFIED_RE.test(e.name) || OWN_ARTIFACT_RE.test(p)) { stats.skippedGenerated++; continue; }
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.size > fileCap) { stats.skippedLarge++; continue; }
      if (st.size > budget) { stats.budgetExhausted = true; continue; }
      let txt; try { txt = fs.readFileSync(p, 'utf8'); } catch { continue; }
       
      const lines = txt.split('\n').length;
      if (lines > 0 && txt.length / lines > 400) { stats.skippedGenerated++; continue; }
      budget -= st.size;
      stats.scanned++;
      out.push({ rel: path.relative(root, p).replace(/\\/g, '/'), text: txt });
    }
  };
  rec(root, 0);
  return { files: out, stats };
}

 
function _components(files) {
  const out = []; const seen = new Set();
  const add = (name, rel, line, kind) => { const k = name + '@' + rel; if (!seen.has(k)) { seen.add(k); out.push({ name, file: rel, line, kind }); } };
  for (const f of files) {
    const ext = (f.rel.match(/\.([a-z]+)$/i) || [, ''])[1].toLowerCase();
    if (ext === 'vue' || ext === 'svelte' || ext === 'astro') {
      const base = f.rel.split('/').pop().replace(/\.[a-z]+$/i, '');
      if (/^[A-Z]/.test(base)) add(base, f.rel, 1, ext);        
      continue;
    }
    if (!/^(?:jsx|tsx|js|mjs|cjs|ts)$/.test(ext)) continue;
    let m; DECL_RE.lastIndex = 0;
    while ((m = DECL_RE.exec(f.text))) {
      const name = m[1];
      if (!/^[A-Z]/.test(name) || ALL_CAPS_RE.test(name)) continue;    
      if (!_hasMarkupNear(f.text, m.index)) continue;                  
      const line = f.text.slice(0, m.index).split('\n').length;
      add(name, f.rel, line, ext);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

 
const CSSVAR_RE = /--([a-zA-Z][\w-]*)\s*:\s*([^;}\n]{1,80})/g;
const CLASS_ATTR_RE = /class(?:Name)?\s*=\s*(?:["'`]([^"'`]{1,600})["'`]|\{\s*["'`]([^"'`]{1,600})["'`]\s*\})/g;
 
const UTIL_RE = /\b(?:bg|text|border|ring|from|via|to|fill|stroke|shadow|rounded|font|leading|tracking|gap|p|px|py|pt|pb|pl|pr|m|mx|my|w|h)-[a-z0-9][\w./[\]%-]*/g;
 
 
 
function _cssSources(rel, text) {
  if (/\.(?:css|scss|less)$/i.test(rel)) return [text];
  const out = []; let i = 0;
  for (;;) {
    const s = text.indexOf('<style', i); if (s < 0) break;
    const gt = text.indexOf('>', s); if (gt < 0) break;
    const e = text.indexOf('</style', gt); if (e < 0) break;
    out.push(text.slice(gt + 1, e)); i = e + 7;
  }
  return out;
}
function _tokens(files) {
  const cssVars = new Map(); const utils = new Map();
  for (const f of files) {
    for (const css of _cssSources(f.rel, f.text)) {
      let m; CSSVAR_RE.lastIndex = 0;
      while ((m = CSSVAR_RE.exec(css))) {
        const name = m[1], val = m[2].trim();
        const cur = cssVars.get(name);
        if (cur) cur.uses++; else cssVars.set(name, { name, value: val, file: f.rel, uses: 1 });
      }
    }
    let c; CLASS_ATTR_RE.lastIndex = 0;
    while ((c = CLASS_ATTR_RE.exec(f.text))) {
      const cls = c[1] || c[2] || '';
      let u; UTIL_RE.lastIndex = 0;
      while ((u = UTIL_RE.exec(cls))) utils.set(u[0], (utils.get(u[0]) || 0) + 1);
    }
  }
   
  const utilList = [...utils.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).map(([name, uses]) => ({ name, uses }));
  return { cssVars: [...cssVars.values()].sort((a, b) => b.uses - a.uses), utilities: utilList };
}

 
function _tokenSource(ui, tokens) {
  const hasTw = ui.includes('tailwind');
  if (hasTw && tokens.utilities.length) return 'tailwind-utilities';
  if (tokens.cssVars.length) return 'css-variables';
  if (tokens.utilities.length) return 'utility-classes';
  return 'none';
}

function scanLibrary(root, opts = {}) {
  root = absRoot(root);
  let ui = [];
  try { ui = (require('./tech-profile').detectTechProfile(root).ui || []).map(u => u.id); } catch { ui = []; }
  const { files, stats } = _walk(root, opts);
  const components = _components(files);
  const tokens = _tokens(files);
  const notes = [];
  if (!stats.scanned) notes.push('스캔된 UI 파일이 없다 — 이 저장소에 화면 코드가 없거나, 전부 제외 규칙(벤더/빌드/테스트/기계생성)에 걸렸다.');
  else if (!components.length) notes.push(`컴포넌트를 찾지 못했다(${stats.scanned}개 파일 스캔). 선언 근처에 마크업이 있는 것만 세므로, 플레인 HTML 프로젝트나 마크업이 템플릿 파일에만 있는 구조에서는 0 이 정상이다.`);
  if (_tokenSource(ui, tokens) === 'none' && stats.scanned) notes.push('디자인 토큰을 찾지 못했다 — CSS 커스텀 프로퍼티도, 3회 이상 쓰인 유틸 어휘도 없다.');
  if (stats.budgetExhausted) notes.push('스캔 예산을 넘겨 일부 파일을 건너뛰었다 — 인벤토리가 완전하지 않다.');
  if (stats.skippedLarge) notes.push(`${stats.skippedLarge}개 파일이 크기 상한을 넘어 제외됐다.`);
  return {
    stack: ui,
    tokenSource: _tokenSource(ui, tokens),
    components,
    tokens,
    stats,
    notes,
  };
}

 
 
 
const AI_CAPS = { components: 200, utilities: 60, cssVars: 60 };
function compactLibrary(r, caps = AI_CAPS) {
  const cut = {};
  const take = (arr, n, key) => { if (arr.length > n) cut[key] = arr.length - n; return arr.slice(0, n); };
  return {
    stack: r.stack,
    tokenSource: r.tokenSource,
    components: take(r.components, caps.components, 'components').map(c => ({ n: c.name, f: `${c.file}:${c.line}` })),
    tokens: {
      utilities: take(r.tokens.utilities, caps.utilities, 'utilities').map(u => `${u.name}×${u.uses}`),
      cssVars: take(r.tokens.cssVars, caps.cssVars, 'cssVars').map(v => v.name),
    },
    counts: { components: r.components.length, utilities: r.tokens.utilities.length, cssVars: r.tokens.cssVars.length, filesScanned: r.stats.scanned },
    truncated: Object.keys(cut).length ? cut : undefined,
    notes: r.notes,
  };
}

const _esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
 
const _COLOR_RE = /^(?:#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/deg]+\))$/;
function renderLibraryPage(r, meta = {}) {
  const rows = r.components.map(c => `<tr><td class="n">${_esc(c.name)}</td><td class="k">${_esc(c.kind)}</td><td class="f">${_esc(c.file)}:${_esc(c.line)}</td></tr>`).join('\n');
  const vars = r.tokens.cssVars.map(v => {
    const sw = _COLOR_RE.test(v.value.trim()) ? `<i class="sw" style="background:${_esc(v.value.trim())}"></i>` : '';
    return `<li>${sw}<code>--${_esc(v.name)}</code> <span class="v">${_esc(v.value)}</span> <span class="u">${v.uses}회</span></li>`;
  }).join('\n');
  const utils = r.tokens.utilities.map(u => `<li><code>${_esc(u.name)}</code> <span class="u">${u.uses}</span></li>`).join('\n');
  const notes = r.notes.map(n => `<li>${_esc(n)}</li>`).join('\n');
  const empty = !r.components.length && !r.tokens.cssVars.length && !r.tokens.utilities.length;
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${_esc(meta.project || 'project')} — 재사용 인벤토리</title>
<style>
:root{--ink:#16181d;--sub:#6b7280;--line:#e5e7eb;--bg:#fff;--card:#fafafa;--accent:#2563eb}
@media(prefers-color-scheme:dark){:root{--ink:#e8eaed;--sub:#9aa0a6;--line:#2a2d33;--bg:#15171a;--card:#1c1f24;--accent:#7aa2f7}}
*{box-sizing:border-box}body{margin:0;font:14px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--ink);background:var(--bg)}
header{padding:20px 24px;border-bottom:1px solid var(--line)}h1{margin:0 0 6px;font-size:17px}
.meta{color:var(--sub);font-size:12.5px}
main{max-width:1080px;margin:0 auto;padding:20px 24px 60px}
section{margin:22px 0}h2{font-size:14px;margin:0 0 10px;color:var(--accent)}
table{width:100%;border-collapse:collapse;font-size:13px}td{padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}
td.n{font-weight:600;width:26%}td.k{color:var(--sub);width:8%}td.f{color:var(--sub);font-family:ui-monospace,Menlo,monospace;font-size:12px;word-break:break-all}
ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
li{background:var(--card);border:1px solid var(--line);border-radius:7px;padding:4px 9px;font-size:12.5px;display:flex;align-items:center;gap:6px}
code{font-family:ui-monospace,Menlo,monospace}.v{color:var(--sub)}.u{color:var(--sub);font-size:11px}
.sw{width:13px;height:13px;border-radius:3px;border:1px solid var(--line);display:inline-block}
.notes{display:block}.notes li{display:block;background:transparent;border:0;border-left:3px solid var(--accent);border-radius:0;padding:3px 0 3px 10px;color:var(--sub)}
.empty{padding:26px;border:1px dashed var(--line);border-radius:10px;color:var(--sub);text-align:center}
.tbl{overflow-x:auto}
</style></head><body>
<header>
  <h1>${_esc(meta.project || 'project')} — 재사용 인벤토리</h1>
  <div class="meta">스택 ${_esc((r.stack || []).join(' · ') || '미상')} · 토큰 출처 ${_esc(r.tokenSource)} · 파일 ${r.stats.scanned}개 스캔 · ${_esc(meta.at || '')}</div>
  <div class="meta">이 파일은 <b>생성물</b>입니다 — 손으로 고치지 말고 <code>leerness library page</code> 로 다시 만드세요.</div>
</header>
<main>
${notes ? `<section><h2>읽기 전에</h2><ul class="notes">\n${notes}\n</ul></section>` : ''}
${empty ? '<section><div class="empty">인벤토리가 비어 있습니다. 위 안내가 이유를 설명합니다 — 빈 결과를 채워 넣지 않았습니다.</div></section>' : ''}
${r.components.length ? `<section><h2>컴포넌트 ${r.components.length}개 — 새로 만들기 전에 여기부터</h2><div class="tbl"><table>\n${rows}\n</table></div></section>` : ''}
${r.tokens.cssVars.length ? `<section><h2>CSS 커스텀 프로퍼티 ${r.tokens.cssVars.length}개</h2><ul>\n${vars}\n</ul></section>` : ''}
${r.tokens.utilities.length ? `<section><h2>유틸리티 어휘 ${r.tokens.utilities.length}종 — 빈도순(3회 이상만)</h2><ul>\n${utils}\n</ul></section>` : ''}
</main></body></html>
`;
}

 
 
function libraryCmd(root, sub, deps = {}) {
  const { has, log, ok, warn, failJson } = deps;
  root = absRoot(root);
  const json = !!(has && has('--json'));
  const ai = !!(has && has('--ai'));
  if (!exists(path.join(root, '.leerness'))) { failJson(json || ai, 'harness_missing', `leerness 미설치: ${root} — 먼저 leerness init`); return; }
  const r = scanLibrary(root);
  if (ai) { log(JSON.stringify(compactLibrary(r))); return; }
  if (json) { log(JSON.stringify(Object.assign({ ok: true }, r), null, 2)); return; }
  if (sub === 'page') {
    const at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const out = path.join(root, 'leerness-library.html');
    require('./io').writeUtf8(out, renderLibraryPage(r, { project: path.basename(root), at }));
    ok(`재사용 인벤토리 페이지 생성: ${path.relative(process.cwd(), out).replace(/\\/g, '/')}`);
    log(`  컴포넌트 ${r.components.length} · CSS 변수 ${r.tokens.cssVars.length} · 유틸 ${r.tokens.utilities.length} · 파일 ${r.stats.scanned}개 스캔`);
    r.notes.forEach(n => log(`  ⓘ ${n}`));
    return;
  }
  log(`# leerness library — 재사용 인벤토리 (${path.basename(root)})`);
  log(`  스택: ${(r.stack || []).join(' · ') || '(미상)'}   ·   토큰 출처: ${r.tokenSource}   ·   파일 ${r.stats.scanned}개 스캔`);
  log('');
  if (r.components.length) {
    log(`  컴포넌트 ${r.components.length}개 — 새로 만들기 전에 여기부터 (상위 20)`);
    for (const c of r.components.slice(0, 20)) log(`    · ${c.name.padEnd(26)} ${c.file}:${c.line}`);
    if (r.components.length > 20) log(`    … ${r.components.length - 20}개 더 (leerness library page 로 전체 열람)`);
  } else log('  컴포넌트: (없음)');
  log('');
  if (r.tokens.cssVars.length) log(`  CSS 변수 ${r.tokens.cssVars.length}개: ${r.tokens.cssVars.slice(0, 10).map(v => '--' + v.name).join(' ')}${r.tokens.cssVars.length > 10 ? ' …' : ''}`);
  if (r.tokens.utilities.length) log(`  유틸 어휘 ${r.tokens.utilities.length}종(3회 이상): ${r.tokens.utilities.slice(0, 10).map(u => u.name).join(' ')}${r.tokens.utilities.length > 10 ? ' …' : ''}`);
  if (r.notes.length) { log(''); r.notes.forEach(n => warn(n)); }
  log('');
  log('  사람용 페이지: leerness library page   ·   에이전트용 압축: leerness library --ai');
}

module.exports = { scanLibrary, compactLibrary, renderLibraryPage, libraryCmd, _walk, _components, _tokens, _cssSources, _hasMarkupNear, _tokenSource, _esc, SKIP_DIR_RE, UI_EXT_RE, OWN_ARTIFACT_RE, AI_CAPS };
