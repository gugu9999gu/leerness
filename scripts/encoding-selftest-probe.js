#!/usr/bin/env node
'use strict';

// T-0181: test the confirmed UR-0113 diagnostic/exit-code defect separately
// from the unconfirmed Windows CI failure. The default violates the platform's
// BOM contract: Windows misses its required replacement, whereas POSIX receives
// a forbidden BOM in the disposable fixture. Both must retain failure details
// and restore the caller's exit code. --real-controls uses the actual writer.
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'ENCODING_SELFTEST_RESULT:';
const MISSING = 'ENCODING_DIAGNOSTICS_MISSING';
const MAX_DIAGNOSTIC = 4096;
const FIXTURE_PREFIX = 'leerness-encoding-selftest-';

function samePath(left, right) {
  const normalize = value => process.platform === 'win32'
    ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}

function child(kind, arena, priorExit) {
  assert(['fault', 'canonical', 'junction'].includes(kind), 'unknown child scenario');
  assert(path.basename(arena).startsWith(FIXTURE_PREFIX), 'unexpected fixture name');
  assert(samePath(fs.realpathSync.native(arena), arena), 'fixture must be canonical');
  const canonical = path.join(arena, 'canonical-temp');
  const selected = kind === 'junction' ? path.join(arena, 'junction-temp') : canonical;
  assert(samePath(fs.realpathSync.native(selected), canonical), 'unexpected TEMP target');
  assert(fs.statSync(path.join(arena, '.leerness')).isDirectory(), 'missing recovery boundary');
  const previousTmpdir = os.tmpdir;
  os.tmpdir = () => selected;
  let injectedCalls = 0;
  let injectedByteChanges = 0;
  let unexpectedReplacementPlans = 0;
  try {
    const encoding = require('../lib/shell-encoding');
    if (kind === 'fault') {
      // Install before bin imports the export by value. Other fixture files
      // retain the real planner's no-op action, without calling a writer.
      encoding.applyShellScriptUtf8Bom = (file, displayFile = file) => {
        if (path.basename(file) === 's.ps1') {
          injectedCalls++;
          if (process.platform !== 'win32') {
            // A pre-replacement timeout alone leaves valid POSIX bytes and
            // therefore does not violate UR-0113's no-change contract. Model
            // an erroneous POSIX repair instead, confined to this fixture.
            const original = fs.readFileSync(file);
            const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
            assert(!original.subarray(0, bom.length).equals(bom), 'fault fixture already has a BOM');
            fs.writeFileSync(file, Buffer.concat([bom, original]));
            injectedByteChanges++;
          }
          const error = new Error('controlled encoding probe timeout: ' + 'x'.repeat(8192));
          error.code = 'ETIMEDOUT';
          throw error;
        }
        const plan = encoding.planShellScriptUtf8Bom(file, fs.readFileSync(file));
        if (plan.bytes) unexpectedReplacementPlans++;
        return { file: displayFile, action: plan.action };
      };
    }
    const cases = require('../bin/leerness')._selfTestCases()
      .filter(test => test.name.includes('UR-0113'));
    assert.strictEqual(cases.length, 1, 'expected exactly one UR-0113 case');
    process.exitCode = priorExit === 'unset' ? undefined : Number(priorExit);
    const beforeExit = process.exitCode;
    let returned = null;
    let thrown = null;
    try {
      const result = cases[0].run();
      returned = typeof result === 'boolean' ? result : null;
    } catch (error) {
      const message = String(error && error.message || error);
      thrown = {
        message: message.slice(0, MAX_DIAGNOSTIC + 1),
        length: message.length,
        hasTimeoutCode: message.includes('ETIMEDOUT'),
        hasFileName: message.includes('s.ps1'),
        platformContractFailed: message.includes('"platformOk":false'),
      };
    }
    const afterExit = process.exitCode;
    // Child status is transport status; report the case's actual exit state.
    process.exitCode = 0;
    process.stdout.write(PREFIX + JSON.stringify({
      kind, node: process.version, platform: process.platform,
      beforeExit: beforeExit === undefined ? null : beforeExit,
      afterExit: afterExit === undefined ? null : afterExit,
      returned, thrown, injectedCalls, injectedByteChanges, unexpectedReplacementPlans,
    }) + '\n');
  } finally {
    os.tmpdir = previousTmpdir;
  }
}

function childEnvironment(arena) {
  const env = { ...process.env };
  // The probe must not inherit ambient runtime descriptors, provider choices,
  // or Node preload hooks. TEMP is overridden inside the isolated child.
  for (const name of Object.keys(env)) {
    if (/^LEERNESS_/i.test(name) || /^NODE_OPTIONS$/i.test(name)) delete env[name];
  }
  return { ...env, LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1',
    GIT_CEILING_DIRECTORIES: arena };
}

function runChild(kind, arena, priorExit = 'unset') {
  const result = cp.spawnSync(process.execPath, [__filename, '--child', kind, arena, priorExit], {
    cwd: arena, env: childEnvironment(arena), encoding: 'utf8',
    shell: false, windowsHide: true,
    timeout: kind === 'fault' ? 15000 : 45000, maxBuffer: 64 * 1024,
  });
  assert(!result.error, `child failed: ${result.error && result.error.code}`);
  assert.strictEqual(result.status, 0,
    `child exit ${result.status}: ${String(result.stderr || '').slice(0, 1000)}`);
  const reports = String(result.stdout || '').split(/\r?\n/)
    .filter(line => line.startsWith(PREFIX));
  assert.strictEqual(reports.length, 1, 'child must emit exactly one observation');
  return JSON.parse(reports[0].slice(PREFIX.length));
}

