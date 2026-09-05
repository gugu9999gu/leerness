// lib/io.js — 콘솔 출력 + 타임스탬프 + 파일 I/O 기반 프리미티브 (단일출처).
// 1.9.382 (UR-0025, 큰 핸들러 모듈화 토대): log/ok/warn/fail/today/now 분리.
// 1.9.383 (UR-0025): fs 프리미티브(read/readBuf/writeUtf8/exists/mkdirp/append/rel/absRoot) 추가.
//   목적: 향후 핸들러를 별도 lib 모듈로 분리할 때 공유 가능한 I/O 프리미티브 제공(harness 만 갖던 것 → 공용화).
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const crypto = require('crypto');

// 1.10.2 (UR-0146): quiet 모드 — 사람용 출력(log/ok/warn) 억제. init --json 등에서 큰 핸들러의 다수 log 를 비침투적으로 묵음 → 순수 JSON 1개만 출력.
//   fail/failJson(오류)은 묵음 대상 아님(에러는 항상 노출). setQuiet 로 토글, 호출부 finally 에서 반드시 복구.
let _quiet = false;
function setQuiet(v) { _quiet = !!v; if (!v) { _jsonErrEmitted = false; _failLatched = false; _firstFail = null; } }   // 1.36.50: 장수 프로세스(REPL)가 명령 경계에서 복구 시 JSON-오류 래치도 해제
function log(s = '') {
  _unlatchIfNewCmd();
  if (_quiet) return;
  if (_failLatched || _jsonErrEmitted) {
    // json-오류 래치 중: 명령 자신의 구조화 출력(JSON 페이로드)만 통과, 사람용 잔여 줄은 stderr 강등.
    // 1.36.54 (codex 7차 #7a): JSON 통과는 지연-fail(폴백 대기) 경로 전용 — failJson 이 이미 오류 JSON 을
    //   방출했다면(_jsonErrEmitted) 추가 JSON 은 이중 문서가 되므로 stderr 강등.
    const t = typeof s === 'string' ? s.trim() : '';
    if (!_jsonErrEmitted && t && (t[0] === '{' || t[0] === '[')) { try { JSON.parse(t); console.log(s); return; } catch {} }
    console.error(s); return;
  }
  console.log(s);
}
// 1.36.103: _stdoutWrote 는 'log() 를 불렀다' 가 아니라 '실제로 stdout 에 썼다' 여야 한다.
//   여기서 직접 세우면, gate 처럼 하위 출력을 삼키려고 process.stdout.write 를 no-op 으로 바꾼 구간에서
//   바이트는 한 개도 안 나갔는데 표식만 서서 폴백 오류 JSON 이 막혔다(실측: gate <없는경로> --json → stdout 0바이트).
//   추적은 stdout 래퍼 한 곳에만 둔다 — 래퍼가 교체된 동안의 출력은 정의상 stdout 에 도달하지 않은 것이다.
// 1.36.103: --json 모드에서 ✓/⚠ 는 절대 JSON 페이로드의 일부가 될 수 없다 — stdout 이 아니라 stderr 로 낸다.
//   기존에는 fail() 이 래치된 뒤에만 강등돼, 경고가 오류보다 먼저 나오면 stdout 을 오염시켰다.
//   실측: `reuse-map|retro|insights --include <없는프로젝트> --json` → stdout 이 "⚠ --include 무시: …" 한 줄뿐이라
//   JSON.parse 가 실패한다(그리고 _stdoutWrote 가 서 버려 폴백 오류 JSON 도 막힌다).
function ok(s) { if (_argvJsonMode() && !_quiet) { console.error('✓ ' + s); return; } log('✓ ' + s); }
function warn(s) { if (_argvJsonMode() && !_quiet) { console.error('⚠ ' + s); return; } log('⚠ ' + s); }
// fail() 은 오류 신호 → exit code 1 설정 (CI/MCP/에이전트가 실패를 성공으로 오판 방지, UR-0045).
// 1.36.50 (codex 스윕 B, 40+ 실측): --json 요청 시 fail() 자체가 단일 JSON 계약을 이행 —
//   첫 오류를 {ok:false,error,code:'error'} 로 stdout 에 내고 이후 사람용 출력(log/ok/warn·추가 fail)은
//   묵음/stderr 로 강등해 "✗ 텍스트·혼합·빈 stdout" 클래스를 진입점 한 곳에서 종결한다.
//   개별 명령이 failJson 으로 구체 code 를 주는 기존 경로는 그대로 우선.
// 설계 v2 (게이트 실측 후 재설계): 즉시 JSON 방출+전면 묵음은 "내부 fail 후 자기 집계 JSON 을 내는 명령"(gate 등)을 질식시켰다.
//   → fail() 은 json 모드에서 stdout 에 아무것도 안 쓰고(✗ 는 stderr), 사람용 후속 log 만 억제하되
//     JSON 페이로드 log 는 통과시킨다. 프로세스 exit 때 stdout 이 여전히 비어 있으면 첫 오류를 폴백 JSON 으로 방출 —
//     결과적으로 stdout 은 "명령 자신의 JSON" 또는 "폴백 오류 JSON" 중 정확히 하나.
let _jsonErrEmitted = false;   // failJson 즉시 방출 후 후속 사람용 출력 억제 표식
let _failLatched = false;      // fail() json 모드 발화 표식 (사람용 log 억제 + exit 폴백 대기)
let _firstFail = null;
let _stdoutWrote = false;
let _exitHooked = false;
// 1.36.103: 폴백 JSON 은 '지금의' process.stdout.write 가 아니라 로드 시점의 원본 fd 로 쓴다.
//   gate 는 JSON 모드에서 하위 단계 출력을 삼키려고 write 를 no-op 으로 갈아끼우는데(bin 17162),
//   그 구간에서 process.exit() 가 나면 finally 가 돌지 않아 복원되지 않는다 → console.log 가 통째로 삼켜져
//   `--json` 인데 stdout 0바이트 + exit 1 이 됐다(실측). 원본을 잡아두면 그 상태에서도 계약을 지킬 수 있다.
let _rawStdoutWrite = null;
let _latchArgv = null;         // 래치는 argv 정체성 스코프 — 새 명령(REPL/인프로세스 테스트가 argv 교체) 시 자동 해제
// stdout 기록 추적은 스트림 레벨 — 일부 명령(audit 등)이 process.stdout.write 를 직접 캡처/사용해 log() 를 우회한다.
//   모듈 로드 시 1회 투명 래핑: 이후 어떤 경로(직접 write 포함)로든 stdout 에 쓰면 exit 폴백이 이중 JSON 을 내지 않는다.
{
  _rawStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function (...a) { _stdoutWrote = true; return _rawStdoutWrite(...a); };
}
function _argvJsonMode() { try { return process.argv.includes('--json'); } catch { return false; } }
// 1.36.103: 폴백 오류 JSON 을 fail() 안이 아니라 모듈 로드 시 설치한다.
//   fail() 을 거치지 않고 실패하는 경로(하위 점검이 직접 console.error 후 exit)에서는 훅이 아예 걸리지 않아
//   `--json` 인데 stdout 이 완전히 비고 exit 1 인 상태가 나왔다(실측: gate <없는경로> --json → stdout 0바이트).
//   기계 소비자에게 '빈 stdout' 은 파싱 불가와 같다 — --json 은 실패해도 반드시 JSON 하나를 남긴다.
function _installJsonExitFallback() {
  if (_exitHooked) return;
  _exitHooked = true;
  process.on('exit', (code) => {
    if (code === 0 || _stdoutWrote || !_argvJsonMode()) return;
    const payload = JSON.stringify({ ok: false, error: _firstFail != null ? _firstFail : 'command failed', code: 'error' }, null, 2) + '\n';
    if (_rawStdoutWrite) { try { _rawStdoutWrite(payload); return; } catch { /* 원본 write 실패 시 console 로 폴백 */ } }
    console.log(payload.trimEnd());
  });
}
_installJsonExitFallback();
function _unlatchIfNewCmd() {
  if ((_jsonErrEmitted || _failLatched) && _latchArgv !== process.argv) { _jsonErrEmitted = false; _failLatched = false; _firstFail = null; _quiet = false; _latchArgv = null; }
}
function fail(s) {
  _unlatchIfNewCmd();
  if (_argvJsonMode()) {
    if (_firstFail == null) _firstFail = s;
    _failLatched = true; _latchArgv = process.argv;
    console.error('✗ ' + s);
    // 1.36.54 (#7b): 최종 exit 이 0(명령이 회복)이면 폴백 오류 JSON 을 내지 않는다 — 성공 exit 에 ok:false 모순 방지.
    // 1.36.103: 훅 설치는 모듈 로드 시점으로 옮겼다(_installJsonExitFallback) — fail() 을 안 거치는 실패 경로도 덮기 위해.
    _installJsonExitFallback();
    process.exitCode = 1; return;
  }
  console.log('✗ ' + s); process.exitCode = 1;  // quiet 무시(오류는 항상 노출)
}
// 1.9.398 (6번째 외부평가/codex P1-C, UR-0099): --json 모드 에러는 구조화 출력 — AI 에이전트가 에러 경로에서 JSON.parse 실패하지 않도록.
//   jsonMode 면 {ok:false,error,code} + exit1, 아니면 사람용 fail(). 양쪽 exit code 1 일관.
function failJson(jsonMode, code, msg) {
  _unlatchIfNewCmd();
  if (jsonMode) {
    // 1.36.103: _stdoutWrote 는 래퍼가 세운다 — 여기서 세우면 삼켜진 출력을 '썼다' 고 오인한다.
    if (!_jsonErrEmitted) { console.log(JSON.stringify({ ok: false, error: msg, code }, null, 2)); _jsonErrEmitted = true; _failLatched = true; _latchArgv = process.argv; }
    else console.error('✗ ' + msg);
    process.exitCode = 1;
  } else {
    // 명시적 jsonMode=false 는 호출자의 결정 — argv 스니핑(fail)보다 우선해 human 출력 보장
    console.log('✗ ' + msg); process.exitCode = 1;
  }
}
function today() { return new Date().toISOString().slice(0, 10); }
function now() { return new Date().toISOString(); }

