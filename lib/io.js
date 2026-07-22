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
    if (!_jsonErrEmitted && t && (t[0] === '{' || t[0] === '[')) { try { JSON.parse(t); console.log(s); _stdoutWrote = true; return; } catch {} }
    console.error(s); return;
  }
  console.log(s); _stdoutWrote = true;
}
function ok(s) { log('✓ ' + s); }
function warn(s) { log('⚠ ' + s); }
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
let _latchArgv = null;         // 래치는 argv 정체성 스코프 — 새 명령(REPL/인프로세스 테스트가 argv 교체) 시 자동 해제
// stdout 기록 추적은 스트림 레벨 — 일부 명령(audit 등)이 process.stdout.write 를 직접 캡처/사용해 log() 를 우회한다.
//   모듈 로드 시 1회 투명 래핑: 이후 어떤 경로(직접 write 포함)로든 stdout 에 쓰면 exit 폴백이 이중 JSON 을 내지 않는다.
{
  const _rawWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function (...a) { _stdoutWrote = true; return _rawWrite(...a); };
}
function _argvJsonMode() { try { return process.argv.includes('--json'); } catch { return false; } }
function _unlatchIfNewCmd() {
  if ((_jsonErrEmitted || _failLatched) && _latchArgv !== process.argv) { _jsonErrEmitted = false; _failLatched = false; _firstFail = null; _quiet = false; _latchArgv = null; }
}
function fail(s) {
  _unlatchIfNewCmd();
  if (_argvJsonMode()) {
    if (_firstFail == null) _firstFail = s;
    _failLatched = true; _latchArgv = process.argv;
    console.error('✗ ' + s);
    if (!_exitHooked) {
      _exitHooked = true;
      // 1.36.54 (#7b): 최종 exit 이 0(명령이 회복)이면 폴백 오류 JSON 을 내지 않는다 — 성공 exit 에 ok:false 모순 방지
      process.on('exit', (code) => { if (code !== 0 && _failLatched && !_stdoutWrote && _firstFail != null) console.log(JSON.stringify({ ok: false, error: _firstFail, code: 'error' }, null, 2)); });
    }
    process.exitCode = 1; return;
  }
  console.log('✗ ' + s); process.exitCode = 1;  // quiet 무시(오류는 항상 노출)
}
// 1.9.398 (6번째 외부평가/codex P1-C, UR-0099): --json 모드 에러는 구조화 출력 — AI 에이전트가 에러 경로에서 JSON.parse 실패하지 않도록.
//   jsonMode 면 {ok:false,error,code} + exit1, 아니면 사람용 fail(). 양쪽 exit code 1 일관.
function failJson(jsonMode, code, msg) {
  _unlatchIfNewCmd();
  if (jsonMode) {
    if (!_jsonErrEmitted) { console.log(JSON.stringify({ ok: false, error: msg, code }, null, 2)); _jsonErrEmitted = true; _stdoutWrote = true; _failLatched = true; _latchArgv = process.argv; }
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
    fs.renameSync(tmp, p);
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}
function append(p, s) { mkdirp(path.dirname(p)); fs.appendFileSync(p, s, 'utf8'); }
function rel(root, p) { return path.relative(root, p).replace(/\\/g, '/') || '.'; }

module.exports = { log, ok, warn, fail, failJson, setQuiet, today, now, absRoot, exists, read, readBuf, mkdirp, writeUtf8, append, rel };
