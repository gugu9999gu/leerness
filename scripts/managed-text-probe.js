'use strict';
require('./temp-cleanup').trackTemp(module); // T-0357: records this run's temp folders; the runner that started it removes them after a clean exit
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { createHash } = require('crypto');
const { removeTree } = require('./temp-cleanup');
if (!process.argv.includes('--worker')) {
  const arena = fs.mkdtempSync(path.join(os.tmpdir(), 'leerness-managed-text-'));
  try {
    const env = { ...process.env, MANAGED_TEXT_PROBE_ROOT: arena };
    for (const key of ['HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP']) {
      env[key] = path.join(arena, key.toLowerCase());fs.mkdirSync(env[key], { recursive: true });
    }
    const r = cp.spawnSync(process.execPath, [__filename, '--worker'], { encoding: 'utf8', timeout: 150000, windowsHide: true, env });
    process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');
    if (r.error) process.stderr.write(r.error.message + '\n');
    if (r.status !== 0) process.stderr.write(`Worker exit: ${r.status}; signal: ${r.signal || 'none'}\n`);
    process.exitCode = r.status === 0 && !r.error ? 0 : 1;
  } finally {
    const resolved = fs.realpathSync(arena);assert.strictEqual(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('leerness-managed-text-'));removeTree(resolved, { recursive: true, force: true });
  }
  return;
}
const { captureTextEdit, publishTextEdit, MAX_TEXT_BYTES } = require('../lib/managed-text');
const { withStateLock } = require('../lib/state-lock');
const io = require('../lib/io');
const arena = process.env.MANAGED_TEXT_PROBE_ROOT, cli = path.resolve(__dirname, '../bin/leerness.js');
const sample = '한글 English 日本語 中文 🐝 e\u0301 \uFFFD \u0081\u009F';
// Existing table cells replace control characters with spaces; raw storage does not.
const renderedSample = '한글 English 日本語 中文 🐝 e\u0301 \uFFFD   ';
const header = '# Progress Tracker\n\n| ID | Status | Request | Evidence | Next Action | Updated |\n|---|---|---|---|---|---|\n';
const original = header + `| T-0001 | planned | ${sample} | source | 다음 | 2026-09-21 |\n\n사용자 메모: ${sample}\n`;
let sequence = 0, passed = 0, failed = 0;
function test(name, fn) { try { fn();passed++;console.log('PASS ' + name); } catch (e) { failed++;console.error('FAIL ' + name + ': ' + e.stack); } }
function state(file) { const s = fs.statSync(file, { bigint: true });return { sha: createHash('sha256').update(fs.readFileSync(file)).digest('hex'), mtime: String(s.mtimeNs), size: String(s.size) }; }
function fixture(bytes = original) {
  const dir = path.join(arena, (++sequence) + '-한글 project'), ws = path.join(dir, '.leerness');fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'HARNESS_VERSION'), require('../package.json').version);
  fs.writeFileSync(path.join(ws, 'LANGUAGE'), 'en');fs.writeFileSync(path.join(ws, 'plan.md'), '# Plan\n');
  const file = path.join(ws, 'progress-tracker.md');if (bytes !== null) fs.writeFileSync(file, bytes);
  return { dir, ws, file };
}
const lock = (f, fn) => withStateLock(f.file, fn);
function code(fn, expected) { let got;try { fn(); } catch (e) { got = e; }assert.ok(got, 'expected rejection');if (expected) assert.ok(expected.test(got.code || ''), `${got.code}: ${got.message}`);return got; }
function call(f, args, mode) {
  const result = cp.spawnSync(process.execPath, [...(mode ? ['--require', hook] : []), cli, ...args, '--path', f.dir, '--json'], {
    cwd: f.dir, encoding: 'utf8', timeout: 30000, windowsHide: true, env: { ...process.env,
      LEERNESS_INTERNAL: '1', LEERNESS_OFFLINE: '1', LEERNESS_NO_AUTOCHCP: '1', LEERNESS_NO_STALE_CHECK: '1',
      TEXT_TEST_TARGET: f.file, TEXT_TEST_MODE: mode || '', TEXT_TEST_MODULE: path.resolve(__dirname, '../lib/managed-text.js'),
      TEXT_TEST_WINNER: Buffer.from(original + '\ncompeting content\n').toString('base64') },
  });
  assert.ifError(result.error);return result;
}
const add = f => call(f, ['task', 'add', '추가 항목', '--status', 'planned', '--no-review']);
function success(r) { assert.strictEqual(r.status, 0, r.stdout + r.stderr); }
function retained(dir, bytes) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name);if (e.isDirectory() && retained(p, bytes)) return true;if (e.isFile() && fs.readFileSync(p).equals(bytes)) return true; }return false; }
const hook = path.join(arena, 'boundary-hook.cjs');
fs.writeFileSync(hook, String.raw`
const fs=require('fs'),cp=require('child_process'),target=process.env.TEXT_TEST_TARGET,mode=process.env.TEXT_TEST_MODE;
const bytes=Buffer.from(process.env.TEXT_TEST_WINNER,'base64'),write=fs.writeFileSync.bind(fs);let fired=false;
const inject=p=>{if(!fired&&p===target){fired=true;write(p,bytes);}};
if(mode==='after-capture') { const mod=require(process.env.TEXT_TEST_MODULE),capture=mod.captureTextEdit;mod.captureTextEdit=function(p){const result=capture(p);inject(p);return result;}; }
const rename=fs.renameSync.bind(fs);fs.renameSync=function(a,b){if(mode==='publication'&&a===target)inject(a);return rename(a,b);};
const spawn=cp.spawnSync.bind(cp);cp.spawnSync=function(a,b,o){if(o?.env?.LEERNESS_REPLACE_TO===target){if(mode==='publication')inject(target);const r=spawn(a,b,o);if(mode==='after-publication'&&r.status===0)inject(target);return r;}return spawn(a,b,o);};
const link=fs.linkSync.bind(fs);fs.linkSync=function(a,b){const r=link(a,b);if(mode==='after-publication')inject(b);return r;};
`);

