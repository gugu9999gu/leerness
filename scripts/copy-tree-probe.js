'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
// T-0343: lib/copy-tree.js copyTreeSync, the fs.cpSync replacement used for fixture and selftest copies.
// It must copy nested directories and file bytes exactly, copy into an existing directory, never overwrite a file,
// and work with non-ASCII paths on every supported Node (fs.cpSync crashes on them in Node 22.23.3 on Windows).
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { copyTreeSync } = require('../lib/copy-tree');
const { removeTree } = require('./temp-cleanup');
const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-copy-tree-'));
let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + ': ' + (error && error.stack || error)); }
};
const tree = dir => {
  const out = {};
  const walk = (d, rel) => {
    for (const name of fs.readdirSync(d).sort()) {
      const full = path.join(d, name), key = rel ? rel + '/' + name : name;
      if (fs.lstatSync(full).isDirectory()) { out[key + '/'] = true; walk(full, key); }
      else out[key] = fs.readFileSync(full).toString('base64');
    }
  };
  walk(dir, '');
  return out;
};
const seed = name => {
  const dir = path.join(arena, name);
  fs.mkdirSync(path.join(dir, '.leerness', 'cache', '빈 폴더'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.leerness', 'plan.md'), '# 계획\r\n- 한글 ✓\n');
  fs.writeFileSync(path.join(dir, 'bytes.bin'), Buffer.from([0, 255, 0xef, 0xbb, 0xbf, 13, 10]));
  return dir;
};
try {
  for (const [label, src, dst] of [['ASCII paths', 'src-a', 'dst-a'], ['Korean source and destination', '원본 한글', '사본 한글']]) {
    test(`copies nested directories and exact bytes (${label})`, () => {
      const from = seed(src), to = path.join(arena, dst);
      copyTreeSync(from, to);
      assert.deepStrictEqual(tree(to), tree(from));
    });
  }
  test('copies into an existing directory, as fs.cpSync does', () => {
    const from = seed('src-existing'), to = fs.mkdtempSync(path.join(arena, 'into-'));
    copyTreeSync(from, to);
    assert.deepStrictEqual(tree(to), tree(from));
  });
  test('never overwrites an existing file', () => {
    const from = seed('src-no-overwrite'), to = path.join(arena, 'dst-no-overwrite');
    fs.mkdirSync(to);
    fs.writeFileSync(path.join(to, 'bytes.bin'), 'kept');
    assert.throws(() => copyTreeSync(from, to), error => error.code === 'EEXIST');
    assert.strictEqual(fs.readFileSync(path.join(to, 'bytes.bin'), 'utf8'), 'kept');
  });
  // T-0347: a relative directory link must still name its sibling inside the copy. On Windows the copy is a junction,
  // whose target must be absolute; Node resolved the relative one against the process cwd.
  {
    const from = path.join(arena, 'src-relative-link'), to = path.join(arena, 'dst-relative-link');
    fs.mkdirSync(path.join(from, 'sibling'), { recursive: true });
    fs.writeFileSync(path.join(from, 'sibling', 'mark.txt'), 'source');
    let made = true;
    try { fs.symlinkSync('sibling', path.join(from, 'link'), 'dir'); }
    catch (error) { if (error.code !== 'EPERM') throw error; made = false; }
    if (!made) console.log('SKIP a relative directory link (creating one needs the symlink privilege here)');
    else test('a relative directory link names its sibling inside the copy', () => {
      copyTreeSync(from, to);
      fs.writeFileSync(path.join(to, 'sibling', 'mark.txt'), 'copy');
      assert.strictEqual(fs.readFileSync(path.join(to, 'link', 'mark.txt'), 'utf8'), 'copy');
      assert.strictEqual(fs.realpathSync.native(path.join(to, 'link')), fs.realpathSync.native(path.join(to, 'sibling')));
    });
  }
  test('a missing source is an error, not an empty copy', () => {
    assert.throws(() => copyTreeSync(path.join(arena, 'missing'), path.join(arena, 'dst-missing')), error => error.code === 'ENOENT');
    assert.ok(!fs.existsSync(path.join(arena, 'dst-missing')));
  });
} finally {
  removeTree(arena, { recursive: true, force: true });
}
console.log(`copy tree: ${passed}/${passed + failed} passed (${process.version} ${process.platform})`);
if (failed) process.exitCode = 1;
