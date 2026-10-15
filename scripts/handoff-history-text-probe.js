'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-handoff-history-'));
  try {
    const env = { ...process.env, HISTORY_TEXT_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 600000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-handoff-history-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.HISTORY_TEXT_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const sample = '한글 English 日本語 中文 e\u0301 🐝 \uFFFD', oldDate = '2020-01-01T00:00:00.000Z';
const original = { last: oldDate, history: [oldDate], custom: { note: sample } }, winner = JSON.stringify({ ...original, competing: sample });
let sequence = 0, passed = 0, failed = 0;
const at = process.argv.indexOf('--match'), filter = at < 0 ? '' : process.argv[at + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
function fixture(value = JSON.stringify(original, null, 2) + '\n') {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  const f = { dir, ws, file: path.join(ws, 'last-handoff.json') };
  fs.writeFileSync(path.join(ws, 'HARNESS_VERSION'), require('../package.json').version);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"handoff-history-test","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(ws, 'manifest.json'), '{"language":"en","mode":"minimal"}');
  if (value !== null) fs.writeFileSync(f.file, value);return f;
}
function snapshot(file) { if (!fs.existsSync(file)) return null;const s = fs.statSync(file, { bigint: true });return { sha: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(s.mtimeNs) }; }
const text = p => fs.readFileSync(p, 'utf8'), data = p => JSON.parse(text(p).replace(/^\uFEFF/, ''));
const hook = path.join(arena, 'boundary-hook.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),path=require('path'),base=process.env.HISTORY_TEXT_LIB,target=process.env.HISTORY_TEXT_TARGET,mode=process.env.HISTORY_TEXT_MODE;
const write=fs.writeFileSync.bind(fs),winner=Buffer.from(process.env.HISTORY_TEXT_WINNER,'base64');let fired=false;
function inject(p){if(!fired&&p===target){fired=true;write(p,winner);}}
const locks=require(path.join(base,'state-lock')),io=require(path.join(base,'io')),read=io.read,save=io.writeUtf8;
io.read=function(p,...a){const r=read(p,...a);if(mode==='after-capture'&&locks.isStateLockHeld(p))inject(p);return r;};
io.writeUtf8=function(p,...a){if(mode==='save-error'&&p===target)throw Error('injected history save failure');return save(p,...a);};
const managed=require(path.join(base,'managed-text')),capture=managed.captureTextEdit,publish=managed.publishTextEdit;
managed.captureTextEdit=function(p,...a){if(mode==='before-capture')inject(p);if(mode==='lock-check'&&p===target)require('assert').ok(locks.isStateLockHeld(p));const r=capture(p,...a);if(mode==='after-capture')inject(p);if(mode==='remove-after'&&p===target)fs.unlinkSync(p);return r;};
managed.publishTextEdit=function(s,p,t){if(mode==='save-error'&&p===target)throw Error('injected history save failure');
if(mode==='after-save'&&p===target){const before=fs.readFileSync(p);publish(s,p,t);const backupFile=p+'.recovery';write(backupFile,before);throw Object.assign(Error('injected failure after publication'),{outputMutationStarted:true,outputPublished:true,backupFile,recoveryArtifacts:[{role:'displaced-original',path:backupFile}]});}
return publish(s,p,t);};
const lock=locks.withStateLock;locks.withStateLock=function(p,fn,...a){const r=lock(p,fn,...a);if(mode==='release-error'&&p===target)throw Object.assign(Error('injected lock release failure'),{code:'E_HISTORY_LOCK_RELEASE'});return r;};
`);
function call(f, opts = {}) {
  const args = ['handoff', f.dir, ...(opts.args || ['--writeback', '--json']), '--no-headline', '--no-lessons', '--no-workflow-guide', '--no-security-summary', '--no-mem-delta', '--no-team-reminders', '--no-env-detect'];
  const r = cp.spawnSync(process.execPath, [...(opts.mode ? ['--require', hook] : []), cli, ...args], {
    cwd: f.dir, encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: { ...process.env, LEERNESS_SESSION_ID: 'history-probe-session-0001', LEERNESS_INTERNAL: '1', LEERNESS_HOOK: '', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1', LEERNESS_NO_DRIFT_CHECK: '1', LEERNESS_LANG: 'en',
      HISTORY_TEXT_LIB: path.resolve(__dirname, '../lib'), HISTORY_TEXT_MODE: opts.mode || '', HISTORY_TEXT_TARGET: f.file, HISTORY_TEXT_WINNER: Buffer.from(opts.winner || winner).toString('base64'), ...(opts.env || {}) }
  });assert.ifError(r.error);return r;
}
function success(r) { assert.strictEqual(r.status, 0, r.stdout + r.stderr);return r; }
function failure(r) { assert.notStrictEqual(r.status, 0, 'unexpected success: ' + r.stdout.slice(0, 400) + r.stderr);assert.doesNotMatch(r.stdout, /handoff loaded/);return r; }
function unchanged(f, opts = {}) { const before = snapshot(f.file), r = failure(call(f, opts));assert.deepStrictEqual(snapshot(f.file), before);return r; }

test('repro malformed UTF-8 history is not replaced', () => { const f = fixture();fs.appendFileSync(f.file, Buffer.from([0xff]));unchanged(f); });
test('repro malformed JSON history is not reset', () => { const f = fixture('{broken');unchanged(f); });
test('repro scalar history is not silently discarded', () => { const f = fixture(JSON.stringify({ last: oldDate, history: sample }));unchanged(f); });
test('repro Unicode and unknown metadata survive a new record', () => { const f = fixture();success(call(f));assert.deepStrictEqual(data(f.file).custom, original.custom);assert.strictEqual(data(f.file).history[0], oldDate); });
test('repro a changed captured source is preserved', () => { const f = fixture();failure(call(f, { mode: 'after-capture' }));assert.strictEqual(text(f.file), winner); });
test('repro save failure is visible to the explicit caller', () => { const f = fixture();unchanged(f, { mode: 'save-error' }); });
test('repro existing BOM and CRLF are retained', () => { const f = fixture('\uFEFF' + JSON.stringify(original, null, 2).replace(/\n/g, '\r\n') + '\r\n');success(call(f));const saved = text(f.file);assert.ok(saved.startsWith('\uFEFF'));assert.ok(!saved.replace(/\r\n/g, '').includes('\n')); });
test('repro oversized source is refused without dropping data', () => { const f = fixture(JSON.stringify({ ...original, note: 'x'.repeat(4 * 1024 * 1024) }));unchanged(f); });

test('first explicit history is created in an existing project without a harness', () => { const f = fixture(null);for (const name of ['HARNESS_VERSION', 'manifest.json']) fs.unlinkSync(path.join(f.ws, name));fs.rmdirSync(f.ws);success(call(f));const saved = data(f.file);assert.strictEqual(saved.history.length, 1);assert.strictEqual(saved.last, saved.history[0]);assert.ok(Number.isFinite(Date.parse(saved.last))); });
for (const value of [{}, { last: oldDate }, { history: [] }]) test('partial legacy record can be initialized: ' + JSON.stringify(value), () => { const f = fixture(JSON.stringify(value));success(call(f));assert.strictEqual(data(f.file).history.length, 1); });
test('rolling history retains nine previous entries and the new record', () => { const history = Array.from({ length: 12 }, (_, i) => '2020-01-' + String(i + 1).padStart(2, '0') + 'T00:00:00.000Z'), f = fixture(JSON.stringify({ ...original, last: history.at(-1), history }));success(call(f, { mode: 'lock-check' }));const saved = data(f.file);assert.deepStrictEqual(saved.history.slice(0, -1), history.slice(-9));assert.strictEqual(saved.last, saved.history.at(-1));assert.deepStrictEqual(saved.custom, original.custom); });
test('nested metadata and own prototype-named property are retained', () => { const value = JSON.parse(JSON.stringify(original));value.extra = [true, null, { '한글': sample, amount: 1.25 }];Object.defineProperty(value, '__proto__', { value: { note: sample }, enumerable: true });const f = fixture(JSON.stringify(value));success(call(f));const saved = data(f.file);assert.deepStrictEqual(saved.extra, value.extra);assert.deepStrictEqual(saved.__proto__, value.__proto__); });
for (const bom of ['', '\uFEFF']) for (const eol of ['\n', '\r\n']) test('Unicode metadata and text style survive: BOM=' + !!bom + ', CRLF=' + (eol === '\r\n'), () => { const f = fixture(bom + JSON.stringify(original, null, 2).replace(/\n/g, eol) + eol);success(call(f));const saved = text(f.file);assert.strictEqual(saved.startsWith('\uFEFF'), !!bom);if (eol === '\r\n') assert.ok(!saved.replace(/\r\n/g, '').includes('\n'));else assert.ok(!saved.includes('\r'));assert.deepStrictEqual(data(f.file).custom, original.custom); });
for (const value of [null, [], 1, 'text', { history: null }, { history: [null] }, { history: ['not-a-date'] }, { last: 1 }, { last: null }]) test('invalid known shape is retained: ' + JSON.stringify(value), () => { const f = fixture(JSON.stringify(value));const r = unchanged(f);assert.strictEqual(JSON.parse(r.stdout).code, 'E_HANDOFF_HISTORY_INVALID'); });
for (const value of ['{"history":[],"note":"\\ud800"}', '{"history":[],"\\udfff":"note"}', '{"history":[],"number":1e999}']) test('metadata that cannot round-trip is refused: ' + value, () => { const f = fixture(value);unchanged(f); });
test('expanded output beyond the limit cannot replace a valid source', () => { const value = { ...original, note: '' }, base = Buffer.byteLength(JSON.stringify(value));value.note = 'x'.repeat(4 * 1024 * 1024 - base - 8);const f = fixture(JSON.stringify(value));assert.ok(fs.statSync(f.file).size < 4 * 1024 * 1024);unchanged(f); });
for (const [name, opts] of [
  ['default JSON', { args: ['--json'] }], ['default text', { args: [] }],
  ['no-record', { args: ['--writeback', '--json', '--no-record'] }], ['hook', { env: { LEERNESS_HOOK: '1' } }],
  ['pulse', { args: ['--writeback', '--pulse'] }]
]) test(name + ' leaves malformed legacy history untouched', () => { const f = fixture(Buffer.from([0xff])), before = snapshot(f.file);success(call(f, opts));assert.deepStrictEqual(snapshot(f.file), before); });
test('force does not replace malformed legacy history', () => { const f = fixture('{broken');unchanged(f, { args: ['--writeback', '--json', '--force'] }); });
test('dry-run does not write history or retain its lock', () => { const f = fixture(), before = snapshot(f.file);call(f, { args: ['--writeback', '--json', '--dry-run'] });assert.deepStrictEqual(snapshot(f.file), before);assert.ok(!fs.existsSync(f.file + '.lock')); });
test('capture uses a new valid record that won before the lock-protected read', () => { const f = fixture();success(call(f, { mode: 'before-capture' }));assert.strictEqual(data(f.file).competing, sample); });
test('a captured record removed by another writer is not recreated', () => { const f = fixture();failure(call(f, { mode: 'remove-after' }));assert.strictEqual(snapshot(f.file), null); });
test('a concurrently created record is not overwritten', () => { const f = fixture(null);failure(call(f, { mode: 'after-capture' }));assert.strictEqual(text(f.file), winner); });
test('hard-linked history and its alias are preserved', () => { const f = fixture(), alias = f.file + '.alias';fs.linkSync(f.file, alias);const before = snapshot(alias);unchanged(f);assert.deepStrictEqual(snapshot(alias), before); });
test('a directory cannot be replaced with a history file', () => { const f = fixture(null);fs.mkdirSync(f.file);failure(call(f));assert.ok(fs.statSync(f.file).isDirectory()); });
test('incompatible runtime writes are refused', () => { const f = fixture();fs.mkdirSync(path.join(f.ws, 'cache'));fs.writeFileSync(path.join(f.ws, 'cache/state-layout.json'), JSON.stringify({ schema: 'leerness.runtime-layout/v1', schemaVersion: 1, scope: 'project-local', generation: 1, layout: 'legacy', requiredWriterProtocol: 2 }));unchanged(f); });
test('failure after publication retains the saved state and recovery evidence', () => { const f = fixture(), before = fs.readFileSync(f.file), result = JSON.parse(failure(call(f, { mode: 'after-save' })).stdout);assert.strictEqual(result.phase, 'publication');assert.strictEqual(result.outputPublished, true);assert.strictEqual(result.backupFile, f.file + '.recovery');assert.deepStrictEqual(fs.readFileSync(result.backupFile), before);assert.ok(result.recoveryArtifacts.length);assert.strictEqual(data(f.file).history.length, 2); });
test('lock-release failure reports the confirmed publication', () => { const f = fixture(), result = JSON.parse(failure(call(f, { mode: 'release-error' })).stdout);assert.strictEqual(result.phase, 'lock-release');assert.strictEqual(result.outputPublished, true);assert.strictEqual(data(f.file).history.length, 2); });
test('text failure output reports the file and stage without final success', () => { const f = fixture(), r = unchanged(f, { args: ['--writeback'], mode: 'save-error' });assert.match(r.stdout, /Handoff history failure details/);assert.ok(r.stdout.includes('last-handoff.json'));assert.ok(r.stdout.includes('publication')); });
test('failed legacy write does not claim to roll back earlier session records', () => { const f = fixture();unchanged(f, { mode: 'save-error' });assert.ok(fs.existsSync(path.join(f.ws, 'cache/handoffs/history-probe-session-0001.json'))); });
test('concurrent explicit records retain both additions and metadata', () => {
  const f = fixture(), script = `const cp=require('child_process');Promise.all([1,2].map(i=>new Promise((resolve,reject)=>{const p=cp.spawn(process.execPath,[process.argv[1],'handoff',process.argv[2],'--writeback','--json','--no-env-detect'],{windowsHide:true,env:{...process.env,LEERNESS_SESSION_ID:'history-parallel-000'+i}});let out='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>out+=b);p.on('error',reject);p.on('close',n=>n?reject(Error(out)):resolve());}))).catch(e=>{console.error(e.message);process.exitCode=1;});`;
  const r = cp.spawnSync(process.execPath, ['-e', script, cli, f.dir], { encoding: 'utf8', timeout: 60000, windowsHide: true, env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_HOOK: '', LEERNESS_OFFLINE: '1', LEERNESS_NO_DRIFT_CHECK: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1' } });assert.ifError(r.error);assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const saved = data(f.file);assert.strictEqual(saved.history.length, 3);assert.strictEqual(saved.history[0], oldDate);assert.strictEqual(saved.last, saved.history.at(-1));assert.deepStrictEqual(saved.custom, original.custom);assert.ok(!fs.existsSync(f.file + '.lock'));
});

console.log('handoff-history-text-probe: ' + passed + '/' + (passed + failed) + ' passed');
if (!passed && !failed) throw Error('No selected tests');
process.exitCode = failed ? 1 : 0;
