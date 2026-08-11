// lib/clarify.js — 모호성 질문 + 미리보기 승인 워크플로 (1.36.51, 사용자 요청 UR-0061).
//   ① clarify: 사용자 요청 텍스트에서 판단-모호 신호를 감지해 "AI 가 사용자에게 그대로 물을 질문"을 생성.
//      원칙: 휴리스틱은 false-PASS 편향(신호어 없으면 명확 판정) — 과질문(false-BLOCK)으로 흐름을 막지 않는다.
//   ② preview: 신규 기능은 코드 작성 전 디자인/기능 미리보기를 제시하고 사용자 승인(approve)/수정요구(revise)를
//      기록하는 스토어(.harness/previews.json). 승인 전 코드 작성 금지가 지시 레이어 계약.
'use strict';
const path = require('path');
const fs = require('fs');   // 1.36.99 (P-0012): 대상 화면 크기 확인(statSync) — 큰 파일은 시안 재료에서 제외
const { absRoot, exists, read, writeUtf8, log, ok, warn, fail, failJson, now, today } = require('./io');

// ── ① 모호성 신호 카탈로그 (kind → { re, q(match) }) ──────────────────────────
const CLARIFY_SIGNALS = [
  // '잘'은 "잘 통과하는지" 같은 정상 문장에 흔해 뒤따르는 요청동사가 있을 때만 (false-PASS 편향)
  { kind: 'vague-quality', re: /(적당히|알아서|이쁘게|예쁘게|깔끔하게|멋지게|잘\s?(?:좀|만들|해줘|해 줘|부탁)|(?:좀 ?)?더 (?:좋게|낫게|이쁘게|예쁘게|깔끔하게)|as appropriate|make it nice|make it pretty|make it better)/,
    q: (m) => `「${m.trim()}」의 기대 수준이 불명확합니다 — 참고할 예시(스크린샷/사이트/기존 화면)나 구체 기준이 있나요?` },
  { kind: 'pronoun', re: /(그거|이거|저거|아까\s?그|그 부분|위에서 말한|the one before)/,
    q: (m) => `「${m.trim()}」가 무엇을 가리키는지 확인이 필요합니다 — 대상(파일/화면/기능 이름)을 지정해 주세요.` },
  // 1.36.54 (codex 7차 #3): "모두/둘 다/both" 가 이미 답을 준 문장은 선택지 질문 억제(suppressIf) — false-BLOCK 방지
  { kind: 'alternative', re: /(\S+)\s?(?:이나|나|또는|혹은)\s(\S+)|(\b\w+\b) or (\b\w+\b)/, suppressIf: /(모두|둘 ?다|양쪽|전부|both|all of)/,
    q: (m) => `복수 선택지(${m.trim()})가 언급됐습니다 — 어느 쪽을 원하시나요, 아니면 둘 다인가요?` },
  { kind: 'vague-scope', re: /(전부 다|전부|모두 다|모든 걸|싹 다|everything|all of (?:it|them))/,
    q: (m) => `「${m.trim()}」의 범위가 넓습니다 — 포함/제외할 대상을 구체적으로 확인해도 될까요?` },
  { kind: 'vague-amount', re: /(약간|조금|살짝|몇 ?개|여러 ?개|어느 ?정도|a few|some of)/,
    q: (m) => `「${m.trim()}」의 수량/정도가 불명확합니다 — 대략적인 숫자나 기준을 주실 수 있나요?` },
  { kind: 'undefined-later', re: /(나중에|이따가?|추후|필요하면|여차하면|later|eventually)/,
    q: (m) => `「${m.trim()}」 시점 조건이 모호합니다 — 지금 범위에 포함할지, 이번엔 제외할지 확인이 필요합니다.` },
];