// 1.9.410 (8번째 버그헌트, UR-0114): 값 없는 --path 는 arg()가 boolean true 를 반환 → 'true || cwd'=true(truthy) → path.resolve(true) raw TypeError.
//   비-문자열/공백 입력은 cwd 로 폴백(--path= 빈값 동작과 일관) → 크래시 차단.
function absRoot(p) { return path.resolve((typeof p === 'string' && p.trim()) ? p : process.cwd()); }
function exists(p) { return fs.existsSync(p); }
function read(p) {
  // 1.9.147: UTF-8 BOM 자동 strip — Windows PowerShell Out-File 등이 BOM 붙이는 경우 JSON.parse 실패 방지
  const text = fs.readFileSync(p, 'utf8');
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}
function readBuf(p) { return fs.readFileSync(p); }
// 1.36.144 (T-0117, 전수 실측): `--dry-run` 은 **등록된 전역 플래그**인데 많은 명령이 그냥 무시하고 썼다.
//   378 호출을 전후 트리 비교로 재니 183건이 썼고, 그중 **28건이 사용자 데이터**를 바꿨다 —
//   `session close --dry-run` 이 current-state·session-handoff·task-log 를 다시 쓰고,
//   `task add` · `decision add` · `rule add` · `plan add` · `lesson save` · `state start` · `ci init` 은 **실제로 추가**했다.
//   명령마다 dry-run 분기를 심으면 16개의 새 실수 자리가 생긴다. 그래서 **쓰기 시점 하나**에서 막는다:
//   dry-run 인데 쓰려 하면 그 자리에서 멈추고 무엇을 쓰려 했는지 말한다(조용히 쓰지도, 조용히 넘어가지도 않는다).
//   ⚠ 면제는 실행 중에만 의미가 있는 락/임시 파일로 한정한다. 캐시는 파생 상태여도 디스크에 남는
//     관측 가능한 변경이다 — dry-run 이 캐시를 남기면 "변경 없음" 이 거짓이 된다.
let _dryGuard = false;
//   ⚠ 1.36.146 (재검수 P1, 재현): 첫 면제 규칙은 `[\\/]cache[\\/]` 였다 — 경로 **어디에든**
//     `cache` 디렉토리가 있으면 면제돼, `C:/Users/me/cache/myproject/` 에 사는 프로젝트는
//     dry-run 가드가 **통째로 꺼졌다**(실측: `decision add --dry-run` 이 그대로 기록됨).
//     면제는 우리가 아는 실행 중 산출물(락/임시 파일)로만 한정한다.
const _DRY_EXEMPT_TAIL = /(\.lock$|\.tmp-\d+-\d+$)/;
//   1.36.154 (T-0117 재검수): cache 는 "사용자 데이터가 아니다"라는 이유로 면제했지만,
//   `session close --dry-run` 이 session-presence의 .host-salt·세션 레코드를 실제 생성했다.
//   dry-run 의 약속은 데이터 성격이 아니라 영속적 파일 변경 0건이므로 cache 면제를 두지 않는다.
//   ⚠ 한 번 `os.tmpdir()` 전체를 면제했다가 뺐다 — 그러면 **내 테스트가 전부 임시 디렉토리에 있어서**
//     실사용에서는 막히는데 계측만 죽는다(실측: 같은 프로브가 "가드 무력" 이라 보고). 가장 나쁜 조합이다.
//     면제는 leerness **자신이 만드는 임시 산출물**의 이름 규칙으로만 한정한다.
const _DRY_EXEMPT_OURS = /leerness-probe-\d+-\d+\.sh$/;
function _dryExempt(q) {
  const s = String(q);
  if (_DRY_EXEMPT_TAIL.test(s)) return true;
  if (_DRY_EXEMPT_OURS.test(s)) return true;
  return false;
}
function _dryCheck(p) {
  if (!_dryGuard) return;
  const s = String(p);
  if (_dryExempt(s)) return;
  throw Object.assign(new Error(`--dry-run 인데 쓰려고 했습니다: ${s}`), { code: 'E_DRY_RUN_WRITE', file: s });
}
//   1.36.146: 가드가 `writeUtf8`/`append`/`mkdirp` **세 함수만** 보고 있었다.
//     정적 열거: io 를 우회하는 `fs.*` 변이 호출이 **330건**(unlinkSync 15 · rmSync 85 · writeFileSync 125 …).
//     실측: `enforce remove --dry-run` 이 진짜 훅을 지우고, `release cleanup --apply --dry-run` 이 브랜치 50개를 지웠다.
//     330곳을 배선하면 330개의 새 실수 자리가 생긴다 — **프로세스 진입점에서 한 번** 막는다.
const _FS_MUTATORS = ['writeFileSync', 'appendFileSync', 'unlinkSync', 'rmSync', 'rmdirSync',
  'renameSync', 'copyFileSync', 'mkdirSync', 'chmodSync', 'utimesSync', 'symlinkSync', 'truncateSync'];
