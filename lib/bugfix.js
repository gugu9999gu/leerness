 
//
 
 
 
//
 
 
 
 
 
 
 
//
 
 
//
 
 
//
 
 
 
 
'use strict';
const cp = require('child_process');
const path = require('path');
const { absRoot, exists, read, writeUtf8, mkdirp, log, ok, warn, failJson, now } = require('./io');
const { _lineSafe } = require('./pure-utils');

function _storePath(root) { return path.join(absRoot(root), '.leerness', 'bugfix-receipts.json'); }

const _ID_RE = /^[A-Z]+-\d{3,}$/;

 
 
 
 
function _entryValid(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  if (typeof e.id !== 'string' || !_ID_RE.test(e.id)) return false;
  if (typeof e.repro !== 'string' || !e.repro.trim()) return false;
  if (typeof e.expectBad !== 'string' || !e.expectBad.trim()) return false;
  const b = e.baseline;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
  if (b.failed !== true) return false;                        
  if (typeof b.exit !== 'number') return false;
  if (e.siblingScope != null && (typeof e.siblingScope !== 'object' || Array.isArray(e.siblingScope))) return false;
  if (e.siblingScope && e.siblingScope.checked != null && !Array.isArray(e.siblingScope.checked)) return false;
  if (e.rootCause != null && typeof e.rootCause !== 'string') return false;
  return true;
}

 
 
 
function _normalizeArea(raw) {
  const area = String(raw == null ? '' : raw).trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (!area || area === '.') return { area, problem: 'empty' };
  if (/^[A-Za-z]:/.test(area) || area.startsWith('/')) return { area, problem: 'absolute' };
  if (area.split('/').some(seg => seg === '..' || seg === '.' || seg === '')) return { area, problem: 'not-normal' };
  if (_lineSafe(area) !== area) return { area, problem: 'control' };
  return { area, problem: null };
}
 
 
function _areasOk(areas) {
  return Array.isArray(areas) && areas.length > 0
    && areas.every(a => typeof a === 'string' && !_normalizeArea(a).problem && _normalizeArea(a).area === a);
}
 
const _foldCase = (process.platform === 'win32' || process.platform === 'darwin') ? (s) => s.toLowerCase() : (s) => s;

 
 
 
 
 
 
function fixesForFiles(root, files, excludeId) {
  const chk = _loadChecked(root);
  if (chk.invalid) return { readable: false, fixes: [], skipped: [] };
  const rel = [...new Set((Array.isArray(files) ? files : []).map(f => String(f || '').replace(/\\/g, '/').replace(/^(\.\/)+/, '')).filter(Boolean))];
  const fixes = [], skipped = [];
  if (!rel.length) return { readable: true, fixes, skipped };
  for (const e of chk.list) {
    if (e.areas == null || e.id === String(excludeId)) continue;
    if (!_areasOk(e.areas)) { skipped.push(e.id); continue; }
    const matched = rel.filter(f => e.areas.some(a => _foldCase(f) === _foldCase(a) || _foldCase(f).startsWith(_foldCase(a) + '/')));
    if (matched.length) fixes.push({ id: e.id, areas: e.areas, files: matched, rootCause: typeof e.rootCause === 'string' ? e.rootCause : null, repro: e.repro });
  }
  fixes.sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }));
  return { readable: true, fixes, skipped };
}

 
 
function _siblingScopeOk(sc) {
  if (!sc || typeof sc !== 'object') return false;
  if (Array.isArray(sc.checked) && sc.checked.length > 0) return true;
  return typeof sc.notApplicable === 'string' && !!sc.notApplicable.trim();
}

 
function _loadChecked(root) {
  const f = _storePath(root);
  if (!exists(f)) return { list: [], invalid: false };
  try {
    const j = JSON.parse(read(f));
    if (!Array.isArray(j) || j.some(e => !_entryValid(e))) return { list: [], invalid: true };
    return { list: j, invalid: false };
  } catch { return { list: [], invalid: true }; }
}
 
 
 
 
 
