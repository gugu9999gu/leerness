'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-handoff-text-'));
  try {
    const env = { ...process.env, HANDOFF_TEXT_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) { env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key]); }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker', ...process.argv.slice(2)], { encoding: 'utf8', timeout: 600000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if (r.error) process.stderr.write(r.error.message + '\n');
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-handoff-text-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const arena = process.env.HANDOFF_TEXT_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const sample = '한글 English 日本語 中文 e\u0301 🐝 \uFFFD';
const authored = '# Current state\r\nUpdated: 2000-01-01\r\n\r\nKeep ' + sample + '\r\nUpdated: 1999-12-31\r\n';
const winner = '# Concurrent change\nUpdated: 2001-02-03\n' + sample;
let sequence = 0, passed = 0, failed = 0;
const at = process.argv.indexOf('--match'), filter = at < 0 ? '' : process.argv[at + 1];
function test(name, fn) { if (filter && !name.includes(filter)) return;try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
function fixture() {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  const f = { dir, ws, state: path.join(ws, 'current-state.md') };
  fs.writeFileSync(path.join(ws, 'HARNESS_VERSION'), require('../package.json').version);
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"handoff-text-test","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(ws, 'manifest.json'), '{"language":"en","mode":"minimal"}');
  fs.writeFileSync(f.state, authored);return f;
}
function snapshot(file) { if (!fs.existsSync(file)) return null;const s = fs.statSync(file, { bigint: true });return { sha: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(s.mtimeNs) }; }
const text = p => fs.readFileSync(p, 'utf8');
const hook = path.join(arena, 'boundary-hook.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),cp=require('child_process'),path=require('path'),base=process.env.HANDOFF_TEXT_LIB,target=process.env.HANDOFF_TEXT_TARGET,mode=process.env.HANDOFF_TEXT_MODE;
const write=fs.writeFileSync.bind(fs),bytes=Buffer.from(process.env.HANDOFF_TEXT_WINNER,'base64');let fired=false;
const locks=require(path.join(base,'state-lock')),io=require(path.join(base,'io')),read=io.read;
const inject=p=>{if(!fired&&p===target){fired=true;write(p,bytes);}};
io.read=function(p){const result=read(p);if(mode==='after-capture'&&locks.isStateLockHeld(p))inject(p);return result;};
const mod=require(path.join(base,'managed-text')),capture=mod.captureTextEdit,publish=mod.publishTextEdit;
mod.captureTextEdit=function(p,...a){
  if(p===target&&mode==='before-capture')inject(p);
  if(p===target&&mode==='remove-before')fs.unlinkSync(p);
  if(p===target&&mode==='lock-check'&&!locks.isStateLockHeld(p))throw Error('missing canonical lock');
  const result=capture(p,...a);if(mode==='after-capture')inject(p);
  if(p===target&&mode==='remove-after')fs.unlinkSync(p);return result;
};
mod.publishTextEdit=function(s,p,t){
  if(mode==='write-failure'&&p===target)throw Error('injected publication failure');const r=publish(s,p,t);
  if(mode==='late-failure'&&p===target)throw Error('injected failure after publication');return r;
};
const rename=fs.renameSync.bind(fs);fs.renameSync=function(a,b){if(mode==='publication'&&a===target)inject(a);return rename(a,b);};
const spawn=cp.spawnSync.bind(cp);cp.spawnSync=function(a,b,o){if(o?.env?.LEERNESS_REPLACE_TO===target){if(mode==='publication')inject(target);const r=spawn(a,b,o);if(mode==='after-publication'&&r.status===0)inject(target);return r;}return spawn(a,b,o);};
const link=fs.linkSync.bind(fs);fs.linkSync=function(a,b){if(mode==='publication')inject(b);const r=link(a,b);if(mode==='after-publication')inject(b);return r;};
`);
function call(f, opts = {}) {
  const args = ['handoff', f.dir, ...(opts.args || ['--writeback']), '--no-record', '--no-headline', '--no-lessons', '--no-workflow-guide', '--no-security-summary', '--no-mem-delta', '--no-team-reminders', '--no-env-detect'];
  const r = cp.spawnSync(process.execPath, [...(opts.mode ? ['--require', hook] : []), cli, ...args], {
    cwd: f.dir, encoding: 'utf8', timeout: 45000, windowsHide: true,
    env: { ...process.env, LEERNESS_INTERNAL: '1', LEERNESS_HOOK: '', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1', LEERNESS_NO_PATH_CHECK: '1', LEERNESS_NO_DRIFT_CHECK: '1', LEERNESS_LANG: 'en',
      HANDOFF_TEXT_LIB: path.resolve(__dirname, '../lib'), HANDOFF_TEXT_MODE: opts.mode || '', HANDOFF_TEXT_TARGET: f.state, HANDOFF_TEXT_WINNER: Buffer.from(winner).toString('base64'), ...(opts.env || {}) }
  });
  assert.ifError(r.error);return r;
}
function success(r) { assert.strictEqual(r.status, 0, r.stdout + r.stderr);return r; }
function failure(r) { assert.notStrictEqual(r.status, 0, r.stdout + r.stderr);assert.doesNotMatch(r.stdout, /handoff loaded/);return r; }
function rejectUnchanged(f, opts) {
  const before = snapshot(f.state), r = call(f, opts), after = snapshot(f.state);
  if (r.status === 0) console.log('Observation: ' + JSON.stringify({ exit: r.status, changed: JSON.stringify(before) !== JSON.stringify(after) }));
  failure(r);assert.deepStrictEqual(after, before);return r;
}
test('repro malformed UTF-8 is refused without changing the original', () => {
  const f = fixture();fs.appendFileSync(f.state, Buffer.from([0xff]));const r = rejectUnchanged(f);assert.match(r.stdout + r.stderr, /invalid UTF-8/);
});
test('repro stale captured text does not overwrite another edit', () => {
  const f = fixture(), r = call(f, { mode: 'after-capture' });
  if (r.status === 0) console.log('Observation: stale source returned success; winner retained=' + (text(f.state) === winner));
  failure(r);assert.strictEqual(text(f.state), winner);
});
test('repro oversized source is refused without changing it', () => {
  const f = fixture();fs.writeFileSync(f.state, 'Updated: 2000-01-01\n' + 'x'.repeat(4 * 1024 * 1024));rejectUnchanged(f);
});
test('repro unchanged date keeps exact bytes and modification time', () => {
  const f = fixture();fs.writeFileSync(f.state, '\uFEFF' + authored.replace('2000-01-01', new Date().toISOString().slice(0, 10)));const before = snapshot(f.state);
  success(call(f));assert.deepStrictEqual(snapshot(f.state), before);
});
for (const bom of ['', '\uFEFF']) test('valid Unicode, user symbols, line endings and later dates survive: BOM=' + !!bom, () => {
  const f = fixture();fs.writeFileSync(f.state, bom + authored);success(call(f));
  assert.strictEqual(text(f.state), bom + authored.replace('2000-01-01', new Date().toISOString().slice(0, 10)));
});
for (const body of ['', '# Keep ' + sample + '\r\n']) test('no matching date leaves exact bytes and time: empty=' + !body, () => {
  const f = fixture();fs.writeFileSync(f.state, body);const before = snapshot(f.state), r = success(call(f));
  assert.deepStrictEqual(snapshot(f.state), before);assert.doesNotMatch(r.stdout, /current-state updated/);
});
for (const [label, bytes] of [['truncated UTF-8', Buffer.concat([Buffer.from(authored), Buffer.from([0xed, 0x95])])], ['UTF-16', Buffer.from('\uFEFF' + authored, 'utf16le')]]) test('reject ' + label, () => {
  const f = fixture();fs.writeFileSync(f.state, bytes);assert.match(rejectUnchanged(f).stdout, /invalid UTF-8/);
});
test('four MiB including BOM can update only its date', () => {
  const f = fixture(), prefix = '\uFEFF' + authored, body = prefix + 'x'.repeat(4 * 1024 * 1024 - Buffer.byteLength(prefix));
  fs.writeFileSync(f.state, body);success(call(f));assert.strictEqual(text(f.state), body.replace('2000-01-01', new Date().toISOString().slice(0, 10)));
});
test('missing state document stays missing without a false update claim', () => {
  const f = fixture();fs.unlinkSync(f.state);const r = success(call(f));assert.ok(!fs.existsSync(f.state));assert.doesNotMatch(r.stdout, /current-state updated/);
});
test('a change before locked capture is preserved while its first date is updated', () => {
  const f = fixture();success(call(f, { mode: 'before-capture' }));assert.strictEqual(text(f.state), winner.replace('2001-02-03', new Date().toISOString().slice(0, 10)));
});
test('a file removed before locked capture is not recreated', () => {
  const f = fixture();success(call(f, { mode: 'remove-before' }));assert.ok(!fs.existsSync(f.state));
});
test('a file removed after capture fails without resurrection', () => {
  const f = fixture();failure(call(f, { mode: 'remove-after' }));assert.ok(!fs.existsSync(f.state));
});
test('publisher failure remains nonzero and does not report completion', () => {
  const f = fixture(), r = rejectUnchanged(f, { mode: 'write-failure' });assert.match(r.stdout + r.stderr, /injected publication failure/);
});
test('failure after publication is nonzero even though the file has changed', () => {
  const f = fixture(), r = failure(call(f, { mode: 'late-failure' }));assert.match(r.stdout + r.stderr, /injected failure after publication/);
  assert.strictEqual(text(f.state), authored.replace('2000-01-01', new Date().toISOString().slice(0, 10)));
});
test('hard-linked source and its alias are preserved', () => {
  const f = fixture(), alias = path.join(f.dir, 'alias');fs.linkSync(f.state, alias);const before = snapshot(alias);rejectUnchanged(f);assert.deepStrictEqual(snapshot(alias), before);
});
function retained(dir, bytes) { return fs.readdirSync(dir, { withFileTypes: true }).some(e => { const p = path.join(dir, e.name);return e.isDirectory() ? retained(p, bytes) : e.isFile() && fs.readFileSync(p).equals(bytes); }); }
for (const mode of ['publication', 'after-publication']) test('final detected conflict retains competing content for recovery: ' + mode, () => {
  const f = fixture();failure(call(f, { mode }));assert.ok(retained(f.dir, Buffer.from(winner)));
});
test('checked source capture holds the canonical lock', () => { success(call(fixture(), { mode: 'lock-check' })); });
for (const [label, opts] of [
  ['default', { args: [] }], ['hook', { env: { LEERNESS_HOOK: '1' } }],
  ['compact', { args: ['--writeback', '--compact'] }], ['JSON', { args: ['--writeback', '--json'] }],
  ['pulse', { args: ['--writeback', '--pulse'] }]
]) test(label + ' retains existing no-date-write behavior', () => {
  const f = fixture(), before = snapshot(f.state), r = success(call(f, opts));assert.deepStrictEqual(snapshot(f.state), before);
  assert.doesNotMatch(r.stdout, /current-state updated/);if (label === 'JSON') assert.ok(JSON.parse(r.stdout).files.currentState.content.includes('2000-01-01'));
});
test('force cannot bypass damaged source validation', () => {
  const f = fixture();fs.appendFileSync(f.state, Buffer.from([0xff]));rejectUnchanged(f, { args: ['--writeback', '--force'] });
});
test('dry-run preserves every project file and modification time', () => {
  const tree = dir => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(e => [e.name, e.isDirectory() ? tree(path.join(dir, e.name)) : snapshot(path.join(dir, e.name))]);
  const f = fixture(), before = tree(f.dir);failure(call(f, { args: ['--writeback', '--dry-run'] }));assert.deepStrictEqual(tree(f.dir), before);
});
test('Korean UI selection does not rewrite multilingual body text', () => {
  const f = fixture();success(call(f, { env: { LEERNESS_LANG: 'ko' } }));assert.strictEqual(text(f.state), authored.replace('2000-01-01', new Date().toISOString().slice(0, 10)));
});
test('unchanged-date candidates still reject a concurrent edit', () => {
  const f = fixture();fs.writeFileSync(f.state, authored.replace('2000-01-01', new Date().toISOString().slice(0, 10)));
  failure(call(f, { mode: 'after-capture' }));assert.strictEqual(text(f.state), winner);
});
console.log(`Tests: ${passed}/${passed + failed} passed`);process.exitCode = failed || passed === 0 ? 1 : 0;
