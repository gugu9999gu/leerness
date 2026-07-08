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

// (8) lazy detect: 안티-치트 우회/FP 가드 (1.35.16)
{
  const BT = String.fromCharCode(96);
  const jget = (d) => { const r = run(d, ['lazy', 'detect', '--json']); try { return JSON.parse(r.stdout); } catch { return null; } };
  const hasK = (j, k) => !!(j && j.findings.some(f => f.kind === k));
  // FP: cargo test 기록 → no_test_run 오탐 아님 (비-JS 러너 인식)
  {
    const d = fresh();
    run(d, ['task', 'add', 'rust']); run(d, ['task', 'update', 'T-0002', '--status', 'done', '--evidence', 'src/lib.rs done']);
    fs.appendFileSync(path.join(d, '.harness/review-evidence.md'), '\n```\ncargo test --all\n42 passed; 0 failed\n```\n');
    assert('lazy: cargo test recognized (no false no_test_run)', !hasK(jget(d), 'no_test_run'));
    fs.rmSync(d, { recursive: true, force: true });
  }
  // 우회 #3/#4: status=completed + trivial evidence → evidence_missing 발화
  {
    const d = fresh();
    run(d, ['task', 'add', 'y']); run(d, ['task', 'update', 'T-0002', '--status', 'completed', '--evidence', 'n/a']);
    assert('lazy: completed + n/a evidence → evidence_missing (status-consistency + trivial)', hasK(jget(d), 'evidence_missing'));
    fs.rmSync(d, { recursive: true, force: true });
  }
  // FN #6: 아포스트로피 문자열 뒤 TODO 카운트 + FP #10: 멀티라인 템플릿 내 TODO 미카운트
  {
    const d = fresh();
    fs.writeFileSync(path.join(d, 'a.js'), 'const m = "don' + String.fromCharCode(39) + 't"; // TODO: real\n');
    const j1 = jget(d);
    assert('lazy: TODO after apostrophe-string counted (FN fix)', j1 && j1.todoCount === 1);
    fs.rmSync(path.join(d, 'a.js'), { force: true });
    fs.writeFileSync(path.join(d, 'b.js'), 'const s = ' + BT + '\n  TODO: inside template\n' + BT + ';\n');
    const j2 = jget(d);
    assert('lazy: TODO inside multi-line template NOT counted (FP fix)', j2 && j2.todoCount === 0);
    fs.rmSync(d, { recursive: true, force: true });
  }
}

// (9) audit: 유저-프로젝트 FP 가드 (1.35.17)
{
  const VER = (cp.spawnSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' }).stdout || '').trim();
  const auditJson = (d) => { const r = cp.spawnSync(process.execPath, [CLI, 'audit', d, '--json'], { encoding: 'utf8', timeout: 40000, env: { ...process.env, LEERNESS_OFFLINE: '1' } }); try { return JSON.parse(r.stdout); } catch { return null; } };
  const hasK = (j, k) => !!(j && j.findings.some(f => f.kind === k));
  // A: 관리블록이 현재 도구버전으로 sync 됨(유저 pkg 버전 다름) → readme_synced FP 없음
  {
    const d = fresh();
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'user-app', version: '2.3.0' }));
    fs.writeFileSync(path.join(d, 'README.md'), '# A\n<!-- leerness:project-readme:start -->\nLast synced by Leerness v' + VER + ': x\n<!-- leerness:project-readme:end -->\n');
    assert('audit: managed-block synced by CURRENT leerness → no readme_synced FP (user pkg 2.3.0)', !hasK(auditJson(d), 'readme_synced_version_stale'));
    fs.rmSync(d, { recursive: true, force: true });
  }
  // B: .gitignore .env* 광역 패턴이 .env 패밀리 커버 → 오탐 없음
  {
    const d = fresh();
    fs.writeFileSync(path.join(d, '.env'), 'K=xxxxxxxx\n');
    fs.writeFileSync(path.join(d, '.gitignore'), '.env*\n*.pem\ncredentials.json\n');
    assert('audit: .gitignore .env* glob covers .env family → no gitignore_missing_secrets FP', !hasK(auditJson(d), 'gitignore_missing_secrets'));
    fs.rmSync(d, { recursive: true, force: true });
  }
  // C: 영어 단어 "rest" 는 REST API 로 오인 안 함
  {
    const d = fresh();
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'clean up the rest of the module', '--path', d], { encoding: 'utf8' });
    cp.spawnSync(process.execPath, [CLI, 'task', 'update', 'T-0002', '--status', 'in-progress', '--path', d], { encoding: 'utf8' });
    assert('audit: task word "rest" → no api_skill_missing FP (REST acronym case-sensitive)', !hasK(auditJson(d), 'api_skill_missing'));
    fs.rmSync(d, { recursive: true, force: true });
  }
}

// (10) --json 무결성: 변형/조회 명령이 성공 경로에서도 유효 JSON (1.36.0, 클린룸 리뷰 B)
{
  const d = fresh();
  const okJson = (r) => { try { JSON.parse((r.stdout || '').trim()); return true; } catch { return false; } };
  run(d, ['task', 'add', 'sample']);
  assert('json: task update --status done --json → valid JSON (was plain text)', okJson(run(d, ['task', 'update', 'T-0002', '--status', 'done', '--json'])));
  assert('json: plan add --json → valid JSON', okJson(run(d, ['plan', 'add', 'a milestone', '--json'])));
  assert('json: rule verify --json → valid JSON', okJson(run(d, ['rule', 'verify', '--json'])));
  assert('json: reuse find --json → valid JSON', okJson(run(d, ['reuse', 'find', 'button', '--json'])));
  fs.rmSync(d, { recursive: true, force: true });
}