let _fsPatched = false;
function _patchFsForDryRun() {
  if (_fsPatched) return;
  _fsPatched = true;
  for (const name of _FS_MUTATORS) {
    const orig = fs[name];
    if (typeof orig !== 'function') continue;
    fs[name] = function (...a) {
      //   첫 인자가 대상 경로다(rename/copy 는 둘 다 본다).
      _dryCheck(a[0]);
      if ((name === 'renameSync' || name === 'copyFileSync' || name === 'symlinkSync') && a[1] !== undefined) _dryCheck(a[1]);
      return orig.apply(fs, a);
    };
  }
}
function setDryRunGuard(on) { _dryGuard = !!on; if (on) _patchFsForDryRun(); }
// File-descriptor based writers cannot be intercepted by the fs path mutator
// wrappers. Call this before opening a descriptor so --dry-run retains its
// process-wide zero-persistent-write contract.
function assertWriteAllowed(p) { _dryCheck(p); }
//   ⚠ `mkdirp` 은 가드하지 **않는다**. 한 번 넣었다가 부작용을 재서 뺀다 —
//     `_withLock` 이 락 디렉토리를 만드는 것까지 막혀 락 획득이 실패하고 **무보호 진행**으로 떨어졌다
//     (실측: `state start --dry-run` → "락 획득 실패 — 보호 없이 진행합니다"). 빈 디렉토리는 사용자 데이터가
//     아니고, 의미 있는 쓰기는 전부 `writeUtf8`/`append` 를 지나므로 거기서 막는 것으로 충분하다.
//   디렉토리 생성도 막는다 — 빈 디렉토리라도 dry-run 이 남기면 "변경 없음" 이 거짓이 된다.
//   ⚠ 단, **락 디렉토리는 예외**다. 한 번 전부 막았다가 `_withLock` 의 락 획득이 실패해
//     **무보호 진행**으로 떨어졌다(실측). 락은 `mkdirpRaw` 로 우회한다 — 인프라지 사용자 데이터가 아니다.
function mkdirp(p) { _dryCheck(path.join(String(p), '_')); fs.mkdirSync(p, { recursive: true }); }
function mkdirpRaw(p) { fs.mkdirSync(p, { recursive: true }); }
// 1.9.298 (UR-0038, 외부리뷰 3중수렴): 원자적 쓰기 — temp 파일에 기록 후 rename(원자 교체)으로 부분쓰기 손상 방지.
//   temp 이름은 .tmp-PID-SEQ 라 *.md glob 에 안 걸림. 실패 시 temp 정리.
let _writeSeq = 0;
// 1.36.50 (스토어 손상 클래스 전수 스윕): "손상 JSON 위에 유효 JSON 저장" = 클로버 시그니처.
//   개별 스토어(21곳+)를 각자 가드하는 대신 단일 진입점에서: 기존 파일이 JSON 파싱 불가이고 새 내용은 유효 JSON 이면
//   원본을 <file>.corrupt-<ts> 로 대피(rename) 후 저장 — 유실 0 · 흐름(handoff 등 수동 기록) 비차단.
//   명시 fail-closed 스토어(state/teams/toggles 등)는 상류에서 이미 거부하므로 여기 도달하지 않는다.
function _rescueCorruptJson(p, s) {
  if (!/\.json$/i.test(p) || !fs.existsSync(p)) return;
  try { JSON.parse(s); } catch { return; }          // 새 내용이 JSON 아니면 대상 아님
  let old;
  try { old = read(p); } catch { return; }
  try { JSON.parse(old); return; } catch {}          // 기존이 정상이면 통상 덮어쓰기
  // 1.36.54 (#8): 같은 ms 내 연속 대피의 백업명 충돌 방지 — pid+시퀀스 접미
  const bak = `${p}.corrupt-${Date.now()}-${process.pid}-${++_writeSeq}`;
  // 알림은 stderr — --json 명령의 stdout 단일-JSON 계약을 오염하지 않는다 (codex 스윕 B #1 실측)
  try { fs.renameSync(p, bak); console.error(`⚠ 손상 JSON 감지 — 원본 대피 후 저장: ${path.basename(bak)} (수동 복구용)`); } catch {}
}
function writeUtf8(p, s) {
  _dryCheck(p);
  // 1.36.65 (외부감사 F-08): 동일-내용 재기록 스킵 — 무변경 재설치/조정기의 mtime·diff churn 을 전역 해소.
  // 1.36.66 (8차 헌트 F13): 비교는 디코딩 텍스트가 아니라 "바이트 동일"로 — 손상 바이트(FF)/BOM 파일에
  //   유효 UTF-8 을 쓸 때 read() 의 BOM-strip·치환문자가 텍스트를 같게 보이게 해 정화 write 가 억제됐다.
  try { if (fs.existsSync(p) && fs.readFileSync(p).equals(Buffer.from(String(s), 'utf8'))) return; } catch {}
  mkdirp(path.dirname(p));
  _rescueCorruptJson(p, s);
  const tmp = `${p}.tmp-${process.pid}-${++_writeSeq}`;
  try {
    fs.writeFileSync(tmp, s, { encoding: 'utf8' });
    _renameWithRetry(tmp, p);
  } catch (e) {
    // 1.36.132 (검수 P2): 잠긴 tmp 는 한 번의 unlink 로는 안 지워져 `*.tmp-<pid>-<seq>` 가 영구 잔류했다.
    //   짧게 다시 시도한다(인덱서·백신이 새 파일을 잡는 실제 Windows 조건).
    for (let i = 0; i < 5; i++) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); break; } catch { _sleepMsSync(20 + i * 20); }
    }
    throw e;
  }
}
function _concurrentModification(p, backupFile) {
  const recovery = backupFile ? ` (복구 백업: ${backupFile})` : '';
  const e = new Error(`검사 후 파일이 변경되어 덮어쓰기를 거부했습니다: ${p}${recovery}`);
  e.code = 'E_CONCURRENT_MODIFICATION';
  e.file = p;
  if (backupFile) e.backupFile = backupFile;
  return e;
}
function _cleanupWriteArtifact(p) {
  let lastError = null;
  for (let i = 0; i < 5; i++) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); return null; } catch (e) { lastError = e; _sleepMsSync(20 + i * 20); }
  }
  return lastError || new Error(`임시 쓰기 아티팩트를 정리하지 못했습니다: ${p}`);
}
function _cleanupWriteScratch(p) {
  if (!p) return null;
  let lastError = null;
  for (let i = 0; i < 5; i++) {
    try { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true }); return null; } catch (e) { lastError = e; _sleepMsSync(20 + i * 20); }
  }
  return lastError || new Error(`임시 쓰기 디렉터리를 정리하지 못했습니다: ${p}`);
}
function _mutationIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    nlink: stat.nlink,
    mode: stat.mode,
  };
}
function _sameMutationIdentity(a, b) {
  return !!a && !!b && a.dev === b.dev && a.ino === b.ino;
}
function _readMutationIdentity(p) {
  const link = fs.lstatSync(p);
  if (link.isSymbolicLink()) {
    const e = new Error(`심볼릭 링크 대상은 자동 교체하지 않습니다: ${p}`);
    e.code = 'E_UNSAFE_LINK';
    throw e;
  }
  if (!link.isFile()) {
    const e = new Error(`일반 파일만 자동 교체할 수 있습니다: ${p}`);
    e.code = 'E_UNSAFE_FILE_TYPE';
    throw e;
  }
  return _mutationIdentity(link);
}
function _identityChanged(p, expected) {
  const current = _readMutationIdentity(p);
  if (!_sameMutationIdentity(current, expected) || current.nlink !== 1 || (current.mode & 0o222) === 0) {
    const e = _concurrentModification(p);
    e.expectedIdentity = expected;
    e.actualIdentity = current;
    throw e;
  }
  return current;
}
function _mutationRecoveryParent(p, expectedIdentity) {
  let dir = path.dirname(path.resolve(p));
  const volumeRoot = path.parse(dir).root;
  while (true) {
    const workspace = path.join(dir, '.leerness');
    try {
      if (fs.statSync(workspace).isDirectory() && fs.statSync(dir).dev === expectedIdentity.dev) {
        const recovery = path.join(workspace, 'archive', 'mutation-recovery');
        mkdirp(recovery);
        return recovery;
      }
    } catch {}
    if (dir === volumeRoot) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.dirname(p);
}
function _attachRecoveryArtifacts(e, candidates, expected, planned, targetPath) {
  const seen = new Set();
  const artifacts = [];
  for (const candidate of candidates) {
    if (!candidate || !candidate.path || seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    let stat;
    try { stat = fs.lstatSync(candidate.path); } catch { continue; }
    const artifact = {
      role: candidate.role,
      path: candidate.path,
      kind: stat.isDirectory() ? 'directory' : 'file',
    };
    if (stat.isFile()) {
      artifact.size = stat.size;
      try {
        const bytes = fs.readFileSync(candidate.path);
        artifact.content = bytes.equals(expected) ? 'expected-original'
          : (bytes.equals(planned) ? 'planned-replacement' : 'concurrent-or-unknown');
      } catch (readError) {
        artifact.content = 'unreadable';
        artifact.readError = readError.code || readError.message;
      }
    }
    artifacts.push(artifact);
  }
  if (!artifacts.length) return e;
  e.recoveryArtifacts = artifacts;
  const recovery = artifacts.find(a => a.path !== targetPath && a.content === 'concurrent-or-unknown')
    || artifacts.find(a => a.path !== targetPath && a.role === 'displaced-original')
    || artifacts.find(a => a.path !== targetPath && a.kind === 'file');
  if (recovery && !e.backupFile) e.backupFile = recovery.path;
  const detail = artifacts.map(a => `${a.role}=${a.path} (${a.content || a.kind})`).join(', ');
  if (!e.message.includes('복구 아티팩트:')) e.message = `${e.message} (복구 아티팩트: ${detail})`;
  return e;
}
// ReplaceFileW (via the inbox Windows PowerShell runtime) is the only portable
// primitive available to this zero-dependency package that atomically replaces
// the default stream while retaining the destination's ACLs and alternate data
// streams. A real backup path also lets the caller detect a change that landed
// in the final compare -> replace window and retain the displaced file object
// instead of attempting another inherently racy replacement.
function _replaceWindowsWithBackup(from, to, backup) {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = "$utf8 = New-Object System.Text.UTF8Encoding($false); [Console]::OutputEncoding = $utf8; $OutputEncoding = $utf8; $ErrorActionPreference='Stop'; try { [IO.File]::Replace($env:LEERNESS_REPLACE_FROM, $env:LEERNESS_REPLACE_TO, $env:LEERNESS_REPLACE_BACKUP) } catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; $win32 = ($e.HResult -band 0xFFFF); [Console]::Error.WriteLine(('LEERNESS_REPLACE_ERROR:{0}:{1}' -f $win32, $e.Message)); exit 1 }";
  let waited = 0;
  let attempts = 0;
  for (;;) {
    attempts++;
    const r = cp.spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
      env: {
        ...process.env,
        LEERNESS_REPLACE_FROM: from,
        LEERNESS_REPLACE_TO: to,
        LEERNESS_REPLACE_BACKUP: backup,
      },
    });
    if (!r.error && r.status === 0) return;
    const raw = r.error ? r.error.message : String(r.stderr || r.stdout || `exit ${r.status}`).trim();
    const marker = /LEERNESS_REPLACE_ERROR:(\d+):([\s\S]*)/.exec(raw);
    const win32Code = marker ? Number(marker[1]) : null;
    const detail = marker ? marker[2].trim() : raw;
    const transientSharing = win32Code === 32 || win32Code === 33;
    // Retry only a proven sharing/lock violation while ReplaceFileW has made
    // no observable progress. An existing backup or consumed source makes the
    // result uncertain, so the caller must preserve recovery data instead.
    const retrySafe = transientSharing && waited < 2000 && fs.existsSync(from) && !fs.existsSync(backup);
    if (!retrySafe) {
      const e = new Error(`Windows 메타데이터 보존 교체 실패: ${detail}`);
      e.code = (r.error && r.error.code) || 'E_ATOMIC_REPLACE';
      e.win32Code = win32Code;
      e.attempts = attempts;
      throw e;
    }
    const delay = Math.min(50 * (2 ** Math.min(attempts - 1, 3)), 400, 2000 - waited);
    _sleepMsSync(delay);
    waited += delay;
  }
}
// 1.36.177 (T-0022): compare-and-set binary write for mutators that must
// retain the original byte stream. The expected bytes are checked both before
// and immediately after preparing the temp file. Windows additionally uses a
// replacement backup to close the last compare -> replace race without losing
// ACLs/alternate streams. The displaced object remains as an explicit recovery
// artifact because an already-open Windows handle can write to it after our
// validation. Other platforms are rejected: Node's rename can
// replace a read-only inode and discard ownership, ACLs, xattrs, and hard-link
// identity, while Node exposes no portable metadata-preserving replacement.
function writeBufferIfUnchanged(p, expectedValue, value, opts = {}) {
  _dryCheck(p);
  if (process.platform !== 'win32') {
    const e = new Error(`메타데이터 보존 원자 교체를 지원하지 않는 플랫폼입니다: ${process.platform}`);
    e.code = 'E_METADATA_PRESERVATION_UNAVAILABLE';
    throw e;
  }
  const expected = Buffer.isBuffer(expectedValue) ? expectedValue : Buffer.from(expectedValue);
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const expectedIdentity = opts.expectedIdentity || _readMutationIdentity(p);
  _identityChanged(p, expectedIdentity);
  let current = fs.readFileSync(p);
  if (!current.equals(expected)) throw _concurrentModification(p);
  if (current.equals(buf)) return { unchanged: true, recoveryArtifacts: [] };
  mkdirp(path.dirname(p));
  const mode = expectedIdentity.mode & 0o777;
  // mkdtemp is an exclusive namespace reservation. Keeping next/before
  // inside it prevents a parallel agent from pre-creating a predictable backup
  // name that File.Replace would otherwise overwrite.
  const recoveryParent = _mutationRecoveryParent(p, expectedIdentity);
  let scratch = fs.mkdtempSync(path.join(recoveryParent, `.leerness-write-${process.pid}-`));
  const tmp = path.join(scratch, 'next');
  let backup = null;
  let replaceAttempted = false;
  try {
    fs.writeFileSync(tmp, buf, { flag: 'wx', mode });
    _identityChanged(p, expectedIdentity);
    current = fs.readFileSync(p);
    if (!current.equals(expected)) throw _concurrentModification(p);
    backup = path.join(scratch, 'before');
    replaceAttempted = true;
    _replaceWindowsWithBackup(tmp, p, backup);
    if (fs.existsSync(tmp)) {
      const e = new Error(`Windows 교체가 성공을 보고했지만 replacement source가 남았습니다: ${tmp}`);
      e.code = 'E_ATOMIC_REPLACE_UNCERTAIN';
      throw e;
    }
    const replaced = fs.readFileSync(backup);
    const displacedIdentity = _readMutationIdentity(backup);
    const targetNow = fs.readFileSync(p);
    if (!replaced.equals(expected) || !targetNow.equals(buf)
        || !_sameMutationIdentity(displacedIdentity, expectedIdentity)
        || displacedIdentity.nlink !== 1) {
      throw _concurrentModification(p, backup);
    }
    // Keep the displaced file object intentionally. A normal Windows writer
    // may already hold a delete-sharing handle and write to this object after
    // our validation; removing it here would silently discard that late edit.
    // Retention also preserves hard-link/ADS changes that cannot be proven by
    // comparing the unnamed stream alone. Callers must surface backupFile.
    return {
      backupFile: backup,
      recoveryArtifacts: [{ role: 'displaced-original', path: backup, kind: 'file', size: replaced.length, content: 'expected-original' }],
    };
  } catch (e) {
    const cleanupError = !replaceAttempted ? _cleanupWriteArtifact(tmp) : null;
    const scratchCleanupError = !replaceAttempted && !cleanupError ? _cleanupWriteScratch(scratch) : null;
    if (cleanupError || scratchCleanupError) {
      e.cleanupError = (cleanupError || scratchCleanupError).message;
    }
    _attachRecoveryArtifacts(e, replaceAttempted ? [
      { role: 'live-target', path: p },
      { role: 'planned-source', path: tmp },
      { role: 'displaced-original', path: backup },
    ] : [
      ...(cleanupError ? [{ role: 'cleanup-failed-source', path: tmp }] : []),
      ...(cleanupError || scratchCleanupError ? [{ role: 'cleanup-failed-scratch', path: scratch }] : []),
    ], expected, buf, p);
    throw e;
  }
}
// 1.36.132 (P1, 실측): Windows 에서 **락을 제대로 잡고 있어도** 원자적 교체가 실패한다 —
//   읽기는 락을 잡지 않으므로, 다른 프로세스가 대상 파일을 연 채로 있으면 rename 이 EPERM/EACCES 를 낸다.
//   실측: 32 프로세스 동시 `task add` → EPERM 3건, 그 3행이 통째로 유실되고 자식은 exit 1 로 죽었다
//   (락 획득 결함을 고친 뒤에도 남았다 — 원인이 다르다).
//   전부 **찰나의 상태**라 짧게 재시도하면 사라진다. 다른 코드(권한 없음 등)는 즉시 던진다.
const _RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
function _sleepMsSync(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* 최후엔 그냥 다시 시도 */ } }
function _renameWithRetry(from, to) {
  let waited = 0;
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; }
    catch (e) {
      if (!_RENAME_RETRY_CODES.has(e.code) || waited >= 2000) throw e;
      const d = Math.min(5 + i * 10, 80);
      _sleepMsSync(d); waited += d;
    }
  }
}
function append(p, s) { _dryCheck(p); mkdirp(path.dirname(p)); fs.appendFileSync(p, s, 'utf8'); }
function rel(root, p) { return path.relative(root, p).replace(/\\/g, '/') || '.'; }

