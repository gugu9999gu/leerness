#!/usr/bin/env node
'use strict';

// T-0182: execute the original E2E counter and failure assertion, with real
// process-local TMP isolation. No product implementation or fs/os mock.
const assert = require('assert');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const E2E = path.resolve(__dirname, 'e2e.js');
const PREFIX = 'leerness-e2e-temp-scope-';
const CASES = ['foreign-parent', 'child-residue'];
const realpath = file => fs.realpathSync.native(file);
const signature = file => ({
  sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  mtimeNs: String(fs.statSync(file, { bigint: true }).mtimeNs),
});

function uniqueIndex(source, anchor) {
  const index = source.indexOf(anchor);
  assert(index >= 0 && source.indexOf(anchor, index + anchor.length) < 0,
    `missing or ambiguous source anchor: ${anchor}`);
  return index;
}

function originalAssertion() {
  const source = fs.readFileSync(E2E, 'utf8');
  const first = uniqueIndex(source, '// 1.36.134:');
  const last = uniqueIndex(source, '// AD(1.36.140)');
  assert(last > first, 'E2E block anchors reversed');
  const block = source.slice(first, last);
  const start = uniqueIndex(block, '      const leftovers = ');
  const end = uniqueIndex(block, '      dbg.noSwitch = ');
  assert(end > start, 'counter anchors reversed');
  const body = block.slice(start, end);
  assert.strictEqual(body.trim().split(/\r?\n/).length, 2, 'expected original counter and bad.push only');
  return new Function('fs', 'os', 'sb', 'bad', body + '\nreturn { leftovers, bad };');
}

function snapshot(directory) {
  const rows = [];
  const visit = file => {
    const stat = fs.lstatSync(file, { bigint: true });
    assert(stat.isDirectory() || stat.isFile(), 'unexpected fixture link or special file');
    rows.push([path.relative(directory, file) || '.', String(stat.mode), String(stat.size),
      String(stat.mtimeNs), stat.isFile() ? fs.readFileSync(file).toString('base64') : null]);
    if (stat.isDirectory()) fs.readdirSync(file).sort().forEach(name => visit(path.join(file, name)));
  };
  visit(directory);
  return rows;
}

function childCase(directory, scenario) {
  assert(CASES.includes(scenario), 'unknown fixture scenario');
  assert.strictEqual(path.resolve(directory), realpath(directory), 'fixture path is not canonical');
  assert.strictEqual(realpath(os.tmpdir()), directory, 'child TMP isolation failed');
  assert.strictEqual(path.basename(directory), scenario);
  assert(new RegExp(`^${PREFIX}[A-Za-z0-9]{6}$`).test(path.basename(path.dirname(directory))));
  assert.deepStrictEqual(fs.readdirSync(directory), [], 'fixture must begin empty');
  const sb = path.join(directory, 'child-sb');
  fs.mkdirSync(sb);
  const marker = path.join(scenario === 'foreign-parent' ? directory : sb, 'leerness-probe-24680-1234567890123.sh');
  fs.writeFileSync(marker, '# owned, non-executed T-0182 fixture\n', { flag: 'wx' });
  const before = snapshot(directory);
  const result = originalAssertion()(fs, os, sb, []);
  const unchanged = JSON.stringify(snapshot(directory)) === JSON.stringify(before);
  process.stdout.write(JSON.stringify({ ...result, unchanged }) + '\n');
}

function run() {
  const sources = [__filename, E2E];
  const sourceBefore = sources.map(signature);
  const temp = realpath(os.tmpdir());
  const arena = fs.mkdtempSync(path.join(temp, PREFIX));
  const identity = fs.lstatSync(arena, { bigint: true });
  let passed = 0;
  const failures = [];
  try {
    for (const scenario of CASES) {
      try {
        const directory = path.join(arena, scenario);
        fs.mkdirSync(directory);
        const env = { ...process.env };
        for (const key of Object.keys(env)) if (/^(TMP|TEMP|TMPDIR)$/i.test(key)) delete env[key];
        Object.assign(env, { TMP: directory, TEMP: directory, TMPDIR: directory });
        const result = cp.spawnSync(process.execPath, [__filename, '--child', directory, scenario],
          { cwd: directory, env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true });
        assert.strictEqual(result.status, 0, String(result.stderr || result.error || 'child did not finish'));
        assert.strictEqual(result.stderr, '', 'unexpected child stderr');
        const report = JSON.parse(result.stdout);
        assert.strictEqual(report.unchanged, true, 'observation changed fixture bytes/mtime');
        const expected = scenario === 'child-residue' ? 1 : 0;
        assert.strictEqual(report.leftovers, expected, `leftovers=${report.leftovers}, expected=${expected}`);
        assert.strictEqual(report.bad.length, expected, `failure assertion count=${report.bad.length}, expected=${expected}`);
        passed++;
        process.stdout.write(`ok - ${scenario}\n`);
      } catch (error) {
        failures.push(`${scenario}: ${error.message}`);
        process.stdout.write(`not ok - ${scenario}: ${error.message}\n`);
      }
    }
  } finally {
    // Never enumerate or remove pre-existing global prefix artifacts.
    const stat = fs.lstatSync(arena, { bigint: true });
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'cleanup target is not an owned directory');
    assert.strictEqual(path.resolve(arena), realpath(arena), 'cleanup canonical path changed');
    assert.strictEqual(path.dirname(arena), temp, 'cleanup escaped the recorded temp parent');
    assert(new RegExp(`^${PREFIX}[A-Za-z0-9]{6}$`).test(path.basename(arena)), 'cleanup prefix mismatch');
    assert.strictEqual(stat.dev, identity.dev, 'cleanup device changed');
    assert.strictEqual(stat.ino, identity.ino, 'cleanup directory identity changed');
    fs.rmSync(arena, { recursive: true, force: true });
  }
  assert(!fs.existsSync(arena), 'owned arena was not removed');
  assert.deepStrictEqual(sources.map(signature), sourceBefore, 'source SHA256/mtime changed');
  process.stdout.write(`e2e temp scope probe: ${passed}/${CASES.length} passed; skipped 0; source unchanged; owned arena cleaned\n`);
  if (failures.length) throw new Error('owned TMP contract failed: ' + failures.join('; '));
}

try {
  if (process.argv[2] === '--child') childCase(process.argv[3], process.argv[4]);
  else run();
} catch (error) {
  process.stderr.write(`owned TMP contract failed: ${error.message}\n`);
  process.exitCode = 1;
}
