// lib/team.js — 에이전트 팀 정의 핸들러 (UR-0073: list/add/show/remove/preview/deploy).
// 1.9.389 (UR-0025 큰 핸들러 모듈화 2번째): bin/harness.js 에서 teamCmd 분리.
//   - I/O 프리미티브: ./io.  순수 로직: ./pure-utils(_composeTeamPlan/_teamDeployGate).  정적분석: ./analyzers(_shellGuardAnalyze).
//   - harness 고유 의존(VERSION · 공유 저장 함수 _loadTeams/_saveTeams · _detectShellCtx · argv 파서 arg/has)은 deps 로 주입(DI).
//   - _loadTeams/_saveTeams 는 handoff(team reminders)도 쓰는 공유 함수라 harness 에 유지하고 주입만 받음.
'use strict';
const cp = require('child_process');
const { absRoot, log, ok, warn, fail, now } = require('./io');
const { _composeTeamPlan, _teamDeployGate } = require('./pure-utils');
const { _shellGuardAnalyze } = require('./analyzers');

function teamCmd(root, sub, id, opts = {}, deps = {}) {
  const { VERSION, _loadTeams, _saveTeams, _detectShellCtx, arg, has } = deps;
  root = absRoot(root);
  const json = opts.json || has('--json');
  const teams = _loadTeams(root);
  sub = sub || 'list';
  if (sub === 'list') {
    if (json) { log(JSON.stringify({ version: VERSION, root, count: teams.length, teams }, null, 2)); return; }
    log(`# leerness team (1.9.371, UR-0073 Phase A) — 에이전트 팀 정의 (opt-in · 정의 전용)`);
    if (!teams.length) { log('  (정의된 팀 없음) — leerness team add <id> --name "..." --purpose "..." --personas a,b --members claude,codex'); return; }
    for (const t of teams) log(`  • ${t.id}${t.name ? ' — ' + t.name : ''}  [${t.status || 'active'}/${t.schedule || 'manual'}]  personas:${(t.personas || []).join('|') || '-'} members:${(t.members || []).join('|') || '-'}`);
    log(`\n  ⓘ 정의 전용 — 자동 실행 없음. 실행(리뷰/배포/블로그)은 향후 opt-in 단계.`);
    return;
  }
  if (sub === 'add') {
    const teamId = String(id || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.\-]+|[.\-]+$/g, '');
    if (!teamId || teamId.includes('..')) { fail(`무효한 team id: "${id}" (영숫자/._- 만)`); return; }
    if (teams.some(t => t.id === teamId)) { warn(`이미 존재: ${teamId} (제거 후 재정의: leerness team remove ${teamId})`); return; }
    const splitCsv = v => (v && v !== true) ? String(v).split(',').map(s => s.trim()).filter(Boolean) : [];
    const sched = arg('--schedule', 'manual');
    const validSched = new Set(['manual', 'every-session', 'daily', 'weekly']);
    const team = {
      id: teamId,
      name: arg('--name', '') === true ? '' : arg('--name', ''),
      purpose: arg('--purpose', '') === true ? '' : arg('--purpose', ''),
      personas: splitCsv(arg('--personas', null)),
      members: splitCsv(arg('--members', null)),
      schedule: validSched.has(sched) ? sched : 'manual',
      deployCommand: arg('--deploy', '') === true ? '' : arg('--deploy', ''),  // 1.9.376 (Phase D): 사용자 설정 배포 명령 (실행은 게이트)
      review: !has('--no-review'),  // 1.9.414 (UR-0119/0120): 메인 에이전트 검수 요구(기본 on, --no-review 로 끔). preview/handoff 가 검수 단계 표시.
      status: 'active',
      createdAt: now()
    };
    // 1.36.31 (codex 미검토표면 #2): 병렬 team add 가 서로의 등록을 덮어쓰던 lost update — 락 안에서 재로드→중복검사→추가→저장.
    const _doAdd = () => {
      const cur = _loadTeams(root);
      if (cur.some(t => t.id === teamId)) { warn(`이미 존재: ${teamId} (제거 후 재정의: leerness team remove ${teamId})`); return false; }
      cur.push(team);
      // Windows: 락 밖의 병렬 _loadTeams 읽기가 파일을 잠깐 열어둔 사이 원자 rename 이 EPERM(일시적) — 짧은 재시도.
      let _lastErr = null;
      for (let k = 0; k < 4; k++) {
        try { _saveTeams(root, cur); _lastErr = null; break; }
        catch (e) { _lastErr = e; if (e && e.code === 'EPERM') { const t0 = Date.now(); while (Date.now() - t0 < 25) {} continue; } throw e; }
      }
      if (_lastErr) throw _lastErr;
      return true;
    };
    const _added = (typeof deps._withLock === 'function')
      ? deps._withLock(require('path').join(root, '.harness', 'teams.json'), _doAdd)
      : _doAdd();
    if (!_added) return;
    ok(`team 정의: ${teamId} (personas:${team.personas.length} members:${team.members.length} schedule:${team.schedule} review:${team.review ? 'on' : 'off'})`);
    log(`  ⓘ 정의 전용 — 자동 실행 없음. 목록: leerness team list`);
    return;
  }
  if (sub === 'show') {
    const t = teams.find(x => x.id === id);
    if (!t) { fail(`team 없음: ${id}`); return; }
    if (json) { log(JSON.stringify(t, null, 2)); return; }
    log(`# team ${t.id}`);
    log(`  name: ${t.name || ''}`);
    log(`  purpose: ${t.purpose || ''}`);
    log(`  personas: ${(t.personas || []).join(', ') || '-'}`);
    log(`  members: ${(t.members || []).join(', ') || '-'}`);
    log(`  schedule: ${t.schedule || 'manual'}  ·  status: ${t.status || 'active'}`);
    log(`  deploy: ${t.deployCommand || '-'}`);
    log(`  review: ${t.review !== false ? '메인 검수 필요' : '생략'}`);
    return;
  }
  if (sub === 'remove') {
    const before = teams.length;
    const next = teams.filter(x => x.id !== id);
    if (next.length === before) { warn(`team 없음: ${id}`); return; }
    _saveTeams(root, next);
    ok(`team 제거: ${id}`);
    return;
  }
  // 1.9.372 (UR-0073 Phase B): team preview — dry-run 실행 계획 미리보기 (실제 dispatch/spawn/배포 없음).
  if (sub === 'preview') {
    const t = teams.find(x => x.id === id);
    if (!t) { fail(`team 없음: ${id}`); return; }
    const plan = _composeTeamPlan(t, arg('--task', null));
    if (json) { log(JSON.stringify({ version: VERSION, dryRun: true, ...plan }, null, 2)); return; }
    log(`# team preview ${t.id} (1.9.372, UR-0073 Phase B) — dry-run (실제 실행 없음)`);
    log(`  task: ${plan.task}`);
    log(`  schedule: ${plan.schedule}  ·  members: ${plan.memberCount}`);
    if (!plan.steps.length) { warn('members 없음 — leerness team add <id> --members claude,codex 로 지정'); return; }
    log(`  실행 계획 (미리보기 · 자동 실행 안 함):`);
    for (const s of plan.steps) {
      log(`    • ${s.member}${s.personas.length ? ' [' + s.personas.join(',') + ']' : ''}`);
      log(`        ↳ ${s.suggestedCommand}`);
    }
    // 1.9.414 (UR-0119/0120): 분배 후 메인 검수 단계 표시
    if (plan.reviewStep) {
      log(`    ✔ 메인 검수 (필수)`);
      log(`        ↳ ${plan.reviewStep.note}`);
      log(`        ↳ ${plan.reviewStep.suggestedCommand}`);
    }
    log(`\n  ⓘ dry-run — 실제 dispatch/배포 없음. 위 명령을 검토 후 직접 실행하거나, 향후 Phase C(스케줄)/D(배포)에서 게이트 적용.`);
    return;
  }
  // 1.9.376 (UR-0073 Phase D): team deploy — 사용자 설정 deployCommand 실행. 안전: dry-run 기본 + --yes + LEERNESS_TEAM_DEPLOY=1 이중 게이트 + shell-guard.
  if (sub === 'deploy') {
    const t = teams.find(x => x.id === id);
    if (!t) { fail(`team 없음: ${id}`); return; }
    const gate = _teamDeployGate(t, { yes: has('--yes'), envOn: process.env.LEERNESS_TEAM_DEPLOY === '1' });
    if (json) { log(JSON.stringify({ version: VERSION, teamId: t.id, ...gate }, null, 2)); if (gate.mode !== 'execute') return; }
    if (gate.mode === 'no-command') { fail(`team '${t.id}' deployCommand 미설정 — leerness team add ${t.id} --deploy "<배포 명령>"`); return; }
    if (gate.mode === 'dry-run') {
      log(`# team deploy ${t.id} (1.9.376, UR-0073 Phase D) — dry-run (실행 없음)`);
      log(`  배포 명령: ${gate.command}`);
      log(`  ⓘ ${gate.message}`);
      log(`  실행: LEERNESS_TEAM_DEPLOY=1 leerness team deploy ${t.id} --yes  (셸 호환성 점검 후 실행)`);
      return;
    }
    if (gate.mode === 'gated') { fail(`${gate.message} — dry-run 으로 먼저 검토: leerness team deploy ${t.id}`); return; }
    // execute: shell-guard 정적 점검(advisory) 후 spawn
    try {
      const ctx = _detectShellCtx();
      const guard = _shellGuardAnalyze ? _shellGuardAnalyze(gate.command, ctx) : null;
      if (guard && guard.findings && guard.findings.length) {
        warn(`shell-guard 경고 ${guard.findings.length}건 (배포 명령): ${guard.findings.map(f => f.rule || f.kind || f).join(', ')}`);
      }
    } catch {}
    log(`# team deploy ${t.id} — 실행 (LEERNESS_TEAM_DEPLOY=1 + --yes)`);
    log(`  $ ${gate.command}`);
    const r = cp.spawnSync(gate.command, { cwd: root, shell: true, stdio: 'inherit', timeout: 600000 });
    if (r.status === 0) ok(`team deploy 완료: ${t.id} (exit 0)`);
    else { fail(`team deploy 실패: ${t.id} (exit ${r.status})`); }
    return;
  }
  fail(`알 수 없는 team 하위명령: ${sub} (list|add|show|remove|preview|deploy)`);
}

module.exports = { teamCmd };
