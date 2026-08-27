#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const cliPath = path.join(__dirname, '..', 'bin', 'leerness.js');
const source = fs.readFileSync(cliPath, 'utf8');
const start = source.indexOf('function _suggestNextActions(');
const end = source.indexOf('function _autoInstallQueryFromHandoff(', start);
if (start < 0 || end <= start) {
  console.error('next-action-suggestion-probe: generator boundaries not found');
  process.exit(1);
}

const generator = source.slice(start, end);
const resumeBuildStart = source.indexOf('function _buildAutoResumePlan(');
const resumeBuildEnd = source.indexOf('function resumeCmd(', resumeBuildStart);
const resumeBuilder = resumeBuildStart >= 0 && resumeBuildEnd > resumeBuildStart
  ? source.slice(resumeBuildStart, resumeBuildEnd)
  : '';
const offenders = [];
const run = (args, cwd) => cp.spawnSync(process.execPath, [cliPath, ...args], {
  cwd,
  encoding: 'utf8',
  timeout: 15000,
  env: { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' }
});
const writeQueue = (root, queue) => {
  const dir = path.join(root, '.leerness');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'next-action-queue.json'), JSON.stringify({ queue, at: new Date().toISOString() }, null, 2), 'utf8');
};
const commandArgs = (command) => (String(command).match(/"[^"]*"|\S+/g) || []).map(x => x.startsWith('"') ? x.slice(1, -1) : x);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hasLegacySuggestion = actions => (Array.isArray(actions) ? actions : []).some(a =>
  /\s--filter(?:\s|$)/.test(String(a.command || ''))
  || String(a.command || '').includes('./scripts/e2e.js')
  || /task update .* --status completed/.test(String(a.command || ''))
  || (/^progress-tracker \d+h 정체/.test(String(a.title || '')))
  || (/^node _apps\/leerness-stress/.test(String(a.command || '')))
);

