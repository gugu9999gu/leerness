#!/usr/bin/env node
'use strict';

// T-0145 regression probe: a reviewed legacy debt boundary unblocks only exact
// historical failures. Raw/per-task audits, changed rows, new failures, invalid
// input, and corrupt stores must all remain fail-closed.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const claimsBaseline = require('../lib/claims-baseline');

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

function run(root, args, timeout = 60000) {
  return cp.spawnSync(process.execPath, [CLI, ...args, '--path', root], {
    cwd: root,
    encoding: 'utf8',
    timeout,
    env,
  });
}

function json(result) {
  try { return JSON.parse(result.stdout || ''); } catch { return null; }
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function withIntegrity(doc) {
  const unsigned = { ...doc };
  delete unsigned.integrity;
  return {
    ...unsigned,
    integrity: 'sha256:' + crypto.createHash('sha256').update(canonical(unsigned)).digest('hex'),
  };
}

const failures = [];
function check(label, condition, result) {
  if (condition) { console.log(`✓ ${label}`); return; }
  failures.push(label);
  const detail = result ? `\n  exit=${result.status}\n  stdout=${String(result.stdout || '').slice(0, 800)}\n  stderr=${String(result.stderr || '').slice(0, 400)}` : '';
  console.log(`✗ ${label}${detail}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-claims-baseline-'));
try {
  let result = cp.spawnSync(process.execPath, [CLI, 'init', root, '--yes', '--no-enforce', '--no-stale-check'], {
    cwd: root, encoding: 'utf8', timeout: 90000, env,
  });
  check('fixture init succeeds', result.status === 0, result);

  fs.writeFileSync(path.join(root, 'calc.js'), 'function add(a,b){return a+b}\nmodule.exports={add}\n', 'utf8');
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'calc.test.js'), 'const {add}=require("../calc.js");\ntest("a",()=>{if(add(1,2)!==3)throw 0});\n', 'utf8');

  result = run(root, ['task', 'add', 'legacy calc claim']);
  const legacyId = (result.stdout.match(/T-\d{4,}/) || [])[0];
  result = run(root, ['task', 'update', legacyId, '--status', 'done', '--evidence', 'calc.js + tests/calc.test.js 테스트 50개 통과', '--next', 'legacy next']);
  check('legacy false claim fixture is created', result.status === 0 && !!legacyId, result);
  result = run(root, ['task', 'add', 'new work boundary']);
  const boundaryId = (result.stdout.match(/T-\d{4,}/) || [])[0];
  check('explicit non-done boundary fixture is created', result.status === 0 && !!boundaryId, result);

  // Keep the five heuristic gate checks clean so --claims is the only failing dimension.
  fs.writeFileSync(path.join(root, '.leerness', 'session-handoff.md'), '# Handoff\nLast generated: 2026-08-26T00:00:00Z\n\n## Completed\n- calc.js add() 구현 + 테스트\n\n## Next Exact Step\n- migration\n', 'utf8');
  fs.writeFileSync(path.join(root, '.leerness', 'review-evidence.md'), '# Evidence\n## Test run\n- npm test: 1/1 passing\n', 'utf8');

  const tracker = path.join(root, '.leerness', 'progress-tracker.md');
  const trackerText = fs.readFileSync(tracker, 'utf8');
  const trackerHash = digest(tracker);
  const baselineFile = path.join(root, '.leerness', 'claims-baseline.json');

  const beforeGate = run(root, ['gate', '.', '--claims', '--json'], 120000);
  const beforeGateJson = json(beforeGate);
  const beforeClaimCheck = beforeGateJson?.checks?.find(row => row.name === 'verify-claims');
  check('gate --claims reproduces the legacy-only failure before migration',
    beforeGate.status === 1 && beforeClaimCheck?.ok === false && beforeClaimCheck?.rawFailed === 1,
    beforeGate);

  result = run(root, ['verify-claim', 'baseline', 'create', '--before', boundaryId, '--json']);
  check('baseline creation requires explicit --yes and writes nothing on refusal',
    result.status === 1 && json(result)?.code === 'confirmation_required' && !fs.existsSync(baselineFile),
    result);

  result = run(root, ['verify-claim', 'baseline', 'create', '--before', 'T-9999', '--yes', '--json']);
  check('unknown boundary fails before writing a baseline',
    result.status === 1 && json(result)?.code === 'boundary_not_found' && !fs.existsSync(baselineFile),
    result);

  result = run(root, ['verify-claim', 'baseline', 'create', '--before', boundaryId, '--yes', '--json']);
  const created = json(result);
  check('baseline creation isolates only the failed row before the explicit boundary',
    result.status === 0 && created?.ok === true && created?.baselined === 1
      && created?.beforeTaskId === boundaryId && created?.historicalEvidenceModified === false
      && fs.existsSync(baselineFile),
    result);
  check('baseline creation does not rewrite tracker rows or historical evidence',
    digest(tracker) === trackerHash && fs.readFileSync(tracker, 'utf8') === trackerText);
  const stored = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  check('baseline stores fingerprints/reasons, not replacement evidence',
    stored.entries?.length === 1 && stored.entries[0].id === legacyId
      && /^[a-f0-9]{64}$/.test(stored.entries[0].fingerprint)
      && !JSON.stringify(stored).includes('테스트 50개'));

  const casRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-claims-baseline-cas-'));
  try {
    let winnerHash = null;
    let raceCode = null;
    try {
      claimsBaseline.saveBaseline(casRoot, stored, (target, write) => {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, 'concurrent-winner\n', 'utf8');
        winnerHash = digest(target);
        return write();
      });
    } catch (error) { raceCode = error && error.code; }
    const target = claimsBaseline.baselinePath(casRoot);
    check('create-only CAS rechecks destination absence inside the acquired lock',
      raceCode === 'E_CLAIMS_BASELINE_EXISTS' && digest(target) === winnerHash);
  } finally {
    fs.rmSync(casRoot, { recursive: true, force: true });
  }

  result = run(root, ['verify-claim', '--all', '--json']);
  const applied = json(result);
  check('default aggregate verification applies exact legacy debt and exposes raw counts',
    result.status === 0 && applied?.ok === true && applied?.rawFailed === 1
      && applied?.baselined === 1 && applied?.failed === 0
      && applied?.results?.find(row => row.id === legacyId)?.baselineAccepted === true,
    result);

  result = run(root, ['verify-claim', '--all', '--raw', '--json']);
  const raw = json(result);
  check('--raw preserves the original failing verdict',
    result.status === 1 && raw?.ok === false && raw?.failed === 1
      && raw?.baselined === 0 && raw?.baseline?.state === 'ignored',
    result);

  result = run(root, ['verify-claim', legacyId, '--json']);
  check('per-task verification always remains raw',
    result.status === 1 && json(result)?.ok === false && !json(result)?.baselineAccepted,
    result);

  const afterGate = run(root, ['gate', '.', '--claims', '--json'], 120000);
  const afterGateJson = json(afterGate);
  const afterClaimCheck = afterGateJson?.checks?.find(row => row.name === 'verify-claims');
  check('gate --claims is unblocked only through visible legacy-debt accounting',
    afterGate.status === 0 && afterGateJson?.ok === true && afterClaimCheck?.ok === true
      && afterClaimCheck?.rawFailed === 1 && afterClaimCheck?.baselined === 1 && afterClaimCheck?.failed === 0,
    afterGate);

  result = run(root, ['verify-claim', 'baseline', 'show', '--json']);
  check('baseline show returns the integrity-bound policy document',
    result.status === 0 && json(result)?.state === 'valid'
      && json(result)?.baseline?.beforeTaskId === boundaryId,
    result);

  const changedTracker = trackerText.replace('| legacy next |', '| changed metadata |');
  fs.writeFileSync(tracker, changedTracker, 'utf8');
  result = run(root, ['verify-claim', '--all', '--json']);
  const changed = json(result);
  check('any historical tracker-row change invalidates that exemption',
    result.status === 1 && changed?.baselined === 0 && changed?.failed === 1
      && changed?.baseline?.mismatched?.includes(legacyId),
    result);
  const baselineHashBeforeRetry = digest(baselineFile);
  result = run(root, ['verify-claim', 'baseline', 'create', '--before', boundaryId, '--yes', '--json']);
  check('baseline create cannot relaunder a changed historical row by overwriting policy',
    result.status === 1 && json(result)?.code === 'baseline_exists'
      && digest(baselineFile) === baselineHashBeforeRetry,
    result);
  result = run(root, ['verify-claim', '--all', '--json']);
  check('a refused baseline recreation leaves the changed row blocked',
    result.status === 1 && json(result)?.baseline?.mismatched?.includes(legacyId),
    result);
  result = run(root, ['gate', '.', '--claims', '--json'], 120000);
  const changedGateCheck = json(result)?.checks?.find(row => row.name === 'verify-claims');
  check('gate JSON preserves baseline mismatch diagnostics',
    result.status === 1 && changedGateCheck?.baseline?.mismatched?.includes(legacyId),
    result);
  fs.writeFileSync(tracker, trackerText, 'utf8');

  result = run(root, ['task', 'add', 'new false claim']);
  const newId = (result.stdout.match(/T-\d{4,}/) || [])[0];
  result = run(root, ['task', 'update', newId, '--status', 'done', '--evidence', 'ghost.js implemented and tested', '--next', 'none']);
  check('post-boundary false claim fixture is created', result.status === 0 && !!newId, result);
  result = run(root, ['verify-claim', '--all', '--json']);
  const withNew = json(result);
  check('new failures still block while the unchanged legacy row stays isolated',
    result.status === 1 && withNew?.rawFailed === 2 && withNew?.baselined === 1
      && withNew?.failed === 1 && withNew?.baseline?.newFailures?.includes(newId),
    result);
  result = run(root, ['gate', '.', '--claims', '--json'], 120000);
  const newFailureGateCheck = json(result)?.checks?.find(row => row.name === 'verify-claims');
  check('gate JSON preserves new-failure identifiers',
    result.status === 1 && newFailureGateCheck?.baseline?.newFailures?.includes(newId),
    result);

  const corrupt = { ...stored, integrity: 'sha256:' + '0'.repeat(64) };
  fs.writeFileSync(baselineFile, JSON.stringify(corrupt, null, 2) + '\n', 'utf8');
  result = run(root, ['verify-claim', '--all', '--json']);
  check('corrupt baseline fails closed with a distinct machine-readable error',
    result.status === 1 && json(result)?.ok === false
      && json(result)?.errors?.includes('baseline-invalid')
      && json(result)?.baseline?.problems?.includes('integrity-mismatch'),
    result);
  result = run(root, ['gate', '.', '--claims', '--json'], 120000);
  const corruptGateCheck = json(result)?.checks?.find(row => row.name === 'verify-claims');
  check('gate JSON preserves corrupt-baseline problems',
    result.status === 1 && corruptGateCheck?.errors?.includes('baseline-invalid')
      && corruptGateCheck?.baseline?.problems?.includes('integrity-mismatch'),
    result);
  result = run(root, ['verify-claim', '--all', '--raw', '--json']);
  check('raw audit remains available even when the baseline store is corrupt',
    result.status === 1 && json(result)?.baseline?.state === 'ignored'
      && json(result)?.errors?.length === 0 && json(result)?.rawFailed === 2,
    result);
  result = run(root, ['verify-claim', 'baseline', 'show', '--json']);
  check('baseline show reports corruption instead of silently treating it as absent',
    result.status === 1 && json(result)?.code === 'baseline_invalid',
    result);

  const nonCanonical = withIntegrity({
    ...stored,
    entries: stored.entries.map(entry => ({ ...entry, reasons: [...entry.reasons, entry.reasons[0]] })),
  });
  fs.writeFileSync(baselineFile, JSON.stringify(nonCanonical, null, 2) + '\n', 'utf8');
  result = run(root, ['verify-claim', '--all', '--json']);
  check('non-canonical reasons fail closed even with a recomputed document integrity hash',
    result.status === 1 && json(result)?.baseline?.problems?.includes('invalid-entry-reasons'),
    result);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

if (failures.length) {
  console.log(`CLAIMS_BASELINE_PROBE_FAILED: ${failures.join('; ')}`);
  process.exitCode = 1;
} else {
  console.log('claims baseline probe passed');
}
