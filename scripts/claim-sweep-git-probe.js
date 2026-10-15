#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

// T-0302: count real Git status requests at the CLI boundary, rather than
// matching the implementation's source text.
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cli = path.resolve(__dirname, '..', 'bin', 'leerness.js');
const gitModule = path.resolve(__dirname, '..', 'lib', 'git.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-claim-sweep-'));
const counter = path.join(root, 'status-count.txt');
const preload = path.join(root, 'count-status.cjs');
const env = {
  ...process.env,
  LEERNESS_OFFLINE: '1',
  LEERNESS_NO_PROMPT: '1',
  LEERNESS_NO_AUTOCHCP: '1',
  LEERNESS_NO_AUTO_ROADMAP: '1',
  LEERNESS_NO_STALE_CHECK: '1',
  LEERNESS_INTERNAL: '1',
  LEERNESS_CLAIM_PROBE_ROOT: root,
  LEERNESS_CLAIM_PROBE_COUNTER: counter,
};

function command(program, args, options = {}) {
  return cp.spawnSync(program, args, {
    cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
    env: { ...env, ...options.env },
  });
}
function expectExit(result, expected, label) {
  assert.strictEqual(result.status, expected,
    `${label}: exit ${result.status}; stdout=${String(result.stdout).slice(0, 700)}; stderr=${String(result.stderr).slice(0, 700)}`);
}
function cliRun(args, options = {}) {
  fs.writeFileSync(counter, '', 'utf8');
  const result = command(process.execPath,
    ['--require', preload, cli, ...args, '--path', root, '--json'], options);
  let data;
  try { data = JSON.parse(result.stdout); }
  catch { throw new Error(`invalid JSON for ${args.join(' ')}: ${String(result.stdout).slice(0, 700)}; ${String(result.stderr).slice(0, 400)}`); }
  return { result, data, statuses: fs.readFileSync(counter, 'utf8').trim().split('\n').filter(Boolean).length };
}
function git(...args) {
  const result = command('git', args);
  expectExit(result, 0, `git ${args[0]}`);
}
function verdicts(rows) {
  return rows.map(row => ({ id: row.id, ok: row.ok, reasons: row.reasons }));
}

