'use strict';
require('./temp-cleanup').trackTemp(module);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const source = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const R = require(path.join(source, 'lib/runtime-layout'));
const RW = require(path.join(source, 'lib/runtime-writes'));
const { removeTree } = require('./temp-cleanup');
const parent = fs.realpathSync.native(os.tmpdir());
const arena = fs.mkdtempSync(path.join(parent, 'leerness-topology-scan-'));
const results = [];
let sequence = 0;
const directory = () => {
  const root = path.join(arena, 'case-' + ++sequence);
  fs.mkdirSync(root);
  return root;
};
const snapshot = root => ({ root, ancestor: root, git: null,
  topologyDirectories: [], gitMarker: null, scope: 'project-local' });
const readerFor = root => R.createRuntimeSnapshotReader(snapshot(root));
const expect = (reader, reason) => {
  const result = reader();
  assert.equal(result.reasonCode, reason);
  assert.equal(result.writeDisposition, reason.startsWith('legacy_') ? 'allowed' : 'blocked');
  return result;
};
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); }
};
const patch = (object, name, replacement, fn) => {
  const original = object[name];
  object[name] = replacement(original);
  try { return fn(); } finally { object[name] = original; }
};
const bare = (root, terminal) => {
  fs.writeFileSync(path.join(root, 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(root, 'objects'));
  if (terminal === 'refs') fs.mkdirSync(path.join(root, terminal));
  else fs.writeFileSync(path.join(root, terminal), '[core]\n bare = true\n');
};
let observation;
try {
  test('unchanged non-Git reader remains read-only across repeated admissions', () => {
    const root = directory(), reader = readerFor(root), counts = { stat: 0, lstat: 0 };
    const started = performance.now();
    patch(fs, 'statSync', original => function (...args) { counts.stat++; return original.apply(this, args); }, () => {
      patch(fs, 'lstatSync', original => function (...args) { counts.lstat++; return original.apply(this, args); }, () => {
        for (let i = 0; i < 100; i++) expect(reader, 'legacy_absent');
      });
    });
    assert.deepEqual(fs.readdirSync(root), []);
    observation = { reads: 100, counts, elapsedMs: performance.now() - started };
  });
  for (const kind of ['file', 'directory', 'junction']) test(`reader rejects a newly introduced .git ${kind}`, () => {
    const root = directory(), reader = readerFor(root), marker = path.join(root, '.git');
    expect(reader, 'legacy_absent');
    if (kind === 'file') fs.writeFileSync(marker, 'gitdir: other\n');
    else if (kind === 'directory') fs.mkdirSync(marker);
    else fs.symlinkSync(directory(), marker, process.platform === 'win32' ? 'junction' : 'dir');
    expect(reader, 'topology_changed');
  });
  test('reader rejects a repository introduced at an ancestor', () => {
    const outer = directory(), root = path.join(outer, 'child');
    fs.mkdirSync(root);
    const reader = readerFor(root);
    expect(reader, 'legacy_absent');
    fs.mkdirSync(path.join(outer, '.git'));
    expect(reader, 'topology_changed');
  });
  for (const terminal of ['refs', 'config']) for (const location of ['root', 'ancestor']) {
    test(`reader rejects newly introduced bare metadata with ${terminal} at ${location}`, () => {
      const outer = directory(), root = path.join(outer, 'child');
      fs.mkdirSync(root);
      const reader = readerFor(root);
      expect(reader, 'legacy_absent');
      bare(location === 'root' ? root : outer, terminal);
      expect(reader, 'topology_changed');
    });
  }
  test('incomplete bare metadata retains the original non-repository verdict', () => {
    const root = directory(), reader = readerFor(root);
    fs.writeFileSync(path.join(root, 'HEAD'), 'not a complete repository\n');
    expect(reader, 'legacy_absent');
    fs.mkdirSync(path.join(root, 'objects'));
    expect(reader, 'legacy_absent');
    fs.mkdirSync(path.join(root, 'refs'));
    expect(reader, 'topology_changed');
  });
  for (const name of ['.git', 'HEAD', 'objects', 'refs', 'config']) {
    test(`unreadable ${name} is refused rather than treated as absence`, () => {
      const root = directory(), reader = readerFor(root);
      if (['objects', 'refs', 'config'].includes(name)) fs.writeFileSync(path.join(root, 'HEAD'), 'ref\n');
      if (['refs', 'config'].includes(name)) fs.mkdirSync(path.join(root, 'objects'));
      patch(fs, 'lstatSync', original => function (file, ...args) {
        if (String(file) === path.join(root, name)) throw Object.assign(new Error('controlled read denial'), { code: 'EACCES' });
        return original.call(this, file, ...args);
      }, () => expect(reader, 'layout_unreadable'));
    });
  }
  test('an ancestor repository keeps priority over a lower bare-marker read failure', () => {
    const outer = directory(), root = path.join(outer, 'child');
    fs.mkdirSync(root);
    const reader = readerFor(root);
    expect(reader, 'legacy_absent');
    fs.mkdirSync(path.join(outer, '.git'));
    patch(fs, 'lstatSync', original => function (file, ...args) {
      if (String(file) === path.join(root, 'HEAD')) throw Object.assign(new Error('controlled bare-marker denial'), { code: 'EACCES' });
      return original.call(this, file, ...args);
    }, () => expect(reader, 'topology_changed'));
  });
  test('an unreadable ancestor .git keeps priority over an earlier bare tuple', () => {
    const outer = directory(), root = path.join(outer, 'child');
    fs.mkdirSync(root);
    const reader = readerFor(root);
    expect(reader, 'legacy_absent');
    bare(root, 'refs');
    patch(fs, 'lstatSync', original => function (file, ...args) {
      if (String(file) === path.join(outer, '.git')) throw Object.assign(new Error('controlled ancestor denial'), { code: 'EACCES' });
      return original.call(this, file, ...args);
    }, () => expect(reader, 'layout_unreadable'));
  });
  for (const entry of [['GIT_CEILING_DIRECTORIES', arena], ['GIT_DISCOVERY_ACROSS_FILESYSTEM', 'true']]) {
    test(`${entry[0]} override remains blocked`, () => {
      const root = directory(), previous = process.env[entry[0]];
      try { process.env[entry[0]] = entry[1]; expect(readerFor(root), 'discovery_override_unsupported'); }
      finally { if (previous === undefined) delete process.env[entry[0]]; else process.env[entry[0]] = previous; }
    });
  }
  test('marker scan retains the filesystem device boundary', () => {
    const outer = directory(), root = path.join(outer, 'child');
    fs.mkdirSync(root);
    fs.mkdirSync(path.join(outer, '.git'));
    const rootDevice = fs.statSync(root, { bigint: true }).dev;
    patch(fs, 'statSync', original => function (file, ...args) {
      const value = original.call(this, file, ...args);
      if (String(file) !== outer) return value;
      return new Proxy(value, { get(target, key) {
        return key === 'dev' ? (typeof value.dev === 'bigint' ? rootDevice + 1n : Number(rootDevice) + 1) : Reflect.get(target, key);
      } });
    }, () => expect(readerFor(root), 'legacy_absent'));
  });
  for (const kind of ['git', 'bare', 'descriptor']) test(`writer rechecks ${kind} changes before its next write`, () => {
    const root = directory(), metadata = path.join(root, '.leerness');
    fs.mkdirSync(path.join(metadata, 'cache'), { recursive: true });
    const target = path.join(metadata, 'task-log.md');
    fs.writeFileSync(target, 'original\n');
    const id = process.platform === 'win32' ? root.toLowerCase() : root;
    assert.throws(() => RW.withRuntimeWriteAdmissions([{ id, snapshot: snapshot(root) }], () => {
      fs.writeFileSync(target, 'confirmed\n');
      if (kind === 'git') fs.writeFileSync(path.join(root, '.git'), 'gitdir: introduced\n');
      else if (kind === 'bare') bare(root, 'refs');
      else {
        const descriptor = path.join(metadata, 'cache/state-layout.json');
        const payload = JSON.stringify({ schema: 'leerness.runtime-layout/v1', schemaVersion: 1,
          scope: 'project-local', generation: 1, layout: 'legacy', requiredWriterProtocol: 2 });
        const result = cp.spawnSync(process.execPath,
          ['-e', 'require("fs").writeFileSync(process.argv[1], process.argv[2])', descriptor, payload],
          { stdio: 'ignore', timeout: 10000, windowsHide: true });
        assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0);
        assert.equal(fs.readFileSync(descriptor, 'utf8'), payload);
      }
      fs.writeFileSync(target, 'must not be published\n');
    }), error => error.code === 'E_RUNTIME_LAYOUT_INCOMPATIBLE'
      && error.reasonCode === (kind === 'descriptor' ? 'layout_unsupported' : 'topology_changed'));
    assert.equal(fs.readFileSync(target, 'utf8'), 'confirmed\n');
  });
} finally {
  assert.equal(path.dirname(path.resolve(arena)), parent);
  assert(path.basename(arena).startsWith('leerness-topology-scan-'));
  removeTree(arena, { recursive: true, force: true });
}
const ok = results.every(result => result.ok);
process.stdout.write(JSON.stringify({ ok, passed: results.filter(result => result.ok).length,
  total: results.length, observation, results }, null, 2) + '\n');
if (!ok) process.exitCode = 1;
