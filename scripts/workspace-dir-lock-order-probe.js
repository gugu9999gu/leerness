#!/usr/bin/env node
'use strict';

// A live legacy migration must own its project lock before migration revalidation.
// Otherwise a peer can populate `.leerness/` after validation and
// make the first caller misclassify the peer's intermediate copy as a user
// conflict. A second fixture admits newcomers during an actual dual-live copy.
// Both interleavings use handshakes rather than scheduler luck or bulk-copy delay.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const CLI = require.resolve('../bin/leerness.js');
const IS_ADMITTED_PEER = process.argv[2] === '--admitted-peer';
const IS_PEER = process.argv[2] === '--peer' || IS_ADMITTED_PEER;
const IS_MUTANT = process.argv[2] === '--prelock-validation-mutant';
const IS_COPY_RACE = process.argv[2] === '--copy-admission';
const CLI_PEER_ROOT = process.env.LEERNESS_LOCK_ORDER_CLI_PEER_ROOT;
const IS_CLI_PEER = !!CLI_PEER_ROOT && path.resolve(process.argv[1]) === CLI;
const WORKSPACE_MODULE = require.resolve('../lib/workspace-dir');
const RUNTIME_MODULE = require.resolve('../lib/runtime-layout');
const workspace = loadWorkspace();
const tempParent = fs.realpathSync.native(os.tmpdir());
const root = IS_PEER
  ? path.resolve(process.argv[3] || '.')
  : IS_CLI_PEER ? path.resolve(CLI_PEER_ROOT)
    : fs.mkdtempSync(path.join(tempParent, 'leerness-lock-order-'));
const legacy = path.join(root, workspace.LEGACY_WORKSPACE_DIR);
const canonical = path.join(root, workspace.CANONICAL_WORKSPACE_DIR);
const lockFile = path.join(root, '.leerness-workspace-migration.lock');
const peerReadyFile = path.join(root, '.leerness-lock-order-peer-ready');
const peerStartFile = path.join(root, '.leerness-lock-order-peer-start');
const peerContendedFile = path.join(root, '.leerness-lock-order-peer-contended');
const peerDoneFile = path.join(root, '.leerness-lock-order-peer-done');

function loadWorkspace() {
  if (!IS_MUTANT) return require(WORKSPACE_MODULE);

  // Recreate validation-before-lock in memory: bypass the outer early-lock
  // wrapper so the original migration validates before its fallback lock.
  // Keep the real writer guard and all other source unchanged; the peer uses
  // the unmodified module. Never overwrite a product file to run a mutant.
  const source = fs.readFileSync(WORKSPACE_MODULE, 'utf8');
  const entry = 'function migrateLegacyWorkspace(root, opts = {}) {';
  if (source.split(entry).length !== 2) throw new Error('migration mutant entry is not unique');
  const Module = require('module');
  const candidate = new Module(WORKSPACE_MODULE, module);
  candidate.filename = WORKSPACE_MODULE;
  candidate.paths = Module._nodeModulePaths(path.dirname(WORKSPACE_MODULE));
  candidate._compile(source.replace(entry, `${entry}\n  return _migrateLegacyWorkspace(root, opts);`), WORKSPACE_MODULE);
  return candidate.exports;
}

function isMigrationRevalidation() {
  const originalPrepare = Error.prepareStackTrace;
  try {
    Error.prepareStackTrace = (_error, frames) => frames;
    const trace = {};
    Error.captureStackTrace(trace, isMigrationRevalidation);
    // Direct function boundaries distinguish migration's inspection from
    // runtime compatibility reads, including reads made inside write guards.
    // Do not condition this hook on lock existence: that would miss the bug.
    const callers = trace.stack.slice(1, 4); // skip patchedLstat
    return ['_inspectDir', 'inspectWorkspace', '_migrateLegacyWorkspace'].every((name, index) => {
      const frame = callers[index];
      return frame && frame.getFunctionName() === name && frame.getFileName() === WORKSPACE_MODULE;
    });
  } finally {
    Error.prepareStackTrace = originalPrepare;
  }
}

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForSignal(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(file) && Date.now() < deadline) sleep(2);
  if (!fs.existsSync(file)) throw new Error(`peer signal timed out: ${path.basename(file)}`);
}

