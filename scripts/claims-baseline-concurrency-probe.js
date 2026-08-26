#!/usr/bin/env node
'use strict';

// T-0145 multi-session regression: two first-time creators may both observe
// "absent", but the create-only check inside the file lock must let exactly
// one policy win and must never overwrite that winner.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const env = {
  ...process.env,
  LEERNESS_OFFLINE: '1',
  LEERNESS_NO_PROMPT: '1',
  LEERNESS_NO_AUTOCHCP: '1',
  LEERNESS_NO_AUTO_ROADMAP: '1',
  LEERNESS_NO_STALE_CHECK: '1',
  LEERNESS_INTERNAL: '1',
};

function run(root, args, timeout = 90000) {
  return cp.spawnSync(process.execPath, [CLI, ...args, '--path', root], {
    cwd: root,
    encoding: 'utf8',
    timeout,
    env,
  });
}

function spawnRun(root, args) {
  return new Promise(resolve => {
    const child = cp.spawn(process.execPath, [CLI, ...args, '--path', root], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => resolve({ status: null, stdout, stderr, error }));
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

function json(result) {
  try { return JSON.parse(result.stdout || ''); } catch { return null; }
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const failures = [];
function check(label, condition, result) {
  if (condition) { console.log(`✓ ${label}`); return; }
  failures.push(label);
  const detail = result ? `\n  ${JSON.stringify(result).slice(0, 1000)}` : '';
  console.log(`✗ ${label}${detail}`);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-claims-baseline-race-'));
  try {
    let result = cp.spawnSync(process.execPath, [CLI, 'init', root, '--yes', '--no-enforce', '--no-stale-check'], {
      cwd: root, encoding: 'utf8', timeout: 90000, env,
    });
    check('concurrency fixture init succeeds', result.status === 0, result);

    result = run(root, ['task', 'add', 'legacy one']);
    const legacyOne = (result.stdout.match(/T-\d{4,}/) || [])[0];
    result = run(root, ['task', 'update', legacyOne, '--status', 'done', '--evidence', 'ghost-one.js implemented and tested', '--next', 'legacy']);
    check('first legacy failure fixture is ready', result.status === 0 && !!legacyOne, result);

    result = run(root, ['task', 'add', 'first boundary']);
    const boundaryOne = (result.stdout.match(/T-\d{4,}/) || [])[0];
    result = run(root, ['task', 'add', 'legacy two']);
    const legacyTwo = (result.stdout.match(/T-\d{4,}/) || [])[0];
    result = run(root, ['task', 'update', legacyTwo, '--status', 'done', '--evidence', 'ghost-two.js implemented and tested', '--next', 'legacy']);
    check('second legacy failure fixture is ready', result.status === 0 && !!legacyTwo, result);

    result = run(root, ['task', 'add', 'second boundary']);
    const boundaryTwo = (result.stdout.match(/T-\d{4,}/) || [])[0];
    check('two distinct policy boundaries are ready', result.status === 0 && !!boundaryOne && !!boundaryTwo, result);

    const contenders = await Promise.all([
      spawnRun(root, ['verify-claim', 'baseline', 'create', '--before', boundaryOne, '--yes', '--json']),
      spawnRun(root, ['verify-claim', 'baseline', 'create', '--before', boundaryTwo, '--yes', '--json']),
    ]);
    const winners = contenders.filter(item => item.status === 0 && json(item)?.ok === true);
    const losers = contenders.filter(item => item.status === 1 && json(item)?.code === 'baseline_exists');
    check('two concurrent creators produce exactly one winner and one baseline_exists loser',
      winners.length === 1 && losers.length === 1,
      contenders);

    const baselineFile = path.join(root, '.leerness', 'claims-baseline.json');
    const stored = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : null;
    const winner = json(winners[0] || {});
    check('stored policy is exactly the reported winner, never a mixed or overwritten document',
      stored && winner && stored.beforeTaskId === winner.beforeTaskId
        && stored.integrity === winner.integrity && stored.entries.length === winner.baselined,
      { stored, winner });

    const winnerHash = fs.existsSync(baselineFile) ? digest(baselineFile) : null;
    result = run(root, ['verify-claim', 'baseline', 'create', '--before', boundaryTwo, '--yes', '--json']);
    check('later retries remain create-only and preserve the winning bytes',
      result.status === 1 && json(result)?.code === 'baseline_exists'
        && winnerHash && digest(baselineFile) === winnerHash,
      result);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  if (failures.length) {
    console.log(`CLAIMS_BASELINE_CONCURRENCY_PROBE_FAILED: ${failures.join('; ')}`);
    process.exitCode = 1;
  } else {
    console.log('claims baseline concurrency probe passed');
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
