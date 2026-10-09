'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const policy = require('../lib/plain-language-reporting');
const core = require('../bin/leerness');
const { removeTree } = require('./temp-cleanup');
const cli = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-reporting-'));
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn();passed++;console.log('PASS ' + name); }
  catch (error) { failed++;console.error('FAIL ' + name + ': ' + error.stack); }
}
function run(root, args) {
  const result = cp.spawnSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', timeout: 90000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1',
      LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1', LEERNESS_NO_DRIFT_CHECK: '1' },
  });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
try {
  const project = path.join(arena, 'project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'reporting-fixture', version: '1.0.0' }));
  test('Korean and English generation share one policy path with two short skill pointers', () => {
    for (const lang of ['ko', 'en']) {
      const files = core.coreFiles(project, lang);
      assert.ok(files[policy.POLICY_PATH].includes('<!-- leerness:managed -->'));
      assert.ok(files[policy.POLICY_PATH].includes(lang === 'ko' ? '사용자 영향' : 'user impact'));
      for (const name of policy.SKILL_PATHS) {
        assert.ok(files[name].includes('name: plain-language-reporting'));
        assert.ok(files[name].includes(policy.POLICY_PATH));
        assert.ok(!files[name].includes('1. Lead with'));
      }
    }
  });
  test('fresh installation keeps reporting off and installs discoverable skills', () => {
    run(project, ['init', project, '--yes', '--minimal', '--no-setup-agents', '--no-mcp', '--no-auto-roadmap', '--no-official-skills', '--no-banner']);
    assert.deepStrictEqual(policy.state(project), { enabled: false, available: true, path: policy.POLICY_PATH, status: 'off' });
    for (const name of policy.SKILL_PATHS) assert.ok(fs.existsSync(path.join(project, name)));
    const handoff = JSON.parse(run(project, ['handoff', project, '--json', '--no-record']));
    assert.strictEqual(handoff.reportingPolicy.status, 'off');
  });
  test('explicit opt-in reaches JSON and compact handoff without duplicating policy text', () => {
    run(project, ['toggle', 'set', 'plain-language-reporting', 'on', '--json']);
    const handoff = JSON.parse(run(project, ['handoff', project, '--json', '--no-record']));
    assert.strictEqual(handoff.reportingPolicy.status, 'active');
    assert.strictEqual(handoff.reportingPolicy.path, policy.POLICY_PATH);
    assert.ok(!JSON.stringify(handoff).includes('보고의 표현에 적용한다'));
    const compact = run(project, ['handoff', project, '--compact', '--no-record']);
    assert.ok(compact.includes('report: ' + policy.POLICY_PATH));
  });
  test('unreadable setting and missing policy do not advertise active guidance', () => {
    const config = path.join(project, '.leerness', 'toggles.json');
    fs.writeFileSync(config, '{"plain-language-reporting":"unknown"}\n');
    assert.strictEqual(policy.state(project).status, 'config-unreadable');
    fs.writeFileSync(config, '{broken');
    assert.strictEqual(policy.state(project).status, 'config-corrupt');
    fs.writeFileSync(config, '{"plain-language-reporting":true}\n');
    const file = path.join(project, policy.POLICY_PATH);
    fs.renameSync(file, file + '.saved');
    assert.strictEqual(policy.state(project).status, 'policy-unavailable');
    fs.renameSync(file + '.saved', file);
    const original = fs.readFileSync(file);
    fs.writeFileSync(file, Buffer.from([0xff]));
    assert.strictEqual(policy.state(project).status, 'policy-unavailable');
    fs.writeFileSync(file, original);
  });
  test('reinstall preserves an authored policy suffix and explicit toggle', () => {
    const file = path.join(project, policy.POLICY_PATH);
    fs.appendFileSync(file, '\n## Project note\n우리 팀은 고객에게 먼저 결과를 설명한다.\n');
    run(project, ['init', project, '--yes', '--minimal', '--no-setup-agents', '--no-mcp', '--no-auto-roadmap', '--no-official-skills', '--no-banner']);
    assert.ok(fs.readFileSync(file, 'utf8').includes('우리 팀은 고객에게 먼저 결과를 설명한다.'));
    assert.strictEqual(policy.state(project).status, 'active');
  });
} finally {
  const resolved = fs.realpathSync(arena);
  assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(resolved).startsWith('leerness-reporting-'));
  removeTree(resolved, { recursive: true, force: true });
}
console.log(`plain-language reporting: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
