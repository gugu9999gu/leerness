#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module);  

 
 
 
 
 
 

const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
process.env.LEERNESS_OFFLINE = process.env.LEERNESS_OFFLINE || '1';
const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
let failed = 0, total = 0; const t0 = Date.now();

function run(dir, args) { return cp.spawnSync(process.execPath, [CLI, ...args, '--path', dir], { encoding: 'utf8', timeout: 40000 }); }
function assert(label, cond) { total++; process.stdout.write(`${cond ? '✓' : '✗'} ${label}\n`); if (!cond) failed++; }
function fresh() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-core-')); cp.spawnSync(process.execPath, [CLI, 'init', d, '--yes', '--language', 'ko'], { encoding: 'utf8', timeout: 30000 }); return d; }

console.log('# leerness core (test:core) — flagship behavioral guarantees');

 
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

 
{
  const d = fresh();
  fs.writeFileSync(path.join(d, 'x.js'), 'module.exports = { f: () => 1 };\n');
  fs.writeFileSync(path.join(d, 'x.test.js'), 'test();\ntest();\n');
  run(d, ['task', 'add', 'x']);
  run(d, ['task', 'update', 'T-0002', '--status', 'done', '--evidence', 'x.js, x.test.js; 3/3 passed']);
  assert('verify-claim rejects inflated pass (claim 3/3 vs run 2/2 → exit 1)', run(d, ['verify-claim', 'T-0002', '--run-tests', '--test-cmd', 'echo Tests: 2 passed, 2 total']).status === 1);
  fs.rmSync(d, { recursive: true, force: true });
}

 
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

 
{
  const d = fresh();
  fs.writeFileSync(path.join(d, 's.md'), '- charge()\n');
  fs.writeFileSync(path.join(d, 'miss.js'), 'module.exports = { other: 1 };\n');
  assert('contract catches missing function → exit 1', run(d, ['contract', 'verify', path.join(d, 's.md'), path.join(d, 'miss.js')]).status === 1);
  fs.writeFileSync(path.join(d, 'ok.js'), 'function charge(){}\nmodule.exports = { charge };\n');
  assert('contract passes when satisfied → exit 0', run(d, ['contract', 'verify', path.join(d, 's.md'), path.join(d, 'ok.js')]).status === 0);
  fs.rmSync(d, { recursive: true, force: true });
}

 
{
  const d = fresh();
  assert('scan secrets clean → exit 0', run(d, ['scan', 'secrets', '.']).status === 0);
  fs.writeFileSync(path.join(d, 'k.js'), 'const k = "AKIAJQXMP7RZ2KL9WXYZ";\n');
  assert('scan secrets committed key → exit 1', run(d, ['scan', 'secrets', '.']).status === 1);
  fs.rmSync(path.join(d, 'k.js'), { force: true });
   
  fs.writeFileSync(path.join(d, 'app.env'), 'DB_PASSWORD=Sup3rSecretValue99\n');
  assert('scan secrets catches compound env key (DB_PASSWORD=) → exit 1', run(d, ['scan', 'secrets', '.']).status === 1);
  fs.rmSync(path.join(d, 'app.env'), { force: true });
   
  fs.writeFileSync(path.join(d, 'cfg.json'), '{ "db_password": "Xk9mP2qL7vR4nT8wZ0" }\n');
  assert('scan secrets catches JSON quoted key → exit 1', run(d, ['scan', 'secrets', '.']).status === 1);
  fs.rmSync(path.join(d, 'cfg.json'), { force: true });
   
  fs.writeFileSync(path.join(d, 'schema.json'), '{ "secret": "required", "password": "hashed" }\n');
  assert('scan secrets keeps dictionary-word schema clean → exit 0', run(d, ['scan', 'secrets', '.']).status === 0);
  fs.rmSync(path.join(d, 'schema.json'), { force: true });
   
  fs.writeFileSync(path.join(d, 'settings.py'), 'SECRET_KEY = "n7zU4lYq8mP2rC5tV0bX9aQ1"\n');
  assert('scan secrets catches Django SECRET_KEY → exit 1', run(d, ['scan', 'secrets', '.']).status === 1);
  fs.rmSync(path.join(d, 'settings.py'), { force: true });
   
  fs.writeFileSync(path.join(d, 'id.key'), '-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIF\n-----END ENCRYPTED PRIVATE KEY-----\n');
  assert('scan secrets catches ENCRYPTED PRIVATE KEY → exit 1', run(d, ['scan', 'secrets', '.']).status === 1);
  fs.rmSync(path.join(d, 'id.key'), { force: true });
   
  fs.writeFileSync(path.join(d, 'compose.yml'), 'DATABASE_URL: postgres://postgres:postgres@localhost/app\n');
  assert('scan secrets keeps local DB defaults clean → exit 0', run(d, ['scan', 'secrets', '.']).status === 0);
  fs.rmSync(d, { recursive: true, force: true });
}

 
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-enc-'));
   
  fs.writeFileSync(path.join(d, 'ascii.bat'), '@echo off\r\necho hello world\r\n', 'latin1');
  assert('encoding: pure-ASCII .bat clean (no false chcp warning) → exit 0', cp.spawnSync(process.execPath, [CLI, 'encoding', 'check', d], { encoding: 'utf8', timeout: 40000 }).status === 0);
   
  fs.writeFileSync(path.join(d, 'korean.cmd'), Buffer.from([0x40, 0x65, 0x63, 0x68, 0x6f, 0x20, 0xC7, 0xD1, 0x0d, 0x0a]));
  assert('encoding: Korean mojibake .cmd flagged (.cmd now scanned) → exit 1', cp.spawnSync(process.execPath, [CLI, 'encoding', 'check', d], { encoding: 'utf8', timeout: 40000 }).status === 1);
  fs.rmSync(d, { recursive: true, force: true });
}

 
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-apply-'));
   
  const cp949 = Buffer.concat([Buffer.from('Write-Host "', 'latin1'), Buffer.from([0xBE, 0xC8, 0xB3, 0xE7]), Buffer.from('"\r\n', 'latin1')]);
  fs.writeFileSync(path.join(d, 'cp949.ps1'), cp949);
  cp.spawnSync(process.execPath, [CLI, 'env', 'encoding-check', '--apply', '--path', d], { encoding: 'utf8', timeout: 40000 });
  const after = fs.readFileSync(path.join(d, 'cp949.ps1'));
  assert('encoding --apply: CP949 .ps1 NOT mutated (no destructive BOM-on-CP949)', after.equals(cp949) && !(after[0] === 0xEF && after[1] === 0xBB && after[2] === 0xBF));
   
  const ambiguous = Buffer.from([0x41, 0xC2, 0xA1, 0x42]);  
  fs.writeFileSync(path.join(d, 'ambiguous.ps1'), ambiguous);
   
  const utf8Only = Buffer.from('Write-Host "😀"\r\n', 'utf8');
  fs.writeFileSync(path.join(d, 'utf8.ps1'), utf8Only);
  cp.spawnSync(process.execPath, [CLI, 'env', 'encoding-check', '--apply', '--path', d], { encoding: 'utf8', timeout: 40000 });
  const u = fs.readFileSync(path.join(d, 'utf8.ps1'));
  const a = fs.readFileSync(path.join(d, 'ambiguous.ps1'));
  const uValid = Buffer.from(u.toString('utf8'), 'utf8').equals(u);
  assert('encoding --apply: UTF-8/CP949 ambiguous .ps1 remains exact', a.equals(ambiguous));
  assert('encoding --apply: unambiguous UTF-8 .ps1 follows platform contract', process.platform === 'win32'
    ? (u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF && uValid)
    : u.equals(utf8Only));
  for (const e of fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory() && e.name.startsWith('.leerness-write-'))) {
    fs.rmSync(path.join(d, e.name), { recursive: true, force: true });
  }
  fs.rmSync(d, { recursive: true, force: true });
}

 
{
  const BT = String.fromCharCode(96);
  const jget = (d) => { const r = run(d, ['lazy', 'detect', '--json']); try { return JSON.parse(r.stdout); } catch { return null; } };
  const hasK = (j, k) => !!(j && j.findings.some(f => f.kind === k));
   
  {
    const d = fresh();
    run(d, ['task', 'add', 'rust']); run(d, ['task', 'update', 'T-0002', '--status', 'done', '--evidence', 'src/lib.rs done']);
    fs.appendFileSync(path.join(d, '.leerness/review-evidence.md'), '\n```\ncargo test --all\n42 passed; 0 failed\n```\n');
    assert('lazy: cargo test recognized (no false no_test_run)', !hasK(jget(d), 'no_test_run'));
    fs.rmSync(d, { recursive: true, force: true });
  }
   
  {
    const d = fresh();
    run(d, ['task', 'add', 'y']); run(d, ['task', 'update', 'T-0002', '--status', 'completed', '--evidence', 'n/a']);
    assert('lazy: completed + n/a evidence → evidence_missing (status-consistency + trivial)', hasK(jget(d), 'evidence_missing'));
    fs.rmSync(d, { recursive: true, force: true });
  }
   
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
   
  {
    const d = fresh();
    fs.writeFileSync(path.join(d, 'README.md'), '# Guide\nThe lazy detector reports untracked TODO work.\n');
    const j = jget(d);
    assert('lazy: README prose TODO ignored (not a code comment)', j && j.todoCount === 0);
    fs.rmSync(d, { recursive: true, force: true });
  }
}

 
{
  const VER = (cp.spawnSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' }).stdout || '').trim();
  const auditJson = (d) => { const r = cp.spawnSync(process.execPath, [CLI, 'audit', d, '--json'], { encoding: 'utf8', timeout: 40000, env: { ...process.env, LEERNESS_OFFLINE: '1' } }); try { return JSON.parse(r.stdout); } catch { return null; } };
  const hasK = (j, k) => !!(j && j.findings.some(f => f.kind === k));
   
  {
    const d = fresh();
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'user-app', version: '2.3.0' }));
    fs.writeFileSync(path.join(d, 'README.md'), '# A\n<!-- leerness:project-readme:start -->\nLast synced by Leerness v' + VER + ': x\n<!-- leerness:project-readme:end -->\n');
    assert('audit: managed-block synced by CURRENT leerness → no readme_synced FP (user pkg 2.3.0)', !hasK(auditJson(d), 'readme_synced_version_stale'));
    fs.rmSync(d, { recursive: true, force: true });
  }
   
  {
    const d = fresh();
    fs.writeFileSync(path.join(d, '.env'), 'K=xxxxxxxx\n');
    fs.writeFileSync(path.join(d, '.gitignore'), '.env*\n*.pem\ncredentials.json\n');
    assert('audit: .gitignore .env* glob covers .env family → no gitignore_missing_secrets FP', !hasK(auditJson(d), 'gitignore_missing_secrets'));
    fs.rmSync(d, { recursive: true, force: true });
  }
   
  {
    const d = fresh();
    cp.spawnSync(process.execPath, [CLI, 'task', 'add', 'clean up the rest of the module', '--path', d], { encoding: 'utf8' });
    cp.spawnSync(process.execPath, [CLI, 'task', 'update', 'T-0002', '--status', 'in-progress', '--path', d], { encoding: 'utf8' });
    assert('audit: task word "rest" → no api_skill_missing FP (REST acronym case-sensitive)', !hasK(auditJson(d), 'api_skill_missing'));
    fs.rmSync(d, { recursive: true, force: true });
  }
}

 
{
  const d = fresh();
  const jsonResult = (r) => { try { return JSON.parse((r.stdout || '').trim()); } catch { return null; } };
  const okJson = (r) => { const payload = jsonResult(r); return r.status === 0 && !(r.stderr || '').trim() && payload !== null && payload.ok !== false; };
  const addedTask = jsonResult(run(d, ['task', 'add', 'sample', '--json']));
  assert('json: task update --status done --json → valid JSON (was plain text)', okJson(run(d, ['task', 'update', 'T-0002', '--status', 'done', '--json'])));
  assert('json: plan add --json → valid JSON', okJson(run(d, ['plan', 'add', 'a milestone', '--json'])));
  assert('json: rule verify --json → valid JSON', okJson(run(d, ['rule', 'verify', '--json'])));
  assert('json: reuse find --json → valid JSON', okJson(run(d, ['reuse', 'find', 'button', '--json'])));

   
   
  run(d, ['decision', 'add', 'json delete decision']);
  run(d, ['lesson', 'save', 'json delete lesson']);
  const addedRule = jsonResult(run(d, ['rule', 'add', 'json delete rule', '--trigger', 'every-session', '--json']));
  run(d, ['plan', 'add', 'json delete milestone']);
  run(d, ['roadmap', 'auto', 'on', '--on-every-change']);
  const deleteCases = [
    ['task drop', ['task', 'drop', addedTask.id, '--json'], 'tasks'],
    ['decision drop', ['decision', 'drop', 'json delete decision', '--json'], 'decisions'],
    ['lesson drop', ['lesson', 'drop', 'json delete lesson', '--json'], 'lessons'],
    ['rule remove', ['rule', 'remove', addedRule.id, '--json'], 'rules'],
    ['plan remove', ['plan', 'remove', 'json delete milestone', '--json'], 'plan'],
  ];
  const graphPath = path.join(d, 'leerness.html');
  for (const [label, args, surface] of deleteCases) {
    fs.rmSync(graphPath, { force: true });
    const result = run(d, args);
    const payload = jsonResult(result);
    assert(`json: ${label} --json → one success document + clean stderr + silent roadmap refresh`,
      result.status === 0 && !(result.stderr || '').trim() && payload?.ok === true
      && payload.surface === surface
      && (surface === 'tasks' ? payload.status === 'dropped' : payload.removedCount === 1)
      && fs.existsSync(graphPath),
      `status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`);
  }
  fs.rmSync(d, { recursive: true, force: true });
}

 
 