function _atomicWrite(f, list) {
  mkdirp(path.dirname(f));
  const tmp = f + '.tmp' + process.pid;
  writeUtf8(tmp, JSON.stringify(list, null, 2) + '\n');
  require('fs').renameSync(tmp, f);
}
function _locked(deps, f, fn) { return (deps && typeof deps._withLock === 'function') ? deps._withLock(f, fn) : fn(); }
function _upsert(root, entry, deps) {
  const f = _storePath(root);
  return _locked(deps, f, () => {
    const cur = _loadChecked(root);    
    const list = (cur.invalid ? [] : cur.list).filter(x => x.id !== entry.id).concat([entry]);
    _atomicWrite(f, list);
    return list;
  });
}
function _remove(root, id, deps) {
  const f = _storePath(root);
  return _locked(deps, f, () => {
    const cur = _loadChecked(root);
    if (cur.invalid) return null;
    const list = cur.list.filter(x => x.id !== String(id));
    if (list.length === cur.list.length) return null;
    _atomicWrite(f, list);
    return list;
  });
}

function _run(cmd, cwd) {
  const t0 = Date.now();
  const r = cp.spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
  const out = ((r.stdout || '') + '\n' + (r.stderr || '')).trim();
  const code = r.error ? String(r.error.code || r.error.message) : null;
  return {
    status: (r.status == null ? (r.error ? -1 : 1) : r.status),
     
     
     
    overflow: code === 'ENOBUFS',
    spawnError: (code && code !== 'ENOBUFS') ? code : null,
    timedOut: !!(r.error && String(r.error.code) === 'ETIMEDOUT'),
    output: out,
    sample: out.slice(0, 4000),
    ms: Date.now() - t0,
  };
}

 
 
