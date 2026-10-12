'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
// T-0343: the native real path, as the product resolves memory parents (lib/memory-parent.js). fs.realpathSync keeps an
// 8.3 short name such as GitHub's C:\Users\RUNNER~1\..., and hooks that compare a renamed path by text then never fire.
const arena = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-ml02-'));
const entry = path.resolve(__dirname, '../bin/leerness.js');
const PRIVATE = 'SYNTHETIC_PRIVATE_ML02';
let count = 0, failed = 0, sequence = 0;
function test(name, fn) {
  count++;
  try { fn(); console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + '\n' + error.stack); }
}
function project(files = {}, workspace = '.leerness') {
  const root = path.join(arena, 'project-' + sequence++);
  fs.mkdirSync(path.join(root, workspace), { recursive: true });
  for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(root, workspace, name), data);
  return root;
}
function snapshot(root) {
  const result = {};
  function visit(file, relative) {
    const st = fs.lstatSync(file, { bigint: true });
    result[relative] = { mtime: String(st.mtimeNs), mode: String(st.mode), ino: String(st.ino),
      hash: st.isFile() ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null,
      link: st.isSymbolicLink() ? fs.readlinkSync(file) : null };
    if (st.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name), relative + '/' + name);
  }
  visit(root, '.'); return result;
}
function command(cwd, args, input = '', prefix = []) {
  const result = cp.spawnSync(process.execPath, [...prefix, entry, ...args], {
    cwd, input, encoding: 'utf8', timeout: 25000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, LEERNESS_NO_AUTOCHCP: '1' }
  });
  assert.equal(result.error, undefined, result.error?.message); assert.equal(result.signal, null);
  return result;
}
function privateMetadata(result) {
  const text = JSON.stringify(result);
  assert(!text.includes(PRIVATE)); assert(!text.includes(arena)); assert(Buffer.byteLength(text) < 16384);
  assert.equal(result.writesPerformed, false); assert.equal(result.approvalGranted, false);
  assert.equal(result.atomicObservation, false);
  if (result.assessment) {
    assert.equal(result.assessment.sourceTrust, 'caller-supplied');
    assert.equal(result.assessment.sourceVerified, false); assert.equal(result.assessment.semanticCoverage, 'unknown');
  }
}
const legacy = surface => surface === 'decisions'
  ? `# Personal notes\n### 2026-09-12 — Example\n- Decision: ${PRIVATE}\n- Reason: test\n`
  : `# Personal notes\n### 2026-09-12\n- Lesson: ${PRIVATE}\n- Tag: fixture\n`;
// T-0354: a run with no failures removes its arena; nothing did before, and every run of a memory probe left one in
// the temp directory (1,206 were found). A failed run keeps it for inspection. Links inside the arena are removed
// first, as links, so the removal never walks into a link's target, wherever that points. The arena itself must
// still be the folder made above (same file identity, not a link): a test that renamed it away and put a link in its
// place would otherwise have the walk run inside the link's target (review round 1).
const arenaIdentity = fs.lstatSync(arena, { bigint: true });
function sameArena() {
  const st = fs.lstatSync(arena, { bigint: true });
  return !st.isSymbolicLink() && st.isDirectory() && st.dev === arenaIdentity.dev && st.ino === arenaIdentity.ino;
}
// Review round 2: a folder can also be replaced by a link after its lstat, and the arena right after sameArena().
// So each folder must still resolve inside the arena just before it is listed and before a link in it is removed.
// finish() runs after the tests, so nothing else changes the arena then; a process that kept swapping folders
// during finish() could still race these checks.
const arenaReal = fs.realpathSync.native(arena);
const replaced = () => Object.assign(new Error('the arena was replaced'), { code: 'E_ARENA_REPLACED' });
function resolvesInArena(dir) {
  const relative = path.relative(arenaReal, fs.realpathSync.native(dir));
  return !(relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative));
}
function removeLinks(dir) {
  if (!resolvesInArena(dir)) throw replaced();
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name), st = fs.lstatSync(file);
    if (st.isSymbolicLink()) {
      if (!resolvesInArena(dir)) throw replaced();
      try { fs.unlinkSync(file); } catch { fs.rmdirSync(file); }
    } else if (st.isDirectory()) removeLinks(file);
  }
}
function finish(label) {
  let kept = '';
  if (failed) { process.exitCode = 1; kept = ' (kept)'; }
  else {
    try {
      if (!sameArena()) throw replaced();
      removeLinks(arena); require('./temp-cleanup').removeTree(arena, { recursive: true, force: true }); kept = ' (removed)';
    }
    catch (error) { kept = ` (not removed: ${error.code || error.message})`; }
  }
  console.log(`${label}: ${count - failed}/${count} passed; fixtures: ${arena}${kept}`);
}
module.exports = { assert, fs, path, cp, arena, entry, PRIVATE, test, project, snapshot, command, privateMetadata, legacy, finish };
