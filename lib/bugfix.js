// lib/bugfix.js — bugfix 완료 영수증 (1.36.87, P-0005 · codex+자체 이중검토 통과분만 구현).
//
// 문제(사용자 제기 + 실사용 프로젝트 실측): 버그 수정을 요청하면 증상만 고치고 "고쳤다"고 판정한다.
//   읽기 전용으로 스캔한 실사용 저장소에서: 주문 상태 오판정이 플랫폼을 갈아가며 8회 반복,
//   한 파일이 22회 수정, 그 프로젝트 lessons 11건은 전부 개별 API 특이사항이고 **클래스 교훈은 0건**.
//
// 검토에서 **기각된 것**(만들지 않는다):
//   · 재오픈 ID 경고 — 실측 정밀도 19%(후속 커밋 37건 중 문서 14·확장 4·되돌림 1). 80% 오탐이라 차단 불가.
//   · 파일 hotspot 경고 — 원래 자주 바뀌는 파일(라우팅·registry·lock)과 구분 불가. dirty worktree 에서
//     "이번 버그가 손댈 파일"을 추론하면 즉시 오염된다.
//   · 형제 분기 자동 제시 — **구문 분기 ≠ 도메인 형제**. 같은 파일 안에서도 플랫폼마다 수집 단위·조기반환이
//     다르고, 공통 규칙은 분기 뒤에 다시 적용된다. 어떤 invariant 를 고치느냐에 따라 형제 범위가 달라지므로
//     기계가 발명할 수 없다. 0-deps 로 TS 의미구조를 얻으려면 자체 파서가 필요하고 정규식은 과다/과소 포함된다.
//
// 채택한 유일한 개입: **`--status done` 전이**. leerness 는 이미 debug 렌즈와 review-request 로 올바른 절차를
//   안내하지만 그건 조언 텍스트일 뿐 완료 시점에 소비되지 않는다. 조언을 더 만드는 것이야말로 증상 처방이다.
//
// 정직성 계약: 여기서 **기계적으로 검증되는 것은 probe 뿐**이다(수정 전 2회 연속 실패 → 수정 후 통과).
//   근본원인·형제범위는 **선언**이며 leerness 는 그 내용의 진위를 판정하지 않는다. 출력에 그대로 표시한다.
//
// 신뢰 경계(명시): 스토어(.harness/bugfix-receipts.json)는 **프로젝트가 신뢰하는 설정 파일**이고,
//   등록된 probe 명령은 done 전이에서 셸로 실행된다. 저장소에 쓰기 권한이 있는 주체는 이 게이트를
//   우회할 수 있다 — 이 기능은 "성실한 작업자의 성급한 완료"를 막지, 적대적 우회를 막지 않는다.
//   그래서 등록 시 실행 사실을 고지하고(⚠), 형상 무효 스토어는 완료를 보류한다.
'use strict';
const cp = require('child_process');
const path = require('path');
const { absRoot, exists, read, writeUtf8, mkdirp, log, ok, warn, failJson, now } = require('./io');

function _storePath(root) { return path.join(absRoot(root), '.harness', 'bugfix-receipts.json'); }

const _ID_RE = /^[A-Z]+-\d{3,}$/;

// 1.36.87 (codex 26차 #5/#7): baseline 을 **필수**로 만든다. 종전엔 baseline 없는/실패하지 않은 엔트리가
//   유효로 통과해, (1) 완료 렌더에서 TypeError 로 `task update` 가 통째로 죽고(실측),
//   (2) 손으로 써 넣은 "재현된 적 없는" probe 가 게이트를 통과했다.
//   등록 경로(_start)는 실패한 baseline 만 저장하므로, 그 형상을 스토어 계약으로 못 박는다.
function _entryValid(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  if (typeof e.id !== 'string' || !_ID_RE.test(e.id)) return false;
  if (typeof e.repro !== 'string' || !e.repro.trim()) return false;
  if (typeof e.expectBad !== 'string' || !e.expectBad.trim()) return false;
  const b = e.baseline;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return false;
  if (b.failed !== true) return false;                       // 재현되지 않은 probe 는 등록될 수 없다
  if (typeof b.exit !== 'number') return false;
  if (e.siblingScope != null && (typeof e.siblingScope !== 'object' || Array.isArray(e.siblingScope))) return false;
  if (e.siblingScope && e.siblingScope.checked != null && !Array.isArray(e.siblingScope.checked)) return false;
  if (e.rootCause != null && typeof e.rootCause !== 'string') return false;
  return true;
}

