#!/usr/bin/env node
'use strict';

// 1.35.13 (UR-0014): 3-tier 테스트의 중간 티어 — critical-path 행위(behavioral) 스위트.
//   test:fast (smoke.js) — 명령이 크래시 없이 도는가만 clean 프로젝트에서 확인, <1분. 개발 루프.
//   test:core (이 파일)  — 플래그십(verify-claim/gate/contract/scan)이 *적대적* 입력을 실제로 거부/통과하는가, ~1-2분. pre-commit / 빠른 CI.
//   test (e2e.js)        — 전체 384 케이스, ~12분, 릴리스 게이트.
//   smoke 는 "명령이 도는가"만 본다. 이 core 는 "가치제안(거짓완료·시크릿·계약위반 차단)이 실제로 작동하는가"를 행위로 검증한다.
//   전체 e2e.js 를 건드리지 않는 별도 파일 — 릴리스 게이트 회귀 위험 0. 실패 시 exit 1 (CI 친화). 사용: npm run test:core

const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
process.env.LEERNESS_OFFLINE = process.env.LEERNESS_OFFLINE || '1';
const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
let failed = 0, total = 0; const t0 = Date.now();

function run(dir, args) { return cp.spawnSync(process.execPath, [CLI, ...args, '--path', dir], { encoding: 'utf8', timeout: 40000 }); }
function assert(label, cond) { total++; process.stdout.write(`${cond ? '✓' : '✗'} ${label}\n`); if (!cond) failed++; }
function fresh() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-core-')); cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 }); return d; }

console.log('# leerness core (test:core) — flagship behavioral guarantees');

// (1) verify-claim: 거짓완료(없는 파일) 거부, 정직완료 통과
{
  const d = fresh();
  run(d, ['task', 'add', 'ghost']);
  run(d, ['task', 'update', 'T-0002', '--status', 'done', '--evidence', 'ghost.js implemented; 5/5 passed']);
  assert('verify-claim rejects false-done (missing file → exit 1)', run(d, ['verify-claim', 'T-0002']).status === 1);
  fs.writeFileSync(path.join(d, 'real.js'), 'module.exports = { f: () => 1 };\n');
  run(d, ['task', 'add', 'real']);
  run(d, ['task', 'update', 'T-0003', '--status', 'done', '--evidence', 'real.js implemented']);
  assert('verify-claim passes truthful done (exit 0)', run(d, ['verify-claim', 'T-0003']).status === 0);
  fs.rmSync(d, { recursive: true, force: true });
}

// (2) verify-claim: 부풀린 테스트 카운트 거부 (1.35.7/9 플래그십)
{
  const d = fresh();
  fs.writeFileSync(path.join(d, 'x.js'), 'module.exports = { f: () => 1 };\n');
  fs.writeFileSync(path.join(d, 'x.test.js'), 'test();\ntest();\n');
  run(d, ['task', 'add', 'x']);
  run(d, ['task', 'update', 'T-0002', '--status', 'done', '--evidence', 'x.js, x.test.js; 3/3 passed']);
  assert('verify-claim rejects inflated pass (claim 3/3 vs run 2/2 → exit 1)', run(d, ['verify-claim', 'T-0002', '--run-tests', '--test-cmd', 'echo Tests: 2 passed, 2 total']).status === 1);
  fs.rmSync(d, { recursive: true, force: true });
}

// (3) gate: 클린 통과 / 커밋 시크릿 차단 / --claims 거짓완료 차단
{
  const d = fresh();
  run(d, ['handoff', '']);
  assert('gate clean project → exit 0', run(d, ['gate', '.']).status === 0);
  fs.writeFileSync(path.join(d, 'leak.js'), 'const k = "AKIAJQXMP7RZ2KL9WXYZ";\nmodule.exports = k;\n');
  assert('gate blocks committed secret → exit 1', run(d, ['gate', '.']).status === 1);
  fs.rmSync(path.join(d, 'leak.js'), { force: true });
  run(d, ['task', 'add', 'ghost']);
  run(d, ['task', 'update', 'T-0002', '--status', 'done', '--evidence', 'ghost.js implemented; 5/5 passed']);
  assert('gate --claims blocks false-done → exit 1', run(d, ['gate', '.', '--claims']).status === 1);
  fs.rmSync(d, { recursive: true, force: true });
}

// (4) contract verify: 누락 함수 감지 / 충족 통과
{
  const d = fresh();
  fs.writeFileSync(path.join(d, 's.md'), '- charge()\n');
  fs.writeFileSync(path.join(d, 'miss.js'), 'module.exports = { other: 1 };\n');
  assert('contract catches missing function → exit 1', run(d, ['contract', 'verify', path.join(d, 's.md'), path.join(d, 'miss.js')]).status === 1);
  fs.writeFileSync(path.join(d, 'ok.js'), 'function charge(){}\nmodule.exports = { charge };\n');
  assert('contract passes when satisfied → exit 0', run(d, ['contract', 'verify', path.join(d, 's.md'), path.join(d, 'ok.js')]).status === 0);
  fs.rmSync(d, { recursive: true, force: true });
}

// (5) scan secrets: 커밋 시크릿 차단 / 클린 통과
{
  const d = fresh();
  assert('scan secrets clean → exit 0', run(d, ['scan', 'secrets', '.']).status === 0);
  fs.writeFileSync(path.join(d, 'k.js'), 'const k = "AKIAJQXMP7RZ2KL9WXYZ";\n');
  assert('scan secrets committed key → exit 1', run(d, ['scan', 'secrets', '.']).status === 1);
  fs.rmSync(d, { recursive: true, force: true });
}

const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nCore result: ${total - failed}/${total} passed · ${dur}s`);
if (failed > 0) process.exit(1);
