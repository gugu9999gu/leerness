// lib/migrate.js — 크로스버전 마이그레이션 핸들러 (UR-0075: audit / apply / plan).
// 1.9.388 (UR-0025 큰 핸들러 모듈화): bin/harness.js 에서 분리한 첫 실제 핸들러 모듈.
//   - I/O 프리미티브: ./io (absRoot/exists/read/log/ok/warn).
//   - harness 고유 의존(VERSION · canonical 메모리 함수 · REQUIRED_WORKSPACE_FILES · compareVer · harness 경로)은
//     deps 객체로 주입(DI). harness 는 thin wrapper 로 deps 를 1회 구성해 위임 → 호출부/동작 무변경.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const { absRoot, exists, read, log, ok, warn } = require('./io');

// UR-0075 Phase B (1.9.356): migrate audit — 비파괴 dry-run 스키마 drift 리포트 (실제 변경 없음).
function migrateAuditCmd(root, opts = {}, deps = {}) {
  const { VERSION, compareVer, REQUIRED_WORKSPACE_FILES, decisionsPath, decisionsJsonPath, lessonsPath, lessonsJsonPath, _loadDecisions, _loadLessons } = deps;
  root = absRoot(root);
  const findings = [];
  const hvPath = path.join(root, '.harness', 'HARNESS_VERSION');
  const projVer = exists(hvPath) ? read(hvPath).trim() : null;
  if (!projVer) findings.push({ kind: 'no-version', detail: 'HARNESS_VERSION 없음 (미초기화 또는 아주 구버전)', action: `leerness migrate --path ${root}` });
  else if (compareVer(projVer, VERSION) < 0) findings.push({ kind: 'version-drift', detail: `${projVer} → ${VERSION}`, action: `leerness update --yes --path ${root}` });
  // canonical JSON 백필 필요 (구 MD-only → decisions.json/lessons.json)
  if (exists(decisionsPath(root)) && !exists(decisionsJsonPath(root)) && _loadDecisions(root).length > 0) findings.push({ kind: 'canonical-pending', detail: 'decisions.md → decisions.json 백필 예정', action: 'decision add/drop 또는 migrate 시 자동' });
  if (exists(lessonsPath(root)) && !exists(lessonsJsonPath(root)) && _loadLessons(root).length > 0) findings.push({ kind: 'canonical-pending', detail: 'lessons.md → lessons.json 백필 예정', action: 'lesson save/drop 또는 migrate 시 자동' });
  // 누락 예상 파일 (현재 버전 required set 기준)
  const required = REQUIRED_WORKSPACE_FILES;  // 1.9.380 (UR-0025): lib/catalogs 단일출처
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

// UR-0075 Phase C (1.9.357): migrate apply — audit가 찾은 '안전 항목'(canonical 백필)만 비파괴 적용.
// 기본 dry-run(변경 없음) · --yes 로 실제 적용. version-drift/missing-file 은 apply 범위 외(수동 안내).
function migrateApplyCmd(root, opts = {}, deps = {}) {
  const { VERSION, compareVer, REQUIRED_WORKSPACE_FILES, decisionsPath, decisionsJsonPath, lessonsPath, lessonsJsonPath, _loadDecisions, _saveDecisions, _loadLessons, _saveLessons } = deps;
  root = absRoot(root);
  const apply = !!opts.yes;
  const applied = [];   // 안전하게 적용 가능(또는 dry-run 예정): canonical 백필
  const skipped = [];   // apply 범위 외: 수동 조치 필요
  // canonical-pending: MD 항목 존재 + JSON 부재 → load(MD 백필)→save(canonical JSON + MD 정규화). idempotent(UR-0053).
  if (exists(decisionsPath(root)) && !exists(decisionsJsonPath(root)) && _loadDecisions(root).length > 0) {
    if (apply) _saveDecisions(root, _loadDecisions(root));
    applied.push({ kind: 'canonical-backfill', detail: 'decisions.md → decisions.json' });
  }
  if (exists(lessonsPath(root)) && !exists(lessonsJsonPath(root)) && _loadLessons(root).length > 0) {
    if (apply) _saveLessons(root, _loadLessons(root));
    applied.push({ kind: 'canonical-backfill', detail: 'lessons.md → lessons.json' });
  }
  // version-drift / 누락 파일 — apply 가 안전하게 in-place 처리 불가(npm 재설치/재초기화 필요) → 수동 안내.
  const hvPath = path.join(root, '.harness', 'HARNESS_VERSION');
  const projVer = exists(hvPath) ? read(hvPath).trim() : null;
  if (!projVer) skipped.push({ kind: 'no-version', detail: 'HARNESS_VERSION 없음', reason: `leerness migrate --path ${root}` });
  else if (compareVer(projVer, VERSION) < 0) skipped.push({ kind: 'version-drift', detail: `${projVer} → ${VERSION}`, reason: `leerness update --yes --path ${root}` });
  const required = REQUIRED_WORKSPACE_FILES;  // 1.9.380 (UR-0025): lib/catalogs 단일출처
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

// UR-0075 Phase D (1.9.358): migrate plan — 임시폴더에 현재 버전을 설치(서브프로세스 격리)한 뒤
// 프로젝트의 .harness 코어 관리 파일과 비교해 정확한 마이그레이션 플랜을 산출. 읽기 전용(프로젝트 미변경).
function migratePlanCmd(root, opts = {}, deps = {}) {
  const { VERSION, compareVer, decisionsPath, decisionsJsonPath, lessonsPath, lessonsJsonPath, _loadDecisions, _loadLessons, harnessPath } = deps;
  root = absRoot(root);
  const plan = { version: VERSION, root, projectVersion: null, versionDrift: null, canonicalPending: [], missingFiles: [], tempInstallOk: false, willChange: 0 };
  const hvPath = path.join(root, '.harness', 'HARNESS_VERSION');
  plan.projectVersion = exists(hvPath) ? read(hvPath).trim() : null;
  if (plan.projectVersion && compareVer(plan.projectVersion, VERSION) < 0) plan.versionDrift = `${plan.projectVersion} → ${VERSION}`;
  if (exists(decisionsPath(root)) && !exists(decisionsJsonPath(root)) && _loadDecisions(root).length > 0) plan.canonicalPending.push('decisions.md → decisions.json');
  if (exists(lessonsPath(root)) && !exists(lessonsJsonPath(root)) && _loadLessons(root).length > 0) plan.canonicalPending.push('lessons.md → lessons.json');
  // 임시폴더에 현재 버전 init → 생성되는 .harness 코어 파일(depth-1) 비교 (서브프로세스 격리, stdout 미오염)
  let tmp = null;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-plan-'));
    const langPath = path.join(root, '.harness', 'LANGUAGE');
    const lang = exists(langPath) ? (read(langPath).trim() || 'ko') : 'ko';
    const r = cp.spawnSync(process.execPath, [harnessPath, 'init', tmp, '--yes', '--language', lang, '--no-banner'], { encoding: 'utf8', timeout: 60000 });
    plan.tempInstallOk = r.status === 0;
    if (plan.tempInstallOk) {
      const tmpHarness = path.join(tmp, '.harness');
      let tmpFiles = [];
      try { tmpFiles = fs.readdirSync(tmpHarness, { withFileTypes: true }).filter(e => e.isFile()).map(e => '.harness/' + e.name); } catch {}
      for (const top of ['AGENTS.md', 'CLAUDE.md']) if (exists(path.join(tmp, top))) tmpFiles.push(top);
      for (const f of tmpFiles) if (!exists(path.join(root, f))) plan.missingFiles.push(f);
    }
  } catch {}
  finally { if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} } }
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

module.exports = { migrateAuditCmd, migrateApplyCmd, migratePlanCmd };
