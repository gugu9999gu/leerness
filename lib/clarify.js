 
 
 
 
 
'use strict';
const path = require('path');
const fs = require('fs');    
const { absRoot, exists, read, writeUtf8, log, ok, warn, fail, failJson, now, today } = require('./io');
const { _lineSafe } = require('./pure-utils');

 
const CLARIFY_SIGNALS = [
   
  { kind: 'vague-quality', re: /(적당히|알아서|이쁘게|예쁘게|깔끔하게|멋지게|잘\s?(?:좀|만들|해줘|해 줘|부탁)|(?:좀 ?)?더 (?:좋게|낫게|이쁘게|예쁘게|깔끔하게)|as appropriate|make it nice|make it pretty|make it better)/,
    q: (m) => `「${m.trim()}」의 기대 수준이 불명확합니다 — 참고할 예시(스크린샷/사이트/기존 화면)나 구체 기준이 있나요?` },
  { kind: 'pronoun', re: /(그거|이거|저거|아까\s?그|그 부분|위에서 말한|the one before)/,
    q: (m) => `「${m.trim()}」가 무엇을 가리키는지 확인이 필요합니다 — 대상(파일/화면/기능 이름)을 지정해 주세요.` },
   
  { kind: 'alternative', re: /(\S+)\s?(?:이나|나|또는|혹은)\s(\S+)|(\b\w+\b) or (\b\w+\b)/, suppressIf: /(모두|둘 ?다|양쪽|전부|both|all of)/,
    q: (m) => `복수 선택지(${m.trim()})가 언급됐습니다 — 어느 쪽을 원하시나요, 아니면 둘 다인가요?` },
  { kind: 'vague-scope', re: /(전부 다|전부|모두 다|모든 걸|싹 다|everything|all of (?:it|them))/,
    q: (m) => `「${m.trim()}」의 범위가 넓습니다 — 포함/제외할 대상을 구체적으로 확인해도 될까요?` },
  { kind: 'vague-amount', re: /(약간|조금|살짝|몇 ?개|여러 ?개|어느 ?정도|a few|some of)/,
    q: (m) => `「${m.trim()}」의 수량/정도가 불명확합니다 — 대략적인 숫자나 기준을 주실 수 있나요?` },
  { kind: 'undefined-later', re: /(나중에|이따가?|추후|필요하면|여차하면|later|eventually)/,
    q: (m) => `「${m.trim()}」 시점 조건이 모호합니다 — 지금 범위에 포함할지, 이번엔 제외할지 확인이 필요합니다.` },
];

 
function _clarifySignals(text) {
  const t = String(text || '');
  const signals = [];
  for (const s of CLARIFY_SIGNALS) {
    const m = t.match(s.re);
    if (m && !(s.suppressIf && s.suppressIf.test(t))) signals.push({ kind: s.kind, match: m[0], question: s.q(m[0]) });
  }
  return { ambiguous: signals.length > 0, signals, questions: signals.map(s => s.question) };
}

 
function clarifyCmd(root, text, deps = {}) {
  const { has } = deps;
  const json = !!(has && has('--json'));
  if (!text || !String(text).trim()) { failJson(json, 'text_required', 'clarify "<사용자 요청 텍스트>" 필요 — 모호성 신호를 감지해 사용자에게 물을 질문을 생성'); return; }
  const r = _clarifySignals(text);
  if (json) { log(JSON.stringify({ ok: true, ambiguous: r.ambiguous, signals: r.signals, questions: r.questions }, null, 2)); return; }
  log(`# leerness clarify — 요청 모호성 점검`);
  if (!r.ambiguous) { ok('  모호 신호 없음 — 그대로 진행 가능 (판단이 갈리면 그래도 물어보는 것이 안전)'); return; }
  warn(`  모호 신호 ${r.signals.length}건 — 작업 시작 전 사용자에게 아래 질문을 하세요:`);
  r.questions.forEach((q, i) => log(`  ${i + 1}. ${q}`));
  log(`\n  ⓘ 계약: 답을 받기 전에는 추측으로 구현하지 않는다 (AGENTS.md 모호성 규칙)`);
}

 
function _previewsPath(root) { return path.join(absRoot(root), '.leerness', 'previews.json'); }

