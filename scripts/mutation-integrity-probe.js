#!/usr/bin/env node
'use strict';

// T-0022: destructive shell-encoding repair must fail closed when encoding
// provenance, file identity, metadata, or concurrent-writer state is uncertain.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'leerness.js');
const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-mutation-integrity-'));
const env = {
  ...process.env,
  LEERNESS_INTERNAL: '1',
  LEERNESS_NO_BANNER: '1',
  LEERNESS_NO_PROMPT: '1',
  LEERNESS_NO_AUTOCHCP: '1',
  LEERNESS_OFFLINE: '1',
};

function run(args, cwd = tempRoot) {
  return cp.spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function check(ok, label, detail = '') {
  const line = `${ok ? 'PASS' : 'FAIL'} ${label}${!ok && detail ? `: ${detail}` : ''}\n`;
  (ok ? process.stdout : process.stderr).write(line);
  return !!ok;
}

function bomAddedExactly(before, after) {
  return after.length === before.length + BOM.length
    && after.subarray(0, BOM.length).equals(BOM)
    && after.subarray(BOM.length).equals(before);
}

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const result = run(['init', dir, '--yes', '--language', 'en', '--no-stale-check', '--no-banner', '--json']);
  if (result.status !== 0) throw new Error(`fixture init failed (${result.status}): ${(result.stdout || '')}${(result.stderr || '')}`);
}

function recoveryDirs(dir) {
  const parents = [dir, path.join(dir, '.leerness', 'archive', 'mutation-recovery')];
  return parents.flatMap(parent => {
    try {
      return fs.readdirSync(parent, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name.startsWith('.leerness-write-'))
        .map(e => path.join(parent, e.name));
    } catch { return []; }
  });
}

function cleanupRecovery(paths) {
  for (const p of new Set(paths.filter(Boolean))) {
    const resolved = path.resolve(p);
    if (!resolved.startsWith(path.resolve(tempRoot) + path.sep)) throw new Error(`unsafe recovery cleanup: ${resolved}`);
    const target = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
    fs.rmSync(target, { recursive: true, force: true });
  }
}