async function reproduceTakeMigrationRace(root) {
  const queuePath = path.join(root, '.leerness', 'next-action-queue.json');
  const lockPath = queuePath + '.lock';
  const oldAction = {
    icon: '🔄',
    title: 'progress-tracker 24h 정체 — task T-0001 status 갱신',
    command: 'leerness task update T-0001 --status completed'
  };
  const concurrentAction = { ...oldAction, title: 'progress-tracker 25h 정체 — task T-0001 status 갱신' };
  writeQueue(root, [oldAction]);
  fs.mkdirSync(lockPath);

  const child = cp.spawn(process.execPath, [cliPath, 'next-action', 'take', '0', '--path', root], {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  let sawSelection;
  const selected = new Promise(resolve => { sawSelection = resolve; });
  child.stdout.on('data', chunk => { stdout += chunk; sawSelection(); });
  child.stderr.on('data', chunk => { stderr += chunk; });
  await Promise.race([selected, delay(1000)]);

  // Current buggy take has already selected the 24h title outside the lock. A concurrent
  // normalizer changes that title while holding the queue lock, so its later title lookup misses.
  writeQueue(root, [concurrentAction]);
  fs.rmdirSync(lockPath);
  const result = await new Promise(resolve => {
    const timer = setTimeout(() => { try { child.kill(); } catch {} resolve({ code: null, stdout, stderr, timeout: true }); }, 15000);
    child.on('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr, timeout: false }); });
  });
  const persisted = JSON.parse(fs.readFileSync(queuePath, 'utf8')).queue;
  return { ...result, remaining: persisted.length };
}

async function main() {
  if (generator.includes('leerness decision list --filter')) offenders.push('decision-list-filter');
  if (generator.includes('leerness plan list --filter')) offenders.push('plan-list-filter');
  if (/stress-v\$\{latest\+1\}/.test(generator)) offenders.push('missing-stress-execution');
  if (generator.includes('node ./scripts/e2e.js')) offenders.push('consumer-missing-e2e');
  if (!resumeBuilder.includes('_normalizedNextActionState(root)')) offenders.push('auto-resume-build-raw-queue');

  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-next-action-probe-'));
  try {
    const listRoot = path.join(arena, 'list-project');
    const legacy = [
      { icon: '🎯', title: 'plan.md milestone M-0001 검증 — "install" 관련', command: 'leerness plan list --filter "install"' },
      { icon: '💭', title: 'decisions.md "install" 관련 결정 1건 영향 확인', command: 'leerness decision list --filter "install"' },
      { icon: '🧪', title: 'review-evidence.md 비어있음 — e2e 또는 verify-code 실행', command: 'node ./scripts/e2e.js' },
      { icon: '🧬', title: 'stress-v210 마지막 갱신 47h 전 — 새 stress test 작성 권장', command: 'node _apps/leerness-stress/bin/stress-v211.js' },
      { icon: '🧬', title: 'stress-v211 마지막 갱신 48h 전 — 새 stress test 작성 권장', command: 'node _apps/leerness-stress/bin/stress-v212.js' },
      { icon: '🔄', title: 'progress-tracker 24h 정체 — task T-0001 status 갱신', command: 'leerness task update T-0001 --status completed' },
      { icon: '🔄', title: 'progress-tracker 25h 정체 — task T-0001 status 갱신', command: 'leerness task update T-0001 --status completed' }
    ];
    writeQueue(listRoot, legacy);
    fs.writeFileSync(path.join(listRoot, 'package.json'), JSON.stringify({
      name: 'next-action-probe-project',
      private: true,
      scripts: { test: 'node -e "process.exit(0)"' }
    }, null, 2), 'utf8');

    const listed = run(['next-action', 'list', '--path', listRoot, '--json'], listRoot);
    let queue = [];
    try { queue = JSON.parse(listed.stdout).queue; } catch { offenders.push('list-json-contract'); }
    if (listed.status !== 0) offenders.push('list-exit');
    if (queue.some(a => /\s--filter(?:\s|$)/.test(String(a.command || '')))) offenders.push('lazy-filter-migration');
    if (queue.some(a => String(a.command || '').includes('./scripts/e2e.js'))) offenders.push('lazy-e2e-migration');
    if (queue.filter(a => a.icon === '🧬').length !== 1) offenders.push('cross-version-stress-dedup');
    if (queue.filter(a => a.icon === '🔄').length !== 1) offenders.push('hour-changing-progress-dedup');
    if (queue.some(a => a.icon === '🔄' && /\d+h/.test(String(a.title)))) offenders.push('dynamic-progress-title');
    if (queue.filter(a => ['🎯', '💭', '🧪', '🧬', '🔄'].includes(a.icon)).some(a => !a.actionKey)) offenders.push('stable-action-key');

    // Every read surface must expose the same normalized contract as next-action list/take.
    // A published release writes auto-resume-plan from this snapshot, while context is consumed
    // by external agents; leaking legacy commands through either surface reintroduces the bug.
    const planRoot = path.join(arena, 'resume-project');
    fs.mkdirSync(path.join(planRoot, '.leerness'), { recursive: true });
    fs.writeFileSync(path.join(planRoot, '.leerness', 'auto-resume-plan.json'), JSON.stringify({
      savedAt: new Date().toISOString(),
      expectedFireAt: new Date(Date.now() + 60000).toISOString(),
      nextRoundVersion: 'next after 1.36.169',
      nextActions: legacy
    }, null, 2), 'utf8');
    const resumed = run(['resume', '--path', planRoot, '--json'], planRoot);
    let resumedActions = [];
    try { resumedActions = JSON.parse(resumed.stdout).nextActions; } catch { offenders.push('resume-json-contract'); }
    if (resumed.status !== 0) offenders.push('resume-exit');
    if (hasLegacySuggestion(resumedActions)) offenders.push('legacy-auto-resume-plan');
    if ((resumedActions || []).filter(a => a.icon === '🧬').length !== 1
      || (resumedActions || []).filter(a => a.icon === '🔄').length !== 1) offenders.push('auto-resume-plan-dedup');

    const contextual = run(['context', '--path', listRoot, '--json'], listRoot);
    let contextActions = [];
    try { contextActions = JSON.parse(contextual.stdout).nextActions; } catch { offenders.push('context-json-contract'); }
    if (contextual.status !== 0) offenders.push('context-exit');
    if (hasLegacySuggestion(contextActions)) offenders.push('context-raw-queue');

    const preWake = run(['pre-wake-audit', '--path', listRoot, '--json'], listRoot);
    let pendingFinding = null;
    try {
      const report = JSON.parse(preWake.stdout);
      pendingFinding = (report.findings.info || []).find(f => f.kind === 'next-action-pending');
    } catch { offenders.push('pre-wake-json-contract'); }
    if (preWake.status !== 0) offenders.push('pre-wake-exit');
    if (!pendingFinding) offenders.push('pre-wake-missing-next-action');
    else if (pendingFinding.count !== queue.length) offenders.push('pre-wake-raw-next-action-count');

    // Execute corrected generated commands against an ordinary project. This guards command
    // existence and flags, rather than merely asserting that selected source strings changed.
    for (const action of queue.filter(a => ['🎯', '💭', '🧪'].includes(a.icon))) {
      const args = commandArgs(action.command);
      if (args.shift() !== 'leerness') { offenders.push(`non-leerness-command:${action.icon}`); continue; }
      const result = run(args, listRoot);
      if (result.status !== 0) offenders.push(`generated-command-exit:${action.icon}`);
    }

    const raceRoot = path.join(arena, 'race-project');
    const race = await reproduceTakeMigrationRace(raceRoot);
    if (race.timeout || race.code !== 0) offenders.push('take-race-process');
    if (race.remaining !== 0) offenders.push('take-race-left-queued');
  } finally {
    try { fs.rmSync(arena, { recursive: true, force: true }); } catch {}
  }

  const required = [
    'leerness decision list --query',
    'leerness plan list --path .',
    'leerness verify-code .',
    'stress-v${latest} 오래됨 — 새 stress test 작성 권장'
  ];
  for (const needle of required) {
    if (!generator.includes(needle)) offenders.push(`missing:${needle}`);
  }
  if (offenders.length) {
    console.error(`invalid-next-action-suggestion: ${[...new Set(offenders)].join(',')}`);
    process.exit(1);
  }
  console.log('next-action suggestion probe passed: executable commands, lazy migration, stable dedup, atomic take');
}

main().catch(err => {
  console.error(`next-action-suggestion-probe: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