function _launcherFailure(r) {
  if (!r) return null;
  if (r.spawnError) return `실행 실패(${r.spawnError})`;
  if (r.status === 127 || r.status === 9009) return `명령을 찾을 수 없음(exit ${r.status})`;
  return null;
}

 
 
 
 
 
function _toolErrorHint(r) {
  if (!r || r.status === 0) return null;
  if (/(?:command not found|not recognized as an internal or external command|cannot find module)/i.test(r.output || '')) {
    return '출력이 도구/경로 오류처럼 보입니다 — 버그 재현이 아닐 수 있으니 probe 를 확인하세요';
  }
  return null;
}

 
 
 
function _start(root, id, deps) {
  const { arg, has } = deps;
  const json = !!(has && has('--json'));
  const repro = (arg ? arg('--repro', '') : '') || '';
  const expectBad = (arg ? arg('--expect-bad', '') : '') || '';
  if (!_ID_RE.test(String(id || ''))) { failJson(json, 'invalid_id', `task id 형식이 아님: ${JSON.stringify(id)} (예: T-0007)`); return; }
   
   
  if (typeof deps._taskExists === 'function' && !deps._taskExists(root, String(id))) {
    failJson(json, 'task_not_found', `progress-tracker 에 없는 task: ${id} — 먼저 leerness task add "<제목>" (오타면 leerness task list 로 확인)`);
    return;
  }
  if (!repro.trim()) { failJson(json, 'missing_repro', '--repro "<버그를 재현하는 명령>" 필요 — 지금 실패해야 합니다'); return; }
  if (!expectBad.trim()) { failJson(json, 'missing_expect', '--expect-bad "<기대 실패 신호>" 필요 — 없으면 무관한 실패와 진짜 재현을 구분할 수 없습니다'); return; }

  const chk = _loadChecked(root);
  if (chk.invalid) { failJson(json, 'store_invalid', `bugfix-receipts.json 형상 무효 — 덮어쓰기 거부\n  · ${_recoverHint(root)}`); return; }

  const r = _run(repro, absRoot(root));
  const lf = _launcherFailure(r);
  const matched = r.output.includes(expectBad);
  const reasons = [];
  if (r.overflow) reasons.push('probe 출력이 한도(8MB)를 넘어 재현 여부를 판정할 수 없습니다 — 출력을 줄이거나 파일로 보내세요');
  if (lf) reasons.push(`${lf} — 심어둔 버그가 아니라 명령이 실행되지 못했습니다`);
  else if (r.status === 0) reasons.push('probe 가 지금 **통과**합니다(exit 0) — 버그가 재현되지 않으면 수정 후 통과는 아무것도 증명하지 못합니다');
  if (!lf && !matched) reasons.push(`출력에 기대 신호 "${expectBad}" 없음 — 무관한 실패일 수 있습니다`);
   
   
   
  let r2 = null;
  if (!reasons.length) {
    r2 = _run(repro, absRoot(root));
    if (_launcherFailure(r2) || r2.status === 0 || !r2.output.includes(expectBad)) {
      reasons.push(`두 번째 실행에서 재현되지 않았습니다(exit ${r2.status}) — 상태를 남기는 1회성 probe 는 수정 여부와 무관하게 통과하므로 등록하지 않습니다`);
    }
  }

  const entry = {
    id: String(id), repro, expectBad,
    baseline: { at: now(), failed: !lf && r.status !== 0, exit: r.status, expectMatched: matched, reproduced: 2, ms: r.ms, sample: reasons.length ? r.sample.slice(0, 400) : undefined },
    rootCause: null, siblingScope: null, previousGuardGap: null,
  };
  if (reasons.length) {
    if (json) { log(JSON.stringify({ ok: false, code: 'probe_not_reproducing', id: entry.id, reasons }, null, 2)); }
    else { warn(`probe 가 버그를 재현하지 못했습니다 — 등록하지 않습니다`); reasons.forEach(x => log(`  - ${x}`)); }
    if (typeof process !== 'undefined') process.exitCode = 1;
    return;
  }
  const hint = _toolErrorHint(r);    
  _upsert(root, entry, deps);
   
   
  const gateOn = require('./toggles').toggleOn(root, 'bugfix-receipt');
  if (json) { log(JSON.stringify({ ok: true, id: entry.id, baseline: entry.baseline, gateEnabled: gateOn, hint: hint || undefined }, null, 2)); return; }
  ok(`bugfix probe 등록: ${entry.id} — 지금 재현됨(2회 연속 exit ${r.status} · 신호 일치)`);
  if (hint) warn(`  ${hint}`);
  log(`  ⚠ 이 명령은 앞으로 \`--status done\` 시 자동 실행됩니다 — 저장 위치: ${_storePath(root)}`);
  if (gateOn) log(`  → 수정 후 \`leerness task update ${entry.id} --status done\` 시 같은 probe 가 통과해야 합니다.`);
  else warn(`  이 프로젝트에서 완료 게이트는 **꺼져 있습니다** — 지금은 기록만 되고 done 은 막히지 않습니다.\n     켜기: leerness toggle set bugfix-receipt on`);
  log(`  → 근본원인/형제범위 기록: leerness bugfix receipt ${entry.id} --root-cause "..." --siblings "..." --areas "<고친 파일·폴더>"`);
}

 
 
