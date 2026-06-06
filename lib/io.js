// lib/io.js — 콘솔 출력 + 타임스탬프 + 파일 I/O 기반 프리미티브 (단일출처).
// 1.9.382 (UR-0025, 큰 핸들러 모듈화 토대): log/ok/warn/fail/today/now 분리.
// 1.9.383 (UR-0025): fs 프리미티브(read/readBuf/writeUtf8/exists/mkdirp/append/rel/absRoot) 추가.
//   목적: 향후 핸들러를 별도 lib 모듈로 분리할 때 공유 가능한 I/O 프리미티브 제공(harness 만 갖던 것 → 공용화).
'use strict';
const fs = require('fs');
const path = require('path');

function log(s = '') { console.log(s); }
function ok(s) { log('✓ ' + s); }
function warn(s) { log('⚠ ' + s); }
// fail() 은 오류 신호 → exit code 1 설정 (CI/MCP/에이전트가 실패를 성공으로 오판 방지, UR-0045).
function fail(s) { log('✗ ' + s); process.exitCode = 1; }
// 1.9.398 (6번째 외부평가/codex P1-C, UR-0099): --json 모드 에러는 구조화 출력 — AI 에이전트가 에러 경로에서 JSON.parse 실패하지 않도록.
//   jsonMode 면 {ok:false,error,code} + exit1, 아니면 사람용 fail(). 양쪽 exit code 1 일관.
function failJson(jsonMode, code, msg) {
  if (jsonMode) { log(JSON.stringify({ ok: false, error: msg, code }, null, 2)); process.exitCode = 1; }
  else fail(msg);
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
function writeUtf8(p, s) {
  mkdirp(path.dirname(p));
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

module.exports = { log, ok, warn, fail, failJson, today, now, absRoot, exists, read, readBuf, mkdirp, writeUtf8, append, rel };