function waitForPeerHandshake(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = fs.existsSync(peerReadyFile);
    const contended = fs.existsSync(peerContendedFile);
    const done = fs.existsSync(peerDoneFile);
    if (ready && (contended || done)) return { ready, contended, done };
    sleep(2);
  }
  return {
    ready: fs.existsSync(peerReadyFile),
    contended: fs.existsSync(peerContendedFile),
    done: fs.existsSync(peerDoneFile),
  };
}

function observePeerContention() {
  const originalOpen = fs.openSync;
  fs.openSync = function patchedOpen(target, flags, ...rest) {
    try { return originalOpen.call(fs, target, flags, ...rest); }
    catch (error) {
      if (path.resolve(String(target)) === lockFile && flags === 'wx' && error && error.code === 'EEXIST') {
        write(peerContendedFile, `${process.pid}\n`);
      }
      throw error;
    }
  };
  write(peerReadyFile, `${process.pid}\n`);
  return () => { fs.openSync = originalOpen; };
}

function isWriterAdmissionWait() {
  const originalPrepare = Error.prepareStackTrace;
  try {
    Error.prepareStackTrace = (_error, frames) => frames;
    const trace = {};
    Error.captureStackTrace(trace, isWriterAdmissionWait);
    const frame = trace.stack[1]; // skip patched Atomics.wait
    return frame && frame.getFunctionName() === 'createRuntimeWriterAdmission'
      && frame.getFileName() === RUNTIME_MODULE;
  } finally { Error.prepareStackTrace = originalPrepare; }
}

function observeWriterAdmissionWait() {
  const originalWait = Atomics.wait;
  const originalLstat = fs.lstatSync;
  let exactLockRead = false;
  fs.lstatSync = function (target, ...args) {
    const result = originalLstat.call(this, target, ...args);
    if (path.resolve(String(target)) === lockFile && result.isFile() && !result.isSymbolicLink()) {
      exactLockRead = true;
    }
    return result;
  };
  Atomics.wait = function (...args) {
    const admission = isWriterAdmissionWait();
    const result = originalWait.apply(this, args);
    // Record a completed real wait in the writer-admission loop, not merely
    // seeing a lock pathname or starting a process. Public diagnosis is separate.
    if (admission && exactLockRead && result === 'timed-out') write(peerContendedFile, `${process.pid}\n`);
    return result;
  };
  write(peerReadyFile, `${process.pid}\n`);
  return () => { Atomics.wait = originalWait; fs.lstatSync = originalLstat; };
}

function runPeer() {
  let restoreObserver = () => {};
  let report;
  try {
    const migrate = () => {
      restoreObserver = IS_ADMITTED_PEER ? observePeerContention() : observeWriterAdmissionWait();
      if (IS_ADMITTED_PEER) waitForSignal(peerStartFile, 20000);
      return workspace.migrateLegacyWorkspace(root, {
        version: 'lock-order-peer', lockWaitMs: 20000, at: '2026-08-27T00:00:01.000Z',
      });
    };
    // The original lock-order scenario is an already-admitted operation. Its
    // real guard stays active, but it can reach open("wx") while a holder runs.
    // Copy-admission peers instead create a genuinely new operation mid-copy.
    report = IS_ADMITTED_PEER ? require('../lib/runtime-writes').withRuntimeWrites(root, migrate) : migrate();
  } catch (error) {
    report = { error: { code: error.code, reasonCode: error.reasonCode, message: error.message } };
  } finally {
    restoreObserver();
  }
  write(peerDoneFile, `${JSON.stringify(report)}\n`);
  if (!report || report.blocked || (!report.migrated && !report.alreadyCanonical)) process.exitCode = 1;
}

function fixtureSignature() {
  const rows = [];
  const visit = (file, relative) => {
    const stat = fs.lstatSync(file, { bigint: true });
    const row = [relative, stat.mode.toString(), stat.size.toString(), stat.mtimeNs.toString()];
    if (stat.isSymbolicLink()) rows.push([...row, 'link', fs.readlinkSync(file)]);
    else if (stat.isDirectory()) {
      rows.push([...row, 'directory']);
      for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name), `${relative}/${name}`);
    } else rows.push([...row, 'file', crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
  };
  visit(root, '.');
  return JSON.stringify(rows);
}