function _receipt(root, id, deps) {
  const { arg, has } = deps;
  const json = !!(has && has('--json'));
  const t = (ko, en) => (deps.uiLang === 'en' ? en : ko);
  const chk = _loadChecked(root);
  if (chk.invalid) { failJson(json, 'store_invalid', `bugfix-receipts.json 형상 무효 — 덮어쓰기 거부\n  · ${_recoverHint(root)}`); return; }
  const e = chk.list.find(x => x.id === String(id));
  if (!e) { failJson(json, 'probe_not_found', `bugfix probe 없음: ${id} — 먼저 leerness bugfix start ${id} --repro "..." --expect-bad "..."`); return; }
  const rc = (arg ? arg('--root-cause', '') : '') || '';
  const sib = (arg ? arg('--siblings', '') : '') || '';
  const sibNa = (arg ? arg('--siblings-na', '') : '') || '';
  const gap = (arg ? arg('--previous-gap', '') : '') || '';
  const areasRaw = (arg ? arg('--areas', '') : '') || '';
   
   
  const areasGiven = !!(has && has('--areas')) || areasRaw !== '';
  if (rc.trim()) e.rootCause = rc.trim();
   
   
  const parsed = sib.trim() ? sib.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (sib.trim() && !parsed.length) { failJson(json, 'empty_siblings', `--siblings 값에 항목이 없습니다: ${JSON.stringify(sib)} — 쉼표로 구분된 형제 지점을 적거나, 없으면 --siblings-na "<사유>"`); return; }
   
   
  let areas = null;
  if (areasGiven) {
    const items = areasRaw.split(',').map(s => s.trim()).filter(Boolean);
    if (!items.length) { failJson(json, 'empty_areas', t(`--areas 값에 경로가 없습니다: ${JSON.stringify(areasRaw)} — 쉼표로 구분된 파일·폴더를 적으세요(예: --areas "lib/orders.js,src/sync")`, `--areas has no path: ${JSON.stringify(areasRaw)} — list files or folders separated by commas (e.g. --areas "lib/orders.js,src/sync")`)); return; }
    const why = { empty: t('빈 경로나 저장소 전체(.)는 영역이 아닙니다', 'an empty path or the whole repository (.) is not an area'), absolute: t('저장소 기준 상대 경로여야 합니다', 'use a path relative to the repository'), 'not-normal': t('.. · . · 빈 세그먼트 없이 적으세요', 'write it without .., . or empty segments'), control: t('제어문자가 들어 있습니다', 'it contains control characters') };
    const bad = items.find(s => _normalizeArea(s).problem);
    if (bad != null) { failJson(json, 'invalid_area', t(`쓸 수 없는 영역: ${JSON.stringify(bad)} — ${why[_normalizeArea(bad).problem]}`, `unusable area: ${JSON.stringify(bad)} — ${why[_normalizeArea(bad).problem]}`)); return; }
    areas = [...new Set(items.map(s => _normalizeArea(s).area))];
  }
  if (parsed.length) e.siblingScope = { checked: parsed };
  else if (sibNa.trim()) e.siblingScope = { notApplicable: sibNa.trim() };
  if (gap.trim()) e.previousGuardGap = gap.trim();
  if (areas) e.areas = areas;
   
  const missingAreas = areas ? areas.filter(a => !exists(path.join(absRoot(root), a))) : [];
  _upsert(root, e, deps);
  if (json) { log(JSON.stringify({ ok: true, id: e.id, rootCause: e.rootCause, siblingScope: e.siblingScope, previousGuardGap: e.previousGuardGap, areas: e.areas === undefined ? null : e.areas, missingAreas }, null, 2)); return; }
  ok(t(`bugfix 영수증 갱신: ${e.id}`, `bugfix receipt updated: ${e.id}`));
  log(t(`  ⓘ 근본원인·형제범위는 **선언**입니다 — leerness 는 내용의 진위를 판정하지 않습니다(검증되는 것은 probe 뿐).`, `  ⓘ Root cause and sibling scope are **declarations** — leerness does not judge whether they are true (only the probe is verified).`));
  if (areas) log(t(`  영역: ${areas.join(', ')} — 이 경로를 증거에 적은 task 의 verify-claim 이 이 수정을 보여 줍니다(권고)`, `  Areas: ${areas.join(', ')} — verify-claim shows this fix for tasks whose evidence names these paths (advisory)`));
  if (missingAreas.length) warn(t(`  지금 없는 경로: ${missingAreas.join(', ')} — 오타라면 --areas 로 다시 기록하세요(그대로 저장됨)`, `  Paths that do not exist now: ${missingAreas.join(', ')} — if that is a typo, record --areas again (saved as written)`));
}

 
 
