'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-env-snapshot-'));
  try {
    const env = { ...process.env, ENV_SNAPSHOT_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 600000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-env-snapshot-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.ENV_SNAPSHOT_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const sample = '한글 English 日本語 中文 e\u0301 🐝 \uFFFD';
const original = { capturedAt: '2020-01-01T00:00:00.000Z', custom: { note: sample }, os: { platform: 'prior-platform', note: sample }, node: { version: 'v0.0.0' } };
const winner = JSON.stringify({ ...original, competing: sample });
let sequence = 0, passed = 0, failed = 0;
const at = process.argv.indexOf('--match'), filter = at < 0 ? '' : process.argv[at + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
function fixture(value = JSON.stringify(original, null, 2) + '\n') {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  const f = { dir, ws, file: path.join(ws, 'environment.json') };
  fs.writeFileSync(path.join(ws, 'HARNESS_VERSION'), require('../package.json').version);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"env-snapshot-test","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(ws, 'manifest.json'), '{"language":"en","mode":"minimal"}');
  if (value !== null) fs.writeFileSync(f.file, value);return f;
}
function snapshot(file) { if (!fs.existsSync(file)) return null;const s = fs.statSync(file, { bigint: true });return { sha: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(s.mtimeNs) }; }
const text = p => fs.readFileSync(p, 'utf8'), data = p => JSON.parse(text(p).replace(/^\uFEFF/, ''));
const hook = path.join(arena, 'boundary-hook.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),path=require('path'),base=process.env.ENV_SNAPSHOT_LIB,target=process.env.ENV_SNAPSHOT_TARGET,mode=process.env.ENV_SNAPSHOT_MODE;
const write=fs.writeFileSync.bind(fs),winner=Buffer.from(process.env.ENV_SNAPSHOT_WINNER,'base64');let fired=false;
function inject(p){if(!fired&&p===target){fired=true;write(p,winner);}}
// Deterministic discovery avoids starting installed toolchains. The CLI and storage remain real.
const portable=require(path.join(base,'portable-process')),npm=require(path.join(base,'npm-process'));
const spawn=portable.spawnPortableSync,spawnNpm=npm.spawnNpmSync;
portable.spawnPortableSync=(cmd,args,...a)=>args&&['--version','-version','version'].includes(args[0])?{status:1,stdout:'',stderr:''}:spawn(cmd,args,...a);
npm.spawnNpmSync=(args,...a)=>{if(!args||args[0]!=='--version')return spawnNpm(args,...a);
if(mode==='detect-conflict')inject(target);if(mode==='detect-lock')require('assert').ok(locks.isStateLockHeld(target));
if(mode==='detect-delay')Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);
return {status:0,stdout:'10.0.0\n',stderr:''};};
npm.resolveNpmCliPath=()=>null;
if(mode==='invalid-candidate')require('os').version=()=>String.fromCharCode(0xd800);
const locks=require(path.join(base,'state-lock')),io=require(path.join(base,'io')),read=io.read,save=io.writeUtf8;
io.read=function(p,...a){const r=read(p,...a);if(mode==='after-capture')inject(p);return r;};
io.writeUtf8=function(p,...a){if(mode==='save-error'&&p===target)throw Error('injected snapshot save failure');return save(p,...a);};
const managed=require(path.join(base,'managed-text')),capture=managed.captureTextEdit,publish=managed.publishTextEdit;
managed.captureTextEdit=function(p,...a){if(mode==='before-capture')inject(p);if(mode==='lock-check'&&p===target)require('assert').ok(locks.isStateLockHeld(p));const r=capture(p,...a);if(['after-capture','capture-only-conflict'].includes(mode))inject(p);if(mode==='remove-after'&&p===target)fs.unlinkSync(p);return r;};
managed.publishTextEdit=function(s,p,t){if(mode==='save-error'&&p===target)throw Error('injected snapshot save failure');
if(mode==='after-save'&&p===target){const before=fs.readFileSync(p);publish(s,p,t);const backupFile=p+'.recovery';write(backupFile,before);throw Object.assign(Error('injected failure after publication'),{outputMutationStarted:true,outputPublished:true,backupFile,recoveryArtifacts:[{role:'displaced-original',path:backupFile}]});}
return publish(s,p,t);};
const lock=locks.withStateLock;locks.withStateLock=function(p,fn,...a){const r=lock(p,fn,...a);if(mode==='release-error'&&p===target)throw Object.assign(Error('injected lock release failure'),{code:'E_ENV_LOCK_RELEASE'});return r;};
`);
function invocation(f, opts = {}) {
  const args = opts.handoff ? ['handoff', f.dir, ...(opts.args || ['--writeback']), '--no-record', '--no-headline', '--no-lessons', '--no-workflow-guide', '--no-security-summary', '--no-mem-delta', '--no-team-reminders'] : ['env', 'detect', f.dir, ...(opts.args || ['--json'])];
  return { args: ['--require', hook, cli, ...args], options: {
    cwd: f.dir, encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_HOOK: '', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1', LEERNESS_NO_DRIFT_CHECK: '1', LEERNESS_LANG: 'en', LEERNESS_NO_ENV_DETECT: '',
      ENV_SNAPSHOT_LIB: path.resolve(__dirname, '../lib'), ENV_SNAPSHOT_MODE: opts.mode || '', ENV_SNAPSHOT_TARGET: f.file, ENV_SNAPSHOT_WINNER: Buffer.from(opts.winner || winner).toString('base64'), ...(opts.env || {}) }
  } };
}
function call(f, opts = {}) { const config = invocation(f, opts), r = cp.spawnSync(process.execPath, config.args, config.options);assert.ifError(r.error);return r; }
function success(r) { assert.strictEqual(r.status, 0, r.stdout + r.stderr);return r; }
function failure(r) { assert.notStrictEqual(r.status, 0, 'unexpected success: ' + r.stdout.slice(0, 400) + r.stderr);assert.doesNotMatch(r.stdout + r.stderr, /runtime_layout_incompatible/);return r; }
function unchanged(f, opts = {}) { const before = snapshot(f.file), r = failure(call(f, opts));assert.deepStrictEqual(snapshot(f.file), before);return r; }

test('repro malformed UTF-8 snapshot is not replaced', () => { const f = fixture();fs.appendFileSync(f.file, Buffer.from([0xff]));unchanged(f); });
test('repro malformed JSON snapshot is not reset', () => { unchanged(fixture('{broken')); });
test('repro incompatible known section is not silently discarded', () => { unchanged(fixture(JSON.stringify({ ...original, os: sample }))); });
test('repro Unicode and unknown nested metadata survive refresh', () => { const f = fixture();success(call(f));assert.deepStrictEqual(data(f.file).custom, original.custom);assert.strictEqual(data(f.file).os.note, sample); });
test('repro a changed captured source is preserved', () => { const f = fixture();failure(call(f, { mode: 'after-capture' }));assert.strictEqual(text(f.file), winner); });
test('repro full handoff save failure is visible', () => { unchanged(fixture(), { handoff: true, mode: 'save-error' }); });
test('repro existing BOM and CRLF are retained', () => { const f = fixture('\uFEFF' + JSON.stringify(original, null, 2).replace(/\n/g, '\r\n') + '\r\n');success(call(f));const saved = text(f.file);assert.ok(saved.startsWith('\uFEFF'));assert.ok(!saved.replace(/\r\n/g, '').includes('\n')); });
test('repro oversized source is refused without dropping data', () => { unchanged(fixture(JSON.stringify({ ...original, note: 'x'.repeat(4 * 1024 * 1024) }))); });

test('first snapshot initializes an existing project without a harness', () => {
  const f = fixture(null);for (const name of ['HARNESS_VERSION', 'manifest.json']) fs.unlinkSync(path.join(f.ws, name));fs.rmdirSync(f.ws);
  const r = JSON.parse(success(call(f)).stdout);assert.strictEqual(r.persisted, true);assert.strictEqual(r.diff.firstCapture, true);assert.deepStrictEqual(data(f.file), r.snapshot);
});
test('empty legacy object accepts generated fields', () => { const f = fixture('{}');success(call(f));assert.strictEqual(data(f.file).node.version, process.version); });
for (const [name, value] of [
  ['array root', '[]'], ['null root', 'null'], ['string root', '"legacy"'], ['bad date', '{"capturedAt":"not-a-date"}'],
  ['non-finite metadata', '{"extra":1e400}'], ['unpaired metadata', '{"extra":"\\ud800"}'], ['unpaired key', '{"\\ud800":1}'],
  ['null section', '{"node":null}'], ['wrong generated type', '{"hardware":{"cpuCount":"twenty"}}'],
  ['scalar tools', '{"tools":"legacy"}'], ['array tool', '{"tools":{"npm":[]}}'], ['scalar dependencies', '{"scriptDependencies":{}}'],
  ['incomplete dependency', '{"scriptDependencies":[{"command":"npm"}]}'],
  ['ambiguous dependencies', JSON.stringify({ scriptDependencies: [{ command: 'npm', usedBy: 'test', foundInPath: true }, { command: 'npm', usedBy: 'test', foundInPath: false }] })]
]) test('invalid ' + name + ' is retained with actionable failure', () => { const f = fixture(value), r = JSON.parse(unchanged(f).stdout);assert.strictEqual(r.file, f.file);assert.ok(['parse', 'read'].includes(r.phase));assert.strictEqual(r.ok, false); });
test('invalid generated Unicode is refused before publication', () => { const f = fixture(), r = JSON.parse(unchanged(f, { mode: 'invalid-candidate' }).stdout);assert.strictEqual(r.phase, 'detect'); });
test('format expansion beyond the output limit preserves the source', () => {
  const f = fixture(JSON.stringify({ ...original, metadata: Array(170000).fill({ note: 'unchanged' }) }));
  assert.ok(fs.statSync(f.file).size < 4 * 1024 * 1024);const r = JSON.parse(unchanged(f).stdout);assert.strictEqual(r.code, 'E_TEXT_LIMIT');
});
test('current nested tool and dependency notes survive generated refresh', () => {
  const f = fixture(JSON.stringify({ ...original, tools: { npm: { version: '1.0.0', path: null, note: sample } }, scriptDependencies: [{ command: 'npm', usedBy: 'test', foundInPath: false, note: sample }] }));
  fs.writeFileSync(path.join(f.dir, 'package.json'), '{"scripts":{"test":"npm --version"}}');success(call(f));const saved = data(f.file);
  assert.strictEqual(saved.tools.npm.note, sample);assert.strictEqual(saved.tools.npm.version, '10.0.0');assert.strictEqual(saved.scriptDependencies[0].note, sample);assert.strictEqual(saved.scriptDependencies[0].foundInPath, true);
});
test('absent unannotated generated tools and dependencies are removed', () => {
  const f = fixture(JSON.stringify({ tools: { missing: { version: '1', path: null } }, scriptDependencies: [{ command: 'gone', usedBy: 'test', foundInPath: true }] }));
  success(call(f));assert.strictEqual(data(f.file).tools.missing, undefined);assert.deepStrictEqual(data(f.file).scriptDependencies, []);
});
for (const previous of [
  { tools: { missing: { version: '1', note: sample } } },
  { scriptDependencies: [{ command: 'gone', usedBy: 'test', foundInPath: true, note: sample }] }
]) test('absent annotated entry is preserved: ' + Object.keys(previous)[0], () => { const f = fixture(JSON.stringify(previous)), r = JSON.parse(unchanged(f).stdout);assert.strictEqual(r.phase, 'candidate');assert.match(r.error, /move its notes/); });
test('own prototype-named metadata remains data', () => { const f = fixture('{"__proto__":{"note":"retained"},"os":{"__proto__":{"note":"nested"}}}');success(call(f));assert.deepStrictEqual(data(f.file).__proto__, { note: 'retained' });assert.deepStrictEqual(data(f.file).os.__proto__, { note: 'nested' });assert.strictEqual({}.note, undefined); });
test('the canonical lock covers capture and actual discovery', () => { success(call(fixture(), { mode: 'lock-check' }));success(call(fixture(), { mode: 'detect-lock' })); });
test('latest source present before capture supplies preserved metadata', () => { const f = fixture();success(call(f, { mode: 'before-capture' }));assert.strictEqual(data(f.file).competing, sample); });
test('source changes during discovery are retained', () => { const f = fixture();failure(call(f, { mode: 'detect-conflict' }));assert.strictEqual(text(f.file), winner); });
test('a source removed after capture is not recreated', () => { const f = fixture();failure(call(f, { mode: 'remove-after' }));assert.strictEqual(fs.existsSync(f.file), false); });
test('explicit save failure reports the exact file and publication phase', () => { const f = fixture(), r = JSON.parse(unchanged(f, { mode: 'save-error' }).stdout);assert.strictEqual(r.file, f.file);assert.strictEqual(r.phase, 'publication');assert.strictEqual(r.persisted, undefined); });
test('failure after publication retains saved state and recovery evidence', () => { const f = fixture(), r = JSON.parse(failure(call(f, { mode: 'after-save' })).stdout);assert.strictEqual(r.outputPublished, true);assert.strictEqual(r.outputMutationStarted, true);assert.deepStrictEqual(data(r.backupFile), original);assert.strictEqual(data(f.file).node.version, process.version);assert.strictEqual(r.recoveryArtifacts[0].path, r.backupFile); });
test('lock release failure reports an already confirmed save', () => { const f = fixture(), r = JSON.parse(failure(call(f, { mode: 'release-error' })).stdout);assert.strictEqual(r.phase, 'lock-release');assert.strictEqual(r.outputPublished, true);assert.strictEqual(data(f.file).node.version, process.version); });
test('human explicit failure includes file, phase and no saved claim', () => { const f = fixture(), r = unchanged(f, { args: [], mode: 'save-error' });assert.match(r.stdout, /Environment snapshot failure details/);assert.match(r.stdout, /"phase":"publication"/);assert.doesNotMatch(r.stdout, /갱신됨/); });
test('full handoff refresh preserves metadata', () => { const f = fixture();success(call(f, { handoff: true }));assert.strictEqual(data(f.file).os.note, sample);assert.strictEqual(data(f.file).node.version, process.version); });
test('full handoff first capture initializes a missing snapshot', () => { const f = fixture(null);success(call(f, { handoff: true }));assert.ok(data(f.file).capturedAt); });
test('full handoff malformed source is retained and reported', () => { const f = fixture('{broken'), r = unchanged(f, { handoff: true });assert.match(r.stdout, /"phase":"parse"/); });
test('full handoff rejects a conflict after its captured read', () => { const f = fixture();failure(call(f, { handoff: true, mode: 'capture-only-conflict' }));assert.strictEqual(text(f.file), winner); });
test('unchanged handoff keeps snapshot bytes and modification time', () => { const f = fixture();success(call(f));const before = snapshot(f.file);success(call(f, { handoff: true }));assert.deepStrictEqual(snapshot(f.file), before); });
test('unchanged handoff still checks its captured source', () => { const f = fixture();success(call(f));const competing = JSON.stringify({ ...data(f.file), competing: sample });failure(call(f, { handoff: true, mode: 'capture-only-conflict', winner: competing }));assert.strictEqual(text(f.file), competing); });
test('missing script tools still persist the snapshot and return failure', () => { const f = fixture();fs.writeFileSync(path.join(f.dir, 'package.json'), '{"scripts":{"test":"leernessnonexistenttoolxyz"}}');const r = JSON.parse(failure(call(f)).stdout);assert.strictEqual(r.persisted, true);assert.strictEqual(r.diff.missing[0].command, 'leernessnonexistenttoolxyz');assert.strictEqual(data(f.file).scriptDependencies[0].foundInPath, false); });
test('read-only explicit detection retains a malformed snapshot', () => { const f = fixture('{broken'), before = snapshot(f.file);const r = JSON.parse(success(call(f, { args: ['--no-write', '--json'] })).stdout);assert.strictEqual(r.persisted, false);assert.deepStrictEqual(snapshot(f.file), before);assert.strictEqual(fs.existsSync(f.file + '.lock'), false); });
for (const args of [[], ['--writeback', '--json'], ['--writeback', '--compact'], ['--writeback', '--quiet'], ['--writeback', '--pulse'], ['--writeback', '--no-env-detect']]) test('handoff gate leaves environment bytes unchanged: ' + JSON.stringify(args), () => { const f = fixture(), before = snapshot(f.file);success(call(f, { handoff: true, args }));assert.deepStrictEqual(snapshot(f.file), before); });
for (const env of [{ LEERNESS_HOOK: '1' }, { LEERNESS_NO_ENV_DETECT: '1' }]) test('handoff environment gate remains: ' + Object.keys(env)[0], () => { const f = fixture(), before = snapshot(f.file);success(call(f, { handoff: true, env }));assert.deepStrictEqual(snapshot(f.file), before); });
test('concurrent CLI saves compare the previous committed snapshot', () => {
  const f = fixture(null), config = invocation(f, { mode: 'detect-delay' });
  const runner = String.raw`const cp=require('child_process'),cfg=JSON.parse(process.argv[1]);
  Promise.all([1,2].map(()=>new Promise((resolve,reject)=>{const c=cp.spawn(process.execPath,cfg.args,cfg.options);let out='',err='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>err+=d);c.on('error',reject);c.on('close',status=>resolve({status,stdout:out,stderr:err}));}))).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});`;
  const r = cp.spawnSync(process.execPath, ['-e', runner, JSON.stringify(config)], { encoding: 'utf8', timeout: 60000, windowsHide: true });assert.ifError(r.error);success(r);
  const outputs = JSON.parse(r.stdout).map(result => JSON.parse(success(result).stdout));
  assert.deepStrictEqual(outputs.map(value => value.diff.firstCapture).sort(), [false, true]);
  const saved = data(f.file);assert.strictEqual(saved.capturedAt, outputs.map(value => value.snapshot.capturedAt).sort().at(-1));
});

console.log('Environment snapshot text: ' + passed + '/' + (passed + failed) + ' passed');
process.exitCode = failed ? 1 : 0;
