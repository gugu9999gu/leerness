'use strict';
// T-0354: scripts/memory-migration-test-support.js removes its arena at finish() when every test passed, and keeps
// it when one failed. A link inside the arena that points outside it is removed as a link: its target and the files
// in it must survive. An arena, or a folder in it, that was replaced with a link is not walked, whether that happened
// before finish() or while it ran. Each case runs the support in a child process, the way the memory probes use it.
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const support = path.join(__dirname, 'memory-migration-test-support.js');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + (error && error.stack || error)); }
}
const linkType = process.platform === 'win32' ? 'junction' : 'dir';
const unlinkLink = link => { try { fs.unlinkSync(link); } catch { fs.rmdirSync(link); } };
const outside = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-arena-cleanup-outside-'));
const sentinel = path.join(outside, 'sentinel.txt');
fs.writeFileSync(sentinel, 'kept');
// A second outside folder with a link of its own, for the replacement cases.
const elsewhere = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-arena-cleanup-elsewhere-'));
fs.writeFileSync(path.join(elsewhere, 'keep.txt'), 'kept');
fs.symlinkSync(outside, path.join(elsewhere, 'keep-link'), linkType);
// The child links to `outside` from inside its arena, runs one test that passes or fails, calls finish(), and prints
// its arena path. `replace` renames a folder aside and puts a link to `elsewhere` in its place:
//   'arena-before'      the arena, before finish();
//   'arena-after-check' the arena, right after finish() checked its identity;
//   'nested-during'     the arena's `nested` folder, right after finish() saw it as a folder.
const child = (shouldFail, replace = '') => cp.spawnSync(process.execPath, ['-e', `
  const S = require(${JSON.stringify(support)});
  const fs = require('fs'), path = require('path');
  const type = ${JSON.stringify(linkType)}, elsewhere = ${JSON.stringify(elsewhere)}, replace = ${JSON.stringify(replace)};
  const swap = dir => { fs.renameSync(dir, dir + '-aside'); fs.symlinkSync(elsewhere, dir, type); };
  fs.mkdirSync(path.join(S.arena, 'nested'));
  fs.symlinkSync(${JSON.stringify(outside)}, path.join(S.arena, 'nested', 'link-out'), type);
  if (replace === 'arena-before') swap(S.arena);
  S.test('child test', () => { if (${shouldFail}) throw new Error('planned failure'); });
  const lstat = fs.lstatSync;
  let armed = replace === 'arena-after-check' || replace === 'nested-during';
  fs.lstatSync = function (file, ...rest) {
    const st = lstat.call(this, file, ...rest);
    if (armed && replace === 'arena-after-check' && file === S.arena && rest[0] && rest[0].bigint) { armed = false; swap(file); }
    if (armed && replace === 'nested-during' && file === path.join(S.arena, 'nested')) { armed = false; swap(file); }
    return st;
  };
  S.finish('arena cleanup child');
  fs.lstatSync = lstat;
  console.log('ARENA ' + S.arena + (armed ? ' (the replacement never happened)' : ''));
`], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
const arenaOf = r => {
  const line = r.stdout.split(/\r?\n/).find(l => l.startsWith('ARENA '));
  assert(line && !line.includes('never happened'), r.stdout + r.stderr);
  return line.slice(6);
};
const outsideIntact = () => {
  assert.strictEqual(fs.lstatSync(path.join(elsewhere, 'keep-link')).isSymbolicLink(), true, 'the link behind the replacement must be kept');
  assert.strictEqual(fs.readFileSync(path.join(elsewhere, 'keep.txt'), 'utf8'), 'kept');
  assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'kept');
};
try {
  test('a passing run removes its arena, and a link to a folder outside it leaves that folder alone', () => {
    const r = child(false);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(fs.existsSync(arenaOf(r)), false, 'the arena must be gone');
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'kept', 'the link target must be untouched');
    assert.match(r.stdout, /arena cleanup child: 1\/1 passed; fixtures: .*\(removed\)/);
  });
  test('a failing run keeps its arena for inspection', () => {
    const r = child(true);
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    const arena = arenaOf(r), link = path.join(arena, 'nested', 'link-out');
    assert.strictEqual(fs.existsSync(arena), true, 'the arena must be kept');
    assert.strictEqual(fs.lstatSync(link).isSymbolicLink(), true, 'its contents must be kept');
    assert.match(r.stdout, /arena cleanup child: 0\/1 passed; fixtures: .*\(kept\)/);
    unlinkLink(link);
    fs.rmSync(arena, { recursive: true, force: true });
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'kept');
  });
  for (const [replace, what] of [['arena-before', 'an arena replaced by a link before finish()'],
    ['arena-after-check', 'an arena replaced by a link right after its identity check'],
    ['nested-during', 'a folder in the arena replaced by a link while finish() walks the arena']]) {
    test(`${what} is not walked, and nothing behind the link is removed`, () => {
      // Each case starts with `elsewhere` whole, so one failure does not decide the next case.
      try { fs.lstatSync(path.join(elsewhere, 'keep-link')); } catch { fs.symlinkSync(outside, path.join(elsewhere, 'keep-link'), linkType); }
      fs.writeFileSync(path.join(elsewhere, 'keep.txt'), 'kept');
      const r = child(false, replace);
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      const arena = arenaOf(r);
      outsideIntact();
      assert.match(r.stdout, /arena cleanup child: 1\/1 passed; fixtures: .*\(not removed: E_ARENA_REPLACED\)/);
      const swapped = replace === 'nested-during' ? path.join(arena, 'nested') : arena;
      unlinkLink(swapped);
      unlinkLink(path.join(replace === 'nested-during' ? path.join(arena, 'nested-aside') : path.join(arena + '-aside', 'nested'), 'link-out'));
      fs.rmSync(replace === 'nested-during' ? arena : arena + '-aside', { recursive: true, force: true });
    });
  }
} finally {
  try { unlinkLink(path.join(elsewhere, 'keep-link')); } catch {}
  fs.rmSync(elsewhere, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
}
console.log(`memory arena cleanup probe: ${passed}/${passed + failed} passed (${process.platform})`);
process.exitCode = failed ? 1 : 0;
