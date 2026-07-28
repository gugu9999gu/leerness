// lib/referee.js — 검증기 캘리브레이션 (1.36.80, P-0001 · 외부 사례 검토 채택).
//   문제: leerness 의 모든 검사(verify-claim/gate/contract)는 "정적·텍스트 대리 지표"였다 — 검증기 자신이
//   실패를 잡을 수 있는지는 아무도 증명하지 않았다. 초록 스위트가 실제로는 아무것도 검사하지 않는 경우를 못 걸렀다.
//   해법(anthropics/code-migration-kit 의 judge-setup 원리): 검증기를 신뢰하기 전에 **실행으로 확인**한다 —
//   (1.36.82 정직화) 확인하는 것은 "등록된 known-good/known-bad 쌍이 기대한 사유로 갈린다"는 것과 check 의 기동 가능성이다.
//   good/bad 가 check 와 동일한 검증 절차를 서로 다른 상태에 대해 실행하는지는 **도구가 강제할 수 없다** — 사용자의 등록 책임이다.
//   ① known-good 을 통과시키고 ② 일부러 망가뜨린 known-bad 를 거부하며 ③ 거부 사유가 심어둔 결함과 일치해야 하고
//   ④ 명령/기대치가 바뀌면 캘리브레이션은 무효(stale)가 된다. 무관한 이유의 실패(환경 오류 등)는 탐지력이 아니다.
//   0-deps · 오프라인 · 기존 스토어 규율(손상 fail-closed · 형상 무효 거부 · --json 순수) 준수.
'use strict';
const cp = require('child_process');
const crypto = require('crypto');
const path = require('path');
const { absRoot, exists, read, writeUtf8, log, ok, warn, failJson, now } = require('./io');

function _refereesPath(root) { return path.join(absRoot(root), '.harness', 'referees.json'); }