function _pathArg(root) {
  try {
    const abs = absRoot(root);
    if (!abs || abs === process.cwd()) return '';
    return / /.test(abs) ? ` --path "${abs}"` : ` --path ${abs}`;
  } catch { return ''; }
}

 
 
 
 
 
 
function _recoverHint(root) {
  const f = _storePath(root);
  return `회복: ${f} 를 고치거나(병합 충돌 마커 제거 등) 다른 이름으로 옮기세요 — 옮기면 등록된 probe 가 없는 상태가 되어 완료 게이트는 무영향입니다(파일을 되돌리면 게이트도 되살아납니다)`;
}

 
 
 
 
function escapeHint(code, id, root) {
   
   
  if (code === 'store_invalid') return null;
  const p = _pathArg(root);
  return `ⓘ 탈출구: leerness bugfix drop ${id || '<ID>'}${p} (probe 등록 취소) · leerness toggle set bugfix-receipt off${p} (프로젝트 정책)`;
}

 
 
function checkDoneTransition(root, id) {
  const chk = _loadChecked(root);
  if (chk.invalid) {
     
    return {
      blocked: true, code: 'store_invalid',
      message: `bugfix-receipts.json 형상 무효 — 완료 판정을 보류합니다(어느 task 에 probe 가 걸려 있었는지 알 수 없기 때문): ${_storePath(root)}`,
      lines: [_recoverHint(root)],
    };
  }
  const e = chk.list.find(x => x.id === String(id));
  if (!e) return { blocked: false };    
  const r = _run(e.repro, absRoot(root));
  const lf = _launcherFailure(r);
  const lines = [];
  if (lf) return { blocked: true, code: 'probe_unrunnable', message: `재현 probe 를 실행할 수 없습니다 — ${lf}: ${e.repro}` };
   
  if (r.overflow) {
    return {
      blocked: true, code: 'probe_output_too_large',
      message: `probe 출력이 한도(8MB)를 넘어 통과 여부를 판정할 수 없습니다 — 출력을 줄이거나 파일로 보내세요(예: > out.log): ${e.repro}`,
    };
  }
  if (r.status !== 0) {
    return {
      blocked: true, code: 'probe_still_failing',
      message: `재현 probe 가 아직 실패합니다(exit ${r.status}) — 버그가 남아 있거나 probe 자체가 깨졌습니다(아래 출력 확인): ${e.repro}`,
      lines: [r.sample.split('\n').slice(0, 6).join('\n')],
    };
  }
  const missing = [];
  if (!e.rootCause) missing.push('--root-cause');
  if (!_siblingScopeOk(e.siblingScope)) missing.push('--siblings 또는 --siblings-na');
  if (missing.length) {
    return {
      blocked: true, code: 'receipt_incomplete',
      message: `영수증 미완: ${missing.join(' · ')} — leerness bugfix receipt ${e.id} ${missing.map(m => m.split(' ')[0] + ' "..."').join(' ')}`,
    };
  }
   
  const wasExit = (e.baseline && e.baseline.exit != null) ? `수정 전 exit ${e.baseline.exit} → ` : '';
  lines.push(`✓ 재현 probe 통과(${wasExit}지금 exit 0): ${e.repro}`);
   
   
   
  if (e.expectBad && r.output.includes(e.expectBad)) {
    lines.push(`⚠ exit 는 0 이지만 등록 당시 실패 신호 "${e.expectBad}" 가 출력에 아직 있습니다 — probe 가 정말 그 버그를 보고 있는지 확인하세요.`);
  }
  lines.push(`ⓘ 아래는 **선언**이며 내용의 진위는 검증하지 않았습니다:`);
  lines.push(`   근본원인: ${e.rootCause}`);
  lines.push(`   형제범위: ${e.siblingScope.notApplicable ? 'not-applicable — ' + e.siblingScope.notApplicable : (e.siblingScope.checked || []).join(', ')}`);
  if (e.previousGuardGap) lines.push(`   이전 검증이 놓친 이유: ${e.previousGuardGap}`);
  return { blocked: false, lines };
}

 
 
 
 
