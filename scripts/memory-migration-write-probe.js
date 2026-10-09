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
S.finish('memory migration write');
