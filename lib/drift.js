// lib/drift.js — drift check 핸들러 (UR-0025/UR-0125 큰 핸들러 모듈화 7번째, 1.9.422)
//   bin/leerness.js 에서 driftCheckCmd(322줄) 분리. DI: harness 고유 의존(VERSION, has, arg, harnessPath, readProgressRows, planPath, handoffPath, currentStatePath, _usageStatsPath, _readUsageStats, _updateUserRequest, _scanShellScriptsEncoding, _readFeatureGraph, _detectDeliveredRequests, _autoFixIdempotency) 주입.
//   io 프리미티브는 ./io, cp/path 빌트인. 내부 재귀(auto-fix 후 재검사)는 deps 전달. 동작/출력 무변경.
'use strict';
const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const { log, ok, warn, fail, failJson, today, now, absRoot, exists, read, readBuf, mkdirp, writeUtf8, append, rel } = require('./io');

function driftCheckCmd(root, opts = {}, deps = {}) {
  const { VERSION, has, arg, harnessPath, readProgressRows, planPath, handoffPath, currentStatePath, taskLogPath, envDiff, _usageStatsPath, _readUsageStats, _updateUserRequest, _scanShellScriptsEncoding, _readFeatureGraph, _detectDeliveredRequests, _autoFixIdempotency } = deps;
  root = absRoot(root || process.cwd());
  // 1.9.434 (11th 외부평가 Opus P2, UR-0136): 미존재 경로는 healthy 위조 금지 — failJson + exit 1.
  if (!exists(root)) { failJson(has('--json'), 'path_not_found', `경로 없음: ${root}`); return; }
  const now = Date.now();
  const _ageDays = (p) => {
    if (!exists(p)) return null;
    return (now - fs.statSync(p).mtimeMs) / 86400000;
  };
  // 각 메타파일의 마지막 갱신
  const signals = [];
  // 1. session-handoff.md - "Last generated" 라인 우선, 없으면 mtime
  const shPath = handoffPath(root);
  if (exists(shPath)) {
    const txt = read(shPath);
    // 1.9.316 (drift 마커 버그): 최신(마지막) 'Last generated' 사용 — 구 블록 중복 시 첫(구) 매치를 읽던 오발화 방어.
    const allGen = [...txt.matchAll(/Last generated:\s*([\d\-T:.Z]+)/g)];
    const m = allGen.length ? allGen[allGen.length - 1] : null;
    let ageDays;
    if (m) {
      ageDays = (now - new Date(m[1]).getTime()) / 86400000;
    } else {
      ageDays = _ageDays(shPath);
    }
    signals.push({ file: 'session-handoff.md', ageDays, threshold: 1, weight: 30, label: 'session close 누락' });
  }
  // 2. current-state.md - "Updated: YYYY-MM-DD" 라인
  const csPath = currentStatePath(root);
  if (exists(csPath)) {
    const m = read(csPath).match(/Updated:\s*(\d{4}-\d{2}-\d{2})/);
    const ageDays = m ? (now - new Date(m[1]).getTime()) / 86400000 : _ageDays(csPath);
    signals.push({ file: 'current-state.md', ageDays, threshold: 2, weight: 20, label: 'current-state 갱신 없음' });
  }
  // 3. progress-tracker.md 마지막 row의 updated 컬럼
  const rows = readProgressRows(root);
  if (rows.length) {
    const dates = rows.map(r => (r.updated || '').match(/\d{4}-\d{2}-\d{2}/)).filter(Boolean).map(m => m[0]);
    if (dates.length) {
      dates.sort();
      const latest = dates[dates.length - 1];
      const ageDays = (now - new Date(latest).getTime()) / 86400000;
      signals.push({ file: 'progress-tracker.md', ageDays, threshold: 1, weight: 30, label: 'task update 없음' });
    }
  } else {
    signals.push({ file: 'progress-tracker.md', ageDays: 999, threshold: 1, weight: 25, label: 'progress-tracker 비어있음' });
  }
  // 4. task-log.md 마지막 entry "## YYYY-MM-DD"
  const tlPath = taskLogPath(root);
  if (exists(tlPath)) {
    const dates = Array.from(read(tlPath).matchAll(/^## (\d{4}-\d{2}-\d{2})/gm)).map(m => m[1]);
    if (dates.length) {
      dates.sort();
      const latest = dates[dates.length - 1];
      const ageDays = (now - new Date(latest).getTime()) / 86400000;
      signals.push({ file: 'task-log.md', ageDays, threshold: 2, weight: 20, label: 'task-log 갱신 없음' });
    }
  }
  // 점수 계산
  let totalScore = 0;
  const fired = [];
  for (const s of signals) {
    if (s.ageDays > s.threshold) {
      totalScore += s.weight;
      fired.push(s);
    }
  }
  // 1.9.78: 보안 신호 (env / .gitignore 누락) — 5번째 신호
  try {
    const envPath = path.join(root, '.env');
    if (exists(envPath)) {
      let secScore = 0;
      const secIssues = [];
      // (a) .env vs .env.example 동기화
      try {
        const d = envDiff(root);
        if (d.inEnvOnly.length) {
          secIssues.push(`.env→.env.example 누락 ${d.inEnvOnly.length}건`);
          secScore += 15;
        }
      } catch {}
      // (b) .gitignore 시크릿 패턴
      try {
        const giText = exists(path.join(root, '.gitignore')) ? read(path.join(root, '.gitignore')) : '';
        const giLines = giText.split('\n').map(l => l.trim());
        const SECRET_PATTERNS = ['.env', '.env.local', '.env.production', '.env.*.local', '*.pem', 'credentials.json'];
        const missing = SECRET_PATTERNS.filter(p => !giLines.some(l => l === p || l === '/' + p));
        if (missing.length) {
          secIssues.push(`.gitignore 시크릿 누락 ${missing.length}건`);
          // 누락이 .env 자체면 최우선 위험 — 15점 가중
          if (missing.includes('.env')) secScore += 30;
          else secScore += Math.min(20, missing.length * 5);
        }
      } catch {}
      if (secScore > 0) {
        totalScore += secScore;
        fired.push({ file: '.env / .gitignore', ageDays: null, threshold: 0, weight: secScore, label: `보안 위험 (1.9.78): ${secIssues.join(' · ')}` });
      }
    }
  } catch {}
  // 1.9.143: Feature Graph 미사용 신호 — 노드는 있는데 edges 비율 낮으면 인과관계 정리 미진
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
        fired.push({ file: '.harness/feature-graph.md', ageDays: null, threshold: 0, weight: fgScore, label: `Feature Graph 미정리 (1.9.143): ${fGraphNodes.length} 노드, edges=${edgeCount}, isolated=${isolatedCount}` });
      }
    }
  } catch {}
  // 신규 _apps/* 에서 task 0건도 신호로
  const appsDir = path.join(root, '_apps');
  let appsZeroTask = [];
  if (exists(appsDir)) {
    for (const d of fs.readdirSync(appsDir)) {
      const sub = path.join(appsDir, d);
      if (!exists(path.join(sub, '.harness'))) continue;
      const subRows = readProgressRows(sub);
      if (!subRows.length) appsZeroTask.push(d);
    }
    if (appsZeroTask.length) {
      const w = Math.min(50, appsZeroTask.length * 10);
      totalScore += w;
      fired.push({ file: `_apps/* (${appsZeroTask.length}개)`, ageDays: null, threshold: 0, weight: w, label: `task 0건 sub-app: ${appsZeroTask.slice(0, 3).join(', ')}${appsZeroTask.length > 3 ? '...' : ''}` });
    }
  }
  // 레벨 판정
  let level = '🟢 healthy';
  if (totalScore >= 100) level = '🔴 critical';
  else if (totalScore >= 50) level = '🟡 warning';
  else if (totalScore >= 20) level = '🟠 attention';

  // 1.9.38 (D): drift critical 등급은 누적 카운트 (학습 신호)
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
  // 1.9.39: --auto-fix — critical 시 session close 자동 실행
  // 1.9.82: --auto-fix가 보안 신호도 자동 회복 (audit --fix 호출)
  // 1.9.432 (10th 외부평가 Opus latent, UR-0131 잔여): depth 가드 — 재귀 호출(_noAutoFix)은 auto-fix 재진입 금지.
  //   기존엔 autoFix=has('--auto-fix')가 전역 argv 재독→재귀도 auto-fix 분기 재진입, 종료는 'audit이 보안신호를 지운다'는 취약 불변식에 의존(미래 신호 타입이 비가역이면 무한재귀). 명시 1회 보장.
  const autoFix = has('--auto-fix') && !opts._noAutoFix;
  // 1.9.439 (10th 외부평가 Codex P1, UR-0135): --json 모드면 auto-fix 진행로그 억제(stdout 순수 JSON 보장).
  //   재귀(_noAutoFix)는 auto-fix 블록을 건너뛰고 마지막 JSON(아래 has('--json') 블록)만 출력 → afLog 로 첫 패스 진행로그만 무음화.
  const afLog = has('--json') ? () => {} : log;
  // 1.9.82: 보안 신호가 fired에 있으면 우선 audit --fix 호출
  const hasSecurityFired = fired.some(f => /보안 위험 \(1\.9\.78\)/.test(f.label));
  if (autoFix && hasSecurityFired) {
    afLog('');
    afLog(`🔒 --auto-fix 활성 (1.9.82) — 보안 신호 회복: audit --fix 자동 실행 중...`);
    try {
      const r = cp.spawnSync(process.execPath, [harnessPath, 'audit', root, '--fix'],
        { encoding: 'utf8', timeout: 30000, env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '1' } });
      if (r.status === 0) {
        afLog(`✓ audit --fix 완료 — .gitignore + .env.example 동기화`);
        // 재검사 (보안 신호 회복 확인)
        afLog('');
        afLog(`재검사 중...`);
        return driftCheckCmd(root, { ...opts, _noAutoFix: true }, deps); // 재귀 1회 (auto-fix 없이, 1.9.432 depth 가드)
      } else {
        afLog(`⚠ audit --fix 실패 (exit ${r.status}) — 수동 \`leerness audit --fix\` 권장`);
      }
    } catch (e) {
      afLog(`⚠ auto-fix 보안 회복 오류: ${e.message}`);
    }
  }
  // 1.9.242: drift check --auto-fix 에 env encoding BOM 자동 추가 통합 (사용자 명시 UR-0014 2단계)
  //   1.9.82 패턴 확장 — drift 회복 시 셸 스크립트 인코딩 위험도 자동 해결
  if (autoFix) {
    try {
      const encScan = _scanShellScriptsEncoding(root);
      if (encScan.atRisk && encScan.atRisk.length > 0) {
        afLog('');
        afLog(`🌐 --auto-fix 활성 (1.9.242) — 셸 스크립트 인코딩 위험 ${encScan.atRisk.length}건 BOM 자동 추가 중...`);
        let ok = 0;
        for (const r of encScan.atRisk) {
          try {
            const fullPath = path.join(root, r.file);
            const orig = fs.readFileSync(fullPath);
            const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
            const fixed = Buffer.concat([bom, orig]);
            fs.writeFileSync(fullPath, fixed);
            ok++;
          } catch {}
        }
        afLog(`✓ UTF-8 BOM 추가 ${ok}/${encScan.atRisk.length}건 (1.9.242 UR-0014)`);
      }
    } catch (e) {
      afLog(`⚠ env encoding auto-fix 오류 (1.9.242): ${e.message}`);
    }
  }
  // 1.9.225: drift check --auto-fix 에 delivered 패턴 자동 적용 통합 (1.9.223/224 시스템 회수)
  //   사용자 요청에 "구현 완료" 패턴이 누적되면 가짜 미답 신호가 drift score 를 가중시킬 수 있음 → 자동 정리.
  //   1.9.82 audit --fix 패턴과 동일: --auto-fix 시 즉시 적용, 적용 후 재검사.
  if (autoFix) {
    try {
      const delivered = _detectDeliveredRequests(root);
      if (delivered.candidates && delivered.candidates.length > 0) {
        afLog('');
        afLog(`📥 --auto-fix 활성 (1.9.225) — delivered 패턴 ${delivered.candidates.length}건 자동 완료 중...`);
        let ok = 0;
        for (const c of delivered.candidates) {
          const u = _updateUserRequest(root, c.id, { status: 'completed', autoCompletedAt: new Date().toISOString(), autoCompleteReason: 'drift-auto-fix-1.9.225' });
          if (u) ok++;
        }
        afLog(`✓ delivered 자동 완료 ${ok}/${delivered.candidates.length}건`);
      }
    } catch (e) {
      afLog(`⚠ delivered auto-apply 오류 (1.9.225): ${e.message}`);
    }
  }
  // 1.9.293: drift check --auto-fix 에 idempotency task/user-request 중복 자동 정리 통합
  //   누적 중복 task/요청이 idempotency 위반(medium)을 가중 → drift/handoff 노이즈. 안전: 완전중복 행 제거 + 동일텍스트 dropped 보존(id 유지).
  if (autoFix) {
    try {
      const idemFixes = _autoFixIdempotency(root);
      const totalFixed = idemFixes.reduce((n, f) => n + (f.removedExact || 0) + (f.droppedSameText || 0) + (f.count || 0), 0);
      if (totalFixed > 0) {
        afLog('');
        afLog(`🔁 --auto-fix 활성 (1.9.293) — idempotency 중복 ${totalFixed}건 자동 정리 (task/user-request dedup)`);
      }
    } catch (e) {
      afLog(`⚠ idempotency auto-fix 오류 (1.9.293): ${e.message}`);
    }
  }
  // 1.9.236: drift check --auto-fix 에 release cleanup 통합 (1.9.235 회수)
  //   누적된 50개+ release/* branches → abnormal-shutdown release-branch-pending 신호 가중
  //   안전: keep 10 (최근 10개 유지), merged 만 삭제 (1.9.235 안전 가드)
  //   임계: 50개 초과 시만 자동 정리 (소량 누적은 정상 운영)
  if (autoFix) {
    try {
      const branchR = cp.spawnSync('git', ['branch', '--merged', 'main', '--list', 'release/*'], { cwd: root, encoding: 'utf8' });
      if (branchR.status === 0) {
        const merged = (branchR.stdout || '').split('\n')
          .map(l => l.replace(/^\*?\s+/, '').trim())
          .filter(l => l && /^release\/\d+\.\d+\.\d+$/.test(l));
        if (merged.length > 50) {
          afLog('');
          afLog(`🗑 --auto-fix 활성 (1.9.236) — release/* merged ${merged.length}개 (50+) 자동 정리 (keep 10)...`);
          // 정렬 (semver desc)
          merged.sort((a, b) => {
            const va = a.replace('release/', '').split('.').map(n => parseInt(n, 10) || 0);
            const vb = b.replace('release/', '').split('.').map(n => parseInt(n, 10) || 0);
            for (let i = 0; i < 3; i++) if (va[i] !== vb[i]) return vb[i] - va[i];
            return 0;
          });
          const currentBranchR = cp.spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' });
          const currentBranch = (currentBranchR.stdout || '').trim();
          const toDelete = merged.slice(10).filter(b => b !== currentBranch);
          let ok = 0;
          for (const b of toDelete) {
            const r = cp.spawnSync('git', ['branch', '-d', b], { cwd: root, encoding: 'utf8' });
            if (r.status === 0) ok++;
          }
          afLog(`✓ release cleanup 자동 완료 ${ok}/${toDelete.length}건 (keep 10)`);
        }
      }
    } catch (e) {
      afLog(`⚠ release cleanup auto-fix 오류 (1.9.236): ${e.message}`);
    }
  }
  if (autoFix && level === '🔴 critical' && !hasSecurityFired) {
    afLog('');
    afLog(`🔧 --auto-fix 활성 — session close 자동 실행 중...`);
    try {
      const r = cp.spawnSync(process.execPath, [harnessPath, 'session', 'close', root], { encoding: 'utf8', timeout: 60000, env: { ...process.env, LEERNESS_INTERNAL: '1' } });
      if (r.status === 0) {
        afLog(`✓ session close 자동 완료`);
        // autoResolved 카운트
        const stats = _readUsageStats(root);
        stats.drift = stats.drift || {};
        stats.drift.autoResolved = (stats.drift.autoResolved || 0) + 1;
        const p = _usageStatsPath(root);
        mkdirp(path.dirname(p));
        writeUtf8(p, JSON.stringify(stats, null, 2) + '\n');
        // 재검사
        afLog('');
        afLog(`재검사 중...`);
        return driftCheckCmd(root, { ...opts, _noAutoFix: true }, deps); // 재귀 1회 (auto-fix 없이, 1.9.432 depth 가드)
      } else {
        afLog(`⚠ session close 실패 (exit ${r.status}) — 수동 실행 필요`);
      }
    } catch (e) {
      afLog(`⚠ auto-fix 오류: ${e.message}`);
    }
  }
  if (has('--json')) {
    log(JSON.stringify({ root, score: totalScore, level, signals, fired, appsZeroTask }, null, 2));
    return;
  }
  log(`# leerness drift check (1.9.37)`);
  log(`경로: ${root}`);
  log('');
  log(`상태: ${level}  ·  점수 ${totalScore}/200`);
  log('');
  log(`| 신호 | age | 임계 | 가중치 | 발화 |`);
  log(`|---|---:|---:|---:|---|`);
  for (const s of signals) {
    const fire = s.ageDays > s.threshold ? '🔥' : '✓';
    const age = s.ageDays === null ? '-' : `${s.ageDays.toFixed(1)}d`;
    log(`| ${s.label} | ${age} | ${s.threshold}d | ${s.weight} | ${fire} |`);
  }
  if (appsZeroTask.length) {
    log('');
    log(`task 0건 sub-app (${appsZeroTask.length}개): ${appsZeroTask.join(', ')}`);
  }
  if (totalScore >= 50) {
    log('');
    log(`💡 권장 조치:`);
    log(`  - 즉시: leerness session close .                (handoff/current-state 갱신)`);
    log(`  - 또는: leerness audit . --fix                  (자동 갱신 가능 항목 적용)`);
    log(`  - sub-app에 task 등록: cd _apps/X && leerness task add "..."`);
    log(`  - 이 검사 끄기: --no-drift-check 또는 LEERNESS_NO_DRIFT_CHECK=1`);
  }
  if (level === '🔴 critical') process.exitCode = 1;
}

module.exports = { driftCheckCmd };
