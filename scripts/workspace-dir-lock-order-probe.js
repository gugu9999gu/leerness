#!/usr/bin/env node
'use strict';

// A live legacy migration must own its project lock before migration revalidation.
// Otherwise a peer can populate `.leerness/` after validation and
// make the first caller misclassify the peer's intermediate copy as a user
// conflict. This probe forces that interleaving without relying on scheduler luck.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const IS_PEER = process.argv[2] === '--peer';
const IS_MUTANT = process.argv[2] === '--prelock-validation-mutant';
const WORKSPACE_MODULE = require.resolve('../lib/workspace-dir');
const workspace = loadWorkspace();
const root = IS_PEER
  ? path.resolve(process.argv[3] || '.')
  : fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lock-order-'));
const legacy = path.join(root, workspace.LEGACY_WORKSPACE_DIR);
const canonical = path.join(root, workspace.CANONICAL_WORKSPACE_DIR);
const lockFile = path.join(root, '.leerness-workspace-migration.lock');
const peerReadyFile = path.join(root, '.leerness-lock-order-peer-ready');
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

function runPeer() {
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
  let report;
  try {
    report = workspace.migrateLegacyWorkspace(root, {
      version: 'lock-order-peer',
      lockWaitMs: 20000,
      at: '2026-08-27T00:00:01.000Z',
    });
  } finally {
    fs.openSync = originalOpen;
  }
  write(peerDoneFile, `${JSON.stringify(report)}\n`);
  if (!report || report.blocked || (!report.migrated && !report.alreadyCanonical)) process.exitCode = 1;
}

async function main() {
  if (IS_PEER) {
    runPeer();
    return;
  }

  write(path.join(legacy, 'HARNESS_VERSION'), '1.36.161\n');
  write(path.join(legacy, 'progress-tracker.md'), `# Read ${workspace.LEGACY_WORKSPACE_DIR}/progress-tracker.md\n`);
  for (let i = 0; i < 1200; i++) {
    write(path.join(legacy, 'bulk', `f-${String(i).padStart(4, '0')}.md`),
      `Read ${workspace.LEGACY_WORKSPACE_DIR}/bulk/${i}\n${'x'.repeat(2048)}\n`);
  }

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

  fs.lstatSync = function patchedLstat(target, ...rest) {
    const isCanonicalRoot = path.resolve(String(target)) === canonical;
    let result;
    let thrown;
    try { result = originalLstat.call(fs, target, ...rest); }
    catch (error) { thrown = error; }

    if (isCanonicalRoot && !revalidationSeen && isMigrationRevalidation()) {
      revalidationSeen = true;
      earlyLockSeen = fs.existsSync(lockFile);
      peer = cp.spawn(process.execPath, [__filename, '--peer', root], {
        cwd: root,
        env: {
          ...process.env,
          LEERNESS_INTERNAL: '1',
          LEERNESS_NO_BANNER: '1',
          LEERNESS_NO_PROMPT: '1',
          LEERNESS_NO_AUTOCHCP: '1',
        },
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      peerDone = new Promise((resolve) => peer.on('close', (status) => resolve(status)));

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

main()
  .catch((error) => {
    process.stderr.write(`WORKSPACE_LOCK_ORDER_CRASH ${error && error.stack ? error.stack : error}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (!IS_PEER) {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
    }
  });
