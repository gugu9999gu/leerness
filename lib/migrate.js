 
 
 
 
 
'use strict';
const path = require('path');
const fs = require('fs');
const { removeSync } = require('./safe-remove');
const os = require('os');
const cp = require('child_process');
const { absRoot, exists, read, log, ok, warn } = require('./io');

 
function migrateAuditCmd(root, opts = {}, deps = {}) {
  const { VERSION, compareVer, REQUIRED_WORKSPACE_FILES, decisionsPath, decisionsJsonPath, lessonsPath, lessonsJsonPath, _loadDecisions, _loadLessons } = deps;
  root = absRoot(root);
  const findings = [];
  const hvPath = path.join(root, '.leerness', 'HARNESS_VERSION');
  const projVer = exists(hvPath) ? read(hvPath).trim() : null;
  if (!projVer) findings.push({ kind: 'no-version', detail: 'HARNESS_VERSION 없음 (미초기화 또는 아주 구버전)', action: `leerness migrate --path ${root}` });
  else if (compareVer(projVer, VERSION) < 0) findings.push({ kind: 'version-drift', detail: `${projVer} → ${VERSION}`, action: `leerness update --yes --path ${root}` });
   
  if (exists(decisionsPath(root)) && !exists(decisionsJsonPath(root)) && _loadDecisions(root).length > 0) findings.push({ kind: 'canonical-pending', detail: 'decisions.md → decisions.json 백필 예정', action: 'decision add/drop 또는 migrate 시 자동' });
  if (exists(lessonsPath(root)) && !exists(lessonsJsonPath(root)) && _loadLessons(root).length > 0) findings.push({ kind: 'canonical-pending', detail: 'lessons.md → lessons.json 백필 예정', action: 'lesson save/drop 또는 migrate 시 자동' });
   
  const required = REQUIRED_WORKSPACE_FILES;   
  for (const f of required) if (!exists(path.join(root, f))) findings.push({ kind: 'missing-file', detail: f, action: 'migrate 가 생성' });
  if (opts.json) { log(JSON.stringify({ version: VERSION, root, projectVersion: projVer, willChange: findings.length, findings }, null, 2)); return; }
  log(`# leerness migrate audit (1.9.356, UR-0075 dry-run) — 실제 변경 없음`);
  log(`  대상: ${root}`);
  log(`  프로젝트 버전: ${projVer || '(없음)'}  ·  도구 버전: ${VERSION}`);
  if (!findings.length) { ok('마이그레이션 필요 없음 — 최신 스키마 정합'); return; }
  log(`  예상 변경 ${findings.length}건:`);
  for (const f of findings) log(`    • [${f.kind}] ${f.detail}${f.action ? `  → ${f.action}` : ''}`);
  log(`\n  적용: leerness update --yes --path ${root}  ·  안전 가이드: leerness migrate --guide`);
}

 
 
function migrateApplyCmd(root, opts = {}, deps = {}) {
  const { VERSION, compareVer, REQUIRED_WORKSPACE_FILES, decisionsPath, decisionsJsonPath, lessonsPath, lessonsJsonPath, _loadDecisions, _saveDecisions, _loadLessons, _saveLessons, _assertMemoryStoreArray, _withLock } = deps;
  root = absRoot(root);
  const apply = !!opts.yes;
  if (apply && typeof _withLock !== 'function') throw new Error('migrate apply requires the canonical store lock dependency');
  const withLock = typeof _withLock === 'function' ? _withLock : (_target, fn) => fn();
  const applied = [];    
  const skipped = [];    
   
  if (exists(decisionsPath(root)) && !exists(decisionsJsonPath(root)) && _loadDecisions(root).length > 0) {
    let changed = !apply;
    if (apply) {
       
       
      changed = withLock(decisionsJsonPath(root), () => {
        const input = _assertMemoryStoreArray(decisionsJsonPath(root), 'decisions');
        if (input.source !== 'legacy' || !input.entries.length) return false;
        _saveDecisions(root, input.entries, null, input);
        return true;
      });
    }
    if (changed) applied.push({ kind: 'canonical-backfill', detail: 'decisions.md → decisions.json' });
  }
  if (exists(lessonsPath(root)) && !exists(lessonsJsonPath(root)) && _loadLessons(root).length > 0) {
    let changed = !apply;
    if (apply) {
      changed = withLock(lessonsJsonPath(root), () => {
        const input = _assertMemoryStoreArray(lessonsJsonPath(root), 'lessons');
        if (input.source !== 'legacy' || !input.entries.length) return false;
        _saveLessons(root, input.entries, null, input);
        return true;
      });
    }
    if (changed) applied.push({ kind: 'canonical-backfill', detail: 'lessons.md → lessons.json' });
  }
   
  const hvPath = path.join(root, '.leerness', 'HARNESS_VERSION');
  const projVer = exists(hvPath) ? read(hvPath).trim() : null;
  if (!projVer) skipped.push({ kind: 'no-version', detail: 'HARNESS_VERSION 없음', reason: `leerness migrate --path ${root}` });
  else if (compareVer(projVer, VERSION) < 0) skipped.push({ kind: 'version-drift', detail: `${projVer} → ${VERSION}`, reason: `leerness update --yes --path ${root}` });
  const required = REQUIRED_WORKSPACE_FILES;   
  for (const f of required) if (!exists(path.join(root, f))) skipped.push({ kind: 'missing-file', detail: f, reason: 'leerness migrate / init' });
  if (opts.json) { log(JSON.stringify({ version: VERSION, root, dryRun: !apply, appliedCount: apply ? applied.length : 0, applied, skipped }, null, 2)); return; }
  log(`# leerness migrate apply (1.9.357, UR-0075 Phase C)${apply ? '' : ' — dry-run (변경 없음 · --yes 로 적용)'}`);
  log(`  대상: ${root}`);
  if (!applied.length && !skipped.length) { ok('적용할 항목 없음 — 최신 스키마 정합'); return; }
  if (applied.length) {
    log(apply ? `  ✓ 적용 ${applied.length}건 (canonical 백필 · MD→JSON, MD 정규화):` : `  적용 예정 ${applied.length}건 (canonical 백필 · MD→JSON, MD 정규화):`);
    for (const a of applied) log(`    • ${a.detail}`);
  }
  if (skipped.length) {
    log(`  ⚠ 수동 필요 ${skipped.length}건 (apply 범위 외 — 안전상 자동 변경 안 함):`);
    for (const s of skipped) log(`    • [${s.kind}] ${s.detail}  → ${s.reason}`);
  }
  if (!apply && applied.length) log(`\n  적용: leerness migrate apply --path ${root} --yes`);
}

 
 
