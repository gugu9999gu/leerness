#!/usr/bin/env node
'use strict';

// 기존 JSON 구문 검사의 실행 순서만 검증한다. 완전한 schema/트랜잭션 검사가 아니다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const crypto = require('crypto');

const cli = path.join(__dirname, '..', 'bin', 'leerness.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-memory-guard-order-'));
const seed = path.join(temp, 'seed');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)));
Object.assign(env, { LEERNESS_INTERNAL: '1', LEERNESS_NO_BANNER: '1',
  LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_OFFLINE: '1' });
const results = [];
const run = (root, args) => cp.spawnSync(process.execPath, [cli, ...args, '--path', root, '--json'], {
  cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024,
});
const requireSuccess = result => assert.strictEqual(result.status, 0,
  `exit=${result.status} signal=${result.signal} error=${result.error?.code} ${(result.stderr || '').slice(-600)}`);
const snapshot = root => Object.fromEntries([
  'decisions.json', 'decisions.md', 'decisions.archive.md', 'lessons.json',
  'lessons.md', 'lessons.archive.md', 'task-log.md', 'review-evidence.md',
  'progress-tracker.md', 'current-state.md', 'session-handoff.md',
].map(name => {
  const file = path.join(root, '.leerness', name);
  if (!fs.existsSync(file)) return [name, null];
  return [name, { hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    mtime: fs.statSync(file).mtimeMs }];
}));
let sequence = 0;
const fixture = () => {
  const root = path.join(temp, `case-${++sequence}`);
  fs.cpSync(seed, root, { recursive: true });
  return root;
};
const check = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); process.stdout.write(`PASS ${name}\n`); }
  catch (error) { results.push({ name, ok: false, error: error.message }); process.stderr.write(`FAIL ${name}: ${error.message}\n`); }
};
const canonical = (root, surface) => path.join(root, '.leerness', `${surface}.json`);
const items = (root, surface) => JSON.parse(fs.readFileSync(canonical(root, surface), 'utf8'));

try {
  fs.mkdirSync(seed);
  requireSuccess(run(seed, ['init', seed, '--yes', '--language', 'en', '--no-stale-check']));
  requireSuccess(run(seed, ['decision', 'add', 'active']));
  requireSuccess(run(seed, ['lesson', 'save', 'active']));
  for (const surface of ['decisions', 'lessons']) {
    const body = surface === 'decisions'
      ? '### 2026-01-01 — archived\n- Decision: archived\n- Reason: retained\n'
      : '### 2026-01-01\n- Lesson: archived\n- Tag: retained\n';
    fs.writeFileSync(path.join(seed, '.leerness', `${surface}.archive.md`),
      `# Archive\n\n## 제거 2026-01-02 (target: "archived")\n\n${body}`);
    const singular = surface === 'decisions' ? 'decision' : 'lesson';
    const add = surface === 'decisions' ? 'add' : 'save';
    const variants = [
      ['new', [singular, add, 'new']], ['duplicate', [singular, add, 'active']],
      ['force', [singular, add, 'active', '--force']], ['drop', [singular, 'drop', 'active']],
      ['drop-unmatched', [singular, 'drop', 'unmatched']],
      ['restore', ['memory', 'restore', surface, 'archived']],
      ['restore-force', ['memory', 'restore', singular, 'archived', '--force']],
      ['restore-unmatched', ['memory', 'restore', surface, 'unmatched']],
    ];
    for (const broken of ['{', '']) for (const [name, args] of variants) {
      check(`${surface} ${broken ? 'malformed' : 'blank'} ${name}: reject before domain writes`, () => {
        const root = fixture();
        fs.writeFileSync(canonical(root, surface), broken);
        const before = snapshot(root);
        const result = run(root, args);
        assert.strictEqual(result.status, 1);
        assert.strictEqual(JSON.parse(result.stdout).code, 'store_corrupt');
        assert.strictEqual(result.stderr, '');
        assert.deepStrictEqual(snapshot(root), before);
      });
    }
    check(`${surface} read fallback stays available`, () => {
      const root = fixture();
      fs.writeFileSync(canonical(root, surface), '{');
      const before = snapshot(root);
      const result = run(root, [singular, 'list']);
      requireSuccess(result);
      assert.strictEqual(JSON.parse(result.stdout).total, 1);
      assert.deepStrictEqual(snapshot(root), before);
    });
    check(`${surface} valid add preserves canonical unknown fields`, () => {
      const root = fixture();
      const original = items(root, surface);
      original[0].extension = { owner: 'test', values: [1, 2] };
      fs.writeFileSync(canonical(root, surface), JSON.stringify(original));
      requireSuccess(run(root, [singular, add, 'new']));
      const after = items(root, surface);
      assert.strictEqual(after.length, 2);
      assert.deepStrictEqual(after[0], original[0]);
    });
    check(`${surface} valid duplicate keeps domain snapshot`, () => {
      const root = fixture();
      const before = snapshot(root);
      const result = run(root, [singular, add, 'active']);
      requireSuccess(result);
      assert.strictEqual(JSON.parse(result.stdout).skipped, true);
      assert.deepStrictEqual(snapshot(root), before);
    });
    check(`${surface} valid force retains duplicate semantics`, () => {
      const root = fixture();
      requireSuccess(run(root, [singular, add, 'active', '--force']));
      assert.strictEqual(items(root, surface).length, 2);
    });
    check(`${surface} positive drop and restore`, () => {
      const root = fixture();
      requireSuccess(run(root, [singular, 'drop', 'active']));
      assert.strictEqual(items(root, surface).length, 0);
      requireSuccess(run(root, ['memory', 'restore', surface, 'active']));
      assert.strictEqual(items(root, surface).length, 1);
      assert.strictEqual(items(root, surface)[0][surface === 'decisions' ? 'title' : 'text'], 'active');
    });
    check(`${surface} missing canonical retains legacy fallback`, () => {
      const root = fixture();
      fs.unlinkSync(canonical(root, surface)); // 테스트 소유 단일 fixture 파일만 제거.
      requireSuccess(run(root, [singular, add, 'new']));
      assert.strictEqual(items(root, surface).length, 2);
    });
  }
} catch (error) {
  results.push({ name: 'setup', ok: false, error: error.message });
  process.stderr.write(`FAIL setup: ${error.message}\n`);
}
const passed = results.filter(r => r.ok).length;
fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify({ temp, node: process.version, results }, null, 2));
process.stdout.write(`memory guard order: ${passed}/${results.length} passed\nEvidence: ${temp}\n`);
if (passed !== results.length || results.length !== 44) process.exitCode = 1;
