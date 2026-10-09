#!/usr/bin/env node
'use strict';

// T-0193: actual CLI final-publication race probe.
// The preload hook simulates a non-cooperating writer at the last pathname
// publication primitive (rename/link/ReplaceFileW). Desired behavior is never a
// silent success that discards the injected bytes.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const { _renderDecisionsMd, _renderLessonsMd } = require('../lib/pure-utils');

const root = path.resolve(__dirname, '..');
const cli = path.join(root, 'bin/leerness.js');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-memory-output-publication-'));
const seed = path.join(temp, 'seed');
const hook = path.join(temp, 'publication-race-hook.cjs');
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC)$/i.test(key)));
for (const key of ['TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
  baseEnv[key] = path.join(temp, key.toLowerCase());
  fs.mkdirSync(baseEnv[key], { recursive: true });
}
Object.assign(baseEnv, {
  LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_BANNER: '1',
  LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1',
});

fs.writeFileSync(hook, String.raw`'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const cfg = JSON.parse(process.env.LEERNESS_PUBLICATION_RACE || '{}');
const target = cfg.target ? path.resolve(cfg.target).toLowerCase() : null;
const ancestor = cfg.ancestor ? path.resolve(cfg.ancestor) : null;
const competitor = cfg.competitorBase64 ? Buffer.from(cfg.competitorBase64, 'base64') : Buffer.from('external-writer\n');
const originalRename = fs.renameSync.bind(fs);
const originalLink = fs.linkSync.bind(fs);
const originalSymlink = fs.symlinkSync.bind(fs);
const originalWrite = fs.writeFileSync.bind(fs);
const originalSpawn = cp.spawnSync.bind(cp);
let fired = false;
function matches(candidate) {
  return !!target && !!candidate && path.resolve(candidate).toLowerCase() === target;
}
function inject(candidate) {
  if (fired || !matches(candidate)) return false;
  fired = true;
  originalWrite(candidate, competitor);
  return true;
}
function reboundAncestor(candidate) {
  if (fired || !ancestor || !matches(candidate)) return false;
  fired = true;
  const displaced = ancestor + '-displaced';
  originalRename(ancestor, displaced);
  originalSymlink(displaced, ancestor, process.platform === 'win32' ? 'junction' : 'dir');
  return true;
}
fs.renameSync = function(from, to) {
  if (/\.tmp-\d+-\d+$/.test(String(from))) inject(to);
  return originalRename(from, to);
};
fs.linkSync = function(from, to) {
  if (!reboundAncestor(to)) inject(to);
  return originalLink(from, to);
};
cp.spawnSync = function(command, args, options) {
  const env = options && options.env;
  if (!ancestor && env && env.LEERNESS_REPLACE_TO) inject(env.LEERNESS_REPLACE_TO);
  return originalSpawn(command, args, options);
};
`);

let sequence = 0;
const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
function run(project, args, fault = null) {
  const env = { ...baseEnv };
  const prefix = fault ? ['--require', hook] : [];
  if (fault) env.LEERNESS_PUBLICATION_RACE = JSON.stringify({
    target: fault.target,
    ancestor: fault.ancestor || null,
    competitorBase64: fault.bytes == null ? null : Buffer.from(fault.bytes).toString('base64'),
  });
  const r = cp.spawnSync(process.execPath, [...prefix, cli, ...args, '--path', project, '--json'], {
    cwd: fault && fault.cwdOutside ? temp : project, env, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.strictEqual(r.error, undefined, r.error && r.error.message);
  assert.strictEqual(r.signal, null);
  return r;
}
function success(r) { assert.strictEqual(r.status, 0, String(r.stdout || r.stderr).slice(-1600)); }
function jsonFailure(r) {
  assert(r.status > 0, `expected failure; exit=${r.status}; stdout=${String(r.stdout).slice(-1200)}`);
  return JSON.parse(r.stdout);
}
function entry(surface, value) {
  return surface === 'decisions'
    ? { date: '2026-09-11', title: value, decision: value, reason: 'reason', alternatives: null, impact: null }
    : { date: '2026-09-11', text: value, tag: 'tag' };
}
function render(surface, entries) { return surface === 'decisions' ? _renderDecisionsMd(entries) : _renderLessonsMd(entries); }
function fixture(surface, options = {}) {
  const project = path.join(temp, `case-${++sequence}`);
  fs.cpSync(seed, project, { recursive: true });
  const hd = path.join(project, '.leerness');
  const json = path.join(hd, `${surface}.json`);
  const md = path.join(hd, `${surface}.md`);
  const archive = path.join(hd, `${surface}.archive.md`);
  const base = entry(surface, 'base');
  fs.writeFileSync(json, JSON.stringify([base], null, 2) + '\n');
  fs.writeFileSync(md, render(surface, [base]));
  try { fs.unlinkSync(archive); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (options.missingCanonical) fs.unlinkSync(json);
  if (options.missingProjection) fs.unlinkSync(md);
  return { project, hd, json, md, archive, base };
}
function addArgs(surface) { return surface === 'decisions' ? ['decision', 'add', 'fresh'] : ['lesson', 'save', 'fresh']; }
function externalCanonical(surface) {
  const e = entry(surface, 'external-writer');
  return Buffer.from(JSON.stringify([e], null, 2) + '\n');
}
function externalProjection(surface) {
  return Buffer.from(`# external-${surface}-writer\nmanual final-window content\n`);
}
function restoreArchive(surface) {
  return surface === 'decisions'
    ? '# Decisions archive\n\n## 제거 2026-09-11 (target: "restore-me")\n### 2026-09-10 — restored\n- Decision: restored\n- Reason: archived\n- Alternatives:\n- Impact:\n\n'
    : '# Lessons archive\n\n## 제거 2026-09-11 (target: "restore-me")\n### 2026-09-10\n- Lesson: restored\n- Tag: archived\n\n';
}
function externalArchive(surface) {
  return Buffer.from(restoreArchive(surface) + '\n## external concurrent archive block\nexternal writer bytes\n');
}
function recoveryFiles(project) {
  const recovery = path.join(project, '.leerness', 'archive', 'mutation-recovery');
  if (!fs.existsSync(recovery)) return [];
  return fs.readdirSync(recovery).map(name => path.join(recovery, name));
}
function artifactContains(project, payload, expected) {
  const candidates = [];
  if (payload && payload.recoveryReceipt) {
    const receipt = path.join(project, ...payload.recoveryReceipt.split('/'));
    if (fs.existsSync(receipt)) {
      const dir = path.dirname(receipt);
      for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        if (fs.statSync(file).isFile()) candidates.push(file);
      }
    }
  }
  for (const top of recoveryFiles(project)) {
    if (!fs.existsSync(top)) continue;
    const stat = fs.statSync(top);
    if (stat.isFile()) candidates.push(top);
    else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(top)) {
        const file = path.join(top, name);
        try { if (fs.statSync(file).isFile()) candidates.push(file); } catch {}
      }
    }
  }
  return candidates.some(file => {
    try { return fs.readFileSync(file).equals(expected); } catch { return false; }
  });
}
function assertNotSilentLoss(r, project, target, competitor) {
  const liveEquals = fs.existsSync(target) && fs.readFileSync(target).equals(competitor);
  if (r.status === 0) {
    assert(liveEquals, 'command reported success after discarding final-window external bytes');
    return;
  }
  const payload = jsonFailure(r);
  const recoverable = liveEquals || artifactContains(project, payload, competitor);
  assert(recoverable, `external bytes are neither live nor recoverable; code=${payload.code}`);
  assert(['output_changed', 'memory_partial_write', 'store_changed'].includes(payload.code), `unexpected conflict code: ${payload.code}`);
  // On Windows ReplaceFileW can atomically publish our planned bytes while the
  // competing pathname object becomes the displaced backup. When that happens,
  // the durable memory receipt itself must copy/reference those competitor bytes;
  // passing merely because an internal scratch directory still exists is not enough.
  if (!liveEquals && payload.recoveryReceipt) {
    const receiptPath = path.join(project, ...payload.recoveryReceipt.split('/'));
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    assert(Array.isArray(receipt.causeArtifacts) && receipt.causeArtifacts.length > 0, 'receipt lacks causeArtifacts for displaced external bytes');
    assert(receipt.causeArtifacts.some(item => item.artifact && fs.readFileSync(path.join(path.dirname(receiptPath), item.artifact)).equals(competitor)),
      'receipt causeArtifacts do not preserve final-window external bytes');
  }
}

try {
  fs.mkdirSync(seed);
  success(run(seed, ['init', seed, '--yes', '--language', 'en', '--no-stale-check']));

  for (const surface of ['decisions', 'lessons']) {
    test(`${surface} existing canonical final-window writer is not silently discarded`, () => {
      const f = fixture(surface);
      const competitor = externalCanonical(surface);
      const r = run(f.project, addArgs(surface), { target: f.json, bytes: competitor });
      assertNotSilentLoss(r, f.project, f.json, competitor);
    });

    test(`${surface} absent canonical creation never overwrites a winner`, () => {
      const f = fixture(surface, { missingCanonical: true });
      const competitor = externalCanonical(surface);
      const r = run(f.project, addArgs(surface), { target: f.json, bytes: competitor });
      assertNotSilentLoss(r, f.project, f.json, competitor);
      assert(fs.readFileSync(f.json).equals(competitor), 'exclusive create did not leave the winning external canonical live');
    });

    test(`${surface} final-window ancestor resolution change becomes a recovery receipt`, () => {
      const f = fixture(surface, { missingCanonical: true });
      const r = run(f.project, addArgs(surface), { target: f.json, ancestor: f.hd, cwdOutside: true });
      const payload = jsonFailure(r);
      assert.strictEqual(fs.lstatSync(f.hd).isSymbolicLink(), true, `ancestor rebound did not occur; payload=${JSON.stringify(payload)}`);
      const displacedHd = `${f.hd}-displaced`;
      const displacedCanonical = path.join(displacedHd, `${surface}.json`);
      const mutationExists = fs.existsSync(f.json) || fs.existsSync(displacedCanonical);
      if (!mutationExists) {
        assert.strictEqual(payload.code, 'output_changed', `non-mutating ancestor race returned ${JSON.stringify(payload)}`);
        return;
      }
      assert.strictEqual(payload.code, 'memory_partial_write', `partial ancestor publication was mislabeled: live=${fs.existsSync(f.json)} displaced=${fs.existsSync(displacedCanonical)} payload=${JSON.stringify(payload)}`);
      assert(payload.recoveryReceipt, `missing recovery receipt: ${JSON.stringify(payload)}`);
      assert.strictEqual(payload.recoveryExternal, true, 'layout-changed recovery must not write through the rebound project path');
      const receiptPath = path.isAbsolute(payload.recoveryReceipt)
        ? payload.recoveryReceipt
        : path.join(f.project, ...payload.recoveryReceipt.split('/'));
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      assert.strictEqual(receipt.storage, 'external-temp');
      assert.strictEqual(receipt.stage, 'canonical-write');
      assert.deepStrictEqual(receipt.completed, []);
      assert.strictEqual(receipt.automaticRollback, false);
      assert(['E_OUTPUT_CHANGED', 'E_RUNTIME_LAYOUT_INCOMPATIBLE'].includes(receipt.cause.code), `unexpected recovery cause ${receipt.cause.code}`);
      const beforeCanonical = receipt.before.find(entry => entry.role === 'canonical');
      const liveCanonical = receipt.live.find(entry => entry.role === 'canonical');
      assert(beforeCanonical && beforeCanonical.exists === false, 'receipt lost the absent canonical before-state');
      assert(liveCanonical && liveCanonical.exists === true && liveCanonical.artifact, 'receipt lost the live partial canonical');
      const receiptDir = path.dirname(receiptPath);
      const actualCanonical = fs.existsSync(f.json) ? f.json : displacedCanonical;
      assert(fs.readFileSync(path.join(receiptDir, liveCanonical.artifact)).equals(fs.readFileSync(actualCanonical)), 'external receipt canonical bytes differ from live partial bytes');
      if (payload.recoveryExternal) fs.rmSync(receiptDir, { recursive: true, force: true });
    });

    test(`${surface} existing projection final-window writer is not silently discarded`, () => {
      const f = fixture(surface);
      const competitor = externalProjection(surface);
      const r = run(f.project, addArgs(surface), { target: f.md, bytes: competitor });
      assertNotSilentLoss(r, f.project, f.md, competitor);
    });

    test(`${surface} absent projection creation never overwrites a winner`, () => {
      const f = fixture(surface, { missingProjection: true });
      const competitor = externalProjection(surface);
      const r = run(f.project, addArgs(surface), { target: f.md, bytes: competitor });
      assertNotSilentLoss(r, f.project, f.md, competitor);
      assert(fs.readFileSync(f.md).equals(competitor), 'exclusive create did not leave the winning external projection live');
    });

    test(`${surface} restore archive final-window writer remains live or recoverable`, () => {
      const f = fixture(surface);
      fs.writeFileSync(f.archive, restoreArchive(surface));
      const competitor = externalArchive(surface);
      const r = run(f.project, ['memory', 'restore', surface, 'restore-me'], { target: f.archive, bytes: competitor });
      assertNotSilentLoss(r, f.project, f.archive, competitor);
    });

    test(`${surface} normal update leaves no publication scratch artifacts`, () => {
      const f = fixture(surface);
      success(run(f.project, addArgs(surface)));
      const recovery = recoveryFiles(f.project);
      const scratch = recovery.filter(file => /\.leerness-write-|memory-output|publish/i.test(path.basename(file)));
      assert.deepStrictEqual(scratch, [], `unexpected success scratch: ${scratch.join(', ')}`);
    });

    test(`${surface} dry-run remains zero-write and creates no recovery artifacts`, () => {
      const f = fixture(surface);
      const beforeJson = fs.readFileSync(f.json);
      const beforeMd = fs.readFileSync(f.md);
      const r = run(f.project, [...addArgs(surface), '--dry-run']);
      const payload = jsonFailure(r);
      assert.strictEqual(payload.code, 'dry_run_unsupported');
      assert(fs.readFileSync(f.json).equals(beforeJson), 'dry-run changed canonical');
      assert(fs.readFileSync(f.md).equals(beforeMd), 'dry-run changed projection');
      assert.deepStrictEqual(recoveryFiles(f.project), [], 'dry-run created recovery artifacts');
    });
  }
} catch (error) {
  results.push({ name: 'setup', ok: false, error: error.message });
  console.error(error.stack || error.message);
}

const passed = results.filter(result => result.ok).length;
fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify({
  node: process.version, platform: process.platform, temp, passed, total: results.length, results,
}, null, 2) + '\n');
console.log(`memory output publication: ${passed}/${results.length}; Evidence: ${temp}`);
if (passed !== results.length || results.length !== 16) process.exitCode = 1;