// 형상 무효(파싱은 되나 배열/항목이 아님)는 []로 오인하지 않는다 — 변경 진입점은 거부(previews/teams 와 동일 규율)
// (검수 #7) 형상 검증이 얕아 `[{"id":"x"}]` 같은 반쪽 항목 위에서 add 가 그대로 변형했다 —
//   필수 필드(check/good/bad 비어있지 않은 문자열)·id 형식·calibration 구조까지 확인한다.
const _ID_RE = /^[a-z0-9][a-z0-9._-]{0,48}$/;
function _entryValid(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  if (typeof e.id !== 'string' || !_ID_RE.test(e.id)) return false;
  for (const k of ['check', 'good', 'bad']) if (typeof e[k] !== 'string' || !e[k].trim()) return false;
  if (e.expectBad != null && typeof e.expectBad !== 'string') return false;
  if (e.calibration != null) {
    const c = e.calibration;
    if (typeof c !== 'object' || Array.isArray(c)) return false;
    // 1.36.81 (codex 검수 ① High, 실측 확인): ok 가 boolean 이 아니면 거부한다.
    //   `"ok": "false"` / `1` 같은 truthy 비-boolean 이 저장되면 `!r.calibration.ok` 가 false 가 되어
    //   **미증명 검증기가 게이트를 통과**했다(show 도 calibrated:true 로 표시). fail-closed 기능의 fail-open.
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

// 캘리브레이션 지문 — check/good/bad/expectBad 중 하나라도 바뀌면 기존 증명은 무효
function _fingerprint(r) {
  return crypto.createHash('sha256').update([r.check || '', r.good || '', r.bad || '', r.expectBad || ''].join('\u0000')).digest('hex').slice(0, 16);
}
// 1.36.81 (클린룸 실측): stale 은 "한때 증명됐으나 정의가 바뀌어 무효"만을 뜻한다.
//   한 번도 캘리브레이션한 적 없는 검증기까지 stale 로 묶으면 uncalibrated 분기가 도달 불가가 되고,
//   사용자에게 "무효화됐다"(있었던 증명이 깨짐)와 "아직 증명 안 됨"을 구분해 주지 못한다 —
//   정직한 신호가 존재 이유인 기능에서 신호 자체가 부정확했다.
function isStale(r) { return !!r.calibration && r.calibration.ok === true && r.calibration.fingerprint !== _fingerprint(r); }
// ok === true 엄격 비교 — 형상검증(_entryValid)과 이중 방어. 판정 지점에서 truthy 를 신뢰하지 않는다.
function isCalibrated(r) { return !!(r.calibration && r.calibration.ok === true && !isStale(r)); }

function _run(cmd, cwd, timeoutMs) {
  const t0 = Date.now();
  const r = cp.spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  const out = ((r.stdout || '') + '\n' + (r.stderr || '')).trim();
  return {
    status: (r.status == null ? (r.error ? -1 : 1) : r.status),
    timedOut: !!(r.error && /ETIMEDOUT|timed? ?out/i.test(String(r.error.message || r.error.code || ''))),
    spawnError: r.error ? String(r.error.code || r.error.message) : null,
    // (검수 #6) 신호 매칭은 **전체 출력**으로 — 8000자 절단본으로 매칭해 9000자 뒤 신호를 놓치고 거짓 실패했다.
    //   절단본은 저장/표시용으로만 쓴다.
    output: out,
    sample: out.slice(0, 8000),
    ms: Date.now() - t0,
  };
}

// (검수 #2) "무관한 실패"를 탐지력으로 오인하지 않기 위한 런처/셸 수준 실패 판별 —
//   명령 자체가 실행되지 못한 것(없는 바이너리·문법 오류)은 검증기가 결함을 잡은 것이 아니다.
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

// 캘리브레이션 판정 — "왜 실패했는지"까지 본다(무관한 실패는 탐지력 아님)
function calibrate(root, r, opts = {}) {
  const cwd = absRoot(root);
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs) || 600000);
  const good = _run(r.good, cwd, timeoutMs);
  const bad = _run(r.bad, cwd, timeoutMs);
  // (검수 #2) check 가 캘리브레이션과 전혀 연결되지 않아, good/bad 만으로 통과하면 실제 검증 명령의 탐지력은 미증명이었다.
  //   현재 상태에서 check 자체가 정상 동작(기동 가능)하는지도 확인해 둘을 연결한다.
  const chk = _run(r.check, cwd, timeoutMs);
  const reasons = [];
  const _gl = _launcherFailure(good), _bl = _launcherFailure(bad), _cl = _launcherFailure(chk);
  if (_gl) reasons.push(`known-good ${_gl} — 명령/도구 확인`);
  else if (good.status !== 0) reasons.push(`known-good 이 이미 실패(exit ${good.status}) — 기준선이 빨간 상태로는 탐지력을 증명할 수 없음`);
  if (_bl) reasons.push(`known-bad ${_bl} — 심어둔 결함이 아니라 명령 자체가 실행되지 못했습니다`);
  else if (bad.status === 0) reasons.push(`known-bad 를 통과시킴(exit 0) — 검증기가 심어둔 결함을 못 잡음(탐지력 없음)`);
  if (_cl) reasons.push(`check(${r.check}) ${_cl} — 실제 검증 명령이 기동되지 않음`);
  // (검수 #2) 사유 신호는 이제 **필수** — 없으면 "무관한 실패"와 "탐지"를 구분할 수 없다.
  let matched = null;
  if (!r.expectBad || !String(r.expectBad).trim()) {
    reasons.push('--expect-bad 필요 — 기대 실패 신호가 없으면 무관한 실패와 진짜 탐지를 구분할 수 없습니다');
  } else {
    matched = bad.output.includes(r.expectBad);   // 전체 출력 기준(검수 #6)
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


// `leerness referee add|verify|list|show|drop [--json]`
function refereeCmd(root, sub, rest, deps = {}) {
  const { has, arg, VERSION, _withLock } = deps;
  root = absRoot(root);
  const json = !!(has && has('--json'));
  if (!exists(path.join(root, '.harness'))) { failJson(json, 'harness_missing', `leerness 미설치: ${root} — 먼저 leerness init`); return; }
  sub = sub || 'list';
  // (검수 #3) verify 는 락 안에서 돌리면 안 된다 — 캘리브레이션은 최대 600s 인데 락 대기는 10s·stale 판정 30s 라
  //   살아있는 락이 삭제되고 last-writer-wins 로 다른 캘리브레이션을 날린다. 실행은 락 밖, 저장만 락 안 CAS.
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
    // (검수 #2) --expect-bad 는 이제 필수 — 없으면 "무관한 실패"와 "진짜 탐지"를 구분할 수 없다.
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
    // 실행은 락 밖에서(오래 걸림) → 저장만 락 안에서 재로드+CAS. 대기 중 정의가 바뀌었으면 결과를 버린다(지문 불일치).
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
      // 1.36.82 (검수 High#5): "탐지력 증명됨" 은 실제보다 강한 주장이었다 — 캘리브레이션이 증명하는 것은
  //   **등록한 known-good/known-bad 쌍이 기대한 사유로 갈린다**는 것과 check 가 기동 가능하다는 것뿐이다.
  //   good/bad 가 check 와 같은 절차인지는 도구가 강제할 수 없다(사용자가 그렇게 등록해야 한다).
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

// verify-claim / gate 가 쓰는 게이팅 헬퍼 — 캘리브레이션된 검증기만 신뢰한다.
function requireReferee(root, id) {
  // 1.36.81 (codex 검수 ①): 형상 무효 스토어를 빈 목록으로 오인하면 "없음"이라는 틀린 사유를 준다 — 명시 코드로 보고.
  const chk = _loadChecked(root);
  if (chk.invalid) return { ok: false, code: 'referee_store_invalid', message: `referees.json 형상 무효 — 검증기를 신뢰할 수 없음: ${_refereesPath(root)} (수동 복구 후 leerness referee verify)` };
  const r = chk.list.find(x => x.id === id);
  if (!r) return { ok: false, code: 'referee_not_found', message: `referee 없음: ${id} (leerness referee add ${id} ...)` };
  // 1.36.81: 세 상태를 구분해 보고한다 — 미증명 / 증명실패 / 무효화. 어느 쪽이든 fail-closed 는 동일하지만
  //   사용자가 취할 조치가 다르다(캘리브레이션 실행 / 검증기 자체 수정 / 재검증).
  if (!r.calibration) return { ok: false, code: 'referee_uncalibrated', message: `referee ${id} 아직 캘리브레이션되지 않음 — 탐지력 미증명: leerness referee verify ${id}` };
  // (codex 검수 ②, 실측 확인) 실패한 캘리브레이션은 정의가 바뀌어도 stale 이 아니다 —
  //   stale 은 "있던 증명이 무효화됨"인데, 애초에 증명된 적이 없으면 그 서사 자체가 거짓이다.
  if (r.calibration.ok !== true) return { ok: false, code: 'referee_uncalibrated', message: `referee ${id} 캘리브레이션 실패 상태 — 탐지력 미증명: ${(r.calibration.reasons || [])[0] || ''}` };
  if (isStale(r)) return { ok: false, code: 'referee_stale', message: `referee ${id} 캘리브레이션 무효 — 명령/기대치가 바뀌어 기존 증명은 더 이상 적용되지 않음: leerness referee verify ${id}` };
  return { ok: true, referee: r };
}

module.exports = { refereeCmd, loadReferees, requireReferee, isCalibrated, isStale, calibrate, _refereesPath, _loadChecked };