function migratePlanCmd(root, opts = {}, deps = {}) {
  const { VERSION, compareVer, decisionsPath, decisionsJsonPath, lessonsPath, lessonsJsonPath, _loadDecisions, _loadLessons, harnessPath } = deps;
  root = absRoot(root);
  const plan = { version: VERSION, root, projectVersion: null, versionDrift: null, canonicalPending: [], missingFiles: [], tempInstallOk: false, willChange: 0 };
  const hvPath = path.join(root, '.leerness', 'HARNESS_VERSION');
  plan.projectVersion = exists(hvPath) ? read(hvPath).trim() : null;
  if (plan.projectVersion && compareVer(plan.projectVersion, VERSION) < 0) plan.versionDrift = `${plan.projectVersion} → ${VERSION}`;
  if (exists(decisionsPath(root)) && !exists(decisionsJsonPath(root)) && _loadDecisions(root).length > 0) plan.canonicalPending.push('decisions.md → decisions.json');
  if (exists(lessonsPath(root)) && !exists(lessonsJsonPath(root)) && _loadLessons(root).length > 0) plan.canonicalPending.push('lessons.md → lessons.json');
   
  let tmp = null;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-plan-'));
    const langPath = path.join(root, '.leerness', 'LANGUAGE');
    const lang = exists(langPath) ? (read(langPath).trim() || 'ko') : 'ko';
    const r = cp.spawnSync(process.execPath, [harnessPath, 'init', tmp, '--yes', '--language', lang, '--no-banner'], { encoding: 'utf8', timeout: 60000 });
    plan.tempInstallOk = r.status === 0;
    if (plan.tempInstallOk) {
      const tmpHarness = path.join(tmp, '.leerness');
      let tmpFiles = [];
      try { tmpFiles = fs.readdirSync(tmpHarness, { withFileTypes: true }).filter(e => e.isFile()).map(e => '.leerness/' + e.name); } catch {}
      for (const top of ['AGENTS.md', 'CLAUDE.md']) if (exists(path.join(tmp, top))) tmpFiles.push(top);
      for (const f of tmpFiles) if (!exists(path.join(root, f))) plan.missingFiles.push(f);
    }
  } catch {}
  finally { if (tmp) { try { removeSync(tmp, { recursive: true, force: true }); } catch {} } }
  plan.willChange = plan.missingFiles.length + plan.canonicalPending.length + (plan.versionDrift ? 1 : 0);
  if (opts.json) { log(JSON.stringify(plan, null, 2)); return; }
  log(`# leerness migrate plan (1.9.358, UR-0075 Phase D) — 임시폴더 설치 후 비교 · 읽기 전용(프로젝트 미변경)`);
  log(`  대상: ${root}`);
  log(`  프로젝트 버전: ${plan.projectVersion || '(없음)'}  ·  도구 버전: ${VERSION}`);
  if (!plan.tempInstallOk) warn('임시폴더 설치 실패 — 파일 비교 생략 (버전/canonical 만 보고)');
  if (!plan.willChange) { ok('마이그레이션 필요 없음 — 최신 스키마 정합'); return; }
  log(`  예상 변경 ${plan.willChange}건:`);
  if (plan.versionDrift) log(`    • [version-drift] ${plan.versionDrift}  → leerness update --yes --path ${root}`);
  for (const c of plan.canonicalPending) log(`    • [canonical-pending] ${c}  → leerness migrate apply --path ${root} --yes`);
  if (plan.missingFiles.length) {
    log(`    • [missing-file] ${plan.missingFiles.length}건 (현재 버전이 생성하는 관리 파일 누락):`);
    for (const f of plan.missingFiles.slice(0, 20)) log(`        - ${f}`);
    if (plan.missingFiles.length > 20) log(`        … 외 ${plan.missingFiles.length - 20}건`);
  }
  log(`\n  전체 적용: leerness update --yes --path ${root}  ·  canonical만: leerness migrate apply --path ${root} --yes`);
}

module.exports = { migrateAuditCmd, migrateApplyCmd: require('./runtime-writes').projectWriter(migrateApplyCmd), migratePlanCmd };