try {
  git('init', '-q');
  git('config', 'user.email', 'claim-sweep@example.invalid');
  git('config', 'user.name', 'Claim Sweep Probe');
  fs.mkdirSync(path.join(root, 'empty-hooks'));
  git('config', 'core.hooksPath', path.join(root, 'empty-hooks'));
  fs.mkdirSync(path.join(root, 'src'));
  for (const name of ['a', 'b', 'c']) {
    fs.writeFileSync(path.join(root, 'src', `${name}.js`),
      `function ${name}() { return '${name}'; }\nmodule.exports = ${name};\n`, 'utf8');
  }
  git('add', 'src');
  git('commit', '-qm', 'fixture');
  fs.mkdirSync(path.join(root, '.leerness'));
  fs.writeFileSync(path.join(root, '.leerness', 'HARNESS_VERSION'), '1.36.284\n', 'utf8');
  const tracker = path.join(root, '.leerness', 'progress-tracker.md');
  const header = '# Progress Tracker\n\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n';
  const rows = ['a', 'b', 'c'].map((name, i) =>
    `| T-${String(i + 1).padStart(4, '0')} | done | ${name} implementation | Files: src/${name}.js | none | 2026-09-27 |`).join('\n');
  fs.writeFileSync(tracker, header + rows + '\n', 'utf8');
  fs.appendFileSync(path.join(root, 'src', 'a.js'), '// working change\n', 'utf8');
  const originalB = fs.readFileSync(path.join(root, 'src', 'b.js'), 'utf8');
  const runCount = path.join(root, 'suite-runs.txt');
  fs.writeFileSync(path.join(root, 'suite.js'),
    "require('fs').appendFileSync('suite-runs.txt', '1\\n'); console.log('1/1 passed');\n", 'utf8');
  fs.writeFileSync(preload, [
    "'use strict';",
    `const git = require(${JSON.stringify(gitModule)});`,
    "const fs = require('fs');",
    "const path = require('path');",
    'const original = git.gitSpawn;',
    'git.gitSpawn = function(args, options) {',
    "  if (args.includes('status') && args.includes('--porcelain=v1') && args.includes(process.env.LEERNESS_CLAIM_PROBE_ROOT)) {",
    '    const countFile = process.env.LEERNESS_CLAIM_PROBE_COUNTER;',
    "    fs.appendFileSync(countFile, '1\\n', 'utf8');",
    "    const count = fs.readFileSync(countFile, 'utf8').trim().split('\\n').filter(Boolean).length;",
    "    if (count === 2 && process.env.LEERNESS_CLAIM_PROBE_MUTATE_SECOND === '1')",
    "      fs.appendFileSync(path.join(process.env.LEERNESS_CLAIM_PROBE_ROOT, 'src', 'b.js'), '// changed during sweep\\n', 'utf8');",
    "    if (process.env.LEERNESS_CLAIM_PROBE_FAIL_STATUS === '1')",
    "      return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };",
    '  }',
    '  return original(args, options);',
    '};',
  ].join('\n') + '\n', 'utf8');

  const individual = ['T-0001', 'T-0002', 'T-0003'].map(id => cliRun(['verify-claim', id, '--strict-claims']));
  assert(individual.every(x => x.statuses === 1), 'single-task verification must read Git once');
  const expected = verdicts(individual.map(x => ({ id: x.data.taskId, ok: x.data.ok, reasons: x.data.reasons })));
  const sweep = cliRun(['verify-claim', '--all', '--strict-claims']);
  assert.deepStrictEqual(verdicts(sweep.data.results), expected, 'read-only sweep verdicts must match single-task verdicts');
  assert.strictEqual(sweep.statuses, 1, `read-only sweep used ${sweep.statuses} Git status calls for 3 claims`);
  console.log('PASS: three read-only claims share one Git status and preserve verdicts');

  fs.appendFileSync(path.join(root, 'src', 'b.js'), '// changed after first sweep\n', 'utf8');
  const nextSweep = cliRun(['verify-claim', '--all', '--strict-claims']);
  assert.strictEqual(nextSweep.statuses, 1, 'a new sweep must make a new Git status request');
  assert(!nextSweep.data.results[1].reasons.includes('git-mismatch'),
    'a new sweep must observe a change made after the previous sweep');
  fs.writeFileSync(path.join(root, 'src', 'b.js'), originalB, 'utf8');
  console.log('PASS: a later invocation observes new file changes');

  const executed = cliRun(['verify-claim', '--all', '--strict-claims', '--run-tests', '--test-cmd', 'node suite.js'],
    { env: { LEERNESS_CLAIM_PROBE_MUTATE_SECOND: '1' } });
  assert.strictEqual(executed.statuses, 3, 'test execution must retain per-claim Git status');
  assert.strictEqual(fs.readFileSync(runCount, 'utf8').trim().split('\n').length, 1,
    'the same test suite must still execute only once per --all invocation');
  assert(!executed.data.results[1].reasons.includes('git-mismatch'),
    'second claim must observe the file changed immediately before its Git status');
  console.log('PASS: execution mode keeps fresh Git reads and observes an intervening change');

  const add = command(process.execPath, [cli, 'referee', 'add', 'probe', '--check', 'node -e "process.exit(0)"',
    '--good', 'node -e "process.exit(0)"',
    '--bad', 'node -e "console.log(\'PROBE_BAD\');process.exit(1)"', '--expect-bad', 'PROBE_BAD', '--path', root]);
  expectExit(add, 0, 'referee add');
  const calibrated = command(process.execPath, [cli, 'referee', 'verify', 'probe', '--path', root, '--json']);
  expectExit(calibrated, 0, 'referee verify');
  assert.strictEqual(JSON.parse(calibrated.stdout).ok, true, 'referee calibration must pass');
  const reviewed = cliRun(['verify-claim', '--all', '--strict-claims', '--referee', 'probe']);
  assert.strictEqual(reviewed.statuses, 3, 'referee execution must retain per-claim Git status');
  console.log('PASS: referee mode keeps fresh Git reads');

  const failedIndividual = ['T-0001', 'T-0002', 'T-0003'].map(id =>
    cliRun(['verify-claim', id, '--strict-claims'], { env: { LEERNESS_CLAIM_PROBE_FAIL_STATUS: '1' } }));
  assert(failedIndividual.every(x => x.data.git.reason === 'not-a-git-repo'),
    'injected Git failure must remain an unavailable reason in single-task diagnostics');
  const failedSweep = cliRun(['verify-claim', '--all', '--strict-claims'],
    { env: { LEERNESS_CLAIM_PROBE_FAIL_STATUS: '1' } });
  assert.strictEqual(failedSweep.statuses, 1, 'one failed Git observation should be shared in a read-only sweep');
  assert.deepStrictEqual(verdicts(failedSweep.data.results), verdicts(failedIndividual.map(x =>
    ({ id: x.data.taskId, ok: x.data.ok, reasons: x.data.reasons }))));
  console.log('PASS: failed Git observation preserves single-task verdicts');

  fs.writeFileSync(tracker, header, 'utf8');
  const empty = cliRun(['verify-claim', '--all']);
  assert.strictEqual(empty.data.total, 0);
  assert.strictEqual(empty.statuses, 0, 'empty sweep must avoid Git status');
  console.log('PASS: empty sweep makes no Git status request');
} finally {
  const relative = path.relative(fs.realpathSync(os.tmpdir()), fs.realpathSync(root));
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    'temporary cleanup target must remain inside the system temp directory');
  fs.rmSync(root, { recursive: true, force: true });
}
