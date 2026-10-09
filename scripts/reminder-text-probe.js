'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-reminder-text-'));
  try {
    const env = { ...process.env, REMINDER_TEXT_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 600000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-reminder-text-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.REMINDER_TEXT_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const sample = '한글 English 日本語 中文 e\u0301 🐝 \uFFFD', authored = '# User reminder\nKeep ' + sample + '\n', winner = authored + 'Competing edit\n';
const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 16);
const owned = body => '<!-- leerness:managed:auto sha=' + hash(body) + ' -->\n' + body;
let sequence = 0, passed = 0, failed = 0;
const at = process.argv.indexOf('--match'), filter = at < 0 ? '' : process.argv[at + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
function fixture(stale = true, reminder = authored) {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  const f = { dir, ws, file: path.join(ws, 'agent-reminders.md') };
  fs.writeFileSync(path.join(ws, 'HARNESS_VERSION'), require('../package.json').version);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"reminder-text-test","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(ws, 'manifest.json'), '{"language":"en","mode":"minimal"}');
  fs.writeFileSync(path.join(ws, 'session-handoff.md'), 'Last generated: ' + (stale ? '2000-01-01T00:00:00.000Z' : new Date().toISOString()) + '\n');
  if (reminder !== null) fs.writeFileSync(f.file, reminder);return f;
}
function snapshot(file) { if (!fs.existsSync(file)) return null;const s = fs.statSync(file, { bigint: true });return { sha: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(s.mtimeNs) }; }
const text = p => fs.readFileSync(p, 'utf8');
const hook = path.join(arena, 'boundary-hook.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),path=require('path'),base=process.env.REMINDER_TEXT_LIB,target=process.env.REMINDER_TEXT_TARGET,mode=process.env.REMINDER_TEXT_MODE;
const write=fs.writeFileSync.bind(fs),winner=Buffer.from(process.env.REMINDER_TEXT_WINNER,'base64');let fired=false;
function inject(p){if(!fired&&p===target){fired=true;write(p,winner);}}
const io=require(path.join(base,'io')),read=io.read,save=io.writeUtf8;
io.read=function(p,...a){const r=read(p,...a);if(mode==='after-capture')inject(p);return r;};
io.writeUtf8=function(p,...a){if(mode==='save-error'&&p===target)throw Error('injected reminder save failure');return save(p,...a);};
const locks=require(path.join(base,'state-lock')),lock=locks.withStateLock;
locks.withStateLock=function(p,fn,...a){const r=lock(p,fn,...a);if(mode==='release-error'&&p===target)throw Object.assign(Error('injected lock release failure'),{code:'E_REMINDER_LOCK_RELEASE'});return r;};
const input=require(path.join(base,'memory-input')),capture=input.captureCheckedFileInput,check=input.assertCheckedFileCurrent;
input.captureCheckedFileInput=function(p,...a){
if(mode==='before-capture')inject(p);
if(mode==='lock-check'&&p===target)require('assert').ok(locks.isStateLockHeld(p));
const r=capture(p,...a);if(mode==='after-capture')inject(p);return r;};
input.assertCheckedFileCurrent=function(s,p){if(mode==='before-check')inject(p);return check(s,p);};
const managed=require(path.join(base,'managed-text')),publish=managed.publishTextEdit;
managed.publishTextEdit=function(s,p,t){if(mode==='save-error'&&p===target)throw Error('injected reminder save failure');const r=publish(s,p,t);if(mode==='after-save'&&p===target)throw Object.assign(Error('injected failure after save'),{outputPublished:true,outputMutationStarted:true,backupFile:p+'.recovery',recoveryArtifacts:[{role:'test-sentinel',path:p+'.recovery'}]});return r;};
const unlink=fs.unlinkSync.bind(fs);fs.unlinkSync=function(p,...a){if(mode==='delete-error'&&p===target)throw Object.assign(Error('injected reminder delete failure'),{code:'EPERM'});const r=unlink(p,...a);if(mode==='after-delete'&&p===target)throw Error('injected failure after deletion');return r;};
const reminder=require(path.join(base,'reminder-text')),refresh=reminder.refreshReminder;
reminder.refreshReminder=function(root,body){return refresh(root,body+(mode==='bad-output'?String.fromCharCode(0xd800):mode==='large-output'?'x'.repeat(4*1024*1024):''));};
`);
function call(f, opts = {}) {
  const args = ['handoff', f.dir, ...(opts.args || ['--writeback']), '--no-record', '--no-headline', '--no-lessons', '--no-workflow-guide', '--no-security-summary', '--no-mem-delta', '--no-team-reminders', '--no-env-detect'];
  const r = cp.spawnSync(process.execPath, [...(opts.mode ? ['--require', hook] : []), cli, ...args], {
    cwd: f.dir, encoding: 'utf8', timeout: 45000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_HOOK: '', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1', LEERNESS_NO_DRIFT_CHECK: '', LEERNESS_LANG: 'en',
      REMINDER_TEXT_LIB: path.resolve(__dirname, '../lib'), REMINDER_TEXT_MODE: opts.mode || '', REMINDER_TEXT_TARGET: f.file, REMINDER_TEXT_WINNER: Buffer.from(winner).toString('base64'), ...(opts.env || {}) }
  });
  assert.ifError(r.error);return r;
}
function success(r) { assert.strictEqual(r.status, 0, r.stdout + r.stderr);return r; }
function failure(r) { assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);assert.doesNotMatch(r.stdout, /handoff loaded/);return r; }
function unchanged(f, opts, rejects = false) { const before = snapshot(f.file), r = call(f, opts);(rejects ? failure : success)(r);assert.deepStrictEqual(snapshot(f.file), before);return r; }

test('repro generation preserves authored reminders', () => { const f = fixture();unchanged(f); });
test('repro generation refuses malformed UTF-8 without saving it', () => { const f = fixture();fs.appendFileSync(f.file, Buffer.from([0xff]));unchanged(f, {}, true); });
test('repro changed generation source is preserved', () => { const f = fixture(true, owned(authored));failure(call(f, { mode: 'after-capture' }));assert.strictEqual(text(f.file), winner); });
test('repro generation failure is visible', () => { const f = fixture(true, null);unchanged(f, { mode: 'save-error' }, true); });
test('repro cleanup preserves an edited ownership header', () => { const f = fixture(false, owned(authored).replace(' -->', ' USER NOTE -->'));unchanged(f); });
test('repro cleanup retains a competing edit', () => { const f = fixture(false, owned(authored));failure(call(f, { mode: 'after-capture' }));assert.strictEqual(text(f.file), winner); });
test('repro cleanup failure is visible', () => { const f = fixture(false, owned(authored));unchanged(f, { mode: 'delete-error' }, true); });

const details = r => JSON.parse(r.stdout.split('\n').find(s => s.startsWith('Reminder storage failure details: ')).slice('Reminder storage failure details: '.length));
test('create a plain generated reminder and remove it after recovery', () => {
  const f = fixture(true, null);success(call(f, { mode: 'lock-check' }));const generated = text(f.file);
  assert.ok(require('../lib/reminder-text').isOwnedReminder(generated));assert.doesNotMatch(generated, /🔔/);
  assert.match(generated, /handoff --writeback/);fs.writeFileSync(path.join(f.ws, 'session-handoff.md'), 'Last generated: ' + new Date().toISOString());
  success(call(f, { mode: 'lock-check' }));assert.strictEqual(snapshot(f.file), null);
});
for (const stale of [true, false]) for (const [kind, value] of [
  ['appended body', owned(authored) + 'User addition\n'], ['changed body', owned(authored).replace('Keep', 'KEEP')],
  ['legacy marker', '<!-- leerness:managed:auto -->\n' + authored], ['similar marker', owned(authored).replace('auto sha=', 'automatic sha=')],
  ['empty authored file', '']
]) test((stale ? 'refresh' : 'cleanup') + ' preserves ' + kind, () => { const f = fixture(stale, value);const r = unchanged(f);assert.match(r.stdout, /Reminder preserved/); });
for (const bom of ['', '\uFEFF']) for (const eol of ['\n', '\r\n']) test('refresh retains signature and newline style: BOM=' + !!bom + ', CRLF=' + (eol === '\r\n'), () => {
  const body = authored.replace(/\n/g, eol), f = fixture(true, bom + '<!-- leerness:managed:auto sha=' + hash(body) + ' -->' + eol + body);
  success(call(f));const saved = text(f.file);assert.strictEqual(saved.startsWith('\uFEFF'), !!bom);
  assert.ok(require('../lib/reminder-text').isOwnedReminder(saved.replace(/^\uFEFF/, '')));
  if (eol === '\r\n') assert.ok(!saved.replace(/\r\n/g, '').includes('\n'));else assert.ok(!saved.includes('\r'));
});
test('same generated Unicode body does not rewrite bytes or timestamp', () => { const f = fixture(true, owned(authored)), before = snapshot(f.file);const r = require('../lib/reminder-text').refreshReminder(f.dir, authored);assert.strictEqual(r.status, 'unchanged');assert.deepStrictEqual(snapshot(f.file), before); });
test('cleanup accepts intact Unicode with signature and CRLF', () => { const body = authored.replace(/\n/g, '\r\n'), f = fixture(false, '\uFEFF<!-- leerness:managed:auto sha=' + hash(body) + ' -->\r\n' + body);success(call(f));assert.strictEqual(snapshot(f.file), null); });
test('absent cleanup does not create a reminder', () => { const f = fixture(false, null);unchanged(f); });
test('cleanup refuses malformed UTF-8', () => { const f = fixture(false, Buffer.concat([Buffer.from(owned(authored)), Buffer.from([0xff])]));unchanged(f, {}, true); });
for (const stale of [true, false]) {
  test((stale ? 'refresh' : 'cleanup') + ' refuses oversized source', () => { const f = fixture(stale, owned('x'.repeat(4 * 1024 * 1024)));unchanged(f, {}, true); });
  test((stale ? 'refresh' : 'cleanup') + ' refuses hard links and preserves the alias', () => { const f = fixture(stale, owned(authored)), alias = f.file + '.alias';fs.linkSync(f.file, alias);const before = snapshot(alias);unchanged(f, {}, true);assert.deepStrictEqual(snapshot(alias), before); });
  test((stale ? 'refresh' : 'cleanup') + ' refuses a directory target', () => { const f = fixture(stale, null);fs.mkdirSync(f.file);failure(call(f));assert.ok(fs.statSync(f.file).isDirectory()); });
  test((stale ? 'refresh' : 'cleanup') + ' preserves an edit present before capture', () => { const f = fixture(stale, owned(authored));success(call(f, { mode: 'before-capture' }));assert.strictEqual(text(f.file), winner); });
  test((stale ? 'refresh' : 'cleanup') + ' refuses a detected late source change', () => { const f = fixture(stale, owned(authored));failure(call(f, { mode: 'before-check' }));assert.strictEqual(text(f.file), winner); });
  test((stale ? 'refresh' : 'cleanup') + ' refuses incompatible runtime writes', () => { const f = fixture(stale, owned(authored));fs.mkdirSync(path.join(f.ws, 'cache'));fs.writeFileSync(path.join(f.ws, 'cache/state-layout.json'), JSON.stringify({ schema: 'leerness.runtime-layout/v1', schemaVersion: 1, scope: 'project-local', generation: 1, layout: 'legacy', requiredWriterProtocol: 2 }));unchanged(f, {}, true); });
  test((stale ? 'refresh' : 'cleanup') + ' does not mutate during dry-run', () => { const f = fixture(stale, owned(authored));const before = snapshot(f.file);call(f, { args: ['--writeback', '--dry-run'] });assert.deepStrictEqual(snapshot(f.file), before);assert.ok(!fs.existsSync(f.file + '.lock')); });
}
for (const mode of ['bad-output', 'large-output']) test('invalid generated candidate is refused: ' + mode, () => { const f = fixture(true, owned(authored));unchanged(f, { mode }, true); });
for (const [name, opts] of [['default', { args: [] }], ['JSON', { args: ['--writeback', '--json'] }], ['pulse', { args: ['--writeback', '--pulse'] }], ['hook', { env: { LEERNESS_HOOK: '1' } }], ['skip drift', { args: ['--writeback', '--no-drift-check'] }]]) {
  test(name + ' handoff leaves malformed reminders untouched', () => { const f = fixture(true, Buffer.from([0xff]));unchanged(f, opts); });
}
test('save failure details retain publication and recovery evidence', () => { const f = fixture(true, owned(authored)), r = failure(call(f, { mode: 'after-save' })), d = details(r);assert.strictEqual(d.action, 'refresh');assert.strictEqual(d.phase, 'publication');assert.strictEqual(d.outputPublished, true);assert.strictEqual(d.backupFile, f.file + '.recovery');assert.ok(d.recoveryArtifacts.length);assert.ok(require('../lib/reminder-text').isOwnedReminder(text(f.file))); });
test('uncertain deletion does not claim rollback or confirmed removal', () => { const f = fixture(false, owned(authored)), d = details(failure(call(f, { mode: 'after-delete' })));assert.strictEqual(d.phase, 'removal');assert.strictEqual(d.removalStarted, true);assert.strictEqual(d.removedConfirmed, false);assert.strictEqual(snapshot(f.file), null); });
for (const stale of [true, false]) test((stale ? 'refresh' : 'cleanup') + ' reports lock-release failure after mutation', () => { const f = fixture(stale, owned(authored)), d = details(failure(call(f, { mode: 'release-error' })));assert.strictEqual(d.phase, 'lock-release');if (stale) assert.strictEqual(d.outputPublished, true);else { assert.strictEqual(d.removedConfirmed, true);assert.strictEqual(snapshot(f.file), null); } });
test('concurrent refresh and cleanup retain a complete owned file or confirmed absence', () => {
  const f = fixture(true, owned(authored)), mod = path.resolve(__dirname, '../lib/reminder-text');
  const script = `const cp=require('child_process');const [mod,root]=process.argv.slice(1);Promise.all(['refreshReminder','cleanReminder'].map(action=>new Promise((resolve,reject)=>{const code='require(process.argv[1])[process.argv[3]](process.argv[2],process.argv[4])';const p=cp.spawn(process.execPath,['-e',code,mod,root,action,'한글 next'],{windowsHide:true});let out='';p.stderr.on('data',b=>out+=b);p.on('error',reject);p.on('close',n=>n?reject(Error(out)):resolve());}))).catch(e=>{console.error(e.message);process.exitCode=1;});`;
  const r = cp.spawnSync(process.execPath, ['-e', script, mod, f.dir], { encoding: 'utf8', timeout: 45000, windowsHide: true });assert.ifError(r.error);assert.strictEqual(r.status, 0, r.stderr);
  if (fs.existsSync(f.file)) { assert.ok(require('../lib/reminder-text').isOwnedReminder(text(f.file)));assert.match(text(f.file), /한글 next/); }
  assert.ok(!fs.existsSync(f.file + '.lock'));
});

console.log('reminder-text-probe: ' + passed + '/' + (passed + failed) + ' passed');
if (!passed && !failed) throw Error('No selected tests');
process.exitCode = failed ? 1 : 0;
