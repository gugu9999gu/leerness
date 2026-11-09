 
 
 
'use strict';
const path = require('path');
const { absRoot, exists, read, writeUtf8, mkdirp, log, ok, fail } = require('./io');

 
const TOGGLE_REGISTRY = {
  'gate': { desc: '완료 게이트 (verify+audit+scan+encoding+lazy 통합 점검)', affects: 'leerness gate' },
  'lens': { desc: '품질 렌즈 자기질문 (완료 선언 전 분야별 점검)', affects: 'leerness lens' },
  'auto-graph': { desc: '온톨로지 그래프(leerness.html) 자동 갱신 (install/session-close)', affects: 'install · session close' },
  'delegation-brief': { desc: '백그라운드 AI 위임 시 leerness 프로토콜 브리프 자동 접두', affects: 'agents dispatch · agents multi' },
   
   
   
   
  'bugfix-receipt': { desc: 'bugfix 완료 게이트 — `leerness bugfix start` 로 probe 를 등록한 task 에 한해, done 시 probe 통과 + 근본원인/형제범위 영수증 요구 (기본 OFF)', affects: 'task update --status done · task sync --from', defaultOff: true },
   
  'difficulty-routing': { desc: '작업 난이도별 모델 라우팅 — `leerness agents route` 의 --confirm 허용(제안/열람은 토글과 무관). 고위험은 --approved-by 필수 (기본 OFF)', affects: 'leerness agents route --confirm', defaultOff: true },
   
   
   
   
   
  'workflow-distribute': { desc: '세션 워크플로의 "분배(sub-agent)" 단계 지시문 — 끄면 단계 안내를 싣지 않는다 (증거 검증에는 영향 없음)', affects: 'handoff · session-workflow 안내' },
  'double-verify': { desc: '완료 전 재확인 지시문(같은 것을 다시 확인하라는 안내) — 끄면 안내만 생략된다 (gate/verify-claim 실행은 그대로)', affects: 'handoff · lens 안내' },
  'full-reread': { desc: '매 세션 관련 문서 전체 재독 지시문 — 끄면 "필요할 때 읽어라" 로 바뀐다 (문서와 상태는 그대로 남는다)', affects: 'handoff 안내' },
  'plain-language-reporting': { desc: '결과·영향·근거·필요한 행동을 쉬운 말로 보고하는 선택 정책 (기본 OFF)', affects: 'handoff · 보고 안내', defaultOff: true },
};
const TOGGLE_REGISTRY_EN = {
  'gate': { desc: 'completion gate (integrated verify+audit+scan+encoding+lazy checks)', affects: 'leerness gate' },
  'lens': { desc: 'quality-lens self-questions (domain checks before claiming completion)', affects: 'leerness lens' },
  'auto-graph': { desc: 'automatically refresh the ontology graph (leerness.html) on install/session-close', affects: 'install · session close' },
  'delegation-brief': { desc: 'prepend the Leerness protocol brief when delegating to a background AI', affects: 'agents dispatch · agents multi' },
  'bugfix-receipt': { desc: 'bugfix completion gate — tasks with a registered probe must pass it and record root cause/sibling scope before done (OFF by default)', affects: 'task update --status done · task sync --from' },
  'difficulty-routing': { desc: 'route work by difficulty — allows --confirm for leerness agents route; high-risk work still requires --approved-by (OFF by default)', affects: 'leerness agents route --confirm' },
  'workflow-distribute': { desc: 'the distribute (sub-agent) instruction in the session workflow; disabling it removes only the instruction, not evidence checks', affects: 'handoff · session-workflow guidance' },
  'double-verify': { desc: 'the instruction to recheck work before completion; disabling it omits only the guidance, not gate/verify-claim execution', affects: 'handoff · lens guidance' },
  'full-reread': { desc: 'the instruction to reread every related document each session; disabling it changes the wording to read when needed', affects: 'handoff guidance' },
  'plain-language-reporting': { desc: 'optional evidence-backed reports in everyday language (OFF by default)', affects: 'handoff · reporting guidance' },
};
const _hasToggle = (id) => Object.prototype.hasOwnProperty.call(TOGGLE_REGISTRY, id);
 
 
const SCAFFOLD_TOGGLES = ['workflow-distribute', 'double-verify', 'full-reread'];
const EVIDENCE_COMMANDS = ['gate', 'verify-claim', 'scan', 'audit'];