function _pathEscapes(base, candidate) {
  const rel = path.relative(base, candidate);
  return rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
}

 
 
 
function _previewMockupPathCheck(root, value, opts = {}) {
  const base = absRoot(root);
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || _lineSafe(value) !== value) {
    return { ok: false, code: 'mockup_path_invalid' };
  }
  const candidate = path.resolve(base, value);
  if (_pathEscapes(base, candidate)) return { ok: false, code: 'mockup_outside_root' };
  try {
    const baseReal = fs.realpathSync(base);
    let probe = candidate;
    while (!exists(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    const probeReal = fs.realpathSync(probe);
    if (_pathEscapes(baseReal, probeReal)) return { ok: false, code: 'mockup_outside_root' };
    const fileExists = exists(candidate);
    let resolvedPath = candidate;
    if (fileExists) {
      resolvedPath = fs.realpathSync(candidate);
      if (_pathEscapes(baseReal, resolvedPath)) return { ok: false, code: 'mockup_outside_root' };
      if (!fs.statSync(resolvedPath).isFile()) return { ok: false, code: 'mockup_not_file' };
    } else if (opts.requireFile) {
      return { ok: false, code: 'mockup_missing' };
    }
    return { ok: true, abs: candidate, resolvedPath, fileExists, rel: path.relative(base, candidate).replace(/\\/g, '/') };
  } catch {
    return { ok: false, code: 'mockup_path_invalid' };
  }
}

 
 
 
 
function _previewOutputPathCheck(root, value, opts = {}) {
  const base = absRoot(root);
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || _lineSafe(value) !== value) {
    return { ok: false, code: 'preview_output_path_invalid' };
  }
  const candidate = path.resolve(base, value);
  if (_pathEscapes(base, candidate)) return { ok: false, code: 'preview_output_outside_root' };
  try {
    const baseReal = fs.realpathSync(base);
    const relative = path.relative(base, candidate);
    let current = base;
    for (const part of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      if (!exists(current)) break;
      const lst = fs.lstatSync(current);
      if (lst.isSymbolicLink()) return { ok: false, code: 'preview_output_linked' };
      const real = fs.realpathSync(current);
      if (_pathEscapes(baseReal, real)) return { ok: false, code: 'preview_output_outside_root' };
    }
    if (exists(candidate)) {
      const st = fs.statSync(candidate);
      if (opts.requireFile && !st.isFile()) return { ok: false, code: 'preview_output_not_file' };
      if (opts.requireDirectory && !st.isDirectory()) return { ok: false, code: 'preview_output_not_directory' };
    } else if (opts.requireExisting) {
      return { ok: false, code: 'preview_output_missing' };
    }
    return { ok: true, abs: candidate, rel: path.relative(base, candidate).replace(/\\/g, '/') };
  } catch {
    return { ok: false, code: 'preview_output_path_invalid' };
  }
}

 
 
function _safePreviewRecord(value) {
  if (typeof value === 'string') return _lineSafe(value);
  if (Array.isArray(value)) return value.map(_safePreviewRecord);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, _safePreviewRecord(v)]));
  }
  return value;
}

const _PREVIEW_STATUSES = new Set(['proposed', 'revision-requested', 'approved']);
const _PREVIEW_RESERVED_KEYS = new Set(['__proto__', 'prototype', 'constructor', 'ok', 'code', 'error']);
function _plainPreviewObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function _previewHasReservedKey(value) {
  if (Array.isArray(value)) return value.some(_previewHasReservedKey);
  if (!_plainPreviewObject(value)) return false;
  return Object.keys(value).some(k => _PREVIEW_RESERVED_KEYS.has(k) || _previewHasReservedKey(value[k]));
}
function _previewStringArray(value) { return Array.isArray(value) && value.every(v => typeof v === 'string'); }
function _previewRecordShapeValid(root, entry) {
  if (!_plainPreviewObject(entry) || _previewHasReservedKey(entry)) return false;
  if (typeof entry.id !== 'string' || !/^P-\d{4,}$/.test(entry.id)) return false;
  if (typeof entry.title !== 'string') return false;
  for (const key of ['design', 'createdAt', 'target']) {
    if (Object.prototype.hasOwnProperty.call(entry, key) && typeof entry[key] !== 'string') return false;
  }
   
   
  if (typeof entry.status !== 'string' || !_PREVIEW_STATUSES.has(entry.status)) return false;
  if (Object.prototype.hasOwnProperty.call(entry, 'features') && !_previewStringArray(entry.features)) return false;
  if (Object.prototype.hasOwnProperty.call(entry, 'history')) {
    if (!Array.isArray(entry.history) || entry.history.some(h => !_plainPreviewObject(h)
      || typeof h.at !== 'string' || typeof h.event !== 'string'
      || (Object.prototype.hasOwnProperty.call(h, 'note') && typeof h.note !== 'string'))) return false;
  }
  if (Object.prototype.hasOwnProperty.call(entry, 'contract')) {
    const c = entry.contract;
    if (!_plainPreviewObject(c) || typeof c.at !== 'string'
      || !_previewStringArray(c.classes) || !_previewStringArray(c.tokens) || !_previewStringArray(c.tags)
      || !Number.isFinite(c.drawnChars) || c.drawnChars < 0 || typeof c.untouched !== 'boolean') return false;
  }
  return !Object.prototype.hasOwnProperty.call(entry, 'mockupPath')
    || _previewMockupPathCheck(root, entry.mockupPath, { requireFile: true }).ok;
}
function _previewListShapeValid(root, list) {
  if (!Array.isArray(list)) return false;
  const ids = new Set();
  for (const entry of list) {
    if (!_previewRecordShapeValid(root, entry) || ids.has(entry.id)) return false;
    ids.add(entry.id);
  }
  return true;
}

 
 
 
function _loadPreviewsChecked(root, reader = null) {
  const { read, exists } = reader || require('./io');
  const f = _previewsPath(root);
  if (!exists(f)) return { list: [], invalid: false, code: null };
  let raw;
  try { raw = read(f); }
  catch { return { list: [], invalid: true, code: 'store_unreadable' }; }
  try {
    const j = JSON.parse(raw);
    if (!_previewListShapeValid(root, j)) {
      return { list: [], invalid: true, code: 'store_invalid' };
    }
    return { list: j.map(_safePreviewRecord), invalid: false, code: null };
  } catch { return { list: [], invalid: true, code: 'store_corrupt' }; }
}
function _loadPreviews(root) { return _loadPreviewsChecked(root).list; }