function diagnosePausedCopy() {
  const before = fixtureSignature();
  const result = cp.spawnSync(process.execPath, [CLI, 'state', 'compatibility', root, '--json'], {
    cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_NO_BANNER: '1',
      LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_OFFLINE: '1',
      LEERNESS_WORKSPACE_MIGRATION_LOCK_WAIT_MS: '20000' },
  });
  let report;
  try { report = JSON.parse(result.stdout); } catch {}
  return !result.error && result.status === 1 && report?.reasonCode === 'workspace_dir_conflict'
    && report.compatible === false && report.writeDisposition === 'blocked'
    && fixtureSignature() === before;
}

function startCopyPeer(entry) {
  const args = entry === 'cli'
    ? ['--require', __filename, CLI, 'migrate-workspace-dir', root, '--json']
    : [__filename, '--peer', root];
  const child = cp.spawn(process.execPath, args, {
    cwd: root, windowsHide: true, timeout: 30000,
    env: {
      ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_NO_BANNER: '1',
      LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_OFFLINE: '1',
      LEERNESS_WORKSPACE_MIGRATION_LOCK_WAIT_MS: '20000',
      ...(entry === 'cli' ? { LEERNESS_LOCK_ORDER_CLI_PEER_ROOT: root } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = { stdout: '', stderr: '', spawnError: null };
  child.stdout.on('data', chunk => { output.stdout += chunk; });
  child.stderr.on('data', chunk => { output.stderr += chunk; });
  child.on('error', error => { output.spawnError = error.message; });
  const done = new Promise(resolve => child.on('close', status => resolve({ status, ...output })));
  return { child, done };
}

async function copyAdmissionRace(entry) {
  if (!['module', 'cli'].includes(entry)) throw new Error('unknown copy-admission entry');
  const marker = '1.36.161\n';
  const body = '# copied-authoritative\n';
  write(path.join(legacy, 'HARNESS_VERSION'), marker);
  write(path.join(legacy, 'progress-tracker.md'), body);
  const originalCopy = fs.copyFileSync;
  const originalUnlink = fs.unlinkSync;
  const observation = { entry, copySeen: false, dualLive: false, lockHeld: false, diagnosisBlockedReadOnly: false,
    ready: false, admissionWaitObserved: false, doneBeforeRelease: false, releaseSeen: false, blockedUntilRelease: false };
  let peer;
  let victim;
  let victimError;
  fs.copyFileSync = function (source, destination, ...args) {
    const result = originalCopy.call(this, source, destination, ...args);
    if (!observation.copySeen && path.resolve(String(source)) === path.join(legacy, 'HARNESS_VERSION')
        && path.resolve(String(destination)) === path.join(canonical, 'HARNESS_VERSION')) {
      observation.copySeen = true;
      const state = workspace.inspectWorkspace(root);
      observation.dualLive = state.legacy.live && state.canonical.live && state.conflict;
      observation.lockHeld = fs.existsSync(lockFile);
      observation.diagnosisBlockedReadOnly = diagnosePausedCopy();
      // The real copy has committed a live marker but the real holder has not
      // renamed legacy or released its lock. No fabricated lock/dual-live state
      // and no wait-for-lock prerequisite can hide an early admission failure.
      peer = startCopyPeer(entry);
      const handshake = waitForPeerHandshake(20000);
      observation.ready = handshake.ready;
      observation.admissionWaitObserved = handshake.contended;
      observation.doneBeforeRelease = handshake.done;
    }
    return result;
  };
  fs.unlinkSync = function (target, ...args) {
    if (path.resolve(String(target)) === lockFile) {
      observation.releaseSeen = true;
      observation.blockedUntilRelease = observation.admissionWaitObserved && !fs.existsSync(peerDoneFile)
        && peer?.child.exitCode === null;
    }
    return originalUnlink.call(this, target, ...args);
  };
  try {
    victim = workspace.migrateLegacyWorkspace(root, { version: 'copy-admission-holder', lockWaitMs: 20000 });
  } catch (error) {
    victimError = { code: error.code, reasonCode: error.reasonCode, message: error.message };
  } finally {
    fs.copyFileSync = originalCopy;
    fs.unlinkSync = originalUnlink;
  }
  const peerResult = peer ? await peer.done : null;
  let peerReport;
  try {
    peerReport = JSON.parse(entry === 'cli' ? peerResult.stdout : fs.readFileSync(peerDoneFile, 'utf8'));
  } catch {}
  const backup = path.join(root, workspace.LEGACY_BACKUP_WORKSPACE_DIR);
  const preserved = [canonical, backup].every(directory => {
    try {
      return fs.readFileSync(path.join(directory, 'HARNESS_VERSION'), 'utf8') === marker
        && fs.readFileSync(path.join(directory, 'progress-tracker.md'), 'utf8') === body;
    } catch { return false; }
  });
  const ok = observation.copySeen && observation.dualLive && observation.lockHeld && observation.ready
    && observation.diagnosisBlockedReadOnly
    && observation.admissionWaitObserved && !observation.doneBeforeRelease && observation.releaseSeen
    && observation.blockedUntilRelease && victim?.migrated === true && !victim.blocked
    && peerResult?.status === 0 && !peerResult.spawnError && peerReport?.alreadyCanonical === true
    && peerReport.waitedForLock === true && !peerReport.blocked
    && preserved && !fs.existsSync(legacy) && !fs.existsSync(lockFile);
  if (!ok) {
    process.stderr.write(`WORKSPACE_COPY_ADMISSION_RACE ${JSON.stringify({ ...observation,
      victim, victimError, peerResult, peerReport, preserved })}\n`);
    process.exitCode = 1;
  } else process.stdout.write(`WORKSPACE_COPY_ADMISSION_OK ${entry}\n`);
}

async function main() {
  if (IS_PEER) {
    runPeer();
    return;
  }
  if (IS_COPY_RACE) return copyAdmissionRace(process.argv[3] || 'module');

  write(path.join(legacy, 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(legacy, 'progress-tracker.md'), `# Read ${workspace.LEGACY_WORKSPACE_DIR}/progress-tracker.md\n`);
  // The handshake, not copy throughput, keeps the peer at the race boundary.
  // One nested file exercises recursive copying without timing a large tree.
  write(path.join(legacy, 'bulk', 'fixture.md'), `Read ${workspace.LEGACY_WORKSPACE_DIR}/bulk/fixture.md\n`);

  const originalLstat = fs.lstatSync;
  const originalUnlink = fs.unlinkSync;
  let revalidationSeen = false;
  let peer = null;
  let peerDone = null;
  let earlyLockSeen = false;
  let peerReadySeen = false;
  let peerContentionSeen = false;
  let peerCompletedBeforeRelease = false;
  let lockReleaseObserved = false;
  let peerBlockedUntilRelease = false;

  // Admit the original peer before any holder lock exists, then start its
  // migration at revalidation. This retains the actual exclusive-open race;
  // the separate copy scenario exercises writer admission arriving later.
  peer = cp.spawn(process.execPath, [__filename, '--admitted-peer', root], {
    cwd: root, windowsHide: true, timeout: 30000,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_NO_BANNER: '1',
      LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  peerDone = new Promise(resolve => peer.on('close', status => resolve(status)));
  waitForSignal(peerReadyFile, 20000);

  fs.lstatSync = function patchedLstat(target, ...rest) {
    const isCanonicalRoot = path.resolve(String(target)) === canonical;
    let result;
    let thrown;
    try { result = originalLstat.call(fs, target, ...rest); }
    catch (error) { thrown = error; }

    if (isCanonicalRoot && !revalidationSeen && isMigrationRevalidation()) {
      revalidationSeen = true;
      earlyLockSeen = fs.existsSync(lockFile);
      write(peerStartFile, 'start\n');

      // The child records an actual failed `open(..., "wx")`, not merely that
      // it was spawned. This proves it reached lock acquisition while the
      // victim is paused inside migration's canonical workspace revalidation.
      const handshake = waitForPeerHandshake(20000);
      peerReadySeen = handshake.ready;
      peerContentionSeen = handshake.contended;
      peerCompletedBeforeRelease = handshake.done;
    }

    if (thrown) throw thrown;
    return result;
  };
  fs.unlinkSync = function patchedUnlink(target, ...rest) {
    if (path.resolve(String(target)) === lockFile) {
      lockReleaseObserved = true;
      peerBlockedUntilRelease = peerReadySeen
        && peerContentionSeen
        && !fs.existsSync(peerDoneFile)
        && peer !== null
        && peer.exitCode === null;
    }
    return originalUnlink.call(fs, target, ...rest);
  };

  let victim;
  try {
    victim = workspace.migrateLegacyWorkspace(root, {
      version: 'lock-order-probe',
      lockWaitMs: 20000,
      at: '2026-08-27T00:00:00.000Z',
    });
  } finally {
    fs.lstatSync = originalLstat;
    fs.unlinkSync = originalUnlink;
  }

  const peerStatus = peerDone ? await peerDone : null;
  const ok = revalidationSeen
    && earlyLockSeen
    && peerReadySeen
    && peerContentionSeen
    && !peerCompletedBeforeRelease
    && lockReleaseObserved
    && peerBlockedUntilRelease
    && peerStatus === 0
    && victim && victim.migrated === true && victim.blocked === false
    && fs.existsSync(path.join(canonical, 'progress-tracker.md'))
    && fs.existsSync(path.join(root, workspace.LEGACY_BACKUP_WORKSPACE_DIR, 'progress-tracker.md'))
    && !fs.existsSync(legacy);

  if (!ok) {
    process.stderr.write(`WORKSPACE_LOCK_ORDER_RACE ${JSON.stringify({
      revalidationSeen,
      earlyLockSeen,
      peerReadySeen,
      peerContentionSeen,
      peerCompletedBeforeRelease,
      lockReleaseObserved,
      peerBlockedUntilRelease,
      peerStatus,
      victim: victim && {
        migrated: victim.migrated,
        alreadyCanonical: victim.alreadyCanonical,
        blocked: victim.blocked,
        blockedReason: victim.blockedReason,
        errors: victim.errors,
      },
    })}\n`);
    process.exitCode = 1;
  } else {
    if (!IS_MUTANT) {
      process.stdout.write('WORKSPACE_PRE_ADMITTED_WX_OK\n');
      for (const entry of ['module', 'cli']) {
        const result = cp.spawnSync(process.execPath, [__filename, '--copy-admission', entry], {
          cwd: __dirname, encoding: 'utf8', timeout: 60000, windowsHide: true,
        });
        if (result.error || result.status !== 0) {
          throw new Error(`copy-admission ${entry} failed: ${JSON.stringify({
            status: result.status, error: result.error && result.error.message,
            stdout: result.stdout, stderr: result.stderr,
          })}`);
        }
        process.stdout.write(result.stdout);
      }
      const mutant = cp.spawnSync(process.execPath, [__filename, '--prelock-validation-mutant'], {
        cwd: __dirname,
        encoding: 'utf8',
        timeout: 60000,
        windowsHide: true,
      });
      const match = (mutant.stderr || '').match(/^WORKSPACE_LOCK_ORDER_RACE (.+)$/m);
      const report = match ? JSON.parse(match[1]) : null;
      const caught = !mutant.error && mutant.status === 1 && report
        && report.revalidationSeen && !report.earlyLockSeen
        && report.peerReadySeen && !report.peerContentionSeen
        && report.peerCompletedBeforeRelease && report.peerStatus === 0;
      if (!caught) {
        throw new Error(`pre-lock validation mutant was not caught: ${JSON.stringify({
          status: mutant.status, error: mutant.error && mutant.error.message,
          stdout: mutant.stdout, stderr: mutant.stderr,
        })}`);
      }
      process.stdout.write('WORKSPACE_LOCK_ORDER_MUTANT_CAUGHT\n');
    }
    process.stdout.write('WORKSPACE_LOCK_ORDER_OK\n');
  }
}

if (IS_CLI_PEER) {
  observeWriterAdmissionWait();
  // Preload observes the actual CLI process, including its normal error mapper
  // and forced exit path. It neither calls nor substitutes the command body.
  process.once('exit', status => write(peerDoneFile, `${JSON.stringify({ status })}\n`));
} else main()
  .catch((error) => {
    process.stderr.write(`WORKSPACE_LOCK_ORDER_CRASH ${error && error.stack ? error.stack : error}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (!IS_PEER) {
      if (path.dirname(root) !== tempParent || !path.basename(root).startsWith('leerness-lock-order-')
          || fs.realpathSync.native(root) !== root) throw new Error('unsafe lock-order fixture cleanup');
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
