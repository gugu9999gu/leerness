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
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
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
// T-0314: checked memory-output publication (1.36.190, lib/memory-output.js) prepares `.<name>.publish-<pid>-<hex>`
// and hard-links it onto the target; like `.tmp-*`, the prepared file is not state (the link names the target).
const isState = p => /[\\/]\.leerness[\\/]/.test(p) && !/[\\/]archive[\\/]/.test(p)
  && !LOCK_INTERNAL.test(p) && !/\.tmp-\d+-\d+$/.test(p) && !/[\\/]\.[^\\/]+\.publish-\d+-[0-9a-f]+$/.test(p);
const relOf = p => (p.split(/[\\/]\.leerness[\\/]/)[1] || p).replace(/\\/g, '/');
// 선택형 경쟁 창 확대. 제품에는 영향을 주지 않으며, 테스트가 명시적으로 이 모듈을 preload 하고
// LOCKPROBE_STALL_TARGET/LOCKPROBE_STALL_MS 를 함께 준 경우에만 최종 rename 직전에 멈춘다.
// 락이 있는 명령은 이 대기 동안에도 같은 락을 유지하고, 락이 없는 이전 RMW는 뒤늦은 쓰기가 새 데이터를 덮는다.
const STALL_TARGET = String(process.env.LOCKPROBE_STALL_TARGET || '').replace(/\\/g, '/').replace(/^\.?\/+/, '');
const STALL_ABSOLUTE = process.env.LOCKPROBE_STALL_TARGET && path.isAbsolute(process.env.LOCKPROBE_STALL_TARGET)
  ? norm(process.env.LOCKPROBE_STALL_TARGET).replace(/\\/g, '/') : null;
