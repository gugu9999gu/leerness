'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { captureMemoryOutput, publishMemoryOutput } = require('../lib/memory-output');

function fixture(fn) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-gap-cont-'));
  const ws = path.join(root, '.leerness'); fs.mkdirSync(ws);
  const put = (name, bytes) => { const file = path.join(ws, name); fs.writeFileSync(file, bytes); return file; };
  put('HARNESS_VERSION', require('../package.json').version + '\n');
  put('LANGUAGE', 'en\n');
  put('manifest.json', '{"language":"en","mode":"standard"}');
  const gap = (name, bytes = 'authored original\r\n') => {
    const file = put(name, bytes);
    const scratch = fs.mkdtempSync(path.join(ws, `.${name}.publish-cas-`));
    fs.renameSync(file, path.join(scratch, 'before'));
    fs.writeFileSync(path.join(scratch, 'next'), 'proposed replacement\r\n');
    return { file, scratch };
  };
  try { return fn({ root, ws, put, gap }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function snapshot(root) {
  const rows = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      rows.push([path.relative(root, file), stat.mode, stat.ino,
        stat.isSymbolicLink() ? fs.readlinkSync(file) : stat.isFile() ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null]);
      if (stat.isDirectory()) walk(file);
    }
  }
  walk(root); return rows;
}
function patch(name, replacement, fn) {
  const original = fs[name]; fs[name] = replacement(original);
  try { return fn(); } finally { fs[name] = original; }
}

for (const name of ['progress-tracker.md', 'plan.md', 'rules.md', 'decisions.json']) {
  test(`output capture refuses interrupted publication: ${name}`, () => fixture(f => {
    const { file } = f.gap(name), before = snapshot(f.root);
    assert.throws(() => captureMemoryOutput(file), { code: 'E_OUTPUT_CHANGED' });
    assert.deepEqual(snapshot(f.root), before);
  }));
}
test('a previously absent output token cannot replace a displaced original', () => fixture(f => {
  const file = path.join(f.ws, 'state.json'), token = captureMemoryOutput(file);
  f.gap('state.json', '{"original":true}'); const before = snapshot(f.root);
  assert.throws(() => publishMemoryOutput(token, file, '{"unexpected":true}'), { code: 'E_OUTPUT_CHANGED' });
  assert.deepEqual(snapshot(f.root), before);
}));
test('output capture detects publication completing during absence inspection', () => fixture(f => {
  const { file, scratch } = f.gap('state.json'); let fired = false;
  patch('readdirSync', original => function(dir, ...args) {
    if (!fired && dir === f.ws) {
      fired = true; fs.renameSync(path.join(scratch, 'next'), file);
      fs.unlinkSync(path.join(scratch, 'before')); fs.rmdirSync(scratch);
    }
    return original.call(this, dir, ...args);
  }, () => assert.throws(() => captureMemoryOutput(file), { code: 'E_OUTPUT_CHANGED' }));
  assert(fired);
}));
test('output capture rechecks parent identity after the marker scan', () => fixture(f => {
  const file = path.join(f.ws, 'missing.md'); let fired = false;
  patch('readdirSync', original => function(dir, ...args) {
    const names = original.call(this, dir, ...args);
    if (!fired && dir === f.ws) { fired = true; fs.renameSync(f.ws, f.ws + '-before'); fs.mkdirSync(f.ws); }
    return names;
  }, () => assert.throws(() => captureMemoryOutput(file), { code: 'E_OUTPUT_CHANGED' }));
  assert(fired);
}));
test('output capture refuses unreadable absence inspection', () => fixture(f => {
  patch('readdirSync', original => function(dir, ...args) {
    if (dir === f.ws) throw Object.assign(Error('fixture EACCES'), { code: 'EACCES' });
    return original.call(this, dir, ...args);
  }, () => assert.throws(() => captureMemoryOutput(path.join(f.ws, 'missing.md')), { code: 'E_OUTPUT_CHANGED' }));
}));
test('genuine absence remains available for new output', () => fixture(f => {
  const file = path.join(f.ws, 'missing.md');
  assert.equal(captureMemoryOutput(file).exists, false);
}));
test('valid output files do not enumerate publication markers', () => fixture(f => {
  const file = f.put('existing.md', '\ufeffauthored\r\n');
  fs.mkdirSync(path.join(f.ws, '.existing.md.publish-cas-Ab1234'));
  patch('readdirSync', () => () => { throw Error('existing output scanned markers'); }, () => {
    assert.equal(captureMemoryOutput(file).exists, true);
  });
}));
test('an unrelated marker does not prevent new output creation', () => fixture(f => {
  fs.mkdirSync(path.join(f.ws, '.another.md.publish-cas-Ab1234'));
  const file = path.join(f.ws, 'new.md'), token = captureMemoryOutput(file);
  publishMemoryOutput(token, file, 'new content');
  assert.equal(fs.readFileSync(file, 'utf8'), 'new content');
}));