function _hardLinkIdentityEqual(a, b) {
  return !!(a && b)
    && String(a.dev) === String(b.dev)
    && String(a.ino) === String(b.ino);
}

function _lstatState(p) {
  try { return { exists: true, stat: fs.lstatSync(p), error: null }; }
  catch (error) {
    if (error && error.code === 'ENOENT') return { exists: false, stat: null, error: null };
    return { exists: null, stat: null, error };
  }
}

// A failed alias detach means the caller must not observe success. Remove the
// just-installed canonical name only when both names still identify the exact
// committed inode and its bytes are unchanged. Existing-file callers can then
// restore their captured predecessor; create callers leave the canonical path
// absent. A random quarantine rename is the last exact-path fallback when a
// platform refuses both unlink spellings.
function _rollbackCommittedHardLink(alias, live, expected) {
  const liveState = _lstatState(live);
  if (liveState.exists === false) return { ok: true, canonicalState: 'absent', artifact: null };
  const aliasState = _lstatState(alias);
  if (liveState.exists !== true || aliasState.exists !== true
    || liveState.stat.isSymbolicLink() || !liveState.stat.isFile()
    || aliasState.stat.isSymbolicLink() || !aliasState.stat.isFile()
    || !_hardLinkIdentityEqual(liveState.stat, aliasState.stat)) {
    return { ok: false, canonicalState: 'unknown', artifact: null, error: liveState.error || aliasState.error || null };
  }
  if (expected) {
    try {
      if (!fs.readFileSync(live).equals(expected) || !fs.readFileSync(alias).equals(expected)) {
        return { ok: false, canonicalState: 'changed', artifact: null, error: null };
      }
    } catch (error) {
      return { ok: false, canonicalState: 'unknown', artifact: null, error };
    }
  }

  let removalError = null;
  try { fs.unlinkSync(live); }
  catch (error) { removalError = error; }
  if (_lstatState(live).exists === true) {
    try { fs.rmSync(live, { force: true }); }
    catch (error) { removalError = removalError || error; }
  }
  if (_lstatState(live).exists === true) {
    const quarantine = `${live}.rollback-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
    try {
      fs.renameSync(live, quarantine);
      try { fs.unlinkSync(quarantine); }
      catch {
        try { fs.rmSync(quarantine, { force: true }); } catch {}
      }
      const postRename = _lstatState(live);
      return postRename.exists === false
        ? { ok: true, canonicalState: 'absent', artifact: _lstatState(quarantine).exists === true ? quarantine : null }
        : { ok: false, canonicalState: 'present', artifact: quarantine, error: removalError };
    } catch (error) {
      removalError = removalError || error;
    }
  }
  const after = _lstatState(live);
  if (after.exists === false) return { ok: true, canonicalState: 'absent', artifact: null };
  if (after.exists === true && !after.stat.isSymbolicLink() && after.stat.isFile()
    && Number(after.stat.nlink) === 1
    && (!expected || fs.readFileSync(live).equals(expected))) {
    return { ok: true, canonicalState: 'detached', artifact: null };
  }
  return { ok: false, canonicalState: after.exists === true ? 'present' : 'unknown', artifact: null, error: after.error || removalError };
}

// An exclusive hard-link install is useful when rename-without-replace is not
// available, but the live inode must not depend on successfully unlinking the
// prepared alias. If unlink fails after commit, atomically replace that alias
// with a different inode; this drops the live inode back to nlink=1 even when
// the harmless replacement artifact cannot itself be removed.
function detachCommittedHardLink(aliasPath, livePath, expectedBytes) {
  const alias = path.resolve(aliasPath);
  const live = path.resolve(livePath);
  let firstCleanupError = null;
  try {
    fs.unlinkSync(alias);
  } catch (error) {
    firstCleanupError = error;
    // Some transient/platform wrappers fail unlink but permit the equivalent
    // exact-path removal. This is only the random prepared alias, never user data.
    try { fs.rmSync(alias, { force: true }); } catch {}
    if (fs.existsSync(alias)) {
      const detacher = `${alias}.detach-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
      let detacherExists = false;
      try {
        fs.writeFileSync(detacher, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
        detacherExists = true;
        // Replacing the alias unlinks it from the committed inode as part of
        // rename, while leaving the live pathname and its bytes untouched.
        fs.renameSync(detacher, alias);
        detacherExists = false;
      } catch (detachError) {
        try { if (detacherExists) fs.rmSync(detacher, { force: true }); } catch {}
        const expected = Buffer.isBuffer(expectedBytes) ? expectedBytes : null;
        const rollback = _rollbackCommittedHardLink(alias, live, expected);
        // Another actor may have detached the alias between our failed rename
        // and rollback probe. A valid nlink=1 live file already satisfies the
        // commit contract, so this narrow state remains a successful recovery.
        if (rollback.ok && rollback.canonicalState === 'detached') {
          return { cleanupRecovered: true, cleanupArtifact: fs.existsSync(alias) ? alias : null };
        }
        const failure = new Error(`committed hard-link alias could not be detached: ${alias}`);
        failure.code = 'E_HARDLINK_DETACH_FAILED';
        failure.cleanupError = (detachError && detachError.message) || String(detachError);
        failure.canonicalRolledBack = rollback.ok && rollback.canonicalState === 'absent';
        failure.rollbackState = rollback.canonicalState;
        failure.rollbackArtifact = rollback.artifact || null;
        failure.rollbackError = rollback.error && (rollback.error.message || String(rollback.error));
        failure.cause = firstCleanupError;
        throw failure;
      }
      // The path now names an unrelated empty inode. Failure to remove this
      // cleanup artifact is non-fatal and cannot poison the committed file.
      try { fs.rmSync(alias, { force: true }); } catch {}
    }
  }
  let stat;
  try { stat = fs.lstatSync(live); }
  catch (error) {
    const failure = new Error(`committed file disappeared while detaching its prepared alias: ${live}`);
    failure.code = 'E_HARDLINK_DETACH_FAILED';
    failure.cause = error;
    throw failure;
  }
  const expected = Buffer.isBuffer(expectedBytes) ? expectedBytes : null;
  if (stat.isSymbolicLink() || !stat.isFile() || Number(stat.nlink) !== 1
      || (expected && !fs.readFileSync(live).equals(expected))) {
    const failure = new Error(`committed file failed post-detach validation: ${live}`);
    failure.code = 'E_HARDLINK_DETACH_FAILED';
    failure.cleanupError = firstCleanupError && firstCleanupError.message;
    throw failure;
  }
  return {
    cleanupRecovered: !!firstCleanupError,
    cleanupArtifact: fs.existsSync(alias) ? alias : null,
  };
}

module.exports = { log, ok, warn, fail, failJson, setQuiet, today, now, absRoot, exists, read, readBuf, mkdirp, writeUtf8, writeBufferIfUnchanged, append, rel, setDryRunGuard, assertWriteAllowed, mkdirpRaw, detachCommittedHardLink };
