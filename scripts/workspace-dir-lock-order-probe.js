#!/usr/bin/env node
'use strict';

// A live legacy migration must own its project lock before the second workspace
// inspection. Otherwise a peer can populate `.leerness/` after validation and
// make the first caller misclassify the peer's intermediate copy as a user
// conflict. This probe forces that interleaving without relying on scheduler luck.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const workspace = require('../lib/workspace-dir');

const IS_PEER = process.argv[2] === '--peer';
const root = IS_PEER
  ? path.resolve(process.argv[3] || '.')
  : fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-lock-order-'));
const legacy = path.join(root, workspace.LEGACY_WORKSPACE_DIR);
const canonical = path.join(root, workspace.CANONICAL_WORKSPACE_DIR);
const lockFile = path.join(root, '.leerness-workspace-migration.lock');
const peerReadyFile = path.join(root, '.leerness-lock-order-peer-ready');
const peerContendedFile = path.join(root, '.leerness-lock-order-peer-contended');
const peerDoneFile = path.join(root, '.leerness-lock-order-peer-done');

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
  let canonicalInspections = 0;
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

    if (isCanonicalRoot && ++canonicalInspections === 2) {
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
      // victim is paused inside its second canonical workspace inspection.
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
  const ok = earlyLockSeen
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
