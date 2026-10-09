'use strict';
const S = require('./memory-migration-write-support');
const { assert, fs, path, test, fixture, file, invoke, prepared, applied, hook, modulePath } = S;
function failArtifact(name, when = 'before') {
  return hook(`const store=require(${modulePath('memory-migration-storage')}),original=store.createArtifact;
store.createArtifact=(storage,name,bytes)=>{if(name===${JSON.stringify(name)}){${when === 'after' ? 'original(storage,name,bytes);' : ''}throw Object.assign(Error('injected failure'),{code:'EIO'});}return original(storage,name,bytes)};`);
}
for (const name of ['source.md', 'canonical.json', 'projection.md', 'manifest.json', 'prepared.json']) {
  for (const when of ['before', 'after']) test('prepare ' + when + ' ' + name + ' failure preserves active source', () => {
    const root = fixture('decisions'), original = fs.readFileSync(file(root, 'decisions', '.md'));
    const result = invoke(root, 'prepare', 'decisions', null, failArtifact(name, when));
    assert.equal(result.ok, false); assert.equal(result.retentionVerified, false); assert.equal(result.activeMutationStarted, false);
    assert(fs.readFileSync(file(root, 'decisions', '.md')).equals(original)); assert(!fs.existsSync(file(root, 'decisions', '.json')));
  });
}
test('actual fsync failure cannot mark raw retention verified', () => {
  const root = fixture('decisions');
  const prefix = hook(`const fs=require('fs'),open=fs.openSync,sync=fs.fsyncSync;const paths=new Map();
fs.openSync=(p,...args)=>{const fd=open(p,...args);paths.set(fd,String(p));return fd};
fs.fsyncSync=fd=>{if((paths.get(fd)||'').endsWith('source.md'))throw Object.assign(Error('fsync'),{code:'EIO'});return sync(fd)};`);
  const result = invoke(root, 'prepare', 'decisions', null, prefix);
  assert.equal(result.ok, false); assert.equal(result.retentionVerified, false); assert(!fs.existsSync(file(root, 'decisions', '.json')));
});
test('raw artifact mismatch is detected by reread', () => {
  const root = fixture('decisions');
  const prefix = hook(`const store=require(${modulePath('memory-migration-storage')}),original=store.createArtifact;
store.createArtifact=(s,n,b)=>{const result=original(s,n,b);if(n==='source.md')require('fs').appendFileSync(result.file,'corrupt');return result};`);
  const result = invoke(root, 'prepare', 'decisions', null, prefix);
  assert.equal(result.ok, false); assert(!fs.existsSync(file(root, 'decisions', '.json')));
});
test('source change after prepared receipt invalidates preparation', () => {
  const root = fixture('decisions'), source = file(root, 'decisions', '.md');
  const prefix = hook(`const store=require(${modulePath('memory-migration-storage')}),original=store.createArtifact;
store.createArtifact=(s,n,b)=>{const result=original(s,n,b);if(n==='prepared.json')require('fs').appendFileSync(${JSON.stringify(source)},'external');return result};`);
  const result = invoke(root, 'prepare', 'decisions', null, prefix);
  assert.equal(result.ok, false); assert.equal(result.retentionVerified, false); assert(!fs.existsSync(file(root, 'decisions', '.json')));
  assert.equal(invoke(root, 'apply', 'decisions', result.operationId).ok, false);
});
for (const surface of ['decisions', 'lessons']) {
  for (const name of ['canonical-created.json', 'applied.json']) {
    for (const when of ['before', 'after']) test(surface + ' apply ' + when + ' ' + name + ' failure is partial', () => {
      const root = fixture(surface), p = prepared(root, surface), raw = fs.readFileSync(file(root, surface, '.md'));
      const result = invoke(root, 'apply', surface, p.operationId, failArtifact(name, when));
      assert.equal(result.ok, false); assert.equal(result.status, 'partial'); assert.equal(result.retentionVerified, true);
      assert(result.recoveryReceipt); assert(fs.readFileSync(path.join(root, p.retentionDirectory, 'source.md')).equals(raw));
      const retried = invoke(root, 'apply', surface, p.operationId);
      // No ownership receipt means a matching canonical is not attributed to us.
      assert.equal(retried.ok, !(name === 'canonical-created.json' && when === 'before'));
      if (retried.ok) assert.equal(invoke(root, 'rollback', surface, p.operationId).ok, true);
    });
  }
  for (const when of ['before', 'after']) test(surface + ' projection publication failure supports safe retry', () => {
    const root = fixture(surface), p = prepared(root, surface);
    const prefix = hook(`const out=require(${modulePath('memory-output')}),original=out.publishMemoryOutput;
out.publishMemoryOutput=(token,file,bytes)=>{if(file.endsWith(${JSON.stringify(surface + '.md')})){${when === 'after' ? 'original(token,file,bytes);' : ''}throw Object.assign(Error('publication'),{code:'EIO'});}return original(token,file,bytes)};`);
    const result = invoke(root, 'apply', surface, p.operationId, prefix); assert.equal(result.status, 'partial');
    assert.equal(invoke(root, 'apply', surface, p.operationId).ok, true);
    assert.equal(invoke(root, 'rollback', surface, p.operationId).ok, true);
  });
  test(surface + ' rollback receipt failure supports safe retry', () => {
    const root = fixture(surface), p = applied(root, surface), raw = fs.readFileSync(path.join(root, p.retentionDirectory, 'source.md'));
    const result = invoke(root, 'rollback', surface, p.operationId, failArtifact('rolled-back.json'));
    assert.equal(result.status, 'partial'); assert(!fs.existsSync(file(root, surface, '.json')));
    assert(fs.readFileSync(file(root, surface, '.md')).equals(raw));
    assert.equal(invoke(root, 'rollback', surface, p.operationId).ok, true);
  });
  for (const when of ['before', 'after']) test(surface + ' competing canonical ' + when + ' withdrawal is preserved', () => {
    const root = fixture(surface), p = applied(root, surface), canonical = file(root, surface, '.json');
    const prefix = hook(`const fs=require('fs'),rename=fs.renameSync;fs.renameSync=(from,to)=>{
if(String(from)===${JSON.stringify(canonical)}&&String(to).includes('withdraw-')){${when === 'before' ? "fs.writeFileSync(from,'EXTERNAL_WINNER');" : ''}
const result=rename(from,to);${when === 'after' ? "fs.writeFileSync(from,'EXTERNAL_WINNER');" : ''}return result;}return rename(from,to)};`);
    const result = invoke(root, 'rollback', surface, p.operationId, prefix);
    assert.equal(result.ok, false); assert.equal(result.status, 'partial');
    assert.equal(fs.readFileSync(canonical, 'utf8'), 'EXTERNAL_WINNER'); assert(result.recoveryReceipt);
  });
}
S.finish('memory migration failures');
