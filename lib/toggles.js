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
};

function _togglesPath(root) { return path.join(absRoot(root), '.harness', 'toggles.json'); }

// 전체 토글 상태 로드 — 파일 없으면 전부 기본 ON. 손상 파일은 읽기에선 기본값(비변경 경로 resilient).
function loadToggles(root) {
  const out = {};
  for (const id of Object.keys(TOGGLE_REGISTRY)) out[id] = true;
  const f = _togglesPath(root);
  if (!exists(f)) return out;
  try {
    const j = JSON.parse(read(f));
    for (const [k, v] of Object.entries(j || {})) if (k in out) out[k] = v !== false;
  } catch {}
  return out;
}

// 단일 토글 조회 헬퍼 — 호출부 한 줄용.
function toggleOn(root, id) { return loadToggles(root)[id] !== false; }

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
  const json = has && has('--json');
  const cur = loadToggles(root);
  if (!sub || sub === 'list') {
    if (json) { log(JSON.stringify({ version: VERSION, toggles: cur, registry: TOGGLE_REGISTRY }, null, 2)); return; }
    log(`# leerness toggle — 기능 토글 (온톨로지 그래프 뷰 ⚙ 탭과 연동)`);
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
    cur[id] = on === 'on';
    saveToggles(root, cur);
    if (json) { log(JSON.stringify({ ok: true, id, value: cur[id], toggles: cur }, null, 2)); return; }
    ok(`toggle ${id} = ${on.toUpperCase()}${cur[id] ? '' : ' — 관련 명령이 스킵 동작으로 전환됩니다'}`);
    return;
  }
  fail(`알 수 없는 하위명령: ${sub} (가능: list, set)`); process.exitCode = 1;
}

module.exports = { TOGGLE_REGISTRY, loadToggles, toggleOn, saveToggles, toggleCmd, _togglesPath };
