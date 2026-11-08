'use strict';
require('./temp-cleanup').trackTemp(module);

 
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = path.resolve(__dirname, '../bin/leerness.js');
assert(fs.existsSync(cli), 'A complete checkout is required for the real CLI probe');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-doctor-cli-'));
try {
  const result = cp.spawnSync(process.execPath, [cli, 'doctor', '--json'], {
    cwd, encoding: 'utf8', windowsHide: true, shell: false, timeout: 15000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_DOCTOR_SELFTEST: '0' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, 'doctor failed: ' + String(result.stderr || '').slice(-500));
  const report = JSON.parse(result.stdout);
  assert.equal(report.diagnosisScope, 'environment');
  assert.equal(report.healthy, null);
  assert.equal(report.selftest.status, 'not_run');
  assert.equal(report.selftest.ok, null);
  assert.equal(report.selftest.total, 0);
  assert.deepEqual(report.selftest.failed, []);
  console.log('PASS real doctor CLI: environment-only report, unknown core health, no full selftest');
} finally {
  fs.rmSync(cwd, { recursive: true, force: true });
}
