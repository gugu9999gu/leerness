'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const diagnostics = require('../lib/diagnostics');

const failures = [];
let checks = 0;
const groupPathInstallations = diagnostics._groupPathInstallations;

function check(condition, failure) {
  checks++;
  if (!condition) failures.push(failure);
}

if (typeof groupPathInstallations !== 'function') {
  failures.push('diagnostics._groupPathInstallations is not implemented');
} else {
  const npmShimPair = [
    'C:\\Users\\tester\\AppData\\Roaming\\npm\\leerness',
    'C:\\Users\\tester\\AppData\\Roaming\\npm\\leerness.cmd',
  ];
  const samePackage = candidate => candidate.replace(/\//g, '\\').toLowerCase().includes('\\npm\\leerness')
    ? 'c:\\users\\tester\\appdata\\roaming\\npm\\node_modules\\leerness\\package.json'
    : null;

  const oneInstall = groupPathInstallations(npmShimPair, {
    platform: 'win32',
    command: 'leerness',
    packageIdentity: samePackage,
  });
  check(oneInstall.length === 1 && oneInstall[0].candidates.length === 2,
    `same npm shim pair should be one install, got ${JSON.stringify(oneInstall)}`);

  const npmShimTrio = groupPathInstallations([...npmShimPair,
    'C:\\Users\\tester\\AppData\\Roaming\\npm\\leerness.ps1'], {
    platform: 'win32', command: 'leerness', packageIdentity: samePackage,
  });
  check(npmShimTrio.length === 1 && npmShimTrio[0].candidates.length === 3,
    `PowerShell shim should join the same npm install, got ${JSON.stringify(npmShimTrio)}`);

  const mixedCaseAndSeparators = groupPathInstallations([npmShimPair[0],
    'c:/Users/tester/AppData/Roaming/npm/leerness.cmd'], {
    platform: 'win32', command: 'leerness', packageIdentity: samePackage,
  });
  check(mixedCaseAndSeparators.length === 1,
    `Windows case and separator variants should share one install, got ${JSON.stringify(mixedCaseAndSeparators)}`);

  const nonStandardBat = groupPathInstallations([npmShimPair[0],
    'C:\\Users\\tester\\AppData\\Roaming\\npm\\leerness.bat'], {
    platform: 'win32', command: 'leerness', packageIdentity: samePackage,
  });
  check(nonStandardBat.length === 2,
    `non-standard .bat must not be merged without content proof, got ${JSON.stringify(nonStandardBat)}`);

  const trueConflict = groupPathInstallations([
    ...npmShimPair,
    'D:\\tools\\leerness.cmd',
  ], {
    platform: 'win32',
    command: 'leerness',
    packageIdentity: candidate => candidate.toLowerCase().startsWith('d:\\tools\\')
      ? 'd:\\tools\\node_modules\\leerness\\package.json'
      : samePackage(candidate),
  });
  check(trueConflict.length === 2,
    `different PATH directories should remain a conflict, got ${JSON.stringify(trueConflict)}`);

  const unprovenPair = groupPathInstallations(npmShimPair, {
    platform: 'win32',
    command: 'leerness',
    packageIdentity: () => null,
  });
  check(unprovenPair.length === 2,
    `same-stem files without a shared package must stay separate, got ${JSON.stringify(unprovenPair)}`);

  const posixCandidates = groupPathInstallations([
    '/usr/local/bin/leerness',
    '/opt/leerness/bin/leerness',
  ], {
    platform: 'linux',
    command: 'leerness',
    packageIdentity: () => 'same-version-is-not-same-install',
  });
  check(posixCandidates.length === 2,
    `POSIX candidates in separate PATH directories must not be grouped, got ${JSON.stringify(posixCandidates)}`);

  const report = diagnostics.whichCmd({
    VERSION: 'test', uiLang: 'en', has: () => false, harnessPath: 'fixture',
    platform: 'win32', pathCandidates: npmShimPair, packageIdentity: samePackage,
    skipNpm: true, quiet: true,
  });
  check(report.pathCandidates.length === 2 && report.pathInstallations.length === 1
      && !report.diagnostics.some(line => /precedence conflict/.test(line)),
  `product-level which report should preserve 2 raw shims without a conflict, got ${JSON.stringify(report)}`);

  const conflictReport = diagnostics.whichCmd({
    VERSION: 'test', uiLang: 'en', has: () => false, harnessPath: 'fixture',
    platform: 'win32', pathCandidates: [...npmShimPair, 'D:\\tools\\leerness.cmd'],
    packageIdentity: candidate => candidate.toLowerCase().startsWith('d:\\tools\\')
      ? 'd:\\tools\\node_modules\\leerness\\package.json' : samePackage(candidate),
    skipNpm: true, quiet: true,
  });
  check(conflictReport.pathInstallations.length === 2
      && conflictReport.diagnostics.some(line => /2 leerness installations/.test(line)),
  `product-level which report should retain true PATH conflicts, got ${JSON.stringify(conflictReport)}`);

  if (process.platform === 'win32') {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-which-shim-'));
    try {
      const packageDir = path.join(fixture, 'node_modules', 'leerness');
      const entryDir = path.join(packageDir, 'bin');
      fs.mkdirSync(entryDir, { recursive: true });
      fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
        name: 'leerness', version: '9.9.9', bin: { leerness: 'bin/leerness.js' },
      }));
      fs.writeFileSync(path.join(entryDir, 'leerness.js'), '#!/usr/bin/env node\n');
      const shShim = path.join(fixture, 'leerness');
      const cmdShim = path.join(fixture, 'leerness.cmd');
      const ps1Shim = path.join(fixture, 'leerness.ps1');
      const validSh = '#!/bin/sh\nexec node "$basedir/node_modules/leerness/bin/leerness.js" "$@"\n';
      const validCmd = '@ECHO off\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" "%dp0%\\node_modules\\leerness\\bin\\leerness.js" %*\n';
      const validPs1 = '#!/usr/bin/env pwsh\n& "node$exe" "$basedir/node_modules/leerness/bin/leerness.js" $args\n';
      fs.writeFileSync(shShim, validSh);
      fs.writeFileSync(cmdShim, validCmd);
      fs.writeFileSync(ps1Shim, validPs1);
      const detected = groupPathInstallations([
        shShim, cmdShim, ps1Shim,
      ], { platform: 'win32', command: 'leerness' });
      check(detected.length === 1 && detected[0].kind === 'npm-package'
          && detected[0].candidates.length === 3,
        `default package-manifest detection should group a real fixture, got ${JSON.stringify(detected)}`);

      fs.writeFileSync(shShim,
        '#!/bin/sh\nexec echo "$basedir/node_modules/leerness/bin/leerness.js" "$@"\n');
      const dummySh = groupPathInstallations([shShim, cmdShim], {
        platform: 'win32', command: 'leerness',
      });
      check(dummySh.length === 2,
        `a dummy extensionless target argument must not prove execution, got ${JSON.stringify(dummySh)}`);
      fs.writeFileSync(shShim, validSh);

      fs.writeFileSync(cmdShim,
        '@rem "%dp0%\\node_modules\\leerness\\bin\\leerness.js" %*\n"evil.exe" %*\n');
      const commentedCmd = groupPathInstallations([shShim, cmdShim], {
        platform: 'win32', command: 'leerness',
      });
      check(commentedCmd.length === 2,
        `a commented cmd target plus divergent invocation must not be grouped, got ${JSON.stringify(commentedCmd)}`);
      fs.writeFileSync(cmdShim, validCmd);

      fs.writeFileSync(ps1Shim,
        '# "$basedir/node_modules/leerness/bin/leerness.js" $args\n& evil $args\n');
      const commentedPs1 = groupPathInstallations([shShim, ps1Shim], {
        platform: 'win32', command: 'leerness',
      });
      check(commentedPs1.length === 2,
        `a commented PowerShell target plus divergent invocation must not be grouped, got ${JSON.stringify(commentedPs1)}`);
      fs.writeFileSync(ps1Shim, validPs1);

      const otherEntry = path.join(fixture, 'node_modules', 'other', 'bin');
      fs.mkdirSync(otherEntry, { recursive: true });
      fs.writeFileSync(path.join(otherEntry, 'other.js'), '#!/usr/bin/env node\n');
      fs.writeFileSync(cmdShim,
        '@ECHO off\n"%_prog%" "%dp0%\\node_modules\\other\\bin\\other.js" %*\n');
      const tampered = groupPathInstallations([
        shShim, cmdShim,
      ], { platform: 'win32', command: 'leerness' });
      check(tampered.length === 2,
        `adjacent package metadata must not hide a divergent shim, got ${JSON.stringify(tampered)}`);

      const localModules = path.join(fixture, 'local with space', 'node_modules');
      const localBin = path.join(localModules, '.bin');
      const localPackage = path.join(localModules, 'leerness');
      fs.mkdirSync(path.join(localPackage, 'bin'), { recursive: true });
      fs.mkdirSync(localBin, { recursive: true });
      fs.writeFileSync(path.join(localPackage, 'package.json'), JSON.stringify({
        name: 'leerness', version: '9.9.9', bin: { leerness: 'bin/leerness.js' },
      }));
      fs.writeFileSync(path.join(localPackage, 'bin', 'leerness.js'), '#!/usr/bin/env node\n');
      const localSh = path.join(localBin, 'leerness');
      const localCmd = path.join(localBin, 'leerness.cmd');
      const localPs1 = path.join(localBin, 'leerness.ps1');
      fs.writeFileSync(localSh,
        '#!/bin/sh\nexec node "$basedir/../leerness/bin/leerness.js" "$@"\n');
      fs.writeFileSync(localCmd,
        '@ECHO off\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" "%dp0%\\..\\leerness\\bin\\leerness.js" %*\n');
      fs.writeFileSync(localPs1,
        '#!/usr/bin/env pwsh\n& "node$exe" "$basedir/../leerness/bin/leerness.js" $args\n');
      const localInstall = groupPathInstallations([localSh, localCmd, localPs1], {
        platform: 'win32', command: 'leerness',
      });
      check(localInstall.length === 1 && localInstall[0].candidates.length === 3,
        `local node_modules/.bin shims should be one install, got ${JSON.stringify(localInstall)}`);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }
}

if (failures.length) {
  console.error(`which shim grouping failures (${failures.length}):`);
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`which shim grouping probe: ${checks}/${checks} passed`);