{
  const d = fresh();
  const auditJson = (dir) => { const r = cp.spawnSync(process.execPath, [CLI, 'audit', dir, '--json'], { encoding: 'utf8', timeout: 40000, env: { ...process.env, LEERNESS_OFFLINE: '1' } }); try { return JSON.parse(r.stdout); } catch { return null; } };
  const healthJson = (dir) => { const r = cp.spawnSync(process.execPath, [CLI, 'health', dir, '--json'], { encoding: 'utf8', timeout: 40000 }); try { return JSON.parse(r.stdout); } catch { return null; } };
  const hasK = (j, k) => !!(j && (j.findings || []).some(f => f.kind === k));
   
  assert('state-integrity: clean project → no corrupted_state_json (FP guard)', !hasK(auditJson(d), 'corrupted_state_json'));
  assert('state-integrity: clean project → check exit 0', run(d, ['check']).status === 0);
  {
    const hc = healthJson(d);
    assert('state-integrity: clean project → health.stateIntegrity.ok', !!(hc && hc.checks && hc.checks.stateIntegrity && hc.checks.stateIntegrity.ok === true));
  }
   
  fs.writeFileSync(path.join(d, '.leerness', 'manifest.json'), '{ this is : not valid json ]]]');
  assert('state-integrity: corrupted manifest.json → audit corrupted_state_json finding', hasK(auditJson(d), 'corrupted_state_json'));
  assert('state-integrity: corrupted manifest.json → check exit 1 (hard gate)', run(d, ['check']).status === 1);
  {
    const hc = healthJson(d);
    const flagged = !!(hc && hc.healthy === false && hc.checks && hc.checks.stateIntegrity && hc.checks.stateIntegrity.corruptedCount === 1 && (hc.checks.stateIntegrity.corrupted || []).some(c => c.file === '.leerness/manifest.json'));
    assert('state-integrity: corrupted manifest.json → health degraded (healthy=false + stateIntegrity)', flagged);
  }
   
  fs.rmSync(d, { recursive: true, force: true });
}

 
 
