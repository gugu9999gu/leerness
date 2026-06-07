// lib/health.js — health 종합 진단 핸들러 (UR-0025/UR-0125 큰 핸들러 모듈화 8번째, 1.9.423)
//   bin/leerness.js 에서 healthCmd(334줄) 분리. DI: harness 고유 의존 다수 주입.
//   io 프리미티브는 ./io, _parseArchiveBlocks 는 ./pure-utils, fs/cp/os/path 빌트인. 동작/출력 무변경.
'use strict';
const cp = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { log, ok, warn, fail, failJson, today, now, absRoot, exists, read, readBuf, mkdirp, writeUtf8, append, rel } = require('./io');
const { _parseArchiveBlocks } = require('./pure-utils');

function healthCmd(root, deps = {}) {
  const { VERSION, STATUSES, has, arg, harnessPath, listAllSkills, planPath, readProgressRows, readRules, envDiff, _collectSecretFindings, _readUsageStats, _loadDecisions, _loadLessons, _loadShellFailures, _readFeatureGraph, _scanShellScriptsEncoding, _shellEnvDrift, _computeMilestones, _computeRecentChanges, _computeRoundHistory, _collectPyFiles, _analyzePyFile, _collectRuntimeEnv, _listAPISkills, _matchAPISkills, _mcpToolCount } = deps;
  root = absRoot(root || process.cwd());
  const out = { root, generatedAt: new Date().toISOString(), checks: {} };
  // 1) drift level
  try {
    const r = cp.spawnSync(process.execPath, [harnessPath, 'drift', 'check', root, '--json'],
      { encoding: 'utf8', timeout: 15000, env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_DRIFT_CHECK: '0' } });
    const j = JSON.parse(r.stdout.trim());
    out.checks.drift = { level: j.level, score: j.score, firedCount: (j.fired || []).length };
  } catch { out.checks.drift = { error: 'drift check 실패' }; }
  // 2) 보안 상태 (1.9.418, 9th 외부평가 Codex P2): .env/.gitignore + **실제 하드코딩 시크릿 스캔**.
  //   기존엔 .env 가 .gitignore 에 있으면 critical:false 라 커밋된 하드코딩 시크릿이 있어도 health 가 healthy:true 였음(false-OK).
  //   handoff/scan secrets 와 동일하게 _collectSecretFindings 로 커밋 대상 시크릿을 반영(정직성).
  try {
    const sec = _collectSecretFindings(root);
    const committedSecrets = sec.committed.length;
    const envPath = path.join(root, '.env');
    const hasDotEnv = exists(envPath);
    const s = { hasDotEnv, committedSecrets };
    if (hasDotEnv) {
      const d = envDiff(root);
      const giText = exists(path.join(root, '.gitignore')) ? read(path.join(root, '.gitignore')) : '';
      const giLines = giText.split('\n').map(l => l.trim());
      const envInGi = giLines.includes('.env') || giLines.includes('/.env');
      const SECRET_PATTERNS = ['.env', '.env.local', '.env.production', '.env.*.local', '*.pem', 'credentials.json'];
      s.envInGitignore = envInGi;
      s.envExampleMissing = d.inEnvOnly;
      s.gitignoreMissingSecrets = SECRET_PATTERNS.filter(p => !giLines.some(l => l === p || l === '/' + p));
      s.critical = !envInGi || committedSecrets > 0;
    } else {
      s.critical = committedSecrets > 0;
    }
    out.checks.security = s;
  } catch { out.checks.security = { error: '보안 점검 실패' }; }
  // 3) skill 수 + skill query 누적
  try {
    const all = listAllSkills(root);
    const skillCount = Object.keys(all).length;
    let queryCount = 0;
    const histPath = path.join(root, '.harness', 'skill-suggestions.md');
    if (exists(histPath)) {
      queryCount = (read(histPath).match(/^## [\d-]+ [\d:]+ — query/gm) || []).length;
    }
    out.checks.skills = { installed: skillCount, queryHistoryCount: queryCount };
  } catch { out.checks.skills = { error: 'skill 점검 실패' }; }
  // 4) MCP + 명령 호출 누적
  try {
    const stats = _readUsageStats(root);
    const cmdTotal = Object.values(stats.commands || {}).reduce((s, n) => s + n, 0);
    const mcpTotal = stats.mcp?.tools ? Object.values(stats.mcp.tools).reduce((s, n) => s + n, 0) : 0;
    out.checks.usage = {
      commandTotal: cmdTotal,
      commandKinds: Object.keys(stats.commands || {}).length,
      mcpTotal,
      mcpToolKinds: stats.mcp?.tools ? Object.keys(stats.mcp.tools).length : 0,
      since: stats.since || null
    };
  } catch { out.checks.usage = { error: 'usage 점검 실패' }; }
  // 5) tasks (progress-tracker)
  try {
    const rows = readProgressRows(root);
    const byStatus = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    out.checks.tasks = { total: rows.length, byStatus };
  } catch { out.checks.tasks = { error: 'tasks 점검 실패' }; }
  // 1.9.123: memorySurface 통합 (handoff --json 1.9.115 / session close --json 1.9.122 와 동일 패턴)
  try {
    const rows = readProgressRows(root);
    const tasksByStatus = {};
    for (const s of STATUSES) tasksByStatus[s] = 0;
    for (const r of rows) tasksByStatus[r.status] = (tasksByStatus[r.status] || 0) + 1;
    const tasksInProgress = tasksByStatus['in-progress'] || 0;
    const decisionsCount = _loadDecisions(root).length;  // 1.9.339 (UR-0053): canonical 단일 진실소스
    const rules = readRules(root);
    const rulesActive = rules.filter(r => r.status === 'active').length;
    const planText = exists(planPath(root)) ? read(planPath(root)) : '';
    const milestones = (planText.match(/^### M-\d{4}\./gm) || []).length;
    const lessonsCount = _loadLessons(root).length;
    out.memorySurface = {
      tasks: { inProgress: tasksInProgress, total: rows.length, byStatus: tasksByStatus },
      decisions: { count: decisionsCount },
      rules: { active: rulesActive, total: rules.length },
      plan: { milestones },
      lessons: { count: lessonsCount },
      archive: (() => {
        // 1.9.130: archive 카운트 통합
        const a = { decisions: 0, lessons: 0, plan: 0, total: 0 };
        try {
          const hdHe = path.join(root, '.harness');
          for (const [key, file] of [['decisions', 'decisions.archive.md'], ['lessons', 'lessons.archive.md'], ['plan', 'plan.archive.md']]) {
            const fpHe = path.join(hdHe, file);
            if (exists(fpHe)) {
              const entries = _parseArchiveBlocks(read(fpHe));
              a[key] = entries.length;
              a.total += entries.length;
            }
          }
        } catch {}
        return a;
      })(),
      summary: `T${tasksInProgress}/D${decisionsCount}/R${rulesActive}/P${milestones}/L${lessonsCount}`,
    };
  } catch { out.memorySurface = { error: 'memorySurface 점검 실패' }; }
  // 1.9.143: health --json featureGraph 통합 (handoff/session close 와 동일 패턴 — JSON 4종 완성)
  try {
    const { nodes: fNodesHe } = _readFeatureGraph(root);
    const edgeCount = fNodesHe.reduce((s, n) => s + (n.dependsOn?.length || 0) + (n.affects?.length || 0) + (n.coChangesWith?.length || 0), 0);
    const linkedSet = new Set();
    for (const n of fNodesHe) {
      for (const x of [...(n.dependsOn||[]), ...(n.affects||[]), ...(n.coChangesWith||[])]) { linkedSet.add(n.id); linkedSet.add(x); }
    }
    const isolated = fNodesHe.length ? (fNodesHe.length - linkedSet.size) : 0;
    out.featureGraph = {
      total: fNodesHe.length,
      edges: edgeCount,
      isolated: Math.max(0, isolated),
      summary: `F${fNodesHe.length}/E${edgeCount}${isolated > 0 ? `/iso${isolated}` : ''}`
    };
  } catch { out.featureGraph = { error: 'featureGraph 점검 실패' }; }
  // 1.9.228: health --json roundHistory 통합 (handoff/session close 와 동일 — JSON 3 명령 일관성 + 6 통합 필드 완성)
  try {
    const rh = _computeRoundHistory(root);
    out.roundHistory = {
      roundCount: rh.roundCount,
      baselineVersion: rh.baselineVersion,
      nextMilestone: rh.nextMilestone,
      roundsToNextMilestone: rh.roundsToNextMilestone,
      daysActive: rh.daysActive,
      avgRoundsPerDay: rh.avgRoundsPerDay
    };
  } catch { out.roundHistory = { error: 'roundHistory 점검 실패' }; }
  // 1.9.230: health --json milestones 통합 (handoff/session close/health 3 명령 일관성 유지)
  try {
    const ms = _computeMilestones(root);
    out.milestones = {
      reachedCount: ms.reached.length,
      reached: ms.reached.map(m => ({ milestone: m.milestone, version: m.version, reachedAt: m.reachedAt })),
      next: ms.next,
      avgRoundsPerDay: ms.avgRoundsPerDay
    };
  } catch { out.milestones = { error: 'milestones 점검 실패' }; }
  // 1.9.234: health --json recentChanges 통합 (3 명령 8 필드 일관성)
  try {
    out.recentChanges = _computeRecentChanges(root, 5);
  } catch { out.recentChanges = { error: 'recentChanges 점검 실패' }; }
  // 1.9.240: health --json pyFiles 통합 (3 명령 9 필드 — UR-0013 2단계)
  try {
    const pyFiles = _collectPyFiles(root, 200);
    const analyses = pyFiles.slice(0, 200).map(f => _analyzePyFile(f)).filter(Boolean);
    out.pyFiles = {
      total: pyFiles.length,
      analyzed: analyses.length,
      totalLOC: analyses.reduce((s, a) => s + a.loc, 0),
      totalImports: analyses.reduce((s, a) => s + a.imports, 0),
      totalFuncs: analyses.reduce((s, a) => s + a.funcs, 0),
      totalClasses: analyses.reduce((s, a) => s + a.classes, 0)
    };
  } catch { out.pyFiles = { error: 'pyFiles 점검 실패' }; }
  // 1.9.242: health --json envInfo 통합 (3 명령 10 필드 — UR-0014 2단계)
  try {
    const runtimeEnv = _collectRuntimeEnv();
    const encScan = _scanShellScriptsEncoding(root);
    out.envInfo = {
      os: runtimeEnv.os.platform,
      isKoreanWindows: runtimeEnv.locale.isKoreanWindows || false,
      codepage: runtimeEnv.locale.codepage || null,
      nodeVersion: runtimeEnv.node.version,
      shellScriptsScanned: encScan.scanned,
      encodingRiskCount: encScan.atRisk.length,
      encodingRiskFiles: encScan.atRisk.slice(0, 5).map(r => r.file),
      // 1.9.249 (UR-0018): 터미널 출력 인코딩 안전 여부 + 자동 회복 결과
      terminalEncodingOk: runtimeEnv.locale.codepage === 65001 || !runtimeEnv.locale.isKoreanWindows,
      autoChcpApplied: process.env._LEERNESS_AUTOCHCP_APPLIED || null,
      // 1.9.250 (UR-0018 2단계): POSIX (Linux/macOS/WSL) terminal encoding 점검
      posixEncodingOk: runtimeEnv.locale.posixEncodingOk,
      isWSL: runtimeEnv.locale.isWSL || false
    };
  } catch { out.envInfo = { error: 'envInfo 점검 실패' }; }
  // 1.9.245: health --json apiSkills 통합 (3 명령 11 필드 — UR-0015)
  try {
    const allSkills = _listAPISkills(root);
    let currentTaskText = '';
    try {
      const rows = readProgressRows(root);
      const ip = rows.find(r => r.status === 'in-progress');
      if (ip) currentTaskText = (ip.title || '') + ' ' + (ip.notes || '');
    } catch {}
    const matched = currentTaskText ? _matchAPISkills(root, currentTaskText) : [];
    out.apiSkills = {
      total: allSkills.length,
      matched: matched.length,
      matchedIds: matched.slice(0, 5).map(s => s.id),
      ids: allSkills.slice(0, 10).map(s => s.id)
    };
  } catch { out.apiSkills = { error: 'apiSkills 점검 실패' }; }
  // 1.9.264: shellGuard 통합 (health JSON 12번째 통합 필드 — handoff/session close 와 JSON 3 명령 일관성) — UR-0020
  try {
    const sf = _loadShellFailures(root);
    const drift = _shellEnvDrift(root);
    out.shellGuard = {
      failureCount: sf.failures.length,
      recent: sf.failures.slice(-3).map(f => ({ cmd: (f.cmd || '').slice(0, 50), exitCode: f.exitCode, shell: f.shell, rules: f.issues || [] })),
      envDriftChanges: drift && drift.changes ? drift.changes.length : 0,
      envDrift: drift ? drift.changes : null
    };
  } catch { out.shellGuard = { error: 'shellGuard 점검 실패' }; }
  // 1.9.163: 5능력 매트릭스 자동 평가 (1.9.155 sub-agent 점검 → 코드 기반 자동화)
  //   각 능력을 코드 grep 으로 검출 → 0~100 점수. 사용자가 매 health 호출 시 leerness 자기 평가 확인.
  try {
    const harnessSrc = read(harnessPath);
    const cap = {};
    // (1) 웹 자동화 — 1.9.165 playwright bridge 통합 + 실제 playwright 설치 detect
    const hasWebBridge = /function webCmd\(root, sub/.test(harnessSrc);
    // 사용자가 playwright 설치했는지 실시간 detect (require try)
    let playwrightInstalled = false;
    try { require('playwright'); playwrightInstalled = true; }
    catch { try { require('playwright-core'); playwrightInstalled = true; } catch {} }
    if (hasWebBridge && playwrightInstalled) {
      cap.webAutomation = { score: 90, status: '✓', evidence: 'playwright 설치 + leerness web bridge (1.9.165)' };
    } else if (hasWebBridge) {
      cap.webAutomation = { score: 50, status: '⚠', evidence: 'leerness web bridge 있음, playwright 미설치 (npm i -g playwright)' };
    } else {
      cap.webAutomation = { score: 5, status: '❌', evidence: 'permissions.browser=toggle만 (실 코드 미구현)' };
    }
    // (2) PC 조작 — 1.9.166 robotjs/nut-tree bridge + 실제 설치 detect
    const hasPCBridge = /function pcCmd\(root, sub/.test(harnessSrc);
    let pcInstalled = false;
    try { require('robotjs'); pcInstalled = true; }
    catch { try { require('@nut-tree/nut-js'); pcInstalled = true; } catch {} }
    if (hasPCBridge && pcInstalled) {
      cap.pcAutomation = { score: 90, status: '✓', evidence: 'robotjs/nut-tree 설치 + leerness pc bridge (1.9.166)' };
    } else if (hasPCBridge) {
      cap.pcAutomation = { score: 50, status: '⚠', evidence: 'leerness pc bridge 있음, robotjs 미설치 (npm i -g robotjs)' };
    } else {
      cap.pcAutomation = { score: 5, status: '❌', evidence: 'permissions.mouse/keyboard=필드만 (실 사용처 0)' };
    }
    // (3) 멀티 에이전트 오케스트레이션 — agents multi --execute + consensus 로직?
    const hasExecute = /const execute = has\('--execute'\)/.test(harnessSrc);
    const hasConsensus = /multi-signal consensus/.test(harnessSrc);
    cap.multiAgentOrchestration = (hasExecute && hasConsensus)
      ? { score: 90, status: '✓', evidence: '실 spawn + multi-signal consensus (1.9.156+1.9.155)' }
      : { score: 50, status: '⚠', evidence: '명령 출력만 (1.9.152 기본 모드)' };
    // (4) REPL multi-provider — _agentRepl + _cliChat 5종?
    const hasRepl = /async function _agentRepl/.test(harnessSrc);
    const hasCliChat = /async function _cliChat/.test(harnessSrc);
    cap.replMultiProvider = (hasRepl && hasCliChat)
      ? { score: 90, status: '✓', evidence: 'ollama/claude/codex/agy/copilot 5종 (1.9.149+1.9.153)' }
      : { score: 30, status: '⚠', evidence: 'REPL 미완성' };
    // (5) MCP 도구 — tools array 카운트 (1.9.288: 정확한 도구 정의 패턴 — 자기-매칭 오탐 제거, Codex #5)
    const toolCount = _mcpToolCount();
    cap.mcpTools = toolCount >= 50
      ? { score: 100, status: '✓', evidence: `${toolCount}/50+ 도구 (1.9.159 CRUD 완성)` }
      : { score: Math.round((toolCount / 50) * 100), status: toolCount > 30 ? '✓' : '⚠', evidence: `${toolCount} 도구` };
    // (6) 코드 인텔리전스 — 1.9.167 LSP 어댑터 + typescript 설치 detect
    const hasLspBridge = /function lspCmd\(root, sub/.test(harnessSrc);
    let tsInstalled = false;
    try { require('typescript'); tsInstalled = true; } catch {}
    if (hasLspBridge && tsInstalled) {
      cap.codeIntel = { score: 90, status: '✓', evidence: 'typescript 설치 + leerness lsp bridge (1.9.167, Compiler API)' };
    } else if (hasLspBridge) {
      cap.codeIntel = { score: 50, status: '⚠', evidence: 'leerness lsp bridge 있음, typescript 미설치 (regex fallback 동작, npm i -g typescript)' };
    } else {
      cap.codeIntel = { score: 5, status: '❌', evidence: 'LSP 어댑터 미구현 (코드 인텔리전스 없음)' };
    }
    const avgScore = Math.round((cap.webAutomation.score + cap.pcAutomation.score + cap.multiAgentOrchestration.score + cap.replMultiProvider.score + cap.mcpTools.score + cap.codeIntel.score) / 6);
    out.capabilityMatrix = {
      capabilities: cap,
      overallScore: avgScore,
      summary: `웹${cap.webAutomation.score}/PC${cap.pcAutomation.score}/멀티${cap.multiAgentOrchestration.score}/REPL${cap.replMultiProvider.score}/MCP${cap.mcpTools.score}/LSP${cap.codeIntel.score} · 종합 ${avgScore}%`,
      assessment: avgScore >= 70 ? 'production-ready' : avgScore >= 50 ? 'beta-ready' : 'mvp'
    };
  } catch { out.capabilityMatrix = { error: '5능력 매트릭스 평가 실패' }; }
  // 6) issues 요약 (사용자 글로벌 룰 가시화)
  const issues = [];
  if (out.checks.drift?.level && !/healthy/.test(out.checks.drift.level)) issues.push(`drift ${out.checks.drift.level}`);
  if (out.checks.security?.committedSecrets > 0) issues.push(`🚨 커밋 대상 하드코딩 시크릿 ${out.checks.security.committedSecrets}건 (보안 CRITICAL)`);  // 1.9.418 (9th 외부평가 Codex P2)
  if (out.checks.security?.hasDotEnv && out.checks.security?.envInGitignore === false) issues.push('🚨 .env가 .gitignore에 누락 (보안 CRITICAL)');
  if (out.checks.security?.envExampleMissing?.length) issues.push(`.env→.env.example 누락 ${out.checks.security.envExampleMissing.length}건`);
  if (out.checks.security?.gitignoreMissingSecrets?.length) issues.push(`.gitignore 시크릿 누락 ${out.checks.security.gitignoreMissingSecrets.length}건`);
  out.issues = issues;
  out.healthy = issues.length === 0;

  // --strict: issue 있으면 exit 1
  if (has('--strict') && !out.healthy) process.exitCode = 1;

  if (has('--json')) { log(JSON.stringify(out, null, 2)); return; }
  log(`# leerness health (1.9.85)`);
  log(`Date: ${out.generatedAt}`);
  log(`Status: ${out.healthy ? '✅ healthy' : `⚠ ${issues.length} issues`}`);
  log('');
  log(`## drift`);
  log(`  level: ${out.checks.drift?.level || 'n/a'} (score ${out.checks.drift?.score || 0}, fired ${out.checks.drift?.firedCount || 0})`);
  log('');
  log(`## 보안`);
  if (out.checks.security?.hasDotEnv) {
    log(`  .env 존재 · .gitignore에 .env 포함: ${out.checks.security.envInGitignore ? '✓' : '✗ CRITICAL'}`);
    log(`  .env.example 누락 키: ${out.checks.security.envExampleMissing?.length || 0}건`);
    log(`  .gitignore 시크릿 패턴 누락: ${out.checks.security.gitignoreMissingSecrets?.length || 0}건`);
  } else {
    log(`  .env 없음 (검증 불필요)`);
  }
  log('');
  log(`## skills`);
  log(`  설치: ${out.checks.skills?.installed || 0}개 · skill query 누적: ${out.checks.skills?.queryHistoryCount || 0}회`);
  log('');
  log(`## usage`);
  log(`  명령 호출: ${out.checks.usage?.commandTotal || 0}회 / ${out.checks.usage?.commandKinds || 0}종`);
  log(`  MCP 호출: ${out.checks.usage?.mcpTotal || 0}회 / ${out.checks.usage?.mcpToolKinds || 0}종 도구`);
  log(`  since: ${out.checks.usage?.since || 'unknown'}`);
  log('');
  log(`## tasks`);
  const tb = out.checks.tasks?.byStatus || {};
  log(`  총 ${out.checks.tasks?.total || 0}건: ${Object.entries(tb).map(([s, n]) => `${s}=${n}`).join(', ') || '없음'}`);
  // 1.9.163: 5능력 매트릭스 — 1.9.155 sub-agent 점검의 코드 기반 자동 평가
  if (out.capabilityMatrix && !out.capabilityMatrix.error) {
    log('');
    log(`## 🧪 6능력 매트릭스 (1.9.167 자동 평가)`);
    const cm = out.capabilityMatrix;
    log(`  종합: ${cm.overallScore}% (${cm.assessment})`);
    log(`  (1) 웹 자동화        ${cm.capabilities.webAutomation.status} ${cm.capabilities.webAutomation.score}%  · ${cm.capabilities.webAutomation.evidence}`);
    log(`  (2) PC 조작          ${cm.capabilities.pcAutomation.status} ${cm.capabilities.pcAutomation.score}%  · ${cm.capabilities.pcAutomation.evidence}`);
    log(`  (3) 멀티 오케스트레이션 ${cm.capabilities.multiAgentOrchestration.status} ${cm.capabilities.multiAgentOrchestration.score}%  · ${cm.capabilities.multiAgentOrchestration.evidence}`);
    log(`  (4) REPL multi-provider ${cm.capabilities.replMultiProvider.status} ${cm.capabilities.replMultiProvider.score}%  · ${cm.capabilities.replMultiProvider.evidence}`);
    log(`  (5) MCP 도구           ${cm.capabilities.mcpTools.status} ${cm.capabilities.mcpTools.score}%  · ${cm.capabilities.mcpTools.evidence}`);
    log(`  (6) 코드 인텔리전스    ${cm.capabilities.codeIntel.status} ${cm.capabilities.codeIntel.score}%  · ${cm.capabilities.codeIntel.evidence}`);
  }
  if (issues.length) {
    log('');
    log(`## ⚠ Issues (${issues.length})`);
    for (const i of issues) log(`  - ${i}`);
    log('');
    log(`💡 자동 회복: leerness drift check --auto-fix · leerness audit --fix`);
  }
}

module.exports = { healthCmd };