function _pendingPreviewItems(list) {
  return (Array.isArray(list) ? list : []).filter(p => p.status === 'proposed' || p.status === 'revision-requested');
}

 
 
 
 
function previewApprovalState(root, reader = null) {
  const checked = _loadPreviewsChecked(root, reader);
  if (checked.invalid) {
    return { known: false, invalid: true, code: checked.code || 'store_invalid', count: null, items: [] };
  }
  const items = _pendingPreviewItems(checked.list);
  return { known: true, invalid: false, code: null, count: items.length, items };
}

 
 
 
function _failInvalidPreviewStore(root, checked, json) {
  if (!checked || !checked.invalid) return false;
  const f = _previewsPath(root);
  if (checked.code === 'store_unreadable') {
    failJson(json, 'store_unreadable', _lineSafe(`previews.json 판독 실패 — 빈 목록으로 간주하지 않음: ${f} (파일 권한/형상 복구 후 재시도)`));
  } else if (checked.code === 'store_corrupt') {
    failJson(json, 'store_corrupt', _lineSafe(`previews.json JSON 손상 — 빈 목록으로 간주하지 않음: ${f} (수동 복구 후 재시도)`));
  } else {
    failJson(json, 'store_invalid', _lineSafe(`previews.json 형상 무효(비배열 루트, canonical ID 없는 항목, 또는 프로젝트 밖 mockupPath) — 빈 목록으로 간주하지 않음: ${f} (수동 복구 후 재시도)`));
  }
  return true;
}

function _savePreviews(root, list, json) {
  const f = _previewsPath(root);
   
   
  if (!_previewListShapeValid(root, list)) {
    failJson(json, 'store_invalid', _lineSafe(`저장할 preview 형상이 무효입니다 — canonical/고유 ID, 유효한 중첩 필드, 프로젝트 안의 실제 mockup 파일이 필요: ${f}`));
    return false;
  }
   
  if (exists(f)) { try { JSON.parse(read(f)); } catch { failJson(json, 'store_corrupt', _lineSafe(`previews.json 손상 — 덮어쓰기 거부: ${f} (복구/삭제 후 재시도)`)); return false; } }
  writeUtf8(f, JSON.stringify(list, null, 2) + '\n');
  return true;
}

function _nextPreviewId(list) {
  let max = 0;
  for (const p of list) { const m = String(p.id || '').match(/^P-(\d{4,})$/); if (m) max = Math.max(max, Number(m[1])); }
  return `P-${String(max + 1).padStart(4, '0')}`;
}

function pendingPreviews(root) {
  const state = previewApprovalState(root);
  if (!state.known) {
    const error = new Error(`preview approval state unknown (${state.code})`);
    error.code = state.code;
    error.previewApproval = state;
    throw error;
  }
  return state.items;
}

 
 
