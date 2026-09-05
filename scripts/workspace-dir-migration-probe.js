'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PROTECTED_GITIGNORE_LINES } = require('../lib/workspace-dir');

const CLI = path.join(__dirname, '..', 'bin', 'leerness.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-workspace-dir-'));

function run(args, env = {}) {
  return cp.spawnSync(process.execPath, [CLI, ...args], {
    cwd: tempRoot,
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      LEERNESS_INTERNAL: '1',
      LEERNESS_NO_BANNER: '1',
      LEERNESS_NO_PROMPT: '1',
      LEERNESS_NO_DRIFT_CHECK: '1',
      LEERNESS_NO_AUTOCHCP: '1',
      ...env,
    },
  });
}

function runAsync(args, env = {}) {
  return new Promise((resolve) => {
    const child = cp.spawn(process.execPath, [CLI, ...args], {
      cwd: tempRoot,
      env: {
        ...process.env,
        LEERNESS_INTERNAL: '1',
        LEERNESS_NO_BANNER: '1',
        LEERNESS_NO_PROMPT: '1',
        LEERNESS_NO_DRIFT_CHECK: '1',
        LEERNESS_NO_AUTOCHCP: '1',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function json(result) {
  try { return JSON.parse(result.stdout || '{}'); }
  catch { return null; }
}

function rollbackDiagnostics(result) {
  const detail = {
    status: result.status, signal: result.signal || null, error: result.error?.code || null,
    stdout: String(result.stdout || ''), stderr: String(result.stderr || ''),
  };
  // Keep complete reports when they fit (including multiple JSON documents).
  // Bound the whole diagnostic as UTF-8 JSON, not just the first path prefix.
  while (Buffer.byteLength(JSON.stringify(detail), 'utf8') > 4096) {
    const field = detail.stdout.length >= detail.stderr.length ? 'stdout' : 'stderr';
    detail[field] = detail[field].slice(0, Math.floor(detail[field].length * 0.75));
    detail[field + 'Truncated'] = true;
  }
  return JSON.stringify(detail);
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function check(ok, name, detail) {
  if (ok) {
    process.stdout.write(`PASS ${name}\n`);
    return true;
  }
  process.stderr.write(`FAIL ${name}${detail ? `: ${detail}` : ''}\n`);
  return false;
}

async function main() {
let passed = true;
try {
  const fresh = path.join(tempRoot, 'fresh');
  fs.mkdirSync(fresh);
  const init = run(['init', fresh, '--yes', '--language', 'en', '--no-stale-check', '--no-banner', '--json']);
  passed = check(
    init.status === 0
      && fs.existsSync(path.join(fresh, '.leerness', 'HARNESS_VERSION'))
      && !fs.existsSync(path.join(fresh, '.harness')),
    'fresh-init-canonical',
    `exit=${init.status} harness=${fs.existsSync(path.join(fresh, '.harness'))} leerness=${fs.existsSync(path.join(fresh, '.leerness'))}`,
  ) && passed;

  const legacyEncoding = path.join(tempRoot, 'legacy-non-utf8');
  write(path.join(legacyEncoding, '.harness', 'HARNESS_VERSION'), '1.36.161\n');
  const encodedPath = path.join(legacyEncoding, '.harness', 'cp949-note.md');
  const encodedOriginal = Buffer.concat([
    Buffer.from([0xbe, 0xc8, 0xb3, 0xe7]),
    Buffer.from(' .harness/progress-tracker.md\r\n', 'ascii'),
  ]);
  fs.writeFileSync(encodedPath, encodedOriginal);
  const encodedResult = run(['migrate-workspace-dir', legacyEncoding, '--json']);
  passed = check(
    encodedResult.status === 0
      && fs.readFileSync(path.join(legacyEncoding, '.leerness', 'cp949-note.md')).equals(encodedOriginal)
      && fs.readFileSync(path.join(legacyEncoding, '.leerness-backup', 'cp949-note.md')).equals(encodedOriginal),
    'non-utf8-workspace-notes-remain-byte-exact',
    `exit=${encodedResult.status} body=${(encodedResult.stdout || encodedResult.stderr || '').slice(0, 240)}`,
  ) && passed;

  const legacy = path.join(tempRoot, 'legacy-with-substrate');
  write(path.join(legacy, '.harness', 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(legacy, '.harness', 'progress-tracker.md'), '# legacy-authoritative\n');
  write(path.join(legacy, '.harness', 'runs', 'agent-observation.jsonl'), '{"kind":"agent"}\n');
  write(path.join(legacy, '.harness', 'archive', 'old', '.harness-before-migration', 'deep', 'sentinel.txt'), 'deep-original\n');
  write(path.join(legacy, 'AGENTS.md'), '<!-- leerness:managed -->\nRead .harness/session-workflow.md first.\nHistory: `.harness` -> `.leerness`.\n');
  write(path.join(legacy, '.gitignore'), '.harness/cache/\n.harness/archive/\n');
  write(path.join(legacy, '.env.example'), '# non-secret config: .harness/leerness-config.json\n');
  write(path.join(legacy, '.leerness', 'state.json'), JSON.stringify({
    schemaVersion: 1,
    project: 'legacy-with-substrate',
    currentRunId: null,
    runCounter: 0,
    updatedAt: null,
  }, null, 2) + '\n');
  const migrate = run(['migrate-workspace-dir', legacy, '--json']);
  const migrateJson = json(migrate);
  passed = check(
    migrate.status === 0
      && migrateJson && migrateJson.migrated === true
      && !fs.existsSync(path.join(legacy, '.harness'))
      && migrateJson.backupDir === path.join(legacy, '.leerness-backup')
      && fs.readFileSync(path.join(legacy, '.leerness-backup', 'progress-tracker.md'), 'utf8').includes('legacy-authoritative')
      && fs.readFileSync(path.join(legacy, '.leerness-backup', 'archive', 'old', '.harness-before-migration', 'deep', 'sentinel.txt'), 'utf8') === 'deep-original\n'
      && fs.readFileSync(path.join(legacy, '.leerness', 'progress-tracker.md'), 'utf8').includes('legacy-authoritative')
      && fs.existsSync(path.join(legacy, '.leerness', 'state.json'))
      && fs.existsSync(path.join(legacy, '.leerness', 'cache', 'agent-runs', 'agent-observation.jsonl'))
      && !fs.existsSync(path.join(legacy, '.leerness', 'runs', 'agent-observation.jsonl'))
      && fs.readFileSync(path.join(legacy, 'AGENTS.md'), 'utf8').includes('.leerness/session-workflow.md')
      && fs.readFileSync(path.join(legacy, 'AGENTS.md'), 'utf8').includes('History: `.harness` -> `.leerness`.')
      && fs.readFileSync(path.join(legacy, '.gitignore'), 'utf8').includes('.leerness/cache/')
      && fs.readFileSync(path.join(legacy, '.gitignore'), 'utf8').includes('.leerness/archive/')
      && fs.readFileSync(path.join(legacy, '.gitignore'), 'utf8').includes('.leerness-backup/')
      && PROTECTED_GITIGNORE_LINES.every((line) => fs.readFileSync(path.join(legacy, '.gitignore'), 'utf8').split(/\r?\n/).includes(line))
      && !fs.readFileSync(path.join(legacy, '.gitignore'), 'utf8').includes('.harness/')
      && fs.readFileSync(path.join(legacy, '.env.example'), 'utf8').includes('.leerness/leerness-config.json')
      && !fs.readFileSync(path.join(legacy, '.leerness', 'progress-tracker.md'), 'utf8').includes('.harness/'),
    'legacy-merge-preserves-substrate',
    `exit=${migrate.status} body=${(migrate.stdout || migrate.stderr || '').slice(0, 240)}`,
  ) && passed;

  const unknownTarget = path.join(tempRoot, 'unknown-command-target');
  write(path.join(unknownTarget, '.harness', 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(unknownTarget, '.harness', 'progress-tracker.md'), '# must-stay-legacy\n');
  const unknownResult = run(['definitely-not-a-command', '--path', unknownTarget, '--json']);
  passed = check(
    unknownResult.status !== 0
      && fs.existsSync(path.join(unknownTarget, '.harness', 'progress-tracker.md'))
      && !fs.existsSync(path.join(unknownTarget, '.leerness'))
      && !fs.existsSync(path.join(unknownTarget, '.leerness-backup')),
    'unknown-command-never-mutates-legacy-state',
    `exit=${unknownResult.status} body=${(unknownResult.stdout || unknownResult.stderr || '').slice(0, 240)}`,
  ) && passed;

  const relativeTarget = path.join(tempRoot, 'relative-target');
  write(path.join(relativeTarget, '.harness', 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(relativeTarget, '.harness', 'progress-tracker.md'), '# relative-target\n');
  const relativeResult = run(['migrate-workspace-dir', 'relative-target', '--json']);
  const relativeJson = json(relativeResult);
  passed = check(
    relativeResult.status === 0 && relativeJson && relativeJson.migrated === true
      && fs.existsSync(path.join(relativeTarget, '.leerness', 'progress-tracker.md'))
      && !fs.existsSync(path.join(relativeTarget, '.harness')),
    'bare-relative-explicit-migration-target',
    `exit=${relativeResult.status} body=${(relativeResult.stdout || relativeResult.stderr || '').slice(0, 240)}`,
  ) && passed;

  const normalLinked = path.join(tempRoot, 'normal-command-linked-workspace');
  const normalOutside = path.join(tempRoot, 'normal-command-linked-outside');
  fs.mkdirSync(normalLinked, { recursive: true });
  fs.mkdirSync(normalOutside, { recursive: true });
  write(path.join(normalOutside, 'sentinel.txt'), 'outside-normal-must-not-change\n');
  fs.symlinkSync(normalOutside, path.join(normalLinked, '.leerness'), process.platform === 'win32' ? 'junction' : 'dir');
  const normalLinkedResult = run(['task', 'add', 'must-not-write-through-link', '--force', '--path', normalLinked, '--json']);
  passed = check(
    normalLinkedResult.status !== 0
      && fs.readFileSync(path.join(normalOutside, 'sentinel.txt'), 'utf8') === 'outside-normal-must-not-change\n'
      && !fs.existsSync(path.join(normalOutside, 'progress-tracker.md')),
    'normal-command-refuses-linked-workspace',
    `exit=${normalLinkedResult.status} body=${(normalLinkedResult.stdout || normalLinkedResult.stderr || '').slice(0, 240)}`,
  ) && passed;

  const integrationLinked = path.join(tempRoot, 'linked-integration-parent');
  const integrationOutside = path.join(tempRoot, 'linked-integration-outside');
  write(path.join(integrationLinked, '.harness', 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(integrationLinked, '.harness', 'progress-tracker.md'), '# legacy-stays\n');
  fs.mkdirSync(integrationOutside, { recursive: true });
  write(path.join(integrationOutside, 'copilot-instructions.md'), 'Read .harness/progress-tracker.md\n');
  const integrationBefore = fs.readFileSync(path.join(integrationOutside, 'copilot-instructions.md'));
  fs.symlinkSync(integrationOutside, path.join(integrationLinked, '.github'), process.platform === 'win32' ? 'junction' : 'dir');
  const integrationLinkedResult = run(['migrate-workspace-dir', integrationLinked, '--json']);
  const integrationLinkedJson = json(integrationLinkedResult);
  passed = check(
    integrationLinkedResult.status !== 0
      && integrationLinkedJson && integrationLinkedJson.blockedReason === 'workspace-dir-symlink'
      && fs.readFileSync(path.join(integrationOutside, 'copilot-instructions.md')).equals(integrationBefore)
      && fs.existsSync(path.join(integrationLinked, '.harness', 'progress-tracker.md'))
      && !fs.existsSync(path.join(integrationLinked, '.leerness'))
      && !fs.existsSync(path.join(integrationLinked, '.leerness-backup')),
    'linked-integration-parent-rolls-back-without-outside-write',
    rollbackDiagnostics(integrationLinkedResult),
  ) && passed;

  const concurrent = path.join(tempRoot, 'concurrent-first-migration');
  write(path.join(concurrent, '.harness', 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(concurrent, '.harness', 'progress-tracker.md'), '# concurrent-authoritative\n');
  for (let i = 0; i < 400; i++) {
    write(path.join(concurrent, '.harness', 'bulk', `f-${String(i).padStart(4, '0')}.md`), `${i}:${'x'.repeat(8192)}\n`);
  }
  const concurrentResults = await Promise.all(Array.from({ length: 6 }, () => runAsync(
    ['migrate-workspace-dir', concurrent, '--json'],
    { LEERNESS_WORKSPACE_MIGRATION_LOCK_WAIT_MS: '10000' },
  )));
  const concurrentJson = concurrentResults.map(json);
  passed = check(
    concurrentResults.every((result) => result.status === 0)
      && concurrentJson.every((report) => report && (report.migrated === true || report.alreadyCanonical === true))
      && concurrentJson.filter((report) => report && report.migrated === true).length === 1
      && concurrentJson.some((report) => report && report.waitedForLock === true)
      && fs.existsSync(path.join(concurrent, '.leerness', 'progress-tracker.md'))
      && fs.existsSync(path.join(concurrent, '.leerness-backup', 'progress-tracker.md'))
      && !fs.existsSync(path.join(concurrent, '.harness')),
    'simultaneous-first-migrations-converge-with-lock-wait',
    JSON.stringify(concurrentResults.map((result, i) => ({ status: result.status, report: concurrentJson[i] && {
      migrated: concurrentJson[i].migrated, alreadyCanonical: concurrentJson[i].alreadyCanonical,
      waitedForLock: concurrentJson[i].waitedForLock, lockWaitedMs: concurrentJson[i].lockWaitedMs,
      blockedReason: concurrentJson[i].blockedReason, errors: concurrentJson[i].errors,
    }, stderr: result.stderr }))),
  ) && passed;

  const autoTarget = path.join(tempRoot, 'auto-path-target');
  write(path.join(autoTarget, '.harness', 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(autoTarget, '.harness', 'progress-tracker.md'), '# auto-target\n');
  // Handoff is intentionally stateful even with --no-record: it is a normal
  // workflow entrypoint, unlike observation-only status/about/identity routes.
  const autoStatus = run(['handoff', '--path', autoTarget, '--json', '--no-record', '--no-drift-check', '--no-headline']);
  const autoIgnore = fs.readFileSync(path.join(autoTarget, '.gitignore'), 'utf8').split(/\r?\n/);
  passed = check(
    !fs.existsSync(path.join(autoTarget, '.harness'))
      && fs.existsSync(path.join(autoTarget, '.leerness', 'progress-tracker.md'))
      && fs.existsSync(path.join(autoTarget, '.leerness-backup', 'progress-tracker.md'))
      && PROTECTED_GITIGNORE_LINES.every((line) => autoIgnore.includes(line)),
    'normal-command-auto-migrates-explicit-path',
    `exit=${autoStatus.status} body=${(autoStatus.stdout || autoStatus.stderr || '').slice(0, 240)}`,
  ) && passed;

  const topicTarget = path.join(tempRoot, 'topic-target');
  write(path.join(topicTarget, '.harness', 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(topicTarget, '.harness', 'progress-tracker.md'), '# topic-must-not-migrate\n');
  run(['brainstorm', './topic-target', '--json']);
  passed = check(
    fs.existsSync(path.join(topicTarget, '.harness', 'progress-tracker.md'))
      && !fs.existsSync(path.join(topicTarget, '.leerness'))
      && !fs.existsSync(path.join(topicTarget, '.leerness-backup')),
    'path-shaped-command-text-is-never-auto-migrated',
  ) && passed;

  const backupExists = path.join(tempRoot, 'backup-exists');
  write(path.join(backupExists, '.harness', 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(backupExists, '.harness', 'progress-tracker.md'), '# source-must-stay\n');
  write(path.join(backupExists, '.leerness-backup', 'sentinel.txt'), 'never-overwrite\n');
  const backupBlocked = run(['migrate-workspace-dir', backupExists, '--json']);
  const backupJson = json(backupBlocked);
  passed = check(
    backupBlocked.status !== 0
      && backupJson && backupJson.blockedReason === 'workspace-dir-backup-exists'
      && fs.readFileSync(path.join(backupExists, '.leerness-backup', 'sentinel.txt'), 'utf8') === 'never-overwrite\n'
      && fs.readFileSync(path.join(backupExists, '.harness', 'progress-tracker.md'), 'utf8') === '# source-must-stay\n'
      && !fs.existsSync(path.join(backupExists, '.leerness')),
    'preexisting-backup-fails-closed',
    `exit=${backupBlocked.status} body=${(backupBlocked.stdout || backupBlocked.stderr || '').slice(0, 240)}`,
  ) && passed;

  const userInvocation = path.join(tempRoot, 'normal-user-invocation');
  write(path.join(userInvocation, '.harness', 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(userInvocation, '.harness', 'progress-tracker.md'), '# normal-user-state\n');
  write(path.join(userInvocation, '.leerness', 'state.json'), JSON.stringify({
    schemaVersion: 1,
    project: 'normal-user-invocation',
    currentRunId: null,
    runCounter: 0,
    updatedAt: null,
  }, null, 2) + '\n');
  write(path.join(userInvocation, '.leerness', 'cache', 'sessions', 'prior-agent.json'), '{}\n');
  const normalMigrate = run(['migrate-workspace-dir', userInvocation, '--json'], { LEERNESS_INTERNAL: '' });
  const normalJson = json(normalMigrate);
  passed = check(
    normalMigrate.status === 0
      && normalJson && normalJson.migrated === true
      && !fs.existsSync(path.join(userInvocation, '.harness'))
      && fs.existsSync(path.join(userInvocation, '.leerness', 'cache', 'sessions', 'prior-agent.json')),
    'normal-user-runtime-cache-is-valid-substrate',
    `exit=${normalMigrate.status} body=${(normalMigrate.stdout || normalMigrate.stderr || '').slice(0, 1200)}`,
  ) && passed;

  const add = run(['task', 'add', 'canonical-only-write', '--path', legacy, '--status', 'in-progress', '--no-review', '--json']);
  const canonicalProgress = path.join(legacy, '.leerness', 'progress-tracker.md');
  passed = check(
    add.status === 0
      && fs.existsSync(canonicalProgress)
      && fs.readFileSync(canonicalProgress, 'utf8').includes('canonical-only-write')
      && !fs.existsSync(path.join(legacy, '.harness')),
    'post-migration-write-canonical',
    `exit=${add.status}`,
  ) && passed;

  const conflict = path.join(tempRoot, 'live-conflict');
  write(path.join(conflict, '.harness', 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(conflict, '.harness', 'progress-tracker.md'), '# legacy\n');
  write(path.join(conflict, '.leerness', 'HARNESS_VERSION'), '1.36.162\n');
  write(path.join(conflict, '.leerness', 'progress-tracker.md'), '# canonical\n');
  write(path.join(conflict, '.leerness', 'MIGRATED_FROM_HARNESS'), 'provenance-is-not-overwrite-permission\n');
  const beforeLegacy = fs.readFileSync(path.join(conflict, '.harness', 'progress-tracker.md'), 'utf8');
  const beforeCanonical = fs.readFileSync(path.join(conflict, '.leerness', 'progress-tracker.md'), 'utf8');
  const blocked = run(['migrate-workspace-dir', conflict, '--json']);
  const blockedJson = json(blocked);
  passed = check(
    blocked.status !== 0
      && blockedJson && blockedJson.blocked === true
      && blockedJson.blockedReason === 'workspace-dir-conflict'
      && fs.readFileSync(path.join(conflict, '.harness', 'progress-tracker.md'), 'utf8') === beforeLegacy
      && fs.readFileSync(path.join(conflict, '.leerness', 'progress-tracker.md'), 'utf8') === beforeCanonical,
    'dual-live-fail-closed',
    `exit=${blocked.status} body=${(blocked.stdout || blocked.stderr || '').slice(0, 240)}`,
  ) && passed;

  const invalidGitignore = path.join(tempRoot, 'invalid-gitignore');
  write(path.join(invalidGitignore, '.harness', 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(invalidGitignore, '.harness', 'progress-tracker.md'), '# legacy-stays\n');
  fs.mkdirSync(path.join(invalidGitignore, '.gitignore'), { recursive: true });
  const invalidGitignoreResult = run(['migrate-workspace-dir', invalidGitignore, '--json']);
  const invalidGitignoreJson = json(invalidGitignoreResult);
  passed = check(
    invalidGitignoreResult.status !== 0
      && invalidGitignoreJson && invalidGitignoreJson.blockedReason === 'workspace-dir-integration-invalid'
      && fs.existsSync(path.join(invalidGitignore, '.harness', 'progress-tracker.md'))
      && fs.statSync(path.join(invalidGitignore, '.gitignore')).isDirectory()
      && !fs.existsSync(path.join(invalidGitignore, '.leerness-backup'))
      && !fs.existsSync(path.join(invalidGitignore, '.leerness')),
    'invalid-gitignore-rolls-back-and-keeps-legacy',
    rollbackDiagnostics(invalidGitignoreResult),
  ) && passed;

  const linked = path.join(tempRoot, 'canonical-link-force');
  const outside = path.join(tempRoot, 'canonical-link-outside');
  fs.mkdirSync(outside, { recursive: true });
  write(path.join(outside, 'sentinel.txt'), 'outside-must-not-change\n');
  write(path.join(linked, '.harness', 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(linked, '.harness', 'progress-tracker.md'), '# legacy\n');
  fs.symlinkSync(outside, path.join(linked, '.leerness'), process.platform === 'win32' ? 'junction' : 'dir');
  const linkedResult = run(['migrate-workspace-dir', linked, '--force', '--json']);
  const linkedJson = json(linkedResult);
  passed = check(
    linkedResult.status !== 0
      && linkedJson && linkedJson.blocked === true
      && linkedJson.blockedReason === 'canonical-workspace-symlink'
      && fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8') === 'outside-must-not-change\n'
      && !fs.existsSync(path.join(outside, 'progress-tracker.md'))
      && fs.existsSync(path.join(linked, '.harness', 'progress-tracker.md')),
    'force-refuses-canonical-symlink',
    `exit=${linkedResult.status} body=${(linkedResult.stdout || linkedResult.stderr || '').slice(0, 240)}`,
  ) && passed;

  const locked = path.join(tempRoot, 'prelocked');
  write(path.join(locked, '.harness', 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(locked, '.harness', 'progress-tracker.md'), '# legacy\n');
  const lockPath = path.join(locked, '.leerness-workspace-migration.lock');
  write(lockPath, 'other-process-owns-this-lock\n');
  const lockedResult = run(['migrate-workspace-dir', locked, '--json'], { LEERNESS_WORKSPACE_MIGRATION_LOCK_WAIT_MS: '50' });
  const lockedJson = json(lockedResult);
  passed = check(
    lockedResult.status !== 0
      && lockedJson && lockedJson.blockedReason === 'workspace-dir-migration-locked'
      && fs.readFileSync(lockPath, 'utf8') === 'other-process-owns-this-lock\n'
      && fs.existsSync(path.join(locked, '.harness', 'progress-tracker.md')),
    'foreign-lock-is-never-deleted',
    `exit=${lockedResult.status} body=${(lockedResult.stdout || lockedResult.stderr || '').slice(0, 240)}`,
  ) && passed;

  const collision = path.join(tempRoot, 'mapped-collision');
  write(path.join(collision, '.harness', 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(collision, '.harness', 'runs', 'same.jsonl'), '{"source":"old-runs"}\n');
  write(path.join(collision, '.harness', 'cache', 'agent-runs', 'same.jsonl'), '{"source":"cache"}\n');
  const collisionResult = run(['migrate-workspace-dir', collision, '--force', '--json']);
  const collisionJson = json(collisionResult);
  passed = check(
    collisionResult.status !== 0
      && collisionJson && collisionJson.blockedReason === 'workspace-dir-map-collision'
      && fs.existsSync(path.join(collision, '.harness', 'runs', 'same.jsonl'))
      && !fs.existsSync(path.join(collision, '.leerness', 'cache', 'agent-runs', 'same.jsonl')),
    'mapped-path-collision-fails-closed',
    `exit=${collisionResult.status} body=${(collisionResult.stdout || collisionResult.stderr || '').slice(0, 240)}`,
  ) && passed;
} finally {
  const resolved = path.resolve(tempRoot);
  const resolvedTmp = path.resolve(os.tmpdir());
  if (!resolved.startsWith(resolvedTmp + path.sep) || path.dirname(resolved) !== resolvedTmp) {
    throw new Error(`unsafe cleanup target: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

if (!passed) {
  process.stderr.write('WORKSPACE_DIR_MIGRATION_FAILED\n');
  process.exit(1);
}
process.stdout.write('WORKSPACE_DIR_MIGRATION_OK\n');
}

main().catch((error) => {
  process.stderr.write(`WORKSPACE_DIR_MIGRATION_CRASH: ${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
