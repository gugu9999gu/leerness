'use strict';
const S = require('./memory-migration-write-support');
const { assert, fs, path, test, fixture, file, invoke, prepared, applied, snapshot, command } = S;
const { parseArguments } = require('../lib/memory-migration-write-transport');
const { _decisionsFromMd, _parseLessonEntries, _requiredTier } = require('../lib/pure-utils');
for (const surface of ['decisions', 'lessons']) {
  test(surface + ' prepare apply repeat rollback repeat preserves complete raw bytes', () => {
    const root = fixture(surface), source = file(root, surface, '.md'), original = fs.readFileSync(source);
    const originalStat = fs.statSync(source), p = prepared(root, surface), dir = path.join(root, p.retentionDirectory);
    assert.equal(p.activeMutationStarted, false); assert.equal(p.retentionVerified, true);
    assert(fs.readFileSync(source).equals(original)); assert.equal(fs.statSync(source).mtimeMs, originalStat.mtimeMs);
    assert.equal(fs.existsSync(file(root, surface, '.json')), false);
    const retained = snapshot(dir); assert(fs.readFileSync(path.join(dir, 'source.md')).equals(original));
    const a = invoke(root, 'apply', surface, p.operationId); assert.equal(a.ok, true);
    const canonical = fs.readFileSync(file(root, surface, '.json'));
    const projection = fs.readFileSync(source, 'utf8'); assert(projection.includes(p.operationId));
    const parse = surface === 'decisions' ? _decisionsFromMd : _parseLessonEntries;
    assert.deepEqual(parse(projection), JSON.parse(canonical)); assert.equal(parse(projection).length, 1);
    const after = snapshot(dir);
    for (const key of Object.keys(retained).filter(k => k !== '.')) assert.deepEqual(after[key], retained[key]);
    assert.equal(invoke(root, 'apply', surface, p.operationId).ok, true);
    const rollback = invoke(root, 'rollback', surface, p.operationId); assert.equal(rollback.ok, true);
    assert(fs.readFileSync(source).equals(original)); assert.equal(fs.existsSync(file(root, surface, '.json')), false);
    assert(fs.readFileSync(path.join(root, rollback.retainedCanonical)).equals(canonical));
    assert.equal(invoke(root, 'rollback', surface, p.operationId).ok, true);
    assert.equal(invoke(root, 'apply', surface, p.operationId).ok, false);
    assert(fs.readFileSync(path.join(dir, 'source.md')).equals(original));
  });
  for (const [label, mutate] of [
    ['source edit', (root) => fs.appendFileSync(file(root, surface, '.md'), '\nexternal')],
    ['source same bytes replaced', (root) => { const p = file(root, surface, '.md'), bytes = fs.readFileSync(p); fs.renameSync(p, p + '.old'); fs.writeFileSync(p, bytes); }],
    ['canonical appeared', (root) => fs.writeFileSync(file(root, surface, '.json'), '[]')],
    ['bundle corrupted', (root, p) => fs.appendFileSync(path.join(root, p.retentionDirectory, 'source.md'), '\nexternal')],
    ['candidate corrupted', (root, p) => fs.writeFileSync(path.join(root, p.retentionDirectory, 'canonical.json'), '[{}]')],
    ['receipt corrupted', (root, p) => fs.writeFileSync(path.join(root, p.retentionDirectory, 'prepared.json'), '{}')],
  ]) test(surface + ' apply rejects ' + label + ' without active overwrite', () => {
    const root = fixture(surface), p = prepared(root, surface); mutate(root, p);
    const before = fs.readFileSync(file(root, surface, '.md'));
    const result = invoke(root, 'apply', surface, p.operationId); assert.equal(result.ok, false);
    assert.equal(result.activeMutationStarted, false); assert(fs.readFileSync(file(root, surface, '.md')).equals(before));
  });
  for (const target of ['.json', '.md']) test(surface + ' rollback refuses external ' + target + ' edit', () => {
    const root = fixture(surface), p = applied(root, surface), changed = file(root, surface, target);
    fs.appendFileSync(changed, '\nexternal'); const before = fs.readFileSync(changed);
    const result = invoke(root, 'rollback', surface, p.operationId); assert.equal(result.ok, false);
    assert.equal(result.activeMutationStarted, false); assert(fs.readFileSync(changed).equals(before));
  });
  test(surface + ' ordinary writer can use migrated projection and retains raw link', () => {
    const root = fixture(surface);
    fs.writeFileSync(path.join(root, '.leerness/HARNESS_VERSION'), require('../package.json').version);
    const p = applied(root, surface);
    const args = surface === 'decisions' ? ['decision', 'add', 'Next', '--reason', 'fixture'] : ['lesson', 'save', 'Next', '--tag', 'fixture'];
    const run = command(root, [...args, '--path', root, '--json']); assert.equal(run.status, 0, run.stderr + run.stdout);
    assert(fs.readFileSync(file(root, surface, '.md'), 'utf8').includes(p.operationId));
    assert.equal(invoke(root, 'rollback', surface, p.operationId).ok, false);
  });
}
for (const [label, content] of [['no records', 'opaque'], ['invalid UTF8', Buffer.from([0xff])], ['over budget', 'x'.repeat(1048577)]]) {
  test('prepare rejects ' + label, () => {
    const root = S.project({ 'decisions.md': content }); const r = invoke(root, 'prepare', 'decisions');
    assert.equal(r.ok, false); assert.equal(r.activeMutationStarted, false);
    assert(fs.readFileSync(file(root, 'decisions', '.md')).equals(Buffer.from(content)));
    assert.equal(fs.existsSync(path.join(root, '.leerness/archive')), false);
  });
}
test('archive symlink fails closed before retention publication', () => {
  const root = fixture('decisions'), external = S.project();
  fs.symlinkSync(external, path.join(root, '.leerness/archive'), 'junction'); const before = snapshot(external);
  assert.equal(invoke(root, 'prepare', 'decisions').ok, false); assert.deepEqual(snapshot(external), before);
});
test('invalid and unconfirmed CLI invocations do not write', () => {
  const root = fixture('decisions'), before = snapshot(root);
  for (const args of [['prepare', 'decisions'], ['apply', 'decisions', 'x', '--confirm'], ['rollback', 'decisions'],
    ['prepare', 'decisions', '--confirm', '--force'], ['prepare', 'decisions', '--confirm', '--dry-run'],
    ['prepare', 'decisions', '--confirm', '--confirm'], ['prepare', 'decisions', '--confirm', '--path']]) {
    const r = command(root, ['memory-migration', ...args, '--json']); assert.equal(r.status, 2);
    assert.equal(JSON.parse(r.stdout).activeMutationStarted, false); assert.deepEqual(snapshot(root), before);
  }
  assert.equal(parseArguments(['apply', 'decisions', '../unsafe', '--confirm']), null);
});
test('enforced read-only policy rejects a confirmed mutation', () => {
  const root = fixture('decisions'); fs.writeFileSync(path.join(root, '.leerness/policy.json'), JSON.stringify({ enforce: true, allowedTier: 'read-only' }));
  const before = snapshot(root), r = invoke(root, 'prepare', 'decisions');
  assert.equal(r.error.code, 'migration_policy_denied'); assert.deepEqual(snapshot(root), before);
  assert.equal(_requiredTier('memory-migration prepare decisions'), 'project-write');
  assert.equal(_requiredTier('memory-migration rollback lessons'), 'project-write');
  assert.equal(_requiredTier('npx -y leerness@1.36.194 memory-migration apply decisions'), 'project-write');
  assert.equal(_requiredTier('memory-migration apply decisions && npm publish'), 'publish');
  assert.equal(_requiredTier('memory-migration rollback lessons ; git push'), 'git-write');
  assert.equal(_requiredTier('memory-migration prepare decisions ; echo finished'), 'project-write');
});
// Only apply and rollback change active files. A killed prepare touched nothing active, so its lock must stay reclaimable: the lock
// options the transport passes are what decide that, and a stub that stops before the callback shows them for each action.
for (const action of ['prepare', 'apply', 'rollback']) test(`the ${action} lock is marked kept for recovery only for apply and rollback`, () => {
  const { runMigration } = require('../lib/memory-migration-write'), root = fixture('decisions'), seen = [];
  const out = runMigration(root, action, 'decisions', action === 'prepare' ? undefined : 'a'.repeat(32),
    { authorize: () => true, withLock: (target, fn, options) => { seen.push({ target: path.basename(target), options }); return 'stopped before the callback'; } });
  assert.equal(out, 'stopped before the callback'); assert.equal(seen.length, 1); assert.equal(seen[0].target, 'decisions.json');
  assert.deepStrictEqual(seen[0].options, action === 'prepare' ? {} : { keepOnCrash: 'memory-migration' });
});
for (const action of ['apply', 'rollback']) test(`a killed ${action} keeps its lock for a person: the owner record carries the marker, writers are refused, verify reports it`, () => {
  // A prepared bundle looks the same whether or not apply began, so only the marker can keep this lock after a kill.
  const { withStateLock } = require('../lib/state-lock'), { withErrorLanguage } = require('../lib/error-language');
  const surface = 'decisions', root = fixture(surface), p = action === 'apply' ? prepared(root, surface) : applied(root, surface);
  const killer = S.hook(`const path=require('path'),out=require(${S.modulePath('memory-output')}),original=out.publishMemoryOutput;
out.publishMemoryOutput=function(t,f,b){if(path.basename(String(f))==='decisions.md')process.kill(process.pid,'SIGKILL');return original.apply(this,arguments);};`);
  const active = () => ({ json: fs.existsSync(file(root, surface, '.json')) ? fs.readFileSync(file(root, surface, '.json')) : null, md: fs.readFileSync(file(root, surface, '.md')) });
  const before = active();
  const run = S.cp.spawnSync(process.execPath, [...killer, S.entry, 'memory-migration', action, surface, p.operationId, '--confirm', '--path', root, '--json'],
    { cwd: root, encoding: 'utf8', timeout: 25000, windowsHide: true, env: { ...process.env, LEERNESS_NO_AUTOCHCP: '1' } });
  assert.equal(run.error, undefined); assert.notEqual(run.status, 0, 'the migration must have been killed: ' + run.stdout + run.stderr); assert.equal(run.stdout.trim(), '');
  const after = active();
  assert(after.md.equals(before.md), 'the kill came before the projection was written');
  if (action === 'apply') { assert.equal(before.json, null); assert(after.json && after.json.length > 0, 'apply had already created the canonical file'); }
  else assert(after.json.equals(before.json), 'rollback was stopped before it changed anything');
  const lock = file(root, surface, '.json') + '.lock', [ownerName] = fs.readdirSync(lock), ownerFile = path.join(lock, ownerName);
  const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
  assert.equal(owner.pid, run.pid); assert.equal(owner.keepOnCrash, 'memory-migration');
  const old = new Date(Date.now() - 600000); fs.utimesSync(ownerFile, old, old); fs.utimesSync(lock, old, old);   // old enough that freshness is not the reason
  let failure = null;
  try { withErrorLanguage('en', () => withStateLock(file(root, surface, '.json'), () => assert.fail('entered a lock that must stay'), { maxWaitMs: 1500 })); } catch (e) { failure = e; }
  assert(failure && failure.code === 'E_LOCK_TIMEOUT', failure && failure.stack); assert.equal(failure.lockState, 'kept-for-recovery');
  assert(/A memory migration stopped partway/.test(failure.message) && /memory-migration inspect/.test(failure.message), failure.message);
  assert(fs.existsSync(ownerFile), 'the owner record is never removed automatically');
  const verify = command(root, ['verify', root, '--json', '--language', 'en']), data = JSON.parse(verify.stdout);
  assert.equal(verify.status, 1, verify.stdout); assert.equal(data.ok, false);
  assert(data.locks.stuck.some(x => x.reason === 'kept-for-recovery' && x.path === '.leerness/decisions.json.lock' && /memory-migration inspect/.test(x.action)), verify.stdout);
  assert(data.failures.some(f => /^Stuck lock: \.leerness\/decisions\.json\.lock \(kept-for-recovery\)\./.test(f)), verify.stdout);
});
S.finish('memory migration write');
