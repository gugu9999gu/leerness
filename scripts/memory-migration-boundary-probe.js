'use strict';
const S = require('./memory-migration-write-support');
const { assert, fs, path, test, fixture, file, invoke, prepared, applied, hook, modulePath, snapshot } = S;
test('stable project alias supports preparation application and rollback', () => {
  const root = fixture('decisions'), alias = root + '-alias'; fs.symlinkSync(root, alias, 'junction');
  const p = applied(alias, 'decisions'); assert.equal(invoke(alias, 'rollback', 'decisions', p.operationId).ok, true);
});
test('retargeted caller alias cannot keep writing its previous project', () => {
  const root = fixture('decisions'), alias = root + '-alias', other = fixture('decisions');
  fs.symlinkSync(root, alias, 'junction'); const otherBefore = snapshot(other);
  const prefix = hook(`const fs=require('fs'),store=require(${modulePath('memory-migration-storage')}),original=store.createArtifact;
store.createArtifact=(s,n,b)=>{const r=original(s,n,b);if(n==='source.md'){fs.unlinkSync(${JSON.stringify(alias)});fs.symlinkSync(${JSON.stringify(other)},${JSON.stringify(alias)},'junction');}return r};`);
  const result = invoke(alias, 'prepare', 'decisions', null, prefix);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'migration_project_changed');
  assert(!fs.existsSync(file(root, 'decisions', '.json'))); assert.deepEqual(snapshot(other), otherBefore);
});
test('junction at raw artifact pathname never becomes an accepted backup', () => {
  const root = fixture('decisions'), p = prepared(root, 'decisions');
  const raw = path.join(root, p.retentionDirectory, 'source.md');
  fs.renameSync(raw, raw + '.original'); fs.symlinkSync(root, raw, 'junction');
  assert.equal(invoke(root, 'apply', 'decisions', p.operationId).ok, false);
  assert(!fs.existsSync(file(root, 'decisions', '.json')));
});
test('bundle directory junction is rejected even when bytes are identical', () => {
  const root = fixture('decisions'), p = prepared(root, 'decisions'), dir = path.join(root, p.retentionDirectory);
  fs.renameSync(dir, dir + '-moved'); fs.symlinkSync(dir + '-moved', dir, 'junction');
  assert.equal(invoke(root, 'apply', 'decisions', p.operationId).ok, false); assert(!fs.existsSync(file(root, 'decisions', '.json')));
});
test('multi-link raw backup is rejected without publishing active files', () => {
  const root = fixture('decisions'), p = prepared(root, 'decisions');
  const raw = path.join(root, p.retentionDirectory, 'source.md'); fs.linkSync(raw, raw + '.alias');
  assert.equal(invoke(root, 'apply', 'decisions', p.operationId).ok, false);
  assert(!fs.existsSync(file(root, 'decisions', '.json')));
});
test('legacy workspace requires explicit workspace migration without automatic writes', () => {
  const root = S.project({ 'decisions.md': S.legacy('decisions') }, '.harness'); // workspace-dir-legacy-fixture
  const before = snapshot(root), r = invoke(root, 'prepare', 'decisions');
  assert.equal(r.error.code, 'migration_canonical_workspace_required'); assert.deepEqual(snapshot(root), before);
});
for (const phase of ['retention', 'canonical']) test('runtime transition during ' + phase + ' blocks further domain writes', () => {
  const root = fixture('decisions'); const p = phase === 'canonical' ? prepared(root, 'decisions') : null;
  const inject = `const fs=require('fs');fs.mkdirSync(${JSON.stringify(path.join(root, '.leerness/cache'))},{recursive:true});fs.writeFileSync(${JSON.stringify(path.join(root, '.leerness/cache/state-layout.json'))},'{}');`;
  const prefix = phase === 'retention'
    ? hook(`const store=require(${modulePath('memory-migration-storage')}),original=store.createArtifact;store.createArtifact=(s,n,b)=>{const r=original(s,n,b);if(n==='source.md'){${inject}}return r};`)
    : hook(`const out=require(${modulePath('memory-output')}),original=out.publishMemoryOutput;out.publishMemoryOutput=(t,f,b)=>{const r=original(t,f,b);if(f.endsWith('decisions.json')){${inject}}return r};`);
  const result = invoke(root, phase === 'canonical' ? 'apply' : 'prepare', 'decisions', p?.operationId, prefix);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'migration_runtime_incompatible');
  assert.equal(fs.existsSync(file(root, 'decisions', '.json')), phase === 'canonical');
  if (phase === 'canonical') { assert.equal(result.status, 'partial'); assert(result.recoveryReceipt); assert(fs.existsSync(result.recoveryReceipt)); }
});
test('unattributed identical canonical cannot be rolled back or silently adopted', () => {
  const root = fixture('decisions'), p = prepared(root, 'decisions');
  fs.copyFileSync(path.join(root, p.retentionDirectory, 'canonical.json'), file(root, 'decisions', '.json'));
  for (const action of ['apply', 'rollback']) assert.equal(invoke(root, action, 'decisions', p.operationId).ok, false);
  assert(fs.existsSync(file(root, 'decisions', '.json')));
});
test('new immutable bundle creation never overwrites an existing operation directory', () => {
  const root = fixture('decisions'), p = prepared(root, 'decisions'), before = snapshot(path.join(root, p.retentionDirectory));
  const prefix = hook(`require('crypto').randomBytes=size=>{if(size===16)return Buffer.from(${JSON.stringify(p.operationId)},'hex');return Buffer.alloc(size,7)};`);
  const result = invoke(root, 'prepare', 'decisions', null, prefix); assert.equal(result.ok, false);
  assert.deepEqual(snapshot(path.join(root, p.retentionDirectory)), before);
});
test('structured API rejects payload-bearing invalid arguments without evaluation', () => {
  const { runMigration } = require('../lib/memory-migration-write'); let evaluated = false;
  const payload = { toJSON() { evaluated = true; return S.PRIVATE; }, toString() { evaluated = true; return '0'.repeat(32); } };
  const result = runMigration(S.arena, payload, payload, payload, {});
  assert.equal(result.ok, false); assert(!JSON.stringify(result).includes(S.PRIVATE)); assert.equal(evaluated, false);
});
S.finish('memory migration boundaries');
