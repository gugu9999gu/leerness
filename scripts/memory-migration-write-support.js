'use strict';
const S = require('./memory-migration-test-support');
const { fs, path, assert, command, legacy, PRIVATE } = S;
const fixture = surface => S.project({ [surface + '.md']: '\ufeff' + legacy(surface).replace(/\n/g, '\r\n') });
const file = (root, surface, extension) => path.join(root, '.leerness', surface + extension);
function invoke(root, action, surface, id = null, prefix = []) {
  const args = ['memory-migration', action, surface, ...(id ? [id] : []), '--confirm', '--path', root, '--json'];
  const run = command(root, args, '', prefix), result = JSON.parse(run.stdout);
  assert.equal(run.status, result.ok ? 0 : 2, run.stderr);
  assert.equal(result.schema, 'leerness.memory-migration-write/v1');
  assert.equal(result.atomic, false); assert.equal(result.automaticRollback, false);
  assert.equal(result.crashDurability, 'unverified'); assert.equal(result.semanticCoverage, 'unknown');
  assert(!run.stdout.includes(PRIVATE)); assert(!run.stdout.includes(root)); assert(Buffer.byteLength(run.stdout) < 16384);
  if (result.retainedCanonical) assert.equal(path.isAbsolute(result.retainedCanonical), false);
  if (result.retentionDirectory) assert.equal(path.isAbsolute(result.retentionDirectory), false);
  return result;
}
function prepared(root, surface) { const r = invoke(root, 'prepare', surface); assert.equal(r.ok, true, JSON.stringify(r)); return r; }
function applied(root, surface) { const p = prepared(root, surface), r = invoke(root, 'apply', surface, p.operationId); assert.equal(r.ok, true, JSON.stringify(r)); return p; }
function hook(source) {
  const file = path.join(S.arena, `hook-${fs.readdirSync(S.arena).length}.cjs`);
  fs.writeFileSync(file, source); return ['--require', file];
}
const modulePath = name => JSON.stringify(path.resolve(__dirname, '../lib/' + name + '.js'));
module.exports = { ...S, fixture, file, invoke, prepared, applied, hook, modulePath };
