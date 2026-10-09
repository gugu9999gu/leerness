'use strict';
// Shared CLI/library state-store lock. Existing owner/release/heartbeat rules
// remain here; async context identifies genuine nested work in this process.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { mkdirpRaw, assertWriteAllowed } = require('./io');
const { withRuntimePathWrite, assertCurrentRuntimeWrite } = require('./runtime-writes');
const { errorLanguage } = require('./error-language');
function _sleepSyncMs(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms | 0)); }
  catch { const end = Date.now() + ms; while (Date.now() < end) {} }
}
// 1.9.303 (UR-0043, 외부리뷰 Codex/Opus): read-modify-write lost-update 방지 락.
//   mkdir 원자적 생성으로 상호배제. 다른 프로세스가 보유 중이면 짧게 대기 후 재시도한다.
//   1.36.160: PID/호스트/토큰 소유권을 기록하되 owner가 기록된 락은 자동 탈취하지 않고,
//   기본 쓰기는 timeout 시 fail-closed 한다. 자동 회수는 mkdir 뒤 owner 쓰기 전의 빈 디렉터리만
//   원자적 rmdir로 처리한다. fencing 없는 PID/mtime 판정은 clone/namespace에서 안전하지 않다.
//   손실을 허용한 비핵심 telemetry 만 failOpen 을 명시한다.
const _lockScopes = new (require('async_hooks').AsyncLocalStorage)();
const _heldLocks = new Map();  // lockPath → owner token (프로세스 내 재진입 + 소유한 락만 해제)
// 1.36.132: 락 파일을 "지금은 못 만든다" 로 읽어야 하는 오류들. Windows 에서는 상대가 unlink 하는 순간에
//   열면 EPERM/EACCES 가, 파일 핸들이 아직 살아 있으면 EBUSY 가 난다 — 전부 **재시도 대상**이지 포기 사유가 아니다.
const _LOCK_RETRY_CODES = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);
const _lockFailOpen = [];   // 보호 없이 진행한 기록(관측용) — 조용한 fail-open 을 막는다
// Metadata-free lock directories are possible if a process dies between mkdir and the
// metadata write. Owner records and legacy empty-file locks remain fail-closed because
// ownership is unknowable; this duration is used only by adversarial age fixtures.
const _LOCK_UNKNOWN_OWNER_STALE_MS = 5 * 60 * 1000;
const _LOCK_LEASE = 'worker-v1';
const _LOCK_OWNER_VERSION = 2;
const _LOCK_OWNER_FILE_RE = /^owner-([a-f0-9]{32})\.json$/;
// Date.now와 monotonic uptime의 차이는 이 Node 프로세스 인스턴스의 시작 시각이다.
// 진단용 메타데이터이며 stale 자동 회수의 근거로 쓰지 않는다.
const _PROCESS_STARTED_AT_MS = Math.round(Date.now() - process.uptime() * 1000);
let _lockHostIdentityCache;
let _lockPidScopeIdentityCache;
function _readLockHostSeed(file) {
  try { const v = String(fs.readFileSync(file, 'utf8') || '').trim(); return /^[a-f0-9]{64}$/i.test(v) ? v.toLowerCase() : null; }
  catch { return null; }
}
function _persistentLockHostSeed() {
  // Windows에는 Node 표준 API로 MachineGuid를 읽는 경로가 없다. roaming이 아닌 LOCALAPPDATA에
  // 사용자·머신별 랜덤 seed를 한 번만 만들고, 동시 최초 생성은 wx로 한 승자만 허용한다.
  const dir = require('./machine-cache').machineStateDir();
  if (!dir) return null;
  const fp = path.join(dir, 'lock-host-id');
  let seed = _readLockHostSeed(fp); if (seed) return seed;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const candidate = require('crypto').randomBytes(32).toString('hex');
    fs.writeFileSync(fp, candidate + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return candidate;
  } catch {}
  // 다른 프로세스가 wx 경쟁에서 이겼지만 아직 쓰는 중일 수 있다. 짧게 재독하고, 끝내 확인되지
  // 않으면 hostname으로 완화하지 않고 null(fail-closed)을 돌린다.
  for (let i = 0; i < 4; i++) { _sleepSyncMs(10 + i * 10); seed = _readLockHostSeed(fp); if (seed) return seed; }
  return null;
}
function _lockHostIdentity() {
  if (_lockHostIdentityCache !== undefined) return _lockHostIdentityCache;
  let raw = null;
  try {
    if (process.platform === 'linux') {
      let machine = null; let boot = null;
      for (const fp of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        try { const v = String(fs.readFileSync(fp, 'utf8') || '').trim(); if (/^[a-f0-9-]{16,}$/i.test(v)) { machine = v; break; } } catch {}
      }
      // 컨테이너/VM 복제에서 machine-id가 잘못 복제돼도 같은 공유 락의 로컬 머신으로 오인하지
      // 않도록 boot_id를 반드시 함께 묶는다. 둘 중 하나라도 없으면 부분 식별자를 쓰지 않고
      // 영속 랜덤 seed로 폴백한다. 재부팅 뒤 고아 락은 안전하게 fail-closed다.
      try {
        const v = String(fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8') || '').trim();
        if (/^[a-f0-9-]{16,}$/i.test(v)) boot = v;
      } catch {}
      if (machine && boot) raw = `${machine}|boot:${boot}`;
    }
    if (!raw) raw = _persistentLockHostSeed();
  } catch { raw = null; }
  _lockHostIdentityCache = raw
    ? require('crypto').createHash('sha256').update(`leerness-lock-host-v1|${process.platform}|${raw}`).digest('hex').slice(0, 32)
    : null;
  return _lockHostIdentityCache;
}
function _lockPidScopeIdentity() {
  if (_lockPidScopeIdentityCache !== undefined) return _lockPidScopeIdentityCache;
  const hostId = _lockHostIdentity();
  if (!hostId) { _lockPidScopeIdentityCache = null; return null; }
  let scope = hostId;
  if (process.platform === 'linux') {
    // machine-id/boot_id가 같은 컨테이너도 PID namespace가 다르면 상대 PID를 볼 수 없다.
    // readlink 값(pid:[inode])은 같은 커널의 namespace 객체를 가리키므로, 이 값이 없으면
    // kill(pid, 0)의 ESRCH를 "죽음"으로 해석할 근거가 없다.
    try {
      const ns = String(fs.readlinkSync('/proc/self/ns/pid') || '').trim();
      if (!/^pid:\[[0-9]+\]$/.test(ns)) { _lockPidScopeIdentityCache = null; return null; }
      scope = `${hostId}|${ns}`;
    } catch { _lockPidScopeIdentityCache = null; return null; }
  }
  _lockPidScopeIdentityCache = require('crypto').createHash('sha256')
    .update(`leerness-lock-pid-scope-v1|${process.platform}|${scope}`).digest('hex').slice(0, 32);
  return _lockPidScopeIdentityCache;
}
let _lockHeartbeatWorker = null;
let _lockHeartbeatUnavailable = false;
function _ensureLockHeartbeat() {
  if (_lockHeartbeatWorker) return true;
  if (_lockHeartbeatUnavailable) return false;
  try {
    const { Worker } = require('worker_threads');
    const worker = new Worker(`
      'use strict';
      const fs = require('fs');
      const { parentPort, workerData } = require('worker_threads');
      const { withRuntimeWriteAdmissions } = require(workerData.runtimeWrites);
      const locks = new Map();
      function touch(ownerPath, entry) {
        try {
          const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
          if (!owner || owner.token !== entry.token || owner.lease !== 'worker-v1') { locks.delete(ownerPath); return; }
          // Re-check the holding operation's admission; a new admission would run git in the project.
          const beat = () => fs.utimesSync(ownerPath, new Date(), new Date());
          if (entry.admissions.length) withRuntimeWriteAdmissions(entry.admissions, beat); else beat();
        } catch { locks.delete(ownerPath); }
      }
      parentPort.on('message', (m) => {
        if (!m || typeof m.ownerPath !== 'string') return;
        if (m.op === 'add' && typeof m.token === 'string') {
          const entry = { token: m.token, admissions: Array.isArray(m.admissions) ? m.admissions : [] };
          locks.set(m.ownerPath, entry); touch(m.ownerPath, entry);
        }
        else if (m.op === 'remove') locks.delete(m.ownerPath);
      });
      const timer = setInterval(() => { for (const [p, t] of locks) touch(p, t); }, 1000);
      if (timer.unref) timer.unref();
    `, { eval: true, workerData: { runtimeWrites: require.resolve('../lib/runtime-writes') } });
    worker.on('error', () => { _lockHeartbeatWorker = null; _lockHeartbeatUnavailable = true; });
    worker.on('exit', (code) => { _lockHeartbeatWorker = null; if (code !== 0) _lockHeartbeatUnavailable = true; });
    worker.unref();
    _lockHeartbeatWorker = worker;
    return true;
  } catch { _lockHeartbeatUnavailable = true; return false; }
}
function _lockHeartbeat(op, ownerPath, token) {
  try {
    if (!_lockHeartbeatWorker) return;
    const admissions = op === 'add' ? require('./runtime-writes').runtimeWriteAdmissions() : [];
    _lockHeartbeatWorker.postMessage({ op, ownerPath, token, admissions });
  } catch {}
}
function _newLockOwner(lease) {
  const hostId = _lockHostIdentity();
  const pidScopeId = _lockPidScopeIdentity();
  if (!hostId || !pidScopeId) {
    const err = new Error('lock host or PID-scope identity is unavailable');
    err.code = 'E_LOCK_HOST_ID';
    throw err;
  }
  return {
    v: _LOCK_OWNER_VERSION,
    pid: process.pid,
    host: String(os.hostname() || '').toLowerCase(),
    hostId,
    pidScopeId,
    token: require('crypto').randomBytes(16).toString('hex'),
    lease: lease ? _LOCK_LEASE : null,
    processStartedAtMs: _PROCESS_STARTED_AT_MS,
    createdAt: new Date().toISOString()
  };
}
function _lockOwnerPath(lockPath, token) {
  return path.join(lockPath, `owner-${token}.json`);
}
function _readLockOwner(ownerPath) {
  let raw = null;
  try { raw = fs.readFileSync(ownerPath, 'utf8'); }
  catch (e) { return { raw: null, owner: null, error: (e && e.code) || 'unknown' }; }
  try {
    const value = JSON.parse(raw);
    if (!value || !Number.isSafeInteger(value.pid) || value.pid <= 0
      || typeof value.host !== 'string' || typeof value.token !== 'string' || value.token.length < 16) {
      return { raw, owner: null, error: null };
    }
    return { raw, owner: value, error: null };
  } catch { return { raw, owner: null, error: null }; }
}
function _sameLockDirectory(a, b) {
  if (!a || !b || !a.isDirectory() || !b.isDirectory()) return false;
  // ino/dev가 제공되는 플랫폼에서는 경로가 같은 새 디렉터리로 바뀐 ABA까지 구분한다.
  // Windows처럼 둘 중 하나가 0이면 아래 단독-owner 검사가 이식 가능한 안전망이다.
  return !a.ino || !b.ino || (a.ino === b.ino && a.dev === b.dev);
}
function _reclaimLockDirectory(lockPath, staleMs) {
  let dirStat = null; let names = null;
  try { dirStat = fs.statSync(lockPath); names = fs.readdirSync(lockPath); } catch { return false; }
  if (!dirStat.isDirectory()) return false;
  if (names.length === 0) {
    // mkdir 뒤 owner 기록 전에 죽은 프로세스. 살아 있는 생성자가 뒤늦게 기록하면 rmdir 는 ENOTEMPTY로
    // 실패하고, rmdir 가 먼저 이기면 그 생성자의 owner 쓰기가 실패해 임계구역에 들어오지 못한다.
    if (!(Date.now() - dirStat.mtimeMs > staleMs)) return false;
    try { fs.rmdirSync(lockPath); return true; } catch { return false; }
  }
  // owner가 하나라도 기록된 뒤에는 PID/host/mtime으로 자동 회수하지 않는다. VM 스냅샷·PID
  // namespace·공유 볼륨에서는 어느 신호도 "원 소유자가 다시 실행되지 않는다"는 fencing 증명이
  // 아니다. 잠금 소유자 엔트리는 수동 확인 후에만 복구한다(가용성보다 데이터 보존 우선).
  return false;
}
function _reclaimStaleLock(lockPath, staleMs) {
  let stat = null;
  try { stat = fs.statSync(lockPath); } catch { return false; }
  if (stat.isDirectory()) return _reclaimLockDirectory(lockPath, staleMs);
  // v1 고정 파일도 살아 있는 구버전 프로세스가 재개할 수 있어 자동 삭제하지 않는다.
  if (stat.isFile()) return false;
  return false;
}
function _withLock(targetPath, fn, opts = {}) {
  targetPath = path.resolve(targetPath);
  return withRuntimePathWrite(targetPath, () => {
    assertWriteAllowed(targetPath);
    return _lockScopes.run(new Map(_lockScopes.getStore() || []), () => _withLockBody(targetPath, fn, opts));
  });
}
function _withLockBody(targetPath, fn, opts = {}) {
  const lockPath = targetPath + '.lock';
  // 1.36.144 (T-0117): dry-run 이면 **락을 잡지 않는다** — 쓰기가 어차피 가드에 막히므로 지킬 것이 없고,
  //   락 디렉토리를 만드는 것만으로 "변경 없음" 이 거짓이 된다(실측: `state *` 8건이 빈 `.leerness/` 를 남겼다).
  const scope = _lockScopes.getStore();
  const lockKey = _stateLockKey(targetPath);
  let bailCode = null, lastCode = null;
  if (_heldLocks.has(lockKey)) {
    if (isStateLockHeld(targetPath)) {
      const current = _readLockOwner(_lockOwnerPath(lockPath, _heldLocks.get(lockKey)));
      if (current.owner && current.owner.token === _heldLocks.get(lockKey)) return fn();
      // T-0337: these two are in Korean for a Korean project (lib/error-language.js) and keep their English text otherwise.
      throw Object.assign(new Error(errorLanguage() === 'ko' ? '중첩 작업을 시작하기 전에 상태 잠금 소유권을 잃었습니다'
        : 'state lock ownership was lost before nested work'), { code: 'E_LOCK_OWNERSHIP_LOST' });
    }
    // Blocking this thread would prevent its other Promise from releasing.
    throw Object.assign(new Error(errorLanguage() === 'ko' ? '같은 프로세스의 다른 비동기 작업이 상태 잠금을 잡고 있습니다'
      : 'state lock is held by another async operation in this process'), { code: 'E_LOCK_BUSY' });
  }
  // 1.36.160: Windows CI의 실제 24세션 경합은 직렬 구간이 10초를 넘어 2개 쓰기가 fail-open 했다.
  // 토큰 owner와 기본 fail-closed 정책 아래에서 대기할 여유를 두어 느린 러너에서도 보호를 유지한다.
  const maxWaitMs = opts.maxWaitMs == null ? 35000 : Math.max(0, Number(opts.maxWaitMs) || 0);
  const staleMs = opts.staleMs == null ? 30000 : Math.max(0, Number(opts.staleMs) || 0);
  // ⚠ 여기서 mkdirp 를 빼면 안 된다(1.36.108 에서 한 번 뺐다가 게이트가 5건을 잡았다).
  //   `state`·hunts 등 여러 호출부가 **이 mkdirp 가 만들어 주는 디렉토리에 기대어** 곧바로 파일을 쓴다 —
  //   공유 헬퍼의 부작용을 없애면 그 의존이 한꺼번에 끊긴다. 미초기화 디렉토리 문제는 락을 다는 쪽에서 막는다.
  try { mkdirpRaw(path.dirname(lockPath)); } catch {}   // 1.36.144: 락은 dry-run 가드 예외(막으면 무보호 진행으로 떨어진다)
  const start = Date.now();
  let owner = null; let ownerPath = null; let held = false;
  while (Date.now() - start <= maxWaitMs) {
    try {
      let fd = null; let madeDir = false; let madeOwner = false; let createdDirStat = null;
      try {
        fs.mkdirSync(lockPath); madeDir = true;            // 원자적 배타 디렉터리 생성
        createdDirStat = fs.statSync(lockPath);
        owner = _newLockOwner(_ensureLockHeartbeat());     // 획득 시도마다 새 토큰 — 경로 재사용 금지
        ownerPath = _lockOwnerPath(lockPath, owner.token);
        fd = fs.openSync(ownerPath, 'wx'); madeOwner = true;
        fs.writeFileSync(fd, JSON.stringify(owner) + '\n', 'utf8');
        fs.closeSync(fd); fd = null;
        // 생성/쓰기 중 stale 빈 디렉터리 회수와 경합하면 현재 경로가 다른 디렉터리일 수 있다.
        // 디렉터리 인스턴스(가능한 플랫폼)와 "내 owner 하나뿐"을 함께 확인한다. 단순 토큰 확인만
        // 하면 교체 디렉터리에 두 owner가 생겨 둘 다 임계구역에 들어갈 수 있다.
        const currentDirStat = fs.statSync(lockPath);
        const names = fs.readdirSync(lockPath);
        const confirmed = _readLockOwner(ownerPath);
        if (!_sameLockDirectory(createdDirStat, currentDirStat)
          || names.length !== 1 || names[0] !== path.basename(ownerPath)
          || !confirmed || confirmed.error || !confirmed.owner || confirmed.owner.token !== owner.token) {
          const verifyErr = new Error('lock ownership was not durable after creation');
          verifyErr.code = 'E_LOCK_OWNERSHIP'; throw verifyErr;
        }
      } catch (e) {
        if (fd !== null) { try { fs.closeSync(fd); } catch {} }
        if (madeOwner && ownerPath) { try { fs.unlinkSync(ownerPath); } catch {} }
        if (madeDir) { try { fs.rmdirSync(lockPath); } catch {} }
        throw e;
      }
      held = true; break;
    }
    catch (e) {
      // 1.36.132 (P1, 실측): 종전엔 `EEXIST` 가 아니면 즉시 **락 없이 진행**했다. 그런데 Windows 에서
      //   상대가 락을 지우는 그 순간에 열면 `EPERM` 이 난다 — 즉 **경합이 심할수록** 보호가 꺼졌다.
      //   격리 실측(N=32, 획득 루프만): 현행 = 무보호 진행 1 · 유실 1행(3.1%) · EPERM 크래시 1,
      //   재시도 술어만 바꾼 대조군 = 무보호 0 · 유실 0 · 크래시 0 (대기시간 동일 ~1.0s).
      //   제품 경로(16 프로세스 동시 `task add`)는 파일 연산이 많아 6.3% 유실 + exit 1 이 2회 연속 재현됐다.
      //   이 코드들은 전부 "지금은 못 잡는다" 이지 "잡을 수 없다" 가 아니다 → 기다린다.
      lastCode = e.code || null;   // 1.36.132 (검수 P2): 10초를 기다린 뒤 'timeout' 이라고만 하면 영구 권한 오류를 경합으로 오진한다
      if (!_LOCK_RETRY_CODES.has(e.code)) { bailCode = e.code || 'unknown'; break; }
      if (_reclaimStaleLock(lockPath, staleMs)) continue;
      _sleepSyncMs(15 + Math.floor((Date.now() - start) / 50));  // 점증 backoff
    }
  }
  if (held) {
    _heldLocks.set(lockKey, owner.token);
    scope.set(lockKey, owner.token);
    if (owner.lease === _LOCK_LEASE) _lockHeartbeat('add', ownerPath, owner.token);
  }
  else {
    const _why = bailCode || (lastCode && lastCode !== 'EEXIST' ? `${lastCode} 지속(${maxWaitMs}ms)` : 'timeout');
    const waitedMs = Date.now() - start;
    // T-0337: the warning and the error are in English for an English project (lib/error-language.js) and keep their
    // Korean text otherwise. The recorded reason (stateLockDiagnostics) keeps its existing form in every language.
    const _en = errorLanguage() === 'en';
    const _whyText = _en && !bailCode && lastCode && lastCode !== 'EEXIST' ? `${lastCode} persisted (${maxWaitMs}ms)` : _why;
    if (opts.failOpen === true) {
      _lockFailOpen.push({ file: path.basename(targetPath), reason: _why, waitedMs });
      if (process.env.LEERNESS_NO_LOCK_WARN !== '1') {
        try {
          process.stderr.write(_en ? `⚠ Lock acquisition failed — continuing without protection for a non-critical record only: ${path.basename(targetPath)} (${_whyText}).\n`
            : `⚠ 락 획득 실패 — 비핵심 기록만 보호 없이 진행합니다: ${path.basename(targetPath)} (${_why}).\n`);
        } catch { /* stderr 가 닫혀 있어도 진행은 막지 않는다 */ }
      }
    } else {
      const err = new Error(_en ? `Lock acquisition failed — stopped to protect the data from concurrent writes: ${path.basename(targetPath)} (${_whyText})`
        : `락 획득 실패 — 동시 쓰기로부터 데이터를 보호하기 위해 중단합니다: ${path.basename(targetPath)} (${_why})`);
      err.code = bailCode === 'E_LOCK_HOST_ID' ? 'E_LOCK_HOST_ID' : 'E_LOCK_TIMEOUT';
      err.lockPath = lockPath; err.waitedMs = waitedMs;
      throw err;
    }
  }
  // 1.36.108 (T-0097, 자체 적대 검사에서 발견): fn 이 **프로미스를 돌려주면** 동기 finally 가 그 즉시 락을 푼다 —
  //   비동기 본체(네트워크 fetch 등)는 락 없이 도는데 호출부는 보호받는다고 믿는다. 가장 나쁜 조합이다
  //   (`provider sync` 를 감싸면서 실제로 이 형태를 만들었다). thenable 이면 **정착 후에** 푼다.
  //   1.36.132 (검수 P1) + 1.36.160: 해제 실패를 조용히 삼키면 **고아 락**이 남는다. 기본 쓰기는
  //   더 이상 자동 탈취하지 않으므로 잠깐 재시도하고, 그래도 안 되면 현재 성공 주장 자체를 거부한다.
  let releaseSettled = false;
  let releaseResult = null;
  const release = () => {
    // 성공과 실패를 모두 캐시한다. thenable 콜백에서 난 해제 오류가 바깥 `then.call` catch로
    // 다시 올라와도 공개 lockPath나 tombstone을 두 번째로 검사하지 않는다.
    if (releaseSettled) return releaseResult;
    if (!held) return null;
    _lockHeartbeat('remove', ownerPath, owner.token);
    _heldLocks.delete(lockKey);
    scope.delete(lockKey);
    // owner를 먼저 지우고 같은 lockPath를 재시도하면, 그 사이 경쟁자가 만든 새 빈 디렉터리를
    // 지우는 ABA가 생긴다. 소유한 디렉터리 전체를 토큰 고유 tombstone으로 먼저 원자 이동해
    // 공개 lockPath와 정리 대상을 분리한다. 이후 경쟁자는 즉시 새 lockPath를 만들 수 있고,
    // 우리는 그 경로를 다시 건드리지 않는다.
    const releasePath = `${lockPath}.release-${owner.token}`;
    const releaseOwnerPath = _lockOwnerPath(releasePath, owner.token);
    let quarantined = false;
    let ownerRemoved = false;
    const releaseSuccess = () => {
      releaseSettled = true; releaseResult = null; held = false; return null;
    };
    const releaseFailure = (reason, code) => {
      _lockFailOpen.push({ file: path.basename(targetPath), reason, waitedMs: 0 });
      const err = new Error(errorLanguage() === 'en' ? `Lock ownership could not be confirmed, so the result is not reported as a success: ${path.basename(lockPath)} (${reason})`
        : `락 소유권을 확인하지 못해 작업 결과를 성공으로 확정하지 않습니다: ${path.basename(lockPath)} (${reason})`);
      err.code = code || 'E_LOCK_RELEASE'; err.lockPath = lockPath;
      if (quarantined) err.releasePath = releasePath;
      if (process.env.LEERNESS_NO_LOCK_WARN !== '1') {
        try { process.stderr.write(`⚠ ${err.message}\n`); } catch {}
      }
      releaseSettled = true; releaseResult = err;
      return releaseResult;
    };
    for (let i = 0; i < 6; i++) {
      try {
        if (!quarantined) {
          const current = _readLockOwner(ownerPath);
          if (!current || current.error) {
            if (current && current.error === 'ENOENT') {
              return releaseFailure('ownership-lost', 'E_LOCK_OWNERSHIP_LOST');
            }
            const readErr = new Error(`lock owner read failed: ${(current && current.error) || 'unknown'}`);
            readErr.code = (current && current.error) || 'unknown';
            throw readErr;
          }
          if (!current.owner || current.owner.token !== owner.token) {
            return releaseFailure('ownership-lost', 'E_LOCK_OWNERSHIP_LOST');
          }
          fs.renameSync(lockPath, releasePath);
          quarantined = true;
        }
        if (!ownerRemoved) {
          // rename 뒤에도 같은 owner가 따라왔는지 확인한다. 외부 조작으로 경로가 교체됐다면
          // unrelated tombstone을 지우지 않고 성공 주장도 거부한다.
          const moved = _readLockOwner(releaseOwnerPath);
          if (!moved || moved.error) {
            if (moved && moved.error === 'ENOENT') {
              return releaseFailure('ownership-lost-after-rename', 'E_LOCK_OWNERSHIP_LOST');
            }
            const readErr = new Error(`moved lock owner read failed: ${(moved && moved.error) || 'unknown'}`);
            readErr.code = (moved && moved.error) || 'unknown';
            throw readErr;
          }
          if (!moved.owner || moved.owner.token !== owner.token) {
            return releaseFailure('ownership-lost-after-rename', 'E_LOCK_OWNERSHIP_LOST');
          }
          fs.unlinkSync(releaseOwnerPath); ownerRemoved = true;
        }
        fs.rmdirSync(releasePath); return releaseSuccess();
      }
      catch (e) {
        if (e.code === 'ENOENT') {
          return quarantined && ownerRemoved ? releaseSuccess() : releaseFailure('ownership-lost', 'E_LOCK_OWNERSHIP_LOST');
        }
        if (e.code === 'ENOTEMPTY' || e.code === 'EEXIST') {
          if (!quarantined || !ownerRemoved) {
            _sleepSyncMs(10 + i * 10);
            continue;
          }
          // Windows/Node 18에서는 마지막 owner를 unlink한 직후 **실제로 빈 디렉터리**에도
          // rmdirSync가 순간적으로 ENOTEMPTY를 반환한다(로컬 1/3, CI 재현). 이를 곧바로
          // 성공 처리하면 tombstone이 남는다. 빈 디렉터리/자기 deletion-pending owner만 재시도한다.
          let remaining = null;
          try { remaining = fs.readdirSync(releasePath); }
          catch (readErr) {
            if (readErr && readErr.code === 'ENOENT') return releaseSuccess();
            _sleepSyncMs(10 + i * 10);
            continue;
          }
          const ownName = path.basename(releaseOwnerPath);
          if (remaining.some(name => name !== ownName)) {
            return releaseFailure('release-tombstone-contaminated', 'E_LOCK_RELEASE');
          }
          _sleepSyncMs(10 + i * 10);
          continue;
        }
        _sleepSyncMs(10 + i * 10);
      }
    }
    return releaseFailure('release-failed', 'E_LOCK_RELEASE');
  };
  const releaseAndRethrow = e => {
    const releaseErr = release();
    if (releaseErr && e && typeof e === 'object') e.lockReleaseError = releaseErr.code;
    throw e;
  };
  let out;
  try { assertCurrentRuntimeWrite(targetPath); out = fn(); }
  catch (e) { return releaseAndRethrow(e); }
  let then = null;
  try { then = out && out.then; }
  catch (e) { return releaseAndRethrow(e); }
  if (typeof then === 'function') {
    // Promise/A+의 first-settlement 규칙을 비표준 thenable에도 적용한다. 여러 번 resolve/reject
    // 하거나 resolve 뒤 던져도 첫 결과만 락 수명과 반환/예외를 결정해야 한다.
    let settlement = null;
    const onFulfilled = v => {
      if (settlement) return settlement.kind === 'fulfilled' ? settlement.value : undefined;
      settlement = { kind: 'fulfilled', value: v, error: null };
      const releaseErr = release();
      if (releaseErr) {
        settlement.kind = 'release-failed'; settlement.error = releaseErr; throw releaseErr;
      }
      return v;
    };
    const onRejected = e => {
      if (settlement) return undefined;
      settlement = { kind: 'rejected', value: undefined, error: e };
      return releaseAndRethrow(e);
    };
    let thenResult;
    try {
      thenResult = then.call(out, onFulfilled, onRejected);
    } catch (e) {
      if (!settlement) {
        // 콜백을 타이머에 예약한 뒤 동기 throw하는 비준수 thenable도 있다. throw를 첫
        // settlement로 기록해야 늦은 콜백이 해제를 다시 호출하거나 결과를 뒤집지 않는다.
        settlement = { kind: 'rejected', value: undefined, error: e };
        return releaseAndRethrow(e);
      }
      if (settlement.kind === 'fulfilled') return settlement.value;
      throw settlement.error;
    }
    if (settlement && settlement.kind !== 'fulfilled') throw settlement.error;
    return thenResult;
  }
  const releaseErr = release();
  if (releaseErr) throw releaseErr;
  return out;
}

function _stateLockKey(targetPath) {
  const key = path.resolve(targetPath) + '.lock';
  return process.platform === 'win32' ? key.toLowerCase() : key;
}
function isStateLockHeld(targetPath) {
  const key = _stateLockKey(targetPath), token = _heldLocks.get(key);
  return !!token && !!_lockScopes.getStore() && _lockScopes.getStore().get(key) === token;
}
module.exports = { withStateLock: _withLock, isStateLockHeld,
  stateLockDiagnostics: () => _lockFailOpen.map(entry => ({ ...entry })) };