const DESIGN_WORK_RE = /(페이지\s*(제작|추가|만들|생성)|새\s*페이지|신규\s*페이지|디자인\s*(작업|해|변경|개편|시안)|리디자인|랜딩\s*페이지|화면\s*(설계|디자인)|UI\s*(작업|개편|디자인)|redesign|landing page|new page|design (?:a |the )?(?:page|screen|ui))/i;
function _isDesignWork(text) { return DESIGN_WORK_RE.test(String(text || '')); }

 
function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

 
 
 
 
 
 
 
function _mockupContext(root, target) {
  const out = { stack: [], tokens: { cssVars: [], utilities: [] }, components: [], target: null, notes: [] };
  try {
    const lib = require('./library');
    const r = lib.scanLibrary(root);
    out.stack = r.stack; out.notes = r.notes;
    out.tokens.cssVars = r.tokens.cssVars.slice(0, 40);
    out.tokens.utilities = r.tokens.utilities.slice(0, 40);
    out.components = r.components.slice(0, 60);
  } catch (e) { out.notes.push(`인벤토리 수집 실패: ${e.message}`); }
  if (target) out.target = _targetSkeleton(root, target);
  return out;
}
 
 
function _targetSkeleton(root, rel) {
  const p = path.resolve(absRoot(root), rel);
  const base = absRoot(root);
  if (p !== base && !p.startsWith(base + path.sep)) return { file: rel, error: '프로젝트 루트 밖 경로는 읽지 않는다' };
  if (!exists(p)) return { file: rel, error: '파일 없음' };
  let txt = '';
  try { const st = fs.statSync(p); if (st.size > 512 * 1024) return { file: rel, error: '파일이 커서 건너뜀(512KB 초과)' }; txt = read(p); } catch (e) { return { file: rel, error: e.message }; }
  const classes = []; const seen = new Set();
  const CLS = /class(?:Name)?\s*=\s*(?:["'`]([^"'`]{1,400})["'`]|\{\s*["'`]([^"'`]{1,400})["'`]\s*\})/g;
  let m; while ((m = CLS.exec(txt))) { const v = (m[1] || m[2] || '').trim(); if (v && !seen.has(v)) { seen.add(v); classes.push(v); } }
  const tags = []; const tseen = new Set();
  const TAG = /(?:^|[\s(={,;:?[])<([A-Za-z][\w.-]*)/g;
  while ((m = TAG.exec(txt))) { const t = m[1]; if (!tseen.has(t)) { tseen.add(t); tags.push(t); } }
  return { file: rel, classes: classes.slice(0, 40), tags: tags.slice(0, 40), lines: txt.split('\n').length };
}
 
 
 
 
const DRAW_START = 'leerness:draw-start';
const DRAW_END = 'leerness:draw-end';
function _extractContract(html) {
  const s = String(html || '');
  const a = s.indexOf(DRAW_START), b = s.indexOf(DRAW_END);
  if (a < 0 || b < 0 || b < a) return { ok: false, reason: 'draw 마커를 찾지 못함 — 시안에서 마커를 지웠거나 구버전 시안입니다' };
  const area = s.slice(s.indexOf('-->', a) + 3, b);
  const classes = new Set(); const tokens = new Set(); const tags = new Set();
  let m;
  const CLS = /class\s*=\s*["']([^"']{1,400})["']/g;
  while ((m = CLS.exec(area))) for (const c of m[1].split(/\s+/)) if (c && !/^(?:placeholder|mock|notes|chips|sw|stack|meta)$/.test(c)) classes.add(c);
  const TOK = /var\(\s*(--[\w-]+)\s*\)/g;
  while ((m = TOK.exec(area))) tokens.add(m[1]);
  const TAG = /<([a-zA-Z][\w-]*)/g;
  while ((m = TAG.exec(area))) tags.add(m[1].toLowerCase());
   
   
  const untouched = /class\s*=\s*["']placeholder["']/.test(area) || classes.size === 0;
  return { ok: true, classes: [...classes], tokens: [...tokens], tags: [...tags], drawn: area.replace(/\s+/g, ' ').trim().length, untouched };
}
function _mockupScaffold(p, ctx) {
  const feats = (p.features || []).map(f => `        <li>${_esc(f)}</li>`).join('\n');
  const c = ctx || { stack: [], tokens: { cssVars: [], utilities: [] }, components: [], target: null, notes: [] };
   
  const COLORISH = /^(?:#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/deg]+\))$/;
  const varDecl = (c.tokens.cssVars || []).map(v => `    --${v.name}: ${String(v.value).replace(/[<>{};]/g, '')};`).join('\n');
  const varChips = (c.tokens.cssVars || []).slice(0, 24).map(v => {
    const sw = COLORISH.test(String(v.value).trim()) ? `<i class="sw" style="background:var(--${_esc(v.name)})"></i>` : '';
    return `<li>${sw}<code>--${_esc(v.name)}</code></li>`;
  }).join('\n');
  const utilChips = (c.tokens.utilities || []).slice(0, 30).map(u => `<li><code>${_esc(u.name)}</code><span class="n">${u.uses}</span></li>`).join('\n');
  const compChips = (c.components || []).map(x => `<li><code>${_esc(x.name)}</code><span class="n">${_esc(x.file)}</span></li>`).join('\n');
  const tgt = c.target;
  const tgtBlock = !tgt ? '' : (tgt.error
    ? `<section class="mock"><h2>대상 화면</h2><p class="notes">${_esc(tgt.file)} — ${_esc(tgt.error)}</p></section>`
    : `<section class="mock"><h2>대상 화면 — ${_esc(tgt.file)} (${tgt.lines}줄)</h2>
    <p class="notes">이 화면이 <b>실제로 쓰는</b> 클래스와 요소다(소스에서 읽음 — 렌더 결과가 아니다). 새 시안은 여기서 벗어나지 않게 그린다.</p>
    <ul class="chips">${(tgt.classes || []).map(x => `<li><code>${_esc(x.slice(0, 90))}</code></li>`).join('')}</ul>
    <ul class="chips">${(tgt.tags || []).map(x => `<li><code>&lt;${_esc(x)}&gt;</code></li>`).join('')}</ul></section>`);
  const notes = (c.notes || []).map(n => `<li>${_esc(n)}</li>`).join('\n');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${_esc(p.id)} 시안 — ${_esc(p.title)}</title>
<style>
  /* 이 프로젝트에서 실제로 쓰이는 디자인 토큰 — 시안이 앱과 같은 색/간격으로 그려지게 심는다 */
  :root {
${varDecl}
  }
  :root { --ink:#1a1a1a; --sub:#666; --line:#e5e5e5; --accent:#2563eb; --bg:#fafafa; }
  * { box-sizing:border-box; margin:0; }
  body { font-family:system-ui,-apple-system,'Segoe UI',sans-serif; color:var(--ink); background:var(--bg); }
  .meta { background:#fff; border-bottom:2px solid var(--accent); padding:14px 24px; font-size:13px; color:var(--sub); }
  .meta b { color:var(--ink); }
  .meta .status { float:right; }
  main { max-width:960px; margin:32px auto; padding:0 24px; }
  section.mock { background:#fff; border:1px dashed var(--line); border-radius:10px; padding:28px; margin-bottom:20px; }
  section.mock h2 { font-size:15px; color:var(--accent); margin-bottom:12px; }
  .placeholder { border:2px dashed #cbd5e1; border-radius:8px; padding:40px; text-align:center; color:#94a3b8; font-size:14px; }
  .notes { font-size:13px; color:var(--sub); line-height:1.7; }
  .notes li { margin-left:18px; }
  ul.chips { list-style:none; margin:6px 0 0; padding:0; display:flex; flex-wrap:wrap; gap:5px; }
  ul.chips li { background:#f6f7f9; border:1px solid var(--line); border-radius:6px; padding:3px 7px; font-size:12px; display:flex; align-items:center; gap:5px; }
  ul.chips code { font-family:ui-monospace,Menlo,monospace; }
  ul.chips .n { color:var(--sub); font-size:10.5px; }
  .sw { width:12px; height:12px; border-radius:3px; border:1px solid var(--line); display:inline-block; }
  .stack { font-size:12px; color:var(--sub); }
</style>
</head>
<body>
<div class="meta"><b>${_esc(p.id)}</b> 「${_esc(p.title)}」 — 디자인 시안 <span class="status">status: ${_esc(p.status)} · ${_esc(p.createdAt || '')}</span></div>
<main>
  <section class="mock">
    <h2>디자인 방향</h2>
    <p class="notes">${_esc(p.design || '(preview add --design 으로 방향을 기록하세요)')}</p>
  </section>
  <section class="mock">
    <h2>포함 기능</h2>
    <ul class="notes">
${feats || '        <li>(없음 — --features "a,b" 로 기록)</li>'}
    </ul>
  </section>
  ${tgtBlock}
  <section class="mock">
    <h2>이 앱의 재료 — 새로 만들지 말고 여기서 조립</h2>
    <p class="stack">스택: ${_esc((c.stack || []).join(' · ') || '(미상)')}</p>
    ${compChips ? `<p class="notes" style="margin-top:10px">이미 있는 컴포넌트 ${(c.components || []).length}개 — 같은 걸 또 만들지 마세요</p><ul class="chips">${compChips}</ul>` : '<p class="notes">추출된 컴포넌트 없음 — 아래 안내를 확인하세요</p>'}
    ${varChips ? `<p class="notes" style="margin-top:10px">디자인 토큰(CSS 변수) — 위 :root 에 실제 값으로 심어 뒀으니 <code>var(--이름)</code> 으로 쓰세요</p><ul class="chips">${varChips}</ul>` : ''}
    ${utilChips ? `<p class="notes" style="margin-top:10px">실제로 자주 쓰는 유틸 클래스(빈도순) — 이 어휘 안에서 그리세요</p><ul class="chips">${utilChips}</ul>` : ''}
    ${notes ? `<p class="notes" style="margin-top:10px">인벤토리 한계</p><ul class="notes">${notes}</ul>` : ''}
  </section>
  <section class="mock">
    <h2>화면 시안 — ⬇ 아래 두 마커 <b>사이</b>만 실제 레이아웃 초안으로 교체하세요</h2>
    <!-- leerness:draw-start · 승인 시 이 구간의 클래스와 var(--토큰) 이 '계약' 으로 고정된다. 마커는 지우지 마세요. -->
    <div class="placeholder">위의 <b>실제 토큰·컴포넌트·대상 화면 클래스</b>를 재료로 삼아 그립니다 — 새 색/새 간격을 발명하지 마세요.<br>외부 리소스 없이(오프라인) 이 파일 하나로 열리게 유지하세요.</div>
    <!-- leerness:draw-end -->
  </section>
</main>
<!-- leerness:mockup ${_esc(p.id)} — 이 파일은 시안입니다. 승인(leerness preview approve ${_esc(p.id)}) 전 실제 코드 작성 금지. -->
</body>
</html>
`;
}

 
function previewCmd(root, sub, rest, deps = {}) {
  const { has, arg } = deps;
  root = absRoot(root);
  const json = !!(has && has('--json'));
  if (!exists(path.join(root, '.leerness'))) { failJson(json, 'harness_missing', _lineSafe(`leerness 미설치: ${root} — 먼저 leerness init`)); return; }
  sub = sub || 'list';
   
  const _mutating = ['add', 'approve', 'revise', 'mockup'].includes(sub);    
  if (_mutating && deps._withLock && !deps._locked) {
    return deps._withLock(_previewsPath(root), () => previewCmd(root, sub, rest, Object.assign({}, deps, { _locked: true })));
  }
  const _chk = _loadPreviewsChecked(root);
   
  if (_failInvalidPreviewStore(root, _chk, json)) return;
  const list = _chk.list;

  if (sub === 'add') {
     
     
     
     
    const title = _lineSafe((rest || []).join(' ')).replace(/\s+/g, ' ').trim();
    if (!title) { failJson(json, 'title_required', 'preview add "<기능 제목>" 필요 (+ --design "설명" --features "a,b")'); return; }
    const design = _lineSafe(arg ? (arg('--design', '') || '') : '');
    const features = (arg ? (arg('--features', '') || '') : '').split(',').map(s => _lineSafe(s).trim()).filter(Boolean);
    const p = { id: _nextPreviewId(list), title, design, features, status: 'proposed', createdAt: now(), history: [{ at: now(), event: 'proposed' }] };
     
    const mk = arg ? (arg('--mockup', '') || '') : '';
    if (mk) {
      const mkAbs = path.resolve(path.isAbsolute(mk) ? mk : path.join(root, mk));
       
       
       
      const relInput = path.relative(root, mkAbs).replace(/\\/g, '/');
      const checkedPath = _previewMockupPathCheck(root, relInput, { requireFile: true });
      if (!checkedPath.ok) {
        if (checkedPath.code === 'mockup_missing' || checkedPath.code === 'mockup_not_file') {
          failJson(json, 'mockup_not_found', _lineSafe(`--mockup 파일 없음(또는 디렉토리): ${mkAbs} — 먼저 시안 파일을 만들거나, 등록 후 leerness preview mockup <P-ID> 로 스캐폴드 생성`));
        } else {
          failJson(json, checkedPath.code || 'mockup_path_invalid', _lineSafe(`--mockup 은 프로젝트 루트 안의 실제 파일이어야 합니다: ${mkAbs} (root: ${root})`));
        }
        return;
      }
      p.mockupPath = checkedPath.rel;
    }
    list.push(p);
    if (!_savePreviews(root, list, json)) return;
    if (json) { log(JSON.stringify({ ok: true, ...p }, null, 2)); return; }
    ok(`preview 등록: ${p.id} 「${title}」 (status: proposed)`);
    if (p.mockupPath) log(`  🎨 시안: ${p.mockupPath} — 사용자가 브라우저로 열어 확인`);
    else if (_isDesignWork(title + ' ' + design)) log(`  🎨 디자인/페이지 작업 감지 — leerness preview mockup ${p.id} 로 HTML 시안 스캐폴드를 만들어 채운 뒤 제시하세요.`);
    log(`  → 사용자에게 이 미리보기(디자인/기능)를 제시하고 승인/수정 답을 받으세요.`);
    log(`  → 승인: leerness preview approve ${p.id}  ·  수정요구: leerness preview revise ${p.id} --note "..."`);
    log(`  ⓘ 계약: approve 전에는 이 기능의 코드를 작성하지 않는다.`);
    return;
  }

  if (sub === 'list') {
    const pending = _pendingPreviewItems(list);
    if (json) { log(JSON.stringify({ ok: true, total: list.length, pending: pending.length, previews: list }, null, 2)); return; }
    log(`# leerness preview — 기능 미리보기 승인 상태 (${list.length}건)`);
    if (!list.length) { log('  (없음) — 신규 기능 착수 전: leerness preview add "<제목>" --design "..." --features "a,b"'); return; }
    for (const p of list) {
      const icon = p.status === 'approved' ? '✅' : (p.status === 'revision-requested' ? '📝' : '⏳');
      log(`  ${icon} ${_lineSafe(p.id)} ${_lineSafe(p.title)}  [${_lineSafe(p.status)}]${p.mockupPath ? '  🎨 ' + _lineSafe(p.mockupPath) : ''}`);
    }
    const pend = pending.length;
    if (pend) warn(`  미승인 ${pend}건 — 사용자 답을 받기 전 해당 기능 코드 작성 금지`);
    return;
  }

  const id = (rest || [])[0];
  const p = list.find(x => x.id === id);
  if (sub === 'show' || sub === 'approve' || sub === 'revise' || sub === 'mockup') {
    if (!id) { failJson(json, 'id_required', _lineSafe(`preview ${sub} <P-ID> 필요 (leerness preview list 로 확인)`)); return; }
    if (!p) { failJson(json, 'not_found', _lineSafe(`preview 없음: ${id}`)); return; }
  }

   
   
  if (sub === 'mockup') {
     
     
    if (!/^P-\d{4,}$/.test(p.id)) { failJson(json, 'invalid_id', _lineSafe(`preview id 형식 무효: ${JSON.stringify(p.id)} — previews.json 수동 복구 필요 (정식: P-0001)`)); return; }
    const mkRel = path.posix.join('.leerness', 'previews', `${p.id}-mockup.html`);
    const outputPath = _previewOutputPathCheck(root, mkRel);
    if (!outputPath.ok) {
      failJson(json, outputPath.code, _lineSafe(`시안 출력 경로에 프로젝트 밖 링크 또는 무효 조상이 있습니다: ${mkRel}`));
      return;
    }
    const mkFile = outputPath.abs;
     
    if (p.status === 'approved') { failJson(json, 'already_approved', _lineSafe(`${p.id} 는 이미 승인됨 — 시안을 바꾸려면 먼저 leerness preview revise ${p.id} --note "..." 로 수정 상태로 되돌리세요`)); return; }
    const _regen = exists(mkFile);
    if (_regen && !(has && has('--force'))) {
       
       
      const relPath = path.relative(root, mkFile).replace(/\\/g, '/');
      if (p.mockupPath !== relPath) { p.mockupPath = relPath; if (!_savePreviews(root, list, json)) return; }
      if (json) { log(JSON.stringify({ ok: true, id: p.id, mockupPath: relPath, created: false, note: 'exists — use --force to regenerate' }, null, 2)); return; }
      ok(`시안 이미 존재: ${path.relative(root, mkFile)} — 내용 보호를 위해 덮어쓰지 않음 (재생성: --force) · 경로는 기록됨`);
      return;
    }
     
     
    const _target = (arg && arg('--target', null)) || null;
    if (_target) p.target = _target;
    const _ctx = _mockupContext(root, p.target || null);
    writeUtf8(mkFile, _mockupScaffold(p, _ctx));
    p.mockupPath = path.relative(root, mkFile).replace(/\\/g, '/');
     
    (p.history = p.history || []).push({ at: now(), event: _regen ? 'mockup-regenerated' : 'mockup-created' });
    if (!_savePreviews(root, list, json)) return;
    if (json) { log(JSON.stringify({ ok: true, id: p.id, mockupPath: p.mockupPath, created: !_regen, regenerated: _regen }, null, 2)); return; }
    ok(`시안 ${_regen ? '재생성' : '스캐폴드 생성'}: ${p.mockupPath}`);
    log(`  재료: 컴포넌트 ${(_ctx.components || []).length} · CSS변수 ${(_ctx.tokens.cssVars || []).length} · 유틸 ${(_ctx.tokens.utilities || []).length}${_ctx.target ? ` · 대상 ${_ctx.target.file}` : ''}`);
    if (!_ctx.target) log(`  → 대상 화면을 지정하면 정확도가 올라갑니다: leerness preview mockup ${p.id} --target src/pages/Foo.tsx --force`);
    log(`  → AI: placeholder 영역을 실제 레이아웃 초안(HTML/CSS)으로 교체하세요 (외부 리소스 없이, 위 재료로 조립).`);
    log(`  → 사용자에게 이 파일을 브라우저로 열어 보여주고 승인/수정을 질문으로 받으세요.`);
    log(`  ⓘ 계약: approve 전에는 실제 기능 코드를 작성하지 않는다.`);
    return;
  }

   
   
   
   
  if (sub === 'verify') {
    if (!id) { failJson(json, 'id_required', `preview verify <P-ID> --files a,b 필요`); return; }
    if (!p) { failJson(json, 'not_found', _lineSafe(`preview 없음: ${id}`)); return; }
    if (!p.contract) { failJson(json, 'no_contract', _lineSafe(`${id} 에 계약이 없습니다 — 시안을 만들고(preview mockup) 승인(preview approve)해야 고정됩니다`)); return; }
    const filesArg = (arg && arg('--files', '')) || '';
    const files = filesArg.split(',').map(s => s.trim()).filter(Boolean);
    if (!files.length) { failJson(json, 'files_required', `--files src/a.tsx,src/b.css 로 구현 파일을 지정하세요`); return; }
    const base = absRoot(root);
    let text = ''; const read_ = []; const missingFiles = [];
    for (const f of files) {
      const fp = path.resolve(base, f);
      if (fp !== base && !fp.startsWith(base + path.sep)) { missingFiles.push(`${f} (루트 밖 — 읽지 않음)`); continue; }
      if (!exists(fp)) { missingFiles.push(`${f} (없음)`); continue; }
      try { const st = fs.statSync(fp); if (st.size > 1024 * 1024) { missingFiles.push(`${f} (1MB 초과 — 건너뜀)`); continue; } text += '\n' + read(fp); read_.push(f); } catch (e) { missingFiles.push(`${f} (${e.message})`); }
    }
    const cls = p.contract.classes || [], tok = p.contract.tokens || [];
    const clsFound = cls.filter(c => text.includes(c));
    const tokFound = tok.filter(t => text.includes(t));
    const total = cls.length + tok.length;
    const found = clsFound.length + tokFound.length;
    const pct = total ? Math.round(found * 100 / total) : 0;
    const missCls = cls.filter(c => !clsFound.includes(c)), missTok = tok.filter(t => !tokFound.includes(t));
    if (json) { log(JSON.stringify({ ok: true, id, filesRead: read_, filesSkipped: missingFiles, classes: { total: cls.length, found: clsFound.length, missing: missCls }, tokens: { total: tok.length, found: tokFound.length, missing: missTok }, presencePct: pct, limit: 'presence-only — 시각적 일치를 보증하지 않음' }, null, 2)); return; }
    log(`# preview verify ${id} — 시안 계약 ↔ 구현 대조`);
    log(`  읽은 파일 ${read_.length}개${missingFiles.length ? ` · 건너뜀 ${missingFiles.length}개` : ''}`);
    missingFiles.forEach(x => warn(`  ${x}`));
    log(`  클래스 ${clsFound.length}/${cls.length} · 토큰 ${tokFound.length}/${tok.length}  →  존재율 ${pct}%`);
    if (missCls.length) log(`  누락 클래스: ${missCls.slice(0, 20).join(' ')}${missCls.length > 20 ? ` …외 ${missCls.length - 20}` : ''}`);
    if (missTok.length) log(`  누락 토큰: ${missTok.slice(0, 20).join(' ')}${missTok.length > 20 ? ` …외 ${missTok.length - 20}` : ''}`);
    if (!read_.length) warn('  읽은 구현 파일이 없어 존재율은 의미가 없습니다');
    log(`  ⓘ 한계: 이건 '존재' 검사입니다 — 클래스·토큰이 나타나는지만 봅니다. 같아 보이는지는 보지 않습니다(그건 사람이 시안과 화면을 나란히 봐야 합니다).`);
    return;
  }

  if (sub === 'show') {
    if (json) { log(JSON.stringify({ ok: true, ...p }, null, 2)); return; }
    log(`# ${_lineSafe(p.id)} 「${_lineSafe(p.title)}」  [${_lineSafe(p.status)}]`);
    if (p.mockupPath) log(`  🎨 시안: ${_lineSafe(p.mockupPath)}`);
    if (p.design) log(`  디자인: ${_lineSafe(p.design)}`);
    if (p.features && p.features.length) { log('  기능:'); p.features.forEach(f => log(`    - ${_lineSafe(f)}`)); }
    (p.history || []).forEach(h => log(`  · ${_lineSafe(h.at)} ${_lineSafe(h.event)}${h.note ? ` — ${_lineSafe(h.note)}` : ''}`));
    return;
  }
  if (sub === 'approve') {
     
    if (p.status === 'approved') {
       
      try { if (typeof deps._onResolved === 'function') deps._onResolved(p.id); } catch {}
      if (json) { log(JSON.stringify({ ok: true, id: p.id, status: p.status, changed: false }, null, 2)); return; }
      ok(`${p.id} 이미 승인됨 — 변경 없음`); return;
    }
    let _contractPath = null;
    if (p.mockupPath) {
      const checkedPath = _previewMockupPathCheck(root, p.mockupPath, { requireFile: true });
      if (!checkedPath.ok) { failJson(json, 'store_invalid', _lineSafe(`${p.id} mockupPath 가 프로젝트 밖이거나 형상이 무효입니다 — previews.json 수동 복구 필요`)); return; }
      _contractPath = checkedPath.resolvedPath;
    }
    p.status = 'approved'; (p.history = p.history || []).push({ at: now(), event: 'approved' });
     
     
    let _contractNote = '';
    if (_contractPath) {
      const mp = _contractPath;
      if (exists(mp)) {
        const ex = _extractContract(read(mp));
        if (ex.ok) {
          p.contract = { at: now(), classes: ex.classes, tokens: ex.tokens, tags: ex.tags, drawnChars: ex.drawn, untouched: !!ex.untouched };
          _contractNote = `계약 고정: 클래스 ${ex.classes.length} · 토큰 ${ex.tokens.length} · 요소 ${ex.tags.length}`;
          if (ex.untouched) _contractNote += ' ⚠ 시안을 아직 안 그렸습니다(placeholder 그대로) — 계약이 비어 대조가 무의미합니다';
        } else _contractNote = `계약 미고정: ${ex.reason}`;
      } else _contractNote = '계약 미고정: 시안 파일 없음';
    } else _contractNote = '계약 미고정: 시안 없음 (leerness preview mockup 으로 먼저 생성)';
    if (!_savePreviews(root, list, json)) return;
    try { if (typeof deps._onResolved === 'function') deps._onResolved(p.id); } catch {}    
    if (json) { log(JSON.stringify({ ok: true, id: p.id, status: p.status, contract: p.contract || null, contractNote: _contractNote }, null, 2)); return; }
    ok(`${p.id} 승인 — 이제 구현을 시작해도 됩니다.`);
    log(`  ${_contractNote}`);
    if (p.contract) log(`  → 구현 후 대조: leerness preview verify ${p.id} --files src/a.tsx,src/b.css`);
    return;
  }
  if (sub === 'revise') {
    const note = _lineSafe((arg ? (arg('--note', '') || '') : '').toString()).trim();
     
    if (!note) { failJson(json, 'note_required', _lineSafe(`preview revise ${p.id} --note "<수정 요구 내용>" 필요`)); return; }
    p.status = 'revision-requested'; (p.history = p.history || []).push({ at: now(), event: 'revision-requested', note });
    if (!_savePreviews(root, list, json)) return;
    try { if (typeof deps._onResolved === 'function') deps._onResolved(p.id); } catch {}    
    if (json) { log(JSON.stringify({ ok: true, id: p.id, status: p.status, note }, null, 2)); return; }
    ok(`${p.id} 수정요구 기록${note ? ` — ${note}` : ''} — 미리보기를 수정해 다시 제시하세요 (코드 작성은 계속 보류).`);
    return;
  }
  failJson(json, 'unknown_subcommand', _lineSafe(`알 수 없는 preview 하위명령: ${sub} (가능: add, list, show, approve, revise, mockup)`));
}

module.exports = { CLARIFY_SIGNALS, _clarifySignals, clarifyCmd, previewCmd, pendingPreviews, previewApprovalState, _pendingPreviewItems, _previewsPath, _loadPreviews, _loadPreviewsChecked, _failInvalidPreviewStore, _previewMockupPathCheck, _previewOutputPathCheck, _safePreviewRecord, _isDesignWork, DESIGN_WORK_RE, _mockupScaffold };