class BugfixBlocked extends Error {
   
   
  constructor(res, id, root) {
    super((res && res.message) || 'bugfix 완료 게이트에 의해 보류');
    this.name = 'BugfixBlocked';
    this.taskId = String(id);
    this.code = (res && res.code) || 'blocked';
    this.lines = (res && res.lines) || [];
    this.root = root || null;
  }
}

function bugfixCmd(root, sub, rest, deps = {}) {
  const { has } = deps;
  root = absRoot(root);
  const json = !!(has && has('--json'));
  if (!exists(path.join(root, '.leerness'))) { failJson(json, 'harness_missing', `leerness 미설치: ${root} — 먼저 leerness init`); return; }
  const id = (rest || [])[0];
  if (sub === 'start') return _start(root, id, deps);
  if (sub === 'receipt') return _receipt(root, id, deps);
   
   
  if (sub === 'drop') {
    const chk = _loadChecked(root);
     
     
     
     
     
     
     
     
     
    if (chk.invalid) {
      failJson(json, 'store_invalid', `bugfix-receipts.json 형상 무효 — 개별 삭제는 할 수 없습니다(어느 항목이 어느 task 것인지 읽을 수 없습니다)\n`
        + `  · ${_recoverHint(root)}`);
      return;
    }
    const left = _remove(root, id, deps);
    if (left === null) { failJson(json, 'probe_not_found', `bugfix probe 없음: ${id}`); return; }
    if (json) { log(JSON.stringify({ ok: true, id: String(id), remaining: left.length }, null, 2)); return; }
    ok(`bugfix probe 삭제: ${id} (남은 ${left.length}건) — 이 task 는 다시 완료 게이트 무영향이 됩니다`);
    return;
  }
  if (sub === 'list' || !sub) {
    const chk = _loadChecked(root);
     
    if (json) {
      log(JSON.stringify({
        ok: !chk.invalid, invalid: chk.invalid,
        ...(chk.invalid ? { recovery: [_recoverHint(root)] } : {}),
        receipts: chk.list.map(e => ({ id: e.id, repro: e.repro, baselineFailed: !!(e.baseline && e.baseline.failed), rootCause: e.rootCause, siblingScope: e.siblingScope, areas: e.areas === undefined ? null : e.areas })),
      }, null, 2));
      return;
    }
    if (chk.invalid) { warn(`bugfix-receipts.json 형상 무효: ${_storePath(root)}`); log(`  · ${_recoverHint(root)}`); return; }
    if (!chk.list.length) { log('등록된 bugfix probe 없음 — leerness bugfix start <T-ID> --repro "..." --expect-bad "..."'); return; }
     
     
     
    const t = (ko, en) => (deps.uiLang === 'en' ? en : ko);
    const areaCol = (e) => (e.areas == null ? '' : `  ${t('영역', 'areas')}=${_areasOk(e.areas) ? e.areas.join(',') : t('(형식 오류)', '(malformed)')}`);
    const rec = (v) => (v ? t('기록됨', 'recorded') : t('미기록', 'not recorded'));
    chk.list.forEach(e => log(`  ${e.id}  probe=${e.repro.slice(0, 50)}  ${t('근본원인', 'root-cause')}=${rec(e.rootCause)}  ${t('형제범위', 'siblings')}=${rec(_siblingScopeOk(e.siblingScope))}${areaCol(e)}`));
    return;
  }
  failJson(json, 'unknown_subcommand', `알 수 없는 bugfix 하위명령: ${sub} (가능: start, receipt, drop, list)`);
}

 
 
 
module.exports = { bugfixCmd, checkDoneTransition, BugfixBlocked, escapeHint, _storePath, _loadChecked, _siblingScopeOk, fixesForFiles, _normalizeArea };
