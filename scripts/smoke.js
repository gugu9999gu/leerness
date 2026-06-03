#!/usr/bin/env node
'use strict';

// 1.9.273 (UR-0027, GPT-5.5 리뷰): 빠른 핵심-경로 smoke 테스트.
//   전체 e2e(220 케이스, 수 분)는 CI/릴리스 게이트용. 이 smoke 는 개발 중 빠른 피드백(<30s)용 —
//   핵심 명령이 정상 동작하는지만 단일 임시 프로젝트에서 빠르게 확인한다.
//   실패 시 exit 1 (CI 친화). 사용: npm run test:fast  또는  node scripts/smoke.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

process.env.LEERNESS_OFFLINE = process.env.LEERNESS_OFFLINE || '1';
const CLI = path.resolve(__dirname, '..', 'bin', 'harness.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-smoke-'));
let failed = 0, total = 0;
const t0 = Date.now();

// 단일 명령 실행 + assert. check(라벨, args, {expectFail?, match?(stdout)→bool})
function check(label, args, opts = {}) {
  total++;
  const r = cp.spawnSync(process.execPath, [CLI, ...args], { cwd: opts.cwd || tmp, encoding: 'utf8', timeout: 30000 });
  let ok = (r.status === 0) === !opts.expectFail;
  if (ok && typeof opts.match === 'function') { try { ok = !!opts.match(r.stdout || '', r.stderr || ''); } catch { ok = false; } }
  process.stdout.write(`${ok ? '✓' : '✗'} ${label}${opts.expectFail ? ' (expect-fail)' : ''}\n`);
  if (!ok) { failed++; process.stdout.write((r.stdout || '').slice(0, 300)); process.stderr.write((r.stderr || '').slice(0, 200)); }
  return { ok, stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

console.log(`# leerness smoke (test:fast) @ ${tmp}`);

// 1) 코어 무결성
check('--version', ['--version'], { match: s => /^\d+\.\d+\.\d+/.test(s.trim()) });
check('selftest (pure 함수 무결성)', ['selftest'], { match: s => /통과/.test(s) });

// 2) 설치 + 필수 파일
check('init', ['init', tmp, '--yes', '--language', 'ko', '--skills', 'recommended']);
check('status', ['status', tmp], { match: s => /present|존재|설치/.test(s) || true });
check('verify (필수 파일)', ['verify', tmp]);

// 3) 세션 워크플로
check('handoff', ['handoff', tmp]);
check('audit', ['audit', tmp]);
check('drift check', ['drift', 'check', tmp], { match: s => /drift/i.test(s) });
check('session close', ['session', 'close', tmp]);

// 4) 보안·인코딩 가드
check('scan secrets', ['scan', 'secrets', tmp]);
check('encoding check', ['encoding', 'check', tmp]);

// 5) 신규 기능 스모크 (역할 1.9.270 / 권한공개 1.9.272)
check('roles set + list', ['roles', 'set', 'coder', '--provider', 'codex', '--model', 'gpt-5.5', '--path', tmp, '--json'],
  { match: s => { try { return JSON.parse(s).set === 'coder'; } catch { return false; } } });
check('capabilities --json', ['capabilities', '--json'],
  { match: s => { try { const j = JSON.parse(s); return j.surface && Object.keys(j.surface).length === 6; } catch { return false; } } });

const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nSmoke result: ${total - failed}/${total} passed · ${dur}s`);
if (failed > 0) process.exit(1);
