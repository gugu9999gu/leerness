#!/usr/bin/env node
'use strict';

// T-0091: the parent-detect selftest must be independent of a Leerness
// workspace above the OS temp directory, and partial setup must be cleaned if
// the second mkdtempSync call fails.

const fs = require('fs');
const os = require('os');
const path = require('path');

const cliPath = process.env.LEERNESS_PARENT_PROBE_CLI
  ? path.resolve(process.env.LEERNESS_PARENT_PROBE_CLI)
  : path.resolve(__dirname, '..', 'bin', 'leerness.js');
const cli = require(cliPath);
const target = cli._selfTestCases().find(test => test.name.includes('parent detect (1.30.2 #157)'));
const sibling = cli._selfTestCases().find(test => test.name.includes('rule add flag/경로 break'));

if (!target || !sibling) {
  process.stderr.write('parent-detect selftest probe failed: target or sibling case not found\n');
  process.exit(1);
}

const originalTempEnv = {};
for (const key of ['TMPDIR', 'TEMP', 'TMP']) originalTempEnv[key] = process.env[key];

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-parent-selftest-probe-'));
const setupDirs = [];

function restoreTempEnv() {
  for (const [key, value] of Object.entries(originalTempEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function probeSecondMkdtempCleanup(test) {
  const originalMkdtempSync = fs.mkdtempSync;
  let firstSetupDir = null;
  let setupError = null;
  let setupResult = null;
  let setupCalls = 0;
  fs.mkdtempSync = function injectedMkdtempSync(prefix, options) {
    setupCalls++;
    if (setupCalls === 2) {
      const error = new Error('injected second mkdtempSync failure');
      error.code = 'EACCES';
      throw error;
    }
    firstSetupDir = originalMkdtempSync.call(fs, prefix, options);
    setupDirs.push(firstSetupDir);
    return firstSetupDir;
  };
  try {
    setupResult = test.run();
  } catch (error) {
    setupError = error;
  } finally {
    fs.mkdtempSync = originalMkdtempSync;
  }
  return {
    cleaned: !!firstSetupDir && !fs.existsSync(firstSetupDir),
    observable: setupCalls === 2
      && ((setupError && setupError.code === 'EACCES') || setupResult === false),
    calls: setupCalls,
  };
}

try {
  const baselinePass = target.run() === true;

  const contaminatedTemp = path.join(sandbox, 'tmp');
  fs.mkdirSync(path.join(sandbox, '.leerness'), { recursive: true });
  fs.mkdirSync(contaminatedTemp, { recursive: true });
  process.env.TMPDIR = contaminatedTemp;
  process.env.TEMP = contaminatedTemp;
  process.env.TMP = contaminatedTemp;
  const contaminatedAncestorPass = target.run() === true;
  restoreTempEnv();

  const targetSetup = probeSecondMkdtempCleanup(target);
  const siblingSetup = probeSecondMkdtempCleanup(sibling);
  const report = {
    ok: baselinePass && contaminatedAncestorPass
      && targetSetup.cleaned && targetSetup.observable
      && siblingSetup.cleaned && siblingSetup.observable,
    baselinePass,
    contaminatedAncestorPass,
    partialSetupCleaned: targetSetup.cleaned,
    setupFailureObservable: targetSetup.observable,
    setupCalls: targetSetup.calls,
    siblingPartialSetupCleaned: siblingSetup.cleaned,
    siblingSetupFailureObservable: siblingSetup.observable,
    siblingSetupCalls: siblingSetup.calls,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
} finally {
  restoreTempEnv();
  for (const dir of setupDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
}
