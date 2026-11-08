'use strict';
require('./temp-cleanup').trackTemp(module);
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const source = path.resolve(process.env.LEERNESS_CLEANUP_TEST_SOURCE || path.join(__dirname, '..'));
const temp = fs.realpathSync.native(os.tmpdir());
const arena = fs.mkdtempSync(path.join(temp, 'leerness-t0356-retain-'));
const child = path.join(arena, 'child.cjs');
let sequence = 0;
fs.writeFileSync(child, String.raw`
'use strict';
const [source, root, mode] = process.argv.slice(2);
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const T = require(path.join(source, 'scripts/temp-cleanup.js'));
const S = require(path.join(source, 'scripts/memory-migration-test-support.js'));
const foreign = path.join(root, 'foreign'), target = path.join(root, 'target');
fs.mkdirSync(foreign); fs.mkdirSync(target);
fs.writeFileSync(path.join(target, 'sentinel.bin'), Buffer.from([0, 255, 1, 254]));
fs.writeFileSync(path.join(foreign, 'keep.txt'), 'foreign bytes');
const type = process.platform === 'win32' ? 'junction' : 'dir';
fs.symlinkSync(target, path.join(foreign, 'link-out'), type);
const nested = path.join(S.arena, 'nested'), link = path.join(nested, 'link-out');
fs.mkdirSync(nested); fs.symlinkSync(target, link, type);
fs.writeFileSync(path.join(S.arena, 'own.txt'), 'owned bytes');
const owned = T.ownTree(S.arena);
const snapshot = dir => {
  const out = {};
  const visit = (file, key) => {
    const s = fs.lstatSync(file, { bigint: true });
    out[key] = { dev: String(s.dev), ino: String(s.ino), mode: String(s.mode),
      bytes: s.isFile() ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null,
      link: s.isSymbolicLink() ? fs.readlinkSync(file) : null };
    if (s.isDirectory()) for (const n of fs.readdirSync(file).sort()) visit(path.join(file, n), key + '/' + n);
  };
  visit(dir, '.'); return out;
};
const before = snapshot(foreign), targetBefore = snapshot(target);
const saved = Object.fromEntries(['unlinkSync', 'rmdirSync', 'rmSync'].map(k => [k, fs[k]]));
let hit = false, retry = false;
const calls = [], logs = [];
const swap = dir => { fs.renameSync(dir, dir + '-aside'); fs.symlinkSync(foreign, dir, type); hit = true; };
if (mode === 'pre-root') swap(S.arena);
if (mode === 'pre-parent') swap(nested);
for (const [name, native] of Object.entries(saved)) fs[name] = function (file, ...args) {
  calls.push({ name, file: String(file) });
  if (mode === 'native-fallback' && name === 'unlinkSync' && file === link) throw Object.assign(new Error('synthetic Windows junction fallback'), { code: 'EPERM' });
  if (!hit && file === link && ((mode === 'native-unlink' && name === 'unlinkSync') || (mode === 'native-fallback' && name === 'rmdirSync'))) swap(nested);
  if (!hit && mode === 'native-bulk' && file === S.arena && name === 'rmSync') { fs.renameSync(S.arena, S.arena + '-aside'); fs.renameSync(foreign, S.arena); hit = true; }
  if (mode === 'native-retry' && file === S.arena && name === 'rmSync') {
    if (!retry) { retry = true; throw Object.assign(new Error('synthetic retry'), { code: 'EBUSY' }); }
    if (!hit) swap(S.arena);
  }
  return native.call(this, file, ...args);
};
let outcome = null, error = null;
try {
  if (mode === 'direct') outcome = T.removeOwnedTree(owned);
  else if (mode === 'recorded-ancestor') {
    const records = path.join(root, 'records'); fs.mkdirSync(records);
    const entries = [path.dirname(S.arena), S.arena].map(dir => { const s = fs.lstatSync(dir, { bigint: true }); return { path: dir, real: fs.realpathSync.native(dir), temp: root, dev: String(s.dev), ino: String(s.ino) }; });
    fs.writeFileSync(path.join(records, 'one.jsonl'), entries.map(x => JSON.stringify(x)).join('\n') + '\n');
    outcome = T.removeRecorded(records, { tempRoot: root });
  } else if (mode === 'runner') {
    fs.writeFileSync(path.join(root, 'leaf.cjs'), 'require(' + JSON.stringify(path.join(source, 'scripts/temp-cleanup.js')) + ').trackTemp(module); const S = require(' + JSON.stringify(path.join(source, 'scripts/memory-migration-test-support.js')) + '); S.test("leaf", () => {}); S.finish("leaf");');
    outcome = require(path.join(source, 'scripts/ci-shard.js')).runNpm('suite', { index: 1, count: 1 }, { root, scripts: { suite: 'node ./leaf.cjs' }, weights: { npm: {}, e2e: {} }, stdio: 'pipe', log: line => logs.push(line) });
  } else {
    S.test('fixture verdict', () => { if (mode === 'finish-fail') throw new Error('planned assertion failure'); });
    S.finish('retention child');
  }
} catch (e) { error = String(e.code || e.message); }
for (const [k, v] of Object.entries(saved)) fs[k] = v;
let after = null;
try { after = snapshot(foreign); } catch {}
console.log('RESULT ' + JSON.stringify({ mode, hit, retry, calls, outcome, error, before, after, targetBefore, targetAfter: snapshot(target), rootExists: fs.existsSync(S.arena), logs }));
`);
function run(mode) {
  const root = path.join(arena, 'case-' + sequence++), tmp = path.join(root, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const env = { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp };
  for (const key of Object.keys(env)) if (/^(NODE_OPTIONS|NODE_TEST_CONTEXT|LEERNESS_TEMP_RECORD|LEERNESS_CLEANUP_TEST_SOURCE)$/i.test(key)) delete env[key];
  const r = cp.spawnSync(process.execPath, [child, source, root, mode], { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(r.error, undefined); assert.equal(r.signal, null);
  assert.equal(r.status, mode === 'finish-fail' ? 1 : 0, r.stdout + r.stderr);
  const line = r.stdout.split(/\r?\n/).find(x => x.startsWith('RESULT '));
  assert(line, r.stdout + r.stderr);
  const result = JSON.parse(line.slice(7));
  console.log('OBSERVED ' + JSON.stringify({ mode, hit: result.hit, calls: result.calls, outcome: result.outcome, logs: result.logs }));
  assert.equal(result.error, null);
  assert.deepEqual(result.calls, [], 'automatic cleanup must never reach a destructive filesystem call');
  assert.deepEqual(result.after, result.before, 'foreign names, identities and bytes must survive');
  assert.deepEqual(result.targetAfter, result.targetBefore);
  assert.equal(result.rootExists, true);
  assert.equal(result.hit, mode === 'pre-root' || mode === 'pre-parent', 'pre-finish swap must occur; armed final native calls must remain uncalled');
  if (mode === 'direct') assert.deepEqual(result.outcome, { removed: false, retained: true, reason: 'automatic-cleanup-disabled' });
  else if (mode === 'recorded-ancestor') assert.deepEqual(result.outcome, { removed: 0, gone: 0, left: 2, skipped: 0 });
  else if (mode === 'runner') {
    assert.deepEqual(result.outcome.failed, []); assert.equal(result.outcome.ran, 1);
    assert(result.logs.some(x => /temp folders: 0 removed.*1 left/.test(x)), result.logs.join('\n'));
    assert(result.logs.some(x => /automatic cleanup disabled/.test(x)));
  } else if (mode === 'finish-fail') assert.match(r.stdout, /0\/1 passed; fixtures: .*\(kept\)/);
  else assert.match(r.stdout, /1\/1 passed; fixtures: .*\(retained: automatic-cleanup-disabled\)/);
}
test.after(() => {
  assert.equal(path.dirname(path.resolve(arena)), temp);
  assert(path.basename(arena).startsWith('leerness-t0356-retain-'));
  assert.equal(fs.realpathSync.native(arena), path.resolve(arena));
  require('./temp-cleanup').removeTree(arena, { recursive: true, force: true });
});
for (const mode of ['direct', 'finish-pass', 'finish-fail', 'pre-root', 'pre-parent', 'native-unlink', 'native-fallback', 'native-bulk', 'native-retry', 'recorded-ancestor', 'runner']) {
  test('automatic cleanup retains fixtures without destructive calls: ' + mode, () => run(mode));
}