// 형제범위가 "기록됨"인지의 **단일 술어** — 목록·게이트가 갈라지면 사용자가 통과할 줄 알았다가 막힌다.
//   빈 배열은 기록이 아니다(`--siblings ","` 가 checked:[] 를 만들던 공허 영수증).
function _siblingScopeOk(sc) {
  if (!sc || typeof sc !== 'object') return false;
  if (Array.isArray(sc.checked) && sc.checked.length > 0) return true;
  return typeof sc.notApplicable === 'string' && !!sc.notApplicable.trim();
}

// 손상/형상무효 스토어는 빈 목록으로 오인하지 않는다(referee/previews 와 동일 규율).
function _loadChecked(root) {
  const f = _storePath(root);
  if (!exists(f)) return { list: [], invalid: false };
  try {
    const j = JSON.parse(read(f));
    if (!Array.isArray(j) || j.some(e => !_entryValid(e))) return { list: [], invalid: true };
    return { list: j, invalid: false };
  } catch { return { list: [], invalid: true }; }
}
// 1.36.87 (codex 26차 #6): 종전엔 읽은 목록 전체를 그대로 덮어써서, 두 등록이 겹치면 나중 쓰기가
//   앞의 등록을 지웠다 — 지워진 task 는 "미등록"이 되어 게이트가 **조용히 꺼진다**(fail-open).
//   쓰기 직전 재로드 후 id 기준 병합하고, 임시파일 rename 으로 부분 기록도 막는다.
//   락은 호출부에서 주입한다(rules/decisions/teams/referee 와 동일 규율) — 재로드+병합만으로는 부족했다:
//   4개 동시 등록 실측에서 2건이 사라졌다.
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
    const cur = _loadChecked(root);   // 락 안에서 재로드 — 밖에서 읽은 목록은 이미 낡았을 수 있다
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
    // 1.36.88 (출하전 헌트 #4/#10): ENOBUFS 는 "명령이 실행되지 못한 것"이 아니라 **출력이 한도를 넘어
    //   잘린 것**이다. 종전엔 launcher 실패로 분류해, 수정을 마쳐 통과하는 probe 를 "실행 실패"라는
    //   사실과 다른 사유로 차단했다. 판정 불가는 판정 불가라고 말해야 한다.
    overflow: code === 'ENOBUFS',
    spawnError: (code && code !== 'ENOBUFS') ? code : null,
    timedOut: !!(r.error && String(r.error.code) === 'ETIMEDOUT'),
    output: out,
    sample: out.slice(0, 4000),
    ms: Date.now() - t0,
  };
}

// referee 와 같은 규율: 명령 자체가 실행되지 못한 것은 "버그 재현"이 아니다.
//   **하드 신호만** 본다(spawn 실패 · 127 · 9009). 출력 문자열은 보지 않는다 — 아래 _toolErrorHint 참조.
function _launcherFailure(r) {
  if (!r) return null;
  if (r.spawnError) return `실행 실패(${r.spawnError})`;
  if (r.status === 127 || r.status === 9009) return `명령을 찾을 수 없음(exit ${r.status})`;
  return null;
}

// 출력 문자열 기반 추정 — **등록 시점의 비차단 경고로만** 쓴다.
//   1.36.87 실측: 종전에는 출력에 `SyntaxError:` 가 있으면 런처 오류로 단정했다. 그런데 수정을 끝내
//   exit 0 인 probe 라도 앱이 그 문자열을 정상 출력하면(예: 11번가가 JSON 대신 HTML 을 주는 케이스의
//   재현 로그) `probe_unrunnable` 로 **완료가 막혔다** — 이 기능을 만들게 한 바로 그 도메인에서의 오차단.
//   게이트 휴리스틱은 false-PASS 로 기울여야지 false-BLOCK 으로 기울면 안 된다.
function _toolErrorHint(r) {
  if (!r || r.status === 0) return null;
  if (/(?:command not found|not recognized as an internal or external command|cannot find module)/i.test(r.output || '')) {
    return '출력이 도구/경로 오류처럼 보입니다 — 버그 재현이 아닐 수 있으니 probe 를 확인하세요';
  }
  return null;
}

