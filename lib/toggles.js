// lib/toggles.js — 기능 토글 (1.36.30, 사용자 요청): 온톨로지 그래프 뷰의 스위치와 연동되는 기능 on/off 스토어.
//   .harness/toggles.json 에 저장. AI/CLI 는 여기 상태를 읽어 준수한다(gate/lens 스킵, 위임 브리프 생략, 자동 그래프).
//   설계: 기본 전부 ON(파일 없으면 결손 아님). 손상 파일은 SAVE 시 덮어쓰기 거부(1.36.28 _assertStoreParsable 패턴).
'use strict';
const path = require('path');
const { absRoot, exists, read, writeUtf8, mkdirp, log, ok, fail } = require('./io');

// 토글 레지스트리 — id: { ko 설명, 영향 명령 }. 새 토글은 여기에 추가.
const TOGGLE_REGISTRY = {
  'gate': { desc: '완료 게이트 (verify+audit+scan+encoding+lazy 통합 점검)', affects: 'leerness gate' },
  'lens': { desc: '품질 렌즈 자기질문 (완료 선언 전 분야별 점검)', affects: 'leerness lens' },
  'auto-graph': { desc: '온톨로지 그래프(leerness.html) 자동 갱신 (install/session-close)', affects: 'install · session close' },
  'delegation-brief': { desc: '백그라운드 AI 위임 시 leerness 프로토콜 브리프 자동 접두', affects: 'agents dispatch · agents multi' },
  // 1.36.87: **기본 OFF(옵트인)** — 켜면 bugfix 로 선언된 task 는 재현 probe 가 통과해야 done 이 된다.
  //   기존 프로젝트의 `task update --status done` 을 일제히 깨뜨리지 않기 위해 반드시 opt-in 이어야 한다.
  // 1.36.88 (출하전 헌트 #11): 켜기만 하면 뭔가 강제되는 것처럼 읽혔다 — 실제로는 `bugfix start` 로
  //   probe 를 등록한 task 에만 적용된다. 광고 문구가 적용 범위를 말해야 한다.
  'bugfix-receipt': { desc: 'bugfix 완료 게이트 — `leerness bugfix start` 로 probe 를 등록한 task 에 한해, done 시 probe 통과 + 근본원인/형제범위 영수증 요구 (기본 OFF)', affects: 'task update --status done · task sync --from', defaultOff: true },
  // 1.36.89 (P-0007): 켜도 **자동 실행은 없다** — `route --dispatch` 를 허용할 뿐이고, 고위험은 사람 승인이 별도로 필요하다.
  'difficulty-routing': { desc: '작업 난이도별 모델 라우팅 — `leerness agents route` 의 --confirm 허용(제안/열람은 토글과 무관). 고위험은 --approved-by 필수 (기본 OFF)', affects: 'leerness agents route --confirm', defaultOff: true },
  // 1.36.105 (P-0009 B, 사용자 승인): 검증 스캐폴딩 토글 3종. 기본 ON = 현행 무변경.
  //   경계가 이 기능의 전부다 — 이 토글들이 끄는 것은 **AI 에게 또 시키는 지시문(스캐폴딩)** 뿐이고,
  //   도구가 실제로 명령을 실행해 남기는 증거(gate · verify-claim · bugfix probe · scan)는 어떤 조합에서도 그대로다.
  //   leerness 는 "어느 모델에 무엇이 좋다" 를 주장하지 않는다 — 설명문에 모델명/성능 수치를 한 글자도 쓰지 않는다.
  //   사용자가 자기 관측으로 끄는 스위치다. (P-0009 이 모델 자동 인지를 실측 근거로 기각한 이유이기도 하다.)
  'workflow-distribute': { desc: '세션 워크플로의 "분배(sub-agent)" 단계 지시문 — 끄면 단계 안내를 싣지 않는다 (증거 검증에는 영향 없음)', affects: 'handoff · session-workflow 안내' },
  'double-verify': { desc: '완료 전 재확인 지시문(같은 것을 다시 확인하라는 안내) — 끄면 안내만 생략된다 (gate/verify-claim 실행은 그대로)', affects: 'handoff · lens 안내' },
  'full-reread': { desc: '매 세션 관련 문서 전체 재독 지시문 — 끄면 "필요할 때 읽어라" 로 바뀐다 (문서와 상태는 그대로 남는다)', affects: 'handoff 안내' },
};
// P-0009 경계 계약: 토글로 끌 수 있는 것은 '지시문' 뿐이다. 아래 목록은 **어떤 토글 조합에서도** 살아 있어야 하며,
//   변이 테스트가 이 계약을 고정한다(계약이 깨지면 토글을 출하하지 않는다는 것이 승인 조건이었다).
const SCAFFOLD_TOGGLES = ['workflow-distribute', 'double-verify', 'full-reread'];
const EVIDENCE_COMMANDS = ['gate', 'verify-claim', 'scan', 'audit'];

