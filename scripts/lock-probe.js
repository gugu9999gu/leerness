// scripts/lock-probe.js — 상태 스토어 쓰기가 **락 안에서** 일어나는지 실행으로 관측하는 계측 모듈.
//
// 왜 소스 검사가 아니라 계측인가: 정적으로 "이 writeUtf8 이 _withLock 안인가" 를 판정하려 했더니
// 괄호 균형 스캐너가 주석/정규식 리터럴에서 폭주해 selftest 픽스처 수천 줄을 "락 안" 으로 분류했다.
// 락은 **파일별이 아니라 구간별**이기도 하다 — leerness 는 decisions.json 의 락을 쥔 채 decisions.md 를 쓴다.
// 그래서 _withLock 이 하는 것과 똑같이(mkdir 로 <target>.lock 생성 → 끝나면 rmdir) 보유 집합을 미러링하고,
// 쓰기 시점에 "이 프로세스가 락을 하나라도 쥐고 있었나" 를 기록한다.
//
// 사용: node --require scripts/lock-probe.js bin/leerness.js <명령> ...   (LOCKPROBE_OUT 에 jsonl 기록)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = process.env.LOCKPROBE_OUT;
const rec = [];
const held = new Set();
const norm = p => { try { return path.resolve(String(p)); } catch { return String(p); } };
// archive/ 는 백업 사본이라 경쟁 대상이 아니다. 공개 .lock 과 해제 중인 token-unique
// .lock.release-* tombstone 자체/하위 파일, 원자쓰기 임시파일도 제외한다(최종 경로는 rename 이 알려준다).
// tombstone을 상태로 세면 해제용 rename/owner 삭제가 사용자 쓰기로 오인되고, 공개 락을 계속 held로
// 누적하면 이후의 정상 쓰기까지 "서로 다른 락" 아래에서 일어난 것처럼 보이는 거짓 실패가 난다.
const LOCK_INTERNAL = /\.lock(?:\.release-[0-9a-f]+)?(?:[\\/]|$)/i;
const isState = p => /[\\/]\.harness[\\/]/.test(p) && !/[\\/]archive[\\/]/.test(p)
  && !LOCK_INTERNAL.test(p) && !/\.tmp-\d+-\d+$/.test(p);
const relOf = p => (p.split(/[\\/]\.harness[\\/]/)[1] || p).replace(/\\/g, '/');
// 선택형 경쟁 창 확대. 제품에는 영향을 주지 않으며, 테스트가 명시적으로 이 모듈을 preload 하고
// LOCKPROBE_STALL_TARGET/LOCKPROBE_STALL_MS 를 함께 준 경우에만 최종 rename 직전에 멈춘다.
// 락이 있는 명령은 이 대기 동안에도 같은 락을 유지하고, 락이 없는 이전 RMW는 뒤늦은 쓰기가 새 데이터를 덮는다.
const STALL_TARGET = String(process.env.LOCKPROBE_STALL_TARGET || '').replace(/\\/g, '/').replace(/^\.?\/+/, '');
const STALL_PREFIX = String(process.env.LOCKPROBE_STALL_PREFIX || '').replace(/\\/g, '/').replace(/^\.?\/+/, '');
const STALL_MS = Math.max(0, Math.min(10000, Number(process.env.LOCKPROBE_STALL_MS) || 0));
const READY_FILE = process.env.LOCKPROBE_READY_FILE ? path.resolve(process.env.LOCKPROBE_READY_FILE) : null;
let stalled = false;
const shouldStall = p => {
  if (stalled || STALL_MS <= 0) return false;
  const rel = relOf(norm(p));
  return (STALL_TARGET && rel === STALL_TARGET) || (STALL_PREFIX && rel.startsWith(STALL_PREFIX));
};
const stall = ms => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { const until = Date.now() + ms; while (Date.now() < until) {} }
};

const _mkdir = fs.mkdirSync.bind(fs);
fs.mkdirSync = function (p, ...a) {
  const r = _mkdir(p, ...a);
  try { if (/\.lock$/.test(String(p))) held.add(norm(p)); } catch {}
  return r;
};
const _rmdir = fs.rmdirSync.bind(fs);
fs.rmdirSync = function (p, ...a) {
  const r = _rmdir(p, ...a);
  try { if (/\.lock$/.test(String(p))) held.delete(norm(p)); } catch {}
  return r;
};
// 구버전 고정 파일 락도 계측 호환성을 유지한다.
const _open = fs.openSync.bind(fs);
fs.openSync = function (p, flags, ...a) {
  const r = _open(p, flags, ...a);
  try { if (String(flags) === 'wx' && /\.lock$/.test(String(p))) held.add(norm(p)); } catch {}
  return r;
};
const _unlink = fs.unlinkSync.bind(fs);
fs.unlinkSync = function (p, ...a) {
  const r = _unlink(p, ...a);
  try { if (/\.lock$/.test(String(p))) held.delete(norm(p)); } catch {}
  return r;
};

