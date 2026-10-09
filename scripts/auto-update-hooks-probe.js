#!/usr/bin/env node
'use strict';

// Real CLI regressions for the configuration consumed by Codex/Claude hooks.
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const assert = require('assert/strict');
const selection = process.argv.slice(2);
if (selection.length && (selection.length !== 2 || selection[0] !== '--filter' || !selection[1])) {
  throw new Error('Usage: node scripts/auto-update-hooks-probe.js [--filter name]');
}
const filter = selection[1] || '';
const cli = path.resolve(__dirname, '../bin/leerness.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness hooks '));
const settings = path.join(root, '.claude/settings.local.json');
const update = 'leerness update --check --quiet';
const context = 'leerness hook session-start';
let passed = 0, failed = 0;
function run(args, project = root) {
  const r = cp.spawnSync(process.execPath, [cli, ...args, '--path', project], {
    cwd: root, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1' },
  });
  assert.equal(r.error, undefined);
  return r;
}
function save(groups, extra = {}) {
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ ...extra, hooks: { SessionStart: groups } }));
}
function groups() { return JSON.parse(fs.readFileSync(settings, 'utf8')).hooks.SessionStart; }
function status() { const r = run(['auto-update', 'status', '--json']); assert.equal(r.status, 0); return JSON.parse(r.stdout); }
function install() { const r = run(['auto-update', 'install']); assert.equal(r.status, 0, r.stderr || r.stdout); }
function check(name, fn) {
  if (filter && !name.includes(filter)) return;
  try { fn(); passed++; console.log(`ok - ${name}`); }
  catch (e) { failed++; console.log(`not ok - ${name}: ${e.message}`); }
}
try {
  check('user nested non-quiet check is recognized without writes', () => {
    save([{ matcher: '*', hooks: [{ type: 'command', command: 'leerness update --check' }] }]);
    const before = fs.readFileSync(settings);
    assert.equal(status().hooks.updateCheck, true);
    assert.deepEqual(fs.readFileSync(settings), before);
  });
  check('install writes valid nested command handlers', () => {
    save([]); install();
    assert.equal(groups().length, 2);
    assert(groups().every(g => !Object.hasOwn(g, 'command') && Array.isArray(g.hooks)
      && g.hooks.every(h => h.type === 'command' && typeof h.command === 'string')));
    assert.equal(status().installed, true);
  });
  check('legacy flat configuration is repairable, not installed', () => {
    save([{ matcher: '*', command: update }, { matcher: 'startup|clear|compact', command: context }]);
    assert.equal(status().installed, false);
    install();
    assert(groups().every(g => Array.isArray(g.hooks) && !Object.hasOwn(g, 'command')));
    assert.equal(status().installed, true);
  });
  check('nested upgrade preserves custom siblings and handler options', () => {
    const foreign = { type: 'command', command: 'echo custom', timeout: 4 };
    save([{ matcher: '*', note: 'keep group', hooks: [foreign, { type: 'command', command: 'leerness update --check', timeout: 17 }] },
      { matcher: 'startup|clear|compact', hooks: [{ type: 'command', command: context }] }], { permissions: { allow: ['Read'] } });
    install();
    assert.deepEqual(groups()[0].hooks, [foreign, { type: 'command', command: update, timeout: 17 }]);
    assert.equal(groups()[0].note, 'keep group');
    assert.equal(groups().length, 2);
    assert.deepEqual(JSON.parse(fs.readFileSync(settings)).permissions, { allow: ['Read'] });
    const before = fs.readFileSync(settings); install(); assert.deepEqual(fs.readFileSync(settings), before);
  });
  check('omitted matcher and empty matcher are wildcard groups', () => {
    for (const g of [{}, { matcher: '' }]) {
      save([{ ...g, hooks: [{ type: 'command', command: update }] },
        { matcher: 'startup|clear|compact', hooks: [{ type: 'command', command: context }] }]);
      assert.equal(status().installed, true); install(); assert.equal(groups().length, 2);
    }
  });
  check('lookalikes and different matchers remain unchanged', () => {
    const custom = [{ matcher: 'resume', hooks: [{ type: 'command', command: 'leerness update --check' }] },
      { matcher: '*', hooks: [{ type: 'prompt', command: update }, { type: 'command', command: `echo ${update}` }] }];
    save(custom); assert.equal(status().hooks.updateCheck, false); install();
    assert.deepEqual(groups().slice(0, 2), custom);
  });
  check('malformed JSON and handler types are preserved on failure', () => {
    for (const bytes of ['{broken', '{"hooks":{"SessionStart":[{"hooks":[null]}]}}']) {
      fs.writeFileSync(settings, bytes);
      assert.notEqual(run(['auto-update', 'install']).status, 0);
      assert.equal(fs.readFileSync(settings, 'utf8'), bytes);
    }
  });
  check('old plus and flat defaults do not duplicate existing nested hooks', () => {
    save([{ matcher: '*', hooks: [{ type: 'command', command: update }] },
      { matcher: '*', command: 'leerness-plus update --check' },
      { matcher: '*', command: update }]);
    install(); assert.equal(groups().length, 2);
    assert.equal(groups().flatMap(g => g.hooks || []).filter(h => h.command === update).length, 1);
  });
  check('init generates staged testing instructions in Korean and English', () => {
    for (const language of ['ko', 'en']) {
      const project = path.join(root, language);
      const r = run(['init', project, '--yes', '--language', language, '--no-auto-update'], project);
      assert.equal(r.status, 0, r.stderr || r.stdout);
      const strategy = fs.readFileSync(path.join(project, '.leerness/testing-strategy.md'), 'utf8');
      assert(strategy.includes(language === 'ko' ? '실패한 테스트' : 'failed test'));
      assert(strategy.includes(language === 'ko' ? '전체 CI를 1회' : 'full CI once'));
      assert(strategy.includes('ECONNREFUSED') && strategy.includes('source/diff'));
    }
  });
  check('offline update check and quiet hook exit successfully', () => {
    fs.mkdirSync(path.join(root, '.leerness'), { recursive: true });
    fs.writeFileSync(path.join(root, '.leerness/HARNESS_VERSION'), require('../package.json').version);
    const r = run(['update', '--check', '--json']);
    assert.equal(r.status, 0); assert.equal(JSON.parse(r.stdout).verdict, 'unknown');
    const q = run(['update', '--check', '--quiet']);
    assert.equal(q.status, 0); assert.equal(q.stdout, ''); assert.equal(q.stderr, '');
  });
} finally {
  // Only the exact fresh fixture owned by this process is removed.
  assert(path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('leerness hooks '));
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed || passed === 0) { console.error('AUTO_UPDATE_HOOKS_FAILED'); process.exitCode = 1; }