function _togglesPath(root) { return path.join(absRoot(root), '.harness', 'toggles.json'); }

// 전체 토글 상태 로드 — 파일 없으면 기본값(대부분 ON, `defaultOff` 표시된 것은 OFF).
//   1.36.87: 기존 동작을 바꾸는 신규 토글은 반드시 defaultOff 여야 한다 — 안 그러면 업그레이드만으로
//   모든 사용자의 워크플로가 깨진다(기본 ON 은 "새 검사가 조용히 강제됨"을 뜻하므로).
// 값 해석 — 인식 가능한 표현만 받고, 알 수 없는 값은 레지스트리 기본값으로 되돌린다.
//   1.36.87: 종전 규칙은 `v !== false` 였다. 기본 ON 토글에서는 무해했지만(어차피 ON), 기본 OFF 인
//   차단 게이트가 생긴 지금은 `null`/`0`/`"off"` 같은 값이 게이트를 **켜 버린다**(실측 확인).
//   원칙: 알 수 없는 값은 차단을 켜서도, 보호를 꺼서도 안 된다 → 기본값 유지.
function _coerceToggle(v, dflt) {
  if (v === true || v === false) return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'on' || s === 'true' || s === '1') return true;
    if (s === 'off' || s === 'false' || s === '0') return false;
  }
  return dflt;
}

// 1.36.92 (헌트 #5): 손상 파일에서 조용히 기본값으로 돌아가면 **켜 뒀던 차단 게이트가 무경고로 꺼진다**
//   (bugfix-receipt 는 defaultOff 라 손상 = OFF). 사용자는 `toggle list` 에서도 그냥 "OFF" 만 본다.
//   손상 사실을 함께 돌려주고, 호출부가 그걸 사용자에게 알린다. (읽기 경로는 계속 fail-open 이지만 **조용하지 않다**.)
function loadTogglesChecked(root) {
  const out = {};
  for (const [id, meta] of Object.entries(TOGGLE_REGISTRY)) out[id] = !(meta && meta.defaultOff);
  const f = _togglesPath(root);
  if (!exists(f)) return { toggles: out, corrupt: false, unreadable: [] };
  try {
    const j = JSON.parse(read(f));
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { toggles: out, corrupt: true, reason: '최상위가 객체가 아닙니다', unreadable: [] };
    // codex 32차 #1: JSON 은 멀쩡한데 **값을 못 읽는** 경우(`"banana"`)도 저장 의도가 유실된 것이다 —
    //   기본값으로 조용히 되돌리면 켜 뒀던 차단 게이트가 꺼진다. 어떤 키가 그랬는지 함께 돌려준다.
    const unreadable = [];
    for (const [k, v] of Object.entries(j)) {
      if (!(k in out)) continue;
      const coerced = _coerceToggle(v, out[k]);
      if (_coerceToggle(v, true) !== _coerceToggle(v, false)) unreadable.push(k);   // 기본값에 따라 답이 갈리면 = 못 읽은 값
      out[k] = coerced;
    }
    return { toggles: out, corrupt: false, unreadable };
  } catch { return { toggles: out, corrupt: true, reason: 'JSON 파싱 실패', unreadable: [] }; }
}

function loadToggles(root) { return loadTogglesChecked(root).toggles; }

// 단일 토글 조회 헬퍼 — 호출부 한 줄용. defaultOff 토글은 명시적으로 켜야 true.
function toggleOn(root, id) {
  const st = loadToggles(root);
  return id in st ? st[id] === true : true;
}

function saveToggles(root, toggles) {
  const f = _togglesPath(root);
  // 1.36.28 패턴: 손상 파일 덮어쓰기 거부 — 단 토글은 전량 기본값 복원 가능하니 손상 시 재생성 허용이 사용자 친화적.
  // (여기의 데이터는 bool 4개뿐 — 유실 비용이 0 에 가깝고, 거부하면 토글 자체가 잠긴다. 의도적 예외.)
  mkdirp(path.dirname(f));
  writeUtf8(f, JSON.stringify(toggles, null, 2) + '\n');
}