function _togglesPath(root) { return path.join(absRoot(root), '.leerness', 'toggles.json'); }

 
 
 
 
 
 
 
function _coerceToggle(v, dflt) {
  if (v === true || v === false) return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'on' || s === 'true' || s === '1') return true;
    if (s === 'off' || s === 'false' || s === '0') return false;
  }
  return dflt;
}

 
 
 
function loadTogglesChecked(root, reader = null) {
  const { read, exists } = reader || require('./io');
  const out = {};
  for (const [id, meta] of Object.entries(TOGGLE_REGISTRY)) out[id] = !(meta && meta.defaultOff);
  const f = _togglesPath(root);
  if (!exists(f)) return { toggles: out, corrupt: false, unreadable: [], stored: [] };
  const source = read(f);
  try {
    const j = JSON.parse(source);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { toggles: out, corrupt: true, reason: '최상위가 객체가 아닙니다', unreadable: [], stored: [] };
     
     
    const unreadable = [];
    const stored = [];
    for (const [k, v] of Object.entries(j)) {
       
       
      if (!_hasToggle(k)) continue;
      const coerced = _coerceToggle(v, out[k]);
      if (_coerceToggle(v, true) !== _coerceToggle(v, false)) unreadable.push(k);    
      else stored.push(k);
      out[k] = coerced;
    }
    return { toggles: out, corrupt: false, unreadable, stored };
  } catch { return { toggles: out, corrupt: true, reason: 'JSON 파싱 실패', unreadable: [], stored: [] }; }
}

function loadToggles(root, reader = null) { return loadTogglesChecked(root, reader).toggles; }

 
function toggleOn(root, id, reader = null) {
  const st = loadToggles(root, reader);
  return Object.prototype.hasOwnProperty.call(st, id) ? st[id] === true : true;
}