// 1.36.108 (codex 검수 P2, 재현됨): "락을 하나라도 쥐었나" 는 **너무 약한 질문**이다.
//   session close 는 session-handoff.md 의 락을 쥔 채 current-state.md 를 썼고, audit --fix 는
//   current-state.md 의 락을 쥔다 — 둘 다 '락 보유' 인데 서로를 배제하지 못해 갱신이 덮였다.
//   그래서 **어느 락을 쥐었는지**(heldOn)를 함께 남긴다. 가드는 파일마다 락 키가 일관되는지까지 본다.
const note = (target, how) => {
  const t = norm(target);
  if (!isState(t)) return;
  rec.push({ file: relOf(t), how, locked: held.size > 0, heldOn: [...held].map(relOf).sort() });
};
const _w = fs.writeFileSync.bind(fs);
fs.writeFileSync = function (p, ...a) { try { note(p, 'write'); } catch {} return _w(p, ...a); };
const _r = fs.renameSync.bind(fs);
fs.renameSync = function (from, to) {
  try { note(to, 'rename'); } catch {}
  try {
    if (shouldStall(to)) {
      stalled = true;
      const target = norm(to);
      if (READY_FILE) {
        _w(READY_FILE, JSON.stringify({
          target: relOf(target),
          locked: held.has(target + '.lock'),
          heldOn: [...held].map(relOf).sort()
        }), 'utf8');
      }
      stall(STALL_MS);
    }
  } catch {}
  const r = _r(from, to);
  // 1.36.160: 공개 락 디렉터리를 tombstone으로 원자 이동하는 순간 target에 대한
  // 상호배제는 끝난다. 실제 rename 성공 뒤에만 보유 집합에서 제거해 실패한 rename은
  // 계속 held로 남긴다. tombstone은 정리 대상이지 새 공개 락이 아니므로 destination은 추가하지 않는다.
  try {
    const source = norm(from);
    if (held.has(source) && /\.lock$/i.test(String(from)) && LOCK_INTERNAL.test(String(to))) held.delete(source);
  } catch {}
  return r;
};
const _a = fs.appendFileSync.bind(fs);
fs.appendFileSync = function (p, ...args) { try { note(p, 'append'); } catch {} return _a(p, ...args); };

process.on('exit', () => {
  if (!OUT) return;
  try { fs.appendFileSync(OUT, rec.map(r => JSON.stringify(r)).join('\n') + (rec.length ? '\n' : ''), 'utf8'); } catch {}
});

// 직접 실행 시 계측기 자체의 tombstone 수명주기를 빠르게 검증한다. 전체 e2e의 파일별
// 락 불변식도 같은 결함을 잡지만 수십 분이 걸리므로, 이 회귀는 밀리초 단위 smoke로 먼저 막는다.
if (require.main === module) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lock-probe-selftest-'));
  try {
    const harness = path.join(root, '.harness');
    const state = path.join(harness, 'state.json');
    const lock = `${state}.lock`;
    const tombstone = `${lock}.release-0123456789abcdef0123456789abcdef`;
    const ownerName = 'owner-0123456789abcdef0123456789abcdef.json';
    fs.mkdirSync(harness, { recursive: true });
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, ownerName), '{"token":"0123456789abcdef0123456789abcdef"}\n');
    fs.writeFileSync(state, '{"phase":"held"}\n');
    fs.renameSync(lock, tombstone);
    const movedOwner = path.join(tombstone, ownerName);
    // 이동된 하위 파일의 실제 쓰기/삭제도 사용자 상태 row로 보이면 안 된다.
    fs.writeFileSync(movedOwner, '{"phase":"deletion-pending"}\n');
    fs.unlinkSync(movedOwner);
    fs.writeFileSync(state, '{"phase":"released"}\n');
    const stateRows = rec.filter(row => row.file === 'state.json');
    const passed = rec.length === 2
      && stateRows.length === 2
      && stateRows[0].locked === true
      && stateRows[0].heldOn.length === 1
      && stateRows[0].heldOn[0] === 'state.json.lock'
      && stateRows[1].locked === false
      && stateRows[1].heldOn.length === 0
      && rec.every(row => !/\.lock\.release-/i.test(row.file))
      && held.size === 0;
    if (!passed) {
      process.stderr.write(`lock-probe selftest failed: ${JSON.stringify({ stateRows, held: [...held], rec })}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write('lock-probe selftest passed: release tombstone is internal and public lock lifetime ended\n');
    }
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
}
