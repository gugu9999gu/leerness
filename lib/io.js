// lib/io.js — 콘솔 출력 + 타임스탬프 기반 프리미티브 (단일출처).
// 1.9.382 (UR-0025, 큰 핸들러 모듈화 토대): bin/harness.js 인라인 log/ok/warn/fail/today/now 를 분리.
//   목적: 향후 핸들러를 별도 lib 모듈로 분리할 때 공유 가능한 출력 프리미티브 제공(harness 만 갖던 것 → 공용화).
//   부작용: log/ok/warn 은 stdout, fail 은 stdout + process.exitCode=1. today/now 는 순수(시간 의존).
'use strict';

function log(s = '') { console.log(s); }
function ok(s) { log('✓ ' + s); }
function warn(s) { log('⚠ ' + s); }
// fail() 은 오류 신호 → exit code 1 설정 (CI/MCP/에이전트가 실패를 성공으로 오판 방지, UR-0045).
//   process.exit 즉시종료가 아니라 exitCode 설정(후속 출력/정리 보존, main 종료 wrapper 가 강제).
function fail(s) { log('✗ ' + s); process.exitCode = 1; }
function today() { return new Date().toISOString().slice(0, 10); }
function now() { return new Date().toISOString(); }

module.exports = { log, ok, warn, fail, today, now };
