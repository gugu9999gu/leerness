#!/usr/bin/env node
'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit

// T-0193: actual CLI fault injection for memory-domain partial-write recovery.
// A receipt is evidence/recovery material, not an automatic rollback claim.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const crypto = require('crypto');
const { _renderDecisionsMd, _renderLessonsMd } = require('../lib/pure-utils');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin/leerness.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-memory-recovery-receipt-'));
const seed = path.join(temp, 'seed');
const hook = path.join(temp, 'fault-hook.cjs');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC)$/i.test(key)));
for (const key of ['TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
  env[key] = path.join(temp, key.toLowerCase());
  fs.mkdirSync(env[key], { recursive: true });
}
Object.assign(env, { LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_BANNER: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1' });

fs.writeFileSync(hook, String.raw`'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const cfg = JSON.parse(process.env.LEERNESS_RECOVERY_FAULT || '{}');
const target = cfg.target ? path.resolve(cfg.target).toLowerCase() : null;
const originalRename = fs.renameSync.bind(fs);
const originalSpawn = cp.spawnSync.bind(cp);
let fired = false;
function targetMatches(value) {
  return !fired && target && value && path.resolve(value).toLowerCase() === target;
}
fs.renameSync = function(from, to) {
  if (targetMatches(to) && /\.tmp-\d+-\d+$/.test(String(from))) {
    fired = true;
    const error = new Error('owned fixture injected rename failure');
    error.code = cfg.code || 'EIO';
    throw error;
  }
  return originalRename(from, to);
};
// T-0343: POSIX replaces an existing file by renaming it away and installing the prepared bytes with an exclusive
//   hard link (lib/memory-output.js publishPosix); a missing file is installed the same way. The rename and
//   ReplaceFileW hooks above and below are the Windows paths, so on Linux no fault ever fired and every case ran
//   to success. Fail the link that installs the target instead.
const originalLink = fs.linkSync.bind(fs);
fs.linkSync = function(existing, newPath) {
  if (targetMatches(newPath)) {
    fired = true;
    const error = new Error('owned fixture injected link failure');
    error.code = cfg.code || 'EIO';
    throw error;
  }
  return originalLink(existing, newPath);
};
cp.spawnSync = function(command, args, options) {
  const env = options && options.env;
  if (env && targetMatches(env.LEERNESS_REPLACE_TO)) {
    fired = true;
    const error = new Error('owned fixture injected ReplaceFileW launch failure');
    error.code = cfg.code || 'EIO';
    return { pid: 0, output: [], stdout: '', stderr: '', status: null, signal: null, error };
  }
  return originalSpawn(command, args, options);
};
`);

const results = [];
let sequence = 0;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function check(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
function run(project, args, faultTarget = null) {
  const prefix = faultTarget ? ['--require', hook] : [];
  const childEnv = { ...env };
  if (faultTarget) childEnv.LEERNESS_RECOVERY_FAULT = JSON.stringify({ target: faultTarget, code: 'EIO' });
  const r = cp.spawnSync(process.execPath, [...prefix, cli, ...args, '--path', project, '--json'], {
    cwd: project, env: childEnv, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.strictEqual(r.error, undefined, r.error && r.error.message);
  assert.strictEqual(r.signal, null);
  return r;
}
function success(r) { assert.strictEqual(r.status, 0, String(r.stdout || r.stderr).slice(-1200)); }
function entry(surface, value) {
  return surface === 'decisions'
    ? { date: '2026-09-11', title: value, decision: value, reason: 'reason', alternatives: null, impact: null }
    : { date: '2026-09-11', text: value, tag: 'tag' };
}
function render(surface, entries) { return surface === 'decisions' ? _renderDecisionsMd(entries) : _renderLessonsMd(entries); }
function fixture(surface) {
  const project = path.join(temp, `case-${++sequence}`);
  require('../lib/copy-tree').copyTreeSync(seed, project);
  const hd = path.join(project, '.leerness');
  const json = path.join(hd, `${surface}.json`);
  const md = path.join(hd, `${surface}.md`);
  const archive = path.join(hd, `${surface}.archive.md`);
  const base = entry(surface, 'base');
  fs.writeFileSync(json, JSON.stringify([base], null, 2) + '\n');
  fs.writeFileSync(md, render(surface, [base]));
  try { fs.unlinkSync(archive); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { project, hd, json, md, archive, base };
}
function archiveText(surface, value) {
  return surface === 'decisions'
    ? `# Decisions archive\n\n## 제거 2026-09-11 (target: "restore-me")\n\n### 2026-09-10 — ${value}\n- Decision: ${value}\n- Reason: archived\n- Alternatives:\n- Impact:\n\n`
    : `# Lessons archive\n\n## 제거 2026-09-11 (target: "restore-me")\n\n### 2026-09-10\n- Lesson: ${value}\n- Tag: archived\n\n`;
}
function addArgs(surface, value) { return surface === 'decisions' ? ['decision', 'add', value] : ['lesson', 'save', value]; }
function dropArgs(surface, value) { return surface === 'decisions' ? ['decision', 'drop', value] : ['lesson', 'drop', value]; }
function parseFailure(r) {
  assert(r.status > 0, `expected failure, exit=${r.status}`);
  const payload = JSON.parse(r.stdout);
  assert.strictEqual(payload.code, 'memory_partial_write');
  assert.strictEqual(payload.causeCode, 'EIO');
  assert(payload.recoveryReceipt, 'missing recoveryReceipt');
  return payload;
}
function readReceipt(project, payload) {
  const receiptPath = path.join(project, ...payload.recoveryReceipt.split('/'));
  assert(fs.existsSync(receiptPath), `receipt missing: ${receiptPath}`);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.strictEqual(receipt.automaticRollback, false);
  return { receiptPath, receipt };
}
function artifactBytes(receiptPath, name) {
  return fs.readFileSync(path.join(path.dirname(receiptPath), name));
}
function fileRecord(receipt, phase, role) {
  const record = receipt[phase].find(item => item.role === role);
  assert(record, `${phase}/${role} missing`);
  return record;
}

try {
  fs.mkdirSync(seed);
  success(run(seed, ['init', seed, '--yes', '--language', 'en', '--no-stale-check']));

  for (const surface of ['decisions', 'lessons']) {
    check(`${surface} projection failure keeps exact before/live recovery receipt`, () => {
      const f = fixture(surface);
      const beforeJson = fs.readFileSync(f.json), beforeMd = fs.readFileSync(f.md);
      const r = run(f.project, addArgs(surface, 'fresh'), f.md);
      const payload = parseFailure(r);
      const { receiptPath, receipt } = readReceipt(f.project, payload);
      assert.strictEqual(receipt.surface, surface);
      assert.strictEqual(receipt.operation, 'update');
      assert.strictEqual(receipt.stage, 'projection-write');
      assert.deepStrictEqual(receipt.completed, ['canonical-write']);
      const bj = fileRecord(receipt, 'before', 'canonical');
      const bm = fileRecord(receipt, 'before', 'projection');
      assert(artifactBytes(receiptPath, bj.artifact).equals(beforeJson));
      assert(artifactBytes(receiptPath, bm.artifact).equals(beforeMd));
      const live = JSON.parse(fs.readFileSync(f.json, 'utf8'));
      assert.deepStrictEqual(live.map(v => v.title || v.text), ['base', 'fresh']);
      assert(fs.readFileSync(f.md).equals(beforeMd), 'projection changed despite injected failure');
      assert.strictEqual(fileRecord(receipt, 'live', 'canonical').sha256, sha(fs.readFileSync(f.json)));
    });

    check(`${surface} drop canonical failure records archive-first partial state`, () => {
      const f = fixture(surface);
      const beforeJson = fs.readFileSync(f.json), beforeMd = fs.readFileSync(f.md);
      const r = run(f.project, dropArgs(surface, 'base'), f.json);
      const payload = parseFailure(r);
      const { receiptPath, receipt } = readReceipt(f.project, payload);
      assert.strictEqual(receipt.operation, 'drop');
      assert.strictEqual(receipt.stage, 'canonical-write');
      assert.deepStrictEqual(receipt.completed, ['archive-append']);
      assert(fs.readFileSync(f.json).equals(beforeJson));
      assert(fs.readFileSync(f.md).equals(beforeMd));
      assert(fs.readFileSync(f.archive, 'utf8').includes('base'), 'drop archive append missing');
      const beforeArchive = fileRecord(receipt, 'before', 'archive');
      assert.strictEqual(beforeArchive.exists, false);
      const liveArchive = fileRecord(receipt, 'live', 'archive');
      assert.strictEqual(liveArchive.exists, true);
      assert.strictEqual(liveArchive.sha256, sha(fs.readFileSync(f.archive)));
      const bj = fileRecord(receipt, 'before', 'canonical');
      assert(artifactBytes(receiptPath, bj.artifact).equals(beforeJson));
    });

    check(`${surface} restore active projection failure receipt includes untouched archive`, () => {
      const f = fixture(surface);
      fs.writeFileSync(f.archive, archiveText(surface, 'restored'));
      const beforeJson = fs.readFileSync(f.json), beforeMd = fs.readFileSync(f.md), beforeArchive = fs.readFileSync(f.archive);
      const r = run(f.project, ['memory', 'restore', surface, 'restore-me'], f.md);
      const payload = parseFailure(r);
      const { receiptPath, receipt } = readReceipt(f.project, payload);
      assert.strictEqual(receipt.operation, 'restore-active');
      assert.strictEqual(receipt.stage, 'projection-write');
      assert.deepStrictEqual(receipt.completed, ['canonical-write']);
      const live = JSON.parse(fs.readFileSync(f.json, 'utf8'));
      assert.deepStrictEqual(live.map(v => v.title || v.text), ['base', 'restored']);
      assert(fs.readFileSync(f.md).equals(beforeMd), 'projection changed despite injected active failure');
      assert(fs.readFileSync(f.archive).equals(beforeArchive), 'archive changed during active failure');
      for (const [role, bytes] of [['canonical', beforeJson], ['projection', beforeMd], ['archive', beforeArchive]]) {
        const rec = fileRecord(receipt, 'before', role);
        assert(artifactBytes(receiptPath, rec.artifact).equals(bytes), `before ${role} artifact mismatch`);
      }
    });

    check(`${surface} restore archive rewrite failure records active-publication partial state`, () => {
      const f = fixture(surface);
      fs.writeFileSync(f.archive, archiveText(surface, 'restored'));
      const beforeJson = fs.readFileSync(f.json), beforeMd = fs.readFileSync(f.md), beforeArchive = fs.readFileSync(f.archive);
      const r = run(f.project, ['memory', 'restore', surface, 'restore-me'], f.archive);
      const payload = parseFailure(r);
      const { receiptPath, receipt } = readReceipt(f.project, payload);
      assert.strictEqual(receipt.operation, 'restore');
      assert.strictEqual(receipt.stage, 'archive-rewrite');
      assert.deepStrictEqual(receipt.completed, ['active-publication']);
      const live = JSON.parse(fs.readFileSync(f.json, 'utf8'));
      assert.deepStrictEqual(live.map(v => v.title || v.text), ['base', 'restored']);
      assert(!fs.readFileSync(f.md).equals(beforeMd), 'active projection was not published');
      assert(fs.readFileSync(f.archive).equals(beforeArchive), 'archive changed despite injected rewrite failure');
      for (const [role, bytes] of [['canonical', beforeJson], ['projection', beforeMd], ['archive', beforeArchive]]) {
        const rec = fileRecord(receipt, 'before', role);
        assert(artifactBytes(receiptPath, rec.artifact).equals(bytes), `before ${role} artifact mismatch`);
      }
    });

    check(`${surface} successful update creates no recovery receipt`, () => {
      const f = fixture(surface);
      success(run(f.project, addArgs(surface, 'fresh')));
      const recovery = path.join(f.hd, 'archive', 'mutation-recovery');
      assert(!fs.existsSync(recovery), 'success path created recovery directory');
    });
  }
} catch (error) {
  results.push({ name: 'setup', ok: false, error: error.message });
  console.error(error.stack || error.message);
}

const passed = results.filter(r => r.ok).length;
fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify({ node: process.version, platform: process.platform, temp, passed, total: results.length, results }, null, 2) + '\n');
console.log(`memory recovery receipt: ${passed}/${results.length}; Evidence: ${temp}`);
if (passed !== results.length || results.length !== 10) process.exitCode = 1;
