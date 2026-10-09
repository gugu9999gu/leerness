'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const { historicalRuleSummary, latestTestObservation, observeRule, summarizeRuleObservations } = require('../lib/rule-verification');
const cli = path.resolve(__dirname, '../bin/leerness.js');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-rule-verification-'));
const env = { ...process.env, TEMP: arena, TMP: arena, TMPDIR: arena, LEERNESS_INTERNAL: '1',
  LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_SUGGEST: '1' };
delete env.LEERNESS_LANG;
for (const key of Object.keys(env)) if (/^LEERNESS_ENABLE_/.test(key)) env[key] = '0';
env.LEERNESS_AUTO_SECURITY_FIX = '0'; env.LEERNESS_AUTO_APPLY_DELIVERED = '0';
const date = new Date().toISOString().slice(0, 10);
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.stack); } }
const row = (id, rule, status = 'active', lastVerified = '-') => ({ id, rule, trigger: 'every-session', status, lastVerified });
const observe = (text, previous = {}, current = {}, evidence = '') => observeRule(row('R-0001', text), previous, current, evidence, date);
function write(root, name, text) { const p = path.join(root, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
function fixture(name, rows, lang = 'en') {
  const root = path.join(arena, name); fs.mkdirSync(root);
  write(root, 'AGENTS.md', '<!-- leerness:managed -->\n# Original instructions\n');
  write(root, '.leerness/HARNESS_VERSION', require('../package.json').version);
  write(root, '.leerness/LANGUAGE', lang);
  write(root, '.leerness/manifest.json', JSON.stringify({ language: lang }));
  write(root, '.leerness/rules.md', '# Rules\n\nOriginal user notes 한글 🧪\n\n| ID | Trigger | Rule | Added | Status | Last Verified |\n|---|---|---|---|---|---|\n' + rows.map(r => `| ${r.id} | ${r.trigger} | ${r.rule} | ${date} | ${r.status} | ${r.lastVerified} |`).join('\n') + '\n');
  write(root, 'package.json', '{"name":"rule-probe","version":"1.0.0"}\n');
  return root;
}
function command(root, args, json = true) {
  const result = cp.spawnSync(process.execPath, [cli, ...args, ...(json ? ['--json'] : [])], { cwd: root, env, encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return json ? JSON.parse(result.stdout) : result.stdout;
}
try {
  test('historical records exclude paused/superseded rows and arbitrary references', () => {
    const r = historicalRuleSummary([row('R-0001', 'A', 'active', '2026-09-16 response observed'), row('R-0002', 'B', 'superseded', 'R-0003'), row('R-0003', 'C', 'paused', '2026-09-16'), row('R-0004', 'D', 'active', 'approved')]);
    assert.deepStrictEqual(r, { active: 2, historicalRecorded: 1, withoutDatedRecord: 1, invalidMarkers: 1, compliance: 'unknown', basis: 'active-lastVerified-date-only' });
  });
  test('invalid calendar dates are not dated verification metadata', () => {
    assert.equal(historicalRuleSummary([row('R-0001', 'A', 'active', '2026-02-30'), row('R-0002', 'B', 'active', '2024-02-29T10:00:00Z')]).historicalRecorded, 1);
  });
  test('version signal cannot satisfy deployment obligations', () => {
    const r = observe('Bump version and publish and push', { packageVersion: '1.0.0' }, { packageVersion: '1.0.1' });
    assert.equal(r.verified, 'manual'); assert.deepStrictEqual(r.clauses.map(c => [c.kind, c.verified]), [['version', 'observed'], ['deploy', 'manual']]);
    assert.equal(r.compliance, 'unknown'); assert.equal(r.applicability, 'unknown');
  });
  test('even a simple keyword signal cannot certify the full natural-language rule', () => {
    const r = observe('bump version', { packageVersion: '1' }, { packageVersion: '2' });
    assert.equal(r.verified, 'observed'); assert.equal(r.lastVerified, '-');
  });
  test('unchanged version is pending, not a proven violation', () => {
    const r = observe('bump version', { packageVersion: '1' }, { packageVersion: '1' });
    assert.equal(r.verified, 'pending'); assert.equal(r.compliance, 'unknown');
  });
  test('initial baseline cannot be promoted by a sibling observation', () => {
    assert.equal(observe('version and changelog', { packageVersion: '1' }, { packageVersion: '2', changelogMtime: 100 }).verified, 'baseline');
  });
  test('changelog time is explicitly only metadata', () => {
    const r = observe('changelog', { changelogMtime: 1 }, { changelogMtime: 2 });
    assert.equal(r.verified, 'observed'); assert.match(r.note, /content unverified/);
  });
  test('unrecognized and conditional natural-language rules stay manual', () => {
    for (const text of ['Use PUT for invoices', 'Never use emoji', '배포하지 않는다']) {
      const r = observe(text); assert.equal(r.verified, 'manual'); assert.equal(r.applicability, 'unknown');
    }
  });
  for (const [name, body, state] of [
    ['no evidence', '', 'missing'], ['mention only', `## ${date} test\nStarted tests`, 'incomplete'],
    ['explicit zero', `## ${date} verify-code\nexit=0`, 'exit-zero-signal'],
    ['colon exit', `## ${date} tests\nExit: 0`, 'exit-zero-signal'],
    ['nonzero', `## ${date} test\nexit=1`, 'failure-signal'],
    ['null', `## ${date} test\nexit=null`, 'failure-signal'],
    ['negative', `## ${date} test\nexit=-1`, 'failure-signal'],
    ['partial numeric token', `## ${date} test\nexit=0.5`, 'incomplete'],
    ['mixed exits', `## ${date} test\nexit=0\nexit=2`, 'failure-signal'],
    ['failed marker', `## ${date} test\nexit=0\nFAILED`, 'failure-signal'],
    ['older evidence', '## 2001-01-01 test\nexit=0', 'missing'],
    ['no header trigger', `## ${date} plan\nTest later, exit=0`, 'missing'],
    ['latest missing exit', `## ${date} test\nexit=0\n## ${date} test retry\nStarted`, 'incomplete'],
    ['latest failure CRLF', `## ${date} test\r\nexit=0\r\n## ${date} verify-code\r\nexit=null`, 'failure-signal'],
    ['next day exit not borrowed', `## ${date} test\nStarted\n## 2099-01-01 test\nexit=0`, 'incomplete'],
  ]) test('test evidence: ' + name, () => assert.equal(latestTestObservation(body, date).state, state));
  test('passing tests are not a proof of a prohibition or review identity', () => {
    const r = observe('Tests must pass and never change live data; final reviewer must be separate', {}, {}, `## ${date} test\nexit=0`);
    assert.equal(r.verified, 'observed'); assert.equal(r.compliance, 'unknown');
  });
  test('summary separates states and never manufactures a compliance rate', () => {
    const result = summarizeRuleObservations(['observed', 'pending', 'manual', 'baseline'].map(verified => ({ verified })));
    assert.equal(result.unverifiedRules, 4); assert.deepStrictEqual(result.states, { observed: 1, pending: 1, manual: 1, baseline: 1 });
    assert.equal(result.enforcement, 'advisory'); assert.equal(result.compliance, 'unknown');
    assert.equal(summarizeRuleObservations([]).active, 0);
  });
  for (const lang of ['ko', 'en']) {
    const root = fixture(lang, [row('R-0001', 'Bump version and deploy', 'active', '2026-09-16 historical note'), row('R-0002', 'Tests must pass'), row('R-0003', 'Old instruction', 'superseded', 'R-0001')], lang);
    const file = path.join(root, '.leerness/rules.md');
    const before = fs.readFileSync(file); const mtime = fs.statSync(file).mtimeMs;
    test(lang + ' CLI counts only active dated history', () => {
      for (const cmd of ['insights', 'retro']) {
        const r = command(root, [cmd]); assert.equal(r.data.activeRules, 2); assert.equal(r.data.verifiedRules, 1);
        assert.equal(r.data.ruleHistory.compliance, 'unknown');
      }
      const human = command(root, ['retro'], false); assert.doesNotMatch(human, /검증됨|검증 비율/); assert.match(human, /과거|historical/);
    });
    test(lang + ' real verification retains deployment and missing test evidence', () => {
      command(root, ['rule', 'verify']);
      write(root, 'package.json', '{"name":"rule-probe","version":"1.0.1"}\n');
      write(root, '.leerness/review-evidence.md', `## ${date} test\nStarted without an exit result\n`);
      const r = command(root, ['rule', 'verify']); assert.equal(r.results[0].verified, 'manual'); assert.equal(r.results[1].verified, 'pending');
      assert.equal(r.summary.unverifiedRules, 2); assert.equal(r.summary.compliance, 'unknown');
      assert.ok(r.results[0].clauses.some(c => c.kind === 'deploy' && c.verified === 'manual'));
      assert.match(r.notice, lang === 'ko' ? /준수 판정이 아닙니다/ : /not rule compliance/);
    });
    test(lang + ' whole-rule proof stays unknown after explicit successful test evidence', () => {
      write(root, '.leerness/review-evidence.md', `## ${date} test\nexit=0\n`);
      const r = command(root, ['rule', 'verify']); assert.equal(r.results[1].verified, 'observed');
      assert.equal(r.results[1].compliance, 'unknown'); assert.equal(r.results[1].lastVerified, '-');
      const human = command(root, ['rule', 'verify'], false); assert.match(human, /observed \(unverified\)/); assert.doesNotMatch(human, /✓ pass/);
    });
    test(lang + ' session close propagates the same honest contract', () => {
      const r = command(root, ['session', 'close', root, '--no-suggest']);
      assert.equal(r.ruleVerification.compliance, 'unknown'); assert.equal(r.ruleVerification.unverifiedRules, 2);
      assert.equal(r.rules[1].verified, 'observed'); assert.equal(r.rules[1].verificationScope, 'keyword-signals-only');
      assert.equal(r.rules[1].applicability, 'unknown');
      assert.deepStrictEqual(fs.readFileSync(file), before); assert.equal(fs.statSync(file).mtimeMs, mtime);
    });
    test(lang + ' handoff surfaces limitation alongside the original active rules', () => {
      const r = command(root, ['handoff', root]); assert.equal(r.activeRules.length, 2);
      assert.match(r.ruleVerificationNotice, lang === 'ko' ? /근거 부족은 미검증/ : /missing evidence is unverified/);
      assert.equal(r.activeRules[0].rule, 'Bump version and deploy');
    });
  }
  test('empty rule verification has explicit zero observations without a pass claim', () => {
    const root = fixture('empty', []); const r = command(root, ['rule', 'verify']);
    assert.equal(r.count, 0); assert.equal(r.summary.compliance, 'unknown');
  });
} finally {
  // Only this test's mkdtemp directory; no project or shared runtime cleanup.
  assert.ok(path.resolve(arena).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(arena, { recursive: true, force: true });
}
console.log(`Tests: ${passed}/${passed + failed} passed`);
if (failed) process.exitCode = 1;
