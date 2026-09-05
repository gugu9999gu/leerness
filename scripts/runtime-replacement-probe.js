'use strict';

// Final Windows mutation boundary: prepared files are allowed before the
// descriptor changes, but the replacement attempt and retry must then stop.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const runtime = require('../lib/runtime-writes');
const io = require('../lib/io');
const original = { read: fs.readFileSync, write: fs.writeFileSync, spawn: cp.spawnSync };
const parent = fs.realpathSync(os.tmpdir());
const arena = fs.mkdtempSync(path.join(parent, 'leerness-runtime-replace-'));
let passed = 0, failed = 0;
function fixture(name) {
  const root = path.join(arena, name);
  fs.mkdirSync(path.join(root, '.leerness/cache'), { recursive: true });
  fs.writeFileSync(path.join(root, '.leerness/HARNESS_VERSION'), 'fixture\n');
  fs.writeFileSync(path.join(root, 'target.txt'), 'original');
  return root;
}
function changeLayout(root) {
  // Captured primitive models a different process changing only its descriptor.
  original.write(path.join(root, '.leerness/cache/state-layout.json'), JSON.stringify({
    schema: 'leerness.runtime-layout/v1', schemaVersion: 1, scope: 'project-local',
    generation: 1, layout: 'legacy', requiredWriterProtocol: 2,
  }));
}
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.stack); }
  finally { fs.readFileSync = original.read; cp.spawnSync = original.spawn; }
}
try {
  if (process.platform === 'win32') {
    for (const phase of ['prepared', 'retry']) test('replacement rejects incompatible layout at ' + phase, () => {
      const root = fixture(phase);
      const target = path.join(root, 'target.txt');
      const before = fs.statSync(target, { bigint: true });
      let targetReads = 0, attempts = 0, changed = false;
      fs.readFileSync = function (file, ...args) {
        const result = original.read.call(this, file, ...args);
        if (phase === 'prepared' && file === target && ++targetReads === 2) {
          changeLayout(root); changed = true;
        }
        return result;
      };
      cp.spawnSync = function (command, args, options) {
        if (!options?.env?.LEERNESS_REPLACE_FROM) return original.spawn.call(this, command, args, options);
        attempts++;
        if (phase === 'retry' && attempts === 1) {
          changeLayout(root); changed = true;
          return { status: 1, stderr: 'LEERNESS_REPLACE_ERROR:32:controlled sharing violation' };
        }
        return { status: 1, stderr: 'LEERNESS_REPLACE_ERROR:5:unexpected replacement attempt' };
      };
      assert.throws(() => runtime.withRuntimeWrites(root, () =>
        io.writeBufferIfUnchanged(target, Buffer.from('original'), Buffer.from('planned'))),
      error => error.code === 'E_RUNTIME_LAYOUT_INCOMPATIBLE');
      assert(changed, 'interleaving must run');
      assert.strictEqual(attempts, phase === 'retry' ? 1 : 0);
      assert.strictEqual(original.read(target, 'utf8'), 'original');
      assert.strictEqual(fs.statSync(target, { bigint: true }).mtimeNs, before.mtimeNs);
    });
    test('real compatible Windows replacement retains original recovery bytes', () => {
      const root = fixture('control'), target = path.join(root, 'target.txt');
      const result = runtime.withRuntimeWrites(root, () =>
        io.writeBufferIfUnchanged(target, Buffer.from('original'), Buffer.from('planned')));
      assert.strictEqual(fs.readFileSync(target, 'utf8'), 'planned');
      assert.strictEqual(fs.readFileSync(result.backupFile, 'utf8'), 'original');
    });
  } else {
    test('non-Windows replacement remains explicitly unsupported', () => {
      const root = fixture('unsupported'), target = path.join(root, 'target.txt');
      assert.throws(() => runtime.withRuntimeWrites(root, () =>
        io.writeBufferIfUnchanged(target, Buffer.from('original'), Buffer.from('planned'))),
      error => error.code === 'E_METADATA_PRESERVATION_UNAVAILABLE');
      assert.strictEqual(fs.readFileSync(target, 'utf8'), 'original');
    });
  }
} finally {
  fs.readFileSync = original.read; cp.spawnSync = original.spawn;
  assert.strictEqual(fs.realpathSync(arena), arena);
  assert.strictEqual(path.dirname(arena), parent);
  assert(path.basename(arena).startsWith('leerness-runtime-replace-'));
  fs.rmSync(arena, { recursive: true, force: true });
}
console.log('runtime replacement probe: ' + passed + '/' + (passed + failed) + ' PASS');
process.exitCode = failed ? 1 : 0;