test('capture and publish require the existing file lock', () => {
  const f = fixture();code(() => captureTextEdit(f.file), /^E_TEXT_LOCK$/);let edit;lock(f, () => { edit = captureTextEdit(f.file); });code(() => publishTextEdit(edit, f.file, 'new'), /^E_TEXT_LOCK$/);
});
test('valid Unicode and suspicious but valid text remain exact', () => {
  const f = fixture(sample);lock(f, () => { const e = captureTextEdit(f.file);assert.strictEqual(e.text, sample);publishTextEdit(e, f.file, sample + '\n다음'); });assert.strictEqual(fs.readFileSync(f.file, 'utf8'), sample + '\n다음');
});
test('unchanged text preserves exact bytes and modification time', () => {
  const f = fixture(sample), before = state(f.file);lock(f, () => { const e = captureTextEdit(f.file);assert.strictEqual(publishTextEdit(e, f.file, e.text).unchanged, true); });assert.deepStrictEqual(state(f.file), before);
});
test('existing UTF-8 signature and a literal leading BOM remain distinct', () => {
  for (const prefix of ['\uFEFF', '\uFEFF\uFEFF']) { const f = fixture(prefix + sample);lock(f, () => { const e = captureTextEdit(f.file);publishTextEdit(e, f.file, e.text + '\nnext'); });assert.deepStrictEqual(fs.readFileSync(f.file), Buffer.from(prefix + sample + '\nnext')); }
});
test('raw edit preserves mixed line endings without Unicode normalization', () => {
  const text = sample + '\r\nnext\nlast\r';const f = fixture(text);lock(f, () => { const e = captureTextEdit(f.file);publishTextEdit(e, f.file, e.text + 'end'); });assert.strictEqual(fs.readFileSync(f.file, 'utf8'), text + 'end');
});
test('absent file uses checked creation and exact bytes', () => {
  const f = fixture(null);lock(f, () => { const e = captureTextEdit(f.file);assert.strictEqual(e.exists, false);publishTextEdit(e, f.file, sample); });assert.strictEqual(fs.readFileSync(f.file, 'utf8'), sample);
});
test('invalid UTF-8 and UTF-16 source are preserved before any publication', () => {
  for (const b of [[0xff], [0xe3, 0x81], [0xed, 0xa0, 0x80], [0xff, 0xfe, 0x61, 0]]) { const f = fixture(Buffer.from(b)), before = state(f.file);lock(f, () => code(() => captureTextEdit(f.file), /^E_TEXT_ENCODING$/));assert.deepStrictEqual(state(f.file), before); }
});
test('unpaired surrogates are rejected while valid pairs remain accepted', () => {
  const f = fixture(sample), before = state(f.file);lock(f, () => { const e = captureTextEdit(f.file);for (const value of ['\uD800', '\uDC00', 'x\uD800z', '🐝\uDFFF']) code(() => publishTextEdit(e, f.file, value), /^E_TEXT_ENCODING$/);assert.deepStrictEqual(state(f.file), before);publishTextEdit(e, f.file, 'valid 🐝'); });assert.strictEqual(fs.readFileSync(f.file, 'utf8'), 'valid 🐝');
});
test('non-string candidates are rejected without implicit conversion', () => {
  const f = fixture(), before = state(f.file);lock(f, () => { const e = captureTextEdit(f.file);for (const v of [Buffer.from([0xff]), null, {}, 12]) code(() => publishTextEdit(e, f.file, v), /^E_TEXT_TYPE$/); });assert.deepStrictEqual(state(f.file), before);
});
test('input above the selected byte limit is not admitted or truncated', () => {
  const f = fixture(Buffer.alloc(MAX_TEXT_BYTES + 1, 65)), before = state(f.file);lock(f, () => code(() => captureTextEdit(f.file), /^E_STORE_LIMIT$/));assert.deepStrictEqual(state(f.file), before);
});
test('output limit includes a retained UTF-8 signature', () => {
  const f = fixture('\uFEFFsource'), before = state(f.file);lock(f, () => { const e = captureTextEdit(f.file);code(() => publishTextEdit(e, f.file, 'a'.repeat(MAX_TEXT_BYTES - 2)), /^E_TEXT_LIMIT$/); });assert.deepStrictEqual(state(f.file), before);
});
test('exact output limit is admitted and reread', () => {
  const f = fixture('old'), value = 'a'.repeat(MAX_TEXT_BYTES);lock(f, () => publishTextEdit(captureTextEdit(f.file), f.file, value));assert.deepStrictEqual(fs.readFileSync(f.file), Buffer.from(value));
});
test('forged and wrong-path snapshots cannot authorize a write', () => {
  const a = fixture(), b = fixture();lock(a, () => { const e = captureTextEdit(a.file);code(() => publishTextEdit({ ...e }, a.file, 'new'), /^E_TEXT_SNAPSHOT$/);code(() => publishTextEdit(e, b.file, 'new'), /^E_TEXT_SNAPSHOT$/);assert.ok(Object.isFrozen(e)); });
});
test('successful and no-op snapshots are single use', () => {
  for (const changed of [false, true]) { const f = fixture();lock(f, () => { const e = captureTextEdit(f.file);publishTextEdit(e, f.file, changed ? sample : e.text);code(() => publishTextEdit(e, f.file, 'another'), /^E_TEXT_SNAPSHOT$/); }); }
});
test('stale bytes and same-byte inode replacement are rejected', () => {
  for (const replace of [false, true]) { const f = fixture();lock(f, () => { const e = captureTextEdit(f.file);if (replace) { const other = f.file + '.other';fs.writeFileSync(other, original);fs.renameSync(other, f.file); } else fs.writeFileSync(f.file, 'winner');const before = state(f.file);code(() => publishTextEdit(e, f.file, 'loser'), /^E_STORE_CHANGED$/);assert.deepStrictEqual(state(f.file), before); }); }
});
test('a file appearing after absent capture is preserved', () => {
  const f = fixture(null);lock(f, () => { const e = captureTextEdit(f.file);fs.writeFileSync(f.file, 'winner');code(() => publishTextEdit(e, f.file, 'loser'), /^E_STORE_CHANGED$/); });assert.strictEqual(fs.readFileSync(f.file, 'utf8'), 'winner');
});
test('hard-linked files and linked parent directories are rejected', () => {
  const f = fixture(), alias = f.file + '.alias';fs.linkSync(f.file, alias);lock(f, () => code(() => captureTextEdit(f.file), /^E_STORE_INVALID$/));assert.deepStrictEqual(fs.readFileSync(alias), Buffer.from(original));
  const g = fixture(), linked = path.join(g.dir, 'linked');fs.symlinkSync(g.ws, linked, process.platform === 'win32' ? 'junction' : 'dir');const p = path.join(linked, 'progress-tracker.md');withStateLock(p, () => code(() => captureTextEdit(p), /^E_STORE_INVALID$/));
});
test('descriptor read and close failures cannot become successful capture', () => {
  for (const method of ['readSync', 'closeSync']) { const f = fixture(), before = state(f.file);lock(f, () => { const native = fs[method];fs[method] = function (...args) { if (method === 'closeSync') native.apply(fs, args);throw Object.assign(new Error('private-detail'), { code: 'EIO' }); };try { const e = code(() => captureTextEdit(f.file), /^E_STORE_UNREADABLE$/);assert.ok(!e.message.includes('private-detail')); } finally { fs[method] = native; } });assert.deepStrictEqual(state(f.file), before); }
});
test('dry-run publication is rejected without changing the source', () => {
  const f = fixture(), before = state(f.file);lock(f, () => { const e = captureTextEdit(f.file);io.setDryRunGuard(true);try { code(() => publishTextEdit(e, f.file, 'new'), /E_DRY_RUN_WRITE|E_OUTPUT_CHANGED/); } finally { io.setDryRunGuard(false); } });assert.deepStrictEqual(state(f.file), before);
});
test('publication failure preserves the predecessor and consumes the attempt', () => {
  const f = fixture(), before = state(f.file);lock(f, () => { const e = captureTextEdit(f.file), spawn = cp.spawnSync, link = fs.linkSync;
    if (process.platform === 'win32') cp.spawnSync = (a, b, opts) => opts?.env?.LEERNESS_REPLACE_TO ? { status: 1, stderr: 'LEERNESS_REPLACE_ERROR:5:denied' } : spawn(a, b, opts);
    else fs.linkSync = () => { throw Object.assign(new Error('denied'), { code: 'ENOTSUP' }); };
    try { code(() => publishTextEdit(e, f.file, 'new'), /^E_OUTPUT_/);code(() => publishTextEdit(e, f.file, 'retry'), /^E_TEXT_SNAPSHOT$/); } finally { cp.spawnSync = spawn;fs.linkSync = link; }
  });assert.deepStrictEqual(state(f.file), before);
});
test('real CLI add and update preserve multilingual cells and suffix', () => {
  const f = fixture();success(add(f));success(call(f, ['task', 'update', 'T-0001', '--next', sample]));const text = fs.readFileSync(f.file, 'utf8');assert.ok(text.includes(sample));assert.ok(text.includes('사용자 메모: ' + sample));assert.ok(text.includes('추가 항목'));
});
test('real CLI retains an existing BOM and its table rendering policy', () => {
  const f = fixture('\uFEFF' + original.replace(/\n/g, '\r\n'));success(add(f));const bytes = fs.readFileSync(f.file);assert.ok(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));assert.ok(bytes.toString('utf8').includes(sample));
});
test('real CLI rejects malformed tracker without repairing or changing it', () => {
  for (const suffix of [Buffer.from([0xff]), Buffer.from([0xe3, 0x81])]) { const f = fixture(Buffer.concat([Buffer.from(original), suffix])), before = state(f.file), r = add(f);assert.notStrictEqual(r.status, 0);assert.deepStrictEqual(state(f.file), before);assert.ok(!r.stdout.includes('"ok":true')); }
});
test('existing malformed-row loss guard remains enforced', () => {
  const f = fixture(original + '| T-0009 | broken |\n'), before = state(f.file);assert.notStrictEqual(add(f).status, 0);assert.deepStrictEqual(state(f.file), before);
});
test('real CLI detects a change after captured parsing input', () => {
  const f = fixture(), r = call(f, ['task', 'add', 'new', '--no-review'], 'after-capture');assert.notStrictEqual(r.status, 0);assert.deepStrictEqual(fs.readFileSync(f.file), Buffer.from(original + '\ncompeting content\n'));
});
test('real CLI final publication race retains competing bytes without success', () => {
  const f = fixture(), r = call(f, ['task', 'add', 'new', '--no-review'], 'publication');assert.notStrictEqual(r.status, 0);assert.ok(retained(f.dir, Buffer.from(original + '\ncompeting content\n')));
});
test('real CLI observes target tampering after publication instead of success', () => {
  const f = fixture(), r = call(f, ['task', 'add', 'new', '--no-review'], 'after-publication');assert.notStrictEqual(r.status, 0);assert.ok(retained(f.dir, Buffer.from(original + '\ncompeting content\n')));
});
test('task sync preflights all imported surrogate-bearing fields', () => {
  for (const field of ['content', 'activeForm']) { const f = fixture(), before = state(f.file), source = path.join(f.dir, 'import.json');const bad = { content: 'second', activeForm: 'next', [field]: '\uD800' };fs.writeFileSync(source, JSON.stringify([{ content: 'first', status: 'pending' }, bad]));const imported = state(source), r = call(f, ['task', 'sync', '--from', source]);assert.notStrictEqual(r.status, 0);assert.deepStrictEqual(state(f.file), before);assert.deepStrictEqual(state(source), imported); }
});
test('task sync refuses malformed source bytes before importing any rows', () => {
  const f = fixture(), source = path.join(f.dir, 'import.json'), before = state(f.file);fs.writeFileSync(source, Buffer.concat([Buffer.from('[{"content":"'), Buffer.from([0xff]), Buffer.from('"}]')]));const src = state(source);assert.notStrictEqual(call(f, ['task', 'sync', '--from', source]).status, 0);assert.deepStrictEqual(state(f.file), before);assert.deepStrictEqual(state(source), src);
});
test('task sync accepts exact valid multilingual content and replacement examples', () => {
  const f = fixture(), source = path.join(f.dir, 'import.json');fs.writeFileSync(source, '\uFEFF' + JSON.stringify([{ content: 'import ' + sample, activeForm: sample }]));success(call(f, ['task', 'sync', '--from', source]));assert.ok(fs.readFileSync(f.file, 'utf8').includes('import ' + renderedSample));
});
test('paired plan edit refuses invalid tracker before changing plan', () => {
  const f = fixture(Buffer.concat([Buffer.from(original), Buffer.from([0xff])])), plan = path.join(f.ws, 'plan.md'), before = state(plan);assert.notStrictEqual(call(f, ['plan', 'add', 'new milestone']).status, 0);assert.deepStrictEqual(state(plan), before);
});
test('duplicate repair uses the same checked table publication', () => {
  const f = fixture(header + `| T-0001 | planned | ${sample} | source | next | 2026-09-21 |\n`.repeat(2));call(f, ['idempotency', 'audit', '--auto-fix']);const text = fs.readFileSync(f.file, 'utf8');assert.strictEqual((text.match(/\| T-0001 \|/g) || []).length, 1);assert.ok(text.includes(renderedSample));
});
test('lazy auto-track batches through checked publication and preserves suffix', () => {
  const f = fixture();fs.writeFileSync(path.join(f.dir, 'sample.js'), '// TODO: tracked test marker\n');call(f, ['lazy', 'detect', '--auto-track']);const text = fs.readFileSync(f.file, 'utf8');assert.ok(text.includes('TODO sample.js:1'));assert.ok(text.includes('사용자 메모: ' + sample));
});
console.log(`Tests: ${passed}/${passed + failed} passed`);if (failed) process.exitCode = 1;
