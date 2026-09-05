'use strict';

// Release-only negative controls. Supply an existing installed v1.36.186 package;
// this probe never downloads a client or changes that installation.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const crypto = require('crypto');
const legacy = fs.realpathSync(process.argv[2] || assert.fail('Supply installed leerness@1.36.186 package directory'));
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(legacy, 'package.json'))).version, '1.36.186');
const parent = fs.realpathSync(os.tmpdir());
const arena = fs.mkdtempSync(path.join(parent, 'leerness-legacy-runtime-negative-'));
const sourceFiles = ['package.json', 'bin/leerness.js', 'lib/io.js'].map(name => path.join(legacy, name));
function identity(file) {
  return [String(fs.statSync(file, { bigint: true }).mtimeNs),
    crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')];
}
const beforeSources = sourceFiles.map(identity);
const env = { ...process.env, LEERNESS_OFFLINE: '1', LEERNESS_INTERNAL: '1',
  LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_PROMPT: '1' };
for (const key of Object.keys(env)) if (/^GIT_|^LEERNESS_(SESSION_ID|WORKSPACE_DIR|MCP_)/i.test(key)) delete env[key];
const future = JSON.stringify({ schema: 'leerness.runtime-layout/v1', schemaVersion: 1,
  scope: 'project-local', generation: 1, layout: 'legacy', requiredWriterProtocol: 2 });
function fixture(name) {
  const root = path.join(arena, name);
  fs.mkdirSync(path.join(root, '.leerness/cache'), { recursive: true });
  fs.writeFileSync(path.join(root, '.leerness/HARNESS_VERSION'), '1.36.186\n');
  return root;
}
function layout(root) {
  const file = path.join(root, '.leerness/cache/state-layout.json');
  fs.writeFileSync(file, future); return file;
}
try {
  const root = fixture('old-cli'), descriptor = layout(root);
  const stamp = identity(descriptor);
  const old = cp.spawnSync(process.execPath, [path.join(legacy, 'bin/leerness.js'),
    'state', 'start', '--path', root, '--goal', 'isolated negative control', '--json'],
  { cwd: root, env, encoding: 'utf8', timeout: 120000 });
  assert.strictEqual(old.status, 0, old.stderr + old.stdout);
  assert(fs.existsSync(path.join(root, '.leerness/state.json')), 'old CLI must demonstrate the known missing guard');
  assert.deepStrictEqual(identity(descriptor), stamp);
  console.log('PASS negative control: v1.36.186 CLI does not honor the new descriptor');

  const retained = require(path.join(legacy, 'lib/io.js')).writeUtf8;
  const longLived = fixture('already-loaded-writer');
  layout(longLived);
  const output = path.join(longLived, '.leerness/cache/retained.txt');
  retained(output, 'old writer remains unguarded');
  assert.strictEqual(fs.readFileSync(output, 'utf8'), 'old writer remains unguarded');
  console.log('PASS negative control: already-loaded legacy writer remains unguarded');

  const currentRoot = fixture('current-cli'), currentDescriptor = layout(currentRoot);
  const currentStamp = identity(currentDescriptor);
  const current = cp.spawnSync(process.execPath, [path.resolve(__dirname, '../bin/leerness.js'),
    'state', 'start', '--path', currentRoot, '--goal', 'new writer control', '--json'],
  { cwd: currentRoot, env, encoding: 'utf8', timeout: 120000 });
  assert.strictEqual(current.status, 1, current.stderr + current.stdout);
  assert.strictEqual(JSON.parse(current.stdout).code, 'runtime_layout_incompatible');
  assert(!fs.existsSync(path.join(currentRoot, '.leerness/state.json')));
  assert.deepStrictEqual(identity(currentDescriptor), currentStamp);
  console.log('PASS current writer refuses the same incompatible layout');
  assert.deepStrictEqual(sourceFiles.map(identity), beforeSources);
  console.log('legacy runtime negative controls: 3/3 PASS; installed source unchanged');
} finally {
  assert.strictEqual(fs.realpathSync(arena), arena);
  assert.strictEqual(path.dirname(arena), parent);
  assert(path.basename(arena).startsWith('leerness-legacy-runtime-negative-'));
  fs.rmSync(arena, { recursive: true, force: true });
}