function summary(result) {
  return JSON.stringify({
    kind: result.kind, platform: result.platform, beforeExit: result.beforeExit, afterExit: result.afterExit,
    returned: result.returned, injectedCalls: result.injectedCalls, injectedByteChanges: result.injectedByteChanges,
    thrown: result.thrown && {
      length: result.thrown.length,
      hasTimeoutCode: result.thrown.hasTimeoutCode,
      hasFileName: result.thrown.hasFileName,
      platformContractFailed: result.thrown.platformContractFailed,
    },
  });
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--child') return child(args[1], args[2], args[3]);
  if (args.length > 1 || (args.length && !['--expect-legacy', '--repro', '--real-controls', '--help'].includes(args[0]))) {
    throw new Error('usage: node scripts/encoding-selftest-probe.js [--expect-legacy|--repro|--real-controls]');
  }
  if (args[0] === '--help') {
    process.stdout.write('Default / --repro: violate the platform BOM contract; require bounded ETIMEDOUT diagnostics and restored exit code.\n'
      + '--expect-legacy: succeed only when silent failure and exit-code leakage are reproduced.\n'
      + '--real-controls: run the real canonical/junction TEMP happy cases separately.\n');
    return;
  }
  const mode = args[0] || '--repro';
  const tempParent = fs.realpathSync.native(os.tmpdir());
  const arena = fs.realpathSync.native(fs.mkdtempSync(path.join(tempParent, FIXTURE_PREFIX)));
  const canonical = path.join(arena, 'canonical-temp');
  const junction = path.join(arena, 'junction-temp');
  const failures = [];
  let total = 0;
  try {
    // Confine the preservation helper's ancestor search and recovery artifacts
    // to this exclusive fixture, even if the user's TEMP has another harness.
    fs.mkdirSync(path.join(arena, '.leerness'));
    fs.mkdirSync(canonical);
    const scenarios = mode === '--real-controls'
      ? [['canonical', 'unset'], ['junction', 'unset']]
      : [['fault', 'unset'], ['fault', '23']];
    if (mode === '--real-controls') {
      fs.symlinkSync(canonical, junction, process.platform === 'win32' ? 'junction' : 'dir');
    }
    for (const [kind, priorExit] of scenarios) {
      total++;
      const label = `${kind}, prior exit ${priorExit}`;
      try {
        const result = runChild(kind, arena, priorExit);
        if (mode === '--real-controls') {
          assert.strictEqual(result.returned, true, summary(result));
          assert.strictEqual(result.thrown, null, summary(result));
          assert.strictEqual(result.afterExit, result.beforeExit, summary(result));
        } else {
          assert.strictEqual(result.injectedCalls, 1, 'fault must reach s.ps1 exactly once');
          assert.strictEqual(result.injectedByteChanges, result.platform === 'win32' ? 0 : 1,
            'fault must violate the platform BOM contract');
          assert.strictEqual(result.unexpectedReplacementPlans, 0, 'fault probe must not need another replacement');
          const legacy = result.returned === false && !result.thrown
            && result.afterExit === 1 && result.afterExit !== result.beforeExit;
          if (mode === '--expect-legacy') {
            assert(legacy, `legacy defect was not reproduced: ${summary(result)}`);
            process.stdout.write(`${MISSING}: reproduced ${label}\n`);
          } else {
            assert(result.thrown && result.thrown.hasTimeoutCode && result.thrown.hasFileName
              && result.thrown.platformContractFailed
              && result.thrown.length <= MAX_DIAGNOSTIC,
            `${MISSING}: ${summary(result)}`);
            assert.strictEqual(result.afterExit, result.beforeExit,
              `ENCODING_EXIT_CODE_NOT_RESTORED: ${summary(result)}`);
          }
        }
        process.stdout.write(`ok - ${label}\n`);
      } catch (error) {
        failures.push(label);
        process.stderr.write(`not ok - ${label}: ${String(error.message).slice(0, MAX_DIAGNOSTIC)}\n`);
      }
    }
  } finally {
    if (fs.existsSync(junction)) {
      assert(fs.lstatSync(junction).isSymbolicLink(), 'refusing unexpected cleanup target');
      assert(samePath(fs.realpathSync.native(junction), canonical), 'refusing changed junction target');
      fs.unlinkSync(junction);
    }
    assert(path.basename(arena).startsWith(FIXTURE_PREFIX), 'refusing unexpected fixture cleanup');
    assert(samePath(path.dirname(arena), tempParent), 'fixture cleanup escaped TEMP');
    assert(samePath(fs.realpathSync.native(arena), arena), 'fixture cleanup target changed');
    fs.rmSync(arena, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 });
  }
  process.stdout.write(`encoding selftest probe: ${total - failures.length}/${total} PASS (${mode})\n`);
  if (failures.length) process.exitCode = 1;
}

try { main(); }
catch (error) {
  process.stderr.write(`encoding selftest probe error: ${String(error.message).slice(0, MAX_DIAGNOSTIC)}\n`);
  process.exitCode = 1;
}