{
  const target = fresh();                                                           
  const outsider = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-nonproj-'));      
  const at = (dir, args) => cp.spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 40000, cwd: dir });
  const graphOf = (dir) => { try { return fs.readFileSync(path.join(dir, '.leerness', 'feature-graph.md'), 'utf8'); } catch { return ''; } };
   
  at(outsider, ['feature', 'add', 'PosPathFeat', target]);
  assert('feature add: positional path → 타깃 등록 + 이름 clean(경로 흡수 없음)', /^## F-\d{4} PosPathFeat\s*$/m.test(graphOf(target)));
   
  assert('feature add: positional path → 비-프로젝트 cwd 에 .leerness scaffold 안 함', !fs.existsSync(path.join(outsider, '.leerness')));
   
  const orphan = at(outsider, ['feature', 'add', 'OrphanFeat']);
  assert('feature add: 미초기화 dir(경로 미지정) → init 게이트 exit 1 + scaffold 없음', orphan.status === 1 && !fs.existsSync(path.join(outsider, '.leerness')));
   
  const showP = at(outsider, ['feature', 'show', 'F-0001', target]);
  assert('feature show: positional path → 타깃 노드 조회(cwd 아님)', showP.status === 0 && /PosPathFeat/.test(showP.stdout || ''));
   
  at(outsider, ['feature', 'add', 'ViaFlag', '--path', target]);
  assert('feature add: --path 우선 보존(회귀 없음)', /^## F-\d{4} ViaFlag\s*$/m.test(graphOf(target)) && !fs.existsSync(path.join(outsider, '.leerness')));
  fs.rmSync(target, { recursive: true, force: true });
  fs.rmSync(outsider, { recursive: true, force: true });
}

 
{
  const scrubCase = require('../bin/leerness')._selfTestCases().find(c => c.name.startsWith('_scrubTestEnv:'));
  assert('child env scrub keeps executable PATH while removing test secrets', !!scrubCase && scrubCase.run() === true);

  const d = fresh();
  const call = (args) => cp.spawnSync(process.execPath, [CLI, ...args], { cwd: d, encoding: 'utf8', timeout: 40000 });
  const invalid = call(['sessions', 'send', '--path', d, '--json']);
  let invalidJson = null; try { invalidJson = JSON.parse(invalid.stdout || ''); } catch {}
  assert('sessions rejects unsupported send/inbox/scope-style verbs (no false-success)', invalid.status === 1 && invalidJson && invalidJson.code === 'unknown_subcommand');
  const positional = call(['sessions', d, '--json']);
  let positionalJson = null; try { positionalJson = JSON.parse(positional.stdout || ''); } catch {}
  assert('sessions keeps the documented positional-path listing contract', positional.status === 0 && positionalJson && Array.isArray(positionalJson.sessions));
  fs.rmSync(d, { recursive: true, force: true });
}

const dur = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nCore result: ${total - failed}/${total} passed · ${dur}s`);
if (failed > 0) process.exit(1);
