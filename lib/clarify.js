// lib/clarify.js — 모호성 질문 + 미리보기 승인 워크플로 (1.36.51, 사용자 요청 UR-0061).
//   ① clarify: 사용자 요청 텍스트에서 판단-모호 신호를 감지해 "AI 가 사용자에게 그대로 물을 질문"을 생성.
//      원칙: 휴리스틱은 false-PASS 편향(신호어 없으면 명확 판정) — 과질문(false-BLOCK)으로 흐름을 막지 않는다.
//   ② preview: 신규 기능은 코드 작성 전 디자인/기능 미리보기를 제시하고 사용자 승인(approve)/수정요구(revise)를
//      기록하는 스토어(.harness/previews.json). 승인 전 코드 작성 금지가 지시 레이어 계약.
'use strict';
const path = require('path');
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

// `leerness preview add "<제목>" [--design "..."] [--features "a,b"] | list | show <id> | approve <id> | revise <id> --note "..."`
function previewCmd(root, sub, rest, deps = {}) {
  const { has, arg } = deps;
  root = absRoot(root);
  const json = !!(has && has('--json'));
  if (!exists(path.join(root, '.harness'))) { failJson(json, 'harness_missing', `leerness 미설치: ${root} — 먼저 leerness init`); return; }
  sub = sub || 'list';
  // 1.36.54 (#2 High): 변경 하위명령은 락 안에서 재로드→검증→저장 전체를 직렬화 — 동시 add 의 lost-update 차단.
  const _mutating = ['add', 'approve', 'revise'].includes(sub);
  if (_mutating && deps._withLock && !deps._locked) {
    return deps._withLock(_previewsPath(root), () => previewCmd(root, sub, rest, Object.assign({}, deps, { _locked: true })));
  }
  const _chk = _loadPreviewsChecked(root);
  // 1.36.54 (#1 High): 무효 형상 스토어 위 변경 거부 — 원본 보존 (읽기 명령은 빈 목록으로 관용)
  if (_mutating && _chk.invalid) { failJson(json, 'store_invalid', `previews.json 형상 무효(비배열 루트 또는 null/ID 없는 항목) — 덮어쓰기 거부: ${_previewsPath(root)} (수동 복구 후 재시도)`); return; }
  const list = _chk.list;

  if (sub === 'add') {
    // 1.36.54 (#11): 제목 개행 정규화 — 한 미리보기 = 목록 한 줄 불변식
    const title = (rest || []).join(' ').replace(/\s*\r?\n\s*/g, ' ').trim();
    if (!title) { failJson(json, 'title_required', 'preview add "<기능 제목>" 필요 (+ --design "설명" --features "a,b")'); return; }
    const design = arg ? (arg('--design', '') || '') : '';
    const features = (arg ? (arg('--features', '') || '') : '').split(',').map(s => s.trim()).filter(Boolean);
    const p = { id: _nextPreviewId(list), title, design, features, status: 'proposed', createdAt: now(), history: [{ at: now(), event: 'proposed' }] };
    list.push(p);
    if (!_savePreviews(root, list, json)) return;
    if (json) { log(JSON.stringify({ ok: true, ...p }, null, 2)); return; }
    ok(`preview 등록: ${p.id} 「${title}」 (status: proposed)`);
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
      log(`  ${icon} ${p.id} ${p.title}  [${p.status}]`);
    }
    const pend = pendingPreviews(root).length;
    if (pend) warn(`  미승인 ${pend}건 — 사용자 답을 받기 전 해당 기능 코드 작성 금지`);
    return;
  }

  const id = (rest || [])[0];
  const p = list.find(x => x.id === id);
  if (sub === 'show' || sub === 'approve' || sub === 'revise') {
    if (!id) { failJson(json, 'id_required', `preview ${sub} <P-ID> 필요 (leerness preview list 로 확인)`); return; }
    if (!p) { failJson(json, 'not_found', `preview 없음: ${id}`); return; }
  }

  if (sub === 'show') {
    if (json) { log(JSON.stringify({ ok: true, ...p }, null, 2)); return; }
    log(`# ${p.id} 「${p.title}」  [${p.status}]`);
    if (p.design) log(`  디자인: ${p.design}`);
    if (p.features && p.features.length) { log('  기능:'); p.features.forEach(f => log(`    - ${f}`)); }
    (p.history || []).forEach(h => log(`  · ${h.at} ${h.event}${h.note ? ` — ${h.note}` : ''}`));
    return;
  }
  if (sub === 'approve') {
    // 1.36.54 (#10): 재승인은 멱등 no-op — 중복 이력 방지
    if (p.status === 'approved') {
      if (json) { log(JSON.stringify({ ok: true, id: p.id, status: p.status, changed: false }, null, 2)); return; }
      ok(`${p.id} 이미 승인됨 — 변경 없음`); return;
    }
    p.status = 'approved'; (p.history = p.history || []).push({ at: now(), event: 'approved' });
    if (!_savePreviews(root, list, json)) return;
    if (json) { log(JSON.stringify({ ok: true, id: p.id, status: p.status }, null, 2)); return; }
    ok(`${p.id} 승인 — 이제 구현을 시작해도 됩니다.`);
    return;
  }
  if (sub === 'revise') {
    const note = (arg ? (arg('--note', '') || '') : '').toString().trim();
    // 1.36.54 (#10): 빈 노트 수정요구 거부 — 무엇을 고칠지 없는 revise 는 워크플로 신호가 아니다
    if (!note) { failJson(json, 'note_required', `preview revise ${p.id} --note "<수정 요구 내용>" 필요`); return; }
    p.status = 'revision-requested'; (p.history = p.history || []).push({ at: now(), event: 'revision-requested', note });
    if (!_savePreviews(root, list, json)) return;
    if (json) { log(JSON.stringify({ ok: true, id: p.id, status: p.status, note }, null, 2)); return; }
    ok(`${p.id} 수정요구 기록${note ? ` — ${note}` : ''} — 미리보기를 수정해 다시 제시하세요 (코드 작성은 계속 보류).`);
    return;
  }
  failJson(json, 'unknown_subcommand', `알 수 없는 preview 하위명령: ${sub} (가능: add, list, show, approve, revise)`);
}

module.exports = { CLARIFY_SIGNALS, _clarifySignals, clarifyCmd, previewCmd, pendingPreviews, _previewsPath, _loadPreviews, _loadPreviewsChecked };
