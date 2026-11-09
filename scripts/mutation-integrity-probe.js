#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module);  

 
 
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
      'ambiguous.ps1': Buffer.from([0x41, 0xC2, 0xA1, 0x42]),  
      'corrupt-bom.ps1': Buffer.concat([BOM, Buffer.from([0xBE, 0xC8, 0xB3, 0xE7])]),
      'shebang.sh': Buffer.from('#!/bin/sh\nprintf "안녕\\n"\n', 'utf8'),
      'batch.cmd': Buffer.from('@echo off\r\necho 안녕\r\n', 'utf8'),
      'batch.bat': Buffer.from('@echo off\r\necho 안녕\r\n', 'utf8'),
       
       
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

     
    const sharedProject = path.join(concurrentDir, 'shared-recovery');
    const sharedRecovery = path.join(sharedProject, '.leerness', 'archive', 'mutation-recovery');
    const sharedStore = path.join(sharedProject, '.leerness', 'lessons.json');
    fs.mkdirSync(path.dirname(sharedStore), { recursive: true });
    fs.writeFileSync(sharedStore, 'store-0');
    const sharedScratches = dir => { try { return fs.readdirSync(dir).filter(name => name.startsWith('.leerness-write-')); } catch (e) { if (e.code === 'ENOENT') return []; throw e; } };
    const realRmdir = fs.rmdirSync;
    const rmdirCalls = [];
    fs.rmdirSync = (file, ...args) => { rmdirCalls.push(path.resolve(String(file))); return realRmdir(file, ...args); };
    try { originalWriter(sharedStore, Buffer.from('store-0'), Buffer.from('store-1'), { retainBackup: false }); }
    finally { fs.rmdirSync = realRmdir; }
    passed = check(fs.readFileSync(sharedStore, 'utf8') === 'store-1' && sharedScratches(sharedRecovery).length === 0, 'a publication that keeps no backup leaves no scratch folder') && passed;
    passed = check(fs.existsSync(sharedRecovery) && !rmdirCalls.includes(path.resolve(sharedRecovery)), 'a finished write never removes the recovery folder other stores share', JSON.stringify(rmdirCalls)) && passed;

    const realMkdtemp = fs.mkdtempSync;
    const vanishing = (times, fail = null) => {
      let left = times, seen = 0;
      fs.mkdtempSync = (prefix, ...args) => {
        if (path.dirname(String(prefix)) === sharedRecovery) { seen++; if (fail) throw fail; if (left-- > 0) realRmdir(sharedRecovery); }
        return realMkdtemp(prefix, ...args);
      };
      return () => seen;
    };
    let tries = vanishing(1), scratchError = null;
    try { originalWriter(sharedStore, Buffer.from('store-1'), Buffer.from('store-2'), { retainBackup: false }); } catch (e) { scratchError = e; }
    finally { fs.mkdtempSync = realMkdtemp; }
    passed = check(!scratchError && fs.readFileSync(sharedStore, 'utf8') === 'store-2' && tries() === 2, 'a recovery folder that vanishes before the scratch folder is made again', String(scratchError)) && passed;
    passed = check(fs.existsSync(sharedRecovery) && sharedScratches(sharedRecovery).length === 0, 'the write that made it again leaves the folder and no scratch') && passed;

    tries = vanishing(2);
    scratchError = null;
    try { originalWriter(sharedStore, Buffer.from('store-2'), Buffer.from('store-3'), { retainBackup: false }); } catch (e) { scratchError = e; }
    finally { fs.mkdtempSync = realMkdtemp; }
    passed = check(!scratchError && fs.readFileSync(sharedStore, 'utf8') === 'store-3' && tries() === 3, 'a folder that vanishes twice still does not fail the write', String(scratchError)) && passed;

    tries = vanishing(3);
    scratchError = null;
    try { originalWriter(sharedStore, Buffer.from('store-3'), Buffer.from('store-4'), { retainBackup: false }); } catch (e) { scratchError = e; }
    finally { fs.mkdtempSync = realMkdtemp; }
    passed = check(scratchError && scratchError.code === 'ENOENT' && fs.readFileSync(sharedStore, 'utf8') === 'store-3' && tries() === 3, 'the third miss stops the write before the store changes', String(scratchError)) && passed;
    passed = check(sharedScratches(path.dirname(sharedStore)).length === 0, 'no scratch folder goes beside a store when the recovery folder keeps missing') && passed;

    const longPathMiss = Object.assign(new Error('simulated mkdtemp miss on a long path'), { code: 'ENOENT' });
    fs.mkdirSync(sharedRecovery, { recursive: true });
    tries = vanishing(0, longPathMiss);
    scratchError = null;
    try { originalWriter(sharedStore, Buffer.from('store-3'), Buffer.from('store-4'), { retainBackup: false }); } catch (e) { scratchError = e; }
    finally { fs.mkdtempSync = realMkdtemp; }
    passed = check(scratchError === longPathMiss && fs.readFileSync(sharedStore, 'utf8') === 'store-3' && sharedScratches(path.dirname(sharedStore)).length === 0, 'ENOENT with the folder still there is refused the same way, nothing beside the store', String(scratchError)) && passed;

    const denied = Object.assign(new Error('simulated denial'), { code: 'EACCES' });
    tries = vanishing(0, denied);
    scratchError = null;
    try { originalWriter(sharedStore, Buffer.from('store-3'), Buffer.from('store-4'), { retainBackup: false }); } catch (e) { scratchError = e; }
    finally { fs.mkdtempSync = realMkdtemp; }
    passed = check(scratchError === denied && tries() === 1 && fs.readFileSync(sharedStore, 'utf8') === 'store-3', 'any other scratch failure stops at once, before the store changes', String(scratchError)) && passed;

    const blockedProject = path.join(concurrentDir, 'blocked-recovery');
    const blockedStore = path.join(blockedProject, '.leerness', 'lessons.json');
    fs.mkdirSync(path.dirname(blockedStore), { recursive: true });
    fs.writeFileSync(path.join(blockedProject, '.leerness', 'archive'), 'a file where the folder should be');
    fs.writeFileSync(blockedStore, 'blocked-0');
    scratchError = null;
    try { originalWriter(blockedStore, Buffer.from('blocked-0'), Buffer.from('blocked-1'), { retainBackup: false }); } catch (e) { scratchError = e; }
    passed = check(!scratchError && fs.readFileSync(blockedStore, 'utf8') === 'blocked-1' && sharedScratches(path.dirname(blockedStore)).length === 0, 'a recovery folder that cannot be made sends the scratch folder beside the store', String(scratchError)) && passed;

    const cleanupFile = path.join(concurrentDir, 'cleanup-denied.ps1');
    const cleanupExpected = Buffer.from('cleanup-original');
    fs.writeFileSync(cleanupFile, cleanupExpected);
    const originalWrite = fs.writeFileSync;
    const originalRm = fs.rmdirSync;
    fs.writeFileSync = (file, ...args) => {
      if (path.basename(String(file)) === 'next' && String(file).includes('.leerness-write-')) { const e = new Error('simulated temp write denial'); e.code = 'EACCES'; throw e; }
      return originalWrite(file, ...args);
    };
    fs.rmdirSync = (file, ...args) => {
      if (String(file).includes('.leerness-write-')) { const e = new Error('simulated cleanup denial'); e.code = 'EACCES'; throw e; }
      return originalRm(file, ...args);
    };
    let cleanupError = null;
    try { originalWriter(cleanupFile, cleanupExpected, Buffer.concat([BOM, cleanupExpected])); } catch (e) { cleanupError = e; }
    finally { fs.writeFileSync = originalWrite; fs.rmdirSync = originalRm; }
    passed = check(cleanupError && cleanupError.code === 'EACCES' && Array.isArray(cleanupError.recoveryArtifacts)
      && cleanupError.recoveryArtifacts.some(a => a.role === 'cleanup-failed-scratch'), 'cleanup exhaustion is surfaced with retained scratch') && passed;
    const cleanupScratch = cleanupError.recoveryArtifacts.find(a => a.role === 'cleanup-failed-scratch').path;
    cleanupRecovery([cleanupScratch]);

     
    const unexpectedFile = path.join(concurrentDir, 'unexpected-scratch.ps1');
    fs.writeFileSync(unexpectedFile, cleanupExpected);
    const originalMkdtemp = fs.mkdtempSync;
    let unexpectedPath;
    fs.mkdtempSync = (prefix, ...args) => {
      const dir = originalMkdtemp(prefix, ...args);
      if (String(prefix).includes('.leerness-write-')) {
        unexpectedPath = path.join(dir, 'external');
        fs.writeFileSync(unexpectedPath, 'unexpected content');
      }
      return dir;
    };
    let unexpectedResult;
    try { unexpectedResult = originalWriter(unexpectedFile, cleanupExpected, Buffer.from('updated'), { retainBackup: false }); }
    finally { fs.mkdtempSync = originalMkdtemp; }
    passed = check(unexpectedResult && unexpectedResult.cleanupError && unexpectedResult.cleanupDirectory
      && fs.readFileSync(unexpectedPath, 'utf8') === 'unexpected content'
      && fs.readFileSync(unexpectedFile, 'utf8') === 'updated',
    'nonempty scratch is retained with an explicit cleanup notice') && passed;
    cleanupRecovery([unexpectedResult.cleanupDirectory]);

     
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

   
  const drift = require('../lib/drift');

   
   
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

   
  const combinedDir = path.join(tempRoot, 'drift-security-critical');
  fs.mkdirSync(path.join(combinedDir, '.leerness'), { recursive: true });
   
   
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
