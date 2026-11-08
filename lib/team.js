 
 
 
 
 
'use strict';
const cp = require('child_process');
const { absRoot, log, ok, warn, fail, now } = require('./io');
const { _composeTeamPlan, _teamDeployGate } = require('./pure-utils');
const { _shellGuardAnalyze } = require('./analyzers');

function teamCmd(root, sub, id, opts = {}, deps = {}) {
  const { VERSION, _loadTeams, _loadTeamsChecked, _saveTeams, _detectShellCtx, arg, has, failJson } = deps;
  root = absRoot(root);
  const json = opts.json || has('--json');
  sub = sub || 'list';
   
  const lockedEdit = ['add', 'remove'].includes(sub) && typeof deps._loadTeamsForEdit === 'function' && typeof deps._withLock === 'function';
  const _chk = lockedEdit ? { teams: [], invalid: false } : (typeof _loadTeamsChecked === 'function') ? _loadTeamsChecked(root) : { teams: _loadTeams(root), invalid: false };
  const teams = _chk.teams;
  const _fj = failJson || ((j, code, msg) => { if (j) log(JSON.stringify({ ok: false, code, error: msg }, null, 2)); else fail(msg); });
  const _mutating = ['add', 'remove', 'deploy'].includes(sub);
  if (_mutating && _chk.invalid) { _fj(json, 'store_invalid', `teams.json 형상 무효(비배열 루트 또는 null/ID 없는 항목) — 덮어쓰기 거부: ${require('path').join(root, '.leerness', 'teams.json')} (수동 복구 후 재시도)`); return; }
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
    if (!teamId || teamId.includes('..')) { _fj(json, 'invalid_id', `무효한 team id: "${id}" (영숫자/._- 만)`); return; }    
    if (teams.some(t => t.id === teamId)) { _fj(json, 'already_exists', `이미 존재: ${teamId} (제거 후 재정의: leerness team remove ${teamId})`); return; }
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
      deployCommand: arg('--deploy', '') === true ? '' : arg('--deploy', ''),   
      review: !has('--no-review'),   
      status: 'active',
      createdAt: now()
    };
     
    const _doAdd = () => {
       
      const _rechk = deps._loadTeamsForEdit ? deps._loadTeamsForEdit(root) : (typeof _loadTeamsChecked === 'function') ? _loadTeamsChecked(root) : { teams: _loadTeams(root), invalid: false };
      if (_rechk.invalid) { _fj(json, 'store_invalid', `teams.json 형상 무효 — 덮어쓰기 거부(락 재확인)`); return false; }
      const cur = _rechk.teams;
      if (cur.some(t => t.id === teamId)) { _fj(json, 'already_exists', `이미 존재: ${teamId} (제거 후 재정의: leerness team remove ${teamId})`); return false; }
      cur.push(team);
       
       
      _saveTeams(root, cur);
      return true;
    };
    const _added = (typeof deps._withLock === 'function')
      ? deps._withLock(require('path').join(root, '.leerness', 'teams.json'), _doAdd)
      : _doAdd();
    if (!_added) return;
    if (json) { log(JSON.stringify({ ok: true, id: teamId, personas: team.personas.length, members: team.members.length, schedule: team.schedule, review: team.review }, null, 2)); return; }    
    ok(`team 정의: ${teamId} (personas:${team.personas.length} members:${team.members.length} schedule:${team.schedule} review:${team.review ? 'on' : 'off'})`);
    log(`  ⓘ 정의 전용 — 자동 실행 없음. 목록: leerness team list`);
    return;
  }
  if (sub === 'show') {
    const t = teams.find(x => x.id === id);
    if (!t) { _fj(json, 'not_found', `team 없음: ${id}`); return; }    
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
     
     
    const _doRemove = () => {
      const _rechk = deps._loadTeamsForEdit ? deps._loadTeamsForEdit(root) : (typeof _loadTeamsChecked === 'function') ? _loadTeamsChecked(root) : { teams: _loadTeams(root), invalid: false };
      if (_rechk.invalid) { _fj(json, 'store_invalid', 'teams.json 형상 무효 — 덮어쓰기 거부(락 재확인)'); return null; }
      const cur = _rechk.teams;
      const next = cur.filter(x => x.id !== id);
      if (next.length === cur.length) { _fj(json, 'not_found', `team 없음: ${id}`); return null; }    
      _saveTeams(root, next);
      return next;
    };
    const removed = (typeof deps._withLock === 'function')
      ? deps._withLock(require('path').join(root, '.leerness', 'teams.json'), _doRemove)
      : _doRemove();
    if (!removed) return;
    if (json) { log(JSON.stringify({ ok: true, removed: id, count: removed.length }, null, 2)); return; }
    ok(`team 제거: ${id}`);
    return;
  }
   
  if (sub === 'preview') {
    const t = teams.find(x => x.id === id);
    if (!t) { _fj(json, 'not_found', `team 없음: ${id}`); return; }    
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
     
    if (plan.reviewStep) {
      log(`    ✔ 메인 검수 (필수)`);
      log(`        ↳ ${plan.reviewStep.note}`);
      log(`        ↳ ${plan.reviewStep.suggestedCommand}`);
    }
    log(`\n  ⓘ dry-run — 실제 dispatch/배포 없음. 위 명령을 검토 후 직접 실행하거나, 향후 Phase C(스케줄)/D(배포)에서 게이트 적용.`);
    return;
  }
   
  if (sub === 'deploy') {
    const t = teams.find(x => x.id === id);
    if (!t) { _fj(json, 'not_found', `team 없음: ${id}`); return; }
    const gate = _teamDeployGate(t, { yes: has('--yes'), envOn: process.env.LEERNESS_TEAM_DEPLOY === '1' });
     
    if (gate.mode === 'no-command' || gate.mode === 'gated') process.exitCode = 1;
     
     
    if (json && gate.mode === 'execute') {
      const r = cp.spawnSync(gate.command, { cwd: root, shell: true, encoding: 'utf8', timeout: 600000 });
      if (r.status !== 0) process.exitCode = 1;
      log(JSON.stringify({ version: VERSION, teamId: t.id, ...gate, executed: true, exitStatus: r.status, stdout: (r.stdout || '').slice(0, 4000), stderr: (r.stderr || '').slice(0, 4000) }, null, 2));
      return;
    }
    if (json) { log(JSON.stringify({ version: VERSION, teamId: t.id, ...gate }, null, 2)); return; }    
    if (gate.mode === 'no-command') { fail(`team '${t.id}' deployCommand 미설정 — leerness team add ${t.id} --deploy "<배포 명령>"`); return; }
    if (gate.mode === 'dry-run') {
      log(`# team deploy ${t.id} (1.9.376, UR-0073 Phase D) — dry-run (실행 없음)`);
      log(`  배포 명령: ${gate.command}`);
      log(`  ⓘ ${gate.message}`);
      log(`  실행: LEERNESS_TEAM_DEPLOY=1 leerness team deploy ${t.id} --yes  (셸 호환성 점검 후 실행)`);
      return;
    }
     
     
    if (has('--dry-run')) {
      log(`# team deploy ${t.id} — (dry-run) 실행하지 않음: ${t.deployCommand}`);
      return;
    }
    if (gate.mode === 'gated') { fail(`${gate.message} — dry-run 으로 먼저 검토: leerness team deploy ${t.id}`); return; }
     
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