// (11) 상태파일 JSON 무결성: 손상 .harness/*.json 을 audit/health/check 가 표면화 (클린룸 리뷰 FN, 1.36.1)
//   회귀 배경: 그레이스풀 폴백(try{JSON.parse}catch{빈상태})이 깨진 상태 JSON 을 "healthy"/exit 0 으로 감추던 false-negative.
{
  const d = fresh();
  const auditJson = (dir) => { const r = cp.spawnSync(process.execPath, [CLI, 'audit', dir, '--json'], { encoding: 'utf8', timeout: 40000, env: { ...process.env, LEERNESS_OFFLINE: '1' } }); try { return JSON.parse(r.stdout); } catch { return null; } };
  const healthJson = (dir) => { const r = cp.spawnSync(process.execPath, [CLI, 'health', dir, '--json'], { encoding: 'utf8', timeout: 40000 }); try { return JSON.parse(r.stdout); } catch { return null; } };
  const hasK = (j, k) => !!(j && (j.findings || []).some(f => f.kind === k));
  // FP 가드: 클린(유효 JSON) 프로젝트 → 손상 finding 없음 + check exit 0 + health.stateIntegrity.ok
  assert('state-integrity: clean project → no corrupted_state_json (FP guard)', !hasK(auditJson(d), 'corrupted_state_json'));
  assert('state-integrity: clean project → check exit 0', run(d, ['check']).status === 0);
  {
    const hc = healthJson(d);
    assert('state-integrity: clean project → health.stateIntegrity.ok', !!(hc && hc.checks && hc.checks.stateIntegrity && hc.checks.stateIntegrity.ok === true));
  }
  // 손상 주입: manifest.json 을 깨진 JSON 으로 덮어씀 (리뷰 재현과 동일)
  fs.writeFileSync(path.join(d, '.harness', 'manifest.json'), '{ this is : not valid json ]]]');
  assert('state-integrity: corrupted manifest.json → audit corrupted_state_json finding', hasK(auditJson(d), 'corrupted_state_json'));
  assert('state-integrity: corrupted manifest.json → check exit 1 (hard gate)', run(d, ['check']).status === 1);
  {
    const hc = healthJson(d);
    const flagged = !!(hc && hc.healthy === false && hc.checks && hc.checks.stateIntegrity && hc.checks.stateIntegrity.corruptedCount === 1 && (hc.checks.stateIntegrity.corrupted || []).some(c => c.file === '.harness/manifest.json'));
    assert('state-integrity: corrupted manifest.json → health degraded (healthy=false + stateIntegrity)', flagged);
  }
  // 비-크래시 확인: 손상 상태에서도 audit/health/check 는 예외 없이 종료(위 spawn 이 이미 parse 됨 → 크래시 아님)
  fs.rmSync(d, { recursive: true, force: true });
}

// (12) feature add/show 가 trailing positional path 를 존중 — cwd 조용한 오독 + stray .harness scaffold 차단 (클린룸 리뷰 UR-0184, 1.36.2)
//   회귀 배경: add 가 모든 non-flag positional 을 NAME 으로 join → 경로가 이름에 흡수 + 비-프로젝트 cwd 에 stray .harness scaffold(조용한 오염).
{
  const target = fresh();                                                          // 초기화된 타깃 프로젝트
  const outsider = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-nonproj-'));     // 비-프로젝트 cwd (init 안 함)
  const at = (dir, args) => cp.spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 40000, cwd: dir });
  const graphOf = (dir) => { try { return fs.readFileSync(path.join(dir, '.harness', 'feature-graph.md'), 'utf8'); } catch { return ''; } };
  // (a) 비-프로젝트 cwd 에서 `feature add "이름" <타깃경로>` → 타깃에 등록 + 이름에 경로 흡수 없음(node heading title clean)
  at(outsider, ['feature', 'add', 'PosPathFeat', target]);
  assert('feature add: positional path → 타깃 등록 + 이름 clean(경로 흡수 없음)', /^## F-\d{4} PosPathFeat\s*$/m.test(graphOf(target)));
  // (b) 비-프로젝트 cwd 에 stray .harness scaffold 안 함 (조용한 오염 차단)
  assert('feature add: positional path → 비-프로젝트 cwd 에 .harness scaffold 안 함', !fs.existsSync(path.join(outsider, '.harness')));
  // (c) 경로 미지정 + 비-프로젝트 dir → init 게이트로 exit 1 + scaffold 없음 (option b)
  const orphan = at(outsider, ['feature', 'add', 'OrphanFeat']);
  assert('feature add: 미초기화 dir(경로 미지정) → init 게이트 exit 1 + scaffold 없음', orphan.status === 1 && !fs.existsSync(path.join(outsider, '.harness')));
  // (d) show 도 positional path 존중 — 타깃 노드 조회(cwd 아님)
  const showP = at(outsider, ['feature', 'show', 'F-0001', target]);
  assert('feature show: positional path → 타깃 노드 조회(cwd 아님)', showP.status === 0 && /PosPathFeat/.test(showP.stdout || ''));
  // (e) --path 는 여전히 우선(회귀 없음)
  at(outsider, ['feature', 'add', 'ViaFlag', '--path', target]);
  assert('feature add: --path 우선 보존(회귀 없음)', /^## F-\d{4} ViaFlag\s*$/m.test(graphOf(target)) && !fs.existsSync(path.join(outsider, '.harness')));
  fs.rmSync(target, { recursive: true, force: true });
  fs.rmSync(outsider, { recursive: true, force: true });
}

const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nCore result: ${total - failed}/${total} passed · ${dur}s`);
if (failed > 0) process.exit(1);