const STALL_PREFIX = String(process.env.LOCKPROBE_STALL_PREFIX || '').replace(/\\/g, '/').replace(/^\.?\/+/, '');
const STALL_MS = Math.max(0, Math.min(10000, Number(process.env.LOCKPROBE_STALL_MS) || 0));
const READY_FILE = process.env.LOCKPROBE_READY_FILE ? path.resolve(process.env.LOCKPROBE_READY_FILE) : null;
// T-0346: a race's second command reports what it did at the stalled target (LOCKPROBE_REACH_TARGET) in
//   LOCKPROBE_REACH_FILE, each report written after the operation ran: a read, open, stat or existence check of the
//   target, and the result of its first attempt at the target's lock or at a lock the first command held when it
//   stalled (EEXIST: contended; success: acquired, so not contended). The first command, given that file as
//   LOCKPROBE_WAIT_FILE, keeps its publication stalled until a report exists (at most LOCKPROBE_WAIT_MAX_MS) and
//   then for LOCKPROBE_STALL_MS more. A fixed stall alone could end before the second command had started, and a
//   report written before the operation (review round 1) could be followed by the operation after the stall ended;
//   either way the race passed without overlapping anything. scripts/race-overlap.js judges the reports.
const targetMatcher = raw => {
  const value = String(raw || '');
  if (!value) return () => false;
  if (path.isAbsolute(value)) { const full = norm(value).replace(/\\/g, '/'); return p => norm(p).replace(/\\/g, '/') === full; }
  const rel = value.replace(/\\/g, '/').replace(/^\.?\/+/, '');
  return p => relOf(norm(p)) === rel;
};
const REACH_FILE = process.env.LOCKPROBE_REACH_FILE ? path.resolve(process.env.LOCKPROBE_REACH_FILE) : null;
const isReachTarget = REACH_FILE ? targetMatcher(process.env.LOCKPROBE_REACH_TARGET) : () => false;
const WAIT_FILE = process.env.LOCKPROBE_WAIT_FILE ? path.resolve(process.env.LOCKPROBE_WAIT_FILE) : null;
const WAIT_MAX_MS = Math.max(0, Math.min(60000, Number(process.env.LOCKPROBE_WAIT_MAX_MS) || 15000));
let stalled = false;
const shouldStall = p => {
  if (stalled || STALL_MS <= 0) return false;
  // T-0343: a file outside .leerness (such as .env.example) is named by its absolute path and matches only that
  //   full path; a relative target still names a path inside .leerness.
  if (STALL_ABSOLUTE) return norm(p).replace(/\\/g, '/') === STALL_ABSOLUTE;
  const rel = relOf(norm(p));
  return (STALL_TARGET && rel === STALL_TARGET) || (STALL_PREFIX && rel.startsWith(STALL_PREFIX));
};
const stall = ms => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { const until = Date.now() + ms; while (Date.now() < until) {} }
};
const _existsRaw = fs.existsSync.bind(fs);
const _readRaw = fs.readFileSync.bind(fs);
// A lock the first command held when it stalled (`heldOn` of its ready file, LOCKPROBE_REACH_LOCKS_FILE) counts too:
// a second command that waits for such a lock is held up by the stalled section, even when it waits there before
// touching the target, or never touches it (a plan add waiting for the plan lock while a restore publishes the
// plan archive).
const REACH_LOCKS_FILE = process.env.LOCKPROBE_REACH_LOCKS_FILE ? path.resolve(process.env.LOCKPROBE_REACH_LOCKS_FILE) : null;
// Read once, when this preload starts. The race starts the second command only after it read the first command's
// whole ready file, and the first command rewrites that file only after a report exists, so no rewrite is under
// way now. Review round 2: the set was read lazily, and a read during a rewrite was cached as "holds no lock", which
// hid a later lock taken after the release. A file that does not parse within 2 s marks every report
// `heldUnknown`, and such a race does not count.
let firstHeld = new Set(), firstHeldKnown = !REACH_LOCKS_FILE;
if (REACH_LOCKS_FILE && REACH_FILE) {
  const until = Date.now() + 2000;
  for (;;) {
    try { const heldOn = JSON.parse(_readRaw(REACH_LOCKS_FILE, 'utf8')).heldOn; if (Array.isArray(heldOn)) { firstHeld = new Set(heldOn); firstHeldKnown = true; break; } } catch {}
    if (Date.now() >= until) break;
    stall(10);
  }
}
const heldByFirst = p => firstHeld.has(relOf(norm(p)));
// The report holds the first completed access of the target (`read`: how and when) and the result of the first
// attempt at one of those locks (`lock`: contended or acquired, and when). It is rewritten when either is first set.
const report = firstHeldKnown ? {} : { heldUnknown: true };
// Review round 3: a rewrite that failed (EACCES, say) left the earlier report standing, and its read then counted
// although a later lock was taken after the release. So the report is trusted only with `complete: true`, written
// when this process exits; a failed write marks it `failed` where it can, and the process exits with 97.
let reportFailed = false;
// LOCKPROBE_REPORT_FAIL_AFTER=n (tests of this module only): writes after the n-th fail as a read-only file would,
// and the report cannot be removed either, the same for every user (a chmod does not stop root).
const FAIL_AFTER = process.env.LOCKPROBE_REPORT_FAIL_AFTER === undefined ? Infinity : Number(process.env.LOCKPROBE_REPORT_FAIL_AFTER);
let writes = 0;
const writeReport = () => {
  try {
    if (++writes > FAIL_AFTER) throw Object.assign(new Error('injected report write failure'), { code: 'EACCES' });
    fs.writeFileSync.call(fs, REACH_FILE, JSON.stringify(report), 'utf8');
    return true;
  } catch (error) {
    reportFailed = true;
    // Review round 4: fail at once, not only in the closing exit listener: a listener that runs after it could take
    // a lock whose report then fails to land. The stale report is also removed where possible.
    process.exitCode = 97;
    if (writes <= FAIL_AFTER) { try { fs.unlinkSync.call(fs, REACH_FILE); } catch {} }
    try { process.stderr.write(`lock-probe: the race report could not be written (${error && error.code || error})\n`); } catch {}
    return false;
  }
};
if (REACH_FILE) {
  process.on('exit', () => {
    if (!report.read && !report.lock && !reportFailed) return;
    if (reportFailed) report.failed = true; else report.complete = true;
    if (!writeReport() || report.failed) process.exitCode = 97;
  });
}
const isWatchedLock = p => { const lock = String(p); return /\.lock$/i.test(lock) && (isReachTarget(lock.slice(0, -'.lock'.length)) || heldByFirst(lock)); };
// After a read-type call on the target ran (also when it threw, as for a file missing during a POSIX publication).
const reachedRead = (p, how) => {
  if (!REACH_FILE || report.read) return;
  try { if (isReachTarget(String(p))) { report.read = { target: relOf(norm(p)), how, at: Date.now() }; writeReport(); } } catch {}
};
// After a lock attempt ran: `error` is what it threw, or null when it took the lock.
const reachedLock = (p, error) => {
  if (!REACH_FILE || report.lock) return;
  try {
    if (!isWatchedLock(p)) return;
    if (error && error.code !== 'EEXIST') return;
    report.lock = { target: relOf(norm(p)), result: error ? 'contended' : 'acquired', at: Date.now() };
    writeReport();
  } catch {}
};
for (const [name, how] of [['readFileSync', 'read'], ['existsSync', 'exists'], ['statSync', 'stat'], ['lstatSync', 'stat'], ['accessSync', 'stat']]) {
  const original = fs[name].bind(fs);
  fs[name] = function (p, ...a) { try { return original(p, ...a); } finally { reachedRead(p, how); } };
}