// `leerness bugfix start <ID> --repro "<cmd>" --expect-bad "<신호>"`
//   수정 **전에** 실행한다. 지금 실패해야 하고, 기대 신호가 출력에 있어야 한다.
//   이 두 조건이 probe 의 탐지력이다 — 통과해버리는 probe 는 나중에 무엇도 증명하지 못한다.
function _start(root, id, deps) {
  const { arg, has } = deps;
  const json = !!(has && has('--json'));
  const repro = (arg ? arg('--repro', '') : '') || '';
  const expectBad = (arg ? arg('--expect-bad', '') : '') || '';
  if (!_ID_RE.test(String(id || ''))) { failJson(json, 'invalid_id', `task id 형식이 아님: ${JSON.stringify(id)} (예: T-0007)`); return; }
  // 1.36.88 (출하전 헌트 #3/#19): 존재하지 않는 id 로도 등록에 성공해, 오타 하나면 "보호받는다고 믿는데
  //   실제로는 아무것도 막지 않는" 상태가 됐다. 등록 시점에 tracker 에 있는지 확인한다.
  if (typeof deps._taskExists === 'function' && !deps._taskExists(root, String(id))) {
    failJson(json, 'task_not_found', `progress-tracker 에 없는 task: ${id} — 먼저 leerness task add "<제목>" (오타면 leerness task list 로 확인)`);
    return;
  }
  if (!repro.trim()) { failJson(json, 'missing_repro', '--repro "<버그를 재현하는 명령>" 필요 — 지금 실패해야 합니다'); return; }
  if (!expectBad.trim()) { failJson(json, 'missing_expect', '--expect-bad "<기대 실패 신호>" 필요 — 없으면 무관한 실패와 진짜 재현을 구분할 수 없습니다'); return; }

  const chk = _loadChecked(root);
  if (chk.invalid) { failJson(json, 'store_invalid', `bugfix-receipts.json 형상 무효 — 덮어쓰기 거부: ${_storePath(root)}`); return; }

  const r = _run(repro, absRoot(root));
  const lf = _launcherFailure(r);
  const matched = r.output.includes(expectBad);
  const reasons = [];
  if (r.overflow) reasons.push('probe 출력이 한도(8MB)를 넘어 재현 여부를 판정할 수 없습니다 — 출력을 줄이거나 파일로 보내세요');
  if (lf) reasons.push(`${lf} — 심어둔 버그가 아니라 명령이 실행되지 못했습니다`);
  else if (r.status === 0) reasons.push('probe 가 지금 **통과**합니다(exit 0) — 버그가 재현되지 않으면 수정 후 통과는 아무것도 증명하지 못합니다');
  if (!lf && !matched) reasons.push(`출력에 기대 신호 "${expectBad}" 없음 — 무관한 실패일 수 있습니다`);
  // 1.36.87 (codex 26차 #3): **두 번** 돌려 둘 다 실패해야 한다. 한 번만 보면 상태를 남기는 probe —
  //   예: `if(!exists(marker)){write(marker); exit 1}` — 가 등록 때만 실패하고 이후 항상 통과해,
  //   제품 코드를 한 줄도 고치지 않고 완료 게이트를 통과시킨다(1회성 probe = 탐지력 0).
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
  const hint = _toolErrorHint(r);   // 비차단 — 등록은 진행하되 사용자에게 알린다
  _upsert(root, entry, deps);
  // 1.36.87 (codex 26차 #1): 게이트는 기본 OFF 다. 토글 상태를 보지 않고 "done 때 통과해야 합니다"라고
  //   쓰면, 실제로는 아무것도 강제되지 않는데 강제된다고 **약속하는 문구**가 된다.
  const gateOn = require('./toggles').toggleOn(root, 'bugfix-receipt');
  if (json) { log(JSON.stringify({ ok: true, id: entry.id, baseline: entry.baseline, gateEnabled: gateOn, hint: hint || undefined }, null, 2)); return; }
  ok(`bugfix probe 등록: ${entry.id} — 지금 재현됨(2회 연속 exit ${r.status} · 신호 일치)`);
  if (hint) warn(`  ${hint}`);
  log(`  ⚠ 이 명령은 앞으로 \`--status done\` 시 자동 실행됩니다 — 저장 위치: ${_storePath(root)}`);
  if (gateOn) log(`  → 수정 후 \`leerness task update ${entry.id} --status done\` 시 같은 probe 가 통과해야 합니다.`);
  else warn(`  이 프로젝트에서 완료 게이트는 **꺼져 있습니다** — 지금은 기록만 되고 done 은 막히지 않습니다.\n     켜기: leerness toggle set bugfix-receipt on`);
  log(`  → 근본원인/형제범위 기록: leerness bugfix receipt ${entry.id} --root-cause "..." --siblings "..."`);
}

