 
 
 
 
 
 
 
 
 
'use strict';
const cp = require('child_process');
const crypto = require('crypto');
const path = require('path');
const { absRoot, exists, read, writeUtf8, log, ok, warn, failJson, now } = require('./io');

function _refereesPath(root) { return path.join(absRoot(root), '.leerness', 'referees.json'); }

 
 
 
const _ID_RE = /^[a-z0-9][a-z0-9._-]{0,48}$/;
function _entryValid(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  if (typeof e.id !== 'string' || !_ID_RE.test(e.id)) return false;
  for (const k of ['check', 'good', 'bad']) if (typeof e[k] !== 'string' || !e[k].trim()) return false;
  if (e.expectBad != null && typeof e.expectBad !== 'string') return false;
  if (e.calibration != null) {
    const c = e.calibration;
    if (typeof c !== 'object' || Array.isArray(c)) return false;
     
     
     
    if (typeof c.ok !== 'boolean') return false;
    if (typeof c.fingerprint !== 'string' || !c.fingerprint) return false;
  }
  return true;
}
function _loadChecked(root) {
  const f = _refereesPath(root);
  if (!exists(f)) return { list: [], invalid: false };
  try {
    const j = JSON.parse(read(f));
    if (!Array.isArray(j) || j.some(e => !_entryValid(e))) return { list: [], invalid: true };
    return { list: j, invalid: false };
  } catch { return { list: [], invalid: true }; }
}
function loadReferees(root) { return _loadChecked(root).list; }

function _save(root, list, json) {
  const f = _refereesPath(root);
  if (exists(f)) { try { JSON.parse(read(f)); } catch { failJson(json, 'store_corrupt', `referees.json 손상 — 덮어쓰기 거부: ${f} (복구/삭제 후 재시도)`); return false; } }
  writeUtf8(f, JSON.stringify(list, null, 2) + '\n');
  return true;
}

 
function _fingerprint(r) {
  return crypto.createHash('sha256').update([r.check || '', r.good || '', r.bad || '', r.expectBad || ''].join('\u0000')).digest('hex').slice(0, 16);
}
 
 
 
 
function isStale(r) { return !!r.calibration && r.calibration.ok === true && r.calibration.fingerprint !== _fingerprint(r); }
 
function isCalibrated(r) { return !!(r.calibration && r.calibration.ok === true && !isStale(r)); }

function _run(cmd, cwd, timeoutMs) {
  const t0 = Date.now();
  const r = cp.spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  const out = ((r.stdout || '') + '\n' + (r.stderr || '')).trim();
  return {
    status: (r.status == null ? (r.error ? -1 : 1) : r.status),
    timedOut: !!(r.error && /ETIMEDOUT|timed? ?out/i.test(String(r.error.message || r.error.code || ''))),
    spawnError: r.error ? String(r.error.code || r.error.message) : null,
     
     
    output: out,
    sample: out.slice(0, 8000),
    ms: Date.now() - t0,
  };
}

 
 