const _mkdir = fs.mkdirSync.bind(fs);
fs.mkdirSync = function (p, ...a) {
  const isLock = /\.lock$/.test(String(p));
  let r;
  try { r = _mkdir(p, ...a); } catch (error) { if (isLock) reachedLock(p, error); throw error; }
  if (isLock) reachedLock(p, null);
  try { if (isLock) held.add(norm(p)); } catch {}
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
  const isLock = String(flags) === 'wx' && /\.lock$/.test(String(p));
  let r;
  try { r = _open(p, flags, ...a); }
  catch (error) { if (isLock) reachedLock(p, error); else reachedRead(p, 'open'); throw error; }
  if (isLock) reachedLock(p, null); else reachedRead(p, 'open');
  try { if (isLock) held.add(norm(p)); } catch {}
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
const stallBefore = (to) => {
  try {
    if (shouldStall(to)) {
      stalled = true;
      const target = norm(to);
      const ready = { target: relOf(target), locked: held.has(target + '.lock'), heldOn: [...held].map(relOf).sort() };
      if (READY_FILE) _w(READY_FILE, JSON.stringify(ready), 'utf8');
      if (WAIT_FILE) {
        // T-0346: hold the publication until the second command has reached the target, then STALL_MS more. The
        //   outcome is added to the ready file, which the race reads after both commands exit.
        const started = Date.now();
        while (!_existsRaw(WAIT_FILE) && Date.now() - started < WAIT_MAX_MS) stall(10);
        ready.reached = _existsRaw(WAIT_FILE);
        ready.waitedMs = Date.now() - started;
        if (READY_FILE) _w(READY_FILE, JSON.stringify(ready), 'utf8');
      }
      stall(STALL_MS);
      // When the publication goes on; a read reported after this moment did not see the stalled state.
      if (WAIT_FILE) { ready.resumedAt = Date.now(); if (READY_FILE) _w(READY_FILE, JSON.stringify(ready), 'utf8'); }
    }
  } catch {}
};
const _r = fs.renameSync.bind(fs);
fs.renameSync = function (from, to) {
  try { note(to, 'rename'); } catch {}
  stallBefore(to);
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
// T-0314: since 1.36.190 checked memory outputs (decisions/lessons/plan and more) are published by
// `fs.linkSync(prepared, target)` instead of a rename. Hooking rename alone left those final writes
// unobserved by the lock invariant and never stalled, so the race tests reported stalled:false for
// 8 of 11 pairs without creating their race.
const _l = fs.linkSync.bind(fs);
fs.linkSync = function (from, to) {
  try { note(to, 'link'); } catch {}
  stallBefore(to);
  return _l(from, to);
};
// T-0314: on Windows an existing memory output is replaced by [IO.File]::Replace in a PowerShell child
// (lib/io.js _replaceWindowsWithBackup), which no fs hook in this process sees; the target travels in
// LEERNESS_REPLACE_TO. Observe and stall that publication too.
const cp = require('child_process');
const _spawnSync = cp.spawnSync;
cp.spawnSync = function (file, args, options) {
  const to = options && options.env && options.env.LEERNESS_REPLACE_TO;
  if (to) { try { note(to, 'replace'); } catch {} stallBefore(to); }
  return _spawnSync.apply(this, arguments);
};

process.on('exit', () => {
  if (!OUT) return;
  try { fs.appendFileSync(OUT, rec.map(r => JSON.stringify(r)).join('\n') + (rec.length ? '\n' : ''), 'utf8'); } catch {}
});

// 직접 실행 시 계측기 자체의 tombstone 수명주기를 빠르게 검증한다. 전체 e2e의 파일별
// 락 불변식도 같은 결함을 잡지만 수십 분이 걸리므로, 이 회귀는 밀리초 단위 smoke로 먼저 막는다.
if (require.main === module) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lock-probe-selftest-'));
  try {
    const harness = path.join(root, '.leerness');
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