// `leerness bugfix receipt <ID> --root-cause "..." [--siblings "..." | --siblings-na "사유"] [--previous-gap "..."]`
//   **선언**이다. leerness 는 내용의 진위를 판정하지 않는다 — 존재와 문구만 기록한다.
function _receipt(root, id, deps) {
  const { arg, has } = deps;
  const json = !!(has && has('--json'));
  const chk = _loadChecked(root);
  if (chk.invalid) { failJson(json, 'store_invalid', `bugfix-receipts.json 형상 무효 — 덮어쓰기 거부: ${_storePath(root)}`); return; }
  const e = chk.list.find(x => x.id === String(id));
  if (!e) { failJson(json, 'probe_not_found', `bugfix probe 없음: ${id} — 먼저 leerness bugfix start ${id} --repro "..." --expect-bad "..."`); return; }
  const rc = (arg ? arg('--root-cause', '') : '') || '';
  const sib = (arg ? arg('--siblings', '') : '') || '';
  const sibNa = (arg ? arg('--siblings-na', '') : '') || '';
  const gap = (arg ? arg('--previous-gap', '') : '') || '';
  if (rc.trim()) e.rootCause = rc.trim();
  // 1.36.87 실측: `--siblings ","` 는 checked=[] 를 만들면서 "형제범위 기록됨"으로 통과했다(공허 영수증).
  //   빈 목록은 기록이 아니다 — 거부한다.
  const parsed = sib.trim() ? sib.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (sib.trim() && !parsed.length) { failJson(json, 'empty_siblings', `--siblings 값에 항목이 없습니다: ${JSON.stringify(sib)} — 쉼표로 구분된 형제 지점을 적거나, 없으면 --siblings-na "<사유>"`); return; }
  if (parsed.length) e.siblingScope = { checked: parsed };
  else if (sibNa.trim()) e.siblingScope = { notApplicable: sibNa.trim() };
  if (gap.trim()) e.previousGuardGap = gap.trim();
  _upsert(root, e, deps);
  if (json) { log(JSON.stringify({ ok: true, id: e.id, rootCause: e.rootCause, siblingScope: e.siblingScope, previousGuardGap: e.previousGuardGap }, null, 2)); return; }
  ok(`bugfix 영수증 갱신: ${e.id}`);
  log(`  ⓘ 근본원인·형제범위는 **선언**입니다 — leerness 는 내용의 진위를 판정하지 않습니다(검증되는 것은 probe 뿐).`);
}

// `--status done` 전이에서 호출. 토글 OFF 이거나 probe 미등록이면 **아무 영향 없음**(기존 동작 보존).
//   반환: { blocked, code, message, lines } — 호출부가 렌더/exit 를 결정한다.
function checkDoneTransition(root, id) {
  const chk = _loadChecked(root);
  if (chk.invalid) {
    return { blocked: true, code: 'store_invalid', message: `bugfix-receipts.json 형상 무효 — 완료 판정을 보류합니다: ${_storePath(root)}` };
  }
  const e = chk.list.find(x => x.id === String(id));
  if (!e) return { blocked: false };   // bugfix 로 선언되지 않은 task 는 무영향
  const r = _run(e.repro, absRoot(root));
  const lf = _launcherFailure(r);
  const lines = [];
  if (lf) return { blocked: true, code: 'probe_unrunnable', message: `재현 probe 를 실행할 수 없습니다 — ${lf}: ${e.repro}` };
  // 출력 초과는 실행 실패가 아니다 — 통과/실패를 **알 수 없는** 상태이므로 그대로 말하고 보류한다(사실과 다른 사유 금지).
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
  // baseline 은 _entryValid 가 요구하지만, 렌더는 방어적으로 — 종전엔 여기서 TypeError 로 task update 가 통째로 죽었다(실측).
  const wasExit = (e.baseline && e.baseline.exit != null) ? `수정 전 exit ${e.baseline.exit} → ` : '';
  lines.push(`✓ 재현 probe 통과(${wasExit}지금 exit 0): ${e.repro}`);
  // 1.36.87 (codex 26차 #2): exit 0 인데 등록 당시의 실패 신호가 출력에 그대로 있으면 "증상만 덮은" 신호다.
  //   다만 **막지는 않는다** — 신호가 성공 메시지에 정상 등장할 수 있고, 여기서 잘못 막으면 이미 고쳐진
  //   probe 를 재등록할 방법이 없어(등록은 실패를 요구) 사용자가 빠져나올 수 없다. 경고로 노출한다.
  if (e.expectBad && r.output.includes(e.expectBad)) {
    lines.push(`⚠ exit 는 0 이지만 등록 당시 실패 신호 "${e.expectBad}" 가 출력에 아직 있습니다 — probe 가 정말 그 버그를 보고 있는지 확인하세요.`);
  }
  lines.push(`ⓘ 아래는 **선언**이며 내용의 진위는 검증하지 않았습니다:`);
  lines.push(`   근본원인: ${e.rootCause}`);
  lines.push(`   형제범위: ${e.siblingScope.notApplicable ? 'not-applicable — ' + e.siblingScope.notApplicable : (e.siblingScope.checked || []).join(', ')}`);
  if (e.previousGuardGap) lines.push(`   이전 검증이 놓친 이유: ${e.previousGuardGap}`);
  return { blocked: false, lines };
}