function _launcherFailure(r) {
  if (!r) return null;
  if (r.spawnError) return `실행 실패(${r.spawnError})`;
  if (r.status === 127 || r.status === 9009) return `명령을 찾을 수 없음(exit ${r.status})`;
  const o = r.output || '';
  if (/(?:command not found|not recognized as an internal or external command|No such file or directory|SyntaxError:|cannot find module)/i.test(o)) {
    return '런처/문법 수준 오류 — 검증기가 결함을 잡은 것이 아님';
  }
  return null;
}

 
function calibrate(root, r, opts = {}) {
  const cwd = absRoot(root);
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs) || 600000);
  const good = _run(r.good, cwd, timeoutMs);
  const bad = _run(r.bad, cwd, timeoutMs);
   
   
  const chk = _run(r.check, cwd, timeoutMs);
  const reasons = [];
  const _gl = _launcherFailure(good), _bl = _launcherFailure(bad), _cl = _launcherFailure(chk);
  if (_gl) reasons.push(`known-good ${_gl} — 명령/도구 확인`);
  else if (good.status !== 0) reasons.push(`known-good 이 이미 실패(exit ${good.status}) — 기준선이 빨간 상태로는 탐지력을 증명할 수 없음`);
  if (_bl) reasons.push(`known-bad ${_bl} — 심어둔 결함이 아니라 명령 자체가 실행되지 못했습니다`);
  else if (bad.status === 0) reasons.push(`known-bad 를 통과시킴(exit 0) — 검증기가 심어둔 결함을 못 잡음(탐지력 없음)`);
  if (_cl) reasons.push(`check(${r.check}) ${_cl} — 실제 검증 명령이 기동되지 않음`);
   
  let matched = null;
  if (!r.expectBad || !String(r.expectBad).trim()) {
    reasons.push('--expect-bad 필요 — 기대 실패 신호가 없으면 무관한 실패와 진짜 탐지를 구분할 수 없습니다');
  } else {
    matched = bad.output.includes(r.expectBad);    
    if (!_bl && bad.status !== 0 && !matched) reasons.push(`known-bad 는 실패했지만 사유 불일치 — 출력에 "${r.expectBad}" 없음(무관한 실패일 수 있음)`);
    if (matched && bad.status === 0) reasons.push('known-bad 출력에 신호는 있으나 exit 0 — 검증기가 실패로 처리하지 않았습니다');
  }
  if (good.timedOut || bad.timedOut || chk.timedOut) reasons.push('타임아웃 — 캘리브레이션 불가');
  const okAll = reasons.length === 0;
  return {
    ok: okAll,
    at: now(),
    fingerprint: _fingerprint(r),
    goodExit: good.status, badExit: bad.status, checkExit: chk.status,
    expectMatched: matched,
    goodMs: good.ms, badMs: bad.ms,
    reasons,
    badSample: okAll ? undefined : (bad.sample || '').slice(0, 400),
  };
}


 
function refereeCmd(root, sub, rest, deps = {}) {
  const { has, arg, VERSION, _withLock } = deps;
  root = absRoot(root);
  const json = !!(has && has('--json'));
  if (!exists(path.join(root, '.leerness'))) { failJson(json, 'harness_missing', `leerness 미설치: ${root} — 먼저 leerness init`); return; }
  sub = sub || 'list';
   
   
  const mutating = ['add', 'drop'].includes(sub);
  if (mutating && typeof _withLock === 'function' && !deps._locked) {
    return _withLock(_refereesPath(root), () => refereeCmd(root, sub, rest, Object.assign({}, deps, { _locked: true })));
  }
  const chk = _loadChecked(root);
  if (mutating && chk.invalid) { failJson(json, 'store_invalid', `referees.json 형상 무효 — 덮어쓰기 거부: ${_refereesPath(root)} (수동 복구 후 재시도)`); return; }
  const list = chk.list;

  if (sub === 'add') {
    const id = String((rest || [])[0] || '').trim();
    if (!_ID_RE.test(id)) { failJson(json, 'invalid_id', `referee id 형식: 소문자/숫자로 시작, [a-z0-9._-] 49자 이내 (받은 값: ${JSON.stringify(id)})`); return; }
    const check = (arg ? arg('--check', '') : '') || '';
    const good = (arg ? arg('--good', '') : '') || '';
    const bad = (arg ? arg('--bad', '') : '') || '';
    const expectBad = (arg ? arg('--expect-bad', '') : '') || '';
    if (check === true || good === true || bad === true || expectBad === true) { failJson(json, 'missing_value', '플래그에 값이 필요합니다 — 예: --check "npm test"'); return; }
     
    if (!check || !good || !bad || !expectBad) { failJson(json, 'missing_args', 'referee add <id> --check "<검증 명령>" --good "<정상 상태 명령>" --bad "<일부러 망가뜨린 상태 명령>" --expect-bad "<기대 실패 신호>" 필요 (expect-bad 없이는 무관한 실패와 탐지를 구분 불가)'); return; }
    if (list.some(x => x.id === id)) { failJson(json, 'already_exists', `이미 존재: ${id} (제거: leerness referee drop ${id})`); return; }
    const r = { id, check, good, bad, expectBad: expectBad || '', createdAt: now(), calibration: null };
    list.push(r);
    if (!_save(root, list, json)) return;
    if (json) { log(JSON.stringify({ ok: true, ...r, calibrated: false, stale: true }, null, 2)); return; }
    ok(`referee 등록: ${id}`);
    log(`  검증 명령: ${check}`);
    log(`  ⓘ 아직 캘리브레이션 전 — 탐지력이 증명되지 않았습니다. 실행: leerness referee verify ${id}`);
    return;
  }

  if (sub === 'list') {
    const rows = list.map(r => ({ id: r.id, check: r.check, calibrated: isCalibrated(r), stale: isStale(r), at: r.calibration && r.calibration.at }));
    if (json) { log(JSON.stringify({ ok: true, version: VERSION, total: rows.length, calibrated: rows.filter(x => x.calibrated).length, referees: rows, corruptStore: chk.invalid || undefined }, null, 2)); return; }
    log(`# leerness referee — 검증기 캘리브레이션 (${rows.length}건)`);
    if (chk.invalid) warn('  ⚠ referees.json 형상 무효 — 목록을 신뢰하지 마세요');
    if (!rows.length) { log('  (없음) — leerness referee add <id> --check "..." --good "..." --bad "..." --expect-bad "..."'); return; }
    for (const r of rows) log(`  ${r.calibrated ? '✅' : (r.stale ? '⚠' : '⏳')} ${r.id}  [${r.calibrated ? 'calibrated' : (r.stale ? 'stale' : 'uncalibrated')}]  ${r.check}`);
    const un = rows.filter(x => !x.calibrated).length;
    if (un) warn(`  미검증 ${un}건 — 탐지력이 증명되지 않은 검증기의 통과는 증거가 아닙니다`);
    return;
  }

  const id = (rest || [])[0];
  const r = list.find(x => x.id === id);
  if (['verify', 'show', 'drop'].includes(sub)) {
    if (!id) { failJson(json, 'id_required', `referee ${sub} <id> 필요`); return; }
    if (!r) { failJson(json, 'not_found', `referee 없음: ${id}`); return; }
  }

  if (sub === 'show') {
    if (json) { log(JSON.stringify({ ok: true, ...r, calibrated: isCalibrated(r), stale: isStale(r) }, null, 2)); return; }
    log(`# referee ${r.id}  [${isCalibrated(r) ? 'calibrated' : (isStale(r) ? 'stale' : 'uncalibrated')}]`);
    log(`  검증 명령 : ${r.check}`);
    log(`  known-good: ${r.good}`);
    log(`  known-bad : ${r.bad}`);
    if (r.expectBad) log(`  기대 실패 신호: ${r.expectBad}`);
    if (r.calibration) {
      log(`  마지막 캘리브레이션: ${r.calibration.at} — ${r.calibration.ok ? 'OK' : '실패'} (good exit ${r.calibration.goodExit} · bad exit ${r.calibration.badExit}${r.calibration.expectMatched === null ? '' : ` · 사유일치 ${r.calibration.expectMatched}`})`);
      (r.calibration.reasons || []).forEach(x => log(`    - ${x}`));
    }
    return;
  }

  if (sub === 'drop') {
    const next = list.filter(x => x.id !== id);
    if (!_save(root, next, json)) return;
    if (json) { log(JSON.stringify({ ok: true, dropped: id }, null, 2)); return; }
    ok(`referee 제거: ${id}`);
    return;
  }

  if (sub === 'verify') {
    const timeoutMs = Number(arg ? arg('--timeout', '') : '') * 1000;
     
    const cal = calibrate(root, r, { timeoutMs: timeoutMs > 0 ? timeoutMs : undefined });
    const _commit = () => {
      const cur = _loadChecked(root);
      if (cur.invalid) { failJson(json, 'store_invalid', `referees.json 형상 무효 — 캘리브레이션 결과 저장 거부: ${_refereesPath(root)}`); return false; }
      const target = cur.list.find(x => x.id === r.id);
      if (!target) { failJson(json, 'not_found', `referee 없음(캘리브레이션 중 삭제됨): ${r.id}`); return false; }
      if (_fingerprint(target) !== cal.fingerprint) { failJson(json, 'referee_changed', `캘리브레이션 도중 ${r.id} 정의가 변경됨 — 결과를 버립니다(재실행: leerness referee verify ${r.id})`); return false; }
      target.calibration = cal;
      return _save(root, cur.list, json);
    };
    const _committed = (typeof _withLock === 'function') ? _withLock(_refereesPath(root), _commit) : _commit();
    if (!_committed) return;
    r.calibration = cal;
    if (json) { log(JSON.stringify({ ok: cal.ok, id: r.id, calibrated: cal.ok, ...cal }, null, 2)); if (!cal.ok) process.exitCode = 1; return; }
    if (cal.ok) {
       
   
   
  ok(`referee ${r.id} 캘리브레이션 통과 — known-good 통과 · known-bad 를 기대 사유로 거부 (good exit 0 · bad exit ${cal.badExit}${r.expectBad ? ' · 사유 일치' : ''})`);
  log(`  ⓘ 이 결과는 **등록한 good/bad 쌍**에 대한 것입니다 — good/bad 가 check 와 같은 검증 절차를 서로 다른 상태에 대해 실행할 때만 check 의 탐지력을 뜻합니다.`);
      log(`  → 이제 verify-claim --referee ${r.id} / gate --require-referee ${r.id} 가 이 검증기를 신뢰합니다.`);
      log(`  ⓘ 명령이나 기대 신호를 바꾸면 캘리브레이션은 자동 무효(stale) 가 됩니다.`);
    } else {
      warn(`referee ${r.id} 캘리브레이션 실패 — 이 검증기의 통과는 증거로 쓸 수 없습니다`);
      cal.reasons.forEach(x => log(`  - ${x}`));
      if (cal.badSample) log(`  known-bad 출력(발췌): ${cal.badSample.split('\n').slice(0, 4).join(' / ')}`);
      process.exitCode = 1;
    }
    return;
  }

  failJson(json, 'unknown_subcommand', `알 수 없는 referee 하위명령: ${sub} (가능: add, list, show, verify, drop)`);
}

 
function requireReferee(root, id) {
   
  const chk = _loadChecked(root);
  if (chk.invalid) return { ok: false, code: 'referee_store_invalid', message: `referees.json 형상 무효 — 검증기를 신뢰할 수 없음: ${_refereesPath(root)} (수동 복구 후 leerness referee verify)` };
  const r = chk.list.find(x => x.id === id);
  if (!r) return { ok: false, code: 'referee_not_found', message: `referee 없음: ${id} (leerness referee add ${id} ...)` };
   
   
  if (!r.calibration) return { ok: false, code: 'referee_uncalibrated', message: `referee ${id} 아직 캘리브레이션되지 않음 — 탐지력 미증명: leerness referee verify ${id}` };
   
   
  if (r.calibration.ok !== true) return { ok: false, code: 'referee_uncalibrated', message: `referee ${id} 캘리브레이션 실패 상태 — 탐지력 미증명: ${(r.calibration.reasons || [])[0] || ''}` };
  if (isStale(r)) return { ok: false, code: 'referee_stale', message: `referee ${id} 캘리브레이션 무효 — 명령/기대치가 바뀌어 기존 증명은 더 이상 적용되지 않음: leerness referee verify ${id}` };
  return { ok: true, referee: r };
}

module.exports = { refereeCmd, loadReferees, requireReferee, isCalibrated, isStale, calibrate, _refereesPath, _loadChecked };
