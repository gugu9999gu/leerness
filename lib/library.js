'use strict';
// 1.36.98 (P-0013): 재사용 인벤토리 — 저장소에서 '이미 있는' 컴포넌트·요소·디자인 토큰을 뽑아 사람과 AI 가 함께 본다.
//   reuse-map 이 중복 '함수' 를 막는다면 이쪽은 중복 '화면 조각' 을 막는다. 손으로 유지하지 않고 재생성한다.
//
// 설계는 실측이 정했다(실제 12개 프로젝트, 읽기 전용):
//   ① 컴포넌트를 '대문자 export' 로 세면 2~3배 부풀려진다(auto-influencer 83→33, view-work 116→66).
//      플레인 HTML 프로젝트(Adzento)는 62→0 — 순진한 추출기를 돌리면 가짜 컴포넌트 62개짜리 인벤토리가 나온다.
//      사람도 AI 도 그걸 믿고 참조하므로, 없는 것을 있다고 말하는 산출물은 없느니만 못하다.
//      → 증명 가능한 하한만 싣는다: 선언 근처에 실제 마크업(JSX/템플릿)이 있어야 컴포넌트로 인정한다.
//   ② 토큰 출처가 스택마다 정반대다. Tailwind 를 쓰는 7개는 CSS 커스텀 프로퍼티가 0~5개인 대신 유틸 어휘가 74~121종이고
//      (auto-influencer 의 text-ink-50 은 417회 — 빈도가 곧 '사실상의 토큰' 이라는 증거),
//      Tailwind 를 안 쓰는 Adzento 는 CSS 변수 58개에 유틸 0. 한쪽만 보는 추출기는 절반에서 '토큰 없음' 을 낸다.
//   ③ 아무것도 못 찾으면 빈 페이지를 그럴듯하게 내지 말고 "찾지 못함" 과 그 이유를 말한다.
const path = require('path');
const fs = require('fs');
const { absRoot, exists } = require('./io');

// 스캔 경계 — 벤더/빌드 산출물/가상환경은 남의 코드다. 인벤토리에 섞이면 '우리 것' 이라는 전제가 깨진다.
const SKIP_DIR_RE = /^(?:node_modules|\.git|\.next|_next|dist|build|out|coverage|vendor|\.venv|venv|site-packages|__pycache__|\.cache|target|release\d*|win-unpacked|\.leerness|\.svelte-kit|\.nuxt|storybook-static)$/i;
//   .astro 를 빠뜨렸다가 Astro 프로젝트에서 컴포넌트 0 을 냈다(실측: store-aeo-page 는 .astro 16개인데 0). 파일 자체가 컴포넌트인 형식은 함께 센다.
const UI_EXT_RE = /\.(?:jsx|tsx|vue|svelte|astro|js|mjs|cjs|ts|html?|css|scss|less)$/i;
const TEST_RE = /(^|[\\/])(?:test_[^\\/]+\.[a-z]+|[^\\/]+[._-]test\.[a-z]+|[^\\/]+\.spec\.[a-z]+|[^\\/]+\.stories\.[a-z]+)$|(^|[\\/])(?:tests?|__tests__)[\\/]/i;
const MINIFIED_RE = /[.-]min\.[a-z]+$|\.bundle\.[a-z]+$|-[0-9a-f]{8,}\.[a-z]+$/i;
//   leerness 가 사용자 저장소에 만들어 두는 산출물은 '이 앱의 것' 이 아니다 — 실측에서 leerness.html 의 대시보드 변수
//   (--panel · --mut · --txt …)가 사용자 디자인 토큰으로 실렸고, 시안이 존재하지 않는 토큰을 쓰라고 지시할 뻔했다.
//   자기가 만든 것을 남의 것으로 세지 않는다.
const OWN_ARTIFACT_RE = /(^|[\\/])(?:leerness|roadmap|leerness-library|leerness-preview[^\\/]*)\.html$/i;
const FILE_CAP = 1024 * 1024;         // 파일당
const TOTAL_CAP = 48 * 1024 * 1024;   // 스캔 1회당 — 비용은 파일 하나가 아니라 호출 하나에 묶는다(1.36.97 교훈)
const MAX_FILES = 6000;