// 순수 감지 코어 — 텍스트에서 신호와 질문 목록 생성 (신호 없으면 ambiguous:false)
function _clarifySignals(text) {
  const t = String(text || '');
  const signals = [];
  for (const s of CLARIFY_SIGNALS) {
    const m = t.match(s.re);
    if (m && !(s.suppressIf && s.suppressIf.test(t))) signals.push({ kind: s.kind, match: m[0], question: s.q(m[0]) });
  }
  return { ambiguous: signals.length > 0, signals, questions: signals.map(s => s.question) };
}

// `leerness clarify "<사용자 요청>" [--json]`
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

// ── ② 미리보기 승인 스토어 ─────────────────────────────────────────────────
function _previewsPath(root) { return path.join(absRoot(root), '.harness', 'previews.json'); }

// 1.36.54 (codex 7차 #1 High): 파싱은 되지만 형상이 무효(루트 비배열/항목 null/비객체)인 스토어를
//   []로 오인해 덮어쓰던 클래스(6차 rules R-id 와 동일) — 로더가 무효 여부를 함께 반환하고 변경 진입점은 거부.
function _loadPreviewsChecked(root) {
  const f = _previewsPath(root);
  if (!exists(f)) return { list: [], invalid: false };
  try {
    const j = JSON.parse(read(f));
    if (!Array.isArray(j) || j.some(e => !e || typeof e !== 'object' || typeof e.id !== 'string')) return { list: [], invalid: true };
    return { list: j, invalid: false };
  } catch { return { list: [], invalid: true }; }
}
function _loadPreviews(root) { return _loadPreviewsChecked(root).list; }

function _savePreviews(root, list, json) {
  const f = _previewsPath(root);
  // 변경 진입점 fail-closed (1.36.28 스토어 손상 클래스) — 손상 파일 위 저장 거부
  if (exists(f)) { try { JSON.parse(read(f)); } catch { failJson(json, 'store_corrupt', `previews.json 손상 — 덮어쓰기 거부: ${f} (복구/삭제 후 재시도)`); return false; } }
  writeUtf8(f, JSON.stringify(list, null, 2) + '\n');
  return true;
}

function _nextPreviewId(list) {
  let max = 0;
  for (const p of list) { const m = String(p.id || '').match(/^P-(\d{4,})$/); if (m) max = Math.max(max, Number(m[1])); }
  return `P-${String(max + 1).padStart(4, '0')}`;
}

function pendingPreviews(root) { return _loadPreviews(root).filter(p => p.status === 'proposed' || p.status === 'revision-requested'); }

// 1.36.75 (UR-0066): 디자인/페이지 작업 감지 — "신규 페이지·디자인 요청은 코드 전에 HTML 시안 먼저" 리마인더용.
//   false-PASS 편향: 명시적 신호어가 있을 때만 (일반 기능 요청까지 시안 강제하지 않는다).
const DESIGN_WORK_RE = /(페이지\s*(제작|추가|만들|생성)|새\s*페이지|신규\s*페이지|디자인\s*(작업|해|변경|개편|시안)|리디자인|랜딩\s*페이지|화면\s*(설계|디자인)|UI\s*(작업|개편|디자인)|redesign|landing page|new page|design (?:a |the )?(?:page|screen|ui))/i;
function _isDesignWork(text) { return DESIGN_WORK_RE.test(String(text || '')); }