// 1.36.88 (출하전 헌트 #1/#17): 게이트를 호출부마다 배선하면 반드시 빠뜨린다 — 실측으로
//   `task sync --from`(TodoWrite 왕복, 하네스가 직접 지시하는 정규 경로)이 게이트를 통째로 우회했다.
//   그래서 판정은 progress 행을 쓰는 **단일 병목**에서 하고, 막힐 때는 조용히 무시할 수 없도록 던진다.
//   (반환값 무시로 인한 무언 통과가 이 클래스의 재발 양식이다.)
class BugfixBlocked extends Error {
  constructor(res, id) {
    super((res && res.message) || 'bugfix 완료 게이트에 의해 보류');
    this.name = 'BugfixBlocked';
    this.taskId = String(id);
    this.code = (res && res.code) || 'blocked';
    this.lines = (res && res.lines) || [];
  }
}

function bugfixCmd(root, sub, rest, deps = {}) {
  const { has } = deps;
  root = absRoot(root);
  const json = !!(has && has('--json'));
  if (!exists(path.join(root, '.harness'))) { failJson(json, 'harness_missing', `leerness 미설치: ${root} — 먼저 leerness init`); return; }
  const id = (rest || [])[0];
  if (sub === 'start') return _start(root, id, deps);
  if (sub === 'receipt') return _receipt(root, id, deps);
  // 1.36.87 (codex 26차 #9): 등록을 되돌릴 길이 필요하다 — probe 스크립트가 사라졌거나 계약이 바뀌면
  //   done 이 영구히 막히고(등록은 "지금 실패"를 요구하므로 재등록도 불가) 스토어도 무한히 자란다.
  if (sub === 'drop') {
    const chk = _loadChecked(root);
    if (chk.invalid) { failJson(json, 'store_invalid', `bugfix-receipts.json 형상 무효 — 수정 거부: ${_storePath(root)}`); return; }
    const left = _remove(root, id, deps);
    if (left === null) { failJson(json, 'probe_not_found', `bugfix probe 없음: ${id}`); return; }
    if (json) { log(JSON.stringify({ ok: true, id: String(id), remaining: left.length }, null, 2)); return; }
    ok(`bugfix probe 삭제: ${id} (남은 ${left.length}건) — 이 task 는 다시 완료 게이트 무영향이 됩니다`);
    return;
  }
  if (sub === 'list' || !sub) {
    const chk = _loadChecked(root);
    if (json) { log(JSON.stringify({ ok: !chk.invalid, invalid: chk.invalid, receipts: chk.list.map(e => ({ id: e.id, repro: e.repro, baselineFailed: !!(e.baseline && e.baseline.failed), rootCause: e.rootCause, siblingScope: e.siblingScope })) }, null, 2)); return; }
    if (chk.invalid) { warn(`bugfix-receipts.json 형상 무효: ${_storePath(root)}`); return; }
    if (!chk.list.length) { log('등록된 bugfix probe 없음 — leerness bugfix start <T-ID> --repro "..." --expect-bad "..."'); return; }
    // 1.36.88 (출하전 헌트 #12): 목록과 게이트가 **같은 술어**를 써야 한다 — 빈 checked 를 목록은 "기록됨",
    //   게이트는 "영수증 미완"으로 판정해, 사용자가 목록을 보고 통과할 줄 알았다가 막혔다.
    chk.list.forEach(e => log(`  ${e.id}  probe=${e.repro.slice(0, 50)}  근본원인=${e.rootCause ? '기록됨' : '미기록'}  형제범위=${_siblingScopeOk(e.siblingScope) ? '기록됨' : '미기록'}`));
    return;
  }
  failJson(json, 'unknown_subcommand', `알 수 없는 bugfix 하위명령: ${sub} (가능: start, receipt, drop, list)`);
}

// _siblingScopeOk 공개(1.36.90): 대시보드가 **같은 술어**를 쓴다 — 표면마다 다시 구현하면
//   "목록은 기록됨, 게이트는 미완" 같은 불일치가 되살아난다(1.36.88 #12 에서 이미 한 번 겪었다).
module.exports = { bugfixCmd, checkDoneTransition, BugfixBlocked, _storePath, _loadChecked, _siblingScopeOk };