// `leerness toggle [list|set <id> on|off] [--json]`
function toggleCmd(root, sub, id, val, deps = {}) {
  const { has, VERSION } = deps;
  root = absRoot(root);
  // 1.36.108 (T-0097): 변경 하위명령은 읽기~쓰기 전체를 락으로 직렬화한다 — clarify/referee/routing 과 같은 관례.
  //   종전엔 이 모듈만 관례에서 빠져 있어 동시 `toggle set` 이 서로의 값을 덮었다(런타임 계측으로 실측: 락 X).
  //   재진입 플래그(_locked)로 자기 재호출을 한 번만 감싼다.
  if (sub === 'set' && typeof deps._withLock === 'function' && !deps._locked) {
    return deps._withLock(_togglesPath(root), () => toggleCmd(root, sub, id, val, Object.assign({}, deps, { _locked: true })));
  }
  const json = has && has('--json');
  const _chk = loadTogglesChecked(root);
  const cur = _chk.toggles;
  if (!sub || sub === 'list') {
    if (json) { log(JSON.stringify({ version: VERSION, toggles: cur, corrupt: !!_chk.corrupt, corruptReason: _chk.reason, registry: TOGGLE_REGISTRY }, null, 2)); return; }
    log(`# leerness toggle — 기능 토글 (온톨로지 그래프 뷰 ⚙ 탭과 연동)`);
    // 손상 시 "그냥 OFF" 로 보이면 켜 뒀던 게이트가 꺼진 줄 모른다 — 사실을 먼저 알린다(헌트 #5).
    if (_chk.corrupt) log(`  ⚠ toggles.json 손상(${_chk.reason}) — 아래는 **저장값이 아니라 기본값**입니다. 켜 두었던 토글이 꺼져 보일 수 있습니다: ${_togglesPath(root)}`);
    for (const [k, meta] of Object.entries(TOGGLE_REGISTRY)) {
      log(`  ${cur[k] ? '🟢 ON ' : '⚪ OFF'}  ${k.padEnd(17)} ${meta.desc}  [${meta.affects}]`);
    }
    log(`\n  변경: leerness toggle set <id> on|off  ·  그래프 뷰: leerness graph --html → leerness.html 의 ⚙ 탭`);
    return;
  }
  if (sub === 'set') {
    if (!TOGGLE_REGISTRY[id]) { fail(`알 수 없는 토글: ${id} (가능: ${Object.keys(TOGGLE_REGISTRY).join(', ')})`); process.exitCode = 1; return; }
    const on = String(val).toLowerCase();
    if (on !== 'on' && on !== 'off') { fail(`값은 on|off (받음: ${val})`); process.exitCode = 1; return; }
    // 1.36.49 (codex 6차 #5): 손상 toggles.json 위에 set 하면 loadToggles 의 기본값 폴백이 저장돼
    //   무관한 토글(예: gate:false)이 무언 ON 으로 리셋됐다 — 변경 진입점은 fail-closed (1.36.28 스토어 손상 클래스).
    const f = _togglesPath(root);
    if (exists(f)) {
      try { JSON.parse(read(f)); }
      catch { fail(`toggles.json 손상(JSON 파싱 실패) — 덮어쓰기 거부: ${f}\n  복구하거나 삭제(전 토글 기본 ON 복원) 후 재시도`); process.exitCode = 1; return; }
    }
    cur[id] = on === 'on';
    saveToggles(root, cur);
    if (json) { log(JSON.stringify({ ok: true, id, value: cur[id], toggles: cur }, null, 2)); return; }
    ok(`toggle ${id} = ${on.toUpperCase()}${cur[id] ? '' : ' — 관련 명령이 스킵 동작으로 전환됩니다'}`);
    return;
  }
  fail(`알 수 없는 하위명령: ${sub} (가능: list, set)`); process.exitCode = 1;
}

module.exports = { TOGGLE_REGISTRY, SCAFFOLD_TOGGLES, EVIDENCE_COMMANDS, loadToggles, loadTogglesChecked, toggleOn, saveToggles, toggleCmd, _togglesPath, _coerceToggle };