function saveToggles(root, toggles) {
  const f = _togglesPath(root);
   
   
  mkdirp(path.dirname(f));
  writeUtf8(f, JSON.stringify(toggles, null, 2) + '\n');
}

 
function toggleCmd(root, sub, id, val, deps = {}) {
  const { has, VERSION } = deps;
  root = absRoot(root);
  const en = deps.uiLang === 'en';
  const t = (ko, enText) => (en ? enText : ko);
  const reasonText = reason => (en
    ? (reason === '최상위가 객체가 아닙니다' ? 'top level is not an object' : reason === 'JSON 파싱 실패' ? 'JSON parse failed' : reason)
    : reason);
   
   
   
  if (sub === 'set' && typeof deps._withLock === 'function' && !deps._locked) {
    return deps._withLock(_togglesPath(root), () => toggleCmd(root, sub, id, val, Object.assign({}, deps, { _locked: true })));
  }
  const json = has && has('--json');
  const _chk = loadTogglesChecked(root);
  const cur = _chk.toggles;
  if (!sub || sub === 'list') {
    if (json) { log(JSON.stringify({ version: VERSION, toggles: cur, corrupt: !!_chk.corrupt, corruptReason: _chk.reason, registry: TOGGLE_REGISTRY }, null, 2)); return; }
    log(t(`# leerness toggle — 기능 토글 (온톨로지 그래프 뷰 ⚙ 탭과 연동)`, `# leerness toggle — feature toggles (synced with the ontology graph ⚙ tab)`));
     
    if (_chk.corrupt) log(t(
      `  ⚠ toggles.json 손상(${_chk.reason}) — 아래는 **저장값이 아니라 기본값**입니다. 켜 두었던 토글이 꺼져 보일 수 있습니다: ${_togglesPath(root)}`,
      `  ⚠ toggles.json is corrupt (${reasonText(_chk.reason)}) — values below are **defaults, not stored values**. A previously enabled toggle may appear disabled: ${_togglesPath(root)}`,
    ));
    for (const [k, meta] of Object.entries(TOGGLE_REGISTRY)) {
      const shown = en ? TOGGLE_REGISTRY_EN[k] : meta;
      log(`  ${cur[k] ? '🟢 ON ' : '⚪ OFF'}  ${k.padEnd(17)} ${shown.desc}  [${shown.affects}]`);
    }
    log(t(
      `\n  변경: leerness toggle set <id> on|off  ·  그래프 뷰: leerness graph --html → leerness.html 의 ⚙ 탭`,
      `\n  Change: leerness toggle set <id> on|off  ·  Graph view: leerness graph --html → the ⚙ tab in leerness.html`,
    ));
    return;
  }
  if (sub === 'get') {
    if (!_hasToggle(id)) { fail(t(`알 수 없는 토글: ${id} (가능: ${Object.keys(TOGGLE_REGISTRY).join(', ')})`, `Unknown toggle: ${id} (valid: ${Object.keys(TOGGLE_REGISTRY).join(', ')})`)); process.exitCode = 1; return; }
    const payload = {
      ok: true,
      id,
      value: cur[id] === true,
       
       
      source: Array.isArray(_chk.stored) && _chk.stored.includes(id) ? 'stored' : 'default',
      corrupt: !!_chk.corrupt,
      corruptReason: _chk.reason || null,
      unreadable: Array.isArray(_chk.unreadable) ? _chk.unreadable.includes(id) : false,
      meta: TOGGLE_REGISTRY[id],
    };
    if (json) { log(JSON.stringify(payload, null, 2)); return payload; }
    if (_chk.corrupt) log(t(`  ⚠ toggles.json 손상(${_chk.reason}) — 아래 값은 저장값이 아니라 기본값입니다: ${_togglesPath(root)}`, `  ⚠ toggles.json is corrupt (${reasonText(_chk.reason)}) — the value below is a default, not a stored value: ${_togglesPath(root)}`));
    if (payload.unreadable) log(t(`  ⚠ ${id} 저장값을 해석할 수 없어 기본값으로 표시합니다.`, `  ⚠ The stored value for ${id} is unreadable, so the default is shown.`));
    log(`${payload.value ? '🟢 ON' : '⚪ OFF'}  ${id} — ${(en ? TOGGLE_REGISTRY_EN[id] : TOGGLE_REGISTRY[id]).desc}  [${payload.source}]`);
    return payload;
  }
  if (sub === 'set') {
    if (!_hasToggle(id)) { fail(t(`알 수 없는 토글: ${id} (가능: ${Object.keys(TOGGLE_REGISTRY).join(', ')})`, `Unknown toggle: ${id} (valid: ${Object.keys(TOGGLE_REGISTRY).join(', ')})`)); process.exitCode = 1; return; }
    const on = String(val).toLowerCase();
    if (on !== 'on' && on !== 'off') { fail(t(`값은 on|off (받음: ${val})`, `Value must be on|off (received: ${val})`)); process.exitCode = 1; return; }
     
     
    const f = _togglesPath(root);
    if (exists(f)) {
      try { JSON.parse(read(f)); }
      catch { fail(t(`toggles.json 손상(JSON 파싱 실패) — 덮어쓰기 거부: ${f}\n  복구하거나 삭제(전 토글 기본 ON 복원) 후 재시도`, `toggles.json is corrupt (JSON parse failed) — refusing to overwrite: ${f}\n  Repair it or delete it to restore defaults, then retry`)); process.exitCode = 1; return; }
    }
    cur[id] = on === 'on';
    saveToggles(root, cur);
    if (json) { log(JSON.stringify({ ok: true, id, value: cur[id], toggles: cur }, null, 2)); return; }
    const offNote = id === 'plain-language-reporting'
      ? t(' — 자동 보고 안내만 꺼집니다', ' — only automatic reporting guidance is disabled')
      : t(' — 관련 명령이 스킵 동작으로 전환됩니다', ' — related commands will switch to skip behavior');
    ok(`toggle ${id} = ${on.toUpperCase()}${cur[id] ? '' : offNote}`);
    return;
  }
  fail(t(`알 수 없는 하위명령: ${sub} (가능: list, get, set)`, `Unknown subcommand: ${sub} (valid: list, get, set)`)); process.exitCode = 1;
}

module.exports = { TOGGLE_REGISTRY, SCAFFOLD_TOGGLES, EVIDENCE_COMMANDS, loadToggles, loadTogglesChecked, toggleOn, saveToggles, toggleCmd, _togglesPath, _coerceToggle };
