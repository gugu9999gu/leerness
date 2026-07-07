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

// (5) scan secrets: 커밋 시크릿 차단 / 클린 통과 + 하드코딩 자격증명 복합/JSON키 FN (1.35.14)
{
  const d = fresh();
  assert('scan secrets clean → exit 0', run(d, ['scan', 'secrets', '.']).status === 0);
  fs.writeFileSync(path.join(d, 'k.js'), 'const k = "AKIAJQXMP7RZ2KL9WXYZ";\n');
  assert('scan secrets committed key → exit 1', run(d, ['scan', 'secrets', '.']).status === 1);
  fs.rmSync(path.join(d, 'k.js'), { force: true });
  // 1.35.14 FN #1: 복합 env 키(DB_PASSWORD=)를 탐지해야 함 (기존 선두 \b 는 '_' 앞에서 미탐)
  fs.writeFileSync(path.join(d, 'app.env'), 'DB_PASSWORD=Sup3rSecretValue99\n');
  assert('scan secrets catches compound env key (DB_PASSWORD=) → exit 1', run(d, ['scan', 'secrets', '.']).status === 1);
  fs.rmSync(path.join(d, 'app.env'), { force: true });
  // 1.35.14 FN #2: JSON 따옴표-키("db_password": "…")를 탐지해야 함
  fs.writeFileSync(path.join(d, 'cfg.json'), '{ "db_password": "Xk9mP2qL7vR4nT8wZ0" }\n');
  assert('scan secrets catches JSON quoted key → exit 1', run(d, ['scan', 'secrets', '.']).status === 1);
  fs.rmSync(path.join(d, 'cfg.json'), { force: true });
  // 1.35.14 FP 안전: 사전 단어 값("secret":"required")은 requireSecretLike 로 억제 → clean
  fs.writeFileSync(path.join(d, 'schema.json'), '{ "secret": "required", "password": "hashed" }\n');
  assert('scan secrets keeps dictionary-word schema clean → exit 0', run(d, ['scan', 'secrets', '.']).status === 0);
  fs.rmSync(path.join(d, 'schema.json'), { force: true });
  // 1.35.14 A: Django SECRET_KEY = "…" 탐지 (quoted 키워드 확장)
  fs.writeFileSync(path.join(d, 'settings.py'), 'SECRET_KEY = "n7zU4lYq8mP2rC5tV0bX9aQ1"\n');
  assert('scan secrets catches Django SECRET_KEY → exit 1', run(d, ['scan', 'secrets', '.']).status === 1);
  fs.rmSync(path.join(d, 'settings.py'), { force: true });
  // 1.35.14 B: ENCRYPTED PRIVATE KEY 변종 탐지
  fs.writeFileSync(path.join(d, 'id.key'), '-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIF\n-----END ENCRYPTED PRIVATE KEY-----\n');
  assert('scan secrets catches ENCRYPTED PRIVATE KEY → exit 1', run(d, ['scan', 'secrets', '.']).status === 1);
  fs.rmSync(path.join(d, 'id.key'), { force: true });
  // 1.35.14 C: 로컬-개발 DB 기본자격(postgres:postgres) 은 clean (docker-compose FP 차단)
  fs.writeFileSync(path.join(d, 'compose.yml'), 'DATABASE_URL: postgres://postgres:postgres@localhost/app\n');
  assert('scan secrets keeps local DB defaults clean → exit 0', run(d, ['scan', 'secrets', '.']).status === 0);
  fs.rmSync(d, { recursive: true, force: true });
}

// (6) encoding check: 순수-ASCII .bat clean(FP 차단) / Korean mojibake .cmd 탐지(FN, .cmd 스캔) (1.35.15)
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-enc-'));
  // 순수-ASCII .bat(@echo off, chcp 없음)은 CP949 오손 위험이 없어 clean 이어야 함(이전엔 무조건 실패시키던 FP)
  fs.writeFileSync(path.join(d, 'ascii.bat'), '@echo off\r\necho hello world\r\n', 'latin1');
  assert('encoding: pure-ASCII .bat clean (no false chcp warning) → exit 0', cp.spawnSync(process.execPath, [CLI, 'encoding', 'check', d], { encoding: 'utf8', timeout: 40000 }).status === 0);
  // Korean mojibake(CP949 0xC7 0xD1) .cmd 는 이제 스캔되어 탐지되어야 함(이전엔 .cmd 미스캔 FN)
  fs.writeFileSync(path.join(d, 'korean.cmd'), Buffer.from([0x40, 0x65, 0x63, 0x68, 0x6f, 0x20, 0xC7, 0xD1, 0x0d, 0x0a]));
  assert('encoding: Korean mojibake .cmd flagged (.cmd now scanned) → exit 1', cp.spawnSync(process.execPath, [CLI, 'encoding', 'check', d], { encoding: 'utf8', timeout: 40000 }).status === 1);
  fs.rmSync(d, { recursive: true, force: true });
}

// (7) env encoding-check --apply: CP949 .ps1 을 손상시키지 않고(BOM만 붙이는 파괴 차단) 유효 UTF-8 .ps1 만 BOM 추가 (1.35.15 codex #4 DESTRUCTIVE)
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-apply-'));
  // CP949 본문(Write-Host "안녕", 안=BE C8 녕=B3 E7) — --apply 가 BOM 만 붙이면 손상되므로 skip 되어 파일이 그대로여야 함
  const cp949 = Buffer.concat([Buffer.from('Write-Host "', 'latin1'), Buffer.from([0xBE, 0xC8, 0xB3, 0xE7]), Buffer.from('"\r\n', 'latin1')]);
  fs.writeFileSync(path.join(d, 'cp949.ps1'), cp949);
  cp.spawnSync(process.execPath, [CLI, 'env', 'encoding-check', '--apply', '--path', d], { encoding: 'utf8', timeout: 40000 });
  const after = fs.readFileSync(path.join(d, 'cp949.ps1'));
  assert('encoding --apply: CP949 .ps1 NOT mutated (no destructive BOM-on-CP949)', after.equals(cp949) && !(after[0] === 0xEF && after[1] === 0xBB && after[2] === 0xBF));
  // 유효 UTF-8 .ps1(한글, no BOM)은 정당하게 BOM 추가되어야 함
  fs.writeFileSync(path.join(d, 'utf8.ps1'), Buffer.from('Write-Host "안녕"\r\n', 'utf8'));
  cp.spawnSync(process.execPath, [CLI, 'env', 'encoding-check', '--apply', '--path', d], { encoding: 'utf8', timeout: 40000 });
  const u = fs.readFileSync(path.join(d, 'utf8.ps1'));
  const uValid = Buffer.from(u.toString('utf8'), 'utf8').equals(u);
  assert('encoding --apply: valid-UTF-8 .ps1 gets BOM (still valid)', u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF && uValid);
  fs.rmSync(d, { recursive: true, force: true });
}

const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nCore result: ${total - failed}/${total} passed · ${dur}s`);
if (failed > 0) process.exit(1);
