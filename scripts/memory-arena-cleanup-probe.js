'use strict';
require('./temp-cleanup').trackTemp(module);  
 
 
 
 
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
 
const elsewhere = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-arena-cleanup-elsewhere-'));
fs.writeFileSync(path.join(elsewhere, 'keep.txt'), 'kept');
fs.symlinkSync(outside, path.join(elsewhere, 'keep-link'), linkType);
 
 
 
 
 
const child = (shouldFail, replace = '') => cp.spawnSync(process.execPath, ['-e', `
  const S = require(${JSON.stringify(support)});
  const fs = require('fs'), path = require('path');
  const type = ${JSON.stringify(linkType)}, elsewhere = ${JSON.stringify(elsewhere)}, replace = ${JSON.stringify(replace)};
  const swap = dir => { fs.renameSync(dir, dir + '-aside'); fs.symlinkSync(elsewhere, dir, type); };
  fs.mkdirSync(path.join(S.arena, 'nested'));
  fs.symlinkSync(${JSON.stringify(outside)}, path.join(S.arena, 'nested', 'link-out'), type);
  if (replace === 'arena-before') swap(S.arena);
  if (replace === 'nested-before') swap(path.join(S.arena, 'nested'));
  S.test('child test', () => { if (${shouldFail}) throw new Error('planned failure'); });
  const saved = Object.fromEntries(['unlinkSync', 'rmdirSync', 'rmSync'].map(k => [k, fs[k]]));
  let calls = 0;
  for (const [name, native] of Object.entries(saved)) fs[name] = function (...args) {
    calls++;
    if (replace === 'native-boundary') swap(path.join(S.arena, 'nested'));
    return native.apply(this, args);
  };
  S.finish('arena cleanup child');
  for (const [name, native] of Object.entries(saved)) fs[name] = native;
  if (calls !== 0) throw new Error('automatic cleanup reached ' + calls + ' destructive calls');
  console.log('ARENA ' + S.arena);
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
  test('a passing run retains its arena, link names and external target without deleting', () => {
    const r = child(false);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(fs.existsSync(arenaOf(r)), true, 'the arena must be retained');
    assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), 'kept', 'the link target must be untouched');
    assert.match(r.stdout, /arena cleanup child: 1\/1 passed; fixtures: .*\(retained: automatic-cleanup-disabled\)/);
    unlinkLink(path.join(arenaOf(r), 'nested', 'link-out'));
    fs.rmSync(arenaOf(r), { recursive: true, force: true });
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
    ['native-boundary', 'an armed native deletion replacement'],
    ['nested-before', 'a nested folder replaced by a link before finish()']]) {
    test(`${what} is not walked, and nothing behind the link is removed`, () => {
       
      try { fs.lstatSync(path.join(elsewhere, 'keep-link')); } catch { fs.symlinkSync(outside, path.join(elsewhere, 'keep-link'), linkType); }
      fs.writeFileSync(path.join(elsewhere, 'keep.txt'), 'kept');
      const r = child(false, replace);
      assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      const arena = arenaOf(r);
      outsideIntact();
      assert.match(r.stdout, /arena cleanup child: 1\/1 passed; fixtures: .*\(retained: automatic-cleanup-disabled\)/);
      if (replace === 'native-boundary') {
        unlinkLink(path.join(arena, 'nested', 'link-out'));
        fs.rmSync(arena, { recursive: true, force: true });
      } else {
        const nested = replace === 'nested-before';
        unlinkLink(nested ? path.join(arena, 'nested') : arena);
        unlinkLink(path.join(nested ? path.join(arena, 'nested-aside') : path.join(arena + '-aside', 'nested'), 'link-out'));
        fs.rmSync(nested ? arena : arena + '-aside', { recursive: true, force: true });
      }
    });
  }
} finally {
  try { unlinkLink(path.join(elsewhere, 'keep-link')); } catch {}
  fs.rmSync(elsewhere, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
}
console.log(`memory arena cleanup probe: ${passed}/${passed + failed} passed (${process.platform})`);
process.exitCode = failed ? 1 : 0;
