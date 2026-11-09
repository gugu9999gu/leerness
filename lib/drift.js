 
 
 
'use strict';
const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const { log, ok, warn, fail, failJson, today, now, absRoot, exists, read, readBuf, mkdirp, writeUtf8, append, rel } = require('./io');
const { applyShellScriptUtf8Bom } = require('./shell-encoding');

 
 
 
const _gitSpawn = require('./git').gitSpawn;
function driftCheckCmd(root, opts = {}, deps = {}) {
  const { VERSION, has, arg, uiLang, harnessPath, readProgressRows, planPath, handoffPath, currentStatePath, taskLogPath, envDiff, _usageStatsPath, _readUsageStats, _updateUserRequest, _scanShellScriptsEncoding, _readFeatureGraph, _detectDeliveredRequests, _autoFixIdempotency } = deps;
  const gitSpawn = typeof deps._gitSpawn === 'function' ? deps._gitSpawn : _gitSpawn;
  root = absRoot(root || process.cwd());
  const t = (ko, en) => (uiLang === 'en' ? en : ko);   
   
  if (!exists(root)) { failJson(has('--json'), 'path_not_found', t(`경로 없음: ${root}`, `path not found: ${root}`)); return; }
  const now = Date.now();
  const _ageDays = (p) => {
    if (!exists(p)) return null;
    return (now - fs.statSync(p).mtimeMs) / 86400000;
  };
   
  const signals = [];
   
  const shPath = handoffPath(root);
  if (exists(shPath)) {
    const txt = read(shPath);
     
     
     
    const region = require('./context-current').currentHandoffRegion(txt);
    const allGen = [...(region === null ? txt : region).matchAll(/Last generated:\s*([\d\-T:.Z]+)/g)];
    const m = allGen.length ? allGen[allGen.length - 1] : null;
    let ageDays;
    if (m) {
       
      ageDays = (now - new Date(m[1]).getTime()) / 86400000;
      if (!Number.isFinite(ageDays)) ageDays = _ageDays(shPath);
    } else {
      ageDays = _ageDays(shPath);
    }
    signals.push({ file: 'session-handoff.md', ageDays, threshold: 1, weight: 30, label: t('session close 누락', 'session close missing') });
  }
   
  const csPath = currentStatePath(root);
  if (exists(csPath)) {
    const m = read(csPath).match(/Updated:\s*(\d{4}-\d{2}-\d{2})/);
    let ageDays = m ? (now - new Date(m[1]).getTime()) / 86400000 : _ageDays(csPath);
    if (!Number.isFinite(ageDays)) ageDays = _ageDays(csPath);    
    signals.push({ file: 'current-state.md', ageDays, threshold: 2, weight: 20, label: t('current-state 갱신 없음', 'current-state not updated') });
  }
   
  const rows = readProgressRows(root);
  if (rows.length) {
    const dates = rows.map(r => (r.updated || '').match(/\d{4}-\d{2}-\d{2}/)).filter(Boolean).map(m => m[0]).filter(d => Number.isFinite(new Date(d).getTime()));    
    if (dates.length) {
      dates.sort();
      const latest = dates[dates.length - 1];
      const ageDays = (now - new Date(latest).getTime()) / 86400000;
      signals.push({ file: 'progress-tracker.md', ageDays, threshold: 1, weight: 30, label: t('task update 없음', 'no task update') });
    }
  } else {
    signals.push({ file: 'progress-tracker.md', ageDays: 999, threshold: 1, weight: 25, label: t('progress-tracker 비어있음', 'progress-tracker empty') });
  }
   
  const tlPath = taskLogPath(root);
  if (exists(tlPath)) {
    const dates = Array.from(read(tlPath).matchAll(/^## (\d{4}-\d{2}-\d{2})/gm)).map(m => m[1]).filter(d => Number.isFinite(new Date(d).getTime()));    
    if (dates.length) {
      dates.sort();
      const latest = dates[dates.length - 1];
      const ageDays = (now - new Date(latest).getTime()) / 86400000;
      signals.push({ file: 'task-log.md', ageDays, threshold: 2, weight: 20, label: t('task-log 갱신 없음', 'task-log not updated') });
    }
  }
   
  let totalScore = 0;
  const fired = [];
  for (const s of signals) {
    if (s.ageDays > s.threshold) {
      totalScore += s.weight;
      fired.push(s);
    }
  }
   
  try {
    const envPath = path.join(root, '.env');
    if (exists(envPath)) {
      let secScore = 0;
      const secIssues = [];
       
      try {
        const d = envDiff(root);
        if (d.inEnvOnly.length) {
          secIssues.push(t(`.env→.env.example 누락 ${d.inEnvOnly.length}건`, `.env→.env.example missing ${d.inEnvOnly.length}`));
          secScore += 15;
        }
      } catch {}
       
      try {
        const giText = exists(path.join(root, '.gitignore')) ? read(path.join(root, '.gitignore')) : '';
        const giLines = giText.split('\n').map(l => l.trim());
        const SECRET_PATTERNS = ['.env', '.env.local', '.env.production', '.env.*.local', '*.pem', 'credentials.json'];
        const missing = SECRET_PATTERNS.filter(p => !giLines.some(l => l === p || l === '/' + p));
        if (missing.length) {
          secIssues.push(t(`.gitignore 시크릿 누락 ${missing.length}건`, `.gitignore missing secret patterns ${missing.length}`));
           
          if (missing.includes('.env')) secScore += 30;
          else secScore += Math.min(20, missing.length * 5);
        }
      } catch {}
      if (secScore > 0) {
        totalScore += secScore;
        fired.push({ file: '.env / .gitignore', ageDays: null, threshold: 0, weight: secScore, label: t(`보안 위험 (1.9.78): ${secIssues.join(' · ')}`, `security risk: ${secIssues.join(' · ')}`) });
      }
    }
  } catch {}
   
  try {
    const { nodes: fGraphNodes } = _readFeatureGraph(root);
    if (fGraphNodes.length >= 3) {
      const edgeCount = fGraphNodes.reduce((s, n) => s + (n.dependsOn?.length || 0) + (n.affects?.length || 0) + (n.coChangesWith?.length || 0), 0);
      const linkedSet = new Set();
      for (const n of fGraphNodes) {
        for (const x of [...(n.dependsOn||[]), ...(n.affects||[]), ...(n.coChangesWith||[])]) { linkedSet.add(n.id); linkedSet.add(x); }
      }
      const isolatedCount = Math.max(0, fGraphNodes.length - linkedSet.size);
      const isolatedRatio = isolatedCount / fGraphNodes.length;
      if (edgeCount === 0 || isolatedRatio >= 0.5) {
        const fgScore = edgeCount === 0 ? 25 : 15;
        totalScore += fgScore;
        fired.push({ file: '.leerness/feature-graph.md', ageDays: null, threshold: 0, weight: fgScore, label: t(`Feature Graph 미정리 (1.9.143): ${fGraphNodes.length} 노드, edges=${edgeCount}, isolated=${isolatedCount}`, `Feature Graph unlinked: ${fGraphNodes.length} nodes, edges=${edgeCount}, isolated=${isolatedCount}`) });
      }
    }
  } catch {}
   
  const appsDir = path.join(root, '_apps');
  let appsZeroTask = [];
  if (exists(appsDir)) {
    for (const d of fs.readdirSync(appsDir)) {
      const sub = path.join(appsDir, d);
      if (!exists(path.join(sub, '.leerness'))) continue;
      const subRows = readProgressRows(sub);
      if (!subRows.length) appsZeroTask.push(d);
    }
    if (appsZeroTask.length) {
      const w = Math.min(50, appsZeroTask.length * 10);
      totalScore += w;
      fired.push({ file: `_apps/* (${appsZeroTask.length}개)`, ageDays: null, threshold: 0, weight: w, label: t(`task 0건 sub-app: ${appsZeroTask.slice(0, 3).join(', ')}${appsZeroTask.length > 3 ? '...' : ''}`, `sub-app with 0 tasks: ${appsZeroTask.slice(0, 3).join(', ')}${appsZeroTask.length > 3 ? '...' : ''}`) });
    }
  }
   
  let level = '🟢 healthy';
  if (totalScore >= 100) level = '🔴 critical';
  else if (totalScore >= 50) level = '🟡 warning';
  else if (totalScore >= 20) level = '🟠 attention';

   
  try {
    if (level === '🔴 critical') {
      const stats = _readUsageStats(root);
      stats.drift = stats.drift || {};
      stats.drift.criticalSeen = (stats.drift.criticalSeen || 0) + 1;
      const p = _usageStatsPath(root);
      mkdirp(path.dirname(p));
      writeUtf8(p, JSON.stringify(stats, null, 2) + '\n');
    }
  } catch {}
   
   
   
   
  const autoFix = has('--auto-fix') && !opts._noAutoFix;
   
   
  const afLog = has('--json') ? () => {} : log;
  const encodingFixErrors = Array.isArray(opts._encodingFixErrors) ? opts._encodingFixErrors.slice() : [];
  const inheritedEncodingAutoFix = opts._encodingAutoFix && typeof opts._encodingAutoFix === 'object'
    ? opts._encodingAutoFix : null;
  const encodingAutoFix = inheritedEncodingAutoFix
    ? { ...inheritedEncodingAutoFix, results: Array.isArray(inheritedEncodingAutoFix.results) ? inheritedEncodingAutoFix.results.slice() : [] }
    : { requested: has('--auto-fix'), attempted: false, status: 'not-needed', scanned: 0, atRisk: 0, added: 0, skipped: 0, failed: 0, scanErrors: [], results: [] };
  const inheritedAutoFixSummary = opts._autoFixSummary && typeof opts._autoFixSummary === 'object'
    ? opts._autoFixSummary : null;
  const autoFixSummary = inheritedAutoFixSummary
    ? JSON.parse(JSON.stringify(inheritedAutoFixSummary))
    : {
      requested: has('--auto-fix'),
      failed: 0,
      stages: {
        security: { attempted: false, status: 'not-needed', failed: 0, results: [] },
        delivered: { attempted: false, status: 'not-needed', failed: 0, results: [] },
        idempotency: { attempted: false, status: 'not-needed', failed: 0, results: [] },
        releaseCleanup: { attempted: false, status: 'not-needed', failed: 0, results: [] },
        session: { attempted: false, status: 'not-needed', failed: 0, results: [] },
      },
    };
  const stage = name => {
    autoFixSummary.stages[name] = autoFixSummary.stages[name]
      || { attempted: false, status: 'not-needed', failed: 0, results: [] };
    return autoFixSummary.stages[name];
  };
  const stageFail = (name, result) => {
    const s = stage(name);
    s.attempted = true;
    s.status = 'failed';
    s.failed = (s.failed || 0) + 1;
    s.results = Array.isArray(s.results) ? s.results : [];
    s.results.push(result);
  };
  const refreshAutoFixFailureCount = () => {
    autoFixSummary.stages.encoding = encodingAutoFix;
    autoFixSummary.failed = Object.values(autoFixSummary.stages)
      .reduce((n, s) => n + (Number(s && s.failed) || 0), 0);
    return autoFixSummary.failed;
  };
  let autoFixNeedsRecheck = false;
   
   
  const hasSecurityFired = fired.some(f => f.file === '.env / .gitignore');
  if (autoFix && hasSecurityFired) {
    const securityStage = stage('security');
    securityStage.attempted = true;
    securityStage.status = 'running';
    afLog('');
    afLog(t(`🔒 --auto-fix 활성 (1.9.82) — 보안 신호 회복: audit --fix 자동 실행 중...`, `🔒 --auto-fix on — recovering security signal: running audit --fix...`));
    try {
      const r = cp.spawnSync(process.execPath, [harnessPath, 'audit', root, '--fix'],
        { encoding: 'utf8', timeout: 30000, env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '1' } });
      if (r.status === 0) {
        securityStage.status = 'applied';
        securityStage.results.push({ action: 'audit-fix', status: 'applied', exitCode: 0 });
        afLog(t(`✓ audit --fix 완료 — .gitignore + .env.example 동기화`, `✓ audit --fix done — .gitignore + .env.example synced`));
         
         
        autoFixNeedsRecheck = true;
      } else {
        stageFail('security', { action: 'audit-fix', status: 'failed', exitCode: r.status, stderr: String(r.stderr || '').trim().slice(0, 500) });
        afLog(t(`⚠ audit --fix 실패 (exit ${r.status}) — 수동 \`leerness audit --fix\` 권장`, `⚠ audit --fix failed (exit ${r.status}) — run \`leerness audit --fix\` manually`));
      }
    } catch (e) {
      stageFail('security', { action: 'audit-fix', status: 'failed', code: e.code || 'error', error: e.message });
      afLog(t(`⚠ auto-fix 보안 회복 오류: ${e.message}`, `⚠ auto-fix security recovery error: ${e.message}`));
    }
  }
   
   
  if (autoFix) {
    try {
      encodingAutoFix.attempted = true;
      encodingAutoFix.status = 'scanned';
      const encScan = _scanShellScriptsEncoding(root);
      encodingAutoFix.scanned = encScan.scanned || 0;
      encodingAutoFix.atRisk = Array.isArray(encScan.atRisk) ? encScan.atRisk.length : 0;
      encodingAutoFix.scanErrors = Array.isArray(encScan.scanErrors) ? encScan.scanErrors.slice() : [];
      for (const scanError of encodingAutoFix.scanErrors) {
        const failure = { file: scanError.file, action: 'failed-scan', code: scanError.code, error: scanError.error, operation: scanError.operation };
        encodingFixErrors.push(failure);
        encodingAutoFix.failed++;
        encodingAutoFix.results.push(failure);
      }
      if (encScan.atRisk && encScan.atRisk.length > 0) {
        afLog('');
        afLog(t(`🌐 --auto-fix 활성 (1.9.242) — 셸 스크립트 인코딩 위험 ${encScan.atRisk.length}건 BOM 자동 추가 중...`, `🌐 --auto-fix on — adding UTF-8 BOM to ${encScan.atRisk.length} at-risk shell script(s)...`));
        let ok = 0;
        let skipped = 0;
        for (const r of encScan.atRisk) {
          try {
            const fullPath = path.join(root, r.file);
            const applied = applyShellScriptUtf8Bom(fullPath, r.file);
            encodingAutoFix.results.push(applied);
            if (applied.action === 'utf8-bom-added') { ok++; encodingAutoFix.added++; }
            else if (applied.action.startsWith('skipped-')) { skipped++; encodingAutoFix.skipped++; }
            if (applied.backupFile) afLog(t(`  ↳ 원본/동시 편집 복구본 보존: ${applied.backupFile}`, `  ↳ retained original/concurrent recovery copy: ${applied.backupFile}`));
          } catch (e) {
            const failure = { file: r.file, action: 'failed', code: e.code || 'error', error: e.message, ...(e.backupFile ? { backupFile: e.backupFile } : {}) };
            if (e.recoveryArtifacts) failure.recoveryArtifacts = e.recoveryArtifacts;
            encodingFixErrors.push(failure);
            encodingAutoFix.failed++;
            encodingAutoFix.results.push(failure);
            afLog(t(`⚠ 인코딩 자동 수정 거부: ${r.file} — ${e.message}`, `⚠ encoding auto-fix refused: ${r.file} — ${e.message}`));
          }
        }
        afLog(t(`✓ UTF-8 BOM 추가 ${ok}/${encScan.atRisk.length}건${skipped > 0 ? ` · 안전상 건너뜀 ${skipped}건` : ''} (1.9.242 UR-0014)`, `✓ added UTF-8 BOM ${ok}/${encScan.atRisk.length}${skipped > 0 ? ` · safely skipped ${skipped}` : ''}`));
      }
      encodingAutoFix.status = encodingAutoFix.failed > 0 ? 'failed'
        : (encodingAutoFix.added > 0 ? 'applied' : (encodingAutoFix.skipped > 0 ? 'skipped' : 'not-needed'));
      if (encodingAutoFix.added > 0) autoFixNeedsRecheck = true;
    } catch (e) {
      const failure = { file: null, action: 'failed', code: e.code || 'error', error: e.message };
      encodingFixErrors.push(failure);
      encodingAutoFix.failed++;
      encodingAutoFix.status = 'failed';
      encodingAutoFix.results.push(failure);
      afLog(t(`⚠ env encoding auto-fix 오류 (1.9.242): ${e.message}`, `⚠ env encoding auto-fix error: ${e.message}`));
    }
  }
   
   
   
  if (autoFix) {
    const deliveredStage = stage('delivered');
    deliveredStage.attempted = true;
    deliveredStage.status = 'not-needed';
    try {
      const delivered = _detectDeliveredRequests(root);
      deliveredStage.candidates = Array.isArray(delivered.candidates) ? delivered.candidates.length : 0;
      if (delivered.candidates && delivered.candidates.length > 0) {
        afLog('');
        afLog(t(`📥 --auto-fix 활성 (1.9.225) — delivered 패턴 ${delivered.candidates.length}건 자동 완료 중...`, `📥 --auto-fix on — auto-completing ${delivered.candidates.length} delivered pattern(s)...`));
        let ok = 0;
        for (const c of delivered.candidates) {
          try {
            const u = _updateUserRequest(root, c.id, { status: 'completed', autoCompletedAt: new Date().toISOString(), autoCompleteReason: 'drift-auto-fix-1.9.225' });
            if (u) {
              ok++;
              deliveredStage.results.push({ id: c.id, action: 'completed', status: 'applied' });
            } else {
              stageFail('delivered', { id: c.id, action: 'completed', status: 'failed', error: 'request update returned no result' });
            }
          } catch (e) {
            stageFail('delivered', { id: c.id, action: 'completed', status: 'failed', code: e.code || 'error', error: e.message });
          }
        }
        if (deliveredStage.failed === 0) deliveredStage.status = 'applied';
        deliveredStage.applied = ok;
        if (ok > 0) autoFixNeedsRecheck = true;
        afLog(t(`✓ delivered 자동 완료 ${ok}/${delivered.candidates.length}건`, `✓ delivered auto-completed ${ok}/${delivered.candidates.length}`));
      }
    } catch (e) {
      stageFail('delivered', { action: 'detect-or-apply', status: 'failed', code: e.code || 'error', error: e.message });
      afLog(t(`⚠ delivered auto-apply 오류 (1.9.225): ${e.message}`, `⚠ delivered auto-apply error: ${e.message}`));
    }
  }
   
   
  if (autoFix) {
    const idempotencyStage = stage('idempotency');
    idempotencyStage.attempted = true;
    idempotencyStage.status = 'not-needed';
    try {
      const idemFixes = _autoFixIdempotency(root);
      idempotencyStage.results = Array.isArray(idemFixes) ? idemFixes.slice() : [];
      const totalFixed = idemFixes.reduce((n, f) => n + (f.removedExact || 0) + (f.droppedSameText || 0) + (f.count || 0), 0);
       
       
      const idemFailed = idemFixes.filter(f => f.action === 'error');
      if (idemFailed.length) {
        idempotencyStage.status = 'failed';
        idempotencyStage.failed += idemFailed.length;
        afLog('');
        afLog(t(`❌ idempotency auto-fix 실패 ${idemFailed.length}건 — 중복이 남아 있다: ${idemFailed.map(f => f.detail || f.kind).join(' · ')}`,
          `❌ idempotency auto-fix failed ${idemFailed.length} — duplicates remain: ${idemFailed.map(f => f.detail || f.kind).join(' · ')}`));
      }
      if (totalFixed > 0) {
        if (idempotencyStage.failed === 0) idempotencyStage.status = 'applied';
        idempotencyStage.applied = totalFixed;
        autoFixNeedsRecheck = true;
        afLog('');
        afLog(t(`🔁 --auto-fix 활성 (1.9.293) — idempotency 중복 ${totalFixed}건 자동 정리 (task/user-request dedup)`, `🔁 --auto-fix on — deduped ${totalFixed} idempotency duplicate(s) (task/user-request)`));
      }
    } catch (e) {
      stageFail('idempotency', { action: 'deduplicate', status: 'failed', code: e.code || 'error', error: e.message });
      afLog(t(`⚠ idempotency auto-fix 오류 (1.9.293): ${e.message}`, `⚠ idempotency auto-fix error: ${e.message}`));
    }
  }
   
   
   
   
  if (autoFix) {
    const releaseStage = stage('releaseCleanup');
    releaseStage.attempted = true;
    releaseStage.status = 'not-needed';
    try {
       
       
       
       
      const refsR = gitSpawn(['for-each-ref', '--format=%(refname:short)', 'refs/heads/release/'], { cwd: root, encoding: 'utf8' });
      if (refsR.status === 0) {
        const releaseRefs = (refsR.stdout || '').split('\n')
          .map(l => l.trim())
          .filter(l => /^release\/\d+\.\d+\.\d+$/.test(l));
        releaseStage.candidates = releaseRefs.length;
        if (releaseRefs.length <= 50) {
          releaseStage.results.push({ action: 'list-release-refs', status: 'not-needed', count: releaseRefs.length, threshold: 50 });
        } else {
          const branchR = gitSpawn(['branch', '--merged', 'main', '--list', 'release/*'], { cwd: root, encoding: 'utf8' });
          if (branchR.status !== 0) {
            stageFail('releaseCleanup', {
              action: 'list-merged', status: 'failed', exitCode: branchR.status,
              ...(branchR.error ? { code: branchR.error.code || 'error', error: branchR.error.message || String(branchR.error) } : {}),
              stderr: String(branchR.stderr || '').trim().slice(0, 500),
            });
          } else {
            const merged = (branchR.stdout || '').split('\n')
              .map(l => l.replace(/^\*?\s+/, '').trim())
              .filter(l => l && /^release\/\d+\.\d+\.\d+$/.test(l));
            if (merged.length > 50) {
              afLog('');
              afLog(t(`🗑 --auto-fix 활성 (1.9.236) — release/* merged ${merged.length}개 (50+) 자동 정리 (keep 10)...`, `🗑 --auto-fix on — cleaning up ${merged.length} merged release/* branches (50+, keep 10)...`));
               
              merged.sort((a, b) => {
                const va = a.replace('release/', '').split('.').map(n => parseInt(n, 10) || 0);
                const vb = b.replace('release/', '').split('.').map(n => parseInt(n, 10) || 0);
                for (let i = 0; i < 3; i++) if (va[i] !== vb[i]) return vb[i] - va[i];
                return 0;
              });
              const currentBranchR = gitSpawn(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' });
              if (currentBranchR.status !== 0) {
                stageFail('releaseCleanup', { action: 'current-branch', status: 'failed', exitCode: currentBranchR.status, stderr: String(currentBranchR.stderr || '').trim().slice(0, 500) });
              }
              const currentBranch = (currentBranchR.stdout || '').trim();
              const toDelete = currentBranchR.status === 0 ? merged.slice(10).filter(b => b !== currentBranch) : [];
              let ok = 0;
              for (const b of toDelete) {
                const r = gitSpawn(['branch', '-d', b], { cwd: root, encoding: 'utf8' });
                if (r.status === 0) {
                  ok++;
                  releaseStage.results.push({ branch: b, action: 'delete', status: 'applied' });
                } else {
                  stageFail('releaseCleanup', { branch: b, action: 'delete', status: 'failed', exitCode: r.status, stderr: String(r.stderr || '').trim().slice(0, 500) });
                }
              }
              releaseStage.applied = ok;
              if (releaseStage.failed === 0) releaseStage.status = 'applied';
              if (ok > 0) autoFixNeedsRecheck = true;
              afLog(t(`✓ release cleanup 자동 완료 ${ok}/${toDelete.length}건 (keep 10)`, `✓ release cleanup done ${ok}/${toDelete.length} (keep 10)`));
            }
          }
        }
      } else {
        const repoR = gitSpawn(['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' });
        if (refsR.error || repoR.error || repoR.status === 0) {
          const spawnError = refsR.error || repoR.error;
          stageFail('releaseCleanup', {
            action: 'list-release-refs', status: 'failed', exitCode: refsR.status,
            ...(spawnError ? { code: spawnError.code || 'error', error: spawnError.message || String(spawnError) } : {}),
            stderr: String(refsR.stderr || '').trim().slice(0, 500),
          });
        } else {
          releaseStage.status = 'not-applicable';
          releaseStage.results.push({ action: 'list-release-refs', status: 'skipped', reason: 'not-a-git-worktree' });
        }
      }
    } catch (e) {
      stageFail('releaseCleanup', { action: 'cleanup', status: 'failed', code: e.code || 'error', error: e.message });
      afLog(t(`⚠ release cleanup auto-fix 오류 (1.9.236): ${e.message}`, `⚠ release cleanup auto-fix error: ${e.message}`));
    }
  }
  if (autoFix && level === '🔴 critical') {
    const sessionStage = stage('session');
    sessionStage.attempted = true;
    sessionStage.status = 'running';
    afLog('');
    afLog(t(`🔧 --auto-fix 활성 — session close 자동 실행 중...`, `🔧 --auto-fix on — running session close...`));
    try {
      const r = cp.spawnSync(process.execPath, [harnessPath, 'session', 'close', root], { encoding: 'utf8', timeout: 60000, env: { ...process.env, LEERNESS_INTERNAL: '1' } });
      if (r.status === 0) {
        sessionStage.status = 'applied';
        sessionStage.results.push({ action: 'session-close', status: 'applied', exitCode: 0 });
        afLog(t(`✓ session close 자동 완료`, `✓ session close done`));
         
        const stats = _readUsageStats(root);
        stats.drift = stats.drift || {};
        stats.drift.autoResolved = (stats.drift.autoResolved || 0) + 1;
        const p = _usageStatsPath(root);
        mkdirp(path.dirname(p));
        writeUtf8(p, JSON.stringify(stats, null, 2) + '\n');
        autoFixNeedsRecheck = true;
      } else {
        stageFail('session', { action: 'session-close', status: 'failed', exitCode: r.status, stderr: String(r.stderr || '').trim().slice(0, 500) });
        afLog(t(`⚠ session close 실패 (exit ${r.status}) — 수동 실행 필요`, `⚠ session close failed (exit ${r.status}) — run manually`));
      }
    } catch (e) {
      stageFail('session', { action: 'session-close', status: 'failed', code: e.code || 'error', error: e.message });
      afLog(t(`⚠ auto-fix 오류: ${e.message}`, `⚠ auto-fix error: ${e.message}`));
    }
  }
  if (autoFixNeedsRecheck) {
    afLog('');
    afLog(t(`모든 auto-fix 단계 완료 — 재검사 중...`, `all auto-fix stages complete — re-checking...`));
    refreshAutoFixFailureCount();
    return driftCheckCmd(root, { ...opts, _noAutoFix: true, _encodingFixErrors: encodingFixErrors, _encodingAutoFix: encodingAutoFix, _autoFixSummary: autoFixSummary }, deps);
  }
  const autoFixFailures = refreshAutoFixFailureCount();
  if (has('--json')) {
     
    if (encodingFixErrors.length || autoFixFailures > 0) process.exitCode = 1;
    if (level === '🔴 critical') process.exitCode = 1;
    log(JSON.stringify({ root, score: totalScore, level, signals, fired, appsZeroTask, encodingFixErrors, encodingAutoFix: encodingAutoFix.requested ? encodingAutoFix : null, autoFixSummary: autoFixSummary.requested ? autoFixSummary : null }, null, 2));
    return;
  }
  if (encodingFixErrors.length || autoFixFailures > 0) process.exitCode = 1;
  log(`# leerness drift check (1.9.37)`);
  log(t(`경로: ${root}`, `path: ${root}`));
  log('');
  log(t(`상태: ${level}  ·  점수 ${totalScore}/200`, `status: ${level}  ·  score ${totalScore}/200`));
  log('');
  log(t(`| 신호 | age | 임계 | 가중치 | 발화 |`, `| signal | age | threshold | weight | fired |`));
  log(`|---|---:|---:|---:|---|`);
  for (const s of signals) {
    const fire = s.ageDays > s.threshold ? '🔥' : '✓';
    const age = s.ageDays === null ? '-' : `${s.ageDays.toFixed(1)}d`;
    log(`| ${s.label} | ${age} | ${s.threshold}d | ${s.weight} | ${fire} |`);
  }
  if (appsZeroTask.length) {
    log('');
    log(t(`task 0건 sub-app (${appsZeroTask.length}개): ${appsZeroTask.join(', ')}`, `sub-apps with 0 tasks (${appsZeroTask.length}): ${appsZeroTask.join(', ')}`));
  }
  if (totalScore >= 50) {
    log('');
    log(t(`💡 권장 조치:`, `💡 recommended actions:`));
    log(t(`  - 즉시: leerness session close .                (handoff/current-state 갱신)`, `  - now: leerness session close .                (refresh handoff/current-state)`));
    log(t(`  - 또는: leerness audit . --fix                  (자동 갱신 가능 항목 적용)`, `  - or: leerness audit . --fix                    (apply auto-fixable items)`));
    log(t(`  - sub-app에 task 등록: cd _apps/X && leerness task add "..."`, `  - add tasks to a sub-app: cd _apps/X && leerness task add "..."`));
    log(t(`  - 이 검사 끄기: --no-drift-check 또는 LEERNESS_NO_DRIFT_CHECK=1`, `  - disable this check: --no-drift-check or LEERNESS_NO_DRIFT_CHECK=1`));
  }
  if (level === '🔴 critical') process.exitCode = 1;
}

module.exports = { driftCheckCmd };
