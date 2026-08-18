// lib/io.js — 콘솔 출력 + 타임스탬프 + 파일 I/O 기반 프리미티브 (단일출처).
// 1.9.382 (UR-0025, 큰 핸들러 모듈화 토대): log/ok/warn/fail/today/now 분리.
// 1.9.383 (UR-0025): fs 프리미티브(read/readBuf/writeUtf8/exists/mkdirp/append/rel/absRoot) 추가.
//   목적: 향후 핸들러를 별도 lib 모듈로 분리할 때 공유 가능한 I/O 프리미티브 제공(harness 만 갖던 것 → 공용화).
'use strict';
const fs = require('fs');
const path = require('path');

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
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }
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
function append(p, s) { mkdirp(path.dirname(p)); fs.appendFileSync(p, s, 'utf8'); }
function rel(root, p) { return path.relative(root, p).replace(/\\/g, '/') || '.'; }

module.exports = { log, ok, warn, fail, failJson, setQuiet, today, now, absRoot, exists, read, readBuf, mkdirp, writeUtf8, append, rel };