let passed = true;
try {
  const commands = [
    { name: 'env-encoding-apply', json: true, args: dir => ['env', 'encoding-check', '--apply', '--path', dir, '--json'] },
    { name: 'drift-auto-fix', json: true, args: dir => ['drift', 'check', '--auto-fix', '--path', dir, '--json'] },
    {
      name: 'drift-auto-fix-with-security',
      json: true,
      beforeRun: dir => {
        fs.writeFileSync(path.join(dir, '.env'), 'TOKEN=value\n');
        fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
      },
      args: dir => ['drift', 'check', '--auto-fix', '--path', dir, '--json'],
    },
    { name: 'session-auto-fix-encoding', json: false, args: dir => ['session', 'close', '--auto-fix-encoding', '--path', dir] },
    { name: 'session-auto-fix-encoding-json', json: true, args: dir => ['session', 'close', '--auto-fix-encoding', '--path', dir, '--json'] },
  ];

  for (const command of commands) {
    const dir = path.join(tempRoot, command.name);
    init(dir);
    const fixtures = {
      'legacy-cp949.ps1': Buffer.concat([Buffer.from('Write-Host "', 'ascii'), Buffer.from([0xBE, 0xC8, 0xB3, 0xE7]), Buffer.from('"\r\n', 'ascii')]),
      'ambiguous.ps1': Buffer.from([0x41, 0xC2, 0xA1, 0x42]), // UTF-8 A¡B, CP949 A징B
      'corrupt-bom.ps1': Buffer.concat([BOM, Buffer.from([0xBE, 0xC8, 0xB3, 0xE7])]),
      'shebang.sh': Buffer.from('#!/bin/sh\nprintf "안녕\\n"\n', 'utf8'),
      'batch.cmd': Buffer.from('@echo off\r\necho 안녕\r\n', 'utf8'),
      'batch.bat': Buffer.from('@echo off\r\necho 안녕\r\n', 'utf8'),
      // Emoji contains a CP949-invalid 0x80 trail byte, providing explicit
      // byte-level evidence that this body is not a valid legacy Korean file.
      'safe.ps1': Buffer.from('Write-Host "😀"\r\n', 'utf8'),
    };
    for (const [name, body] of Object.entries(fixtures)) fs.writeFileSync(path.join(dir, name), body);

    const adsBody = '[ZoneTransfer]\r\nZoneId=3';
    let adsSupported = false;
    if (process.platform === 'win32') {
      try { fs.writeFileSync(path.join(dir, 'safe.ps1') + ':Zone.Identifier', adsBody); adsSupported = true; } catch {}
    }
    if (command.beforeRun) command.beforeRun(dir);

    const result = run(command.args(dir), dir);
    passed = check(result.status === 0, `${command.name}: command succeeds`, `exit=${result.status} ${(result.stderr || '').slice(0, 240)}`) && passed;
    let json = null;
    if (command.json) {
      try { json = JSON.parse(result.stdout); } catch {}
      passed = check(!!json, `${command.name}: stdout is one valid JSON document`, (result.stdout || '').slice(0, 180)) && passed;
    }

    for (const name of Object.keys(fixtures).filter(name => name !== 'safe.ps1')) {
      const after = fs.readFileSync(path.join(dir, name));
      passed = check(after.equals(fixtures[name]), `${command.name}: ${name} remains byte-exact`) && passed;
    }
    const safeAfter = fs.readFileSync(path.join(dir, 'safe.ps1'));
    passed = check(
      process.platform === 'win32' ? bomAddedExactly(fixtures['safe.ps1'], safeAfter) : safeAfter.equals(fixtures['safe.ps1']),
      `${command.name}: platform mutation contract is exact`,
    ) && passed;

    const retained = recoveryDirs(dir);
    passed = check(retained.length === (process.platform === 'win32' ? 1 : 0), `${command.name}: displaced original retention is explicit`, `dirs=${retained.length}`) && passed;
    if (process.platform === 'win32' && retained[0]) {
      const backup = path.join(retained[0], 'before');
      passed = check(fs.readFileSync(backup).equals(fixtures['safe.ps1']), `${command.name}: retained original is byte-exact`) && passed;
      if (adsSupported) {
        let adsAfter = null;
        try { adsAfter = fs.readFileSync(path.join(dir, 'safe.ps1') + ':Zone.Identifier', 'utf8'); } catch {}
        passed = check(adsAfter === adsBody, `${command.name}: target ADS remains byte-exact`) && passed;
      }
    }

    const expectedAdded = process.platform === 'win32' ? 1 : 0;
    const expectedSkipped = process.platform === 'win32' ? 6 : 7;
    if (command.name === 'env-encoding-apply') {
      passed = check(json && json.atRisk.length === 7 && json.scanErrors.length === 0
        && json.applied.filter(x => x.action === 'utf8-bom-added').length === expectedAdded
        && json.applied.filter(x => x.action.startsWith('skipped-')).length === expectedSkipped,
      `${command.name}: JSON reports every mutation decision`, JSON.stringify(json && json.applied)) && passed;
    }
    if (command.name.startsWith('drift-auto-fix')) {
      const summary = json && json.encodingAutoFix;
      const all = json && json.autoFixSummary;
      passed = check(summary && summary.atRisk === 7 && summary.added === expectedAdded
        && summary.skipped === expectedSkipped && summary.failed === 0 && summary.results.length === 7,
      `${command.name}: encoding JSON is honest`, JSON.stringify(summary)) && passed;
      passed = check(all && all.requested === true && all.failed === 0 && all.stages.encoding
        && all.stages.delivered && all.stages.idempotency && all.stages.releaseCleanup && all.stages.session,
      `${command.name}: every auto-fix stage has structured JSON`, JSON.stringify(all)) && passed;
      if (command.name.endsWith('security')) {
        passed = check(all.stages.security.status === 'applied', `${command.name}: security repair is recorded`) && passed;
      }
    }
    if (command.name === 'session-auto-fix-encoding-json') {
      const summary = json && json.encodingAutoFix;
      passed = check(summary && summary.added === expectedAdded && summary.skipped === expectedSkipped
        && summary.failed === 0 && summary.scanErrors.length === 0,
      `${command.name}: JSON reports applied/skipped/failed honestly`, JSON.stringify(summary)) && passed;
    }
    if (!command.json && process.platform === 'win32') {
      passed = check(/retained original|복구본 보존/.test(result.stdout), `${command.name}: human output names retained recovery copy`) && passed;
    }
    cleanupRecovery(retained);
  }

  const ioPath = require.resolve('../lib/io');
  const shellPath = require.resolve('../lib/shell-encoding');
  const io = require(ioPath);
  const originalWriter = io.writeBufferIfUnchanged;
  const shellEncoding = require(shellPath);

  // Encoding provenance: both-byte-valid input and a corrupt BOM body must be
  // rejected, while a UTF-8 body invalid under CP949 remains eligible.
  passed = check(shellEncoding.planShellScriptUtf8Bom('x.ps1', Buffer.from([0x41, 0xC2, 0xA1, 0x42])).action.startsWith('skipped-ambiguous'), 'UTF-8/CP949 ambiguity fails closed') && passed;
  passed = check(shellEncoding.planShellScriptUtf8Bom('x.ps1', Buffer.concat([BOM, Buffer.from([0xBE, 0xC8])])).action.startsWith('skipped-invalid-bom-body'), 'BOM-prefixed CP949 corruption is detected') && passed;
  passed = check(shellEncoding.planShellScriptUtf8Bom('x.ps1', Buffer.from('Write-Host "😀"', 'utf8')).action === 'utf8-bom-added', 'unambiguous UTF-8 remains repairable') && passed;
  const NativeTextDecoder = global.TextDecoder;
  try {
    global.TextDecoder = class MissingLegacyDecoder extends NativeTextDecoder {
      constructor(label, options) {
        if (String(label).toLowerCase() === 'euc-kr') throw new RangeError('simulated small-ICU decoder set');
        super(label, options);
      }
    };
    passed = check(shellEncoding.planShellScriptUtf8Bom('x.ps1', Buffer.from([0x41, 0xC2, 0xA1, 0x42])).action.startsWith('skipped-ambiguous'), 'missing CP949 decoder fails closed') && passed;
  } finally {
    global.TextDecoder = NativeTextDecoder;
  }

  // Scanner I/O denial is data, never a clean scan.
  const scanDir = path.join(tempRoot, 'scan-errors');
  fs.mkdirSync(scanDir);
  const deniedFile = path.join(scanDir, 'denied.ps1');
  fs.writeFileSync(deniedFile, Buffer.from('Write-Host "😀"', 'utf8'));
  const originalRead = fs.readFileSync;
  fs.readFileSync = (file, ...args) => {
    if (path.resolve(String(file)) === path.resolve(deniedFile)) { const e = new Error('simulated read denial'); e.code = 'EACCES'; throw e; }
    return originalRead(file, ...args);
  };
  let deniedScan;
  try { deniedScan = shellEncoding.scanShellScriptsEncoding(scanDir); } finally { fs.readFileSync = originalRead; }
  passed = check(deniedScan.scanned === 0 && deniedScan.scanErrors.length === 1 && deniedScan.scanErrors[0].code === 'EACCES', 'scanner I/O failure is structured and incomplete') && passed;

  const concurrentDir = path.join(tempRoot, 'concurrent-cas');
  fs.mkdirSync(concurrentDir);
  if (process.platform === 'win32') {
    // Stale plan between caller read and shared writer.
    const staleFile = path.join(concurrentDir, 'stale.ps1');
    const staleOriginal = Buffer.from('Write-Host "😀"\r\n', 'utf8');
    const staleConcurrent = Buffer.from('Write-Host "CONCURRENT 😀"\r\n', 'utf8');
    fs.writeFileSync(staleFile, staleOriginal);
    io.writeBufferIfUnchanged = (file, expected, next, opts) => {
      fs.writeFileSync(file, staleConcurrent);
      return originalWriter(file, expected, next, opts);
    };
    delete require.cache[shellPath];
    let staleError = null;
    try { require(shellPath).applyShellScriptUtf8Bom(staleFile); } catch (e) { staleError = e; }
    io.writeBufferIfUnchanged = originalWriter;
    delete require.cache[shellPath];
    passed = check(staleError && staleError.code === 'E_CONCURRENT_MODIFICATION', 'shared mutator rejects a stale concurrent plan') && passed;
    passed = check(fs.readFileSync(staleFile).equals(staleConcurrent), 'stale-plan concurrent edit survives byte-exact') && passed;

    // Final compare -> ReplaceFile window. No risky rollback: the concurrent
    // file object remains at a reported recovery path.
    const raceFile = path.join(concurrentDir, 'replace-race.ps1');
    const raceExpected = Buffer.from('race-expected');
    const racePlanned = Buffer.concat([BOM, raceExpected]);
    const raceConcurrent = Buffer.from('RACE-CONCURRENT');
    fs.writeFileSync(raceFile, raceExpected);
    const originalSpawn = cp.spawnSync;
    cp.spawnSync = (command, args, options) => {
      if (options && options.env && options.env.LEERNESS_REPLACE_TO === raceFile) fs.writeFileSync(raceFile, raceConcurrent);
      return originalSpawn(command, args, options);
    };
    let raceError = null;
    try { originalWriter(raceFile, raceExpected, racePlanned); } catch (e) { raceError = e; }
    finally { cp.spawnSync = originalSpawn; }
    passed = check(raceError && raceError.code === 'E_CONCURRENT_MODIFICATION' && raceError.backupFile, 'final CAS race is reported with recovery') && passed;
    passed = check(fs.readFileSync(raceError.backupFile).equals(raceConcurrent), 'final-window concurrent bytes survive in reported recovery') && passed;
    passed = check(Array.isArray(raceError.recoveryArtifacts) && raceError.recoveryArtifacts.some(a => a.content === 'concurrent-or-unknown'), 'recovery artifacts expose byte roles') && passed;
    cleanupRecovery([raceError.backupFile]);

    // A handle opened before replacement may write to the displaced file after
    // validation. Retaining (rather than deleting) that file prevents loss.
    const lateFile = path.join(concurrentDir, 'late-handle.ps1');
    const lateExpected = Buffer.from('late-original');
    const latePlanned = Buffer.concat([BOM, lateExpected]);
    const lateBytes = Buffer.from('LATE-EDIT-OK');
    fs.writeFileSync(lateFile, lateExpected);
    const lateFd = fs.openSync(lateFile, 'r+');
    const lateResult = originalWriter(lateFile, lateExpected, latePlanned);
    fs.writeSync(lateFd, lateBytes, 0, lateBytes.length, 0);
    fs.ftruncateSync(lateFd, lateBytes.length);
    fs.closeSync(lateFd);
    passed = check(fs.readFileSync(lateFile).equals(latePlanned), 'planned target remains exact after displaced-handle write') && passed;
    passed = check(fs.readFileSync(lateResult.backupFile).equals(lateBytes), 'late displaced-handle write remains recoverable') && passed;
    cleanupRecovery([lateResult.backupFile]);

    // ADS handle update follows the same retained file object.
    const adsFile = path.join(concurrentDir, 'ads-late.ps1');
    const adsExpected = Buffer.from('ads-original');
    const adsPlanned = Buffer.concat([BOM, adsExpected]);
    fs.writeFileSync(adsFile, adsExpected);
    const adsPath = adsFile + ':Zone.Identifier';
    fs.writeFileSync(adsPath, 'OLD-ADS');
    const adsFd = fs.openSync(adsPath, 'r+');
    const adsResult = originalWriter(adsFile, adsExpected, adsPlanned);
    fs.writeSync(adsFd, Buffer.from('NEW-ADS'), 0, 7, 0);
    fs.ftruncateSync(adsFd, 7);
    fs.closeSync(adsFd);
    passed = check(fs.readFileSync(adsResult.backupFile + ':Zone.Identifier', 'utf8') === 'NEW-ADS', 'late ADS update survives on retained recovery file') && passed;
    cleanupRecovery([adsResult.backupFile]);

    // Same-content hard-link creation in the last window is detected from the
    // displaced file identity/link count and its alias remains intact.
    const linkRaceFile = path.join(concurrentDir, 'link-race.ps1');
    const linkAlias = path.join(concurrentDir, 'link-race-alias.ps1');
    const linkExpected = Buffer.from('link-original');
    const linkPlanned = Buffer.concat([BOM, linkExpected]);
    fs.writeFileSync(linkRaceFile, linkExpected);
    cp.spawnSync = (command, args, options) => {
      if (options && options.env && options.env.LEERNESS_REPLACE_TO === linkRaceFile && !fs.existsSync(linkAlias)) fs.linkSync(linkRaceFile, linkAlias);
      return originalSpawn(command, args, options);
    };
    let linkRaceError = null;
    try { originalWriter(linkRaceFile, linkExpected, linkPlanned); } catch (e) { linkRaceError = e; }
    finally { cp.spawnSync = originalSpawn; }
    passed = check(linkRaceError && linkRaceError.code === 'E_CONCURRENT_MODIFICATION' && linkRaceError.backupFile, 'last-window hard-link identity change is reported') && passed;
    passed = check(fs.readFileSync(linkAlias).equals(linkExpected) && fs.readFileSync(linkRaceError.backupFile).equals(linkExpected), 'hard-link aliases retain original bytes') && passed;
    fs.unlinkSync(linkAlias);
    cleanupRecovery([linkRaceError.backupFile]);

    // Documented ReplaceFileW 1177 partial progress: target moved to backup,
    // planned source remains, and target path is absent. Both roles are exposed.
    const partialFile = path.join(concurrentDir, 'partial-1177.ps1');
    const partialExpected = Buffer.from('partial-original');
    const partialPlanned = Buffer.concat([BOM, partialExpected]);
    fs.writeFileSync(partialFile, partialExpected);
    cp.spawnSync = (command, args, options) => {
      if (options && options.env && options.env.LEERNESS_REPLACE_TO === partialFile) {
        fs.renameSync(partialFile, options.env.LEERNESS_REPLACE_BACKUP);
        return { status: 1, stdout: '', stderr: 'LEERNESS_REPLACE_ERROR:1177:simulated partial progress', error: null };
      }
      return originalSpawn(command, args, options);
    };
    let partialError = null;
    try { originalWriter(partialFile, partialExpected, partialPlanned); } catch (e) { partialError = e; }
    finally { cp.spawnSync = originalSpawn; }
    passed = check(partialError && partialError.win32Code === 1177 && !fs.existsSync(partialFile), 'ReplaceFileW 1177 partial state is reported') && passed;
    const partialRoles = new Set((partialError.recoveryArtifacts || []).map(a => `${a.role}:${a.content}`));
    passed = check(partialRoles.has('planned-source:planned-replacement') && partialRoles.has('displaced-original:expected-original'), '1177 exposes both artifacts with validated roles', JSON.stringify(partialError.recoveryArtifacts)) && passed;
    cleanupRecovery([partialError.backupFile]);

    // Cleanup exhaustion must become an explicit retained artifact, not success.
    const cleanupFile = path.join(concurrentDir, 'cleanup-denied.ps1');
    const cleanupExpected = Buffer.from('cleanup-original');
    fs.writeFileSync(cleanupFile, cleanupExpected);
    const originalWrite = fs.writeFileSync;
    const originalRm = fs.rmSync;
    fs.writeFileSync = (file, ...args) => {
      if (path.basename(String(file)) === 'next' && String(file).includes('.leerness-write-')) { const e = new Error('simulated temp write denial'); e.code = 'EACCES'; throw e; }
      return originalWrite(file, ...args);
    };
    fs.rmSync = (file, ...args) => {
      if (String(file).includes('.leerness-write-')) { const e = new Error('simulated cleanup denial'); e.code = 'EACCES'; throw e; }
      return originalRm(file, ...args);
    };
    let cleanupError = null;
    try { originalWriter(cleanupFile, cleanupExpected, Buffer.concat([BOM, cleanupExpected])); } catch (e) { cleanupError = e; }
    finally { fs.writeFileSync = originalWrite; fs.rmSync = originalRm; }
    passed = check(cleanupError && cleanupError.code === 'EACCES' && Array.isArray(cleanupError.recoveryArtifacts)
      && cleanupError.recoveryArtifacts.some(a => a.role === 'cleanup-failed-scratch'), 'cleanup exhaustion is surfaced with retained scratch') && passed;
    const cleanupScratch = cleanupError.recoveryArtifacts.find(a => a.role === 'cleanup-failed-scratch').path;
    cleanupRecovery([cleanupScratch]);

    // Retry only no-progress Win32 sharing violations.
    const retryFile = path.join(concurrentDir, 'transient-sharing.ps1');
    const retryExpected = Buffer.from('retry-original');
    const retryPlanned = Buffer.concat([BOM, retryExpected]);
    fs.writeFileSync(retryFile, retryExpected);
    let retryCalls = 0;
    cp.spawnSync = (command, args, options) => {
      if (options && options.env && options.env.LEERNESS_REPLACE_TO === retryFile && retryCalls++ < 2) {
        return { status: 1, stdout: '', stderr: 'LEERNESS_REPLACE_ERROR:32:simulated sharing violation', error: null };
      }
      return originalSpawn(command, args, options);
    };
    let retryResult = null;
    let retryError = null;
    try { retryResult = originalWriter(retryFile, retryExpected, retryPlanned); } catch (e) { retryError = e; }
    finally { cp.spawnSync = originalSpawn; }
    passed = check(!retryError && retryCalls === 3 && fs.readFileSync(retryFile).equals(retryPlanned), 'transient sharing violation is retried with a bound') && passed;
    cleanupRecovery([retryResult && retryResult.backupFile]);
  } else {
    const posixFile = path.join(concurrentDir, 'posix.ps1');
    const posixBytes = Buffer.from('Write-Host "😀"\r\n', 'utf8');
    fs.writeFileSync(posixFile, posixBytes);
    const result = shellEncoding.applyShellScriptUtf8Bom(posixFile);
    passed = check(result.action.startsWith('skipped-platform') && fs.readFileSync(posixFile).equals(posixBytes), 'POSIX policy rejects metadata-loss replacement byte-exactly') && passed;
  }

  // Filesystem preconditions outside the direct writer.
  const protectedDir = path.join(tempRoot, 'filesystem-contracts');
  fs.mkdirSync(protectedDir);
  const readOnlyFile = path.join(protectedDir, 'readonly.ps1');
  const readOnlyBytes = Buffer.from('Write-Host "😀"\r\n', 'utf8');
  fs.writeFileSync(readOnlyFile, readOnlyBytes);
  fs.chmodSync(readOnlyFile, 0o444);
  let readOnlyError = null;
  let readOnlyResult = null;
  try { readOnlyResult = shellEncoding.applyShellScriptUtf8Bom(readOnlyFile); } catch (e) { readOnlyError = e; }
  passed = check((process.platform === 'win32'
    ? (readOnlyError && readOnlyError.code === 'E_READ_ONLY')
    : (readOnlyResult && readOnlyResult.action.startsWith('skipped-platform')))
    && fs.readFileSync(readOnlyFile).equals(readOnlyBytes), 'read-only eligible script follows platform mutation contract') && passed;
  fs.chmodSync(readOnlyFile, 0o666);

  const readOnlyShebang = path.join(protectedDir, 'readonly.sh');
  const readOnlyShebangBytes = Buffer.from('#!/bin/sh\nprintf "안녕\\n"\n', 'utf8');
  fs.writeFileSync(readOnlyShebang, readOnlyShebangBytes);
  fs.chmodSync(readOnlyShebang, 0o444);
  const readOnlyShebangResult = shellEncoding.applyShellScriptUtf8Bom(readOnlyShebang);
  passed = check(readOnlyShebangResult.action.startsWith('skipped-shebang')
    && fs.readFileSync(readOnlyShebang).equals(readOnlyShebangBytes), 'read-only shebang is a successful byte-exact skip') && passed;
  fs.chmodSync(readOnlyShebang, 0o666);

  const hardlinkFile = path.join(protectedDir, 'hardlink.ps1');
  const hardlinkAlias = path.join(protectedDir, 'hardlink-alias.ps1');
  fs.writeFileSync(hardlinkFile, readOnlyBytes);
  fs.linkSync(hardlinkFile, hardlinkAlias);
  const hardlinkResult = shellEncoding.applyShellScriptUtf8Bom(hardlinkFile);
  passed = check(hardlinkResult.action.startsWith('skipped-multiple-links')
    && fs.readFileSync(hardlinkFile).equals(readOnlyBytes) && fs.readFileSync(hardlinkAlias).equals(readOnlyBytes), 'hard-linked script and aliases remain exact') && passed;

  const symlinkTarget = path.join(protectedDir, 'symlink-target.ps1');
  const symlinkFile = path.join(protectedDir, 'symlink.ps1');
  fs.writeFileSync(symlinkTarget, readOnlyBytes);
  try {
    fs.symlinkSync(symlinkTarget, symlinkFile, 'file');
    const symlinkResult = shellEncoding.applyShellScriptUtf8Bom(symlinkFile);
    passed = check(symlinkResult.action.startsWith('skipped-symlink') && fs.readFileSync(symlinkTarget).equals(readOnlyBytes), 'symbolic-link target remains exact') && passed;
  } catch (e) {
    if (!['EPERM', 'EACCES', 'UNKNOWN'].includes(e.code)) throw e;
  }

  // Direct drift DI probes: one failed stage must be JSON-visible/exit 1.
  const drift = require('../lib/drift');

  // An unborn repository is valid and has no release refs to clean. Do not
  // ask Git to resolve `main` until the cleanup threshold can be reached.
  const unbornDir = path.join(tempRoot, 'drift-unborn-git');
  const gitInit = cp.spawnSync('git', ['init', unbornDir], { encoding: 'utf8', timeout: 30000 });
  passed = check(gitInit.status === 0, 'unborn Git fixture initializes', (gitInit.stderr || '').slice(0, 300)) && passed;
  const unbornRun = run(['drift', 'check', '--auto-fix', '--path', unbornDir, '--json'], unbornDir);
  let unbornJson = null;
  try { unbornJson = JSON.parse(unbornRun.stdout); } catch {}
  passed = check(unbornRun.status === 0 && unbornJson
    && unbornJson.autoFixSummary.stages.releaseCleanup.status === 'not-needed'
    && unbornJson.autoFixSummary.stages.releaseCleanup.candidates === 0,
  'drift auto-fix accepts an unborn repository with zero release refs', `${unbornRun.stdout}${unbornRun.stderr}`.slice(0, 500)) && passed;

  const driftDir = path.join(tempRoot, 'drift-structured-failure');
  fs.mkdirSync(path.join(driftDir, '.leerness'), { recursive: true });
  const driftDeps = {
    VERSION: 'test',
    has: flag => flag === '--json' || flag === '--auto-fix',
    arg: (key, fallback) => fallback,
    uiLang: 'en',
    harnessPath: path.join(driftDir, 'fake-leerness.js'),
    readProgressRows: () => [{ updated: new Date().toISOString().slice(0, 10) }],
    planPath: root => path.join(root, '.leerness', 'plan.md'),
    handoffPath: root => path.join(root, '.leerness', 'session-handoff.md'),
    currentStatePath: root => path.join(root, '.leerness', 'current-state.md'),
    taskLogPath: root => path.join(root, '.leerness', 'task-log.md'),
    envDiff: () => ({ inEnvOnly: [] }),
    _usageStatsPath: root => path.join(root, '.leerness', 'usage.json'),
    _readUsageStats: () => ({}),
    _updateUserRequest: () => null,
    _scanShellScriptsEncoding: () => ({ scanned: 0, atRisk: [], scanErrors: [] }),
    _readFeatureGraph: () => ({ nodes: [] }),
    _detectDeliveredRequests: () => ({ candidates: [] }),
    _autoFixIdempotency: () => [{ action: 'error', kind: 'tasks', detail: 'simulated dedup failure' }],
  };
  const savedExit = process.exitCode;
  const savedWrite = process.stdout.write;
  let driftOut = '';
  process.exitCode = 0;
  try {
    process.stdout.write = chunk => { driftOut += chunk; return true; };
    drift.driftCheckCmd(driftDir, {}, driftDeps);
  } finally { process.stdout.write = savedWrite; }
  let driftJson = null;
  try { driftJson = JSON.parse(driftOut); } catch {}
  passed = check(process.exitCode === 1 && driftJson && driftJson.autoFixSummary.failed === 1
    && driftJson.autoFixSummary.stages.idempotency.status === 'failed', 'non-encoding drift auto-fix failure is JSON-visible and exits 1', driftOut.slice(0, 300)) && passed;
  process.exitCode = savedExit;

  // A missing Git executable is an operational failure, not evidence that the
  // path is outside a worktree. Preserve the failure in JSON and the exit code.
  const missingGitDeps = {
    ...driftDeps,
    _autoFixIdempotency: () => [],
    _gitSpawn: () => ({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }) }),
  };
  let missingGitOut = '';
  process.exitCode = 0;
  try {
    process.stdout.write = chunk => { missingGitOut += chunk; return true; };
    drift.driftCheckCmd(driftDir, {}, missingGitDeps);
  } finally { process.stdout.write = savedWrite; }
  let missingGitJson = null;
  try { missingGitJson = JSON.parse(missingGitOut); } catch {}
  passed = check(process.exitCode === 1 && missingGitJson
    && missingGitJson.autoFixSummary.stages.releaseCleanup.status === 'failed'
    && missingGitJson.autoFixSummary.stages.releaseCleanup.results.some(r => r.code === 'ENOENT'),
  'missing Git executable is JSON-visible and exits 1', missingGitOut.slice(0, 300)) && passed;
  process.exitCode = savedExit;

  // Security + critical drift must still run session recovery in the same pass.
  const combinedDir = path.join(tempRoot, 'drift-security-critical');
  fs.mkdirSync(path.join(combinedDir, '.leerness'), { recursive: true });
  // The DI fixture writes a synthetic usage.json, unlike the real cache path.
  // Establish workspace ownership before exercising its recovery sequence.
  fs.writeFileSync(path.join(combinedDir, '.leerness', 'HARNESS_VERSION'), 'fixture\n');
  fs.writeFileSync(path.join(combinedDir, '.env'), 'TOKEN=value\n');
  fs.writeFileSync(path.join(combinedDir, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(combinedDir, '.leerness', 'session-handoff.md'), 'Last generated: 2020-01-01T00:00:00.000Z\n');
  for (let i = 0; i < 5; i++) fs.mkdirSync(path.join(combinedDir, '_apps', `a${i}`, '.leerness'), { recursive: true });
  let auditCalls = 0;
  let sessionCalls = 0;
  const originalSpawn = cp.spawnSync;
  cp.spawnSync = (command, args, options) => {
    if (command === process.execPath && args && args[0] === driftDeps.harnessPath && args[1] === 'audit') {
      auditCalls++;
      fs.writeFileSync(path.join(combinedDir, '.gitignore'), '.env\n.env.local\n.env.production\n.env.*.local\n*.pem\ncredentials.json\n');
      return { status: 0, stdout: '', stderr: '', error: null };
    }
    if (command === process.execPath && args && args[0] === driftDeps.harnessPath && args[1] === 'session') {
      sessionCalls++;
      fs.writeFileSync(path.join(combinedDir, '.leerness', 'session-handoff.md'), `Last generated: ${new Date().toISOString()}\n`);
      return { status: 0, stdout: '', stderr: '', error: null };
    }
    return originalSpawn(command, args, options);
  };
  const combinedDeps = { ...driftDeps, readProgressRows: () => [], _autoFixIdempotency: () => [] };
  let combinedOut = '';
  process.exitCode = 0;
  try {
    process.stdout.write = chunk => { combinedOut += chunk; return true; };
    drift.driftCheckCmd(combinedDir, {}, combinedDeps);
  } finally { process.stdout.write = savedWrite; cp.spawnSync = originalSpawn; }
  let combinedJson = null;
  try { combinedJson = JSON.parse(combinedOut); } catch {}
  passed = check(auditCalls === 1 && sessionCalls === 1 && combinedJson
    && combinedJson.autoFixSummary.stages.security.status === 'applied'
    && combinedJson.autoFixSummary.stages.session.status === 'applied', 'critical session recovery runs after security repair', combinedOut.slice(0, 300)) && passed;
  process.exitCode = savedExit;
} finally {
  const resolved = path.resolve(tempRoot);
  const resolvedTmp = path.resolve(os.tmpdir());
  if (!resolved.startsWith(resolvedTmp + path.sep) || path.dirname(resolved) !== resolvedTmp) throw new Error(`unsafe cleanup target: ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
}

if (!passed) {
  process.stderr.write('MUTATION_INTEGRITY_FAILED\n');
  process.exit(1);
}
process.stdout.write('MUTATION_INTEGRITY_OK\n');
