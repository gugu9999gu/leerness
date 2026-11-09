'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const store = require('../lib/role-store');
const { withStateLock } = require('../lib/state-lock');
const source = path.resolve(__dirname, '..');
const cli = path.join(source, 'bin/leerness.js');
const version = require('../package.json').version;
const initial = { schemaVersion: 1, roles: { coder: { provider: 'codex', model: null, persona: 'original' } }, extension: 'preserved' };
function snapshot(root) {
  const rows = [];
  function visit(file) {
    const stat = fs.lstatSync(file, { bigint: true });
    rows.push([path.relative(root, file), String(stat.ino), String(stat.mode), String(stat.mtimeNs),
      stat.isSymbolicLink() ? fs.readlinkSync(file) : stat.isFile() ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null]);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name));
  }
  visit(root);
  return rows;
}
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'leerness-role-gap-'));
  const ws = path.join(root, '.leerness'), file = path.join(ws, 'agent-roles.json');
  fs.mkdirSync(ws);
  fs.writeFileSync(path.join(ws, 'HARNESS_VERSION'), version + '\n');
  fs.writeFileSync(path.join(ws, 'LANGUAGE'), 'en\n');
  const put = () => fs.writeFileSync(file, JSON.stringify(initial) + '\n');
  const gap = (prefix = '.agent-roles-cas-') => {
    put();
    const folder = fs.mkdtempSync(path.join(ws, prefix));
    fs.renameSync(file, path.join(folder, 'before'));
    fs.writeFileSync(path.join(folder, 'next'), JSON.stringify(initial));
    return folder;
  };
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:LEERNESS_|_LEERNESS_|GIT_|NODE_OPTIONS$)/i.test(key)) delete env[key];
  Object.assign(env, { LEERNESS_OFFLINE: '1', LEERNESS_NO_PROMPT: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_BANNER: '1', LEERNESS_NO_LOCK_WARN: '1', NO_COLOR: '1' });
  const run = (args, preload) => {
    const result = cp.spawnSync(process.execPath, [...(preload ? ['--require', preload] : []), cli, ...args, '--path', root, '--json'],
      { cwd: root, env, encoding: 'utf8', timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 });
    assert.equal(result.error, undefined, result.stderr);
    assert.equal(result.signal, null, result.stderr);
    return result;
  };
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  try {
    const result = fn({ root, ws, file, put, gap, run, env });
    if (result && typeof result.then === 'function') return result.finally(cleanup);
    cleanup();
    return result;
  } catch (error) { cleanup(); throw error; }
}
function patch(name, replacement, fn) {
  const original = fs[name];
  fs[name] = replacement(original);
  try { return fn(); } finally { fs[name] = original; }
}
function changed(root) {
  const result = store.readRoleStore(root);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.code, 'store_changed', JSON.stringify(result));
  return result;
}
for (const prefix of ['.agent-roles-cas-', '.agent-roles.json.publish-cas-']) {
  test('missing role file with publication marker is not an empty store: ' + prefix, () => fixture(f => {
    f.gap(prefix);
    const before = snapshot(f.root);
    changed(f.root);
    assert.deepEqual(snapshot(f.root), before);
  }));
}
test('genuine missing file remains read-only missing', () => fixture(f => {
  const before = snapshot(f.root), state = store.readRoleStore(f.root);
  assert.equal(state.ok, true); assert.equal(state.state, 'missing');
  assert.deepEqual(snapshot(f.root), before);
}));
test('genuine missing workspace does not initialize it', () => fixture(f => {
  fs.rmSync(f.ws, { recursive: true });
  assert.equal(store.readRoleStore(f.root).state, 'missing');
  assert.deepEqual(fs.readdirSync(f.root), []);
}));
test('unrelated marker names do not block an absent role file', () => fixture(f => {
  for (const name of ['.agent-roles-cas-', '.agent-roles-cas-Ab12.txt', '.other.json.publish-cas-Ab1234', '.agent-roles-create-123']) fs.mkdirSync(path.join(f.ws, name));
  assert.equal(store.readRoleStore(f.root).state, 'missing');
}));
for (const kind of ['file', 'empty-directory', 'link']) test('ambiguous marker is preserved without following it: ' + kind, () => fixture(f => {
  const marker = path.join(f.ws, '.agent-roles-cas-Ab1234');
  if (kind === 'file') fs.writeFileSync(marker, 'private bytes');
  else if (kind === 'empty-directory') fs.mkdirSync(marker);
  else {
    const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'before'), 'do-not-read');
    fs.symlinkSync(outside, marker, process.platform === 'win32' ? 'junction' : 'dir');
  }
  const before = snapshot(f.root);
  patch('readFileSync', original => function(file, ...args) {
    assert(!String(file).startsWith(marker), 'opened a marker');
    return original.call(this, file, ...args);
  }, () => changed(f.root));
  assert.deepEqual(snapshot(f.root), before);
}));
test('existing valid role files retain the no-enumeration fast path', () => fixture(f => {
  f.put(); fs.mkdirSync(path.join(f.ws, '.agent-roles-cas-Ab1234'));
  patch('readdirSync', () => () => { throw Error('unexpected directory scan'); }, () => {
    assert.equal(store.readRoleStore(f.root).state, 'valid');
  });
}));
test('unreadable publication enumeration is not absence', () => fixture(f => {
  const result = patch('readdirSync', original => function(dir, ...args) {
    if (dir === f.ws) throw Object.assign(Error('controlled'), { code: 'EACCES' });
    return original.call(this, dir, ...args);
  }, () => store.readRoleStore(f.root));
  assert.equal(result.ok, false); assert.equal(result.code, 'store_unreadable');
}));
test('a parent replaced during enumeration is not absence', () => fixture(f => {
  let fired = false;
  patch('readdirSync', original => function(dir, ...args) {
    const names = original.call(this, dir, ...args);
    if (!fired && dir === f.ws) { fired = true; fs.renameSync(f.ws, f.ws + '-aside'); fs.mkdirSync(f.ws); }
    return names;
  }, () => changed(f.root));
  assert(fired);
}));
test('a role file appearing during enumeration is not an old absent snapshot', () => fixture(f => {
  let fired = false;
  patch('readdirSync', original => function(dir, ...args) {
    const names = original.call(this, dir, ...args);
    if (!fired && dir === f.ws) { fired = true; f.put(); }
    return names;
  }, () => changed(f.root));
  assert(fired); assert.deepEqual(JSON.parse(fs.readFileSync(f.file)), initial);
}));
test('a workspace appearing after the first parent observation is not absent', () => fixture(f => {
  fs.rmSync(f.ws, { recursive: true }); let fired = false;
  patch('lstatSync', original => function(file, ...args) {
    try { return original.call(this, file, ...args); }
    catch (error) {
      if (!fired && file === f.ws && error.code === 'ENOENT') {
        fired = true; fs.mkdirSync(f.ws); fs.mkdirSync(path.join(f.ws, '.agent-roles-cas-Ab1234'));
      }
      throw error;
    }
  }, () => changed(f.root));
  assert(fired);
}));
test('role resolution and validation cannot report empty success during a gap', () => fixture(f => {
  f.gap();
  assert.equal(store.resolveRole(f.root, 'coder').storeError.code, 'store_changed');
  assert.equal(store.validationSummary(f.root).code, 'store_changed');
}));
for (const args of [['roles','list'], ['roles','validate'], ['roles','suggest'], ['roles','suggest','--apply'], ['roles','set','reviewer','--provider','claude'], ['roles','unset','coder']]) {
  test('CLI preserves an interrupted publication: ' + args.join(' '), () => fixture(f => {
    const folder = f.gap(), original = fs.readFileSync(path.join(folder, 'before'));
    const before = snapshot(folder), readonly = args[1] === 'validate';
    const projectBefore = readonly ? snapshot(f.root) : null;
    const result = f.run(args);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).code, 'store_changed', result.stdout);
    assert.equal(fs.existsSync(f.file), false);
    assert.deepEqual(fs.readFileSync(path.join(folder, 'before')), original);
    assert.deepEqual(snapshot(folder), before);
    if (readonly) assert.deepEqual(snapshot(f.root), projectBefore);
  }));
}
test('an absent token cannot create a fresh store over an interrupted original', () => fixture(f => {
  const absent = store.readRoleStore(f.root), folder = f.gap();
  assert.throws(() => store.saveRoles(f.root, { reviewer: { provider: 'claude' } }, absent), error => error.code === 'store_changed');
  assert.equal(fs.existsSync(f.file), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'before'))), initial);
}));
test('the real POSIX role publisher is never observed as missing', { skip: process.platform === 'win32' }, () => fixture(f => {
  f.put(); let observed = false, refusal;
  patch('renameSync', original => function(from, to, ...args) {
    const result = original.call(this, from, to, ...args);
    if (from === f.file && path.basename(to) === 'before') {
      observed = true;
      const before = snapshot(f.root);
      refusal = store.readRoleStore(f.root);
      assert.deepEqual(snapshot(f.root), before);
    }
    return result;
  }, () => store.updateRoles(f.root, roles => { roles.reviewer = { provider: 'claude' }; }, withStateLock));
  assert(observed); assert.equal(refusal.code, 'store_changed', JSON.stringify(refusal));
  assert.equal(store.readRoleStore(f.root).roles.reviewer.provider, 'claude');
}));
for (const args of [['roles','set','reviewer','--provider','claude'], ['roles','suggest','--apply']]) {
  test('CLI writer waits for a real locked publication: ' + args.join(' '), { skip: process.platform === 'win32' }, () => fixture(async f => {
    f.put();
    const ready = path.join(f.root, 'ready'), wait = path.join(f.root, 'wait'), done = path.join(f.root, 'done');
    const childFile = path.join(f.root, 'writer.cjs'), preload = path.join(f.root, 'reader.cjs');
    fs.writeFileSync(childFile, `const fs=require('fs'),path=require('path');const store=require(${JSON.stringify(path.join(source,'lib/role-store'))});const locks=require(${JSON.stringify(path.join(source,'lib/state-lock'))});const rename=fs.renameSync;fs.renameSync=function(from,to,...args){const r=rename.call(this,from,to,...args);if(from===${JSON.stringify(f.file)}&&path.basename(to)==='before'){fs.writeFileSync(${JSON.stringify(ready)},'ready');const end=Date.now()+15000;while(!fs.existsSync(${JSON.stringify(wait)})){if(Date.now()>end)throw Error('reader did not wait for the lock');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);}return r;};store.updateRoles(${JSON.stringify(f.root)},roles=>{roles.coder.persona='concurrent writer';},locks.withStateLock);fs.writeFileSync(${JSON.stringify(done)},'done');`);
    fs.writeFileSync(preload, `const fs=require('fs');const locks=require(${JSON.stringify(path.join(source,'lib/state-lock'))});const lock=locks.withStateLock;locks.withStateLock=function(file,...args){if(file===${JSON.stringify(f.file)})fs.writeFileSync(${JSON.stringify(wait)},'waiting');return lock.call(this,file,...args);};`);
    const child = cp.spawn(process.execPath, [childFile], { cwd: f.root, env: f.env, stdio: ['ignore','pipe','pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    const completion = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({code,signal})); });
    const timer = setTimeout(() => child.kill(), 25000);
    try {
      const end = Date.now()+20000;
      while (!fs.existsSync(ready)) { assert(Date.now()<end, 'publisher did not reach its gap: '+output); await new Promise(resolve => setTimeout(resolve,10)); }
      const result = f.run(args, preload);
      assert.equal(result.status, 0, result.stdout+result.stderr);
      const exit = await completion;
      assert.deepEqual(exit,{code:0,signal:null},output);
      assert.equal(fs.existsSync(done),true);
      const saved = JSON.parse(fs.readFileSync(f.file));
      assert.equal(saved.roles.coder.persona,'concurrent writer');
      assert.equal(saved.extension,'preserved');
      if (args[1]==='set') assert.equal(saved.roles.reviewer.provider,'claude');
    } finally { clearTimeout(timer); child.kill(); await completion; }
  }));
}