// HTML 이스케이프 (시안 스캐폴드에 사용자 텍스트 임베드용)
function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// 자립형 HTML 시안 스캐폴드 — AI 가 섹션을 채워 사용자에게 브라우저로 제시. 0-deps·오프라인(외부 리소스 없음).
// 1.36.99 (P-0012): 시안 정확도. 사용자 지적 — "mockup.html 로 미리보기 시안의 정확도가 높지 않다".
//   원인은 분명했다: 종전 스캐폴드는 점선 박스 하나에 "AI 는 이 영역을 실제 레이아웃으로 교체하세요" 라고 적어 둔 게 전부라
//   프로젝트의 스택도, 기존 컴포넌트도, 디자인 토큰도 읽지 않았다 — AI 의 상상에 100% 의존하니 정확할 수가 없다.
//   그래서 시안을 '빈 종이' 가 아니라 **이 앱의 재료** 로 시작시킨다: 실제 CSS 변수를 :root 에 심고,
//   이미 있는 컴포넌트 이름을 어휘로 주고, 대상 화면이 지정되면 그 화면이 실제로 쓰는 클래스를 보여준다.
//   (L3 라이브 DOM 캡처는 playwright 옵트인이라 별도 — 0-의존성 경계를 지킨다.)
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
// 대상 화면이 '실제로' 쓰는 요소/클래스를 뽑는다. 파서 없이(0-의존성) 할 수 있는 건 여기까지이고,
//   그 한계를 시안에도 그대로 적는다 — 렌더 결과가 아니라 소스에서 읽은 것이다.
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
// 1.36.100 (P-0012 후반): 승인된 시안을 '계약' 으로 고정한다.
//   프레임워크 프로젝트에서 렌더된 마크업을 컴포넌트 소스로 되돌릴 수는 없다 — 그래서 "자동 적용" 이라 부르지 않는다.
//   대신 시안이 약속한 **클래스와 토큰**을 저장해 두고, 구현이 끝난 뒤 그 약속이 지켜졌는지 기계로 대조한다.
//   한계는 분명히 적는다: 이건 '존재' 검사지 '시각적 일치' 검사가 아니다(있다고 해서 같아 보이는 건 아니다).
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
  // '아직 안 그렸다' 는 길이로 판정하면 안 된다 — 도구가 넣어 둔 안내 문구만으로도 120자를 넘는다(실측에서 이 판정이 틀렸다).
  //   손대지 않았다는 확실한 신호는 그 자리에 도구의 placeholder 가 그대로 있다는 것이다.
  const untouched = /class\s*=\s*["']placeholder["']/.test(area) || classes.size === 0;
  return { ok: true, classes: [...classes], tokens: [...tokens], tags: [...tags], drawn: area.replace(/\s+/g, ' ').trim().length, untouched };
}
function _mockupScaffold(p, ctx) {
  const feats = (p.features || []).map(f => `        <li>${_esc(f)}</li>`).join('\n');
  const c = ctx || { stack: [], tokens: { cssVars: [], utilities: [] }, components: [], target: null, notes: [] };
  // 실제 CSS 변수를 그대로 심는다 — 시안이 이 앱의 색/간격으로 그려지도록.
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

// `leerness preview add "<제목>" [--design "..."] [--features "a,b"] | list | show <id> | approve <id> | revise <id> --note "..."`
function previewCmd(root, sub, rest, deps = {}) {
  const { has, arg } = deps;
  root = absRoot(root);
  const json = !!(has && has('--json'));
  if (!exists(path.join(root, '.harness'))) { failJson(json, 'harness_missing', `leerness 미설치: ${root} — 먼저 leerness init`); return; }
  sub = sub || 'list';
  // 1.36.54 (#2 High): 변경 하위명령은 락 안에서 재로드→검증→저장 전체를 직렬화 — 동시 add 의 lost-update 차단.
  const _mutating = ['add', 'approve', 'revise', 'mockup'].includes(sub);   // 1.36.75: mockup 도 스토어에 경로 기록
  if (_mutating && deps._withLock && !deps._locked) {
    return deps._withLock(_previewsPath(root), () => previewCmd(root, sub, rest, Object.assign({}, deps, { _locked: true })));
  }
  const _chk = _loadPreviewsChecked(root);
  // 1.36.54 (#1 High): 무효 형상 스토어 위 변경 거부 — 원본 보존 (읽기 명령은 빈 목록으로 관용)
  if (_mutating && _chk.invalid) { failJson(json, 'store_invalid', `previews.json 형상 무효(비배열 루트 또는 null/ID 없는 항목) — 덮어쓰기 거부: ${_previewsPath(root)} (수동 복구 후 재시도)`); return; }
  const list = _chk.list;

  if (sub === 'add') {
    // 1.36.54 (#11): 제목 개행 정규화 — 한 미리보기 = 목록 한 줄 불변식
    // 1.36.113 (codex 검수 P3, 재현됨): `\r?\n` 만 접으면 **단독 CR** 이 남는다. 터미널에서 CR 은 커서를 줄 앞으로
    //   되돌려 앞부분(ID·상태)을 덮어써 목록 항목을 위장할 수 있다. JS 의 `\s` 는 CR·LF·U+2028·U+2029 를 모두 포함하므로
    //   특수 구분자를 리터럴로 적을 필요가 없다 — 실제로 그 문자를 그대로 적었다가 파일이 SyntaxError 로 깨졌다(재발 방지).
    const title = (rest || []).join(' ').replace(/\s+/g, ' ').trim();
    if (!title) { failJson(json, 'title_required', 'preview add "<기능 제목>" 필요 (+ --design "설명" --features "a,b")'); return; }
    const design = arg ? (arg('--design', '') || '') : '';
    const features = (arg ? (arg('--features', '') || '') : '').split(',').map(s => s.trim()).filter(Boolean);
    const p = { id: _nextPreviewId(list), title, design, features, status: 'proposed', createdAt: now(), history: [{ at: now(), event: 'proposed' }] };
    // 1.36.75 (UR-0066): --mockup <파일> — AI 가 만든 시안 HTML 을 등록 시점에 첨부 (존재 검증)
    const mk = arg ? (arg('--mockup', '') || '') : '';
    if (mk) {
      const mkAbs = path.resolve(path.isAbsolute(mk) ? mk : path.join(root, mk));
      // (검수 #3 Medium) 존재만 보던 검증 강화: 일반 파일이어야 하고(디렉토리 거부), 프로젝트 루트 안이어야 한다
      //   — 시안은 프로젝트 산출물이라 루트 밖 경로는 이식성이 깨진다.
      let _isFile = false;
      try { _isFile = require('fs').statSync(mkAbs).isFile(); } catch {}
      if (!_isFile) { failJson(json, 'mockup_not_found', `--mockup 파일 없음(또는 디렉토리): ${mkAbs} — 먼저 시안 파일을 만들거나, 등록 후 leerness preview mockup <P-ID> 로 스캐폴드 생성`); return; }
      const _rel = path.relative(root, mkAbs);
      if (_rel.startsWith('..') || path.isAbsolute(_rel)) { failJson(json, 'mockup_outside_root', `--mockup 은 프로젝트 루트 안의 파일이어야 합니다: ${mkAbs} (root: ${root})`); return; }
      p.mockupPath = _rel.replace(/\\/g, '/');
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
    if (json) { log(JSON.stringify({ ok: true, total: list.length, pending: pendingPreviews(root).length, previews: list }, null, 2)); return; }
    log(`# leerness preview — 기능 미리보기 승인 상태 (${list.length}건)`);
    if (!list.length) { log('  (없음) — 신규 기능 착수 전: leerness preview add "<제목>" --design "..." --features "a,b"'); return; }
    for (const p of list) {
      const icon = p.status === 'approved' ? '✅' : (p.status === 'revision-requested' ? '📝' : '⏳');
      log(`  ${icon} ${p.id} ${p.title}  [${p.status}]${p.mockupPath ? '  🎨 ' + p.mockupPath : ''}`);
    }
    const pend = pendingPreviews(root).length;
    if (pend) warn(`  미승인 ${pend}건 — 사용자 답을 받기 전 해당 기능 코드 작성 금지`);
    return;
  }

  const id = (rest || [])[0];
  const p = list.find(x => x.id === id);
  if (sub === 'show' || sub === 'approve' || sub === 'revise' || sub === 'mockup') {
    if (!id) { failJson(json, 'id_required', `preview ${sub} <P-ID> 필요 (leerness preview list 로 확인)`); return; }
    if (!p) { failJson(json, 'not_found', `preview 없음: ${id}`); return; }
  }

  // 1.36.75 (UR-0066): `preview mockup <P-ID> [--force]` — 자립형 HTML 시안 스캐폴드 생성 + 스토어에 경로 기록.
  //   AI 워크플로: 스캐폴드 생성 → placeholder 를 실제 레이아웃 초안으로 교체 → 사용자에게 브라우저로 제시 → approve/revise.
  if (sub === 'mockup') {
    // (검수 High) 스토어의 id 는 신뢰 입력이 아니다 — 조작된 id(`..\..\owned`)가 경로에 끼어들면 루트 밖 쓰기.
    //   정식 형식(P-\d{4,}) 강제 + 산출 경로의 .harness/previews 내부 확인 이중 가드.
    if (!/^P-\d{4,}$/.test(p.id)) { failJson(json, 'invalid_id', `preview id 형식 무효: ${JSON.stringify(p.id)} — previews.json 수동 복구 필요 (정식: P-0001)`); return; }
    const mkDir = path.join(root, '.harness', 'previews');
    const mkFile = path.resolve(mkDir, `${p.id}-mockup.html`);
    if (path.relative(mkDir, mkFile).startsWith('..')) { failJson(json, 'invalid_id', `시안 경로가 previews 디렉토리를 벗어남: ${mkFile}`); return; }
    // (검수 #5 Medium) 승인 후 시안 생성/재생성은 승인 상태를 낡게 만든다 — revise 로 되돌린 뒤에만 허용
    if (p.status === 'approved') { failJson(json, 'already_approved', `${p.id} 는 이미 승인됨 — 시안을 바꾸려면 먼저 leerness preview revise ${p.id} --note "..." 로 수정 상태로 되돌리세요`); return; }
    const _regen = exists(mkFile);
    if (_regen && !(has && has('--force'))) {
      // 이미 있으면 덮어쓰지 않는다 — AI 가 채워 넣은 시안 보호 (재생성은 --force)
      // (검수 #4 Medium) 보호하더라도 스토어에 경로는 기록 — list/show 에서 시안이 안 보이던 것
      const relPath = path.relative(root, mkFile).replace(/\\/g, '/');
      if (p.mockupPath !== relPath) { p.mockupPath = relPath; if (!_savePreviews(root, list, json)) return; }
      if (json) { log(JSON.stringify({ ok: true, id: p.id, mockupPath: relPath, created: false, note: 'exists — use --force to regenerate' }, null, 2)); return; }
      ok(`시안 이미 존재: ${path.relative(root, mkFile)} — 내용 보호를 위해 덮어쓰지 않음 (재생성: --force) · 경로는 기록됨`);
      return;
    }
    // 1.36.99 (P-0012): 빈 스캐폴드 대신 이 앱의 재료(토큰·컴포넌트·대상 화면 클래스)를 심어 준다.
    //   --target <파일> 을 주면 그 화면이 실제로 쓰는 클래스/요소까지 함께 싣는다.
    const _target = (arg && arg('--target', null)) || null;
    if (_target) p.target = _target;
    const _ctx = _mockupContext(root, p.target || null);
    writeUtf8(mkFile, _mockupScaffold(p, _ctx));
    p.mockupPath = path.relative(root, mkFile).replace(/\\/g, '/');
    // (검수 Low) 재생성은 별도 이벤트로 — 이력 오해 방지
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

  // 1.36.100 (P-0012 후반): `preview verify <P-ID> --files a,b` — 승인 시 고정한 계약과 구현을 대조.
  //   무엇을 하는가: 시안이 약속한 클래스/토큰이 구현 파일에 '나타나는가' 를 센다.
  //   무엇을 하지 않는가: 시각적 일치를 보증하지 않는다. 클래스가 있다고 같아 보이는 건 아니다 —
  //   이 구분을 흐리면 1.36.5 에서 고쳤던 과장을 되풀이하게 된다. 그래서 출력에 한계를 매번 적는다.
  if (sub === 'verify') {
    if (!id) { failJson(json, 'id_required', `preview verify <P-ID> --files a,b 필요`); return; }
    if (!p) { failJson(json, 'not_found', `preview 없음: ${id}`); return; }
    if (!p.contract) { failJson(json, 'no_contract', `${id} 에 계약이 없습니다 — 시안을 만들고(preview mockup) 승인(preview approve)해야 고정됩니다`); return; }
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
    log(`# ${p.id} 「${p.title}」  [${p.status}]`);
    if (p.mockupPath) log(`  🎨 시안: ${p.mockupPath}`);
    if (p.design) log(`  디자인: ${p.design}`);
    if (p.features && p.features.length) { log('  기능:'); p.features.forEach(f => log(`    - ${f}`)); }
    (p.history || []).forEach(h => log(`  · ${h.at} ${h.event}${h.note ? ` — ${h.note}` : ''}`));
    return;
  }
  if (sub === 'approve') {
    // 1.36.54 (#10): 재승인은 멱등 no-op — 중복 이력 방지
    if (p.status === 'approved') {
      // 1.36.80 (검수 #8): 멱등 재승인 경로가 정리 훅 앞에서 return 해 임시 워크스페이스가 남았다 — 정리는 항상 수행.
      try { if (typeof deps._onResolved === 'function') deps._onResolved(p.id); } catch {}
      if (json) { log(JSON.stringify({ ok: true, id: p.id, status: p.status, changed: false }, null, 2)); return; }
      ok(`${p.id} 이미 승인됨 — 변경 없음`); return;
    }
    p.status = 'approved'; (p.history = p.history || []).push({ at: now(), event: 'approved' });
    // 1.36.100 (P-0012 후반): 승인 순간의 시안을 계약으로 고정한다 — 나중에 구현이 그 약속을 지켰는지 대조하기 위해서다.
    //   시안이 없거나 마커가 지워졌으면 계약을 만들지 않는다(없는 계약을 있는 척 하지 않는다).
    let _contractNote = '';
    if (p.mockupPath) {
      const mp = path.resolve(root, p.mockupPath);
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
    try { if (typeof deps._onResolved === 'function') deps._onResolved(p.id); } catch {}   // 1.36.80 (UR-0067): 확인 완료 → 임시 워크스페이스 정리
    if (json) { log(JSON.stringify({ ok: true, id: p.id, status: p.status, contract: p.contract || null, contractNote: _contractNote }, null, 2)); return; }
    ok(`${p.id} 승인 — 이제 구현을 시작해도 됩니다.`);
    log(`  ${_contractNote}`);
    if (p.contract) log(`  → 구현 후 대조: leerness preview verify ${p.id} --files src/a.tsx,src/b.css`);
    return;
  }
  if (sub === 'revise') {
    const note = (arg ? (arg('--note', '') || '') : '').toString().trim();
    // 1.36.54 (#10): 빈 노트 수정요구 거부 — 무엇을 고칠지 없는 revise 는 워크플로 신호가 아니다
    if (!note) { failJson(json, 'note_required', `preview revise ${p.id} --note "<수정 요구 내용>" 필요`); return; }
    p.status = 'revision-requested'; (p.history = p.history || []).push({ at: now(), event: 'revision-requested', note });
    if (!_savePreviews(root, list, json)) return;
    try { if (typeof deps._onResolved === 'function') deps._onResolved(p.id); } catch {}   // 1.36.80 (UR-0067): 확인 절차 종료 → 임시 워크스페이스 정리
    if (json) { log(JSON.stringify({ ok: true, id: p.id, status: p.status, note }, null, 2)); return; }
    ok(`${p.id} 수정요구 기록${note ? ` — ${note}` : ''} — 미리보기를 수정해 다시 제시하세요 (코드 작성은 계속 보류).`);
    return;
  }
  failJson(json, 'unknown_subcommand', `알 수 없는 preview 하위명령: ${sub} (가능: add, list, show, approve, revise, mockup)`);
}

module.exports = { CLARIFY_SIGNALS, _clarifySignals, clarifyCmd, previewCmd, pendingPreviews, _previewsPath, _loadPreviews, _loadPreviewsChecked, _isDesignWork, DESIGN_WORK_RE, _mockupScaffold };