// 선언 근처에 마크업이 있는가 — '증명 가능한 하한' 의 판정자.
//   JSX(`return <` / `=> <` / `<Tag ... />`)나 createElement 호출이 창(window) 안에 있어야 컴포넌트로 본다.
const MARKUP_RE = /return\s*\(?\s*</;
const MARKUP_ARROW_RE = /=>\s*\(?\s*</;
const CREATE_EL_RE = /(?:React\.)?createElement\s*\(/;
//   TypeScript 제네릭(Record<string>, useState<number>)은 JSX 태그와 글자가 같다 — 실측에서 zod 스키마가
//   컴포넌트로 잡혔다(EmojiDensitySchema 등). 차이는 위치다: 제네릭은 '식별자 바로 뒤', JSX 는 '표현식 자리'.
//   그래서 `<` 앞에 단어 문자가 오면 제네릭으로 보고 버린다.
//   그리고 문자열·주석의 '자리표시자' 도 태그처럼 생겼다 — 실측에서 `:<svc>` `<uuid>` `<browserPort>` 때문에
//   UI 를 그리지 않는 감시 클래스 4개가 컴포넌트로 실렸다(view-work 50개 중 4개). 진짜 마크업은 둘 중 하나다:
//   대문자로 시작하는 컴포넌트 태그이거나, 속성을 가진 소문자 요소. 속성 없는 소문자 한 낱말은 자리표시자로 본다.
const JSX_TAG_RE = /(?:^|[\s(={,;:?[])<(?:[A-Z][\w.]*(?:\s[^<>]{0,200})?\/?>|[a-z][\w-]*\s+[a-zA-Z-]+\s*=[^<>]{0,200}>)/m;
const DECL_RE = /export\s+(?:default\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g;
//   창의 '끝' 은 다음 선언이다 — 고정 문자 수로 자르면 둘 다 틀린다. 실측: 선언→첫 마크업 거리는 p50 684 · p90 3,248 ·
//   p99 20,639 자라, 1,500 자 창은 실제 선언의 69%만 포착했고(누락 30%), 창을 6,000 으로 키우면 사실상 '파일에 JSX 가
//   있으면 전부' 가 되어 2~3배 부풀리던 옛 휴리스틱으로 되돌아간다. 경계를 구조에서 가져오면 상수가 필요 없다.
//   경계는 '최상위' 선언만이다 — 들여쓰기를 허용하면 컴포넌트 본문 첫 줄의 `const [s, setS] = useState()` 가
//   곧바로 창을 닫아 버려(실측: 컴포넌트 수가 7·6·0 으로 붕괴) 반대쪽으로 틀린다. 열 0 이 곧 최상위라는 신호다.
const BOUNDARY_RE = /\n(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+[A-Za-z_$][\w$]*/g;
const ALL_CAPS_RE = /^[A-Z0-9_]+$/;

function _hasMarkup(win) {
  return MARKUP_RE.test(win) || MARKUP_ARROW_RE.test(win) || CREATE_EL_RE.test(win) || JSX_TAG_RE.test(win);
}
// 하위호환 + 단위 검증용: 시작점부터 '다음 선언 전까지' 를 본다(끝을 못 찾으면 파일 끝까지).
function _hasMarkupNear(text, from) {
  BOUNDARY_RE.lastIndex = from + 1;
  const m = BOUNDARY_RE.exec(text);
  return _hasMarkup(text.slice(from, m ? m.index : text.length));
}

// 파일 순회 — root 밖으로 나가지 않고(심볼릭 디렉토리 미추적), 예산 안에서만 읽는다.
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
      if (e.isSymbolicLink()) continue;                       // 링크는 따라가지 않는다(밖으로 새는 유일한 경로)
      if (e.isDirectory()) { if (!SKIP_DIR_RE.test(e.name)) rec(p, depth + 1); continue; }
      if (!e.isFile() || !UI_EXT_RE.test(e.name)) continue;
      if (TEST_RE.test(p) || MINIFIED_RE.test(e.name) || OWN_ARTIFACT_RE.test(p)) { stats.skippedGenerated++; continue; }
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.size > fileCap) { stats.skippedLarge++; continue; }
      if (st.size > budget) { stats.budgetExhausted = true; continue; }
      let txt; try { txt = fs.readFileSync(p, 'utf8'); } catch { continue; }
      // 기계 생성(한 줄이 지나치게 긴 파일)은 어휘 통계를 오염시킨다
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

// 컴포넌트 — 스택별로 판정이 다르다. .vue/.svelte 는 파일 자체가 컴포넌트이고, JSX 계열은 선언 근처 마크업을 요구한다.
function _components(files) {
  const out = []; const seen = new Set();
  const add = (name, rel, line, kind) => { const k = name + '@' + rel; if (!seen.has(k)) { seen.add(k); out.push({ name, file: rel, line, kind }); } };
  for (const f of files) {
    const ext = (f.rel.match(/\.([a-z]+)$/i) || [, ''])[1].toLowerCase();
    if (ext === 'vue' || ext === 'svelte' || ext === 'astro') {
      const base = f.rel.split('/').pop().replace(/\.[a-z]+$/i, '');
      if (/^[A-Z]/.test(base)) add(base, f.rel, 1, ext);       // 관례상 대문자 파일명이 컴포넌트(소문자는 페이지·라우트)
      continue;
    }
    if (!/^(?:jsx|tsx|js|mjs|cjs|ts)$/.test(ext)) continue;
    let m; DECL_RE.lastIndex = 0;
    while ((m = DECL_RE.exec(f.text))) {
      const name = m[1];
      if (!/^[A-Z]/.test(name) || ALL_CAPS_RE.test(name)) continue;   // 소문자 유틸·대문자 상수(API_URL)는 컴포넌트가 아니다
      if (!_hasMarkupNear(f.text, m.index)) continue;                 // ← 하한의 핵심: 마크업이 없으면 세지 않는다
      const line = f.text.slice(0, m.index).split('\n').length;
      add(name, f.rel, line, ext);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// 디자인 토큰 — 두 출처를 모두 본다. 하나만 보면 스택 절반에서 '토큰 없음' 이 된다.
const CSSVAR_RE = /--([a-zA-Z][\w-]*)\s*:\s*([^;}\n]{1,80})/g;
const CLASS_ATTR_RE = /class(?:Name)?\s*=\s*(?:["'`]([^"'`]{1,600})["'`]|\{\s*["'`]([^"'`]{1,600})["'`]\s*\})/g;
//   유틸 어휘: 색/간격/타이포처럼 '디자인 결정' 을 담은 것만. 레이아웃 플래그(flex, block)는 토큰이 아니라 구조다.
const UTIL_RE = /\b(?:bg|text|border|ring|from|via|to|fill|stroke|shadow|rounded|font|leading|tracking|gap|p|px|py|pt|pb|pl|pr|m|mx|my|w|h)-[a-z0-9][\w./[\]%-]*/g;
// CSS 변수는 'CSS 문맥' 에서만 뽑는다. 파일 전체에서 `--이름:` 을 찾으면 주석·문자열의 CLI 플래그가 그대로 들어온다
//   (실측: 이 저장소에서 --json · --apply · --fix · --strict 가 '디자인 토큰' 으로 실렸다 — `audit --fix: 누락 키 자동 추가`).
//   <style> 추출은 정규식 대신 인덱스 탐색으로 한다: 닫는 태그가 없는 입력에서 되돌림이 생기지 않는다(1.36.97 교훈).
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
  // 빈도는 '사실상의 토큰' 이라는 증거다 — 1~2회짜리는 우연이므로 싣지 않는다.
  const utilList = [...utils.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).map(([name, uses]) => ({ name, uses }));
  return { cssVars: [...cssVars.values()].sort((a, b) => b.uses - a.uses), utilities: utilList };
}

// 스택별 어떤 출처가 '주' 인지 — 인벤토리를 읽는 쪽이 무엇을 믿어야 하는지 알아야 한다.
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

// ── AI 참조용 압축 뷰. 사람용 HTML 과 분리하는 게 핵심이다 —
//   인벤토리 전체를 컨텍스트에 밀어 넣으면 '토큰을 아끼려고 만든 기능' 이 토큰을 더 쓴다.
//   자르는 경우 반드시 자름을 알린다(조용한 절단은 '전부 봤다' 는 거짓 인상을 준다).
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
// 색으로 보이는 값만 견본을 그린다 — 값 문자열을 그대로 style 에 넣지 않고, 안전한 형식일 때만 통과시킨다.
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

// `leerness library [show|page|--json|--ai]`
//   show(기본) 사람이 터미널에서 훑는 요약 · page 오프라인 단일 HTML · --json 전체 · --ai 압축(에이전트 컨텍스트용)
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
